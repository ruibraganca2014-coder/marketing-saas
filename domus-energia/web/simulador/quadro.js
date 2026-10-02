// Simulador de orçamento — passo "Quadro elétrico" (docs/SIMULADOR-ORCAMENTO.md §4.1): sugestão de circuitos,
// proteções por pacotes, grupos diferenciais, AFDD, módulos e tamanho do quadro (critério Domus: a RTIEBT só exige
// proteção diferencial em todos os circuitos, 801.5.9, 30 mA nas casas de banho/exterior/VE e um local acessível,
// 801.5.11), potência sugerida pelos escalões da E-Redes, nunca abaixo do mínimo da RTIEBT 801.5.2.2. Só lógica, sem DOM.
// As regras são ORIENTATIVAS: a solução final é validada na visita técnica.

import {
  codigoCircuito, circuitoProprio, trifasica, watts, perfilCasa, formatarW, FIM_AVISO, MAX_MODULOS, MODULOS_SY1,
  TIPOS_COM_PISOS, LIMITES_CASA, pisoDe,
} from "./regras.js";
import { tipoDivisao, divisoesDaCasa } from "./casa.js";

const SKU_SY1 = "TONGOU-SY1-JWT";

// ------------------------------------------------------------ zonas (sugestão de circuitos)

/** Zonas húmidas (tomadas no C5): cozinha/copa, casas de banho/sanitários/vestiários, lavandaria, sala e cozinha. */
const HUMIDAS = ["cozinha", "wc", "lavandaria", "sala_cozinha"];
/** Zona de noite (T3 e mais: iluminação e tomadas num circuito à parte da zona de dia). */
const NOITE = ["quarto", "wc", "corredor", "escritorio", "escadas"];
export const zonaHumida = (nome) => HUMIDAS.includes(tipoDivisao(nome));
export const zonaNoite = (nome) => NOITE.includes(tipoDivisao(nome));
/** Serviços e industrial: a partir desta área a iluminação e as tomadas também se dividem em 2. */
export const AREA_DIVIDIR_M2 = 100;

/**
 * Dividir iluminação e tomadas em 2 (zona de dia / zona de noite)? Critério Domus (não é regra da RTIEBT): T3 e
 * mais (3 ou mais quartos); serviços e industrial: o equivalente pela área (≥ 100 m²).
 */
export function dividirZonas(casa) {
  const perfil = perfilCasa(casa?.tipo);
  if (perfil !== "habitacao") return (Number(casa?.area_m2) || 0) >= AREA_DIVIDIR_M2;
  const t = casa?.tipologia;
  return t === "T3" || t === "T4" || t === "T5+" || (Number(casa?.quartos) || 0) >= 3;
}

/** Opções de `sugerirCircuitos` (regras.js) para a casa: ligação, zonas húmidas, zona de noite e divisão T3+. */
export const opcoesCircuitos = (casa) => ({ fases: casa?.fases ?? null, humida: zonaHumida, noite: zonaNoite, dividir: dividirZonas(casa) });

// ------------------------------------------------------------ proteções e pacotes

/**
 * Proteções e extras que se ligam/desligam (os 2 diferenciais de 30 mA vão sempre — a RTIEBT exige diferencial em
 * todos os circuitos, 801.5.9; "2 × 30 mA" é o critério Domus; `idr_wifi` troca-os pelos Wi-Fi com religação automática).
 */
export const PROTECOES = {
  idr_wifi: { grupo: "Pessoas", nome: "Diferenciais Wi-Fi com religação automática", ajuda: "RCBO Tongou TOSMR1: avisa no telemóvel e volta a ligar sozinho depois de um disparo passageiro." },
  descarregador: { grupo: "Picos", nome: "Descarregador de sobretensões (tipo 2)", ajuda: "Protege os aparelhos de picos de tensão (trovoada, manobras na rede)." },
  rele_tensao: { grupo: "Equipamentos", nome: "Proteção de sobretensão e subtensão com religação (Wi-Fi)", ajuda: "Corta a casa se a tensão sair do normal (ex.: neutro cortado) e volta a ligar quando normaliza." },
  afdd: { grupo: "Incêndio", nome: "Detetores de arco elétrico (AFDD) nos quartos e sala", ajuda: "Detetam faíscas em cabos e fichas estragados antes de haver incêndio." },
  medidor_geral: { grupo: "Extras", nome: "Medidor de energia geral Wi-Fi", ajuda: "O consumo da casa toda na app, hora a hora." },
  geral_wifi: { grupo: "Extras", nome: "Disjuntor geral Wi-Fi", ajuda: "Desligar a casa toda à distância (com medição)." },
};
export const CHAVES_PROTECOES = Object.keys(PROTECOES);

