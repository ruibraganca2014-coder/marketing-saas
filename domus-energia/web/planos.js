// Planos e subscrições (docs/PROTOCOLO-PLANOS.md §1–§3) — módulo puro (sem DOM), para poder ser
// testado à parte. A tabela de funcionalidades é a mesma do motor (motor/src/planos.js) e da app.
// Aqui é só apresentação: quem manda é o motor (recusa com "Disponível a partir do plano Conforto.")
// e o servidor (ACL só de leitura para os suspensos).

export const PLANOS = ["base", "conforto", "premium"];
export const ESTADOS = ["ativo", "teste", "em_atraso", "suspenso", "cancelado"];

// Preços com IVA; o que inclui cada plano em palavras simples (igual no site, na área de cliente e na app).
export const INFO_PLANOS = {
  base: {
    nome: "Base",
    preco: "4,99 €",
    inclui: ["App e área de cliente", "Controlo à distância", "Automações e cenas", "Histórico e relatório da casa"],
  },
  conforto: {
    nome: "Conforto",
    preco: "9,99 €",
    inclui: ["Tudo o do plano Base", "Modos Fora, Noite e Férias, com alarme", "Notificações no telemóvel", "Saúde dos aparelhos", "Energia: hoje, ontem e mês", "Relatório diário"],
  },
  premium: {
    nome: "Premium",
    preco: "19,99 €",
    inclui: ["Tudo o do plano Conforto", "Central em casa (Raspberry Pi): funciona sem internet (brevemente)", "Suporte prioritário"],
  },
};

// Funcionalidade (`chave`) → planos que a incluem (§1).
export const FUNCIONALIDADES = {
  controlo: ["base", "conforto", "premium"],
  automacoes: ["base", "conforto", "premium"],
  cenas: ["base", "conforto", "premium"],
  historico: ["base", "conforto", "premium"],
  relatorio: ["base", "conforto", "premium"],
  alarme: ["conforto", "premium"], // modos fora/noite/ferias; `casa` é sempre permitido
  notificacoes: ["conforto", "premium"],
  saude: ["conforto", "premium"],
  energia: ["conforto", "premium"],
  relatorio_diario: ["conforto", "premium"],
  local: ["premium"],
  suporte_prioritario: ["premium"],
};

// Sem `_plano` retido (§2): clientes antigos não perdem nada.
export const PLANO_OMISSAO = Object.freeze({ plano: "conforto", estado: "ativo", desde: null, proximoPagamento: null, avisoAte: null, gerido: "manual", omissao: true });

function json(texto) {
  try { return JSON.parse(texto); } catch { return undefined; }
}
const ms = (x) => {
  if (typeof x !== "string") return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
};

/**
 * Lê `domus/<c>/_plano`.
 * - mensagem vazia (retido apagado) ou null → plano por omissão;
 * - `plano` ou `estado` desconhecidos / JSON inválido → null (quem chama mantém o que tinha, como o motor);
 * - datas inválidas → null; `gerido` diferente de "stripe" → "manual".
 */
export function lerPlano(texto) {
  if (texto == null || (typeof texto === "string" && texto.trim() === "")) return { ...PLANO_OMISSAO };
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (!PLANOS.includes(v.plano) || !ESTADOS.includes(v.estado)) return null;
  return {
    plano: v.plano,
    estado: v.estado,
    desde: ms(v.desde),
    proximoPagamento: ms(v.proximo_pagamento),
    avisoAte: ms(v.aviso_ate),
    gerido: v.gerido === "stripe" ? "stripe" : "manual",
    omissao: false,
  };
}

// `suspenso` / `cancelado` = modo básico (§3): a área de cliente mostra só o ecrã de suspensão.
export const modoBasico = (p) => p?.estado === "suspenso" || p?.estado === "cancelado";

// A funcionalidade está disponível com este plano e estado?
export function permite(p, chave) {
  const x = p ?? PLANO_OMISSAO;
  if (!ESTADOS.includes(x.estado) || modoBasico(x)) return false;
  return !!FUNCIONALIDADES[chave]?.includes(x.plano);
}

// Plano mais barato que inclui a funcionalidade.
export const planoMinimo = (chave) => PLANOS.find((p) => FUNCIONALIDADES[chave]?.includes(p)) ?? null;

