// A minha conta (docs/CONTA-CLIENTE.md): entrar/criar conta, e com sessão (email confirmado) os pedidos da
// conta — estado (recebido → visita → proposta → aceite → instalação), a simulação enviada (resumo simples),
// as fotos (acrescentar/trocar enquanto o pedido não está aceite nem convertido), a proposta com "Aceito a
// proposta", a simulação por acabar (retomar no simulador) e a ligação à área da casa (depois da instalação).
import { criarBlocoConta, pedirConta, urlDoPainel, ErroConta } from "./conta-comum.js";
import { reduzirFoto, ErroFoto, legendaCabecalho, MAX_BYTES_FOTO } from "./simulador/fotos.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const euro = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
const dataTxt = (v, hora = false) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-PT", hora ? { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" });
};

let ctrl = null;
const resumosAbertos = new Set(); // pedidos com "A simulação que enviou" aberto (sobrevive ao carregar())

const bloco = criarBlocoConta($("conta-bloco"), {
  prefixo: "conta",
  texto: { fora: "Entre para acompanhar o seu pedido de orçamento. A conta cria-se no fim da simulação, ou aqui." },
  aoMudar(eu) {
    const dentro = Boolean(eu?.conta?.confirmado);
    $("conta-dentro").hidden = !dentro;
    if (!dentro) { $("conta-pedidos").replaceChildren(); return; }
    $("conta-casa").hidden = !eu.tem_casa;
    const r = $("conta-retomar");
    r.replaceChildren();
    r.hidden = !eu.simulacao_atualizada;
    if (eu.simulacao_atualizada) {
      const a = el("a", null, "Continuar a simulação");
      a.href = "simulador.html";
      a.id = "conta-continuar";
      r.append(`Tem uma simulação por acabar (guardada em ${dataTxt(eu.simulacao_atualizada, true)}). `, a,
        ". As fotos que tirou e ainda não enviou ficam só no aparelho onde as tirou.");
    }
    carregar();
  },
});

function mensagem(t, tipo = "erro") {
  const m = $("conta-msg");
  m.textContent = t ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !t;
}

async function carregar() {
  ctrl?.abort();
  ctrl = new AbortController();
  const zona = $("conta-pedidos");
  zona.replaceChildren(el("p", "ajuda", "A carregar…"));
  let r;
  try { r = await pedirConta("pedidos", { sinal: ctrl.signal }); } catch (e) {
    if (e?.name === "AbortError") return;
    if (e instanceof ErroConta && e.estado === 401) { bloco.atualizar(); return; }
    zona.replaceChildren();
    mensagem(e.message);
    return;
  }
  mensagem(null);
  const pedidos = Array.isArray(r?.pedidos) ? r.pedidos : [];
  if (!pedidos.length) {
    const p = el("p", "vazio", "Ainda não enviou nenhum pedido. ");
    const a = el("a", null, "Simular orçamento");
    a.href = "simulador.html";
    p.append(a);
    zona.replaceChildren(p);
    return;
  }
  zona.replaceChildren(...pedidos.map(cartaoPedido));
}

function cartaoPedido(p) {
  const c = el("article", "cartao conta-pedido");
  c.dataset.id = String(p.id);
  c.append(el("h3", null, `Pedido n.º ${p.id} · ${dataTxt(p.criado)}`), el("p", "conta-estado", p.estado_texto));
  const passos = el("ol", "conta-passos");
  passos.setAttribute("aria-label", "Andamento do pedido");
  for (const s of p.passos ?? []) {
    const li = el("li", s.feito ? "feito" : null, s.texto);
    if (s.feito && s.data && s.chave !== "recebido") li.title = dataTxt(s.data, true);
    passos.append(li);
  }
  c.append(passos);
  if (p.data_visita && !p.obra) c.append(el("p", null, `Visita técnica: ${dataTxt(p.data_visita, true)}.`));
  if (p.obra?.data) c.append(el("p", null, `Instalação: ${dataTxt(p.obra.data)}${p.obra.hora ? `, ${p.obra.hora}` : ""}.`));
  if (p.proposta) c.append(blocoProposta(p));
  if (p.resumo) c.append(blocoResumo(p.resumo, p.id));
  c.append(blocoFotos(p));
  return c;
}

function blocoProposta(p) {
  const b = el("section", "conta-proposta");
  b.setAttribute("aria-label", "Proposta");
  b.append(el("h4", null, "A nossa proposta"), el("p", "valor num", `${euro(p.proposta.valor)} + IVA`));
  if (p.proposta.texto) b.append(el("p", null, p.proposta.texto));
  const msg = el("div", "msg", null);
  msg.hidden = true;
  msg.setAttribute("role", "status");
  if (p.proposta.aceite) {
    b.append(el("p", "msg ok", `Aceitou a proposta em ${dataTxt(p.proposta.aceite, true)}. Vamos contactá-lo para marcar a instalação.`));
  } else if (p.pode_aceitar) {
    const botao = el("button", "btn", "Aceito a proposta");
    botao.type = "button";
    botao.id = `aceitar-${p.id}`;
    botao.addEventListener("click", () => confirmarAceitar(p, b, botao, msg));
    b.append(el("p", "ajuda", "Sem pagamento agora. Ao aceitar, registamos a data e a hora e marcamos a instalação consigo."), botao, msg);
  }
  return b;
}

