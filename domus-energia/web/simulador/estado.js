// Simulador de orçamento — estado, gravação no navegador e corpo do pedido
// (docs/SIMULADOR-ORCAMENTO.md §1, §2.1, §6). Só lógica, sem DOM.

import {
  ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, AMPERES, TIPOS_CIRCUITO, TIPOS_CASA, ELEMENTOS, MODELOS, POTENCIAS_KVA, FASES,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_QUER, PEQUENAS_QUER, OBJETIVOS, NOME_FORA,
  plantaVazia, plantaTemConteudo, atualizarDivisoes, avisosQuadro, divisaoVazia, circuitoVazio, validarPontos, definirPontos,
  perfilCasa, maquinasGrandesDe, maquinasPequenasDe, objetivosDe, sugerirFases, codigoCircuito, seccaoCabo,
  TIPOS_COM_PISOS, MAX_PISO, ALTURA_MAX_CM, pisoDe, alturaTipica, temPergunta, porResponderAntigo,
} from "./regras.js";
import { SKU_SY1, SKU_SY2 } from "./preco.js";
import { divisoesDaCasa, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO, nomeEscadas, pisoTipicoMaquina, assinaturaCasa, acertarPisos, tipoDivisao } from "./casa.js";
import { quadroOmissao, normalizarProtecoes, resumoQuadro, avisosProtecoes, levaQuadroNovo, TAMANHO_PARCIAL } from "./quadro.js";

export const VERSAO = 1;
export const CHAVE = "domus.simulador";
export const CHAVE_CODIGO = "domus.simulador.codigo";   // sessionStorage: código do cliente vindo da área de cliente
export const MAX_SIMULACAO = 1024 * 1024;                // bytes (painel/src/validar.js)
export const MAX_IMAGEM = 700 * 1024;                    // data URL da imagem de fundo
export const PASSOS = ["A casa", "Equipamentos", "Planta", "Divisões", "Quadro elétrico", "Resumo e preço", "Enviar"];
/**
 * Ordem dos passos gravada no estado (`ordem`: 3 = a de PASSOS, com o quadro depois das divisões).
 * Os estados antigos são migrados ao carregar; cada lista dá, para o passo antigo, o passo novo:
 * - sem `passos` (6 passos, antes de "O que quer"): casa, planta, quadro, divisões, preço, enviar;
 * - `passos: 7` sem `ordem`: casa, o que quer, planta, quadro, divisões, preço, enviar;
 * - `ordem: 2` (versão de testes, nunca publicada): casa, o que quer, divisões, planta, quadro, preço, enviar.
 */
export const ORDEM = 3;
const MIGRAR = { 6: [0, 2, 4, 3, 5, 6], 7: [0, 1, 2, 4, 3, 5, 6], ordem2: [0, 1, 3, 2, 4, 5, 6] };
export const SERVICO = "Simulador de orçamento";
export const SERVICO_CLIENTE = "Ampliar a instalação (simulador)";

// Os mesmos formatos que o painel aceita (painel/src/validar.js, pedidos.js, dados.js).
export const RE_TELEFONE = /^\+?[0-9 ()-]{6,30}$/;
export const RE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
export const RE_ID = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
export const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROLO_LINHA = /[\u0000-\u001f\u007f]/g;
const RE_ID_PLANTA = /^[A-Za-z0-9_-]{1,40}$/;
const CONTROLO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Potência contratada por omissão (kVA): a mais comum (não há "Não sei"). */
export const POTENCIA_OMISSAO_KVA = 6.9;

/**
 * Casa por omissão: no site já com T2; 6,9 kVA e a ligação sugerida (monofásica). Na área de cliente tipo
 * e tipologia por escolher. `area_m2` e `espacos` só contam em serviços e industrial. `localidade` já não
 * se pede no passo 1 (fica sempre ""): o local da obra é a localidade do contacto (passo 7).
 */
export function casaNova(cliente = false) {
  return {
    tipo: cliente ? null : "moradia", tipologia: cliente ? null : "T2", quartos: cliente ? null : 2, casas_banho: 1, salas: 1, pisos: 1,
    // Nada marcado em "A casa tem…" (decisão do dono: nem o corredor; só o que o cliente escolher).
    extras: { jardim: false, exterior: false, garagem: false, arrecadacao: false, varanda: false, kitnet: false, entrada: false, corredor: false, escritorio: false, lavandaria: false, despensa: false },
    area_m2: null, espacos: null,
    porPiso: null,             // casas com 2 ou mais pisos: [{quartos, casas_banho, salas, extras}] por piso (casa.js acertarPisos)
    divisoes: null, localidade: "", potencia_contratada_kva: POTENCIA_OMISSAO_KVA, fases: "mono",
  };
}

/**
 * Estado inicial. Na área de cliente ("Ampliar a instalação", com código de cliente) a casa já
 * é conhecida: começa em "O que quer" e os dados da casa são opcionais (tipo por escolher).
 */
export function estadoNovo({ cliente = false } = {}) {
  return {
    versao: VERSAO,
    passos: PASSOS.length,
    ordem: ORDEM,
    passo: cliente ? 1 : 0,
    visitado: cliente ? 1 : 0, // passo mais adiantado a que o cliente já chegou
    guardado: null,
    pisosDesde0: true,         // pisos numerados a partir do r/c (0); os estados sem isto são migrados
    casa: casaNova(cliente),
    fasesEditadas: false,      // o cliente escolheu a ligação: já não a sugerimos
    quer: { maquinas: [], pequenas: [], objetivos: [], quantidades: {}, porPiso: {} },
    planta: plantaVazia(),
    plantaSaltada: false,
    plantaAuto: false,         // a planta é a que desenhámos a partir das divisões e o cliente ainda não lhe mexeu
    plantaBase: null,          // assinaturaCasa() da casa e das máquinas com que a planta foi desenhada
    quadro: { circuitos: [], disjuntor: SKU_SY2, ...quadroOmissao() },   // + pacote, proteções, pára-raios, quadro novo (quadro.js)
    quadroEditado: false,     // o cliente mexeu no quadro: não recalcular sozinho
    divisoes: [],
    divisoesEditadas: false,  // o cliente mexeu na lista de divisões: não a refazemos sozinhos
    verificadas: [],           // ids das divisões (da planta) que o cliente marcou "Divisão verificada" (lote 5)
    fotosId: null,             // liga as fotos guardadas no IndexedDB (fotos.js) a esta simulação
    extras: { central: false, termostatos: 0 },
    termostatosEditados: false, // o cliente mudou os termóstatos: o objetivo "aquecimento" já não os muda
    contacto: { nome: "", telefone: "", email: "", localidade: "", morada: "", mensagem: "" },
  };
}

