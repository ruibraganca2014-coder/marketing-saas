// Nascer e pôr do sol (algoritmo da NOAA — "Solar Calculator" de Meeus
// simplificado), com a refração atmosférica padrão (zénite 90,833°).
// Precisão típica: ±1 min para latitudes de Portugal.

const RAD = Math.PI / 180;
const ZENITE = 90.833;

/** Declinação e equação do tempo para um dia juliano. */
function posicao(jd) {
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTempo =
    (4 / RAD) *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  return { decl, eqTempo };
}

/** Ângulo horário (graus) do nascer; null se o sol não nasce/põe nesse dia. */
function anguloHorario(lat, decl) {
  const x = Math.cos(ZENITE * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (x < -1 || x > 1) return null;
  return Math.acos(x) / RAD;
}

/**
 * Instante (ms UTC) do nascer ou pôr do sol na data civil indicada.
 * @param {string} data "AAAA-MM-DD" (data local; em Portugal coincide com a data UTC do evento)
 * @param {number} lat
 * @param {number} lon  este positivo (Lisboa ≈ -9,14)
 * @param {'nascer'|'por'} evento
 * @returns {number|null}
 */
export function instanteSol(data, lat, lon, evento) {
  const [a, m, d] = data.split('-').map(Number);
  const meiaNoiteUtc = Date.UTC(a, m - 1, d);
  const jd0 = meiaNoiteUtc / 86_400_000 + 2440587.5;
  let minutos = 720 - 4 * lon; // primeira aproximação: meio-dia solar
  // Duas iterações: recalcula a posição do sol à hora estimada do evento.
  for (let i = 0; i < 3; i++) {
    const { decl, eqTempo } = posicao(jd0 + minutos / 1440);
    const ha = anguloHorario(lat, decl);
    if (ha === null) return null;
    minutos = 720 - 4 * (lon + (evento === 'nascer' ? ha : -ha)) - eqTempo;
  }
  return Math.round(meiaNoiteUtc + minutos * 60_000);
}

/**
 * Nascer e pôr do sol de uma data.
 * @param {string} data
 * @param {{lat: number, lon: number}} local
 */
export function horasSol(data, local) {
  return {
    nascer: instanteSol(data, local.lat, local.lon, 'nascer'),
    por: instanteSol(data, local.lat, local.lon, 'por'),
  };
}
