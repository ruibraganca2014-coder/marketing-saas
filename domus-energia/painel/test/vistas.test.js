// Simulador — divisão a divisão (decisão do dono): nas Divisões e em "Trocar e reparar" o "Seguinte" passa primeiro
// por cada divisão ainda por ver. As vistas guardam-se no estado (estado.js vistas); os estados de antes da regra
// ficam sem nenhuma vista, mas não prendem quem já tinha passado do passo (vistasLivres).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoNovo, normalizarEstado, PASSO, chaveVista, divisaoVista, divisoesPorVer, marcarVista,
} from '../../web/simulador/estado.js';

const DIVS = [{ id: 'd1', nome: 'Kitnet' }, { id: 'd2', nome: 'Quarto' }, { id: 'd3', nome: 'Casa de banho' }, { id: 'd4', nome: 'Jardim' }];

test('estado novo: nenhuma divisão vista, nenhum passo livre', () => {
  const e = estadoNovo();
  assert.deepEqual(e.vistas, { divisoes: [], trocar: [] });
  assert.deepEqual(e.vistasLivres, []);
  assert.deepEqual(divisoesPorVer(e, 'divisoes', DIVS).map((d) => d.nome), ['Kitnet', 'Quarto', 'Casa de banho', 'Jardim']);
});

test('marcarVista: por passo, sem repetir, e só as divisões que ainda existem', () => {
  const e = estadoNovo();
  assert.equal(marcarVista(e, 'divisoes', DIVS[0], DIVS), true);
  assert.equal(marcarVista(e, 'divisoes', DIVS[0], DIVS), false, 'já estava vista');
  marcarVista(e, 'divisoes', DIVS[1], DIVS);
  assert.equal(divisaoVista(e, 'divisoes', DIVS[1]), true);
  assert.equal(divisaoVista(e, 'trocar', DIVS[1]), false, 'cada passo tem as suas');
  assert.deepEqual(divisoesPorVer(e, 'divisoes', DIVS).map((d) => d.id), ['d3', 'd4']);
  // A casa muda: o Quarto sai e entra uma divisão nova (por ver); a que saiu deixa de contar.
  const depois = [DIVS[0], DIVS[2], DIVS[3], { id: 'd5', nome: 'Escritório' }];
  marcarVista(e, 'divisoes', DIVS[2], depois);
  assert.deepEqual(e.vistas.divisoes, [chaveVista(DIVS[0]), chaveVista(DIVS[2])]);
  assert.deepEqual(divisoesPorVer(e, 'divisoes', depois).map((d) => d.id), ['d4', 'd5']);
  // Planta redesenhada com outra divisão no mesmo id: fica por ver.
  assert.equal(divisaoVista(e, 'divisoes', { id: 'd1', nome: 'Sala' }), false);
});

test('normalizarEstado: guarda as vistas e limpa o que vem estragado', () => {
  const e = estadoNovo();
  marcarVista(e, 'trocar', DIVS[1], DIVS);
  const v = normalizarEstado(JSON.parse(JSON.stringify({ ...e, funil: 'primeira', passo: PASSO.trocar, visitado: PASSO.trocar })));
  assert.deepEqual(v.vistas, { divisoes: [], trocar: ['d2:Quarto'] });
  assert.deepEqual(v.vistasLivres, []);
  const mau = normalizarEstado({ ...estadoNovo(), vistas: { divisoes: [1, 'x'.repeat(200), 'd1:Sala', 'd1:Sala'], trocar: 'd1' }, vistasLivres: ['divisoes', 'outro'] });
  assert.deepEqual(mau.vistas, { divisoes: ['d1:Sala'], trocar: [] });
  assert.deepEqual(mau.vistasLivres, ['divisoes']);
});

test('estados de antes da regra: nenhuma vista, mas não prendem quem já passou do passo', () => {
  const antigo = (o) => { const e = { ...estadoNovo(), funil: 'primeira', ...o }; delete e.vistas; delete e.vistasLivres; return normalizarEstado(e); };
  const noOrcamento = antigo({ passo: PASSO.preco, visitado: PASSO.preco });
  assert.deepEqual(noOrcamento.vistas, { divisoes: [], trocar: [] });
  assert.deepEqual(noOrcamento.vistasLivres, ['divisoes', 'trocar']);
  assert.deepEqual(divisoesPorVer(noOrcamento, 'trocar', DIVS), [], 'livre: nada por ver');
  assert.equal(divisaoVista(noOrcamento, 'trocar', DIVS[0]), false, 'mas sem ✓');
  // Ainda nas Divisões (não passou delas): a regra vale; já tinha passado das Divisões mas não do Trocar.
  assert.deepEqual(antigo({ passo: PASSO.divisoes, visitado: PASSO.divisoes }).vistasLivres, []);
  assert.deepEqual(antigo({ passo: PASSO.trocar, visitado: PASSO.trocar }).vistasLivres, ['divisoes']);
  // Funil "Já tenho a planta" a começar em "Trocar e reparar".
  assert.deepEqual(antigo({ funil: 'planta', passo: PASSO.trocar, visitado: PASSO.trocar }).vistasLivres, ['divisoes']);
});
