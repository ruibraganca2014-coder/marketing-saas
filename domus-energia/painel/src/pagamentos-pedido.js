// Pagamentos do pedido de orçamento (docs/PAGAMENTOS-PEDIDO.md): 19 € ao enviar (relatório técnico + visita
// técnica, descontados na obra; fora da área só o relatório), sinal de 30 % (menos os 19 €) ao aceitar a proposta e
// o restante no fim da obra. Vive no painel (tem as contas, os pedidos, a auditoria e os emails); o serviço
// pagamentos/ continua só com as subscrições mensais.
//
// Dois modos (PAGAMENTOS_MODO):
// - "simulado" (só com PAGAMENTOS_MODO=simulado explícito; o lançador local põe-no): nenhum dinheiro real. O
//   "pagamento" abre a página do site pagamento-simulado.html, que chama POST /api/conta/pagamentos/:ref/simular; daí
//   sai um evento com o MESMO formato de um webhook do Stripe (checkout.session.*), tratado pela mesma função
//   (tratarEvento). O site e o painel mostram a faixa "Modo de demonstração — pagamentos simulados".
// - "stripe" (por omissão com STRIPE_SECRET_KEY): Stripe Checkout (cartão, MB Way, Multibanco) pela API REST;
//   confirmação pelo webhook assinado (POST /api/conta/pagamentos/stripe-webhook) e, no regresso do cliente, pela
//   leitura da sessão no Stripe.
// Sem modo explícito e sem chave os pagamentos ficam desligados (config.pagamentoPedido = false).
//
// IVA (decisão do dono): a proposta do painel é SEM IVA e os pagamentos online incluem-no (taxa "iva_pct" da
// configuração, omissão 23 %): proposta 1000 € → 1230 €; sinal = 30 % × 1230 − 19 = 350 €; restante 861 €. Os 19 €
// já são com IVA. Cada pagamento guarda a taxa usada (iva_pct) para o recibo e o CSV (base, IVA, total).
//
// Regras: os valores são SEMPRE calculados aqui (nunca vêm do browser); cada pagamento tem uma referência
// aleatória (ref) e só a conta dona o vê e paga; um evento só é tratado uma vez (pagamentos_eventos) e uma fase
// paga não se paga outra vez (índice único); o pedido só passa a orçamento ("novo" no painel) depois de pago.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErroApi, responder, lerJson, lerCorpo, verificarOrigemPublica, tipoJson } from './http.js';
import { idNum, opcao } from './validar.js';
import { iso, deCent } from './util.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';

