// "A minha subscrição", ecrã de subscrição suspensa, aviso de pagamento em atraso e cadeados
// das funcionalidades fora do plano (docs/PROTOCOLO-PLANOS.md §3 e §6).
// Textos só com textContent; os endereços do Stripe vêm do /api e só se abrem se forem https.
import * as PL from "./planos.js";
import { el, botao } from "./editor.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

export function iconeCadeado() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "icone-cadeado");
  const r = document.createElementNS(NS, "rect");
  Object.entries({ x: "3", y: "7", width: "10", height: "7", rx: "2" }).forEach(([k, v]) => r.setAttribute(k, v));
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", "M5.5 7V5a2.5 2.5 0 0 1 5 0v2");
  svg.append(r, p);
  return svg;
}

/**
 * Cadeado "Disponível no plano Conforto — mudar de plano" (o fim é um botão que abre "A minha subscrição").
 * @param {string} chave funcionalidade (§1)
 * @param {() => void} aoMudar
 * @param {string} [texto] outro texto no lugar de "Disponível no plano Conforto" (ex.: o erro do motor)
 */
export function criarBloqueio(chave, aoMudar, texto) {
  const d = el("div", "bloqueio");
  d.dataset.chave = chave;
  const t = el("span", "bloqueio-texto");
  const base = (texto ?? PL.textoDisponivel(chave)).replace(/\.\s*$/, "");
  t.append(iconeCadeado(), el("span", null, `${base} — `));
  const b = botao("mudar de plano", "link-plano", aoMudar);
  t.append(b);
  d.append(t);
  return d;
}

// Contactos a partir do config.js (WhatsApp e telefone). Números só com zeros são o
// valor de exemplo do config.js (ex.: 351900000000): nesse caso os botões ficam escondidos (como na app).
export const numeroReal = (n) => { const d = String(n ?? "").replace(/^\+/, ""); return /^\d{6,15}$/.test(d) && !/^(351)?9?0+$/.test(d); };
function contactos(codigo) {
  const cfg = window.DOMUS ?? {};
  const r = [];
  if (numeroReal(cfg.whatsapp)) {
    const a = el("a", "btn pequeno whatsapp", "Falar no WhatsApp");
    const quem = codigo ? ` (cliente ${codigo})` : "";
    a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Olá Domus Energia, sou cliente${quem} e queria falar sobre a minha subscrição.`)}`;
    a.target = "_blank";
    a.rel = "noopener";
    r.push(a);
  }
  if (typeof cfg.telefone === "string" && /^\+?\d{6,15}$/.test(cfg.telefone) && numeroReal(cfg.telefone)) {
    const a = el("a", "btn sec pequeno", `Ligar ${cfg.telefoneVisivel ?? cfg.telefone}`);
    a.href = `tel:${cfg.telefone}`;
    r.push(a);
  }
  return r;
}

/**
 * @param {{ api: ReturnType<typeof PL.criarApi>, codigo: () => string|null, irPara?: (url: string) => void }} o
 */
