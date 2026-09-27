// Simulador de orçamento — estado, gravação no navegador e corpo do pedido
// (docs/SIMULADOR-ORCAMENTO.md §1, §2.1, §6). Só lógica, sem DOM.

import {
  ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, AMPERES, TIPOS_CIRCUITO, TIPOS_CASA, ELEMENTOS, MODELOS, POTENCIAS_KVA, FASES,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_QUER, PEQUENAS_QUER, OBJETIVOS, TIPOS_TELECOM,
  plantaVazia, plantaTemConteudo, atualizarDivisoes, avisosQuadro, divisaoVazia, circuitoVazio, validarPontos, definirPontos,
  perfilCasa, maquinasGrandesDe, maquinasPequenasDe, objetivosDe, sugerirFases,
} from "./regras.js";
import { SKU_SY1, SKU_SY2 } from "./preco.js";
import { divisoesDaCasa, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO } from "./casa.js";

export const VERSAO = 1;
export const CHAVE = "domus.simulador";
export const CHAVE_CODIGO = "domus.simulador.codigo";   // sessionStorage: código do cliente vindo da área de cliente
export const MAX_SIMULACAO = 1024 * 1024;                // bytes (painel/src/validar.js)
export const MAX_IMAGEM = 700 * 1024;                    // data URL da imagem de fundo
export const PASSOS = ["A casa", "O que quer", "Planta", "Divisões", "Quadro elétrico", "Resumo e preço", "Enviar"];
/**
 * Ordem dos passos gravada no estado (`ordem`: 3 = a de PASSOS, com o quadro depois das divisões).
 * Os estados antigos são migrados ao carregar; cada lista dá, para o passo antigo, o passo novo:
 * - sem `passos` (6 passos, antes de "O que quer"): casa, planta, quadro, divisões, preço, enviar;
 * - `passos: 7` sem `ordem`: casa, o que quer, planta, quadro, divisões, preço, enviar;
 * - `ordem: 2` (versão de testes, nunca publicada): casa, o que quer, divisões, planta, quadro, preço, enviar.
 */
export const ORDEM = 3;
const MIGRAR = { 6: [0, 2, 4, 3, 5, 6], 7: [0, 1, 2, 4, 3, 5, 6], ordem2: [0, 1, 3, 2, 4, 5, 6] };
export const SERVICO = "Simulador de orçamento";
export const SERVICO_CLIENTE = "Ampliar a instalação (simulador)";

// Os mesmos formatos que o painel aceita (painel/src/validar.js, pedidos.js, dados.js).
export const RE_TELEFONE = /^\+?[0-9 ()-]{6,30}$/;
export const RE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
export const RE_ID = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
export const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROLO_LINHA = /[\u0000-\u001f\u007f]/g;
const CONTROLO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Casa por omissão: no site já com T2 (e a ligação sugerida, monofásica); na área de cliente tipo
 * e tipologia por escolher. `area_m2` e `espacos` só contam em serviços e industrial.
 */
export function casaNova(cliente = false) {
  return {
    tipo: cliente ? null : "moradia", tipologia: cliente ? null : "T2", quartos: cliente ? null : 2, casas_banho: 1, salas: 1, pisos: 1,
    extras: { jardim: false, garagem: false, varanda: false, kitnet: false },
    area_m2: null, espacos: null,
    divisoes: null, localidade: "", potencia_contratada_kva: null, fases: cliente ? null : "mono",
  };
}

/**
 * Estado inicial. Na área de cliente ("Ampliar a instalação", com código de cliente) a casa já
 * é conhecida: começa em "O que quer" e os dados da casa são opcionais (tipo por escolher).
 */
