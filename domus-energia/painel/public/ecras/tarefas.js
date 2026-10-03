// Quadro de tarefas (docs/CRM-TAREFAS.md): "Quadro" (A fazer / Em curso / Feito; arrastar entre colunas com o rato, ou
// "Mover para" em cada cartão — teclado e leitores de ecrã), "As minhas" (lista) e "Semana" (tarefas com prazo e as
// obras agendadas, estas só para consulta). Ficha (#/tarefas/<id>) com a checklist; "Nova tarefa" (#/tarefas/nova,
// opcionalmente ?cliente=<id>). Os lembretes automáticos do CRM aparecem aqui com o selo "Automática".
// Só o CEO vê e atribui as tarefas de todos (e edita os prazos dos lembretes automáticos); o comercial e o técnico só
// as suas (atribuídas a eles ou criadas por eles) e só as atribuem a si. Técnico: ligadas no máximo às suas obras.
import { pedir, campo, lista, numero } from "../api.js";
import { h, ESTADOS_TAREFA, ESTADOS_OBRA, data, selo, campoForm, escolha, janela, mensagem, avisar, carregando, erroEcra, txt, isoDia, diaSemana, botaoConfirmar } from "../ui.js";

const CHAVE_VISTA = "domus.painel.tarefas.vista";
const ler = () => { try { return localStorage.getItem(CHAVE_VISTA); } catch { return null; } };
const gravar = (v) => { try { localStorage.setItem(CHAVE_VISTA, v); } catch {} };
const NOME_LEMBRETE = { novo_24h: "Pedido novo sem contacto", visita_2d: "Visita feita, proposta por enviar", proposta_3d: "Proposta sem resposta", proposta_7d: "Proposta sem resposta (2.º aviso)", proposta_14d: "Proposta: perdido?",
  pagamento_falta: "Pagamento em falta", avaliacao_baixa: "Avaliação baixa", obra_confirmar: "Obra por confirmar" };
/** Prazos dos lembretes automáticos (config-orcamento, só o CEO): [chave, etiqueta, omissão, mínimo, máximo]. */
const PRAZOS_LEMBRETES = [
  ["lembrete_novo_dias_uteis", "Pedido novo sem contacto (dias úteis)", 1, 1, 10],
  ["lembrete_visita_dias", "Visita feita, proposta por enviar (dias)", 2, 1, 30],
  ["lembrete_proposta_1_dias", "Proposta sem resposta: 1.º aviso (dias)", 3, 1, 30],
  ["lembrete_proposta_2_dias", "Proposta sem resposta: 2.º aviso (dias)", 7, 2, 60],
  ["lembrete_proposta_3_dias", "Proposta sem resposta: \"Perdido?\" (dias)", 14, 3, 90],
];
/** Emails automáticos ao cliente (docs/EMAILS-AUTOMATICOS.md; config-orcamento, só o CEO): [chave, etiqueta, omissão, mínimo, máximo]. */
const PRAZOS_EMAILS = [
  ["email_pagamento_1_dias", "Pagamento em falta: 1.º lembrete (dias)", 3, 1, 30],
  ["email_pagamento_2_dias", "Pagamento em falta: 2.º lembrete e tarefa (dias)", 7, 2, 60],
  ["email_obra_dias", "Depois da obra: guia e pedido de avaliação (dias)", 2, 1, 30],
  ["email_visita_hora", "Lembrete da visita, na véspera (hora, 8 a 20)", 10, 8, 20],
];
/** Avisa o menu (contagem de atrasadas/hoje) de que as tarefas mudaram. */
const avisarMenu = () => document.dispatchEvent(new CustomEvent("domus:tarefas"));

