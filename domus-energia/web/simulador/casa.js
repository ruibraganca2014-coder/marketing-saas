// Simulador de orçamento — pré-preenchimento a partir dos passos "A casa" e "O que quer"
// (docs/SIMULADOR-ORCAMENTO.md §1.1). Só lógica, sem DOM: lista de divisões pela tipologia,
// planta já desenhada (divisões em grelha, sem sobreposição, e as máquinas escolhidas) e
// aparelhos sugeridos por divisão a partir dos objetivos.

import { TIPOS_DIVISAO, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, ESCALA_CM, plantaVazia, propsOmissao, atualizarDivisoes } from "./regras.js";

const MARGEM = 50;            // cm à volta da planta
const LARGURA_LINHA = 1500;   // cm: largura máxima de uma linha de divisões
const ENTRE_PISOS = 100;      // cm entre os pisos (um piso por bloco de linhas)
const PASSO_MAQUINA = 100;    // cm entre máquinas na mesma divisão (os ícones não se tocam)

/** Tamanhos (cm) das divisões que não têm botão no editor; as outras vêm de TIPOS_DIVISAO. */
const TAMANHOS = {
  "Sala de estar": [500, 400], "Sala de jantar": [400, 350], "Sala e cozinha": [650, 400], "Sala de jantar e cozinha": [550, 400],
  "Estúdio": [600, 450], "Escadas": [200, 300], "Exterior": [500, 300],
};
function tamanho(nome) {
  const base = nome.replace(/ \(piso \d+\)$/, "").replace(/ \d+$/, "");
  if (TAMANHOS[base]) return TAMANHOS[base];
  const t = TIPOS_DIVISAO.find((x) => x.nome === base);
  return t ? [t.w, t.h] : [400, 300];
}

const semAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Tipo de uma divisão pelo nome (também as que o cliente escreveu):
 * sala, sala_cozinha, cozinha, quarto, wc, corredor, entrada, escadas, garagem, jardim, varanda, lavandaria ou outra.
 */
export function tipoDivisao(nome) {
  const s = semAcentos(nome);
  if (/cozinha/.test(s) && /sala|estudio/.test(s)) return "sala_cozinha";
  if (/^(cozinha|kitchenette)/.test(s)) return "cozinha";
  if (/^(sala|estudio|living)/.test(s)) return "sala";
  if (/^(quarto|suite)/.test(s)) return "quarto";
  if (/^(casa de banho|wc|banho|lavabo)/.test(s)) return "wc";
  if (/^(corredor|hall)/.test(s)) return "corredor";
  if (/^entrada/.test(s)) return "entrada";
  if (/^escada/.test(s)) return "escadas";
  if (/^(garagem|arrecadacao|arrumos)/.test(s)) return "garagem";
  if (/^(jardim|exterior|quintal|piscina|logradouro)/.test(s)) return "jardim";
  if (/^(varanda|terraco|marquise)/.test(s)) return "varanda";
  if (/^lavandaria/.test(s)) return "lavandaria";
  return "outra";
}

/** N.º de quartos pela tipologia (T5+: o que o cliente indicou, 5–12); null sem tipologia. */
export function quartosDe(casa) {
  const t = casa?.tipologia;
  if (!t) return null;
  if (t === "T5+") return Math.min(12, Math.max(5, Math.round(Number(casa.quartos) || 5)));
  return Number(t.slice(1)) || 0;
}

/** Valores típicos ao escolher a tipologia (o cliente ajusta depois): casas de banho e salas. */
const TIPICO = { T0: [1, 1], T1: [1, 1], T2: [1, 1], T3: [2, 1], T4: [2, 2], "T5+": [3, 2] };
export const casasBanhoOmissao = (tipologia) => TIPICO[tipologia]?.[0] ?? 1;
export const salasOmissao = (tipologia) => TIPICO[tipologia]?.[1] ?? 1;

// Área de cliente sem tipologia: a lista antiga pelo n.º de divisões (3 se não indicado).
const ORDEM_SEM_TIPOLOGIA = ["Sala", "Cozinha", "Quarto 1", "WC", "Quarto 2", "Corredor", "Quarto 3", "Casa de banho", "Escritório", "Entrada", "Lavandaria", "Garagem", "Varanda", "Despensa", "Exterior"];

/** Divide `n` coisas por `k` pisos (as primeiras levam mais). */
const repartir = (n, k) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));

