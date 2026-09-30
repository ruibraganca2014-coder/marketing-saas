// Simulador de orçamento — passo "Melhorias" (fase 2, docs/SIMULADOR-ORCAMENTO.md §0 "Melhorias — fase 2", §6): 4
// pacotes que o cliente junta ao orçamento, com o preço "a partir de" desta casa = (material + horas × tarifa) ×
// (1 + margem_pacotes_pct). Só lógica, sem DOM. Os artigos entram no orçamento como linhas `grupo: "melhoria"` (não
// vão para a planta); o "Quadro seguro" muda o pacote do quadro (quadro.js) e guarda as proteções de antes. A casa
// guardada leva o que o pedido dela já instala (`instalado`: proteções do quadro e máquinas com disjuntor inteligente),
// para o "Já tenho a planta" não o cobrar outra vez.

import { calcularPreco, quadroNoPedido, cent } from "./preco.js";
import { pedidosQuadro, pacoteDoQuadro, protecoesEfetivas, protecoesDoPacote, inteligenteDe as disjuntorDe, CHAVES_PROTECOES } from "./quadro.js";
import { acaoDe, inteligenteDe } from "./acoes.js";
import { circuitoProprio, trifasica } from "./regras.js";
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
 * Proteção máxima do quadro (decisão do dono): a proteção "Completa" do passo Quadro (AFDD nos quartos e sala,
 * descarregador, relé de tensão, medidor geral e geral Wi-Fi) e os diferenciais Wi-Fi com religação (RCBO).
 */
export const PROTECOES_MAXIMAS = [...CHAVES_PROTECOES];
const comMaximas = (p) => ({ ...p, ...protecoesDoPacote("completo", true) });

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

/**
 * Proteções que o quadro tem sem o "Quadro seguro": com o quadro no pedido, as escolhidas (ou as de antes, se já está
 * aceite); sem ele, as que o pedido da casa guardada já instalou (`instalado`) ou, sem isso, só o mínimo (Essencial).
 */
function protecoesBase(estado, noPedido) {
  const m = estado.melhorias;
  if (!noPedido) return estado.instalado?.protecoes ?? protecoesDoPacote("essencial", false);
  return m.aceites.includes(QUADRO_SEGURO) && m.quadroAnterior ? m.quadroAnterior : estado.quadro.protecoes;
}
const servicosDe = (estado) => (estado.servico?.length ? estado.servico : ["nova"]);
const noPedidoDe = (estado) => quadroNoPedido({ ...estado, servico: servicosDe(estado) });
/** "Já incluído": o quadro já tem a proteção máxima sem a melhoria (a mesma regra no cartão e ao aceitar). */
const quadroSeguroIncluido = (estado) => quadroNoMaximo({ ...estado.quadro, protecoes: protecoesBase(estado, noPedidoDe(estado)) });

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
    if (sim && quadroSeguroIncluido(estado)) return false;
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
 * — ou, já incluído, sai (fica "Já incluído"); o quadro trocado por fora (casa guardada, "Já tenho a planta") volta ao
 * máximo.
 */
export function acertarMelhorias(estado) {
  const m = estado.melhorias;
  if (!m.aceites.includes(QUADRO_SEGURO)) { m.quadroAnterior = null; return; }
  if (!m.quadroAnterior && quadroSeguroIncluido(estado)) { m.aceites = m.aceites.filter((k) => k !== QUADRO_SEGURO); return; }
  if (!m.quadroAnterior || !quadroNoMaximo(estado.quadro)) aplicarQuadroSeguro(estado);
}

// ------------------------------------------------------------ o que a casa guardada já tem instalado

/**
 * `instalado` da casa guardada (estado.js soCasaDe): o que o pedido dela já instala — as proteções do quadro (com o
 * quadro no pedido ou com o "Quadro seguro"; senão as de uma casa guardada antes, ou null) e as máquinas da planta
 * com disjuntor inteligente (os circuitos de máquina com SY2/SY1, pela divisão e o modelo). Casas guardadas antes
 * disto não o têm (null): supõe-se o mínimo, como antes.
 */
