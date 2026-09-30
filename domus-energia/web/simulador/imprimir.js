// "Imprimir" e "Guardar PDF" da planta (barra das ações do editor; docs/SIMULADOR-ORCAMENTO.md §2): só a planta,
// uma folha A4 por piso (ao baixo se a planta é mais larga do que alta), com o nome do piso, as divisões (nomes e
// medidas), os ícones e a legenda dos ícones usados nesse piso. Sem preços nem controlos. O PDF é feito aqui
// (cada piso desenhado num canvas a ~150 dpi → JPEG → pdf.js), sem nada de fora: a CSP do site só deixa 'self'
// (e imagens data:, por isso o SVG entra no canvas como data: URL).

import { desenharPlanta, desenharIcone, nomePiso, legendaAcoes } from "./planta-svg.js";
import { ELEMENTOS, MODELOS, pisoDe } from "./regras.js";
import { ACOES, temAcao } from "./acoes.js";
import { pdfDeImagens, A4_PT } from "./pdf.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NOME_PDF = "planta-domus.pdf";
// Cores claras (as de planta-svg.js por omissão): em papel a planta sai sempre clara, mesmo no tema escuro.
const CLARAS = {
  "--superficie": "#fffdf0", "--texto": "#283618", "--texto-suave": "#5c6446", "--borda": "#e6e0bf",
  "--musgo": "#606c38", "--musgo-claro": "#eef0d9", "--areia": "#dda15e", "--argila": "#bc6c25",
};
const PX_A4 = [1240, 1754];   // A4 a 150 dpi, ao alto

/** Pisos a imprimir: 0 … n-1 (os que o editor mostra). */
const listaPisos = (n) => Array.from({ length: Math.max(1, n) }, (_, i) => i);
const paisagem = (planta) => Number(planta.largura_cm) >= Number(planta.altura_cm);

/** Ícones usados num piso (um por desenho: janela com estore, tomada dupla e cada máquina contam à parte). */
function legenda(planta, piso) {
  const vistos = new Map();
  for (const e of planta.elementos ?? []) {
    if (pisoDe(e) !== piso || !ELEMENTOS[e.tipo]) continue;
    const p = e.props ?? {};
    const variante = e.tipo === "janela" && p.estore ? "estore" : e.tipo === "tomada" && p.dupla ? "dupla" : e.tipo === "maquina" ? String(p.modelo) : "";
    const chave = `${e.tipo}:${variante}`;
    if (vistos.has(chave)) continue;
    const nome = e.tipo === "maquina" ? (MODELOS[p.modelo]?.nome ?? ELEMENTOS.maquina.nome)
      : variante === "estore" ? "Janela com estore" : variante === "dupla" ? "Tomada dupla" : ELEMENTOS[e.tipo].nome;
    vistos.set(chave, { tipo: e.tipo, props: p, nome });
  }
  return [...vistos.values()];
}

/** Lote 7: há marcas de ação (M, R, S, N) neste piso? (aparelhos com uma ação diferente da do serviço) */
const temMarcas = (planta, piso, omissao) => !!omissao
  && (planta.elementos ?? []).some((e) => pisoDe(e) === piso && temAcao(e.tipo, e.props) && ACOES[e.acao] && e.acao !== omissao);

function svgPlanta(planta, piso, omissao = null) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  desenharPlanta(svg, planta, { soLeitura: true, piso, acoes: omissao ? { omissao } : null });
  svg.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  return svg;
}
function svgIcone(item) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  desenharIcone(svg, item.tipo, item.props);
  svg.setAttribute("color", CLARAS["--texto"]);
  return svg;
}

// ------------------------------------------------------------------ imprimir
/** Monta as folhas (uma por piso), imprime e volta a tirá-las. `omissao`: a ação por omissão do serviço (marcas). */
export function imprimirPlanta(planta, nPisos, omissao = null) {
  const raiz = document.createElement("div");
  raiz.className = "impressao-planta";
  for (const [k, v] of Object.entries(CLARAS)) raiz.style.setProperty(k, v);
  const deitada = paisagem(planta);
  for (const piso of listaPisos(nPisos)) {
    const folha = document.createElement("section");
    folha.className = `impressao-folha ${deitada ? "paisagem" : "retrato"}`;
    const h = document.createElement("h1");
    h.textContent = nomePiso(piso);
    const svg = svgPlanta(planta, piso, omissao);
    svg.setAttribute("class", "impressao-svg");
    const ul = document.createElement("ul");
    ul.className = "impressao-legenda";
    for (const item of legenda(planta, piso)) {
      const li = document.createElement("li");
      li.append(svgIcone(item), document.createTextNode(item.nome));
      ul.append(li);
    }
    if (temMarcas(planta, piso, omissao)) {
      const li = document.createElement("li");
      li.textContent = legendaAcoes(omissao);
      ul.append(li);
    }
    folha.append(h, svg);
    if (ul.children.length) folha.append(ul);
    raiz.append(folha);
  }
  document.body.append(raiz);
  document.documentElement.classList.add("a-imprimir");
  const limpar = () => { raiz.remove(); document.documentElement.classList.remove("a-imprimir"); };
  window.addEventListener("afterprint", limpar, { once: true });
  window.print();
}

