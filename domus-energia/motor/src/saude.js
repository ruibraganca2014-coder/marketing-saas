// Estimativas de saúde dos aparelhos (docs/PROTOCOLO-MQTT-v3.md §5):
// duração da bateria (regressão linear dos últimos 14 dias) e reinícios.

export const JANELA_BATERIA_MS = 14 * 86_400_000;
/** Uma amostra de bateria por aparelho a cada 6 h (guardadas de forma compacta). */
export const INTERVALO_AMOSTRA_MS = 6 * 3_600_000;
/** Subida que indica pilhas novas (recomeça a estimativa). */
export const SUBIDA_PILHAS_NOVAS = 20;

/**
 * Junta uma leitura de bateria às amostras `[ms, pct]` (modifica e devolve a lista).
 * Guarda no máximo uma amostra por 6 h e só os últimos 14 dias; pilhas
 * novas (subida ≥ 20 pontos) recomeçam a lista.
 * @param {[number, number][]} amostras
 * @param {number} agora
 * @param {number} pct
 */
export function juntarAmostra(amostras, agora, pct) {
  const ultima = amostras.at(-1);
  if (ultima && pct - ultima[1] >= SUBIDA_PILHAS_NOVAS) amostras.length = 0;
  const ult = amostras.at(-1);
  if (!ult || agora - ult[0] >= INTERVALO_AMOSTRA_MS) amostras.push([agora, pct]);
  while (amostras.length && agora - amostras[0][0] > JANELA_BATERIA_MS) amostras.shift();
  return amostras;
}

/**
 * Dias que faltam até a bateria chegar a 0 %, por regressão linear das
 * amostras. null sem dados suficientes (menos de 3 amostras, menos de 2 dias
 * de histórico) ou se a bateria não está a descer.
 * @param {[number, number][]} amostras
 * @param {number} pctAtual
 * @returns {number|null}
 */
export function estimarDiasBateria(amostras, pctAtual) {
  if (!amostras || amostras.length < 3) return null;
  const t0 = amostras[0][0];
  if (amostras.at(-1)[0] - t0 < 2 * 86_400_000) return null;
  const n = amostras.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [t, p] of amostras) {
    const x = (t - t0) / 86_400_000;
    sx += x;
    sy += p;
    sxx += x * x;
    sxy += x * p;
  }
  const den = n * sxx - sx * sx;
  if (den <= 0) return null;
  const declive = (n * sxy - sx * sy) / den; // pontos percentuais por dia
  if (declive >= -0.01) return null;
  return Math.max(0, Math.round(pctAtual / -declive));
}

/**
 * Regista um valor de uptime; devolve true se houve reinício (o uptime desceu).
 * @param {number|undefined} anterior
 * @param {number} novo
 */
export function houveReinicio(anterior, novo) {
  return typeof anterior === 'number' && novo < anterior;
}
