// Simbologia normalizada do RELATÓRIO PORMENORIZADO (docs/PAGAMENTOS-PEDIDO.md "Relatório pormenorizado — conteúdo
// técnico"): a planta técnica de cada piso (esquema arquitetural com símbolos de traço, sem traçado de fios), a legenda,
// o esquema funcional de cada tipo de comando da iluminação (5 desenhos fixos), a lista de ensaios e a secção técnica
// completa (DOM) que a conta do cliente (web/conta.js) e a pré-visualização do painel mostram.
//
// Módulo só com planta-svg.js como dependência (pisos). O painel COPIA-O para painel/public/vendor/simbolos.js (como o
// planta-svg.js): o servidor do painel usa `esquemasDaPlanta` (puro, sem DOM) e o browser do painel o resto.
// Os desenhos e os textos são nossos (feitos de raiz; não são cópias de manuais nem de normas). A forma dos símbolos
// segue a ideia geral dos esquemas arquiteturais (ponto de luz = círculo com cruz; tomada = semicírculo com haste;
// comando = círculo com alavanca; botão de pressão = círculo com ponto): a forma exata da norma de símbolos fica a
// confirmar pelo técnico.
//
// Cores: tudo em `currentColor` (o texto do tema) e `var(--superficie)` no papel, com valores de recurso: funciona
// no tema escuro e, na impressão, o CSS força o papel claro.

import { pisoDe, nomePiso, pisosDaPlanta } from "./planta-svg.js";

const NS = "http://www.w3.org/2000/svg";

/** Tipos de comando da iluminação (`props.comando` do interruptor; sem ele, simples). */
export const COMANDOS = {
  simples: { nome: "simples", aparelho: "interruptor simples", titulo: "Interrupção simples", descricao: "Um só sítio comanda a luz." },
  lustre: { nome: "lustre", aparelho: "comutador de lustre", titulo: "Comutação de lustre", descricao: "Um só sítio comanda dois circuitos de luz." },
  escada: { nome: "escada", aparelho: "comutador de escada", titulo: "Comutação de escada", descricao: "Dois sítios comandam a mesma luz." },
  inversor: { nome: "inversor", aparelho: "inversor", titulo: "Comutação de escada com inversor", descricao: "Três ou mais sítios comandam a mesma luz." },
  botao: { nome: "botão de pressão", aparelho: "botão de pressão", titulo: "Botões de pressão com telerruptor", descricao: "Vários botões comandam a luz por um telerruptor." },
};
const COMANDO_OMISSAO = "simples";
/** O comando de um interruptor da planta (valor desconhecido ou em falta → simples). */
export const comandoDe = (props) => (COMANDOS[props?.comando] ? props.comando : COMANDO_OMISSAO);
// Quantas tomadas na mesma caixa (regras.js caixasDe: `caixas` 1–3; pedidos antigos só com `dupla` → 2).
const caixasDe = (p) => { const c = Number(p?.caixas); return c === 2 || c === 3 ? c : p?.dupla ? 2 : 1; };

/** "escada (2 comutadores)", "inversor (4 sítios: 2 comutadores + 2 inversores)", "simples (1 interruptor)"… */
export function descreverComando(comando, n = 1) {
  const c = COMANDOS[comando] ? comando : COMANDO_OMISSAO;
  const k = Math.max(1, Math.round(Number(n) || 1));
  if (c === "escada") return "escada (2 comutadores)";
  if (c === "inversor") { const s = Math.max(3, k); return `inversor (${s} sítios: 2 comutadores + ${s - 2} ${s - 2 === 1 ? "inversor" : "inversores"})`; }
  if (c === "botao") return `botão de pressão (${k} ${k === 1 ? "botão" : "botões"} + telerruptor)`;
  if (c === "lustre") return "lustre (1 comutador de lustre, 2 saídas)";
  return "simples (1 interruptor)";
}

