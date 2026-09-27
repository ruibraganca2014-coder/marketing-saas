// Lógica do serviço: estado dos planos, eventos do Stripe, checkout, portal,
// verificação diária e registo dos pagamentos (docs/PROTOCOLO-PLANOS.md §2–§5).

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ArmazemPlanos, PLANOS, clienteValido, payloadPlano, planoMudou, transicionar,
} from './planos.js';
import { EventosTratados } from './eventos.js';
import { Fila, dataLisboa, isoDeUnix } from './util.js';

export const EVENTOS_TRATADOS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

/** Estado da subscrição no Stripe → estado do `_plano` (null = não mexer). */
export function estadoDoStripe(status) {
  switch (status) {
    case 'trialing': return 'teste';
    case 'active': return 'ativo';
    case 'past_due':
    case 'unpaid': return 'em_atraso';
    case 'paused': return 'suspenso';
    case 'canceled':
    case 'incomplete_expired': return 'cancelado';
    default: return null; // incomplete: o primeiro pagamento ainda não foi feito
  }
}

/** Erro com código HTTP e mensagem pt-PT para o cliente. */
export class ErroApi extends Error {
  constructor(estado, mensagem) {
    super(mensagem);
    this.estado = estado;
  }
}

const id = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' && typeof x.id === 'string' ? x.id : null));

/** Id da subscrição a que o objeto do evento se refere (várias versões da API do Stripe). */
export function subscricaoDoObjeto(tipo, o) {
  if (tipo.startsWith('customer.subscription.')) return id(o);
  if (tipo === 'checkout.session.completed') return id(o.subscription);
  if (tipo.startsWith('invoice.')) {
    return id(o.parent?.subscription_details?.subscription) // API 2025-03-31 (basil) ou mais recente
      ?? id(o.subscription) // API antiga
      ?? id(o.lines?.data?.[0]?.parent?.subscription_item_details?.subscription)
      ?? id(o.lines?.data?.[0]?.subscription);
  }
  return null;
}

/** Código do cliente Domus guardado nos metadados (ou null). */
export function clienteDoObjeto(o) {
  const candidatos = [
    o?.metadata?.cliente,
    o?.client_reference_id,
    o?.parent?.subscription_details?.metadata?.cliente,
    o?.subscription_details?.metadata?.cliente,
    o?.lines?.data?.[0]?.metadata?.cliente,
  ];
  return candidatos.find((c) => clienteValido(c)) ?? null;
}

/** Preço de uma linha de fatura (várias versões da API). */
function precoDaLinha(l) {
  return id(l?.pricing?.price_details?.price) ?? id(l?.price);
}

/** Fim do período atual (API nova: nos itens; antiga: na subscrição). */
function fimPeriodo(sub) {
  const itens = sub.items?.data ?? [];
  const nos = itens.map((i) => i.current_period_end).filter(Number.isFinite);
  if (nos.length) return Math.min(...nos);
  return Number.isFinite(sub.current_period_end) ? sub.current_period_end : null;
}

export class Pagamentos {
  /**
   * @param {{config: object, stripe: object|null, publicador: object|null, registo: object, relogio?: () => Date}} o
   */
  constructor({ config, stripe, publicador, registo, relogio = () => new Date() }) {
    this.config = config;
    this.stripe = stripe;
    this.publicador = publicador;
    this.registo = registo;
    this.relogio = relogio;
    this.planos = new ArmazemPlanos(config.planosDir);
    this.eventos = new EventosTratados(config.eventosFich);
    this.fila = new Fila();
    this.planoDoPreco = Object.fromEntries(Object.entries(config.stripe.precos).map(([p, preco]) => [preco, p]));
  }

  // ---------------------------------------------------------------- _plano

  async publicarPlano(c, registo) {
    if (!this.publicador) return false;
    return this.publicador.publicar(`domus/${c}/_plano`, payloadPlano(registo));
  }

