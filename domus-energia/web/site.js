import { origemContacto } from "./origem.js";
import { contaAtual, pedirConta } from "./conta-comum.js";
import { temCasaGuardada, pedidoEmAndamento, botaoInicio } from "./regresso.js";

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
// Hero (index.html): "ou ligue: telefone · WhatsApp"; sem nenhum dos dois (números de exemplo), "ou escreva-nos: email".
const ouLigar = document.querySelector(".js-ou-ligar");
if (ouLigar) {
  if (!temTelefone && !temWhatsapp) { ouLigar.hidden = true; document.querySelector(".js-ou-email").hidden = false; }
  else if (!temTelefone || !temWhatsapp) ouLigar.querySelector(".js-ou-sep").hidden = true;
}
// Contactos (index.html): a frase só fala dos meios que estão à vista.
document.querySelectorAll(".js-contactos-frase").forEach((x) => {
  x.textContent = temTelefone && temWhatsapp ? "Ligue, mande WhatsApp ou escreva." : temTelefone ? "Ligue ou escreva." : temWhatsapp ? "Mande WhatsApp ou escreva." : "Escreva-nos.";
});
document.getElementById("ano").textContent = new Date().getFullYear();

// ---------- Botão do topo (index.html #hero-simular): segue quem regressa ----------
// Decisão 3 do dono, 2026-10-04 (regresso.js botaoInicio): a página nasce com "Descrever a minha casa" (também sem
// JavaScript) e só troca depois de saber quem é — casa guardada neste navegador ou sessão aberta: "Continuar com a minha
// casa"; sessão com um pedido em andamento: "Ver o meu pedido" (para a conta). Troca uma vez só. Sem a marca de sessão
// não se pede nada ao servidor (contaAtual); pedido lento ou falhado: fica o que está. A largura do botão não encolhe.
{
  const botao = document.getElementById("hero-simular");
  if (botao) {
    const casa = temCasaGuardada((() => { try { return window.localStorage; } catch { return null; } })());
    (async () => {
      const eu = await contaAtual();
      let pedido = null;
      if (eu?.conta?.confirmado) {
        try { pedido = pedidoEmAndamento((await pedirConta("pedidos")).pedidos); } catch { /* fica sem o pedido */ }
      }
      const b = botaoInicio({ sessao: !!eu?.conta, temCasa: casa, pedido });
      if (!b) return;
      botao.style.minWidth = `${botao.offsetWidth}px`;
      (document.getElementById("hero-simular-texto") ?? botao).textContent = b.texto;
      botao.href = b.href;
    })();
  }
}


// ---------- Fotografias de trabalhos (config.js): fotoTopo no lugar do desenho; "Trabalhos recentes" com 3 ou mais ----------
{
  const D = window.DOMUS ?? {};
  const topo = document.getElementById("hero-foto");
  if (topo && D.fotoTopo?.ficheiro) {
    topo.src = D.fotoTopo.ficheiro;
    topo.alt = D.fotoTopo.legenda ?? "";
    topo.hidden = false;
    document.querySelector(".hero .casa")?.setAttribute("hidden", "");
  }
  const lista = document.getElementById("trabalhos-lista");
  const trabalhos = Array.isArray(D.trabalhos) ? D.trabalhos.filter((t) => t?.ficheiro && t?.legenda) : [];
  if (lista && trabalhos.length >= 3) {
    for (const t of trabalhos.slice(0, 9)) {
      const li = document.createElement("li");
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = t.ficheiro;
      img.alt = t.legenda;
      img.loading = "lazy";
      img.width = 880;
      img.height = 660;
      const cap = document.createElement("figcaption");
      cap.textContent = t.legenda;
      fig.append(img, cap);
      li.append(fig);
      lista.append(li);
    }
    document.getElementById("trabalhos").hidden = false;
  }
}

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
  // Só a categoria de onde a pessoa veio (web/origem.js): a resposta a "Como nos conheceu?", senão o canal; nunca o endereço.
  return { ...corpo, ...origemContacto(t(dados.conheceu)) };
}

form?.addEventListener("submit", async (e) => {   // as páginas de anúncio não têm o formulário
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
    mostrar(`Pedido recebido. Respondemos em dia útil.${temTelefone ? ` Se for urgente, ligue ${cfg.telefoneVisivel}.` : ""}`, true);
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

// Preço do diagnóstico de avaria (index.html #preco-diagnostico): o do catálogo do servidor, igual ao do simulador
// (DIAG-AVARIA: preço + horas × tarifa). Sem servidor fica o valor escrito na página.
// Preço do relatório completo (.js-preco-relatorio, decisão do dono 2026-10-09): o do painel (`preco_relatorio_iva`).
{
  const alvo = document.getElementById("preco-diagnostico");
  const relatorio = document.querySelectorAll(".js-preco-relatorio");
  if (alvo || relatorio.length) {
    const base = (window.DOMUS?.apiBase || "") + "/api/catalogo";
    fetch(base, { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const a = (d?.artigos ?? d?.itens ?? []).find((x) => x.sku === "DIAG-AVARIA");
      const tarifa = Number((d?.config ?? d)?.tarifa_hora_iva);
      const v = a && Number.isFinite(tarifa) ? Number(a.preco_venda_iva) + Number(a.horas_instalacao || 0) * tarifa : NaN;
      if (alvo && Number.isFinite(v) && v > 0) alvo.textContent = v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      const r = Number((d?.config ?? d)?.preco_relatorio_iva);
      if (Number.isFinite(r) && r > 0) for (const x of relatorio) x.textContent = r.toLocaleString("pt-PT", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 }) + " €";
    }).catch(() => {});
  }
}