export function estadoNovo({ cliente = false } = {}) {
  return {
    versao: VERSAO,
    passos: PASSOS.length,
    ordem: ORDEM,
    passo: cliente ? 1 : 0,
    visitado: cliente ? 1 : 0, // passo mais adiantado a que o cliente já chegou
    guardado: null,
    casa: casaNova(cliente),
    fasesEditadas: false,      // o cliente escolheu a ligação: já não a sugerimos
    quer: { maquinas: [], pequenas: [], objetivos: [] },
    planta: plantaVazia(),
    plantaSaltada: false,
    plantaAuto: false,         // a planta é a que desenhámos a partir das divisões e o cliente ainda não lhe mexeu
    plantaBase: null,          // assinaturaCasa() da casa e das máquinas com que a planta foi desenhada
    quadro: { circuitos: [], disjuntor: SKU_SY2 },
    quadroEditado: false,     // o cliente mexeu no quadro: não recalcular sozinho
    divisoes: [],
    divisoesEditadas: false,  // o cliente mexeu na lista de divisões: não a refazemos sozinhos
    extras: { central: false, termostatos: 0 },
    termostatosEditados: false, // o cliente mudou os termóstatos: o objetivo "aquecimento" já não os muda
    contacto: { nome: "", telefone: "", email: "", localidade: "", mensagem: "" },
  };
}

// ------------------------------------------------------------ normalização

const num = (v, min, max, omissao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : omissao;
};
const int = (v, min, max, omissao = 0) => Math.round(num(v, min, max, omissao));
const txt = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v) => v === true;
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export function normalizarPlanta(p) {
  const r = plantaVazia();
  if (!p || typeof p !== "object") return r;
  r.largura_cm = int(p.largura_cm, 100, MAX_LADO_CM, 2000);
  r.altura_cm = int(p.altura_cm, 100, MAX_LADO_CM, 1500);
  const f = p.fundo;
  if (f && typeof f === "object" && typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem) && f.imagem.length <= MAX_IMAGEM) {
    r.fundo = { imagem: f.imagem, x_cm: int(f.x_cm, -MAX_LADO_CM, MAX_LADO_CM), y_cm: int(f.y_cm, -MAX_LADO_CM, MAX_LADO_CM), largura_cm: int(f.largura_cm, 10, 2 * MAX_LADO_CM, r.largura_cm), opacidade: Math.round(num(f.opacidade, 0.1, 1, 0.5) * 100) / 100 };
  }
  const ids = new Set();
  const idOk = (id, pre) => typeof id === "string" && new RegExp(`^${pre}\\d{1,6}$`).test(id) && !ids.has(id);
  for (const d of lista(p.divisoes, MAX_DIVISOES)) {
    if (!d || typeof d !== "object" || !idOk(d.id, "d")) continue;
    ids.add(d.id);
    const n = { id: d.id, nome: txt(d.nome, 60), x_cm: int(d.x_cm, 0, MAX_LADO_CM), y_cm: int(d.y_cm, 0, MAX_LADO_CM), largura_cm: int(d.largura_cm, 50, MAX_LADO_CM, 400), altura_cm: int(d.altura_cm, 50, MAX_LADO_CM, 300) };
    // Polígono (paredes oblíquas): 3–24 cantos dentro da planta, sem paredes cruzadas; senão fica o retângulo.
    // Com cantos válidos, a caixa envolvente passa a ser a deles (um retângulo "normal" fica sem `pontos`).
    const pts = d.pontos === undefined ? null : validarPontos(d.pontos, r.largura_cm, r.altura_cm);
    r.divisoes.push(pts ? definirPontos(n, pts) : n);
  }
  for (const e of lista(p.elementos, MAX_ELEMENTOS)) {
    if (!e || typeof e !== "object" || !idOk(e.id, "e") || !ELEMENTOS[e.tipo]) continue;
    ids.add(e.id);
    r.elementos.push({ id: e.id, tipo: e.tipo, x_cm: int(e.x_cm, 0, MAX_LADO_CM), y_cm: int(e.y_cm, 0, MAX_LADO_CM), rot: [0, 90, 180, 270].includes(e.rot) ? e.rot : 0, divisao: null, props: normalizarProps(e.tipo, e.props) });
  }
  return atualizarDivisoes(r);
}

