// Simulador de orçamento — artigos e preço (docs/SIMULADOR-ORCAMENTO.md §3, §5).
// Só lógica, sem DOM. O catálogo vem de GET /api/catalogo ({itens, config}); sem
// catálogo mostra-se a lista sem preços ("vamos enviar-lhe o preço").

import { disjuntoresInteligentes } from "./regras.js";
import { pedidosQuadro, TAMANHOS_QUADRO } from "./quadro.js";
import { pedidosAcoes } from "./acoes.js";

// margem_pacotes_pct (fase 2): margem dos pacotes do passo "Melhorias" (melhorias.js), sobre material + mão de obra.
// Fase 3: o intervalo da estimativa é −intervalo_menos_pct / +intervalo_mais_pct (10 % / 20 %); um servidor antigo
// só com `margem_intervalo_pct` usa-a para os dois lados (como antes). preco_relatorio_iva: o relatório pormenorizado.
export const CONFIG_OMISSAO = { tarifa_hora_iva: 38, intervalo_menos_pct: 10, intervalo_mais_pct: 20, deslocacao_iva: 0, margem_pacotes_pct: 20, preco_relatorio_iva: 29 };
/** Visita técnica: a deslocação + estas horas × a tarifa (o servidor calcula o valor a pagar da mesma maneira). */
export const VISITA_HORAS = 0.5;
export const TEXTO_ESTIMATIVA = "Estimativa; valor final após a visita.";
export const SKU_SY2 = "TONGOU-SY2-JWT";
export const SKU_SY1 = "TONGOU-SY1-JWT";
/** Horas de troca (Substituir) de um artigo sem `horas_troca` no catálogo: esta fração das horas de instalação. */
export const FRACAO_TROCA = 0.5;

export const PLANOS = {
  base: { nome: "Base", preco: 4.99 },
  conforto: { nome: "Conforto", preco: 9.99 },
  premium: { nome: "Premium", preco: 19.99 },
};

const temProtecoes = (e) => Array.isArray(e?.protecoes) ? e.protecoes.length > 0 : e?.protecoes === true;
/** Artigos do quadro (diferencial, AFDD, caixa…) têm `especificacoes.funcao`: nunca passam por disjuntor inteligente nem ampliação. */
const funcao = (a) => (typeof a?.especificacoes?.funcao === "string" ? a.especificacoes.funcao : null);
const comFuncao = (f) => (a) => funcao(a) === f;
/** Caixas de quadro por tamanho (12–48 módulos). */
const CAIXAS = Object.fromEntries(TAMANHOS_QUADRO.map((m) => [`caixa_${m}`, {
  sku: `CAIXA-QUADRO-${m}`, nome: `Caixa de quadro elétrico ${m} módulos`,
  procura: (a) => funcao(a) === "caixa_quadro" && Number(a.especificacoes?.modulos_caixa) === m,
}]));

/**
 * O que o simulador procura no catálogo: primeiro pelo SKU; se o CEO o mudou
 * ou retirou, por categoria + especificações. `nome` é o texto quando não há catálogo.
 */
