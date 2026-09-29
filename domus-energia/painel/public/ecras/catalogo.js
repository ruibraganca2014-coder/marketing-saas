// Catálogo (só CEO; docs/SIMULADOR-ORCAMENTO.md §3): artigos do simulador de orçamento com preço de compra,
// preço de venda (c/ IVA), margem, horas de instalação e especificações; configuração do simulador
// (tarifa por hora, margem do intervalo, deslocação por distância). O público só vê GET /api/catalogo (sem custos).
import { pedir, campo, lista, numero } from "../api.js";
import { h, euros, num, selo, campoForm, escolha, janela, mensagem, avisar, carregando, erroEcra, data } from "../ui.js";
// Os 308 concelhos (cópia de web/simulador/concelhos.js): a base da deslocação escolhe-se desta lista.
import { CONCELHOS } from "../vendor/concelhos.js";

export const CATEGORIAS = {
  disjuntor: "Disjuntor", interruptor: "Interruptor", sensor: "Sensor", estore: "Estore", tomada: "Tomada", luz: "Luz",
  termostato: "Termóstato", central: "Central", acessorio: "Acessório", outro: "Outro",
};
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
  const fAtivo = escolha("ativo", { "": "Ativos e inativos", sim: "Só ativos", nao: "Só inativos" }, "", { "aria-label": "Filtrar por estado" });
  const contagem = h("p", { class: "ajuda", role: "status", id: "catalogo-contagem" });
  const zona = h("div", { class: "tabela-rolar" }, carregando());
  const zonaConfig = h("section", { class: "cartao bloco-config", "aria-labelledby": "config-titulo" }, h("h2", { id: "config-titulo", text: "Simulador de orçamento" }), carregando());
  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Catálogo" }), novo),
    h("p", { class: "ajuda", text: `Artigos do simulador de orçamento. O cliente só vê o nome, o preço de venda e as horas; nunca o preço de compra, o fornecedor nem o link. Margem = preço de venda sem IVA (÷ 1,23) − preço de compra; abaixo de ${MARGEM_MINIMA} % fica assinalada.` }),
    zonaConfig,
    h("section", { class: "bloco-lista" }, h("div", { class: "seccao-topo" }, h("h2", { text: "Artigos" })),
      h("div", { class: "filtros" }, fTexto, fCat, fAtivo), contagem, zona));
  for (const f of [fCat, fAtivo]) f.addEventListener("change", desenhar);
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
  }

  // ---------- Configuração ----------
  function desenharConfig() {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const entrada = (nome, valor, max, passo = "0.01") => h("input", { name: nome, type: "number", min: "0", max, step: passo, inputmode: "decimal", required: true, value: valor ?? "" });
    const f = h("form", { class: "form-grelha", id: "form-config", novalidate: true },
      h("div", { class: "tres" },
        campoForm("Tarifa por hora (€, c/ IVA)", entrada("tarifa_hora_iva", campo(config, "tarifa_hora_iva"), "1000")),
        campoForm("Margem do intervalo (%)", entrada("margem_intervalo_pct", campo(config, "margem_intervalo_pct"), "100", "0.1"), "Estimativa = total ± esta margem"),
        campoForm("Deslocação — valor fixo (€, c/ IVA)", entrada("deslocacao_iva", campo(config, "deslocacao_iva"), "10000"), "Mínimo de cada deslocação")),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Deslocação por distância" }),
        h("p", { class: "ajuda", text: "Distância estimada desde a base: linha reta entre as sedes dos concelhos × 1,3 (estradas). Deslocação = valor fixo + preço por km acima dos km grátis. Acima da distância máxima (ou entre o continente e as ilhas, ou noutra ilha) o simulador mostra \"fora da área servida — contacte-nos\"." }),
        h("div", { class: "duas" },
          campoForm("Base (concelho)", escolha("deslocacao_base", Object.fromEntries(CONCELHOS.map((c) => [c[0], `${c[0]} (${c[1]})`])), String(campo(config, "deslocacao_base") ?? "Lisboa"), { required: true })),
          campoForm("Km grátis", entrada("deslocacao_km_gratis", campo(config, "deslocacao_km_gratis"), "1000", "1"))),
        h("div", { class: "duas" },
          campoForm("Preço por km (€, c/ IVA)", entrada("deslocacao_preco_km_iva", campo(config, "deslocacao_preco_km_iva"), "100")),
          campoForm("Distância máxima servida (km)", entrada("deslocacao_max_km", campo(config, "deslocacao_max_km"), "2000", "1")))),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar configuração" })), msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const corpo = {};
      for (const [k, max, rot] of [["tarifa_hora_iva", 1000, "A tarifa por hora"], ["margem_intervalo_pct", 100, "A margem do intervalo"], ["deslocacao_iva", 10000, "O valor fixo da deslocação"],
        ["deslocacao_km_gratis", 1000, "O n.º de km grátis"], ["deslocacao_preco_km_iva", 100, "O preço por km"], ["deslocacao_max_km", 2000, "A distância máxima"]]) {
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
      h("thead", {}, h("tr", {}, ...["Artigo", "Categoria", "Compra", "Venda c/ IVA", "Margem", "Horas", "Estado", ""].map((t, i) =>
        h("th", { scope: "col", class: [2, 3, 5].includes(i) ? "num" : "", text: t }, i === 7 ? h("span", { class: "so-leitor", text: "Ações" }) : null)))),
      h("tbody", {}, ...vis.map(linha))));
  }

  function linha(a) {
    const id = String(campo(a, "id"));
    const m = margem(campo(a, "preco_venda_iva"), campo(a, "preco_compra"));
    const ativo = campo(a, "ativo") !== false, visivel = campo(a, "visivel_cliente") !== false;
    const nota = campo(a, "especificacoes")?.nota, provisorio = typeof nota === "string" && /preço provisório/i.test(nota);
    return h("tr", { dataset: { id, sku: String(campo(a, "sku") ?? "") }, class: `${ativo ? "" : "inativo"} ${m.aviso ? `margem-${m.aviso}` : ""}`.trim() },
      h("td", { "data-rotulo": "Artigo" }, h("div", {}, h("strong", { class: "bloco-ajuda", text: String(campo(a, "nome") ?? "—") }), h("span", { class: "ajuda bloco-ajuda", text: [campo(a, "sku"), campo(a, "fornecedor")].filter(Boolean).join(" · ") }))),
      h("td", { "data-rotulo": "Categoria", text: CATEGORIAS[campo(a, "categoria")] ?? String(campo(a, "categoria") ?? "—") }),
      h("td", { class: "num", "data-rotulo": "Compra", text: euros(campo(a, "preco_compra")) }),
      h("td", { class: "num", "data-rotulo": "Venda c/ IVA", text: euros(campo(a, "preco_venda_iva")) }),
      h("td", { class: "celula-margem", "data-rotulo": "Margem" }, h("span", { class: "linha-selos" }, ...celulaMargem(m))),
      h("td", { class: "num", "data-rotulo": "Horas", text: horas(campo(a, "horas_instalacao")) }),
      h("td", { "data-rotulo": "Estado" }, h("span", { class: "linha-selos" }, ativo ? selo("Ativo", "orc-aceite") : selo("Inativo", "obra-cancelada"), visivel ? null : selo("Escondido do cliente", "aviso"), provisorio ? selo("Preço provisório", "aviso") : null)),
      h("td", { class: "acoes" }, h("button", { class: "btn sec pequeno", type: "button", text: "Editar", "aria-label": `Editar ${campo(a, "nome") ?? campo(a, "sku")}`, onclick: () => abrirArtigo(a) })));
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
    const f = h("form", { class: "form-grelha", id: "form-artigo", novalidate: true },
      h("div", { class: "duas" },
        campoForm("SKU", inp("sku", { required: true, maxlength: "40", autocapitalize: "characters", spellcheck: "false" }), "Maiúsculas, números, \".\", \"_\" e \"-\""),
        campoForm("Categoria", categoria)),
      campoForm("Nome", inp("nome", { required: true, maxlength: "160" })),
      h("div", { class: "duas" },
        campoForm("Fornecedor", inp("fornecedor", { maxlength: "160" })),
        campoForm("Link (página do fornecedor)", inp("link", { type: "url", maxlength: "500", inputmode: "url", placeholder: "https://…", spellcheck: "false" }), "Só https://. Nunca aparece ao cliente.")),
      linkAtual,
      h("div", { class: "tres" },
        campoForm("Preço de compra (€)", inp("preco_compra", { type: "number", min: "0", step: "0.01", inputmode: "decimal" }), "Vazio = desconhecido"),
        campoForm("Preço de venda (€, c/ IVA)", inp("preco_venda_iva", { type: "number", min: "0", step: "0.01", inputmode: "decimal", required: true })),
        campoForm("Horas de instalação", h("input", { name: "horas_instalacao", type: "number", min: "0", max: "100", step: "0.05", inputmode: "decimal", value: campo(a, "horas_instalacao") ?? 0 }))),
      // Lote 7 (simulador, ação "Substituir"): as horas de trocar um aparelho que já existe.
      campoForm("Horas de troca (substituir)", h("input", { name: "horas_troca", type: "number", min: "0", max: "100", step: "0.05", inputmode: "decimal", value: campo(a, "horas_troca") ?? "" }), "Vazio = 50 % das horas de instalação."),
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
        m.aviso === "sem_compra" ? h("span", { class: "margem-aviso", text: "Sem preço de compra: não dá para saber a margem." })
          : m.aviso === "baixa" ? h("span", { class: "margem-aviso", text: `Margem abaixo de ${MARGEM_MINIMA} %: confirme o preço de venda.` }) : null);
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
      const especificacoes = lerJson();
      if (especificacoes === null) { f.querySelector("details.esp-json").open = true; return erro("As especificações têm de ser um objeto JSON válido.", json); }
      const tudo = {
        sku, nome, categoria: categoria.value, fornecedor: el2.fornecedor.value.trim() || null, link: link || null,
        preco_compra: compra, preco_venda_iva: venda, horas_instalacao: horas, horas_troca: horasTroca, especificacoes,
        ativo: el2.ativo.checked, visivel_cliente: el2.visivel_cliente.checked,
      };
      // Editar: só o que mudou.
      let corpo = tudo;
      if (a) {
        corpo = {};
        for (const [k, val] of Object.entries(tudo)) {
          const antes = campo(a, k) ?? null;
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