export default function tarefas(el, ctx) {
  const ctrl = new AbortController();
  const tecnico = ctx.pode("tecnico"), ceo = ctx.pode("ceo");
  let vista = ["quadro", "minhas", "semana"].includes(ler()) ? ler() : "quadro";
  let todas = [];
  let equipa = [];
  let semana = null;     // resposta de GET tarefas/calendario
  let inicioSemana = null;
  let ficha = null;

  const segmentos = h("div", { class: "segmentos", role: "group", "aria-label": "Mostrar" },
    ...[["quadro", "Quadro"], ["minhas", "As minhas"], ["semana", "Semana"]].map(([v, t]) =>
      h("button", { class: "segmento", type: "button", dataset: { vista: v }, text: t, "aria-pressed": "false", onclick: () => { vista = v; gravar(v); if (v === "semana" && !semana) carregarSemana(); else desenhar(); } })));
  const fResp = escolha("responsavel", { "": "Todos os responsáveis" }, "", { "aria-label": "Filtrar o quadro por responsável" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "zona-tarefas" }, carregando());
  el.append(...[h("div", { class: "ecra-topo" }, h("h1", { text: "Tarefas" }), segmentos,
    h("a", { class: "btn", href: "#/tarefas/nova", id: "nova-tarefa", text: "Nova tarefa" })),
    ceo ? h("div", { class: "filtros" }, fResp) : null, contagem, zona, ceo ? blocoLembretes() : null, ceo ? blocoEmails() : null].filter(Boolean));
  fResp.addEventListener("change", desenhar);

  /** Prazos dos lembretes automáticos (só o CEO): lidos ao abrir o bloco, guardados em config-orcamento. */
  function blocoLembretes() {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const fr = h("form", { class: "form-grelha", id: "form-lembretes", novalidate: true },
      h("p", { class: "ajuda", text: "Quando nasce cada lembrete automático. O do pedido novo conta dias úteis (segunda a sexta); os outros, dias seguidos. Os três da proposta têm de ser crescentes." }),
      ...PRAZOS_LEMBRETES.map(([k, etiqueta, omissao, min, max]) => campoForm(etiqueta, h("input", { type: "number", name: k, min: String(min), max: String(max), step: "1", inputmode: "numeric", value: String(omissao), required: true }))),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", text: "Guardar prazos" })), msg);
    const preencher = (cfg) => { for (const [k, , omissao] of PRAZOS_LEMBRETES) fr.elements[k].value = String(numero(campo(cfg, k)) ?? omissao); };
    let lido = false;
    const det = h("details", { class: "grupo lembretes-config", id: "lembretes-config" }, h("summary", { text: "Lembretes automáticos: prazos (CEO)" }), fr);
    det.addEventListener("toggle", async () => {
      if (!det.open || lido) return;
      try { preencher(await pedir("config-orcamento", { sinal: ctrl.signal })); lido = true; }
      catch (e) { if (e.name !== "AbortError") mensagem(msg, e.message); }
    });
    fr.addEventListener("submit", async (e) => {
      e.preventDefault();
      const corpo = {};
      for (const [k, etiqueta, , min, max] of PRAZOS_LEMBRETES) {
        const v = numero(fr.elements[k].value);
        if (v === null || !Number.isInteger(v) || v < min || v > max) { mensagem(msg, `${etiqueta}: um número inteiro entre ${min} e ${max}.`); fr.elements[k].focus(); return; }
        corpo[k] = v;
      }
      const b = fr.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try { preencher(await pedir("config-orcamento", { corpo }) ?? corpo); avisar("Prazos dos lembretes guardados."); recarregar(); }
      catch (erro) { mensagem(msg, erro.message); }
      b.disabled = false;
    });
    return det;
  }

  /** Emails automáticos ao cliente (só o CEO): os prazos e a ligação da avaliação no Google, em config-orcamento. */
  function blocoEmails() {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const google = h("input", { type: "url", name: "google_avaliacao_url", maxlength: "300", placeholder: "https://g.page/r/…/review", inputmode: "url" });
    const fr = h("form", { class: "form-grelha", id: "form-emails", novalidate: true },
      h("p", { class: "ajuda", text: "Emails que o cliente recebe sozinho: pedido recebido, lembrete da visita na véspera, pagamento em falta (dois lembretes e depois uma tarefa para o CEO) e, depois da obra, o guia com o pedido de avaliação. Nunca saem entre as 21:00 e as 08:00." }),
      ...PRAZOS_EMAILS.map(([k, etiqueta, omissao, min, max]) => campoForm(etiqueta, h("input", { type: "number", name: k, min: String(min), max: String(max), step: "1", inputmode: "numeric", value: String(omissao), required: true }))),
      campoForm("Ligação da avaliação no Google", google, "Depois de avaliar na conta, todos os clientes veem o convite para a avaliação pública no Google, com qualquer número de estrelas. Vazia: não há convite."),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", text: "Guardar emails automáticos" })), msg);
    // Só leitura: desde quando contam (o dia da publicação); o que aconteceu antes não recebe emails automáticos.
    const desde = h("p", { class: "ajuda", id: "emails-inicio", hidden: true });
    fr.prepend(desde);
    const preencher = (cfg) => {
      const ini = campo(cfg, "emails_auto_inicio");
      if (typeof ini === "string" && ini) { desde.textContent = `Ativos desde ${data(ini)}: pedidos, propostas aceites e obras concluídas antes dessa data não recebem emails automáticos (o lembrete da visita vale para todas as visitas futuras).`; desde.hidden = false; }
      for (const [k, , omissao] of PRAZOS_EMAILS) fr.elements[k].value = String(numero(campo(cfg, k)) ?? omissao);
      const g = campo(cfg, "google_avaliacao_url");
      google.value = typeof g === "string" ? g : "";
    };
    let lido = false;
    const det = h("details", { class: "grupo lembretes-config", id: "emails-config" }, h("summary", { text: "Emails automáticos ao cliente (CEO)" }), fr);
    det.addEventListener("toggle", async () => {
      if (!det.open || lido) return;
      try { preencher(await pedir("config-orcamento", { sinal: ctrl.signal })); lido = true; }
      catch (e) { if (e.name !== "AbortError") mensagem(msg, e.message); }
    });
    fr.addEventListener("submit", async (e) => {
      e.preventDefault();
      const corpo = { google_avaliacao_url: google.value.trim() };
      for (const [k, etiqueta, , min, max] of PRAZOS_EMAILS) {
        const v = numero(fr.elements[k].value);
        if (v === null || !Number.isInteger(v) || v < min || v > max) { mensagem(msg, `${etiqueta}: um número inteiro entre ${min} e ${max}.`); fr.elements[k].focus(); return; }
        corpo[k] = v;
      }
      const b = fr.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try { preencher(await pedir("config-orcamento", { corpo }) ?? corpo); avisar("Emails automáticos guardados."); }
      catch (erro) { mensagem(msg, erro.message); }
      b.disabled = false;
    });
    return det;
  }

  async function carregar() {
    try {
      const r = await pedir("tarefas", { sinal: ctrl.signal });
      todas = lista(r, "tarefas");
      equipa = lista(r, "equipa");
    } catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    const v = fResp.value;
    fResp.replaceChildren(h("option", { value: "", text: "Todos os responsáveis" }), h("option", { value: "ceo", text: "Sem responsável (CEO)" }),
      ...equipa.map((u) => h("option", { value: String(u.id), text: u.nome })));
    fResp.value = v;
    desenhar();
  }
  async function carregarSemana(de = inicioSemana) {
    zona.replaceChildren(carregando());
    try { semana = await pedir(`tarefas/calendario${de ? `?de=${de}` : ""}`, { sinal: ctrl.signal }); inicioSemana = semana.inicio; }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, () => carregarSemana(de))); return; }
    desenhar();
  }
  const recarregar = () => { carregar(); if (semana) carregarSemana(); avisarMenu(); };

  function desenhar() {
    segmentos.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vista === vista)));
    fResp.closest(".filtros")?.toggleAttribute("hidden", vista !== "quadro");
    if (vista === "semana") return desenharSemana();
    const minha = (t) => t.responsavel_id === ctx.eu.id || (t.responsavel_id === null && ctx.pode("ceo"));
    let vis = vista === "minhas" ? todas.filter(minha) : todas;
    if (vista === "quadro" && fResp.value) vis = vis.filter((t) => (fResp.value === "ceo" ? t.responsavel_id === null : String(t.responsavel_id) === fResp.value));
    const abertas = vis.filter((t) => t.estado !== "feito");
    const atrasadas = abertas.filter((t) => t.atrasada).length;
    contagem.textContent = `${abertas.length} por fazer${atrasadas ? ` · ${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}` : ""}`;
    if (vista === "minhas") {
      const ordem = [...abertas, ...vis.filter((t) => t.estado === "feito")];
      zona.replaceChildren(ordem.length ? h("ul", { class: "linhas", id: "lista-minhas" }, ...ordem.map((t) => h("li", {}, cartao(t, true))))
        : h("p", { class: "vazio", text: "Não tem tarefas." }));
      return;
    }
    zona.replaceChildren(h("div", { class: "quadro quadro-tarefas", id: "quadro-tarefas" }, ...Object.entries(ESTADOS_TAREFA).map(([k, nome]) => {
      const col = vis.filter((t) => t.estado === k);
      const sec = h("section", { class: `coluna coluna-tarefa-${k}`, dataset: { estado: k }, "aria-label": `${nome}: ${col.length}` },
        h("h2", {}, nome, " ", h("span", { class: "contagem num", text: String(col.length) })),
        col.length ? h("ul", { class: "cartoes-orc" }, ...col.map((t) => h("li", { draggable: "true", dataset: { id: String(t.id) } }, cartao(t)))) : h("p", { class: "vazio", text: "Nenhuma." }));
      // Arrastar com o rato: largar numa coluna muda o estado (a alternativa de teclado é o "Mover para" do cartão).
      sec.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/plain")) { e.preventDefault(); sec.classList.add("largar"); } });
      sec.addEventListener("dragleave", () => sec.classList.remove("largar"));
      sec.addEventListener("drop", (e) => {
        e.preventDefault(); sec.classList.remove("largar");
        const t = todas.find((x) => String(x.id) === e.dataTransfer.getData("text/plain"));
        if (t && t.estado !== k) mover(t, k);
      });
      return sec;
    })));
    zona.querySelectorAll("li[draggable]").forEach((li) => li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", li.dataset.id); e.dataTransfer.effectAllowed = "move"; }));
  }

  function cartao(t, comEstado = false) {
    const ligacoes = [t.cliente_nome ? `Cliente: ${t.cliente_nome}` : null, t.orcamento_id ? `Pedido n.º ${t.orcamento_id}` : null, t.obra_id ? `Obra n.º ${t.obra_id}` : null].filter(Boolean).join(" · ");
    const feitos = t.checklist?.filter((x) => x.feito).length ?? 0;
    const sMover = escolha("mover", ESTADOS_TAREFA, t.estado, { "aria-label": `Mover "${t.titulo}" para`, class: "mover-tarefa" });
    sMover.addEventListener("change", () => { const tt = todas.find((x) => x.id === t.id); if (tt && sMover.value !== tt.estado) mover(tt, sMover.value); });
    return h("div", { class: `cartao-tarefa${t.atrasada ? " atrasada" : ""}${t.estado === "feito" ? " feita" : ""}` },
      h("a", { class: "titulo-tarefa", href: `#/tarefas/${encodeURIComponent(t.id)}`, text: t.titulo }),
      ligacoes ? h("span", { class: "ajuda", text: ligacoes }) : null,
      h("span", { class: "linha-selos" },
        comEstado ? selo(ESTADOS_TAREFA[t.estado] ?? t.estado) : null,
        t.prazo ? selo(`${t.atrasada ? "Atrasada: " : t.hoje ? "Hoje" : ""}${t.hoje && !t.atrasada ? "" : data(t.prazo)}${t.prazo_hora ? ` ${t.prazo_hora}` : ""}`, t.atrasada ? "grav-critica" : t.hoje ? "aviso" : "valor") : null,
        t.automatica ? selo(`Automática: ${NOME_LEMBRETE[t.automatica] ?? "lembrete"}`, "info") : null,
        t.checklist?.length ? selo(`${feitos}/${t.checklist.length}`, "valor") : null),
      h("span", { class: "ajuda", text: t.responsavel_nome ?? (t.responsavel_id === null ? "CEO" : "—") }),
      h("label", { class: "mover-rotulo" }, h("span", { class: "ajuda", text: "Mover para" }), sMover));
  }
  async function mover(t, estado) {
    try {
      const nova = await pedir(`tarefas/${encodeURIComponent(t.id)}`, { corpo: { estado } });
      const i = todas.findIndex((x) => x.id === t.id);
      if (i >= 0) todas[i] = nova;
      desenhar();
      avisar(`"${t.titulo}": ${ESTADOS_TAREFA[estado]}.`);
      avisarMenu();
      // Depois de redesenhar, o foco volta ao "Mover para" do cartão (teclado).
      zona.querySelector(`li[data-id="${t.id}"] .mover-tarefa, [href="#/tarefas/${t.id}"]`)?.focus();
    } catch (erro) { avisar(erro.message, "erro"); desenhar(); }
  }

  function desenharSemana() {
    if (!semana) { zona.replaceChildren(carregando()); return; }
    const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-PT", { day: "numeric", month: "long" });
    contagem.textContent = `${semana.tarefas.length} tarefas e ${semana.obras.length} obras nesta semana`;
    const somar = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return isoDia(x); };
    zona.replaceChildren(h("section", { class: "cartao bloco-agenda" },
      h("div", { class: "agenda-topo" }, h("h2", { id: "semana-tarefas-titulo", "aria-live": "polite", text: `Semana de ${f(semana.inicio)} a ${f(semana.fim)}` }),
        h("div", { class: "form-botoes" },
          h("button", { class: "btn sec pequeno", type: "button", "aria-label": "Semana anterior", text: "‹ Anterior", onclick: () => carregarSemana(somar(semana.inicio, -7)) }),
          h("button", { class: "btn sec pequeno", type: "button", text: "Esta semana", onclick: () => carregarSemana(isoDia(new Date())) }),
          h("button", { class: "btn sec pequeno", type: "button", "aria-label": "Semana seguinte", text: "Seguinte ›", onclick: () => carregarSemana(somar(semana.inicio, 7)) }))),
      h("div", { class: "agenda", id: "semana-tarefas" }, ...semana.dias.map((dia) => {
        const ts = semana.tarefas.filter((t) => t.prazo === dia);
        const os = semana.obras.filter((b) => b.data === dia);
        const d = new Date(`${dia}T12:00:00`);
        return h("section", { class: `dia ${dia === semana.hoje ? "hoje" : ""} ${ts.length || os.length ? "" : "sem-obras"}`.trim(), dataset: { dia }, "aria-label": diaSemana(d) },
          h("h3", {}, h("span", { text: d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "") }), " ", h("span", { class: "num", text: String(d.getDate()) }), dia === semana.hoje ? h("span", { class: "selo-p hoje", text: "Hoje" }) : null),
          ts.length || os.length ? h("ul", { class: "obras-dia" },
            ...ts.map((t) => h("li", {}, h("a", { class: `obra tarefa-semana${t.estado === "feito" ? " obra-concluida" : t.atrasada ? " obra-cancelada" : ""}`, href: `#/tarefas/${encodeURIComponent(t.id)}` },
              h("strong", { text: t.titulo }), h("span", { class: "ajuda", text: `${t.prazo_hora ? `${t.prazo_hora} · ` : ""}${ESTADOS_TAREFA[t.estado]}` })))),
            ...os.map((b) => h("li", {}, h("a", { class: `obra obra-${b.estado}`, href: `#/obras/${encodeURIComponent(b.id)}` },
              h("strong", { text: `Obra: ${b.cliente_nome ?? `n.º ${b.id}`}` }), h("span", { class: "ajuda", text: `${b.hora ? `${b.hora} · ` : ""}${ESTADOS_OBRA[b.estado] ?? b.estado}${b.por_agendar ? " · por agendar" : ""}` })))))
            : h("p", { class: "vazio", text: "—" }));
      })),
      h("p", { class: "ajuda", text: "As obras aparecem só para consulta: mudam-se no ecrã Obras." })));
  }

  // ---------- Ficha / nova tarefa ----------
  let clientes = null, obras = null;
  async function opcoesLigacao() {
    if (!tecnico && !clientes) clientes = await pedir("crm/clientes").then((r) => lista(r, "clientes").filter((c) => !c.anonimizado)).catch(() => []);
    if (!obras) obras = await pedir("obras").then((r) => lista(r, "obras").filter((b) => b.estado !== "cancelada")).catch(() => []);
  }

  async function abrirFicha(chave) {
    if (ficha?.chave === chave) return;
    ficha?.j.fechar();
    const nova = chave.startsWith("nova");
    const j = janela(nova ? "Nova tarefa" : "Tarefa", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash.split("?")[0] === `#/tarefas/${chave.split("?")[0]}`) ctx.navegar("tarefas"); } });
    ficha = { chave, j };
    j.corpo.append(carregando());
    await Promise.all([esperar, opcoesLigacao()]);
    if (ficha?.j !== j) return;
    if (nova) {
      const cliente = Number(new URLSearchParams(chave.split("?")[1] ?? "").get("cliente")) || null;
      desenharFicha(j, { id: null, titulo: "", estado: "a_fazer", checklist: [], responsavel_id: ctx.eu.id, cliente_id: cliente });
      return;
    }
    const t = todas.find((x) => String(x.id) === chave);
    if (!t) { j.corpo.replaceChildren(h("p", { class: "vazio", text: "Tarefa não encontrada (ou já feita há mais de 30 dias)." })); return; }
    desenharFicha(j, t);
  }

  function desenharFicha(j, t) {
    const nova = t.id === null;
    if (!nova) j.titulo.textContent = t.titulo;
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const checklist = (t.checklist ?? []).map((x) => ({ ...x }));
    const listaCh = h("ul", { class: "checklist", id: "checklist-tarefa" });
    const desenharCh = () => listaCh.replaceChildren(...(checklist.length ? checklist.map((x, i) => h("li", {},
      h("label", { class: "caixa" }, h("input", { type: "checkbox", checked: x.feito, onchange: (e) => { checklist[i].feito = e.target.checked; } }), x.texto),
      h("button", { class: "botao-icone pequeno", type: "button", "aria-label": `Tirar "${x.texto}"`, text: "×", onclick: () => { checklist.splice(i, 1); desenharCh(); } }))) : [h("li", { class: "vazio", text: "Sem itens." })]));
    desenharCh();
    const novoItem = h("input", { name: "novo_item", maxlength: "200", placeholder: "ex.: Confirmar material", "aria-label": "Item a acrescentar à checklist" });
    const juntar = () => { const v = novoItem.value.trim(); if (!v) return; checklist.push({ texto: v, feito: false }); novoItem.value = ""; desenharCh(); novoItem.focus(); };
    novoItem.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); juntar(); } });
    const opcoesResp = ceo ? { "": "Sem responsável (os CEO)", ...Object.fromEntries(equipa.map((u) => [String(u.id), u.nome])) } : { [String(ctx.eu.id)]: ctx.eu.nome };
    // Uma tarefa que criei e que o CEO passou a outra pessoa: vê-se de quem é (só o CEO a atribui a outra pessoa).
    if (!ceo && !nova && t.responsavel_id !== ctx.eu.id) opcoesResp[t.responsavel_id == null ? "" : String(t.responsavel_id)] = t.responsavel_nome ?? "Sem responsável (os CEO)";
    const opClientes = { "": "Nenhum", ...Object.fromEntries((clientes ?? []).map((c) => [String(c.id), c.nome ?? `n.º ${c.id}`])) };
    if (t.cliente_id && !opClientes[String(t.cliente_id)]) opClientes[String(t.cliente_id)] = t.cliente_nome ?? `n.º ${t.cliente_id}`;
    const opObras = { "": "Nenhuma", ...Object.fromEntries((obras ?? []).map((b) => [String(b.id), `n.º ${b.id} · ${txt(b, "cliente_nome", "cliente")} · ${data(b.data, { hora: false })}`])) };
    if (t.obra_id && !opObras[String(t.obra_id)]) opObras[String(t.obra_id)] = `n.º ${t.obra_id}`;
    const f = h("form", { class: "form-grelha", id: "form-tarefa", novalidate: true },
      t.automatica ? h("p", { class: "msg info", text: "Lembrete automático do CRM: some sozinho quando a fase do pedido avança. Marque-o como feito quando tratar dele." }) : null,
      campoForm("Título", h("input", { name: "titulo", maxlength: "160", required: true, value: t.titulo ?? "" })),
      campoForm("Descrição", h("textarea", { name: "descricao", rows: "3", maxlength: "4000" }, t.descricao ?? "")),
      h("div", { class: "tres" },
        campoForm("Estado", escolha("estado", ESTADOS_TAREFA, t.estado)),
        campoForm("Prazo", h("input", { type: "date", name: "prazo", value: t.prazo ?? "" })),
        campoForm("Hora (opcional)", h("input", { type: "time", name: "prazo_hora", value: t.prazo_hora ?? "" }))),
      h("div", { class: "tres" },
        campoForm("Responsável", escolha("responsavel_id", opcoesResp, t.responsavel_id == null ? "" : String(t.responsavel_id))),
        tecnico ? null : campoForm("Cliente", escolha("cliente_id", opClientes, t.cliente_id ? String(t.cliente_id) : "")),
        campoForm("Obra", escolha("obra_id", opObras, t.obra_id ? String(t.obra_id) : ""))),
      t.orcamento_id ? h("p", { class: "ajuda" }, "Ligada ao ", tecnico ? `pedido n.º ${t.orcamento_id}` : h("a", { href: `#/orcamentos/${encodeURIComponent(t.orcamento_id)}`, text: `pedido n.º ${t.orcamento_id}` }), ".") : null,
      t.cliente_id && !tecnico ? h("p", { class: "ajuda" }, h("a", { href: `#/crm/${encodeURIComponent(t.cliente_id)}`, text: "Abrir a ficha do cliente" })) : null,
      h("fieldset", { class: "grupo" }, h("legend", { text: "Checklist" }), listaCh,
        h("div", { class: "linha-juntar" }, novoItem, h("button", { class: "btn sec pequeno", type: "button", text: "Acrescentar", onclick: juntar }))),
      nova ? null : h("p", { class: "ajuda", text: `Criada ${data(t.criado)} por ${t.criado_por ?? "—"}${t.feito ? ` · feita ${data(t.feito)} por ${t.feito_por}` : ""}` }),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: nova ? "Criar tarefa" : "Guardar tarefa" }),
        !nova && !t.automatica ? botaoConfirmar("Apagar", "Confirmar: apagar?", async (b) => {
          b.disabled = true;
          try { await pedir(`tarefas/${encodeURIComponent(t.id)}/apagar`, { corpo: {} }); avisar("Tarefa apagada."); j.fechar(); recarregar(); }
          catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
        }) : null),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      if (!el.titulo.value.trim()) { mensagem(msg, "Escreva o título."); el.titulo.focus(); return; }
      if (el.prazo_hora.value && !el.prazo.value) { mensagem(msg, "Escolha o dia do prazo (a hora é opcional)."); el.prazo.focus(); return; }
      const num = (v) => (v ? Number(v) : null);
      const corpo = {
        titulo: el.titulo.value.trim(), descricao: el.descricao.value.trim() || null, estado: el.estado.value,
        prazo: el.prazo.value || null, prazo_hora: el.prazo_hora.value || null, responsavel_id: num(el.responsavel_id.value),
        obra_id: num(el.obra_id.value), checklist: checklist.map((x) => ({ texto: x.texto, feito: Boolean(x.feito) })),
      };
      if (!tecnico) corpo.cliente_id = num(el.cliente_id.value);
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(nova ? "tarefas" : `tarefas/${encodeURIComponent(t.id)}`, { corpo });
        avisar(nova ? "Tarefa criada." : "Tarefa guardada.");
        recarregar();
        if (nova) j.fechar(); else { b.disabled = false; Object.assign(t, r); j.titulo.textContent = r.titulo; }
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    j.corpo.replaceChildren(f);
    if (nova) f.elements.titulo.focus();
  }

  const esperar = carregar();
  if (vista === "semana") carregarSemana();
  const api = {
    rota(resto) { if (resto[0]) abrirFicha(resto.join("/")); else { ficha?.j.fechar(); ficha = null; } },
    desmontar: () => ctrl.abort(),
  };
  api.rota(ctx.resto);
  return api;
}
