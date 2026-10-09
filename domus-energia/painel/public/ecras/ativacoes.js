// Ativações de aparelhos (só CEO; docs/ATIVACAO-APARELHOS.md): os chips que os eletricistas registaram dentro dos
// seus trabalhos. Por aprovar (Aprovar / Recusar) e as últimas decididas (Anular nas aprovadas). O CEO é o
// superutilizador: nada entra sem ele, salvo dos eletricistas que marcou como "ativa sem aprovação", e mesmo essas pode anular.
import { pedir, campo, lista } from "../api.js";
import { h, data, selo, avisar, carregando, erroEcra } from "../ui.js";

const ESTADOS = { pendente: "Por aprovar", aprovada: "Aprovada", recusada: "Recusada", anulada: "Anulada" };
const CHIP = { por_registar: "sem chip registado", por_ver: "registado, ainda não visto", confere: "confere com o aparelho", diferente: "o aparelho responde com outro chip" };

export default function ativacoes(el, ctx) {
  const ctrl = new AbortController();
  const zona = h("div", { class: "zona-lista" }, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Ativações de aparelhos" })),
    h("p", { class: "ajuda", text: "O eletricista regista o chip de cada aparelho que monta, dentro do trabalho dele. Aqui aprova, recusa ou anula. Um aparelho com chip aprovado que responda com outro chip dá um alerta crítico." }),
    zona);

  async function decidir(a, acao, botao) {
    botao.disabled = true;
    try {
      desenhar(await pedir(`ativacoes/${encodeURIComponent(campo(a, "id"))}`, { corpo: { acao } }));
      avisar({ aprovar: "Ativação aprovada: o chip ficou registado.", recusar: "Ativação recusada.", anular: "Ativação anulada." }[acao], "ok");
    } catch (e) {
      botao.disabled = false;
      avisar(e.message, "erro");
    }
  }

  function linha(a) {
    const estado = campo(a, "estado");
    const ele = campo(a, "eletricista");
    const chip = campo(a, "chip_atual") ?? {};
    const botao = (texto, acao, classe = "btn sec pequeno") => {
      const b = h("button", { class: classe, type: "button", text: texto, dataset: { ativacao: String(campo(a, "id")), acao } });
      b.addEventListener("click", () => decidir(a, acao, b));
      return b;
    };
    return h("li", { class: "lista-curta-item" },
      h("div", {},
        h("strong", { text: `${campo(a, "aparelho")} · casa ${campo(a, "cliente")}` }), " ", selo(ESTADOS[estado] ?? estado, `ativacao-${estado}`),
        h("p", { class: "ajuda", text: `Chip ${campo(a, "mac")}${campo(a, "serie") ? ` · série ${campo(a, "serie")}` : ""}` }),
        h("p", { class: "ajuda", text: `${ele ? `${campo(ele, "nome") ?? "Eletricista"}` : "Painel"} · ${data(campo(a, "criado"))}${campo(a, "pedido_id") ? ` · pedido n.º ${campo(a, "pedido_id")}` : ""}` }),
        h("p", { class: "ajuda", text: `Agora: ${CHIP[campo(chip, "estado")] ?? "—"}${campo(a, "decidido_por") ? ` · decidido por ${campo(a, "decidido_por")}` : ""}` })),
      h("div", { class: "form-botoes" },
        ...(estado === "pendente" ? [botao("Aprovar", "aprovar", "btn pequeno"), botao("Recusar", "recusar")] : estado === "aprovada" ? [botao("Anular", "anular")] : []),
        h("a", { class: "btn sec pequeno", href: `#/clientes/${encodeURIComponent(campo(a, "cliente"))}`, text: "Ver a casa" })));
  }

  function desenhar(r) {
    const pend = lista(campo(r, "pendentes")), rec = lista(campo(r, "recentes"));
    zona.replaceChildren(
      h("section", { class: "cartao", id: "ativacoes-pendentes" }, h("h2", { text: "Por aprovar" }),
        pend.length ? h("ul", { class: "lista-curta" }, ...pend.map(linha)) : h("p", { class: "vazio", text: "Nada por aprovar." })),
      h("section", { class: "cartao", id: "ativacoes-recentes" }, h("h2", { text: "Últimas decididas" }),
        rec.length ? h("ul", { class: "lista-curta" }, ...rec.map(linha)) : h("p", { class: "vazio", text: "Ainda sem ativações." })));
  }

  pedir("ativacoes", { sinal: ctrl.signal }).then(desenhar).catch((e) => { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, () => ctx.recarregar?.())); });
  return () => ctrl.abort();
}
