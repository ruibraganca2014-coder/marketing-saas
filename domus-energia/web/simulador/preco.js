// Simulador de orçamento — artigos e preço (docs/SIMULADOR-ORCAMENTO.md §3, §5).
// Só lógica, sem DOM. O catálogo vem de GET /api/catalogo ({itens, config}); sem
// catálogo mostra-se a lista sem preços ("vamos enviar-lhe o preço").

import { modulosNovos, MAX_MODULOS } from "./regras.js";

export const CONFIG_OMISSAO = { tarifa_hora_iva: 35, margem_intervalo_pct: 15, deslocacao_iva: 0 };
export const TEXTO_ESTIMATIVA = "Estimativa. O valor final é confirmado na visita técnica gratuita.";
export const SKU_SY2 = "TONGOU-SY2-JWT";
export const SKU_SY1 = "TONGOU-SY1-JWT";

export const PLANOS = {
  base: { nome: "Base", preco: 4.99 },
  conforto: { nome: "Conforto", preco: 9.99 },
  premium: { nome: "Premium", preco: 19.99 },
};

const temProtecoes = (e) => Array.isArray(e?.protecoes) ? e.protecoes.length > 0 : e?.protecoes === true;

/**
 * O que o simulador procura no catálogo: primeiro pelo SKU; se o CEO o mudou
 * ou retirou, por categoria + especificações. `nome` é o texto quando não há catálogo.
 */
export const PEDIDOS = {
  disjuntor_protecoes: { sku: SKU_SY2, nome: "Disjuntor inteligente Wi-Fi com medição e proteções",
    procura: (a) => a.categoria === "disjuntor" && temProtecoes(a.especificacoes) },
  disjuntor_simples: { sku: SKU_SY1, nome: "Disjuntor inteligente Wi-Fi com medição",
    procura: (a) => a.categoria === "disjuntor" && !temProtecoes(a.especificacoes) },
  ampliacao: { sku: "QUADRO-AMPLIACAO", nome: "Ampliação do quadro (calha DIN, módulos)",
    procura: (a) => a.categoria === "acessorio" && /quadro/i.test(a.nome) },
  interruptor_1: { sku: "INT-VIDRO-1", nome: "Interruptor de parede tátil Wi-Fi 1 botão", procura: (a) => a.categoria === "interruptor" && Number(a.especificacoes?.botoes) === 1 },
  interruptor_2: { sku: "INT-VIDRO-2", nome: "Interruptor de parede tátil Wi-Fi 2 botões", procura: (a) => a.categoria === "interruptor" && Number(a.especificacoes?.botoes) === 2 },
  interruptor_3: { sku: "INT-VIDRO-3", nome: "Interruptor de parede tátil Wi-Fi 3 botões", procura: (a) => a.categoria === "interruptor" && Number(a.especificacoes?.botoes) === 3 },
  interruptor_4: { sku: "INT-VIDRO-4", nome: "Interruptor de parede tátil Wi-Fi 4 botões", procura: (a) => a.categoria === "interruptor" && Number(a.especificacoes?.botoes) === 4 },
  estore: { sku: "BAB-CURTAIN", nome: "Módulo de estore Wi-Fi", procura: (a) => a.categoria === "estore" },
  sensor_porta: { sku: "SENS-PORTA-WIFI", nome: "Sensor de porta/janela Wi-Fi", procura: (a) => a.categoria === "sensor" && /porta|janela/i.test(a.nome) },
  sensor_movimento: { sku: "SENS-PIR-WIFI", nome: "Sensor de movimento Wi-Fi", procura: (a) => a.categoria === "sensor" && /movimento|pir/i.test(a.nome) },
  regulador: { sku: "DIMMER-WIFI", nome: "Regulador de luz Wi-Fi", procura: (a) => a.categoria === "luz" },
  tomada: { sku: "TOMADA-WIFI", nome: "Tomada inteligente Wi-Fi com medição", procura: (a) => a.categoria === "tomada" },
  termostato: { sku: "BAB-HC-T010", nome: "Termóstato Wi-Fi ecrã tátil", procura: (a) => a.categoria === "termostato" },
  central: { sku: "RPI-CENTRAL", nome: "Central local Raspberry Pi (UPS, sirene)", procura: (a) => a.categoria === "central" },
};

/** Artigo do catálogo para um pedido (por SKU; senão por categoria/especificações); null se não houver. */
export function encontrarArtigo(chave, catalogo) {
  const p = PEDIDOS[chave];
  if (!p || !Array.isArray(catalogo)) return null;
  return catalogo.find((a) => a.sku === p.sku) ?? catalogo.find((a) => { try { return p.procura(a); } catch { return false; } }) ?? null;
}

const soma = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * Quantidades a partir das escolhas do cliente.
 * @param {{quadro:{circuitos:any[], disjuntor?:string}, divisoes:any[], extras?:{central?:boolean, termostatos?:number}}} s
 * @returns {{chave:string, qtd:number}[]}
 */
