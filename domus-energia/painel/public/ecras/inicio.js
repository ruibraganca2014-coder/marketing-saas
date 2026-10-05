// Início: resumo por papel (GET resumo). O servidor já só manda o que o papel pode ver;
// aqui mostra-se o que vier, com nomes conhecidos para os campos do §3.
import { pedir, campo, numero, lista } from "../api.js";
import { h, euros, num, data, PLANOS, ESTADOS_CLIENTE, ESTADOS_ORC, KITS, nomeDe, carregando, erroEcra, txt } from "../ui.js";
import { blocoNegocio } from "./negocio.js";

const saudacao = () => { const hr = new Date().getHours(); return hr < 13 ? "Bom dia" : hr < 20 ? "Boa tarde" : "Boa noite"; };

export default function inicio(el, ctx) {
  const titulo = h("h1", { text: ctx.numeros ? "Números" : `${saudacao()}, ${ctx.eu.nome.split(" ")[0] || ""}`.replace(/, $/, "") });
  const zona = h("div", { class: "inicio" }, carregando());
  el.append(h("div", { class: "ecra-topo" }, titulo), zona);
  const ctrl = new AbortController();
  // Dashboard do negócio (docs/DASHBOARD.md): só CEO e comercial; pede os seus dados à parte (GET resumo/negocio) e fica
  // entre os números de sempre e os blocos. Criado uma vez: mudar de período não volta a carregar o resto do Início.
  // O CEO tem o Início simples (decisão do dono, 2026-10-05): o negócio está no ecrã "Números".
  const simples = ctx.pode("ceo") && !ctx.numeros;
  const negocio = ctx.pode("ceo", "comercial") && !simples ? blocoNegocio(ctrl.signal) : null;

  async function carregar() {
    zona.replaceChildren(carregando());
    let r;
    try { r = await pedir("resumo", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    // As minhas tarefas atrasadas ou para hoje (o mesmo que o selo do menu conta); sem elas o Início aparece na mesma.
    let tarefas = [];
    try { tarefas = lista(await pedir("tarefas?vista=minhas", { sinal: ctrl.signal }), "tarefas").filter((t) => t.estado !== "feito" && (t.atrasada || t.hoje)); }
    catch (e) { if (e.name === "AbortError") return; }
    if (simples) {
      // Por receber: os mais antigos (o mesmo cálculo do ecrã "Números"); sem ele o Início aparece na mesma.
      let porReceber = null;
      try { porReceber = campo(await pedir("resumo/negocio?periodo=mes", { sinal: ctrl.signal }), "por_receber") ?? null; }
      catch (e) { if (e.name === "AbortError") return; }
      zona.replaceChildren(...montarSimples(r ?? {}, tarefas, porReceber));
      return;
    }
    zona.replaceChildren(...montar(r ?? {}, tarefas));
  }

  /**
   * Início do CEO num só ecrã: "Para tratar" (uma linha por coisa à espera dele, só as que têm alguma coisa), "Esta
   * semana" (visitas e obras) e "Por receber". As estatísticas ficam em "Números" (#/numeros).
   */
  function montarSimples(r, tarefas, porReceber) {
    const t = campo(r, "tratar") ?? {};
    const linha = (n, um, varios, href, perigo = false) => (numero(n) > 0
      ? h("li", {}, h("a", { class: `lista-curta-item tratar-linha${perigo ? " perigo" : ""}`, href }, h("span", { class: "num quando", text: num(n) }), h("span", { class: "lc-quem", text: numero(n) === 1 ? um : varios })))
      : null);
    const linhas = [
      linha(t.alertas_criticos, "alerta crítico numa casa", "alertas críticos nas casas", "#/alertas", true),
      linha(t.pedidos_novos, "pedido novo por tratar", "pedidos novos por tratar", "#/orcamentos"),
      linha(t.propostas_eletricista, "proposta de eletricista por rever", "propostas de eletricistas por rever", "#/orcamentos"),
      linha(t.propostas_aceites, "proposta aceite, falta marcar a obra", "propostas aceites, falta marcar a obra", "#/orcamentos"),
      linha(t.mensagens, "mensagem de cliente por responder", "mensagens de clientes por responder", "#/orcamentos"),
      linha(t.candidaturas, "candidatura de eletricista por aprovar", "candidaturas de eletricistas por aprovar", "#/eletricistas"),
      linha(t.trabalhos_por_aprovar, "trabalho concluído por aprovar", "trabalhos concluídos por aprovar", "#/eletricistas"),
      linha(t.pagamentos_eletricistas, "pagamento a eletricista por fazer", "pagamentos a eletricistas por fazer", "#/eletricistas"),
      linha(tarefas.length, "tarefa para hoje ou atrasada", "tarefas para hoje ou atrasadas", "#/tarefas"),
    ].filter(Boolean);
    const tratar = h("section", { class: "cartao", id: "inicio-tratar" }, h("h2", { text: "Para tratar" }),
      linhas.length ? h("ul", { class: "lista-curta" }, ...linhas) : h("p", { class: "vazio", text: "Nada à sua espera." }));

    const semana = [
      ...lista(r, "visitas_semana").map((o) => ({ quando: campo(o, "data_visita"), texto: `Visita: ${txt(o, "nome")}`, extra: txt(o, "localidade"), href: `#/orcamentos/${encodeURIComponent(campo(o, "id"))}` })),
      ...lista(r, "obras_semana").map((o) => ({ quando: `${campo(o, "data") ?? ""}${campo(o, "hora") ? `T${campo(o, "hora")}` : ""}`, texto: `Obra: ${txt(o, "cliente_nome", "nome", "cliente")}`, extra: "", href: `#/obras/${encodeURIComponent(campo(o, "id"))}` })),
    ].sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
    const estaSemana = h("section", { class: "cartao", id: "inicio-semana" }, h("h2", { text: "Esta semana" }),
      semana.length ? h("ul", { class: "lista-curta" }, ...semana.slice(0, 8).map((x) => h("li", {}, h("a", { class: "lista-curta-item", href: x.href },
        h("span", { class: "num quando", text: data(x.quando) }), h("span", { class: "lc-quem", text: x.texto }), h("span", { class: "ajuda", text: x.extra })))))
        : h("p", { class: "vazio", text: "Sem visitas nem obras marcadas." }),
      semana.length > 8 ? h("p", { class: "ajuda" }, h("a", { href: "#/obras", text: `Ver as ${num(semana.length)} marcações` })) : null);

    const antigos = porReceber ? lista(porReceber, "lista") : [];
    const receber = antigos.length ? h("section", { class: "cartao", id: "inicio-receber" },
      h("h2", {}, h("a", { href: "#/pagamentos", text: `Por receber: ${euros(campo(porReceber, "total") ?? 0)}` })),
      h("ul", { class: "lista-curta" }, ...antigos.slice(0, 5).map((o) => h("li", {}, h("a", { class: "lista-curta-item", href: `#/orcamentos/${encodeURIComponent(campo(o, "id"))}` },
        h("span", { class: "num quando", text: data(campo(o, "desde"), { hora: false }) }), h("span", { class: "lc-quem", text: String(campo(o, "nome") ?? "—") }),
        h("span", { class: "ajuda", text: `${campo(o, "fase") === "sinal" ? "Sinal" : "Restante"} · ${euros(campo(o, "valor"))}` })))))) : null;

    return [h("div", { class: "blocos inicio-simples" }, ...[tratar, estaSemana, receber].filter(Boolean)),
      h("p", { class: "inicio-numeros" }, h("a", { class: "btn sec pequeno", href: "#/numeros", text: "Ver números" }))];
  }

  function montar(r, tarefas) {
    const kpis = [];
    const blocos = [];
    if (tarefas.length) {
      blocos.push(h("section", { class: "cartao", id: "tarefas-para-hoje" }, h("h2", {}, h("a", { href: "#/tarefas", text: `Para hoje (${num(tarefas.length)})` })),
        h("ul", { class: "lista-curta" }, ...tarefas.slice(0, 8).map((t) => h("li", {}, h("a", { class: "lista-curta-item", href: `#/tarefas/${encodeURIComponent(t.id)}` },
          h("span", { class: "num quando", text: t.atrasada ? `Atrasada: ${data(t.prazo, { hora: false })}` : t.prazo_hora || "Hoje" }), h("span", { class: "lc-quem", text: t.titulo }))))),
        tarefas.length > 8 ? h("p", { class: "ajuda" }, h("a", { href: "#/tarefas", text: `Ver as ${num(tarefas.length)} tarefas` })) : null));
    }
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
      kpi("Planos: recebido este mês", euros(obj ? campo(recebido, "com_iva", "total") : recebido), {
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
    if (pendentes !== undefined && numero(pendentes) > 0) kpi("Pedidos ao servidor por aplicar", num(pendentes), { ajuda: "De toda a equipa: clientes, aparelhos ou planos à espera do servidor (a faixa no topo mostra só os seus)" });

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
    if (negocio) out.push(negocio);
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

