// A minha conta (docs/CONTA-CLIENTE.md): entrar/criar conta, e com sessão (email confirmado) os pedidos da
// conta — estado (recebido → visita → proposta → aceite → instalação), a simulação enviada (resumo simples),
// as fotos (acrescentar/trocar enquanto o pedido não está aceite nem convertido), a proposta com "Aceito a
// proposta", a simulação por acabar (retomar no simulador) e a ligação à área da casa (depois da instalação).
// Pagamentos (docs/PAGAMENTOS-PEDIDO.md), fase 3: o relatório básico (grátis, logo ao enviar); comprar o relatório
// pormenorizado (revisto antes de o vermos) e a visita técnica (a data aparece quando a marcarmos); estado e recibo de
// cada pagamento; aceitar a proposta com o plano mensal e pagar o sinal (menos o que já pagou), e o restante no fim.
// Fase 4, ronda 3: "O trabalho ficou concluído?" (Sim com 1 a 5 estrelas / Não com o que falta) e a visita sem defeito.
// Emails automáticos (docs/EMAILS-AUTOMATICOS.md): "Como correu?" (1 a 5 estrelas depois da obra) e o convite do Google.
import { criarBlocoConta, pedirConta, urlDoPainel, ErroConta, faixaDemonstracao, marcarSessao } from "./conta-comum.js";
import { reduzirFoto, ErroFoto, legendaCabecalho, MAX_BYTES_FOTO } from "./simulador/fotos.js";
import { formatarEuroRedondo, textoDias } from "./simulador/preco.js";
import { seccaoTecnica } from "./simulador/simbolos.js";
import { desenharQuadroCliente } from "./simulador/quadro-desenho.js";
import { confirmarEmDoisToques } from "./confirmar.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const euro = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" }).format(v);   // "1 120,00 €"
/** "19,00 € (15,45 € + IVA 3,55 €)" — um pagamento (ou recibo) com a base e o IVA, quando o servidor os dá. */
const comIva = (x) => (x?.base != null && x?.iva != null ? `${euro(x.valor)} (${euro(x.base)} + IVA ${euro(x.iva)})` : euro(x?.valor ?? 0));
const pctTxt = (v) => `${String(v).replace(".", ",")} %`;
const dataTxt = (v, hora = false) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-PT", hora ? { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" });
};

let ctrl = null;
let emailDaConta = "";
let casaGuardada = false;   // a casa já está descrita e guardada na conta (o convite da caixa do topo muda)
const resumosAbertos = new Set(); // pedidos com "A simulação que enviou" aberto (sobrevive ao carregar())
// Regresso de um pagamento (Stripe ou página simulada): conta.html?pagamento=<ref>[&cancelado=1].
const params = new URLSearchParams(location.search);
let regresso = /^pp_[A-Za-z0-9_-]{22}$/.test(params.get("pagamento") ?? "") ? { ref: params.get("pagamento"), cancelado: params.get("cancelado") === "1" } : null;
if (regresso) history.replaceState(null, "", location.pathname);

