// Simulador de orçamento — pré-preenchimento a partir dos passos "A casa" e "O que quer"
// (docs/SIMULADOR-ORCAMENTO.md §1.1). Só lógica, sem DOM: lista de divisões pela tipologia (ou,
// em serviços e industrial, pela área e o n.º de espaços), planta já desenhada (divisões em grelha,
// sem sobreposição, os aparelhos habituais de cada uma e as máquinas escolhidas, grandes e pequenas)
// e aparelhos sugeridos por divisão a partir dos objetivos.

import {
  TIPOS_DIVISAO, TIPOS_DIVISAO_SERVICOS, TIPOS_DIVISAO_INDUSTRIAL, LIMITES_CASA, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, ESCALA_CM,
  plantaVazia, propsOmissao, atualizarDivisoes, perfilCasa, tiposDivisaoPara,
} from "./regras.js";

const MARGEM = 50;            // cm à volta da planta
const LARGURA_LINHA = 1500;   // cm: largura máxima de uma linha de divisões
const ENTRE_PISOS = 100;      // cm entre os pisos (um piso por bloco de linhas)
const PASSO_MAQUINA = 100;    // cm entre máquinas na mesma divisão (os ícones não se tocam)
const M2_POR_LUZ = 20;        // divisões grandes (loja, nave): um ponto de luz por cada 20 m²
const MAX_LUZES = 8;

/** Tamanhos (cm) das divisões que não têm botão no editor; as outras vêm dos botões (TIPOS_DIVISAO…). */
const TAMANHOS = {
  "Sala de estar": [500, 400], "Sala de jantar": [400, 350], "Sala e cozinha": [650, 400], "Sala de jantar e cozinha": [550, 400],
  "Estúdio": [600, 450], "Estúdio e cozinha": [650, 450], "Escadas": [200, 300], "Exterior": [500, 300], "Oficina": [800, 600],
};
/** Tamanho típico pelo nome; os botões do tipo de imóvel da casa têm prioridade (ex.: Escritório). */
function tamanho(nome, casa) {
  const base = nome.replace(/ \(piso \d+\)$/, "").replace(/ \d+$/, "");
  if (TAMANHOS[base]) return TAMANHOS[base];
  const t = [...tiposDivisaoPara(casa?.tipo), ...TIPOS_DIVISAO, ...TIPOS_DIVISAO_SERVICOS, ...TIPOS_DIVISAO_INDUSTRIAL].find((x) => x.nome === base);
  return t ? [t.w, t.h] : [400, 300];
}

const semAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Tipo de uma divisão pelo nome (também as que o cliente escreveu): sala, sala_cozinha, cozinha
 * (também a copa), quarto, wc (também instalações sanitárias e vestiários), corredor, entrada, escadas,
 * garagem (também arrumos), jardim (também exterior e cais), varanda, lavandaria, escritorio, despensa,
 * loja, rececao, montra, nave (oficina, fábrica), armazem ou outra.
 */
