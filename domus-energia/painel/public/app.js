// Painel da empresa (docs/PAINEL-EMPRESA.md §4): entrar, navegação por papel e ecrãs.
// Rotas no endereço: #/inicio, #/clientes, #/clientes/<codigo>, #/alertas, #/orcamentos, #/orcamentos/<id>,
// #/obras, #/obras/<id>, #/catalogo, #/stock, #/pagamentos, #/equipa, #/contas, #/eletricistas, #/auditoria, #/ajuda (Ajuda técnica: diagnóstico de avarias).
import { pedir, aoTerminarSessao, campo, lista, lerPedido, ErroApi } from "./api.js";
import { h, PAPEIS, semAcesso, avisar, mostrarPalavraPasse, janela, campoForm, mensagem } from "./ui.js";
import inicio from "./ecras/inicio.js";
import clientes from "./ecras/clientes.js";
import alertas from "./ecras/alertas.js";
import orcamentos from "./ecras/orcamentos.js";
import obras from "./ecras/obras.js";
import pagamentos from "./ecras/pagamentos.js";
import equipa from "./ecras/equipa.js";
import auditoria from "./ecras/auditoria.js";
import catalogo from "./ecras/catalogo.js";
import stock from "./ecras/stock.js";
import contas from "./ecras/contas.js";
import eletricistas from "./ecras/eletricistas.js";
import ajuda from "./ecras/ajuda.js";

// Quem vê o quê (§1). O servidor verifica sempre; aqui só se esconde o que não se pode usar.
const ECRAS = [
  { id: "inicio", nome: "Início", papeis: ["ceo", "tecnico", "comercial"], m: inicio },
  { id: "clientes", nome: "Clientes", papeis: ["ceo", "tecnico", "comercial"], m: clientes },
  { id: "alertas", nome: "Alertas", papeis: ["ceo", "tecnico"], m: alertas },
  { id: "orcamentos", nome: "Orçamentos", papeis: ["ceo", "comercial"], m: orcamentos },
  { id: "obras", nome: "Obras", papeis: ["ceo", "tecnico", "comercial"], m: obras },
  { id: "catalogo", nome: "Catálogo", papeis: ["ceo"], m: catalogo },
  { id: "stock", nome: "Stock", papeis: ["ceo"], m: stock },
  { id: "pagamentos", nome: "Pagamentos", papeis: ["ceo"], m: pagamentos },
  { id: "equipa", nome: "Equipa", papeis: ["ceo"], m: equipa },
  { id: "contas", nome: "Contas de clientes", papeis: ["ceo"], m: contas },
  { id: "eletricistas", nome: "Eletricistas", papeis: ["ceo"], m: eletricistas },
  { id: "auditoria", nome: "Auditoria", papeis: ["ceo"], m: auditoria },
  { id: "ajuda", nome: "Ajuda técnica", papeis: ["ceo", "tecnico", "comercial"], m: ajuda },
];

const $ = (id) => document.getElementById(id);
const vistaLogin = $("vista-login"), vistaPainel = $("vista-painel"), conteudo = $("conteudo");
let eu = null;
let desmontar = null;
let ecraAtual = null;

// ---------- Sessão ----------
async function arrancar() {
  try {
    const r = await pedir("eu", { login: true });
    eu = normalizarEu(r);
    mostrarPainel();
  } catch (e) {
    mostrarLogin(e.estado === 401 || e.estado === 403 ? "" : e.message);
  }
}
function normalizarEu(r) {
  const u = campo(r, "utilizador", "eu") ?? r ?? {};
  return { id: campo(u, "id"), nome: campo(u, "nome") ?? campo(u, "email") ?? "", email: campo(u, "email") ?? "", papel: campo(u, "papel") ?? "", pagamentos: campo(r, "pagamentos") ?? null };
}

/**
 * Faixa por baixo do topo (docs/PAGAMENTOS-PEDIDO.md): "Modo de demonstração — pagamentos simulados" (PAGAMENTOS_MODO=
 * simulado) ou "Pagamentos desligados" (sem PAGAMENTOS_MODO nem STRIPE_SECRET_KEY: os pedidos chegam sem pagar).
 */
