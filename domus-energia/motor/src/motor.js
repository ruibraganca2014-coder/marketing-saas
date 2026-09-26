// Núcleo do motor de regras da Domus Energia.
//
// Não sabe nada de rede nem de disco: recebe tudo por injeção (publicar,
// notificar, relógio, armazenamento), o que permite testá-lo com um relógio
// falso. O `index.js` liga-o ao MQTT, ao ntfy/FCM e ao ficheiro de estado.
//
// Contrato: docs/PROTOCOLO-MQTT.md (v1) e docs/PROTOCOLO-MQTT-v2.md (v2).

import {
  CLIENTE_RE,
  normalizarAparelhos,
  nomeCanal,
  comandosLigar,
  comandosEstore,
} from './aparelhos.js';
import { validarAutomacoes, validarAutomacao } from './validacao.js';
import { partesLocais, dentroDoIntervalo, FUSO } from './tempo.js';

/** @typedef {import('./aparelhos.js').Aparelho} Aparelho */
/** @typedef {import('./validacao.js').Automacao} Automacao */

export const MAX_HISTORICO = 100;
export const MAX_TOKENS_FCM = 10;
export const BATERIA_FRACA = 15;
export const SILENCIO_MS = 24 * 3600 * 1000;
/** Máximo de execuções de uma automação por minuto (proteção contra ciclos). */
export const MAX_EXECUCOES_MINUTO = 20;

/**
 * @typedef {object} Evento
 * @property {string} ts
 * @property {'alarme'|'sensor'|'automacao'|'aviso'|'erro'} tipo
 * @property {string} titulo
 * @property {string} mensagem
 * @property {string} [aparelho]
 */

/**
 * @typedef {object} PedidoNotificacao
 * @property {string} cliente
 * @property {string|null} topicoNtfy  null = cliente sem tópico ntfy (só FCM)
 * @property {string[]} tokensFcm
 * @property {Evento['tipo']} tipo
 * @property {string} titulo
 * @property {string} mensagem
 * @property {'urgent'|'high'|'default'} prioridade
 * @property {string[]} tags
 */

/**
 * @typedef {object} Armazenamento
 * @property {() => any} carregar                    devolve o estado guardado (ou null)
 * @property {(obter: () => any) => void} pedirGravacao  pede uma gravação (pode ser adiada)
 */

/**
 * @typedef {object} OpcoesMotor
 * @property {(topico: string, payload: string, opcoes?: {retain?: boolean}) => void} publicar
 * @property {(pedido: PedidoNotificacao) => (Promise<{tokensInvalidos?: string[]}|void>|void)} [notificar]
 * @property {{agora: () => number}} [relogio]
 * @property {Armazenamento} [armazenamento]
 * @property {{info: Function, aviso: Function, erro: Function}} [log]
 * @property {number} [esperaArranqueMs] tempo a aguardar pelas mensagens retidas antes de publicar o estado
 */

/**
 * @typedef {object} EstadoCanal
 * @property {number} [valor]
 * @property {number} [brilho]
 * @property {number} [ultimaMudanca]
 */

/**
 * @typedef {object} EstadoAparelho
 * @property {boolean} [online]
 * @property {number} [ultimaNoticia]
 * @property {boolean} [avisoSilencio]
 * @property {string} [avisoBateriaDia]
 * @property {number} [potenciaW]
 * @property {number} [tensaoV]
 * @property {number} [correnteA]
 * @property {number} [energiaWh]
 * @property {Map<number, EstadoCanal>} canais
 */

/**
 * @typedef {object} Cliente
 * @property {string} codigo
 * @property {Map<string, Aparelho>|null} aparelhos
 * @property {Map<string, EstadoAparelho>} estado
 * @property {{ativo: boolean, desde: string|null}|null} alarme       null = ainda desconhecido
 * @property {Automacao[]|null} automacoes                             null = ainda desconhecido
 * @property {Evento[]|null} historico                                 null = ainda desconhecido
 * @property {string|null} topicoNtfy   lido do `_ntfy` retido (criado pelo domus.sh)
 * @property {boolean} avisouSemNtfy
 * @property {string[]} tokensFcm
 * @property {Record<string, string>} horaDisparos  id da automação → "data hora" do último disparo
 */

const logPadrao = {
  info: (...a) => console.log(...a),
  aviso: (...a) => console.warn(...a),
  erro: (...a) => console.error(...a),
};

/** Converte o payload (Buffer/string) em texto. */
const texto = (p) => (typeof p === 'string' ? p : Buffer.from(p ?? '').toString('utf8')).trim();

/** JSON.parse que nunca lança. */
function lerJson(p) {
  try {
    return JSON.parse(texto(p));
  } catch {
    return undefined;
  }
}

/** Número finito a partir de texto ("123.4") ou undefined. */
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