/** Só as propriedades da tabela do §2 para cada tipo, com tipos certos. */
export function normalizarProps(tipo, p) {
  const o = ELEMENTOS[tipo]?.props ?? {};
  const v = p && typeof p === "object" ? p : {};
  const r = {};
  for (const k of Object.keys(o)) {
    if (k === "botoes") r.botoes = int(v.botoes, 1, 4, 1);
    else if (k === "modelo") r.modelo = MODELOS[v.modelo] ? v.modelo : o.modelo;
    else if (k === "potencia_w") r.potencia_w = int(v.potencia_w, 0, 100_000, MODELOS[r.modelo]?.w ?? o.potencia_w);
    else r[k] = bool(v[k]);
  }
  if (tipo === "janela" && !r.estore) r.motorizado = false;
  return r;
}

export function normalizarCircuito(c, i) {
  const b = circuitoVazio(i + 1);
  if (!c || typeof c !== "object") return b;
  const it = c.itens && typeof c.itens === "object" ? c.itens : {};
  return {
    n: i + 1,
    amperes: AMPERES.includes(c.amperes) ? c.amperes : 16,
    tipo: TIPOS_CIRCUITO[c.tipo] ? c.tipo : "misto",
    nome: txt(c.nome, 60),
    divisoes: lista(c.divisoes, MAX_DIVISOES).filter((x) => typeof x === "string").map((x) => x.slice(0, 60)),
    itens: {
      luzes: int(it.luzes, 0, 99),
      tomadas: int(it.tomadas, 0, 99),
      maquinas: lista(it.maquinas, 20).filter((m) => m && typeof m === "object").map((m) => {
        const modelo = MODELOS[m.modelo] ? m.modelo : "outro";
        return { modelo, potencia_w: int(m.potencia_w, 0, 100_000, MODELOS[modelo].w) };
      }),
    },
    inteligente: bool(c.inteligente),
    medir: bool(c.medir),
  };
}

export function normalizarDivisao(d) {
  const b = divisaoVazia();
  if (!d || typeof d !== "object") return b;
  return {
    nome: txt(d.nome, 60),
    planta_id: typeof d.planta_id === "string" ? d.planta_id.slice(0, 10) : null,
    interruptores: lista(d.interruptores, 30).map((x) => int(x, 1, 4, 1)),
    estores: int(d.estores, 0, 99),
    estores_sem_motor: int(d.estores_sem_motor, 0, 99),
    sensores_porta: int(d.sensores_porta, 0, 99),
    sensores_movimento: int(d.sensores_movimento, 0, 99),
    luzes_regulaveis: int(d.luzes_regulaveis, 0, 99),
    tomadas_inteligentes: int(d.tomadas_inteligentes, 0, 99),
  };
}