/** Pacotes: Essencial (2 diferenciais + disjuntores), Recomendado (+ descarregador + proteção de tensão), Completo (+ AFDD + medidor + geral Wi-Fi). */
export const PACOTES = {
  essencial: { nome: "Essencial", ajuda: "2 diferenciais de 30 mA e os disjuntores (diferencial obrigatório, RTIEBT 801.5.9; 2 × 30 mA é o critério Domus)", liga: [] },
  recomendado: { nome: "Recomendado", ajuda: "+ descarregador de sobretensões e proteção de tensão", liga: ["descarregador", "rele_tensao"] },
  completo: { nome: "Completo", ajuda: "+ AFDD nos quartos e sala, medidor geral e geral Wi-Fi", liga: ["descarregador", "rele_tensao", "afdd", "medidor_geral", "geral_wifi"] },
};
export const PACOTE_OMISSAO = "recomendado";
const DOS_PACOTES = ["descarregador", "rele_tensao", "afdd", "medidor_geral", "geral_wifi"];

/** Proteções de um pacote (a opção Wi-Fi dos diferenciais não depende do pacote: mantém-se `idrWifi`). */
export function protecoesDoPacote(pacote, idrWifi = false) {
  const liga = PACOTES[pacote]?.liga ?? PACOTES[PACOTE_OMISSAO].liga;
  return { idr_wifi: !!idrWifi, ...Object.fromEntries(DOS_PACOTES.map((k) => [k, liga.includes(k)])) };
}

/**
 * Pacote que corresponde às proteções escolhidas, ou "personalizado". `ignorar`: proteções que não contam
 * (o descarregador incluído com para-raios/linha aérea não é uma personalização: pacoteDoQuadro).
 */
export function pacoteDe(p, ignorar = []) {
  const conta = DOS_PACOTES.filter((x) => !ignorar.includes(x));
  for (const [k, v] of Object.entries(PACOTES)) if (conta.every((x) => !!p?.[x] === v.liga.includes(x))) return k;
  return "personalizado";
}

/**
 * Pacote do quadro pelas proteções que o cliente escolheu: com para-raios ou linha aérea o descarregador vai sempre
 * (recomendado pela RTIEBT 801.5.10 com linha aérea; critério Domus com para-raios — fica ligado e bloqueado) e não
 * conta — "Essencial" com para-raios continua "Essencial".
 */
export const pacoteDoQuadro = (q) => pacoteDe(q?.protecoes, q?.para_raios === "sim" ? ["descarregador"] : []);

/** Respostas à pergunta "A casa tem para-raios ou é alimentada por linha aérea?" e "O quadro atual serve?". */
export const PARA_RAIOS = { sim: "Sim", nao: "Não" };                 // null = "Não sei"
export const QUADRO_NOVO = { atual: "O atual serve", novo: "Quero quadro novo" };   // null = "Não sei"

/** Parte `quadro` do estado sem os circuitos (valores por omissão). */
export const quadroOmissao = () => ({ pacote: PACOTE_OMISSAO, protecoes: protecoesDoPacote(PACOTE_OMISSAO), para_raios: null, quadro_novo: null });

/** Normaliza pacote, proteções e respostas (estado gravado ou enviado); estados antigos → Recomendado. */
export function normalizarProtecoes(q) {
  const o = q && typeof q === "object" ? q : {};
  const b = quadroOmissao();
  const p = o.protecoes && typeof o.protecoes === "object" ? o.protecoes : null;
  const protecoes = p ? Object.fromEntries(CHAVES_PROTECOES.map((k) => [k, p[k] === true])) : b.protecoes;
  const para_raios = PARA_RAIOS[o.para_raios] ? o.para_raios : null;
  return {
    pacote: pacoteDoQuadro({ protecoes, para_raios }),
    protecoes,
    para_raios,
    quadro_novo: QUADRO_NOVO[o.quadro_novo] ? o.quadro_novo : null,
  };
}

/** Proteções que valem: com para-raios ou linha aérea o descarregador vai sempre (recomendado, RTIEBT 801.5.10). */
export function protecoesEfetivas(q) {
  const p = { ...normalizarProtecoes(q).protecoes };
  if (q?.para_raios === "sim") p.descarregador = true;
  return p;
}

// ------------------------------------------------------------ circuitos: inteligente, AFDD, diferenciais

/** Disjuntor inteligente do circuito: "sy2" (substitui o disjuntor), "sy1" (fica ao lado) ou null (mesma regra de regras.js). */
export function inteligenteDe(c, disjuntor) {
  if (!c?.inteligente && !c?.medir) return null;
  return c.inteligente && disjuntor !== SKU_SY1 ? "sy2" : "sy1";
}

/** Divisões onde vai o AFDD: casas — quartos e salas; serviços — loja, escritório, receção; industrial — armazém e escritório. */
const AFDD_PERFIL = { habitacao: ["quarto", "sala", "sala_cozinha"], servicos: ["loja", "escritorio", "rececao"], industrial: ["armazem", "escritorio"] };
/** O circuito leva AFDD (iluminação/tomadas/misto que serve uma dessas divisões)? */
export function circuitoComAfdd(c, tipoCasa) {
  if (!c || c.tipo === "maquina") return false;
  const tipos = AFDD_PERFIL[perfilCasa(tipoCasa)];
  return (c.divisoes ?? []).some((n) => tipos.includes(tipoDivisao(n)));
}

