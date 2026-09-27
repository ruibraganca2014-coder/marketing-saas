// Simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md): 7 passos, progresso guardado
// no navegador, preço a partir do catálogo público e envio para POST /api/orcamento.
// Todos os textos do cliente e do servidor entram só com textContent.

import {
  TIPOS_CASA, TIPOS_CIRCUITO, AMPERES, MODELOS, MAX_DIVISOES,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_PEQUENAS, OBJETIVOS, tipologiaDeQuartos,
  contarPlanta, divisoesDaContagem, divisaoVazia, sugerirCircuitos, circuitoVazio, numerar,
  avisosCircuito, plantaTemConteudo, nomeModelo, NOMES_DIVISAO, formatarW, FASES, disjuntoresInteligentes,
  perfilCasa, maquinasGrandesDe, objetivosDe, tiposDivisaoPara,
  TIPOS_COM_PISOS,
  RTIEBT, codigoCircuito, seccaoCabo, formatarMm2,
} from "./regras.js";
import {
  plantaDaCasa, assinaturaCasa, aplicarObjetivos, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO,
} from "./casa.js";
import {
  pedidosDaSelecao, calcularPreco, planoSugerido, PLANOS, TEXTO_ESTIMATIVA, SKU_SY1, SKU_SY2,
  formatarEuro, formatarEuroRedondo, formatarHoras,
} from "./preco.js";
import {
  PASSOS, MAX_SIMULACAO, estadoNovo, normalizarEstado, temProgresso, guardarEstado, carregarEstado, apagarEstado,
  lerCodigoCliente, montarSimulacao, montarPedido, problemaContacto, tamanhoSimulacao, opcoesAvisos, potenciaContratada,
  normalizarQuer, maquinasEscolhidas, fasesSugeridas, telecomParaEnvio, avisosEstado,
} from "./estado.js";
import {
  PROTECOES, PACOTES, PARA_RAIOS, QUADRO_NOVO, opcoesCircuitos, protecoesDoPacote, pacoteDe, protecoesEfetivas,
  resumoQuadro, levaQuadroNovo, pedidosQuadro, formatarKva,
} from "./quadro.js";
import { criarEditor } from "./editor.js";
import { sugerirConcelhos, calcularDeslocacao } from "./deslocacao.js";

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
  // Ao passar da planta para a frente (também a saltar da casa ou de "O que quer" pela barra): planta
  // (se ainda é a nossa), divisões, quadro e termóstatos pré-preenchidos (só o que o cliente ainda não
  // mudou à mão).
  if (i > P.planta && de <= P.planta) prepararPassosSeguintes();
  estado.passo = Math.max(0, Math.min(PASSOS.length - 1, i));
  visitado = Math.max(visitado, estado.passo);
  estado.visitado = visitado;
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
    editor.definirTiposDivisao(tiposDivisaoPara(estado.casa.tipo));
    editor.abrir(estado.planta, { reiniciarVista: true });
    desenharContagem();
    desenharPlantaOrigem();
    textoSeguinte();
  }
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
/** A casa dá divisões (tipologia, ou serviços/industrial)? Sem isso (área de cliente) vale a lista antiga. */
const negocio = () => perfilCasa(estado.casa.tipo) !== "habitacao";

// Escolher a tipologia (botão T) repõe sempre os valores típicos: quartos, casas de banho e salas;
// os que mudaram ficam destacados.
function mudarTipologia(t) {
  const c = estado.casa;
  const antes = { quartos: c.quartos, casas_banho: c.casas_banho, salas: c.salas };
  c.tipologia = t;
  c.quartos = t === "T5+" ? Math.min(12, Math.max(5, c.quartos ?? 5)) : quartosDe({ tipologia: t });
  c.casas_banho = casasBanhoOmissao(t);
  c.salas = salasOmissao(t);
  c.extras.corredor = c.quartos >= 2;   // o corredor típico também segue a tipologia
  sincronizarCasa();
  for (const k of Object.keys(antes)) if (antes[k] !== c[k]) destacar($(`contador-${k}`));
  agendarGravacao();
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
          const novo = Math.min(max, Math.max(min, (estado.casa[k] ?? min) + d));
          if (k === "quartos") mudarQuartos(novo);
          else estado.casa[k] = novo;
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
  $("casa-area").value = estado.casa.area_m2 == null ? "" : String(estado.casa.area_m2);
  $("casa-potencia").value = estado.casa.potencia_contratada_kva === null ? "" : String(estado.casa.potencia_contratada_kva);
}

