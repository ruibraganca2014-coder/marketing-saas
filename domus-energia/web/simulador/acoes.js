// Simulador de orçamento — serviço pedido (passo 1) e ação por aparelho (passo "Trocar e reparar", lote 8): Manter,
// Reparar, Substituir ou Novo (docs/SIMULADOR-ORCAMENTO.md §0, lotes 7 e 8). Só lógica, sem DOM.

import { COMANDOS, comandoDe, caixasDe, circuitoProprio, maquinaDaPlanta } from "./regras.js";

/**
 * Serviços do passo 1 (escolha múltipla, pelo menos um), pela ordem dos cartões. `omissao`: a ação dos aparelhos antes
 * da decisão do dono de 2026-10-03 (fica só como registo: agora a omissão é sempre Manter, acaoOmissao).
 */
export const SERVICOS = {
  nova: { nome: "Instalação nova / remodelação total", ajuda: "Pomos tudo novo: aparelhos, fios e quadro.", omissao: "novo" },
  automatizar: { nome: "Automatizar o que já tenho", ajuda: "Tornamos inteligente o que já existe.", omissao: "manter" },
  reparar: { nome: "Reparações / avarias", ajuda: "Algo não funciona e quer que o arranjemos.", omissao: "manter" },
};
export const CHAVES_SERVICO = Object.keys(SERVICOS);

/**
 * Ações de cada aparelho (botões curtos no passo "Trocar e reparar"; letra da marca na planta). Ronda de correções
 * (pedido #84): Manter · Reparar · Substituir · Novo; as chaves (manter, reparar, substituir, novo) e o pedido (§6)
 * não mudam.
 */
export const ACOES = {
  manter: { nome: "Manter", letra: "M", ajuda: "Fica como está" },
  reparar: { nome: "Reparar", letra: "R", ajuda: "Está avariado: arranjamos" },
  substituir: { nome: "Substituir", letra: "S", ajuda: "Trocar por outro" },
  novo: { nome: "Novo", letra: "N", ajuda: "Pôr um novo" },
};
export const CHAVES_ACAO = Object.keys(ACOES);
/** Ordem dos botões para o cliente: Manter · Reparar · Substituir · Novo. */
export const ORDEM_BOTOES = ["manter", "reparar", "substituir", "novo"];
export const MAX_AVARIA = 200;

/** Só as chaves conhecidas, sem repetidos, pela ordem de SERVICOS; `null` se não for uma lista. */
export function normalizarServico(v) {
  if (!Array.isArray(v)) return null;
  return CHAVES_SERVICO.filter((k) => v.includes(k));
}

/**
 * Ação por omissão dos aparelhos (decisão do dono, 2026-10-03): sempre Manter, seja qual for o serviço — o que a casa
 * JÁ TEM (os interruptores e as tomadas do passo "Divisões", as máquinas dos Equipamentos) fica como está e não soma
 * nada à estimativa até o cliente escolher Reparar, Substituir ou Novo em "Trocar e reparar". Novo é só o que ele pede
 * como trabalho novo ("Acrescentar um aparelho" a partir de "Trocar e reparar": app.js `acaoAoPor`). Antes: Novo com
 * "Instalação nova". `servicos` fica na assinatura (quem chama não muda).
 */
export const acaoOmissao = (servicos) => "manter";
/** Só "Reparações / avarias": fluxo curto (salta Equipamentos; não pede para verificar cada divisão). */
export const soReparacoes = (servicos) => Array.isArray(servicos) && servicos.length === 1 && servicos[0] === "reparar";
/**
 * A ação tem de ser escolhida aparelho a aparelho? Já não (decisão do dono, 2026-10-03): a omissão Manter conta como
 * resposta em todos os serviços — uma divisão com tudo em Manter está respondida sem nenhum toque. Antes: sem
 * "Instalação nova" (e fora do fluxo curto) cada aparelho pedia a escolha.
 */
export const precisaEscolher = (servicos) => false;

/**
 * O aparelho tem ação? Porta e quadro não (a porta não é elétrica; o quadro tem o seu passo); a janela só com
 * estore (o que há de elétrico nela).
 */