const ehCarregador = (m) => m?.modelo === "carregador_ve" || m?.modelo === "carregador_ve_22";
const temCarregador = (c) => (c.itens?.maquinas ?? []).some(ehCarregador);
export const MAX_CIRCUITOS_DIFERENCIAL = 8;

/**
 * Grupos diferenciais (IDR 40 A / 30 mA; critério Domus: pelo menos 2 — a RTIEBT exige diferencial em todos os
 * circuitos, 801.5.9). Grupo 1: a 1.ª iluminação, as tomadas
 * gerais (C2) e placa/forno (C3); grupo 2: a 2.ª iluminação, máquinas de lavar e termoacumulador (C4) e as
 * tomadas das zonas húmidas (C5) — as cargas grandes ficam repartidas e um disparo num grupo nunca deixa a
 * casa toda às escuras. As outras máquinas vão
 * para o grupo com menos circuitos. Mais de 8 circuitos num grupo → outro diferencial. O carregador do
 * carro elétrico tem sempre diferencial próprio, tipo A (RTIEBT 722.531.2.101; pedidosQuadro `diferencial_tipo_a`).
 * @returns {{n:number, circuitos:number[], carregador:boolean}[]}
 */
export function gruposDiferenciais(circuitos) {
  const ve = circuitos.filter(temCarregador);
  const resto = circuitos.filter((c) => !temCarregador(c));
  const g1 = [], g2 = [];
  const luz = resto.filter((c) => codigoCircuito(c) === "C1");
  luz.forEach((c, i) => (i % 2 ? g2 : g1).push(c));
  for (const c of resto) {
    if (luz.includes(c)) continue;
    const k = codigoCircuito(c);
    if (k === "C2" || k === "C3") g1.push(c);
    else if (k === "C4" || k === "C5") g2.push(c);
    else (g1.length <= g2.length ? g1 : g2).push(c);
  }
  const grupos = [];
  for (const g of [g1, g2]) {
    if (!g.length) { grupos.push({ circuitos: [], carregador: false }); continue; }
    for (let i = 0; i < g.length; i += MAX_CIRCUITOS_DIFERENCIAL) grupos.push({ circuitos: g.slice(i, i + MAX_CIRCUITOS_DIFERENCIAL).map((c) => c.n).sort((a, b) => a - b), carregador: false });
  }
  for (const c of ve) grupos.push({ circuitos: [c.n], carregador: true });
  return grupos.map((g, i) => ({ n: i + 1, ...g }));
}

/**
 * Diferenciais de um quadro parcial: os circuitos desse piso juntos, um diferencial por cada 8 (os 2 do
 * critério Domus já estão no geral), e o carregador do carro com o seu.
 */
function gruposParcial(circuitos) {
  const resto = circuitos.filter((c) => !temCarregador(c));
  const grupos = [];
  for (let i = 0; i < resto.length; i += MAX_CIRCUITOS_DIFERENCIAL) grupos.push({ circuitos: resto.slice(i, i + MAX_CIRCUITOS_DIFERENCIAL).map((c) => c.n).sort((a, b) => a - b), carregador: false });
  for (const c of circuitos.filter(temCarregador)) grupos.push({ circuitos: [c.n], carregador: true });
  return grupos;
}

// ------------------------------------------------------------ módulos e tamanho do quadro

export const TAMANHOS_QUADRO = [12, 18, 24, 36, 48];
export const FRACAO_LIVRE = 0.25;             // pelo menos 25 % de módulos livres
/** Módulos de cada aparelho em monofásico; em trifásico os tetrapolares ocupam o dobro. */
export const MODULOS = { geral: 2, diferencial: 2, descarregador: 2, rele_tensao: 2, medidor_geral: 2, disjuntor: 1, afdd: 2, sy: MODULOS_SY1, tetrapolar: 4 };

/**
 * Quadros parciais (casas com pisos): o quadro do r/c é o geral (dimensionado abaixo) e cada outro piso com
 * quadro leva um parcial — regra simples: uma caixa de 12 módulos (o corte do piso e os disjuntores dos
 * circuitos desse piso cabem numa de 12 com folga; confirmamos na visita).
 */
export const TAMANHO_PARCIAL = 12;
/**
 * Pisos com quadro, por ordem: com planta, os pisos que têm um "Quadro elétrico" desenhado (o cliente pô-lo);
 * sem planta, ou numa planta sem nenhum quadro desenhado (a planta desenhada pela casa já não o põe), os pisos da
 * casa — o quadro é sempre orçamentado, com ou sem ícone. Pelo menos [0].
 * O 1.º é o quadro geral (normalmente o r/c); os outros são parciais.
 */