/** Estado lido do navegador (pode vir estragado ou de outra versão): sempre um estado válido. */
export function normalizarEstado(v) {
  const e = estadoNovo();
  if (!v || typeof v !== "object" || v.versao !== VERSAO) return null;
  // Estados antigos (6 passos; 7 passos com outra ordem): o passo antigo passa ao novo (MIGRAR);
  // o cliente pode voltar pela barra a qualquer passo que já tinha visto.
  const migrar = v.passos !== PASSOS.length ? MIGRAR[6] : v.ordem === 2 ? MIGRAR.ordem2 : v.ordem !== ORDEM ? MIGRAR[7] : null;
  const passo = int(v.passo, 0, (migrar ? migrar.length : PASSOS.length) - 2);   // nunca volta direto ao "Enviar"
  e.passo = migrar ? migrar[passo] : passo;
  e.visitado = migrar ? Math.max(...migrar.slice(0, passo + 1)) : Math.max(e.passo, int(v.visitado, 0, PASSOS.length - 2));
  e.guardado = typeof v.guardado === "string" ? v.guardado.slice(0, 40) : null;
  const c = v.casa && typeof v.casa === "object" ? v.casa : {};
  const x = c.extras && typeof c.extras === "object" ? c.extras : {};
  const tipologia = TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;   // estado antigo: sem tipologia
  const tipo = TIPOS_CASA[c.tipo] ? c.tipo : c.tipo === null ? null : "moradia";
  const perfil = perfilCasa(tipo);
  e.casa = {
    tipo,
    tipologia,
    quartos: tipologia === "T5+" ? int(c.quartos, 5, LIMITES_CASA.quartos[1], 5) : quartosDe({ tipologia }),
    casas_banho: int(c.casas_banho, ...LIMITES_CASA.casas_banho, casasBanhoOmissao(tipologia)),
    salas: int(c.salas, ...LIMITES_CASA.salas, salasOmissao(tipologia)),
    // Só as moradias têm mais de um piso.
    pisos: tipo === "moradia" ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1,
    extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(x[k])])),
    area_m2: perfil === "habitacao" ? null : int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[perfil]),
    espacos: perfil === "habitacao" ? null : int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[perfil]),
    divisoes: c.divisoes == null || c.divisoes === "" ? null : int(c.divisoes, 1, 40, 1),
    localidade: txt(c.localidade, 80),
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva),
    fases: FASES[c.fases] ? c.fases : null,
  };
  // Estado antigo: uma ligação já escolhida conta como escolhida pelo cliente; "Não sei" continua sugerível.
  e.fasesEditadas = v.fasesEditadas === undefined ? e.casa.fases !== null : bool(v.fasesEditadas);
  e.quer = normalizarQuer(v.quer, tipo);
  e.planta = normalizarPlanta(v.planta);
  e.plantaSaltada = bool(v.plantaSaltada);
  e.plantaAuto = bool(v.plantaAuto);
  // A assinatura de um estado antigo não se compara com a de agora (tem outros campos): fica sem base.
  e.plantaBase = !migrar && typeof v.plantaBase === "string" ? v.plantaBase.slice(0, 1000) : null;
  const q = v.quadro && typeof v.quadro === "object" ? v.quadro : {};
  e.quadro = { circuitos: lista(q.circuitos, 60).map(normalizarCircuito), disjuntor: q.disjuntor === SKU_SY1 ? SKU_SY1 : SKU_SY2 };
  e.quadroEditado = bool(v.quadroEditado);
  e.divisoes = lista(v.divisoes, MAX_DIVISOES + 1).map(normalizarDivisao);
  e.divisoesEditadas = bool(v.divisoesEditadas);
  const ex = v.extras && typeof v.extras === "object" ? v.extras : {};
  e.extras = { central: bool(ex.central), termostatos: int(ex.termostatos, 0, 20) };
  // Estado antigo: termóstatos já escolhidos contam como mexidos (o objetivo "aquecimento" não os apaga).
  e.termostatosEditados = v.termostatosEditados === undefined ? e.extras.termostatos > 0 : bool(v.termostatosEditados);
  const k = v.contacto && typeof v.contacto === "object" ? v.contacto : {};
  e.contacto = { nome: txt(k.nome, 120), telefone: txt(k.telefone, 30), email: txt(k.email, 254), localidade: txt(k.localidade, 80), mensagem: txt(k.mensagem, 2000) };
  return e;
}

/**
 * Máquinas grandes, pequenas e objetivos do passo "O que quer": só as chaves conhecidas (as do perfil
 * do imóvel, quando `tipo` é dado), sem repetidos, pela ordem das listas.
 */
