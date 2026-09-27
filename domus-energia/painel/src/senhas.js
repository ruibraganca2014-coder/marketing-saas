// Palavras-passe do painel: scrypt (node:crypto) com sal aleatório.
// Formato guardado: "scrypt$N$r$p$<sal base64>$<hash base64>".

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, TAM = 64;
const MAXMEM = 64 * 1024 * 1024;

function derivar(senha, sal, n, r, p, tam) {
  return new Promise((resolve, reject) => {
    scrypt(String(senha).normalize('NFC'), sal, tam, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? reject(e) : resolve(k)));
  });
}

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const k = await derivar(senha, sal, N, R, P, TAM);
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${k.toString('base64')}`;
}

// Hash usado quando o email não existe (o tempo de resposta é o mesmo).
let falso = null;

/** true se a palavra-passe corresponde ao hash (tempo constante na comparação). */
export async function verificarSenha(senha, guardado) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(guardado || ''));
  if (!m) {
    falso ??= await hashSenha('senha-que-nunca-coincide');
    await verificarSenha(senha, falso);
    return false;
  }
  const [, n, r, p, sal, hash] = m;
  const esperado = Buffer.from(hash, 'base64');
  if (Number(n) > 1 << 20 || Number(r) > 32 || Number(p) > 16 || esperado.length < 16 || esperado.length > 128) return false;
  const k = await derivar(senha, Buffer.from(sal, 'base64'), Number(n), Number(r), Number(p), esperado.length);
  return timingSafeEqual(k, esperado);
}

/** Regras das palavras-passe do painel. Devolve a mensagem de erro ou null. */
export function problemaSenha(s) {
  if (typeof s !== 'string') return 'Indique a palavra-passe.';
  if (s.length < 10) return 'A palavra-passe deve ter pelo menos 10 caracteres.';
  if (s.length > 200) return 'A palavra-passe é demasiado longa (máx. 200 caracteres).';
  if (/[\u0000-\u001f\u007f]/.test(s)) return 'A palavra-passe tem caracteres inválidos.';
  return null;
}

/** Palavra-passe aleatória (repor/criar pelo CEO): 16 caracteres sem ambíguos. */
export function gerarSenha(n = 16) {
  const conj = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = randomBytes(n * 2);
  let s = '';
  for (let i = 0; i < b.length && s.length < n; i++) {
    if (b[i] < 256 - (256 % conj.length)) s += conj[b[i] % conj.length];
  }
  return s.length === n ? s : gerarSenha(n);
}
