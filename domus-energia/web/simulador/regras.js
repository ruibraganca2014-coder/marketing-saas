// Simulador de orçamento — regras (docs/SIMULADOR-ORCAMENTO.md §2, §4).
// Só lógica, sem DOM: contagem a partir da planta, sugestão de circuitos e avisos.
// As regras elétricas são ORIENTATIVAS: a solução final é validada na visita técnica.

export const ESCALA_CM = 50;              // quadriculado da planta
export const MAX_DIVISOES = 40;
export const MAX_ELEMENTOS = 400;
export const MAX_LADO_CM = 10_000;
export const TENSAO = 230;
export const FRACAO_SEGURA = 0.8;         // 80 % de amperes × 230 V
export const MAX_PONTOS = 8;              // luzes ou tomadas por circuito
export const POTENCIA_DEDICADA = 2000;    // W: carga perigosa; frigorífico/outra máquina com circuito próprio
export const MAX_MODULOS = 12;            // módulos novos antes de ampliar o quadro
export const MODULOS_SY1 = 2;             // o SY1 (sem proteções) fica ao lado do disjuntor do circuito: +2 módulos
export const MAX_MONOFASICO_W = 7400;     // acima disto (≈ 32 A a 230 V) costuma ser trifásico
export const POTENCIA_CONTRATADA_W = 6900; // potência contratada comum (6,9 kVA) — quando o cliente não sabe
export const POTENCIAS_KVA = [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7]; // escalões da potência contratada
export const FASES = { mono: "Monofásica", tri: "Trifásica" };
export const TOLERANCIA_PORTA_CM = 30;    // porta/janela fora das divisões mas a ≤ 30 cm de uma: conta nela
export const AMPERES_MAX_INTELIGENTE = 63; // TONGOU SY1/SY2: até 63 A, 1P+N
export const AMPERES = [6, 10, 16, 20, 25, 32, 40];
export const AMPERES_MAQUINA = [16, 20, 25, 32, 40];
/** Máquinas que têm sempre circuito próprio, seja qual for a potência (as outras: ≥ 2000 W). A bomba fica no exterior: circuito próprio. */
export const MODELOS_DEDICADOS = [
  "maquina_lavar", "maquina_secar", "maquina_loica", "forno", "placa", "termoacumulador", "ar_condicionado", "bomba_calor", "carregador_ve", "bomba",
  // Serviços e industrial: frio comercial, café, servidor, oficina, portão e o carregador de 22 kW.
  "arca_frigorifica", "maquina_cafe", "servidor", "compressor", "soldadura", "maquina_trifasica", "portao_industrial", "carregador_ve_22",
];
// Placa e forno (RTIEBT C3): circuito de 25 A com cabo de 6 mm². A placa (7 200 W) nunca tira a potência
// toda ao mesmo tempo (simultaneidade): não entra na conta dos 80 %.
export const AMPERES_PLACA = 25;
export const AMPERES_VE = 40;             // carregador VE: carrega a 32 A e limita a própria corrente → disjuntor de 40 A
export const FIM_AVISO = " (orientativo — confirmamos na visita)";

export const TIPOS_CIRCUITO = {
  iluminacao: "Iluminação",
  tomadas: "Tomadas",
  maquina: "Máquina",
  misto: "Misto",
};

/** Tipos de imóvel, pela ordem dos botões do passo "A casa". */
export const TIPOS_CASA = {
  apartamento: "Apartamento",
  moradia: "Moradia",
  alojamento_local: "Alojamento local",
  servicos: "Serviços",
  industrial: "Industrial",
  outro: "Outro",
};
/** Serviços (loja, escritório, restaurante) e industrial (armazém, oficina, fábrica): percurso próprio (área e espaços). */
export const TIPOS_NEGOCIO = ["servicos", "industrial"];
/** Tipos com contador de pisos (os outros têm sempre 1). */
export const TIPOS_COM_PISOS = ["moradia", "alojamento_local", "outro"];
/** Perfil do imóvel: "servicos", "industrial" ou "habitacao" (os outros tipos, e sem tipo). */
export const perfilCasa = (tipo) => (TIPOS_NEGOCIO.includes(tipo) ? tipo : "habitacao");

/**
 * Passo "A casa": tipologia e contadores (o de quartos anda com a tipologia: 0 = T0, 1–4 = T1–T4,
 * 5 ou mais = T5+), extras; serviços e industrial: área e n.º de espaços.
 */
export const TIPOLOGIAS = ["T0", "T1", "T2", "T3", "T4", "T5+"];
export const LIMITES_CASA = {
  quartos: [0, 12], casas_banho: [1, 6], salas: [1, 4], pisos: [1, 4],
  espacos: [1, 30], area_m2: [10, 5000],
};
/** Tipologia que corresponde a um n.º de quartos (0 → T0 … 5 ou mais → T5+). */
export const tipologiaDeQuartos = (n) => (n >= 5 ? "T5+" : `T${Math.max(0, Math.round(n) || 0)}`);
export const EXTRAS_CASA = {
  jardim: "Jardim / exterior",
  garagem: "Garagem / arrecadação",
  varanda: "Varanda / terraço",
  kitnet: "Kitnet",
  entrada: "Entrada / hall",
  corredor: "Corredor",
  escritorio: "Escritório",
  lavandaria: "Lavandaria",
  despensa: "Despensa",
};

/**
 * Passo "O que quer": máquinas grandes (circuito próprio), máquinas pequenas (ficam no circuito das
 * tomadas; por grupos) e objetivos — cada perfil (habitação, serviços, industrial) tem as suas listas.
 * `MAQUINAS_QUER`, `PEQUENAS_QUER` e `OBJETIVOS` (todas as chaves) servem para validar.
 */
