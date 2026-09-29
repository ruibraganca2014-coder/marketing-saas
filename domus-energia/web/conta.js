// A minha conta (docs/CONTA-CLIENTE.md): entrar/criar conta, e com sessão (email confirmado) os pedidos da
// conta — estado (recebido → visita → proposta → aceite → instalação), a simulação enviada (resumo simples),
// as fotos (acrescentar/trocar enquanto o pedido não está aceite nem convertido), a proposta com "Aceito a
// proposta", a simulação por acabar (retomar no simulador) e a ligação à área da casa (depois da instalação).
// Pagamentos (docs/PAGAMENTOS-PEDIDO.md): estado e recibo de cada fase (19 €, sinal, restante), aceitar a proposta
// com o plano mensal e pagar o sinal, "Pagar o restante" depois da obra, e o relatório técnico (depois de revisto).
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
const PLANOS = { base: ["Base", 4.99], conforto: ["Conforto", 9.99], premium: ["Premium", 19.99] };
// Regresso de um pagamento (Stripe ou página simulada): conta.html?pagamento=<ref>[&cancelado=1].
const params = new URLSearchParams(location.search);
let regresso = /^pp_[A-Za-z0-9_-]{22}$/.test(params.get("pagamento") ?? "") ? { ref: params.get("pagamento"), cancelado: params.get("cancelado") === "1" } : null;
if (regresso) history.replaceState(null, "", location.pathname);

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

/** Para onde se vai pagar: a página simulada do site ou o Stripe Checkout (nada mais). */
function irPagar(pagamento) {
  const url = pagamento?.url;
  if (typeof url === "string" && (/^pagamento-simulado\.html\?ref=pp_[A-Za-z0-9_-]{22}$/.test(url) || url.startsWith("https://checkout.stripe.com/"))) {
    location.assign(url);
    return true;
  }
  return false;
}

/** Depois de voltar de um pagamento: confirma no servidor e diz o que aconteceu. */
async function mostrarRegresso() {
  const r0 = regresso;
  regresso = null;
  let r;
  try { r = await pedirConta(`pagamentos/${r0.ref}${r0.cancelado ? "?cancelado=1" : ""}`); } catch (e) { mensagem(e.message); return; }
  const p = r.pagamento;
  if (p.estado === "pago") mensagem(`Pagamento recebido: ${euro(p.valor)} — ${p.descricao}. Referência ${p.ref}.${p.modo === "simulado" ? " (Simulação: não foi cobrado nada.)" : ""}`, "ok");
  else if (p.estado === "pendente") mensagem("O pagamento ainda não está confirmado. Se pagou por Multibanco, pode demorar; o estado atualiza-se aqui.", "info");
  else if (p.estado === "falhado") mensagem("O pagamento não foi concluído. Não foi cobrado nada: pode tentar de novo.");
  else mensagem("Cancelou o pagamento. Não foi cobrado nada: pode tentar de novo quando quiser.", "info");
}

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
  if (regresso) await mostrarRegresso(); else if ($("conta-msg").classList.contains("erro")) mensagem(null);
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
  if (p.pode_pagar_restante || p.restante?.pago) c.append(blocoRestante(p));
  if (p.relatorio) c.append(blocoRelatorio(p));
  if (p.pagamentos?.length) c.append(blocoPagamentos(p));
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
  if (p.plano) b.append(el("p", null, `Plano mensal escolhido: ${p.plano.nome}. A subscrição começa quando a casa ficar ligada.`));
  if (p.aguarda_sinal) {
    b.append(el("p", "msg info", `Aceitou a proposta em ${dataTxt(p.proposta.aceite, true)}. Falta pagar o sinal (${euro(p.sinal.valor)}) para confirmarmos a instalação.`));
    if (p.pode_pagar_sinal) b.append(botaoPagar(p, "sinal", `Pagar o sinal (${euro(p.sinal.valor)})`, msg), msg);
  } else if (p.proposta.aceite && p.estado === "aceite") {
    b.append(el("p", "msg ok", `Aceitou a proposta em ${dataTxt(p.proposta.aceite, true)}${p.sinal?.pago ? " e pagou o sinal" : ""}. Vamos contactá-lo para marcar a instalação.`));
  } else if (p.pode_aceitar) {
    const sinal = p.sinal && p.sinal.valor > 0 && p.modo ? p.sinal : null;
    const planos = el("fieldset", "conta-planos");
    planos.append(el("legend", null, "Plano mensal (começa quando a casa ficar ligada)"));
    for (const [k, [nome, preco]] of Object.entries(PLANOS)) {
      const l = el("label");
      const i = document.createElement("input");
      i.type = "radio";
      i.name = `plano-${p.id}`;
      i.value = k;
      i.id = `plano-${p.id}-${k}`;
      i.checked = k === (p.plano_sugerido ?? "conforto");
      l.append(i, `${nome} — ${euro(preco)}/mês${k === p.plano_sugerido ? " (sugerido)" : ""}`);
      planos.append(l);
    }
    const botao = el("button", "btn", sinal ? `Aceito a proposta e pago o sinal (${euro(sinal.valor)})` : "Aceito a proposta");
    botao.type = "button";
    botao.id = `aceitar-${p.id}`;
    botao.addEventListener("click", () => confirmarAceitar(p, b, botao, msg, planos));
    const ajuda = sinal
      ? `Sinal: ${sinal.pct} % da proposta${sinal.desconto ? ` menos os ${euro(sinal.desconto)} que já pagou` : ""} = ${euro(sinal.valor)}. O resto paga-se no fim da obra.`
      : "Ao aceitar, registamos a data e a hora e marcamos a instalação consigo.";
    b.append(planos, el("p", "ajuda", ajuda), botao, msg);
  }
  return b;
}

