// Dashboard do negócio no Início (GET resumo/negocio; docs/DASHBOARD.md). O servidor calcula tudo e já só manda o que o
// papel pode ver (o comercial não recebe valores em euros): aqui mostra-se o que vier. Os botões do período voltam a
// pedir só este bloco; o resto do Início fica como está.
import { pedir, campo, numero, lista } from "../api.js";
import { h, euros, num, data, ORIGENS_CONTACTO, nomeDe, carregando, erroEcra } from "../ui.js";

const PERIODOS = { semana: "Esta semana", mes: "Este mês", mes_passado: "Mês passado", ano: "Este ano" };
const dia = (v) => data(v, { hora: false });
const plural = (n, um, varios) => `${num(n)} ${numero(n) === 1 ? um : varios}`;

/** Bloco "O negócio" (CEO e comercial). `sinal`: o AbortSignal do ecrã (os pedidos param ao sair do Início). */
export function blocoNegocio(sinal) {
  let periodo = "mes";
  const estado = h("p", { class: "ajuda", id: "negocio-periodo", role: "status" });
  const zona = h("div", { class: "negocio-zona", id: "negocio-zona" }, carregando());
  const botoes = Object.entries(PERIODOS).map(([k, t]) => h("button", { class: "segmento", type: "button", dataset: { periodo: k }, text: t, "aria-pressed": "false",
    onclick: () => { if (k !== periodo) { periodo = k; carregar(); } } }));
  const seccao = h("section", { class: "negocio", id: "negocio", "aria-labelledby": "negocio-titulo" },
    h("div", { class: "negocio-topo" }, h("h2", { id: "negocio-titulo", text: "O negócio" }),
      h("div", { class: "segmentos", role: "group", "aria-label": "Período" }, ...botoes)),
    estado, zona);

  async function carregar() {
    const pedido = periodo;
    botoes.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.periodo === periodo)));
    zona.setAttribute("aria-busy", "true");
    let r;
    try { r = await pedir(`resumo/negocio?periodo=${encodeURIComponent(pedido)}`, { sinal }); }
    catch (e) {
      if (e.name === "AbortError" || pedido !== periodo) return;
      zona.removeAttribute("aria-busy");
      estado.textContent = "";
      zona.replaceChildren(erroEcra(e, carregar));
      return;
    }
    // Uma resposta que chega depois de se ter escolhido outro período já não interessa.
    if (pedido !== periodo) return;
    zona.removeAttribute("aria-busy");
    estado.textContent = textoPeriodo(pedido, campo(r, "periodo"));
    zona.replaceChildren(...montar(r ?? {}));
  }

  carregar();
  return seccao;
}

/** "Este mês: 01/10/2026 a 14/10/2026, comparado com 01/09/2026 a 14/09/2026." (um período a decorrer vai só até hoje). */
function textoPeriodo(chave, p) {
  if (!p) return "";
  const hoje = campo(p, "hoje");
  const fim = campo(p, "completo") === true || !hoje || hoje > campo(p, "fim") ? campo(p, "fim") : hoje;
  const antes = campo(p, "anterior");
  return `${PERIODOS[chave] ?? "Período"}: ${dia(campo(p, "inicio"))} a ${dia(fim)}${antes ? `, comparado com ${dia(campo(antes, "inicio"))} a ${dia(campo(antes, "fim"))}` : ""}.`;
}

/**
 * Diferença para o período anterior: "↑ 25 % · antes: 4" (sem percentagem quando o anterior é 0: "↑ 3 · antes: 0").
 * A seta não vai sozinha: os leitores de ecrã ouvem "Subiu" / "Desceu".
 */
function variacao(dif, quanto, antes) {
  const d = numero(dif);
  if (d === null) return h("span", { class: "kpi-var", text: `Antes: ${antes}` });
  return h("span", { class: `kpi-var ${d > 0 ? "sobe" : d < 0 ? "desce" : ""}`.trim() },
    h("span", { "aria-hidden": "true", text: d === 0 ? "= igual" : `${d > 0 ? "↑" : "↓"} ${quanto}` }),
    h("span", { class: "so-leitor", text: d === 0 ? "Igual ao período anterior" : `${d > 0 ? "Subiu" : "Desceu"} ${quanto}` }),
    ` · antes: ${antes}`);
}
/** `v`: {dif, pct} do servidor; `fmt`: como se escreve o valor (número ou euros). */
const variacaoDe = (v, antes, fmt = num) => {
  const pct = numero(campo(v, "pct"));
  return variacao(campo(v, "dif") ?? 0, pct !== null ? `${num(Math.abs(pct))} %` : fmt(Math.abs(numero(campo(v, "dif")) ?? 0)), fmt(antes ?? 0));
};

function kpi(rotulo, valor, { href, destaque, ajuda, extra } = {}) {
  return h(href ? "a" : "div", { class: `kpi ${destaque ?? ""}`.trim(), href },
    h("span", { class: "kpi-rotulo", text: rotulo }),
    h("span", { class: "kpi-valor num", text: valor }),
    extra ?? null,
    [ajuda ?? []].flat().filter(Boolean).map((t) => h("span", { class: "kpi-ajuda", text: t })));
}

