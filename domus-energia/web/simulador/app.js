// Simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md): 9 passos com a planta ao lado de todos (no passo "Planta", à largura toda), progresso guardado
// no navegador, preço a partir do catálogo público e envio para POST /api/orcamento.
// Todos os textos do cliente e do servidor entram só com textContent.

import {
  TIPOS_CASA, MODELOS,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_PEQUENAS, OBJETIVOS, tipologiaDeQuartos,
  contarPlanta, divisoesDaContagem, sugerirCircuitos, circuitoVazio, numerar,
  plantaTemConteudo, formatarW, FASES,
  perfilCasa, maquinasGrandesDe, modelosDoPerfil, objetivosDe, tiposDivisaoPara,
  TIPOS_COM_PISOS, nomePiso, pisoDe,
} from "./regras.js";
import {
  plantaDaCasa, assinaturaCasa, dicasObjetivos, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO,
  acertarPisos, temPorPiso, resumoPiso, divisoesDaCasa, tipoDivisao, acertarPlantaMexida,
} from "./casa.js";
import {
  pedidosDaSelecao, calcularPreco, planoSugerido, PLANOS, TEXTO_ESTIMATIVA, formatarEuro, formatarEuroRedondo,
  quadroNoPedido, encontrarArtigo, horasTroca, PEDIDOS,
} from "./preco.js";
import {
  SERVICOS, CHAVES_SERVICO, ACOES, ORDEM_BOTOES, MAX_AVARIA, acaoOmissao, soReparacoes, precisaEscolher, temAcao,
  perguntaInteligente, acaoDe, faltaAcao, plantaNovos, pedidoDoElemento, inteligenteDe, plantaInteligentes,
} from "./acoes.js";
import {
  PASSOS, MAX_SIMULACAO, estadoNovo, normalizarEstado, temProgresso, guardarEstado, carregarEstado, apagarEstado,
  lerCodigoCliente, montarSimulacao, montarPedido, problemaContacto, tamanhoSimulacao, potenciaContratada,
  normalizarQuer, fasesSugeridas, POTENCIA_OMISSAO_KVA,
  maquinasParaPlanta, pisosDaCasa, maquinasEscolhidas, quantidadeNoPiso, MAX_QUANTIDADE,
  DIAS_VISITA, PERIODOS_VISITA, URGENCIAS, normalizarVisita,
  PASSO, FUNIS, CHAVES_FUNIL, passosDoFunil, AVARIA_ONDE, AVARIA_PROBLEMA, FOTO_AVARIA, legendaAvaria, normalizarAvaria,
  temCasa, resumoCasa, guardarCasa, carregarCasa, usarCasa, ordemPasso, maisAdiantado,
} from "./estado.js";
import { MELHORIAS, QUADRO_SEGURO, mudarMelhoria, acertarMelhorias, calcularMelhorias } from "./melhorias.js";
import {
  opcoesCircuitos, protecoesDoPacote, pacoteDoQuadro, levaQuadroNovo, pisosDosQuadros, quadroDoPiso, existentesNoQuadroNovo,
} from "./quadro.js";
import { criarEditor } from "./editor.js";
import { guardarPdfOrcamento } from "./imprimir.js";
import { desenharIcone } from "./planta-svg.js";
import { sugerirConcelhos, calcularDeslocacao } from "./deslocacao.js";
import {
  MAX_FOTOS, MAX_BYTES_FOTO, ErroFoto, reduzirFoto, guardarFoto, apagarFoto, lerFotos, limparFotos, novoIdFotos, legendaCabecalho,
} from "./fotos.js";
import { criarBlocoConta, pedirConta, urlPainelApi, credenciais, faixaDemonstracao } from "../conta-comum.js";

const cfg = window.DOMUS ?? {};
const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
// Rotas do painel (/api/orcamento*, /api/catalogo, /api/conta/*): no mesmo site, ou em DOMUS.apiBase (conta-comum.js).
const urlApi = urlPainelApi;
const reduzido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Armazenamento do navegador (pode não existir ou lançar exceções: modo privado, bloqueado).
const armazem = (() => { try { return window.localStorage; } catch { return null; } })();
const sessao = (() => { try { return window.sessionStorage; } catch { return null; } })();
const semArmazem = { getItem: () => null, setItem: () => { throw new Error("sem armazenamento"); }, removeItem: () => {} };

// Números só com zeros são o valor de exemplo do config.js: nesse caso não se mostram (como no resto do site).
const numeroReal = (n) => { const d = String(n ?? "").replace(/^\+/, ""); return /^\d{6,15}$/.test(d) && !/^(351)?9?0+$/.test(d); };

// ------------------------------------------------------------ estado da página
const params = new URLSearchParams(location.search);
const modoCliente = params.get("cliente") === "1";
const codigoCliente = modoCliente ? lerCodigoCliente(sessao ?? semArmazem) : null;
// Índices dos passos (PASSOS e PASSO em estado.js). A planta está ao lado dos passos (#sim-planta), menos no Início e
// na Avaria. Fase 1 (funis): cada caso do Início usa só alguns passos, pela ordem de FUNIS (estado.js).
const P = PASSO;
// Começa sempre no Início. Área de cliente com código ("Ampliar a instalação"): a casa já é conhecida — do Início
// passa-se a "Equipamentos" (a casa fica na barra, para editar).
const PASSO_INICIAL = P.inicio;
const estadoInicial = () => estadoNovo();

let estado = estadoInicial();
let visitado = PASSO_INICIAL; // passo mais adiantado a que o cliente já chegou
let catalogo = undefined;     // undefined = a carregar; null = falhou; array = itens
let configOrc = null;
let aEnviar = false;
let ultimoPreco = null;
let enviado = false;
let dicaPlanta = "";   // "Pusemos a placa na Kitnet — arraste se for noutro sítio." (até à próxima mudança na planta)
let plantaAutoJson = null;   // a planta que desenhámos, como está no editor (para "Anular" até ela voltar a ser a nossa)

const editor = criarEditor($("editor"), {
  aoMudar(p) {
    estado.planta = p;
    estado.plantaSaltada = false;
    // Já não é só a planta que desenhámos: não a refazemos sozinhos — a não ser que "Anular" a tenha deixado outra vez
    // exatamente como a desenhámos (plantaAutoJson).
    estado.plantaAuto = plantaAutoJson !== null && JSON.stringify(p) === plantaAutoJson;
    dicaPlanta = "";
    desenharPlantaOrigem();
    desenharPlantaVazia();
    // Mexeu na planta (em qualquer passo depois de "Equipamentos"): o pedido e os cartões seguem-na.
    if (estado.passo > P.quer) refazerDivisoes(divisaoTocada ? [divisaoTocada] : []);
    if (estado.passo === P.divisoes) desenharDivisoes();
    if (estado.passo === P.trocar) desenharTrocar();
    if (estado.passo === P.melhorias) desenharMelhorias();
    if (estado.passo === P.preco) desenharPreco();
    agendarGravacao();
  },
  // Passos "Divisões" e "Trocar e reparar": a divisão selecionada na planta fica destacada no seu cartão (e vice-versa).
  aoSelecionar: (id) => destacarCartao(id, { rolar: !doCartao }),
  // "Trocar e reparar" (lote 8): o aparelho tocado na planta mostra por baixo dela o que fazer com ele.
  aoSelecionarElemento: (id) => aoTocarAparelho(id),
  // Lote 8: as divisões só mudam nos passos "A casa" e "Planta"; nos outros, a dica leva ao passo Planta.
  aoDivisaoPresa: () => mostrarDivisaoPresa(),
  // Anular/refazer: a mensagem da última ação ("Pusemos a nova tomada no meio de…") deixa de valer; o "Falta
  // verificar…" e o "Marque pelo menos um aparelho avariado…" seguem a planta sozinhos (desenharDivisoes).
  aoHistorico: () => {
    if (estado.passo === P.divisoes) mensagemDivisoes("");
    if (estado.passo === P.trocar && !avisoTrocar) mensagemTrocar("");
  },
});

// Lote 8: o tamanho da planta na linha do título "A sua planta" (saiu do "⋯").
editor.montarTamanho($("planta-tamanho"));
// "Refazer planta" (com confirmação) fica no "⋯" da planta, com Imprimir, Guardar PDF e Planta de fundo.
document.querySelector("#editor-menu")?.append($("planta-refazer"));   // no menu do "⋯"

// ------------------------------------------------------------ gravação
let temporizador = null;
/** Grava 0,3 s depois da última mudança; `planta` (por omissão) também põe a planta do topo a seguir as escolhas. */
function agendarGravacao(planta = true) {
  if (enviado) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(gravar, 300);
  if (planta) agendarPlanta();
}
function gravar() {
  clearTimeout(temporizador);
  temporizador = null;   // sem gravação pendente: ao sair não se grava (outro separador pode ter a mais recente)
  if (enviado) return;
  const r = guardarEstado(armazem ?? semArmazem, estado);
  // A casa (funil "Já tenho a planta") fica guardada à parte assim que a planta da primeira vez está conferida.
  if (estado.funil === "primeira" && (visitado >= P.planta || (fluxoCurto() && visitado >= P.quadro)) && temCasa(estado)) {
    if (guardarCasa(armazem ?? semArmazem, estado)) casaGuardada = carregarCasa(armazem ?? semArmazem);
  }
  $("sim-guardado").textContent = r === "ok" ? "Guardado neste navegador"
    : r === "sem_imagem" ? "Guardado (sem a imagem de fundo, que não coube no navegador)"
      : "Não foi possível guardar neste navegador";
}
addEventListener("pagehide", () => { if (temporizador) gravar(); });

// ------------------------------------------------------------ passos
/** Serviço escolhido (Início); sem nenhum ainda, as contas fazem-se como "Instalação nova" (o preço de sempre). */
const servicos = () => (estado.servico?.length ? estado.servico : ["nova"]);
/** O funil (o caso do Início); sem nenhum escolhido, conta como o da primeira vez (barra e tempos). */
const funil = () => estado.funil ?? "primeira";
const funilAvaria = () => estado.funil === "avaria";
const funilPlanta = () => estado.funil === "planta";
/** Os passos do funil, pela ordem da barra, e a posição de um passo nela (-1 fora do funil). */
const sequencia = () => passosDoFunil(estado.funil);
const posicao = (i) => sequencia().indexOf(i);
/**
 * Só "Reparações / avarias" (primeira vez): fluxo curto — salta "Equipamentos", "Planta" e "Divisões" (as avarias
 * marcam-se em "Trocar e reparar", com a planta ao lado).
 */
const fluxoCurto = () => funil() === "primeira" && soReparacoes(estado.servico);
/** Passos que "não precisa" (barra dos passos; Seguinte/Anterior saltam-nos): Equipamentos, Planta e Divisões no fluxo curto. */
const naoPrecisa = (i) => (i === P.quer || i === P.planta || i === P.divisoes) && fluxoCurto();
/** Na área de cliente a casa já é conhecida: Seguinte/Anterior saltam-na (continua na barra, para editar). */
const saltado = (i) => naoPrecisa(i) || (i === P.casa && !!codigoCliente);
/** O passo seguinte (ou anterior, `d` = −1) do funil que não é saltado. */
function passoAo(de, d) {
  const seq = sequencia();
  let k = seq.indexOf(de);
  if (k < 0) return seq[0];
  k += d;
  while (k > 0 && k < seq.length - 1 && saltado(seq[k])) k += d;
  return seq[Math.max(0, Math.min(seq.length - 1, k))];
}

/**
 * Minutos típicos de cada passo (estado.js FUNIS): só para o cliente saber quanto falta. Primeira vez ~13 min (lote 8);
 * fluxo curto (só reparações) 4 min, sem Equipamentos, Planta nem Divisões; já tenho planta ~4 min; avaria ~2 min.
 */
const MINUTOS_CURTO = [0.5, 0.5, 0, 0, 0.5, 0, 1, 0.5, 1];
const minutosDe = (i) => (naoPrecisa(i) ? 0 : fluxoCurto() ? MINUTOS_CURTO[i] ?? 1 : FUNIS[funil()].minutos[i] ?? 1);
const minTxt = (m) => (m < 1 ? "½" : String(m));
/** Por baixo do nome: "feito" nos passos para trás, "não precisa" nos saltados, o tempo típico nos que faltam. */
const tempoDe = (i) => (naoPrecisa(i) ? "não precisa" : posicao(i) < posicao(estado.passo) ? "feito" : `~${minTxt(minutosDe(i))} min`);
/**
 * Passos da barra a que se pode voltar: os já vistos (na avaria, só os de trás — o passo mais adiantado da primeira vez
 * não conta). O Enviar só pelo "Seguinte".
 */
const chegou = (i) => (funilAvaria() ? posicao(i) < posicao(estado.passo) : ordemPasso(i) <= ordemPasso(visitado));

function desenharProgresso() {
  const ol = $("sim-passos");
  ol.replaceChildren();
  const seq = sequencia();
  const atualPos = posicao(estado.passo);
  seq.forEach((i, k) => {
    const nome = PASSOS[i];
    const li = el("li");
    const atual = i === estado.passo;
    const semPasso = naoPrecisa(i) && !atual;
    if (atual) li.setAttribute("aria-current", "step");
    li.className = atual ? "atual" : semPasso ? "nao-precisa" : k < atualPos ? "feito" : "";
    const num = el("span", "sim-num", String(k + 1));
    num.setAttribute("aria-hidden", "true");
    const tempoTxt = tempoDe(i);
    const tempo = el("span", "sim-passo-tempo", tempoTxt);
    tempo.setAttribute("aria-hidden", "true");
    const extra = tempoTxt === "feito" || semPasso ? ` (${tempoTxt})` : "";
    if (chegou(i) && !atual && !aEnviar && !semPasso) {
      const b = el("button", "sim-passo-botao");
      b.type = "button";
      b.append(num, el("span", "sim-passo-nome", nome), tempo);
      b.setAttribute("aria-label", `Passo ${k + 1}: ${nome}${extra}`);
      // Para lá do Início só com o caso (e, na primeira vez, um serviço) escolhido; para lá de "Trocar e reparar" só
      // com o que fazer a cada aparelho respondido (bloquearTrocar). As Divisões não bloqueiam (é só contar).
      b.addEventListener("click", () => { if (podeIrPara(i)) irPara(i); });
      li.append(b);
    } else {
      // Sem botão (o atual, os que faltam e os que não precisa): o nome acessível vai num texto só para leitores de ecrã
      // (no telemóvel o nome visível esconde-se e o aria-label num <span> não chega a todos os leitores).
      const sp = el("span", "sim-passo-botao");
      const rotulo = `Passo ${k + 1} de ${seq.length}: ${nome}${atual ? " (atual)" : extra || ` (cerca de ${minTxt(minutosDe(i))} min)`}`;
      const nomeVis = el("span", "sim-passo-nome", nome);
      nomeVis.setAttribute("aria-hidden", "true");
      sp.setAttribute("aria-label", rotulo);
      sp.append(num, nomeVis, tempo, el("span", "so-leitor", rotulo));
      li.append(sp);
    }
    ol.append(li);
  });
  ol.style.setProperty("--sim-n-passos", String(seq.length));
  $("sim-barra-cheia").style.width = `${((Math.max(0, atualPos) + 1) / seq.length) * 100}%`;
  // "Faltam cerca de N min" (à direita do título): o passo atual e os seguintes (sem os que não precisa).
  const falta = $("sim-falta");
  const min = Math.ceil(seq.reduce((s, i, k) => s + (k >= atualPos ? minutosDe(i) : 0), 0));
  falta.textContent = aEnviar || estado.passo === P.enviar ? "Último passo." : `Faltam cerca de ${min} min.`;
}

/** Pode ir para o passo `i` pela barra? (os bloqueios dos passos pelo caminho, como no "Seguinte") */
function podeIrPara(i) {
  if (posicao(i) > 0 && bloquearInicio()) return false;
  if (funilAvaria()) return !(i === P.enviar && bloquearAvaria());
  if (i > P.casa && !funilPlanta() && bloquearCasa()) return false;
  return !(i > P.trocar && bloquearTrocar());
}

function irPara(i, { foco = true } = {}) {
  const de = estado.passo;
  // Ao passar de "Equipamentos" para a frente (também a saltar pela barra): planta (se ainda é a nossa), divisões,
  // quadro e termóstatos pré-preenchidos (só o que o cliente ainda não mudou à mão).
  estado.passo = sequencia().includes(i) ? i : sequencia()[0];
  // O passo mais adiantado (a planta vai aparecendo por ele: fasePlanta); a avaria não tem planta e não conta.
  if (!funilAvaria()) visitado = maisAdiantado(visitado, estado.passo);
  estado.visitado = visitado;
  // (Depois de acertar o passo mais adiantado: a planta desenhada já leva os aparelhos, fasePlanta.)
  if (!funilAvaria() && estado.passo > P.quer && de <= P.quer) prepararPassosSeguintes();
  if (estado.passo !== de) editor.limparAviso();   // as mensagens da planta não passam para o passo seguinte
  mostrarPasso(foco);
  agendarGravacao();
  guardarNaConta();   // com sessão: a simulação fica também na conta (retomar noutro aparelho)
}

/** A planta não se vê no Início (o caso ainda não está escolhido) nem na avaria rápida (sem planta). */
const semPlanta = () => estado.passo === P.inicio || funilAvaria();

function mostrarPasso(foco = true) {
  for (let i = 0; i < PASSOS.length; i++) $(`passo-${i}`).hidden = i !== estado.passo;
  $("passo-fim").hidden = true;
  const p = estado.passo;
  // Títulos numerados pela posição no funil ("2. Trocar e reparar" no funil "Já tenho a planta").
  $(`titulo-${p}`).textContent = `${posicao(p) + 1}. ${PASSOS[p]}`;
  const sem = semPlanta();
  if (sem) fecharPlanta({ foco: false });
  $("sim-planta").hidden = sem;
  $("ver-planta").hidden = sem;
  $("sim-form").classList.toggle("sem-planta", sem);
  $("sim-anterior").hidden = p === P.inicio;
  // "Como fazer a simulação": só no Início, por baixo dos cartões (a barra Anterior/Seguinte vem depois).
  $("sim-como").hidden = p !== P.inicio;
  // Passo "Planta" (lote 8): a planta à largura toda, por baixo do título (CSS #sim-form.passo-planta); sem "Ver planta".
  if (p === P.planta) fecharPlanta({ foco: false });
  $("sim-form").classList.toggle("passo-planta", p === P.planta);
  textoSeguinte();
  atualizarPlanta();
  if (p === P.inicio) desenharInicio();
  if (p === P.casa) desenharCasa();
  if (p === P.quer) desenharQuer();
  if (p === P.divisoes) desenharDivisoes();
  if (p === P.quadro) desenharQuadro();
  if (p === P.trocar) desenharTrocar();
  if (p === P.melhorias) desenharMelhorias();
  desenharAcaoPlanta();   // a caixa "o que fazer" por baixo da planta só existe em "Trocar e reparar"
  if (p === P.preco) desenharPreco();
  if (p === P.avaria) desenharAvaria();
  if (p === P.enviar) desenharEnviar();
  desenharProgresso();
  if (foco) {
    const t = $(`titulo-${p}`);
    t.focus({ preventScroll: true });
    // Rola até à barra dos passos (o título vem logo a seguir): "Começar de novo" e os passos ficam inteiros por baixo
    // do topo fixo (scroll-padding-top), nunca meio tapados por ele (um toque ali ia para o topo). No passo Planta
    // (a planta ocupa o ecrã até à barra de baixo) a barra dos passos fica toda escondida por baixo do topo, se a
    // página rolar até lá; senão, fica inteira à vista.
    const comportamento = reduzido() ? "auto" : "smooth";
    const passos = document.querySelector(".sim-progresso:not([hidden])");
    const yEscondida = passos && p === P.planta ? scrollY + passos.getBoundingClientRect().bottom - (document.querySelector(".topo")?.getBoundingClientRect().bottom ?? 0) : null;
    if (yEscondida !== null && yEscondida <= document.documentElement.scrollHeight - innerHeight) scrollTo({ top: yEscondida, behavior: comportamento });
    else (passos ?? t).scrollIntoView({ block: "start", behavior: comportamento });
  }
}

function textoSeguinte() {
  $("sim-seguinte").textContent = estado.passo === P.enviar ? TEXTO_ENVIAR : "Seguinte";
}

/** Os bloqueios de todo o caminho até ao Enviar (o "Seguinte" do Enviar). Devolve true se bloqueou. */
const bloquearTudo = () => bloquearInicio() || (funilAvaria() ? bloquearAvaria() : bloquearCasa() || bloquearTrocar());

$("sim-form").addEventListener("submit", (ev) => ev.preventDefault());
$("sim-anterior").addEventListener("click", () => irPara(passoAo(estado.passo, -1)));
$("sim-seguinte").addEventListener("click", () => {
  if (estado.passo === P.enviar) { if (!bloquearTudo()) enviar(); return; }
  // Do Início só com o caso (e, na primeira vez, um serviço); de "Trocar e reparar" só com o que fazer a cada aparelho
  // respondido (as Divisões são só contar: seguem logo); da Avaria com onde, o que se passa e a foto.
  if (estado.passo === P.inicio && bloquearInicio()) return;
  if (estado.passo === P.casa && bloquearCasa()) return;
  if (estado.passo === P.trocar && bloquearTrocar()) return;
  if (estado.passo === P.avaria && bloquearAvaria()) return;
  irPara(passoAo(estado.passo, 1));
});

// ------------------------------------------------------------ 1. Serviço (lote 7)
// Cartões na horizontal (como os dos equipamentos), escolha múltipla, pelo menos um. O serviço dá a ação por omissão
// de cada aparelho (acoes.js): com "Instalação nova" Novo, senão Manter; só "Reparações / avarias" = fluxo curto.
const ICONES_SERVICO = {
  nova: ["M8 22 24 9l16 13", "M12 19v19h24V19", "M24 24v10M19 29h10"],
  automatizar: ["M17 6h14a2 2 0 0 1 2 2v32a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M21 37h6", "M19 20a7 7 0 0 1 10 0M21.5 23.5a3.5 3.5 0 0 1 5 0"],
  reparar: ["M30 8a8 8 0 0 0-8 10.5L9 31.5a3.5 3.5 0 0 0 5 5L27 23.5A8 8 0 0 0 38 16l-5 5-5-1-1-5 5-5z"],
};
const iconeServico = (k) => {
  const svg = svgNovo();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICONES_SERVICO[k] ?? []) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    for (const [a, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(a, v);
    svg.append(p);
  }
  return svg;
};
// Fase 1 (funis): "Qual é o seu caso?" — 3 cartões (rádio). Primeira vez → os serviços por baixo; "Já tenho a planta"
// → a casa guardada (neste navegador ou na conta), sem ela segue para a primeira vez; avaria → o passo Avaria.
const ICONES_FUNIL = {
  primeira: ICONES_SERVICO.nova,
  planta: ["M8 9h32v30H8z", "M8 24h14M28 9v10M28 27v12M34 24h6"],
  avaria: ["M26 6 12 27h10l-3 15 16-22H24z"],
};
const AJUDA_FUNIL = {
  primeira: "Desenhamos a casa e o que quer instalar.",
  avaria: "Diga o que falhou e mande uma foto.",
};
/** A casa para o funil "Já tenho a planta": a desta simulação (se já tem) ou a guardada. */
let casaGuardada = null;   // estado `soCasa` (estado.js carregarCasa), ou null
const casaParaPlanta = () => (temCasa(estado) && !estado.soCasa ? estado : casaGuardada ?? (temCasa(estado) ? estado : null));
function iconeDe(caminhos) {
  const svg = svgNovo();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of caminhos) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    for (const [a, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(a, v);
    svg.append(p);
  }
  return svg;
}
function montarServico() {
  $("funis").append(...CHAVES_FUNIL.map((k) => {
    const l = escolha("radio", "funil", k, FUNIS[k].nome, AJUDA_FUNIL[k] ?? " ", (sim) => { if (sim) escolherFunil(k); }, iconeDe(ICONES_FUNIL[k]));
    l.id = `funil-${k}`;
    return l;
  }));
  $("servicos").append(...CHAVES_SERVICO.map((k) => escolha("checkbox", `servico-${k}`, k, SERVICOS[k].nome, SERVICOS[k].ajuda, (sim) => {
    const s = new Set(estado.servico);
    if (sim) s.add(k); else s.delete(k);
    mudarServico(CHAVES_SERVICO.filter((x) => s.has(x)));
  }, iconeServico(k))));
}
/**
 * Escolher o caso: a primeira vez e a avaria começam do zero se só havia a casa guardada; "Já tenho a planta" usa a
 * casa (sem ela, passa à primeira vez com um aviso curto). Começou outra simulação: a apagada já não se pode repor.
 */
