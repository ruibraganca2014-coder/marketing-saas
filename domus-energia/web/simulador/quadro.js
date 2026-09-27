// Simulador de orçamento — passo "Quadro elétrico" (docs/SIMULADOR-ORCAMENTO.md §4.1): regras da
// RTIEBT para a sugestão de circuitos, proteções por pacotes, grupos diferenciais, AFDD, módulos e
// tamanho do quadro, potência sugerida pelos escalões da E-Redes. Só lógica, sem DOM.
// As regras são ORIENTATIVAS: a solução final é validada na visita técnica.

import {
  codigoCircuito, circuitoProprio, trifasica, watts, perfilCasa, formatarW, FIM_AVISO, MAX_MODULOS, MODULOS_SY1,
  TIPOS_COM_PISOS, LIMITES_CASA, pisoDe,
} from "./regras.js";
import { tipoDivisao } from "./casa.js";

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
 * Dividir iluminação e tomadas em 2 (zona de dia / zona de noite)? RTIEBT: T3 e mais (3 ou mais quartos);
 * serviços e industrial: o equivalente pela área (≥ 100 m²).
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
 * Proteções e extras que se ligam/desligam (os 2 diferenciais de 30 mA são o mínimo da RTIEBT: vão sempre;
 * `idr_wifi` troca-os pelos Wi-Fi com religação automática).
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
  essencial: { nome: "Essencial", ajuda: "2 diferenciais de 30 mA e os disjuntores (o mínimo da RTIEBT)", liga: [] },
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
 * (o descarregador obrigatório com pára-raios não é uma personalização: pacoteDoQuadro).
 */
export function pacoteDe(p, ignorar = []) {
  const conta = DOS_PACOTES.filter((x) => !ignorar.includes(x));
  for (const [k, v] of Object.entries(PACOTES)) if (conta.every((x) => !!p?.[x] === v.liga.includes(x))) return k;
  return "personalizado";
}

/**
 * Pacote do quadro pelas proteções que o cliente escolheu: com pára-raios ou linha aérea o descarregador é
 * obrigatório (fica ligado e bloqueado) e não conta — "Essencial" com pára-raios continua "Essencial".
 */
export const pacoteDoQuadro = (q) => pacoteDe(q?.protecoes, q?.para_raios === "sim" ? ["descarregador"] : []);

/** Respostas à pergunta "A casa tem pára-raios ou é alimentada por linha aérea?" e "O quadro atual serve?". */
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

/** Proteções que valem: com pára-raios ou linha aérea o descarregador é obrigatório. */
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
 * Grupos diferenciais (IDR 40 A / 30 mA; RTIEBT: pelo menos 2). Grupo 1: a 1.ª iluminação, as tomadas
 * gerais (C2) e placa/forno (C3); grupo 2: a 2.ª iluminação, máquinas de lavar e termoacumulador (C4) e as
 * tomadas das zonas húmidas (C5) — as cargas grandes ficam repartidas e um disparo num grupo nunca deixa a
 * casa toda às escuras. As outras máquinas vão
 * para o grupo com menos circuitos. Mais de 8 circuitos num grupo → outro diferencial. O carregador do
 * carro elétrico tem sempre diferencial próprio (RTIEBT secção 722).
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
 * N.º de quadros: com planta, um por piso que tem um "Quadro elétrico" desenhado (a planta desenhada pela
 * casa põe um em cada piso: casa.js divisoesQuadro); sem planta, um por piso da casa. Pelo menos 1.
 */
export function numeroQuadros(estado) {
  const p = estado?.planta;
  const usaPlanta = !!p && !estado.plantaSaltada && ((p.divisoes?.length ?? 0) > 0 || (p.elementos?.length ?? 0) > 0);
  if (usaPlanta) return Math.max(1, new Set((p.elementos ?? []).filter((e) => e.tipo === "quadro").map(pisoDe)).size);
  const c = estado?.casa ?? {};
  const [, max] = LIMITES_CASA.pisos;
  return TIPOS_COM_PISOS.includes(c.tipo) ? Math.min(max, Math.max(1, Math.round(Number(c.pisos)) || 1)) : 1;
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
  const grupos = gruposDiferenciais(circuitos);
  const afdd = prot.afdd ? circuitos.filter((c) => circuitoComAfdd(c, casa.tipo)).map((c) => c.n) : [];
  const linhas = [];
  let novos = 0;   // módulos a mais num quadro que fica (o geral, o 1.º diferencial e os disjuntores já lá estão)
  const linha = (chave, nome, qtd, modulos) => { if (qtd > 0) linhas.push({ chave, nome, qtd, modulos }); };
  linha("geral", prot.geral_wifi ? "Disjuntor geral Wi-Fi (com medição)" : "Disjuntor geral", 1, MODULOS.geral * P);
  linha("diferencial", `Diferencial 40 A / 30 mA${prot.idr_wifi ? " Wi-Fi" : ""}`, grupos.length, grupos.length * MODULOS.diferencial * P);
  novos += Math.max(0, grupos.length - 1) * MODULOS.diferencial * P;
  let disj = 0, mDisj = 0, nAfdd = 0, mAfdd = 0, sy2 = 0, sy1 = 0, mSy = 0, tetra = 0;
  for (const c of circuitos) {
    const i = inteligenteDe(c, q.disjuntor);
    const comAfdd = afdd.includes(c.n);
    if (tri && (c.itens?.maquinas ?? []).some(trifasica)) { tetra++; continue; }
    if (comAfdd) { nAfdd++; mAfdd += MODULOS.afdd; novos += i === "sy2" ? MODULOS.afdd : MODULOS.afdd - MODULOS.disjuntor; }
    if (i === "sy2") { sy2++; mSy += MODULOS.sy; }
    else if (!comAfdd) { disj++; mDisj += MODULOS.disjuntor; }
    if (i === "sy1") { sy1++; mSy += MODULOS.sy; novos += MODULOS.sy; }
  }
  linha("disjuntor", "Disjuntores dos circuitos", disj, mDisj);
  linha("afdd", "AFDD com disjuntor", nAfdd, mAfdd);
  linha("inteligente", `Disjuntores inteligentes (${[sy2 ? `${sy2} SY2` : "", sy1 ? `${sy1} SY1` : ""].filter(Boolean).join(", ")})`, sy2 + sy1, mSy);
  linha("tetrapolar", "Disjuntor trifásico (máquina trifásica)", tetra, tetra * MODULOS.tetrapolar);
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
    disjuntores: disj, sy2, sy1,
    parciais: numeroQuadros(estado) - 1,
    potencia: potenciaSugerida(circuitos),
  };
}