// ------------------------------------------------------------------ PDF
function imagemDeSvg(svg, w, h) {
  svg.setAttribute("width", String(Math.round(w)));
  svg.setAttribute("height", String(Math.round(h)));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  return img.decode().then(() => img);
}

/** Uma página (canvas) por piso: título, planta a caber e legenda por baixo. `nomes`: os nomes das ações para o cliente. */
async function paginaPiso(planta, piso, deitada, omissao = null, nomes = null) {
  const [W, H] = deitada ? [PX_A4[1], PX_A4[0]] : PX_A4;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const M = 70, fonte = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.fillStyle = CLARAS["--texto"];
  g.font = `700 40px ${fonte}`;
  g.textBaseline = "top";
  g.fillText(nomePiso(piso), M, M);
  let topo = M + 64;

  // Legenda: ícone de 36 px e nome, em linhas.
  const itens = legenda(planta, piso);
  const marcas = temMarcas(planta, piso, omissao) ? legendaAcoes(omissao, false, nomes) : null;
  g.font = `24px ${fonte}`;
  const linhas = [[]];
  let x = M;
  for (const it of itens) {
    const larg = 36 + 10 + g.measureText(it.nome).width + 34;
    if (x + larg > W - M && linhas[linhas.length - 1].length) { linhas.push([]); x = M; }
    linhas[linhas.length - 1].push({ ...it, x });
    x += larg;
  }
  const altLegenda = (itens.length ? linhas.length * 48 + 20 : 0) + (marcas ? 44 : 0);

  // Planta: o maior que couber entre o título e a legenda, sem deformar.
  const L = Math.max(1, Number(planta.largura_cm) || 1), A = Math.max(1, Number(planta.altura_cm) || 1);
  const caixaW = W - 2 * M, caixaH = H - topo - M - altLegenda;
  const k = Math.min(caixaW / L, caixaH / A);
  const pw = L * k, ph = A * k;
  g.drawImage(await imagemDeSvg(svgPlanta(planta, piso, omissao), pw, ph), M + (caixaW - pw) / 2, topo, pw, ph);

  let y = topo + ph + 30;
  for (const linha of itens.length ? linhas : []) {
    for (const it of linha) {
      g.drawImage(await imagemDeSvg(svgIcone(it), 36, 36), it.x, y);
      g.fillStyle = CLARAS["--texto"];
      g.textBaseline = "middle";
      g.fillText(it.nome, it.x + 46, y + 18);
    }
    y += 48;
  }
  if (marcas) {
    g.fillStyle = CLARAS["--texto"];
    g.textBaseline = "middle";
    g.fillText(marcas, M, y + 18);
  }
  return c;
}

const jpeg = (canvas) => new Promise((ok, erro) => {
  canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a)), erro) : erro(new Error("sem JPEG"))), "image/jpeg", 0.9);
});

/** Faz o PDF (uma página por piso) e descarrega-o. `omissao`: a ação por omissão do serviço (marcas). */
export async function guardarPdf(planta, nPisos, omissao = null) {
  const deitada = paisagem(planta);
  const [wpt, hpt] = deitada ? [A4_PT[1], A4_PT[0]] : A4_PT;
  const paginas = [];
  for (const piso of listaPisos(nPisos)) {
    const c = await paginaPiso(planta, piso, deitada, omissao);
    paginas.push({ jpeg: await jpeg(c), largura_px: c.width, altura_px: c.height, largura_pt: wpt, altura_pt: hpt });
  }
  const bytes = pdfDeImagens(paginas);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = NOME_PDF;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return bytes;
}

// ------------------------------------------------------------------ orçamento em PDF (fase 1)
/**
 * O conteúdo do orçamento do cliente (passo Orçamento, "Descarregar orçamento (PDF)"), em blocos simples:
 * {tipo: "marca"|"titulo"|"data"|"seccao"|"texto"|"destaque"|"item"|"nota", texto}. Só o que o cliente vê no simulador:
 * a casa, o intervalo, o que inclui, as melhorias aceites (fase 2), os planos e a nota — nunca preços de compra,
 * fornecedores nem artigos. `d`: {data, casa, inclui[], melhorias[], intervalo, planos[{nome, preco, sugerido}], nota}.
 */