  /** Republica o `_plano` de todos os clientes com ficheiro (arranque e cada religação ao MQTT). */
  async republicarTodos() {
    let n = 0;
    for (const c of await this.planos.clientes()) {
      try {
        const r = await this.planos.ler(c);
        if (r && (await this.publicarPlano(c, r))) n++;
      } catch (e) {
        this.registo.erro(e.message);
      }
    }
    this.registo.info(`_plano republicado para ${n} cliente(s)`);
    return n;
  }

  /** Grava e publica, só se mudou alguma coisa. Tem de correr dentro da fila. */
  async #guardar(c, atual, novo, motivo) {
    const mudouFicheiro = !atual || JSON.stringify({ ...atual, atualizado: null }) !== JSON.stringify({ ...novo, atualizado: null });
    if (!mudouFicheiro) return false;
    await this.planos.gravar(c, novo);
    this.registo.info(`plano de ${c}: ${novo.plano}/${novo.estado} (${motivo})`);
    if (planoMudou(atual, novo)) await this.publicarPlano(c, novo);
    return true;
  }

  // ---------------------------------------------------------- tarefa diária

  /** em_atraso com aviso_ate ultrapassado → suspenso (§2, §4). */
  verificarAtrasos() {
    return this.fila.correr(async () => {
      const agora = this.relogio();
      let n = 0;
      for (const c of await this.planos.clientes()) {
        let r;
        try {
          r = await this.planos.ler(c);
        } catch (e) {
          this.registo.erro(e.message);
          continue;
        }
        if (r?.estado === 'em_atraso' && r.aviso_ate && Date.parse(r.aviso_ate) <= agora.getTime()) {
          const novo = transicionar(r, { ...r, estado: 'suspenso' }, agora, this.config.diasAviso);
          if (await this.#guardar(c, r, novo, 'aviso de 15 dias terminou')) n++;
        }
      }
      return n;
    });
  }

  // ------------------------------------------------------------ webhook

  /**
   * Trata um evento já verificado. Idempotente pelo id do evento. Lança em
   * caso de erro temporário (o webhook responde 500 e o Stripe repete).
   * @returns {Promise<'tratado'|'repetido'|'ignorado'>}
   */
  tratarEvento(evento) {
    return this.fila.correr(async () => {
      if (await this.eventos.tratado(evento.id)) return 'repetido';
      let r = 'ignorado';
      if (EVENTOS_TRATADOS.has(evento.type)) r = await this.#tratar(evento);
      await this.eventos.marcar(evento.id);
      return r;
    });
  }

  async #tratar(evento) {
    const tipo = evento.type;
    const o = evento.data?.object ?? {};
    if (tipo === 'checkout.session.completed' && o.mode !== 'subscription') return 'ignorado';
    const subId = subscricaoDoObjeto(tipo, o);
    if (!subId) {
      this.registo.aviso(`${tipo} ${evento.id}: sem subscrição, ignorado`);
      return 'ignorado';
    }
    // Estado atual da subscrição, sempre pedido ao Stripe: os eventos podem
    // chegar fora de ordem e o objeto do evento pode estar desatualizado.
    const sub = await this.#subscricaoOuNull(subId);
    if (!sub) {
      this.registo.aviso(`${tipo} ${evento.id}: a subscrição ${subId} não existe no Stripe, ignorado`);
      return 'ignorado';
    }
    const clienteStripe = id(sub.customer) ?? id(o.customer);
    const c = clienteDoObjeto(o) ?? clienteDoObjeto(sub) ?? (await this.planos.porClienteStripe(clienteStripe));
    if (!c) {
      this.registo.aviso(`${tipo} ${evento.id}: subscrição ${subId} sem cliente Domus (metadata.cliente), ignorado`);
      return 'ignorado';
    }
    const plano = this.#planoDaSubscricao(sub);

    if (tipo === 'invoice.paid' && o.amount_paid > 0) await this.#registarPagamento(c, o, plano, evento);

    const atual = await this.planos.ler(c);
    if (atual?.gerido === 'manual' && tipo !== 'checkout.session.completed') {
      this.registo.info(`${tipo}: ${c} é gerido à mão (domus.sh plano); estado não alterado`);
      return 'tratado';
    }
    const vivo = !['canceled', 'incomplete_expired'].includes(sub.status);
    if (atual?.stripe_subscricao && atual.stripe_subscricao !== sub.id && !vivo) {
      this.registo.info(`${tipo}: subscrição antiga ${sub.id} de ${c}, ignorada`);
      return 'tratado';
    }

    let estado = estadoDoStripe(sub.status);
    if (tipo === 'customer.subscription.deleted') estado = 'cancelado';
    else if (vivo && tipo === 'invoice.payment_failed' && (estado === 'ativo' || estado === 'teste')) estado = 'em_atraso';
    else if (vivo && tipo === 'invoice.paid' && o.amount_paid > 0) estado = 'ativo';
    if (!estado) return 'tratado'; // incomplete: espera pelo pagamento
    if (!plano) throw new Error(`subscrição ${sub.id}: preço desconhecido (confirme STRIPE_PRICE_*)`);

    let proximo = null;
    if (estado === 'teste') proximo = isoDeUnix(sub.trial_end);
    else if (!sub.cancel_at_period_end && !sub.cancel_at) proximo = isoDeUnix(fimPeriodo(sub));

    const novo = transicionar(atual, {
      plano,
      estado,
      proximo_pagamento: proximo,
      gerido: 'stripe',
      stripe_cliente: clienteStripe ?? atual?.stripe_cliente ?? null,
      stripe_subscricao: sub.id,
      teste_usado: estado === 'teste' || sub.trial_end != null,
    }, this.relogio(), this.config.diasAviso);
    await this.#guardar(c, atual, novo, `${tipo} ${evento.id}`);
    return 'tratado';
  }

  #planoDaSubscricao(sub) {
    for (const item of sub.items?.data ?? []) {
      const p = this.planoDoPreco[id(item.price)];
      if (p) return p;
    }
    return null;
  }

  /** Acrescenta uma linha a dados/pagamentos.csv (§5). Nunca duas vezes a mesma fatura. */
  async #registarPagamento(c, fatura, planoSub, evento) {
    const caminho = this.config.csv;
    let existente = '';
    try {
      existente = await readFile(caminho, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (fatura.id && existente.split('\n').some((l) => l.endsWith(`;${fatura.id}`))) return;
    const linhas = fatura.lines?.data ?? [];
    const plano = linhas.map((l) => this.planoDoPreco[precoDaLinha(l)]).find(Boolean) ?? planoSub ?? '';
    const centimos = fatura.amount_paid;
    const semIva = Math.round(centimos / 1.23);
    const euros = (x) => (x / 100).toFixed(2).replace('.', ',');
    const pago = fatura.status_transitions?.paid_at ?? evento.created ?? Math.floor(Date.now() / 1000);
    if (fatura.currency && fatura.currency !== 'eur') this.registo.aviso(`fatura ${fatura.id} em ${fatura.currency}, não em EUR`);
    const linha = [dataLisboa(new Date(pago * 1000)), c, plano, euros(centimos), euros(semIva), fatura.id ?? evento.id].join(';');
    await mkdir(dirname(caminho), { recursive: true });
    const cab = existente ? '' : 'data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe\n';
    await appendFile(caminho, `${cab}${linha}\n`, { mode: 0o640 });
    this.registo.info(`pagamento registado: ${c} ${euros(centimos)} € (${fatura.id})`);
  }

  // ----------------------------------------------------- checkout e portal

  #urlCliente(extra = '') {
    return `${this.config.publicUrl}${this.config.caminhoCliente}${extra}`;
  }

  /** Stripe Checkout (modo subscription), ou o portal se o cliente já tiver uma subscrição viva. */
  async checkout(c, plano) {
    if (!PLANOS.includes(plano)) throw new ErroApi(400, 'Plano inválido. Use "base", "conforto" ou "premium".');
    const atual = await this.planos.ler(c);
    const preco = this.config.stripe.precos[plano];

    // Já tem uma subscrição no Stripe que não acabou (active, trialing,
    // past_due, unpaid, paused, incomplete)? Nunca criar uma segunda: abre-se
    // o Customer Portal — no fluxo de mudança de plano (com o plano escolhido
    // já confirmado, se o portal o permitir) ou na página inicial do portal
    // (pagar o que está em atraso, atualizar o cartão, renovar).
    // Só um cliente sem subscrição viva (nenhuma, canceled, incomplete_expired)
    // recebe uma nova Checkout Session.
    if (atual?.stripe_subscricao && atual.stripe_cliente) {
      const sub = await this.#subscricaoOuNull(atual.stripe_subscricao);
      if (sub && !['canceled', 'incomplete_expired'].includes(sub.status)) {
        return { url: await this.#portalParaPlano(atual.stripe_cliente, sub, preco), portal: true };
      }
    }

    const params = {
      mode: 'subscription',
      line_items: [{ price: preco, quantity: 1 }],
      client_reference_id: c,
      metadata: { cliente: c, plano },
      subscription_data: { metadata: { cliente: c } },
      success_url: this.#urlCliente('?subscricao=ok'),
      cancel_url: this.#urlCliente('?subscricao=cancelada'),
      locale: 'pt',
    };
    if (this.config.stripe.metodos) params.payment_method_types = this.config.stripe.metodos;
    if (this.config.diasTeste > 0 && !atual?.teste_usado) params.subscription_data.trial_period_days = this.config.diasTeste;
    if (atual?.stripe_cliente) params.customer = atual.stripe_cliente;
    const s = await this.stripe.checkout.sessions.create(params);
    return { url: s.url };
  }

  async #subscricaoOuNull(subId) {
    try {
      return await this.stripe.subscriptions.retrieve(subId);
    } catch (e) {
      if (e?.statusCode === 404 || e?.code === 'resource_missing') return null; // apagada no Stripe
      throw e;
    }
  }

  /**
   * URL do Customer Portal para um cliente com subscrição viva. Tenta, por
   * ordem: confirmar a mudança para `preco` (subscription_update_confirm), a
   * escolha do plano (subscription_update) e a página inicial do portal. Os
   * fluxos de mudança só existem se "Customers can switch plans" estiver
   * ligado na configuração do portal (ver README); se o Stripe os recusar,
   * passa-se ao seguinte.
   */
  async #portalParaPlano(cliente, sub, preco) {
    const base = { customer: cliente, return_url: this.#urlCliente(), locale: 'pt' };
    const item = sub.items?.data?.[0];
    const podeMudar = (sub.status === 'active' || sub.status === 'trialing') && item
      && !sub.cancel_at_period_end && !sub.cancel_at && id(item.price) !== preco;
    const depois = { type: 'redirect', redirect: { return_url: this.#urlCliente('?subscricao=ok') } };
    const fluxos = podeMudar ? [
      { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: sub.id, items: [{ id: item.id, price: preco, quantity: 1 }] }, after_completion: depois },
      { type: 'subscription_update', subscription_update: { subscription: sub.id }, after_completion: depois },
    ] : [];
    for (const flow_data of fluxos) {
      try {
        return (await this.stripe.billingPortal.sessions.create({ ...base, flow_data })).url;
      } catch (e) {
        if (e?.type !== 'StripeInvalidRequestError') throw e;
        this.registo.aviso(`portal: fluxo ${flow_data.type} recusado pelo Stripe (${e.message}); a tentar o seguinte`);
      }
    }
    return (await this.stripe.billingPortal.sessions.create(base)).url;
  }

  /** Stripe Customer Portal (mudar de plano, cartão, cancelar, faturas). */
  async portal(c) {
    const atual = await this.planos.ler(c);
    if (!atual?.stripe_cliente) {
      throw new ErroApi(409, 'Ainda não tem pagamentos automáticos. Escolha primeiro um plano.');
    }
    const s = await this.stripe.billingPortal.sessions.create({
      customer: atual.stripe_cliente, return_url: this.#urlCliente(), locale: 'pt',
    });
    return { url: s.url };
  }
}