/**
 * Esquema por luz, por divisão, a partir da planta (§2.1): cada ponto de luz leva o tipo de comando da divisão, deduzido
 * dos interruptores que lá estão (sem fios desenhados, decisão do dono): inversor com 3+ comutadores de escada/inversor
 * ou um inversor; escada com 2 (ou um de escada); senão lustre, botão de pressão ou simples. Sem interruptor na
 * divisão: simples, "a confirmar na visita". Devolve [{divisao, nome, piso, interruptores, luzes: [{nome, comando, texto}]}].
 */
export function esquemasDaPlanta(planta) {
  const divisoes = (Array.isArray(planta?.divisoes) ? planta.divisoes : []).slice(0, 40).filter((d) => d && typeof d === "object");
  const elementos = (Array.isArray(planta?.elementos) ? planta.elementos : []).slice(0, 400).filter((e) => e && typeof e === "object");
  const out = [];
  for (const d of divisoes) {
    const meus = elementos.filter((e) => e.divisao === d.id && pisoDe(e) === pisoDe(d));
    const luzes = meus.filter((e) => e.tipo === "luz");
    if (!luzes.length) continue;
    const ints = meus.filter((e) => e.tipo === "interruptor").map((e) => comandoDe(e.props));
    const nEscada = ints.filter((c) => c === "escada" || c === "inversor").length;
    let comando = COMANDO_OMISSAO, n = 1;
    if (ints.includes("inversor") || nEscada >= 3) { comando = "inversor"; n = Math.max(3, nEscada); }
    else if (nEscada === 2 || ints.includes("escada")) { comando = "escada"; n = 2; }
    else if (ints.includes("lustre")) comando = "lustre";
    else if (ints.includes("botao")) { comando = "botao"; n = ints.filter((c) => c === "botao").length; }
    const confirmar = ints.length === 0;
    out.push({
      divisao: d.id, nome: String(d.nome ?? "Divisão").slice(0, 60), piso: pisoDe(d), interruptores: ints.length,
      luzes: luzes.map((e, i) => ({
        nome: typeof e.nome === "string" && e.nome.trim() ? e.nome.trim().slice(0, 60) : `Ponto de luz ${i + 1}`,
        comando, texto: `Comando: ${descreverComando(comando, n)}${confirmar ? " — sem interruptor na planta, a confirmar na visita" : ""}`,
      })),
    });
  }
  return out;
}

