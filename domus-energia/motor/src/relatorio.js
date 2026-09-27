// Texto do relatório diário da casa (docs/PROTOCOLO-MQTT-v3.md §9), em
// português de Portugal, curto e sem formatação (vai por notificação).

export const NOMES_MODOS = { casa: 'Casa', fora: 'Fora', noite: 'Noite', ferias: 'Férias' };
export const NOMES_ESTADOS = {
  desarmado: 'desarmado',
  a_armar: 'a armar',
  armado: 'armado',
  entrada: 'à espera de desarme',
  disparado: 'DISPARADO',
};

/** Número com vírgula decimal (1 casa). */
export const decimal = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

/**
 * @typedef {object} DadosRelatorio
 * @property {string} modo
 * @property {string} estadoAlarme
 * @property {string[]} ligados
 * @property {string[]} espera
 * @property {string[]} abertas
 * @property {string[]} offline
 * @property {string[]} bateriaFraca
 * @property {string[]} sinalFraco
 * @property {number|null} hojeKwh
 * @property {number|null} ontemKwh
 */

/** @param {DadosRelatorio} d */
export function textoRelatorio(d) {
  const linhas = [];
  const alarme = NOMES_ESTADOS[d.estadoAlarme] ?? d.estadoAlarme;
  linhas.push(`Modo ${NOMES_MODOS[d.modo] ?? d.modo}, alarme ${alarme}.`);
  const lista = (titulo, itens, vazio) => {
    if (itens.length) linhas.push(`${titulo} (${itens.length}): ${itens.join(', ')}.`);
    else if (vazio) linhas.push(vazio);
  };
  lista('Ligados', d.ligados, 'Tudo desligado.');
  lista('Em espera', d.espera);
  lista('Abertas', d.abertas, 'Portas e janelas fechadas.');
  lista('Offline', d.offline);
  lista('Bateria fraca', d.bateriaFraca);
  lista('Sinal fraco', d.sinalFraco);
  if (d.hojeKwh !== null || d.ontemKwh !== null) {
    linhas.push(`Consumo: hoje ${decimal(d.hojeKwh ?? 0)} kWh, ontem ${decimal(d.ontemKwh ?? 0)} kWh.`);
  }
  return linhas.join('\n');
}