export function instaladoDe(e) {
  const antes = normalizarInstalado(e.instalado);
  if (e.soCasa) return antes;
  const sv = servicosDe(e);
  const seguro = !!e.melhorias?.aceites?.includes(QUADRO_SEGURO) && !!e.melhorias.quadroAnterior;
  const protecoes = noPedidoDe(e) || seguro ? protecoesEfetivas(e.quadro) : antes?.protecoes ?? null;
  // Circuitos de máquina com disjuntor inteligente, por "divisão|modelo" (regras.js sugerirCircuitos).
  const livres = new Map();
  for (const c of e.quadro?.circuitos ?? []) {
    if (c.tipo !== "maquina" || !disjuntorDe(c, e.quadro.disjuntor)) continue;
    for (const x of c.itens?.maquinas ?? []) { const k = `${c.divisoes?.[0] ?? ""}|${x.modelo}`; livres.set(k, (livres.get(k) ?? 0) + 1); }
  }
  const nomes = new Map((e.planta?.divisoes ?? []).map((d) => [d.id, d.nome || "Divisão"]));
  const maquinas = new Set(antes?.maquinas ?? []);
  for (const x of e.planta?.elementos ?? []) {
    if (x.tipo !== "maquina" || acaoDe(x, sv) !== "novo") continue;
    const k = `${nomes.get(x.divisao) ?? ""}|${x.props?.modelo}`;
    if ((livres.get(k) ?? 0) > 0) { livres.set(k, livres.get(k) - 1); maquinas.add(x.id); }
  }
  const ids = new Set((e.planta?.elementos ?? []).map((x) => x.id));
  const l = [...maquinas].filter((id) => ids.has(id));
  return protecoes || l.length ? { protecoes, maquinas: l } : null;
}

/** `instalado` gravado: {protecoes: {…}|null, maquinas: [ids]}, ou null. */
export function normalizarInstalado(v) {
  if (!v || typeof v !== "object") return null;
  const p = v.protecoes && typeof v.protecoes === "object" ? Object.fromEntries(CHAVES_PROTECOES.map((k) => [k, v.protecoes[k] === true])) : null;
  const maquinas = Array.isArray(v.maquinas) ? [...new Set(v.maquinas.filter((x) => typeof x === "string" && x.length <= 40))].slice(0, 200) : [];
  return p || maquinas.length ? { protecoes: p, maquinas } : null;
}

// ------------------------------------------------------------ o que cada pacote leva nesta casa

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
 * Poupar energia: medidor geral no quadro (se o quadro ainda não o tem, nem o geral Wi-Fi, que também mede, nem o
 * traz o "Quadro seguro" aceite) e um disjuntor com medição (SY2) por cada máquina grande que ainda não o tem — as dos
 * circuitos que já existem (Manter, Trocar, Reparar; sem as que a casa guardada já tem com disjuntor inteligente) e os
 * circuitos novos de máquina sem disjuntor inteligente. As máquinas trifásicas numa casa trifásica não (o SY2 é 1P+N).
 */