export function tipoDivisao(nome) {
  const s = semAcentos(nome);
  if (/cozinha/.test(s) && /sala|estudio/.test(s)) return "sala_cozinha";
  if (/^(cozinha|kitchenette|copa)/.test(s)) return "cozinha";
  if (/^(loja|sala aberta|restaurante)/.test(s)) return "loja";
  if (/^(sala|estudio|living)/.test(s)) return "sala";
  if (/^(quarto|suite)/.test(s)) return "quarto";
  if (/^(casa de banho|wc|banho|lavabo|instalacoes sanitarias|vestiario)/.test(s)) return "wc";
  if (/^(corredor|hall)/.test(s)) return "corredor";
  if (/^entrada/.test(s)) return "entrada";
  if (/^escada/.test(s)) return "escadas";
  if (/^(garagem|arrecadacao|arrumos)/.test(s)) return "garagem";
  if (/^(jardim|exterior|quintal|piscina|logradouro|cais)/.test(s)) return "jardim";
  if (/^(varanda|terraco|marquise)/.test(s)) return "varanda";
  if (/^lavandaria/.test(s)) return "lavandaria";
  if (/^escritorio/.test(s)) return "escritorio";
  if (/^despensa/.test(s)) return "despensa";
  if (/^rececao/.test(s)) return "rececao";
  if (/^montra/.test(s)) return "montra";
  if (/^(nave|oficina|fabrica)/.test(s)) return "nave";
  if (/^armazem/.test(s)) return "armazem";
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

/** Serviços e industrial: área (m²) e n.º de espaços típicos, e os espaços pela ordem em que se acrescentam. */
export const AREA_OMISSAO = { servicos: 80, industrial: 300 };
export const ESPACOS_OMISSAO = { servicos: 4, industrial: 5 };
const ESPACOS = {
  servicos: { principal: "Loja / sala aberta", outros: ["Instalações sanitárias", "Escritório", "Copa", "Arrumos", "Receção", "Montra"], mais: "Escritório" },
  industrial: { principal: "Nave / oficina", outros: ["Instalações sanitárias", "Escritório", "Armazém", "Vestiários", "Cais / exterior"], mais: "Oficina" },
};

// Área de cliente sem tipologia: a lista antiga pelo n.º de divisões (3 se não indicado).
const ORDEM_SEM_TIPOLOGIA = ["Sala", "Cozinha", "Quarto 1", "WC", "Quarto 2", "Corredor", "Quarto 3", "Casa de banho", "Escritório", "Entrada", "Lavandaria", "Garagem", "Varanda", "Despensa", "Exterior"];

/** Divide `n` coisas por `k` pisos (as primeiras levam mais). */
const repartir = (n, k) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
const inteiro = (v, [min, max], omissao) => Math.min(max, Math.max(min, Math.round(Number(v ?? omissao)) || 0));

/** Máquinas que precisam de um sítio exterior (tipos de divisão que servem); sem nenhum, acrescenta "Exterior". */
const PRECISA_EXTERIOR = {
  carregador_ve: ["garagem", "jardim"], carregador_ve_22: ["garagem", "jardim", "nave"], bomba: ["jardim"],
  rega: ["jardim"], iluminacao_jardim: ["jardim"], portao: ["garagem", "jardim"],
};

/**
 * Espaços de serviços e industrial: o principal (loja / sala aberta, nave / oficina) fica com a área
 * que sobra dos outros (tamanhos típicos), no mínimo 40 % da área e 15 m², na proporção 4 × 3.
 */
function espacosNegocio(c) {
  const perfil = perfilCasa(c.tipo);
  const e = ESPACOS[perfil];
  const n = inteiro(c.espacos, LIMITES_CASA.espacos, ESPACOS_OMISSAO[perfil]);
  const area = inteiro(c.area_m2, LIMITES_CASA.area_m2, AREA_OMISSAO[perfil]);
  const nomes = [e.principal, ...e.outros].slice(0, n);
  for (let k = 2; nomes.length < n; k++) nomes.push(`${e.mais} ${k}`);
  const outros = nomes.slice(1).reduce((s, x) => { const [w, h] = tamanho(x, c); return s + w * h; }, 0);
  const cm2 = Math.max(area * 1e4 * 0.4, area * 1e4 - outros, 15e4);
  const grelha = (v) => Math.max(ESCALA_CM * 4, Math.round(v / ESCALA_CM) * ESCALA_CM);
  const w = Math.min(MAX_LADO_CM - 2 * MARGEM, grelha(Math.sqrt((cm2 * 4) / 3)));
  const h = Math.min(MAX_LADO_CM - 2 * MARGEM, grelha(cm2 / w));
  return nomes.map((nome, i) => (i === 0 ? { nome, piso: 1, tamanho: [w, h] } : { nome, piso: 1 }));
}

/**
 * Divisões da casa (nome, piso e, no espaço principal de serviços/industrial, o tamanho), pela ordem
 * em que ficam na planta: "Entrada" (T1 e mais), salas, cozinha, corredor (T2 e mais: um por piso com
 * quartos), quartos, casas de banho, garagem, varanda, jardim. Com pisos > 1: piso 1 com a entrada,
 * salas, cozinha, a primeira casa de banho, garagem e jardim; quartos e as outras casas de banho
 * repartidos pelos pisos de cima; a varanda no último; "Escadas (piso N)" em cada um. Escritório,
 * lavandaria, despensa… acrescentam-se na planta (botões) ou no passo "Divisões".
 * `maquinas` (grandes e pequenas): as que precisam de exterior (carregador, bomba, rega, portão…)
 * sem garagem nem jardim acrescentam "Exterior".
 */
export function divisoesDaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  let r = [];
  const add = (nome, piso = 1) => r.push({ nome, piso });
  if (perfilCasa(c.tipo) !== "habitacao") {
    r = espacosNegocio(c);
  } else if (!c.tipologia) {
    const n = Math.min(MAX_DIVISOES, c.divisoes ?? 3);
    for (let i = 0; i < n; i++) add(ORDEM_SEM_TIPOLOGIA[i] ?? `Divisão ${i + 1}`);
  } else {
    const x = c.extras ?? {};
    const pisos = Math.min(4, Math.max(1, Math.round(Number(c.pisos) || 1)));
    const quartos = quartosDe(c);
    const cbs = Math.min(6, Math.max(1, Math.round(Number(c.casas_banho) || 1)));
    const salas = Math.min(4, Math.max(1, Math.round(Number(c.salas) || 1)));
    const cima = pisos - 1;
    if (quartos >= 1) add("Entrada");   // o estúdio (T0) não tem hall de entrada à parte
    if (c.tipologia === "T0") add(x.kitnet ? "Estúdio e cozinha" : "Estúdio");   // sala e quarto na mesma divisão
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
    let q = 0, b = 0, corredores = 0;
    const nomeCb = () => (cbs === 1 ? "Casa de banho" : `Casa de banho ${++b}`);
    for (let p = 1; p <= pisos; p++) {
      // Corredor (T2 e mais): um por piso com quartos.
      if (quartos >= 2 && qPiso[p - 1] > 0) add(++corredores === 1 ? "Corredor" : `Corredor ${corredores}`, p);
      for (let i = 0; i < qPiso[p - 1]; i++) add(`Quarto ${++q}`, p);
      for (let i = 0; i < bPiso[p - 1]; i++) add(nomeCb(), p);
      if (pisos > 1) add(`Escadas (piso ${p})`, p);
    }
    if (x.garagem) add("Garagem");
    if (x.varanda) add("Varanda", pisos);
    if (x.jardim) add("Jardim");
  }
  const tem = (tipos) => r.some((d) => tipos.includes(tipoDivisao(d.nome)));
  const lista = Array.isArray(maquinas) ? maquinas : [];
  if (lista.some((m) => PRECISA_EXTERIOR[m] && !tem(PRECISA_EXTERIOR[m]))) add("Exterior");
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
  loja: { janela: true, tomadas: 4 },
  rececao: { tomadas: 2 },
  montra: { janela: true, tomadas: 1 },
  nave: { janela: true, tomadas: 4 },
  armazem: { tomadas: 2 },
};