export function normalizarQuer(q, tipo = undefined) {
  const o = q && typeof q === "object" ? q : {};
  const so = (v, chaves) => (Array.isArray(v) ? chaves.filter((k) => v.includes(k)) : []);
  const porTipo = tipo !== undefined;
  return {
    maquinas: so(o.maquinas, porTipo ? maquinasGrandesDe(tipo) : MAQUINAS_QUER),
    pequenas: so(o.pequenas, porTipo ? maquinasPequenasDe(tipo) : PEQUENAS_QUER),
    objetivos: so(o.objetivos, porTipo ? objetivosDe(tipo) : Object.keys(OBJETIVOS)),
  };
}

/** Todas as máquinas escolhidas (grandes e pequenas), para desenhar a planta. */
export const maquinasEscolhidas = (quer) => [...(quer?.maquinas ?? []), ...(quer?.pequenas ?? [])];

/** Ligação sugerida pelo tipo e pelas máquinas (regras.js sugerirFases). */
export const fasesSugeridas = (estado) => sugerirFases(estado.casa?.tipo ?? null, maquinasEscolhidas(estado.quer));

/** Potência contratada (kVA) de um dos escalões, ou null ("Não sei"). */
export function potenciaContratada(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return POTENCIAS_KVA.includes(n) ? n : null;
}

/** Opções dos avisos do quadro: disjuntor escolhido e a instalação da casa (§4). */
export const opcoesAvisos = (estado) => ({
  disjuntor: estado.quadro?.disjuntor,
  fases: estado.casa?.fases ?? null,
  potencia_contratada_kva: estado.casa?.potencia_contratada_kva ?? null,
});

/** Houve progresso que valha a pena retomar? (`passoInicial`: 1 na área de cliente, que começa em "O que quer") */
export function temProgresso(e, passoInicial = 0) {
  return !!e && (e.passo > passoInicial || e.casa.potencia_contratada_kva !== null || e.casa.fases !== null || plantaTemConteudo(e.planta) || e.quadro.circuitos.length > 0 || e.divisoes.length > 0 || !!e.casa.localidade);
}

// ------------------------------------------------------------ navegador (localStorage)

/**
 * Guarda o estado. Se não couber (quota), tenta sem a imagem de fundo.
 * @returns {"ok"|"sem_imagem"|"falhou"}
 */
export function guardarEstado(storage, estado, agora = new Date()) {
  const e = { ...estado, guardado: agora.toISOString() };
  try {
    storage.setItem(CHAVE, JSON.stringify(e));
    return "ok";
  } catch {
    if (!estado.planta?.fundo) return "falhou";
    try {
      storage.setItem(CHAVE, JSON.stringify({ ...e, planta: { ...e.planta, fundo: null } }));
      return "sem_imagem";
    } catch {
      return "falhou";
    }
  }
}

export function carregarEstado(storage) {
  try {
    const bruto = storage.getItem(CHAVE);
    if (!bruto) return null;
    return normalizarEstado(JSON.parse(bruto));
  } catch {
    return null;
  }
}

export function apagarEstado(storage) {
  try { storage.removeItem(CHAVE); } catch { /* navegador sem armazenamento */ }
}