function faixaPagamentos() {
  $("faixa-pagamentos")?.remove();
  const p = eu?.pagamentos;
  const texto = p?.demonstracao ? "Modo de demonstração — pagamentos simulados: não é cobrado nada e qualquer pessoa pode \"pagar\". Para pagamentos reais: PAGAMENTOS_MODO=stripe e as chaves do Stripe no .env."
    : p?.desligados_sem_configuracao ? "Pagamentos desligados: os pedidos chegam na mesma (grátis), mas o cliente não compra o relatório nem a visita e a avaria chega sem pagar. Para os ligar: STRIPE_SECRET_KEY (e PAGAMENTOS_MODO=stripe) no .env."
      : null;
  if (texto) document.querySelector(".topo-painel").after(h("div", { class: `faixa-pagamentos${p?.demonstracao ? " demonstracao" : ""}`, id: "faixa-pagamentos", role: "note", text: texto }));
}

function mostrarLogin(texto = "", tipo = "erro") {
  eu = null;
  // Os pedidos em espera eram da conta que saiu: não os mostrar (nem consultar) à próxima.
  for (const p of [...pendentes.values()]) p.terminar();
  desmontar?.(); desmontar = null; ecraAtual = null;
  document.querySelectorAll("dialog.janela").forEach((d) => d.close());
  conteudo.replaceChildren();
  vistaPainel.hidden = true;
  vistaLogin.hidden = false;
  document.title = "Entrar — Painel Domus Energia";
  const msg = $("login-msg");
  if (texto) { msg.className = `msg ${tipo}`; msg.textContent = texto; msg.hidden = false; } else msg.hidden = true;
  $("form-login").elements.email.focus();
}

let bloqueioAte = 0, relogio = null;
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget, msg = $("login-msg"), botao = f.querySelector("button");
  const email = f.elements.email.value.trim(), password = f.elements.password.value;
  if (Date.now() < bloqueioAte) return;
  if (!email || !password) {
    msg.className = "msg erro"; msg.textContent = "Escreva o email e a palavra-passe."; msg.hidden = false;
    (email ? f.elements.password : f.elements.email).focus();
    return;
  }
  botao.disabled = true; botao.textContent = "A entrar…"; msg.hidden = true;
  try {
    const r = await pedir("entrar", { corpo: { email, password }, login: true });
    f.elements.password.value = "";
    eu = normalizarEu(r);
    if (!eu.papel) eu = normalizarEu(await pedir("eu"));
    botao.disabled = false; botao.textContent = "Entrar";
    mostrarPainel();
  } catch (erro) {
    botao.disabled = false; botao.textContent = "Entrar";
    msg.className = "msg erro"; msg.hidden = false;
    if (erro.estado === 429) {
      const s = erro.esperarSegundos ?? 60;
      bloqueioAte = Date.now() + s * 1000;
      botao.disabled = true;
      const atualizar = () => {
        const falta = Math.ceil((bloqueioAte - Date.now()) / 1000);
        if (falta <= 0) { clearInterval(relogio); botao.disabled = false; msg.textContent = "Já pode tentar de novo."; msg.className = "msg info"; return; }
        const quanto = falta >= 90 ? `${Math.ceil(falta / 60)} minutos` : `${falta} segundos`;
        msg.textContent = `${erro.message} Pode tentar de novo daqui a ${quanto}.`;
      };
      clearInterval(relogio); atualizar(); relogio = setInterval(atualizar, 1000);
    } else if (erro.estado === 401) {
      msg.textContent = erro.message || "Email ou palavra-passe errados.";
      f.elements.password.select();
    } else msg.textContent = erro.message;
  }
});

aoTerminarSessao(() => { if (eu) mostrarLogin("A sessão terminou. Entre de novo.", "info"); });

$("sair").addEventListener("click", async () => {
  try { await pedir("sair", { corpo: {} }); } catch {}
  history.replaceState(null, "", "#/inicio");
  mostrarLogin("Saiu do painel.", "ok");
});

// ---------- Estrutura ----------
const permitido = (ecra) => ecra.papeis.includes(eu?.papel);

function mostrarPainel() {
  vistaLogin.hidden = true;
  vistaPainel.hidden = false;
  $("quem").replaceChildren(h("span", { class: "quem-nome", text: eu.nome }), h("span", { class: "selo-p papel", text: PAPEIS[eu.papel] ?? eu.papel }));
  const lista = $("nav-lista");
  lista.replaceChildren(...ECRAS.filter(permitido).map((e) =>
    h("li", {}, h("a", { href: `#/${e.id}`, dataset: { ecra: e.id }, text: e.nome }))));
  const mudar = h("a", { href: "#", role: "button", "aria-haspopup": "dialog", text: "Mudar palavra-passe" });
  mudar.addEventListener("click", (e) => { e.preventDefault(); abrirMenu(false); mudarPalavraPasse(); });
  lista.append(h("li", { class: "nav-conta" }, mudar));
  faixaPagamentos();
  encaminhar();
  retomarPedidos();
}

