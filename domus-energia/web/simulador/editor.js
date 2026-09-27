// Editor da planta (docs/SIMULADOR-ORCAMENTO.md §2): SVG com quadriculado de 50 cm, separadores por piso
// (cada um mostra só as divisões e os elementos desse piso, na mesma folha e escala), ecrã inteiro,
// deslocar e aproximar (botões − / +, Ctrl + roda do rato, dois dedos), eventos de ponteiro para rato e
// toque, divisões (criar num sítio livre com os aparelhos habituais, mover, mudar a forma pelos cantos — paredes oblíquas),
// elementos (colocar, mover, rodar, apagar; as máquinas com um botão por modelo), janela de edição (duplo clique, toque
// longo, Enter ou "Opções": tudo o que se muda numa divisão ou num elemento), anular/refazer, alternativa por teclado
// e lista acessível,
// fundo (foto/PDF) com opacidade, escala e calibração; a vista ajusta-se ao conteúdo.
// Todos os textos entram com textContent.

import { desenharPlanta, desenharIcone } from "./planta-svg.js";
import {
  ELEMENTOS, TIPOS_ELEMENTO, TIPOS_DIVISAO, MODELOS, NOMES_DIVISAO, ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM,
  MAX_CANTOS, MIN_CANTOS, AREA_MIN_CM2, MAX_PISO, ALTURA_MAX_CM,
  propsOmissao, atualizarDivisoes, divisaoDoElemento, divisaoEm, pontosDivisao, areaPoligono, ehRetangulo, caixaPontos,
  distanciaSegmento, paredesCruzam, validarPontos, definirPontos, pontoInterior, pisoDe, nomePiso, alturaTipica,
  pontoEmPoligono, distanciaPoligono, TIPOS_PAREDE, TOLERANCIA_PORTA_CM,
} from "./regras.js";
import { lerFundo, ErroFundo } from "./fundo.js";
import { aparelhosOmissao, resumoAparelhos, tipoDivisao as tipoDoNome } from "./casa.js";

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
  box_router: "Box/router", nas: "NAS", camara: "Câmara", rega: "Rega", iluminacao_jardim: "Luz de jardim",
  terminal_pagamento: "Terminal pagamento", ferramentas: "Ferramentas", cafeteira: "Cafeteira", outro: "Outra",
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
 * @param {{aoMudar: (planta: object) => void, anunciar?: (texto: string) => void, circuitoDe?: (planta: object, e: object) => string|null}} opcoes
 *   `circuitoDe`: texto do circuito onde o elemento fica (janela de edição), ou null se não se souber.
 */
