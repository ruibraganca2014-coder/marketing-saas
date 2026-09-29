// Simulador de orçamento — serviço pedido (passo 1) e ação por aparelho (passo Divisões): Manter, Reparar,
// Substituir ou Novo (docs/SIMULADOR-ORCAMENTO.md §0, lote 7). Só lógica, sem DOM e sem dependências.

/** Serviços do passo 1 (escolha múltipla, pelo menos um), pela ordem dos cartões. `omissao`: a ação dos aparelhos. */
export const SERVICOS = {
  nova: { nome: "Instalação nova / remodelação total", ajuda: "Pomos tudo novo: aparelhos, fios e quadro.", omissao: "novo" },
  automatizar: { nome: "Automatizar o que já tenho", ajuda: "Tornamos inteligente o que já existe.", omissao: "manter" },
  reparar: { nome: "Reparações / avarias", ajuda: "Algo não funciona e quer que o arranjemos.", omissao: "manter" },
};
export const CHAVES_SERVICO = Object.keys(SERVICOS);

/** Ações de cada aparelho (botões curtos no passo Divisões; letra da marca na planta). */
export const ACOES = {
  manter: { nome: "Manter", letra: "M", ajuda: "Fica como está" },
  reparar: { nome: "Reparar", letra: "R", ajuda: "Está avariado" },
  substituir: { nome: "Substituir", letra: "S", ajuda: "Trocar por outro" },
  novo: { nome: "Novo", letra: "N", ajuda: "Pôr um novo" },
};
export const CHAVES_ACAO = Object.keys(ACOES);
export const MAX_AVARIA = 200;

/** Só as chaves conhecidas, sem repetidos, pela ordem de SERVICOS; `null` se não for uma lista. */
export function normalizarServico(v) {
  if (!Array.isArray(v)) return null;
  return CHAVES_SERVICO.filter((k) => v.includes(k));
}

/** Ação por omissão dos aparelhos: Novo se "Instalação nova" estiver escolhida (também com outros), senão Manter. */
export const acaoOmissao = (servicos) => ((servicos ?? []).includes("nova") ? "novo" : "manter");
/** Só "Reparações / avarias": fluxo curto (salta Equipamentos; não pede para verificar cada divisão). */
export const soReparacoes = (servicos) => Array.isArray(servicos) && servicos.length === 1 && servicos[0] === "reparar";
/**
 * A ação tem de ser escolhida aparelho a aparelho? Sem "Instalação nova" (automatizar e/ou reparar) a omissão
 * (Manter) não conta como resposta; com "Instalação nova" a omissão Novo já conta. No fluxo curto (só reparações)
 * o cliente só marca o que está avariado: o resto fica Manter.
 */
export const precisaEscolher = (servicos) => !(servicos ?? []).includes("nova") && !soReparacoes(servicos);

/**
 * O aparelho tem ação? Porta e quadro não (a porta não é elétrica; o quadro tem o seu passo); a janela só com
 * estore (o que há de elétrico nela).
 */
export const temAcao = (tipo, props = {}) =>
  ["luz", "interruptor", "tomada", "sensor_movimento", "sensor_porta", "maquina"].includes(tipo) || (tipo === "janela" && !!props?.estore);
/** "Por um inteligente? Sim/Não" ao substituir (tomada e interruptor; as máquinas não). */
export const perguntaInteligente = (tipo) => tipo === "tomada" || tipo === "interruptor";

/**
 * Ação de um elemento: a escolhida ou a omissão do serviço. Os elementos sem ação (porta, quadro, janela sem estore)
 * seguem o serviço: entram como novos só com "Instalação nova" (a porta da rua sugere um sensor, como antes).
 */
export function acaoDe(e, servicos) {
  if (!e) return acaoOmissao(servicos);
  if (temAcao(e.tipo, e.props) && ACOES[e.acao]) return e.acao;
  return acaoOmissao(servicos);
}

