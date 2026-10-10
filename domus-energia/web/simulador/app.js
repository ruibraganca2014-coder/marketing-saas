// Simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md): 11 passos com a planta ao lado de todos (no passo "Planta", à largura toda), progresso guardado
// no navegador, preço a partir do catálogo público e envio para POST /api/orcamento.
// Todos os textos do cliente e do servidor entram só com textContent.

import {
  TIPOS_CASA, MODELOS,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_PEQUENAS, tipologiaDeQuartos,
  contarPlanta, divisoesDaContagem, sugerirCircuitos, circuitoVazio, numerar,
  plantaTemConteudo, formatarW, FASES,
  perfilCasa, maquinasGrandesDe, modelosDoPerfil, tiposDivisaoPara,
  TIPOS_COM_PISOS, nomePiso, pisoDe, caixasDe, COMANDOS, comandoDe,
} from "./regras.js";
import {
  plantaDaCasa, assinaturaCasa, dicasObjetivos, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO,
  acertarPisos, temPorPiso, resumoPiso, divisoesDaCasa, tipoDivisao, acertarPlantaMexida, nomesOutras, LIMITES_OUTRAS,
} from "./casa.js";
import {
  pedidosDaSelecao, calcularPreco, planoSugerido, TEXTO_ESTIMATIVA, formatarEuro, formatarEuroRedondo,
  quadroNoPedido, encontrarArtigo, horasTroca, PEDIDOS, CONFIG_OMISSAO, VISITA_HORAS, cent, comObraMinima, textoIntervalo, textoIntervaloTrabalhos, textoDias,
} from "./preco.js";
import {
  SERVICOS, CHAVES_SERVICO, ACOES, ORDEM_BOTOES, MAX_AVARIA, acaoOmissao, precisaEscolher, temAcao,
  perguntaInteligente, acaoDe, faltaAcao, plantaNovos, pedidoDoElemento, inteligenteDe, plantaInteligentes, perguntaMedicao,
} from "./acoes.js";
import {
  PASSOS, MAX_SIMULACAO, estadoNovo, normalizarEstado, temProgresso, guardarEstado, carregarEstado, apagarEstado,
  lerCodigoCliente, montarSimulacao, montarPedido, problemaContacto, tamanhoSimulacao, potenciaContratada,
  normalizarQuer, fasesSugeridas, POTENCIA_OMISSAO_KVA, potenciaOmissao,
  maquinasParaPlanta, pisosDaCasa, maquinasEscolhidas, quantidadeNoPiso, MAX_QUANTIDADE,
  DIAS_VISITA, PERIODOS_VISITA, URGENCIAS, normalizarVisita,
  PASSO, FUNIS, CHAVES_FUNIL, passosDoFunil, passosDoEstado, IDADES_QUADRO, AVARIA_ONDE, AVARIA_PROBLEMA, ICONES_PROBLEMA, FOTOS_AVARIA, legendaAvaria, avariaPerigosa, normalizarAvaria,
  temCasa, resumoCasa, guardarCasa, carregarCasa, CHAVE_CASA, usarCasa, ordemPasso, maisAdiantado,
  divisaoVista, divisoesPorVer, marcarVista, CAMINHOS, AVARIA_PERIGO, assinaturaDivisoes, assinaturaPasso,
  TIPOS_INVENTARIO, inventarioDivisao, divisoesPorInventariar, marcarNaoTem,
} from "./estado.js";
import { CHAVES_MELHORIA, QUADRO_SEGURO, mudarMelhoria, acertarMelhorias, calcularMelhorias } from "./melhorias.js";
import {
  opcoesCircuitos, protecoesDoPacote, pacoteDoQuadro, levaQuadroNovo, pisosDosQuadros, quadroDoPiso, existentesNoQuadroNovo,
} from "./quadro.js";
import { criarEditor } from "./editor.js";
import { guardarPdfOrcamento, guardarPdfRelatorio } from "./imprimir.js";
import { desenharIcone, desenharPlanta } from "./planta-svg.js";
import { resumoQuadro as resumoDoQuadro } from "./quadro.js";
import { analiseDaCasa } from "./relatorio-casa.js";
import { desenharQuadroCliente } from "./quadro-desenho.js";
import { lerFundo, ErroFundo } from "./fundo.js";
import { sugerirConcelhos, calcularDeslocacao, DESLOCACAO_OMISSAO } from "./deslocacao.js";
import {
  MAX_FOTOS, MAX_BYTES_FOTO, ErroFoto, reduzirFoto, guardarFoto, apagarFoto, lerFotos, limparFotos, novoIdFotos, legendaCabecalho,
} from "./fotos.js";
import { criarBlocoConta, pedirConta, urlPainelApi, credenciais, faixaDemonstracao } from "../conta-comum.js";
import { aplicarEntrada } from "./entrada.js";
import { preEscolherCasa, pedidoEmAndamento, textoPedidoEmAndamento, urlDoPedido } from "../regresso.js";
import { origemContacto } from "../origem.js";
import { ehTelemovel, abrirFotoRemota } from "./fotos-remotas.js";

const cfg = window.DOMUS ?? {};
// Lista de espera (config.js `listaEspera`; decisão do dono, 2026-10-10): o texto do arranque, ou null com ela desligada.
const listaEspera = cfg.listaEspera?.ativa ? String(cfg.listaEspera.arranque ?? "").trim() || "breve" : null;
const ESPERA_QUANDO = listaEspera === "breve" ? "em breve" : `em ${listaEspera}`;
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
/*
 * Escolha em falta (decisão do dono: "só contorno a pulsar", sem mensagem vermelha): o grupo ou cartão que precisa da
 * resposta do cliente fica com um contorno vermelho a pulsar ~2 s (`.em-falta`, simulador.css; com movimento reduzido
 * fica parado 2 s) e `aria-invalid` enquanto dura; a página rola até ele e o foco vai para o 1.º campo dele (ou `foco`:
 * um elemento, um seletor, ou false para não mexer no foco). `texto` (o que falta) vai só para os leitores de ecrã
 * (#sim-falta-leitor). As mensagens ficam para o que não é uma escolha no ecrã (servidor, "Sem ligação", fotos).
 */
// Auditoria (WCAG 3.3.1): o contorno pulsa ~2 s e depois FICA (`.em-falta`, `aria-invalid`, `aria-errormessage` →
// #sim-falta-leitor) até o cliente mexer no grupo (input/change lá dentro: desassinalar) ou mudar de passo. Num <fieldset>
// sem role: role="radiogroup" (só botões de opção) ou "group", com aria-labelledby na legenda (aria-invalid é válido aí).
let nLegenda = 0;
function assinalar(alvo, texto, foco = null) {
  if (!alvo) return;
  if (alvo.tagName === "FIELDSET" && !alvo.hasAttribute("role")) {
    const inputs = [...alvo.querySelectorAll("input")];
    alvo.setAttribute("role", inputs.length && inputs.every((i) => i.type === "radio") ? "radiogroup" : "group");
    const legenda = alvo.querySelector(":scope > legend");
    if (legenda && !alvo.hasAttribute("aria-labelledby")) { legenda.id ||= `legenda-${++nLegenda}`; alvo.setAttribute("aria-labelledby", legenda.id); }
  }
  alvo.classList.remove("em-falta");
  void alvo.offsetWidth;   // reinicia a animação (pulsa outra vez) se já estava assinalado
  alvo.classList.add("em-falta");
  alvo.setAttribute("aria-invalid", "true");
  alvo.setAttribute("aria-errormessage", "sim-falta-leitor");
  const leitor = $("sim-falta-leitor");
  leitor.textContent = leitor.textContent === texto ? `${texto} ` : texto;   // repetido: muda para voltar a ser lido
  if (foco !== false) {
    const f = (typeof foco === "string" ? document.querySelector(foco) : foco) ?? alvo.querySelector("input:not(:disabled), select, textarea, button");
    f?.focus({ preventScroll: true });
  }
  alvo.scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" });
}
/** Tira a marca de "em falta" (o cliente respondeu, ou mudou de passo). */
function desassinalar(alvo) {
  alvo.classList.remove("em-falta");
  alvo.removeAttribute("aria-invalid");
  alvo.removeAttribute("aria-errormessage");
  // Sem nada por responder, o texto para o leitor de ecrã também sai (ficava a ser lido nos passos seguintes).
  if (!document.querySelector(".em-falta")) { const leitor = $("sim-falta-leitor"); if (leitor) leitor.textContent = ""; }
}
const desassinalarTodos = () => { for (const x of document.querySelectorAll(".em-falta")) desassinalar(x); };
for (const ev of ["input", "change", "click"]) document.addEventListener(ev, (e) => {
  if (ev === "click" && !e.target.closest?.("button")) return;   // num clique só os botões do grupo (separadores, "Tirar foto…")
  for (const x of document.querySelectorAll(".em-falta")) if (x.contains(e.target)) desassinalar(x);
}, true);

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
let dicaPlanta = "";   // "Pusemos a placa na Kitchenette — arraste se for noutro sítio." (até à próxima mudança na planta)
let plantaAutoJson = null;   // a planta que desenhámos, como está no editor (para "Anular" até ela voltar a ser a nossa)