/** Código do cliente passado pela área de cliente (sessionStorage); null se não houver ou for inválido. */
export function lerCodigoCliente(storage) {
  try {
    const c = String(storage.getItem(CHAVE_CODIGO) ?? "").trim().toLowerCase();
    return RE_ID.test(c) ? c : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ corpo do pedido (§6)

/**
 * Texto do cliente seguro para a simulação: sem caracteres de controlo e sem
 * começar por "data:" (o painel só aceita data: de imagens JPEG/PNG).
 */
export function textoSeguro(v, max = 120, multilinha = false) {
  let s = String(v ?? "").replace(multilinha ? CONTROLO : CONTROLO_LINHA, " ").trim().normalize("NFC").slice(0, max);
  if (/^\s*data:/i.test(s)) s = `«${s}»`.slice(0, max);
  return s;
}

/** Planta no formato exato do §2.1 (ou null quando não há nada desenhado). */
export function plantaParaEnvio(planta) {
  if (!plantaTemConteudo(planta)) return null;
  const p = normalizarPlanta(planta);
  return {
    escala_cm: ESCALA_CM,
    largura_cm: p.largura_cm,
    altura_cm: p.altura_cm,
    fundo: p.fundo ? { imagem: p.fundo.imagem, x_cm: p.fundo.x_cm, y_cm: p.fundo.y_cm, largura_cm: p.fundo.largura_cm, opacidade: p.fundo.opacidade } : null,
    divisoes: p.divisoes.map((d) => ({
      id: d.id, nome: textoSeguro(d.nome, 60) || "Divisão", x_cm: d.x_cm, y_cm: d.y_cm, largura_cm: d.largura_cm, altura_cm: d.altura_cm,
      ...(d.pontos ? { pontos: d.pontos.map((q) => [q[0], q[1]]) } : {}),
    })),
    elementos: p.elementos.map((e) => ({ id: e.id, tipo: e.tipo, x_cm: e.x_cm, y_cm: e.y_cm, rot: e.rot, divisao: e.divisao, props: { ...e.props } })),
  };
}

/**
 * `simulacao.casa` (§6). Com tipologia (ou em serviços/industrial), `divisoes` é o total das divisões
 * que a casa gera, incluindo o "Exterior" que as máquinas acrescentam (compatível com o antigo "Quantas
 * divisões tem?"); sem tipologia os campos novos vão a null. Serviços e industrial: `area_m2` e
 * `espacos` (sem tipologia).
 */
export function casaParaEnvio(estado) {
  const c = estado.casa;
  const negocio = perfilCasa(c.tipo) !== "habitacao";
  const tipologia = !negocio && TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;
  return {
    tipo: TIPOS_CASA[c.tipo] ? c.tipo : null,
    divisoes: tipologia || negocio ? divisoesDaCasa(c, maquinasEscolhidas(estado.quer)).length : c.divisoes ?? (estado.divisoes.length || null),
    localidade: textoSeguro(c.localidade || estado.contacto.localidade, 80) || null,
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva),
    fases: FASES[c.fases] ? c.fases : null,
    tipologia,
    quartos: tipologia ? quartosDe(c) : null,
    casas_banho: tipologia ? int(c.casas_banho, ...LIMITES_CASA.casas_banho, 1) : null,
    salas: tipologia && tipologia !== "T0" ? int(c.salas, ...LIMITES_CASA.salas, 1) : null,
    pisos: tipologia ? (c.tipo === "moradia" ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1) : null,
    extras: tipologia ? Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(c.extras?.[k])])) : null,
    area_m2: negocio ? int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[c.tipo]) : null,
    espacos: negocio ? int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[c.tipo]) : null,
  };
}

/**
 * Resumo das telecomunicações (ITED) desenhadas na planta — "brevemente": fora do preço e dos
 * circuitos, orçamentadas na visita. `pontos`: n.º de cada tipo (ati, rj45, coaxial, fibra, wifi).
 */
export function telecomParaEnvio(estado) {
  const els = estado.plantaSaltada ? [] : estado.planta?.elementos ?? [];
  const pontos = Object.fromEntries(TIPOS_TELECOM.map((t) => [t.replace(/^telecom_/, ""), els.filter((e) => e.tipo === t).length]));
  return { estado: "brevemente", texto: "Telecomunicações: brevemente — orçamento na visita.", pontos, total: Object.values(pontos).reduce((s, n) => s + n, 0) };
}

/**
 * `simulacao` do POST /api/orcamento (§6).
 * @param {object} estado
 * @param {ReturnType<import("./preco.js").calcularPreco>} preco
 * @param {string} plano  base | conforto | premium
 */