/**
 * Divisões da casa (nome e piso), pela ordem em que ficam na planta.
 * Com pisos > 1: piso 1 com salas, cozinha, a primeira casa de banho, garagem e jardim; quartos e as
 * outras casas de banho repartidos pelos pisos de cima; a varanda no último; "Escadas (piso N)" em cada um.
 * `maquinas`: o carregador sem garagem nem jardim, ou a bomba sem jardim, acrescentam "Exterior".
 */
export function divisoesDaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  const r = [];
  const add = (nome, piso = 1) => r.push({ nome, piso });
  if (!c.tipologia) {
    const n = Math.min(MAX_DIVISOES, c.divisoes ?? 3);
    for (let i = 0; i < n; i++) add(ORDEM_SEM_TIPOLOGIA[i] ?? `Divisão ${i + 1}`);
  } else {
    const x = c.extras ?? {};
    const pisos = Math.min(4, Math.max(1, Math.round(Number(c.pisos) || 1)));
    const quartos = quartosDe(c);
    const cbs = Math.min(6, Math.max(1, Math.round(Number(c.casas_banho) || 1)));
    const salas = Math.min(4, Math.max(1, Math.round(Number(c.salas) || 1)));
    const cima = pisos - 1;
    const ultimo = pisos;
    if (c.tipologia === "T0") add("Estúdio");       // sala e quarto na mesma divisão (com kitnet, também a cozinha)
    else {
      for (let i = 1; i <= salas; i++) {
        const nome = salas === 1 ? "Sala" : i === 1 ? "Sala de estar" : i === 2 ? "Sala de jantar" : `Sala ${i}`;
        // Kitnet: a cozinha fica na sala (na de jantar quando há duas).
        const comCozinha = x.kitnet && (salas === 1 ? i === 1 : i === 2);
        add(comCozinha ? (salas === 1 ? "Sala e cozinha" : "Sala de jantar e cozinha") : nome);
      }
    }
    if (!x.kitnet) add("Cozinha");
    // Quartos e casas de banho: tudo no piso 1, ou (com pisos) os quartos em cima.
    const qPiso = cima ? [0, ...repartir(quartos, cima)] : [quartos];
    const bPiso = cima ? [1, ...repartir(cbs - 1, cima)] : [cbs];
    let q = 0, b = 0;
    const nomeCb = () => (cbs === 1 ? "Casa de banho" : `Casa de banho ${++b}`);
    let corredores = 0;
    for (let p = 1; p <= pisos; p++) {
      // Corredor (T2+): um por piso com quartos.
      if (quartos >= 2 && qPiso[p - 1] > 0) add(++corredores === 1 ? "Corredor" : `Corredor ${corredores}`, p);
      for (let i = 0; i < qPiso[p - 1]; i++) add(`Quarto ${++q}`, p);
      for (let i = 0; i < bPiso[p - 1]; i++) add(nomeCb(), p);
      if (pisos > 1) add(`Escadas (piso ${p})`, p);
    }
    if (x.garagem) add("Garagem");
    if (x.varanda) add("Varanda", ultimo);
    if (x.jardim) add("Jardim");
  }
  const tem = (t) => r.some((d) => tipoDivisao(d.nome) === t);
  const lista = Array.isArray(maquinas) ? maquinas : [];
  if ((lista.includes("carregador_ve") && !tem("garagem") && !tem("jardim")) || (lista.includes("bomba") && !tem("jardim"))) add("Exterior");
  return r.slice(0, MAX_DIVISOES);
}

/**
 * Aparelhos por omissão de uma divisão nova (§2.2), além do base que todas levam (porta, interruptor,
 * ponto de luz, sensor de movimento): tipo de divisão → janela, televisão, n.º de tomadas.
 */
const APARELHOS_TIPO = {
  quarto: { janela: true, tomadas: 2 },
  sala: { janela: true, tv: true, tomadas: 3 },
  sala_cozinha: { janela: true, tv: true, tomadas: 3 },
  cozinha: { janela: true, tomadas: 3 },
  escritorio: { janela: true, tomadas: 2 },
  wc: { tomadas: 1 },
  garagem: { tomadas: 1 },
  jardim: { tomadas: 1 },
};

/**
 * Aparelhos por omissão de uma divisão retangular (nome → tipo; caixa em cm), em sítios plausíveis e
 * afastados uns dos outros (≥ 65 cm nas divisões de tamanho típico): porta na parede de baixo com o
 * interruptor ao lado, janela na parede oposta (a de cima), luz ao centro, sensor de movimento no canto
 * de cima à esquerda (vê a porta), tomadas nas paredes (esquerda, direita, baixo à direita) e a
 * televisão na parede da direita. Ficam 10 cm para dentro das paredes: numa parede partilhada contam
 * nesta divisão. Usada pelo editor (botões por tipo) e por plantaDaCasa. Devolve elementos sem id.
 */
