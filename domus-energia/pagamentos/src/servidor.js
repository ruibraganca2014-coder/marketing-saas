// Servidor HTTP (atrás do Caddy): /api/sessao, /api/checkout, /api/portal e /stripe/webhook.
// Respostas e erros em JSON, mensagens em pt-PT. Nunca regista corpos de pedidos.

import http from 'node:http';
import { criarToken, verificarToken } from './sessao.js';
import { LimiteTaxa } from './limite.js';
import { clienteValido } from './planos.js';
import { ErroApi } from './pagamentos.js';
import { iso } from './util.js';

const LIMITE_API = 4 * 1024;
const LIMITE_WEBHOOK = 1024 * 1024;

const MSG = {
  json: 'O pedido tem de ser JSON (Content-Type: application/json).',
  jsonInvalido: 'JSON inválido.',
  grande: 'Pedido demasiado grande.',
  sessao: 'Sessão inválida ou expirada. Entre de novo.',
  credenciais: 'Código de cliente ou palavra-passe errados.',
  indisponivel: 'Serviço temporariamente indisponível. Tente de novo dentro de momentos.',
  naoConfigurado: 'Os pagamentos ainda não estão configurados neste servidor.',
  stripe: 'Não foi possível contactar o serviço de pagamentos. Tente de novo dentro de momentos.',
  interno: 'Erro interno. Tente de novo mais tarde.',
  naoEncontrado: 'Endereço desconhecido.',
  metodo: 'Método não permitido.',
};

function responder(res, estado, corpo, extra = {}) {
  const texto = JSON.stringify(corpo);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(texto),
    ...extra,
  });
  res.end(texto);
}

/** Lê o corpo como Buffer, até `limite` bytes. */
function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const decl = Number(req.headers['content-length']);
    if (Number.isFinite(decl) && decl > limite) return reject(new ErroApi(413, MSG.grande));
    const partes = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total > limite) {
        reject(new ErroApi(413, MSG.grande));
        req.destroy();
        return;
      }
      partes.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/** Corpo JSON de um objeto só com os campos permitidos. */