export const PEDIDOS = {
  disjuntor_protecoes: { sku: SKU_SY2, nome: "Disjuntor inteligente Wi-Fi com medição e proteções",
    procura: (a) => a.categoria === "disjuntor" && !funcao(a) && temProtecoes(a.especificacoes) },
  disjuntor_simples: { sku: SKU_SY1, nome: "Disjuntor inteligente Wi-Fi com medição",
    procura: (a) => a.categoria === "disjuntor" && !funcao(a) && !temProtecoes(a.especificacoes) },
  ampliacao: { sku: "QUADRO-AMPLIACAO", nome: "Ampliação do quadro (calha DIN, módulos)",
    procura: (a) => a.categoria === "acessorio" && !funcao(a) && /quadro/i.test(a.nome) },
  // Quadro elétrico (§4.1): proteções, extras, disjuntores de um quadro novo e caixas.
  diferencial: { sku: "IDR-2P-40A-30MA", nome: "Interruptor diferencial 2P 40 A 30 mA tipo AC",
    procura: (a) => funcao(a) === "diferencial" && !a.especificacoes?.wifi },
  diferencial_wifi: { sku: "RCBO-WIFI-TOSMR1", nome: "Diferencial Wi-Fi com religação automática (RCBO Tongou TOSMR1)",
    procura: (a) => funcao(a) === "diferencial" && !!a.especificacoes?.wifi },
  descarregador: { sku: "SPD-T2-1PN-40KA", nome: "Descarregador de sobretensões tipo 2", procura: comFuncao("descarregador") },
  rele_tensao: { sku: "RELE-TENSAO-WIFI", nome: "Relé de proteção de sobretensão/subtensão Wi-Fi com religação", procura: comFuncao("rele_tensao") },
  afdd: { sku: "AFDD-1PN-16A", nome: "Detetor de arco elétrico AFDD com disjuntor", procura: comFuncao("afdd") },
  medidor_geral: { sku: "MEDIDOR-DIN-WIFI", nome: "Medidor de energia geral Wi-Fi", procura: comFuncao("medidor_geral") },
  geral_wifi: { sku: "GERAL-WIFI-2P-63A", nome: "Disjuntor geral Wi-Fi com medição e corte remoto", procura: comFuncao("geral_wifi") },
  disjuntor_circuito: { sku: "MCB-1PN-C", nome: "Disjuntor 1P+N curva C", procura: comFuncao("disjuntor_circuito") },
  disjuntor_tetrapolar: { sku: "MCB-4P-C", nome: "Disjuntor tetrapolar 4P", procura: comFuncao("disjuntor_tetrapolar") },
  disjuntor_geral: { sku: "GERAL-2P-63A", nome: "Disjuntor geral 2P", procura: comFuncao("geral") },
  ...CAIXAS,
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
  // Fase 2 (passo "Melhorias", melhorias.js): módulo atrás do interruptor e sensor de fuga de água.
  modulo_interruptor: { sku: "BAB-MOD-2CH", nome: "Módulo interruptor Wi-Fi 2 canais (atrás do interruptor)", procura: (a) => a.categoria === "interruptor" && Number(a.especificacoes?.canais) > 0 },
  sensor_agua: { sku: "SENS-AGUA-WIFI", nome: "Sensor de fuga de água Wi-Fi", procura: (a) => a.categoria === "sensor" && a.especificacoes?.deteta === "agua" },
  central: { sku: "RPI-CENTRAL", nome: "Central local Raspberry Pi (UPS, sirene)", procura: (a) => a.categoria === "central" },
  // Ações por aparelho (lote 7, acoes.js): Reparar = diagnóstico por avaria (a peça confirma-se na visita); Substituir
  // uma tomada/interruptor/ponto de luz normal; trocar a ligação de uma máquina (a máquina é do cliente).
  diagnostico: { sku: "DIAG-AVARIA", nome: "Diagnóstico de avaria (por aparelho; a peça confirma-se na visita)", procura: comFuncao("diagnostico") },
  aparelho_normal: { sku: "APARELHO-NORMAL", nome: "Tomada, interruptor ou ponto de luz normal (troca)", procura: comFuncao("aparelho_normal") },
  troca_maquina: { sku: "TROCA-MAQUINA", nome: "Ligar uma máquina no lugar da antiga (troca)", procura: comFuncao("troca_maquina") },
};

/** Horas de troca de um artigo: `horas_troca` do catálogo ou, sem ela, FRACAO_TROCA das horas de instalação. */
export function horasTroca(a) {
  const t = a?.horas_troca;
  if (t !== null && t !== undefined && t !== "" && Number.isFinite(Number(t)) && Number(t) >= 0) return Number(t);
  const h = Number(a?.horas_instalacao);
  return Number.isFinite(h) ? h * FRACAO_TROCA : null;
}

/**
 * O quadro (proteções, caixa, ampliação) entra no pedido? Sempre com "Instalação nova" (e nos estados sem serviço);
 * sem ela, só se o cliente disser que quer melhorar o quadro (`mexerQuadro`).
 */
export const quadroNoPedido = (s) => !Array.isArray(s?.servico) || s.servico.includes("nova") || s.mexerQuadro === true;

