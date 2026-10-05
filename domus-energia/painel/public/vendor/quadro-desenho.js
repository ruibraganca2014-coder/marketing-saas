// Esquema do quadro elétrico (ronda B, decisão do dono: feito pelo ELETRICISTA no painel, a partir da foto do cliente —
// o simulador já não lê a foto nem desenha o quadro; docs/PAINEL-EMPRESA.md "Esquema do quadro"): o modelo de dados
// (`esquemaVazio`, `normalizarEsquema`; guardado em `orcamentos.esquema_quadro`, validado em painel/src/validar.js
// esquemaQuadro) e o desenho num <svg>: o geral, os diferenciais, os disjuntores e os módulos livres numa calha DIN de
// 12 módulos por fila, pela ordem da calha (`ordem`: como num quadro real, cada um fica onde o eletricista o pôs).
// Proteção completa (decisão do dono, 2026-10-05): `protecoes` (descarregador, relé de tensão, medidor geral) são peças
// de 2 módulos na calha; um disjuntor com `afdd: true` ocupa 2 módulos; o geral com `wifi: true` leva a marca Wi-Fi.
// Só no desenho (não se gravam; o quadro ideal de relatorio-casa.js traz-os): `etiquetas` = uma por disjuntor,
// {texto, cor} — o nome do circuito na vertical por baixo e uma risca da cor do tipo (luz, tomadas, humida, maquina);
// `fila_por_diferencial` = cada diferencial começa uma fila com os seus disjuntores, e os módulos livres outra.
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
export const MODULOS_ESQUEMA = { geral: 2, diferencial: 2, disjuntor: 1, afdd: 2, descarregador: 2, rele_tensao: 2, medidor_geral: 2 };
/** Proteções que são uma peça só na calha (no máximo uma de cada): a chave é também o lugar em `ordem`. */
export const PROTECOES_ESQUEMA = {
  descarregador: { nome: "Descarregador de sobretensões", linhas: ["Desc.", "sobret."] },
  rele_tensao: { nome: "Proteção de sobretensão e subtensão", linhas: ["Relé", "tensão"] },
  medidor_geral: { nome: "Medidor de energia geral", linhas: ["Medidor", "kWh"] },
};
export const CHAVES_PROTECOES_ESQUEMA = Object.keys(PROTECOES_ESQUEMA);
/**
 * `ordem` = os lugares da calha DIN por ordem — "geral", as proteções, "diferencial:i", "disjuntor:i" e um "livre" por módulo livre
 * (até MAX_LIVRES_ORDEM; os outros só contam em `modulos_livres`). Assim um disjuntor junto depois dos módulos livres
 * fica depois deles.
 */
export const MAX_LIVRES_ORDEM = 24;
export const LUGAR_ORDEM = /^(geral|descarregador|rele_tensao|medidor_geral|diferencial:\d{1,2}|disjuntor:\d{1,2}|livre)$/;

