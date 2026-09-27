// Auditoria (CEO): últimas 500 ações (quem, o quê, quando), com filtro de texto.
import { pedir, campo, lista } from "../api.js";
import { h, data, carregando, erroEcra, txt } from "../ui.js";

const detalhe = (v) => (v == null || v === "" ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function auditoria(el) {
  const ctrl = new AbortController();
  let todos = [];
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar pessoa, ação ou cliente", "aria-label": "Procurar na auditoria", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "tabela-rolar" }, carregando());
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Auditoria" })),
    h("p", { class: "ajuda", text: "Últimas 500 alterações feitas no painel." }),
    h("div", { class: "filtros" }, fTexto), contagem, zona);
  fTexto.addEventListener("input", desenhar);

  async function carregar() {
    try { todos = lista(await pedir("auditoria", { sinal: ctrl.signal }), "auditoria", "registos", "acoes"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  const linhaTexto = (a) => [txt(a, "por", "utilizador", "email"), txt(a, "acao"), txt(a, "alvo"), detalhe(campo(a, "detalhes", "dados"))].join(" ").toLowerCase();

  function desenhar() {
    const t = fTexto.value.trim().toLowerCase();
    const vis = todos.filter((a) => !t || linhaTexto(a).includes(t));
    contagem.textContent = `${vis.length} ${vis.length === 1 ? "registo" : "registos"}`;
    if (!vis.length) { zona.replaceChildren(h("p", { class: "vazio", text: todos.length ? "Nada com esta procura." : "Ainda não há registos." })); return; }
    zona.replaceChildren(h("table", { class: "tabela", id: "tabela-auditoria" },
      h("thead", {}, h("tr", {}, ...["Quando", "Quem", "Ação", "Alvo", "Detalhes"].map((c) => h("th", { scope: "col", text: c })))),
      h("tbody", {}, ...vis.map((a) => h("tr", {},
        h("td", { class: "num", "data-rotulo": "Quando", text: data(campo(a, "quando", "em", "criado")) }),
        h("td", { "data-rotulo": "Quem", text: txt(a, "por", "utilizador", "email") }),
        h("td", { "data-rotulo": "Ação", text: txt(a, "acao") }),
        h("td", { "data-rotulo": "Alvo", text: txt(a, "alvo") }),
        h("td", { class: "detalhes", "data-rotulo": "Detalhes", text: detalhe(campo(a, "detalhes", "dados")) || "—" }))))));
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