function escolherFunil(k) {
  acabarAnular();
  mensagemServico(null);
  if (k === "planta") {
    const c = casaParaPlanta();
    if (!c) { k = "primeira"; mensagemServico("Ainda não tem planta guardada: começamos pela casa.", "info"); }
    else {
      usarCasa(estado, c);
      estado.plantaAuto = false;   // a casa guardada nunca é redesenhada sozinha
      visitado = maisAdiantado(visitado, estado.visitado ?? 0, P.planta);
      estado.visitado = visitado;
      acertarPedido();
      pisosEditor = null;
    }
  }
  if (k !== "planta") {
    if (estado.soCasa) { const e = estadoInicial(); e.contacto = estado.contacto; e.melhorias = estado.melhorias; estado = e; visitado = PASSO_INICIAL; }
    estado.funil = k;
    estado.soCasa = false;
  }
  editor.definirAcoes(acaoOmissao(servicos()));
  desenharInicio();
  desenharProgresso();
  agendarGravacao();
}
/** Muda o serviço: a omissão das ações muda (e com ela o pedido: só os Novos entram nos circuitos e nas linhas). */
function mudarServico(lista) {
  acabarAnular();   // começou outra: a apagada já não se pode repor
  estado.servico = lista;
  if (lista.length) mensagemServico(null);
  if (visitado > P.quer) acertarPedido();   // o pedido já foi preparado: segue as ações novas
  editor.definirAcoes(acaoOmissao(servicos()));
  desenharProgresso();
  desenharComo();
  agendarGravacao();
}
function mensagemServico(texto, tipo = "erro") {
  const m = $("servico-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${texto ? tipo : ""}`;
  m.hidden = !texto;
}
/** O Início: os cartões (o da casa guardada destacado), os serviços (primeira vez) e "Como fazer a simulação". */
function desenharInicio() {
  const c = casaParaPlanta();
  const cartao = $("funil-planta");
  cartao.querySelector("small").textContent = c ? `Continuar com a sua casa: ${resumoCasa(c)}` : "Ainda não tem planta guardada.";
  cartao.classList.toggle("sem-casa", !c);
  if (c) cartao.querySelector("input").removeAttribute("aria-disabled"); else cartao.querySelector("input").setAttribute("aria-disabled", "true");
  cartao.classList.toggle("destaque-casa", !!c && !estado.funil);
  for (const i of document.querySelectorAll("#funis input")) i.checked = i.value === estado.funil;
  $("servicos-caixa").hidden = estado.funil !== "primeira";
  for (const i of document.querySelectorAll("#servicos input[type=checkbox]")) i.checked = estado.servico.includes(i.value);
  desenharComo();
}
/**
 * "Como fazer a simulação · ~N min" e os passos numerados do funil escolhido (sem nenhum, os da primeira vez), com as
 * contas da barra: no fluxo curto sem os passos que "não precisa" (os números são os da barra).
 */
function desenharComo() {
  const seq = sequencia();
  $("sim-como-titulo").textContent = `Como fazer a simulação · ~${Math.ceil(seq.reduce((s, i) => s + minutosDe(i), 0))} min`;
  $("sim-como-passos").textContent = seq.map((i, k) => (naoPrecisa(i) ? null : `${k + 1} ${PASSOS[i]}`)).filter(Boolean).join(" · ");
}
/** Sem caso escolhido (ou, na primeira vez, sem serviço): fica (ou volta) no Início com a mensagem. Devolve true se bloqueou. */
function bloquearInicio() {
  const falta = !estado.funil ? "Escolha o seu caso." : estado.funil === "primeira" && !estado.servico.length ? "Escolha pelo menos um serviço." : null;
  if (!falta) return false;
  if (estado.passo !== P.inicio) irPara(P.inicio, { foco: false });
  mensagemServico(falta);
  document.querySelector(estado.funil ? "#servicos input" : "#funis input")?.focus();
  return true;
}

// ------------------------------------------------------------ 2. A casa
/**
 * Tipo de imóvel e tipologia vêm por escolher (decisão do dono). Falta escolher? (Não na área de cliente com código,
 * que salta a casa; um estado antigo sem tipologia mas com o n.º de divisões também já serve.)
 */
const casaPorEscolher = () => !codigoCliente
  && (!estado.casa.tipo || (!negocio() && !estado.casa.tipologia && estado.casa.divisoes == null));
function mensagemCasa(texto) {
  const m = $("casa-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${texto ? "erro" : ""}`;
  m.hidden = !texto;
}
/** Sem tipo ou tipologia: volta (ou fica) no passo "A casa" com a mensagem e o foco no que falta. Devolve true se bloqueou. */
function bloquearCasa() {
  if (!casaPorEscolher()) return false;
  if (estado.passo !== P.casa) irPara(P.casa, { foco: false });
  mensagemCasa("Escolha o tipo de casa e a tipologia.");
  (estado.casa.tipo ? $("casa-tipologias") : $("casa-tipos")).querySelector("input")?.focus();
  return true;
}
/** Botão de escolha (rádio ou sim/não) no estilo .escolha, com texto de ajuda e desenho (por cima do nome) opcionais. */
function escolha(tipo, nome, valor, texto, ajuda, aoMudar, icone = null) {
  const l = el("label", "escolha");
  const i = document.createElement("input");
  i.type = tipo;
  i.name = nome;
  i.value = valor;
  i.addEventListener("change", () => aoMudar(i.checked));
  const s = el("span", null, texto);
  // Com desenho: cartão na horizontal (desenho à esquerda; nome e ajuda à direita; CSS .escolha.com-icone).
  if (icone) { icone.classList.add("escolha-icone"); s.prepend(icone); l.classList.add("com-icone"); }
  if (ajuda) s.append(el("small", null, ajuda));
  l.append(i, s);
  return l;
}
const svgNovo = () => document.createElementNS("http://www.w3.org/2000/svg", "svg");
/** Desenho de uma máquina (o mesmo da planta; aria-hidden: o nome está no botão). */
const iconeMaquina = (k) => desenharIcone(svgNovo(), "maquina", { modelo: k });

// Contadores − n +: [chave, rótulo, ajuda, "Menos …", "Mais …"], todos em estado.casa e na mesma grelha
// (os escondidos não deixam buracos). O dos quartos anda com os botões da tipologia.
const CONTADORES = [
  ["quartos", "Quartos", null, "Menos um quarto", "Mais um quarto"],
  ["espacos", "Espaços", "Divisões, contando casas de banho e arrumos", "Menos um espaço", "Mais um espaço"],
  ["casas_banho", "Casas de banho", null, "Menos uma casa de banho", "Mais uma casa de banho"],
  ["salas", "Salas", null, "Menos uma sala", "Mais uma sala"],
  ["pisos", "Pisos", null, "Menos um piso", "Mais um piso"],
];
const EXTRAS_AJUDA = {};
/** Contadores que, com 2 ou mais pisos, são de cada piso (o separador à vista); os totais da casa são a soma. */
const POR_PISO = ["quartos", "casas_banho", "salas"];
let pisoCasa = 0;   // separador do passo 1 à vista (casas com 2 ou mais pisos; 0 = r/c)
/** Valores por piso da casa (casa.js acertarPisos), ou null com um só piso. */
const porPisoCasa = () => (temPorPiso(estado.casa) && Array.isArray(estado.casa.porPiso) ? estado.casa.porPiso : null);
/** Valores à vista nos contadores e em "A casa tem…": os do piso escolhido, ou os da casa toda. */
const valoresVisiveis = () => porPisoCasa()?.[pisoCasa] ?? estado.casa;
/** A casa dá divisões (tipologia, ou serviços/industrial)? Sem isso (área de cliente) vale a lista antiga. */
const negocio = () => perfilCasa(estado.casa.tipo) !== "habitacao";

// Escolher a tipologia (botão T) repõe sempre os valores típicos da casa toda: quartos, casas de banho e
// salas (com pisos, repartidos pelos pisos: casa.js repartirPisos); os que mudaram ficam destacados.
function mudarTipologia(t) {
  const c = estado.casa;
  const v0 = valoresVisiveis();
  const antes = { quartos: v0.quartos, casas_banho: v0.casas_banho, salas: v0.salas };
  c.tipologia = t;
  c.quartos = t === "T5+" ? Math.min(12, Math.max(5, c.quartos ?? 5)) : quartosDe({ tipologia: t });
  c.casas_banho = casasBanhoOmissao(t);
  c.salas = salasOmissao(t);
  c.porPiso = null;                     // com pisos: os valores típicos repartidos de novo
  acertarPisos(c);
  sincronizarCasa();
  const v = valoresVisiveis();
  for (const k of Object.keys(antes)) if (antes[k] !== v[k]) destacar($(`contador-${k}`));
  agendarGravacao();
}

/**
 * Contador de um piso (quartos, casas de banho ou salas no separador à vista): muda esse piso e os totais da
 * casa (o botão T segue o total de quartos). "A casa tem…" não muda sozinho (nem o corredor).
 */
function mudarNoPiso(k, d) {
  const c = estado.casa;
  const f = c.porPiso[pisoCasa];
  f[k] = Math.max(0, f[k] + d);
  acertarPisos(c);
}

/**
 * Contador dos quartos: muda o botão da tipologia (0 → T0, 1–4 → T1–T4, 5 ou mais → T5+) mas não
 * repõe as casas de banho nem as salas (o cliente está a acertar só os quartos; o botão T repõe tudo).
 */
function mudarQuartos(n) {
  const c = estado.casa;
  c.quartos = n;
  c.tipologia = tipologiaDeQuartos(n);
}

/**
 * Tipo de imóvel: serviços e industrial têm percurso próprio (área e espaços em vez da tipologia);
 * ao mudar de perfil (casa ↔ serviços ↔ industrial) a área e os espaços voltam aos típicos e as
 * máquinas e objetivos que o novo perfil não tem saem da escolha.
 */
function mudarTipo(k) {
  const c = estado.casa;
  const perfilAntes = perfilCasa(c.tipo);
  c.tipo = k;
  if (!TIPOS_COM_PISOS.includes(k)) c.pisos = 1;
  acertarPisos(c);
  const perfil = perfilCasa(k);
  if (perfil !== "habitacao" && (perfil !== perfilAntes || c.area_m2 == null)) {
    c.area_m2 = AREA_OMISSAO[perfil];
    c.espacos = ESPACOS_OMISSAO[perfil];
    $("casa-area").value = String(c.area_m2);
    destacar($("contador-espacos"));
  }
  estado.quer = normalizarQuer(estado.quer, k);
  sugerirLigacao();
  sincronizarCasa();
  agendarGravacao();
}

/** Ligação sugerida pelo tipo e pelas máquinas, enquanto o cliente não a escolheu (fasesEditadas). */
function sugerirLigacao() {
  if (estado.fasesEditadas) return;
  estado.casa.fases = fasesSugeridas(estado);
}
function destacar(caixa) {
  if (!caixa || caixa.hidden) return;
  caixa.classList.remove("destaque");
  void caixa.offsetWidth; // reinicia a animação se já estava destacado
  caixa.classList.add("destaque");
}

function desenharCasa() {
  const g = $("casa-tipos");
  if (!g.childElementCount) {
    for (const [k, nome] of Object.entries(TIPOS_CASA)) g.append(escolha("radio", "casa-tipo", k, nome, null, () => mudarTipo(k)));
    for (const t of TIPOLOGIAS) {
      const l = escolha("radio", "casa-tipologia", t, t, null, (sim) => { if (sim) mudarTipologia(t); });
      // Tocar no botão que já está escolhido também repõe os valores típicos (aí o "change" não chega).
      // O "click" vem antes do "change": num botão novo a tipologia ainda é a antiga e fica só o "change".
      l.querySelector("input").addEventListener("click", () => { if (estado.casa.tipologia === t) mudarTipologia(t); });
      $("casa-tipologias").append(l);
    }
    for (const [k, texto, ajuda, menos, mais] of CONTADORES) {
      const caixa = el("div", "contador");
      caixa.id = `contador-${k}`;
      const rot = el("span", "contador-rotulo", texto);
      rot.id = `contador-${k}-rotulo`;
      const grupo = el("div", "contador-caixa");
      grupo.setAttribute("role", "group");
      grupo.setAttribute("aria-labelledby", `contador-${k}-rotulo`);
      const [min, max] = LIMITES_CASA[k];
      const valor = el("output", "contador-valor");
      valor.id = `contador-${k}-valor`;
      valor.setAttribute("aria-live", "polite");
      const botaoC = (sinal, rotulo, d) => {
        const b = el("button", "btn sec", sinal);
        b.type = "button";
        b.id = `contador-${k}-${d > 0 ? "mais" : "menos"}`;
        b.setAttribute("aria-label", rotulo);
        b.addEventListener("click", () => {
          // Com 2 ou mais pisos, quartos/casas de banho/salas são do piso à vista.
          if (porPisoCasa() && POR_PISO.includes(k)) mudarNoPiso(k, d);
          else {
            const novo = Math.min(max, Math.max(min, (estado.casa[k] ?? min) + d));
            if (k === "quartos") mudarQuartos(novo);
            else estado.casa[k] = novo;
            acertarPisos(estado.casa);   // n.º de pisos mudou: valores típicos em cada piso
          }
          sincronizarCasa();
          agendarGravacao();
        });
        return b;
      };
      grupo.append(botaoC("−", menos, -1), valor, botaoC("+", mais, 1));
      caixa.append(rot);
      if (ajuda) caixa.append(el("small", "ajuda", ajuda));
      caixa.append(grupo);
      // Todos na mesma linha; os pisos encostados à direita (CSS #contador-pisos), por baixo do T5+.
      $("casa-contadores").append(caixa);
    }
    for (const [k, texto] of Object.entries(EXTRAS_CASA)) {
      $("casa-extras").append(escolha("checkbox", `casa-extra-${k}`, k, texto, EXTRAS_AJUDA[k], (sim) => {
        const pp = porPisoCasa();
        if (pp) { pp[pisoCasa].extras[k] = sim; acertarPisos(estado.casa); desenharPisosCasa(); } else estado.casa.extras[k] = sim;
        agendarGravacao();
      }));
    }
  }
  for (const i of g.querySelectorAll("input")) i.checked = i.value === estado.casa.tipo;
  sincronizarCasa();
  $("casa-area").value = estado.casa.area_m2 == null ? "" : String(estado.casa.area_m2);
  $("casa-potencia").value = String(estado.casa.potencia_contratada_kva ?? POTENCIA_OMISSAO_KVA);
}

/** Tipologia (ou área e espaços), contadores, extras e ligação no ecrã a partir do estado. */
function sincronizarCasa() {
  const c = estado.casa;
  const neg = negocio();
  acertarPisos(c);   // valores por piso (2 ou mais pisos) e os totais da casa a partir deles
  acertarQuer();   // menos pisos: as máquinas dos pisos que saíram passam para o último
  const pp = porPisoCasa();
  if (!pp || pisoCasa >= pp.length) pisoCasa = 0;
  const vis = valoresVisiveis();
  const noPiso = pp ? ` no ${nomePiso(pisoCasa)}` : "";
  for (const i of $("casa-tipologias").querySelectorAll("input")) i.checked = i.value === c.tipologia;
  for (const [k, , , menos, mais] of CONTADORES) {
    const [min, max] = LIMITES_CASA[k];
    const dePiso = pp && POR_PISO.includes(k);
    // De um piso: de 0 para cima, sem a casa toda sair dos limites (ex.: pelo menos 1 casa de banho).
    const v = dePiso ? vis[k] : estado.casa[k] ?? min;
    $(`contador-${k}-valor`).textContent = String(v);
    $(`contador-${k}-menos`).disabled = dePiso ? v <= 0 || c[k] - 1 < min : v <= min;
    $(`contador-${k}-mais`).disabled = dePiso ? c[k] + 1 > max : v >= max;
    $(`contador-${k}-menos`).setAttribute("aria-label", `${menos}${dePiso ? noPiso : ""}`);
    $(`contador-${k}-mais`).setAttribute("aria-label", `${mais}${dePiso ? noPiso : ""}`);
  }
  // Serviços e industrial: área e n.º de espaços; casas: tipologia, contadores e extras.
  $("casa-tipologia-caixa").hidden = neg;
  $("casa-extras-caixa").hidden = neg;
  $("casa-negocio").hidden = !neg;
  const casa = !neg && !!c.tipologia;
  for (const [k] of CONTADORES) $(`contador-${k}`).hidden = k === "espacos" ? !neg : !casa;
  // Quartos sempre (anda com a tipologia); no T0 (estúdio) não há salas à parte.
  if (casa) {
    $("contador-salas").hidden = c.tipologia === "T0";
    // Só as moradias têm mais de um piso.
    $("contador-pisos").hidden = !TIPOS_COM_PISOS.includes(c.tipo);
  }
  for (const i of $("casa-extras").querySelectorAll("input")) i.checked = !!vis.extras?.[i.value];
  desenharPisosCasa();
  if (!casaPorEscolher()) mensagemCasa(null);
  $("casa-fases").value = c.fases ?? fasesSugeridas(estado);
  desenharObjetivos();
}
/**
 * Separadores por piso do passo 1 (casas com 2 ou mais pisos; o mesmo estilo dos de "O que quer"): cada um
 * com o nome e um resumo ("2 quartos · 1 WC"); o piso escolhido mostra os seus quartos, casas de banho, salas
 * e "A casa tem…". Role tablist; as setas mudam de piso. Escondidos com um só piso.
 */
function desenharPisosCasa() {
  const pp = porPisoCasa();
  const caixa = $("casa-pisos"), painel = $("casa-painel");
  caixa.hidden = !pp;
  if (!pp) {
    caixa.replaceChildren();
    painel.removeAttribute("role");
    painel.removeAttribute("aria-labelledby");
    return;
  }
  const n = pp.length;
  caixa.replaceChildren(...pp.map((f, p) => {
    const b = el("button", "editor-piso quer-piso");
    b.type = "button";
    b.id = `casa-piso-${p}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(p === pisoCasa));
    b.setAttribute("aria-controls", "casa-painel");
    b.tabIndex = p === pisoCasa ? 0 : -1;
    b.append(el("span", null, nomePiso(p)), el("small", null, resumoPiso(f, estado.casa.tipologia)));
    b.addEventListener("click", () => mudarPisoCasa(p));
    b.addEventListener("keydown", (ev) => {
      const d = { ArrowRight: 1, ArrowLeft: -1, Home: -p, End: n - 1 - p }[ev.key];
      if (d === undefined) return;
      ev.preventDefault();
      mudarPisoCasa((p + d + n) % n);
      $(`casa-piso-${pisoCasa}`)?.focus();
    });
    return b;
  }));
  painel.setAttribute("role", "tabpanel");
  painel.setAttribute("aria-labelledby", `casa-piso-${pisoCasa}`);
}
function mudarPisoCasa(p) {
  if (p === pisoCasa) return;
  pisoCasa = p;
  sincronizarCasa();
}

$("casa-potencia").addEventListener("change", () => { estado.casa.potencia_contratada_kva = potenciaContratada($("casa-potencia").value) ?? POTENCIA_OMISSAO_KVA; agendarGravacao(); });
$("casa-fases").addEventListener("change", () => { const v = $("casa-fases").value; estado.casa.fases = FASES[v] ? v : null; estado.fasesEditadas = true; agendarGravacao(); });
$("casa-area").addEventListener("input", () => {
  const v = Math.round(Number($("casa-area").value));
  const [min, max] = LIMITES_CASA.area_m2;
  if (Number.isFinite(v) && v >= min && v <= max) { estado.casa.area_m2 = v; agendarGravacao(); }
});
$("casa-area").addEventListener("change", () => {
  // Fora dos limites (ou vazio): volta ao último valor válido.
  $("casa-area").value = String(estado.casa.area_m2 ?? AREA_OMISSAO[perfilCasa(estado.casa.tipo)] ?? "");
});

/**
 * Sugestões dos 308 concelhos enquanto escreve (combobox ARIA com lista; sem acentos: "evora" → Évora).
 * Aceita texto livre (freguesia, aldeia): as sugestões só ajudam. Escolher uma = escrever o nome e
 * disparar "input" (os ouvintes de cada campo guardam o valor).
 */
function ligarLocalidade(input) {
  const rotulo = input.closest("label");
  const caixa = el("div", "sugestoes-caixa");
  const lista = el("ul", "sugestoes");
  lista.id = `${input.id}-sugestoes`;
  lista.setAttribute("role", "listbox");
  lista.setAttribute("aria-label", "Concelhos sugeridos");
  lista.hidden = true;
  rotulo.before(caixa);
  caixa.append(rotulo, lista); // a lista fica fora do <label> (não entra no nome do campo)
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", lista.id);
  input.autocomplete = "off"; // senão o preenchimento automático do navegador tapa a lista
  let ativo = -1;
  const opcoes = () => [...lista.children];
  const fechar = () => { lista.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); ativo = -1; };
  const marcar = (i) => {
    const os = opcoes();
    ativo = i;
    os.forEach((o, j) => o.setAttribute("aria-selected", String(j === i)));
    if (os[i]) { input.setAttribute("aria-activedescendant", os[i].id); os[i].scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  };
  const escolher = (nome) => {
    input.value = nome;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fechar();
  };
  const abrir = () => {
    const s = sugerirConcelhos(input.value);
    // Já escrito por inteiro (ex. escolhido antes): não volta a abrir só com o próprio nome.
    if (!s.length || (s.length === 1 && s[0].nome === input.value.trim())) { fechar(); return; }
    lista.replaceChildren(...s.map((c, i) => {
      const li = el("li");
      li.id = `${lista.id}-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.append(el("span", null, c.nome), el("small", null, c.distrito));
      li.addEventListener("pointerdown", (e) => e.preventDefault()); // o campo não perde o foco
      li.addEventListener("click", () => escolher(c.nome));
      return li;
    }));
    lista.hidden = false;
    input.setAttribute("aria-expanded", "true");
    marcar(-1);
  };
  input.addEventListener("input", (e) => { if (e.isTrusted) abrir(); });
  input.addEventListener("blur", fechar);
  input.addEventListener("keydown", (e) => {
    const n = opcoes().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (lista.hidden) { abrir(); if (lista.hidden) return; }
      e.preventDefault();
      const m = opcoes().length;
      marcar(e.key === "ArrowDown" ? (ativo + 1) % m : (ativo <= 0 ? m - 1 : ativo - 1));
    } else if (e.key === "Enter" && !lista.hidden && ativo >= 0 && ativo < n) {
      e.preventDefault();
      escolher(opcoes()[ativo].firstChild.textContent);
    } else if (e.key === "Escape" && !lista.hidden) {
      e.preventDefault();
      fechar();
    }
  });
}

// ------------------------------------------------------------ 2. Equipamentos (e "O que quer fazer", no fim do passo 1)
const OBJETIVOS_AJUDA = {
  poupar: "Ver quanto gasta cada parte da casa",
  alarme: "Sensores de porta e de movimento",
  estores: "Abrir e fechar pelo telemóvel ou a horas",
  luzes: "Interruptores inteligentes",
  distancia: "Ver e ligar a casa quando não está",
  clima: "Termóstato Wi-Fi",
  horarios: "Luzes e máquinas ligam e desligam a horas",
  iluminacao_auto: "Sensores de movimento acendem as luzes",
  energia: "Ver quanto gasta cada parte do espaço",
  desligar: "Um toque desliga o que ficou ligado",
};
/** Desenhos simples dos objetivos (traço, como os da planta: viewBox 48, planta-svg.js desenharIcone). */
const ICONES_OBJETIVO = {
  poupar: ["M12 36C12 20 22 12 38 12c0 16-8 26-24 24z", "M12 36l14-14"],
  alarme: ["M24 7l14 5v10c0 9-6 16-14 19-8-3-14-10-14-19V12z", "M24 18v8", "M24 31v.5"],
  estores: ["M9 8h30", "M12 8v32h24V8", "M12 15h24M12 21h24M12 27h24", "M24 31v5"],
  luzes: ["M18 30c-3-3-5-6-5-10a11 11 0 0 1 22 0c0 4-2 7-5 10v4H18z", "M19 39h10M21 43h6"],
  distancia: ["M16 8h12a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M20 35h4", "M35 17a7 7 0 0 1 0 10M39 13a13 13 0 0 1 0 18"],
  clima: ["M20 28V10a3 3 0 0 1 6 0v18a6 6 0 1 1-6 0z", "M23 22v10", "M31 12h6M31 18h6M31 24h4"],
  horarios: ["M24 9a15 15 0 1 1 0 30a15 15 0 1 1 0-30z", "M24 16v8l6 4"],
  iluminacao_auto: ["M19 30c-2.5-2.5-4-5-4-8a9 9 0 0 1 18 0c0 3-1.5 5.5-4 8v4H19z", "M20 38h8", "M38 15a11 11 0 0 1 0 14M10 15a11 11 0 0 0 0 14"],
  energia: ["M27 6L13 27h10l-2 15 14-21H25z"],
  desligar: ["M24 8v14", "M15 13a14 14 0 1 0 18 0"],
};
function iconeObjetivo(k) {
  const d = ICONES_OBJETIVO[k];
  if (!d) return null;
  const svg = svgNovo();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const x of d) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", x);
    for (const [a, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" })) p.setAttribute(a, v);
    svg.append(p);
  }
  return svg;
}
const quer = (k) => estado.quer.objetivos.includes(k);
let pisoQuer = 0;   // separador de "O que quer" à vista (casas com mais de um piso; 0 = r/c)

/** Máquinas de "O que quer" a partir de `porPiso` (listas e totais), com os pisos da casa (estado.js normalizarQuer). */
function acertarQuer() {
  estado.quer = normalizarQuer(estado.quer, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) });
}

/**
 * Máquinas grandes, pequenas (por grupos, cada uma com o seu desenho) e objetivos do perfil do imóvel (casa,
 * serviços ou industrial): refeitos quando o perfil muda. As máquinas mudam a ligação sugerida (carregador de
 * 22 kW → trifásica). Nas casas com mais de um piso há um separador por piso ("Piso 0 (r/c)", "Piso 1"…):
 * em cada um marcam-se as máquinas desse piso e quantas (− n +); por baixo, o total da casa. Tocar numa
 * máquina marca-a ou desmarca-a nesse piso. A planta desenhada põe-nas nesses pisos (casa.js plantaDaCasa).
 * Os objetivos são da casa toda.
 */
function desenharQuer() {
  const gm = $("quer-maquinas"), gp = $("quer-pequenas");
  const perfil = perfilCasa(estado.casa.tipo);
  const n = pisosDaCasa(estado.casa);
  if (pisoQuer >= n) pisoQuer = 0;
  if (gm.dataset.perfil !== perfil) {
    gm.dataset.perfil = perfil;
    // Marcada no piso à vista: 1 (o cliente muda no contador); desmarcada: sai desse piso.
    const alternarMaquina = (k) => (sim) => {
      const m = { ...(estado.quer.porPiso[k] ?? {}) };
      if (sim) m[pisoQuer] = m[pisoQuer] || 1; else delete m[pisoQuer];
      estado.quer.porPiso = { ...estado.quer.porPiso, [k]: m };
      acertarQuer();
      sugerirLigacao();
      desenharExtraQuer(k);
      desenharPisosQuer();
      agendarGravacao();
    };
    const maquina = (lista) => (k) => {
      const caixaM = el("div", "quer-item");
      caixaM.dataset.maquina = k;
      const extra = el("div", "quer-extra");
      extra.id = `quer-extra-${k}`;
      extra.hidden = true;
      // O contador fica dentro do cartão, em baixo à direita (CSS .quer-item > .quer-extra); vem depois na ordem do Tab.
      caixaM.append(escolha("checkbox", `quer-${lista}-${k}`, k, MODELOS[k].nome, `cerca de ${formatarW(MODELOS[k].w)}`, alternarMaquina(k), iconeMaquina(k)), extra);
      return caixaM;
    };
    const grandes = maquinasGrandesDe(estado.casa.tipo);
    gm.replaceChildren(...grandes.map(maquina("maquinas")));
    gp.replaceChildren(...MAQUINAS_PEQUENAS[perfil].map(([titulo, chaves]) => {
      const f = el("fieldset", "escolhas quer-grupo");
      f.append(el("legend", null, titulo));
      const grelha = el("div", "escolhas-grelha");
      grelha.append(...chaves.map(maquina("pequenas")));
      f.append(grelha);
      return f;
    }));
  }
  for (const i of [...gm.querySelectorAll("input[type=checkbox]"), ...gp.querySelectorAll("input[type=checkbox]")]) i.checked = quantidadeNoPiso(estado.quer, i.value, pisoQuer) > 0;
  for (const c of document.querySelectorAll(`#passo-${P.quer} .quer-item`)) desenharExtraQuer(c.dataset.maquina);
  desenharPisosQuer();
}

/** "O que quer fazer" (no passo Resumo, decisão do dono; antes no fim do passo 1): os objetivos do perfil do imóvel, da casa toda; refeitos quando o perfil muda. */
function desenharObjetivos() {
  const go = $("quer-objetivos");
  const perfil = perfilCasa(estado.casa.tipo);
  if (go.dataset.perfil !== perfil) {
    go.dataset.perfil = perfil;
    const objs = objetivosDe(estado.casa.tipo);
    const alternarObjetivo = (k) => (sim) => {
      const s = new Set(estado.quer.objetivos);
      if (sim) s.add(k); else s.delete(k);
      estado.quer.objetivos = objs.filter((x) => s.has(x));   // sempre pela ordem da lista
      // "Luzes pelo telemóvel" (interruptores novos inteligentes) e "Poupar energia" (medição) mudam o pedido.
      if (visitado > P.quer) refazerDivisoes();
      agendarGravacao();
      if (estado.passo === P.preco) desenharPreco();   // o plano sugerido segue os objetivos
    };
    go.replaceChildren(...objs.map((k) => escolha("checkbox", `quer-objetivo-${k}`, k, OBJETIVOS[k], OBJETIVOS_AJUDA[k], alternarObjetivo(k), iconeObjetivo(k))));
  }
  for (const i of go.querySelectorAll("input[type=checkbox]")) i.checked = estado.quer.objetivos.includes(i.value);
}

/** "r/c", "piso 1"… (resumo de "O que quer"). */
const pisoCurto = (p) => (p > 0 ? `piso ${p}` : "r/c");

/**
 * Separadores por piso de "O que quer" (role tablist; as setas mudam de piso), cada um com o n.º de máquinas
 * desse piso, e o resumo com o total da casa. Escondidos numa casa de um só piso.
 */