/**
 * Aparelhos por omissão de uma divisão retangular (nome → tipo; caixa em cm), em sítios plausíveis e
 * afastados uns dos outros (≥ 65 cm nas divisões de tamanho típico): porta na parede de baixo com o
 * interruptor ao lado, janela na parede oposta (a de cima), luz ao centro (divisões grandes: uma por
 * cada 20 m², até 8, em grelha), sensor de movimento no canto de cima à esquerda (vê a porta), tomadas
 * nas paredes (esquerda, direita, baixo à direita, cima à esquerda) e a televisão na parede da direita.
 * Ficam 10 cm para dentro das paredes: numa parede partilhada contam nesta divisão. Usada pelo editor
 * (botões por tipo) e por plantaDaCasa. Devolve elementos sem id.
 */
export function aparelhosOmissao(nome, { x_cm: x, y_cm: y, largura_cm: w, altura_cm: h }) {
  const extra = APARELHOS_TIPO[tipoDivisao(nome)] ?? {};
  const r = [];
  const add = (tipo, dx, dy, rot = 0, modelo) => r.push({ tipo, x_cm: Math.round(x + dx), y_cm: Math.round(y + dy), rot, divisao: null, props: propsOmissao(tipo, modelo) });
  const porta = Math.max(60, Math.round(w * 0.3));
  add("porta", porta, h - 10);
  // Interruptor ao lado da porta, do lado de fora da divisão (a luz fica ao centro, longe dele).
  add("interruptor", porta - 70 >= 40 ? porta - 70 : Math.min(porta + 70, w - 30), h - 10);
  const luzes = Math.min(MAX_LUZES, Math.max(1, Math.round((w * h) / (M2_POR_LUZ * 1e4))));
  const cols = Math.ceil(Math.sqrt((luzes * w) / h));
  const linhas = Math.ceil(luzes / cols);
  for (let i = 0; i < luzes; i++) add("luz", ((i % cols) + 0.5) * (w / cols), (Math.floor(i / cols) + 0.5) * (h / linhas));
  add("sensor_movimento", 40, 40);
  if (extra.janela) add("janela", w / 2, 10);
  const tomadas = [[10, h / 2, 90], [w - 10, h / 2, 90], [w - Math.max(40, w * 0.2), h - 10, 0], [Math.max(90, w * 0.2), 10, 0]];
  for (const [dx, dy, rot] of tomadas.slice(0, extra.tomadas ?? 0)) add("tomada", dx, dy, rot);
  if (extra.tv) add("maquina", w - 25, h * 0.25, 0, "televisao");
  return r;
}

