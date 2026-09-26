// Envio de notificações: ntfy (no próprio servidor) e Firebase Cloud
// Messaging (API HTTP v1, opcional).

import fs from 'node:fs';

/** @typedef {import('./motor.js').PedidoNotificacao} PedidoNotificacao */

/**
 * Codifica um cabeçalho HTTP com caracteres não ASCII (RFC 2047), que o ntfy
 * aceita — o fetch não deixa enviar UTF-8 cru em cabeçalhos.
 * @param {string} s
 */
export function cabecalhoSeguro(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

export class Ntfy {
  /**
   * @param {object} o
   * @param {string} o.url        URL interno do ntfy (ex.: http://ntfy)
   * @param {string} [o.token]
   * @param {string} [o.utilizador]
   * @param {string} [o.senha]
   * @param {{info: Function, aviso: Function, erro: Function}} o.log
   */
  constructor({ url, token, utilizador, senha, log }) {
    this.url = url.replace(/\/+$/, '');
    this.log = log;
    this.autorizacao = token
      ? `Bearer ${token}`
      : utilizador && senha
        ? `Basic ${Buffer.from(`${utilizador}:${senha}`).toString('base64')}`
        : null;
  }

  /** @param {PedidoNotificacao} p */
  async enviar(p) {
    if (!p.topicoNtfy) return;
    /** @type {Record<string,string>} */
    const cabecalhos = {
      Title: cabecalhoSeguro(p.titulo),
      Priority: p.prioridade,
      Tags: p.tags.join(','),
      'Content-Type': 'text/plain; charset=utf-8',
    };
    if (this.autorizacao) cabecalhos.Authorization = this.autorizacao;
    const r = await fetch(`${this.url}/${p.topicoNtfy}`, {
      method: 'POST',
      headers: cabecalhos,
      body: p.mensagem,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`ntfy respondeu ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
}

export class Fcm {
  /**
   * @param {object} o
   * @param {string} [o.ficheiroConta] caminho do JSON da conta de serviço
   * @param {{info: Function, aviso: Function, erro: Function}} o.log
   */
  constructor({ ficheiroConta, log }) {
    this.log = log;
    this.ativo = false;
    this.projeto = null;
    this.cliente = null; // cliente OAuth do google-auth-library (carregado só se preciso)
    this.ficheiroConta = ficheiroConta;
    try {
      if (!ficheiroConta || !fs.statSync(ficheiroConta).isFile()) throw new Error('não existe');
      const conta = JSON.parse(fs.readFileSync(ficheiroConta, 'utf8'));
      if (!conta.project_id || !conta.client_email || !conta.private_key) throw new Error('conta de serviço incompleta');
      this.conta = conta;
      this.projeto = conta.project_id;
      this.ativo = true;
      log.info(`[fcm] ligado (projeto ${this.projeto})`);
    } catch (e) {
      log.info(`[fcm] desligado: ${ficheiroConta || '(sem FCM_SERVICE_ACCOUNT)'} — ${e.message}`);
    }
  }

  async obterCliente() {
    if (!this.cliente) {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        credentials: this.conta,
        scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
      });
      this.cliente = await auth.getClient();
    }
    return this.cliente;
  }

  /**
   * Envia para todos os tokens. Devolve os tokens que o FCM diz já não
   * existirem (UNREGISTERED / 404), para serem apagados.
   * @param {PedidoNotificacao} p
   * @returns {Promise<string[]>}
   */
  async enviar(p) {
    if (!this.ativo || p.tokensFcm.length === 0) return [];
    const cliente = await this.obterCliente();
    const url = `https://fcm.googleapis.com/v1/projects/${this.projeto}/messages:send`;
    /** @type {string[]} */
    const invalidos = [];
    await Promise.all(
      p.tokensFcm.map(async (token) => {
        try {
          await cliente.request({
            url,
            method: 'POST',
            data: {
              message: {
                token,
                notification: { title: p.titulo, body: p.mensagem },
                data: { cliente: p.cliente, tipo: p.tipo },
                // Prioridade alta só para alarmes: o Android limita as mensagens de alta
                // prioridade e, se gastas em avisos, os alarmes passam a chegar atrasados.
                android: p.tipo === 'alarme'
                  ? { priority: 'high', notification: { channel_id: 'alarmes' } }
                  : { priority: 'normal', notification: { channel_id: 'avisos' } },
              },
            },
            timeout: 10_000,
          });
        } catch (e) {
          const estado = e.response?.status;
          const detalhes = JSON.stringify(e.response?.data ?? '');
          if (estado === 404 || detalhes.includes('UNREGISTERED')) invalidos.push(token);
          else this.log.aviso(`[fcm] envio falhou (${estado ?? e.message}): ${detalhes.slice(0, 200)}`);
        }
      }),
    );
    return invalidos;
  }
}

/**
 * Junta ntfy + FCM numa só função `notificar` para o motor.
 * @param {{ntfy: Ntfy, fcm: Fcm, log: {erro: Function}}} o
 */
export function criarNotificador({ ntfy, fcm, log }) {
  /** @param {PedidoNotificacao} p */
  return async (p) => {
    const [rNtfy, rFcm] = await Promise.allSettled([ntfy.enviar(p), fcm.enviar(p)]);
    if (rNtfy.status === 'rejected') log.erro(`[ntfy] ${p.cliente}: ${rNtfy.reason?.message ?? rNtfy.reason}`);
    if (rFcm.status === 'rejected') log.erro(`[fcm] ${p.cliente}: ${rFcm.reason?.message ?? rFcm.reason}`);
    return { tokensInvalidos: rFcm.status === 'fulfilled' ? rFcm.value : [] };
  };
}
