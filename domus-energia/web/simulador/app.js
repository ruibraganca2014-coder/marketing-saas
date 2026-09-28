// Simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md): 7 passos, progresso guardado
// no navegador, preço a partir do catálogo público e envio para POST /api/orcamento.
// Todos os textos do cliente e do servidor entram só com textContent.

import {
  TIPOS_CASA, MODELOS,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_PEQUENAS, OBJETIVOS, tipologiaDeQuartos,
  contarPlanta, divisoesDaContagem, sugerirCircuitos, circuitoVazio, numerar,
  plantaTemConteudo, nomeModelo, formatarW, FASES,
  perfilCasa, maquinasGrandesDe, modelosDoPerfil, objetivosDe, tiposDivisaoPara,
  TIPOS_COM_PISOS, nomePiso, pisoDe,
} from "./regras.js";
import {
  plantaDaCasa, assinaturaCasa, dicasObjetivos, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO,
  acertarPisos, temPorPiso, resumoPiso,
} from "./casa.js";
import {
  pedidosDaSelecao, calcularPreco, planoSugerido, PLANOS, TEXTO_ESTIMATIVA, formatarEuro, formatarEuroRedondo,
} from "./preco.js";
import {
  PASSOS, MAX_SIMULACAO, estadoNovo, normalizarEstado, temProgresso, guardarEstado, carregarEstado, apagarEstado,
  lerCodigoCliente, montarSimulacao, montarPedido, problemaContacto, tamanhoSimulacao, potenciaContratada,
  normalizarQuer, fasesSugeridas, POTENCIA_OMISSAO_KVA,
  maquinasParaPlanta, pisosDaCasa, maquinasEscolhidas, quantidadeNoPiso, MAX_QUANTIDADE,
} from "./estado.js";
import {
  opcoesCircuitos, protecoesDoPacote, pacoteDoQuadro, levaQuadroNovo, pisosDosQuadros, quadroDoPiso,
} from "./quadro.js";
import { criarEditor } from "./editor.js";
import { desenharIcone } from "./planta-svg.js";
import { sugerirConcelhos, calcularDeslocacao } from "./deslocacao.js";
import {
  MAX_FOTOS, MAX_BYTES_FOTO, ErroFoto, reduzirFoto, guardarFoto, apagarFoto, lerFotos, limparFotos, novoIdFotos, legendaCabecalho,
} from "./fotos.js";
import { criarBlocoConta, pedirConta, urlPainelApi, credenciais } from "../conta-comum.js";

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
// Índices dos passos (PASSOS em estado.js): o quadro vem depois das divisões (dimensiona-se com tudo conhecido).
const P = { casa: 0, quer: 1, planta: 2, divisoes: 3, quadro: 4, preco: 5, enviar: 6 };
// Área de cliente com código ("Ampliar a instalação"): a casa já é conhecida, começa em "O que quer".
const PASSO_INICIAL = codigoCliente ? P.quer : P.casa;
const estadoInicial = () => estadoNovo({ cliente: !!codigoCliente });

let estado = estadoInicial();
let visitado = PASSO_INICIAL; // passo mais adiantado a que o cliente já chegou
let catalogo = undefined;     // undefined = a carregar; null = falhou; array = itens
let configOrc = null;
let aEnviar = false;
let ultimoPreco = null;
let enviado = false;

const editor = criarEditor($("editor"), {
  aoMudar(p) {
    estado.planta = p;
    estado.plantaSaltada = false;
    estado.plantaAuto = false;   // já não é só a planta que desenhámos: não a refazemos sozinhos
    desenharContagem();
    textoSeguinte();
    // Mexeu a partir do passo "Divisões" ("−" ou a janela de um aparelho): o pedido e os cartões seguem a planta.
    if (estado.passo === P.divisoes) {
      refazerDivisoes(divisaoTocada ? [divisaoTocada] : []);
      desenharDivisoes();
    }
    if (voltarDivisoes && estado.passo === P.planta) $("planta-voltar-texto").textContent = "Feito. Pode acrescentar mais, ou tocar em \"Voltar às divisões\".";
    agendarGravacao();
  },
});

// ------------------------------------------------------------ gravação
let temporizador = null;
function agendarGravacao() {
  if (enviado) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(gravar, 300);
}
function gravar() {
  clearTimeout(temporizador);
  temporizador = null;   // sem gravação pendente: ao sair não se grava (outro separador pode ter a mais recente)
  if (enviado) return;
  const r = guardarEstado(armazem ?? semArmazem, estado);
  $("sim-guardado").textContent = r === "ok" ? "Guardado neste navegador"
    : r === "sem_imagem" ? "Guardado (sem a imagem de fundo, que não coube no navegador)"
      : "Não foi possível guardar neste navegador";
}
addEventListener("pagehide", () => { if (temporizador) gravar(); });

// ------------------------------------------------------------ passos
/** Minutos típicos de cada passo (pela ordem de PASSOS): só para o cliente saber quanto falta. */
const MINUTOS_PASSO = [1, 2, 4, 2, 2, 1, 1];
const minutosDe = (i) => (i === P.planta && estado.plantaSaltada ? 0 : MINUTOS_PASSO[i] ?? 1);
/** Por baixo do nome: "feito" nos passos para trás, "saltado" na planta saltada, o tempo típico nos que faltam. */
const tempoDe = (i) => (i === P.planta && estado.plantaSaltada && i !== estado.passo ? "saltado" : i < estado.passo ? "feito" : `~${minutosDe(i)} min`);

function desenharProgresso() {
  const ol = $("sim-passos");
  ol.replaceChildren();
  PASSOS.forEach((nome, i) => {
    const li = el("li");
    const atual = i === estado.passo;
    if (atual) li.setAttribute("aria-current", "step");
    li.className = atual ? "atual" : i < estado.passo ? "feito" : "";
    const num = el("span", "sim-num", String(i + 1));
    num.setAttribute("aria-hidden", "true");
    const tempoTxt = tempoDe(i);
    const tempo = el("span", "sim-passo-tempo", tempoTxt);
    tempo.setAttribute("aria-hidden", "true");
    const extra = tempoTxt === "feito" || tempoTxt === "saltado" ? ` (${tempoTxt})` : "";
    if (i <= visitado && !atual && !aEnviar) {
      const b = el("button", "sim-passo-botao");
      b.type = "button";
      b.append(num, el("span", "sim-passo-nome", nome), tempo);
      b.setAttribute("aria-label", `Passo ${i + 1}: ${nome}${extra}`);
      // Para lá do passo 4 só com todas as divisões verificadas (bloquearDivisoes).
      b.addEventListener("click", () => { if (!(i > P.divisoes && bloquearDivisoes())) irPara(i); });
      li.append(b);
    } else {
      // Sem botão (o atual e os que faltam): o nome acessível vai num texto só para leitores de ecrã (no telemóvel
      // o nome visível esconde-se e o aria-label num <span> não chega a todos os leitores).
      const s = el("span", "sim-passo-botao");
      const rotulo = `Passo ${i + 1} de ${PASSOS.length}: ${nome}${atual ? " (atual)" : extra || ` (cerca de ${minutosDe(i)} min)`}`;
      const nomeVis = el("span", "sim-passo-nome", nome);
      nomeVis.setAttribute("aria-hidden", "true");
      s.setAttribute("aria-label", rotulo);
      s.append(num, nomeVis, tempo, el("span", "so-leitor", rotulo));
      li.append(s);
    }
    ol.append(li);
  });
  $("sim-barra-cheia").style.width = `${((estado.passo + 1) / PASSOS.length) * 100}%`;
  // "Faltam cerca de N min" (à direita do título): o passo atual e os seguintes.
  const falta = $("sim-falta");
  const min = PASSOS.reduce((s, _, i) => s + (i >= estado.passo ? minutosDe(i) : 0), 0);
  falta.textContent = aEnviar || estado.passo >= PASSOS.length - 1 ? "Último passo." : `Faltam cerca de ${min} min.`;
}

