// Validação estrita das automações e cenas (docs/PROTOCOLO-MQTT-v2.md §3 e
// docs/PROTOCOLO-MQTT-v3.md §7–§8). Um campo desconhecido é erro.
// As mensagens de erro são mostradas ao cliente (evento `erro`), por isso
// são claras e em português de Portugal.

import { CONTROLAVEIS, BINARIAS, MAX_PERIGOSA_S, nomeCanal } from './aparelhos.js';
import { HORA_RE } from './tempo.js';

export const MAX_AUTOMACOES = 50;
export const MAX_CENAS = 30;
/** Máximo de ações por automação/cena, contando as de dentro de "se". */
export const MAX_ACOES = 20;
/** Níveis de "se" dentro de "se". */
export const MAX_NIVEIS_SE = 2;
export const AUTOMACAO_ID_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_DURACAO_S = 86_400;
export const MODOS = ['casa', 'fora', 'noite', 'ferias'];
export const CATEGORIAS = ['conveniencia', 'energia', 'seguranca', 'conforto', 'rotina'];
export const ICONES = ['filme', 'sol', 'lua', 'porta', 'casa', 'energia', 'luz', 'estrela'];
export const EVENTOS_SISTEMA = ['aparelho_offline', 'aparelho_online', 'energia_reposta'];

/** @typedef {import('./aparelhos.js').Aparelho} Aparelho */

/**
 * @typedef {object} Condicoes
 * @property {boolean} [alarme]
 * @property {[string, string]} [entre]
 * @property {number[]} [dias]
 * @property {'dia'|'noite'} [sol]
 * @property {string[]} [modo]
 * @property {'alguem'|'ninguem'} [presenca]
 * @property {{aparelho: string, canal: number, valor: number}[]} [aparelhos]
 */

/**
 * @typedef {object} Automacao
 * @property {string} id
 * @property {string} nome
 * @property {boolean} ativa
 * @property {boolean} bloqueada
 * @property {string} [descricao]
 * @property {string} [categoria]
 * @property {boolean} [ignorar_pausa]
 * @property {any} quando
 * @property {Condicoes} [se]
 * @property {any[]} entao
 */

/**
 * @typedef {object} Cena
 * @property {string} id
 * @property {string} nome
 * @property {string} [icone]
 * @property {boolean} bloqueada
 * @property {any[]} acoes
 */

/**
 * @typedef {object} Contexto
 * @property {Map<string, Aparelho>|null} aparelhos
 * @property {boolean} verificar           falso ao adotar listas antigas sem aparelhos conhecidos
 * @property {{local: object|null}|null} [config]
 * @property {Set<string>|null} [cenas]    ids das cenas existentes (null = não verificar)
 */

export class ErroValidacao extends Error {}

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

function binario(v, w, campo = 'valor') {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v !== 0 && v !== 1) falhar(`${w}: "${campo}" tem de ser 1 ou 0.`);
  return v;
}

/**
 * Verifica que o aparelho/canal existe. Devolve o canal (ou null sem verificação).
 * @param {Contexto} ctx
 */
function referencia(ctx, idAparelho, canal, onde) {
  if (typeof idAparelho !== 'string' || !idAparelho) falhar(`${onde}: falta o "aparelho".`);
  inteiro(canal, 1, 64, onde, 'canal');
  if (!ctx.verificar) return null;
  const ap = ctx.aparelhos?.get(idAparelho);
  if (!ap) falhar(`${onde}: o aparelho "${idAparelho}" não existe.`);
  const c = ap.canais.get(canal);
  if (!c) falhar(`${onde}: o aparelho "${ap.nome}" não tem o canal ${canal}.`);
  return c;
}

function aparelhoExiste(ctx, id, w) {
  if (typeof id !== 'string' || !id) falhar(`${w}: falta o "aparelho".`);
  if (ctx.verificar && !ctx.aparelhos?.get(id)) falhar(`${w}: o aparelho "${id}" não existe.`);
}

function precisaLocal(ctx, w) {
  if (ctx.verificar && ctx.config && !ctx.config.local) {
    falhar(`${w}: para usar o nascer/pôr do sol defina primeiro a localização da casa ("local" em _config).`);
  }
}