export function pisosDosQuadros(estado) {
  const p = estado?.planta;
  const usaPlanta = !!p && !estado.plantaSaltada && ((p.divisoes?.length ?? 0) > 0 || (p.elementos?.length ?? 0) > 0);
  if (usaPlanta) {
    const s = [...new Set((p.elementos ?? []).filter((e) => e.tipo === "quadro").map(pisoDe))].sort((a, b) => a - b);
    if (s.length) return s;
  }
  const c = estado?.casa ?? {};
  const [, max] = LIMITES_CASA.pisos;
  const n = TIPOS_COM_PISOS.includes(c.tipo) ? Math.min(max, Math.max(1, Math.round(Number(c.pisos)) || 1)) : 1;
  return Array.from({ length: n }, (_, i) => i);
}
/** N.º de quadros (o geral e os parciais): pisosDosQuadros. */
export const numeroQuadros = (estado) => pisosDosQuadros(estado).length;
/** Piso do quadro de onde saem os circuitos do piso `p`: o do próprio piso, se tiver quadro; senão o geral. */
export const quadroDoPiso = (pisos, p) => (pisos.includes(p) ? p : pisos[0]);

/**
 * Circuitos que a casa JÁ TEM (estimativa; docs/SIMULADOR-ORCAMENTO.md §4.1): sem "Instalação nova" os aparelhos a
 * manter/reparar/substituir ficam nos circuitos que existem, mas um quadro NOVO precisa de um disjuntor para cada um.
 * Regra, por piso: 1 de iluminação + 1 de tomadas por cada 2 divisões (arredondado para cima; sem a cozinha e as
 * casas de banho) + 1 por cozinha (ou sala e cozinha) + 1 por casa de banho ou lavandaria. Pelo menos 2 na casa
 * (iluminação e tomadas). As divisões são as da planta (senão as do pedido). O n.º confirma-se na visita.
 */
export function circuitosExistentes(estado) {
  const p = estado?.planta;
  const daPlanta = !!p && !estado.plantaSaltada && (p.divisoes?.length ?? 0) > 0;
  const divs = (daPlanta ? p.divisoes : (estado?.divisoes ?? [])).filter((d) => d && typeof d === "object");
  const porPiso = new Map();
  for (const d of divs) {
    const k = pisoDe(d);
    const x = porPiso.get(k) ?? { secas: 0, proprios: 0 };
    if (HUMIDAS.includes(tipoDivisao(d.nome))) x.proprios++; else x.secas++;
    porPiso.set(k, x);
  }
  let n = 0;
  for (const x of porPiso.values()) n += 1 + Math.ceil(x.secas / 2) + x.proprios;
  return Math.max(2, n);
}
/**
 * Quantos disjuntores de circuitos existentes entram num quadro novo: só sem "Instalação nova" (automatizar /
 * reparar), quando o cliente quer melhorar o quadro e o quadro é novo (ou "Não sei"). Com "Instalação nova" os
 * circuitos são todos novos (já estão na sugestão).
 */
export function existentesNoQuadroNovo(estado) {
  const sv = estado?.servico;
  const semNova = Array.isArray(sv) && sv.length > 0 && !sv.includes("nova");
  return semNova && estado.mexerQuadro === true && levaQuadroNovo(estado.quadro) ? circuitosExistentes(estado) : 0;
}

/**
 * Circuitos que já existem com AFDD (proteção com AFDD, sem "Instalação nova", com o quadro no pedido: "Quer melhorar o
 * quadro? Sim"): contam-se como em circuitosExistentes — por piso, 1 de iluminação e 1 de tomadas por cada 2 quartos
 * ou salas (as divisões com AFDD: circuitoComAfdd). Num quadro novo trocam os disjuntores desses circuitos
 * (existentesNoQuadroNovo); no quadro atual entram no lugar deles.
 */
export function afddExistentes(estado) {
  const sv = estado?.servico;
  const semNova = Array.isArray(sv) && sv.length > 0 && !sv.includes("nova");
  if (!semNova || estado.mexerQuadro !== true) return 0;
  const p = estado.planta;
  const daPlanta = !!p && !estado.plantaSaltada && (p.divisoes?.length ?? 0) > 0;
  const porPiso = new Map();
  for (const d of (daPlanta ? p.divisoes : (estado.divisoes ?? [])).filter((d) => d && typeof d === "object")) {
    if (circuitoComAfdd({ tipo: "misto", divisoes: [d.nome] }, estado.casa?.tipo)) porPiso.set(pisoDe(d), (porPiso.get(pisoDe(d)) ?? 0) + 1);
  }
  return [...porPiso.values()].reduce((s, n) => s + 1 + Math.ceil(n / 2), 0);
}

/** Menor quadro com ≥ 25 % livres; null se nem o de 48 chega. */
export function tamanhoQuadro(ocupados) {
  return TAMANHOS_QUADRO.find((t) => ocupados <= Math.floor(t * (1 - FRACAO_LIVRE))) ?? null;
}