// ------------------------------------------------------------ normalização

const num = (v, min, max, omissao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : omissao;
};
const int = (v, min, max, omissao = 0) => Math.round(num(v, min, max, omissao));
const txt = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v) => v === true;
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/** Nome das escadas numeradas a partir de 1 (estados antigos) → a partir do r/c: "Escadas (piso 1)" → "Escadas (r/c)". */
const RE_ESCADAS_ANTIGAS = /^Escadas \(piso (\d+)\)$/;
export const renomearEscadas = (nome) => {
  const m = RE_ESCADAS_ANTIGAS.exec(String(nome ?? ""));
  return m ? nomeEscadas(Math.max(0, Number(m[1]) - 1)) : nome;
};

/**
 * Plantas guardadas antes dos pisos (`pisosAntigos`: sem `piso`, numerados a partir de 1): a planta desenhada
 * pela casa com vários pisos tinha cada piso num bloco abaixo do anterior (1 m entre eles) e "Escadas (piso
 * N)" em cada um. Cada bloco passa a um piso (0 = r/c), todos a começar no mesmo sítio da folha (como os
 * desenha agora plantaDaCasa), com os elementos de cada divisão; as escadas passam a "Escadas (r/c)",
 * "Escadas (piso 1)"… Se os blocos não baterem com as escadas (o cliente mexeu muito), fica tudo no r/c.
 * Muda `r` (já normalizada, com `divisao` calculada).
 */
function migrarPisos(r) {
  const escadas = r.divisoes.filter((d) => RE_ESCADAS_ANTIGAS.test(d.nome));
  for (const d of r.divisoes) d.nome = renomearEscadas(d.nome);
  if (escadas.length < 2) return;
  // Blocos: divisões que se tocam na vertical (as linhas de um piso encostam; entre pisos há um intervalo).
  const blocos = [];
  for (const d of [...r.divisoes].sort((a, b) => a.y_cm - b.y_cm)) {
    const b = blocos[blocos.length - 1];
    if (b && d.y_cm <= b.fim) { b.divs.push(d); b.fim = Math.max(b.fim, d.y_cm + d.altura_cm); } else blocos.push({ divs: [d], ini: d.y_cm, fim: d.y_cm + d.altura_cm });
  }
  if (blocos.length !== escadas.length || blocos.length > MAX_PISO + 1) return;
  const blocoDe = new Map();
  blocos.forEach((b, piso) => {
    const dy = blocos[0].ini - b.ini;
    for (const d of b.divs) {
      blocoDe.set(d.id, { piso, dy });
      d.piso = piso;
      d.y_cm += dy;
      if (d.pontos) d.pontos = d.pontos.map(([x, y]) => [x, y + dy]);
    }
  });
  for (const e of r.elementos) {
    // Elemento de uma divisão: vai com ela; solto: o bloco onde está (ou o mais próximo na vertical).
    let b = e.divisao ? blocoDe.get(e.divisao) : null;
    if (!b) {
      let k = 0, melhor = Infinity;
      blocos.forEach((x, i) => { const dist = e.y_cm < x.ini ? x.ini - e.y_cm : e.y_cm > x.fim ? e.y_cm - x.fim : 0; if (dist < melhor) { melhor = dist; k = i; } });
      b = { piso: k, dy: blocos[0].ini - blocos[k].ini };
    }
    e.piso = b.piso;
    e.y_cm = Math.max(0, e.y_cm + b.dy);
  }
  if (!r.fundo) {
    const fundo = Math.max(...r.divisoes.map((d) => d.y_cm + d.altura_cm), ...r.elementos.map((e) => e.y_cm));
    r.altura_cm = Math.max(100, Math.min(r.altura_cm, Math.ceil((fundo + ESCALA_CM) / ESCALA_CM) * ESCALA_CM));
  }
}