/** Pedidos por semana (últimas 8, a atual no fim): barras só com CSS; os números vão no texto alternativo. */
function miniBarras(semanas) {
  const ns = semanas.map((s) => numero(campo(s, "n")) ?? 0);
  const max = Math.max(1, ...ns);
  return h("span", { class: "mini-barras", role: "img", "aria-label": `Pedidos por semana nas últimas ${ns.length} semanas, da mais antiga para a atual: ${ns.map((n) => num(n)).join(", ")}` },
    ...semanas.map((s, i) => {
      const b = h("span", { title: `Semana de ${dia(campo(s, "inicio"))}: ${num(ns[i])}` });
      b.style.setProperty("--a", `${Math.round((ns[i] / max) * 100)}%`);
      return b;
    }));
}

function montar(r) {
  const kpis = [];
  const blocos = [];
  const avisos = [];

  // 1. Pedidos recebidos (e por semana)
  const pedidos = campo(r, "pedidos");
  if (pedidos) {
    const semanas = lista(pedidos, "semanas");
    kpis.push(kpi("Pedidos recebidos", num(campo(pedidos, "n") ?? 0), { href: "#/orcamentos",
      extra: [variacaoDe(campo(pedidos, "variacao"), campo(pedidos, "anterior")), semanas.length ? miniBarras(semanas) : null],
      ajuda: semanas.length ? `Barras: pedidos por semana nas últimas ${num(semanas.length)} semanas` : null }));
  }

  // 2. Taxa de aceitação
  const ac = campo(r, "aceitacao");
  if (ac) {
    const taxa = numero(campo(ac, "taxa"));
    const antes = numero(campo(campo(ac, "anterior"), "taxa"));
    const pontos = numero(campo(ac, "variacao_pontos"));
    const enviadas = numero(campo(ac, "enviadas")) ?? 0;
    kpis.push(kpi("Taxa de aceitação", taxa === null ? "—" : `${num(taxa)} %`, {
      extra: pontos === null ? h("span", { class: "kpi-var", text: `Antes: ${antes === null ? "sem propostas enviadas" : `${num(antes)} %`}` })
        : variacao(pontos, `${num(Math.abs(pontos))} pontos`, `${num(antes)} %`),
      ajuda: enviadas ? `Propostas enviadas no período que já foram aceites: ${num(campo(ac, "aceites") ?? 0)} de ${num(enviadas)}`
        : "Propostas enviadas no período que já foram aceites: ainda não foi enviada nenhuma" }));
  }

  // 3. Receita e 4. margem (só CEO)
  const receita = campo(r, "receita");
  if (receita) {
    const simulados = numero(campo(receita, "simulados")) ?? 0;
    kpis.push(kpi("Receita", euros(campo(receita, "sem_iva") ?? 0), { href: "#/pagamentos",
      extra: variacaoDe(campo(receita, "variacao"), campo(campo(receita, "anterior"), "sem_iva"), euros),
      ajuda: [`Recebido sem IVA · ${euros(campo(receita, "com_iva") ?? 0)} com IVA`,
        `Pedidos ${euros(campo(receita, "pedidos_sem_iva") ?? 0)} · planos ${euros(campo(receita, "planos_sem_iva") ?? 0)}${numero(campo(receita, "devolvido")) ? ` · devolvido ${euros(campo(receita, "devolvido"))} (com IVA)` : ""}`,
        simulados ? `Inclui ${plural(simulados, "pagamento simulado", "pagamentos simulados")} (modo de demonstração)` : null] }));
  }
  const margem = campo(r, "margem");
  if (margem) {
    const semCusto = campo(margem, "sem_custo");
    const nSemCusto = numero(campo(semCusto, "artigos")) ?? 0;
    const semLista = numero(campo(margem, "obras_sem_lista")) ?? 0;
    kpis.push(kpi("Margem", euros(campo(margem, "valor") ?? 0), { destaque: nSemCusto || semLista ? "atencao" : "",
      extra: variacaoDe(campo(margem, "variacao"), campo(campo(margem, "anterior"), "valor"), euros),
      ajuda: [`Receita sem IVA − material ${euros(campo(margem, "material") ?? 0)} − eletricistas ${euros(campo(margem, "eletricistas") ?? 0)}`,
        `Material e eletricistas de ${plural(campo(margem, "obras") ?? 0, "obra concluída", "obras concluídas")} no período`] }));
    if (nSemCusto) {
      const nomes = lista(semCusto, "lista").map((a) => String(campo(a, "nome") ?? campo(a, "sku") ?? "")).filter(Boolean);
      avisos.push(h("div", { class: "msg info bloco", id: "negocio-sem-custo" },
        h("p", { text: `A margem está acima do real: ${plural(nSemCusto, "artigo usado", "artigos usados")} nas obras deste período ${nSemCusto === 1 ? "não tem" : "não têm"} custo de compra${nomes.length ? ` (${nomes.join(", ")}${nSemCusto > nomes.length ? "…" : ""})` : ""}.` }),
        h("a", { class: "btn sec pequeno", href: "#/catalogo", text: "Preencher o custo no Catálogo" })));
    }
    if (semLista) {
      avisos.push(h("p", { class: "msg info", id: "negocio-sem-lista",
        text: `${plural(semLista, "obra concluída", "obras concluídas")} neste período sem lista de material (pedido sem simulação): o material ${semLista === 1 ? "dela" : "delas"} não entra na margem.` }));
    }
  }

  // 5. Por receber (total e os mais antigos)
  const porReceber = campo(r, "por_receber");
  if (porReceber) {
    const n = numero(campo(porReceber, "n")) ?? 0;
    kpis.push(kpi("Por receber", euros(campo(porReceber, "total") ?? 0), { href: "#/pagamentos", destaque: n ? "atencao" : "",
      ajuda: campo(porReceber, "online") === false ? "Pagamentos online desligados: não há valores pedidos na conta"
        : n ? `${plural(n, "pagamento pedido", "pagamentos pedidos")} e por pagar (sinal ou restante), com IVA` : "Nenhum pagamento pedido por pagar" }));
    const antigos = lista(porReceber, "lista");
    if (antigos.length) {
      blocos.push(h("section", { class: "cartao", id: "negocio-por-receber" }, h("h2", { text: "Por receber: os mais antigos" }),
        h("ul", { class: "lista-curta" }, ...antigos.map((o) => h("li", {}, h("a", { class: "lista-curta-item", href: `#/orcamentos/${encodeURIComponent(campo(o, "id"))}` },
          h("span", { class: "num quando", text: dia(campo(o, "desde")) }), h("span", { class: "lc-quem", text: String(campo(o, "nome") ?? "—") }),
          h("span", { class: "ajuda", text: `${campo(o, "fase") === "sinal" ? "Sinal" : "Restante"} · ${euros(campo(o, "valor"))}` })))))));
    }
  }

  // 6. Stock abaixo do mínimo, 7. obras por agendar e 8. avaliação média (agora; não dependem do período)
  const stock = numero(campo(r, "stock_abaixo_minimo"));
  if (stock !== null) kpis.push(kpi("Stock abaixo do mínimo", num(stock), { href: "#/stock", destaque: stock > 0 ? "atencao" : "", ajuda: "Artigos com menos do que o mínimo, agora" }));
  const porAgendar = numero(campo(r, "obras_por_agendar"));
  if (porAgendar !== null) kpis.push(kpi("Obras por agendar", num(porAgendar), { href: "#/obras", destaque: porAgendar > 0 ? "atencao" : "", ajuda: "Com o sinal pago e ainda sem data" }));
  const avaliacao = campo(r, "avaliacao");
  if (avaliacao) {
    const media = numero(campo(avaliacao, "media"));
    const n = numero(campo(avaliacao, "n")) ?? 0;
    const cheias = media === null ? 0 : Math.round(media);
    kpis.push(kpi("Avaliação dos clientes", media === null ? "—" : `${num(media)} em 5`, {
      extra: media === null ? null : h("span", { class: "estrelas", "aria-hidden": "true", text: `${"★".repeat(cheias)}${"☆".repeat(5 - cheias)}` }),
      ajuda: n ? `Média de ${plural(n, "avaliação", "avaliações")}, desde sempre` : "Ainda sem avaliações" }));
  }

  // 9. Origem dos contactos
  const origens = campo(r, "origens");
  if (Array.isArray(origens)) {
    const total = origens.reduce((s, o) => s + (numero(campo(o, "pedidos")) ?? 0), 0);
    blocos.push(h("section", { class: "cartao bloco-dist", id: "negocio-origens" },
      h("h2", { text: "Origem dos contactos" }),
      h("p", { class: "ajuda", text: "Pedidos recebidos no período e quantos já foram aceites" }),
      origens.length ? h("ul", { class: "barras origens" }, ...origens.map((o) => {
        const n = numero(campo(o, "pedidos")) ?? 0;
        const origem = campo(o, "origem");
        const barra = h("span", { class: "barra", "aria-hidden": "true" });
        barra.style.setProperty("--p", total ? `${Math.round((n / total) * 100)}%` : "0%");
        return h("li", { dataset: { chave: origem ?? "sem_origem" } },
          h("span", { class: "barra-rotulo", text: origem == null ? "Sem origem" : nomeDe(ORIGENS_CONTACTO, origem) }),
          barra,
          h("span", { class: "barra-valor num", text: `${num(n)} · ${plural(campo(o, "aceites") ?? 0, "aceite", "aceites")}` }));
      })) : h("p", { class: "vazio", text: "Sem pedidos neste período." })));
  }

  const out = [];
  if (kpis.length) out.push(h("div", { class: "kpis" }, ...kpis));
  out.push(...avisos);
  if (blocos.length) out.push(h("div", { class: "blocos" }, ...blocos));
  return out;
}