/**
 * Tudo o que o passo do quadro calcula a partir do estado: proteções que valem, pacote, grupos
 * diferenciais, circuitos com AFDD, módulos (linhas, ocupados, tamanho, livres, novos num quadro atual),
 * os quadros parciais (um por piso além do r/c: numeroQuadros) e a potência sugerida.
 * @param {{casa:object, quadro:object, planta?:object, plantaSaltada?:boolean}} estado
 */
export function resumoQuadro(estado) {
  const q = estado.quadro ?? {};
  const circuitos = q.circuitos ?? [];
  const casa = estado.casa ?? {};
  const tri = casa.fases === "tri";
  const P = tri ? 2 : 1;
  const prot = protecoesEfetivas(q);
  // Com quadros parciais (casas com pisos) cada circuito fica no quadro do seu piso (`piso` do circuito: o piso
  // do quadro; sem ele, no geral): o geral só conta os módulos dos seus circuitos, mais o geral de cada parcial
  // (a saída do piso). Com um só quadro fica tudo no geral, como sempre.
  const pisosQ = pisosDosQuadros(estado);
  const geral = pisosQ[0];
  const parciais = pisosQ.length - 1;
  const quadroDe = (c) => (parciais ? quadroDoPiso(pisosQ, Number.isInteger(c.piso) ? c.piso : geral) : geral);
  const gruposGeral = gruposDiferenciais(circuitos.filter((c) => quadroDe(c) === geral));
  const grupos = [
    ...gruposGeral.map((g) => ({ ...g, quadro: geral })),
    ...pisosQ.slice(1).flatMap((p) => gruposParcial(circuitos.filter((c) => quadroDe(c) === p)).map((g) => ({ ...g, quadro: p }))),
  ].map((g, i) => ({ ...g, n: i + 1 }));
  const afdd = prot.afdd ? circuitos.filter((c) => circuitoComAfdd(c, casa.tipo)).map((c) => c.n) : [];
  const linhas = [];
  let novos = 0;   // módulos a mais num quadro que fica (o geral, o 1.º diferencial e os disjuntores já lá estão)
  const linha = (chave, nome, qtd, modulos) => { if (qtd > 0) linhas.push({ chave, nome, qtd, modulos }); };
  linha("geral", prot.geral_wifi ? "Disjuntor geral Wi-Fi (com medição)" : "Disjuntor geral", 1, MODULOS.geral * P);
  // O do carregador VE é sempre tipo A (RTIEBT 722): linha à parte (os módulos são os mesmos).
  const gVe = gruposGeral.filter((g) => g.carregador).length;
  linha("diferencial", `Diferencial 40 A / 30 mA${prot.idr_wifi ? " Wi-Fi" : ""}`, gruposGeral.length - gVe, (gruposGeral.length - gVe) * MODULOS.diferencial * P);
  linha("diferencial_tipo_a", "Diferencial 40 A / 30 mA tipo A (carregador VE; RTIEBT 722)", gVe, gVe * MODULOS.diferencial * P);
  novos += Math.max(0, gruposGeral.length - 1) * MODULOS.diferencial * P;
  // Artigos (disjuntores, AFDD, inteligentes): todos os circuitos; módulos e linhas: só os do quadro geral.
  let disj = 0, disjVe = 0, nAfdd = 0, sy2 = 0, sy1 = 0;
  let disjG = 0, mDisj = 0, nAfddG = 0, mAfdd = 0, sy2G = 0, sy1G = 0, mSy = 0, tetra = 0, tetraT = 0, tetraVe = 0;
  for (const c of circuitos) {
    const g = quadroDe(c) === geral;
    const i = inteligenteDe(c, q.disjuntor);
    const comAfdd = afdd.includes(c.n);
    if (tri && (c.itens?.maquinas ?? []).some(trifasica)) { tetraT++; if (temCarregador(c)) tetraVe++; if (g) tetra++; continue; }
    if (comAfdd) { nAfdd++; if (g) { nAfddG++; mAfdd += MODULOS.afdd; novos += i === "sy2" ? MODULOS.afdd : MODULOS.afdd - MODULOS.disjuntor; } }
    if (i === "sy2") { sy2++; if (g) { sy2G++; mSy += MODULOS.sy; } }
    else if (!comAfdd) { disj++; if (temCarregador(c)) disjVe++; if (g) { disjG++; mDisj += MODULOS.disjuntor; } }
    if (i === "sy1") { sy1++; if (g) { sy1G++; mSy += MODULOS.sy; novos += MODULOS.sy; } }
  }
  // Quadro novo sem "Instalação nova": um disjuntor 1P+N por cada circuito que a casa já tem (estimativa, no geral).
  // Com AFDD, os dos quartos e salas levam AFDD com disjuntor em vez dele (no quadro atual, no lugar do que lá está).
  const existentes = existentesNoQuadroNovo(estado);
  const afddEx = prot.afdd ? (existentes ? Math.min(existentes, afddExistentes(estado)) : afddExistentes(estado)) : 0;
  const semAfdd = existentes ? existentes - afddEx : 0;
  disj += semAfdd;
  if (!existentes) novos += afddEx * (MODULOS.afdd - MODULOS.disjuntor);
  linha("disjuntor", "Disjuntores dos circuitos", disjG, mDisj);
  linha("disjuntor_existente", "Disjuntores dos circuitos que já existem (estimativa, a confirmar na visita)", semAfdd, semAfdd * MODULOS.disjuntor);
  linha("afdd", "AFDD com disjuntor", nAfddG + afddEx, mAfdd + afddEx * MODULOS.afdd);
  linha("inteligente", `Disjuntores inteligentes (${[sy2G ? `${sy2G} SY2` : "", sy1G ? `${sy1G} SY1` : ""].filter(Boolean).join(", ")})`, sy2G + sy1G, mSy);
  linha("tetrapolar", "Disjuntor trifásico (máquina trifásica)", tetra, tetra * MODULOS.tetrapolar);
  linha("saida_parcial", "Geral de cada quadro parcial (saída do piso)", parciais, parciais * MODULOS.geral * P);
  for (const k of ["descarregador", "rele_tensao", "medidor_geral"]) {
    if (!prot[k]) continue;
    linha(k, PROTECOES[k].nome, 1, MODULOS[k] * P);
    novos += MODULOS[k] * P;
  }
  const ocupados = linhas.reduce((s, l) => s + l.modulos, 0);
  const tamanho = tamanhoQuadro(ocupados);
  const t = tamanho ?? TAMANHOS_QUADRO[TAMANHOS_QUADRO.length - 1];
  // Nem o de 48 deixa 25 % livres: vários quadros de 48 (cada um com 36 módulos ocupados no máximo).
  const quadros = tamanho !== null ? 1 : Math.ceil(ocupados / Math.floor(t * (1 - FRACAO_LIVRE)));
  return {
    pacote: normalizarProtecoes(q).pacote, protecoes: prot, para_raios: q.para_raios ?? null, quadro_novo: q.quadro_novo ?? null,
    grupos, afdd, linhas, ocupados, tamanho: t, quadros, livres: quadros * t - ocupados, cabe: tamanho !== null, novos,
    disjuntores: disj, disjuntores_ve: disjVe, sy2, sy1, tetrapolares: tetraT, tetrapolares_ve: tetraVe, circuitos_existentes: existentes, afdd_existentes: afddEx,
    parciais, pisos_quadros: pisosQ,
    potencia: potenciaSugerida(circuitos, compartimentosRtiebt(estado)),
  };
}

