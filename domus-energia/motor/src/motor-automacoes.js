// Automações e cenas (docs/PROTOCOLO-MQTT-v2.md §3, docs/PROTOCOLO-MQTT-v3.md
// §7–§8): gatilhos, condições, execução de ações (com `esperar` e `se`),
// pausa manual, registo, avisos de conflito e comandos aos aparelhos.
//
// Métodos misturados na classe Motor (Object.assign no fim de motor.js).

import { comandosLigar, comandosEstore, comandosLuz, MAX_PERIGOSA_S } from './aparelhos.js';
import {
  validarAutomacoes,
  validarAutomacao,
  validarCenas,
  validarCena,
  cenasUsadas,
  conflitos,
  percorrerAcoes,
  textoDuracao,
} from './validacao.js';
import { partesLocais, dentroDoIntervalo, horaLocal, somarDias, nomeDia, paraMinutos, FUSO } from './tempo.js';
import { horasSol, instanteSol } from './sol.js';
import { NOMES_MODOS } from './relatorio.js';
import { lerJson, eObjeto } from './util.js';
import { TIPO_DO_MODO } from './motor-casa.js';

/** @typedef {import('./motor.js').Motor} Motor */
/** @typedef {import('./motor.js').Cliente} Cliente */
/** @typedef {import('./validacao.js').Automacao} Automacao */
/** @typedef {import('./validacao.js').Cena} Cena */

export const MAX_REGISTO = 20;
/** Máximo de execuções de uma automação por minuto (proteção contra ciclos). */
export const MAX_EXECUCOES_MINUTO = 20;
/** Tempo para um aparelho confirmar um comando. */
export const RESPOSTA_MS = 5000;
/** Profundidade máxima de execuções encadeadas (automação → modo → automação…). */
export const MAX_PROFUNDIDADE = 8;
/** Uma sequência com `esperar` atrasada mais do que isto (motor parado) é abandonada. */
export const ATRASO_MAXIMO_SEQUENCIA_MS = 3_600_000;
const POR_RE = /^[a-z0-9:_-]{1,60}$/;

/**
 * Contexto de uma execução de ações.
 * @typedef {object} ContextoExecucao
 * @property {'automacao'|'cena'} origem
 * @property {string} ref         id da automação ou cena
 * @property {string} nome        nome a usar nas notificações
 * @property {Automacao} [a]
 * @property {boolean} teste
 * @property {boolean} [manual]  executada à mão pelo cliente: ignora a pausa manual
 * @property {string} por         quem aparece como autor (ex.: "automacao:luz", "cena:cinema")
 * @property {{nome: string, ate: number}[]} pausadas
 * @property {number} feitas
 */

/** Tamanho máximo de `_automacoes/registo` (50 automações × 20 entradas passava dos 64 KB do broker). */
export const MAX_REGISTO_BYTES = 200_000;

/**
 * Serializa o registo, encurtando `ultimos` (20 → 10 → 5 → 2 → 1 → 0 entradas
 * por automação) até caber em MAX_REGISTO_BYTES. O estado guardado não muda.
 * @param {Record<string, any>} registo
 */
export function textoRegistoLimitado(registo, limite = MAX_REGISTO_BYTES) {
  let texto = JSON.stringify(registo);
  for (const n of [10, 5, 2, 1, 0]) {
    if (Buffer.byteLength(texto) <= limite) break;
    texto = JSON.stringify(Object.fromEntries(Object.entries(registo).map(([id, r]) => [id, { ...r, ultimos: (r.ultimos ?? []).slice(0, n) }])));
  }
  return texto;
}

/** A automação mexe neste canal? */
function mexeNoCanal(a, idAparelho, n) {
  let sim = false;
  percorrerAcoes(a.entao, (x) => {
    if (x.aparelho === idAparelho && x.canal === n && ['ligar', 'desligar', 'alternar', 'luz', 'estore'].includes(x.acao)) sim = true;
  });
  return sim;
}

