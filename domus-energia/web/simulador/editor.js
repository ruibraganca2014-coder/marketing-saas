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
  pontoEmPoligono, distanciaPoligono, TIPOS_PAREDE, TOLERANCIA_PORTA_CM, temPergunta,
} from "./regras.js";
import { lerFundo, ErroFundo } from "./fundo.js";
import { aparelhosOmissao, resumoAparelhos, tipoDivisao as tipoDoNome } from "./casa.js";
import { imprimirPlanta, guardarPdf } from "./imprimir.js";

const HISTORICO_MAX = 100;
const TOQUE_PX = 6;          // abaixo disto um arrasto é um toque
const PASSO_ELEMENTO = 10;   // cm (setas); Shift = × 5
const PASSO_DIVISAO = ESCALA_CM;
const TOQUE_LONGO_MS = 500;  // toque longo (sem mexer) = duplo clique
const PAREDE_PX = { mouse: 10, toque: 18 };   // tolerância para acertar numa parede (duplo clique / toque longo)
const MARGEM_VISTA = 1.08;   // "Ver tudo": o conteúdo ocupa ~93 % da vista
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
  esquentador: "Esquentador", radiador: "Radiador", cafe_expresso: "Café expresso", campainha_video: "Campainha vídeo",
  carregador_bicicleta: "Carreg. bicicleta", toalheiro: "Aquec. toalhas", hidromassagem: "Hidro­massagem",
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
 */
