// Horário normal e "fora de horas" das avarias (decisão do dono, 2026-10-13; docs/PAGAMENTOS-PEDIDO.md "Avarias fora
// de horas"). Horário normal: dias úteis (segunda a sexta), das 08:00 às 20:00, hora de Lisboa. Fora de horas: a noite
// (das 20:00 às 08:00), o sábado, o domingo e os feriados nacionais. Módulo puro, sem dependências nem relógio: serve o
// servidor (painel/src) e o navegador. As datas são as das visitas: "AAAA-MM-DDTHH:MM", hora de Lisboa sem fuso.

export const HORA_ABRE = 8;    // 08:00 já é horário normal
export const HORA_FECHA = 20;  // 20:00 já é fora de horas

/** Domingo de Páscoa de um ano (calendário gregoriano; algoritmo de Meeus/Jones/Butcher): {mes, dia}. */
export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { mes: Math.floor(n / 31), dia: (n % 31) + 1 };
}

const dois = (n) => String(n).padStart(2, '0');
const FIXOS = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'];

/**
 * Os feriados nacionais portugueses de um ano, como "MM-DD": os dez fixos e os três móveis, contados a partir da Páscoa
 * (Sexta-feira Santa = 2 dias antes; Corpo de Deus = 60 dias depois). Os feriados municipais e o Carnaval não contam.
 */
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  const movel = (dias) => { const x = new Date(Date.UTC(ano, p.mes - 1, p.dia + dias)); return `${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`; };
  return [...FIXOS, movel(-2), movel(0), movel(60)];
}

/**
 * A data e hora (de Lisboa, "AAAA-MM-DDTHH:MM") fica fora do horário normal? true = noite (antes das 08:00 ou das 20:00
 * em diante), sábado, domingo ou feriado nacional; false = dia útil entre as 08:00 e as 19:59; null se não for uma data
 * com hora (quem chama decide o que fazer: nunca se adivinha).
 */
export function foraDeHoras(dataHoraLisboa) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(typeof dataHoraLisboa === 'string' ? dataHoraLisboa : '');
  if (!m) return null;
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || hora > 23 || minuto > 59) return null;
  if (hora < HORA_ABRE || hora >= HORA_FECHA) return true;
  const semana = d.getUTCDay();   // 0 = domingo, 6 = sábado
  if (semana === 0 || semana === 6) return true;
  return feriadosNacionais(ano).includes(`${dois(mes)}-${dois(dia)}`);
}
