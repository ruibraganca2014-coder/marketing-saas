// Validação estrita das automações (docs/PROTOCOLO-MQTT-v2.md, secção 3).
// As mensagens de erro são mostradas ao cliente (evento `erro`), por isso
// são claras e em português de Portugal.

import { CONTROLAVEIS, BINARIAS } from './aparelhos.js';
import { HORA_RE } from './tempo.js';

export const MAX_AUTOMACOES = 50;
export const MAX_ACOES = 10;
export const AUTOMACAO_ID_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_DURACAO_S = 86_400;

/** @typedef {import('./aparelhos.js').Aparelho} Aparelho */

/**
 * @typedef {object} Automacao
 * @property {string} id
 * @property {string} nome
 * @property {boolean} ativa
 * @property {boolean} bloqueada
 * @property {object} quando
 * @property {{alarme?: boolean, entre?: [string, string]}} [se]
 * @property {object[]} entao
 */

class ErroValidacao extends Error {}

const falhar = (msg) => {
  throw new ErroValidacao(msg);
};

const eObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function soCampos(obj, permitidos, onde) {
  for (const k of Object.keys(obj)) {
    if (!permitidos.includes(k)) falhar(`${onde}: campo desconhecido "${k}".`);
  }
}

function inteiro(v, min, max, onde, campo) {
  if (!Number.isInteger(v) || v < min || v > max) {
    falhar(`${onde}: "${campo}" tem de ser um número inteiro entre ${min} e ${max}.`);
  }
  return v;
}

/**
 * Verifica que o aparelho/canal existe (e opcionalmente que a função é uma
 * das aceites). Devolve a função do canal.
 * @param {Map<string, Aparelho>|null} aparelhos
 * @param {unknown} idAparelho
 * @param {unknown} canal
 * @param {string} onde
 * @param {boolean} verificar  falso ao adotar listas antigas sem aparelhos conhecidos
 */
function referencia(aparelhos, idAparelho, canal, onde, verificar) {
  if (typeof idAparelho !== 'string' || !idAparelho) falhar(`${onde}: falta o "aparelho".`);
  inteiro(canal, 1, 64, onde, 'canal');
  if (!verificar) return null;
  const ap = aparelhos?.get(idAparelho);
  if (!ap) falhar(`${onde}: o aparelho "${idAparelho}" não existe.`);
  const c = ap.canais.get(canal);
  if (!c) falhar(`${onde}: o aparelho "${ap.nome}" não tem o canal ${canal}.`);
  return c.funcao;
}

function validarQuando(q, aparelhos, onde, verificar) {
  if (!eObjeto(q)) falhar(`${onde}: falta "quando" (o que faz disparar a automação).`);
  const w = `${onde}, "quando"`;
  switch (q.tipo) {
    case 'sensor': {
      soCampos(q, ['tipo', 'aparelho', 'canal', 'valor'], w);
      const funcao = referencia(aparelhos, q.aparelho, q.canal, w, verificar);
      if (funcao && !BINARIAS.has(funcao)) {
        falhar(`${w}: o canal ${q.canal} de "${q.aparelho}" é do tipo "${funcao}" e não serve de sensor (use porta, movimento, interruptor ou luz).`);
      }
      let valor = q.valor;
      if (valor === true) valor = 1;
      if (valor === false) valor = 0;
      if (valor !== 0 && valor !== 1) falhar(`${w}: "valor" tem de ser 1 ou 0.`);
      return { tipo: 'sensor', aparelho: q.aparelho, canal: q.canal, valor };
    }
    case 'hora': {
      soCampos(q, ['tipo', 'hora', 'dias'], w);
      if (typeof q.hora !== 'string' || !HORA_RE.test(q.hora)) falhar(`${w}: "hora" tem de estar no formato HH:MM (ex.: 07:30).`);
      let dias = [1, 2, 3, 4, 5, 6, 7];
      if (q.dias !== undefined) {
        if (!Array.isArray(q.dias) || q.dias.length === 0) falhar(`${w}: "dias" tem de ser uma lista não vazia de dias (1 = segunda … 7 = domingo).`);
        for (const d of q.dias) {
          if (!Number.isInteger(d) || d < 1 || d > 7) falhar(`${w}: dia inválido ${JSON.stringify(d)} (1 = segunda … 7 = domingo).`);
        }
        if (new Set(q.dias).size !== q.dias.length) falhar(`${w}: "dias" tem dias repetidos.`);
        dias = [...q.dias].sort((a, b) => a - b);
      }
      return { tipo: 'hora', hora: q.hora, dias };
    }
    case 'potencia': {
      soCampos(q, ['tipo', 'aparelho', 'acima_w', 'durante_s'], w);
      if (typeof q.aparelho !== 'string' || !q.aparelho) falhar(`${w}: falta o "aparelho".`);
      if (verificar && !aparelhos?.get(q.aparelho)) falhar(`${w}: o aparelho "${q.aparelho}" não existe.`);
      if (typeof q.acima_w !== 'number' || !Number.isFinite(q.acima_w) || q.acima_w <= 0 || q.acima_w > 100_000) {
        falhar(`${w}: "acima_w" tem de ser um número de watts entre 1 e 100000.`);
      }
      const durante = q.durante_s === undefined ? 0 : inteiro(q.durante_s, 0, MAX_DURACAO_S, w, 'durante_s');
      return { tipo: 'potencia', aparelho: q.aparelho, acima_w: q.acima_w, durante_s: durante };
    }
    default:
      return falhar(`${w}: tipo desconhecido ${JSON.stringify(q.tipo)} (use "sensor", "hora" ou "potencia").`);
  }
}