function irPara(i, { foco = true } = {}) {
  const de = estado.passo;
  if (i !== P.planta) voltarDivisoes = null;   // "+" do passo "Divisões": só enquanto está na planta
  // Ao passar da planta para a frente (também a saltar da casa ou de "O que quer" pela barra): planta
  // (se ainda é a nossa), divisões, quadro e termóstatos pré-preenchidos (só o que o cliente ainda não
  // mudou à mão).
  if (i > P.planta && de <= P.planta) prepararPassosSeguintes();
  estado.passo = Math.max(0, Math.min(PASSOS.length - 1, i));
  visitado = Math.max(visitado, estado.passo);
  estado.visitado = visitado;
  mostrarPasso(foco);
  agendarGravacao();
  guardarNaConta();   // com sessão: a simulação fica também na conta (retomar noutro aparelho)
}

function mostrarPasso(foco = true) {
  for (let i = 0; i < PASSOS.length; i++) $(`passo-${i}`).hidden = i !== estado.passo;
  $("passo-fim").hidden = true;
  const p = estado.passo;
  $("sim-anterior").hidden = p === 0;
  textoSeguinte();
  if (p === P.casa) desenharCasa();
  if (p === P.quer) desenharQuer();
  if (p === P.planta) {
    if (preencherPlanta()) agendarGravacao();
    editor.definirTiposDivisao(tiposDivisaoPara(estado.casa.tipo));
    editor.definirMaquinas(maquinasEditor(), modelosDoPerfil(estado.casa.tipo));
    editor.definirPisos(pisosDaCasa(estado.casa));
    editor.abrir(estado.planta, { reiniciarVista: true });
    desenharContagem();
    desenharPlantaOrigem();
    textoSeguinte();
  }
  $("planta-voltar").hidden = !(p === P.planta && voltarDivisoes);
  if (p === P.divisoes) desenharDivisoes();
  if (p === P.quadro) desenharQuadro();
  if (p === P.preco) desenharPreco();
  if (p === P.enviar) desenharEnviar();
  desenharProgresso();
  if (foco) {
    const t = $(`titulo-${p}`);
    t.focus({ preventScroll: true });
    t.scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
  }
}

function textoSeguinte() {
  const p = estado.passo;
  $("sim-seguinte").textContent = p === PASSOS.length - 1 ? "Enviar pedido"
    : p === P.planta && voltarDivisoes ? "Voltar às divisões"
      : p === P.planta && !plantaTemConteudo(estado.planta) ? "Saltar a planta" : "Seguinte";
}

$("sim-form").addEventListener("submit", (ev) => ev.preventDefault());
$("sim-anterior").addEventListener("click", () => irPara(estado.passo - 1));
$("sim-seguinte").addEventListener("click", () => {
  if (estado.passo === PASSOS.length - 1) { if (!bloquearDivisoes()) enviar(); return; }
  if (estado.passo === P.planta && voltarDivisoes) { voltarAsDivisoes(); return; }
  // Do passo 4 só se avança com todas as divisões verificadas (e tudo respondido).
  if (estado.passo === P.divisoes && bloquearDivisoes()) return;
  // "Seguinte" com a planta desenhada usa-a (mesmo que antes a tenha saltado); vazia = saltar.
  if (estado.passo === P.planta) estado.plantaSaltada = !plantaTemConteudo(estado.planta);
  irPara(estado.passo + 1);
});

// ------------------------------------------------------------ 1. A casa
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
  for (const c of document.querySelectorAll("#passo-1 .quer-item")) desenharExtraQuer(c.dataset.maquina);
  desenharPisosQuer();
}

/** "O que quer fazer" (no fim do passo 1): os objetivos do perfil do imóvel, da casa toda; refeitos quando o perfil muda. */
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
      agendarGravacao();
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
      $(`quer-qtd-${k}-${d > 0 ? "mais" : "menos"}`)?.focus();
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
  ...maquinasGrandesDe(estado.casa.tipo), ...maquinasEscolhidas(estado.quer), "outro",
];

// ------------------------------------------------------------ 3. Planta (pré-desenhada) — docs §1.1
const assinaturaBase = () => assinaturaCasa(estado.casa, maquinasParaPlanta(estado));
/** A casa dá divisões? (tipologia, ou serviços/industrial; na área de cliente sem tipologia não.) */
const casaDaDivisoes = () => !!estado.casa.tipologia || negocio();

/**
 * Planta já desenhada a partir da casa e das máquinas (casa.js plantaDaCasa): quando está vazia, ou
 * quando ainda é a que desenhámos (o cliente não lhe mexeu) e a casa ou as máquinas mudaram. Nunca
 * toca numa planta em que o cliente mexeu. Sem tipologia (área de cliente com o passo 1 saltado) não
 * desenha nada.
 */
function preencherPlanta() {
  if (!casaDaDivisoes()) return false;
  if (plantaTemConteudo(estado.planta) && !(estado.plantaAuto && estado.plantaBase !== assinaturaBase())) return false;
  desenharDaCasa();
  return true;
}
function desenharDaCasa() {
  estado.planta = plantaDaCasa(estado.casa, maquinasParaPlanta(estado));
  estado.plantaAuto = true;
  estado.plantaBase = assinaturaBase();
}

/** A casa ou as máquinas mudaram depois de o cliente mexer na planta que desenhámos? */
const plantaDesatualizada = () => !estado.plantaAuto && !!estado.plantaBase && casaDaDivisoes()
  && plantaTemConteudo(estado.planta) && estado.plantaBase !== assinaturaBase();