/** O preço leva a caixa de um quadro novo? Sim com "Quero quadro novo" e com "Não sei" (por precaução). */
export const levaQuadroNovo = (q) => q?.quadro_novo !== "atual";

/**
 * Artigos do quadro para o preço (preco.js): diferenciais (Wi-Fi ou não), descarregador, relé de tensão,
 * AFDD, medidor e geral Wi-Fi; com quadro novo a caixa (mais uma de 12 módulos por quadro parcial), o geral,
 * os disjuntores dos circuitos sem SY2/AFDD e um tetrapolar (4P) por circuito de máquina trifásica numa casa
 * trifásica; com o quadro atual, a ampliação quando há mais de 12 módulos novos (a máquina trifásica fica na
 * proteção trifásica que já tem).
 * Ronda dinheiro: o diferencial tipo A e o disjuntor (1P+N, ou o tetrapolar do de 22 kW) do circuito do carregador VE já vão dentro da linha dedicada do
 * carregador (LINHA-DEDICADA-VE, acoes.js pontosDoElemento): não entram aqui outra vez (os módulos contam na mesma).
 * @returns {{chave:string, qtd:number}[]}
 */
export function pedidosQuadro(estado) {
  const r = resumoQuadro(estado);
  const p = r.protecoes;
  const out = [];
  const add = (chave, qtd) => { if (qtd > 0) out.push({ chave, qtd }); };
  // Ronda regras: o grupo do carregador VE leva sempre o diferencial tipo A (RTIEBT 722.531.2.101), nunca o AC nem o
  // Wi-Fi — incluído na linha dedicada do carregador (ronda dinheiro).
  const ve = r.grupos.filter((g) => g.carregador).length;
  add(p.idr_wifi ? "diferencial_wifi" : "diferencial", r.grupos.length - ve);
  add("descarregador", p.descarregador ? 1 : 0);
  add("rele_tensao", p.rele_tensao ? 1 : 0);
  add("afdd", r.afdd.length + r.afdd_existentes);
  add("medidor_geral", p.medidor_geral ? 1 : 0);
  add("geral_wifi", p.geral_wifi ? 1 : 0);
  if (levaQuadroNovo(estado.quadro)) {
    // O geral (salvo com o geral Wi-Fi) e o de cada quadro parcial (a saída do piso, no geral).
    add("disjuntor_geral", (p.geral_wifi ? 0 : 1) + r.parciais);
    add("disjuntor_circuito", r.disjuntores - r.disjuntores_ve);
    add("disjuntor_tetrapolar", r.tetrapolares - r.tetrapolares_ve);
    // Caixas: a(s) do geral e as dos parciais (as de 12 módulos juntam-se numa linha).
    if (r.tamanho === TAMANHO_PARCIAL) add(`caixa_${r.tamanho}`, r.quadros + r.parciais);
    else { add(`caixa_${r.tamanho}`, r.quadros); add(`caixa_${TAMANHO_PARCIAL}`, r.parciais); }
  } else if (r.novos > MAX_MODULOS) {
    add("ampliacao", Math.ceil((r.novos - MAX_MODULOS) / MAX_MODULOS));
  }
  return out;
}