export class Motor {
  /** @param {OpcoesMotor} opcoes */
  constructor(opcoes) {
    this.publicarBruto = opcoes.publicar;
    this.notificador = opcoes.notificar ?? (() => {});
    this.relogio = opcoes.relogio ?? { agora: () => Date.now() };
    this.armazenamento = opcoes.armazenamento ?? null;
    this.log = opcoes.log ?? logPadrao;
    this.esperaArranqueMs = opcoes.esperaArranqueMs ?? 3000;

    /** @type {Map<string, Cliente>} */
    this.clientes = new Map();
    /** Reversões pendentes de `durante_s` (persistidas). */
    /** @type {{cliente: string, aparelho: string, canal: number, ligar: boolean, quando: number, automacao: string}[]} */
    this.reversoes = [];
    /** Estado das automações de potência: "cliente/id" → {desde, disparado}. */
    /** @type {Map<string, {desde: number, disparado: boolean}>} */
    this.potencia = new Map();
    /** Execuções recentes por automação (limite anti-ciclo). */
    /** @type {Map<string, number[]>} */
    this.execucoes = new Map();
    /** Clientes cujo estado retido ainda tem de ser (re)publicado. */
    /** @type {Set<string>} */
    this.porSincronizar = new Set();
    this.ligadoEm = null;
    /** Último minuto (UTC, em minutos desde 1970) já tratado. */
    this.ultimoMinuto = null;

    this.carregar();
  }

  // ---------------------------------------------------------------- estado

  /** @param {string} codigo @returns {Cliente} */
  cliente(codigo) {
    let c = this.clientes.get(codigo);
    if (!c) {
      c = {
        codigo,
        aparelhos: null,
        estado: new Map(),
        alarme: null,
        automacoes: null,
        historico: null,
        topicoNtfy: null,
        avisouSemNtfy: false,
        tokensFcm: [],
        horaDisparos: {},
      };
      this.clientes.set(codigo, c);
    }
    return c;
  }

  /** @param {Cliente} c @param {string} id @returns {EstadoAparelho} */
  estadoAparelho(c, id) {
    let e = c.estado.get(id);
    if (!e) {
      e = { canais: new Map() };
      c.estado.set(id, e);
    }
    return e;
  }

  carregar() {
    let dados = null;
    try {
      dados = this.armazenamento?.carregar() ?? null;
    } catch (e) {
      this.log.erro(`[estado] não foi possível ler o estado guardado: ${e.message}`);
    }
    if (!dados || typeof dados !== 'object') return;
    for (const [codigo, d] of Object.entries(dados.clientes ?? {})) {
      if (!CLIENTE_RE.test(codigo) || !d || typeof d !== 'object') continue;
      const c = this.cliente(codigo);
      if (d.alarme && typeof d.alarme.ativo === 'boolean') c.alarme = { ativo: d.alarme.ativo, desde: d.alarme.desde ?? null };
      if (Array.isArray(d.automacoes)) c.automacoes = d.automacoes;
      if (Array.isArray(d.historico)) c.historico = d.historico.slice(0, MAX_HISTORICO);
      if (Array.isArray(d.tokensFcm)) c.tokensFcm = d.tokensFcm.filter((t) => typeof t === 'string').slice(-MAX_TOKENS_FCM);
      if (d.horaDisparos && typeof d.horaDisparos === 'object') c.horaDisparos = { ...d.horaDisparos };
      for (const [id, e] of Object.entries(d.aparelhos ?? {})) {
        const ea = this.estadoAparelho(c, id);
        if (typeof e.ultimaNoticia === 'number') ea.ultimaNoticia = e.ultimaNoticia;
        if (e.avisoSilencio === true) ea.avisoSilencio = true;
        if (typeof e.avisoBateriaDia === 'string') ea.avisoBateriaDia = e.avisoBateriaDia;
      }
    }
    if (Array.isArray(dados.reversoes)) {
      this.reversoes = dados.reversoes.filter(
        (r) => r && CLIENTE_RE.test(r.cliente) && typeof r.aparelho === 'string' && Number.isInteger(r.canal) && typeof r.quando === 'number',
      );
    }
    this.log.info(`[estado] carregado: ${this.clientes.size} cliente(s), ${this.reversoes.length} reversão(ões) pendente(s)`);
  }

  /** Estado persistente, serializável em JSON. */
  exportar() {
    const clientes = {};
    for (const c of this.clientes.values()) {
      const aparelhos = {};
      for (const [id, e] of c.estado) {
        if (e.ultimaNoticia || e.avisoSilencio || e.avisoBateriaDia) {
          aparelhos[id] = { ultimaNoticia: e.ultimaNoticia, avisoSilencio: e.avisoSilencio, avisoBateriaDia: e.avisoBateriaDia };
        }
      }
      clientes[c.codigo] = {
        alarme: c.alarme,
        automacoes: c.automacoes,
        historico: c.historico,
        tokensFcm: c.tokensFcm,
        horaDisparos: c.horaDisparos,
        aparelhos,
      };
    }
    return { versao: 1, clientes, reversoes: this.reversoes };
  }

