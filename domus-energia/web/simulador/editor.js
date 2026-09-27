// Editor da planta (docs/SIMULADOR-ORCAMENTO.md §2): SVG com quadriculado de 50 cm,
// deslocar e aproximar (roda do rato, dois dedos), eventos de ponteiro para rato e
// toque, divisões (criar num sítio livre com os aparelhos habituais, mover, mudar a forma pelos cantos — paredes oblíquas),
// elementos (colocar, mover, rodar, apagar; as telecomunicações "brevemente" à parte), propriedades, janela de edição (duplo
// clique ou toque longo), anular/refazer, alternativa por teclado e lista acessível,
// fundo (foto/PDF) com opacidade, escala e calibração; a vista ajusta-se ao conteúdo.
// Todos os textos entram com textContent.

import { desenharPlanta, desenharIcone } from "./planta-svg.js";
import {
  ELEMENTOS, TIPOS_ELEMENTO, TIPOS_TELECOM, TIPOS_DIVISAO, MODELOS, NOMES_DIVISAO, ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM,
  MAX_CANTOS, MIN_CANTOS, AREA_MIN_CM2,
  propsOmissao, atualizarDivisoes, divisaoDoElemento, divisaoEm, pontosDivisao, areaPoligono, ehRetangulo, caixaPontos,
  distanciaSegmento, paredesCruzam, validarPontos, definirPontos, pontoInterior,
} from "./regras.js";
import { lerFundo, ErroFundo } from "./fundo.js";
import { aparelhosOmissao, resumoAparelhos } from "./casa.js";

const HISTORICO_MAX = 100;
const TOQUE_PX = 6;          // abaixo disto um arrasto é um toque
const PASSO_ELEMENTO = 10;   // cm (setas); Shift = × 5
const PASSO_DIVISAO = ESCALA_CM;
const TOQUE_LONGO_MS = 500;  // toque longo (sem mexer) = duplo clique
const PAREDE_PX = { mouse: 10, toque: 18 };   // tolerância para acertar numa parede (duplo clique / toque longo)
const MARGEM_VISTA = 1.08;   // "Ver tudo": o conteúdo ocupa ~93 % da vista
const DESTAQUE_MS = 1500;    // a divisão nova pisca durante este tempo

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
const m2 = (cm2) => (Math.round(cm2 / 1000) / 10).toLocaleString("pt-PT", { maximumFractionDigits: 1 });
/** Número escrito pelo cliente (aceita vírgula); NaN se não for número. */
const lerNumero = (v) => (String(v ?? "").trim() === "" ? NaN : Number(String(v).replace(",", ".")));

