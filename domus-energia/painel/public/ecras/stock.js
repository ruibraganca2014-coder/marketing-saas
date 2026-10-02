// Stock (só CEO; docs/PAINEL-EMPRESA.md "Stock"): os artigos com a quantidade em armazém, a reservada para obras aceites,
// a disponível e o mínimo — abaixo do mínimo primeiro — e os últimos movimentos. "Entrada de stock" (com o custo real de
// compra) e "Acerto" (inventário) → POST catalogo/:id/stock. As reservas e as saídas são automáticas: sinal pago →
// reserva; obra concluída → saída; pedido ou obra cancelados → libertação. Nada disto aparece ao cliente.
import { pedir, campo, lista, numero } from "../api.js";
import { h, euros, selo, campoForm, escolha, janela, mensagem, avisar, carregando, erroEcra, data } from "../ui.js";

const MOTIVOS = { entrada: "Entrada", reserva: "Reserva", libertacao: "Libertação", saida: "Saída", acerto: "Acerto" };

/**
 * Janela "Entrada de stock" de um artigo (também usada no Catálogo): quantidade, custo real de compra (preço +
 * transporte + alfândega) e nota; "Acerto" aceita quantidades negativas. `aoGuardar(artigo)` recebe o artigo atualizado.
 */
export function abrirEntradaStock(a, aoGuardar) {
  const j = janela(`Entrada de stock — ${campo(a, "sku")}`);
  const msg = h("div", { class: "msg", role: "alert", hidden: true });
  const motivo = escolha("motivo", { entrada: "Entrada (compra recebida)", acerto: "Acerto (inventário, + ou −)" }, "entrada");
  const f = h("form", { class: "form-grelha", id: "form-stock", novalidate: true },
    h("p", { class: "ajuda", text: `${campo(a, "nome") ?? ""} — em armazém: ${campo(a, "stock_qtd") ?? 0}${campo(a, "stock_reservado") ? ` (${campo(a, "stock_reservado")} reservados)` : ""}.` }),
    h("div", { class: "duas" },
      campoForm("Tipo", motivo),
      campoForm("Quantidade", h("input", { name: "qtd", type: "number", step: "1", inputmode: "numeric", required: true }))),
    campoForm("Custo real por unidade (€)", h("input", { name: "preco_compra", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: campo(a, "preco_compra") ?? "" }),
      "Preço + transporte + alfândega. Vazio = não muda."),
    campoForm("Nota", h("input", { name: "nota", maxlength: "200", placeholder: "Ex.: encomenda de outubro" })),
    h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar" }), h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => j.fechar() })),
    msg);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const el = f.elements;
    const qtd = numero(el.qtd.value);
    if (qtd === null || !Number.isInteger(qtd) || qtd === 0 || (motivo.value === "entrada" && qtd < 0)) {
      mensagem(msg, motivo.value === "entrada" ? "A quantidade tem de ser um número inteiro maior que 0." : "A quantidade tem de ser um número inteiro diferente de 0."); el.qtd.focus(); return;
    }
    const custoTxt = el.preco_compra.value.trim();
    const custo = custoTxt === "" ? null : numero(custoTxt);
    if (custoTxt !== "" && (custo === null || custo < 0)) { mensagem(msg, "O custo tem de ser um número (ou vazio)."); el.preco_compra.focus(); return; }
    const corpo = { qtd, motivo: motivo.value, nota: el.nota.value.trim() || null, ...(custo !== null ? { preco_compra: custo } : {}) };
    const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
    try {
      const r = await pedir(`catalogo/${encodeURIComponent(campo(a, "id"))}/stock`, { corpo });
      avisar(`Stock de ${campo(a, "sku")} atualizado.`);
      j.fechar();
      aoGuardar?.(campo(r, "artigo") ?? r);
    } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
  });
  j.corpo.append(f);
  f.elements.qtd.focus();
}

