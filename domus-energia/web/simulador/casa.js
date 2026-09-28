// Simulador de orçamento — pré-preenchimento a partir dos passos "A casa" e "O que quer"
// (docs/SIMULADOR-ORCAMENTO.md §1.1). Só lógica, sem DOM: lista de divisões pela tipologia (ou,
// em serviços e industrial, pela área e o n.º de espaços), planta já desenhada (divisões em grelha,
// sem sobreposição, os aparelhos base de cada uma — porta, interruptor, luz e tomadas — e as máquinas escolhidas,
// grandes e pequenas) e as dicas do passo 4 a partir dos objetivos (que já não acrescentam aparelhos).

import {
  TIPOS_DIVISAO, TIPOS_DIVISAO_SERVICOS, TIPOS_DIVISAO_INDUSTRIAL, LIMITES_CASA, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, ESCALA_CM,
  plantaVazia, propsOmissao, atualizarDivisoes, perfilCasa, tiposDivisaoPara, EXTRAS_CASA, MAX_PISO,
  TIPOS_COM_PISOS, tipologiaDeQuartos, temPergunta,
} from "./regras.js";

const MARGEM = 50;            // cm à volta da planta
const LARGURA_LINHA = 1500;   // cm: largura máxima de uma linha de divisões
const PASSO_MAQUINA = 100;    // cm entre máquinas na mesma divisão (os ícones não se tocam)
const M2_POR_LUZ = 20;        // divisões grandes (loja, nave): um ponto de luz por cada 20 m²
const MAX_LUZES = 8;

/** Tamanhos (cm) das divisões que não têm botão no editor; as outras vêm dos botões (TIPOS_DIVISAO…). */
const TAMANHOS = {
  "Sala de estar": [500, 400], "Sala de jantar": [400, 350], "Kitnet": [650, 400],
  "Estúdio": [600, 450], "Escadas": [200, 300], "Exterior": [500, 300], "Oficina": [800, 600], "Arrecadação": [250, 200],
};
/** Tamanho típico pelo nome; os botões do tipo de imóvel da casa têm prioridade (ex.: Escritório). */
function tamanho(nome, casa) {
  const base = nome.replace(/ \((piso \d+|r\/c)\)$/, "").replace(/ \d+$/, "");
  if (TAMANHOS[base]) return TAMANHOS[base];
  const t = [...tiposDivisaoPara(casa?.tipo), ...TIPOS_DIVISAO, ...TIPOS_DIVISAO_SERVICOS, ...TIPOS_DIVISAO_INDUSTRIAL].find((x) => x.nome === base);
  return t ? [t.w, t.h] : [400, 300];
}

const semAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Tipo de uma divisão pelo nome (também as que o cliente escreveu): sala, sala_cozinha, cozinha
 * (também a copa), quarto, wc (também instalações sanitárias e vestiários), corredor, entrada, escadas,
 * garagem (também arrumos), jardim (também exterior e cais), varanda, lavandaria, escritorio, despensa,
 * loja, rececao, montra, nave (oficina, fábrica), armazem ou outra.
 */
export function tipoDivisao(nome) {
  const s = semAcentos(nome);
  if (/^kitnet/.test(s) || (/cozinha/.test(s) && /sala|estudio/.test(s))) return "sala_cozinha";
  if (/^(cozinha|kitchenette|copa)/.test(s)) return "cozinha";
  if (/^(loja|sala aberta|restaurante)/.test(s)) return "loja";
  if (/^(sala|estudio|living)/.test(s)) return "sala";
  if (/^(quarto|suite)/.test(s)) return "quarto";
  if (/^(casa de banho|wc|banho|lavabo|instalacoes sanitarias|vestiario)/.test(s)) return "wc";
  if (/^(corredor|hall)/.test(s)) return "corredor";
  if (/^entrada/.test(s)) return "entrada";
  if (/^escada/.test(s)) return "escadas";
  if (/^(garagem|arrecadacao|arrumos)/.test(s)) return "garagem";
  if (/^(jardim|exterior|quintal|piscina|logradouro|cais)/.test(s)) return "jardim";
  if (/^(varanda|terraco|marquise)/.test(s)) return "varanda";
  if (/^lavandaria/.test(s)) return "lavandaria";
  if (/^escritorio/.test(s)) return "escritorio";
  if (/^despensa/.test(s)) return "despensa";
  if (/^rececao/.test(s)) return "rececao";
  if (/^montra/.test(s)) return "montra";
  if (/^(nave|oficina|fabrica)/.test(s)) return "nave";
  if (/^armazem/.test(s)) return "armazem";
  return "outra";
}

/** N.º de quartos pela tipologia (T5+: o que o cliente indicou, 5–12); null sem tipologia. */
export function quartosDe(casa) {
  const t = casa?.tipologia;
  if (!t) return null;
  if (t === "T5+") return Math.min(12, Math.max(5, Math.round(Number(casa.quartos) || 5)));
  return Number(t.slice(1)) || 0;
}

