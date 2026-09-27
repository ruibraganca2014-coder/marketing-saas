// Lista de aparelhos (domus/<cliente>/_aparelhos) e tradução de ações em
// tópicos/comandos MQTT para cada tipo de aparelho (OpenBeken, Shelly).

export const ID_RE = /^[a-z0-9-]+$/;
export const CLIENTE_RE = /^[a-z0-9-]{1,64}$/;
export const FUNCOES = new Set(['interruptor', 'luz', 'estore', 'porta', 'movimento', 'bateria']);
/** Funções que o cliente (e as automações) podem comandar. */
export const CONTROLAVEIS = new Set(['interruptor', 'luz', 'estore']);
/** Funções de valor binário (1/0). */
export const BINARIAS = new Set(['interruptor', 'luz', 'porta', 'movimento']);
export const TIPOS = new Set(['openbeken', 'shelly']);

export const ARRANQUES = new Set(['desligado', 'ligado', 'ultimo']);
/** Máximo de `durante_s` para ligar uma carga perigosa (4 h). */
export const MAX_PERIGOSA_S = 4 * 3600;

/**
 * @typedef {object} Canal
 * @property {number} n
 * @property {string} funcao
 * @property {string} nome
 * @property {boolean} entrada        só `porta`: porta de entrada (atraso do alarme)
 * @property {boolean} simular        só `interruptor`/`luz`: simulação de presença (férias)
 * @property {'desligado'|'ligado'|'ultimo'} [arranque]  só controláveis: estado após corte de luz
 * @property {'normal'|'perigosa'} [carga]              só controláveis
 * @property {string} [divisao]       divisão do canal (ou a do aparelho)
 */

/**
 * @typedef {object} Aparelho
 * @property {string} id
 * @property {string} nome
 * @property {'openbeken'|'shelly'} tipo
 * @property {boolean} medidor
 * @property {boolean} bateria
 * @property {boolean} geral          medidor da casa inteira (extensão: conta para o total de `_energia`)
 * @property {string} [divisao]
 * @property {Map<number, Canal>} canais
 */

const textoCurto = (v, max = 40) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Campos v3 de um canal (docs/PROTOCOLO-MQTT-v3.md §3). Valores inválidos são
 * ignorados (e registados em `rejeitados`); o canal continua válido.
 * @param {string} idAp
 * @param {any} c
 * @param {string} funcao
 * @param {string|undefined} divisaoAp
 * @param {string[]} rejeitados
 */
function camposV3(idAp, c, funcao, divisaoAp, rejeitados) {
  const onde = `${idAp} canal ${c.n}`;
  const r = { entrada: false, simular: false };
  if (c.entrada !== undefined) {
    if (c.entrada === true && funcao === 'porta') r.entrada = true;
    else if (c.entrada !== false) rejeitados.push(`${onde}: "entrada" só se aplica a portas; ignorado`);
  }
  if (c.simular !== undefined) {
    if (c.simular === true && (funcao === 'interruptor' || funcao === 'luz')) r.simular = true;
    else if (c.simular !== false) rejeitados.push(`${onde}: "simular" só se aplica a interruptores e luzes; ignorado`);
  }
  if (CONTROLAVEIS.has(funcao)) {
    r.carga = 'normal';
    if (c.carga !== undefined) {
      if (c.carga === 'perigosa' || c.carga === 'normal') r.carga = c.carga;
      else rejeitados.push(`${onde}: "carga" inválida ${JSON.stringify(c.carga)}; fica "normal"`);
    }
    r.arranque = 'desligado';
    if (c.arranque !== undefined) {
      if (!ARRANQUES.has(c.arranque)) rejeitados.push(`${onde}: "arranque" inválido ${JSON.stringify(c.arranque)}; fica "desligado"`);
      else if (c.arranque === 'ultimo' && (r.carga === 'perigosa' || funcao === 'estore')) {
        rejeitados.push(`${onde}: "arranque": "ultimo" não é permitido aqui; fica "desligado"`);
      } else r.arranque = c.arranque;
    }
  } else if (c.carga !== undefined || c.arranque !== undefined) {
    rejeitados.push(`${onde}: "carga"/"arranque" só se aplicam a canais controláveis; ignorados`);
  }
  const divisao = textoCurto(c.divisao) ?? divisaoAp;
  if (divisao) r.divisao = divisao;
  return r;
}

/**
 * Normaliza a lista publicada em `_aparelhos`. Entradas inválidas são
 * ignoradas (e devolvidas em `rejeitados` para o registo).
 * Um aparelho da v1 sem `canais` passa a ter um canal `interruptor` n.º 1 e
 * é considerado medidor (na v1 todos os aparelhos mediam consumo).
 * @param {unknown} lista
 * @returns {{aparelhos: Map<string, Aparelho>, rejeitados: string[]}}
 */