/** `pisosAntigos`: estado guardado antes dos pisos a partir do r/c (migrarPisos). */
export function normalizarPlanta(p, { pisosAntigos = false } = {}) {
  const r = plantaVazia();
  if (!p || typeof p !== "object") return r;
  r.largura_cm = int(p.largura_cm, 100, MAX_LADO_CM, 2000);
  r.altura_cm = int(p.altura_cm, 100, MAX_LADO_CM, 1500);
  if (p.tamanho_fixo === true) r.tamanho_fixo = true;   // o cliente escolheu o tamanho da folha
  const f = p.fundo;
  if (f && typeof f === "object" && typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem) && f.imagem.length <= MAX_IMAGEM) {
    r.fundo = { imagem: f.imagem, x_cm: int(f.x_cm, -MAX_LADO_CM, MAX_LADO_CM), y_cm: int(f.y_cm, -MAX_LADO_CM, MAX_LADO_CM), largura_cm: int(f.largura_cm, 10, 2 * MAX_LADO_CM, r.largura_cm), opacidade: Math.round(num(f.opacidade, 0.1, 1, 0.5) * 100) / 100 };
  }
  // Detalhes do passo 4: sem `respostas` (estado antigo) conta como respondido o que o cliente já mudou.
  const antigo = p.respostas !== true;
  const ids = new Set();
  const idOk = (id, pre) => typeof id === "string" && new RegExp(`^${pre}\\d{1,6}$`).test(id) && !ids.has(id);
  for (const d of lista(p.divisoes, MAX_DIVISOES)) {
    if (!d || typeof d !== "object" || !idOk(d.id, "d")) continue;
    ids.add(d.id);
    const n = { id: d.id, nome: txt(d.nome, 60), piso: pisoDe(d), x_cm: int(d.x_cm, 0, MAX_LADO_CM), y_cm: int(d.y_cm, 0, MAX_LADO_CM), largura_cm: int(d.largura_cm, 50, MAX_LADO_CM, 400), altura_cm: int(d.altura_cm, 50, MAX_LADO_CM, 300) };
    // Polígono (paredes oblíquas): 3–24 cantos dentro da planta, sem paredes cruzadas; senão fica o retângulo.
    // Com cantos válidos, a caixa envolvente passa a ser a deles (um retângulo "normal" fica sem `pontos`).
    const pts = d.pontos === undefined ? null : validarPontos(d.pontos, r.largura_cm, r.altura_cm);
    r.divisoes.push(pts ? definirPontos(n, pts) : n);
  }
  for (const e of lista(p.elementos, MAX_ELEMENTOS)) {
    if (!e || typeof e !== "object" || !idOk(e.id, "e") || !ELEMENTOS[e.tipo]) continue;
    ids.add(e.id);
    const n = { id: e.id, tipo: e.tipo, x_cm: int(e.x_cm, 0, MAX_LADO_CM), y_cm: int(e.y_cm, 0, MAX_LADO_CM), rot: [0, 90, 180, 270].includes(e.rot) ? e.rot : 0, piso: pisoDe(e), divisao: typeof e.divisao === "string" ? e.divisao.slice(0, 10) : null, props: normalizarProps(e.tipo, e.props) };
    // Opcionais (janela de edição): nome dado pelo cliente e altura ao chão (cm).
    const nome = txt(e.nome, 60).trim();
    if (nome) n.nome = nome;
    if (e.altura_cm !== undefined && e.altura_cm !== null && Number.isFinite(Number(e.altura_cm))) n.altura_cm = int(e.altura_cm, 0, ALTURA_MAX_CM);
    if (temPergunta(n.tipo, n.props) && (antigo ? porResponderAntigo(n.tipo, n.props) : e.por_responder === true)) n.por_responder = true;
    r.elementos.push(n);
  }
  // A divisão gravada fica enquanto o elemento ainda lá estiver (numa planta antiga com divisões sobrepostas a de
  // cima não lhe tira os aparelhos); senão, a que o contém (regras.js atualizarDivisoes).
  atualizarDivisoes(r, { manter: true });
  if (pisosAntigos) migrarPisos(r);
  return atualizarDivisoes(r, { manter: true });
}

/** Só as propriedades da tabela do §2 para cada tipo, com tipos certos. */
export function normalizarProps(tipo, p) {
  const o = ELEMENTOS[tipo]?.props ?? {};
  const v = p && typeof p === "object" ? p : {};
  const r = {};
  for (const k of Object.keys(o)) {
    if (k === "botoes") r.botoes = int(v.botoes, 1, 4, 1);
    else if (k === "modelo") r.modelo = MODELOS[v.modelo] ? v.modelo : o.modelo;
    else if (k === "potencia_w") r.potencia_w = int(v.potencia_w, 0, 100_000, MODELOS[r.modelo]?.w ?? o.potencia_w);
    else r[k] = bool(v[k]);
  }
  if (tipo === "janela" && !r.estore) r.motorizado = false;
  return r;
}

export function normalizarCircuito(c, i) {
  const b = circuitoVazio(i + 1);
  if (!c || typeof c !== "object") return b;
  const it = c.itens && typeof c.itens === "object" ? c.itens : {};
  return {
    n: i + 1,
    amperes: AMPERES.includes(c.amperes) ? c.amperes : 16,
    tipo: TIPOS_CIRCUITO[c.tipo] ? c.tipo : "misto",
    nome: txt(c.nome, 60),
    // "Fora das divisões" não é uma divisão (circuitos de estados antigos podiam trazê-la).
    divisoes: lista(c.divisoes, MAX_DIVISOES).filter((x) => typeof x === "string" && x !== NOME_FORA).map((x) => x.slice(0, 60)),
    itens: {
      luzes: int(it.luzes, 0, 99),
      tomadas: int(it.tomadas, 0, 99),
      maquinas: lista(it.maquinas, 20).filter((m) => m && typeof m === "object").map((m) => {
        const modelo = MODELOS[m.modelo] ? m.modelo : "outro";
        return { modelo, potencia_w: int(m.potencia_w, 0, 100_000, MODELOS[modelo].w) };
      }),
    },
    inteligente: bool(c.inteligente),
    medir: bool(c.medir),
    zona_humida: bool(c.zona_humida),   // tomadas de cozinha/casa de banho (RTIEBT C5)
    // Com quadros parciais: o piso do quadro onde fica o circuito (0 = r/c; quadro.js resumoQuadro).
    ...(c.piso !== undefined && c.piso !== null && Number.isFinite(Number(c.piso)) ? { piso: int(c.piso, 0, MAX_PISO) } : {}),
  };
}

export function normalizarDivisao(d) {
  const b = divisaoVazia();
  if (!d || typeof d !== "object") return b;
  return {
    nome: txt(d.nome, 60),
    planta_id: typeof d.planta_id === "string" ? d.planta_id.slice(0, 10) : null,
    piso: pisoDe(d),
    interruptores: lista(d.interruptores, 30).map((x) => int(x, 1, 4, 1)),
    estores: int(d.estores, 0, 99),
    estores_sem_motor: int(d.estores_sem_motor, 0, 99),
    sensores_porta: int(d.sensores_porta, 0, 99),
    sensores_movimento: int(d.sensores_movimento, 0, 99),
    luzes_regulaveis: int(d.luzes_regulaveis, 0, 99),
    tomadas_inteligentes: int(d.tomadas_inteligentes, 0, 99),
  };
}

