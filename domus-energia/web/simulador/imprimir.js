// "Imprimir" e "Guardar PDF" da planta (barra das ações do editor; docs/SIMULADOR-ORCAMENTO.md §2): só a planta,
// uma folha A4 por piso (ao baixo se a planta é mais larga do que alta), com o nome do piso, as divisões (nomes e
// medidas), os ícones e a legenda dos ícones usados nesse piso. Sem preços nem controlos. O PDF é feito aqui
// (cada piso desenhado num canvas a ~150 dpi → JPEG → pdf.js), sem nada de fora: a CSP do site só deixa 'self'
// (e imagens data:, por isso o SVG entra no canvas como data: URL).

import { desenharPlanta, desenharIcone, nomePiso, legendaAcoes } from "./planta-svg.js";
import { ELEMENTOS, MODELOS, pisoDe, caixasDe } from "./regras.js";
import { ACOES, temAcao } from "./acoes.js";
import { pdfDeImagens, A4_PT } from "./pdf.js";
import { desenharQuadroCliente } from "./quadro-desenho.js";

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

/** Ícones usados num piso (um por desenho: janela com estore, tomada dupla ou tripla e cada máquina contam à parte). */
function legenda(planta, piso) {
  const vistos = new Map();
  for (const e of planta.elementos ?? []) {
    if (pisoDe(e) !== piso || !ELEMENTOS[e.tipo]) continue;
    const p = e.props ?? {};
    const variante = e.tipo === "janela" && p.estore ? "estore" : e.tipo === "tomada" && caixasDe(p) > 1 ? (caixasDe(p) === 3 ? "tripla" : "dupla") : e.tipo === "maquina" ? String(p.modelo) : "";
    const chave = `${e.tipo}:${variante}`;
    if (vistos.has(chave)) continue;
    const nome = e.tipo === "maquina" ? (MODELOS[p.modelo]?.nome ?? ELEMENTOS.maquina.nome)
      : variante === "estore" ? "Janela com estore" : variante === "dupla" ? "Tomada dupla" : variante === "tripla" ? "Tomada tripla" : ELEMENTOS[e.tipo].nome;
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

const FONTE_PDF = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const ALT_TITULO_PISO = 64;

/** A legenda do piso partida em linhas (para a largura W com margem M) e a altura que ocupa. */
function legendaDoPiso(g, W, M, planta, piso, omissao, nomes) {
  const itens = legenda(planta, piso);
  const marcas = temMarcas(planta, piso, omissao) ? legendaAcoes(omissao, false, nomes) : null;
  g.font = `24px ${FONTE_PDF}`;
  const linhas = [[]];
  let x = M;
  for (const it of itens) {
    const larg = 36 + 10 + g.measureText(it.nome).width + 34;
    if (x + larg > W - M && linhas[linhas.length - 1].length) { linhas.push([]); x = M; }
    linhas[linhas.length - 1].push({ ...it, x });
    x += larg;
  }
  return { itens, marcas, linhas, alt: (itens.length ? linhas.length * 48 + 20 : 0) + (marcas ? 44 : 0) };
}
/** A escala (px por cm) a que a planta cabe numa caixa de W − 2M por `altura` (título e legenda incluídos na altura). */
function escalaDoPiso(W, M, planta, altura, altLegenda) {
  const L = Math.max(1, Number(planta.largura_cm) || 1), A = Math.max(1, Number(planta.altura_cm) || 1);
  return Math.min((W - 2 * M) / L, Math.max(0, altura - ALT_TITULO_PISO - altLegenda - 30) / A);
}

/**
 * Desenha um piso no canvas, de `y0` para baixo, em `altura` px: título, planta a caber (sem deformar) e legenda.
 * Devolve o y onde acabou. `nomes`: os nomes das ações para o cliente.
 */
async function desenharPiso(g, W, M, planta, piso, y0, altura, omissao = null, nomes = null) {
  g.fillStyle = CLARAS["--texto"];
  g.font = `700 40px ${FONTE_PDF}`;
  g.textBaseline = "top";
  g.fillText(nomePiso(piso), M, y0);
  const topo = y0 + ALT_TITULO_PISO;
  const { itens, marcas, linhas, alt } = legendaDoPiso(g, W, M, planta, piso, omissao, nomes);
  const L = Math.max(1, Number(planta.largura_cm) || 1), A = Math.max(1, Number(planta.altura_cm) || 1);
  const k = escalaDoPiso(W, M, planta, altura, alt);
  const caixaW = W - 2 * M;
  const pw = L * k, ph = A * k;
  g.drawImage(await imagemDeSvg(svgPlanta(planta, piso, omissao), pw, ph), M + (caixaW - pw) / 2, topo, pw, ph);

  let y = topo + ph + 30;
  g.font = `24px ${FONTE_PDF}`;
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
    y += 44;
  }
  g.textBaseline = "top";
  return y;
}

/** Uma página (canvas) por piso: título, planta a caber e legenda por baixo. `nomes`: os nomes das ações para o cliente. */
async function paginaPiso(planta, piso, deitada, omissao = null, nomes = null) {
  const [W, H] = deitada ? [PX_A4[1], PX_A4[0]] : PX_A4;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const M = 70;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  await desenharPiso(g, W, M, planta, piso, M, H - 2 * M, omissao, nomes);
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

/**
 * Parte o texto em linhas que caibam em `largura` (px) com a fonte atual do contexto. Só nos espaços normais: o espaço
 * inseparável dos milhares ("1 652 €") nunca parte.
 */
function partirLinhas(g, texto, largura) {
  const linhas = [];
  let linha = "";
  for (const palavra of String(texto).split(/[ \t\r\n]+/).filter(Boolean)) {
    const tentativa = linha ? `${linha} ${palavra}` : palavra;
    if (g.measureText(tentativa).width <= largura || !linha) linha = tentativa;
    else { linhas.push(linha); linha = palavra; }
  }
  if (linha) linhas.push(linha);
  return linhas.length ? linhas : [""];
}

/** As páginas de texto do orçamento (A4 ao alto, ~150 dpi): os blocos por ordem, a passar à página seguinte se preciso. */
/** Uma folha A4 ao alto em branco, com a faixa verde no topo (as do texto e as da planta no seguimento). */
function folhaDeTexto() {
  const [W, H] = PX_A4;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.fillStyle = CLARAS["--musgo"];
  g.fillRect(0, 0, W, 16);
  g.textBaseline = "top";
  return c;
}
function paginasTexto(blocos) {
  const [W, H] = PX_A4;
  const M = 90, fonte = FONTE_PDF;
  const paginas = [];
  let c, g, y;
  const nova = () => {
    c = folhaDeTexto();
    g = c.getContext("2d");
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

// ------------------------------------------------------------------ relatório básico em PDF (ronda A)
/**
 * O relatório básico (passo "Relatório básico", grátis): a casa, as divisões com os aparelhos, o quadro e a potência
 * sugerida — sem preços. `d`: {data, casa, divisoes[{nome, itens}], quadro[], potencia}.
 */
export function blocosRelatorio(d) {
  const dataTxt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric" }).format(d.data ?? new Date());
  const a = d.analise;
  const divisoes = (d.divisoes ?? []).length ? d.divisoes.map((x) => ({ tipo: "item", texto: `${x.nome}: ${x.itens || "sem aparelhos"}` })) : [{ tipo: "item", texto: "Ainda sem divisões." }];
  const cabeca = [{ tipo: "marca", texto: "Domus Energia" }, { tipo: "titulo", texto: "Relatório básico" }, { tipo: "data", texto: dataTxt }];
  const nota = { tipo: "nota", texto: "Sem preços. O relatório completo traz o material e o preço por divisão." };
  // Sem a análise da casa (relatórios de antes): a casa, as divisões e o quadro do pedido, como estava.
  if (!a) {
    return [...cabeca, { tipo: "seccao", texto: "A casa" }, { tipo: "texto", texto: d.casa || "—" }, { tipo: "seccao", texto: "Divisões" }, ...divisoes,
      { tipo: "seccao", texto: "Quadro elétrico" }, ...(d.quadro ?? []).map((t) => ({ tipo: "item", texto: String(t) })), ...(d.potencia ? [{ tipo: "texto", texto: d.potencia }] : []), nota];
  }
  const temPlanta = Boolean(d.planta && (d.planta.divisoes?.length || d.planta.elementos?.length));
  return [
    ...cabeca,
    // 1. O essencial: a casa num resumo, a planta e o que encontrámos.
    { tipo: "seccao", texto: "A casa" },
    { tipo: "texto", texto: d.casa || "—" },
    { tipo: "texto", texto: a.numeros.map(([k, v]) => `${k}: ${v}`).join(" · ") },
    ...(temPlanta ? listaPisos(d.pisos ?? 1).map((piso) => ({ tipo: "planta", piso })) : []),
    { tipo: "seccao", texto: a.potencia.titulo },
    ...a.potencia.texto.map((t) => ({ tipo: "texto", texto: t })),
    ...(a.simultaneo ? [{ tipo: "seccao", texto: "O que pode ligar ao mesmo tempo" }, { tipo: "texto", texto: `Com os ${a.simultaneo.limite} que tem contratados:` },
      ...a.simultaneo.linhas.map((l) => ({ tipo: "item", texto: `${l.estado === "dispara" ? "A luz vai abaixo" : "Aguenta"}: ${l.nomes} (${l.w})` }))] : []),
    { tipo: "seccao", texto: "Pontos a rever" },
    ...(a.rever.length ? a.rever.map((t) => ({ tipo: "item", texto: t })) : [{ tipo: "item", texto: "Nada a assinalar pelo que descreveu." }]),
    { tipo: "texto", texto: "Orientativo, pelo que descreveu. Confirmamos na visita." },
    ...(a.proximo?.length ? [{ tipo: "seccao", texto: "O que fazíamos primeiro nesta casa" }, ...a.proximo.map((t) => ({ tipo: "item", texto: t }))] : []),
    // 2. O quadro ideal, numa folha nova: o desenho, o que é cada peça e os circuitos em tabela.
    { tipo: "quebra" },
    { tipo: "seccao", texto: "Quadro ideal e circuitos" },
    ...(a.esquema ? [{ tipo: "texto", texto: `Calculado pelo que descreveu. Não é o quadro que tem hoje: o eletricista adapta o que lá está a este. ${a.esquema.resumo}` },
      // O desenho à esquerda e, ao lado, as cores e o que é cada peça.
      { tipo: "quadro", esquema: a.esquema, lado: [
        ...(a.esquema.cores ?? []).map(([k, nome]) => ({ cor: k, forte: nome, texto: "" })),
        ...(a.esquema.legenda ?? []).map(([nome, texto]) => ({ forte: nome, texto })),
      ] }] : []),
    ...(a.circuitos.length
      ? [{ tipo: "tabela", cabecalho: ["Circuito", "Divisões", "Disjuntor", "Cabo"], larguras: [0.3, 0.36, 0.2, 0.14],
        linhas: a.circuitos.map((c) => [`${c.codigo ? `${c.codigo} · ` : ""}${c.nome}`, c.divisoes || "—", c.disjuntor, c.cabo || "—"]) }]
      : [{ tipo: "item", texto: "Ainda sem tomadas nem máquinas descritas." }]),
    ...(a.notaCircuitos ? [{ tipo: "texto", texto: a.notaCircuitos }] : []),
    // 3. O pormenor: o consumo estimado e os aparelhos de cada divisão.
    ...(a.consumo ? [{ tipo: "seccao", texto: "Consumo estimado por mês" }, { tipo: "texto", texto: `Cerca de ${a.consumo.kwh} kWh, uns ${a.consumo.euros} €.` },
      ...a.consumo.maiores.map(([nome, k]) => ({ tipo: "item", texto: `${nome}: ${k}` })), { tipo: "texto", texto: a.consumo.nota }] : []),
    { tipo: "seccao", texto: "Divisões em pormenor" },
    ...divisoes,
    nota,
  ];
}
const COR_CIRCUITO = { luz: "#e0b100", tomadas: "#6a994e", humida: "#3a86c8", maquina: "#d9853b" };

/**
 * O desenho do quadro para o PDF: o <svg> de quadro-desenho.js com as cores claras postas nos próprios elementos (uma
 * imagem feita de um SVG não vê o CSS da página, e o PDF é sempre claro, mesmo com o site no tema escuro).
 */
function svgQuadroPdf(esquema) {
  const svg = desenharQuadroCliente(esquema, { soLeitura: true });
  const C = CLARAS;
  const FORMAS = {
    "qd-caixa": { fill: C["--superficie"], stroke: C["--texto-suave"], "stroke-width": 2 },
    "qd-calha": { fill: C["--borda"], stroke: C["--texto-suave"], "stroke-width": 1 },
    "qd-livre": { fill: "none", stroke: C["--texto-suave"], "stroke-width": 1.2, "stroke-dasharray": "4 3" },
    "qd-livre-fundo": { fill: "none", stroke: "none" },
    "qd-corpo": { fill: "#ffffff", stroke: C["--texto"], "stroke-width": 1.5 },
    "qd-alavanca": { fill: C["--texto"] },
    "qd-teste": { fill: C["--superficie"], stroke: C["--texto"], "stroke-width": 1 },
    "qd-visor": { fill: C["--musgo-claro"], stroke: C["--texto"], "stroke-width": 1 },
    "qd-cor-luz": { fill: "#e0b100" }, "qd-cor-tomadas": { fill: "#6a994e" }, "qd-cor-humida": { fill: "#3a86c8" }, "qd-cor-maquina": { fill: "#d9853b" },
  };
  for (const e of svg.querySelectorAll("*")) {
    const cl = e.classList;
    for (const [k, attrs] of Object.entries(FORMAS)) if (cl.contains(k)) for (const [n, v] of Object.entries(attrs)) e.setAttribute(n, String(v));
    if (cl.contains("qd-corpo")) {
      const pai = e.parentNode.classList;
      if (pai.contains("qd-geral")) e.setAttribute("fill", C["--musgo-claro"]);
      else if (pai.contains("qd-diferencial")) e.setAttribute("fill", "#f7e5c6");
    }
    if (cl.contains("qd-txt") || cl.contains("qd-teste-t")) {
      const [peso, tam] = cl.contains("qd-teste-t") ? [700, 7] : cl.contains("qd-etiqueta") ? [700, 8.5] : cl.contains("forte") ? [800, 12] : cl.contains("mini") ? [600, 8] : [600, 10];
      e.setAttribute("font-family", "'Segoe UI', system-ui, sans-serif");
      e.setAttribute("font-weight", String(peso));
      e.setAttribute("font-size", String(tam));
      e.setAttribute("fill", cl.contains("mini") ? C["--texto-suave"] : C["--texto"]);
    }
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return svg;
}

/**
 * As folhas do relatório (A4 ao alto), em fluxo: os blocos de texto de paginasTexto e mais {tipo: "quebra"} (folha
 * nova), {tipo: "planta", piso} (a planta do piso no seguimento do texto: na mesma folha se lá couber a pelo menos 60 %
 * do tamanho que teria numa folha só dela, senão na seguinte), {tipo: "quadro", esquema} (o desenho do quadro ideal) e
 * {tipo: "tabela", cabecalho, larguras, linhas}. Decisão do dono (2026-10-05): do importante para o pormenor, sem folha deitada.
 */
async function paginasRelatorio(blocos, planta) {
  const [W, H] = PX_A4;
  const M = 90, fonte = FONTE_PDF;
  const paginas = [];
  let c, g, y;
  const nova = () => { c = folhaDeTexto(); g = c.getContext("2d"); y = M; paginas.push(c); };
  nova();
  for (const b of blocos) {
    if (b.tipo === "quebra") { if (y > M) nova(); continue; }
    if (b.tipo === "planta") {
      const { alt } = legendaDoPiso(g, W, M, planta, b.piso, null, null);
      const inteira = escalaDoPiso(W, M, planta, H - 2 * M, alt);
      const resto = H - M - (y + 30);
      if (y > M && (resto < 320 || escalaDoPiso(W, M, planta, resto, alt) < inteira * 0.6)) nova();
      const y0 = y > M ? y + 30 : M;
      // No meio do texto a planta não precisa da folha toda: no máximo 40 % da altura.
      y = await desenharPiso(g, W, M, planta, b.piso, y0, Math.min(H - M - y0, Math.round(H * 0.4)));
      continue;
    }
    if (b.tipo === "quadro") {
      const svg = svgQuadroPdf(b.esquema);
      const [, , vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
      // O desenho ocupa até metade da largura e o que sobra da folha (se sobrar pouco, folha nova); ao lado, a legenda.
      if (H - M - y - 16 < 700 && y > M) nova();
      y += y > M ? 16 : 0;
      let w = (W - 2 * M) * 0.5, h = (vh * w) / vw;
      const maxH = H - M - y;
      if (h > maxH) { w = (w * maxH) / h; h = maxH; }
      g.drawImage(await imagemDeSvg(svg, w, h), M, y, w, h);
      const x = M + w + 40, larg = W - M - x;
      let yl = y + 6;
      for (const it of b.lado ?? []) {
        g.font = `800 23px ${fonte}`;
        g.fillStyle = CLARAS["--texto"];
        if (it.cor) { g.fillStyle = COR_CIRCUITO[it.cor] ?? CLARAS["--texto"]; g.fillRect(x, yl + 8, 44, 12); g.fillStyle = CLARAS["--texto"]; g.font = `400 23px ${fonte}`; g.fillText(it.forte, x + 56, yl); yl += 34; continue; }
        if (yl > y + 6 && !it.cor && it === (b.lado ?? []).find((z) => !z.cor)) yl += 14;
        g.fillText(it.forte, x, yl);
        yl += 30;
        g.font = `400 22px ${fonte}`;
        g.fillStyle = CLARAS["--texto-suave"];
        for (const l of partirLinhas(g, it.texto, larg)) { g.fillText(l, x, yl); yl += 28; }
        yl += 12;
      }
      y = Math.max(y + h, yl) + 20;
      continue;
    }
    if (b.tipo === "tabela") {
      const larg = W - 2 * M, tam = 24, folga = 10;
      const xs = b.larguras.reduce((l, f) => [...l, l[l.length - 1] + f * larg], [M]);
      const linha = (celulas, peso) => {
        g.font = `${peso} ${tam}px ${fonte}`;
        const partes = celulas.map((t, i) => partirLinhas(g, String(t), b.larguras[i] * larg - 16));
        const alt = Math.max(...partes.map((p) => p.length)) * tam * 1.3 + 2 * folga;
        if (y + alt > H - M && y > M) { nova(); g.font = `${peso} ${tam}px ${fonte}`; }
        if (peso === 800) { g.fillStyle = CLARAS["--musgo-claro"]; g.fillRect(M, y, larg, alt); }
        g.fillStyle = CLARAS["--texto"];
        partes.forEach((p, i) => p.forEach((t, k) => g.fillText(t, xs[i] + 8, y + folga + k * tam * 1.3)));
        y += alt;
        g.fillStyle = CLARAS["--borda"];
        g.fillRect(M, y - 1, larg, 2);
      };
      y += 12;
      linha(b.cabecalho, 800);
      for (const l of b.linhas) linha(l, 400);
      y += 14;
      continue;
    }
    const e = ESTILO_BLOCO[b.tipo] ?? ESTILO_BLOCO.texto;
    g.font = `${e.fonte} ${e.tam}px ${fonte}`;
    const recuo = e.marca ? g.measureText(e.marca).width : 0;
    const linhas = partirLinhas(g, b.texto, W - 2 * M - recuo);
    const alt = e.antes + linhas.length * e.tam * 1.3 + e.depois;
    // Um título de secção não fica sozinho no fundo da folha.
    if (y + alt + (b.tipo === "seccao" ? 80 : 0) > H - M && y > M) nova();
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

/** Faz o PDF do relatório básico (o texto e, no seguimento, a planta de cada piso; tudo em A4 ao alto) e descarrega-o ("relatorio-domus.pdf"). */
export async function guardarPdfRelatorio(d) {
  const folhas = await paginasRelatorio(blocosRelatorio(d), d.planta);
  const paginas = [];
  for (const c of folhas) paginas.push({ jpeg: await jpeg(c), largura_px: c.width, altura_px: c.height, largura_pt: A4_PT[0], altura_pt: A4_PT[1] });
  const bytes = pdfDeImagens(paginas);
  descarregar(bytes, "relatorio-domus.pdf");
  return bytes;
}

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
