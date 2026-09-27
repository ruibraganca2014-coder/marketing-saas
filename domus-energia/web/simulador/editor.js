// Editor da planta (docs/SIMULADOR-ORCAMENTO.md §2): SVG com quadriculado de 50 cm,
// deslocar e aproximar (roda do rato, dois dedos), eventos de ponteiro para rato e
// toque, divisões (desenhar, mover, redimensionar), elementos (colocar, mover, rodar,
// apagar), propriedades, anular/refazer, alternativa por teclado e lista acessível,
// fundo (foto/PDF) com opacidade, escala e calibração.
// Todos os textos entram com textContent.

import { desenharPlanta, desenharIcone } from "./planta-svg.js";
import {
  ELEMENTOS, TIPOS_ELEMENTO, MODELOS, NOMES_DIVISAO, ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM,
  propsOmissao, atualizarDivisoes, divisaoDoElemento,
} from "./regras.js";
import { lerFundo, ErroFundo } from "./fundo.js";

const HISTORICO_MAX = 100;
const TOQUE_PX = 6;          // abaixo disto um arrasto é um toque
const PASSO_ELEMENTO = 10;   // cm (setas); Shift = × 5
const PASSO_DIVISAO = ESCALA_CM;

const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const svgEl = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
const limitar = (n, a, b) => Math.min(b, Math.max(a, n));
const ajustar = (v, passo) => Math.round(v / passo) * passo;
const metros = (cm) => (Math.round(cm) / 100).toLocaleString("pt-PT", { maximumFractionDigits: 2 });

/** Cópia da planta que partilha as strings (a imagem de fundo não se duplica). */
export function clonarPlanta(p) {
  return {
    ...p,
    fundo: p.fundo ? { ...p.fundo } : null,
    divisoes: p.divisoes.map((d) => ({ ...d })),
    elementos: p.elementos.map((e) => ({ ...e, props: { ...e.props } })),
  };
}

function botao(texto, cls = "btn sec pequeno", tipo = "button") {
  const b = el("button", cls, texto);
  b.type = tipo;
  return b;
}

function campo(rotulo, input, ajuda) {
  const l = el("label", "campo");
  l.append(el("span", null, rotulo), input);
  if (ajuda) l.append(el("small", "ajuda", ajuda));
  return l;
}

function caixa(rotulo, marcado, aoMudar, desativado = false) {
  const l = el("label", "caixa-linha");
  const i = document.createElement("input");
  i.type = "checkbox";
  i.checked = marcado;
  i.disabled = desativado;
  i.addEventListener("change", () => aoMudar(i.checked));
  l.append(i, el("span", null, rotulo));
  return l;
}

function numeroInput(valor, { min, max, step = 1, id }) {
  const i = document.createElement("input");
  i.type = "number";
  i.inputMode = "decimal";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(valor);
  if (id) i.id = id;
  return i;
}

/**
 * @param {HTMLElement} raiz
 * @param {{aoMudar: (planta: object) => void, anunciar?: (texto: string) => void}} opcoes
 */