/** Valores típicos ao escolher a tipologia (o cliente ajusta depois): casas de banho e salas. */
const TIPICO = { T0: [1, 1], T1: [1, 1], T2: [1, 1], T3: [2, 1], T4: [2, 2], "T5+": [3, 2] };
export const casasBanhoOmissao = (tipologia) => TIPICO[tipologia]?.[0] ?? 1;
export const salasOmissao = (tipologia) => TIPICO[tipologia]?.[1] ?? 1;

/** Serviços e industrial: área (m²) e n.º de espaços típicos, e os espaços pela ordem em que se acrescentam. */
export const AREA_OMISSAO = { servicos: 80, industrial: 300 };
export const ESPACOS_OMISSAO = { servicos: 4, industrial: 5 };
const ESPACOS = {
  servicos: { principal: "Loja / sala aberta", outros: ["Instalações sanitárias", "Escritório", "Copa", "Arrumos", "Receção", "Montra"], mais: "Escritório" },
  industrial: { principal: "Nave / oficina", outros: ["Instalações sanitárias", "Escritório", "Armazém", "Vestiários", "Cais / exterior"], mais: "Oficina" },
};

// Área de cliente sem tipologia: a lista antiga pelo n.º de divisões (3 se não indicado).
const ORDEM_SEM_TIPOLOGIA = ["Sala", "Cozinha", "Quarto", "WC", "Quarto 2", "Corredor", "Quarto 3", "Casa de banho", "Escritório", "Entrada", "Lavandaria", "Garagem", "Varanda", "Despensa", "Exterior"];

/** Divide `n` coisas por `k` pisos (as primeiras levam mais). */
const repartir = (n, k) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
const inteiro = (v, [min, max], omissao) => Math.min(max, Math.max(min, Math.round(Number(v ?? omissao)) || 0));

/** Máquinas que precisam de um sítio exterior (tipos de divisão que servem); sem nenhum, acrescenta "Exterior". */
const PRECISA_EXTERIOR = {
  carregador_ve: ["garagem", "jardim"], carregador_ve_22: ["garagem", "jardim", "nave"], bomba: ["jardim"],
  rega: ["jardim"], iluminacao_jardim: ["jardim"], portao: ["garagem", "jardim"],
};

/**
 * Espaços de serviços e industrial: o principal (loja / sala aberta, nave / oficina) fica com a área
 * que sobra dos outros (tamanhos típicos), no mínimo 40 % da área e 15 m², na proporção 4 × 3.
 */
function espacosNegocio(c) {
  const perfil = perfilCasa(c.tipo);
  const e = ESPACOS[perfil];
  const n = inteiro(c.espacos, LIMITES_CASA.espacos, ESPACOS_OMISSAO[perfil]);
  const area = inteiro(c.area_m2, LIMITES_CASA.area_m2, AREA_OMISSAO[perfil]);
  const nomes = [e.principal, ...e.outros].slice(0, n);
  for (let k = 2; nomes.length < n; k++) nomes.push(`${e.mais} ${k}`);
  const outros = nomes.slice(1).reduce((s, x) => { const [w, h] = tamanho(x, c); return s + w * h; }, 0);
  const cm2 = Math.max(area * 1e4 * 0.4, area * 1e4 - outros, 15e4);
  const grelha = (v) => Math.max(ESCALA_CM * 4, Math.round(v / ESCALA_CM) * ESCALA_CM);
  const w = Math.min(MAX_LADO_CM - 2 * MARGEM, grelha(Math.sqrt((cm2 * 4) / 3)));
  const h = Math.min(MAX_LADO_CM - 2 * MARGEM, grelha(cm2 / w));
  return nomes.map((nome, i) => (i === 0 ? { nome, piso: 0, tamanho: [w, h] } : { nome, piso: 0 }));
}

/** Nome das escadas de cada piso: "Escadas (r/c)", "Escadas (piso 1)"… */
export const nomeEscadas = (p) => `Escadas (${p > 0 ? `piso ${p}` : "r/c"})`;

/** Máquina escolhida em "O que quer": a chave (estados antigos) ou {modelo, qtd, piso}; piso null = o típico. */
export function itemMaquina(m) {
  if (typeof m === "string") return { modelo: m, qtd: 1, piso: null };
  const qtd = Math.round(Number(m?.qtd));
  const piso = Math.round(Number(m?.piso));
  return {
    modelo: String(m?.modelo ?? ""),
    qtd: Number.isFinite(qtd) ? Math.min(10, Math.max(1, qtd)) : 1,
    piso: m?.piso === null || m?.piso === undefined || !Number.isFinite(piso) ? null : Math.min(MAX_PISO, Math.max(0, piso)),
  };
}

// ------------------------------------------------------------ passo 1 por piso (casas com 2 ou mais pisos)