function validarDias(dias, w) {
  if (!Array.isArray(dias) || dias.length === 0) falhar(`${w}: "dias" tem de ser uma lista não vazia de dias (1 = segunda … 7 = domingo).`);
  for (const d of dias) {
    if (!Number.isInteger(d) || d < 1 || d > 7) falhar(`${w}: dia inválido ${JSON.stringify(d)} (1 = segunda … 7 = domingo).`);
  }
  if (new Set(dias).size !== dias.length) falhar(`${w}: "dias" tem dias repetidos.`);
  return [...dias].sort((a, b) => a - b);
}

/** @param {Contexto} ctx */
function validarQuando(q, ctx, onde) {
  if (!eObjeto(q)) falhar(`${onde}: falta "quando" (o que faz disparar a automação).`);
  const w = `${onde}, "quando"`;
  switch (q.tipo) {
    case 'sensor': {
      soCampos(q, ['tipo', 'aparelho', 'canal', 'valor', 'durante_s'], w);
      const canal = referencia(ctx, q.aparelho, q.canal, w);
      if (canal && !BINARIAS.has(canal.funcao)) {
        falhar(`${w}: o canal ${q.canal} de "${q.aparelho}" é do tipo "${canal.funcao}" e não serve de sensor (use porta, movimento, interruptor ou luz).`);
      }
      const r = { tipo: 'sensor', aparelho: q.aparelho, canal: q.canal, valor: binario(q.valor, w) };
      if (q.durante_s !== undefined && q.durante_s !== null && q.durante_s !== 0) r.durante_s = inteiro(q.durante_s, 1, MAX_DURACAO_S, w, 'durante_s');
      return r;
    }
    case 'hora': {
      soCampos(q, ['tipo', 'hora', 'dias'], w);
      if (typeof q.hora !== 'string' || !HORA_RE.test(q.hora)) falhar(`${w}: "hora" tem de estar no formato HH:MM (ex.: 07:30).`);
      const dias = q.dias === undefined ? [1, 2, 3, 4, 5, 6, 7] : validarDias(q.dias, w);
      return { tipo: 'hora', hora: q.hora, dias };
    }
    case 'potencia': {
      soCampos(q, ['tipo', 'aparelho', 'acima_w', 'durante_s', 'rearmar_w'], w);
      aparelhoExiste(ctx, q.aparelho, w);
      if (typeof q.acima_w !== 'number' || !Number.isFinite(q.acima_w) || q.acima_w <= 0 || q.acima_w > 100_000) {
        falhar(`${w}: "acima_w" tem de ser um número de watts entre 1 e 100000.`);
      }
      const durante = q.durante_s === undefined ? 0 : inteiro(q.durante_s, 0, MAX_DURACAO_S, w, 'durante_s');
      const r = { tipo: 'potencia', aparelho: q.aparelho, acima_w: q.acima_w, durante_s: durante };
      if (q.rearmar_w !== undefined) {
        if (typeof q.rearmar_w !== 'number' || !Number.isFinite(q.rearmar_w) || q.rearmar_w < 0 || q.rearmar_w >= q.acima_w) {
          falhar(`${w}: "rearmar_w" tem de ser um número de watts entre 0 e "acima_w" (exclusive).`);
        }
        r.rearmar_w = q.rearmar_w;
      }
      return r;
    }
    case 'sol': {
      soCampos(q, ['tipo', 'evento', 'desvio_min'], w);
      if (q.evento !== 'nascer' && q.evento !== 'por') falhar(`${w}: "evento" tem de ser "nascer" ou "por".`);
      const desvio = q.desvio_min === undefined ? 0 : inteiro(q.desvio_min, -180, 180, w, 'desvio_min');
      precisaLocal(ctx, w);
      return { tipo: 'sol', evento: q.evento, desvio_min: desvio };
    }
    case 'presenca':
      soCampos(q, ['tipo', 'evento'], w);
      if (q.evento !== 'chega_primeiro' && q.evento !== 'sai_ultimo') falhar(`${w}: "evento" tem de ser "chega_primeiro" ou "sai_ultimo".`);
      return { tipo: 'presenca', evento: q.evento };
    case 'modo':
      soCampos(q, ['tipo', 'modo'], w);
      if (!MODOS.includes(q.modo)) falhar(`${w}: "modo" tem de ser ${MODOS.map((m) => `"${m}"`).join(', ')}.`);
      return { tipo: 'modo', modo: q.modo };
    case 'manual':
      soCampos(q, ['tipo'], w);
      return { tipo: 'manual' };
    case 'sistema': {
      soCampos(q, ['tipo', 'evento', 'aparelho'], w);
      if (!EVENTOS_SISTEMA.includes(q.evento)) falhar(`${w}: "evento" tem de ser ${EVENTOS_SISTEMA.map((m) => `"${m}"`).join(', ')}.`);
      const r = { tipo: 'sistema', evento: q.evento };
      if (q.aparelho !== undefined) {
        if (q.evento === 'energia_reposta') falhar(`${w}: "energia_reposta" é da casa toda e não leva "aparelho".`);
        aparelhoExiste(ctx, q.aparelho, w);
        r.aparelho = q.aparelho;
      }
      return r;
    }
    default:
      return falhar(`${w}: tipo desconhecido ${JSON.stringify(q.tipo)} (use "sensor", "hora", "potencia", "sol", "presenca", "modo", "manual" ou "sistema").`);
  }
}