// ------------------------------------------------------------------ símbolos (caixa 48 × 48, centro 24,24)
// Cada entrada: lista de [tag, atributos, papel] — "t" traço, "c" cheio (currentColor, meio transparente).
const SIMBOLOS = {
  luz: [["circle", { cx: 24, cy: 24, r: 9 }, "t"], ["path", { d: "M17.6 17.6l12.8 12.8M30.4 17.6L17.6 30.4" }, "t"]],
  // Tomada com terra: a corda do lado da parede (em cima), o semicírculo para a divisão, a haste e o traço do PE.
  tomada: [["path", { d: "M12 18h24M12 18a12 12 0 0 0 24 0M24 30v10M24 18v7" }, "t"]],
  tomada_dupla: [["path", { d: "M12 18h24M12 18a12 12 0 0 0 24 0M24 30v10M24 18v7M19 40h10" }, "t"]],
  tomada_tripla: [["path", { d: "M12 18h24M12 18a12 12 0 0 0 24 0M24 30v10M24 18v7M19 40h10M19 35.5h10" }, "t"]],
  // Comandos: círculo com alavanca; os traços na ponta dizem o tipo (1 = simples; 2 = lustre; dos dois lados = escada;
  // dos dois lados na ponta e a meio = inversor).
  interruptor_simples: [["circle", { cx: 22, cy: 32, r: 4 }, "t"], ["path", { d: "M24.8 29.2L36 13M36 13l3.3 2.3" }, "t"]],
  interruptor_lustre: [["circle", { cx: 22, cy: 32, r: 4 }, "t"], ["path", { d: "M24.8 29.2L36 13M36 13l3.3 2.3M30.4 21.1l3.3 2.3" }, "t"]],
  interruptor_escada: [["circle", { cx: 22, cy: 32, r: 4 }, "t"], ["path", { d: "M24.8 29.2L36 13M32.7 10.7l6.6 4.6" }, "t"]],
  interruptor_inversor: [["circle", { cx: 22, cy: 32, r: 4 }, "t"], ["path", { d: "M24.8 29.2L36 13M32.7 10.7l6.6 4.6M27.1 18.8l6.6 4.6" }, "t"]],
  botao: [["circle", { cx: 24, cy: 24, r: 9 }, "t"], ["circle", { cx: 24, cy: 24, r: 2.6 }, "c"]],
  campainha: [["path", { d: "M12 30a12 12 0 0 1 24 0M9 30h30" }, "t"]],
  quadro: [["rect", { x: 12, y: 10, width: 24, height: 28 }, "t"], ["path", { d: "M12 38L36 14V38z" }, "c"]],
  aparelho: [["rect", { x: 10, y: 14, width: 28, height: 20 }, "t"]],
  detetor: [["path", { d: "M24 12l12 24H12z" }, "t"], ["circle", { cx: 24, cy: 29, r: 2.2 }, "c"]],
  porta: [["path", { d: "M14 36V12M14 12a24 24 0 0 1 24 24" }, "t"]],
  janela: [["path", { d: "M8 22h32M8 26h32M8 20v8M40 20v8" }, "t"]],
};
const NOME_SIMBOLO = {
  luz: "Ponto de luz", tomada: "Tomada com terra (PE)", tomada_dupla: "Tomada dupla com terra (PE)", tomada_tripla: "Tomada tripla com terra (PE)",
  interruptor_simples: "Interruptor simples", interruptor_lustre: "Comutador de lustre", interruptor_escada: "Comutador de escada",
  interruptor_inversor: "Inversor", botao: "Botão de pressão", campainha: "Campainha", quadro: "Quadro elétrico",
  aparelho: "Aparelho de utilização (n.º: ver lista)", detetor: "Detetor (movimento / porta)", porta: "Porta", janela: "Janela",
};
const ORDEM_LEGENDA = Object.keys(SIMBOLOS);

/** O símbolo de um elemento da planta (null = não se desenha). */
export function simboloDe(e) {
  const p = e?.props ?? {};
  switch (e?.tipo) {
    case "luz": return "luz";
    case "tomada": return caixasDe(p) === 3 ? "tomada_tripla" : caixasDe(p) === 2 ? "tomada_dupla" : "tomada";
    case "interruptor": return comandoDe(p) === "botao" ? "botao" : `interruptor_${comandoDe(p)}`;
    case "botao_pressao": case "botao": return "botao";
    case "campainha": return "campainha";
    case "quadro": return "quadro";
    // A campainha normal é uma "máquina" do simulador (modelo `campainha`): leva o símbolo da campainha, sem número.
    case "maquina": return p.modelo === "campainha" ? "campainha" : "aparelho";
    case "sensor_movimento": case "sensor_porta": return "detetor";
    case "porta": return "porta";
    case "janela": return "janela";
    default: return null;
  }
}

function no(tag, atrs, estilo) {
  const e = document.createElementNS(NS, tag);
  if (atrs) for (const [k, v] of Object.entries(atrs)) e.setAttribute(k, String(v));
  if (estilo) for (const [k, v] of Object.entries(estilo)) e.style.setProperty(k, v);
  return e;
}
const TRACO = { fill: "none", stroke: "currentColor", "stroke-width": "1.6px", "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" };
const CHEIO = { fill: "currentColor", stroke: "none", opacity: "0.55" };
const numero = (v, omissao = 0) => (Number.isFinite(Number(v)) ? Number(v) : omissao);

