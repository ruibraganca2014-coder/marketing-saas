import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novaConta, rolarDia, juntarLeitura, kwh } from '../src/energia.js';
import { motorV3, ultimoJson } from './ajuda.js';

const P = 'domus/joao';

test('contagem: diferenças, reinício do contador e pequenas oscilações', () => {
  const c = novaConta('2026-06-15');
  assert.equal(juntarLeitura(c, 1000, '2026-06-15'), 0); // primeira leitura: só referência
  assert.equal(juntarLeitura(c, 1500, '2026-06-15'), 500);
  assert.equal(juntarLeitura(c, 1499.5, '2026-06-15'), 0); // oscilação
  assert.equal(juntarLeitura(c, 30, '2026-06-15'), 0); // contador reiniciou: só referência
  assert.equal(juntarLeitura(c, 130, '2026-06-15'), 100);
  assert.equal(juntarLeitura(c, 100_000, '2026-06-15'), 99_870);
  assert.equal(juntarLeitura(c, 90_000, '2026-06-15'), 0); // reiniciou e retomou um valor gravado: não soma o contador inteiro
  assert.equal(juntarLeitura(c, 90_050, '2026-06-15'), 50);
  assert.equal(c.hojeWh, 100_520);
  assert.equal(kwh(c.hojeWh), 100.52);
});

test('mudança de dia e de mês', () => {
  const c = { dia: '2026-06-30', hojeWh: 5000, ontemWh: 1, mesWh: 90_000, ultimoWh: 1 };
  assert.equal(rolarDia(c, '2026-06-30'), false);
  assert.equal(rolarDia(c, '2026-06-29'), false); // nunca volta atrás
  assert.equal(rolarDia(c, '2026-07-01'), true);
  assert.deepEqual([c.hojeWh, c.ontemWh, c.mesWh], [0, 5000, 0]);
  c.hojeWh = 700;
  rolarDia(c, '2026-07-05'); // dias sem dados: "ontem" é 0
  assert.deepEqual([c.hojeWh, c.ontemWh], [0, 0]);
});

test('_energia: meia-noite de Lisboa no dia da mudança de hora (25/10/2026), total dos medidores "geral"', () => {
  const m = motorV3({ agora: '2026-10-24T21:00:00Z' }); // 22:00 WEST
  m.msg(`${P}/quadro/energycounter/get`, '10000');
  m.msg(`${P}/quadro/energycounter/get`, '12000'); // +2 kWh no dia 24
  m.msg(`${P}/termo/status/switch:0`, { output: true, apower: 1500, aenergy: { total: 500 } });
  m.msg(`${P}/termo/status/switch:0`, { output: true, apower: 1500, aenergy: { total: 1500 } });
  m.em('2026-10-24T22:55:00Z'); // 23:55 WEST
  let e = ultimoJson(m, `${P}/_energia`);
  assert.equal(m.ultimo(`${P}/_energia`).retain, true);
  assert.deepEqual(e, { hoje_kwh: 2, ontem_kwh: 0, mes_kwh: 2, aparelhos: { quadro: { hoje_kwh: 2, ontem_kwh: 0 }, termo: { hoje_kwh: 1, ontem_kwh: 0 } } });
  // Meia-noite local = 23:00 UTC (ainda WEST): muda de dia e publica logo.
  m.em('2026-10-24T22:59:00Z');
  const n = m.publicados.filter((p) => p.topico === `${P}/_energia`).length;
  m.em('2026-10-24T23:00:00Z');
  assert.equal(m.publicados.filter((p) => p.topico === `${P}/_energia`).length, n + 1);
  e = ultimoJson(m, `${P}/_energia`);
  assert.deepEqual([e.hoje_kwh, e.ontem_kwh, e.mes_kwh], [0, 2, 2]);
  // O aparelho reinicia (contador volta a 0) e continua a contar: a primeira leitura é só referência.
  m.msg(`${P}/quadro/energycounter/get`, '0');
  m.msg(`${P}/quadro/energycounter/get`, '800');
  m.em('2026-10-25T12:00:00Z');
  e = ultimoJson(m, `${P}/_energia`);
  assert.deepEqual([e.hoje_kwh, e.ontem_kwh, e.mes_kwh], [0.8, 2, 2.8]);
  assert.deepEqual(e.aparelhos.termo, { hoje_kwh: 0, ontem_kwh: 1 });
  // A meia-noite seguinte já é às 00:00 UTC (WET).
  m.em('2026-10-25T23:30:00Z');
  assert.equal(ultimoJson(m, `${P}/_energia`).hoje_kwh, 0.8);
  m.em('2026-10-26T00:00:00Z');
  assert.deepEqual(ultimoJson(m, `${P}/_energia`).ontem_kwh, 0.8);
});

test('_energia: mudança de mês e persistência entre reinícios', async () => {
  const { criarMotor, APARELHOS_V3 } = await import('./ajuda.js');
  const m = motorV3({ agora: '2026-10-31T12:00:00Z' });
  m.msg(`${P}/quadro/energycounter/get`, '0');
  m.msg(`${P}/quadro/energycounter/get`, '4000');
  m.em('2026-10-31T12:05:00Z');
  // Reinício: o contador continua a partir da última leitura guardada.
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: '2026-10-31T13:00:00Z' });
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.retida(`${P}/quadro/energycounter/get`, '5000');
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(ultimoJson(m2, `${P}/_energia`).mes_kwh, 5);
  m2.em('2026-11-01T00:00:00Z');
  const e = ultimoJson(m2, `${P}/_energia`);
  assert.deepEqual([e.hoje_kwh, e.ontem_kwh, e.mes_kwh], [0, 5, 0]);
});
