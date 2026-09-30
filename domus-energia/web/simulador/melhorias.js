// Simulador de orçamento — passo "Melhorias" (fase 2, docs/SIMULADOR-ORCAMENTO.md §0 "Melhorias — fase 2", §6): 4
// pacotes que o cliente junta ao orçamento, com o preço "a partir de" desta casa = (material + horas × tarifa) ×
// (1 + margem_pacotes_pct). Só lógica, sem DOM. Os artigos entram no orçamento como linhas `grupo: "melhoria"` (não
// vão para a planta); o "Quadro seguro" muda o pacote do quadro (quadro.js) e guarda as proteções de antes.

import { calcularPreco, quadroNoPedido, cent } from "./preco.js";
import { pedidosQuadro, pacoteDoQuadro, protecoesEfetivas, protecoesDoPacote, circuitoComAfdd, CHAVES_PROTECOES } from "./quadro.js";
import { acaoDe, inteligenteDe } from "./acoes.js";
import { circuitoProprio, trifasica, pisoDe } from "./regras.js";
import { tipoDivisao } from "./casa.js";

/** Os pacotes, pela ordem dos cartões (os ids vão no pedido e no parâmetro `?pacote=` da página). */
export const MELHORIAS = {
  "casa-inteligente": { nome: "Casa inteligente" },
  "poupar-energia": { nome: "Poupar energia" },
  seguranca: { nome: "Segurança" },
  "quadro-seguro": { nome: "Quadro seguro" },
};
export const CHAVES_MELHORIA = Object.keys(MELHORIAS);
export const QUADRO_SEGURO = "quadro-seguro";
/**
 * Proteção máxima do quadro (decisão do dono): AFDD nos circuitos dos quartos e sala, descarregador de sobretensões,
 * relé de tensão e diferenciais Wi-Fi com religação (RCBO). O medidor e o geral Wi-Fi ficam como o cliente escolheu.
 */
export const PROTECOES_MAXIMAS = ["afdd", "descarregador", "rele_tensao", "idr_wifi"];
const comMaximas = (p) => ({ ...p, ...Object.fromEntries(PROTECOES_MAXIMAS.map((k) => [k, true])) });

/** Divisões onde vai a tomada Wi-Fi (as de estar e trabalhar; sem casas de banho, corredores, arrumos…). */
const HABITAVEIS = ["sala", "sala_cozinha", "quarto", "cozinha", "escritorio", "loja", "rececao"];
/** Sensor de movimento: um na entrada e em cada sala (ou loja/receção). */
const COM_MOVIMENTO = ["entrada", "sala", "sala_cozinha", "loja", "rececao"];
/** Sensor de fuga de água: cozinha, casas de banho e lavandaria. */
const COM_AGUA = ["cozinha", "sala_cozinha", "wc", "lavandaria"];

export const melhoriasNovas = () => ({ aceites: [], quadroAnterior: null });

/** Estado gravado (ou de antes da fase 2): só ids conhecidos; as proteções de antes só com o "Quadro seguro" aceite. */
export function normalizarMelhorias(v) {
  const o = v && typeof v === "object" ? v : {};
  const aceites = Array.isArray(o.aceites) ? CHAVES_MELHORIA.filter((k) => o.aceites.includes(k)) : [];
  const a = o.quadroAnterior;
  const quadroAnterior = aceites.includes(QUADRO_SEGURO) && a && typeof a === "object" ? Object.fromEntries(CHAVES_PROTECOES.map((k) => [k, a[k] === true])) : null;
  return { aceites, quadroAnterior };
}

/** O quadro já tem a proteção máxima? (com pára-raios o descarregador já é obrigatório: quadro.js protecoesEfetivas) */
export const quadroNoMaximo = (q) => { const p = protecoesEfetivas(q); return PROTECOES_MAXIMAS.every((k) => p[k]); };

function aplicarQuadroSeguro(estado) {
  const q = estado.quadro;
  estado.melhorias.quadroAnterior = { ...q.protecoes };
  q.protecoes = comMaximas(q.protecoes);
  q.pacote = pacoteDoQuadro(q);
}

/**
 * Aceita (`sim`) ou tira um pacote. O "Quadro seguro" põe o quadro na proteção máxima (guarda as proteções de antes)
 * e, ao sair, repõe-nas; com o quadro já no máximo não se aceita ("Já incluído"). Devolve false se não mudou.
 */
