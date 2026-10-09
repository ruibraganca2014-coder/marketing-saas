// Contagem de energia por dia/mês (docs/PROTOCOLO-MQTT-v3.md §6) a partir do
// contador acumulado (Wh) dos aparelhos `medidor`. Tolera reinícios do
// contador (valor que desce) e muda de dia à meia-noite de Lisboa.

import { somarDias } from './tempo.js';

/**
 * @typedef {object} ContaEnergia
 * @property {string} dia       "AAAA-MM-DD" local a que `hojeWh` se refere
 * @property {number} hojeWh
 * @property {number} ontemWh
 * @property {number} mesWh
 * @property {number} [ultimoWh] última leitura do contador
 */

/** @param {string} dia @returns {ContaEnergia} */
export function novaConta(dia) {
  return { dia, hojeWh: 0, ontemWh: 0, mesWh: 0 };
}

/**
 * Passa a conta para o dia `hoje` (se mudou): hoje → ontem; mês novo → 0.
 * @param {ContaEnergia} conta
 * @param {string} hoje
 * @returns {boolean} true se mudou de dia
 */
export function rolarDia(conta, hoje) {
  // Só anda para a frente (minutos recuperados depois de uma pausa podem ser de ontem).
  if (hoje <= conta.dia) return false;
  conta.ontemWh = conta.dia === somarDias(hoje, -1) ? conta.hojeWh : 0;
  conta.hojeWh = 0;
  if (conta.dia.slice(0, 7) !== hoje.slice(0, 7)) conta.mesWh = 0;
  conta.dia = hoje;
  return true;
}

/**
 * Nova leitura do contador. A diferença para a leitura anterior conta para
 * hoje e para o mês. Se o contador desceu (aparelho reiniciado ou contador
 * reposto), a leitura nova passa a ser só a referência e não se soma nada: um
 * aparelho que reinicia nem sempre recomeça do zero (o OpenBeken retoma o último
 * valor que gravou), e somar o contador inteiro inventava centenas de kWh.
 * @param {ContaEnergia} conta
 * @param {number} wh
 * @param {string} hoje
 * @returns {number} Wh somados
 */
export function juntarLeitura(conta, wh, hoje) {
  rolarDia(conta, hoje);
  const anterior = conta.ultimoWh;
  conta.ultimoWh = wh;
  if (typeof anterior !== 'number') return 0;
  let delta = wh - anterior;
  if (delta < 0) delta = 0; // oscilação ou reinício do contador: só referência
  conta.hojeWh += delta;
  conta.mesWh += delta;
  return delta;
}

/** Wh → kWh com 2 casas decimais. */
export const kwh = (wh) => Math.round(wh / 10) / 100;