/** Estado lido do navegador (pode vir estragado ou de outra versão): sempre um estado válido. */
export function normalizarEstado(v) {
  const e = estadoNovo();
  if (!v || typeof v !== "object" || v.versao !== VERSAO) return null;
  // Estados antigos (6 passos; 7 passos com outra ordem): o passo antigo passa ao novo (MIGRAR);
  // o cliente pode voltar pela barra a qualquer passo que já tinha visto.
  const migrar = v.passos !== PASSOS.length ? MIGRAR[6] : v.ordem === 2 ? MIGRAR.ordem2 : v.ordem !== ORDEM ? MIGRAR[7] : null;
  const passo = int(v.passo, 0, (migrar ? migrar.length : PASSOS.length) - 2);   // nunca volta direto ao "Enviar"
  e.passo = migrar ? migrar[passo] : passo;
  e.visitado = migrar ? Math.max(...migrar.slice(0, passo + 1)) : Math.max(e.passo, int(v.visitado, 0, PASSOS.length - 2));
  e.guardado = typeof v.guardado === "string" ? v.guardado.slice(0, 40) : null;
  // Antes dos pisos a partir do r/c (0): a planta, as escadas e as divisões são migradas (migrarPisos).
  const pisosAntigos = v.pisosDesde0 !== true;
  const c = v.casa && typeof v.casa === "object" ? v.casa : {};
  const x = c.extras && typeof c.extras === "object" ? c.extras : {};
  const tipologia = TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;   // estado antigo: sem tipologia
  const tipo = TIPOS_CASA[c.tipo] ? c.tipo : c.tipo === null ? null : "moradia";
  const perfil = perfilCasa(tipo);
  e.casa = {
    tipo,
    tipologia,
    quartos: tipologia === "T5+" ? int(c.quartos, 5, LIMITES_CASA.quartos[1], 5) : quartosDe({ tipologia }),
    casas_banho: int(c.casas_banho, ...LIMITES_CASA.casas_banho, casasBanhoOmissao(tipologia)),
    salas: int(c.salas, ...LIMITES_CASA.salas, salasOmissao(tipologia)),
    // Só as moradias têm mais de um piso.
    pisos: TIPOS_COM_PISOS.includes(tipo) ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1,
    // Estados guardados antes do botão "Corredor": o corredor seguia a tipologia (T2 e mais).
    extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, k === "corredor" && x[k] === undefined ? (quartosDe({ tipologia, quartos: c.quartos }) ?? 0) >= 2 : bool(x[k])])),
    area_m2: perfil === "habitacao" ? null : int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[perfil]),
    espacos: perfil === "habitacao" ? null : int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[perfil]),
    divisoes: c.divisoes == null || c.divisoes === "" ? null : int(c.divisoes, 1, 40, 1),
    localidade: "",   // estado antigo com localidade no passo 1: passa para o contacto (em baixo)
    // Estado antigo com "Não sei" (null): 6,9 kVA; a ligação fica a sugerida (em baixo).
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva) ?? POTENCIA_OMISSAO_KVA,
    fases: FASES[c.fases] ? c.fases : null,
    porPiso: Array.isArray(c.porPiso) ? c.porPiso : null,
  };
  // Valores por piso (2 ou mais pisos); um estado sem eles fica com os da casa toda repartidos como antes
  // (casa.js repartirPisos com o escritório no r/c: a planta desenhada é a mesma).
  const semPorPiso = !Array.isArray(c.porPiso);
  acertarPisos(e.casa, { antigo: semPorPiso });
  // Estado antigo: uma ligação já escolhida conta como escolhida pelo cliente; "Não sei" continua sugerível.
  e.fasesEditadas = v.fasesEditadas === undefined ? e.casa.fases !== null : bool(v.fasesEditadas);
  // "O que quer" por piso (`porPiso`); um estado antigo ({quantidades, pisos} por máquina) passa a ter a
  // quantidade no piso escolhido, ou no típico (casa.js pisoTipicoMaquina).
  const vq = v.quer && typeof v.quer === "object" ? v.quer : {};
  const antigas = [...lista(vq.maquinas, 60), ...lista(vq.pequenas, 60)].filter((k) => typeof k === "string");
  e.quer = normalizarQuer(vq, tipo, { pisos: pisosDaCasa(e.casa), pisoTipico: (k) => pisoTipicoMaquina(e.casa, k, antigas) });
  if (e.casa.fases === null) { e.casa.fases = fasesSugeridas(e); e.fasesEditadas = false; }
  e.planta = normalizarPlanta(v.planta, { pisosAntigos });
  e.plantaSaltada = bool(v.plantaSaltada);
  e.plantaAuto = bool(v.plantaAuto);
  // A assinatura de um estado antigo não se compara com a de agora (tem outros campos): fica sem base.
  e.plantaBase = !migrar && typeof v.plantaBase === "string" ? v.plantaBase.slice(0, 1000) : null;
  // "O que quer" ainda sem pisos, ou a casa ainda sem valores por piso: a assinatura guardada foi feita à maneira
  // antiga; se era a da casa e das máquinas de então, passa a ser a de agora (a planta não fica "desatualizada"
  // só pela migração).
  const querAntigo = !vq.porPiso || typeof vq.porPiso !== "object";
  if (e.plantaBase && (querAntigo || semPorPiso)) {
    const comPisos = pisosDaCasa(e.casa) > 1;
    const ps = vq.pisos && typeof vq.pisos === "object" ? vq.pisos : {};
    const qt = vq.quantidades && typeof vq.quantidades === "object" ? vq.quantidades : {};
    const velhas = querAntigo
      ? maquinasEscolhidas(normalizarQuer({ maquinas: vq.maquinas, pequenas: vq.pequenas }, tipo)).map((k) => ({ modelo: k, qtd: int(qt[k], 1, MAX_QUANTIDADE, 1), piso: comPisos && Number.isInteger(ps[k]) ? ps[k] : null }))
      : maquinasParaPlanta(e);
    const casaAntes = semPorPiso ? { ...e.casa, porPiso: null } : e.casa;
    if (e.plantaBase === assinaturaCasa(casaAntes, velhas)) e.plantaBase = assinaturaCasa(e.casa, maquinasParaPlanta(e));
  }
  const q = v.quadro && typeof v.quadro === "object" ? v.quadro : {};
  e.quadro = { circuitos: lista(q.circuitos, 60).map(normalizarCircuito), disjuntor: q.disjuntor === SKU_SY1 ? SKU_SY1 : SKU_SY2, ...normalizarProtecoes(q) };
  e.quadroEditado = bool(v.quadroEditado);
  // "Fora das divisões" (elementos fora de todas) não é uma divisão: estados antigos traziam-na na lista.
  e.divisoes = lista(v.divisoes, MAX_DIVISOES + 1).map(normalizarDivisao).filter((d) => !ehFora(d));
  if (pisosAntigos) {
    // As divisões e os circuitos seguem a planta: escadas renomeadas; o piso vem da divisão da planta
    // (ou, sem planta, do nome das escadas — as outras ficam no r/c).
    for (const c of e.quadro.circuitos) c.divisoes = c.divisoes.map(renomearEscadas);
    for (const d of e.divisoes) {
      const m = RE_ESCADAS_ANTIGAS.exec(d.nome);
      d.nome = renomearEscadas(d.nome);
      const daPlanta = d.planta_id ? e.planta.divisoes.find((x) => x.id === d.planta_id) : null;
      d.piso = daPlanta ? daPlanta.piso : m ? Math.min(MAX_PISO, Math.max(0, Number(m[1]) - 1)) : 0;
    }
  }
  e.divisoesEditadas = bool(v.divisoesEditadas);
  // Lote 5 (estados antigos: sem nenhuma verificada e sem fotos).
  e.verificadas = [...new Set(lista(v.verificadas, MAX_DIVISOES + 1).filter((x) => typeof x === "string" && RE_ID_PLANTA.test(x)))];
  e.fotosId = typeof v.fotosId === "string" && /^[a-f0-9]{8,40}$/.test(v.fotosId) ? v.fotosId : null;
  const ex = v.extras && typeof v.extras === "object" ? v.extras : {};
  e.extras = { central: bool(ex.central), termostatos: int(ex.termostatos, 0, 20) };
  // Estado antigo: termóstatos já escolhidos contam como mexidos (o objetivo "aquecimento" não os apaga).
  e.termostatosEditados = v.termostatosEditados === undefined ? e.extras.termostatos > 0 : bool(v.termostatosEditados);
  const k = v.contacto && typeof v.contacto === "object" ? v.contacto : {};
  e.contacto = { nome: txt(k.nome, 120), telefone: txt(k.telefone, 30), email: txt(k.email, 254), localidade: txt(k.localidade, 80), morada: txt(k.morada, 200), mensagem: txt(k.mensagem, 2000) };
  if (!e.contacto.localidade.trim()) e.contacto.localidade = txt(c.localidade, 80);   // a antiga localidade do passo 1
  return e;
}