function partesSimbolo(g, chave) {
  for (const [tag, a, papel] of SIMBOLOS[chave] ?? []) g.append(no(tag, a, papel === "t" ? TRACO : CHEIO));
}

/** Só o símbolo, num <svg> 0 0 48 48 (legenda). */
export function desenharSimbolo(svg, chave) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  partesSimbolo(svg, chave);
  if (chave === "aparelho") {
    const t = no("text", { x: 24, y: 24, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 12 }, { fill: "currentColor", "font-family": "system-ui, sans-serif", "font-weight": "700" });
    t.textContent = "n";
    svg.append(t);
  }
  return svg;
}

// Forma das divisões: cópia mínima de planta-svg.js (cantos, área, centróide), que não as exporta.
function cantos(d) {
  const p = d?.pontos;
  if (Array.isArray(p) && p.length >= 3 && p.length <= 24 && p.every((q) => Array.isArray(q) && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1])))) {
    return p.map((q) => [Number(q[0]), Number(q[1])]);
  }
  const x = numero(d?.x_cm), y = numero(d?.y_cm), w = Math.max(1, numero(d?.largura_cm)), h = Math.max(1, numero(d?.altura_cm));
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
function dentro(x, y, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}
/** Ponto para o nome: o centróide se estiver dentro; senão o centro da caixa. */
function centro(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (a && dentro(cx / (3 * a), cy / (3 * a), pts)) return [cx / (3 * a), cy / (3 * a)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
const fmtM2 = (cm2) => (Math.round(cm2 / 1000) / 10).toLocaleString("pt-PT", { maximumFractionDigits: 1 });
const soPiso = (planta, piso, lista) => (Array.isArray(planta?.[lista]) ? planta[lista] : []).filter((x) => x && typeof x === "object" && pisoDe(x) === piso);

/** Aparelhos de utilização (máquinas) de um piso, numerados pela ordem da planta: [{n, nome, divisao}]. */
export function aparelhosNumerados(planta, piso, nomesModelo = {}) {
  const nomes = new Map(soPiso(planta, piso, "divisoes").map((d) => [d.id, String(d.nome ?? "")]));
  return soPiso(planta, piso, "elementos").filter((e) => simboloDe(e) === "aparelho").map((e, i) => ({
    n: i + 1,
    nome: (typeof e.nome === "string" && e.nome.trim()) || nomesModelo[e.props?.modelo] || String(e.props?.modelo ?? "aparelho").replace(/_/g, " "),
    divisao: nomes.get(e.divisao) ?? "",
  }));
}

/** Legenda de um piso: os símbolos usados, pela ordem fixa: [{chave, nome}]. */
export function legendaPlanta(planta, piso) {
  const usados = new Set(soPiso(planta, piso, "elementos").map(simboloDe).filter(Boolean));
  return ORDEM_LEGENDA.filter((k) => usados.has(k)).map((k) => ({ chave: k, nome: NOME_SIMBOLO[k] }));
}

/**
 * Planta técnica de um piso no <svg> dado: paredes (contorno), nome e área de cada divisão, símbolos normalizados nos
 * aparelhos (rodados como na planta) e o número dos aparelhos de utilização. Sem grelha, sem imagem de fundo, sem fios.
 */
export function desenharPlantaTecnica(svg, planta, { piso = 0 } = {}) {
  const L = Math.max(1, numero(planta?.largura_cm, 2000)), A = Math.max(1, numero(planta?.altura_cm, 1500));
  const raio = Math.min(60, Math.max(18, Math.max(L, A) / 60));
  const letra = Math.max(24, raio * 0.9);
  const divisoes = soPiso(planta, piso, "divisoes");
  const elementos = soPiso(planta, piso, "elementos");
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${L} ${A}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  const t = no("title");
  t.textContent = `Planta técnica, ${nomePiso(piso)}: ${divisoes.length} ${divisoes.length === 1 ? "divisão" : "divisões"} e ${elementos.length} ${elementos.length === 1 ? "símbolo" : "símbolos"}`;
  svg.append(t);
  svg.append(no("rect", { x: 0, y: 0, width: L, height: A }, { fill: "var(--superficie, #fff)", stroke: "currentColor", "stroke-width": "0.75px", "vector-effect": "non-scaling-stroke", opacity: "0.9" }));
  const gd = no("g", { "data-camada": "divisoes" });
  const gn = no("g", { "data-camada": "nomes", "aria-hidden": "true" });
  for (const d of divisoes) {
    const pts = cantos(d);
    // O nome vai ao canto de cima à esquerda (retângulo) ou um pouco acima do centro (polígono): o ponto de luz fica
    // normalmente no centro e não deve tapar o nome.
    const ret = pts.length === 4 && !d.pontos;
    const [cx0, cy0] = centro(pts);
    let area = 0;
    for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    gd.append(no("polygon", { points: pts.map((p) => `${p[0]},${p[1]}`).join(" ") }, { fill: "none", stroke: "currentColor", "stroke-width": "2.5px", "stroke-linejoin": "miter", "vector-effect": "non-scaling-stroke" }));
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const tam = Math.min(letra, Math.max(letra * 0.5, (w * 0.9) / (Math.max(4, String(d.nome ?? "").length) * 0.6)));
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    const [cx, cy, anc] = ret ? [x0 + raio * 1.2, y0 + raio * 1.2 + tam * 0.4, "start"] : [cx0, cy0 - raio * 1.6, "middle"];
    const nome = no("text", { x: cx, y: cy - tam * 0.2, "text-anchor": anc, "font-size": tam }, { fill: "currentColor", "font-weight": "700", "font-family": "var(--letra, system-ui, sans-serif)", stroke: "var(--superficie, #fff)", "stroke-width": `${tam * 0.22}px`, "stroke-linejoin": "round", "paint-order": "stroke" });
    nome.textContent = String(d.nome ?? "");
    const m2 = no("text", { x: cx, y: cy + tam * 0.9, "text-anchor": anc, "font-size": tam * 0.75 }, { fill: "currentColor", opacity: "0.75", "font-family": "var(--letra, system-ui, sans-serif)" });
    m2.textContent = `${fmtM2(Math.abs(area / 2))} m²`;
    gn.append(nome, m2);
  }
  svg.append(gd, gn);
  const ge = no("g", { "data-camada": "simbolos" });
  let nAparelho = 0;
  for (const e of elementos) {
    const chave = simboloDe(e);
    if (!chave) continue;
    const rot = [0, 90, 180, 270].includes(e.rot) ? e.rot : 0;
    const g = no("g", { "data-elemento": String(e.id ?? ""), "data-simbolo": chave, transform: `translate(${numero(e.x_cm)} ${numero(e.y_cm)})` });
    const tt = no("title");
    tt.textContent = NOME_SIMBOLO[chave];
    g.append(tt);
    // Papel por baixo do símbolo (tapa a parede onde o aparelho está encostado).
    g.append(no("circle", { r: raio * 0.85 }, { fill: "var(--superficie, #fff)", stroke: "none" }));
    const s = (raio * 1.7) / 48;
    const gi = no("g", { transform: `rotate(${rot}) scale(${s}) translate(-24 -24)` });
    partesSimbolo(gi, chave);
    g.append(gi);
    if (chave === "aparelho") {
      nAparelho += 1;
      const n = no("text", { x: 0, y: 0, "text-anchor": "middle", "dominant-baseline": "central", "font-size": raio * 0.8 }, { fill: "currentColor", "font-weight": "700", "font-family": "system-ui, sans-serif" });
      n.textContent = String(nAparelho);
      g.append(n);
    }
    ge.append(g);
  }
  svg.append(ge);
  return svg;
}

// ------------------------------------------------------------------ esquemas funcionais dos comandos (5 desenhos fixos)
// Caixa 0 0 240 150. Em cima a fase (L) e os aparelhos de comando; à direita o(s) recetor(es); em baixo o neutro (N) e
// a proteção (PE), que vão direitos aos recetores. Regra desenhada: a fase vai ao comando e volta ("retorno") ao
// recetor; o neutro vai DIRETO ao recetor; o PE (tracejado) vai a todos os recetores.
const LT = { ...TRACO, "stroke-width": "1.4px" };
const PE_TRACO = { ...LT, "stroke-dasharray": "4 3" };
const Y_N = 112, Y_PE = 134;
function etiqueta(g, x, y, texto, atrs = {}) {
  const t = no("text", { x, y, "font-size": 8, ...atrs }, { fill: "currentColor", "font-family": "system-ui, sans-serif" });
  t.textContent = texto;
  g.append(t);
}
function caixa(g, x, y, w, nome) {
  g.append(no("rect", { x, y, width: w, height: 22, rx: 2 }, LT));
  etiqueta(g, x + w / 2, y + 33, nome, { "text-anchor": "middle", "font-size": 7.5 });
}
function lampada(g, x, y) {
  g.append(no("circle", { cx: x, cy: y, r: 8 }, LT));
  g.append(no("path", { d: `M${x - 5.7} ${y - 5.7}l11.4 11.4M${x + 5.7} ${y - 5.7}l-11.4 11.4` }, LT));
}
function alimentacao(g) {
  for (const [y, nome] of [[20, "L"], [Y_N, "N"], [Y_PE, "PE"]]) {
    etiqueta(g, 6, y + 3, nome, { "font-weight": "700" });
    g.append(no("path", { d: `M22 ${y}h12` }, nome === "PE" ? PE_TRACO : LT));
  }
}
/** Neutro direto e PE a cada recetor (ys = alturas das lâmpadas, em x = 212). */
function neutroEPe(g, ys) {
  const topo = Math.min(...ys);
  g.append(no("path", { d: `M34 ${Y_N}H176V${topo}` }, LT));
  g.append(no("path", { d: `M34 ${Y_PE}H224V${topo}` }, PE_TRACO));
  for (const y of ys) {
    g.append(no("path", { d: `M176 ${y}H204` }, LT));
    g.append(no("path", { d: `M224 ${y}H220` }, PE_TRACO));
  }
  etiqueta(g, 40, Y_N - 3, "neutro direto ao recetor");
  etiqueta(g, 40, Y_PE - 3, "PE a todos os recetores");
}
const ESQUEMAS = {
  simples(g) {
    alimentacao(g);
    g.append(no("path", { d: "M34 20H60" }, LT));
    caixa(g, 60, 9, 44, "interruptor");
    g.append(no("path", { d: "M104 20H212V62" }, LT));
    etiqueta(g, 120, 17, "retorno");
    lampada(g, 212, 70);
    neutroEPe(g, [70]);
  },
  lustre(g) {
    alimentacao(g);
    g.append(no("path", { d: "M34 20H56" }, LT));
    caixa(g, 56, 9, 50, "comutador de lustre");
    g.append(no("path", { d: "M106 16H212V52M106 24H200V84H212V92" }, LT));
    etiqueta(g, 112, 13, "retorno 1");
    etiqueta(g, 150, 32, "retorno 2");
    lampada(g, 212, 60);
    lampada(g, 212, 100);
    neutroEPe(g, [60, 100]);
  },
  escada(g) {
    alimentacao(g);
    g.append(no("path", { d: "M34 20H52" }, LT));
    caixa(g, 52, 9, 40, "comutador");
    g.append(no("path", { d: "M92 15H112M92 25H112" }, LT));
    caixa(g, 112, 9, 40, "comutador");
    g.append(no("path", { d: "M152 20H212V62" }, LT));
    etiqueta(g, 160, 17, "retorno");
    etiqueta(g, 40, 60, "2 fios entre os dois comutadores de escada", { "font-size": 7 });
    lampada(g, 212, 70);
    neutroEPe(g, [70]);
  },
  inversor(g) {
    alimentacao(g);
    g.append(no("path", { d: "M34 20H46" }, LT));
    caixa(g, 46, 9, 34, "comutador");
    g.append(no("path", { d: "M80 15H96M80 25H96" }, LT));
    caixa(g, 96, 9, 34, "inversor");
    g.append(no("path", { d: "M130 15H146M130 25H146" }, LT));
    caixa(g, 146, 9, 34, "comutador");
    g.append(no("path", { d: "M180 20H212V62" }, LT));
    etiqueta(g, 40, 60, "um inversor por cada sítio a mais (4 fios em cada inversor)", { "font-size": 7 });
    lampada(g, 212, 70);
    neutroEPe(g, [70]);
  },
  botao(g) {
    alimentacao(g);
    g.append(no("path", { d: "M34 20H52M52 10V30" }, LT));
    for (const y of [10, 30]) {
      g.append(no("path", { d: `M52 ${y}H60M68 ${y}H78` }, LT));
      g.append(no("circle", { cx: 64, cy: y, r: 4 }, LT));
      g.append(no("circle", { cx: 64, cy: y, r: 1.4 }, CHEIO));
    }
    g.append(no("path", { d: "M78 10V30M78 20H96" }, LT));
    etiqueta(g, 40, 60, "botões em paralelo", { "font-size": 7 });
    caixa(g, 96, 9, 46, "telerruptor");
    g.append(no("path", { d: "M34 20V4H120V9" }, LT));
    g.append(no("path", { d: "M142 20H212V62" }, LT));
    etiqueta(g, 150, 17, "retorno");
    lampada(g, 212, 70);
    neutroEPe(g, [70]);
  },
};

/** O esquema funcional de um tipo de comando num <svg> (0 0 240 150). */
export function desenharEsquemaComando(svg, comando) {
  const c = COMANDOS[comando] ? comando : COMANDO_OMISSAO;
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 240 150");
  svg.setAttribute("role", "img");
  const t = no("title");
  t.textContent = `${COMANDOS[c].titulo}: esquema funcional`;
  svg.append(t);
  const g = no("g");
  ESQUEMAS[c](g);
  svg.append(g);
  return svg;
}

// ------------------------------------------------------------------ secção técnica (DOM) do relatório pormenorizado
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const svgEl = () => document.createElementNS(NS, "svg");
/** "0,5", "300", "—". */
const fmtNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 3 }));

