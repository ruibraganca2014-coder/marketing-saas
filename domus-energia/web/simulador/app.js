// Simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md): 7 passos, progresso guardado
// no navegador, preço a partir do catálogo público e envio para POST /api/orcamento.
// Todos os textos do cliente e do servidor entram só com textContent.

import {
  TIPOS_CASA, TIPOS_CIRCUITO, AMPERES, MODELOS, MAX_DIVISOES,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_QUER, OBJETIVOS,
  contarPlanta, divisoesDaContagem, divisaoVazia, sugerirCircuitos, circuitoVazio, numerar,
  avisosCircuito, avisosQuadro, plantaTemConteudo, nomeModelo, NOMES_DIVISAO, formatarW, FASES, disjuntoresInteligentes,
} from "./regras.js";
import { plantaDaCasa, assinaturaCasa, aplicarObjetivos, quartosDe, casasBanhoOmissao, salasOmissao } from "./casa.js";
import {
  pedidosDaSelecao, calcularPreco, planoSugerido, PLANOS, TEXTO_ESTIMATIVA, SKU_SY1, SKU_SY2,
  formatarEuro, formatarEuroRedondo, formatarHoras,
} from "./preco.js";
import {
  PASSOS, MAX_SIMULACAO, estadoNovo, normalizarEstado, temProgresso, guardarEstado, carregarEstado, apagarEstado,
  lerCodigoCliente, montarSimulacao, montarPedido, problemaContacto, tamanhoSimulacao, opcoesAvisos, potenciaContratada,
} from "./estado.js";
import { criarEditor } from "./editor.js";

const cfg = window.DOMUS ?? {};
const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const urlApi = String(cfg.apiUrl ?? "/api").replace(/\/+$/, "");
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
// Índices dos passos (PASSOS em estado.js).
const P = { casa: 0, quer: 1, planta: 2, quadro: 3, divisoes: 4, preco: 5, enviar: 6 };
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
  if (enviado) return;
  const r = guardarEstado(armazem ?? semArmazem, estado);
  $("sim-guardado").textContent = r === "ok" ? "Guardado neste navegador"
    : r === "sem_imagem" ? "Guardado (sem a imagem de fundo, que não coube no navegador)"
      : "Não foi possível guardar neste navegador";
}
addEventListener("pagehide", () => { if (temporizador) gravar(); });

// ------------------------------------------------------------ passos
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
    if (i <= visitado && !atual && !aEnviar) {
      const b = el("button", "sim-passo-botao");
      b.type = "button";
      b.append(num, el("span", "sim-passo-nome", nome));
      b.setAttribute("aria-label", `Passo ${i + 1}: ${nome}${i < estado.passo ? " (feito)" : ""}`);
      b.addEventListener("click", () => irPara(i));
      li.append(b);
    } else {
      const s = el("span", "sim-passo-botao");
      s.append(num, el("span", "sim-passo-nome", nome));
      if (atual) s.setAttribute("aria-label", `Passo ${i + 1} de ${PASSOS.length}: ${nome} (atual)`);
      li.append(s);
    }
    ol.append(li);
  });
  $("sim-barra-cheia").style.width = `${((estado.passo + 1) / PASSOS.length) * 100}%`;
}

function irPara(i, { foco = true } = {}) {
  const de = estado.passo;
  // Ao passar da planta para a frente (também a saltar da casa ou de "O que quer" pela barra):
  // pré-preenche o quadro e as divisões (só o que o cliente ainda não mudou à mão).
  if (i > P.planta && de <= P.planta) prepararPassosSeguintes();
  estado.passo = Math.max(0, Math.min(PASSOS.length - 1, i));
  visitado = Math.max(visitado, estado.passo);
  mostrarPasso(foco);
  agendarGravacao();
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
    editor.abrir(estado.planta, { reiniciarVista: true });
    desenharContagem();
    desenharPlantaOrigem();
    textoSeguinte();
  }
  if (p === P.quadro) desenharQuadro();
  if (p === P.divisoes) desenharDivisoes();
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
  $("sim-seguinte").textContent = p === PASSOS.length - 1 ? "Enviar pedido" : p === P.planta && !plantaTemConteudo(estado.planta) ? "Saltar a planta" : "Seguinte";
}

$("sim-form").addEventListener("submit", (ev) => ev.preventDefault());
$("sim-anterior").addEventListener("click", () => irPara(estado.passo - 1));
$("sim-seguinte").addEventListener("click", () => {
  if (estado.passo === PASSOS.length - 1) { enviar(); return; }
  // "Seguinte" com a planta desenhada usa-a (mesmo que antes a tenha saltado); vazia = saltar.
  if (estado.passo === P.planta) estado.plantaSaltada = !plantaTemConteudo(estado.planta);
  irPara(estado.passo + 1);
});

// ------------------------------------------------------------ 1. A casa
/** Botão de escolha (rádio ou sim/não) no estilo .escolha, com texto de ajuda opcional. */
function escolha(tipo, nome, valor, texto, ajuda, aoMudar) {
  const l = el("label", "escolha");
  const i = document.createElement("input");
  i.type = tipo;
  i.name = nome;
  i.value = valor;
  i.addEventListener("change", () => aoMudar(i.checked));
  const s = el("span", null, texto);
  if (ajuda) s.append(el("small", null, ajuda));
  l.append(i, s);
  return l;
}

// Contadores − n +: [chave em estado.casa, rótulo, ajuda, "Menos …", "Mais …"].
const CONTADORES = [
  ["quartos", "Quartos", "T5 ou mais: quantos quartos?", "Menos um quarto", "Mais um quarto"],
  ["casas_banho", "Casas de banho", null, "Menos uma casa de banho", "Mais uma casa de banho"],
  ["salas", "Salas", "2 = sala de estar e sala de jantar", "Menos uma sala", "Mais uma sala"],
  ["pisos", "Pisos", "Rés-do-chão = 1; com andares: 2 ou 3", "Menos um piso", "Mais um piso"],
];
const EXTRAS_AJUDA = { kitnet: "A cozinha fica na sala" };