/**
 * Condições (`se` de uma automação ou `condicao` de uma ação "se").
 * @param {Contexto} ctx
 * @returns {Condicoes|undefined}
 */
function validarCondicoes(se, ctx, w) {
  if (!eObjeto(se)) falhar(`${w}: tem de ser um objeto.`);
  soCampos(se, ['alarme', 'entre', 'dias', 'sol', 'modo', 'presenca', 'aparelhos'], w);
  /** @type {Condicoes} */
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
  if (se.dias !== undefined) r.dias = validarDias(se.dias, w);
  if (se.sol !== undefined) {
    if (se.sol !== 'dia' && se.sol !== 'noite') falhar(`${w}: "sol" tem de ser "dia" ou "noite".`);
    precisaLocal(ctx, w);
    r.sol = se.sol;
  }
  if (se.modo !== undefined) {
    const lista = typeof se.modo === 'string' ? [se.modo] : se.modo;
    if (!Array.isArray(lista) || lista.length === 0 || !lista.every((m) => MODOS.includes(m)) || new Set(lista).size !== lista.length) {
      falhar(`${w}: "modo" tem de ser uma lista de modos sem repetições (${MODOS.join(', ')}).`);
    }
    r.modo = [...lista];
  }
  if (se.presenca !== undefined) {
    if (se.presenca !== 'alguem' && se.presenca !== 'ninguem') falhar(`${w}: "presenca" tem de ser "alguem" ou "ninguem".`);
    r.presenca = se.presenca;
  }
  if (se.aparelhos !== undefined) {
    if (!Array.isArray(se.aparelhos) || se.aparelhos.length === 0 || se.aparelhos.length > 10) {
      falhar(`${w}: "aparelhos" tem de ser uma lista com 1 a 10 condições.`);
    }
    r.aparelhos = se.aparelhos.map((x, i) => {
      const wx = `${w}, aparelhos[${i + 1}]`;
      if (!eObjeto(x)) falhar(`${wx}: tem de ser um objeto.`);
      soCampos(x, ['aparelho', 'canal', 'valor'], wx);
      const canal = referencia(ctx, x.aparelho, x.canal, wx);
      let valor = x.valor;
      if (valor === true) valor = 1;
      if (valor === false) valor = 0;
      if (canal && BINARIAS.has(canal.funcao)) valor = binario(valor, wx);
      else inteiro(valor, 0, 100, wx, 'valor');
      return { aparelho: x.aparelho, canal: x.canal, valor };
    });
  }
  return r;
}

function validarSe(se, ctx, onde) {
  if (se === undefined || se === null) return undefined;
  const r = validarCondicoes(se, ctx, `${onde}, "se"`);
  return Object.keys(r).length ? r : undefined;
}

