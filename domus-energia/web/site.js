const cfg = window.DOMUS;

// O Supabase só é carregado quando alguém envia o formulário,
// assim os contactos funcionam mesmo que a biblioteca não carregue.
let supabase = null;
async function getSupabase() {
  if (!supabase) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  return supabase;
}

// Contactos a partir do config.js
const whatsappPara = (texto) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto)}`;
const whatsappUrl = whatsappPara("Olá Domus Energia, gostava de pedir informações.");
document.querySelectorAll(".js-whatsapp").forEach((a) => {
  a.href = whatsappUrl;
  a.target = "_blank";
  a.rel = "noopener";
});
document.querySelectorAll(".js-telefone").forEach((a) => (a.href = `tel:${cfg.telefone}`));
document.querySelectorAll(".js-telefone-texto").forEach((el) => (el.textContent = cfg.telefoneVisivel));
document.querySelectorAll(".js-email").forEach((a) => (a.href = `mailto:${cfg.email}`));
document.querySelectorAll(".js-email-texto").forEach((el) => (el.textContent = cfg.email));
document.getElementById("ano").textContent = new Date().getFullYear();

// ---------- Menu para telemóvel ----------
const menuBotao = document.getElementById("menu-botao");
const menu = document.getElementById("menu-movel");
function abrirMenu(abrir) {
  menu.hidden = !abrir;
  menuBotao.setAttribute("aria-expanded", String(abrir));
  menuBotao.setAttribute("aria-label", abrir ? "Fechar menu" : "Menu");
}
menuBotao.addEventListener("click", () => {
  const abrir = menu.hidden;
  abrirMenu(abrir);
  if (abrir) menu.querySelector("a")?.focus();
});
// Escolher uma secção fecha o menu (o navegador desce até ela).
menu.addEventListener("click", (e) => { if (e.target.closest("a")) abrirMenu(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !menu.hidden) { abrirMenu(false); menuBotao.focus(); }
});
document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBotao.contains(e.target)) abrirMenu(false);
});

// ---------- Planos: "Pedir orçamento" escolhe o plano no formulário ----------
document.querySelectorAll(".js-plano").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const sel = form.elements.servico;
    if ([...sel.options].some((o) => o.value === a.dataset.servico)) sel.value = a.dataset.servico;
    const alvo = document.getElementById("orcamento");
    alvo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    form.elements.nome.focus({ preventScroll: true });
    try { history.replaceState(null, "", "#orcamento"); } catch {}
  });
});

// Formulário de orçamento → tabela pedidos_orcamento
const form = document.getElementById("form-orcamento");
const msg = document.getElementById("form-msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = form.querySelector("button");
  const dados = Object.fromEntries(new FormData(form));

  if (!dados.telefone && !dados.email) {
    mostrar("Indique um telefone ou um email para o podermos contactar.", false);
    return;
  }

  botao.disabled = true;
  botao.textContent = "A enviar…";
  mostrar(null);
  let error;
  try {
    ({ error } = await (await getSupabase()).from("pedidos_orcamento").insert(dados));
  } catch (e) {
    error = e;
  }
  botao.disabled = false;
  botao.textContent = "Enviar pedido";

  if (error) {
    mostrar("Não foi possível enviar. Tente pelo WhatsApp ou telefone.", false, dados);
  } else {
    form.reset();
    mostrar("Pedido enviado! Entraremos em contacto muito em breve.", true);
  }
});

// Com `dados` (falha ao enviar): botões do WhatsApp e do telefone junto ao erro, com o pedido já escrito.
function mostrar(texto, ok, dados = null) {
  if (!texto) { msg.hidden = true; msg.replaceChildren(); return; }
  msg.replaceChildren(document.createTextNode(texto));
  if (dados) {
    const acoes = document.createElement("div");
    acoes.className = "msg-acoes";
    const w = document.createElement("a");
    w.className = "btn sec pequeno";
    w.id = "form-whatsapp";
    w.textContent = "Enviar pelo WhatsApp";
    const partes = [`Olá Domus Energia, gostava de pedir um orçamento${dados.servico ? ` (${dados.servico})` : ""}.`];
    if (dados.nome) partes.push(`Nome: ${dados.nome}`);
    if (dados.localidade) partes.push(`Localidade: ${dados.localidade}`);
    if (dados.mensagem) partes.push(String(dados.mensagem));
    w.href = whatsappPara(partes.join("\n").slice(0, 1500));
    w.target = "_blank";
    w.rel = "noopener";
    const t = document.createElement("a");
    t.className = "btn sec pequeno";
    t.href = `tel:${cfg.telefone}`;
    t.textContent = `Ligar ${cfg.telefoneVisivel}`;
    acoes.append(w, t);
    msg.append(acoes);
  }
  msg.className = `msg ${ok ? "ok" : "erro"}`;
  msg.hidden = false;
}