// ------------------------------------------------------------ potência sugerida (E-Redes)

/** Escalões de potência contratada (kVA): monofásica até 13,8; acima, trifásica (BTN até 41,4). */
export const ESCALOES_KVA = [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7, 27.6, 34.5, 41.4];
export const MAX_MONO_KVA = 13.8;
export const W_LUZ = 20;          // ponto de luz LED
export const W_TOMADA = 100;      // uso diverso por tomada
/** Fator de uso da placa: nunca tem as zonas todas no máximo (7 200 W → 3 600 W). */
const USO = { placa: 0.5 };
/** Simultaneidade: a maior máquina a 100 %, a 2.ª a 50 %, as outras a 25 %; luzes, tomadas e máquinas pequenas a 40 %. */
export const SIMULTANEIDADE = { maior: 1, segunda: 0.5, outras: 0.25, geral: 0.4 };

/**
 * Mínimo de dimensionamento da RTIEBT 801.5.2.2 (habitação): 6,9 kVA com 2 a 6 compartimentos, 10,35 kVA com mais de
 * 6; null com 1 compartimento, sem compartimentos ou fora da habitação.
 */
export const MINIMO_KVA_RTIEBT = { ate6: 6.9, mais6: 10.35 };
export const minimoRtiebt = (compartimentos) => (compartimentos > 6 ? MINIMO_KVA_RTIEBT.mais6 : compartimentos >= 2 ? MINIMO_KVA_RTIEBT.ate6 : null);
/** Tipos de divisão que não contam como compartimento (circulações e exterior). */
const NAO_COMPARTIMENTO = ["corredor", "entrada", "escadas", "varanda", "jardim"];
/**
 * N.º de compartimentos da habitação para a RTIEBT 801.5.2.2 — aproximação pelos dados da casa (confirma-se na
 * visita): as divisões da planta (ou, sem planta, as do pedido, senão as que a casa gera) sem corredores, entradas,
 * escadas, varandas e exterior. null em serviços e industrial (a 801 é só para habitação) ou sem divisões.
 */
export function compartimentosRtiebt(estado) {
  const casa = estado?.casa ?? {};
  if (perfilCasa(casa.tipo) !== "habitacao") return null;
  const p = estado?.planta;
  const daPlanta = !!p && !estado.plantaSaltada && (p.divisoes?.length ?? 0) > 0;
  const divs = daPlanta ? p.divisoes : (estado?.divisoes?.length ? estado.divisoes : divisoesDaCasa(casa, []));
  const n = divs.filter((d) => d && typeof d === "object" && !NAO_COMPARTIMENTO.includes(tipoDivisao(d.nome))).length;
  return n || null;
}

/**
 * Potência a contratar pela soma das cargas do quadro com fatores de simultaneidade (§4.1, orientativo):
 * das máquinas com circuito próprio (placa a 50 % da nominal), a maior a 100 %, a segunda a 50 % e as
 * restantes a 25 %; luzes (20 W), tomadas (100 W) e máquinas pequenas a 40 %. Escalão E-Redes = o
 * primeiro ≥ carga (kVA ≈ kW, fator de potência ≈ 1). Com `compartimentos` (habitação) nunca abaixo do mínimo de
 * dimensionamento da RTIEBT 801.5.2.2 (minimoRtiebt): `minimo_rtiebt` = true quando foi o mínimo que valeu.
 * @returns {{carga_w:number, kva:number|null, trifasica:boolean, minimo_kva:number|null, minimo_rtiebt:boolean}} kva null = acima de 41,4 kVA
 */
