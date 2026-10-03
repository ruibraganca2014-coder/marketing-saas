// Pagamentos (CEO): totais por mês, tabela das linhas do CSV dos pagamentos e "Exportar CSV".
// Com o módulo dos eletricistas (docs/ELETRICISTAS.md): "Pagamentos a eletricistas" — valor, prazo, fatura-recibo e IBAN
// de cada trabalho, e "Pago"; e o que se deve / pagou aos eletricistas numa linha à parte dos pagamentos dos pedidos.
import { pedir, campo, lista, numero, BASE } from "../api.js";
import { h, PLANOS, euros, data, mes, nomeDe, carregando, erroEcra, txt, avisar, selo } from "../ui.js";

// Linhas do pagamentos.csv (data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe).
const valorDe = (l) => campo(l, "valor_com_iva", "valor", "montante", "total");
const COLUNAS = [
  ["data", "Data", (l) => data(campo(l, "data", "quando", "criado"))],
  ["cliente", "Cliente", (l) => txt(l, "cliente", "codigo")],
  ["plano", "Plano", (l) => nomeDe(PLANOS, campo(l, "plano"))],
  ["sem_iva", "Sem IVA", (l) => euros(campo(l, "valor_sem_iva"))],
  ["valor", "Com IVA", (l) => euros(valorDe(l))],
];
const mesDe = (l) => String(campo(l, "data", "quando", "criado") ?? "").slice(0, 7);

/** Totais por mês: [{mes, total}] | {"AAAA-MM": total} | calculados a partir das linhas. */
function totaisDe(r, linhas) {
  const t = campo(r, "totais", "totais_mes", "por_mes");
  if (Array.isArray(t)) return t.map((x) => ({ mes: String(campo(x, "mes") ?? ""), total: numero(campo(x, "com_iva", "total", "valor")) ?? 0, semIva: numero(campo(x, "sem_iva")), n: numero(campo(x, "pagamentos", "n", "quantidade")) }));
  if (t && typeof t === "object") return Object.entries(t).map(([m, v]) => ({ mes: m, total: numero(typeof v === "object" ? campo(v, "total") : v) ?? 0 }));
  const acc = {};
  for (const l of linhas) { const m = mesDe(l); acc[m] = (acc[m] ?? 0) + (numero(valorDe(l)) ?? 0); }
  return Object.entries(acc).map(([m, total]) => ({ mes: m, total }));
}

