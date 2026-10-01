// Ajudas HTTP: respostas JSON, leitura do corpo com limite, cookies, IP real
// e verificação de origem (CSRF). Nunca regista corpos de pedidos.

export class ErroApi extends Error {
  constructor(estado, mensagem, cabecalhos = {}) {
    super(mensagem);
    this.estado = estado;
    this.cabecalhos = cabecalhos;
  }
}

export const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function responder(res, estado, corpo, extra = {}) {
  const texto = corpo === null || corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(estado, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(texto),
    ...extra,
  });
  res.end(texto);
}

/** Lê o corpo como Buffer, até `limite` bytes (413 se passar). */
export function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const decl = Number(req.headers['content-length']);
    if (Number.isFinite(decl) && decl > limite) {
      req.resume();
      return reject(new ErroApi(413, 'Pedido demasiado grande.'));
    }
    const partes = [];
    let total = 0;
    let parado = false;
    req.on('data', (p) => {
      if (parado) return;
      total += p.length;
      if (total > limite) {
        parado = true;
        reject(new ErroApi(413, 'Pedido demasiado grande.'));
        req.resume();
        return;
      }
      partes.push(p);
    });
    req.on('end', () => { if (!parado) resolve(Buffer.concat(partes)); });
    req.on('error', reject);
  });
}

export function tipoJson(req) {
  const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return tipo === 'application/json';
}

/** Corpo JSON (objeto) só com os campos permitidos. */
export async function lerJson(req, permitidos, limite = 16 * 1024) {
  if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
  const bruto = await lerCorpo(req, limite);
  let v;
  try {
    v = bruto.length ? JSON.parse(bruto.toString('utf8')) : {};
  } catch {
    throw new ErroApi(400, 'JSON inválido.');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroApi(400, 'O corpo tem de ser um objeto JSON.');
  for (const k of Object.keys(v)) {
    if (!permitidos.includes(k)) throw new ErroApi(400, `Campo desconhecido: "${k}".`);
  }
  return v;
}

export function lerCookies(req) {
  const out = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 1) continue;
    const k = parte.slice(0, i).trim();
    if (!(k in out)) out[k] = parte.slice(i + 1).trim();
  }
  return out;
}

export function ipDe(req, confiarProxy) {
  if (confiarProxy) {
    // O Caddy acrescenta o IP real do visitante no fim do X-Forwarded-For.
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || '?';
}

/**
 * Proteção CSRF para pedidos que alteram dados: o navegador envia sempre
 * Origin nos POST (fetch) e Sec-Fetch-Site nos navegadores atuais.
 * - Sec-Fetch-Site presente e diferente de "same-origin" → recusado;
 * - Origin presente e fora da lista → recusado;
 * - nenhum dos dois → recusado (não vem de um navegador do próprio site).
 */
export function verificarOrigem(req, origens) {
  const sfs = req.headers['sec-fetch-site'];
  const origem = req.headers.origin;
  if (sfs !== undefined && sfs !== 'same-origin') return false;
  if (origem !== undefined) return origens.includes(origem);
  return sfs === 'same-origin' && origens.length > 0;
}

/**
 * CSRF das rotas públicas (/api/orcamento*, /api/conta/*): como verificarOrigem, e também um pedido do site
 * público servido noutra origem do MESMO site registável (ex.: https://domusenergia.pt → https://api.domusenergia.pt):
 * `Sec-Fetch-Site: same-site` com `Origin` numa das `siteOrigens` (SITE_ORIGENS). "cross-site" é sempre recusado.
 */
export function verificarOrigemPublica(req, origens, siteOrigens = []) {
  if (verificarOrigem(req, [...origens, ...siteOrigens])) return true;
  const sfs = req.headers['sec-fetch-site'];
  const origem = req.headers.origin;
  return sfs === 'same-site' && origem !== undefined && siteOrigens.includes(origem);
}

const CORS_CABECALHOS = 'Content-Type, X-Fotos-Token, X-Foto-Chave, X-Foto-Legenda, X-Simulacao-Id';

/**
 * CORS com credenciais para o site público noutra origem (SITE_ORIGENS). Só acrescenta cabeçalhos quando a
 * `Origin` do pedido está na lista (nunca "*"). Devolve true se tratou um preflight (OPTIONS) — já respondido.
 */
export function cors(req, res, siteOrigens) {
  const origem = req.headers.origin;
  const permitida = origem !== undefined && siteOrigens.includes(origem);
  res.setHeader('Vary', 'Origin');
  if (permitida) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  }
  if (req.method !== 'OPTIONS') return false;
  if (!permitida) {
    responder(res, 403, { erro: 'Origem não permitida.' });
    return true;
  }
  res.writeHead(204, {
    ...CABECALHOS_SEGURANCA,
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': CORS_CABECALHOS,
    'Access-Control-Max-Age': '600',
    'Content-Length': 0,
  });
  res.end();
  return true;
}