export const MAQUINAS_GRANDES = {
  habitacao: ["placa", "forno", "maquina_lavar", "maquina_loica", "maquina_secar", "termoacumulador", "ar_condicionado", "carregador_ve", "carregador_ve_22", "bomba"],
  servicos: ["ar_condicionado", "arca_frigorifica", "maquina_cafe", "forno", "placa", "maquina_loica", "termoacumulador", "servidor", "carregador_ve", "carregador_ve_22"],
  industrial: ["compressor", "soldadura", "maquina_trifasica", "portao_industrial", "ar_condicionado", "termoacumulador", "carregador_ve", "carregador_ve_22"],
};
export const MAQUINAS_PEQUENAS = {
  habitacao: [
    ["Cozinha", ["frigorifico", "arca_congeladora", "micro_ondas", "exaustor", "cafeteira"]],
    ["Sala e quartos", ["televisao", "computador", "consola", "desumidificador", "aquecedor_portatil"]],
    ["Telecomunicações", ["box_router", "repetidor_wifi", "nas", "camara"]],
    ["Exterior e outros", ["portao", "rega", "iluminacao_jardim", "aspirador_robo"]],
  ],
  servicos: [
    ["Loja e escritório", ["computador", "impressora", "terminal_pagamento", "televisao", "aquecedor_portatil", "reclamo"]],
    ["Copa", ["frigorifico", "micro_ondas", "cafeteira"]],
    ["Telecomunicações", ["box_router", "repetidor_wifi", "nas", "camara"]],
  ],
  industrial: [
    ["Oficina", ["ferramentas", "aspirador_industrial", "carregador_baterias"]],
    ["Escritório e vestiários", ["computador", "impressora", "micro_ondas", "frigorifico", "cafeteira"]],
    ["Telecomunicações e exterior", ["box_router", "repetidor_wifi", "camara", "iluminacao_jardim"]],
  ],
};
const unicos = (l) => [...new Set(l)];
export const MAQUINAS_QUER = unicos(Object.values(MAQUINAS_GRANDES).flat());
export const PEQUENAS_QUER = unicos(Object.values(MAQUINAS_PEQUENAS).flatMap((g) => g.flatMap(([, l]) => l)));
export const maquinasGrandesDe = (tipo) => MAQUINAS_GRANDES[perfilCasa(tipo)];
export const maquinasPequenasDe = (tipo) => MAQUINAS_PEQUENAS[perfilCasa(tipo)].flatMap(([, l]) => l);

export const OBJETIVOS = {
  poupar: "Poupar energia",
  alarme: "Alarme e segurança",
  estores: "Estores automáticos",
  luzes: "Luzes pelo telemóvel",
  distancia: "Controlar à distância (férias / alojamento local)",
  clima: "Aquecimento / ar condicionado",
  horarios: "Horários de abertura",
  iluminacao_auto: "Iluminação automática",
  energia: "Controlo de energia",
  desligar: "Desligar tudo ao fechar",
};
export const OBJETIVOS_PERFIL = {
  habitacao: ["poupar", "alarme", "estores", "luzes", "distancia", "clima"],
  servicos: ["horarios", "alarme", "iluminacao_auto", "energia", "desligar", "clima"],
  industrial: ["horarios", "alarme", "iluminacao_auto", "energia", "desligar"],
};
export const objetivosDe = (tipo) => OBJETIVOS_PERFIL[perfilCasa(tipo)];

/**
 * Ligação sugerida (o cliente pode mudar): industrial, carregador de 22 kW ou máquina trifásica →
 * trifásica; o resto monofásica; sem tipo (área de cliente) e sem essas máquinas → null (não sugere).
 */
export function sugerirFases(tipo, maquinas = []) {
  if (tipo === "industrial" || maquinas.includes("carregador_ve_22") || maquinas.includes("maquina_trifasica")) return "tri";
  return tipo ? "mono" : null;
}

/** Elementos da planta (§2): nome, se roda, propriedades por omissão. */
export const ELEMENTOS = {
  porta: { nome: "Porta", roda: true, props: { entrada: false } },
  janela: { nome: "Janela", roda: true, props: { estore: false, motorizado: false } },
  quadro: { nome: "Quadro elétrico", roda: false, props: {} },
  tomada: { nome: "Tomada", roda: true, props: { dupla: false } },
  luz: { nome: "Ponto de luz", roda: false, props: { brilho: false } },
  interruptor: { nome: "Interruptor", roda: true, props: { botoes: 1 } },
  maquina: { nome: "Máquina", roda: false, props: { modelo: "termoacumulador", potencia_w: 2000 } },
  sensor_porta: { nome: "Sensor de porta/janela", roda: false, props: {} },
  sensor_movimento: { nome: "Sensor de movimento", roda: false, props: {} },
  // Telecomunicações (ITED) — "brevemente": desenham-se, mas ficam fora do preço e dos circuitos.
  telecom_ati: { nome: "ATI (armário de telecomunicações)", roda: false, props: {}, telecom: true },
  telecom_rj45: { nome: "Tomada de dados (RJ45)", roda: true, props: {}, telecom: true },
  telecom_coaxial: { nome: "Tomada de TV (coaxial)", roda: true, props: {}, telecom: true },
  telecom_fibra: { nome: "Fibra ótica", roda: false, props: {}, telecom: true },
  telecom_wifi: { nome: "Ponto de acesso Wi-Fi", roda: false, props: {}, telecom: true },
};
export const TIPOS_ELEMENTO = Object.keys(ELEMENTOS);
export const TIPOS_TELECOM = TIPOS_ELEMENTO.filter((t) => ELEMENTOS[t].telecom);
export const ehTelecom = (tipo) => !!ELEMENTOS[tipo]?.telecom;
export const PROPS_PERMITIDAS = ["entrada", "estore", "motorizado", "dupla", "brilho", "botoes", "modelo", "potencia_w"];

/**
 * Máquinas: nome e potência típica (editável). As que não estão em MODELOS_DEDICADOS e têm menos de
 * 2000 W (as máquinas pequenas) ficam no circuito das tomadas e contam na potência dele.
 */