/** N.º de pisos da casa (1 nos tipos sem pisos). */
const pisosCasa = (c) => (TIPOS_COM_PISOS.includes(c?.tipo) ? Math.min(MAX_PISO + 1, Math.max(1, Math.round(Number(c?.pisos) || 1))) : 1);
/** A casa tem valores por piso? (tipo com pisos, tipologia escolhida e 2 ou mais pisos) */
export const temPorPiso = (c) => !!c?.tipologia && perfilCasa(c?.tipo) === "habitacao" && pisosCasa(c) > 1;
const LIMITES_PISO = { quartos: [0, 12], casas_banho: [0, 6], salas: [0, 4] };
/** Valores de um piso (`casa.porPiso[p]`) com tipos e limites certos. */
function valoresPiso(f) {
  const o = f && typeof f === "object" ? f : {};
  const x = o.extras && typeof o.extras === "object" ? o.extras : {};
  return {
    quartos: inteiro(o.quartos, LIMITES_PISO.quartos, 0),
    casas_banho: inteiro(o.casas_banho, LIMITES_PISO.casas_banho, 0),
    salas: inteiro(o.salas, LIMITES_PISO.salas, 0),
    extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, x[k] === true])),
  };
}

/**
 * Valores típicos de cada piso a partir dos da casa toda (tipologia, casas de banho, salas, "A casa tem…"):
 * r/c com as salas, a cozinha/kitnet, a 1.ª casa de banho, entrada, garagem, arrecadação, jardim, exterior, lavandaria e despensa;
 * os pisos de cima com os quartos e as outras casas de banho (repartidos), o corredor onde há quartos (sem
 * quartos, no r/c), o escritório no piso 1 e a varanda no último. `antigo`: o escritório fica no r/c (como
 * antes dos valores por piso: migração dos estados guardados, que dão assim exatamente a mesma planta).
 */
export function repartirPisos(casa, { antigo = false } = {}) {
  const c = casa ?? {};
  const n = pisosCasa(c);
  const x = c.extras ?? {};
  const quartos = quartosDe(c) ?? 0;
  const cbs = inteiro(c.casas_banho, LIMITES_CASA.casas_banho, 1);
  const salas = inteiro(c.salas, LIMITES_CASA.salas, 1);
  const cima = n - 1;
  const qPiso = cima ? [0, ...repartir(quartos, cima)] : [quartos];
  const bPiso = cima ? [1, ...repartir(cbs - 1, cima)] : [cbs];
  const querCorredor = x.corredor ?? quartos >= 2;
  return Array.from({ length: n }, (_, p) => {
    const f = valoresPiso({ quartos: qPiso[p], casas_banho: bPiso[p], salas: p === 0 ? salas : 0 });
    const e = f.extras;
    if (p === 0) for (const k of ["entrada", "kitnet", "garagem", "arrecadacao", "jardim", "exterior", "lavandaria", "despensa"]) e[k] = !!x[k];
    e.corredor = !!querCorredor && (qPiso[p] > 0 || (p === 0 && !qPiso.some(Boolean)));
    e.escritorio = !!x.escritorio && p === (antigo || !cima ? 0 : 1);
    e.varanda = !!x.varanda && p === n - 1;
    return f;
  });
}

/**
 * Acerta os valores por piso da casa (muda `casa`): com 2 ou mais pisos, `porPiso` (um por piso; se faltar
 * ou o n.º de pisos mudou, os valores típicos — repartirPisos) e os totais da casa a partir dele (quartos e
 * a tipologia, casas de banho, salas e "A casa tem…" = o que algum piso tem), dentro dos limites da casa
 * (pelo menos 1 casa de banho e 1 sala); com 1 piso, `porPiso` = null (valem os totais).
 */
export function acertarPisos(casa, { antigo = false } = {}) {
  const c = casa;
  if (!c || typeof c !== "object") return c;
  if (!temPorPiso(c)) { c.porPiso = null; return c; }
  const n = pisosCasa(c);
  c.porPiso = Array.isArray(c.porPiso) && c.porPiso.length === n ? c.porPiso.map(valoresPiso) : repartirPisos(c, { antigo });
  const pp = c.porPiso;
  const soma = (k) => pp.reduce((s, f) => s + f[k], 0);
  // Totais nos limites da casa: tira do último piso que tiver a mais; o mínimo vai para o r/c.
  for (const k of ["quartos", "casas_banho", "salas"]) {
    const [min, max] = LIMITES_CASA[k];
    for (let p = n - 1; p >= 0 && soma(k) > max; p--) pp[p][k] = Math.max(0, pp[p][k] - (soma(k) - max));
    if (soma(k) < min) pp[0][k] += min - soma(k);
  }
  c.quartos = soma("quartos");
  c.tipologia = tipologiaDeQuartos(c.quartos);
  c.casas_banho = soma("casas_banho");
  c.salas = soma("salas");
  c.extras = Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, pp.some((f) => f.extras[k])]));
  return c;
}