export function criarEditor(raiz, { aoMudar, anunciar = null, circuitoDe = null }) {
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
  let pisoAtual = 0;          // separador visível: só as divisões e os elementos deste piso (0 = r/c)
  let pisosPedidos = 1;       // pisos da casa (definirPisos); aparecem também os pisos que já têm coisas
  let ultimoToque = null;     // {t, x, y}: o toque anterior, para o duplo clique (DUPLO_MS)
  let duploEm = 0;            // quando o nosso duplo clique abriu algo (o "dblclick" do navegador não repete)
  let ecraCss = false;        // ecrã inteiro sem a Fullscreen API (recurso CSS)

  // ---------------------------------------------------------------- DOM
  raiz.replaceChildren();
  raiz.classList.add("editor");

  // As ferramentas em 3 grupos (divisões, elementos, máquinas), todos com botões iguais: quadrados, o desenho
  // em cima e o nome em baixo; separados só por um pequeno espaço (sem rótulos), alinhados em grelha.
  // 1. Um botão por tipo de divisão, com o seu desenho (planta-svg.js divisao_<tipo>): cria-a logo, com o nome
  // certo (Quarto 1, Quarto 2, Sala…); o que traz (casa.js resumoAparelhos) fica no nome acessível do botão.
  const barraDiv = el("div", "editor-barra editor-divisoes");
  barraDiv.setAttribute("role", "toolbar");
  barraDiv.setAttribute("aria-label", "Acrescentar divisão");
  const ferramentas = {};
  function desenharBotoesDivisao() {
    barraDiv.replaceChildren();
    for (const t of tiposDivisao) {
      const traz = resumoAparelhos(t.nome, t.w, t.h);
      const b = botao("", "ferramenta tipo-divisao");
      b.dataset.divisao = t.nome;
      b.setAttribute("aria-label", `Acrescentar ${t.nome === "Outra" ? "outra divisão" : t.nome} (com ${traz})`);
      b.append(desenharIcone(svgEl("svg"), "divisao", { tipo: ICONE_DIVISAO[t.nome] ?? tipoDoNome(t.nome) }), el("span", "ferramenta-nome", t.nome));
      // O botão cria-a logo (rato, toque ou teclado), num sítio livre.
      b.addEventListener("click", () => {
        definirModo(null);
        if (criarDivisao(t.nome)) mostrarPlanta();
      });
      barraDiv.append(b);
    }
  }

  // 2. Elementos da instalação elétrica (as máquinas têm o seu grupo, um botão por modelo).
  const barra = el("div", "editor-barra editor-elementos");
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", "Pôr na planta");
  for (const t of TIPOS_ELEMENTO.filter((x) => x !== "maquina")) {
    const b = botao("", "ferramenta");
    b.dataset.ferramenta = t;
    b.setAttribute("aria-pressed", "false");
    b.append(desenharIcone(svgEl("svg"), t, ELEMENTOS[t].props), el("span", "ferramenta-nome", ELEMENTOS[t].nome));
    ligarFerramenta(b, t, t, null);
    barra.append(b);
  }
  // 3. Máquinas: um botão com o desenho de cada modelo (definirMaquinas: as do tipo de imóvel e as escolhidas).
  const barraMaq = el("div", "editor-barra editor-maquinas");
  barraMaq.setAttribute("role", "toolbar");
  barraMaq.setAttribute("aria-label", "Pôr uma máquina na planta");
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
    barraMaq.hidden = !modelosMaq.length;
  }
  /** Ferramenta (elemento ou máquina de um modelo): tocar escolhe-a (e depois toca-se na planta); teclado põe logo. */
  function ligarFerramenta(b, chave, tipo, modelo) {
    ferramentas[chave] = b;
    b.addEventListener("click", (ev) => {
      const ativo = b.getAttribute("aria-pressed") === "true";
      if (ativo) { definirModo(null); return; }
      // Teclado (Enter/Espaço, detail 0): põe logo no centro da vista (ou da divisão selecionada).
      if (ev.detail === 0) {
        const c = centroColocacao();
        definirModo(null);
        adicionarElemento(tipo, c.x, c.y, modelo);
        svg.focus({ preventScroll: true });
        return;
      }
      definirModo({ tipo: "elemento", el: tipo, modelo });
    });
  }

  const bDesfazer = botao("Anular");
  bDesfazer.setAttribute("aria-keyshortcuts", "Control+Z");
  const bRefazer = botao("Refazer");
  bRefazer.setAttribute("aria-keyshortcuts", "Control+Y");
  const bMenos = botao("−");
  bMenos.setAttribute("aria-label", "Afastar");
  const bMais = botao("+");
  bMais.setAttribute("aria-label", "Aproximar");
  const bTudo = botao("Ver tudo");
  const bEcra = botao("Ecrã inteiro");
  bEcra.id = "editor-ecra-inteiro";
  bEcra.setAttribute("aria-pressed", "false");
  // As barras de ferramentas juntas, por baixo umas das outras; em ecrã inteiro numa só fila que desliza para o
  // lado (a planta fica com a maior parte da altura).
  const fila = el("div", "editor-ferramentas");
  fila.append(barraDiv, barra, barraMaq);

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

  // Ações do que está selecionado (Rodar, Duplicar, "Opções" — a janela de edição com tudo o resto — e Apagar):
  // sempre no mesmo sítio, desativadas quando não se aplicam (a barra não muda de tamanho).
  const selecaoNome = el("span", "editor-selecao-nome");
  const sRodar = botao("Rodar");
  sRodar.id = "selecao-rodar";
  sRodar.setAttribute("aria-keyshortcuts", "R");
  const sDuplicar = botao("Duplicar");
  sDuplicar.id = "selecao-duplicar";
  const sOpcoes = botao("Opções");
  sOpcoes.id = "selecao-opcoes";
  sOpcoes.setAttribute("aria-keyshortcuts", "Enter");
  const sApagar = botao("Apagar", "btn sec pequeno perigo-sec");
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
  linhaGeral.append(grupo("g-historico", bDesfazer, bRefazer), grupo("g-vista", bMenos, bMais, bTudo, bEcra), grupo("g-fundo", bFundo), separadores);
  const linhaSelecao = el("div", "editor-acoes-linha");
  linhaSelecao.append(grupo("g-selecao", sRodar, sDuplicar, sOpcoes, sApagar));
  acoes.append(linhaGeral, linhaSelecao);
  // Por baixo da barra, discreto: o que está selecionado e o texto de estado.
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
  area.append(svg);
  const ajudaTeclado = el("p", "editor-ajuda", "Com o teclado: escolha uma ferramenta e carregue em Enter para a pôr no centro; as setas movem o que está selecionado (Shift para mover mais), Enter abre as opções (também os cantos da divisão, em metros), R roda, Delete apaga, Ctrl+Z anula.");
  ajudaTeclado.id = "editor-ajuda-teclado";

  // Ao lado (por baixo, no telemóvel): só o fundo e o tamanho da planta. O que se muda numa divisão ou num
  // elemento está todo na janela de edição (duplo clique, toque longo, Enter ou "Opções").
  const lado = el("div", "editor-lado");
  const listaSec = el("section", "editor-lista cartao");
  const listaTitulo = el("h3", null, "Lista da planta");
  listaTitulo.id = "editor-lista-titulo";
  listaSec.setAttribute("aria-labelledby", "editor-lista-titulo");
  const listaConteudo = el("div");
  listaSec.append(listaTitulo, el("p", "ajuda", "O que está em cada divisão, por tipo. Toque numa divisão para a escolher; num tipo (ex.: \"3 tomadas\") para escolher a 1.ª — cada toque seguinte passa à próxima."), listaConteudo);

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

  lado.append(fundoSec, tamSec, listaSec);   // a lista da planta fica na coluna da direita, por baixo do tamanho
  const principal = el("div", "editor-principal");
  // A lista da planta fica por baixo da planta (o piso visível), antes da ajuda do teclado.
  principal.append(fila, acoes, estadoLinha, area, ajudaTeclado);

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
  const dRodar = botao("Rodar");
  dRodar.id = "dlg-rodar";
  const dlgBotoes = el("div", "form-botoes");
  dlgBotoes.append(dGuardar, dRodar, dApagar, dCancelar);
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
    atualizarDivisoes(planta);
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
      planta.elementos.push({ id: novoId("e", planta.elementos), ...a, piso: pisoAtual });
      n++;
    }
    ajustarFolha();
    selecionado = d.id;
    destaque = { id: d.id, desde: performance.now() };
    setTimeout(() => { if (destaque?.id === d.id) { destaque = null; desenhar(); } }, DESTAQUE_MS);
    confirmar(`Divisão "${d.nome}" criada${nPisos() > 1 ? ` no ${nomePiso(pisoAtual)}` : ""}${n ? ` com ${n} aparelhos habituais (porta, interruptor, luz, sensor de movimento…)` : ""}. Arraste-a para o sítio certo, os cantos mudam a forma; duplo clique (ou toque longo) abre as opções.`);
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
    planta.elementos.push(e);
    e.divisao = divisaoDoElemento(planta, e);
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
  const caixaDe = (d) => ({ x_cm: d.x_cm, y_cm: d.y_cm, largura_cm: d.largura_cm, altura_cm: d.altura_cm });

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
    const id = divisaoEm(planta, p.x, p.y, pisoAtual);
    return id ? { tipo: "divisao", d: obterDivisao(id) } : null;
  }

  /**
   * Duplo clique (rato) ou toque longo (dedo): parede → canto novo; canto → apaga-o (no toque longo
   * abre a janela nesse canto: um dedo parado antes de arrastar não deve apagar nada); resto → janela.
   */
  function gestoDuplo(p, tipoPonteiro) {
    duploEm = performance.now();
    ultimoToque = null;
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
    const chave = m?.tipo === "elemento" ? (m.el === "maquina" ? `maquina:${m.modelo}` : m.el) : null;
    for (const [k, b] of Object.entries(ferramentas)) b.setAttribute("aria-pressed", String(k === chave));
    svg.classList.toggle("a-colocar", !!m);
    if (!m) dica.textContent = `Os botões das divisões acrescentam-nas logo${nPisos() > 1 ? ` (no ${nomePiso(pisoAtual)})` : ""}; para um elemento, toque na ferramenta e depois na planta. Arraste para deslocar; − / +, dois dedos ou Ctrl + roda do rato para aproximar. Duplo clique (ou toque longo) abre as opções.`;
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

  // ---------------------------------------------------------------- ecrã inteiro
  // Só a planta e as ferramentas (Fullscreen API no contentor; sem ela, um recurso CSS que ocupa a janela).
  // Esc sai; a vista reajusta-se ao entrar e ao sair.
  const emEcraInteiro = () => document.fullscreenElement === principal || ecraCss;
  function depoisEcra() {
    const sim = emEcraInteiro();
    bEcra.textContent = sim ? "Sair do ecrã inteiro" : "Ecrã inteiro";
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
        gestoDuplo(p, tipo);
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
        if (moverCanto(d, pts0, i, x, y)) { acompanhar(d, arrasto.c0, arrasto.dentro); desenhar(); }
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
    if (a.mexeu) confirmar();
    else desenharTudo();
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
      // Pode ter vindo do botão "Planta de fundo": o cartão abre-se para calibrar, ajustar ou tirar o fundo.
      fundoSec.open = true;
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

  function desenharTamanho() {
    // A escrever num dos campos: não os recria (perdia o cursor); só acerta os valores.
    const campoW = tamCorpo.querySelector("#planta-largura"), campoH = tamCorpo.querySelector("#planta-altura");
    if (campoW && campoH && tamCorpo.contains(document.activeElement)) {
      if (document.activeElement !== campoW) campoW.value = String(planta.largura_cm / 100);
      if (document.activeElement !== campoH) campoH.value = String(planta.altura_cm / 100);
      return;
    }
    tamCorpo.replaceChildren();
    const w = numeroInput(planta.largura_cm / 100, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-largura" });
    const h = numeroInput(planta.altura_cm / 100, { min: 1, max: MAX_LADO_CM / 100, step: 0.5, id: "planta-altura" });
    // Aplica enquanto se escreve (com uma pequena pausa) e ao sair do campo; nunca mais pequena do que o
    // conteúdo (avisa e mostra o mínimo). A partir daí a folha fica com este tamanho (tamanho_fixo).
    const aplicar = (i, k, final) => {
      const v = Number(String(i.value).replace(",", "."));
      if (!(v > 0)) return;
      const min = tamanhoMinimo(k);
      const novo = limitar(Math.ceil((v * 100) / ESCALA_CM) * ESCALA_CM, min, MAX_LADO_CM);
      if (novo !== Math.ceil((v * 100) / ESCALA_CM) * ESCALA_CM) {
        avisar(`A ${k === "largura_cm" ? "largura" : "altura"} da planta não pode ser menor do que ${metros(min)} m: as divisões ocupam até aí.`);
        if (!final) return;
      }
      if (novo === planta[k] && planta.tamanho_fixo) { if (final) i.value = String(novo / 100); return; }
      memorizar();
      planta[k] = novo;
      planta.tamanho_fixo = true;
      verTudo();
      confirmar();
      if (final) i.value = String(planta[k] / 100);
    };
    for (const [i, k] of [[w, "largura_cm"], [h, "altura_cm"]]) {
      let espera = null;
      i.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(() => aplicar(i, k, false), 500); });
      i.addEventListener("change", () => { clearTimeout(espera); aplicar(i, k, true); });
    }
    const ajustar = botao("Ajustar ao conteúdo", "btn sec pequeno");
    ajustar.disabled = !planta.tamanho_fixo;
    ajustar.addEventListener("click", () => {
      memorizar();
      delete planta.tamanho_fixo;
      ajustarFolha();
      verTudo();
      confirmar("A planta voltou ao tamanho das divisões.");
    });
    tamCorpo.append(campo("Largura (m)", w), campo("Altura (m)", h), ajustar);
  }

  // ---------------------------------------------------------------- propriedades (janela de edição)
  /**
   * Campos das propriedades de um elemento (§2) na janela de edição.
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

  /**
   * No telemóvel os painéis estão abaixo da planta: traz a planta de volta ao ecrã, inteira entre o topo
   * e a barra fixa de baixo ("Anterior/Seguinte"; a planta tem a altura que sobra entre as duas).
   */
  function mostrarPlanta() {
    if (emEcraInteiro()) return;
    const r = area.getBoundingClientRect();
    const baixo = document.querySelector(".sim-navegacao")?.getBoundingClientRect().top ?? innerHeight;
    if (r.top >= 0 && r.bottom <= Math.min(innerHeight, baixo)) return;
    area.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function desenharSelecao() {
    const d = obterDivisao(selecionado);
    const e = obterElemento(selecionado);
    const nome = d ? `Divisão ${d.nome || "sem nome"}` : e ? descreverElemento(e) : "";
    estadoLinha.classList.toggle("vazia", !d && !e);
    selecaoNome.textContent = nome ? `Selecionado: ${nome}` : "Nada selecionado";
    sRodar.disabled = !e || !ELEMENTOS[e.tipo].roda;
    sDuplicar.disabled = d ? planta.divisoes.length >= MAX_DIVISOES : !e || planta.elementos.length >= MAX_ELEMENTOS;
    sOpcoes.disabled = !d && !e;
    sApagar.disabled = !d && !e;
    sRodar.setAttribute("aria-label", e ? `Rodar: ${nome}` : "Rodar");
    sDuplicar.setAttribute("aria-label", nome ? `Duplicar: ${nome}` : "Duplicar");
    sOpcoes.setAttribute("aria-label", nome ? `Opções: ${nome}` : "Opções");
    sApagar.setAttribute("aria-label", nome ? `Apagar: ${nome}` : "Apagar");
  }
  sRodar.addEventListener("click", rodarSelecionado);
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
    planta.elementos.push(c);
    c.divisao = divisaoDoElemento(planta, c);
    selecionado = c.id;
    confirmar(`Duplicado: ${descreverElemento(c)} (ao lado).`);
  }

  // ---------------------------------------------------------------- lista da planta (por baixo dela)
  // Uma linha por divisão do piso visível, com o que tem agrupado por tipo ("3 tomadas", "1 TV"); os
  // elementos fora das divisões no fim (só se houver). Tocar num tipo escolhe o 1.º desse tipo; os toques
  // seguintes passam ao próximo (e voltam ao 1.º).
  const ROTULOS_TIPO = {
    porta: ["porta", "portas"], janela: ["janela", "janelas"], tomada: ["tomada", "tomadas"], luz: ["luz", "luzes"],
    interruptor: ["interruptor", "interruptores"], sensor_movimento: ["sensor de movimento", "sensores de movimento"],
    sensor_porta: ["sensor de porta/janela", "sensores de porta/janela"], quadro: ["quadro elétrico", "quadros elétricos"],
  };
  const ORDEM_TIPOS = ["porta", "janela", "tomada", "luz", "interruptor", "sensor_movimento", "sensor_porta", "quadro", "maquina"];
  function textoGrupo(l) {
    const e = l[0], n = l.length;
    if (e.tipo === "maquina") {
      const nome = e.props.modelo === "televisao" ? "TV" : (MODELOS[e.props.modelo]?.nome ?? "Máquina").toLowerCase();
      return n === 1 ? `1 ${nome}` : `${n} × ${nome}`;
    }
    const r = ROTULOS_TIPO[e.tipo];
    return r ? `${n} ${n === 1 ? r[0] : r[1]}` : `${n} × ${ELEMENTOS[e.tipo].nome}`;
  }
  /** Elementos agrupados por tipo (as máquinas por modelo), pela ordem de ORDEM_TIPOS. */
  function gruposElementos(els) {
    const m = new Map();
    for (const e of els) {
      const k = e.tipo === "maquina" ? `maquina-${e.props.modelo}` : e.tipo;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m].sort((a, b) => ORDEM_TIPOS.indexOf(a[1][0].tipo) - ORDEM_TIPOS.indexOf(b[1][0].tipo)).map(([chave, l]) => ({ chave, els: l }));
  }
  /** Botões dos tipos de uma divisão (ou dos de fora): `onde` entra no nome acessível e no id. */
  function tiposLista(els, onde, idOnde) {
    const caixa = el("div", "lista-tipos");
    caixa.setAttribute("role", "group");
    caixa.setAttribute("aria-label", `Em ${onde}`);
    for (const g of gruposElementos(els)) {
      const texto = textoGrupo(g.els);
      const b = botao("", "chip-tipo");
      b.id = `lista-${idOnde}-${g.chave}`;
      b.append(desenharIcone(svgEl("svg"), g.els[0].tipo, g.els[0].props), el("span", null, texto));
      const k = g.els.findIndex((e) => e.id === selecionado);
      if (k >= 0) b.setAttribute("aria-current", "true");
      b.setAttribute("aria-label", `${texto} em ${onde}${k >= 0 ? ` (escolhido: ${k + 1} de ${g.els.length})` : ""}`);
      b.addEventListener("click", () => {
        const i = g.els.findIndex((e) => e.id === selecionado);
        const e = g.els[(i + 1) % g.els.length];
        selecionado = e.id;
        desenharTudo();
        avisar(`${descreverElemento(e)}${g.els.length > 1 ? ` (${g.els.indexOf(e) + 1} de ${g.els.length})` : ""} — ${onde}. Rodar, Duplicar, Opções e Apagar na barra por cima da planta.`);
      });
      caixa.append(b);
    }
    return caixa;
  }
  function desenharLista() {
    listaConteudo.replaceChildren();
    listaTitulo.textContent = nPisos() > 1 ? `Lista da planta — ${nomePiso(pisoAtual)}` : "Lista da planta";
    const divs = divisoesPiso();
    const fora = elementosPiso().filter((e) => !e.divisao);
    if (!divs.length && !fora.length) {
      listaConteudo.append(el("p", "ajuda", nPisos() > 1 ? "Este piso ainda está vazio." : "A planta ainda está vazia."));
      return;
    }
    const ul = el("ul", "lista-planta");
    for (const d of divs) {
      const li = el("li", "lista-divisao");
      const b = botao("", "item-planta divisao");
      b.id = `lista-${d.id}`;
      const area = m2(areaPoligono(pontosDivisao(d)));
      b.append(el("span", null, d.pontos ? `${d.nome || "Divisão"} — ${area} m² (forma livre)` : `${d.nome || "Divisão"} — ${metros(d.largura_cm)} × ${metros(d.altura_cm)} m`));
      if (selecionado === d.id) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => {
        selecionado = d.id;
        desenharTudo();
        avisar(`${d.nome || "Divisão"} escolhida. Arraste-a na planta; os cantos mudam a forma; Opções abre a janela.`);
      });
      li.append(b);
      const els = planta.elementos.filter((e) => e.divisao === d.id);
      if (els.length) li.append(tiposLista(els, d.nome || "Divisão", d.id));
      else li.append(el("p", "ajuda", "Sem aparelhos."));
      ul.append(li);
    }
    if (fora.length) {
      const li = el("li", "lista-divisao lista-fora");
      li.append(el("span", "item-grupo", "Fora das divisões"), tiposLista(fora, "fora das divisões", "fora"));
      ul.append(li);
    }
    listaConteudo.append(ul);
  }

  function descreverElemento(e) {
    const t = descreverTipo(e);
    return e.nome ? `${e.nome} (${t})` : t;
  }
  function descreverTipo(e) {
    const p = e.props;
    if (e.tipo === "porta") return p.entrada ? "Porta da rua" : "Porta";
    if (e.tipo === "janela") return p.estore ? (p.motorizado ? "Janela com estore motorizado" : "Janela com estore") : "Janela";
    if (e.tipo === "tomada") return p.dupla ? "Tomada dupla" : "Tomada";
    if (e.tipo === "luz") return p.brilho ? "Ponto de luz regulável" : "Ponto de luz";
    if (e.tipo === "interruptor") return `Interruptor de ${p.botoes} ${p.botoes === 1 ? "botão" : "botões"}`;
    if (e.tipo === "maquina") return `${MODELOS[p.modelo]?.nome ?? "Máquina"} (${p.potencia_w} W)`;
    return ELEMENTOS[e.tipo].nome;
  }

  // ---------------------------------------------------------------- janela de edição
  // Edita um rascunho: nada muda na planta até "Guardar" (um só passo de anular). Divisão: nome, o que tem,
  // largura/comprimento (retângulo), área, piso, mover (setas) e a lista de cantos em metros (também para quem
  // não usa o rato); elemento: tipo, rotação, propriedades, mover (setas), distância às paredes e altura.
  let rascunho = null;

  function abrirDialogo({ canto = null } = {}) {
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
      ? { id: d.id, tipo: "divisao", nome: d.nome, pts: pontosDivisao(d), piso: pisoDe(d) }
      : { id: e.id, tipo: "elemento", el: e.tipo, props: { ...e.props }, rot: e.rot, x: e.x_cm, y: e.y_cm, nome: e.nome ?? "", altura: e.altura_cm ?? null, alturaMexida: e.altura_cm !== undefined };
    dlgTitulo.textContent = d ? `Divisão: ${d.nome || "sem nome"}` : descreverElemento(e);
    dApagar.textContent = d ? "Apagar divisão" : "Apagar";
    dRodar.hidden = !e || !ELEMENTOS[e.tipo].roda;
    dlgErro.hidden = true;
    dlgCorpo.replaceChildren();
    if (d) corpoDivisao(canto); else corpoElemento(e);
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

  /**
   * Setas para mover (no rascunho: só muda ao guardar), como as setas do teclado na planta: `passo` em cm;
   * `mover(dx, dy)` desloca e devolve o texto da posição nova (anunciado).
   */
  function setasMover(legenda, passo, mover) {
    const f = el("fieldset", "editor-mover");
    f.append(el("legend", null, legenda));
    const estado = el("p", "ajuda");
    estado.setAttribute("aria-live", "polite");
    const bs = el("div", "form-botoes");
    for (const [s, rot, dx, dy, id] of [["←", "Mover para a esquerda", -1, 0, "esq"], ["→", "Mover para a direita", 1, 0, "dir"], ["↑", "Mover para cima", 0, -1, "cima"], ["↓", "Mover para baixo", 0, 1, "baixo"]]) {
      const b = botao(s, "btn sec pequeno quadrado");
      b.id = `dlg-mover-${id}`;
      b.setAttribute("aria-label", `${rot} ${metros(passo)} m`);
      b.addEventListener("click", () => { estado.textContent = mover(dx * passo, dy * passo); });
      bs.append(b);
    }
    f.append(bs, estado);
    return f;
  }

  function corpoDivisao(canto = null) {
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
          const inp = numeroInput(Number.isFinite(q[j]) ? q[j] / 100 : "", { min: 0, max: MAX_LADO_CM / 100, step: 0.01, id: `dlg-canto-${i}-${k}` });
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
    // O que tem (antes estava no painel ao lado): os aparelhos desta divisão, agrupados ("3 tomadas").
    const els = planta.elementos.filter((x) => x.divisao === r.id);
    const info = el("dl", "editor-info");
    info.append(el("dt", null, "Aparelhos"), el("dd", null, els.length ? `${els.length}: ${gruposElementos(els).map((g) => textoGrupo(g.els)).join(", ")}` : "nenhum (os botões das ferramentas põem-nos no meio dela)"));
    // Mover (setas, 50 cm como na planta): a divisão e os aparelhos dela, ao guardar.
    const mover = setasMover("Mover a divisão (com os aparelhos)", PASSO_DIVISAO, (dx, dy) => {
      if (!valido()) return "Escreva primeiro as coordenadas de todos os cantos.";
      const c = caixaPontos(r.pts);
      const mx = Math.max(-c.x_cm, dx), my = Math.max(-c.y_cm, dy);
      r.pts = r.pts.map(([x, y]) => [x + mx, y + my]);
      desenharCantos();
      const n = caixaPontos(r.pts);
      return `Canto de cima à esquerda a ${metros(n.x_cm)} m da esquerda e ${metros(n.y_cm)} m do topo da planta (muda ao guardar).`;
    });
    // Piso (nos tipos com pisos): mudar leva a divisão e o que está dentro dela para esse piso.
    const extra = [];
    if (nPisos() > 1 || pisosPedidos > 1) {
      const s = document.createElement("select");
      s.id = "dlg-piso";
      for (let p = 0; p < Math.max(nPisos(), pisosPedidos); p++) { const o = document.createElement("option"); o.value = String(p); o.textContent = nomePiso(p); s.append(o); }
      s.value = String(r.piso);
      s.addEventListener("change", () => { r.piso = Number(s.value); });
      extra.push(campo("Piso", s, "A divisão muda de piso com tudo o que está dentro dela."));
    }
    // Os cantos (em metros) numa secção que se abre: abertos numa forma livre ou quando se pediu um canto.
    const secCantos = el("details", "editor-cantos-sec");
    secCantos.open = !eRet() || canto !== null;
    secCantos.append(el("summary", null, eRet() ? "Cantos (para paredes oblíquas)" : "Cantos da divisão"), cantos, bs);
    dlgCorpo.append(campo("Nome", nome), dl, info, dims, area, ...extra, mover, secCantos,
      el("p", "ajuda", "Na planta: arraste um canto para inclinar a parede; duplo clique (ou toque longo) numa parede acrescenta um canto."));
  }

  /**
   * Janela do elemento: nome (etiqueta opcional), o que é (tipo, divisão, potência, circuito), tipo e
   * rotação, as propriedades, a distância às paredes da divisão onde está (mudar move-o) e a altura ao chão
   * (com o valor típico). `e`: o elemento na planta.
   */
  function corpoElemento(e) {
    const r = rascunho;
    const div = e.divisao ? obterDivisao(e.divisao) : null;
    // Distâncias às paredes da esquerda e de cima da divisão (caixa envolvente); fora das divisões, à planta.
    r.ref = div ? { x: div.x_cm, y: div.y_cm } : { x: 0, y: 0 };
    const etiqueta = document.createElement("input");
    etiqueta.id = "dlg-etiqueta";
    etiqueta.maxLength = 60;
    etiqueta.autocomplete = "off";
    etiqueta.value = r.nome;
    etiqueta.placeholder = "Ex.: Interruptor da entrada";
    etiqueta.addEventListener("input", () => { r.nome = etiqueta.value; });
    const info = el("dl", "editor-info");
    const linhaInfo = (t, v) => { if (v) info.append(el("dt", null, t), el("dd", null, v)); };
    linhaInfo("O que é", descreverTipo(e));
    linhaInfo("Divisão", div ? `${div.nome || "sem nome"}${nPisos() > 1 ? ` · ${nomePiso(pisoDe(e))}` : ""}` : "fora das divisões (não conta em nenhuma)");
    if (e.tipo === "maquina") linhaInfo("Potência", `${e.props.potencia_w} W`);
    linhaInfo("Circuito", circuitoDe?.(planta, e) ?? "a definir no passo do quadro");
    const tipo = document.createElement("select");
    tipo.id = "dlg-tipo";
    for (const t of TIPOS_ELEMENTO) { const o = document.createElement("option"); o.value = t; o.textContent = ELEMENTOS[t].nome; tipo.append(o); }
    tipo.value = r.el;
    const rotBox = el("div");
    const propsBox = el("div", "editor-props-campos");
    const x = numeroInput(Math.round(r.x - r.ref.x) / 100, { min: 0, max: planta.largura_cm / 100, step: 0.01, id: "dlg-x" });
    const y = numeroInput(Math.round(r.y - r.ref.y) / 100, { min: 0, max: planta.altura_cm / 100, step: 0.01, id: "dlg-y" });
    x.addEventListener("input", () => { r.x = r.ref.x + lerNumero(x.value) * 100; });
    y.addEventListener("input", () => { r.y = r.ref.y + lerNumero(y.value) * 100; });
    // Altura ao chão: o valor típico do tipo (tomada da cozinha por cima da bancada, luz no teto…).
    const alturaBox = el("div");
    const tipica = () => alturaTipica(r.el, r.props, div ? tipoDoNome(div.nome) : null);
    const desenharAltura = () => {
      alturaBox.replaceChildren();
      const t = tipica();
      if (t === null) { r.altura = null; return; }
      if (!r.alturaMexida) r.altura = t;
      const a = numeroInput(r.altura === null ? "" : r.altura / 100, { min: 0, max: ALTURA_MAX_CM / 100, step: 0.01, id: "dlg-altura-chao" });
      a.addEventListener("input", () => { const v = lerNumero(a.value); r.altura = Number.isFinite(v) ? Math.round(v * 100) : NaN; r.alturaMexida = true; });
      const bt = botao(`Típica: ${metros(t)} m${r.el === "luz" ? " (no teto)" : ""}`);
      bt.id = "dlg-altura-tipica";
      bt.addEventListener("click", () => { r.altura = t; r.alturaMexida = true; a.value = String(t / 100); });
      alturaBox.append(campo("Altura ao chão (m)", a, "Valores típicos: interruptor 1,10 m, tomada 0,30 m (na cozinha, por cima da bancada, 1,10 m), luz no teto."), bt);
    };
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
      propsBox.replaceChildren(...camposElemento(r.el, r.props, (f) => (v) => { f(v); sincronizar(); if (!r.alturaMexida) desenharAltura(); }, "dlg"));
      dRodar.hidden = !ELEMENTOS[r.el].roda;
      desenharAltura();
    };
    tipo.addEventListener("change", () => {
      r.el = tipo.value;
      r.props = propsOmissao(r.el);
      if (!ELEMENTOS[r.el].roda) r.rot = 0;
      desenharTipo();
    });
    desenharTipo();
    const pos = el("fieldset", "editor-posicao");
    pos.append(el("legend", null, div ? `Distância às paredes de "${div.nome || "Divisão"}" (em metros)` : "Posição na planta (em metros)"));
    const duas = el("div", "duas");
    duas.append(campo(div ? "Da parede da esquerda" : "Da esquerda da planta", x), campo(div ? "Da parede de cima" : "Do topo da planta", y));
    pos.append(duas);
    // Setas (10 cm, como as do teclado na planta): mudam as distâncias acima.
    const mover = setasMover("Mover", PASSO_ELEMENTO, (dx, dy) => {
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return "Escreva primeiro a distância às paredes.";
      r.x = limitar(r.x + dx, 0, planta.largura_cm);
      r.y = limitar(r.y + dy, 0, planta.altura_cm);
      x.value = String(Math.round(r.x - r.ref.x) / 100);
      y.value = String(Math.round(r.y - r.ref.y) / 100);
      return `${metros(r.x - r.ref.x)} m da ${div ? "parede da esquerda" : "esquerda"}, ${metros(r.y - r.ref.y)} m ${div ? "da parede de cima" : "do topo"} (muda ao guardar).`;
    });
    dlgCorpo.append(campo("Nome (opcional)", etiqueta, "Para o reconhecer na lista e no orçamento."), info, campo("Tipo", tipo), rotBox, propsBox, pos, mover, alturaBox);
  }

  function guardarDialogo() {
    const r = rascunho;
    if (!r) return;
    if (r.tipo === "divisao") {
      const d = obterDivisao(r.id);
      if (!d) { dialogo.close(); return; }
      const i = r.pts.findIndex((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]));
      if (i >= 0) { erroDialogo(`Escreva as coordenadas do canto ${i + 1} em metros (ex.: 3,5).`, document.getElementById(`dlg-canto-${i}-x`)); return; }
      // Maior do que a folha: a folha cresce (só fica de fora o que passasse os 100 m ou ficasse à esquerda/acima de 0).
      const fora = r.pts.findIndex((q) => q[0] < 0 || q[1] < 0 || q[0] > MAX_LADO_CM || q[1] > MAX_LADO_CM);
      if (fora >= 0) { erroDialogo(`O canto ${fora + 1} fica fora da planta: use 0 a ${metros(MAX_LADO_CM)} m à esquerda e ao topo.`, document.getElementById(`dlg-canto-${fora}-x`)); return; }
      const v = validarPontos(r.pts, MAX_LADO_CM, MAX_LADO_CM);
      if (!v) { erroDialogo(paredesCruzam(r.pts) ? "As paredes cruzam-se: reveja a ordem dos cantos (à volta da divisão)." : "A divisão fica pequena demais (mínimo 0,25 m²) ou tem cantos repetidos."); return; }
      memorizar();
      d.nome = String(r.nome ?? "").trim().slice(0, 60) || "Divisão";
      const cx = caixaPontos(v);
      crescerFolha(cx.x_cm + cx.largura_cm, cx.y_cm + cx.altura_cm);
      const c0 = caixaDe(d), dentroAntes = elementosDentro(d);
      definirPontos(d, v);
      acompanhar(d, c0, dentroAntes);
      // Os elementos de dentro acompanham a divisão; mudar de piso leva-os também, para um sítio livre desse
      // piso (o mesmo, se lá estiver livre): nunca fica por cima de outra divisão (e não lhe tira os aparelhos).
      const dentro = planta.elementos.filter((x) => x.divisao === d.id);
      const outroPiso = r.piso !== pisoDe(d);
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
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) { erroDialogo("Escreva a distância às paredes em metros (ex.: 2,5).", document.getElementById("dlg-x")); return; }
    if (r.altura !== null && !(Number.isFinite(r.altura) && r.altura >= 0 && r.altura <= ALTURA_MAX_CM)) { erroDialogo(`Escreva a altura ao chão em metros (0 a ${metros(ALTURA_MAX_CM)}; ex.: 1,10).`, document.getElementById("dlg-altura-chao")); return; }
    memorizar();
    e.tipo = r.el;
    e.props = { ...r.props };
    e.rot = ELEMENTOS[r.el].roda ? r.rot : 0;
    e.x_cm = Math.round(limitar(r.x, 0, planta.largura_cm));
    e.y_cm = Math.round(limitar(r.y, 0, planta.altura_cm));
    const nome = String(r.nome ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
    if (nome) e.nome = nome; else delete e.nome;
    // Altura ao chão: só se guarda a que o cliente escreveu (sem ela vale a típica, que segue o tipo).
    if (r.altura === null || !r.alturaMexida) delete e.altura_cm; else e.altura_cm = r.altura;
    rascunho = null;
    dialogo.close();
    confirmar(`Guardado: ${descreverElemento(e)}.`);
  }

  dlgForm.addEventListener("submit", (ev) => { ev.preventDefault(); guardarDialogo(); });
  dCancelar.addEventListener("click", () => dialogo.close());
  // Rodar no rascunho (só muda na planta ao guardar).
  dRodar.addEventListener("click", () => {
    const r = rascunho;
    if (r?.tipo !== "elemento" || !ELEMENTOS[r.el].roda) return;
    r.rot = (r.rot + 90) % 360;
    const s = document.getElementById("dlg-rot");
    if (s) s.value = String(r.rot);
  });
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
    desenharPlanta(svg, planta, { selecionado, vista: caixaVista(), raio, raioToque, letra, pega, piso: pisoAtual });
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
  }

  // Os painéis ao lado são refeitos a cada mudança: o foco volta ao mesmo controlo
  // (pelo id, ou pelo texto do rótulo/botão) para quem usa o teclado não o perder.
  function chaveFoco(a) {
    if (!a || !(lado.contains(a) || listaSec.contains(a))) return null;
    if (a.id) return { id: a.id };
    return { texto: (a.closest("label") ?? a).textContent, tag: a.tagName };
  }
  function repor(k) {
    if (!k) return;
    let alvo = k.id ? document.getElementById(k.id) : null;
    if (!alvo && k.texto != null) {
      alvo = [...lado.querySelectorAll(k.tag), ...listaSec.querySelectorAll(k.tag)].find((x) => (x.closest("label") ?? x).textContent === k.texto) ?? null;
    }
    if (alvo && !alvo.disabled) alvo.focus({ preventScroll: true });
  }

  function desenharTudo() {
    const foco = chaveFoco(document.activeElement);
    desenharSeparadores();
    desenhar();
    desenharSelecao();
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
      if (nova) { desfazer = []; refazer = []; selecionado = null; calibracao = null; ultimoToque = null; lerAspeto(); pisoAtual = 0; }
      if (pisoAtual >= nPisos()) pisoAtual = 0;
      if (nova) ajustarFolha();   // plantas antigas com quadrícula vazia à volta ficam à medida
      if (reiniciarVista || nova) verTudo();
      nDivisoesVista = divisoesPiso().length;
      definirModo(null);
      desenharTudo();
    },
    redesenhar: () => desenharTudo(),
    /** N.º de pisos da casa (1 = sem separadores, salvo se a planta já tiver coisas noutros pisos). */
    definirPisos(n) {
      pisosPedidos = Math.min(MAX_PISO + 1, Math.max(1, Math.round(Number(n)) || 1));
      if (planta && pisoAtual >= nPisos()) pisoAtual = 0;
      desenharSeparadores();
    },
    /** Piso visível (0 = r/c). */
    get piso() { return pisoAtual; },
    mudarPiso: (p) => mudarPiso(p),
    /** Botões de divisão para o tipo de imóvel (regras.js tiposDivisaoPara). */
    definirTiposDivisao(lista) {
      if (lista === tiposDivisao) return;
      tiposDivisao = lista;
      desenharBotoesDivisao();
    },
    /** Fila "Máquinas:": um botão por modelo (chaves de regras.js MODELOS), pela ordem dada. */
    definirMaquinas(lista) {
      const l = [...new Set(lista)].filter((m) => MODELOS[m]);
      if (l.join() === modelosMaq.join()) return;
      modelosMaq = l;
      if (modo?.el === "maquina" && !l.includes(modo.modelo)) definirModo(null);
      desenharBotoesMaquina();
    },
    /**
     * "Começar de novo": esquece a planta e tudo o que o editor guarda em memória (anular/refazer, fundo e
     * calibração, seleção, separador de piso, vista, ecrã inteiro, ferramenta escolhida).
     */
    limpar() {
      if (dialogo.open) dialogo.close();
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
      separadores.hidden = true;
      separadores.replaceChildren();
      svg.replaceChildren();
    },
    get planta() { return planta; },
    /** Só para testes/depuração: estado da vista. */
    get vista() { return { ...vista }; },
  };
}
