// Painel da empresa (docs/PAINEL-EMPRESA.md §4): entrar, navegação por papel e ecrãs.
// Rotas no endereço: #/inicio, #/clientes, #/clientes/<codigo>, #/alertas, #/orcamentos, #/orcamentos/<id>,
// #/obras, #/obras/<id>, #/catalogo, #/pagamentos, #/equipa, #/auditoria.
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

// Quem vê o quê (§1). O servidor verifica sempre; aqui só se esconde o que não se pode usar.
const ECRAS = [
  { id: "inicio", nome: "Início", papeis: ["ceo", "tecnico", "comercial"], m: inicio },
  { id: "clientes", nome: "Clientes", papeis: ["ceo", "tecnico", "comercial"], m: clientes },
  { id: "alertas", nome: "Alertas", papeis: ["ceo", "tecnico"], m: alertas },
  { id: "orcamentos", nome: "Orçamentos", papeis: ["ceo", "comercial"], m: orcamentos },
  { id: "obras", nome: "Obras", papeis: ["ceo", "tecnico", "comercial"], m: obras },
  { id: "catalogo", nome: "Catálogo", papeis: ["ceo"], m: catalogo },
  { id: "pagamentos", nome: "Pagamentos", papeis: ["ceo"], m: pagamentos },
  { id: "equipa", nome: "Equipa", papeis: ["ceo"], m: equipa },
  { id: "auditoria", nome: "Auditoria", papeis: ["ceo"], m: auditoria },
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
  return { id: campo(u, "id"), nome: campo(u, "nome") ?? campo(u, "email") ?? "", email: campo(u, "email") ?? "", papel: campo(u, "papel") ?? "" };
}

function mostrarLogin(texto = "", tipo = "erro") {
  eu = null;
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
// O servidor aplica os pedidos em lote (minutos). Enquanto isso, uma faixa diz que está à espera;
// quando chega o resultado com palavra-passe, abre uma janela que a mostra UMA vez.
const pendentes = new Map();
export const INTERVALO_PEDIDOS = 4000;
function acompanharPedido(id, { descricao, utilizador } = {}) {
  if (!id || pendentes.has(id)) return;
  const linha = h("div", { class: "pedido-pendente" }, h("span", { class: "rodar", "aria-hidden": "true" }), h("span", { text: `${descricao ?? "Pedido"}: à espera do servidor…` }));
  $("pedidos-pendentes").append(linha);
  const p = { linha, falhas: 0 };
  pendentes.set(id, p);
  resumirPendentes();
  const verificar = async () => {
    if (!eu) { terminar(); return; }
    try {
      const r = await lerPedido(id);
      if (r.estado === "pendente") { p.t = setTimeout(verificar, INTERVALO_PEDIDOS); return; }
      terminar();
      if (r.estado === "erro") { avisar(`${descricao ?? "Pedido"}: não foi feito. ${r.erro ?? ""}`.trim(), "erro"); return; }
      if (r.senha) mostrarPalavraPasse(`${descricao ?? "Pedido"}: feito`, r.senha, { utilizador: utilizador ?? campo(r.resultado, "utilizador", "codigo"), texto: "O servidor aplicou o pedido. Entregue estes dados ao cliente." });
      else avisar(`${descricao ?? "Pedido"}: feito.`, "ok");
    } catch (e) {
      if (e instanceof ErroApi && e.estado === 404) { terminar(); avisar(`${descricao ?? "Pedido"}: o resultado já não está disponível.`, "info"); return; }
      if (e instanceof ErroApi && e.estado === 401) { terminar(); return; }
      p.falhas++;
      p.t = setTimeout(verificar, Math.min(INTERVALO_PEDIDOS * (1 + p.falhas), 60000));
    }
  };
  function terminar() { clearTimeout(p.t); linha.remove(); pendentes.delete(id); resumirPendentes(); }
  p.t = setTimeout(verificar, 800);
}

/** Muitos pedidos de uma vez (ex.: converter com aparelhos): mostra 3 faixas e "mais N". */
const MAX_FAIXAS = 3;
function resumirPendentes() {
  const zona = $("pedidos-pendentes");
  const linhas = [...zona.querySelectorAll(".pedido-pendente")];
  linhas.forEach((l, i) => { l.hidden = i >= MAX_FAIXAS; });
  let mais = zona.querySelector(".pedidos-mais");
  const n = linhas.length - MAX_FAIXAS;
  if (n > 0) {
    if (!mais) { mais = h("div", { class: "pedidos-mais" }); zona.append(mais); }
    mais.textContent = `e mais ${n} ${n === 1 ? "pedido" : "pedidos"} à espera do servidor…`;
    zona.append(mais);
  } else mais?.remove();
}

arrancar();
