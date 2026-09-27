// Ligação à API do painel (docs/PAINEL-EMPRESA.md §3): /painel/api/, JSON, erros {"erro": "..."}.
// Mesmo site (CSP connect-src 'self'), cookie de sessão HttpOnly enviado com credentials 'same-origin'.
// Pedidos que alteram dados: POST com Content-Type application/json (o navegador junta a Origin).

export const BASE = "/painel/api/";

export class ErroApi extends Error {
  constructor(estado, mensagem, extra = {}) {
    super(mensagem);
    this.estado = estado; // 0 = sem ligação
    Object.assign(this, extra);
  }
}

const ouvintes401 = new Set();
/** Chamado quando a sessão acaba (401 fora do login). */
export function aoTerminarSessao(fn) { ouvintes401.add(fn); return () => ouvintes401.delete(fn); }

const MENSAGENS = {
  0: "Sem ligação ao servidor. Verifique a internet e tente de novo.",
  400: "Há dados em falta ou inválidos.",
  401: "A sessão terminou. Entre de novo.",
  403: "Não tem acesso a esta área.",
  404: "Não encontrado.",
  409: "Já existe um registo com estes dados.",
  429: "Demasiados pedidos seguidos. Espere um pouco e tente de novo.",
};

/**
 * Faz um pedido à API. `corpo` (objeto) → POST JSON.
 * Devolve o JSON (ou null sem corpo); lança ErroApi com a mensagem do servidor ou uma das MENSAGENS.
 */
export async function pedir(caminho, { corpo, metodo, sinal, login = false } = {}) {
  const opcoes = { method: metodo ?? (corpo !== undefined ? "POST" : "GET"), credentials: "same-origin", headers: { Accept: "application/json" }, signal: sinal };
  if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  let r;
  try {
    r = await fetch(BASE + caminho, opcoes);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ErroApi(0, MENSAGENS[0]);
  }
  let dados = null;
  const texto = await r.text().catch(() => "");
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = null; } }
  if (r.ok) return dados;
  const extra = { dados };
  const ra = Number(r.headers.get("Retry-After"));
  if (ra > 0) extra.esperarSegundos = ra;
  const msg = (dados && typeof dados.erro === "string" && dados.erro.trim()) || MENSAGENS[r.status] || `Erro do servidor (${r.status}). Tente de novo.`;
  const erro = new ErroApi(r.status, msg, extra);
  if (r.status === 401 && !login) ouvintes401.forEach((fn) => fn(erro));
  throw erro;
}

// ---------- Leitura tolerante das respostas ----------
// O contrato (§3) diz o que cada resposta tem, mas não o nome exato de cada campo:
// aceitamos snake_case e camelCase ("valor_proposta" / "valorProposta").
const camel = (s) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);

/** Primeiro campo definido de entre os nomes dados (e as variantes snake/camel). */
export function campo(obj, ...nomes) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const n of nomes) {
    for (const k of [n, camel(n), snake(n)]) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Lista a partir de uma resposta: a própria lista, ou {<nome>: [...]}, {itens}, {dados}. */
export function lista(resp, ...nomes) {
  if (Array.isArray(resp)) return resp;
  const v = campo(resp, ...nomes, "itens", "dados", "lista");
  return Array.isArray(v) ? v : [];
}

/** Número a partir de número, texto ("9,99") ou lista (conta). */
export function numero(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Palavra-passe gerada num resultado (pedido-admin, utilizador novo, repor). */
export function palavraPasse(obj) {
  if (!obj || typeof obj !== "object") return null;
  const v = campo(obj, "password", "palavra_passe", "senha");
  if (typeof v === "string" && v) return v;
  const r = campo(obj, "resultado");
  return r && r !== obj ? palavraPasse(r) : null;
}

// ---------- Resultado de um pedido-admin (§2) ----------
// SUPOSIÇÃO (isolada aqui): o servidor expõe o resultado em GET /painel/api/pedidos/:id →
//   {pedido: {id, tipo, estado: "pendente"|"concluido"|"erro", erro?}, resultado: {ok, erro?, password?, cliente?, aparelho?} | null}
// (forma de painel/src/pedidos.js → Pedidos.resultado) e apaga o resultado (com a palavra-passe) quando o devolve:
// só aparece uma vez. 404 = pedido desconhecido. Também aceita {estado, resultado} sem o invólucro "pedido".
// Se o caminho ou os campos forem outros, só esta função muda.
export async function lerPedido(id, { sinal } = {}) {
  const r = await pedir(`pedidos/${encodeURIComponent(id)}`, { sinal });
  const p = campo(r, "pedido") ?? r ?? {};
  const res = campo(r, "resultado") ?? null;
  const estadoBruto = String(campo(p, "estado") ?? "").toLowerCase();
  const erro = campo(p, "erro") ?? (res && (res.ok === false || campo(res, "erro")) ? campo(res, "erro") ?? "Falhou." : null);
  const senha = res ? palavraPasse(res) : palavraPasse(p);
  let estado = "pendente";
  if (erro || estadoBruto === "erro" || res?.ok === false) estado = "erro";
  else if (senha || res || ["concluido", "concluído", "feito", "ok"].includes(estadoBruto)) estado = "feito";
  return { estado, senha, erro: erro ? String(erro) : null, resultado: res, bruto: r };
}

/**
 * Id do pedido-admin numa resposta: {pedido: "id"} | {pedido: {id}} | {pedido_id}; com `solto`, também
 * {id} quando tem a forma dos ids de pedido (p-AAAAMMDDhhmmss-xxxxxxxx).
 */
export function idPedido(resp, { solto = true } = {}) {
  const p = campo(resp, "pedido", "pedido_id", "pedidoId");
  if (p && typeof p === "object") return campo(p, "id") ?? null;
  if (p) return String(p);
  const id = campo(resp, "id");
  return solto && typeof id === "string" && /^[pu]-\d{14}-[0-9a-f]{8}$/.test(id) ? id : null;
}