const editor = criarEditor($("editor"), {
  aoMudar(p) {
    estado.planta = p;
    estado.plantaSaltada = false;
    // Já não é só a planta que desenhámos: não a refazemos sozinhos — a não ser que "Anular" a tenha deixado outra vez
    // exatamente como a desenhámos (plantaAutoJson).
    estado.plantaAuto = plantaAutoJson !== null && JSON.stringify(p) === plantaAutoJson;
    // Máquinas postas ou tiradas na planta: os cartões de "Equipamentos" seguem-na (querDaPlanta).
    if (querDaPlanta()) { sugerirLigacao(); if (estado.passo === P.quer) desenharQuer(); }
    sitioArrastado();
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
  // Lote 8: as divisões só mudam no passo "A casa" (o passo Planta saiu do funil); nos outros, a dica leva lá.
  aoDivisaoPresa: () => mostrarDivisaoPresa(),
  // Decisão do dono (2026-10-03): o que a casa já tem fica Manter; o que o cliente acrescenta a partir de "Trocar e
  // reparar" (também pela planta, nesse passo e nos seguintes) é trabalho novo: nasce "Novo". Antes disso (Equipamentos,
  // Divisões, Planta) está a dizer o que a casa tem: sem ação.
  acaoAoPor: () => (ordemPasso(estado.passo) >= ordemPasso(P.trocar) ? "novo" : null),
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
  if (enviado || casaPreEscolhida) return;   // o cartão escolhido pela página não é uma simulação em curso: nada a gravar
  const r = guardarEstado(armazem ?? semArmazem, estado);
  // A casa (funil "Já tenho a planta") fica guardada à parte assim que a planta da primeira vez está conferida.
  if (estado.funil === "primeira" && casaDescrita() && temCasa(estado)) {
    if (guardarCasa(armazem ?? semArmazem, estado)) casaGuardada = carregarCasa(armazem ?? semArmazem);
  }
  $("sim-guardado").textContent = r === "ok" ? "Guardado neste navegador"
    : r === "sem_imagem" ? "Guardado (sem a imagem de fundo, que não coube no navegador)"
      : "Não foi possível guardar neste navegador";
}
addEventListener("pagehide", () => { if (temporizador) gravar(); });

// ------------------------------------------------------------ passos
/** Serviço escolhido (Início); sem nenhum ainda, as contas fazem-se como "Instalação nova" (o preço de sempre). */
// Em "Descrever a minha casa" não há serviço (duas partes, 2026-10-04): as contas fazem-se sempre como "Instalação
// nova", mesmo que o estado traga o serviço de um pedido anterior ("Mudar a casa") ou de uma página de anúncio.
const servicos = () => (estado.funil === "primeira" && estado.caminho !== "carregar" ? ["nova"] : estado.servico?.length ? estado.servico : ["nova"]);
/** A casa já foi descrita até ao fim (chegou ao Relatório)? Só então fica guardada e serve para pedir um serviço. */
const casaDescrita = () => ordemPasso(visitado) >= ordemPasso(P.relatorio);
/** O funil (o caso do Início); sem nenhum escolhido, conta como o da primeira vez (barra e tempos). */
const funil = () => estado.funil ?? "primeira";
const funilAvaria = () => estado.funil === "avaria";
/** Lista de espera: o aviso do topo e o da avaria (quem tem uma avaria não pode esperar). */
function avisosEspera() {
  if (!listaEspera) return;
  const topo = $("sim-espera");
  topo.textContent = `As obras começam ${ESPERA_QUANDO}. Até lá pode descrever a casa e ver o relatório grátis. Os pedidos de serviço e de avaria ficam em lista de espera, sem pagar nada.`;
  topo.hidden = false;
  const av = $("avaria-espera");
  av.textContent = `Ainda não fazemos reparações: só ${ESPERA_QUANDO}. Se for urgente ou houver perigo, desligue o disjuntor geral e chame já um eletricista habilitado.`;
  av.hidden = false;
}
const funilPlanta = () => estado.funil === "planta";
/** Os passos do funil, pela ordem da barra, e a posição de um passo nela (-1 fora do funil). */
const sequencia = () => passosDoEstado(estado);
const posicao = (i) => sequencia().indexOf(i);
/**
 * Só "Reparações / avarias" (primeira vez): fluxo curto — salta "Equipamentos", "Planta" e "Divisões" (as avarias
 * marcam-se em "Trocar e reparar", com a planta ao lado).
 */
// Duas partes (2026-10-04): a casa descreve-se sempre por inteiro — o fluxo curto deixou de existir.
const fluxoCurto = () => false;
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
const MINUTOS_CURTO = { 0: 0.5, 1: 0.5, 4: 0.5, 11: 0.5, 6: 1, 10: 1, 7: 0.5, 8: 0.5 };
/** Minutos de um funil inteiro ("~10 min" no cartão do Início e em "Como fazer a simulação"). */
const minutosFunil = (f) => Math.ceil(FUNIS[f].passos.reduce((s, i) => s + (FUNIS[f].minutos[i] ?? 1), 0));
const minutosDe = (i) => (naoPrecisa(i) ? 0 : fluxoCurto() ? MINUTOS_CURTO[i] ?? 1 : FUNIS[funil()].minutos[i] ?? 1);
const minTxt = (m) => (m < 1 ? "½" : String(m));
/** Por baixo do nome: "feito" nos passos para trás, "não precisa" nos saltados, o tempo típico nos que faltam. */
const tempoDe = (i) => (naoPrecisa(i) ? "não precisa" : feito(i) ? "feito" : `~${minTxt(minutosDe(i))} min`);
/** Para trás na barra; as Melhorias e os relatórios só depois de vistos (os estados de antes deles já estavam para lá: estado.js). */
const feito = (i) => posicao(i) < posicao(estado.passo) && !(i === P.melhorias && estado.melhoriasPorVer) && !estado.relatoriosPorVer?.includes(i);
/**
 * Passos da barra a que se pode voltar: os já vistos (na avaria, só os de trás — o passo mais adiantado da primeira vez
 * não conta). O Enviar só pelo "Seguinte". Pela posição no funil (fase 3 da auditoria: no "Já tenho a planta" o
 * Relatório vem depois das Melhorias, ao contrário da ordem geral; um `visitado` fora do funil não dá nada como visto).
 */
const chegou = (i) => (funilAvaria() ? posicao(i) < posicao(estado.passo) : posicao(i) <= posicao(visitado));

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
    li.className = atual ? "atual" : semPasso ? "nao-precisa" : feito(i) ? "feito" : "";
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
      // QA final: sair de "A casa" para a frente pela barra passa pela mesma pergunta do Seguinte (confirmarCasa).
      b.addEventListener("click", () => {
        if (!podeIrPara(i)) return;
        if (estado.passo === P.casa && ordemPasso(i) > ordemPasso(P.casa) && confirmarCasa(i)) return;
        // Sair para a frente pela barra passa pela mesma confirmação do Seguinte (confirmarPasso).
        if (ordemPasso(i) > ordemPasso(estado.passo) && confirmarPasso(i)) return;
        irPara(i);
      });
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
  desenharEstimativaProvisoria();
}

/**
 * Fase 3 da auditoria — estimativa provisória por baixo da barra: a partir do passo a seguir aos Equipamentos (no "Já
 * tenho a planta" desde "Trocar e reparar"), "Estimativa: X–Y € · afina nos passos seguintes", com o estado de agora
 * (a planta automática se ainda não a desenhou: plantaParaContar) e sem deslocação, com os mesmos números do Orçamento
 * (QA final: um só arredondamento, a 5 €, em preco.js).
 * Escondida no Início, em "A casa" e nos Equipamentos (ainda não há dados), na avaria mostra o diagnóstico. Não redesenha nada.
 */
function estimativaProvisoria() {
  if (!catalogo) return null;
  const melhorias = calcularMelhorias(estado, catalogo, configOrc);
  const aceites = melhorias.filter((m) => m.aceite);
  const pedidos = [...pedidosDaSelecao({ ...estado, plantaPontos: plantaParaContar() }), ...aceites.flatMap((m) => m.linhas)];
  if (!pedidos.length) return null;
  const p = comObraMinima(calcularPreco(pedidos, catalogo, configOrc, { valor_iva: 0 }, aceites.reduce((t, m) => t + (m.margem ?? 0), 0)));
  if (p.min === null) return null;
  return { min: p.trabalhos_min, max: p.trabalhos_max };
}
function desenharEstimativaProvisoria() {
  const e = $("sim-estimativa");
  const p = estado.passo;
  let texto = null;
  if (funilAvaria()) {
    if (p !== P.inicio && catalogo) { const { total } = calcularPreco(PEDIDOS_AVARIA.map((x) => ({ ...x })), catalogo, configOrc, { valor_iva: 0 }); if (total !== null) texto = textoDiagnostico(total); }
  } else if (p !== P.inicio && funilPlanta()) {   // em "Descrever a minha casa" não há preços
    const est = estimativaProvisoria();
    if (est) texto = `Estimativa: ${textoIntervalo(est)}${ordemPasso(p) < ordemPasso(P.preco) ? " · afina nos passos seguintes" : ""}`;
  }
  e.textContent = texto ?? "";
  e.hidden = !texto;
}

/** Pode ir para o passo `i` pela barra? (os bloqueios dos passos pelo caminho, como no "Seguinte") */
function podeIrPara(i) {
  if (posicao(i) > 0 && bloquearInicio()) return false;
  if (funilAvaria()) return !(i === P.enviar && bloquearAvaria());
  if (i > P.casa && !funilPlanta() && bloquearCasa()) return false;
  if (estado.passo === P.quer && posicao(i) > posicao(P.quer) && bloquearSitios()) return false;
  if (posicao(P.quadro) >= 0 && posicao(i) > posicao(P.quadro) && bloquearQuadro()) return false;   // a foto do quadro
  if (bloquearInventario(i) || bloquearPorVer(P.trocar, i)) return false;   // o inventário das Divisões; divisão a divisão
  if (ordemPasso(i) > ordemPasso(P.trocar) && bloquearTrocar()) return false;
  return !(ordemPasso(i) > ordemPasso(P.melhorias) && bloquearMelhorias());
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
  if (estado.passo !== de) desassinalarTodos();   // as marcas de "em falta" ficam só no passo onde faltou a escolha
  const porVerAoEntrar = estado.passo !== de ? abrirPrimeiraPorVer() : null;   // divisão a divisão
  mostrarPasso(foco);
  if (porVerAoEntrar) mostrarNaPlanta(porVerAoEntrar);
  agendarGravacao();
  guardarNaConta();   // com sessão: a simulação fica também na conta (retomar noutro aparelho)
}

/** A planta não se vê no Início (o caso ainda não está escolhido) nem na avaria rápida (sem planta). */
/** Ronda A: nem no Relatório (leva a planta dentro e a amostra do completo). */
// Decisão do dono (2026-10-10): nem no Quadro elétrico (é só a foto e a idade; à direita, "Como fotografar o quadro").
const semPlanta = () => [P.inicio, P.relatorio, P.quadro].includes(estado.passo) || funilAvaria();

function mostrarPasso(foco = true) {
  for (let i = 0; i < PASSOS.length; i++) { const s = $(`passo-${i}`); if (s) s.hidden = i !== estado.passo; }   // (o 12 já não existe na página)
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
  // Passo "A casa": a planta é automática (as divisões vêm de "A casa tem…"); a linha das ferramentas fica escondida (CSS).
  $("sim-form").classList.toggle("passo-casa", p === P.casa);
  // Decisão do dono (2026-10-10): em "Equipamentos" e em "Divisões" os botões de porta, janela, quadro, tomada, luz,
  // interruptor e sensores da linha por cima da planta são só o desenho (as máquinas mantêm o nome).
  $("sim-form").classList.toggle("barra-so-icones", p === P.quer || p === P.divisoes);
  textoSeguinte();
  atualizarPlanta();
  if (p === P.inicio) desenharInicio();
  if (p === P.casa) desenharCasa();
  if (p === P.quer) desenharQuer();
  if (p === P.divisoes) desenharDivisoes();
  if (p === P.quadro) desenharQuadro();
  if (p === P.trocar) desenharTrocar();
  if (p === P.melhorias) { estado.melhoriasPorVer = false; desenharMelhorias(); }
  if (estado.relatoriosPorVer?.includes(p)) estado.relatoriosPorVer = estado.relatoriosPorVer.filter((x) => x !== p);
  if (p === P.relatorio) { desenharRelatorio(); desenharCompleto(); }   // fase 3 da auditoria: um só passo "Relatório"
  // Ronda A: a planta à vista fica ajustada e centrada (planta guardada, "Já tenho a planta", outro passo).
  // Nos passos com separadores por divisão, centrada na divisão do separador (decisão do dono, 2026-10-03).
  if (!sem && !centrarNaDivisao()) editor.verTudo();
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

/** Numa avaria a página não é "Simular orçamento" (o cliente quer ajuda, não um orçamento). */
function atualizarTitulo() {
  const titulo = funilAvaria() ? "Pedir ajuda para uma avaria" : "Simular orçamento";
  document.title = `${titulo} | Domus Energia`;
  const h1 = document.querySelector(".sim-cabecalho h1");
  if (h1 && h1.textContent !== titulo) h1.textContent = titulo;
}
function textoSeguinte() {
  $("sim-seguinte").textContent = estado.passo === P.enviar ? TEXTO_ENVIAR : fimDaParteCasa() ? "Concluir" : "Seguinte";
  atualizarTitulo();
  // 3. No Relatório ainda fechado (falta a conta), o "Concluir" não aparece ao lado do "Continuar" da conta.
  $("sim-seguinte").hidden = estado.passo === P.relatorio && relatorioFechado();
}
/** Duas partes (2026-10-04): o Relatório é o último passo de "Descrever a minha casa". */
const fimDaParteCasa = () => estado.passo === P.relatorio && funil() === "primeira";
/**
 * Fim de "Descrever a minha casa": a casa fica guardada e o cliente escolhe — "Pedir um serviço agora" (passa ao funil
 * `planta`, no Início, a escolher o que precisa) ou "Fico por aqui" (volta ao site; a casa fica para quando quiser).
 */
/** A casa descrita vai para a conta e fica "Casa registada" no painel (CRM), com aviso aos CEO na primeira vez. */
async function registarCasaNaConta() {
  if (!contaEu?.conta?.confirmado) return;
  try {
    let e = estadoParaConta();
    if (!e) return;
    if (JSON.stringify(e).length > 1_400_000 && e.planta?.fundo) e = { ...e, planta: { ...e.planta, fundo: null } };
    await pedirConta("simulacao", { corpo: { estado: e } });
    await pedirConta("casa-registada", { corpo: {} });
  } catch { /* fica guardada no navegador; a conta recebe-a no passo seguinte (guardarNaConta) */ }
}
function concluirCasa() {
  gravar();
  const registo = registarCasaNaConta();
  const j = janelaDeConfirmar();
  const botao = botaoDaJanela(j);
  j.querySelector("h2").textContent = "A sua casa está guardada";
  j.querySelector("#casa-janela-corpo").replaceChildren(el("p", null, "Quando precisar de obras, de trocar alguma coisa ou de automatizar, já não tem de a descrever outra vez."));
  j.querySelector("#casa-janela-botoes").replaceChildren(
    botao("btn sec", "Fico por aqui", "casa-fim-sair", () => {
      // Ao voltar, o simulador abre no Início de "Pedir um serviço", com a casa (e não outra vez no Relatório).
      estado.funil = "planta";
      estado.caminho = null;
      estado.passo = P.inicio;
      gravar();
      registo.finally(() => { location.href = codigoCliente ? "cliente.html" : "index.html"; });
    }),
    botao("btn", "Pedir um serviço agora", "casa-fim-servico", () => {
      estado.funil = "planta";
      estado.caminho = null;
      irPara(P.inicio);
      desenharInicio();
    }),
  );
  j.showModal();
  $("casa-fim-servico").focus();
}

/** Os bloqueios de todo o caminho até ao Enviar (o "Seguinte" do Enviar). Devolve true se bloqueou. */
const bloquearTudo = () => bloquearInicio() || (funilAvaria() ? bloquearAvaria() : bloquearCasa() || bloquearInventario() || bloquearQuadro() || bloquearTrocar() || bloquearMelhorias());

$("sim-form").addEventListener("submit", (ev) => ev.preventDefault());
$("sim-anterior").addEventListener("click", () => irPara(passoAo(estado.passo, -1)));
$("sim-seguinte").addEventListener("click", () => {
  if (estado.passo === P.enviar) { if (!bloquearTudo()) enviar(); return; }
  // Do Início só com o caso (e, na primeira vez, um serviço); de "Trocar e reparar" só com o que fazer a cada aparelho
  // respondido; das Divisões só com os interruptores e as tomadas de cada divisão respondidos (decisão do dono,
  // 2026-10-03: verSeguinteDivisao); da Avaria com onde, o que se passa e a foto.
  if (estado.passo === P.inicio && bloquearInicio()) return;
  if (estado.passo === P.casa && confirmarCasa()) return;
  if (estado.passo === P.quadro && bloquearQuadro()) return;   // a foto do quadro é obrigatória
  if (estado.passo === P.quer && bloquearSitios()) return;     // o sítio de cada equipamento confirmado na planta
  // Para lá das Divisões com o inventário por responder (um estado de antes da regra): volta a elas.
  if (estado.passo !== P.divisoes && bloquearInventario(passoAo(estado.passo, 1))) return;
  // Divisões e "Trocar e reparar": primeiro a divisão seguinte ainda por responder / por ver (divisão a divisão).
  if (verSeguinteDivisao()) return;
  if (estado.passo === P.trocar && bloquearTrocar()) return;
  if (estado.passo === P.melhorias && bloquearMelhorias()) return;
  if (estado.passo === P.avaria && bloquearAvaria()) return;
  if (confirmarPasso()) return;   // "Está certo? Sim, continuar" nos passos em que o cliente preenche
  if (fimDaParteCasa()) {
    if (relatorioFechado()) {
      // Com o código já pedido, o que falta é escrevê-lo (não o email outra vez).
      blocoContaRelatorio.mensagem(blocoContaRelatorio.aEsperaDoCodigo() ? "Escreva o código de 6 algarismos que enviámos para o seu email." : "Deixe o seu email para ver o relatório e guardar a casa.");
      blocoContaRelatorio.focar();
      return;
    }
    concluirCasa();
    return;
  }
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
  primeira: "A casa que tem hoje · relatório grátis · ~5 min",
  avaria: "Diagnóstico + deslocação, descontado na reparação.",   // com o catálogo leva o valor (ajudaAvaria)
};
/** A casa para o funil "Já tenho a planta": a desta simulação (se já tem) ou a guardada. */
let casaGuardada = null;   // estado `soCasa` (estado.js carregarCasa), ou null
// A desta simulação só conta depois de descrita até ao Relatório (ou já em "Pedir um serviço"): uma casa a meio não
// serve. Na área de cliente (com código) a casa é a instalada: não tem tipo de imóvel, basta a planta.
const casaAqui = () => !estado.soCasa && (codigoCliente ? estado.planta.divisoes.length > 0 : temCasa(estado)) && (estado.funil === "planta" || casaDescrita());
const casaParaPlanta = () => (casaAqui() ? estado : casaGuardada ?? (estado.soCasa && temCasa(estado) ? estado : null));
/*
 * Cliente que regressa (decisão 1 do dono, 2026-10-04; ../regresso.js preEscolherCasa): numa simulação NOVA com casa
 * guardada (neste navegador ou na conta) o Início abre com o cartão "Já tenho a planta" já escolhido e a frase
 * "Encontrámos a sua casa: …" — o cliente só escolhe o que precisa. Escolhe-se uma vez: outro cartão troca como sempre
 * e fica; depois de "Começar de novo" (o cliente quis começar do zero) não se volta a escolher nesta página.
 * Enquanto a escolha é só da página não conta como simulação em curso: não se grava no navegador nem na conta (não vai
 * por cima da casa/simulação guardada lá).
 */
let casaPreEscolhida = false;   // o cartão está escolhido pela página, ainda não pelo cliente
let casaEncontrada = false;     // a frase "Encontrámos a sua casa" (desta simulação, até recomeçar)
let semCasaParaServico = false; // escolheu "Pedir um serviço" sem casa guardada: a frase que o leva a descrever a casa
let recusouCasa = false;        // "Começar de novo" nesta página
/** Há simulação em curso? (o cartão escolhido pela página não conta) */
const emCurso = () => !casaPreEscolhida && temProgresso(estado, PASSO_INICIAL);
/** Escolhe o cartão da casa guardada, se for o caso. Devolve true se escolheu (quem chama volta a desenhar). */
function preEscolher() {
  if (!preEscolherCasa({ funil: estado.funil, temCasa: !!casaParaPlanta(), recusou: recusouCasa })) return false;
  estado.funil = "planta";
  estado.caminho = null;
  casaPreEscolhida = true;
  casaEncontrada = true;
  return true;
}
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
  // Ronda A: "Já tenho a planta" → o que precisa; "Tenho uma avaria" → o que se passa (o mesmo campo do passo Avaria).
  $("caminhos").append(...CAMINHOS.map((k) => {
    const [t, a] = TEXTOS_CAMINHO[k];
    const l = escolha("radio", "caminho", k, t, a, (sim) => { if (sim) escolherCaminho(k); }, iconeDe(ICONES_CAMINHO[k]));
    l.id = `caminho-${k}`;
    l.dataset.caminho = k;
    return l;
  }));
  $("inicio-problema").append(...Object.entries(AVARIA_PROBLEMA).map(([k, t]) => {
    const l = escolha("checkbox", "inicio-problema", k, t, null, (sim) => escolherProblema(k, sim), iconeDe(ICONES_PROBLEMA[k] ?? ICONES_PROBLEMA.outro));
    l.id = `inicio-problema-${k}`;
    return l;
  }));
  $("planta-ficheiro").addEventListener("change", carregarPlanta);
  ajudaAvaria();
  avisosEspera();
}
const TEXTOS_CAMINHO = {
  automatizar: ["Automatizar o que já tenho", "Tornamos inteligente o que existe."],
  reparar: ["Reparações", "Trocar ou arranjar o que não funciona."],
  quadro: ["Trocar o quadro elétrico", "Quadro novo com as proteções de hoje."],
  obras: ["Obras ou instalação nova", "Acrescentar tomadas, luzes ou circuitos."],
  carregar: ["Tenho a planta em PDF ou foto", "Carregue-a e marque os aparelhos por cima."],
};
const ICONES_CAMINHO = {
  automatizar: ICONES_SERVICO.automatizar,
  reparar: ICONES_SERVICO.reparar,
  quadro: ["M12 7h24v34H12z", "M17 13v8M23 13v8M29 13v8", "M17 29h14", "M25.5 31.5 22 37h3l-1 4"],
  obras: ICONES_SERVICO.nova,
  carregar: ["M13 6h15l8 8v28H13z", "M28 6v8h8", "M24.5 36V22M19 27.5l5.5-5.5 5.5 5.5"],
};
// ICONES_PROBLEMA (os 7 problemas) vem de estado.js: partilhado com o passo Avaria e o quadro em Trocar e reparar.
/**
 * Escolher o caso: a primeira vez e a avaria começam do zero se só havia a casa guardada; "Já tenho a planta" (ronda A:
 * sempre ativo) mostra "O que precisa?" por baixo — a casa só se usa ao escolher (escolherCaminho). Começou outra
 * simulação: a apagada já não se pode repor.
 */
function escolherFunil(k) {
  casaPreEscolhida = false;   // a escolha passa a ser do cliente
  acabarAnular();
  mensagemPlanta(null);
  // Duas partes (2026-10-04): "Pedir um serviço" sem casa guardada leva primeiro a "Descrever a minha casa".
  semCasaParaServico = k === "planta" && !casaParaPlanta();
  if (semCasaParaServico) k = "primeira";
  if (k === "planta") {
    if (estado.funil !== "planta") { estado.funil = "planta"; estado.caminho = null; }
  } else {
    if (estado.soCasa) { const e = estadoInicial(); e.contacto = estado.contacto; e.melhorias = estado.melhorias; estado = e; visitado = PASSO_INICIAL; }
    estado.funil = k;
    estado.caminho = null;
    estado.soCasa = false;
  }
  // A avaria rápida não tem Melhorias: sai o pacote escolhido pelo `?pacote=` (o Quadro seguro repõe o quadro).
  if (k === "avaria") for (const id of [...estado.melhorias.aceites]) mudarMelhoria(estado, id, false);
  editor.definirAcoes(acaoOmissao(servicos()));
  desenharInicio();
  desenharProgresso();
  atualizarTitulo();
  agendarGravacao();
}
/**
 * Ronda A — "Já tenho a planta" → o que precisa: automatizar ou reparações seguem no funil "planta" com a casa guardada
 * e esse serviço; obras passa ao funil da primeira vez com a casa guardada (A casa, Planta…); carregar abre a escolha
 * do ficheiro (o caminho só muda quando a planta fica carregada: carregarPlanta).
 */
function escolherCaminho(k) {
  acabarAnular();
  mensagemPlanta(null);
  if (k === "carregar") { $("planta-ficheiro").click(); return; }
  const c = casaParaPlanta();
  if (!c) { desenharInicio(); return; }
  casaPreEscolhida = false;   // o cliente escolheu o que precisa: passa a ser uma simulação em curso
  usarCasa(estado, c);
  estado.plantaAuto = false;   // a casa guardada nunca é redesenhada sozinha
  estado.caminho = k;
  estado.servico = [k === "obras" ? "nova" : k === "quadro" ? "reparar" : k];   // duas partes (2026-10-04): as obras também seguem na parte do serviço
  if (k === "quadro") {
    // Trocar o quadro: quadro novo no pedido; a proteção escolhe-se nas Melhorias (o passo seguinte).
    estado.mexerQuadro = true;
    estado.quadro.quadro_novo = "novo";
    estado.quadro.pacote = pacoteDoQuadro(estado.quadro);
  }
  visitado = maisAdiantado(visitado, estado.visitado ?? 0, P.planta);
  estado.visitado = visitado;
  acertarPedido();
  pisosEditor = null;
  editor.definirAcoes(acaoOmissao(servicos()));
  desenharInicio();
  desenharProgresso();
  agendarGravacao();
}
/**
 * "Carregar a planta — PDF ou foto": a 1.ª página do PDF (pdf.js) ou a foto passa a planta de fundo (fundo.js, como o
 * "Planta de fundo" do editor) e segue-se no funil da primeira vez a partir de "A casa", a desenhar as divisões por cima.
 * Sem simulação da primeira vez em curso começa uma nova (fica o contacto).
 */
async function carregarPlanta() {
  const input = $("planta-ficheiro");
  const f = input.files?.[0];
  input.value = "";
  if (!f) return;
  mensagemPlanta("A preparar a planta…", "info");
  let r;
  try {
    r = await lerFundo(f);
  } catch (e) {
    mensagemPlanta(e instanceof ErroFundo ? e.message : "Não foi possível usar este ficheiro. Experimente uma foto (JPG ou PNG).", "erro");
    return;
  }
  casaPreEscolhida = false;
  acabarAnular();
  if (estado.soCasa || estado.funil !== "primeira") {
    const e = estadoInicial();
    e.contacto = estado.contacto;
    e.melhorias = estado.melhorias;
    estado = e;
    visitado = PASSO_INICIAL;
    pisosEditor = null;
  }
  estado.funil = "primeira";
  estado.caminho = "carregar";
  editor.definirAcoes(acaoOmissao(servicos()));
  if (editor.planta !== estado.planta) editor.abrir(estado.planta);
  editor.usarFundo(r);   // → aoMudar: estado.planta com o fundo
  // Decisão do dono: sem serviço por omissão — "O que precisa?" (os serviços) aparece por baixo; o Seguinte vai a "A casa".
  mensagemPlanta("Planta carregada. Agora diga o que precisa.", "ok");
  desenharInicio();
  desenharProgresso();
  agendarGravacao();
  document.querySelector("#servicos input")?.focus({ preventScroll: true });
}
function mensagemPlanta(texto, tipo = "erro") {
  const m = $("planta-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${texto ? tipo : ""}`;
  m.hidden = !texto;
}
/** "Tenho uma avaria" → o que se passa: várias escolhas (estado.avaria.problema, lista de chaves; o mesmo do passo Avaria). */
const problemasAvaria = () => [].concat(estado.avaria.problema ?? []);
function escolherProblema(k, sim) {
  const l = new Set(problemasAvaria());
  if (sim) l.add(k); else l.delete(k);
  estado.avaria = normalizarAvaria({ ...estado.avaria, problema: [...l] });
  desenharPerigo();
  agendarGravacao(false);
}
/**
 * Conselho de segurança da avaria (decisão do dono, 2026-10-10): disjuntor que dispara → não o voltar a ligar; cheiro
 * a queimado, faíscas ou choque → desligar o geral e, com fumo ou fogo, 112. null sem nenhum destes problemas.
 */
function conselhoSeguranca(problemas) {
  const perigo = problemas.some((k) => AVARIA_PERIGO.includes(k));
  const dispara = problemas.includes("disjuntor");
  if (!perigo && !dispara) return null;
  return ["Por segurança:",
    dispara ? "não volte a ligar o disjuntor que disparou e desligue os aparelhos dessa zona." : null,
    perigo ? `${dispara ? "Com" : "com"} cheiro a queimado, faíscas ou choque, desligue o disjuntor geral e não o volte a ligar até o eletricista ver. Se houver fumo ou fogo, ligue 112.` : null,
  ].filter(Boolean).join(" ");
}
/** O conselho de segurança no Início, com os contactos (se há). */
function desenharPerigo() {
  const c = $("inicio-perigo");
  const conselho = estado.funil === "avaria" ? conselhoSeguranca(problemasAvaria()) : null;
  c.hidden = !conselho;
  if (c.hidden) return;
  c.replaceChildren(el("strong", null, conselho));
  const acoes = el("div", "msg-acoes");
  if (temTelefone()) {
    const t = el("a", "btn sec pequeno", `Ligar ${cfg.telefoneVisivel ?? cfg.telefone}`);
    t.href = `tel:${cfg.telefone}`;
    acoes.append(t);
  }
  if (temWhatsapp()) {
    const w = el("a", "btn sec pequeno", "WhatsApp");
    w.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Olá Domus Energia, tenho uma avaria: ${problemasAvaria().map((k) => AVARIA_PROBLEMA[k]).join(", ")}.`)}`;
    w.target = "_blank";
    w.rel = "noopener";
    acoes.append(w);
  }
  if (acoes.childElementCount) c.append(acoes);
}
/** Muda o serviço: a omissão das ações muda (e com ela o pedido: só os Novos entram nos circuitos e nas linhas). */
function mudarServico(lista) {
  acabarAnular();   // começou outra: a apagada já não se pode repor
  estado.servico = lista;
  if (visitado > P.quer) acertarPedido();   // o pedido já foi preparado: segue as ações novas
  editor.definirAcoes(acaoOmissao(servicos()));
  desenharProgresso();
  desenharComo();
  agendarGravacao();
}
/**
 * O Início: os cartões (o da casa guardada destacado), os serviços (primeira vez), o que precisa (já tenho a planta:
 * sem casa guardada só "Carregar a planta"), o que se passa (avaria) e "Como fazer a simulação".
 */
function desenharInicio() {
  const c = casaParaPlanta();
  const cartao = $("funil-planta");
  // Fase 3 da auditoria: sem casa guardada o cartão só promete o que há — carregar a planta e seguir o funil da primeira
  // vez (~12 min); com casa guardada, continuar com ela (~5 min).
  cartao.querySelector("small").textContent = c ? `Com a sua casa: ${resumoCasa(c)} · ~${minutosFunil("planta")} min` : `Obras, trocar ou automatizar · ~${minutosFunil("planta")} min`;
  cartao.classList.toggle("destaque-casa", !!c && (!estado.funil || casaPreEscolhida));
  // Cliente que regressa (2026-10-04): a frase da casa encontrada, por cima dos cartões (fica até recomeçar: não salta ao escolher).
  const frase = casaEncontrada && c ? `Encontrámos a sua casa: ${resumoCasa(c)}.` : semCasaParaServico && !c ? `Para pedir um serviço, descreva primeiro a sua casa (~${minutosFunil("primeira")} min).` : "";
  if ($("inicio-casa").textContent !== frase) $("inicio-casa").textContent = frase;
  $("inicio-casa").hidden = !frase;
  const caso = estado.funil;
  for (const i of document.querySelectorAll("#funis input")) i.checked = i.value === caso;
  // Planta carregada: os serviços por baixo da escolha (sem serviço por omissão).
  // Duas partes (2026-10-04): a casa descreve-se sem escolher serviço (só um estado de antes, com a planta carregada, ainda os mostra).
  $("servicos-caixa").hidden = estado.caminho !== "carregar";
  $("servicos-legenda").textContent = estado.caminho === "carregar" ? "E o que precisa fazer?" : "O que precisa?";
  for (const i of document.querySelectorAll("#servicos input[type=checkbox]")) i.checked = estado.servico.includes(i.value);
  $("planta-caixa").hidden = caso !== "planta";
  for (const l of $("caminhos").children) l.hidden = l.dataset.caminho === "carregar" || !c;   // a planta em PDF/foto carrega-se no "⋯" da planta (Planta de fundo)
  for (const i of document.querySelectorAll("#caminhos input")) i.checked = i.value === estado.caminho;
  $("problema-caixa").hidden = caso !== "avaria";
  for (const i of document.querySelectorAll("#inicio-problema input")) i.checked = problemasAvaria().includes(i.value);
  desenharPerigo();
  desenharComo();
}
/**
 * "Como fazer a simulação · ~N min" e os passos numerados do funil escolhido (sem nenhum, os da primeira vez), com as
 * contas da barra: no fluxo curto sem os passos que "não precisa" (os números são os da barra).
 */
function desenharComo() {
  // "Já tenho a planta" sem casa guardada: o único caminho é carregar a planta e seguir a primeira vez — é esse que se mostra.
  const f = funilPlanta() && !estado.caminho && !casaParaPlanta() ? "primeira" : funil();
  const seq = FUNIS[f].passos;
  const minutos = (i) => (f === funil() ? minutosDe(i) : FUNIS[f].minutos[i] ?? 1);
  $("sim-como-titulo").textContent = `Como fazer a simulação · ~${Math.ceil(seq.reduce((s, i) => s + minutos(i), 0))} min`;
  $("sim-como-passos").textContent = seq.map((i, k) => (f === funil() && naoPrecisa(i) ? null : `${k + 1} ${PASSOS[i]}`)).filter(Boolean).join(" · ");
}
/** Sem caso escolhido (ou, na primeira vez, sem serviço): fica (ou volta) no Início e assinala o grupo que falta. Devolve true se bloqueou. */
function bloquearInicio() {
  const falta = !estado.funil ? ["Escolha o seu caso.", "funis", "#funis input"]
    : estado.funil === "primeira" && estado.caminho === "carregar" && !estado.servico.length ? ["Escolha pelo menos um serviço.", "servicos-caixa", "#servicos input"]
      : estado.funil === "planta" && !estado.caminho ? ["Escolha o que precisa.", "planta-caixa", "#caminhos label:not([hidden]) input"]
        : estado.funil === "avaria" && !problemasAvaria().length ? ["Diga o que se passa.", "problema-caixa", "#inicio-problema input"] : null;
  if (!falta) return false;
  if (estado.passo !== P.inicio) irPara(P.inicio, { foco: false });
  assinalar($(falta[1]).closest("fieldset"), falta[0], falta[2]);
  return true;
}

// ------------------------------------------------------------ 2. A casa
/**
 * Tipo de imóvel e tipologia vêm por escolher (decisão do dono). Falta escolher? (Não na área de cliente com código,
 * que salta a casa; um estado antigo sem tipologia mas com o n.º de divisões também já serve.)
 */
const casaPorEscolher = () => !codigoCliente
  && (!estado.casa.tipo || (!negocio() && !estado.casa.tipologia && estado.casa.divisoes == null));
/** Sem tipo ou tipologia: volta (ou fica) no passo "A casa" e assinala o grupo que falta. Devolve true se bloqueou. */
function bloquearCasa() {
  if (!casaPorEscolher()) return false;
  if (estado.passo !== P.casa) irPara(P.casa, { foco: false });
  if (estado.casa.tipo) assinalar($("casa-tipologia-caixa"), "Escolha a tipologia.");
  else assinalar($("casa-tipos").closest("fieldset"), "Escolha o tipo de casa.");
  return true;
}
/*
 * "Seguinte" em "A casa" (decisão do dono): não se avança sem a casa configurada. Uma janela (<dialog> modal) diz o
 * que falta preencher; com tudo preenchido, pergunta se a planta ao lado está parecida com a casa — só o "Sim,
 * continuar" avança. A resposta vale enquanto as divisões não mudarem (mudar a casa ou a planta volta a perguntar).
 */
// QA final: a resposta fica no estado (`estado.plantaConfirmada`, gravada): recarregar a página não volta a perguntar
// enquanto as divisões não mudarem. `destino`: o passo a que se ia (o Seguinte ou um passo da barra).
let janelaCasa = null;
const assinaturaPlanta = () => assinaturaDivisoes(estado.planta);
/** A janela (<dialog> modal) das confirmações: a de "A casa" e a dos outros passos (confirmarPasso). Criada uma vez. */
function janelaDeConfirmar() {
  if (janelaCasa) return janelaCasa;
  const j = el("dialog", "editor-dialogo editor-mais janela-casa");
  j.id = "casa-janela";
  j.setAttribute("aria-labelledby", "casa-janela-titulo");
  const t = el("h2");
  t.id = "casa-janela-titulo";
  const corpo = el("div", "editor-mais-corpo");
  corpo.id = "casa-janela-corpo";
  const bs = el("div", "form-botoes");
  bs.id = "casa-janela-botoes";
  j.append(t, corpo, bs);
  document.body.append(j);
  janelaCasa = j;
  return j;
}
const botaoDaJanela = (dlg) => (classe, texto, id, acao) => {
  const b = el("button", classe, texto);
  b.type = "button";
  b.id = id;
  b.addEventListener("click", () => { dlg.close(); acao(); });
  return b;
};

/*
 * "Seguinte" nos passos em que o cliente preenche alguma coisa (decisão do dono, 2026-10-04; estado.js
 * PASSOS_A_CONFIRMAR): a mesma janela de "A casa" pergunta se está certo antes de avançar — "Ainda não, vou ajustar"
 * fica no passo, "Sim, continuar" avança. A resposta fica no estado (`estado.confirmados`) e vale enquanto o que foi
 * confirmado não mudar (assinaturaPasso): andar para trás e para a frente não volta a perguntar.
 */
const TEXTOS_CONFIRMAR = {
  [P.quer]: { titulo: "As máquinas marcadas são as da sua casa?",
    pontos: ["Estão marcadas todas as máquinas que tem hoje.", "A quantidade de cada uma está certa.", "O que quer pôr de novo escolhe mais à frente."] },
  [P.divisoes]: { titulo: "Está certo o que cada divisão tem hoje?",
    pontos: ["Os interruptores e as tomadas de cada divisão.", "Os que já são inteligentes estão marcados."] },
  [P.planta]: { titulo: "A planta está como a sua casa?",
    pontos: ["Cada aparelho está na divisão certa.", "Não falta nenhuma divisão nem aparelho."] },
  [P.quadro]: { titulo: "A foto do quadro está boa?",
    pontos: ["Mostra o quadro de frente, com a porta aberta.", "As etiquetas leem-se."] },
  [P.trocar]: { titulo: "Está certo o que quer fazer?",
    pontos: ["O que não mexeu fica em Manter e não entra no preço.", "Disse o que se passa em cada aparelho avariado."] },
  [P.melhorias]: { titulo: "Escolheu as melhorias que quer?",
    pontos: ["Os pacotes marcados entram no orçamento.", "Pode continuar sem nenhum."] },
};
const assinaturaDoPasso = (passo) => assinaturaPasso(estado, passo, fotos.get("quadro")?.miniatura?.length ?? null);
/** Abre a janela do passo atual se ainda não foi confirmado como está; devolve true se a abriu (não se avança). */
function confirmarPasso(destino = null) {
  const passo = estado.passo;
  const T = TEXTOS_CONFIRMAR[passo];
  if (!T) return false;
  const agora = assinaturaDoPasso(passo);
  if (estado.confirmados?.[passo] === agora) return false;
  const dlg = janelaDeConfirmar();
  const botao = botaoDaJanela(dlg);
  const lista = el("ul", "janela-casa-lista");
  for (const t of T.pontos) lista.append(el("li", null, t));
  $("casa-janela-titulo").textContent = T.titulo;
  $("casa-janela-corpo").replaceChildren(el("p", null, "Antes de continuar, confirme:"), lista);
  $("casa-janela-botoes").replaceChildren(
    botao("btn sec", "Ainda não, vou ajustar", "passo-janela-ajustar", () => focar(`titulo-${passo}`)),
    botao("btn", "Sim, continuar", "passo-janela-sim", () => {
      estado.confirmados = { ...(estado.confirmados ?? {}), [passo]: assinaturaDoPasso(passo) };
      agendarGravacao();
      irPara(destino ?? passoAo(passo, 1));
    }),
  );
  dlg.showModal();
  $("passo-janela-sim").focus();
  return true;
}
function confirmarCasa(destino = null) {
  if (codigoCliente) return false;
  const falta = casaPorEscolher();
  if (!falta && estado.plantaConfirmada === assinaturaPlanta()) return false;
  const dlg = janelaDeConfirmar();
  const corpo = $("casa-janela-corpo"), bs = $("casa-janela-botoes");
  const botao = botaoDaJanela(dlg);
  const passos = el("ul", "janela-casa-lista");
  if (falta) {
    $("casa-janela-titulo").textContent = "Falta configurar a casa";
    passos.append(
      el("li", null, estado.casa.tipo ? "Escolha a tipologia (T0, T1, T2…)." : "Escolha o tipo de imóvel e a tipologia."),
      el("li", null, "Acerte os quartos, as casas de banho, as salas e o que a casa tem."),
      el("li", null, "Arrume a planta ao lado: arraste cada divisão para o sítio e puxe os cantos para o tamanho."),
    );
    corpo.replaceChildren(el("p", null, "Antes de continuar, preencha os campos e desenhe a planta da sua casa:"), passos);
    bs.replaceChildren(botao("btn", "Preencher", "casa-janela-preencher", () => bloquearCasa()));
  } else {
    $("casa-janela-titulo").textContent = "A planta está parecida com a sua casa?";
    passos.append(
      el("li", null, "As divisões são as da sua casa (quartos, casas de banho, salas…)."),
      el("li", null, "Cada divisão está no sítio certo: arraste-a na planta para a mudar."),
      el("li", null, "O tamanho está perto do real: puxe os cantos da divisão."),
    );
    corpo.replaceChildren(el("p", null, "É sobre esta planta que fazemos o relatório da casa. Confirme:"), passos);
    bs.replaceChildren(
      botao("btn sec", "Ainda não, vou ajustar", "casa-janela-ajustar", () => focar("titulo-1")),
      botao("btn", "Sim, continuar", "casa-janela-sim", () => { estado.plantaConfirmada = assinaturaPlanta(); irPara(destino ?? passoAo(estado.passo, 1)); }),
    );
  }
  dlg.showModal();
  bs.querySelector("button:last-child")?.focus();
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
    // "Outra divisão" (ginásio, sótão…; `estado.casa.outras`, da casa toda — no r/c): marcar abre a lista (nome e
    // quantas, desenharOutras); desmarcar tira todas.
    $("casa-extras").append(escolha("checkbox", "casa-extra-outra", "outra", "Outra divisão", "Ginásio, sótão…", (sim) => {
      estado.casa.outras = sim ? [{ nome: "", qtd: 1 }] : [];
      desenharOutras();
      if (sim) $("casa-outras").querySelector("input")?.focus();
      agendarGravacao();
    }));
  }
  for (const i of g.querySelectorAll("input")) i.checked = i.value === estado.casa.tipo;
  sincronizarCasa();
  $("casa-area").value = estado.casa.area_m2 == null ? "" : String(estado.casa.area_m2);
  $("casa-potencia").value = String(estado.casa.potencia_contratada_kva ?? POTENCIA_OMISSAO_KVA);
}

/** Tipologia (ou área e espaços), contadores, extras e ligação no ecrã a partir do estado. */
function sincronizarCasa() {
  const c = estado.casa;
  // Potência contratada pelo tamanho da casa (T0/T1 3,45 · T2/T3 6,9 · T4/T5+ 10,35), enquanto o cliente não escolher outra.
  if (!estado.potenciaEditada) { c.potencia_contratada_kva = potenciaOmissao(c); $("casa-potencia").value = String(c.potencia_contratada_kva); }
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
  for (const i of $("casa-extras").querySelectorAll("input")) i.checked = i.value === "outra" ? c.outras.length > 0 : !!vis.extras?.[i.value];
  desenharOutras();
  desenharPisosCasa();
  $("casa-fases").value = c.fases ?? fasesSugeridas(estado);
}
/**
 * Linhas de "Outra divisão" (`estado.casa.outras`): em cada uma o nome (≤ 30 letras), quantas (− n +) e "Tirar"; no fim
 * "Mais uma divisão" (até 10 linhas). Escondido sem nenhuma. Com o foco lá dentro e o mesmo n.º de linhas não se
 * redesenha (os valores já estão nas linhas): quem escreve o nome não perde o foco.
 */
function desenharOutras() {
  const caixa = $("casa-outras");
  const lista = estado.casa.outras;
  caixa.hidden = !lista.length;
  if (!caixa.hidden && caixa.querySelectorAll(".casa-outra").length === lista.length && caixa.contains(document.activeElement)) return;
  caixa.replaceChildren();
  if (!lista.length) return;
  const [min, max] = LIMITES_OUTRAS.qtd;
  lista.forEach((o, i) => {
    const linha = el("div", "casa-outra");
    const nome = document.createElement("input");
    nome.type = "text";
    nome.maxLength = LIMITES_OUTRAS.nome;
    nome.autocomplete = "off";
    nome.placeholder = "Nome (ex.: Ginásio, Sótão)";
    nome.value = o.nome;
    nome.id = `casa-outra-${i}`;
    nome.setAttribute("aria-label", `Nome da outra divisão ${i + 1}`);
    nome.addEventListener("input", () => { o.nome = nome.value.slice(0, LIMITES_OUTRAS.nome); agendarGravacao(); });
    const grupo = el("div", "contador-caixa");
    grupo.setAttribute("role", "group");
    grupo.setAttribute("aria-label", `Quantas: ${o.nome || "outra divisão"}`);
    const valor = el("output", "contador-valor", String(o.qtd));
    valor.setAttribute("aria-live", "polite");
    const botaoQ = (sinal, rotulo, d) => {
      const b = el("button", "btn sec", sinal);
      b.type = "button";
      b.setAttribute("aria-label", rotulo);
      b.addEventListener("click", () => {
        o.qtd = Math.min(max, Math.max(min, o.qtd + d));
        valor.textContent = String(o.qtd);
        menos.disabled = o.qtd <= min;
        mais.disabled = o.qtd >= max;
        agendarGravacao();
      });
      return b;
    };
    const menos = botaoQ("−", "Menos uma", -1), mais = botaoQ("+", "Mais uma", 1);
    menos.disabled = o.qtd <= min;
    mais.disabled = o.qtd >= max;
    grupo.append(menos, valor, mais);
    const tirar = el("button", "btn sec pequeno", "Tirar");
    tirar.type = "button";
    tirar.setAttribute("aria-label", `Tirar ${o.nome || "esta divisão"}`);
    tirar.addEventListener("click", () => {
      lista.splice(i, 1);
      sincronizarCasa();   // a caixa "Outra divisão" desmarca-se sem nenhuma
      ($("casa-outras").querySelector("input") ?? $("casa-extras").querySelector("input[value=outra]"))?.focus();
      agendarGravacao();
    });
    linha.append(nome, grupo, tirar);
    caixa.append(linha);
  });
  if (lista.length < LIMITES_OUTRAS.linhas) {
    const maisUma = el("button", "btn sec pequeno", "Mais uma divisão");
    maisUma.type = "button";
    maisUma.addEventListener("click", () => {
      lista.push({ nome: "", qtd: 1 });
      desenharOutras();
      $(`casa-outra-${lista.length - 1}`)?.focus();
      agendarGravacao();
    });
    const fb = el("div", "form-botoes");
    fb.append(maisUma);
    caixa.append(fb);
  }
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
  editor.mudarPiso(p, { anunciar: false });   // QA final: a planta ao lado mostra o mesmo piso
}

$("casa-potencia").addEventListener("change", () => { estado.casa.potencia_contratada_kva = potenciaContratada($("casa-potencia").value) ?? POTENCIA_OMISSAO_KVA; estado.potenciaEditada = true; agendarGravacao(); });
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

// ------------------------------------------------------------ 2. Equipamentos
// B8 (decisão do dono): os cartões "O que quer fazer" (objetivos) saíram do Orçamento; `estado.quer.objetivos` fica
// (estados antigos e o pedido): conta no plano sugerido (calcular) e nas dicas das Divisões (casa.js dicasObjetivos).
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
// ---- Equipamentos: o sítio de cada equipamento confirma-se na planta (decisão do dono, 2026-10-10) ----
// Ao marcar um cartão (ou "+") o site põe o equipamento numa divisão; por cima da planta aparece "Está no sítio certo?"
// com "Está bem aqui" — arrastá-lo na planta também confirma. "Seguinte" só avança com todos confirmados. No telemóvel
// a planta não está à vista: confirmam-se no fim, quando "Seguinte" a abre por cima.
let sitioVisto = null;   // { chave, id, x, y } do equipamento que está a ser confirmado
const comRato = matchMedia("(hover: hover) and (pointer: fine)");
/** Marcou mais um (`d` = 1) ou mudou a quantidade (`d` = 0): quantos falta confirmar nesse piso, nunca mais do que há. */
function sitioPorVer(k, d) {
  const chave = `${k}|${pisoQuer}`;
  const n = Math.min(quantidadeNoPiso(estado.quer, k, pisoQuer), Math.max(0, (estado.sitiosPorVer[chave] ?? 0) + d));
  const s = { ...estado.sitiosPorVer };
  if (n > 0) s[chave] = n; else delete s[chave];
  estado.sitiosPorVer = s;
}
/** Os que falta confirmar: [{chave, k, piso, n, el}] (`el` = o equipamento na planta; null enquanto a planta não o tem). */
function sitiosPendentes() {
  const r = [];
  for (const [chave, falta] of Object.entries(estado.sitiosPorVer ?? {})) {
    const [k, pisoTxt] = chave.split("|");
    const piso = Number(pisoTxt);
    const n = Math.min(falta, quantidadeNoPiso(estado.quer, k, piso));
    if (n <= 0 || !MODELOS[k]) continue;
    const els = (estado.planta?.elementos ?? []).filter((e) => e.tipo === "maquina" && e.props?.modelo === k && pisoDe(e) === piso);
    r.push({ chave, k, piso, n, el: els[els.length - Math.min(n, els.length)] ?? null });
  }
  return r;
}
const nomeSitio = (k) => (k === "outro" ? "Outro equipamento" : MODELOS[k].nome);
/** A caixa por cima da planta: o primeiro por confirmar, a piscar na planta, e "Está bem aqui". */
function desenharSitio() {
  const caixa = $("planta-sitio");
  const pend = estado.passo === P.quer && !enviado && (ecraLargo.matches || plantaAberta()) ? sitiosPendentes() : [];
  const p = pend.find((x) => x.el);
  if (!p) { caixa.hidden = true; caixa.replaceChildren(); sitioVisto = null; editor.seguirElemento(null); return; }
  // (Numa planta refeita os ids repetem-se: o mesmo id noutro sítio, sem estar a seguir o rato, é outro equipamento.)
  const outro = sitioVisto?.id !== p.el.id || (!editor.aSeguir && (sitioVisto.x !== p.el.x_cm || sitioVisto.y !== p.el.y_cm));
  if (outro) {
    if (sitioVisto?.id === p.el.id) editor.seguirElemento(null);
    sitioVisto = { chave: p.chave, id: p.el.id, x: p.el.x_cm, y: p.el.y_cm };
    if (editor.planta === estado.planta) {
      editor.focarElemento(p.el.id);
      // Com rato: o equipamento segue-o sobre a planta e um clique larga-o no sítio (e fica confirmado).
      editor.seguirElemento(p.el.id, { aoLargar: (id) => { if (sitioVisto?.id === id) confirmarSitio(); } });
    }
  }
  const divisao = estado.planta.divisoes.find((d) => d.id === p.el.divisao)?.nome;
  const falta = pend.reduce((s, x) => s + x.n, 0);
  const b = el("button", "btn pequeno", "Está bem aqui");
  b.type = "button";
  b.id = "planta-sitio-ok";
  b.addEventListener("click", confirmarSitio);
  caixa.replaceChildren(
    el("p", null, `${nomeSitio(p.k)}: ${comRato.matches ? "leve o rato à planta e clique onde está." : "arraste na planta para onde está."} ${divisao ? `Ficou em ${divisao}: se` : "Se"} já está certo, confirme.`),
    b, ...(falta > 1 ? [el("small", "ajuda", `Faltam ${falta} por confirmar.`)] : []));
  caixa.hidden = false;
}
/** "Está bem aqui" (ou o equipamento arrastado na planta): um a menos por confirmar; segue para o seguinte. */
function confirmarSitio() {
  const v = sitioVisto;
  if (!v) return;
  const n = (estado.sitiosPorVer[v.chave] ?? 0) - 1;
  const s = { ...estado.sitiosPorVer };
  if (n > 0) s[v.chave] = n; else delete s[v.chave];
  estado.sitiosPorVer = s;
  sitioVisto = null;
  $("planta-sitio").classList.remove("em-falta");
  agendarGravacao(false);
  desenharSitio();
  if (!sitiosPendentes().length) {
    if (plantaAberta()) fecharPlanta({ foco: false });
    $("sim-seguinte").focus({ preventScroll: true });
  } else $("planta-sitio-ok")?.focus({ preventScroll: true });
}
/** A planta mudou: se o equipamento que se está a confirmar foi arrastado (ou mudou de divisão), está confirmado. */
function sitioArrastado() {
  if (!sitioVisto || estado.passo !== P.quer || editor.aSeguir) return;   // a seguir o rato: ainda não foi largado
  const e = estado.planta.elementos.find((x) => x.id === sitioVisto.id);
  if (e && (e.x_cm !== sitioVisto.x || e.y_cm !== sitioVisto.y)) confirmarSitio();
  else if (!e) { sitioVisto = null; desenharSitio(); }
}
/** "Seguinte" (e a barra dos passos) em "Equipamentos": com sítios por confirmar não avança. Devolve true se bloqueou. */
function bloquearSitios() {
  const pend = sitiosPendentes();
  if (!pend.length) return false;
  if (!ecraLargo.matches) abrirPlanta($("sim-seguinte"));
  atualizarPlanta();   // (a planta já com o que se acabou de marcar)
  desenharSitio();
  const caixa = $("planta-sitio");
  if (caixa.hidden) return false;   // a planta ainda não os tem (não devia acontecer): não prende o cliente
  assinalar(caixa, `Falta confirmar na planta: ${listaPt([...new Set(pend.map((x) => nomeSitio(x.k).toLowerCase()))])}.`, $("planta-sitio-ok"));
  return true;
}

/**
 * Todas as máquinas do perfil ficam à vista, por grupos, e o passo abre sem nada marcado: o cliente marca só o que tem.
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
      sitioPorVer(k, sim ? 1 : 0);
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
      // Decisão do dono (2026-10-10): estes três não mostram a potência (continua a contar nas contas).
      const semW = k === "aspirador_robo" || k === "camara" || k === "campainha_video";
      // "Outro equipamento" (decisão do dono, 2026-10-10): o que não está na lista; na planta diz-se o que é e a potência.
      const outro = k === "outro";
      caixaM.append(escolha("checkbox", `quer-${lista}-${k}`, k, outro ? "Outro equipamento" : MODELOS[k].nome,
        outro ? "O que não está na lista" : semW ? "" : `cerca de ${formatarW(MODELOS[k].w)}`, alternarMaquina(k), iconeMaquina(k)), extra);
      return caixaM;
    };
    const grandes = maquinasGrandesDe(estado.casa.tipo);
    gm.replaceChildren(...grandes.map(maquina("maquinas")));
    gp.replaceChildren(...MAQUINAS_PEQUENAS[perfil].map(([titulo, chaves]) => {
      const f = el("fieldset", "escolhas quer-grupo");
      f.append(el("legend", null, titulo));
      const grelha = el("div", "escolhas-grelha");
      // Decisão do dono (2026-10-10): numa habitação estes já não se oferecem. Ficam só à vista numa casa
      // guardada que já os tenha (para os poder tirar); continuam a contar nas contas.
      const jaTem = (k) => Object.values(estado.quer.porPiso[k] ?? {}).some((n) => n > 0);
      grelha.append(...chaves.filter((k) => perfil !== "habitacao" || !FORA_HABITACAO.includes(k) || jaTem(k)).map(maquina("pequenas")));
      f.append(grelha);
      return f;
    }));
  }
  for (const i of [...gm.querySelectorAll("input[type=checkbox]"), ...gp.querySelectorAll("input[type=checkbox]")]) i.checked = quantidadeNoPiso(estado.quer, i.value, pisoQuer) > 0;
  for (const c of document.querySelectorAll(`#passo-${P.quer} .quer-item`)) desenharExtraQuer(c.dataset.maquina);
  desenharPisosQuer();
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
  editor.mudarPiso(p, { anunciar: false });   // QA final: a planta ao lado mostra o mesmo piso
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
    b.disabled = d > 0 && qtd >= MAX_QUANTIDADE;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();   // o − e o + não escolhem nem retiram a máquina (o cartão é o <label> ao lado)
      if (d < 0 && qtd <= 1) {   // a última: sai da planta (sem perguntar) e o cartão apaga-se
        const m = { ...(estado.quer.porPiso[k] ?? {}) };
        delete m[pisoQuer];
        estado.quer.porPiso = { ...estado.quer.porPiso, [k]: m };
        acertarQuer();
        sitioPorVer(k, 0);
        sugerirLigacao();
        agendarGravacao();
        desenharQuer();
        $(`quer-extra-${k}`)?.parentElement.querySelector("input")?.focus();
        return;
      }
      estado.quer.porPiso = { ...estado.quer.porPiso, [k]: { ...estado.quer.porPiso[k], [pisoQuer]: Math.min(MAX_QUANTIDADE, Math.max(1, qtd + d)) } };
      acertarQuer();
      sitioPorVer(k, d > 0 && qtd < MAX_QUANTIDADE ? 1 : 0);
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
 * Máquinas da planta → "Equipamentos" (andam juntas nos dois sentidos): cada cartão acende com as máquinas desse
 * modelo que a planta tem (escolhidas antes ou postas pela linha das ferramentas), por piso; tirá-las da planta apaga o cartão. A
 * planta fica como está (plantaSinc passa a ser o que ela tem). Devolve true se "Equipamentos" mudou.
 */
function querDaPlanta() {
  if (estado.plantaSaltada || fasePlanta() !== "tudo") return false;
  const cartoes = new Set(modelosDoPerfil(estado.casa.tipo));
  const comPisos = pisosDaCasa(estado.casa) > 1;
  const porPiso = {};
  for (const e of estado.planta.elementos) {
    const k = e.tipo === "maquina" ? e.props?.modelo : null;
    if (!k || !cartoes.has(k)) continue;
    const p = comPisos ? (e.piso ?? 0) : 0;
    const m = (porPiso[k] ??= {});
    m[p] = (m[p] ?? 0) + 1;
  }
  const novo = normalizarQuer({ ...estado.quer, porPiso }, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) });
  const chave = (q) => JSON.stringify(Object.keys(q.porPiso).sort().map((k) => [k, Object.entries(q.porPiso[k]).sort()]));
  if (chave(novo) === chave(normalizarQuer(estado.quer, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) }))) return false;
  estado.quer = novo;
  estado.plantaSinc = sincAtual();
  estado.plantaBase = assinaturaBase();
  return true;
}