function validarSe(se, onde) {
  if (se === undefined || se === null) return undefined;
  const w = `${onde}, "se"`;
  if (!eObjeto(se)) falhar(`${w}: tem de ser um objeto.`);
  soCampos(se, ['alarme', 'entre'], w);
  /** @type {{alarme?: boolean, entre?: [string, string]}} */
  const r = {};
  if (se.alarme !== undefined) {
    if (typeof se.alarme !== 'boolean') falhar(`${w}: "alarme" tem de ser true ou false.`);
    r.alarme = se.alarme;
  }
  if (se.entre !== undefined) {
    const e = se.entre;
    if (!Array.isArray(e) || e.length !== 2 || !e.every((h) => typeof h === 'string' && HORA_RE.test(h))) {
      falhar(`${w}: "entre" tem de ser ["HH:MM", "HH:MM"] (ex.: ["19:00", "07:00"]).`);
    }
    if (e[0] === e[1]) falhar(`${w}: as horas de "entre" não podem ser iguais.`);
    r.entre = [e[0], e[1]];
  }
  return Object.keys(r).length ? r : undefined;
}

function validarAcao(a, i, aparelhos, onde, verificar) {
  const w = `${onde}, ação ${i + 1}`;
  if (!eObjeto(a)) falhar(`${w}: tem de ser um objeto.`);
  switch (a.acao) {
    case 'ligar':
    case 'desligar': {
      soCampos(a, ['acao', 'aparelho', 'canal', 'durante_s'], w);
      const funcao = referencia(aparelhos, a.aparelho, a.canal, w, verificar);
      if (funcao && !(CONTROLAVEIS.has(funcao) && funcao !== 'estore')) {
        falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" é do tipo "${funcao}" e não pode ser ligado/desligado.`);
      }
      /** @type {any} */
      const r = { acao: a.acao, aparelho: a.aparelho, canal: a.canal };
      if (a.durante_s !== undefined && a.durante_s !== null) r.durante_s = inteiro(a.durante_s, 1, MAX_DURACAO_S, w, 'durante_s');
      return r;
    }
    case 'estore': {
      soCampos(a, ['acao', 'aparelho', 'canal', 'posicao'], w);
      const funcao = referencia(aparelhos, a.aparelho, a.canal, w, verificar);
      if (funcao && funcao !== 'estore') falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" não é um estore.`);
      return { acao: 'estore', aparelho: a.aparelho, canal: a.canal, posicao: inteiro(a.posicao, 0, 100, w, 'posicao') };
    }
    case 'notificar': {
      soCampos(a, ['acao', 'mensagem'], w);
      if (typeof a.mensagem !== 'string' || !a.mensagem.trim()) falhar(`${w}: falta a "mensagem" a enviar.`);
      if (a.mensagem.length > 200) falhar(`${w}: a mensagem tem mais de 200 caracteres.`);
      return { acao: 'notificar', mensagem: a.mensagem.trim() };
    }
    default:
      return falhar(`${w}: ação desconhecida ${JSON.stringify(a.acao)} (use "ligar", "desligar", "estore" ou "notificar").`);
  }
}

/**
 * Valida e normaliza uma automação isolada.
 * @param {unknown} a
 * @param {number} i posição na lista (para as mensagens)
 * @param {Map<string, Aparelho>|null} aparelhos
 * @param {{verificarAparelhos?: boolean, bloqueadaPorOmissao?: boolean}} [opcoes]
 * @returns {Automacao}
 */