/** Resumo de um piso para o separador: "2 quartos · 1 WC", "1 sala · 1 WC" ("vazio" sem nada). */
export function resumoPiso(f, tipologia = null) {
  const partes = [];
  if (f.salas && tipologia !== "T0") partes.push(`${f.salas} ${f.salas === 1 ? "sala" : "salas"}`);
  if (f.quartos) partes.push(`${f.quartos} ${f.quartos === 1 ? "quarto" : "quartos"}`);
  if (f.casas_banho) partes.push(`${f.casas_banho} WC`);
  return partes.length ? partes.join(" · ") : "sem quartos nem WC";
}

/**
 * Divisões da casa (nome, piso — 0 = r/c — e, no espaço principal de serviços/industrial, o tamanho), pela
 * ordem em que ficam na planta: salas, cozinha, corredor (T2 e mais), quartos, casas de banho, escritório,
 * lavandaria, despensa, garagem, varanda, jardim. Com 2 ou mais pisos, **exatamente os valores de cada piso**
 * (`casa.porPiso`, passo 1; sem eles, os típicos de repartirPisos com o escritório no r/c), piso a piso, com
 * "Escadas (r/c)", "Escadas (piso 1)"… em cada um (divisoesPorPiso). Outras divisões acrescentam-se na planta
 * (botões) e no passo "Divisões".
 * `maquinas` (grandes e pequenas: chaves ou itemMaquina): as que precisam de exterior (carregador, bomba,
 * rega, portão…) sem garagem nem jardim acrescentam "Exterior" (no r/c); com "Exterior" (ou Jardim, Garagem…) marcado não.
 */
export function divisoesDaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  let r = [];
  const add = (nome, piso = 0) => r.push({ nome, piso });
  if (perfilCasa(c.tipo) !== "habitacao") {
    r = espacosNegocio(c);
  } else if (!c.tipologia) {
    const n = Math.min(MAX_DIVISOES, c.divisoes ?? 3);
    for (let i = 0; i < n; i++) add(ORDEM_SEM_TIPOLOGIA[i] ?? `Divisão ${i + 1}`);
  } else if (temPorPiso(c)) {
    const pp = Array.isArray(c.porPiso) && c.porPiso.length === pisosCasa(c) ? c.porPiso.map(valoresPiso) : repartirPisos(c, { antigo: true });
    r = divisoesPorPiso(pp, c.tipologia);
  } else {
    // Um só piso: os valores da casa toda (o corredor, por omissão, com 2 ou mais quartos).
    const x = c.extras ?? {};
    const quartos = quartosDe(c);
    r = divisoesPorPiso([valoresPiso({
      quartos, casas_banho: inteiro(c.casas_banho, LIMITES_CASA.casas_banho, 1), salas: inteiro(c.salas, LIMITES_CASA.salas, 1),
      extras: { ...x, corredor: x.corredor ?? quartos >= 2 },
    })], c.tipologia);
  }
  const tem = (tipos) => r.some((d) => tipos.includes(tipoDivisao(d.nome)));
  const lista = (Array.isArray(maquinas) ? maquinas : []).map((m) => itemMaquina(m).modelo);
  if (lista.some((m) => PRECISA_EXTERIOR[m] && !tem(PRECISA_EXTERIOR[m]))) add("Exterior");
  return r.slice(0, MAX_DIVISOES);
}

/**
 * Divisões de uma casa com tipologia, piso a piso (`pp`: valores de cada piso, valoresPiso; 0 = r/c). Em cada
 * piso, por esta ordem: Entrada, as salas ("Sala"; 2 na casa, "Sala de estar" + "Sala de jantar"; 3–4, "Sala
 * 3"…, numeradas na casa toda) — com kitnet marcada nesse piso, uma delas é a "Kitnet" (a cozinha aberta: a
 * única sala, senão a de jantar, senão a última do piso; sem salas no piso, a Kitnet sozinha) —, a Cozinha
 * (sem kitnet em nenhum piso: no 1.º piso com salas), Corredor, Quarto, Quarto 2…n, Casa de banho (2…n), Escadas (com
 * 2 ou mais pisos), Escritório, Lavandaria, Despensa, Garagem, Arrecadação, Varanda, Jardim, Exterior. T0: um "Estúdio" (ou "Kitnet")
 * no r/c, sem salas. Divisões iguais em pisos diferentes numeram-se ("Garagem 2", "Corredor 2").
 */