/**
 * O que um botão de divisão traz (texto pequeno por baixo do nome): "porta, janela, luz, interruptor,
 * sensor, 2 tomadas, TV". `w`/`h`: o tamanho típico (as divisões grandes levam mais luzes).
 */
export function resumoAparelhos(nome, w = 400, h = 300) {
  const conta = {};
  for (const a of aparelhosOmissao(nome, { x_cm: 0, y_cm: 0, largura_cm: w, altura_cm: h })) {
    const k = a.tipo === "maquina" ? a.props.modelo : a.tipo;
    conta[k] = (conta[k] ?? 0) + 1;
  }
  const partes = [];
  const add = (k, um, varios) => { const n = conta[k] ?? 0; if (n) partes.push(n === 1 ? um : `${n} ${varios}`); };
  add("porta", "porta", "portas");
  add("janela", "janela", "janelas");
  add("luz", "luz", "luzes");
  add("interruptor", "interruptor", "interruptores");
  add("sensor_movimento", "sensor", "sensores");
  add("tomada", "1 tomada", "tomadas");
  add("televisao", "TV", "TV");
  return partes.join(", ");
}

/** Onde fica cada máquina (tipos de divisão por ordem de preferência; senão a primeira divisão). */
const COZINHA = ["cozinha", "sala_cozinha", "sala", "loja", "escritorio"];
const DESTINO = {
  placa: COZINHA, forno: COZINHA, maquina_loica: COZINHA,
  maquina_lavar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  maquina_secar: ["lavandaria", "cozinha", "sala_cozinha", "garagem", "sala"],
  // Termoacumulador: na cozinha (também a do estúdio com kitnet, "Estúdio e cozinha"), senão na garagem.
  termoacumulador: ["cozinha", "sala_cozinha", "garagem", "lavandaria", "wc", "sala"],
  ar_condicionado: ["sala", "sala_cozinha", "loja", "escritorio", "rececao", "nave"],
  carregador_ve: ["garagem", "jardim"],
  carregador_ve_22: ["garagem", "jardim", "nave"],
  bomba: ["jardim"],
  arca_frigorifica: ["loja", "cozinha", "armazem"],
  maquina_cafe: ["loja", "cozinha"],
  servidor: ["garagem", "escritorio", "rececao"],
  compressor: ["nave", "armazem", "garagem"],
  soldadura: ["nave", "garagem"],
  maquina_trifasica: ["nave", "armazem"],
  portao_industrial: ["nave", "armazem", "jardim"],
  frigorifico: COZINHA, micro_ondas: COZINHA, exaustor: COZINHA, cafeteira: COZINHA,
  arca_congeladora: ["despensa", "garagem", "lavandaria", "cozinha", "sala_cozinha"],
  televisao: ["sala", "sala_cozinha", "rececao", "loja", "quarto"],
  computador: ["escritorio", "rececao", "loja", "quarto", "sala", "sala_cozinha"],
  consola: ["sala", "sala_cozinha", "quarto"],
  desumidificador: ["quarto", "lavandaria", "sala", "sala_cozinha"],
  aquecedor_portatil: ["quarto", "escritorio", "sala", "sala_cozinha", "loja"],
  box_router: ["sala", "sala_cozinha", "escritorio", "rececao", "loja", "entrada"],
  repetidor_wifi: ["corredor", "entrada", "quarto"],
  nas: ["escritorio", "sala", "sala_cozinha"],
  camara: ["entrada", "jardim", "loja", "nave", "garagem", "corredor", "sala", "sala_cozinha"],
  portao: ["garagem", "jardim"],
  rega: ["jardim"],
  iluminacao_jardim: ["jardim"],
  aspirador_robo: ["sala", "sala_cozinha", "corredor"],
  impressora: ["escritorio", "rececao", "loja"],
  terminal_pagamento: ["loja", "rececao"],
  reclamo: ["montra", "loja"],
  ferramentas: ["nave", "armazem", "garagem"],
  aspirador_industrial: ["nave", "armazem"],
  carregador_baterias: ["nave", "armazem", "garagem"],
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
 * Planta já desenhada a partir da casa (§1.1, §2.1): as divisões de divisoesDaCasa pela ordem (ids d1,
 * d2…), em linhas até 15 m, cada piso num bloco abaixo do anterior, tamanhos típicos (o espaço principal
 * de serviços/industrial com o tamanho que a área dá), sem sobreposição; cada divisão com os aparelhos
 * habituais (aparelhosOmissao); cada máquina escolhida (grandes e pequenas) na divisão certa (DESTINO),
 * ao fundo; a televisão que a sala já leva não se repete.
 */
export function plantaDaCasa(casa, maquinas = []) {
  const p = plantaVazia();
  const itens = divisoesDaCasa(casa, maquinas).map((d) => ({ nome: d.nome, piso: d.piso ?? 1, tam: d.tamanho ?? tamanho(d.nome, casa) }));
  const pos = new Map();
  let y = MARGEM, maxX = 0;
  [...new Set(itens.map((z) => z.piso))].sort((a, b) => a - b).forEach((piso, k) => {
    if (k > 0) y += ENTRE_PISOS;
    let x = MARGEM, alturaLinha = 0;
    for (const it of itens.filter((z) => z.piso === piso)) {
      const [w, h] = it.tam;
      if (x > MARGEM && x + w > MARGEM + LARGURA_LINHA) { x = MARGEM; y += alturaLinha; alturaLinha = 0; }
      pos.set(it, [x, y]);
      x += w;
      maxX = Math.max(maxX, x);
      alturaLinha = Math.max(alturaLinha, h);
    }
    y += alturaLinha;
  });
  itens.forEach((it, i) => {
    const [x, yy] = pos.get(it);
    p.divisoes.push({ id: `d${i + 1}`, nome: it.nome, x_cm: x, y_cm: yy, largura_cm: it.tam[0], altura_cm: it.tam[1] });
  });
  const arred = (v) => Math.ceil(v / ESCALA_CM) * ESCALA_CM;
  p.largura_cm = Math.min(MAX_LADO_CM, Math.max(p.largura_cm, arred(maxX + MARGEM)));
  p.altura_cm = Math.min(MAX_LADO_CM, Math.max(p.altura_cm, arred(y + MARGEM)));
  let e = 0;
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
    jaPostas.add(modelo);
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

/** Resumo do que gera a lista de divisões da casa (para saber se a casa ou as máquinas mudaram depois). */
export function assinaturaCasa(casa, maquinas = []) {
  const c = casa ?? {};
  const x = c.extras ?? {};
  const perfil = perfilCasa(c.tipo);
  const negocio = perfil !== "habitacao";
  return JSON.stringify([
    perfil, negocio ? null : c.tipologia ?? null, negocio ? null : quartosDe(c), c.casas_banho, c.salas, c.pisos,
    !!x.jardim, !!x.garagem, !!x.varanda, !!x.kitnet,
    negocio ? c.area_m2 ?? null : null, negocio ? c.espacos ?? null : null, [...maquinas].sort(),
  ]);
}

/**
 * Objetivos → aparelhos por divisão (passo "Divisões"), sem tirar nada do que já lá está:
 * - alarme: sensor de porta na entrada (entrada, corredor, receção, loja, sala ou nave) se ainda não
 *   houver nenhum; sensor de movimento em cada sala, corredor, loja, receção, nave e armazém;
 * - estores: estores motorizados nas salas e quartos (com planta que tenha janelas: um por janela da divisão);
 * - luzes e horários de abertura: um interruptor inteligente em cada divisão interior que ainda não tenha;
 * - iluminação automática: um sensor de movimento em cada divisão interior que ainda não tenha.
 * `contagem`: contarPlanta() da planta (dá as janelas por divisão), ou null. Muda `divisoes`.
 */
export function aplicarObjetivos(divisoes, objetivos = [], contagem = null) {
  const quer = (k) => objetivos.includes(k);
  const tipo = (d) => tipoDivisao(d.nome);
  const interior = (d) => !["jardim", "varanda"].includes(tipo(d));
  const janelasDe = (d) => contagem?.find((c) => c.id && c.id === d.planta_id)?.janelas ?? 0;
  const plantaComJanelas = !!contagem?.some((c) => c.janelas > 0);
  if (quer("alarme")) {
    if (!divisoes.some((d) => d.sensores_porta > 0)) {
      const alvo = ["entrada", "corredor", "rececao", "loja", "sala", "sala_cozinha", "nave"].map((t) => divisoes.find((d) => tipo(d) === t)).find(Boolean) ?? divisoes[0];
      if (alvo) alvo.sensores_porta = 1;
    }
    for (const d of divisoes) if (["sala", "sala_cozinha", "corredor", "loja", "rececao", "nave", "armazem"].includes(tipo(d)) && !d.sensores_movimento) d.sensores_movimento = 1;
  }
  if (quer("estores")) {
    for (const d of divisoes) {
      if (!["sala", "sala_cozinha", "quarto"].includes(tipo(d)) || d.estores + d.estores_sem_motor > 0) continue;
      d.estores = plantaComJanelas ? janelasDe(d) : 1;
    }
  }
  if (quer("luzes") || quer("horarios")) {
    for (const d of divisoes) if (interior(d) && !d.interruptores.length) d.interruptores = [1];
  }
  if (quer("iluminacao_auto")) {
    for (const d of divisoes) if (interior(d) && !d.sensores_movimento) d.sensores_movimento = 1;
  }
  return divisoes;
}