/** Botão que pede ao servidor o pagamento de uma fase (o valor é o do servidor) e vai pagar. */
function botaoPagar(p, fase, texto, msg) {
  const botao = el("button", "btn", texto);
  botao.type = "button";
  botao.id = `pagar-${fase}-${p.id}`;
  botao.addEventListener("click", async () => {
    botao.disabled = true;
    try {
      const r = await pedirConta(`pedidos/${p.id}/pagar`, { corpo: { fase } });
      if (!irPagar(r.pagamento)) throw new Error("Não foi possível abrir o pagamento. Tente de novo.");
    } catch (e) {
      botao.disabled = false;
      msg.textContent = e.message;
      msg.className = "msg erro";
      msg.hidden = false;
      if (e instanceof ErroConta && e.estado === 409) carregar();
    }
  });
  return botao;
}

function blocoRestante(p) {
  const b = el("section", "conta-proposta");
  b.setAttribute("aria-label", "Fim da obra");
  const msg = el("div", "msg", null);
  msg.hidden = true;
  msg.setAttribute("role", "status");
  b.append(el("h4", null, "Fim da obra"));
  if (p.restante?.pago) b.append(el("p", "msg ok", "A obra está paga. Obrigado!"));
  else b.append(el("p", null, `A obra está concluída. Falta pagar o restante: ${euro(p.restante.valor)}.`), botaoPagar(p, "restante", `Pagar o restante (${euro(p.restante.valor)})`, msg), msg);
  return b;
}

function blocoPagamentos(p) {
  const b = el("section", "conta-pagamentos");
  b.setAttribute("aria-label", "Pagamentos");
  b.append(el("h4", null, "Pagamentos"));
  const ul = el("ul");
  for (const x of p.pagamentos) {
    const li = el("li");
    li.dataset.fase = x.fase;
    li.append(el("span", null, `${x.fase_texto}: ${euro(x.valor)}`), el("span", x.estado === "pago" ? "estado-pago" : "estado-outro", x.estado_texto));
    if (x.recibo) {
      li.append(el("span", "conta-recibo", `Recibo — ${dataTxt(x.recibo.data, true)} · ${euro(x.recibo.valor)} · ${x.recibo.descricao} · Ref. ${x.recibo.referencia}${x.recibo.simulado ? " · SIMULAÇÃO (não cobrado)" : ""}`));
    }
    ul.append(li);
  }
  b.append(ul);
  return b;
}