const bloco = criarBlocoConta($("conta-bloco"), {
  prefixo: "conta",
  texto: { fora: "Entre para acompanhar o seu pedido de orçamento. Se ainda não tem conta, cria-se aqui, só com o email." },
  aoMudar(eu) {
    faixaDemonstracao(Boolean(eu?.pagamentos?.demonstracao));
    const dentro = Boolean(eu?.conta?.confirmado);
    $("conta-dentro").hidden = !dentro;
    if (!dentro) { $("conta-pedidos").replaceChildren(); $("conta-agora").hidden = true; mensagem(null); return; }
    casaGuardada = Boolean(eu.simulacao_atualizada) && eu.simulacao_tipo === "casa";
    $("conta-casa").hidden = !eu.tem_casa;
    emailDaConta = eu.conta.email;
    desenharSenha(Boolean(eu.conta.tem_password));
    preencherDados(eu.conta);
    desenharCasa(eu);
    desenharCasas();
    const r = $("conta-retomar");
    r.replaceChildren();
    r.hidden = !eu.simulacao_atualizada;
    if (eu.simulacao_atualizada && eu.simulacao_tipo === "casa") {
      // Só a casa guardada (o pedido já foi enviado, ou a descrição da casa está acabada): não é uma simulação por acabar.
      const a = el("a", null, "Pedir um serviço");
      a.href = "simulador.html?caso=servico";
      a.id = "conta-continuar";
      r.append("A sua casa está guardada na conta: não precisa de a descrever outra vez. ", a, ".");
    } else if (eu.simulacao_atualizada) {
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
  if (p.estado === "pago") mensagem(`Pagamento recebido: ${comIva(p)} (${p.descricao}). Referência ${p.ref}.${p.modo === "simulado" ? " (Simulação: não foi cobrado nada.)" : ""}`, "ok");
  else if (p.estado === "pendente") mensagem("O pagamento ainda não está confirmado. Se pagou por Multibanco, pode demorar; o estado atualiza-se aqui.", "info");
  else if (p.estado === "falhado") mensagem("O pagamento não foi concluído. Não foi cobrado nada: pode tentar de novo.");
  else mensagem("Cancelou o pagamento. Não foi cobrado nada: pode tentar de novo quando quiser.", "info");
}

// "conta-pedidos-msg": a mensagem da página (por cima dos pedidos); "conta-msg" é a do bloco de entrar (conta-comum.js).
function mensagem(t, tipo = "erro") {
  const m = $("conta-pedidos-msg");
  m.textContent = t ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !t;
}

async function carregar() {
  ctrl?.abort();
  ctrl = new AbortController();
  const zona = $("conta-pedidos");
  // Ao redesenhar depois de uma ação (pagar, aceitar, enviar uma foto) os cartões ficam no ecrã até chegarem os novos:
  // com "A carregar…" no lugar deles a página encolhia e o cliente perdia o sítio onde estava.
  if (!zona.querySelector(".conta-pedido")) zona.replaceChildren(el("p", "ajuda", "A carregar…"));
  let r;
  try { r = await pedirConta("pedidos", { sinal: ctrl.signal }); } catch (e) {
    if (e?.name === "AbortError") return;
    if (e instanceof ErroConta && e.estado === 401) { bloco.atualizar(); return; }
    zona.replaceChildren();
    $("conta-agora").hidden = true;
    mensagem(e.message);
    return;
  }
  const voltou = Boolean(regresso);
  if (regresso) await mostrarRegresso(); else if ($("conta-pedidos-msg").classList.contains("erro")) mensagem(null);
  const pedidos = Array.isArray(r?.pedidos) ? r.pedidos : [];
  // O aviso da lista de espera só enquanto um pedido ainda espera pela proposta (teste de 2026-10-14; o servidor decide).
  if (window.DOMUS?.listaEspera?.ativa) $("conta-espera").hidden = r?.aviso_espera === false;
  if (!pedidos.length) {
    const p = el("p", "vazio", `Ainda não há pedidos ${variasCasas ? "nesta casa" : "nesta conta"}. Quando simular e enviar, aparecem aqui com o relatório e o andamento. `);
    const a = el("a", null, "Simular orçamento");
    a.href = "simulador.html";
    p.append(a);
    zona.replaceChildren(p);
    desenharAgora(pedidos);
    avisoOutraCasa(r?.noutras);
    return;
  }
  // O foco e o sítio do ecrã sobrevivem ao redesenho: o que estava focado (por exemplo o botão em que carregou) volta
  // a ficar focado se ainda existir, sem a página saltar.
  const focado = document.activeElement?.id && zona.contains(document.activeElement) ? document.activeElement.id : null;
  zona.replaceChildren(...pedidos.map(cartaoPedido));
  desenharAgora(pedidos);
  if (focado) document.getElementById(focado)?.focus({ preventScroll: true });
  // Ao voltar de um pagamento, a mensagem ("Pagamento recebido…") fica por cima dos pedidos, abaixo da caixa do topo e
  // das casas: no telemóvel não se via sem a ir buscar.
  if (voltou) $("conta-pedidos-msg").scrollIntoView({ block: "center" });
  // Veio da pré-visualização da Área de cliente (conta.html#pedido-<id>): mostra esse pedido (uma vez).
  const alvo = /^#pedido-\d+$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
  if (alvo && !alvoMostrado) { alvoMostrado = true; alvo.scrollIntoView({ block: "start" }); }
  avisoOutraCasa(r?.noutras);
}
let alvoMostrado = false;

/**
 * O pedido foi devolvido pela empresa para corrigir (decisão do dono, 2026-10-10): o que falta e o botão "Já corrigi"
 * (POST pedidos/:id/corrigido), que o devolve à empresa. As fotos trocam-se mais abaixo, no próprio pedido.
 */
/** "Não aceito" (decisão do dono, 2026-10-10): o motivo (obrigatório), um texto opcional e a confirmação → POST pedidos/:id/recusar. */
function caixaRecusar(p) {
  const caixa = el("div", "conta-recusar");
  const abrir = el("button", "link-botao", "Não aceito esta proposta");
  abrir.type = "button";
  abrir.id = `recusar-${p.id}`;
  const form = el("div", "conta-recusar-form");
  form.hidden = true;
  const sel = document.createElement("select");
  sel.id = `recusar-motivo-${p.id}`;
  for (const [v, t] of [["", "Escolha o motivo"], ["preco", "O preço"], ["prazo", "O prazo"], ["mudei", "Mudei de ideias"], ["outro", "Outro motivo"]]) { const o = el("option", null, t); o.value = v; sel.append(o); }
  const rot = el("label", null, "Porque não aceita?");
  rot.append(sel);
  const txt = document.createElement("textarea");
  txt.rows = 2;
  txt.maxLength = 500;
  txt.id = `recusar-texto-${p.id}`;
  const rot2 = el("label", null, "Quer dizer mais alguma coisa? (opcional)");
  rot2.append(txt);
  const msg = msgPequena();
  const sim = el("button", "btn sec pequeno", "Confirmar: não aceito");
  sim.type = "button";
  sim.id = `recusar-sim-${p.id}`;
  const nao = el("button", "btn sec pequeno", "Cancelar");
  nao.type = "button";
  abrir.addEventListener("click", () => { form.hidden = false; abrir.hidden = true; sel.focus(); });
  nao.addEventListener("click", () => { form.hidden = true; abrir.hidden = false; abrir.focus(); });
  sim.addEventListener("click", async () => {
    if (!sel.value) { msg.textContent = "Escolha o motivo."; msg.className = "msg erro"; msg.hidden = false; sel.focus(); return; }
    sim.disabled = true;
    try {
      await pedirConta(`pedidos/${p.id}/recusar`, { corpo: { motivo: sel.value, texto: txt.value } });
      await carregar();
    } catch (e) {
      sim.disabled = false;
      msg.textContent = e?.message || "Não foi possível. Tente de novo.";
      msg.className = "msg erro";
      msg.hidden = false;
    }
  });
  const g = el("div", "form-botoes");
  g.append(sim, nao);
  form.append(rot, rot2, msg, g);
  caixa.append(abrir, form);
  return caixa;
}
/**
 * Trabalho a mais (decisão do dono, 2026-10-11): no local apareceu trabalho que não estava na proposta. A empresa diz o
 * que é e quanto custa; o cliente aceita ou não (POST pedidos/:id/extras/:extra/aceitar | recusar). Sem resposta, esse
 * trabalho não é feito. Se aceitar, o valor soma ao que paga no fim da obra. Depois de responder mostra o que respondeu.
 */
function blocoExtras(p) {
  const b = el("section", "conta-proposta conta-extras");
  b.id = `extras-${p.id}`;
  b.setAttribute("aria-label", "Trabalho a mais");
  b.append(el("h4", null, "Trabalho a mais"));
  for (const x of p.extras) {
    b.append(el("p", null, x.descricao), el("p", "valor num", `${euro(x.valor)} + IVA (${euro(x.valor_iva)} com IVA)`));
    if (x.estado === "aceite") { b.append(el("p", "msg ok", `Aceitou em ${dataTxt(x.quando, true)}. Este valor soma ao que paga no fim da obra.`)); continue; }
    if (x.estado === "recusado") { b.append(el("p", "msg info", `Não aceitou em ${dataTxt(x.quando, true)}. Este trabalho não é feito e o valor da obra não muda.`)); continue; }
    b.append(el("p", "ajuda", "No local encontrámos trabalho que não estava na proposta. Sem a sua resposta, este trabalho não é feito."),
      el("p", "ajuda", "Este valor soma ao que paga no fim da obra."));
    const msg = msgPequena();
    const erro = (e) => { msg.textContent = e?.message || "Não foi possível. Tente de novo."; msg.className = "msg erro"; msg.hidden = false; };
    const aceito = el("button", "btn pequeno", "Aceito");
    aceito.type = "button";
    aceito.id = `extra-aceitar-${x.id}`;
    const naoAceito = el("button", "btn sec pequeno", "Não aceito");
    naoAceito.type = "button";
    naoAceito.id = `extra-recusar-${x.id}`;
    // "Não aceito" abre a caixa de texto (opcional) e a confirmação, como na proposta.
    const form = el("div", "conta-recusar-form");
    form.hidden = true;
    const txt = document.createElement("textarea");
    txt.rows = 2;
    txt.maxLength = 500;
    txt.id = `extra-texto-${x.id}`;
    const rot = el("label", null, "Quer dizer porquê? (opcional)");
    rot.append(txt);
    const sim = el("button", "btn sec pequeno", "Confirmar: não aceito");
    sim.type = "button";
    sim.id = `extra-recusar-sim-${x.id}`;
    const cancelar = el("button", "btn sec pequeno", "Cancelar");
    cancelar.type = "button";
    const g = el("div", "form-botoes");
    g.append(aceito, naoAceito);
    const g2 = el("div", "form-botoes");
    g2.append(sim, cancelar);
    form.append(rot, g2);
    const responder = async (botao, caminho, corpo) => {
      botao.disabled = true;
      msg.hidden = true;
      try {
        await pedirConta(`pedidos/${p.id}/extras/${x.id}/${caminho}`, { corpo });
        await carregar();
      } catch (e) {
        botao.disabled = false;
        erro(e);
        if (e instanceof ErroConta && e.estado === 409) carregar();
      }
    };
    // "Aceito" em dois toques (decisão do dono, 2026-10-11): é dinheiro a mais, e um toque sem querer não se desfaz.
    confirmarEmDoisToques(aceito, `Confirmar: aceito pagar ${euro(x.valor_iva)}?`, () => responder(aceito, "aceitar", {}));
    naoAceito.addEventListener("click", () => { form.hidden = false; g.hidden = true; txt.focus(); });
    cancelar.addEventListener("click", () => { form.hidden = true; g.hidden = false; naoAceito.focus(); });
    sim.addEventListener("click", () => responder(sim, "recusar", { texto: txt.value }));
    b.append(g, form, msg);
  }
  return b;
}
/**
 * Obra parada por segurança (decisão do dono, 2026-10-11): o que se encontrou impede uma instalação segura e a obra não
 * avança. Mostra o motivo e a conta do sinal — sinal pago, material já encomendado, trabalho já feito e o que se devolve
 * —, como o email que o cliente recebeu. A devolução por transferência (pagou por Multibanco) pede o IBAN logo abaixo.
 */
function blocoObraParada(p) {
  const x = p.obra_parada;
  const b = el("section", "conta-proposta conta-obra-parada");
  b.id = `obra-parada-${p.id}`;
  b.setAttribute("aria-label", "Obra parada por segurança");
  b.append(el("h4", null, "A obra não pode avançar em segurança"), el("p", null, x.motivo));
  const dl = el("dl", "dados-simples conta-partes");
  for (const [k, v] of [["Sinal pago", x.sinal], ["Material já encomendado", x.material], ["Trabalho já feito", x.trabalho], ["A devolver", x.devolver]]) dl.append(el("dt", null, k), el("dd", "num", euro(v)));
  b.append(dl);
  b.append(el("p", x.devolver > 0 ? "msg ok" : "msg info", !(x.devolver > 0) ? "O material já encomendado e o trabalho já feito ficam pelo valor do sinal: não há valor a devolver."
    : x.manual ? `Como pagou por referência Multibanco, devolvemos ${euro(x.devolver)} por transferência bancária: indique o IBAN abaixo.`
      : `Devolvemos ${euro(x.devolver)} para o mesmo meio de pagamento (até 14 dias)${x.simulado ? " (SIMULAÇÃO: não foi cobrado nem devolvido nada)" : ""}.`));
  b.append(el("p", "ajuda", "Se tiver dúvidas, responda ao email que lhe enviámos ou ligue-nos."));
  return b;
}
function blocoCorrecao(p) {
  const b = el("section", "msg info conta-correcao");
  b.id = `correcao-${p.id}`;
  const msg = msgPequena();
  const botao = el("button", "btn pequeno", "Já corrigi");
  botao.type = "button";
  botao.id = `corrigido-${p.id}`;
  botao.addEventListener("click", async () => {
    botao.disabled = true;
    try {
      await pedirConta(`pedidos/${p.id}/corrigido`, { corpo: {} });
      await carregar();
    } catch (e) {
      botao.disabled = false;
      msg.textContent = e?.message || "Não foi possível. Tente de novo.";
      msg.className = "msg erro";
      msg.hidden = false;
    }
  });
  const g = el("div", "form-botoes");
  g.append(botao);
  b.append(el("strong", null, "Falta corrigir antes de avançarmos:"), el("p", null, p.correcao.nota),
    el("p", "ajuda", "Pode trocar ou juntar fotos mais abaixo, neste pedido, ou responder na conversa. Quando estiver, carregue em \"Já corrigi\"."), g, msg);
  return b;
}

// ---- "O que tenho de fazer agora" e o pedido em secções (decisão do dono, 2026-10-13). Só arrumam o que o servidor já
// devolve em GET /api/conta/pedidos: quem paga, aceita ou responde continuam a ser os botões de cada bloco.
const forte = (t) => el("strong", "num", t);
/** "quinta-feira, 15 de outubro" ou, com `hora`, "quinta-feira, 15 de outubro, às 10:00": as datas marcadas, por extenso. */
const diaTxt = (v, hora = false) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const dia = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return hora ? `${dia}, às ${d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : dia;
};
/** A data marcada da obra já passou (e a obra está por dar como concluída). */
const obraPassou = (p) => Boolean(p.obra?.data) && new Date(`${p.obra.data}T${p.obra.hora || "23:59"}`) < new Date();
/** Uma devolução por transferência ainda à espera do IBAN do cliente (blocoDevolucao). */
const pedeIban = (d) => !["devolvido", "por_fazer"].includes(d.estado);

/**
 * O passo que depende do cliente neste pedido, ou null. A ordem é a prioridade que o dono escolheu: corrigir o pedido
 * devolvido, aceitar a proposta, pagar o sinal, responder ao trabalho a mais, confirmar o trabalho, pagar o restante e,
 * por fim, a visita sem defeito por pagar e a devolução à espera do IBAN. `sec` é a secção do cartão que tem o botão
 * verdadeiro e `alvo` o id dele: a caixa do topo só leva lá (irPara), não paga nem aceita.
 */
function acaoDoPedido(p) {
  const onde = `Pedido n.º ${p.id}`;
  if (p.correcao) {
    const quadro = faltaFotoQuadro(p);
    return { prio: 1, chave: "corrigir", tipo: "aviso", curto: "falta corrigir um pormenor", rotulo: "Falta corrigir um pormenor", grande: "Falta corrigir o pedido antes de avançarmos",
      linhas: [p.correcao.nota ? { cls: "citacao", t: `«${p.correcao.nota}»` } : null, quadro ? "Falta a foto do quadro elétrico, com a porta aberta." : "Quando estiver, carregue em \"Já corrigi\"."], onde,
      botao: quadro ? "Juntar a foto do quadro elétrico" : "Ver o que falta", sec: quadro ? "fotos" : null, alvo: quadro ? `quadro-${p.id}` : `correcao-${p.id}` };
  }
  if (p.pode_aceitar && p.proposta) {
    return { prio: 2, chave: "aceitar", curto: "proposta por aceitar", rotulo: "Proposta por aceitar", grande: p.proposta_iva ? [forte(euro(p.proposta_iva.total)), " com IVA"] : [forte(euro(p.proposta.valor)), " + IVA"],
      linhas: ["A sua proposta está pronta. Veja-a e diga se aceita."], onde, botao: "Ver e aceitar a proposta", sec: "proposta", alvo: `aceitar-${p.id}` };
  }
  if (p.aguarda_sinal && p.pode_pagar_sinal) {
    return { prio: 3, chave: "sinal", curto: "falta pagar o sinal", rotulo: "Falta pagar o sinal", grande: [forte(euro(p.sinal.valor)), " com IVA"],
      linhas: [precoDefinitivo(p) ? "Aceitou a proposta. Com o sinal pago, marcamos a visita consigo." : "Aceitou a proposta. Com o sinal pago, confirmamos a instalação."], onde,
      botao: "Ver e pagar o sinal", sec: "proposta", alvo: `pagar-sinal-${p.id}` };
  }
  const extra = (p.extras ?? []).find((x) => x.estado === "enviado");
  if (extra) {
    return { prio: 4, chave: `extra-${extra.id}`, curto: "trabalho a mais por responder", rotulo: "Trabalho a mais por responder", grande: [forte(euro(extra.valor_iva)), " com IVA"],
      linhas: [{ cls: "citacao", t: extra.descricao }, "Diga se aceita. Sem a sua resposta, este trabalho não é feito."], onde, botao: "Ver e responder", sec: "extras", alvo: `extra-aceitar-${extra.id}` };
  }
  if (p.confirmacao?.estado === "por_confirmar") {
    return { prio: 5, chave: "confirmar", curto: "falta confirmar o trabalho", rotulo: "Falta a sua confirmação", grande: "O trabalho ficou concluído?",
      linhas: [["Pode responder até ", forte(dataTxt(p.confirmacao.prazo)), ". Sem resposta, fica dado como concluído."]], onde, botao: "Responder", sec: "obra", alvo: `confirmar-sim-${p.id}` };
  }
  if (p.pode_pagar_restante) {
    return { prio: 6, chave: "restante", curto: "falta pagar o restante", rotulo: "Falta pagar o restante", grande: [forte(euro(p.restante.valor)), " com IVA"],
      linhas: ["A obra está concluída."], onde, botao: "Ver e pagar o restante", sec: "obra", alvo: `pagar-restante-${p.id}` };
  }
  if (p.visita_sem_defeito && !p.visita_sem_defeito.paga) {
    return { prio: 7, chave: "visita-sem-defeito", curto: "visita por pagar", rotulo: "Visita por pagar", grande: [forte(euro(p.visita_sem_defeito.valor)), " com IVA"],
      linhas: ["Voltámos ao trabalho e não encontrámos defeito: esta visita é paga."], onde, botao: "Ver e pagar a visita", sec: "obra", alvo: `pagar-visita_sem_defeito-${p.id}` };
  }
  const dev = (p.devolucoes ?? []).find(pedeIban);
  if (dev) {
    return { prio: 7, chave: `iban-${dev.id}`, curto: "devolução à espera do IBAN", rotulo: "Devolução à espera do IBAN", grande: [forte(euro(dev.valor)), " a devolver"],
      linhas: ["Pagou por referência Multibanco: indique o IBAN para fazermos a transferência."], onde, botao: "Indicar o IBAN", sec: "pagamentos", alvo: `dev-iban-${dev.id}` };
  }
  return null;
}

/** Sem nada por fazer: o que está a acontecer no pedido — a data marcada, por extenso, ou o texto de estado do servidor. */
function andamentoDoPedido(p) {
  if (p.data_visita && !p.obra && new Date(p.data_visita) > new Date()) return ["A visita está marcada para ", forte(diaTxt(p.data_visita, true)), "."];
  if (p.obra?.data && !obraFeita(p) && !obraPassou(p) && !["por_confirmar", "contestada"].includes(p.confirmacao?.estado)) {
    return [precoDefinitivo(p) ? "A visita está marcada para " : "A instalação está marcada para ", forte(p.obra.hora ? diaTxt(`${p.obra.data}T${p.obra.hora}`, true) : diaTxt(`${p.obra.data}T12:00`)), "."];
  }
  return [p.estado_texto];
}

/**
 * Leva ao sítio certo de um pedido: abre a secção, mostra o alvo (o botão verdadeiro) e põe-lhe o foco. Um input de
 * ficheiro escondido (as fotos) vale pelo botão que o abre, logo antes dele.
 */
function irPara(id, sec = null, alvoId = null) {
  const cartao = $(`pedido-${id}`);
  if (!cartao) return;
  const d = sec ? cartao.querySelector(`details.sec[data-sec="${sec}"]`) : null;
  if (d) d.open = true;
  let alvo = alvoId ? $(alvoId) : null;
  if (alvo?.type === "file") alvo = alvo.previousElementSibling;
  if (!alvo || !cartao.contains(alvo) || !alvo.getClientRects().length) alvo = d ?? cartao;
  if (!alvo.matches("button, a, input, select, textarea, details")) alvo.tabIndex = -1;
  alvo.scrollIntoView({ block: alvo === d || alvo === cartao ? "start" : "center" });
  (alvo === d ? d.querySelector("summary") : alvo).focus({ preventScroll: true });
}

/**
 * A caixa do topo da conta: o passo mais urgente que depende do cliente, olhando para todos os pedidos da casa aberta
 * (e "e mais N" com ligação aos outros). Sem nada por fazer diz o que está a acontecer; sem pedidos, o convite.
 */
function desenharAgora(pedidos) {
  const caixa = $("conta-agora");
  const titulo = el("h2", "rotulo", "O que tenho de fazer agora");
  titulo.id = "conta-agora-titulo";
  const linha = (cls, t) => { const e = el("p", cls); e.append(...[t].flat()); return e; };
  const botoes = el("div", "form-botoes");
  caixa.hidden = false;
  if (!pedidos.length) {
    const ligar = (texto, href, id, cls) => { const a = el("a", cls, texto); a.href = href; a.id = id; return a; };
    if (casaGuardada) botoes.append(ligar("Pedir um serviço", "simulador.html?caso=servico", "conta-agora-ir", "btn"));
    else botoes.append(ligar(variasCasas ? "Descrever esta casa" : "Descrever a minha casa", "simulador.html", "conta-agora-ir", "btn"), ligar("Pedir um serviço", "simulador.html?caso=servico", "conta-agora-servico", "btn sec"));
    caixa.className = "conta-agora calma";
    caixa.replaceChildren(titulo, linha("grande", variasCasas ? "Ainda não há pedidos nesta casa." : "Ainda não tem pedidos."),
      linha("linha", casaGuardada ? "A sua casa já está guardada na conta: não precisa de a descrever outra vez. Peça um serviço quando quiser."
        : "Descreva a casa (cerca de 7 minutos) e fica com um relatório grátis. Ou peça só um serviço."), botoes);
    return;
  }
  const acoes = pedidos.map((p) => ({ p, a: acaoDoPedido(p) })).filter((x) => x.a).sort((x, y) => x.a.prio - y.a.prio);
  if (!acoes.length) {
    // Nada depende do cliente: dos pedidos em andamento, primeiro o que tem data marcada, depois o que já tem a proposta
    // aceite, depois o mais recente fora da lista de espera, depois o mais recente; com todos fechados, o primeiro da lista.
    const emCurso = pedidos.filter((x) => x.em_andamento);
    const p = emCurso.find((x) => andamentoDoPedido(x).length > 1) ?? emCurso.find((x) => x.estado === "aceite") ?? emCurso.find((x) => !x.lista_espera) ?? emCurso[0] ?? pedidos[0];
    const ver = el("button", "btn sec", "Ver o pedido");
    ver.type = "button";
    ver.id = "conta-agora-ir";
    ver.addEventListener("click", () => irPara(p.id));
    botoes.append(ver);
    const outros = emCurso.filter((x) => x !== p).length;
    caixa.className = "conta-agora calma";
    caixa.replaceChildren(titulo, linha("grande", "Nada, por agora."), linha("linha destaque", andamentoDoPedido(p)),
      linha("linha onde", `Pedido n.º ${p.id}${outros ? ` · tem mais ${outros === 1 ? "1 pedido" : `${outros} pedidos`} em andamento, mais abaixo` : ""}`), botoes);
    return;
  }
  const [{ p, a }, ...outras] = acoes;
  const ir = el("button", "btn", a.botao);
  ir.type = "button";
  ir.id = "conta-agora-ir";
  ir.addEventListener("click", () => irPara(p.id, a.sec, a.alvo));
  botoes.append(ir);
  caixa.className = `conta-agora ${a.tipo ?? ""}`.trim();
  // Um valor (euros) leva antes o que é: "Proposta por aceitar: 840,10 € com IVA".
  caixa.replaceChildren(titulo, linha("grande", Array.isArray(a.grande) ? [el("span", "antes", `${a.rotulo}: `), ...a.grande] : a.grande), ...a.linhas.filter(Boolean).map((l) => (l.cls ? linha(`linha ${l.cls}`, l.t) : linha("linha", l))), linha("linha onde", a.onde), botoes);
  if (outras.length) {
    const mais = el("div", "conta-agora-mais");
    const ul = el("ul");
    for (const o of outras) {
      const b = el("button", "link-botao", `Pedido n.º ${o.p.id}: ${o.a.curto}`);
      b.type = "button";
      b.id = `conta-agora-ir-${o.p.id}`;
      b.addEventListener("click", () => irPara(o.p.id, o.a.sec, o.a.alvo));
      const li = el("li");
      li.append(b);
      ul.append(li);
    }
    mais.append(el("p", "linha", outras.length === 1 ? "E mais 1 pedido à sua espera:" : `E mais ${outras.length} pedidos à sua espera:`), ul);
    caixa.append(mais);
  }
}

// As secções abertas de cada pedido ("<pedido>:<secção>") e a fase em que cada pedido estava no último desenho: a
// página redesenha os cartões depois de cada ação e a secção onde o cliente está não se pode fechar.
const seccoesAbertas = new Map();
const ultimaFase = new Map();
/**
 * Uma secção do pedido que abre e fecha (<details>): o título e um resumo de uma linha no cabeçalho, os blocos por
 * baixo. Sem blocos não há secção. Abre sozinha a da fase em que o pedido está (`fase.sec`), uma vez por fase; daí em
 * diante fica como o cliente a deixou. `fase.destaque`: é a secção com o passo que depende do cliente.
 */
function seccaoPedido(p, fase, chave, titulo, resumo, blocos) {
  const corpo = blocos.flat().filter(Boolean);
  if (!corpo.length) return null;
  const d = el("details", fase?.destaque && fase.sec === chave ? "sec agora" : "sec");
  d.dataset.sec = chave;
  d.id = `sec-${chave}-${p.id}`;
  const k = `${p.id}:${chave}`;
  d.open = (fase?.sec === chave && ultimaFase.get(p.id) !== fase.chave) || (seccoesAbertas.get(k) ?? false);
  seccoesAbertas.set(k, d.open);
  d.addEventListener("toggle", () => seccoesAbertas.set(k, d.open));
  const texto = el("span", "sec-texto");
  texto.append(el("b", null, titulo));
  if (resumo) { const r = el("span", "sec-resumo"); r.append(" · ", ...resumo); texto.append(r); }
  const s = el("summary");
  s.append(texto);
  const cx = el("div", "corpo");
  cx.append(...corpo);
  d.append(s, cx);
  return d;
}

// Os resumos de uma linha dos cabeçalhos das secções (os números em destaque); null: só o título.
function resumoProposta(p) {
  if (!p.proposta) return null;
  const valor = p.proposta_iva ? [forte(euro(p.proposta_iva.total)), " com IVA"] : [forte(euro(p.proposta.valor)), " + IVA"];
  const estado = p.pode_aceitar ? "por aceitar" : p.aguarda_sinal ? "aceite, falta o sinal" : p.proposta.aceite ? "aceite" : null;
  return estado ? [...valor, " · ", estado] : valor;
}
function resumoExtras(p) {
  const quantos = (estado) => (p.extras ?? []).filter((x) => x.estado === estado).length;
  const por = quantos("enviado"), sim = quantos("aceite"), nao = quantos("recusado");
  if (por) return [forte(String(por)), " por responder"];
  return [[sim ? (sim === 1 ? "1 aceite" : `${sim} aceites`) : null, nao ? (nao === 1 ? "1 não aceite" : `${nao} não aceites`) : null].filter(Boolean).join(", ")];
}
function resumoObra(p) {
  const x = p.confirmacao;
  if (x?.estado === "por_confirmar") return ["falta a sua confirmação"];
  if (p.pode_pagar_restante) return ["concluída · falta pagar ", forte(euro(p.restante.valor))];
  if (p.visita_sem_defeito && !p.visita_sem_defeito.paga) return ["visita por pagar: ", forte(euro(p.visita_sem_defeito.valor))];
  if (x?.estado === "contestada") return ["o técnico vai voltar"];
  if (p.avaliacao?.pode) return ["concluída · diga-nos como correu"];
  if (p.restante?.pago) return ["concluída e paga"];
  if (obraFeita(p) || x?.estado === "confirmada") return ["concluída"];
  if (p.data_visita && !p.obra) return ["visita a ", forte(dataTxt(p.data_visita, true))];
  if (p.obra?.data) return [obraPassou(p) ? "data marcada: " : "marcada para ", forte(`${dataTxt(p.obra.data)}${p.obra.hora ? `, ${p.obra.hora}` : ""}`)];
  if (p.obra?.por_agendar && p.obra.estado === "agendada") return ["data por marcar"];
  return null;
}
function resumoPagamentos(p) {
  if ((p.devolucoes ?? []).some(pedeIban)) return ["devolução à espera do IBAN"];
  if (p.restante?.pago) return ["tudo pago"];
  if (p.sinal?.pago && p.restante?.valor > 0) return ["sinal pago, falta ", forte(euro(p.restante.valor))];
  const pagos = (p.pagamentos ?? []).filter((x) => x.estado === "pago").length;
  return pagos ? [pagos === 1 ? "1 pagamento feito" : `${pagos} pagamentos feitos`] : null;
}
function resumoRelatorio(p) {
  if (p.relatorio === "disponivel") return ["completo disponível"];
  if (p.relatorio === "em_revisao") return ["completo em revisão"];
  return p.relatorio_basico && !p.compras?.avaria ? ["grátis"] : null;
}

function cartaoPedido(p) {
  const c = el("article", "cartao conta-pedido");
  c.dataset.id = String(p.id);
  c.id = `pedido-${p.id}`;   // "Ver o pedido e o relatório" da pré-visualização da Área de cliente (conta.html#pedido-<id>)
  // O título, o estado e o andamento ficam sempre à vista; em lista de espera o estado vai em destaque.
  c.append(el("h3", null, `Pedido n.º ${p.id} · ${dataTxt(p.criado)}`), el("p", p.lista_espera ? "conta-estado espera" : "conta-estado", p.estado_texto));
  const passos = el("ol", "conta-passos");
  passos.setAttribute("aria-label", "Andamento do pedido");
  // O passo seguinte (o primeiro por fazer de um pedido em andamento) fica em destaque.
  const seguinte = p.em_andamento ? (p.passos ?? []).find((s) => !s.feito) : null;
  for (const s of p.passos ?? []) {
    const li = el("li", s.feito ? "feito" : s === seguinte ? "seguinte" : null, s.texto);
    if (s === seguinte) li.setAttribute("aria-current", "step");
    // Uma data só com o dia (obra marcada sem hora) mostra-se sem hora: lida como data, dava "às 01:00".
    // A obra com data marcada e ainda por fazer (decisão do dono, 2026-10-11): sem o ✓, mas com a data, como nos outros.
    if ((s.feito || s.chave === "obra") && s.data && s.chave !== "recebido") {
      const soDia = /^\d{4}-\d{2}-\d{2}$/.test(s.data);
      li.title = soDia ? dataTxt(`${s.data}T12:00`) : dataTxt(s.data, true);
      // No telemóvel não há "title": a data vê-se, curta, à direita do passo.
      const d = new Date(soDia ? `${s.data}T12:00` : s.data);
      if (!Number.isNaN(d.getTime())) li.append(" ", el("span", "quando", d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" })));
    }
    passos.append(li);
  }
  c.append(passos);
  // Os avisos importantes ficam sempre à vista, fora das secções: pedido devolvido para corrigir, obra parada por
  // segurança, proposta que não aceitou e a visita a que faltou.
  if (p.correcao) c.append(blocoCorrecao(p));
  if (p.obra_parada) c.append(blocoObraParada(p));
  if (p.proposta_recusada && !p.proposta) c.append(el("p", "msg info conta-recusada", `Não aceitou a nossa proposta em ${dataTxt(p.proposta_recusada, true)}. Vamos rever o pedido. Se fizermos uma proposta nova, aparece aqui.`));
  // Faltou à visita (ou ao diagnóstico): não é devolvida nem descontada; para avançar marca e paga uma visita nova.
  // (Com a visita incluída na obra — `incluida`, decisão do dono, 2026-10-11 — já não se vende uma visita nova.)
  if (p.visita_faltou && !p.compras?.visita?.paga && !p.obra) c.append(el("p", "msg info conta-faltou", `Não o encontrámos na visita: a visita não é devolvida nem descontada na obra.${p.compras?.visita?.incluida ? "" : " Para avançar, marque e pague uma visita nova."}`));

  // "Visita e obra": a data da visita técnica (e cancelá-la), a data da obra, a confirmação do trabalho, o fim da obra
  // (pagar o restante), a avaliação, a visita sem defeito e a compra da visita técnica.
  const visita = [];
  if (p.data_visita && !p.obra) visita.push(el("p", "conta-visita-data", `Visita técnica: ${dataTxt(p.data_visita, true)}.`));
  if (p.visita_cancelar && !p.obra) visita.push(blocoCancelarVisita(p));
  // Com a obra feita já não se fala em marcar a instalação nem se mostra a data dela (pedido do teste, 2026-10-11).
  const feita = obraFeita(p);
  // Com o trabalho dado por concluído (falta a confirmação do cliente) a data marcada também já não se mostra.
  const dadoPorConcluido = Boolean(p.obra) && p.confirmacao?.estado === "por_confirmar";
  // Com a data já passada (e a obra por dar como concluída) deixa de se anunciar como "Instalação: <data>".
  if (!feita && !dadoPorConcluido && p.obra?.data) visita.push(el("p", null, `${obraPassou(p) ? "Data marcada" : "Instalação"}: ${dataTxt(p.obra.data)}${p.obra.hora ? `, ${p.obra.hora}` : ""}.`));
  else if (!feita && p.obra?.por_agendar && p.obra.estado === "agendada") visita.push(el("p", "conta-obra-por-agendar", precoDefinitivo(p) ? "Visita e obra: vamos marcar a data consigo." : "Instalação: vamos marcar a data consigo."));
  if (p.confirmacao) visita.push(blocoConfirmacao(p));
  // O pagamento do restante vem logo a seguir à confirmação do trabalho (decisão do dono, 2026-10-11).
  if (p.pode_pagar_restante || p.restante?.pago) visita.push(blocoRestante(p));
  if (p.avaliacao) visita.push(blocoAvaliacao(p));
  if (p.visita_sem_defeito) visita.push(blocoVisitaSemDefeito(p));
  if (p.compras && !p.obra) visita.push(blocoVisita(p));

  // A fase do pedido: o passo que depende do cliente (a secção dele abre sozinha e fica em destaque) ou, sem nenhum, a
  // avaliação por dar ("Como correu?"), que também abre a secção dela.
  const acao = acaoDoPedido(p);
  const fase = acao ? { sec: acao.sec, chave: acao.chave, destaque: true } : p.avaliacao?.pode ? { sec: "obra", chave: "avaliar" } : null;
  const avaria = Boolean(p.compras?.avaria);
  const nf = p.fotos.length;
  const sec = (chave, titulo, resumo, ...blocos) => seccaoPedido(p, fase, chave, titulo, resumo, blocos);
  c.append(...[
    sec("proposta", "Proposta", resumoProposta(p), p.proposta ? blocoProposta(p) : null),
    sec("extras", "Trabalho a mais", p.extras?.length ? resumoExtras(p) : null, p.extras?.length ? blocoExtras(p) : null),
    sec("obra", "Visita e obra", resumoObra(p), visita),
    sec("pagamentos", "Pagamentos", resumoPagamentos(p), (p.devolucoes ?? []).map(blocoDevolucao), p.pagamentos?.length ? blocoPagamentos(p) : null),
    sec("fotos", "Fotos", [nf ? forte(String(nf)) : "ainda sem fotos", faltaFotoQuadro(p) ? " · falta a do quadro elétrico" : ""], nf || p.pode_fotos ? blocoFotos(p) : null),
    sec("mensagens", "Mensagens", p.mensagens?.length ? [forte(String(p.mensagens.length))] : null, p.mensagens?.length ? blocoMensagens(p) : null),
    sec("relatorio", avaria ? "O seu pedido" : "Relatório", resumoRelatorio(p), p.relatorio_basico ? blocoBasico(p) : null, p.relatorio ? blocoRelatorio(p) : null, p.resumo ? blocoResumo(p.resumo, p.id) : null),
  ].filter(Boolean));
  ultimaFase.set(p.id, fase?.chave ?? null);
  return c;
}

/** A obra já está feita: concluída no painel, ou confirmada pelo cliente (o "Sim") à espera da aprovação. */
const obraFeita = (p) => p.obra?.estado === "concluida" || Boolean(p.restante?.obra_concluida) || Boolean(p.restante?.confirmada);

// O preço da proposta é definitivo, salvo surpresa no local (decisão do dono, 2026-10-11): só nos pedidos com planta
// do fluxo das propostas (`compras.visita.incluida`), em "A nossa proposta" e na janela de confirmar a aceitação.
const PRECO_DEFINITIVO = "Este é o preço da obra. Só muda se, no local, a obra for diferente do que a planta e as fotos mostravam: nesse caso dizemos-lhe antes e só avançamos se aceitar.";
/**
 * A frase a seguir a "Aceitou a proposta…" (decisão do dono, 2026-10-11: não fica para trás): por marcar, "Vamos marcar
 * a visita consigo…"; com a visita marcada, a data; com o trabalho dado por concluído ou a obra concluída, nada. No
 * fluxo antigo (a instalação marca-se depois da visita técnica), "Vamos contactá-lo…" só enquanto não há data.
 */
function fraseDaVisita(p) {
  // (Também depois de um "Não" do cliente: o trabalho voltou ao técnico e a data que ficou é a da visita já feita.)
  if (obraFeita(p) || (p.obra && ["por_confirmar", "contestada"].includes(p.confirmacao?.estado))) return "";
  const marcada = p.obra?.data ? (p.obra.hora ? dataTxt(`${p.obra.data}T${p.obra.hora}`, true) : dataTxt(`${p.obra.data}T12:00`)) : null;
  if (!precoDefinitivo(p)) return marcada ? "" : " Vamos contactá-lo para marcar a instalação.";
  return marcada ? ` A visita está marcada para ${marcada}.` : " Vamos marcar a visita consigo. Muitas vezes a obra fica feita nesse dia.";
}
const precoDefinitivo = (p) => Boolean(p.compras?.visita?.incluida);
/** A soma (€) de um campo das idas perdidas confirmadas do pedido: `valor` (sem IVA) ou `valor_iva`. */
const somaIdas = (idas, campo) => Math.round(idas.reduce((s, x) => s + (Number(x[campo]) || 0), 0) * 100) / 100;

function blocoProposta(p) {
  const b = el("section", "conta-proposta");
  b.setAttribute("aria-label", "Proposta");
  // A proposta é sem IVA; o que se paga online inclui-o (decisão do dono).
  const pi = p.proposta_iva;
  b.append(el("h4", null, "A nossa proposta"), el("p", "valor num", `${euro(p.proposta.valor)} + IVA`));
  // O detalhe (decisão 15): mão de obra, material e deslocação, sem IVA; depois o IVA e o total.
  const pp = p.proposta_partes;
  // Trabalho a mais que aceitou (sem IVA): já vai dentro do total com IVA e do restante.
  const tm = p.trabalho_a_mais;
  const idas = p.idas_perdidas ?? [];
  if (pp) {
    const dl = el("dl", "dados-simples conta-partes");
    for (const [k, v] of [["Mão de obra", pp.mao_obra], ["Material", pp.material], ["Deslocação", pp.deslocacao], ...(tm && !p.obra_minima ? [["Trabalho a mais", tm.valor]] : []),
      // Idas perdidas confirmadas (sem IVA): também já vão dentro do total com IVA e do restante.
      ...(idas.length && !p.obra_minima ? [[idas.length === 1 ? "Ida perdida (deslocação)" : "Idas perdidas (deslocação)", somaIdas(idas, "valor")]] : [])]) dl.append(el("dt", null, k), el("dd", "num", euro(v)));
    if (pi && !p.obra_minima) dl.append(el("dt", null, `IVA ${pctTxt(pi.iva_pct)}`), el("dd", "num", euro(pi.iva)), el("dt", null, "Total com IVA"), el("dd", "num", euro(pi.total)));
    b.append(dl);
  }
  // Obra mínima (decisão 9): abaixo dela cobra-se o mínimo e o que pagou antes não é descontado.
  if (p.obra_minima != null) b.append(el("p", "msg info conta-minima", `Obra mínima: ${formatarEuroRedondo(p.obra_minima)} com IVA${pp?.deslocacao > 0 ? ", mais a deslocação" : ""}. Esta proposta fica abaixo: paga ${pi ? euro(pi.total) : "o mínimo"} e o que já pagou (${precoDefinitivo(p) ? "relatório, diagnóstico" : "visita, diagnóstico"}) não é descontado.`));
  else if (pi && !pp) b.append(el("p", "ajuda num", `${euro(pi.base)} + IVA ${pctTxt(pi.iva_pct)} (${euro(pi.iva)}) = ${euro(pi.total)} com IVA.`));
  if (tm && (!pp || p.obra_minima)) b.append(el("p", "ajuda num", `O total já inclui o trabalho a mais que aceitou: ${euro(tm.valor)} + IVA (${euro(tm.total)} com IVA).`));
  if (p.proposta.texto) b.append(el("p", null, p.proposta.texto));
  if (precoDefinitivo(p) && !obraFeita(p)) b.append(el("p", "ajuda conta-preco-definitivo", PRECO_DEFINITIVO));
  const msg = el("div", "msg", null);
  msg.hidden = true;
  msg.setAttribute("role", "status");
  if (p.aguarda_sinal) {
    b.append(el("p", "msg info", `Aceitou a proposta em ${dataTxt(p.proposta.aceite, true)}. Falta pagar o sinal (${euro(p.sinal.valor)}) ${precoDefinitivo(p) ? "para marcarmos a visita" : "para confirmarmos a instalação"}.`));
    if (p.pode_pagar_sinal) {
      const ja = caixaComecarJa(p);
      b.append(ja.caixa, soMultibanco(p, p.sinal.valor), botaoPagar(p, "sinal", `Pagar o sinal (${euro(p.sinal.valor)})`, msg, () => ({ inicio_imediato: ja.entrada.checked })), msg);
    }
  } else if (p.proposta.aceite && p.estado === "aceite") {
    b.append(el("p", "msg ok", `Aceitou a proposta em ${dataTxt(p.proposta.aceite, true)}${p.sinal?.pago ? " e pagou o sinal" : ""}.${fraseDaVisita(p)}`));
    // Quanto falta pagar, logo depois do sinal (decisão do dono, 2026-10-11): com a obra ainda por confirmar é só o
    // aviso, sem botão de pagar; o valor já leva o trabalho a mais que aceitou. Depois de confirmada fica o "Fim da obra".
    if (p.sinal?.pago && p.restante && !p.restante.pago && !p.pode_pagar_restante && !obraFeita(p) && p.restante.valor > 0) {
      const resto = el("p", "num conta-falta-pagar", `Falta pagar no fim da obra: ${euro(p.restante.valor)} (com IVA).${tm ? ` Inclui ${euro(tm.total)} de trabalho a mais.` : ""}`);
      resto.id = `falta-pagar-${p.id}`;
      b.append(resto);
    }
    // Idas perdidas (decisão do dono, 2026-10-11): não o encontrámos à hora marcada — a deslocação de cada ida soma ao
    // que paga no fim (o valor acima já a leva dentro).
    if (!p.restante?.pago) for (const x of idas) b.append(el("p", "num conta-ida-perdida", `Ida perdida em ${dataTxt(x.visita, true)}: ${euro(x.valor_iva)} (com IVA), soma ao que paga no fim.`));
    if (p.inicio_imediato) b.append(el("p", "ajuda", "Pediu para começarmos já: prescindiu do direito de livre resolução de 14 dias sobre o que for executado."));
    if (p.obra_paga === false) b.append(el("p", "ajuda conta-app-ativa", "A app fica ativa depois de pagar o restante."));
  } else if (p.pode_aceitar) {
    const sinal = p.sinal && p.sinal.valor > 0 && p.modo ? p.sinal : null;
    const botao = el("button", "btn", sinal ? `Aceito a proposta e pago o sinal (${euro(sinal.valor)})` : "Aceito a proposta");
    botao.type = "button";
    botao.id = `aceitar-${p.id}`;
    const ja = sinal ? caixaComecarJa(p) : null;
    botao.addEventListener("click", () => confirmarAceitar(p, b, botao, msg, ja?.entrada.checked ?? null));
    // O sinal cobre o material (decisão 6): o maior entre 30 % do total e o custo do material, menos o que já pagou.
    const ajuda = sinal
      ? `Sinal: ${sinal.cobre_material ? "cobre o material" : `${sinal.pct} % de ${pi ? `${euro(pi.total)} (a proposta com IVA)` : "a proposta"}`}${sinal.desconto ? ` menos os ${euro(sinal.desconto)} que já pagou` : ""} = ${euro(sinal.valor)}. ${precoDefinitivo(p) ? "O sinal cobre o material e a visita. O restante paga-se quando confirmar que a obra ficou concluída." : "O sinal cobre o material; o restante paga-se no fim da obra."}`
      : precoDefinitivo(p) ? "Ao aceitar, registamos a data e a hora e marcamos a visita consigo." : "Ao aceitar, registamos a data e a hora e marcamos a instalação consigo.";
    b.append(el("p", "ajuda", ajuda), ja?.caixa ?? "", sinal ? soMultibanco(p, sinal.valor) : "", botao, msg);
    if (p.pode_recusar) b.append(caixaRecusar(p));
  } else if (p.proposta_recusada) {
    b.append(el("p", "msg info", `Não aceitou esta proposta em ${dataTxt(p.proposta_recusada, true)}. Vamos rever o pedido. Se fizermos uma proposta nova, aparece aqui.`));
  }
  return b;
}

/** "Acima de 500 € paga por Multibanco ou MB Way." (decisão 7), quando o valor passa o limite do cartão; senão nada. */
function soMultibanco(p, valor) {
  return p.cartao_max != null && valor > p.cartao_max ? el("p", "ajuda conta-metodos", `Acima de ${formatarEuroRedondo(p.cartao_max)} paga por Multibanco ou MB Way.`) : "";
}

/** "Quero que comecem já" (decisão 11): a caixa que vai com o pagamento do sinal; fica guardada no pedido. */
function caixaComecarJa(p) {
  const caixa = el("label", "caixa conta-comecar-ja");
  const entrada = document.createElement("input");
  entrada.type = "checkbox";
  entrada.id = `comecar-ja-${p.id}`;
  entrada.checked = Boolean(p.inicio_imediato);
  caixa.append(entrada, " Quero que comecem já (prescindo do direito de livre resolução de 14 dias sobre o que for executado)");
  return { caixa, entrada };
}

/** Botão que pede ao servidor o pagamento de uma fase (o valor é o do servidor) e vai pagar. `extra()`: mais campos do pedido. */
function botaoPagar(p, fase, texto, msg, extra = null) {
  const botao = el("button", "btn", texto);
  botao.type = "button";
  botao.id = `pagar-${fase}-${p.id}`;
  botao.addEventListener("click", async () => {
    botao.disabled = true;
    try {
      const r = await pedirConta(`pedidos/${p.id}/pagar`, { corpo: { fase, ...(extra ? extra() : {}) } });
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
  // Com trabalho a mais aceite: "a proposta mais o trabalho a mais, menos o que já pagou".
  const tm = p.trabalho_a_mais;
  // Com idas perdidas confirmadas: também à parte ("… mais X de ida perdida").
  const idas = p.idas_perdidas ?? [];
  const totalIdas = somaIdas(idas, "valor_iva");
  const mais = [tm ? `${euro(tm.total)} do trabalho a mais` : null, idas.length ? `${euro(totalIdas)} de ${idas.length === 1 ? "ida perdida" : "idas perdidas"}` : null].filter(Boolean);
  const contas = !p.proposta_iva ? "" : mais.length ? `: ${euro(Math.round((p.proposta_iva.total - (tm?.total ?? 0) - totalIdas) * 100) / 100)} mais ${mais.join(" e ")}, menos o que já pagou` : `: ${euro(p.proposta_iva.total)} menos o que já pagou`;
  if (p.restante?.pago) b.append(el("p", "msg ok", "A obra está paga. Obrigado!"));
  else b.append(el("p", null, `A obra está concluída. Falta pagar o restante: ${euro(p.restante.valor)} (com IVA${contas}).`),
    el("p", "ajuda conta-app-ativa", "A app fica ativa depois de pagar o restante."), soMultibanco(p, p.restante.valor),
    botaoPagar(p, "restante", `Pagar o restante (${euro(p.restante.valor)})`, msg), msg);
  return b;
}

/**
 * "O trabalho ficou concluído?" (docs/ELETRICISTAS.md): o técnico deu o trabalho por concluído e o cliente confirma —
 * Sim (de 1 a 5 estrelas, comentário opcional, "podem usar o meu comentário no site") ou Não (o que falta). Sem
 * resposta em 7 dias fica aceite. Depois mostra o que respondeu.
 */
function blocoConfirmacao(p) {
  const x = p.confirmacao;
  const b = el("section", "conta-proposta conta-confirmacao");
  b.setAttribute("aria-label", "Confirmação do trabalho");
  const oque = x.tipo === "Obra" ? "o trabalho" : x.tipo === "Visita técnica" ? "a visita técnica" : "o diagnóstico da avaria";
  const concluidoTxt = x.tipo === "Visita técnica" ? "concluída" : "concluído";
  if (x.estado === "confirmada") {
    b.append(el("h4", null, "Trabalho concluído"));
    if (x.sem_defeito) b.append(el("p", "msg info", "Voltámos a ver o trabalho e não encontrámos defeito: ficou dado como concluído."));
    else if (x.automatica) b.append(el("p", "msg ok", `Não recebemos resposta em 7 dias: ${oque} ficou dad${concluidoTxt.endsWith("a") ? "a" : "o"} como ${concluidoTxt} em ${dataTxt(x.quando)}.`));
    else {
      b.append(el("p", "msg ok", `Confirmou em ${dataTxt(x.quando, true)}. Obrigado!`));
      if (x.estrelas) { const e = el("p", "conta-estrelas-dadas", `${"★".repeat(x.estrelas)}${"☆".repeat(5 - x.estrelas)}`); e.setAttribute("aria-label", `${x.estrelas} em 5 estrelas`); b.append(e); }
      if (x.comentario) b.append(el("p", "ajuda", `«${x.comentario}»${x.site ? " Pode ser usado no site." : ""}`));
    }
    return b;
  }
  if (x.estado === "contestada") {
    b.append(el("h4", null, "O trabalho ainda não está concluído"), el("p", "msg info", `Disse-nos em ${dataTxt(x.quando, true)} que faltava: «${x.descricao ?? ""}». O técnico vai voltar; combinamos a data consigo.`));
    return b;
  }
  // Por confirmar.
  b.append(el("h4", null, "O trabalho ficou concluído?"),
    el("p", null, `O nosso técnico deu ${oque} por ${concluidoTxt} em ${dataTxt(x.concluida, true)}. Confirme, por favor, que ficou tudo bem.`),
    el("p", "ajuda", `Sem resposta até ${dataTxt(x.prazo)}, damos ${oque} por ${concluidoTxt}.`));
  const msg = msgPequena();
  const sim = el("button", "btn", "Sim");
  sim.type = "button";
  sim.id = `confirmar-sim-${p.id}`;
  const nao = el("button", "btn sec", "Não, falta alguma coisa");
  nao.type = "button";
  nao.id = `confirmar-nao-${p.id}`;
  const bs = el("div", "form-botoes");
  bs.append(sim, nao);
  const zona = el("div", "conta-confirmar-zona");
  const erro = (t, foco) => { msg.textContent = t; msg.className = "msg erro"; msg.hidden = false; foco?.focus(); };
  const enviar = async (botao, corpo) => {
    botao.disabled = true;
    try {
      const r = await pedirConta(`pedidos/${p.id}/confirmar-trabalho`, { corpo });
      await carregar();
      // Depois do "Sim" o restante já se paga (decisão do dono, 2026-10-11): o bloco "Fim da obra" aparece logo abaixo.
      mensagem(corpo.concluido ? `Obrigado! Registámos que ficou tudo concluído.${r?.pedido?.pode_pagar_restante ? " Já pode pagar o restante, aqui no pedido." : ""}` :"Recebemos. O técnico vai voltar para terminar; combinamos a data consigo.", "ok");
    } catch (e) {
      botao.disabled = false;
      erro(e.message);
      if (e instanceof ErroConta && e.estado === 409) carregar();
    }
  };
  sim.addEventListener("click", () => {
    msg.hidden = true;
    const f = el("form", "conta-confirmar-form");
    f.noValidate = true;
    const estrelas = el("fieldset", "conta-estrelas");
    estrelas.append(el("legend", null, "A sua avaliação (obrigatória)"));
    const linha = el("div", "conta-estrelas-linha");
    for (let n = 1; n <= 5; n++) {
      const l = el("label");
      const i = document.createElement("input");
      i.type = "radio";
      i.name = `estrelas-${p.id}`;
      i.value = String(n);
      i.id = `estrelas-${p.id}-${n}`;
      i.setAttribute("aria-label", `${n} em 5 estrelas`);
      l.append(i, el("span", null, "★"));
      l.title = `${n} em 5`;
      i.addEventListener("change", () => linha.querySelectorAll("label").forEach((x, k) => x.classList.toggle("ativa", k < n)));
      linha.append(l);
    }
    estrelas.append(linha);
    const lc = el("label", "campo");
    const t = document.createElement("textarea");
    t.id = `comentario-${p.id}`;
    t.maxLength = 1000;
    t.rows = 3;
    lc.append(el("span", null, "Comentário (opcional)"), t);
    const site = el("label", "caixa");
    const cs = document.createElement("input");
    cs.type = "checkbox";
    cs.id = `comentario-site-${p.id}`;
    site.append(cs, " Podem usar o meu comentário no site");
    const ok = el("button", "btn", "Enviar");
    ok.type = "submit";
    ok.id = `confirmar-enviar-${p.id}`;
    f.append(estrelas, lc, site, ok);
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const n = Number(f.querySelector(`input[name="estrelas-${p.id}"]:checked`)?.value);
      if (!n) return erro("Escolha a avaliação: de 1 a 5 estrelas.", linha.querySelector("input"));
      enviar(ok, { concluido: true, estrelas: n, comentario: t.value.trim() || null, site: cs.checked });
    });
    zona.replaceChildren(f);
    linha.querySelector("input").focus();
  });
  nao.addEventListener("click", () => {
    msg.hidden = true;
    const f = el("form", "conta-confirmar-form");
    f.noValidate = true;
    const lc = el("label", "campo");
    const t = document.createElement("textarea");
    t.id = `falta-${p.id}`;
    t.maxLength = 1000;
    t.rows = 3;
    t.required = true;
    lc.append(el("span", null, "O que falta ou não ficou bem? (obrigatório)"), t);
    const ok = el("button", "btn", "Enviar");
    ok.type = "submit";
    ok.id = `confirmar-falta-${p.id}`;
    f.append(lc, el("p", "ajuda", "O técnico volta para terminar. Se voltarmos e não houver defeito, essa visita é paga (Termos e Condições)."), ok);
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (t.value.trim().length < 5) return erro("Escreva o que falta (pelo menos umas palavras).", t);
      enviar(ok, { concluido: false, descricao: t.value.trim() });
    });
    zona.replaceChildren(f);
    t.focus();
  });
  b.append(bs, zona, msg);
  return b;
}

/**
 * Mensagens do pedido (docs/ASSISTENTE-IA.md §9): os emails que a equipa enviou pelo painel e as respostas do cliente;
 * com `pode_responder`, a caixa "A sua resposta" (POST pedidos/:id/mensagens).
 */
function blocoMensagens(p) {
  const b = el("section", "conta-proposta conta-mensagens");
  b.setAttribute("aria-label", "Mensagens sobre este pedido");
  b.append(el("h4", null, "Mensagens"));
  const lista = el("ul", "conta-conversa");
  for (const m of p.mensagens) {
    const li = el("li", m.de === "cliente" ? "minha" : null);
    li.append(el("p", "ajuda", `${m.de === "cliente" ? "Eu" : "Domus Energia"} · ${dataTxt(m.quando, true)}`));
    if (m.assunto) li.append(el("p", "conta-conversa-assunto", m.assunto));
    li.append(el("p", null, m.texto));
    lista.append(li);
  }
  b.append(lista);
  if (!p.pode_responder) return b;
  const msg = msgPequena();
  const f = el("form", "conta-confirmar-form");
  f.noValidate = true;
  const rotulo = el("label", null, "A sua resposta");
  const t = document.createElement("textarea");
  t.rows = 4;
  t.maxLength = 2000;
  t.id = `mensagem-${p.id}`;
  rotulo.htmlFor = t.id;
  const ok = el("button", "btn", "Enviar resposta");
  ok.type = "submit";
  ok.id = `mensagem-enviar-${p.id}`;
  f.append(rotulo, t, ok);
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!t.value.trim()) { msg.textContent = "Escreva a sua resposta."; msg.className = "msg erro"; msg.hidden = false; t.focus(); return; }
    ok.disabled = true;
    try {
      await pedirConta(`pedidos/${p.id}/mensagens`, { corpo: { texto: t.value.trim() } });
      await carregar();
      mensagem("Resposta enviada. Vamos ler e responder-lhe.", "ok");
    } catch (e) {
      ok.disabled = false;
      msg.textContent = e.message;
      msg.className = "msg erro";
      msg.hidden = false;
    }
  });
  b.append(f, msg);
  return b;
}

/**
 * "Como correu?" (docs/EMAILS-AUTOMATICOS.md): com a obra concluída e ainda sem avaliação, 1 a 5 estrelas (uma vez).
 * Depois de avaliar — aqui ou na confirmação do trabalho — o convite para a avaliação pública no Google, a todos, com
 * qualquer número de estrelas, e só quando o servidor dá a ligação (configurada no painel).
 */
function blocoAvaliacao(p) {
  const x = p.avaliacao;
  const b = el("section", "conta-proposta conta-avaliacao");
  b.setAttribute("aria-label", "Avaliação do trabalho");
  if (!x.pode) {
    b.append(el("h4", null, "A sua avaliação"));
    if (x.do_pedido) { const e = el("p", "conta-estrelas-dadas", `${"★".repeat(x.estrelas)}${"☆".repeat(5 - x.estrelas)}`); e.setAttribute("aria-label", `${x.estrelas} em 5 estrelas`); b.append(e); }
    b.append(el("p", null, "Obrigado pela sua avaliação."));
    if (typeof x.google === "string" && x.google.startsWith("https://")) {
      const a = el("a", "btn sec", "Avaliar no Google");
      a.href = x.google;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.id = `avaliar-google-${p.id}`;
      b.append(el("p", "ajuda", "Se quiser, deixe também uma avaliação pública no Google: ajuda outras pessoas a escolher."), a);
    }
    return b;
  }
  const msg = msgPequena();
  const f = el("form", "conta-confirmar-form");
  f.noValidate = true;
  const estrelas = el("fieldset", "conta-estrelas");
  estrelas.append(el("legend", null, "De 1 a 5 estrelas"));
  const linha = el("div", "conta-estrelas-linha");
  for (let n = 1; n <= 5; n++) {
    const l = el("label");
    const i = document.createElement("input");
    i.type = "radio";
    i.name = `avaliar-${p.id}`;
    i.value = String(n);
    i.id = `avaliar-${p.id}-${n}`;
    i.setAttribute("aria-label", `${n} em 5 estrelas`);
    l.append(i, el("span", null, "★"));
    l.title = `${n} em 5`;
    i.addEventListener("change", () => linha.querySelectorAll("label").forEach((y, k) => y.classList.toggle("ativa", k < n)));
    linha.append(l);
  }
  estrelas.append(linha);
  const ok = el("button", "btn", "Enviar avaliação");
  ok.type = "submit";
  ok.id = `avaliar-enviar-${p.id}`;
  f.append(estrelas, ok);
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const n = Number(f.querySelector(`input[name="avaliar-${p.id}"]:checked`)?.value);
    if (!n) { msg.textContent = "Escolha a avaliação: de 1 a 5 estrelas."; msg.className = "msg erro"; msg.hidden = false; linha.querySelector("input").focus(); return; }
    ok.disabled = true;
    try {
      await pedirConta(`pedidos/${p.id}/avaliar`, { corpo: { estrelas: n } });
      await carregar();
      mensagem("Obrigado! Registámos a sua avaliação.", "ok");
    } catch (e) {
      ok.disabled = false;
      msg.textContent = e.message;
      msg.className = "msg erro";
      msg.hidden = false;
      if (e instanceof ErroConta && e.estado === 409) carregar();
    }
  });
  b.append(el("h4", null, "Como correu?"), el("p", null, "A obra está concluída. Diga-nos como correu o trabalho."), f, msg);
  return b;
}

/** Visita sem defeito (decisão 8): voltámos depois de um "Não" e não havia defeito — a visita paga-se e não desconta na obra. */
function blocoVisitaSemDefeito(p) {
  const v = p.visita_sem_defeito;
  const b = el("section", "conta-proposta conta-visita-sem-defeito");
  b.setAttribute("aria-label", "Visita sem defeito");
  b.append(el("h4", null, "Visita sem defeito"));
  if (v.paga) { b.append(el("p", "msg ok", `Visita paga (${euro(v.valor)}). Obrigado!`)); return b; }
  const msg = msgPequena();
  b.append(el("p", null, `Voltámos ao trabalho e não encontrámos defeito. Como nos Termos e Condições, esta visita é paga: ${euro(v.valor)} com IVA (não é descontada na obra).`),
    botaoPagar(p, "visita_sem_defeito", `Pagar a visita (${euro(v.valor)})`, msg), msg);
  return b;
}

/**
 * Cancelar a visita técnica paga (decisão 10): com mais de 24 h de antecedência devolvemos a visita; com menos já não
 * há devolução; se faltou, a visita não é devolvida.
 */
function blocoCancelarVisita(p) {
  const vc = p.visita_cancelar;
  if (!vc.pode && !vc.motivo) return null;
  // O diagnóstico da avaria segue a mesma regra da visita (uma avaria marcada para o próprio dia já não tem devolução).
  const [a, o, O] = vc.avaria ? ["o diagnóstico", "o diagnóstico", "Diagnóstico cancelado"] : ["a visita", "a visita técnica", "Visita cancelada"];
  const b = el("section", "conta-relatorio conta-cancelar-visita");
  b.setAttribute("aria-label", vc.avaria ? "Cancelar o diagnóstico" : "Cancelar a visita");
  if (!vc.pode) { b.append(el("p", "ajuda", vc.motivo)); return b; }
  const msg = msgPequena();
  const botao = el("button", "btn sec pequeno", vc.avaria ? "Cancelar diagnóstico" : "Cancelar visita");
  botao.type = "button";
  botao.id = `cancelar-visita-${p.id}`;
  botao.addEventListener("click", () => {
    if (b.querySelector(".confirmar")) return;
    const caixa = el("div", "confirmar msg info");
    caixa.setAttribute("role", "alert");
    caixa.append(el("p", null, `Cancela ${o}? Devolvemos ${euro(vc.devolucao)}.`));
    const sim = el("button", "btn pequeno", "Sim, cancelar");
    sim.type = "button";
    sim.id = `cancelar-visita-sim-${p.id}`;
    const nao = el("button", "btn sec pequeno", "Não");
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
        const r = await pedirConta(`pedidos/${p.id}/cancelar-visita`, { corpo: {} });
        await carregar();
        mensagem(r.manual ? `${O}. Pagou por referência Multibanco: devolvemos ${euro(r.devolvido)} por transferência. Indique o IBAN no pedido.`
          : `${O}. Devolvemos ${euro(r.devolvido)} para o mesmo meio de pagamento (até 14 dias).`, "ok");
      } catch (e) {
        caixa.remove();
        msg.textContent = e.message;
        msg.className = "msg erro";
        msg.hidden = false;
        if (e instanceof ErroConta && e.estado === 409) carregar();
      }
    });
  });
  b.append(el("p", "ajuda", `Não pode estar? Até 24 h antes d${a} cancela aqui e devolvemos ${euro(vc.devolucao)}. Com menos de 24 h, ou se faltar, ${a} não é devolvid${vc.avaria ? "o" : "a"}.`), botao, msg);
  return b;
}

/**
 * Devolução por transferência (pagou por referência Multibanco): pedimos o IBAN e o titular; depois de os dar fica
 * "por fazer" (pode corrigi-los) e, feita a transferência, "devolvido". Do IBAN só se mostra o fim.
 */
function blocoDevolucao(d) {
  const b = el("section", "conta-relatorio conta-devolucao");
  b.setAttribute("aria-label", "Devolução por transferência");
  b.append(el("h4", null, `Devolução de ${euro(d.valor)}`));
  if (d.motivo === "horario") b.append(el("p", "ajuda", "A visita ficou marcada em horário normal: devolvemos a diferença do preço de fora de horas."));
  if (d.estado === "devolvido") { b.append(el("p", "msg ok", `Transferência feita em ${dataTxt(d.devolvido)} para ${d.iban ?? "a sua conta"}.`)); return b; }
  const msg = msgPequena();
  const campo = (rotulo, attrs) => {
    const l = el("label", "campo");
    const i = document.createElement("input");
    Object.assign(i, attrs);
    l.append(el("span", null, rotulo), i);
    return [l, i];
  };
  const [lIban, iIban] = campo("IBAN (PT50…)", { name: "iban", id: `dev-iban-${d.id}`, autocomplete: "off", inputMode: "text", maxLength: 34, placeholder: "PT50 0000 0000 0000 0000 0000 0" });
  const [lTit, iTit] = campo("Titular da conta", { name: "titular", id: `dev-titular-${d.id}`, autocomplete: "name", maxLength: 120, value: d.titular ?? "" });
  const botao = el("button", "btn pequeno", d.estado === "por_fazer" ? "Corrigir IBAN" : "Enviar IBAN");
  botao.type = "button";
  botao.id = `dev-enviar-${d.id}`;
  botao.addEventListener("click", async () => {
    const iban = iIban.value.replace(/\s+/g, "").toUpperCase(), titular = iTit.value.trim();
    const erro = (t, i) => { msg.textContent = t; msg.className = "msg erro"; msg.hidden = false; i.focus(); };
    if (!ibanValido(iban)) return erro("IBAN inválido: escreva um IBAN português (PT50 e 21 algarismos).", iIban);
    if (titular.length < 2) return erro("Indique o nome do titular da conta.", iTit);
    botao.disabled = true;
    try {
      await pedirConta(`devolucoes/${d.id}/iban`, { corpo: { iban, titular } });
      await carregar();
      mensagem("IBAN recebido. Fazemos a transferência até 14 dias.", "ok");
    } catch (e) {
      botao.disabled = false;
      msg.textContent = e.message;
      msg.className = "msg erro";
      msg.hidden = false;
    }
  });
  b.append(el("p", null, d.estado === "por_fazer"
    ? `Recebemos o IBAN ${d.iban}. Fazemos a transferência até 14 dias.`
    : "Pagou por referência Multibanco: devolvemos por transferência bancária. Indique o IBAN e o titular da conta."),
  el("p", "ajuda", "O IBAN serve só para esta devolução."), lIban, lTit, botao, msg);
  return b;
}

/** IBAN português: "PT50" + 21 algarismos, com o resto 1 na divisão por 97 (ISO 13616). O servidor valida outra vez. */
function ibanValido(iban) {
  if (!/^PT50\d{21}$/.test(iban)) return false;
  let resto = 0;
  for (const d of `${iban.slice(4)}2529${iban.slice(2, 4)}`) resto = (resto * 10 + Number(d)) % 97;
  return resto === 1;
}

function blocoPagamentos(p) {
  const b = el("section", "conta-pagamentos");
  b.setAttribute("aria-label", "Pagamentos");
  b.append(el("h4", null, "Pagamentos"));
  const ul = el("ul");
  for (const x of p.pagamentos) {
    const li = el("li");
    li.dataset.fase = x.fase;
    li.append(el("span", null, `${x.fase_texto}: ${euro(x.valor)} com IVA`), el("span", x.estado === "pago" ? "estado-pago" : "estado-outro", x.estado_texto));
    if (x.nao_realizada) li.append(el("span", "conta-recibo conta-nao-realizada", "Visita não realizada: não desconta"));
    if (x.sem_defeito) li.append(el("span", "conta-recibo conta-nao-realizada", "Visita sem defeito: não desconta"));
    // Avaria pedida fora de horas (decisão do dono, 2026-10-13): o que pagou a mais por isso e, se a visita ficou em horário normal, que lhe foi devolvido.
    if (x.fora_horas) {
      li.append(el("span", "conta-recibo", `Pediu a visita fora de horas (noite, fim de semana ou feriado)${x.fora_horas_valor > 0 ? `: ${euro(x.fora_horas_valor)} a mais, já incluídos` : ""}.`));
      if (x.fora_horas_devolvida) li.append(el("span", "conta-recibo", "A visita ficou marcada em horário normal: devolvemos a diferença."));
    }
    if (x.a_devolver != null) li.append(el("span", "conta-recibo", `A devolver por transferência: ${euro(x.a_devolver)}`));
    if (x.devolvido != null) li.append(el("span", "conta-recibo", `Devolvidos ${euro(x.devolvido)}${x.devolvido_em ? ` em ${dataTxt(x.devolvido_em, true)}` : ""}${x.modo === "simulado" ? " · SIMULAÇÃO" : ""}`));
    if (x.recibo) {
      const r = x.recibo;
      const iva = r.base != null ? ` (${euro(r.base)} + IVA${r.iva_pct != null ? ` ${pctTxt(r.iva_pct)}` : ""} ${euro(r.iva)})` : "";
      li.append(el("span", "conta-recibo", `Recibo de ${dataTxt(r.data, true)} · ${euro(r.valor)}${iva} · ${r.descricao} · Ref. ${r.referencia}${r.simulado ? " · SIMULAÇÃO (não cobrado)" : ""}`));
    }
    ul.append(li);
  }
  b.append(ul);
  return b;
}

/** Mensagem pequena por baixo de um botão (erros das compras). */
function msgPequena() {
  const m = el("div", "msg", null);
  m.hidden = true;
  m.setAttribute("role", "status");
  return m;
}

/** Compras desligadas no servidor (sem Stripe): diz como pedir. */
const SEM_COMPRAS = "De momento não é possível pagar aqui. Fale connosco.";

function blocoRelatorio(p) {
  const b = el("section", "conta-relatorio");
  b.setAttribute("aria-label", "Relatório completo");
  b.append(el("h4", null, "Relatório completo"));
  if (p.relatorio === "por_comprar") {
    const cp = p.compras;
    b.append(el("p", null, "Material e preço de cada divisão, revisto pela nossa equipa (até 24 h). Descontado na obra."));
    if (!cp?.pode) b.append(el("p", "ajuda", p.lista_espera ? "O pedido está em lista de espera. O relatório completo pode ser pedido quando abrirmos." : "Já não se compra neste pedido."));
    else if (!cp.ativas) b.append(el("p", "ajuda", SEM_COMPRAS));
    else {
      const msg = msgPequena();
      b.append(botaoPagar(p, "relatorio_pormenorizado", `Comprar relatório completo (${euro(cp.relatorio.valor)})`, msg), msg);
    }
    return b;
  }
  if (p.relatorio === "em_revisao") {
    b.append(el("p", null, "Relatório em revisão (até 24 h). Avisamos por email quando estiver pronto."));
    return b;
  }
  const zona = el("div", "relatorio-cliente");
  const ver = el("button", "btn sec pequeno nao-imprimir", "Ver o relatório completo");
  ver.type = "button";
  ver.id = `relatorio-${p.id}`;
  const imprimir = el("button", "btn sec pequeno nao-imprimir", "Descarregar (imprimir / PDF)");
  imprimir.type = "button";
  imprimir.hidden = true;
  imprimir.addEventListener("click", () => {
    const cartao = b.closest(".conta-pedido");
    // O relatório está dentro de uma secção que abre e fecha: fechada não se imprimia nada.
    const sec = b.closest("details");
    if (sec) sec.open = true;
    cartao?.classList.add("a-imprimir");
    document.body.classList.add("imprimir-relatorio");
    const antes = document.title;
    document.title = `Relatório completo do pedido ${p.id}`;
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

/** Relatório básico (grátis, logo ao enviar): o intervalo e a lista de trabalho por divisão (sem material nem preços). */
function blocoBasico(p) {
  const b = el("section", "conta-relatorio conta-basico");
  // Avaria: o mesmo bloco mostra o que o cliente descreveu e o diagnóstico (não há estimativa nem lista por divisão).
  const avaria = Boolean(p.compras?.avaria);
  const titulo = avaria ? "O seu pedido de avaria" : "Relatório grátis";
  b.setAttribute("aria-label", titulo);
  b.append(el("h4", null, titulo));
  const zona = el("div", "relatorio-cliente");
  const ver = el("button", "btn sec pequeno", avaria ? "Ver o pedido" : "Ver o relatório grátis");
  ver.type = "button";
  ver.id = `basico-${p.id}`;
  ver.addEventListener("click", async () => {
    ver.disabled = true;
    try {
      const r = await pedirConta(`pedidos/${p.id}/relatorio-basico`);
      zona.replaceChildren(...desenharBasico(r.relatorio));
      ver.hidden = true;
    } catch (e) {
      zona.replaceChildren(el("p", "msg erro", e.message));
      ver.disabled = false;
    }
  });
  b.append(el("p", "ajuda", avaria ? "A avaria que descreveu e o diagnóstico." : "A estimativa e a lista do trabalho, por divisão."), ver, zona);
  return b;
}

function desenharBasico(r) {
  const out = [];
  // Como no Orçamento do simulador: o intervalo sem a deslocação e "+ deslocação X €" (fora da área: sem deslocação;
  // sem concelho reconhecido: "+ deslocação a confirmar"; 0 €: "sem custo de deslocação").
  const desl = r.deslocacao == null ? "" : r.deslocacao_a_confirmar ? " + deslocação a confirmar"
    : r.deslocacao > 0 ? ` + deslocação ${euro(r.deslocacao)}${idaEVolta(r)}` : " (sem custo de deslocação)";
  if (r.intervalo) out.push(el("p", "valor num", `${r.intervalo.min === r.intervalo.max ? formatarEuroRedondo(r.intervalo.min) : `${formatarEuroRedondo(r.intervalo.min)} – ${formatarEuroRedondo(r.intervalo.max)}`}${desl}`),
    el("p", "ajuda", `${r.deslocacao != null ? "Com IVA." : "Com IVA, sem deslocação."}${r.dias ? ` ${textoDias(r.dias)}.` : ""}${r.obra_minima ? ` Obra mínima: ${formatarEuroRedondo(r.obra_minima)}.` : ""}`));
  const a = r.acoes ?? {};
  const resumo = [["reparar", "a reparar"], ["substituir", "a substituir"], ["novo", "novos"], ["manter", "ficam como estão"]]
    .filter(([k]) => a[k] > 0).map(([k, t]) => `${a[k]} ${a[k] === 1 ? "aparelho" : "aparelhos"} ${t}`);
  if (resumo.length) out.push(el("p", null, `Lista de trabalho: ${resumo.join(" · ")}.`));
  for (const d of r.divisoes) {
    out.push(el("h5", null, d.nome));
    const ul = el("ul");
    for (const t of d.trabalho) ul.append(el("li", null, t));
    out.push(ul);
  }
  if (r.melhorias?.length) {
    const ul = el("ul");
    for (const m of r.melhorias) ul.append(el("li", null, m));
    out.push(el("h5", null, "Melhorias"), ul);
  }
  out.push(el("p", "ajuda", r.nota));
  return out;
}

/** Visita técnica: comprar (deslocação + 30 min), paga à espera da data, ou fora da área. A data marcada vai no topo. */
function blocoVisita(p) {
  const cp = p.compras;
  const v = cp.visita;
  if (p.data_visita) return null;   // já marcada: a data está no topo do cartão
  // Propostas na bolsa (decisão do dono, 2026-10-11): a visita já não se vende à parte (vem depois de aceitar a
  // proposta, incluída no sinal). Quem a pagou antes continua a ver "Visita paga" e pode cancelá-la com devolução.
  if (v.incluida && !v.paga) return null;
  const b = el("section", "conta-relatorio conta-visita");
  b.setAttribute("aria-label", "Visita técnica");
  b.append(el("h4", null, "Visita técnica"));
  if (v.paga) {
    b.append(el("p", null, cp.avaria ? "Visita pedida com o diagnóstico. Vamos marcar a data e avisamos por email." : "Visita paga. Vamos marcar a data e avisamos por email."));
    return b;
  }
  if (!cp.pode) return null;
  // A área servida (deslocacao_max_km, 100 km de Lisboa) não chega à conta: o texto diz o valor da configuração de omissão.
  if (v.fora_area) b.append(el("p", null, "Fora da área servida (até 100 km de Lisboa): sem visita técnica. Fale connosco."));
  else if (v.sem_concelho) b.append(el("p", null, "Não reconhecemos o concelho da localidade: fale connosco para marcar a visita."));
  else if (!cp.ativas) b.append(el("p", null, "Um técnico vê a casa e confirma o trabalho. Descontada na obra."), el("p", "ajuda", SEM_COMPRAS));
  else {
    const msg = msgPequena();
    b.append(el("p", null, "Um técnico vê a casa e confirma o trabalho: deslocação e 30 min no local. Descontada na obra."),
      botaoPagar(p, "visita", `Marcar visita técnica (${euro(v.valor)})`, msg), msg);
  }
  return b;
}

/** " (ida e volta, 3 dias)" ou " (ida e volta; máximo 5 dias)", como no Orçamento do simulador; "" sem deslocação paga. */
const idaEVolta = (r) => (r.deslocacao > 0 && r.deslocacao_dias
  ? (r.deslocacao_limitada ? ` (ida e volta; máximo ${r.deslocacao_dias} dias)` : ` (ida e volta, ${r.deslocacao_dias} ${r.deslocacao_dias === 1 ? "dia" : "dias"})`) : "");

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
  // Lista de trabalho (Reparar / Substituir / Novo por divisão); os aparelhos a manter só se contam.
  const a = r.acoes ?? {};
  const resumo = [["reparar", "a reparar"], ["substituir", "a substituir"], ["novo", "novos"], ["manter", "ficam como estão"]]
    .filter(([k]) => a[k] > 0).map(([k, t]) => `${a[k]} ${a[k] === 1 ? "aparelho" : "aparelhos"} ${t}`);
  if (resumo.length) out.push(el("p", null, `Lista de trabalho: ${resumo.join(" · ")}.`));
  for (const d of r.divisoes) {
    out.push(el("h5", null, `${d.nome}: ${euro(d.total)}`));
    if (d.trabalho.length) {
      const ul = el("ul");
      for (const t of d.trabalho) ul.append(el("li", null, t));
      out.push(ul);
    }
    if (d.material.length) out.push(tabelaMaterial(d.material));
  }
  if (r.geral.material.length) out.push(el("h5", null, `${r.geral.titulo}: ${euro(r.geral.total)}`), tabelaMaterial(r.geral.material));
  // Fase 2: os pacotes aceites nas Melhorias — o material de cada um e a instalação e configuração deles.
  const mel = r.melhorias;
  if (mel?.pacotes?.length) {
    out.push(el("h5", null, `${mel.titulo}: ${euro(mel.total)}`));
    for (const p of mel.pacotes) {
      out.push(el("h6", null, `${p.nome}: ${euro(p.total)}`));
      if (p.material.length) out.push(tabelaMaterial(p.material));
    }
    out.push(el("p", null, `Instalação e configuração dos pacotes: ${euro(mel.instalacao)}`));
  }
  if (r.mao_obra) out.push(el("p", null, `Mão de obra${r.mao_obra.horas ? ` (cerca de ${String(r.mao_obra.horas).replace(".", ",")} h)` : ""}: ${euro(r.mao_obra.valor)}`));
  if (r.dias) out.push(el("p", "ajuda", `${textoDias(r.dias)}.`));
  if (r.deslocacao != null) out.push(el("p", null, `Deslocação: ${euro(r.deslocacao)}${idaEVolta(r)}`));
  out.push(el("p", "valor num", `Total estimado: ${euro(r.total)}`), el("p", "ajuda", r.nota));
  // Conteúdo técnico (só no pormenorizado; web/simulador/simbolos.js): planta técnica com a simbologia normalizada e a
  // legenda, esquema por luz, nota de terra e lista de ensaios (os valores medidos aparecem quando os registamos).
  out.push(...seccaoTecnica(r, { titulo: "h5", subtitulo: "h6" }));
  // "Esquema do quadro elétrico" desenhado pelo eletricista no painel (só no pormenorizado): o mesmo desenho do passo
  // "Quadro elétrico" do simulador (geral, diferenciais, disjuntores e módulos livres pela ordem da calha), só leitura.
  if (r.esquema_quadro && typeof r.esquema_quadro === "object") {
    const q = el("div", "rel-quadro");
    let svg = null;
    try { svg = desenharQuadroCliente(r.esquema_quadro, { resumo: "esquema do quadro elétrico" }); } catch { svg = null; }
    if (svg) {
      svg.removeAttribute("id");
      svg.setAttribute("role", "img");
      for (const g of svg.querySelectorAll(".qd-item")) { g.removeAttribute("tabindex"); g.removeAttribute("role"); }
      q.append(svg);
    }
    const eq = r.esquema_quadro;
    const linhas = [];
    if (eq.disjuntor_geral?.amperes) linhas.push(`Disjuntor geral: ${eq.disjuntor_geral.amperes} A`);
    if (Array.isArray(eq.diferenciais) && eq.diferenciais.length) linhas.push(`${eq.diferenciais.length} ${eq.diferenciais.length === 1 ? "diferencial" : "diferenciais"} (${eq.diferenciais.map((d) => `${d?.sensibilidade_ma ?? "?"} mA / ${d?.amperes ?? "?"} A`).join(", ")})`);
    if (Array.isArray(eq.disjuntores) && eq.disjuntores.length) linhas.push(`${eq.disjuntores.length} ${eq.disjuntores.length === 1 ? "disjuntor" : "disjuntores"} (${eq.disjuntores.map((d) => `${d?.amperes ?? "?"} A`).join(", ")})`);
    if (Number.isFinite(Number(eq.modulos_livres))) linhas.push(`${eq.modulos_livres} ${Number(eq.modulos_livres) === 1 ? "módulo livre" : "módulos livres"}`);
    if (eq.fusiveis === true) linhas.push("Quadro com fusíveis (sem disjuntores)");
    if (linhas.length) q.append(el("p", "ajuda", linhas.join(" · ") + "."));
    out.push(el("h5", null, "Esquema do quadro elétrico"), el("p", "ajuda", "Desenhado pelo nosso eletricista a partir do quadro atual (ou do previsto)."), q);
  }
  // Diagnóstico da avaria feito pelo nosso eletricista no painel (só no pormenorizado, nunca no básico): o que foi
  // verificado (com o valor medido), o tipo de avaria encontrado e a conclusão.
  const dg = r.diagnostico;
  if (dg && typeof dg === "object") {
    out.push(el("h5", null, "Diagnóstico da avaria"), el("p", "ajuda", "Feito pelo nosso eletricista na visita."));
    const vs = Array.isArray(dg.verificacoes) ? dg.verificacoes : [];
    if (vs.length) {
      const ul = el("ul", "conta-diag-feitas");
      for (const v of vs) ul.append(el("li", null, `${v.nome}${v.medido != null ? `: ${String(v.medido).replace(".", ",")} ${v.unidade ?? ""}`.trimEnd() : ""}`));
      out.push(ul);
    }
    if (dg.tipo_nome) out.push(el("p", null, `Tipo de avaria encontrado: ${dg.tipo_nome}.`));
    if (dg.conclusao) out.push(el("p", "conta-diag-conclusao", `Conclusão: ${dg.conclusao}`));
    if (dg.data) out.push(el("p", "ajuda", `Registado em ${dataTxt(dg.data, true)}.`));
  }
  return out;
}

function confirmarAceitar(p, b, botao, msg, comecarJa = null) {
  if (b.querySelector(".confirmar")) return;
  const caixa = el("div", "confirmar msg info");
  caixa.setAttribute("role", "alert");
  const sinal = p.sinal && p.sinal.valor > 0 ? p.sinal : null;
  caixa.append(el("p", null, `Confirma que aceita a proposta de ${euro(p.proposta.valor)} + IVA${p.proposta_iva ? ` (${euro(p.proposta_iva.total)} com IVA)` : ""}?${sinal ? ` A seguir paga o sinal de ${euro(sinal.valor)} (com IVA).` : ""}`));
  if (precoDefinitivo(p)) caixa.append(el("p", "ajuda", PRECO_DEFINITIVO));
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
      const r = await pedirConta(`pedidos/${p.id}/aceitar`, { corpo: { valor: p.proposta.valor, ...(comecarJa === null ? {} : { inicio_imediato: comecarJa }) } });
      if (r?.pagamento && irPagar(r.pagamento)) return;
      await carregar();
      mensagem(precoDefinitivo(p) ? "Proposta aceite. Obrigado! Vamos marcar a visita consigo." : "Proposta aceite. Obrigado! Vamos contactá-lo para marcar a instalação.", "ok");
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
  linha("Avaria", r.avaria);
  linha("Localidade", r.localidade);
  linha("Divisões", r.divisoes ? String(r.divisoes) : null);
  // Avaria rápida: o diagnóstico, fixo (como no simulador); pedidos antigos com intervalo, o intervalo.
  if (r.avaria && r.estimativa && r.estimativa.min === r.estimativa.max) linha("Diagnóstico", `${euro(r.estimativa.min)} + deslocação (com IVA)`);
  else linha("Estimativa", r.estimativa ? `${euro(r.estimativa.min)} – ${euro(r.estimativa.max)} (com IVA; o valor final é o da proposta)` : null);
  b.append(dl);
  if (r.inclui?.length) {
    const ul = el("ul");
    for (const t of r.inclui) ul.append(el("li", null, t));
    b.append(el("p", null, "O que inclui:"), ul);
  }
  // Fase 2: os pacotes do passo "Melhorias", só o nome (como no Orçamento do simulador: o preço é o intervalo total).
  if (r.melhorias?.length) {
    const ul = el("ul");
    for (const m of r.melhorias) ul.append(el("li", null, m.nome));
    b.append(el("p", null, "Melhorias:"), ul);
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
  // Sem foto do quadro o pedido não se valida (o CEO devolve-o a pedi-la): tem botão próprio, que a envia com a chave
  // "quadro" — por "Acrescentar foto" ficava como "outra" e o painel continuava a dizer que faltava.
  if (faltaFotoQuadro(p)) {
    b.append(el("p", "ajuda", "Falta a foto do quadro elétrico (com a porta aberta, a ver-se os disjuntores): é por ela que preparamos a proposta."),
      botaoFoto("Juntar a foto do quadro elétrico", `quadro-${p.id}`, null, (ficheiro) => enviarFoto(p, "quadro", "Quadro elétrico", ficheiro, aviso)));
  }
  if (p.pode_fotos && p.fotos.length < (p.fotos_max ?? 40)) {
    b.append(el("p", "ajuda", "Pode acrescentar fotos (do quadro elétrico, das divisões, de onde quer os aparelhos) até o pedido ser aceite."),
      botaoFoto("Acrescentar foto", `acrescentar-${p.id}`, null, (ficheiro) => enviarFoto(p, `conta${Date.now().toString(36)}:outra`, "Foto acrescentada na conta", ficheiro, aviso)));
  }
  b.append(msg);
  return b;
}

/** Falta a foto do quadro elétrico e ainda se pode juntar (o botão próprio das Fotos e o da caixa do topo). */
const faltaFotoQuadro = (p) => Boolean(p.pode_fotos) && !p.compras?.avaria && !p.fotos.some((f) => f.chave === "quadro") && p.fotos.length < (p.fotos_max ?? 40);

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
    const m = $("conta-pedidos-msg");
    m.tabIndex = -1;
    m.focus();
  } catch (e) {
    aviso(e.message);
  }
}

// ---- Lista de espera e contactos (decisão do dono, 2026-10-10): o que está em config.js.
{
  const D = window.DOMUS ?? {};
  if (D.listaEspera?.ativa) {
    $("conta-espera").textContent = `Começamos as obras em ${D.listaEspera.arranque}. Até lá, os pedidos ficam em lista de espera, por ordem de chegada. Avisamos por email quando abrirmos. Descrever a casa e o relatório grátis já funcionam.`;
    $("conta-espera").hidden = false;
  }
  const tel = $("conta-contacto-tel"), mail = $("conta-contacto-email");
  if (D.telefone) { tel.href = `tel:${D.telefone}`; tel.textContent = `Ligar ${D.telefoneVisivel ?? D.telefone}`; tel.hidden = false; }
  if (D.email) { mail.href = `mailto:${D.email}`; mail.textContent = D.email; mail.hidden = false; }
}

// ---- As minhas casas (decisão do dono, 2026-10-10): até 5 por conta, cada uma com nome. Uma está aberta: a planta, os
// pedidos, o simulador e a área de cliente são os dessa. Abrir outra troca tudo (POST /api/conta/casas/:id/abrir).
// O simulador guarda a simulação neste navegador: ao mudar de casa apaga-se (a da casa aberta vem da conta), senão a
// de uma casa ia parar à outra. `CHAVE_CASA_ID` diz de que casa é o que está guardado no navegador.
const CHAVES_SIMULADOR = ["domus.simulador", "domus.simulador.casa"];
const CHAVE_CASA_ID = "domus.simulador.casa-id";
function acertarNavegador(casaId, forcar = false) {
  try {
    const tem = localStorage.getItem(CHAVE_CASA_ID);
    if (forcar || (tem && tem !== String(casaId))) for (const k of CHAVES_SIMULADOR) localStorage.removeItem(k);
    localStorage.setItem(CHAVE_CASA_ID, String(casaId));
  } catch { /* navegador sem armazenamento */ }
}
let variasCasas = false;
let casasVez = 0;
const casasMsg = (t, tipo = "erro") => { const m = $("conta-casas-msg"); m.textContent = t ?? ""; m.className = `msg ${tipo}`; m.hidden = !t; };
/** Faz um pedido às casas e redesenha tudo (a casa aberta pode ter mudado). `mudou`: a casa aberta é outra. */
async function pedirCasas(caminho, corpo, mudou = false) {
  casasMsg(null);
  try {
    const r = await pedirConta(caminho, { corpo });
    if (mudou) {
      const aberta = r.casas?.find((k) => k.aberta);
      if (aberta) acertarNavegador(aberta.id, true);
      location.hash = "";
      await bloco.atualizar();   // a conta inteira: planta, pedidos e atalhos são os da casa aberta
    } else pintarCasas(r);
    return true;
  } catch (e) {
    casasMsg(e?.message || "Não foi possível. Tente de novo.");
    return false;
  }
}
async function desenharCasas() {
  const vez = ++casasVez;
  let r;
  try { r = await pedirConta("casas"); } catch { return; }
  if (vez !== casasVez) return;
  const aberta = r.casas?.find((k) => k.aberta);
  if (aberta) acertarNavegador(aberta.id);
  pintarCasas(r);
}
function pintarCasas(r) {
  const casas = Array.isArray(r?.casas) ? r.casas : [];
  const antes = variasCasas;
  variasCasas = casas.length > 1;
  const aberta = casas.find((k) => k.aberta);
  $("conta-pedidos-titulo").textContent = variasCasas && aberta ? `Os meus pedidos · ${aberta.nome}` : "Os meus pedidos";
  if (antes !== variasCasas) carregar();
  const lista = $("conta-casas-lista");
  lista.replaceChildren(...casas.map((k) => {
    const li = el("li", k.aberta ? "conta-casa-linha aberta" : "conta-casa-linha");
    const topo = el("div", "conta-casa-topo");
    topo.append(el("strong", null, k.nome));
    if (k.aberta && variasCasas) topo.append(el("span", "selo-estado", "Aberta"));
    const partes = [k.pedidos === 1 ? "1 pedido" : `${k.pedidos} pedidos`, k.planta ? "planta desenhada" : "planta por desenhar"];
    if (k.instalada) partes.push("instalação feita");
    const acoes = el("div", "form-botoes");
    const botao = (texto, aoClicar, cls = "btn sec pequeno") => { const b = el("button", cls, texto); b.type = "button"; b.addEventListener("click", aoClicar); acoes.append(b); return b; };
    if (!k.aberta) botao("Abrir", () => pedirCasas(`casas/${k.id}/abrir`, {}, true), "btn pequeno").setAttribute("aria-label", `Abrir a casa ${k.nome}`);
    botao("Mudar o nome", () => {
      const rot = el("label", null, "Nome da casa");
      const campo = el("input");
      campo.maxLength = 40;
      campo.value = k.nome;
      rot.append(campo);
      const g = el("div", "form-botoes");
      const sim = el("button", "btn pequeno", "Guardar"), nao = el("button", "btn sec pequeno", "Cancelar");
      sim.type = nao.type = "button";
      sim.addEventListener("click", () => { if (campo.value.trim()) pedirCasas(`casas/${k.id}/nome`, { nome: campo.value }); else campo.focus(); });
      campo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sim.click(); } });
      nao.addEventListener("click", () => desenharCasas());
      g.append(sim, nao);
      li.replaceChildren(rot, g);
      campo.focus();
      campo.select();
    });
    if (casas.length > 1 && !k.pedidos && !k.instalada) {
      botao("Apagar", (e) => {
        const b = e.currentTarget;
        if (b.dataset.certeza) { pedirCasas(`casas/${k.id}/apagar`, {}, k.aberta); return; }
        b.dataset.certeza = "1";
        b.textContent = "Apagar mesmo? A planta desta casa perde-se.";
        b.className = "btn perigo pequeno";
      });
    }
    li.append(topo, el("p", "ajuda", partes.join(" · ")), acoes);
    return li;
  }));
  const cheio = casas.length >= (r?.max ?? 5);
  $("conta-casas-nova").hidden = cheio;
  $("conta-casas-cheio").hidden = !cheio;
  $("conta-casas-cheio").textContent = cheio ? `Tem ${casas.length} casas, o máximo por conta. Se precisar de mais, fale connosco.` : "";
}
$("conta-casas-nova").addEventListener("submit", async (e) => {
  e.preventDefault();
  const campo = $("conta-casas-nome");
  if (!campo.value.trim()) { casasMsg("Escreva o nome da casa nova."); campo.focus(); return; }
  $("conta-casas-adicionar").disabled = true;
  if (await pedirCasas("casas", { nome: campo.value }, true)) { campo.value = ""; casasMsg("Casa criada e aberta. Pode descrevê-la no simulador.", "ok"); }
  $("conta-casas-adicionar").disabled = false;
});
/** Uma ligação de email para um pedido de outra casa (conta.html#pedido-N): diz em que casa está e deixa abri-la. */
function avisoOutraCasa(noutras) {
  const n = /^#pedido-(\d+)$/.exec(location.hash)?.[1];
  const o = n ? (noutras ?? []).find((x) => String(x.id) === n) : null;
  if (!o) return;
  const m = $("conta-pedidos-msg");
  const b = el("button", "btn sec pequeno", `Abrir ${o.nome}`);
  b.type = "button";
  b.addEventListener("click", async () => {
    try {
      await pedirConta(`casas/${o.casa}/abrir`, { corpo: {} });
      acertarNavegador(o.casa, true);
      alvoMostrado = false;
      await bloco.atualizar();
    } catch (e) { mensagem(e?.message || "Não foi possível abrir essa casa."); }
  });
  m.replaceChildren(`O pedido n.º ${o.id} é da casa "${o.nome}". `, b);
  m.className = "msg info";
  m.hidden = false;
}

// ---- A minha casa (decisão do dono, 2026-10-10): a planta que o cliente desenhou no simulador, em pequeno, só de leitura.
let casaPedida = 0;
async function desenharCasa(eu) {
  const corpo = $("conta-minha-casa-corpo");
  const vez = ++casaPedida;
  const botao = (texto, href, id, principal = false) => { const a = el("a", principal ? "btn" : "btn sec", texto); a.href = href; a.id = id; return a; };
  const vazio = () => {
    const g = el("div", "form-botoes");
    g.append(botao(comecada ? "Continuar a descrever a casa" : variasCasas ? "Descrever esta casa" : "Descrever a minha casa", "simulador.html", "conta-casa-descrever", true));
    corpo.replaceChildren(el("p", null, comecada ? "Ainda não desenhou as divisões da casa. Continue de onde ficou: a planta aparece aqui." : (variasCasas ? "Ainda não descreveu esta casa." : "Ainda não descreveu a sua casa.") + " Demora cerca de 7 minutos e fica com um relatório grátis."), g);
  };
  let planta = null, comecada = false;
  try {
    const r = await pedirConta("simulacao");
    if (r?.estado) {
      comecada = true;
      const { normalizarEstado } = await import("./simulador/estado.js");
      planta = normalizarEstado(r.estado)?.planta ?? null;
    }
  } catch { /* sem planta: fica o convite */ }
  if (vez !== casaPedida) return;
  if (!planta?.divisoes?.length) { vazio(); return; }
  const { desenharPlanta, pisosDaPlanta } = await import("./simulador/planta-svg.js");
  if (vez !== casaPedida) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("previsao-svg", "conta-casa-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "A planta que desenhou");
  const L = Math.max(1, Number(planta.largura_cm) || 2000), A = Math.max(1, Number(planta.altura_cm) || 1500);
  const pisos = pisosDaPlanta(planta);
  // Só a parte da folha onde a casa está (com margem), para a planta não ficar pequena a um canto.
  const doPiso = planta.divisoes.filter((d) => (d.piso ?? 0) === pisos[0] && [d.x_cm, d.y_cm, d.largura_cm, d.altura_cm].every(Number.isFinite));
  let vista = { x: 0, y: 0, w: L, h: A };
  if (doPiso.length) {
    const M = 60;
    const x0 = Math.max(0, Math.min(...doPiso.map((d) => d.x_cm)) - M), y0 = Math.max(0, Math.min(...doPiso.map((d) => d.y_cm)) - M);
    const x1 = Math.min(L, Math.max(...doPiso.map((d) => d.x_cm + d.largura_cm)) + M), y1 = Math.min(A, Math.max(...doPiso.map((d) => d.y_cm + d.altura_cm)) + M);
    if (x1 > x0 && y1 > y0) vista = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  svg.style.aspectRatio = `${vista.w} / ${vista.h}`;
  desenharPlanta(svg, planta, { soLeitura: true, grelha: false, vista, ...(pisos.length > 1 ? { piso: pisos[0] } : {}) });
  const nd = planta.divisoes.length, ne = (planta.elementos ?? []).length;
  const resumo = el("p", null, `${nd} ${nd === 1 ? "divisão" : "divisões"} · ${ne} ${ne === 1 ? "peça" : "peças"} na planta${pisos.length > 1 ? ` · ${pisos.length} pisos (à vista: o primeiro)` : ""}`);
  const g = el("div", "form-botoes");
  g.append(botao("Alterar a casa", "simulador.html", "conta-casa-alterar"));
  if (!eu.tem_casa) g.append(botao("Ver em grande", "cliente.html", "conta-casa-ver"));
  corpo.replaceChildren(svg, resumo, g);
}

// ---- Os meus dados: POST /api/conta/dados (um campo vazio apaga-o).
const CAMPOS_DADOS = ["nome", "telefone", "morada", "localidade"];
function preencherDados(conta) {
  for (const k of CAMPOS_DADOS) $(`conta-dados-${k}`).value = conta?.[k] ?? "";
}
$("conta-dados-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const m = $("conta-dados-msg"), b = $("conta-dados-guardar");
  const dizer = (t, tipo) => { m.textContent = t; m.className = `msg ${tipo}`; m.hidden = !t; };
  b.disabled = true;
  try {
    const r = await pedirConta("dados", { corpo: Object.fromEntries(CAMPOS_DADOS.map((k) => [k, $(`conta-dados-${k}`).value])) });
    preencherDados(r.conta);
    dizer("Dados guardados.", "ok");
  } catch (erro) {
    dizer(erro?.message || "Não foi possível guardar. Tente de novo.", "erro");
  } finally { b.disabled = false; }
});

// ---- Palavra-passe (opcional; fase 3 da auditoria): a conta entra com código; quem quiser define-a aqui → POST /api/conta/palavra-passe.
let temSenha = false;
const senhaMsg = (t, tipo = "erro") => {
  const m = $("conta-senha-msg");
  m.textContent = t ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !t;
};
/** Os textos da palavra-passe e do apagar seguem a conta: com palavra-passe confirma-se com ela; sem, com um código. */
function desenharSenha(tem) {
  temSenha = tem;
  $("conta-senha-estado").textContent = tem ? "Entra com código ou com a sua palavra-passe." : "Entra com um código enviado ao email. Se preferir, defina uma palavra-passe.";
  $("conta-senha-abrir").textContent = tem ? "Mudar a palavra-passe" : "Definir palavra-passe";
  $("conta-apagar-como").replaceChildren(el("strong", null, "Tem a certeza?"), ` Isto não se desfaz. Para confirmar, ${tem ? "escreva a sua palavra-passe." : "peça um código para o email e escreva-o aqui."}`);
  $("conta-apagar-rotulo").firstChild.textContent = tem ? "Palavra-passe" : "Código de 6 algarismos";
  const i = $("conta-apagar-senha");
  i.type = tem ? "password" : "text";
  i.autocomplete = tem ? "current-password" : "one-time-code";
  i.inputMode = tem ? "text" : "numeric";
  $("conta-apagar-codigo-caixa").hidden = tem;
}
$("conta-senha-abrir").addEventListener("click", () => {
  $("conta-senha-form").hidden = false;
  $("conta-senha-abrir").hidden = true;
  $("conta-senha-1").focus();
});
$("conta-senha-nao").addEventListener("click", () => {
  $("conta-senha-form").hidden = true;
  $("conta-senha-abrir").hidden = false;
  $("conta-senha-1").value = $("conta-senha-2").value = "";
  senhaMsg(null);
});
for (const k of ["conta-senha-1", "conta-senha-2"]) $(k).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("conta-senha-guardar").click(); } });
$("conta-senha-guardar").addEventListener("click", async () => {
  const b = $("conta-senha-guardar");
  const s1 = $("conta-senha-1").value, s2 = $("conta-senha-2").value;
  if (s1.length < 10) { senhaMsg("A palavra-passe deve ter pelo menos 10 caracteres."); $("conta-senha-1").focus(); return; }
  if (s1 !== s2) { senhaMsg("As duas palavras-passe não são iguais."); $("conta-senha-2").focus(); return; }
  if (b.disabled) return;
  b.disabled = true;
  try {
    const r = await pedirConta("palavra-passe", { corpo: { password: s1 } });
    desenharSenha(Boolean(r.conta?.tem_password));
    $("conta-senha-1").value = $("conta-senha-2").value = "";
    $("conta-senha-form").hidden = true;
    $("conta-senha-abrir").hidden = false;
    mensagem("Palavra-passe guardada. Já pode entrar com ela.", "ok");
  } catch (e) {
    senhaMsg(e.message);
  }
  b.disabled = false;
});

// ---- Apagar a minha conta (RGPD): confirmação na página com a palavra-passe (ou um código, sem palavra-passe) → POST /api/conta/apagar; a sessão acaba.
const apagarMsg = (t, tipo = "erro") => {
  const m = $("conta-apagar-msg");
  m.textContent = t ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !t;
};
$("conta-apagar-abrir").addEventListener("click", () => {
  $("conta-apagar-confirmar").hidden = false;
  $("conta-apagar-abrir").hidden = true;
  (temSenha ? $("conta-apagar-senha") : $("conta-apagar-codigo")).focus();
});
$("conta-apagar-codigo").addEventListener("click", async () => {
  const b = $("conta-apagar-codigo");
  if (b.disabled) return;
  b.disabled = true;
  try {
    await pedirConta("codigo", { corpo: { email: emailDaConta } });
    apagarMsg("Enviámos um código para o seu email (vale 15 minutos).", "info");
    $("conta-apagar-senha").focus();
  } catch (e) {
    apagarMsg(e.message);
  }
  b.disabled = false;
});
$("conta-apagar-nao").addEventListener("click", () => {
  $("conta-apagar-confirmar").hidden = true;
  $("conta-apagar-abrir").hidden = false;
  $("conta-apagar-senha").value = "";
  apagarMsg(null);
});
$("conta-apagar-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("conta-apagar-sim").click(); } });
$("conta-apagar-sim").addEventListener("click", async () => {
  const b = $("conta-apagar-sim");
  const senha = $("conta-apagar-senha").value.trim();
  if (!senha) { apagarMsg(temSenha ? "Escreva a palavra-passe para confirmar." : "Escreva o código que lhe enviámos."); $("conta-apagar-senha").focus(); return; }
  if (b.disabled) return;
  b.disabled = true;
  apagarMsg("A apagar a conta…", "info");
  try {
    await pedirConta("apagar", { corpo: temSenha ? { password: senha } : { codigo: senha.replace(/\s/g, "") } });
  } catch (e) {
    b.disabled = false;
    apagarMsg(e.message);
    return;
  }
  marcarSessao(false);
  $("conta-apagar-senha").value = "";
  $("conta-apagar-confirmar").hidden = true;
  $("conta-apagar-abrir").hidden = false;
  b.disabled = false;
  apagarMsg(null);
  // Sem sessão o bloco volta a "Entrar" (e #conta-dentro esconde-se): a confirmação vai na mensagem do próprio bloco.
  await bloco.atualizar();
  bloco.mensagem("A sua conta foi apagada. Obrigado por ter usado a Domus Energia.", "ok");
});

$("ano").textContent = String(new Date().getFullYear());
bloco.atualizar();