/** Linha "Fora das divisões" (elementos fora de todas; regras.js contarPlanta): não é uma divisão. */
const ehFora = (d) => d?.nome === NOME_FORA && !d?.planta_id;

/**
 * Máquinas grandes, pequenas e objetivos do passo "O que quer": só as chaves conhecidas (as do perfil
 * do imóvel, quando `tipo` é dado), sem repetidos, pela ordem das listas. As máquinas escolhem-se por piso:
 * `porPiso[chave]` = {piso: n} (0 = r/c; 1–10 em cada piso) é o que conta; `maquinas`/`pequenas` (as chaves
 * com alguma quantidade) e `quantidades` (o total da casa) saem daí.
 * Estados antigos: {maquinas, pequenas, quantidades, pisos} (uma quantidade e, se o cliente escolheu, um piso
 * por máquina) → essa quantidade no piso escolhido ou, sem escolha, no típico (`pisoTipico(chave)`; 0 sem ela).
 * `pisos`: n.º de pisos da casa — o que estiver num piso acima do último passa para o último.
 */
export const MAX_QUANTIDADE = 10;
export function normalizarQuer(q, tipo = undefined, { pisos = MAX_PISO + 1, pisoTipico = null } = {}) {
  const o = q && typeof q === "object" ? q : {};
  const so = (v, chaves) => (Array.isArray(v) ? chaves.filter((k) => v.includes(k)) : []);
  const porTipo = tipo !== undefined;
  const grandes = porTipo ? maquinasGrandesDe(tipo) : MAQUINAS_QUER;
  const peq = porTipo ? maquinasPequenasDe(tipo) : PEQUENAS_QUER;
  const ultimo = int(pisos, 1, MAX_PISO + 1, 1) - 1;
  const porPiso = {};
  const somar = (k, p, n) => {
    const m = (porPiso[k] ??= {});
    const pp = Math.min(ultimo, p);
    m[pp] = Math.min(MAX_QUANTIDADE, (m[pp] ?? 0) + n);
  };
  if (o.porPiso && typeof o.porPiso === "object") {
    for (const k of new Set([...grandes, ...peq])) {
      const m = o.porPiso[k];
      if (!m || typeof m !== "object") continue;
      for (const [p, n] of Object.entries(m)) {
        const pi = Number(p), ni = Math.round(Number(n));
        if (Number.isInteger(pi) && pi >= 0 && pi <= MAX_PISO && ni >= 1) somar(k, pi, Math.min(MAX_QUANTIDADE, ni));
      }
    }
  } else {
    const qt = o.quantidades && typeof o.quantidades === "object" ? o.quantidades : {};
    const ps = o.pisos && typeof o.pisos === "object" ? o.pisos : {};
    for (const k of new Set([...so(o.maquinas, grandes), ...so(o.pequenas, peq)])) {
      const escolhido = ps[k] !== undefined && ps[k] !== null && Number.isFinite(Number(ps[k])) ? int(ps[k], 0, MAX_PISO) : null;
      somar(k, escolhido ?? (pisoTipico ? int(pisoTipico(k), 0, MAX_PISO) : 0), int(qt[k], 1, MAX_QUANTIDADE, 1));
    }
  }
  const maquinas = grandes.filter((k) => porPiso[k]);
  const pequenas = peq.filter((k) => porPiso[k] && !maquinas.includes(k));
  const quantidades = Object.fromEntries([...maquinas, ...pequenas].map((k) => [k, Object.values(porPiso[k]).reduce((s, n) => s + n, 0)]));
  return { maquinas, pequenas, objetivos: so(o.objetivos, porTipo ? objetivosDe(tipo) : Object.keys(OBJETIVOS)), quantidades, porPiso };
}

/** Quantas máquinas `k` estão escolhidas no piso `p` (0 se nenhuma). */
export const quantidadeNoPiso = (quer, k, p) => Number(quer?.porPiso?.[k]?.[p]) || 0;