export const MODELOS = {
  termoacumulador: { nome: "Termoacumulador", w: 2000 },
  ar_condicionado: { nome: "Ar condicionado", w: 1500 },
  placa: { nome: "Placa de cozinha", w: 7200 },
  forno: { nome: "Forno", w: 2500 },
  maquina_lavar: { nome: "Máquina de lavar roupa", w: 2000 },
  maquina_secar: { nome: "Máquina de secar roupa", w: 2500 },
  maquina_loica: { nome: "Máquina de lavar loiça", w: 1800 },
  frigorifico: { nome: "Frigorífico", w: 150 },
  televisao: { nome: "Televisão", w: 150 },
  bomba_calor: { nome: "Bomba de calor", w: 3000 },
  carregador_ve: { nome: "Carregador de carro elétrico", w: 7400 },
  bomba: { nome: "Bomba (piscina/rega)", w: 1100 },
  // Máquinas grandes de serviços e industrial (circuito próprio).
  arca_frigorifica: { nome: "Arca / vitrine frigorífica", w: 800 },
  maquina_cafe: { nome: "Máquina de café profissional", w: 2800 },
  servidor: { nome: "Servidor / bastidor", w: 600 },
  compressor: { nome: "Compressor", w: 3000 },
  soldadura: { nome: "Máquina de soldar", w: 5000 },
  maquina_trifasica: { nome: "Máquina trifásica (torno, serra…)", w: 7500 },
  portao_industrial: { nome: "Portão industrial", w: 750 },
  carregador_ve_22: { nome: "Carregador de carro elétrico 22 kW (trifásico)", w: 22000 },
  // Máquinas pequenas (circuito das tomadas).
  arca_congeladora: { nome: "Arca congeladora", w: 150 },
  micro_ondas: { nome: "Micro-ondas", w: 1200 },
  exaustor: { nome: "Exaustor", w: 200 },
  cafeteira: { nome: "Cafeteira / chaleira", w: 1500 },
  computador: { nome: "Computador", w: 300 },
  consola: { nome: "Consola de jogos", w: 200 },
  desumidificador: { nome: "Desumidificador", w: 300 },
  aquecedor_portatil: { nome: "Aquecedor portátil", w: 1500 },
  box_router: { nome: "Box / router do operador", w: 20 },
  repetidor_wifi: { nome: "Repetidor Wi-Fi", w: 10 },
  nas: { nome: "NAS (discos em rede)", w: 40 },
  camara: { nome: "Câmara de vigilância", w: 10 },
  portao: { nome: "Portão automático", w: 300 },
  rega: { nome: "Rega automática (programador)", w: 20 },
  iluminacao_jardim: { nome: "Iluminação de jardim / exterior", w: 150 },
  aspirador_robo: { nome: "Aspirador robô", w: 40 },
  impressora: { nome: "Impressora", w: 500 },
  terminal_pagamento: { nome: "Caixa / terminal de pagamento", w: 50 },
  reclamo: { nome: "Reclamo luminoso", w: 150 },
  ferramentas: { nome: "Ferramentas elétricas portáteis", w: 1200 },
  aspirador_industrial: { nome: "Aspirador industrial", w: 1400 },
  carregador_baterias: { nome: "Carregador de baterias", w: 500 },
  outro: { nome: "Outra máquina", w: 1000 },
};

/**
 * Botões "Desenhar divisão" do passo 2: nome e tamanho quando se toca sem arrastar (cm).
 * `numerar`: o primeiro já leva número (Quarto 1, Quarto 2…); os outros só a partir do segundo (Sala, Sala 2).
 */
export const TIPOS_DIVISAO = [
  { nome: "Sala", w: 500, h: 400 },
  { nome: "Quarto", w: 350, h: 300, numerar: true },
  { nome: "Cozinha", w: 350, h: 300 },
  { nome: "Casa de banho", w: 250, h: 200 },
  { nome: "Corredor", w: 400, h: 150 },
  { nome: "Entrada", w: 200, h: 200 },
  { nome: "Escritório", w: 300, h: 300 },
  { nome: "Lavandaria", w: 200, h: 200 },
  { nome: "Despensa", w: 200, h: 150 },
  { nome: "Garagem", w: 500, h: 300 },
  { nome: "Varanda", w: 300, h: 150 },
  { nome: "Jardim", w: 600, h: 400 },
  { nome: "Outra", w: 400, h: 300 },
];
/** Tipos de espaço de serviços (loja, escritório, restaurante) e industrial (armazém, oficina, fábrica). */
export const TIPOS_DIVISAO_SERVICOS = [
  { nome: "Loja / sala aberta", w: 800, h: 600 },
  { nome: "Escritório", w: 300, h: 300 },
  { nome: "Receção", w: 300, h: 250 },
  { nome: "Copa", w: 300, h: 250 },
  { nome: "Instalações sanitárias", w: 250, h: 200 },
  { nome: "Arrumos", w: 250, h: 200 },
  { nome: "Montra", w: 400, h: 150 },
  { nome: "Outra", w: 400, h: 300 },
];
export const TIPOS_DIVISAO_INDUSTRIAL = [
  { nome: "Nave / oficina", w: 1500, h: 1000 },
  { nome: "Escritório", w: 400, h: 300 },
  { nome: "Armazém", w: 800, h: 600 },
  { nome: "Vestiários", w: 400, h: 300 },
  { nome: "Instalações sanitárias", w: 300, h: 250 },
  { nome: "Cais / exterior", w: 600, h: 400 },
  { nome: "Outra", w: 400, h: 300 },
];
/** Botões de divisão do editor para o tipo de imóvel. */
export const tiposDivisaoPara = (tipo) => ({ servicos: TIPOS_DIVISAO_SERVICOS, industrial: TIPOS_DIVISAO_INDUSTRIAL }[perfilCasa(tipo)] ?? TIPOS_DIVISAO);

export const NOMES_DIVISAO = [
  "Sala", "Cozinha", "Quarto 1", "Quarto 2", "Quarto 3", "WC", "Casa de banho", "Corredor", "Entrada", "Escritório", "Lavandaria", "Despensa", "Garagem", "Varanda", "Jardim", "Exterior",
  "Loja / sala aberta", "Receção", "Copa", "Instalações sanitárias", "Arrumos", "Montra", "Nave / oficina", "Armazém", "Vestiários", "Cais / exterior",
];

const nf = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
export const formatarW = (w) => `${nf.format(Math.round(w)).replace(/[\u00a0\u202f]/g, " ")} W`;
export const nomeModelo = (m) => MODELOS[m]?.nome ?? MODELOS.outro.nome;

/** Propriedades por omissão de um tipo de elemento (cópia nova). */
export function propsOmissao(tipo, modelo) {
  const p = { ...(ELEMENTOS[tipo]?.props ?? {}) };
  if (tipo === "maquina" && modelo && MODELOS[modelo]) { p.modelo = modelo; p.potencia_w = MODELOS[modelo].w; }
  return p;
}