function divisoesPorPiso(pp, tipologia) {
  const r = [];
  const add = (nome, piso) => r.push({ nome, piso });
  const n = pp.length;
  const total = (k) => pp.reduce((s, f) => s + f[k], 0);
  const vezes = (k) => pp.filter((f) => f.extras[k]).length;
  const t0 = tipologia === "T0";
  const S = t0 ? 0 : total("salas");
  const algumaKitnet = pp.some((f) => f.extras.kitnet);
  const pisoCozinha = algumaKitnet ? -1 : t0 ? 0 : Math.max(0, pp.findIndex((f) => f.salas > 0));
  const conta = {};
  const numerado = (k, nome) => { conta[k] = (conta[k] ?? 0) + 1; return vezes(k) > 1 && conta[k] > 1 ? `${nome} ${conta[k]}` : nome; };
  let s = 0, q = 0, b = 0;
  pp.forEach((f, p) => {
    const x = f.extras;
    if (x.entrada) add(numerado("entrada", "Entrada"), p);
    if (t0) {
      if (p === 0) add(x.kitnet ? numerado("kitnet", "Kitnet") : "Estúdio", p);   // sala e quarto na mesma divisão
      else if (x.kitnet) add(numerado("kitnet", "Kitnet"), p);
    } else {
      const s0 = s, fim = s0 + f.salas;
      const comCozinha = !x.kitnet || !f.salas ? -1 : S === 1 ? 1 : s0 < 2 && fim >= 2 ? 2 : fim;
      for (let i = s0 + 1; i <= fim; i++) {
        s = i;
        add(i === comCozinha ? numerado("kitnet", "Kitnet") : S === 1 ? "Sala" : i === 1 ? "Sala de estar" : i === 2 ? "Sala de jantar" : `Sala ${i}`, p);
      }
      if (x.kitnet && !f.salas) add(numerado("kitnet", "Kitnet"), p);
    }
    if (p === pisoCozinha) add("Cozinha", p);
    if (x.corredor) add(numerado("corredor", "Corredor"), p);
    // O primeiro sem número, os seguintes a partir do 2 (Quarto, Quarto 2…; Casa de banho, Casa de banho 2…).
    for (let i = 0; i < f.quartos; i++) add(++q === 1 ? "Quarto" : `Quarto ${q}`, p);
    for (let i = 0; i < f.casas_banho; i++) add(++b === 1 ? "Casa de banho" : `Casa de banho ${b}`, p);
    if (n > 1) add(nomeEscadas(p), p);
    for (const [k, nome] of [["escritorio", "Escritório"], ["lavandaria", "Lavandaria"], ["despensa", "Despensa"], ["garagem", "Garagem"], ["arrecadacao", "Arrecadação"], ["varanda", "Varanda"], ["jardim", "Jardim"], ["exterior", "Exterior"]]) {
      if (x[k]) add(numerado(k, nome), p);
    }
  });
  return r;
}

/**
 * Aparelhos por omissão de uma divisão nova (§2.2): só os base — porta, interruptor e ponto de luz em todas — e
 * as tomadas pelo tipo de divisão (decisão do dono: nada de janelas, sensores, quadro, TV ou outros automáticos).
 */
const TOMADAS_TIPO = { quarto: 2, sala: 3, sala_cozinha: 3, cozinha: 3, escritorio: 2, wc: 1, garagem: 1, jardim: 1, loja: 4, rececao: 2, montra: 1, nave: 4, armazem: 2 };

/**
 * Aparelhos por omissão de uma divisão retangular (nome → tipo; caixa em cm), em sítios plausíveis e
 * afastados uns dos outros (≥ 65 cm nas divisões de tamanho típico): porta na parede de baixo com o
 * interruptor ao lado, luz ao centro (divisões grandes: uma por cada 20 m², até 8, em grelha) e tomadas nas
 * paredes (esquerda, direita, baixo à direita, cima à direita). Os que têm pergunta (interruptor, luz, tomada)
 * nascem por responder (`por_responder`, passo 4).
 * Ficam 10 cm para dentro das paredes: numa parede partilhada contam nesta divisão. Usada pelo editor
 * (botões por tipo) e por plantaDaCasa. Devolve elementos sem id.
 */
export function aparelhosOmissao(nome, { x_cm: x, y_cm: y, largura_cm: w, altura_cm: h }) {
  const r = [];
  const add = (tipo, dx, dy, rot = 0) => {
    const props = propsOmissao(tipo);
    r.push({ tipo, x_cm: Math.round(x + dx), y_cm: Math.round(y + dy), rot, divisao: null, props, ...(temPergunta(tipo, props) ? { por_responder: true } : {}) });
  };
  const porta = Math.max(60, Math.round(w * 0.3));
  add("porta", porta, h - 10);
  // Interruptor ao lado da porta, do lado de fora da divisão (a luz fica ao centro, longe dele).
  add("interruptor", porta - 70 >= 40 ? porta - 70 : Math.min(porta + 70, w - 30), h - 10);
  const luzes = Math.min(MAX_LUZES, Math.max(1, Math.round((w * h) / (M2_POR_LUZ * 1e4))));
  const cols = Math.ceil(Math.sqrt((luzes * w) / h));
  const linhas = Math.ceil(luzes / cols);
  for (let i = 0; i < luzes; i++) add("luz", ((i % cols) + 0.5) * (w / cols), (Math.floor(i / cols) + 0.5) * (h / linhas));
  const tomadas = [[10, h / 2, 90], [w - 10, h / 2, 90], [w - Math.max(40, w * 0.2), h - 10, 0], [w - Math.max(90, w * 0.2), 10, 0]];
  for (const [dx, dy, rot] of tomadas.slice(0, TOMADAS_TIPO[tipoDivisao(nome)] ?? 0)) add("tomada", dx, dy, rot);
  return r;
}