// Decisões de desenho da área de cliente (o que fica com cadeado).
export function decisoes(p) {
  const r = { basico: modoBasico(p) };
  for (const k of Object.keys(FUNCIONALIDADES)) r[k] = permite(p, k);
  return r;
}

// "Disponível no plano Conforto" (o " — mudar de plano" é um botão à parte).
export const textoDisponivel = (chave) => `Disponível no plano ${INFO_PLANOS[planoMinimo(chave) ?? "conforto"].nome}`;
export const textoBloqueado = (chave) => `${textoDisponivel(chave)} — mudar de plano`;

// Erro do motor para uma funcionalidade fora do plano (§3): "Disponível a partir do plano Conforto."
export const ERRO_PLANO_RE = /^Dispon[ií]vel a partir do plano/i;
export const eErroDePlano = (texto) => ERRO_PLANO_RE.test(String(texto ?? ""));

// ---------- Textos ----------
// "1 de novembro de 2026" (hora de Lisboa).
export function dataLonga(t) {
  if (t == null) return null;
  return new Date(t).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" });
}

export const ROTULO_ESTADO = { ativo: "Ativa", teste: "Mês grátis", em_atraso: "Pagamento em atraso", suspenso: "Suspensa", cancelado: "Cancelada" };
// Tom do selo: ok (musgo), aviso (areia), mau (alarme).
export const TOM_ESTADO = { ativo: "ok", teste: "ok", em_atraso: "aviso", suspenso: "mau", cancelado: "mau" };

export const TEXTO_BASICO = "Os interruptores da casa continuam a funcionar normalmente. A app, as automações, as cenas e o alarme estão em pausa até a subscrição ser reativada.";

export function avisoAtraso(p) {
  const ate = p?.avisoAte != null ? ` até ${dataLonga(p.avisoAte)}` : "";
  return `O último pagamento falhou. Atualize o pagamento${ate} para não perder o acesso à app, às automações e ao alarme.`;
}

// Frase que explica o estado, em palavras simples.
export function explicacaoEstado(p) {
  const manual = p?.gerido !== "stripe";
  switch (p?.estado) {
    case "ativo":
      return manual ? "A sua subscrição está em dia. É gerida diretamente pela Domus Energia."
        : "A sua subscrição está em dia. O pagamento é feito automaticamente todos os meses.";
    case "teste":
      return `Está no primeiro mês grátis.${p.proximoPagamento != null ? ` O primeiro pagamento é a ${dataLonga(p.proximoPagamento)}.` : ""}`;
    case "em_atraso": return avisoAtraso(p);
    case "suspenso": return `A subscrição está suspensa por falta de pagamento. ${TEXTO_BASICO}`;
    case "cancelado": return `A subscrição foi cancelada. ${TEXTO_BASICO}`;
  }
  return "";
}

export const tituloBasico = (p) => (p?.estado === "cancelado" ? "A sua subscrição foi cancelada" : "A sua subscrição está suspensa");

// Próximo pagamento (só com a subscrição a correr).
export const proximoPagamento = (p) => (modoBasico(p) || p?.proximoPagamento == null ? null : dataLonga(p.proximoPagamento));

// ---------- Regresso do Stripe (?subscricao=ok|cancelada) ----------
export function regressoStripe(search) {
  const v = new URLSearchParams(search ?? "").get("subscricao");
  if (v === "ok") return { tipo: "ok", texto: "Obrigado! O pagamento foi aceite. A sua subscrição atualiza-se aqui dentro de um minuto." };
  if (v === "cancelada") return { tipo: "info", texto: "O pagamento foi cancelado. A sua subscrição não mudou." };
  return null;
}

// ---------- Serviço de pagamentos (/api, §4) ----------
// Só se abrem páginas https vindas do servidor (nunca javascript:, data:, …).
export function urlSegura(u) {
  if (typeof u !== "string" || /\s/.test(u)) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.href : null;
  } catch { return null; }
}

export class ErroApi extends Error {
  constructor(tipo, mensagem, extra = {}) { super(mensagem); this.tipo = tipo; Object.assign(this, extra); }
}