/** Limite de segurança das cargas perigosas (v3 §3). */
function verificarPerigosa(canal, acao, w) {
  if (!canal || canal.carga !== 'perigosa') return;
  const nome = canal.nome;
  if (acao.acao === 'alternar') falhar(`${w}: "${nome}" é uma carga perigosa; use "ligar" com "durante_s" (máx. 4 h) em vez de "alternar".`);
  if (acao.acao === 'luz' && acao.brilho > 0) falhar(`${w}: "${nome}" é uma carga perigosa e só pode ser ligada com "ligar" e "durante_s" (máx. 4 h).`);
  if (acao.acao === 'ligar' && (!acao.durante_s || acao.durante_s > MAX_PERIGOSA_S)) {
    falhar(`${w}: "${nome}" é uma carga perigosa: só pode ser ligada com "durante_s" até ${MAX_PERIGOSA_S} s (4 h).`);
  }
}

/**
 * @param {any} a
 * @param {string} w
 * @param {Contexto} ctx
 * @param {{nivel: number, emCena: boolean}} o
 */
function validarAcao(a, w, ctx, o) {
  if (!eObjeto(a)) falhar(`${w}: tem de ser um objeto.`);
  switch (a.acao) {
    case 'ligar':
    case 'desligar': {
      soCampos(a, ['acao', 'aparelho', 'canal', 'durante_s'], w);
      const canal = referencia(ctx, a.aparelho, a.canal, w);
      if (canal && !(CONTROLAVEIS.has(canal.funcao) && canal.funcao !== 'estore')) {
        falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" é do tipo "${canal.funcao}" e não pode ser ligado/desligado.`);
      }
      /** @type {any} */
      const r = { acao: a.acao, aparelho: a.aparelho, canal: a.canal };
      if (a.durante_s !== undefined && a.durante_s !== null) r.durante_s = inteiro(a.durante_s, 1, MAX_DURACAO_S, w, 'durante_s');
      verificarPerigosa(canal, r, w);
      return r;
    }
    case 'alternar': {
      soCampos(a, ['acao', 'aparelho', 'canal'], w);
      const canal = referencia(ctx, a.aparelho, a.canal, w);
      if (canal && canal.funcao !== 'interruptor' && canal.funcao !== 'luz') falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" não é um interruptor nem uma luz.`);
      const r = { acao: 'alternar', aparelho: a.aparelho, canal: a.canal };
      verificarPerigosa(canal, r, w);
      return r;
    }
    case 'luz': {
      soCampos(a, ['acao', 'aparelho', 'canal', 'brilho'], w);
      const canal = referencia(ctx, a.aparelho, a.canal, w);
      if (canal && canal.funcao !== 'luz') falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" não é uma luz regulável.`);
      const r = { acao: 'luz', aparelho: a.aparelho, canal: a.canal, brilho: inteiro(a.brilho, 0, 100, w, 'brilho') };
      verificarPerigosa(canal, r, w);
      return r;
    }
    case 'estore': {
      soCampos(a, ['acao', 'aparelho', 'canal', 'posicao'], w);
      const canal = referencia(ctx, a.aparelho, a.canal, w);
      if (canal && canal.funcao !== 'estore') falhar(`${w}: o canal ${a.canal} de "${a.aparelho}" não é um estore.`);
      return { acao: 'estore', aparelho: a.aparelho, canal: a.canal, posicao: inteiro(a.posicao, 0, 100, w, 'posicao') };
    }
    case 'notificar': {
      soCampos(a, ['acao', 'mensagem'], w);
      if (typeof a.mensagem !== 'string' || !a.mensagem.trim()) falhar(`${w}: falta a "mensagem" a enviar.`);
      if (a.mensagem.length > 200) falhar(`${w}: a mensagem tem mais de 200 caracteres.`);
      return { acao: 'notificar', mensagem: a.mensagem.trim() };
    }
    case 'esperar':
      soCampos(a, ['acao', 's'], w);
      return { acao: 'esperar', s: inteiro(a.s, 1, 3600, w, 's') };
    case 'modo': {
      soCampos(a, ['acao', 'modo', 'forcar'], w);
      if (!MODOS.includes(a.modo)) falhar(`${w}: "modo" tem de ser ${MODOS.map((m) => `"${m}"`).join(', ')}.`);
      if (a.forcar !== undefined && typeof a.forcar !== 'boolean') falhar(`${w}: "forcar" tem de ser true ou false.`);
      return { acao: 'modo', modo: a.modo, forcar: a.forcar === true };
    }
    case 'cena': {
      if (o.emCena) falhar(`${w}: uma cena não pode executar outra cena.`);
      soCampos(a, ['acao', 'cena'], w);
      if (typeof a.cena !== 'string' || !AUTOMACAO_ID_RE.test(a.cena)) falhar(`${w}: falta a "cena" (id da cena).`);
      if (ctx.verificar && ctx.cenas && !ctx.cenas.has(a.cena)) falhar(`${w}: a cena "${a.cena}" não existe.`);
      return { acao: 'cena', cena: a.cena };
    }
    case 'se': {
      if (o.emCena) falhar(`${w}: as cenas não podem ter "se" (use uma automação).`);
      if (o.nivel > MAX_NIVEIS_SE) falhar(`${w}: no máximo ${MAX_NIVEIS_SE} níveis de "se" dentro de "se".`);
      soCampos(a, ['acao', 'condicao', 'entao', 'senao'], w);
      if (!eObjeto(a.condicao) || Object.keys(a.condicao).length === 0) falhar(`${w}: falta a "condicao" do "se".`);
      const condicao = validarCondicoes(a.condicao, ctx, `${w}, "condicao"`);
      if (!Array.isArray(a.entao) || a.entao.length === 0) falhar(`${w}: o "entao" do "se" tem de ter pelo menos uma ação.`);
      if (a.senao !== undefined && !Array.isArray(a.senao)) falhar(`${w}: "senao" tem de ser uma lista de ações.`);
      const sub = { ...o, nivel: o.nivel + 1 };
      const r = { acao: 'se', condicao, entao: validarLista(a.entao, `${w}, "entao"`, ctx, sub) };
      if (a.senao?.length) r.senao = validarLista(a.senao, `${w}, "senao"`, ctx, sub);
      return r;
    }
    default: {
      const permitidas = o.emCena
        ? '"ligar", "desligar", "alternar", "luz", "estore", "notificar", "esperar" ou "modo"'
        : '"ligar", "desligar", "alternar", "luz", "estore", "notificar", "esperar", "modo", "cena" ou "se"';
      return falhar(`${w}: ação desconhecida ${JSON.stringify(a.acao)} (use ${permitidas}).`);
    }
  }
}

