// Serviços com preço depois das fotos (decisões do dono, 2026-10-14, do curso "Eletricidade de Instalações", referencial
// 522; docs/SIMULADOR-ORCAMENTO.md §0 "Serviços com preço depois das fotos"): videoporteiro e intercomunicador, antenas
// de TV e ITED, motores e portões automáticos e — só como pedido de orçamento — para-raios e coluna montante dos prédios.
// Em "Pedir um serviço" (funil `servico`, sem planta e sem casa descrita): o cliente diz o que precisa, descreve e manda
// fotos; o preço vem na proposta. Como a avaria, mas SEM diagnóstico pago: o pedido entra grátis e, validado, vai para a
// bolsa por proposta (como um pedido com planta). O prédio nunca vai sozinho para a bolsa: o CEO decide caso a caso.
// Partilhado pelo simulador (web/simulador/servicos-fotos.js) e pelo painel (painel/public/vendor/servicos-fotos.js, cópia
// igual; painel/test/servicos-fotos.test.js compara-as). Funções puras, sem DOM.

/** `simulacao.funil` destes pedidos. */
export const FUNIL_SERVICO = "servico";

/**
 * Os serviços: nome, ajuda curta (cartão do Início), especialidade do pedido (eletricistas.js ESPECIALIDADES) e as opções
 * (escolha múltipla), cada uma com o artigo do catálogo (provisório: catalogo-sementes.js SEMENTES_SERVICOS_FOTOS).
 * `ited`: a opção mexe na instalação de telecomunicações e precisa da ficha ITED (o termo de responsabilidade da ANACOM,
 * assinado por um instalador ITED). Fica só assinalado; quem recebe estes pedidos trata-se noutra tarefa.
 * `projeto`: precisa de projeto e de técnico responsável — só pedido de orçamento, decidido pelo CEO.
 */
export const SERVICOS_FOTOS = {
  videoporteiro: {
    nome: "Videoporteiro e intercomunicador", ajuda: "Instalar, trocar ou reparar.", especialidade: "redes",
    opcoes: {
      instalar: { nome: "Instalar ou trocar o videoporteiro (moradia)", sku: "VIDEOPORTEIRO-MORADIA" },
      telefone: { nome: "Trocar o telefone do intercomunicador (prédio)", sku: "INTERCOMUNICADOR-TELEFONE" },
      reparar: { nome: "Reparar o videoporteiro ou o intercomunicador", sku: "VIDEOPORTEIRO-REPARAR" },
    },
  },
  antenas: {
    nome: "Antenas de TV e ITED", ajuda: "Antena TDT, tomadas de TV e de rede.", especialidade: "redes",
    opcoes: {
      antena: { nome: "Antena de TV (TDT): instalar ou orientar", sku: "ANTENA-TDT" },
      tomadas: { nome: "Tomadas de TV ou de rede novas", sku: "TOMADA-TV-REDE", ited: true },
      reparar: { nome: "Reparar as tomadas e os cabos de TV, telefone ou rede", sku: "ITED-REPARAR" },
    },
  },
  portoes: {
    nome: "Motores e portões automáticos", ajuda: "Portões, bombas de água e comandos.", especialidade: "domotica",
    opcoes: {
      portao: { nome: "Motor do portão: ligar ou reparar", sku: "MOTOR-PORTAO" },
      bomba: { nome: "Bomba de água: ligar ou reparar", sku: "BOMBA-AGUA" },
      comando: { nome: "Automatismo ou circuito de comando: ligar ou reparar", sku: "CIRCUITO-COMANDO" },
    },
  },
  predio: {
    nome: "Para-raios e coluna montante", ajuda: "Prédios: pedido de orçamento.", especialidade: "geral", projeto: true,
    opcoes: {
      para_raios: { nome: "Para-raios", sku: "PARA-RAIOS" },
      coluna: { nome: "Coluna montante", sku: "COLUNA-MONTANTE" },
    },
  },
};
export const TIPOS_SERVICO_FOTOS = Object.keys(SERVICOS_FOTOS);
/** A nota que acompanha estes serviços no site (o preço vem na proposta). */
export const NOTA_PRECO_FOTOS = "Preço depois de ver as fotos";
export const PROJETO_TEXTO = "Precisa de projeto e técnico responsável";
export const DESCRICAO_SERVICO_MAX = 600;
export const PREDIO_NOME_MAX = 80;
export const PREDIO_PISOS_MAX = 60;
export const PREDIO_FOGOS_MAX = 500;
/** Fotos do pedido (até 5; a 1.ª é obrigatória): "servico:foto", "servico:foto_2"… "servico:foto_5". */
export const FOTO_SERVICO = "servico:foto";
export const FOTOS_SERVICO = [FOTO_SERVICO, "servico:foto_2", "servico:foto_3", "servico:foto_4", "servico:foto_5"];

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const inteiro = (v, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : null);