export const temAcao = (tipo, props = {}) =>
  ["luz", "interruptor", "tomada", "sensor_movimento", "sensor_porta", "maquina"].includes(tipo) || (tipo === "janela" && !!props?.estore);
/** "Por um inteligente? Sim/Não" ao substituir (tomada e interruptor; as máquinas não). */
export const perguntaInteligente = (tipo) => tipo === "tomada" || tipo === "interruptor";
/** Carregadores de carro elétrico (7,4 kW e 22 kW). */
export const CARREGADORES_VE = ["carregador_ve", "carregador_ve_22"];
/**
 * Ronda dinheiro: no carregador NOVO a medição no telemóvel é opcional ("Com medição no telemóvel? Sim/Não" em "Trocar
 * e reparar"; `inteligente` do elemento). Sem ela o circuito do carregador não leva disjuntor inteligente: a linha
 * dedicada (390 €) já traz tudo.
 */
export const perguntaMedicao = (tipo, props = {}) => tipo === "maquina" && CARREGADORES_VE.includes(props?.modelo);

/**
 * Ação de um elemento: a escolhida ou a omissão (Manter: acaoOmissao). Os elementos sem ação (porta, quadro, janela
 * sem estore) ficam sempre na omissão: são só desenho (QA final: a porta da rua já não leva sensor no preço base;
 * sugere-o o pacote Segurança).
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

/**
 * Tomada ou interruptor inteligente? (decisão do dono: normais por omissão; a pergunta "Por um inteligente?" só em
 * "Trocar e reparar", ao Trocar ou Novo). A resposta do cliente (`inteligente`); sem ela, a tomada de um estado antigo
 * fica como respondida na janela (`props.inteligente`) e o interruptor novo segue o objetivo "Luzes pelo telemóvel".
 * null nos outros aparelhos.
 */
export function inteligenteDe(e, objetivos = []) {
  if (!e || !perguntaInteligente(e.tipo)) return null;
  if (typeof e.inteligente === "boolean") return e.inteligente;
  if (e.tipo === "tomada") return !!e.props?.inteligente;
  return (objetivos ?? []).includes("luzes");
}

/**
 * Planta para a contagem dos Novos (linhas do pedido): as tomadas com `props.inteligente` = inteligenteDe; os
 * interruptores normais saem (as linhas do pedido só contam os inteligentes: "luzes pelo telemóvel").
 */
export function plantaInteligentes(planta, objetivos = []) {
  if (!planta) return planta;
  const elementos = [];
  for (const e of planta.elementos ?? []) {
    if (e.tipo === "tomada") elementos.push({ ...e, props: { ...e.props, inteligente: inteligenteDe(e, objetivos) } });
    else if (e.tipo !== "interruptor" || inteligenteDe(e, objetivos)) elementos.push(e);
  }
  return { ...planta, elementos };
}

/** Planta só com os aparelhos novos (preço "como hoje", circuitos novos e linhas do pedido): os outros ficam nos circuitos existentes. */
export function plantaNovos(planta, servicos) {
  if (!planta) return planta;
  return { ...planta, elementos: (planta.elementos ?? []).filter((e) => acaoDe(e, servicos) === "novo") };
}

/**
 * Pedido (chave de preco.js PEDIDOS) de um elemento para a sua ação, ou null (Manter; ou Novo sem artigo — ponto de
 * luz, tomada ou interruptor normal, máquina, que entram pelos circuitos). Reparar = diagnóstico; Substituir = o aparelho
 * (inteligente se o cliente disse "Sim"; normal enquanto não responde) com as horas de troca; a máquina é do cliente: só
 * a troca da ligação. Novo: a mesma decisão do preço (plantaInteligentes → contarPlanta): tomada/interruptor só se
 * `inteligenteDe` (resposta do cliente, estado antigo ou o objetivo "Luzes pelo telemóvel").
 */