/** Artigo do catálogo para um pedido (por SKU; senão por categoria/especificações); null se não houver. */
export function encontrarArtigo(chave, catalogo) {
  const p = PEDIDOS[chave];
  if (!p || !Array.isArray(catalogo)) return null;
  return catalogo.find((a) => a.sku === p.sku) ?? catalogo.find((a) => { try { return p.procura(a); } catch { return false; } }) ?? null;
}

const soma = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * Quantidades a partir das escolhas do cliente. As linhas das divisões (`divisoes`) e os circuitos são só dos
 * aparelhos Novos (app.js conta a planta dos novos); Reparar e Substituir vêm da planta (`acao` no pedido; lote 7);
 * o quadro tem `grupo: "quadro"`.
 * @param {{casa?:object, servico?:string[], mexerQuadro?:boolean, planta?:object, quadro:{circuitos:any[], disjuntor?:string, protecoes?:object, para_raios?:string|null, quadro_novo?:string|null}, divisoes:any[], extras?:{central?:boolean, termostatos?:number}}} s
 * @returns {{chave:string, qtd:number, acao?:string, grupo?:string}[]}
 */
export function pedidosDaSelecao(s) {
  const r = [];
  const add = (chave, qtd) => { if (qtd > 0) r.push({ chave, qtd }); };
  const circ = s.quadro?.circuitos ?? [];
  // Circuitos só com "medir" usam o disjuntor mais barato (também mede).
  const d = disjuntoresInteligentes(circ, s.quadro?.disjuntor);
  add("disjuntor_protecoes", d.sy2);
  add("disjuntor_simples", d.sy1);
  // Quadro (§4.1): diferenciais, proteções escolhidas, caixa e disjuntores de um quadro novo, ou a
  // ampliação do quadro atual (> 12 módulos novos; o SY2 substitui o disjuntor, o SY1 fica ao lado).
  if (s.casa && quadroNoPedido(s)) for (const p of pedidosQuadro(s)) if (p.qtd > 0) r.push({ chave: p.chave, qtd: p.qtd, grupo: "quadro" });
  const divs = s.divisoes ?? [];
  for (const b of [1, 2, 3, 4]) add(`interruptor_${b}`, soma(divs, (d) => (d.interruptores ?? []).filter((x) => x === b).length));
  add("estore", soma(divs, (d) => d.estores));
  add("sensor_porta", soma(divs, (d) => d.sensores_porta));
  add("sensor_movimento", soma(divs, (d) => d.sensores_movimento));
  add("regulador", soma(divs, (d) => d.luzes_regulaveis));
  add("tomada", soma(divs, (d) => d.tomadas_inteligentes));
  add("termostato", Number(s.extras?.termostatos) || 0);
  add("central", s.extras?.central ? 1 : 0);
  if (s.planta) for (const p of pedidosAcoes(s.planta, s.servico)) r.push(p);
  // Lote 8: o quadro com problemas ("Trocar e reparar") é mais um diagnóstico de avaria.
  if (typeof s.quadroAvaria === "string") {
    const d = r.find((p) => p.chave === "diagnostico" && p.acao === "reparar");
    if (d) d.qtd++; else r.push({ chave: "diagnostico", qtd: 1, acao: "reparar" });
  }
  return r;
}

export const cent = (x) => Math.round(x * 100) / 100;
export const arredondar5 = (x) => Math.round(x / 5) * 5;

/**
 * Preço (§5). catalogo = null quando o GET /api/catalogo falhou. `deslocacao`: calcularDeslocacao() de
 * ./deslocacao.js (§5.1) — soma o seu valor_iva (null = fora da área: não soma); sem ele soma o
 * `deslocacao_iva` fixo (como antes). `extra`: a margem dos pacotes aceites no passo "Melhorias" (melhorias.js; as
 * linhas deles já estão nos pedidos, com `grupo: "melhoria"`).
 * @returns {{linhas:{chave:string, sku:string, nome:string, qtd:number, preco_iva:number|null, total:number|null, horas:number|null}[],
 *   horas:number|null, mao_obra_iva:number|null, deslocacao_iva:number, artigos_iva:number|null, melhorias_margem_iva:number, total:number|null,
 *   min:number|null, max:number|null, completo:boolean, config:object, deslocacao:object|null}}
 */