// ------------------------------------------------------------ forma das divisões (§2.1)
// Uma divisão é um retângulo (x_cm, y_cm, largura_cm, altura_cm) ou, com `pontos`, um polígono
// [[x_cm, y_cm], ...] no sentido dos ponteiros do relógio no ecrã (y para baixo). A caixa
// envolvente fica sempre atualizada (compatibilidade com o painel e estados antigos).

export const MAX_CANTOS = 24;
export const MIN_CANTOS = 3;
export const AREA_MIN_CM2 = ESCALA_CM * ESCALA_CM;   // 0,25 m², a divisão mais pequena que se desenha

/** Cantos da divisão: `pontos` ou os 4 cantos do retângulo (sempre uma lista nova de pares). */
export function pontosDivisao(d) {
  if (Array.isArray(d?.pontos) && d.pontos.length >= MIN_CANTOS) return d.pontos.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
  const x = Number(d?.x_cm) || 0, y = Number(d?.y_cm) || 0, w = Number(d?.largura_cm) || 0, h = Number(d?.altura_cm) || 0;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** Área com sinal (fórmula do laço): positiva no sentido dos ponteiros do relógio no ecrã. */
export function areaAssinada(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
export const areaPoligono = (pts) => Math.abs(areaAssinada(pts));

/** Caixa envolvente {x_cm, y_cm, largura_cm, altura_cm}. */
export function caixaPontos(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x_cm: x, y_cm: y, largura_cm: Math.max(...xs) - x, altura_cm: Math.max(...ys) - y };
}

/** 4 cantos com paredes só horizontais/verticais (um retângulo "normal"). */
export function ehRetangulo(pts) {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    // Paredes alternadamente horizontais e verticais, sem comprimento zero.
    const h1 = a[1] === b[1] && a[0] !== b[0], v1 = a[0] === b[0] && a[1] !== b[1];
    const h2 = b[1] === c[1] && b[0] !== c[0], v2 = b[0] === c[0] && b[1] !== c[1];
    if (!((h1 && v2) || (v1 && h2))) return false;
  }
  return true;
}

/** Distância do ponto ao segmento a–b e a posição t (0–1) do ponto mais próximo. */
export function distanciaSegmento(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
  return { dist: Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)), t };
}

/** Ponto dentro do polígono (as paredes contam como dentro, como no retângulo). */
export function pontoEmPoligono(x, y, pts) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (distanciaSegmento(x, y, pts[j], pts[i]).dist < 0.5) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** 0 dentro; fora, a distância à parede mais próxima (cm). */
export function distanciaPoligono(x, y, pts) {
  if (pontoEmPoligono(x, y, pts)) return 0;
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) m = Math.min(m, distanciaSegmento(x, y, pts[i], pts[(i + 1) % pts.length]).dist);
  return m;
}