/** Todas as máquinas escolhidas (grandes e pequenas; só as chaves): ligação sugerida, "Exterior", assinatura. */
export const maquinasEscolhidas = (quer) => [...(quer?.maquinas ?? []), ...(quer?.pequenas ?? [])];

/** N.º de pisos da casa (1 nos tipos sem pisos). */
export const pisosDaCasa = (casa) => (TIPOS_COM_PISOS.includes(casa?.tipo) ? int(casa?.pisos, 1, MAX_PISO + 1, 1) : 1);

/**
 * Máquinas para desenhar a planta (casa.js plantaDaCasa): {modelo, qtd, piso}, uma por piso onde o cliente as
 * pôs (só nos tipos com mais de um piso; sem pisos, piso null).
 */
export function maquinasParaPlanta(estado) {
  const q = estado.quer ?? {};
  const comPisos = pisosDaCasa(estado.casa) > 1;
  return maquinasEscolhidas(q).flatMap((k) => {
    const m = q.porPiso?.[k] ?? { 0: q.quantidades?.[k] ?? 1 };
    const pisos = Object.keys(m).map(Number).filter((p) => Number(m[p]) > 0).sort((a, b) => a - b);
    if (!comPisos) return [{ modelo: k, qtd: pisos.reduce((s, p) => s + Number(m[p]), 0), piso: null }];
    return pisos.map((p) => ({ modelo: k, qtd: Number(m[p]), piso: p }));
  });
}

/** Ligação sugerida pelo tipo e pelas máquinas (regras.js sugerirFases). */
export const fasesSugeridas = (estado) => sugerirFases(estado.casa?.tipo ?? null, maquinasEscolhidas(estado.quer));

/** Potência contratada (kVA) de um dos escalões, ou null (valor inválido; quem chama usa POTENCIA_OMISSAO_KVA). */
export function potenciaContratada(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return POTENCIAS_KVA.includes(n) ? n : null;
}

/** Opções dos avisos do quadro: disjuntor escolhido e a instalação da casa (§4). */
export const opcoesAvisos = (estado) => ({
  disjuntor: estado.quadro?.disjuntor,
  fases: estado.casa?.fases ?? null,
  potencia_contratada_kva: estado.casa?.potencia_contratada_kva ?? null,
  quadro_novo: estado.quadro?.quadro_novo ?? null,
});

/** Todos os avisos do quadro: os dos circuitos (regras.js) e os das proteções, tamanho e potência (quadro.js). */
export const avisosEstado = (estado, circuitos = estado.quadro.circuitos) =>
  [...avisosQuadro(circuitos, opcoesAvisos(estado)), ...avisosProtecoes({ casa: estado.casa, quadro: { ...estado.quadro, circuitos } })];

/**
 * `simulacao.quadro` (§6): circuitos (com o código RTIEBT, a secção do cabo, o grupo diferencial e o AFDD),
 * pacote e proteções, respostas (pára-raios, quadro novo), grupos diferenciais, módulos e potência sugerida.
 */
export function quadroParaEnvio(estado, circuitos) {
  const q = { ...estado.quadro, circuitos };
  const r = resumoQuadro({ ...estado, quadro: q });
  const grupoDe = (n) => r.grupos.find((g) => g.circuitos.includes(n))?.n ?? null;
  return {
    circuitos: circuitos.map((c) => ({ ...c, codigo: codigoCircuito(c), seccao_mm2: seccaoCabo(c.amperes), diferencial: grupoDe(c.n), afdd: r.afdd.includes(c.n) })),
    disjuntor: q.disjuntor,
    pacote: r.pacote,
    protecoes: { ...r.protecoes },
    para_raios: r.para_raios,
    quadro_novo: r.quadro_novo,
    // Lote 5, "O seu quadro elétrico": Quero um quadro novo → true, Já tenho quadro (o atual serve) → false, Não sei →
    // null (o mesmo valor que dava "O quadro elétrico é antigo?" do lote 4: Sim / Não / Não sei).
    quadro_antigo: r.quadro_novo === "novo" ? true : r.quadro_novo === "atual" ? false : null,
    quadro_novo_no_preco: levaQuadroNovo(q),
    diferenciais: r.grupos.map((g) => ({ n: g.n, circuitos: [...g.circuitos], carregador: g.carregador, wifi: !!r.protecoes.idr_wifi, quadro: g.quadro })),
    modulos: { tamanho: r.tamanho, quadros: r.quadros, parciais: r.parciais, tamanho_parcial: r.parciais ? TAMANHO_PARCIAL : null, pisos_quadros: [...r.pisos_quadros], ocupados: r.ocupados, livres: r.livres, cabe: r.cabe, novos: r.novos, linhas: r.linhas.map((l) => ({ nome: l.nome, qtd: l.qtd, modulos: l.modulos })) },
    potencia_sugerida_kva: r.potencia.kva,
    potencia_carga_w: r.potencia.carga_w,
  };
}

/** Houve progresso que valha a pena retomar? (`passoInicial`: 1 na área de cliente, que começa em "O que quer") */
export function temProgresso(e, passoInicial = 0) {
  return !!e && (e.passo > passoInicial || e.casa.potencia_contratada_kva !== POTENCIA_OMISSAO_KVA || e.fasesEditadas || plantaTemConteudo(e.planta) || e.quadro.circuitos.length > 0 || e.divisoes.length > 0 || !!e.contacto.localidade);
}

// ------------------------------------------------------------ navegador (localStorage)

/**
 * Guarda o estado. Se não couber (quota), tenta sem a imagem de fundo.
 * @returns {"ok"|"sem_imagem"|"falhou"}
 */
export function guardarEstado(storage, estado, agora = new Date()) {
  const e = { ...estado, guardado: agora.toISOString() };
  try {
    storage.setItem(CHAVE, JSON.stringify(e));
    return "ok";
  } catch {
    if (!estado.planta?.fundo) return "falhou";
    try {
      storage.setItem(CHAVE, JSON.stringify({ ...e, planta: { ...e.planta, fundo: null } }));
      return "sem_imagem";
    } catch {
      return "falhou";
    }
  }
}