export function normalizarAparelhos(lista) {
  /** @type {Map<string, Aparelho>} */
  const aparelhos = new Map();
  /** @type {string[]} */
  const rejeitados = [];
  if (!Array.isArray(lista)) return { aparelhos, rejeitados: ['a lista de aparelhos não é uma lista JSON'] };
  for (const a of lista) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !ID_RE.test(a.id)) {
      rejeitados.push(`entrada sem id válido: ${JSON.stringify(a)?.slice(0, 80)}`);
      continue;
    }
    if (!TIPOS.has(a.tipo)) {
      rejeitados.push(`${a.id}: tipo desconhecido "${a.tipo}"`);
      continue;
    }
    const nome = typeof a.nome === 'string' && a.nome.trim() ? a.nome.trim() : a.id;
    const divisao = textoCurto(a.divisao);
    /** @type {Map<number, Canal>} */
    const canais = new Map();
    const v1 = a.canais === undefined;
    if (v1) {
      canais.set(1, { n: 1, funcao: 'interruptor', nome, ...camposV3(a.id, { n: 1 }, 'interruptor', divisao, rejeitados) });
    } else if (Array.isArray(a.canais)) {
      for (const c of a.canais) {
        if (!c || !Number.isInteger(c.n) || c.n < 1 || c.n > 64 || !FUNCOES.has(c.funcao)) {
          rejeitados.push(`${a.id}: canal inválido ${JSON.stringify(c)?.slice(0, 80)}`);
          continue;
        }
        const nomeCanal = typeof c.nome === 'string' && c.nome.trim() ? c.nome.trim() : nome;
        canais.set(c.n, { n: c.n, funcao: c.funcao, nome: nomeCanal, ...camposV3(a.id, c, c.funcao, divisao, rejeitados) });
      }
    } else {
      rejeitados.push(`${a.id}: "canais" não é uma lista`);
      continue;
    }
    aparelhos.set(a.id, {
      id: a.id,
      nome,
      tipo: a.tipo,
      medidor: typeof a.medidor === 'boolean' ? a.medidor : v1,
      bateria: a.bateria === true,
      geral: a.geral === true,
      ...(divisao ? { divisao } : {}),
      canais,
    });
  }
  return { aparelhos, rejeitados };
}

/** O canal é uma carga perigosa (aquecedor, termoacumulador, bomba…)? */
export function ePerigosa(ap, n) {
  return ap?.canais.get(n)?.carga === 'perigosa';
}

/** Nome a mostrar de um canal (nome do canal ou do aparelho). */
export function nomeCanal(ap, n) {
  return ap.canais.get(n)?.nome ?? ap.nome;
}

let idRpc = 0;

/**
 * @typedef {object} Comando
 * @property {string} topico
 * @property {string} payload
 */

function rpc(prefixo, method, params) {
  idRpc = (idRpc % 1_000_000) + 1;
  return { topico: `${prefixo}/rpc`, payload: JSON.stringify({ id: idRpc, src: 'motor', method, params }) };
}

/**
 * Comandos para ligar/desligar um canal `interruptor` ou `luz`.
 * @param {string} cliente
 * @param {Aparelho} ap
 * @param {number} n
 * @param {boolean} ligar
 * @returns {Comando[]}
 */
export function comandosLigar(cliente, ap, n, ligar) {
  const prefixo = `domus/${cliente}/${ap.id}`;
  const funcao = ap.canais.get(n)?.funcao;
  if (ap.tipo === 'openbeken') {
    return [{ topico: `${prefixo}/${n}/set`, payload: ligar ? '1' : '0' }];
  }
  const id = n - 1;
  if (funcao === 'luz') {
    return [rpc(prefixo, 'Light.Set', { id, on: ligar })];
  }
  return [
    { topico: `${prefixo}/command/switch:${id}`, payload: ligar ? 'on' : 'off' },
    { topico: `${prefixo}/command`, payload: 'status_update' },
  ];
}

/**
 * Comandos para pôr um estore numa posição (0 fechado – 100 aberto).
 * @param {string} cliente
 * @param {Aparelho} ap
 * @param {number} n
 * @param {number} posicao
 * @returns {Comando[]}
 */
export function comandosEstore(cliente, ap, n, posicao) {
  const prefixo = `domus/${cliente}/${ap.id}`;
  if (ap.tipo === 'openbeken') return [{ topico: `${prefixo}/${n}/set`, payload: String(posicao) }];
  return [rpc(prefixo, 'Cover.GoToPosition', { id: n - 1, pos: posicao })];
}

/**
 * Comandos para uma luz com brilho (0 = desligar).
 * OpenBeken: `<n>/set` + `led_dimmer/set`; Shelly: `Light.Set` com `brightness`.
 * @param {string} cliente
 * @param {Aparelho} ap
 * @param {number} n
 * @param {number} brilho 0–100
 * @returns {Comando[]}
 */
export function comandosLuz(cliente, ap, n, brilho) {
  const prefixo = `domus/${cliente}/${ap.id}`;
  if (ap.tipo === 'openbeken') {
    const r = [{ topico: `${prefixo}/${n}/set`, payload: brilho > 0 ? '1' : '0' }];
    if (brilho > 0) r.push({ topico: `${prefixo}/led_dimmer/set`, payload: String(brilho) });
    return r;
  }
  return [rpc(prefixo, 'Light.Set', brilho > 0 ? { id: n - 1, on: true, brightness: brilho } : { id: n - 1, on: false })];
}