/**
 * O pedido de serviço de uma simulação, limpo: {tipo, opcoes, descricao, predio: {nome, pisos, fogos} | null}, ou null
 * (outro funil, ou mal formado). As opções desconhecidas caem; a ordem é a de SERVICOS_FOTOS.
 */
export function servicoFotosDe(sim) {
  const s = obj(sim);
  if (!s || s.funil !== FUNIL_SERVICO) return null;
  const p = obj(s.servico_fotos);
  const def = p && SERVICOS_FOTOS[p.tipo];
  if (!def || !Object.hasOwn(SERVICOS_FOTOS, p.tipo)) return null;
  const pedidas = Array.isArray(p.opcoes) ? p.opcoes : [];
  const opcoes = Object.keys(def.opcoes).filter((k) => pedidas.includes(k));
  const descricao = typeof p.descricao === "string" ? p.descricao.trim().slice(0, DESCRICAO_SERVICO_MAX) : "";
  const pr = def.projeto ? obj(p.predio) : null;
  const predio = pr ? { nome: typeof pr.nome === "string" ? pr.nome.trim().slice(0, PREDIO_NOME_MAX) : "", pisos: inteiro(pr.pisos, PREDIO_PISOS_MAX), fogos: inteiro(pr.fogos, PREDIO_FOGOS_MAX) } : null;
  return { tipo: p.tipo, opcoes, descricao, predio };
}

/** O pedido precisa de projeto e técnico responsável (para-raios, coluna montante): só orçamento, o CEO decide. */
export const precisaProjeto = (sim) => SERVICOS_FOTOS[servicoFotosDe(sim)?.tipo]?.projeto === true;

/** O pedido precisa da ficha ITED da ANACOM (uma opção com `ited`)? Só assinala: ainda não muda quem o recebe. */
export function precisaFichaIted(sim) {
  const s = servicoFotosDe(sim);
  return Boolean(s) && s.opcoes.some((k) => SERVICOS_FOTOS[s.tipo].opcoes[k]?.ited === true);
}

/** A especialidade do pedido de serviço (eletricistas.js especialidadeSugerida), ou null noutro funil. */
export const especialidadeServicoFotos = (sim) => SERVICOS_FOTOS[servicoFotosDe(sim)?.tipo]?.especialidade ?? null;

/** "Videoporteiro e intercomunicador: Instalar ou trocar o videoporteiro (moradia)"; null noutro funil. */
export function textoServicoFotos(sim) {
  const s = servicoFotosDe(sim);
  if (!s) return null;
  const def = SERVICOS_FOTOS[s.tipo];
  const ops = s.opcoes.map((k) => def.opcoes[k].nome);
  return ops.length ? `${def.nome}: ${ops.join("; ")}` : def.nome;
}

/** "6 pisos · 12 fogos" do prédio (sem o nome do condomínio), ou null. */
export function textoPredio(sim) {
  const p = servicoFotosDe(sim)?.predio;
  if (!p) return null;
  const t = [p.pisos ? `${p.pisos} ${p.pisos === 1 ? "piso" : "pisos"}` : null, p.fogos ? `${p.fogos} ${p.fogos === 1 ? "fogo" : "fogos"}` : null].filter(Boolean).join(" · ");
  return t || null;
}