export function calcularPreco(pedidos, catalogo, config, deslocacao = null, extra = 0) {
  const cfg = { ...CONFIG_OMISSAO };
  const valido = (k) => config && config[k] !== undefined && config[k] !== null && Number.isFinite(Number(config[k])) && Number(config[k]) >= 0;
  for (const k of Object.keys(CONFIG_OMISSAO)) if (valido(k)) cfg[k] = Number(config[k]);
  // Servidor antigo (só a margem simétrica): usa-a para os dois lados.
  if (valido("margem_intervalo_pct")) {
    if (!valido("intervalo_menos_pct")) cfg.intervalo_menos_pct = Number(config.margem_intervalo_pct);
    if (!valido("intervalo_mais_pct")) cfg.intervalo_mais_pct = Number(config.margem_intervalo_pct);
  }
  const linhas = pedidos.map(({ chave, qtd, acao = null, grupo = null }) => {
    const a = encontrarArtigo(chave, catalogo);
    const preco = a && Number.isFinite(Number(a.preco_venda_iva)) ? Number(a.preco_venda_iva) : null;
    // Substituir: as horas de troca (menos do que instalar de novo); o resto, as de instalação.
    const horas = !a ? null : acao === "substituir" ? horasTroca(a) : Number.isFinite(Number(a.horas_instalacao)) ? Number(a.horas_instalacao) : null;
    return {
      chave, sku: a?.sku ?? PEDIDOS[chave].sku, nome: a?.nome ?? PEDIDOS[chave].nome, qtd,
      preco_iva: preco, total: preco === null ? null : cent(preco * qtd), horas: horas === null ? null : horas * qtd,
      acao, grupo: acao ?? grupo ?? "novo",
    };
  });
  if (!catalogo) {
    return { linhas, horas: null, mao_obra_iva: null, deslocacao_iva: cfg.deslocacao_iva, artigos_iva: null, melhorias_margem_iva: 0, total: null, min: null, max: null, completo: false, config: cfg, deslocacao };
  }
  const completo = linhas.every((l) => l.preco_iva !== null);
  const horas = cent(soma(linhas, (l) => l.horas));
  const mao = cent(horas * cfg.tarifa_hora_iva);
  const artigos = cent(soma(linhas, (l) => l.total));
  const desloc = !linhas.length ? 0 : deslocacao ? deslocacao.valor_iva ?? 0 : cfg.deslocacao_iva;
  const margem = cent(Number(extra) > 0 ? Number(extra) : 0);
  const total = cent(artigos + mao + desloc + margem);
  const menos = Math.min(cfg.intervalo_menos_pct, 100) / 100;
  const mais = cfg.intervalo_mais_pct / 100;
  return {
    linhas, horas, mao_obra_iva: mao, deslocacao_iva: desloc, artigos_iva: artigos, melhorias_margem_iva: margem, total,
    min: Math.max(0, arredondar5(total * (1 - menos))), max: arredondar5(total * (1 + mais)), completo, config: cfg, deslocacao,
  };
}

/**
 * Plano mensal sugerido (§5): central → Premium; sensores/alarme ou o objetivo "controlar à distância"
 * (`distancia`: avisos no telemóvel com a casa vazia) → Conforto; senão Base.
 */
export function planoSugerido(pedidos, { distancia = false } = {}) {
  const tem = (k) => pedidos.some((p) => p.chave === k && p.qtd > 0);
  if (tem("central")) return "premium";
  if (tem("sensor_porta") || tem("sensor_movimento") || distancia) return "conforto";
  return "base";
}

// useGrouping "always": separador de milhares também com 4 dígitos ("1 120 €"; em pt-PT, por omissão, só a partir de 10 000).
const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" });
const eur0 = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, minimumFractionDigits: 0, useGrouping: "always" });
const horasFmt = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
// O Intl usa espaço inseparável antes do "€": fica igual ao resto do site com espaço normal. O dos milhares fica
// inseparável (parece um espaço normal, mas "1 120" nunca se parte em duas linhas).
const espacos = (t) => t.replace(/[\u00a0\u202f](?=€)/g, " ").replace(/\u202f/g, "\u00a0");
export const formatarEuro = (x) => espacos(eur.format(x));
export const formatarEuroRedondo = (x) => espacos(eur0.format(x));
export const formatarHoras = (h) => `${horasFmt.format(h)} h`;