/**
 * O que um botão de divisão traz (texto pequeno por baixo do nome): "porta, luz, interruptor, 2 tomadas".
 * `w`/`h`: o tamanho típico (as divisões grandes levam mais luzes).
 */
export function resumoAparelhos(nome, w = 400, h = 300) {
  const conta = {};
  for (const a of aparelhosOmissao(nome, { x_cm: 0, y_cm: 0, largura_cm: w, altura_cm: h })) conta[a.tipo] = (conta[a.tipo] ?? 0) + 1;
  const partes = [];
  const add = (k, um, varios) => { const n = conta[k] ?? 0; if (n) partes.push(n === 1 ? um : `${n} ${varios}`); };
  add("porta", "porta", "portas");
  add("luz", "luz", "luzes");
  add("interruptor", "interruptor", "interruptores");
  add("tomada", "1 tomada", "tomadas");
  return partes.join(", ");
}

/** Onde fica cada máquina (tipos de divisão por ordem de preferência; senão a primeira divisão). */
const COZINHA = ["cozinha", "sala_cozinha", "sala", "loja", "escritorio"];
const DESTINO = {
  placa: COZINHA, forno: COZINHA, maquina_loica: COZINHA,
  maquina_lavar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  maquina_secar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  // Termoacumulador: na cozinha (também a "Kitnet"), senão na garagem.
  termoacumulador: ["cozinha", "sala_cozinha", "garagem", "lavandaria", "wc", "sala"],
  // Com mais de um, os outros vão para os quartos (um por divisão).
  ar_condicionado: ["sala", "sala_cozinha", "loja", "escritorio", "rececao", "nave", "quarto"],
  carregador_ve: ["garagem", "jardim"],
  carregador_ve_22: ["garagem", "jardim", "nave"],
  bomba: ["jardim"],
  arca_frigorifica: ["loja", "cozinha", "armazem"],
  maquina_cafe: ["loja", "cozinha"],
  servidor: ["garagem", "escritorio", "rececao"],
  compressor: ["nave", "armazem", "garagem"],
  soldadura: ["nave", "garagem"],
  maquina_trifasica: ["nave", "armazem"],
  portao_industrial: ["nave", "armazem", "jardim"],
  frigorifico: COZINHA, micro_ondas: COZINHA, exaustor: COZINHA, cafeteira: COZINHA,
  air_fryer: COZINHA, torradeira: COZINHA, cafe_expresso: COZINHA,
  // Esquentador instantâneo: junto do chuveiro (casa de banho), senão a cozinha; radiador na sala e nos quartos.
  esquentador: ["wc", "cozinha", "sala_cozinha", "lavandaria"],
  radiador: ["sala", "sala_cozinha", "quarto", "escritorio"],
  hidromassagem: ["wc", "jardim", "varanda"],
  arca_congeladora: ["despensa", "garagem", "lavandaria", "cozinha", "sala_cozinha"],
  televisao: ["sala", "sala_cozinha", "rececao", "loja", "quarto"],
  computador: ["escritorio", "rececao", "loja", "quarto", "sala", "sala_cozinha"],
  consola: ["sala", "sala_cozinha", "quarto"],
  desumidificador: ["quarto", "lavandaria", "sala", "sala_cozinha"],
  aquecedor_portatil: ["quarto", "escritorio", "sala", "sala_cozinha", "loja"],
  campainha_video: ["entrada", "corredor", "sala", "sala_cozinha"],
  carregador_bicicleta: ["garagem", "entrada", "corredor", "varanda"],
  toalheiro: ["wc"],
  box_router: ["sala", "sala_cozinha", "escritorio", "rececao", "loja", "entrada"],
  repetidor_wifi: ["corredor", "entrada", "quarto"],
  nas: ["escritorio", "sala", "sala_cozinha"],
  camara: ["entrada", "jardim", "loja", "nave", "garagem", "corredor", "sala", "sala_cozinha"],
  portao: ["garagem", "jardim"],
  rega: ["jardim"],
  iluminacao_jardim: ["jardim"],
  aspirador_robo: ["sala", "sala_cozinha", "corredor"],
  impressora: ["escritorio", "rececao", "loja"],
  terminal_pagamento: ["loja", "rececao"],
  reclamo: ["montra", "loja"],
  ferramentas: ["nave", "armazem", "garagem"],
  aspirador_industrial: ["nave", "armazem"],
  carregador_baterias: ["nave", "armazem", "garagem"],
};

/**
 * Divisões (da lista `divs`, com `nome`) onde pôr a máquina `modelo`, por ordem de preferência (DESTINO);
 * sem nenhuma do tipo certo, a primeira da lista. Várias unidades repartem-se por elas (2 ar condicionado:
 * sala e quarto).
 */