/** Uma célula de CSV (separador ";"), protegida contra fórmulas ao abrir no Excel. */
export function celulaCsv(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function pagamentos(el, ctx = {}) {
  const ctrl = new AbortController();
  let linhas = [];
  const fMes = h("select", { name: "mes", "aria-label": "Mês da tabela" });
  const exportar = h("button", { class: "btn sec", type: "button", id: "exportar-csv", text: "Exportar CSV", "aria-label": "Exportar CSV dos pagamentos dos planos", disabled: true });
  const zonaTotais = h("section", { class: "cartao", "aria-labelledby": "totais-titulo" }, h("h2", { id: "totais-titulo", text: "Totais por mês" }), carregando());
  const zonaTabela = h("div", { class: "tabela-rolar" });
  // Pagamentos dos pedidos (relatório, visita, avaria, sinal, restante; docs/PAGAMENTOS-PEDIDO.md), com base, IVA e total e o pedido
  // (também os anonimizados pelo RGPD). CSV do servidor: data;referencia;descricao;base;iva;total;estado;pedido.
  const exportarPed = h("button", { class: "btn sec pequeno", type: "button", id: "exportar-csv-pedidos", text: "Exportar CSV", "aria-label": "Exportar CSV dos pagamentos dos pedidos", disabled: true });
  const zonaPed = h("div", { class: "tabela-rolar" }, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Pagamentos" }), exportar),
    zonaTotais,
    h("section", { class: "bloco-lista" }, h("div", { class: "seccao-topo" }, h("h2", { text: "Pagamentos" }), fMes), zonaTabela),
    h("section", { class: "bloco-lista", id: "pagamentos-pedidos", "aria-labelledby": "pp-titulo" },
      h("div", { class: "seccao-topo" }, h("h2", { id: "pp-titulo", text: "Pagamentos dos pedidos (relatório, visita, sinal e restante)" }), exportarPed), zonaPed));
  fMes.addEventListener("change", desenharTabela);
  exportar.addEventListener("click", exportarCsv);
  exportarPed.addEventListener("click", async () => {
    exportarPed.disabled = true;
    try {
      const r = await fetch(`${BASE}pagamentos-pedido?formato=csv`, { credentials: "same-origin", headers: { Accept: "text/csv" } });
      if (r.status === 401 || r.status === 403) { avisar(r.status === 401 ? "A sessão terminou. Entre de novo." : "Não tem acesso a esta área.", "erro"); return; }
      if (!r.ok) throw new Error();
      descarregar(await r.blob(), "pagamentos-pedidos.csv");
    } catch { avisar("Não foi possível exportar agora. Tente de novo.", "erro"); }
    finally { exportarPed.disabled = false; }
  });

  // Devoluções por transferência ainda por fazer (pagamentos por referência Multibanco): valor, IBAN e titular dados
  // pelo cliente na conta; "Devolvido" depois de o CEO fazer a transferência (fica a data e quem).
  const zonaDev = h("div", { id: "devolucoes-por-fazer" });
  el.querySelector("#pagamentos-pedidos").before(zonaDev);
  function desenharDevolucoes(ds) {
    if (!ds.length) { zonaDev.replaceChildren(); return; }
    zonaDev.replaceChildren(h("section", { class: "cartao", "aria-labelledby": "dev-titulo" },
      h("h2", { id: "dev-titulo", text: `Devoluções por fazer (${ds.length})` }),
      h("p", { class: "ajuda", text: "Pagamentos por referência Multibanco devolvem-se por transferência bancária. Só contam como devolvidos depois de marcados." }),
      h("ul", { class: "linhas-simples" }, ...ds.map((d) => h("li", { dataset: { devolucao: String(campo(d, "id")), estado: campo(d, "estado") } },
        h("strong", { text: `${euros(campo(d, "valor"))} — ${txt(d, "motivo_texto")}` }), " ",
        campo(d, "orcamento_id") ? h("a", { href: `#/orcamentos/${encodeURIComponent(campo(d, "orcamento_id"))}`, text: `pedido n.º ${campo(d, "orcamento_id")}` }) : null, " ",
        selo(txt(d, "estado_texto"), campo(d, "estado") === "por_fazer" ? "grav-critica" : "aviso"),
        campo(d, "estado") === "por_fazer" ? h("span", { class: "bloco-ajuda num", text: `IBAN ${campo(d, "iban")} · titular ${txt(d, "titular")}` }) : null,
        campo(d, "estado") === "por_fazer" ? h("button", { class: "btn sec pequeno", type: "button", text: "Devolvido", "aria-label": `Marcar como devolvido: ${euros(campo(d, "valor"))}`,
          onclick: async (e) => {
            const b = e.currentTarget;
            if (b.dataset.confirma !== "1") { b.dataset.confirma = "1"; b.textContent = "Confirmar: já transferi"; return; }
            b.disabled = true;
            try {
              await pedir(`devolucoes/${encodeURIComponent(campo(d, "id"))}/devolvida`, { corpo: {} });
              avisar("Devolução marcada como feita.");
              carregarPedidos();
            } catch (erro) { b.disabled = false; avisar(erro.message, "erro"); }
          } }) : null)))));
  }

  async function carregarPedidos() {
    let r;
    try { r = await pedir("pagamentos-pedido", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zonaPed.replaceChildren(erroEcra(e, carregarPedidos)); return; }
    const ls = lista(r, "pagamentos");
    desenharDevolucoes(lista(campo(r, "devolucoes_por_fazer") ?? [], "devolucoes_por_fazer"));
    exportarPed.disabled = !ls.length;
    if (!ls.length) { zonaPed.replaceChildren(h("p", { class: "vazio", text: "Ainda não há pagamentos de pedidos." })); return; }
    const t = campo(r, "total_pago");
    const col = [["Data", (l) => data(campo(l, "data"))], ["Referência", (l) => txt(l, "ref")], ["Descrição", (l) => txt(l, "descricao")],
      ["Base", (l) => euros(campo(l, "base")), "num"], ["IVA", (l) => euros(campo(l, "iva")), "num"], ["Total", (l) => euros(campo(l, "valor")), "num"],
      ["Estado", (l) => `${txt(l, "estado_texto")}${campo(l, "modo") === "simulado" ? " (simulado)" : ""}`]];
    zonaPed.replaceChildren(h("table", { class: "tabela", id: "tabela-pagamentos-pedidos" },
      h("thead", {}, h("tr", {}, ...col.map(([n, , c]) => h("th", { scope: "col", class: c ?? "", text: n })), h("th", { scope: "col", text: "Pedido" }))),
      h("tbody", {}, ...ls.map((l) => h("tr", { dataset: { estado: campo(l, "estado") } }, ...col.map(([n, f, c]) => h("td", { class: c ?? "", "data-rotulo": n, text: f(l) })),
        h("td", { "data-rotulo": "Pedido" }, campo(l, "orcamento_id") ? h("a", { href: `#/orcamentos/${encodeURIComponent(campo(l, "orcamento_id"))}`, text: `n.º ${campo(l, "orcamento_id")}` }) : "—")))),
      t ? h("tfoot", {}, h("tr", {}, h("th", { scope: "row", colspan: "3", text: `Pagos (${campo(t, "pagamentos")})` }), h("td", { class: "num", text: euros(campo(t, "base")) }), h("td", { class: "num", text: euros(campo(t, "iva")) }), h("td", { class: "num", text: euros(campo(t, "total")) }), h("td", { colspan: "2" }))) : null));
    // Eletricistas externos: uma despesa (sem IVA), à parte da receita dos clientes.
    const el2 = campo(r, "eletricistas");
    if (el2) zonaPed.append(h("p", { class: "ajuda", id: "pagamentos-eletricistas-total", text: `Eletricistas externos (sem IVA, à parte destes totais): pagos ${euros(el2.pago.total)} (${el2.pago.trabalhos}) · por pagar ${euros(el2.a_pagar.total)} (${el2.a_pagar.trabalhos}).` }));
  }

  // "Pagamentos a eletricistas" (só com o módulo ligado): os trabalhos concluídos, o estado do pagamento (as três
  // condições: cliente confirmou, CEO aprovou, restante pago), o prazo de 7 dias, a fatura-recibo e o IBAN inteiro.
  const zonaEl = h("section", { class: "bloco-lista", id: "pagamentos-eletricistas", "aria-labelledby": "pe-titulo", hidden: !ctx.eletricistas },
    h("div", { class: "seccao-topo" }, h("h2", { id: "pe-titulo", text: "Pagamentos a eletricistas" })), carregando());
  el.querySelector("#pagamentos-pedidos").after(zonaEl);
  const ESTADO_SELO = { a_pagar: "grav-critica", fatura_em_falta: "aviso", pago: "estado-ativo" };
  async function carregarEletricistas() {
    if (!ctx.eletricistas) return;
    let r;
    try { r = await pedir("pagamentos-eletricistas", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zonaEl.replaceChildren(zonaEl.firstChild, erroEcra(e, carregarEletricistas)); return; }
    const ts = r.trabalhos ?? [];
    const topo = zonaEl.firstChild;
    const resumo = h("p", { class: "ajuda", text: `Por pagar (aprovados): ${euros(r.a_pagar.total)} (${r.a_pagar.trabalhos}) · pagos: ${euros(r.pago.total)} (${r.pago.trabalhos}). Paga-se até ${r.prazo_dias} dias depois da última condição: cliente confirmou, trabalho aprovado e, nas obras, restante pago pelo cliente. Valores sem IVA.` });
    if (!ts.length) { zonaEl.replaceChildren(topo, resumo, h("p", { class: "vazio", text: "Ainda não há trabalhos de eletricistas concluídos." })); return; }
    zonaEl.replaceChildren(topo, resumo, h("ul", { class: "linhas-simples", id: "lista-pagamentos-eletricistas" }, ...ts.map((t) => {
      const v = t.valor;
      const ida = t.parte === "regresso";
      const idBotao = `pago-${t.id}${ida ? "-regresso" : ""}`;
      return h("li", { dataset: { trabalho: String(t.id), parte: t.parte, pagamento: t.pagamento } },
        h("strong", { text: `${v ? euros(v.total) : "—"} — ${t.eletricista.nome}${ida ? " · ida sem defeito" : ""}` }), " ",
        h("a", { href: `#/orcamentos/${encodeURIComponent(t.orcamento_id)}`, text: `pedido n.º ${t.orcamento_id}` }), " ",
        selo(`${t.pagamento_texto}${t.pagamento === "a_pagar" && t.prazo ? ` até ${data(t.prazo)}` : ""}${t.pago_em ? ` em ${data(t.pago_em)}` : ""}`, ESTADO_SELO[t.pagamento] ?? "info"),
        h("span", { class: "bloco-ajuda", text: `${ida ? "Ida sem defeito (visita paga pelo cliente)" : t.tipo_nome} em ${t.concelho}${v ? ` · ${String(v.percentagem).replace(".", ",")} % de ${euros(v.mao_obra)} + ${euros(v.deslocacao)} de deslocação${t.valor_fixado ? "" : " (estimativa até aprovar)"}` : ""}` }),
        ["a_pagar", "fatura_em_falta", "pago"].includes(t.pagamento) ? h("span", { class: "bloco-ajuda num", text: `IBAN ${t.iban ?? "por indicar"}${t.eletricista.nif ? ` · NIF ${t.eletricista.nif}` : ""}` }) : null,
        t.fatura ? h("a", { class: "btn sec pequeno", href: t.fatura.url, target: "_blank", rel: "noopener", text: "Fatura-recibo" }) : null,
        t.pagamento === "a_pagar" ? h("button", { class: "btn sec pequeno", type: "button", id: idBotao, text: "Pago", "aria-label": `Marcar como pago: ${euros(v.total)} a ${t.eletricista.nome}${ida ? " (ida sem defeito)" : ""}`,
          onclick: async (e) => {
            const b = e.currentTarget;
            if (b.dataset.confirma !== "1") { b.dataset.confirma = "1"; b.textContent = "Confirmar: já transferi"; return; }
            b.disabled = true;
            try {
              await pedir(`trabalhos-eletricista/${encodeURIComponent(t.id)}/pago`, { corpo: ida ? { parte: "regresso" } : {} });
              avisar("Pagamento ao eletricista registado.");
              carregarEletricistas();
              carregarPedidos();
            } catch (erro) { b.disabled = false; avisar(erro.message, "erro"); }
          } }) : null);
    })));
  }

  async function carregar() {
    let r;
    try { r = await pedir("pagamentos", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zonaTotais.replaceChildren(erroEcra(e, carregar)); return; }
    linhas = lista(r, "linhas", "pagamentos");
    const totais = totaisDe(r, linhas).sort((a, b) => b.mes.localeCompare(a.mes));
    const max = Math.max(1, ...totais.map((t) => t.total));
    zonaTotais.replaceChildren(h("h2", { id: "totais-titulo", text: "Totais por mês" }), totais.length
      ? h("table", { class: "tabela totais", id: "totais" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Mês" }), h("th", { scope: "col", class: "num", text: "Com IVA" }), h("th", { scope: "col", class: "num so-largo", text: "Sem IVA" }), h("th", { scope: "col" }, h("span", { class: "so-leitor", text: "Proporção" })))),
          h("tbody", {}, ...totais.map((t) => {
            const barra = h("span", { class: "barra", "aria-hidden": "true" });
            barra.style.setProperty("--p", `${Math.round((t.total / max) * 100)}%`);
            return h("tr", { dataset: { mes: t.mes } }, h("th", { scope: "row" }, mes(t.mes), t.n != null ? h("span", { class: "ajuda bloco-ajuda", text: `${t.n} ${t.n === 1 ? "pagamento" : "pagamentos"}` }) : null), h("td", { class: "num", text: euros(t.total) }), h("td", { class: "num so-largo", text: t.semIva == null ? "—" : euros(t.semIva) }), h("td", { class: "celula-barra" }, barra));
          })))
      : h("p", { class: "vazio", text: "Ainda não há pagamentos." }));
    const meses = [...new Set(linhas.map(mesDe).filter(Boolean))].sort().reverse();
    fMes.replaceChildren(h("option", { value: "", text: "Todos os meses" }), ...meses.map((m) => h("option", { value: m, text: mes(m) })));
    if (meses.length) fMes.value = meses[0];
    exportar.disabled = !linhas.length;
    desenharTabela();
  }

  const visiveis = () => linhas.filter((l) => !fMes.value || mesDe(l) === fMes.value);

  function desenharTabela() {
    const vis = visiveis();
    if (!vis.length) { zonaTabela.replaceChildren(h("p", { class: "vazio", text: "Sem pagamentos neste mês." })); return; }
    const total = vis.reduce((s, l) => s + (numero(valorDe(l)) ?? 0), 0);
    zonaTabela.replaceChildren(h("table", { class: "tabela", id: "tabela-pagamentos" },
      h("caption", { class: "so-leitor", text: `Pagamentos de ${fMes.value ? mes(fMes.value) : "todos os meses"}` }),
      h("thead", {}, h("tr", {}, ...COLUNAS.map(([k, t]) => h("th", { scope: "col", class: k === "valor" || k === "sem_iva" ? "num" : "", text: t })))),
      h("tbody", {}, ...vis.map((l) => h("tr", {}, ...COLUNAS.map(([k, t, f]) => h("td", { class: k === "valor" || k === "sem_iva" ? "num" : "", "data-rotulo": t, text: f(l) }))))),
      h("tfoot", {}, h("tr", {}, h("th", { scope: "row", colspan: String(COLUNAS.length - 1), text: `Total (${vis.length})` }), h("td", { class: "num", text: euros(total) })))));
  }

  /** Exportar CSV: o ficheiro do servidor (GET pagamentos?formato=csv); sem ele, gera-o a partir das linhas. */
  async function exportarCsv() {
    const m = fMes.value;
    const nome = `pagamentos-${m || "todos"}.csv`;
    exportar.disabled = true;
    try {
      const r = await fetch(`${BASE}pagamentos?formato=csv${m ? `&mes=${encodeURIComponent(m)}` : ""}`, { credentials: "same-origin", headers: { Accept: "text/csv" } });
      if (r.status === 401 || r.status === 403) { avisar(r.status === 401 ? "A sessão terminou. Entre de novo." : "Não tem acesso a esta área.", "erro"); return; }
      if (r.ok && /text\/csv/.test(r.headers.get("content-type") ?? "")) { descarregar(await r.blob(), nome); return; }
    } catch { /* sem ligação: usa as linhas já carregadas */ }
    finally { exportar.disabled = !linhas.length; }
    const vis = visiveis();
    const chaves = [...new Set(vis.flatMap((l) => Object.keys(l)))];
    const texto = [chaves.map(celulaCsv).join(";"), ...vis.map((l) => chaves.map((k) => celulaCsv(l[k])).join(";"))].join("\r\n");
    descarregar(new Blob(["\ufeff", texto, "\r\n"], { type: "text/csv;charset=utf-8" }), nome);
  }
  function descarregar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: nome, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    avisar(`Ficheiro ${nome} descarregado.`);
  }

  carregar();
  carregarPedidos();
  carregarEletricistas();
  return { desmontar: () => ctrl.abort() };
}

