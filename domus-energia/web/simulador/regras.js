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
/** Máquinas que têm sempre circuito próprio, seja qual for a potência (as outras: ≥ 2000 W). */
export const MODELOS_DEDICADOS = ["maquina_lavar", "maquina_secar", "maquina_loica", "forno", "placa", "termoacumulador", "ar_condicionado", "bomba_calor", "carregador_ve"];
export const AMPERES_PLACA = 32;          // placa: nunca tira a potência toda ao mesmo tempo (simultaneidade)
export const AMPERES_VE = 40;             // carregador VE: carrega a 32 A e limita a própria corrente → disjuntor de 40 A
export const FIM_AVISO = " (orientativo — confirmamos na visita)";

export const TIPOS_CIRCUITO = {
  iluminacao: "Iluminação",
  tomadas: "Tomadas",
  maquina: "Máquina",
  misto: "Misto",
};

export const TIPOS_CASA = {
  moradia: "Moradia",
  apartamento: "Apartamento",
  alojamento_local: "Alojamento local",
  outro: "Outro",
};

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
};
export const TIPOS_ELEMENTO = Object.keys(ELEMENTOS);
export const PROPS_PERMITIDAS = ["entrada", "estore", "motorizado", "dupla", "brilho", "botoes", "modelo", "potencia_w"];

/** Máquinas: nome e potência típica (editável). */
export const MODELOS = {
  termoacumulador: { nome: "Termoacumulador", w: 2000 },
  ar_condicionado: { nome: "Ar condicionado", w: 1500 },
  placa: { nome: "Placa de cozinha", w: 7200 },
  forno: { nome: "Forno", w: 2500 },
  maquina_lavar: { nome: "Máquina de lavar roupa", w: 2000 },
  maquina_secar: { nome: "Máquina de secar roupa", w: 2500 },
  maquina_loica: { nome: "Máquina de lavar loiça", w: 1800 },
  frigorifico: { nome: "Frigorífico", w: 150 },
  bomba_calor: { nome: "Bomba de calor", w: 3000 },
  carregador_ve: { nome: "Carregador de carro elétrico", w: 7400 },
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
  { nome: "Garagem", w: 500, h: 300 },
  { nome: "Varanda", w: 300, h: 150 },
  { nome: "Outra", w: 400, h: 300 },
];

export const NOMES_DIVISAO = ["Sala", "Cozinha", "Quarto 1", "Quarto 2", "Quarto 3", "WC", "Casa de banho", "Corredor", "Entrada", "Escritório", "Lavandaria", "Despensa", "Garagem", "Varanda", "Exterior"];

const nf = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
export const formatarW = (w) => `${nf.format(Math.round(w)).replace(/[\u00a0\u202f]/g, " ")} W`;
export const nomeModelo = (m) => MODELOS[m]?.nome ?? MODELOS.outro.nome;

/** Propriedades por omissão de um tipo de elemento (cópia nova). */
export function propsOmissao(tipo, modelo) {
  const p = { ...(ELEMENTOS[tipo]?.props ?? {}) };
  if (tipo === "maquina" && modelo && MODELOS[modelo]) { p.modelo = modelo; p.potencia_w = MODELOS[modelo].w; }
  return p;
}

/** Id da divisão onde está o ponto (a última desenhada ganha, como no ecrã); null se fora. */
export function divisaoEm(planta, x, y) {
  let r = null;
  for (const d of planta.divisoes) {
    if (x >= d.x_cm && x <= d.x_cm + d.largura_cm && y >= d.y_cm && y <= d.y_cm + d.altura_cm) r = d.id;
  }
  return r;
}

/** Elementos que ficam na parede: fora das divisões mas a ≤ 30 cm de uma contam na mais próxima. */
export const TIPOS_PAREDE = ["porta", "janela", "sensor_porta"];

/**
 * Divisão de um elemento: a que contém o centro; para portas, janelas e sensores de porta/janela
 * fora de todas, a mais próxima a ≤ 30 cm (paredes exteriores). O painel faz o mesmo
 * (painel/public/ecras/simulacao.js, divisaoDoElemento).
 */
