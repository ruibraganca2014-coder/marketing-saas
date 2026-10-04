// Esquema do quadro elétrico (ronda B, decisão do dono: feito pelo ELETRICISTA no painel, a partir da foto do cliente —
// o simulador já não lê a foto nem desenha o quadro; docs/PAINEL-EMPRESA.md "Esquema do quadro"): o modelo de dados
// (`esquemaVazio`, `normalizarEsquema`; guardado em `orcamentos.esquema_quadro`, validado em painel/src/validar.js
// esquemaQuadro) e o desenho num <svg>: o geral, os diferenciais, os disjuntores e os módulos livres numa calha DIN de
// 12 módulos por fila, pela ordem da calha (`ordem`: como num quadro real, cada um fica onde o eletricista o pôs).
// No editor (painel/public/ecras/orcamentos.js) cada componente, e cada módulo livre, é um botão (toque ou Enter/Espaço →
// `aoTocar(tipo, i)`; nos livres `i` é o n.º do módulo livre); com `soLeitura` é só um desenho (relatório do cliente).
// Só textContent; cores pelas classes .qd-* (painel.css; web/simulador/simulador.css no site; sem style inline, CSP).
// Sem dependências: painel/public/vendor/quadro-desenho.js é uma CÓPIA deste ficheiro (teste esquema-quadro.test.js).

export const ESTADOS_QUADRO = { bom: "Bom", razoavel: "Razoável", antigo: "Antigo", mau: "Mau", nao_se_ve: "Não se vê" };
export const AMPERES_GERAL = [16, 20, 25, 32, 40, 50, 63];
export const AMPERES_DIFERENCIAL = [25, 40, 63];
export const MA_DIFERENCIAL = [30, 300];
export const AMPERES_DISJUNTOR = [6, 10, 16, 20, 25, 32, 40];
export const MAX_ESQUEMA = { disjuntores: 80, diferenciais: 30, modulos_livres: 200, ordem: 150, notas: 300 };
/** Módulos por componente no desenho (como num quadro real: o geral e os diferenciais ocupam 2). */
export const MODULOS_ESQUEMA = { geral: 2, diferencial: 2, disjuntor: 1 };
/**
 * `ordem` = os lugares da calha DIN por ordem — "geral", "diferencial:i", "disjuntor:i" e um "livre" por módulo livre
 * (até MAX_LIVRES_ORDEM; os outros só contam em `modulos_livres`). Assim um disjuntor junto depois dos módulos livres
 * fica depois deles.
 */
export const MAX_LIVRES_ORDEM = 24;
export const LUGAR_ORDEM = /^(geral|diferencial:\d{1,2}|disjuntor:\d{1,2}|livre)$/;

/** Esquema vazio (o eletricista começa do zero). */
export const esquemaVazio = () => ({
  disjuntor_geral: null, diferenciais: [], disjuntores: [], modulos_livres: null, estado: null, fusiveis: null,
  sinais_aquecimento: null, notas: "", ordem: [],
});

const numOuNull = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const boolOuNull = (v) => (typeof v === "boolean" ? v : null);
const semControlo = (s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_ESQUEMA.notas);

/**
 * A ordem na calha do esquema `l` (já com as listas normalizadas) a partir de `v` (gravada, ou ausente): só lugares que
 * existem, sem repetidos; o que falta junta-se no fim por tipo (geral, diferenciais, disjuntores) e os "livre"
 * acertam-se por `modulos_livres` (até MAX_LIVRES_ORDEM).
 */
export function normalizarOrdem(v, l) {
  const alvo = Math.min(MAX_LIVRES_ORDEM, l.modulos_livres ?? 0);
  const vistos = new Set();
  const ordem = [];
  let livres = 0;
  const existe = (t) => {
    if (t === "geral") return !!l.disjuntor_geral;
    const [tipo, i] = t.split(":");
    return Number(i) < (tipo === "diferencial" ? l.diferenciais : l.disjuntores).length;
  };
  for (const t of Array.isArray(v) ? v : []) {
    if (typeof t !== "string" || !LUGAR_ORDEM.test(t)) continue;
    if (t === "livre") { if (livres < alvo) { livres++; ordem.push(t); } continue; }
    if (vistos.has(t) || !existe(t)) continue;
    vistos.add(t);
    ordem.push(t);
  }
  if (l.disjuntor_geral && !vistos.has("geral")) ordem.push("geral");
  l.diferenciais.forEach((_, i) => { if (!vistos.has(`diferencial:${i}`)) ordem.push(`diferencial:${i}`); });
  l.disjuntores.forEach((_, i) => { if (!vistos.has(`disjuntor:${i}`)) ordem.push(`disjuntor:${i}`); });
  for (; livres < alvo; livres++) ordem.push("livre");
  return ordem;
}

