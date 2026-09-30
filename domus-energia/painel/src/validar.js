// Validação dos dados que chegam da internet. Mensagens em pt-PT.

import { ErroApi } from './http.js';

const CONTROLO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTROLO_LINHA = /[\u0000-\u001f\u007f]/;

export const falha = (msg) => { throw new ErroApi(400, msg); };

/**
 * Texto: aparado; "" e null contam como ausente.
 * @returns {string|null}
 */
export function texto(v, rotulo, { max, min = 1, obrigatorio = false, multilinha = false, re, reMsg } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (obrigatorio) falha(`Indique ${rotulo}.`);
    return null;
  }
  if (typeof v !== 'string') falha(`${maiuscula(rotulo)}: tem de ser texto.`);
  const s = v.trim().normalize('NFC');
  if ((multilinha ? CONTROLO : CONTROLO_LINHA).test(s)) falha(`${maiuscula(rotulo)}: tem caracteres inválidos.`);
  if (s.length < min) falha(`${maiuscula(rotulo)}: demasiado curto.`);
  if (s.length > max) falha(`${maiuscula(rotulo)}: demasiado longo (máx. ${max} caracteres).`);
  if (re && !re.test(s)) falha(reMsg || `${maiuscula(rotulo)}: formato inválido.`);
  return s;
}

export function maiuscula(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function numero(v, rotulo, { min = 0, max, casas = 2, nulo = true } = {}) {
  if (v === null || v === undefined || v === '') {
    if (nulo) return null;
    falha(`Indique ${rotulo}.`);
  }
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) falha(`${maiuscula(rotulo)}: tem de ser um número.`);
  if (n < min || n > max) falha(`${maiuscula(rotulo)}: entre ${min} e ${max}.`);
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

export function booleano(v, rotulo) {
  if (typeof v !== 'boolean') falha(`${maiuscula(rotulo)}: tem de ser true ou false.`);
  return v;
}

export function opcao(v, rotulo, opcoes, { obrigatorio = true } = {}) {
  if ((v === undefined || v === null || v === '') && !obrigatorio) return null;
  if (!opcoes.includes(v)) falha(`Valor inválido em ${rotulo} (use: ${opcoes.join(', ')}).`);
  return v;
}

/** "AAAA-MM-DD" válida. */
export function dia(v, rotulo, { obrigatorio = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (obrigatorio) falha(`Indique ${rotulo}.`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) falha(`${maiuscula(rotulo)}: use o formato AAAA-MM-DD.`);
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) falha(`${maiuscula(rotulo)}: data inválida.`);
  return v;
}

/** "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" (hora de Lisboa). */
export function diaHora(v, rotulo) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') falha(`${maiuscula(rotulo)}: formato inválido.`);
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v);
  if (!m) falha(`${maiuscula(rotulo)}: use AAAA-MM-DD ou AAAA-MM-DDTHH:MM.`);
  dia(m[1], rotulo);
  if (m[2] !== undefined) {
    if (Number(m[2]) > 23 || Number(m[3]) > 59) falha(`${maiuscula(rotulo)}: hora inválida.`);
    return `${m[1]}T${m[2]}:${m[3]}`;
  }
  return m[1];
}

export function hora(v, rotulo) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) falha(`${maiuscula(rotulo)}: use HH:MM.`);
  return v;
}

export const RE_TELEFONE = /^\+?[0-9 ()-]{6,30}$/;

/** Identificador numérico de um caminho (/obras/12). */
export function idNum(s) {
  if (!/^[1-9]\d{0,9}$/.test(s)) throw new ErroApi(404, 'Não encontrado.');
  return Number(s);
}

/**
 * Simulação do simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md §6):
 * objeto JSON até 1 MB; imagens só como data:image/jpeg|png;base64 (nunca SVG
 * nem outros data: URL). Guardada tal como chegou.
 */