/**
 * A parte técnica do relatório pormenorizado (só nele; o básico não a tem), em elementos DOM, para a conta e para a
 * pré-visualização do painel: a planta técnica por piso com legenda e lista de aparelhos, o esquema por luz, a nota de
 * terra e a lista de ensaios. `r`: {planta, esquemas, terra_nota, ensaios: {nota, lista: [{nome, referencia, norma,
 * unidade, medido}]}}. `titulo`/`subtitulo`: as tags dos títulos ("h5"/"h6" na conta, "h3"/"h4" no painel).
 */
export function seccaoTecnica(r, { titulo = "h5", subtitulo = "h6", nomesModelo = {} } = {}) {
  const out = [];
  const planta = r?.planta && typeof r.planta === "object" ? r.planta : null;
  if (planta && (planta.divisoes?.length || planta.elementos?.length)) {
    out.push(el(titulo, null, "Planta técnica (simbologia normalizada)"),
      el("p", "ajuda", "Esquema arquitetural de cada piso: paredes, aparelhos e comandos com símbolos de traço, sem traçado de fios. Os aparelhos de utilização estão numerados."));
    const pisos = pisosDaPlanta(planta);
    for (const piso of pisos) {
      const bloco = el("div", "rel-planta-piso");
      if (pisos.length > 1) bloco.append(el(subtitulo, null, nomePiso(piso)));
      const svg = svgEl();
      svg.setAttribute("class", "rel-planta");
      desenharPlantaTecnica(svg, planta, { piso });
      bloco.append(svg);
      const legenda = legendaPlanta(planta, piso);
      if (legenda.length) {
        const ul = el("ul", "rel-legenda");
        for (const it of legenda) {
          const li = el("li");
          const s = svgEl();
          desenharSimbolo(s, it.chave);
          li.append(s, it.nome);
          ul.append(li);
        }
        bloco.append(ul);
      }
      const aparelhos = aparelhosNumerados(planta, piso, nomesModelo);
      if (aparelhos.length) {
        const ol = el("ol", "rel-aparelhos");
        for (const a of aparelhos) ol.append(el("li", null, `${a.n} — ${a.nome}${a.divisao ? ` (${a.divisao})` : ""}`));
        bloco.append(el("p", "ajuda", "Aparelhos de utilização:"), ol);
      }
      out.push(bloco);
    }
  }
  const esquemas = Array.isArray(r?.esquemas) ? r.esquemas : [];
  if (esquemas.length) {
    out.push(el(titulo, null, "Esquema por luz"),
      el("p", "ajuda", "Em todos os comandos: a fase vai ao aparelho de comando e volta ao recetor (retorno); o neutro vai direto ao recetor; o condutor de proteção (PE) vai a todos os recetores."));
    const varios = new Set(esquemas.map((d) => d.piso)).size > 1;
    for (const d of esquemas) {
      const bloco = el("div", "rel-esquema-divisao");
      bloco.append(el(subtitulo, null, varios ? `${d.nome} · ${nomePiso(d.piso)}` : d.nome));
      const ul = el("ul");
      for (const l of d.luzes ?? []) ul.append(el("li", null, `${l.nome} — ${l.texto}`));
      bloco.append(ul);
      const tipos = [...new Set((d.luzes ?? []).map((l) => (COMANDOS[l.comando] ? l.comando : COMANDO_OMISSAO)))];
      const fig = el("div", "rel-esquemas");
      for (const c of tipos) {
        const f = el("figure", "rel-esquema");
        const svg = svgEl();
        desenharEsquemaComando(svg, c);
        f.append(svg, el("figcaption", null, `${COMANDOS[c].titulo}: ${COMANDOS[c].descricao}`));
        fig.append(f);
      }
      bloco.append(fig);
      out.push(bloco);
    }
  }
  if (r?.terra_nota) out.push(el("p", "rel-terra", r.terra_nota));
  const ens = r?.ensaios;
  if (ens && Array.isArray(ens.lista) && ens.lista.length) {
    out.push(el(titulo, null, "Lista de ensaios"), el("p", "ajuda", ens.introducao ?? ""));
    const t = el("table", "rel-ensaios");
    const thead = el("thead"), cab = el("tr");
    cab.append(el("th", null, "Ensaio"), el("th", null, "Valor de referência"), el("th", null, "Medido (a medir na visita/obra)"));
    thead.append(cab);
    const tb = el("tbody");
    for (const e of ens.lista) {
      const tr = el("tr");
      tr.dataset.ensaio = e.chave ?? "";
      const nome = el("td");
      nome.append(el("strong", null, e.nome), el("span", "ajuda", e.norma ? ` ${e.norma}` : ""));
      const med = fmtNum(e.medido);
      tr.append(nome, el("td", null, e.referencia), el("td", med === null ? "rel-medir" : "rel-medido", med === null ? "________ " + (e.unidade ?? "") : `${med} ${e.unidade ?? ""}`));
      tb.append(tr);
    }
    t.append(thead, tb);
    out.push(t);
    if (ens.notas) out.push(el("p", null, `Notas do técnico: ${ens.notas}`));
    out.push(el("p", "rel-aviso", ens.nota ?? "Valores de referência a confirmar pelo técnico."));
  }
  return out;
}
