// Coerência "programa vs manual" (decisões do dono, 2026-10-24): onde o programa dava outro valor técnico, segue o manual
// de instalações BT da empresa (docs/SIMULADOR-ORCAMENTO.md §0 "Manual de instalações BT"). Um teste por regra mudada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiteW, amperesMaquina, seccaoCabo, circuitoProprio, sugerirCircuitos, avisosCircuito, MODELOS } from '../../web/simulador/regras.js';
import { tamanhoQuadro, dividirZonas, opcoesCircuitos, potenciaSugerida, minimoRtiebt, MAX_MONO_KVA, avisosProtecoes } from '../../web/simulador/quadro.js';
import { potenciaOmissao, estadoNovo } from '../../web/simulador/estado.js';

const linha = (nome, extra = {}) => ({ id: nome, nome, piso: 0, luzes: 0, tomadas: 0, maquinas: [], interruptores: [], ...extra });

test('IB ≤ In (6.2): 3 680 W num circuito de 16 A; o termoacumulador de 3 000 W fica nos 16 A (C11)', () => {
  assert.equal(limiteW(16), 3680);
  assert.equal(amperesMaquina({ modelo: 'termoacumulador', potencia_w: 3000 }), 16);
  assert.equal(amperesMaquina({ modelo: 'maquina_secar', potencia_w: 3000 }), 16);
  assert.equal(avisosCircuito({ n: 1, tipo: 'tomadas', amperes: 16, itens: { luzes: 0, tomadas: 1, maquinas: [{ modelo: 'outro', potencia_w: 1800 }, { modelo: 'outro', potencia_w: 1800 }] } }).length, 0, '3 600 W em 16 A não avisa');
});

test('placa 25 A / 4 mm², forno 16 A / 2,5 mm², carregador 40 A / 6 mm², iluminação exterior com circuito próprio de 10 A (2.2, 3.2, 13.6)', () => {
  assert.deepEqual([amperesMaquina({ modelo: 'placa', potencia_w: 7200 }), seccaoCabo(25)], [25, 4]);
  assert.deepEqual([amperesMaquina({ modelo: 'forno', potencia_w: 2500 }), seccaoCabo(16)], [16, 2.5]);
  assert.deepEqual([amperesMaquina({ modelo: 'carregador_ve', potencia_w: 7400 }), seccaoCabo(40)], [40, 6]);
  assert.equal(seccaoCabo(32), 6);
  assert.ok(circuitoProprio({ modelo: 'iluminacao_jardim', potencia_w: 150 }));
  assert.equal(amperesMaquina({ modelo: 'iluminacao_jardim', potencia_w: 150 }), 10);
  assert.deepEqual([MODELOS.maquina_loica.w, MODELOS.secador.w], [2000, 1600]);
  const forno = { n: 1, tipo: 'maquina', amperes: 16, itens: { luzes: 0, tomadas: 0, maquinas: [{ modelo: 'forno', potencia_w: 2500 }] } };
  assert.deepEqual(avisosCircuito(forno), [], 'o forno a 16 A já não pede 25 A');
  const placa = { ...forno, itens: { ...forno.itens, maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } };
  assert.ok(avisosCircuito(placa).some((a) => /Para a placa recomendamos um circuito de 25 A com cabo de 4 mm²/.test(a)));
});

test('cozinha com circuito de tomadas exclusivo; dia e noite separados a partir do T1 (3.2)', () => {
  const cont = [linha('Sala', { tomadas: 3, luzes: 1 }), linha('Quarto', { tomadas: 2, luzes: 1 }), linha('Cozinha', { tomadas: 3, luzes: 1 }), linha('Casa de banho', { tomadas: 1, luzes: 1 })];
  const c = sugerirCircuitos(cont, opcoesCircuitos({ tipo: 'apartamento', tipologia: 'T1', quartos: 1 }));
  assert.deepEqual(c.filter((x) => x.zona_humida).map((x) => [x.nome, x.divisoes]), [['Tomadas cozinha', ['Cozinha']], ['Tomadas zonas húmidas', ['Casa de banho']]]);
  assert.equal(c.filter((x) => x.tipo === 'iluminacao').length, 2, 'T1: pelo menos dois circuitos de iluminação');
  assert.deepEqual([dividirZonas({ tipo: 'apartamento', tipologia: 'T0', quartos: 0 }), dividirZonas({ tipo: 'apartamento', tipologia: 'T1', quartos: 1 })], [false, true]);
});

test('quadro com 20 % de reserva (3.3, exemplo 3.1: 20 ocupados → 24 módulos)', () => {
  assert.deepEqual([10, 11, 15, 16, 20, 21, 30, 31, 40, 41].map(tamanhoQuadro), [12, 18, 18, 24, 24, 36, 36, 48, 48, null]);
});

test('potência (2.5): monofásica até 10,35 kVA; 3,45 kVA com 1 compartimento; T1 sugere 6,9 kVA; exemplo 2.1 do T2 → 10,35 kVA', () => {
  assert.equal(MAX_MONO_KVA, 10.35);
  assert.equal(minimoRtiebt(1), 3.45);
  assert.deepEqual([potenciaOmissao({ tipologia: 'T0' }), potenciaOmissao({ tipologia: 'T1' })], [3.45, 6.9]);
  // Exemplo 2.1: 12 pontos de luz, 3 circuitos de tomadas, placa 7 200, forno 3 000, lavar 2 200, loiça 2 200, termo 2 000, ar
  // condicionado 1 200 (o manual divide-o por 0,9; aqui kVA ≈ kW) × 0,4 → ≈ 9,4 kVA → 10,35 kVA.
  const m = (modelo, w) => ({ modelo, potencia_w: w });
  const circ = [
    { tipo: 'iluminacao', itens: { luzes: 6, tomadas: 0, maquinas: [] } }, { tipo: 'iluminacao', itens: { luzes: 6, tomadas: 0, maquinas: [] } },
    ...[0, 1, 2].map(() => ({ tipo: 'tomadas', itens: { luzes: 0, tomadas: 5, maquinas: [] } })),
    ...[m('placa', 7200), m('forno', 3000), m('maquina_lavar', 2200), m('maquina_loica', 2200), m('termoacumulador', 2000), m('ar_condicionado', 1200)].map((x) => ({ tipo: 'maquina', itens: { luzes: 0, tomadas: 0, maquinas: [x] } })),
  ];
  const p = potenciaSugerida(circ, 4, true);
  assert.deepEqual([p.carga_w, p.kva, p.trifasica], [9400, 10.35, false]);
  assert.equal(potenciaSugerida(circ, null, false).kva, 10.35, 'serviços e industrial: o método antigo');
  // Acima de 10,35 kVA: o aviso da ligação trifásica.
  const e = estadoNovo();
  e.casa = { ...e.casa, tipo: 'moradia', tipologia: 'T3', fases: 'mono', potencia_contratada_kva: 13.8 };
  e.quadro.circuitos = [...circ, { tipo: 'maquina', itens: { luzes: 0, tomadas: 0, maquinas: [m('carregador_ve', 7400)] } }].map((c, i) => ({ n: i + 1, amperes: 16, nome: '', divisoes: [], inteligente: false, medir: false, zona_humida: false, ...c }));
  assert.ok(avisosProtecoes(e).some((a) => /a ligação deve ser trifásica: acima de 10,35 kVA só é monofásica com acordo da E-REDES/.test(a)));
});
