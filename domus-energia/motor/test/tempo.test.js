import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partesLocais, dentroDoIntervalo, paraMinutos } from '../src/tempo.js';

test('hora local de Lisboa no inverno (UTC+0) e no verão (UTC+1)', () => {
  assert.deepEqual(partesLocais(Date.parse('2026-01-15T08:00:00Z')), { data: '2026-01-15', hora: '08:00', minutos: 480, diaSemana: 4 });
  assert.equal(partesLocais(Date.parse('2026-07-15T08:00:00Z')).hora, '09:00');
  // Domingo = 7; meia-noite local ainda é sábado em UTC no verão.
  const p = partesLocais(Date.parse('2026-07-18T23:30:00Z'));
  assert.equal(p.data, '2026-07-19');
  assert.equal(p.hora, '00:30');
  assert.equal(p.diaSemana, 7);
});

test('mudança de hora: 29/03/2026 salta das 01:00 para as 02:00', () => {
  assert.equal(partesLocais(Date.parse('2026-03-29T00:59:00Z')).hora, '00:59');
  assert.equal(partesLocais(Date.parse('2026-03-29T01:00:00Z')).hora, '02:00');
});

test('intervalo "entre" com e sem passagem da meia-noite', () => {
  const m = paraMinutos;
  assert.equal(dentroDoIntervalo(m('20:00'), '19:00', '07:00'), true);
  assert.equal(dentroDoIntervalo(m('00:00'), '19:00', '07:00'), true);
  assert.equal(dentroDoIntervalo(m('06:59'), '19:00', '07:00'), true);
  assert.equal(dentroDoIntervalo(m('07:00'), '19:00', '07:00'), false);
  assert.equal(dentroDoIntervalo(m('12:00'), '19:00', '07:00'), false);
  assert.equal(dentroDoIntervalo(m('19:00'), '19:00', '07:00'), true);
  assert.equal(dentroDoIntervalo(m('09:00'), '08:00', '18:00'), true);
  assert.equal(dentroDoIntervalo(m('18:00'), '08:00', '18:00'), false);
  assert.equal(dentroDoIntervalo(m('07:59'), '08:00', '18:00'), false);
});
