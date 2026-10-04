// CRM (docs/CRM-TAREFAS.md): o funil dos pedidos por fase (contagem e valor), a lista dos pedidos com filtros (fase,
// origem, concelho, responsável, datas) e as fichas de cliente (#/crm/<id>): contactos, pedidos com a fase, o
// responsável e a origem, pagamentos, obras, relatórios, trabalhos de eletricistas (CEO, com o módulo ligado), tarefas
// e o histórico de notas e contactos da equipa. A fase muda-se no pedido (POST orcamentos/:id, as regras de sempre).
// O CEO junta fichas da mesma pessoa e separa um pedido para uma ficha nova. As tarefas da ficha: o CEO vê todas, os
// outros só as suas. Técnico: só os clientes das suas obras, lê as notas e regista visitas.
import { pedir, campo, lista } from "../api.js";
import {
  h, FASES_CRM, ESTADO_DA_FASE, ORIGENS_CONTACTO, ENTRADAS, MOTIVOS_PERDA, TIPOS_REGISTO, ESTADOS_TAREFA, ESTADOS_OBRA, NOMES_ESTADO_ORC,
  euros, data, selo, campoForm, escolha, dados, janela, mensagem, avisar, carregando, erroEcra, txt, isoDia, botaoConfirmar,
} from "../ui.js";

