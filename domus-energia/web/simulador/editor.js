// Editor da planta (docs/SIMULADOR-ORCAMENTO.md §2): SVG com quadriculado de 50 cm, separadores por piso
// (cada um mostra só as divisões e os elementos desse piso, na mesma folha e escala), ecrã inteiro,
// deslocar e aproximar (botões − / +, Ctrl + roda do rato, dois dedos), eventos de ponteiro para rato e
// toque, divisões (criar num sítio livre com os aparelhos habituais, mover, mudar a forma pelos cantos — paredes oblíquas),
// elementos (colocar, mover, apagar — sem rodar, decisão do dono; as máquinas com um botão por modelo), janela de edição
// simples (duplo clique, toque longo, Enter ou "Opções": divisão — nome, medidas e piso; elemento — a escolha do seu tipo), divisões
// que se podem sobrepor sem roubarem os aparelhos umas às outras (cada aparelho guarda a sua), anular/refazer, alternativa por teclado (barras
// com setas), fundo (foto/PDF) com opacidade, escala e calibração; a vista ajusta-se ao conteúdo.
// Todos os textos entram com textContent.

import { desenharPlanta, desenharIcone, legendaAcoes } from "./planta-svg.js";
import {
  ELEMENTOS, TIPOS_ELEMENTO, TIPOS_DIVISAO, MODELOS, NOMES_DIVISAO, ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM,
  MAX_CANTOS, MIN_CANTOS, AREA_MIN_CM2, MAX_PISO,
  propsOmissao, atualizarDivisoes, divisaoDoElemento, divisaoEm, pontosDivisao, areaPoligono, caixaPontos,
  distanciaSegmento, paredesCruzam, validarPontos, definirPontos, pontoInterior, pisoDe, nomePiso,
  pontoEmPoligono, distanciaPoligono, TIPOS_PAREDE, TOLERANCIA_PORTA_CM, temPergunta, COMANDOS, comandoDe, caixasDe,
} from "./regras.js";
import { lerFundo, ErroFundo } from "./fundo.js";
import { aparelhosOmissao, resumoAparelhos, lugarLivre, tipoDivisao as tipoDoNome } from "./casa.js";
import { imprimirPlanta, guardarPdf } from "./imprimir.js";

const HISTORICO_MAX = 100;
const TOQUE_PX = 6;          // abaixo disto um arrasto é um toque
const PASSO_ELEMENTO = 10;   // cm (setas); Shift = × 5
const PASSO_DIVISAO = ESCALA_CM;
const TOQUE_LONGO_MS = 500;  // toque longo (sem mexer) = duplo clique
const PAREDE_PX = { mouse: 10, toque: 18 };   // tolerância para acertar numa parede (duplo clique / toque longo)
const MARGEM_VISTA = 1.08;   // "Ver tudo": o conteúdo ocupa ~93 % da vista
// focarDivisao (decisão do dono, 2026-10-03): a divisão ocupa ~60 % da vista (as vizinhas ficam em parte à vista); uma
// divisão pequena (WC) nunca aproxima abaixo de 4,5 m de largura de vista; uma enorme (jardim) nunca afasta para lá do "Ver tudo".
const MARGEM_FOCO = 1.6;
const MIN_LARGURA_FOCO = 450;
const DESTAQUE_MS = 1500;    // a divisão nova pisca durante este tempo
// Duplo clique feito por nós (o "dblclick" do navegador não chega: a planta é redesenhada a cada toque e o
// elemento onde o clique começou já não existe, por isso o navegador não dá "click" nem "dblclick").
const DUPLO_MS = 500;
const DUPLO_PX = { mouse: 6, toque: 24 };
/** Desenho do botão de cada divisão: o tipo pelo nome (casa.js tipoDivisao), salvo estes (arrumos, cais). */
const ICONE_DIVISAO = { Arrumos: "despensa", "Cais / exterior": "cais" };
/** Nomes curtos dos botões das máquinas (o nome completo fica no nome acessível e na janela). */
const NOMES_CURTOS = {
  televisao: "TV", maquina_lavar: "Máq. lavar roupa", maquina_secar: "Máq. secar roupa", maquina_loica: "Máq. lavar loiça",
  placa: "Placa", carregador_ve: "Carregador do carro", carregador_ve_22: "Carregador 22 kW", bomba: "Bomba piscina/rega",
  arca_frigorifica: "Arca/vitrine", maquina_cafe: "Máq. de café", servidor: "Servidor", maquina_trifasica: "Máq. trifásica",
  box_router: "Box/router", nas: "NAS", camara: "Câmara", rega: "Rega", iluminacao_jardim: "Luz exterior",
  terminal_pagamento: "Terminal pagamento", ferramentas: "Ferramentas", cafeteira: "Cafeteira", outro: "Outra",
  esquentador: "Esquentador", radiador: "Radiador", cafe_expresso: "Café expresso", campainha: "Campainha", campainha_video: "Campainha vídeo",
  carregador_bicicleta: "Carreg. bicicleta", toalheiro: "Aquec. toalhas", secador: "Secador", hidromassagem: "Hidro­massagem",
  // Palavras mais largas do que o botão: hífen opcional (­) onde se pode partir.
  termoacumulador: "Termo­acumulador", ar_condicionado: "Ar condi­cionado", desumidificador: "Desumidi­ficador",
};

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