/** Tipologia (ou área e espaços), contadores, extras e ligação no ecrã a partir do estado. */
function sincronizarCasa() {
  const c = estado.casa;
  const neg = negocio();
  for (const i of $("casa-tipologias").querySelectorAll("input")) i.checked = i.value === c.tipologia;
  for (const [k] of CONTADORES) {
    const [min, max] = LIMITES_CASA[k];
    const v = estado.casa[k] ?? min;
    $(`contador-${k}-valor`).textContent = String(v);
    $(`contador-${k}-menos`).disabled = v <= min;
    $(`contador-${k}-mais`).disabled = v >= max;
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
  for (const i of $("casa-extras").querySelectorAll("input")) i.checked = !!c.extras[i.value];
  $("casa-fases").value = c.fases ?? "";
  const s = fasesSugeridas(estado);
  $("casa-fases-sugestao").textContent = s === "tri"
    ? `Sugerimos: Trifásica (${c.tipo === "industrial" ? "industrial" : "máquinas trifásicas ou carregador de 22 kW"}).`
    : s === "mono" ? "Sugerimos: Monofásica (a mais comum)." : "Monofásica é a mais comum nas casas.";
}
$("casa-potencia").addEventListener("change", () => { estado.casa.potencia_contratada_kva = potenciaContratada($("casa-potencia").value); agendarGravacao(); });
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
$("casa-localidade").addEventListener("input", () => { estado.casa.localidade = $("casa-localidade").value.slice(0, 80); agendarGravacao(); });

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
ligarLocalidade($("casa-localidade"));

// ------------------------------------------------------------ 2. O que quer
const OBJETIVOS_AJUDA = {
  poupar: "Ver o consumo de cada circuito",
  alarme: "Sensores de porta e de movimento",
  estores: "Abrir e fechar pelo telemóvel ou a horas",
  luzes: "Interruptores inteligentes",
  distancia: "Ver e ligar a casa quando não está",
  clima: "Termóstato Wi-Fi",
  horarios: "Luzes e máquinas ligam e desligam a horas",
  iluminacao_auto: "Sensores de movimento acendem as luzes",
  energia: "Ver o consumo de cada circuito",
  desligar: "Um toque desliga o que ficou ligado",
};
const quer = (k) => estado.quer.objetivos.includes(k);

/**
 * Máquinas grandes, pequenas (por grupos) e objetivos do perfil do imóvel (casa, serviços ou industrial):
 * refeitos quando o perfil muda. As máquinas mudam a ligação sugerida (carregador de 22 kW → trifásica).
 */
function desenharQuer() {
  const gm = $("quer-maquinas"), gp = $("quer-pequenas"), go = $("quer-objetivos");
  const perfil = perfilCasa(estado.casa.tipo);
  if (gm.dataset.perfil !== perfil) {
    gm.dataset.perfil = perfil;
    const alternar = (lista, chaves, k) => (sim) => {
      const s = new Set(estado.quer[lista]);
      if (sim) s.add(k); else s.delete(k);
      estado.quer[lista] = chaves.filter((x) => s.has(x));   // sempre pela ordem da lista
      if (lista !== "objetivos") sugerirLigacao();
      agendarGravacao();
    };
    const maquina = (lista, chaves) => (k) => escolha("checkbox", `quer-${lista}-${k}`, k, MODELOS[k].nome, `cerca de ${formatarW(MODELOS[k].w)}`, alternar(lista, chaves, k));
    const grandes = maquinasGrandesDe(estado.casa.tipo);
    gm.replaceChildren(...grandes.map(maquina("maquinas", grandes)));
    const pequenas = MAQUINAS_PEQUENAS[perfil].flatMap(([, l]) => l);
    gp.replaceChildren(...MAQUINAS_PEQUENAS[perfil].map(([titulo, chaves]) => {
      const f = el("fieldset", "escolhas quer-grupo");
      f.append(el("legend", null, titulo));
      const grelha = el("div", "escolhas-grelha");
      grelha.append(...chaves.map(maquina("pequenas", pequenas)));
      f.append(grelha);
      return f;
    }));
    const objs = objetivosDe(estado.casa.tipo);
    go.replaceChildren(...objs.map((k) => escolha("checkbox", `quer-objetivo-${k}`, k, OBJETIVOS[k], OBJETIVOS_AJUDA[k], alternar("objetivos", objs, k))));
  }
  for (const i of gm.querySelectorAll("input")) i.checked = estado.quer.maquinas.includes(i.value);
  for (const i of gp.querySelectorAll("input")) i.checked = estado.quer.pequenas.includes(i.value);
  for (const i of go.querySelectorAll("input")) i.checked = estado.quer.objetivos.includes(i.value);
}

// ------------------------------------------------------------ 3. Planta (pré-desenhada) — docs §1.1
const assinaturaBase = () => assinaturaCasa(estado.casa, maquinasEscolhidas(estado.quer));
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
  estado.planta = plantaDaCasa(estado.casa, maquinasEscolhidas(estado.quer));
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
    : "Já desenhámos as divisões (com tamanhos típicos), cada uma com os aparelhos habituais (porta, interruptor, luz, sensor de movimento, janelas e tomadas), e as máquinas que escolheu. Arraste, ajuste, acrescente divisões (escritório, lavandaria, despensa…) com os botões e tire ou acrescente o que for preciso — ou salte este passo.";
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
    add(l.telecom, "ponto de telecomunicações (brevemente)", "pontos de telecomunicações (brevemente)");
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
const contagemAtual = () => contarPlanta(usaPlanta() ? estado.planta : plantaDaCasa(estado.casa, maquinasEscolhidas(estado.quer)));

/**
 * Circuitos sugeridos (§4) a partir da contagem. Toda a casa tem luzes e tomadas: se não há nenhuma
 * desenhada ficam os circuitos base "Iluminação" e "Tomadas"; as máquinas têm circuito próprio.
 */
function circuitosSugeridos(cont) {
  // RTIEBT (quadro.js): zonas húmidas no C5, T3 e mais com iluminação e tomadas em 2 zonas.
  const c = sugerirCircuitos(cont, opcoesCircuitos(estado.casa));
  const de = (tipo, nome) => { const l = c.filter((x) => x.tipo === tipo); return l.length ? l : [{ ...circuitoVazio(0, tipo), nome }]; };
  const r = numerar([...de("iluminacao", "Iluminação"), ...de("tomadas", "Tomadas"), ...c.filter((x) => x.tipo === "maquina")]);
  // "Poupar energia" / "Controlo de energia": medir o consumo em todos os circuitos inteligentes (já é o que sugerimos por omissão).
  if (quer("poupar") || quer("energia")) for (const x of r) if (x.inteligente) x.medir = true;
  return r;
}

/** Linhas do passo "Divisões" (a partir da contagem) com os aparelhos dos objetivos (casa.js). */
function divisoesSugeridas(cont) {
  const planta = usaPlanta();
  const d = divisoesDaContagem(cont);
  if (!planta) for (const x of d) x.planta_id = null;
  return aplicarObjetivos(d, estado.quer.objetivos, planta ? cont : null);
}

/** Pré-preenche a planta (se ainda é a nossa), as divisões, o quadro e os termóstatos (só o que o cliente não mudou). */
function prepararPassosSeguintes() {
  preencherPlanta();
  const cont = contagemAtual();
  if (!estado.divisoesEditadas) estado.divisoes = divisoesSugeridas(cont);
  if (!estado.quadroEditado) estado.quadro.circuitos = circuitosSugeridos(cont);
  // "Aquecimento / ar condicionado": um termóstato por piso.
  if (!estado.termostatosEditados) estado.extras.termostatos = quer("clima") ? Math.max(1, estado.casa.pisos ?? 1) : 0;
}

// ------------------------------------------------------------ 5. Quadro
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
  const daCasa = !temPlanta && (!!estado.casa.tipologia || negocio() || estado.quer.maquinas.length > 0);
  const botao = $("quadro-recalcular");
  botao.textContent = temPlanta ? "Recalcular a partir da planta" : "Recalcular a partir da casa";
  botao.hidden = !temPlanta && !daCasa;
  const origem = $("quadro-origem");
  origem.hidden = !temPlanta && !daCasa;
  origem.textContent = estado.quadroEditado ? `Alterou o quadro à mão: não o mudamos sozinhos. Use "${botao.textContent}" para voltar à sugestão.` : `Sugestão feita a partir da sua ${temPlanta ? "planta" : "casa e das máquinas que escolheu"} pelos circuitos mínimos da RTIEBT: C1 iluminação 10 A (cabo 1,5 mm², até 8 pontos por circuito), C2 tomadas 16 A (2,5 mm², até 8 com as máquinas pequenas), C3 placa/forno 25 A (6 mm²), C4 máquinas de lavar e termoacumulador 16 A (2,5 mm²), C5 tomadas da cozinha e casas de banho; do T3 para cima a iluminação e as tomadas dividem-se pela zona de dia e de noite${negocio() ? " (em serviços e industrial o mesmo, dividido a partir de 100 m²)" : ""}. Pode mudar tudo.`;
  for (const r of document.querySelectorAll("input[name=disjuntor]")) r.checked = r.value === estado.quadro.disjuntor;
  const caixaC = $("circuitos");
  caixaC.replaceChildren();
  if (!estado.quadro.circuitos.length) caixaC.append(el("p", "ajuda", "Sem circuitos. Use \"Adicionar circuito\"."));
  estado.quadro.circuitos.forEach((c, i) => caixaC.append(cartaoCircuito(c, i)));
  sincronizarProtecoes();
  desenharAvisosQuadro();
}