export function divisoesParaMaquina(divs, modelo) {
  const r = [];
  for (const t of DESTINO[modelo] ?? []) for (const d of divs) if (tipoDivisao(d.nome) === t && !r.includes(d)) r.push(d);
  return r.length ? r : divs.slice(0, 1);
}
/** Divisão onde pôr (a primeira unidade de) a máquina `modelo`. */
export const divisaoParaMaquina = (divs, modelo) => divisoesParaMaquina(divs, modelo)[0] ?? null;

/**
 * Piso típico de uma máquina (onde fica a divisão onde a pomos: cozinha e lavandaria no r/c, desumidificador
 * nos quartos…), para a escolha de piso de "O que quer". 0 sem pisos.
 */
export function pisoTipicoMaquina(casa, modelo, maquinas = []) {
  return divisaoParaMaquina(divisoesDaCasa(casa, maquinas), modelo)?.piso ?? 0;
}

/**
 * Planta já desenhada a partir da casa (§1.1, §2.1): as divisões de divisoesDaCasa pela ordem (ids d1,
 * d2…), em linhas até 15 m, tamanhos típicos (o espaço principal de serviços/industrial com o tamanho que a
 * área dá), sem sobreposição; cada piso (`piso`, 0 = r/c) começa no mesmo canto da mesma folha (os pisos
 * ficam uns por cima dos outros, como na casa; a folha é a do maior). Cada divisão só com os aparelhos
 * base (aparelhosOmissao: porta, interruptor, luz, tomadas); cada máquina escolhida (grandes e pequenas; chaves
 * ou {modelo, qtd, piso}) na divisão certa (DESTINO) do piso escolhido (sem piso: o típico), ao fundo, tantas
 * quantas pedidas (repartidas pelas divisões desse tipo). Sem janelas, sensores, quadro elétrico nem TV
 * automáticos (decisão do dono): o quadro é orçamentado no passo 5 sem precisar do ícone (quadro.js pisosDosQuadros).
 */
export function plantaDaCasa(casa, maquinas = []) {
  const p = plantaVazia();
  const escolhidas = (Array.isArray(maquinas) ? maquinas : []).map(itemMaquina);
  const itens = divisoesDaCasa(casa, escolhidas).map((d) => ({ nome: d.nome, piso: d.piso ?? 0, tam: d.tamanho ?? tamanho(d.nome, casa) }));
  const pos = new Map();
  let maxX = 0, maxY = 0;
  [...new Set(itens.map((z) => z.piso))].sort((a, b) => a - b).forEach((piso) => {
    let x = MARGEM, y = MARGEM, alturaLinha = 0;
    // As escadas primeiro: ficam no mesmo sítio em todos os pisos (umas por cima das outras).
    const doPiso = itens.filter((z) => z.piso === piso);
    for (const it of [...doPiso.filter((z) => tipoDivisao(z.nome) === "escadas"), ...doPiso.filter((z) => tipoDivisao(z.nome) !== "escadas")]) {
      const [w, h] = it.tam;
      if (x > MARGEM && x + w > MARGEM + LARGURA_LINHA) { x = MARGEM; y += alturaLinha; alturaLinha = 0; }
      pos.set(it, [x, y]);
      x += w;
      maxX = Math.max(maxX, x);
      alturaLinha = Math.max(alturaLinha, h);
    }
    maxY = Math.max(maxY, y + alturaLinha);
  });
  itens.forEach((it, i) => {
    const [x, yy] = pos.get(it);
    p.divisoes.push({ id: `d${i + 1}`, nome: it.nome, piso: it.piso, x_cm: x, y_cm: yy, largura_cm: it.tam[0], altura_cm: it.tam[1] });
  });
  const arred = (v) => Math.ceil(v / ESCALA_CM) * ESCALA_CM;
  p.largura_cm = Math.min(MAX_LADO_CM, Math.max(p.largura_cm, arred(maxX + MARGEM)));
  p.altura_cm = Math.min(MAX_LADO_CM, Math.max(p.altura_cm, arred(maxY + MARGEM)));
  let e = 0;
  for (const d of p.divisoes) {
    for (const a of aparelhosOmissao(d.nome, d)) {
      if (p.elementos.length >= MAX_ELEMENTOS) break;
      p.elementos.push({ id: `e${++e}`, ...a, piso: d.piso });
    }
  }
  const ultimoPiso = Math.max(0, ...p.divisoes.map((d) => d.piso));
  for (const m of escolhidas) {
    const piso = Math.min(ultimoPiso, m.piso ?? divisaoParaMaquina(p.divisoes, m.modelo)?.piso ?? 0);
    const doPiso = p.divisoes.filter((d) => d.piso === piso);
    const onde = divisoesParaMaquina(doPiso.length ? doPiso : p.divisoes, m.modelo);
    for (let i = 0; i < m.qtd && onde.length && p.elementos.length < MAX_ELEMENTOS; i++) {
      const d = onde[i % onde.length];
      const [x_cm, y_cm] = lugarLivre(d, p.elementos.filter((q) => q.piso === d.piso));
      const props = propsOmissao("maquina", m.modelo);
      p.elementos.push({ id: `e${++e}`, tipo: "maquina", x_cm, y_cm, rot: 0, piso: d.piso, divisao: null, props, ...(temPergunta("maquina", props) ? { por_responder: true } : {}) });
    }
  }
  return atualizarDivisoes(p);
}

