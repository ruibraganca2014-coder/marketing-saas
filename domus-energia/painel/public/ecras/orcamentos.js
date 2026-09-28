// Pedidos de orçamento: quadro por estado (computador) ou lista (telemóvel); ficha com notas, data da
// visita, valor da proposta, motivo de perda, histórico e "Converter em cliente e obra" (orçamento aceite).
// Com simulação: "Relatório técnico" (#/orcamentos/<id>/relatorio), vista para imprimir / guardar PDF.
// Fotos do cliente (simulador): galeria na ficha (CEO/comercial podem apagar) e no relatório.
import { pedir, campo, lista, numero, idPedido, palavraPasse } from "../api.js";
import { h, ESTADOS_ORC, KITS, euros, data, selo, campoForm, escolha, dados, janela, mensagem, avisar, carregando, erroEcra, txt, isoDia, mostrarPalavraPasse } from "../ui.js";
import { RE_CODIGO, sugerirCodigo } from "./clientes.js";
import { vistaSimulacao, aparelhosDaSimulacao, relatorioTecnico, galeriaFotos, nomeTipoFoto } from "./simulacao.js";

const CHAVE_VISTA = "domus.painel.orcamentos.vista";
const ler = () => { try { return localStorage.getItem(CHAVE_VISTA); } catch { return null; } };
const gravar = (v) => { try { localStorage.setItem(CHAVE_VISTA, v); } catch {} };
/** "AAAA-MM-DDTHH:MM" para <input type=datetime-local>. */
const paraInput = (v) => {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${isoDia(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function orcamentos(el, ctx) {
  const ctrl = new AbortController();
  let todos = [];
  let ficha = null;
  let vista = ler() ?? (matchMedia("(min-width: 960px)").matches ? "quadro" : "lista");

  const bQuadro = h("button", { class: "segmento", type: "button", text: "Quadro", "aria-pressed": "false", onclick: () => mudarVista("quadro") });
  const bLista = h("button", { class: "segmento", type: "button", text: "Lista", "aria-pressed": "false", onclick: () => mudarVista("lista") });
  const fEstado = escolha("estado", { "": "Todos os estados", ...ESTADOS_ORC }, "", { "aria-label": "Filtrar por estado" });
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar nome ou localidade", "aria-label": "Procurar pedido", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "zona-orcamentos" }, carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Orçamentos" }), h("div", { class: "segmentos", role: "group", "aria-label": "Mostrar como" }, bQuadro, bLista)),
    h("div", { class: "filtros" }, fTexto, fEstado), contagem, zona);
  fEstado.addEventListener("change", desenhar);
  fTexto.addEventListener("input", desenhar);

  function mudarVista(v) { vista = v; gravar(v); desenhar(); }

  async function carregar() {
    try { todos = lista(await pedir("orcamentos", { sinal: ctrl.signal }), "orcamentos", "pedidos"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  function desenhar() {
    bQuadro.setAttribute("aria-pressed", String(vista === "quadro"));
    bLista.setAttribute("aria-pressed", String(vista === "lista"));
    fEstado.hidden = vista === "quadro";
    const t = fTexto.value.trim().toLowerCase();
    const vis = todos
      .filter((o) => !t || [campo(o, "nome"), campo(o, "localidade"), campo(o, "servico")].some((v) => String(v ?? "").toLowerCase().includes(t)))
      .filter((o) => vista === "quadro" || !fEstado.value || campo(o, "estado") === fEstado.value)
      .sort((a, b) => String(campo(b, "criado", "criado_em") ?? "").localeCompare(String(campo(a, "criado", "criado_em") ?? "")));
    const novos = todos.filter((o) => campo(o, "estado") === "novo").length;
    contagem.textContent = `${vis.length} ${vis.length === 1 ? "pedido" : "pedidos"}${novos ? ` · ${novos} ${novos === 1 ? "novo" : "novos"}` : ""}`;
    if (!todos.length) { zona.replaceChildren(h("p", { class: "vazio", text: "Ainda não há pedidos de orçamento." })); return; }
    if (vista === "quadro") {
      zona.replaceChildren(h("div", { class: "quadro", id: "quadro-orcamentos" }, ...Object.entries(ESTADOS_ORC).map(([k, nome]) => {
        const col = vis.filter((o) => (campo(o, "estado") ?? "novo") === k);
        return h("section", { class: `coluna coluna-${k}`, dataset: { estado: k }, "aria-label": `${nome}: ${col.length}` },
          h("h2", {}, nome, " ", h("span", { class: "contagem num", text: String(col.length) })),
          col.length ? h("ul", { class: "cartoes-orc" }, ...col.map(cartao)) : h("p", { class: "vazio", text: "Nenhum." }));
      })));
    } else {
      zona.replaceChildren(vis.length ? h("ul", { class: "linhas", id: "lista-orcamentos" }, ...vis.map((o) => cartao(o, true))) : h("p", { class: "vazio", text: "Nenhum pedido com estes filtros." }));
    }
  }

  function cartao(o, comEstado = false) {
    const id = String(campo(o, "id"));
    const estado = campo(o, "estado") ?? "novo";
    const valor = campo(o, "valor_proposta");
    return h("li", {}, h("a", { class: "linha cartao-orc", href: `#/orcamentos/${encodeURIComponent(id)}`, dataset: { id } },
      h("span", { class: "linha-principal" }, h("strong", { text: txt(o, "nome") }), h("span", { class: "ajuda", text: `${txt(o, "servico")} · ${txt(o, "localidade")}` })),
      h("span", { class: "linha-selos" },
        comEstado ? selo(ESTADOS_ORC[estado] ?? estado, `orc-${estado}`) : null,
        campo(o, "data_visita") && estado === "visita_marcada" ? selo(`Visita ${data(campo(o, "data_visita"))}`, "info") : null,
        valor != null && valor !== "" ? selo(euros(valor), "valor") : null,
        simulacaoDe(o) || campo(o, "tem_simulacao") === true ? selo("Com simulação", "info") : null,
        numero(campo(o, "n_fotos")) > 0 ? selo(`${campo(o, "n_fotos")} ${campo(o, "n_fotos") === 1 ? "foto" : "fotos"}`, "info") : null),
      h("span", { class: "linha-extra ajuda", text: `Recebido ${data(campo(o, "criado", "criado_em"))}` })));
  }

  // ---------- Ficha ----------
  function abrirFicha(id) {
    if (ficha?.id === id) return;
    ficha?.j.fechar();
    const j = janela("Pedido de orçamento", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash === `#/orcamentos/${encodeURIComponent(id)}`) ctx.navegar("orcamentos"); } });
    ficha = { id, j };
    const o = todos.find((x) => String(campo(x, "id")) === id);
    if (o) desenharFicha(j, o); else j.corpo.append(carregando());
    // A lista não traz a simulação nem o histórico: pede o pedido completo (GET orcamentos/:id).
    pedir(`orcamentos/${encodeURIComponent(id)}`).then((r) => {
      const completo = campo(r, "orcamento") ?? r;
      if (ficha?.j !== j || !completo || typeof completo !== "object") return;
      substituir(completo, false);
      desenharFicha(j, completo, true);
    }).catch(async (e) => {
      if (ficha?.j !== j) return;
      await esperarLista;
      const x = todos.find((y) => String(campo(y, "id")) === id);
      if (x && !o) desenharFicha(j, x);
      else if (!x) j.corpo.replaceChildren(e.estado === 404 || e.estado === 0 ? h("p", { class: "vazio", text: "Pedido não encontrado." }) : erroEcra(e));
    });
  }

  function desenharFicha(j, o, manterFoco = false) {
    const id = String(campo(o, "id"));
    // Não apaga o que a pessoa já está a escrever quando chega o pedido completo.
    const emEdicao = manterFoco && j.corpo.querySelector("#form-orcamento, #form-converter")?.matches(":focus-within");
    if (emEdicao) {
      const sim = simulacaoDe(o), antes = j.corpo.querySelector("#simulacao-cliente");
      if (sim && (!antes || antes.dataset.carregando !== undefined)) { const v = vistaSimulacao(sim, catalogoDe(o)); if (antes) antes.replaceWith(v); else j.corpo.querySelector("#form-orcamento")?.before(v); }
      return;
    }
    const estado = campo(o, "estado") ?? "novo";
    j.titulo.textContent = txt(o, "nome");
    const tel = campo(o, "telefone"), email = campo(o, "email");
    const contactos = h("div", { class: "form-botoes" },
      tel ? h("a", { class: "btn sec pequeno", href: `tel:${String(tel).replace(/[^\d+]/g, "")}`, text: `Ligar ${tel}` }) : null,
      email ? h("a", { class: "btn sec pequeno", href: `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`, text: "Enviar email" }) : null,
      simulacaoDe(o) || campo(o, "tem_simulacao") === true
        ? h("a", { class: "btn sec pequeno", id: "abrir-relatorio", href: `#/orcamentos/${encodeURIComponent(id)}/relatorio`, text: "Relatório técnico" }) : null);
    const partes = [
      h("div", { class: "linha-selos" }, selo(ESTADOS_ORC[estado] ?? estado, `orc-${estado}`)),
      dados([["Serviço", txt(o, "servico")], ["Localidade", txt(o, "localidade")], ["Telefone", txt(o, "telefone")], ["Email", txt(o, "email")], ["Recebido", data(campo(o, "criado", "criado_em"))]]),
      contactos,
    ];
    if (campo(o, "mensagem")) partes.push(h("h3", { text: "Mensagem do cliente" }), h("p", { class: "mensagem-cliente", text: String(campo(o, "mensagem")) }));
    const sim = simulacaoDe(o);
    if (sim) partes.push(vistaSimulacao(sim, catalogoDe(o)));
    else if (campo(o, "tem_simulacao") === true) partes.push(h("section", { class: "simulacao", id: "simulacao-cliente", dataset: { carregando: "" } }, h("h3", { text: "Simulação do cliente" }), carregando()));
    const fotos = lista(campo(o, "fotos") ?? [], "fotos");
    if (fotos.length) {
      partes.push(h("section", { class: "fotos-pedido", id: "fotos-pedido" },
        h("h3", { text: `Fotos do cliente (${fotos.length})` }),
        h("p", { class: "ajuda", text: "Tiradas pelo cliente no simulador. Toque numa foto para a ver inteira." }),
        galeriaFotos(id, fotos, { aoApagar: (f, b) => apagarFoto(j, id, f, b) })));
    }
    if (campo(o, "codigo_cliente") && !campo(o, "cliente")) partes.push(h("p", { class: "ajuda", text: `Pedido feito por um cliente que já existe: ${campo(o, "codigo_cliente")}.` }));

    // Formulário de acompanhamento
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const sEstado = escolha("estado", ESTADOS_ORC, estado);
    const motivo = campoForm("Motivo da perda", h("input", { name: "motivo_perda", maxlength: "300", value: campo(o, "motivo_perda") ?? "" }));
    const f = h("form", { class: "form-grelha", id: "form-orcamento", novalidate: true },
      h("h3", { text: "Acompanhamento" }),
      h("div", { class: "duas" },
        campoForm("Estado", sEstado),
        campoForm("Data da visita", h("input", { name: "data_visita", type: "datetime-local", value: paraInput(campo(o, "data_visita")) }))),
      campoForm("Valor da proposta (€, sem IVA)", h("input", { name: "valor_proposta", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: campo(o, "valor_proposta") ?? "" })),
      motivo,
      campoForm("Notas", h("textarea", { name: "notas", maxlength: "4000", rows: "4" }, campo(o, "notas") ?? "")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar" })),
      msg);
    const mostrarMotivo = () => { motivo.hidden = sEstado.value !== "perdido"; };
    sEstado.addEventListener("change", mostrarMotivo); mostrarMotivo();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const v = el.valor_proposta.value.trim();
      const valor = v === "" ? null : numero(v);
      if (v !== "" && (valor === null || valor < 0)) { mensagem(msg, "O valor da proposta tem de ser um número igual ou maior que 0."); el.valor_proposta.focus(); return; }
      if (el.estado.value === "visita_marcada" && !el.data_visita.value) { mensagem(msg, "Indique a data da visita."); el.data_visita.focus(); return; }
      if (el.estado.value === "perdido" && !el.motivo_perda.value.trim()) { mensagem(msg, "Indique o motivo da perda."); el.motivo_perda.focus(); return; }
      const corpo = {
        estado: el.estado.value,
        notas: el.notas.value.trim(),
        data_visita: el.data_visita.value || null,
        valor_proposta: valor,
        motivo_perda: el.estado.value === "perdido" ? el.motivo_perda.value.trim() : null,
      };
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}`, { corpo });
        const novo = campo(r, "orcamento") ?? (r && typeof r === "object" && campo(r, "id") !== undefined ? r : { ...o, ...corpo });
        substituir(novo);
        avisar("Pedido de orçamento guardado.");
        desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    partes.push(f);

    // Converter (só aceite, e ainda não convertido)
    const obra = campo(o, "obra_id", "obra");
    const convertido = campo(o, "cliente", "cliente_codigo") ?? (obra ? campo(o, "codigo_cliente") : null);
    if (convertido) {
      partes.push(h("div", { class: "msg ok bloco" }, "Convertido em cliente ",
        h("a", { href: `#/clientes/${encodeURIComponent(typeof convertido === "string" ? convertido : "")}`, text: typeof convertido === "string" ? convertido : "" }),
        obra ? [" e ", h("a", { href: `#/obras/${encodeURIComponent(typeof obra === "object" ? campo(obra, "id") : obra)}`, text: "obra" })] : null, "."));
    } else if (estado === "aceite") partes.push(formConverter(j, o));

    const hist = lista(campo(o, "historico") ?? [], "historico");
    if (hist.length) partes.push(h("h3", { text: "Histórico" }), h("ol", { class: "historico-p" }, ...hist.map((x) =>
      h("li", {}, h("span", { class: "num ajuda", text: data(campo(x, "quando", "em", "data")) }), " ", h("span", { text: textoHistorico(x, sim) }), campo(x, "por", "utilizador", "email") ? h("span", { class: "ajuda", text: ` · ${txt(x, "por", "utilizador", "email")}` }) : null))));
    j.corpo.replaceChildren(...partes);
  }

  async function apagarFoto(j, id, f, b) {
    try {
      const r = await pedir(`orcamentos/${encodeURIComponent(id)}/fotos/${encodeURIComponent(f.id)}/apagar`, { corpo: {} });
      const novo = campo(r, "orcamento") ?? r;
      substituir(novo);
      avisar("Foto apagada.");
      if (ficha?.j === j) desenharFicha(j, novo);
    } catch (erro) {
      b.disabled = false; b.textContent = "Apagar";
      avisar(erro.message, "erro");
    }
  }

  function formConverter(j, o) {
    const id = String(campo(o, "id"));
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 7);
    // Com visita marcada, a obra começa por omissão no dia da visita (pode ser mudada).
    const diaVisita = paraInput(campo(o, "data_visita")).slice(0, 10);
    const sim = simulacaoDe(o);
    const sugeridos = sim ? aparelhosDaSimulacao(sim, catalogoDe(o)) : [];
    const listaAparelhos = sugeridos.length ? checklistAparelhos(sugeridos) : null;
    // Horas da simulação do cliente (se houver) em vez das do kit; podem ser alteradas.
    const horasSim = sim ? numero(campo(sim.mao_obra ?? {}, "horas")) : null;
    const campoHoras = horasSim !== null && horasSim > 0
      ? campoForm("Horas estimadas", h("input", { name: "horas_estimadas", type: "number", min: "0", max: "500", step: "0.05", inputmode: "decimal", required: true, value: String(horasSim) }), "Da simulação do cliente (em vez das horas do kit)")
      : null;
    const f = h("form", { class: "form-grelha converter", id: "form-converter", novalidate: true },
      h("h3", { text: "Converter em cliente e obra" }),
      h("p", { class: "ajuda", text: "Pede ao servidor a conta do cliente e agenda a obra de instalação." }),
      h("div", { class: "duas" },
        campoForm("Código do cliente", h("input", { name: "codigo", required: true, maxlength: "32", autocapitalize: "none", spellcheck: "false", value: sugerirCodigo(campo(o, "nome") ?? "") })),
        campoForm("Kit", escolha("kit", Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, `${v.nome} (${v.horas} h)`])), "conforto"))),
      campoForm("Data da obra", h("input", { name: "data", type: "date", required: true, value: diaVisita || isoDia(amanha) }), diaVisita ? "Dia da visita (pode mudar)." : null),
      campoHoras,
      listaAparelhos,
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Converter em cliente e obra" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const corpo = { codigo: el.codigo.value.trim(), kit: el.kit.value, data: el.data.value };
      if (!RE_CODIGO.test(corpo.codigo)) { mensagem(msg, "Código inválido: 1 a 32 letras minúsculas, números e '-' (sem '-' no início ou no fim)."); el.codigo.focus(); return; }
      if (!corpo.data) { mensagem(msg, "Escolha a data da obra."); el.data.focus(); return; }
      if (campoHoras) {
        const horas = numero(el.horas_estimadas.value);
        if (horas === null || horas < 0 || horas > 500) { mensagem(msg, "As horas estimadas têm de ser um número entre 0 e 500."); el.horas_estimadas.focus(); return; }
        corpo.horas_estimadas = horas;
      }
      if (listaAparelhos) {
        const r = lerAparelhos(listaAparelhos);
        if (r.erro) { mensagem(msg, r.erro); r.campo?.focus(); return; }
        if (r.aparelhos.length) corpo.aparelhos = r.aparelhos;
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(`orcamentos/${encodeURIComponent(id)}/converter`, { corpo });
        const senha = palavraPasse(r);
        if (senha) mostrarPalavraPasse(`Cliente ${corpo.codigo}: feito`, senha, { utilizador: corpo.codigo });
        else if (idPedido(r)) ctx.acompanharPedido(idPedido(r), { descricao: `Cliente ${corpo.codigo}`, utilizador: corpo.codigo });
        // Aparelhos pedidos na conversão: cada um tem a sua palavra-passe (mostrada uma vez, quando o servidor os criar).
        lista(campo(r, "aparelhos") ?? [], "aparelhos").forEach((p, i) => {
          const a = corpo.aparelhos?.[i];
          const idP = idPedido({ pedido: p });
          if (idP && a) ctx.acompanharPedido(idP, { descricao: `Aparelho ${a.id} de ${corpo.codigo}`, utilizador: `${corpo.codigo}-${a.id}` });
        });
        const obraR = campo(r, "obra", "obra_id");
        const novo = { ...o, ...(campo(r, "orcamento") ?? {}), estado: "aceite", cliente: campo(r, "cliente") ?? corpo.codigo, obra_id: (obraR && typeof obraR === "object" ? campo(obraR, "id") : obraR) ?? campo(o, "obra_id") };
        substituir(novo);
        const nAp = corpo.aparelhos?.length ?? 0;
        avisar((campo(r, "cliente_existia") === true ? `Obra agendada para o cliente ${corpo.codigo} (já existia).` : `Pedido de cliente ${corpo.codigo} enviado e obra agendada.`)
          + (nAp ? ` ${nAp} ${nAp === 1 ? "aparelho pedido" : "aparelhos pedidos"} ao servidor.` : ""));
        desenharFicha(j, novo);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    return f;
  }

  function substituir(novo, redesenhar = true) {
    const i = todos.findIndex((x) => String(campo(x, "id")) === String(campo(novo, "id")));
    if (i >= 0) todos[i] = { ...todos[i], ...novo }; else todos.push(novo);
    if (redesenhar) desenhar();
  }

  // ---------- Relatório técnico (para o eletricista; imprimir / guardar PDF) ----------
  let relatorio = null;
  const tituloAntes = document.title;
  function abrirRelatorio(id) {
    if (relatorio?.id === id) return;
    fecharRelatorio();
    const volta = h("a", { class: "btn sec pequeno", href: `#/orcamentos/${encodeURIComponent(id)}`, text: "Voltar ao pedido" });
    const imprimir = h("button", { class: "btn pequeno", type: "button", id: "imprimir-relatorio", text: "Imprimir / guardar PDF", disabled: true, onclick: () => window.print() });
    const corpo = h("div", {}, carregando());
    const caixa = h("div", { class: "relatorio-zona" }, h("div", { class: "ecra-topo nao-imprimir" }, h("h1", { text: "Relatório técnico" }), h("div", { class: "form-botoes" }, volta, imprimir)), corpo);
    relatorio = { id, caixa };
    el.classList.add("com-relatorio");
    el.append(caixa);
    pedir(`orcamentos/${encodeURIComponent(id)}`, { sinal: ctrl.signal }).then((r) => {
      if (relatorio?.caixa !== caixa) return;
      const o = campo(r, "orcamento") ?? r;
      const sim = simulacaoDe(o);
      if (!sim) { corpo.replaceChildren(h("p", { class: "vazio", text: "Este pedido não tem simulação: não há relatório técnico." })); return; }
      corpo.replaceChildren(relatorioTecnico({
        id: campo(o, "id"), nome: campo(o, "nome"), telefone: campo(o, "telefone"), email: campo(o, "email"),
        localidade: campo(o, "localidade"), criado: campo(o, "criado", "criado_em"), data_visita: campo(o, "data_visita"),
      }, sim, catalogoDe(o), { fotos: lista(campo(o, "fotos") ?? [], "fotos"), leitura: campo(o, "leitura_quadro") }));
      // O título dá o nome ao PDF guardado pelo browser.
      document.title = `Relatório técnico — ${txt(o, "nome")} (pedido ${campo(o, "id")})`;
      imprimir.disabled = false;
    }).catch((e) => {
      if (e.name === "AbortError" || relatorio?.caixa !== caixa) return;
      corpo.replaceChildren(e.estado === 404 ? h("p", { class: "vazio", text: "Pedido não encontrado." }) : erroEcra(e, () => { fecharRelatorio(); abrirRelatorio(id); }));
    });
    caixa.querySelector("h1").setAttribute("tabindex", "-1");
    caixa.querySelector("h1").focus();
  }
  function fecharRelatorio() {
    if (!relatorio) return;
    relatorio.caixa.remove();
    relatorio = null;
    el.classList.remove("com-relatorio");
    document.title = tituloAntes;
  }

  const esperarLista = carregar();
  const api = {
    rota(resto) {
      if (resto[0] && resto[1] === "relatorio") { ficha?.j.fechar(); ficha = null; abrirRelatorio(resto[0]); return; }
      fecharRelatorio();
      if (resto[0]) abrirFicha(resto[0]); else { ficha?.j.fechar(); ficha = null; }
    },
    desmontar: () => { ctrl.abort(); fecharRelatorio(); },
  };
  api.rota(ctx.resto);
  return api;
}

