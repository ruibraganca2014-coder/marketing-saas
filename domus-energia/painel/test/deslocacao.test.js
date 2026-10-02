// Localidade e deslocação por distância do simulador (web/simulador/deslocacao.js, docs/SIMULADOR-ORCAMENTO.md §5.1):
// tabela dos 308 concelhos, sugestões sem acentos, distância (haversine × 1,3), área servida e ilhas.
// A cópia do painel (painel/public/vendor/concelhos.js) tem de ser igual à do site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  procurarConcelho, sugerirConcelhos, calcularDeslocacao, distanciaEstrada, haversineKm, NOMES_CONCELHOS, FATOR_ESTRADA,
} from '../../web/simulador/deslocacao.js';
import { CONCELHOS } from '../../web/simulador/concelhos.js';

const c = (n) => procurarConcelho(n);
const perto = (p, lat, lon) => Math.abs(p.lat - lat) < 0.05 && Math.abs(p.lon - lon) < 0.05;

test('308 concelhos, nomes únicos com acentos, coordenadas conhecidas, cópia do painel igual', async () => {
  assert.equal(CONCELHOS.length, 308);
  assert.equal(new Set(NOMES_CONCELHOS).size, 308);
  assert.equal(CONCELHOS.filter((x) => x[2] === null).length, 278, 'continente');
  assert.equal(CONCELHOS.filter((x) => /Madeira/.test(x[1])).length, 11);
  assert.equal(CONCELHOS.filter((x) => /Açores/.test(x[1])).length, 19);
  for (const n of ['Évora', 'Santarém', 'Vila Nova de Foz Côa', 'Alfândega da Fé', 'Óbidos']) assert.ok(NOMES_CONCELHOS.includes(n), n);
  assert.ok(perto(c('Lisboa'), 38.72, -9.14));
  assert.ok(perto(c('Porto'), 41.15, -8.61));
  assert.ok(perto(c('Faro'), 37.02, -7.93));
  assert.ok(perto(c('Funchal'), 32.65, -16.91));
  assert.ok(perto(c('Ponta Delgada'), 37.74, -25.67));
  for (const [nome, , , lat, lon] of CONCELHOS) assert.ok(lat > 32 && lat < 42.2 && lon > -31.3 && lon < -6.1, nome);
  const site = await readFile(new URL('../../web/simulador/concelhos.js', import.meta.url), 'utf8');
  const painel = await readFile(new URL('../public/vendor/concelhos.js', import.meta.url), 'utf8');
  assert.equal(painel.replace(/\r\n/g, '\n'), site.replace(/\r\n/g, '\n'), 'painel/public/vendor/concelhos.js é cópia de web/simulador/concelhos.js');
});

test('procurar e sugerir: sem acentos, texto livre, nomes ambíguos', () => {
  assert.equal(c('evora').nome, 'Évora');
  assert.equal(c('  SANTAREM ').nome, 'Santarém');
  assert.equal(c('Sintra, Lisboa').nome, 'Sintra');
  assert.equal(c('Cacém'), null, 'freguesia');
  assert.equal(c('Lagoa'), null, 'Lagoa (Algarve) e Lagoa (Açores)');
  assert.equal(c('lagoa (algarve)').nome, 'Lagoa (Algarve)');
  assert.equal(c(''), null);
  assert.deepEqual(sugerirConcelhos('evora'), [{ nome: 'Évora', distrito: 'Évora' }]);
  assert.equal(sugerirConcelhos('vila').length, 8);
  assert.ok(sugerirConcelhos('foz').some((s) => s.nome === 'Vila Nova de Foz Côa'), 'palavra a meio');
  assert.deepEqual(sugerirConcelhos(''), []);
});

test('distância: haversine × 1,3; Lisboa→Sintra, Lisboa→Porto, ilhas', () => {
  assert.equal(FATOR_ESTRADA, 1.3);
  const lx = c('Lisboa');
  const sintra = distanciaEstrada(lx, c('Sintra'));
  assert.ok(sintra >= 25 && sintra <= 35, `Lisboa→Sintra ${sintra} km`);
  // Linha reta ~273 km × 1,3 = ~355 km (a A1 real tem ~313 km: o fator é médio e sobrestima as autoestradas).
  const porto = distanciaEstrada(lx, c('Porto'));
  assert.ok(porto >= 340 && porto <= 400, `Lisboa→Porto ${porto} km`);
  assert.ok(Math.abs(haversineKm(lx, c('Porto')) - 273) < 5);
  assert.equal(distanciaEstrada(lx, c('Funchal')), null, 'continente → ilha');
  assert.equal(distanciaEstrada(c('Funchal'), c('Porto Santo')), null, 'ilhas diferentes');
  assert.ok(distanciaEstrada(c('Funchal'), c('Santa Cruz')) < 30, 'mesma ilha');
  assert.equal(distanciaEstrada(lx, lx), 0);
});

test('deslocação (ida e volta, por dia): km grátis, €/km, mínimo fixo, fora da área, texto livre', () => {
  const cfg = { deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100, deslocacao_iva: 0 };
  const { config, ...s } = calcularDeslocacao('Sintra', cfg);
  // 29 km − 20 grátis = 9 km pagos × 2 (ida e volta) × 0,40 € = 7,20 € por dia.
  assert.deepEqual(s, { localidade: 'Sintra', concelho: 'Sintra', distrito: 'Lisboa', distancia_km: 29, dias: 1, limitado: false, estado: 'estimada', valor_dia_iva: 7.2, valor_iva: 7.2 });
  assert.equal(config.deslocacao_base, 'Lisboa');
  assert.equal(calcularDeslocacao('Lisboa', cfg).valor_iva, 0, 'dentro dos km grátis');
  assert.equal(calcularDeslocacao('Sintra', { ...cfg, deslocacao_iva: 10 }).valor_iva, 17.2, 'fixo + km pagos, ida e volta');
  const porto = calcularDeslocacao('Porto', cfg);
  assert.equal(porto.estado, 'fora_area');
  assert.equal(porto.valor_iva, null);
  const funchal = calcularDeslocacao('Funchal', cfg);
  assert.equal(funchal.estado, 'fora_area');
  assert.equal(funchal.distancia_km, null);
  assert.equal(calcularDeslocacao('Funchal', { ...cfg, deslocacao_base: 'Santa Cruz' }).estado, 'estimada', 'base na mesma ilha');
  const livre = calcularDeslocacao('Aldeia da Mata Pequena', { ...cfg, deslocacao_iva: 7.5 });
  assert.equal(livre.estado, 'visita');
  assert.equal(livre.concelho, null);
  assert.equal(livre.valor_iva, 7.5, 'só o mínimo fixo');
  assert.equal(calcularDeslocacao('', cfg).estado, 'sem_localidade');
  // Sem configuração (catálogo em baixo) ou base inválida: valores de exemplo (Lisboa, 20 km, 0,40 €/km, 100 km).
  assert.equal(calcularDeslocacao('Sintra', null).valor_iva, 7.2);
  assert.equal(calcularDeslocacao('Sintra', { ...cfg, deslocacao_base: 'Atlântida' }).distancia_km, 29);
  assert.equal(calcularDeslocacao('Évora', { ...cfg, deslocacao_max_km: 200 }).estado, 'estimada');
});