  guardar() {
    try {
      this.armazenamento?.pedirGravacao(() => this.exportar());
    } catch (e) {
      this.log.erro(`[estado] erro ao guardar: ${e.message}`);
    }
  }

  publicar(topico, payload, retain = false) {
    try {
      this.publicarBruto(topico, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain });
    } catch (e) {
      this.log.erro(`[mqtt] erro ao publicar em ${topico}: ${e.message}`);
    }
  }

  // --------------------------------------------------------------- arranque

  /** Chamado a cada (re)ligação ao broker, depois de subscrever `domus/#`. */
  aoLigar() {
    this.ligadoEm = this.relogio.agora();
    for (const codigo of this.clientes.keys()) this.porSincronizar.add(codigo);
  }

  /**
   * Publica (retido) o estado que pertence ao motor: `_alarme`, `_automacoes`
   * e `_historico`. Só depois de receber as mensagens retidas, para
   * poder adotar o que já lá estava se o estado local se tiver perdido.
   * @param {Cliente} c
   */
  sincronizar(c) {
    if (!c.alarme) c.alarme = { ativo: false, desde: null };
    if (!c.automacoes) c.automacoes = [];
    if (!c.historico) c.historico = [];
    const base = `domus/${c.codigo}`;
    this.publicar(`${base}/_alarme`, c.alarme, true);
    this.publicar(`${base}/_automacoes`, c.automacoes, true);
    this.publicar(`${base}/_historico`, c.historico, true);
    this.guardar();
  }

  // -------------------------------------------------------------- mensagens

  /**
   * Trata uma mensagem MQTT. Nunca lança.
   * @param {string} topico
   * @param {Buffer|string} payload
   * @param {boolean} [retida] mensagem retida entregue ao subscrever (valor antigo)
   */
  aoMensagem(topico, payload, retida = false) {
    try {
      this.tratarMensagem(topico, payload, retida);
    } catch (e) {
      this.log.erro(`[mqtt] erro ao tratar ${topico}: ${e.stack ?? e.message}`);
    }
  }

  tratarMensagem(topico, payload, retida) {
    const partes = topico.split('/');
    if (partes[0] !== 'domus' || partes.length < 3) return;
    const codigo = partes[1];
    if (!CLIENTE_RE.test(codigo)) return;
    const resto = partes.slice(2).join('/');

    if (resto.startsWith('_')) {
      switch (resto) {
        case '_aparelhos':
          return this.aoAparelhos(codigo, payload);
        case '_alarme':
          return retida && this.adotarAlarme(codigo, payload);
        case '_alarme/set':
          return !retida && this.aoAlarmeSet(codigo, payload);
        case '_automacoes':
          return retida && this.adotarAutomacoes(codigo, payload);
        case '_automacoes/set':
          return !retida && this.aoAutomacoesSet(codigo, payload);
        case '_automacoes/admin':
          return !retida && this.aoAutomacoesAdmin(codigo, payload);
        case '_historico':
          return retida && this.adotarHistorico(codigo, payload);
        case '_ntfy':
          return this.aoNtfy(codigo, payload);
        case '_fcm/registar':
          return !retida && this.aoFcm(codigo, payload);
        default:
          return; // _eventos e outros: publicados por nós ou desconhecidos
      }
    }

    const c = this.clientes.get(codigo);
    const ap = c?.aparelhos?.get(partes[2]);
    if (!c || !ap) return;
    const sub = partes.slice(3).join('/');
    if (ap.tipo === 'openbeken') this.aoOpenBeken(c, ap, sub, payload, retida);
    else this.aoShelly(c, ap, sub, payload, retida);
  }

  aoAparelhos(codigo, payload) {
    const lista = lerJson(payload);
    if (lista === undefined) {
      this.log.aviso(`[aparelhos] ${codigo}: _aparelhos não é JSON válido; ignorado`);
      return;
    }
    const { aparelhos, rejeitados } = normalizarAparelhos(lista);
    for (const r of rejeitados) this.log.aviso(`[aparelhos] ${codigo}: ${r}`);
    const c = this.cliente(codigo);
    const novo = c.aparelhos === null;
    c.aparelhos = aparelhos;
    this.log.info(`[aparelhos] ${codigo}: ${aparelhos.size} aparelho(s)`);
    if (novo) this.porSincronizar.add(codigo);
  }

  adotarAlarme(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.alarme || !v || typeof v.ativo !== 'boolean') return;
    c.alarme = { ativo: v.ativo, desde: typeof v.desde === 'string' ? v.desde : null };
    this.log.info(`[alarme] ${codigo}: estado adotado da mensagem retida (${v.ativo ? 'ativo' : 'desligado'})`);
    this.guardar();
  }

  adotarAutomacoes(codigo, payload) {
    const c = this.cliente(codigo);
    if (c.automacoes) return;
    const v = validarAutomacoes(lerJson(payload), { aparelhos: null, admin: true, verificarAparelhos: false });
    if (!v.ok) return;
    c.automacoes = v.lista;
    this.log.info(`[automações] ${codigo}: ${v.lista.length} automação(ões) adotada(s) da mensagem retida`);
    this.guardar();
  }

  adotarHistorico(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.historico || !Array.isArray(v)) return;
    c.historico = v.filter((e) => e && typeof e === 'object' && typeof e.tipo === 'string').slice(0, MAX_HISTORICO);
    this.guardar();
  }

  /**
   * `_ntfy` (retido, publicado pelo domus.sh):
   * {"url":"https://ntfy.HOST/domus-joao-…","servidor":"https://ntfy.HOST","topico":"domus-joao-…"}.
   * O motor só lê o tópico; nunca o gera nem o publica. Mensagem vazia = apagado.
   */
  aoNtfy(codigo, payload) {
    const c = this.cliente(codigo);
    if (texto(payload) === '') {
      c.topicoNtfy = null;
      return;
    }
    const v = lerJson(payload);
    let topico = v && typeof v.topico === 'string' ? v.topico : undefined;
    if (!topico && v && typeof v.url === 'string') topico = v.url.replace(/\/+$/, '').split('/').pop();
    const re = new RegExp(`^domus-${codigo}-[A-Za-z0-9_-]{8,64}$`);
    if (!topico || !re.test(topico)) {
      this.log.aviso(`[ntfy] ${codigo}: _ntfy inválido; ignorado`);
      return;
    }
    if (c.topicoNtfy !== topico) this.log.info(`[ntfy] ${codigo}: tópico definido`);
    c.topicoNtfy = topico;
    c.avisouSemNtfy = false;
  }

  // ----------------------------------------------------------------- alarme

  aoAlarmeSet(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (!v || typeof v !== 'object' || typeof v.ativo !== 'boolean') {
      this.evento(c, { tipo: 'erro', titulo: 'Alarme não alterado', mensagem: 'Pedido inválido: envie {"ativo": true} ou {"ativo": false}.' });
      return;
    }
    const anterior = c.alarme;
    if (!anterior || anterior.ativo !== v.ativo) {
      c.alarme = { ativo: v.ativo, desde: new Date(this.relogio.agora()).toISOString() };
      this.log.info(`[alarme] ${codigo}: ${v.ativo ? 'ligado' : 'desligado'}`);
    }
    this.publicar(`domus/${codigo}/_alarme`, c.alarme, true);
    this.guardar();
  }

  // ------------------------------------------------------------- automações

  aoAutomacoesSet(codigo, payload) {
    const c = this.cliente(codigo);
    const lista = lerJson(payload);
    const v =
      lista === undefined
        ? { ok: false, erro: 'A lista de automações não é JSON válido.' }
        : validarAutomacoes(lista, { aparelhos: c.aparelhos, existentes: c.automacoes ?? [] });
    if (!v.ok) {
      this.log.aviso(`[automações] ${codigo}: rejeitadas — ${v.erro}`);
      this.evento(c, { tipo: 'erro', titulo: 'Automações não guardadas', mensagem: v.erro });
      // Republica a lista em vigor para a app/site voltarem ao estado real.
      this.publicar(`domus/${codigo}/_automacoes`, c.automacoes ?? [], true);
      return;
    }
    this.definirAutomacoes(c, v.lista);
  }

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
    let nova;
    if (p.op === 'guardar') {
      const itens = Array.isArray(p.automacoes) ? p.automacoes : p.automacao ? [p.automacao] : null;
      if (!itens || itens.length === 0) return responder(false, 'Falta "automacao" ou "automacoes".');
      nova = [...atuais];
      try {
        itens.forEach((item, i) => {
          const a = validarAutomacao(item, i, c.aparelhos, { bloqueadaPorOmissao: true });
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
    const v = validarAutomacoes(nova, { aparelhos: c.aparelhos, admin: true });
    if (!v.ok) return responder(false, v.erro);
    this.definirAutomacoes(c, v.lista);
    responder(true);
  }

  /** @param {Cliente} c @param {Automacao[]} lista */
  definirAutomacoes(c, lista) {
    c.automacoes = lista;
    const ids = new Set(lista.map((a) => a.id));
    for (const chave of this.potencia.keys()) {
      const [cod, id] = chave.split('/');
      if (cod === c.codigo && !ids.has(id)) this.potencia.delete(chave);
    }
    for (const id of Object.keys(c.horaDisparos)) if (!ids.has(id)) delete c.horaDisparos[id];
    this.log.info(`[automações] ${c.codigo}: ${lista.length} automação(ões) guardada(s)`);
    this.publicar(`domus/${c.codigo}/_automacoes`, lista, true);
    this.guardar();
  }

  // ---------------------------------------------------------------- aparelhos

  /** Marca notícias de um aparelho (não conta valores retidos nem "offline"). */
  noticia(c, ap, retida) {
    if (retida) return;
    const e = this.estadoAparelho(c, ap.id);
    e.ultimaNoticia = this.relogio.agora();
    e.online = true;
    if (e.avisoSilencio) {
      e.avisoSilencio = false;
      this.guardar();
    }
  }

  aoOpenBeken(c, ap, sub, payload, retida) {
    const e = this.estadoAparelho(c, ap.id);
    const t = texto(payload);
    if (sub === 'connected') {
      e.online = t === 'online';
      if (e.online) this.noticia(c, ap, retida);
      return;
    }
    let m = /^(\d+)\/get$/.exec(sub);
    if (m) {
      const n = Number(m[1]);
      const v = numero(t);
      if (v === undefined || !ap.canais.has(n)) return;
      this.noticia(c, ap, retida);
      this.atualizarCanal(c, ap, n, v, retida);
      return;
    }
    if (sub === 'led_dimmer/get') {
      const v = numero(t);
      const canal = [...ap.canais.values()].find((x) => x.funcao === 'luz');
      if (v === undefined || !canal) return;
      this.noticia(c, ap, retida);
      this.canalEstado(c, ap.id, canal.n).brilho = v;
      return;
    }
    m = /^(power|voltage|current|energycounter)\/get$/.exec(sub);
    if (m) {
      const v = numero(t);
      if (v === undefined) return;
      this.noticia(c, ap, retida);
      if (m[1] === 'power') this.atualizarPotencia(c, ap, v, retida);
      else if (m[1] === 'voltage') e.tensaoV = v;
      else if (m[1] === 'current') e.correnteA = v;
      else e.energiaWh = v;
    }
  }

  aoShelly(c, ap, sub, payload, retida) {
    const e = this.estadoAparelho(c, ap.id);
    if (sub === 'online') {
      e.online = texto(payload) === 'true';
      if (e.online) this.noticia(c, ap, retida);
      return;
    }
    const m = /^status\/(switch|input|cover|light|devicepower):(\d+)$/.exec(sub);
    if (!m) return;
    const j = lerJson(payload);
    if (!j || typeof j !== 'object') return;
    const id = Number(m[2]);
    const n = id + 1;
    this.noticia(c, ap, retida);
    switch (m[1]) {
      case 'switch':
        if (ap.canais.has(n) && typeof j.output === 'boolean') this.atualizarCanal(c, ap, n, j.output ? 1 : 0, retida);
        if (id === 0) {
          if (numero(j.voltage) !== undefined) e.tensaoV = numero(j.voltage);
          if (numero(j.current) !== undefined) e.correnteA = numero(j.current);
          if (numero(j.aenergy?.total) !== undefined) e.energiaWh = numero(j.aenergy.total);
          if (numero(j.apower) !== undefined) this.atualizarPotencia(c, ap, numero(j.apower), retida);
        }
        break;
      case 'input':
        if (ap.canais.has(n) && typeof j.state === 'boolean') this.atualizarCanal(c, ap, n, j.state ? 1 : 0, retida);
        break;
      case 'cover': {
        const pos = numero(j.current_pos);
        if (ap.canais.has(n) && pos !== undefined) this.atualizarCanal(c, ap, n, pos, retida);
        break;
      }
      case 'light':
        if (ap.canais.has(n) && typeof j.output === 'boolean') this.atualizarCanal(c, ap, n, j.output ? 1 : 0, retida);
        if (ap.canais.has(n) && numero(j.brightness) !== undefined) this.canalEstado(c, ap.id, n).brilho = numero(j.brightness);
        break;
      case 'devicepower': {
        const pct = numero(j.battery?.percent);
        const canal = [...ap.canais.values()].find((x) => x.funcao === 'bateria');
        if (pct !== undefined && canal) this.atualizarCanal(c, ap, canal.n, pct, retida);
        break;
      }
    }
  }

  canalEstado(c, idAparelho, n) {
    const e = this.estadoAparelho(c, idAparelho);
    let ce = e.canais.get(n);
    if (!ce) {
      ce = {};
      e.canais.set(n, ce);
    }
    return ce;
  }

  /**
   * Novo valor de um canal. Só há "transição" (alarme, automações) quando o
   * valor muda e a mensagem não é retida — o primeiro valor retido recebido
   * no arranque serve apenas de referência.
   */
  atualizarCanal(c, ap, n, valor, retida) {
    const canal = ap.canais.get(n);
    if (!canal) return;
    const ce = this.canalEstado(c, ap.id, n);
    const anterior = ce.valor;
    ce.valor = valor;
    if (canal.funcao === 'bateria') {
      this.verificarBateria(c, ap, valor);
      return;
    }
    if (retida) return;
    if (anterior === valor) {
      // Sensor de movimento que volta a dizer "1": ainda há gente — prolonga
      // as luzes ligadas por automações deste sensor (temporizador de ocupação).
      if (canal.funcao === 'movimento') this.prolongar(c, ap, canal, valor);
      return;
    }
    ce.ultimaMudanca = this.relogio.agora();
    this.cancelarSeAlteradoPorOutro(c, ap, n, valor);
    this.aoTransicao(c, ap, canal, valor);
  }

  /**
   * Um canal com reversão `durante_s` pendente mudou para um valor diferente
   * do que o motor lá pôs: alguém mexeu à mão (ou outra app). A reversão é
   * cancelada — o motor não desliga o que o utilizador decidiu.
   */
  cancelarSeAlteradoPorOutro(c, ap, n, valor) {
    const antes = this.reversoes.length;
    this.reversoes = this.reversoes.filter((r) => {
      if (r.cliente !== c.codigo || r.aparelho !== ap.id || r.canal !== n) return true;
      const posPeloMotor = r.ligar ? 0 : 1;
      return valor === posPeloMotor;
    });
    if (this.reversoes.length !== antes) {
      this.log.info(`[automações] ${c.codigo}: ${ap.id} canal ${n} alterado por outra via; reversão durante_s cancelada`);
      this.guardar();
    }
  }

  /** Recomeça a contagem `durante_s` das automações disparadas por este sensor. */
  prolongar(c, ap, canal, valor) {
    const agora = this.relogio.agora();
    let mudou = false;
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (!a.ativa || q.tipo !== 'sensor' || q.aparelho !== ap.id || q.canal !== canal.n || q.valor !== valor) continue;
      for (const r of this.reversoes) {
        if (r.cliente !== c.codigo || r.automacao !== a.id) continue;
        const acao = a.entao.find((x) => x.aparelho === r.aparelho && x.canal === r.canal && x.durante_s);
        if (!acao) continue;
        r.quando = Math.max(r.quando, agora + acao.durante_s * 1000);
        mudou = true;
      }
    }
    if (mudou) this.guardar();
  }

  aoTransicao(c, ap, canal, valor) {
    const nome = nomeCanal(ap, canal.n);
    if (canal.funcao === 'porta') {
      this.evento(c, { tipo: 'sensor', titulo: valor ? 'Porta aberta' : 'Porta fechada', mensagem: nome, aparelho: ap.id }, false);
    }
    if (c.alarme?.ativo && valor === 1 && (canal.funcao === 'porta' || canal.funcao === 'movimento')) {
      const oque = canal.funcao === 'porta' ? 'Porta aberta' : 'Movimento detetado';
      this.log.aviso(`[alarme] ${c.codigo}: ${oque} — ${nome}`);
      this.evento(c, { tipo: 'alarme', titulo: `Alarme: ${oque.toLowerCase()}`, mensagem: `${oque}: ${nome}.`, aparelho: ap.id }, true);
    }
    for (const a of c.automacoes ?? []) {
      const q = a.quando;
      if (q.tipo === 'sensor' && q.aparelho === ap.id && q.canal === canal.n && q.valor === valor) {
        this.executar(c, a, `${nome} = ${valor}`);
      }
    }
  }

  verificarBateria(c, ap, pct) {
    if (pct >= BATERIA_FRACA) return;
    const e = this.estadoAparelho(c, ap.id);
    const hoje = partesLocais(this.relogio.agora(), FUSO).data;
    if (e.avisoBateriaDia === hoje) return;
    e.avisoBateriaDia = hoje;
    this.evento(c, { tipo: 'aviso', titulo: 'Bateria fraca', mensagem: `${ap.nome}: bateria a ${Math.round(pct)} %. Substitua as pilhas.`, aparelho: ap.id }, true);
  }

  atualizarPotencia(c, ap, w, retida) {
    this.estadoAparelho(c, ap.id).potenciaW = w;
    if (retida) return; // valor antigo: não começa a contar tempo
    const agora = this.relogio.agora();
    for (const a of c.automacoes ?? []) {
      if (a.quando.tipo !== 'potencia' || a.quando.aparelho !== ap.id) continue;
      const chave = `${c.codigo}/${a.id}`;
      if (w > a.quando.acima_w) {
        if (!this.potencia.has(chave)) this.potencia.set(chave, { desde: agora, disparado: false });
      } else {
        this.potencia.delete(chave);
      }
    }
    this.verificarPotencia(c);
  }

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
  }

  // ------------------------------------------------------------------ FCM

  aoFcm(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (!v || typeof v.token !== 'string' || v.token.length < 20 || v.token.length > 4096) {
      this.log.aviso(`[fcm] ${codigo}: registo inválido ignorado`);
      return;
    }
    c.tokensFcm = c.tokensFcm.filter((t) => t !== v.token);
    if (v.remover !== true) {
      c.tokensFcm.push(v.token);
      if (c.tokensFcm.length > MAX_TOKENS_FCM) c.tokensFcm = c.tokensFcm.slice(-MAX_TOKENS_FCM);
    }
    this.log.info(`[fcm] ${codigo}: ${v.remover === true ? 'token removido' : 'token registado'} (${c.tokensFcm.length} no total)`);
    this.guardar();
  }

  // ------------------------------------------------------------- execução

  /** Condições `se` (todas têm de ser verdadeiras). */
  condicoesOk(c, a) {
    const se = a.se;
    if (!se) return true;
    if (se.alarme !== undefined && (c.alarme?.ativo ?? false) !== se.alarme) return false;
    if (se.entre) {
      const { minutos } = partesLocais(this.relogio.agora(), FUSO);
      if (!dentroDoIntervalo(minutos, se.entre[0], se.entre[1])) return false;
    }
    return true;
  }

  /**
   * Executa uma automação (se ativa e se as condições se verificarem).
   * @param {Cliente} c
   * @param {Automacao} a
   * @param {string} motivo
   */
  executar(c, a, motivo) {
    if (!a.ativa || !this.condicoesOk(c, a)) return false;
    const agora = this.relogio.agora();
    const chave = `${c.codigo}/${a.id}`;
    const recentes = (this.execucoes.get(chave) ?? []).filter((t) => agora - t < 60_000);
    if (recentes.length >= MAX_EXECUCOES_MINUTO) {
      this.log.aviso(`[automações] ${chave}: demasiadas execuções no último minuto; ignorada`);
      return false;
    }
    recentes.push(agora);
    this.execucoes.set(chave, recentes);
    this.log.info(`[automações] ${chave}: executada (${motivo})`);
    for (const acao of a.entao) {
      try {
        this.executarAcao(c, a, acao);
      } catch (e) {
        this.log.erro(`[automações] ${chave}: erro na ação ${acao.acao}: ${e.message}`);
      }
    }
    return true;
  }

  executarAcao(c, a, acao) {
    if (acao.acao === 'notificar') {
      this.evento(c, { tipo: 'automacao', titulo: a.nome, mensagem: acao.mensagem }, true);
      return;
    }
    const ap = c.aparelhos?.get(acao.aparelho);
    if (!ap || !ap.canais.has(acao.canal)) {
      this.log.aviso(`[automações] ${c.codigo}/${a.id}: o aparelho ${acao.aparelho} canal ${acao.canal} já não existe`);
      return;
    }
    // Qualquer ação sobre o canal substitui uma reversão pendente anterior.
    const mesmoCanal = (r) => r.cliente === c.codigo && r.aparelho === ap.id && r.canal === acao.canal;
    const pendente = this.reversoes.find(mesmoCanal);
    this.reversoes = this.reversoes.filter((r) => !mesmoCanal(r));
    if (acao.acao === 'estore') {
      for (const cmd of comandosEstore(c.codigo, ap, acao.canal, acao.posicao)) this.publicar(cmd.topico, cmd.payload);
    } else {
      const ligar = acao.acao === 'ligar';
      const atual = c.estado.get(ap.id)?.canais.get(acao.canal)?.valor;
      // Já estava assim por decisão de outra pessoa (sem reversão nossa pendente):
      // não se agenda a reversão, para não desligar uma luz que alguém acendeu.
      const jaEstavaPorOutro = atual === (ligar ? 1 : 0) && !pendente;
      for (const cmd of comandosLigar(c.codigo, ap, acao.canal, ligar)) this.publicar(cmd.topico, cmd.payload);
      if (acao.durante_s && jaEstavaPorOutro) {
        this.log.info(`[automações] ${c.codigo}/${a.id}: ${ap.id} canal ${acao.canal} já estava ${ligar ? 'ligado' : 'desligado'}; sem reversão`);
      } else if (acao.durante_s) {
        this.reversoes.push({
          cliente: c.codigo,
          aparelho: ap.id,
          canal: acao.canal,
          ligar: !ligar,
          quando: this.relogio.agora() + acao.durante_s * 1000,
          automacao: a.id,
        });
      }
    }
    this.guardar();
  }

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
      for (const cmd of comandosLigar(r.cliente, ap, r.canal, r.ligar)) this.publicar(cmd.topico, cmd.payload);
    }
    this.guardar();
  }

  // --------------------------------------------------------------- eventos

  /**
   * Publica um evento em `_eventos`, guarda-o no histórico (retido) e, se
   * pedido, envia notificação (ntfy + FCM).
   * @param {Cliente} c
   * @param {Omit<Evento,'ts'>} ev
   * @param {boolean} [notificar]
   */
  evento(c, ev, notificar = false) {
    /** @type {Evento} */
    const evento = { ts: new Date(this.relogio.agora()).toISOString(), ...ev };
    const base = `domus/${c.codigo}`;
    this.publicar(`${base}/_eventos`, evento);
    c.historico = [evento, ...(c.historico ?? [])].slice(0, MAX_HISTORICO);
    this.publicar(`${base}/_historico`, c.historico, true);
    this.guardar();
    if (notificar) this.enviarNotificacao(c, evento);
  }

  /** @param {Cliente} c @param {Evento} ev */
  enviarNotificacao(c, ev) {
    const prioridade = ev.tipo === 'alarme' ? 'urgent' : ev.tipo === 'aviso' ? 'high' : 'default';
    const tags = ev.tipo === 'alarme' ? ['rotating_light'] : ev.tipo === 'aviso' ? ['warning'] : ['house'];
    if (!c.topicoNtfy && !c.avisouSemNtfy) {
      c.avisouSemNtfy = true;
      this.log.aviso(`[ntfy] ${c.codigo}: sem _ntfy retido (criado pelo domus.sh); notificações só por FCM`);
    }
    /** @type {PedidoNotificacao} */
    const pedido = {
      cliente: c.codigo,
      topicoNtfy: c.topicoNtfy,
      tokensFcm: [...c.tokensFcm],
      tipo: ev.tipo,
      titulo: ev.titulo,
      mensagem: ev.mensagem,
      prioridade,
      tags,
    };
    let resultado;
    try {
      resultado = this.notificador(pedido);
    } catch (e) {
      resultado = Promise.reject(e);
    }
    Promise.resolve(resultado)
      .then((r) => {
        const invalidos = r?.tokensInvalidos ?? [];
        if (invalidos.length) {
          c.tokensFcm = c.tokensFcm.filter((t) => !invalidos.includes(t));
          this.log.info(`[fcm] ${c.codigo}: ${invalidos.length} token(s) inválido(s) removido(s)`);
          this.guardar();
        }
      })
      .catch((e) => this.log.erro(`[notificações] ${c.codigo}: ${e.message}`));
  }

  // ------------------------------------------------------------------ tick

  /**
   * Chamado periodicamente (ex.: a cada segundo). Sincroniza o estado retido
   * após o arranque, executa reversões `durante_s`, verifica potências e, uma
   * vez por minuto, automações por hora e aparelhos a pilhas silenciosos.
   */
  tick() {
    try {
      const agora = this.relogio.agora();
      if (this.ligadoEm !== null && agora - this.ligadoEm >= this.esperaArranqueMs && this.porSincronizar.size) {
        const codigos = [...this.porSincronizar];
        this.porSincronizar.clear();
        for (const codigo of codigos) this.sincronizar(this.cliente(codigo));
      }
      this.executarReversoes();
      for (const c of this.clientes.values()) this.verificarPotencia(c);

      const minuto = Math.floor(agora / 60_000);
      if (this.ultimoMinuto === null) this.ultimoMinuto = minuto - 1;
      if (minuto > this.ultimoMinuto) {
        // Recupera minutos perdidos (ex.: processo parado alguns segundos), até 10.
        const inicio = Math.max(this.ultimoMinuto + 1, minuto - 9);
        for (let m = inicio; m <= minuto; m++) this.minuto(m * 60_000);
        this.ultimoMinuto = minuto;
      }
    } catch (e) {
      this.log.erro(`[tick] ${e.stack ?? e.message}`);
    }
  }

  /** Trabalho feito uma vez por minuto. @param {number} ms início do minuto (UTC) */
  minuto(ms) {
    const local = partesLocais(ms, FUSO);
    const chave = `${local.data} ${local.hora}`;
    for (const c of this.clientes.values()) {
      for (const a of c.automacoes ?? []) {
        const q = a.quando;
        if (q.tipo !== 'hora' || q.hora !== local.hora || !q.dias.includes(local.diaSemana)) continue;
        // Na mudança de hora de outubro a mesma hora local repete-se: só uma vez.
        if (c.horaDisparos[a.id] === chave) continue;
        c.horaDisparos[a.id] = chave;
        this.guardar();
        this.executar(c, a, `hora ${local.hora}`);
      }
      this.verificarSilencio(c);
    }
  }

  verificarSilencio(c) {
    if (!c.aparelhos) return;
    const agora = this.relogio.agora();
    for (const ap of c.aparelhos.values()) {
      if (!ap.bateria) continue;
      const e = c.estado.get(ap.id);
      if (!e?.ultimaNoticia || e.avisoSilencio || agora - e.ultimaNoticia <= SILENCIO_MS) continue;
      e.avisoSilencio = true;
      const horas = Math.floor((agora - e.ultimaNoticia) / 3_600_000);
      this.evento(c, { tipo: 'aviso', titulo: 'Sem notícias', mensagem: `${ap.nome}: sem notícias há ${horas} h. Verifique as pilhas e o Wi-Fi.`, aparelho: ap.id }, true);
    }
  }
}