function desenharPlantaOrigem() {
  const o = $("planta-origem");
  const mudou = plantaDesatualizada();
  o.hidden = !(estado.plantaAuto || mudou);
  o.textContent = mudou
    ? "Mudou a casa ou as máquinas depois de mexer na planta: mantivemos a sua planta. Se quiser, desenhamo-la de novo a partir dos passos 1 e 2 (perde o que mudou nela)."
    : "Já desenhámos as divisões (com tamanhos típicos), cada uma com os aparelhos base (porta, interruptor, luz e tomadas), e as máquinas que escolheu. Arraste, ajuste, acrescente divisões (escritório, lavandaria, despensa…) com os botões e tire ou acrescente o que for preciso — ou salte este passo.";
  $("planta-refazer").hidden = !mudou;
  $("planta-saltar").hidden = !plantaTemConteudo(estado.planta);
  $("planta-botoes").hidden = $("planta-refazer").hidden && $("planta-saltar").hidden;
}
$("planta-saltar").addEventListener("click", () => { estado.plantaSaltada = true; irPara(P.planta + 1); });

// ------------------------------------------------------------ 3. Planta (contagem)
function desenharContagem() {
  const c = $("planta-contagem");
  c.replaceChildren();
  const p = estado.planta;
  if (!p.divisoes.length && !p.elementos.length) {
    c.append(el("p", "ajuda", "Quando desenhar, mostramos aqui o que contámos em cada divisão."));
    return;
  }
  c.append(el("h3", null, "O que contámos"));
  const ul = el("ul", "lista-contagem");
  for (const l of contarPlanta(p)) {
    const partes = [];
    const add = (n, um, varios) => { if (n) partes.push(`${n} ${n === 1 ? um : varios}`); };
    add(l.luzes, "luz", "luzes");
    add(l.tomadas, "tomada", "tomadas");
    add(l.interruptores.length, "interruptor", "interruptores");
    add(l.janelas, "janela", "janelas");
    add(l.estores + l.estores_sem_motor, "estore", "estores");
    // Porta da rua: sugere um sensor só quando ainda não há um desenhado ao lado.
    add(l.portas_entrada_sem_sensor, "porta da rua (sensor sugerido)", "portas da rua (sensores sugeridos)");
    add(l.portas_entrada - l.portas_entrada_sem_sensor, "porta da rua (já com sensor)", "portas da rua (já com sensor)");
    add(l.sensores_porta, "sensor de porta", "sensores de porta");
    add(l.sensores_movimento, "sensor de movimento", "sensores de movimento");
    add(l.quadros, "quadro elétrico", "quadros elétricos");
    for (const m of l.maquinas) partes.push(`${nomeModelo(m.modelo).toLowerCase()} (${formatarW(m.potencia_w)})`);
    const li = el("li");
    li.append(el("b", null, `${l.nome}: `), document.createTextNode(partes.length ? partes.join(", ") : "nada ainda"));
    ul.append(li);
  }
  c.append(ul);
}

const usaPlanta = () => !estado.plantaSaltada && (estado.planta.divisoes.length > 0 || estado.planta.elementos.length > 0);

/**
 * Contagem para os passos seguintes: a da planta; sem planta (saltada), a da planta que a casa daria
 * (divisões, aparelhos habituais e máquinas escolhidas em "O que quer"), sem a gravar.
 */
const contagemAtual = () => contarPlanta(usaPlanta() ? estado.planta : plantaDaCasa(estado.casa, maquinasParaPlanta(estado)));

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
    const de = (tipo, nome) => { const l = c.filter((x) => x.tipo === tipo); return l.length || !geral ? l : [{ ...circuitoVazio(0, tipo), nome }]; };
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
  essencial: ["Básica", "O mínimo obrigatório: protege as pessoas de choques elétricos."],
  recomendado: ["Recomendada", "Também protege os aparelhos de picos de corrente (trovoada) e de falhas da rede."],
  completo: ["Completa", "Também avisa de faíscas nos fios dos quartos e da sala, e mostra e desliga a casa toda no telemóvel."],
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
  const nota = $("quadro-nota");
  const partes = [];
  if (q.para_raios === "sim") partes.push("Com pára-raios incluímos sempre a proteção contra picos de corrente.");
  partes.push(q.quadro_novo === "atual"
    ? "Aproveitamos o seu quadro e acrescentamos o que falta."
    : q.quadro_novo === "novo" ? "Incluímos um quadro novo no preço." : "Por precaução incluímos um quadro novo no preço: se o seu servir, sai do preço na visita.");
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
  caixa.hidden = !(estado.quadro.quadro_novo === "atual" || foto);
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
    c.setAttribute("role", "alert");
    c.append(el("p", null, pergunta));
    const bs = el("div", "botoes");
    const sim = el("button", "btn pequeno", textoSim);
    sim.type = "button";
    const nao = el("button", "btn sec pequeno", "Cancelar");
    nao.type = "button";
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
}, () => {
  editor.definirPisos(pisosDaCasa(estado.casa));
  editor.abrir(estado.planta, { reiniciarVista: true });
  desenharContagem();
  desenharPlantaOrigem();
  textoSeguinte();
}, { pergunta: "Isto apaga a planta atual (e o que desenhou nela) e desenha-a de novo a partir dos passos 1 e 2. Continuar?", sim: "Sim, refazer" });

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
}

/**
 * `simulacao.fotos` (§6): as fotos das linhas que ainda existem (e a do quadro), sem as imagens, pela ordem do
 * passo 4 (por piso); `legenda` = "Sala — Tomadas" (com pisos, "· Piso 1"). A do quadro geral é a "quadro".
 */
