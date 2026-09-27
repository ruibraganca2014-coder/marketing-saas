import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horasSol, instanteSol } from '../src/sol.js';
import { horaLocal, paraMinutos, somarDias, partesLocais } from '../src/tempo.js';

const LISBOA = { lat: 38.72, lon: -9.14 };

// Valores de referência independentes: biblioteca Python "astral" 3.2
// (sun(observer, date, tzinfo=Europe/Lisbon)) para 38,72 N 9,14 W.
const REFERENCIA = [
  ['2026-06-21', '06:12', '21:04'], // solstício de verão (WEST)
  ['2026-12-21', '07:51', '17:18'], // solstício de inverno (WET)
  ['2026-03-28', '06:28', '18:56'], // véspera da mudança (WET)
  ['2026-03-29', '07:26', '19:57'], // dia da mudança para a hora de verão
  ['2026-10-24', '07:55', '18:46'], // véspera da mudança (WEST)
  ['2026-10-25', '06:56', '17:45'], // dia da mudança para a hora de inverno
  ['2026-01-15', '07:53', '17:39'],
  ['2026-09-27', '07:29', '19:26'],
];

const diferencaMin = (a, b) => Math.abs(paraMinutos(a) - paraMinutos(b));

for (const [data, nascer, por] of REFERENCIA) {
  test(`sol em Lisboa a ${data}: nascer ≈ ${nascer}, pôr ≈ ${por} (±3 min)`, () => {
    const h = horasSol(data, LISBOA);
    assert.equal(partesLocais(h.nascer).data, data);
    assert.ok(diferencaMin(horaLocal(h.nascer), nascer) <= 3, `nascer ${horaLocal(h.nascer)} ≠ ${nascer}`);
    assert.ok(diferencaMin(horaLocal(h.por), por) <= 3, `pôr ${horaLocal(h.por)} ≠ ${por}`);
  });
}

test('sol: a mudança de hora desloca ~1 h a hora local, não o instante UTC', () => {
  const a = instanteSol('2026-03-28', LISBOA.lat, LISBOA.lon, 'nascer');
  const b = instanteSol('2026-03-29', LISBOA.lat, LISBOA.lon, 'nascer');
  const diaUtc = (b - a) / 60_000 - 1440; // em UTC o nascer adianta ~1,5 min/dia
  assert.ok(diaUtc < 0 && diaUtc > -3, `${diaUtc}`);
  const salto = paraMinutos(horaLocal(b)) - paraMinutos(horaLocal(a));
  assert.ok(salto >= 57 && salto <= 59, `${salto}`);
});

test('sol: noite/dia polar devolve null (sem nascer nem pôr)', () => {
  assert.equal(instanteSol('2026-06-21', 80, 0, 'nascer'), null);
  assert.equal(instanteSol('2026-12-21', 80, 0, 'por'), null);
});

test('somarDias atravessa meses, anos e a mudança de hora', () => {
  assert.equal(somarDias('2026-03-31', 1), '2026-04-01');
  assert.equal(somarDias('2026-01-01', -1), '2025-12-31');
  assert.equal(somarDias('2026-10-25', 1), '2026-10-26');
});