function validarLista(lista, onde, ctx, o) {
  return lista.map((x, j) => validarAcao(x, `${onde}, ação ${j + 1}`, ctx, o));
}

/**
 * Percorre todas as ações (incluindo as de dentro de "se").
 * @param {any[]} acoes
 * @param {(acao: any) => void} fn
 */
export function percorrerAcoes(acoes, fn) {
  for (const a of acoes ?? []) {
    fn(a);
    if (a?.acao === 'se') {
      percorrerAcoes(a.entao, fn);
      percorrerAcoes(a.senao, fn);
    }
  }
}

/** Número total de ações (as de "se" contam, e o próprio "se" também). */
export function contarAcoes(acoes) {
  let n = 0;
  percorrerAcoes(acoes, () => n++);
  return n;
}

/** Profundidade de "se" (0 = sem "se"). */
function profundidadeSe(acoes) {
  let max = 0;
  for (const a of acoes ?? []) {
    if (a?.acao === 'se' && a && typeof a === 'object') {
      max = Math.max(max, 1 + Math.max(profundidadeSe(Array.isArray(a.entao) ? a.entao : []), profundidadeSe(Array.isArray(a.senao) ? a.senao : [])));
    }
  }
  return max;
}

function validarAcoesRaiz(lista, onde, ctx, emCena, campo) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_ACOES) {
    falhar(`${onde}: "${campo}" tem de ter entre 1 e ${MAX_ACOES} ações.`);
  }
  if (contarAcoes(lista) > MAX_ACOES) falhar(`${onde}: no máximo ${MAX_ACOES} ações no total (contando as de dentro de "se").`);
  if (!emCena && profundidadeSe(lista) > MAX_NIVEIS_SE) falhar(`${onde}: no máximo ${MAX_NIVEIS_SE} níveis de "se" dentro de "se".`);
  return validarLista(lista, onde, ctx, { nivel: 1, emCena });
}