export function validarAutomacao(a, i, aparelhos, opcoes = {}) {
  const verificar = opcoes.verificarAparelhos !== false;
  if (!eObjeto(a)) falhar(`Automação n.º ${i + 1}: tem de ser um objeto JSON.`);
  if (typeof a.id !== 'string' || !AUTOMACAO_ID_RE.test(a.id)) {
    falhar(`Automação n.º ${i + 1}: "id" inválido ${JSON.stringify(a.id ?? null)} (use só letras minúsculas, dígitos e "-", até 40 caracteres).`);
  }
  const onde = `Automação "${a.id}"`;
  soCampos(a, ['id', 'nome', 'ativa', 'bloqueada', 'quando', 'se', 'entao'], onde);
  if (a.nome !== undefined && (typeof a.nome !== 'string' || a.nome.length > 80)) falhar(`${onde}: "nome" tem de ser texto até 80 caracteres.`);
  if (a.ativa !== undefined && typeof a.ativa !== 'boolean') falhar(`${onde}: "ativa" tem de ser true ou false.`);
  if (a.bloqueada !== undefined && typeof a.bloqueada !== 'boolean') falhar(`${onde}: "bloqueada" tem de ser true ou false.`);
  const quando = validarQuando(a.quando, aparelhos, onde, verificar);
  const se = validarSe(a.se, onde);
  if (!Array.isArray(a.entao) || a.entao.length < 1 || a.entao.length > MAX_ACOES) {
    falhar(`${onde}: "entao" tem de ter entre 1 e ${MAX_ACOES} ações.`);
  }
  const entao = a.entao.map((x, j) => validarAcao(x, j, aparelhos, onde, verificar));
  /** @type {Automacao} */
  const r = {
    id: a.id,
    nome: typeof a.nome === 'string' && a.nome.trim() ? a.nome.trim() : a.id,
    ativa: a.ativa ?? true,
    bloqueada: a.bloqueada ?? opcoes.bloqueadaPorOmissao ?? false,
    quando,
    entao,
  };
  if (se) r.se = se;
  return r;
}

/**
 * Valida a lista completa enviada pelo cliente (`_automacoes/set`) ou pela
 * administração (`admin: true`, sem restrições às bloqueadas).
 *
 * Regras das bloqueadas (modo cliente): mantêm-se exatamente como estavam,
 * exceto `ativa`; o cliente não as pode criar nem apagar.
 *
 * @param {unknown} lista
 * @param {object} contexto
 * @param {Map<string, Aparelho>|null} contexto.aparelhos
 * @param {Automacao[]} [contexto.existentes]
 * @param {boolean} [contexto.admin]
 * @param {boolean} [contexto.verificarAparelhos]
 * @returns {{ok: true, lista: Automacao[]} | {ok: false, erro: string}}
 */
export function validarAutomacoes(lista, { aparelhos, existentes = [], admin = false, verificarAparelhos = true }) {
  try {
    if (!Array.isArray(lista)) falhar('A lista de automações tem de ser uma lista JSON ([...]).');
    if (lista.length > MAX_AUTOMACOES) falhar(`No máximo ${MAX_AUTOMACOES} automações (recebidas ${lista.length}).`);
    const bloqueadas = new Map(existentes.filter((a) => a.bloqueada).map((a) => [a.id, a]));
    const vistos = new Set();
    /** @type {Automacao[]} */
    const resultado = [];
    lista.forEach((a, i) => {
      const id = eObjeto(a) ? a.id : undefined;
      if (typeof id === 'string' && vistos.has(id)) falhar(`Há duas automações com o mesmo id "${id}".`);
      if (typeof id === 'string') vistos.add(id);
      const antiga = !admin && typeof id === 'string' ? bloqueadas.get(id) : undefined;
      if (antiga) {
        // Automação da empresa: só o campo `ativa` pode mudar.
        if (a.ativa !== undefined && typeof a.ativa !== 'boolean') falhar(`Automação "${id}": "ativa" tem de ser true ou false.`);
        resultado.push({ ...structuredClone(antiga), ativa: a.ativa ?? antiga.ativa });
        return;
      }
      const v = validarAutomacao(a, i, aparelhos, { verificarAparelhos });
      if (!admin && v.bloqueada) {
        falhar(`Automação "${v.id}": só a Domus Energia pode criar automações bloqueadas.`);
      }
      resultado.push(v);
    });
    if (!admin) {
      for (const id of bloqueadas.keys()) {
        if (!vistos.has(id)) {
          falhar(`A automação "${bloqueadas.get(id).nome}" foi criada pela Domus Energia e não pode ser apagada (pode apenas desativá-la).`);
        }
      }
    }
    return { ok: true, lista: resultado };
  } catch (e) {
    if (e instanceof ErroValidacao) return { ok: false, erro: e.message };
    throw e;
  }
}
