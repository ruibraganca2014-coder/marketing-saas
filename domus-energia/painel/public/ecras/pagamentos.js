// Pagamentos (CEO): totais por mês, tabela das linhas do CSV dos pagamentos e "Exportar CSV".
import { pedir, campo, lista, numero, BASE } from "../api.js";
import { h, PLANOS, euros, data, mes, nomeDe, carregando, erroEcra, txt, avisar } from "../ui.js";

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

export default function pagamentos(el) {
  const ctrl = new AbortController();
  let linhas = [];
  const fMes = h("select", { name: "mes", "aria-label": "Mês da tabela" });
  const exportar = h("button", { class: "btn sec", type: "button", id: "exportar-csv", text: "Exportar CSV", disabled: true });
  const zonaTotais = h("section", { class: "cartao", "aria-labelledby": "totais-titulo" }, h("h2", { id: "totais-titulo", text: "Totais por mês" }), carregando());
  const zonaTabela = h("div", { class: "tabela-rolar" });
  // Pagamentos dos pedidos (relatório, visita, avaria, sinal, restante; docs/PAGAMENTOS-PEDIDO.md), com base, IVA e total e o pedido
  // (também os anonimizados pelo RGPD). CSV do servidor: data;referencia;descricao;base;iva;total;estado;pedido.
  const exportarPed = h("button", { class: "btn sec pequeno", type: "button", id: "exportar-csv-pedidos", text: "Exportar CSV", disabled: true });
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

  async function carregarPedidos() {
    let r;
    try { r = await pedir("pagamentos-pedido", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zonaPed.replaceChildren(erroEcra(e, carregarPedidos)); return; }
    const ls = lista(r, "pagamentos");
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
  return { desmontar: () => ctrl.abort() };
}

