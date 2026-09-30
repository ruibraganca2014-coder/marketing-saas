const cfg = window.DOMUS;

// Contactos a partir do config.js. Números de exemplo (só zeros, ex. 351900000000) ficam escondidos,
// como na área de cliente (subscricao.js numeroReal).
const numeroReal = (n) => { const d = String(n ?? "").replace(/^\+/, ""); return /^\d{6,15}$/.test(d) && !/^(351)?9?0+$/.test(d); };
const temWhatsapp = numeroReal(cfg.whatsapp);
const temTelefone = numeroReal(cfg.telefone);
const whatsappPara = (texto) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto)}`;
const whatsappUrl = whatsappPara("Olá Domus Energia, gostava de pedir informações.");
document.querySelectorAll(".js-whatsapp").forEach((a) => {
  if (!temWhatsapp) { a.hidden = true; return; }
  a.href = whatsappUrl;
  a.target = "_blank";
  a.rel = "noopener";
});
document.querySelectorAll(".js-telefone").forEach((a) => { if (temTelefone) a.href = `tel:${cfg.telefone}`; else a.hidden = true; });
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

// Formulário de orçamento → POST /api/orcamento (servidor do painel da empresa, docs/PAINEL-EMPRESA.md §3).
const form = document.getElementById("form-orcamento");
const msg = document.getElementById("form-msg");
// Pedido de contacto SEM simulação: não precisa de conta de cliente (só o simulador a exige). Com DOMUS.apiBase
// (site no Vercel) vai para o painel noutro endereço (CORS em SITE_ORIGENS, docs/CONTA-CLIENTE.md).
const apiBase = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
const urlOrcamento = `${apiBase ? `${apiBase}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "")}/orcamento`;
// Iguais a RE_TELEFONE (painel/src/validar.js) e RE_EMAIL (painel/src/pedidos.js).
const RE_TELEFONE = /^\+?[0-9 ()-]{6,30}$/;
const RE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;

/** Corpo do pedido: textos aparados; campos opcionais vazios ficam de fora. `website` é o campo-armadilha. */
function corpoOrcamento(dados) {
  const t = (v) => String(v ?? "").trim();
  const corpo = { nome: t(dados.nome), servico: t(dados.servico) || "Outro" };
  for (const k of ["telefone", "email", "localidade", "mensagem", "website"]) if (t(dados[k])) corpo[k] = t(dados[k]);
  return corpo;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = form.querySelector("button");
  const dados = Object.fromEntries(new FormData(form));

  if (!String(dados.nome ?? "").trim()) {
    mostrar("Escreva o seu nome.", false);
    form.elements.nome.focus();
    return;
  }
  const telefone = String(dados.telefone ?? "").trim();
  const email = String(dados.email ?? "").trim();
  if (!telefone && !email) {
    mostrar("Indique um telefone ou um email para o podermos contactar.", false);
    form.elements.telefone.focus();
    return;
  }
  // As mesmas regras do servidor: um pedido recusado também conta para o limite por hora.
  if (telefone && !RE_TELEFONE.test(telefone)) {
    mostrar("Telefone inválido. Use só números, espaços e + (ex.: 912 345 678).", false);
    form.elements.telefone.focus();
    return;
  }
  if (email && !RE_EMAIL.test(email)) {
    mostrar("Email inválido. Confirme o endereço (ex.: nome@exemplo.pt).", false);
    form.elements.email.focus();
    return;
  }

  botao.disabled = true;
  botao.textContent = "A enviar…";
  mostrar(null);
  let estado = 0;
  let erro = "";
  try {
    const r = await fetch(urlOrcamento, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpoOrcamento(dados)),
    });
    estado = r.status;
    if (estado === 400) erro = String((await r.json().catch(() => ({}))).erro ?? "");
  } catch {
    estado = 0;
  }
  botao.disabled = false;
  botao.textContent = "Enviar pedido";

  if (estado >= 200 && estado < 300) {
    form.reset();
    mostrar("Pedido enviado! Entraremos em contacto muito em breve.", true);
  } else if (estado === 429) {
    mostrar("Já recebemos vários pedidos seguidos deste aparelho. Tente de novo daqui a uma hora, ou fale connosco pelo WhatsApp ou telefone.", false, dados);
  } else if (estado === 400) {
    mostrar(`${erro || "Há dados em falta ou demasiado longos."} Verifique o formulário, ou fale connosco pelo WhatsApp ou telefone.`, false, dados);
  } else {
    mostrar("Não foi possível enviar. Tente pelo WhatsApp ou telefone.", false, dados);
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
    if (temWhatsapp) acoes.append(w);
    if (temTelefone) acoes.append(t);
    msg.append(acoes);
  }
  msg.className = `msg ${ok ? "ok" : "erro"}`;
  msg.hidden = false;
}