export function pedidoDoElemento(e, acao, objetivos = []) {
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
    if (e.tipo === "interruptor") return inteligenteDe(e, objetivos) ? `interruptor_${botoes}` : null;
    if (e.tipo === "tomada") return inteligenteDe(e, objetivos) ? "tomada" : null;
    if (e.tipo === "janela") return p.estore && p.motorizado ? "estore" : null;
    if (e.tipo === "sensor_movimento") return "sensor_movimento";
    if (e.tipo === "sensor_porta") return "sensor_porta";
  }
  return null;
}

/**
 * Ronda regras: os pedidos de um ponto NOVO normal (preço fechado por ponto, catálogo PONTO-LUZ-NOVO, TOMADA-NOVA,
 * TOMADA-DUPLA-NOVA, TOMADA-TRIPLA-NOVA, INTERRUPTOR-NOVO) e a aparelhagem do tipo de comando (COMANDOS: comutador de escada, inversor,
 * botão de pressão — uma peça por interruptor); a campainha normal (máquina "campainha") = a campainha + um botão de
 * pressão. Um ponto inteligente = o ponto + o aparelho Wi-Fi (pedidoDoElemento): nunca se conta duas vezes o ponto.
 * Ronda dinheiro (decisão 5 do dono): uma máquina NOVA com circuito próprio (regras.js circuitoProprio) leva a linha
 * dedicada até 15 m, preço fechado — a do carregador VE (LINHA-DEDICADA-VE 390 €, já com o disjuntor e o diferencial
 * tipo A do circuito; igual com ou sem "Instalação nova"); a das outras: LINHA-DEDICADA (140 €) ao juntar a máquina a
 * uma casa que já existe, LINHA-DEDICADA-NOVA (70 €) numa "Instalação nova" (`servicos`: a obra já está aberta).
 * Mantida ou trocada fica no circuito que já tem: sem linha.
 * Lista vazia nos outros (máquinas pequenas, sensores, janelas: sem ponto fechado).
 */
export function pontosDoElemento(e, servicos = []) {
  if (!e) return [];
  const p = e.props ?? {};
  if (e.tipo === "luz") return ["ponto_luz"];
  if (e.tipo === "tomada") return [{ 1: "ponto_tomada", 2: "ponto_tomada_dupla", 3: "ponto_tomada_tripla" }[caixasDe(p)]];
  if (e.tipo === "interruptor") {
    const artigo = COMANDOS[comandoDe(p)].artigo;
    return artigo ? ["ponto_interruptor", artigo] : ["ponto_interruptor"];
  }
  if (e.tipo === "maquina" && p.modelo === "campainha") return ["campainha", "botao_pressao"];
  if (e.tipo === "maquina" && circuitoProprio(maquinaDaPlanta(p))) {
    return [CARREGADORES_VE.includes(p.modelo) ? "linha_dedicada_ve" : (servicos ?? []).includes("nova") ? "linha_dedicada_nova" : "linha_dedicada"];
  }
  return [];
}

/** Todos os pedidos de um elemento para a ação: no Novo, os pontos (pontosDoElemento) e o aparelho inteligente; no resto, pedidoDoElemento. */
export function pedidosDoElemento(e, acao, objetivos = [], servicos = []) {
  const r = acao === "novo" ? pontosDoElemento(e, servicos) : [];
  const chave = pedidoDoElemento(e, acao, objetivos);
  if (chave) r.push(chave);
  return r;
}

/**
 * Pedidos dos pontos novos (ronda regras): [{chave, qtd}] dos aparelhos com ação Novo na planta (pontosDoElemento);
 * as linhas dos inteligentes continuam a sair das divisões (pedidosDaSelecao).
 */
export function pedidosPontosNovos(planta, servicos) {
  const m = new Map();
  for (const e of planta?.elementos ?? []) {
    if (!temAcao(e.tipo, e.props) || acaoDe(e, servicos) !== "novo") continue;
    for (const chave of pontosDoElemento(e, servicos)) m.set(chave, (m.get(chave) ?? 0) + 1);
  }
  return [...m].map(([chave, qtd]) => ({ chave, qtd }));
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