function desenharPisosQuer() {
  const n = pisosDaCasa(estado.casa);
  const caixa = $("quer-pisos"), resumo = $("quer-resumo"), painel = $("quer-painel");
  caixa.hidden = n <= 1;
  resumo.hidden = n <= 1;
  if (n <= 1) {
    caixa.replaceChildren();
    painel.removeAttribute("role");
    painel.removeAttribute("aria-labelledby");
    return;
  }
  const q = estado.quer;
  const chaves = [...q.maquinas, ...q.pequenas];
  caixa.replaceChildren(...Array.from({ length: n }, (_, p) => {
    const nm = chaves.reduce((s, k) => s + quantidadeNoPiso(q, k, p), 0);
    const b = el("button", "editor-piso quer-piso");
    b.type = "button";
    b.id = `quer-piso-${p}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(p === pisoQuer));
    b.setAttribute("aria-controls", "quer-painel");
    b.tabIndex = p === pisoQuer ? 0 : -1;
    b.append(el("span", null, nomePiso(p)), el("small", null, `${nm} ${nm === 1 ? "máquina" : "máquinas"}`));
    b.addEventListener("click", () => mudarPisoQuer(p));
    b.addEventListener("keydown", (ev) => {
      const d = { ArrowRight: 1, ArrowLeft: -1, Home: -p, End: n - 1 - p }[ev.key];
      if (d === undefined) return;
      ev.preventDefault();
      mudarPisoQuer((p + d + n) % n);
      $(`quer-piso-${pisoQuer}`)?.focus();
    });
    return b;
  }));
  painel.setAttribute("role", "tabpanel");
  painel.setAttribute("aria-labelledby", `quer-piso-${pisoQuer}`);
  const partes = chaves.map((k) => {
    const total = q.quantidades[k] ?? 0;
    const pisos = Object.keys(q.porPiso[k] ?? {}).map(Number).sort((a, b) => a - b);
    const onde = pisos.map((p) => (pisos.length > 1 ? `${pisoCurto(p)}: ${q.porPiso[k][p]}` : pisoCurto(p))).join(" · ");
    return `${total > 1 ? `${total} × ` : ""}${MODELOS[k].nome.toLowerCase()} (${onde})`;
  });
  resumo.textContent = partes.length ? `Na casa toda: ${partes.join(", ")}.` : "Na casa toda: ainda não escolheu máquinas.";
}

function mudarPisoQuer(p) {
  if (p === pisoQuer) return;
  pisoQuer = p;
  desenharQuer();
}

/** Quantidade (− n +) de uma máquina marcada em "O que quer", no piso à vista; escondido se não está marcada nele. */
function desenharExtraQuer(k) {
  const extra = $(`quer-extra-${k}`);
  if (!extra) return;
  const qtd = quantidadeNoPiso(estado.quer, k, pisoQuer);
  extra.hidden = qtd <= 0;
  extra.replaceChildren();
  if (qtd <= 0) return;
  const nome = MODELOS[k].nome;
  const noPiso = pisosDaCasa(estado.casa) > 1 ? ` no ${nomePiso(pisoQuer)}` : "";
  const grupo = el("div", "contador-caixa");
  grupo.setAttribute("role", "group");
  grupo.setAttribute("aria-label", `Quantas${noPiso}: ${nome}`);
  const valor = el("output", "contador-valor", String(qtd));
  valor.id = `quer-qtd-${k}`;
  valor.setAttribute("aria-live", "polite");
  const botaoQ = (sinal, rot, d) => {
    const b = el("button", "btn sec", sinal);
    b.type = "button";
    b.id = `quer-qtd-${k}-${d > 0 ? "mais" : "menos"}`;
    b.setAttribute("aria-label", `${rot}${noPiso}: ${nome}`);
    b.disabled = d > 0 ? qtd >= MAX_QUANTIDADE : qtd <= 1;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();   // o − e o + não escolhem nem retiram a máquina (o cartão é o <label> ao lado)
      estado.quer.porPiso = { ...estado.quer.porPiso, [k]: { ...estado.quer.porPiso[k], [pisoQuer]: Math.min(MAX_QUANTIDADE, Math.max(1, qtd + d)) } };
      acertarQuer();
      agendarGravacao();
      desenharExtraQuer(k);
      desenharPisosQuer();
      // No mínimo (1) ou no máximo o botão carregado fica desativado: o foco passa para o outro (não cai no body).
      const mesmo = $(`quer-qtd-${k}-${d > 0 ? "mais" : "menos"}`);
      (mesmo && !mesmo.disabled ? mesmo : $(`quer-qtd-${k}-${d > 0 ? "menos" : "mais"}`))?.focus();
    });
    return b;
  };
  grupo.append(botaoQ("−", "Menos uma", -1), valor, botaoQ("+", "Mais uma", 1));
  extra.append(grupo);
}

/**
 * Botões da fila "Máquinas:" do editor: nas casas a TV e o frigorífico, as máquinas grandes do tipo de
 * imóvel, as que o cliente escolheu em "O que quer" e "Outra".
 */
const maquinasEditor = () => [
  ...(perfilCasa(estado.casa.tipo) === "habitacao" ? ["televisao", "frigorifico"] : []),
  ...maquinasGrandesDe(estado.casa.tipo), ...maquinasEscolhidas(estado.quer), ...modelosDoPerfil(estado.casa.tipo),
];

/**
 * Linha das ferramentas do editor (decisão do dono): os botões de divisão dos tipos que a casa tem (as divisões do
 * passo 1 e as da planta; a kitnet conta como sala e cozinha), as máquinas escolhidas no passo 2. O resto fica em
 * "Mais…". Sem nenhuma divisão (área de cliente sem tipologia), os 4 primeiros (Sala, Quarto, Cozinha, Casa de banho).
 */
function divisoesDaBarra() {
  const tipos = new Set();
  const nomes = [...(casaDaDivisoes() ? divisoesDaCasa(estado.casa, maquinasParaPlanta(estado)).map((d) => d.nome) : []), ...(estado.planta?.divisoes ?? []).map((d) => d.nome)];
  for (const n of nomes) {
    const t = tipoDivisao(n);
    if (t === "sala_cozinha") { tipos.add("sala"); tipos.add("cozinha"); } else tipos.add(t);
  }
  const todos = tiposDivisaoPara(estado.casa.tipo);
  const l = todos.filter((t) => t.nome !== "Outra" && tipos.has(tipoDivisao(t.nome))).map((t) => t.nome);
  return l.length ? l : todos.slice(0, 4).map((t) => t.nome);   // sem divisões (área de cliente): as 4 primeiras
}
function ferramentasEditor() {
  editor.definirTiposDivisao(tiposDivisaoPara(estado.casa.tipo), divisoesDaBarra());
  editor.definirMaquinas(maquinasEditor(), modelosDoPerfil(estado.casa.tipo), maquinasEscolhidas(estado.quer));
}

// ------------------------------------------------------------ Planta no topo (pré-desenhada) — docs §1.1, §2
const assinaturaBase = () => assinaturaCasa(estado.casa, maquinasParaPlanta(estado));
/** A casa dá divisões? (tipologia, ou serviços/industrial; na área de cliente sem tipologia não.) */
const casaDaDivisoes = () => !!estado.casa.tipologia || negocio();

/**
 * Planta já desenhada a partir da casa e das máquinas (casa.js plantaDaCasa): quando está vazia, ou
 * quando ainda é a que desenhámos (o cliente não lhe mexeu) e a casa ou as máquinas mudaram. Uma planta em que o
 * cliente mexeu nunca é redesenhada: acrescenta-se ou tira-se só o que mudou (acertarMexida). Sem tipologia (área de
 * cliente com o passo 1 saltado) desenha a que a casa dá (a mesma que o passo Divisões mostra), logo ao entrar.
 */
function preencherPlanta() {
  const tem = plantaTemConteudo(estado.planta);
  if (tem && !estado.plantaAuto) return acertarMexida();
  if (tem && estado.plantaBase === assinaturaBase() && estado.plantaFase === fasePlanta()) return false;
  if (!tem && !plantaDaFaseTemAlgo()) return false;   // ainda não há nada a desenhar (planta vazia com o texto)
  desenharDaCasa();
  return true;
}
/**
 * O que a planta da fase `f` tem da casa e das máquinas (o mesmo que desenharDaCasa desenha): as divisões da casa
 * (sem o "Exterior" que as máquinas acrescentam) e, com os aparelhos, as máquinas escolhidas.
 */
function sincAtual(f = fasePlanta()) {
  const comDivisoes = f === "tudo" || (f === "divisoes" && casaDaDivisoes());
  return {
    divisoes: comDivisoes ? divisoesDaCasa(estado.casa, []).map((d) => ({ nome: d.nome, piso: d.piso ?? 0 })) : [],
    maquinas: f === "tudo" ? maquinasParaPlanta(estado).map((m) => ({ modelo: m.modelo, qtd: m.qtd, piso: m.piso })) : [],
    fase: f,
  };
}
/**
 * Planta em que o cliente mexeu (decisão do dono): a casa ou as máquinas mudaram → acrescenta ou tira só essa divisão
 * ou essa máquina (casa.js acertarPlantaMexida); o resto fica como o cliente o deixou. Estados sem `plantaSinc`: se
 * nada mudou desde a planta desenhada, passa a ser o que ela tem; senão conta o que a planta já tem de cada coisa (só
 * acrescenta o que falta). A dica ("Pusemos a placa na Kitnet — arraste…") aparece na cabeça da planta.
 */
function acertarMexida() {
  if (!plantaDaFaseTemAlgo()) return false;
  const depois = sincAtual();
  let antes = estado.plantaSinc;
  if (!antes) {
    // Planta desenhada à mão antes de haver o que desenhar (sem plantaBase e ainda na fase "vazia"): não tem nada da
    // casa — conta o que já tem (o Quarto feito à mão) e acrescenta só as divisões que faltam.
    const aMaoDoZero = !estado.plantaBase && estado.plantaFase === "vazia";
    if (!aMaoDoZero && (!estado.plantaBase || (estado.plantaBase === assinaturaBase() && estado.plantaFase === depois.fase))) {
      estado.plantaSinc = depois;
      return false;
    }
    const p = estado.planta;
    const conta = (f) => { const m = new Map(); for (const x of p.divisoes) { const k = f(x); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
    const nDiv = conta((d) => `${tipoDivisao(d.nome)}|${pisoDe(d)}`);
    const nMaq = (m) => p.elementos.filter((e) => e.tipo === "maquina" && e.props?.modelo === m.modelo && (m.piso === null || pisoDe(e) === m.piso)).length;
    antes = {
      divisoes: depois.divisoes.filter((d) => { const k = `${tipoDivisao(d.nome)}|${d.piso}`; const n = nDiv.get(k) ?? 0; nDiv.set(k, n - 1); return n > 0; }),
      maquinas: estado.plantaFase === "tudo" ? depois.maquinas.map((m) => ({ ...m, qtd: Math.min(m.qtd, nMaq(m)) })) : [],
      fase: estado.plantaFase,
    };
  }
  if (JSON.stringify(antes) === JSON.stringify(depois)) return false;
  const p = structuredClone(estado.planta);
  const dicas = acertarPlantaMexida(p, antes, depois, { casa: estado.casa });
  estado.planta = p;
  estado.plantaSinc = depois;
  estado.plantaBase = assinaturaBase();
  estado.plantaFase = depois.fase;
  dicaPlanta = dicas.join(" ");
  return true;
}

/**
 * A planta vai aparecendo (decisão do dono): vazia no "Serviço"; no "A casa" só as divisões (paredes e nomes), quando
 * já há tipologia (ou tipo de serviços/industrial); de "Equipamentos" em diante (o passo mais adiantado a que chegou)
 * as portas, interruptores, luzes, tomadas e máquinas. Na área de cliente com código (o passo "A casa" é saltado) é
 * sempre a planta toda, como antes.
 */
const fasePlanta = () => (codigoCliente || visitado > P.casa ? "tudo" : visitado === P.casa ? "divisoes" : "vazia");
const plantaDaFaseTemAlgo = () => { const f = fasePlanta(); return f === "tudo" || (f === "divisoes" && casaDaDivisoes()); };
function desenharDaCasa() {
  const p = plantaDaCasa(estado.casa, maquinasParaPlanta(estado));
  const f = fasePlanta();
  if (f !== "tudo") p.elementos = [];
  if (f === "vazia" || (f === "divisoes" && !casaDaDivisoes())) p.divisoes = [];
  estado.planta = p;
  estado.plantaAuto = true;
  estado.plantaBase = assinaturaBase();
  estado.plantaFase = f;
  estado.plantaSinc = sincAtual(f);
  dicaPlanta = "";
}
/** Planta vazia antes de haver o que desenhar: "A sua planta aparece aqui à medida que responde." */
function desenharPlantaVazia() {
  $("planta-vazia").hidden = plantaTemConteudo(estado.planta) || plantaDaFaseTemAlgo();
}

/**
 * A planta do topo segue as escolhas de cada passo (decisão do dono): chamada por agendarGravacao (0,15 s depois da
 * última mudança, não a cada tecla) e ao mostrar um passo. Redesenha-a só se ainda é a nossa (preencherPlanta); acerta
 * as ferramentas (divisões da casa, máquinas escolhidas), os pisos e a dica da planta (desenharPlantaOrigem). Depois de
 * "Equipamentos", uma planta redesenhada refaz também o pedido (acertarPedido).
 */
let temporizadorPlanta = null;
let pisosEditor = null;   // n.º de pisos já dado ao editor (definirPisos refaz os separadores)
function agendarPlanta() {
  clearTimeout(temporizadorPlanta);
  temporizadorPlanta = setTimeout(atualizarPlanta, 150);
}
function atualizarPlanta() {
  clearTimeout(temporizadorPlanta);
  temporizadorPlanta = null;
  if (enviado || funilAvaria()) return;   // a avaria rápida não tem planta
  const redesenhada = preencherPlanta();
  if (redesenhada && estado.passo > P.quer) acertarPedido();
  ferramentasEditor();
  // Marcas M/R/S/N na planta: as que não são a ação do serviço; em "Trocar e reparar" (lote 8) em todos os aparelhos
  // (sem "Instalação nova", só nos que já têm a ação escolhida).
  editor.definirAcoes(acaoOmissao(servicos()), { todas: estado.passo === P.trocar, escolher: precisaEscolher(servicos()), nomes: NOMES_ACOES });
  // Lote 8: o que se pode mudar na planta em cada passo — as divisões só em "A casa" e "Planta"; os aparelhos
  // escondidos em "A casa" (e no "Serviço" enquanto a planta ainda não os mostra).
  editor.definirPermissoes({
    divisoes: estado.passo === P.casa || estado.passo === P.planta,
    aparelhos: estado.passo !== P.casa && (estado.passo !== P.inicio || fasePlanta() === "tudo"),
  });
  if (estado.passo === P.casa || estado.passo === P.planta) $("planta-presa").hidden = true;
  const n = pisosDaCasa(estado.casa);
  if (n !== pisosEditor) { pisosEditor = n; editor.definirPisos(n); }
  if (editor.planta !== estado.planta) editor.abrir(estado.planta, { reiniciarVista: true });
  plantaAutoJson = estado.plantaAuto ? JSON.stringify(estado.planta) : plantaAutoJson;
  desenharPlantaOrigem();
  desenharPlantaVazia();
  if (redesenhada) {
    agendarGravacao(false);
    if (estado.passo === P.divisoes) desenharDivisoes();
    if (estado.passo === P.trocar) desenharTrocar();
  }
}

/** O cliente mexeu na planta (há o que refazer a partir da casa)? */
const plantaMexida = () => !estado.plantaAuto && plantaTemConteudo(estado.planta) && plantaDaFaseTemAlgo();

/**
 * Cabeça da planta: a dica da última máquina posta fora da divisão certa ("Pusemos a placa na Kitnet — arraste se for
 * noutro sítio."). Decisão do dono: saiu o aviso "Mudou a casa ou as máquinas…"; "Refazer planta" fica no "⋯" (com
 * confirmação) sempre que a planta foi mexida.
 */
function desenharPlantaOrigem() {
  const o = $("planta-origem");
  o.hidden = !dicaPlanta;
  o.textContent = dicaPlanta;
  o.title = dicaPlanta;
  $("planta-refazer").hidden = !plantaMexida();
}

/*
 * Onde está a planta (decisão do dono): no computador (≥ 1024 px) na coluna da direita, sempre à vista (CSS); no
 * telemóvel e no tablet abre-se por cima das perguntas, em ecrã inteiro ("Ver planta", ou o "+" das Divisões), como
 * uma janela: foco preso nela, Esc ou "Fechar" fecham-na, e o foco e o scroll voltam ao sítio de onde se veio.
 */
const ecraLargo = matchMedia("(min-width: 1024px)");
let plantaVolta = null;   // { id, el, y }: para onde volta o foco (e o scroll) ao fechar
const plantaAberta = () => $("sim-planta").classList.contains("aberta");
function abrirPlanta(origem = document.activeElement) {
  if (ecraLargo.matches || plantaAberta() || $("sim-planta").hidden || estado.passo === P.planta) return false;
  plantaVolta = { id: origem?.id || null, el: origem, y: scrollY };
  const s = $("sim-planta");
  s.classList.add("aberta");
  s.setAttribute("role", "dialog");
  s.setAttribute("aria-modal", "true");
  document.documentElement.classList.add("planta-aberta");
  $("ver-planta").setAttribute("aria-expanded", "true");
  s.querySelector(".editor-svg")?.focus({ preventScroll: true });
  return true;
}
function fecharPlanta({ foco = true } = {}) {
  if (!plantaAberta()) return;
  const s = $("sim-planta");
  s.classList.remove("aberta");
  s.removeAttribute("role");
  s.removeAttribute("aria-modal");
  document.documentElement.classList.remove("planta-aberta");
  $("ver-planta").setAttribute("aria-expanded", "false");
  const v = plantaVolta;
  plantaVolta = null;
  if (!v) return;
  scrollTo(scrollX, v.y);
  if (!foco) return;
  // O "+" das Divisões pode ter sido redesenhado entretanto: procura-o pela id.
  const alvo = [v.el?.isConnected ? v.el : null, v.id ? $(v.id) : null, $("ver-planta")].find((x) => x && x.getClientRects().length);
  alvo?.focus({ preventScroll: true });
}
$("ver-planta").addEventListener("click", (ev) => abrirPlanta(ev.currentTarget));

/** Tentou mudar uma divisão fora dos passos "A casa" e "Planta": a dica curta com o botão para o passo Planta (8 s). */
let temporizadorPresa = null;
function mostrarDivisaoPresa() {
  const c = $("planta-presa");
  // Funil "Já tenho a planta": as divisões mudam-se em "A casa" (Mudar a casa); senão no passo Planta.
  $("planta-presa-texto").textContent = funilPlanta() ? "Divisões: mude a casa." : "Divisões: mude no passo Planta.";
  $("planta-presa-ir").textContent = funilPlanta() ? "Mudar a casa" : "Ir ao passo Planta";
  c.hidden = false;
  clearTimeout(temporizadorPresa);
  temporizadorPresa = setTimeout(() => { if (!c.contains(document.activeElement)) c.hidden = true; }, 8000);
}
$("planta-presa-ir").addEventListener("click", () => {
  $("planta-presa").hidden = true;
  fecharPlanta({ foco: false });
  if (funilPlanta()) mudarACasa(); else irPara(P.planta);
});
/**
 * "Mudar a casa" (funil "Já tenho a planta"): passa ao funil da primeira vez, no passo "A casa", mantendo tudo (a
 * planta, as ações escolhidas e o serviço).
 */
function mudarACasa() {
  estado.funil = "primeira";
  if (!estado.servico.length) estado.servico = ["automatizar", "reparar"];
  irPara(P.casa);
}
$("planta-fechar").addEventListener("click", () => fecharPlanta());
ecraLargo.addEventListener("change", () => { if (ecraLargo.matches) fecharPlanta({ foco: false }); });
document.addEventListener("keydown", (ev) => {
  // Com uma janela do editor aberta (Opções, "Mais…") as teclas são dela.
  if (!plantaAberta() || document.querySelector("dialog[open]")) return;
  if (ev.key === "Escape" && !ev.defaultPrevented) { ev.preventDefault(); fecharPlanta(); return; }
  if (ev.key !== "Tab") return;
  // Foco preso na planta aberta: do último para o primeiro (e ao contrário).
  const s = $("sim-planta");
  const l = [...s.querySelectorAll("button, [href], input, select, textarea, [tabindex]")]
    .filter((x) => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length && !x.closest("dialog"));
  if (!l.length) return;
  const i = l.indexOf(document.activeElement);
  if (i < 0 || (ev.shiftKey && i === 0) || (!ev.shiftKey && i === l.length - 1)) {
    ev.preventDefault();
    l[ev.shiftKey ? l.length - 1 : 0].focus();
  }
});

const usaPlanta = () => !estado.plantaSaltada && (estado.planta.divisoes.length > 0 || estado.planta.elementos.length > 0);

/**
 * Contagem para os passos seguintes: a da planta; sem planta (saltada), a da planta que a casa daria
 * (divisões, aparelhos habituais e máquinas escolhidas em "O que quer"), sem a gravar.
 */
// Lote 7: só os aparelhos Novos entram nas linhas do pedido e nos circuitos novos (acoes.js plantaNovos); Manter,
// Reparar e Substituir ficam nos circuitos existentes e têm o seu preço (preco.js pedidosDaSelecao).
// Tomadas e interruptores: inteligentes só com a resposta do cliente (ou o objetivo "Luzes pelo telemóvel"): acoes.js plantaInteligentes.
const contagemAtual = () => contarPlanta(plantaInteligentes(plantaNovos(usaPlanta() ? estado.planta : plantaDaCasa(estado.casa, maquinasParaPlanta(estado)), servicos()), estado.quer.objetivos));

/**
 * Circuitos sugeridos (§4) a partir da contagem. Toda a casa tem luzes e tomadas: se não há nenhuma
 * desenhada ficam os circuitos base "Iluminação" e "Tomadas"; as máquinas têm circuito próprio.
 * Com quadros parciais (casas com pisos, quadro.js pisosDosQuadros) os circuitos fazem-se por quadro: cada
 * piso com quadro tem os seus (`piso` = o piso do quadro; nome com o piso); os pisos sem quadro vão ao geral.
 */
function circuitosSugeridos(cont) {
  const pisosQ = pisosDosQuadros(estado);
  // RTIEBT (quadro.js): zonas húmidas no C5, T3 e mais com iluminação e tomadas em 2 zonas.
  // Com quadros parciais os pisos já repartem a casa (uma avaria nunca a deixa toda às escuras): sem a divisão
  // dia/noite do T3+ dentro de cada quadro.
  const doQuadro = (linhas, geral) => {
    const c = sugerirCircuitos(linhas, { ...opcoesCircuitos(estado.casa), ...(pisosQ.length > 1 ? { dividir: false } : {}) });
    // Os circuitos base (sem nada desenhado) só numa instalação nova: sem ela, os circuitos que já existem ficam.
    const base = geral && servicos().includes("nova");
    const de = (tipo, nome) => { const l = c.filter((x) => x.tipo === tipo); return l.length || !base ? l : [{ ...circuitoVazio(0, tipo), nome }]; };
    return [...de("iluminacao", "Iluminação"), ...de("tomadas", "Tomadas"), ...c.filter((x) => x.tipo === "maquina")];
  };
  let r;
  if (pisosQ.length <= 1) r = doQuadro(cont, true);
  else {
    r = pisosQ.flatMap((p, k) => {
      const linhas = cont.filter((l) => quadroDoPiso(pisosQ, l.fora ? pisosQ[0] : l.piso ?? 0) === p);
      return doQuadro(linhas, k === 0).map((c) => ({ ...c, piso: p, nome: `${c.nome} (${pisoCurto(p)})` }));
    });
  }
  numerar(r);
  // "Poupar energia" / "Controlo de energia": medir o consumo em todos os circuitos inteligentes (já é o que sugerimos por omissão).
  if (quer("poupar") || quer("energia")) for (const x of r) if (x.inteligente) x.medir = true;
  return r;
}

/**
 * Linhas do passo "Divisões" (a partir da contagem). Os objetivos ("O que quer fazer") já não acrescentam aparelhos
 * (decisão do dono): o passo 4 mostra dicas (casa.js dicasObjetivos).
 */
function divisoesSugeridas(cont) {
  const d = divisoesDaContagem(cont);
  if (!usaPlanta()) for (const x of d) x.planta_id = null;
  return d;
}

/** Pré-preenche a planta (se ainda é a nossa), as divisões, o quadro e os termóstatos (só o que o cliente não mudou). */
function prepararPassosSeguintes() {
  preencherPlanta();
  acertarPedido();
}
/**
 * As divisões, o quadro e os termóstatos a partir da planta (só o que o cliente não mudou). "Aquecimento / ar
 * condicionado" já não põe termóstatos sozinho: o passo 4 tem a dica ao lado do campo.
 */
function acertarPedido() {
  const cont = contagemAtual();
  if (!estado.divisoesEditadas) estado.divisoes = divisoesSugeridas(cont);
  if (!estado.quadroEditado) estado.quadro.circuitos = circuitosSugeridos(cont);
  if (!estado.termostatosEditados) estado.extras.termostatos = 0;
}

// ------------------------------------------------------------ 5. Quadro
// Para o cliente, só 3 perguntas simples (docs §4.1): que proteção quer, se a casa tem pára-raios e o seu quadro
// elétrico (já tem / quer um novo / não sei; com "Já tenho", a foto do quadro — lote 5). Os circuitos, os disjuntores, os diferenciais, os módulos, a caixa e a potência continuam a ser calculados
// sozinhos (a partir da planta ou da casa) e vão no pedido para o relatório técnico do eletricista.
const lerNum = (i, min, max) => Math.min(max, Math.max(min, Math.round(Number(i.value) || 0)));
/** "Que proteção quer?": os 3 pacotes (quadro.js PACOTES) em palavras simples, sem siglas. */
const PROTECAO_SIMPLES = {
  essencial: ["Básica", "Diferenciais 30 mA: o obrigatório."],
  recomendado: ["Recomendada", "+ descarregador de sobretensões e relé de tensão."],
  completo: ["Completa", "+ AFDD nos quartos e sala e geral Wi-Fi."],
};
/**
 * "O seu quadro elétrico" (lote 5) → quadro_novo: Já tenho quadro = o atual serve; Quero um quadro novo = novo;
 * Não sei = null (novo por precaução). O preço é o mesmo do lote 4 ("É antigo?": Não / Sim / Não sei).
 */
const QUADRO_RESPOSTAS = [["atual", "Já tenho quadro"], ["novo", "Quero um quadro novo"], ["", "Não sei"]];
const PARA_RAIOS_SIMPLES = [["sim", "Sim"], ["nao", "Não"], ["", "Não sei"]];

/** Monta uma vez as 3 perguntas. */
function montarQuadro() {
  const g = $("quadro-pacotes");
  for (const [k, [nome, ajuda]] of Object.entries(PROTECAO_SIMPLES)) {
    g.append(escolha("radio", "quadro-pacote", k, nome, ajuda, (sim) => {
      if (!sim) return;
      // O cliente escolheu a proteção: o "Quadro seguro" (Melhorias) sai e voltam as proteções de antes dele.
      mudarMelhoria(estado, QUADRO_SEGURO, false);
      estado.quadro.protecoes = protecoesDoPacote(k, estado.quadro.protecoes?.idr_wifi);
      estado.quadro.pacote = k;
      quadroMudou();
    }));
  }
  const pergunta = (id, nome, opcoes, campo) => {
    for (const [v, t] of opcoes) $(id).append(escolha("radio", nome, v, t, null, (sim) => { if (sim) { estado.quadro[campo] = v || null; quadroMudou(); } }));
  };
  pergunta("quadro-para-raios", "quadro-para-raios", PARA_RAIOS_SIMPLES, "para_raios");
  pergunta("quadro-antigo", "quadro-novo", QUADRO_RESPOSTAS, "quadro_novo");
  // Sem "Instalação nova" (lote 7): "Quer melhorar o quadro elétrico?" — Não (omissão: fica como está) / Sim.
  for (const [v, t] of [["nao", "Não"], ["sim", "Sim"]]) {
    $("quadro-mexer").append(escolha("radio", "quadro-mexer", v, t, null, (sim) => { if (sim) { estado.mexerQuadro = v === "sim"; quadroMudou(); } }));
  }
}

function quadroMudou() {
  estado.quadro.pacote = pacoteDoQuadro(estado.quadro);
  agendarGravacao();
  desenharQuadro();
}

/** As 3 respostas como estão no estado e uma frase simples com o que isso quer dizer. */
function desenharQuadro() {
  const q = estado.quadro;
  // O descarregador obrigatório (pára-raios) não conta: "Básica" com pára-raios continua "Básica". Proteções
  // escolhidas uma a uma numa versão antiga ("personalizado"): nenhum botão marcado até escolher um.
  const pacote = pacoteDoQuadro(q);
  for (const i of document.querySelectorAll("input[name=quadro-pacote]")) i.checked = i.value === pacote;
  for (const i of document.querySelectorAll("input[name=quadro-para-raios]")) i.checked = i.value === (q.para_raios ?? "");
  for (const i of document.querySelectorAll("input[name=quadro-novo]")) i.checked = i.value === (q.quadro_novo ?? "");
  // Lote 7: sem "Instalação nova" o quadro só entra se o cliente o quiser melhorar; senão fica como está (a foto ajuda).
  const comNova = servicos().includes("nova");
  const noPedido = quadroNoPedido({ ...estado, servico: servicos() });
  $("quadro-mexer-caixa").hidden = comNova;
  for (const i of document.querySelectorAll("input[name=quadro-mexer]")) i.checked = i.value === (estado.mexerQuadro ? "sim" : "nao");
  $("quadro-perguntas").hidden = !noPedido;
  const nota = $("quadro-nota");
  // Fase 2: o "Quadro seguro" aceite nas Melhorias (melhorias.js PROTECOES_MAXIMAS).
  const seguro = estado.melhorias.aceites.includes(QUADRO_SEGURO) && !!estado.melhorias.quadroAnterior;
  if (!noPedido) {
    nota.textContent = seguro ? "O quadro fica; a melhoria Quadro seguro junta-lhe as proteções." : "O quadro fica como está.";
    nota.hidden = false;
    desenharFotoQuadro();
    return;
  }
  const partes = [];
  if (seguro) partes.push("Melhoria Quadro seguro: AFDD, descarregador, relé de tensão e diferenciais Wi-Fi.");
  if (q.para_raios === "sim") partes.push("Com pára-raios: descarregador de sobretensões incluído.");
  partes.push(q.quadro_novo === "atual"
    ? "Aproveitamos o seu quadro."
    : q.quadro_novo === "novo" ? "Quadro novo incluído." : comVisita("Quadro novo incluído por precaução: sai se o seu servir.", "Quadro novo incluído por precaução: sai se o seu servir."));
  nota.textContent = partes.join(" ");
  nota.hidden = false;
  desenharFotoQuadro();
}
montarQuadro();

/**
 * Foto do quadro (lote 5): pedida com "Já tenho quadro" (opcional, mas recomendada); se já a tirou, fica à vista
 * com as outras respostas. Botão grande; depois, a miniatura com "Trocar" e "Apagar".
 */
function desenharFotoQuadro() {
  const foto = fotos.get("quadro");
  const caixa = $("quadro-foto");
  caixa.hidden = !(estado.quadro.quadro_novo === "atual" || foto || !quadroNoPedido({ ...estado, servico: servicos() }));
  const corpo = $("quadro-foto-corpo");
  corpo.replaceChildren();
  const depois = (ok, texto) => {
    const m = $("quadro-foto-msg");
    m.textContent = texto ?? "";
    m.className = `msg ${ok === false ? "erro" : "info"}`;
    m.hidden = !texto;
    if (ok === null) return;
    desenharFotoQuadro();
    focar("quadro-foto-botao");
  };
  if (!foto) {
    const b = el("button", "btn foto-grande");
    b.type = "button";
    b.id = "quadro-foto-botao";
    b.append(iconeCamara(), el("span", null, "Tirar foto do quadro"));
    b.addEventListener("click", () => pedirFoto("quadro", depois));
    corpo.append(b);
    return;
  }
  const img = el("img", "foto-quadro");
  img.src = foto.miniatura;
  img.alt = "Foto do quadro elétrico";
  const bs = el("div", "form-botoes");
  const trocar = el("button", "btn sec pequeno", "Trocar");
  trocar.type = "button";
  trocar.id = "quadro-foto-botao";
  trocar.setAttribute("aria-label", "Trocar a foto do quadro");
  trocar.addEventListener("click", () => pedirFoto("quadro", depois));
  const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
  apagar.type = "button";
  apagar.id = "quadro-foto-apagar";
  apagar.setAttribute("aria-label", "Apagar a foto do quadro");
  apagar.addEventListener("click", async () => { await tirarFoto("quadro"); depois(true, "Foto apagada."); });
  bs.append(trocar, apagar);
  corpo.append(img, bs);
}

// "Recalcular"/"Refazer": se o cliente já mexeu, pede confirmação na página (sem diálogos nativos).
function ligarRecalcular(botaoId, editado, recalcular, desenhar, { pergunta = "Isto substitui o que mudou à mão pela nossa sugestão. Continuar?", sim: textoSim = "Sim, voltar à sugestão" } = {}) {
  const b = $(botaoId);
  b.addEventListener("click", () => {
    const aberto = b.parentElement.querySelector(".confirmar");
    if (aberto) { aberto.remove(); }
    // O botão pode esconder-se depois (ex.: "Refazer" da planta): aí o foco vai para o título do passo.
    const fazer = () => { recalcular(); agendarGravacao(); desenhar(); ($(botaoId).hidden ? $(`titulo-${estado.passo}`) : $(botaoId)).focus(); };
    if (!editado()) { fazer(); return; }
    const c = el("div", "confirmar");
    const pg = el("p", null, pergunta);
    c.append(pg);
    const bs = el("div", "botoes");
    const sim = el("button", "btn pequeno", textoSim);
    sim.type = "button";
    const nao = el("button", "btn sec pequeno", "Cancelar");
    nao.type = "button";
    if (b.closest("[role=menu]")) {
      // No menu do "⋯" ("Refazer planta"): a pergunta é um grupo de itens do menu (setas, Esc e Tab do editor.js).
      pg.id = `${botaoId}-pergunta`;
      c.setAttribute("role", "group");
      c.setAttribute("aria-labelledby", pg.id);
      for (const x of [sim, nao]) { x.setAttribute("role", "menuitem"); x.tabIndex = -1; }
    } else c.setAttribute("role", "alert");
    sim.addEventListener("click", () => { c.remove(); fazer(); });
    nao.addEventListener("click", () => { c.remove(); b.focus(); });
    bs.append(sim, nao);
    c.append(bs);
    b.parentElement.append(c);
    sim.focus();
  });
}
// Planta em que o cliente mexeu e a casa ou as máquinas mudaram depois: só a refazemos se ele pedir (e confirmar).
ligarRecalcular("planta-refazer", () => true, () => {
  desenharDaCasa();
  estado.plantaSaltada = false;
  if (estado.passo > P.quer) acertarPedido();
}, () => {
  atualizarPlanta();
  if (estado.passo === P.divisoes) desenharDivisoes();
  if (estado.passo === P.trocar) desenharTrocar();
  if (estado.passo === P.preco) desenharPreco();
}, { pergunta: "Isto apaga a planta atual (e o que desenhou nela) e desenha-a de novo a partir dos passos 2 e 3. Continuar?", sim: "Sim, refazer" });

// ------------------------------------------------------------ fotos (lote 5)
// Opcionais: uma por tipo de aparelho e divisão (passo 4) e uma do quadro elétrico (passo 5). Reduzidas no
// navegador e guardadas no IndexedDB (fotos.js) ligadas a esta simulação (estado.fotosId); "Começar de novo" e
// o envio bem-sucedido apagam-nas. Aqui ficam em memória para as miniaturas: chave → {chave, blob, miniatura…}.
const fotos = new Map();
const entradaFoto = document.createElement("input");
entradaFoto.type = "file";
entradaFoto.accept = "image/*";
entradaFoto.setAttribute("capture", "environment");   // no telemóvel abre logo a câmara de trás
entradaFoto.id = "sim-foto-ficheiro";
entradaFoto.hidden = true;
entradaFoto.tabIndex = -1;
entradaFoto.setAttribute("aria-hidden", "true");
document.body.append(entradaFoto);
let fotoAlvo = null;   // {chave, aoFim(ok, texto)}: ok null = ainda a preparar

/** Tirar (ou trocar) a foto `chave`; `aoFim(ok, texto)` diz como correu (ok null: ainda a preparar). */
function pedirFoto(chave, aoFim) {
  if (!fotos.has(chave) && fotos.size >= MAX_FOTOS) { aoFim(false, `Já tem ${MAX_FOTOS} fotos, o máximo. Apague uma para tirar outra.`); return; }
  fotoAlvo = { chave, aoFim };
  entradaFoto.value = "";
  entradaFoto.click();
}
entradaFoto.addEventListener("change", async () => {
  const alvo = fotoAlvo;
  const f = entradaFoto.files?.[0];
  fotoAlvo = null;
  if (!alvo || !f) return;
  alvo.aoFim(null, "A preparar a foto…");
  try {
    const r = await reduzirFoto(f);
    if (!estado.fotosId) { estado.fotosId = novoIdFotos(); agendarGravacao(); }
    const guardada = await guardarFoto(estado.fotosId, alvo.chave, r);
    fotos.set(alvo.chave, { chave: alvo.chave, ...r });
    alvo.aoFim(true, guardada ? "Foto guardada neste navegador até enviar o pedido." : "Foto pronta. Este navegador não a consegue guardar: se fechar a página antes de enviar, perde-se.");
  } catch (e) {
    alvo.aoFim(false, e instanceof ErroFoto ? e.message : "Não foi possível usar esta foto. Experimente outra.");
  } finally {
    entradaFoto.value = "";
  }
});
async function tirarFoto(chave) {
  fotos.delete(chave);
  if (estado.fotosId) await apagarFoto(estado.fotosId, chave);
}
/** As fotos da simulação guardada (ao continuar); as de outras simulações saem do navegador. */
async function carregarFotosDoEstado() {
  fotos.clear();
  const sim = estado.fotosId;
  limparFotos(sim);
  if (!sim) return;
  const lidas = await lerFotos(sim);
  if (sim !== estado.fotosId) return;
  for (const r of lidas) fotos.set(r.chave, r);
  if (estado.passo === P.divisoes) desenharDivisoes();
  if (estado.passo === P.quadro) desenharQuadro();
  if (estado.passo === P.trocar) desenharTrocar();
}

/**
 * `simulacao.fotos` (§6): as fotos das linhas que ainda existem (e a do quadro), sem as imagens, pela ordem do
 * passo 4 (por piso); `legenda` = "Sala — Tomadas" (com pisos, "· Piso 1"). A do quadro geral é a "quadro".
 */
function fotosParaEnvio() {
  if (funilAvaria()) return fotos.has(FOTO_AVARIA) ? [{ chave: FOTO_AVARIA, tipo: "avaria", divisao: null, divisao_nome: AVARIA_ONDE[estado.avaria.onde] ?? null, piso: null, legenda: legendaAvaria(estado.avaria) }] : [];
  const r = [];
  if (fotos.has("quadro")) r.push({ chave: "quadro", tipo: "quadro", divisao: null, divisao_nome: null, piso: null, legenda: "Quadro elétrico" });
  const planta = plantaDivisoes();
  const comPisos = Math.max(pisosDaCasa(estado.casa), ...planta.divisoes.map((d) => pisoDe(d) + 1)) > 1;
  for (const d of divisoesPorOrdem(planta)) {
    for (const l of linhasDivisao(planta, d)) {
      const chave = chaveFoto(planta, d, l);
      if (chave === "quadro" || !fotos.has(chave)) continue;
      const nome = d.nome || "Divisão";
      r.push({ chave, tipo: l.tipo, divisao: d.id, divisao_nome: nome, piso: pisoDe(d), legenda: `${nome} — ${nomeLinha(l)}${comPisos ? ` · ${nomePiso(pisoDe(d))}` : ""}` });
    }
  }
  return r.slice(0, MAX_FOTOS);
}

// ------------------------------------------------------------ 4. Divisões (lote 5)
// O cliente vai a cada divisão confirmar o que lá está: um cartão por divisão (agrupados por piso) com todos os
// aparelhos da planta, uma linha por tipo (as máquinas, uma por modelo) com o desenho, o nome, − n + e uma foto
// opcional; "Divisão verificada ✓" e o progresso por cima. "−" tira o último desse tipo da divisão (na planta);
// "+" leva à planta, no piso certo, com a divisão selecionada e a ferramenta desse aparelho escolhida ("Voltar às
// divisões" regressa ao mesmo cartão); tocar no nome abre a janela simples do aparelho (a do editor). O que entra
// no preço (estado.divisoes) continua a sair da planta e dos objetivos (divisoesSugeridas): o resumo do cartão.
const ITENS_DIVISAO = [
  ["interruptores", "Luzes pelo telemóvel"],
  ["estores", "Estores automáticos"],
  ["sensores_movimento", "Sensor de movimento"],
  ["sensores_porta", "Aviso de porta ou janela aberta"],
  ["tomadas_inteligentes", "Tomada inteligente"],
];
const quantosDe = (d, k) => (k === "interruptores" ? d.interruptores.length : Number(d[k]) || 0);
/** Tipos de aparelho pela ordem dos cartões (depois as máquinas, pela ordem da planta): [singular, plural, "a nova …"]. */
const NOMES_TIPO = {
  luz: ["Ponto de luz", "Pontos de luz", "o novo ponto de luz"],
  interruptor: ["Interruptor", "Interruptores", "o novo interruptor"],
  tomada: ["Tomada", "Tomadas", "a nova tomada"],
  janela: ["Janela", "Janelas", "a nova janela"],
  porta: ["Porta", "Portas", "a nova porta"],
  sensor_movimento: ["Sensor de movimento", "Sensores de movimento", "o novo sensor de movimento"],
  sensor_porta: ["Sensor de porta ou janela", "Sensores de porta ou janela", "o novo sensor de porta ou janela"],
  quadro: ["Quadro elétrico", "Quadros elétricos", "o novo quadro elétrico"],
};
const ORDEM_TIPOS = Object.keys(NOMES_TIPO);
const listaPt = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} e ${a[a.length - 1]}`);
const focar = (id) => { const x = id && $(id); if (!x || x.disabled) return false; x.focus({ preventScroll: true }); porCimaDaBarra(x); return true; };
/** Depois de redesenhar, o botão com o foco não pode ficar por baixo da barra de baixo (o toque seguinte ia para ela). */
function porCimaDaBarra(x) {
  if (x.closest(".sim-planta")) return;
  const n = $("sim-navegacao").getBoundingClientRect(), r = x.getBoundingClientRect();
  if (n.height && r.height && r.bottom > n.top && r.top < n.bottom) x.scrollIntoView({ block: "nearest" });
}

let divisaoTocada = null;       // divisão mexida a partir deste passo (o pedido dela segue a planta)
const abertas = new Set();      // linhas com vários aparelhos com a lista "Qual?" aberta

/** Planta deste passo: a desenhada ou, com a planta saltada, a que a casa daria (a mesma da contagem). */
const plantaDivisoes = () => (usaPlanta() ? estado.planta : plantaDaCasa(estado.casa, maquinasParaPlanta(estado)));

/** Linhas de uma divisão: {k, tipo, modelo, els} — uma por tipo de aparelho (máquinas: uma por modelo). */
function linhasDivisao(planta, d) {
  const m = new Map();
  for (const e of planta.elementos) {
    if (e.divisao !== d.id || (!NOMES_TIPO[e.tipo] && e.tipo !== "maquina")) continue;
    const modelo = e.tipo === "maquina" ? (MODELOS[e.props?.modelo] ? e.props.modelo : "outro") : null;
    const k = modelo ?? e.tipo;
    if (!m.has(k)) m.set(k, { k, tipo: e.tipo, modelo, els: [] });
    m.get(k).els.push(e);
  }
  const ordem = (l) => (l.modelo ? ORDEM_TIPOS.length : ORDEM_TIPOS.indexOf(l.tipo));
  return [...m.values()].sort((a, b) => ordem(a) - ordem(b));
}
/** Divisões pela ordem do passo 4: por piso (r/c primeiro) e, em cada piso, pela ordem da planta. */
const divisoesPorOrdem = (planta) => [...planta.divisoes].sort((a, b) => pisoDe(a) - pisoDe(b));
/**
 * Chave da foto de uma linha: `<id da divisão>:<tipo>` (máquinas `<id>:<modelo>`). O quadro geral (o 1.º quadro
 * pela ordem do passo 4, o do piso mais baixo: quadro.js pisosDosQuadros) partilha a foto do passo 5, "quadro" —
 * uma só foto do quadro, a que o painel lê sozinho; os quadros parciais dos outros pisos têm a sua.
 */
function chaveFoto(planta, d, l) {
  if (l.tipo === "quadro") {
    const geral = divisoesPorOrdem(planta).find((x) => planta.elementos.some((e) => e.tipo === "quadro" && e.divisao === x.id));
    if (geral?.id === d.id) return "quadro";
  }
  return `${d.id}:${l.k}`;
}
const nomeLinha = (l, n = l.els.length) => (l.modelo ? MODELOS[l.modelo].nome : NOMES_TIPO[l.tipo][n === 1 ? 0 : 1]);
const nomeUm = (l) => (l.modelo ? MODELOS[l.modelo].nome : NOMES_TIPO[l.tipo][0]);

/** O pormenor de uma linha em palavras simples ("2 inteligentes", "1 e 2 botões", "porta da rua"). */
function detalheLinha(l) {
  const ps = l.els.map((e) => e.props ?? {});
  const um = l.els.length === 1;
  const conta = (k, s, p) => (!k ? null : um ? s : `${k} ${k === 1 ? s : p}`);
  if (l.tipo === "interruptor") {
    const b = [...new Set(ps.map((p) => Math.min(4, Math.max(1, Math.round(Number(p.botoes) || 1)))))].sort((x, y) => x - y);
    return `${listaPt(b.map(String))} ${b.length === 1 && b[0] === 1 ? "botão" : "botões"}`;
  }
  if (l.tipo === "tomada") return conta(ps.filter((p) => p.inteligente).length, "inteligente", "inteligentes");
  if (l.tipo === "porta") return conta(ps.filter((p) => p.entrada).length, "porta da rua", "da rua");
  if (l.tipo === "janela") {
    const partes = [conta(ps.filter((p) => p.estore && p.motorizado).length, "com estore motorizado", "com estore motorizado"),
      conta(ps.filter((p) => p.estore && !p.motorizado).length, "com estore sem motor", "com estore sem motor")].filter(Boolean);
    return partes.length ? partes.join(", ") : null;
  }
  return null;
}

/**
 * A linha do pedido (estado.divisoes) de uma divisão da planta: pelo id ou, sem planta, pelo nome e piso ("Quarto 1"
 * de um estado antigo = "Quarto" de agora: o primeiro já não leva número).
 */
const semUm = (s) => String(s ?? "").replace(/ 1$/, "");
const entradaDe = (d) => estado.divisoes.find((x) => x.planta_id === d.id)
  ?? estado.divisoes.find((x) => !x.planta_id && semUm(x.nome) === semUm(d.nome) && pisoDe(x) === pisoDe(d));

/**
 * Dados por responder (`por_responder`: janela e máquina "Outra"; tomadas, interruptores e pontos de luz não têm
 * pergunta obrigatória) de uma linha, só nos Novos: pedem-se em "Trocar e reparar" ("Responder aos dados"; faltaTrocar).
 * As Divisões já não pedem nada (decisão do dono: só contar).
 */
const porResponder = (l) => l.els.filter((e) => e.por_responder && acaoDe(e, servicos()) === "novo").length;
/** Elementos com ação de uma linha (porta, quadro e janela sem estore não têm). */
const comAcao = (l) => l.els.filter((e) => temAcao(e.tipo, e.props));
/** O que falta na ação dos aparelhos de uma linha: {acao, avaria, inteligente} (quantos). */
function faltaAcoesLinha(l) {
  const r = { acao: 0, avaria: 0, inteligente: 0 };
  for (const e of comAcao(l)) for (const f of faltaAcao(e, servicos())) r[f]++;
  return r;
}
/** Aparelhos marcados "Reparar" (fluxo curto: pelo menos uma avaria, em "Trocar e reparar"). */
const aReparar = (planta) => planta.elementos.filter((e) => temAcao(e.tipo, e.props) && acaoDe(e, servicos()) === "reparar");

/** Pedidos de Substituir que são aparelhos inteligentes (acoes.js pedidoDoElemento). */
const SUBSTITUIR_INTELIGENTE = /^(interruptor_\d|tomada|estore|sensor_movimento|sensor_porta)$/;
/**
 * "luzes pelo telemóvel, 2 estores automáticos" (o que entra no preço para esta divisão): os Novos (`x`, a linha do
 * pedido) e, com a divisão da planta, os que se substituem por inteligentes e as reparações (lote 7).
 */
function resumoItens(x, planta = null, d = null) {
  const partes = x ? ITENS_DIVISAO.filter(([k]) => quantosDe(x, k) > 0).map(([k, t]) => {
    const n = quantosDe(x, k);
    return n > 1 && k !== "interruptores" ? `${n} ${t.toLowerCase()}` : t.toLowerCase();
  }) : [];
  const reparar = [];
  if (planta && d) {
    for (const l of linhasDivisao(planta, d)) {
      const els = comAcao(l);
      const s = els.filter((e) => acaoDe(e, servicos()) === "substituir" && SUBSTITUIR_INTELIGENTE.test(pedidoDoElemento(e, "substituir") ?? "")).length;
      const r = els.filter((e) => acaoDe(e, servicos()) === "reparar").length;
      if (s) partes.push(`${s} ${nomeLinha(l, s).toLowerCase()} por ${s === 1 ? "um inteligente" : "inteligentes"}`);
      if (r) reparar.push(`${r} ${nomeLinha(l, r).toLowerCase()}`);
    }
  }
  if (reparar.length) partes.push(`reparar ${listaPt(reparar)}`);
  return partes.length ? partes.join(", ") : "nada de inteligente, por agora";
}

/**
 * O pedido (estado.divisoes e o quadro) volta a seguir a planta depois de o cliente a mudar neste passo. Estados
 * antigos com as divisões mexidas à mão (lote 4, Sim/Não): só as divisões em `ids` seguem a planta.
 */
function refazerDivisoes(ids = []) {
  const cont = contagemAtual();
  const sug = divisoesSugeridas(cont);
  if (!estado.divisoesEditadas) estado.divisoes = sug;
  else {
    for (const id of ids) {
      const s = sug.find((x) => x.planta_id === id);
      const i = estado.divisoes.findIndex((x) => x.planta_id === id);
      if (s && i >= 0) estado.divisoes[i] = s; else if (s) estado.divisoes.push(s); else if (i >= 0) estado.divisoes.splice(i, 1);
    }
  }
  if (!estado.quadroEditado) estado.quadro.circuitos = circuitosSugeridos(cont);
}

/**
 * Antes de mexer na planta a partir deste passo. Com a planta saltada, a que o passo mostra (a da casa) passa a
 * ser a planta (os mesmos ids). Se o cliente tinha desenhado uma planta dele e a saltou, ela volta a contar e os
 * cartões passam a ser os dela: devolve false (o cliente toca outra vez).
 */
function garantirPlanta() {
  if (usaPlanta()) return true;
  estado.plantaSaltada = false;
  if (estado.plantaAuto || !plantaTemConteudo(estado.planta)) { desenharDaCasa(); return true; }
  refazerDivisoes();
  agendarGravacao();
  desenharDivisoes();
  mensagemDivisoes("Voltámos à planta que desenhou: toque outra vez.", "info");
  return false;
}

/** O editor tem de estar com a planta do estado para apagar, pôr ou abrir a janela (um passo de anular cada). */
function garantirEditor() {
  if (editor.planta === estado.planta) return;
  ferramentasEditor();
  pisosEditor = pisosDaCasa(estado.casa);
  editor.definirPisos(pisosEditor);
  editor.abrir(estado.planta, { reiniciarVista: true });
}

function mensagemDivisoes(texto, tipo = "info") {
  const m = $("divisoes-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}

/** "−": tira o último aparelho desse tipo da divisão (também da planta). */
function tirarUm(d, l) {
  if (!garantirPlanta()) return;
  const alvo = linhasDivisao(estado.planta, d).find((x) => x.k === l.k)?.els.at(-1);
  if (!alvo) return;
  divisaoTocada = d.id;
  garantirEditor();
  editor.apagar(alvo.id);   // → aoMudar: o pedido e os cartões seguem a planta
  const n = linhasDivisao(estado.planta, d).find((x) => x.k === l.k)?.els.length ?? 0;
  mensagemDivisoes(`${d.nome || "Divisão"}: ${n ? `${n} × ${nomeUm(l).toLowerCase()}` : `sem ${nomeLinha(l, 2).toLowerCase()}`} (também na planta).`);
  const base = `div-${d.id}-${l.k}`;
  focar(`${base}-menos`) || focar(`${base}-mais`) || focar(`div-${d.id}-titulo`);
}

/**
 * "+" (e "Acrescentar outro aparelho", "Acrescentar uma divisão"): na planta do topo (sem mudar de passo), no piso da
 * divisão, com ela selecionada e a ferramenta desse aparelho escolhida (na linha das ferramentas, mesmo que lá não
 * estivesse). Pelo teclado o aparelho fica logo no meio da divisão (como as ferramentas do editor); o cliente
 * arrasta-o para o sítio certo. O cartão atualiza-se sozinho (aoMudar).
 */
function acrescentar(d, l, ev = null) {
  if (d && !garantirPlanta()) return;
  const teclado = ev?.detail === 0;
  garantirEditor();
  divisaoTocada = d?.id ?? null;
  // Telemóvel e tablet: abre a planta por cima (ao fechar, o foco volta a este botão); no computador está à direita.
  abrirPlanta(ev?.currentTarget ?? document.activeElement);
  const oque = l ? (l.modelo ? `a nova máquina (${MODELOS[l.modelo].nome.toLowerCase()})` : NOMES_TIPO[l.tipo][2]) : null;
  const texto = !d ? "Escolha a divisão nas ferramentas da planta."
    : oque && teclado ? `Posto no meio de "${d.nome}": mova com as setas.`
      : oque ? `Toque em "${d.nome}" para pôr ${oque}.`
        : `Escolha o aparelho e toque em "${d.nome}".`;
  doCartao = true;
  editor.prepararColocar({ divisao: d?.id ?? null, tipo: l?.tipo ?? null, modelo: l?.modelo ?? null, texto, porJa: teclado && !!l });
  doCartao = false;
  if (estado.passo === P.trocar) mensagemTrocar(texto); else mensagemDivisoes(texto);
  // Sem ferramenta escolhida (ou sem divisão): o foco vai para a linha das ferramentas.
  if (!l || !d) document.querySelector(".editor-ferramentas button[tabindex='0']")?.focus({ preventScroll: true });
}

/**
 * A divisão selecionada na planta (nos passos "Divisões" e "Trocar e reparar"; lote 8): passa a ser a do separador
 * (o cartão dela aparece). Tocar num cartão (fora dos botões) seleciona a divisão na planta (`doCartao`).
 */
let doCartao = false;
function destacarCartao(id) {
  const pre = estado.passo === P.divisoes ? "div" : estado.passo === P.trocar ? "tr" : null;
  if (!pre || !id || id === divisaoAtiva || doCartao) return;
  if (!plantaDivisoes().divisoes.some((d) => d.id === id)) return;
  divisaoAtiva = id;
  if (pre === "tr") desenharTrocar(); else desenharDivisoes();
}
/*
 * Separadores das divisões (lote 8, passos "Divisões" e "Trocar e reparar"): uma fila de separadores (ícone e nome; ✓
 * nas feitas; marcados os que faltam quando o aviso do "Seguinte" está à vista) e só o cartão da divisão escolhida.
 * Com vários pisos, primeiro os botões dos pisos e depois os separadores das divisões desse piso. O separador e a
 * divisão selecionada na planta andam juntos (tocar na planta muda de separador e vice-versa). Teclado: ← → Home End.
 */
let divisaoAtiva = null;   // id da divisão (da planta) do separador escolhido
/** A divisão do separador escolhido (a primeira, se a escolhida já não existir). */
function divisaoDoSeparador(planta) {
  const ordem = divisoesPorOrdem(planta);
  if (!ordem.some((d) => d.id === divisaoAtiva)) divisaoAtiva = ordem[0]?.id ?? null;
  return ordem.find((d) => d.id === divisaoAtiva) ?? null;
}
/** O cartão da divisão escolhida é o painel do seu separador. */
function painelSeparador(cartao, pre, d) {
  cartao.setAttribute("role", "tabpanel");
  cartao.setAttribute("aria-labelledby", `${pre}-tab-${d.id}`);
  return cartao;
}
/** Escolhe o separador `id` (e a divisão na planta), redesenha o passo e põe o foco em `focoId`. */
function escolherDivisao(id, focoId = null) {
  divisaoAtiva = id;
  if (editor.planta === estado.planta && id) { doCartao = true; editor.selecionar(id); doCartao = false; }
  if (estado.passo === P.trocar) desenharTrocar(); else desenharDivisoes();
  if (focoId) focar(focoId);
}
/**
 * A fila dos separadores. `pre`: "div" ou "tr" (ids); `feita(d)`: ✓; `falta(d)`: marcado quando `avisar` (o aviso do
 * "Seguinte" está à vista). Nas Divisões (só contar) nunca há ✓ nem marcas.
 */
function separadoresDivisoes(pre, planta, { feita, falta, avisar }) {
  const caixa = el("div", "div-separadores");
  const ordem = divisoesPorOrdem(planta);
  const ativa = divisaoDoSeparador(planta);
  if (!ativa) return caixa;
  const nPisos = Math.max(pisosDaCasa(estado.casa), ...planta.divisoes.map((d) => pisoDe(d) + 1), 1);
  const pisoAtivo = pisoDe(ativa);
  if (nPisos > 1) {
    const gp = el("div", "div-pisos");
    gp.setAttribute("role", "group");
    gp.setAttribute("aria-label", "Piso");
    for (let p = 0; p < nPisos; p++) {
      const doPiso = ordem.filter((d) => pisoDe(d) === p);
      const b = el("button", "btn sec pequeno", `${nomePiso(p)} (${doPiso.length})`);
      b.type = "button";
      b.id = `${pre}-piso-${p}`;
      b.setAttribute("aria-pressed", String(p === pisoAtivo));
      b.disabled = !doPiso.length;
      if (avisar && doPiso.some(falta)) b.classList.add("falta");
      b.addEventListener("click", () => { if (doPiso.length) escolherDivisao(doPiso[0].id, b.id); });
      gp.append(b);
    }
    caixa.append(gp);
  }
  const lista = el("div", "div-tabs");
  lista.setAttribute("role", "tablist");
  lista.setAttribute("aria-label", nPisos > 1 ? `Divisões: ${nomePiso(pisoAtivo)}` : "Divisões");
  const doPiso = ordem.filter((d) => pisoDe(d) === pisoAtivo);
  doPiso.forEach((d, i) => {
    const sel = d.id === ativa.id;
    const b = el("button", "div-tab");
    b.type = "button";
    b.id = `${pre}-tab-${d.id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(sel));
    if (sel) b.setAttribute("aria-controls", `${pre}-${d.id}`);   // só o painel do separador escolhido existe
    b.tabIndex = sel ? 0 : -1;
    const ok = feita(d);
    const f = avisar && !ok && falta(d);
    if (f) b.classList.add("falta");
    if (ok) b.classList.add("feita");
    const ic = desenharIcone(svgNovo(), "divisao", { tipo: tipoDivisao(d.nome) });
    ic.classList.add("div-tab-icone");
    b.append(ic, el("span", "div-tab-nome", d.nome || "Divisão"));
    if (ok) { const v = el("span", "div-tab-feita", "✓"); v.setAttribute("aria-hidden", "true"); b.append(v); }
    // Só em "Trocar e reparar" (as Divisões são só contar: sem marcas).
    b.setAttribute("aria-label", `${d.nome || "Divisão"}${ok ? " (tudo respondido)" : f ? " (falta responder)" : ""}`);
    b.addEventListener("click", () => escolherDivisao(d.id, b.id));
    b.addEventListener("keydown", (ev) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: doPiso.length - 1 }[ev.key];
      if (k === undefined) return;
      ev.preventDefault();
      const alvo = doPiso[(k + doPiso.length) % doPiso.length];
      escolherDivisao(alvo.id, `${pre}-tab-${alvo.id}`);
    });
    lista.append(b);
  });
  caixa.append(lista);
  // O separador escolhido fica à vista na fila (desliza para o lado no telemóvel, sem mexer na página).
  queueMicrotask(() => {
    const b = $(`${pre}-tab-${ativa.id}`);
    if (b && lista.scrollWidth > lista.clientWidth) lista.scrollLeft = Math.max(0, b.offsetLeft - (lista.clientWidth - b.offsetWidth) / 2);
  });
  return caixa;
}

function mostrarNaPlanta(id) {
  if (editor.planta !== estado.planta) return;   // planta saltada num estado antigo: ainda não é a do editor
  doCartao = true;
  editor.selecionar(id);
  doCartao = false;
}

/** Janela simples de um aparelho (a do editor), aberta por cima do passo à vista; ao fechar o foco volta a `focoId`. */
function abrirJanela(d, e, focoId) {
  if (!garantirPlanta()) return;
  garantirEditor();
  divisaoTocada = d.id;
  const trocar = estado.passo === P.trocar;
  editor.abrirOpcoes(e.id, {
    anfitriao: $(`passo-${estado.passo}`),
    aoFechar: () => {
      if (trocar) desenharTrocar(); else desenharDivisoes();
      focar(focoId) || focar(`${trocar ? "tr" : "div"}-${d.id}-titulo`);
    },
  });
}

function desenharDivisoes() {
  const planta = plantaDivisoes();
  const origem = $("divisoes-origem");
  origem.hidden = usaPlanta() && !estado.divisoesEditadas;
  origem.textContent = !usaPlanta()
    ? "Ainda sem planta: é a que a casa daria."
    : "Divisões mudadas à mão numa versão anterior: ficam como estavam.";
  $("divisoes-recalcular").hidden = !estado.divisoesEditadas;
  desenharProgressoDivisoes(planta);
  const c = $("divisoes");
  c.replaceChildren();
  if (!planta.divisoes.length) c.append(el("p", "ajuda", "Ainda sem divisões: acrescente-as na planta."));
  // Lote 8: separadores (com pisos, primeiro o piso) e só o cartão da divisão escolhida.
  const ativa = divisaoDoSeparador(planta);
  if (ativa) {
    c.append(separadoresDivisoes("div", planta, { feita: () => false, falta: () => false, avisar: false }));
    c.append(painelSeparador(cartaoDivisao(planta, ativa, "h3"), "div", ativa));
  }
  // Estados antigos: divisões acrescentadas à mão no passo (sem divisão na planta) continuam no pedido.
  const usadas = new Set(planta.divisoes.map(entradaDe).filter(Boolean));
  const soltas = estado.divisoes.filter((x) => !usadas.has(x));
  if (soltas.length) {
    const g = el("section", "divisoes-piso");
    g.setAttribute("aria-labelledby", "divisoes-soltas");
    const t = el("h3", null, "Divisões acrescentadas à mão");
    t.id = "divisoes-soltas";
    g.append(t);
    soltas.forEach((x, i) => {
      const f = el("div", "cartao divisao-cartao");
      f.append(el("h4", null, x.nome || "Divisão"), el("p", "divisao-resumo", `No orçamento: ${resumoItens(x)}.`));
      const rem = el("button", "btn sec pequeno perigo-sec", "Tirar esta divisão");
      rem.type = "button";
      rem.id = `divisoes-solta-${i}-tirar`;
      rem.addEventListener("click", () => {
        estado.divisoes = estado.divisoes.filter((y) => y !== x);
        estado.divisoesEditadas = true;
        agendarGravacao();
        desenharDivisoes();
        $("divisao-adicionar").focus();
      });
      f.append(rem);
      g.append(f);
    });
    c.append(g);
  }
  $("extra-central").checked = estado.extras.central;
  $("extra-termostatos").value = String(estado.extras.termostatos);
  // "Aquecimento / ar condicionado" já não põe termóstatos sozinho: uma dica ao lado do campo.
  let dicaT = $("extra-termostatos-dica");
  if (!dicaT) {
    dicaT = el("p", "ajuda divisao-dica");
    dicaT.id = "extra-termostatos-dica";
    $("extra-termostatos").closest("label").after(dicaT);
  }
  dicaT.textContent = "Aquecimento ou AC: quantos termóstatos?";
  dicaT.hidden = !(quer("clima") && !estado.extras.termostatos);
}

/** Por cima dos cartões: quantas divisões e aparelhos há na planta (decisão do dono: já não se verifica divisão a divisão). */
function desenharProgressoDivisoes(planta = plantaDivisoes()) {
  const n = planta.divisoes.length;
  const a = planta.elementos.filter((e) => e.divisao).length;
  $("divisoes-progresso-caixa").hidden = !n;
  $("divisoes-progresso").textContent = `${n} ${n === 1 ? "divisão" : "divisões"} · ${a} ${a === 1 ? "aparelho" : "aparelhos"} na planta`;
}

/**
 * Cartão de uma divisão: o nome, o que entra no preço, uma linha por aparelho (− n +) e "Acrescentar outro aparelho".
 * Decisão do dono: só contar o que existe — sem fotos, perguntas obrigatórias, "Falta responder" nem "Divisão verificada".
 */
function cartaoDivisao(planta, d, nivel) {
  const id = `div-${d.id}`;
  const c = el("section", "cartao divisao-cartao");
  c.id = id;
  // Tocar no cartão (ou entrar nele com o teclado) mostra a divisão na planta do topo.
  c.addEventListener("click", (ev) => { if (!ev.target.closest("button, a, input, label")) mostrarNaPlanta(d.id); });
  c.addEventListener("focusin", () => { if (!c.classList.contains("na-planta")) mostrarNaPlanta(d.id); });
  c.setAttribute("aria-labelledby", `${id}-titulo`);
  const topo = el("div", "divisao-topo");
  const t = el(nivel, null, d.nome || "Divisão");
  t.id = `${id}-titulo`;
  t.tabIndex = -1;
  topo.append(t);
  c.append(topo);
  const ent = entradaDe(d);
  if (ent || linhasDivisao(planta, d).some((l) => comAcao(l).some((e) => ["substituir", "reparar"].includes(acaoDe(e, servicos()))))) {
    c.append(el("p", "divisao-resumo", `No orçamento: ${resumoItens(ent, planta, d)}.`));
  }
  const linhas = linhasDivisao(planta, d);
  const ul = el("ul", "aparelhos");
  ul.setAttribute("aria-label", `Aparelhos: ${d.nome || "divisão"}`);
  for (const l of linhas) ul.append(linhaAparelho(d, l));
  if (linhas.length) c.append(ul);
  else c.append(el("p", "ajuda", "Sem aparelhos na planta."));
  if (ent?.estores_sem_motor) c.append(el("p", "ajuda", "Estores sem motor: precisam de motor."));
  // Objetivos ("O que quer fazer"): não acrescentam nada sozinhos, só dicas curtas (casa.js dicasObjetivos).
  for (const t of dicasObjetivos(d.nome, estado.quer.objetivos, { temTomadas: linhas.some((l) => l.tipo === "tomada") })) c.append(el("p", "ajuda divisao-dica", t));
  const bs = el("div", "divisao-botoes");
  const outro = el("button", "btn sec pequeno", "Acrescentar outro aparelho");
  outro.type = "button";
  outro.id = `${id}-acrescentar`;
  outro.setAttribute("aria-label", `Acrescentar outro aparelho: ${d.nome || "divisão"} (na planta)`);
  outro.addEventListener("click", (ev) => acrescentar(d, null, ev));
  bs.append(outro);
  c.append(bs);
  return c;
}

/** Desenho de uma câmara (botões das fotos). */
function iconeCamara() {
  const s = svgNovo();
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("icone-camara");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M4 8h3l2-3h6l2 3h3v11H4z");
  const o = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  o.setAttribute("cx", "12");
  o.setAttribute("cy", "13");
  o.setAttribute("r", "3.5");
  for (const x of [p, o]) { x.setAttribute("fill", "none"); x.setAttribute("stroke", "currentColor"); x.setAttribute("stroke-width", "2"); x.setAttribute("stroke-linejoin", "round"); }
  s.append(p, o);
  return s;
}

/**
 * Foto (opcional) de uma linha: sem foto, o botão "Foto" (para a linha); com foto, a miniatura com "Trocar" e "Apagar"
 * (para baixo do nome). Devolve [botão ou null, miniatura ou null]. `depois(ok, texto)` como em pedirFoto.
 */
function fotoDaLinha(chave, rotuloFoto, base, depois) {
  const foto = fotos.get(chave);
  if (!foto) {
    const bf = el("button", "btn sec pequeno aparelho-foto");
    bf.type = "button";
    bf.id = `${base}-foto`;
    bf.setAttribute("aria-label", `Tirar foto: ${rotuloFoto}`);
    bf.append(iconeCamara(), el("span", null, "Foto"));
    bf.addEventListener("click", () => pedirFoto(chave, depois));
    return [bf, null];
  }
  const acoes = el("div", "aparelho-foto-acoes");
  const img = el("img", "foto-miniatura");
  img.src = foto.miniatura;
  img.alt = `Foto: ${rotuloFoto}`;
  acoes.append(img);
  const trocar = el("button", "btn sec pequeno", "Trocar foto");
  trocar.type = "button";
  trocar.id = `${base}-foto`;
  trocar.setAttribute("aria-label", `Trocar a foto: ${rotuloFoto}`);
  trocar.addEventListener("click", () => pedirFoto(chave, depois));
  const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
  apagar.type = "button";
  apagar.id = `${base}-foto-apagar`;
  apagar.setAttribute("aria-label", `Apagar a foto: ${rotuloFoto}`);
  apagar.addEventListener("click", async () => { await tirarFoto(chave); depois(true, "Foto apagada."); });
  acoes.append(trocar, apagar);
  return [null, acoes];
}

/** Uma linha: desenho, nome (abre a janela), pormenor e − n + (sem fotos nem perguntas obrigatórias: decisão do dono). */
function linhaAparelho(d, l) {
  const base = `div-${d.id}-${l.k}`;
  const n = l.els.length;
  const nome = nomeLinha(l);
  const onde = d.nome || "divisão";
  const li = el("li", "aparelho");
  const linha = el("div", "aparelho-linha");
  const ic = desenharIcone(svgNovo(), l.tipo, l.modelo ? { modelo: l.modelo } : l.els[0].props ?? {});
  ic.classList.add("aparelho-icone");
  const txt = el("div", "aparelho-texto");
  const bn = el("button", "aparelho-nome", nome);
  bn.type = "button";
  bn.id = `${base}-nome`;
  if (n === 1) {
    bn.setAttribute("aria-label", `${nome} (${onde}): mudar os dados`);
    bn.addEventListener("click", () => abrirJanela(d, l.els[0], bn.id));
  } else {
    // Vários: "Qual?" com um botão por aparelho.
    bn.setAttribute("aria-label", `${n} ${nome.toLowerCase()} (${onde}): escolher qual mudar`);
    bn.setAttribute("aria-expanded", String(abertas.has(base)));
    if (abertas.has(base)) bn.setAttribute("aria-controls", `${base}-quais`);   // a lista "Qual?" só existe aberta
    bn.addEventListener("click", () => {
      if (abertas.has(base)) abertas.delete(base); else abertas.add(base);
      desenharDivisoes();
      focar(bn.id);
    });
  }
  txt.append(bn);
  const det = detalheLinha(l);
  if (det) txt.append(el("small", null, det));
  const cont = el("div", "contador-caixa");
  cont.setAttribute("role", "group");
  cont.setAttribute("aria-label", `Quantos: ${nome.toLowerCase()} (${onde})`);
  const menos = el("button", "btn sec", "−");
  menos.type = "button";
  menos.id = `${base}-menos`;
  menos.setAttribute("aria-label", `Tirar 1: ${nomeUm(l).toLowerCase()} (${onde})`);
  menos.addEventListener("click", () => tirarUm(d, l));
  const valor = el("output", "contador-valor", String(n));
  valor.id = `${base}-valor`;
  const mais = el("button", "btn sec", "+");
  mais.type = "button";
  mais.id = `${base}-mais`;
  mais.setAttribute("aria-label", `Acrescentar 1: ${nomeUm(l).toLowerCase()} (${onde}), na planta`);
  mais.addEventListener("click", (ev) => acrescentar(d, l, ev));
  cont.append(menos, valor, mais);
  linha.append(ic, txt, cont);
  li.append(linha);
  // O que fazer a cada aparelho (Manter, Trocar…): lote 8, no passo "Trocar e reparar".
  if (n > 1 && abertas.has(base)) {
    const q = el("div", "aparelho-quais");
    q.id = `${base}-quais`;
    q.append(el("span", null, "Qual?"));
    l.els.forEach((e, i) => {
      const b = el("button", "btn sec pequeno", String(i + 1));
      b.type = "button";
      b.id = `${base}-qual-${i}`;
      b.setAttribute("aria-label", `${nomeUm(l)} ${i + 1} de ${n} (${onde}): mudar os dados`);
      b.addEventListener("click", () => abrirJanela(d, e, b.id));
      q.append(b);
    });
    li.append(q);
  }
  return li;
}

// "Voltar à nossa sugestão": só em estados antigos com as divisões mexidas à mão (lote 4).
ligarRecalcular("divisoes-recalcular", () => estado.divisoesEditadas, () => {
  estado.divisoes = divisoesSugeridas(contagemAtual());
  estado.divisoesEditadas = false;
}, desenharDivisoes);
// Lote 8: as divisões mudam-se no passo Planta (aqui estão presas).
$("divisao-adicionar").addEventListener("click", () => irPara(P.planta));
$("extra-central").addEventListener("change", () => { estado.extras.central = $("extra-central").checked; agendarGravacao(); });
$("extra-termostatos").addEventListener("input", () => { estado.extras.termostatos = lerNum($("extra-termostatos"), 0, 20); estado.termostatosEditados = true; if ($("extra-termostatos-dica")) $("extra-termostatos-dica").hidden = !(quer("clima") && !estado.extras.termostatos); agendarGravacao(); });

// ------------------------------------------------------------ 6. Trocar e reparar (lote 8)
// O que fazer com cada coisa da casa (as ações saíram do passo Divisões): na lista (um cartão por divisão, só os
// aparelhos com ação) ou tocando no aparelho na planta (a caixa por baixo dela: desenharAcaoPlanta). Botões Manter ·
// Trocar · Avariado (reparar) · Novo / acrescentar (acoes.js ORDEM_BOTOES; as chaves internas continuam manter,
// substituir, reparar, novo), na linha para todos ("todas iguais") ou um a um; "Avariado" pede o que se passa (≤ 200
// caracteres; a foto da linha ajuda); "Trocar" uma tomada ou um interruptor pergunta "Por um inteligente?". Também o
// quadro: "Tem algum problema?" (estado.quadroAvaria) e, sem "Instalação nova", "Quer melhorar o quadro?".
const abertasAcao = new Set();   // linhas com a escolha "um a um" aberta
/** Os nomes das ações que o cliente vê (legenda das marcas na planta). */
const NOMES_ACOES = Object.fromEntries(Object.entries(ACOES).map(([k, a]) => [k, a.nome]));

/** Botões Manter · Trocar · Avariado (reparar) · Novo / acrescentar (aria-pressed na ação escolhida). */
function botoesAcao(id, rotulo, atual, aoEscolher) {
  const g = el("div", "acao-botoes");
  g.id = id;
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", rotulo);
  for (const k of ORDEM_BOTOES) {
    const b = el("button", `acao-botao acao-${k}`, ACOES[k].nome);
    b.type = "button";
    b.id = `${id}-${k}`;
    b.title = ACOES[k].ajuda;
    b.setAttribute("aria-pressed", String(atual === k));
    b.addEventListener("click", () => aoEscolher(k, b.id));
    g.append(b);
  }
  return g;
}

/** O elemento da planta do estado com este id (depois de garantirPlanta, a planta do passo é a do estado). */
const elementoDoEstado = (id) => estado.planta.elementos.find((x) => x.id === id);

/** Muda um ou mais aparelhos e refaz o pedido, a planta (marcas), a lista e a caixa da planta; o foco volta a `focoId`. */
function mudarAparelhos(d, ids, mudar, focoId) {
  if (!garantirPlanta()) return;
  for (const id of ids) { const e = elementoDoEstado(id); if (e) mudar(e); }
  estado.plantaAuto = false;   // o cliente mexeu na planta: não a redesenhamos sozinhos
  if (d.id) divisaoTocada = d.id;
  refazerDivisoes(d.id ? [d.id] : []);
  garantirEditor();
  editor.redesenhar();
  agendarGravacao();
  desenharTrocar();
  focar(focoId);
}

/** A ação de uma linha (todos iguais) ou de um aparelho, com o que ela pede por baixo. */
function controloAcoes(d, l, els, base, onde, temFoto) {
  const sv = servicos();
  const ef = els.map((e) => acaoDe(e, sv));
  const mistas = ef.some((a) => a !== ef[0]);
  // A ação comum só aparece escolhida se contar como resposta (sem "Instalação nova" o Manter por omissão não conta).
  const comum = !mistas && (els.every((e) => ACOES[e.acao]) || !precisaEscolher(sv)) ? ef[0] : null;
  const umAUm = els.length > 1 && (mistas || abertasAcao.has(base));
  const nomeL = nomeLinha(l, els.length).toLowerCase();
  const out = [];
  const linha = el("div", "aparelho-acao");
  let quais = null;
  linha.append(botoesAcao(`${base}-acao`, `O que fazer: ${els.length > 1 ? `${els.length} ${nomeL}` : nomeL} (${onde})${els.length > 1 ? ", todos" : ""}`, comum,
    (k, id) => mudarAparelhos(d, els.map((e) => e.id), (e) => { e.acao = k; }, id)));
  if (els.length > 1) {
    const q = el("button", "btn sec pequeno aparelho-acao-quais", mistas ? "Diferentes" : "Um a um");
    q.type = "button";
    q.id = `${base}-acao-quais`;
    q.setAttribute("aria-expanded", String(umAUm));
    q.setAttribute("aria-label", `Escolher um a um: ${els.length} ${nomeL} (${onde})`);
    q.disabled = mistas;   // diferentes: a lista fica aberta
    q.addEventListener("click", () => {
      if (abertasAcao.has(base)) abertasAcao.delete(base); else abertasAcao.add(base);
      desenharTrocar();
      focar(q.id);
    });
    linha.append(q);
    quais = q;
  }
  out.push(linha);
  const detalhes = el("div", "aparelho-acao-detalhes");
  detalhes.id = `${base}-acao-lista`;
  // "Por um inteligente?" ao Trocar (obrigatório) e no Novo (sugestão de melhoria: a omissão é normal, ou inteligente
  // com o objetivo "Luzes pelo telemóvel" nos interruptores). Todos a Trocar (ou todos Novos), sem "um a um":
  // pergunta-se uma vez para a linha toda ("todas iguais").
  const pergunta = (e) => perguntaInteligente(e.tipo) && ["substituir", "novo"].includes(acaoDe(e, sv));
  const valorInteligente = (e) => (acaoDe(e, sv) === "novo" ? inteligenteDe(e, estado.quer.objetivos) : e.inteligente);
  const inteligenteTodos = !umAUm && els.length > 1 && pergunta(els[0]) && els.every((e) => acaoDe(e, sv) === acaoDe(els[0], sv));
  if (inteligenteTodos) {
    const g = el("div", "acao-inteligente");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", `Por um inteligente? ${els.length} ${nomeL} (${onde}), todos`);
    g.append(el("span", null, `Por um inteligente? (${els.length === 2 ? "os 2" : `os ${els.length}`})`));
    const comum = els.every((e) => valorInteligente(e) === valorInteligente(els[0])) ? valorInteligente(els[0]) : undefined;
    for (const [v, t] of [[true, "Sim"], [false, "Não"]]) {
      const b = el("button", "btn sec pequeno", t);
      b.type = "button";
      b.id = `${base}-inteligente-todos-${v ? "sim" : "nao"}`;
      b.setAttribute("aria-pressed", String(comum === v));
      b.addEventListener("click", () => mudarAparelhos(d, els.map((e) => e.id), (x) => { x.inteligente = v; }, b.id));
      g.append(b);
    }
    detalhes.append(g);
  }
  els.forEach((e, i) => {
    const bi = `${base}-e${i}`;
    const nomeE = els.length > 1 ? `${nomeUm(l)} ${i + 1}` : nomeUm(l);
    const bloco = el("div", "acao-um");
    if (umAUm) {
      const cab = el("div", "acao-um-cabeca");
      cab.append(el("span", "acao-um-num", String(i + 1)));
      const escolhida = ACOES[e.acao] || !precisaEscolher(sv) ? acaoDe(e, sv) : null;
      cab.append(botoesAcao(`${bi}-acao`, `O que fazer: ${nomeE.toLowerCase()} (${onde})`, escolhida, (k, id) => mudarAparelhos(d, [e.id], (x) => { x.acao = k; }, id)));
      bloco.append(cab);
    }
    const a = acaoDe(e, sv);
    if (a === "reparar") {
      const lab = el("label", "acao-avaria");
      lab.append(el("span", null, `O que se passa?${els.length > 1 ? ` (${nomeE.toLowerCase()})` : ""}`));
      const inp = document.createElement("input");
      inp.type = "text";
      inp.id = `${bi}-avaria`;
      inp.dataset.elemento = e.id;   // o mesmo aparelho pode estar na lista e na caixa da planta: seguem-se
      inp.maxLength = MAX_AVARIA;
      inp.placeholder = "Ex.: sem corrente, queimada";
      inp.value = e.avaria ?? "";
      if (!String(e.avaria ?? "").trim()) inp.setAttribute("aria-invalid", "true");
      inp.addEventListener("input", () => {
        const x = elementoDoEstado(e.id);
        if (!x) return;
        x.avaria = inp.value.slice(0, MAX_AVARIA);
        for (const o of document.querySelectorAll(".acao-avaria input")) {
          if (o.dataset.elemento !== e.id) continue;
          if (o !== inp) o.value = x.avaria;
          if (x.avaria.trim()) o.removeAttribute("aria-invalid"); else o.setAttribute("aria-invalid", "true");
        }
        estado.plantaAuto = false;
        agendarGravacao(false);
        atualizarFaltaTrocar(d);
      });
      lab.append(inp);
      bloco.append(lab);
    } else if (pergunta(e) && !inteligenteTodos) {
      const g = el("div", "acao-inteligente");
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", `Por um inteligente? ${nomeE} (${onde})`);
      g.append(el("span", null, `Por um inteligente?${els.length > 1 ? ` (${nomeE.toLowerCase()})` : ""}`));
      for (const [v, t] of [[true, "Sim"], [false, "Não"]]) {
        const b = el("button", "btn sec pequeno", t);
        b.type = "button";
        b.id = `${bi}-inteligente-${v ? "sim" : "nao"}`;
        b.setAttribute("aria-pressed", String(valorInteligente(e) === v));
        b.addEventListener("click", () => mudarAparelhos(d, [e.id], (x) => { x.inteligente = v; }, b.id));
        g.append(b);
      }
      bloco.append(g);
    }
    if (bloco.childElementCount) detalhes.append(bloco);
  });
  // Fotos só no que se troca ou repara (decisão do dono): obrigatória na avaria, pedida ao trocar.
  if (!temFoto && els.some((e) => acaoDe(e, sv) === "reparar")) detalhes.append(el("p", "ajuda acao-foto-dica falta-foto", "Foto da avaria (obrigatória)."));
  else if (!temFoto && els.some((e) => acaoDe(e, sv) === "substituir")) detalhes.append(el("p", "ajuda acao-foto-dica", "Uma foto ajuda."));
  if (detalhes.childElementCount) out.push(detalhes);
  // aria-controls só para a lista que existe (sem nada a perguntar, não há lista).
  if (quais && detalhes.childElementCount) quais.setAttribute("aria-controls", detalhes.id);
  return out;
}

/** Fotos só no que se troca ou repara (decisão do dono): a linha tem aparelhos a Trocar ou Avariados? */
const pedeFoto = (els) => els.some((e) => ["substituir", "reparar"].includes(acaoDe(e, servicos())));
/**
 * O que falta numa divisão: a ação de cada aparelho (acoes.js faltaAcao), a foto das avarias (obrigatória: uma por
 * linha, a chave da foto da linha) e os dados dos que passam a Novos.
 */
function faltaTrocar(planta, d) {
  const out = [];
  for (const l of linhasDivisao(planta, d)) {
    if (!comAcao(l).length) continue;
    const nome = (k) => (k === 1 ? nomeUm(l) : `${k} ${nomeLinha(l, k)}`).toLowerCase();
    const f = faltaAcoesLinha(l);
    if (f.acao) out.push(`o que fazer (${nome(f.acao)})`);
    if (f.avaria) out.push(`o que se passa (${nome(f.avaria)})`);
    const avariados = comAcao(l).filter((e) => acaoDe(e, servicos()) === "reparar").length;
    if (avariados && !fotos.has(chaveFoto(planta, d, l))) out.push(`a foto da avaria (${nome(avariados)})`);
    if (f.inteligente) out.push(`se quer inteligente (${nome(f.inteligente)})`);
    const n = porResponder(l);
    if (n) out.push(`os dados (${nome(n)})`);
  }
  return out;
}
/** O quadro está marcado "Com problemas" mas ainda sem dizer o que se passa. */
const quadroPorDescrever = () => typeof estado.quadroAvaria === "string" && !estado.quadroAvaria.trim();
/** Avarias indicadas: aparelhos a reparar e o quadro com problemas. */
const nAvarias = (planta) => aReparar(planta).length + (estado.quadroAvaria !== null ? 1 : 0);

/** A mensagem do passo é a do "Seguinte" (o que falta): segue as respostas (atualiza-se ou passa a "tudo respondido"). */
let avisoTrocar = false;
function mensagemTrocar(texto, tipo = "info") {
  avisoTrocar = false;
  const m = $("trocar-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}
/** O que falta para sair do passo (texto), ou null: fluxo curto → pelo menos uma avaria; o quadro; as divisões. */
function faltaNoTrocar() {
  const planta = plantaDivisoes();
  if (fluxoCurto() && !nAvarias(planta)) return { texto: "Marque pelo menos uma avaria (aparelho ou quadro).", alvo: "reparar" };
  // Já tenho a planta: pelo menos uma coisa a trocar, reparar ou acrescentar (ou o quadro).
  if (funilPlanta() && !estado.mexerQuadro && estado.quadroAvaria === null && !planta.elementos.some((e) => temAcao(e.tipo, e.props) && ACOES[e.acao] && e.acao !== "manter")) {
    return { texto: "Escolha pelo menos uma coisa para trocar, reparar ou acrescentar.", alvo: divisoesPorOrdem(planta)[0]?.id ?? "quadro" };
  }
  if (quadroPorDescrever()) return { texto: "Diga o que se passa no quadro.", alvo: "quadro" };
  if (estado.quadroAvaria !== null && !fotos.has("quadro")) return { texto: "Falta a foto do quadro (obrigatória com problemas).", alvo: "quadro-foto" };
  const falta = divisoesPorOrdem(planta).filter((d) => faltaTrocar(planta, d).length);
  if (!falta.length) return null;
  const nomes = falta.slice(0, 3).map((d) => d.nome || "Divisão");
  if (falta.length > 3) nomes.push(`mais ${falta.length - 3}`);
  return { texto: `Falta responder em ${listaPt(nomes)}.`, alvo: falta[0].id };
}
/**
 * "Seguinte" (ou a barra dos passos) para lá deste passo com respostas em falta (lote 8: o que era pedido para
 * "Divisão verificada"): sem "Instalação nova" e fora do fluxo curto, cada aparelho com a ação escolhida; cada avaria
 * com o que se passa; ao trocar uma tomada ou um interruptor, se quer inteligente; no fluxo curto, pelo menos uma avaria.
 * Fica (ou volta) neste passo com a mensagem e o foco no que falta. Devolve true se bloqueou.
 */
function bloquearTrocar() {
  const f = faltaNoTrocar();
  if (!f) return false;
  if (estado.passo !== P.trocar) irPara(P.trocar, { foco: false });
  mensagemTrocar(f.texto, "erro");
  avisoTrocar = true;
  const rolar = (x) => x?.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" });
  if (f.alvo === "reparar") { const b = document.querySelector("#trocar .acao-reparar") ?? $("trocar-quadro-problemas"); b?.focus({ preventScroll: true }); rolar(b); }
  else if (f.alvo === "quadro") { focar("trocar-quadro-avaria"); rolar($("trocar-quadro")); }
  else if (f.alvo === "quadro-foto") { focar("trocar-quadro-foto"); rolar($("trocar-quadro")); }
  else {
    // O separador da 1.ª divisão com respostas em falta (os que faltam ficam marcados).
    escolherDivisao(f.alvo, `tr-${f.alvo}-titulo`);
    $("trocar-msg").scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
  }
  return true;
}
function atualizarAvisoTrocar() {
  if (!avisoTrocar) return;
  const f = faltaNoTrocar();
  if (!f) { mensagemTrocar("Tudo respondido.", "ok"); return; }
  mensagemTrocar(f.texto, "erro");
  avisoTrocar = true;
}

/** Por cima da lista: quantos aparelhos em cada ação (sem "Instalação nova", quantos já têm resposta); fluxo curto: as avarias. */
function desenharProgressoTrocar(planta = plantaDivisoes()) {
  const els = planta.elementos.filter((e) => temAcao(e.tipo, e.props));
  const sv = servicos();
  const p = $("trocar-progresso");
  if (fluxoCurto()) {
    const n = nAvarias(planta);
    p.textContent = n ? `${n} ${n === 1 ? "avaria indicada" : "avarias indicadas"}` : "Sem avarias: toque no aparelho avariado.";
    return;
  }
  const escolher = precisaEscolher(sv);
  const conta = (k) => els.filter((e) => (!escolher || ACOES[e.acao]) && acaoDe(e, sv) === k).length;
  const partes = ORDEM_BOTOES.map((k) => [k, conta(k)]).filter(([, n]) => n).map(([k, n]) => `${ACOES[k].nome}: ${n}`);
  if (estado.quadroAvaria !== null) partes.push("quadro com problemas");
  const resp = els.filter((e) => ACOES[e.acao]).length;
  const topo = escolher ? `${resp} de ${els.length} ${els.length === 1 ? "aparelho com resposta" : "aparelhos com resposta"}` : null;
  p.textContent = [topo, partes.join(" · ")].filter(Boolean).join(" — ") || "Sem aparelhos na planta.";
}

/**
 * Depois de escrever o que se passa numa avaria: o "Falta responder" do cartão, o progresso e a mensagem do passo
 * atualizam-se sem redesenhar os cartões (o campo não perde o foco, e um toque noutro botão não se perde).
 */
function atualizarFaltaTrocar(d) {
  const planta = plantaDivisoes();
  const id = `tr-${d.id}`;
  const cartao = d.id ? $(id) : null;
  if (cartao) {
    const falta = faltaTrocar(planta, d);
    let p = $(`${id}-falta`);
    if (falta.length) {
      if (!p) { p = el("p", "divisao-falta"); p.id = `${id}-falta`; cartao.querySelector(".divisao-botoes")?.before(p); }
      p.textContent = `Falta responder: ${listaPt(falta)}.`;
    } else p?.remove();
  }
  desenharProgressoTrocar(planta);
  atualizarAvisoTrocar();
}

function desenharTrocar() {
  if (estado.passo !== P.trocar) return;
  const planta = plantaDivisoes();
  // Já tenho a planta: a casa guardada, com "Mudar a casa".
  $("trocar-casa").hidden = !funilPlanta();
  $("trocar-casa-texto").textContent = `A sua planta guardada: ${resumoCasa(estado)}`;
  desenharProgressoTrocar(planta);
  desenharQuadroTrocar();
  const c = $("trocar");
  c.replaceChildren();
  if (!planta.divisoes.length) c.append(el("p", "ajuda", "Ainda sem divisões: acrescente-as na planta."));
  // Separadores (com pisos, primeiro o piso) e só o cartão da divisão escolhida (como no passo Divisões).
  const ativa = divisaoDoSeparador(planta);
  if (ativa) {
    const pronta = (d) => !faltaTrocar(planta, d).length;
    c.append(separadoresDivisoes("tr", planta, { feita: pronta, falta: (d) => !pronta(d), avisar: avisoTrocar }));
    c.append(painelSeparador(cartaoTrocar(planta, ativa, "h3"), "tr", ativa));
  }
  desenharAcaoPlanta();
  if (aparelhoTocado) marcarLinhaTocada(aparelhoTocado, false);
  atualizarAvisoTrocar();
}

/** Cartão de uma divisão: os aparelhos com ação (um por tipo; máquinas por modelo), o que falta e "Acrescentar". */
function cartaoTrocar(planta, d, nivel) {
  const id = `tr-${d.id}`;
  const c = el("section", "cartao divisao-cartao");
  c.id = id;
  c.addEventListener("click", (ev) => { if (!ev.target.closest("button, a, input, label")) mostrarNaPlanta(d.id); });
  c.addEventListener("focusin", () => { if (!c.classList.contains("na-planta")) mostrarNaPlanta(d.id); });
  c.setAttribute("aria-labelledby", `${id}-titulo`);
  const topo = el("div", "divisao-topo");
  const t = el(nivel, null, d.nome || "Divisão");
  t.id = `${id}-titulo`;
  t.tabIndex = -1;
  topo.append(t);
  c.append(topo);
  const linhas = linhasDivisao(planta, d).filter((l) => comAcao(l).length);
  if (linhas.length) {
    const ul = el("ul", "aparelhos");
    ul.setAttribute("aria-label", `O que fazer: ${d.nome || "divisão"}`);
    for (const l of linhas) ul.append(linhaTrocar(d, l, planta));
    c.append(ul);
  } else c.append(el("p", "ajuda", "Nada a trocar ou reparar aqui."));
  const falta = faltaTrocar(planta, d);
  if (falta.length) {
    const f = el("p", "divisao-falta", `Falta responder: ${listaPt(falta)}.`);
    f.id = `${id}-falta`;
    c.append(f);
  }
  const bs = el("div", "divisao-botoes");
  const outro = el("button", "btn sec pequeno", "Acrescentar um aparelho");
  outro.type = "button";
  outro.id = `${id}-acrescentar`;
  outro.setAttribute("aria-label", `Acrescentar um aparelho: ${d.nome || "divisão"} (na planta)`);
  outro.addEventListener("click", (ev) => acrescentar(d, null, ev));
  bs.append(outro);
  c.append(bs);
  return c;
}

/** Uma linha: desenho, nome e quantos, a foto e o que fazer (todos ou um a um). */
function linhaTrocar(d, l, planta) {
  const base = `tr-${d.id}-${l.k}`;
  const els = comAcao(l);
  const n = els.length;
  const nome = nomeLinha(l, n);
  const onde = d.nome || "divisão";
  const li = el("li", "aparelho");
  li.id = base;
  const linha = el("div", "aparelho-linha trocar-linha");
  const ic = desenharIcone(svgNovo(), l.tipo, l.modelo ? { modelo: l.modelo } : els[0].props ?? {});
  ic.classList.add("aparelho-icone");
  const txt = el("div", "aparelho-texto");
  txt.append(el("strong", "aparelho-nome-fixo", n > 1 ? `${n} × ${nome.toLowerCase()}` : nome));
  const det = detalheLinha({ ...l, els });
  if (det) txt.append(el("small", null, det));
  linha.append(ic, txt);
  // A foto só no que se troca ou repara (ou a que já foi tirada, ex. nas Divisões de um estado antigo).
  const chave = chaveFoto(planta, d, l);
  const [bf, fotoAcoes] = pedeFoto(els) || fotos.has(chave) ? fotoDaLinha(chave, `${nomeLinha(l)} (${onde})`, base, (ok, texto) => {
    mensagemTrocar(texto, ok === false ? "erro" : "info");
    if (ok === null) return;
    desenharTrocar();
    focar(`${base}-foto`) || focar(`${base}-acao-manter`);
  }) : [null, null];
  if (bf) linha.append(bf);
  li.append(linha);
  if (fotoAcoes) li.append(fotoAcoes);
  // Passou a Novo com dados por responder (ex.: quantos botões): a janela do aparelho, como nas Divisões.
  const pend = els.find((e) => e.por_responder && acaoDe(e, servicos()) === "novo");
  if (pend) {
    const b = el("button", "btn sec pequeno por-responder", "Responder aos dados");
    b.type = "button";
    b.id = `${base}-dados`;
    b.setAttribute("aria-label", `Responder aos dados: ${nomeUm(l).toLowerCase()} (${onde})`);
    b.addEventListener("click", () => abrirJanela(d, pend, b.id));
    li.append(b);
  }
  li.append(...controloAcoes(d, { ...l, els }, els, base, onde, fotos.has(chave)));
  return li;
}

/** Quadro: "Tem algum problema?" (Está bem / Com problemas → o que se passa e a foto) e, sem "Instalação nova", "Quer melhorar o quadro?". */
function desenharQuadroTrocar() {
  const c = $("trocar-quadro");
  c.replaceChildren();
  const t = el("h3", null, "Quadro elétrico");
  t.id = "trocar-quadro-titulo";
  c.setAttribute("aria-labelledby", t.id);   // só com o título já desenhado (antes do passo não existe)
  const topo = el("div", "divisao-topo");
  topo.append(t);
  c.append(topo);
  const grupo = (rotulo, id, opcoes, atual, aoEscolher) => {
    const g = el("div", "acao-inteligente trocar-quadro-grupo");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", rotulo);
    g.append(el("span", null, rotulo));
    for (const [v, txt, cls] of opcoes) {
      const b = el("button", `btn sec pequeno${cls ? ` ${cls}` : ""}`, txt);
      b.type = "button";
      b.id = `${id}-${v}`;
      b.setAttribute("aria-pressed", String(atual === v));
      b.addEventListener("click", () => { aoEscolher(v); agendarGravacao(); desenharTrocar(); focar(b.id); });
      g.append(b);
    }
    return g;
  };
  const comProblemas = estado.quadroAvaria !== null;
  c.append(grupo("Tem algum problema?", "trocar-quadro", [["bem", "Está bem"], ["problemas", "Com problemas (reparar)", "acao-reparar"]], comProblemas ? "problemas" : "bem", (v) => {
    estado.quadroAvaria = v === "problemas" ? (estado.quadroAvaria ?? "") : null;
  }));
  if (comProblemas) {
    const lab = el("label", "acao-avaria");
    lab.append(el("span", null, "O que se passa no quadro?"));
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "trocar-quadro-avaria";
    inp.maxLength = MAX_AVARIA;
    inp.placeholder = "Ex.: o geral dispara, cheira a queimado";
    inp.value = estado.quadroAvaria;
    if (!estado.quadroAvaria.trim()) inp.setAttribute("aria-invalid", "true");
    inp.addEventListener("input", () => {
      estado.quadroAvaria = inp.value.slice(0, MAX_AVARIA);
      if (estado.quadroAvaria.trim()) inp.removeAttribute("aria-invalid"); else inp.setAttribute("aria-invalid", "true");
      agendarGravacao(false);
      desenharProgressoTrocar();
      atualizarAvisoTrocar();
    });
    lab.append(inp);
    c.append(lab);
    // A foto do quadro (a mesma do passo "Quadro elétrico").
    const [bf, fotoAcoes] = fotoDaLinha("quadro", "Quadro elétrico", "trocar-quadro", (ok, texto) => {
      mensagemTrocar(texto, ok === false ? "erro" : "info");
      if (ok === null) return;
      desenharTrocar();
      focar("trocar-quadro-foto");
    });
    if (bf) { c.append(bf, el("p", "ajuda acao-foto-dica falta-foto", "Foto do quadro, porta aberta (obrigatória).")); }
    if (fotoAcoes) c.append(fotoAcoes);
  }
  if (!servicos().includes("nova")) {
    c.append(grupo("Melhorar o quadro?", "trocar-quadro-melhorar", [["nao", "Não"], ["sim", "Sim"]], estado.mexerQuadro ? "sim" : "nao", (v) => {
      estado.mexerQuadro = v === "sim";
      estado.quadro.pacote = pacoteDoQuadro(estado.quadro);
    }));
    if (estado.mexerQuadro && !funilPlanta()) {
      const ir = el("button", "btn sec pequeno", "Perguntas do quadro (passo 5)");
      ir.type = "button";
      ir.id = "trocar-quadro-perguntas";
      ir.addEventListener("click", () => irPara(P.quadro));
      c.append(ir);
    }
  }
}

/**
 * O aparelho tocado na planta (editor aoSelecionarElemento; null sem nenhum). Em "Trocar e reparar": a caixa por baixo
 * da planta passa a ser a dele, e a sua linha na lista fica destacada (no computador rola até ela, sem tirar o foco).
 */
let aparelhoTocado = null;
function aoTocarAparelho(id) {
  aparelhoTocado = id;
  if (estado.passo !== P.trocar) return;
  desenharAcaoPlanta();
  marcarLinhaTocada(id, ecraLargo.matches);
}
function marcarLinhaTocada(id, rolar) {
  for (const x of document.querySelectorAll("#trocar .aparelho.na-planta")) x.classList.remove("na-planta");
  const e = id ? estado.planta.elementos.find((x) => x.id === id) : null;
  if (!e || !e.divisao || !temAcao(e.tipo, e.props)) return;
  const k = e.tipo === "maquina" ? (MODELOS[e.props?.modelo] ? e.props.modelo : "outro") : e.tipo;
  const li = $(`tr-${e.divisao}-${k}`);
  if (!li) return;
  li.classList.add("na-planta");
  if (rolar) li.scrollIntoView({ block: "nearest", behavior: reduzido() ? "auto" : "smooth" });
}
/** A caixa por baixo da planta (só em "Trocar e reparar"): o aparelho tocado, com os botões e o que eles pedem. */
function desenharAcaoPlanta() {
  const caixa = $("planta-acao");
  caixa.replaceChildren();
  const noPasso = estado.passo === P.trocar && !enviado;
  caixa.hidden = !noPasso;
  if (!noPasso) return;
  const e = aparelhoTocado && editor.planta === estado.planta ? elementoDoEstado(aparelhoTocado) : null;
  if (!e || !temAcao(e.tipo, e.props)) {
    caixa.removeAttribute("role");
    caixa.removeAttribute("aria-labelledby");
    caixa.append(el("p", "ajuda", e ? "Nada a trocar aqui: toque noutro aparelho." : "Toque num aparelho da planta."));
    return;
  }
  const d = (e.divisao && estado.planta.divisoes.find((x) => x.id === e.divisao)) || { id: null, nome: "" };
  const modelo = e.tipo === "maquina" ? (MODELOS[e.props?.modelo] ? e.props.modelo : "outro") : null;
  const l = { k: modelo ?? e.tipo, tipo: e.tipo, modelo, els: [e] };
  const onde = d.nome || "fora das divisões";
  const titulo = el("p", "sim-planta-acao-titulo", `${e.nome || nomeUm(l)} · ${onde}`);
  titulo.id = "planta-acao-titulo";
  caixa.setAttribute("role", "group");
  caixa.setAttribute("aria-labelledby", "planta-acao-titulo");
  const cab = el("div", "sim-planta-acao-cabeca");
  cab.append(titulo);
  const base = `pl-${e.id}`;
  const chave = d.id ? chaveFoto(estado.planta, d, l) : null;
  if (chave && (pedeFoto([e]) || fotos.has(chave))) {
    const [bf, comFoto] = fotoDaLinha(chave, `${nomeLinha(l)} (${onde})`, base, (ok, texto) => {
      mensagemTrocar(texto, ok === false ? "erro" : "info");
      if (ok === null) return;
      desenharTrocar();
      focar(`${base}-foto`) || focar(`${base}-acao-manter`);
    });
    cab.append(bf ?? comFoto);   // com foto: a miniatura, "Trocar foto" e "Apagar" (como na lista)
  }
  caixa.append(cab, ...controloAcoes(d, l, [e], base, onde, !chave || fotos.has(chave)));
}

// ------------------------------------------------------------ Avaria (fase 1, funil "Tenho uma avaria")
// Sem planta: onde (Sala, Cozinha…), o que se passa (Tomada sem corrente…), descrição (≤ 200; obrigatória em "Outro"),
// foto obrigatória (FOTO_AVARIA) e urgência (a mesma do passo Enviar, que aqui não se repete). Preço: o diagnóstico.
function montarAvaria() {
  const grupo = (id, nome, opcoes, campo) => $(id).append(...Object.entries(opcoes).map(([k, t]) => escolha("radio", nome, k, t, null, (sim) => {
    if (!sim) return;
    estado.avaria = normalizarAvaria({ ...estado.avaria, [campo]: k });
    agendarGravacao(false);
    desenharAvaria();
  })));
  grupo("avaria-onde", "avaria-onde", AVARIA_ONDE, "onde");
  grupo("avaria-problema", "avaria-problema", AVARIA_PROBLEMA, "problema");
  const NOME_URGENCIA = { normal: "Normal", semana: "Esta semana", urgente: "Urgente" };
  const AJUDA_URGENCIA = { normal: "Sem pressa.", semana: null, urgente: "Sem luz." };
  $("avaria-urgencia").append(...Object.keys(URGENCIAS).map((k) => escolha("radio", "avaria-urgencia", k, NOME_URGENCIA[k], AJUDA_URGENCIA[k], (sim) => {
    if (sim) { estado.urgencia = k; agendarGravacao(false); }
  })));
  $("avaria-descricao").addEventListener("input", () => {
    estado.avaria = normalizarAvaria({ ...estado.avaria, descricao: $("avaria-descricao").value });
    $("avaria-descricao").removeAttribute("aria-invalid");
    agendarGravacao(false);
    if (!$("avaria-msg").hidden) faltaAvaria(true);
  });
}
function desenharAvaria() {
  const a = estado.avaria;
  for (const i of document.querySelectorAll("input[name=avaria-onde]")) i.checked = i.value === a.onde;
  for (const i of document.querySelectorAll("input[name=avaria-problema]")) i.checked = i.value === a.problema;
  for (const i of document.querySelectorAll("input[name=avaria-urgencia]")) i.checked = i.value === estado.urgencia;
  if ($("avaria-descricao").value !== a.descricao) $("avaria-descricao").value = a.descricao;
  $("avaria-descricao-ajuda").textContent = a.problema === "outro" ? "Obrigatória." : "Opcional.";
  desenharFotoAvaria();
  // Preço: o diagnóstico (+ deslocação, que vem da localidade no passo Enviar).
  const pr = $("avaria-preco");
  const { preco, semDesloc } = calcular();
  ultimoPreco = { preco, plano: null };
  pr.hidden = semDesloc.total === null;
  pr.textContent = semDesloc.total === null ? "" : `${textoDiagnostico(semDesloc.total)}. A reparação orça-se na visita.`;
  if (!$("avaria-msg").hidden) faltaAvaria(true);
}
function desenharFotoAvaria() {
  const foto = fotos.get(FOTO_AVARIA);
  const corpo = $("avaria-foto-corpo");
  corpo.replaceChildren();
  const depois = (ok, texto) => {
    const m = $("avaria-foto-msg");
    m.textContent = texto ?? "";
    m.className = `msg ${ok === false ? "erro" : "info"}`;
    m.hidden = !texto;
    if (ok === null) return;
    desenharAvaria();
    focar("avaria-foto-botao");
  };
  if (!foto) {
    const b = el("button", "btn foto-grande");
    b.type = "button";
    b.id = "avaria-foto-botao";
    b.append(iconeCamara(), el("span", null, "Tirar foto da avaria"));
    b.addEventListener("click", () => pedirFoto(FOTO_AVARIA, depois));
    corpo.append(b);
    return;
  }
  const img = el("img", "foto-quadro");
  img.src = foto.miniatura;
  img.alt = "Foto da avaria";
  const bs = el("div", "form-botoes");
  const trocar = el("button", "btn sec pequeno", "Trocar");
  trocar.type = "button";
  trocar.id = "avaria-foto-botao";
  trocar.setAttribute("aria-label", "Trocar a foto da avaria");
  trocar.addEventListener("click", () => pedirFoto(FOTO_AVARIA, depois));
  const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
  apagar.type = "button";
  apagar.setAttribute("aria-label", "Apagar a foto da avaria");
  apagar.addEventListener("click", async () => { await tirarFoto(FOTO_AVARIA); depois(true, "Foto apagada."); });
  bs.append(trocar, apagar);
  corpo.append(img, bs);
}
/** O que falta na avaria (texto e onde pôr o foco), ou null; `atualizar`: só refaz a mensagem que está à vista. */
function faltaAvaria(atualizar = false) {
  const a = estado.avaria;
  const f = !a.onde ? ["Diga onde é a avaria.", "#avaria-onde input"]
    : !a.problema ? ["Diga o que se passa.", "#avaria-problema input"]
      : a.problema === "outro" && !a.descricao.trim() ? ["Descreva a avaria.", "#avaria-descricao"]
        : !fotos.has(FOTO_AVARIA) ? ["Falta a foto da avaria.", "#avaria-foto-botao"] : null;
  const m = $("avaria-msg");
  m.textContent = f ? f[0] : atualizar ? "Tudo respondido." : "";
  m.className = `msg ${f ? "erro" : "ok"}`;
  m.hidden = !f && !atualizar;
  return f;
}
/** Avaria por responder: fica (ou volta) no passo Avaria com a mensagem e o foco no que falta. Devolve true se bloqueou. */
function bloquearAvaria() {
  const f = faltaAvaria();
  if (!f) return false;
  if (estado.passo !== P.avaria) irPara(P.avaria, { foco: false });
  faltaAvaria();
  if (f[1] === "#avaria-descricao") $("avaria-descricao").setAttribute("aria-invalid", "true");
  const alvo = document.querySelector(f[1]);
  alvo?.focus({ preventScroll: true });
  alvo?.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" });
  return true;
}
montarAvaria();

// ------------------------------------------------------------ Melhorias (fase 2)
// 4 cartões (melhorias.js): o que o pacote leva nesta casa, "a partir de" (material + horas × tarifa + margem dos
// pacotes) e a escolha (sim/não). "Quadro seguro" com o quadro já no máximo: "Já incluído", sem escolha. Por baixo, o
// plano mensal sugerido com os pacotes aceites.
function desenharMelhorias() {
  const { melhorias, plano } = calcular();
  const foco = document.activeElement?.closest?.("#melhorias") ? document.activeElement.value : null;
  $("melhorias").replaceChildren(...melhorias.map(cartaoMelhoria));
  if (foco) document.querySelector(`#melhorias input[value="${foco}"]`)?.focus();
  const est = $("melhorias-estado");
  est.textContent = catalogo === undefined ? "A obter os preços…" : catalogo === null ? "Sem preços agora: enviamos o preço depois do pedido." : "";
  est.hidden = !est.textContent;
  $("melhorias-plano").textContent = `Plano sugerido: ${PLANOS[plano].nome}, ${formatarEuro(PLANOS[plano].preco)} por mês.`;
}
function cartaoMelhoria(m) {
  const fixo = m.incluido || m.vazio;
  const l = escolha("checkbox", "melhoria", m.id, m.nome, m.incluido ? "Já incluído" : m.vazio ? "Nada a acrescentar nesta casa" : m.resumo, (sim) => {
    mudarMelhoria(estado, m.id, sim);
    desenharMelhorias();
    agendarGravacao();
    guardarNaConta();
  });
  l.id = `melhoria-${m.id}`;
  l.classList.add("melhoria");
  const i = l.querySelector("input");
  i.checked = m.aceite;
  i.disabled = fixo;
  if (!fixo) l.querySelector("span").append(el("strong", "melhoria-preco num", m.preco === null ? "Preço depois do pedido" : `a partir de ${formatarEuroRedondo(m.preco)}`));
  return l;
}

// ------------------------------------------------------------ 7. Preço
let promessaCatalogo = null;   // o pedido do catálogo em curso (iniciar); o regresso do pagamento espera por ele
async function carregarCatalogo() {
  catalogo = undefined;
  try {
    const r = await fetch(`${urlApi}/catalogo`, { headers: { Accept: "application/json" }, credentials: credenciais });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!j || !Array.isArray(j.itens)) throw new Error("formato");
    catalogo = j.itens.filter((a) => a && typeof a.sku === "string");
    configOrc = j.config && typeof j.config === "object" ? j.config : null;
    // Pagamentos do pedido: faixa "Modo de demonstração" (simulados) e, desligados, "Enviar pedido" sem os 19 €.
    faixaDemonstracao(Boolean(j.pagamentos?.demonstracao));
    // Os textos seguem o estado dos pagamentos no servidor: desligados, nada de 19 € nem de pagar.
    pagamentosAtivos = !(j.pagamentos && j.pagamentos.ativo === false);
    TEXTO_ENVIAR = pagamentosAtivos ? "Pagar 19 € e enviar" : "Enviar pedido";
    if (estado.passo === P.enviar && !aEnviar) $("sim-seguinte").textContent = TEXTO_ENVIAR;
    textosPagamento();
  } catch {
    catalogo = null;
    configOrc = null;
  }
  if (estado.passo === P.preco && !$(`passo-${P.preco}`).hidden) desenharPreco();
  if (estado.passo === P.melhorias && !$(`passo-${P.melhorias}`).hidden) desenharMelhorias();
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharDeslocacao();
}

/** Avaria rápida: o preço é o diagnóstico (DIAG-AVARIA + horas × tarifa) e a deslocação. */
const PEDIDOS_AVARIA = [{ chave: "diagnostico", qtd: 1, acao: "reparar" }];
function calcular() {
  // Fase 2: os pacotes do passo "Melhorias" (melhorias.js) — os aceites juntam as suas linhas (grupo "melhoria") e a
  // margem dos pacotes (`extra`) ao total. A avaria rápida não tem melhorias.
  if (!funilAvaria()) acertarMelhorias(estado);
  const melhorias = funilAvaria() ? [] : calcularMelhorias(estado, catalogo ?? null, configOrc);
  const aceites = melhorias.filter((m) => m.aceite);
  const pedidos = funilAvaria() ? PEDIDOS_AVARIA.map((x) => ({ ...x })) : [...pedidosDaSelecao(estado), ...aceites.flatMap((m) => m.linhas)];
  const extra = aceites.reduce((t, m) => t + (m.margem ?? 0), 0);
  // Local da obra: a localidade do contacto (passo 7) — como em casaParaEnvio. `preco` (o que se envia) já leva a
  // deslocação; `semDesloc` é o do Resumo (passo 6), sem deslocação ("+ deslocação").
  const deslocacao = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc);
  const preco = calcularPreco(pedidos, catalogo ?? null, configOrc, deslocacao, extra);
  const semDesloc = calcularPreco(pedidos, catalogo ?? null, configOrc, { valor_iva: 0 }, extra);
  // "Desligar tudo ao fechar" (serviços/industrial) também é controlar à distância.
  return { pedidos, preco, semDesloc, melhorias, aceites, plano: planoSugerido(pedidos, { distancia: quer("distancia") || quer("desligar") }) };
}

/** "Casa inteligente: 12 interruptores, 6 tomadas — 450 €" (Orçamento e PDF). */
const textoMelhoria = (m) => `${m.nome}: ${m.resumo}${m.preco === null ? "" : ` — ${formatarEuroRedondo(m.preco)}`}`;
/** `simulacao.melhorias` (§6): os pacotes aceites, com os SKUs do catálogo. */
const melhoriasParaEnvio = (aceites) => aceites.map((m) => ({
  id: m.id, nome: m.nome, itens: m.itens.map((i) => ({ sku: linhaArtigo(i.chave).sku, qtd: i.qtd })).filter((i) => i.sku), preco: m.preco,
}));

/** SKU e horas por unidade de um pedido (lista de trabalho do relatório técnico; Substituir: as horas de troca). */
function linhaArtigo(chave, acao) {
  const a = encontrarArtigo(chave, catalogo ?? null);
  const horas = !a ? null : acao === "substituir" ? horasTroca(a) : Number.isFinite(Number(a.horas_instalacao)) ? Number(a.horas_instalacao) : null;
  return { sku: a?.sku ?? PEDIDOS[chave]?.sku ?? null, horas };
}

/** Área de cliente: os dados da casa (passo 1 saltado) com "Editar" para voltar a esse passo. */
function desenharCasaResumo() {
  const c = $("preco-casa");
  c.hidden = !codigoCliente;
  if (!codigoCliente) return;
  c.replaceChildren();
  const k = estado.casa;
  const topo = el("div", "sim-casa-topo");
  const editar = el("button", "btn sec pequeno", "Editar");
  editar.type = "button";
  editar.id = "preco-casa-editar";
  editar.setAttribute("aria-label", "Editar os dados da casa (passo 2)");
  editar.addEventListener("click", () => irPara(P.casa));
  topo.append(el("h3", null, "A casa"), editar);
  const dl = el("dl", "sim-casa-dados");
  const linha = (t, v) => dl.append(el("dt", null, t), el("dd", null, v));
  linha("Tipo", TIPOS_CASA[k.tipo] ?? "Não indicado");
  if (negocio()) {
    linha("Área e espaços", `${k.area_m2} m² · ${k.espacos} ${k.espacos === 1 ? "espaço" : "espaços"}`);
  } else if (k.tipologia) {
    const partes = [k.tipologia === "T5+" ? `T${quartosDe(k)}` : k.tipologia, `${k.casas_banho} ${k.casas_banho === 1 ? "casa de banho" : "casas de banho"}`];
    if (k.tipologia !== "T0") partes.push(`${k.salas} ${k.salas === 1 ? "sala" : "salas"}`);
    partes.push(`${k.pisos} ${k.pisos === 1 ? "piso" : "pisos"}`);
    const extras = Object.entries(EXTRAS_CASA).filter(([x]) => k.extras[x]).map(([, t]) => t.toLowerCase());
    linha("Tipologia", [...partes, ...extras].join(" · "));
    // Com 2 ou mais pisos, o que tem cada piso.
    for (const [p, f] of (porPisoCasa() ?? []).entries()) {
      linha(nomePiso(p), [resumoPiso(f, k.tipologia), ...Object.entries(EXTRAS_CASA).filter(([x]) => f.extras[x]).map(([, t]) => t.toLowerCase())].join(" · "));
    }
  } else {
    linha("Divisões", k.divisoes ? String(k.divisoes) : "Não indicado");
  }
  linha("Potência contratada", `${String(k.potencia_contratada_kva ?? POTENCIA_OMISSAO_KVA).replace(".", ",")} kVA`);
  linha("Ligação", FASES[k.fases] ?? FASES[fasesSugeridas(estado)]);
  c.append(topo, dl);
}

/**
 * "O que inclui": lista curta em linguagem simples a partir dos mesmos pedidos do preço (sem artigos, códigos,
 * horas nem cabos; esses vão no pedido para o relatório técnico).
 */
function listaInclui(pedidos) {
  // Os aparelhos novos (as linhas sem ação); Reparar e Substituir à parte (lote 7); as Melhorias têm a sua lista.
  const novos = pedidos.filter((p) => !p.acao && p.grupo !== "melhoria");
  const q = (k) => novos.filter((p) => p.chave === k || p.chave.startsWith(`${k}_`)).reduce((s, p) => s + p.qtd, 0);
  const qa = (a) => pedidos.filter((p) => p.acao === a).reduce((s, p) => s + p.qtd, 0);
  const itens = [];
  const add = (n, um, varios) => { if (n > 0) itens.push(n === 1 ? um : `${n} ${varios}`); };
  add(qa("reparar"), comVisita("1 reparação (ver a avaria; a peça confirma-se na visita)", "1 reparação (ver a avaria; a peça confirma-se depois)"),
    comVisita("reparações (ver cada avaria; as peças confirmam-se na visita)", "reparações (ver cada avaria; as peças confirmam-se depois)"));
  // Trocas pelo que realmente se troca (acoes.js pedidoDoElemento): "3 tomadas trocadas por inteligentes"…
  const qs = (k) => pedidos.filter((p) => p.acao === "substituir" && (p.chave === k || p.chave.startsWith(`${k}_`))).reduce((s, p) => s + p.qtd, 0);
  add(qs("tomada"), "1 tomada trocada por uma inteligente", "tomadas trocadas por inteligentes");
  add(qs("interruptor"), "1 interruptor trocado por um inteligente", "interruptores trocados por inteligentes");
  add(qs("estore"), "1 estore trocado por um automático", "estores trocados por automáticos");
  add(qs("sensor_movimento"), "1 sensor de movimento trocado", "sensores de movimento trocados");
  add(qs("sensor_porta"), "1 aviso de porta ou janela trocado", "avisos de porta ou janela trocados");
  add(qs("troca_maquina"), "1 máquina trocada (só a ligação)", "máquinas trocadas (só a ligação)");
  add(qs("aparelho_normal"), "1 aparelho trocado por outro", "aparelhos trocados por outros");
  add(q("interruptor"), "1 interruptor inteligente (luzes pelo telemóvel)", "interruptores inteligentes (luzes pelo telemóvel)");
  add(q("estore"), "1 estore automático", "estores automáticos");
  add(q("sensor_movimento"), "1 sensor de movimento", "sensores de movimento");
  add(q("sensor_porta"), "1 aviso de porta ou janela aberta", "avisos de porta ou janela aberta");
  add(q("tomada"), "1 tomada inteligente", "tomadas inteligentes");
  add(q("termostato"), "1 termóstato (aquecimento ou ar condicionado)", "termóstatos (aquecimento ou ar condicionado)");
  const partes = q("disjuntor_protecoes") + q("disjuntor_simples");
  if (partes) itens.push(`Ver quanto gasta e ligar ou desligar ${partes === 1 ? "1 parte" : `${partes} partes`} da casa no telemóvel`);
  const pac = PROTECAO_SIMPLES[pacoteDoQuadro(estado.quadro)]?.[0];
  if (quadroNoPedido({ ...estado, servico: servicos() })) {
    // Quadro novo sem "Instalação nova": os circuitos que já existem passam para ele (estimativa pelas divisões).
    const ex = existentesNoQuadroNovo(estado);
    itens.push(`${pac ? `Proteção ${pac.toLowerCase()}` : "Proteções escolhidas"} no quadro elétrico${levaQuadroNovo(estado.quadro) ? ", com quadro novo" : ""}${ex ? ` (com os ${ex} circuitos que a casa já tem: n.º de circuitos a confirmar${comVisita(" na visita", "")})` : ""}`);
  }
  if (q("central")) itens.push("Central em casa, com bateria e sirene (funciona sem internet)");
  itens.push("Instalação por técnico habilitado");
  return itens;
}

function desenharPreco() {
  desenharObjetivos();   // "O que quer fazer" (neste passo; refeito se o tipo de imóvel mudou)
  desenharCasaResumo();
  const est = $("preco-estado");
  const { pedidos, preco, semDesloc, plano, aceites } = calcular();
  ultimoPreco = { preco, plano, aceites };
  est.hidden = true;
  if (catalogo === undefined) { est.textContent = "A obter os preços…"; est.hidden = false; }
  else if (catalogo === null) { est.textContent = "Sem preços agora: enviamos o preço depois do pedido."; est.hidden = false; }

  const total = $("preco-total");
  total.replaceChildren();
  if (!pedidos.length) {
    total.append(el("p", "sim-intervalo", "Ainda nada para instalar, reparar ou trocar."));
  } else if (semDesloc.min !== null) {
    // Sem deslocação: essa vem da localidade do contacto e mostra-se no passo 7.
    total.append(el("p", "sim-rotulo", "Estimativa com instalação"));
    total.append(el("p", "sim-intervalo num", `${formatarEuroRedondo(semDesloc.min)} – ${formatarEuroRedondo(semDesloc.max)}`));
    if (!foraDaArea()) total.append(el("p", "ajuda", "+ deslocação"));   // fora da área não há deslocação (textoEstimativa)
    if (!semDesloc.completo) total.append(el("p", "ajuda", "Há artigos sem preço: confirmamos depois."));
  } else {
    total.append(el("p", "sim-intervalo", "Vamos enviar-lhe o preço"));
  }
  total.append(el("p", "sim-nota forte", textoEstimativa()));

  const ul = $("preco-inclui");
  ul.replaceChildren(...(pedidos.length ? listaInclui(pedidos) : ["Ainda nada."]).map((t) => el("li", null, t)));
  // Fase 2: os pacotes aceites no passo "Melhorias" (já estão no total).
  $("preco-melhorias-caixa").hidden = !aceites.length;
  $("preco-melhorias").replaceChildren(...aceites.map((m) => el("li", null, textoMelhoria(m))));
  $("preco-nota").textContent = "Preços com IVA incluído.";

  const pl = $("preco-planos");
  pl.replaceChildren();
  for (const [k, p] of Object.entries(PLANOS)) {
    const c = el("div", `cartao sim-plano${k === plano ? " destaque" : ""}`);
    c.dataset.plano = k;
    if (k === plano) c.append(el("span", "etiqueta", "Sugerido"));
    c.append(el("h4", null, p.nome), el("p", "num", `${formatarEuro(p.preco)} por mês`));
    pl.append(c);
  }
  const comSensores = pedidos.some((x) => x.chave === "sensor_porta" || x.chave === "sensor_movimento");
  const razoes = {
    premium: "Premium: tem central em casa.",
    conforto: comSensores ? "Conforto: tem sensores (alarme)." : "Conforto: controlo à distância.",
    base: "Base: ligar, desligar e automatizar.",
  };
  pl.append(el("p", "ajuda", `${razoes[plano]} 1.º mês grátis, sem fidelização.`));
}

/**
 * "Descarregar orçamento (PDF)" (fase 1): feito no navegador (imprimir.js guardarPdfOrcamento) — cabeçalho, data, a
 * casa, a planta (1 página por piso, com as marcas das ações), o que inclui, o intervalo, os planos e a nota. Sem preços
 * de compra nem fornecedores.
 */
function dadosPdfOrcamento() {
  const { pedidos, semDesloc, plano, aceites } = calcular();
  const c = estado.casa;
  const casa = [TIPOS_CASA[c.tipo] ?? null, !negocio() && c.tipologia ? c.tipologia : null].filter(Boolean).join(" ");
  const loc = estado.contacto.localidade.trim();
  return {
    data: new Date(),
    casa: [casa || null, `${estado.planta.divisoes.length} ${estado.planta.divisoes.length === 1 ? "divisão" : "divisões"}`, loc || null].filter(Boolean).join(" · "),
    planta: usaPlanta() ? estado.planta : null,
    pisos: pisosDaCasa(estado.casa),
    omissao: acaoOmissao(servicos()),
    nomesAcoes: NOMES_ACOES,
    inclui: pedidos.length ? listaInclui(pedidos) : [],
    melhorias: aceites.map(textoMelhoria),
    intervalo: pedidos.length && semDesloc.min !== null ? `${formatarEuroRedondo(semDesloc.min)} – ${formatarEuroRedondo(semDesloc.max)}${foraDaArea() ? "" : " + deslocação"}` : null,
    planos: Object.entries(PLANOS).map(([k, x]) => ({ nome: x.nome, preco: `${formatarEuro(x.preco)} por mês`, sugerido: k === plano })),
    nota: "Estimativa; valor final após a visita.",
  };
}
$("preco-pdf").addEventListener("click", async () => {
  const b = $("preco-pdf"), m = $("preco-pdf-msg");
  b.disabled = true;
  m.hidden = true;
  try {
    await guardarPdfOrcamento(dadosPdfOrcamento());
    m.className = "msg ok";
    m.textContent = "Orçamento descarregado.";
  } catch {
    m.className = "msg erro";
    m.textContent = "Não foi possível fazer o PDF. Tente de novo.";
  }
  m.hidden = false;
  b.disabled = false;
});

// ------------------------------------------------------------ 8. Enviar
const CAMPOS = ["nome", "telefone", "email", "localidade", "morada", "mensagem"];
function desenharEnviar() {
  preencherDoPerfil();   // com sessão: também depois de "Continuar" (o estado guardado não tinha o perfil)
  for (const k of CAMPOS) $(`contacto-${k}`).value = estado.contacto[k];
  desenharVisita();
  desenharDeslocacao();
}

/**
 * "A visita" (lote 8, sem passo novo): que dias dão jeito (escolha múltipla; nenhum = qualquer dia), o período
 * (manhã / tarde / qualquer) e a urgência (normal / esta semana / urgente — avaria sem luz). Vão no pedido (§6).
 */
function montarVisita() {
  $("visita-dias").append(...Object.entries(DIAS_VISITA).map(([k, t]) => escolha("checkbox", "visita-dia", k, t, null, (sim) => {
    const s = new Set(estado.visita.dias);
    if (sim) s.add(k); else s.delete(k);
    estado.visita = normalizarVisita({ ...estado.visita, dias: [...s] });
    agendarGravacao(false);
  })));
  $("visita-periodo").append(...Object.entries(PERIODOS_VISITA).map(([k, t]) => escolha("radio", "visita-periodo", k, t, null, (sim) => {
    if (sim) { estado.visita = normalizarVisita({ ...estado.visita, periodo: k }); agendarGravacao(false); }
  })));
  const AJUDA_URGENCIA = { normal: "Sem pressa.", semana: null, urgente: "Sem luz." };
  const NOME_URGENCIA = { normal: "Normal", semana: "Esta semana", urgente: "Urgente" };
  $("visita-urgencia").append(...Object.keys(URGENCIAS).map((k) => escolha("radio", "visita-urgencia", k, NOME_URGENCIA[k], AJUDA_URGENCIA[k], (sim) => {
    if (sim) { estado.urgencia = k; agendarGravacao(false); }
  })));
}
function desenharVisita() {
  $("visita-urgencia-caixa").hidden = funilAvaria();   // na avaria já se pergunta no passo Avaria
  for (const i of document.querySelectorAll("input[name=visita-dia]")) i.checked = estado.visita.dias.includes(i.value);
  for (const i of document.querySelectorAll("input[name=visita-periodo]")) i.checked = i.value === estado.visita.periodo;
  for (const i of document.querySelectorAll("input[name=visita-urgencia]")) i.checked = i.value === estado.urgencia;
}

// ---- Conta de cliente (obrigatória para enviar; docs/CONTA-CLIENTE.md). Com sessão, a simulação fica também
// guardada na conta (ao mudar de passo) para a retomar noutro aparelho; as fotos por enviar ficam só neste navegador.
let contaEu = null;
let contaVista = false;   // já se viu a sessão desta página (a 1.ª vez pode oferecer a simulação da conta)
const blocoConta = criarBlocoConta($("enviar-conta-bloco"), {
  prefixo: "conta",
  texto: { fora: "Crie conta (ou entre) para enviar e acompanhar o pedido." },
  aoMudar: aoMudarConta,
});
function aoMudarConta(eu) {
  const antes = contaEu;
  contaEu = eu;
  const c = eu?.conta;
  preencherDoPerfil();
  $("contacto-email").readOnly = true;
  $("contacto-email-ajuda").textContent = c ? "O da sua conta." : "Fica o da sua conta.";
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharEnviar();
  const primeira = !contaVista;
  contaVista = true;
  if (!c) return;
  if (primeira) oferecerSimulacaoDaConta(eu);
  else if (!antes) guardarNaConta(0);   // entrou agora (no passo Enviar): a simulação desta página vai para a conta
}

/** O perfil da conta preenche o que ainda está vazio no contacto (não apaga o que o cliente escreveu); o email é sempre o da conta. */
function preencherDoPerfil() {
  const c = contaEu?.conta;
  if (!c) return;
  for (const k of ["nome", "telefone", "morada", "localidade"]) if (!estado.contacto[k]?.trim() && c[k]) estado.contacto[k] = c[k];
  estado.contacto.email = c.email;
}

let temporizadorConta = null;
// Enquanto se vê se a conta tem uma simulação mais recente, a desta página não vai para a conta (não grava por cima da
// mais recente). Fica pendente e grava-se depois (decidido).
let aVerConta = false;
const aDecidirRetomar = () => aVerConta;
let contaPendente = false;
/** Já não há escolha por fazer: o que ficou por gravar na conta vai agora, com o estado escolhido. */
function decidido() {
  if (contaPendente && !aDecidirRetomar()) { contaPendente = false; guardarNaConta(0); }
}
/** Guarda o estado do simulador na conta (1,5 s depois; sem imagem de fundo se for grande demais). */
function guardarNaConta(atraso = 1500) {
  if (!contaEu || enviado || pagamentoEmCurso) return;
  if (aDecidirRetomar()) { contaPendente = true; return; }
  clearTimeout(temporizadorConta);
  temporizadorConta = setTimeout(async () => {
    if (!contaEu || enviado) return;
    if (aDecidirRetomar()) { contaPendente = true; return; }
    let e = estadoParaConta();
    if (!e) return;
    if (JSON.stringify(e).length > 1_400_000 && e.planta?.fundo) e = { ...e, planta: { ...e.planta, fundo: null } };
    try {
      await pedirConta("simulacao", { corpo: { estado: e } });
      $("sim-guardado").textContent = "Guardado neste navegador e na sua conta";
    } catch { /* fica no navegador; volta a tentar no passo seguinte */ }
  }, atraso);
}

/**
 * O que vai para a conta: a simulação em curso; sem ela (Início sem nada), a casa guardada (estado `soCasa`, para o
 * cartão "Já tenho a planta" noutro aparelho); sem nenhuma, nada.
 */
function estadoParaConta() {
  if (temProgresso(estado, PASSO_INICIAL)) return { ...estado, guardado: new Date().toISOString() };
  return casaGuardada ? { ...casaGuardada } : null;
}

/**
 * Ao abrir a página com sessão (lote 8, sem perguntar): fica a mais recente entre a deste navegador e a da conta. Se a
 * da conta for mais recente (feita noutro aparelho), passa a ser esta, no passo onde ficou; senão a deste navegador vai
 * para a conta. As fotos ficam no aparelho onde foram tiradas.
 */
async function oferecerSimulacaoDaConta(eu) {
  if (!eu.simulacao_atualizada) { guardarNaConta(0); return; }
  let r;
  aVerConta = true;
  try { r = await pedirConta("simulacao"); } catch { aVerConta = false; contaPendente = false; return; }
  aVerConta = false;
  const daConta = r?.estado ? normalizarEstado(r.estado) : null;
  if (!daConta || enviado) { decidido(); return; }
  const local = carregarEstado(armazem ?? semArmazem);
  const t = (x) => Date.parse(x?.guardado ?? "") || 0;
  // Só a casa (depois de enviar um pedido noutro aparelho): fica como a casa guardada deste navegador, se for mais recente.
  if (daConta.soCasa) {
    if (temCasa(daConta) && t(daConta) > t(casaGuardada)) {
      guardarCasa(armazem ?? semArmazem, daConta, new Date(t(daConta)));
      casaGuardada = carregarCasa(armazem ?? semArmazem) ?? daConta;
      if (estado.passo === P.inicio && !$(`passo-${P.inicio}`).hidden) desenharInicio();
    }
    if (temProgresso(estado, PASSO_INICIAL)) guardarNaConta(0); else decidido();
    return;
  }
  // A deste navegador é a mais recente (e é uma simulação a sério: um estado sem progresso nunca grava por cima da da conta).
  if (local && temProgresso(local, PASSO_INICIAL) && t(local) >= t(daConta) - 1000) { guardarNaConta(0); return; }
  if (!temProgresso(daConta, PASSO_INICIAL)) { decidido(); return; }
  // A da conta é a mais recente: continua-se nela (a deste navegador passa a ser essa).
  acabarAnular();
  estado = daConta;
  visitado = visitadoDe(estado);
  if (estado.passo > P.quer && !funilAvaria()) acertarPedido();
  document.querySelector(".sim-progresso").hidden = false;
  $("sim-form").hidden = false;
  if (contaEu?.conta) estado.contacto.email = contaEu.conta.email;
  mostrarPasso(false);
  agendarGravacao();
  carregarFotosDoEstado();
  $("sim-guardado").textContent = "Continuámos a simulação guardada na sua conta";
  decidido();
}
for (const k of CAMPOS) {
  $(`contacto-${k}`).addEventListener("input", () => {
    estado.contacto[k] = $(`contacto-${k}`).value;
    $(`contacto-${k}`).removeAttribute("aria-invalid");
    $(`contacto-${k}`).removeAttribute("aria-describedby");
    agendarGravacao();
  });
}
ligarLocalidade($("contacto-localidade"));
$("contacto-localidade").addEventListener("input", () => desenharDeslocacao());

/** Passo 7: com a localidade do contacto, a deslocação (§5.1) e o total com ela (o Resumo mostra-o sem). */
function desenharDeslocacao() {
  const { pedidos, preco, semDesloc, plano, aceites } = calcular();
  ultimoPreco = { preco, plano, aceites };
  const caixa = $("enviar-deslocacao");
  const d = preco.deslocacao;
  caixa.replaceChildren();
  if (d.estado === "sem_localidade") { caixa.hidden = true; textosPagamento(); return; }
  const km = d.distancia_km ? ` (cerca de ${d.distancia_km} km)` : "";
  if (d.estado === "fora_area") {
    caixa.append(el("p", null, `${d.concelho}${km}: fora da área servida, sem deslocação.`),
      el("p", "sim-aviso-area", pagamentosAtivos ? "Sem visita técnica: os 19 € pagam só o relatório técnico." : "Sem visita técnica: contactamos para combinar."));
  }
  else if (d.estado === "visita") caixa.append(el("p", null, "Não reconhecemos o concelho: a deslocação é confirmada na visita."));
  else caixa.append(el("p", null, `Deslocação a ${d.concelho}${km}: ${formatarEuro(d.valor_iva)}`));
  textosPagamento();   // fora da área: textos sem visita e sem o bloco "A visita"
  if (funilAvaria()) { if (semDesloc.total !== null) caixa.append(el("p", "num", textoDiagnostico(semDesloc.total))); }
  else if (pedidos.length && preco.min !== null) caixa.append(el("p", "num", `${d.estado === "fora_area" ? "Total sem deslocação" : "Total com deslocação"}: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`));
  caixa.hidden = false;
}

// Contactos configurados de verdade (não os valores de exemplo): os mesmos botões de mostrarEnvio.
const temWhatsapp = () => numeroReal(cfg.whatsapp);
const temTelefone = () => typeof cfg.telefone === "string" && numeroReal(cfg.telefone);
const temEmail = () => typeof cfg.email === "string" && /^[^@\s]+@[^@\s]+$/.test(cfg.email);
/** "pelo WhatsApp, por telefone ou por email" — só os meios mostrados; "" sem nenhum. */
function meiosContacto() {
  const m = [temWhatsapp() && "pelo WhatsApp", temTelefone() && "por telefone", temEmail() && "por email"].filter(Boolean);
  return m.length <= 1 ? m.join("") : `${m.slice(0, -1).join(", ")} ou ${m[m.length - 1]}`;
}

function mostrarEnvio(texto, tipo, comContactos = false) {
  const m = $("enviar-msg");
  m.replaceChildren();
  if (!texto) { m.hidden = true; return; }
  m.append(document.createTextNode(texto));
  if (comContactos) {
    const acoes = el("div", "msg-acoes");
    const { preco } = ultimoPreco ?? {};
    const partes = ["Olá Domus Energia, fiz uma simulação de orçamento no site."];
    if (estado.contacto.nome.trim()) partes.push(`Nome: ${estado.contacto.nome.trim()}`);
    const loc = estado.contacto.localidade.trim() || estado.casa.localidade.trim();
    if (loc) partes.push(`Localidade: ${loc}`);
    if (codigoCliente) partes.push(`Cliente: ${codigoCliente}`);
    if (preco?.min != null) partes.push(funilAvaria() ? textoDiagnostico(preco.artigos_iva + preco.mao_obra_iva) : `Estimativa: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`);
    partes.push(`${estado.divisoes.length} ${estado.divisoes.length === 1 ? "divisão" : "divisões"}.`);
    const texto2 = partes.join("\n").slice(0, 1500);
    if (temWhatsapp()) {
      const w = el("a", "btn sec pequeno", "Enviar pelo WhatsApp");
      w.id = "enviar-whatsapp";
      w.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto2)}`;
      w.target = "_blank";
      w.rel = "noopener";
      acoes.append(w);
    }
    if (temTelefone()) {
      const t = el("a", "btn sec pequeno", `Ligar ${cfg.telefoneVisivel ?? cfg.telefone}`);
      t.href = `tel:${cfg.telefone}`;
      acoes.append(t);
    }
    if (temEmail()) {
      const e = el("a", "btn sec pequeno", "Enviar por email");
      e.href = `mailto:${cfg.email}?subject=${encodeURIComponent("Simulação de orçamento")}&body=${encodeURIComponent(texto2)}`;
      acoes.append(e);
    }
    if (acoes.childElementCount) m.append(acoes);
  }
  m.className = `msg ${tipo}`;
  m.hidden = false;
}

// ---- Pagamento dos 19 € (docs/PAGAMENTOS-PEDIDO.md): enviar = pagar o relatório técnico e a visita (descontados na
// obra). O valor é sempre o do servidor. Volta-se de lá (Stripe ou página simulada) para simulador.html?pagamento=<ref>.
let TEXTO_ENVIAR = "Pagar 19 € e enviar";   // "Enviar pedido" com os pagamentos desligados no servidor (carregarCatalogo)
let pagamentosAtivos = true;                 // GET /api/catalogo `pagamentos.ativo` (até lá, como sempre: com os 19 €)
/** Localidade do contacto fora da área servida: não há visita técnica (nem nos textos, nem "A visita", nem no pedido). */
function foraDaArea() { return calcularDeslocacao(estado.contacto.localidade.trim(), configOrc).estado === "fora_area"; }
/** Os textos que falam da visita: fora da área servida não há visita, usa-se o texto sem ela (`fora`). */
function comVisita(dentro, fora) { return foraDaArea() ? fora : dentro; }
/** A nota da estimativa: com os pagamentos desligados, sem os 19 €; fora da área, sem a visita. */
const textoEstimativa = () => (foraDaArea() ? "Estimativa sem deslocação; valor final combinado consigo." : TEXTO_ESTIMATIVA);
/** Avaria rápida: o preço é sempre o do diagnóstico, fixo (sem intervalo): "Diagnóstico: 42,50 € + deslocação". */
const textoDiagnostico = (valor) => `Diagnóstico: ${formatarEuro(valor)}${foraDaArea() ? "" : " + deslocação"}`;
/** Os textos fixos do passo Enviar e de "Pedido enviado!" com os pagamentos ligados (19 €) ou desligados (e fora da área). */
function textosPagamento() {
  const fora = foraDaArea();
  $("enviar-visita").hidden = fora;
  $("enviar-texto").textContent = pagamentosAtivos
    ? `Enviar custa 19 €: ${fora ? "relatório técnico" : "relatório técnico e visita, descontados na obra"}. * obrigatório`
    : `${fora ? "Enviamos e contactamos consigo." : "Enviamos e contactamos para marcar a visita."} * obrigatório`;
  if (!enviado) {
    $("fim-texto").textContent = fora
      ? "Recebemos o pedido. Vamos contactá-lo em breve. Acompanhe-o na sua conta."
      : "Recebemos o pedido. Vamos contactá-lo para marcar a visita. Acompanhe-o na sua conta.";
  }
}
const regressoPagamento = /^pp_[A-Za-z0-9_-]{22}$/.test(params.get("pagamento") ?? "")
  ? { ref: params.get("pagamento"), cancelado: params.get("cancelado") === "1" } : null;
let pagamentoEmCurso = Boolean(regressoPagamento);   // a meio do pagamento a simulação não vai para a conta

/** Vai pagar: a página simulada do site ou o Stripe Checkout (nada mais). */
function irPagar(pagamento) {
  const url = pagamento?.url;
  if (typeof url === "string" && (/^pagamento-simulado\.html\?ref=pp_[A-Za-z0-9_-]{22}$/.test(url) || url.startsWith("https://checkout.stripe.com/"))) {
    location.assign(url);
    return true;
  }
  return false;
}

/**
 * Regresso do pagamento: a simulação gravada neste navegador volta ao passo Enviar (sem "Continuar onde ficou?");
 * o servidor confirma o pagamento. Pago → fotos (token da resposta) e "Pedido enviado!"; falhou ou cancelou → fica
 * no passo Enviar, com a mensagem e a simulação intacta.
 */
async function retomarDoPagamento(guardado) {
  const { ref, cancelado } = regressoPagamento;
  history.replaceState(null, "", location.pathname);
  estado = guardado;
  visitado = funilAvaria() ? visitadoDe(estado) : maisAdiantado(visitadoDe(estado), P.enviar);
  estado.passo = P.enviar;
  contaVista = true;   // não trocar pela simulação da conta a meio do pagamento
  mostrarPasso(false);
  await carregarFotosDoEstado();
  const botao = $("sim-seguinte");
  aEnviar = true;
  botao.disabled = true;
  botao.textContent = "A confirmar o pagamento…";
  mostrarEnvio("A confirmar o pagamento…", "info");
  let r = null;
  let erro = null;
  try { r = await pedirConta(`pagamentos/${ref}?fotos=1${cancelado ? "&cancelado=1" : ""}`); } catch (e) { erro = e; }
  const p = r?.pagamento;
  if (p?.estado === "pago") {
    // A estimativa de "Pedido enviado!" precisa dos preços: espera pelo catálogo (pedido no arranque, em paralelo).
    await promessaCatalogo;
    desenharPreco();
    const lista = fotosParaEnvio();
    const resultadoFotos = lista.length ? await enviarFotos(lista, r, botao) : null;
    aEnviar = false;
    botao.disabled = false;
    botao.textContent = TEXTO_ENVIAR;
    pagamentoEmCurso = false;
    concluido(ultimoPreco?.preco ?? null, false, resultadoFotos, p);
    return;
  }
  aEnviar = false;
  pagamentoEmCurso = false;
  botao.disabled = false;
  botao.textContent = TEXTO_ENVIAR;
  const texto = erro ? `Não foi possível confirmar o pagamento (${erro.message}) Veja o estado na sua conta antes de pagar outra vez.`
    : p.estado === "pendente" ? (p.modo === "stripe" ? "O pagamento ainda não está confirmado. Se pagou por Multibanco pode demorar: o pedido aparece na sua conta quando for pago." : `O pagamento não foi feito. Carregue em "${TEXTO_ENVIAR}" para continuar.`)
      : p.estado === "falhado" ? `O pagamento falhou. Não foi cobrado nada e a sua simulação está intacta: carregue em "${TEXTO_ENVIAR}" para tentar de novo.`
        : `Cancelou o pagamento. Não foi cobrado nada e a sua simulação está intacta: carregue em "${TEXTO_ENVIAR}" quando quiser.`;
  mostrarEnvio(texto, p?.estado === "pendente" ? "info" : "erro", !erro && p?.estado !== "pendente");
  queueMicrotask(() => $("enviar-msg").scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" }));
}

async function enviar() {
  if (aEnviar) return;
  // Conta obrigatória, com o email confirmado (o painel recusa sem ela: 401/403).
  if (!contaEu?.conta?.confirmado) {
    mostrarEnvio(contaEu ? "Confirme primeiro o seu email: escreva o código que lhe enviámos, em \"A sua conta\"." : "Para enviar, crie uma conta ou entre na sua conta (em \"A sua conta\", em cima).", "erro");
    blocoConta.focar();
    $("enviar-conta").scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
    return;
  }
  estado.contacto.email = contaEu.conta.email;
  const prob = problemaContacto(estado.contacto);
  if (prob) {
    mostrarEnvio(prob.texto, "erro");
    const i = $(`contacto-${prob.campo}`);
    i.setAttribute("aria-invalid", "true");
    i.setAttribute("aria-describedby", "enviar-msg");
    i.focus();
    // A mensagem fica por cima dos campos: garante que se vê (a barra de baixo tapa o fundo do ecrã).
    $("enviar-msg").scrollIntoView({ block: "nearest" });
    return;
  }
  desenharPreco();
  const { preco, plano, aceites } = ultimoPreco;
  const listaFotos = fotosParaEnvio();
  let sim = montarSimulacao(estado, preco, plano, listaFotos, linhaArtigo, melhoriasParaEnvio(aceites ?? []));
  let semFundo = false;
  if (tamanhoSimulacao(sim) > MAX_SIMULACAO && sim.planta?.fundo) {
    sim = { ...sim, planta: { ...sim.planta, fundo: null } };
    semFundo = true;
  }
  if (tamanhoSimulacao(sim) > MAX_SIMULACAO) {
    mostrarEnvio("A simulação é demasiado grande para enviar (máx. 1 MB). Tire alguns elementos da planta ou fale connosco.", "erro", true);
    return;
  }
  const corpo = montarPedido(estado, sim, { codigo: codigoCliente, website: $("contacto-website").value });
  const botao = $("sim-seguinte");
  aEnviar = true;
  botao.disabled = true;
  botao.textContent = "A enviar…";
  mostrarEnvio(semFundo ? "A imagem de fundo era grande demais: enviamos a planta sem ela." : null, "info");
  let estadoHttp = 0;
  let erro = null;
  let resposta = null;
  try {
    const r = await fetch(`${urlApi}/orcamento`, {
      method: "POST",
      credentials: credenciais,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
    });
    estadoHttp = r.status;
    try { resposta = await r.json(); } catch { resposta = null; }
    erro = resposta?.erro ?? null;
  } catch {
    estadoHttp = 0;
  }
  if (estadoHttp >= 200 && estadoHttp < 300 && resposta?.pagamento) {
    // Pagar os 19 € (docs/PAGAMENTOS-PEDIDO.md): o pedido fica no servidor "a aguardar pagamento"; a simulação fica
    // gravada neste navegador e volta-se aqui (simulador.html?pagamento=<ref>) para confirmar e enviar as fotos.
    pagamentoEmCurso = true;
    clearTimeout(temporizadorConta);
    gravar();
    if (irPagar(resposta.pagamento)) return;
    pagamentoEmCurso = false;
    aEnviar = false;
    botao.disabled = false;
    botao.textContent = TEXTO_ENVIAR;
    mostrarEnvio("Não foi possível abrir a página de pagamento. Tente de novo daqui a pouco.", "erro", true);
    return;
  }
  if (estadoHttp >= 200 && estadoHttp < 300) {
    // O pedido foi aceite; as fotos vão a seguir, uma a uma, com o token de uso único (§6).
    const resultadoFotos = listaFotos.length ? await enviarFotos(listaFotos, resposta, botao) : null;
    aEnviar = false;
    botao.disabled = false;
    botao.textContent = TEXTO_ENVIAR;
    concluido(preco, semFundo, resultadoFotos);
    return;
  }
  aEnviar = false;
  botao.disabled = false;
  botao.textContent = TEXTO_ENVIAR;
  // Erros do servidor: a mensagem (com as alternativas) aparece no ecrã, não escondida por cima.
  queueMicrotask(() => $("enviar-msg").scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" }));
  // Só os meios de contacto que aparecem por baixo da mensagem (mostrarEnvio).
  const fale = meiosContacto();
  if (estadoHttp === 401 || estadoHttp === 403) {
    // A sessão terminou (ou o email ainda não está confirmado): o bloco da conta mostra o que falta.
    await blocoConta.atualizar();
    mostrarEnvio(estadoHttp === 401 ? `A sua sessão terminou. Entre de novo na sua conta e carregue em "${TEXTO_ENVIAR}". A simulação fica guardada.` : "Confirme primeiro o seu email com o código que lhe enviámos, em \"A sua conta\".", "erro");
    blocoConta.focar();
    return;
  }
  if (estadoHttp === 429) mostrarEnvio(`Já recebemos vários pedidos seguidos deste aparelho. Tente de novo daqui a uma hora${fale ? `, ou fale connosco ${fale}` : ""}. A sua simulação fica guardada neste navegador.`, "erro", true);
  else if (estadoHttp === 400) {
    const e = typeof erro === "string" ? erro.trim().slice(0, 200) : "";
    mostrarEnvio(`Há dados em falta ou inválidos${e ? `: ${e}${/[.!?…]$/.test(e) ? "" : "."}` : "."} Verifique o formulário, ou fale connosco.`, "erro", true);
  }
  else if (estadoHttp === 413) mostrarEnvio("A simulação é demasiado grande para enviar. Remova o fundo da planta e tente de novo, ou fale connosco.", "erro", true);
  else mostrarEnvio(`Não foi possível enviar agora. A sua simulação fica guardada neste navegador: tente mais tarde${fale ? `, ou fale connosco ${fale}` : ""}.`, "erro", true);
}

/**
 * Envia as fotos depois do pedido aceite: POST /api/orcamento/fotos, em série, com o token da resposta
 * (`fotos_token`, válido 30 min; no máximo `fotos_max`). Devolve {total, falhas, semToken}.
 */
async function enviarFotos(lista, resposta, botao) {
  const token = typeof resposta?.fotos_token === "string" ? resposta.fotos_token : "";
  if (!token) return { total: lista.length, falhas: lista.length, semToken: true };
  const max = Number.isInteger(resposta.fotos_max) && resposta.fotos_max >= 0 ? Math.min(resposta.fotos_max, MAX_FOTOS) : MAX_FOTOS;
  const envio = lista.slice(0, max);
  let falhas = lista.length - envio.length;
  for (let i = 0; i < envio.length; i++) {
    const texto = `A enviar fotos (${i + 1} de ${envio.length})…`;
    botao.textContent = texto;
    mostrarEnvio(`O pedido foi recebido. ${texto}`, "info");
    const f = envio[i];
    const blob = fotos.get(f.chave)?.blob;
    if (!blob || blob.size > MAX_BYTES_FOTO) { falhas++; continue; }
    try {
      const r = await fetch(`${urlApi}/orcamento/fotos`, {
        method: "POST",
        credentials: credenciais,
        headers: {
          "Content-Type": blob.type === "image/png" ? "image/png" : "image/jpeg",
          Accept: "application/json",
          "X-Fotos-Token": token,
          "X-Foto-Chave": f.chave,
          "X-Foto-Legenda": legendaCabecalho(f.legenda),
        },
        body: blob,
      });
      if (!r.ok) falhas++;
    } catch {
      falhas++;
    }
  }
  mostrarEnvio(null);
  return { total: lista.length, falhas, semToken: false };
}

function concluido(preco, semFundo, resultadoFotos = null, pagamento = null) {
  if (!enviado) textosPagamento();   // o "Pedido enviado!" segue a localidade (fora da área: sem visita)
  enviado = true;
  if (pagamento) {
    $("fim-texto").textContent = pagamento.com_visita === false
      ? `Recebemos a sua simulação e o pagamento de ${formatarEuro(pagamento.valor)} (referência ${pagamento.ref}). O relatório técnico fica pronto na sua conta depois de revisto pela nossa equipa (até 24 h). A sua localidade fica fora da área servida: não há visita técnica.`
      : `Recebemos a sua simulação e o pagamento de ${formatarEuro(pagamento.valor)} (referência ${pagamento.ref}), descontados na obra. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h) e vamos contactá-lo para marcar a visita técnica.`;
    if (pagamento.modo === "simulado") $("fim-texto").textContent += " (Pagamento simulado: não foi cobrado nada.)";
  }
  clearTimeout(temporizador);
  clearTimeout(temporizadorConta);   // o painel já apagou a simulação guardada na conta (foi enviada)
  // A casa fica guardada (funil "Já tenho a planta" no próximo pedido): neste navegador e, com sessão, na conta.
  if (!funilAvaria() && temCasa(estado) && guardarCasa(armazem ?? semArmazem, estado)) {
    casaGuardada = carregarCasa(armazem ?? semArmazem);
    if (contaEu && casaGuardada) pedirConta("simulacao", { corpo: { estado: casaGuardada } }).catch(() => {});
  }
  apagarEstado(armazem ?? semArmazem);
  for (let i = 0; i < PASSOS.length; i++) $(`passo-${i}`).hidden = true;
  $("sim-como").hidden = true;
  fecharPlanta({ foco: false });
  $("sim-planta").hidden = true;
  $("sim-navegacao").hidden = true;
  document.querySelector(".sim-progresso").hidden = true;
  $("passo-fim").hidden = false;
  $("fim-resumo").textContent = preco?.min == null ? "Vamos enviar-lhe o preço depois de analisarmos a simulação."
    : funilAvaria() ? `${textoDiagnostico(preco.artigos_iva + preco.mao_obra_iva)}. A reparação orça-se na visita.`
    : `Estimativa enviada: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}; ${textoEstimativa().replace(/^[^;]*; /, "")}${semFundo ? " (A planta foi sem a imagem de fundo.)" : ""}`;
  if (codigoCliente) { $("fim-voltar").href = "cliente.html"; $("fim-voltar").textContent = "Voltar à área de cliente"; }
  // Fotos: o pedido já foi aceite; diz quantas não foram (o eletricista pode vê-las na visita).
  const ff = $("fim-fotos");
  const r = resultadoFotos;
  ff.hidden = !r;
  if (r) {
    ff.className = `msg ${r.falhas ? "erro" : "ok"}`;
    const mostrar = comVisita("pode mostrá-las ao eletricista na visita.", "combinamos consigo como as enviar.");
    ff.textContent = r.semToken ? `Não foi possível enviar as fotos. O pedido foi recebido: ${mostrar}`
      : r.falhas ? `Não foi possível enviar ${r.falhas} de ${r.total} ${r.total === 1 ? "foto" : "fotos"}. O pedido foi recebido: ${mostrar}`
        : r.total === 1 ? "Recebemos também a foto." : `Recebemos também as ${r.total} fotos.`;
  }
  // O pedido foi aceite: as fotos saem do navegador (com a simulação).
  fotos.clear();
  limparFotos(null);
  $("titulo-fim").focus();
}

/**
 * "Começar de novo" (e "Fazer outra simulação"): apaga TUDO — a casa, o que quer, a planta (com o fundo, a
 * calibração, o anular/refazer, o separador de piso e a vista: editor.limpar), as divisões, o quadro, o
 * contacto e a localidade — e o que estava gravado neste navegador (a única chave é estado.js CHAVE; o
 * código do cliente da área de cliente fica, não é da simulação).
 */
function recomecar({ manterFotos = false } = {}) {
  clearTimeout(temporizador);
  temporizador = null;   // nada pendente: sair ou recarregar não volta a gravar a simulação antiga
  apagarEstado(armazem ?? semArmazem);
  clearTimeout(temporizadorConta);
  contaPendente = false;
  // Também a da conta (fica só a casa guardada, se houver: o cartão "Já tenho a planta").
  if (contaEu) pedirConta("simulacao", { corpo: { estado: casaGuardada ? { ...casaGuardada, guardado: new Date().toISOString() } : null } }).catch(() => {});
  enviado = false;
  aEnviar = false;
  estado = estadoInicial();
  visitado = PASSO_INICIAL;
  ultimoPreco = null;
  pisoQuer = 0;
  pisoCasa = 0;
  divisaoTocada = null;
  aparelhoTocado = null;
  divisaoAtiva = null;
  clearTimeout(temporizadorPlanta);
  pisosEditor = null;
  abertas.clear();
  abertasAcao.clear();
  mensagemServico(null);
  mensagemCasa(null);
  mensagemTrocar(null);
  $("avaria-msg").hidden = true;
  $("avaria-foto-msg").hidden = true;
  fotos.clear();
  // As fotos são da simulação: saem com ela (com "Anular" à vista, só no fim do prazo: acabarAnular).
  if (!manterFotos) limparFotos(null);
  $("fim-fotos").hidden = true;
  editor.limpar();
  mostrarEnvio(null);
  for (const c of document.querySelectorAll(".confirmar")) c.remove();
  $("contacto-website").value = "";
  $("sim-guardado").textContent = "";
  $("quer-maquinas").dataset.perfil = "";   // "Equipamentos" refeito do zero
  $("quer-objetivos").dataset.perfil = "";
}

/** Depois de recomeçar: o Início, com a barra dos passos (lote 8: já não há "Antes de começar"). */
function mostrarInicio() {
  document.querySelector(".sim-progresso").hidden = false;
  $("sim-form").hidden = false;
  mostrarPasso();
}

$("fim-nova").addEventListener("click", () => {
  recomecar();
  $("passo-fim").hidden = true;
  $("sim-navegacao").hidden = false;
  mostrarInicio();
});

/*
 * "Começar de novo" sempre à mão (à direita dos passos), sem confirmação (decisão do dono): recomeça logo (no passo 1,
 * lote 8) e mostra "Simulação apagada · Anular" durante 10 s. "Anular" repõe tudo como estava: o estado
 * (e o que estava gravado no navegador e na conta), as fotos (só saem do IndexedDB no fim do prazo; em memória
 * guarda-se uma cópia), o passo e a planta. Passado o prazo, ou ao tocar no primeiro serviço, fica apagada de vez.
 */
const PRAZO_ANULAR = 10_000;
let anular = null;   // { estado, visitado, fotos, temporizador } enquanto "Anular" está à vista
function recomecarComAnular() {
  acabarAnular();
  const antes = { estado: structuredClone(estado), visitado, fotos: new Map(fotos) };
  recomecar({ manterFotos: true });
  mostrarInicio();
  const a = $("sim-anular");
  const b = el("button", "btn sec pequeno", "Anular");
  b.type = "button";
  b.id = "sim-anular-botao";
  b.addEventListener("click", anularRecomecar);
  a.replaceChildren(el("span", null, "Simulação apagada"), el("span", "sim-anular-sep", " · "), b);
  a.querySelector(".sim-anular-sep").setAttribute("aria-hidden", "true");
  posicionarAnular();
  antes.temporizador = setTimeout(acabarAnular, PRAZO_ANULAR);
  anular = antes;
}
/** O prazo acabou (ou recomeçou a simulação): as fotos da simulação apagada saem do navegador; o aviso sai. */
function acabarAnular() {
  if (!anular) return;
  clearTimeout(anular.temporizador);
  anular = null;
  const comFoco = $("sim-anular").contains(document.activeElement);
  $("sim-anular").replaceChildren();
  if (comFoco) $(`titulo-${estado.passo}`).focus({ preventScroll: true });   // o foco não se perde com o botão
  limparFotos(estado.fotosId ?? null);
}
function anularRecomecar() {
  const a = anular;
  if (!a) return;
  clearTimeout(a.temporizador);
  anular = null;
  $("sim-anular").replaceChildren();
  estado = a.estado;
  visitado = a.visitado;
  for (const [k, v] of a.fotos) fotos.set(k, v);
  mostrarInicio();
  gravar();             // volta a ficar gravada neste navegador…
  guardarNaConta(0);    // …e na conta (com sessão)
}
/** O aviso fica logo por cima da barra de baixo (onde está o "Ver planta"), ao centro dela: nunca tapa "Seguinte". */
function posicionarAnular() {
  const a = $("sim-anular");
  if (!a.childElementCount) return;
  const n = $("sim-navegacao").getBoundingClientRect();
  const v = document.querySelector(".sim-ver-planta")?.getBoundingClientRect();
  const topo = Math.min(innerHeight, n.height ? n.top : innerHeight, v?.height ? v.top : innerHeight);
  a.style.bottom = `${Math.max(16, innerHeight - topo + 8)}px`;
  a.style.left = n.width ? `${n.left + n.width / 2}px` : "";
}
addEventListener("scroll", posicionarAnular, { passive: true });
addEventListener("resize", posicionarAnular);
/** A altura real da barra de baixo vai para --sim-barra-h (scroll-padding-bottom em simulador.css): o que se leva à vista
 * (scrollIntoView "nearest", foco) nunca fica por baixo dela, em todas as larguras. */
function medirBarra() {
  document.documentElement.style.setProperty("--sim-barra-h", `${Math.ceil($("sim-navegacao").getBoundingClientRect().height)}px`);
  posicionarAnular();
}
if (typeof ResizeObserver === "function") new ResizeObserver(medirBarra).observe($("sim-navegacao"));
$("sim-recomecar-topo").addEventListener("click", recomecarComAnular);
addEventListener("pagehide", acabarAnular);

/** O passo mais adiantado de um estado lido (na avaria o que conta é o da primeira vez, que ela não muda). */
const visitadoDe = (e) => (e.funil === "avaria" ? e.visitado ?? 0 : maisAdiantado(e.passo, e.visitado ?? 0));
$("trocar-casa-mudar").addEventListener("click", mudarACasa);

/**
 * `?pacote=casa-inteligente|poupar-energia|seguranca|quadro-seguro` (a página de entrada, fase 3): o pacote fica
 * escolhido nas Melhorias — só enquanto o cliente ainda não chegou a esse passo nem escolheu nenhum.
 */
function preEscolherPacote() {
  const k = params.get("pacote");
  if (!MELHORIAS[k] || estado.melhorias.aceites.length || ordemPasso(visitado) >= ordemPasso(P.melhorias)) return;
  estado.melhorias.aceites = [k];   // o "Quadro seguro" aplica-se ao quadro no cálculo (melhorias.js acertarMelhorias)
}

// ------------------------------------------------------------ arranque
function iniciar() {
  $("ano").textContent = String(new Date().getFullYear());
  montarServico();
  montarVisita();
  casaGuardada = carregarCasa(armazem ?? semArmazem);
  if (modoCliente) {
    document.title = "Ampliar a instalação — Domus Energia";
    document.querySelector(".sim-cabecalho h1").textContent = "Ampliar a instalação";
    const m = $("sim-cliente");
    m.textContent = codigoCliente
      ? `Pedido associado ao cliente ${codigoCliente}.`
      : "Não sabemos o seu código de cliente: entre na área de cliente e use \"Ampliar a instalação\", ou escreva o código na mensagem do último passo.";
    m.hidden = false;
    const v = $("voltar-site");
    v.href = "cliente.html";
    v.querySelector(".so-largo").textContent = "Área de cliente";
    v.querySelector(".so-curto").textContent = "Cliente";
  }
  const guardado = carregarEstado(armazem ?? semArmazem);
  // O catálogo pede-se já (o regresso do pagamento espera por ele para mostrar a estimativa enviada).
  promessaCatalogo = carregarCatalogo();
  if (regressoPagamento && guardado) retomarDoPagamento(guardado);   // volta do pagamento dos 19 €
  else if (guardado && temProgresso(guardado, PASSO_INICIAL)) {
    // Lote 8: retoma logo onde ficou (sem "Continuar onde ficou?").
    estado = guardado;
    visitado = visitadoDe(estado);
    if (estado.passo > P.quer && !funilAvaria()) acertarPedido();   // estados antigos: o pedido segue as regras de agora (sem aparelhos dos objetivos)
    preEscolherPacote();
    mostrarPasso(false);
    carregarFotosDoEstado();
  } else {
    // Sem simulação para continuar: o Início (com a casa guardada, se houver, no cartão "Já tenho a planta").
    if (guardado?.soCasa && temCasa(guardado) && !casaGuardada) { guardarCasa(armazem ?? semArmazem, guardado); casaGuardada = carregarCasa(armazem ?? semArmazem); }
    preEscolherPacote();
    mostrarPasso(false);
    limparFotos(null);   // sem simulação para continuar: fotos que tenham ficado no navegador já não são de nenhuma
  }
  blocoConta.atualizar();   // sessão da conta: passo Enviar e simulação guardada na conta
}

// Exposto só para os testes automáticos (não é usado pela página).
window.__simulador = { get estado() { return estado; }, get editor() { return editor; }, normalizarEstado, entradaFoto, fotos };

iniciar();