export function criarSubscricao({ api, codigo, irPara = (u) => window.location.assign(u) }) {
  let plano = { ...PL.PLANO_OMISSAO };
  let escolher = false;   // lista "Mudar de plano" aberta
  let ocupado = null;     // botão à espera do /api

  function mensagem(caixa, texto, tipo = "info") {
    if (!caixa) return;
    caixa.hidden = !texto;
    caixa.textContent = texto ?? "";
    caixa.className = `msg ${tipo}`;
  }

  // Pede o endereço ao /api e abre-o (checkout ou portal).
  async function abrir(b, caixa, pedido) {
    if (ocupado) return;
    ocupado = b;
    const texto = b.textContent;
    b.disabled = true;
    b.textContent = "A abrir…";
    mensagem(caixa, "A abrir a página de pagamento segura…", "info");
    try {
      const url = await pedido();
      mensagem(caixa, "A abrir a página de pagamento segura…", "info");
      irPara(url);
    } catch (e) {
      mensagem(caixa, e?.message || PL.MSG_API.pedido, e?.tipo === "espera" ? "info" : "erro");
    } finally {
      ocupado = null;
      if (b.isConnected) { b.disabled = false; b.textContent = texto; }
    }
  }
  const checkout = (b, caixa, id) => abrir(b, caixa, () => api.checkout(id));
  const portal = (b, caixa) => abrir(b, caixa, () => api.portal());

  function cartaoPlano(id, atual, caixaMsg) {
    const info = PL.INFO_PLANOS[id];
    const c = el("article", `cartao-plano${atual ? " atual" : ""}`);
    c.dataset.plano = id;
    const topo = el("div", "cartao-plano-topo");
    topo.append(el("h4", null, info.nome), el("span", "preco num", info.preco), el("span", "preco-mes", "/mês"));
    c.append(topo);
    const ul = el("ul", "inclui");
    for (const t of info.inclui) ul.append(el("li", null, t));
    c.append(ul);
    if (atual) {
      const b = botao("O seu plano atual", "btn sec pequeno");
      b.disabled = true;
      c.append(b);
    } else {
      const b = botao(`Escolher ${info.nome}`, "btn pequeno", () => checkout(b, caixaMsg, id));
      c.append(b);
    }
    return c;
  }

  function desenhar() {
    const raiz = $("subscricao-caixa");
    if (!raiz) return;
    raiz.replaceChildren();
    const msg = $("subscricao-msg");
    const info = PL.INFO_PLANOS[plano.plano];
    const stripe = plano.gerido === "stripe";

    const c = el("div", "cartao plano-atual");
    c.dataset.plano = plano.plano;
    c.dataset.estado = plano.estado;
    const topo = el("div", "plano-atual-topo");
    const nome = el("div");
    nome.append(el("small", "vazio", "O seu plano"), el("h3", null, `Plano ${info.nome}`));
    const selo = el("span", `selo-plano tom-${PL.TOM_ESTADO[plano.estado]}`, PL.ROTULO_ESTADO[plano.estado]);
    selo.id = "subscricao-estado";
    topo.append(nome, selo);
    c.append(topo);
    const preco = el("p", "plano-preco");
    preco.append(el("b", "num", info.preco), document.createTextNode(" por mês, IVA incluído"));
    c.append(preco);
    // Em atraso a explicação é o próprio aviso, que já aparece em baixo com o botão.
    if (plano.estado !== "em_atraso") c.append(el("p", "plano-explicacao", PL.explicacaoEstado(plano)));

    const dl = el("dl", "factos");
    const facto = (rot, val) => { const d = el("div", "facto"); d.append(el("dt", null, rot), el("dd", null, val)); dl.append(d); };
    facto("Estado", PL.ROTULO_ESTADO[plano.estado]);
    const prox = PL.proximoPagamento(plano);
    if (prox) facto(plano.estado === "teste" ? "Primeiro pagamento" : "Próximo pagamento", prox);
    if (plano.estado === "em_atraso" && plano.avisoAte != null) facto("Atualizar até", PL.dataLonga(plano.avisoAte));
    if (plano.desde != null) facto("Cliente desde", PL.dataLonga(plano.desde));
    facto("Pagamento", stripe ? "Automático, todos os meses" : "Gerido pela Domus Energia");
    c.append(dl);

    if (plano.estado === "em_atraso") {
      const av = el("div", "aviso-atraso");
      av.append(el("p", null, PL.avisoAtraso(plano)));
      if (stripe) {
        const b = botao("Atualizar pagamento", "btn pequeno", () => portal(b, msg));
        b.id = "subscricao-atualizar";
        av.append(b);
      }
      c.append(av);
    }

    c.append(el("h4", "inclui-titulo", "O que inclui"));
    const ul = el("ul", "inclui");
    for (const t of info.inclui) ul.append(el("li", null, t));
    c.append(ul);
    raiz.append(c);

    if (stripe) {
      const botoes = el("div", "form-botoes subscricao-botoes");
      const mudar = botao("Mudar de plano", "btn", () => { escolher = !escolher; desenhar(); if (escolher) $("escolher-titulo")?.focus(); });
      mudar.id = "mudar-plano";
      mudar.setAttribute("aria-expanded", String(escolher));
      mudar.setAttribute("aria-controls", "escolher-plano");
      const gerir = botao("Gerir pagamentos e faturas", "btn sec", () => portal(gerir, msg));
      gerir.id = "gerir-pagamentos";
      botoes.append(mudar, gerir);
      raiz.append(botoes);
      if (escolher) {
        const e = el("div", "cartao escolher-plano");
        e.id = "escolher-plano";
        const h = el("h3", null, "Escolha o novo plano");
        h.id = "escolher-titulo";
        h.tabIndex = -1;
        e.append(h, el("p", "ajuda", "Preços com IVA. Sem fidelização: pode mudar ou cancelar quando quiser. O pagamento é feito na página segura do Stripe."));
        const g = el("div", "planos-grelha");
        for (const id of PL.PLANOS) g.append(cartaoPlano(id, id === plano.plano, msg));
        e.append(g, botao("Cancelar", "btn sec pequeno", () => { escolher = false; desenhar(); $("mudar-plano")?.focus(); }));
        raiz.append(e);
      }
      raiz.append(el("p", "ajuda", "No portal de pagamentos pode mudar o cartão, ver e descarregar as faturas ou cancelar a subscrição."));
    } else {
      const f = el("div", "cartao fale-connosco");
      f.id = "fale-connosco";
      f.append(el("h3", null, "Fale connosco para mudar de plano"), el("p", null, "A sua subscrição é gerida diretamente pela Domus Energia. Para mudar de plano ou tratar de pagamentos, fale connosco."));
      const b = el("div", "form-botoes");
      b.append(...contactos(codigo()));
      if (b.childElementCount) f.append(b);
      raiz.append(f);
    }
    if (msg && !ocupado) mensagem(msg, null);
  }

  // Aviso de pagamento em atraso no topo do painel (todas as secções).
  function desenharAviso(abrirSubscricao) {
    const caixa = $("aviso-plano");
    if (!caixa) return;
    const atraso = plano.estado === "em_atraso";
    // No ecrã "A minha subscrição" o cartão já tem o aviso (e o botão): não se repete no topo.
    caixa.hidden = !atraso || $("sec-subscricao")?.hidden === false;
    if (!atraso) { caixa.replaceChildren(); return; }
    caixa.replaceChildren();
    const t = el("div", "aviso-plano-texto");
    t.append(el("b", null, "Pagamento em atraso"), el("p", null, PL.avisoAtraso(plano)));
    const m = el("div", "msg");
    m.id = "aviso-plano-msg";
    m.setAttribute("role", "status");
    m.hidden = true;
    const b = plano.gerido === "stripe"
      ? botao("Atualizar pagamento", "btn pequeno", () => portal(b, m))
      : botao("Fale connosco", "btn pequeno", () => abrirSubscricao());
    b.id = "aviso-plano-botao";
    caixa.append(t, b, m);
  }

  // Ecrã de subscrição suspensa / cancelada (substitui toda a área de cliente).
  function desenharSuspensa() {
    const raiz = $("vista-suspensa");
    if (!raiz) return;
    $("suspensa-titulo").textContent = PL.tituloBasico(plano);
    $("suspensa-texto").textContent = plano.estado === "cancelado"
      ? "Como a subscrição foi cancelada, a casa passou ao modo básico."
      : "Como o pagamento não foi feito, a casa passou ao modo básico.";
    const msg = $("suspensa-msg");
    const b = $("suspensa-botoes");
    b.replaceChildren();
    if (plano.gerido === "stripe") {
      const r = botao("Reativar subscrição", "btn", () => checkout(r, msg, plano.plano));
      r.id = "reativar";
      b.append(r);
      $("suspensa-ajuda").textContent = `Volta tudo ao normal logo depois do pagamento (plano ${PL.INFO_PLANOS[plano.plano].nome}, ${PL.INFO_PLANOS[plano.plano].preco}/mês). Se precisar de ajuda, fale connosco.`;
    } else {
      $("suspensa-ajuda").textContent = "Para reativar a subscrição, fale connosco.";
    }
    b.append(...contactos(codigo()));
    if (!ocupado) mensagem(msg, null);
  }

  return {
    receber(p) {
      const mudouGerido = p.gerido !== plano.gerido;
      plano = p;
      if (mudouGerido) escolher = false;
    },
    abrirEscolha() { if (plano.gerido === "stripe") escolher = true; },
    desenhar,
    desenharAviso,
    desenharSuspensa,
    limpar() { plano = { ...PL.PLANO_OMISSAO }; escolher = false; ocupado = null; $("subscricao-caixa")?.replaceChildren(); $("aviso-plano")?.replaceChildren(); },
  };
}
