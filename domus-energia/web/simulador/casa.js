// Simulador de orçamento — pré-preenchimento a partir dos passos "A casa" e "O que quer"
// (docs/SIMULADOR-ORCAMENTO.md §1.1). Só lógica, sem DOM: lista de divisões pela tipologia,
// planta já desenhada (divisões em grelha, sem sobreposição, e as máquinas escolhidas) e
// aparelhos sugeridos por divisão a partir dos objetivos.

import { TIPOS_DIVISAO, MAX_DIVISOES, MAX_LADO_CM, ESCALA_CM, plantaVazia, propsOmissao, atualizarDivisoes } from "./regras.js";

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

/** Casas de banho por omissão: T0–T2 → 1, T3+ → 2. */
export const casasBanhoOmissao = (tipologia) => (["T3", "T4", "T5+"].includes(tipologia) ? 2 : 1);

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
  const porDivisao = new Map();
  let e = 0;
  for (const modelo of maquinas) {
    const d = divisaoParaMaquina(p.divisoes, modelo);
    if (!d) continue;
    const i = porDivisao.get(d.id) ?? 0;
    porDivisao.set(d.id, i + 1);
    // Ao fundo da divisão, da esquerda para a direita; se não couber, sobe uma fila.
    const porFila = Math.max(1, Math.floor((d.largura_cm - 50) / PASSO_MAQUINA));
    const col = i % porFila, fila = Math.floor(i / porFila);
    p.elementos.push({
      id: `e${++e}`, tipo: "maquina",
      x_cm: d.x_cm + 50 + col * PASSO_MAQUINA, y_cm: Math.max(d.y_cm + 25, d.y_cm + d.altura_cm - 50 - fila * PASSO_MAQUINA),
      rot: 0, divisao: null, props: propsOmissao("maquina", modelo),
    });
  }
  return atualizarDivisoes(p);
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
