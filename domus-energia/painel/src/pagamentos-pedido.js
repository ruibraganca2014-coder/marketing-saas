// Pagamentos do pedido de orçamento (docs/PAGAMENTOS-PEDIDO.md): 19 € ao enviar (relatório técnico + visita
// técnica, descontados na obra; fora da área só o relatório), sinal de 30 % (menos os 19 €) ao aceitar a proposta e
// o restante no fim da obra. Vive no painel (tem as contas, os pedidos, a auditoria e os emails); o serviço
// pagamentos/ continua só com as subscrições mensais.
//
// Dois modos (PAGAMENTOS_MODO):
// - "simulado" (por omissão sem STRIPE_SECRET_KEY): nenhum dinheiro real. O "pagamento" abre a página do site
//   pagamento-simulado.html, que chama POST /api/conta/pagamentos/:ref/simular; daí sai um evento com o MESMO
//   formato de um webhook do Stripe (checkout.session.*), tratado pela mesma função (tratarEvento).
// - "stripe": Stripe Checkout (cartão, MB Way, Multibanco) pela API REST; confirmação pelo webhook assinado
//   (POST /api/conta/pagamentos/stripe-webhook) e, no regresso do cliente, pela leitura da sessão no Stripe.
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

// ------------------------------------------------------------ área servida (a mesma regra do simulador, §5.1)
const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const CONC = new Map(CONCELHOS.map(([nome, , ilha, lat, lon]) => [chave(nome), { nome, ilha, lat, lon }]));
function concelho(texto) {
  const k = chave(texto);
  if (!k) return null;
  return CONC.get(k) ?? (String(texto).includes(',') ? CONC.get(chave(String(texto).split(',')[0])) : null) ?? null;
}
/** true = fora da área servida (outra ilha ou acima da distância máxima); false = dentro ou desconhecido (a visita confirma). */
export function foraDaArea(localidade, cfg) {
  const c = concelho(localidade);
  const base = concelho(cfg.deslocacao_base ?? 'Lisboa') ?? concelho('Lisboa');
  if (!c || !base) return false;
  if ((c.ilha ?? null) !== (base.ilha ?? null)) return true;
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c.lat - base.lat) / 2) ** 2 + Math.cos(r(base.lat)) * Math.cos(r(c.lat)) * Math.sin(r(c.lon - base.lon) / 2) ** 2;
  const km = Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 1.3);
  const max = Number(cfg.deslocacao_max_km);
  return Number.isFinite(max) && km > max;
}