// Barra das ações só com ícones (decisão do dono): o nome vai no aria-label e no title (dica ao passar o rato).
const ICONES_ACAO = {
  anular: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  refazer: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  afastar: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>',
  aproximar: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-4-4"/>',
  tudo: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  ampliar: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  reduzir: '<path d="M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6"/>',
  duplicar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  opcoes: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  apagar: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  outras: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  ajustar: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  // Na barra desde 2026-10-05 (decisão do dono): os cantos da divisão e o que estava no menu "⋯".
  cantoMais: '<path d="M4 20V8l8-4 8 4v12z"/><path d="M12 10v6M9 13h6"/>',
  cantoMenos: '<path d="M4 20V8l8-4 8 4v12z"/><path d="M9 13h6"/>',
  imprimir: '<path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9.5 14.5 12 17l2.5-2.5"/>',
  fundo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
};
function iconeAcao(b, nome, rotulo) {
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES_ACAO[nome]}</svg>`;
  b.classList.add("icone");
  b.setAttribute("aria-label", rotulo);
  b.title = rotulo;
  return b;
}

function campo(rotulo, input, ajuda) {
  const l = el("label", "campo");
  l.append(el("span", null, rotulo), input);
  if (ajuda) l.append(el("small", "ajuda", ajuda));
  return l;
}

function caixa(rotulo, marcado, aoMudar, desativado = false, id = null) {
  const l = el("label", "caixa-linha");
  const i = document.createElement("input");
  i.type = "checkbox";
  if (id) i.id = id;
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
 * @param {{aoMudar: (planta: object) => void, anunciar?: (texto: string) => void, aoSelecionar?: (divisao: string|null) => void}} opcoes
 *   `aoSelecionar`: a divisão selecionada mudou (a do elemento selecionado; null sem seleção) — o passo Divisões destaca o cartão.
 *   `aoHistorico`: depois de anular ou refazer (o passo Divisões tira a mensagem da ação que deixou de valer).
 */
export function criarEditor(raiz, { aoMudar, anunciar = null, aoSelecionar = null, aoSelecionarElemento = null, aoHistorico = null, aoDivisaoPresa = null, acaoAoPor = null }) {
  let planta = null;
  let selecionado = null;
  let vista = { cx: 1000, cy: 750, w: 2100 };
  let modo = null;            // null | {tipo: "elemento", el: "tomada"} | {tipo: "calibrar", pontos: []}
  let calibracao = null;      // {pontos: [p1, p2]} (calibração do fundo, desenhada em desenhar())
  let arrasto = null;
  let desfazer = [];
  let refazer = [];
  const ponteiros = new Map();
  let pinca = null;
  let destaque = null;        // {id, desde}: a divisão acabada de criar pisca (DESTAQUE_MS)
  let aspetoFundo = null;     // altura/largura da imagem de fundo (px)
  let nDivisoesVista = 0;   // n.º de divisões quando a vista foi ajustada (confirmar)
  let ajusteAuto = false;     // a vista foi ajustada sozinha e o cliente ainda não a mexeu: reajusta se o tamanho mudar
  let focoAuto = null;        // id da divisão em que a vista está centrada (focarDivisao) enquanto o cliente não a mexer
  let toqueLongo = null;      // temporizador do toque longo
  let colocadoEm = 0;         // quando se pôs a última coisa com uma ferramenta (o 2.º clique não abre a janela)
  let tiposDivisao = TIPOS_DIVISAO;   // tipos de divisão do tipo de imóvel (definirTiposDivisao): na linha os que a casa tem, todos na janela "Outra divisão"
  let divisoesCasa = [];      // nomes das divisões de "A casa tem…" (definirTiposDivisao): os tipos delas ficam na linha, mesmo sem estar na planta
  let modelosJanela = null;   // modelos da lista "Qual é?" (os do perfil do imóvel: definirMaquinas); null = todos
  let pisoAtual = 0;          // separador visível: só as divisões e os elementos deste piso (0 = r/c)
  let pisosPedidos = 1;       // pisos da casa (definirPisos); aparecem também os pisos que já têm coisas
  let ultimoToque = null;     // {t, x, y}: o toque anterior, para o duplo clique (DUPLO_MS)
  let duploEm = 0;            // quando o nosso duplo clique abriu algo (o "dblclick" do navegador não repete)
  let ecraCss = false;        // ecrã inteiro sem a Fullscreen API (recurso CSS)
  let rovingFerramentas = null;   // acerta o "roving tabindex" da linha das ferramentas (barraComSetas)

  // ---------------------------------------------------------------- DOM
  raiz.replaceChildren();
  raiz.classList.add("editor");

  // Ferramentas numa só linha compacta por cima da planta (decisão do dono), que desliza para o lado (carrossel):
  // as divisões que a casa tem e "Outra divisão" (a janela com todas as do tipo de imóvel), todos os elementos e todas
  // as máquinas (definirMaquinas), em 3 grupos separados por um traço discreto. (Ronda sinalizar: saiu o "Mais…" — a
  // janela com a lista completa; as setas ‹ › dão a volta.)
  const fila = el("div", "editor-ferramentas");
  fila.setAttribute("role", "toolbar");
  fila.setAttribute("aria-label", "Ferramentas da planta");
  // Carrossel (decisão do dono): setas ‹ › nos dois extremos — cada toque anda uma "página" (a largura à vista) e dá
  // a volta (da última página volta à primeira e vice-versa); a linha continua a deslizar com o dedo ou a roda do rato.
  // As setas só aparecem quando a linha não cabe toda.
  const filaCaixa = el("div", "editor-ferramentas-caixa");
  const setaFila = (sinal, rotulo, d) => {
    const b = botao(sinal, "btn sec ferramentas-seta");
    b.setAttribute("aria-label", rotulo);
    b.title = rotulo;
    b.addEventListener("click", () => {
      const pagina = fila.clientWidth, max = Math.max(0, fila.scrollWidth - pagina), s = fila.scrollLeft;
      // A página seguinte começa no primeiro botão que não cabe inteiro (nenhum fica cortado nas duas páginas).
      const fr = fila.getBoundingClientRect();
      const pos = [...fila.querySelectorAll("button")].filter((x) => !x.hidden && x.offsetParent !== null)
        .map((x) => { const r = x.getBoundingClientRect(); return [r.left - fr.left + s, r.right - fr.left + s]; });
      let x;
      if (d > 0) x = s >= max - 3 ? 0 : (pos.find(([, r]) => r > s + pagina + 1)?.[0] ?? max) - 2;
      else x = s <= 3 ? max : ([...pos].reverse().find(([l]) => l < s - 1)?.[1] ?? 0) + 2 - pagina;
      fila.scrollTo({ left: limitar(x, 0, max), behavior: "smooth" });
    });
    return b;
  };
  const filaAnt = setaFila("‹", "Aparelhos anteriores", -1), filaSeg = setaFila("›", "Mais aparelhos", 1);
  filaCaixa.append(filaAnt, fila, filaSeg);
  function acertarSetasFila() {
    const sobra = fila.scrollWidth > fila.clientWidth + 1;
    filaAnt.hidden = filaSeg.hidden = !sobra;
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(acertarSetasFila).observe(fila);
  const ferramentas = {};
  const grupoBarra = (cls, rotulo) => { const g = el("div", `editor-barra ${cls}`); g.setAttribute("role", "group"); g.setAttribute("aria-label", rotulo); return g; };
  // 1. Um botão por tipo de divisão que a casa tem (as da planta neste piso e as de "A casa tem…"; decisão do dono), com
  // o seu desenho (planta-svg.js divisao_<tipo>): cria-a logo, com o nome certo (Quarto, Quarto 2, Sala…); o que traz
  // (casa.js resumoAparelhos) fica no nome acessível do botão. No fim, "Outra divisão" abre a janela com todos os tipos.
  const barraDiv = grupoBarra("editor-divisoes", "Acrescentar divisão");
  /** Nome acessível: o que a divisão traz só quando o passo mostra os aparelhos (em "A casa" só as divisões). */
  const rotuloDivisao = (t) => `Acrescentar ${t.nome === "Outra" ? "outra divisão" : t.nome}${podeAparelhos ? ` (com ${resumoAparelhos(t.nome, t.w, t.h)})` : ""}`;
  function botaoDivisao(t) {
    const b = botao("", "ferramenta tipo-divisao");
    b.dataset.divisao = t.nome;
    b.setAttribute("aria-label", rotuloDivisao(t));
    b.append(desenharIcone(svgEl("svg"), "divisao", { tipo: ICONE_DIVISAO[t.nome] ?? tipoDoNome(t.nome) }), el("span", "ferramenta-nome", t.nome));
    return b;
  }
  /** Tipo (a chave do desenho) de um botão de divisão. */
  const chaveTipo = (t) => ICONE_DIVISAO[t.nome] ?? tipoDoNome(t.nome);
  /** Tipos de uma lista de nomes de divisões (casa.js tipoDivisao); a kitnet (sala com cozinha) conta como sala e cozinha. */
  const tiposDe = (nomes) => new Set(nomes.flatMap((n) => { const k = tipoDoNome(n); return k === "sala_cozinha" ? ["sala", "cozinha"] : [k]; }));
  /** O botão cria a divisão logo (rato, toque ou teclado), num sítio livre. */
  const ligarDivisao = (b, t) => b.addEventListener("click", () => {
    definirModo(null);
    if (criarDivisao(t.nome)) mostrarPlanta();
  });
  const bOutraDiv = botao("", "ferramenta tipo-divisao outra-divisao");
  bOutraDiv.id = "editor-outra-divisao";
  bOutraDiv.setAttribute("aria-label", "Outra divisão: todos os tipos de divisão");
  bOutraDiv.setAttribute("aria-haspopup", "dialog");
  bOutraDiv.append(desenharIcone(svgEl("svg"), "divisao", { tipo: "outra" }), el("span", "ferramenta-nome", "Outra divisão"));
  bOutraDiv.addEventListener("click", () => abrirTodasDivisoes());
  function desenharBotoesDivisao() {
    barraDiv.replaceChildren();
    for (const t of tiposDivisao) {
      if (t.nome === "Outra") continue;   // só na janela "Outra divisão"
      const b = botaoDivisao(t);
      ligarDivisao(b, t);
      barraDiv.append(b);
    }
    barraDiv.append(bOutraDiv);
    acertarBarra();
  }
  /** Na linha só os tipos que a casa tem: os das divisões da planta neste piso e os de "A casa tem…" (divisoesCasa). */
  function acertarBotoesDivisao() {
    const tem = tiposDe([...(planta ? divisoesPiso() : []).map((d) => d.nome), ...divisoesCasa]);
    for (const b of barraDiv.children) {
      const t = b.dataset.divisao && tiposDivisao.find((x) => x.nome === b.dataset.divisao);
      if (t) b.hidden = !tem.has(chaveTipo(t));
    }
  }
  // Janela "Outra divisão" (<dialog> modal, como "Acrescentar outro aparelho" em app.js): a grelha de todos os tipos
  // de divisão do imóvel; escolher um cria-a como o botão da linha e fecha; "Fechar" ou Esc fecham; o foco volta ao botão.
  const janelaDiv = el("dialog", "editor-dialogo editor-mais janela-divisoes");
  janelaDiv.id = "divisoes-janela";
  janelaDiv.setAttribute("aria-labelledby", "divisoes-titulo");
  const janelaDivTitulo = el("h2", null, "Acrescentar uma divisão");
  janelaDivTitulo.id = "divisoes-titulo";
  const janelaDivGrelha = el("div", "editor-mais-grelha");
  const janelaDivCorpo = el("div", "editor-mais-corpo");
  janelaDivCorpo.append(janelaDivGrelha);
  const janelaDivFechar = botao("Fechar", "btn sec");
  janelaDivFechar.id = "divisoes-fechar";
  janelaDivFechar.addEventListener("click", () => janelaDiv.close());
  const janelaDivBotoes = el("div", "form-botoes");
  janelaDivBotoes.append(janelaDivFechar);
  janelaDiv.append(janelaDivTitulo, janelaDivCorpo, janelaDivBotoes);
  janelaDiv.addEventListener("close", () => bOutraDiv.focus({ preventScroll: true }));
  function abrirTodasDivisoes() {
    if (janelaDiv.open) return;
    janelaDivGrelha.replaceChildren();
    for (const t of tiposDivisao) {
      const b = botaoDivisao(t);
      b.addEventListener("click", () => janelaDiv.close());
      ligarDivisao(b, t);
      janelaDivGrelha.append(b);
    }
    janelaDiv.showModal();
    janelaDivCorpo.scrollTop = 0;
    janelaDivGrelha.querySelector("button")?.focus();
  }

  // 2. Elementos da instalação elétrica (as máquinas têm o seu grupo, um botão por modelo).
  const barra = grupoBarra("editor-elementos", "Pôr na planta");
  for (const t of TIPOS_ELEMENTO.filter((x) => x !== "maquina")) {
    const b = botao("", "ferramenta");
    b.dataset.ferramenta = t;
    b.setAttribute("aria-pressed", "false");
    b.append(desenharIcone(svgEl("svg"), t, ELEMENTOS[t].props), el("span", "ferramenta-nome", ELEMENTOS[t].nome));
    b.title = ELEMENTOS[t].nome;   // em "Equipamentos" o botão é só o desenho (CSS .barra-so-icones): o nome ao passar o rato
    ligarFerramenta(b, t, t, null);
    barra.append(b);
  }
  // 3. Máquinas: um botão com o desenho de cada modelo (definirMaquinas), todos na linha.
  const barraMaq = grupoBarra("editor-maquinas", "Pôr uma máquina na planta");
  let modelosMaq = [];
  function desenharBotoesMaquina() {
    for (const k of Object.keys(ferramentas)) if (k.startsWith("maquina:")) delete ferramentas[k];
    barraMaq.replaceChildren();
    for (const m of modelosMaq) {
      const b = botao("", "ferramenta maquina-ferramenta");
      b.dataset.maquina = m;
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", `Pôr na planta: ${MODELOS[m].nome}`);
      b.append(desenharIcone(svgEl("svg"), "maquina", { modelo: m }), el("span", "ferramenta-nome", NOMES_CURTOS[m] ?? MODELOS[m].nome));
      ligarFerramenta(b, `maquina:${m}`, "maquina", m);
      barraMaq.append(b);
    }
    acertarBarra();
  }
  /** Ferramenta (elemento ou máquina de um modelo): tocar escolhe-a (e depois toca-se na planta); teclado põe logo. */
  function ligarFerramenta(b, chave, tipo, modelo) {
    ferramentas[chave] = b;
    b.addEventListener("click", (ev) => {
      const ativo = b.getAttribute("aria-pressed") === "true";
      if (ativo) { definirModo(null); return; }
      usarFerramenta(tipo, modelo, ev.detail === 0);
    });
  }
  /** Rato/toque: a ferramenta fica escolhida (depois toca-se na planta); teclado (Enter/Espaço): põe logo no centro. */
  function usarFerramenta(tipo, modelo, teclado) {
    if (teclado) {
      const c = centroColocacao();
      definirModo(null);
      adicionarElemento(tipo, c.x, c.y, modelo);
      svg.focus({ preventScroll: true });
      return;
    }
    definirModo({ tipo: "elemento", el: tipo, modelo });
  }
  /** Mostra na linha os grupos que o passo deixa mudar (lote 8, definirPermissoes); esconde os vazios. */
  function acertarBarra() {
    acertarBotoesDivisao();
    barraDiv.classList.toggle("sem-permissao", !podeDivisoes);
    barra.classList.toggle("sem-permissao", !podeAparelhos);
    // Só algumas peças (passo "Portas e janelas"): as outras ferramentas escondem-se.
    for (const b of barra.children) b.hidden = !!soElementos && !soElementos.includes(b.dataset.ferramenta);
    barraMaq.classList.toggle("sem-permissao", !podeAparelhos || !podeMaquinas);
    for (const g of [barraDiv, barra, barraMaq]) g.hidden = g.classList.contains("sem-permissao") || !g.children.length;
    rovingFerramentas?.();
    acertarSetasFila();
  }
  fila.append(barraDiv, barra, barraMaq);

  const bDesfazer = iconeAcao(botao(""), "anular", "Anular (Ctrl+Z)");
  bDesfazer.setAttribute("aria-keyshortcuts", "Control+Z");
  const bRefazer = iconeAcao(botao(""), "refazer", "Refazer (Ctrl+Y)");
  bRefazer.setAttribute("aria-keyshortcuts", "Control+Y");
  const bMenos = iconeAcao(botao(""), "afastar", "Afastar");
  const bMais = iconeAcao(botao(""), "aproximar", "Aproximar");
  const bTudo = iconeAcao(botao(""), "tudo", "Ver tudo");
  // "Ajustar" (decisão do dono): a folha volta ao tamanho das divisões (saiu da linha do título "A sua planta").
  const bAjustar = iconeAcao(botao(""), "ajustar", "Ajustar a folha às divisões");
  bAjustar.id = "planta-ajustar";
  // "Ampliar": a planta e as ferramentas em ecrã inteiro (só no computador; no telemóvel a planta já abre por cima).
  const bEcra = iconeAcao(botao(""), "ampliar", "Ampliar (ecrã inteiro)");
  bEcra.id = "editor-ecra-inteiro";
  bEcra.setAttribute("aria-pressed", "false");
  // Só a planta, uma folha A4 por piso (imprimir.js).
  const bImprimir = iconeAcao(botao(""), "imprimir", "Imprimir a planta (uma folha por piso)");
  bImprimir.id = "editor-imprimir";
  const bPdf = iconeAcao(botao(""), "pdf", "Guardar a planta em PDF (uma página por piso)");
  bPdf.id = "editor-pdf";

  // Separadores por piso (só com mais de um piso): cada um mostra as divisões e os elementos desse piso.
  const separadores = el("div", "editor-pisos");
  separadores.setAttribute("role", "tablist");
  separadores.setAttribute("aria-label", "Pisos da planta");
  separadores.hidden = true;

  const dica = el("p", "editor-dica");
  dica.id = "editor-dica";
  dica.setAttribute("role", "status");
  // Sem anunciador próprio da página, as confirmações ("Na planta: Janela (divisão Cozinha).") aparecem na dica.
  const avisar = anunciar ?? ((t) => { dica.textContent = t; });

  // Ações do que está selecionado (Duplicar, "Opções" — a janela de edição com tudo o resto — e Apagar; já não há
  // "Rodar"): sempre no mesmo sítio, desativadas quando não se aplicam (a barra não muda de tamanho).
  const selecaoNome = el("span", "editor-selecao-nome");
  const sDuplicar = iconeAcao(botao(""), "duplicar", "Duplicar");
  sDuplicar.id = "selecao-duplicar";
  const sOpcoes = iconeAcao(botao(""), "opcoes", "Opções");
  sOpcoes.id = "selecao-opcoes";
  sOpcoes.setAttribute("aria-keyshortcuts", "Enter");
  // Cantos da divisão selecionada (sem duplo clique, é por aqui que se acrescentam e apagam).
  const sCantoMais = iconeAcao(botao(""), "cantoMais", "Acrescentar canto");
  sCantoMais.id = "selecao-canto-mais";
  const sCantoMenos = iconeAcao(botao(""), "cantoMenos", "Apagar canto");
  sCantoMenos.id = "selecao-canto-menos";
  const sApagar = iconeAcao(botao("", "btn sec pequeno perigo-sec"), "apagar", "Apagar");
  sApagar.id = "selecao-apagar";
  sApagar.setAttribute("aria-keyshortcuts", "Delete");
  // "Planta de fundo": abre logo a escolha do ficheiro (foto ou PDF); o cartão "Fundo" ao lado fica para
  // ajustar, calibrar e tirar o fundo.
  const bFundo = iconeAcao(botao(""), "fundo", "Planta de fundo: escolher uma foto ou um PDF da planta");
  bFundo.id = "editor-fundo-botao";

  // Barra única das ações, centrada por cima da planta, em grupos: anular/refazer · zoom, ver tudo e ecrã
  // inteiro · o que está selecionado · fundo · pisos. No computador uma só fila (quebra se não couber); no
  // telemóvel duas filas que deslizam dentro de si — as gerais e as da seleção (a página não rola na horizontal).
  const acoes = el("div", "editor-acoes");
  acoes.setAttribute("role", "toolbar");
  acoes.setAttribute("aria-label", "Ações da planta");
  const grupo = (cls, ...xs) => { const g = el("div", `editor-acoes-grupo ${cls}`); g.append(...xs); return g; };
  const linhaGeral = el("div", "editor-acoes-linha");
  // "⋯": as ações menos usadas (Imprimir, Guardar PDF, Planta de fundo) num menu junto ao botão (`menu`, por cima de
  // tudo e dentro do ecrã); o cartão do fundo (e o do tamanho) abre numa janela junto a ele (`lado`).
  const bOutras = iconeAcao(botao(""), "outras", "Mais ações da planta: imprimir, PDF, planta de fundo e tamanho");
  bOutras.id = "editor-outras";
  bOutras.setAttribute("aria-haspopup", "menu");
  bOutras.setAttribute("aria-expanded", "false");
  bOutras.setAttribute("aria-controls", "editor-menu");
  linhaGeral.append(grupo("g-historico", bDesfazer, bRefazer), grupo("g-vista", bMenos, bMais, bTudo, bAjustar, bEcra));
  // Decisão do dono (2026-10-05): o que estava no menu "⋯" (Imprimir, Guardar PDF, Planta de fundo e, pelo app.js,
  // "Refazer planta") fica à vista na barra, no grupo g-fundo; o "⋯" deixa de se mostrar (MENU_NA_BARRA).
  bOutras.hidden = true;
  const grupoFundo = grupo("g-fundo", bOutras);
  // Decisão do dono (2026-10-05): em cima (horizontal) ficam anular/refazer e a vista; as ações do que está
  // selecionado e imprimir/PDF/fundo ficam numa coluna à direita da planta (dentro da área dela: .editor-acoes-lado).
  const acoesLado = el("div", "editor-acoes-lado");
  acoesLado.setAttribute("role", "toolbar");
  acoesLado.setAttribute("aria-orientation", "vertical");
  acoesLado.setAttribute("aria-label", "Ações do que está selecionado e da planta");
  acoesLado.append(grupo("g-selecao", sDuplicar, sOpcoes, sCantoMais, sCantoMenos, sApagar), grupoFundo);
  acoes.append(linhaGeral);
  // Dentro da planta, discreto (em baixo, à esquerda): o que está selecionado e o texto de estado (vazio sem nada a dizer).
  const estadoLinha = el("div", "editor-estado");
  estadoLinha.append(selecaoNome, dica);

  const area = el("div", "editor-area");
  const svg = svgEl("svg");
  svg.setAttribute("class", "editor-svg");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-roledescription", "planta");
  svg.setAttribute("aria-label", "Planta da casa");
  svg.setAttribute("aria-describedby", "editor-ajuda-teclado");
  area.append(svg, estadoLinha, acoesLado);
  const ajudaTeclado = el("p", "editor-ajuda", "Com o teclado: nas barras as setas passam de botão em botão; escolha uma ferramenta e carregue em Enter para a pôr no centro; na planta as setas movem o que está selecionado (Shift para mover mais), Enter abre as opções, Delete apaga, Ctrl+Z anula.");
  ajudaTeclado.id = "editor-ajuda-teclado";

  /**
   * Põe `caixa` (position: fixed) junto ao "⋯": por baixo dele (por cima, se não couber; se não couber inteira em
   * nenhum dos lados, por baixo a rolar dentro de si), alinhada à direita dele e sempre dentro do ecrã (8 px de margem).
   */
  function juntoAoBotao(caixa) {
    const m = 8;
    const r = (bOutras.hidden ? bFundo : bOutras).getBoundingClientRect();
    // A altura inteira do conteúdo (sem mexer no max-height antes de medir: não perde o que se rolou lá dentro).
    const w = caixa.offsetWidth;
    const h = Math.min(caixa.scrollHeight + caixa.offsetHeight - caixa.clientHeight, innerHeight - 2 * m);
    let top = r.bottom + 4;
    let alto = innerHeight - 2 * m;
    if (top + h > innerHeight - m) {
      if (r.top - 4 - h >= m) top = r.top - 4 - h;
      else if (innerHeight - m - top >= 240) alto = innerHeight - m - top;
      else top = Math.max(m, innerHeight - m - h);
    }
    caixa.style.maxHeight = `${Math.round(alto)}px`;
    caixa.style.top = `${Math.round(top)}px`;
    caixa.style.left = `${Math.round(Math.max(m, Math.min(r.right - w, innerWidth - m - w)))}px`;
  }

  // O menu do "⋯" (role=menu): no top layer (popover) onde o navegador o tem; abre com o foco no 1.º item, as setas
  // passam de item em item, Esc fecha e volta ao "⋯", Tab fecha e segue para o seguinte, tocar fora fecha. O app.js junta-lhe "Refazer planta".
  const menu = el("div", "editor-menu");
  menu.id = "editor-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Mais ações da planta");
  const MENU_NA_BARRA = true;
  const comPopover = !MENU_NA_BARRA && typeof menu.showPopover === "function";
  if (MENU_NA_BARRA) { menu.setAttribute("role", "group"); menu.classList.add("na-barra"); grupoFundo.append(menu); }
  else if (comPopover) menu.popover = "manual"; else menu.hidden = true;
  menu.append(bImprimir, bPdf, bFundo);
  const menuAberto = () => !MENU_NA_BARRA && (comPopover ? menu.matches(":popover-open") : !menu.hidden);
  const itensMenu = () => [...menu.querySelectorAll("button")].filter((b) => !b.hidden && !b.disabled);
  function abrirMenu() {
    for (const b of menu.querySelectorAll("button")) { b.setAttribute("role", "menuitem"); b.tabIndex = -1; }
    if (comPopover) menu.showPopover(); else menu.hidden = false;
    bOutras.setAttribute("aria-expanded", "true");
    juntoAoBotao(menu);
    itensMenu()[0]?.focus({ preventScroll: true });
  }
  /** Fecha o menu; `voltar`: o foco volta ao "⋯" (só se ainda estava no menu). */
  function fecharMenu(voltar = true) {
    if (!menuAberto()) return;
    const noMenu = menu.contains(document.activeElement);
    for (const c of menu.querySelectorAll(".confirmar")) c.remove();
    if (comPopover) menu.hidePopover(); else menu.hidden = true;
    bOutras.setAttribute("aria-expanded", "false");
    if (voltar && noMenu) bOutras.focus({ preventScroll: true });
  }
  /** O elemento focável a seguir ao "⋯" na ordem do Tab (fora do menu). */
  function depoisDoBotao() {
    const l = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")]
      .filter((x) => !menu.contains(x) && !x.disabled && x.tabIndex >= 0 && x.getClientRects().length && !x.closest("[inert], [hidden]"));
    return l[l.indexOf(bOutras) + 1] ?? null;
  }
  bOutras.addEventListener("click", () => (menuAberto() ? fecharMenu() : abrirMenu()));
  bOutras.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" && !menuAberto()) { ev.preventDefault(); abrirMenu(); }
  });
  menu.addEventListener("keydown", (ev) => {
    if (!menuAberto()) return;   // na barra são botões normais
    const l = itensMenu();
    const i = l.indexOf(document.activeElement);
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fecharMenu(); return; }
    // Tab (padrão menu; também na confirmação de "Refazer planta"): fecha e o foco segue para o elemento seguinte ao
    // "⋯" (Shift+Tab: o próprio "⋯").
    if (ev.key === "Tab") { ev.preventDefault(); ev.stopPropagation(); fecharMenu(false); (ev.shiftKey ? bOutras : depoisDoBotao() ?? bOutras).focus(); return; }
    const k = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: l.length - 1 }[ev.key];
    if (k === undefined || !l.length) return;
    ev.preventDefault();
    l[(k + l.length) % l.length].focus({ preventScroll: true });
  });
  // Escolher um item fecha o menu (depois da ação dele: "Planta de fundo" põe o foco na janela do fundo). Se a ação
  // pedir confirmação no menu ("Refazer planta"), fica aberto até se responder.
  menu.addEventListener("click", (ev) => {
    if (!menuAberto() || !ev.target.closest("button")) return;
    if (menu.querySelector(".confirmar")) juntoAoBotao(menu); else fecharMenu();
  });
  document.addEventListener("pointerdown", (ev) => {
    if (menuAberto() && !menu.contains(ev.target) && !bOutras.contains(ev.target)) fecharMenu(false);
  }, true);

  // A janela do fundo (e do tamanho): <dialog> não modal (a planta continua a responder, para calibrar), junto ao
  // "⋯", por cima da página; Esc ou "Fechar" fecham-na. O que se muda numa divisão ou num elemento está todo na
  // janela de edição (duplo clique, toque longo, Enter ou "Opções").
  const lado = el("dialog", "editor-lado");
  lado.id = "editor-lado";
  lado.setAttribute("aria-labelledby", "editor-lado-titulo");
  const ladoCabeca = el("div", "editor-lado-cabeca");
  const ladoTitulo = el("h2", null, "Planta de fundo");
  ladoTitulo.id = "editor-lado-titulo";
  const ladoFechar = botao("Fechar");
  ladoFechar.id = "editor-lado-fechar";
  ladoFechar.addEventListener("click", () => mostrarLado(false, true));
  ladoCabeca.append(ladoTitulo, ladoFechar);
  lado.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); mostrarLado(false, true); } });
  /** Abre ou fecha a janela do fundo; ao fechar, `voltar` põe o foco no "⋯" (se estava na janela). */
  function mostrarLado(sim, voltar = false) {
    if (sim) {
      fundoSec.hidden = false;
      if (!lado.open) lado.show();
      juntoAoBotao(lado);
      return;
    }
    const naJanela = lado.contains(document.activeElement);
    if (lado.open) lado.close();
    fundoSec.hidden = true;   // lote 8: o cartão do fundo só aparece com "Planta de fundo"
    if (voltar && naJanela) (bOutras.hidden ? bFundo : bOutras).focus({ preventScroll: true });
  }
  // O menu e a janela acompanham o "⋯" quando a página rola ou muda de tamanho.
  const seguirBotao = () => { if (menuAberto()) juntoAoBotao(menu); if (lado.open) juntoAoBotao(lado); };
  addEventListener("resize", seguirBotao);
  addEventListener("scroll", (ev) => { if (!menu.contains(ev.target) && !lado.contains(ev.target)) seguirBotao(); }, { capture: true, passive: true });

  // Fundo (lote 8: escondido até se tocar em "Planta de fundo", no "⋯")
  const fundoSec = el("details", "editor-fundo cartao");
  fundoSec.hidden = true;
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

  // Lote 7: legenda das marcas das ações (M, R, S, N) na planta.
  const legendaAcao = el("p", "ajuda editor-legenda-acoes");
  legendaAcao.hidden = true;
  let acoesOmissao = null;   // ação por omissão do serviço (definirAcoes); null = sem marcas
  // Lote 8 (definirPermissoes): o que o passo deixa mudar. Divisões só em "A casa" e "Planta"; aparelhos escondidos em "A casa".
  let podeDivisoes = true;
  let podeAparelhos = true;
  let soElementos = null;   // null = todas; ou a lista das peças que o passo deixa pôr (["porta", "janela", "quadro"])
  let podeMaquinas = true;   // false: a linha das ferramentas sem as máquinas (passo "Equipamentos": marcam-se nos cartões)
  // O duplo clique (duplo toque e toque longo) abre a janela / mexe nos cantos? No passo Planta não (decisão do dono,
  // 2026-10-04): aí arrasta-se; a janela continua no botão "Opções" e no Enter.
  let podeDuplo = true;
  /** Tentou mudar uma divisão presa: a dica (e quem usa o editor mostra onde se mudam, `aoDivisaoPresa`). */
  function divisaoPresa() {
    avisar("Divisões presas neste passo.");
    aoDivisaoPresa?.();
  }
  let acoesOpcoes = {};      // lote 8: {todas, escolher} (planta-svg.js opção `acoes`)
  lado.append(ladoCabeca, fundoSec);
  const principal = el("div", "editor-principal");
  // Os separadores dos pisos ficam junto à planta, por baixo das duas linhas (ferramentas e ações). Lote 8: a legenda
  // das marcas fica por baixo da planta, só quando as marcas estão em todos os aparelhos ("Trocar e reparar").
  principal.append(filaCaixa, acoes, separadores, area, legendaAcao, ajudaTeclado);

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
  raiz.append(principal, ...(MENU_NA_BARRA ? [] : [menu]), lado, dialogo, janelaDiv);   // na barra, o "menu" já está dentro dela

  // ---------------------------------------------------------------- barras (role=toolbar): setas
  /**
   * "Roving tabindex": numa barra só um botão está na ordem do Tab (o último usado); as setas ← → (e Home/End)
   * passam aos outros botões ativos dessa barra. Os separadores dos pisos (na barra das ações) têm as setas deles.
   * Devolve a função que acerta os tabindex depois de os botões mudarem (novos, ativados ou desativados).
   */
  function barraComSetas(barraEl, itens) {
    // Só os que se veem (o "Ampliar" não aparece no telemóvel).
    const ativos = () => itens().filter((b) => !b.disabled && !b.hidden && b.getClientRects().length > 0);
    const marcar = (b) => { for (const x of itens()) x.tabIndex = x === b ? 0 : -1; };
    barraEl.addEventListener("keydown", (ev) => {
      const l = ativos();
      const i = l.indexOf(document.activeElement);
      if (i < 0) return;
      const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: l.length - 1 }[ev.key];
      if (k === undefined) return;
      ev.preventDefault();
      const b = l[(k + l.length) % l.length];
      marcar(b);
      b.focus();
    });
    barraEl.addEventListener("focusin", (ev) => { if (itens().includes(ev.target)) marcar(ev.target); });
    return () => {
      const l = itens();
      if (!l.length) return;
      const atual = l.find((b) => b.tabIndex === 0 && !b.disabled && !b.hidden);
      marcar(atual ?? ativos()[0] ?? l[0]);
    };
  }
  // A linha das ferramentas: uma só paragem do Tab; as setas passam pelos botões à vista dos 3 grupos.
  rovingFerramentas = barraComSetas(fila, () => [...fila.querySelectorAll("button")]);
  // Pela ordem em que se veem (os grupos têm `order` no CSS: no computador a seleção vem antes do fundo).
  const ordemVista = (b) => Number(getComputedStyle(b.closest(".editor-acoes-grupo")).order) || 0;
  const rovingAcoes = barraComSetas(acoes, () => [...acoes.querySelectorAll(".editor-acoes-grupo button")].map((b, i) => [b, ordemVista(b), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([b]) => b));
  const rovingLado = barraComSetas(acoesLado, () => [...acoesLado.querySelectorAll("button")]);
  acertarBarra();

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
  // ---------------------------------------------------------------- pisos
  const noPiso = (x) => pisoDe(x) === pisoAtual;
  const divisoesPiso = () => planta.divisoes.filter(noPiso);
  // Lote 8 (definirPermissoes): sem aparelhos (passo "A casa") eles ficam escondidos — não se veem nem se tocam.
  /** Passo "Portas e janelas": só essas peças se veem e se tocam (as outras continuam na planta, escondidas). */
  const pecaDoPasso = (e) => !soElementos || soElementos.includes(e.tipo);
  const elementosPiso = () => (podeAparelhos ? planta.elementos.filter((e) => noPiso(e) && pecaDoPasso(e)) : []);
  /** N.º de separadores: os pisos da casa e os que já têm divisões ou elementos (ex.: mudou para apartamento). */
  const nPisos = () => Math.min(MAX_PISO + 1, Math.max(pisosPedidos, ...(planta ? [...planta.divisoes, ...planta.elementos].map((x) => pisoDe(x) + 1) : [1])));
  function desenharSeparadores() {
    const n = planta ? nPisos() : 1;
    separadores.hidden = n <= 1;
    separadores.replaceChildren();
    if (n <= 1) return;
    for (let p = 0; p < n; p++) {
      const b = botao("", "editor-piso");
      b.id = `editor-piso-${p}`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(p === pisoAtual));
      b.tabIndex = p === pisoAtual ? 0 : -1;
      const nd = planta.divisoes.filter((d) => pisoDe(d) === p).length;
      b.append(el("span", null, nomePiso(p)), el("small", null, `${nd} ${nd === 1 ? "divisão" : "divisões"}`));
      b.addEventListener("click", () => mudarPiso(p));
      b.addEventListener("keydown", (ev) => {
        const d = { ArrowRight: 1, ArrowLeft: -1, Home: -p, End: n - 1 - p }[ev.key];
        if (d === undefined) return;
        ev.preventDefault();
        mudarPiso((p + d + n) % n);
        document.getElementById(`editor-piso-${pisoAtual}`)?.focus();
      });
      separadores.append(b);
    }
  }
  /** Mostra outro piso: a vista ajusta-se a ele; o que se acrescenta vai para ele. */
  function mudarPiso(p, { anunciar: dizer = true } = {}) {
    if (p === pisoAtual) return;
    pisoAtual = p;
    if (selecionado && !noPiso(obterDivisao(selecionado) ?? obterElemento(selecionado) ?? {})) selecionado = null;
    ultimoToque = null;
    verTudo();
    nDivisoesVista = divisoesPiso().length;
    desenharTudo();
    if (dizer) avisar(`${nomePiso(p)}: ${nDivisoesVista} ${nDivisoesVista === 1 ? "divisão" : "divisões"}.`);
  }

  /** Caixa do que está desenhado no piso visível (divisões, elementos e a parte visível do fundo); a planta toda se vazio. */
  function caixaConteudo() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const juntar = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
    for (const d of divisoesPiso()) juntar(d.x_cm, d.y_cm, d.x_cm + d.largura_cm, d.y_cm + d.altura_cm);
    for (const e of elementosPiso()) juntar(e.x_cm - 40, e.y_cm - 40, e.x_cm + 40, e.y_cm + 40);   // o ícone à volta do centro
    if (planta.tamanho_fixo) juntar(0, 0, planta.largura_cm, planta.altura_cm);   // tamanho escolhido: mostra a folha toda
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
    focoAuto = null;
  }
  /**
   * Centra a vista na divisão `d` e aproxima até ela caber com margem (MARGEM_FOCO: as vizinhas continuam em parte à
   * vista; nada se esconde). Sem animação (vale igual com `prefers-reduced-motion`). Até o cliente mexer na vista,
   * volta a centrar se o tamanho da planta no ecrã mudar (ex.: a planta acabou de abrir por cima, no telemóvel).
   */
  function verDivisao(d) {
    const rr = rectSvg();
    const razao = rr.width > 0 && rr.height > 0 ? rr.height / rr.width : 0.75;
    const c = caixaConteudo();
    const tudo = limitar(Math.max(c.w, c.h / razao) * MARGEM_VISTA, 150, maxW());
    const w = Math.max(d.largura_cm, d.altura_cm / razao) * MARGEM_FOCO;
    vista = { cx: d.x_cm + d.largura_cm / 2, cy: d.y_cm + d.altura_cm / 2, w: Math.min(Math.max(w, MIN_LARGURA_FOCO), Math.max(tudo, 150)) };
    ajusteAuto = false;
    focoAuto = d.id;
  }
  function zoom(f, clientX, clientY) {
    ajusteAuto = false;
    focoAuto = null;
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
  // Cada passo guarda a planta e o piso que estava à vista: anular (ou refazer) volta também ao separador
  // desse momento (ex.: anular a mudança de piso de uma divisão mostra-a outra vez no piso de onde saiu).
  function memorizar() {
    desfazer.push({ p: clonarPlanta(planta), piso: pisoAtual });
    if (desfazer.length > HISTORICO_MAX) desfazer.shift();
    refazer = [];
  }
  function confirmar(texto) {
    // Um aparelho que continua dentro da sua divisão fica nela (uma vizinha nunca lho tira).
    atualizarDivisoes(planta, { manter: true });
    aoMudar(planta);
    // Vista parada: só volta a mostrar o piso inteiro e centrado quando se acrescenta ou apaga uma
    // divisão nele (mexer em objetos, arrastar ou mudar a forma não mexe na vista).
    if (divisoesPiso().length !== nDivisoesVista) { nDivisoesVista = divisoesPiso().length; verTudo(); }
    desenharTudo();
    if (texto) avisar(texto);
  }
  function anular() {
    if (!desfazer.length) return;
    refazer.push({ p: clonarPlanta(planta), piso: pisoAtual });
    voltarA(desfazer.pop(), "Anulado.");
  }
  function refazerAcao() {
    if (!refazer.length) return;
    desfazer.push({ p: clonarPlanta(planta), piso: pisoAtual });
    voltarA(refazer.pop(), "Refeito.");
  }
  function voltarA(h, texto) {
    planta = h.p;
    if (selecionado && !existe(selecionado)) selecionado = null;
    if (h.piso !== pisoAtual && h.piso < nPisos()) {
      pisoAtual = h.piso;
      if (selecionado && !noPiso(obterDivisao(selecionado) ?? obterElemento(selecionado) ?? {})) selecionado = null;
      nDivisoesVista = -1;   // a vista ajusta-se ao piso que voltou (confirmar)
    }
    confirmar(`${texto}${nPisos() > 1 ? ` (${nomePiso(pisoAtual)})` : ""}`);
    aoHistorico?.();
  }
  const existe = (id) => planta.divisoes.some((d) => d.id === id) || planta.elementos.some((e) => e.id === id);
  const obterDivisao = (id) => planta.divisoes.find((d) => d.id === id);
  /** Id da divisão mais pequena (em área) do piso à vista que contém o ponto; null se nenhuma. */
  function divisaoMenorEm(x, y) {
    let r = null, menor = Infinity;
    for (const d of planta.divisoes) {
      if (pisoDe(d) !== pisoAtual) continue;
      const pts = pontosDivisao(d);
      if (!pontoEmPoligono(x, y, pts)) continue;
      const a = areaPoligono(pts);
      if (a < menor) { menor = a; r = d.id; }
    }
    return r;
  }
  const obterElemento = (id) => planta.elementos.find((e) => e.id === id);

  function novoId(pre, lista) {
    let m = 0;
    for (const x of lista) m = Math.max(m, Number(String(x.id).slice(1)) || 0);
    return `${pre}${m + 1}`;
  }

  // ---------------------------------------------------------------- ações
  const tipoDivisao = (nome) => tiposDivisao.find((t) => t.nome === nome);
  /**
   * Nome de uma divisão nova do tipo `div`: o primeiro sem número, os seguintes a partir do 2 ("Quarto", "Quarto 2",
   * "Quarto 3"; "Sala", "Sala 2"). Numa planta antiga que já tem "Quarto 1", o seguinte continua a numeração.
   */
  function nomeNovaDivisao(div) {
    const usados = new Set(planta.divisoes.map((d) => d.nome));
    const t = tipoDivisao(div);
    if (!t || t.nome === "Outra") {
      for (let n = planta.divisoes.length + 1; ; n++) if (!usados.has(`Divisão ${n}`)) return `Divisão ${n}`;
    }
    if (!usados.has(t.nome) && !usados.has(`${t.nome} 1`)) return t.nome;
    for (let n = 2; ; n++) if (!usados.has(`${t.nome} ${n}`)) return `${t.nome} ${n}`;
  }
  /**
   * Sítio (canto de cima à esquerda, cm) para uma divisão nova w × h que não sobrepõe as outras (pela
   * caixa envolvente) nem apanha elementos soltos (os que não estão dentro de nenhuma divisão; os
   * aparelhos de uma divisão vizinha, junto à parede partilhada, não impedem de encostar): primeiro
   * encostada à direita ou por baixo de uma divisão (por ordem de leitura), depois a primeira posição
   * livre da grelha de 50 cm dentro da planta; se nada couber, à direita de tudo (ou por baixo), sempre
   * na grelha de 50 cm — a planta alarga (criarDivisao).
   */
  function sitioLivre(w, h, { piso = pisoAtual, preferir = null } = {}) {
    // Só as divisões e os elementos desse piso (os outros pisos ficam por cima/por baixo).
    const doPiso = (x) => pisoDe(x) === piso;
    const caixas = planta.divisoes.filter(doPiso).map((d) => [d.x_cm, d.y_cm, d.x_cm + d.largura_cm, d.y_cm + d.altura_cm]);
    const soltos = planta.elementos.filter(doPiso).filter((q) => !divisaoEm(planta, q.x_cm, q.y_cm, piso));
    const livre = (x, y) => x >= 0 && y >= 0 && x + w <= MAX_LADO_CM && y + h <= MAX_LADO_CM
      && caixas.every(([a, b, c, e]) => x >= c || x + w <= a || y >= e || y + h <= b)
      && soltos.every((q) => q.x_cm < x - 20 || q.x_cm > x + w + 20 || q.y_cm < y - 20 || q.y_cm > y + h + 20);
    // O sítio onde já está (mudar de piso): fica aí se estiver livre nesse piso.
    if (preferir && livre(preferir[0], preferir[1])) return preferir;
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
  /** A folha cresce (nunca encolhe aqui) até caber o ponto (x2, y2) em cm, com uma quadrícula de margem. */
  function crescerFolha(x2, y2) {
    const grelha = (v) => Math.min(MAX_LADO_CM, Math.ceil(v / ESCALA_CM) * ESCALA_CM);
    planta.largura_cm = Math.max(planta.largura_cm, grelha(x2 + ESCALA_CM));
    planta.altura_cm = Math.max(planta.altura_cm, grelha(y2 + ESCALA_CM));
  }

  function criarDivisao(div) {
    if (!podeDivisoes) { divisaoPresa(); return null; }
    if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return null; }
    const t = tipoDivisao(div) ?? { w: 400, h: 300 };
    const [x, y] = sitioLivre(t.w, t.h);
    memorizar();
    crescerFolha(x + t.w, y + t.h);
    const d = { id: novoId("d", planta.divisoes), nome: nomeNovaDivisao(div), piso: pisoAtual, x_cm: x, y_cm: y, largura_cm: t.w, altura_cm: t.h };
    planta.divisoes.push(d);
    let n = 0;
    const base = aparelhosOmissao(d.nome, d);
    for (const a of base) {
      if (planta.elementos.length >= MAX_ELEMENTOS) break;
      planta.elementos.push({ id: novoId("e", planta.elementos), ...a, piso: pisoAtual, divisao: d.id });
      n++;
    }
    ajustarFolha();
    selecionado = d.id;
    destaque = { id: d.id, desde: performance.now() };
    setTimeout(() => { if (destaque?.id === d.id) { destaque = null; desenhar(); } }, DESTAQUE_MS);
    confirmar(`Divisão "${d.nome}" criada${nPisos() > 1 ? ` no ${nomePiso(pisoAtual)}` : ""}${n && podeAparelhos ? ` com ${n === base.length ? resumoAparelhos(d.nome, d.largura_cm, d.altura_cm) : `${n} aparelhos habituais`}` : ""}. Arraste-a para o sítio certo, os cantos mudam a forma; o botão "Opções" (ou Enter) abre as opções.`);
    return d;
  }

  /**
   * Portas, janelas e quadro ficam sempre em cima da linha de uma divisão (decisão do dono, 2026-10-10): o ponto da
   * parede mais próxima de (x, y) neste piso. O quadro fica 5 cm para dentro, para contar nessa divisão (portas e
   * janelas têm tolerância: regras.js TIPOS_PAREDE). Outras peças, ou planta sem divisões: o ponto ajustado à grelha.
   */
  const PECAS_PAREDE = ["porta", "janela", "quadro"];
  function sitioDaPeca(tipo, x, y) {
    const livre = () => [limitar(ajustar(x, PASSO_ELEMENTO), 0, planta.largura_cm), limitar(ajustar(y, PASSO_ELEMENTO), 0, planta.altura_cm)];
    if (!PECAS_PAREDE.includes(tipo)) return livre();
    let q = null, melhor = Infinity, sala = null;
    for (const d of divisoesPiso()) {
      const pts = pontosDivisao(d);
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const r = distanciaSegmento(x, y, a, b);
        if (r.dist < melhor) { melhor = r.dist; q = [a[0] + r.t * (b[0] - a[0]), a[1] + r.t * (b[1] - a[1])]; sala = pts; }
      });
    }
    if (!q) return livre();
    if (tipo === "quadro") {
      const c = pontoInterior(sala);
      const dx = c[0] - q[0], dy = c[1] - q[1], l = Math.hypot(dx, dy) || 1;
      const dentro = [q[0] + (dx / l) * 5, q[1] + (dy / l) * 5];
      if (pontoEmPoligono(dentro[0], dentro[1], sala)) q = dentro;
    }
    return [limitar(Math.round(q[0]), 0, planta.largura_cm), limitar(Math.round(q[1]), 0, planta.altura_cm)];
  }
  function adicionarElemento(tipo, x, y, modelo = null) {
    if (!podeAparelhos) return null;
    if (planta.elementos.length >= MAX_ELEMENTOS) { avisar(`A planta já tem o máximo de ${MAX_ELEMENTOS} elementos.`); return null; }
    memorizar();
    const [sx, sy] = sitioDaPeca(tipo, x, y);
    const e = {
      id: novoId("e", planta.elementos), tipo,
      x_cm: sx,
      y_cm: sy,
      rot: 0, piso: pisoAtual, divisao: null, props: propsOmissao(tipo, modelo),
    };
    if (temPergunta(tipo, e.props)) e.por_responder = true;   // passo 4: por responder até guardar a janela dele
    // Decisão do dono (2026-10-03): o que o cliente acrescenta a partir de "Trocar e reparar" é trabalho novo (`acao`
    // "novo"; quem usa o editor decide pelo passo, `acaoAoPor`); antes disso é o que a casa já tem (sem ação: Manter).
    const acao = acaoAoPor?.(tipo, e.props);
    if (acao) e.acao = acao;
    planta.elementos.push(e);
    // Numa zona sobreposta: a divisão selecionada (ex.: "+" do passo Divisões); sem ela, a desenhada por cima.
    e.divisao = selecionadaEm(e.x_cm, e.y_cm)?.id ?? divisaoDoElemento(planta, e);
    selecionado = e.id;
    const onde = e.divisao ? `divisão ${obterDivisao(e.divisao)?.nome || "sem nome"}` : "fora das divisões: arraste-o para dentro";
    confirmar(`Na planta: ${nomeFerramenta(tipo, modelo)} (${onde}).`);
    return e;
  }
  const nomeFerramenta = (tipo, modelo) => (tipo === "maquina" && MODELOS[modelo] ? MODELOS[modelo].nome : ELEMENTOS[tipo].nome);

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
    const w = limitar(Math.ceil((x2 + dx) / ESCALA_CM) * ESCALA_CM + ESCALA_CM, 100, MAX_LADO_CM);
    const h = limitar(Math.ceil((y2 + dy) / ESCALA_CM) * ESCALA_CM + ESCALA_CM, 100, MAX_LADO_CM);
    // Tamanho escolhido pelo cliente ("Tamanho da planta"): a folha só cresce se o conteúdo não couber.
    planta.largura_cm = planta.tamanho_fixo ? Math.max(w, planta.largura_cm) : w;
    planta.altura_cm = planta.tamanho_fixo ? Math.max(h, planta.altura_cm) : h;
  }
  /** Menor tamanho da folha que ainda contém as divisões e os elementos (cm). */
  function tamanhoMinimo(k) {
    const ate = k === "largura_cm"
      ? [...planta.divisoes.map((d) => d.x_cm + d.largura_cm), ...planta.elementos.map((e) => e.x_cm)]
      : [...planta.divisoes.map((d) => d.y_cm + d.altura_cm), ...planta.elementos.map((e) => e.y_cm)];
    return Math.max(100, ...ate.map((v) => Math.ceil(v / ESCALA_CM) * ESCALA_CM));
  }

  function apagarSelecionado() {
    if (!selecionado) return;
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) return;
    if (d && !podeDivisoes) { divisaoPresa(); return; }
    memorizar();
    // Apagar uma divisão apaga também os aparelhos dela (senão ficavam "Fora das divisões" e contavam no pedido);
    // "Anular" repõe tudo de uma vez (memorizar guarda a planta inteira).
    // Os dela: com `divisao` = ela, ou sem divisão e dentro dela (estados antigos).
    const eDela = (x) => x.divisao === d.id || (!x.divisao && divisaoEm(planta, x.x_cm, x.y_cm, pisoDe(x)) === d.id);
    const dela = d ? planta.elementos.filter(eDela).length : 0;
    if (d) {
      planta.elementos = planta.elementos.filter((x) => !eDela(x));
      planta.divisoes = planta.divisoes.filter((x) => x !== d);
    }
    if (e) planta.elementos = planta.elementos.filter((x) => x !== e);
    if (d) ajustarFolha();
    selecionado = null;
    confirmar(d ? `Divisão "${d.nome}" apagada${dela ? ` com ${dela === 1 ? "o seu aparelho" : `os seus ${dela} aparelhos`}` : ""}. "Anular" repõe tudo.` : `Apagado da planta: ${ELEMENTOS[e.tipo].nome}.`);
    svg.focus({ preventScroll: true });
  }

  function moverSelecionado(dx, dy) {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (!d && !e) return false;
    if (d && !podeDivisoes) { divisaoPresa(); return false; }
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
  const caixaDe = (d) => ({ x_cm: d.x_cm, y_cm: d.y_cm, largura_cm: d.largura_cm, altura_cm: d.altura_cm });

  // ---------------------------------------------------------------- divisões sobrepostas (permitido)
  // As divisões podem ficar umas por cima das outras (arrastar, cantos, setas, medidas, duplicar). Os aparelhos
  // não mudam de divisão por isso: cada um guarda a sua (`divisao`), a divisão movida leva os seus
  // (elementosDentro) e atualizarDivisoes(…, {manter: true}) nunca a tira a quem ainda lá está.
  /** A divisão selecionada, se contém o ponto (cm): numa zona sobreposta ganha ela (é a desenhada por cima). */
  function selecionadaEm(x, y) {
    const s = obterDivisao(selecionado);
    return s && pisoDe(s) === pisoAtual && pontoEmPoligono(x, y, pontosDivisao(s)) ? s : null;
  }

  /**
   * Os aparelhos acompanham a divisão quando ela muda de tamanho ou de forma (cantos, largura/comprimento,
   * janela de edição): `dentro` = [[elemento, x, y]] e `c0` = caixa da divisão antes da mudança. Em cada
   * eixo, o que está a ≤ 30 cm de uma parede fica à mesma distância dessa parede (portas, janelas,
   * interruptores e tomadas continuam encostados); o resto reparte-se na proporção da caixa nova. Numa forma
   * livre, o que ficar fora vai para o ponto de dentro mais perto (15 cm para dentro da parede) — nunca
   * passa para "Fora das divisões" por causa disto.
   */
  function acompanhar(d, c0, dentro) {
    const pts = pontosDivisao(d);
    const eixo = (v, a0, l0, a1, l1) => {
      if (v - a0 <= TOLERANCIA_PORTA_CM) return a1 + (v - a0);
      if (a0 + l0 - v <= TOLERANCIA_PORTA_CM) return a1 + l1 - (a0 + l0 - v);
      return a1 + (l0 > 0 ? ((v - a0) * l1) / l0 : l1 / 2);
    };
    for (const [e, x0, y0] of dentro) {
      let x = eixo(x0, c0.x_cm, c0.largura_cm, d.x_cm, d.largura_cm);
      let y = eixo(y0, c0.y_cm, c0.altura_cm, d.y_cm, d.altura_cm);
      const naParede = TIPOS_PAREDE.includes(e.tipo) && distanciaPoligono(x, y, pts) <= TOLERANCIA_PORTA_CM;
      if (!pontoEmPoligono(x, y, pts) && !naParede) [x, y] = pontoDentro(pts, x, y);
      e.x_cm = Math.round(limitar(x, 0, planta.largura_cm));
      e.y_cm = Math.round(limitar(y, 0, planta.altura_cm));
    }
  }
  /** Ponto dentro do polígono perto de (x, y): o da parede mais próxima, 15 cm para dentro (senão o interior). */
  function pontoDentro(pts, x, y) {
    let q = null, melhor = Infinity;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const r = distanciaSegmento(x, y, a, b);
      if (r.dist < melhor) { melhor = r.dist; q = [a[0] + r.t * (b[0] - a[0]), a[1] + r.t * (b[1] - a[1])]; }
    });
    const c = pontoInterior(pts);
    if (!q) return c;
    const dx = c[0] - q[0], dy = c[1] - q[1], l = Math.hypot(dx, dy) || 1;
    const k = Math.min(15, l / 2);
    const p = [q[0] + (dx / l) * k, q[1] + (dy / l) * k];
    return pontoEmPoligono(p[0], p[1], pts) ? p : c;
  }

  /** Desloca a divisão (sem grelha) e os elementos `dentro` (lista de elementos) dx, dy cm. */
  function deslocarDivisao(d, dx, dy, dentro) {
    d.x_cm += dx;
    d.y_cm += dy;
    if (d.pontos) d.pontos = d.pontos.map(([x, y]) => [x + dx, y + dy]);
    for (const x of dentro) { x.x_cm += dx; x.y_cm += dy; }
  }

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
    if (!v) { avisar("Canto demasiado perto de outro."); return; }
    memorizar();
    const c0 = caixaDe(d), dentro = elementosDentro(d);
    definirPontos(d, v);
    acompanhar(d, c0, dentro);
    selecionado = d.id;
    confirmar(`Canto acrescentado à divisão "${d.nome || "Divisão"}" (${v.length} cantos). Arraste-o para inclinar a parede.`);
  }

  function apagarCanto(d, i) {
    const pts = pontosDivisao(d);
    if (pts.length <= MIN_CANTOS) { avisar(`Uma divisão tem pelo menos ${MIN_CANTOS} cantos.`); return; }
    pts.splice(i, 1);
    const v = validarPontos(pts, planta.largura_cm, planta.altura_cm);
    if (!v) { avisar("Não dá para apagar este canto: mova-o."); return; }
    memorizar();
    const c0 = caixaDe(d), dentro = elementosDentro(d);
    definirPontos(d, v);
    acompanhar(d, c0, dentro);
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
    // O elemento desenhado por cima (o último) ganha; só os do piso visível.
    const els = elementosPiso();
    for (let k = els.length - 1; k >= 0; k--) {
      const e = els[k];
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
    const id = selecionadaEm(p.x, p.y)?.id ?? divisaoEm(planta, p.x, p.y, pisoAtual);
    return id ? { tipo: "divisao", d: obterDivisao(id) } : null;
  }

  /**
   * Duplo clique (ou duplo toque) e toque longo (`longo`): parede → canto novo; canto → apaga-o (no toque longo
   * abre a janela da divisão: um dedo parado antes de arrastar não deve apagar nada); resto → janela.
   */
  function gestoDuplo(p, tipoPonteiro, { longo = false } = {}) {
    duploEm = performance.now();
    ultimoToque = null;
    if (!podeDuplo) return;
    const alvo = oQueEsta(p, tipoPonteiro);
    if (!alvo) return;
    if ((alvo.tipo === "canto" || alvo.tipo === "parede") && !podeDivisoes) { divisaoPresa(); return; }
    if (alvo.tipo === "canto" && longo) { selecionado = alvo.d.id; desenharTudo(); abrirDialogo(); return; }
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

  /** Desliza a linha das ferramentas até ao botão `b` (sem mexer na página). */
  function verNaLinha(b) {
    const f = fila.getBoundingClientRect(), r = b.getBoundingClientRect();
    if (!f.width || !r.width) return;
    if (r.left < f.left) fila.scrollLeft -= f.left - r.left + 8;
    else if (r.right > f.right) fila.scrollLeft += r.right - f.right + 8;
  }

  function definirModo(m) {
    if (m?.tipo === "elemento" && !podeAparelhos) m = null;   // o passo não deixa pôr aparelhos (ex.: "A casa")
    // Escolheu uma ferramenta com um aparelho a seguir o rato: o aparelho volta ao sítio e fica à espera.
    if (m && seguir?.mexeu) { const s = seguir; pararSeguir(); seguir = { ...s, mexeu: false }; svg.classList.add("a-seguir"); }
    modo = m;
    // Calibração a meio (só o 1.º ponto) cancelada com Esc ou outra ferramenta: o marcador sai da planta.
    if (m?.tipo !== "calibrar" && calibracao && (calibracao.pontos?.length ?? 0) < 2) calibracao = null;
    const chave = m?.tipo === "elemento" ? (m.el === "maquina" ? `maquina:${m.modelo}` : m.el) : null;
    for (const [k, b] of Object.entries(ferramentas)) b.setAttribute("aria-pressed", String(k === chave));
    // A ferramenta ativa (também a do "+" do passo Divisões) fica à vista na linha.
    if (chave && ferramentas[chave]) verNaLinha(ferramentas[chave]);
    svg.classList.toggle("a-colocar", !!m);
    // Sem ferramenta, nada a dizer (decisão do dono: saiu o texto de ajuda longo por cima da planta).
    if (!m) dica.textContent = "";
    else if (m.tipo === "elemento") dica.textContent = `Toque na planta para pôr: ${nomeFerramenta(m.el, m.modelo).toLowerCase()}. Esc cancela.`;
    else if (m.tipo === "calibrar") dica.textContent = m.pontos.length ? "Agora toque no fim da mesma parede." : "Calibrar: toque no início de uma parede que conheça, na imagem de fundo.";
    desenhar();
  }

  desenharBotoesDivisao();
  desenharBotoesMaquina();
  bDesfazer.addEventListener("click", anular);
  bRefazer.addEventListener("click", refazerAcao);
  bMais.addEventListener("click", () => zoom(1 / 1.4));
  bMenos.addEventListener("click", () => zoom(1.4));
  bTudo.addEventListener("click", () => { verTudo(); desenhar(); });
  bImprimir.addEventListener("click", () => { if (planta) imprimirPlanta(planta, nPisos(), acoesOmissao); });
  bPdf.addEventListener("click", async () => {
    if (!planta || bPdf.disabled) return;
    bPdf.disabled = true;
    avisar("A preparar o PDF…");
    try {
      await guardarPdf(planta, nPisos(), acoesOmissao);
      avisar(`PDF guardado: planta-domus.pdf (${nPisos() > 1 ? `${nPisos()} páginas, uma por piso` : "1 página"}).`);
    } catch {
      avisar("PDF falhou: use \"Imprimir\" › Guardar como PDF.");
    } finally {
      bPdf.disabled = false;
      bPdf.focus({ preventScroll: true });
    }
  });

  // ---------------------------------------------------------------- ecrã inteiro
  // Só a planta e as ferramentas (Fullscreen API no contentor; sem ela, um recurso CSS que ocupa a janela).
  // Esc sai; a vista reajusta-se ao entrar e ao sair.
  const emEcraInteiro = () => document.fullscreenElement === principal || ecraCss;
  function depoisEcra() {
    const sim = emEcraInteiro();
    iconeAcao(bEcra, sim ? "reduzir" : "ampliar", sim ? "Reduzir (sair do ecrã inteiro)" : "Ampliar (ecrã inteiro)");
    bEcra.setAttribute("aria-pressed", String(sim));
    principal.classList.toggle("em-ecra-inteiro", sim);
    // O tamanho já mudou (a classe acabou de mudar; o "fullscreenchange" chega depois do redimensionamento).
    if (planta) { verTudo(); desenhar(); }
  }
  function sairEcra() {
    if (document.fullscreenElement === principal) document.exitFullscreen?.()?.catch?.(() => {});
    if (ecraCss) {
      ecraCss = false;
      principal.classList.remove("ecra-inteiro");
      document.documentElement.classList.remove("editor-sem-rolar");
      depoisEcra();
    }
  }
  async function entrarEcra() {
    if (principal.requestFullscreen && document.fullscreenEnabled !== false) {
      // Sem permissão (erro) ou sem resposta (alguns navegadores embutidos nunca respondem): recurso CSS.
      const pedido = principal.requestFullscreen({ navigationUI: "hide" }).then(() => "ok", () => "erro");
      const r = await Promise.race([pedido, new Promise((ok) => { setTimeout(() => ok("demora"), 800); })]);
      if (r === "ok" || document.fullscreenElement === principal) return;
    }
    ecraCss = true;
    principal.classList.add("ecra-inteiro");
    document.documentElement.classList.add("editor-sem-rolar");
    depoisEcra();
  }
  bEcra.addEventListener("click", () => { if (emEcraInteiro()) sairEcra(); else entrarEcra(); });
  document.addEventListener("fullscreenchange", depoisEcra);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ecraCss && !dialogo.open) sairEcra(); });

  // ---------------------------------------------------------------- ponteiro
  const pararToqueLongo = () => { clearTimeout(toqueLongo); toqueLongo = null; };

  // "A seguir o rato" (seguirElemento; passo "Equipamentos", decisão do dono 2026-10-10): o aparelho acabado de marcar
  // acompanha o rato sobre a planta, sem carregar em nada, até um clique o largar. Se o rato sair da planta sem
  // clicar, volta ao sítio onde estava. Só com rato (com o dedo não há "passar por cima").
  let seguir = null;   // { id, x0, y0, mexeu, aoLargar }
  function pararSeguir({ repor = true } = {}) {
    const s = seguir;
    seguir = null;
    svg.classList.remove("a-seguir");
    const e = s ? obterElemento(s.id) : null;
    if (!e || !s.mexeu) return;
    if (repor) { e.x_cm = s.x0; e.y_cm = s.y0; }
    desenhar();
  }
  svg.addEventListener("pointermove", (ev) => {
    // Com uma ferramenta escolhida (porta, tomada…) quem manda é ela: o aparelho não segue o rato.
    if (!seguir || modo || ev.pointerType !== "mouse" || ponteiros.size) return;
    const e = obterElemento(seguir.id);
    if (!e) { seguir = null; return; }
    seguir.mexeu = true;   // (o anular só se memoriza ao largar: passar o rato não mexe no histórico)
    const p = paraPlanta(ev.clientX, ev.clientY);
    e.x_cm = limitar(ajustar(p.x, PASSO_ELEMENTO), 0, planta.largura_cm);
    e.y_cm = limitar(ajustar(p.y, PASSO_ELEMENTO), 0, planta.altura_cm);
    desenhar();
  });
  svg.addEventListener("pointerleave", () => {
    if (!seguir?.mexeu) return;
    const s = seguir;
    pararSeguir();
    seguir = { ...s, mexeu: false };   // continua à espera: volta a seguir quando o rato regressar à planta
    svg.classList.add("a-seguir");
  });
  svg.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && seguir) pararSeguir(); });
  // Ferramenta escolhida (porta, janela, tomada…; decisão do dono, 2026-10-10): uma marca acompanha o rato sobre a
  // planta, para se ver onde o clique a vai pôr — como os equipamentos de "Equipamentos". Só com rato.
  let fantasma = null;   // { x, y } em cm
  svg.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || ponteiros.size) return;
    if (modo?.tipo !== "elemento") { if (fantasma) { fantasma = null; desenhar(); } return; }
    const p = paraPlanta(ev.clientX, ev.clientY);
    const [fx, fy] = sitioDaPeca(modo.el, p.x, p.y);
    fantasma = { x: fx, y: fy };
    desenhar();
  });
  svg.addEventListener("pointerleave", () => { if (fantasma) { fantasma = null; desenhar(); } });

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button > 0) return;
    if (seguir && !modo && ev.pointerType === "mouse") {
      // O clique larga o aparelho onde o rato está: um só passo de anular (a planta como estava antes de ele seguir
      // o rato), e quem o pediu fica a saber.
      ev.preventDefault();
      const s = seguir;
      const e = obterElemento(s.id);
      if (e) { e.x_cm = s.x0; e.y_cm = s.y0; memorizar(); }
      const p = paraPlanta(ev.clientX, ev.clientY);
      if (e) {
        e.x_cm = limitar(ajustar(p.x, PASSO_ELEMENTO), 0, planta.largura_cm);
        e.y_cm = limitar(ajustar(p.y, PASSO_ELEMENTO), 0, planta.altura_cm);
      }
      seguir = null;
      svg.classList.remove("a-seguir");
      if (!e) return;
      selecionado = e.id;
      confirmar();
      desenharTudo();
      s.aoLargar?.(s.id);
      return;
    }
    svg.setPointerCapture?.(ev.pointerId);
    // O 1.º dedo (ou o rato) de um gesto novo: esquece ponteiros cujo "pointerup" não chegou à planta
    // (ex.: o toque longo abriu a janela por cima e o dedo foi levantado nela) — senão parecia uma pinça.
    if (ev.isPrimary) { ponteiros.clear(); pinca = null; }
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    pararToqueLongo();
    if (ponteiros.size === 2) {
      ajusteAuto = false;   // pinça: o cliente escolheu a vista
      focoAuto = null;
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
        gestoDuplo(p, tipo, { longo: true });
      }, TOQUE_LONGO_MS);
    }
    const alvo = ev.target.closest?.("[data-pega], [data-elemento], [data-divisao]");
    // Divisões sobrepostas: ganha a mais pequena debaixo do ponteiro (senão a de cima tapava a que tem dentro).
    const idDiv = alvo?.dataset.divisao ? divisaoMenorEm(p.x, p.y) ?? alvo.dataset.divisao : null;
    if (alvo?.dataset.pega && podeDivisoes) {
      const d = obterDivisao(alvo.dataset.id);
      if (d) { arrasto = { ...base, tipo: "canto", i: Number(alvo.dataset.pega), d, pts0: pontosDivisao(d), c0: caixaDe(d), dentro: elementosDentro(d) }; return; }
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
    // Divisões presas (lote 8): arrastar a selecionada desloca a vista e diz onde se mudam as divisões.
    if (idDiv && selecionado === idDiv && !podeDivisoes) {
      arrasto = { ...base, tipo: "deslocar", alvo: idDiv, presa: true };
      return;
    }
    if (idDiv && selecionado === idDiv) {
      const d = obterDivisao(idDiv);
      arrasto = { ...base, tipo: "divisao", d, x0: d.x_cm, y0: d.y_cm, pts0: d.pontos ? d.pontos.map((q) => [...q]) : null, dentro: elementosDentro(d) };
      return;
    }
    // Divisão não selecionada ou vazio: arrastar desloca a vista; tocar seleciona.
    arrasto = { ...base, tipo: "deslocar", alvo: idDiv };
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
        if (arrasto.presa && !arrasto.avisou) { arrasto.avisou = true; divisaoPresa(); }
        ajusteAuto = false;   // deslocou a vista à mão
        focoAuto = null;
        fixarPonto(arrasto.p0, ev.clientX, ev.clientY);
        desenhar();
        break;
      case "elemento":
        if (inicio) memorizar();
        [arrasto.e.x_cm, arrasto.e.y_cm] = sitioDaPeca(arrasto.e.tipo, arrasto.x0 + dx, arrasto.y0 + dy);
        desenhar();
        break;
      case "divisao": {
        // Pode ficar por cima de outra divisão; leva só os seus aparelhos.
        if (inicio) memorizar();
        const a = arrasto;
        moverDivisao(a.d, dx, dy, a.dentro, a.x0, a.y0, a.pts0);
        desenhar();
        break;
      }
      case "canto": {
        // O canto anda livre (qualquer ângulo); ajusta à grelha de 50 cm, salvo com Shift ou Alt (ao cm). A forma
        // pode ficar por cima de outra divisão.
        if (inicio) memorizar();
        const { d, i, pts0 } = arrasto;
        const livre = ev.shiftKey || ev.altKey;
        const x = livre ? pts0[i][0] + dx : ajustar(pts0[i][0] + dx, ESCALA_CM);
        const y = livre ? pts0[i][1] + dy : ajustar(pts0[i][1] + dy, ESCALA_CM);
        if (moverCanto(d, pts0, i, x, y)) {
          acompanhar(d, arrasto.c0, arrasto.dentro);
          desenhar();
        }
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
      const m = modo, cal = calibracao;
      definirModo(null);   // (tira a calibração a meio: aqui continua, com o 1.º ponto)
      if (m?.tipo === "elemento") {
        const posto = adicionarElemento(m.el, p.x, p.y, m.modelo);
        // Portas e janelas costumam ser várias (decisão do dono, 2026-10-10): a ferramenta fica escolhida para a
        // seguinte; Esc ou o botão outra vez desligam-na.
        if (posto && (m.el === "porta" || m.el === "janela") && ev?.pointerType === "mouse") { definirModo(m); fantasma = { x: posto.x_cm, y: posto.y_cm }; desenhar(); }
      }
      else if (m?.tipo === "calibrar") { calibracao = cal; pontoCalibracao(p); }
      return;
    }
    if (a.tipo === "deslocar") {
      if (!a.mexeu) {
        selecionado = a.alvo;
        desenharTudo();
        if (!a.alvo) definirModo(null);
        else if (!podeDivisoes) avisar(`${obterDivisao(a.alvo)?.nome || "Divisão"} selecionada.`);
        else avisar(`${obterDivisao(a.alvo)?.nome || "Divisão"}: arraste para mover, os cantos para a forma.`);
      }
      return;
    }
    if (!a.mexeu) { desenharTudo(); return; }
    // O texto de estado diz sempre o que aconteceu (senão ficava o aviso de um arrasto anterior).
    const nome = (x) => `"${x?.nome || "Divisão"}"`;
    if (a.tipo === "elemento") atualizarDivisoes(planta, { manter: true });   // a divisão onde ficou, para o texto
    confirmar(a.tipo === "canto" ? `Forma de ${nome(a.d)} mudada (${m2(areaPoligono(pontosDivisao(a.d)))} m²).`
        : a.tipo === "divisao" ? `${nome(a.d)} mudada de sítio.`
          : a.tipo === "elemento" ? `${descreverElemento(a.e)} mudado de sítio${a.e.divisao ? ` (${obterDivisao(a.e.divisao)?.nome || "divisão"})` : " (fora das divisões)"}.` : undefined);
  }

  /**
   * Toque (ou clique) sem arrastar: se for o 2.º perto do anterior e logo a seguir, é um duplo clique
   * (gestoDuplo). Feito aqui porque o "dblclick" do navegador não chega (ver DUPLO_MS).
   */
  function toqueSimples(ev) {
    const agora = performance.now();
    const tol = ev.pointerType === "mouse" || !ev.pointerType ? DUPLO_PX.mouse : DUPLO_PX.toque;
    const u = ultimoToque;
    if (u && !modo && !dialogo.open && agora - u.t <= DUPLO_MS && Math.hypot(ev.clientX - u.x, ev.clientY - u.y) <= tol) {
      gestoDuplo(paraPlanta(ev.clientX, ev.clientY), ev.pointerType === "mouse" || !ev.pointerType ? "mouse" : ev.pointerType);
      return;
    }
    ultimoToque = { t: agora, x: ev.clientX, y: ev.clientY };
  }

  const fimPonteiro = (ev) => {
    pararToqueLongo();
    const eraPinca = !!pinca;
    ponteiros.delete(ev.pointerId);
    if (ponteiros.size < 2) pinca = null;
    if (eraPinca) { arrasto = null; return; }
    if (arrasto && arrasto.id === ev.pointerId) {
      if (ev.type === "pointercancel") { arrasto = null; ultimoToque = null; desenhar(); return; }
      const a = arrasto;
      terminarArrasto(ev);
      if (!a.mexeu && a.tipo !== "colocar") toqueSimples(ev);
      else ultimoToque = null;
    }
  };
  svg.addEventListener("pointerup", fimPonteiro);
  svg.addEventListener("pointercancel", fimPonteiro);
  // Duplo clique do rato (e o duplo toque, onde o navegador o dá): o que fica no ponto decide (gestoDuplo).
  // Normalmente não chega (a planta é redesenhada entre os cliques): o duplo clique vem de toqueSimples.
  svg.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    if (modo || performance.now() - colocadoEm < 800 || performance.now() - duploEm < 800 || dialogo.open) return;   // o 2.º clique de quem acabou de pôr algo
    const toque = ev.pointerType === "touch" || ev.sourceCapabilities?.firesTouchEvents === true;
    gestoDuplo(paraPlanta(ev.clientX, ev.clientY), toque ? "touch" : "mouse");
  });
  // O toque longo não abre o menu do navegador por cima da planta.
  svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
  // A roda do rato faz scroll à página (não aproxima a planta); Ctrl + roda (e a pinça do touchpad,
  // que chega como Ctrl + roda) continua a aproximar. Zoom também pelos botões − / +.
  svg.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
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
    if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); zoom(1 / 1.25); return; }
    if (ev.key === "-") { ev.preventDefault(); zoom(1.25); return; }
    if (ev.key === "Escape") {
      // Esc usado aqui (cancelar a ferramenta, tirar a seleção) não fecha a planta aberta por cima (app.js).
      if (modo) { ev.preventDefault(); definirModo(null); }
      else if (selecionado) { ev.preventDefault(); selecionado = null; desenharTudo(); }
    }
  });
  // Esc com o foco na linha das ferramentas ou na barra das ações (logo depois de escolher a ferramenta): cancela-a,
  // como na planta ("Esc cancela"); sem ferramenta, segue (fecha a planta aberta por cima, app.js).
  for (const barra of [fila, acoes]) {
    barra.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && modo) { ev.preventDefault(); definirModo(null); }
    });
  }
  raiz.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.target.matches?.("input, textarea, select") || dialogo.open) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); anular(); } else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); refazerAcao(); }
  });

  // ---------------------------------------------------------------- calibração do fundo
  function pontoCalibracao(p) {
    const pontos = [...(modo?.pontos ?? calibracao?.pontos ?? []), p];
    if (pontos.length < 2) {
      calibracao = { pontos };
      definirModo({ tipo: "calibrar", pontos });
      return;
    }
    calibracao = { pontos };
    desenharTudo();
    fundoSec.open = true;
    mostrarLado(true);
    mostrarFundoMsg("Parede marcada: escreva quanto mede e toque em \"Aplicar\".", "info");
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
    confirmar();
    // A mensagem na janela do fundo (à vista, no lugar da de "Agora calibre…") e o foco num sítio lógico: o campo
    // desapareceu ao redesenhar — "Fechar" da janela (dentro dela: Esc continua a fechá-la), ou o "⋯".
    mostrarFundoMsg(`Fundo calibrado: a imagem tem agora ${metros(f.largura_cm)} m de largura.`, "ok");
    (lado.open ? ladoFechar : bOutras.hidden ? bFundo : bOutras).focus({ preventScroll: true });
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
      // Pode ter vindo do botão "Planta de fundo": o cartão abre-se para calibrar, ajustar ou tirar o fundo.
      fundoSec.open = true;
      mostrarLado(true);
      confirmar("Fundo carregado. Para acertar a escala, use \"Calibrar\" no cartão do fundo.");
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
    const l = campo("Carregar planta (JPG, PNG ou PDF)", ficheiro, "Só a 1.ª página do PDF.");
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
    const larg = numeroInput(metros(f.largura_cm).replace(",", "."), { min: 0.5, max: 200, step: "any", id: "fundo-largura" });
    larg.addEventListener("change", () => {
      const v = Number(larg.value);
      if (!(v > 0)) return;
      memorizar();
      f.largura_cm = Math.round(limitar(v * 100, 10, 2 * MAX_LADO_CM));
      ajustarPlantaAoFundo();
      confirmar();
    });
    const px = numeroInput(f.x_cm / 100, { min: -100, max: 100, step: "any", id: "fundo-x" });
    const py = numeroInput(f.y_cm / 100, { min: -100, max: 100, step: "any", id: "fundo-y" });
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
      const m = numeroInput("", { min: 0.1, max: 200, step: "any", id: "calibrar-metros" });
      m.placeholder = metros(med);
      const aplicar = botao("Aplicar", "btn pequeno");
      const cancelar = botao("Cancelar");
      aplicar.id = "calibrar-aplicar";
      const erro = el("small", "falta-escolher", "");
      erro.id = "calibrar-metros-erro";
      erro.setAttribute("role", "alert");   // anunciado ao aparecer
      erro.hidden = true;
      aplicar.addEventListener("click", () => {
        if (!aplicarCalibracao(Number(String(m.value).replace(",", ".")))) {
          erro.textContent = "Escreva o comprimento real em metros (ex.: 4,5).";
          erro.hidden = false;
          m.setAttribute("aria-invalid", "true");
          m.setAttribute("aria-describedby", erro.id);
          m.focus();
        }
      });
      m.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); aplicar.click(); } });
      m.addEventListener("input", () => { m.removeAttribute("aria-invalid"); });
      cancelar.addEventListener("click", () => { calibracao = null; desenharTudo(); mostrarFundoMsg("", "info"); fundoControlos.querySelector("#calibrar")?.focus({ preventScroll: true }); });
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
        mostrarLado(false);   // a planta fica toda à vista; a janela volta com os dois pontos marcados
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

  // Tamanho da folha (decisão do dono): "2×" e "½×" dobram / reduzem a metade a folha (largura e altura), com as
  // divisões onde estão (nunca ficam de fora: a metade recusa-se se as cortasse); "Ajustar" (ícone na barra das ações)
  // volta ao tamanho das divisões. Já não há campos de largura e altura.
  // Aviso curto na linha do título (a dica fica por cima da planta, fora da vista no telemóvel).
  const tamMsg = el("p", "msg", "");
  tamMsg.setAttribute("role", "status");
  tamMsg.hidden = true;
  let tamMsgFim = null;
  function avisoTamanho(t) {
    tamMsg.textContent = t;
    tamMsg.hidden = false;
    clearTimeout(tamMsgFim);
    tamMsgFim = setTimeout(() => { tamMsg.hidden = true; }, 5000);
  }
  /** Folha `f` vezes maior (2 ou 0,5), à quadrícula, entre o que as divisões e os elementos ocupam e o máximo. */
  function escalarFolha(f) {
    if (!planta) return;
    const w = limitar(Math.ceil((planta.largura_cm * f) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
    const h = limitar(Math.ceil((planta.altura_cm * f) / ESCALA_CM) * ESCALA_CM, 100, MAX_LADO_CM);
    if (w < tamanhoMinimo("largura_cm") || h < tamanhoMinimo("altura_cm")) { avisoTamanho("Metade não chega para as divisões."); return; }
    if (w === planta.largura_cm && h === planta.altura_cm) { avisoTamanho(f > 1 ? `Máximo ${metros(MAX_LADO_CM)} m.` : "Já está no mínimo."); return; }
    memorizar();
    planta.largura_cm = w;
    planta.altura_cm = h;
    planta.tamanho_fixo = true;   // a partir daqui a folha fica com este tamanho (gravado); "Ajustar" solta-a
    verTudo();
    confirmar(`Folha de ${metros(w)} × ${metros(h)} m.`);
  }
  const tamDobro = botao("2×");
  tamDobro.id = "planta-dobro";
  tamDobro.setAttribute("aria-label", "Folha duas vezes maior");
  tamDobro.title = tamDobro.getAttribute("aria-label");
  tamDobro.addEventListener("click", () => escalarFolha(2));
  const tamMetade = botao("½×");
  tamMetade.id = "planta-metade";
  tamMetade.setAttribute("aria-label", "Folha com metade do tamanho");
  tamMetade.title = tamMetade.getAttribute("aria-label");
  tamMetade.addEventListener("click", () => escalarFolha(0.5));
  // Sempre ativo: com a folha já à medida, carregar não muda nada.
  bAjustar.addEventListener("click", () => {
    if (!planta) return;
    memorizar();
    delete planta.tamanho_fixo;
    ajustarFolha();
    verTudo();
    confirmar("A planta voltou ao tamanho das divisões.");
  });

  // ---------------------------------------------------------------- propriedades (janela de edição)
  /**
   * A escolha de cada tipo de elemento na janela de edição — só uma, em linguagem simples: porta, se é a da rua;
   * janela, se tem estore e se é motorizado; interruptor, quantos botões (sem ser obrigatório); máquina, qual é
   * (com a potência típica). Tomada, ponto de luz (sempre não regulável, decisão do dono), sensores e quadro: nada a escolher.
   * `mudar(f)` devolve o que fazer quando o campo muda (f altera `p`); `pre` = prefixo dos ids.
   */
  function camposElemento(tipo, p, mudar, pre) {
    const r = [];
    if (tipo === "porta") r.push(caixa("É a porta da rua?", !!p.entrada, mudar((v) => { p.entrada = v; }), false, `${pre}-entrada`));
    if (tipo === "janela") {
      r.push(caixa("Tem estore?", !!p.estore, mudar((v) => { p.estore = v; if (!v) p.motorizado = false; }), false, `${pre}-estore`));
      r.push(caixa("É motorizado?", !!p.motorizado, mudar((v) => { p.motorizado = v; }), !p.estore, `${pre}-motorizado`));
    }
    // Tomada (ronda sinalizar): "Quantas?" (simples, dupla, tripla: `caixas`; `dupla` segue por compatibilidade) e a tomada
    // inteligente na mesma janela (`inteligente`; em "Trocar e reparar" a pergunta "Por um inteligente?" continua a mandar).
    if (tipo === "tomada") {
      const s = document.createElement("select");
      s.id = `${pre}-caixas`;
      for (const [n, t] of [[1, "Simples (1 tomada)"], [2, "Dupla (2 na mesma caixa)"], [3, "Tripla (3 na mesma caixa)"]]) { const o = document.createElement("option"); o.value = String(n); o.textContent = t; s.append(o); }
      s.value = String(caixasDe(p));
      s.addEventListener("change", mudar(() => { p.caixas = Number(s.value); p.dupla = p.caixas === 2; }));
      r.push(campo("Quantas?", s));
      r.push(caixa("Tomada inteligente (Wi-Fi, com medição)", !!p.inteligente, mudar((v) => { p.inteligente = v; }), false, `${pre}-inteligente`));
    }
    if (tipo === "interruptor") {
      const s = document.createElement("select");
      s.id = `${pre}-botoes`;
      for (const b of [1, 2, 3, 4]) { const o = document.createElement("option"); o.value = String(b); o.textContent = `${b} ${b === 1 ? "botão" : "botões"}`; s.append(o); }
      s.value = String(p.botoes);
      s.addEventListener("change", mudar(() => { p.botoes = Number(s.value); }));
      r.push(campo("Quantos botões?", s));
      // Ronda regras: o tipo de comando (simples, lustre, escada, inversor, botão de pressão) com uma linha de explicação.
      const c = document.createElement("select");
      c.id = `${pre}-comando`;
      for (const [k, v] of Object.entries(COMANDOS)) { const o = document.createElement("option"); o.value = k; o.textContent = v.nome; c.append(o); }
      c.value = comandoDe(p);
      const ajuda = el("small", "ajuda", COMANDOS[c.value].ajuda);
      c.addEventListener("change", mudar(() => {
        p.comando = c.value;
        ajuda.textContent = COMANDOS[c.value].ajuda;
        if (p.botoes < COMANDOS[c.value].botoes_min) { p.botoes = COMANDOS[c.value].botoes_min; s.value = String(p.botoes); }
      }));
      const l = campo("Comando", c);
      l.append(ajuda);
      r.push(l);
    }
    if (tipo === "maquina") {
      const s = document.createElement("select");
      s.id = `${pre}-modelo`;
      // Só os modelos do perfil do imóvel, e sempre o que já está escolhido (mesmo que seja de outro perfil).
      for (const [k, m] of Object.entries(MODELOS)) {
        if (modelosJanela && !modelosJanela.includes(k) && k !== p.modelo) continue;
        const o = document.createElement("option"); o.value = k; o.textContent = m.nome; s.append(o);
      }
      s.value = p.modelo;
      s.addEventListener("change", mudar(() => { p.modelo = s.value; p.potencia_w = MODELOS[s.value].w; }));
      r.push(campo("Qual é?", s));
    }
    return r;
  }

  /**
   * No telemóvel os painéis estão abaixo da planta: traz a planta de volta ao ecrã, inteira entre o topo
   * e a barra fixa de baixo ("Anterior/Seguinte"; a planta tem a altura que sobra entre as duas).
   */
  function mostrarPlanta() {
    if (emEcraInteiro()) return;
    const r = area.getBoundingClientRect();
    // A barra de baixo só conta se estiver por baixo da planta (no computador está na outra coluna).
    const n = document.querySelector(".sim-navegacao")?.getBoundingClientRect();
    const baixo = n && n.width && n.left < r.right && n.right > r.left ? n.top : innerHeight;
    if (r.top >= 0 && r.bottom <= Math.min(innerHeight, baixo)) return;
    area.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  let divisaoAvisada;   // a última divisão dita a `aoSelecionar`
  let elementoAvisado = null;   // o último aparelho dito a `aoSelecionarElemento`
  function desenharSelecao() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    const div = d?.id ?? e?.divisao ?? null;
    if (aoSelecionar && div !== divisaoAvisada) { divisaoAvisada = div; aoSelecionar(div); }
    // Lote 8 ("Trocar e reparar"): o aparelho selecionado (null sem nenhum), para mostrar o que fazer com ele.
    const elId = e?.id ?? null;
    if (aoSelecionarElemento && elId !== elementoAvisado) { elementoAvisado = elId; aoSelecionarElemento(elId); }
    const nome = d ? `Divisão ${d.nome || "sem nome"}` : e ? descreverElemento(e) : "";
    estadoLinha.classList.toggle("vazia", !d && !e);
    selecaoNome.textContent = nome ? `Selecionado: ${nome}` : "";
    // Divisões presas (lote 8): selecionam-se, mas não se duplicam, apagam nem mudam.
    sDuplicar.disabled = d ? !podeDivisoes || planta.divisoes.length >= MAX_DIVISOES : !e || planta.elementos.length >= MAX_ELEMENTOS;
    sOpcoes.disabled = d ? !podeDivisoes : !e;
    sApagar.disabled = d ? !podeDivisoes : !e;
    sCantoMais.disabled = !d || !podeDivisoes;
    sCantoMenos.disabled = !d || !podeDivisoes || pontosDivisao(d).length <= 4;
    for (const [b, r] of [[sDuplicar, "Duplicar"], [sOpcoes, "Opções"], [sCantoMais, "Acrescentar canto"], [sCantoMenos, "Apagar canto"], [sApagar, "Apagar"]]) {
      b.setAttribute("aria-label", nome ? `${r}: ${nome}` : r);
      b.title = b.getAttribute("aria-label");
    }
  }
  sDuplicar.addEventListener("click", duplicarSelecionado);
  sApagar.addEventListener("click", apagarSelecionado);
  // Canto novo a meio da parede mais comprida da divisão selecionada (arrasta-se depois, para um L ou uma parede inclinada).
  sCantoMais.addEventListener("click", () => {
    const d = obterDivisao(selecionado);
    if (!d || !podeDivisoes) return;
    const pts = pontosDivisao(d);
    let i = 0, maior = -1;
    pts.forEach(([x, y], k) => { const [x2, y2] = pts[(k + 1) % pts.length]; const c = Math.hypot(x2 - x, y2 - y); if (c > maior) { maior = c; i = k; } });
    const [x, y] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    acrescentarCanto(d, i, { x: (x + x2) / 2, y: (y + y2) / 2 });
  });
  // Apaga o canto que menos muda a forma da divisão selecionada (só com mais de quatro).
  sCantoMenos.addEventListener("click", () => {
    const d = obterDivisao(selecionado);
    if (!d || !podeDivisoes) return;
    const pts = pontosDivisao(d);
    const a0 = areaPoligono(pts);
    let i = -1, menor = Infinity;
    pts.forEach((_, k) => {
      const resto = pts.filter((__, j) => j !== k).map(([x, y]) => [x, y]);
      const dif = Math.abs(a0 - areaPoligono(resto));
      if (dif < menor && validarPontos(resto, planta.largura_cm, planta.altura_cm)) { menor = dif; i = k; }
    });
    if (i < 0) avisar("Não dá para apagar nenhum canto: mova-os primeiro."); else apagarCanto(d, i);
  });
  // "Opções" abre a janela de edição (a mesma do duplo clique): tudo o que se muda na divisão ou no elemento.
  sOpcoes.addEventListener("click", () => abrirDialogo());
  // Lote 8: "Planta de fundo" mostra o cartão do fundo (no "⋯"); sem fundo, abre logo a escolha do ficheiro.
  bFundo.addEventListener("click", () => {
    fundoSec.open = true;
    mostrarLado(true);
    (planta?.fundo ? fundoResumo : ficheiro).focus({ preventScroll: true });
    if (!planta?.fundo) ficheiro.click();
  });

  /** Nome da cópia de uma divisão: o seguinte do mesmo tipo ("Quarto 3" → "Quarto 4"), senão "Nome 2"… */
  function nomeCopia(nome) {
    const base = String(nome || "Divisão").replace(/\s+\d+$/, "");
    if (tipoDivisao(base) && base !== "Outra") return nomeNovaDivisao(base);
    const usados = new Set(planta.divisoes.map((x) => x.nome));
    for (let n = 2; ; n++) if (!usados.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  /**
   * Duplicar: a divisão com os seus aparelhos vai para um sítio livre do mesmo piso (sitioLivre); um elemento
   * fica ao lado (50 cm à direita, ou à esquerda junto à borda). A cópia fica selecionada; um só passo de anular.
   */
  function duplicarSelecionado() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if (d && !podeDivisoes) { divisaoPresa(); return; }
    if (d) {
      if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return; }
      const [x, y] = sitioLivre(d.largura_cm, d.altura_cm, { piso: pisoDe(d) });
      const dx = x - d.x_cm, dy = y - d.y_cm;
      memorizar();
      const nova = { ...structuredClone(d), id: novoId("d", planta.divisoes), nome: nomeCopia(d.nome), x_cm: x, y_cm: y };
      // As cópias dos interruptores e das tomadas ficam por responder no inventário das Divisões (`confirmado` não se copia).
      const semResposta = ({ confirmado, ...a }) => a;
      if (nova.pontos) nova.pontos = nova.pontos.map(([px, py]) => [px + dx, py + dy]);
      crescerFolha(x + d.largura_cm, y + d.altura_cm);
      planta.divisoes.push(nova);
      let n = 0;
      for (const a of planta.elementos.filter((q) => q.divisao === d.id)) {
        if (planta.elementos.length >= MAX_ELEMENTOS) break;
        planta.elementos.push({ ...semResposta(structuredClone(a)), id: novoId("e", planta.elementos), x_cm: a.x_cm + dx, y_cm: a.y_cm + dy, divisao: nova.id });
        n++;
      }
      ajustarFolha();
      selecionado = nova.id;
      destaque = { id: nova.id, desde: performance.now() };
      setTimeout(() => { if (destaque?.id === nova.id) { destaque = null; desenhar(); } }, DESTAQUE_MS);
      confirmar(`Divisão "${d.nome}" duplicada: "${nova.nome}"${n ? ` com ${n} ${n === 1 ? "aparelho" : "aparelhos"}` : ""}. Arraste-a para o sítio certo.`);
      mostrarPlanta();
      return;
    }
    if (!e) return;
    if (planta.elementos.length >= MAX_ELEMENTOS) { avisar(`A planta já tem o máximo de ${MAX_ELEMENTOS} elementos.`); return; }
    memorizar();
    const dx = e.x_cm + 50 <= planta.largura_cm ? 50 : -50;
    const c = { ...structuredClone(e), id: novoId("e", planta.elementos), x_cm: limitar(e.x_cm + dx, 0, planta.largura_cm) };
    delete c.confirmado;   // a cópia fica por responder no inventário das Divisões
    planta.elementos.push(c);   // fica na divisão do original enquanto lá couber (confirmar: atualizarDivisoes manter)
    selecionado = c.id;
    confirmar(`Duplicado: ${descreverElemento(c)} (ao lado).`);
  }

  function descreverElemento(e) {
    const t = descreverTipo(e);
    return e.nome ? `${e.nome} (${t})` : t;
  }
  function descreverTipo(e) {
    const p = e.props;
    if (e.tipo === "porta") return p.entrada ? "Porta da rua" : "Porta";
    if (e.tipo === "janela") return p.estore ? (p.motorizado ? "Janela com estore motorizado" : "Janela com estore") : "Janela";
    if (e.tipo === "tomada") return `Tomada${caixasDe(p) === 3 ? " tripla" : caixasDe(p) === 2 ? " dupla" : ""}${p.inteligente ? " inteligente" : ""}`;
    if (e.tipo === "interruptor") return `Interruptor de ${p.botoes} ${p.botoes === 1 ? "botão" : "botões"}${comandoDe(p) !== "simples" ? ` (${COMANDOS[comandoDe(p)].nome.toLowerCase()})` : ""}`;
    if (e.tipo === "maquina") return MODELOS[p.modelo]?.nome ?? "Máquina";
    return ELEMENTOS[e.tipo].nome;
  }

  // ---------------------------------------------------------------- janela de edição
  // Simples, para o cliente. Edita um rascunho: nada muda na planta até "Guardar" (um só passo de anular).
  // Divisão: nome, largura × comprimento e piso (nas casas com pisos); elemento: a escolha do seu tipo.
  // Os dois com Apagar. Os cantos oblíquos mudam-se arrastando-os na planta.
  let rascunho = null;

  function abrirDialogo() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    if ((!d && !e) || dialogo.open) return;
    if (d && !podeDivisoes) { divisaoPresa(); return; }
    aoFecharDialogo();   // a anterior (fechada há instantes, ex. com Esc) arruma-se antes de abrir esta
    pararToqueLongo();
    arrasto = null;
    // A janela fica por cima da planta: o "pointerup" do dedo que a abriu já não chega lá.
    ponteiros.clear();
    pinca = null;
    ultimoToque = null;
    rascunho = d
      ? { id: d.id, tipo: "divisao", nome: d.nome, piso: pisoDe(d), largura: d.largura_cm, altura: d.altura_cm }
      : { id: e.id, tipo: "elemento", el: e.tipo, props: { ...e.props } };
    dlgTitulo.textContent = d ? `Divisão: ${d.nome || "sem nome"}` : descreverElemento(e);
    dApagar.textContent = d ? "Apagar divisão" : "Apagar";
    dlgErro.hidden = true;
    dlgCorpo.replaceChildren();
    dGuardar.hidden = false;
    if (d) corpoDivisao(d); else corpoElemento(e);
    dialogo.showModal();
    dialogoAtivo = true;
    (dlgCorpo.querySelector("input, select") ?? (dGuardar.hidden ? dCancelar : dGuardar)).focus();
  }

  function erroDialogo(texto, foco) {
    dlgErro.textContent = texto;
    dlgErro.hidden = false;
    (foco ?? dlgErro).focus?.();
  }

  /** Cantos de `d` com a caixa esticada para `largura` × `altura` (cm), a partir do canto de cima à esquerda. */
  function cantosComMedidas(d, largura, altura) {
    const c = caixaDe(d);
    const sx = largura / (c.largura_cm || 1), sy = altura / (c.altura_cm || 1);
    return pontosDivisao(d).map(([x, y]) => [Math.round(c.x_cm + (x - c.x_cm) * sx), Math.round(c.y_cm + (y - c.y_cm) * sy)]);
  }

  function corpoDivisao(d) {
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
    // Largura × comprimento (ao cm; a grelha de 50 cm é só para arrastar). Numa forma livre esticam a forma toda.
    const area = el("p", "ajuda");
    area.id = "dlg-area";
    area.setAttribute("aria-live", "polite");
    const desenharArea = () => {
      const ok = r.largura > 0 && r.altura > 0;
      const a = ok ? m2(areaPoligono(cantosComMedidas(d, r.largura, r.altura))) : "—";
      area.textContent = d.pontos ? `Forma livre: ${a} m². As medidas esticam a forma toda; os cantos mudam-se arrastando-os na planta.` : `Área: ${a} m²`;
    };
    const medida = (k, id) => {
      const i = numeroInput(r[k] / 100, { min: 0.5, max: MAX_LADO_CM / 100, step: 0.01, id });
      i.addEventListener("input", () => { const v = lerNumero(i.value); r[k] = Number.isFinite(v) ? Math.round(v * 100) : NaN; desenharArea(); });
      return i;
    };
    const duas = el("div", "duas");
    duas.append(campo("Largura (m)", medida("largura", "dlg-largura")), campo("Comprimento (m)", medida("altura", "dlg-altura")));
    desenharArea();
    dlgCorpo.append(campo("Nome", nome), dl, duas, area);
    // Piso (nas casas com pisos): mudar leva a divisão e tudo o que está dentro dela para esse piso.
    if (nPisos() > 1 || pisosPedidos > 1) {
      const s = document.createElement("select");
      s.id = "dlg-piso";
      for (let p = 0; p < Math.max(nPisos(), pisosPedidos); p++) { const o = document.createElement("option"); o.value = String(p); o.textContent = nomePiso(p); s.append(o); }
      s.value = String(r.piso);
      s.addEventListener("change", () => { r.piso = Number(s.value); });
      dlgCorpo.append(campo("Piso", s, "A divisão muda de piso com tudo o que está dentro dela."));
    }
  }

  /** Janela do elemento: a escolha do seu tipo (camposElemento). `e`: o elemento na planta. */
  function corpoElemento(e) {
    const r = rascunho;
    const campos = camposElemento(r.el, r.props, (f) => (v) => {
      f(v);
      // Sem estore, "É motorizado?" fica desligado.
      const m = document.getElementById("dlg-motorizado");
      if (m) { m.disabled = !r.props.estore; m.checked = !!r.props.motorizado; }
    }, "dlg");
    if (campos.length) dlgCorpo.append(...campos);
    else dlgCorpo.append(el("p", "ajuda", "Nada a escolher. Pode apagar este aparelho."));
    // Sem nada a escolher (ponto de luz, sensores, quadro) a janela fica só com Apagar e Cancelar.
    dGuardar.hidden = !campos.length;
  }

  function guardarDialogo() {
    const r = rascunho;
    if (!r) return;
    if (r.tipo === "divisao") {
      const d = obterDivisao(r.id);
      if (!d) { dialogo.close(); return; }
      for (const [k, id, nome] of [["largura", "dlg-largura", "largura"], ["altura", "dlg-altura", "comprimento"]]) {
        if (!(r[k] >= ESCALA_CM && r[k] <= MAX_LADO_CM)) { erroDialogo(`Escreva ${nome === "largura" ? "a largura" : "o comprimento"} em metros, de 0,5 a ${metros(MAX_LADO_CM)} (ex.: 3,5).`, document.getElementById(id)); return; }
      }
      const v = validarPontos(cantosComMedidas(d, r.largura, r.altura), MAX_LADO_CM, MAX_LADO_CM);
      if (!v) { erroDialogo("Com estas medidas a divisão fica fora da planta ou pequena demais: experimente outras.", document.getElementById("dlg-largura")); return; }
      const outroPiso = r.piso !== pisoDe(d);
      memorizar();
      d.nome = String(r.nome ?? "").trim().slice(0, 60) || "Divisão";
      const cx = caixaPontos(v);
      crescerFolha(cx.x_cm + cx.largura_cm, cx.y_cm + cx.altura_cm);   // maior do que a folha: a folha cresce
      const c0 = caixaDe(d), dentroAntes = elementosDentro(d);
      definirPontos(d, v);
      acompanhar(d, c0, dentroAntes);
      // Os elementos de dentro acompanham a divisão; mudar de piso leva-os também, para um sítio livre desse
      // piso (o mesmo, se lá estiver livre): nunca fica por cima de outra divisão (e não lhe tira os aparelhos).
      const dentro = planta.elementos.filter((x) => x.divisao === d.id);
      if (outroPiso) {
        const [nx, ny] = sitioLivre(d.largura_cm, d.altura_cm, { piso: r.piso, preferir: [d.x_cm, d.y_cm] });
        crescerFolha(nx + d.largura_cm, ny + d.altura_cm);
        deslocarDivisao(d, nx - d.x_cm, ny - d.y_cm, dentro);
        d.piso = r.piso;
        for (const x of dentro) x.piso = r.piso;
      }
      rascunho = null;
      dialogo.close();
      if (outroPiso) { mudarPiso(d.piso, { anunciar: false }); selecionado = d.id; }
      confirmar(`Divisão "${d.nome}" guardada (${m2(areaPoligono(v))} m²)${outroPiso ? `, agora no ${nomePiso(d.piso)}${dentro.length ? ` com os seus ${dentro.length} aparelhos` : ""}` : ""}.`);
      return;
    }
    const e = obterElemento(r.id);
    if (!e) { dialogo.close(); return; }
    memorizar();
    e.props = { ...r.props };
    delete e.por_responder;   // o cliente respondeu (passo 4: "Falta responder" sai); a rotação fica a que era
    rascunho = null;
    dialogo.close();
    confirmar(`Guardado: ${descreverElemento(e)}.`);
  }

  dlgForm.addEventListener("submit", (ev) => { ev.preventDefault(); guardarDialogo(); if (!dialogo.open) aoFecharDialogo(); });
  dCancelar.addEventListener("click", () => { dialogo.close(); aoFecharDialogo(); });
  dApagar.addEventListener("click", () => {
    const id = rascunho?.id;
    dialogo.close();
    if (id && existe(id)) { selecionado = id; apagarSelecionado(); }
    aoFecharDialogo();
  });
  // Fechar (Guardar, Cancelar, Apagar ou Esc): o foco volta à planta — ou, aberta de fora (passo "Divisões",
  // abrirOpcoes), a janela volta para o editor e quem a abriu decide para onde vai o foco. Feito logo ao fechar
  // (não à espera do evento "close", que chega depois): um "close" atrasado de uma janela já reaberta (abrir → fechar →
  // abrir outro aparelho depressa) não pode apagar o rascunho nem tirar a janela do sítio (ignora-se: dialogo.open).
  let fechoExterno = null;
  let dialogoAtivo = false;   // aberta e ainda por arrumar (aoFecharDialogo)
  dialogo.addEventListener("close", () => { if (!dialogo.open) aoFecharDialogo(); });
  function aoFecharDialogo() {
    if (!dialogoAtivo) return;
    dialogoAtivo = false;
    rascunho = null;
    if (fechoExterno) {
      const f = fechoExterno;
      fechoExterno = null;
      if (dialogo.parentElement !== raiz) raiz.append(dialogo);
      f();
      return;
    }
    svg.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- desenho
  function desenhar() {
    if (!planta) return;
    const { ppc, raio, raioToque, letra, pega } = tamanhos();
    // Lote 8: sem aparelhos (passo "A casa") desenha-se só as divisões; divisões presas sem as pegas dos cantos.
    // A planta que se vê: as peças do passo e, com uma ferramenta escolhida, a peça a acompanhar o rato (não está na
    // planta: só passa a estar quando o clique a larga).
    const ID_FANTASMA = "_a_por";
    const aPor = fantasma && modo?.tipo === "elemento"
      ? { id: ID_FANTASMA, tipo: modo.el, x_cm: fantasma.x, y_cm: fantasma.y, rot: 0, piso: pisoAtual, divisao: null, props: propsOmissao(modo.el, modo.modelo) } : null;
    const aVista = !podeAparelhos ? [] : [...(soElementos ? planta.elementos.filter(pecaDoPasso) : planta.elementos), ...(aPor ? [aPor] : [])];
    desenharPlanta(svg, podeAparelhos && !soElementos && !aPor ? planta : { ...planta, elementos: aVista }, { selecionado: aPor ? ID_FANTASMA : selecionado, vista: caixaVista(), raio, raioToque, letra, pega, piso: pisoAtual, pegas: podeDivisoes, acoes: acoesOmissao ? { omissao: acoesOmissao, ...acoesOpcoes } : null });
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
    const nD = divisoesPiso().length, nE = elementosPiso().length;
    svg.setAttribute("aria-label", `Planta da casa${nPisos() > 1 ? `, ${nomePiso(pisoAtual)}` : ""}: ${nD} ${nD === 1 ? "divisão" : "divisões"}, ${nE} ${nE === 1 ? "elemento" : "elementos"}${selecionado ? `. Selecionado: ${obterDivisao(selecionado)?.nome ?? descreverElemento(obterElemento(selecionado) ?? { tipo: "luz", props: {} })}` : ""}`);
    bDesfazer.disabled = !desfazer.length;
    bRefazer.disabled = !refazer.length;
    rovingAcoes();
    rovingLado();
  }

  // O cartão do fundo é refeito a cada mudança: o foco volta ao mesmo controlo (pelo id, ou pelo texto do
  // rótulo/botão) para quem usa o teclado não o perder.
  function chaveFoco(a) {
    if (!a || !lado.contains(a)) return null;
    if (a.id) return { id: a.id };
    return { texto: (a.closest("label") ?? a).textContent, tag: a.tagName };
  }
  function reporFoco(k) {
    if (!k) return;
    let alvo = k.id ? document.getElementById(k.id) : null;
    if (!alvo && k.texto != null) alvo = [...lado.querySelectorAll(k.tag)].find((x) => (x.closest("label") ?? x).textContent === k.texto) ?? null;
    if (alvo && !alvo.disabled) alvo.focus({ preventScroll: true });
  }

  function desenharTudo() {
    const foco = chaveFoco(document.activeElement);
    queueMicrotask(seguirBotao);   // a janela do fundo pode ter mudado de tamanho
    desenharSeparadores();
    desenhar();
    desenharSelecao();
    desenharFundo();
    rovingAcoes();
    rovingLado();
    acertarBarra();   // os botões das divisões seguem a planta (as divisões deste piso)
    reporFoco(foco);
  }

  // O tamanho da planta no ecrã mudou (o passo apareceu, rodou o telemóvel…): se a vista foi ajustada
  // sozinha e o cliente ainda não lhe mexeu, volta a ajustá-la ao conteúdo.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (ajusteAuto && planta) verTudo();
      else if (focoAuto && planta && obterDivisao(focoAuto)) verDivisao(obterDivisao(focoAuto));
      desenhar();
    }).observe(area);
  }

  return {
    /** Mudou o passo: sai a mensagem que ficou na planta ("Anulado.", "Divisão … criada…"); a de uma ferramenta ativa fica. */
    limparAviso() { if (!modo) dica.textContent = ""; },
    /** Abre (ou reabre) a planta no editor. */
    abrir(p, { reiniciarVista = true } = {}) {
      const nova = planta !== p;
      planta = p;
      if (nova) { desfazer = []; refazer = []; selecionado = null; calibracao = null; ultimoToque = null; lerAspeto(); pisoAtual = 0; }
      if (nova) { seguir = null; svg.classList.remove("a-seguir"); }   // outra planta: os ids já não são os mesmos
      if (pisoAtual >= nPisos()) pisoAtual = 0;
      if (nova) ajustarFolha();   // plantas antigas com quadrícula vazia à volta ficam à medida
      if (reiniciarVista || nova) verTudo();
      nDivisoesVista = divisoesPiso().length;
      definirModo(null);
      if (nova) fila.scrollLeft = 0;   // planta nova (ex. "Refazer planta"): a linha das ferramentas volta ao início
      desenharTudo();
    },
    redesenhar: () => desenharTudo(),
    /** O botão "Ajustar" sem mensagem nem anular: a folha volta ao tamanho das divisões e a vista mostra-as todas. */
    ajustar() {
      if (!planta) return;
      delete planta.tamanho_fixo;
      ajustarFolha();
      verTudo();
      desenharTudo();
    },
    /** Ronda A: ajusta e centra a vista na planta (o "Ver tudo"): ao abrir uma planta guardada, ao mudar de passo… */
    verTudo() {
      if (!planta) return;
      verTudo();
      desenhar();
    },
    /**
     * Ronda A ("Carregar a planta" no Início): usa `r` = fundo.js lerFundo() como planta de fundo, como o "Planta de
     * fundo" do "⋯" (encaixada na planta, que fica com a proporção da imagem).
     */
    usarFundo(r) {
      if (!planta || !r?.imagem) return;
      memorizar();
      aspetoFundo = r.altura / r.largura;
      encaixarFundo(r.imagem, aspetoFundo);
      verTudo();
      confirmar("Planta carregada. Ponha as divisões por cima dela.");
    },
    /**
     * Lote 7: ação por omissão do serviço ("novo" ou "manter"): os aparelhos com outra ação levam a marca (M, R, S, N)
     * na planta, com a legenda no "⋯" e na impressão. null = sem marcas.
     */
    definirAcoes(omissao, { todas = false, escolher = false, nomes = null } = {}) {
      if (omissao === acoesOmissao && todas === !!acoesOpcoes.todas && escolher === !!acoesOpcoes.escolher) return;
      acoesOmissao = omissao ?? null;
      acoesOpcoes = todas ? { todas: true, escolher, nomes } : { nomes };
      legendaAcao.hidden = !acoesOmissao || !todas;   // lote 8: só em "Trocar e reparar" (e na impressão/PDF)
      legendaAcao.textContent = acoesOmissao ? legendaAcoes(acoesOmissao, todas, nomes) : "";
      if (planta) desenhar();
    },
    /**
     * Lote 8: o que o passo deixa mudar na planta. `divisoes` false: as divisões selecionam-se mas não se movem, não
     * mudam de forma nem de tamanho, não se apagam nem duplicam, e as ferramentas das divisões escondem-se. `aparelhos`
     * false: os aparelhos ficam escondidos (não apagados) e as ferramentas deles também. Mudar as permissões esquece o
     * anular/refazer (cada passo só anula o que ele próprio deixa fazer).
     */
    definirPermissoes({ divisoes = true, aparelhos = true, duplo = true, maquinas = true, elementos = null } = {}) {
      podeDuplo = duplo;
      if (String(elementos) !== String(soElementos)) {
        soElementos = Array.isArray(elementos) ? elementos : null;
        if (soElementos && modo?.tipo === "elemento" && !soElementos.includes(modo.el)) definirModo(null);
        if (soElementos && planta && obterElemento(selecionado) && !pecaDoPasso(obterElemento(selecionado))) selecionado = null;
        acertarBarra();
        if (planta) desenharTudo();
      }
      // `maquinas` false (passo "Equipamentos", decisão do dono 2026-10-10): as máquinas marcam-se nos cartões do passo
      // e saem da linha; ficam porta, janela, quadro, tomada, ponto de luz, interruptor e sensores. As que já estão na
      // planta continuam lá e mexem-se.
      if (maquinas !== podeMaquinas) {
        podeMaquinas = maquinas;
        if (!podeMaquinas && modo?.tipo === "elemento" && modo.el === "maquina") definirModo(null);
        acertarBarra();
      }
      if (divisoes === podeDivisoes && aparelhos === podeAparelhos) return;
      const voltarAoInicio = divisoes && !podeDivisoes;   // QA N2: o grupo das divisões reaparece à esquerda
      podeDivisoes = divisoes;
      podeAparelhos = aparelhos;
      desfazer = []; refazer = [];
      if (!podeAparelhos && planta && obterElemento(selecionado)) selecionado = null;
      if (modo?.tipo === "elemento" && !podeAparelhos) definirModo(null);
      for (const b of barraDiv.children) {
        const t = tiposDivisao.find((x) => x.nome === b.dataset.divisao);
        if (t) b.setAttribute("aria-label", rotuloDivisao(t));
      }
      acertarBarra();
      // Depois de o grupo aparecer (layout feito): com scroll-snap o Chrome voltava a encostar ao botão onde estava
      // (os elementos, agora a 582 px); a linha volta ao início para as divisões se verem.
      if (voltarAoInicio) { void fila.scrollWidth; fila.scrollLeft = 0; }
      if (planta) desenharTudo();
    },
    /**
     * Lote 8: o tamanho da planta na `caixa` (a linha do título "A sua planta"): os botões "2×" e "½×" (decisão do dono;
     * o "Ajustar" está na barra das ações) e o aviso curto.
     */
    montarTamanho(caixa) {
      caixa.replaceChildren(tamDobro, tamMetade, tamMsg);
      bOutras.setAttribute("aria-label", "Mais ações da planta: imprimir, PDF e planta de fundo");
      bOutras.title = bOutras.getAttribute("aria-label");
    },
    /** N.º de pisos da casa (1 = sem separadores, salvo se a planta já tiver coisas noutros pisos). */
    definirPisos(n) {
      pisosPedidos = Math.min(MAX_PISO + 1, Math.max(1, Math.round(Number(n)) || 1));
      if (planta && pisoAtual >= nPisos()) pisoAtual = 0;
      desenharSeparadores();
    },
    /** Piso visível (0 = r/c). */
    get piso() { return pisoAtual; },
    mudarPiso: (p, o) => mudarPiso(p, o),
    /**
     * Tipos de divisão do tipo de imóvel (regras.js tiposDivisaoPara): na linha só os que a casa tem (as divisões da
     * planta neste piso e `casa`, os nomes das divisões de "A casa tem…"); todos na janela "Outra divisão".
     */
    definirTiposDivisao(lista, casa = []) {
      divisoesCasa = Array.isArray(casa) ? casa : [];
      if (lista === tiposDivisao) { acertarBarra(); return; }
      tiposDivisao = lista;
      desenharBotoesDivisao();
    },
    /**
     * Máquinas: um botão por modelo (chaves de regras.js MODELOS), pela ordem dada, todos na linha. `janela`: os
     * modelos da lista "Qual é?" da janela da máquina (os do perfil do imóvel; sem ela, todos).
     */
    definirMaquinas(lista, janela = null) {
      modelosJanela = Array.isArray(janela) ? janela : null;
      const l = [...new Set(lista)].filter((m) => MODELOS[m]);
      if (l.join() === modelosMaq.join()) { acertarBarra(); return; }
      modelosMaq = l;
      if (modo?.el === "maquina" && !l.includes(modo.modelo)) definirModo(null);
      desenharBotoesMaquina();
    },
    /**
     * "Começar de novo": esquece a planta e tudo o que o editor guarda em memória (anular/refazer, fundo e
     * calibração, seleção, separador de piso, vista, ecrã inteiro, ferramenta escolhida).
     */
    limpar() {
      fechoExterno = null;
      if (dialogo.open) dialogo.close();
      if (janelaDiv.open) janelaDiv.close();
      dialogoAtivo = false;
      rascunho = null;
      acertarBarra();
      if (dialogo.parentElement !== raiz) raiz.append(dialogo);
      if (emEcraInteiro()) sairEcra();
      pararToqueLongo();
      planta = null;
      desfazer = []; refazer = [];
      selecionado = null; calibracao = null; aspetoFundo = null; destaque = null; rascunho = null;
      arrasto = null; pinca = null; ponteiros.clear(); ultimoToque = null;
      pisoAtual = 0; pisosPedidos = 1; nDivisoesVista = 0; ajusteAuto = false; focoAuto = null;
      vista = { cx: 1000, cy: 750, w: 2100 };
      definirModo(null);
      mostrarFundoMsg("", "info");
      ficheiro.value = "";
      fundoSec.open = false;
      mostrarLado(false);
      fecharMenu(false);
      separadores.hidden = true;
      separadores.replaceChildren();
      svg.replaceChildren();
    },
    get planta() { return planta; },
    /**
     * Passo "Divisões" (lote 5): abre a janela simples de um elemento (ou divisão) com a planta fora do ecrã. A
     * janela vai para dentro de `anfitriao` (o passo à vista: dentro de um passo escondido não aparece) e volta
     * para o editor ao fechar; `aoFechar` põe o foco onde deve ficar.
     */
    abrirOpcoes(id, { anfitriao = null, aoFechar = null } = {}) {
      if (!planta || !existe(id) || dialogo.open) return false;
      aoFecharDialogo();   // uma janela fechada há instantes (Esc) ainda por arrumar: arruma-se já (o seu fecho, não o novo)
      const x = obterElemento(id) ?? obterDivisao(id);
      if (pisoDe(x) !== pisoAtual && pisoDe(x) < nPisos()) pisoAtual = pisoDe(x);
      selecionado = id;
      desenharTudo();
      if (anfitriao) anfitriao.append(dialogo);
      fechoExterno = aoFechar ?? (() => {});
      abrirDialogo();
      return true;
    },
    /**
     * Os aparelhos da linha das ferramentas (a mesma lista e pela mesma ordem: elementos e depois as máquinas de
     * definirMaquinas): [{chave, tipo, modelo, nome, props}] — para a grelha "Acrescentar outro aparelho" dos passos.
     */
    aparelhos() {
      return [
        ...TIPOS_ELEMENTO.filter((t) => t !== "maquina").map((t) => ({ chave: t, tipo: t, modelo: null, nome: ELEMENTOS[t].nome, props: ELEMENTOS[t].props })),
        ...modelosMaq.map((m) => ({ chave: `maquina:${m}`, tipo: "maquina", modelo: m, nome: MODELOS[m].nome, props: { modelo: m } })),
      ];
    },
    /**
     * Passo "Divisões" ("+" do inventário; decisão do dono, 2026-10-03): põe logo um aparelho `tipo` num sítio livre da
     * divisão `divisao` (casa.js lugarLivre), sem escolher ferramenta nem abrir a planta (um passo de anular). Devolve
     * o id dele, ou null (divisão que não existe; planta cheia).
     */
    por(tipo, divisao) {
      const d = planta ? obterDivisao(divisao) : null;
      if (!d || !ELEMENTOS[tipo]) return null;
      if (pisoDe(d) !== pisoAtual) mudarPiso(pisoDe(d), { anunciar: false });
      definirModo(null);
      selecionado = d.id;   // numa zona sobreposta o aparelho fica nesta divisão (adicionarElemento: selecionadaEm)
      const [x, y] = d.pontos ? pontoInterior(d.pontos) : lugarLivre(d, planta.elementos.filter(noPiso), divisoesPiso());
      return adicionarElemento(tipo, x, y)?.id ?? null;
    },
    /** Passo "Divisões" ("−"): apaga um elemento (um passo de anular, como o botão Apagar). */
    apagar(id) {
      if (!planta || !existe(id)) return false;
      selecionado = id;
      apagarSelecionado();
      return true;
    },
    /**
     * Passo "Divisões" ("+"): mostra o piso da divisão, seleciona-a e escolhe a ferramenta do aparelho (`tipo`,
     * `modelo` nas máquinas; sem `tipo` nenhuma), com `texto` na dica ("Toque na planta onde fica a nova tomada").
     */
    prepararColocar({ divisao = null, tipo = null, modelo = null, texto = null, porJa = false } = {}) {
      if (!planta) return;
      const d = obterDivisao(divisao);
      if (d && pisoDe(d) !== pisoAtual) mudarPiso(pisoDe(d), { anunciar: false });
      selecionado = d ? d.id : null;
      const m = tipo && ELEMENTOS[tipo] ? { tipo: "elemento", el: tipo, modelo: tipo === "maquina" ? modelo : null } : null;
      if (m && porJa) {
        // Teclado: como Enter numa ferramenta, põe-no logo no meio da divisão (fica selecionado: as setas movem-no).
        const c = centroColocacao();
        definirModo(null);
        adicionarElemento(m.el, c.x, c.y, m.modelo);
      } else {
        definirModo(m);
        desenharTudo();
      }
      if (texto) avisar(texto);
      mostrarPlanta();
      if (m && porJa) svg.focus({ preventScroll: true });
    },
    /**
     * Passo "Divisões" (tocar num cartão): seleciona a divisão `id` na planta (no piso dela), sem mexer no foco.
     * Sem `id` (ou uma divisão que não existe) tira a seleção.
     */
    selecionar(id) {
      if (!planta) return;
      const d = obterDivisao(id);
      if (d && pisoDe(d) !== pisoAtual) mudarPiso(pisoDe(d), { anunciar: false });
      selecionado = d ? d.id : null;
      desenhar();
      desenharSelecao();
    },
    /**
     * Passos com separadores por divisão ("Divisões" e "Trocar e reparar"; decisão do dono, 2026-10-03): mostra o piso
     * da divisão `id`, seleciona-a e centra a vista nela, aproximada até caber com margem (verDivisao) — sempre, mesmo
     * que o cliente tenha mexido na vista. Devolve false se a divisão não existir.
     */
    focarDivisao(id) {
      const d = planta ? obterDivisao(id) : null;
      if (!d) return false;
      if (pisoDe(d) !== pisoAtual) mudarPiso(pisoDe(d), { anunciar: false });
      selecionado = d.id;
      verDivisao(d);
      desenhar();
      desenharSelecao();
      return true;
    },
    /**
     * Localiza um aparelho (decisão do dono, 2026-10-05: tocar em "Tomada 1" na lista das Divisões): mostra o piso
     * dele, seleciona-o (aro a piscar) e, se estiver fora do que se vê, desloca a vista para o centrar, sem mudar a
     * ampliação. Devolve false se não existir.
     */
    /**
     * Passo "Equipamentos": o aparelho `id` passa a seguir o rato sobre a planta até um clique o largar (`aoLargar(id)`).
     * Sem `id` (ou um que não existe) deixa de seguir, e o aparelho volta ao sítio onde estava.
     */
    /** Há um aparelho a acompanhar o rato neste momento (a posição dele ainda não é a final)? */
    get aSeguir() { return !!seguir?.mexeu; },
    seguirElemento(id, { aoLargar = null } = {}) {
      if (seguir && seguir.id === id) { seguir.aoLargar = aoLargar; return true; }
      pararSeguir();
      const e = planta && id ? obterElemento(id) : null;
      if (!e) return false;
      seguir = { id: e.id, x0: e.x_cm, y0: e.y_cm, mexeu: false, aoLargar };
      svg.classList.add("a-seguir");
      return true;
    },
    focarElemento(id) {
      const e = planta ? obterElemento(id) : null;
      if (!e) return false;
      const d = e.divisao ? obterDivisao(e.divisao) : null;
      if (d && pisoDe(d) !== pisoAtual) mudarPiso(pisoDe(d), { anunciar: false });
      selecionado = e.id;
      const c = caixaVista();
      const mx = c.w * 0.12, my = c.h * 0.12;
      if (e.x_cm < c.x + mx || e.x_cm > c.x + c.w - mx || e.y_cm < c.y + my || e.y_cm > c.y + c.h - my) {
        vista = { ...vista, cx: e.x_cm, cy: e.y_cm };
        ajusteAuto = false;
      }
      desenhar();
      desenharSelecao();
      return true;
    },
    /** Só para testes/depuração: estado da vista. */
    get vista() { return { ...vista }; },
  };
}