export function carregarEstado(storage) {
  try {
    const bruto = storage.getItem(CHAVE);
    if (!bruto) return null;
    return normalizarEstado(JSON.parse(bruto));
  } catch {
    return null;
  }
}

export function apagarEstado(storage) {
  try { storage.removeItem(CHAVE); } catch { /* navegador sem armazenamento */ }
}

/** Código do cliente passado pela área de cliente (sessionStorage); null se não houver ou for inválido. */
export function lerCodigoCliente(storage) {
  try {
    const c = String(storage.getItem(CHAVE_CODIGO) ?? "").trim().toLowerCase();
    return RE_ID.test(c) ? c : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ corpo do pedido (§6)

/**
 * Texto do cliente seguro para a simulação: sem caracteres de controlo e sem
 * começar por "data:" (o painel só aceita data: de imagens JPEG/PNG).
 */
export function textoSeguro(v, max = 120, multilinha = false) {
  let s = String(v ?? "").replace(multilinha ? CONTROLO : CONTROLO_LINHA, " ").trim().normalize("NFC").slice(0, max);
  if (/^\s*data:/i.test(s)) s = `«${s}»`.slice(0, max);
  return s;
}

/** Planta no formato exato do §2.1 (ou null quando não há nada desenhado). */
export function plantaParaEnvio(planta) {
  if (!plantaTemConteudo(planta)) return null;
  const p = normalizarPlanta(planta);
  return {
    escala_cm: ESCALA_CM,
    largura_cm: p.largura_cm,
    altura_cm: p.altura_cm,
    fundo: p.fundo ? { imagem: p.fundo.imagem, x_cm: p.fundo.x_cm, y_cm: p.fundo.y_cm, largura_cm: p.fundo.largura_cm, opacidade: p.fundo.opacidade } : null,
    divisoes: p.divisoes.map((d) => ({
      id: d.id, nome: textoSeguro(d.nome, 60) || "Divisão", piso: d.piso, x_cm: d.x_cm, y_cm: d.y_cm, largura_cm: d.largura_cm, altura_cm: d.altura_cm,
      ...(d.pontos ? { pontos: d.pontos.map((q) => [q[0], q[1]]) } : {}),
    })),
    elementos: p.elementos.map((e) => {
      // Altura ao chão típica (para o relatório técnico: o cliente já não a vê nem a escreve).
      const div = e.divisao ? p.divisoes.find((d) => d.id === e.divisao) : null;
      return {
        id: e.id, tipo: e.tipo, x_cm: e.x_cm, y_cm: e.y_cm, rot: e.rot, piso: e.piso, divisao: e.divisao, props: { ...e.props },
        ...(e.nome ? { nome: textoSeguro(e.nome, 60) } : {}), ...(e.altura_cm !== undefined ? { altura_cm: e.altura_cm } : {}),
        altura_tipica_cm: alturaTipica(e.tipo, e.props, div ? tipoDivisao(div.nome) : null),
      };
    }),
  };
}

/**
 * `simulacao.casa` (§6). Com tipologia (ou em serviços/industrial), `divisoes` é o total das divisões
 * que a casa gera, incluindo o "Exterior" que as máquinas acrescentam (compatível com o antigo "Quantas
 * divisões tem?"); sem tipologia os campos novos vão a null. Serviços e industrial: `area_m2` e
 * `espacos` (sem tipologia).
 */
export function casaParaEnvio(estado) {
  const c = estado.casa;
  const negocio = perfilCasa(c.tipo) !== "habitacao";
  const tipologia = !negocio && TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;
  return {
    tipo: TIPOS_CASA[c.tipo] ? c.tipo : null,
    divisoes: tipologia || negocio ? divisoesDaCasa(c, maquinasEscolhidas(estado.quer)).length : c.divisoes ?? (estado.divisoes.length || null),
    localidade: textoSeguro(estado.contacto.localidade, 80) || null,   // o local da obra: a localidade do contacto (passo 7)
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva),
    fases: FASES[c.fases] ? c.fases : null,
    tipologia,
    quartos: tipologia ? quartosDe(c) : null,
    casas_banho: tipologia ? int(c.casas_banho, ...LIMITES_CASA.casas_banho, 1) : null,
    salas: tipologia && tipologia !== "T0" ? int(c.salas, ...LIMITES_CASA.salas, 1) : null,
    pisos: tipologia ? (TIPOS_COM_PISOS.includes(c.tipo) ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1) : null,
    extras: tipologia ? Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(c.extras?.[k])])) : null,
    area_m2: negocio ? int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[c.tipo]) : null,
    espacos: negocio ? int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[c.tipo]) : null,
    // Com 2 ou mais pisos, o que tem cada piso (os totais acima são a soma); null com um só piso.
    pisos_detalhe: tipologia && Array.isArray(c.porPiso) && c.porPiso.length > 1
      ? c.porPiso.map((f, p) => ({
        piso: p, quartos: int(f.quartos, 0, 12), casas_banho: int(f.casas_banho, 0, 6), salas: tipologia === "T0" ? null : int(f.salas, 0, 4),
        extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(f.extras?.[k])])),
      }))
      : null,
  };
}

export const ESTADOS_DESLOCACAO = ["estimada", "visita", "sem_localidade", "fora_area"];

/**
 * `simulacao.deslocacao` (§5.1, §6) a partir de calcularDeslocacao() (./deslocacao.js): localidade escrita,
 * concelho reconhecido e distrito (null se não reconhecido), distância estimada por estrada (km) e valor
 * (€ c/ IVA; em "visita"/"sem_localidade" só o mínimo fixo; null quando fora da área). null sem cálculo.
 */
export function deslocacaoParaEnvio(d) {
  if (!d || typeof d !== "object" || !ESTADOS_DESLOCACAO.includes(d.estado)) return null;
  const n = (x, max) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  return {
    estado: d.estado,
    localidade: textoSeguro(d.localidade, 80) || null,
    concelho: textoSeguro(d.concelho, 60) || null,
    distrito: textoSeguro(d.distrito, 60) || null,
    distancia_km: n(d.distancia_km, 5000),
    valor_iva: n(d.valor_iva, 100_000),
  };
}

