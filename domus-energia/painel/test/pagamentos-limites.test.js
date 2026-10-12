// Proteções dos pagamentos do pedido antes de ligar o Stripe (auditoria de 2026-10-12; docs/PAGAMENTOS-PEDIDO.md):
// "Pagar" tem limite por conta, e o Stripe sem o segredo do webhook deixa os pagamentos do pedido desligados.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { lerConfig } from '../src/config.js';

describe('pagamentos do pedido: limite por conta', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  test('"Pagar": 30 por hora e por conta; a 31.ª dá 429 com Retry-After; outra conta não é afetada; passada a hora volta a poder', async () => {
    const a = await p.contaConfirmada();
    const b = await p.contaConfirmada();
    const pagar = (c) => p.pedir('POST', '/api/conta/pedidos/1/pagar', { cookie: c.cookie, corpo: { fase: 'nao-existe' } });
    for (let i = 0; i < 30; i++) assert.equal((await pagar(a)).estado, 400, `tentativa ${i + 1}`);
    const r = await pagar(a);
    assert.equal(r.estado, 429);
    assert.match(r.json.erro, /Demasiadas tentativas/);
    assert.ok(Number(r.cabecalhos['retry-after']) > 0);
    assert.equal((await pagar(b)).estado, 400, 'o limite é por conta');
    p.relogio.avancar(3600_000 + 1000);
    assert.equal((await pagar(a)).estado, 400);
  });
});

test('Stripe sem o segredo do webhook: os pagamentos do pedido ficam desligados, com erro no arranque; com o segredo, ligados', () => {
  const sem = lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x' });
  assert.equal(sem.pagamentoPedido, false);
  assert.equal(sem.erros.length, 1);
  assert.match(sem.erros[0], /STRIPE_PEDIDO_WEBHOOK_SECRET.*DESLIGADOS/);
  const com = lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: 'whsec_x' });
  assert.deepEqual([com.pagamentoPedido, com.pagamentosModo, com.erros], [true, 'stripe', []]);
  // Sem chave nenhuma (produção hoje) e no modo simulado (lançador local): como estava.
  assert.deepEqual([lerConfig({}).pagamentoPedido, lerConfig({}).erros], [false, []]);
  assert.deepEqual([lerConfig({ PAGAMENTOS_MODO: 'simulado' }).pagamentoPedido, lerConfig({ PAGAMENTOS_MODO: 'simulado' }).erros], [true, []]);
});
