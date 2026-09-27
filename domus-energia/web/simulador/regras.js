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
export const POTENCIA_DEDICADA = 2000;    // W: máquina com circuito próprio / carga perigosa
export const MAX_MODULOS = 12;            // módulos novos antes de ampliar o quadro
export const AMPERES = [6, 10, 16, 20, 25, 32, 40];
export const AMPERES_MAQUINA = [16, 20, 25, 32, 40];
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
  placa: { nome: "Placa de cozinha", w: 3500 },
  forno: { nome: "Forno", w: 2500 },
  maquina_lavar: { nome: "Máquina de lavar roupa", w: 2000 },
  maquina_secar: { nome: "Máquina de secar roupa", w: 2500 },
  maquina_loica: { nome: "Máquina de lavar loiça", w: 1800 },
  frigorifico: { nome: "Frigorífico", w: 150 },
  bomba_calor: { nome: "Bomba de calor", w: 3000 },
  carregador_ve: { nome: "Carregador de carro elétrico", w: 7400 },
  outro: { nome: "Outra máquina", w: 1000 },
};

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

/** Recalcula `divisao` de todos os elementos (pelo centro). Muda a planta. */
export function atualizarDivisoes(planta) {
  for (const e of planta.elementos) e.divisao = divisaoEm(planta, e.x_cm, e.y_cm);
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
    sensores_porta: 0, sensores_movimento: 0, quadros: 0, maquinas: [],
  });
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
      case "porta": l.portas++; if (p.entrada) l.portas_entrada++; break;
      case "sensor_porta": l.sensores_porta++; break;
      case "sensor_movimento": l.sensores_movimento++; break;
      case "quadro": l.quadros++; break;
      case "maquina": l.maquinas.push({ modelo: MODELOS[p.modelo] ? p.modelo : "outro", potencia_w: potencia(p) }); break;
      default: break;
    }
  }
  return [...linhas.values()];
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
    sensores_porta: c.sensores_porta + c.portas_entrada,
    sensores_movimento: c.sensores_movimento,
    luzes_regulaveis: c.luzes_regulaveis,
    tomadas_inteligentes: 0,
  }));
}

export function divisaoVazia(nome = "") {
  return { nome, planta_id: null, interruptores: [], estores: 0, estores_sem_motor: 0, sensores_porta: 0, sensores_movimento: 0, luzes_regulaveis: 0, tomadas_inteligentes: 0 };
}

// ------------------------------------------------------------ circuitos (§4)

/** Menor disjuntor (16/20/25/32/40 A) que aguenta a potência a 80 %; 40 A se nenhum chegar. */
export function amperesPara(w) {
  return AMPERES_MAQUINA.find((a) => w <= FRACAO_SEGURA * a * TENSAO) ?? AMPERES_MAQUINA[AMPERES_MAQUINA.length - 1];
}

export function circuitoVazio(n, tipo = "misto") {
  return {
    n, amperes: tipo === "iluminacao" ? 10 : 16, tipo, nome: "", divisoes: [],
    itens: { luzes: 0, tomadas: 0, maquinas: [] }, inteligente: true, medir: true,
  };
}

/**
 * Agrupa "pontos" por divisão em circuitos de até 8, sem partir uma divisão
 * que caiba inteira num circuito novo.
 */
function agrupar(porDivisao, criar, somar) {
  const circuitos = [];
  let atual = null;
  for (const { nome, pontos } of porDivisao) {
    let i = 0;
    while (i < pontos.length) {
      const resto = pontos.length - i;
      if (!atual || atual._q + Math.min(resto, MAX_PONTOS) > MAX_PONTOS) {
        atual = criar(circuitos.length + 1);
        atual._q = 0;
        circuitos.push(atual);
      }
      const tira = Math.min(resto, MAX_PONTOS - atual._q);
      for (const p of pontos.slice(i, i + tira)) somar(atual, p);
      atual._q += tira;
      if (!atual.divisoes.includes(nome)) atual.divisoes.push(nome);
      i += tira;
    }
  }
  for (const c of circuitos) delete c._q;
  return circuitos;
}