function cartaoCircuito(c, i) {
  const id = `c${i}`;
  const f = el("fieldset", "cartao circuito");
  f.dataset.circuito = String(i);
  const leg = el("legend", null, `Circuito ${c.n}${c.nome ? ` — ${c.nome}` : ""}`);
  // Código RTIEBT, cabo, grupo diferencial e AFDD (atualizados em desenharAvisosQuadro).
  const rt = el("p", "ajuda circuito-rtiebt");
  rt.id = `${id}-rtiebt`;
  f.append(leg, rt);
  const nome = document.createElement("input");
  nome.id = `${id}-nome`;
  nome.maxLength = 60;
  nome.value = c.nome;
  nome.addEventListener("input", () => { c.nome = nome.value.slice(0, 60); leg.textContent = `Circuito ${c.n}${c.nome ? ` — ${c.nome}` : ""}`; quadroMudou(); desenharAvisosQuadro(); });
  const tipo = selectCom(Object.entries(TIPOS_CIRCUITO), c.tipo, `${id}-tipo`);
  tipo.addEventListener("change", () => { c.tipo = tipo.value; lHum.hidden = !temTomadas(c); quadroMudou(); desenharAvisosQuadro(); });
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
  if (!nomes.length) divs.append(el("p", "ajuda", "Ainda não há divisões (passos 3 e 4)."));
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
  // Tomadas da cozinha/casa de banho (C5): contam para o grupo diferencial certo.
  const [lHum, cHum] = caixa("Tomadas de cozinha ou casa de banho (zona húmida)", !!c.zona_humida, `${id}-humida`);
  lHum.hidden = !temTomadas(c);
  cHum.addEventListener("change", () => { c.zona_humida = cHum.checked; quadroMudou(); desenharAvisosQuadro(); });
  const opcoes = el("div", "opcoes-circuito");
  opcoes.append(lInt, lMed, lHum);

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

const temTomadas = (c) => c.tipo === "tomadas" || c.tipo === "misto";

/** "C2 — Tomadas · cabo 2,5 mm² · diferencial 1 · AFDD" (circuito próprio sem código RTIEBT). */
function textoRtiebt(c, r) {
  const k = codigoCircuito(c);
  const s = seccaoCabo(c.amperes);
  const g = r.grupos.find((x) => x.circuitos.includes(c.n));
  return [k ? `${k} — ${RTIEBT[k]}` : c.tipo === "maquina" ? "Circuito próprio" : "Misto (sem código RTIEBT)", s ? `cabo ${formatarMm2(s)}` : null, g ? `diferencial ${g.n}` : null, r.afdd.includes(c.n) ? "com AFDD" : null].filter(Boolean).join(" · ");
}

function desenharAvisosQuadro() {
  const resumo = resumoQuadro(estado);
  estado.quadro.circuitos.forEach((c, i) => {
    const rt = $(`c${i}-rtiebt`);
    if (rt) rt.textContent = textoRtiebt(c, resumo);
  });
  estado.quadro.circuitos.forEach((c, i) => {
    const ul = $(`c${i}-avisos`);
    if (!ul) return;
    ul.replaceChildren();
    for (const a of avisosCircuito(c, opcoesAvisos(estado))) ul.append(el("li", null, a));
    ul.hidden = !ul.childElementCount;
  });
  const g = $("quadro-avisos");
  g.replaceChildren();
  const todos = avisosEstado(estado);
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
  desenharResumoQuadro(resumo);
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

// ------------------------------------------------------------ 5. Quadro: proteções, tamanho e potência (quadro.js)
/** Monta uma vez os controlos das proteções (pacotes, ligar/desligar cada item, pára-raios, quadro novo). */
function montarProtecoes() {
  const caixaP = $("quadro-protecoes");
  const fsPac = el("fieldset", "escolhas");
  fsPac.append(el("legend", null, "Pacote de proteções"));
  const grelha = el("div", "escolhas-grelha tres-pacotes");
  for (const [k, p] of Object.entries(PACOTES)) {
    grelha.append(escolha("radio", "quadro-pacote", k, p.nome, p.ajuda, (sim) => {
      if (!sim) return;
      estado.quadro.protecoes = protecoesDoPacote(k, estado.quadro.protecoes?.idr_wifi);
      estado.quadro.pacote = k;
      protecoesMudaram();
    }));
  }
  const pers = el("p", "ajuda");
  pers.id = "quadro-personalizado";
  fsPac.append(grelha, pers);

  const fsItens = el("fieldset", "escolhas");
  fsItens.append(el("legend", null, "O que leva o quadro"));
  const [lIdr, cIdr] = caixa("Pessoas — diferenciais 40 A / 30 mA, um por grupo (obrigatório pela RTIEBT)", true, "prot-idr");
  cIdr.disabled = true;
  fsItens.append(lIdr);
  for (const [k, p] of Object.entries(PROTECOES)) {
    const [l, cb] = caixa(`${p.grupo} — ${p.nome}`, false, `prot-${k}`);
    l.querySelector("span").append(el("small", "bloco-ajuda", p.ajuda));
    cb.addEventListener("change", () => {
      estado.quadro.protecoes = { ...estado.quadro.protecoes, [k]: cb.checked };
      estado.quadro.pacote = pacoteDe(estado.quadro.protecoes);
      protecoesMudaram();
    });
    fsItens.append(l);
  }

  const pergunta = (legenda, nome, opcoes, campo, curtas = false) => {
    const fs = el("fieldset", "escolhas");
    fs.append(el("legend", null, legenda));
    const g = el("div", `escolhas-grelha ${curtas ? "tres-curtas" : "tres-pacotes"}`);
    for (const [v, t] of [...Object.entries(opcoes), ["", "Não sei"]]) {
      g.append(escolha("radio", nome, v, t, null, (sim) => { if (sim) { estado.quadro[campo] = v || null; protecoesMudaram(); } }));
    }
    fs.append(g);
    return fs;
  };
  const fsRaios = pergunta("A casa tem pára-raios ou é alimentada por linha aérea?", "quadro-para-raios", PARA_RAIOS, "para_raios", true);
  fsRaios.append(el("p", "ajuda", "Com pára-raios ou linha aérea (cabos nos postes até à casa) o descarregador de sobretensões é obrigatório."));
  const fsQuadro = pergunta("O quadro atual serve ou quer quadro novo?", "quadro-novo", QUADRO_NOVO, "quadro_novo");
  fsQuadro.append(el("p", "ajuda", "Com quadro novo (ou \"Não sei\") a caixa do quadro, o geral e os disjuntores entram no preço."));

  const res = el("div", "cartao sim-quadro-resumo");
  res.id = "quadro-resumo";
  res.setAttribute("aria-live", "polite");
  caixaP.replaceChildren(fsPac, fsItens, fsRaios, fsQuadro, res);
}

/** Põe os controlos das proteções como está no estado. */
function sincronizarProtecoes() {
  const q = estado.quadro;
  const efetivas = protecoesEfetivas(q);
  const pacote = pacoteDe(efetivas);
  for (const i of document.querySelectorAll("input[name=quadro-pacote]")) i.checked = i.value === pacote;
  $("quadro-personalizado").textContent = pacote === "personalizado" ? "Personalizado: escolheu as proteções uma a uma (um pacote volta a pô-las como estavam nele)." : "Depois pode ligar ou desligar cada item.";
  for (const k of Object.keys(PROTECOES)) {
    const cb = $(`prot-${k}`);
    cb.checked = !!efetivas[k];
    // Com pára-raios ou linha aérea, o descarregador é obrigatório.
    cb.disabled = k === "descarregador" && q.para_raios === "sim";
  }
  for (const i of document.querySelectorAll("input[name=quadro-para-raios]")) i.checked = i.value === (q.para_raios ?? "");
  for (const i of document.querySelectorAll("input[name=quadro-novo]")) i.checked = i.value === (q.quadro_novo ?? "");
}

function protecoesMudaram() {
  agendarGravacao();
  sincronizarProtecoes();
  desenharAvisosQuadro();
}

/** "Quadro de N módulos (X ocupados, Y livres)", o que ocupa, os grupos diferenciais, a potência sugerida e o preço destes artigos. */
function desenharResumoQuadro(r = resumoQuadro(estado)) {
  const c = $("quadro-resumo");
  if (!c) return;
  c.replaceChildren();
  const novo = levaQuadroNovo(estado.quadro);
  c.append(el("p", "sim-quadro-tamanho", `${r.quadros > 1 ? `${r.quadros} quadros` : "Quadro"} de ${r.tamanho} módulos (${r.ocupados} ocupados, ${r.livres} livres)`));
  c.append(el("p", "ajuda", novo
    ? `Tamanho sugerido para um quadro novo, com pelo menos 25 % de módulos livres.${estado.quadro.quadro_novo ? "" : " (Não sabe se o atual serve: incluímos o quadro novo por precaução.)"}`
    : `Mantém o quadro atual: precisa de ${r.novos} ${r.novos === 1 ? "módulo novo" : "módulos novos"} livres${r.novos > 12 ? " (acrescentámos a ampliação)" : ""}. Se o seu quadro tiver menos de ${r.ocupados} módulos, precisa de um quadro novo.`));
  const ul = el("ul", "sim-quadro-linhas");
  for (const l of r.linhas) ul.append(el("li", null, `${l.qtd} × ${l.nome} — ${l.modulos} ${l.modulos === 1 ? "módulo" : "módulos"}`));
  c.append(ul);
  const g = el("ul", "sim-quadro-grupos");
  for (const x of r.grupos) {
    const txt = x.circuitos.length ? `${x.circuitos.length === 1 ? "circuito" : "circuitos"} ${x.circuitos.join(", ")}` : "sem circuitos (fica pronto para os próximos)";
    g.append(el("li", null, `Diferencial ${x.n}${x.carregador ? " (carregador do carro)" : ""}${r.protecoes.idr_wifi ? " Wi-Fi" : ""}: ${txt}`));
  }
  c.append(el("h4", null, "Grupos diferenciais"), g);
  const pot = r.potencia;
  const contratada = estado.casa.potencia_contratada_kva;
  const curta = pot.kva === null || (contratada !== null && pot.kva > contratada);
  const p = el("p", curta ? "sim-quadro-potencia curta" : "sim-quadro-potencia");
  p.id = "quadro-potencia";
  p.textContent = `Potência sugerida: ${pot.kva === null ? "acima de 41,4 kVA" : formatarKva(pot.kva)}${pot.trifasica ? " (trifásica)" : ""} · contratada: ${contratada === null ? "não sabe" : formatarKva(contratada)}${curta && contratada !== null ? " — pode ser curta" : ""}`;
  c.append(p, el("p", "ajuda", `Soma das cargas do quadro com simultaneidade: a maior máquina a 100 %, a segunda a 50 %, as outras a 25 %, luzes, tomadas e máquinas pequenas a 40 % (cerca de ${formatarW(pot.carga_w)}); escalões da E-Redes.`));
  // Preço destes artigos (catálogo): o mesmo cálculo do passo 6.
  if (Array.isArray(catalogo)) {
    const pq = calcularPreco(pedidosQuadro(estado), catalogo, configOrc);
    if (pq.artigos_iva !== null) c.append(el("p", "ajuda", `Proteções e quadro: ${formatarEuro(pq.artigos_iva)} em material + ${formatarEuro(pq.mao_obra_iva)} de instalação (com IVA; os disjuntores inteligentes estão à parte).`));
  }
}
montarProtecoes();

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
// Planta em que o cliente mexeu e a casa ou as máquinas mudaram depois: só a refazemos se ele pedir (e confirmar).
ligarRecalcular("planta-refazer", () => true, () => {
  desenharDaCasa();
  estado.plantaSaltada = false;
}, () => {
  editor.abrir(estado.planta, { reiniciarVista: true });
  desenharContagem();
  desenharPlantaOrigem();
  textoSeguinte();
}, { pergunta: "Isto apaga a planta atual (e o que desenhou nela) e desenha-a de novo a partir dos passos 1 e 2. Continuar?", sim: "Sim, refazer" });

// ------------------------------------------------------------ 4. Divisões
function divisoesMudou() {
  estado.divisoesEditadas = true;
  agendarGravacao();
}

function desenharDivisoes() {
  const temPlanta = usaPlanta();
  const daCasa = !temPlanta && (casaDaDivisoes() || estado.quer.objetivos.length > 0);
  const botao = $("divisoes-recalcular");
  botao.textContent = temPlanta ? "Recalcular a partir da planta" : "Recalcular a partir da casa";
  botao.hidden = !temPlanta && !daCasa;
  const origem = $("divisoes-origem");
  origem.hidden = !temPlanta && !daCasa;
  const efeitos = [
    quer("alarme") && "sensores do alarme", quer("estores") && "estores", (quer("luzes") || quer("horarios")) && "interruptores",
    quer("iluminacao_auto") && "sensores de movimento",
  ].filter(Boolean);
  const objetivos = efeitos.length ? ` e do que quer fazer (${efeitos.join(", ")})` : "";
  origem.textContent = estado.divisoesEditadas ? "Alterou as divisões à mão: não as mudamos sozinhos."
    : temPlanta ? `Preenchido a partir da sua planta (uma porta da rua conta como um sensor de porta sugerido)${objetivos}. Pode mudar tudo.`
      : `Preenchido a partir ${negocio() ? "do seu espaço" : "da sua casa"}${objetivos}. Pode mudar tudo.`;
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
  // Local da obra: a localidade do passo 1 (ou, na área de cliente, a do contacto) — como em casaParaEnvio.
  const deslocacao = calcularDeslocacao(estado.casa.localidade.trim() || estado.contacto.localidade.trim(), configOrc);
  const preco = calcularPreco(pedidos, catalogo ?? null, configOrc, deslocacao);
  // "Desligar tudo ao fechar" (serviços/industrial) também é controlar à distância.
  return { pedidos, preco, plano: planoSugerido(pedidos, { distancia: quer("distancia") || quer("desligar") }) };
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
  if (negocio()) {
    linha("Área e espaços", `${k.area_m2} m² · ${k.espacos} ${k.espacos === 1 ? "espaço" : "espaços"}`);
  } else if (k.tipologia) {
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
    if (preco.deslocacao.estado === "fora_area") {
      const km = preco.deslocacao.distancia_km;
      total.append(el("p", "msg info", `${preco.deslocacao.concelho}${km !== null ? ` (cerca de ${km} km)` : ""} fica fora da área servida — contacte-nos. A deslocação não está incluída.`));
    }
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
    const d = preco.deslocacao;
    if (d.estado === "estimada") linhaRodape(`Deslocação: ${d.distancia_km} km (estimativa)`, formatarEuro(d.valor_iva));
    else if (d.estado === "fora_area") linhaRodape("Deslocação: fora da área servida — contacte-nos", "—");
    else linhaRodape(`Deslocação: confirmada na visita${d.valor_iva > 0 ? " (mínimo)" : ""}`, d.valor_iva > 0 ? formatarEuro(d.valor_iva) : "—");
    linhaRodape("Total estimado", formatarEuro(preco.total), "total");
    linhaRodape(`Intervalo (± ${String(preco.config.margem_intervalo_pct).replace(".", ",")} %)`, `${formatarEuroRedondo(preco.min)} – ${formatarEuroRedondo(preco.max)}`);
  } else if (preco.linhas.length) {
    linhaRodape("Mão de obra", "a confirmar");
  }
  // O texto da estimativa já está no cartão do total: aqui só o IVA (não se repete).
  $("preco-nota").textContent = "Preços com IVA incluído.";
  // Telecomunicações (ITED): ainda fora do preço, orçamentadas na visita.
  const tel = telecomParaEnvio(estado);
  $("preco-telecom").textContent = `${tel.texto}${tel.total ? ` (${tel.total} ${tel.total === 1 ? "ponto desenhado" : "pontos desenhados"} na planta)` : ""}`;

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
  const avisos = avisosEstado(estado);
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
ligarLocalidade($("contacto-localidade"));

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
  else if (estadoHttp === 400) {
    const e = typeof erro === "string" ? erro.trim().slice(0, 200) : "";
    mostrarEnvio(`Há dados em falta ou inválidos${e ? `: ${e}${/[.!?…]$/.test(e) ? "" : "."}` : "."} Verifique o formulário, ou fale connosco.`, "erro", true);
  }
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
      visitado = Math.max(estado.passo, estado.visitado ?? 0);
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