async function lerJson(req, permitidos) {
  const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') throw new ErroApi(415, MSG.json);
  const bruto = await lerCorpo(req, LIMITE_API);
  let v;
  try {
    v = bruto.length ? JSON.parse(bruto.toString('utf8')) : {};
  } catch {
    throw new ErroApi(400, MSG.jsonInvalido);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroApi(400, 'O corpo tem de ser um objeto JSON.');
  for (const k of Object.keys(v)) {
    if (!permitidos.includes(k)) throw new ErroApi(400, `Campo desconhecido: "${k}".`);
  }
  return v;
}

/**
 * @param {{config: object, pagamentos: import('./pagamentos.js').Pagamentos, stripe: object|null,
 *          verificarCredenciais: (c: string, p: string) => Promise<string>, registo: object}} ctx
 */
export function criarServidor(ctx) {
  const { config, pagamentos, registo } = ctx;
  const janela = 60_000;
  const porIp = new LimiteTaxa(config.limiteSessao, janela);
  const porCodigo = new LimiteTaxa(config.limiteSessao, janela);
  const limpeza = setInterval(() => { porIp.limpar(); porCodigo.limpar(); }, 5 * janela);
  limpeza.unref();

  const ipDe = (req) => {
    if (config.confiarProxy) {
      // O Caddy substitui o X-Forwarded-For pelo IP real do visitante; se
      // vier uma lista, o último valor é o que o Caddy acrescentou.
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '?';
  };

  const autenticar = (req) => {
    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization || ''));
    const c = m ? verificarToken(config.segredo, m[1]) : null;
    if (!c || !clienteValido(c)) throw new ErroApi(401, MSG.sessao);
    return c;
  };

  const exigirStripe = () => {
    if (config.errosStripe.length || !ctx.stripe) throw new ErroApi(503, MSG.naoConfigurado);
  };

  async function sessao(req, res) {
    const v = await lerJson(req, ['codigo', 'password']);
    if (typeof v.codigo !== 'string' || typeof v.password !== 'string') {
      throw new ErroApi(400, 'Indique "codigo" e "password".');
    }
    const codigo = v.codigo.trim().toLowerCase();
    if (!codigo || !v.password || v.password.length > 256 || codigo.length > 64) throw new ErroApi(401, MSG.credenciais);
    const ip = ipDe(req);
    const espera = Math.max(porIp.espera(ip), porCodigo.espera(codigo));
    if (espera) {
      registo.aviso(`sessão: demasiadas tentativas (ip ${ip}, código ${clienteValido(codigo) ? codigo : '?'})`);
      return responder(res, 429, { erro: `Demasiadas tentativas. Tente de novo dentro de ${espera} s.` }, { 'Retry-After': String(espera) });
    }
    porIp.registar(ip);
    porCodigo.registar(codigo);
    if (!clienteValido(codigo)) throw new ErroApi(401, MSG.credenciais);
    const r = await ctx.verificarCredenciais(codigo, v.password);
    if (r === 'indisponivel') throw new ErroApi(503, MSG.indisponivel);
    if (r !== 'ok') {
      registo.aviso(`sessão recusada para ${codigo} (ip ${ip})`);
      throw new ErroApi(401, MSG.credenciais);
    }
    const { token, exp } = criarToken(config.segredo, codigo, config.sessaoMin * 60);
    registo.info(`sessão aberta para ${codigo}`);
    return responder(res, 200, { token, cliente: codigo, expira: iso(new Date(exp * 1000)) });
  }

  async function checkout(req, res) {
    const c = autenticar(req);
    exigirStripe();
    const v = await lerJson(req, ['plano']);
    if (typeof v.plano !== 'string') throw new ErroApi(400, 'Indique o "plano": "base", "conforto" ou "premium".');
    return responder(res, 200, await pagamentos.checkout(c, v.plano));
  }

  async function portal(req, res) {
    const c = autenticar(req);
    exigirStripe();
    await lerJson(req, []);
    return responder(res, 200, await pagamentos.portal(c));
  }

  async function webhook(req, res) {
    exigirStripe();
    const bruto = await lerCorpo(req, LIMITE_WEBHOOK);
    const assinatura = req.headers['stripe-signature'];
    let evento;
    try {
      if (typeof assinatura !== 'string') throw new Error('sem assinatura');
      evento = ctx.stripe.webhooks.constructEvent(bruto, assinatura, config.stripe.webhook);
    } catch {
      registo.aviso(`webhook: assinatura inválida (ip ${ipDe(req)})`);
      return responder(res, 400, { erro: 'Assinatura do Stripe inválida.' });
    }
    try {
      const r = await pagamentos.tratarEvento(evento);
      return responder(res, 200, { recebido: true, resultado: r });
    } catch (e) {
      registo.erro(`webhook ${evento.type} ${evento.id}: ${e.message}`);
      return responder(res, 500, { erro: 'Falha ao tratar o evento; o Stripe vai repetir.' });
    }
  }

  const rotas = {
    '/api/sessao': sessao,
    '/api/checkout': checkout,
    '/api/portal': portal,
    '/stripe/webhook': webhook,
  };

  const servidor = http.createServer(async (req, res) => {
    let caminho;
    try {
      caminho = new URL(req.url, 'http://x').pathname;
    } catch {
      return responder(res, 400, { erro: 'Endereço inválido.' });
    }
    const rota = rotas[caminho];
    if (!rota) return responder(res, 404, { erro: MSG.naoEncontrado });
    if (req.method !== 'POST') return responder(res, 405, { erro: MSG.metodo }, { Allow: 'POST' });
    if (config.erros.length) return responder(res, 503, { erro: MSG.naoConfigurado });
    try {
      await rota(req, res);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof ErroApi) return responder(res, e.estado, { erro: e.message });
      if (e?.type?.startsWith?.('Stripe')) {
        registo.erro(`Stripe (${caminho}): ${e.type} ${e.code ?? ''} ${e.message}`);
        return responder(res, 502, { erro: MSG.stripe });
      }
      registo.erro(`${caminho}: ${e?.stack || e}`);
      return responder(res, 500, { erro: MSG.interno });
    }
  });
  servidor.headersTimeout = 15_000;
  servidor.requestTimeout = 30_000;
  servidor.on('close', () => clearInterval(limpeza));
  return servidor;
}
