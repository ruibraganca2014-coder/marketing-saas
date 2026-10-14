// Catálogo (só CEO; docs/SIMULADOR-ORCAMENTO.md §3): artigos do simulador de orçamento com preço de compra,
// preço de venda (c/ IVA), margem, horas de instalação e especificações; configuração do simulador
// (tarifa por hora, margem do intervalo, deslocação por distância). O público só vê GET /api/catalogo (sem custos).
import { pedir, campo, lista, numero } from "../api.js";
import { h, euros, num, selo, campoForm, escolha, janela, mensagem, avisar, carregando, erroEcra, data } from "../ui.js";
// Os 308 concelhos (cópia de web/simulador/concelhos.js): a base da deslocação escolhe-se desta lista.
import { CONCELHOS } from "../vendor/concelhos.js";
// Stock simples (decisão 13; ecras/stock.js): "Entrada de stock" abre a mesma janela do ecrã Stock.
import { abrirEntradaStock } from "./stock.js";

export const CATEGORIAS = {
  disjuntor: "Disjuntor", interruptor: "Interruptor", sensor: "Sensor", estore: "Estore", tomada: "Tomada", luz: "Luz",
  termostato: "Termóstato", central: "Central", acessorio: "Acessório", outro: "Outro",
};
// Especialidades (decisão do dono, 2026-10-14; migração 55): cada artigo é de uma; os eletricistas parceiros dela propõem
// as horas e o material (bloco "Propostas dos parceiros"), e nada muda até o CEO aprovar. As de eletricistas.js.
export const ESPECIALIDADES = { geral: "Instalação geral e quadros", domotica: "Domótica e automação", solar: "Solar e carregadores de carro", redes: "Redes, telecomunicações e segurança" };
export const IVA = 0.23;
export const MARGEM_MINIMA = 25;       // %: abaixo disto o artigo fica assinalado
const RE_SKU = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const RE_LINK = /^https:\/\/[^\s"<>]+$/;
const REDES = { "": "—", wifi: "Wi-Fi", zigbee: "Zigbee", "4g": "4G" };

/**
 * Margem de um artigo: venda sem IVA (preco_venda_iva / 1,23) menos o preço de compra.
 * {semIva, euros, pct, aviso: null | "sem_compra" | "baixa"}.
 */
export function margem(precoVendaIva, precoCompra) {
  const v = numero(precoVendaIva);
  const c = numero(precoCompra);
  if (v === null) return { semIva: null, euros: null, pct: null, aviso: null };
  const semIva = Math.round((v / (1 + IVA)) * 100) / 100;
  if (c === null) return { semIva, euros: null, pct: null, aviso: "sem_compra" };
  const e = Math.round((v / (1 + IVA) - c) * 100) / 100;
  const pct = v > 0 ? Math.round(((v / (1 + IVA) - c) / (v / (1 + IVA))) * 1000) / 10 : 0;
  return { semIva, euros: e, pct, aviso: pct < MARGEM_MINIMA ? "baixa" : null };
}
const fmtHoras = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
const horas = (v) => (numero(v) === null ? "—" : `${fmtHoras.format(numero(v))} h`);
const pct = (v) => (v === null ? "—" : `${num(v)} %`);
function celulaMargem(m) {
  if (m.aviso === "sem_compra") return [h("span", { class: "ajuda", text: "—" }), selo("Sem preço de compra", "aviso")];
  if (m.euros === null) return ["—"];
  return [h("span", { class: "margem-valor", text: `${euros(m.euros)} · ${pct(m.pct)}` }), m.aviso === "baixa" ? selo(`Margem abaixo de ${MARGEM_MINIMA} %`, "grav-critica") : null];
}

// Especificações estruturadas por categoria (§3); o resto fica no JSON.
// [chave, rótulo, tipo: "num" | "bool" | "rede" | "intervalo" | "lista"]
const CAMPOS_ESP = {
  disjuntor: [["amperes_max", "Amperes (máx.)", "num"], ["amperes_ajustavel", "Amperes ajustáveis (de–até)", "intervalo"], ["medicao", "Mede consumo", "bool"], ["protecoes", "Proteções (separadas por vírgulas)", "lista"], ["rede", "Rede", "rede"]],
  interruptor: [["botoes", "Botões", "num"], ["canais", "Canais (módulo)", "num"], ["rede", "Rede", "rede"]],
  sensor: [["bateria", "A pilhas", "bool"], ["rede", "Rede", "rede"]],
  estore: [["rede", "Rede", "rede"]],
  tomada: [["medicao", "Mede consumo", "bool"], ["rede", "Rede", "rede"]],
  luz: [["rede", "Rede", "rede"]],
  termostato: [["rede", "Rede", "rede"]],
  central: [], acessorio: [], outro: [],
};

export default function catalogo(el) {
  const ctrl = new AbortController();
  let itens = [];
  let config = null;
  const novo = h("button", { class: "btn", type: "button", id: "novo-artigo", text: "Novo artigo", onclick: () => abrirArtigo(null) });
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar SKU, nome ou fornecedor", "aria-label": "Procurar artigo", maxlength: "80" });
  const fCat = escolha("categoria", { "": "Todas as categorias", ...CATEGORIAS }, "", { "aria-label": "Filtrar por categoria" });
  const fEsp = escolha("especialidade", { "": "Todas as especialidades", ...ESPECIALIDADES }, "", { "aria-label": "Filtrar por especialidade" });
  const fAtivo = escolha("ativo", { "": "Ativos e inativos", sim: "Só ativos", nao: "Só inativos" }, "", { "aria-label": "Filtrar por estado" });
  const contagem = h("p", { class: "ajuda", role: "status", id: "catalogo-contagem" });
  const zona = h("div", { class: "tabela-rolar" }, carregando());
  const zonaConfig = h("section", { class: "cartao bloco-config", "aria-labelledby": "config-titulo" }, h("h2", { id: "config-titulo", text: "Simulador de orçamento" }), carregando());
  // Propostas dos parceiros (2026-10-14): só aparece com o módulo dos eletricistas ligado e alguma proposta.
  const zonaPropostas = h("section", { class: "bloco-propostas-precos", id: "propostas-precos", "aria-labelledby": "propostas-precos-titulo", hidden: true });
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Catálogo" }), novo),
    h("p", { class: "ajuda", text: `Artigos do simulador de orçamento. O cliente só vê o nome, o preço de venda e as horas; nunca o custo, o stock, o fornecedor nem o link. Margem = preço de venda sem IVA (÷ 1,23) − custo real de compra (preço + transporte + alfândega); abaixo de ${MARGEM_MINIMA} % fica assinalada.` }),
    zonaPropostas,
    zonaConfig,
    h("section", { class: "bloco-lista" }, h("div", { class: "seccao-topo" }, h("h2", { text: "Artigos" })),
      h("div", { class: "filtros" }, fTexto, fCat, fEsp, fAtivo), contagem, zona));
  for (const f of [fCat, fEsp, fAtivo]) f.addEventListener("change", desenhar);
  fTexto.addEventListener("input", desenhar);

  async function carregar() {
    let r;
    try { r = await pedir("catalogo", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") { zona.replaceChildren(erroEcra(e, carregar)); zonaConfig.hidden = e.estado === 403; } return; }
    itens = lista(r, "itens", "artigos");
    config = campo(r, "config") ?? null;
    if (!config) { try { config = await pedir("config-orcamento", { sinal: ctrl.signal }); } catch { config = {}; } }
    desenharConfig();
    desenhar();
    carregarPropostas();
  }

  // ---------- Propostas dos parceiros (decisão do dono, 2026-10-14) ----------
  // O que os eletricistas parceiros propõem para os artigos da sua especialidade (horas, material, custo do material) ou
  // um artigo novo. Antes e depois lado a lado; o CEO pode mudar os valores antes de aprovar. Recusar pede um motivo
  // (opcional) que o eletricista vê. O preço ao cliente nunca vem do eletricista.
  async function carregarPropostas() {
    let r;
    try { r = await pedir("propostas-precos", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zonaPropostas.hidden = true; return; }   // módulo dos eletricistas desligado: 404
    const pendentes = lista(r, "pendentes");
    zonaPropostas.hidden = !pendentes.length;
    if (!pendentes.length) { zonaPropostas.replaceChildren(); return; }
    zonaPropostas.replaceChildren(
      h("div", { class: "seccao-topo" }, h("h2", { id: "propostas-precos-titulo", text: `Propostas dos parceiros (${pendentes.length})` })),
      h("p", { class: "ajuda", text: "Horas e material propostos pelos eletricistas parceiros para os artigos da sua especialidade. Nada muda no catálogo, no simulador nem nas propostas até aprovar. \"Recebe\" = a percentagem do eletricista da mão de obra sem IVA." }),
      h("div", { class: "propostas-lista" }, ...pendentes.map(cartaoProposta)));
  }

  function cartaoProposta(x) {
    const id = String(campo(x, "id"));
    const novo = campo(x, "novo") === true;
    const antes = campo(x, "antes"), prop = campo(x, "proposta") ?? {};
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const entrada = (nome, valor, attrs = {}) => h("input", { name: nome, id: `pp-${nome}-${id}`, value: valor ?? "", ...attrs });
    const horasI = entrada("horas", campo(prop, "horas"), { type: "number", min: "0.05", max: "100", step: "0.05", inputmode: "decimal", required: true });
    const materialI = entrada("material", campo(prop, "material"), { maxlength: "300" });
    const custoI = entrada("custo", campo(prop, "custo"), { type: "number", min: "0", step: "0.01", inputmode: "decimal" });
    const skuI = novo ? entrada("sku", "", { maxlength: "40", autocapitalize: "characters", spellcheck: "false", required: true }) : null;
    const nomeI = novo ? entrada("nome", campo(prop, "nome"), { maxlength: "160", required: true }) : null;
    const catI = novo ? escolha("categoria", CATEGORIAS, "outro", { id: `pp-categoria-${id}` }) : null;
    const vendaI = novo ? entrada("preco_venda_iva", "", { type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true }) : null;
    const linhaT = (rotulo, a, b) => h("tr", {}, h("th", { scope: "row", text: rotulo }), h("td", { "data-rotulo": "Agora", text: a }), h("td", { "data-rotulo": "Proposta", text: b }));
    const txtOu = (v) => (v == null || v === "" ? "—" : String(v));
    const tabela = h("table", { class: "tabela tabela-cartoes tabela-comparar" },
      h("caption", { class: "so-leitor", text: "Valores atuais e propostos" }),
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "" }), h("th", { scope: "col", text: "Agora" }), h("th", { scope: "col", text: "Proposta" }))),
      h("tbody", {},
        linhaT("Horas", antes ? horas(campo(antes, "horas")) : "—", horas(campo(prop, "horas"))),
        linhaT("Material", antes ? txtOu(campo(antes, "material")) : "—", txtOu(campo(prop, "material"))),
        linhaT("Custo do material", antes ? euros(campo(antes, "custo")) : "—", euros(campo(prop, "custo"))),
        linhaT(`Recebe o eletricista (${num(campo(x, "percentagem"))} %)`, antes ? euros(campo(antes, "recebe")) : "—", euros(campo(prop, "recebe")))));
    const motivo = h("textarea", { rows: "2", maxlength: "300", id: `pp-motivo-${id}`, "aria-label": "Motivo da recusa" });
    const zonaRecusa = h("div", { class: "form-grelha", hidden: true },
      campoForm("Porque recusa (opcional; o eletricista vê este texto)", motivo),
      h("div", { class: "form-botoes" }, h("button", { class: "btn pequeno", type: "button", id: `pp-recusar-confirmar-${id}`, text: "Confirmar: recusar", onclick: (e) => decidir(e.currentTarget, "recusar", { motivo: motivo.value.trim() || null }) })));
    async function decidir(botao, acao, corpo) {
      botao.disabled = true; mensagem(msg, null);
      try {
        await pedir(`propostas-precos/${encodeURIComponent(id)}/${acao}`, { corpo });
        avisar(acao === "aprovar" ? "Proposta aprovada: o catálogo foi atualizado." : "Proposta recusada.");
        carregar();
      } catch (er) { botao.disabled = false; mensagem(msg, er.message); }
    }
    function aprovar(e) {
      const hv = numero(horasI.value);
      if (hv === null || hv <= 0 || hv > 100) { mensagem(msg, "Horas: número maior que 0 e até 100."); horasI.focus(); return; }
      const ct = custoI.value.trim(), cv = ct === "" ? null : numero(ct);
      if (ct !== "" && (cv === null || cv < 0)) { mensagem(msg, "O custo do material tem de ser um número (ou vazio)."); custoI.focus(); return; }
      const corpo = { horas: hv, material: materialI.value.trim() || null, custo: cv };
      if (novo) {
        const sku = skuI.value.trim().toUpperCase();
        if (!RE_SKU.test(sku)) { mensagem(msg, "SKU inválido: maiúsculas, números, \".\", \"_\" e \"-\" (máx. 40)."); skuI.focus(); return; }
        const venda = numero(vendaI.value);
        if (venda === null || venda < 0) { mensagem(msg, "Indique o preço de venda (c/ IVA)."); vendaI.focus(); return; }
        if (!nomeI.value.trim()) { mensagem(msg, "Escreva o nome do artigo."); nomeI.focus(); return; }
        Object.assign(corpo, { sku, nome: nomeI.value.trim(), categoria: catI.value, preco_venda_iva: venda });
      }
      decidir(e.currentTarget, "aprovar", corpo);
    }
    const titulo = novo ? `Artigo novo: ${txtOu(campo(prop, "nome"))}` : `${txtOu(campo(x, "artigo")?.nome)} (${txtOu(campo(x, "artigo")?.sku)})`;
    return h("article", { class: "cartao", id: `proposta-precos-${id}`, dataset: { id } },
      h("h3", { text: titulo }),
      h("p", { class: "ajuda", text: `Proposta de ${txtOu(campo(x, "eletricista")?.nome)} · ${txtOu(campo(x, "especialidade_nome"))} · ${data(campo(x, "criado"))}` }),
      tabela,
      campo(prop, "nota") ? h("p", {}, h("strong", { text: "Nota: " }), h("span", { text: String(campo(prop, "nota")) })) : null,
      h("details", { class: "pp-editar" }, h("summary", { text: novo ? "Dados do artigo novo e valores a aprovar" : "Mudar os valores antes de aprovar" }),
        h("div", { class: "form-grelha" },
          novo ? h("div", { class: "duas" }, campoForm("SKU", skuI, "Maiúsculas, números, \".\", \"_\" e \"-\""), campoForm("Categoria", catI)) : null,
          novo ? campoForm("Nome", nomeI) : null,
          novo ? campoForm("Preço de venda (€, c/ IVA)", vendaI, "O eletricista nunca propõe o preço ao cliente. O artigo fica escondido do cliente até o mostrar.") : null,
          h("div", { class: "tres" }, campoForm("Horas", horasI), campoForm("Material", materialI), campoForm("Custo do material (€)", custoI, "Vazio = fica o custo que já tem")))),
      h("div", { class: "form-botoes" },
        h("button", { class: "btn pequeno", type: "button", id: `pp-aprovar-${id}`, text: "Aprovar", onclick: (e) => {
          if (novo && !e.currentTarget.closest("article").querySelector("details").open) { e.currentTarget.closest("article").querySelector("details").open = true; mensagem(msg, "Indique o SKU, a categoria e o preço de venda do artigo novo.", "info"); skuI.focus(); return; }
          aprovar(e);
        } }),
        h("button", { class: "btn sec pequeno", type: "button", id: `pp-recusar-${id}`, text: "Recusar", onclick: (e) => { zonaRecusa.hidden = false; e.currentTarget.hidden = true; motivo.focus(); } })),
      zonaRecusa, msg);
  }

  // ---------- Configuração ----------
  function desenharConfig() {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const entrada = (nome, valor, max, passo = "0.01") => h("input", { name: nome, type: "number", min: "0", max, step: passo, inputmode: "decimal", required: true, value: valor ?? "" });
    const f = h("form", { class: "form-grelha", id: "form-config", novalidate: true },
      h("div", { class: "tres" },
        campoForm("Tarifa por hora (€, c/ IVA)", entrada("tarifa_hora_iva", campo(config, "tarifa_hora_iva"), "1000")),
        campoForm("Intervalo para baixo (%)", entrada("intervalo_menos_pct", campo(config, "intervalo_menos_pct") ?? 10, "100", "0.1"), "Estimativa: de total − este %"),
        campoForm("Intervalo para cima (%)", entrada("intervalo_mais_pct", campo(config, "intervalo_mais_pct") ?? 20, "100", "0.1"), "… até total + este %")),
      h("div", { class: "tres" },
        campoForm("Deslocação — valor fixo (€, c/ IVA)", entrada("deslocacao_iva", campo(config, "deslocacao_iva"), "10000"), "Mínimo de cada deslocação"),
        campoForm("Margem dos pacotes (%)", entrada("margem_pacotes_pct", campo(config, "margem_pacotes_pct") ?? 20, "100", "0.1"), "Melhorias: (material + mão de obra) + esta margem"),
        // Avarias fora de horas (decisão do dono, 2026-10-13): o simulador mostra os dois preços com este valor.
        campoForm("Avarias fora de horas (% a mais)", entrada("fora_horas_pct", campo(config, "fora_horas_pct") ?? 50, "200", "0.1"), "Diagnóstico e mão de obra de noite, ao fim de semana e nos feriados")),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Deslocação por distância" }),
        h("p", { class: "ajuda", text: "Distância estimada desde a base: linha reta entre as sedes dos concelhos × 1,3 (estradas). Deslocação = valor fixo + preço por km acima dos km grátis. Acima da distância máxima (ou entre o continente e as ilhas, ou noutra ilha) o simulador mostra \"fora da área servida — contacte-nos\"." }),
        h("div", { class: "duas" },
          campoForm("Base (concelho)", escolha("deslocacao_base", Object.fromEntries(CONCELHOS.map((c) => [c[0], `${c[0]} (${c[1]})`])), String(campo(config, "deslocacao_base") ?? "Lisboa"), { required: true })),
          campoForm("Km grátis", entrada("deslocacao_km_gratis", campo(config, "deslocacao_km_gratis"), "1000", "1"))),
        h("div", { class: "duas" },
          campoForm("Preço por km (€, c/ IVA)", entrada("deslocacao_preco_km_iva", campo(config, "deslocacao_preco_km_iva"), "100")),
          campoForm("Distância máxima servida (km)", entrada("deslocacao_max_km", campo(config, "deslocacao_max_km"), "2000", "1")))),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Pagamentos online" }),
        campoForm("IVA dos pagamentos (%)", entrada("iva_pct", campo(config, "iva_pct") ?? 23, "50", "0.1"),
          "A proposta do painel é sem IVA; o sinal e o restante pagos online incluem este IVA (1000 € + 23 % = 1230 €). O relatório, a visita e a avaria já são com IVA."),
        campoForm("Relatório completo (€, c/ IVA)", entrada("preco_relatorio_iva", campo(config, "preco_relatorio_iva") ?? 29, "1000"),
          "Enviar é grátis (relatório grátis). A visita = deslocação + 0,5 h × tarifa. Tudo descontado no sinal."),
        h("div", { class: "tres" },
          campoForm("Obra mínima (€, c/ IVA)", entrada("obra_minima_iva", campo(config, "obra_minima_iva") ?? 100, "10000"), "Abaixo disto cobra-se o mínimo e o que foi pago antes não se desconta."),
          campoForm("Limite do cartão (€, c/ IVA)", entrada("cartao_max_iva", campo(config, "cartao_max_iva") ?? 500, "1000000"), "Acima disto só Multibanco ou MB Way."),
          campoForm("Horas por dia de obra", entrada("horas_por_dia", campo(config, "horas_por_dia") ?? 8, "24", "0.5"), "Deslocação: ida e volta por dia de obra.")),
        campoForm("Deslocação — máximo de dias por obra", entrada("deslocacao_max_dias", campo(config, "deslocacao_max_dias") ?? 5, "365", "1"), "Deslocação = (fixo + km pagos × 2 × preço por km) × dias de obra, no máximo estes dias."),
        h("p", { class: "ajuda", text: "Sinal = o maior entre 30 % do total com IVA e o custo do material (o sinal cobre o material), menos o que já foi pago." })),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Ensaios (relatório completo)" }),
        h("p", { class: "ajuda", text: "Valores de referência da lista de ensaios do relatório completo, marcados \"a confirmar pelo técnico\". A continuidade do PE não tem limite (valor medido)." }),
        h("div", { class: "tres" },
          campoForm("Isolamento mínimo (MΩ)", entrada("ensaio_isolamento_mohm", campo(config, "ensaio_isolamento_mohm") ?? 0.5, "1000", "0.01"), "RTIEBT 612.3: ≥, a 500 V DC"),
          campoForm("Terra máxima (Ω)", entrada("ensaio_terra_ohm", campo(config, "ensaio_terra_ohm") ?? 100, "100000", "1"), "RTIEBT 801.5.6.1: ≤ com disjuntor de entrada diferencial"),
          campoForm("Disparo do diferencial (ms)", entrada("ensaio_diferencial_ms", campo(config, "ensaio_diferencial_ms") ?? 300, "10000", "1"), "Referência EN 61008/61009 (a RTIEBT só exige disparo ≤ IΔn)"))),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar configuração" })), msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const corpo = {};
      for (const [k, max, rot] of [["tarifa_hora_iva", 1000, "A tarifa por hora"], ["intervalo_menos_pct", 100, "O intervalo para baixo"], ["intervalo_mais_pct", 100, "O intervalo para cima"], ["deslocacao_iva", 10000, "O valor fixo da deslocação"],
        ["margem_pacotes_pct", 100, "A margem dos pacotes"], ["fora_horas_pct", 200, "O preço a mais das avarias fora de horas"],
        ["deslocacao_km_gratis", 1000, "O n.º de km grátis"], ["deslocacao_preco_km_iva", 100, "O preço por km"], ["deslocacao_max_km", 2000, "A distância máxima"],
        ["iva_pct", 50, "A taxa de IVA"], ["preco_relatorio_iva", 1000, "O preço do relatório"],
        ["obra_minima_iva", 10000, "A obra mínima"], ["cartao_max_iva", 1000000, "O limite do cartão"], ["horas_por_dia", 24, "As horas por dia de obra"], ["deslocacao_max_dias", 365, "O máximo de dias de deslocação"],
        ["ensaio_isolamento_mohm", 1000, "O isolamento mínimo"], ["ensaio_terra_ohm", 100000, "A terra máxima"], ["ensaio_diferencial_ms", 10000, "O disparo do diferencial"]]) {
        const v = numero(f.elements[k].value);
        if (v === null || v < 0 || v > max) { mensagem(msg, `${rot} tem de ser um número entre 0 e ${num(max)}.`); f.elements[k].focus(); return; }
        corpo[k] = v;
      }
      corpo.deslocacao_base = f.elements.deslocacao_base.value;
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        config = await pedir("config-orcamento", { corpo }) ?? { ...config, ...corpo };
        avisar("Configuração do simulador guardada.");
        desenharConfig();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    zonaConfig.replaceChildren(h("h2", { id: "config-titulo", text: "Simulador de orçamento" }), f);
  }

  // ---------- Tabela ----------
  function visiveis() {
    const t = fTexto.value.trim().toLowerCase();
    return itens
      .filter((a) => !fCat.value || campo(a, "categoria") === fCat.value)
      .filter((a) => !fEsp.value || (campo(a, "especialidade") ?? "geral") === fEsp.value)
      .filter((a) => !fAtivo.value || (campo(a, "ativo") !== false) === (fAtivo.value === "sim"))
      .filter((a) => !t || ["sku", "nome", "fornecedor"].some((k) => String(campo(a, k) ?? "").toLowerCase().includes(t)))
      .sort((a, b) => (CATEGORIAS[campo(a, "categoria")] ?? "").localeCompare(CATEGORIAS[campo(b, "categoria")] ?? "", "pt") || String(campo(a, "nome")).localeCompare(String(campo(b, "nome")), "pt"));
  }

  function desenhar() {
    if (!config) return;
    const vis = visiveis();
    const avisos = itens.filter((a) => margem(campo(a, "preco_venda_iva"), campo(a, "preco_compra")).aviso).length;
    contagem.textContent = `${vis.length} de ${itens.length} artigos${avisos ? ` · ${avisos} com margem por confirmar ou abaixo de ${MARGEM_MINIMA} %` : ""}`;
    if (!itens.length) { zona.replaceChildren(h("p", { class: "vazio", text: "Ainda não há artigos no catálogo." })); return; }
    if (!vis.length) { zona.replaceChildren(h("p", { class: "vazio", text: "Nenhum artigo com estes filtros." })); return; }
    zona.replaceChildren(h("table", { class: "tabela tabela-cartoes", id: "tabela-catalogo" },
      h("caption", { class: "so-leitor", text: "Artigos do catálogo" }),
      h("thead", {}, h("tr", {}, ...["Artigo", "Categoria", "Custo", "Venda c/ IVA", "Margem", "Horas", "Stock", "Mínimo", "Estado", ""].map((t, i) =>
        h("th", { scope: "col", class: [2, 3, 5, 6, 7].includes(i) ? "num" : "", text: t }, i === 9 ? h("span", { class: "so-leitor", text: "Ações" }) : null)))),
      h("tbody", {}, ...vis.map(linha))));
  }

  function linha(a) {
    const id = String(campo(a, "id"));
    const m = margem(campo(a, "preco_venda_iva"), campo(a, "preco_compra"));
    const ativo = campo(a, "ativo") !== false, visivel = campo(a, "visivel_cliente") !== false;
    const nota = campo(a, "especificacoes")?.nota, provisorio = typeof nota === "string" && /preço provisório/i.test(nota);
    return h("tr", { dataset: { id, sku: String(campo(a, "sku") ?? "") }, class: `${ativo ? "" : "inativo"} ${m.aviso ? `margem-${m.aviso}` : ""}`.trim() },
      h("td", { "data-rotulo": "Artigo" }, h("div", {}, h("strong", { class: "bloco-ajuda", text: String(campo(a, "nome") ?? "—") }), h("span", { class: "ajuda bloco-ajuda", text: [campo(a, "sku"), campo(a, "fornecedor")].filter(Boolean).join(" · ") }))),
      h("td", { "data-rotulo": "Categoria" }, h("div", {}, h("span", { class: "bloco-ajuda", text: CATEGORIAS[campo(a, "categoria")] ?? String(campo(a, "categoria") ?? "—") }),
        h("span", { class: "ajuda bloco-ajuda", text: ESPECIALIDADES[campo(a, "especialidade")] ?? "" }))),
      h("td", { class: "num", "data-rotulo": "Custo", text: euros(campo(a, "preco_compra")) }),
      h("td", { class: "num", "data-rotulo": "Venda c/ IVA", text: euros(campo(a, "preco_venda_iva")) }),
      h("td", { class: "celula-margem", "data-rotulo": "Margem" }, h("span", { class: "linha-selos" }, ...celulaMargem(m))),
      h("td", { class: "num", "data-rotulo": "Horas", text: horas(campo(a, "horas_instalacao")) }),
      h("td", { class: "num", "data-rotulo": "Stock" }, h("span", { class: "linha-selos" },
        h("span", { text: `${campo(a, "stock_qtd") ?? 0}${numero(campo(a, "stock_reservado")) > 0 ? ` (${campo(a, "stock_reservado")} res.)` : ""}` }),
        abaixoMinimo(a) ? selo("Abaixo do mínimo", "grav-critica") : null)),
      h("td", { class: "num", "data-rotulo": "Mínimo", text: String(campo(a, "stock_minimo") ?? 0) }),
      h("td", { "data-rotulo": "Estado" }, h("span", { class: "linha-selos" }, ativo ? selo("Ativo", "orc-aceite") : selo("Inativo", "obra-cancelada"), visivel ? null : selo("Escondido do cliente", "aviso"), provisorio ? selo("Preço provisório", "aviso") : null)),
      h("td", { class: "acoes" }, h("span", { class: "form-botoes" },
        h("button", { class: "btn sec pequeno", type: "button", text: "Editar", "aria-label": `Editar ${campo(a, "nome") ?? campo(a, "sku")}`, onclick: () => abrirArtigo(a) }),
        h("button", { class: "btn sec pequeno", type: "button", text: "Entrada de stock", "aria-label": `Entrada de stock de ${campo(a, "nome") ?? campo(a, "sku")}`, onclick: () => abrirEntradaStock(a, guardado) }))));
  }

  /** Artigo com stock gerido e o disponível (em armazém − reservado) abaixo do mínimo (ou negativo). */
  const abaixoMinimo = (a) => {
    const disp = (numero(campo(a, "stock_qtd")) ?? 0) - (numero(campo(a, "stock_reservado")) ?? 0);
    return campo(a, "stock_gerido") === true && (disp < (numero(campo(a, "stock_minimo")) ?? 0) || disp < 0);
  };
  /** Um artigo voltou do servidor (entrada de stock): troca-o na lista. */
  function guardado(novoA) {
    const i = itens.findIndex((x) => String(campo(x, "id")) === String(campo(novoA, "id")));
    if (i >= 0) itens[i] = novoA;
    desenhar();
  }

  // ---------- Criar / editar ----------
  function abrirArtigo(a) {
    const j = janela(a ? `Editar ${campo(a, "sku")}` : "Novo artigo", { larga: true });
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const esp = { ...(campo(a, "especificacoes") && typeof campo(a, "especificacoes") === "object" ? campo(a, "especificacoes") : {}) };
    const v = (k) => campo(a, k) ?? "";
    const inp = (nome, attrs = {}) => h("input", { name: nome, value: v(nome), ...attrs });
    const zonaMargem = h("div", { class: "margem-artigo", id: "margem-artigo", role: "status", "aria-live": "polite" });
    const zonaEsp = h("div", { class: "esp-campos" });
    const json = h("textarea", { name: "especificacoes", rows: "5", spellcheck: "false", class: "codigo" }, JSON.stringify(esp, null, 2));
    const linkAtual = typeof v("link") === "string" && RE_LINK.test(v("link"))
      ? h("a", { href: v("link"), target: "_blank", rel: "noopener noreferrer", id: "abrir-link", text: "Abrir a página do fornecedor ↗" }) : null;
    const categoria = escolha("categoria", CATEGORIAS, campo(a, "categoria") ?? "outro");
    const especialidade = escolha("especialidade", ESPECIALIDADES, campo(a, "especialidade") ?? "geral");
    const f = h("form", { class: "form-grelha", id: "form-artigo", novalidate: true },
      h("div", { class: "duas" },
        campoForm("SKU", inp("sku", { required: true, maxlength: "40", autocapitalize: "characters", spellcheck: "false" }), "Maiúsculas, números, \".\", \"_\" e \"-\""),
        campoForm("Categoria", categoria)),
      campoForm("Nome", inp("nome", { required: true, maxlength: "160" })),
      h("div", { class: "duas" },
        campoForm("Especialidade", especialidade, "Os eletricistas parceiros desta especialidade propõem as horas e o material."),
        campoForm("Material (texto)", h("input", { name: "material", maxlength: "300", value: typeof esp.material === "string" ? esp.material : "" }), "O que leva. Fica nas especificações.")),
      h("div", { class: "duas" },
        campoForm("Fornecedor", inp("fornecedor", { maxlength: "160" })),
        campoForm("Link (página do fornecedor)", inp("link", { type: "url", maxlength: "500", inputmode: "url", placeholder: "https://…", spellcheck: "false" }), "Só https://. Nunca aparece ao cliente.")),
      linkAtual,
      h("div", { class: "tres" },
        campoForm("Custo real de compra (€)", inp("preco_compra", { type: "number", min: "0", step: "0.01", inputmode: "decimal" }), "Preço + transporte + alfândega. Vazio = desconhecido"),
        campoForm("Preço de venda (€, c/ IVA)", inp("preco_venda_iva", { type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true })),
        campoForm("Horas de instalação", h("input", { name: "horas_instalacao", type: "number", min: "0", max: "100", step: "0.05", inputmode: "decimal", value: campo(a, "horas_instalacao") ?? 0 }))),
      // Lote 7 (simulador, ação "Substituir"): as horas de trocar um aparelho que já existe.
      h("div", { class: "duas" },
        campoForm("Horas de troca (substituir)", h("input", { name: "horas_troca", type: "number", min: "0", max: "100", step: "0.05", inputmode: "decimal", value: campo(a, "horas_troca") ?? "" }), "Vazio = 50 % das horas de instalação."),
        // Stock (decisão 13): o mínimo edita-se aqui; a quantidade muda por "Entrada de stock" e pelas obras.
        campoForm("Stock mínimo", h("input", { name: "stock_minimo", type: "number", min: "0", step: "1", inputmode: "numeric", value: campo(a, "stock_minimo") ?? 0 }), a ? `Em armazém: ${campo(a, "stock_qtd") ?? 0}. Abaixo do mínimo fica assinalado.` : "Abaixo do mínimo fica assinalado.")),
      zonaMargem,
      h("fieldset", { class: "grupo" }, h("legend", { text: "Especificações" }), zonaEsp,
        h("details", { class: "esp-json" }, h("summary", { text: "JSON (avançado)" }),
          campoForm("Especificações em JSON", json, "Tudo o que não tem campo próprio fica aqui (objeto JSON, máx. 8 KB)."))),
      h("div", { class: "caixas" },
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "ativo", checked: campo(a, "ativo") !== false }), "Ativo"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "visivel_cliente", checked: campo(a, "visivel_cliente") !== false }), "Visível ao cliente no simulador")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: a ? "Guardar alterações" : "Criar artigo" }), h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => j.fechar() })),
      a ? h("p", { class: "ajuda", text: `Atualizado ${data(campo(a, "atualizado"))}` }) : null,
      msg);
    const el2 = f.elements;

    function mostrarMargem() {
      const m = margem(el2.preco_venda_iva.value, el2.preco_compra.value);
      if (m.semIva === null) { zonaMargem.replaceChildren(h("span", { class: "ajuda", text: "Indique o preço de venda para ver a margem." })); zonaMargem.className = "margem-artigo"; return; }
      zonaMargem.className = `margem-artigo ${m.aviso ? "aviso" : "ok"}`;
      zonaMargem.replaceChildren(
        h("span", { text: `Sem IVA: ${euros(m.semIva)}` }),
        h("strong", { text: m.euros === null ? "Margem: —" : `Margem: ${euros(m.euros)} (${pct(m.pct)})` }),
        // Sem aviso não se passa nada (replaceChildren escrevia "null").
        ...(m.aviso === "sem_compra" ? [h("span", { class: "margem-aviso", text: "Sem preço de compra: não dá para saber a margem." })]
          : m.aviso === "baixa" ? [h("span", { class: "margem-aviso", text: `Margem abaixo de ${MARGEM_MINIMA} %: confirme o preço de venda.` })] : []));
    }
    el2.preco_venda_iva.addEventListener("input", mostrarMargem);
    el2.preco_compra.addEventListener("input", mostrarMargem);
    mostrarMargem();

    // Especificações: campos da categoria ↔ JSON (o JSON é o que se envia).
    function lerJson() {
      const t = json.value.trim();
      if (!t) return {};
      try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
    }
    function escreverJson(o) { json.value = JSON.stringify(o, null, 2); }
    function desenharEsp() {
      const o = lerJson() ?? {};
      const campos = CAMPOS_ESP[categoria.value] ?? [];
      if (!campos.length) { zonaEsp.replaceChildren(h("p", { class: "ajuda", text: "Esta categoria não tem campos próprios: use o JSON." })); return; }
      zonaEsp.replaceChildren(h("div", { class: "esp-grelha" }, ...campos.map(([k, rot, tipo]) => {
        const muda = (valor) => { const x = lerJson(); if (x === null) { mensagem(msg, "O JSON das especificações não é válido: corrija-o antes de usar os campos."); return; } if (valor === undefined) delete x[k]; else x[k] = valor; escreverJson(x); };
        if (tipo === "bool") {
          const c = h("input", { type: "checkbox", name: `esp_${k}`, checked: o[k] === true });
          c.addEventListener("change", () => muda(c.checked ? true : false));
          return h("label", { class: "caixa" }, c, rot);
        }
        if (tipo === "rede") {
          const s = escolha(`esp_${k}`, REDES, typeof o[k] === "string" ? o[k] : "");
          s.addEventListener("change", () => muda(s.value || undefined));
          return campoForm(rot, s);
        }
        if (tipo === "intervalo") {
          const [de, ate] = Array.isArray(o[k]) ? o[k] : [];
          const a1 = h("input", { type: "number", name: `esp_${k}_de`, min: "0", step: "1", value: de ?? "", "aria-label": `${rot}: de` });
          const a2 = h("input", { type: "number", name: `esp_${k}_ate`, min: "0", step: "1", value: ate ?? "", "aria-label": `${rot}: até` });
          const mudar = () => { const x = numero(a1.value), y = numero(a2.value); muda(x === null && y === null ? undefined : [x, y]); };
          a1.addEventListener("input", mudar); a2.addEventListener("input", mudar);
          return h("div", { class: "campo" }, h("span", { text: rot }), h("div", { class: "intervalo" }, a1, h("span", { "aria-hidden": "true", text: "–" }), a2));
        }
        if (tipo === "lista") {
          const valor = Array.isArray(o[k]) ? o[k].join(", ") : typeof o[k] === "string" ? o[k] : "";
          const t = h("input", { name: `esp_${k}`, value: valor, maxlength: "300" });
          t.addEventListener("input", () => { const l = t.value.split(",").map((x) => x.trim()).filter(Boolean); muda(l.length ? l : o[k] === false ? false : undefined); });
          return campoForm(rot, t, o[k] === false ? "Sem proteções (false)" : null);
        }
        const n = h("input", { type: "number", name: `esp_${k}`, min: "0", step: "1", value: typeof o[k] === "number" ? o[k] : "" });
        n.addEventListener("input", () => { const x = numero(n.value); muda(x === null ? undefined : x); });
        return campoForm(rot, n);
      })));
    }
    categoria.addEventListener("change", desenharEsp);
    json.addEventListener("change", () => { if (lerJson() !== null) { mensagem(msg, null); desenharEsp(); } });
    desenharEsp();

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const erro = (t, campoEl) => { mensagem(msg, t); campoEl?.focus(); };
      const sku = el2.sku.value.trim().toUpperCase();
      if (!RE_SKU.test(sku)) return erro("SKU inválido: maiúsculas, números, \".\", \"_\" e \"-\" (máx. 40).", el2.sku);
      const nome = el2.nome.value.trim();
      if (!nome) return erro("Escreva o nome do artigo.", el2.nome);
      const link = el2.link.value.trim();
      if (link && !RE_LINK.test(link)) return erro("O link tem de ser um endereço https:// completo.", el2.link);
      const venda = numero(el2.preco_venda_iva.value);
      if (venda === null || venda < 0) return erro("Indique o preço de venda (c/ IVA).", el2.preco_venda_iva);
      const compraTxt = el2.preco_compra.value.trim();
      const compra = compraTxt === "" ? null : numero(compraTxt);
      if (compraTxt !== "" && (compra === null || compra < 0)) return erro("O preço de compra tem de ser um número (ou vazio).", el2.preco_compra);
      const horas = numero(el2.horas_instalacao.value);
      if (horas === null || horas < 0 || horas > 100) return erro("Horas de instalação: número entre 0 e 100.", el2.horas_instalacao);
      const trocaTxt = el2.horas_troca.value.trim();
      const horasTroca = trocaTxt === "" ? null : numero(trocaTxt);
      if (trocaTxt !== "" && (horasTroca === null || horasTroca < 0 || horasTroca > 100)) return erro("Horas de troca: número entre 0 e 100 (ou vazio).", el2.horas_troca);
      const minimo = numero(el2.stock_minimo.value.trim() === "" ? "0" : el2.stock_minimo.value);
      if (minimo === null || minimo < 0 || !Number.isInteger(minimo)) return erro("Stock mínimo: número inteiro igual ou maior que 0.", el2.stock_minimo);
      const especificacoes = lerJson();
      if (especificacoes === null) { f.querySelector("details.esp-json").open = true; return erro("As especificações têm de ser um objeto JSON válido.", json); }
      const materialTxt = el2.material.value.trim();
      if (materialTxt) especificacoes.material = materialTxt; else delete especificacoes.material;
      const tudo = {
        sku, nome, categoria: categoria.value, especialidade: especialidade.value, fornecedor: el2.fornecedor.value.trim() || null, link: link || null,
        preco_compra: compra, preco_venda_iva: venda, horas_instalacao: horas, horas_troca: horasTroca, especificacoes, stock_minimo: minimo,
        ativo: el2.ativo.checked, visivel_cliente: el2.visivel_cliente.checked,
      };
      // Editar: só o que mudou.
      let corpo = tudo;
      if (a) {
        corpo = {};
        for (const [k, val] of Object.entries(tudo)) {
          const antes = campo(a, k) ?? (k === "stock_minimo" ? 0 : k === "especialidade" ? "geral" : null);
          if (JSON.stringify(k === "especificacoes" ? (antes ?? {}) : antes) !== JSON.stringify(val)) corpo[k] = val;
        }
        if (!Object.keys(corpo).length) { mensagem(msg, "Não mudou nada.", "info"); return; }
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(a ? `catalogo/${encodeURIComponent(campo(a, "id"))}` : "catalogo", { corpo });
        const novoA = campo(r, "artigo") ?? r ?? { ...a, ...corpo };
        const i = itens.findIndex((x) => String(campo(x, "id")) === String(campo(novoA, "id")));
        if (i >= 0) itens[i] = novoA; else itens.push(novoA);
        avisar(a ? `Artigo ${sku} guardado.` : `Artigo ${sku} criado.`);
        j.fechar();
        desenhar();
      } catch (er) { b.disabled = false; mensagem(msg, er.message); }
    });
    j.corpo.append(f);
    (a ? el2.nome : el2.sku).focus();
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