export const MAX_SIMULACAO = 1024 * 1024;
const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function simulacao(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) falha('A simulação tem de ser um objeto.');
  const pilha = [[v, 0]];
  let nos = 0;
  while (pilha.length) {
    const [x, prof] = pilha.pop();
    if (++nos > 200_000) falha('A simulação tem demasiados elementos.');
    if (prof > 32) falha('A simulação tem demasiados níveis.');
    if (typeof x === 'string') {
      if (/^\s*data:/i.test(x) && !RE_IMAGEM.test(x)) falha('A simulação só aceita imagens JPEG ou PNG (data:image/jpeg ou data:image/png;base64).');
    } else if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) pilha.push([x[k], prof + 1]);
    }
  }
  const json = JSON.stringify(v);       // depois da verificação da profundidade (stringify é recursivo)
  if (Buffer.byteLength(json) > MAX_SIMULACAO) throw new ErroApi(413, 'A simulação é demasiado grande (máx. 1 MB).');
  casaSimulacao(v.casa);
  limitesPlanta(v.planta);
  fotosSimulacao(v.fotos);
  visitaSimulacao(v.visita, v.urgencia);
  funilSimulacao(v.funil, v.avaria);
  melhoriasSimulacao(v.melhorias, v.melhorias_margem_iva);
  return json;
}

/**
 * Fase 2 (passo "Melhorias"): `melhorias` = lista (opcional; pedidos antigos não a têm) de pacotes aceites
 * {id, nome ≤ 80, itens: [{sku, qtd 1–999}] (≤ 20), preco (€ c/ IVA, ≥ 0, ou null sem catálogo)}, sem ids repetidos;
 * o "Quadro seguro" com o quadro no pedido leva também `quadro_delta` [{sku, qtd −999…999, ≠ 0}] (≤ 30);
 * `melhorias_margem_iva` = a margem dos pacotes no total (€ c/ IVA, 0–1 000 000; opcional).
 */
export const MELHORIAS = ['casa-inteligente', 'poupar-energia', 'seguranca', 'quadro-seguro'];
const RE_SKU_MELHORIA = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
function melhoriasSimulacao(l, margem) {
  if (margem !== undefined && !(typeof margem === 'number' && Number.isFinite(margem) && margem >= 0 && margem <= 1_000_000)) {
    falha('Margem dos pacotes entre 0 e 1 000 000 €.');
  }
  if (l === undefined || l === null) return;
  if (!Array.isArray(l)) falha('As melhorias têm de ser uma lista.');
  if (l.length > MELHORIAS.length) falha(`No máximo ${MELHORIAS.length} melhorias.`);
  const vistas = new Set();
  for (const m of l) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) falha('Melhorias: cada melhoria tem de ser um objeto.');
    if (!MELHORIAS.includes(m.id)) falha(`Melhoria inválida (use: ${MELHORIAS.join(', ')}).`);
    if (vistas.has(m.id)) falha(`A melhoria "${m.id}" aparece repetida.`);
    vistas.add(m.id);
    if (typeof m.nome !== 'string' || !m.nome.trim() || m.nome.length > 80 || CONTROLO_LINHA.test(m.nome)) falha('Melhorias: nome até 80 caracteres.');
    if (!Array.isArray(m.itens) || m.itens.length > 20) falha('Melhorias: os itens têm de ser uma lista (máx. 20).');
    for (const i of m.itens) {
      if (!i || typeof i !== 'object' || typeof i.sku !== 'string' || !RE_SKU_MELHORIA.test(i.sku)) falha('Melhorias: SKU inválido.');
      if (!Number.isInteger(i.qtd) || i.qtd < 1 || i.qtd > 999) falha('Melhorias: quantidade entre 1 e 999.');
    }
    // "Quadro seguro" com o quadro no pedido: a diferença do quadro (com sinal), ≤ 30 linhas, qtd −999…999 (≠ 0).
    if (m.quadro_delta !== undefined) {
      if (m.id !== 'quadro-seguro' || !Array.isArray(m.quadro_delta) || m.quadro_delta.length > 30) falha('Melhorias: diferença do quadro inválida.');
      for (const i of m.quadro_delta) {
        if (!i || typeof i !== 'object' || typeof i.sku !== 'string' || !RE_SKU_MELHORIA.test(i.sku)) falha('Melhorias: SKU inválido.');
        if (!Number.isInteger(i.qtd) || i.qtd === 0 || Math.abs(i.qtd) > 999) falha('Melhorias: quantidade da diferença do quadro entre −999 e 999.');
      }
    }
    if (m.preco !== undefined && m.preco !== null && !(typeof m.preco === 'number' && Number.isFinite(m.preco) && m.preco >= 0 && m.preco <= 1_000_000)) {
      falha('Melhorias: preço entre 0 e 1 000 000 €.');
    }
  }
}

