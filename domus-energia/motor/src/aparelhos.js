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

/**
 * @typedef {object} Canal
 * @property {number} n
 * @property {string} funcao
 * @property {string} nome
 */

/**
 * @typedef {object} Aparelho
 * @property {string} id
 * @property {string} nome
 * @property {'openbeken'|'shelly'} tipo
 * @property {boolean} medidor
 * @property {boolean} bateria
 * @property {Map<number, Canal>} canais
 */

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
    /** @type {Map<number, Canal>} */
    const canais = new Map();
    const v1 = a.canais === undefined;
    if (v1) {
      canais.set(1, { n: 1, funcao: 'interruptor', nome });
    } else if (Array.isArray(a.canais)) {
      for (const c of a.canais) {
        if (!c || !Number.isInteger(c.n) || c.n < 1 || c.n > 64 || !FUNCOES.has(c.funcao)) {
          rejeitados.push(`${a.id}: canal inválido ${JSON.stringify(c)?.slice(0, 80)}`);
          continue;
        }
        const nomeCanal = typeof c.nome === 'string' && c.nome.trim() ? c.nome.trim() : nome;
        canais.set(c.n, { n: c.n, funcao: c.funcao, nome: nomeCanal });
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
      canais,
    });
  }
  return { aparelhos, rejeitados };
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