/**
 * `simulacao` do POST /api/orcamento (§6).
 * @param {object} estado
 * @param {ReturnType<import("./preco.js").calcularPreco>} preco
 * @param {string} plano  base | conforto | premium
 */
/**
 * `simulacao` do POST /api/orcamento (§6). `fotos` (lote 5): as fotos tiradas, sem as imagens —
 * [{chave, tipo, divisao, divisao_nome, piso, legenda}] (as imagens vão depois, uma a uma, com o token).
 */
export function montarSimulacao(estado, preco, plano, fotos = []) {
  const circuitos = estado.quadro.circuitos.map((c, i) => {
    const n = normalizarCircuito(c, i);
    return { ...n, nome: textoSeguro(n.nome, 60), divisoes: n.divisoes.map((d) => textoSeguro(d, 60)).filter(Boolean) };
  });
  return {
    versao: VERSAO,
    casa: casaParaEnvio(estado),
    quer: querParaEnvio(estado),
    planta: estado.plantaSaltada ? null : plantaParaEnvio(estado.planta),
    quadro: { ...quadroParaEnvio(estado, circuitos), foto: fotos.some((f) => f.chave === "quadro") ? "quadro" : null },
    divisoes: estado.divisoes.filter((d) => !ehFora(d)).map((d) => {
      const n = normalizarDivisao(d);
      return {
        nome: textoSeguro(n.nome, 60) || "Divisão", piso: n.piso, interruptores: n.interruptores, estores: n.estores, estores_sem_motor: n.estores_sem_motor,
        sensores_porta: n.sensores_porta, sensores_movimento: n.sensores_movimento, luzes_regulaveis: n.luzes_regulaveis, tomadas_inteligentes: n.tomadas_inteligentes,
      };
    }),
    itens: preco.linhas.map((l) => ({ sku: l.sku, qtd: l.qtd, preco_iva: l.preco_iva })),
    mao_obra: { horas: preco.horas, valor_iva: preco.mao_obra_iva },
    deslocacao: deslocacaoParaEnvio(preco.deslocacao),
    total: { min: preco.min, max: preco.max },
    plano_sugerido: plano,
    avisos: avisosEstado(estado, circuitos),
    fotos: fotos.slice(0, 40).map((f) => ({
      chave: String(f.chave).slice(0, 80), tipo: f.tipo, divisao: f.divisao ?? null,
      divisao_nome: f.divisao_nome == null ? null : textoSeguro(f.divisao_nome, 60) || "Divisão",
      piso: f.piso ?? null, legenda: textoSeguro(f.legenda, 120),
    })),
  };
}

/**
 * `simulacao.quer` (§6): as listas de chaves (como antes), `quantidades` (o total de cada máquina marcada) e,
 * nos tipos com pisos, `pisos` = quantas em cada piso ({"ar_condicionado": {"0": 1, "1": 2}}; null nos outros).
 */
export function querParaEnvio(estado) {
  const q = normalizarQuer(estado.quer, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) });
  const chaves = [...q.maquinas, ...q.pequenas];
  return {
    maquinas: q.maquinas, pequenas: q.pequenas, objetivos: q.objetivos,
    quantidades: Object.fromEntries(chaves.map((k) => [k, q.quantidades[k]])),
    pisos: TIPOS_COM_PISOS.includes(estado.casa.tipo) ? Object.fromEntries(chaves.map((k) => [k, { ...q.porPiso[k] }])) : null,
  };
}

export const bytes = (s) => new TextEncoder().encode(s).length;

/** Problema no contacto (as mesmas regras do painel) ou null. */
export function problemaContacto(k) {
  const t = (v) => String(v ?? "").trim();
  if (!t(k.nome)) return { campo: "nome", texto: "Escreva o seu nome." };
  if (t(k.nome).length > 120) return { campo: "nome", texto: "O nome é demasiado longo (máx. 120 caracteres)." };
  if (!t(k.telefone) && !t(k.email)) return { campo: "telefone", texto: "Indique um telefone ou um email para o podermos contactar." };
  if (t(k.telefone) && !RE_TELEFONE.test(t(k.telefone))) return { campo: "telefone", texto: "O telefone não parece certo: escreva o número completo (ex.: 912 345 678)." };
  if (t(k.email) && (t(k.email).length > 254 || !RE_EMAIL.test(t(k.email)))) return { campo: "email", texto: "O email não parece certo (ex.: nome@exemplo.pt)." };
  if (t(k.localidade).length > 80) return { campo: "localidade", texto: "A localidade é demasiado longa (máx. 80 caracteres)." };
  if (t(k.morada).length > 200) return { campo: "morada", texto: "A morada é demasiado longa (máx. 200 caracteres)." };
  if (t(k.mensagem).length > 2000) return { campo: "mensagem", texto: "A mensagem é demasiado longa (máx. 2000 caracteres)." };
  return null;
}

/**
 * Corpo do POST /api/orcamento: textos aparados, campos opcionais vazios de fora.
 * `website` é o campo-armadilha (só vai se estiver preenchido).
 */
export function montarPedido(estado, simulacao, { codigo = null, website = "" } = {}) {
  const k = estado.contacto;
  const corpo = { nome: textoSeguro(k.nome, 120), servico: codigo ? SERVICO_CLIENTE : SERVICO };
  const tel = String(k.telefone ?? "").trim();
  const email = String(k.email ?? "").trim();
  const loc = textoSeguro(k.localidade || estado.casa.localidade, 80);
  const msg = String(k.mensagem ?? "").replace(CONTROLO, " ").trim().slice(0, 2000);
  if (tel) corpo.telefone = tel;
  if (email) corpo.email = email;
  if (loc) corpo.localidade = loc;
  const morada = textoSeguro(k.morada, 200);
  if (morada) corpo.morada = morada;
  if (msg) corpo.mensagem = msg;
  if (String(website ?? "").trim()) corpo.website = String(website).trim();
  if (codigo && RE_ID.test(codigo)) corpo.codigo_cliente = codigo;
  corpo.simulacao = simulacao;
  return corpo;
}

/** A simulação cabe no limite do painel (1 MB)? */
export const tamanhoSimulacao = (sim) => bytes(JSON.stringify(sim));