/**
 * Botões da fila "Máquinas:" do editor: nas casas a TV e o frigorífico, as máquinas grandes do tipo de
 * imóvel, as que o cliente escolheu em "O que quer" e "Outra".
 */
const maquinasEditor = () => [
  ...(perfilCasa(estado.casa.tipo) === "habitacao" ? ["televisao", "frigorifico"] : []),
  ...maquinasGrandesDe(estado.casa.tipo), ...maquinasEscolhidas(estado.quer),
  // Decisão do dono (2026-10-10): numa habitação estes já não se oferecem (só os que a casa já tem, acima).
  ...modelosDoPerfil(estado.casa.tipo).filter((k) => perfilCasa(estado.casa.tipo) !== "habitacao" || !FORA_HABITACAO.includes(k)),
];
const FORA_HABITACAO = ["aspirador_robo", "camara", "campainha", "campainha_video", "toalheiro"];

/**
 * Linha das ferramentas do editor (ronda sinalizar: sem "Mais…"): os tipos de divisão do imóvel — na linha só os que a
 * casa tem (a planta e "A casa tem…"; os outros na janela "Outra divisão") — e todas as máquinas.
 */
function ferramentasEditor() {
  editor.definirTiposDivisao(tiposDivisaoPara(estado.casa.tipo), divisoesDaCasa(estado.casa, maquinasParaPlanta(estado)).map((d) => d.nome));
  editor.definirMaquinas(maquinasEditor(), modelosDoPerfil(estado.casa.tipo));
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
    divisoes: comDivisoes ? divisoesDaCasa(estado.casa, []).map((d) => ({ nome: d.nome, piso: d.piso ?? 0, ...(d.origem ? { origem: d.origem } : {}) })) : [],
    maquinas: f === "tudo" ? maquinasParaPlanta(estado).map((m) => ({ modelo: m.modelo, qtd: m.qtd, piso: m.piso })) : [],
    fase: f,
  };
}
/**
 * Planta em que o cliente mexeu (decisão do dono): a casa ou as máquinas mudaram → acrescenta ou tira só essa divisão
 * ou essa máquina (casa.js acertarPlantaMexida); o resto fica como o cliente o deixou. Estados sem `plantaSinc`: se
 * nada mudou desde a planta desenhada, passa a ser o que ela tem; senão conta o que a planta já tem de cada coisa (só
 * acrescenta o que falta). A dica ("Pusemos a placa na Kitchenette — arraste…") aparece na cabeça da planta.
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
  estado.planta = marcarNovas(p);
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
  const p = marcarNovas(plantaDaCasa(estado.casa, maquinasParaPlanta(estado)));
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
    // Decisão do dono (2026-10-04): sem duplo clique (nem duplo toque ou toque longo) em nenhum passo — na planta
    // arrasta-se; a janela de cada coisa abre-se no botão "Opções" (ou Enter).
    duplo: false,
    // Decisão do dono (2026-10-10): em "Equipamentos" e em "Divisões" a linha por cima da planta não tem máquinas
    // (marcam-se nos cartões de "Equipamentos"); ficam porta, janela, quadro, tomada, ponto de luz, interruptor e sensores.
    maquinas: estado.passo !== P.quer && estado.passo !== P.divisoes,
  });
  if (estado.passo === P.casa || estado.passo === P.planta) $("planta-presa").hidden = true;
  const n = pisosDaCasa(estado.casa);
  if (n !== pisosEditor) { pisosEditor = n; editor.definirPisos(n); }
  if (editor.planta !== estado.planta) editor.abrir(estado.planta, { reiniciarVista: true });
  // "A casa" (decisão do dono): cada mudança à esquerda que mexe na planta carrega também no "Ajustar".
  if (redesenhada && estado.passo === P.casa) editor.ajustar();
  plantaAutoJson = estado.plantaAuto ? JSON.stringify(estado.planta) : plantaAutoJson;
  desenharPlantaOrigem();
  desenharPlantaVazia();
  if (redesenhada) {
    agendarGravacao(false);
    if (estado.passo === P.divisoes) desenharDivisoes();
    if (estado.passo === P.trocar) desenharTrocar();
  }
  desenharSitio();
}

/** O cliente mexeu na planta (há o que refazer a partir da casa)? */
const plantaMexida = () => !estado.plantaAuto && plantaTemConteudo(estado.planta) && plantaDaFaseTemAlgo();

/**
 * Cabeça da planta: a dica da última máquina posta fora da divisão certa ("Pusemos a placa na Kitchenette — arraste se for
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
  // Ronda A: aberta por cima, ajustada e centrada; nos passos com separadores, já centrada na divisão do separador.
  if (!centrarNaDivisao()) editor.verTudo();
  s.querySelector(".editor-svg")?.focus({ preventScroll: true });
  desenharSitio();   // "Equipamentos": com a planta à vista, o que falta confirmar
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

/** Tentou mudar uma divisão fora do passo "A casa": a dica curta com o botão para lá (8 s). */
let temporizadorPresa = null;
function mostrarDivisaoPresa() {
  const c = $("planta-presa");
  // Funil "Já tenho a planta": as divisões mudam-se em "A casa" (Mudar a casa); senão no passo "A casa".
  $("planta-presa-texto").textContent = funilPlanta() ? "Divisões: mude a casa." : "Divisões: mude no passo A casa.";
  $("planta-presa-ir").textContent = funilPlanta() ? "Mudar a casa" : "Ir ao passo A casa";
  c.hidden = false;
  clearTimeout(temporizadorPresa);
  temporizadorPresa = setTimeout(() => { if (!c.contains(document.activeElement)) c.hidden = true; }, 8000);
}
$("planta-presa-ir").addEventListener("click", () => {
  $("planta-presa").hidden = true;
  fecharPlanta({ foco: false });
  if (funilPlanta()) mudarACasa(); else irPara(P.casa);
});
/**
 * "Mudar a casa" (funil "Já tenho a planta"): passa ao funil da primeira vez, no passo "A casa", mantendo tudo (a
 * planta, as ações escolhidas e o serviço).
 */
