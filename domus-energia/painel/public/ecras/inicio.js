// Início: resumo por papel (GET resumo). O servidor já só manda o que o papel pode ver;
// aqui mostra-se o que vier, com nomes conhecidos para os campos do §3.
import { pedir, campo, numero } from "../api.js";
import { h, euros, num, data, PLANOS, ESTADOS_CLIENTE, ESTADOS_ORC, KITS, nomeDe, carregando, erroEcra, txt } from "../ui.js";

const saudacao = () => { const hr = new Date().getHours(); return hr < 13 ? "Bom dia" : hr < 20 ? "Boa tarde" : "Boa noite"; };

export default function inicio(el, ctx) {
  const titulo = h("h1", { text: `${saudacao()}, ${ctx.eu.nome.split(" ")[0] || ""}`.replace(/, $/, "") });
  const zona = h("div", { class: "inicio" }, carregando());
  el.append(h("div", { class: "ecra-topo" }, titulo), zona);
  const ctrl = new AbortController();

  async function carregar() {
    zona.replaceChildren(carregando());
    let r;
    try { r = await pedir("resumo", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    zona.replaceChildren(...montar(r ?? {}));
  }

  function montar(r) {
    const kpis = [];
    const blocos = [];
    const kpi = (rotulo, valor, { href, destaque, ajuda } = {}) => {
      const c = h(href ? "a" : "div", { class: `kpi ${destaque ?? ""}`.trim(), href },
        h("span", { class: "kpi-rotulo", text: rotulo }),
        h("span", { class: "kpi-valor num", text: valor }),
        ajuda ? h("span", { class: "kpi-ajuda", text: ajuda }) : null);
      kpis.push(c);
    };
    const contar = (v) => numero(Array.isArray(v) ? v.length : v);

    // CEO
    const receita = campo(r, "receita_recorrente_mensal", "receita_mensal", "receita_recorrente", "mrr");
    if (receita !== undefined) kpi("Receita recorrente mensal", euros(receita), { ajuda: "Soma dos planos ativos, sem IVA" });
    const recebido = campo(r, "recebido_mes", "recebido_este_mes", "recebido");
    if (recebido !== undefined) {
      const obj = recebido && typeof recebido === "object";
      const n = obj ? numero(campo(recebido, "pagamentos")) : null;
      kpi("Recebido este mês", euros(obj ? campo(recebido, "com_iva", "total") : recebido), {
        href: ctx.pode("ceo") ? "#/pagamentos" : undefined,
        ajuda: obj ? `${n ?? 0} ${n === 1 ? "pagamento" : "pagamentos"} · ${euros(campo(recebido, "sem_iva"))} sem IVA` : undefined,
      });
    }
    const novos = campo(r, "pedidos_novos", "orcamentos_novos");
    if (novos !== undefined) kpi("Pedidos de orçamento novos", num(contar(novos)), { href: ctx.pode("ceo", "comercial") ? "#/orcamentos" : undefined, destaque: contar(novos) > 0 ? "atencao" : "" });
    // Alertas: número, lista, ou {ligado, contagem: {critica, alta, media, baixa}, criticos|principais: [...]}
    const alertas = campo(r, "alertas");
    let criticos = campo(r, "alertas_criticos");
    if (alertas && typeof alertas === "object" && !Array.isArray(alertas)) {
      const cont = campo(alertas, "contagem") ?? {};
      if (ctx.pode("ceo")) criticos = numero(campo(cont, "critica")) ?? campo(alertas, "criticos");
      else {
        const totalAl = Object.values(cont).reduce((s, v) => s + (numero(v) ?? 0), 0) || contar(campo(alertas, "principais") ?? []);
        kpi("Alertas", num(totalAl), { href: "#/alertas", destaque: numero(campo(cont, "critica")) > 0 ? "perigo" : totalAl > 0 ? "atencao" : "", ajuda: numero(campo(cont, "critica")) ? `${num(campo(cont, "critica"))} críticos` : undefined });
      }
      if (campo(alertas, "ligado") === false) kpi("Ligação às casas", "Sem ligação", { href: "#/alertas", destaque: "perigo", ajuda: "Os alertas podem estar desatualizados" });
    } else if (alertas !== undefined && criticos === undefined) kpi("Alertas", num(contar(alertas)), { href: "#/alertas", destaque: contar(alertas) > 0 ? "atencao" : "" });
    if (criticos !== undefined) kpi("Alertas críticos", num(contar(criticos)), { href: "#/alertas", destaque: contar(criticos) > 0 ? "perigo" : "" });
    // Propostas aceites pelo cliente na conta (online) e ainda por converter em cliente e obra.
    const aceites = campo(r, "propostas_aceites_online");
    if (Array.isArray(aceites) && aceites.length) {
      blocos.push(h("section", { class: "cartao", id: "propostas-aceites-online" }, h("h2", { text: "Propostas aceites online (por converter)" }),
        h("ul", { class: "lista-curta" }, ...aceites.map((o) => h("li", {}, h("a", { class: "lista-curta-item", href: `#/orcamentos/${encodeURIComponent(campo(o, "id"))}` },
          h("span", { class: "num quando", text: data(campo(o, "quando")) }), h("span", { class: "lc-quem", text: txt(o, "nome") }),
          h("span", { class: "ajuda", text: campo(o, "valor_proposta") != null ? `${euros(campo(o, "valor_proposta"))} + IVA` : "" })))))));
    }
    const pendentes = campo(r, "pedidos_admin_pendentes");
    if (pendentes !== undefined && numero(pendentes) > 0) kpi("Pedidos ao servidor por aplicar", num(pendentes), { ajuda: "Clientes, aparelhos ou planos à espera do servidor" });

    // Distribuições (clientes por plano/estado, pedidos por estado)
    const cli = campo(r, "clientes");
    const porPlano = campo(r, "clientes_por_plano") ?? (cli && typeof cli === "object" ? campo(cli, "por_plano") : undefined);
    if (porPlano && typeof porPlano === "object") blocos.push(distribuicao("Clientes por plano", porPlano, PLANOS, "#/clientes"));
    const porEstado = campo(r, "clientes_por_estado") ?? (cli && typeof cli === "object" ? campo(cli, "por_estado") : undefined);
    if (porEstado && typeof porEstado === "object") blocos.push(distribuicao("Clientes por estado", porEstado, ESTADOS_CLIENTE, "#/clientes"));
    const pedidos = campo(r, "pedidos_por_estado", "orcamentos_por_estado");
    if (pedidos && typeof pedidos === "object") blocos.push(distribuicao("Pedidos de orçamento por estado", pedidos, ESTADOS_ORC, "#/orcamentos"));

    // Listas de obras e visitas
    for (const [nomes, t, vazio] of [
      [["obras_hoje"], "As minhas obras de hoje", "Sem obras hoje."],
      [["obras_semana"], ctx.pode("tecnico") ? "As minhas obras desta semana" : "Obras desta semana", "Sem obras esta semana."],
      [["visitas_semana", "visitas"], "Visitas desta semana", "Sem visitas marcadas esta semana."],
    ]) {
      const v = campo(r, ...nomes);
      if (v === undefined) continue;
      if (Array.isArray(v)) blocos.push(listaCurta(t, v, vazio, nomes[0].startsWith("visitas")));
      else kpi(t, num(v), { href: nomes[0].startsWith("visitas") ? "#/orcamentos" : "#/obras" });
    }
    const out = [];
    if (kpis.length) out.push(h("div", { class: "kpis" }, ...kpis));
    if (blocos.length) out.push(h("div", { class: "blocos" }, ...blocos));
    if (!out.length) out.push(h("p", { class: "vazio", text: "Sem dados para mostrar." }));
    return out;
  }

  function distribuicao(t, obj, nomes, href) {
    const entradas = Object.entries(obj).map(([k, v]) => [k, numero(v) ?? 0]);
    const total = entradas.reduce((s, [, v]) => s + v, 0);
    return h("section", { class: "cartao bloco-dist" },
      h("h2", {}, h("a", { href, text: t })),
      h("p", { class: "ajuda", text: `Total: ${num(total)}` }),
      h("ul", { class: "barras" }, ...entradas.map(([k, v]) => {
        const barra = h("span", { class: "barra", "aria-hidden": "true" });
        barra.style.setProperty("--p", total ? `${Math.round((v / total) * 100)}%` : "0%");
        return h("li", { dataset: { chave: k } },
          h("span", { class: "barra-rotulo", text: nomeDe(nomes, k) }),
          barra,
          h("span", { class: "barra-valor num", text: num(v) }));
      })));
  }

  function listaCurta(t, itens, vazio, visitas) {
    return h("section", { class: "cartao" },
      h("h2", { text: t }),
      itens.length
        ? h("ul", { class: "lista-curta" }, ...itens.map((o) => {
            const id = campo(o, "id");
            const quando = data(campo(o, "data_visita", "data", "quando"));
            const quem = txt(o, "cliente_nome", "nome", "cliente");
            const extra = visitas ? txt(o, "localidade", "servico") : nomeDe(KITS, campo(o, "kit"));
            const href = id != null ? `#/${visitas ? "orcamentos" : "obras"}/${encodeURIComponent(id)}` : undefined;
            return h("li", {}, h(href ? "a" : "span", { href, class: "lista-curta-item" },
              h("span", { class: "num quando", text: quando }), h("span", { class: "lc-quem", text: quem }), h("span", { class: "ajuda", text: extra })));
          }))
        : h("p", { class: "vazio", text: vazio }));
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}