export const MSG_API = {
  rede: "Sem ligação ao serviço de pagamentos. Verifique a internet e tente de novo.",
  credenciais: "Não foi possível confirmar a sua conta. Saia e entre de novo.",
  sessao: "A sessão expirou. Tente de novo.",
  servidor: "O serviço de pagamentos não está disponível agora. Tente mais tarde ou fale connosco.",
  resposta: "Resposta inesperada do serviço de pagamentos. Tente mais tarde.",
  pedido: "Não foi possível tratar o pedido. Tente mais tarde ou fale connosco.",
};
// 429: "Muitos pedidos seguidos. Aguarde 1 minuto e tente de novo."
export function textoEspera(retryAfter) {
  const s = Number.parseInt(retryAfter, 10);
  if (!Number.isFinite(s) || s <= 0) return "Muitos pedidos seguidos. Aguarde um minuto e tente de novo.";
  if (s < 60) return `Muitos pedidos seguidos. Aguarde ${s} segundos e tente de novo.`;
  const m = Math.ceil(s / 60);
  return `Muitos pedidos seguidos. Aguarde ${m} ${m === 1 ? "minuto" : "minutos"} e tente de novo.`;
}

/**
 * Cliente do /api: sessão curta (token só em memória), 401 → pede outro token e repete uma vez,
 * 429 → mensagem de espera, falhas de rede → mensagem simples.
 * @param {{ fetch: Function, base?: string, credenciais: () => ({codigo, password}|null), agora?: () => number }} o
 */
export function criarApi({ fetch: f, base = "/api", credenciais, agora = Date.now }) {
  let token = null; // { valor, ate }
  const raiz = base.replace(/\/+$/, "");
  const VALIDADE_MS = 14 * 60_000; // o token dura 15 min; renova-se um pouco antes

  async function post(caminho, corpo, comToken) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (comToken) headers.Authorization = `Bearer ${comToken}`;
    let r;
    try {
      r = await f(`${raiz}/${caminho}`, { method: "POST", headers, body: JSON.stringify(corpo), credentials: "same-origin", cache: "no-store" });
    } catch (e) {
      throw new ErroApi("rede", MSG_API.rede, { causa: e });
    }
    let dados = null;
    try { dados = await r.json(); } catch {}
    if (r.ok) {
      if (!dados || typeof dados !== "object") throw new ErroApi("resposta", MSG_API.resposta);
      return dados;
    }
    if (r.status === 401) throw new ErroApi(comToken ? "sessao" : "credenciais", comToken ? MSG_API.sessao : MSG_API.credenciais, { status: 401 });
    if (r.status === 429) throw new ErroApi("espera", textoEspera(r.headers?.get?.("Retry-After")), { status: 429 });
    if (r.status >= 500) throw new ErroApi("servidor", MSG_API.servidor, { status: r.status });
    const doServidor = typeof dados?.erro === "string" && dados.erro.trim() && dados.erro.length <= 200 ? dados.erro.trim() : null;
    throw new ErroApi("pedido", doServidor ?? MSG_API.pedido, { status: r.status });
  }

  async function sessao() {
    const c = credenciais();
    if (!c?.codigo || typeof c.password !== "string") throw new ErroApi("credenciais", MSG_API.credenciais);
    const d = await post("sessao", { codigo: c.codigo, password: c.password }, null);
    if (typeof d.token !== "string" || !d.token) throw new ErroApi("resposta", MSG_API.resposta);
    token = { valor: d.token, ate: agora() + VALIDADE_MS };
    return token.valor;
  }

  async function comSessao(caminho, corpo) {
    if (!token || agora() >= token.ate) await sessao();
    try {
      return await post(caminho, corpo, token.valor);
    } catch (e) {
      if (e.tipo !== "sessao") throw e;
      token = null; // expirou: pede outro e repete uma vez
      await sessao();
      return post(caminho, corpo, token.valor);
    }
  }

  async function pedirUrl(caminho, corpo) {
    const d = await comSessao(caminho, corpo);
    const u = urlSegura(d.url);
    if (!u) throw new ErroApi("resposta", MSG_API.resposta);
    return u;
  }

  return {
    checkout: (plano) => {
      if (!PLANOS.includes(plano)) return Promise.reject(new ErroApi("pedido", MSG_API.pedido));
      return pedirUrl("checkout", { plano });
    },
    portal: () => pedirUrl("portal", {}),
    esquecer: () => { token = null; },
    temToken: () => !!token,
  };
}