const ACOES = {
  orcamento_recebido: "Pedido recebido", orcamento_criado: "Pedido registado", orcamento_atualizado: "Atualizado",
  orcamento_convertido: "Convertido em cliente e obra", obra_criada: "Obra criada", foto_apagada: "Foto apagada",
};
/** Nome legível de uma foto pela chave ("quadro" ou "divisao:tipo"), com os dados da simulação se os houver. */
function nomeFotoChave(chave, sim) {
  if (chave === "quadro") return "Quadro elétrico";
  const m = (Array.isArray(sim?.fotos) ? sim.fotos : []).find((f) => f && f.chave === chave) ?? {};
  const [divisao, tipo] = chave.split(":");
  const s = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return [nomeTipoFoto(s(m.tipo) ?? tipo), s(m.divisao_nome) ?? divisao, s(m.legenda)].filter(Boolean).join(" · ");
}
/** Uma linha do histórico: {texto} ou {acao, detalhes} (registo de auditoria). `sim`: simulação do pedido (nomes das fotos). */
function textoHistorico(x, sim) {
  const t = campo(x, "texto", "descricao");
  if (t) return String(t);
  const acao = String(campo(x, "acao") ?? "");
  const d = campo(x, "detalhes");
  const partes = [ACOES[acao] ?? (acao.replace(/_/g, " ") || "—")];
  if (d && typeof d === "object") {
    if (acao === "foto_apagada" && typeof d.chave === "string" && d.chave) partes[0] = `Foto apagada: ${nomeFotoChave(d.chave, sim)}`;
    if (d.estado) partes.push(`estado: ${ESTADOS_ORC[d.estado] ?? d.estado}`);
    if (d.data_visita) partes.push(`visita: ${data(d.data_visita)}`);
    if (d.valor_proposta != null) partes.push(`proposta: ${euros(d.valor_proposta)}`);
    if (d.cliente) partes.push(`cliente: ${d.cliente}`);
  }
  return partes.join(" · ");
}