export function aparelhosOmissao(nome, { x_cm: x, y_cm: y, largura_cm: w, altura_cm: h }) {
  const t = /^escritorio/.test(semAcentos(nome)) ? "escritorio" : tipoDivisao(nome);
  const extra = APARELHOS_TIPO[t] ?? {};
  const r = [];
  const add = (tipo, dx, dy, rot = 0, modelo) => r.push({ tipo, x_cm: Math.round(x + dx), y_cm: Math.round(y + dy), rot, divisao: null, props: propsOmissao(tipo, modelo) });
  const porta = Math.max(60, Math.round(w * 0.3));
  add("porta", porta, h - 10);
  // Interruptor ao lado da porta, do lado de fora da divisão (a luz fica ao centro, longe dele).
  add("interruptor", porta - 70 >= 40 ? porta - 70 : Math.min(porta + 70, w - 30), h - 10);
  add("luz", w / 2, h / 2);
  add("sensor_movimento", 40, 40);
  if (extra.janela) add("janela", w / 2, 10);
  const tomadas = [[10, h / 2, 90], [w - 10, h / 2, 90], [w - Math.max(40, w * 0.2), h - 10, 0]];
  for (const [dx, dy, rot] of tomadas.slice(0, extra.tomadas ?? 0)) add("tomada", dx, dy, rot);
  if (extra.tv) add("maquina", w - 25, h * 0.25, 0, "televisao");
  return r;
}

/** Onde fica cada máquina (tipos de divisão por ordem de preferência; senão a primeira divisão). */
const DESTINO = {
  placa: ["cozinha", "sala_cozinha", "sala"],
  forno: ["cozinha", "sala_cozinha", "sala"],
  maquina_loica: ["cozinha", "sala_cozinha", "sala"],
  maquina_lavar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  maquina_secar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  termoacumulador: ["cozinha", "garagem", "sala_cozinha", "wc", "sala"],
  ar_condicionado: ["sala", "sala_cozinha"],
  carregador_ve: ["garagem", "jardim"],
  bomba: ["jardim"],
};

/** Divisão (da lista `divs`, com `nome`) onde pôr a máquina `modelo`. */
export function divisaoParaMaquina(divs, modelo) {
  for (const t of DESTINO[modelo] ?? []) {
    const d = divs.find((x) => tipoDivisao(x.nome) === t);
    if (d) return d;
  }
  return divs[0] ?? null;
}

/**
 * Planta já desenhada a partir da casa e das máquinas escolhidas (§2.1): divisões em linhas
 * (até 15 m de largura), cada piso num bloco abaixo do anterior, tamanhos típicos, sem sobreposição;
 * cada máquina fica na divisão certa (DESTINO), ao fundo da divisão.
 */
export function plantaDaCasa(casa, maquinas = []) {
  const p = plantaVazia();
  const lista = divisoesDaCasa(casa, maquinas);
  const pisos = [...new Set(lista.map((d) => d.piso))].sort((a, b) => a - b);
  let y = MARGEM, maxX = 0, n = 0;
  pisos.forEach((piso, k) => {
    if (k > 0) y += ENTRE_PISOS;
    let x = MARGEM, alturaLinha = 0;
    for (const d of lista.filter((z) => z.piso === piso)) {
      const [w, h] = tamanho(d.nome);
      if (x > MARGEM && x + w > MARGEM + LARGURA_LINHA) { x = MARGEM; y += alturaLinha; alturaLinha = 0; }
      p.divisoes.push({ id: `d${++n}`, nome: d.nome, x_cm: x, y_cm: y, largura_cm: w, altura_cm: h });
      x += w;
      maxX = Math.max(maxX, x);
      alturaLinha = Math.max(alturaLinha, h);
    }
    y += alturaLinha;
  });
  const arred = (v) => Math.ceil(v / ESCALA_CM) * ESCALA_CM;
  p.largura_cm = Math.min(MAX_LADO_CM, Math.max(p.largura_cm, arred(maxX + MARGEM)));
  p.altura_cm = Math.min(MAX_LADO_CM, Math.max(p.altura_cm, arred(y + MARGEM)));
  let e = 0;
  // Os aparelhos habituais de cada divisão (os mesmos dos botões do editor).
  for (const d of p.divisoes) {
    for (const a of aparelhosOmissao(d.nome, d)) {
      if (p.elementos.length >= MAX_ELEMENTOS) break;
      p.elementos.push({ id: `e${++e}`, ...a });
    }
  }
  const jaPostas = new Set(p.elementos.filter((x) => x.tipo === "maquina").map((x) => x.props.modelo));
  for (const modelo of maquinas) {
    // Uma máquina que já vai por omissão (ex.: a televisão da sala) não se põe duas vezes.
    if (jaPostas.has(modelo) || p.elementos.length >= MAX_ELEMENTOS) continue;
    const d = divisaoParaMaquina(p.divisoes, modelo);
    if (!d) continue;
    const [x_cm, y_cm] = lugarLivre(d, p.elementos);
    p.elementos.push({ id: `e${++e}`, tipo: "maquina", x_cm, y_cm, rot: 0, divisao: null, props: propsOmissao("maquina", modelo) });
  }
  return atualizarDivisoes(p);
}

