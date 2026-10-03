// Origem do contacto (CRM do painel, docs/CRM-TAREFAS.md): vai com o pedido de orçamento só a CATEGORIA de onde a
// pessoa veio e a página de anúncio de entrada (`?servico=` do simulador). A categoria é, por esta ordem: a resposta
// da pessoa a "Como nos conheceu?" (se a der); senão a do `utm_source` do endereço de entrada; senão a do
// document.referrer (google, facebook, instagram, direto, outro). Nunca o endereço de onde veio nem o valor do
// utm_source, sem cookies e sem scripts de terceiros; no navegador fica só a categoria da chegada, no sessionStorage
// deste separador (para valer nas páginas seguintes do site), até o separador fechar (web/privacidade.html, web/cookies.html).

const ENTRADAS = ["carregador", "quadro-antigo"];
/** sessionStorage: só a categoria da chegada (google, facebook, instagram ou outro). */
export const CHAVE_ORIGEM = "domus.origem";
const CANAIS = ["google", "facebook", "instagram", "outro"];
/** Respostas a "Como nos conheceu?" (valor que vai no pedido → texto), pela ordem do formulário. */
export const CONHECEU = {
  google: "Google", facebook_instagram: "Facebook / Instagram", recomendacao: "Recomendação de um amigo",
  eletricista_parceiro: "Eletricista parceiro", carrinha_rua: "Vi a carrinha / passei na rua", outro: "Outro",
};

/** Categoria do canal a partir do endereço de onde se veio; o próprio site (ou nenhum) conta como "direto". */
export function canalDe(referrer, anfitriao) {
  let host = "";
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ""; } catch { host = ""; }
  if (!host || host === String(anfitriao ?? "").toLowerCase()) return "direto";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host)) return "facebook";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  return "outro";
}

/** Categoria a partir do `utm_source` do endereço de entrada (o valor em si nunca sai do navegador); null sem utm_source. */
export function canalUtm(search) {
  const v = (new URLSearchParams(search).get("utm_source") ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^(google|googleads|google[-_]ads|adwords)$/.test(v)) return "google";
  if (/^(facebook|fb|meta)$/.test(v)) return "facebook";
  if (/^(instagram|ig)$/.test(v)) return "instagram";
  return "outro";
}

const armazem = () => { try { return window.sessionStorage; } catch { return null; } };

/**
 * A categoria por que a pessoa chegou: a do utm_source, senão a do referrer. Vinda de fora, fica guardada (só a
 * categoria) no sessionStorage do separador; nas páginas seguintes do site (referrer = o próprio site) vale a guardada.
 */
export function canalChegada(loc = location, referrer = document.referrer, sessao = armazem()) {
  const deFora = canalUtm(loc.search) ?? canalDe(referrer, loc.hostname);
  let guardado = null;
  try { guardado = sessao?.getItem(CHAVE_ORIGEM) ?? null; } catch { guardado = null; }
  if (!CANAIS.includes(guardado)) guardado = null;
  if (deFora === "direto") return guardado ?? "direto";
  if (deFora !== guardado) { try { sessao?.setItem(CHAVE_ORIGEM, deFora); } catch { /* sem armazenamento: vale só nesta página */ } }
  return deFora;
}

/** Os dois campos que o pedido leva: {origem_contacto, origem_entrada?}. `resposta`: a escolha em "Como nos conheceu?" (ou vazio). */
export function origemContacto(resposta = "", loc = location, referrer = document.referrer, sessao = armazem()) {
  const entrada = new URLSearchParams(loc.search).get("servico");
  return {
    origem_contacto: Object.hasOwn(CONHECEU, resposta) ? resposta : canalChegada(loc, referrer, sessao),
    ...(ENTRADAS.includes(entrada) ? { origem_entrada: entrada } : {}),
  };
}

// Ao abrir qualquer página do site: regista a categoria da chegada (a página do formulário pode ser outra).
if (typeof document !== "undefined") canalChegada();
