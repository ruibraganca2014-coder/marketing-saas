// Pagamentos do pedido de orçamento (docs/PAGAMENTOS-PEDIDO.md). Fase 3 (monetização): ENVIAR O PEDIDO É GRÁTIS e o
// cliente recebe logo o relatório básico (intervalo de preço e lista de trabalho); à parte compra-se o relatório
// pormenorizado (`preco_relatorio_iva`, 29 €; revisto pelo CEO antes de o libertar) e a visita técnica (deslocação até à
// localidade + 0,5 h × tarifa; fora da área servida não há), no passo Enviar (os dois juntos) ou depois na conta. A
// avaria rápida paga o diagnóstico e a deslocação ao enviar (a visita fica pedida). Tudo o que foi pago antes é
// descontado no sinal de 30 % ao aceitar a proposta; o restante paga-se no fim da obra. Os 19 € do modelo antigo (fase
// `relatorio`) continuam a ler-se e a contar. Vive no painel (tem as contas, os pedidos, a auditoria e os emails); o
// serviço pagamentos/ continua só com as subscrições mensais.
//
// Dois modos (PAGAMENTOS_MODO):
// - "simulado" (só com PAGAMENTOS_MODO=simulado explícito; o lançador local põe-no): nenhum dinheiro real. O
//   "pagamento" abre a página do site pagamento-simulado.html, que chama POST /api/conta/pagamentos/:ref/simular; daí
//   sai um evento com o MESMO formato de um webhook do Stripe (checkout.session.*), tratado pela mesma função
//   (tratarEvento). O site e o painel mostram a faixa "Modo de demonstração — pagamentos simulados".
// - "stripe" (por omissão com STRIPE_SECRET_KEY): Stripe Checkout (cartão, MB Way, Multibanco) pela API REST;
//   confirmação pelo webhook assinado (POST /api/conta/pagamentos/stripe-webhook) e, no regresso do cliente, pela
//   leitura da sessão no Stripe.
// Sem modo explícito e sem chave os pagamentos ficam desligados (config.pagamentoPedido = false): envia-se na mesma
// (grátis), mas não se compra nada online.
//
// IVA (decisão do dono): a proposta do painel é SEM IVA e os pagamentos online incluem-no (taxa "iva_pct" da
// configuração, omissão 23 %): proposta 1000 € → 1230 €; relatório 29 € e visita 25 € pagos antes → sinal =
// 30 % × 1230 − 54 = 315 €; restante 861 €. O relatório, a visita e a avaria já são com IVA. Cada pagamento guarda a
// taxa usada (iva_pct) para o recibo e o CSV (base, IVA, total).
//
// Decisões do dono de 2026-10-02 (docs/PAGAMENTOS-PEDIDO.md "Decisões de 2026-10-02"): sinal = o maior entre 30 % do
// total com IVA e o custo do material, menos o já pago; obra mínima (`obra_minima_iva`, 100 €: abaixo cobra-se o
// mínimo e o que foi pago antes não se desconta); acima de `cartao_max_iva` (500 €) só Multibanco ou MB Way; proposta em
// três partes (mão de obra, material, deslocação); visita cancelada com mais de 24 h é devolvida; "Quero que comecem
// já" (`inicio_imediato`); a casa só se liga com a obra toda paga (`ligacaoCasa`).
//
// Regras: os valores são SEMPRE calculados aqui (nunca vêm do browser); cada pagamento tem uma referência
// aleatória (ref) e só a conta dona o vê e paga; um evento só é tratado uma vez (pagamentos_eventos) e uma fase
// paga não se paga outra vez (índice único); a avaria só passa a orçamento ("novo" no painel) depois de paga.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErroApi, responder, lerJson, lerCorpo, verificarOrigemPublica, tipoJson } from './http.js';
import { idNum, opcao, booleano, MELHORIAS } from './validar.js';
import { iso, deCent } from './util.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';
import { esquemasDaPlanta } from '../public/vendor/simbolos.js';
import { CHECKLIST, CHAVES_CHECKLIST, NOME_TIPO as NOME_TIPO_AVARIA } from '../public/ecras/diagnostico-conteudo.js';

export const SINAL_PCT = 30;
export const OBRA_MINIMA_OMISSAO = 100;           // € c/ IVA: abaixo disto cobra-se o mínimo (config `obra_minima_iva`)
export const CARTAO_MAX_OMISSAO = 500;            // € c/ IVA: acima disto não se paga por cartão (config `cartao_max_iva`)
export const CANCELAR_VISITA_MS = 24 * 3600_000;  // a visita cancelada com mais antecedência do que isto é devolvida
export const DIAS_LIVRE_RESOLUCAO = 14;
export const HORAS_DIA_OBRA = 8;                  // deslocação da obra: uma ida e volta por cada 8 h (config `horas_por_dia`)
export const DESLOCACAO_MAX_DIAS = 5;             // … no máximo 5 dias de deslocação por obra (config `deslocacao_max_dias`)
export const PRECO_RELATORIO_OMISSAO = 29;        // € c/ IVA do relatório completo (config `preco_relatorio_iva`)
export const VISITA_HORAS = 0.5;                  // visita técnica = deslocação + 0,5 h × tarifa
export const VALIDADE_MS = 24 * 3600_000;         // um pagamento por pagar expira (e o pedido guardado sai) ao fim de 24 h
const FOTOS_DEPOIS_MS = 2 * 3600_000;             // token das fotos só nas 2 h a seguir ao pagamento da avaria
const TOLERANCIA_WEBHOOK_S = 300;
const RE_REF = /^pp_[A-Za-z0-9_-]{22}$/;
export const PLANOS_MENSAIS = ['base', 'conforto', 'premium'];
const NOME_PLANO = { base: 'Base', conforto: 'Conforto', premium: 'Premium' };
export const NOME_FASE = {
  relatorio: 'Relatório técnico e visita (19 €)', sinal: 'Sinal', restante: 'Restante',
  relatorio_pormenorizado: 'Relatório completo', visita: 'Visita técnica',
  pormenorizado_visita: 'Relatório completo e visita técnica', avaria: 'Diagnóstico da avaria e deslocação',
};
/** Fases pagas antes da obra: descontadas no sinal. */
const FASES_ANTES = ['relatorio', 'relatorio_pormenorizado', 'visita', 'pormenorizado_visita', 'avaria'];
/** Compras do pedido (passo Enviar ou conta) e o que cada uma inclui. */
export const COMPRAS = { relatorio_pormenorizado: { relatorio: true, visita: false }, visita: { relatorio: false, visita: true }, pormenorizado_visita: { relatorio: true, visita: true } };
const FASES_RELATORIO = ['relatorio', 'relatorio_pormenorizado', 'pormenorizado_visita'];
const FASES_VISITA = ['visita', 'pormenorizado_visita', 'avaria'];
// O que o email "pagamento recebido" diz a seguir, por fase (os 19 € antigos: `relatorio`, com ou sem visita).
const RELATORIO_PRONTO = 'O relatório completo fica pronto na sua conta depois de revisto pela nossa equipa (até 24 h).';
const MARCAR_VISITA = 'Vamos marcar a visita técnica: enviamos a data e a hora por email e ficam na sua conta.';
const TEXTO_PAGO = {
  relatorio_pormenorizado: RELATORIO_PRONTO, visita: MARCAR_VISITA, pormenorizado_visita: `${RELATORIO_PRONTO} ${MARCAR_VISITA}`,
  avaria: `O seu pedido foi recebido. ${MARCAR_VISITA}`,
  sinal: 'A proposta está aceite. Vamos contactá-lo para marcar a instalação.', restante: 'A obra está paga. Obrigado!',
  relatorio: 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h).',
  relatorio_visita: 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h) e vamos contactá-lo para marcar a visita técnica.',
};
const TEXTO_ESTADO = { pendente: 'Por pagar', pago: 'Pago', falhado: 'Falhou', cancelado: 'Cancelado', expirado: 'Expirou', devolvido: 'Devolvido' };
const NOME_METODO = { card: 'Cartão', mb_way: 'MB Way', multibanco: 'Multibanco' };

const euro = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const pct = (v) => `${String(v).replace('.', ',')} %`;

// ------------------------------------------------------------ IVA
export const IVA_OMISSAO = 23;
/** Valor com IVA (cêntimos) de um valor sem IVA. */
export const comIva = (baseCent, ivaPct) => Math.round((baseCent * (100 + ivaPct)) / 100);
/** Base e IVA (cêntimos) de um valor com IVA. */
export function partirIva(totalCent, ivaPct) {
  const base = Math.round((totalCent * 100) / (100 + ivaPct));
  return { base, iva: totalCent - base };
}
/** "19,00 € (15,45 € + IVA 23 % 3,55 €)" */
const euroComIva = (totalCent, ivaPct) => {
  const { base, iva } = partirIva(totalCent, ivaPct);
  return `${euro(totalCent)} (${euro(base)} + IVA ${pct(ivaPct)} ${euro(iva)})`;
};

// ------------------------------------------------------------ área servida (a mesma regra do simulador, §5.1)
const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const CONC = new Map(CONCELHOS.map(([nome, , ilha, lat, lon]) => [chave(nome), { nome, ilha, lat, lon }]));
export function concelho(texto) {
  const k = chave(texto);
  if (!k) return null;
  return CONC.get(k) ?? (String(texto).includes(',') ? CONC.get(chave(String(texto).split(',')[0])) : null) ?? null;
}
/** Distância estimada (km, sedes × 1,3) até à base; {c: null} sem concelho; fora = outra ilha ou acima do máximo. */
function distancia(localidade, cfg) {
  const c = concelho(localidade);
  const base = concelho(cfg.deslocacao_base ?? 'Lisboa') ?? concelho('Lisboa');
  if (!c || !base) return { c: null, km: null, fora: false };
  if ((c.ilha ?? null) !== (base.ilha ?? null)) return { c, km: null, fora: true };
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c.lat - base.lat) / 2) ** 2 + Math.cos(r(base.lat)) * Math.cos(r(c.lat)) * Math.sin(r(c.lon - base.lon) / 2) ** 2;
  const km = Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 1.3);
  const max = Number(cfg.deslocacao_max_km);
  return { c, km, fora: Number.isFinite(max) && km > max };
}
/** true = fora da área servida (outra ilha ou acima da distância máxima); false = dentro ou desconhecido (a visita confirma). */
export const foraDaArea = (localidade, cfg) => distancia(localidade, cfg).fora;
/**
 * Deslocação (€ c/ IVA) pela configuração do servidor, como o simulador (§5.1; web/simulador/deslocacao.js). Decisão 4
 * do dono (2026-10-02): ida e volta por cada dia de obra — um dia = fixo + km acima dos grátis × 2 × preço por km;
 * total = um dia × min(`dias`, `deslocacao_max_dias`) (no máximo 5 dias por obra; a visita técnica e a avaria são 1
 * dia). Concelho desconhecido → só o fixo; fora da área → null (não soma).
 */
export function deslocacaoServidor(localidade, cfg, dias = 1) {
  const d = distancia(localidade, cfg);
  const n = (k) => (Number.isFinite(Number(cfg[k])) ? Number(cfg[k]) : 0);
  if (d.fora) return null;
  const extra = d.km === null ? 0 : Math.max(0, d.km - n('deslocacao_km_gratis')) * 2 * n('deslocacao_preco_km_iva');
  const dia = Math.round((n('deslocacao_iva') + extra) * 100) / 100;
  const maxDias = Math.max(1, Math.round(numCfg(cfg, 'deslocacao_max_dias', DESLOCACAO_MAX_DIAS)));
  return Math.round(dia * Math.min(Math.max(1, Math.round(Number(dias)) || 1), maxDias) * 100) / 100;
}

/**
 * Sinal (cêntimos) de uma proposta COM IVA: o maior entre 30 % do valor e o custo do material (o sinal cobre o
 * material), menos TUDO o que já foi pago antes e é descontado (relatório, visita, avaria); nunca negativo e nunca
 * acima do que falta pagar.
 */
export function calcularSinal(valorComIvaCent, pagoAntesCent, custoMaterialCent = 0) {
  const bruto = Math.max(Math.round((valorComIvaCent * SINAL_PCT) / 100), custoMaterialCent || 0);
  return Math.max(0, Math.min(bruto, valorComIvaCent) - pagoAntesCent);
}

/** Valor da configuração (número ≥ 0) ou a omissão. */
const numCfg = (cfg, k, omissao) => {
  const v = Number(cfg?.[k]);
  return cfg?.[k] !== undefined && cfg?.[k] !== null && cfg?.[k] !== '' && Number.isFinite(v) && v >= 0 ? v : omissao;
};
const arredondar5 = (x) => Math.round(x / 5) * 5;
/**
 * Intervalo da estimativa (€, múltiplos de 5), como o simulador (preco.js): total − `intervalo_menos_pct` (10 %) a
 * total + `intervalo_mais_pct` (20 %). Sem as chaves novas (configuração antiga), `margem_intervalo_pct` para os dois.
 */
export function intervaloEstimativa(total, cfg) {
  const antiga = numCfg(cfg, 'margem_intervalo_pct', null);
  const menos = Math.min(100, numCfg(cfg, 'intervalo_menos_pct', antiga ?? 10)) / 100;
  const mais = numCfg(cfg, 'intervalo_mais_pct', antiga ?? 20) / 100;
  return { min: Math.max(0, arredondar5(total * (1 - menos))), max: arredondar5(total * (1 + mais)) };
}
/**
 * Métodos de pagamento de um valor (cêntimos c/ IVA): acima de `cartao_max_iva` (500 €) sai o cartão (uma contestação
 * de cartão tira o dinheiro depois da obra feita) e ficam o Multibanco e o MB Way.
 */
export function metodosPagamento(valorCent, cfg, metodos) {
  if (valorCent <= Math.round(numCfg(cfg, 'cartao_max_iva', CARTAO_MAX_OMISSAO) * 100)) return [...metodos];
  const sem = metodos.filter((m) => m !== 'card');
  return sem.length ? sem : ['multibanco'];
}
/** Dias de obra, como o simulador (preco.js diasDeObra): horas ÷ `horas_por_dia` (8), para cima; pelo menos 1. */
export function diasDeObra(horas, cfg) {
  const porDia = Number(cfg?.horas_por_dia) > 0 ? Number(cfg.horas_por_dia) : HORAS_DIA_OBRA;
  return Math.max(1, Math.ceil((Number(horas) || 0) / porDia));
}
/** Preço do relatório completo (cêntimos, c/ IVA): `preco_relatorio_iva` (29 €). */
export const precoRelatorioCent = (cfg) => Math.round(numCfg(cfg, 'preco_relatorio_iva', PRECO_RELATORIO_OMISSAO) * 100);
/** A localidade é um dos 308 concelhos (como o simulador a reconhece)? Sem isso não se vende a visita (B2). */
export const concelhoConhecido = (localidade) => concelho(localidade) !== null;
/**
 * Visita técnica (cêntimos, c/ IVA): a deslocação até à localidade + 0,5 h × `tarifa_hora_iva`. Fora da área servida
 * ou concelho não reconhecido → null (não há visita: a deslocação não se sabe).
 */
export function valorVisitaCent(localidade, cfg) {
  if (!concelhoConhecido(localidade)) return null;
  const d = deslocacaoServidor(localidade, cfg);
  if (d === null) return null;
  return Math.round((d + VISITA_HORAS * numCfg(cfg, 'tarifa_hora_iva', 38)) * 100);
}

/**
 * @param {{db, config, registo, relogio: () => number, auditar: Function, correio: object, fotos: object,
 *   sessao: (req, res) => object|null, criarOrcamento: (pedido: object, contaId: number) => number, stock?: object, fetch?: typeof fetch}} ctx
 */