/** Sinal (cêntimos) de uma proposta: 30 % do valor menos o que já foi pago pelo relatório (nunca negativo). */
export function calcularSinal(valorPropostaCent, relatorioPagoCent) {
  return Math.max(0, Math.round((valorPropostaCent * SINAL_PCT) / 100) - relatorioPagoCent);
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

  /** O que o cliente vê de um pagamento (nunca dados internos). */
  function publico(p) {
    const r = {
      ref: p.ref, fase: p.fase, fase_texto: NOME_FASE[p.fase], valor: deCent(p.valor_cent), descricao: p.descricao,
      estado: p.estado, estado_texto: TEXTO_ESTADO[p.estado], modo: p.modo, criado: p.criado, pago: p.pago,
      orcamento_id: p.orcamento_id, com_visita: p.com_visita === null ? null : Boolean(p.com_visita), plano: p.plano,
    };
    if (p.estado === 'pendente') r.url = urlPagar(p);
    if (p.estado === 'pago') r.recibo = { data: p.pago, valor: deCent(p.valor_cent), descricao: p.descricao, referencia: p.ref, simulado: p.modo === 'simulado' };
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

  async function novo({ contaId, orcamentoId = null, fase, valorCent, descricao, retorno, comVisita = null, plano = null, pedido = null }) {
    if (modo === 'stripe' && !config.stripeChave) throw new ErroApi(503, 'Os pagamentos ainda não estão configurados neste servidor.');
    const ref = `pp_${randomBytes(16).toString('base64url')}`;
    const agora = agoraIso();
    db.prepare(`INSERT INTO pagamentos_pedido (ref, conta_id, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, com_visita, plano, pedido, criado, atualizado, expira)
      VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ref, contaId, orcamentoId, fase, valorCent, descricao, modo, retorno, comVisita === null ? null : comVisita ? 1 : 0, plano, pedido, agora, agora, relogio() + VALIDADE_MS);
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

  /** Valores de um orçamento (cêntimos), sempre calculados aqui a partir do valor da proposta e do que já foi pago. */
  function valores(o) {
    const relatorio = pagoDe(o.id, 'relatorio')?.valor_cent ?? 0;
    const proposta = o.valor_proposta_cent;
    if (proposta === null || proposta === undefined) return { relatorio, sinal: null, restante: null };
    const sinalPago = pagoDe(o.id, 'sinal');
    const sinal = sinalPago ? sinalPago.valor_cent : calcularSinal(proposta, relatorio);
    return { relatorio, sinal, restante: Math.max(0, proposta - totalPago(o.id) - (sinalPago ? 0 : sinal)) };
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
      descricao = `Sinal de ${SINAL_PCT} % da proposta do pedido n.º ${o.id}${v.relatorio ? ` (menos os ${euro(v.relatorio)} já pagos)` : ''}`;
    } else {
      if (o.estado !== 'aceite' || !pagoDe(o.id, 'sinal') && valores(o).sinal > 0) throw new ErroApi(409, 'Ainda não há nada para pagar neste pedido.');
      if (!obraConcluida(o)) throw new ErroApi(409, 'O restante paga-se quando a obra estiver concluída.');
      valorCent = v.restante;
      descricao = `Restante da obra do pedido n.º ${o.id}`;
    }
    if (!(valorCent > 0)) throw new ErroApi(409, 'Não há nada para pagar.');
    const pend = db.prepare(`SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = ? AND estado = 'pendente' AND expira > ? AND modo = ? ORDER BY id DESC LIMIT 1`)
      .get(o.id, fase, relogio(), modo);
    if (pend && pend.valor_cent === valorCent) return publico(pend);
    if (pend) cancelar(pend, 'valor_mudou');
    return publico(await novo({ contaId: conta.id, orcamentoId: o.id, fase, valorCent, descricao, retorno: 'conta', plano: fase === 'sinal' ? o.plano_escolhido : null }));
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
    const u = db.prepare('UPDATE pagamentos_pedido SET estado = ?, atualizado = ? WHERE id = ? AND estado = \'pendente\'').run(estado, agoraIso(), p.id);
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
      `  Descrição: ${p.descricao}`, `  Valor: ${euro(p.valor_cent)}`, `  Data: ${p.pago}`, `  Referência: ${p.ref}`, '',
      p.fase === 'relatorio' ? (p.com_visita ? 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h) e vamos contactá-lo para marcar a visita técnica.' : 'O seu pedido foi recebido. O relatório técnico fica pronto na sua conta depois de revisto (até 24 h).')
        : p.fase === 'sinal' ? 'A proposta está aceite. Vamos contactá-lo para marcar a instalação.' : 'A obra está paga. Obrigado!',
      ...(site ? ['', `A sua conta: ${site}`] : []), '', 'Domus Energia',
    ] : [
      'Olá,', '', `O pagamento "${p.descricao}" (${euro(p.valor_cent)}) não foi concluído${sim}. Não foi cobrado nada.`,
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
  const artigo = db.prepare('SELECT nome, categoria, especificacoes, preco_venda_iva_cent FROM catalogo WHERE sku = ?');
  const SKU_DIVISAO = [
    ['estores', 'BAB-CURTAIN', 'estore automático', 'estores automáticos'],
    ['sensores_porta', 'SENS-PORTA-WIFI', 'aviso de porta ou janela aberta', 'avisos de porta ou janela aberta'],
    ['sensores_movimento', 'SENS-PIR-WIFI', 'sensor de movimento', 'sensores de movimento'],
    ['luzes_regulaveis', 'DIMMER-WIFI', 'luz com intensidade regulável', 'luzes com intensidade regulável'],
    ['tomadas_inteligentes', 'TOMADA-WIFI', 'tomada inteligente', 'tomadas inteligentes'],
  ];
  /**
   * Relatório técnico na versão do cliente: lista de trabalho, divisões, material e preço (com IVA, da simulação)
   * por divisão; o resto (quadro elétrico, central…), a mão de obra e a deslocação à parte. Sem preço de compra,
   * fornecedor, ligações, notas internas nem circuitos.
   */
  function relatorioCliente(o) {
    let s;
    try { s = JSON.parse(o.simulacao ?? 'null'); } catch { s = null; }
    if (!s || typeof s !== 'object') return null;
    const itens = new Map();
    for (const i of Array.isArray(s.itens) ? s.itens.slice(0, 500) : []) {
      if (!i || typeof i.sku !== 'string') continue;
      const q = Number.isFinite(i.qtd) && i.qtd > 0 ? Math.min(Math.round(i.qtd), 10_000) : 0;
      const x = itens.get(i.sku) ?? { qtd: 0, preco: Number.isFinite(i.preco_iva) ? i.preco_iva : null };
      x.qtd += q;
      itens.set(i.sku, x);
    }
    const preco = (sku) => itens.get(sku)?.preco ?? deCent(artigo.get(sku)?.preco_venda_iva_cent) ?? null;
    const nome = (sku) => artigo.get(sku)?.nome ?? sku;
    const usado = new Map();
    const tirar = (sku, q) => usado.set(sku, (usado.get(sku) ?? 0) + q);
    const n = (v) => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 200) : 0);
    const divisoes = (Array.isArray(s.divisoes) ? s.divisoes.slice(0, 200) : []).filter((d) => d && typeof d === 'object').map((d) => {
      const trabalho = [];
      const material = [];
      const junta = (sku, q) => {
        if (!q) return;
        const m = material.find((x) => x.sku === sku);
        if (m) m.quantidade += q; else material.push({ sku, quantidade: q });
        tirar(sku, q);
      };
      const ints = Array.isArray(d.interruptores) ? d.interruptores.slice(0, 50).map((b) => Math.max(1, Math.min(4, Math.round(Number(b) || 1)))) : [];
      if (ints.length) {
        trabalho.push(`${ints.length} ${ints.length === 1 ? 'interruptor inteligente' : 'interruptores inteligentes'} (luzes pelo telemóvel)`);
        for (const b of ints) junta(`INT-VIDRO-${b}`, 1);
      }
      for (const [k, sku, um, varios] of SKU_DIVISAO) {
        const q = n(d[k]);
        if (!q) continue;
        trabalho.push(`${q} ${q === 1 ? um : varios}`);
        junta(sku, q);
      }
      if (n(d.estores_sem_motor)) trabalho.push(`${n(d.estores_sem_motor)} ${n(d.estores_sem_motor) === 1 ? 'estore sem motor (a ver na visita)' : 'estores sem motor (a ver na visita)'}`);
      const linhas = material.map((m) => {
        const p = preco(m.sku);
        return { artigo: nome(m.sku), quantidade: m.quantidade, preco_unitario: p, total: p === null ? null : Math.round(p * m.quantidade * 100) / 100 };
      });
      return {
        nome: typeof d.nome === 'string' ? d.nome.slice(0, 60) : 'Divisão', trabalho, material: linhas,
        total: Math.round(linhas.reduce((t, l) => t + (l.total ?? 0), 0) * 100) / 100,
      };
    });
    const geral = [];
    for (const [sku, x] of itens) {
      const q = x.qtd - Math.min(x.qtd, usado.get(sku) ?? 0);
      if (q <= 0) continue;
      const p = preco(sku);
      geral.push({ artigo: nome(sku), quantidade: q, preco_unitario: p, total: p === null ? null : Math.round(p * q * 100) / 100 });
    }
    const maoObra = Number.isFinite(s.mao_obra?.valor_iva) ? s.mao_obra.valor_iva : null;
    const deslocacao = Number.isFinite(s.deslocacao?.valor_iva) ? s.deslocacao.valor_iva : null;
    const soma = divisoes.reduce((t, d) => t + d.total, 0) + geral.reduce((t, l) => t + (l.total ?? 0), 0) + (maoObra ?? 0) + (deslocacao ?? 0);
    return {
      pedido: o.id, libertado: o.relatorio_libertado,
      divisoes, geral: { titulo: 'Quadro elétrico e geral', material: geral, total: Math.round(geral.reduce((t, l) => t + (l.total ?? 0), 0) * 100) / 100 },
      mao_obra: maoObra === null ? null : { horas: Number.isFinite(s.mao_obra?.horas) ? s.mao_obra.horas : null, valor: maoObra },
      deslocacao, total: Math.round(soma * 100) / 100,
      nota: 'Valores com IVA, da simulação revista pela nossa equipa. O valor final é o da proposta. Os 19 € já pagos são descontados na obra.',
    };
  }

  // ------------------------------------------------------------ para o painel e para a conta
  const doOrcamento = db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? ORDER BY id');
  function listarParaPainel(orcamentoId) {
    return doOrcamento.all(orcamentoId).map((p) => ({
      ref: p.ref, fase: p.fase, fase_texto: NOME_FASE[p.fase], valor: deCent(p.valor_cent), estado: p.estado,
      estado_texto: TEXTO_ESTADO[p.estado], modo: p.modo, criado: p.criado, pago: p.pago, plano: p.plano,
      com_visita: p.com_visita === null ? null : Boolean(p.com_visita),
    }));
  }

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
      sinal: v.sinal === null ? null : { valor: deCent(v.sinal), pct: SINAL_PCT, desconto: deCent(v.relatorio), pago: sinalPago },
      aguarda_sinal: aguardaSinal,
      pode_pagar_sinal: aguardaSinal && v.sinal > 0,
      restante: o.estado === 'aceite' && v.restante !== null ? { valor: deCent(v.restante), pago: Boolean(pagoDe(o.id, 'restante')), obra_concluida: concluida } : null,
      pode_pagar_restante: o.estado === 'aceite' && concluida && v.restante > 0 && !pagoDe(o.id, 'restante'),
      plano: o.plano_escolhido ? { chave: o.plano_escolhido, nome: NOME_PLANO[o.plano_escolhido] } : null,
      modo,
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
    if (modo !== 'simulado') throw new ErroApi(404, 'Endereço desconhecido.');
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
    PLANOS: PLANOS_MENSAIS,
  };
}
