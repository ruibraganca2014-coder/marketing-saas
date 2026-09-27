// Token de sessão do /api: JWT HS256 (HMAC-SHA256) curto, feito com node:crypto.

import { createHmac, timingSafeEqual } from 'node:crypto';

const AUD = 'domus-api';
const CABECALHO = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

function assinatura(segredo, dados) {
  return createHmac('sha256', segredo).update(dados).digest();
}

/** Cria um token para o cliente, válido `duracaoS` segundos. */
export function criarToken(segredo, cliente, duracaoS, agora = Date.now()) {
  const iat = Math.floor(agora / 1000);
  const corpo = b64url(JSON.stringify({ sub: cliente, aud: AUD, iat, exp: iat + duracaoS }));
  const dados = `${CABECALHO}.${corpo}`;
  return { token: `${dados}.${assinatura(segredo, dados).toString('base64url')}`, exp: iat + duracaoS };
}

/**
 * Verifica o token. Devolve o código do cliente ou null (assinatura errada,
 * algoritmo diferente de HS256, audiência errada ou expirado).
 */
export function verificarToken(segredo, token, agora = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cab, corpo, sig] = partes;
  if (cab !== CABECALHO) return null; // só aceita exatamente {"alg":"HS256","typ":"JWT"}
  const esperada = assinatura(segredo, `${cab}.${corpo}`);
  let recebida;
  try {
    recebida = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!p || p.aud !== AUD || typeof p.sub !== 'string' || !Number.isInteger(p.exp)) return null;
  if (Math.floor(agora / 1000) >= p.exp) return null;
  return p.sub;
}