function blocoRelatorio(p) {
  const b = el("section", "conta-relatorio");
  b.setAttribute("aria-label", "Relatório técnico");
  b.append(el("h4", null, "Relatório técnico"));
  if (p.relatorio === "em_revisao") {
    b.append(el("p", null, "Relatório em revisão (até 24 h). Avisamos por email quando estiver pronto."));
    return b;
  }
  const zona = el("div", "relatorio-cliente");
  const ver = el("button", "btn sec pequeno nao-imprimir", "Ver o relatório técnico");
  ver.type = "button";
  ver.id = `relatorio-${p.id}`;
  const imprimir = el("button", "btn sec pequeno nao-imprimir", "Descarregar (imprimir / PDF)");
  imprimir.type = "button";
  imprimir.hidden = true;
  imprimir.addEventListener("click", () => {
    const cartao = b.closest(".conta-pedido");
    cartao?.classList.add("a-imprimir");
    document.body.classList.add("imprimir-relatorio");
    const antes = document.title;
    document.title = `Relatório técnico — pedido ${p.id}`;
    const fim = () => { document.body.classList.remove("imprimir-relatorio"); cartao?.classList.remove("a-imprimir"); document.title = antes; };
    addEventListener("afterprint", fim, { once: true });
    window.print();
  });
  ver.addEventListener("click", async () => {
    ver.disabled = true;
    try {
      const r = await pedirConta(`pedidos/${p.id}/relatorio`);
      zona.replaceChildren(...desenharRelatorio(r.relatorio));
      ver.hidden = true;
      imprimir.hidden = false;
    } catch (e) {
      zona.replaceChildren(el("p", "msg erro", e.message));
      ver.disabled = false;
    }
  });
  b.append(el("p", "ajuda nao-imprimir", "Revisto pela nossa equipa: o trabalho, as divisões, o material e o preço de cada divisão."), ver, imprimir, zona);
  return b;
}

function tabelaMaterial(linhas) {
  const t = el("table");
  const cab = el("tr");
  cab.append(el("th", null, "Material"), el("th", "num", "Qtd."), el("th", "num", "Preço"), el("th", "num", "Total"));
  const thead = el("thead");
  thead.append(cab);
  const tb = el("tbody");
  for (const l of linhas) {
    const tr = el("tr");
    tr.append(el("td", null, l.artigo), el("td", "num", String(l.quantidade)), el("td", "num", l.preco_unitario == null ? "—" : euro(l.preco_unitario)), el("td", "num", l.total == null ? "—" : euro(l.total)));
    tb.append(tr);
  }
  t.append(thead, tb);
  return t;
}

function desenharRelatorio(r) {
  const out = [];
  for (const d of r.divisoes) {
    out.push(el("h5", null, `${d.nome} — ${euro(d.total)}`));
    if (d.trabalho.length) {
      const ul = el("ul");
      for (const t of d.trabalho) ul.append(el("li", null, t));
      out.push(ul);
    }
    if (d.material.length) out.push(tabelaMaterial(d.material));
  }
  if (r.geral.material.length) out.push(el("h5", null, `${r.geral.titulo} — ${euro(r.geral.total)}`), tabelaMaterial(r.geral.material));
  if (r.mao_obra) out.push(el("p", null, `Mão de obra${r.mao_obra.horas ? ` (cerca de ${r.mao_obra.horas} h)` : ""}: ${euro(r.mao_obra.valor)}`));
  if (r.deslocacao != null) out.push(el("p", null, `Deslocação: ${euro(r.deslocacao)}`));
  out.push(el("p", "valor num", `Total estimado: ${euro(r.total)}`), el("p", "ajuda", r.nota));
  return out;
}

function confirmarAceitar(p, b, botao, msg, planos) {
  if (b.querySelector(".confirmar")) return;
  const plano = planos.querySelector("input:checked")?.value ?? null;
  const caixa = el("div", "confirmar msg info");
  caixa.setAttribute("role", "alert");
  const sinal = p.sinal && p.sinal.valor > 0 ? p.sinal : null;
  caixa.append(el("p", null, `Confirma que aceita a proposta de ${euro(p.proposta.valor)} + IVA, com o plano ${PLANOS[plano]?.[0] ?? ""}?${sinal ? ` A seguir paga o sinal de ${euro(sinal.valor)}.` : ""}`));
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
      const r = await pedirConta(`pedidos/${p.id}/aceitar`, { corpo: { valor: p.proposta.valor, plano } });
      if (r?.pagamento && irPagar(r.pagamento)) return;
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