export function divisaoDoElemento(planta, e) {
  const x = Number(e?.x_cm) || 0, y = Number(e?.y_cm) || 0;
  const dentro = divisaoEm(planta, x, y);
  if (dentro || !TIPOS_PAREDE.includes(e?.tipo)) return dentro;
  let r = null, melhor = TOLERANCIA_PORTA_CM;
  for (const d of planta.divisoes) {
    const dx = Math.max(d.x_cm - x, 0, x - (d.x_cm + d.largura_cm));
    const dy = Math.max(d.y_cm - y, 0, y - (d.y_cm + d.altura_cm));
    const dist = Math.hypot(dx, dy);
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
    sensores_porta: 0, sensores_movimento: 0, quadros: 0, maquinas: [], portas_entrada_sem_sensor: 0,
  });
  const usados = new Set();
  for (const d of planta.divisoes) linhas.set(d.id, nova(d.id, d.nome || "Divisão"));
  for (const e of planta.elementos) {
    const id = e.divisao && linhas.has(e.divisao) ? e.divisao : FORA;
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

/** Disjuntor sugerido para o circuito próprio de uma máquina: placa até 32 A; carregador VE 40 A; resto pelos 80 %. */
export function amperesMaquina(m) {
  if (m?.modelo === "carregador_ve") return AMPERES_VE;
  if (m?.modelo === "placa") return Math.min(AMPERES_PLACA, amperesPara(watts(m)));
  return amperesPara(watts(m));
}

/** Máquinas que não entram na conta dos 80 %: a placa (simultaneidade) e o carregador VE (limita a corrente). */
const semSobrecarga = (m) => m?.modelo === "placa" || m?.modelo === "carregador_ve";

/** Máquina acima de 7,4 kW (costuma ser trifásica). */
export const trifasica = (m) => watts(m) > MAX_MONOFASICO_W;

export function circuitoVazio(n, tipo = "misto") {
  return {
    n, amperes: tipo === "iluminacao" ? 10 : 16, tipo, nome: "", divisoes: [],
    itens: { luzes: 0, tomadas: 0, maquinas: [] }, inteligente: true, medir: true,
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

/**
 * Circuitos sugeridos a partir da contagem da planta (§4).
 * @param {{fases?: "mono"|"tri"|null}} [opcoes] numa casa trifásica, a máquina > 7,4 kW fica na
 *   proteção trifásica que já tem (sem disjuntor inteligente, que é 1P+N).
 */
export function sugerirCircuitos(contagem, opcoes = {}) {
  const luzes = agrupar(
    contagem.filter((c) => c.luzes > 0).map((c) => ({ nome: c.nome, pontos: Array(c.luzes).fill(1) })),
    (i) => ({ ...circuitoVazio(0, "iluminacao"), nome: `Iluminação ${i}` }),
    (c) => { c.itens.luzes++; },
  );
  const tomadas = agrupar(
    contagem.map((c) => ({
      nome: c.nome,
      pontos: [...Array(c.tomadas).fill({ t: "tomada" }), ...c.maquinas.filter((m) => !circuitoProprio(m)).map((m) => ({ t: "maquina", m }))],
    })).filter((x) => x.pontos.length > 0),
    (i) => ({ ...circuitoVazio(0, "tomadas"), nome: `Tomadas ${i}` }),
    (c, p) => { if (p.t === "tomada") c.itens.tomadas++; else c.itens.maquinas.push({ ...p.m }); },
    (p) => (p.t === "maquina" ? watts(p.m) : 0),
    limiteW(16),
  );
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
  if (luzes.length === 1) luzes[0].nome = "Iluminação";
  if (tomadas.length === 1) tomadas[0].nome = "Tomadas";
  return numerar([...luzes, ...tomadas, ...maquinas]);
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

/**
 * Módulos novos no quadro (decisão do dono): o SY2 (com proteções) SUBSTITUI o disjuntor do
 * circuito → 0 módulos; o SY1 (sem proteções) nunca o substitui → fica ao lado, +2 módulos.
 */
export const modulosNovos = (circuitos, disjuntor) => disjuntoresInteligentes(circuitos, disjuntor).sy1 * MODULOS_SY1;

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
  const proprias = maqs.filter(circuitoProprio);
  const partilhado = luzes + tomadas > 0 || maqs.length > 1;
  if (partilhado) {
    for (const m of proprias) r.push(aviso(c, `${nomeModelo(m.modelo)} (${formatarW(watts(m))}) deve ter um circuito próprio.`));
  }
  if (maqs.some((m) => m.modelo === "carregador_ve") && Number.isFinite(amperes) && amperes > 0 && amperes < AMPERES_VE) {
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
 * @param {{disjuntor?: string, fases?: "mono"|"tri"|null, potencia_contratada_kva?: number|null}} [opcoes]
 */
export function avisosQuadro(circuitos, opcoes = {}) {
  const r = circuitos.flatMap((c) => avisosCircuito(c, opcoes));
  const d = disjuntoresInteligentes(circuitos, opcoes.disjuntor);
  const m = d.sy1 * MODULOS_SY1;
  if (m > MAX_MODULOS) r.push(`Os disjuntores TONGOU-SY1-JWT ficam ao lado dos disjuntores dos circuitos: são ${m} módulos novos no quadro e acrescentámos a ampliação do quadro.${FIM_AVISO}`);
  const total = circuitos.reduce((s, c) => s + (c.itens?.maquinas ?? []).reduce((t, x) => t + watts(x), 0), 0);
  const contratada = POTENCIAS_KVA.includes(opcoes.potencia_contratada_kva) ? opcoes.potencia_contratada_kva : null;
  const limite = contratada === null ? POTENCIA_CONTRATADA_W : Math.round(contratada * 1000);
  if (total > limite) {
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