/** Esquema vazio (o eletricista começa do zero). */
export const esquemaVazio = () => ({
  disjuntor_geral: null, diferenciais: [], disjuntores: [], modulos_livres: null, estado: null, fusiveis: null,
  sinais_aquecimento: null, notas: "", protecoes: [], ordem: [],
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
    if (PROTECOES_ESQUEMA[t]) return (l.protecoes ?? []).includes(t);
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
  for (const p of l.protecoes ?? []) if (!vistos.has(p)) ordem.push(p);
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
  l.disjuntor_geral = g && typeof g === "object" && !Array.isArray(g) ? { amperes: numOuNull(g.amperes, 1, 1000), ...(g.wifi === true ? { wifi: true } : {}) } : null;
  l.diferenciais = (Array.isArray(v.diferenciais) ? v.diferenciais : []).slice(0, MAX_ESQUEMA.diferenciais)
    .map((d) => ({ sensibilidade_ma: numOuNull(d?.sensibilidade_ma, 1, 3000), amperes: numOuNull(d?.amperes, 1, 1000) }));
  l.disjuntores = (Array.isArray(v.disjuntores) ? v.disjuntores : []).slice(0, MAX_ESQUEMA.disjuntores).map((d) => ({ amperes: numOuNull(d?.amperes, 1, 1000), ...(d?.afdd === true ? { afdd: true } : {}) }));
  l.protecoes = CHAVES_PROTECOES_ESQUEMA.filter((k) => Array.isArray(v.protecoes) && v.protecoes.includes(k));
  l.modulos_livres = Number.isInteger(v.modulos_livres) ? Math.min(MAX_ESQUEMA.modulos_livres, Math.max(0, v.modulos_livres)) : null;
  l.estado = ESTADOS_QUADRO[v.estado] ? v.estado : null;
  l.fusiveis = boolOuNull(v.fusiveis);
  l.sinais_aquecimento = boolOuNull(v.sinais_aquecimento);
  l.notas = typeof v.notas === "string" ? semControlo(v.notas) : "";
  l.ordem = normalizarOrdem(v.ordem, l);
  return l;
}

/** O esquema tem algum componente (senão o desenho mostra só o quadro vazio)? */
export const esquemaTemAlgo = (l) => !!l && (!!l.disjuntor_geral || l.diferenciais.length > 0 || l.disjuntores.length > 0 || (l.protecoes ?? []).length > 0);

/** "Geral 40 A · 2 diferenciais · 9 disjuntores · 3 livres" (texto curto do esquema). */
export function resumoEsquema(v) {
  const l = normalizarEsquema(v);
  if (!l) return "";
  const pl = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  return [
    l.disjuntor_geral ? `Geral${l.disjuntor_geral.amperes ? ` ${l.disjuntor_geral.amperes} A` : ""}` : null,
    l.diferenciais.length ? pl(l.diferenciais.length, "diferencial", "diferenciais") : null,
    l.disjuntores.length ? pl(l.disjuntores.length, "disjuntor", "disjuntores") : null,
    l.protecoes.length ? pl(l.protecoes.length, "proteção", "proteções") : null,
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
const LETRA_ETIQUETA = 4.9; // altura por letra da etiqueta (na vertical) por baixo de um disjuntor
export const CORES_CIRCUITO = { luz: "Iluminação", tomadas: "Tomadas", humida: "Tomadas de zonas húmidas", maquina: "Máquinas grandes" };

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
  if (PROTECOES_ESQUEMA[tipo]) return PROTECOES_ESQUEMA[tipo].nome;
  if (tipo === "geral") return `Disjuntor geral${l.disjuntor_geral?.wifi ? " Wi-Fi" : ""}: ${l.disjuntor_geral?.amperes ? `${l.disjuntor_geral.amperes} A` : "amperes por saber"}`;
  if (tipo === "diferencial") {
    const d = l.diferenciais[i];
    return `Diferencial ${i + 1}: ${d.sensibilidade_ma ? `${d.sensibilidade_ma} mA` : "mA por saber"}, ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
  }
  const d = l.disjuntores[i];
  return `Disjuntor ${i + 1}${d.afdd ? " com AFDD" : ""}: ${d.amperes ? `${d.amperes} A` : "amperes por saber"}`;
}

/**
 * Desenha o esquema `l` (ou o quadro vazio com `vazio`, sem esquema) num <svg> novo e devolve-o.
 * @param {object|null} l
 * @param {{selecionado?: {tipo: string, i: number}|null, aoTocar?: Function, vazio?: string, resumo?: string, soLeitura?: boolean}} o
 */
export function desenharQuadroCliente(l, { selecionado = null, aoTocar = null, vazio = "", resumo = "", soLeitura = false } = {}) {
  const etiquetas = Array.isArray(l?.etiquetas) && l.etiquetas.some(Boolean) ? l.etiquetas : null;
  const porDiferencial = l?.fila_por_diferencial === true;
  // Pela ordem da calha (um esquema sem `ordem` fica por tipo: normalizarOrdem).
  const ordem = Array.isArray(l?.ordem) ? l.ordem : (normalizarEsquema(l)?.ordem ?? []);
  const itens = [];
  let livres = 0;
  for (const t of ordem) {
    if (t === "livre") { itens.push({ tipo: "livre", i: livres++, mods: 1 }); continue; }
    const [tipo, i] = t.split(":");
    itens.push({ tipo, i: Number(i) || 0, mods: tipo === "disjuntor" && l.disjuntores[Number(i)]?.afdd ? MODULOS_ESQUEMA.afdd : MODULOS_ESQUEMA[tipo] });
  }
  // Filas: cada componente inteiro numa fila (um de 2 módulos que não cabe passa à seguinte).
  let fila = 0, col = 0;
  let livreVisto = false;
  for (const it of itens) {
    // Uma fila por diferencial: o diferencial abre a fila dos seus disjuntores; os módulos livres ficam noutra.
    const abre = porDiferencial && col > 0 && (it.tipo === "diferencial" || (it.tipo === "livre" && !livreVisto));
    if (it.tipo === "livre") livreVisto = true;
    if (abre || col + it.mods > POR_FILA) { fila++; col = 0; }
    it.fila = fila;
    it.col = col;
    col += it.mods;
  }
  const filas = Math.max(1, fila + 1);
  // Cada fila tem a altura das suas etiquetas (a fila do geral e a dos módulos livres não levam nenhuma).
  const topoFila = [];
  for (let f = 0, y = TOPO; f < filas; f++) {
    topoFila.push(y);
    const maior = Math.max(0, ...itens.filter((it) => it.fila === f && it.tipo === "disjuntor").map((it) => etiquetas?.[it.i]?.texto?.length ?? 0));
    y += FILA + (maior ? Math.ceil(maior * LETRA_ETIQUETA) + 2 : 0);
    if (f === filas - 1) topoFila.push(y);
  }
  const largura = POR_FILA * M + 2 * MARGEM;
  const altura = topoFila[filas] + MARGEM;
  const svg = svgEl("svg", { viewBox: `0 0 ${largura} ${altura}`, class: "qd-svg", role: soLeitura ? "img" : "group", id: "quadro-desenho-svg", tabindex: "-1" });
  svg.setAttribute("aria-label", `${soLeitura ? "Esquema do quadro" : "Desenho do quadro"}${resumo ? `: ${resumo}` : ""}`);
  svg.append(svgEl("rect", { x: 2, y: 2, width: largura - 4, height: altura - 4, rx: 12, class: "qd-caixa" }));
  for (let f = 0; f < filas; f++) {
    const y = topoFila[f];
    svg.append(svgEl("rect", { x: MARGEM - 6, y: y + FILA / 2 - 22, width: POR_FILA * M + 12, height: 10, rx: 2, class: "qd-calha" }));
  }
  if (!itens.length && vazio) {
    const t = svgEl("text", { x: largura / 2, y: TOPO + FILA / 2 + 22, class: "qd-vazio", "text-anchor": "middle" }, vazio);
    svg.append(t);
  }
  for (const it of itens) {
    const x = MARGEM + it.col * M + 1;
    const y = topoFila[it.fila] + (FILA - ALTO) / 2 - 6;
    const w = it.mods * M - 2;
    const sel = !soLeitura && selecionado && selecionado.tipo === it.tipo && selecionado.i === it.i;
    const g = svgEl("g", { class: `qd-item qd-${it.tipo}${PROTECOES_ESQUEMA[it.tipo] ? " qd-protecao" : ""}${sel ? " sel" : ""}` });
    if (!soLeitura) { g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); }
    if (sel) g.setAttribute("aria-pressed", "true");
    if (it.tipo === "livre") {
      // Módulo livre, onde está: tocar deixa pôr aqui um disjuntor ou diferencial, ou apagá-lo.
      if (!soLeitura) g.setAttribute("aria-label", `${nomeComponente(l, "livre", it.i)} de ${livres}. Pôr aqui um disjuntor ou diferencial, ou apagar.`);
      g.append(svgEl("rect", { x, y, width: w, height: ALTO, rx: 4, class: "qd-livre-fundo" }));
      g.append(svgEl("rect", { x: x + 2, y: y + 6, width: w - 4, height: ALTO - 12, rx: 3, class: "qd-livre" }));
    } else if (PROTECOES_ESQUEMA[it.tipo]) {
      // Proteção (descarregador, relé de tensão, medidor): uma peça de 2 módulos sem alavanca, com o nome em duas linhas.
      if (!soLeitura) g.setAttribute("aria-label", `${nomeComponente(l, it.tipo, it.i)}.`);
      const [a, b] = PROTECOES_ESQUEMA[it.tipo].linhas;
      g.append(svgEl("rect", { x, y, width: w, height: ALTO, rx: 4, class: "qd-corpo" }));
      g.append(svgEl("rect", { x: x + 8, y: y + 10, width: w - 16, height: 14, rx: 2, class: "qd-visor" }));
      g.append(svgEl("text", { x: x + w / 2, y: y + 48, "text-anchor": "middle", class: "qd-txt" }, a));
      g.append(svgEl("text", { x: x + w / 2, y: y + 62, "text-anchor": "middle", class: "qd-txt" }, b));
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
        if (l.disjuntor_geral.wifi) g.append(svgEl("text", { x: x + w / 2, y: y + 36, "text-anchor": "middle", class: "qd-txt mini" }, "Wi-Fi"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 48, "text-anchor": "middle", class: "qd-txt" }, "Geral"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 66, "text-anchor": "middle", class: "qd-txt forte" }, aTxt(l.disjuntor_geral.amperes).replace(" ", "")));
      } else {
        const d = l.disjuntores[it.i];
        if (d.afdd) g.append(svgEl("text", { x: x + w / 2, y: y + 44, "text-anchor": "middle", class: "qd-txt" }, "AFDD"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 62, "text-anchor": "middle", class: "qd-txt forte" }, d.amperes ? String(d.amperes) : "?"));
        g.append(svgEl("text", { x: x + w / 2, y: y + 73, "text-anchor": "middle", class: "qd-txt mini" }, "A"));
        const et = etiquetas?.[it.i];
        if (et?.cor && CORES_CIRCUITO[et.cor]) g.append(svgEl("rect", { x: x + 1.5, y: y + ALTO - 4.5, width: w - 3, height: 3.5, rx: 1.5, class: `qd-cor qd-cor-${et.cor}` }));
        if (et?.texto) {
          // O nome do circuito na vertical, por baixo (lê-se de baixo para cima, como numa etiqueta de quadro).
          const cx = x + w / 2 + 3, cy = y + ALTO + 5;
          g.append(svgEl("text", { x: cx, y: cy, "text-anchor": "end", transform: `rotate(-90 ${cx} ${cy})`, class: "qd-txt qd-etiqueta" }, et.texto));
        }
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