function mudarACasa() {
  estado.funil = "primeira";
  estado.caminho = null;
  visitado = P.relatorio;
  estado.visitado = visitado;
  irPara(P.casa);
}
$("planta-fechar").addEventListener("click", () => fecharPlanta());
ecraLargo.addEventListener("change", () => { if (ecraLargo.matches) fecharPlanta({ foco: false }); });
document.addEventListener("keydown", (ev) => {
  // Com uma janela do editor aberta (Opções) as teclas são dela.
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
/** A planta que conta: a do cliente ou, com a planta saltada, a que a casa desenha (também para os pontos novos, preco.js). */
const plantaParaContar = () => (usaPlanta() ? estado.planta : marcarNovas(plantaDaCasa(estado.casa, maquinasParaPlanta(estado))));
/**
 * Ronda dinheiro — entrada pelo anúncio do carregador (entrada.js, `estado.maquinasNovas`): essas máquinas nascem "Novo"
 * na planta que desenhamos (a linha dedicada conta no preço desde o início); a escolha do cliente nunca é mudada.
 */
function marcarNovas(p) {
  const novas = estado.maquinasNovas ?? [];
  if (novas.length) for (const e of p.elementos) if (e.tipo === "maquina" && novas.includes(e.props?.modelo) && !ACOES[e.acao]) e.acao = "novo";
  return p;
}
const contagemAtual = () => contarPlanta(plantaInteligentes(plantaNovos(plantaParaContar(), servicos()), estado.quer.objetivos));

/**
 * Circuitos sugeridos (§4) a partir da contagem. Toda a casa tem luzes e tomadas: se não há nenhuma
 * desenhada ficam os circuitos base "Iluminação" e "Tomadas"; as máquinas têm circuito próprio.
 * Com quadros parciais (casas com pisos, quadro.js pisosDosQuadros) os circuitos fazem-se por quadro: cada
 * piso com quadro tem os seus (`piso` = o piso do quadro; nome com o piso); os pisos sem quadro vão ao geral.
 */
function circuitosSugeridos(cont) {
  const pisosQ = pisosDosQuadros(estado);
  // Critério Domus (quadro.js): zonas húmidas no C5, T3 e mais com iluminação e tomadas em 2 zonas.
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
// Ronda de correções (B3, decisão do dono): o passo "Quadro elétrico" é SÓ a foto (obrigatória). O que fazer ao quadro
// — Manter como está / Melhorar (com a proteção: Básica, Recomendada, Completa) / Quadro novo — é o cartão "Quadro
// elétrico" do passo Melhorias (desenharQuadroMelhorias; os mesmos campos de sempre: estado.mexerQuadro,
// estado.quadro.pacote/protecoes/quadro_novo); o para-raios / linha aérea pergunta-se em "A casa" (estado.quadro.para_raios).
// Os circuitos, os disjuntores, os diferenciais, os módulos, a caixa e a potência continuam a ser calculados sozinhos
// (a partir da planta ou da casa) e vão no pedido para o relatório técnico do eletricista.
/** "Que proteção quer?": os 3 pacotes (quadro.js PACOTES) em palavras simples, sem siglas. */
const PROTECAO_SIMPLES = {
  essencial: ["Básica", "Diferencial obrigatório (RTIEBT); 30 mA recomendado."],
  recomendado: ["Recomendada", "+ descarregador de sobretensões e relé de tensão."],
  completo: ["Completa", "+ AFDD nos quartos e sala e geral Wi-Fi."],
};
/**
 * O cartão "Quadro elétrico" (Melhorias): Manter como está = o quadro não entra no preço (mexerQuadro false; só sem
 * "Instalação nova"); Melhorar = aproveita-se o quadro (quadro_novo "atual") com a proteção escolhida; Quadro novo =
 * quadro novo (quadro_novo "novo") com a proteção escolhida. Um quadro_novo null (estados antigos, "não sei") conta
 * como "Quadro novo" (incluído por precaução, como no preço: quadro.js levaQuadroNovo).
 */
const QUADRO_OPCOES = [["manter", "Manter como está"], ["melhorar", "Melhorar"], ["novo", "Quadro novo"]];
/** A opção do cartão a partir do estado. */
const opcaoQuadro = () => (!quadroNoPedido({ ...estado, servico: servicos() }) ? "manter" : estado.quadro.quadro_novo === "atual" ? "melhorar" : "novo");

/** Monta uma vez o cartão "Quadro elétrico" das Melhorias (e a proteção). */
function montarQuadroMelhorias() {
  for (const [v, t] of QUADRO_OPCOES) {
    $("melhorias-quadro-opcoes").append(escolha("radio", "melhorias-quadro", v, t, null, (sim) => {
      if (!sim) return;
      estado.mexerQuadro = v !== "manter";
      if (v !== "manter") estado.quadro.quadro_novo = v === "melhorar" ? "atual" : "novo";
      quadroMudou();
    }));
  }
  const g = $("melhorias-quadro-protecao");
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
}
function quadroMudou() {
  estado.quadro.pacote = pacoteDoQuadro(estado.quadro);
  agendarGravacao();
  desenharMelhorias();
  guardarNaConta();
}

/** O passo Quadro elétrico: só a foto. */
function desenharQuadro() {
  desenharFotoQuadro();
  for (const i of document.querySelectorAll("input[name=quadro-idade]")) i.checked = i.value === estado.quadroIdade;
}
/** Um desenho pequeno por resposta: quadro novo (visto), a meio (relógio), antigo (fusível) e "não sei" (?). */
const ICONES_IDADE = {
  recente: ["M10 8h28v32H10z", "M17 25l5 5 10-11"],
  medio: ["M24 8a16 16 0 1 0 0 32 16 16 0 0 0 0-32z", "M24 15v10l7 4"],
  antigo: ["M8 20h8v8H8z", "M32 20h8v8h-8z", "M16 24h4l3-5 3 10 3-5h3"],
  naosei: ["M24 8a16 16 0 1 0 0 32 16 16 0 0 0 0-32z", "M19 19a5 5 0 1 1 7 4.6c-1.4.7-2 1.6-2 3.4", "M24 33v.5"],
};
/** "Que idade tem o quadro?" (decisão do dono, 2026-10-10): opcional; a resposta abre o relatório grátis. */
function montarIdadeQuadro() {
  $("quadro-idade-opcoes").append(...Object.entries(IDADES_QUADRO).map(([k, x]) => {
    const l = escolha("radio", "quadro-idade", k, x.nome, null, (sim) => { if (sim) { estado.quadroIdade = k; agendarGravacao(false); } }, iconeDe(ICONES_IDADE[k]));
    l.id = `quadro-idade-${k}`;
    return l;
  }));
}
montarIdadeQuadro();

/** O cartão "Quadro elétrico" das Melhorias como está no estado e uma frase simples com o que isso quer dizer. */
function desenharQuadroMelhorias() {
  const q = estado.quadro;
  // O descarregador obrigatório (para-raios) não conta: "Básica" com para-raios continua "Básica". Proteções
  // escolhidas uma a uma numa versão antiga ("personalizado"): nenhum botão marcado até escolher um.
  const pacote = pacoteDoQuadro(q);
  for (const i of document.querySelectorAll("input[name=quadro-pacote]")) i.checked = i.value === pacote;
  // Com "Instalação nova" o quadro vai sempre no preço: sem "Manter como está".
  const comNova = servicos().includes("nova");
  const opcao = opcaoQuadro();
  for (const i of document.querySelectorAll("input[name=melhorias-quadro]")) { i.checked = i.value === opcao; i.parentElement.hidden = i.value === "manter" && comNova; }
  $("melhorias-quadro-protecao-caixa").hidden = opcao === "manter";
  const nota = $("quadro-nota");
  // Fase 2: o "Quadro seguro" aceite nas Melhorias (melhorias.js PROTECOES_MAXIMAS).
  const seguro = estado.melhorias.aceites.includes(QUADRO_SEGURO) && !!estado.melhorias.quadroAnterior;
  if (opcao === "manter") {
    nota.textContent = seguro ? "O quadro fica; a melhoria Quadro seguro junta-lhe as proteções." : "O quadro fica como está.";
    nota.hidden = false;
    return;
  }
  const partes = [];
  if (seguro) partes.push("Com o Quadro seguro: Completa e diferenciais Wi-Fi. Escolher outra proteção tira o Quadro seguro.");
  if (q.para_raios === "sim") partes.push("Com para-raios: descarregador de sobretensões incluído.");
  partes.push(q.quadro_novo === "atual"
    ? "Aproveitamos o seu quadro."
    : q.quadro_novo === "novo" ? "Quadro novo incluído." : "Só na visita sabemos se o seu quadro serve. Se servir, tiramos este valor.");
  nota.textContent = partes.join(" ");
  nota.hidden = false;
}
montarQuadroMelhorias();

/**
 * Foto do quadro (obrigatória, sempre — também com "Melhorar o quadro? Não"): câmara ou galeria. Botão grande; depois,
 * a miniatura com "Trocar" e "Apagar". Ronda B (decisão do dono): o passo é SÓ a foto — o esquema do quadro é feito
 * pelo eletricista no painel, a partir dela (docs/PAINEL-EMPRESA.md "Esquema do quadro").
 */
function desenharFotoQuadro() {
  const foto = fotos.get("quadro");
  const corpo = $("quadro-foto-corpo");
  corpo.replaceChildren();
  const depois = (ok, texto) => {
    const m = $("quadro-foto-msg");
    m.textContent = texto ?? "";
    m.className = `msg ${ok === false ? "erro" : "info"}`;
    m.hidden = !texto;
    if (ok === null) return;
    desenharQuadro();
    focar("quadro-foto-botao");
  };
  const tirar = () => pedirFoto("quadro", depois, { galeria: true, rotulo: "Foto do quadro elétrico" });
  if (!foto) {
    const b = el("button", "btn foto-grande");
    b.type = "button";
    b.id = "quadro-foto-botao";
    b.append(iconeCamara(), el("span", null, "Tirar foto do quadro"));
    b.addEventListener("click", tirar);
    corpo.append(b);
  } else {
    const img = el("img", "foto-quadro");
    img.src = foto.miniatura;
    img.alt = "Foto do quadro elétrico";
    const bs = el("div", "form-botoes");
    const trocar = el("button", "btn sec pequeno", "Trocar");
    trocar.type = "button";
    trocar.id = "quadro-foto-botao";
    trocar.setAttribute("aria-label", "Trocar a foto do quadro");
    trocar.addEventListener("click", tirar);
    const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
    apagar.type = "button";
    apagar.id = "quadro-foto-apagar";
    apagar.setAttribute("aria-label", "Apagar a foto do quadro");
    apagar.addEventListener("click", async () => { await tirarFoto("quadro"); depois(true, "Foto apagada."); });
    bs.append(trocar, apagar);
    corpo.append(img, bs);
  }
}

/** Falta a foto do quadro (obrigatória no funil que tem o passo Quadro)? */
const faltaFotoQuadro = () => sequencia().includes(P.quadro) && !fotos.has("quadro");
/** Sem a foto do quadro: fica (ou volta) no passo Quadro e assinala o cartão da foto (foco no botão). Devolve true se bloqueou. */
function bloquearQuadro() {
  if (!faltaFotoQuadro()) return false;
  if (estado.passo !== P.quadro) irPara(P.quadro, { foco: false });
  assinalar($("quadro-foto"), "Tire uma foto do quadro para continuar.", $("quadro-foto-botao"));
  return true;
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
function pedirFoto(chave, aoFim, { galeria = false, rotulo = "Foto" } = {}) {
  if (!fotos.has(chave) && fotos.size >= MAX_FOTOS) { aoFim(false, `Já tem ${MAX_FOTOS} fotos, o máximo. Apague uma para tirar outra.`); return; }
  // `galeria` (foto do quadro): sem "capture", o telemóvel deixa escolher entre a câmara e a galeria.
  if (galeria) entradaFoto.removeAttribute("capture"); else entradaFoto.setAttribute("capture", "environment");
  entradaFoto.value = "";
  const escolherFicheiro = () => { fotoAlvo = { chave, aoFim }; entradaFoto.click(); };
  // Num computador (decisão do dono): a janela com o QR para tirar a foto com o telemóvel, "ou escolher um ficheiro"
  // (fotos-remotas.js). Num telemóvel a câmara abre logo, como sempre.
  if (ehTelemovel()) { escolherFicheiro(); return; }
  abrirFotoRemota({
    chave, rotulo, urlApi, credenciais,
    sim: () => { if (!estado.fotosId) { estado.fotosId = novoIdFotos(); agendarGravacao(); } return estado.fotosId; },
    aoFicheiro: escolherFicheiro,
    // A foto pedida segue o caminho normal; outra chave da mesma simulação (o telemóvel passou à "seguinte") fica
    // guardada e o passo redesenha-se.
    aoFoto: (k, blob) => processarFoto(k === chave ? { chave, aoFim } : { chave: k, aoFim: (ok) => { if (ok !== null) redesenharPasso(); } }, blob),
  });
}
/** O passo atual outra vez (uma foto chegou do telemóvel para uma chave que não é a do botão carregado). */
function redesenharPasso() {
  if (estado.passo === P.divisoes) desenharDivisoes();
  else if (estado.passo === P.quadro) desenharQuadro();
  else if (estado.passo === P.trocar) desenharTrocar();
  else if (estado.passo === P.avaria) desenharAvaria();
}
entradaFoto.addEventListener("change", async () => {
  const alvo = fotoAlvo;
  const f = entradaFoto.files?.[0];
  fotoAlvo = null;
  if (!alvo || !f) return;
  await processarFoto(alvo, f);
});
/** Reduz, guarda (IndexedDB) e regista a foto `f` (File ou Blob) como `alvo.chave`; `alvo.aoFim(ok, texto)` diz como correu. */
async function processarFoto(alvo, f) {
  alvo.aoFim(null, "A preparar a foto…");
  try {
    const r = await reduzirFoto(f);
    if (!estado.fotosId) { estado.fotosId = novoIdFotos(); agendarGravacao(); }
    const guardada = await guardarFoto(estado.fotosId, alvo.chave, r);
    fotos.set(alvo.chave, { chave: alvo.chave, ...r });
    alvo.aoFim(true, guardada ? "Foto guardada neste navegador." : "Foto pronta. Este navegador não a consegue guardar: se fechar a página antes de enviar, perde-se.");
  } catch (e) {
    alvo.aoFim(false, e instanceof ErroFoto ? e.message : "Não foi possível usar esta foto. Experimente outra.");
  } finally {
    entradaFoto.value = "";
  }
}
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
  if (funilAvaria()) return fotosAvaria().map((chave, n) => ({ chave, tipo: "avaria", divisao: null, divisao_nome: estado.avaria.onde.map((k) => AVARIA_ONDE[k]).join(", ").slice(0, 120) || null, piso: null, legenda: `${legendaAvaria(estado.avaria)}${n ? ` (${n + 1})` : ""}` }));
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
// Decisão do dono (2026-10-03; vale sobre "Divisões = só contar"): o passo é ANTES da obra — levanta só o que a casa JÁ
// TEM em interruptores e tomadas. Um cartão por divisão (separadores) com dois blocos: quantos tem (− n +) ou "Não
// tem" e, para cada um, os botões (1–4) ou o tipo (simples, dupla, tripla), escolhidos ali mesmo (sem janela). Nada se
// assume: os que a planta traz são sugestões por responder; a divisão só leva ✓ com os dois blocos respondidos e o
// "Seguinte" não passa sem todas (estado.js inventarioDivisao). Ponto de luz, porta, janela, sensores, quadro e
// máquinas saíram deste passo: o que o cliente QUER pede-se em "Trocar e reparar" ("Acrescentar um aparelho") e nas
// Melhorias. "−" e "+" mexem também na planta (o "+" põe o aparelho num sítio livre da divisão: editor.por).
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

/** Planta deste passo: a desenhada ou, com a planta saltada, a que a casa daria (a mesma da contagem). */
const plantaDivisoes = () => (usaPlanta() ? estado.planta : marcarNovas(plantaDaCasa(estado.casa, maquinasParaPlanta(estado))));

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
  if (l.tipo === "tomada") {
    const partes = [conta(ps.filter((p) => caixasDe(p) === 2).length, "dupla", "duplas"), conta(ps.filter((p) => caixasDe(p) === 3).length, "tripla", "triplas"),
      conta(ps.filter((p) => p.inteligente).length, "inteligente", "inteligentes")].filter(Boolean);
    return partes.length ? partes.join(", ") : null;
  }
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
 * As Divisões perguntam outra coisa (decisão do dono, 2026-10-03): o inventário dos interruptores e das tomadas.
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
  avisoPorVer.divisoes = false;
  const m = $("divisoes-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}

/**
 * Inventário das Divisões, "−": tira um aparelho desse tipo da divisão (também da planta) — primeiro um ainda por
 * responder, senão o último. Chegar a zero pela mão do cliente é dizer "Não tem".
 */
function tirarUm(d, tipo) {
  if (!garantirPlanta()) return;
  const els = estado.planta.elementos.filter((e) => e.tipo === tipo && e.divisao === d.id);
  const alvo = els.findLast((e) => e.confirmado !== true) ?? els.at(-1);
  if (!alvo) return;
  divisaoTocada = d.id;
  if (els.length === 1) marcarNaoTem(estado, tipo, d, true, estado.planta.divisoes);
  garantirEditor();
  editor.apagar(alvo.id);   // → aoMudar: o pedido e os cartões seguem a planta
  const base = `div-${d.id}-${tipo}`;
  focar(`${base}-menos`) || focar(`${base}-mais`);
}
/** Inventário das Divisões, "+": mais um aparelho desse tipo na divisão (num sítio livre dela, na planta), por responder. */
function maisUm(d, tipo) {
  if (!garantirPlanta()) return;
  garantirEditor();
  divisaoTocada = d.id;
  marcarNaoTem(estado, tipo, d, false, estado.planta.divisoes);
  if (!editor.por(tipo, d.id)) desenharDivisoes();   // → aoMudar (planta cheia: o editor avisa e o cartão fica como estava)
  focar(`div-${d.id}-${tipo}-mais`);
}
/** Inventário das Divisões, "Não tem": a divisão não tem nenhum desse tipo (os que a planta sugeria saem); outro toque desmarca. */
function alternarNaoTem(d, tipo) {
  if (!garantirPlanta()) return;
  const inv = inventarioDivisao(estado, estado.planta, d)[tipo];
  marcarNaoTem(estado, tipo, d, !inv.sem, estado.planta.divisoes);
  if (inv.els.length) {
    const fora = new Set(inv.els.map((e) => e.id));
    estado.planta.elementos = estado.planta.elementos.filter((e) => !fora.has(e.id));
    estado.plantaAuto = false;   // o cliente mexeu na planta: não a redesenhamos sozinhos
    divisaoTocada = d.id;
    refazerDivisoes([d.id]);
    garantirEditor();
    editor.redesenhar();
  }
  agendarGravacao();
  desenharDivisoes();
  desenharEstimativaProvisoria();
  focar(`div-${d.id}-${tipo}-nao-tem`);
}
/** Inventário das Divisões: o cliente escolheu os botões / o tipo do aparelho `id` (fica respondido: `confirmado`). */
function responderInventario(d, id, mudar, focoId) {
  if (!garantirPlanta()) return;
  const e = elementoDoEstado(id);
  if (!e) return;
  mudar(e);
  e.confirmado = true;
  estado.plantaAuto = false;   // o cliente mexeu na planta: não a redesenhamos sozinhos
  divisaoTocada = d.id;
  refazerDivisoes([d.id]);
  garantirEditor();
  editor.redesenhar();
  agendarGravacao();
  desenharDivisoes();
  desenharEstimativaProvisoria();
  focar(focoId);
}

/**
 * "Inteligente" numa tomada ou num interruptor do inventário: o que a casa já tem é inteligente (`props.inteligente`)
 * ou não. Não mexe na ação (continua Manter) nem conta como resposta ao tipo da tomada ou aos botões do interruptor.
 */
function marcarInteligente(d, id, sim, focoId) {
  if (!garantirPlanta()) return;
  const e = elementoDoEstado(id);
  if (!e) return;
  e.props = { ...(e.props ?? {}), inteligente: sim };
  estado.plantaAuto = false;
  divisaoTocada = d.id;
  refazerDivisoes([d.id]);
  garantirEditor();
  editor.redesenhar();
  agendarGravacao();
  desenharDivisoes();
  desenharEstimativaProvisoria();
  focar(focoId);
}

/**
 * "+" (e "Acrescentar outro aparelho", "Acrescentar uma divisão"): na planta do topo (sem mudar de passo), no piso da
 * divisão, com ela selecionada e a ferramenta desse aparelho escolhida (na linha das ferramentas, mesmo que lá não
 * estivesse). Pelo teclado o aparelho fica logo no meio da divisão (como as ferramentas do editor); o cliente
 * arrasta-o para o sítio certo. O cartão atualiza-se sozinho (aoMudar).
 */
function acrescentar(d, l, ev = null, { porJa = null, origem = null } = {}) {
  if (d && !garantirPlanta()) return;
  const teclado = ev?.detail === 0;
  // Pôr logo no meio da divisão: pelo teclado, ou escolhido na janela dos aparelhos (abrirAparelhos).
  const ja = porJa ?? teclado;
  garantirEditor();
  divisaoTocada = d?.id ?? null;
  // Telemóvel e tablet: abre a planta por cima (ao fechar, o foco volta a este botão); no computador está à direita.
  abrirPlanta(origem ?? ev?.currentTarget ?? document.activeElement);
  const oque = l ? (l.modelo ? `a nova máquina (${MODELOS[l.modelo].nome.toLowerCase()})` : NOMES_TIPO[l.tipo][2]) : null;
  const texto = !d ? "Escolha a divisão nas ferramentas da planta."
    : oque && ja ? `Posto no meio de "${d.nome}": ${teclado ? "mova com as setas" : "arraste-o para o sítio certo"}.`
      : oque ? `Toque em "${d.nome}" para pôr ${oque}.`
        : `Escolha o aparelho e toque em "${d.nome}".`;
  doCartao = true;
  editor.prepararColocar({ divisao: d?.id ?? null, tipo: l?.tipo ?? null, modelo: l?.modelo ?? null, texto, porJa: ja && !!l });
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
  centrarNaDivisao();
  if (estado.passo === P.trocar) desenharTrocar(); else desenharDivisoes();
  if (focoId) focar(focoId);
}
/**
 * A planta centra-se na divisão do separador (decisão do dono, 2026-10-03; passos "Divisões" e "Trocar e reparar"):
 * no piso dela, selecionada e aproximada até caber com margem (editor.focarDivisao) — a cada mudança de separador
 * (toque, teclado, "Seguinte", ao entrar no passo, ao abrir a planta por cima no telemóvel), mesmo que o cliente tenha
 * mexido na vista. Ao contrário (tocar numa divisão na planta muda o separador: destacarCartao) a vista fica onde
 * está. Devolve true se centrou.
 */
function centrarNaDivisao() {
  if (![P.divisoes, P.trocar].includes(estado.passo) || !divisaoAtiva || editor.planta !== estado.planta) return false;
  doCartao = true;
  const ok = editor.focarDivisao(divisaoAtiva);
  doCartao = false;
  return ok;
}
/**
 * A fila dos separadores. `pre`: "div" ou "tr" (ids); `feita(d)`: ✓ (`rotuloFeita` no nome acessível); `falta(d)`:
 * marcado quando `avisar` (o aviso do "Seguinte" ou o "Falta ver: …" está à vista). Nas Divisões o ✓ é "respondida" (o inventário).
 */
function separadoresDivisoes(pre, planta, { feita, falta, avisar, rotuloFeita = "tudo respondido", rotuloFalta = "falta responder" }) {
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
    b.setAttribute("aria-label", `${d.nome || "Divisão"}${ok ? ` (${rotuloFeita})` : f ? ` (${rotuloFalta})` : ""}`);
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

/*
 * Divisão a divisão (decisão do dono; estado.js vistas): em "Trocar e reparar" o "Seguinte" abre primeiro a divisão
 * seguinte ainda por ver (✓ nas vistas com tudo respondido); só depois de vistas todas passa ao passo seguinte. Uma
 * divisão fica vista quando o seu separador (o cartão) se abre. Pela barra dos passos, para lá do passo com divisões
 * por ver, abre a primeira que falta e os separadores a pulsar (os que faltam ficam marcados; "Falta ver: …" só para
 * os leitores de ecrã). Nas Divisões (decisão do dono, 2026-10-03) não basta ver: o que falta são as divisões com o
 * inventário por responder (estado.js divisoesPorInventariar; bloquearInventario).
 */
const CHAVE_POR_DIVISAO = { [P.divisoes]: "divisoes", [P.trocar]: "trocar" };
/** A chave do passo `i` se é divisão a divisão neste funil (e não é saltado: fluxo curto sem Divisões), senão null. */
const porDivisao = (i) => (CHAVE_POR_DIVISAO[i] && sequencia().includes(i) && !naoPrecisa(i) ? CHAVE_POR_DIVISAO[i] : null);
/** As divisões (pela ordem dos separadores) ainda por ver no passo `i` (nas Divisões: com o inventário por responder). */
const porVer = (i) => {
  const k = porDivisao(i);
  if (!k) return [];
  const planta = plantaDivisoes();
  return k === "divisoes" ? divisoesPorInventariar(estado, planta, divisoesPorOrdem(planta)) : divisoesPorVer(estado, k, divisoesPorOrdem(planta));
};
const avisoPorVer = { divisoes: false, trocar: false };   // o aviso do "Seguinte" está à vista (marca os separadores que faltam)
function textoPorVer(l) {
  const nomes = l.slice(0, 4).map((d) => d.nome || "Divisão");
  if (l.length > 4) nomes.push(`mais ${l.length - 4}`);
  return `Falta ver: ${listaPt(nomes)}.`;
}
function mensagemPorDivisao(texto, tipo = "info") {
  if (estado.passo === P.trocar) mensagemTrocar(texto, tipo); else mensagemDivisoes(texto, tipo);
}
/** O separador `d` do passo à vista abriu-se: fica visto (com o aviso à vista, vistas todas diz "Já viu todas as divisões."). */
function verDivisao(d, planta) {
  const k = porDivisao(estado.passo);
  if (!k || !d) return;
  if (marcarVista(estado, k, d, planta.divisoes)) agendarGravacao();
  if (avisoPorVer[k] && !porVer(estado.passo).length) mensagemPorDivisao("Já viu todas as divisões.", "ok");
}
/**
 * Ao entrar num passo divisão a divisão com divisões por ver: o separador abre na primeira que falta (o separador é
 * o mesmo nos dois passos: das Divisões para "Trocar e reparar" recomeça na primeira). Devolve o id dela (para a
 * mostrar na planta) ou null.
 */
function abrirPrimeiraPorVer() {
  avisoPorVer.divisoes = avisoPorVer.trocar = false;
  const l = porVer(estado.passo);
  if (!l.length || l[0].id === divisaoAtiva) return null;
  divisaoAtiva = l[0].id;
  return divisaoAtiva;
}
const rolarAte = (x) => x?.scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
/**
 * "Seguinte" num passo divisão a divisão: abre a divisão seguinte ainda por ver (depois da do separador, pela ordem
 * dos separadores) e rola até ela; o foco fica no "Seguinte". Devolve true se abriu (não passa ao passo seguinte).
 * Nas Divisões: com a divisão à vista por responder fica nela e assinala o que falta (assinalarInventario).
 */
function verSeguinteDivisao() {
  const l = porVer(estado.passo);
  if (!l.length) return false;
  if (estado.passo === P.divisoes && l.some((d) => d.id === divisaoAtiva)) { assinalarInventario(l); return true; }
  const ordem = divisoesPorOrdem(plantaDivisoes());
  const a = ordem.findIndex((d) => d.id === divisaoAtiva);
  const falta = new Set(l.map((d) => d.id));
  const d = estado.passo === P.divisoes ? l[0] : [...ordem.slice(a + 1), ...ordem.slice(0, a + 1)].find((x) => falta.has(x.id));
  escolherDivisao(d.id);
  mensagemPorDivisao(`Divisão ${ordem.indexOf(d) + 1} de ${ordem.length}: ${d.nome || "Divisão"}.`);
  rolarAte($(estado.passo === P.trocar ? "trocar" : "divisoes"));
  return true;
}
/** O que falta no inventário da divisão `d` ("os botões de 2 interruptores", "as tomadas (quantas tem, ou "Não tem")"). */
function faltaInventario(planta, d) {
  const inv = inventarioDivisao(estado, planta, d);
  return TIPOS_INVENTARIO.filter((t) => !inv[t].respondido).map((t) => INVENTARIO[t].falta(inv[t].els.length, inv[t].falta));
}
/**
 * Inventário por responder (`l`: as divisões que faltam): abre a do separador se for uma delas (senão a primeira), marca
 * os separadores que faltam e assinala o 1.º bloco por responder do cartão (contorno a pulsar, foco no 1.º botão dele;
 * o que falta vai para os leitores de ecrã e está escrito no cartão: "Falta responder: …").
 */
function assinalarInventario(l) {
  const d = l.find((x) => x.id === divisaoAtiva) ?? l[0];
  avisoPorVer.divisoes = true;   // os separadores que faltam ficam marcados
  escolherDivisao(d.id);
  mensagemDivisoes(null);
  avisoPorVer.divisoes = true;
  const bloco = document.querySelector(`#div-${d.id} .inventario.por-responder`);
  const outras = l.filter((x) => x !== d).map((x) => x.nome || "Divisão");
  const nomes = outras.slice(0, 3);
  const mais = outras.length - nomes.length;
  const tambem = !nomes.length ? "" : mais > 0 ? ` Faltam também: ${nomes.join(", ")} e mais ${mais}.` : ` Faltam também: ${listaPt(nomes)}.`;
  assinalar(bloco ?? $(`div-${d.id}`), `Falta responder em ${d.nome || "Divisão"}: ${listaPt(faltaInventario(plantaDivisoes(), d))}.${tambem}`,
    bloco?.querySelector(".inventario-item.por-responder button, button:not(:disabled)") ?? $(`div-${d.id}-titulo`));
}
/**
 * Para lá das Divisões (barra dos passos, "Seguinte" de um passo mais à frente, Enviar) com o inventário por responder:
 * fica (ou volta) nelas e assinala o que falta. Devolve true se bloqueou.
 */
function bloquearInventario(i = P.enviar) {
  if (ordemPasso(i) <= ordemPasso(P.divisoes)) return false;
  const l = porVer(P.divisoes);
  if (!l.length) return false;
  if (estado.passo !== P.divisoes) irPara(P.divisoes, { foco: false });
  assinalarInventario(l);
  return true;
}
/**
 * Barra dos passos: do passo divisão a divisão `p` (ou de antes dele) para lá dele, com divisões por ver: fica (ou
 * volta) em `p`, abre a primeira que falta e diz quais faltam. Devolve true se bloqueou.
 */
function bloquearPorVer(p, i) {
  if (ordemPasso(i) <= ordemPasso(p) || ordemPasso(estado.passo) > ordemPasso(p)) return false;
  const l = porVer(p);
  if (!l.length) return false;
  if (estado.passo !== p) irPara(p, { foco: false });
  const k = CHAVE_POR_DIVISAO[p];
  avisoPorVer[k] = true;   // os separadores que faltam ficam marcados
  const pre = p === P.trocar ? "tr" : "div";
  escolherDivisao(l[0].id, `${pre}-${l[0].id}-titulo`);
  mensagemPorDivisao(null);
  avisoPorVer[k] = true;
  // Os separadores a pulsar; o foco fica no da divisão que se abriu (as que faltavam, também esta, para os leitores de ecrã).
  assinalar(document.querySelector(`#passo-${p} .div-separadores`), textoPorVer(l), $(`${pre}-${l[0].id}-titulo`));
  return true;
}

/*
 * "Acrescentar outro aparelho" (Divisões e Trocar e reparar): uma janela (<dialog> modal: Esc fecha, o resto da página
 * fica inerte) com a grelha de todos os aparelhos — a mesma lista e os mesmos desenhos da linha das ferramentas da
 * planta (editor.aparelhos()). Escolher um põe-no logo no meio da divisão (como o "+" pelo teclado) e
 * fecha; "Fechar" ou Esc fecham e o foco volta ao botão.
 */
let janelaAparelhos = null;
function abrirAparelhos(d, botaoId) {
  const dlg = janelaAparelhos ?? (() => {
    const j = el("dialog", "editor-dialogo editor-mais janela-aparelhos");
    j.id = "aparelhos-janela";
    j.setAttribute("aria-labelledby", "aparelhos-titulo");
    const t = el("h2");
    t.id = "aparelhos-titulo";
    const corpo = el("div", "editor-mais-corpo");
    corpo.id = "aparelhos-corpo";
    const fechar = el("button", "btn sec", "Fechar");
    fechar.type = "button";
    fechar.id = "aparelhos-fechar";
    fechar.addEventListener("click", () => j.close());
    const bs = el("div", "form-botoes");
    bs.append(fechar);
    j.append(t, corpo, bs);
    // Fechar sem escolher (Esc, "Fechar"): o foco volta ao botão (o cartão pode ter sido redesenhado: pelo id).
    j.addEventListener("close", () => { if (!j.dataset.escolhido) focar(j.dataset.volta); });
    document.body.append(j);
    janelaAparelhos = j;
    return j;
  })();
  dlg.dataset.volta = botaoId;
  delete dlg.dataset.escolhido;
  $("aparelhos-titulo").textContent = `Acrescentar aparelho: ${d.nome || "divisão"}`;
  const lista = editor.aparelhos();
  const corpo = $("aparelhos-corpo");
  corpo.replaceChildren();
  for (const [titulo, doGrupo] of [["Elementos", lista.filter((a) => a.tipo !== "maquina")], ["Máquinas", lista.filter((a) => a.tipo === "maquina")]]) {
    if (!doGrupo.length) continue;
    const s = el("section", "editor-mais-seccao");
    const g = el("div", "editor-mais-grelha");
    for (const a of doGrupo) {
      const b = el("button", "ferramenta");
      b.type = "button";
      b.dataset.aparelho = a.chave;
      b.append(desenharIcone(svgNovo(), a.tipo, a.props), el("span", "ferramenta-nome", a.nome));
      b.addEventListener("click", (ev) => {
        dlg.dataset.escolhido = "1";
        dlg.close();
        acrescentar(d, { tipo: a.tipo, modelo: a.modelo }, ev, { porJa: true, origem: $(botaoId) });
      });
      g.append(b);
    }
    s.append(el("h3", null, titulo), g);
    corpo.append(s);
  }
  dlg.showModal();
  corpo.scrollTop = 0;
  corpo.querySelector("button")?.focus();
}

/**
 * Tocar no nome de um interruptor ou de uma tomada na lista das Divisões localiza-o na planta (decisão do dono,
 * 2026-10-05): fica selecionado e à vista. No telemóvel e no tablet a planta está fechada: abre-se por cima, já nele.
 */
function localizarNaPlanta(id, origem) {
  if (!garantirPlanta()) return;
  const focar = () => { doCartao = true; editor.focarElemento(id); doCartao = false; };
  if (abrirPlanta(origem)) requestAnimationFrame(focar); else focar();
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
    // Inventário (decisão do dono, 2026-10-03): ✓ só nas divisões com os interruptores e as tomadas respondidos; com o
    // aviso do "Seguinte" à vista, as que faltam ficam marcadas até estar tudo respondido.
    const pronta = (d) => inventarioDivisao(estado, planta, d).respondida;
    if (avisoPorVer.divisoes && planta.divisoes.every(pronta)) mensagemDivisoes("Tudo respondido.", "ok");
    c.append(separadoresDivisoes("div", planta, { feita: pronta, falta: (d) => !pronta(d), avisar: avisoPorVer.divisoes, rotuloFeita: "respondida", rotuloFalta: "falta responder" }));
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
  // A caixa "Extras" (central, termóstatos) saiu do passo (decisão do dono); `estado.extras` fica (estados antigos e o pedido).
}

/** Por cima dos cartões: quantas divisões já têm o inventário respondido. */
function desenharProgressoDivisoes(planta = plantaDivisoes()) {
  const n = planta.divisoes.length;
  const feitas = n - divisoesPorInventariar(estado, planta).length;
  $("divisoes-progresso-caixa").hidden = !n;
  $("divisoes-progresso").textContent = `${feitas} de ${n} ${n === 1 ? "divisão respondida" : "divisões respondidas"}`;
}

/**
 * O que o inventário pergunta de cada tipo (decisão do dono, 2026-10-03): os interruptores pelos botões (1–4), as
 * tomadas pelo tipo (simples, dupla, tripla). `opcoes`: [valor, texto do botão, nome para os leitores de ecrã];
 * `valor(props)` lê e `mudar(e, v)` grava a escolha no aparelho; `falta(n, k)`: o que falta dizer (n na divisão, k por
 * responder).
 */
/** Desenho de um interruptor com `n` teclas (1 a 4), para as opções "quantos botões" (decisão do dono, 2026-10-04: o número sozinho não se percebia). */
function desenhoTeclas(n) {
  const NS = "http://www.w3.org/2000/svg";
  const s = svgNovo();
  s.setAttribute("viewBox", "0 0 32 32");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("teclas-desenho");
  const r = document.createElementNS(NS, "rect");
  for (const [k, v] of [["x", 3], ["y", 3], ["width", 26], ["height", 26], ["rx", 4]]) r.setAttribute(k, v);
  s.append(r);
  for (let i = 1; i < n; i++) {
    const l = document.createElementNS(NS, "line");
    const x = 3 + (26 * i) / n;
    for (const [k, v] of [["x1", x], ["x2", x], ["y1", 3], ["y2", 29]]) l.setAttribute(k, v);
    s.append(l);
  }
  return s;
}
/** O mesmo para as tomadas (decisão do dono, 2026-10-04): `n` tomadas redondas, com os dois furos, lado a lado no espelho. */
function desenhoTomadas(n) {
  const NS = "http://www.w3.org/2000/svg";
  const s = svgNovo();
  s.setAttribute("viewBox", `0 0 ${6 + 24 * n} 32`);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("teclas-desenho", "tomadas-desenho");
  const novo = (nome, attrs) => {
    const x = document.createElementNS(NS, nome);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    return x;
  };
  s.append(novo("rect", { x: 3, y: 3, width: 24 * n, height: 26, rx: 4 }));
  for (let i = 0; i < n; i++) {
    const cx = 15 + 24 * i;
    s.append(novo("circle", { cx, cy: 16, r: 8 }), novo("circle", { cx: cx - 3, cy: 16, r: 1.2, class: "furo" }), novo("circle", { cx: cx + 3, cy: 16, r: 1.2, class: "furo" }));
  }
  return s;
}
/** O símbolo do "Inteligente" (decisão do dono, 2026-10-04): as ondas do Wi-Fi — comanda-se pelo telemóvel. */
function desenhoInteligente() {
  const NS = "http://www.w3.org/2000/svg";
  const s = svgNovo();
  s.setAttribute("viewBox", "0 0 32 32");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("teclas-desenho", "inteligente-desenho");
  for (const d of ["M4 13a17 17 0 0 1 24 0", "M8.5 17.5a10.6 10.6 0 0 1 15 0", "M13 22a4.3 4.3 0 0 1 6 0"]) {
    const c = document.createElementNS(NS, "path");
    c.setAttribute("d", d);
    s.append(c);
  }
  const o = document.createElementNS(NS, "circle");
  for (const [k, v] of [["cx", 16], ["cy", 26], ["r", 1.6], ["class", "furo"]]) o.setAttribute(k, v);
  s.append(o);
  return s;
}
const INVENTARIO = {
  interruptor: {
    titulo: "Interruptores", um: "Interruptor", pergunta: "Quantos botões (teclas) tem cada um?", desenho: desenhoTeclas,
    opcoes: [[1, "1", "1 botão"], [2, "2", "2 botões"], [3, "3", "3 botões"], [4, "4", "4 botões"]],
    valor: (p) => Math.min(4, Math.max(1, Math.round(Number(p?.botoes) || 1))),
    // Um comando que pede mais botões (lustre: 2) volta a simples se o cliente disser que só tem 1.
    mudar: (e, v) => { e.props.botoes = v; if (COMANDOS[comandoDe(e.props)].botoes_min > v) e.props.comando = "simples"; },
    falta: (n, k) => (!n ? "os interruptores (quantos tem, ou \"Não tem\")" : k === 1 ? "os botões de 1 interruptor" : `os botões de ${k} interruptores`),
  },
  tomada: {
    titulo: "Tomadas", um: "Tomada", pergunta: "De que tipo é cada uma?", desenho: desenhoTomadas,
    opcoes: [[1, "Simples", "simples"], [2, "Dupla", "dupla"], [3, "Tripla", "tripla"]],
    valor: (p) => caixasDe(p),
    mudar: (e, v) => { e.props.caixas = v; e.props.dupla = v === 2; },
    falta: (n, k) => (!n ? "as tomadas (quantas tem, ou \"Não tem\")" : k === 1 ? "o tipo de 1 tomada" : `o tipo de ${k} tomadas`),
  },
};

/**
 * Cartão de uma divisão (decisão do dono, 2026-10-03): só o que a casa já tem em interruptores e em tomadas — um bloco
 * por tipo (blocoInventario) e, enquanto faltar alguma coisa, "Falta responder: …".
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
  c.append(topo, el("p", "ajuda", "O que esta divisão tem hoje."));
  const inv = inventarioDivisao(estado, planta, d);
  for (const tipo of TIPOS_INVENTARIO) c.append(blocoInventario(d, tipo, inv[tipo]));
  const falta = faltaInventario(planta, d);
  if (falta.length) {
    const f = el("p", "divisao-falta", `Falta responder: ${listaPt(falta)}.`);
    f.id = `${id}-falta`;
    c.append(f);
  }
  return c;
}

/**
 * Um bloco do inventário (interruptores ou tomadas) da divisão `d`: o nome, quantos tem (− n +, também na planta) e
 * "Não tem"; por baixo, uma linha por aparelho com as escolhas (botões de verdade, `aria-pressed`; nenhuma marcada
 * enquanto o cliente não escolher). Com 6 ou mais as linhas dobram (sem deslizar a página para o lado).
 */
function blocoInventario(d, tipo, { els, falta, sem, respondido }) {
  const I = INVENTARIO[tipo];
  const base = `div-${d.id}-${tipo}`;
  const onde = d.nome || "divisão";
  const n = els.length;
  const g = el("div", `inventario${respondido ? "" : " por-responder"}`);
  g.id = base;
  g.setAttribute("role", "group");
  g.setAttribute("aria-labelledby", `${base}-titulo`);
  const cab = el("div", "inventario-cabeca");
  const t = el("h4", "inventario-titulo");
  t.id = `${base}-titulo`;
  const ic = desenharIcone(svgNovo(), tipo, {});
  ic.classList.add("aparelho-icone");
  t.append(ic, el("span", null, I.titulo));
  const cont = el("div", "contador-caixa");
  cont.setAttribute("role", "group");
  cont.setAttribute("aria-label", `Quantos tem: ${I.titulo.toLowerCase()} (${onde})`);
  const menos = el("button", "btn sec", "−");
  menos.type = "button";
  menos.id = `${base}-menos`;
  menos.disabled = !n;
  menos.setAttribute("aria-label", `Menos 1: ${I.um.toLowerCase()} (${onde})`);
  menos.addEventListener("click", () => tirarUm(d, tipo));
  const valor = el("output", "contador-valor", String(n));
  valor.id = `${base}-valor`;
  const mais = el("button", "btn sec", "+");
  mais.type = "button";
  mais.id = `${base}-mais`;
  mais.setAttribute("aria-label", `Mais 1: ${I.um.toLowerCase()} (${onde})`);
  mais.addEventListener("click", () => maisUm(d, tipo));
  cont.append(menos, valor, mais);
  const nao = el("button", "btn sec pequeno inventario-nao-tem", "Não tem");
  nao.type = "button";
  nao.id = `${base}-nao-tem`;
  nao.setAttribute("aria-pressed", String(sem));
  nao.setAttribute("aria-label", `Não tem ${I.titulo.toLowerCase()} (${onde})`);
  nao.addEventListener("click", () => alternarNaoTem(d, tipo));
  cab.append(t, cont, nao);
  g.append(cab);
  if (!n) {
    if (!sem) g.append(el("p", "ajuda", "Diga quantos tem com o + ou toque em \"Não tem\"."));
    return g;
  }
  // Os que a planta traz são uma sugestão (nenhum respondido ainda): o cliente acerta o número e diz como é cada um.
  g.append(el("p", "ajuda", `${falta === n ? `Sugerimos ${n}: acerte com − e +. ` : ""}${I.pergunta}${tipo === "tomada" ? " Marque \"Inteligente\" nas que já se comandam pelo telemóvel." : " Marque \"Inteligente\" nos que já se comandam pelo telemóvel."}`));
  const ul = el("ul", "inventario-itens");
  els.forEach((e, i) => {
    const li = el("li", `inventario-item${e.confirmado === true ? "" : " por-responder"}`);
    const nome = n > 1 ? `${I.um} ${i + 1}` : I.um;
    const rot = el("button", "inventario-nome", nome);
    rot.type = "button";
    rot.id = `${base}-${i}-nome`;
    rot.title = "Ver na planta";
    rot.addEventListener("click", () => localizarNaPlanta(e.id, rot));
    const ops = el("div", "acao-botoes inventario-opcoes");
    ops.setAttribute("role", "group");
    ops.setAttribute("aria-labelledby", rot.id);
    for (const [v, texto, longo] of I.opcoes) {
      const b = el("button", "acao-botao", texto);
      b.type = "button";
      b.id = `${base}-${i}-${v}`;
      b.setAttribute("aria-label", `${nome} (${onde}): ${longo}`);
      b.setAttribute("aria-pressed", String(e.confirmado === true && I.valor(e.props) === v));
      // Interruptores: o desenho das teclas por cima do número.
      if (I.desenho) { b.classList.add("com-desenho"); b.replaceChildren(I.desenho(v), el("span", null, texto)); }
      b.addEventListener("click", () => responderInventario(d, e.id, (x) => I.mudar(x, v), b.id));
      ops.append(b);
    }
    // "Inteligente" (decisão do dono, 2026-10-04, que corrigiu o "Quero inteligente" do mesmo dia): este passo descreve o
    // que a casa JÁ TEM — a tomada ou o interruptor que lá está é inteligente (comanda-se pelo telemóvel)? Fica à
    // esquerda das outras escolhas ("Simples", "1"), liga e desliga, e não conta como resposta aos botões nem ao tipo.
    // Querer um inteligente continua em "Trocar e reparar".
    {
      const sim = e.props?.inteligente === true;
      const grupo = el("div", "acao-botoes inventario-inteligente");
      const bi = el("button", "acao-botao com-desenho");
      bi.append(desenhoInteligente(), el("span", null, "Inteligente"));
      bi.type = "button";
      bi.id = `${base}-${i}-inteligente`;
      bi.setAttribute("aria-pressed", String(sim));
      bi.setAttribute("aria-label", `${nome} (${onde}): já é inteligente (comanda-se pelo telemóvel)`);
      bi.addEventListener("click", () => marcarInteligente(d, e.id, !sim, bi.id));
      grupo.append(bi);
      const escolhas = el("div", "inventario-escolhas");
      escolhas.append(grupo, ops);
      li.append(rot, escolhas);
    }
    ul.append(li);
  });
  g.append(ul);
  return g;
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
    bf.addEventListener("click", () => pedirFoto(chave, depois, { rotulo: `Foto: ${rotuloFoto}` }));
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
  trocar.addEventListener("click", () => pedirFoto(chave, depois, { rotulo: `Foto: ${rotuloFoto}` }));
  const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
  apagar.type = "button";
  apagar.id = `${base}-foto-apagar`;
  apagar.setAttribute("aria-label", `Apagar a foto: ${rotuloFoto}`);
  apagar.addEventListener("click", async () => { await tirarFoto(chave); depois(true, "Foto apagada."); });
  acoes.append(trocar, apagar);
  return [null, acoes];
}

// "Voltar à nossa sugestão": só em estados antigos com as divisões mexidas à mão (lote 4).
ligarRecalcular("divisoes-recalcular", () => estado.divisoesEditadas, () => {
  estado.divisoes = divisoesSugeridas(contagemAtual());
  estado.divisoesEditadas = false;
}, desenharDivisoes);
// Lote 8: as divisões mudam-se no passo "A casa" (aqui estão presas; o passo Planta saiu do funil).
$("divisao-adicionar").addEventListener("click", () => irPara(P.casa));

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
  desenharEstimativaProvisoria();   // a estimativa por baixo da barra segue a escolha (ex.: carregador com medição)
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
  // Ronda dinheiro: no carregador Novo a pergunta é "Com medição no telemóvel?" (opcional; sem resposta = Não: a linha
  // dedicada de 390 € já traz tudo; com "Sim" junta-se o disjuntor inteligente).
  const medicao = (e) => perguntaMedicao(e.tipo, e.props) && acaoDe(e, sv) === "novo";
  const pergunta = (e) => medicao(e) || (perguntaInteligente(e.tipo) && ["substituir", "novo"].includes(acaoDe(e, sv)));
  const textoPergunta = (e) => (medicao(e) ? "Com medição no telemóvel?" : "Por um inteligente?");
  // O rótulo da pergunta: no "Por um inteligente?" leva o símbolo do Wi-Fi (o mesmo do botão "Inteligente" das Divisões).
  const rotuloPergunta = (e, texto) => {
    const s = el("span", "com-simbolo", texto);
    if (!medicao(e)) s.prepend(desenhoInteligente());
    return s;
  };
  const valorInteligente = (e) => (medicao(e) ? e.inteligente === true : acaoDe(e, sv) === "novo" ? inteligenteDe(e, estado.quer.objetivos) : e.inteligente);
  const inteligenteTodos = !umAUm && els.length > 1 && pergunta(els[0]) && els.every((e) => acaoDe(e, sv) === acaoDe(els[0], sv));
  if (inteligenteTodos) {
    const g = el("div", "acao-inteligente");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", `${textoPergunta(els[0])} ${els.length} ${nomeL} (${onde}), todos`);
    g.append(rotuloPergunta(els[0], `${textoPergunta(els[0])} (${els.length === 2 ? "os 2" : `os ${els.length}`})`));
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
      g.setAttribute("aria-label", `${textoPergunta(e)} ${nomeE} (${onde})`);
      g.append(rotuloPergunta(e, `${textoPergunta(e)}${els.length > 1 ? ` (${nomeE.toLowerCase()})` : ""}`));
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
/** O quadro está marcado "Com problemas" mas ainda sem dizer o que se passa (nenhum cartão; com "Outro", sem descrição). Estados antigos só com texto: descrito. */
const quadroPorDescrever = () => typeof estado.quadroAvaria === "string"
  && (estado.quadroProblemas.length ? estado.quadroProblemas.includes("outro") && !estado.quadroAvaria.trim() : !estado.quadroAvaria.trim());
/** Avarias indicadas: aparelhos a reparar e o quadro com problemas. */
const nAvarias = (planta) => aReparar(planta).length + (estado.quadroAvaria !== null ? 1 : 0);

/** O aviso do "Seguinte" está à vista (os separadores que faltam ficam marcados até "Tudo respondido."). */
let avisoTrocar = false;
function mensagemTrocar(texto, tipo = "info") {
  avisoTrocar = false;
  avisoPorVer.trocar = false;
  const m = $("trocar-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}
/** O que falta para sair do passo (texto), ou null: fluxo curto → pelo menos uma avaria; o quadro; as divisões. */
function faltaNoTrocar() {
  const planta = plantaDivisoes();
  if (fluxoCurto() && !nAvarias(planta)) return { texto: "Marque pelo menos uma avaria (aparelho ou quadro).", alvo: "reparar" };
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
 * Fica (ou volta) neste passo e assinala o que falta (o cartão a pulsar, o foco no 1.º campo). Devolve true se bloqueou.
 */
function bloquearTrocar() {
  const f = faltaNoTrocar();
  if (!f) return false;
  if (estado.passo !== P.trocar) irPara(P.trocar, { foco: false });
  mensagemTrocar(null);
  avisoTrocar = true;
  if (f.alvo === "reparar") {
    const b = document.querySelector("#trocar .acao-reparar") ?? $("trocar-quadro-problemas");
    assinalar(b?.closest(".divisao-cartao") ?? $("trocar"), f.texto, b);
  } else if (f.alvo === "quadro") {
    // Sem cartão escolhido: o 1.º cartão; com "Outro" sem descrição: a descrição.
    const alvo = estado.quadroProblemas.length ? $("trocar-quadro-avaria") : document.querySelector("#trocar-quadro-problemas-grelha input");
    if (alvo?.id === "trocar-quadro-avaria") alvo.setAttribute("aria-invalid", "true");
    assinalar($("trocar-quadro"), f.texto, alvo);
  } else if (f.alvo === "quadro-foto") assinalar($("trocar-quadro"), f.texto, $("trocar-quadro-foto"));
  else {
    // O separador da 1.ª divisão com respostas em falta (os que faltam ficam marcados) e o cartão dela a pulsar.
    escolherDivisao(f.alvo, `tr-${f.alvo}-titulo`);
    assinalar($(`tr-${f.alvo}`), f.texto, $(`tr-${f.alvo}-titulo`));
  }
  return true;
}
/** Com o aviso do "Seguinte" à vista (separadores marcados): respondido tudo, "Tudo respondido." */
function atualizarAvisoTrocar() {
  if (avisoTrocar && !faltaNoTrocar()) mensagemTrocar("Tudo respondido.", "ok");
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
    // Divisão a divisão: a do separador fica vista; ✓ nas vistas com tudo respondido.
    verDivisao(ativa, planta);
    const pronta = (d) => !faltaTrocar(planta, d).length;
    const vista = (d) => divisaoVista(estado, "trocar", d);
    const falta = (d) => (avisoTrocar && !pronta(d)) || (avisoPorVer.trocar && !vista(d));
    c.append(separadoresDivisoes("tr", planta, {
      feita: (d) => pronta(d) && vista(d), falta, avisar: avisoTrocar || avisoPorVer.trocar,
      rotuloFeita: "vista, tudo respondido", rotuloFalta: avisoPorVer.trocar ? "falta ver" : "falta responder",
    }));
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
  // Objetivos ("O que quer fazer", estados antigos): não acrescentam nada sozinhos, só dicas curtas (casa.js
  // dicasObjetivos) — aqui, onde se pede o trabalho novo (saíram das Divisões, que só levantam o que a casa já tem).
  for (const t of dicasObjetivos(d.nome, estado.quer.objetivos, { temTomadas: planta.elementos.some((e) => e.tipo === "tomada" && e.divisao === d.id) })) c.append(el("p", "ajuda divisao-dica", t));
  const bs = el("div", "divisao-botoes");
  const outro = el("button", "btn sec pequeno", "Acrescentar um aparelho");
  outro.type = "button";
  outro.id = `${id}-acrescentar`;
  outro.setAttribute("aria-label", `Acrescentar um aparelho: ${d.nome || "divisão"}`);
  outro.setAttribute("aria-haspopup", "dialog");
  outro.addEventListener("click", () => abrirAparelhos(d, outro.id));
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
    if (v !== "problemas") estado.quadroProblemas = [];
  }));
  if (comProblemas) {
    // Ronda B: os mesmos 7 cartões da avaria (várias escolhas; estado.quadroProblemas) em vez do texto livre; a
    // descrição é opcional (obrigatória só com "Outro"). Perigo (queimado, faíscas, choque): o aviso de segurança.
    const fs = el("fieldset", "escolhas trocar-quadro-problemas");
    const leg = el("legend", null, "O que se passa no quadro? ");
    leg.append(el("small", "ajuda", "Pode escolher vários."));
    fs.append(leg);
    const grelha = el("div", "escolhas-grelha problemas");
    grelha.id = "trocar-quadro-problemas-grelha";
    for (const [k, t] of Object.entries(AVARIA_PROBLEMA)) {
      const card = escolha("checkbox", "trocar-quadro-problema", k, t, null, (sim) => {
        const l = new Set(estado.quadroProblemas);
        if (sim) l.add(k); else l.delete(k);
        estado.quadroProblemas = Object.keys(AVARIA_PROBLEMA).filter((x) => l.has(x));
        agendarGravacao(false);
        desenharProgressoTrocar();
        atualizarAvisoTrocar();
        $("trocar-quadro-perigo").hidden = !avariaPerigosa({ problema: estado.quadroProblemas });
        $("trocar-quadro-avaria-ajuda").textContent = estado.quadroProblemas.includes("outro") ? "Obrigatória." : "Opcional.";
      }, iconeDe(ICONES_PROBLEMA[k] ?? ICONES_PROBLEMA.outro));
      card.querySelector("input").checked = estado.quadroProblemas.includes(k);
      grelha.append(card);
    }
    fs.append(grelha);
    c.append(fs);
    const perigo = el("p", "msg erro avaria-perigo", "Desligue o disjuntor geral e contacte-nos já.");
    perigo.id = "trocar-quadro-perigo";
    perigo.setAttribute("role", "alert");
    perigo.hidden = !avariaPerigosa({ problema: estado.quadroProblemas });
    c.append(perigo);
    const lab = el("label", "acao-avaria");
    const rot = el("span", null, "Descrição ");
    const ajuda = el("small", "ajuda", estado.quadroProblemas.includes("outro") ? "Obrigatória." : "Opcional.");
    ajuda.id = "trocar-quadro-avaria-ajuda";
    rot.append(ajuda);
    lab.append(rot);
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "trocar-quadro-avaria";
    inp.maxLength = MAX_AVARIA;
    inp.placeholder = "Ex.: o geral dispara ao ligar o forno";
    inp.value = estado.quadroAvaria;
    inp.addEventListener("input", () => {
      estado.quadroAvaria = inp.value.slice(0, MAX_AVARIA);
      inp.removeAttribute("aria-invalid");
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
    if (estado.mexerQuadro) {
      const ir = el("button", "btn sec pequeno", "Proteção do quadro (passo Melhorias)");
      ir.type = "button";
      ir.id = "trocar-quadro-perguntas";
      ir.addEventListener("click", () => { if (!bloquearTrocar()) irPara(P.melhorias); });
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
// fotos (até 5, a 1.ª obrigatória: FOTOS_AVARIA) e urgência (a mesma do passo Enviar, que aqui não se repete). Preço: o diagnóstico.
function montarAvaria() {
  // "Onde?" e "O que se passa?": várias escolhas (pelo menos uma de cada).
  const grupo = (id, nome, opcoes, campo, icones = null) => $(id).append(...Object.entries(opcoes).map(([k, t]) => escolha("checkbox", nome, k, t, null, (sim) => {
    const l = new Set(estado.avaria[campo]);
    if (sim) l.add(k); else l.delete(k);
    estado.avaria = normalizarAvaria({ ...estado.avaria, [campo]: [...l] });
    agendarGravacao(false);
    desenharAvaria();
  }, icones ? iconeDe(icones[k] ?? icones.outro) : null)));
  grupo("avaria-onde", "avaria-onde", AVARIA_ONDE, "onde");
  grupo("avaria-problema", "avaria-problema", AVARIA_PROBLEMA, "problema", ICONES_PROBLEMA);   // os mesmos desenhos do Início
  // "O que se passa?" escolhe-se no Início (ronda A): "Mudar" volta lá.
  $("avaria-problema-mudar").addEventListener("click", () => irPara(P.inicio));
  const NOME_URGENCIA = { normal: "Normal", semana: "Esta semana", urgente: "Urgente" };
  const AJUDA_URGENCIA = { normal: "Sem pressa.", semana: null, urgente: "Sem luz." };
  // Cores quando escolhida (CSS .urg-*): Normal verde, Esta semana amarelo, Urgente vermelho — com o texto sempre.
  $("avaria-urgencia").append(...Object.keys(URGENCIAS).map((k) => {
    const l = escolha("radio", "avaria-urgencia", k, NOME_URGENCIA[k], AJUDA_URGENCIA[k], (sim) => {
      if (sim) { estado.urgencia = k; agendarGravacao(false); }
    });
    l.classList.add(`urg-${k}`);
    return l;
  }));
  $("avaria-descricao").addEventListener("input", () => {
    estado.avaria = normalizarAvaria({ ...estado.avaria, descricao: $("avaria-descricao").value });
    $("avaria-descricao").removeAttribute("aria-invalid");
    agendarGravacao(false);
  });
}
// Sem "O que se passa?" ao chegar ao passo (estados de antes da ronda A): a pergunta fica aqui até sair da página.
let problemaAqui = false;
function desenharAvaria() {
  const a = estado.avaria;
  if (!a.problema.length) problemaAqui = true;
  $("avaria-problema-caixa").hidden = !problemaAqui;
  $("avaria-problema-escolhido").hidden = problemaAqui;
  $("avaria-problema-texto").textContent = a.problema.map((k) => AVARIA_PROBLEMA[k]).join(", ");
  const conselho = conselhoSeguranca([].concat(a.problema ?? []));
  $("avaria-perigo").hidden = !conselho;
  if (conselho) $("avaria-perigo").textContent = conselho;
  for (const i of document.querySelectorAll("input[name=avaria-onde]")) i.checked = a.onde.includes(i.value);
  for (const i of document.querySelectorAll("input[name=avaria-problema]")) i.checked = a.problema.includes(i.value);
  for (const i of document.querySelectorAll("input[name=avaria-urgencia]")) i.checked = i.value === estado.urgencia;
  if ($("avaria-descricao").value !== a.descricao) $("avaria-descricao").value = a.descricao;
  $("avaria-descricao-ajuda").textContent = a.problema.includes("outro") ? "Obrigatória." : "Opcional.";
  desenharFotoAvaria();
  // Preço: o diagnóstico (+ deslocação, que vem da localidade no passo Enviar).
  const pr = $("avaria-preco");
  const { preco, semDesloc } = calcular();
  ultimoPreco = { preco, plano: null };
  pr.hidden = semDesloc.total === null;
  pr.textContent = semDesloc.total === null ? "" : `${textoDiagnostico(semDesloc.total)}, descontado na reparação. A reparação orça-se na visita.`;
}
/** As fotos da avaria já tiradas (chaves FOTOS_AVARIA, pela ordem). */
const fotosAvaria = () => FOTOS_AVARIA.filter((k) => fotos.has(k));
/** Fotos da avaria: até 5 (a 1.ª obrigatória); miniaturas com "Apagar" e, enquanto houver lugar, "Tirar outra foto". */
function desenharFotoAvaria() {
  const corpo = $("avaria-foto-corpo");
  corpo.replaceChildren();
  let foco = "avaria-foto-botao";
  const depois = (ok, texto) => {
    const m = $("avaria-foto-msg");
    m.textContent = texto ?? "";
    m.className = `msg ${ok === false ? "erro" : "info"}`;
    m.hidden = !texto;
    if (ok === null) return;
    desenharAvaria();
    focar(foco) || focar("avaria-foto-apagar-0");
  };
  const tiradas = fotosAvaria();
  if (tiradas.length) {
    const lista = el("ul", "fotos-avaria");
    tiradas.forEach((k, n) => {
      const li = el("li", "foto-avaria");
      const img = el("img", "foto-quadro");
      img.src = fotos.get(k).miniatura;
      img.alt = `Foto ${n + 1} da avaria`;
      const apagar = el("button", "btn sec pequeno perigo-sec", "Apagar");
      apagar.type = "button";
      apagar.id = `avaria-foto-apagar-${n}`;
      apagar.setAttribute("aria-label", `Apagar a foto ${n + 1} da avaria`);
      apagar.addEventListener("click", async () => {
        foco = tiradas.length > 1 ? `avaria-foto-apagar-${Math.max(0, n - 1)}` : "avaria-foto-botao";
        await tirarFoto(k);
        depois(true, "Foto apagada.");
      });
      li.append(img, apagar);
      lista.append(li);
    });
    corpo.append(lista);
  }
  const livre = FOTOS_AVARIA.find((k) => !fotos.has(k));
  if (!livre) { corpo.append(el("p", "ajuda", `Já tem ${FOTOS_AVARIA.length} fotos, o máximo.`)); return; }
  const b = el("button", tiradas.length ? "btn sec" : "btn foto-grande");
  b.type = "button";
  b.id = "avaria-foto-botao";
  b.append(iconeCamara(), el("span", null, tiradas.length ? "Tirar outra foto" : "Tirar foto da avaria"));
  b.addEventListener("click", () => { foco = "avaria-foto-botao"; pedirFoto(livre, depois, { rotulo: `Foto ${FOTOS_AVARIA.indexOf(livre) + 1} da avaria` }); });
  corpo.append(b);
}
/** O que falta na avaria (texto para os leitores de ecrã e onde pôr o foco), ou null. */
function faltaAvaria() {
  const a = estado.avaria;
  return !a.onde.length ? ["Diga onde é a avaria.", "#avaria-onde input"]
    : !a.problema.length ? ["Diga o que se passa.", "#avaria-problema input"]
      : a.problema.includes("outro") && !a.descricao.trim() ? ["Descreva a avaria.", "#avaria-descricao"]
        : !fotosAvaria().length ? ["Falta a foto da avaria.", "#avaria-foto-botao"] : null;
}
/** Avaria por responder: fica (ou volta) no passo Avaria e assinala o grupo que falta (foco nele). Devolve true se bloqueou. */
function bloquearAvaria() {
  const f = faltaAvaria();
  if (!f) return false;
  if (estado.passo !== P.avaria) irPara(P.avaria, { foco: false });
  if (f[1] === "#avaria-descricao") $("avaria-descricao").setAttribute("aria-invalid", "true");
  const alvo = document.querySelector(f[1]);
  // O grupo que pulsa: o fieldset (Onde / O que se passa), a etiqueta da descrição ou o cartão das fotos.
  const grupo = alvo?.closest(f[1] === "#avaria-descricao" ? "label" : f[1] === "#avaria-foto-botao" ? ".cartao" : "fieldset");
  assinalar(grupo ?? alvo, f[0], alvo);
  return true;
}
montarAvaria();

// ------------------------------------------------------------ Melhorias (fase 2)
// 4 cartões (melhorias.js): o que o pacote leva nesta casa, "a partir de" (material + horas × tarifa + margem dos
// pacotes) e a escolha (sim/não). "Quadro seguro" com o quadro já no máximo: "Já incluído", sem escolha. Por baixo, o
// plano mensal sugerido com os pacotes aceites.
function desenharMelhorias() {
  desenharQuadroMelhorias();   // o cartão "Quadro elétrico" (B3) antes dos pacotes: o "Quadro seguro" segue-o
  const { melhorias } = calcular();
  const foco = document.activeElement?.closest?.("#melhorias") ? document.activeElement.value : null;
  $("melhorias").replaceChildren(...melhorias.map(cartaoMelhoria));
  if (foco) document.querySelector(`#melhorias input[value="${foco}"]`)?.focus();
  const est = $("melhorias-estado");
  est.textContent = catalogo === undefined ? "A obter os preços…" : catalogo === null ? "Sem preços agora: enviamos o preço depois do pedido." : "";
  est.hidden = !est.textContent;
}
/**
 * Já tenho a planta: para o Orçamento, pelo menos uma coisa a trocar, reparar ou acrescentar (ou o quadro) — ou uma
 * melhoria. (A primeira vez segue as regras do serviço, em "Trocar e reparar".) Texto do que falta, ou null.
 */
function faltaNasMelhorias() {
  if (!funilPlanta() || estado.mexerQuadro || estado.quadroAvaria !== null) return null;
  if (plantaDivisoes().elementos.some((e) => temAcao(e.tipo, e.props) && ACOES[e.acao] && e.acao !== "manter")) return null;
  if (calcular().aceites.length) return null;
  return "Escolha uma melhoria, ou algo para trocar, reparar ou acrescentar em Trocar e reparar.";
}
/** "Seguinte" (ou a barra) para lá das Melhorias sem nada no pedido: fica (ou volta) aqui com os pacotes a pulsar. */
function bloquearMelhorias() {
  const t = faltaNasMelhorias();
  if (!t) return false;
  if (estado.passo !== P.melhorias) irPara(P.melhorias, { foco: false });
  assinalar($("melhorias"), t);
  return true;
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
    // Pagamentos do pedido: faixa "Modo de demonstração" (simulados). Desligados: enviar é grátis na mesma, mas não se
    // compra nada (nem o relatório completo, nem a visita) e a avaria vai sem pagar.
    faixaDemonstracao(Boolean(j.pagamentos?.demonstracao));
    pagamentosAtivos = !listaEspera && !(j.pagamentos && j.pagamentos.ativo === false);
    textosPagamento();   // o botão e as compras do passo Enviar (com os preços da configuração)
    ajudaAvaria();       // o preço do diagnóstico no cartão "Tenho uma avaria" do Início
  } catch {
    catalogo = null;
    configOrc = null;
  }
  if (estado.passo === P.preco && !$(`passo-${P.preco}`).hidden) desenharPreco();
  if (estado.passo === P.melhorias && !$(`passo-${P.melhorias}`).hidden) desenharMelhorias();
  if (estado.passo === P.relatorio && !$(`passo-${P.relatorio}`).hidden) desenharCompleto();
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharDeslocacao();
  desenharEstimativaProvisoria();   // a estimativa por baixo da barra precisa dos preços
}

/** Avaria rápida: o preço é o diagnóstico (DIAG-AVARIA + horas × tarifa) e a deslocação. */
const PEDIDOS_AVARIA = [{ chave: "diagnostico", qtd: 1, acao: "reparar" }];
function calcular() {
  // Fase 2: os pacotes do passo "Melhorias" (melhorias.js) — os aceites juntam as suas linhas (grupo "melhoria") e a
  // margem dos pacotes (`extra`) ao total. A avaria rápida não tem melhorias.
  // Já nas Melhorias (ou para lá delas), um pacote aceite que ficou sem nada a acrescentar sai dos aceites.
  if (!funilAvaria()) acertarMelhorias(estado, ordemPasso(visitado) >= ordemPasso(P.melhorias));
  const melhorias = funilAvaria() ? [] : calcularMelhorias(estado, catalogo ?? null, configOrc);
  const aceites = melhorias.filter((m) => m.aceite);
  // Ronda regras: os pontos novos com preço fechado contam-se na planta que conta (`plantaPontos`; preco.js).
  const pedidos = funilAvaria() ? PEDIDOS_AVARIA.map((x) => ({ ...x })) : [...pedidosDaSelecao({ ...estado, plantaPontos: plantaParaContar() }), ...aceites.flatMap((m) => m.linhas)];
  const extra = aceites.reduce((t, m) => t + (m.margem ?? 0), 0);
  // Local da obra: a localidade do contacto (passo 7) — como em casaParaEnvio. `preco` (o que se envia) já leva a
  // deslocação; `semDesloc` é o do Resumo (passo 6), sem deslocação ("+ deslocação").
  // Ronda dinheiro: a deslocação é ida e volta por dia de obra (calcularPreco acerta os dias pelas horas) e, fora da
  // avaria, o total nunca fica abaixo da obra mínima (comObraMinima).
  const deslocacao = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc);
  const minimo = (p) => (funilAvaria() ? p : comObraMinima(p));
  const preco = minimo(calcularPreco(pedidos, catalogo ?? null, configOrc, deslocacao, extra));
  const semDesloc = minimo(calcularPreco(pedidos, catalogo ?? null, configOrc, { valor_iva: 0 }, extra));
  // Plano sugerido: "controlar à distância" = o pacote Casa inteligente aceite (B8: os cartões "O que quer fazer" saíram
  // do Orçamento; os objetivos de um estado antigo — "distância", "desligar tudo ao fechar" — continuam a contar).
  const distancia = quer("distancia") || quer("desligar") || aceites.some((m) => m.id === "casa-inteligente");
  return { pedidos, preco, semDesloc, melhorias, aceites, plano: planoSugerido(pedidos, { distancia }) };
}

/**
 * "Casa inteligente: 12 interruptores, 6 tomadas" (Orçamento e PDF). Sem o preço do pacote (decisão do dono, 2026-10-09):
 * o preço é o intervalo total, e o mínimo dele (−10 %) podia ficar abaixo do preço do pacote escrito por baixo.
 */
const textoMelhoria = (m) => `${m.nome}: ${m.resumo}`;
/** `simulacao.melhorias` (§6): os pacotes aceites, com os SKUs do catálogo. */
const melhoriasParaEnvio = (aceites) => aceites.map((m) => ({
  id: m.id, nome: m.nome, itens: m.itens.map((i) => ({ sku: linhaArtigo(i.chave).sku, qtd: i.qtd })).filter((i) => i.sku), preco: m.preco,
  ...(m.delta ? { quadro_delta: m.delta.map((i) => ({ sku: linhaArtigo(i.chave).sku, qtd: i.qtd })).filter((i) => i.sku) } : {}),
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
    if (k.outras.length) linha("Outras divisões", nomesOutras(k).join(", "));
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
  // Ronda regras: os pontos novos com preço fechado (luz, tomadas, interruptores — com o tipo de comando) e a campainha.
  add(q("ponto_luz"), "1 ponto de luz novo", "pontos de luz novos");
  add(q("ponto_tomada"), "1 tomada nova", "tomadas novas");
  const comandos = [[q("comutador_escada"), "de escada"], [q("inversor"), "inversor"], [q("botao_pressao") - q("campainha"), "de pressão"]].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`);
  add(q("ponto_interruptor"), `1 interruptor novo${comandos.length ? ` (${comandos.join(", ")})` : ""}`, `interruptores novos${comandos.length ? ` (${comandos.join(", ")})` : ""}`);
  add(q("campainha"), "1 campainha com botão de pressão", "campainhas com botão de pressão");
  // Ronda dinheiro: a linha dedicada (até 15 m) de cada máquina nova com circuito próprio; a do carregador com o diferencial tipo A.
  add(q("linha_dedicada_ve"), "1 linha dedicada para o carregador (até 15 m, com diferencial tipo A)", "linhas dedicadas para carregadores (até 15 m, com diferencial tipo A)");
  add(q("linha_dedicada") - q("linha_dedicada_ve"), "1 linha dedicada para máquina (até 15 m)", "linhas dedicadas para máquinas (até 15 m)");
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
    total.append(el("p", "sim-intervalo num", textoIntervalo(semDesloc)));
    // Ronda dinheiro: abaixo da obra mínima cobra-se o mínimo; as horas dizem-se em dias de obra.
    if (semDesloc.obra_minima) total.append(el("p", "ajuda", `Obra mínima: ${formatarEuroRedondo(semDesloc.obra_minima)}`));
    if (!foraDaArea()) total.append(el("p", "ajuda", "+ deslocação"));   // fora da área não há deslocação (textoEstimativa)
    if (semDesloc.dias) total.append(el("p", "ajuda", textoDias(semDesloc.dias)));
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
}

/**
 * "Descarregar orçamento (PDF)" (fase 1): feito no navegador (imprimir.js guardarPdfOrcamento) — cabeçalho, data, a
 * casa, a planta (1 página por piso, com as marcas das ações), o que inclui, o intervalo, os planos e a nota. Sem preços
 * de compra nem fornecedores.
 */
function dadosPdfOrcamento() {
  const { pedidos, semDesloc, aceites } = calcular();
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
    intervalo: pedidos.length && semDesloc.min !== null ? `${textoIntervalo(semDesloc)}${foraDaArea() ? "" : " + deslocação"}` : null,
    nota: `Estimativa; valor final após a visita.${pedidos.length && semDesloc.dias ? ` ${textoDias(semDesloc.dias)}.` : ""}${semDesloc.obra_minima ? ` Obra mínima: ${formatarEuroRedondo(semDesloc.obra_minima)}.` : ""}`,
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

// ------------------------------------------------------------ Relatórios (ronda A)
/** "2 tomadas, 1 interruptor, Frigorífico" (os aparelhos de uma divisão da planta). */
const itensDivisao = (planta, d) => listaPt(linhasDivisao(planta, d).map((l) => (l.modelo
  ? `${nomeUm(l)}${l.els.length > 1 ? ` (${l.els.length})` : ""}` : `${l.els.length} ${nomeLinha(l).toLowerCase()}`)));
const kvaTexto = (v) => `${String(v).replace(".", ",")} kVA`;
/** O conteúdo do relatório básico: a casa, as divisões com os aparelhos, o quadro e a potência sugerida (sem preços). */
function dadosRelatorio() {
  const planta = plantaDivisoes();
  const c = estado.casa;
  const n = planta.divisoes.length;
  const pisos = pisosDaCasa(c);
  const r = resumoDoQuadro(estado);
  const pac = PROTECAO_SIMPLES[pacoteDoQuadro(estado.quadro)]?.[0];
  const nc = estado.quadro.circuitos.length;
  return {
    data: new Date(),
    casa: [[TIPOS_CASA[c.tipo], !negocio() && c.tipologia ? c.tipologia : null].filter(Boolean).join(" ") || null,
      `${n} ${n === 1 ? "divisão" : "divisões"}`, pisos > 1 ? `${pisos} pisos` : null,
      `potência contratada ${kvaTexto(c.potencia_contratada_kva ?? POTENCIA_OMISSAO_KVA)}`, (FASES[c.fases] ?? "").toLowerCase() || null].filter(Boolean).join(" · "),
    divisoes: divisoesPorOrdem(planta).map((d) => ({ nome: `${d.nome || "Divisão"}${pisos > 1 ? ` (${nomePiso(pisoDe(d))})` : ""}`, itens: itensDivisao(planta, d) })),
    quadro: [
      `${nc} ${nc === 1 ? "circuito" : "circuitos"}${pac ? ` · proteção ${pac.toLowerCase()}` : ""}`,
      `Quadro de ${r.tamanho} módulos${r.quadros > 1 ? ` (${r.quadros} quadros)` : ""}${r.parciais ? `, com ${r.parciais} ${r.parciais === 1 ? "quadro parcial" : "quadros parciais"}` : ""}`,
    ],
    potencia: r.potencia.kva === null ? "Potência sugerida: acima de 41,4 kVA (contrato especial)."
      : `Potência sugerida: ${kvaTexto(r.potencia.kva)}${r.potencia.trifasica ? " (trifásica)" : ""}${r.potencia.minimo_rtiebt ? " (mínimo RTIEBT)" : ""}.`,
    planta: usaPlanta() ? estado.planta : null,
    pisos,
    // Decisão do dono (2026-10-05): os números da casa, se a potência chega, os circuitos que a casa pede e os pontos a rever.
    analise: analiseDaCasa(planta, c, r.potencia.kva),
    // O quadro é seguro? A frase da idade do quadro (sem resposta, a de "Não sei").
    quadroSeguro: IDADES_QUADRO[estado.quadroIdade ?? "naosei"].veredicto,
  };
}
/** Um desenho só de leitura da planta (um piso), como no PDF. */
function svgPlantaLeitura(planta, piso) {
  const svg = svgNovo();
  desenharPlanta(svg, planta, { soLeitura: true, piso });
  svg.setAttribute("class", "sim-relatorio-planta");
  return svg;
}
/** Passo "Relatório básico" (grátis): a planta (um desenho por piso), as divisões com os aparelhos e o quadro. */
function desenharRelatorio() {
  // Saiu da conta noutro bloco (no Enviar): o bloco deste passo volta a ler a sessão antes de pedir o email.
  if (relatorioFechado() && blocoContaRelatorio.eu()) blocoContaRelatorio.atualizar();
  portaoRelatorio();
  const d = dadosRelatorio();
  const caixa = $("relatorio");
  caixa.replaceChildren();
  const casa = el("div", "cartao");
  casa.append(el("h3", null, "A casa"), el("p", null, d.casa));
  if (d.planta) {
    for (let piso = 0; piso < d.pisos; piso++) {
      const fig = el("figure", "sim-relatorio-figura");
      const svg = svgPlantaLeitura(d.planta, piso);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `Planta: ${nomePiso(piso)}`);
      fig.append(svg);
      if (d.pisos > 1) fig.append(el("figcaption", null, nomePiso(piso)));
      casa.append(fig);
    }
  }
  const divs = el("div", "cartao");
  const ul = el("ul", "sim-inclui");
  ul.append(...(d.divisoes.length ? d.divisoes : [{ nome: "Ainda sem divisões", itens: "" }]).map((x) => {
    const li = el("li");
    li.append(el("strong", null, x.nome), document.createTextNode(x.itens ? `: ${x.itens}` : ""));
    return li;
  }));
  divs.append(el("h3", null, "Divisões em pormenor"), ul);
  // Os quatro blocos tirados da planta (relatorio-casa.js). O cartão "Quadro elétrico" de antes saiu (decisão do dono,
  // 2026-10-05): contava os circuitos do pedido, não os da casa, e contradizia a tabela.
  const a = d.analise;
  const numeros = el("div", "cartao");
  const dl = el("dl", "sim-numeros");
  for (const [k, v] of a.numeros) { const par = el("div"); par.append(el("dt", null, k), el("dd", "num", v)); dl.append(par); }
  numeros.append(el("h3", null, "A casa em números"), dl);
  const pot = el("div", `cartao sim-potencia ${a.potencia.estado}`);
  pot.append(el("h3", null, a.potencia.titulo), ...a.potencia.texto.map((t) => el("p", null, t)));
  const circ = el("div", "cartao");
  circ.append(el("h3", null, "Quadro ideal e circuitos que esta casa pede"));
  if (a.circuitos.length) {
    // O desenho do quadro que a casa pede (calculado; não é o quadro que lá está, que só o eletricista desenha pela foto).
    if (a.esquema) {
      const fig = el("figure", "sim-quadro-sugerido");
      fig.append(desenharQuadroCliente(a.esquema, { soLeitura: true, resumo: a.esquema.resumo }), el("figcaption", null, `Quadro ideal para esta casa, calculado pelo que descreveu. Não é o quadro que tem hoje: o eletricista adapta o que lá está a este. ${a.esquema.resumo}`));
      circ.append(fig);
      if (a.esquema.cores?.length) {
        const cores = el("ul", "sim-cores");
        cores.setAttribute("aria-label", "Cores dos circuitos no desenho");
        for (const [k, nome] of a.esquema.cores) { const li = el("li"); li.append(el("span", `sim-cor ${k}`), el("span", null, nome)); cores.append(li); }
        circ.append(cores);
      }
      if (a.esquema.legenda?.length) {
        const dl = el("dl", "sim-legenda");
        for (const [nome, texto] of a.esquema.legenda) dl.append(el("dt", null, nome), el("dd", null, texto));
        circ.append(el("h4", null, "O que é cada peça"), dl);
      }
    }
    const t = el("table", "sim-circuitos");
    const cab = el("tr");
    cab.append(...["Circuito", "Divisões", "Disjuntor", "Cabo"].map((x) => { const th = el("th", null, x); th.scope = "col"; return th; }));
    const corpoT = el("tbody");
    for (const c of a.circuitos) {
      const tr = el("tr");
      tr.append(el("td", null, c.nome), el("td", null, c.divisoes || "—"), el("td", "num", c.disjuntor), el("td", "num", c.cabo || "—"));
      corpoT.append(tr);
    }
    const thead = el("thead");
    thead.append(cab);
    t.append(thead, corpoT);
    const rolo = el("div", "sim-circuitos-rolo");
    rolo.append(t);
    circ.append(rolo);
    if (a.notaCircuitos) circ.append(el("p", "ajuda", a.notaCircuitos));
  } else circ.append(el("p", "ajuda", "Ainda sem tomadas nem máquinas descritas."));
  const rever = el("div", "cartao");
  const ur = el("ul", "sim-inclui");
  ur.append(...a.rever.map((t) => el("li", null, t)));
  rever.append(el("h3", null, "Pontos a rever"), a.rever.length ? ur : el("p", "ajuda", "Nada a assinalar pelo que descreveu."), el("p", "ajuda", "Orientativo, pelo que descreveu. Confirmamos na visita."));
  // O que pode ligar ao mesmo tempo, o consumo estimado e o próximo passo (decisão do dono, 2026-10-05).
  let junto = null;
  if (a.simultaneo) {
    junto = el("div", "cartao");
    const ul = el("ul", "sim-junto");
    for (const l of a.simultaneo.linhas) { const li = el("li", l.estado); li.append(el("strong", null, l.estado === "dispara" ? "A luz vai abaixo" : "Aguenta"), el("span", null, l.nomes), el("span", "num", l.w)); ul.append(li); }
    junto.append(el("h3", null, "O que pode ligar ao mesmo tempo"), el("p", "ajuda", `Com os ${a.simultaneo.limite} que tem contratados:`), ul);
  }
  let consumo = null;
  if (a.consumo) {
    consumo = el("div", "cartao");
    const ol = el("ol", "sim-inclui");
    ol.append(...a.consumo.maiores.map(([nome, k]) => el("li", null, `${nome}: ${k}`)));
    consumo.append(el("h3", null, "Consumo estimado por mês"), el("p", "sim-consumo-total", `Cerca de ${a.consumo.kwh} kWh, uns ${a.consumo.euros} €.`),
      ...(a.consumo.maiores.length ? [el("p", "ajuda", "O que mais gasta:"), ol] : []), el("p", "ajuda", a.consumo.nota));
  }
  let proximo = null;
  if (a.proximo.length) {
    proximo = el("div", "cartao sim-proximo");
    const ol = el("ol", "sim-inclui");
    ol.append(...a.proximo.map((t) => el("li", null, t)));
    proximo.append(el("h3", null, "O que fazíamos primeiro nesta casa"), ol);
    if (estado.funil === "primeira") {
      const b = el("button", "btn", "Pedir um serviço");
      b.type = "button";
      b.id = "relatorio-pedir-servico";
      b.addEventListener("click", () => { gravar(); registarCasaNaConta(); estado.funil = "planta"; estado.caminho = null; irPara(P.inicio); desenharInicio(); });
      proximo.append(el("p", "ajuda", "A casa já fica preenchida: só escolhe o que precisa."), b);
    }
  }
  // Do importante para o pormenor, como no PDF (decisão do dono, 2026-10-05): a casa e a planta, o que encontrámos, o
  // que fazíamos primeiro, o quadro ideal e, no fim, o consumo e as divisões.
  const seguro = el("div", `cartao sim-quadro-seguro${estado.quadroIdade === "antigo" ? " alerta" : ""}`);
  seguro.append(el("h3", null, "O seu quadro é seguro?"), el("p", null, d.quadroSeguro));
  caixa.append(...[seguro, casa, numeros, pot, junto, rever, proximo, circ, consumo, divs].filter(Boolean));
}
$("relatorio-pdf").addEventListener("click", async () => {
  const b = $("relatorio-pdf"), m = $("relatorio-pdf-msg");
  b.disabled = true;
  m.hidden = true;
  try {
    await guardarPdfRelatorio(dadosRelatorio());
    m.className = "msg ok";
    m.textContent = "Relatório guardado.";
  } catch {
    m.className = "msg erro";
    m.textContent = "Não foi possível fazer o PDF. Tente de novo.";
  }
  m.hidden = false;
  b.disabled = false;
});

/**
 * Passo "Relatório completo": o que traz, numa amostra feita com esta casa (as divisões e o material de cada uma) mas
 * com as quantidades e os preços tapados e desfocados (nada se lê); e "Quero o relatório completo" — o mesmo
 * estado.compras.relatorio que o passo Enviar mostra (os dois seguem-se). Sem pagamentos, só a amostra.
 */
function montarCompleto() {
  const l = escolha("checkbox", "completo-quero", "sim", "…", "Material e preço por divisão.", (sim) => {
    estado.compras = { ...estado.compras, relatorio: sim };
    agendarGravacao(false);
    textosPagamento();   // o passo Enviar segue (a escolha e o botão)
    desenharCompleto();
  });
  l.id = "completo-quero-opcao";
  $("completo-opcao").append(l);
}
const TAPADO = "■■■";
function desenharCompleto() {
  const planta = plantaDivisoes();
  const caixa = $("completo");
  caixa.replaceChildren();
  // "Descrever a minha casa" não tem passo Enviar: o relatório completo (pago ao enviar) pede-se em "Pedir um serviço".
  const parteCasa = funil() === "primeira";
  $("completo-titulo").hidden = parteCasa;
  caixa.hidden = parteCasa;
  const traz = el("div", "cartao");
  const ul = el("ul", "sim-inclui");
  ul.append(...["Lista de material, artigo a artigo.", "Preço por divisão.", "Planta técnica com símbolos e circuitos.", "Esquema por luz (comandos).", "Lista de ensaios a medir na visita.", "Esquema do quadro feito pelo eletricista."].map((t) => el("li", null, t)));
  traz.append(el("h3", null, "O que traz"), ul);
  // A amostra: as divisões desta casa com o material, sem quantidades nem preços (tapados e desfocados).
  const amostra = el("div", "cartao sim-amostra");
  const corpo = el("div", "sim-amostra-corpo");
  corpo.setAttribute("aria-hidden", "true");
  for (const d of divisoesPorOrdem(planta).slice(0, 3)) {
    const t = el("div", "sim-amostra-divisao");
    const cab = el("div", "sim-amostra-linha forte");
    cab.append(el("span", null, d.nome || "Divisão"), el("span", "sim-amostra-preco", `${TAPADO} €`));
    t.append(cab);
    for (const l of linhasDivisao(planta, d).slice(0, 3)) {
      const linha = el("div", "sim-amostra-linha");
      linha.append(el("span", null, `${nomeUm(l)} × ${TAPADO}`), el("span", "sim-amostra-preco", `${TAPADO} €`));
      t.append(linha);
    }
    corpo.append(t);
  }
  if (planta.divisoes.length) {
    const fig = el("div", "sim-amostra-planta");
    fig.append(svgPlantaLeitura(planta, 0));
    corpo.append(fig);
  }
  amostra.append(el("h3", null, "Amostra"), corpo, el("p", "ajuda", "Amostra desfocada, feita com a sua casa."));
  caixa.append(traz, amostra);
  // "Quero o relatório completo — 29 €" (com os pagamentos ligados; nunca na avaria).
  const quero = $("completo-quero");
  quero.hidden = parteCasa || !comprasAtivas();
  const l = $("completo-quero-opcao");
  if (!quero.hidden && l) {
    l.querySelector("span").firstChild.textContent = `Quero o relatório completo: ${formatarEuro(precoRelatorio())}`.replace(/ €/g, "\u00a0€");
    l.querySelector("input").checked = estado.compras.relatorio;
  }
}

// ------------------------------------------------------------ 8. Enviar
// Decisão do dono (2026-10-03): o bloco "Contacto" já não tem o campo Email (o do pedido é o da conta, mostrado em "A sua
// conta"; `estado.contacto.email` continua a ser o da conta e o servidor usa sempre esse).
const CAMPOS = ["nome", "telefone", "localidade", "morada", "mensagem"];
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
  montarCompras();   // fase 3: "O que quer receber?", no mesmo passo
  montarCompleto();   // ronda A: "Quero o relatório completo" (o mesmo estado.compras.relatorio)
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
  texto: { fora: "Escreva o seu email para enviar e acompanhar o pedido." },
  aoMudar: aoMudarConta,
});
/**
 * Duas partes (decisão do dono, 2026-10-04): em "Descrever a minha casa" o relatório grátis só se vê com conta (o
 * email confirmado pelo código). O segundo bloco de conta, no passo Relatório; ao entrar por ele, o do Enviar volta a
 * ler a sessão (aoMudarConta: a casa vai para a conta).
 */
const blocoContaRelatorio = criarBlocoConta($("relatorio-conta-bloco"), {
  prefixo: "conta-rel",
  texto: { fora: "É grátis: a sua casa fica guardada na conta, para a ver noutro aparelho e pedir serviços sem a descrever outra vez. Não o contactamos por isto." },
  aoMudar: () => { blocoConta.atualizar(); },
});
const relatorioFechado = () => funil() === "primeira" && !contaEu?.conta?.confirmado;
let portaoEstavaFechado = false;
function portaoRelatorio() {
  const fechado = relatorioFechado();
  $("relatorio-conta").hidden = !fechado;
  $("relatorio-conteudo").hidden = fechado;
  if (estado.passo === P.relatorio) $("sim-seguinte").hidden = fechado;   // o "Concluir" volta ao entrar na conta
  if (portaoEstavaFechado && !fechado && estado.passo === P.relatorio) focar(`titulo-${P.relatorio}`);
  portaoEstavaFechado = fechado;
}
function aoMudarConta(eu) {
  const antes = contaEu;
  contaEu = eu;
  const c = eu?.conta;
  preencherDoPerfil();
  portaoRelatorio();
  $("enviar-consentimento").hidden = !c;   // QA final: sem sessão, a aceitação dos Termos já está no bloco "Criar conta" (uma só vez)
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharEnviar();
  const primeira = !contaVista;
  contaVista = true;
  if (!c) { pedidoAberto = null; desenharAvisoPedido(); return; }
  if ((primeira || !antes) && c.confirmado) verPedidoEmAndamento();
  if (primeira) oferecerSimulacaoDaConta(eu);
  else if (!antes) guardarNaConta(0);   // entrou agora (no passo Enviar): a simulação desta página vai para a conta
}

/*
 * Cliente que regressa (decisão 2 do dono, 2026-10-04; ../regresso.js pedidoEmAndamento): com sessão, se a conta tem um
 * pedido em andamento, o Início avisa por cima dos cartões — "Já tem o pedido n.º N em andamento." com "Ver o meu
 * pedido" (conta.html#pedido-N) e "Fazer um pedido novo" (o aviso sai e segue-se). Sem sessão não se pede nada.
 */
let pedidoAberto = null;          // {id, quantos} ou null
let avisoPedidoFechado = false;   // "Fazer um pedido novo": o aviso não volta nesta página (só depois de enviar outro pedido)
async function verPedidoEmAndamento() {
  let r = null;
  try { r = await pedirConta("pedidos"); } catch { /* sem a lista não há aviso */ }
  if (!contaEu?.conta) return;
  pedidoAberto = pedidoEmAndamento(r?.pedidos);
  desenharAvisoPedido();
}
function desenharAvisoPedido() {
  const c = $("inicio-pedido");
  c.hidden = !pedidoAberto || avisoPedidoFechado;
  if (c.hidden) { c.replaceChildren(); return; }
  const ver = el("a", "btn sec pequeno", "Ver o meu pedido");
  ver.href = urlDoPedido(pedidoAberto.id);
  const novo = el("button", "btn sec pequeno", "Fazer um pedido novo");
  novo.type = "button";
  novo.addEventListener("click", () => {
    avisoPedidoFechado = true;
    desenharAvisoPedido();
    $(`titulo-${P.inicio}`).focus({ preventScroll: true });   // o foco não se perde com o botão
  });
  const acoes = el("div", "msg-acoes");
  acoes.append(ver, novo);
  c.replaceChildren(el("span", null, textoPedidoEmAndamento(pedidoAberto)), acoes);
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
  if (emCurso()) return { ...estado, guardado: new Date().toISOString() };
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
      const escolheu = preEscolher();   // a casa veio da conta: simulação nova → o cartão dela já escolhido
      if (estado.passo === P.inicio && !$(`passo-${P.inicio}`).hidden) { desenharInicio(); if (escolheu) desenharProgresso(); }
    }
    if (emCurso()) guardarNaConta(0); else decidido();
    return;
  }
  // A deste navegador é a mais recente (e é uma simulação a sério: um estado sem progresso nunca grava por cima da da conta).
  if (local && temProgresso(local, PASSO_INICIAL) && t(local) >= t(daConta) - 1000) { guardarNaConta(0); return; }
  if (!temProgresso(daConta, PASSO_INICIAL)) { decidido(); return; }
  // A da conta é a mais recente: continua-se nela (a deste navegador passa a ser essa).
  acabarAnular();
  casaPreEscolhida = false;   // uma simulação em curso retoma-se como sempre (sem a frase da casa encontrada)
  casaEncontrada = false;
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
    caixa.append(el("p", null, `${d.concelho}${km}: ${foraAreaTexto()}, sem deslocação.`),
      el("p", "sim-aviso-area", funilAvaria() && pagamentosAtivos ? `Não enviamos técnico tão longe. Fale connosco${meiosContacto() ? ` ${meiosContacto()}` : ""}.` : "Sem visita técnica: contactamos para combinar."));
  }
  else if (d.estado === "visita") caixa.append(el("p", null, "Não reconhecemos o concelho: a deslocação é confirmada na visita. Escolha o concelho da lista para marcar a visita."));
  // Ronda dinheiro: ida e volta por dia de obra ("Deslocação a Sintra (cerca de 29 km): 28,80 € (ida e volta, 4 dias)").
  else caixa.append(el("p", null, `Deslocação a ${d.concelho}${km}: ${formatarEuro(d.valor_iva)}${d.valor_iva > 0 ? (d.limitado ? ` (ida e volta; máximo ${d.dias} dias)` : ` (ida e volta, ${d.dias} ${d.dias === 1 ? "dia" : "dias"})`) : ""}`));
  textosPagamento();   // fora da área: textos sem visita e sem o bloco "A visita"
  if (funilAvaria()) {
    if (semDesloc.total !== null) caixa.append(el("p", "num", textoDiagnostico(semDesloc.total)));
    // A avaria paga-se ao enviar: o diagnóstico e a deslocação (o servidor confirma o valor).
    if (pagamentosAtivos && d.estado !== "fora_area" && preco.total !== null) caixa.append(el("p", "num forte", `A pagar ao enviar: ${formatarEuro(preco.total)} (descontado na reparação)`));
  }
  else if (pedidos.length && preco.min !== null) caixa.append(el("p", "num", `${d.estado === "fora_area" ? "Total sem deslocação" : "Total"}: ${textoComDeslocacao(preco)}`));
  caixa.hidden = false;
}
/**
 * QA final: o intervalo dos trabalhos (o mesmo do Orçamento e da conta) e a deslocação somada à parte, fixa —
 * "610 € – 815 € + deslocação 92,80 €"; sem concelho reconhecido "+ deslocação a confirmar" (nunca "com deslocação"
 * sem a saber); fora da área, só os trabalhos.
 */
function textoComDeslocacao(preco) {
  const d = preco.deslocacao;
  const t = textoIntervaloTrabalhos(preco);
  if (d?.estado === "fora_area") return t;
  if (d?.estado === "estimada") return preco.deslocacao_iva > 0 ? `${t} + deslocação ${formatarEuro(preco.deslocacao_iva)}` : `${t} (sem custo de deslocação)`;
  return `${t} + deslocação a confirmar`;
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
    if (preco?.min != null) partes.push(funilAvaria() ? textoDiagnostico(preco.artigos_iva + preco.mao_obra_iva) : `Estimativa: ${textoComDeslocacao(preco)}`);
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

// ---- Pagamentos (docs/PAGAMENTOS-PEDIDO.md), fase 3: ENVIAR É GRÁTIS (o relatório básico fica logo na conta). No passo
// Enviar compra-se o relatório completo e/ou a visita técnica (estado.compras), pagos a seguir ao envio (o pedido
// já existe: se o pagamento falhar, compra-se depois na conta). A avaria rápida paga o diagnóstico e a deslocação ao
// enviar e volta-se para simulador.html?pagamento=<ref>. O valor a pagar é sempre o do servidor; os daqui são para mostrar.
let TEXTO_ENVIAR = "Enviar pedido";   // segue a compra escolhida (textosPagamento)
let pagamentosAtivos = !listaEspera;  // GET /api/catalogo `pagamentos.ativo`: desligados (ou em lista de espera), não se compra nada
/** Localidade do contacto fora da área servida: não há visita técnica (nem nos textos, nem "A visita", nem no pedido). */
function foraDaArea() { return calcularDeslocacao(estado.contacto.localidade.trim(), configOrc).estado === "fora_area"; }
/** A área servida como se diz ao cliente: "até 100 km de Lisboa" (`deslocacao_max_km` e `deslocacao_base` da configuração). */
function kmMaximo() { const v = Number(configOrc?.deslocacao_max_km); return Number.isFinite(v) && v > 0 ? v : DESLOCACAO_OMISSAO.deslocacao_max_km; }
const baseDeslocacao = () => String(configOrc?.deslocacao_base ?? "").trim() || DESLOCACAO_OMISSAO.deslocacao_base;
const foraAreaTexto = () => `fora da área servida (até ${kmMaximo()} km de ${baseDeslocacao()})`;
/** Os textos que falam da visita: fora da área servida não há visita, usa-se o texto sem ela (`fora`). */
function comVisita(dentro, fora) { return foraDaArea() ? fora : dentro; }
/** A nota da estimativa: fora da área, sem a visita. */
const textoEstimativa = () => (foraDaArea() ? "Estimativa sem deslocação; valor final combinado consigo." : TEXTO_ESTIMATIVA);
/** Avaria rápida: o preço é sempre o do diagnóstico, fixo (sem intervalo): "Diagnóstico: 44,00 € + deslocação" (25 € + 0,5 h × tarifa de 38 €). */
const textoDiagnostico = (valor) => `Diagnóstico: ${formatarEuro(valor)}${foraDaArea() ? "" : " + deslocação"}`;
/** O cartão "Tenho uma avaria" do Início diz o preço do diagnóstico (DIAG-AVARIA + 0,5 h × tarifa) assim que o catálogo chega; sem ele, sem valor. */
function ajudaAvaria() {
  const ajuda = $("funil-avaria")?.querySelector("small");
  if (!ajuda) return;
  const { total } = calcularPreco(PEDIDOS_AVARIA.map((x) => ({ ...x })), catalogo ?? null, configOrc, { valor_iva: 0 });
  ajuda.textContent = total === null ? AJUDA_FUNIL.avaria : `Diagnóstico ${formatarEuro(total)} + deslocação, descontado na reparação.`;
}
/** Número ≥ 0 da configuração do servidor, ou o de omissão (preco.js). */
function valorConfig(k) {
  const v = configOrc?.[k];
  return v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : CONFIG_OMISSAO[k];
}
/** Relatório completo (€ c/ IVA): `preco_relatorio_iva` (29 €). */
const precoRelatorio = () => valorConfig("preco_relatorio_iva");
/**
 * Visita técnica (€ c/ IVA): a deslocação até à localidade + 0,5 h × tarifa; null fora da área, sem a localidade ou
 * sem concelho reconhecido (B2: só se marca a visita com um concelho da lista; o servidor recusa da mesma forma).
 */
function precoVisita() {
  const d = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc);
  if (d.estado !== "estimada") return null;
  return cent((d.valor_iva ?? 0) + VISITA_HORAS * valorConfig("tarifa_hora_iva"));
}
/** "deslocação 46,40 € + 30 min no local 17,50 €": de onde vem o preço da visita (a estimativa só mostra a deslocação). */
function partesVisita() {
  const d = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc);
  return `deslocação ${formatarEuro(d.valor_iva ?? 0)} + 30 min no local ${formatarEuro(cent(VISITA_HORAS * valorConfig("tarifa_hora_iva")))}`;
}
/** A localidade escrita não é um concelho da lista (deslocação "visita"): sem visita técnica até escolher um. */
const semConcelho = () => calcularDeslocacao(estado.contacto.localidade.trim(), configOrc).estado === "visita";
/** Compras no passo Enviar: com os pagamentos ligados e fora da avaria (lá o diagnóstico já inclui a visita). */
const comprasAtivas = () => pagamentosAtivos && !funilAvaria();
/** O que se compra de facto: estado.compras, sem a visita fora da área nem sem concelho reconhecido (B2). */
function compraEfetiva() {
  if (!comprasAtivas()) return { relatorio: false, visita: false };
  return { relatorio: estado.compras.relatorio, visita: estado.compras.visita && !foraDaArea() && !semConcelho() };
}
/** Chave da compra no pedido (`compra` do POST /api/orcamento). */
const chaveCompra = (c) => (c.relatorio ? (c.visita ? "pormenorizado_visita" : "pormenorizado") : c.visita ? "visita" : "basico");
/** O botão do passo Enviar: "Enviar pedido", "Enviar e pagar 29,00 €" ou, na avaria, "Pagar 47,60 € e enviar". */
function textoBotaoEnviar() {
  if (funilAvaria()) {
    if (!pagamentosAtivos || foraDaArea()) return "Enviar pedido";
    const { total: t, deslocacao: d } = calcular().preco;
    if (t !== null && d?.estado === "sem_localidade") return `Pagar ${formatarEuro(t)} + deslocação e enviar`;
    return t !== null ? `Pagar ${formatarEuro(t)} e enviar` : "Pagar e enviar";
  }
  const c = compraEfetiva();
  const pv = precoVisita();
  if (c.visita && pv === null) return "Enviar e pagar";
  const v = (c.relatorio ? precoRelatorio() : 0) + (c.visita ? pv : 0);
  return v > 0 ? `Enviar e pagar ${formatarEuro(v)}` : "Enviar pedido";
}
/** Os textos do passo Enviar e de "Pedido enviado!" (compras, avaria, fora da área, pagamentos desligados). */
function textosPagamento() {
  const fora = foraDaArea();
  // Os dias para a visita só com visita (decisão do dono, 2026-10-10: com "só o relatório básico" parecia marcar a visita
  // paga). A avaria leva sempre a visita do diagnóstico; sem pagamentos online não há visita paga e os dias ajudam a combinar.
  // Em lista de espera não se marca visita: os dias só se perguntam quando abrirmos.
  $("enviar-visita").hidden = Boolean(listaEspera) || fora || (!funilAvaria() && pagamentosAtivos && !estado.compras.visita);
  desenharCompras();
  $("enviar-texto").textContent = listaEspera
    ? `As obras começam ${ESPERA_QUANDO}. O pedido fica em lista de espera e não paga nada. * obrigatório`
    : funilAvaria() && pagamentosAtivos
      ? `${fora ? `${foraAreaTexto()}: fale connosco.` : "Paga o diagnóstico e a deslocação ao enviar (descontados na reparação)."} * obrigatório`
      : `Enviar é grátis: recebe logo o relatório básico na sua conta. * obrigatório`;
  TEXTO_ENVIAR = textoBotaoEnviar();
  if (estado.passo === P.enviar && !aEnviar && !enviado) $("sim-seguinte").textContent = TEXTO_ENVIAR;
  if (!enviado) {
    $("fim-texto").textContent = listaEspera
      ? `Recebemos o pedido e ficou em lista de espera. As obras começam ${ESPERA_QUANDO}: contactamos quando abrirmos as marcações.${funilAvaria() ? "" : " O relatório básico já está na sua conta."}`
      : `${funilAvaria()
        ? "Recebemos o pedido. Vamos marcar a visita: a data fica na sua conta."
        : "Recebemos o pedido. O relatório básico já está na sua conta."} ${textoPrazo()}`;
  }
}

/**
 * Prazo de contacto (decisão do dono, 2026-10-10): pedido normal no dia útil seguinte; avaria urgente no próprio dia
 * se chegar até às 18h de um dia útil, senão na manhã do dia útil seguinte. Igual em painel/src/conta.js prazoContacto.
 */
const textoPrazo = () => (estado.urgencia === "urgente"
  ? "Como é urgente, ligamos-lhe ainda hoje se o pedido chegou até às 18h de um dia útil; depois disso, na manhã do dia útil seguinte."
  : "Contactamos no dia útil seguinte.");

// Fase 3: "O que quer receber?" (estado.compras): só o relatório básico (grátis), o pormenorizado, os dois com a visita,
// ou só a visita. Os preços seguem a configuração e a localidade; fora da área, sem as opções com visita.
const OPCOES_COMPRA = {
  basico: { relatorio: false, visita: false },
  pormenorizado: { relatorio: true, visita: false },
  pormenorizado_visita: { relatorio: true, visita: true },
  visita: { relatorio: false, visita: true },
};
function montarCompras() {
  $("enviar-compras-opcoes").append(...Object.entries(OPCOES_COMPRA).map(([k, c]) => {
    const l = escolha("radio", "enviar-compra", k, "…", "…", (sim) => {   // os textos vêm de desenharCompras
      if (!sim) return;
      estado.compras = { ...c };
      agendarGravacao(false);
      textosPagamento();   // (o passo "Relatório completo" lê estado.compras.relatorio ao aparecer)
    });
    l.dataset.compra = k;
    return l;
  }));
}
function desenharCompras() {
  const caixa = $("enviar-compras");
  caixa.hidden = !comprasAtivas();
  if (caixa.hidden) return;
  const pr = formatarEuro(precoRelatorio());
  const v = precoVisita();
  const semLocal = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc).estado === "sem_localidade";
  // B2: localidade sem concelho reconhecido — as opções com visita ficam desligadas até escolher um da lista.
  const semConc = semConcelho();
  const pv = v === null ? null : formatarEuro(v);
  const semVisita = semConc ? "Escolha o concelho da lista para marcar a visita." : "Escreva a localidade para ver o preço.";
  const TEXTOS = {
    basico: ["Só o relatório básico (grátis)", "Estimativa e lista do trabalho, logo na conta."],
    pormenorizado: [`Relatório completo: ${pr}`, "Material e preço por divisão. Revisto por nós até 24 h."],
    pormenorizado_visita: [`Relatório completo e visita: ${pv ? formatarEuro(precoRelatorio() + v) : `${pr} + visita`}`,
      pv ? `Relatório ${pr} + visita ${pv} (${partesVisita()}).` : semVisita],
    visita: [`Só a visita técnica${pv ? `: ${pv}` : ""}`, pv ? `${partesVisita()[0].toUpperCase()}${partesVisita().slice(1)}.` : semVisita],
  };
  const atual = chaveCompra(compraEfetiva());
  for (const l of $("enviar-compras-opcoes").children) {
    const k = l.dataset.compra;
    const [t, a] = TEXTOS[k];
    const s = l.querySelector("span");
    s.firstChild.textContent = t.replace(/ €/g, " €");   // o "€" nunca fica sozinho na linha
    s.querySelector("small").textContent = a;
    l.hidden = OPCOES_COMPRA[k].visita && foraDaArea();
    l.querySelector("input").disabled = OPCOES_COMPRA[k].visita && semConc;
    l.querySelector("input").checked = k === atual;
  }
  $("enviar-compras-nota").textContent = foraDaArea() ? `${foraAreaTexto()}: sem visita técnica.`
    : semConc ? "Escolha o concelho da lista para marcar a visita."
      : `O que pagar agora é descontado na obra.${semLocal && estado.compras.visita ? " Para a visita, escreva a localidade." : ""}`;
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
    blocoConta.focar();
    assinalar($("enviar-conta"), contaEu ? "Confirme primeiro o seu email: escreva o código que lhe enviámos, em \"A sua conta\"." : "Para enviar, crie uma conta ou entre na sua conta, em \"A sua conta\".", false);
    return;
  }
  estado.contacto.email = contaEu.conta.email;
  const prob = problemaContacto(estado.contacto);
  if (prob) {
    // O campo em falta (pela ordem do ecrã: nome, telefone, localidade, morada) fica assinalado e com o foco; o email
    // é o da conta (sem campo aqui): um problema nele vai para a mensagem do passo.
    const i = $(`contacto-${prob.campo}`);
    if (!i) { mostrarEnvio(prob.texto, "erro"); return; }
    i.setAttribute("aria-invalid", "true");
    assinalar(i.closest("label"), prob.texto, i);
    return;
  }
  // Fase 3: a avaria paga-se ao enviar — fora da área não se envia (fale connosco); a visita precisa da localidade.
  if (funilAvaria() && pagamentosAtivos && foraDaArea()) {
    mostrarEnvio(`A sua localidade fica a mais de ${kmMaximo()} km de ${baseDeslocacao()}, fora da área servida: não enviamos técnico. Fale connosco.`, "erro", true);
    return;
  }
  const compra = compraEfetiva();
  if (compra.visita && precoVisita() === null) {
    const i = $("contacto-localidade");
    i.setAttribute("aria-invalid", "true");
    assinalar(i.closest("label"), semConcelho() ? "Escolha o concelho da lista para marcar a visita." : "Escreva a localidade (concelho) para marcarmos a visita.", i);
    return;
  }
  desenharPreco();
  const { preco, plano, aceites } = ultimoPreco;
  const listaFotos = fotosParaEnvio();
  let sim = montarSimulacao(estado, preco, plano, listaFotos, linhaArtigo, melhoriasParaEnvio(aceites ?? []));
  if (listaEspera) sim = { ...sim, lista_espera: true };   // a conta e o email de boas-vindas dizem-no (painel/src/conta.js, emails-auto.js)
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
  if (chaveCompra(compra) !== "basico") corpo.compra = chaveCompra(compra);
  Object.assign(corpo, origemContacto($("contacto-conheceu")?.value ?? ""));   // CRM: só a categoria ("Como nos conheceu?", senão o canal) e o ?servico= (web/origem.js)
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
  if (estadoHttp === 202 && resposta?.pagamento) {
    // Avaria (docs/PAGAMENTOS-PEDIDO.md): o pedido fica no servidor "a aguardar pagamento"; a simulação fica gravada
    // neste navegador e volta-se aqui (simulador.html?pagamento=<ref>) para confirmar e enviar as fotos.
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
    // Fase 3: a compra (relatório completo / visita) paga-se a seguir, sobre o pedido já enviado; volta-se à conta.
    // Se não abrir, o pedido está feito na mesma: compra-se na conta.
    if (resposta?.pagamento) {
      $("fim-texto").textContent = "Recebemos o pedido. A abrir o pagamento…";
      if (irPagar(resposta.pagamento)) return;
    }
    if (resposta?.pagamento || resposta?.pagamento_erro) {
      const e = typeof resposta.pagamento_erro === "string" ? resposta.pagamento_erro.trim().slice(0, 200) : "";
      $("fim-texto").textContent = `Recebemos o pedido e o relatório básico já está na sua conta. O pagamento não abriu${e ? ` (${e.replace(/[.!]$/, "")})` : ""}: pode comprar na sua conta.`;
    }
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
  // Avaria fora da área (ou sem o preço do diagnóstico): o servidor explica; fale connosco.
  else if (estadoHttp === 409 && typeof erro === "string") mostrarEnvio(erro.trim().slice(0, 300), "erro", true);
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
    // Avaria paga ao enviar: diagnóstico e deslocação (descontados se a reparação avançar); o CEO marca a visita.
    $("fim-texto").textContent = `Recebemos o pedido e o pagamento de ${formatarEuro(pagamento.valor)} (referência ${pagamento.ref}), descontado na reparação. Vamos marcar a visita: a data fica na sua conta e vai por email. ${textoPrazo()}`;
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
  for (let i = 0; i < PASSOS.length; i++) { const s = $(`passo-${i}`); if (s) s.hidden = true; }
  $("sim-como").hidden = true;
  fecharPlanta({ foco: false });
  $("sim-planta").hidden = true;
  $("sim-navegacao").hidden = true;
  document.querySelector(".sim-progresso").hidden = true;
  $("passo-fim").hidden = false;
  $("fim-resumo").textContent = preco?.min == null ? "Vamos enviar-lhe o preço depois de analisarmos a simulação."
    : funilAvaria() ? `Avaria: ${[estado.avaria.onde.map((k) => AVARIA_ONDE[k]).join(", "), estado.avaria.problema.map((k) => AVARIA_PROBLEMA[k]).join(", ")].filter(Boolean).join(" — ")}. ${textoDiagnostico(preco.artigos_iva + preco.mao_obra_iva)}. A reparação orça-se na visita.`
    : `Estimativa enviada: ${textoComDeslocacao(preco)}; ${textoEstimativa().replace(/^[^;]*; /, "")}${semFundo ? " (A planta foi sem a imagem de fundo.)" : ""}`;
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
  casaPreEscolhida = false;
  casaEncontrada = false;
  visitado = PASSO_INICIAL;
  ultimoPreco = null;
  pisoQuer = 0;
  pisoCasa = 0;
  divisaoTocada = null;
  aparelhoTocado = null;
  divisaoAtiva = null;
  clearTimeout(temporizadorPlanta);
  pisosEditor = null;
  abertasAcao.clear();
  mensagemTrocar(null);
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
}

/** Depois de recomeçar: o Início, com a barra dos passos (lote 8: já não há "Antes de começar"). */
function mostrarInicio() {
  document.querySelector(".sim-progresso").hidden = false;
  $("sim-form").hidden = false;
  mostrarPasso();
}

$("fim-nova").addEventListener("click", () => {
  recomecar();
  // Cliente que regressa (2026-10-04): outra simulação depois de enviar é uma simulação nova — a casa guardada fica
  // já escolhida e o aviso do pedido em andamento volta (agora com o que acabou de enviar).
  recusouCasa = false;
  preEscolher();
  avisoPedidoFechado = false;
  if (contaEu?.conta?.confirmado) verPedidoEmAndamento();
  $("passo-fim").hidden = true;
  $("sim-navegacao").hidden = false;
  mostrarInicio();
});

/*
 * "Começar de novo" sempre à mão (à direita dos passos), sem confirmação (decisão do dono): recomeça logo (no passo 1,
 * lote 8) e mostra "Simulação apagada · Anular" durante 4 s, com um X para fechar logo (decisão do dono, 2026-10-10). "Anular" repõe tudo como estava: o estado
 * (e o que estava gravado no navegador e na conta), as fotos (só saem do IndexedDB no fim do prazo; em memória
 * guarda-se uma cópia), o passo e a planta. Passado o prazo, ou ao tocar no primeiro serviço, fica apagada de vez.
 */
const PRAZO_ANULAR = 4_000;
let anular = null;   // { estado, visitado, fotos, temporizador } enquanto "Anular" está à vista
function recomecarComAnular() {
  acabarAnular();
  const arm = armazem ?? semArmazem;
  let casaBruta = null;
  try { casaBruta = arm.getItem(CHAVE_CASA); } catch { /* sem armazenamento */ }
  const antes = { estado: structuredClone(estado), visitado, fotos: new Map(fotos), casaPreEscolhida, casaEncontrada, recusouCasa, casaGuardada, casaBruta };
  // Decisão do dono (2026-10-05): "Começar de novo" apaga também a casa guardada neste navegador — "Pedir um serviço"
  // volta a pedir para descrever a casa primeiro. O "Anular" repõe-a. Com sessão, sai também da conta (decisão do dono,
  // 2026-10-09: voltava ao recarregar): sem casa guardada, o recomecar() manda `null` para a conta.
  casaGuardada = null;
  try { arm.removeItem(CHAVE_CASA); } catch { /* sem armazenamento */ }
  recomecar({ manterFotos: true });
  recusouCasa = true;
  mostrarInicio();
  const a = $("sim-anular");
  const b = el("button", "btn sec pequeno", "Anular");
  b.type = "button";
  b.id = "sim-anular-botao";
  b.addEventListener("click", anularRecomecar);
  const x = el("button", "sim-anular-fechar", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Fechar o aviso");
  x.addEventListener("click", acabarAnular);
  a.replaceChildren(el("span", null, antes.casaGuardada ? "Simulação e casa apagadas" : "Simulação apagada"), el("span", "sim-anular-sep", " · "), b, x);
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
  ({ casaPreEscolhida, casaEncontrada, recusouCasa, casaGuardada } = a);
  if (a.casaBruta !== null) { try { (armazem ?? semArmazem).setItem(CHAVE_CASA, a.casaBruta); } catch { /* quota */ } }
  for (const [k, v] of a.fotos) fotos.set(k, v);
  mostrarInicio();
  gravar();             // volta a ficar gravada neste navegador…
  guardarNaConta(0);    // …e na conta (com sessão)
}
/**
 * O aviso fica colado ao fundo do ecrã, por cima do meio da barra de baixo (decisão do dono, 2026-10-05: por cima da
 * barra tapava o texto da página). Nunca tapa "Anterior" nem "Seguinte": se não couber entre os dois (ecrã estreito),
 * volta a ficar logo por cima da barra.
 */
function posicionarAnular() {
  const a = $("sim-anular");
  if (!a.childElementCount) return;
  const n = $("sim-navegacao").getBoundingClientRect();
  const centro = n.width ? n.left + n.width / 2 : innerWidth / 2;
  a.style.left = `${centro}px`;
  const meia = a.offsetWidth / 2 + 8;
  const tapa = ["sim-anterior", "sim-seguinte"].some((id) => {
    const r = $(id).getBoundingClientRect();
    return r.width > 0 && r.right > centro - meia && r.left < centro + meia;
  });
  if (!n.height || tapa) { a.style.bottom = `${Math.max(16, innerHeight - (n.height ? n.top : innerHeight) + 8)}px`; return; }
  // Ao meio da altura da barra (ou a 8 px do fundo, se a barra for mais baixa do que o aviso).
  a.style.bottom = `${Math.max(8, innerHeight - n.bottom + (n.height - a.offsetHeight) / 2)}px`;
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
 * escolhido nas Melhorias — só enquanto o cliente ainda não chegou a esse passo nem escolheu nenhum. O "Quadro seguro"
 * aplica-se já ao quadro (o passo Quadro elétrico mostra logo "Completa" e a nota; escolher outra proteção tira-o).
 */
function preEscolherPacote() {
  const k = params.get("pacote");
  if (!CHAVES_MELHORIA.includes(k) || funilAvaria() || estado.melhorias.aceites.length || ordemPasso(visitado) >= ordemPasso(P.melhorias)) return;
  estado.melhorias.aceites = [k];
  acertarMelhorias(estado);
}

// ------------------------------------------------------------ arranque
function iniciar() {
  $("ano").textContent = String(new Date().getFullYear());
  montarServico();
  montarVisita();
  casaGuardada = carregarCasa(armazem ?? semArmazem);
  if (modoCliente) {
    document.title = "Ampliar a instalação | Domus Energia";
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
  if (regressoPagamento && guardado) retomarDoPagamento(guardado);   // volta do pagamento da avaria
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
    aplicarEntrada(estado, params);   // páginas de anúncio: `?servico=` (entrada.js), antes do `?pacote=`
    preEscolherPacote();
    preEscolher();   // cliente que regressa: a casa guardada já escolhida (sem `?servico=`, que já escolhe o caso)
    mostrarPasso(false);
    limparFotos(null);   // sem simulação para continuar: fotos que tenham ficado no navegador já não são de nenhuma
  }
  // Botões da página inicial (decisão do dono, 2026-10-05): `?caso=casa|servico|avaria` abre o Início com esse cartão
  // escolhido, como se o cliente lá tivesse carregado ("Pedir um serviço" sem casa guardada leva a descrever a casa).
  const caso = { casa: "primeira", servico: "planta", avaria: "avaria" }[params.get("caso")];
  if (caso && !regressoPagamento && !enviado) {
    if (estado.passo !== P.inicio) irPara(P.inicio, { foco: false });
    if (estado.funil !== caso || casaPreEscolhida) escolherFunil(caso);
  }
  blocoConta.atualizar();   // sessão da conta: passo Enviar e simulação guardada na conta
}

// Exposto só para os testes automáticos (não é usado pela página).
window.__simulador = { get estado() { return estado; }, get editor() { return editor; }, normalizarEstado, entradaFoto, fotos };

// A página nasce com a barra dos passos e o formulário escondidos (simulador.html `.a-carregar`): só aparecem já
// preenchidos, de uma vez, para não se ver a página vazia a passar. Se algo falhar, mostra-se na mesma.
try { iniciar(); } finally { $("conteudo")?.classList.remove("a-carregar"); }