/**
 * O que falta responder na ação de um elemento: "acao" (escolher o que fazer), "avaria" (descrever a avaria) e
 * "inteligente" (substituir uma tomada ou um interruptor: por um inteligente?). Lista vazia = respondido.
 */
export function faltaAcao(e, servicos) {
  if (!e || !temAcao(e.tipo, e.props)) return [];
  const f = [];
  if (!ACOES[e.acao] && precisaEscolher(servicos)) f.push("acao");
  const a = acaoDe(e, servicos);
  if (a === "reparar" && !String(e.avaria ?? "").trim()) f.push("avaria");
  if (a === "substituir" && perguntaInteligente(e.tipo) && typeof e.inteligente !== "boolean") f.push("inteligente");
  return f;
}

/** Planta só com os aparelhos novos (preço "como hoje", circuitos novos e linhas do pedido): os outros ficam nos circuitos existentes. */
export function plantaNovos(planta, servicos) {
  if (!planta) return planta;
  return { ...planta, elementos: (planta.elementos ?? []).filter((e) => acaoDe(e, servicos) === "novo") };
}

/**
 * Pedido (chave de preco.js PEDIDOS) de um elemento para a sua ação, ou null (Manter; ou Novo sem artigo — ponto de
 * luz, tomada normal, máquina, que entram pelos circuitos). Reparar = diagnóstico; Substituir = o aparelho (inteligente
 * se o cliente disse "Sim"; normal enquanto não responde) com as horas de troca; a máquina é do cliente: só a troca da
 * ligação.
 */
export function pedidoDoElemento(e, acao) {
  const p = e?.props ?? {};
  const botoes = Math.min(4, Math.max(1, Math.round(Number(p.botoes) || 1)));
  if (acao === "reparar") return "diagnostico";
  if (acao === "substituir") {
    if (e.tipo === "interruptor") return e.inteligente === true ? `interruptor_${botoes}` : "aparelho_normal";
    if (e.tipo === "tomada") return e.inteligente === true ? "tomada" : "aparelho_normal";
    if (e.tipo === "luz") return "aparelho_normal";
    if (e.tipo === "janela") return "estore";
    if (e.tipo === "sensor_movimento") return "sensor_movimento";
    if (e.tipo === "sensor_porta") return "sensor_porta";
    if (e.tipo === "maquina") return "troca_maquina";
    return null;
  }
  if (acao === "novo") {
    if (e.tipo === "interruptor") return `interruptor_${botoes}`;
    if (e.tipo === "tomada") return p.inteligente ? "tomada" : null;
    if (e.tipo === "janela") return p.estore && p.motorizado ? "estore" : null;
    if (e.tipo === "sensor_movimento") return "sensor_movimento";
    if (e.tipo === "sensor_porta") return "sensor_porta";
  }
  return null;
}

/**
 * Pedidos das ações Reparar e Substituir (os Novos continuam a sair das linhas das divisões, como antes; Manter = 0 €):
 * [{chave, qtd, acao}] — um por chave e ação.
 */
export function pedidosAcoes(planta, servicos) {
  const m = new Map();
  for (const e of planta?.elementos ?? []) {
    if (!temAcao(e.tipo, e.props)) continue;
    const a = acaoDe(e, servicos);
    if (a !== "reparar" && a !== "substituir") continue;
    const chave = pedidoDoElemento(e, a);
    if (!chave) continue;
    const k = `${a}:${chave}`;
    if (!m.has(k)) m.set(k, { chave, qtd: 0, acao: a });
    m.get(k).qtd++;
  }
  return [...m.values()];
}

/** Quantos aparelhos (com ação) há em cada ação. */
export function contarAcoes(planta, servicos) {
  const r = Object.fromEntries(CHAVES_ACAO.map((k) => [k, 0]));
  for (const e of planta?.elementos ?? []) if (temAcao(e.tipo, e.props)) r[acaoDe(e, servicos)]++;
  return r;
}