export default function stock(el) {
  const ctrl = new AbortController();
  const contagem = h("p", { class: "ajuda", role: "status", id: "stock-contagem" });
  const zona = h("div", { class: "tabela-rolar" }, carregando());
  const zonaMov = h("div", { class: "tabela-rolar" });
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Stock" })),
    h("p", { class: "ajuda", text: "Material em armazém. Sinal pago → o material da obra fica reservado; obra concluída → sai. Só entram aqui os artigos com um mínimo ou com movimentos (uma entrada de stock)." }),
    contagem, zona,
    h("section", { class: "bloco-lista" }, h("div", { class: "seccao-topo" }, h("h2", { text: "Últimos movimentos" })), zonaMov));

  async function carregar() {
    let r;
    try { r = await pedir("stock", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    const itens = lista(r, "itens");
    const abaixo = itens.filter((a) => campo(a, "abaixo") === true).length;
    contagem.textContent = `${itens.length} ${itens.length === 1 ? "artigo" : "artigos"}${abaixo ? ` · ${abaixo} abaixo do mínimo` : ""}`;
    zona.replaceChildren(itens.length ? h("table", { class: "tabela tabela-cartoes", id: "tabela-stock" },
      h("caption", { class: "so-leitor", text: "Stock por artigo" }),
      h("thead", {}, h("tr", {}, ...["Artigo", "Em armazém", "Reservado", "Disponível", "Mínimo", "Custo", ""].map((t, i) =>
        h("th", { scope: "col", class: i >= 1 && i <= 5 ? "num" : "", text: t }, i === 6 ? h("span", { class: "so-leitor", text: "Ações" }) : null)))),
      h("tbody", {}, ...itens.map((a) => h("tr", { dataset: { sku: String(campo(a, "sku") ?? "") }, class: campo(a, "abaixo") === true ? "margem-baixa" : "" },
        h("td", { "data-rotulo": "Artigo" }, h("div", {}, h("strong", { class: "bloco-ajuda", text: String(campo(a, "nome") ?? "—") }),
          h("span", { class: "linha-selos" }, h("span", { class: "ajuda", text: String(campo(a, "sku") ?? "") }),
            campo(a, "abaixo") === true ? selo("Abaixo do mínimo", "grav-critica") : null, campo(a, "gerido") === true ? null : selo("Sem stock registado", "info")))),
        h("td", { class: "num", "data-rotulo": "Em armazém", text: String(campo(a, "stock_qtd") ?? 0) }),
        h("td", { class: "num", "data-rotulo": "Reservado", text: String(campo(a, "stock_reservado") ?? 0) }),
        h("td", { class: "num", "data-rotulo": "Disponível", text: String(campo(a, "disponivel") ?? 0) }),
        h("td", { class: "num", "data-rotulo": "Mínimo", text: String(campo(a, "stock_minimo") ?? 0) }),
        h("td", { class: "num", "data-rotulo": "Custo", text: euros(campo(a, "preco_compra")) }),
        h("td", { class: "acoes" }, h("button", { class: "btn sec pequeno", type: "button", text: "Entrada de stock", "aria-label": `Entrada de stock de ${campo(a, "nome") ?? campo(a, "sku")}`, onclick: () => abrirEntradaStock(a, carregar) }))))))
      : h("p", { class: "vazio", text: "Ainda não há artigos no catálogo." }));
    const mov = lista(r, "movimentos");
    zonaMov.replaceChildren(mov.length ? h("table", { class: "tabela tabela-cartoes", id: "tabela-movimentos" },
      h("caption", { class: "so-leitor", text: "Movimentos de stock" }),
      h("thead", {}, h("tr", {}, ...["Quando", "Artigo", "Movimento", "Qtd.", "Pedido", "Quem"].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : "", text: t })))),
      h("tbody", {}, ...mov.map((m) => h("tr", { dataset: { motivo: String(campo(m, "motivo") ?? "") } },
        h("td", { "data-rotulo": "Quando", text: data(campo(m, "quando")) }),
        h("td", { "data-rotulo": "Artigo", text: `${campo(m, "sku")} — ${campo(m, "nome")}` }),
        h("td", { "data-rotulo": "Movimento", text: `${MOTIVOS[campo(m, "motivo")] ?? campo(m, "motivo")}${campo(m, "nota") ? ` (${campo(m, "nota")})` : ""}` }),
        h("td", { class: "num", "data-rotulo": "Qtd.", text: `${campo(m, "qtd") > 0 ? "+" : ""}${campo(m, "qtd")}` }),
        h("td", { "data-rotulo": "Pedido" }, campo(m, "orcamento_id") ? h("a", { href: `#/orcamentos/${encodeURIComponent(campo(m, "orcamento_id"))}`, text: `n.º ${campo(m, "orcamento_id")}` }) : "—"),
        h("td", { "data-rotulo": "Quem", text: String(campo(m, "por") ?? "—") })))))
      : h("p", { class: "vazio", text: "Ainda não há movimentos." }));
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