/** Esquema gravado (ou por gravar) com os limites do servidor; null se não há. */
export function normalizarEsquema(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const l = esquemaVazio();
  const g = v.disjuntor_geral;
  l.disjuntor_geral = g && typeof g === "object" && !Array.isArray(g) ? { amperes: numOuNull(g.amperes, 1, 1000) } : null;
  l.diferenciais = (Array.isArray(v.diferenciais) ? v.diferenciais : []).slice(0, MAX_ESQUEMA.diferenciais)
    .map((d) => ({ sensibilidade_ma: numOuNull(d?.sensibilidade_ma, 1, 3000), amperes: numOuNull(d?.amperes, 1, 1000) }));
  l.disjuntores = (Array.isArray(v.disjuntores) ? v.disjuntores : []).slice(0, MAX_ESQUEMA.disjuntores).map((d) => ({ amperes: numOuNull(d?.amperes, 1, 1000) }));
  l.modulos_livres = Number.isInteger(v.modulos_livres) ? Math.min(MAX_ESQUEMA.modulos_livres, Math.max(0, v.modulos_livres)) : null;
  l.estado = ESTADOS_QUADRO[v.estado] ? v.estado : null;
  l.fusiveis = boolOuNull(v.fusiveis);
  l.sinais_aquecimento = boolOuNull(v.sinais_aquecimento);
  l.notas = typeof v.notas === "string" ? semControlo(v.notas) : "";
  l.ordem = normalizarOrdem(v.ordem, l);
  return l;
}

/**
 * Rascunho do esquema a partir da leitura automática da foto do quadro (painel/src/leitura-quadro.js; botão "Preencher
 * a partir da foto" do painel): a leitura diz quantos há de cada calibre, não onde estão na calha — a ordem sai a de
 * `normalizarOrdem` (geral, diferenciais, disjuntores, livres). Os disjuntores contados sem calibre lido entram com
 * amperes null. null se a leitura não é de um quadro elétrico.
 */
export function esquemaDaLeitura(v) {
  if (!v || typeof v !== "object" || v.e_quadro_eletrico !== true) return null;
  const vezes = (lista, max, fn) => (Array.isArray(lista) ? lista : []).flatMap((x) => Array(Math.max(0, Math.min(max, Number.isInteger(x?.quantidade) ? x.quantidade : 0))).fill(0).map(() => fn(x)));
  const disjuntores = vezes(v.disjuntores, MAX_ESQUEMA.disjuntores, (d) => ({ amperes: d.amperes ?? null }));
  const total = Number.isInteger(v.disjuntores_total) ? v.disjuntores_total : 0;
  while (disjuntores.length < Math.min(total, MAX_ESQUEMA.disjuntores)) disjuntores.push({ amperes: null });
  return normalizarEsquema({
    disjuntor_geral: v.disjuntor_geral?.visivel === true ? { amperes: v.disjuntor_geral.amperes ?? null } : null,
    diferenciais: vezes(v.diferenciais, MAX_ESQUEMA.diferenciais, (d) => ({ sensibilidade_ma: d.sensibilidade_ma ?? null, amperes: d.amperes ?? null })),
    disjuntores,
    modulos_livres: Number.isInteger(v.modulos_livres_estimados) ? v.modulos_livres_estimados : null,
    estado: v.estado_aparente === "nao_se_ve" ? null : v.estado_aparente,
    fusiveis: v.fusiveis, sinais_aquecimento: v.sinais_aquecimento,
    notas: typeof v.notas === "string" ? v.notas : "",
  });
}

/** O esquema tem algum componente (senão o desenho mostra só o quadro vazio)? */
export const esquemaTemAlgo = (l) => !!l && (!!l.disjuntor_geral || l.diferenciais.length > 0 || l.disjuntores.length > 0);