// Escolher a tipologia repõe sempre os valores típicos; os contadores que mudaram ficam destacados.
function mudarTipologia(t) {
  const c = estado.casa;
  const antes = { quartos: c.quartos, casas_banho: c.casas_banho, salas: c.salas };
  c.tipologia = t;
  c.quartos = t === "T5+" ? Math.min(12, Math.max(5, c.quartos ?? 5)) : quartosDe({ tipologia: t });
  c.casas_banho = casasBanhoOmissao(t);
  c.salas = salasOmissao(t);
  sincronizarCasa();
  for (const k of Object.keys(antes)) if (antes[k] !== c[k]) destacar($(`contador-${k}`));
  agendarGravacao();
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
    for (const [k, nome] of Object.entries(TIPOS_CASA)) {
      g.append(escolha("radio", "casa-tipo", k, nome, null, () => {
        estado.casa.tipo = k;
        if (k !== "moradia") estado.casa.pisos = 1;
        sincronizarCasa();
        agendarGravacao();
      }));
    }
    for (const t of TIPOLOGIAS) $("casa-tipologias").append(escolha("radio", "casa-tipologia", t, t, null, (sim) => { if (sim) mudarTipologia(t); }));
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
          const atual = estado.casa[k] ?? min;
          estado.casa[k] = Math.min(max, Math.max(min, atual + d));
          sincronizarCasa();
          agendarGravacao();
        });
        return b;
      };
      grupo.append(botaoC("−", menos, -1), valor, botaoC("+", mais, 1));
      caixa.append(rot);
      if (ajuda) caixa.append(el("small", "ajuda", ajuda));
      caixa.append(grupo);
      $("casa-contadores").append(caixa);
    }
    for (const [k, texto] of Object.entries(EXTRAS_CASA)) {
      $("casa-extras").append(escolha("checkbox", `casa-extra-${k}`, k, texto, EXTRAS_AJUDA[k], (sim) => { estado.casa.extras[k] = sim; agendarGravacao(); }));
    }
  }
  for (const i of g.querySelectorAll("input")) i.checked = i.value === estado.casa.tipo;
  sincronizarCasa();
  $("casa-localidade").value = estado.casa.localidade;
  $("casa-potencia").value = estado.casa.potencia_contratada_kva === null ? "" : String(estado.casa.potencia_contratada_kva);
  $("casa-fases").value = estado.casa.fases ?? "";
}

/** Tipologia, contadores e extras no ecrã a partir do estado. */
function sincronizarCasa() {
  const c = estado.casa;
  for (const i of $("casa-tipologias").querySelectorAll("input")) i.checked = i.value === c.tipologia;
  for (const [k] of CONTADORES) {
    const [min, max] = LIMITES_CASA[k];
    const v = c[k] ?? min;
    $(`contador-${k}-valor`).textContent = String(v);
    $(`contador-${k}-menos`).disabled = v <= min;
    $(`contador-${k}-mais`).disabled = v >= max;
  }
  // Quartos só no T5+ (nos outros vem da tipologia); no T0 (estúdio) não há salas à parte.
  $("contador-quartos").hidden = c.tipologia !== "T5+";
  $("contador-salas").hidden = c.tipologia === "T0";
  // Só as moradias têm mais de um piso.
  $("contador-pisos").hidden = c.tipo !== "moradia";
  for (const i of $("casa-extras").querySelectorAll("input")) i.checked = !!c.extras[i.value];
}
$("casa-potencia").addEventListener("change", () => { estado.casa.potencia_contratada_kva = potenciaContratada($("casa-potencia").value); agendarGravacao(); });
$("casa-fases").addEventListener("change", () => { const v = $("casa-fases").value; estado.casa.fases = FASES[v] ? v : null; agendarGravacao(); });
$("casa-localidade").addEventListener("input", () => { estado.casa.localidade = $("casa-localidade").value.slice(0, 80); agendarGravacao(); });

// ------------------------------------------------------------ 2. O que quer
const OBJETIVOS_AJUDA = {
  poupar: "Ver o consumo de cada circuito",
  alarme: "Sensores de porta e de movimento",
  estores: "Abrir e fechar pelo telemóvel ou a horas",
  luzes: "Interruptores inteligentes",
  distancia: "Ver e ligar a casa quando não está",
  clima: "Termóstato Wi-Fi",
};
const quer = (k) => estado.quer.objetivos.includes(k);

function desenharQuer() {
  const gm = $("quer-maquinas"), go = $("quer-objetivos");
  if (!gm.childElementCount) {
    const alternar = (lista, chaves, k) => (sim) => {
      const s = new Set(estado.quer[lista]);
      if (sim) s.add(k); else s.delete(k);
      estado.quer[lista] = chaves.filter((x) => s.has(x));   // sempre pela ordem da lista
      agendarGravacao();
    };
    for (const k of MAQUINAS_QUER) gm.append(escolha("checkbox", `quer-maquina-${k}`, k, MODELOS[k].nome, `cerca de ${formatarW(MODELOS[k].w)}`, alternar("maquinas", MAQUINAS_QUER, k)));
    for (const [k, texto] of Object.entries(OBJETIVOS)) go.append(escolha("checkbox", `quer-objetivo-${k}`, k, texto, OBJETIVOS_AJUDA[k], alternar("objetivos", Object.keys(OBJETIVOS), k)));
  }
  for (const i of gm.querySelectorAll("input")) i.checked = estado.quer.maquinas.includes(i.value);
  for (const i of go.querySelectorAll("input")) i.checked = estado.quer.objetivos.includes(i.value);
}