export function criarEditor(raiz, { aoMudar, anunciar = null }) {
  let planta = null;
  let selecionado = null;
  let vista = { cx: 1000, cy: 750, w: 2100 };
  let modo = null;            // null | {tipo: "divisao"} | {tipo: "elemento", el: "tomada"} | {tipo: "calibrar", pontos: []}
  let arrasto = null;
  let desfazer = [];
  let refazer = [];
  const ponteiros = new Map();
  let pinca = null;
  let previsao = null;        // retângulo a desenhar (divisão nova)
  let aspetoFundo = null;     // altura/largura da imagem de fundo (px)

  // ---------------------------------------------------------------- DOM
  raiz.replaceChildren();
  raiz.classList.add("editor");

  const barra = el("div", "editor-barra");
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", "Pôr na planta");
  const bDivisao = botao("", "ferramenta");
  bDivisao.dataset.ferramenta = "divisao";
  bDivisao.setAttribute("aria-pressed", "false");
  const icDiv = svgEl("svg");
  icDiv.setAttribute("viewBox", "0 0 48 48");
  icDiv.setAttribute("aria-hidden", "true");
  const r = svgEl("rect");
  for (const [k, v] of Object.entries({ x: 9, y: 11, width: 30, height: 26, rx: 3, fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-dasharray": "5 3" })) r.setAttribute(k, v);
  icDiv.append(r);
  bDivisao.append(icDiv, el("span", null, "Divisão"));
  barra.append(bDivisao);
  const ferramentas = { divisao: bDivisao };
  for (const t of TIPOS_ELEMENTO) {
    const b = botao("", "ferramenta");
    b.dataset.ferramenta = t;
    b.setAttribute("aria-pressed", "false");
    b.append(desenharIcone(svgEl("svg"), t, ELEMENTOS[t].props), el("span", null, ELEMENTOS[t].nome));
    ferramentas[t] = b;
    barra.append(b);
  }

  const barra2 = el("div", "editor-barra2");
  const bDesfazer = botao("Anular");
  bDesfazer.setAttribute("aria-keyshortcuts", "Control+Z");
  const bRefazer = botao("Refazer");
  bRefazer.setAttribute("aria-keyshortcuts", "Control+Y");
  const bMenos = botao("−");
  bMenos.setAttribute("aria-label", "Afastar");
  const bMais = botao("+");
  bMais.setAttribute("aria-label", "Aproximar");
  const bTudo = botao("Ver tudo");
  barra2.append(bDesfazer, bRefazer, bMenos, bMais, bTudo);

  const dica = el("p", "editor-dica");
  dica.id = "editor-dica";
  dica.setAttribute("role", "status");
  // Sem anunciador próprio da página, as confirmações ("Na planta: Janela (divisão Cozinha).") aparecem na dica.
  const avisar = anunciar ?? ((t) => { dica.textContent = t; });

  // Ações rápidas do que está selecionado, logo por cima da planta: no telemóvel o painel de
  // propriedades fica abaixo da planta, fora do ecrã. Altura fixa para a planta não saltar.
  const selecao = el("div", "editor-selecao");
  const selecaoNome = el("span", "editor-selecao-nome");
  const sRodar = botao("Rodar");
  sRodar.id = "selecao-rodar";
  const sApagar = botao("Apagar", "btn sec pequeno perigo-sec");
  sApagar.id = "selecao-apagar";
  const sOpcoes = botao("Opções");
  sOpcoes.id = "selecao-opcoes";
  selecao.append(selecaoNome, sRodar, sApagar, sOpcoes);

  const area = el("div", "editor-area");
  const svg = svgEl("svg");
  svg.setAttribute("class", "editor-svg");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-roledescription", "planta");
  svg.setAttribute("aria-label", "Planta da casa");
  svg.setAttribute("aria-describedby", "editor-ajuda-teclado");
  area.append(svg);
  const ajudaTeclado = el("p", "editor-ajuda", "Com o teclado: escolha uma ferramenta e carregue em Enter para a pôr no centro; as setas movem o que está selecionado (Shift para mover mais), R roda, Delete apaga, Ctrl+Z anula.");
  ajudaTeclado.id = "editor-ajuda-teclado";

  const lado = el("div", "editor-lado");
  const props = el("section", "editor-props cartao");
  props.setAttribute("aria-labelledby", "editor-props-titulo");
  const listaSec = el("section", "editor-lista cartao");
  const listaTitulo = el("h3", null, "Lista da planta");
  listaTitulo.id = "editor-lista-titulo";
  listaSec.setAttribute("aria-labelledby", "editor-lista-titulo");
  const listaConteudo = el("div");
  listaSec.append(listaTitulo, el("p", "ajuda", "A mesma planta em lista: escolha uma divisão ou um elemento para o editar."), listaConteudo);

  // Fundo
  const fundoSec = el("details", "editor-fundo cartao");
  const fundoResumo = el("summary", null, "Fundo: foto ou PDF da sua planta");
  const fundoCorpo = el("div", "editor-fundo-corpo");
  fundoSec.append(fundoResumo, fundoCorpo);
  const ficheiro = document.createElement("input");
  ficheiro.type = "file";
  ficheiro.accept = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
  ficheiro.id = "editor-ficheiro";
  const fundoMsg = el("p", "msg", "");
  fundoMsg.hidden = true;
  fundoMsg.setAttribute("role", "status");
  const fundoControlos = el("div", "editor-fundo-controlos");

  // Tamanho da planta
  const tamSec = el("details", "editor-tamanho cartao");
  tamSec.append(el("summary", null, "Tamanho da planta"));
  const tamCorpo = el("div", "duas");
  tamSec.append(tamCorpo);

  lado.append(props, fundoSec, tamSec, listaSec);
  const principal = el("div", "editor-principal");
  principal.append(barra, barra2, dica, selecao, area, ajudaTeclado);
  raiz.append(principal, lado);

  // ---------------------------------------------------------------- vista
  const rectSvg = () => svg.getBoundingClientRect();
  function caixaVista() {
    const rr = rectSvg();
    const razao = rr.width > 0 ? rr.height / rr.width : 0.75;
    const h = vista.w * razao;
    return { x: vista.cx - vista.w / 2, y: vista.cy - h / 2, w: vista.w, h };
  }
  const pxPorCm = () => (rectSvg().width || 600) / vista.w;
  function paraPlanta(clientX, clientY) {
    const rr = rectSvg();
    const v = caixaVista();
    return { x: v.x + ((clientX - rr.left) / (rr.width || 1)) * v.w, y: v.y + ((clientY - rr.top) / (rr.height || 1)) * v.h };
  }
  const maxW = () => Math.max(planta.largura_cm, planta.altura_cm) * 3;
  function verTudo() {
    const rr = rectSvg();
    const razao = rr.width > 0 ? rr.height / rr.width : 0.75;
    vista = { cx: planta.largura_cm / 2, cy: planta.altura_cm / 2, w: Math.max(planta.largura_cm, planta.altura_cm / razao) * 1.06 };
  }
  function zoom(f, clientX, clientY) {
    const rr = rectSvg();
    const cx = clientX ?? rr.left + rr.width / 2;
    const cy = clientY ?? rr.top + rr.height / 2;
    const p = paraPlanta(cx, cy);
    vista.w = limitar(vista.w * f, 150, maxW());
    fixarPonto(p, cx, cy);
    desenhar();
  }
  /** Ajusta o centro para o ponto `p` (cm) ficar debaixo de (clientX, clientY). */
  function fixarPonto(p, clientX, clientY) {
    const rr = rectSvg();
    const v = caixaVista();
    vista.cx = p.x - ((clientX - rr.left) / (rr.width || 1)) * v.w + v.w / 2;
    vista.cy = p.y - ((clientY - rr.top) / (rr.height || 1)) * v.h + v.h / 2;
  }

  // ---------------------------------------------------------------- histórico
  function memorizar() {
    desfazer.push(clonarPlanta(planta));
    if (desfazer.length > HISTORICO_MAX) desfazer.shift();
    refazer = [];
  }
  function confirmar(texto) {
    atualizarDivisoes(planta);
    aoMudar(planta);
    desenharTudo();
    if (texto) avisar(texto);
  }
  function anular() {
    if (!desfazer.length) return;
    refazer.push(clonarPlanta(planta));
    planta = desfazer.pop();
    if (selecionado && !existe(selecionado)) selecionado = null;
    confirmar("Anulado.");
  }
  function refazerAcao() {
    if (!refazer.length) return;
    desfazer.push(clonarPlanta(planta));
    planta = refazer.pop();
    if (selecionado && !existe(selecionado)) selecionado = null;
    confirmar("Refeito.");
  }
  const existe = (id) => planta.divisoes.some((d) => d.id === id) || planta.elementos.some((e) => e.id === id);
  const obterDivisao = (id) => planta.divisoes.find((d) => d.id === id);
  const obterElemento = (id) => planta.elementos.find((e) => e.id === id);

  function novoId(pre, lista) {
    let m = 0;
    for (const x of lista) m = Math.max(m, Number(String(x.id).slice(1)) || 0);
    return `${pre}${m + 1}`;
  }

  // ---------------------------------------------------------------- ações
  function nomeNovaDivisao() {
    const usados = new Set(planta.divisoes.map((d) => d.nome));
    return NOMES_DIVISAO.find((n) => !usados.has(n)) ?? `Divisão ${planta.divisoes.length + 1}`;
  }

  function adicionarDivisao(x, y, w, h) {
    if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return null; }
    memorizar();
    const d = {
      id: novoId("d", planta.divisoes), nome: nomeNovaDivisao(),
      x_cm: limitar(ajustar(x, ESCALA_CM), 0, planta.largura_cm - ESCALA_CM),
      y_cm: limitar(ajustar(y, ESCALA_CM), 0, planta.altura_cm - ESCALA_CM),
      largura_cm: Math.max(ESCALA_CM, ajustar(w, ESCALA_CM)),
      altura_cm: Math.max(ESCALA_CM, ajustar(h, ESCALA_CM)),
    };
    d.largura_cm = Math.min(d.largura_cm, planta.largura_cm - d.x_cm);
    d.altura_cm = Math.min(d.altura_cm, planta.altura_cm - d.y_cm);
    planta.divisoes.push(d);
    selecionado = d.id;
    confirmar(`Divisão "${d.nome}" criada. Pode mudar o nome e o tamanho ao lado.`);
    return d;
  }

  function adicionarElemento(tipo, x, y) {
    if (planta.elementos.length >= MAX_ELEMENTOS) { avisar(`A planta já tem o máximo de ${MAX_ELEMENTOS} elementos.`); return null; }
    memorizar();
    const e = {
      id: novoId("e", planta.elementos), tipo,
      x_cm: limitar(ajustar(x, PASSO_ELEMENTO), 0, planta.largura_cm),
      y_cm: limitar(ajustar(y, PASSO_ELEMENTO), 0, planta.altura_cm),
      rot: 0, divisao: null, props: propsOmissao(tipo),
    };
    planta.elementos.push(e);
    e.divisao = divisaoDoElemento(planta, e);
    selecionado = e.id;
    const onde = e.divisao ? `divisão ${obterDivisao(e.divisao)?.nome || "sem nome"}` : "fora das divisões: arraste-o para dentro de uma divisão para contar nela";
    confirmar(`Na planta: ${ELEMENTOS[tipo].nome} (${onde}).`);
    return e;
  }

  function apagarSelecionado() {
    if (!selecionado) return;
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) return;
    memorizar();
    if (d) planta.divisoes = planta.divisoes.filter((x) => x !== d);
    if (e) planta.elementos = planta.elementos.filter((x) => x !== e);
    selecionado = null;
    confirmar(d ? `Divisão "${d.nome}" apagada (os elementos ficaram).` : `Apagado da planta: ${ELEMENTOS[e.tipo].nome}.`);
    svg.focus({ preventScroll: true });
  }

  function rodarSelecionado() {
    const e = obterElemento(selecionado);
    if (!e || !ELEMENTOS[e.tipo].roda) return;
    memorizar();
    e.rot = (e.rot + 90) % 360;
    confirmar(`Rodado para ${e.rot}°.`);
  }

  function moverSelecionado(dx, dy) {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) return false;
    memorizar();
    if (e) {
      e.x_cm = limitar(e.x_cm + dx, 0, planta.largura_cm);
      e.y_cm = limitar(e.y_cm + dy, 0, planta.altura_cm);
    } else {
      moverDivisao(d, dx, dy, planta.elementos.filter((x) => x.divisao === d.id).map((x) => [x, x.x_cm, x.y_cm]), d.x_cm, d.y_cm);
    }
    confirmar();
    return true;
  }

  function moverDivisao(d, dx, dy, dentro, x0, y0) {
    const nx = limitar(ajustar(x0 + dx, ESCALA_CM), 0, planta.largura_cm - d.largura_cm);
    const ny = limitar(ajustar(y0 + dy, ESCALA_CM), 0, planta.altura_cm - d.altura_cm);
    const rx = nx - x0, ry = ny - y0;
    d.x_cm = nx;
    d.y_cm = ny;
    for (const [e, ex, ey] of dentro) {
      e.x_cm = limitar(ex + rx, 0, planta.largura_cm);
      e.y_cm = limitar(ey + ry, 0, planta.altura_cm);
    }
  }

  function centroColocacao() {
    const d = obterDivisao(selecionado);
    if (d) return { x: d.x_cm + d.largura_cm / 2, y: d.y_cm + d.altura_cm / 2 };
    return { x: limitar(vista.cx, 0, planta.largura_cm), y: limitar(vista.cy, 0, planta.altura_cm) };
  }

  function definirModo(m) {
    modo = m;
    for (const [k, b] of Object.entries(ferramentas)) {
      b.setAttribute("aria-pressed", String(!!m && ((m.tipo === "divisao" && k === "divisao") || (m.tipo === "elemento" && m.el === k))));
    }
    svg.classList.toggle("a-colocar", !!m);
    if (!m) dica.textContent = "Toque numa ferramenta e depois na planta. Arraste para deslocar; dois dedos ou a roda do rato para aproximar.";
    else if (m.tipo === "divisao") dica.textContent = "Arraste na planta para desenhar a divisão (ou toque para uma de 4 × 3 m). Esc cancela.";
    else if (m.tipo === "elemento") dica.textContent = `Toque na planta onde quer pôr: ${ELEMENTOS[m.el].nome}. Esc cancela.`;
    else if (m.tipo === "calibrar") dica.textContent = m.pontos.length ? "Agora toque no fim da mesma parede." : "Calibrar: toque no início de uma parede que conheça, na imagem de fundo.";
    previsao = null;
    desenhar();
  }

  for (const [k, b] of Object.entries(ferramentas)) {
    b.addEventListener("click", (ev) => {
      const ativo = b.getAttribute("aria-pressed") === "true";
      if (ativo) { definirModo(null); return; }
      // Teclado (Enter/Espaço, detail 0): põe logo no centro da vista (ou da divisão selecionada).
      if (ev.detail === 0) {
        const c = centroColocacao();
        definirModo(null);
        if (k === "divisao") adicionarDivisao(c.x - 200, c.y - 150, 400, 300);
        else adicionarElemento(k, c.x, c.y);
        svg.focus({ preventScroll: true });
        return;
      }
      definirModo(k === "divisao" ? { tipo: "divisao" } : { tipo: "elemento", el: k });
    });
  }
  bDesfazer.addEventListener("click", anular);
  bRefazer.addEventListener("click", refazerAcao);
  bMais.addEventListener("click", () => zoom(1 / 1.4));
  bMenos.addEventListener("click", () => zoom(1.4));
  bTudo.addEventListener("click", () => { verTudo(); desenhar(); });

  // ---------------------------------------------------------------- ponteiro
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button > 0) return;
    svg.setPointerCapture?.(ev.pointerId);
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ponteiros.size === 2) {
      // Dois dedos: aproximar/deslocar; cancela o arrasto (o que já mexeu fica memorizado).
      if (arrasto?.mexeu) terminarArrasto(); else arrasto = null;
      previsao = null;
      const [a, b] = [...ponteiros.values()];
      const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, w0: vista.w, p0: paraPlanta(meio.x, meio.y) };
      return;
    }
    if (ponteiros.size > 2) return;
    ev.preventDefault();
    svg.focus({ preventScroll: true });
    const p = paraPlanta(ev.clientX, ev.clientY);
    const base = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, p0: p, mexeu: false };
    if (modo) { arrasto = { ...base, tipo: modo.tipo === "divisao" ? "desenhar" : "colocar" }; return; }
    const alvo = ev.target.closest?.("[data-pega], [data-elemento], [data-divisao]");
    if (alvo?.dataset.pega) {
      const d = obterDivisao(alvo.dataset.id);
      if (d) { arrasto = { ...base, tipo: "redimensionar", canto: alvo.dataset.pega, d, orig: { ...d } }; return; }
    }
    if (alvo?.dataset.elemento) {
      const e = obterElemento(alvo.dataset.elemento);
      if (e) {
        const mudou = selecionado !== e.id;
        selecionado = e.id;
        arrasto = { ...base, tipo: "elemento", e, x0: e.x_cm, y0: e.y_cm };
        if (mudou) desenharTudo();
        return;
      }
    }
    if (alvo?.dataset.divisao && selecionado === alvo.dataset.divisao) {
      const d = obterDivisao(alvo.dataset.divisao);
      arrasto = { ...base, tipo: "divisao", d, x0: d.x_cm, y0: d.y_cm, dentro: planta.elementos.filter((x) => x.divisao === d.id).map((x) => [x, x.x_cm, x.y_cm]) };
      return;
    }
    // Divisão não selecionada ou vazio: arrastar desloca a vista; tocar seleciona.
    arrasto = { ...base, tipo: "deslocar", alvo: alvo?.dataset.divisao ?? null };
  });

  svg.addEventListener("pointermove", (ev) => {
    if (!ponteiros.has(ev.pointerId)) return;
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinca && ponteiros.size >= 2) {
      const [a, b] = [...ponteiros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      vista.w = limitar(pinca.w0 * (pinca.d0 / d), 150, maxW());
      fixarPonto(pinca.p0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      desenhar();
      return;
    }
    if (!arrasto || arrasto.id !== ev.pointerId) return;
    if (!arrasto.mexeu && Math.hypot(ev.clientX - arrasto.sx, ev.clientY - arrasto.sy) < TOQUE_PX) return;
    const inicio = !arrasto.mexeu;
    arrasto.mexeu = true;
    const p = paraPlanta(ev.clientX, ev.clientY);
    const dx = p.x - arrasto.p0.x, dy = p.y - arrasto.p0.y;
    switch (arrasto.tipo) {
      case "deslocar":
        fixarPonto(arrasto.p0, ev.clientX, ev.clientY);
        desenhar();
        break;
      case "elemento":
        if (inicio) memorizar();
        arrasto.e.x_cm = limitar(ajustar(arrasto.x0 + dx, PASSO_ELEMENTO), 0, planta.largura_cm);
        arrasto.e.y_cm = limitar(ajustar(arrasto.y0 + dy, PASSO_ELEMENTO), 0, planta.altura_cm);
        desenhar();
        break;
      case "divisao":
        if (inicio) memorizar();
        moverDivisao(arrasto.d, dx, dy, arrasto.dentro, arrasto.x0, arrasto.y0);
        desenhar();
        break;
      case "redimensionar": {
        if (inicio) memorizar();
        const { d, orig, canto } = arrasto;
        let x1 = orig.x_cm, y1 = orig.y_cm, x2 = orig.x_cm + orig.largura_cm, y2 = orig.y_cm + orig.altura_cm;
        if (canto.includes("w")) x1 = limitar(ajustar(x1 + dx, ESCALA_CM), 0, x2 - ESCALA_CM);
        if (canto.includes("e")) x2 = limitar(ajustar(x2 + dx, ESCALA_CM), x1 + ESCALA_CM, planta.largura_cm);
        if (canto.includes("n")) y1 = limitar(ajustar(y1 + dy, ESCALA_CM), 0, y2 - ESCALA_CM);
        if (canto.includes("s")) y2 = limitar(ajustar(y2 + dy, ESCALA_CM), y1 + ESCALA_CM, planta.altura_cm);
        Object.assign(d, { x_cm: x1, y_cm: y1, largura_cm: x2 - x1, altura_cm: y2 - y1 });
        desenhar();
        break;
      }
      case "desenhar": {
        const x1 = limitar(ajustar(Math.min(arrasto.p0.x, p.x), ESCALA_CM), 0, planta.largura_cm);
        const y1 = limitar(ajustar(Math.min(arrasto.p0.y, p.y), ESCALA_CM), 0, planta.altura_cm);
        const x2 = limitar(ajustar(Math.max(arrasto.p0.x, p.x), ESCALA_CM), 0, planta.largura_cm);
        const y2 = limitar(ajustar(Math.max(arrasto.p0.y, p.y), ESCALA_CM), 0, planta.altura_cm);
        previsao = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        desenhar();
        break;
      }
      default: break;
    }
  });

  function terminarArrasto(ev) {
    const a = arrasto;
    arrasto = null;
    if (!a) return;
    const p = ev ? paraPlanta(ev.clientX, ev.clientY) : a.p0;
    if (a.tipo === "colocar") {
      const m = modo;
      definirModo(null);
      if (m?.tipo === "elemento") adicionarElemento(m.el, p.x, p.y);
      else if (m?.tipo === "calibrar") pontoCalibracao(p);
      return;
    }
    if (a.tipo === "desenhar") {
      const pv = previsao;
      definirModo(null);
      if (a.mexeu && pv && pv.w >= ESCALA_CM && pv.h >= ESCALA_CM) adicionarDivisao(pv.x, pv.y, pv.w, pv.h);
      else adicionarDivisao(p.x - 200, p.y - 150, 400, 300);
      return;
    }
    if (a.tipo === "deslocar") {
      if (!a.mexeu) {
        selecionado = a.alvo;
        desenharTudo();
        if (!a.alvo) definirModo(null);
        else avisar(`${obterDivisao(a.alvo)?.nome || "Divisão"} selecionada. Arraste para mover; use as pegas dos cantos para mudar o tamanho.`);
      }
      return;
    }
    if (a.mexeu) confirmar();
    else desenharTudo();
  }

  const fimPonteiro = (ev) => {
    const eraPinca = !!pinca;
    ponteiros.delete(ev.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (eraPinca) { arrasto = null; return; }
    if (arrasto && arrasto.id === ev.pointerId) {
      if (ev.type === "pointercancel") { arrasto = null; previsao = null; desenhar(); return; }
      terminarArrasto(ev);
    }
  };
  svg.addEventListener("pointerup", fimPonteiro);
  svg.addEventListener("pointercancel", fimPonteiro);
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const f = Math.exp(limitar(ev.deltaY, -300, 300) * (ev.deltaMode === 1 ? 0.05 : 0.0015));
    zoom(f, ev.clientX, ev.clientY);
  }, { passive: false });
  // Safari: gestos de pinça próprios não devem aproximar a página inteira.
  svg.addEventListener("gesturestart", (ev) => ev.preventDefault());

  // ---------------------------------------------------------------- teclado
  svg.addEventListener("keydown", (ev) => {
    const passo = (obterDivisao(selecionado) ? PASSO_DIVISAO : PASSO_ELEMENTO) * (ev.shiftKey ? 5 : 1);
    const setas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (setas[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = setas[ev.key];
      if (!moverSelecionado(dx * passo, dy * passo)) {
        vista.cx += dx * vista.w * 0.1;
        vista.cy += dy * vista.w * 0.1;
        desenhar();
      }
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); apagarSelecionado(); return; }
    if (ev.key === "r" || ev.key === "R") { if (!ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); rodarSelecionado(); } return; }
    if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); zoom(1 / 1.25); return; }
    if (ev.key === "-") { ev.preventDefault(); zoom(1.25); return; }
    if (ev.key === "Escape") {
      if (modo) definirModo(null);
      else if (selecionado) { selecionado = null; desenharTudo(); }
    }
  });
  raiz.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.target.matches?.("input, textarea, select")) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); anular(); } else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); refazerAcao(); }
  });

  // ---------------------------------------------------------------- calibração do fundo
  let calibracao = null;   // {p1, p2}
  function pontoCalibracao(p) {
    const pontos = [...(modo?.pontos ?? calibracao?.pontos ?? []), p];
    if (pontos.length < 2) {
      calibracao = { pontos };
      definirModo({ tipo: "calibrar", pontos });
      return;
    }
    calibracao = { pontos };
    desenharTudo();
    const input = fundoControlos.querySelector("#calibrar-metros");
    input?.focus();
  }

  function aplicarCalibracao(metrosReais) {
    const [a, b] = calibracao?.pontos ?? [];
    const f = planta.fundo;
    const medido = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    if (!f || medido < 5 || !(metrosReais > 0)) return false;
    const fator = (metrosReais * 100) / medido;
    memorizar();
    f.largura_cm = Math.round(limitar(f.largura_cm * fator, 10, 2 * MAX_LADO_CM));
    f.x_cm = Math.round(a.x - (a.x - f.x_cm) * fator);
    f.y_cm = Math.round(a.y - (a.y - f.y_cm) * fator);
    ajustarPlantaAoFundo();
    calibracao = null;
    confirmar(`Fundo calibrado: a imagem tem agora ${metros(f.largura_cm)} m de largura.`);
    return true;
  }

  function ajustarPlantaAoFundo() {
    const f = planta.fundo;
    if (!f) return;
    const dirX = f.x_cm + f.largura_cm;
    const dirY = f.y_cm + f.largura_cm * (aspetoFundo ?? 0.75);
    planta.largura_cm = limitar(Math.ceil(Math.max(dirX, ...planta.divisoes.map((d) => d.x_cm + d.largura_cm), 100) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
    planta.altura_cm = limitar(Math.ceil(Math.max(dirY, ...planta.divisoes.map((d) => d.y_cm + d.altura_cm), 100) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
  }

  function lerAspeto() {
    aspetoFundo = null;
    const f = planta?.fundo;
    if (!f) return;
    const img = new Image();
    img.onload = () => { if (planta?.fundo === f && img.naturalWidth) aspetoFundo = img.naturalHeight / img.naturalWidth; };
    img.src = f.imagem;
  }

  ficheiro.addEventListener("change", async () => {
    const f = ficheiro.files?.[0];
    if (!f) return;
    mostrarFundoMsg("A preparar a imagem…", "info");
    try {
      const r = await lerFundo(f);
      memorizar();
      aspetoFundo = r.altura / r.largura;
      planta.fundo = { imagem: r.imagem, x_cm: 0, y_cm: 0, largura_cm: planta.largura_cm, opacidade: 0.5 };
      planta.altura_cm = limitar(Math.ceil((planta.largura_cm * aspetoFundo) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
      verTudo();
      confirmar("Fundo carregado.");
      mostrarFundoMsg(`Fundo carregado (${Math.round((r.imagem.length * 3) / 4 / 1024)} KB). Agora calibre: marque uma parede que conheça e diga quanto mede.`, "ok");
    } catch (e) {
      mostrarFundoMsg(e instanceof ErroFundo ? e.message : "Não foi possível usar este ficheiro. Experimente uma fotografia (JPG ou PNG).", "erro");
    } finally {
      ficheiro.value = "";
    }
  });

  function mostrarFundoMsg(t, tipo) {
    fundoMsg.textContent = t;
    fundoMsg.className = `msg ${tipo}`;
    fundoMsg.hidden = !t;
  }

  function desenharFundo() {
    fundoCorpo.replaceChildren();
    const l = campo("Carregar planta (JPG, PNG ou PDF)", ficheiro, "A 1.ª página do PDF é convertida em imagem. Fica só neste navegador até enviar o pedido.");
    fundoCorpo.append(l, fundoMsg, fundoControlos);
    fundoControlos.replaceChildren();
    const f = planta.fundo;
    if (!f) return;
    const op = document.createElement("input");
    op.type = "range";
    op.min = "10";
    op.max = "100";
    op.step = "5";
    op.value = String(Math.round(f.opacidade * 100));
    op.id = "fundo-opacidade";
    op.addEventListener("input", () => { f.opacidade = Number(op.value) / 100; desenhar(); });
    op.addEventListener("change", () => { memorizarDepois(); });
    const larg = numeroInput(metros(f.largura_cm).replace(",", "."), { min: 0.5, max: 200, step: 0.1, id: "fundo-largura" });
    larg.addEventListener("change", () => {
      const v = Number(larg.value);
      if (!(v > 0)) return;
      memorizar();
      f.largura_cm = Math.round(limitar(v * 100, 10, 2 * MAX_LADO_CM));
      ajustarPlantaAoFundo();
      confirmar();
    });
    const px = numeroInput(f.x_cm / 100, { min: -100, max: 100, step: 0.1, id: "fundo-x" });
    const py = numeroInput(f.y_cm / 100, { min: -100, max: 100, step: 0.1, id: "fundo-y" });
    for (const [i, k] of [[px, "x_cm"], [py, "y_cm"]]) {
      i.addEventListener("change", () => {
        const v = Number(i.value);
        if (!Number.isFinite(v)) return;
        memorizar();
        f[k] = Math.round(limitar(v * 100, -MAX_LADO_CM, MAX_LADO_CM));
        confirmar();
      });
    }
    const opLabel = campo(`Opacidade (${op.value} %)`, op);
    op.addEventListener("input", () => { opLabel.firstChild.textContent = `Opacidade (${op.value} %)`; });
    const pos = el("div", "duas");
    pos.append(campo("Mover para a direita (m)", px), campo("Mover para baixo (m)", py));
    fundoControlos.append(opLabel, campo("Largura da imagem (m)", larg, "Ou calibre, que é mais fácil."), pos);

    const cal = el("div", "calibrar");
    if (calibracao?.pontos?.length === 2) {
      const med = Math.hypot(calibracao.pontos[1].x - calibracao.pontos[0].x, calibracao.pontos[1].y - calibracao.pontos[0].y);
      const m = numeroInput("", { min: 0.1, max: 200, step: 0.01, id: "calibrar-metros" });
      m.placeholder = metros(med);
      const aplicar = botao("Aplicar", "btn pequeno");
      const cancelar = botao("Cancelar");
      aplicar.id = "calibrar-aplicar";
      const erro = el("small", "falta-escolher", "");
      erro.hidden = true;
      aplicar.addEventListener("click", () => {
        if (!aplicarCalibracao(Number(String(m.value).replace(",", ".")))) { erro.textContent = "Escreva o comprimento real em metros (ex.: 4,5)."; erro.hidden = false; m.focus(); }
      });
      m.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); aplicar.click(); } });
      cancelar.addEventListener("click", () => { calibracao = null; desenharTudo(); });
      cal.append(campo("Quanto mede essa parede, em metros?", m), erro);
      const bs = el("div", "form-botoes");
      bs.append(aplicar, cancelar);
      cal.append(bs);
    } else {
      const b = botao("Calibrar: marcar uma parede");
      b.id = "calibrar";
      b.addEventListener("click", () => {
        calibracao = { pontos: [] };
        definirModo({ tipo: "calibrar", pontos: [] });
        svg.focus({ preventScroll: true });
        mostrarPlanta();
      });
      cal.append(b);
    }
    const rem = botao("Remover o fundo");
    rem.addEventListener("click", () => { memorizar(); planta.fundo = null; aspetoFundo = null; calibracao = null; confirmar("Fundo removido."); mostrarFundoMsg("", "info"); });
    const bs2 = el("div", "form-botoes");
    bs2.append(rem);
    fundoControlos.append(cal, bs2);
  }

  let memorizarPendente = null;
  function memorizarDepois() {
    // A opacidade muda em direto; só memoriza (e grava) quando o cliente larga.
    clearTimeout(memorizarPendente);
    memorizarPendente = setTimeout(() => { aoMudar(planta); }, 0);
  }

  function desenharTamanho() {
    tamCorpo.replaceChildren();
    const w = numeroInput(planta.largura_cm / 100, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-largura" });
    const h = numeroInput(planta.altura_cm / 100, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-altura" });
    for (const [i, k] of [[w, "largura_cm"], [h, "altura_cm"]]) {
      i.addEventListener("change", () => {
        const v = Number(i.value);
        if (!(v > 0)) return;
        memorizar();
        const min = k === "largura_cm" ? Math.max(100, ...planta.divisoes.map((d) => d.x_cm + d.largura_cm)) : Math.max(100, ...planta.divisoes.map((d) => d.y_cm + d.altura_cm));
        planta[k] = limitar(Math.ceil((v * 100) / ESCALA_CM) * ESCALA_CM, min, MAX_LADO_CM);
        for (const e of planta.elementos) { e.x_cm = Math.min(e.x_cm, planta.largura_cm); e.y_cm = Math.min(e.y_cm, planta.altura_cm); }
        verTudo();
        confirmar();
      });
    }
    tamCorpo.append(campo("Largura (m)", w), campo("Altura (m)", h));
  }

  // ---------------------------------------------------------------- propriedades
  function desenharPropriedades() {
    props.replaceChildren();
    const titulo = el("h3");
    titulo.id = "editor-props-titulo";
    titulo.tabIndex = -1;
    props.append(titulo);
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) {
      titulo.textContent = "Nada selecionado";
      props.append(el("p", "ajuda", "Toque numa divisão ou num elemento para o editar. Para começar, escolha \"Divisão\" e desenhe a sala."));
      return;
    }
    const acoes = el("div", "form-botoes editor-mover");
    const mover = [["←", "Mover para a esquerda", -1, 0], ["→", "Mover para a direita", 1, 0], ["↑", "Mover para cima", 0, -1], ["↓", "Mover para baixo", 0, 1]];
    for (const [s, rot, dx, dy] of mover) {
      const b = botao(s, "btn sec pequeno quadrado");
      b.setAttribute("aria-label", rot);
      b.addEventListener("click", () => { const p = d ? PASSO_DIVISAO : PASSO_ELEMENTO; moverSelecionado(dx * p, dy * p); });
      acoes.append(b);
    }
    if (d) {
      titulo.textContent = `Divisão: ${d.nome || "sem nome"}`;
      const nome = document.createElement("input");
      nome.id = "divisao-nome";
      nome.maxLength = 60;
      nome.value = d.nome;
      nome.setAttribute("list", "nomes-divisao");
      nome.autocomplete = "off";
      const dl = document.createElement("datalist");
      dl.id = "nomes-divisao";
      for (const n of NOMES_DIVISAO) { const o = document.createElement("option"); o.value = n; dl.append(o); }
      nome.addEventListener("change", () => {
        memorizar();
        d.nome = nome.value.trim().slice(0, 60) || "Divisão";
        confirmar();
      });
      const w = numeroInput(d.largura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.5, id: "divisao-largura" });
      const h = numeroInput(d.altura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.5, id: "divisao-altura" });
      for (const [i, k, lim] of [[w, "largura_cm", () => planta.largura_cm - d.x_cm], [h, "altura_cm", () => planta.altura_cm - d.y_cm]]) {
        i.addEventListener("change", () => {
          const v = Number(i.value);
          if (!(v > 0)) return;
          memorizar();
          d[k] = limitar(ajustar(v * 100, ESCALA_CM), ESCALA_CM, lim());
          confirmar();
        });
      }
      const dim = el("div", "duas");
      dim.append(campo("Largura (m)", w), campo("Comprimento (m)", h));
      const apagar = botao("Apagar divisão", "btn sec pequeno perigo-sec");
      apagar.addEventListener("click", apagarSelecionado);
      acoes.append(apagar);
      const n = planta.elementos.filter((x) => x.divisao === d.id).length;
      props.append(campo("Nome", nome), dl, dim, el("p", "ajuda", `${n} ${n === 1 ? "elemento" : "elementos"} nesta divisão. Com a divisão selecionada, os botões da barra põem os elementos no meio dela.`), acoes);
      return;
    }
    const def = ELEMENTOS[e.tipo];
    titulo.textContent = def.nome;
    const p = e.props;
    const muda = (f) => (v) => { memorizar(); f(v); confirmar(); };
    const corpo = el("div", "editor-props-campos");
    if (e.tipo === "porta") corpo.append(caixa("Porta da rua (entrada) — sugerimos um sensor", !!p.entrada, muda((v) => { p.entrada = v; })));
    if (e.tipo === "janela") {
      corpo.append(caixa("Tem estore", !!p.estore, muda((v) => { p.estore = v; if (!v) p.motorizado = false; })));
      corpo.append(caixa("Estore já motorizado (com motor elétrico)", !!p.motorizado, muda((v) => { p.motorizado = v; }), !p.estore));
    }
    if (e.tipo === "tomada") corpo.append(caixa("Tomada dupla", !!p.dupla, muda((v) => { p.dupla = v; })));
    if (e.tipo === "luz") corpo.append(caixa("Quero regular o brilho", !!p.brilho, muda((v) => { p.brilho = v; })));
    if (e.tipo === "interruptor") {
      const s = document.createElement("select");
      s.id = "elemento-botoes";
      for (const b of [1, 2, 3, 4]) { const o = document.createElement("option"); o.value = String(b); o.textContent = `${b} ${b === 1 ? "botão" : "botões"}`; s.append(o); }
      s.value = String(p.botoes);
      s.addEventListener("change", muda(() => { p.botoes = Number(s.value); }));
      corpo.append(campo("Botões", s));
    }
    if (e.tipo === "maquina") {
      const s = document.createElement("select");
      s.id = "elemento-modelo";
      for (const [k, m] of Object.entries(MODELOS)) { const o = document.createElement("option"); o.value = k; o.textContent = m.nome; s.append(o); }
      s.value = p.modelo;
      const w = numeroInput(p.potencia_w, { min: 0, max: 100000, step: 50, id: "elemento-potencia" });
      w.inputMode = "numeric";
      s.addEventListener("change", muda(() => { p.modelo = s.value; p.potencia_w = MODELOS[s.value].w; }));
      w.addEventListener("change", muda(() => { p.potencia_w = Math.round(limitar(Number(w.value) || 0, 0, 100000)); }));
      corpo.append(campo("Qual é", s), campo("Potência (W)", w, "Valor típico; mude se souber o da sua máquina."));
    }
    if (def.roda) {
      const b = botao(`Rodar (${e.rot}°)`);
      b.id = "elemento-rodar";
      b.setAttribute("aria-keyshortcuts", "R");
      b.addEventListener("click", rodarSelecionado);
      acoes.append(b);
    }
    const apagar = botao("Apagar", "btn sec pequeno perigo-sec");
    apagar.id = "elemento-apagar";
    apagar.setAttribute("aria-keyshortcuts", "Delete");
    apagar.addEventListener("click", apagarSelecionado);
    acoes.append(apagar);
    const onde = e.divisao ? obterDivisao(e.divisao)?.nome : null;
    props.append(el("p", "ajuda", onde ? `Na divisão: ${onde}` : "Fora das divisões. Arraste-o para dentro de uma divisão para o contarmos nela."), corpo, acoes);
  }

  /** No telemóvel os painéis estão abaixo da planta: traz a planta (e a dica) de volta ao ecrã. */
  function mostrarPlanta() {
    const r = area.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= innerHeight) return;
    dica.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function desenharSelecao() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    selecao.classList.toggle("vazia", !d && !e);
    selecaoNome.textContent = d ? `Divisão: ${d.nome || "sem nome"}` : e ? descreverElemento(e) : "Nada selecionado";
    sRodar.hidden = !e || !ELEMENTOS[e.tipo].roda;
    sApagar.hidden = !d && !e;
    sOpcoes.hidden = !d && !e;
    sApagar.setAttribute("aria-label", d ? `Apagar a divisão ${d.nome || ""}`.trim() : e ? `Apagar: ${descreverElemento(e)}` : "Apagar");
  }
  sRodar.addEventListener("click", rodarSelecionado);
  sApagar.addEventListener("click", apagarSelecionado);
  sOpcoes.addEventListener("click", () => {
    const t = document.getElementById("editor-props-titulo");
    t?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    t?.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- lista acessível
  function desenharLista() {
    listaConteudo.replaceChildren();
    if (!planta.divisoes.length && !planta.elementos.length) {
      listaConteudo.append(el("p", "ajuda", "A planta ainda está vazia."));
      return;
    }
    const ul = el("ul", "lista-planta");
    const itemElemento = (e) => {
      const li = el("li");
      const b = botao("", "item-planta");
      b.append(desenharIcone(svgEl("svg"), e.tipo, e.props), el("span", null, descreverElemento(e)));
      if (selecionado === e.id) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => selecionar(e.id));
      li.append(b);
      return li;
    };
    for (const d of planta.divisoes) {
      const li = el("li");
      const b = botao("", "item-planta divisao");
      b.append(el("span", null, `${d.nome || "Divisão"} — ${metros(d.largura_cm)} × ${metros(d.altura_cm)} m`));
      if (selecionado === d.id) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => selecionar(d.id));
      li.append(b);
      const els = planta.elementos.filter((e) => e.divisao === d.id);
      if (els.length) {
        const sub = el("ul");
        for (const e of els) sub.append(itemElemento(e));
        li.append(sub);
      }
      ul.append(li);
    }
    const fora = planta.elementos.filter((e) => !e.divisao);
    if (fora.length) {
      const li = el("li");
      li.append(el("span", "item-grupo", "Fora das divisões"));
      const sub = el("ul");
      for (const e of fora) sub.append(itemElemento(e));
      li.append(sub);
      ul.append(li);
    }
    listaConteudo.append(ul);
  }

  function descreverElemento(e) {
    const p = e.props;
    if (e.tipo === "porta") return p.entrada ? "Porta da rua" : "Porta";
    if (e.tipo === "janela") return p.estore ? (p.motorizado ? "Janela com estore motorizado" : "Janela com estore") : "Janela";
    if (e.tipo === "tomada") return p.dupla ? "Tomada dupla" : "Tomada";
    if (e.tipo === "luz") return p.brilho ? "Ponto de luz regulável" : "Ponto de luz";
    if (e.tipo === "interruptor") return `Interruptor de ${p.botoes} ${p.botoes === 1 ? "botão" : "botões"}`;
    if (e.tipo === "maquina") return `${MODELOS[p.modelo]?.nome ?? "Máquina"} (${p.potencia_w} W)`;
    return ELEMENTOS[e.tipo].nome;
  }

  function selecionar(id) {
    selecionado = id;
    desenharTudo();
    document.getElementById("editor-props-titulo")?.focus({ preventScroll: false });
  }

  // ---------------------------------------------------------------- desenho
  function desenhar() {
    if (!planta) return;
    const ppc = pxPorCm();
    const raio = limitar(15 / ppc, 12, 60);
    desenharPlanta(svg, planta, {
      selecionado, vista: caixaVista(), raio,
      raioToque: Math.max(raio, 22 / ppc), letra: limitar(14 / ppc, 10, 120), pega: limitar(38 / ppc, 10, 240),
    });
    const extra = (tag, atrs, estilo) => {
      const n = svgEl(tag);
      for (const [k, v] of Object.entries(atrs)) n.setAttribute(k, String(v));
      for (const [k, v] of Object.entries(estilo)) n.style.setProperty(k, v);
      svg.append(n);
    };
    if (previsao) {
      extra("rect", { x: previsao.x, y: previsao.y, width: previsao.w, height: previsao.h }, { fill: "color-mix(in srgb, var(--areia) 25%, transparent)", stroke: "var(--argila)", "stroke-width": "2px", "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
    }
    for (const p of calibracao?.pontos ?? []) {
      extra("circle", { cx: p.x, cy: p.y, r: 7 / ppc, "data-calibracao": "1" }, { fill: "var(--argila)", stroke: "var(--superficie)", "stroke-width": "2px", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
    }
    if (calibracao?.pontos?.length === 2) {
      const [a, b] = calibracao.pontos;
      extra("path", { d: `M${a.x} ${a.y}L${b.x} ${b.y}` }, { stroke: "var(--argila)", "stroke-width": "3px", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
    }
    const nD = planta.divisoes.length, nE = planta.elementos.length;
    svg.setAttribute("aria-label", `Planta da casa: ${nD} ${nD === 1 ? "divisão" : "divisões"}, ${nE} ${nE === 1 ? "elemento" : "elementos"}${selecionado ? `. Selecionado: ${obterDivisao(selecionado)?.nome ?? descreverElemento(obterElemento(selecionado) ?? { tipo: "luz", props: {} })}` : ""}`);
    bDesfazer.disabled = !desfazer.length;
    bRefazer.disabled = !refazer.length;
  }

  // Os painéis ao lado são refeitos a cada mudança: o foco volta ao mesmo controlo
  // (pelo id, ou pelo texto do rótulo/botão) para quem usa o teclado não o perder.
  function chaveFoco(a) {
    if (!a || !lado.contains(a)) return null;
    if (a.id) return { id: a.id };
    return { texto: (a.closest("label") ?? a).textContent, tag: a.tagName };
  }
  function repor(k) {
    if (!k) return;
    let alvo = k.id ? document.getElementById(k.id) : null;
    if (!alvo && k.texto != null) {
      alvo = [...lado.querySelectorAll(k.tag)].find((x) => (x.closest("label") ?? x).textContent === k.texto) ?? null;
    }
    if (alvo && !alvo.disabled) alvo.focus({ preventScroll: true });
  }

  function desenharTudo() {
    const foco = chaveFoco(document.activeElement);
    desenhar();
    desenharSelecao();
    desenharPropriedades();
    desenharLista();
    desenharFundo();
    desenharTamanho();
    repor(foco);
  }

  if (typeof ResizeObserver === "function") new ResizeObserver(() => desenhar()).observe(area);

  return {
    /** Abre (ou reabre) a planta no editor. */
    abrir(p, { reiniciarVista = true } = {}) {
      const nova = planta !== p;
      planta = p;
      if (nova) { desfazer = []; refazer = []; selecionado = null; calibracao = null; lerAspeto(); }
      if (reiniciarVista || nova) verTudo();
      definirModo(null);
      desenharTudo();
    },
    redesenhar: () => desenharTudo(),
    get planta() { return planta; },
    /** Só para testes/depuração: estado da vista. */
    get vista() { return { ...vista }; },
  };
}