export function mudarMelhoria(estado, id, sim) {
  if (!MELHORIAS[id]) return false;
  const m = estado.melhorias;
  const tem = m.aceites.includes(id);
  if (sim === tem) return false;
  if (id === QUADRO_SEGURO) {
    if (sim && quadroNoMaximo(estado.quadro)) return false;
    if (sim) aplicarQuadroSeguro(estado);
    else if (m.quadroAnterior) {
      estado.quadro.protecoes = { ...m.quadroAnterior };
      estado.quadro.pacote = pacoteDoQuadro(estado.quadro);
    }
    if (!sim) m.quadroAnterior = null;
  }
  m.aceites = sim ? CHAVES_MELHORIA.filter((k) => k === id || m.aceites.includes(k)) : m.aceites.filter((k) => k !== id);
  return true;
}

/**
 * Acerta o "Quadro seguro" com o quadro de agora: escolhido pelo `?pacote=` (ainda sem as proteções de antes) aplica-se
 * — ou, com o quadro já no máximo, sai (fica "Já incluído"); o quadro trocado por fora (casa guardada, "Já tenho a
 * planta") volta ao máximo.
 */
export function acertarMelhorias(estado) {
  const m = estado.melhorias;
  if (!m.aceites.includes(QUADRO_SEGURO)) { m.quadroAnterior = null; return; }
  if (quadroNoMaximo(estado.quadro)) { if (!m.quadroAnterior) m.aceites = m.aceites.filter((k) => k !== QUADRO_SEGURO); return; }
  aplicarQuadroSeguro(estado);
}

// ------------------------------------------------------------ o que cada pacote leva nesta casa

const servicosDe = (estado) => (estado.servico?.length ? estado.servico : ["nova"]);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Tomada ou interruptor que já fica inteligente (novo inteligente, trocado por inteligente, ou tomada já inteligente). */
function jaInteligente(e, servicos, objetivos) {
  const a = acaoDe(e, servicos);
  if (a === "substituir") return e.inteligente === true;
  if (a === "novo") return inteligenteDe(e, objetivos) === true;
  return e.tipo === "tomada" && !!e.props?.inteligente;
}

/** Divisões da planta com os seus elementos e a linha do passo "Divisões" (o que o pedido já leva). */
function divisoesDe(estado) {
  const p = estado.planta ?? {};
  const els = p.elementos ?? [];
  return (p.divisoes ?? []).map((d) => ({
    tipo: tipoDivisao(d.nome),
    els: els.filter((e) => e.divisao === d.id),
    linha: (estado.divisoes ?? []).find((x) => x.planta_id === d.id) ?? null,
  }));
}

/** Casa inteligente: módulo Wi-Fi atrás de cada interruptor (2 canais: 3–4 botões levam 2) e 1 tomada Wi-Fi por divisão habitável. */
function casaInteligente(estado) {
  const sv = servicosDe(estado), obj = estado.quer?.objetivos ?? [];
  let interruptores = 0, modulos = 0, tomadas = 0;
  for (const d of divisoesDe(estado)) {
    const ints = d.els.filter((e) => e.tipo === "interruptor");
    // Os que já ficam inteligentes: os da planta e os do passo "Divisões" (o mesmo interruptor não conta 2 vezes).
    const subst = ints.filter((e) => acaoDe(e, sv) === "substituir" && e.inteligente === true).length;
    const novos = ints.filter((e) => acaoDe(e, sv) !== "substituir" && jaInteligente(e, sv, obj)).length;
    const ja = subst + Math.max(novos, d.linha?.interruptores?.length ?? 0);
    const faltam = ints.filter((e) => !jaInteligente(e, sv, obj)).slice(0, Math.max(0, ints.length - ja));
    interruptores += faltam.length;
    modulos += faltam.reduce((s, e) => s + ((Number(e.props?.botoes) || 1) > 2 ? 2 : 1), 0);
    const temTomada = d.els.some((e) => e.tipo === "tomada" && jaInteligente(e, sv, obj)) || (d.linha?.tomadas_inteligentes ?? 0) > 0;
    if (HABITAVEIS.includes(d.tipo) && !temTomada) tomadas++;
  }
  return {
    itens: [{ chave: "modulo_interruptor", qtd: modulos }, { chave: "tomada", qtd: tomadas }],
    resumo: [interruptores && plural(interruptores, "interruptor", "interruptores"), tomadas && plural(tomadas, "tomada", "tomadas")],
  };
}