/** "Geral 40 A · 2 diferenciais · 9 disjuntores · 3 livres" (texto curto do esquema). */
export function resumoEsquema(v) {
  const l = normalizarEsquema(v);
  if (!l) return "";
  const pl = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  return [
    l.disjuntor_geral ? `Geral${l.disjuntor_geral.amperes ? ` ${l.disjuntor_geral.amperes} A` : ""}` : null,
    l.diferenciais.length ? pl(l.diferenciais.length, "diferencial", "diferenciais") : null,
    l.disjuntores.length ? pl(l.disjuntores.length, "disjuntor", "disjuntores") : null,
    l.modulos_livres !== null ? pl(l.modulos_livres, "livre", "livres") : null,
  ].filter(Boolean).join(" · ");
}

// ------------------------------------------------------------ desenho

const NS = "http://www.w3.org/2000/svg";
const M = 26;              // largura de um módulo
const POR_FILA = 12;       // módulos por fila
const MARGEM = 14;
const TOPO = 12;
const FILA = 108;          // altura de uma fila
const ALTO = 78;           // altura de um componente

const svgEl = (tag, attrs = {}, texto = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (texto !== null) e.textContent = texto;
  return e;
};
const aTxt = (a) => (a ? `${a} A` : "? A");

/** Nome acessível de um componente ("Disjuntor 3: 16 A"; "Módulo livre 2"). */
export function nomeComponente(l, tipo, i) {
  if (tipo === "livre") return `Módulo livre ${i + 1}`;
  if (tipo === "geral") return `Disjuntor geral: ${l.disjuntor_geral?.amperes ? `${l.disjuntor_geral.amperes} A` : "amperes por saber"}`;
  if (tipo === "diferencial") {
    const d = l.diferenciais[i];
    return `Diferencial ${i + 1}: ${d.sensibilidade_ma ? `${d.sensibilidade_ma} mA` : "mA por saber"}, ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
  }
  const d = l.disjuntores[i];
  return `Disjuntor ${i + 1}: ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
}

/**
 * Desenha o esquema `l` (ou o quadro vazio com `vazio`, sem esquema) num <svg> novo e devolve-o.
 * @param {object|null} l
 * @param {{selecionado?: {tipo: string, i: number}|null, aoTocar?: Function, vazio?: string, resumo?: string, soLeitura?: boolean}} o
 */
export function desenharQuadroCliente(l, { selecionado = null, aoTocar = null, vazio = "", resumo = "", soLeitura = false } = {}) {
  // Pela ordem da calha (um esquema sem `ordem` fica por tipo: normalizarOrdem).
  const ordem = Array.isArray(l?.ordem) ? l.ordem : (normalizarEsquema(l)?.ordem ?? []);
  const itens = [];
  let livres = 0;
  for (const t of ordem) {
    if (t === "livre") { itens.push({ tipo: "livre", i: livres++, mods: 1 }); continue; }
    const [tipo, i] = t.split(":");
    itens.push({ tipo, i: Number(i) || 0, mods: MODULOS_ESQUEMA[tipo] });
  }
  // Filas: cada componente inteiro numa fila (um de 2 módulos que não cabe passa à seguinte).
  let fila = 0, col = 0;
  for (const it of itens) {
    if (col + it.mods > POR_FILA) { fila++; col = 0; }
    it.fila = fila;
    it.col = col;
    col += it.mods;
  }
  const filas = Math.max(1, fila + 1);
  const largura = POR_FILA * M + 2 * MARGEM;
  const altura = TOPO + filas * FILA + MARGEM;
  const svg = svgEl("svg", { viewBox: `0 0 ${largura} ${altura}`, class: "qd-svg", role: soLeitura ? "img" : "group", id: "quadro-desenho-svg", tabindex: "-1" });
  svg.setAttribute("aria-label", `${soLeitura ? "Esquema do quadro" : "Desenho do quadro"}${resumo ? `: ${resumo}` : ""}`);
  svg.append(svgEl("rect", { x: 2, y: 2, width: largura - 4, height: altura - 4, rx: 12, class: "qd-caixa" }));
  for (let f = 0; f < filas; f++) {
    const y = TOPO + f * FILA;
    svg.append(svgEl("rect", { x: MARGEM - 6, y: y + FILA / 2 - 22, width: POR_FILA * M + 12, height: 10, rx: 2, class: "qd-calha" }));
  }
  if (!itens.length && vazio) {
    const t = svgEl("text", { x: largura / 2, y: TOPO + FILA / 2 + 22, class: "qd-vazio", "text-anchor": "middle" }, vazio);
    svg.append(t);
  }
  for (const it of itens) {
    const x = MARGEM + it.col * M + 1;
    const y = TOPO + it.fila * FILA + (FILA - ALTO) / 2 - 6;
    const w = it.mods * M - 2;
    const sel = !soLeitura && selecionado && selecionado.tipo === it.tipo && selecionado.i === it.i;
    const g = svgEl("g", { class: `qd-item qd-${it.tipo}${sel ? " sel" : ""}` });
    if (!soLeitura) { g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); }
    if (sel) g.setAttribute("aria-pressed", "true");
    if (it.tipo === "livre") {
      // Módulo livre, onde está: tocar deixa pôr aqui um disjuntor ou diferencial, ou apagá-lo.
      if (!soLeitura) g.setAttribute("aria-label", `${nomeComponente(l, "livre", it.i)} de ${livres}. Pôr aqui um disjuntor ou diferencial, ou apagar.`);
      g.append(svgEl("rect", { x, y, width: w, height: ALTO, rx: 4, class: "qd-livre-fundo" }));
      g.append(svgEl("rect", { x: x + 2, y: y + 6, width: w - 4, height: ALTO - 12, rx: 3, class: "qd-livre" }));
    } else {
      if (!soLeitura) g.setAttribute("aria-label", `${nomeComponente(l, it.tipo, it.i)}. Mudar ou apagar.`);
      g.append(svgEl("rect", { x, y, width: w, height: ALTO, rx: 4, class: "qd-corpo" }));
      // Alavanca (em cima, ao meio) e, nos diferenciais, o botão de teste "T".
      const la = Math.min(12, w - 10);
      g.append(svgEl("rect", { x: x + (w - la) / 2, y: y + 8, width: la, height: 18, rx: 2, class: "qd-alavanca" }));
      if (it.tipo === "diferencial") {
        const d = l.diferenciais[it.i];
        g.append(svgEl("circle", { cx: x + w - 9, cy: y + 36, r: 5, class: "qd-teste" }));
        g.append(svgEl("text", { x: x + w - 9, y: y + 39, "text-anchor": "middle", class: "qd-teste-t" }, "T"));
        g.append(svgEl("text", { x: x + w / 2 - 4, y: y + 55, "text-anchor": "middle", class: "qd-txt" }, d.sensibilidade_ma ? `${d.sensibilidade_ma}mA` : "? mA"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 70, "text-anchor": "middle", class: "qd-txt forte" }, aTxt(d.amperes).replace(" ", "")));
      } else if (it.tipo === "geral") {
        g.append(svgEl("text", { x: x + w / 2, y: y + 48, "text-anchor": "middle", class: "qd-txt" }, "Geral"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 66, "text-anchor": "middle", class: "qd-txt forte" }, aTxt(l.disjuntor_geral.amperes).replace(" ", "")));
      } else {
        const d = l.disjuntores[it.i];
        g.append(svgEl("text", { x: x + w / 2, y: y + 62, "text-anchor": "middle", class: "qd-txt forte" }, d.amperes ? String(d.amperes) : "?"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 73, "text-anchor": "middle", class: "qd-txt mini" }, "A"));
      }
    }
    if (aoTocar && !soLeitura) {
      g.addEventListener("click", () => aoTocar(it.tipo, it.i));
      g.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        aoTocar(it.tipo, it.i);
      });
    }
    svg.append(g);
  }
  // Módulos livres a mais do que os desenhados (MAX_LIVRES_ORDEM): só no texto.
  if ((l?.modulos_livres ?? 0) > livres) {
    svg.append(svgEl("text", { x: largura - MARGEM, y: altura - 6, "text-anchor": "end", class: "qd-txt mini" }, `+${l.modulos_livres - livres} livres`));
  }
  return svg;
}

/**
 * O esquema só para ver (relatório pormenorizado do cliente, web/conta.js; relatório técnico do painel): o <svg> sem
 * botões, com o resumo no nome acessível; null sem esquema ou sem nada desenhado.
 */
export function desenharEsquemaQuadro(v) {
  const l = normalizarEsquema(v);
  if (!l || !l.ordem.length) return null;
  const svg = desenharQuadroCliente(l, { soLeitura: true, resumo: resumoEsquema(l) });
  svg.removeAttribute("id");
  svg.removeAttribute("tabindex");
  return svg;
}
