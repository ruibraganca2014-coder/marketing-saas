// Simulador de orçamento — localidade e deslocação por distância (docs/SIMULADOR-ORCAMENTO.md §5.1).
// Só lógica, sem DOM e sem pedidos de rede: a tabela dos 308 concelhos vem de ./concelhos.js.
//
// Distância estimada = distância em linha reta (haversine, entre as sedes dos concelhos) × FATOR_ESTRADA.
// Deslocação por dia de obra, ida e volta (ronda dinheiro, decisão 4 do dono), € c/ IVA:
//   um dia = deslocacao_iva (valor fixo, o mínimo de cada dia) + max(0, km − deslocacao_km_gratis) × 2 × deslocacao_preco_km_iva
//   total  = um dia × min(dias, deslocacao_max_dias) (dias de obra: preco.js diasDeObra; no máximo 5 por obra; a
//            visita técnica e a avaria são 1 dia).

import { CONCELHOS } from "./concelhos.js";

/** Estradas não são retas: ~1,3 × a distância em linha reta (média habitual em Portugal continental). */
export const FATOR_ESTRADA = 1.3;
const RAIO_TERRA_KM = 6371;

/** Configuração da deslocação quando o /api/catalogo não a traz (iguais às da migração 4 do painel). */
export const DESLOCACAO_OMISSAO = {
  deslocacao_iva: 0, deslocacao_base: "Lisboa", deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100,
  deslocacao_max_dias: 5,   // teto: no máximo 5 dias de deslocação por obra (decisão do dono)
};

/** Texto para comparar: sem acentos, minúsculas, só letras e números separados por um espaço. */
export const chave = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

const LISTA = CONCELHOS.map(([nome, distrito, ilha, lat, lon]) => ({ nome, distrito, ilha, lat, lon, k: chave(nome) }));
const POR_CHAVE = new Map(LISTA.map((c) => [c.k, c]));
// "Calheta" e "Lagoa" (sem o parêntese) são ambíguos: só contam os nomes sem parêntese únicos.
const SEM_PARENTESE = new Map();
for (const c of LISTA) {
  const k = chave(c.nome.replace(/\s*\(.*\)\s*$/, ""));
  if (k !== c.k) SEM_PARENTESE.set(k, SEM_PARENTESE.has(k) ? null : c);
}

/** Nomes dos 308 concelhos (ordem alfabética). */
export const NOMES_CONCELHOS = LISTA.map((c) => c.nome);

/**
 * Concelho reconhecido num texto livre, ou null. Aceita o nome sem acentos nem maiúsculas ("evora")
 * e "Sintra, Lisboa" (conta o que vem antes da vírgula). Freguesias e aldeias → null.
 */
export function procurarConcelho(texto) {
  const k = chave(texto);
  if (!k) return null;
  const tentar = (x) => POR_CHAVE.get(x) ?? SEM_PARENTESE.get(x) ?? null;
  const c = tentar(k) ?? (String(texto).includes(",") ? tentar(chave(String(texto).split(",")[0])) : null);
  return c ? { nome: c.nome, distrito: c.distrito, ilha: c.ilha, lat: c.lat, lon: c.lon } : null;
}

/**
 * Sugestões para o que o cliente escreve (sem acentos): primeiro os que começam pelo texto, depois
 * os que têm uma palavra a começar por ele. Até `max`.
 */
export function sugerirConcelhos(texto, max = 8) {
  const k = chave(texto);
  if (!k) return [];
  const inicio = LISTA.filter((c) => c.k.startsWith(k));
  const palavra = LISTA.filter((c) => !c.k.startsWith(k) && c.k.includes(` ${k}`));
  return [...inicio, ...palavra].slice(0, max).map((c) => ({ nome: c.nome, distrito: c.distrito }));
}

/** Distância em linha reta (km) entre dois pontos {lat, lon}. */
export function haversineKm(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distância estimada por estrada (km, inteiro), ou null entre ilhas diferentes / ilha e continente. */
export function distanciaEstrada(base, destino) {
  if ((base.ilha ?? null) !== (destino.ilha ?? null)) return null;
  return Math.round(haversineKm(base, destino) * FATOR_ESTRADA);
}

/** Configuração da deslocação a partir do `config` do /api/catalogo (valores inválidos → omissão). */
export function configDeslocacao(config) {
  const cfg = { ...DESLOCACAO_OMISSAO };
  for (const k of ["deslocacao_iva", "deslocacao_km_gratis", "deslocacao_preco_km_iva", "deslocacao_max_km"]) {
    const v = config?.[k];
    if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) cfg[k] = Number(v);
  }
  const md = Number(config?.deslocacao_max_dias);
  if (config?.deslocacao_max_dias !== null && config?.deslocacao_max_dias !== "" && Number.isFinite(md) && md >= 1) cfg.deslocacao_max_dias = Math.floor(md);
  if (typeof config?.deslocacao_base === "string" && procurarConcelho(config.deslocacao_base)) cfg.deslocacao_base = config.deslocacao_base;
  return cfg;
}

const cent = (x) => Math.round(x * 100) / 100;
/** Cada dia de obra é uma ida e uma volta: os km pagos contam a dobrar. */
export const IDA_E_VOLTA = 2;

/**
 * Deslocação para uma localidade escrita pelo cliente, por `dias` de obra (1 = a visita técnica, a avaria, ou antes
 * de se saberem as horas: preco.js calcularPreco acerta os dias pelas horas do trabalho).
 * estado: "sem_localidade" | "visita" (texto sem concelho reconhecido) | "estimada" | "fora_area"
 * (acima da distância máxima, ou noutra ilha / entre ilha e continente).
 * valor_dia_iva: um dia, ida e volta — com a distância, o fixo + os km pagos × 2; sem concelho reconhecido, só o fixo
 * (o mínimo, o resto confirma-se na visita); fora da área, null (não soma: "contacte-nos"). valor_iva = um dia × dias,
 * com os dias limitados a `deslocacao_max_dias` (5; `limitado` = os dias pedidos passavam o teto).
 * @returns {{estado:string, localidade:string, concelho:string|null, distrito:string|null, distancia_km:number|null, dias:number, valor_dia_iva:number|null, valor_iva:number|null, config:object}}
 */
export function calcularDeslocacao(localidade, config, dias = 1) {
  const cfg = configDeslocacao(config);
  const loc = String(localidade ?? "").trim();
  const c = procurarConcelho(loc);
  const pedidos = Math.max(1, Math.round(Number(dias)) || 1);
  const n = Math.min(pedidos, cfg.deslocacao_max_dias);
  const r = { localidade: loc, concelho: c?.nome ?? null, distrito: c?.distrito ?? null, distancia_km: null, dias: n, limitado: pedidos > n, config: cfg };
  const valor = (dia) => ({ valor_dia_iva: dia, valor_iva: dia === null ? null : cent(dia * n) });
  if (!c) return { ...r, estado: loc ? "visita" : "sem_localidade", ...valor(cfg.deslocacao_iva) };
  const base = procurarConcelho(cfg.deslocacao_base);
  const km = distanciaEstrada(base, c);
  if (km === null) return { ...r, estado: "fora_area", ...valor(null) };
  if (km > cfg.deslocacao_max_km) return { ...r, estado: "fora_area", distancia_km: km, ...valor(null) };
  const pagos = Math.max(0, km - cfg.deslocacao_km_gratis);
  return { ...r, estado: "estimada", distancia_km: km, ...valor(cent(cfg.deslocacao_iva + pagos * IDA_E_VOLTA * cfg.deslocacao_preco_km_iva)) };
}