/**
 * Poupar energia: medidor geral no quadro (se o quadro do pedido ainda não o tem, nem o geral Wi-Fi, que também mede) e um disjuntor
 * com medição (SY2) por cada máquina grande que ainda não o tem — as dos circuitos que já existem (Manter, Trocar,
 * Reparar) e os circuitos novos de máquina sem disjuntor inteligente. As máquinas trifásicas numa casa trifásica não
 * (o SY2 é 1P+N).
 */
function pouparEnergia(estado, medidorNoQuadro) {
  const sv = servicosDe(estado);
  const tri = estado.casa?.fases === "tri";
  const serve = (m) => circuitoProprio(m) && !(tri && trifasica(m));
  let maquinas = 0;
  for (const e of estado.planta?.elementos ?? []) {
    if (e.tipo === "maquina" && acaoDe(e, sv) !== "novo" && serve({ modelo: e.props?.modelo, potencia_w: e.props?.potencia_w })) maquinas++;
  }
  for (const c of estado.quadro?.circuitos ?? []) {
    if (c.tipo === "maquina" && !c.inteligente && !c.medir && (c.itens?.maquinas ?? []).some(serve)) maquinas++;
  }
  const medidor = medidorNoQuadro ? 0 : 1;
  return {
    itens: [{ chave: "medidor_geral", qtd: medidor }, { chave: "disjuntor_protecoes", qtd: maquinas }],
    resumo: [medidor && "medidor geral", maquinas && plural(maquinas, "máquina com medição", "máquinas com medição")],
  };
}

/**
 * Segurança: sensor de porta/janela em cada porta da rua e janela (sem os que já há ou o pedido já leva), um de
 * movimento na entrada e em cada sala (sem os que já há) e um de água na cozinha, casas de banho e lavandaria.
 */
function seguranca(estado) {
  let portas = 0, movimento = 0, agua = 0;
  for (const d of divisoesDe(estado)) {
    const conta = (f) => d.els.filter(f).length;
    const precisa = conta((e) => e.tipo === "porta" && e.props?.entrada) + conta((e) => e.tipo === "janela");
    portas += Math.max(0, precisa - Math.max(conta((e) => e.tipo === "sensor_porta"), d.linha?.sensores_porta ?? 0));
    if (COM_MOVIMENTO.includes(d.tipo) && !conta((e) => e.tipo === "sensor_movimento") && !(d.linha?.sensores_movimento > 0)) movimento++;
    if (COM_AGUA.includes(d.tipo)) agua++;
  }
  return {
    itens: [{ chave: "sensor_porta", qtd: portas }, { chave: "sensor_movimento", qtd: movimento }, { chave: "sensor_agua", qtd: agua }],
    resumo: [portas && plural(portas, "porta/janela", "portas/janelas"), movimento && `${movimento} movimento`, agua && `${agua} água`],
    prefixo: "Sensores: ",
  };
}

const NOMES_QUADRO = { afdd: "AFDD", descarregador: "descarregador", rele_tensao: "relé de tensão", diferencial_wifi: "diferenciais Wi-Fi" };

/**
 * AFDD num quadro que fica (sem os circuitos que já existem na simulação): os circuitos dos quartos e salas contam-se
 * como em quadro.js circuitosExistentes — por piso, 1 de iluminação e 1 de tomadas por cada 2 dessas divisões.
 */
function afddExistentes(estado) {
  const porPiso = new Map();
  for (const d of estado.planta?.divisoes ?? []) {
    if (circuitoComAfdd({ tipo: "misto", divisoes: [d.nome] }, estado.casa?.tipo)) porPiso.set(pisoDe(d), (porPiso.get(pisoDe(d)) ?? 0) + 1);
  }
  return [...porPiso.values()].reduce((s, n) => s + 1 + Math.ceil(n / 2), 0);
}

/**
 * Quadro seguro: o que falta ao quadro escolhido para a proteção máxima (pedidosQuadro com as proteções de agora — ou
 * as de antes, se já está aceite — e com as máximas). Com o quadro no pedido as linhas já são as do quadro (grupo
 * "quadro"): a melhoria só leva a diferença de preço (e a margem). Sem o quadro no pedido (sem "Instalação nova" nem
 * "Quer melhorar o quadro?") as proteções entram no quadro que fica, que se supõe só com o mínimo (Essencial): os
 * artigos a mais são linhas da melhoria, com o AFDD dos circuitos que já existem (afddExistentes).
 */
