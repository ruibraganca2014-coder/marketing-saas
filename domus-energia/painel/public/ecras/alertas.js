// Alertas técnicos de todas as casas (GET alertas), agrupados por gravidade; atualiza sozinho a cada 30 s.
import { pedir, campo, lista } from "../api.js";
import { h, GRAVIDADES, gravidadeDe, data, selo, carregando, erroEcra, txt } from "../ui.js";

export const INTERVALO_ALERTAS = 30_000;
const ORDEM = ["critica", "alta", "media", "baixa"];
const TIPOS = {
  alarme_disparado: "Alarme disparado", alarme_entrada: "Alarme a aguardar desarme", alarme: "Alarme disparado",
  offline: "Aparelho offline", sem_noticias: "Sem notícias", bateria_fraca: "Bateria fraca", bateria_dias: "Bateria a acabar",
  sinal_fraco: "Sinal fraco", reinicios: "Reinícios frequentes", orcamento_novo: "Pedido de orçamento novo", pedido_novo: "Pedido de orçamento novo",
  chip_diferente: "Chip diferente do registado", chip_por_registar: "Chip por registar",
};
const gravidade = (a) => gravidadeDe(campo(a, "gravidade", "severidade", "nivel"));

export default function alertas(el, ctx) {
  let ctrl = new AbortController();
  let temporizador = null;
  const fCliente = h("input", { type: "search", name: "cliente", placeholder: "Código do cliente", "aria-label": "Só alertas deste cliente", maxlength: "32", autocapitalize: "none" });
  const atualizado = h("p", { class: "ajuda", id: "alertas-atualizado", role: "status" });
  const botao = h("button", { class: "btn sec pequeno", type: "button", text: "Atualizar agora", id: "alertas-atualizar", onclick: () => carregar() });
  const zona = h("div", { class: "zona-alertas", "aria-live": "polite" }, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Alertas" }), botao),
    h("div", { class: "filtros" }, fCliente),
    atualizado, zona);
  let tFiltro;
  fCliente.addEventListener("input", () => { clearTimeout(tFiltro); tFiltro = setTimeout(() => carregar(), 400); });

  async function carregar() {
    clearTimeout(temporizador);
    ctrl.abort(); ctrl = new AbortController();
    const c = fCliente.value.trim();
    try {
      const r = await pedir(`alertas${c ? `?cliente=${encodeURIComponent(c)}` : ""}`, { sinal: ctrl.signal });
      desenhar(lista(r, "alertas"));
      const semMqtt = campo(r, "ligado") === false ? " Atenção: o painel está sem ligação às casas; os alertas podem estar desatualizados." : "";
      atualizado.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-PT")}. Atualiza sozinho a cada 30 segundos.${semMqtt}`;
      atualizado.classList.toggle("aviso-texto", !!semMqtt);
    } catch (e) {
      if (e.name === "AbortError") return;
      if (e.estado === 403) { zona.replaceChildren(erroEcra(e)); return; }
      zona.replaceChildren(erroEcra(e, () => carregar()));
      atualizado.textContent = "";
    }
    temporizador = setTimeout(carregar, INTERVALO_ALERTAS);
  }

  function desenhar(itens) {
    if (!itens.length) { zona.replaceChildren(h("p", { class: "vazio sem-alertas", text: "Sem alertas. Todas as casas estão bem." })); return; }
    const grupos = Object.fromEntries(ORDEM.map((g) => [g, []]));
    for (const a of itens) grupos[gravidade(a)].push(a);
    zona.replaceChildren(...ORDEM.filter((g) => grupos[g].length).map((g) =>
      h("section", { class: `grupo-alertas grupo-${g}`, dataset: { gravidade: g } },
        h("h2", {}, `${GRAVIDADES[g]} `, h("span", { class: "contagem num", text: `(${grupos[g].length})` })),
        h("ul", { class: "alertas" }, ...grupos[g].map((a) => item(a, g))))));
  }

  function item(a, g) {
    const cliente = campo(a, "cliente", "codigo");
    const tipo = campo(a, "tipo");
    return h("li", { class: `alerta alerta-${g}` },
      h("span", { class: "alerta-cabeca" }, selo(GRAVIDADES[g], `grav-${g}`), h("strong", { text: TIPOS[tipo] ?? txt(a, "titulo", "tipo") })),
      h("span", { class: "alerta-texto", text: txt(a, "mensagem", "texto", "descricao") }),
      h("span", { class: "alerta-meta ajuda" },
        cliente ? h("a", { href: `#/clientes/${encodeURIComponent(cliente)}`, text: txt(a, "cliente_nome", "cliente") }) : null,
        campo(a, "aparelho") ? ` · ${txt(a, "aparelho_nome", "aparelho")}` : "",
        campo(a, "desde", "quando", "criado") ? ` · desde ${data(campo(a, "desde", "quando", "criado"))}` : ""));
  }

  // Ao voltar ao separador, atualiza logo.
  const aoVoltar = () => { if (!document.hidden) carregar(); };
  document.addEventListener("visibilitychange", aoVoltar);
  carregar();
  return { desmontar() { clearTimeout(temporizador); clearTimeout(tFiltro); ctrl.abort(); document.removeEventListener("visibilitychange", aoVoltar); } };
}