/**
 * Fase 1 (funis): `funil` ∈ primeira, planta, avaria (opcional: pedidos antigos não o têm); `avaria` (só na avaria
 * rápida) = {onde, problema, descricao ≤ 200}, com valores conhecidos.
 */
export const FUNIS = ['primeira', 'planta', 'avaria'];
export const AVARIA_ONDE = ['sala', 'cozinha', 'quarto', 'casa_banho', 'exterior', 'quadro', 'outro'];
export const AVARIA_PROBLEMA = ['sem_corrente', 'luz', 'disjuntor', 'queimado', 'outro'];
function funilSimulacao(funil, a) {
  if (funil !== undefined && funil !== null && !FUNIS.includes(funil)) falha(`Funil inválido (use: ${FUNIS.join(', ')}).`);
  if (a === undefined || a === null) return;
  if (typeof a !== 'object' || Array.isArray(a)) falha('A avaria tem de ser um objeto.');
  if (a.onde !== undefined && a.onde !== null && !AVARIA_ONDE.includes(a.onde)) falha(`Avaria: onde inválido (use: ${AVARIA_ONDE.join(', ')}).`);
  if (a.problema !== undefined && a.problema !== null && !AVARIA_PROBLEMA.includes(a.problema)) falha(`Avaria: problema inválido (use: ${AVARIA_PROBLEMA.join(', ')}).`);
  if (a.descricao !== undefined && a.descricao !== null && (typeof a.descricao !== 'string' || a.descricao.length > 200)) falha('Avaria: descrição até 200 caracteres.');
}

/**
 * Lote 8 (passo Enviar): disponibilidade para a visita {dias: ["seg"…"sab"], periodo: "manha" | "tarde" | "qualquer"}
 * e urgência ("normal" | "semana" | "urgente"). Opcionais (pedidos antigos não os têm).
 */
export const DIAS_VISITA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const PERIODOS_VISITA = ['manha', 'tarde', 'qualquer'];
export const URGENCIAS = ['normal', 'semana', 'urgente'];
function visitaSimulacao(v, urgencia) {
  if (urgencia !== undefined && urgencia !== null && !URGENCIAS.includes(urgencia)) falha(`Urgência inválida (use: ${URGENCIAS.join(', ')}).`);
  if (v === undefined || v === null) return;
  if (typeof v !== 'object' || Array.isArray(v)) falha('A disponibilidade para a visita tem de ser um objeto.');
  if (v.dias !== undefined && v.dias !== null) {
    if (!Array.isArray(v.dias) || v.dias.length > DIAS_VISITA.length || v.dias.some((d) => !DIAS_VISITA.includes(d)) || new Set(v.dias).size !== v.dias.length) {
      falha(`Visita: dias inválidos (use: ${DIAS_VISITA.join(', ')}).`);
    }
  }
  if (v.periodo !== undefined && v.periodo !== null && !PERIODOS_VISITA.includes(v.periodo)) falha(`Visita: período inválido (use: ${PERIODOS_VISITA.join(', ')}).`);
}

/**
 * Metadados das fotos (as fotos vêm depois, em POST /api/orcamento/fotos): lista até 40 de
 * {chave, tipo, divisao, divisao_nome, piso, legenda}; textos curtos. O painel usa-os na galeria.
 */
function fotosSimulacao(f) {
  if (f === undefined || f === null) return;
  if (!Array.isArray(f)) falha('As fotos da simulação têm de ser uma lista.');
  if (f.length > 40) falha('No máximo 40 fotos por pedido.');
  for (const m of f) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) falha('Fotos: cada foto tem de ser um objeto.');
    if (typeof m.chave !== 'string' || !/^(?:quadro|[A-Za-z0-9_-]{1,64}:[a-z0-9_]{1,32})$/.test(m.chave)) falha('Fotos: chave inválida.');
    for (const k of ['tipo', 'divisao', 'divisao_nome', 'legenda']) {
      if (m[k] !== undefined && m[k] !== null && (typeof m[k] !== 'string' || m[k].length > 120)) falha(`Fotos: ${k} até 120 caracteres.`);
    }
  }
}