/** Circuitos sugeridos a partir da contagem da planta (§4). */
export function sugerirCircuitos(contagem) {
  const luzes = agrupar(
    contagem.filter((c) => c.luzes > 0).map((c) => ({ nome: c.nome, pontos: Array(c.luzes).fill(1) })),
    (i) => ({ ...circuitoVazio(0, "iluminacao"), nome: `Iluminação ${i}` }),
    (c) => { c.itens.luzes++; },
  );
  const tomadas = agrupar(
    contagem.map((c) => ({
      nome: c.nome,
      pontos: [...Array(c.tomadas).fill({ t: "tomada" }), ...c.maquinas.filter((m) => m.potencia_w < POTENCIA_DEDICADA).map((m) => ({ t: "maquina", m }))],
    })).filter((x) => x.pontos.length > 0),
    (i) => ({ ...circuitoVazio(0, "tomadas"), nome: `Tomadas ${i}` }),
    (c, p) => { if (p.t === "tomada") c.itens.tomadas++; else c.itens.maquinas.push({ ...p.m }); },
  );
  const maquinas = [];
  for (const c of contagem) {
    for (const m of c.maquinas.filter((x) => x.potencia_w >= POTENCIA_DEDICADA)) {
      maquinas.push({
        ...circuitoVazio(0, "maquina"),
        amperes: amperesPara(m.potencia_w),
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

/** N.º de disjuntores inteligentes (= módulos novos no quadro). */
export const modulosNovos = (circuitos) => circuitos.filter((c) => c.inteligente || c.medir).length;

const rotulo = (c) => `Circuito ${c.n}${c.nome ? ` (${c.nome})` : ""}`;
const aviso = (c, t) => `${rotulo(c)} — ${t}${FIM_AVISO}`;

/** Avisos simples, sem bloquear (§4). Todos terminam em "(orientativo — confirmamos na visita)". */
export function avisosCircuito(c) {
  const r = [];
  const maqs = c.itens?.maquinas ?? [];
  const soma = maqs.reduce((s, m) => s + (Number(m.potencia_w) || 0), 0);
  if (soma > FRACAO_SEGURA * c.amperes * TENSAO) {
    r.push(aviso(c, `Este circuito pode não aguentar: ${formatarW(soma)} para um disjuntor de ${c.amperes} A.`));
  }
  const luzes = c.itens?.luzes ?? 0;
  const tomadas = c.itens?.tomadas ?? 0;
  if (luzes > MAX_PONTOS) r.push(aviso(c, `Tem ${luzes} pontos de luz: o recomendado é até ${MAX_PONTOS} por circuito.`));
  if (tomadas > MAX_PONTOS) r.push(aviso(c, `Tem ${tomadas} tomadas: o recomendado é até ${MAX_PONTOS} por circuito.`));
  if (c.tipo === "iluminacao" && c.amperes !== 10) r.push(aviso(c, "Para iluminação sugerimos um disjuntor de 10 A."));
  if (c.tipo === "tomadas" && c.amperes !== 16) r.push(aviso(c, "Para tomadas sugerimos um disjuntor de 16 A."));
  const grandes = maqs.filter((m) => (Number(m.potencia_w) || 0) >= POTENCIA_DEDICADA);
  const partilhado = luzes + tomadas > 0 || maqs.length > 1;
  if (partilhado) {
    for (const m of grandes) r.push(aviso(c, `${nomeModelo(m.modelo)} (${formatarW(m.potencia_w)}) deve ter um circuito próprio.`));
  }
  if (c.inteligente) {
    for (const m of grandes) {
      r.push(aviso(c, `Carga perigosa: ${nomeModelo(m.modelo)} (${formatarW(m.potencia_w)}). Na app, ligar à distância pede sempre confirmação.`));
    }
  }
  return r;
}

/** Todos os avisos do quadro, incluindo a ampliação do quadro (> 12 módulos). */
export function avisosQuadro(circuitos) {
  const r = circuitos.flatMap(avisosCircuito);
  const m = modulosNovos(circuitos);
  if (m > MAX_MODULOS) r.push(`São ${m} disjuntores inteligentes novos no quadro: acrescentámos a ampliação do quadro.${FIM_AVISO}`);
  return r;
}
