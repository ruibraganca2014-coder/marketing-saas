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
const whatsappUrl = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent("Olá Domus Energia, gostava de pedir informações.")}`;
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
    mostrar("Não foi possível enviar. Tente pelo WhatsApp ou telefone.", false);
  } else {
    form.reset();
    mostrar("Pedido enviado! Entraremos em contacto muito em breve.", true);
  }
});

function mostrar(texto, ok) {
  if (!texto) { msg.hidden = true; return; }
  msg.textContent = texto;
  msg.className = `msg ${ok ? "ok" : "erro"}`;
  msg.hidden = false;
}