export function pedidosDaSelecao(s) {
  const r = [];
  const add = (chave, qtd) => { if (qtd > 0) r.push({ chave, qtd }); };
  const circ = s.quadro?.circuitos ?? [];
  const inteligentes = circ.filter((c) => c.inteligente || c.medir);
  const barato = s.quadro?.disjuntor === SKU_SY1;
  // Circuitos só com "medir" usam o disjuntor mais barato (também mede).
  const comProtecoes = barato ? 0 : inteligentes.filter((c) => c.inteligente).length;
  add("disjuntor_protecoes", comProtecoes);
  add("disjuntor_simples", inteligentes.length - comProtecoes);
  const mod = modulosNovos(circ);
  if (mod > MAX_MODULOS) add("ampliacao", Math.ceil((mod - MAX_MODULOS) / MAX_MODULOS));
  const divs = s.divisoes ?? [];
  for (const b of [1, 2, 3, 4]) add(`interruptor_${b}`, soma(divs, (d) => (d.interruptores ?? []).filter((x) => x === b).length));
  add("estore", soma(divs, (d) => d.estores));
  add("sensor_porta", soma(divs, (d) => d.sensores_porta));
  add("sensor_movimento", soma(divs, (d) => d.sensores_movimento));
  add("regulador", soma(divs, (d) => d.luzes_regulaveis));
  add("tomada", soma(divs, (d) => d.tomadas_inteligentes));
  add("termostato", Number(s.extras?.termostatos) || 0);
  add("central", s.extras?.central ? 1 : 0);
  return r;
}

export const cent = (x) => Math.round(x * 100) / 100;
export const arredondar5 = (x) => Math.round(x / 5) * 5;

/**
 * Preço (§5). catalogo = null quando o GET /api/catalogo falhou.
 * @returns {{linhas:{chave:string, sku:string, nome:string, qtd:number, preco_iva:number|null, total:number|null, horas:number|null}[],
 *   horas:number|null, mao_obra_iva:number|null, deslocacao_iva:number, artigos_iva:number|null, total:number|null,
 *   min:number|null, max:number|null, completo:boolean, config:object}}
 */
export function calcularPreco(pedidos, catalogo, config) {
  const cfg = { ...CONFIG_OMISSAO };
  for (const k of Object.keys(CONFIG_OMISSAO)) {
    const v = Number(config?.[k]);
    if (config && config[k] !== undefined && config[k] !== null && Number.isFinite(v) && v >= 0) cfg[k] = v;
  }
  const linhas = pedidos.map(({ chave, qtd }) => {
    const a = encontrarArtigo(chave, catalogo);
    const preco = a && Number.isFinite(Number(a.preco_venda_iva)) ? Number(a.preco_venda_iva) : null;
    const horas = a && Number.isFinite(Number(a.horas_instalacao)) ? Number(a.horas_instalacao) : null;
    return {
      chave, sku: a?.sku ?? PEDIDOS[chave].sku, nome: a?.nome ?? PEDIDOS[chave].nome, qtd,
      preco_iva: preco, total: preco === null ? null : cent(preco * qtd), horas: horas === null ? null : horas * qtd,
    };
  });
  if (!catalogo) {
    return { linhas, horas: null, mao_obra_iva: null, deslocacao_iva: cfg.deslocacao_iva, artigos_iva: null, total: null, min: null, max: null, completo: false, config: cfg };
  }
  const completo = linhas.every((l) => l.preco_iva !== null);
  const horas = cent(soma(linhas, (l) => l.horas));
  const mao = cent(horas * cfg.tarifa_hora_iva);
  const artigos = cent(soma(linhas, (l) => l.total));
  const desloc = linhas.length ? cfg.deslocacao_iva : 0;
  const total = cent(artigos + mao + desloc);
  const m = Math.min(cfg.margem_intervalo_pct, 100) / 100;
  return {
    linhas, horas, mao_obra_iva: mao, deslocacao_iva: desloc, artigos_iva: artigos, total,
    min: Math.max(0, arredondar5(total * (1 - m))), max: arredondar5(total * (1 + m)), completo, config: cfg,
  };
}

/** Plano mensal sugerido (§5): central → Premium; sensores/alarme → Conforto; senão Base. */
export function planoSugerido(pedidos) {
  const tem = (k) => pedidos.some((p) => p.chave === k && p.qtd > 0);
  if (tem("central")) return "premium";
  if (tem("sensor_porta") || tem("sensor_movimento")) return "conforto";
  return "base";
}

const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const horasFmt = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
// O Intl usa espaço inseparável antes do "€": fica igual ao resto do site com espaço normal.
export const formatarEuro = (x) => eur.format(x).replace(/[\u00a0\u202f]/g, " ");
export const formatarEuroRedondo = (x) => eur0.format(x).replace(/[\u00a0\u202f]/g, " ");
export const formatarHoras = (h) => `${horasFmt.format(h)} h`;
