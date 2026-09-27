// Utilitários sem dependências: datas ISO, escrita atómica, exclusão mútua e registos.

import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Data ISO 8601 em UTC sem milissegundos: "2026-10-01T10:00:00Z". */
export function iso(data) {
  const d = data instanceof Date ? data : new Date(data);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Segundos Unix (Stripe) → ISO, ou null. */
export function isoDeUnix(s) {
  return Number.isFinite(s) && s > 0 ? iso(new Date(s * 1000)) : null;
}

/** Soma dias a uma data (em UTC, exato em milissegundos). */
export function somarDias(data, dias) {
  return new Date(data.getTime() + dias * 86_400_000);
}

/** Data civil em Lisboa ("2026-10-01"). */
export function dataLisboa(data) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(data);
}

/**
 * Escreve um ficheiro de forma atómica: ficheiro temporário na mesma pasta,
 * fsync e rename. Quem lê vê sempre o conteúdo antigo ou o novo, nunca meio.
 */
export async function escreverAtomico(caminho, conteudo, modo = 0o644) {
  const pasta = dirname(caminho);
  await mkdir(pasta, { recursive: true });
  const tmp = join(pasta, `.${basename(caminho)}.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'w', modo);
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

/** Exclusão mútua simples: as tarefas correm uma de cada vez, por ordem. */
export class Fila {
  #cauda = Promise.resolve();
  correr(tarefa) {
    const r = this.#cauda.then(tarefa, tarefa);
    this.#cauda = r.catch(() => {});
    return r;
  }
}

/** Registo em texto simples (stdout). Nunca receber palavras-passe aqui. */
export function criarRegisto(saida = console) {
  const linha = (nivel, msg) => `${iso(new Date())} [${nivel}] ${msg}`;
  return {
    info: (m) => saida.log(linha('info', m)),
    aviso: (m) => saida.warn(linha('aviso', m)),
    erro: (m) => saida.error(linha('erro', m)),
  };
}

/** Registo mudo (testes). */
export const registoMudo = { info() {}, aviso() {}, erro() {} };