export function potenciaSugerida(circuitos, compartimentos = null) {
  const S = SIMULTANEIDADE;
  let geral = 0;
  const grandes = [];
  for (const c of circuitos) {
    geral += (Number(c.itens?.luzes) || 0) * W_LUZ + (Number(c.itens?.tomadas) || 0) * W_TOMADA;
    for (const m of c.itens?.maquinas ?? []) {
      if (circuitoProprio(m)) grandes.push(watts(m) * (USO[m.modelo] ?? 1));
      else geral += watts(m);
    }
  }
  grandes.sort((a, b) => b - a);
  const maquinas = grandes.reduce((s, w, i) => s + w * (i === 0 ? S.maior : i === 1 ? S.segunda : S.outras), 0);
  const carga = Math.round(maquinas + geral * S.geral);
  const pelaCarga = ESCALOES_KVA.find((k) => carga <= k * 1000) ?? null;
  const minimo = compartimentos === null ? null : minimoRtiebt(Number(compartimentos) || 0);
  const minimoVale = minimo !== null && pelaCarga !== null && pelaCarga < minimo;
  const kva = minimoVale ? minimo : pelaCarga;
  return { carga_w: carga, kva, trifasica: kva === null || kva > MAX_MONO_KVA, minimo_kva: minimo, minimo_rtiebt: minimoVale };
}

const kvaTxt = (v) => `${String(v).replace(".", ",")} kVA`;
export const formatarKva = kvaTxt;

/**
 * Avisos do quadro (proteções, tamanho, ligação, potência sugerida). Todos terminam em "(orientativo —
 * confirmamos na visita)" e nunca bloqueiam.
 */
export function avisosProtecoes(estado) {
  const r = resumoQuadro(estado);
  const q = estado.quadro ?? {};
  const casa = estado.casa ?? {};
  const out = [];
  const a = (t) => out.push(`${t}${FIM_AVISO}`);
  if (q.para_raios === "sim") a("Com para-raios ou linha aérea incluímos sempre o descarregador de sobretensões (recomendado pela RTIEBT 801.5.10 com linha aérea).");
  else if (q.para_raios !== "nao" && !r.protecoes.descarregador) a("Se a casa tiver para-raios ou for alimentada por linha aérea, o descarregador de sobretensões é recomendado (RTIEBT 801.5.10).");
  if (r.grupos.some((g) => g.carregador)) a("O carregador do carro elétrico fica com diferencial próprio tipo A — tipo A exigido (RTIEBT 722); já vai na linha dedicada do carregador.");
  if (r.circuitos_existentes) a(`Quadro novo com os circuitos que a casa já tem: contámos ${r.circuitos_existentes} (1 de iluminação por piso, 1 de tomadas por cada 2 divisões, a cozinha e as casas de banho à parte), cada um com um disjuntor 1P+N — o n.º de circuitos a confirmar na visita.`);
  if (!r.cabe) a(`São ${r.ocupados} módulos: nem um quadro de 48 módulos deixa 25 % livres — contámos ${r.quadros} quadros de 48 (ou um armário maior).`);
  // Quadro novo: um de N módulos, ou vários de 48 quando nem esse deixa 25 % livres (r.cabe, r.quadros).
  const novo = r.cabe ? `um quadro novo de ${r.tamanho} módulos` : `${r.quadros} quadros novos de ${r.tamanho} módulos`;
  if (!levaQuadroNovo(q) && r.novos > 0) {
    a(`O quadro atual tem de ter espaço para ${r.novos} módulos novos${r.novos > MAX_MODULOS ? " (acrescentámos a ampliação do quadro)" : ""}; se não tiver, é preciso ${novo}.`);
  }
  if (q.quadro_novo !== "atual" && q.quadro_novo !== "novo") a(`Incluímos ${novo} por precaução: se o seu quadro servir, sai do preço.`);
  if (casa.fases === "tri") a("Na ligação trifásica o geral, os diferenciais e as proteções são tetrapolares (ocupam o dobro dos módulos e custam mais): o preço destes é confirmado na visita.");
  const pot = r.potencia;
  const contratada = Number(casa.potencia_contratada_kva) || null;
  if (pot.kva === null) a(`As cargas do quadro somam cerca de ${formatarW(pot.carga_w)} (com simultaneidade): acima de 41,4 kVA é preciso um contrato especial.`);
  else if (contratada && pot.kva > contratada) a(`A potência contratada (${kvaTxt(contratada)}) pode ser curta: ${pot.minimo_rtiebt ? `o mínimo da RTIEBT (801.5.2.2) para a casa é ${kvaTxt(pot.kva)}` : `pelas cargas do quadro sugerimos ${kvaTxt(pot.kva)}`}.`);
  else if (pot.minimo_rtiebt) a(`Potência sugerida ${kvaTxt(pot.kva)}: o mínimo da RTIEBT (801.5.2.2) para o dimensionamento da casa, acima do que as cargas pedem.`);
  if (pot.kva !== null && pot.trifasica && casa.fases !== "tri") a(`Para ${kvaTxt(pot.kva)} é preciso ligação trifásica (a monofásica vai até ${kvaTxt(MAX_MONO_KVA)}).`);
  return out;
}

// Ronda B (decisão do dono): o passo "Quadro elétrico" é só a foto — o esquema do quadro (geral, diferenciais, disjuntores,
// módulos livres) é feito pelo eletricista no painel a partir dela (quadro-desenho.js; docs/PAINEL-EMPRESA.md).