function confirmarAceitar(p, b, botao, msg) {
  if (b.querySelector(".confirmar")) return;
  const caixa = el("div", "confirmar msg info");
  caixa.setAttribute("role", "alert");
  caixa.append(el("p", null, `Confirma que aceita a proposta de ${euro(p.proposta.valor)} + IVA?`));
  const sim = el("button", "btn pequeno", "Sim, aceito");
  sim.type = "button";
  sim.id = `aceitar-sim-${p.id}`;
  const nao = el("button", "btn sec pequeno", "Cancelar");
  nao.type = "button";
  const bs = el("div", "form-botoes");
  bs.append(sim, nao);
  caixa.append(bs);
  botao.after(caixa);
  sim.focus();
  nao.addEventListener("click", () => { caixa.remove(); botao.focus(); });
  sim.addEventListener("click", async () => {
    sim.disabled = true;
    try {
      await pedirConta(`pedidos/${p.id}/aceitar`, { corpo: { valor: p.proposta.valor } });
      await carregar();
      mensagem("Proposta aceite. Obrigado! Vamos contactá-lo para marcar a instalação.", "ok");
    } catch (e) {
      caixa.remove();
      msg.textContent = e.message;
      msg.className = "msg erro";
      msg.hidden = false;
      if (e instanceof ErroConta && e.estado === 409) carregar();
    }
  });
}

function blocoResumo(r, id) {
  const b = el("details", "conta-resumo");
  b.open = resumosAbertos.has(id);
  b.addEventListener("toggle", () => { if (b.open) resumosAbertos.add(id); else resumosAbertos.delete(id); });
  b.append(el("summary", null, "A simulação que enviou"));
  const dl = el("dl", "dados-simples");
  const linha = (k, v) => { if (v) { dl.append(el("dt", null, k), el("dd", null, v)); } };
  linha("Casa", r.casa);
  linha("Localidade", r.localidade);
  linha("Divisões", r.divisoes ? String(r.divisoes) : null);
  linha("Estimativa", r.estimativa ? `${euro(r.estimativa.min)} – ${euro(r.estimativa.max)} (com IVA; o valor final é o da proposta)` : null);
  linha("Plano mensal sugerido", r.plano);
  b.append(dl);
  if (r.inclui?.length) {
    const ul = el("ul");
    for (const t of r.inclui) ul.append(el("li", null, t));
    b.append(el("p", null, "O que inclui:"), ul);
  }
  return b;
}

function blocoFotos(p) {
  const b = el("section", "conta-fotos-bloco");
  b.append(el("h4", null, `Fotos (${p.fotos.length})`));
  const msg = el("div", "msg", null);
  msg.hidden = true;
  msg.setAttribute("role", "status");
  const aviso = (t, tipo = "erro") => { msg.textContent = t ?? ""; msg.className = `msg ${tipo}`; msg.hidden = !t; };
  if (p.fotos.length) {
    const ul = el("ul", "conta-fotos");
    for (const f of p.fotos) {
      const li = el("li");
      const fig = el("figure");
      const img = el("img");
      img.src = urlDoPainel(f.url);
      img.alt = f.legenda || "Foto do pedido";
      img.loading = "lazy";
      fig.append(img, el("figcaption", null, f.legenda || (f.chave === "quadro" ? "Quadro elétrico" : "Foto")));
      li.append(fig);
      if (p.pode_fotos) li.append(botaoFoto("Trocar", `trocar-${f.id}`, `Trocar a foto: ${f.legenda || (f.chave === "quadro" ? "Quadro elétrico" : "Foto")}`, (ficheiro) => enviarFoto(p, f.chave, f.legenda, ficheiro, aviso)));
      ul.append(li);
    }
    b.append(ul);
  } else {
    b.append(el("p", "ajuda", "Ainda sem fotos."));
  }
  if (p.pode_fotos && p.fotos.length < (p.fotos_max ?? 40)) {
    b.append(el("p", "ajuda", "Pode acrescentar fotos (do quadro elétrico, das divisões, de onde quer os aparelhos) até o pedido ser aceite."),
      botaoFoto("Acrescentar foto", `acrescentar-${p.id}`, null, (ficheiro) => enviarFoto(p, `conta${Date.now().toString(36)}:outra`, "Foto acrescentada na conta", ficheiro, aviso)));
  }
  b.append(msg);
  return b;
}

/** Botão (com teclado) que abre a câmara/galeria por um input file escondido. `rotulo`: nome acessível mais claro. */
function botaoFoto(texto, id, rotulo, aoEscolher) {
  const b = el("button", "btn sec pequeno", texto);
  b.type = "button";
  if (rotulo) b.setAttribute("aria-label", rotulo);
  const i = document.createElement("input");
  i.type = "file";
  i.accept = "image/*";
  i.id = id;
  i.hidden = true;
  i.addEventListener("change", () => { const f = i.files?.[0]; i.value = ""; if (f) aoEscolher(f); });
  b.addEventListener("click", () => i.click());
  const s = el("span");
  s.append(b, i);
  return s;
}

async function enviarFoto(p, chave, legenda, ficheiro, aviso) {
  aviso("A preparar a foto…", "info");
  let foto;
  try { foto = await reduzirFoto(ficheiro); } catch (e) {
    aviso(e instanceof ErroFoto ? e.message : "Não foi possível abrir esta foto. Experimente outra.");
    return;
  }
  if (foto.blob.size > MAX_BYTES_FOTO) { aviso("A foto é demasiado grande (máx. 1 MB)."); return; }
  aviso("A enviar a foto…", "info");
  try {
    await pedirConta(`pedidos/${p.id}/fotos`, {
      bruto: foto.blob,
      cabecalhos: { "Content-Type": foto.blob.type === "image/png" ? "image/png" : "image/jpeg", "X-Foto-Chave": chave, "X-Foto-Legenda": legendaCabecalho(legenda ?? "") },
    });
    await carregar();
    mensagem("Foto enviada.", "ok");
  } catch (e) {
    aviso(e.message);
  }
}

$("ano").textContent = String(new Date().getFullYear());
bloco.atualizar();