export function montarSimulacao(estado, preco, plano) {
  const circuitos = estado.quadro.circuitos.map((c, i) => {
    const n = normalizarCircuito(c, i);
    return { ...n, nome: textoSeguro(n.nome, 60), divisoes: n.divisoes.map((d) => textoSeguro(d, 60)).filter(Boolean) };
  });
  return {
    versao: VERSAO,
    casa: casaParaEnvio(estado),
    quer: normalizarQuer(estado.quer, estado.casa.tipo),
    planta: estado.plantaSaltada ? null : plantaParaEnvio(estado.planta),
    telecom: telecomParaEnvio(estado),
    quadro: { circuitos },
    divisoes: estado.divisoes.map((d) => {
      const n = normalizarDivisao(d);
      return {
        nome: textoSeguro(n.nome, 60) || "Divisão", interruptores: n.interruptores, estores: n.estores, estores_sem_motor: n.estores_sem_motor,
        sensores_porta: n.sensores_porta, sensores_movimento: n.sensores_movimento, luzes_regulaveis: n.luzes_regulaveis, tomadas_inteligentes: n.tomadas_inteligentes,
      };
    }),
    itens: preco.linhas.map((l) => ({ sku: l.sku, qtd: l.qtd, preco_iva: l.preco_iva })),
    mao_obra: { horas: preco.horas, valor_iva: preco.mao_obra_iva },
    total: { min: preco.min, max: preco.max },
    plano_sugerido: plano,
    avisos: avisosQuadro(circuitos, opcoesAvisos(estado)),
  };
}

export const bytes = (s) => new TextEncoder().encode(s).length;

/** Problema no contacto (as mesmas regras do painel) ou null. */
export function problemaContacto(k) {
  const t = (v) => String(v ?? "").trim();
  if (!t(k.nome)) return { campo: "nome", texto: "Escreva o seu nome." };
  if (t(k.nome).length > 120) return { campo: "nome", texto: "O nome é demasiado longo (máx. 120 caracteres)." };
  if (!t(k.telefone) && !t(k.email)) return { campo: "telefone", texto: "Indique um telefone ou um email para o podermos contactar." };
  if (t(k.telefone) && !RE_TELEFONE.test(t(k.telefone))) return { campo: "telefone", texto: "O telefone não parece certo: escreva o número completo (ex.: 912 345 678)." };
  if (t(k.email) && (t(k.email).length > 254 || !RE_EMAIL.test(t(k.email)))) return { campo: "email", texto: "O email não parece certo (ex.: nome@exemplo.pt)." };
  if (t(k.localidade).length > 80) return { campo: "localidade", texto: "A localidade é demasiado longa (máx. 80 caracteres)." };
  if (t(k.mensagem).length > 2000) return { campo: "mensagem", texto: "A mensagem é demasiado longa (máx. 2000 caracteres)." };
  return null;
}

/**
 * Corpo do POST /api/orcamento: textos aparados, campos opcionais vazios de fora.
 * `website` é o campo-armadilha (só vai se estiver preenchido).
 */
export function montarPedido(estado, simulacao, { codigo = null, website = "" } = {}) {
  const k = estado.contacto;
  const corpo = { nome: textoSeguro(k.nome, 120), servico: codigo ? SERVICO_CLIENTE : SERVICO };
  const tel = String(k.telefone ?? "").trim();
  const email = String(k.email ?? "").trim();
  const loc = textoSeguro(k.localidade || estado.casa.localidade, 80);
  const msg = String(k.mensagem ?? "").replace(CONTROLO, " ").trim().slice(0, 2000);
  if (tel) corpo.telefone = tel;
  if (email) corpo.email = email;
  if (loc) corpo.localidade = loc;
  if (msg) corpo.mensagem = msg;
  if (String(website ?? "").trim()) corpo.website = String(website).trim();
  if (codigo && RE_ID.test(codigo)) corpo.codigo_cliente = codigo;
  corpo.simulacao = simulacao;
  return corpo;
}

/** A simulação cabe no limite do painel (1 MB)? */
export const tamanhoSimulacao = (sim) => bytes(JSON.stringify(sim));
