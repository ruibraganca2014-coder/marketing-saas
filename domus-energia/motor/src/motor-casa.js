// Casa (docs/PROTOCOLO-MQTT-v3.md §1–§2 e §8 "Presença"): configuração
// `_config`, modos `_modo`, máquina de estados do alarme `_alarme`,
// presença `_presenca` e simulação de presença no modo férias.
//
// Métodos misturados na classe Motor (Object.assign no fim de motor.js).

import { fundirConfig, normalizarConfig } from './casa.js';
import { MODOS } from './validacao.js';
import { horasSol } from './sol.js';
import { partesLocais, horaLocal, FUSO } from './tempo.js';
import { NOMES_MODOS } from './relatorio.js';
import { lerJson, eObjeto } from './util.js';

/** @typedef {import('./motor.js').Motor} Motor */
/** @typedef {import('./motor.js').Cliente} Cliente */
/** @typedef {import('./motor.js').Alarme} Alarme */

export const ESTADOS_ALARME = ['desarmado', 'a_armar', 'armado', 'entrada', 'disparado'];
/** Tipo de alarme de cada modo (null = desarmado). */
export const TIPO_DO_MODO = { casa: null, fora: 'total', noite: 'perimetro', ferias: 'total' };
/** Simulação de presença: fim da janela (23:30) e início sem localização (19:00). */
export const SIMULACAO_FIM_MIN = 23 * 60 + 30;
export const SIMULACAO_INICIO_MIN = 19 * 60;
const POR_RE = /^[a-z0-9:_-]{1,60}$/;
const PESSOA_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_PESSOAS = 20;

