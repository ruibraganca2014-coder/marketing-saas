// Pequenos utilitários de leitura de payloads MQTT.

/** Converte o payload (Buffer/string) em texto. */
export const texto = (p) => (typeof p === 'string' ? p : Buffer.from(p ?? '').toString('utf8')).trim();

/** JSON.parse que nunca lança. */
export function lerJson(p) {
  try {
    return JSON.parse(texto(p));
  } catch {
    return undefined;
  }
}

/** Número finito a partir de texto ("123.4") ou undefined. */
export function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** É um objeto JSON (não lista, não null)? */
export const eObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