function quadroSeguro(estado, noPedido) {
  const m = estado.melhorias;
  const aceite = m.aceites.includes(QUADRO_SEGURO) && !!m.quadroAnterior;
  const q = estado.quadro ?? {};
  const base = !noPedido ? protecoesDoPacote("essencial", false) : aceite ? m.quadroAnterior : q.protecoes;
  const comQuadro = (protecoes) => ({ ...estado, quadro: { ...q, protecoes, ...(noPedido ? {} : { quadro_novo: "atual" }) } });
  const antes = pedidosQuadro(comQuadro(base));
  const depois = pedidosQuadro(comQuadro(comMaximas(base)));
  const qtd = (l, k) => l.filter((p) => p.chave === k).reduce((s, p) => s + p.qtd, 0);
  const itens = [...new Set(depois.map((p) => p.chave))].map((k) => ({ chave: k, qtd: qtd(depois, k) - qtd(antes, k) })).filter((p) => p.qtd > 0);
  if (!noPedido) {
    const a = itens.find((p) => p.chave === "afdd");
    const n = Math.max(a?.qtd ?? 0, afddExistentes(estado));
    if (a) a.qtd = n; else if (n) itens.push({ chave: "afdd", qtd: n });
  }
  // Com o quadro no pedido, `itens` só mostra as proteções (a caixa maior e os disjuntores trocados vão no preço);
  // sem ele são as linhas da melhoria (com a ampliação do quadro, se for preciso).
  const lista = noPedido ? itens.filter((p) => NOMES_QUADRO[p.chave]) : itens;
  return {
    incluido: noPedido && !aceite && quadroNoMaximo({ ...q, protecoes: base }),
    itens: lista, antes, depois,
    resumo: lista.map((p) => (p.chave === "afdd" ? `AFDD em ${p.qtd} ${p.qtd === 1 ? "circuito" : "circuitos"}` : NOMES_QUADRO[p.chave])).filter(Boolean),
  };
}

/** Material + mão de obra (sem deslocação) de uns pedidos; null sem catálogo. */
function custo(pedidos, catalogo, config) {
  if (!Array.isArray(catalogo)) return null;
  const p = calcularPreco(pedidos, catalogo, config, { valor_iva: 0 });
  return cent(p.artigos_iva + p.mao_obra_iva);
}

/**
 * Os 4 pacotes para esta casa: [{id, nome, resumo, itens:[{chave, qtd}], linhas, custo, preco, margem, aceite,
 * incluido, vazio}]. `linhas`: o que entra nos pedidos do orçamento (grupo "melhoria"); `preco` = custo × (1 + margem
 * dos pacotes) — o que soma ao total (o custo pelas linhas e a `margem` à parte); null sem catálogo. `incluido`: o quadro
 * já está no máximo; `vazio`: nada a acrescentar nesta casa. Chamar acertarMelhorias antes.
 */
export function calcularMelhorias(estado, catalogo, config) {
  const cfg = calcularPreco([], null, config).config;
  const m = Math.min(100, cfg.margem_pacotes_pct) / 100;
  const noPedido = quadroNoPedido({ ...estado, servico: servicosDe(estado) });
  const aceites = estado.melhorias?.aceites ?? [];
  const p = estado.quadro?.protecoes ?? {};
  const pacotes = {
    "casa-inteligente": casaInteligente(estado),
    "poupar-energia": pouparEnergia(estado, noPedido && !!(p.medidor_geral || p.geral_wifi)),
    seguranca: seguranca(estado),
    "quadro-seguro": quadroSeguro(estado, noPedido),
  };
  return CHAVES_MELHORIA.map((id) => {
    const x = pacotes[id];
    const itens = x.itens.filter((i) => i.qtd > 0);
    const linhas = id === QUADRO_SEGURO && noPedido ? [] : itens.map((i) => ({ ...i, grupo: "melhoria", melhoria: id }));
    const c = id === QUADRO_SEGURO && noPedido
      ? (() => { const a = custo(x.antes, catalogo, config), d = custo(x.depois, catalogo, config); return a === null ? null : Math.max(0, cent(d - a)); })()
      : custo(linhas, catalogo, config);
    const preco = c === null ? null : cent(c * (1 + m));
    const incluido = !!x.incluido;
    const vazio = !incluido && !itens.length;
    return {
      id, nome: MELHORIAS[id].nome, resumo: `${x.prefixo ?? ""}${x.resumo.filter(Boolean).join(", ")}`, itens, linhas, custo: c, preco,
      margem: preco === null ? null : cent(preco - c), aceite: aceites.includes(id) && !incluido && !vazio, incluido, vazio,
    };
  });
}