// A própria pessoa muda a palavra-passe (a conta é criada com uma gerada pelo servidor).
function mudarPalavraPasse() {
  const j = janela("Mudar palavra-passe");
  const msg = h("div", { class: "msg", role: "alert", hidden: true });
  const f = h("form", { class: "form-grelha", novalidate: true },
    h("input", { type: "email", name: "utilizador", value: eu.email, autocomplete: "username", hidden: true }),
    campoForm("Palavra-passe atual", h("input", { name: "atual", type: "password", required: true, autocomplete: "current-password" })),
    campoForm("Palavra-passe nova", h("input", { name: "nova", type: "password", required: true, minlength: "10", maxlength: "200", autocomplete: "new-password" }), "Pelo menos 10 caracteres."),
    campoForm("Repita a nova", h("input", { name: "repetir", type: "password", required: true, autocomplete: "new-password" })),
    h("p", { class: "ajuda", text: "As sessões abertas noutros aparelhos terminam." }),
    h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Mudar" })),
    msg);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const el = f.elements;
    if (!el.atual.value) { mensagem(msg, "Escreva a palavra-passe atual."); el.atual.focus(); return; }
    if (el.nova.value.length < 10) { mensagem(msg, "A palavra-passe nova deve ter pelo menos 10 caracteres."); el.nova.focus(); return; }
    if (el.nova.value !== el.repetir.value) { mensagem(msg, "As duas palavras-passe novas não são iguais."); el.repetir.focus(); return; }
    const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
    try {
      await pedir("eu/senha", { corpo: { atual: el.atual.value, nova: el.nova.value } });
      j.fechar();
      avisar("Palavra-passe mudada.");
    } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
  });
  j.corpo.append(f);
  f.elements.atual.focus();
}

// Pedidos feitos antes de recarregar a página (ou de sair e voltar a entrar): continua à espera
// deles, senão a palavra-passe de um cliente novo nunca chega a aparecer. Só os da própria
// pessoa: ler o resultado apaga-o, e o CEO vê os pedidos de toda a equipa.
const DESCRICAO_PEDIDO = {
  cliente: (p) => [`Cliente ${p.cliente}`, p.cliente],
  aparelho: (p) => [`Aparelho ${p.dados?.id ?? ""} de ${p.cliente}`, `${p.cliente}-${p.dados?.id ?? ""}`],
  "remover-aparelho": (p) => [`Remover ${p.dados?.id ?? "aparelho"} de ${p.cliente}`],
  plano: (p) => [`Plano de ${p.cliente}`],
};
async function retomarPedidos() {
  let r;
  try { r = await pedir("pedidos"); } catch { return; }
  for (const p of lista(r, "pedidos")) {
    if (!eu || p.por !== eu.email || !(p.estado === "pendente" || p.resultado_disponivel)) continue;
    const [descricao, utilizador] = DESCRICAO_PEDIDO[p.tipo]?.(p) ?? [`Pedido ${p.tipo}`];
    acompanharPedido(p.id, { descricao, utilizador });
  }
}

// Menu no telemóvel
const menuBotao = $("menu-botao"), nav = $("navegacao");
function abrirMenu(abrir) {
  nav.classList.toggle("aberta", abrir);
  menuBotao.setAttribute("aria-expanded", String(abrir));
  menuBotao.setAttribute("aria-label", abrir ? "Fechar menu" : "Menu");
}
menuBotao.addEventListener("click", () => {
  const abrir = !nav.classList.contains("aberta");
  abrirMenu(abrir);
  if (abrir) nav.querySelector("a")?.focus();
});
nav.addEventListener("click", (e) => { if (e.target.closest("a")) abrirMenu(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav.classList.contains("aberta") && !document.querySelector("dialog[open]")) { abrirMenu(false); menuBotao.focus(); }
});

// ---------- Rotas ----------
function rota() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return { id: partes[0] || "inicio", resto: partes.slice(1) };
}
export function navegar(caminho) { location.hash = `#/${caminho}`; }

