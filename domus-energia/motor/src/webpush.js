// Web push: notificações da própria app do cliente (web/cliente.html + web/sw.js), sem a app ntfy.
// Decisão do dono, 2026-10-14: é o canal PRINCIPAL; o ntfy fica como alternativa e continua igual.
//
// - As subscrições (endpoint + chaves do navegador) chegam por MQTT em `domus/<c>/_webpush/registar` (como o
//   `_fcm/registar`): o broker já autentica o cliente e a ACL só o deixa escrever na sua casa. O motor guarda-as no
//   estado (estado.json), por casa, no máximo MAX_SUBSCRICOES_WEBPUSH.
// - O motor só faz pedidos a serviços de push conhecidos (HOSTS_PUSH): o endpoint vem do navegador do cliente e o
//   servidor faz um POST para lá, por isso qualquer outro endereço é recusado (SSRF).
// - Chaves VAPID: criadas no primeiro arranque em <dados>/vapid.json (modo 600), nunca escritas no registo nem no git.
//   A chave pública vai para a app em `domus/<c>/_webpush` (retido).
// - A cifra e a assinatura são da biblioteca `web-push` (não se faz à mão).

import fs from 'node:fs';
import path from 'node:path';

/** Máximo de telemóveis/navegadores com avisos por casa. */
export const MAX_SUBSCRICOES_WEBPUSH = 10;
/** Tamanho máximo do endpoint (os do Windows são os mais compridos, ~500). */
export const MAX_ENDPOINT = 1024;

/**
 * Serviços de push a que o motor aceita enviar (decisão do dono, 2026-10-14). Uma entrada que começa por "." aceita
 * os subdomínios (ex.: ".push.apple.com" aceita "api.push.apple.com"); as outras têm de ser iguais.
 *   fcm.googleapis.com              — Chrome, Edge antigo, Samsung Internet, Opera (Android e computador)
 *   updates.push.services.mozilla.com — Firefox
 *   web.push.apple.com, .push.apple.com — Safari (iPhone com a app no ecrã principal, Mac)
 *   .notify.windows.com             — Edge no Windows
 */
export const HOSTS_PUSH = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', '.push.apple.com', '.notify.windows.com'];

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** O anfitrião está na lista HOSTS_PUSH? @param {string} host */
export function hostPermitido(host) {
  const h = host.toLowerCase();
  return HOSTS_PUSH.some((p) => (p.startsWith('.') ? h.endsWith(p) && h.length > p.length : h === p));
}

/**
 * Valida o endpoint: https, sem porta nem utilizador, anfitrião da lista, tamanho limitado.
 * @param {unknown} endpoint
 * @returns {string|null} o motivo da recusa, ou null se servir
 */
export function motivoEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return 'sem endpoint';
  if (endpoint.length > MAX_ENDPOINT) return 'endpoint comprido demais';
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return 'endpoint inválido';
  }
  if (u.protocol !== 'https:') return 'endpoint sem https';
  if (u.username || u.password || u.port) return 'endpoint com utilizador ou porta';
  if (!hostPermitido(u.hostname)) return `serviço de push desconhecido (${u.hostname})`;
  return null;
}

/**
 * Valida uma subscrição como o navegador a dá (PushSubscription.toJSON()).
 * @param {any} s
 * @returns {{ok: true, subscricao: {endpoint: string, keys: {p256dh: string, auth: string}}} | {ok: false, erro: string}}
 */
export function validarSubscricao(s) {
  if (!s || typeof s !== 'object') return { ok: false, erro: 'subscrição em falta' };
  const erroEndpoint = motivoEndpoint(s.endpoint);
  if (erroEndpoint) return { ok: false, erro: erroEndpoint };
  const k = s.keys;
  // p256dh: chave pública P-256 (65 bytes → 87 em base64url); auth: 16 bytes (22).
  if (!k || typeof k !== 'object' || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return { ok: false, erro: 'chaves em falta' };
  if (!BASE64URL.test(k.p256dh) || k.p256dh.length < 80 || k.p256dh.length > 100) return { ok: false, erro: 'chave p256dh inválida' };
  if (!BASE64URL.test(k.auth) || k.auth.length < 16 || k.auth.length > 32) return { ok: false, erro: 'chave auth inválida' };
  return { ok: true, subscricao: { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } } };
}