/** Duas paredes não vizinhas cruzam-se (ou tocam-se)? Polígono inválido. */
export function paredesCruzam(pts) {
  const n = pts.length;
  const lado = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const noSeg = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  const cruza = (p1, p2, p3, p4) => {
    const d1 = lado(p3, p4, p1), d2 = lado(p3, p4, p2), d3 = lado(p1, p2, p3), d4 = lado(p1, p2, p4);
    if (d1 !== d2 && d3 !== d4 && d1 && d2 && d3 && d4) return true;
    return (!d1 && noSeg(p3, p4, p1)) || (!d2 && noSeg(p3, p4, p2)) || (!d3 && noSeg(p1, p2, p3)) || (!d4 && noSeg(p1, p2, p4));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;   // paredes vizinhas partilham um canto
      if (cruza(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Cantos válidos para uma divisão: 3–24 pares de números, arredondados ao cm e dentro de
 * 0…L × 0…A (um canto fora da planta invalida a forma: não se corta), sem cantos repetidos
 * seguidos, sem paredes cruzadas, com área ≥ 0,25 m²; no sentido dos ponteiros do relógio no ecrã.
 * null se não servirem.
 */
export function validarPontos(v, L = MAX_LADO_CM, A = MAX_LADO_CM) {
  if (!Array.isArray(v) || v.length < MIN_CANTOS || v.length > MAX_CANTOS) return null;
  const pts = [];
  for (const q of v) {
    if (!Array.isArray(q) || q.length !== 2) return null;
    const x = Number(q[0]), y = Number(q[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const p = [Math.round(x), Math.round(y)];
    if (p[0] < 0 || p[0] > L || p[1] < 0 || p[1] > A) return null;
    const u = pts[pts.length - 1];
    if (!u || u[0] !== p[0] || u[1] !== p[1]) pts.push(p);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < MIN_CANTOS || areaPoligono(pts) < AREA_MIN_CM2 || paredesCruzam(pts)) return null;
  return areaAssinada(pts) < 0 ? pts.reverse() : pts;
}

/**
 * Muda a forma da divisão para os cantos dados (já validados): um retângulo "normal" fica sem
 * `pontos`; a caixa envolvente é sempre atualizada. Muda `d`.
 */
export function definirPontos(d, pts) {
  Object.assign(d, caixaPontos(pts));
  if (ehRetangulo(pts)) delete d.pontos;
  else d.pontos = pts.map((p) => [p[0], p[1]]);
  return d;
}

/** Um ponto dentro do polígono para o nome: o centróide, ou (forma em L/U) o meio da faixa mais larga. */
export function pontoInterior(pts) {
  const a = areaAssinada(pts);
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (a) { cx /= 6 * a; cy /= 6 * a; }
  if (a && pontoEmPoligono(cx, cy, pts)) return [cx, cy];
  const c = caixaPontos(pts);
  let melhor = [c.x_cm + c.largura_cm / 2, c.y_cm + c.altura_cm / 2], larg = -1;
  for (const f of [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]) {
    const y = c.y_cm + c.altura_cm * f;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > larg) { larg = xs[i + 1] - xs[i]; melhor = [(xs[i] + xs[i + 1]) / 2, y]; }
  }
  return melhor;
}

/** Id da divisão onde está o ponto (a última desenhada ganha, como no ecrã); null se fora. */
export function divisaoEm(planta, x, y) {
  let r = null;
  for (const d of planta.divisoes) {
    if (x < d.x_cm || x > d.x_cm + d.largura_cm || y < d.y_cm || y > d.y_cm + d.altura_cm) continue;
    if (!d.pontos || pontoEmPoligono(x, y, pontosDivisao(d))) r = d.id;
  }
  return r;
}

/** Elementos que ficam na parede: fora das divisões mas a ≤ 30 cm de uma contam na mais próxima. */
export const TIPOS_PAREDE = ["porta", "janela", "sensor_porta"];

/**
 * Divisão de um elemento: a que contém o centro (retângulo ou polígono); para portas, janelas e sensores de porta/janela
 * fora de todas, a mais próxima a ≤ 30 cm (paredes exteriores). O painel faz o mesmo
 * (painel/public/ecras/simulacao.js, divisaoDoElemento).
 */
export function divisaoDoElemento(planta, e) {
  const x = Number(e?.x_cm) || 0, y = Number(e?.y_cm) || 0;
  const dentro = divisaoEm(planta, x, y);
  if (dentro || !TIPOS_PAREDE.includes(e?.tipo)) return dentro;
  let r = null, melhor = TOLERANCIA_PORTA_CM;
  for (const d of planta.divisoes) {
    const dist = distanciaPoligono(x, y, pontosDivisao(d));
    if (dist <= melhor) { melhor = dist; r = d.id; }
  }
  return r;
}

/** Recalcula `divisao` de todos os elementos (pelo centro; portas/janelas até 30 cm fora). Muda a planta. */
export function atualizarDivisoes(planta) {
  for (const e of planta.elementos) e.divisao = divisaoDoElemento(planta, e);
  return planta;
}

export function plantaVazia() {
  return { escala_cm: ESCALA_CM, largura_cm: 2000, altura_cm: 1500, fundo: null, divisoes: [], elementos: [] };
}

export const plantaTemConteudo = (p) => !!p && (p.divisoes.length > 0 || p.elementos.length > 0 || !!p.fundo);

// ------------------------------------------------------------ contagem (§2)

const FORA = "__fora";

/**
 * Contagem por divisão. Devolve uma linha por divisão da planta (pela ordem) e,
 * se houver elementos fora de todas as divisões, uma linha "Fora das divisões".
 */
export function contarPlanta(planta) {
  const linhas = new Map();
  const nova = (id, nome) => ({
    id, nome, luzes: 0, luzes_regulaveis: 0, tomadas: 0, tomadas_duplas: 0, interruptores: [],
    janelas: 0, estores: 0, estores_sem_motor: 0, portas: 0, portas_entrada: 0,
    sensores_porta: 0, sensores_movimento: 0, quadros: 0, maquinas: [], portas_entrada_sem_sensor: 0, telecom: 0,
  });
  const usados = new Set();
  for (const d of planta.divisoes) linhas.set(d.id, nova(d.id, d.nome || "Divisão"));
  for (const e of planta.elementos) {
    const id = e.divisao && linhas.has(e.divisao) ? e.divisao : FORA;
    // Telecomunicações ("brevemente"): só se contam para mostrar; ficam fora dos circuitos e do preço.
    if (ehTelecom(e.tipo)) { if (id !== FORA) linhas.get(id).telecom++; continue; }
    if (!linhas.has(id)) linhas.set(id, nova(null, "Fora das divisões"));
    const l = linhas.get(id);
    const p = e.props || {};
    switch (e.tipo) {
      case "luz": l.luzes++; if (p.brilho) l.luzes_regulaveis++; break;
      case "tomada": l.tomadas++; if (p.dupla) l.tomadas_duplas++; break;
      case "interruptor": l.interruptores.push(limitar(Math.round(Number(p.botoes) || 1), 1, 4)); break;
      case "janela":
        l.janelas++;
        if (p.estore) { if (p.motorizado) l.estores++; else l.estores_sem_motor++; }
        break;
      case "porta": l.portas++; if (p.entrada) { l.portas_entrada++; if (!sensorPerto(e, planta.elementos, usados)) l.portas_entrada_sem_sensor++; } break;
      case "sensor_porta": l.sensores_porta++; break;
      case "sensor_movimento": l.sensores_movimento++; break;
      case "quadro": l.quadros++; break;
      case "maquina": l.maquinas.push({ modelo: MODELOS[p.modelo] ? p.modelo : "outro", potencia_w: potencia(p) }); break;
      default: break;
    }
  }
  return [...linhas.values()];
}

/**
 * Sensor de porta já desenhado a ≤ 1,5 m da porta (cada sensor conta para uma só porta):
 * a porta da rua com sensor não pede outro. O painel emparelha da mesma forma
 * (painel/public/ecras/simulacao.js, aparelhosDaSimulacao).
 */
export const DIST_SENSOR_CM = 150;
function sensorPerto(porta, elementos, usados) {
  let melhor = null, dist = DIST_SENSOR_CM;
  for (const s of elementos) {
    if (s.tipo !== "sensor_porta" || usados.has(s)) continue;
    const d = Math.hypot((Number(s.x_cm) || 0) - (Number(porta.x_cm) || 0), (Number(s.y_cm) || 0) - (Number(porta.y_cm) || 0));
    if (d <= dist) { dist = d; melhor = s; }
  }
  if (melhor) usados.add(melhor);
  return melhor;
}

const limitar = (n, a, b) => Math.min(b, Math.max(a, n));
const potencia = (p) => {
  const w = Number(p.potencia_w);
  return Number.isFinite(w) && w >= 0 ? Math.round(w) : (MODELOS[p.modelo]?.w ?? 0);
};

/** Linhas do passo "Divisões" a partir da contagem (porta da rua → sensor sugerido). */
export function divisoesDaContagem(contagem) {
  return contagem.map((c) => ({
    nome: c.nome,
    planta_id: c.id,
    interruptores: [...c.interruptores],
    estores: c.estores,
    estores_sem_motor: c.estores_sem_motor,
    sensores_porta: c.sensores_porta + c.portas_entrada_sem_sensor,
    sensores_movimento: c.sensores_movimento,
    luzes_regulaveis: c.luzes_regulaveis,
    tomadas_inteligentes: 0,
  }));
}

export function divisaoVazia(nome = "") {
  return { nome, planta_id: null, interruptores: [], estores: 0, estores_sem_motor: 0, sensores_porta: 0, sensores_movimento: 0, luzes_regulaveis: 0, tomadas_inteligentes: 0 };
}

// ------------------------------------------------------------ circuitos (§4)

/** Potência que a carga pode tirar a 80 % (W, inteiro: evita 1104,0000000000002). */
export const limiteW = (amperes) => Math.round(FRACAO_SEGURA * amperes * TENSAO);

/** Potência de uma máquina para as contas: número finito ≥ 0 (senão 0). */
export const watts = (m) => {
  const w = Number(m?.potencia_w);
  return Number.isFinite(w) && w > 0 ? w : 0;
};

/** Menor disjuntor (16/20/25/32/40 A) que aguenta a potência a 80 %; 40 A se nenhum chegar. */
export function amperesPara(w) {
  return AMPERES_MAQUINA.find((a) => w <= limiteW(a)) ?? AMPERES_MAQUINA[AMPERES_MAQUINA.length - 1];
}

/** A máquina tem circuito próprio? Pelo tipo (MODELOS_DEDICADOS); frigorífico e outra máquina: ≥ 2000 W. */
export const circuitoProprio = (m) => MODELOS_DEDICADOS.includes(m?.modelo) || watts(m) >= POTENCIA_DEDICADA;

/** Carga perigosa (≥ 2000 W): pede confirmação para ligar à distância. */
export const cargaPerigosa = (m) => watts(m) >= POTENCIA_DEDICADA;

/**
 * Disjuntor sugerido para o circuito próprio de uma máquina: placa 25 A e forno pelo menos 25 A (RTIEBT C3,
 * cabo de 6 mm²); carregador VE 40 A; resto pelos 80 %.
 */
const ehCarregador = (m) => m?.modelo === "carregador_ve" || m?.modelo === "carregador_ve_22";

export function amperesMaquina(m) {
  if (ehCarregador(m)) return AMPERES_VE;
  if (m?.modelo === "placa") return AMPERES_PLACA;
  if (m?.modelo === "forno") return Math.max(AMPERES_PLACA, amperesPara(watts(m)));
  return amperesPara(watts(m));
}

/**
 * Circuitos mínimos da RTIEBT (habitação; em serviços e industrial usamos o equivalente — §4):
 * C1 iluminação 10 A / 1,5 mm²; C2 tomadas 16 A / 2,5 mm²; C3 placa e forno 25 A / 6 mm²;
 * C4 máquinas de lavar e termoacumulador 16 A / 2,5 mm²; C5 tomadas das zonas húmidas (cozinha,
 * casas de banho, lavandaria) 16 A / 2,5 mm², sempre atrás de um diferencial de 30 mA.
 */
export const RTIEBT = {
  C1: "Iluminação",
  C2: "Tomadas",
  C3: "Placa e forno",
  C4: "Máquinas de lavar e termoacumulador",
  C5: "Tomadas de zonas húmidas",
};
const MODELOS_C3 = ["placa", "forno"];
const MODELOS_C4 = ["maquina_lavar", "maquina_secar", "maquina_loica", "termoacumulador"];
/** Código RTIEBT do circuito (C1–C5) pelo tipo, pela zona húmida e pelas máquinas; null para os outros (circuito próprio). */
export function codigoCircuito(c) {
  if (c?.tipo === "iluminacao") return "C1";
  if (c?.tipo === "tomadas") return c.zona_humida ? "C5" : "C2";
  const ms = c?.itens?.maquinas ?? [];
  if (c?.tipo === "maquina" && ms.length) {
    if (ms.every((m) => MODELOS_C3.includes(m.modelo))) return "C3";
    if (ms.every((m) => MODELOS_C4.includes(m.modelo))) return "C4";
  }
  return null;
}
/** Secção mínima do cabo (mm², cobre, em tubo) para o disjuntor do circuito. */
export const SECCOES_MM2 = { 6: 1.5, 10: 1.5, 16: 2.5, 20: 4, 25: 6, 32: 6, 40: 10 };
export const seccaoCabo = (amperes) => SECCOES_MM2[amperes] ?? null;
export const formatarMm2 = (s) => `${String(s).replace(".", ",")} mm²`;

/** Máquinas que não entram na conta dos 80 %: a placa (simultaneidade) e o carregador VE (limita a corrente). */
const semSobrecarga = (m) => m?.modelo === "placa" || ehCarregador(m);

/** Máquina acima de 7,4 kW (costuma ser trifásica). */
export const trifasica = (m) => watts(m) > MAX_MONOFASICO_W;

export function circuitoVazio(n, tipo = "misto") {
  return {
    n, amperes: tipo === "iluminacao" ? 10 : 16, tipo, nome: "", divisoes: [],
    itens: { luzes: 0, tomadas: 0, maquinas: [] }, inteligente: true, medir: true, zona_humida: false,
  };
}

/**
 * Agrupa "pontos" por divisão em circuitos de até 8, sem partir uma divisão
 * que caiba inteira num circuito novo. `peso` (W) não passa de `limite` por
 * circuito (máquinas pequenas nas tomadas: 80 % de 16 A), salvo um ponto sozinho.
 */
function agrupar(porDivisao, criar, somar, peso = () => 0, limite = Infinity) {
  const circuitos = [];
  let atual = null;
  const pesoDe = (l) => l.reduce((s, p) => s + peso(p), 0);
  for (const { nome, pontos } of porDivisao) {
    let i = 0;
    while (i < pontos.length) {
      const bloco = pontos.slice(i, i + MAX_PONTOS);
      if (!atual || atual._q + bloco.length > MAX_PONTOS || atual._w + pesoDe(bloco) > limite) {
        atual = criar(circuitos.length + 1);
        atual._q = 0;
        atual._w = 0;
        circuitos.push(atual);
      }
      // Um circuito novo leva sempre pelo menos um ponto (não há ciclo infinito).
      while (i < pontos.length && atual._q < MAX_PONTOS && (atual._q === 0 || atual._w + peso(pontos[i]) <= limite)) {
        somar(atual, pontos[i]);
        atual._q++;
        atual._w += peso(pontos[i]);
        i++;
      }
      if (!atual.divisoes.includes(nome)) atual.divisoes.push(nome);
    }
  }
  for (const c of circuitos) { delete c._q; delete c._w; }
  return circuitos;
}

/** Nomes pela ordem: um só → "Iluminação"; vários → "Iluminação 1", "Iluminação 2"… */
function nomear(circuitos, base) {
  circuitos.forEach((c, i) => { c.nome = circuitos.length === 1 ? base : `${base} ${i + 1}`; });
  return circuitos;
}

/**
 * Com `dividir` (T3 e mais; serviços e industrial grandes), agrupa à parte a zona de dia e a de noite
 * (quartos, casas de banho, corredor): uma avaria num circuito não deixa a casa toda sem luz/tomadas.
 * Se uma das zonas não tiver nada, parte a lista a meio (pela ordem das divisões).
 */
function porZonas(lista, fazer, dividir, noite) {
  if (!dividir || lista.length < 2) return fazer(lista);
  let a = lista.filter((x) => !noite(x.nome)), b = lista.filter((x) => noite(x.nome));
  if (!a.length || !b.length) { const m = Math.ceil(lista.length / 2); a = lista.slice(0, m); b = lista.slice(m); }
  return [...fazer(a), ...fazer(b)];
}

/**
 * Circuitos sugeridos a partir da contagem da planta (§4), pelos circuitos mínimos da RTIEBT (C1–C5):
 * iluminação (até 8 pontos por circuito de 10 A), tomadas (até 8 por circuito de 16 A, com as máquinas
 * pequenas até 80 %), tomadas das zonas húmidas à parte (C5), circuito próprio para cada máquina grande
 * (placa/forno C3 a 25 A, máquinas de lavar e termoacumulador C4).
 * @param {{fases?: "mono"|"tri"|null, humida?: (nome:string)=>boolean, noite?: (nome:string)=>boolean, dividir?: boolean}} [opcoes]
 *   `fases`: numa casa trifásica, a máquina > 7,4 kW fica na proteção trifásica que já tem (sem disjuntor
 *   inteligente, que é 1P+N); `humida`: divisão de zona húmida (as tomadas vão para C5); `noite` e `dividir`:
 *   T3 e mais — iluminação e tomadas repartidas pela zona de dia e de noite (pelo menos 2 de cada).
 */
export function sugerirCircuitos(contagem, opcoes = {}) {
  const humida = typeof opcoes.humida === "function" ? opcoes.humida : () => false;
  const noite = typeof opcoes.noite === "function" ? opcoes.noite : () => false;
  const luzes = nomear(porZonas(
    contagem.filter((c) => c.luzes > 0).map((c) => ({ nome: c.nome, pontos: Array(c.luzes).fill(1) })),
    (l) => agrupar(l, () => ({ ...circuitoVazio(0, "iluminacao") }), (c) => { c.itens.luzes++; }),
    opcoes.dividir, noite,
  ), "Iluminação");
  const pontosTomadas = contagem.map((c) => ({
    nome: c.nome,
    humida: humida(c.nome),
    pontos: [...Array(c.tomadas).fill({ t: "tomada" }), ...c.maquinas.filter((m) => !circuitoProprio(m)).map((m) => ({ t: "maquina", m }))],
  })).filter((x) => x.pontos.length > 0);
  const agruparTomadas = (l, zonaHumida) => agrupar(
    l,
    () => ({ ...circuitoVazio(0, "tomadas"), zona_humida: zonaHumida }),
    (c, p) => { if (p.t === "tomada") c.itens.tomadas++; else c.itens.maquinas.push({ ...p.m }); },
    (p) => (p.t === "maquina" ? watts(p.m) : 0),
    limiteW(16),
  );
  const tomadas = nomear(porZonas(pontosTomadas.filter((x) => !x.humida), (l) => agruparTomadas(l, false), opcoes.dividir, noite), "Tomadas");
  const humidas = nomear(agruparTomadas(pontosTomadas.filter((x) => x.humida), true), "Tomadas zonas húmidas");
  const maquinas = [];
  for (const c of contagem) {
    for (const m of c.maquinas.filter(circuitoProprio)) {
      const semInteligente = opcoes.fases === "tri" && trifasica(m);
      maquinas.push({
        ...circuitoVazio(0, "maquina"),
        ...(semInteligente ? { inteligente: false, medir: false } : {}),
        amperes: amperesMaquina(m),
        nome: `${nomeModelo(m.modelo)}, ${c.nome}`,
        divisoes: [c.nome],
        itens: { luzes: 0, tomadas: 0, maquinas: [{ ...m }] },
      });
    }
  }
  return numerar([...luzes, ...tomadas, ...humidas, ...maquinas]);
}

export function numerar(circuitos) {
  circuitos.forEach((c, i) => { c.n = i + 1; });
  return circuitos;
}

/**
 * Disjuntores inteligentes por modelo. `disjuntor` = SKU escolhido; "TONGOU-SY1-JWT" = sem proteções.
 * Circuitos só com "medir" levam sempre o SY1 (mais barato, também mede).
 * @returns {{total:number, sy2:number, sy1:number}}
 */
export function disjuntoresInteligentes(circuitos, disjuntor) {
  const intel = circuitos.filter((c) => c.inteligente || c.medir);
  const sy2 = disjuntor === SKU_SY1 ? 0 : intel.filter((c) => c.inteligente).length;
  return { total: intel.length, sy2, sy1: intel.length - sy2 };
}

// Módulos do quadro (o SY2 substitui o disjuntor do circuito; o SY1 fica ao lado, +2 módulos): quadro.js resumoQuadro.

const SKU_SY1 = "TONGOU-SY1-JWT";
const rotulo = (c) => `Circuito ${c.n}${c.nome ? ` (${c.nome})` : ""}`;
const aviso = (c, t) => `${rotulo(c)} — ${t}${FIM_AVISO}`;
const kva = (v) => `${String(v).replace(".", ",")} kVA`;

/**
 * Avisos simples, sem bloquear (§4). Todos terminam em "(orientativo — confirmamos na visita)".
 * @param {{fases?: "mono"|"tri"|null}} [opcoes] ligação da casa (muda o texto do aviso trifásico)
 */
export function avisosCircuito(c, opcoes = {}) {
  const r = [];
  const maqs = c.itens?.maquinas ?? [];
  // A placa e o carregador VE não entram na conta dos 80 % (simultaneidade / limita a corrente).
  const soma = maqs.filter((m) => !semSobrecarga(m)).reduce((s, m) => s + watts(m), 0);
  const amperes = Number(c.amperes);
  if (Number.isFinite(amperes) && amperes > 0 && soma > limiteW(amperes)) {
    r.push(aviso(c, `Este circuito pode não aguentar: ${formatarW(soma)} para um disjuntor de ${c.amperes} A.`));
  }
  const luzes = c.itens?.luzes ?? 0;
  const tomadas = c.itens?.tomadas ?? 0;
  if (luzes > MAX_PONTOS) r.push(aviso(c, `Tem ${luzes} pontos de luz: o recomendado é até ${MAX_PONTOS} por circuito.`));
  if (tomadas > MAX_PONTOS) r.push(aviso(c, `Tem ${tomadas} tomadas: o recomendado é até ${MAX_PONTOS} por circuito.`));
  if (c.tipo === "iluminacao" && c.amperes !== 10) r.push(aviso(c, "Para iluminação sugerimos um disjuntor de 10 A."));
  if (c.tipo === "tomadas" && c.amperes !== 16) r.push(aviso(c, "Para tomadas sugerimos um disjuntor de 16 A."));
  if (codigoCircuito(c) === "C3" && Number.isFinite(amperes) && amperes < AMPERES_PLACA) {
    r.push(aviso(c, `A RTIEBT pede para a placa e o forno um circuito de ${AMPERES_PLACA} A com cabo de ${formatarMm2(seccaoCabo(AMPERES_PLACA))}.`));
  }
  const proprias = maqs.filter(circuitoProprio);
  const partilhado = luzes + tomadas > 0 || maqs.length > 1;
  if (partilhado) {
    for (const m of proprias) r.push(aviso(c, `${nomeModelo(m.modelo)} (${formatarW(watts(m))}) deve ter um circuito próprio.`));
  }
  if (maqs.some(ehCarregador) && Number.isFinite(amperes) && amperes > 0 && amperes < AMPERES_VE) {
    r.push(aviso(c, `O carregador do carro elétrico carrega a 32 A: precisa de um disjuntor de ${AMPERES_VE} A (tem ${c.amperes} A).`));
  }
  for (const m of maqs.filter(trifasica)) {
    r.push(aviso(c, opcoes.fases === "tri"
      ? `${nomeModelo(m.modelo)} (${formatarW(watts(m))}): os disjuntores inteligentes são monofásicos (1P+N), por isso esta máquina trifásica fica na proteção trifásica que já tem, sem disjuntor inteligente.`
      : `${nomeModelo(m.modelo)} (${formatarW(watts(m))}): acima de 7,4 kW costuma ser preciso ligação trifásica, e os disjuntores inteligentes são monofásicos (1P+N).`));
  }
  if ((c.inteligente || c.medir) && amperes > AMPERES_MAX_INTELIGENTE) {
    r.push(aviso(c, `Os disjuntores inteligentes vão até ${AMPERES_MAX_INTELIGENTE} A: um circuito de ${amperes} A precisa de outra solução.`));
  }
  if (c.inteligente) {
    for (const m of maqs.filter(cargaPerigosa)) {
      r.push(aviso(c, `Carga perigosa: ${nomeModelo(m.modelo)} (${formatarW(watts(m))}). Na app, ligar à distância pede sempre confirmação.`));
    }
  }
  return r;
}

/**
 * Todos os avisos do quadro: os de cada circuito, a ampliação do quadro (> 12 módulos novos),
 * a potência contratada e o lembrete das proteções (o SY2 substitui o disjuntor do circuito,
 * o SY1 não; diferencial de 30 mA).
 * @param {{disjuntor?: string, fases?: "mono"|"tri"|null, potencia_contratada_kva?: number|null, quadro_novo?: "atual"|"novo"|null}} [opcoes]
 *   `quadro_novo` definido (passo do quadro, quadro.js): a ampliação e a potência passam a ser avisadas por avisosProtecoes.
 */
export function avisosQuadro(circuitos, opcoes = {}) {
  const r = circuitos.flatMap((c) => avisosCircuito(c, opcoes));
  const d = disjuntoresInteligentes(circuitos, opcoes.disjuntor);
  const m = d.sy1 * MODULOS_SY1;
  // Com o passo do quadro (quadro.js) a ampliação e o tamanho do quadro vêm de lá (`quadro_novo` definido).
  if (m > MAX_MODULOS && opcoes.quadro_novo === undefined) r.push(`Os disjuntores TONGOU-SY1-JWT ficam ao lado dos disjuntores dos circuitos: são ${m} módulos novos no quadro e acrescentámos a ampliação do quadro.${FIM_AVISO}`);
  const total = circuitos.reduce((s, c) => s + (c.itens?.maquinas ?? []).reduce((t, x) => t + watts(x), 0), 0);
  const contratada = POTENCIAS_KVA.includes(opcoes.potencia_contratada_kva) ? opcoes.potencia_contratada_kva : null;
  const limite = contratada === null ? POTENCIA_CONTRATADA_W : Math.round(contratada * 1000);
  // Com o passo do quadro (quadro.js) a potência vem da potência sugerida (com simultaneidade).
  if (total > limite && opcoes.quadro_novo === undefined) {
    r.push(`As máquinas somam ${formatarW(total)}: se funcionarem ao mesmo tempo podem passar a potência contratada ${contratada === null ? "(costuma ser 6,9 kVA)" : `de ${kva(contratada)}`}. Confirmamos a potência do contador.${FIM_AVISO}`);
  }
  if (d.total > 0) {
    const partes = [];
    if (d.sy2) partes.push("O disjuntor inteligente substitui o disjuntor do circuito; só o fazemos se o modelo tiver certificação europeia de proteção (EN 60898) — confirmamos na visita.");
    if (d.sy1) partes.push(`O disjuntor TONGOU-SY1-JWT não tem proteções: nunca substitui o disjuntor do circuito, que fica no quadro${d.sy2 ? " (nos circuitos só com medição)" : ""}.`);
    partes.push("A instalação tem de ter diferencial de 30 mA.");
    r.push(`${partes.join(" ")}${FIM_AVISO}`);
  }
  return r;
}