export function criarEditor(raiz, { aoMudar, anunciar = null, aoSelecionar = null }) {
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

  // Ferramentas numa só linha compacta por cima da planta (decisão do dono), que desliza para o lado: só as
  // divisões da casa (as do passo 1: definirTiposDivisao), os 4 elementos base e as máquinas escolhidas no passo 2
  // (definirMaquinas), em 3 grupos separados por um traço discreto, e no fim "Mais…" — a janela com a lista
  // completa (divisões, elementos, máquinas). Uma ferramenta escolhida na janela (ou pelo "+" do passo Divisões)
  // passa a aparecer na linha enquanto o editor estiver aberto (`naBarraExtra`; "Começar de novo" esquece-as).
  // Os botões de tudo existem na linha; os que não são para lá estão escondidos (`hidden`).
  const fila = el("div", "editor-ferramentas");
  fila.setAttribute("role", "toolbar");
  fila.setAttribute("aria-label", "Ferramentas da planta");
  const ferramentas = {};
  const naBarraExtra = new Set();   // chaves ("divisao:Garagem", "janela", "maquina:forno") que o cliente trouxe
  let divisoesNaBarra = null;       // nomes dos botões de divisão da linha (null = todos)
  let maquinasNaBarra = [];         // modelos das máquinas da linha
  /** Elementos da linha; os outros (janela, quadro, sensores) estão em "Mais…". */
  const ELEMENTOS_BASE = ["porta", "interruptor", "luz", "tomada"];
  const grupoBarra = (cls, rotulo) => { const g = el("div", `editor-barra ${cls}`); g.setAttribute("role", "group"); g.setAttribute("aria-label", rotulo); return g; };
  // 1. Um botão por tipo de divisão, com o seu desenho (planta-svg.js divisao_<tipo>): cria-a logo, com o nome
  // certo (Quarto, Quarto 2, Sala…); o que traz (casa.js resumoAparelhos) fica no nome acessível do botão.
  const barraDiv = grupoBarra("editor-divisoes", "Acrescentar divisão");
  const divisoesMais = el("div", "editor-mais-grelha");
  function botaoDivisao(t) {
    const traz = resumoAparelhos(t.nome, t.w, t.h);
    const b = botao("", "ferramenta tipo-divisao");
    b.dataset.divisao = t.nome;
    b.setAttribute("aria-label", `Acrescentar ${t.nome === "Outra" ? "outra divisão" : t.nome} (com ${traz})`);
    b.append(desenharIcone(svgEl("svg"), "divisao", { tipo: ICONE_DIVISAO[t.nome] ?? tipoDoNome(t.nome) }), el("span", "ferramenta-nome", t.nome));
    return b;
  }
  function desenharBotoesDivisao() {
    barraDiv.replaceChildren();
    divisoesMais.replaceChildren();
    for (const t of tiposDivisao) {
      const b = botaoDivisao(t);
      // O botão cria-a logo (rato, toque ou teclado), num sítio livre.
      b.addEventListener("click", () => {
        definirModo(null);
        if (criarDivisao(t.nome)) mostrarPlanta();
      });
      barraDiv.append(b);
      const m = botaoDivisao(t);
      m.addEventListener("click", () => {
        fecharMais();
        mostrarNaBarra(`divisao:${t.nome}`);
        definirModo(null);
        if (criarDivisao(t.nome)) mostrarPlanta();
      });
      divisoesMais.append(m);
    }
    acertarBarra();
  }

  // 2. Elementos da instalação elétrica (as máquinas têm o seu grupo, um botão por modelo).
  const barra = grupoBarra("editor-elementos", "Pôr na planta");
  const elementosMais = el("div", "editor-mais-grelha");
  for (const t of TIPOS_ELEMENTO.filter((x) => x !== "maquina")) {
    const b = botao("", "ferramenta");
    b.dataset.ferramenta = t;
    b.setAttribute("aria-pressed", "false");
    b.append(desenharIcone(svgEl("svg"), t, ELEMENTOS[t].props), el("span", "ferramenta-nome", ELEMENTOS[t].nome));
    ligarFerramenta(b, t, t, null);
    barra.append(b);
    elementosMais.append(botaoMais(t, t, null, ELEMENTOS[t].nome));
  }
  // 3. Máquinas: um botão com o desenho de cada modelo (definirMaquinas: na linha as escolhidas; em "Mais…" todas).
  const barraMaq = grupoBarra("editor-maquinas", "Pôr uma máquina na planta");
  const maquinasMais = el("div", "editor-mais-grelha");
  let modelosMaq = [];
  function desenharBotoesMaquina() {
    for (const k of Object.keys(ferramentas)) if (k.startsWith("maquina:")) delete ferramentas[k];
    barraMaq.replaceChildren();
    maquinasMais.replaceChildren();
    for (const m of modelosMaq) {
      const b = botao("", "ferramenta maquina-ferramenta");
      b.dataset.maquina = m;
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", `Pôr na planta: ${MODELOS[m].nome}`);
      b.append(desenharIcone(svgEl("svg"), "maquina", { modelo: m }), el("span", "ferramenta-nome", NOMES_CURTOS[m] ?? MODELOS[m].nome));
      ligarFerramenta(b, `maquina:${m}`, "maquina", m);
      barraMaq.append(b);
      maquinasMais.append(botaoMais(`maquina:${m}`, "maquina", m, MODELOS[m].nome));
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
  /** Botão da janela "Mais…" (elemento ou máquina): escolhe a ferramenta, fecha a janela e fica na linha. */
  function botaoMais(chave, tipo, modelo, nome) {
    const b = botao("", "ferramenta");
    b.dataset.mais = chave;
    b.append(desenharIcone(svgEl("svg"), tipo, modelo ? { modelo } : ELEMENTOS[tipo].props), el("span", "ferramenta-nome", nome));
    b.addEventListener("click", (ev) => {
      const teclado = ev.detail === 0;
      fecharMais();
      mostrarNaBarra(chave);
      usarFerramenta(tipo, modelo, teclado);
      if (!teclado) ferramentas[chave]?.focus({ preventScroll: true });
    });
    return b;
  }
  /** A ferramenta `chave` passa a aparecer na linha (se ainda lá não estava). */
  function mostrarNaBarra(chave) {
    if (!chave || naBarraExtra.has(chave)) return;
    naBarraExtra.add(chave);
    acertarBarra();
  }
  /** Mostra na linha só o que é para lá (e as ferramentas trazidas); esconde os grupos vazios. */
  function acertarBarra() {
    for (const b of barraDiv.children) b.hidden = !(divisoesNaBarra === null || divisoesNaBarra.includes(b.dataset.divisao) || naBarraExtra.has(`divisao:${b.dataset.divisao}`));
    for (const b of barra.children) b.hidden = !(ELEMENTOS_BASE.includes(b.dataset.ferramenta) || naBarraExtra.has(b.dataset.ferramenta));
    for (const b of barraMaq.children) b.hidden = !(maquinasNaBarra.includes(b.dataset.maquina) || naBarraExtra.has(`maquina:${b.dataset.maquina}`));
    for (const g of [barraDiv, barra, barraMaq]) g.hidden = ![...g.children].some((b) => !b.hidden);
    rovingFerramentas?.();
  }
  // "Mais…": a lista completa, agrupada, numa janela (<dialog> modal, Esc fecha).
  const bMaisFerr = botao("", "ferramenta ferramentas-mais");
  bMaisFerr.id = "editor-mais";
  bMaisFerr.setAttribute("aria-haspopup", "dialog");
  bMaisFerr.setAttribute("aria-label", "Mais: todas as divisões, elementos e máquinas");
  bMaisFerr.append(el("span", "ferramentas-mais-icone", "⋯"), el("span", "ferramenta-nome", "Mais…"));
  fila.append(barraDiv, barra, barraMaq, bMaisFerr);
  const dlgMais = el("dialog", "editor-dialogo editor-mais");
  dlgMais.setAttribute("aria-labelledby", "mais-titulo");
  const maisTitulo = el("h2", null, "Todas as ferramentas");
  maisTitulo.id = "mais-titulo";
  const maisSeccao = (titulo, grelha) => { const s = el("section", "editor-mais-seccao"); s.append(el("h3", null, titulo), grelha); return s; };
  const seccaoMaq = maisSeccao("Máquinas", maquinasMais);
  const maisFechar = botao("Fechar");
  maisFechar.id = "mais-fechar";
  const maisBotoes = el("div", "form-botoes");
  maisBotoes.append(maisFechar);
  const maisCorpo = el("div", "editor-mais-corpo");
  maisCorpo.append(maisSeccao("Divisões", divisoesMais), maisSeccao("Elementos", elementosMais), seccaoMaq);
  dlgMais.append(maisTitulo, maisCorpo, maisBotoes);
  function fecharMais() { if (dlgMais.open) dlgMais.close(); }
  bMaisFerr.addEventListener("click", () => {
    definirModo(null);
    seccaoMaq.hidden = !modelosMaq.length;
    dlgMais.showModal();
    maisCorpo.scrollTop = 0;
    maisCorpo.querySelector("button")?.focus();
  });
  maisFechar.addEventListener("click", () => { fecharMais(); bMaisFerr.focus({ preventScroll: true }); });

  const bDesfazer = iconeAcao(botao(""), "anular", "Anular (Ctrl+Z)");
  bDesfazer.setAttribute("aria-keyshortcuts", "Control+Z");
  const bRefazer = iconeAcao(botao(""), "refazer", "Refazer (Ctrl+Y)");
  bRefazer.setAttribute("aria-keyshortcuts", "Control+Y");
  const bMenos = iconeAcao(botao(""), "afastar", "Afastar");
  const bMais = iconeAcao(botao(""), "aproximar", "Aproximar");
  const bTudo = iconeAcao(botao(""), "tudo", "Ver tudo");
  // "Ampliar": a planta e as ferramentas em ecrã inteiro (só no computador; no telemóvel a planta já abre por cima).
  const bEcra = iconeAcao(botao(""), "ampliar", "Ampliar (ecrã inteiro)");
  bEcra.id = "editor-ecra-inteiro";
  bEcra.setAttribute("aria-pressed", "false");
  // Só a planta, uma folha A4 por piso (imprimir.js).
  const bImprimir = botao("Imprimir");
  bImprimir.id = "editor-imprimir";
  bImprimir.setAttribute("aria-label", "Imprimir a planta (uma folha por piso)");
  const bPdf = botao("Guardar PDF");
  bPdf.id = "editor-pdf";
  bPdf.setAttribute("aria-label", "Guardar a planta em PDF (uma página por piso)");

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
  const sApagar = iconeAcao(botao("", "btn sec pequeno perigo-sec"), "apagar", "Apagar");
  sApagar.id = "selecao-apagar";
  sApagar.setAttribute("aria-keyshortcuts", "Delete");
  // "Planta de fundo": abre logo a escolha do ficheiro (foto ou PDF); o cartão "Fundo" ao lado fica para
  // ajustar, calibrar e tirar o fundo.
  const bFundo = botao("Planta de fundo");
  bFundo.id = "editor-fundo-botao";
  bFundo.setAttribute("aria-label", "Planta de fundo: escolher uma foto ou um PDF da planta");

  // Barra única das ações, centrada por cima da planta, em grupos: anular/refazer · zoom, ver tudo e ecrã
  // inteiro · o que está selecionado · fundo · pisos. No computador uma só fila (quebra se não couber); no
  // telemóvel duas filas que deslizam dentro de si — as gerais e as da seleção (a página não rola na horizontal).
  const acoes = el("div", "editor-acoes");
  acoes.setAttribute("role", "toolbar");
  acoes.setAttribute("aria-label", "Ações da planta");
  const grupo = (cls, ...xs) => { const g = el("div", `editor-acoes-grupo ${cls}`); g.append(...xs); return g; };
  const linhaGeral = el("div", "editor-acoes-linha");
  // "⋯": as ações menos usadas (Imprimir, Guardar PDF, Planta de fundo) e os cartões do fundo e do tamanho da planta,
  // num painel por baixo das barras (`lado`), fechado por omissão: a planta do topo fica compacta.
  const bOutras = iconeAcao(botao(""), "outras", "Mais ações da planta: imprimir, PDF, planta de fundo e tamanho");
  bOutras.id = "editor-outras";
  bOutras.setAttribute("aria-expanded", "false");
  bOutras.setAttribute("aria-controls", "editor-lado");
  linhaGeral.append(grupo("g-historico", bDesfazer, bRefazer), grupo("g-vista", bMenos, bMais, bTudo, bEcra), grupo("g-fundo", bOutras));
  const linhaSelecao = el("div", "editor-acoes-linha");
  linhaSelecao.append(grupo("g-selecao", sDuplicar, sOpcoes, sApagar));
  acoes.append(linhaGeral, linhaSelecao);
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
  area.append(svg, estadoLinha);
  const ajudaTeclado = el("p", "editor-ajuda", "Com o teclado: nas barras as setas passam de botão em botão; escolha uma ferramenta e carregue em Enter para a pôr no centro; na planta as setas movem o que está selecionado (Shift para mover mais), Enter abre as opções, Delete apaga, Ctrl+Z anula.");
  ajudaTeclado.id = "editor-ajuda-teclado";

  // Ao lado (por baixo, no telemóvel): só o fundo e o tamanho da planta. O que se muda numa divisão ou num
  // elemento está todo na janela de edição (duplo clique, toque longo, Enter ou "Opções").
  const lado = el("div", "editor-lado");
  lado.id = "editor-lado";
  lado.hidden = true;
  const ladoAcoes = el("div", "form-botoes editor-lado-acoes");
  ladoAcoes.append(bImprimir, bPdf, bFundo);
  /** Abre ou fecha o painel "⋯" (ações menos usadas, fundo e tamanho). */
  function mostrarLado(sim) {
    lado.hidden = !sim;
    bOutras.setAttribute("aria-expanded", String(sim));
  }
  bOutras.addEventListener("click", () => mostrarLado(lado.hidden));

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

  // Lote 7: legenda das marcas das ações (M, R, S, N) na planta.
  const legendaAcao = el("p", "ajuda editor-legenda-acoes");
  legendaAcao.hidden = true;
  let acoesOmissao = null;   // ação por omissão do serviço (definirAcoes); null = sem marcas
  lado.append(ladoAcoes, legendaAcao, fundoSec, tamSec);
  const principal = el("div", "editor-principal");
  // Os separadores dos pisos ficam junto à planta, por baixo das duas linhas (ferramentas e ações).
  principal.append(fila, acoes, separadores, area, ajudaTeclado);

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
  raiz.append(principal, lado, dialogo, dlgMais);

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
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: l.length - 1 }[ev.key];
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
  // A linha das ferramentas: uma só paragem do Tab; as setas passam pelos botões à vista dos 3 grupos e "Mais…".
  rovingFerramentas = barraComSetas(fila, () => [...fila.querySelectorAll("button")]);
  // Pela ordem em que se veem (os grupos têm `order` no CSS: no computador a seleção vem antes do fundo).
  const ordemVista = (b) => Number(getComputedStyle(b.closest(".editor-acoes-grupo")).order) || 0;
  const rovingAcoes = barraComSetas(acoes, () => [...acoes.querySelectorAll(".editor-acoes-grupo button")].map((b, i) => [b, ordemVista(b), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([b]) => b));
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
  const elementosPiso = () => planta.elementos.filter(noPiso);
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
    if (dizer) avisar(`${nomePiso(p)}: ${nDivisoesVista} ${nDivisoesVista === 1 ? "divisão" : "divisões"}. O que acrescentar vai para este piso.`);
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
    if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return null; }
    const t = tipoDivisao(div) ?? { w: 400, h: 300 };
    const [x, y] = sitioLivre(t.w, t.h);
    memorizar();
    crescerFolha(x + t.w, y + t.h);
    const d = { id: novoId("d", planta.divisoes), nome: nomeNovaDivisao(div), piso: pisoAtual, x_cm: x, y_cm: y, largura_cm: t.w, altura_cm: t.h };
    planta.divisoes.push(d);
    let n = 0;
    for (const a of aparelhosOmissao(d.nome, d)) {
      if (planta.elementos.length >= MAX_ELEMENTOS) break;
      planta.elementos.push({ id: novoId("e", planta.elementos), ...a, piso: pisoAtual, divisao: d.id });
      n++;
    }
    ajustarFolha();
    selecionado = d.id;
    destaque = { id: d.id, desde: performance.now() };
    setTimeout(() => { if (destaque?.id === d.id) { destaque = null; desenhar(); } }, DESTAQUE_MS);
    confirmar(`Divisão "${d.nome}" criada${nPisos() > 1 ? ` no ${nomePiso(pisoAtual)}` : ""}${n ? ` com ${n} aparelhos habituais (porta, interruptor, luz, tomadas…)` : ""}. Arraste-a para o sítio certo, os cantos mudam a forma; duplo clique (ou toque longo) abre as opções.`);
    return d;
  }

  function adicionarElemento(tipo, x, y, modelo = null) {
    if (planta.elementos.length >= MAX_ELEMENTOS) { avisar(`A planta já tem o máximo de ${MAX_ELEMENTOS} elementos.`); return null; }
    memorizar();
    const e = {
      id: novoId("e", planta.elementos), tipo,
      x_cm: limitar(ajustar(x, PASSO_ELEMENTO), 0, planta.largura_cm),
      y_cm: limitar(ajustar(y, PASSO_ELEMENTO), 0, planta.altura_cm),
      rot: 0, piso: pisoAtual, divisao: null, props: propsOmissao(tipo, modelo),
    };
    if (temPergunta(tipo, e.props)) e.por_responder = true;   // passo 4: por responder até guardar a janela dele
    planta.elementos.push(e);
    // Numa zona sobreposta: a divisão selecionada (ex.: "+" do passo Divisões); sem ela, a desenhada por cima.
    e.divisao = selecionadaEm(e.x_cm, e.y_cm)?.id ?? divisaoDoElemento(planta, e);
    selecionado = e.id;
    const onde = e.divisao ? `divisão ${obterDivisao(e.divisao)?.nome || "sem nome"}` : "fora das divisões: arraste-o para dentro de uma divisão para contar nela";
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
    if (!v) { avisar("Não foi possível pôr um canto aqui: está demasiado perto de outro."); return; }
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
    if (!v) { avisar("Sem este canto as paredes cruzavam-se ou a divisão ficava pequena demais: mova-o em vez de o apagar."); return; }
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
    const alvo = oQueEsta(p, tipoPonteiro);
    if (!alvo) return;
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
    modo = m;
    const chave = m?.tipo === "elemento" ? (m.el === "maquina" ? `maquina:${m.modelo}` : m.el) : null;
    for (const [k, b] of Object.entries(ferramentas)) b.setAttribute("aria-pressed", String(k === chave));
    // A ferramenta ativa está sempre na linha (a do "+" do passo Divisões ou de "Mais…") e à vista nela.
    if (chave && ferramentas[chave]) { mostrarNaBarra(chave); verNaLinha(ferramentas[chave]); }
    svg.classList.toggle("a-colocar", !!m);
    // Sem ferramenta, nada a dizer (decisão do dono: saiu o texto de ajuda longo por cima da planta).
    if (!m) dica.textContent = "";
    else if (m.tipo === "elemento") dica.textContent = `Toque na planta onde quer pôr: ${nomeFerramenta(m.el, m.modelo)}. Esc cancela.`;
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
      avisar("Não foi possível fazer o PDF neste navegador. Experimente \"Imprimir\" e escolha \"Guardar como PDF\".");
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
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ecraCss && !dialogo.open && !dlgMais.open) sairEcra(); });

  // ---------------------------------------------------------------- ponteiro
  const pararToqueLongo = () => { clearTimeout(toqueLongo); toqueLongo = null; };

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button > 0) return;
    svg.setPointerCapture?.(ev.pointerId);
    // O 1.º dedo (ou o rato) de um gesto novo: esquece ponteiros cujo "pointerup" não chegou à planta
    // (ex.: o toque longo abriu a janela por cima e o dedo foi levantado nela) — senão parecia uma pinça.
    if (ev.isPrimary) { ponteiros.clear(); pinca = null; }
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
        gestoDuplo(p, tipo, { longo: true });
      }, TOQUE_LONGO_MS);
    }
    const alvo = ev.target.closest?.("[data-pega], [data-elemento], [data-divisao]");
    if (alvo?.dataset.pega) {
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
      const m = modo;
      definirModo(null);
      if (m?.tipo === "elemento") adicionarElemento(m.el, p.x, p.y, m.modelo);
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
  raiz.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.target.matches?.("input, textarea, select") || dialogo.open || dlgMais.open) return;
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

  // Tamanho da planta: os campos fazem-se uma só vez (desenharTamanho só acerta os valores e o botão "Ajustar ao
  // conteúdo"). Refazê-los a cada mudança tirava o foco a quem escrevia e perdia o clique seguinte (Tab, "Ajustar").
  const tamW = numeroInput(20, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-largura" });
  const tamH = numeroInput(15, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-altura" });
  const tamAjustar = botao("Ajustar ao conteúdo", "btn sec pequeno");
  tamAjustar.id = "planta-ajustar";
  // Aviso curto por baixo dos campos (a dica fica por cima da planta, fora da vista no telemóvel).
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
  // Aplica enquanto se escreve (com uma pequena pausa), sem nunca reescrever o campo onde se escreve: um valor a
  // meio ("2" antes de "20") abaixo do mínimo espera. Ao sair do campo (ou Enter) um valor abaixo do mínimo passa
  // ao mínimo, com o aviso. A partir daí a folha fica com este tamanho (tamanho_fixo, gravado).
  function aplicarTamanho(i, k, final) {
    if (!planta) return;
    const v = Number(String(i.value).replace(",", "."));
    if (!(v > 0)) { if (final) i.value = String(planta[k] / 100); return; }
    const pedido = Math.ceil((v * 100) / ESCALA_CM) * ESCALA_CM;
    const min = tamanhoMinimo(k);
    if (pedido < min && !final) return;
    const novo = limitar(pedido, min, MAX_LADO_CM);
    if (novo !== planta[k] || !planta.tamanho_fixo) {
      memorizar();
      planta[k] = novo;
      planta.tamanho_fixo = true;
      verTudo();
      confirmar();
    }
    if (pedido < min) avisoTamanho(`Mínimo ${metros(min)} m para caber tudo.`);
    else if (pedido > MAX_LADO_CM) avisoTamanho(`Máximo ${metros(MAX_LADO_CM)} m.`);
    if (final) i.value = String(planta[k] / 100);
  }
  for (const [i, k] of [[tamW, "largura_cm"], [tamH, "altura_cm"]]) {
    let espera = null, escreveu = false;
    i.addEventListener("input", () => { escreveu = true; clearTimeout(espera); espera = setTimeout(() => aplicarTamanho(i, k, false), 500); });
    // Só depois de escrever (entrar e sair do campo sem escrever não fixa o tamanho).
    const fim = () => { clearTimeout(espera); if (!escreveu) return; escreveu = false; aplicarTamanho(i, k, true); };
    i.addEventListener("change", fim);
    i.addEventListener("blur", fim);
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); fim(); } });
  }
  // Sempre ativo: com a folha já à medida, carregar não muda nada.
  tamAjustar.addEventListener("click", () => {
    if (!planta) return;
    memorizar();
    delete planta.tamanho_fixo;
    ajustarFolha();
    verTudo();
    confirmar("A planta voltou ao tamanho das divisões.");
  });
  tamCorpo.append(campo("Largura (m)", tamW), campo("Altura (m)", tamH), tamAjustar);
  tamSec.append(tamMsg);
  function desenharTamanho() {
    if (!planta) return;
    if (document.activeElement !== tamW) tamW.value = String(planta.largura_cm / 100);
    if (document.activeElement !== tamH) tamH.value = String(planta.altura_cm / 100);
  }

  // ---------------------------------------------------------------- propriedades (janela de edição)
  /**
   * A escolha de cada tipo de elemento na janela de edição — só uma, em linguagem simples: porta, se é a da rua;
   * janela, se tem estore e se é motorizado; tomada, se é inteligente; interruptor, quantos botões; máquina, qual é
   * (com a potência típica). Ponto de luz (sempre não regulável, decisão do dono), sensores e quadro: nada a escolher.
   * `mudar(f)` devolve o que fazer quando o campo muda (f altera `p`); `pre` = prefixo dos ids.
   */
  function camposElemento(tipo, p, mudar, pre) {
    const r = [];
    if (tipo === "porta") r.push(caixa("É a porta da rua?", !!p.entrada, mudar((v) => { p.entrada = v; }), false, `${pre}-entrada`));
    if (tipo === "janela") {
      r.push(caixa("Tem estore?", !!p.estore, mudar((v) => { p.estore = v; if (!v) p.motorizado = false; }), false, `${pre}-estore`));
      r.push(caixa("É motorizado?", !!p.motorizado, mudar((v) => { p.motorizado = v; }), !p.estore, `${pre}-motorizado`));
    }
    if (tipo === "tomada") r.push(caixa("Tomada inteligente? (ligar, desligar e ver o consumo no telemóvel)", !!p.inteligente, mudar((v) => { p.inteligente = v; }), false, `${pre}-inteligente`));
    if (tipo === "interruptor") {
      const s = document.createElement("select");
      s.id = `${pre}-botoes`;
      for (const b of [1, 2, 3, 4]) { const o = document.createElement("option"); o.value = String(b); o.textContent = `${b} ${b === 1 ? "botão" : "botões"}`; s.append(o); }
      s.value = String(p.botoes);
      s.addEventListener("change", mudar(() => { p.botoes = Number(s.value); }));
      r.push(campo("Quantos botões?", s));
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
  function desenharSelecao() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    const div = d?.id ?? e?.divisao ?? null;
    if (aoSelecionar && div !== divisaoAvisada) { divisaoAvisada = div; aoSelecionar(div); }
    const nome = d ? `Divisão ${d.nome || "sem nome"}` : e ? descreverElemento(e) : "";
    estadoLinha.classList.toggle("vazia", !d && !e);
    selecaoNome.textContent = nome ? `Selecionado: ${nome}` : "";
    sDuplicar.disabled = d ? planta.divisoes.length >= MAX_DIVISOES : !e || planta.elementos.length >= MAX_ELEMENTOS;
    sOpcoes.disabled = !d && !e;
    sApagar.disabled = !d && !e;
    for (const [b, r] of [[sDuplicar, "Duplicar"], [sOpcoes, "Opções"], [sApagar, "Apagar"]]) {
      b.setAttribute("aria-label", nome ? `${r}: ${nome}` : r);
      b.title = b.getAttribute("aria-label");
    }
  }
  sDuplicar.addEventListener("click", duplicarSelecionado);
  sApagar.addEventListener("click", apagarSelecionado);
  // "Opções" abre a janela de edição (a mesma do duplo clique): tudo o que se muda na divisão ou no elemento.
  sOpcoes.addEventListener("click", () => abrirDialogo());
  bFundo.addEventListener("click", () => ficheiro.click());

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
    if (d) {
      if (planta.divisoes.length >= MAX_DIVISOES) { avisar(`A planta já tem o máximo de ${MAX_DIVISOES} divisões.`); return; }
      const [x, y] = sitioLivre(d.largura_cm, d.altura_cm, { piso: pisoDe(d) });
      const dx = x - d.x_cm, dy = y - d.y_cm;
      memorizar();
      const nova = { ...structuredClone(d), id: novoId("d", planta.divisoes), nome: nomeCopia(d.nome), x_cm: x, y_cm: y };
      if (nova.pontos) nova.pontos = nova.pontos.map(([px, py]) => [px + dx, py + dy]);
      crescerFolha(x + d.largura_cm, y + d.altura_cm);
      planta.divisoes.push(nova);
      let n = 0;
      for (const a of planta.elementos.filter((q) => q.divisao === d.id)) {
        if (planta.elementos.length >= MAX_ELEMENTOS) break;
        planta.elementos.push({ ...structuredClone(a), id: novoId("e", planta.elementos), x_cm: a.x_cm + dx, y_cm: a.y_cm + dy, divisao: nova.id });
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
    if (e.tipo === "tomada") return p.inteligente ? "Tomada inteligente" : "Tomada";
    if (e.tipo === "interruptor") return `Interruptor de ${p.botoes} ${p.botoes === 1 ? "botão" : "botões"}`;
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
    else dlgCorpo.append(el("p", "ajuda", "Nada a escolher: pode apagá-lo."));
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

  dlgForm.addEventListener("submit", (ev) => { ev.preventDefault(); guardarDialogo(); });
  dCancelar.addEventListener("click", () => dialogo.close());
  dApagar.addEventListener("click", () => {
    const id = rascunho?.id;
    dialogo.close();
    if (id && existe(id)) { selecionado = id; apagarSelecionado(); }
  });
  // Fechar (Guardar, Cancelar, Apagar ou Esc): o foco volta à planta — ou, aberta de fora (passo "Divisões",
  // abrirOpcoes), a janela volta para o editor e quem a abriu decide para onde vai o foco.
  let fechoExterno = null;
  dialogo.addEventListener("close", () => {
    rascunho = null;
    if (fechoExterno) {
      const f = fechoExterno;
      fechoExterno = null;
      if (dialogo.parentElement !== raiz) raiz.append(dialogo);
      f();
      return;
    }
    svg.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- desenho
  function desenhar() {
    if (!planta) return;
    const { ppc, raio, raioToque, letra, pega } = tamanhos();
    desenharPlanta(svg, planta, { selecionado, vista: caixaVista(), raio, raioToque, letra, pega, piso: pisoAtual, acoes: acoesOmissao ? { omissao: acoesOmissao } : null });
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
    desenharSeparadores();
    desenhar();
    desenharSelecao();
    desenharFundo();
    desenharTamanho();
    rovingAcoes();
    reporFoco(foco);
  }

  // O tamanho da planta no ecrã mudou (o passo apareceu, rodou o telemóvel…): se a vista foi ajustada
  // sozinha e o cliente ainda não lhe mexeu, volta a ajustá-la ao conteúdo.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => { if (ajusteAuto && planta) verTudo(); desenhar(); }).observe(area);

  return {
    /** Abre (ou reabre) a planta no editor. */
    abrir(p, { reiniciarVista = true } = {}) {
      const nova = planta !== p;
      planta = p;
      if (nova) { desfazer = []; refazer = []; selecionado = null; calibracao = null; ultimoToque = null; lerAspeto(); pisoAtual = 0; }
      if (pisoAtual >= nPisos()) pisoAtual = 0;
      if (nova) ajustarFolha();   // plantas antigas com quadrícula vazia à volta ficam à medida
      if (reiniciarVista || nova) verTudo();
      nDivisoesVista = divisoesPiso().length;
      definirModo(null);
      if (nova) fila.scrollLeft = 0;   // planta nova (ex. "Refazer planta"): a linha das ferramentas volta ao início
      desenharTudo();
    },
    redesenhar: () => desenharTudo(),
    /**
     * Lote 7: ação por omissão do serviço ("novo" ou "manter"): os aparelhos com outra ação levam a marca (M, R, S, N)
     * na planta, com a legenda no "⋯" e na impressão. null = sem marcas.
     */
    definirAcoes(omissao) {
      if (omissao === acoesOmissao) return;
      acoesOmissao = omissao ?? null;
      legendaAcao.hidden = !acoesOmissao;
      legendaAcao.textContent = acoesOmissao ? legendaAcoes(acoesOmissao) : "";
      if (planta) desenhar();
    },
    /** N.º de pisos da casa (1 = sem separadores, salvo se a planta já tiver coisas noutros pisos). */
    definirPisos(n) {
      pisosPedidos = Math.min(MAX_PISO + 1, Math.max(1, Math.round(Number(n)) || 1));
      if (planta && pisoAtual >= nPisos()) pisoAtual = 0;
      desenharSeparadores();
    },
    /** Piso visível (0 = r/c). */
    get piso() { return pisoAtual; },
    mudarPiso: (p) => mudarPiso(p),
    /**
     * Botões de divisão para o tipo de imóvel (regras.js tiposDivisaoPara; todos em "Mais…"). `naBarra`: os nomes dos
     * botões que ficam na linha (as divisões da casa do passo 1); sem ele, todos.
     */
    definirTiposDivisao(lista, naBarra = null) {
      divisoesNaBarra = Array.isArray(naBarra) ? naBarra : null;
      if (lista === tiposDivisao) { acertarBarra(); return; }
      tiposDivisao = lista;
      desenharBotoesDivisao();
    },
    /**
     * Máquinas: um botão por modelo (chaves de regras.js MODELOS), pela ordem dada, todos em "Mais…"; `naBarra`: os
     * modelos que ficam na linha (as escolhidas no passo 2). `janela`: os modelos da lista "Qual é?" da janela da
     * máquina (os do perfil do imóvel; sem ela, todos).
     */
    definirMaquinas(lista, janela = null, naBarra = []) {
      modelosJanela = Array.isArray(janela) ? janela : null;
      maquinasNaBarra = Array.isArray(naBarra) ? naBarra : [];
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
      fecharMais();
      naBarraExtra.clear();
      acertarBarra();
      if (dialogo.parentElement !== raiz) raiz.append(dialogo);
      if (emEcraInteiro()) sairEcra();
      pararToqueLongo();
      planta = null;
      desfazer = []; refazer = [];
      selecionado = null; calibracao = null; aspetoFundo = null; destaque = null; rascunho = null;
      arrasto = null; pinca = null; ponteiros.clear(); ultimoToque = null;
      pisoAtual = 0; pisosPedidos = 1; nDivisoesVista = 0; ajusteAuto = false;
      vista = { cx: 1000, cy: 750, w: 2100 };
      definirModo(null);
      mostrarFundoMsg("", "info");
      ficheiro.value = "";
      fundoSec.open = false;
      tamSec.open = false;
      mostrarLado(false);
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
      const x = obterElemento(id) ?? obterDivisao(id);
      if (pisoDe(x) !== pisoAtual && pisoDe(x) < nPisos()) pisoAtual = pisoDe(x);
      selecionado = id;
      desenharTudo();
      if (anfitriao) anfitriao.append(dialogo);
      fechoExterno = aoFechar ?? (() => {});
      abrirDialogo();
      return true;
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
        mostrarNaBarra(m.el === "maquina" ? `maquina:${m.modelo}` : m.el);
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
    /** Só para testes/depuração: estado da vista. */
    get vista() { return { ...vista }; },
  };
}