/** @type {ThisType<Motor> & Record<string, Function>} */
export const metodosAutomacoes = {
  // ------------------------------------------------------------ gravação

  adotarAutomacoes(codigo, payload) {
    const c = this.cliente(codigo);
    if (c.automacoes) return;
    const v = validarAutomacoes(lerJson(payload), { aparelhos: null, admin: true, verificarAparelhos: false });
    if (!v.ok) return;
    c.automacoes = v.lista;
    this.log.info(`[automações] ${codigo}: ${v.lista.length} automação(ões) adotada(s) da mensagem retida`);
    this.guardar();
  },

  /** Contexto de validação do cliente (aparelhos, configuração e cenas). @param {Cliente} c */
  contextoValidacao(c) {
    return { aparelhos: c.aparelhos, config: this.cfg(c), cenas: new Set((c.cenas ?? []).map((x) => x.id)) };
  },

  aoAutomacoesSet(codigo, payload) {
    const c = this.cliente(codigo);
    const lista = lerJson(payload);
    let v = !this.pode(c, 'automacoes')
      ? { ok: false, erro: this.bloqueio(c, 'automacoes') }
      : lista === undefined
        ? { ok: false, erro: 'A lista de automações não é JSON válido.' }
        : validarAutomacoes(lista, { ...this.contextoValidacao(c), existentes: c.automacoes ?? [] });
    if (v.ok) {
      const erroPlano = this.erroPlanoAutomacoes(c, v.lista);
      if (erroPlano) v = { ok: false, erro: erroPlano };
    }
    if (!v.ok) {
      this.log.aviso(`[automações] ${codigo}: rejeitadas — ${v.erro}`);
      this.evento(c, { tipo: 'erro', titulo: 'Automações não guardadas', mensagem: v.erro });
      // Republica a lista em vigor para a app/site voltarem ao estado real.
      this.publicar(`domus/${codigo}/_automacoes`, c.automacoes ?? [], true);
      return;
    }
    this.definirAutomacoes(c, v.lista);
  },

  /**
   * Canal de administração (só `admin` e `motor` podem publicar, pela ACL):
   *   {"op":"guardar","automacao":{...}} | {"op":"guardar","automacoes":[...]}
   *   {"op":"apagar","id":"..."}
   *   {"op":"substituir","automacoes":[...]}
   * Resposta (não retida) em `domus/<c>/_automacoes/admin/resultado`:
   *   {"pedido": <eco>, "ok": true} ou {"pedido": <eco>, "ok": false, "erro": "..."}
   */
  aoAutomacoesAdmin(codigo, payload) {
    const c = this.cliente(codigo);
    const p = lerJson(payload);
    const pedido = p && typeof p === 'object' ? p.pedido ?? null : null;
    const responder = (ok, erro) => {
      this.publicar(`domus/${codigo}/_automacoes/admin/resultado`, ok ? { pedido, ok } : { pedido, ok, erro });
      if (ok) this.log.info(`[admin] ${codigo}: ${p.op} aplicado`);
      else this.log.aviso(`[admin] ${codigo}: ${erro}`);
    };
    if (!p || typeof p !== 'object') return responder(false, 'Pedido de administração não é JSON válido.');
    const atuais = c.automacoes ?? [];
    const ctx = this.contextoValidacao(c);
    let nova;
    if (p.op === 'guardar') {
      const itens = Array.isArray(p.automacoes) ? p.automacoes : p.automacao ? [p.automacao] : null;
      if (!itens || itens.length === 0) return responder(false, 'Falta "automacao" ou "automacoes".');
      nova = [...atuais];
      try {
        itens.forEach((item, i) => {
          const a = validarAutomacao(item, i, c.aparelhos, { bloqueadaPorOmissao: true, config: ctx.config, cenas: ctx.cenas });
          const j = nova.findIndex((x) => x.id === a.id);
          if (j >= 0) nova[j] = a;
          else nova.push(a);
        });
      } catch (e) {
        return responder(false, e.message);
      }
    } else if (p.op === 'apagar') {
      if (!atuais.some((a) => a.id === p.id)) return responder(false, `Não existe a automação "${p.id}".`);
      nova = atuais.filter((a) => a.id !== p.id);
    } else if (p.op === 'substituir') {
      nova = p.automacoes;
    } else {
      return responder(false, `Operação desconhecida ${JSON.stringify(p.op)} (use guardar, apagar ou substituir).`);
    }
    const v = validarAutomacoes(nova, { ...ctx, admin: true });
    if (!v.ok) return responder(false, v.erro);
    this.definirAutomacoes(c, v.lista);
    responder(true);
  },

  /** @param {Cliente} c */
  calcularConflitos(c) {
    return conflitos(c.automacoes ?? [], c.aparelhos);
  },

  /** @param {Cliente} c @param {Automacao[]} lista */
  definirAutomacoes(c, lista) {
    c.automacoes = lista;
    const ids = new Set(lista.map((a) => a.id));
    for (const chave of this.potencia.keys()) {
      const [cod, id] = chave.split('/');
      if (cod === c.codigo && !ids.has(id)) this.potencia.delete(chave);
    }
    for (const id of Object.keys(c.horaDisparos)) if (!ids.has(id)) delete c.horaDisparos[id];
    for (const id of Object.keys(c.duracoes)) if (!ids.has(id)) delete c.duracoes[id];
    for (const id of Object.keys(c.contagens)) if (!ids.has(id)) delete c.contagens[id];
    if (c.registo) {
      for (const id of Object.keys(c.registo)) {
        if (!ids.has(id)) {
          delete c.registo[id];
          c.registoSujo = true;
        }
      }
    }
    this.sequencias = this.sequencias.filter((s) => s.cliente !== c.codigo || s.origem !== 'automacao' || ids.has(s.ref));
    this.log.info(`[automações] ${c.codigo}: ${lista.length} automação(ões) guardada(s)`);
    this.publicar(`domus/${c.codigo}/_automacoes`, lista, true);
    c.avisosConflito = this.calcularConflitos(c);
    this.publicar(`domus/${c.codigo}/_automacoes/avisos`, c.avisosConflito, true);
    this.guardar();
  },

  // ---------------------------------------------------------------- cenas

  adotarCenas(codigo, payload) {
    const c = this.cliente(codigo);
    if (c.cenas) return;
    const v = validarCenas(lerJson(payload), { aparelhos: null, admin: true, verificarAparelhos: false });
    if (!v.ok) return;
    c.cenas = v.lista;
    this.log.info(`[cenas] ${codigo}: ${v.lista.length} cena(s) adotada(s) da mensagem retida`);
    this.guardar();
  },

  aoCenasSet(codigo, payload) {
    const c = this.cliente(codigo);
    const lista = lerJson(payload);
    let v = !this.pode(c, 'cenas')
      ? { ok: false, erro: this.bloqueio(c, 'cenas') }
      : lista === undefined
        ? { ok: false, erro: 'A lista de cenas não é JSON válido.' }
        : validarCenas(lista, { aparelhos: c.aparelhos, existentes: c.cenas ?? [], usadas: cenasUsadas(c.automacoes) });
    if (v.ok) {
      const erroPlano = this.erroPlanoCenas(c, v.lista);
      if (erroPlano) v = { ok: false, erro: erroPlano };
    }
    if (!v.ok) {
      this.log.aviso(`[cenas] ${codigo}: rejeitadas — ${v.erro}`);
      this.evento(c, { tipo: 'erro', titulo: 'Cenas não guardadas', mensagem: v.erro });
      this.publicar(`domus/${codigo}/_cenas`, c.cenas ?? [], true);
      return;
    }
    this.definirCenas(c, v.lista);
  },

  /**
   * Administração das cenas bloqueadas (como `_automacoes/admin`):
   * {"op":"guardar","cena"|"cenas"}, {"op":"apagar","id"}, {"op":"substituir","cenas"};
   * resposta em `_cenas/admin/resultado`.
   */
  aoCenasAdmin(codigo, payload) {
    const c = this.cliente(codigo);
    const p = lerJson(payload);
    const pedido = p && typeof p === 'object' ? p.pedido ?? null : null;
    const responder = (ok, erro) => {
      this.publicar(`domus/${codigo}/_cenas/admin/resultado`, ok ? { pedido, ok } : { pedido, ok, erro });
      if (!ok) this.log.aviso(`[admin] ${codigo}: ${erro}`);
    };
    if (!p || typeof p !== 'object') return responder(false, 'Pedido de administração não é JSON válido.');
    const atuais = c.cenas ?? [];
    let nova;
    if (p.op === 'guardar') {
      const itens = Array.isArray(p.cenas) ? p.cenas : p.cena ? [p.cena] : null;
      if (!itens || itens.length === 0) return responder(false, 'Falta "cena" ou "cenas".');
      nova = [...atuais];
      try {
        itens.forEach((item, i) => {
          const x = validarCena(item, i, c.aparelhos, { bloqueadaPorOmissao: true });
          const j = nova.findIndex((y) => y.id === x.id);
          if (j >= 0) nova[j] = x;
          else nova.push(x);
        });
      } catch (e) {
        return responder(false, e.message);
      }
    } else if (p.op === 'apagar') {
      if (!atuais.some((x) => x.id === p.id)) return responder(false, `Não existe a cena "${p.id}".`);
      nova = atuais.filter((x) => x.id !== p.id);
    } else if (p.op === 'substituir') {
      nova = p.cenas;
    } else {
      return responder(false, `Operação desconhecida ${JSON.stringify(p.op)} (use guardar, apagar ou substituir).`);
    }
    const v = validarCenas(nova, { aparelhos: c.aparelhos, admin: true, usadas: cenasUsadas(c.automacoes) });
    if (!v.ok) return responder(false, v.erro);
    this.definirCenas(c, v.lista);
    responder(true);
  },

  /** @param {Cliente} c @param {Cena[]} lista */
  definirCenas(c, lista) {
    c.cenas = lista;
    this.log.info(`[cenas] ${c.codigo}: ${lista.length} cena(s) guardada(s)`);
    this.publicar(`domus/${c.codigo}/_cenas`, lista, true);
    this.guardar();
  },

  aoCenasExecutar(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    const erro = (m) => this.evento(c, { tipo: 'erro', titulo: 'Cena não executada', mensagem: m });
    if (!this.pode(c, 'cenas')) return erro(this.bloqueio(c, 'cenas'));
    if (!eObjeto(v)) return erro('Pedido inválido: envie {"id": "<cena>"}.');
    for (const k of Object.keys(v)) if (k !== 'id' && k !== 'por') return erro(`Pedido inválido: campo desconhecido "${k}".`);
    const cena = (c.cenas ?? []).find((x) => x.id === v.id);
    if (!cena) return erro(`A cena ${JSON.stringify(v.id ?? null)} não existe.`);
    const por = typeof v.por === 'string' && POR_RE.test(v.por) ? v.por : 'app';
    this.executarCena(c, cena, por, true);
  },

  /**
   * Executa as ações de uma cena. As cenas não respeitam a pausa manual
   * (são um pedido explícito).
   * @param {Cliente} c
   * @param {Cena} cena
   * @param {string} por
   * @param {boolean} [registarEvento] evento no histórico (execução pela app/site)
   */
  executarCena(c, cena, por, registarEvento = false) {
    if (!this.pode(c, 'cenas')) {
      this.log.info(`[cenas] ${c.codigo}/${cena.id}: não executada (fora do plano)`);
      return;
    }
    if (this.profundidade >= MAX_PROFUNDIDADE) {
      this.log.aviso(`[cenas] ${c.codigo}/${cena.id}: demasiadas execuções encadeadas; ignorada`);
      return;
    }
    // Mesmo limite anti-ciclo/abuso das automações (a app pode pedir a mesma cena em rajada).
    if (!this.contarExecucao(`${c.codigo}/cena:${cena.id}`)) {
      this.log.aviso(`[cenas] ${c.codigo}/${cena.id}: demasiadas execuções no último minuto; ignorada`);
      return;
    }
    this.log.info(`[cenas] ${c.codigo}/${cena.id}: executada (por ${por})`);
    this.sequencias = this.sequencias.filter((s) => !(s.cliente === c.codigo && s.origem === 'cena' && s.ref === cena.id));
    if (registarEvento) this.evento(c, { tipo: 'automacao', titulo: `Cena: ${cena.nome}`, mensagem: `Cena "${cena.nome}" executada (por ${por}).`, por });
    /** @type {ContextoExecucao} */
    const ctx = { origem: 'cena', ref: cena.id, nome: cena.nome, teste: false, por: `cena:${cena.id}`, pausadas: [], feitas: 0 };
    this.profundidade++;
    try {
      this.correrAcoes(c, ctx, cena.acoes);
    } finally {
      this.profundidade--;
    }
  },

  /**
   * Limite de MAX_EXECUCOES_MINUTO execuções por minuto de uma automação ou
   * cena (`chave`). Conta a execução e devolve true se ainda cabe no limite.
   * @param {string} chave
   */
  contarExecucao(chave) {
    const agora = this.relogio.agora();
    const recentes = (this.execucoes.get(chave) ?? []).filter((t) => agora - t < 60_000);
    if (recentes.length >= MAX_EXECUCOES_MINUTO) {
      this.execucoes.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    this.execucoes.set(chave, recentes);
    return true;
  },

  // ------------------------------------------------------------ executar

  /** `_automacoes/executar`: {"id"} (manual), {"id","testar":true}, {"id","avaliar":true}. */
  aoAutomacoesExecutar(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    const erro = (m) => this.evento(c, { tipo: 'erro', titulo: 'Automação não executada', mensagem: m });
    if (!this.pode(c, 'automacoes')) return erro(this.bloqueio(c, 'automacoes'));
    if (!eObjeto(v)) return erro('Pedido inválido: envie {"id": "<automação>"}.');
    for (const k of Object.keys(v)) if (!['id', 'testar', 'avaliar', 'por'].includes(k)) return erro(`Pedido inválido: campo desconhecido "${k}".`);
    if ((v.testar !== undefined && typeof v.testar !== 'boolean') || (v.avaliar !== undefined && typeof v.avaliar !== 'boolean')) {
      return erro('"testar" e "avaliar" têm de ser true ou false.');
    }
    if (v.testar && v.avaliar) return erro('Use "testar" ou "avaliar", não os dois.');
    const a = (c.automacoes ?? []).find((x) => x.id === v.id);
    if (!a) return erro(`A automação ${JSON.stringify(v.id ?? null)} não existe.`);
    const por = typeof v.por === 'string' && POR_RE.test(v.por) ? v.por : 'app';
    if (v.avaliar) {
      const r = this.avaliarCondicoes(c, a.se);
      if (!r.ok) return this.registarAvaliacao(c, a.id, r.motivo, false);
      // Condições verdadeiras, mas os canais onde age podem estar em pausa manual.
      const pausa = this.pausasDe(c, a);
      if (pausa.todos) return this.registarAvaliacao(c, a.id, `Pausa manual: ${pausa.texto}.`, false);
      this.registarAvaliacao(c, a.id, `As condições são verdadeiras agora.${pausa.texto ? ` Pausa manual: ${pausa.texto} (ações nesses canais não seriam executadas).` : ''}`, true);
      return;
    }
    if (v.testar) {
      this.executar(c, a, `${por === 'web' || por === 'app' ? 'pela' : 'por'} ${por}`, { teste: true });
      return;
    }
    if (!a.ativa) return erro(`A automação "${a.nome}" está desativada.`);
    // Pedido explícito do cliente: ignora a pausa manual.
    this.executar(c, a, `executada à mão (${por})`, { manual: true });
  },

  // ------------------------------------------------------------ gatilhos

  /** Gatilhos `sensor` de um canal que mudou (transição ao vivo). @param {Cliente} c */
  gatilhosSensor(c, ap, canal, valor) {
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo !== 'sensor' || q.aparelho !== ap.id || q.canal !== canal.n) continue;
      if (q.durante_s) {
        if (q.valor === valor && a.ativa) {
          c.duracoes[a.id] = { desde: this.relogio.agora(), disparado: false };
          this.guardar();
        } else if (c.duracoes[a.id]) {
          delete c.duracoes[a.id];
          this.guardar();
        }
        continue;
      }
      if (q.valor === valor) this.executar(c, a, `${canal.nome} = ${valor}`);
    }
  },

  /** O canal deixou de ter o valor de um gatilho "há X s": cancela a contagem. */
  cancelarDuracoes(c, ap, n, valor) {
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo === 'sensor' && q.durante_s && q.aparelho === ap.id && q.canal === n && q.valor !== valor && c.duracoes[a.id]) {
        delete c.duracoes[a.id];
        this.guardar();
      }
    }
  },

  /** Gatilhos `sensor` com `durante_s` cujo tempo já passou. @param {Cliente} c */
  verificarDuracoes(c) {
    const agora = this.relogio.agora();
    for (const [id, d] of Object.entries(c.duracoes)) {
      if (d.disparado) continue;
      const a = (c.automacoes ?? []).find((x) => x.id === id);
      const q = a?.quando;
      if (!a || q.tipo !== 'sensor' || !q.durante_s) {
        delete c.duracoes[id];
        continue;
      }
      if (agora - d.desde < q.durante_s * 1000) continue;
      d.disparado = true;
      this.guardar();
      const nome = c.aparelhos?.get(q.aparelho)?.canais.get(q.canal)?.nome ?? q.aparelho;
      this.executar(c, a, `${nome} = ${q.valor} há ${textoDuracao(q.durante_s)}`);
    }
  },

  /** Recomeça a contagem `durante_s` das automações disparadas por este sensor. */
  prolongar(c, ap, canal, valor) {
    const agora = this.relogio.agora();
    let mudou = false;
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (!a.ativa || q.tipo !== 'sensor' || q.durante_s || q.aparelho !== ap.id || q.canal !== canal.n || q.valor !== valor) continue;
      for (const r of this.reversoes) {
        if (r.cliente !== c.codigo || r.automacao !== a.id) continue;
        let acao;
        percorrerAcoes(a.entao, (x) => {
          if (!acao && x.aparelho === r.aparelho && x.canal === r.canal && x.durante_s) acao = x;
        });
        if (!acao) continue;
        r.quando = Math.max(r.quando, agora + acao.durante_s * 1000);
        mudou = true;
      }
    }
    if (mudou) this.guardar();
  },

  atualizarPotencia(c, ap, w, retida) {
    this.estadoAparelho(c, ap.id).potenciaW = w;
    if (retida) return; // valor antigo: não começa a contar tempo
    const agora = this.relogio.agora();
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo !== 'potencia' || q.aparelho !== ap.id) continue;
      const chave = `${c.codigo}/${a.id}`;
      const est = this.potencia.get(chave);
      const rearmar = q.rearmar_w ?? q.acima_w * 0.9;
      if (w > q.acima_w) {
        if (!est) this.potencia.set(chave, { desde: agora, disparado: false });
      } else if (est && (!est.disparado || w < rearmar)) {
        // Ainda não disparou: recomeça a contar. Já disparou: só rearma abaixo de `rearmar_w` (histerese).
        this.potencia.delete(chave);
      }
    }
    this.verificarPotencia(c);
  },

  verificarPotencia(c) {
    const agora = this.relogio.agora();
    for (const a of c.automacoes ?? []) {
      if (a.quando.tipo !== 'potencia') continue;
      const est = this.potencia.get(`${c.codigo}/${a.id}`);
      if (!est || est.disparado || agora - est.desde < a.quando.durante_s * 1000) continue;
      est.disparado = true;
      const ap = c.aparelhos?.get(a.quando.aparelho);
      this.executar(c, a, `${ap?.nome ?? a.quando.aparelho} acima de ${a.quando.acima_w} W`);
    }
  },

  /**
   * Gatilho `sistema` (aparelho_offline, aparelho_online, energia_reposta).
   * @param {Cliente} c
   * @param {string} evento
   * @param {import('./aparelhos.js').Aparelho} [ap]
   */
  dispararSistema(c, evento, ap) {
    const textos = { aparelho_offline: 'ficou offline', aparelho_online: 'voltou a estar online', energia_reposta: 'energia reposta' };
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo !== 'sistema' || q.evento !== evento) continue;
      if (q.aparelho && q.aparelho !== ap?.id) continue;
      this.executar(c, a, ap ? `${ap.nome} ${textos[evento]}` : textos[evento]);
    }
  },

  /** Automações cujo gatilho vem de um aparelho que ficou offline: fica no registo. */
  gatilhoOffline(c, ap, desde) {
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (!a.ativa || !['sensor', 'potencia'].includes(q.tipo) || q.aparelho !== ap.id) continue;
      this.registar(c, a.id, 'falhou', `Não disparou: aparelho do gatilho (${ap.nome}) offline desde ${horaLocal(desde)}`);
    }
  },

  /** @param {Cliente} c @param {string} modo */
  dispararModo(c, modo) {
    for (const a of c.automacoes ?? []) {
      if (a.quando.tipo === 'modo' && a.quando.modo === modo) this.executar(c, a, `modo ${NOMES_MODOS[modo]}`);
    }
  },

  /** @param {Cliente} c @param {'chega_primeiro'|'sai_ultimo'} evento */
  dispararPresenca(c, evento) {
    for (const a of c.automacoes ?? []) {
      if (a.quando.tipo === 'presenca' && a.quando.evento === evento) {
        this.executar(c, a, evento === 'chega_primeiro' ? 'chegou a primeira pessoa' : 'saiu a última pessoa');
      }
    }
  },

  /** Gatilhos por hora e por sol (uma vez por minuto). @param {Cliente} c */
  minutoAutomacoes(c, ms, local) {
    const minuto = Math.floor(ms / 60_000);
    // Mudança de hora de março (Lisboa: 01:00 → 02:00): as horas locais que não
    // existem nesse dia (01:00–01:59) disparam no primeiro minuto depois do salto.
    const antes = partesLocais(ms - 60_000, FUSO);
    const saltadas = antes.data === local.data && local.minutos - antes.minutos > 1 ? [antes.minutos + 1, local.minutos - 1] : null;
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo === 'hora') {
        if (!q.dias.includes(local.diaSemana)) continue;
        const m = paraMinutos(q.hora);
        const saltada = saltadas && m >= saltadas[0] && m <= saltadas[1];
        if (q.hora !== local.hora && !saltada) continue;
        // Na mudança de hora de outubro a mesma hora local repete-se: só uma vez.
        const chave = `${local.data} ${q.hora}`;
        if (c.horaDisparos[a.id] === chave) continue;
        c.horaDisparos[a.id] = chave;
        this.guardar();
        this.executar(c, a, saltada ? `hora ${q.hora} (não existiu hoje por causa da mudança de hora; executada às ${local.hora})` : `hora ${local.hora}`);
      } else if (q.tipo === 'sol') {
        const pos = this.cfg(c).local;
        if (!pos) continue;
        // O desvio pode passar a meia-noite: vê o evento de ontem, hoje e amanhã.
        for (const d of [somarDias(local.data, -1), local.data, somarDias(local.data, 1)]) {
          const t = instanteSol(d, pos.lat, pos.lon, q.evento);
          if (t === null || Math.floor((t + q.desvio_min * 60_000) / 60_000) !== minuto) continue;
          const k = `${d} sol`;
          if (c.horaDisparos[a.id] === k) continue;
          c.horaDisparos[a.id] = k;
          this.guardar();
          const desvio = q.desvio_min ? ` ${q.desvio_min > 0 ? '+' : ''}${q.desvio_min} min` : '';
          this.executar(c, a, `${q.evento === 'nascer' ? 'nascer' : 'pôr'} do sol${desvio}`);
        }
      }
    }
  },

  // ------------------------------------------------------------ condições

  /**
   * Avalia as condições. Devolve o motivo (em pt-PT) da primeira que falhar.
   * @param {Cliente} c
   * @param {import('./validacao.js').Condicoes} [se]
   * @returns {{ok: boolean, motivo?: string}}
   */
  avaliarCondicoes(c, se) {
    if (!se) return { ok: true };
    const falsa = (desc, atual) => ({ ok: false, motivo: `Condição '${desc}' falsa (${atual})` });
    const agora = this.relogio.agora();
    const p = partesLocais(agora, FUSO);
    if (se.alarme !== undefined) {
      const ativo = c.alarme?.ativo ?? false;
      if (ativo !== se.alarme) return falsa(`alarme = ${se.alarme ? 'ligado' : 'desligado'}`, `alarme atual: ${ativo ? 'ligado' : 'desligado'}`);
    }
    if (se.entre && !dentroDoIntervalo(p.minutos, se.entre[0], se.entre[1])) {
      return falsa(`entre ${se.entre[0]} e ${se.entre[1]}`, `agora: ${p.hora}`);
    }
    if (se.dias && !se.dias.includes(p.diaSemana)) {
      return falsa(`dias = ${se.dias.map(nomeDia).join(', ')}`, `hoje: ${nomeDia(p.diaSemana)}`);
    }
    if (se.sol) {
      const pos = this.cfg(c).local;
      if (!pos) return falsa(`sol = ${se.sol}`, 'falta a localização da casa');
      const h = horasSol(p.data, pos);
      const dia = h.nascer !== null && h.por !== null && agora >= h.nascer && agora < h.por;
      if ((se.sol === 'dia') !== dia) {
        const horas = h.nascer !== null && h.por !== null ? `; nascer às ${horaLocal(h.nascer)}, pôr às ${horaLocal(h.por)}` : '';
        return falsa(`sol = ${se.sol}`, `agora é ${dia ? 'dia' : 'noite'}${horas}`);
      }
    }
    if (se.modo) {
      const atual = c.modo?.modo ?? 'casa';
      if (!se.modo.includes(atual)) return falsa(`modo = ${se.modo.join(' ou ')}`, `modo atual: ${atual}`);
    }
    if (se.presenca) {
      const pessoas = Object.values(c.presenca?.pessoas ?? {}).filter((x) => x.em_casa);
      const alguem = pessoas.length > 0;
      if ((se.presenca === 'alguem') !== alguem) {
        return falsa(`presença = ${se.presenca === 'alguem' ? 'alguém' : 'ninguém'}`, alguem ? `em casa: ${pessoas.map((x) => x.nome).join(', ')}` : 'ninguém em casa');
      }
    }
    for (const x of se.aparelhos ?? []) {
      const v = this.valorCanal(c, x.aparelho, x.canal);
      if (v !== x.valor) {
        const nome = c.aparelhos?.get(x.aparelho)?.canais.get(x.canal)?.nome ?? `${x.aparelho} canal ${x.canal}`;
        return falsa(`${nome} = ${x.valor}`, v === undefined ? 'valor atual desconhecido' : `valor atual: ${v}`);
      }
    }
    return { ok: true };
  },

  // ------------------------------------------------------------ execução

  /**
   * Executa uma automação (se ativa e se as condições se verificarem).
   * Com `teste`, ignora o estado ativo, as condições e a pausa manual.
   * Com `manual` (executada à mão), ignora só a pausa manual.
   * @param {Cliente} c
   * @param {Automacao} a
   * @param {string} motivo
   * @param {{teste?: boolean, manual?: boolean}} [o]
   */
  executar(c, a, motivo, o = {}) {
    const teste = o.teste === true;
    const manual = o.manual === true;
    // Modo básico (subscrição suspensa/cancelada): nenhuma automação corre.
    if (!this.pode(c, 'automacoes')) return false;
    if (!teste) {
      if (!a.ativa) return false;
      const r = this.avaliarCondicoes(c, a.se);
      if (!r.ok) {
        this.registar(c, a.id, 'condicao_falsa', `Disparou (${motivo}) mas não executou: ${r.motivo}`);
        return false;
      }
    }
    const chave = `${c.codigo}/${a.id}`;
    if (this.profundidade >= MAX_PROFUNDIDADE || !this.contarExecucao(chave)) {
      this.log.aviso(`[automações] ${chave}: demasiadas execuções (no último minuto ou encadeadas); ignorada`);
      return false;
    }
    this.log.info(`[automações] ${chave}: ${teste ? 'teste' : 'executada'} (${motivo})`);
    // Um novo disparo substitui uma sequência (com "esperar") ainda pendente.
    this.sequencias = this.sequencias.filter((s) => !(s.cliente === c.codigo && s.origem === 'automacao' && s.ref === a.id));
    /** @type {ContextoExecucao} */
    const ctx = { origem: 'automacao', ref: a.id, nome: a.nome, a, teste, manual, por: `automacao:${a.id}`, pausadas: [], feitas: 0 };
    this.profundidade++;
    try {
      this.correrAcoes(c, ctx, a.entao);
    } finally {
      this.profundidade--;
    }
    const pausa = ctx.pausadas.length
      ? `Pausa manual: ${ctx.pausadas.map((x) => `${x.nome} até ${horaLocal(x.ate)}`).join(', ')}`
      : '';
    // O resultado "teste" já diz que é um teste: o motivo não o repete ("Ações executadas (pela web).").
    if (teste) this.registar(c, a.id, 'teste', `Ações executadas (${motivo}).`, { teste: true });
    else if (pausa && ctx.feitas === 0) this.registar(c, a.id, 'pausada', `Disparou (${motivo}) mas não executou. ${pausa}.`);
    else this.registar(c, a.id, 'executada', `Disparou: ${motivo}.${pausa ? ` ${pausa} (ações nesses canais não executadas).` : ''}`);
    return true;
  },

  /**
   * Executa uma lista de ações por ordem. `esperar` suspende o resto (fica
   * guardado em `this.sequencias` e sobrevive a reinícios); `se` escolhe o
   * ramo pelas condições no momento em que é alcançado.
   * @param {Cliente} c
   * @param {ContextoExecucao} ctx
   * @param {any[]} acoes
   */
  correrAcoes(c, ctx, acoes) {
    const fila = [...acoes];
    while (fila.length) {
      const acao = fila.shift();
      if (acao.acao === 'esperar') {
        if (fila.length) {
          this.sequencias.push({
            cliente: c.codigo,
            origem: ctx.origem,
            ref: ctx.ref,
            acoes: fila,
            quando: this.relogio.agora() + acao.s * 1000,
            ...(ctx.teste ? { teste: true } : {}),
            ...(ctx.manual ? { manual: true } : {}),
          });
          this.guardar();
        }
        return;
      }
      if (acao.acao === 'se') {
        const r = this.avaliarCondicoes(c, acao.condicao);
        fila.unshift(...(r.ok ? acao.entao : acao.senao ?? []));
        continue;
      }
      try {
        this.executarAcao(c, ctx, acao);
      } catch (e) {
        this.log.erro(`[automações] ${c.codigo}/${ctx.ref}: erro na ação ${acao.acao}: ${e.message}`);
      }
    }
  },

  /** Retoma as sequências cujo `esperar` terminou. */
  executarSequencias() {
    const agora = this.relogio.agora();
    if (!this.sequencias.some((s) => s.quando <= agora)) return;
    const devidas = this.sequencias.filter((s) => s.quando <= agora);
    this.sequencias = this.sequencias.filter((s) => s.quando > agora);
    for (const s of devidas) {
      const c = this.clientes.get(s.cliente);
      if (!c) continue;
      if (!this.pode(c, s.origem === 'cena' ? 'cenas' : 'automacoes')) continue; // modo básico: abandonada
      if (c.aparelhos === null) {
        this.sequencias.push(s); // arranque: ainda não conhecemos os aparelhos
        continue;
      }
      if (agora - s.quando > ATRASO_MAXIMO_SEQUENCIA_MS) {
        this.log.aviso(`[automações] ${s.cliente}/${s.ref}: sequência abandonada (atrasada ${Math.round((agora - s.quando) / 60_000)} min)`);
        continue;
      }
      /** @type {ContextoExecucao} */
      let ctx;
      if (s.origem === 'automacao') {
        const a = (c.automacoes ?? []).find((x) => x.id === s.ref);
        if (!a || (!a.ativa && !s.teste)) continue;
        ctx = { origem: 'automacao', ref: a.id, nome: a.nome, a, teste: !!s.teste, manual: !!s.manual, por: `automacao:${a.id}`, pausadas: [], feitas: 0 };
      } else {
        const cena = (c.cenas ?? []).find((x) => x.id === s.ref);
        ctx = { origem: 'cena', ref: s.ref, nome: cena?.nome ?? s.ref, teste: false, por: `cena:${s.ref}`, pausadas: [], feitas: 0 };
      }
      this.log.info(`[automações] ${s.cliente}/${s.ref}: fim de "esperar", a continuar`);
      this.correrAcoes(c, ctx, s.acoes);
      if (ctx.pausadas.length) {
        this.registar(c, s.ref, 'pausada', `Pausa manual: ${ctx.pausadas.map((x) => `${x.nome} até ${horaLocal(x.ate)}`).join(', ')} (depois de "esperar").`);
      }
    }
    this.guardar();
  },

  /**
   * @param {Cliente} c
   * @param {ContextoExecucao} ctx
   * @param {any} acao
   */
  executarAcao(c, ctx, acao) {
    switch (acao.acao) {
      case 'notificar':
        ctx.feitas++;
        this.evento(c, { tipo: 'automacao', titulo: ctx.nome, mensagem: acao.mensagem }, true);
        return;
      case 'cena': {
        const cena = (c.cenas ?? []).find((x) => x.id === acao.cena);
        if (!cena) {
          this.log.aviso(`[automações] ${c.codigo}/${ctx.ref}: a cena ${acao.cena} já não existe`);
          return;
        }
        ctx.feitas++;
        this.executarCena(c, cena, ctx.por);
        return;
      }
      case 'modo':
        if (TIPO_DO_MODO[acao.modo] && !this.pode(c, 'alarme')) {
          const m = `Modo ${NOMES_MODOS[acao.modo]} não ativado: ${this.bloqueio(c, 'alarme')}`;
          this.log.info(`[automações] ${c.codigo}/${ctx.ref}: ${m}`);
          if (ctx.origem === 'automacao') this.registar(c, ctx.ref, 'falhou', m, ctx.teste ? { teste: true } : {});
          return;
        }
        ctx.feitas++;
        this.mudarModo(c, acao.modo, { forcar: acao.forcar === true, por: ctx.por });
        return;
      default:
        break;
    }
    const ap = c.aparelhos?.get(acao.aparelho);
    const canal = ap?.canais.get(acao.canal);
    if (!ap || !canal) {
      this.log.aviso(`[automações] ${c.codigo}/${ctx.ref}: o aparelho ${acao.aparelho} canal ${acao.canal} já não existe`);
      return;
    }
    // Limite de segurança: carga perigosa só liga com durante_s ≤ 4 h (também verificado ao gravar).
    if (
      canal.carga === 'perigosa' &&
      (acao.acao === 'alternar' || (acao.acao === 'luz' && acao.brilho > 0) || (acao.acao === 'ligar' && (!acao.durante_s || acao.durante_s > MAX_PERIGOSA_S)))
    ) {
      const m = `Recusado: ${canal.nome} é uma carga perigosa e só pode ser ligada com uma duração de no máximo 4 horas.`;
      this.log.aviso(`[automações] ${c.codigo}/${ctx.ref}: ${m}`);
      if (ctx.origem === 'automacao') this.registar(c, ctx.ref, 'falhou', m, ctx.teste ? { teste: true } : {});
      return;
    }
    // Pausa manual: alguém mexeu neste canal há pouco.
    if (ctx.origem === 'automacao' && !ctx.teste && !ctx.manual && !ctx.a?.ignorar_pausa) {
      const ate = this.pausaAtiva(c, ap.id, acao.canal);
      if (ate) {
        ctx.pausadas.push({ nome: canal.nome, ate });
        this.log.info(`[automações] ${c.codigo}/${ctx.ref}: ${canal.nome} em pausa manual até ${horaLocal(ate)}`);
        return;
      }
    }
    ctx.feitas++;
    // Qualquer ação sobre o canal substitui uma reversão pendente anterior.
    const mesmoCanal = (r) => r.cliente === c.codigo && r.aparelho === ap.id && r.canal === acao.canal;
    const pendente = this.reversoes.find(mesmoCanal);
    this.reversoes = this.reversoes.filter((r) => !mesmoCanal(r));
    if (acao.acao === 'estore') {
      this.enviarEstore(c, ap, acao.canal, acao.posicao, ctx);
    } else if (acao.acao === 'luz') {
      this.enviarLuz(c, ap, acao.canal, acao.brilho, ctx);
    } else {
      const atual = this.valorCanal(c, ap.id, acao.canal);
      const ligar = acao.acao === 'alternar' ? atual !== 1 : acao.acao === 'ligar';
      // Já estava assim por decisão de outra pessoa (sem reversão nossa pendente):
      // não se agenda a reversão, para não desligar uma luz que alguém acendeu.
      const jaEstavaPorOutro = atual === (ligar ? 1 : 0) && !pendente;
      this.enviarLigar(c, ap, acao.canal, ligar, ctx);
      if (acao.durante_s && jaEstavaPorOutro) {
        this.log.info(`[automações] ${c.codigo}/${ctx.ref}: ${ap.id} canal ${acao.canal} já estava ${ligar ? 'ligado' : 'desligado'}; sem reversão`);
      } else if (acao.durante_s) {
        this.reversoes.push({
          cliente: c.codigo,
          aparelho: ap.id,
          canal: acao.canal,
          ligar: !ligar,
          quando: this.relogio.agora() + acao.durante_s * 1000,
          automacao: ctx.ref,
        });
      }
    }
    this.guardar();
  },

  executarReversoes() {
    const agora = this.relogio.agora();
    const devidas = this.reversoes.filter((r) => r.quando <= agora);
    if (devidas.length === 0) return;
    this.reversoes = this.reversoes.filter((r) => r.quando > agora);
    for (const r of devidas) {
      const c = this.clientes.get(r.cliente);
      const ap = c?.aparelhos?.get(r.aparelho);
      if (!c || !ap || !ap.canais.has(r.canal)) {
        // Ainda não sabemos os aparelhos (arranque): tenta de novo mais tarde.
        if (c && c.aparelhos === null) this.reversoes.push(r);
        continue;
      }
      this.log.info(`[automações] ${r.cliente}/${r.automacao}: fim de durante_s — ${r.ligar ? 'ligar' : 'desligar'} ${r.aparelho} canal ${r.canal}`);
      this.enviarLigar(c, ap, r.canal, r.ligar, null);
    }
    this.guardar();
  },

  // -------------------------------------------- comandos e confirmações

  /** @param {Cliente} c @param {ContextoExecucao|null} [ctx] */
  enviarLigar(c, ap, n, ligar, ctx = null) {
    for (const cmd of comandosLigar(c.codigo, ap, n, ligar)) this.publicar(cmd.topico, cmd.payload);
    this.esperarResposta(c, ap, n, ligar ? 1 : 0, ctx);
  },

  /** @param {Cliente} c @param {ContextoExecucao|null} [ctx] */
  enviarLuz(c, ap, n, brilho, ctx = null) {
    for (const cmd of comandosLuz(c.codigo, ap, n, brilho)) this.publicar(cmd.topico, cmd.payload);
    this.esperarResposta(c, ap, n, brilho > 0 ? 1 : 0, ctx);
  },

  /** @param {Cliente} c @param {ContextoExecucao|null} [ctx] */
  enviarEstore(c, ap, n, posicao, ctx = null) {
    for (const cmd of comandosEstore(c.codigo, ap, n, posicao)) this.publicar(cmd.topico, cmd.payload);
    this.esperarResposta(c, ap, n, null, ctx, posicao);
  },

  /**
   * Regista que o motor mandou um comando: as mensagens de estado que o
   * confirmem não contam como "mexido à mão", e sem resposta em 5 s a
   * automação fica com "falhou" no registo.
   * @param {Cliente} c
   * @param {number|null} valor  valor esperado (null = estore: qualquer posição)
   * @param {ContextoExecucao|null} ctx
   * @param {number} [alvo] posição final do estore
   */
  esperarResposta(c, ap, n, valor, ctx, alvo) {
    const agora = this.relogio.agora();
    const atual = this.valorCanal(c, ap.id, n);
    c.esperas = c.esperas.filter((x) => !(x.aparelho === ap.id && x.canal === n));
    c.esperas.push({
      aparelho: ap.id,
      canal: n,
      valor,
      alvo: alvo ?? null,
      desde: agora,
      ate: agora + RESPOSTA_MS,
      expira: agora + (valor === null ? 120_000 : 15_000),
      automacao: ctx?.origem === 'automacao' ? ctx.ref : null,
      teste: !!ctx?.teste,
      respondeu: valor === null ? atual === alvo : atual === valor,
    });
  },

  /**
   * Chegou um estado do canal: se confirma um comando do motor, devolve true
   * (é o eco do motor, não uma mudança à mão).
   * @param {Cliente} c
   */
  confirmarEspera(c, ap, n, valor) {
    const agora = this.relogio.agora();
    const i = c.esperas.findIndex((x) => x.aparelho === ap.id && x.canal === n && x.expira > agora);
    if (i < 0) return false;
    const x = c.esperas[i];
    if (x.valor === null) {
      x.respondeu = true; // estore: as posições intermédias também são do motor
      if (valor === x.alvo) c.esperas.splice(i, 1);
      return true;
    }
    if (x.valor !== valor) return false;
    x.respondeu = true;
    c.esperas.splice(i, 1);
    return true;
  },

  /** Comandos sem resposta em 5 s → "falhou" no registo da automação. @param {Cliente} c */
  verificarEsperas(c) {
    if (!c.esperas.length) return;
    const agora = this.relogio.agora();
    for (const x of c.esperas) {
      if (x.respondeu || x.avisado || agora < x.ate) continue;
      x.avisado = true;
      const ap = c.aparelhos?.get(x.aparelho);
      const nome = ap?.nome ?? x.aparelho;
      const e = c.estado.get(x.aparelho);
      const offline = e?.online === false && e.offlineDesde ? ` (offline desde ${horaLocal(e.offlineDesde)})` : '';
      this.log.aviso(`[automações] ${c.codigo}: ${nome} canal ${x.canal} não respondeu em 5 s`);
      if (x.automacao) this.registar(c, x.automacao, 'falhou', `Ação falhou: ${nome} não respondeu em 5 s${offline}.`, x.teste ? { teste: true } : {});
    }
    c.esperas = c.esperas.filter((x) => x.expira > agora);
  },

  // ---------------------------------------------------------- pausa manual

  /** Fim da pausa manual do canal (ms) ou null. @param {Cliente} c */
  pausaAtiva(c, idAparelho, n) {
    const k = `${idAparelho}/${n}`;
    const ate = c.pausas[k];
    if (ate && ate > this.relogio.agora()) return ate;
    if (ate) delete c.pausas[k];
    return null;
  },

  /**
   * Canais onde a automação age que estão em pausa manual ("Avaliar agora").
   * `todos`: todos os canais onde age estão em pausa (não faria nada).
   * @param {Cliente} c
   * @param {Automacao} a
   * @returns {{texto: string, todos: boolean}}
   */
  pausasDe(c, a) {
    if (a.ignorar_pausa) return { texto: '', todos: false };
    const canais = new Map();
    percorrerAcoes(a.entao, (x) => {
      if (['ligar', 'desligar', 'alternar', 'luz', 'estore'].includes(x.acao)) canais.set(`${x.aparelho}/${x.canal}`, x);
    });
    const pausadas = [];
    for (const x of canais.values()) {
      const ate = this.pausaAtiva(c, x.aparelho, x.canal);
      if (ate) pausadas.push(`${c.aparelhos?.get(x.aparelho)?.canais.get(x.canal)?.nome ?? `${x.aparelho} canal ${x.canal}`} até ${horaLocal(ate)}`);
    }
    return { texto: pausadas.join(', '), todos: pausadas.length > 0 && pausadas.length === canais.size };
  },

  /** `pausa_manual_min` passou a 0: as pausas em curso acabam. @param {Cliente} c */
  levantarPausas(c) {
    if (!Object.keys(c.pausas).length) return;
    c.pausas = {};
    this.guardar();
  },

  /**
   * Alguém mexeu num canal controlável (botão físico, app): as automações que
   * agem nesse canal ficam em pausa `pausa_manual_min` para esse canal.
   * @param {Cliente} c
   */
  pausaManual(c, ap, canal) {
    const min = this.cfg(c).pausa_manual_min;
    if (!min) return;
    const k = `${ap.id}/${canal.n}`;
    const jaEmPausa = this.pausaAtiva(c, ap.id, canal.n) !== null;
    const ate = this.relogio.agora() + min * 60_000;
    c.pausas[k] = ate;
    this.guardar();
    if (jaEmPausa) return;
    for (const a of c.automacoes ?? []) {
      if (!a.ativa || a.ignorar_pausa || !mexeNoCanal(a, ap.id, canal.n)) continue;
      this.registar(c, a.id, 'pausada', `Pausa manual: ${canal.nome} mexido à mão; em pausa para este canal até ${horaLocal(ate)}.`);
    }
  },

  // --------------------------------------------------------------- registo

  adotarRegisto(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.registo || !eObjeto(v)) return;
    c.registo = v;
    this.guardar();
  },

  /**
   * Junta uma entrada ao registo da automação (as últimas 20).
   * @param {Cliente} c
   * @param {string} id
   * @param {'executada'|'condicao_falsa'|'falhou'|'pausada'|'teste'|'avaliacao'} resultado
   * @param {string} motivo
   * @param {{teste?: boolean, ok?: boolean}} [extra]
   */
  registar(c, id, resultado, motivo, extra = {}) {
    if (!c.registo) c.registo = {};
    const ts = this.agoraIso();
    if (resultado === 'executada') {
      const dia = partesLocais(this.relogio.agora(), FUSO).data;
      const cont = (c.contagens[id] ??= {});
      cont[dia] = (cont[dia] ?? 0) + 1;
    }
    const anterior = c.registo[id];
    c.registo[id] = {
      ultima: ts,
      resultado,
      motivo,
      ...extra,
      semana: this.semana(c, id),
      ultimos: [{ ts, resultado, motivo, ...extra }, ...(anterior?.ultimos ?? [])].slice(0, MAX_REGISTO),
    };
    c.registoSujo = true;
    this.guardar();
  },

  /**
   * "Avaliar agora": a resposta vai só para `ultimos` (resultado "avaliacao");
   * `ultima`/`resultado`/`motivo` continuam a ser os da última execução real
   * (as apps mostram-nos como "Última execução").
   * @param {Cliente} c
   */
  registarAvaliacao(c, id, motivo, ok) {
    if (!c.registo) c.registo = {};
    const ts = this.agoraIso();
    const anterior = c.registo[id] ?? { ultima: null, resultado: null, motivo: null };
    c.registo[id] = {
      ...anterior,
      semana: this.semana(c, id),
      ultimos: [{ ts, resultado: 'avaliacao', motivo, ok }, ...(anterior.ultimos ?? [])].slice(0, MAX_REGISTO),
    };
    c.registoSujo = true;
    this.guardar();
  },

  /** Execuções nos últimos 7 dias (hoje incluído). @param {Cliente} c */
  semana(c, id) {
    const cont = c.contagens[id];
    if (!cont) return 0;
    const hoje = partesLocais(this.relogio.agora(), FUSO).data;
    const limite = somarDias(hoje, -6);
    let n = 0;
    for (const [dia, k] of Object.entries(cont)) {
      if (dia >= limite) n += k;
      else delete cont[dia];
    }
    return n;
  },

  /** Publica `_automacoes/registo` (retido). @param {Cliente} c */
  publicarRegisto(c) {
    c.registoSujo = false;
    const registo = c.registo ?? {};
    for (const [id, r] of Object.entries(registo)) r.semana = this.semana(c, id);
    this.publicar(`domus/${c.codigo}/_automacoes/registo`, textoRegistoLimitado(registo), true);
  },
};