export const VALOR_RELATORIO_CENT = 1900;
export const SINAL_PCT = 30;
export const VALIDADE_MS = 24 * 3600_000;         // um pagamento por pagar expira (e o pedido guardado sai) ao fim de 24 h
const FOTOS_DEPOIS_MS = 2 * 3600_000;             // token das fotos só nas 2 h a seguir ao pagamento dos 19 €
const TOLERANCIA_WEBHOOK_S = 300;
const RE_REF = /^pp_[A-Za-z0-9_-]{22}$/;
export const PLANOS_MENSAIS = ['base', 'conforto', 'premium'];
const NOME_PLANO = { base: 'Base', conforto: 'Conforto', premium: 'Premium' };
const NOME_FASE = { relatorio: 'Relatório técnico e visita', sinal: 'Sinal', restante: 'Restante' };
const TEXTO_ESTADO = { pendente: 'Por pagar', pago: 'Pago', falhado: 'Falhou', cancelado: 'Cancelado', expirado: 'Expirou' };

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
function concelho(texto) {
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
 * Deslocação (€ c/ IVA) pela configuração do servidor, como o simulador (§5.1): fixo + km acima dos grátis × preço
 * por km; concelho desconhecido → só o fixo; fora da área → null (não soma).
 */
export function deslocacaoServidor(localidade, cfg) {
  const d = distancia(localidade, cfg);
  const n = (k) => (Number.isFinite(Number(cfg[k])) ? Number(cfg[k]) : 0);
  if (d.fora) return null;
  const extra = d.km === null ? 0 : Math.max(0, d.km - n('deslocacao_km_gratis')) * n('deslocacao_preco_km_iva');
  return Math.round((n('deslocacao_iva') + extra) * 100) / 100;
}

/** Sinal (cêntimos) de uma proposta COM IVA: 30 % do valor menos o que já foi pago pelo relatório (nunca negativo). */
export function calcularSinal(valorComIvaCent, relatorioPagoCent) {
  return Math.max(0, Math.round((valorComIvaCent * SINAL_PCT) / 100) - relatorioPagoCent);
}

/**
 * @param {{db, config, registo, relogio: () => number, auditar: Function, correio: object, fotos: object,
 *   sessao: (req, res) => object|null, criarOrcamento: (pedido: object, contaId: number) => number, fetch?: typeof fetch}} ctx
 */
export function criarPagamentosPedido({ db, config, registo, relogio, auditar, correio, fotos, sessao, criarOrcamento, fetch: fetchStripe = globalThis.fetch }) {
  const modo = config.pagamentosModo;
  const agoraIso = () => iso(relogio());
  const quem = (contaId) => ({ id: null, email: `conta:${contaId}` });
  const linha = (ref) => db.prepare('SELECT * FROM pagamentos_pedido WHERE ref = ?').get(ref);
  const lerConfigOrc = () => Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));
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
    if (p.estado === 'pendente') r.url = urlPagar(p);
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
    config.stripeMetodos.forEach((m, i) => { params[`payment_method_types[${i}]`] = m; });
    const s = await stripe('POST', 'checkout/sessions', params, `domus-${p.ref}`);
    db.prepare('UPDATE pagamentos_pedido SET stripe_sessao = ?, stripe_url = ?, atualizado = ? WHERE id = ?').run(s.id, s.url, agoraIso(), p.id);
    return linha(p.ref);
  }

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
   * "Pagar 19 € e enviar" (POST /api/orcamento com simulação): o pedido fica guardado no pagamento, "a aguardar
   * pagamento" (não aparece no painel), e passa a orçamento quando o pagamento for confirmado. Um pagamento por
   * pagar da mesma conta é reaproveitado (clicar duas vezes não cria dois), com o pedido novo.
   */
  async function iniciarRelatorio({ conta, pedido, localidade }) {
    expirar();
    const fora = foraDaArea(localidade, lerConfigOrc());
    const descricao = fora
      ? 'Relatório técnico da instalação (fora da área servida: sem visita técnica)'
      : 'Relatório técnico e visita técnica (19 € descontados na obra)';
    const json = JSON.stringify(pedido);
    const pend = db.prepare(`SELECT * FROM pagamentos_pedido WHERE conta_id = ? AND fase = 'relatorio' AND estado = 'pendente' AND modo = ?
      AND expira > ? ORDER BY id DESC LIMIT 1`).get(conta.id, modo, relogio());
    if (pend && (modo === 'simulado' || pend.com_visita === (fora ? 0 : 1))) {
      db.prepare('UPDATE pagamentos_pedido SET pedido = ?, descricao = ?, com_visita = ?, atualizado = ? WHERE id = ?').run(json, descricao, fora ? 0 : 1, agoraIso(), pend.id);
      return publico(linha(pend.ref));
    }
    if (pend) cancelar(pend, 'substituido');
    return publico(await novo({ contaId: conta.id, fase: 'relatorio', valorCent: VALOR_RELATORIO_CENT, descricao, retorno: 'simulador', comVisita: !fora, pedido: json }));
  }

  const pagoDe = (orcamentoId, fase) => db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = ? AND estado = \'pago\'').get(orcamentoId, fase);
  const totalPago = (orcamentoId) => db.prepare('SELECT COALESCE(SUM(valor_cent), 0) AS s FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = \'pago\'').get(orcamentoId).s;

  const obraDe = db.prepare('SELECT estado FROM obras WHERE id = ?');
  const obraConcluida = (o) => Boolean(o.obra_concluida) || (o.obra_id ? obraDe.get(o.obra_id)?.estado === 'concluida' : false);

  /**
   * Valores de um orçamento (cêntimos), sempre calculados aqui a partir do valor da proposta (SEM IVA, como o painel o
   * guarda), da taxa de IVA e do que já foi pago: total = proposta + IVA; sinal = 30 % do total − 19 €; restante =
   * total − tudo o que já foi pago − o sinal por pagar. Com o sinal pago, a taxa é a desse pagamento (não muda a meio).
   */
  function valores(o) {
    const relatorio = pagoDe(o.id, 'relatorio')?.valor_cent ?? 0;
    const proposta = o.valor_proposta_cent;
    if (proposta === null || proposta === undefined) return { relatorio, sinal: null, restante: null, proposta: null, total: null, iva: null, iva_pct: ivaAtual() };
    const sinalPago = pagoDe(o.id, 'sinal');
    const ivaPct = sinalPago ? ivaDe(sinalPago) : ivaAtual();
    const total = comIva(proposta, ivaPct);
    const sinal = sinalPago ? sinalPago.valor_cent : calcularSinal(total, relatorio);
    return { relatorio, sinal, restante: Math.max(0, total - totalPago(o.id) - (sinalPago ? 0 : sinal)), proposta, total, iva: total - proposta, iva_pct: ivaPct };
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
      descricao = `Sinal de ${SINAL_PCT} % da proposta do pedido n.º ${o.id} (${euro(v.total)} com IVA)${v.relatorio ? `, menos os ${euro(v.relatorio)} já pagos` : ''}`;
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

  /** O cliente aceitou a proposta (conta.js): sinal por pagar, ou (sinal 0) aceite logo. Devolve o pagamento ou null. */
  async function aoAceitar(conta, o) {
    const v = valores(o);
    if (!(v.sinal > 0)) {
      db.prepare('UPDATE orcamentos SET estado = \'aceite\', atualizado = ? WHERE id = ? AND estado = \'proposta_enviada\'').run(agoraIso(), o.id);
      return null;
    }
    return pagarFase(conta, o, 'sinal');
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
      if (p.fase === 'relatorio') {
        if (!p.pedido) throw new Error(`pagamento ${p.ref}: pago sem o pedido guardado`);
        orcamentoId = criarOrcamento({ ...JSON.parse(p.pedido), pagamento: p.ref, com_visita: Boolean(p.com_visita) }, p.conta_id);
        db.prepare('UPDATE pagamentos_pedido SET orcamento_id = ?, pedido = NULL WHERE id = ?').run(orcamentoId, p.id);
      } else if (p.fase === 'sinal') {
        const a = db.prepare('UPDATE orcamentos SET estado = \'aceite\', atualizado = ? WHERE id = ? AND estado = \'proposta_enviada\'').run(agoraIso(), p.orcamento_id);
        if (a.changes) auditar(quem(p.conta_id), 'proposta_aceite_cliente', `orcamento:${p.orcamento_id}`, { estado: 'aceite', via: 'online', sinal: deCent(p.valor_cent), plano: p.plano });
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
      `  Descrição: ${p.descricao}`, `  Valor: ${euroComIva(p.valor_cent, ivaDe(p))}`, `  Data: ${new Date(p.pago).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short", timeStyle: "short" })}`, `  Referência: ${p.ref}`, '',
      p.fase === 'relatorio' ? (p.com_visita ? 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h) e vamos contactá-lo para marcar a visita técnica.' : 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h).')
        : p.fase === 'sinal' ? 'A proposta está aceite. Vamos contactá-lo para marcar a instalação.' : 'A obra está paga. Obrigado!',
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
  const artigo = db.prepare('SELECT nome, preco_venda_iva_cent, horas_instalacao, horas_troca FROM catalogo WHERE sku = ?');
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
      const extra = [av.map((x) => `«${x}»`).join('; '), a.foto ? 'ver foto' : null].filter(Boolean).join('; ');
      if (extra) t += ` (${extra})`;
    }
    if (a.acao === 'substituir' && (a.tipo === 'tomada' || a.tipo === 'interruptor') && Number.isFinite(a.inteligentes)) {
      const i = Math.min(inteiro(a.inteligentes, 500), n);
      t += i === n ? ` por ${n === 1 ? 'um inteligente' : 'inteligentes'}` : i === 0 ? ` por ${n === 1 ? 'um normal' : 'normais'}` : ` (${i} por inteligentes, ${n - i} por normais)`;
    }
    return `${ACAO_TEXTO[a.acao]}: ${t}`;
  }

  /**
   * Relatório técnico na versão do cliente (docs/PAGAMENTOS-PEDIDO.md): por divisão, a LISTA DE TRABALHO (Reparar /
   * Substituir / Novo, com as avarias; `simulacao.trabalho`, lote 7; os pedidos antigos: tudo Novo pelas linhas das
   * divisões) e o material; o resto (quadro elétrico, central…), a mão de obra e a deslocação à parte. Os PREÇOS e as
   * horas são os do CATÁLOGO e da configuração do servidor (nunca os `preco_iva`/`valor_iva` que o browser mandou).
   * Sem preço de compra, fornecedor, ligações, notas internas nem circuitos.
   */
  function relatorioCliente(o) {
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
    let divs = [];
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
    } else {
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
    // Mão de obra: horas do catálogo (ao substituir, as de troca; sem elas 50 %) × a tarifa da configuração.
    let horas = 0;
    for (const [sku, x] of itens) {
      const a = art(sku);
      if (!a) continue;
      const hi = Number(a.horas_instalacao) || 0;
      const ht = Number.isFinite(a.horas_troca) ? a.horas_troca : hi * 0.5;
      horas += (x.qtd - x.troca) * hi + x.troca * ht;
    }
    horas = Math.round(horas * 100) / 100;
    const tarifa = Number.isFinite(Number(cfg.tarifa_hora_iva)) ? Number(cfg.tarifa_hora_iva) : 35;
    const maoObra = itens.size ? Math.round(horas * tarifa * 100) / 100 : null;
    const deslocacao = itens.size ? deslocacaoServidor(o.localidade ?? s.casa?.localidade ?? '', cfg) : null;
    const somaGeral = Math.round(geral.reduce((t, l) => t + (l.total ?? 0), 0) * 100) / 100;
    const soma = divisoes.reduce((t, d) => t + d.total, 0) + somaGeral + (maoObra ?? 0) + (deslocacao ?? 0);
    const ta = s.totais_acao && typeof s.totais_acao === 'object' ? s.totais_acao : {};
    const aparelhos = (k) => inteiro(ta[k]?.aparelhos, 10_000);
    return {
      pedido: o.id, libertado: o.relatorio_libertado,
      acoes: { manter: aparelhos('manter'), reparar: aparelhos('reparar'), substituir: aparelhos('substituir'), novo: aparelhos('novo') },
      divisoes, geral: { titulo: 'Quadro elétrico e geral', material: geral, total: somaGeral },
      mao_obra: maoObra === null ? null : { horas, valor: maoObra },
      deslocacao, total: Math.round(soma * 100) / 100,
      nota: 'Valores com IVA, pelos preços do nosso catálogo. O valor final é o da proposta. Os 19 € já pagos são descontados na obra.',
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
      com_visita: p.com_visita === null ? null : Boolean(p.com_visita), descricao: p.descricao, orcamento_id: p.orcamento_id,
    };
  }

  /** Total com IVA, sinal e restante de um pedido para o painel (null sem proposta). */
  function resumoValores(o) {
    const v = valores(o);
    if (v.total === null) return null;
    return { proposta: deCent(v.proposta), iva_pct: v.iva_pct, iva: deCent(v.iva), total: deCent(v.total), relatorio: deCent(v.relatorio), sinal: deCent(v.sinal), restante: deCent(v.restante) };
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
      .map((p) => ({ ...linhaPainel(p), data: p.pago ?? p.criado }));
  }

  /**
   * A conta tem uma tentativa de pagamento dos 19 € nas últimas 24 h (por pagar, falhada ou cancelada)? Então um
   * novo "Pagar 19 € e enviar" é uma RETENTATIVA: não gasta o limite de pedidos por IP (api.js), tem o seu próprio.
   */
  function temTentativaRecente(contaId) {
    expirar();
    return Boolean(db.prepare(`SELECT 1 FROM pagamentos_pedido WHERE conta_id = ? AND fase = 'relatorio'
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
    // Por fase: o pago, senão o mais recente (os antigos cancelados/expirados não interessam ao cliente).
    const porFase = {};
    for (const p of lista) if (!porFase[p.fase] || porFase[p.fase].estado !== 'pago') porFase[p.fase] = p;
    const v = valores(o);
    const sinalPago = Boolean(pagoDe(o.id, 'sinal'));
    const relatorioPago = Boolean(pagoDe(o.id, 'relatorio'));
    const aguardaSinal = o.estado === 'proposta_enviada' && Boolean(o.proposta_aceite) && !sinalPago;
    const concluida = obraConcluida(o);
    return {
      pagamentos: Object.values(porFase).sort((a, b) => a.id - b.id).map(publico),
      relatorio: o.simulacao ? (o.relatorio_libertado ? 'disponivel' : relatorioPago ? 'em_revisao' : null) : null,
      // A proposta é sem IVA; o que se paga online inclui-o (total = proposta + IVA).
      proposta_iva: v.total === null ? null : { base: deCent(v.proposta), iva_pct: v.iva_pct, iva: deCent(v.iva), total: deCent(v.total) },
      sinal: v.sinal === null ? null : { valor: deCent(v.sinal), pct: SINAL_PCT, desconto: deCent(v.relatorio), pago: sinalPago },
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
    ['GET', /^\/api\/conta\/pedidos\/(\d+)\/relatorio$/, 'relatorio'],
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
    if (url.searchParams.get('fotos') === '1' && p.fase === 'relatorio' && p.estado === 'pago' && p.orcamento_id && Date.parse(p.pago) + FOTOS_DEPOIS_MS > relogio()) {
      r.fotos_token = fotos.emitirToken(p.orcamento_id);
      r.fotos_max = 40;
    }
    responder(res, 200, r);
  };

  // Página simulada: só no modo simulado (no modo stripe responde como se não existisse).
  h.simular = async ({ req, res, c, m, ip }) => {
    if (!config.pagamentoPedido || modo !== 'simulado') throw new ErroApi(404, 'Endereço desconhecido.');
    const v = await lerJson(req, ['resultado']);
    const resultado = opcao(v.resultado, 'resultado', ['sucesso', 'falha', 'cancelar']);
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
    tratarEvento(evento);
    const depois = linha(p.ref);
    responder(res, 200, { pagamento: publico(depois), voltar: voltar(depois) });
  };

  h.pagar = async ({ req, res, c, m }) => {
    if (!config.pagamentoPedido) throw new ErroApi(404, 'Endereço desconhecido.');
    const v = await lerJson(req, ['fase']);
    const fase = opcao(v.fase, 'fase', ['sinal', 'restante']);
    const o = pedidoDaConta(c, m[1]);
    responder(res, 200, { pagamento: await pagarFase(c, o, fase) });
  };

  h.relatorio = ({ res, c, m }) => {
    const o = pedidoDaConta(c, m[1]);
    if (!o.simulacao) throw new ErroApi(404, 'Este pedido não tem relatório técnico.');
    if (!o.relatorio_libertado) throw new ErroApi(409, 'O relatório está em revisão (até 24 h).');
    responder(res, 200, { relatorio: relatorioCliente(o) });
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
    modo, ativo: config.pagamentoPedido, tratar, iniciarRelatorio, aoAceitar, pagarFase, aoMudarProposta, tratarEvento,
    listarParaPainel, paraCliente, relatorioCliente, valores, expirar, iniciar, parar, publico,
    resumoValores, listarTodos, temTentativaRecente, info, ivaAtual,
    PLANOS: PLANOS_MENSAIS,
  };
}