function encaminhar() {
  if (!eu) return;
  const { id, resto } = rota();
  const ecra = ECRAS.find((e) => e.id === id);
  const mesmo = ecraAtual && ecraAtual.id === id && ecraAtual.ecra === ecra;
  // Mudar só a ficha (#/clientes → #/clientes/x) não volta a montar o ecrã.
  if (mesmo && ecraAtual.api?.rota) { ecraAtual.api.rota(resto); marcarNav(id); return; }
  desmontar?.(); desmontar = null;
  document.querySelectorAll("dialog.janela").forEach((d) => d.close());
  conteudo.replaceChildren();
  marcarNav(id);
  if (!ecra) { conteudo.append(h("div", { class: "cartao" }, h("h1", { text: "Página não encontrada" }), h("a", { class: "btn sec pequeno", href: "#/inicio", text: "Ir para o início" }))); ecraAtual = null; return; }
  document.title = `${ecra.nome} — Painel Domus Energia`;
  if (!permitido(ecra)) { conteudo.append(semAcesso()); ecraAtual = { id, ecra }; return; }
  const ctx = { eu, resto, navegar, acompanharPedido, pode: (...papeis) => papeis.includes(eu.papel) };
  const api = ecra.m(conteudo, ctx) ?? {};
  desmontar = api.desmontar ?? null;
  ecraAtual = { id, ecra, api };
}
function marcarNav(id) {
  nav.querySelectorAll("a").forEach((a) => {
    if (a.dataset.ecra === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", () => {
  const antes = ecraAtual?.id;
  encaminhar();
  if (rota().id !== antes) conteudo.focus({ preventScroll: true });
});

// ---------- Pedidos ao servidor (criar cliente, aparelho…): esperar pelo resultado ----------
// O servidor aplica os pedidos a cada ~5 s (temporizador domus-pedidos). Um só ciclo para todos os pedidos em
// espera: GET pedidos UMA vez por ciclo (o estado de todos); só os que acabaram são lidos um a um (GET pedidos/:id
// mostra o resultado uma vez). O intervalo começa em 4 s e cresce enquanto nada muda (até 60 s); com o separador
// escondido não se pergunta nada; ao fim de 30 min sem mudanças pára (cada pedido renova a sessão: não a
// manter aberta para sempre) e a faixa oferece "Verificar agora". Quando chega o resultado com palavra-passe,
// abre uma janela que a mostra UMA vez. Uma só faixa compacta, que se abre para ver a lista.
const pendentes = new Map();
export const INTERVALO_PEDIDOS = 4000;
export const INTERVALO_PEDIDOS_MAX = 60000;
export const PARAR_PEDIDOS_MS = 30 * 60 * 1000;
const ciclo = { t: null, intervalo: INTERVALO_PEDIDOS, ultimaMudanca: 0, parado: false, aCorrer: false, aberta: false };

function acompanharPedido(id, { descricao, utilizador } = {}) {
  if (!id || pendentes.has(id)) return;
  const p = { descricao: descricao ?? "Pedido", utilizador, linha: h("li", { class: "pedido-pendente", text: descricao ?? "Pedido" }) };
  p.terminar = () => { pendentes.delete(id); desenharFaixa(); if (!pendentes.size) pararCiclo(); };
  pendentes.set(id, p);
  // Um pedido novo recomeça o ciclo depressa.
  ciclo.intervalo = INTERVALO_PEDIDOS; ciclo.ultimaMudanca = Date.now(); ciclo.parado = false;
  desenharFaixa();
  agendar(800);
}

function pararCiclo() { clearTimeout(ciclo.t); ciclo.t = null; }
function agendar(ms = ciclo.intervalo) {
  pararCiclo();
  if (!pendentes.size || ciclo.parado || document.hidden) return;
  ciclo.t = setTimeout(verificarPedidos, ms);
}

async function verificarPedidos() {
  ciclo.t = null;
  if (!eu) { for (const p of [...pendentes.values()]) p.terminar(); return; }
  if (!pendentes.size || ciclo.aCorrer) return;
  ciclo.aCorrer = true;
  let mudou = false;
  try {
    let estados = null;
    try { estados = new Map(lista(await pedir("pedidos"), "pedidos").map((x) => [String(campo(x, "id")), x])); }
    catch (e) { if (e instanceof ErroApi && (e.estado === 401 || e.estado === 403)) return; }
    // Os que já não estão pendentes (ou que a lista não traz, até 3 por ciclo) leem-se um a um.
    const ids = [...pendentes.keys()];
    const aLer = estados ? ids.filter((id) => estados.has(id) && estados.get(id).estado !== "pendente") : [];
    if (estados) aLer.push(...ids.filter((id) => !estados.has(id)).slice(0, 3));
    for (const id of aLer) {
      const p = pendentes.get(id);
      if (!p || !eu) continue;
      try {
        const r = await lerPedido(id);
        if (r.estado === "pendente") continue;
        mudou = true;
        p.terminar();
        if (r.estado === "erro") avisar(`${p.descricao}: não foi feito. ${r.erro ?? ""}`.trim(), "erro");
        else if (r.senha) mostrarPalavraPasse(`${p.descricao}: feito`, r.senha, { utilizador: p.utilizador ?? campo(r.resultado, "utilizador", "codigo"), texto: "O servidor aplicou o pedido. Entregue estes dados ao cliente." });
        else avisar(`${p.descricao}: feito.`, "ok");
      } catch (e) {
        if (e instanceof ErroApi && e.estado === 404) { mudou = true; p.terminar(); avisar(`${p.descricao}: o resultado já não está disponível.`, "info"); }
        else if (e instanceof ErroApi && (e.estado === 401 || e.estado === 403)) { mudou = true; p.terminar(); }
      }
    }
  } finally {
    ciclo.aCorrer = false;
  }
  const agora = Date.now();
  if (mudou) { ciclo.intervalo = INTERVALO_PEDIDOS; ciclo.ultimaMudanca = agora; }
  else ciclo.intervalo = Math.min(Math.round(ciclo.intervalo * 1.5), INTERVALO_PEDIDOS_MAX);
  if (pendentes.size && agora - ciclo.ultimaMudanca >= PARAR_PEDIDOS_MS) { ciclo.parado = true; desenharFaixa(); return; }
  agendar();
}

// Separador escondido: pára; ao voltar, pergunta logo (e recomeça depressa).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { pararCiclo(); return; }
  if (!pendentes.size || ciclo.parado) return;
  ciclo.intervalo = INTERVALO_PEDIDOS;
  agendar(300);
});

