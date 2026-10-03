// Utilitários sem dependências: datas (Lisboa), escrita atómica e registos.

import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Data ISO 8601 em UTC sem milissegundos: "2026-10-01T10:00:00Z". */
export function iso(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const FMT_DIA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Data civil em Lisboa ("2026-10-01"). */
export function diaLisboa(data = new Date()) {
  return FMT_DIA.format(data instanceof Date ? data : new Date(data));
}

/** Soma dias a uma data civil "AAAA-MM-DD" (sem fusos). */
export function somarDiasCivil(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Semana civil (segunda a domingo) em Lisboa que contém `data`: {inicio, fim} "AAAA-MM-DD". */
export function semanaLisboa(data = new Date()) {
  const hoje = diaLisboa(data);
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicio = somarDiasCivil(hoje, -((dow + 6) % 7));
  return { inicio, fim: somarDiasCivil(inicio, 6) };
}

/**
 * Instante (ms desde 1970) da meia-noite de Lisboa do dia civil "AAAA-MM-DD". Lisboa está em UTC+0 (inverno) ou
 * UTC+1 (verão) e a hora muda à 01:00 UTC: a meia-noite nunca é ambígua.
 */
export function meiaNoiteLisboa(dia) {
  const utc = Date.parse(`${dia}T00:00:00Z`);
  return diaLisboa(new Date(utc - 3600_000)) === dia ? utc - 3600_000 : utc;
}

/** Euros (número) → cêntimos inteiros. */
export const paraCent = (v) => Math.round(v * 100);
/** Cêntimos → euros (número com 2 casas). */
export const deCent = (c) => (c === null || c === undefined ? null : Math.round(c) / 100);

/**
 * Escreve um ficheiro de forma atómica: temporário (começa por ".") na mesma
 * pasta, fsync e rename. Quem lê vê sempre o conteúdo antigo ou o novo.
 */
export async function escreverAtomico(caminho, conteudo, modo = 0o600) {
  const pasta = dirname(caminho);
  await mkdir(pasta, { recursive: true });
  const tmp = join(pasta, `.${basename(caminho)}.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx', modo);
  try {
    await fh.writeFile(conteudo);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, caminho);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Registo em texto simples (stdout). Nunca receber palavras-passe aqui. */
export function criarRegisto(saida = console) {
  const linha = (nivel, msg) => `${iso()} [${nivel}] ${msg}`;
  return {
    info: (m) => saida.log(linha('info', m)),
    aviso: (m) => saida.warn(linha('aviso', m)),
    erro: (m) => saida.error(linha('erro', m)),
  };
}

/** Registo mudo (testes). */
export const registoMudo = { info() {}, aviso() {}, erro() {} };