/**
 * Lê as chaves VAPID de `ficheiro`; se não existir, cria-as (modo 600, escrita atómica). Nunca as escreve no registo.
 * @param {string} ficheiro
 * @param {{generateVAPIDKeys: () => {publicKey: string, privateKey: string}}} biblioteca
 * @param {{info: Function}} log
 * @returns {{publicKey: string, privateKey: string}}
 */
export function chavesVapid(ficheiro, biblioteca, log) {
  try {
    const v = JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
    if (typeof v.publicKey === 'string' && typeof v.privateKey === 'string' && BASE64URL.test(v.publicKey) && BASE64URL.test(v.privateKey)) {
      return { publicKey: v.publicKey, privateKey: v.privateKey };
    }
    throw new Error(`${ficheiro} incompleto`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // ficheiro estragado: não se troca a chave em silêncio (os telemóveis deixavam de receber)
  }
  const { publicKey, privateKey } = biblioteca.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(ficheiro), { recursive: true });
  const tmp = `${ficheiro}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ publicKey, privateKey, criado: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, ficheiro);
  log.info(`[webpush] chaves VAPID criadas em ${ficheiro}`);
  return { publicKey, privateKey };
}

/** Mesmo texto e prioridade do ntfy; o service worker (web/sw.js) mostra-o. @param {import('./motor.js').PedidoNotificacao} p */
export function conteudoPush(p) {
  return JSON.stringify({
    titulo: p.titulo,
    mensagem: p.mensagem,
    tipo: p.tipo,
    prioridade: p.prioridade,
  });
}

export class WebPush {
  /**
   * @param {object} o
   * @param {string} [o.ficheiroChaves]   <dados>/vapid.json
   * @param {string} o.contacto           "https://HOST" ou "mailto:…" (os serviços de push pedem um contacto)
   * @param {any} [o.biblioteca]          o módulo `web-push` (injetável nos testes)
   * @param {{publicKey: string, privateKey: string}} [o.chaves]  (testes) em vez do ficheiro
   * @param {{info: Function, aviso: Function, erro: Function}} o.log
   */
  constructor({ ficheiroChaves, contacto, biblioteca, chaves, log }) {
    this.log = log;
    this.biblioteca = biblioteca;
    this.contacto = contacto;
    this.chaves = null;
    try {
      this.chaves = chaves ?? chavesVapid(/** @type {string} */ (ficheiroChaves), biblioteca, log);
      log.info('[webpush] ligado');
    } catch (e) {
      log.erro(`[webpush] desligado: ${e.message}`);
    }
  }

  /** Chave pública VAPID para a app (null = web push desligado). */
  get chavePublica() {
    return this.chaves?.publicKey ?? null;
  }

  /**
   * Envia para as subscrições da casa. Devolve os endpoints que o serviço diz já não existirem (404/410), para
   * serem apagados. Nunca lança por causa de um telemóvel.
   * @param {import('./motor.js').PedidoNotificacao} p
   * @returns {Promise<string[]>}
   */
  async enviar(p) {
    const lista = p.subscricoesWebPush ?? [];
    if (!this.chaves || lista.length === 0) return [];
    const corpo = conteudoPush(p);
    const urgente = p.tipo === 'alarme' || p.prioridade === 'urgent';
    /** @type {string[]} */
    const invalidos = [];
    await Promise.all(
      lista.map(async (s) => {
        // Defesa em profundidade: o estado guardado pode ter sido mexido à mão.
        if (motivoEndpoint(s.endpoint)) return;
        try {
          await this.biblioteca.sendNotification(s, corpo, {
            vapidDetails: { subject: this.contacto, publicKey: this.chaves.publicKey, privateKey: this.chaves.privateKey },
            // Um alarme com mais de 1 h já não serve; os outros avisos aguardam até 1 dia pelo telemóvel desligado.
            TTL: urgente ? 3600 : 86_400,
            // "low" atrasava os avisos até o telemóvel estar a carregar: só o alarme é "high", o resto "normal".
            urgency: urgente ? 'high' : 'normal',
            timeout: 10_000,
          });
        } catch (e) {
          const estado = e?.statusCode;
          if (estado === 404 || estado === 410) invalidos.push(s.endpoint);
          // O endpoint é um segredo do telemóvel: no registo só fica o serviço.
          else this.log.aviso(`[webpush] ${p.cliente}: envio para ${hostDe(s.endpoint)} falhou (${estado ?? e?.message ?? e})`);
        }
      }),
    );
    return invalidos;
  }
}

/** @param {string} endpoint */
function hostDe(endpoint) {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return '?';
  }
}