function pouparEnergia(estado, medidorNoQuadro) {
  const sv = servicosDe(estado);
  const tri = estado.casa?.fases === "tri";
  const serve = (m) => circuitoProprio(m) && !(tri && trifasica(m));
  const ja = new Set(estado.instalado?.maquinas ?? []);   // já com disjuntor inteligente (casa guardada)
  let maquinas = 0;
  for (const e of estado.planta?.elementos ?? []) {
    if (e.tipo === "maquina" && acaoDe(e, sv) !== "novo" && !ja.has(e.id) && serve({ modelo: e.props?.modelo, potencia_w: e.props?.potencia_w })) maquinas++;
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
 * Segurança: sensor de porta/janela em cada porta da rua e janela (sem os que já há ou o pedido já leva; sem nenhuma
 * porta da rua desenhada, 1 para a entrada), um de movimento na entrada e em cada sala (sem os que já há) e um de
 * água na cozinha, casas de banho e lavandaria.
 */
function seguranca(estado) {
  const divs = divisoesDe(estado);
  let portas = 0, movimento = 0, agua = 0, sobra = 0, rua = 0;
  for (const d of divs) {
    const conta = (f) => d.els.filter(f).length;
    const entrada = conta((e) => e.tipo === "porta" && e.props?.entrada);
    const precisa = entrada + conta((e) => e.tipo === "janela");
    const ha = Math.max(conta((e) => e.tipo === "sensor_porta"), d.linha?.sensores_porta ?? 0);
    rua += entrada;
    portas += Math.max(0, precisa - ha);
    sobra += Math.max(0, ha - precisa);
    if (COM_MOVIMENTO.includes(d.tipo) && !conta((e) => e.tipo === "sensor_movimento") && !(d.linha?.sensores_movimento > 0)) movimento++;
    if (COM_AGUA.includes(d.tipo)) agua++;
  }
  // A casa tem sempre porta da rua: sem nenhuma desenhada (nem um sensor de porta a mais), 1 sensor para a entrada.
  if (divs.length && !rua && !sobra) portas++;
  // "2 sensores de porta/janela, 1 de movimento, 2 de água" (só o 1.º diz "sensor").
  const partes = [[portas, "porta/janela"], [movimento, "movimento"], [agua, "água"]].filter(([n]) => n);
  return {
    itens: [{ chave: "sensor_porta", qtd: portas }, { chave: "sensor_movimento", qtd: movimento }, { chave: "sensor_agua", qtd: agua }],
    resumo: partes.map(([n, t], i) => (i ? `${n} de ${t}` : `${plural(n, "sensor", "sensores")} de ${t}`)),
  };
}

const NOMES_QUADRO = {
  afdd: "AFDD", descarregador: "descarregador", rele_tensao: "relé de tensão", diferencial_wifi: "diferenciais Wi-Fi",
  medidor_geral: "medidor geral", geral_wifi: "geral Wi-Fi",
};

/**
 * Quadro seguro: o que falta ao quadro para a proteção máxima (pedidosQuadro com as proteções de base — protecoesBase —
 * e com as máximas). Com o quadro no pedido as linhas já são as do quadro (grupo "quadro"): a melhoria só leva a
 * diferença de preço (e a margem). Sem o quadro no pedido (sem "Instalação nova" nem "Quer melhorar o quadro?") as
 * proteções entram no quadro que fica, contado como o quadro atual melhorado (com o AFDD dos circuitos que já existem:
 * quadro.js afddExistentes): os artigos a mais são linhas da melhoria.
 */
function quadroSeguro(estado, noPedido) {
  const m = estado.melhorias;
  const aceite = m.aceites.includes(QUADRO_SEGURO) && !!m.quadroAnterior;
  const q = estado.quadro ?? {};
  const base = protecoesBase(estado, noPedido);
  const comQuadro = (protecoes) => (noPedido ? { ...estado, quadro: { ...q, protecoes } }
    : { ...estado, mexerQuadro: true, quadro: { ...q, protecoes, quadro_novo: "atual" } });
  const antes = pedidosQuadro(comQuadro(base));
  const depois = pedidosQuadro(comQuadro(comMaximas(base)));
  const qtd = (l, k) => l.filter((p) => p.chave === k).reduce((s, p) => s + p.qtd, 0);
  const itens = [...new Set(depois.map((p) => p.chave))].map((k) => ({ chave: k, qtd: qtd(depois, k) - qtd(antes, k) })).filter((p) => p.qtd > 0);
  // Com o quadro no pedido, `itens` só mostra as proteções (a caixa maior e os disjuntores trocados vão no preço);
  // sem ele são as linhas da melhoria (com a ampliação do quadro, se for preciso).
  const lista = noPedido ? itens.filter((p) => NOMES_QUADRO[p.chave]) : itens;
  return {
    incluido: !aceite && quadroNoMaximo({ ...q, protecoes: base }),
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
  const noPedido = noPedidoDe(estado);
  const aceites = estado.melhorias?.aceites ?? [];
  // O medidor geral: já no quadro (o do pedido ou o que a casa guardada instalou) ou no "Quadro seguro" aceite.
  const p = (noPedido ? estado.quadro?.protecoes : estado.instalado?.protecoes) ?? {};
  const pacotes = {
    "casa-inteligente": casaInteligente(estado),
    "poupar-energia": pouparEnergia(estado, !!(p.medidor_geral || p.geral_wifi) || aceites.includes(QUADRO_SEGURO)),
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
      id, nome: MELHORIAS[id].nome, resumo: x.resumo.filter(Boolean).join(", "), itens, linhas, custo: c, preco,
      margem: preco === null ? null : cent(preco - c), aceite: aceites.includes(id) && !incluido && !vazio, incluido, vazio,
    };
  });
}
