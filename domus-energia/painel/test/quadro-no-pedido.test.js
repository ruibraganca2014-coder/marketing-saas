// O quadro elétrico no preço (web/simulador/preco.js quadroNoPedido): em "Obras" (Pedir um serviço) só entra se o
// cliente o pedir (decisão do dono, 2026-10-11); na instalação nova da primeira vez continua a entrar sempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadroNoPedido } from '../../web/simulador/preco.js';

test('quadro no preço: em "Obras" só com "Melhorar" ou "Quadro novo"; instalação nova sempre; automatizar e reparar só se pedir', () => {
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: 'obras', mexerQuadro: false }), false, 'obras: trocar uma tomada não traz quadro');
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: 'obras', mexerQuadro: true }), true, 'obras: o cliente pediu');
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: null, mexerQuadro: false }), true, 'instalação nova (primeira vez)');
  assert.equal(quadroNoPedido({ servico: ['nova'] }), true);
  assert.equal(quadroNoPedido({ servico: ['automatizar'], caminho: 'automatizar', mexerQuadro: false }), false);
  assert.equal(quadroNoPedido({ servico: ['reparar'], caminho: 'quadro', mexerQuadro: true }), true, 'trocar o quadro');
  assert.equal(quadroNoPedido({}), true, 'estado antigo sem serviço: como antes');
});