export function criarPagamentosPedido({ db, config, registo, relogio, auditar, correio, fotos, sessao, criarOrcamento, stock = null, criarObra = null, fetch: fetchStripe = globalThis.fetch,
  visitaSemDefeito = () => null }) {
  const modo = config.pagamentosModo;
  const agoraIso = () => iso(relogio());
  const quem = (contaId) => ({ id: null, email: `conta:${contaId}` });
  const linha = (ref) => db.prepare('SELECT * FROM pagamentos_pedido WHERE ref = ?').get(ref);
  // Consultas preparadas uma só vez por texto (as listas chamam-nas pedido a pedido).
  const preparadas = new Map();
  const prep = (sql) => preparadas.get(sql) ?? preparadas.set(sql, db.prepare(sql)).get(sql);
  // A configuração só se volta a ler quando alguma coisa foi escrita na base (`total_changes()` da ligação).
  const alteracoes = db.prepare('SELECT total_changes() AS n');
  let cfgOrc = null, cfgOrcMarca = -1;
  const lerConfigOrc = () => {
    const n = alteracoes.get().n;
    if (n !== cfgOrcMarca) { cfgOrc = Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor])); cfgOrcMarca = n; }
    return { ...cfgOrc };
  };
  /** Taxa de IVA atual (%): a da configuração do painel ("iva_pct"), senão IVA_TAXA (omissão 23). */
  function ivaAtual() {
    const v = Number(lerConfigOrc().iva_pct);
    return Number.isFinite(v) && v >= 0 && v <= 50 ? v : (config.ivaTaxa ?? IVA_OMISSAO);
  }
  /** Taxa usada num pagamento (os anteriores à migração 11 eram os 19 € com IVA a 23 %). */
  const ivaDe = (p) => (Number.isFinite(p.iva_pct) ? p.iva_pct : IVA_OMISSAO);

  /** O que o cliente vê de um pagamento (nunca dados internos). Valor com IVA; base e IVA à parte. */
  function publico(p) {
    const iva = ivaDe(p);
    const partes = partirIva(p.valor_cent, iva);
    const r = {
      ref: p.ref, fase: p.fase, fase_texto: NOME_FASE[p.fase], valor: deCent(p.valor_cent), base: deCent(partes.base), iva: deCent(partes.iva), iva_pct: iva,
      descricao: p.descricao, estado: p.estado, estado_texto: TEXTO_ESTADO[p.estado], modo: p.modo, criado: p.criado, pago: p.pago,
      orcamento_id: p.orcamento_id, com_visita: p.com_visita === null ? null : Boolean(p.com_visita), plano: p.plano,
    };
    if (p.estado === 'pendente') {
      r.url = urlPagar(p);
      // Os métodos oferecidos (acima do limite do cartão: só Multibanco ou MB Way); a página simulada mostra-os.
      r.metodos = metodosPagamento(p.valor_cent, lerConfigOrc(), config.stripeMetodos ?? []).map((m) => NOME_METODO[m] ?? m);
    }
    if (p.devolvido_cent) { r.devolvido = deCent(p.devolvido_cent); r.devolvido_em = p.devolvido; }
    if (p.a_devolver) r.a_devolver = deCent(p.a_devolver);
    // "Visita não realizada — não desconta": o cliente faltou (o pagamento fica, mas não é descontado no sinal).
    // "Visita sem defeito — não desconta": a visita cobrada depois de um "Não" do cliente sem defeito (visitaExtra).
    if (p.faltou && eVisitaExtra(p)) r.sem_defeito = true;
    else if (p.faltou) r.nao_realizada = true;
    if (p.estado === 'pago') {
      r.recibo = { data: p.pago, valor: deCent(p.valor_cent), base: r.base, iva: r.iva, iva_pct: iva, descricao: p.descricao, referencia: p.ref, simulado: p.modo === 'simulado' };
    }
    return r;
  }

  /** Para onde vai o browser para pagar: a página simulada do site, ou a sessão do Stripe Checkout. */
  function urlPagar(p) {
    if (p.modo === 'simulado') return `pagamento-simulado.html?ref=${encodeURIComponent(p.ref)}`;
    return p.stripe_url ?? null;
  }
  /** Para onde volta depois do pagamento (sem nada vindo do browser: só o que ficou guardado). */
  const voltar = (p) => `${p.retorno === 'simulador' ? 'simulador.html' : 'conta.html'}?pagamento=${encodeURIComponent(p.ref)}`;

  // ------------------------------------------------------------ Stripe (API REST, sem SDK)
  async function stripe(metodo, caminho, params, idem) {
    if (!config.stripeChave) throw new ErroApi(503, 'Os pagamentos ainda não estão configurados neste servidor.');
    const corpo = params ? new URLSearchParams(params).toString() : undefined;
    const r = await fetchStripe(`${config.stripeApi}/v1/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${config.stripeChave}`,
        ...(corpo ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idem ? { 'Idempotency-Key': idem } : {}),
      },
      body: corpo,
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      registo.erro(`stripe ${metodo} ${caminho}: ${r.status} ${j?.error?.message ?? ''}`);
      throw new ErroApi(502, 'O serviço de pagamentos não respondeu. Tente de novo daqui a pouco.');
    }
    return j;
  }

  async function sessaoStripe(p, email) {
    if (!config.siteUrl) throw new ErroApi(503, 'Os pagamentos ainda não estão configurados neste servidor (falta o endereço do site).');
    const params = {
      mode: 'payment',
      client_reference_id: p.ref,
      'metadata[ref]': p.ref,
      'metadata[fase]': p.fase,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(p.valor_cent),
      'line_items[0][price_data][product_data][name]': p.descricao.slice(0, 250),
      success_url: `${config.siteUrl}/${voltar(p)}`,
      cancel_url: `${config.siteUrl}/${voltar(p)}&cancelado=1`,
      expires_at: String(Math.floor(Math.min(p.expira, relogio() + VALIDADE_MS - 60_000) / 1000)),
      locale: 'pt',
    };
    if (email) params.customer_email = email;
    metodosPagamento(p.valor_cent, lerConfigOrc(), config.stripeMetodos).forEach((m, i) => { params[`payment_method_types[${i}]`] = m; });
    const s = await stripe('POST', 'checkout/sessions', params, `domus-${p.ref}`);
    db.prepare('UPDATE pagamentos_pedido SET stripe_sessao = ?, stripe_url = ?, atualizado = ? WHERE id = ?').run(s.id, s.url, agoraIso(), p.id);
    return linha(p.ref);
  }

  /** Pagamento da "visita sem defeito" (visitaExtra): fase `visita` sem visita por marcar (`com_visita` = 0) e que não desconta (`faltou`). */
  const eVisitaExtra = (p) => p.fase === 'visita' && p.com_visita === 0 && Boolean(p.faltou);

  // ------------------------------------------------------------ criar
  const emailConta = (id) => db.prepare('SELECT email FROM contas WHERE id = ?').get(id)?.email ?? null;

  async function novo({ contaId, orcamentoId = null, fase, valorCent, descricao, retorno, comVisita = null, plano = null, pedido = null, ivaPct = null }) {
    if (modo === 'stripe' && !config.stripeChave) throw new ErroApi(503, 'Os pagamentos ainda não estão configurados neste servidor.');
    const ref = `pp_${randomBytes(16).toString('base64url')}`;
    const agora = agoraIso();
    db.prepare(`INSERT INTO pagamentos_pedido (ref, conta_id, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, com_visita, plano, pedido, criado, atualizado, expira, iva_pct)
      VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ref, contaId, orcamentoId, fase, valorCent, descricao, modo, retorno, comVisita === null ? null : comVisita ? 1 : 0, plano, pedido, agora, agora, relogio() + VALIDADE_MS, ivaPct ?? ivaAtual());
    let p = linha(ref);
    if (modo === 'stripe') {
      try { p = await sessaoStripe(p, emailConta(contaId)); } catch (e) {
        db.prepare('DELETE FROM pagamentos_pedido WHERE id = ?').run(p.id);
        throw e;
      }
    }
    auditar(quem(contaId), 'pagamento_criado', orcamentoId ? `orcamento:${orcamentoId}` : `conta:${contaId}`, { ref, fase, valor: deCent(valorCent), modo });
    return p;
  }

  /**
   * Avaria rápida (POST /api/orcamento com `funil: "avaria"`): paga-se ao enviar o diagnóstico (preço e horas do
   * artigo DIAG-AVARIA no catálogo × tarifa, como o simulador) e a deslocação até à localidade. O pedido fica guardado
   * no pagamento, "a aguardar pagamento" (não aparece no painel), e passa a orçamento quando o pagamento for
   * confirmado. Fora da área servida não se envia (409: fale connosco). Um pagamento por pagar da mesma conta é
   * reaproveitado (clicar duas vezes não cria dois), com o pedido novo.
   */
  async function iniciarAvaria({ conta, pedido, localidade }) {
    expirar();
    const valorCent = valorAvariaCent(localidade, lerConfigOrc());
    if (valorCent === 'fora') throw new ErroApi(409, 'A sua localidade fica fora da área servida: não enviamos técnico. Fale connosco por telefone ou WhatsApp.');
    if (!valorCent) throw new ErroApi(409, 'O preço do diagnóstico não está disponível agora. Fale connosco por telefone ou WhatsApp.');
    const descricao = `Diagnóstico da avaria e deslocação (${euro(valorCent)}, descontados na reparação)`;
    const json = JSON.stringify(pedido);
    const pend = db.prepare(`SELECT * FROM pagamentos_pedido WHERE conta_id = ? AND fase = 'avaria' AND estado = 'pendente' AND modo = ?
      AND expira > ? ORDER BY id DESC LIMIT 1`).get(conta.id, modo, relogio());
    if (pend && pend.valor_cent === valorCent) {
      db.prepare('UPDATE pagamentos_pedido SET pedido = ?, descricao = ?, atualizado = ? WHERE id = ?').run(json, descricao, agoraIso(), pend.id);
      return publico(linha(pend.ref));
    }
    if (pend) cancelar(pend, 'substituido');
    return publico(await novo({ contaId: conta.id, fase: 'avaria', valorCent, descricao, retorno: 'simulador', comVisita: true, pedido: json }));
  }

  /** Diagnóstico + deslocação (cêntimos c/ IVA); 'fora' fora da área servida; null sem o artigo no catálogo. */
  function valorAvariaCent(localidade, cfg) {
    const d = deslocacaoServidor(localidade ?? '', cfg);
    if (d === null) return 'fora';
    const a = artigo.get('DIAG-AVARIA') ?? diagnosticoPorFuncao();
    if (!a || !Number.isFinite(a.preco_venda_iva_cent)) return null;
    const tarifa = numCfg(cfg, 'tarifa_hora_iva', 38);
    return a.preco_venda_iva_cent + Math.round((Number(a.horas_instalacao) || 0) * tarifa * 100) + Math.round(d * 100);
  }
  const diagnosticoPorFuncao = () => db.prepare(`SELECT nome, preco_venda_iva_cent, horas_instalacao, horas_troca FROM catalogo
    WHERE ativo = 1 AND json_extract(especificacoes, '$.funcao') = 'diagnostico' ORDER BY id LIMIT 1`).get() ?? null;

  const pagoDe = (orcamentoId, fase) => prep('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = ? AND estado = \'pago\'').get(orcamentoId, fase);
  const marcas = (v) => v.map(() => '?').join(', ');
  const pagoEm = (orcamentoId, fases) => prep(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pago' AND fase IN (${marcas(fases)}) ORDER BY id LIMIT 1`).get(orcamentoId, ...fases);
  const totalPago = (orcamentoId) => prep('SELECT COALESCE(SUM(valor_cent - COALESCE(devolvido_cent, 0) - COALESCE(a_devolver, 0) - COALESCE(faltou_cent, 0)), 0) AS s FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = \'pago\'').get(orcamentoId).s;
  // O que foi devolvido (visita cancelada) não conta: por inteiro o pagamento fica `devolvido`; em parte, `devolvido_cent`.
  // Uma visita a que o cliente faltou também não (`faltou_cent`): fica paga, mas não se desconta no sinal nem na obra.
  const pagoAntes = (orcamentoId) => prep(`SELECT COALESCE(SUM(valor_cent - COALESCE(devolvido_cent, 0) - COALESCE(a_devolver, 0) - COALESCE(faltou_cent, 0)), 0) AS s FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pago'
    AND fase IN (${marcas(FASES_ANTES)})`).get(orcamentoId, ...FASES_ANTES).s;
  /** O cliente já pagou o relatório completo (ou os 19 € antigos)? */
  const temRelatorio = (o) => Boolean(pagoEm(o.id, FASES_RELATORIO));
  /** A visita técnica já está paga (visita, relatório + visita, avaria, ou os 19 € antigos com visita)? */
  const visitaPaga = db.prepare(`SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pago' AND COALESCE(com_visita, 1) = 1 AND faltou IS NULL
    AND fase IN (${marcas(FASES_VISITA)}) LIMIT 1`);
  const relatorioComVisita = db.prepare('SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = \'relatorio\' AND estado = \'pago\' AND com_visita = 1');
  const temVisita = (o) => Boolean(visitaPaga.get(o.id, ...FASES_VISITA)) || Boolean(relatorioComVisita.get(o.id));
  const simDe = (o) => { try { const s = JSON.parse(o.simulacao ?? 'null'); return s && typeof s === 'object' ? s : null; } catch { return null; } };
  const localidadeDe = (o) => o.localidade || simDe(o)?.casa?.localidade || '';
  /** Ainda se compra o relatório ou a visita: com simulação, antes de aceitar a proposta e da obra. */
  const podeComprar = (o) => Boolean(o.simulacao) && ['novo', 'contactado', 'visita_marcada', 'proposta_enviada'].includes(o.estado) && !o.proposta_aceite && !o.cliente;

  /**
   * Comprar o relatório completo, a visita técnica ou os dois (`fase`: relatorio_pormenorizado | visita |
   * pormenorizado_visita) para um pedido que já existe (enviado grátis). Valores do servidor: o relatório pela
   * configuração, a visita pela localidade do pedido. Um pagamento por pagar igual é reaproveitado; um que se sobrepõe
   * (ex.: os dois juntos e depois só o relatório) é cancelado. Falhar ou cancelar nunca mexe no pedido.
   */
  async function comprar(conta, o, fase, retorno = 'conta') {
    expirar();
    const inclui = COMPRAS[fase];
    if (!inclui) throw new ErroApi(400, 'Compra desconhecida.');
    if (!config.pagamentoPedido) throw new ErroApi(409, 'Os pagamentos online estão desligados. Fale connosco para pedir o relatório ou a visita.');
    // Avaria: o diagnóstico já inclui a visita; só se compra uma visita nova depois de o cliente faltar ao diagnóstico.
    if (simDe(o)?.funil === 'avaria' && (inclui.relatorio || temVisita(o))) throw new ErroApi(409, 'Na avaria, o diagnóstico já inclui a visita.');
    if (!podeComprar(o)) throw new ErroApi(409, 'Este pedido já não aceita esta compra.');
    if (inclui.relatorio && temRelatorio(o)) throw new ErroApi(409, 'Já comprou o relatório completo.');
    if (inclui.visita && temVisita(o)) throw new ErroApi(409, 'A visita técnica já está paga.');
    const cfg = lerConfigOrc();
    let valorCent = 0;
    const partes = [];
    if (inclui.relatorio) { valorCent += precoRelatorioCent(cfg); partes.push('relatório completo'); }
    if (inclui.visita) {
      const v = valorVisitaCent(localidadeDe(o), cfg);
      if (v === null && !concelhoConhecido(localidadeDe(o))) throw new ErroApi(409, 'Não reconhecemos o concelho da localidade: não é possível marcar a visita técnica. Fale connosco.');
      if (v === null) throw new ErroApi(409, 'A sua localidade fica fora da área servida: não há visita técnica. Fale connosco por telefone ou WhatsApp.');
      valorCent += v;
      partes.push('visita técnica');
    }
    if (!(valorCent > 0)) throw new ErroApi(409, 'Não há nada para pagar.');
    const descricao = `${partes.join(' e ').replace(/^./, (c) => c.toUpperCase())} do pedido n.º ${o.id} (descontado na obra)`;
    const pend = db.prepare(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pendente' AND expira > ? AND faltou IS NULL
      AND fase IN ('relatorio_pormenorizado', 'visita', 'pormenorizado_visita') ORDER BY id DESC`).all(o.id, relogio());
    let igual = null;
    for (const p of pend) {
      if (!igual && p.fase === fase && p.valor_cent === valorCent && p.modo === modo) { igual = p; continue; }
      const outro = COMPRAS[p.fase];
      if ((outro.relatorio && inclui.relatorio) || (outro.visita && inclui.visita)) cancelar(p, 'substituido');
    }
    if (igual) return publico(igual);
    return publico(await novo({ contaId: conta.id, orcamentoId: o.id, fase, valorCent, descricao, retorno, comVisita: inclui.visita }));
  }

  /** O que se pode comprar num pedido (conta e painel): preços do servidor e o que já está pago ou por pagar. */
  function compras(o) {
    const avaria = simDe(o)?.funil === 'avaria';
    const cfg = lerConfigOrc();
    const visitaCent = valorVisitaCent(localidadeDe(o), cfg);
    const semConcelho = !concelhoConhecido(localidadeDe(o));
    const pendente = (fases) => prep(`SELECT ref FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pendente' AND expira > ? AND faltou IS NULL
      AND fase IN (${marcas(fases)}) LIMIT 1`).get(o.id, relogio(), ...fases)?.ref ?? null;
    return {
      ativas: Boolean(config.pagamentoPedido),
      pode: podeComprar(o) && (!avaria || !temVisita(o)),
      avaria,
      relatorio: { valor: deCent(precoRelatorioCent(cfg)), comprado: temRelatorio(o), pendente: pendente(['relatorio_pormenorizado', 'pormenorizado_visita']) },
      // `sem_concelho`: localidade sem concelho reconhecido — sem visita (B2); `fora_area`: concelho fora da área servida.
      visita: { valor: visitaCent === null ? null : deCent(visitaCent), paga: temVisita(o), fora_area: visitaCent === null && !semConcelho, sem_concelho: semConcelho, pendente: pendente(['visita', 'pormenorizado_visita']) },
    };
  }

  const obraDe = db.prepare('SELECT estado FROM obras WHERE id = ?');
  const obraConcluida = (o) => Boolean(o.obra_concluida) || (o.obra_id ? obraDe.get(o.obra_id)?.estado === 'concluida' : false);

  /**
   * Custo do material de um pedido para o sinal (decisão 6): a soma dos artigos do pedido × o custo de compra do
   * catálogo quando TODOS o têm (`origem: 'custo'`); senão o material da proposta em três partes, pelo valor de venda
   * sem IVA (`origem: 'venda'`: nunca abaixo do custo, por isso é um substituto prudente); sem nenhum dos dois, null
   * (vale só a regra dos 30 %).
   */
  function materialDoSinal(o) {
    const c = stock?.custoMaterial(o) ?? null;
    if (c?.completo) return { cent: c.cent, origem: 'custo' };
    if (o.proposta_material_cent !== null && o.proposta_material_cent !== undefined) return { cent: o.proposta_material_cent, origem: 'venda' };
    return null;
  }

  /**
   * Valores de um orçamento (cêntimos), sempre calculados aqui a partir do valor da proposta (SEM IVA, como o painel o
   * guarda), da taxa de IVA e do que já foi pago: total = proposta + IVA, ou a obra mínima (`obra_minima_iva`, mais a
   * deslocação) quando o trabalho fica abaixo dela — nesse caso o que foi pago antes NÃO se desconta (`desconto` = 0); sinal = o maior entre
   * 30 % do total e o custo do material, menos o `desconto`; restante = total − o que já foi pago para a obra − o sinal
   * por pagar; `em_falta` = o que falta para a obra estar toda paga. Com o sinal pago, a taxa é a desse pagamento (não
   * muda a meio). Uma proposta de 0 € fica 0 (não há obra a cobrar).
   */
  function valores(o) {
    const antes = pagoAntes(o.id);
    const proposta = o.valor_proposta_cent;
    if (proposta === null || proposta === undefined) {
      return { pago_antes: antes, desconto: antes, sinal: null, restante: null, em_falta: null, proposta: null, base: null, total: null, iva: null, iva_pct: ivaAtual(), minima: null, material: null, sinal_material: false };
    }
    const sinalPago = pagoDe(o.id, 'sinal');
    const ivaPct = sinalPago ? ivaDe(sinalPago) : ivaAtual();
    const minimoCent = Math.round(numCfg(lerConfigOrc(), 'obra_minima_iva', OBRA_MINIMA_OMISSAO) * 100);
    // A obra mínima é sobre o trabalho (mão de obra + material); a deslocação da proposta em três partes soma por cima,
    // como no simulador. Numa proposta de um só valor compara-se o valor todo.
    const deslocacao = comIva(o.proposta_mao_obra_cent === null || o.proposta_mao_obra_cent === undefined ? 0 : o.proposta_deslocacao_cent ?? 0, ivaPct);
    const minima = proposta > 0 && comIva(proposta, ivaPct) - deslocacao < minimoCent;
    const total = minima ? minimoCent + deslocacao : comIva(proposta, ivaPct);
    const base = minima ? partirIva(total, ivaPct).base : proposta;
    const desconto = minima ? 0 : antes;
    // O material compara-se na mesma base do total: com IVA (custo de compra, ou valor de venda, × (1 + IVA)).
    const material = materialDoSinal(o);
    const materialIva = material ? comIva(material.cent, ivaPct) : 0;
    const sinal = sinalPago ? sinalPago.valor_cent : calcularSinal(total, desconto, materialIva);
    const pagoObra = totalPago(o.id) - (antes - desconto);
    return {
      pago_antes: antes, desconto, sinal, restante: Math.max(0, total - pagoObra - (sinalPago ? 0 : sinal)), em_falta: Math.max(0, total - pagoObra),
      proposta, base, total, iva: total - base, iva_pct: ivaPct, minima: minima ? minimoCent : null, material,
      sinal_material: Boolean(material) && materialIva > Math.round((total * SINAL_PCT) / 100),
    };
  }

  /** A proposta em três partes (€ sem IVA): {mao_obra, material, deslocacao}; null nas propostas de um só valor. */
  const partes = (o) => (o.proposta_mao_obra_cent === null || o.proposta_mao_obra_cent === undefined ? null
    : { mao_obra: deCent(o.proposta_mao_obra_cent), material: deCent(o.proposta_material_cent ?? 0), deslocacao: deCent(o.proposta_deslocacao_cent ?? 0) });

  /**
   * As três partes sugeridas ao CEO quando abre a proposta (€ sem IVA), recalculadas no servidor pelo catálogo: mão de
   * obra = horas × tarifa (com a que vai dentro dos artigos de preço fechado: é sobre ela que se calculam os 70 % do
   * eletricista); deslocação = ida e volta por dia de obra; material = o resto do relatório do cliente (artigos e
   * pacotes). A soma é o total do relatório. null sem simulação.
   */
  function propostaSugerida(o) {
    const r = o.simulacao ? relatorioCliente(o, true) : null;
    if (!r?.mao_obra) return null;
    const iva = ivaAtual();
    const semIva = (euros) => deCent(partirIva(Math.round(euros * 100), iva).base);
    const mao = r.mao_obra.valor + r._interno.mao_obra_incluida;
    const desloc = r.deslocacao ?? 0;
    return { mao_obra: semIva(mao), material: semIva(Math.max(0, r.total - mao - desloc)), deslocacao: semIva(desloc), horas: r._interno.horas };
  }

  /**
   * A casa (app, plano, automações) só se liga com a obra toda paga (decisão 1): {pode, falta (€), aviso}. Com os
   * pagamentos desligados, num pedido sem conta de cliente ou sem valor de proposta não há pagamento online: liga-se
   * como antes, com um aviso para confirmar por fora.
   */
  function ligacaoCasa(o) {
    const semOnline = !config.pagamentoPedido ? 'Pagamentos desligados' : !o.conta_id ? 'Pedido sem conta de cliente' : null;
    if (semOnline) return { pode: true, falta: null, aviso: `${semOnline}: confirme por fora que a obra está paga antes de ligar a casa.` };
    const v = valores(o);
    if (v.total === null) return { pode: true, falta: null, aviso: 'Pedido sem valor de proposta: confirme por fora que a obra está paga antes de ligar a casa.' };
    return { pode: v.em_falta === 0, falta: deCent(v.em_falta), aviso: null };
  }

  /** O restante da obra está pago? {pago, quando}: `quando` é a data do pagamento do restante (null sem pagamento online). */
  const restantePago = (o) => ({ pago: ligacaoCasa(o).pode, quando: pagoDe(o.id, 'restante')?.pago ?? null });

  /**
   * Quando se reserva (encomenda) o material de um pedido aceite (decisão 11): já, se o cliente pediu para começar já
   * (`inicio_imediato`); senão a partir de 14 dias depois do sinal (fim da livre resolução). null antes de aceite.
   */
  function reservaMaterial(o) {
    if (o.estado !== 'aceite') return null;
    const desde = pagoDe(o.id, 'sinal')?.pago ?? o.proposta_aceite ?? null;
    const ja = Boolean(o.inicio_imediato) || !desde;
    return { ja, inicio_imediato: o.inicio_imediato ?? null, a_partir: ja ? null : iso(Date.parse(desde) + DIAS_LIVRE_RESOLUCAO * 24 * 3600_000) };
  }

  /** "Quero que comecem já" (conta, ao aceitar ou ao pagar o sinal): só muda enquanto o sinal não está pago. */
  function definirInicioImediato(o, quer, contaId, ip = null) {
    if (o.estado !== 'proposta_enviada' || pagoDe(o.id, 'sinal') || Boolean(o.inicio_imediato) === quer) return;
    db.prepare('UPDATE orcamentos SET inicio_imediato = ?, atualizado = ? WHERE id = ?').run(quer ? agoraIso() : null, agoraIso(), o.id);
    auditar(quem(contaId), 'inicio_imediato', `orcamento:${o.id}`, { quer }, ip);
  }

  // ------------------------------------------------------------ visita: cancelar com devolução (decisão 10)
  /** Agora em Lisboa, lido como UTC: compara-se com `data_visita`, que é a hora de Lisboa sem fuso. */
  const agoraLisboaMs = () => Date.parse(`${new Date(relogio()).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).replace(' ', 'T')}Z`);
  /** ms que faltam para a visita marcada (negativo depois dela); null sem data. Só o dia = as 00:00. */
  function faltaParaVisita(o) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(o.data_visita ?? '');
    return m ? Date.parse(`${m[1]}T${m[2] ?? '00:00'}:00Z`) - agoraLisboaMs() : null;
  }
  /** O pagamento da visita técnica ou do diagnóstico da avaria que ainda vale (pago, não devolvido, sem falta). */
  const pagamentoVisita = (o) => db.prepare(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = 'pago' AND com_visita = 1 AND faltou IS NULL
    AND fase IN ('visita', 'pormenorizado_visita', 'avaria') ORDER BY id LIMIT 1`).get(o.id);
  /** A parte de um pagamento que é a visita (cêntimos): tudo, menos o relatório quando foram comprados juntos. */
  const parteVisita = (p) => (p.fase === 'pormenorizado_visita' ? p.valor_cent - precoRelatorioCent(lerConfigOrc()) : p.valor_cent);

  /**
   * O que a conta mostra sobre cancelar a visita paga: {pode, devolucao (€), motivo, faltou}. Com mais de 24 h de
   * antecedência (ou ainda sem data) devolve-se a visita toda; com menos, `motivo` diz que já não há devolução; depois da
   * hora, ou com "Cliente faltou" marcado no painel, não há nada para cancelar. null sem visita paga.
   */
  function visitaCancelar(o) {
    const p = pagamentoVisita(o);
    if (!p) return null;
    // `avaria`: é o diagnóstico da avaria (a mesma regra da visita: mais de 24 h antes da hora marcada, ou ainda sem
    // data, devolve-se tudo; uma avaria marcada para o próprio dia já não tem devolução).
    const avaria = p.fase === 'avaria';
    const r = { pode: false, devolucao: null, motivo: null, avaria };
    if (o.cliente || !['novo', 'contactado', 'visita_marcada'].includes(o.estado)) return r;
    const falta = faltaParaVisita(o);
    if (falta !== null && falta <= 0) return r;
    if (falta !== null && falta <= CANCELAR_VISITA_MS) return { ...r, motivo: `Já não é possível cancelar com devolução (faltam menos de 24 h para ${avaria ? 'o diagnóstico' : 'a visita'}).` };
    const dev = parteVisita(p);
    return dev > 0 ? { ...r, pode: true, devolucao: deCent(dev) } : r;
  }

  /**
   * "Cliente faltou" (painel): o pagamento da visita ou do diagnóstico fica `pago` (não se devolve) mas marcado
   * (`faltou`): deixa de contar como visita paga e NÃO é descontado no sinal (`faltou_cent`: a parte da visita). Para
   * avançar, o cliente marca e paga uma visita nova. Devolve a referência do pagamento marcado (ou null).
   */
  function marcarFalta(o) {
    const p = pagamentoVisita(o);
    if (!p) return null;
    db.prepare('UPDATE pagamentos_pedido SET faltou = ?, faltou_cent = ?, atualizado = ? WHERE id = ?').run(agoraIso(), Math.max(0, parteVisita(p)), agoraIso(), p.id);
    return p.ref;
  }

  /**
   * O CEO cancela a obra antes de ela ser feita e devolve o sinal (todo, ou `valorCent`: o sinal menos o material já
   * encomendado e os serviços prestados): Stripe → reembolso; modo simulado → só fica marcado. Devolve {ref, cent, modo}.
   */
  async function devolverSinal(o, valorCent = null) {
    const p = pagoDe(o.id, 'sinal');
    if (!p) throw new ErroApi(409, 'Este pedido não tem o sinal pago.');
    if (p.devolvido || p.a_devolver) throw new ErroApi(409, 'O sinal já foi devolvido.');
    if (obraConcluida(o) || pagoDe(o.id, 'restante')) throw new ErroApi(409, 'A obra já foi feita: o sinal já não se devolve aqui.');
    const cent = valorCent ?? p.valor_cent;
    if (!(cent > 0) || cent > p.valor_cent) throw new ErroApi(400, `O valor a devolver tem de estar entre 0,01 € e ${euro(p.valor_cent)}.`);
    const r = await devolver(p, cent, 'sinal');
    registo.info(`pagamento ${p.ref}: sinal ${r.manual ? 'a devolver por transferência' : 'devolvido'} (${euro(cent)}${p.modo === 'simulado' ? ', simulado' : ''}) — orçamento ${o.id}`);
    return r;
  }

  /** O pedido ficou aceite (sinal pago, ou sinal 0): o material fica reservado no stock e a obra nasce (uma vez). */
  function aoFicarAceite(orcamentoId, por) {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(orcamentoId);
    if (!o || o.estado !== 'aceite') return;
    stock?.reservar(o, por);
    criarObra?.(o, por);
  }

  /**
   * Devolve `cent` de um pagamento pago. Cartão e MB Way: automático pelo Stripe (API REST, sobre o PaymentIntent da
   * sessão do Checkout); modo simulado: só fica marcado. Pago por referência Multibanco (o Stripe não devolve sozinho):
   * devolução MANUAL por transferência — fica uma linha em `devolucoes_pedido` à espera do IBAN do cliente e o
   * pagamento com `a_devolver`; só conta como devolvido quando o CEO a marca como feita (`marcarDevolvida`).
   * `tiraVisita`: o pagamento deixa de valer como visita paga. Devolve {ref, cent, modo, manual}.
   */
  async function devolver(p, cent, motivo, { tiraVisita = false } = {}) {
    let metodo = p.metodo ?? null;
    let pi = null;
    if (p.modo === 'stripe') {
      if (!p.stripe_sessao) throw new ErroApi(409, 'Não foi possível devolver este pagamento automaticamente. Fale connosco.');
      const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(p.stripe_sessao)}?expand[]=payment_intent.latest_charge`);
      pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      metodo ??= s.payment_intent?.latest_charge?.payment_method_details?.type ?? null;
      if (!pi) throw new ErroApi(409, 'Não foi possível devolver este pagamento automaticamente. Fale connosco.');
    }
    const manual = metodo === 'multibanco';
    if (!manual && p.modo === 'stripe') {
      await stripe('POST', 'refunds', { payment_intent: pi, amount: String(cent), reason: 'requested_by_customer', 'metadata[ref]': p.ref }, `domus-reembolso-${p.ref}`);
    }
    const agora = agoraIso();
    const visita = tiraVisita ? ', com_visita = 0' : '';
    const u = manual
      ? db.prepare(`UPDATE pagamentos_pedido SET a_devolver = ?, metodo = ?${visita}, atualizado = ? WHERE id = ? AND estado = 'pago' AND devolvido IS NULL AND a_devolver IS NULL`).run(cent, metodo, agora, p.id)
      : db.prepare(`UPDATE pagamentos_pedido SET estado = ?, devolvido = ?, devolvido_cent = ?, metodo = COALESCE(?, metodo)${visita}, atualizado = ?
        WHERE id = ? AND estado = 'pago' AND devolvido IS NULL AND a_devolver IS NULL`).run(cent === p.valor_cent ? 'devolvido' : 'pago', agora, cent, metodo, agora, p.id);
    if (!u.changes) throw new ErroApi(409, 'Este pagamento já foi devolvido.');
    if (manual) {
      db.prepare(`INSERT INTO devolucoes_pedido (pagamento_id, conta_id, orcamento_id, valor_cent, motivo, estado, criado) VALUES (?, ?, ?, ?, ?, 'pede_iban', ?)`)
        .run(p.id, p.conta_id, p.orcamento_id, cent, motivo, agora);
    }
    return { ref: p.ref, cent, modo: p.modo, manual };
  }

  // ---- devoluções manuais por transferência (pagamentos por referência Multibanco)
  /** IBAN português válido ("PT50" + 21 algarismos, módulo 97), sem espaços e em maiúsculas; senão null. */
  function ibanPt(v) {
    const t = typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '';
    if (!/^PT50\d{21}$/.test(t)) return null;
    // ISO 13616: os 4 primeiros caracteres vão para o fim, as letras passam a números (P = 25, T = 29); resto 1.
    const digitos = `${t.slice(4)}2529${t.slice(2, 4)}`;
    let resto = 0;
    for (const d of digitos) resto = (resto * 10 + Number(d)) % 97;
    return resto === 1 ? t : null;
  }
  /** "PT50 •••• 0154": só o país e os 4 últimos algarismos (listas, conta, depois de devolvido). */
  const ibanMascarado = (iban) => (iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : null);
  const TEXTO_DEVOLUCAO = { pede_iban: 'À espera do IBAN do cliente', por_fazer: 'Devolução por fazer', devolvido: 'Devolvido' };
  const NOME_MOTIVO = { visita: 'Visita técnica cancelada', diagnostico: 'Diagnóstico cancelado', sinal: 'Sinal devolvido' };
  /** Uma devolução manual para a conta e para as listas: o IBAN sempre mascarado. `completo` (só CEO, por fazer): o IBAN inteiro. */
  function devolucaoPublica(d, completo = false) {
    return {
      id: d.id, orcamento_id: d.orcamento_id, valor: deCent(d.valor_cent), motivo: d.motivo, motivo_texto: NOME_MOTIVO[d.motivo], estado: d.estado, estado_texto: TEXTO_DEVOLUCAO[d.estado],
      iban: completo && d.estado === 'por_fazer' ? d.iban : ibanMascarado(d.iban), titular: d.titular ?? null,
      criado: d.criado, devolvido: d.devolvido ?? null, ...(completo ? { devolvido_por: d.devolvido_por ?? null } : {}),
    };
  }
  const devolucoesDoPedido = (orcamentoId, completo = false) => db.prepare('SELECT * FROM devolucoes_pedido WHERE orcamento_id = ? ORDER BY id').all(orcamentoId).map((d) => devolucaoPublica(d, completo));
  /** As devoluções ainda por fazer (painel → Pagamentos, só CEO), com o IBAN inteiro e o titular. */
  const devolucoesPorFazer = () => db.prepare("SELECT * FROM devolucoes_pedido WHERE estado != 'devolvido' ORDER BY id").all().map((d) => devolucaoPublica(d, true));

  /** A conta dá o IBAN e o titular de uma devolução sua que está à espera (ou corrige-os enquanto não foi feita). */
  function darIban(c, id, iban, titular) {
    const d = db.prepare('SELECT * FROM devolucoes_pedido WHERE id = ? AND conta_id = ?').get(id, c.id);
    if (!d) throw new ErroApi(404, 'Devolução não encontrada.');
    if (d.estado === 'devolvido') throw new ErroApi(409, 'Esta devolução já foi feita.');
    const limpo = ibanPt(iban);
    if (!limpo) throw new ErroApi(400, 'IBAN inválido: escreva um IBAN português (PT50 e 21 algarismos).');
    db.prepare("UPDATE devolucoes_pedido SET iban = ?, titular = ?, estado = 'por_fazer' WHERE id = ?").run(limpo, titular, d.id);
    // O IBAN nunca vai para a auditoria nem para o registo.
    auditar(quem(c.id), 'devolucao_iban', d.orcamento_id ? `orcamento:${d.orcamento_id}` : `conta:${c.id}`, { devolucao: d.id, valor: deCent(d.valor_cent) });
    return devolucaoPublica(db.prepare('SELECT * FROM devolucoes_pedido WHERE id = ?').get(d.id));
  }

  /**
   * O CEO fez a transferência e marca "Devolvido" (data e quem): só agora o pagamento conta como devolvido (totais e
   * CSV), e do IBAN fica guardado só o fim ("PT50 •••• 0154").
   */
  function marcarDevolvida(id, por) {
    const d = db.prepare('SELECT * FROM devolucoes_pedido WHERE id = ?').get(id);
    if (!d) throw new ErroApi(404, 'Devolução não encontrada.');
    if (d.estado === 'devolvido') throw new ErroApi(409, 'Esta devolução já está marcada como feita.');
    if (d.estado === 'pede_iban') throw new ErroApi(409, 'O cliente ainda não indicou o IBAN.');
    const agora = agoraIso();
    const p = db.prepare('SELECT * FROM pagamentos_pedido WHERE id = ?').get(d.pagamento_id);
    db.prepare("UPDATE devolucoes_pedido SET estado = 'devolvido', devolvido = ?, devolvido_por = ?, iban = ? WHERE id = ?").run(agora, por, ibanMascarado(d.iban), d.id);
    db.prepare('UPDATE pagamentos_pedido SET estado = ?, devolvido = ?, devolvido_cent = ?, a_devolver = NULL, atualizado = ? WHERE id = ?')
      .run(d.valor_cent === p.valor_cent ? 'devolvido' : 'pago', agora, d.valor_cent, agora, p.id);
    return { ...devolucaoPublica(db.prepare('SELECT * FROM devolucoes_pedido WHERE id = ?').get(d.id), true), ref: p.ref, conta_id: d.conta_id };
  }

  /**
   * O cliente cancela a visita técnica com mais de 24 h de antecedência: a visita é devolvida (Stripe: reembolso; modo
   * simulado: só fica marcada), a data sai e o pedido volta a "contactado". A visita comprada com o relatório devolve
   * só a parte da visita (o pagamento continua `pago`, com `devolvido_cent`).
   */
  async function cancelarVisita(c, o, ip = null) {
    const info = visitaCancelar(o);
    if (!info) throw new ErroApi(409, 'Este pedido não tem uma visita técnica paga.');
    if (!info.pode) throw new ErroApi(409, info.motivo ?? (info.avaria ? 'Este diagnóstico já não se pode cancelar.' : 'Esta visita já não se pode cancelar.'));
    const p = pagamentoVisita(o);
    const cent = Math.round(info.devolucao * 100);
    const r = await devolver(p, cent, info.avaria ? 'diagnostico' : 'visita', { tiraVisita: true });
    const agora = agoraIso();
    // A visita sai e o pedido volta a "contactado"; a avaria era só o diagnóstico: cancelado, o pedido fica fechado.
    if (info.avaria) db.prepare("UPDATE orcamentos SET data_visita = NULL, estado = 'perdido', motivo_perda = 'Diagnóstico cancelado pelo cliente (devolvido).', atualizado = ? WHERE id = ?").run(agora, o.id);
    else db.prepare("UPDATE orcamentos SET data_visita = NULL, estado = CASE WHEN estado = 'visita_marcada' THEN 'contactado' ELSE estado END, atualizado = ? WHERE id = ?").run(agora, o.id);
    auditar(quem(c.id), 'visita_cancelada_cliente', `orcamento:${o.id}`, { ref: p.ref, devolvido: deCent(cent), modo: p.modo, data_visita: o.data_visita ?? null, ...(info.avaria ? { avaria: true } : {}), ...(r.manual ? { manual: true } : {}) }, ip);
    registo.info(`pagamento ${p.ref}: visita cancelada pelo cliente, ${euro(cent)} ${r.manual ? 'a devolver por transferência' : 'devolvidos'}${p.modo === 'simulado' ? ' (simulado)' : ''} — orçamento ${o.id}`);
    const para = emailConta(c.id);
    if (para) {
      correio.enviar({ para, assunto: 'Domus Energia: visita cancelada', resumo: `visita do pedido ${o.id} cancelada; ${euro(cent)} ${r.manual ? 'a devolver por transferência' : 'devolvidos'}`,
        texto: ['Olá,', '', `Cancelou ${info.avaria ? 'o diagnóstico da avaria' : 'a visita técnica'} do pedido n.º ${o.id}.`,
          r.manual ? `Como pagou por referência Multibanco, devolvemos ${euro(cent)} por transferência bancária: indique o IBAN na sua conta.`
            : `Devolvemos ${euro(cent)} para o mesmo meio de pagamento (até 14 dias)${p.modo === 'simulado' ? ' (SIMULAÇÃO: não foi cobrado nem devolvido nada)' : ''}.`,
          info.avaria ? 'Se voltar a precisar, envie um novo pedido.' : 'Pode marcar outra visita na sua conta quando quiser.', ...(config.siteUrl ? ['', `A sua conta: ${config.siteUrl}/conta.html`] : []), '', 'Domus Energia'].join('\n') });
    }
    return { devolvido: deCent(cent), manual: r.manual };
  }

  /** Sinal ao aceitar a proposta, ou o restante no fim da obra (POST pedidos/:id/pagar e aceitar). */
  async function pagarFase(conta, o, fase) {
    expirar();
    if (pagoDe(o.id, fase)) throw new ErroApi(409, fase === 'sinal' ? 'O sinal já está pago.' : 'Este pagamento já está feito.');
    const v = valores(o);
    let valorCent;
    let descricao;
    if (fase === 'sinal') {
      if (!o.proposta_aceite || o.estado !== 'proposta_enviada') throw new ErroApi(409, 'Aceite primeiro a proposta.');
      valorCent = v.sinal;
      descricao = `${v.sinal_material ? 'Sinal da proposta' : `Sinal de ${SINAL_PCT} % da proposta`} do pedido n.º ${o.id} (${euro(v.total)} com IVA)${v.sinal_material ? ': cobre o material' : ''}${v.desconto ? `, menos os ${euro(v.desconto)} já pagos` : ''}`;
    } else {
      if (o.estado !== 'aceite' || !pagoDe(o.id, 'sinal') && valores(o).sinal > 0) throw new ErroApi(409, 'Ainda não há nada para pagar neste pedido.');
      if (!obraConcluida(o)) throw new ErroApi(409, 'O restante paga-se quando a obra estiver concluída.');
      valorCent = v.restante;
      descricao = `Restante da obra do pedido n.º ${o.id} (${euro(v.total)} com IVA, menos o que já foi pago)`;
    }
    if (!(valorCent > 0)) throw new ErroApi(409, 'Não há nada para pagar.');
    const pend = db.prepare(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = ? AND estado = 'pendente' AND expira > ? AND modo = ? ORDER BY id DESC LIMIT 1`)
      .get(o.id, fase, relogio(), modo);
    if (pend && pend.valor_cent === valorCent) return publico(pend);
    if (pend) cancelar(pend, 'valor_mudou');
    return publico(await novo({ contaId: conta.id, orcamentoId: o.id, fase, valorCent, descricao, retorno: 'conta', plano: fase === 'sinal' ? o.plano_escolhido : null, ivaPct: v.iva_pct }));
  }

  /**
   * "Visita sem defeito" (decisão 8 do dono; docs/ELETRICISTAS.md): o cliente disse que o trabalho não ficou concluído,
   * o técnico voltou e o CEO decidiu que não havia defeito — o cliente paga uma visita (o mesmo valor da visita técnica:
   * deslocação + 0,5 h). `visitaSemDefeito(o)` (eletricistas.js) dá a data da decisão. É um pagamento da fase `visita`
   * que NÃO desconta na obra nem conta como visita por marcar: `com_visita` = 0 e `faltou`/`faltou_cent` preenchidos
   * logo ao criar. Devolve {valor, paga, pendente} ou null (nada a cobrar).
   */
  function visitaExtra(o) {
    const desde = visitaSemDefeito(o);
    if (!desde) return null;
    const linhas = db.prepare(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'visita' AND com_visita = 0 AND faltou IS NOT NULL AND criado >= ? ORDER BY id DESC`).all(o.id, desde);
    const paga = linhas.find((p) => p.estado === 'pago') ?? null;
    const pend = linhas.find((p) => p.estado === 'pendente' && p.expira > relogio()) ?? null;
    const valorCent = paga?.valor_cent ?? valorVisitaCent(localidadeDe(o), lerConfigOrc());
    return { valor: deCent(valorCent), paga: Boolean(paga), pendente: pend?.ref ?? null, desde };
  }
  /** A data em que o cliente pagou a visita sem defeito decidida em `desde` (ou null): a ida do eletricista conta a partir dela. */
  const visitaExtraPaga = (o, desde) => (desde ? db.prepare(`SELECT pago FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'visita' AND com_visita = 0 AND faltou IS NOT NULL
    AND estado = 'pago' AND criado >= ? ORDER BY id LIMIT 1`).get(o.id, desde)?.pago ?? null : null);
  async function pagarVisitaExtra(conta, o) {
    expirar();
    const x = visitaExtra(o);
    if (!x) throw new ErroApi(409, 'Não há nada para pagar.');
    if (x.paga) throw new ErroApi(409, 'Este pagamento já está feito.');
    const valorCent = valorVisitaCent(localidadeDe(o), lerConfigOrc());
    if (!(valorCent > 0)) throw new ErroApi(409, 'Não foi possível calcular o valor da visita. Fale connosco.');
    const pend = x.pendente ? linha(x.pendente) : null;
    if (pend && pend.valor_cent === valorCent && pend.modo === modo) return publico(pend);
    if (pend) cancelar(pend, 'valor_mudou');
    const p = await novo({ contaId: conta.id, orcamentoId: o.id, fase: 'visita', valorCent, retorno: 'conta', comVisita: false,
      descricao: `Visita sem defeito encontrado (pedido n.º ${o.id}): não é descontada na obra` });
    db.prepare('UPDATE pagamentos_pedido SET faltou = ?, faltou_cent = valor_cent WHERE id = ?').run(agoraIso(), p.id);
    return publico(linha(p.ref));
  }

  /** O cliente aceitou a proposta (conta.js): sinal por pagar, ou (sinal 0) aceite logo. Devolve o pagamento ou null. */
  async function aoAceitar(conta, o) {
    const v = valores(o);
    if (!(v.sinal > 0)) {
      db.prepare('UPDATE orcamentos SET estado = \'aceite\', atualizado = ? WHERE id = ? AND estado = \'proposta_enviada\'').run(agoraIso(), o.id);
      aoFicarAceite(o.id, quem(conta.id).email);
      return null;
    }
    return pagarFase(conta, o, 'sinal');
  }

  /**
   * O que o cliente já foi chamado a pagar e ainda não pagou (emails automáticos, docs/EMAILS-AUTOMATICOS.md): o sinal de
   * uma proposta que aceitou online, ou o restante de uma obra dada por concluída no painel. {fase, desde, cent,
   * a_pagar}: `desde` = quando foi pedido (aceitou a proposta / obra concluída); `a_pagar` = tem um pagamento aberto
   * ainda válido (ex.: uma referência Multibanco gerada há menos de 24 h). null sem nada em falta, com os pagamentos
   * desligados ou num pedido sem conta (não se paga online).
   */
  function emFalta(o) {
    if (!config.pagamentoPedido || !o.conta_id) return null;
    const fase = o.estado === 'proposta_enviada' && o.proposta_aceite ? 'sinal' : o.estado === 'aceite' && o.obra_concluida ? 'restante' : null;
    if (!fase || pagoDe(o.id, fase)) return null;
    const cent = valores(o)[fase];
    if (!(cent > 0)) return null;
    const aPagar = Boolean(db.prepare("SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = ? AND estado = 'pendente' AND expira > ? LIMIT 1").get(o.id, fase, relogio()));
    return { fase, desde: fase === 'sinal' ? o.proposta_aceite : o.obra_concluida, cent, a_pagar: aPagar };
  }

  function cancelar(p, motivo) {
    db.prepare('UPDATE pagamentos_pedido SET estado = \'cancelado\', pedido = NULL, atualizado = ? WHERE id = ? AND estado = \'pendente\'').run(agoraIso(), p.id);
    auditar(null, 'pagamento_cancelado', p.orcamento_id ? `orcamento:${p.orcamento_id}` : `conta:${p.conta_id}`, { ref: p.ref, fase: p.fase, motivo });
    if (p.modo === 'stripe' && p.stripe_sessao) stripe('POST', `checkout/sessions/${p.stripe_sessao}/expire`).catch(() => {});
  }

  /** O painel mudou a proposta de um pedido aceite a aguardar o sinal: o sinal por pagar sai e o cliente aceita de novo. */
  function aoMudarProposta(orcamentoId) {
    const pend = db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = \'sinal\' AND estado = \'pendente\'').all(orcamentoId);
    for (const p of pend) cancelar(p, 'proposta_mudou');
    db.prepare('UPDATE orcamentos SET proposta_aceite = NULL WHERE id = ? AND estado = \'proposta_enviada\'').run(orcamentoId);
  }

  // ------------------------------------------------------------ eventos (webhook do Stripe e simulação)
  const eventoVisto = db.prepare('SELECT 1 FROM pagamentos_eventos WHERE id = ?');
  const marcarEvento = db.prepare('INSERT OR IGNORE INTO pagamentos_eventos (id, recebido) VALUES (?, ?)');

  /**
   * Trata um evento no formato do Stripe ({id, type, data: {object: checkout.session}}), venha do webhook, do
   * regresso do cliente (sessão lida no Stripe) ou da página simulada. Idempotente: o mesmo id não é tratado duas
   * vezes e um pagamento pago não volta a ser pago. Devolve 'pago' | 'falhado' | 'cancelado' | 'repetido' | 'ignorado'.
   */
  function tratarEvento(ev) {
    if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string') return 'ignorado';
    if (eventoVisto.get(ev.id)) return 'repetido';
    const s = ev.data?.object;
    const ref = s?.client_reference_id ?? s?.metadata?.ref;
    const p = typeof ref === 'string' && RE_REF.test(ref) ? linha(ref) : null;
    if (!p || !s || s.object !== 'checkout.session') { marcarEvento.run(ev.id, agoraIso()); return 'ignorado'; }
    // Só vale para o pagamento certo: mesma sessão (Stripe), mesmo valor e em euros.
    if ((p.modo === 'stripe' && s.id !== p.stripe_sessao) || s.amount_total !== p.valor_cent || String(s.currency).toLowerCase() !== 'eur') {
      registo.aviso(`pagamento ${p.ref}: evento ${ev.id} não corresponde (sessão, valor ou moeda) — ignorado`);
      marcarEvento.run(ev.id, agoraIso());
      return 'ignorado';
    }
    let r = 'ignorado';
    // O Multibanco é o único método que confirma depois (evento assíncrono): fica anotado para uma devolução futura.
    if (ev.type === 'checkout.session.async_payment_succeeded' && !p.metodo) db.prepare("UPDATE pagamentos_pedido SET metodo = 'multibanco' WHERE id = ?").run(p.id);
    if ((ev.type === 'checkout.session.completed' && s.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') r = confirmar(p);
    else if (ev.type === 'checkout.session.async_payment_failed') r = falhar(p, 'falhado');
    else if (ev.type === 'checkout.session.expired') r = falhar(p, 'cancelado');
    marcarEvento.run(ev.id, agoraIso());
    return r;
  }

  function confirmar(p) {
    db.exec('BEGIN IMMEDIATE');
    let orcamentoId = p.orcamento_id;
    try {
      // Um pagamento que o Stripe confirma depois de expirado (ex.: Multibanco pago tarde) também conta: o dinheiro entrou.
      const u = db.prepare(`UPDATE pagamentos_pedido SET estado = 'pago', pago = ?, atualizado = ? WHERE id = ? AND estado != 'pago'`).run(agoraIso(), agoraIso(), p.id);
      if (!u.changes) { db.exec('ROLLBACK'); return 'repetido'; }
      // A avaria (e os 19 € antigos por pagar) guardam o pedido no pagamento: só agora passa a orçamento.
      if ((p.fase === 'avaria' || p.fase === 'relatorio') && !p.orcamento_id) {
        if (!p.pedido) throw new Error(`pagamento ${p.ref}: pago sem o pedido guardado`);
        orcamentoId = criarOrcamento({ ...JSON.parse(p.pedido), pagamento: p.ref, com_visita: Boolean(p.com_visita) }, p.conta_id);
        db.prepare('UPDATE pagamentos_pedido SET orcamento_id = ?, pedido = NULL WHERE id = ?').run(orcamentoId, p.id);
      } else if (p.fase === 'sinal') {
        const a = db.prepare('UPDATE orcamentos SET estado = \'aceite\', atualizado = ? WHERE id = ? AND estado = \'proposta_enviada\'').run(agoraIso(), p.orcamento_id);
        if (a.changes) auditar(quem(p.conta_id), 'proposta_aceite_cliente', `orcamento:${p.orcamento_id}`, { estado: 'aceite', via: 'online', sinal: deCent(p.valor_cent), plano: p.plano });
        // Sinal pago: o material do pedido fica reservado no stock (decisão 13) e a obra nasce, por agendar (a casa só
        // se liga depois, com o restante pago). Um segundo evento do mesmo pagamento não chega aqui.
        if (a.changes) aoFicarAceite(p.orcamento_id, quem(p.conta_id).email);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      registo.erro(`pagamento ${p.ref}: ${e?.stack || e}`);
      throw e;
    }
    auditar(null, 'pagamento_confirmado', `orcamento:${orcamentoId}`, { ref: p.ref, fase: p.fase, valor: deCent(p.valor_cent), modo: p.modo });
    registo.info(`pagamento ${p.ref} (${p.fase}, ${euro(p.valor_cent)}${p.modo === 'simulado' ? ', simulado' : ''}) confirmado — orçamento ${orcamentoId}`);
    avisarEmail(linha(p.ref), 'pago');
    return 'pago';
  }

  function falhar(p, estado) {
    // O pedido guardado sai logo: tentar de novo volta a enviar a simulação (nada fica para lá do necessário).
    const u = db.prepare('UPDATE pagamentos_pedido SET estado = ?, pedido = NULL, atualizado = ? WHERE id = ? AND estado = \'pendente\'').run(estado, agoraIso(), p.id);
    if (!u.changes) return 'repetido';
    auditar(null, estado === 'falhado' ? 'pagamento_falhado' : 'pagamento_cancelado', p.orcamento_id ? `orcamento:${p.orcamento_id}` : `conta:${p.conta_id}`, { ref: p.ref, fase: p.fase, modo: p.modo });
    if (estado === 'falhado') avisarEmail(linha(p.ref), 'falhado');
    return estado;
  }

  function avisarEmail(p, tipo) {
    const para = p.conta_id ? emailConta(p.conta_id) : null;
    if (!para) return;
    const site = config.siteUrl ? `${config.siteUrl}/conta.html` : null;
    const sim = p.modo === 'simulado' ? ' (SIMULAÇÃO: não foi cobrado nada)' : '';
    const texto = tipo === 'pago' ? [
      'Olá,', '', `Recebemos o seu pagamento${sim}.`, '',
      `  Descrição: ${p.descricao}`, `  Valor: ${euroComIva(p.valor_cent, ivaDe(p))}`, `  Data: ${new Date(p.pago).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, `  Referência: ${p.ref}`, '',
      eVisitaExtra(p) ? 'Este pagamento é da visita em que não encontrámos defeito: não é descontado na obra.' : TEXTO_PAGO[p.fase] ?? (p.com_visita ? TEXTO_PAGO.relatorio_visita : TEXTO_PAGO.relatorio),
      ...(site ? ['', `A sua conta: ${site}`] : []), '', 'Domus Energia',
    ] : [
      'Olá,', '', `O pagamento "${p.descricao}" (${euro(p.valor_cent)} com IVA) não foi concluído${sim}. Não foi cobrado nada.`,
      'Pode tentar de novo quando quiser.', ...(site ? ['', `A sua conta: ${site}`] : []), '', 'Domus Energia',
    ];
    correio.enviar({ para, assunto: tipo === 'pago' ? 'Domus Energia: pagamento recebido' : 'Domus Energia: pagamento não concluído',
      texto: texto.join('\n'), resumo: `pagamento ${tipo} ${p.ref} (${p.fase}, ${euro(p.valor_cent)}${p.modo === 'simulado' ? ', simulado' : ''})` });
  }

  /** Stripe: no regresso do cliente, lê a sessão e trata-a como um evento (o webhook pode chegar depois). */
  async function sincronizar(p) {
    if (p.modo !== 'stripe' || p.estado !== 'pendente' || !p.stripe_sessao || !config.stripeChave) return p;
    try {
      const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(p.stripe_sessao)}`);
      const tipo = s.status === 'complete' && s.payment_status === 'paid' ? 'checkout.session.completed'
        : s.status === 'expired' ? 'checkout.session.expired' : null;
      if (tipo) tratarEvento({ id: `ret_${s.id}_${s.status}_${s.payment_status}`, type: tipo, data: { object: s } });
    } catch (e) {
      registo.aviso(`pagamento ${p.ref}: não foi possível ler a sessão no Stripe (${e.message})`);
    }
    return linha(p.ref);
  }

  // ------------------------------------------------------------ expiração (24 h)
  function expirar() {
    const agora = relogio();
    const velhos = db.prepare('SELECT * FROM pagamentos_pedido WHERE estado = \'pendente\' AND expira <= ?').all(agora);
    for (const p of velhos) {
      db.prepare('UPDATE pagamentos_pedido SET estado = \'expirado\', pedido = NULL, atualizado = ? WHERE id = ? AND estado = \'pendente\'').run(agoraIso(), p.id);
      auditar(null, 'pagamento_expirado', p.orcamento_id ? `orcamento:${p.orcamento_id}` : `conta:${p.conta_id}`, { ref: p.ref, fase: p.fase });
    }
    // Os pedidos guardados de pagamentos que falharam ou foram cancelados também não ficam para lá das 24 h.
    db.prepare('UPDATE pagamentos_pedido SET pedido = NULL WHERE pedido IS NOT NULL AND estado != \'pendente\' AND expira <= ?').run(agora);
    db.prepare('DELETE FROM pagamentos_eventos WHERE recebido < ?').run(iso(agora - 90 * 24 * 3600_000));
    return velhos.length;
  }
  let temporizador = null;
  function iniciar(intervaloMs = 15 * 60_000) {
    temporizador = setInterval(() => { try { expirar(); } catch (e) { registo.erro(`pagamentos: ${e?.stack || e}`); } }, intervaloMs);
    temporizador.unref();
  }
  const parar = () => clearInterval(temporizador);

  // ------------------------------------------------------------ relatório para o cliente
  const artigo = db.prepare('SELECT nome, preco_venda_iva_cent, horas_instalacao, horas_troca, especificacoes FROM catalogo WHERE sku = ?');
  /** Artigo de preço fechado (ronda dinheiro; web/simulador/preco.js precoFechado): a mão de obra vai dentro do preço. */
  const precoFechado = (a) => { try { return JSON.parse(a?.especificacoes || '{}')?.preco_fechado === true; } catch { return false; } };
  const SKU_DIVISAO = [
    ['estores', 'BAB-CURTAIN', 'estore automático', 'estores automáticos'],
    ['sensores_porta', 'SENS-PORTA-WIFI', 'aviso de porta ou janela aberta', 'avisos de porta ou janela aberta'],
    ['sensores_movimento', 'SENS-PIR-WIFI', 'sensor de movimento', 'sensores de movimento'],
    ['luzes_regulaveis', 'DIMMER-WIFI', 'luz com intensidade regulável', 'luzes com intensidade regulável'],
    ['tomadas_inteligentes', 'TOMADA-WIFI', 'tomada inteligente', 'tomadas inteligentes'],
  ];
  // Lista de trabalho (lote 7, `simulacao.trabalho`): nomes simples por tipo de aparelho e ação.
  const NOME_TIPO = {
    luz: ['ponto de luz', 'pontos de luz'], interruptor: ['interruptor', 'interruptores'], tomada: ['tomada', 'tomadas'],
    janela: ['estore', 'estores'], sensor_movimento: ['sensor de movimento', 'sensores de movimento'],
    sensor_porta: ['aviso de porta ou janela aberta', 'avisos de porta ou janela aberta'], maquina: ['máquina', 'máquinas'],
  };
  const NOME_MAQUINA = {
    termoacumulador: 'termoacumulador', ar_condicionado: 'ar condicionado', placa: 'placa', forno: 'forno', maquina_lavar: 'máquina de lavar',
    maquina_secar: 'máquina de secar', maquina_loica: 'máquina da loiça', frigorifico: 'frigorífico', televisao: 'televisão', bomba_calor: 'bomba de calor',
    carregador_ve: 'carregador do carro', esquentador: 'esquentador', radiador: 'aquecedor', micro_ondas: 'micro-ondas', exaustor: 'exaustor',
  };
  const ACAO_TEXTO = { reparar: 'Reparar', substituir: 'Substituir', novo: 'Novo' };
  const ORDEM_ACAO = ['reparar', 'substituir', 'novo'];
  const inteiro = (v, max) => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : 0);
  const txtCurto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

  /** "2 tomadas", "1 máquina de lavar" (máquinas pelo modelo, quando se conhece). */
  function nomeAparelho(a, n) {
    if (a.tipo === 'maquina' && NOME_MAQUINA[a.modelo]) return n === 1 ? `1 ${NOME_MAQUINA[a.modelo]}` : `${n} × ${NOME_MAQUINA[a.modelo]}`;
    const [um, varios] = NOME_TIPO[a.tipo] ?? ['aparelho', 'aparelhos'];
    return `${n} ${n === 1 ? um : varios}`;
  }
  /** Uma linha da lista de trabalho: "Reparar: 1 tomada («não dá corrente»; ver foto)" · "Substituir: 2 interruptores por inteligentes". */
  function textoAcao(a) {
    const n = inteiro(a.qtd, 500) || 1;
    let t = nomeAparelho(a, n);
    if (a.acao === 'reparar') {
      const av = (Array.isArray(a.avarias) ? a.avarias.slice(0, 50) : []).map((x) => txtCurto(x, 200)).filter(Boolean);
      // Fotos só do que se troca ou repara (obrigatória na avaria): "ver foto" ou, a faltar, "sem foto".
      const extra = [av.map((x) => `«${x}»`).join('; '), a.foto ? 'ver foto' : 'sem foto'].filter(Boolean).join('; ');
      t += ` (${extra})`;
    }
    if (a.acao === 'substituir' && (a.tipo === 'tomada' || a.tipo === 'interruptor') && Number.isFinite(a.inteligentes)) {
      const i = Math.min(inteiro(a.inteligentes, 500), n);
      t += i === n ? ` por ${n === 1 ? 'um inteligente' : 'inteligentes'}` : i === 0 ? ` por ${n === 1 ? 'um normal' : 'normais'}` : ` (${i} por inteligentes, ${n - i} por normais)`;
    }
    if (a.acao === 'substituir') t += a.foto ? ' (ver foto)' : ' (sem foto)';
    return `${ACAO_TEXTO[a.acao]}: ${t}`;
  }

  /** O esquema do quadro desenhado no painel (`orcamentos.esquema_quadro`, JSON; migração 17), ou null. */
  function esquemaQuadroDe(o) {
    if (!o?.esquema_quadro) return null;
    let e;
    try { e = typeof o.esquema_quadro === 'string' ? JSON.parse(o.esquema_quadro) : o.esquema_quadro; } catch { return null; }
    return e && typeof e === 'object' && !Array.isArray(e) ? e : null;
  }

  /**
   * O esquema do quadro na versão do cliente: só o que se desenha (geral, diferenciais, disjuntores, módulos livres,
   * ordem na calha, estado, fusíveis) e a data; sem `por` (email de quem o fez) nem `notas` (notas de trabalho do
   * eletricista). null sem esquema.
   */
  function esquemaQuadroCliente(o) {
    const e = esquemaQuadroDe(o);
    if (!e) return null;
    const r = {};
    for (const k of ['disjuntor_geral', 'diferenciais', 'disjuntores', 'modulos_livres', 'estado', 'fusiveis', 'ordem', 'data']) if (e[k] !== undefined) r[k] = e[k];
    return r;
  }

  /** Diagnóstico da avaria feito no painel (`orcamentos.diagnostico`, JSON; migração 18), ou null. */
  function diagnosticoDe(o) {
    if (!o?.diagnostico) return null;
    let d;
    try { d = typeof o.diagnostico === 'string' ? JSON.parse(o.diagnostico) : o.diagnostico; } catch { return null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const valores = d.valores && typeof d.valores === 'object' && !Array.isArray(d.valores) ? d.valores : {};
    return {
      verificacoes: Array.isArray(d.verificacoes) ? d.verificacoes.filter((k) => CHAVES_CHECKLIST.includes(k)) : [],
      valores: Object.fromEntries(Object.entries(valores).filter(([k, x]) => CHAVES_CHECKLIST.includes(k) && x !== null && x !== '' && Number.isFinite(Number(x))).map(([k, x]) => [k, Number(x)])),
      tipo: typeof d.tipo === 'string' && NOME_TIPO_AVARIA[d.tipo] ? d.tipo : null,
      conclusao: (typeof d.conclusao === 'string' ? d.conclusao.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 2000) : '') || null,
      data: typeof d.data === 'string' ? d.data : null, por: typeof d.por === 'string' ? d.por : null,
    };
  }

  /**
   * O diagnóstico na versão do cliente (só no relatório completo, nunca no básico): o que foi verificado (nomes, com
   * o valor medido), o tipo de avaria encontrado e a conclusão; sem o email de quem o fez. null sem diagnóstico.
   */
  function diagnosticoCliente(o) {
    const d = diagnosticoDe(o);
    if (!d) return null;
    return {
      verificacoes: CHECKLIST.filter((c) => d.verificacoes.includes(c.chave)).map((c) => ({ chave: c.chave, nome: c.nome, medido: d.valores[c.chave] ?? null, unidade: c.valor?.unidade ?? null })),
      tipo: d.tipo, tipo_nome: d.tipo ? NOME_TIPO_AVARIA[d.tipo] : null, conclusao: d.conclusao, data: d.data,
    };
  }

  /** Ensaios medidos na visita/obra (`orcamentos.ensaios`, migração 16; registados no painel), ou null. */
  function ensaiosDe(o) {
    if (!o?.ensaios) return null;
    let e;
    try { e = JSON.parse(o.ensaios); } catch { return null; }
    if (!e || typeof e !== 'object') return null;
    const n = (k) => (Number.isFinite(Number(e[k])) && e[k] !== null && e[k] !== '' ? Number(e[k]) : null);
    return { continuidade_pe: n('continuidade_pe'), isolamento: n('isolamento'), terra: n('terra'), diferencial: n('diferencial'), notas: txtCurto(e.notas, 1000) || null, data: typeof e.data === 'string' ? e.data : null };
  }

  /**
   * Lista de ensaios do relatório completo (decisões 7 e 12; verificacao/rtiebt-valores.md), pela ordem da RTIEBT
   * 612.1: continuidade do PE (612.2, valor medido), isolamento (612.3, ≥ `ensaio_isolamento_mohm` a 500 V DC), terra
   * (801.5.6.1, < `ensaio_terra_ohm` em habitação com disjuntor de entrada diferencial; RA × IΔn ≤ 50 V, 413.1.4.2) e o
   * diferencial (Anexo B: disparo ≤ IΔn; os ≤ `ensaio_diferencial_ms` são só referência EN 61008/61009). Os valores de
   * referência vêm da configuração (editáveis no painel) e vão marcados "a confirmar pelo técnico"; `medido` vem dos
   * ensaios registados no painel (null = a medir na visita/obra). Textos nossos.
   */
  function listaEnsaios(cfg, medidos) {
    const fmt = (v) => String(v).replace('.', ',');
    const iso = numCfg(cfg, 'ensaio_isolamento_mohm', 0.5), dif = numCfg(cfg, 'ensaio_diferencial_ms', 300), terra = numCfg(cfg, 'ensaio_terra_ohm', 100);
    const m = medidos ?? {};
    return {
      introducao: 'Ensaios a fazer na visita ou no fim da obra, pela ordem habitual (RTIEBT 612.1): primeiro sem tensão, depois com tensão. O valor medido fica registado por nós.',
      lista: [
        { chave: 'continuidade_pe', nome: 'Continuidade do condutor de proteção (PE) e das ligações equipotenciais', referencia: 'valor medido (sem limite fixado; fonte de 4 a 24 V, ≥ 0,2 A)', unidade: 'Ω', norma: 'RTIEBT 612.2', medido: m.continuidade_pe ?? null },
        { chave: 'isolamento', nome: 'Resistência de isolamento, entre cada condutor ativo e a terra, com os aparelhos desligados', referencia: `≥ ${fmt(iso)} MΩ, a 500 V DC`, unidade: 'MΩ', norma: 'RTIEBT 612.3 (Quadro 61A)', medido: m.isolamento ?? null },
        { chave: 'terra', nome: 'Resistência de terra das massas (habitação com disjuntor de entrada diferencial)', referencia: `≤ ${fmt(terra)} Ω; e RA × IΔn ≤ 50 V`, unidade: 'Ω', norma: 'RTIEBT 801.5.6.1 e 413.1.4.2', medido: m.terra ?? null },
        { chave: 'diferencial', nome: 'Disparo do diferencial de 30 mA (à corrente IΔn)', referencia: `dispara a uma corrente ≤ IΔn; tempo ≤ ${fmt(dif)} ms`, unidade: 'ms', norma: 'RTIEBT Anexo B (só exige disparo ≤ IΔn); o tempo é referência EN 61008/61009', medido: m.diferencial ?? null },
      ],
      notas: m.notas ?? null,
      nota: 'Valores de referência a confirmar pelo técnico.',
    };
  }

  /** A planta (§2.1) só com o que o relatório técnico desenha: sem imagem de fundo, só os campos conhecidos. */
  function plantaParaRelatorio(p) {
    if (!p || typeof p !== 'object') return null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const divisoes = (Array.isArray(p.divisoes) ? p.divisoes.slice(0, 40) : []).filter((d) => d && typeof d === 'object').map((d) => ({
      id: String(d.id ?? ''), nome: txtCurto(d.nome, 60) || 'Divisão', piso: num(d.piso), x_cm: num(d.x_cm), y_cm: num(d.y_cm), largura_cm: num(d.largura_cm), altura_cm: num(d.altura_cm),
      ...(Array.isArray(d.pontos) ? { pontos: d.pontos.slice(0, 24).map((q) => [num(q?.[0]), num(q?.[1])]) } : {}),
    }));
    const PROPS = ['dupla', 'comando', 'modelo', 'entrada', 'estore', 'caixas'];   // caixas (1–3): número (ronda sinalizar)
    const elementos = (Array.isArray(p.elementos) ? p.elementos.slice(0, 400) : []).filter((e) => e && typeof e === 'object' && typeof e.tipo === 'string').map((e) => ({
      id: String(e.id ?? ''), tipo: e.tipo.slice(0, 20), x_cm: num(e.x_cm), y_cm: num(e.y_cm), rot: num(e.rot), piso: num(e.piso), divisao: typeof e.divisao === 'string' ? e.divisao : null,
      props: Object.fromEntries(PROPS.filter((k) => e.props?.[k] !== undefined).map((k) => [k, k === 'caixas' ? Math.min(3, Math.max(1, num(e.props[k]) || 1)) : typeof e.props[k] === 'string' ? e.props[k].slice(0, 40) : Boolean(e.props[k])])),
      // O nome dado pelo cliente; numa máquina sem nome, o do modelo (lista numerada dos aparelhos de utilização).
      ...(typeof e.nome === 'string' && e.nome.trim() ? { nome: txtCurto(e.nome, 60) } : e.tipo === 'maquina' && NOME_MAQUINA[e.props?.modelo] ? { nome: NOME_MAQUINA[e.props.modelo] } : {}),
    }));
    if (!divisoes.length && !elementos.length) return null;
    return { largura_cm: Math.max(1, num(p.largura_cm) || 2000), altura_cm: Math.max(1, num(p.altura_cm) || 1500), divisoes, elementos };
  }

  /**
   * Relatório técnico na versão do cliente (docs/PAGAMENTOS-PEDIDO.md): por divisão, a LISTA DE TRABALHO (Reparar /
   * Substituir / Novo, com as avarias; `simulacao.trabalho`, lote 7; os pedidos antigos: tudo Novo pelas linhas das
   * divisões) e o material; o resto (quadro elétrico, central…), a mão de obra e a deslocação à parte. Os PREÇOS e as
   * horas são os do CATÁLOGO e da configuração do servidor (nunca os `preco_iva`/`valor_iva` que o browser mandou).
   * Sem preço de compra, fornecedor, ligações, notas internas nem circuitos. Fase 2: `melhorias` (null sem pacotes) =
   * {titulo, pacotes: [{nome, material, total}], instalacao, total}: o material de cada pacote aceite (fora das divisões
   * e do quadro) e a "Instalação e configuração dos pacotes" (a margem deles, pelo catálogo e pela configuração).
   * Conteúdo técnico (só aqui, nunca no básico; web/simulador/simbolos.js): `planta` (para a planta técnica com a
   * simbologia normalizada), `esquemas` (o tipo de comando de cada luz, por divisão), `terra_nota` e `ensaios`.
   */
  function relatorioCliente(o, interno = false) {
    let s;
    try { s = JSON.parse(o.simulacao ?? 'null'); } catch { s = null; }
    if (!s || typeof s !== 'object') return null;
    const cfg = lerConfigOrc();
    const cache = new Map();
    const art = (sku) => { if (!cache.has(sku)) cache.set(sku, artigo.get(sku) ?? null); return cache.get(sku); };
    const preco = (sku) => deCent(art(sku)?.preco_venda_iva_cent) ?? null;
    const nome = (sku) => art(sku)?.nome ?? sku;
    // Quantidades da simulação por SKU (o que entrou no preço); o grupo das horas (substituir = horas de troca).
    const itens = new Map();
    for (const i of Array.isArray(s.itens) ? s.itens.slice(0, 500) : []) {
      if (!i || typeof i.sku !== 'string') continue;
      const q = inteiro(i.qtd, 10_000);
      const x = itens.get(i.sku) ?? { qtd: 0, troca: 0 };
      x.qtd += q;
      if (i.grupo === 'substituir') x.troca += q;
      itens.set(i.sku, x);
    }
    const restante = new Map([...itens].map(([k, x]) => [k, x.qtd]));
    const limitar = itens.size > 0;   // o material das divisões nunca passa do que entrou no preço
    const linhaMat = (sku, q) => {
      const p = preco(sku);
      return { artigo: nome(sku), quantidade: q, preco_unitario: p, total: p === null ? null : Math.round(p * q * 100) / 100 };
    };
    const novaDivisao = (nomeDiv) => {
      const material = [];
      return {
        nome: nomeDiv, trabalho: [], material,
        junta(sku, q) {
          if (typeof sku !== 'string' || !q) return;
          const qq = limitar ? Math.min(q, restante.get(sku) ?? 0) : q;
          if (!qq) return;
          if (limitar) restante.set(sku, restante.get(sku) - qq);
          const m = material.find((x) => x.sku === sku);
          if (m) m.quantidade += qq; else material.push({ sku, quantidade: qq });
        },
      };
    };
    // Fase 2: os pacotes aceites nas Melhorias (sem repetidos). O material de cada um (os seus `itens`, que também vão
    // nos `itens` da simulação — os do "Quadro seguro" com o quadro no pedido, nas linhas do quadro) sai primeiro, para
    // a secção "Melhorias": não aparece nas divisões nem no quadro e o total não muda.
    const vistos = new Set();
    const pacotes = [];
    for (const m of Array.isArray(s.melhorias) ? s.melhorias.slice(0, MELHORIAS.length) : []) {
      if (!m || !MELHORIAS.includes(m.id) || vistos.has(m.id)) continue;
      vistos.add(m.id);
      const d = novaDivisao(txtCurto(m.nome, 80) || m.id);
      for (const i of Array.isArray(m.itens) ? m.itens.slice(0, 20) : []) d.junta(i?.sku, inteiro(i?.qtd, 999));
      pacotes.push({ m, d });
    }
    let divs = [];
    // Fase 1: a avaria rápida (sem planta) — uma linha "Reparar" com o diagnóstico, no sítio que o cliente disse.
    if (s.funil === 'avaria') {
      const ONDE = { sala: 'Sala', cozinha: 'Cozinha', quarto: 'Quarto', casa_banho: 'Casa de banho', exterior: 'Exterior', quadro: 'Quadro elétrico', outro: 'Outro' };
      const PROBLEMA = { sem_corrente: 'tomada sem corrente', luz: 'luz não acende', disjuntor: 'disjuntor dispara', queimado: 'cheiro a queimado', faiscas: 'faz faíscas', choque: 'dá choque', outro: 'avaria' };
      const av = s.avaria && typeof s.avaria === 'object' ? s.avaria : {};
      const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);   // ronda B: várias escolhas (os antigos: uma string)
      const d = novaDivisao(lista(av.onde).map((k) => ONDE[k]).filter(Boolean).join(', ') || 'Avaria');
      const desc = txtCurto(av.descricao, 200);
      const temFoto = Array.isArray(s.fotos) && s.fotos.some((f) => typeof f?.chave === 'string' && f.chave.startsWith('avaria:foto'));
      d.trabalho.push(`Reparar: diagnóstico — ${lista(av.problema).map((k) => PROBLEMA[k]).filter(Boolean).join(', ') || 'avaria'}${desc ? ` («${desc}»)` : ''}${temFoto ? '; ver foto' : ''}`);
      d.junta('DIAG-AVARIA', itens.get('DIAG-AVARIA')?.qtd ?? 1);
      divs.push(d);
    }
    const trabalho = Array.isArray(s.trabalho) ? s.trabalho.slice(0, 201).filter((g) => g && typeof g === 'object' && Array.isArray(g.acoes)) : [];
    if (trabalho.length) {
      for (const g of trabalho) {
        const d = novaDivisao(txtCurto(g.nome, 60) || 'Divisão');
        const acoes = g.acoes.slice(0, 100).filter((a) => a && ORDEM_ACAO.includes(a.acao))
          .sort((a, b) => ORDEM_ACAO.indexOf(a.acao) - ORDEM_ACAO.indexOf(b.acao));
        for (const a of acoes) {
          d.trabalho.push(textoAcao(a));
          for (const m of Array.isArray(a.material) ? a.material.slice(0, 50) : []) d.junta(m?.sku, inteiro(m?.qtd, 10_000));
        }
        if (d.trabalho.length || d.material.length) divs.push(d);
      }
    } else if (s.funil !== 'avaria') {
      // Pedidos antigos (sem ações): tudo Novo, pelas linhas das divisões.
      divs = (Array.isArray(s.divisoes) ? s.divisoes.slice(0, 200) : []).filter((d) => d && typeof d === 'object').map((x) => {
        const d = novaDivisao(txtCurto(x.nome, 60) || 'Divisão');
        const ints = Array.isArray(x.interruptores) ? x.interruptores.slice(0, 50).map((b) => Math.max(1, Math.min(4, Math.round(Number(b) || 1)))) : [];
        if (ints.length) {
          d.trabalho.push(`Novo: ${ints.length} ${ints.length === 1 ? 'interruptor inteligente' : 'interruptores inteligentes'} (luzes pelo telemóvel)`);
          for (const b of ints) d.junta(`INT-VIDRO-${b}`, 1);
        }
        for (const [k, sku, um, varios] of SKU_DIVISAO) {
          const q = inteiro(x[k], 200);
          if (!q) continue;
          d.trabalho.push(`Novo: ${q} ${q === 1 ? um : varios}`);
          d.junta(sku, q);
        }
        const sm = inteiro(x.estores_sem_motor, 200);
        if (sm) d.trabalho.push(`${sm} ${sm === 1 ? 'estore sem motor (a ver na visita)' : 'estores sem motor (a ver na visita)'}`);
        return d;
      });
    }
    const divisoes = divs.map((d) => {
      const linhas = d.material.map((m) => linhaMat(m.sku, m.quantidade));
      return { nome: d.nome, trabalho: d.trabalho, material: linhas, total: Math.round(linhas.reduce((t, l) => t + (l.total ?? 0), 0) * 100) / 100 };
    });
    const geral = [];
    for (const [sku, q] of restante) if (q > 0) geral.push(linhaMat(sku, q));
    // Mão de obra: horas do catálogo (ao substituir, as de troca; sem elas 50 %) × a tarifa da configuração. Nos artigos
    // de PREÇO FECHADO (pontos novos, linhas dedicadas) o cliente paga só o preço do artigo: as horas deles contam para
    // os dias de obra (`horasTodas`) e para a mão de obra que vai lá dentro (`incluida`, nunca acima do preço da linha),
    // mas não para a mão de obra cobrada à parte — como o simulador (preco.js calcularPreco).
    const tarifa = Number.isFinite(Number(cfg.tarifa_hora_iva)) ? Number(cfg.tarifa_hora_iva) : 38;
    let horas = 0, horasTodas = 0, incluida = 0;
    for (const [sku, x] of itens) {
      const a = art(sku);
      if (!a) continue;
      const hi = Number(a.horas_instalacao) || 0;
      const ht = Number.isFinite(a.horas_troca) ? a.horas_troca : hi * 0.5;
      const h = (x.qtd - x.troca) * hi + x.troca * ht;
      horasTodas += h;
      if (precoFechado(a)) incluida += Math.min(((a.preco_venda_iva_cent ?? 0) * x.qtd) / 100, Math.round(h * tarifa * 100) / 100);
      else horas += h;
    }
    horas = Math.round(horas * 100) / 100;
    horasTodas = Math.round(horasTodas * 100) / 100;
    const maoObra = itens.size ? Math.round(horas * tarifa * 100) / 100 : null;
    // Deslocação por dia de obra, ida e volta (decisão 4): os dias pelas horas todas; a avaria é um dia.
    const deslocacao = itens.size ? deslocacaoServidor(o.localidade ?? s.casa?.localidade ?? '', cfg, s.funil === 'avaria' ? 1 : diasDeObra(horasTodas, cfg)) : null;
    // Dias de obra ("≈ N dias de obra") e os dias de deslocação cobrados (no máximo `deslocacao_max_dias`), como o simulador.
    const diasObra = !itens.size ? null : s.funil === 'avaria' ? 1 : diasDeObra(horasTodas, cfg);
    const maxDias = Math.max(1, Math.round(numCfg(cfg, 'deslocacao_max_dias', DESLOCACAO_MAX_DIAS)));
    const somaGeral = Math.round(geral.reduce((t, l) => t + (l.total ?? 0), 0) * 100) / 100;
    // Fase 2: a instalação e configuração dos pacotes (a margem deles), como o simulador (web/simulador/melhorias.js
    // calcularMelhorias): por pacote, custo = material + horas × tarifa dos seus artigos (preços e horas do CATÁLOGO),
    // preço = custo × (1 + margem_pacotes_pct) e margem = preço − custo. Nunca a `melhorias_margem_iva` do browser. A
    // mão de obra dos artigos dos pacotes já está na de cima (horas dos `itens`).
    const pctPacotes = Number(cfg.margem_pacotes_pct);
    const mPacotes = Math.min(100, Number.isFinite(pctPacotes) && pctPacotes >= 0 ? pctPacotes : 20) / 100;
    const cent2 = (x) => Math.round(x * 100) / 100;
    let instalacao = 0;
    const listaPacotes = pacotes.map(({ m, d }) => {
      // O "Quadro seguro" com o quadro no pedido custa a diferença do quadro (`quadro_delta`, com sinal: o que sai, como
      // os diferenciais normais e a caixa menor, desconta; nunca abaixo de 0), como o simulador.
      const delta = m.id === 'quadro-seguro' && Array.isArray(m.quadro_delta);
      let mat = 0, h = 0;
      for (const i of delta ? m.quadro_delta.slice(0, 30) : Array.isArray(m.itens) ? m.itens.slice(0, 20) : []) {
        const a = typeof i?.sku === 'string' ? art(i.sku) : null;
        const q = delta && Number.isInteger(i?.qtd) ? Math.max(-999, Math.min(999, i.qtd)) : inteiro(i?.qtd, 999);
        if (!a || !q) continue;
        mat += cent2((deCent(a.preco_venda_iva_cent) ?? 0) * q);
        h += (Number(a.horas_instalacao) || 0) * q;
      }
      const custo = Math.max(0, cent2(cent2(mat) + cent2(cent2(h) * tarifa)));
      instalacao += cent2(cent2(custo * (1 + mPacotes)) - custo);
      const linhas = d.material.map((x) => linhaMat(x.sku, x.quantidade));
      return { nome: d.nome, material: linhas, total: cent2(linhas.reduce((t, l) => t + (l.total ?? 0), 0)) };
    });
    const inst = cent2(instalacao);
    const melhorias = listaPacotes.length
      ? { titulo: 'Melhorias', pacotes: listaPacotes, instalacao: inst, total: cent2(listaPacotes.reduce((t, x) => t + x.total, 0) + inst) } : null;
    const soma = divisoes.reduce((t, d) => t + d.total, 0) + somaGeral + (maoObra ?? 0) + (deslocacao ?? 0) + (melhorias?.total ?? 0);
    const ta = s.totais_acao && typeof s.totais_acao === 'object' ? s.totais_acao : {};
    const aparelhos = (k) => inteiro(ta[k]?.aparelhos, 10_000);
    const planta = s.funil === 'avaria' ? null : plantaParaRelatorio(s.planta);
    return {
      pedido: o.id, libertado: o.relatorio_libertado,
      acoes: { manter: aparelhos('manter'), reparar: aparelhos('reparar'), substituir: aparelhos('substituir'), novo: aparelhos('novo') },
      divisoes, geral: { titulo: 'Quadro elétrico e geral', material: geral, total: somaGeral },
      mao_obra: maoObra === null ? null : { horas, valor: maoObra },
      deslocacao, melhorias, total: Math.round(soma * 100) / 100,
      dias: diasObra, deslocacao_dias: deslocacao === null ? null : Math.min(diasObra, maxDias), deslocacao_limitada: deslocacao !== null && diasObra > maxDias,
      nota: 'Valores com IVA, pelos preços do nosso catálogo. O valor final é o da proposta. O que já pagou (relatório, visita) é descontado na obra.',
      // Conteúdo técnico do pormenorizado (decisões 4, 5, 7, 8 e 12): planta técnica, esquema por luz, terra e ensaios.
      planta, esquemas: planta ? esquemasDaPlanta(planta) : [],
      terra_nota: 'Verificar terra (PE) nas tomadas na visita.',
      ensaios: listaEnsaios(cfg, ensaiosDe(o)),
      // "Esquema do quadro elétrico" desenhado pelo eletricista no painel (`orcamentos.esquema_quadro`, migração 17;
      // formato da leitura do quadro: disjuntor_geral, diferenciais, disjuntores, modulos_livres, ordem). Só o desenho
      // (sem `por` nem `notas`; null sem esquema); a conta desenha-o com web/simulador/quadro-desenho.js.
      esquema_quadro: esquemaQuadroCliente(o),
      // Diagnóstico da avaria feito no painel (`orcamentos.diagnostico`, migração 18): só aqui, nunca no básico.
      diagnostico: diagnosticoCliente(o),
      // Só para o painel (`propostaSugerida`): as horas todas e a mão de obra dentro dos artigos de preço fechado.
      ...(interno ? { _interno: { horas: horasTodas, mao_obra_incluida: Math.round(incluida * 100) / 100 } } : {}),
    };
  }

  /**
   * Relatório BÁSICO (fase 3; grátis, logo ao enviar, sem revisão): o intervalo de preço (−`intervalo_menos_pct` /
   * +`intervalo_mais_pct` do total do relatório do servidor SEM a deslocação, que vai à parte em `deslocacao`, como no
   * Orçamento do simulador: "min – max + deslocação X €") e a lista de trabalho por divisão e ação, com os pacotes das
   * Melhorias aceites. SEM material, sem preços por linha e sem plano técnico: isso é o pormenorizado.
   */
  function relatorioBasico(o) {
    const r = relatorioCliente(o);
    if (!r) return null;
    const avaria = simDe(o)?.funil === 'avaria';
    const divisoes = r.divisoes.filter((d) => d.trabalho.length).map((d) => ({ nome: d.nome, trabalho: d.trabalho }));
    if (r.geral.material.length) divisoes.push({ nome: 'Quadro elétrico e geral', trabalho: ['Trabalho no quadro elétrico (o material está no relatório completo).'] });
    const semDesloc = Math.round((r.total - (r.deslocacao ?? 0)) * 100) / 100;
    // Obra mínima (decisão 9; como o simulador, preco.js comObraMinima): o intervalo nunca fica abaixo dela.
    const cfg = lerConfigOrc();
    const minimo = numCfg(cfg, 'obra_minima_iva', OBRA_MINIMA_OMISSAO);
    let intervalo = avaria || !(semDesloc > 0) ? null : intervaloEstimativa(semDesloc, cfg);
    if (intervalo && minimo > 0) intervalo = { min: Math.max(intervalo.min, arredondar5(minimo)), max: Math.max(intervalo.max, arredondar5(minimo)) };
    return {
      pedido: o.id, acoes: r.acoes, divisoes,
      melhorias: r.melhorias ? r.melhorias.pacotes.map((x) => x.nome) : [],
      // Na avaria o preço é o do diagnóstico (pago ao enviar), sem intervalo.
      intervalo,
      obra_minima: intervalo && semDesloc < minimo ? minimo : null,
      // A deslocação à parte (€ c/ IVA); null fora da área servida (não há deslocação) ou sem trabalho.
      deslocacao: avaria ? null : r.deslocacao,
      // "≈ N dias de obra" e "(ida e volta, N dias)" / "(ida e volta; máximo N dias)", como no Orçamento do simulador.
      dias: avaria ? null : r.dias, deslocacao_dias: avaria ? null : r.deslocacao_dias, deslocacao_limitada: !avaria && r.deslocacao_limitada,
      com_deslocacao: r.deslocacao !== null,
      // QA final: localidade sem concelho reconhecido — a deslocação confirma-se na visita (nunca "com deslocação" sem a saber).
      deslocacao_a_confirmar: !avaria && r.deslocacao !== null && distancia(o.localidade ?? simDe(o)?.casa?.localidade ?? '', cfg).km === null,
      nota: 'Estimativa com IVA. O valor final é o da proposta. O relatório completo tem o material e o preço de cada divisão.',
    };
  }

  // ------------------------------------------------------------ para o painel e para a conta
  const doOrcamento = db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? ORDER BY id');
  function listarParaPainel(orcamentoId) {
    return doOrcamento.all(orcamentoId).map(linhaPainel);
  }
  function linhaPainel(p) {
    const iva = ivaDe(p);
    const { base, iva: ivaCent } = partirIva(p.valor_cent, iva);
    return {
      ref: p.ref, fase: p.fase, fase_texto: NOME_FASE[p.fase], valor: deCent(p.valor_cent), base: deCent(base), iva: deCent(ivaCent), iva_pct: iva,
      estado: p.estado, estado_texto: TEXTO_ESTADO[p.estado], modo: p.modo, criado: p.criado, pago: p.pago, plano: p.plano,
      devolvido: p.devolvido_cent ? deCent(p.devolvido_cent) : null, devolvido_em: p.devolvido ?? null, nao_realizada: Boolean(p.faltou) && !eVisitaExtra(p), sem_defeito: eVisitaExtra(p),
      a_devolver: p.a_devolver ? deCent(p.a_devolver) : null, metodo: p.metodo ?? null,
      com_visita: p.com_visita === null ? null : Boolean(p.com_visita), descricao: p.descricao, orcamento_id: p.orcamento_id,
    };
  }

  /** Total com IVA, sinal e restante de um pedido para o painel (null sem proposta). */
  function resumoValores(o) {
    const v = valores(o);
    if (v.total === null) return null;
    return {
      proposta: deCent(v.proposta), iva_pct: v.iva_pct, iva: deCent(v.iva), total: deCent(v.total), pago_antes: deCent(v.pago_antes), sinal: deCent(v.sinal), restante: deCent(v.restante),
      // Decisões de 2026-10-02: a base cobrada (≠ proposta com a obra mínima), a obra mínima aplicada (ou null), o que
      // se desconta no sinal, de onde vem o material que o sinal cobre ('custo' de compra ou valor de 'venda'; o valor
      // não vai: o comercial não vê custos) e o que falta para a obra estar toda paga.
      base: deCent(v.base), minima: deCent(v.minima), desconto: deCent(v.desconto), em_falta: deCent(v.em_falta),
      material_origem: v.material?.origem ?? null, sinal_material: v.sinal_material,
    };
  }

  /**
   * Todos os pagamentos dos pedidos (painel → Pagamentos, só CEO; também em CSV): os de pedidos apagados antes da
   * anonimização (RGPD) ficam sem pedido. `estado`: filtra (ex. "pago").
   */
  function listarTodos({ estado = null, mes = null } = {}) {
    const cond = [];
    const args = [];
    if (estado) { cond.push('estado = ?'); args.push(estado); }
    if (mes) { cond.push('substr(COALESCE(pago, criado), 1, 7) = ?'); args.push(mes); }
    return db.prepare(`SELECT * FROM pagamentos_pedido ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 5000`).all(...args)
      .map((p) => {
        // A devolução (visita cancelada, sinal devolvido) com a base e o IVA, para os totais e para a linha do CSV.
        const dev = p.devolvido_cent ? partirIva(p.devolvido_cent, ivaDe(p)) : null;
        return { ...linhaPainel(p), data: p.pago ?? p.criado, devolvido_base: dev ? deCent(dev.base) : null, devolvido_iva: dev ? deCent(dev.iva) : null };
      });
  }

  /**
   * A conta tem uma tentativa de pagamento da avaria nas últimas 24 h (por pagar, falhada ou cancelada)? Então um
   * novo "Pagar e enviar" é uma RETENTATIVA: não gasta o limite de pedidos por IP (api.js), tem o seu próprio.
   */
  function temTentativaRecente(contaId) {
    expirar();
    return Boolean(db.prepare(`SELECT 1 FROM pagamentos_pedido WHERE conta_id = ? AND fase IN ('avaria', 'relatorio') AND orcamento_id IS NULL
      AND estado IN ('pendente', 'falhado', 'cancelado') AND criado >= ? LIMIT 1`).get(contaId, iso(relogio() - VALIDADE_MS)));
  }

  /** Estado dos pagamentos para o site e o painel (faixa "Modo de demonstração" / "Pagamentos desligados"). */
  const info = () => ({
    ativo: Boolean(config.pagamentoPedido), modo: config.pagamentoPedido ? modo : null,
    demonstracao: Boolean(config.pagamentoPedido) && modo === 'simulado',
    desligados_sem_configuracao: Boolean(config.pagamentosDesligadosSemModo),
    iva_pct: ivaAtual(),
  });

  /** O que a conta vê dos pagamentos de um pedido (conta.js pedidoParaCliente). */
  function paraCliente(o) {
    const lista = doOrcamento.all(o.id);
    // Os pagos e os devolvidos todos (uma visita a que faltou e a visita nova são dois pagamentos da mesma fase); nas
    // fases sem nenhum, o mais recente (os antigos cancelados/expirados não interessam ao cliente).
    const porFase = {};
    for (const p of lista) {
      if (['pago', 'devolvido'].includes(p.estado)) porFase[`${p.fase}:${p.id}`] = p;
      else if (!lista.some((x) => x.fase === p.fase && ['pago', 'devolvido'].includes(x.estado))) porFase[p.fase] = p;
    }
    const v = valores(o);
    const sinalPago = Boolean(pagoDe(o.id, 'sinal'));
    const cp = compras(o);
    const aguardaSinal = o.estado === 'proposta_enviada' && Boolean(o.proposta_aceite) && !sinalPago;
    const concluida = obraConcluida(o);
    return {
      pagamentos: Object.values(porFase).sort((a, b) => a.id - b.id).map(publico),
      // Relatório básico: logo, grátis, com a simulação. O pormenorizado: por comprar → em revisão (pago) → disponível
      // (libertado pelo CEO). Na avaria não se vende (o diagnóstico já inclui a visita).
      relatorio_basico: Boolean(o.simulacao),
      relatorio: !o.simulacao ? null : o.relatorio_libertado ? 'disponivel' : cp.relatorio.comprado ? 'em_revisao' : cp.avaria ? null : 'por_comprar',
      compras: cp,
      // A proposta é sem IVA; o que se paga online inclui-o (total = proposta + IVA).
      proposta_iva: v.total === null ? null : { base: deCent(v.base), iva_pct: v.iva_pct, iva: deCent(v.iva), total: deCent(v.total) },
      // Decisões de 2026-10-02: o detalhe da proposta (três partes, sem IVA), a obra mínima aplicada (€ c/ IVA ou null),
      // o limite do cartão, "Quero que comecem já", cancelar a visita e se a obra já está toda paga (a app fica ativa).
      proposta_partes: partes(o),
      obra_minima: deCent(v.minima),
      cartao_max: numCfg(lerConfigOrc(), 'cartao_max_iva', CARTAO_MAX_OMISSAO),
      inicio_imediato: o.inicio_imediato ?? null,
      visita_cancelar: visitaCancelar(o),
      visita_faltou: o.visita_faltou ?? null,
      // "Visita sem defeito" por pagar ou paga (depois de um "Não" do cliente sem defeito): {valor, paga, pendente} ou null.
      visita_sem_defeito: visitaExtra(o),
      // Devoluções por transferência (pagou por Multibanco): a conta pede o IBAN; depois só se mostra o fim dele.
      devolucoes: devolucoesDoPedido(o.id),
      obra_paga: o.estado === 'aceite' && v.em_falta !== null ? v.em_falta === 0 : null,
      sinal: v.sinal === null ? null : { valor: deCent(v.sinal), pct: SINAL_PCT, desconto: deCent(v.desconto), pago: sinalPago, cobre_material: v.sinal_material },
      aguarda_sinal: aguardaSinal,
      pode_pagar_sinal: aguardaSinal && v.sinal > 0,
      restante: o.estado === 'aceite' && v.restante !== null ? { valor: deCent(v.restante), pago: Boolean(pagoDe(o.id, 'restante')), obra_concluida: concluida } : null,
      pode_pagar_restante: o.estado === 'aceite' && concluida && v.restante > 0 && !pagoDe(o.id, 'restante'),
      plano: o.plano_escolhido ? { chave: o.plano_escolhido, nome: NOME_PLANO[o.plano_escolhido] } : null,
      modo: config.pagamentoPedido ? modo : null,
    };
  }

  // ------------------------------------------------------------ rotas (/api/conta/pagamentos/*, pedidos/:id/pagar|relatorio)
  const ROTAS = [
    ['POST', /^\/api\/conta\/pagamentos\/stripe-webhook$/, 'webhook'],
    ['GET', /^\/api\/conta\/pagamentos\/(pp_[A-Za-z0-9_-]{22})$/, 'ver'],
    ['POST', /^\/api\/conta\/pagamentos\/(pp_[A-Za-z0-9_-]{22})\/simular$/, 'simular'],
    ['POST', /^\/api\/conta\/pedidos\/(\d+)\/pagar$/, 'pagar'],
    ['POST', /^\/api\/conta\/pedidos\/(\d+)\/cancelar-visita$/, 'cancelarVisita'],
    ['POST', /^\/api\/conta\/devolucoes\/(\d+)\/iban$/, 'iban'],
    ['GET', /^\/api\/conta\/pedidos\/(\d+)\/relatorio$/, 'relatorio'],
    ['GET', /^\/api\/conta\/pedidos\/(\d+)\/relatorio-basico$/, 'relatorioBasico'],
  ];
  const eDaqui = (caminho) => caminho.startsWith('/api/conta/pagamentos/') || ROTAS.some(([, re]) => re.test(caminho));

  /** Pagamento da conta da sessão (404 para os outros: nem fica a saber que existe). */
  function daConta(c, ref) {
    const p = linha(ref);
    if (!p || p.conta_id !== c.id) throw new ErroApi(404, 'Pagamento não encontrado.');
    return p;
  }
  const pedidoDaConta = (c, id) => {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ? AND conta_id = ?').get(idNum(id), c.id);
    if (!o) throw new ErroApi(404, 'Pedido não encontrado.');
    return o;
  };

  const h = {};
  h.ver = async ({ res, c, m, url }) => {
    expirar();
    let p = daConta(c, m[1]);
    if (url.searchParams.get('cancelado') === '1' && p.estado === 'pendente' && p.modo === 'stripe') {
      p = await sincronizar(p);
      if (p.estado === 'pendente') { cancelar(p, 'cliente_desistiu'); p = linha(p.ref); }
    } else {
      p = await sincronizar(p);
    }
    const r = { pagamento: publico(p) };
    // Fotos do simulador: o token (30 min) só para o pedido acabado de pagar, e só nas 2 h seguintes.
    if (url.searchParams.get('fotos') === '1' && (p.fase === 'avaria' || p.fase === 'relatorio') && p.estado === 'pago' && p.orcamento_id && Date.parse(p.pago) + FOTOS_DEPOIS_MS > relogio()) {
      r.fotos_token = fotos.emitirToken(p.orcamento_id);
      r.fotos_max = 40;
    }
    responder(res, 200, r);
  };

  // Página simulada: só no modo simulado (no modo stripe responde como se não existisse).
  h.simular = async ({ req, res, c, m, ip }) => {
    if (!config.pagamentoPedido || modo !== 'simulado') throw new ErroApi(404, 'Endereço desconhecido.');
    const v = await lerJson(req, ['resultado', 'metodo']);
    const resultado = opcao(v.resultado, 'resultado', ['sucesso', 'falha', 'cancelar']);
    // O método com que se "pagou" (por omissão cartão): uma devolução de um Multibanco é manual, por transferência.
    const metodo = opcao(v.metodo, 'metodo', Object.keys(NOME_METODO), { obrigatorio: false }) ?? 'card';
    expirar();
    const p = daConta(c, m[1]);
    if (p.modo !== 'simulado') throw new ErroApi(409, 'Este pagamento não é simulado.');
    if (p.estado !== 'pendente') {
      if (p.estado === 'pago' && resultado === 'sucesso') return responder(res, 200, { pagamento: publico(p), voltar: voltar(p) });
      throw new ErroApi(409, p.estado === 'expirado' ? 'Este pagamento expirou. Volte atrás e tente de novo.' : `Este pagamento já está ${TEXTO_ESTADO[p.estado].toLowerCase()}.`);
    }
    const tipo = { sucesso: 'checkout.session.completed', falha: 'checkout.session.async_payment_failed', cancelar: 'checkout.session.expired' }[resultado];
    const evento = {
      id: `evt_sim_${randomBytes(12).toString('hex')}`, object: 'event', type: tipo, created: Math.floor(relogio() / 1000), livemode: false,
      data: { object: {
        id: `cs_sim_${p.ref.slice(3)}`, object: 'checkout.session', client_reference_id: p.ref, metadata: { ref: p.ref, fase: p.fase },
        amount_total: p.valor_cent, currency: 'eur', payment_status: resultado === 'sucesso' ? 'paid' : 'unpaid',
        status: resultado === 'sucesso' ? 'complete' : resultado === 'cancelar' ? 'expired' : 'complete',
      } },
    };
    auditar(quem(c.id), 'pagamento_simulado', p.orcamento_id ? `orcamento:${p.orcamento_id}` : `conta:${c.id}`, { ref: p.ref, resultado }, ip);
    if (resultado === 'sucesso') db.prepare('UPDATE pagamentos_pedido SET metodo = ? WHERE id = ?').run(metodo, p.id);
    tratarEvento(evento);
    const depois = linha(p.ref);
    responder(res, 200, { pagamento: publico(depois), voltar: voltar(depois) });
  };

  // Sinal, restante e (fase 3) as compras do pedido: relatório completo, visita técnica ou os dois.
  h.pagar = async ({ req, res, c, m, ip }) => {
    if (!config.pagamentoPedido) throw new ErroApi(404, 'Endereço desconhecido.');
    const v = await lerJson(req, ['fase', 'inicio_imediato']);
    const fase = opcao(v.fase, 'fase', ['sinal', 'restante', ...Object.keys(COMPRAS), ...(config.eletricistas ? ['visita_sem_defeito'] : [])]);
    const o = pedidoDaConta(c, m[1]);
    if (fase === 'visita_sem_defeito') return responder(res, 200, { pagamento: await pagarVisitaExtra(c, o) });
    // "Quero que comecem já" (decisão 11): vem com o pagamento do sinal.
    if (v.inicio_imediato !== undefined && fase === 'sinal') definirInicioImediato(o, booleano(v.inicio_imediato, 'inicio_imediato'), c.id, ip);
    responder(res, 200, { pagamento: COMPRAS[fase] ? await comprar(c, o, fase) : await pagarFase(c, o, fase) });
  };

  // "Cancelar visita" (decisão 10): devolvida com mais de 24 h de antecedência; com menos, 409 com a explicação.
  h.cancelarVisita = async ({ req, res, c, m, ip }) => {
    await lerJson(req, []);
    const r = await cancelarVisita(c, pedidoDaConta(c, m[1]), ip);
    // `manual`: pago por referência Multibanco — a devolução é por transferência e a conta pede o IBAN.
    responder(res, 200, { ok: true, devolvido: r.devolvido, manual: r.manual });
  };

  // Devolução por transferência (pagou por referência Multibanco): a conta dá o IBAN e o titular.
  h.iban = async ({ req, res, c, m }) => {
    const v = await lerJson(req, ['iban', 'titular']);
    const titular = typeof v.titular === 'string' ? v.titular.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';
    if (titular.length < 2) throw new ErroApi(400, 'Indique o nome do titular da conta.');
    responder(res, 200, { devolucao: darIban(c, idNum(m[1]), v.iban, titular) });
  };

  h.relatorio = ({ res, c, m }) => {
    const o = pedidoDaConta(c, m[1]);
    if (!o.simulacao) throw new ErroApi(404, 'Este pedido não tem relatório técnico.');
    if (!o.relatorio_libertado) {
      throw new ErroApi(409, temRelatorio(o) ? 'O relatório está em revisão (até 24 h).' : 'O relatório completo ainda não foi comprado.');
    }
    responder(res, 200, { relatorio: relatorioCliente(o) });
  };

  h.relatorioBasico = ({ res, c, m }) => {
    const o = pedidoDaConta(c, m[1]);
    const r = o.simulacao ? relatorioBasico(o) : null;
    if (!r) throw new ErroApi(404, 'Este pedido não tem relatório.');
    responder(res, 200, { relatorio: r });
  };

  async function webhook(req, res) {
    if (modo !== 'stripe') return responder(res, 404, { erro: 'Endereço desconhecido.' });
    if (!config.stripeWebhookSegredo) return responder(res, 503, { erro: 'Os pagamentos ainda não estão configurados neste servidor.' });
    const bruto = await lerCorpo(req, 512 * 1024);
    if (!assinaturaValida(bruto, req.headers['stripe-signature'])) return responder(res, 400, { erro: 'Assinatura inválida.' });
    let ev;
    try { ev = JSON.parse(bruto.toString('utf8')); } catch { return responder(res, 400, { erro: 'JSON inválido.' }); }
    try {
      const r = tratarEvento(ev);
      responder(res, 200, { recebido: true, resultado: r });
    } catch {
      responder(res, 500, { erro: 'Erro temporário.' });   // o Stripe repete
    }
  }

  /** Stripe-Signature: t=<s>,v1=<hex> — HMAC-SHA256 de "<t>.<corpo>" com o segredo do webhook, até 5 min. */
  function assinaturaValida(bruto, cab) {
    if (typeof cab !== 'string') return false;
    const partes = cab.split(',').map((x) => x.split('='));
    const t = Number(partes.find(([k]) => k === 't')?.[1]);
    if (!Number.isFinite(t) || Math.abs(relogio() / 1000 - t) > TOLERANCIA_WEBHOOK_S) return false;
    const esperado = createHmac('sha256', config.stripeWebhookSegredo).update(`${t}.`).update(bruto).digest();
    return partes.filter(([k]) => k === 'v1').some(([, v]) => {
      const b = Buffer.from(String(v), 'hex');
      return b.length === esperado.length && timingSafeEqual(b, esperado);
    });
  }

  /** Trata a rota (true) ou devolve false (não é daqui). */
  async function tratar(req, res, url, ip) {
    const caminho = url.pathname;
    if (!eDaqui(caminho)) return false;
    let rota = null;
    let m = null;
    let existe = false;
    for (const [metodo, re, nome] of ROTAS) {
      const x = re.exec(caminho);
      if (!x) continue;
      existe = true;
      if (metodo === req.method || (req.method === 'HEAD' && metodo === 'GET')) { rota = nome; m = x; break; }
    }
    if (!rota) { responder(res, existe ? 405 : 404, { erro: existe ? 'Método não permitido.' : 'Endereço desconhecido.' }); return true; }
    if (rota === 'webhook') { await webhook(req, res); return true; }
    if (req.method === 'POST') {
      if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
      if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    }
    const c = sessao(req, res);
    if (!c) throw new ErroApi(401, 'Sessão inválida ou expirada. Entre de novo na sua conta.');
    if (!c.confirmado) throw new ErroApi(403, 'Confirme primeiro o seu email com o código que lhe enviámos.');
    await h[rota]({ req, res, c, m, url, ip });
    return true;
  }

  return {
    modo, ativo: config.pagamentoPedido, tratar, iniciarAvaria, comprar, compras, temRelatorio, temVisita, aoAceitar, pagarFase,
    aoMudarProposta, tratarEvento, listarParaPainel, paraCliente, relatorioCliente, relatorioBasico, ensaiosDe, diagnosticoDe, valores, expirar, iniciar, parar, publico,
    resumoValores, listarTodos, temTentativaRecente, info, ivaAtual,
    ligacaoCasa, propostaSugerida, partes, reservaMaterial, definirInicioImediato, visitaCancelar, faltaParaVisita,
    marcarFalta, devolverSinal, aoFicarAceite, devolucoesDoPedido, devolucoesPorFazer, marcarDevolvida, ibanPt, ibanMascarado, visitaExtra, visitaExtraPaga, restantePago, emFalta,
    PLANOS: PLANOS_MENSAIS,
  };
}