/** Cópia da planta que partilha as strings (a imagem de fundo não se duplica). */
export function clonarPlanta(p) {
  return {
    ...p,
    fundo: p.fundo ? { ...p.fundo } : null,
    divisoes: p.divisoes.map((d) => ({ ...d, ...(d.pontos ? { pontos: d.pontos.map((q) => [...q]) } : {}) })),
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
  let modo = null;            // null | {tipo: "elemento", el: "tomada"} | {tipo: "calibrar", pontos: []}
  let arrasto = null;
  let desfazer = [];
  let refazer = [];
  const ponteiros = new Map();
  let pinca = null;
  let destaque = null;        // {id, desde}: a divisão acabada de criar pisca (DESTAQUE_MS)
  let aspetoFundo = null;     // altura/largura da imagem de fundo (px)
  let nDivisoesVista = 0;   // n.º de divisões quando a vista foi ajustada (confirmar)
  let ajusteAuto = false;     // a vista foi ajustada sozinha e o cliente ainda não a mexeu: reajusta se o tamanho mudar
  let toqueLongo = null;      // temporizador do toque longo
  let colocadoEm = 0;         // quando se pôs a última coisa com uma ferramenta (o 2.º clique não abre a janela)
  let tiposDivisao = TIPOS_DIVISAO;   // botões de divisão (mudam com o tipo de imóvel: definirTiposDivisao)

  // ---------------------------------------------------------------- DOM
  raiz.replaceChildren();
  raiz.classList.add("editor");

  // Um botão por tipo de divisão: cria-a logo, com o nome certo (Quarto 1, Quarto 2, Sala…); o que traz
  // (casa.js resumoAparelhos) fica só no nome acessível do botão.
  const barraDiv = el("div", "editor-barra editor-divisoes");
  barraDiv.setAttribute("role", "toolbar");
  barraDiv.setAttribute("aria-label", "Acrescentar divisão");
  const ferramentas = {};
  function desenharBotoesDivisao() {
    barraDiv.replaceChildren(el("span", "editor-barra-rotulo", "Divisões:"));
    for (const t of tiposDivisao) {
      const traz = resumoAparelhos(t.nome, t.w, t.h);
      const b = botao("", "ferramenta tipo-divisao");
      b.dataset.divisao = t.nome;
      b.setAttribute("aria-label", `Acrescentar ${t.nome === "Outra" ? "outra divisão" : t.nome} (com ${traz})`);
      const ic = svgEl("svg");
      ic.setAttribute("viewBox", "0 0 48 48");
      ic.setAttribute("aria-hidden", "true");
      const r = svgEl("rect");
      for (const [k, v] of Object.entries({ x: 9, y: 11, width: 30, height: 26, rx: 3, fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-dasharray": "5 3" })) r.setAttribute(k, v);
      ic.append(r);
      b.append(ic, el("span", "tipo-divisao-nome", t.nome));
      // O botão cria-a logo (rato, toque ou teclado), num sítio livre.
      b.addEventListener("click", () => {
        definirModo(null);
        if (criarDivisao(t.nome)) mostrarPlanta();
      });
      barraDiv.append(b);
    }
  }

  // Elementos: os da instalação elétrica e, à parte, as telecomunicações ("brevemente": fora do preço).
  const barraFerramentas = (tipos, rotulo, cls = "") => {
    const b0 = el("div", `editor-barra${cls}`);
    b0.setAttribute("role", "toolbar");
    b0.setAttribute("aria-label", rotulo);
    for (const t of tipos) {
      const b = botao("", `ferramenta${ELEMENTOS[t].telecom ? " telecom" : ""}`);
      b.dataset.ferramenta = t;
      b.setAttribute("aria-pressed", "false");
      b.append(desenharIcone(svgEl("svg"), t, ELEMENTOS[t].props), el("span", null, ELEMENTOS[t].nome));
      ferramentas[t] = b;
      b0.append(b);
    }
    return b0;
  };
  const barra = barraFerramentas(TIPOS_ELEMENTO.filter((t) => !ELEMENTOS[t].telecom), "Pôr na planta");
  const barraTelecom = barraFerramentas(TIPOS_TELECOM, "Telecomunicações (brevemente)", " editor-telecom");
  const telecomRotulo = el("span", "editor-barra-rotulo", "Telecomunicações — brevemente:");
  telecomRotulo.title = "Pode desenhá-las já; ainda não entram no preço (orçamento na visita).";
  barraTelecom.prepend(telecomRotulo);

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
  const ajudaTeclado = el("p", "editor-ajuda", "Com o teclado: escolha uma ferramenta e carregue em Enter para a pôr no centro; as setas movem o que está selecionado (Shift para mover mais), Enter abre as opções (também os cantos da divisão, em metros), R roda, Delete apaga, Ctrl+Z anula.");
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
  principal.append(barraDiv, barra, barraTelecom, barra2, dica, selecao, area, ajudaTeclado);

  // Janela de edição (duplo clique, toque longo, Enter ou "Opções"): <dialog> modal, Esc fecha.
  const dialogo = el("dialog", "editor-dialogo");
  dialogo.setAttribute("aria-labelledby", "dlg-titulo");
  const dlgForm = el("form", "editor-dialogo-form");
  // Sem a validação do navegador: o passo dos campos (0,5 m, 0,1 m) não pode impedir de guardar uma
  // medida como 6,2 m; os valores são verificados em guardarDialogo, com mensagens em português.
  dlgForm.noValidate = true;
  const dlgTitulo = el("h2");
  dlgTitulo.id = "dlg-titulo";
  const dlgCorpo = el("div", "editor-dialogo-corpo");
  const dlgErro = el("p", "msg erro");
  dlgErro.id = "dlg-erro";
  dlgErro.setAttribute("role", "alert");
  dlgErro.hidden = true;
  const dGuardar = botao("Guardar", "btn pequeno", "submit");
  dGuardar.id = "dlg-guardar";
  const dApagar = botao("Apagar", "btn sec pequeno perigo-sec");
  dApagar.id = "dlg-apagar";
  const dCancelar = botao("Cancelar");
  dCancelar.id = "dlg-cancelar";
  const dlgBotoes = el("div", "form-botoes");
  dlgBotoes.append(dGuardar, dApagar, dCancelar);
  dlgForm.append(dlgTitulo, dlgCorpo, dlgErro, dlgBotoes);
  dialogo.append(dlgForm);
  raiz.append(principal, lado, dialogo);

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
  /** Caixa do que está desenhado (divisões, elementos e a parte visível do fundo); a planta toda se vazia. */
  function caixaConteudo() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const juntar = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
    for (const d of planta.divisoes) juntar(d.x_cm, d.y_cm, d.x_cm + d.largura_cm, d.y_cm + d.altura_cm);
    for (const e of planta.elementos) juntar(e.x_cm - 40, e.y_cm - 40, e.x_cm + 40, e.y_cm + 40);   // o ícone à volta do centro
    const f = planta.fundo;
    if (f) {
      // A imagem só se vê dentro da planta (recorte do planta-svg.js).
      const h = f.largura_cm * (aspetoFundo ?? 0.75);
      juntar(Math.max(0, f.x_cm), Math.max(0, f.y_cm), Math.min(planta.largura_cm, f.x_cm + f.largura_cm), Math.min(planta.altura_cm, f.y_cm + h));
    }
    if (!(x2 > x1) || !(y2 > y1)) return { x: 0, y: 0, w: planta.largura_cm, h: planta.altura_cm };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  /**
   * Ajusta a vista a todo o conteúdo, grande e com pouca margem. Só nos momentos certos (abrir o
   * passo, planta gerada, fundo carregado, "Ver tudo"); até o cliente mexer na vista, reajusta
   * quando o tamanho da planta no ecrã muda (ex.: o passo acabou de aparecer).
   */
  function verTudo() {
    const rr = rectSvg();
    const razao = rr.width > 0 && rr.height > 0 ? rr.height / rr.width : 0.75;
    const c = caixaConteudo();
    vista = { cx: c.x + c.w / 2, cy: c.y + c.h / 2, w: limitar(Math.max(c.w, c.h / razao) * MARGEM_VISTA, 150, maxW()) };
    ajusteAuto = true;
  }
  function zoom(f, clientX, clientY) {
    ajusteAuto = false;
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
    // Vista parada: só volta a mostrar a planta inteira e centrada quando se acrescenta ou apaga uma
    // divisão (mexer em objetos, arrastar ou mudar a forma não mexe na vista).
    if (planta.divisoes.length !== nDivisoesVista) { nDivisoesVista = planta.divisoes.length; verTudo(); }
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
  const tipoDivisao = (nome) => tiposDivisao.find((t) => t.nome === nome);
  function nomeNovaDivisao(div) {
    const usados = new Set(planta.divisoes.map((d) => d.nome));
    const t = tipoDivisao(div);
    if (!t || t.nome === "Outra") {
      for (let n = planta.divisoes.length + 1; ; n++) if (!usados.has(`Divisão ${n}`)) return `Divisão ${n}`;
    }
    if (!t.numerar && !usados.has(t.nome)) return t.nome;
    for (let n = t.numerar ? 1 : 2; ; n++) if (!usados.has(`${t.nome} ${n}`)) return `${t.nome} ${n}`;
  }
  /**
   * Sítio (canto de cima à esquerda, cm) para uma divisão nova w × h que não sobrepõe as outras (pela
   * caixa envolvente) nem apanha elementos soltos (os que não estão dentro de nenhuma divisão; os
   * aparelhos de uma divisão vizinha, junto à parede partilhada, não impedem de encostar): primeiro
   * encostada à direita ou por baixo de uma divisão (por ordem de leitura), depois a primeira posição
   * livre da grelha de 50 cm dentro da planta; se nada couber, à direita de tudo (ou por baixo), sempre
   * na grelha de 50 cm — a planta alarga (criarDivisao).
   */
  function sitioLivre(w, h) {
    const caixas = planta.divisoes.map((d) => [d.x_cm, d.y_cm, d.x_cm + d.largura_cm, d.y_cm + d.altura_cm]);
    const soltos = planta.elementos.filter((q) => !divisaoEm(planta, q.x_cm, q.y_cm));
    const livre = (x, y) => x >= 0 && y >= 0 && x + w <= MAX_LADO_CM && y + h <= MAX_LADO_CM
      && caixas.every(([a, b, c, e]) => x >= c || x + w <= a || y >= e || y + h <= b)
      && soltos.every((q) => q.x_cm < x - 20 || q.x_cm > x + w + 20 || q.y_cm < y - 20 || q.y_cm > y + h + 20);
    const cabe = (x, y) => x + w <= planta.largura_cm && y + h <= planta.altura_cm && livre(x, y);
    const encostadas = caixas.flatMap(([a, b, c, e]) => [[c, b], [a, e]]).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    const r = encostadas.find(([x, y]) => cabe(x, y));
    if (r) return r;
    for (let y = ESCALA_CM; y + h <= planta.altura_cm; y += ESCALA_CM) {
      for (let x = ESCALA_CM; x + w <= planta.largura_cm; x += ESCALA_CM) if (cabe(x, y)) return [x, y];
    }
    // Fora da planta: à direita ou por baixo de tudo (divisões e elementos soltos, com a folga deles),
    // arredondado para fora à grelha de 50 cm (o canto fica sempre na grelha).
    const xs = [...caixas.flatMap(([a, , c]) => [a, c]), ...soltos.flatMap((q) => [q.x_cm - 20, q.x_cm + 20])];
    const ys = [...caixas.flatMap(([, b, , e]) => [b, e]), ...soltos.flatMap((q) => [q.y_cm - 20, q.y_cm + 20])];
    const fora = xs.length
      ? [[Math.ceil(Math.max(...xs) / ESCALA_CM) * ESCALA_CM, Math.max(0, Math.floor(Math.min(...ys) / ESCALA_CM) * ESCALA_CM)],
        [Math.max(0, Math.floor(Math.min(...xs) / ESCALA_CM) * ESCALA_CM), Math.ceil(Math.max(...ys) / ESCALA_CM) * ESCALA_CM]]
      : [[ESCALA_CM, ESCALA_CM]];
    for (const [x, y] of [...fora, ...encostadas]) if (livre(x, y)) return [x, y];
    return [0, 0];
  }

  /**
   * Botão por tipo de divisão: cria logo um retângulo com o tamanho típico num sítio livre, com os
   * aparelhos habituais (casa.js aparelhosOmissao, os mesmos da planta desenhada pela casa), seleciona-o,
   * mostra-o (a vista ajusta-se se estiver fora dela) e fá-lo piscar. A forma muda-se depois pelos cantos.
   */
  function criarDivisao(div) {
    if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return null; }
    const t = tipoDivisao(div) ?? { w: 400, h: 300 };
    const [x, y] = sitioLivre(t.w, t.h);
    memorizar();
    const grelha = (v) => Math.min(MAX_LADO_CM, Math.ceil(v / ESCALA_CM) * ESCALA_CM);
    planta.largura_cm = Math.max(planta.largura_cm, grelha(x + t.w + ESCALA_CM));
    planta.altura_cm = Math.max(planta.altura_cm, grelha(y + t.h + ESCALA_CM));
    const d = { id: novoId("d", planta.divisoes), nome: nomeNovaDivisao(div), x_cm: x, y_cm: y, largura_cm: t.w, altura_cm: t.h };
    planta.divisoes.push(d);
    let n = 0;
    for (const a of aparelhosOmissao(d.nome, d)) {
      if (planta.elementos.length >= MAX_ELEMENTOS) break;
      planta.elementos.push({ id: novoId("e", planta.elementos), ...a });
      n++;
    }
    ajustarFolha();
    selecionado = d.id;
    destaque = { id: d.id, desde: performance.now() };
    setTimeout(() => { if (destaque?.id === d.id) { destaque = null; desenhar(); } }, DESTAQUE_MS);
    confirmar(`Divisão "${d.nome}" criada${n ? ` com ${n} aparelhos habituais (porta, interruptor, luz, sensor de movimento…)` : ""}. Arraste-a para o sítio certo, os cantos mudam a forma; duplo clique (ou toque longo) abre as opções.`);
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

  /**
   * Folha à medida: sem fundo, a planta encolhe (ou cresce) para o tamanho das divisões e elementos,
   * com uma margem de uma quadrícula, e o conteúdo passa a começar nessa margem (tudo desloca junto).
   * Com fundo (foto/PDF) quem manda é a imagem: não mexe.
   */
  function ajustarFolha() {
    if (planta.fundo || (!planta.divisoes.length && !planta.elementos.length)) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const d of planta.divisoes) { x1 = Math.min(x1, d.x_cm); y1 = Math.min(y1, d.y_cm); x2 = Math.max(x2, d.x_cm + d.largura_cm); y2 = Math.max(y2, d.y_cm + d.altura_cm); }
    for (const e of planta.elementos) { x1 = Math.min(x1, e.x_cm); y1 = Math.min(y1, e.y_cm); x2 = Math.max(x2, e.x_cm); y2 = Math.max(y2, e.y_cm); }
    const dx = ESCALA_CM - Math.floor(x1 / ESCALA_CM) * ESCALA_CM;
    const dy = ESCALA_CM - Math.floor(y1 / ESCALA_CM) * ESCALA_CM;
    for (const d of planta.divisoes) {
      d.x_cm += dx; d.y_cm += dy;
      if (d.pontos) d.pontos = d.pontos.map(([px, py]) => [px + dx, py + dy]);
    }
    for (const e of planta.elementos) { e.x_cm += dx; e.y_cm += dy; }
    planta.largura_cm = limitar(Math.ceil((x2 + dx) / ESCALA_CM) * ESCALA_CM + ESCALA_CM, 100, MAX_LADO_CM);
    planta.altura_cm = limitar(Math.ceil((y2 + dy) / ESCALA_CM) * ESCALA_CM + ESCALA_CM, 100, MAX_LADO_CM);
  }

  function apagarSelecionado() {
    if (!selecionado) return;
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) return;
    memorizar();
    if (d) planta.divisoes = planta.divisoes.filter((x) => x !== d);
    if (e) planta.elementos = planta.elementos.filter((x) => x !== e);
    if (d) ajustarFolha();
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
      moverDivisao(d, dx, dy, elementosDentro(d), d.x_cm, d.y_cm, d.pontos ?? null);
    }
    confirmar();
    return true;
  }

  const elementosDentro = (d) => planta.elementos.filter((x) => x.divisao === d.id).map((x) => [x, x.x_cm, x.y_cm]);

  /** Move a divisão (a caixa ajusta-se à grelha; os cantos de um polígono andam todos o mesmo) e os elementos dentro. */
  function moverDivisao(d, dx, dy, dentro, x0, y0, pts0 = null) {
    const nx = limitar(ajustar(x0 + dx, ESCALA_CM), 0, planta.largura_cm - d.largura_cm);
    const ny = limitar(ajustar(y0 + dy, ESCALA_CM), 0, planta.altura_cm - d.altura_cm);
    const rx = nx - x0, ry = ny - y0;
    d.x_cm = nx;
    d.y_cm = ny;
    if (pts0) d.pontos = pts0.map(([x, y]) => [x + rx, y + ry]);
    for (const [e, ex, ey] of dentro) {
      e.x_cm = limitar(ex + rx, 0, planta.largura_cm);
      e.y_cm = limitar(ey + ry, 0, planta.altura_cm);
    }
  }

  // ---------------------------------------------------------------- cantos (paredes oblíquas)
  /** Canto novo na parede i (entre o canto i e o seguinte), no ponto `p` da parede. */
  function acrescentarCanto(d, i, p) {
    const pts = pontosDivisao(d);
    if (pts.length >= MAX_CANTOS) { avisar(`Uma divisão tem no máximo ${MAX_CANTOS} cantos.`); return; }
    const novo = [Math.round(limitar(p.x, 0, planta.largura_cm)), Math.round(limitar(p.y, 0, planta.altura_cm))];
    pts.splice(i + 1, 0, novo);
    const v = validarPontos(pts, planta.largura_cm, planta.altura_cm);
    if (!v) { avisar("Não foi possível pôr um canto aqui: está demasiado perto de outro."); return; }
    memorizar();
    definirPontos(d, v);
    selecionado = d.id;
    confirmar(`Canto acrescentado à divisão "${d.nome || "Divisão"}" (${v.length} cantos). Arraste-o para inclinar a parede.`);
  }

  function apagarCanto(d, i) {
    const pts = pontosDivisao(d);
    if (pts.length <= MIN_CANTOS) { avisar(`Uma divisão tem pelo menos ${MIN_CANTOS} cantos.`); return; }
    pts.splice(i, 1);
    const v = validarPontos(pts, planta.largura_cm, planta.altura_cm);
    if (!v) { avisar("Sem este canto as paredes cruzavam-se ou a divisão ficava pequena demais: mova-o em vez de o apagar."); return; }
    memorizar();
    definirPontos(d, v);
    confirmar(`Canto apagado (${v.length} cantos).`);
  }

  /** Muda um canto enquanto se arrasta: só aceita formas válidas (sem paredes cruzadas). */
  function moverCanto(d, pts0, i, x, y) {
    const pts = pts0.map((q) => [...q]);
    pts[i] = [Math.round(limitar(x, 0, planta.largura_cm)), Math.round(limitar(y, 0, planta.altura_cm))];
    const vizinhoIgual = pts.some((q, j) => j !== i && q[0] === pts[i][0] && q[1] === pts[i][1]);
    if (vizinhoIgual || paredesCruzam(pts) || areaPoligono(pts) < AREA_MIN_CM2) return false;
    definirPontos(d, validarPontos(pts, planta.largura_cm, planta.altura_cm) ?? pts0);
    return true;
  }

  /** Raios dos ícones e das pegas em cm, para o zoom atual (os mesmos do desenho). */
  function tamanhos() {
    const ppc = pxPorCm();
    const raio = limitar(15 / ppc, 12, 60);
    return { ppc, raio, raioToque: Math.max(raio, 22 / ppc), letra: limitar(14 / ppc, 10, 120), pega: limitar(38 / ppc, 10, 240) };
  }

  /**
   * O que está no ponto `p` (cm), para o duplo clique e o toque longo: um canto ou uma parede da
   * divisão selecionada, um elemento, ou o interior de uma divisão.
   */
  function oQueEsta(p, tipoPonteiro) {
    const t = tamanhos();
    const sel = obterDivisao(selecionado);
    if (sel) {
      const pts = pontosDivisao(sel);
      const i = pts.findIndex(([x, y]) => Math.abs(x - p.x) <= t.pega / 2 && Math.abs(y - p.y) <= t.pega / 2);
      if (i >= 0) return { tipo: "canto", d: sel, i };
    }
    for (let k = planta.elementos.length - 1; k >= 0; k--) {
      const e = planta.elementos[k];
      if (Math.hypot(e.x_cm - p.x, e.y_cm - p.y) <= t.raioToque) return { tipo: "elemento", e };
    }
    if (sel) {
      const pts = pontosDivisao(sel);
      const tol = (tipoPonteiro === "mouse" ? PAREDE_PX.mouse : PAREDE_PX.toque) / t.ppc;
      let melhor = null;
      pts.forEach((a, i) => {
        const r = distanciaSegmento(p.x, p.y, a, pts[(i + 1) % pts.length]);
        if (r.dist <= tol && (!melhor || r.dist < melhor.dist)) {
          const b = pts[(i + 1) % pts.length];
          melhor = { dist: r.dist, i, ponto: { x: a[0] + r.t * (b[0] - a[0]), y: a[1] + r.t * (b[1] - a[1]) } };
        }
      });
      if (melhor) return { tipo: "parede", d: sel, i: melhor.i, ponto: melhor.ponto };
    }
    const id = divisaoEm(planta, p.x, p.y);
    return id ? { tipo: "divisao", d: obterDivisao(id) } : null;
  }

  /**
   * Duplo clique (rato) ou toque longo (dedo): parede → canto novo; canto → apaga-o (no toque longo
   * abre a janela nesse canto: um dedo parado antes de arrastar não deve apagar nada); resto → janela.
   */
  function gestoDuplo(p, tipoPonteiro) {
    const alvo = oQueEsta(p, tipoPonteiro);
    if (!alvo) return;
    if (alvo.tipo === "canto" && tipoPonteiro !== "mouse") { selecionado = alvo.d.id; desenharTudo(); abrirDialogo({ canto: alvo.i }); return; }
    if (alvo.tipo === "canto") { apagarCanto(alvo.d, alvo.i); return; }
    if (alvo.tipo === "parede") { acrescentarCanto(alvo.d, alvo.i, alvo.ponto); return; }
    selecionado = (alvo.e ?? alvo.d).id;
    desenharTudo();
    abrirDialogo();
  }

  function centroColocacao() {
    const d = obterDivisao(selecionado);
    if (d?.pontos) { const [x, y] = pontoInterior(d.pontos); return { x, y }; }
    if (d) return { x: d.x_cm + d.largura_cm / 2, y: d.y_cm + d.altura_cm / 2 };
    return { x: limitar(vista.cx, 0, planta.largura_cm), y: limitar(vista.cy, 0, planta.altura_cm) };
  }

  function definirModo(m) {
    modo = m;
    for (const [k, b] of Object.entries(ferramentas)) {
      b.setAttribute("aria-pressed", String(!!m && m.tipo === "elemento" && m.el === k));
    }
    svg.classList.toggle("a-colocar", !!m);
    if (!m) dica.textContent = "Os botões das divisões acrescentam-nas logo; para um elemento, toque na ferramenta e depois na planta. Arraste para deslocar; dois dedos ou a roda do rato para aproximar. Duplo clique (ou toque longo) abre as opções.";
    else if (m.tipo === "elemento") dica.textContent = `Toque na planta onde quer pôr: ${ELEMENTOS[m.el].nome}. Esc cancela.`;
    else if (m.tipo === "calibrar") dica.textContent = m.pontos.length ? "Agora toque no fim da mesma parede." : "Calibrar: toque no início de uma parede que conheça, na imagem de fundo.";
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
        adicionarElemento(k, c.x, c.y);
        svg.focus({ preventScroll: true });
        return;
      }
      definirModo({ tipo: "elemento", el: k });
    });
  }
  desenharBotoesDivisao();
  bDesfazer.addEventListener("click", anular);
  bRefazer.addEventListener("click", refazerAcao);
  bMais.addEventListener("click", () => zoom(1 / 1.4));
  bMenos.addEventListener("click", () => zoom(1.4));
  bTudo.addEventListener("click", () => { verTudo(); desenhar(); });

  // ---------------------------------------------------------------- ponteiro
  const pararToqueLongo = () => { clearTimeout(toqueLongo); toqueLongo = null; };

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button > 0) return;
    svg.setPointerCapture?.(ev.pointerId);
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    pararToqueLongo();
    if (ponteiros.size === 2) {
      ajusteAuto = false;   // pinça: o cliente escolheu a vista
      // Dois dedos: aproximar/deslocar; cancela o arrasto (o que já mexeu fica memorizado).
      if (arrasto?.mexeu) terminarArrasto(); else arrasto = null;
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
    if (modo) { arrasto = { ...base, tipo: "colocar" }; return; }
    // Dedo (ou caneta) parado ~0,5 s = duplo clique: canto → apaga, parede → canto novo, resto → janela.
    if (ev.pointerType && ev.pointerType !== "mouse") {
      const tipo = ev.pointerType;
      toqueLongo = setTimeout(() => {
        toqueLongo = null;
        if (!arrasto || arrasto.id !== base.id || arrasto.mexeu || ponteiros.size !== 1) return;
        arrasto = null;
        gestoDuplo(p, tipo);
      }, TOQUE_LONGO_MS);
    }
    const alvo = ev.target.closest?.("[data-pega], [data-elemento], [data-divisao]");
    if (alvo?.dataset.pega) {
      const d = obterDivisao(alvo.dataset.id);
      if (d) { arrasto = { ...base, tipo: "canto", i: Number(alvo.dataset.pega), d, pts0: pontosDivisao(d) }; return; }
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
      arrasto = { ...base, tipo: "divisao", d, x0: d.x_cm, y0: d.y_cm, pts0: d.pontos ? d.pontos.map((q) => [...q]) : null, dentro: elementosDentro(d) };
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
    pararToqueLongo();
    const p = paraPlanta(ev.clientX, ev.clientY);
    const dx = p.x - arrasto.p0.x, dy = p.y - arrasto.p0.y;
    switch (arrasto.tipo) {
      case "deslocar":
        ajusteAuto = false;   // deslocou a vista à mão
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
        moverDivisao(arrasto.d, dx, dy, arrasto.dentro, arrasto.x0, arrasto.y0, arrasto.pts0);
        desenhar();
        break;
      case "canto": {
        // O canto anda livre (qualquer ângulo); ajusta à grelha de 50 cm, salvo com Shift ou Alt (ao cm).
        if (inicio) memorizar();
        const { d, i, pts0 } = arrasto;
        const livre = ev.shiftKey || ev.altKey;
        const x = livre ? pts0[i][0] + dx : ajustar(pts0[i][0] + dx, ESCALA_CM);
        const y = livre ? pts0[i][1] + dy : ajustar(pts0[i][1] + dy, ESCALA_CM);
        if (moverCanto(d, pts0, i, x, y)) desenhar();
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
    if (a.tipo === "colocar") colocadoEm = performance.now();
    if (a.tipo === "colocar") {
      const m = modo;
      definirModo(null);
      if (m?.tipo === "elemento") adicionarElemento(m.el, p.x, p.y);
      else if (m?.tipo === "calibrar") pontoCalibracao(p);
      return;
    }
    if (a.tipo === "deslocar") {
      if (!a.mexeu) {
        selecionado = a.alvo;
        desenharTudo();
        if (!a.alvo) definirModo(null);
        else avisar(`${obterDivisao(a.alvo)?.nome || "Divisão"} selecionada. Arraste para mover; arraste os cantos para mudar a forma (Shift: sem grelha). Duplo clique numa parede acrescenta um canto; num canto, apaga-o.`);
      }
      return;
    }
    if (a.mexeu) confirmar();
    else desenharTudo();
  }

  const fimPonteiro = (ev) => {
    pararToqueLongo();
    const eraPinca = !!pinca;
    ponteiros.delete(ev.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (eraPinca) { arrasto = null; return; }
    if (arrasto && arrasto.id === ev.pointerId) {
      if (ev.type === "pointercancel") { arrasto = null; desenhar(); return; }
      terminarArrasto(ev);
    }
  };
  svg.addEventListener("pointerup", fimPonteiro);
  svg.addEventListener("pointercancel", fimPonteiro);
  // Duplo clique do rato (e o duplo toque, onde o navegador o dá): o que fica no ponto decide (gestoDuplo).
  svg.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    if (modo || performance.now() - colocadoEm < 800) return;   // o 2.º clique de quem acabou de pôr algo
    const toque = ev.pointerType === "touch" || ev.sourceCapabilities?.firesTouchEvents === true;
    gestoDuplo(paraPlanta(ev.clientX, ev.clientY), toque ? "touch" : "mouse");
  });
  // O toque longo não abre o menu do navegador por cima da planta.
  svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const f = Math.exp(limitar(ev.deltaY, -300, 300) * (ev.deltaMode === 1 ? 0.05 : 0.0015));
    zoom(f, ev.clientX, ev.clientY);
  }, { passive: false });
  // Safari: gestos de pinça próprios não devem aproximar a página inteira.
  svg.addEventListener("gesturestart", (ev) => ev.preventDefault());

  // ---------------------------------------------------------------- teclado
  svg.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && existe(selecionado ?? "")) { ev.preventDefault(); abrirDialogo(); return; }
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
    if (!(ev.ctrlKey || ev.metaKey) || ev.target.matches?.("input, textarea, select") || dialogo.open) return;
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
    planta.largura_cm = limitar(Math.ceil(Math.max(dirX, ...planta.divisoes.map((d) => d.x_cm + d.largura_cm), ...planta.elementos.map((e) => e.x_cm), 100) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
    planta.altura_cm = limitar(Math.ceil(Math.max(dirY, ...planta.divisoes.map((d) => d.y_cm + d.altura_cm), ...planta.elementos.map((e) => e.y_cm), 100) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
  }

  /**
   * Fundo novo: a imagem é escalada para caber na planta (sem distorcer) e a planta passa a ter a
   * proporção da imagem. Planta vazia: a imagem fica no canto (0, 0) e a planta com o tamanho dela.
   * Com divisões ou elementos: a imagem fica centrada sobre eles e a planta cresce até cobrir os dois
   * (nada do que já está desenhado fica de fora). A calibração continua a mudar a escala depois.
   */
  function encaixarFundo(imagem, aspeto) {
    planta.fundo = null;   // o fundo antigo (se havia) não conta para o encaixe
    const L = planta.largura_cm, A = planta.altura_cm;
    let w = Math.min(L, A / aspeto);
    if (w * aspeto > MAX_LADO_CM) w = MAX_LADO_CM / aspeto;
    w = Math.max(10, Math.round(w));
    const h = w * aspeto;
    let x = 0, y = 0;
    if (planta.divisoes.length || planta.elementos.length) {
      const c = caixaConteudo();   // ainda sem o fundo novo
      x = Math.max(0, Math.round(c.x + c.w / 2 - w / 2));
      y = Math.max(0, Math.round(c.y + c.h / 2 - h / 2));
    }
    planta.fundo = { imagem, x_cm: x, y_cm: y, largura_cm: w, opacidade: 0.5 };
    // A planta acompanha a imagem (e o que já está desenhado): ajustarPlantaAoFundo também encolhe.
    ajustarPlantaAoFundo();
  }

  function lerAspeto() {
    aspetoFundo = null;
    const f = planta?.fundo;
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      if (planta?.fundo !== f || !img.naturalWidth) return;
      aspetoFundo = img.naturalHeight / img.naturalWidth;
      // A vista foi ajustada antes de se saber a altura da imagem: reajusta se o cliente ainda não mexeu.
      if (ajusteAuto) { verTudo(); desenhar(); }
    };
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
      encaixarFundo(r.imagem, aspetoFundo);
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
      props.append(el("p", "ajuda", "Toque numa divisão ou num elemento para o editar. Para começar, toque no tipo de divisão (Sala, Quarto…): aparece logo na planta, já com os aparelhos habituais."));
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
      // Retângulo: largura e comprimento; forma livre (paredes oblíquas): a área e os cantos na janela.
      const pts = pontosDivisao(d);
      const forma = el("div", "editor-props-campos");
      if (!d.pontos) {
        const w = numeroInput(d.largura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.01, id: "divisao-largura" });
        const h = numeroInput(d.altura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.01, id: "divisao-altura" });
        for (const [i, k, lim] of [[w, "largura_cm", () => planta.largura_cm - d.x_cm], [h, "altura_cm", () => planta.altura_cm - d.y_cm]]) {
          i.addEventListener("change", () => {
            const v = Number(i.value);
            if (!(v > 0)) return;
            memorizar();
            // Ao cm, como na janela de edição (a grelha de 50 cm é só para arrastar).
            d[k] = limitar(Math.round(v * 100), ESCALA_CM, lim());
            confirmar();
          });
        }
        const dim = el("div", "duas");
        dim.append(campo("Largura (m)", w), campo("Comprimento (m)", h));
        forma.append(dim, el("p", "ajuda", `Área: ${m2(areaPoligono(pts))} m².`));
      } else {
        forma.append(el("p", "ajuda", `Forma livre: ${pts.length} cantos, ${m2(areaPoligono(pts))} m² (caixa de ${metros(d.largura_cm)} × ${metros(d.altura_cm)} m).`));
      }
      const bCantos = botao("Editar cantos…");
      bCantos.id = "divisao-cantos";
      bCantos.addEventListener("click", () => abrirDialogo({ canto: 0 }));
      const bs = el("div", "form-botoes");
      bs.append(bCantos);
      if (d.pontos) {
        const bRet = botao("Tornar retângulo");
        bRet.id = "divisao-retangulo";
        bRet.addEventListener("click", tornarRetangulo);
        bs.append(bRet);
      }
      forma.append(bs);
      const apagar = botao("Apagar divisão", "btn sec pequeno perigo-sec");
      apagar.addEventListener("click", apagarSelecionado);
      acoes.append(apagar);
      const n = planta.elementos.filter((x) => x.divisao === d.id).length;
      props.append(campo("Nome", nome), dl, forma, el("p", "ajuda", `${n} ${n === 1 ? "elemento" : "elementos"} nesta divisão. Com a divisão selecionada, os botões da barra põem os elementos no meio dela.`), acoes);
      return;
    }
    const def = ELEMENTOS[e.tipo];
    titulo.textContent = def.nome;
    const p = e.props;
    const muda = (f) => (v) => { memorizar(); f(v); confirmar(); };
    const corpo = el("div", "editor-props-campos");
    corpo.append(...camposElemento(e.tipo, p, muda, "elemento"));
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

  /**
   * Campos das propriedades de um elemento (§2), os mesmos no painel ao lado e na janela de edição.
   * `mudar(f)` devolve o que fazer quando o campo muda (f altera `p`); `pre` = prefixo dos ids.
   */
  function camposElemento(tipo, p, mudar, pre) {
    const r = [];
    if (tipo === "porta") r.push(caixa("Porta da rua (entrada) — sugerimos um sensor", !!p.entrada, mudar((v) => { p.entrada = v; })));
    if (tipo === "janela") {
      r.push(caixa("Tem estore", !!p.estore, mudar((v) => { p.estore = v; if (!v) p.motorizado = false; })));
      r.push(caixa("Estore já motorizado (com motor elétrico)", !!p.motorizado, mudar((v) => { p.motorizado = v; }), !p.estore));
    }
    if (tipo === "tomada") r.push(caixa("Tomada dupla", !!p.dupla, mudar((v) => { p.dupla = v; })));
    if (tipo === "luz") r.push(caixa("Quero regular o brilho", !!p.brilho, mudar((v) => { p.brilho = v; })));
    if (tipo === "interruptor") {
      const s = document.createElement("select");
      s.id = `${pre}-botoes`;
      for (const b of [1, 2, 3, 4]) { const o = document.createElement("option"); o.value = String(b); o.textContent = `${b} ${b === 1 ? "botão" : "botões"}`; s.append(o); }
      s.value = String(p.botoes);
      s.addEventListener("change", mudar(() => { p.botoes = Number(s.value); }));
      r.push(campo("Botões", s));
    }
    if (tipo === "maquina") {
      const s = document.createElement("select");
      s.id = `${pre}-modelo`;
      for (const [k, m] of Object.entries(MODELOS)) { const o = document.createElement("option"); o.value = k; o.textContent = m.nome; s.append(o); }
      s.value = p.modelo;
      const w = numeroInput(p.potencia_w, { min: 0, max: 100000, step: 50, id: `${pre}-potencia` });
      w.inputMode = "numeric";
      s.addEventListener("change", mudar(() => { p.modelo = s.value; p.potencia_w = MODELOS[s.value].w; }));
      w.addEventListener("change", mudar(() => { p.potencia_w = Math.round(limitar(Number(w.value) || 0, 0, 100000)); }));
      r.push(campo("Qual é", s), campo("Potência (W)", w, "Valor típico; mude se souber o da sua máquina."));
    }
    return r;
  }

  function tornarRetangulo() {
    const d = obterDivisao(selecionado);
    if (!d?.pontos) return;
    memorizar();
    delete d.pontos;   // fica a caixa envolvente, que está sempre atualizada
    confirmar(`"${d.nome || "Divisão"}" é agora um retângulo de ${metros(d.largura_cm)} × ${metros(d.altura_cm)} m.`);
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
  // "Opções" abre a janela de edição (a mesma do duplo clique): no telemóvel o painel fica fora do ecrã.
  sOpcoes.addEventListener("click", () => abrirDialogo());

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
      const area = m2(areaPoligono(pontosDivisao(d)));
      b.append(el("span", null, d.pontos ? `${d.nome || "Divisão"} — ${area} m² (forma livre)` : `${d.nome || "Divisão"} — ${metros(d.largura_cm)} × ${metros(d.altura_cm)} m (${area} m²)`));
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

  // ---------------------------------------------------------------- janela de edição
  // Edita um rascunho: nada muda na planta até "Guardar" (um só passo de anular). Divisão: nome,
  // largura/comprimento (retângulo), área e a lista de cantos em metros (também para quem não usa
  // o rato); elemento: tipo, rotação, posição e as mesmas propriedades do painel ao lado.
  let rascunho = null;

  function abrirDialogo({ canto = null } = {}) {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if ((!d && !e) || dialogo.open) return;
    pararToqueLongo();
    arrasto = null;
    rascunho = d
      ? { id: d.id, tipo: "divisao", nome: d.nome, pts: pontosDivisao(d) }
      : { id: e.id, tipo: "elemento", el: e.tipo, props: { ...e.props }, rot: e.rot, x: e.x_cm, y: e.y_cm };
    dlgTitulo.textContent = d ? `Divisão: ${d.nome || "sem nome"}` : descreverElemento(e);
    dApagar.textContent = d ? "Apagar divisão" : "Apagar";
    dlgErro.hidden = true;
    dlgCorpo.replaceChildren();
    if (d) corpoDivisao(); else corpoElemento();
    dialogo.showModal();
    // Foco no primeiro campo (ou no canto pedido: toque longo num canto, "Editar cantos…").
    const alvo = (canto !== null && document.getElementById(`dlg-canto-${canto}-x`)) || dlgCorpo.querySelector("input, select");
    alvo?.focus();
  }

  function erroDialogo(texto, foco) {
    dlgErro.textContent = texto;
    dlgErro.hidden = false;
    (foco ?? dlgErro).focus?.();
  }

  function corpoDivisao() {
    const r = rascunho;
    const nome = document.createElement("input");
    nome.id = "dlg-nome";
    nome.maxLength = 60;
    nome.value = r.nome;
    nome.autocomplete = "off";
    nome.setAttribute("list", "dlg-nomes");
    const dl = document.createElement("datalist");
    dl.id = "dlg-nomes";
    for (const n of NOMES_DIVISAO) { const o = document.createElement("option"); o.value = n; dl.append(o); }
    nome.addEventListener("input", () => { r.nome = nome.value; });
    const dims = el("div");
    const area = el("p", "ajuda");
    area.id = "dlg-area";
    const cantos = el("fieldset", "editor-cantos");
    const bMais = botao("Acrescentar canto");
    bMais.id = "dlg-canto-mais";
    const bRet = botao("Tornar retângulo");
    bRet.id = "dlg-retangulo";
    const bs = el("div", "form-botoes");
    bs.append(bMais, bRet);
    const valido = () => r.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    const eRet = () => valido() && ehRetangulo(r.pts);

    // Largura e comprimento só num retângulo "normal" (paredes direitas).
    function desenharDims() {
      dims.replaceChildren();
      bRet.hidden = eRet();
      if (!eRet()) return;
      const c = caixaPontos(r.pts);
      const w = numeroInput(c.largura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.01, id: "dlg-largura" });
      const h = numeroInput(c.altura_cm / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.01, id: "dlg-altura" });
      for (const [i, k] of [[w, "largura_cm"], [h, "altura_cm"]]) {
        i.addEventListener("change", () => {
          const v = lerNumero(i.value);
          if (!(v > 0)) return;
          const n = { ...caixaPontos(r.pts), [k]: Math.round(v * 100) };
          r.pts = pontosDivisao(n);
          desenharCantos();
          desenharArea();
        });
      }
      const duas = el("div", "duas");
      duas.append(campo("Largura (m)", w), campo("Comprimento (m)", h));
      dims.append(duas);
    }
    function desenharArea() {
      area.textContent = valido() ? `Área: ${m2(areaPoligono(r.pts))} m² · ${r.pts.length} cantos` : "Área: escreva as coordenadas de todos os cantos.";
    }
    function desenharCantos(foco) {
      cantos.replaceChildren(el("legend", null, "Cantos, em metros a contar do canto de cima à esquerda da planta"));
      r.pts.forEach((q, i) => {
        const linha = el("div", "editor-canto");
        const inputs = ["x", "y"].map((k, j) => {
          const inp = numeroInput(Number.isFinite(q[j]) ? q[j] / 100 : "", { min: 0, max: (j ? planta.altura_cm : planta.largura_cm) / 100, step: 0.01, id: `dlg-canto-${i}-${k}` });
          inp.setAttribute("aria-label", `Canto ${i + 1}: ${k === "x" ? "distância à esquerda" : "distância ao topo"} em metros`);
          inp.addEventListener("input", () => {
            const v = lerNumero(inp.value);
            q[j] = Number.isFinite(v) ? Math.round(v * 100) : NaN;
            desenharDims();
            desenharArea();
          });
          return inp;
        });
        const apagar = botao("Apagar", "btn sec pequeno perigo-sec");
        apagar.id = `dlg-canto-${i}-apagar`;
        apagar.setAttribute("aria-label", `Apagar o canto ${i + 1}`);
        apagar.disabled = r.pts.length <= MIN_CANTOS;
        apagar.addEventListener("click", () => {
          r.pts.splice(i, 1);
          desenharCantos(`dlg-canto-${Math.min(i, r.pts.length - 1)}-x`);
          desenharDims();
          desenharArea();
        });
        linha.append(el("span", "editor-canto-nome", `Canto ${i + 1}`), campo("X (m)", inputs[0]), campo("Y (m)", inputs[1]), apagar);
        cantos.append(linha);
      });
      bMais.disabled = r.pts.length >= MAX_CANTOS;
      if (foco) document.getElementById(foco)?.focus();
    }
    bMais.addEventListener("click", () => {
      if (!valido() || r.pts.length >= MAX_CANTOS) return;
      // No meio da parede mais comprida (depois é só mudar as coordenadas).
      let i = 0, maior = -1;
      r.pts.forEach((a, k) => { const b = r.pts[(k + 1) % r.pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > maior) { maior = l; i = k; } });
      const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length];
      r.pts.splice(i + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]);
      desenharCantos(`dlg-canto-${i + 1}-x`);
      desenharDims();
      desenharArea();
    });
    bRet.addEventListener("click", () => {
      if (!valido()) { erroDialogo("Escreva primeiro as coordenadas de todos os cantos."); return; }
      r.pts = pontosDivisao(caixaPontos(r.pts));
      desenharCantos();
      desenharDims();
      desenharArea();
      document.getElementById("dlg-largura")?.focus();
    });
    desenharCantos();
    desenharDims();
    desenharArea();
    dlgCorpo.append(campo("Nome", nome), dl, dims, area, cantos, bs,
      el("p", "ajuda", "Na planta: arraste um canto para inclinar a parede; duplo clique (ou toque longo) numa parede acrescenta um canto."));
  }

  function corpoElemento() {
    const r = rascunho;
    const tipo = document.createElement("select");
    tipo.id = "dlg-tipo";
    for (const t of TIPOS_ELEMENTO) { const o = document.createElement("option"); o.value = t; o.textContent = ELEMENTOS[t].nome; tipo.append(o); }
    tipo.value = r.el;
    const rotBox = el("div");
    const propsBox = el("div", "editor-props-campos");
    const x = numeroInput(r.x / 100, { min: 0, max: planta.largura_cm / 100, step: 0.1, id: "dlg-x" });
    const y = numeroInput(r.y / 100, { min: 0, max: planta.altura_cm / 100, step: 0.1, id: "dlg-y" });
    x.addEventListener("input", () => { r.x = lerNumero(x.value) * 100; });
    y.addEventListener("input", () => { r.y = lerNumero(y.value) * 100; });
    // Estore → motorizado ativo; modelo → potência típica: o que depende de outro campo acompanha-o.
    const sincronizar = () => {
      const cx = propsBox.querySelectorAll("input[type=checkbox]");
      if (r.el === "janela" && cx[1]) { cx[1].disabled = !r.props.estore; cx[1].checked = !!r.props.motorizado; }
      const w = document.getElementById("dlg-potencia");
      if (w) w.value = String(r.props.potencia_w);
    };
    const desenharTipo = () => {
      rotBox.replaceChildren();
      if (ELEMENTOS[r.el].roda) {
        const s = document.createElement("select");
        s.id = "dlg-rot";
        for (const g of [0, 90, 180, 270]) { const o = document.createElement("option"); o.value = String(g); o.textContent = `${g}°`; s.append(o); }
        s.value = String(r.rot);
        s.addEventListener("change", () => { r.rot = Number(s.value); });
        rotBox.append(campo("Rotação", s));
      }
      propsBox.replaceChildren(...camposElemento(r.el, r.props, (f) => (v) => { f(v); sincronizar(); }, "dlg"));
    };
    tipo.addEventListener("change", () => {
      r.el = tipo.value;
      r.props = propsOmissao(r.el);
      if (!ELEMENTOS[r.el].roda) r.rot = 0;
      desenharTipo();
    });
    desenharTipo();
    const pos = el("div", "duas");
    pos.append(campo("Distância à esquerda (m)", x), campo("Distância ao topo (m)", y));
    dlgCorpo.append(campo("Tipo", tipo), rotBox, propsBox, pos);
  }

  function guardarDialogo() {
    const r = rascunho;
    if (!r) return;
    if (r.tipo === "divisao") {
      const d = obterDivisao(r.id);
      if (!d) { dialogo.close(); return; }
      const i = r.pts.findIndex((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]));
      if (i >= 0) { erroDialogo(`Escreva as coordenadas do canto ${i + 1} em metros (ex.: 3,5).`, document.getElementById(`dlg-canto-${i}-x`)); return; }
      const fora = r.pts.findIndex((q) => q[0] < 0 || q[1] < 0 || q[0] > planta.largura_cm || q[1] > planta.altura_cm);
      if (fora >= 0) { erroDialogo(`O canto ${fora + 1} fica fora da planta: use 0 a ${metros(planta.largura_cm)} m à esquerda e 0 a ${metros(planta.altura_cm)} m ao topo.`, document.getElementById(`dlg-canto-${fora}-x`)); return; }
      const v = validarPontos(r.pts, planta.largura_cm, planta.altura_cm);
      if (!v) { erroDialogo(paredesCruzam(r.pts) ? "As paredes cruzam-se: reveja a ordem dos cantos (à volta da divisão)." : "A divisão fica pequena demais (mínimo 0,25 m²) ou tem cantos repetidos."); return; }
      memorizar();
      d.nome = String(r.nome ?? "").trim().slice(0, 60) || "Divisão";
      definirPontos(d, v);
      rascunho = null;
      dialogo.close();
      confirmar(`Divisão "${d.nome}" guardada (${m2(areaPoligono(v))} m²).`);
      return;
    }
    const e = obterElemento(r.id);
    if (!e) { dialogo.close(); return; }
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) { erroDialogo("Escreva a posição em metros (ex.: 2,5).", document.getElementById("dlg-x")); return; }
    memorizar();
    e.tipo = r.el;
    e.props = { ...r.props };
    e.rot = ELEMENTOS[r.el].roda ? r.rot : 0;
    e.x_cm = Math.round(limitar(r.x, 0, planta.largura_cm));
    e.y_cm = Math.round(limitar(r.y, 0, planta.altura_cm));
    rascunho = null;
    dialogo.close();
    confirmar(`Guardado: ${descreverElemento(e)}.`);
  }

  dlgForm.addEventListener("submit", (ev) => { ev.preventDefault(); guardarDialogo(); });
  dCancelar.addEventListener("click", () => dialogo.close());
  dApagar.addEventListener("click", () => {
    const id = rascunho?.id;
    dialogo.close();
    if (id && existe(id)) { selecionado = id; apagarSelecionado(); }
  });
  // Fechar (Guardar, Cancelar, Apagar ou Esc): o foco volta à planta.
  dialogo.addEventListener("close", () => { rascunho = null; svg.focus({ preventScroll: true }); });

  // ---------------------------------------------------------------- desenho
  function desenhar() {
    if (!planta) return;
    const { ppc, raio, raioToque, letra, pega } = tamanhos();
    desenharPlanta(svg, planta, { selecionado, vista: caixaVista(), raio, raioToque, letra, pega });
    const extra = (tag, atrs, estilo) => {
      const n = svgEl(tag);
      for (const [k, v] of Object.entries(atrs)) n.setAttribute(k, String(v));
      for (const [k, v] of Object.entries(estilo)) n.style.setProperty(k, v);
      svg.append(n);
    };
    // Divisão acabada de criar: contorno que pisca (CSS .destaque-nova; parado com movimento reduzido).
    // O SVG é refeito a cada mudança: o atraso negativo continua a animação onde ia.
    const dn = destaque && obterDivisao(destaque.id);
    const passou = destaque ? performance.now() - destaque.desde : 0;
    if (dn && passou < DESTAQUE_MS) {
      extra("polygon", { points: pontosDivisao(dn).map((q) => q.join(",")).join(" "), class: "destaque-nova" }, { fill: "color-mix(in srgb, var(--argila) 22%, transparent)", stroke: "var(--argila)", "stroke-width": "6px", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none", "animation-delay": `-${Math.round(passou)}ms` });
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

  // O tamanho da planta no ecrã mudou (o passo apareceu, rodou o telemóvel…): se a vista foi ajustada
  // sozinha e o cliente ainda não lhe mexeu, volta a ajustá-la ao conteúdo.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => { if (ajusteAuto && planta) verTudo(); desenhar(); }).observe(area);

  return {
    /** Abre (ou reabre) a planta no editor. */
    abrir(p, { reiniciarVista = true } = {}) {
      const nova = planta !== p;
      planta = p;
      if (nova) { desfazer = []; refazer = []; selecionado = null; calibracao = null; lerAspeto(); }
      if (nova) ajustarFolha();   // plantas antigas com quadrícula vazia à volta ficam à medida
      if (reiniciarVista || nova) verTudo();
      nDivisoesVista = planta.divisoes.length;
      definirModo(null);
      desenharTudo();
    },
    redesenhar: () => desenharTudo(),
    /** Botões de divisão para o tipo de imóvel (regras.js tiposDivisaoPara). */
    definirTiposDivisao(lista) {
      if (lista === tiposDivisao) return;
      tiposDivisao = lista;
      desenharBotoesDivisao();
    },
    get planta() { return planta; },
    /** Só para testes/depuração: estado da vista. */
    get vista() { return { ...vista }; },
  };
}