/**
 * Sítio livre para mais um aparelho dentro da divisão (retângulo): o ponto da grelha de 25 cm, a
 * 30 cm das paredes, mais longe dos aparelhos que já lá estão (a partir de PASSO_MAQUINA conta
 * igual: fica o mais em baixo e à esquerda, "ao fundo da divisão").
 */
export function lugarLivre(d, elementos) {
  const perto = elementos.filter((q) => q.x_cm >= d.x_cm - 50 && q.x_cm <= d.x_cm + d.largura_cm + 50 && q.y_cm >= d.y_cm - 50 && q.y_cm <= d.y_cm + d.altura_cm + 50);
  let melhor = [d.x_cm + d.largura_cm / 2, d.y_cm + d.altura_cm / 2], nota = -1;
  for (let y = d.y_cm + d.altura_cm - 30; y >= d.y_cm + 30; y -= 25) {
    for (let x = d.x_cm + 30; x <= d.x_cm + d.largura_cm - 30; x += 25) {
      const n = Math.min(PASSO_MAQUINA, ...perto.map((q) => Math.hypot(q.x_cm - x, q.y_cm - y)));
      if (n > nota) { nota = n; melhor = [x, y]; }
    }
  }
  return melhor.map(Math.round);
}

/** Resumo do que gera a planta (para saber se a casa ou as máquinas mudaram depois). */
export function assinaturaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  const x = c.extras ?? {};
  return JSON.stringify([c.tipologia ?? null, quartosDe(c), c.casas_banho, c.salas, c.pisos, !!x.jardim, !!x.garagem, !!x.varanda, !!x.kitnet, [...maquinas].sort()]);
}

/**
 * Objetivos → aparelhos por divisão (passo "Divisões"), sem tirar nada do que já lá está:
 * - alarme: sensor de porta na entrada (entrada, corredor ou sala) se ainda não houver nenhum;
 *   sensor de movimento em cada sala e corredor;
 * - estores: estores motorizados nas salas e quartos (com planta que tenha janelas: um por janela da divisão);
 * - luzes: um interruptor inteligente em cada divisão interior que ainda não tenha.
 * `contagem`: contarPlanta() quando há planta (dá as janelas por divisão), senão null. Muda `divisoes`.
 */
export function aplicarObjetivos(divisoes, objetivos = [], contagem = null) {
  const quer = (k) => objetivos.includes(k);
  const tipo = (d) => tipoDivisao(d.nome);
  const janelasDe = (d) => contagem?.find((c) => c.id && c.id === d.planta_id)?.janelas ?? 0;
  const plantaComJanelas = !!contagem?.some((c) => c.janelas > 0);
  if (quer("alarme")) {
    if (!divisoes.some((d) => d.sensores_porta > 0)) {
      const alvo = ["entrada", "corredor", "sala", "sala_cozinha"].map((t) => divisoes.find((d) => tipo(d) === t)).find(Boolean) ?? divisoes[0];
      if (alvo) alvo.sensores_porta = 1;
    }
    for (const d of divisoes) if (["sala", "sala_cozinha", "corredor"].includes(tipo(d)) && !d.sensores_movimento) d.sensores_movimento = 1;
  }
  if (quer("estores")) {
    for (const d of divisoes) {
      if (!["sala", "sala_cozinha", "quarto"].includes(tipo(d)) || d.estores + d.estores_sem_motor > 0) continue;
      d.estores = plantaComJanelas ? janelasDe(d) : 1;
    }
  }
  if (quer("luzes")) {
    for (const d of divisoes) if (!["jardim", "varanda"].includes(tipo(d)) && !d.interruptores.length) d.interruptores = [1];
  }
  return divisoes;
}