// ------------------------------------------------------------ 3. Planta (pré-desenhada e contagem)
/**
 * Planta já desenhada a partir da casa e das máquinas (casa.js): quando está vazia, ou quando ainda é
 * a que desenhámos (o cliente não lhe mexeu) e a casa ou as máquinas mudaram. Nunca toca numa planta
 * em que o cliente mexeu. Sem tipologia (área de cliente com o passo 1 saltado) não desenha nada.
 */
function preencherPlanta() {
  if (!estado.casa.tipologia) return false;
  const assinatura = assinaturaCasa(estado.casa, estado.quer.maquinas);
  if (plantaTemConteudo(estado.planta) && !(estado.plantaAuto && estado.plantaBase !== assinatura)) return false;
  estado.planta = plantaDaCasa(estado.casa, estado.quer.maquinas);
  estado.plantaAuto = true;
  estado.plantaBase = assinatura;
  return true;
}

/** A casa ou as máquinas mudaram depois de o cliente mexer na planta que desenhámos? */
const plantaDesatualizada = () => !estado.plantaAuto && !!estado.plantaBase && !!estado.casa.tipologia
  && plantaTemConteudo(estado.planta) && estado.plantaBase !== assinaturaCasa(estado.casa, estado.quer.maquinas);

function desenharPlantaOrigem() {
  const o = $("planta-origem");
  const mudou = plantaDesatualizada();
  o.hidden = !(estado.plantaAuto || mudou);
  o.textContent = mudou
    ? "Mudou a casa ou as máquinas depois de mexer na planta: mantivemos a sua planta. Se quiser, desenhamo-la de novo a partir do passo 1 (perde o que mudou nela)."
    : "Já desenhámos as divisões (com tamanhos típicos), cada uma com os aparelhos habituais (porta, interruptor, luz, sensor de movimento, janelas e tomadas), e as máquinas que escolheu. Arraste, ajuste e tire ou acrescente o que for preciso — ou salte este passo.";
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
 * (divisões pela tipologia e extras, máquinas escolhidas em "O que quer") sem a gravar.
 */
const contagemAtual = () => contarPlanta(usaPlanta() ? estado.planta : plantaDaCasa(estado.casa, estado.quer.maquinas));

/**
 * Circuitos sugeridos (§4) a partir da contagem. Toda a casa tem luzes e tomadas: se não há nenhuma
 * desenhada ficam os circuitos base "Iluminação" e "Tomadas"; as máquinas têm circuito próprio.
 */
function circuitosSugeridos(cont) {
  const c = sugerirCircuitos(cont, { fases: estado.casa.fases });
  const de = (tipo, nome) => { const l = c.filter((x) => x.tipo === tipo); return l.length ? l : [{ ...circuitoVazio(0, tipo), nome }]; };
  const r = numerar([...de("iluminacao", "Iluminação"), ...de("tomadas", "Tomadas"), ...c.filter((x) => x.tipo === "maquina")]);
  // "Poupar energia": medir o consumo em todos os circuitos inteligentes (já é o que sugerimos por omissão).
  if (quer("poupar")) for (const x of r) if (x.inteligente) x.medir = true;
  return r;
}

/** Linhas do passo "Divisões" (a partir da contagem) com os aparelhos dos objetivos (casa.js). */
function divisoesSugeridas(cont) {
  const planta = usaPlanta();
  const d = divisoesDaContagem(cont);
  if (!planta) for (const x of d) x.planta_id = null;
  return aplicarObjetivos(d, estado.quer.objetivos, planta ? cont : null);
}

/** Pré-preenche a planta (se ainda é a nossa), o quadro, as divisões e os termóstatos (só o que o cliente não mudou). */
function prepararPassosSeguintes() {
  preencherPlanta();
  const cont = contagemAtual();
  if (!estado.quadroEditado) estado.quadro.circuitos = circuitosSugeridos(cont);
  if (!estado.divisoesEditadas) estado.divisoes = divisoesSugeridas(cont);
  // "Aquecimento / ar condicionado": um termóstato por piso.
  if (!estado.termostatosEditados) estado.extras.termostatos = quer("clima") ? Math.max(1, estado.casa.pisos ?? 1) : 0;
}

// ------------------------------------------------------------ 4. Quadro
function selectCom(opcoes, valor, id) {
  const s = document.createElement("select");
  if (id) s.id = id;
  for (const [v, t] of opcoes) { const o = document.createElement("option"); o.value = String(v); o.textContent = t; s.append(o); }
  s.value = String(valor);
  return s;
}
function inputNum(valor, id, { min = 0, max = 99, step = 1 } = {}) {
  const i = document.createElement("input");
  i.type = "number";
  i.inputMode = "numeric";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(valor);
  i.id = id;
  return i;
}
const lerNum = (i, min, max) => Math.min(max, Math.max(min, Math.round(Number(i.value) || 0)));
function rotulo(texto, controlo, cls = "campo") {
  const l = el("label", cls);
  l.append(el("span", null, texto), controlo);
  return l;
}
function caixa(texto, marcado, id) {
  const l = el("label", "caixa-linha");
  const i = document.createElement("input");
  i.type = "checkbox";
  i.checked = marcado;
  i.id = id;
  l.append(i, el("span", null, texto));
  return [l, i];
}

function nomesDivisoes() {
  const s = new Set();
  for (const d of estado.divisoes) if (d.nome) s.add(d.nome);
  if (!estado.plantaSaltada) for (const d of estado.planta.divisoes) if (d.nome) s.add(d.nome);
  for (const c of estado.quadro.circuitos) for (const n of c.divisoes) s.add(n);
  return [...s];
}

function quadroMudou() {
  estado.quadroEditado = true;
  agendarGravacao();
}

function desenharQuadro() {
  const temPlanta = !estado.plantaSaltada && estado.planta.elementos.length > 0;
  // Sem planta, a sugestão vem da casa e das máquinas escolhidas (o botão também serve para voltar a ela).
  const daCasa = !temPlanta && (!!estado.casa.tipologia || estado.quer.maquinas.length > 0);
  const botao = $("quadro-recalcular");
  botao.textContent = temPlanta ? "Recalcular a partir da planta" : "Recalcular a partir da casa";
  botao.hidden = !temPlanta && !daCasa;
  const origem = $("quadro-origem");
  origem.hidden = !temPlanta && !daCasa;
  origem.textContent = estado.quadroEditado ? `Alterou o quadro à mão: não o mudamos sozinhos. Use "${botao.textContent}" para voltar à sugestão.` : `Sugestão feita a partir da sua ${temPlanta ? "planta" : "casa e das máquinas que escolheu"} (luzes até 8 por circuito de 10 A, tomadas até 8 por circuito de 16 A, circuito próprio para as máquinas de lavar e secar, forno, placa, termoacumulador, ar condicionado, bomba de calor, bomba da piscina/rega e carregador do carro). Pode mudar tudo.`;
  for (const r of document.querySelectorAll("input[name=disjuntor]")) r.checked = r.value === estado.quadro.disjuntor;
  const caixaC = $("circuitos");
  caixaC.replaceChildren();
  if (!estado.quadro.circuitos.length) caixaC.append(el("p", "ajuda", "Sem circuitos. Use \"Adicionar circuito\"."));
  estado.quadro.circuitos.forEach((c, i) => caixaC.append(cartaoCircuito(c, i)));
  desenharAvisosQuadro();
}

function cartaoCircuito(c, i) {
  const id = `c${i}`;
  const f = el("fieldset", "cartao circuito");
  f.dataset.circuito = String(i);
  const leg = el("legend", null, `Circuito ${c.n}${c.nome ? ` — ${c.nome}` : ""}`);
  f.append(leg);
  const nome = document.createElement("input");
  nome.id = `${id}-nome`;
  nome.maxLength = 60;
  nome.value = c.nome;
  nome.addEventListener("input", () => { c.nome = nome.value.slice(0, 60); leg.textContent = `Circuito ${c.n}${c.nome ? ` — ${c.nome}` : ""}`; quadroMudou(); desenharAvisosQuadro(); });
  const tipo = selectCom(Object.entries(TIPOS_CIRCUITO), c.tipo, `${id}-tipo`);
  tipo.addEventListener("change", () => { c.tipo = tipo.value; quadroMudou(); desenharAvisosQuadro(); });
  const amp = selectCom(AMPERES.map((a) => [a, `${a} A`]), c.amperes, `${id}-amperes`);
  amp.addEventListener("change", () => { c.amperes = Number(amp.value); quadroMudou(); desenharAvisosQuadro(); });
  const linha1 = el("div", "tres");
  linha1.append(rotulo("Nome", nome), rotulo("Tipo", tipo), rotulo("Disjuntor", amp));

  const luzes = inputNum(c.itens.luzes, `${id}-luzes`);
  const tomadas = inputNum(c.itens.tomadas, `${id}-tomadas`);
  luzes.addEventListener("input", () => { c.itens.luzes = lerNum(luzes, 0, 99); quadroMudou(); desenharAvisosQuadro(); });
  tomadas.addEventListener("input", () => { c.itens.tomadas = lerNum(tomadas, 0, 99); quadroMudou(); desenharAvisosQuadro(); });
  const linha2 = el("div", "duas");
  linha2.append(rotulo("Pontos de luz", luzes), rotulo("Tomadas", tomadas));

  // Divisões que o circuito serve
  const divs = el("fieldset", "chips");
  divs.append(el("legend", null, "Divisões"));
  const nomes = nomesDivisoes();
  if (!nomes.length) divs.append(el("p", "ajuda", "Ainda não há divisões (passo 5)."));
  nomes.forEach((n, j) => {
    const [l, cb] = caixa(n, c.divisoes.includes(n), `${id}-div-${j}`);
    l.className = "chip";
    cb.addEventListener("change", () => {
      c.divisoes = cb.checked ? [...c.divisoes.filter((x) => x !== n), n] : c.divisoes.filter((x) => x !== n);
      quadroMudou();
    });
    divs.append(l);
  });

  // Máquinas
  const maq = el("fieldset", "maquinas");
  maq.append(el("legend", null, "Máquinas neste circuito"));
  const lista = el("div", "maquinas-lista");
  c.itens.maquinas.forEach((m, j) => {
    const linha = el("div", "maquina-linha");
    const s = selectCom(Object.entries(MODELOS).map(([k, v]) => [k, v.nome]), m.modelo, `${id}-maq-${j}-modelo`);
    const w = inputNum(m.potencia_w, `${id}-maq-${j}-w`, { min: 0, max: 100000, step: 50 });
    s.addEventListener("change", () => { m.modelo = s.value; m.potencia_w = MODELOS[s.value].w; w.value = String(m.potencia_w); quadroMudou(); desenharAvisosQuadro(); });
    w.addEventListener("input", () => { m.potencia_w = lerNum(w, 0, 100000); quadroMudou(); desenharAvisosQuadro(); });
    const rem = el("button", "btn sec pequeno", "Remover");
    rem.type = "button";
    rem.setAttribute("aria-label", `Remover ${nomeModelo(m.modelo)} do circuito ${c.n}`);
    rem.addEventListener("click", () => {
      c.itens.maquinas.splice(j, 1);
      quadroMudou();
      desenharQuadro();
      $(`${id}-maq-adicionar`)?.focus();
    });
    linha.append(rotulo("Máquina", s), rotulo("Potência (W)", w), rem);
    lista.append(linha);
  });
  const addM = el("button", "btn sec pequeno", "Adicionar máquina");
  addM.type = "button";
  addM.id = `${id}-maq-adicionar`;
  addM.addEventListener("click", () => {
    c.itens.maquinas.push({ modelo: "termoacumulador", potencia_w: MODELOS.termoacumulador.w });
    quadroMudou();
    desenharQuadro();
    $(`${id}-maq-${c.itens.maquinas.length - 1}-modelo`)?.focus();
  });
  maq.append(lista, addM);

  const [lInt, cInt] = caixa("Tornar inteligente (ligar e desligar no telemóvel)", c.inteligente, `${id}-inteligente`);
  const [lMed, cMed] = caixa("Medir o consumo", c.medir, `${id}-medir`);
  cInt.addEventListener("change", () => { c.inteligente = cInt.checked; quadroMudou(); desenharAvisosQuadro(); });
  cMed.addEventListener("change", () => { c.medir = cMed.checked; quadroMudou(); desenharAvisosQuadro(); });
  const opcoes = el("div", "opcoes-circuito");
  opcoes.append(lInt, lMed);

  const avisos = el("ul", "avisos-circuito");
  avisos.id = `${id}-avisos`;
  const rem = el("button", "btn sec pequeno perigo-sec", "Remover circuito");
  rem.type = "button";
  rem.addEventListener("click", () => {
    estado.quadro.circuitos.splice(i, 1);
    numerar(estado.quadro.circuitos);
    quadroMudou();
    desenharQuadro();
    $("circuito-adicionar").focus();
  });
  const bs = el("div", "form-botoes");
  bs.append(rem);
  f.append(linha1, linha2, divs, maq, opcoes, avisos, bs);
  return f;
}

function desenharAvisosQuadro() {
  estado.quadro.circuitos.forEach((c, i) => {
    const ul = $(`c${i}-avisos`);
    if (!ul) return;
    ul.replaceChildren();
    for (const a of avisosCircuito(c, opcoesAvisos(estado))) ul.append(el("li", null, a));
    ul.hidden = !ul.childElementCount;
  });
  const g = $("quadro-avisos");
  g.replaceChildren();
  const todos = avisosQuadro(estado.quadro.circuitos, opcoesAvisos(estado));
  const geral = todos.filter((a) => !a.startsWith("Circuito "));
  // Mesma contagem que o preço: os circuitos só com "medir" levam sempre o SY1.
  const d = disjuntoresInteligentes(estado.quadro.circuitos, estado.quadro.disjuntor);
  const SY2 = "disjuntor TONGOU-SY2-JWT (com proteções)";
  const SY1 = "disjuntor TONGOU-SY1-JWT (só medição)";
  const modelos = d.sy2 && d.sy1 ? `: ${d.sy2} com ${SY2} e ${d.sy1} com ${SY1}`
    : d.total ? `: ${d.sy2 ? SY2 : SY1} em cada um` : "";
  const p = el("p", "ajuda");
  p.textContent = `${d.total} ${d.total === 1 ? "circuito inteligente" : "circuitos inteligentes"}${modelos}.`;
  g.append(p);
  if (geral.length) {
    const ul = el("ul", "avisos-circuito");
    for (const a of geral) ul.append(el("li", null, a));
    g.append(ul);
  }
}

for (const r of document.querySelectorAll("input[name=disjuntor]")) {
  r.addEventListener("change", () => { if (r.checked) { estado.quadro.disjuntor = r.value === SKU_SY1 ? SKU_SY1 : SKU_SY2; agendarGravacao(); desenharAvisosQuadro(); } });
}
$("circuito-adicionar").addEventListener("click", () => {
  estado.quadro.circuitos.push(circuitoVazio(estado.quadro.circuitos.length + 1));
  quadroMudou();
  desenharQuadro();
  $(`c${estado.quadro.circuitos.length - 1}-nome`)?.focus();
});

// "Recalcular a partir da planta": se o cliente já mexeu, pede confirmação na página (sem diálogos nativos).
function ligarRecalcular(botaoId, editado, recalcular, desenhar, { pergunta = "Isto substitui o que escreveu à mão pela sugestão. Continuar?", sim: textoSim = "Sim, recalcular" } = {}) {
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
ligarRecalcular("quadro-recalcular", () => estado.quadroEditado, () => {
  estado.quadro.circuitos = circuitosSugeridos(contagemAtual());
  estado.quadroEditado = false;
}, desenharQuadro);
ligarRecalcular("divisoes-recalcular", () => estado.divisoesEditadas, () => {
  estado.divisoes = divisoesSugeridas(contagemAtual());
  estado.divisoesEditadas = false;
}, desenharDivisoes);
// Planta em que o cliente mexeu e a casa mudou depois: só a refazemos se ele pedir (e confirmar).
ligarRecalcular("planta-refazer", () => true, () => {
  estado.planta = plantaDaCasa(estado.casa, estado.quer.maquinas);
  estado.plantaAuto = true;
  estado.plantaBase = assinaturaCasa(estado.casa, estado.quer.maquinas);
  estado.plantaSaltada = false;
}, () => {
  editor.abrir(estado.planta, { reiniciarVista: true });
  desenharContagem();
  desenharPlantaOrigem();
  textoSeguinte();
}, { pergunta: "Isto apaga a planta atual (e o que desenhou nela) e desenha-a de novo a partir do passo 1. Continuar?", sim: "Sim, refazer" });

// ------------------------------------------------------------ 5. Divisões
function divisoesMudou() {
  estado.divisoesEditadas = true;
  agendarGravacao();
}

function desenharDivisoes() {
  const temPlanta = usaPlanta();
  const daCasa = !temPlanta && (!!estado.casa.tipologia || estado.quer.objetivos.length > 0);
  const botao = $("divisoes-recalcular");
  botao.textContent = temPlanta ? "Recalcular a partir da planta" : "Recalcular a partir da casa";
  botao.hidden = !temPlanta && !daCasa;
  const origem = $("divisoes-origem");
  origem.hidden = !temPlanta && !daCasa;
  const efeitos = [quer("alarme") && "sensores do alarme", quer("estores") && "estores", quer("luzes") && "interruptores"].filter(Boolean);
  const objetivos = efeitos.length ? ` e do que quer fazer (${efeitos.join(", ")})` : "";
  origem.textContent = estado.divisoesEditadas ? "Alterou as divisões à mão: não as mudamos sozinhos."
    : temPlanta ? `Preenchido a partir da sua planta (uma porta da rua conta como um sensor de porta sugerido)${objetivos}. Pode mudar tudo.`
      : `Preenchido a partir da sua casa${objetivos}. Pode mudar tudo.`;
  const c = $("divisoes");
  c.replaceChildren();
  if (!estado.divisoes.length) c.append(el("p", "ajuda", "Sem divisões. Use \"Adicionar divisão\"."));
  estado.divisoes.forEach((d, i) => c.append(cartaoDivisao(d, i)));
  $("extra-central").checked = estado.extras.central;
  $("extra-termostatos").value = String(estado.extras.termostatos);
}

function cartaoDivisao(d, i) {
  const id = `d${i}`;
  const f = el("fieldset", "cartao divisao-cartao");
  const leg = el("legend", null, d.nome || `Divisão ${i + 1}`);
  f.append(leg);
  const nome = document.createElement("input");
  nome.id = `${id}-nome`;
  nome.maxLength = 60;
  nome.value = d.nome;
  nome.setAttribute("list", "sim-nomes-divisao");
  nome.addEventListener("input", () => { d.nome = nome.value.slice(0, 60); leg.textContent = d.nome || `Divisão ${i + 1}`; divisoesMudou(); });
  f.append(rotulo("Nome", nome));

  // Interruptores (um por linha, 1–4 botões)
  const ints = el("fieldset", "interruptores");
  ints.append(el("legend", null, "Interruptores inteligentes"));
  d.interruptores.forEach((b, j) => {
    const linha = el("div", "maquina-linha");
    const s = selectCom([1, 2, 3, 4].map((n) => [n, `${n} ${n === 1 ? "botão" : "botões"}`]), b, `${id}-int-${j}`);
    s.addEventListener("change", () => { d.interruptores[j] = Number(s.value); divisoesMudou(); });
    const rem = el("button", "btn sec pequeno", "Remover");
    rem.type = "button";
    rem.setAttribute("aria-label", `Remover interruptor ${j + 1} da divisão ${d.nome || i + 1}`);
    rem.addEventListener("click", () => { d.interruptores.splice(j, 1); divisoesMudou(); desenharDivisoes(); $(`${id}-int-adicionar`)?.focus(); });
    linha.append(rotulo(`Interruptor ${j + 1}`, s), rem);
    ints.append(linha);
  });
  const addI = el("button", "btn sec pequeno", "Adicionar interruptor");
  addI.type = "button";
  addI.id = `${id}-int-adicionar`;
  addI.addEventListener("click", () => {
    if (d.interruptores.length >= 30) return;
    d.interruptores.push(1);
    divisoesMudou();
    desenharDivisoes();
    $(`${id}-int-${d.interruptores.length - 1}`)?.focus();
  });
  ints.append(addI);
  f.append(ints);

  const grelha = el("div", "tres");
  const campos = [
    ["estores", "Estores motorizados a automatizar"],
    ["estores_sem_motor", "Estores sem motor"],
    ["sensores_porta", "Sensores de porta/janela"],
    ["sensores_movimento", "Sensores de movimento"],
    ["luzes_regulaveis", "Luzes com brilho regulável"],
    ["tomadas_inteligentes", "Tomadas inteligentes (com medição)"],
  ];
  for (const [k, t] of campos) {
    const i2 = inputNum(d[k], `${id}-${k}`);
    i2.addEventListener("input", () => { d[k] = lerNum(i2, 0, 99); divisoesMudou(); nota.hidden = !d.estores_sem_motor; });
    grelha.append(rotulo(t, i2));
  }
  f.append(grelha);
  const nota = el("p", "ajuda", "Estores sem motor precisam primeiro de um motor: vemos isso na visita.");
  nota.hidden = !d.estores_sem_motor;
  f.append(nota);
  const rem = el("button", "btn sec pequeno perigo-sec", "Remover divisão");
  rem.type = "button";
  rem.addEventListener("click", () => { estado.divisoes.splice(i, 1); divisoesMudou(); desenharDivisoes(); $("divisao-adicionar").focus(); });
  const bs = el("div", "form-botoes");
  bs.append(rem);
  f.append(bs);
  return f;
}
{
  const dl = document.createElement("datalist");
  dl.id = "sim-nomes-divisao";
  for (const n of NOMES_DIVISAO) { const o = document.createElement("option"); o.value = n; dl.append(o); }
  document.body.append(dl);
}
$("divisao-adicionar").addEventListener("click", () => {
  if (estado.divisoes.length > MAX_DIVISOES) return;
  estado.divisoes.push(divisaoVazia(""));
  divisoesMudou();
  desenharDivisoes();
  $(`d${estado.divisoes.length - 1}-nome`)?.focus();
});
$("extra-central").addEventListener("change", () => { estado.extras.central = $("extra-central").checked; agendarGravacao(); });
$("extra-termostatos").addEventListener("input", () => { estado.extras.termostatos = lerNum($("extra-termostatos"), 0, 20); estado.termostatosEditados = true; agendarGravacao(); });

// ------------------------------------------------------------ 6. Preço
async function carregarCatalogo() {
  catalogo = undefined;
  try {
    const r = await fetch(`${urlApi}/catalogo`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
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
}

function calcular() {
  const pedidos = pedidosDaSelecao(estado);
  const preco = calcularPreco(pedidos, catalogo ?? null, configOrc);
  return { pedidos, preco, plano: planoSugerido(pedidos, { distancia: quer("distancia") }) };
}

// Abaixo de 480 px a coluna do preço unitário esconde-se (simulador.css): as linhas que ocupam
// várias colunas (rodapé, "Nenhum artigo") têm de acompanhar, senão aparece uma coluna fantasma.
const estreito = matchMedia("(max-width: 479px)");
const colunasPreco = () => (estreito.matches ? 3 : 4);
estreito.addEventListener?.("change", () => { if (estado.passo === P.preco && !$(`passo-${P.preco}`).hidden) desenharPreco(); });

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
  if (k.tipologia) {
    const partes = [k.tipologia === "T5+" ? `T${quartosDe(k)}` : k.tipologia, `${k.casas_banho} ${k.casas_banho === 1 ? "casa de banho" : "casas de banho"}`];
    if (k.tipologia !== "T0") partes.push(`${k.salas} ${k.salas === 1 ? "sala" : "salas"}`);
    partes.push(`${k.pisos} ${k.pisos === 1 ? "piso" : "pisos"}`);
    const extras = Object.entries(EXTRAS_CASA).filter(([x]) => k.extras[x]).map(([, t]) => t.toLowerCase());
    linha("Tipologia", [...partes, ...extras].join(" · "));
  } else {
    linha("Divisões", k.divisoes ? String(k.divisoes) : "Não indicado");
  }
  linha("Localidade", k.localidade.trim() || "Não indicada");
  linha("Potência contratada", k.potencia_contratada_kva === null ? "Não sei" : `${String(k.potencia_contratada_kva).replace(".", ",")} kVA`);
  linha("Ligação", FASES[k.fases] ?? "Não sei");
  c.append(topo, dl);
}

function desenharPreco() {
  desenharCasaResumo();
  const est = $("preco-estado");
  const { pedidos, preco, plano } = calcular();
  ultimoPreco = { preco, plano };
  est.hidden = true;
  if (catalogo === undefined) { est.textContent = "A obter os preços…"; est.hidden = false; }
  else if (catalogo === null) { est.textContent = "Não conseguimos obter os preços agora. Mostramos a lista do que escolheu — vamos enviar-lhe o preço depois de receber o pedido."; est.hidden = false; }

  const total = $("preco-total");
  total.replaceChildren();
  if (!pedidos.length) {
    total.append(el("p", "sim-intervalo", "Ainda não escolheu nada para instalar."), el("p", "ajuda", "Volte aos passos do quadro e das divisões, ou envie o pedido na mesma: falamos consigo na visita."));
  } else if (preco.min !== null) {
    total.append(el("p", "sim-rotulo", "Estimativa com instalação"));
    total.append(el("p", "sim-intervalo num", `${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`));
    if (!preco.completo) total.append(el("p", "ajuda", "Alguns artigos ainda não têm preço no catálogo: confirmamos na visita."));
  } else {
    total.append(el("p", "sim-intervalo", "Vamos enviar-lhe o preço"));
  }
  total.append(el("p", "sim-nota forte", TEXTO_ESTIMATIVA));

  const tb = $("preco-linhas");
  tb.replaceChildren();
  for (const l of preco.linhas) {
    const tr = el("tr");
    const th = el("th");
    th.scope = "row";
    th.append(el("span", null, l.nome), el("small", "sku", l.sku));
    tr.append(th, el("td", "n num", String(l.qtd)), el("td", "n num", l.preco_iva === null ? "—" : formatarEuro(l.preco_iva)), el("td", "n num", l.total === null ? "—" : formatarEuro(l.total)));
    tb.append(tr);
  }
  if (!preco.linhas.length) {
    const tr = el("tr");
    const td = el("td", null, "Nenhum artigo.");
    td.colSpan = colunasPreco();
    tr.append(td);
    tb.append(tr);
  }
  const tf = $("preco-rodape");
  tf.replaceChildren();
  const linhaRodape = (texto, valor, cls = "") => {
    const tr = el("tr", cls);
    const th = el("th", null, texto);
    th.scope = "row";
    th.colSpan = colunasPreco() - 1;
    tr.append(th, el("td", "n num", valor));
    tf.append(tr);
  };
  if (preco.horas !== null && preco.linhas.length) {
    linhaRodape(`Mão de obra (${formatarHoras(preco.horas)} × ${formatarEuro(preco.config.tarifa_hora_iva)}/h)`, formatarEuro(preco.mao_obra_iva));
    if (preco.deslocacao_iva > 0) linhaRodape("Deslocação", formatarEuro(preco.deslocacao_iva));
    linhaRodape("Total estimado", formatarEuro(preco.total), "total");
    linhaRodape(`Intervalo (± ${String(preco.config.margem_intervalo_pct).replace(".", ",")} %)`, `${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`);
  } else if (preco.linhas.length) {
    linhaRodape("Mão de obra", "a confirmar");
  }
  // O texto da estimativa já está no cartão do total: aqui só o IVA (não se repete).
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

  const av = $("preco-avisos");
  av.replaceChildren();
  const avisos = avisosQuadro(estado.quadro.circuitos, opcoesAvisos(estado));
  if (!avisos.length) av.append(el("p", "ajuda", "Sem avisos."));
  else {
    const ul = el("ul", "avisos-circuito");
    for (const a of avisos) ul.append(el("li", null, a));
    av.append(ul);
  }
}

// ------------------------------------------------------------ 7. Enviar
const CAMPOS = ["nome", "telefone", "email", "localidade", "mensagem"];
function desenharEnviar() {
  if (!estado.contacto.localidade && estado.casa.localidade) estado.contacto.localidade = estado.casa.localidade;
  for (const k of CAMPOS) $(`contacto-${k}`).value = estado.contacto[k];
  if (!ultimoPreco) desenharPreco();
}
for (const k of CAMPOS) {
  $(`contacto-${k}`).addEventListener("input", () => {
    estado.contacto[k] = $(`contacto-${k}`).value;
    $(`contacto-${k}`).removeAttribute("aria-invalid");
    $(`contacto-${k}`).removeAttribute("aria-describedby");
    agendarGravacao();
  });
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
    partes.push(`${estado.quadro.circuitos.length} circuitos, ${estado.divisoes.length} divisões.`);
    const texto2 = partes.join("\n").slice(0, 1500);
    if (numeroReal(cfg.whatsapp)) {
      const w = el("a", "btn sec pequeno", "Enviar pelo WhatsApp");
      w.id = "enviar-whatsapp";
      w.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto2)}`;
      w.target = "_blank";
      w.rel = "noopener";
      acoes.append(w);
    }
    if (typeof cfg.telefone === "string" && numeroReal(cfg.telefone)) {
      const t = el("a", "btn sec pequeno", `Ligar ${cfg.telefoneVisivel ?? cfg.telefone}`);
      t.href = `tel:${cfg.telefone}`;
      acoes.append(t);
    }
    if (typeof cfg.email === "string" && /^[^@\s]+@[^@\s]+$/.test(cfg.email)) {
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
  let sim = montarSimulacao(estado, preco, plano);
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
  try {
    const r = await fetch(`${urlApi}/orcamento`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
    });
    estadoHttp = r.status;
    try { erro = (await r.json())?.erro ?? null; } catch { erro = null; }
  } catch {
    estadoHttp = 0;
  }
  aEnviar = false;
  botao.disabled = false;
  botao.textContent = "Enviar pedido";
  if (estadoHttp >= 200 && estadoHttp < 300) { concluido(preco, semFundo); return; }
  // Erros do servidor: a mensagem (com as alternativas) aparece no ecrã, não escondida por cima.
  queueMicrotask(() => $("enviar-msg").scrollIntoView({ block: "center", behavior: reduzido() ? "auto" : "smooth" }));
  if (estadoHttp === 429) mostrarEnvio("Já recebemos vários pedidos seguidos deste aparelho. Tente de novo daqui a uma hora, ou fale connosco pelo WhatsApp ou telefone. A sua simulação fica guardada neste navegador.", "erro", true);
  else if (estadoHttp === 400) mostrarEnvio(`Há dados em falta ou inválidos${typeof erro === "string" ? `: ${erro.slice(0, 200)}` : "."} Verifique o formulário, ou fale connosco.`, "erro", true);
  else if (estadoHttp === 413) mostrarEnvio("A simulação é demasiado grande para enviar. Remova o fundo da planta e tente de novo, ou fale connosco.", "erro", true);
  else mostrarEnvio("Não foi possível enviar agora. A sua simulação fica guardada neste navegador: tente mais tarde, ou fale connosco pelo WhatsApp ou telefone.", "erro", true);
}

function concluido(preco, semFundo) {
  enviado = true;
  clearTimeout(temporizador);
  apagarEstado(armazem ?? semArmazem);
  for (let i = 0; i < PASSOS.length; i++) $(`passo-${i}`).hidden = true;
  $("sim-navegacao").hidden = true;
  document.querySelector(".sim-progresso").hidden = true;
  $("passo-fim").hidden = false;
  $("fim-resumo").textContent = preco?.min != null
    ? `Estimativa enviada: ${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}. ${TEXTO_ESTIMATIVA.replace(/^Estimativa\. /, "")}${semFundo ? " (A planta foi sem a imagem de fundo.)" : ""}`
    : "Vamos enviar-lhe o preço depois de analisarmos a simulação.";
  if (codigoCliente) { $("fim-voltar").href = "cliente.html"; $("fim-voltar").textContent = "Voltar à área de cliente"; }
  $("titulo-fim").focus();
}

$("fim-nova").addEventListener("click", () => {
  enviado = false;
  estado = estadoInicial();
  visitado = PASSO_INICIAL;
  ultimoPreco = null;
  $("passo-fim").hidden = true;
  $("sim-navegacao").hidden = false;
  document.querySelector(".sim-progresso").hidden = false;
  mostrarEnvio(null);
  mostrarPasso();
});

// ------------------------------------------------------------ arranque
function iniciar() {
  $("ano").textContent = String(new Date().getFullYear());
  if (modoCliente) {
    document.title = "Ampliar a instalação — Domus Energia";
    document.querySelector(".sim-cabecalho h1").textContent = "Ampliar a instalação";
    $("sim-intro").textContent = "Diga-nos o que quer acrescentar à sua casa. No fim vê uma estimativa com intervalo de preço — o valor final é confirmado na visita técnica gratuita.";
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
      visitado = estado.passo;
      fecharRetomar();
    });
    $("sim-recomecar").addEventListener("click", () => {
      apagarEstado(armazem ?? semArmazem);
      estado = estadoInicial();
      visitado = PASSO_INICIAL;
      fecharRetomar();
    });
    $("sim-continuar").focus();
  } else {
    mostrarPasso(false);
  }
  carregarCatalogo();
}
function fecharRetomar() {
  $("sim-retomar").hidden = true;
  document.querySelector(".sim-progresso").hidden = false;
  $("sim-form").hidden = false;
  mostrarPasso();
}

// Exposto só para os testes automáticos (não é usado pela página).
window.__simulador = { get estado() { return estado; }, get editor() { return editor; }, normalizarEstado };

iniciar();
