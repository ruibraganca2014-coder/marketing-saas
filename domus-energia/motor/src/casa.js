// Configuração da casa (docs/PROTOCOLO-MQTT-v3.md §1): `_config` retido e
// `_config/set` (objeto parcial que o motor funde com o atual).

import { HORA_RE } from './tempo.js';

/**
 * @typedef {object} ConfigCasa
 * @property {number} atraso_saida_s
 * @property {number} atraso_entrada_s
 * @property {[string, string]|null} silencio
 * @property {number} limiar_espera_w
 * @property {number} offline_min
 * @property {number} pausa_manual_min
 * @property {{lat: number, lon: number}|null} local
 * @property {string|null} relatorio_diario
 */

/** Valores por omissão (Lisboa como localização). @type {ConfigCasa} */
export const CONFIG_PADRAO = Object.freeze({
  atraso_saida_s: 30,
  atraso_entrada_s: 30,
  silencio: ['23:00', '07:00'],
  limiar_espera_w: 5,
  offline_min: 30,
  pausa_manual_min: 60,
  local: { lat: 38.72, lon: -9.14 },
  relatorio_diario: '08:00',
});

/** Cópia nova da configuração por omissão. @returns {ConfigCasa} */
export function configPadrao() {
  return structuredClone({ ...CONFIG_PADRAO });
}

const eObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function inteiro(v, min, max, campo) {
  if (!Number.isInteger(v) || v < min || v > max) return `"${campo}" tem de ser um número inteiro entre ${min} e ${max}.`;
  return null;
}

/**
 * Valida um campo da configuração. Devolve a mensagem de erro ou null.
 * @param {string} k
 * @param {unknown} v
 */
function validarCampo(k, v) {
  switch (k) {
    case 'atraso_saida_s':
    case 'atraso_entrada_s':
      return inteiro(v, 0, 300, k);
    case 'offline_min':
      return inteiro(v, 1, 1440, k);
    case 'pausa_manual_min':
      return inteiro(v, 0, 480, k);
    case 'limiar_espera_w':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000 ? null : '"limiar_espera_w" tem de ser um número de watts entre 0 e 1000.';
    case 'silencio':
      if (v === null) return null;
      if (!Array.isArray(v) || v.length !== 2 || !v.every((h) => typeof h === 'string' && HORA_RE.test(h))) {
        return '"silencio" tem de ser ["HH:MM", "HH:MM"] (ex.: ["23:00", "07:00"]) ou null.';
      }
      return v[0] === v[1] ? 'As horas de "silencio" não podem ser iguais.' : null;
    case 'relatorio_diario':
      return v === null || (typeof v === 'string' && HORA_RE.test(v)) ? null : '"relatorio_diario" tem de ser "HH:MM" ou null.';
    case 'local': {
      if (v === null) return null;
      if (!eObjeto(v)) return '"local" tem de ser {"lat": …, "lon": …} ou null.';
      for (const x of Object.keys(v)) if (x !== 'lat' && x !== 'lon') return `"local": campo desconhecido "${x}".`;
      const { lat, lon } = /** @type {any} */ (v);
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return '"local.lat" tem de ser um número entre -90 e 90.';
      if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return '"local.lon" tem de ser um número entre -180 e 180.';
      return null;
    }
    default:
      return `campo desconhecido "${k}".`;
  }
}

/**
 * Funde um pedido parcial com a configuração atual.
 * @param {unknown} parcial
 * @param {ConfigCasa} atual
 * @returns {{ok: true, config: ConfigCasa} | {ok: false, erro: string}}
 */
export function fundirConfig(parcial, atual) {
  if (!eObjeto(parcial)) return { ok: false, erro: 'A configuração tem de ser um objeto JSON ({...}).' };
  const nova = structuredClone(atual);
  for (const [k, v] of Object.entries(/** @type {object} */ (parcial))) {
    const erro = validarCampo(k, v);
    if (erro) return { ok: false, erro: `Configuração: ${erro}` };
    nova[k] = v === null ? null : structuredClone(v);
  }
  return { ok: true, config: nova };
}

/**
 * Adota uma configuração guardada/retida: campos inválidos ou em falta ficam
 * com o valor por omissão (nunca falha).
 * @param {unknown} v
 * @returns {ConfigCasa}
 */
export function normalizarConfig(v) {
  const r = configPadrao();
  if (!eObjeto(v)) return r;
  for (const [k, x] of Object.entries(/** @type {object} */ (v))) {
    if (k in r && validarCampo(k, x) === null) r[k] = x === null ? null : structuredClone(x);
  }
  return r;
}
