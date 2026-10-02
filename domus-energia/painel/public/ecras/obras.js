// Obras: agenda semanal + lista; ficha com checklist de material, horas e notas.
// CEO: tudo (nova obra, datas, técnicos). Técnico: só as suas obras (estado, horas reais, material, notas).
// Comercial: só leitura.
// A obra nasce com o sinal pago (decisão do dono): aparece aqui "Por agendar" e com "Casa por ligar — falta o restante"
// até a casa ser ligada na ficha do pedido (só com o restante pago).
import { pedir, campo, lista, numero } from "../api.js";
import { h, ESTADOS_OBRA, KITS, PAPEIS, nomeDe, num, data, diaSemana, isoDia, selo, campoForm, escolha, dados, janela, mensagem, avisar, carregando, erroEcra, txt } from "../ui.js";
import { blocoEletricista } from "./atribuicao.js";

/** Técnicos de uma obra como [{id, nome}] (aceita ids, nomes ou objetos). */
export function tecnicosDe(o) {
  const v = campo(o, "tecnicos", "tecnico_ids", "tecnico");
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return arr.map((t) => (t && typeof t === "object" ? { id: campo(t, "id"), nome: campo(t, "nome") ?? campo(t, "email") ?? String(campo(t, "id")) } : { id: t, nome: String(t) }));
}
// Material: [{nome, quantidade?, sku?, feito}] — quantidade e sku são mantidos tal como vieram.
const materialDe = (o) => lista(campo(o, "material") ?? [], "material", "itens").map((m) => {
  if (!m || typeof m !== "object") return { nome: String(m), feito: false };
  const r = { nome: String(campo(m, "nome", "item", "descricao") ?? "") };
  if (m.quantidade !== undefined && m.quantidade !== null) r.quantidade = m.quantidade;
  if (m.sku) r.sku = m.sku;
  r.feito = !!campo(m, "feito", "ok", "usado");
  return r;
});
const rotuloMat = (m) => `${m.quantidade != null && Number(m.quantidade) !== 1 ? `${m.quantidade} × ` : ""}${m.nome}`;
const diaDe = (o) => String(campo(o, "data", "dia") ?? "").slice(0, 10);
const segunda = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const somar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export default function obras(el, ctx) {
  const ctrl = new AbortController();
  const ceo = ctx.pode("ceo");
  let todas = [];
  let inicio = segunda(new Date());
  let ficha = null;
  let tecnicos = null; // lista para o CEO escolher (GET utilizadores)

  const minha = (o) => tecnicosDe(o).some((t) => String(t.id) === String(ctx.eu.id) || (t.nome && (t.nome === ctx.eu.nome || t.nome === ctx.eu.email)));
  const podeEditar = (o) => ceo || (ctx.pode("tecnico") && minha(o));

  const tituloSemana = h("h2", { id: "semana-titulo", "aria-live": "polite" });
  const agenda = h("div", { class: "agenda", id: "agenda" });
  const fEstado = escolha("estado", { "": "Todos os estados", ...ESTADOS_OBRA }, "", { "aria-label": "Filtrar lista por estado" });
  const zonaLista = h("div", {}, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: ctx.pode("tecnico") ? "As minhas obras" : "Obras" }),
      ceo ? h("button", { class: "btn", type: "button", id: "nova-obra", text: "Nova obra", onclick: abrirNova }) : null),
    ...(ctx.pode("comercial") ? [h("p", { class: "ajuda", text: "Agenda só para consulta." })] : []),
    h("section", { class: "cartao bloco-agenda" },
      h("div", { class: "agenda-topo" }, tituloSemana,
        h("div", { class: "form-botoes" },
          h("button", { class: "btn sec pequeno", type: "button", id: "semana-anterior", "aria-label": "Semana anterior", text: "‹ Anterior", onclick: () => { inicio = somar(inicio, -7); desenharAgenda(); } }),
          h("button", { class: "btn sec pequeno", type: "button", id: "semana-hoje", text: "Esta semana", onclick: () => { inicio = segunda(new Date()); desenharAgenda(); } }),
          h("button", { class: "btn sec pequeno", type: "button", id: "semana-seguinte", "aria-label": "Semana seguinte", text: "Seguinte ›", onclick: () => { inicio = somar(inicio, 7); desenharAgenda(); } }))),
      agenda),
    h("section", { class: "bloco-lista" }, h("div", { class: "seccao-topo" }, h("h2", { text: "Todas as obras" }), fEstado), zonaLista));
  fEstado.addEventListener("change", desenharLista);

  async function carregar() {
    try { todas = lista(await pedir("obras", { sinal: ctrl.signal }), "obras"); }
    catch (e) { if (e.name !== "AbortError") { zonaLista.replaceChildren(erroEcra(e, carregar)); agenda.replaceChildren(); } return; }
    todas.sort((a, b) => String(campo(a, "data") ?? "").localeCompare(String(campo(b, "data") ?? "")));
    desenharAgenda(); desenharLista();
  }

  function cartaoObra(o, curto = false) {
    const id = String(campo(o, "id"));
    const estado = campo(o, "estado") ?? "agendada";
    const tecs = tecnicosDe(o).map((t) => t.nome).join(", ");
    return h("a", { class: `obra obra-${estado} ${minha(o) ? "minha" : ""}`.trim(), href: `#/obras/${encodeURIComponent(id)}`, dataset: { id } },
      h("strong", { text: txt(o, "cliente_nome", "cliente") }),
      h("span", { class: "ajuda", text: `${nomeDe(KITS, campo(o, "kit"))}${tecs ? ` · ${tecs}` : ""}` }),
      curto ? (campo(o, "hora") ? h("span", { class: "ajuda num", text: String(campo(o, "hora")) }) : null) : h("span", { class: "ajuda num", text: `${campo(o, "por_agendar") === true ? "data provisória: " : ""}${data(campo(o, "data"))}${campo(o, "hora") ? ` ${campo(o, "hora")}` : ""}` }),
      h("span", { class: "linha-selos" }, selo(ESTADOS_OBRA[estado] ?? estado, `obra-${estado}`), ...selosCasa(o)));
  }

  /** "Por agendar" (data provisória) e "Casa por ligar — falta o restante" (a obra existe antes da casa). */
  function selosCasa(o) {
    if (["cancelada"].includes(campo(o, "estado"))) return [];
    const casa = campo(o, "casa");
    return [campo(o, "por_agendar") === true ? selo("Por agendar", "aviso") : null,
      casa === "falta_restante" ? selo("Casa por ligar — falta o restante", "info") : casa === "por_ligar" ? selo("Casa por ligar", "info") : null].filter(Boolean);
  }

  function desenharAgenda() {
    const fim = somar(inicio, 6);
    const f = (d) => d.toLocaleDateString("pt-PT", { day: "numeric", month: "long" });
    tituloSemana.textContent = `Semana de ${f(inicio)} a ${f(fim)}`;
    const hoje = isoDia(new Date());
    agenda.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = somar(inicio, i), dia = isoDia(d);
      const doDia = todas.filter((o) => diaDe(o) === dia);
      return h("section", { class: `dia ${dia === hoje ? "hoje" : ""} ${doDia.length ? "" : "sem-obras"}`.trim(), dataset: { dia }, "aria-label": diaSemana(d) },
        h("h3", {}, h("span", { text: d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "") }), " ", h("span", { class: "num", text: String(d.getDate()) }), dia === hoje ? h("span", { class: "selo-p hoje", text: "Hoje" }) : null),
        doDia.length ? h("ul", { class: "obras-dia" }, ...doDia.map((o) => h("li", {}, cartaoObra(o, true)))) : h("p", { class: "vazio", text: "—" }));
    }));
  }

  function desenharLista() {
    const vis = todas.filter((o) => !fEstado.value || (campo(o, "estado") ?? "agendada") === fEstado.value);
    zonaLista.replaceChildren(vis.length ? h("ul", { class: "grelha-obras", id: "lista-obras" }, ...vis.map((o) => h("li", {}, cartaoObra(o)))) : h("p", { class: "vazio", text: todas.length ? "Nenhuma obra com este estado." : "Sem obras." }));
  }

  // ---------- Ficha ----------
  async function abrirFicha(id) {
    if (ficha?.id === id) return;
    ficha?.j.fechar();
    const j = janela("Obra", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash === `#/obras/${encodeURIComponent(id)}`) ctx.navegar("obras"); } });
    ficha = { id, j };
    await esperar;
    const o = todas.find((x) => String(campo(x, "id")) === id);
    if (ficha?.j !== j) return;
    if (!o) { j.corpo.replaceChildren(h("p", { class: "vazio", text: ctx.pode("tecnico") ? "Esta obra não é sua ou já não existe." : "Obra não encontrada." })); return; }
    if (ceo) await carregarTecnicos();
    desenharFicha(j, o);
  }

  async function carregarTecnicos() {
    if (tecnicos) return tecnicos;
    try { tecnicos = lista(await pedir("utilizadores"), "utilizadores").filter((u) => campo(u, "papel") === "tecnico" && campo(u, "ativo") !== false); }
    catch { tecnicos = []; }
    return tecnicos;
  }

  function desenharFicha(j, o) {
    const id = String(campo(o, "id"));
    const edita = podeEditar(o);
    const kit = campo(o, "kit");
    const estimadas = campo(o, "horas_estimadas") ?? KITS[kit]?.horas;
    j.titulo.textContent = `Obra: ${txt(o, "cliente_nome", "cliente")}`;
    const tecs = tecnicosDe(o);
    const partes = [
      dados([
        ["Cliente", campo(o, "cliente") ? h("a", { href: `#/clientes/${encodeURIComponent(campo(o, "cliente"))}`, text: txt(o, "cliente_nome", "cliente") }) : txt(o, "cliente_nome")],
        ...(campo(o, "casa") && campo(o, "casa") !== "ligada" ? [["Casa", campo(o, "casa") === "falta_restante" ? "Casa por ligar — falta o restante" : "Casa por ligar (na ficha do pedido)"]] : []),
        ...(campo(o, "orcamento_id") && !ctx.pode("tecnico") ? [["Pedido", h("a", { href: `#/orcamentos/${encodeURIComponent(campo(o, "orcamento_id"))}`, text: `n.º ${campo(o, "orcamento_id")}` })]] : []),
        ["Data", `${data(campo(o, "data"))}${campo(o, "hora") ? ` às ${campo(o, "hora")}` : ""}${campo(o, "por_agendar") === true ? " (provisória: por agendar)" : ""}`],
        ["Técnicos", tecs.map((t) => t.nome).join(", ") || "—"],
        ["Kit", nomeDe(KITS, kit)],
        ["Horas estimadas", estimadas == null ? "—" : `${num(estimadas)} h`],
      ]),
    ];
    // Eletricista externo (CEO; docs/ELETRICISTAS.md): atribuir a obra do pedido ou pô-la na bolsa.
    if (ceo && ctx.eletricistas && campo(o, "orcamento_id")) partes.push(blocoEletricista(campo(o, "orcamento_id")));
    if (!edita) {
      const estado = campo(o, "estado") ?? "agendada";
      const mat = materialDe(o);
      partes.push(
        h("p", { class: "linha-selos" }, selo(ESTADOS_OBRA[estado] ?? estado, `obra-${estado}`)),
        h("h3", { text: "Material" }),
        mat.length ? h("ul", { class: "lista-simples" }, ...mat.map((m) => h("li", { text: `${m.feito ? "✓ " : ""}${rotuloMat(m)}` }))) : h("p", { class: "vazio", text: "Sem material registado." }),
        dados([["Horas reais", campo(o, "horas_reais") == null ? "—" : `${num(campo(o, "horas_reais"))} h`], ["Notas", txt(o, "notas")]]),
        h("p", { class: "ajuda so-leitura", text: ctx.pode("tecnico") ? "Só pode alterar as obras em que é técnico." : "Só leitura." }));
      j.corpo.replaceChildren(...partes);
      return;
    }
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const material = materialDe(o);
    const listaMat = h("ul", { class: "checklist", id: "material" });
    const desenharMat = () => listaMat.replaceChildren(...(material.length ? material.map((m, i) => h("li", {},
      h("label", { class: "caixa" }, h("input", { type: "checkbox", checked: m.feito, dataset: { i: String(i) }, onchange: (e) => { material[i].feito = e.target.checked; } }), rotuloMat(m)),
      h("button", { class: "botao-icone pequeno", type: "button", "aria-label": `Tirar ${rotuloMat(m)}`, text: "×", onclick: () => { material.splice(i, 1); desenharMat(); } }))) : [h("li", { class: "vazio", text: "Sem material." })]));
    desenharMat();
    const novoMat = h("input", { name: "novo_material", maxlength: "120", placeholder: "ex.: Shelly Plus 2PM", "aria-label": "Material a acrescentar" });
    const juntar = () => { const v = novoMat.value.trim(); if (!v) return; material.push({ nome: v, feito: false }); novoMat.value = ""; desenharMat(); novoMat.focus(); };
    novoMat.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); juntar(); } });

    const extraCeo = ceo ? [
      h("div", { class: "duas" },
        campoForm("Data", h("input", { name: "data", type: "date", value: diaDe(o) })),
        campoForm("Kit", escolha("kit", Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, `${v.nome} (${v.horas} h)`])), kit ?? "conforto"))),
      escolherTecnicos(tecs.map((t) => String(t.id))),
    ] : [];
    const f = h("form", { class: "form-grelha", id: "form-obra", novalidate: true },
      ...extraCeo,
      h("div", { class: "duas" },
        campoForm("Estado", escolha("estado", ESTADOS_OBRA, campo(o, "estado") ?? "agendada")),
        campoForm("Horas reais", h("input", { name: "horas_reais", type: "number", min: "0", max: "200", step: "0.5", inputmode: "decimal", value: campo(o, "horas_reais") ?? "" }))),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Material" }), listaMat,
        h("div", { class: "linha-juntar" }, novoMat, h("button", { class: "btn sec pequeno", type: "button", text: "Acrescentar", onclick: juntar }))),
      campoForm("Notas", h("textarea", { name: "notas", rows: "4", maxlength: "4000" }, campo(o, "notas") ?? "")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar obra" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const hv = el.horas_reais.value.trim();
      const horas = hv === "" ? null : numero(hv);
      if (hv !== "" && (horas === null || horas < 0 || horas > 200)) { mensagem(msg, "As horas reais têm de ser um número entre 0 e 200."); el.horas_reais.focus(); return; }
      const corpo = { estado: el.estado.value, horas_reais: horas, material: material.map((m) => ({ ...m })), notas: el.notas.value.trim() };
      if (ceo) {
        if (!el.data.value) { mensagem(msg, "Escolha a data da obra."); el.data.focus(); return; }
        Object.assign(corpo, { data: el.data.value, kit: el.kit.value, tecnicos: [...f.querySelectorAll("input[name=tecnico]:checked")].map((c) => idTec(c.value)) });
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`obras/${encodeURIComponent(id)}`, { corpo });
        const nova = campo(r, "obra") ?? (r && campo(r, "id") !== undefined ? r : { ...o, ...corpo });
        const i = todas.findIndex((x) => String(campo(x, "id")) === id);
        if (i >= 0) todas[i] = nova;
        desenharAgenda(); desenharLista();
        avisar("Obra guardada.");
        b.disabled = false;
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    partes.push(f);
    j.corpo.replaceChildren(...partes);
  }

  // Ids de utilizador podem ser números: devolve-os como vieram.
  const idTec = (v) => { const t = (tecnicos ?? []).find((u) => String(campo(u, "id")) === v); return t ? campo(t, "id") : v; };
  function escolherTecnicos(marcados = []) {
    const lista = tecnicos ?? [];
    return h("fieldset", { class: "grupo" }, h("legend", { text: "Técnicos" }),
      lista.length ? h("div", { class: "caixas" }, ...lista.map((u) => h("label", { class: "caixa" },
        h("input", { type: "checkbox", name: "tecnico", value: String(campo(u, "id")), checked: marcados.includes(String(campo(u, "id"))) }), txt(u, "nome", "email"))))
        : h("p", { class: "vazio", text: `Não há utilizadores com o papel ${PAPEIS.tecnico}.` }));
  }

  // ---------- Nova obra (CEO) ----------
  async function abrirNova() {
    const j = janela("Nova obra");
    j.corpo.append(carregando());
    let clientes = [];
    await carregarTecnicos();
    try { clientes = lista(await pedir("clientes"), "clientes"); } catch {}
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const cliente = clientes.length
      ? escolha("cliente", Object.fromEntries(clientes.map((c) => [String(campo(c, "codigo")), `${txt(c, "nome")} (${campo(c, "codigo")})`])), "")
      : h("input", { name: "cliente", required: true, maxlength: "32", autocapitalize: "none" });
    const f = h("form", { class: "form-grelha", id: "form-nova-obra", novalidate: true },
      campoForm("Cliente", cliente),
      h("div", { class: "duas" },
        campoForm("Data", h("input", { name: "data", type: "date", required: true, value: isoDia(somar(new Date(), 7)) })),
        campoForm("Kit", escolha("kit", Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, `${v.nome} (${v.horas} h)`])), "conforto"))),
      escolherTecnicos(),
      campoForm("Notas", h("textarea", { name: "notas", rows: "3", maxlength: "4000" })),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Criar obra" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const corpo = { cliente: el.cliente.value.trim(), data: el.data.value, kit: el.kit.value, tecnicos: [...f.querySelectorAll("input[name=tecnico]:checked")].map((c) => idTec(c.value)), notas: el.notas.value.trim() };
      if (!corpo.cliente) { mensagem(msg, "Escolha o cliente."); el.cliente.focus(); return; }
      if (!corpo.data) { mensagem(msg, "Escolha a data."); el.data.focus(); return; }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        await pedir("obras", { corpo });
        j.fechar();
        avisar("Obra criada.");
        carregar();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    j.corpo.replaceChildren(f);
    f.elements.cliente.focus();
  }

  const esperar = carregar();
  const api = {
    rota(resto) { if (resto[0]) abrirFicha(resto[0]); else { ficha?.j.fechar(); ficha = null; } },
    desmontar: () => ctrl.abort(),
  };
  api.rota(ctx.resto);
  return api;
}
