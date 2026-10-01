// Desenho do quadro elétrico do cliente (passo "Quadro elétrico", painel da direita): o geral, os diferenciais, os
// disjuntores e os módulos livres num calha DIN de 12 módulos por fila, a partir da leitura (quadro.js leituraDaFoto /
// leituraVazia). Cada componente é um botão (toque ou Enter/Espaço → `aoTocar(tipo, i)`) para o cliente corrigir.
// Só textContent; cores pelas classes .qd-* do simulador.css (tema claro e escuro; sem style inline, por causa da CSP).

import { MODULOS_LEITURA } from "./quadro.js";

const NS = "http://www.w3.org/2000/svg";
const M = 26;              // largura de um módulo
const POR_FILA = 12;       // módulos por fila
const MARGEM = 14;
const TOPO = 12;
const FILA = 108;          // altura de uma fila
const ALTO = 78;           // altura de um componente
const MAX_LIVRES = 24;     // módulos livres desenhados (os outros só no texto)

const svgEl = (tag, attrs = {}, texto = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (texto !== null) e.textContent = texto;
  return e;
};
const aTxt = (a) => (a ? `${a} A` : "? A");

/** Nome acessível de um componente ("Disjuntor 3: 16 A"). */
export function nomeComponente(l, tipo, i) {
  if (tipo === "geral") return `Disjuntor geral: ${l.disjuntor_geral?.amperes ? `${l.disjuntor_geral.amperes} A` : "amperes por saber"}`;
  if (tipo === "diferencial") {
    const d = l.diferenciais[i];
    return `Diferencial ${i + 1}: ${d.sensibilidade_ma ? `${d.sensibilidade_ma} mA` : "mA por saber"}, ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
  }
  const d = l.disjuntores[i];
  return `Disjuntor ${i + 1}: ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
}

/**
 * Desenha a leitura `l` (ou o quadro vazio com `vazio`, sem leitura) num <svg> novo e devolve-o.
 * @param {object|null} l
 * @param {{selecionado?: {tipo: string, i: number}|null, aoTocar?: Function, vazio?: string, resumo?: string}} o
 */
export function desenharQuadroCliente(l, { selecionado = null, aoTocar = null, vazio = "", resumo = "" } = {}) {
  const itens = [];
  if (l?.disjuntor_geral) itens.push({ tipo: "geral", i: 0, mods: MODULOS_LEITURA.geral });
  (l?.diferenciais ?? []).forEach((_, i) => itens.push({ tipo: "diferencial", i, mods: MODULOS_LEITURA.diferencial }));
  (l?.disjuntores ?? []).forEach((_, i) => itens.push({ tipo: "disjuntor", i, mods: MODULOS_LEITURA.disjuntor }));
  const livres = Math.min(MAX_LIVRES, l?.modulos_livres ?? 0);
  for (let k = 0; k < livres; k++) itens.push({ tipo: "livre", i: k, mods: 1 });
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
  const svg = svgEl("svg", { viewBox: `0 0 ${largura} ${altura}`, class: "qd-svg", role: "group", id: "quadro-desenho-svg", tabindex: "-1" });
  svg.setAttribute("aria-label", `Desenho do seu quadro${resumo ? `: ${resumo}` : ""}`);
  svg.append(svgEl("rect", { x: 2, y: 2, width: largura - 4, height: altura - 4, rx: 12, class: "qd-caixa" }));
  for (let f = 0; f < filas; f++) {
    const y = TOPO + f * FILA;
    svg.append(svgEl("rect", { x: MARGEM - 6, y: y + FILA / 2 - 22, width: POR_FILA * M + 12, height: 10, rx: 2, class: "qd-calha" }));
  }
  if (!itens.length && vazio) {
    const t = svgEl("text", { x: largura / 2, y: TOPO + FILA / 2 + 22, class: "qd-vazio", "text-anchor": "middle" }, vazio);
    svg.append(t);
  }
  const grupoLivres = svgEl("g", { class: "qd-livres" });
  if (livres) {
    grupoLivres.setAttribute("role", "img");
    grupoLivres.setAttribute("aria-label", `${l.modulos_livres} ${l.modulos_livres === 1 ? "módulo livre" : "módulos livres"}`);
    svg.append(grupoLivres);
  }
  for (const it of itens) {
    const x = MARGEM + it.col * M + 1;
    const y = TOPO + it.fila * FILA + (FILA - ALTO) / 2 - 6;
    const w = it.mods * M - 2;
    if (it.tipo === "livre") {
      grupoLivres.append(svgEl("rect", { x: x + 2, y: y + 6, width: w - 4, height: ALTO - 12, rx: 3, class: "qd-livre" }));
      continue;
    }
    const sel = selecionado && selecionado.tipo === it.tipo && selecionado.i === it.i;
    const g = svgEl("g", { class: `qd-item qd-${it.tipo}${sel ? " sel" : ""}`, tabindex: "0", role: "button" });
    g.setAttribute("aria-label", `${nomeComponente(l, it.tipo, it.i)}. Mudar ou apagar.`);
    if (sel) g.setAttribute("aria-pressed", "true");
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
    if (aoTocar) {
      g.addEventListener("click", () => aoTocar(it.tipo, it.i));
      g.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        aoTocar(it.tipo, it.i);
      });
    }
    svg.append(g);
  }
  if ((l?.modulos_livres ?? 0) > MAX_LIVRES) {
    svg.append(svgEl("text", { x: largura - MARGEM, y: altura - 6, "text-anchor": "end", class: "qd-txt mini" }, `+${l.modulos_livres - MAX_LIVRES} livres`));
  }
  return svg;
}