/**
 * @param {Map<string, Aparelho>|null} aparelhos
 * @param {{verificarAparelhos?: boolean, config?: any, cenas?: Set<string>|null}} opcoes
 * @returns {Contexto}
 */
function contexto(aparelhos, opcoes) {
  return {
    aparelhos,
    verificar: opcoes.verificarAparelhos !== false,
    config: opcoes.config ?? null,
    cenas: opcoes.cenas ?? null,
  };
}

/**
 * Valida e normaliza uma automação isolada.
 * @param {unknown} a
 * @param {number} i posição na lista (para as mensagens)
 * @param {Map<string, Aparelho>|null} aparelhos
 * @param {{verificarAparelhos?: boolean, bloqueadaPorOmissao?: boolean, config?: any, cenas?: Set<string>|null}} [opcoes]
 * @returns {Automacao}
 */
export function validarAutomacao(a, i, aparelhos, opcoes = {}) {
  const ctx = contexto(aparelhos, opcoes);
  if (!eObjeto(a)) falhar(`Automação n.º ${i + 1}: tem de ser um objeto JSON.`);
  const x = /** @type {any} */ (a);
  if (typeof x.id !== 'string' || !AUTOMACAO_ID_RE.test(x.id)) {
    falhar(`Automação n.º ${i + 1}: "id" inválido ${JSON.stringify(x.id ?? null)} (use só letras minúsculas, dígitos e "-", até 40 caracteres).`);
  }
  const onde = `Automação "${x.id}"`;
  soCampos(x, ['id', 'nome', 'ativa', 'bloqueada', 'descricao', 'categoria', 'ignorar_pausa', 'quando', 'se', 'entao'], onde);
  if (x.nome !== undefined && (typeof x.nome !== 'string' || x.nome.length > 80)) falhar(`${onde}: "nome" tem de ser texto até 80 caracteres.`);
  if (x.ativa !== undefined && typeof x.ativa !== 'boolean') falhar(`${onde}: "ativa" tem de ser true ou false.`);
  if (x.bloqueada !== undefined && typeof x.bloqueada !== 'boolean') falhar(`${onde}: "bloqueada" tem de ser true ou false.`);
  if (x.descricao !== undefined && x.descricao !== null && (typeof x.descricao !== 'string' || x.descricao.length > 200)) {
    falhar(`${onde}: "descricao" tem de ser texto até 200 caracteres.`);
  }
  if (x.categoria !== undefined && x.categoria !== null && !CATEGORIAS.includes(x.categoria)) {
    falhar(`${onde}: "categoria" tem de ser ${CATEGORIAS.map((c) => `"${c}"`).join(', ')}.`);
  }
  if (x.ignorar_pausa !== undefined && typeof x.ignorar_pausa !== 'boolean') falhar(`${onde}: "ignorar_pausa" tem de ser true ou false.`);
  const quando = validarQuando(x.quando, ctx, onde);
  const se = validarSe(x.se, ctx, onde);
  const entao = validarAcoesRaiz(x.entao, onde, ctx, false, 'entao');
  /** @type {Automacao} */
  const r = {
    id: x.id,
    nome: typeof x.nome === 'string' && x.nome.trim() ? x.nome.trim() : x.id,
    ativa: x.ativa ?? true,
    bloqueada: x.bloqueada ?? opcoes.bloqueadaPorOmissao ?? false,
    quando,
    entao,
  };
  if (typeof x.descricao === 'string' && x.descricao.trim()) r.descricao = x.descricao.trim();
  if (typeof x.categoria === 'string') r.categoria = x.categoria;
  if (x.ignorar_pausa === true) r.ignorar_pausa = true;
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
 * @param {any} [contexto.config]              `_config` (para o sol)
 * @param {Set<string>|null} [contexto.cenas]   ids das cenas (para a ação "cena")
 * @returns {{ok: true, lista: Automacao[]} | {ok: false, erro: string}}
 */
export function validarAutomacoes(lista, { aparelhos, existentes = [], admin = false, verificarAparelhos = true, config = null, cenas = null }) {
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
      const v = validarAutomacao(a, i, aparelhos, { verificarAparelhos, config, cenas });
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

/**
 * Valida uma cena isolada.
 * @param {unknown} c
 * @param {number} i
 * @param {Map<string, Aparelho>|null} aparelhos
 * @param {{verificarAparelhos?: boolean, bloqueadaPorOmissao?: boolean}} [opcoes]
 * @returns {Cena}
 */
export function validarCena(c, i, aparelhos, opcoes = {}) {
  const ctx = contexto(aparelhos, opcoes);
  if (!eObjeto(c)) falhar(`Cena n.º ${i + 1}: tem de ser um objeto JSON.`);
  const x = /** @type {any} */ (c);
  if (typeof x.id !== 'string' || !AUTOMACAO_ID_RE.test(x.id)) {
    falhar(`Cena n.º ${i + 1}: "id" inválido ${JSON.stringify(x.id ?? null)} (use só letras minúsculas, dígitos e "-", até 40 caracteres).`);
  }
  const onde = `Cena "${x.id}"`;
  soCampos(x, ['id', 'nome', 'icone', 'bloqueada', 'acoes'], onde);
  if (x.nome !== undefined && (typeof x.nome !== 'string' || x.nome.length > 80)) falhar(`${onde}: "nome" tem de ser texto até 80 caracteres.`);
  if (x.icone !== undefined && x.icone !== null && !ICONES.includes(x.icone)) falhar(`${onde}: "icone" tem de ser ${ICONES.map((c) => `"${c}"`).join(', ')}.`);
  if (x.bloqueada !== undefined && typeof x.bloqueada !== 'boolean') falhar(`${onde}: "bloqueada" tem de ser true ou false.`);
  const acoes = validarAcoesRaiz(x.acoes, onde, ctx, true, 'acoes');
  /** @type {Cena} */
  const r = {
    id: x.id,
    nome: typeof x.nome === 'string' && x.nome.trim() ? x.nome.trim() : x.id,
    bloqueada: x.bloqueada ?? opcoes.bloqueadaPorOmissao ?? false,
    acoes,
  };
  if (typeof x.icone === 'string') r.icone = x.icone;
  return r;
}

/**
 * Valida a lista completa de cenas (`_cenas/set`). As cenas bloqueadas (da
 * empresa) mantêm-se exatamente como estavam e não podem ser apagadas.
 * @param {unknown} lista
 * @param {{aparelhos: Map<string, Aparelho>|null, existentes?: Cena[], admin?: boolean, verificarAparelhos?: boolean, usadas?: Map<string, string>}} contexto
 *   `usadas`: id da cena → nome da automação que a usa (não pode ser apagada)
 * @returns {{ok: true, lista: Cena[]} | {ok: false, erro: string}}
 */
export function validarCenas(lista, { aparelhos, existentes = [], admin = false, verificarAparelhos = true, usadas = new Map() }) {
  try {
    if (!Array.isArray(lista)) falhar('A lista de cenas tem de ser uma lista JSON ([...]).');
    if (lista.length > MAX_CENAS) falhar(`No máximo ${MAX_CENAS} cenas (recebidas ${lista.length}).`);
    const bloqueadas = new Map(existentes.filter((c) => c.bloqueada).map((c) => [c.id, c]));
    const vistos = new Set();
    /** @type {Cena[]} */
    const resultado = [];
    lista.forEach((c, i) => {
      const id = eObjeto(c) ? c.id : undefined;
      if (typeof id === 'string' && vistos.has(id)) falhar(`Há duas cenas com o mesmo id "${id}".`);
      if (typeof id === 'string') vistos.add(id);
      const antiga = !admin && typeof id === 'string' ? bloqueadas.get(id) : undefined;
      if (antiga) {
        resultado.push(structuredClone(antiga)); // da empresa: nada é editável
        return;
      }
      const v = validarCena(c, i, aparelhos, { verificarAparelhos });
      if (!admin && v.bloqueada) falhar(`Cena "${v.id}": só a Domus Energia pode criar cenas bloqueadas.`);
      resultado.push(v);
    });
    if (!admin) {
      for (const id of bloqueadas.keys()) {
        if (!vistos.has(id)) falhar(`A cena "${bloqueadas.get(id).nome}" foi criada pela Domus Energia e não pode ser apagada.`);
      }
    }
    for (const [id, automacao] of usadas) {
      if (!vistos.has(id)) falhar(`A cena "${id}" é usada pela automação "${automacao}" e não pode ser apagada.`);
    }
    return { ok: true, lista: resultado };
  } catch (e) {
    if (e instanceof ErroValidacao) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Cenas usadas por automações: id da cena → nome da (primeira) automação. */
export function cenasUsadas(automacoes) {
  /** @type {Map<string, string>} */
  const r = new Map();
  for (const a of automacoes ?? []) {
    percorrerAcoes(a.entao, (x) => {
      if (x.acao === 'cena' && !r.has(x.cena)) r.set(x.cena, a.nome);
    });
  }
  return r;
}

/**
 * Efeito de cada ação sobre canais: "aparelho/canal" → "liga" | "desliga" | "posição N".
 * @param {any[]} acoes
 */
function efeitos(acoes) {
  /** @type {Map<string, Set<string>>} */
  const r = new Map();
  const juntar = (k, v) => {
    if (!r.has(k)) r.set(k, new Set());
    r.get(k).add(v);
  };
  percorrerAcoes(acoes, (a) => {
    const k = `${a.aparelho}/${a.canal}`;
    if (a.acao === 'ligar') juntar(k, 'liga');
    else if (a.acao === 'desligar') juntar(k, 'desliga');
    else if (a.acao === 'luz') juntar(k, a.brilho > 0 ? 'liga' : 'desliga');
    else if (a.acao === 'estore') juntar(k, `posicao:${a.posicao}`);
  });
  return r;
}

/**
 * Avisos de conflito: duas automações ativas com o mesmo gatilho que mexem no
 * mesmo canal em sentidos opostos (v3 §8). Não bloqueia a gravação.
 * @param {Automacao[]} lista
 * @param {Map<string, Aparelho>|null} aparelhos
 * @returns {{ids: string[], mensagem: string}[]}
 */
export function conflitos(lista, aparelhos) {
  const r = [];
  const ativas = lista.filter((a) => a.ativa);
  for (let i = 0; i < ativas.length; i++) {
    for (let j = i + 1; j < ativas.length; j++) {
      const a = ativas[i];
      const b = ativas[j];
      if (JSON.stringify(a.quando) !== JSON.stringify(b.quando)) continue;
      const ea = efeitos(a.entao);
      const eb = efeitos(b.entao);
      for (const [k, va] of ea) {
        const vb = eb.get(k);
        if (!vb) continue;
        const [idAp, n] = k.split('/');
        const ap = aparelhos?.get(idAp);
        const nome = ap ? nomeCanal(ap, Number(n)) : k;
        let mensagem = null;
        if (va.has('liga') && vb.has('desliga')) mensagem = `'${a.id}' liga e '${b.id}' desliga ${nome} no mesmo gatilho`;
        else if (va.has('desliga') && vb.has('liga')) mensagem = `'${a.id}' desliga e '${b.id}' liga ${nome} no mesmo gatilho`;
        else {
          const pa = [...va].find((x) => x.startsWith('posicao:'));
          const pb = [...vb].find((x) => x.startsWith('posicao:'));
          if (pa && pb && pa !== pb) {
            mensagem = `'${a.id}' põe ${nome} a ${pa.slice(8)} % e '${b.id}' a ${pb.slice(8)} % no mesmo gatilho`;
          }
        }
        if (mensagem) r.push({ ids: [a.id, b.id], mensagem });
      }
    }
  }
  return r;
}