/** Uma só faixa: "N pedidos seus à espera do servidor" (só os desta pessoa: retomarPedidos; o Início conta os da equipa toda) (abre a lista); parada → "Verificar agora". */
function desenharFaixa() {
  const zona = $("pedidos-pendentes");
  const n = pendentes.size;
  if (!n) { zona.replaceChildren(); ciclo.aberta = false; return; }
  const [um] = pendentes.values();
  const texto = n === 1 ? `${um.descricao}: à espera do servidor…` : `${n} pedidos seus à espera do servidor…`;
  const partes = [ciclo.parado ? h("span", { class: "pedidos-parado", "aria-hidden": "true", text: "⏸" }) : h("span", { class: "rodar", "aria-hidden": "true" }),
    h("span", { class: "pedidos-texto", text: ciclo.parado ? `${n === 1 ? um.descricao : `${n} pedidos`}: parei de verificar.` : texto })];
  if (ciclo.parado) {
    partes.push(h("button", { class: "btn sec pequeno", type: "button", id: "pedidos-verificar", text: "Verificar agora", onclick: () => {
      ciclo.parado = false; ciclo.intervalo = INTERVALO_PEDIDOS; ciclo.ultimaMudanca = Date.now(); desenharFaixa(); agendar(0);
    } }));
  }
  let listaEl = null;
  if (n > 1) {
    listaEl = h("ul", { class: "pedidos-lista", id: "pedidos-lista", hidden: !ciclo.aberta }, ...[...pendentes.values()].slice(0, 50).map((p) => p.linha),
      n > 50 ? h("li", { class: "ajuda", text: `e mais ${n - 50}` }) : null);
    partes.push(h("button", { class: "botao-icone pedidos-abrir", type: "button", "aria-controls": "pedidos-lista", "aria-expanded": String(ciclo.aberta),
      "aria-label": ciclo.aberta ? "Esconder a lista dos pedidos" : "Ver a lista dos pedidos", title: ciclo.aberta ? "Esconder" : "Ver a lista", text: ciclo.aberta ? "▾" : "▸",
      onclick: () => { ciclo.aberta = !ciclo.aberta; desenharFaixa(); $("pedidos-pendentes").querySelector(".pedidos-abrir")?.focus(); } }));
  }
  zona.replaceChildren(...[h("div", { class: "pedidos-faixa" }, ...partes), listaEl].filter(Boolean));
}

arrancar();