/** "A", "A e B", "A, B e C". */
export function juntarNomes(nomes) {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

/** @type {ThisType<Motor> & Record<string, Function>} */
export const metodosCasa = {
  // ------------------------------------------------------------ _config

  adotarConfig(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.config || !eObjeto(v)) return;
    c.config = normalizarConfig(v);
    this.log.info(`[config] ${codigo}: configuração adotada da mensagem retida`);
    this.guardar();
  },

  aoConfigSet(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    const r = v === undefined ? { ok: false, erro: 'A configuração não é JSON válido.' } : fundirConfig(v, this.cfg(c));
    if (!r.ok) {
      this.evento(c, { tipo: 'erro', titulo: 'Configuração não guardada', mensagem: r.erro });
      this.publicar(`domus/${codigo}/_config`, this.cfg(c), true);
      return;
    }
    c.config = r.config;
    this.log.info(`[config] ${codigo}: configuração atualizada`);
    this.publicar(`domus/${codigo}/_config`, c.config, true);
    this.guardar();
  },

  // ------------------------------------------------------- modo e alarme

  /** Normaliza um `_alarme` (v2 ou v3) guardado ou retido. @returns {Alarme} */
  normalizarAlarme(v) {
    if (!eObjeto(v)) return { ativo: false, estado: 'desarmado', tipo: null, desde: null, ate: null, ignorados: [], por: null };
    let estado = ESTADOS_ALARME.includes(v.estado) ? v.estado : v.ativo === true ? 'armado' : 'desarmado';
    const ate = (estado === 'a_armar' || estado === 'entrada') && typeof v.ate === 'string' ? v.ate : null;
    if ((estado === 'a_armar' || estado === 'entrada') && !ate) estado = estado === 'a_armar' ? 'armado' : 'disparado';
    const ativo = estado !== 'desarmado';
    return {
      ativo,
      estado,
      tipo: ativo ? (v.tipo === 'perimetro' ? 'perimetro' : 'total') : null,
      desde: typeof v.desde === 'string' ? v.desde : null,
      ate,
      ignorados: ativo && Array.isArray(v.ignorados)
        ? v.ignorados.filter((x) => eObjeto(x) && typeof x.aparelho === 'string' && Number.isInteger(x.canal)).map((x) => ({ aparelho: x.aparelho, canal: x.canal }))
        : [],
      por: typeof v.por === 'string' ? v.por : null,
    };
  },

  normalizarModo(v) {
    return {
      modo: MODOS.includes(v?.modo) ? v.modo : 'casa',
      desde: typeof v?.desde === 'string' ? v.desde : null,
      por: typeof v?.por === 'string' ? v.por : null,
    };
  },

  /** Modo coerente com um alarme da v2 (sem `_modo`). @param {Alarme} a */
  modoDoAlarme(a) {
    return { modo: a.ativo ? (a.tipo === 'perimetro' ? 'noite' : 'fora') : 'casa', desde: a.desde, por: a.por };
  },

  adotarAlarme(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.alarme || !v || typeof v.ativo !== 'boolean') return;
    c.alarme = this.normalizarAlarme(v);
    this.log.info(`[alarme] ${codigo}: estado adotado da mensagem retida (${c.alarme.estado})`);
    this.guardar();
  },

  adotarModo(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.modo || !eObjeto(v) || !MODOS.includes(v.modo)) return;
    c.modo = this.normalizarModo(v);
    this.log.info(`[modo] ${codigo}: modo adotado da mensagem retida (${c.modo.modo})`);
    this.guardar();
  },

  /** @param {Cliente} c */
  publicarAlarme(c) {
    this.publicar(`domus/${c.codigo}/_alarme`, c.alarme, true);
  },

  /** @param {Cliente} c */
  publicarModo(c) {
    this.publicar(`domus/${c.codigo}/_modo`, c.modo, true);
  },

  /** `_alarme/set` da v2: `{"ativo":true}` = modo fora, `{"ativo":false}` = modo casa. */
  aoAlarmeSet(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (!eObjeto(v) || typeof v.ativo !== 'boolean' || (v.forcar !== undefined && typeof v.forcar !== 'boolean')) {
      this.evento(c, { tipo: 'erro', titulo: 'Alarme não alterado', mensagem: 'Pedido inválido: envie {"ativo": true} ou {"ativo": false}.' });
      return;
    }
    const por = typeof v.por === 'string' && POR_RE.test(v.por) ? v.por : 'app';
    if (!c.alarme) c.alarme = this.normalizarAlarme(null);
    if (v.ativo && c.alarme.ativo) {
      // Já está armado (fora, noite ou férias): nada muda.
      this.publicarAlarme(c);
      return;
    }
    this.mudarModo(c, v.ativo ? 'fora' : 'casa', { forcar: v.forcar === true, por });
  },

  aoModoSet(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    const erro = (m) => {
      this.evento(c, { tipo: 'erro', titulo: 'Modo não alterado', mensagem: m });
      if (c.modo) this.publicarModo(c);
    };
    if (!eObjeto(v)) return erro('Pedido inválido: envie {"modo": "casa"|"fora"|"noite"|"ferias"}.');
    for (const k of Object.keys(v)) if (!['modo', 'forcar', 'por'].includes(k)) return erro(`Pedido inválido: campo desconhecido "${k}".`);
    if (!MODOS.includes(v.modo)) return erro(`Modo desconhecido ${JSON.stringify(v.modo ?? null)} (use casa, fora, noite ou ferias).`);
    if (v.forcar !== undefined && typeof v.forcar !== 'boolean') return erro('"forcar" tem de ser true ou false.');
    if (v.por !== undefined && (typeof v.por !== 'string' || !POR_RE.test(v.por))) return erro('"por" inválido (ex.: "app" ou "web").');
    this.mudarModo(c, v.modo, { forcar: v.forcar === true, por: v.por ?? 'app' });
  },

  /** Portas abertas agora (canais `porta` com valor 1). @param {Cliente} c */
  portasAbertas(c) {
    const r = [];
    for (const ap of c.aparelhos?.values() ?? []) {
      for (const canal of ap.canais.values()) {
        if (canal.funcao === 'porta' && this.valorCanal(c, ap.id, canal.n) === 1) r.push({ ap, canal });
      }
    }
    return r;
  },

  /**
   * Muda o modo da casa e arma/desarma o alarme em conformidade.
   * Recusa armar com portas abertas (a não ser com `forcar`).
   * @param {Cliente} c
   * @param {string} novo
   * @param {{forcar?: boolean, por?: string}} [o]
   * @returns {boolean} true se o modo ficou `novo`
   */
  mudarModo(c, novo, o = {}) {
    const forcar = o.forcar === true;
    const por = o.por ?? 'app';
    if (!c.alarme) c.alarme = this.normalizarAlarme(null);
    if (!c.modo) c.modo = this.modoDoAlarme(c.alarme);
    const anterior = c.modo.modo;
    const tipoNovo = TIPO_DO_MODO[novo];
    const al = c.alarme;
    const arma = !!tipoNovo && al.estado === 'desarmado';
    /** @type {{aparelho: string, canal: number}[]} */
    let ignorados = [];
    let abertasNomes = [];
    if (arma) {
      const abertas = this.portasAbertas(c);
      abertasNomes = abertas.map((x) => x.canal.nome);
      if (abertas.length && !forcar) {
        const msg = abertas.length === 1
          ? `Não armado: ${abertasNomes[0]} está aberta.`
          : `Não armado: ${juntarNomes(abertasNomes)} estão abertas.`;
        this.log.info(`[alarme] ${c.codigo}: ${msg}`);
        this.evento(c, { tipo: 'erro', titulo: 'Alarme não armado', mensagem: msg, por });
        this.publicarModo(c);
        this.publicarAlarme(c);
        return false;
      }
      ignorados = abertas.map((x) => ({ aparelho: x.ap.id, canal: x.canal.n }));
    }
    if (novo === anterior && !arma && (tipoNovo === null) === (al.estado === 'desarmado')) {
      this.publicarModo(c);
      this.publicarAlarme(c);
      return true;
    }
    const agora = this.relogio.agora();
    const iso = new Date(agora).toISOString();
    c.modo = { modo: novo, desde: iso, por };
    let detalhe;
    if (!tipoNovo) {
      if (al.estado !== 'desarmado') {
        c.alarme = { ativo: false, estado: 'desarmado', tipo: null, desde: iso, ate: null, ignorados: [], por };
        detalhe = 'Alarme desarmado.';
      }
      c.alarmeGatilho = null;
      this.limparAvisosAlarme(c);
    } else if (arma) {
      const atraso = this.cfg(c).atraso_saida_s;
      c.alarme = {
        ativo: true,
        estado: atraso > 0 ? 'a_armar' : 'armado',
        tipo: tipoNovo,
        desde: iso,
        ate: atraso > 0 ? new Date(agora + atraso * 1000).toISOString() : null,
        ignorados,
        por,
      };
      detalhe = atraso > 0 ? `Alarme a armar: ${atraso} s para sair.` : 'Alarme armado.';
      if (ignorados.length) detalhe += ` Ignorados (abertos): ${juntarNomes(abertasNomes)}.`;
    } else {
      // Já armado (ou disparado): troca só o tipo (ex.: fora → noite).
      c.alarme = { ...al, tipo: al.estado === 'disparado' ? al.tipo : tipoNovo, por };
      detalhe = al.estado === 'disparado' ? 'O alarme continua disparado até ser desarmado.' : `Alarme ${tipoNovo === 'perimetro' ? 'de perímetro (só portas)' : 'total'}.`;
    }
    this.log.info(`[modo] ${c.codigo}: ${anterior} → ${novo} (por ${por}; alarme ${c.alarme.estado})`);
    this.evento(c, { tipo: 'modo', titulo: `Modo ${NOMES_MODOS[novo]}`, mensagem: `Modo ${NOMES_MODOS[novo]} (por ${por}).${detalhe ? ` ${detalhe}` : ''}`, por });
    this.publicarModo(c);
    this.publicarAlarme(c);
    this.guardar();
    if (anterior === 'ferias' && novo !== 'ferias') this.pararSimulacao(c);
    if (novo !== anterior) this.dispararModo(c, novo);
    return true;
  },

  /** @param {Cliente} c */
  limparAvisosAlarme(c) {
    for (const e of c.estado.values()) if (e.avisos?.alarmeOffline) e.avisos.alarmeOffline = false;
  },

  /**
   * Porta/movimento mudou (transição ao vivo): máquina de estados do alarme.
   * @param {Cliente} c
   */
  alarmeTransicao(c, ap, canal, valor) {
    const al = c.alarme;
    if (!al?.ativo || (canal.funcao !== 'porta' && canal.funcao !== 'movimento')) return;
    const i = al.ignorados.findIndex((x) => x.aparelho === ap.id && x.canal === canal.n);
    if (i >= 0) {
      // Porta que estava aberta ao armar (forçado): fechou → passa a estar protegida.
      if (valor === 0) {
        al.ignorados.splice(i, 1);
        this.publicarAlarme(c);
        this.guardar();
      }
      return;
    }
    if (valor !== 1 || al.estado === 'a_armar') return;
    if (canal.funcao === 'movimento' && al.tipo === 'perimetro') return;
    const nome = canal.nome;
    const oque = canal.funcao === 'porta' ? 'Porta aberta' : 'Movimento detetado';
    if (al.estado === 'armado') {
      const atraso = this.cfg(c).atraso_entrada_s;
      if (canal.funcao === 'porta' && canal.entrada && atraso > 0) {
        const agora = this.relogio.agora();
        c.alarme = { ...al, estado: 'entrada', desde: new Date(agora).toISOString(), ate: new Date(agora + atraso * 1000).toISOString() };
        c.alarmeGatilho = { aparelho: ap.id, nome };
        this.log.info(`[alarme] ${c.codigo}: entrada — ${nome} (${atraso} s para desarmar)`);
        this.publicarAlarme(c);
        this.guardar();
        this.evento(
          c,
          { tipo: 'aviso', titulo: 'Desarme o alarme', mensagem: `${nome} aberta. Desarme o alarme nos próximos ${atraso} s.`, aparelho: ap.id },
          true,
          { prioridade: 'default', ignorarSilencio: true },
        );
        return;
      }
    } else if (al.estado === 'entrada') {
      // Durante o atraso de entrada, o caminho de entrada (porta de entrada e
      // movimento) não dispara; outra porta dispara logo.
      if (canal.funcao === 'movimento' || canal.entrada) return;
    }
    this.dispararAlarme(c, ap.id, `Alarme: ${oque.toLowerCase()}`, `${oque}: ${nome}.`);
  },

  /**
   * Alarme disparado: evento `alarme` + notificação urgente. Mantém-se até
   * desarmar; novos sensores voltam a notificar.
   * @param {Cliente} c
   * @param {string|undefined} idAparelho
   */
  dispararAlarme(c, idAparelho, titulo, mensagem) {
    if (c.alarme.estado !== 'disparado') {
      c.alarme = { ...c.alarme, estado: 'disparado', desde: this.agoraIso(), ate: null };
      this.publicarAlarme(c);
      this.guardar();
    }
    this.log.aviso(`[alarme] ${c.codigo}: ${mensagem}`);
    this.evento(c, { tipo: 'alarme', titulo, mensagem, ...(idAparelho ? { aparelho: idAparelho } : {}) }, true);
  },

  /** Fim do atraso de saída (→ armado) e de entrada (→ disparado). @param {Cliente} c */
  verificarTemporizadoresAlarme(c) {
    const al = c.alarme;
    if (!al?.ate) return;
    const agora = this.relogio.agora();
    if (agora < Date.parse(al.ate)) return;
    if (al.estado === 'a_armar') {
      c.alarme = { ...al, estado: 'armado', desde: new Date(agora).toISOString(), ate: null };
      this.log.info(`[alarme] ${c.codigo}: armado`);
      this.publicarAlarme(c);
      this.guardar();
    } else if (al.estado === 'entrada') {
      const g = c.alarmeGatilho;
      this.dispararAlarme(c, g?.aparelho, 'Alarme: entrada sem desarme', `${g?.nome ?? 'Porta de entrada'} aberta e o alarme não foi desarmado a tempo.`);
    } else {
      c.alarme = { ...al, ate: null };
    }
  },

  /**
   * Sensores do alarme offline com o alarme armado → aviso (uma vez por
   * ocorrência). @param {Cliente} c
   */
  verificarSensoresAlarme(c) {
    const al = c.alarme;
    if (!al?.ativo || !c.aparelhos) return;
    const agora = this.relogio.agora();
    for (const ap of c.aparelhos.values()) {
      const relevante = [...ap.canais.values()].some(
        (x) => (x.funcao === 'porta' || (x.funcao === 'movimento' && al.tipo === 'total')) && !al.ignorados.some((i) => i.aparelho === ap.id && i.canal === x.n),
      );
      if (!relevante) continue;
      const e = this.estadoAparelho(c, ap.id);
      const offline = ap.bateria ? !!e.ultimaNoticia && agora - e.ultimaNoticia > 24 * 3_600_000 : e.online === false;
      e.avisos ??= {};
      if (!offline) {
        e.avisos.alarmeOffline = false;
        continue;
      }
      if (e.avisos.alarmeOffline) continue;
      e.avisos.alarmeOffline = true;
      this.guardar();
      this.evento(
        c,
        { tipo: 'aviso', titulo: 'Sensor do alarme offline', mensagem: `${ap.nome} está offline com o alarme armado: não vai detetar nada até voltar.`, aparelho: ap.id },
        true,
      );
    }
  },

  /** Trabalho do minuto da casa. @param {Cliente} c */
  minutoCasa(c, ms, local) {
    this.verificarSensoresAlarme(c);
    this.simular(c, ms, local);
  },

  // ---------------------------------------------------------- presença

  adotarPresenca(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.presenca || !eObjeto(v) || !eObjeto(v.pessoas)) return;
    const pessoas = {};
    for (const [id, p] of Object.entries(v.pessoas)) {
      if (PESSOA_RE.test(id) && eObjeto(p) && typeof p.em_casa === 'boolean') {
        pessoas[id] = { nome: typeof p.nome === 'string' ? p.nome : id, em_casa: p.em_casa, desde: typeof p.desde === 'string' ? p.desde : null };
      }
    }
    c.presenca = { pessoas, alguem: Object.values(pessoas).some((p) => p.em_casa) };
    this.guardar();
  },

  /**
   * `_presenca/set` (app): {"pessoa","nome","em_casa"} ou {"pessoa","remover":true}.
   * Pedidos inválidos são só registados (vêm da app em segundo plano).
   */
  aoPresencaSet(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    const invalido = (m) => this.log.aviso(`[presença] ${codigo}: pedido ignorado — ${m}`);
    if (!eObjeto(v)) return invalido('não é um objeto JSON');
    for (const k of Object.keys(v)) if (!['pessoa', 'nome', 'em_casa', 'remover'].includes(k)) return invalido(`campo desconhecido "${k}"`);
    if (typeof v.pessoa !== 'string' || !PESSOA_RE.test(v.pessoa)) return invalido('"pessoa" inválida');
    if (v.nome !== undefined && (typeof v.nome !== 'string' || v.nome.length > 40)) return invalido('"nome" inválido');
    if (v.remover !== undefined && typeof v.remover !== 'boolean') return invalido('"remover" inválido');
    if (v.remover !== true && typeof v.em_casa !== 'boolean') return invalido('falta "em_casa"');
    if (!c.presenca) c.presenca = { pessoas: {}, alguem: false };
    const antes = c.presenca.alguem;
    const pessoas = c.presenca.pessoas;
    if (v.remover === true) {
      delete pessoas[v.pessoa];
    } else {
      const p = pessoas[v.pessoa];
      if (!p && Object.keys(pessoas).length >= MAX_PESSOAS) return invalido(`máximo de ${MAX_PESSOAS} pessoas`);
      const nome = v.nome?.trim() || p?.nome || v.pessoa;
      pessoas[v.pessoa] = !p || p.em_casa !== v.em_casa ? { nome, em_casa: v.em_casa, desde: this.agoraIso() } : { ...p, nome };
    }
    c.presenca.alguem = Object.values(pessoas).some((p) => p.em_casa);
    this.publicar(`domus/${codigo}/_presenca`, c.presenca, true);
    this.guardar();
    if (!antes && c.presenca.alguem) this.dispararPresenca(c, 'chega_primeiro');
    if (antes && !c.presenca.alguem) this.dispararPresenca(c, 'sai_ultimo');
  },

  // ------------------------------------------- simulação de presença (férias)

  /** Canais usados na simulação (`simular: true`, nunca cargas perigosas). @param {Cliente} c */
  canaisSimulacao(c) {
    const r = [];
    for (const ap of c.aparelhos?.values() ?? []) {
      for (const canal of ap.canais.values()) {
        if (canal.simular && canal.carga !== 'perigosa' && (canal.funcao === 'interruptor' || canal.funcao === 'luz')) r.push({ ap, canal });
      }
    }
    return r;
  },

  /** Início da janela da simulação (minutos locais): pôr do sol, ou 19:00 sem localização. */
  inicioSimulacao(c, data) {
    const local = this.cfg(c).local;
    if (!local) return SIMULACAO_INICIO_MIN;
    const por = horasSol(data, local).por;
    return por === null ? SIMULACAO_INICIO_MIN : partesLocais(por, FUSO).minutos;
  },

  /**
   * Modo férias: entre o pôr do sol (ou 19:00) e as 23:30, as luzes marcadas
   * `simular` ligam e desligam em momentos aleatórios; às 23:30 fica tudo
   * desligado. Corre uma vez por minuto.
   * @param {Cliente} c
   * @param {number} ms início do minuto
   */
  simular(c, ms, local) {
    const sim = c.simulacao;
    if (c.modo?.modo !== 'ferias' || !c.aparelhos) {
      if (Object.keys(sim.canais).length) this.pararSimulacao(c);
      return;
    }
    const inicio = this.inicioSimulacao(c, local.data);
    const dentro = local.minutos >= inicio && local.minutos < SIMULACAO_FIM_MIN;
    const canais = this.canaisSimulacao(c);
    const chaves = new Set(canais.map(({ ap, canal }) => `${ap.id}/${canal.n}`));
    let mudou = false;
    for (const k of Object.keys(sim.canais)) {
      if (!chaves.has(k)) {
        delete sim.canais[k];
        mudou = true;
      }
    }
    const min = 60_000;
    for (const { ap, canal } of canais) {
      const k = `${ap.id}/${canal.n}`;
      let st = sim.canais[k];
      if (!dentro) {
        if (st?.ligado) {
          this.log.info(`[simulação] ${c.codigo}: fim da noite — desligar ${canal.nome}`);
          this.enviarLigar(c, ap, canal.n, false);
        }
        if (st) {
          delete sim.canais[k];
          mudou = true;
        }
        continue;
      }
      if (!st) {
        // Cada luz começa num momento diferente (até 30 min depois do início).
        st = { proxima: ms + Math.floor(this.aleatorio() * 30) * min, ligado: false };
        sim.canais[k] = st;
        mudou = true;
      }
      if (ms < st.proxima) continue;
      st.ligado = !st.ligado;
      // Acesa 15–60 min; apagada 10–60 min.
      st.proxima = ms + (st.ligado ? 15 + Math.floor(this.aleatorio() * 46) : 10 + Math.floor(this.aleatorio() * 51)) * min;
      mudou = true;
      this.log.info(`[simulação] ${c.codigo}: ${st.ligado ? 'ligar' : 'desligar'} ${canal.nome} (próxima mudança às ${horaLocal(st.proxima)})`);
      this.enviarLigar(c, ap, canal.n, st.ligado);
    }
    if (mudou) this.guardar();
  },

  /** Termina a simulação: desliga o que ela ligou. @param {Cliente} c */
  pararSimulacao(c) {
    for (const [k, st] of Object.entries(c.simulacao.canais)) {
      if (!st.ligado) continue;
      const [id, n] = k.split('/');
      const ap = c.aparelhos?.get(id);
      if (ap?.canais.has(Number(n))) this.enviarLigar(c, ap, Number(n), false);
    }
    c.simulacao = { canais: {} };
    this.guardar();
  },
};