const CHAVE_VISTA = "domus.painel.crm.vista";
const ler = () => { try { return localStorage.getItem(CHAVE_VISTA); } catch { return null; } };
const gravar = (v) => { try { localStorage.setItem(CHAVE_VISTA, v); } catch {} };
const agoraInput = () => { const d = new Date(); return `${isoDia(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const nomeFase = (f) => FASES_CRM[f] ?? f ?? "—";
/** Emails automáticos ao cliente (docs/EMAILS-AUTOMATICOS.md): o nome de cada tipo na lista da ficha. */
const EMAILS_AUTO = { boas_vindas: "Pedido recebido (boas-vindas)", visita: "Lembrete da visita", pagamento_1: "Pagamento em falta: 1.º lembrete", pagamento_2: "Pagamento em falta: 2.º lembrete", obra: "Depois da obra: guia e pedido de avaliação" };

export default function crm(el, ctx) {
  const ctrl = new AbortController();
  const vende = ctx.pode("ceo", "comercial");
  let vista = vende ? (["funil", "lista", "clientes", "casas"].includes(ler()) ? ler() : "funil") : "clientes";
  let resposta = null;     // GET crm/pedidos
  let clientes = null;     // GET crm/clientes
  let casas = null;        // GET crm/casas (casas registadas no simulador, ainda sem pedido)
  let erroCasas = null;    // a lista falhou: mostra-se ao abrir o separador (com "Tentar de novo")
  let ficha = null;

  const segmentos = vende ? h("div", { class: "segmentos", role: "group", "aria-label": "Mostrar" },
    ...[["funil", "Funil"], ["lista", "Pedidos"], ["clientes", "Clientes"], ["casas", "Casas registadas"]].map(([v, t]) =>
      h("button", { class: "segmento", type: "button", dataset: { vista: v }, text: t, "aria-pressed": "false", onclick: () => { vista = v; gravar(v); desenhar(); } }))) : null;
  const fFase = escolha("fase", { "": "Todas as fases", ...FASES_CRM }, "", { "aria-label": "Filtrar por fase" });
  const fOrigem = escolha("origem", { "": "Todas as origens", ...ORIGENS_CONTACTO, sem: "Sem origem" }, "", { "aria-label": "Filtrar por origem do contacto" });
  const fConcelho = escolha("concelho", { "": "Todos os concelhos" }, "", { "aria-label": "Filtrar por concelho" });
  const fResp = escolha("responsavel", { "": "Todos os responsáveis", sem: "Sem responsável" }, "", { "aria-label": "Filtrar por responsável" });
  const fDe = h("input", { type: "date", name: "de", "aria-label": "Recebidos desde" });
  const fAte = h("input", { type: "date", name: "ate", "aria-label": "Recebidos até" });
  const fTexto = h("input", { type: "search", name: "q", placeholder: "Procurar nome, email, telefone ou localidade", "aria-label": "Procurar cliente", maxlength: "80" });
  const filtrosPedidos = h("div", { class: "filtros filtros-crm" }, fFase, fOrigem, fConcelho, fResp, fDe, fAte);
  const filtrosClientes = h("div", { class: "filtros" }, fTexto);
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "zona-crm" }, carregando());
  el.append(...[h("div", { class: "ecra-topo" }, h("h1", { text: vende ? "CRM" : "Clientes das minhas obras" }), segmentos),
    vende ? filtrosPedidos : null, filtrosClientes, contagem, zona].filter(Boolean));
  for (const f of [fOrigem, fConcelho, fResp, fDe, fAte]) f.addEventListener("change", carregarPedidos);
  fFase.addEventListener("change", desenhar);
  let tTexto;
  fTexto.addEventListener("input", () => { clearTimeout(tTexto); tTexto = setTimeout(carregarClientes, 250); });

  async function carregarPedidos() {
    if (!vende) return;
    const q = new URLSearchParams();
    for (const [k, f] of [["origem", fOrigem], ["concelho", fConcelho], ["responsavel", fResp], ["de", fDe], ["ate", fAte]]) if (f.value) q.set(k, f.value);
    try { resposta = await pedir(`crm/pedidos${q.size ? `?${q}` : ""}`, { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregarPedidos)); return; }
    // As opções dos filtros vêm do servidor (concelhos dos pedidos, equipa ativa); a escolha feita mantém-se.
    const repor = (sel, base, extra) => { const v = sel.value; sel.replaceChildren(...Object.entries({ ...base, ...extra }).map(([k, t]) => h("option", { value: k, text: t }))); sel.value = v; };
    repor(fConcelho, { "": "Todos os concelhos" }, Object.fromEntries(lista(resposta, "concelhos").map((c) => [c, c])));
    repor(fResp, { "": "Todos os responsáveis", sem: "Sem responsável" }, Object.fromEntries(lista(resposta, "equipa").map((u) => [String(u.id), u.nome])));
    desenhar();
  }
  async function carregarClientes() {
    const q = fTexto.value.trim();
    try { clientes = lista(await pedir(`crm/clientes${q ? `?q=${encodeURIComponent(q)}` : ""}`, { sinal: ctrl.signal }), "clientes"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregarClientes)); return; }
    desenhar();
  }

  async function carregarCasas() {
    if (!vende) return;
    erroCasas = null;
    try { casas = lista(await pedir("crm/casas", { sinal: ctrl.signal }), "casas"); }
    catch (e) { if (e.name === "AbortError") return; erroCasas = e; }
    desenhar();
  }
  /** Uma casa registada: o contacto da conta, a casa em poucas palavras e quando ficou registada. */
  function linhaCasa(c) {
    const k = c.casa ?? {};
    const casa = [[k.tipo, k.tipologia].filter(Boolean).join(" "), k.divisoes?.length ? `${k.n_divisoes ?? k.divisoes.length} divisões: ${k.divisoes.join(", ")}${(k.n_divisoes ?? 0) > k.divisoes.length ? "…" : ""}` : null,
      k.potencia_kva ? `${String(k.potencia_kva).replace(".", ",")} kVA` : null].filter(Boolean).join(" · ");
    return h("li", {}, h("div", { class: "linha", dataset: { id: String(c.id) } },
      h("span", { class: "linha-principal" }, h("strong", { text: c.nome || c.email }), h("span", { class: "ajuda", text: [c.nome ? c.email : null, c.telefone, c.localidade].filter(Boolean).join(" · ") || "Só o email" })),
      h("span", { class: "linha-selos" }, selo("Casa registada", "info")),
      h("span", { class: "linha-extra ajuda", text: `${casa || "Casa por descrever"} · Registada ${data(c.registada, { hora: false })}` }),
      h("span", { class: "linha-extra" }, h("a", { href: `mailto:${c.email}`, text: "Enviar email" }))));
  }

  function desenhar() {
    segmentos?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vista === vista)));
    filtrosPedidos.hidden = vista === "clientes" || vista === "casas";
    fFase.hidden = vista !== "lista";
    filtrosClientes.hidden = vista !== "clientes";
    if (vista === "casas") {
      if (erroCasas) { contagem.textContent = ""; zona.replaceChildren(erroEcra(erroCasas, carregarCasas)); return; }
      if (!casas) { zona.replaceChildren(carregando()); return; }
      contagem.textContent = `${casas.length} ${casas.length === 1 ? "casa registada" : "casas registadas"} sem pedido`;
      zona.replaceChildren(casas.length ? h("ul", { class: "linhas", id: "lista-casas-crm" }, ...casas.map(linhaCasa))
        : h("p", { class: "vazio", text: "Ninguém descreveu a casa sem pedir um serviço." }));
      return;
    }
    if (vista === "clientes") {
      if (!clientes) { zona.replaceChildren(carregando()); return; }
      contagem.textContent = `${clientes.length} ${clientes.length === 1 ? "cliente" : "clientes"}`;
      zona.replaceChildren(clientes.length ? h("ul", { class: "linhas", id: "lista-clientes-crm" }, ...clientes.map(linhaCliente))
        : h("p", { class: "vazio", text: vende ? "Sem clientes." : "Ainda não tem obras atribuídas com cliente." }));
      return;
    }
    if (!resposta) { zona.replaceChildren(carregando()); return; }
    const pedidos = lista(resposta, "pedidos");
    if (vista === "funil") {
      const funil = campo(resposta, "funil") ?? {};
      contagem.textContent = `${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"}`;
      zona.replaceChildren(h("div", { class: "quadro", id: "funil-crm" }, ...Object.entries(FASES_CRM).map(([f, nome]) => {
        const col = pedidos.filter((p) => p.fase === f);
        const tot = funil[f] ?? { n: col.length, valor: 0 };
        return h("section", { class: `coluna coluna-${f}`, dataset: { fase: f }, "aria-label": `${nome}: ${tot.n} pedidos, ${euros(tot.valor)}` },
          h("h2", {}, nome, " ", h("span", { class: "contagem num", text: String(tot.n) })),
          h("p", { class: "ajuda num total-fase", text: euros(tot.valor) }),
          col.length ? h("ul", { class: "cartoes-orc" }, ...col.map((p) => linhaPedido(p, false))) : h("p", { class: "vazio", text: "Nenhum." }));
      })));
      return;
    }
    const vis = pedidos.filter((p) => !fFase.value || p.fase === fFase.value);
    contagem.textContent = `${vis.length} ${vis.length === 1 ? "pedido" : "pedidos"}`;
    zona.replaceChildren(vis.length ? h("ul", { class: "linhas", id: "lista-pedidos-crm" }, ...vis.map((p) => linhaPedido(p, true))) : h("p", { class: "vazio", text: "Nenhum pedido com estes filtros." }));
  }

  function linhaPedido(p, comFase) {
    const alvo = p.cliente_id ? `#/crm/${encodeURIComponent(p.cliente_id)}` : `#/orcamentos/${encodeURIComponent(p.id)}`;
    return h("li", {}, h("a", { class: "linha cartao-orc", href: alvo, dataset: { id: String(p.id) } },
      h("span", { class: "linha-principal" }, h("strong", { text: txt(p, "nome") }), h("span", { class: "ajuda", text: `${txt(p, "servico")} · ${p.concelho ?? txt(p, "localidade")}` })),
      h("span", { class: "linha-selos" },
        comFase ? selo(nomeFase(p.fase), `orc-${ESTADO_DA_FASE[p.fase] ?? p.fase}`) : null,
        p.aguarda_sinal ? selo("Aceite — a aguardar sinal", "info") : null,
        p.valor_proposta != null ? selo(euros(p.valor_proposta), "valor") : null,
        p.origem_contacto ? selo(ORIGENS_CONTACTO[p.origem_contacto] ?? p.origem_contacto, "info") : null,
        p.fase === "perdido" && p.motivo_perda_tipo ? selo(MOTIVOS_PERDA[p.motivo_perda_tipo] ?? p.motivo_perda_tipo) : null),
      h("span", { class: "linha-extra ajuda", text: `${p.responsavel_nome ? `${p.responsavel_nome} · ` : ""}Recebido ${data(p.criado, { hora: false })}` })));
  }

  function linhaCliente(c) {
    return h("li", {}, h("a", { class: "linha", href: `#/crm/${encodeURIComponent(c.id)}`, dataset: { id: String(c.id) } },
      h("span", { class: "linha-principal" }, h("strong", { text: txt(c, "nome") }), h("span", { class: "ajuda", text: [c.telefone, c.email, c.localidade].filter(Boolean).join(" · ") || "—" })),
      h("span", { class: "linha-selos" }, c.fase ? selo(nomeFase(c.fase), `orc-${ESTADO_DA_FASE[c.fase] ?? c.fase}`) : null,
        selo(`${c.n_pedidos} ${c.n_pedidos === 1 ? "pedido" : "pedidos"}`, "valor"), c.anonimizado ? selo("Anonimizado (RGPD)", "aviso") : null),
      h("span", { class: "linha-extra ajuda", text: `${c.responsavel_nome ? `${c.responsavel_nome} · ` : ""}${c.ultimo_contacto ? `Último contacto ${data(c.ultimo_contacto)}` : "Sem contactos registados"}` })));
  }

  // ---------- Ficha do cliente ----------
  async function abrirFicha(id) {
    if (ficha?.id === id) return;
    ficha?.j.fechar();
    const j = janela("Cliente", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash === `#/crm/${encodeURIComponent(id)}`) ctx.navegar("crm"); } });
    ficha = { id, j };
    j.corpo.append(carregando());
    await recarregarFicha(j, id);
  }
  async function recarregarFicha(j, id) {
    let f, tarefas = [];
    try {
      [f, tarefas] = await Promise.all([pedir(`crm/clientes/${encodeURIComponent(id)}`),
        pedir(`tarefas?cliente=${encodeURIComponent(id)}`).then((r) => lista(r, "tarefas")).catch(() => [])]);
    } catch (e) {
      if (ficha?.j === j) j.corpo.replaceChildren(e.estado === 404 ? h("p", { class: "vazio", text: "Cliente não encontrado." }) : erroEcra(e));
      return;
    }
    if (ficha?.j === j) desenharFicha(j, f, tarefas);
  }

  function desenharFicha(j, f, tarefas) {
    const c = f.cliente, pode = f.pode ?? {};
    const id = String(c.id);
    const recarregar = () => { recarregarFicha(j, id); if (vende) carregarPedidos(); carregarClientes(); };
    j.titulo.textContent = txt(c, "nome");
    const partes = [];
    if (c.anonimizado) partes.push(h("div", { class: "msg info bloco", text: `Ficha anonimizada (RGPD) em ${data(c.anonimizado)}: a conta do cliente foi apagada; as notas e os contactos saíram.` }));
    partes.push(dados([["Telefone", txt(c, "telefone")], ["Email", txt(c, "email")],
      ...(c.conta ? [["Conta de cliente", `${c.conta.email}${c.conta.confirmado ? "" : " (email por confirmar)"}`]] : []),
      ["Responsável", c.responsavel_nome ?? "—"], ...(c.casas?.length ? [["Casa", c.casas.join(", ")]] : []), ["Ficha desde", data(c.criado, { hora: false })]]));
    if (c.telefone || c.email) partes.push(h("div", { class: "form-botoes" },
      c.telefone ? h("a", { class: "btn sec pequeno", href: `tel:${String(c.telefone).replace(/[^\d+]/g, "")}`, text: `Ligar ${c.telefone}` }) : null,
      c.email ? h("a", { class: "btn sec pequeno", href: `mailto:${encodeURIComponent(c.email).replace(/%40/g, "@")}`, text: "Enviar email" }) : null));

    // Histórico de notas e contactos (o mais útil fica em cima).
    partes.push(seccaoRegistos(f, recarregar));

    // Pedidos (fase, responsável, origem)
    const pedidos = lista(f, "pedidos");
    partes.push(h("h3", { text: `Pedidos (${pedidos.length})` }),
      pedidos.length ? h("ul", { class: "linhas pedidos-crm" }, ...pedidos.map((p) => h("li", {}, blocoPedido(p, f, recarregar)))) : h("p", { class: "vazio", text: "Sem pedidos." }));

    // Tarefas ligadas ao cliente
    partes.push(h("div", { class: "seccao-topo" }, h("h3", { text: ctx.pode("ceo") ? "Tarefas" : "As minhas tarefas deste cliente" }),
      c.anonimizado ? null : h("a", { class: "btn sec pequeno", href: `#/tarefas/nova?cliente=${encodeURIComponent(id)}`, text: "Nova tarefa" })),
      tarefas.length ? h("ul", { class: "lista-simples" }, ...tarefas.map((t) => h("li", {}, h("a", { href: `#/tarefas/${encodeURIComponent(t.id)}`, text: t.titulo }),
        " ", selo(ESTADOS_TAREFA[t.estado] ?? t.estado), t.prazo ? h("span", { class: "ajuda", text: ` · prazo ${data(t.prazo)}` }) : null))) : h("p", { class: "vazio", text: ctx.pode("ceo") ? "Sem tarefas." : "Não tem tarefas ligadas a este cliente." }));

    // Obras
    const obras = lista(f, "obras");
    partes.push(h("h3", { text: "Obras" }), obras.length ? h("ul", { class: "lista-simples" }, ...obras.map((b) => h("li", {},
      h("a", { href: `#/obras/${encodeURIComponent(b.id)}`, text: `Obra n.º ${b.id}` }), ` · ${b.por_agendar ? "por agendar" : data(b.data)} · ${ESTADOS_OBRA[b.estado] ?? b.estado}`))) : h("p", { class: "vazio", text: "Sem obras." }));

    if (vende) {
      const pags = lista(f, "pagamentos");
      partes.push(h("h3", { text: "Pagamentos" }), pags.length ? h("ul", { class: "lista-simples" }, ...pags.map((x) => h("li", {},
        `${x.fase_texto ?? x.fase} · ${euros(x.valor)} · ${x.estado_texto ?? x.estado}${x.modo === "simulado" ? " (simulado)" : ""} · pedido n.º ${x.orcamento_id}${x.pago ? ` · pago ${data(x.pago)}` : ""}`))) : h("p", { class: "vazio", text: "Sem pagamentos." }));
      const rels = lista(f, "relatorios");
      if (rels.length) partes.push(h("h3", { text: "Relatórios técnicos" }), h("ul", { class: "lista-simples" }, ...rels.map((r) => h("li", {},
        h("a", { href: `#/orcamentos/${encodeURIComponent(r.orcamento_id)}/relatorio`, text: `Relatório do pedido n.º ${r.orcamento_id}` }), r.libertado ? ` · libertado ao cliente ${data(r.libertado)}` : " · ainda não libertado"))));
    }
    if (vende) {
      // Emails automáticos enviados (só o tipo e a data; os textos não se guardam) e a recusa do email depois da obra.
      const env = lista(f, "emails_automaticos");
      partes.push(h("h3", { text: "Emails automáticos" }));
      if (c.emails_recusados) partes.push(h("p", { class: "msg info", id: "emails-recusados", text: `O cliente não quer receber o email depois da obra (guia e pedido de avaliação) desde ${data(c.emails_recusados)}. Os emails de serviço continuam.` }));
      partes.push(env.length ? h("ul", { class: "lista-simples", id: "emails-automaticos" }, ...env.map((x) => h("li", {}, `${data(x.quando)} · ${EMAILS_AUTO[x.tipo] ?? x.tipo} · pedido n.º ${x.orcamento_id}`))) : h("p", { class: "vazio", text: "Ainda não saiu nenhum email automático." }));
    }
    const trab = lista(f, "trabalhos_eletricista");
    if (trab.length) partes.push(h("h3", { text: "Eletricistas externos" }), h("ul", { class: "lista-simples" }, ...trab.map((t) => h("li", {},
      `${t.tipo} · ${t.estado}${t.eletricista ? ` · ${t.eletricista}` : ""} · pedido n.º ${t.orcamento_id}`))));

    if (pode.editar) partes.push(formCliente(c, f, recarregar));
    if (pode.fundir) partes.push(formFundir(c, recarregar));
    j.corpo.replaceChildren(...partes);
  }

  function seccaoRegistos(f, recarregar) {
    const c = f.cliente, tipos = f.pode?.registar ?? [];
    const regs = lista(f, "registos");
    const sec = h("section", { class: "registos-crm", id: "registos-crm" }, h("h3", { text: "Notas e contactos" }));
    if (tipos.length) {
      const msg = h("div", { class: "msg", role: "alert", hidden: true });
      const pedidos = lista(f, "pedidos");
      const fr = h("form", { class: "form-grelha", id: "form-registo", novalidate: true },
        h("div", { class: "duas" },
          campoForm("Tipo", escolha("tipo", Object.fromEntries(tipos.map((t) => [t, TIPOS_REGISTO[t] ?? t])), tipos.includes("chamada") ? "chamada" : tipos[0])),
          campoForm("Quando", h("input", { type: "datetime-local", name: "quando", value: agoraInput() }))),
        pedidos.length > 1 ? campoForm("Pedido (opcional)", escolha("orcamento_id", { "": "Todos / nenhum em especial", ...Object.fromEntries(pedidos.map((p) => [String(p.id), `n.º ${p.id} · ${p.servico ?? ""}`])) }, "")) : null,
        campoForm("Texto", h("textarea", { name: "texto", rows: "2", maxlength: "2000" }), "Curto: o que se falou ou ficou combinado."),
        h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Registar" })), msg);
      fr.addEventListener("submit", async (e) => {
        e.preventDefault();
        const el = fr.elements;
        if (el.tipo.value === "nota" && !el.texto.value.trim()) { mensagem(msg, "Escreva a nota."); el.texto.focus(); return; }
        const corpo = { tipo: el.tipo.value, quando: el.quando.value || null, texto: el.texto.value.trim() || null };
        if (el.orcamento_id?.value) corpo.orcamento_id = Number(el.orcamento_id.value);
        const b = fr.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
        try { await pedir(`crm/clientes/${encodeURIComponent(c.id)}/registos`, { corpo }); avisar("Registado."); recarregar(); }
        catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
      });
      sec.append(fr);
    }
    sec.append(regs.length ? h("ol", { class: "historico-p registos" }, ...regs.map((r) => h("li", {},
      h("span", { class: "num ajuda", text: data(r.quando) }), " ", selo(TIPOS_REGISTO[r.tipo] ?? r.tipo, r.tipo === "nota" ? "" : "info"), " ",
      r.texto ? h("span", { class: "texto-registo", text: r.texto }) : null,
      h("span", { class: "ajuda", text: ` · ${r.por ?? "—"}${r.orcamento_id ? ` · pedido n.º ${r.orcamento_id}` : ""}` }))))
      : h("p", { class: "vazio", text: "Ainda sem notas nem contactos." }));
    return sec;
  }

  /** Um pedido na ficha: fase (com a data da visita e o motivo de perda quando são precisos), responsável e origem. */
  function blocoPedido(p, f, recarregar) {
    const cab = h("span", { class: "linha-principal" },
      h("strong", {}, h("a", { href: `#/orcamentos/${encodeURIComponent(p.id)}`, text: `Pedido n.º ${p.id}` }), ` · ${txt(p, "servico")}`),
      h("span", { class: "ajuda", text: `Recebido ${data(p.criado, { hora: false })}${p.localidade ? ` · ${p.localidade}` : ""}${p.origem_entrada ? ` · ${ENTRADAS[p.origem_entrada] ?? p.origem_entrada}` : ""}` }));
    const selos = h("span", { class: "linha-selos" }, selo(nomeFase(p.fase), `orc-${ESTADO_DA_FASE[p.fase] ?? p.fase}`),
      p.valor_proposta != null ? selo(euros(p.valor_proposta), "valor") : null, p.estado === "arquivado" ? selo(NOMES_ESTADO_ORC.arquivado, "aviso") : null,
      p.separado ? selo("Separado à mão", "info") : null);
    if (!f.pode?.editar || p.estado === "arquivado" || !vende) return h("div", { class: "linha" }, cab, selos);
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const sFase = escolha("fase", FASES_CRM, p.fase, { "aria-label": `Fase do pedido ${p.id}` });
    const visita = campoForm("Data da visita", h("input", { type: "datetime-local", name: "data_visita", value: p.data_visita && /T/.test(p.data_visita) ? p.data_visita.slice(0, 16) : "" }));
    const motivoTipo = campoForm("Motivo da perda", escolha("motivo_perda_tipo", { "": "Escolha…", ...MOTIVOS_PERDA }, p.motivo_perda_tipo ?? ""));
    const motivoTxt = campoForm("Pormenor do motivo", h("input", { name: "motivo_perda", maxlength: "300", value: p.motivo_perda ?? "" }));
    const sResp = escolha("responsavel_id", { "": "Sem responsável", ...Object.fromEntries(lista(f, "equipa").map((u) => [String(u.id), u.nome])) }, p.responsavel_id ? String(p.responsavel_id) : "", { "aria-label": `Responsável do pedido ${p.id}` });
    const sOrigem = escolha("origem_contacto", { "": "Sem origem", ...ORIGENS_CONTACTO }, p.origem_contacto ?? "", { "aria-label": `Origem do contacto do pedido ${p.id}` });
    const mostrar = () => { visita.hidden = sFase.value !== "visita"; motivoTipo.hidden = motivoTxt.hidden = sFase.value !== "perdido"; };
    sFase.addEventListener("change", mostrar); mostrar();
    const fr = h("form", { class: "form-grelha pedido-crm", novalidate: true },
      h("div", { class: "tres" }, campoForm("Fase", sFase), campoForm("Responsável", sResp), campoForm("Origem do contacto", sOrigem)),
      h("div", { class: "duas" }, visita, motivoTipo), motivoTxt,
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec pequeno", type: "submit", text: "Guardar pedido" }),
        // Separar (CEO; o inverso de "Juntar"): este pedido passa para uma ficha nova, só dele.
        f.pode?.separar ? botaoConfirmar("Separar para outra ficha", "Confirmar: separar?", async (btn) => {
          btn.disabled = true; mensagem(msg, null);
          try { await pedir(`crm/pedidos/${encodeURIComponent(p.id)}/separar`, { corpo: {} }); avisar(`Pedido n.º ${p.id} separado: tem agora uma ficha só dele.`); recarregar(); }
          catch (erro) { btn.disabled = false; mensagem(msg, erro.message); }
        }) : null), msg);
    fr.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = fr.elements;
      const fase = el.fase.value;
      if (fase === "visita" && p.fase !== "visita" && !el.data_visita.value) { mensagem(msg, "Indique a data da visita."); el.data_visita.focus(); return; }
      if (fase === "perdido" && !el.motivo_perda_tipo.value) { mensagem(msg, "Escolha o motivo da perda."); el.motivo_perda_tipo.focus(); return; }
      if (fase === "perdido" && el.motivo_perda_tipo.value === "outro" && !el.motivo_perda.value.trim()) { mensagem(msg, "Com \"Outro\", escreva o motivo."); el.motivo_perda.focus(); return; }
      const b = fr.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        if (fase !== p.fase || (fase === "perdido" && (el.motivo_perda_tipo.value !== (p.motivo_perda_tipo ?? "") || el.motivo_perda.value.trim() !== (p.motivo_perda ?? "")))) {
          const corpo = { estado: ESTADO_DA_FASE[fase] };
          if (fase === "visita" && el.data_visita.value) corpo.data_visita = el.data_visita.value;
          if (fase === "perdido") { corpo.motivo_perda_tipo = el.motivo_perda_tipo.value; corpo.motivo_perda = el.motivo_perda.value.trim() || null; }
          await pedir(`orcamentos/${encodeURIComponent(p.id)}`, { corpo });
        }
        const resp = el.responsavel_id.value ? Number(el.responsavel_id.value) : null;
        const origem = el.origem_contacto.value || null;
        if (resp !== (p.responsavel_id ?? null) || origem !== (p.origem_contacto ?? null)) {
          await pedir(`crm/pedidos/${encodeURIComponent(p.id)}`, { corpo: { responsavel_id: resp, origem_contacto: origem } });
        }
        avisar("Pedido guardado.");
        recarregar();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return h("div", { class: "linha" }, cab, selos, fr);
  }

  function formCliente(c, f, recarregar) {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const fr = h("form", { class: "form-grelha", id: "form-cliente-crm", novalidate: true },
      h("h3", { text: "Dados do cliente" }),
      h("div", { class: "duas" },
        campoForm("Nome", h("input", { name: "nome", maxlength: "120", required: true, value: c.nome ?? "" })),
        campoForm("Responsável", escolha("responsavel_id", { "": "Sem responsável", ...Object.fromEntries(lista(f, "equipa").map((u) => [String(u.id), u.nome])) }, c.responsavel_id ? String(c.responsavel_id) : ""))),
      h("div", { class: "duas" },
        campoForm("Telefone", h("input", { name: "telefone", type: "tel", maxlength: "30", value: c.telefone ?? "" })),
        campoForm("Email", h("input", { name: "email", type: "email", maxlength: "254", value: c.email ?? "" }))),
      h("div", { class: "form-botoes" }, h("button", { class: "btn sec", type: "submit", text: "Guardar cliente" })), msg);
    fr.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = fr.elements;
      if (!el.nome.value.trim()) { mensagem(msg, "Escreva o nome."); el.nome.focus(); return; }
      const b = fr.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        await pedir(`crm/clientes/${encodeURIComponent(c.id)}`, { corpo: { nome: el.nome.value.trim(), telefone: el.telefone.value.trim() || null, email: el.email.value.trim() || null,
          responsavel_id: el.responsavel_id.value ? Number(el.responsavel_id.value) : null } });
        avisar("Cliente guardado.");
        recarregar();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return fr;
  }

  /** Fundir (CEO): outra ficha da mesma pessoa passa para esta (pedidos, notas, tarefas). */
  function formFundir(c, recarregar) {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const outros = (clientes ?? []).filter((x) => x.id !== c.id && !x.anonimizado);
    const sel = escolha("outro", { "": "Escolha a outra ficha…", ...Object.fromEntries(outros.map((x) => [String(x.id), `${x.nome ?? "—"} (${[x.email, x.telefone].filter(Boolean).join(" · ") || `n.º ${x.id}`})`])) }, "", { "aria-label": "Ficha a juntar a esta" });
    const b = botaoConfirmar("Juntar a esta ficha", "Confirmar: juntar?", async (btn) => {
      if (!sel.value) { mensagem(msg, "Escolha a ficha a juntar."); sel.focus(); return; }
      btn.disabled = true; mensagem(msg, null);
      try { await pedir(`crm/clientes/${encodeURIComponent(c.id)}/fundir`, { corpo: { outro: Number(sel.value) } }); avisar("Fichas juntas."); recarregar(); }
      catch (erro) { btn.disabled = false; mensagem(msg, erro.message); }
    });
    return h("details", { class: "grupo fundir-crm" }, h("summary", { text: "Juntar outra ficha da mesma pessoa (CEO)" }),
      h("p", { class: "ajuda", text: "Os pedidos, as notas e as tarefas da outra ficha passam para esta; a outra deixa de existir." }),
      h("div", { class: "linha-juntar" }, sel, b), msg);
  }

  // Arranque: o técnico só tem a lista de clientes; os outros carregam os dois (a fusão usa a lista de clientes).
  if (vende) carregarPedidos();
  carregarClientes();
  carregarCasas();
  desenhar();
  const api = {
    rota(resto) { if (resto[0]) abrirFicha(resto[0]); else { ficha?.j.fechar(); ficha = null; } },
    desmontar: () => { ctrl.abort(); clearTimeout(tTexto); },
  };
  api.rota(ctx.resto);
  return api;
}
