// Horas locais de Portugal continental (Europe/Lisbon), com mudança de hora
// correta (WET/WEST) calculada pelo Intl — nunca somamos desvios à mão.

export const FUSO = 'Europe/Lisbon';

const DIAS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatadores = new Map();

function formatador(fuso) {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/**
 * @typedef {object} PartesLocais
 * @property {string} data        "AAAA-MM-DD" local
 * @property {string} hora        "HH:MM" local
 * @property {number} minutos     minutos desde a meia-noite local (0–1439)
 * @property {number} diaSemana   1 = segunda … 7 = domingo
 */

/**
 * Converte um instante (ms desde 1970) na data/hora local do fuso indicado.
 * @param {number} ms
 * @param {string} [fuso]
 * @returns {PartesLocais}
 */
export function partesLocais(ms, fuso = FUSO) {
  /** @type {Record<string,string>} */
  const p = {};
  for (const parte of formatador(fuso).formatToParts(new Date(ms))) p[parte.type] = parte.value;
  const h = Number(p.hour) % 24;
  const m = Number(p.minute);
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora: `${String(h).padStart(2, '0')}:${p.minute}`,
    minutos: h * 60 + m,
    diaSemana: DIAS[p.weekday] ?? 0,
  };
}

export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * "HH:MM" → minutos desde a meia-noite.
 * @param {string} hhmm
 */
export function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Verdadeiro se `minutos` está no intervalo [inicio, fim). O intervalo pode
 * passar a meia-noite (ex.: 19:00–07:00).
 * @param {number} minutos
 * @param {string} inicio "HH:MM"
 * @param {string} fim "HH:MM"
 */
export function dentroDoIntervalo(minutos, inicio, fim) {
  const a = paraMinutos(inicio);
  const b = paraMinutos(fim);
  if (a === b) return true;
  if (a < b) return minutos >= a && minutos < b;
  return minutos >= a || minutos < b;
}

/**
 * "HH:MM" local (Lisboa) de um instante.
 * @param {number} ms
 */
export function horaLocal(ms, fuso = FUSO) {
  return partesLocais(ms, fuso).hora;
}

/**
 * Soma dias a uma data "AAAA-MM-DD" (calendário, sem fuso).
 * @param {string} data
 * @param {number} dias
 */
export function somarDias(data, dias) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const NOMES_DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** Nome curto do dia da semana (1 = segunda … 7 = domingo). */
export function nomeDia(n) {
  return NOMES_DIAS[n] ?? String(n);
}