/**
 * Dados da casa (docs/SIMULADOR-ORCAMENTO.md §6). Tudo opcional (na área de cliente o passo
 * "A casa" é saltado): tipo, n.º de divisões, localidade, potência contratada (escalões em kVA)
 * e ligação ("mono" | "tri"); null ou ausente = não indicado / "Não sei".
 */
export const TIPOS_CASA = ['moradia', 'apartamento', 'alojamento_local', 'servicos', 'industrial', 'outro'];
export const POTENCIAS_KVA = [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7];
export const FASES = ['mono', 'tri'];
function casaSimulacao(c) {
  if (c === undefined || c === null) return;
  if (typeof c !== 'object' || Array.isArray(c)) falha('Os dados da casa da simulação têm de ser um objeto.');
  const vazio = (x) => x === undefined || x === null;
  if (!vazio(c.tipo) && !TIPOS_CASA.includes(c.tipo)) falha(`Casa: tipo inválido (use: ${TIPOS_CASA.join(', ')}).`);
  if (!vazio(c.divisoes) && !(Number.isInteger(c.divisoes) && c.divisoes >= 1 && c.divisoes <= 100)) falha('Casa: n.º de divisões entre 1 e 100.');
  if (!vazio(c.localidade) && (typeof c.localidade !== 'string' || c.localidade.length > 80)) falha('Casa: localidade até 80 caracteres.');
  if (!vazio(c.potencia_contratada_kva) && !POTENCIAS_KVA.includes(c.potencia_contratada_kva)) {
    falha(`Casa: potência contratada inválida (use: ${POTENCIAS_KVA.map((x) => String(x).replace('.', ',')).join(' / ')} kVA, ou vazio se não sabe).`);
  }
  if (!vazio(c.fases) && !FASES.includes(c.fases)) falha('Casa: ligação inválida (use: mono, tri, ou vazio se não sabe).');
}

/**
 * Limites da planta (docs/SIMULADOR-ORCAMENTO.md §2.1): ≤ 40 divisões, ≤ 400 elementos,
 * largura/altura ≤ 10 000 cm, imagem de fundo ≤ 700 KB. O visualizador do painel desenha
 * a planta: sem isto um pedido público podia pedir uma grelha de milhões de linhas.
 */
export const LIMITES_PLANTA = { divisoes: 40, elementos: 400, lado_cm: 10_000, imagem: 700 * 1024, escala_min: 10, escala_max: 1000 };
function limitesPlanta(p) {
  if (p === undefined || p === null) return;
  if (typeof p !== 'object' || Array.isArray(p)) falha('A planta da simulação tem de ser um objeto.');
  const L = LIMITES_PLANTA;
  for (const [k, max, rot] of [['divisoes', L.divisoes, 'divisões'], ['elementos', L.elementos, 'elementos']]) {
    if (p[k] === undefined || p[k] === null) continue;
    if (!Array.isArray(p[k])) falha(`Planta: ${rot} tem de ser uma lista.`);
    if (p[k].length > max) falha(`Planta: no máximo ${max} ${rot}.`);
  }
  for (const k of ['largura_cm', 'altura_cm']) {
    const x = p[k];
    if (x !== undefined && x !== null && !(typeof x === 'number' && x > 0 && x <= L.lado_cm)) falha(`Planta: ${k} entre 1 e ${L.lado_cm} cm.`);
  }
  const e = p.escala_cm;
  if (e !== undefined && e !== null && !(typeof e === 'number' && e >= L.escala_min && e <= L.escala_max)) falha(`Planta: escala_cm entre ${L.escala_min} e ${L.escala_max}.`);
  const img = typeof p.fundo === 'string' ? p.fundo : p.fundo && typeof p.fundo === 'object' ? p.fundo.imagem : null;
  if (typeof img === 'string' && img.length > L.imagem) falha('Planta: a imagem de fundo tem no máximo 700 KB.');
}