/** O preço leva a caixa de um quadro novo? Sim com "Quero quadro novo" e com "Não sei" (por precaução). */
export const levaQuadroNovo = (q) => q?.quadro_novo !== "atual";

/**
 * Artigos do quadro para o preço (preco.js): diferenciais (Wi-Fi ou não), descarregador, relé de tensão,
 * AFDD, medidor e geral Wi-Fi; com quadro novo a caixa (mais uma de 12 módulos por quadro parcial), o geral
 * e os disjuntores dos circuitos sem SY2/AFDD; com o quadro atual, a ampliação quando há mais de 12 módulos novos.
 * @returns {{chave:string, qtd:number}[]}
 */
export function pedidosQuadro(estado) {
  const r = resumoQuadro(estado);
  const p = r.protecoes;
  const out = [];
  const add = (chave, qtd) => { if (qtd > 0) out.push({ chave, qtd }); };
  add(p.idr_wifi ? "diferencial_wifi" : "diferencial", r.grupos.length);
  add("descarregador", p.descarregador ? 1 : 0);
  add("rele_tensao", p.rele_tensao ? 1 : 0);
  add("afdd", r.afdd.length);
  add("medidor_geral", p.medidor_geral ? 1 : 0);
  add("geral_wifi", p.geral_wifi ? 1 : 0);
  if (levaQuadroNovo(estado.quadro)) {
    add("disjuntor_geral", p.geral_wifi ? 0 : 1);
    add("disjuntor_circuito", r.disjuntores);
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
 * Potência a contratar pela soma das cargas do quadro com fatores de simultaneidade (§4.1, orientativo):
 * das máquinas com circuito próprio (placa a 50 % da nominal), a maior a 100 %, a segunda a 50 % e as
 * restantes a 25 %; luzes (20 W), tomadas (100 W) e máquinas pequenas a 40 %. Escalão E-Redes = o
 * primeiro ≥ carga (kVA ≈ kW, fator de potência ≈ 1).
 * @returns {{carga_w:number, kva:number|null, trifasica:boolean}} kva null = acima de 41,4 kVA
 */
export function potenciaSugerida(circuitos) {
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
  const kva = ESCALOES_KVA.find((k) => carga <= k * 1000) ?? null;
  return { carga_w: carga, kva, trifasica: kva === null || kva > MAX_MONO_KVA };
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
  if (q.para_raios === "sim") a("Com pára-raios ou linha aérea o descarregador de sobretensões é obrigatório: está incluído.");
  else if (q.para_raios !== "nao" && !r.protecoes.descarregador) a("Se a casa tiver pára-raios ou for alimentada por linha aérea, o descarregador de sobretensões é obrigatório.");
  if (r.grupos.some((g) => g.carregador)) a("O carregador do carro elétrico fica com diferencial próprio (tipo A ou B; muitos carregadores já o trazem).");
  if (!r.cabe) a(`São ${r.ocupados} módulos: nem um quadro de 48 módulos deixa 25 % livres — contámos ${r.quadros} quadros de 48 (ou um armário maior).`);
  if (!levaQuadroNovo(q) && r.novos > 0) {
    a(`O quadro atual tem de ter espaço para ${r.novos} módulos novos${r.novos > MAX_MODULOS ? " (acrescentámos a ampliação do quadro)" : ""}; se não tiver, é preciso um quadro novo de ${r.tamanho} módulos.`);
  }
  if (q.quadro_novo !== "atual" && q.quadro_novo !== "novo") a(`Incluímos um quadro novo de ${r.tamanho} módulos por precaução: se o seu quadro servir, sai do preço.`);
  if (casa.fases === "tri") a("Na ligação trifásica o geral, os diferenciais e as proteções são tetrapolares (ocupam o dobro dos módulos e custam mais): o preço destes é confirmado na visita.");
  const pot = r.potencia;
  const contratada = Number(casa.potencia_contratada_kva) || null;
  if (pot.kva === null) a(`As cargas do quadro somam cerca de ${formatarW(pot.carga_w)} (com simultaneidade): acima de 41,4 kVA é preciso um contrato especial.`);
  else if (contratada && pot.kva > contratada) a(`A potência contratada (${kvaTxt(contratada)}) pode ser curta: pelas cargas do quadro sugerimos ${kvaTxt(pot.kva)}.`);
  if (pot.kva !== null && pot.trifasica && casa.fases !== "tri") a(`Para ${kvaTxt(pot.kva)} é preciso ligação trifásica (a monofásica vai até ${kvaTxt(MAX_MONO_KVA)}).`);
  return out;
}