export function blocosOrcamento(d) {
  const dataTxt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" }).format(d.data ?? new Date());
  const b = [
    { tipo: "marca", texto: "Domus Energia" },
    { tipo: "titulo", texto: "Orçamento estimado" },
    { tipo: "data", texto: dataTxt },
    { tipo: "seccao", texto: "A casa" },
    { tipo: "texto", texto: d.casa || "—" },
    { tipo: "seccao", texto: "Estimativa (com IVA)" },
    { tipo: "destaque", texto: d.intervalo || "Enviamos o preço depois do pedido." },
    { tipo: "seccao", texto: "O que inclui" },
    ...((d.inclui ?? []).length ? d.inclui : ["Ainda nada."]).map((t) => ({ tipo: "item", texto: String(t) })),
    ...((d.melhorias ?? []).length ? [{ tipo: "seccao", texto: "Melhorias" }, ...d.melhorias.map((t) => ({ tipo: "item", texto: String(t) }))] : []),
    { tipo: "seccao", texto: "Planos mensais" },
    ...(d.planos ?? []).map((p) => ({ tipo: "item", texto: `${p.nome}: ${p.preco}${p.sugerido ? " (sugerido)" : ""}` })),
    { tipo: "nota", texto: d.nota || "Estimativa; valor final após a visita." },
  ];
  return b;
}

const ESTILO_BLOCO = {
  marca: { fonte: 800, tam: 30, cor: "--musgo", antes: 0, depois: 6 },
  titulo: { fonte: 800, tam: 52, cor: "--texto", antes: 0, depois: 8 },
  data: { fonte: 400, tam: 26, cor: "--texto-suave", antes: 0, depois: 34 },
  seccao: { fonte: 800, tam: 30, cor: "--argila", antes: 26, depois: 10 },
  texto: { fonte: 400, tam: 28, cor: "--texto", antes: 0, depois: 6 },
  destaque: { fonte: 800, tam: 44, cor: "--texto", antes: 0, depois: 6 },
  item: { fonte: 400, tam: 26, cor: "--texto", antes: 0, depois: 6, marca: "•  " },
  nota: { fonte: 700, tam: 26, cor: "--texto-suave", antes: 34, depois: 0 },
};

/** Parte o texto em linhas que caibam em `largura` (px) com a fonte atual do contexto. */
function partirLinhas(g, texto, largura) {
  const linhas = [];
  let linha = "";
  for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
    const tentativa = linha ? `${linha} ${palavra}` : palavra;
    if (g.measureText(tentativa).width <= largura || !linha) linha = tentativa;
    else { linhas.push(linha); linha = palavra; }
  }
  if (linha) linhas.push(linha);
  return linhas.length ? linhas : [""];
}

/** As páginas de texto do orçamento (A4 ao alto, ~150 dpi): os blocos por ordem, a passar à página seguinte se preciso. */
function paginasTexto(blocos) {
  const [W, H] = PX_A4;
  const M = 90, fonte = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  const paginas = [];
  let c, g, y;
  const nova = () => {
    c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = CLARAS["--musgo"];
    g.fillRect(0, 0, W, 16);
    g.textBaseline = "top";
    y = M;
    paginas.push(c);
  };
  nova();
  for (const b of blocos) {
    const e = ESTILO_BLOCO[b.tipo] ?? ESTILO_BLOCO.texto;
    g.font = `${e.fonte} ${e.tam}px ${fonte}`;
    const recuo = e.marca ? g.measureText(e.marca).width : 0;
    const linhas = partirLinhas(g, b.texto, W - 2 * M - recuo);
    const alt = e.antes + linhas.length * e.tam * 1.3 + e.depois;
    if (y + alt > H - M && y > M) nova();
    y += y > M ? e.antes : 0;
    g.font = `${e.fonte} ${e.tam}px ${fonte}`;
    g.fillStyle = CLARAS[e.cor];
    linhas.forEach((l, i) => {
      if (e.marca && i === 0) g.fillText(e.marca, M, y);
      g.fillText(l, M + recuo, y);
      y += e.tam * 1.3;
    });
    y += e.depois;
  }
  return paginas;
}

/**
 * Faz o PDF do orçamento (resumo + 1 página por piso da planta, com as marcas das ações) e descarrega-o
 * ("orcamento-domus.pdf"). Devolve os bytes. `d`: blocosOrcamento + {planta, pisos, omissao, nomesAcoes}.
 */
export async function guardarPdfOrcamento(d) {
  const paginas = [];
  for (const c of paginasTexto(blocosOrcamento(d))) paginas.push({ jpeg: await jpeg(c), largura_px: c.width, altura_px: c.height, largura_pt: A4_PT[0], altura_pt: A4_PT[1] });
  if (d.planta && (d.planta.divisoes?.length || d.planta.elementos?.length)) {
    const deitada = paisagem(d.planta);
    const [wpt, hpt] = deitada ? [A4_PT[1], A4_PT[0]] : A4_PT;
    for (const piso of listaPisos(d.pisos ?? 1)) {
      const c = await paginaPiso(d.planta, piso, deitada, d.omissao ?? null, d.nomesAcoes ?? null);
      paginas.push({ jpeg: await jpeg(c), largura_px: c.width, altura_px: c.height, largura_pt: wpt, altura_pt: hpt });
    }
  }
  const bytes = pdfDeImagens(paginas);
  descarregar(bytes, NOME_PDF_ORCAMENTO);
  return bytes;
}
const NOME_PDF_ORCAMENTO = "orcamento-domus.pdf";

function descarregar(bytes, nome) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