/**
 * Sítio livre para mais um aparelho dentro da divisão (retângulo): o ponto da grelha de 25 cm, a
 * 30 cm das paredes, mais longe dos aparelhos que já lá estão (a partir de PASSO_MAQUINA conta
 * igual: fica o mais em baixo e à esquerda, "ao fundo da divisão").
 */
export function lugarLivre(d, elementos) {
  const perto = elementos.filter((q) => q.x_cm >= d.x_cm - 50 && q.x_cm <= d.x_cm + d.largura_cm + 50 && q.y_cm >= d.y_cm - 50 && q.y_cm <= d.y_cm + d.altura_cm + 50);
  let melhor = [d.x_cm + d.largura_cm / 2, d.y_cm + d.altura_cm / 2], nota = -1;
  for (let y = d.y_cm + d.altura_cm - 30; y >= d.y_cm + 30; y -= 25) {
    for (let x = d.x_cm + 30; x <= d.x_cm + d.largura_cm - 30; x += 25) {
      const n = Math.min(PASSO_MAQUINA, ...perto.map((q) => Math.hypot(q.x_cm - x, q.y_cm - y)));
      if (n > nota) { nota = n; melhor = [x, y]; }
    }
  }
  return melhor.map(Math.round);
}

/** Resumo do que gera a lista de divisões da casa (para saber se a casa ou as máquinas mudaram depois). */
export function assinaturaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  const x = c.extras ?? {};
  const perfil = perfilCasa(c.tipo);
  const negocio = perfil !== "habitacao";
  // Valores por piso (passo 1 com 2 ou mais pisos): só entram quando existem (as assinaturas de um piso não mudam).
  const pp = !negocio && temPorPiso(c) && Array.isArray(c.porPiso) ? c.porPiso.map(valoresPiso) : null;
  // "Exterior" e "Arrecadação" (novos) só entram quando marcados: as assinaturas guardadas antes não mudam.
  const novos = ["exterior", "arrecadacao"].filter((k) => x[k]);
  return JSON.stringify([
    perfil, negocio ? null : c.tipologia ?? null, negocio ? null : quartosDe(c), c.casas_banho, c.salas, c.pisos,
    ...Object.keys(EXTRAS_CASA).filter((k) => !["exterior", "arrecadacao"].includes(k)).map((k) => !!x[k]),
    // Máquinas: a chave (como antes) e, se não for uma só no piso típico, "chave×2@1" (quantidade e piso).
    negocio ? c.area_m2 ?? null : null, negocio ? c.espacos ?? null : null,
    maquinas.map(itemMaquina).map((m) => (m.qtd === 1 && m.piso === null ? m.modelo : `${m.modelo}×${m.qtd}@${m.piso ?? "-"}`)).sort(),
    ...(pp ? [pp.map((f) => [f.quartos, f.casas_banho, f.salas, Object.keys(EXTRAS_CASA).filter((k) => f.extras[k]).join("+")])] : []),
    ...(novos.length ? [novos] : []),
  ]);
}

/**
 * "O que quer fazer" já não acrescenta aparelhos (decisão do dono): no passo 4 cada divisão mostra uma dica curta
 * do que o cliente pode acrescentar com os botões. `nome`: a divisão; `temTomadas`: a divisão tem tomadas.
 * - alarme: sensores (salas, corredor, entrada, loja, receção, nave, armazém);
 * - estores: janelas com estore motorizado (salas e quartos);
 * - iluminação automática: sensor de movimento (divisões interiores);
 * - poupar energia / controlo de energia: tomadas inteligentes (divisões com tomadas).
 * "Luzes pelo telemóvel" e "horários de abertura" não precisam de dica: os interruptores da planta já contam como
 * inteligentes no preço.
 */
export function dicasObjetivos(nome, objetivos = [], { temTomadas = false } = {}) {
  const quer = (k) => objetivos.includes(k);
  const t = tipoDivisao(nome);
  const interior = !["jardim", "varanda"].includes(t);
  const r = [];
  if (quer("alarme") && ["sala", "sala_cozinha", "corredor", "entrada", "loja", "rececao", "nave", "armazem"].includes(t)) r.push("Para o alarme, acrescente sensores com \"Acrescentar outro aparelho\".");
  if (quer("estores") && ["sala", "sala_cozinha", "quarto"].includes(t)) r.push("Para estores automáticos, acrescente as janelas e marque o estore motorizado.");
  if (quer("iluminacao_auto") && interior) r.push("Para a luz acender sozinha, acrescente um sensor de movimento.");
  if ((quer("poupar") || quer("energia")) && temTomadas) r.push("Para poupar energia, torne tomadas inteligentes (toque no nome delas).");
  return r;
}