function fotosParaEnvio() {
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
  ["luzes_regulaveis", "Luz com intensidade regulável"],
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
const focar = (id) => { const x = id && $(id); if (!x || x.disabled) return false; x.focus({ preventScroll: true }); return true; };

let divisaoTocada = null;       // divisão mexida a partir deste passo (o pedido dela segue a planta)
let voltarDivisoes = null;      // {divisao, k}: "+" levou à planta; "Voltar às divisões" regressa a este cartão
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
  if (l.tipo === "luz") return conta(ps.filter((p) => p.brilho).length, "regulável", "reguláveis");
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
 * Detalhes obrigatórios (passo 4): aparelhos com pergunta por responder (`por_responder`: interruptor, tomada, janela,
 * luz, máquina "Outra"). A divisão só conta como verificada com tudo respondido; o "Seguinte" só avança com todas.
 */
const porResponder = (l) => l.els.filter((e) => e.por_responder).length;
function faltaResponder(planta, d) {
  return linhasDivisao(planta, d).filter(porResponder).map((l) => {
    const n = porResponder(l);
    return n === 1 ? nomeUm(l).toLowerCase() : `${n} ${nomeLinha(l, n).toLowerCase()}`;
  });
}
const divisaoVerificada = (planta, d) => estado.verificadas.includes(d.id) && !faltaResponder(planta, d).length;
/**
 * "Seguinte" (ou a barra dos passos) para lá do passo 4 com divisões por verificar: fica (ou volta) no passo 4, com a
 * mensagem e o foco no 1.º cartão por verificar. Devolve true se bloqueou.
 */
function bloquearDivisoes() {
  const planta = plantaDivisoes();
  const falta = divisoesPorOrdem(planta).filter((d) => !divisaoVerificada(planta, d));
  if (!falta.length) return false;
  if (estado.passo !== P.divisoes) irPara(P.divisoes, { foco: false });
  const nomes = falta.slice(0, 3).map((d) => d.nome || "Divisão");
  if (falta.length > 3) nomes.push(`mais ${falta.length - 3}`);
  mensagemDivisoes(`Falta verificar ${falta.length === 1 ? "1 divisão" : `${falta.length} divisões`}: ${listaPt(nomes)}. Responda ao que falta e toque em "Divisão verificada ✓".`, "erro");
  const t = $(`div-${falta[0].id}-titulo`);
  t?.focus({ preventScroll: true });
  $(`div-${falta[0].id}`)?.scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
  return true;
}

/** "luzes pelo telemóvel, 2 estores automáticos" (o que entra no preço para esta divisão). */
function resumoItens(x) {
  const partes = ITENS_DIVISAO.filter(([k]) => quantosDe(x, k) > 0).map(([k, t]) => {
    const n = quantosDe(x, k);
    return n > 1 && k !== "interruptores" ? `${n} ${t.toLowerCase()}` : t.toLowerCase();
  });
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
  mensagemDivisoes("Voltámos a usar a planta que desenhou: confira as divisões e toque outra vez.", "info");
  return false;
}

/** O editor tem de estar com a planta do estado para apagar, pôr ou abrir a janela (um passo de anular cada). */
function garantirEditor() {
  if (editor.planta === estado.planta) return;
  editor.definirTiposDivisao(tiposDivisaoPara(estado.casa.tipo));
  editor.definirMaquinas(maquinasEditor(), modelosDoPerfil(estado.casa.tipo));
  editor.definirPisos(pisosDaCasa(estado.casa));
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
 * "+" (e "Acrescentar outro aparelho", "Acrescentar uma divisão"): vai à planta, no piso da divisão, com ela
 * selecionada e a ferramenta desse aparelho escolhida. Pelo teclado o aparelho fica logo no meio da divisão (como
 * as ferramentas do editor); o cliente arrasta-o para o sítio certo.
 */
function acrescentar(d, l, ev = null) {
  if (d && !garantirPlanta()) return;
  const teclado = ev?.detail === 0;
  voltarDivisoes = { divisao: d?.id ?? null, k: l?.k ?? null };
  irPara(P.planta, { foco: false });
  const oque = l ? (l.modelo ? `a nova máquina (${MODELOS[l.modelo].nome.toLowerCase()})` : NOMES_TIPO[l.tipo][2]) : null;
  const texto = !d ? "Use os botões das divisões (Sala, Quarto…) para acrescentar a divisão; depois toque em \"Voltar às divisões\"."
    : oque && teclado ? `Pusemos ${oque} no meio de "${d.nome}": ${oque.startsWith("a ") ? "mova-a com as setas (ou arraste-a)" : "mova-o com as setas (ou arraste-o)"} para o sítio certo.`
      : oque ? `Toque na planta, dentro de "${d.nome}", onde fica ${oque}.`
        : `Escolha o aparelho nas ferramentas e toque na planta, dentro de "${d.nome}".`;
  editor.prepararColocar({ divisao: d?.id ?? null, tipo: l?.tipo ?? null, modelo: l?.modelo ?? null, texto, porJa: teclado && !!l });
  $("planta-voltar-texto").textContent = texto;
  if (!(teclado && l)) $("planta-voltar-texto").focus({ preventScroll: true });
}

/** "Voltar às divisões": o passo 4, com o foco e a vista no cartão de onde saiu. */
function voltarAsDivisoes() {
  const v = voltarDivisoes;
  voltarDivisoes = null;
  estado.plantaSaltada = !plantaTemConteudo(estado.planta);
  if (v?.divisao) refazerDivisoes([v.divisao]);
  irPara(P.divisoes, { foco: false });
  const base = v?.divisao ? `div-${v.divisao}` : null;
  const alvo = (base && ($(`${base}-${v.k}-mais`) ?? $(`${base}-titulo`))) || $("titulo-3");
  alvo.focus({ preventScroll: true });
  alvo.scrollIntoView({ block: base ? "center" : "start", behavior: reduzido() ? "auto" : "smooth" });
}
$("planta-voltar-botao").addEventListener("click", voltarAsDivisoes);

/** Janela simples de um aparelho (a do editor), aberta por cima deste passo; ao fechar o foco volta a `focoId`. */
function abrirJanela(d, e, focoId) {
  if (!garantirPlanta()) return;
  garantirEditor();
  divisaoTocada = d.id;
  editor.abrirOpcoes(e.id, {
    anfitriao: $(`passo-${P.divisoes}`),
    aoFechar: () => { desenharDivisoes(); focar(focoId) || focar(`div-${d.id}-titulo`); },
  });
}

/** "Divisão verificada ✓": liga/desliga; ao marcar, o foco passa ao cartão seguinte por verificar. */
function marcarVerificada(id, sim) {
  const s = new Set(estado.verificadas);
  if (sim) s.add(id); else s.delete(id);
  estado.verificadas = [...s];
  agendarGravacao();
  desenharDivisoes();
  const ids = plantaDivisoes().divisoes.map((d) => d.id);
  const seguinte = sim ? [...ids.slice(ids.indexOf(id) + 1), ...ids.slice(0, ids.indexOf(id))].find((x) => !s.has(x)) : null;
  if (seguinte) {
    const t = $(`div-${seguinte}-titulo`);
    t.focus({ preventScroll: true });
    $(`div-${seguinte}`).scrollIntoView({ block: "start", behavior: reduzido() ? "auto" : "smooth" });
  } else focar(`div-${id}-verificada`);
}

function desenharDivisoes() {
  const planta = plantaDivisoes();
  const origem = $("divisoes-origem");
  origem.hidden = usaPlanta() && !estado.divisoesEditadas;
  origem.textContent = !usaPlanta()
    ? "Saltou a planta: mostramos a que desenhámos a partir da casa. Se mudar alguma coisa aqui, passa a ser a sua planta."
    : "Numa versão anterior mudou divisões à mão: ficam como estavam até mexer nelas aqui (ou voltar à nossa sugestão).";
  $("divisoes-recalcular").hidden = !estado.divisoesEditadas;
  // Progresso: divisões verificadas desta planta.
  const ids = planta.divisoes.map((d) => d.id);
  const feitas = planta.divisoes.filter((d) => divisaoVerificada(planta, d)).length;
  $("divisoes-progresso-caixa").hidden = !ids.length;
  $("divisoes-progresso").textContent = ids.length && feitas === ids.length
    ? `Todas as divisões verificadas (${feitas} de ${ids.length}) ✓`
    : `${feitas} de ${ids.length} ${ids.length === 1 ? "divisão verificada" : "divisões verificadas"}`;
  $("divisoes-progresso-barra").style.width = `${ids.length ? (feitas / ids.length) * 100 : 0}%`;
  const c = $("divisoes");
  c.replaceChildren();
  if (!planta.divisoes.length) c.append(el("p", "ajuda", "Ainda sem divisões: acrescente-as na planta."));
  // Com pisos: agrupadas por piso, cada grupo com o título do piso.
  const n = Math.max(pisosDaCasa(estado.casa), ...planta.divisoes.map((d) => pisoDe(d) + 1), 1);
  if (n <= 1) for (const d of planta.divisoes) c.append(cartaoDivisao(planta, d, "h3"));
  else {
    for (let p = 0; p < n; p++) {
      const doPiso = planta.divisoes.filter((d) => pisoDe(d) === p);
      const g = el("section", "divisoes-piso");
      g.setAttribute("aria-labelledby", `divisoes-piso-${p}`);
      const t = el("h3", null, `${nomePiso(p)} (${doPiso.length} ${doPiso.length === 1 ? "divisão" : "divisões"})`);
      t.id = `divisoes-piso-${p}`;
      g.append(t);
      if (!doPiso.length) g.append(el("p", "ajuda", "Nenhuma divisão neste piso."));
      for (const d of doPiso) g.append(cartaoDivisao(planta, d, "h4"));
      c.append(g);
    }
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
  dicaT.textContent = "Para o aquecimento ou o ar condicionado, indique quantos termóstatos quer.";
  dicaT.hidden = !(quer("clima") && !estado.extras.termostatos);
}

/** Cartão de uma divisão: o nome, o que entra no preço, uma linha por aparelho e "Divisão verificada ✓". */
function cartaoDivisao(planta, d, nivel) {
  const id = `div-${d.id}`;
  const falta = faltaResponder(planta, d);
  const ver = divisaoVerificada(planta, d);   // só com tudo respondido
  const c = el("section", `cartao divisao-cartao${ver ? " verificada" : ""}`);
  c.id = id;
  c.setAttribute("aria-labelledby", `${id}-titulo`);
  const topo = el("div", "divisao-topo");
  const t = el(nivel, null, d.nome || "Divisão");
  t.id = `${id}-titulo`;
  t.tabIndex = -1;
  topo.append(t);
  if (ver) topo.append(el("span", "divisao-feita", "Verificada ✓"));
  c.append(topo);
  const ent = entradaDe(d);
  if (ent) c.append(el("p", "divisao-resumo", `No orçamento: ${resumoItens(ent)}.`));
  const linhas = linhasDivisao(planta, d);
  const ul = el("ul", "aparelhos");
  ul.setAttribute("aria-label", `Aparelhos: ${d.nome || "divisão"}`);
  for (const l of linhas) ul.append(linhaAparelho(d, l, planta));
  if (linhas.length) c.append(ul);
  else c.append(el("p", "ajuda", "Sem aparelhos na planta."));
  if (ent?.estores_sem_motor) c.append(el("p", "ajuda", "Há estores sem motor: precisam primeiro de um motor, vemos isso na visita."));
  // Objetivos ("O que quer fazer"): não acrescentam nada sozinhos, só dicas curtas (casa.js dicasObjetivos).
  for (const t of dicasObjetivos(d.nome, estado.quer.objetivos, { temTomadas: linhas.some((l) => l.tipo === "tomada") })) c.append(el("p", "ajuda divisao-dica", t));
  if (falta.length) {
    const f = el("p", "divisao-falta", `Falta responder: ${listaPt(falta)}. Toque no nome de cada um.`);
    f.id = `${id}-falta`;
    c.append(f);
  }
  const bs = el("div", "divisao-botoes");
  const outro = el("button", "btn sec pequeno", "Acrescentar outro aparelho");
  outro.type = "button";
  outro.id = `${id}-acrescentar`;
  outro.setAttribute("aria-label", `Acrescentar outro aparelho: ${d.nome || "divisão"} (na planta)`);
  outro.addEventListener("click", (ev) => acrescentar(d, null, ev));
  const v = el("button", "btn pequeno divisao-verificar", "Divisão verificada ✓");
  v.type = "button";
  v.id = `${id}-verificada`;
  v.setAttribute("aria-pressed", String(ver));
  v.setAttribute("aria-label", `Divisão verificada: ${d.nome || "divisão"}`);
  if (falta.length) { v.disabled = true; v.setAttribute("aria-describedby", `${id}-falta`); }
  v.addEventListener("click", () => marcarVerificada(d.id, !ver));
  bs.append(outro, v);
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

/** Uma linha: desenho, nome (abre a janela), pormenor, − n +, e a foto (Foto / miniatura com Trocar e Apagar). */
function linhaAparelho(d, l, planta) {
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
    bn.setAttribute("aria-controls", `${base}-quais`);
    bn.addEventListener("click", () => {
      if (abertas.has(base)) abertas.delete(base); else abertas.add(base);
      desenharDivisoes();
      focar(bn.id);
    });
  }
  txt.append(bn);
  const det = detalheLinha(l);
  const pend = porResponder(l);
  // Detalhe obrigatório por responder: "Falta responder" em vez do valor por omissão (ex.: "1 botão").
  if (pend) {
    txt.append(el("small", "falta-responder", n > 1 ? `Falta responder (${pend} de ${n})` : "Falta responder"));
    bn.setAttribute("aria-label", `${bn.getAttribute("aria-label")} — falta responder`);
  } else if (det) txt.append(el("small", null, det));
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
  // Foto (opcional): uma por tipo de aparelho e divisão.
  const chave = chaveFoto(planta, d, l);
  const foto = fotos.get(chave);
  const rotuloFoto = `${nome} (${onde})`;
  const depois = (ok, texto) => {
    mensagemDivisoes(texto, ok === false ? "erro" : "info");
    if (ok === null) return;
    desenharDivisoes();
    focar(`${base}-foto`) || focar(`${base}-mais`);
  };
  if (!foto) {
    const bf = el("button", "btn sec pequeno aparelho-foto");
    bf.type = "button";
    bf.id = `${base}-foto`;
    bf.setAttribute("aria-label", `Tirar foto: ${rotuloFoto}`);
    bf.append(iconeCamara(), el("span", null, "Foto"));
    bf.addEventListener("click", () => pedirFoto(chave, depois));
    linha.append(bf);
  }
  li.append(linha);
  if (foto) {
    // A miniatura com "Trocar" e "Apagar", por baixo do nome.
    const acoes = el("div", "aparelho-foto-acoes");
    const img = el("img", "foto-miniatura");
    img.src = foto.miniatura;
    img.alt = `Foto: ${rotuloFoto}`;
    acoes.append(img);
    const trocar = el("button", "btn sec pequeno", "Trocar");
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
    li.append(acoes);
  }
  if (n > 1 && abertas.has(base)) {
    const q = el("div", "aparelho-quais");
    q.id = `${base}-quais`;
    q.append(el("span", null, "Qual?"));
    l.els.forEach((e, i) => {
      const b = el("button", `btn sec pequeno${e.por_responder ? " por-responder" : ""}`, e.por_responder ? `${i + 1} · falta` : String(i + 1));
      b.type = "button";
      b.id = `${base}-qual-${i}`;
      b.setAttribute("aria-label", `${nomeUm(l)} ${i + 1} de ${n} (${onde}): ${e.por_responder ? "falta responder" : "mudar os dados"}`);
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
$("divisao-adicionar").addEventListener("click", (ev) => acrescentar(null, null, ev));
$("extra-central").addEventListener("change", () => { estado.extras.central = $("extra-central").checked; agendarGravacao(); });
$("extra-termostatos").addEventListener("input", () => { estado.extras.termostatos = lerNum($("extra-termostatos"), 0, 20); estado.termostatosEditados = true; if ($("extra-termostatos-dica")) $("extra-termostatos-dica").hidden = !(quer("clima") && !estado.extras.termostatos); agendarGravacao(); });

// ------------------------------------------------------------ 6. Preço
async function carregarCatalogo() {
  catalogo = undefined;
  try {
    const r = await fetch(`${urlApi}/catalogo`, { headers: { Accept: "application/json" }, credentials: credenciais });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!j || !Array.isArray(j.itens)) throw new Error("formato");
    catalogo = j.itens.filter((a) => a && typeof a.sku === "string");
    configOrc = j.config && typeof j.config === "object" ? j.config : null;
  } catch {
    catalogo = null;
    configOrc = null;
  }
  if (estado.passo === P.preco && !$(`passo-${P.preco}`).hidden) desenharPreco();
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharDeslocacao();
}

function calcular() {
  const pedidos = pedidosDaSelecao(estado);
  // Local da obra: a localidade do contacto (passo 7) — como em casaParaEnvio. `preco` (o que se envia) já leva a
  // deslocação; `semDesloc` é o do Resumo (passo 6), sem deslocação ("+ deslocação").
  const deslocacao = calcularDeslocacao(estado.contacto.localidade.trim(), configOrc);
  const preco = calcularPreco(pedidos, catalogo ?? null, configOrc, deslocacao);
  const semDesloc = calcularPreco(pedidos, catalogo ?? null, configOrc, { valor_iva: 0 });
  // "Desligar tudo ao fechar" (serviços/industrial) também é controlar à distância.
  return { pedidos, preco, semDesloc, plano: planoSugerido(pedidos, { distancia: quer("distancia") || quer("desligar") }) };
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
  editar.setAttribute("aria-label", "Editar os dados da casa (passo 1)");
  editar.addEventListener("click", () => irPara(0));
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
  const q = (k) => pedidos.filter((p) => p.chave === k || p.chave.startsWith(`${k}_`)).reduce((s, p) => s + p.qtd, 0);
  const itens = [];
  const add = (n, um, varios) => { if (n > 0) itens.push(n === 1 ? um : `${n} ${varios}`); };
  add(q("interruptor"), "1 interruptor inteligente (luzes pelo telemóvel)", "interruptores inteligentes (luzes pelo telemóvel)");
  add(q("regulador"), "1 luz com intensidade regulável", "luzes com intensidade regulável");
  add(q("estore"), "1 estore automático", "estores automáticos");
  add(q("sensor_movimento"), "1 sensor de movimento", "sensores de movimento");
  add(q("sensor_porta"), "1 aviso de porta ou janela aberta", "avisos de porta ou janela aberta");
  add(q("tomada"), "1 tomada inteligente", "tomadas inteligentes");
  add(q("termostato"), "1 termóstato (aquecimento ou ar condicionado)", "termóstatos (aquecimento ou ar condicionado)");
  const partes = q("disjuntor_protecoes") + q("disjuntor_simples");
  if (partes) itens.push(`Ver quanto gasta e ligar ou desligar ${partes === 1 ? "1 parte" : `${partes} partes`} da casa no telemóvel`);
  const pac = PROTECAO_SIMPLES[pacoteDoQuadro(estado.quadro)]?.[0];
  itens.push(`${pac ? `Proteção ${pac.toLowerCase()}` : "Proteções escolhidas"} no quadro elétrico${levaQuadroNovo(estado.quadro) ? ", com quadro novo" : ""}`);
  if (q("central")) itens.push("Central em casa, com bateria e sirene (funciona sem internet)");
  itens.push("Instalação por técnico habilitado");
  return itens;
}

function desenharPreco() {
  desenharCasaResumo();
  const est = $("preco-estado");
  const { pedidos, preco, semDesloc, plano } = calcular();
  ultimoPreco = { preco, plano };
  est.hidden = true;
  if (catalogo === undefined) { est.textContent = "A obter os preços…"; est.hidden = false; }
  else if (catalogo === null) { est.textContent = "Não conseguimos obter os preços agora. Mostramos o que escolheu — vamos enviar-lhe o preço depois de receber o pedido."; est.hidden = false; }

  const total = $("preco-total");
  total.replaceChildren();
  if (!pedidos.length) {
    total.append(el("p", "sim-intervalo", "Ainda não escolheu nada para instalar."), el("p", "ajuda", "Volte aos passos anteriores, ou envie o pedido na mesma: falamos consigo na visita."));
  } else if (semDesloc.min !== null) {
    // Sem deslocação: essa vem da localidade do contacto e mostra-se no passo 7.
    total.append(el("p", "sim-rotulo", "Estimativa com instalação"));
    total.append(el("p", "sim-intervalo num", `${formatarEuroRedondo(semDesloc.min)} – ${formatarEuroRedondo(semDesloc.max)}`));
    total.append(el("p", "ajuda", "+ deslocação"));
    if (!semDesloc.completo) total.append(el("p", "ajuda", "Algumas coisas ainda não têm preço: confirmamos na visita."));
  } else {
    total.append(el("p", "sim-intervalo", "Vamos enviar-lhe o preço"));
  }
  total.append(el("p", "sim-nota forte", TEXTO_ESTIMATIVA));

  const ul = $("preco-inclui");
  ul.replaceChildren(...(pedidos.length ? listaInclui(pedidos) : ["Ainda nada."]).map((t) => el("li", null, t)));
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
    premium: "Sugerimos o Premium porque escolheu a central em casa.",
    conforto: comSensores ? "Sugerimos o Conforto porque escolheu sensores (alarme e avisos no telemóvel)." : "Sugerimos o Conforto porque quer controlar a casa à distância (avisos no telemóvel quando não está).",
    base: "O Base chega para ligar, desligar e automatizar.",
  };
  pl.append(el("p", "ajuda", `${razoes[plano]} 1.º mês grátis, sem fidelização.`));
}

// ------------------------------------------------------------ 7. Enviar
const CAMPOS = ["nome", "telefone", "email", "localidade", "morada", "mensagem"];
function desenharEnviar() {
  if (contaEu?.conta) estado.contacto.email = contaEu.conta.email;   // o email do contacto é o da conta
  for (const k of CAMPOS) $(`contacto-${k}`).value = estado.contacto[k];
  desenharDeslocacao();
}

// ---- Conta de cliente (obrigatória para enviar; docs/CONTA-CLIENTE.md). Com sessão, a simulação fica também
// guardada na conta (ao mudar de passo) para a retomar noutro aparelho; as fotos por enviar ficam só neste navegador.
let contaEu = null;
let contaVista = false;   // já se viu a sessão desta página (a 1.ª vez pode oferecer a simulação da conta)
const blocoConta = criarBlocoConta($("enviar-conta-bloco"), {
  prefixo: "conta",
  texto: { fora: "Crie uma conta para enviar o pedido e depois acompanhá-lo (estado, proposta e fotos). Se já tem, entre." },
  aoMudar: aoMudarConta,
});
function aoMudarConta(eu) {
  const antes = contaEu;
  contaEu = eu;
  const c = eu?.conta;
  if (c) {
    // O perfil da conta preenche o que ainda está vazio no contacto; o email é sempre o da conta.
    for (const k of ["nome", "telefone", "morada", "localidade"]) if (!estado.contacto[k]?.trim() && c[k]) estado.contacto[k] = c[k];
    estado.contacto.email = c.email;
  }
  $("contacto-email").readOnly = true;
  $("contacto-email-ajuda").textContent = c ? "O da sua conta." : "Fica o da sua conta.";
  if (estado.passo === P.enviar && !$(`passo-${P.enviar}`).hidden) desenharEnviar();
  const primeira = !contaVista;
  contaVista = true;
  if (!c) return;
  if (primeira) oferecerSimulacaoDaConta(eu);
  else if (!antes) guardarNaConta(0);   // entrou agora (no passo Enviar): a simulação desta página vai para a conta
}

let temporizadorConta = null;
/** Guarda o estado do simulador na conta (1,5 s depois; sem imagem de fundo se for grande demais). */
function guardarNaConta(atraso = 1500) {
  if (!contaEu || enviado) return;
  clearTimeout(temporizadorConta);
  temporizadorConta = setTimeout(async () => {
    if (!contaEu || enviado) return;
    let e = { ...estado, guardado: new Date().toISOString() };
    if (JSON.stringify(e).length > 1_400_000 && e.planta?.fundo) e = { ...e, planta: { ...e.planta, fundo: null } };
    try {
      await pedirConta("simulacao", { corpo: { estado: e } });
      $("sim-guardado").textContent = "Guardado neste navegador e na sua conta";
    } catch { /* fica no navegador; volta a tentar no passo seguinte */ }
  }, atraso);
}

/**
 * Ao abrir a página com sessão: se a conta tem uma simulação mais recente do que a deste navegador (feita noutro
 * aparelho), pergunta se quer continuar essa. As fotos ficam no aparelho onde foram tiradas (aviso).
 */
async function oferecerSimulacaoDaConta(eu) {
  if (!eu.simulacao_atualizada) { guardarNaConta(0); return; }
  let r;
  try { r = await pedirConta("simulacao"); } catch { return; }
  const daConta = r?.estado ? normalizarEstado(r.estado) : null;
  if (!daConta || enviado) return;
  const local = carregarEstado(armazem ?? semArmazem);
  const t = (x) => Date.parse(x?.guardado ?? "") || 0;
  if (local && t(local) >= t(daConta) - 1000) { guardarNaConta(0); return; }   // a deste navegador é a mais recente
  if (!temProgresso(daConta, PASSO_INICIAL)) return;
  document.getElementById("sim-retomar-conta")?.remove();
  const quando = new Date(t(daConta) || r.atualizado);
  const data = Number.isNaN(quando.getTime()) ? "" : ` (${quando.toLocaleString("pt-PT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })})`;
  const caixa = el("div", "cartao sim-retomar");
  caixa.id = "sim-retomar-conta";
  caixa.setAttribute("role", "region");
  caixa.setAttribute("aria-label", "Simulação guardada na sua conta");
  const b1 = el("button", "btn", "Continuar a da conta");
  b1.type = "button";
  b1.id = "sim-continuar-conta";
  const b2 = el("button", "btn sec", "Ficar com esta");
  b2.type = "button";
  const bs = el("div", "form-botoes");
  bs.append(b1, b2);
  caixa.append(el("h2", null, "Continuar a simulação da sua conta?"),
    el("p", null, `Tem uma simulação guardada na sua conta${data}, no passo ${daConta.passo + 1}: ${PASSOS[daConta.passo]}. As fotos tiradas noutro aparelho ficam lá: tire-as de novo, ou envie-as depois na sua conta.`),
    bs);
  $("sim-retomar").before(caixa);
  b1.addEventListener("click", () => {
    caixa.remove();
    estado = daConta;
    visitado = Math.max(estado.passo, estado.visitado ?? 0);
    if (estado.passo > P.planta) acertarPedido();
    $("sim-retomar").hidden = true;
    document.querySelector(".sim-progresso").hidden = false;
    $("sim-form").hidden = false;
    if (contaEu?.conta) estado.contacto.email = contaEu.conta.email;
    mostrarPasso();
    agendarGravacao();
    carregarFotosDoEstado();
  });
  b2.addEventListener("click", () => { caixa.remove(); guardarNaConta(0); });
  b1.focus();
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
  const { pedidos, preco, plano } = calcular();
  ultimoPreco = { preco, plano };
  const caixa = $("enviar-deslocacao");
  const d = preco.deslocacao;
  caixa.replaceChildren();
  if (d.estado === "sem_localidade") { caixa.hidden = true; return; }
  const km = d.distancia_km ? ` (cerca de ${d.distancia_km} km)` : "";
  if (d.estado === "fora_area") caixa.append(el("p", null, `${d.concelho}${km} fica fora da área servida — contacte-nos. A deslocação não está incluída.`));
  else if (d.estado === "visita") caixa.append(el("p", null, "Não reconhecemos o concelho: a deslocação é confirmada na visita."));
  else caixa.append(el("p", null, `Deslocação a ${d.concelho}${km}: ${formatarEuro(d.valor_iva)}`));
  if (pedidos.length && preco.min !== null) caixa.append(el("p", "num", `${d.estado === "fora_area" ? "Total sem deslocação" : "Total com deslocação"}: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`));
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
    if (preco?.min != null) partes.push(`Estimativa: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`);
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
  const { preco, plano } = ultimoPreco;
  const listaFotos = fotosParaEnvio();
  let sim = montarSimulacao(estado, preco, plano, listaFotos);
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
  if (estadoHttp >= 200 && estadoHttp < 300) {
    // O pedido foi aceite; as fotos vão a seguir, uma a uma, com o token de uso único (§6).
    const resultadoFotos = listaFotos.length ? await enviarFotos(listaFotos, resposta, botao) : null;
    aEnviar = false;
    botao.disabled = false;
    botao.textContent = "Enviar pedido";
    concluido(preco, semFundo, resultadoFotos);
    return;
  }
  aEnviar = false;
  botao.disabled = false;
  botao.textContent = "Enviar pedido";
  // Erros do servidor: a mensagem (com as alternativas) aparece no ecrã, não escondida por cima.
  queueMicrotask(() => $("enviar-msg").scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" }));
  // Só os meios de contacto que aparecem por baixo da mensagem (mostrarEnvio).
  const fale = meiosContacto();
  if (estadoHttp === 401 || estadoHttp === 403) {
    // A sessão terminou (ou o email ainda não está confirmado): o bloco da conta mostra o que falta.
    await blocoConta.atualizar();
    mostrarEnvio(estadoHttp === 401 ? "A sua sessão terminou. Entre de novo na sua conta e carregue em \"Enviar pedido\". A simulação fica guardada." : "Confirme primeiro o seu email com o código que lhe enviámos, em \"A sua conta\".", "erro");
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

function concluido(preco, semFundo, resultadoFotos = null) {
  enviado = true;
  clearTimeout(temporizador);
  clearTimeout(temporizadorConta);   // o painel já apagou a simulação guardada na conta (foi enviada)
  apagarEstado(armazem ?? semArmazem);
  for (let i = 0; i < PASSOS.length; i++) $(`passo-${i}`).hidden = true;
  $("sim-navegacao").hidden = true;
  document.querySelector(".sim-progresso").hidden = true;
  $("passo-fim").hidden = false;
  $("fim-resumo").textContent = preco?.min != null
    ? `Estimativa enviada: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}. ${TEXTO_ESTIMATIVA.replace(/^Estimativa\. /, "")}${semFundo ? " (A planta foi sem a imagem de fundo.)" : ""}`
    : "Vamos enviar-lhe o preço depois de analisarmos a simulação.";
  if (codigoCliente) { $("fim-voltar").href = "cliente.html"; $("fim-voltar").textContent = "Voltar à área de cliente"; }
  // Fotos: o pedido já foi aceite; diz quantas não foram (o eletricista pode vê-las na visita).
  const ff = $("fim-fotos");
  const r = resultadoFotos;
  ff.hidden = !r;
  if (r) {
    ff.className = `msg ${r.falhas ? "erro" : "ok"}`;
    ff.textContent = r.semToken ? "Não foi possível enviar as fotos. O pedido foi recebido: pode mostrá-las ao eletricista na visita."
      : r.falhas ? `Não foi possível enviar ${r.falhas} de ${r.total} ${r.total === 1 ? "foto" : "fotos"}. O pedido foi recebido: pode mostrá-las ao eletricista na visita.`
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
function recomecar() {
  clearTimeout(temporizador);
  temporizador = null;   // nada pendente: sair ou recarregar não volta a gravar a simulação antiga
  apagarEstado(armazem ?? semArmazem);
  clearTimeout(temporizadorConta);
  if (contaEu) pedirConta("simulacao", { corpo: { estado: null } }).catch(() => {});   // também a da conta
  document.getElementById("sim-retomar-conta")?.remove();
  enviado = false;
  aEnviar = false;
  estado = estadoInicial();
  visitado = PASSO_INICIAL;
  ultimoPreco = null;
  pisoQuer = 0;
  pisoCasa = 0;
  voltarDivisoes = null;
  divisaoTocada = null;
  abertas.clear();
  fotos.clear();
  limparFotos(null);   // as fotos são da simulação: saem com ela
  $("fim-fotos").hidden = true;
  editor.limpar();
  mostrarEnvio(null);
  for (const c of document.querySelectorAll(".confirmar")) c.remove();
  $("contacto-website").value = "";
  $("sim-guardado").textContent = "";
  $("quer-maquinas").dataset.perfil = "";   // "Equipamentos" refeito do zero
  $("quer-objetivos").dataset.perfil = "";
}

$("fim-nova").addEventListener("click", () => {
  recomecar();
  $("passo-fim").hidden = true;
  $("sim-navegacao").hidden = false;
  document.querySelector(".sim-progresso").hidden = false;
  mostrarPasso();
});

// "Começar de novo" sempre à mão (por baixo dos passos), com confirmação na página.
$("sim-recomecar-topo").addEventListener("click", () => {
  const b = $("sim-recomecar-topo");
  if (b.parentElement.querySelector(".confirmar")) return;
  const c = el("div", "confirmar");
  c.setAttribute("role", "alert");
  c.append(el("p", null, "Isto apaga a simulação toda — a casa, o que quer, a planta, as divisões, as fotos, o quadro e o contacto — também deste navegador. Continuar?"));
  const bs = el("div", "botoes");
  const sim = el("button", "btn pequeno", "Sim, começar de novo");
  sim.type = "button";
  sim.id = "sim-recomecar-sim";
  const nao = el("button", "btn sec pequeno", "Cancelar");
  nao.type = "button";
  sim.addEventListener("click", () => { recomecar(); mostrarPasso(); });
  nao.addEventListener("click", () => { c.remove(); b.focus(); });
  bs.append(sim, nao);
  c.append(bs);
  b.parentElement.append(c);
  sim.focus();
});

// ------------------------------------------------------------ arranque
function iniciar() {
  $("ano").textContent = String(new Date().getFullYear());
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
  if (guardado && temProgresso(guardado, PASSO_INICIAL)) {
    const quando = guardado.guardado ? new Date(guardado.guardado) : null;
    const data = quando && !Number.isNaN(quando.getTime())
      ? quando.toLocaleString("pt-PT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
      : null;
    $("sim-retomar-texto").textContent = `Tem uma simulação guardada neste navegador${data ? ` (${data})` : ""}, no passo ${guardado.passo + 1}: ${PASSOS[guardado.passo]}.`;
    $("sim-retomar").hidden = false;
    document.querySelector(".sim-progresso").hidden = true;
    $("sim-form").hidden = true;
    $("sim-continuar").addEventListener("click", () => {
      estado = guardado;
      visitado = Math.max(estado.passo, estado.visitado ?? 0);
      if (estado.passo > P.planta) acertarPedido();   // estados antigos: o pedido segue as regras de agora (sem aparelhos dos objetivos)
      fecharRetomar();
      carregarFotosDoEstado();
    });
    $("sim-recomecar").addEventListener("click", () => {
      recomecar();
      fecharRetomar();
    });
    $("sim-continuar").focus();
  } else {
    mostrarPasso(false);
    limparFotos(null);   // sem simulação para continuar: fotos que tenham ficado no navegador já não são de nenhuma
  }
  carregarCatalogo();
  blocoConta.atualizar();   // sessão da conta: passo Enviar e simulação guardada na conta
}
function fecharRetomar() {
  $("sim-retomar").hidden = true;
  document.querySelector(".sim-progresso").hidden = false;
  $("sim-form").hidden = false;
  mostrarPasso();
}

// Exposto só para os testes automáticos (não é usado pela página).
window.__simulador = { get estado() { return estado; }, get editor() { return editor; }, normalizarEstado, entradaFoto, fotos };

iniciar();