/** Simulação do cliente (objeto; o servidor pode guardá-la como texto JSON). */
export function simulacaoDe(o) {
  let s = campo(o, "simulacao");
  if (typeof s === "string") { try { s = JSON.parse(s); } catch { return null; } }
  return s && typeof s === "object" ? s : null;
}

/** Artigos do catálogo referidos na simulação ({SKU: {nome, categoria, ativo, …}}; GET orcamentos/:id → catalogo). */
export function catalogoDe(o) {
  const c = campo(o, "catalogo", "artigos");
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
}

// ---------- Aparelhos sugeridos (converter) ----------
const TIPOS_APARELHO = { openbeken: "OpenBeken", shelly: "Shelly" };
/** Lista editável dos aparelhos sugeridos: cada linha pode ser desmarcada e alterada antes de converter. */
function checklistAparelhos(sugeridos) {
  const linhas = sugeridos.map((a, i) => {
    const incluir = h("input", { type: "checkbox", name: "incluir", checked: true });
    const campos = h("div", { class: "aparelho-campos" },
      campoForm("Id", h("input", { name: "id", value: a.id, maxlength: "32", autocapitalize: "none", spellcheck: "false" })),
      campoForm("Nome", h("input", { name: "nome", value: a.nome, maxlength: "60" })),
      campoForm("Tipo", escolha("tipo", TIPOS_APARELHO, a.tipo)),
      campoForm("Divisão", h("input", { name: "divisao", value: a.divisao, maxlength: "40" })),
      h("div", { class: "aparelho-canais" }, campoForm("Canais", h("input", { name: "canais", value: a.canais, maxlength: "1000", autocapitalize: "none", spellcheck: "false" }))),
      h("div", { class: "caixas" },
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "medidor", checked: a.medidor }), "Medidor"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "geral", checked: !!a.geral }), "Medidor geral da casa"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "bateria", checked: a.bateria }), "A pilhas")));
    const li = h("li", { class: "aparelho-sug", dataset: { i: String(i) } },
      h("label", { class: "caixa aparelho-incluir" }, incluir, h("span", {}, h("strong", { class: "aparelho-nome", text: a.nome }), h("span", { class: "ajuda bloco-ajuda", text: a.origem || "" }))),
      campos);
    const nomeTxt = li.querySelector(".aparelho-nome");
    campos.querySelector("input[name=nome]").addEventListener("input", (e) => { nomeTxt.textContent = e.target.value || "(sem nome)"; });
    incluir.addEventListener("change", () => { campos.hidden = !incluir.checked; li.classList.toggle("excluido", !incluir.checked); contar(); });
    return li;
  });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const caixa = h("fieldset", { class: "grupo aparelhos-sugeridos", id: "aparelhos-sugeridos" },
    h("legend", { text: "Aparelhos a pedir ao servidor" }),
    h("p", { class: "ajuda", text: "Sugeridos a partir da simulação do cliente (domus.sh aparelho). Desmarque os que não vai instalar e corrija o que for preciso: os pedidos são feitos por esta ordem, depois do cliente." }),
    contagem, h("ol", { class: "lista-aparelhos" }, ...linhas));
  function contar() {
    const n = linhas.filter((l) => l.querySelector("input[name=incluir]").checked).length;
    contagem.textContent = `${n} de ${linhas.length} ${linhas.length === 1 ? "aparelho" : "aparelhos"} a pedir.`;
  }
  contar();
  return caixa;
}
const RE_NOME_AP = /^[^"\\-][^"\\]*$/;
const RE_CANAIS = /^[1-9]\d?:[a-z]+(:[^,:"\\]*)*(,[1-9]\d?:[a-z]+(:[^,:"\\]*)*)*$/;
const RE_DIVISAO = /^[^"\\:,-][^"\\:,]*$/;
/** Aparelhos marcados → corpo de "aparelhos" (as mesmas regras do servidor), ou {erro, campo}. */
function lerAparelhos(caixa) {
  const out = [];
  const ids = new Set();
  for (const li of caixa.querySelectorAll(".aparelho-sug")) {
    if (!li.querySelector("input[name=incluir]").checked) continue;
    const c = (n) => li.querySelector(`[name=${n}]`);
    const id = c("id").value.trim(), nome = c("nome").value.trim(), canais = c("canais").value.trim(), divisao = c("divisao").value.trim();
    const quem = nome || id || "aparelho";
    if (!RE_CODIGO.test(id)) return { erro: `${quem}: id inválido (1 a 32 letras minúsculas, números e '-').`, campo: c("id") };
    if (ids.has(id)) return { erro: `O id "${id}" está repetido.`, campo: c("id") };
    ids.add(id);
    if (!nome || nome.length > 60 || !RE_NOME_AP.test(nome)) return { erro: `${quem}: nome em falta ou inválido (sem aspas nem "\\", sem "-" no início).`, campo: c("nome") };
    if (canais && !RE_CANAIS.test(canais)) return { erro: `${quem}: canais no formato "n:funcao[:nome][:opção]", separados por vírgulas.`, campo: c("canais") };
    if (divisao && (!RE_DIVISAO.test(divisao) || new TextEncoder().encode(divisao).length > 40)) return { erro: `${quem}: divisão sem aspas, ":" ou "," (máx. 40 bytes).`, campo: c("divisao") };
    const a = { id, tipo: c("tipo").value, nome };
    if (canais) a.canais = canais;
    if (divisao) a.divisao = divisao;
    a.medidor = c("medidor").checked;
    if (c("geral").checked) {
      // O servidor só aceita "geral" com medidor e sem pilhas (domus.sh --medidor --geral).
      if (!a.medidor) return { erro: `${quem}: "Medidor geral da casa" só com "Medidor".`, campo: c("geral") };
      a.geral = true;
    }
    a.bateria = c("bateria").checked;
    out.push(a);
  }
  return { aparelhos: out };
}
