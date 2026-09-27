// Testes unitários (sem rede): token, limite, transições, leitura de eventos, configuração.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

import { criarToken, verificarToken } from '../src/sessao.js';
import { LimiteTaxa } from '../src/limite.js';
import { ArmazemPlanos, payloadPlano, transicionar, validarRegisto, clienteValido } from '../src/planos.js';
import { estadoDoStripe, subscricaoDoObjeto, clienteDoObjeto } from '../src/pagamentos.js';
import { lerConfig } from '../src/config.js';
import { escreverAtomico, iso, dataLisboa } from '../src/util.js';

const SEGREDO = 'x'.repeat(40);

test('token: válido, expirado, adulterado, outro segredo, alg none', () => {
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const { token, exp } = criarToken(SEGREDO, 'joao', 900, t0);
  assert.equal(exp, t0 / 1000 + 900);
  assert.equal(verificarToken(SEGREDO, token, t0 + 60_000), 'joao');
  assert.equal(verificarToken(SEGREDO, token, t0 + 900_000), null, 'expirado aos 15 min');
  assert.equal(verificarToken('y'.repeat(40), token, t0), null, 'outro segredo');
  const [c, corpo, sig] = token.split('.');
  const corpoMaria = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, 'base64url')), sub: 'maria' })).toString('base64url');
  assert.equal(verificarToken(SEGREDO, `${c}.${corpoMaria}.${sig}`, t0), null, 'corpo adulterado');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verificarToken(SEGREDO, `${none}.${corpo}.`, t0), null, 'alg none');
  const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  const sig512 = createHmac('sha512', SEGREDO).update(`${hs512}.${corpo}`).digest('base64url');
  assert.equal(verificarToken(SEGREDO, `${hs512}.${corpo}.${sig512}`, t0), null, 'outro algoritmo');
  assert.equal(verificarToken(SEGREDO, 'lixo', t0), null);
  assert.equal(verificarToken(SEGREDO, undefined, t0), null);
});

test('limite: 5 por minuto por chave, janela deslizante', () => {
  let agora = 0;
  const l = new LimiteTaxa(5, 60_000, () => agora);
  for (let i = 0; i < 5; i++) {
    assert.equal(l.espera('ip'), 0);
    l.registar('ip');
    agora += 1000;
  }
  assert.ok(l.espera('ip') > 0, '6.ª tentativa bloqueada');
  assert.equal(l.espera('outro'), 0, 'outra chave não é afetada');
  agora = 60_001;
  assert.equal(l.espera('ip'), 0, 'a primeira tentativa saiu da janela');
  agora = 1e9;
  l.limpar();
  assert.equal(l.tentativas.size, 0);
});

test('estado do Stripe → estado do _plano', () => {
  assert.equal(estadoDoStripe('trialing'), 'teste');
  assert.equal(estadoDoStripe('active'), 'ativo');
  assert.equal(estadoDoStripe('past_due'), 'em_atraso');
  assert.equal(estadoDoStripe('unpaid'), 'em_atraso');
  assert.equal(estadoDoStripe('paused'), 'suspenso');
  assert.equal(estadoDoStripe('canceled'), 'cancelado');
  assert.equal(estadoDoStripe('incomplete_expired'), 'cancelado');
  assert.equal(estadoDoStripe('incomplete'), null);
});

test('transições: em_atraso com aviso de 15 dias, mantido, e suspenso depois', () => {
  const t0 = new Date('2026-10-01T10:00:00Z');
  const ativo = transicionar(null, { plano: 'conforto', estado: 'ativo', gerido: 'stripe', proximo_pagamento: '2026-11-01T10:00:00Z' }, t0, 15);
  assert.deepEqual(JSON.parse(payloadPlano(ativo)), {
    plano: 'conforto', estado: 'ativo', desde: '2026-10-01T10:00:00Z', proximo_pagamento: '2026-11-01T10:00:00Z', aviso_ate: null, gerido: 'stripe',
  });
  const t1 = new Date('2026-11-01T10:05:00Z');
  const atraso = transicionar(ativo, { ...ativo, estado: 'em_atraso' }, t1, 15);
  assert.equal(atraso.estado, 'em_atraso');
  assert.equal(atraso.aviso_ate, '2026-11-16T10:05:00Z');
  assert.equal(atraso.desde, '2026-11-01T10:05:00Z');
  const t2 = new Date('2026-11-05T00:00:00Z');
  const outra = transicionar(atraso, { ...atraso, estado: 'em_atraso' }, t2, 15);
  assert.equal(outra.aviso_ate, '2026-11-16T10:05:00Z', 'nova falha não prolonga o aviso');
  assert.equal(outra.desde, atraso.desde);
  const t3 = new Date('2026-11-16T10:05:00Z');
  const tarde = transicionar(atraso, { ...atraso, estado: 'em_atraso' }, t3, 15);
  assert.equal(tarde.estado, 'suspenso', 'aviso terminado → suspenso');
  assert.equal(tarde.proximo_pagamento, null);
  const continua = transicionar(tarde, { ...tarde, estado: 'em_atraso' }, t3, 15);
  assert.equal(continua.estado, 'suspenso', 'suspenso sem pagar continua suspenso');
  const pago = transicionar(tarde, { ...tarde, estado: 'ativo', proximo_pagamento: '2026-12-16T00:00:00Z' }, t3, 15);
  assert.equal(pago.estado, 'ativo');
  assert.equal(pago.aviso_ate, null);
  assert.equal(pago.proximo_pagamento, '2026-12-16T00:00:00Z');
});

test('payloadPlano: exatamente os 6 campos de §2 por esta ordem', () => {
  const r = validarRegisto({
    plano: 'base', estado: 'teste', desde: '2026-10-01T10:00:00Z', proximo_pagamento: '2026-10-31T10:00:00Z',
    aviso_ate: null, gerido: 'stripe', stripe_cliente: 'cus_1', stripe_subscricao: 'sub_1', teste_usado: true, atualizado: '2026-10-01T10:00:00Z',
  });
  assert.equal(payloadPlano(r),
    '{"plano":"base","estado":"teste","desde":"2026-10-01T10:00:00Z","proximo_pagamento":"2026-10-31T10:00:00Z","aviso_ate":null,"gerido":"stripe"}');
});

test('validarRegisto recusa campos desconhecidos e valores inválidos', () => {
  const ok = { plano: 'base', estado: 'ativo', desde: '2026-10-01T10:00:00Z', gerido: 'manual' };
  assert.equal(validarRegisto(ok).aviso_ate, null);
  assert.throws(() => validarRegisto({ ...ok, extra: 1 }), /campo desconhecido/);
  assert.throws(() => validarRegisto({ ...ok, plano: 'ouro' }), /plano/);
  assert.throws(() => validarRegisto({ ...ok, estado: 'pausado' }), /estado/);
  assert.throws(() => validarRegisto({ ...ok, gerido: 'x' }), /gerido/);
  assert.throws(() => validarRegisto({ ...ok, desde: 'ontem' }), /desde/);
  assert.throws(() => validarRegisto({ ...ok, stripe_cliente: 'cus"1' }), /stripe_cliente/);
  assert.throws(() => validarRegisto([]), /objeto/);
});

test('códigos de cliente: formato do domus.sh e reservados', () => {
  for (const c of ['joao', 'casa-2', 'a']) assert.ok(clienteValido(c), c);
  for (const c of ['admin', 'motor', 'pagamentos', 'Joao', '-x', 'x-', 'a/b', '', 'a'.repeat(33), 'x+', '#']) {
    assert.ok(!clienteValido(c), c);
  }
});

test('eventos: subscrição e cliente nas versões antiga e nova da API', () => {
  assert.equal(subscricaoDoObjeto('customer.subscription.updated', { id: 'sub_9' }), 'sub_9');
  assert.equal(subscricaoDoObjeto('checkout.session.completed', { subscription: 'sub_9' }), 'sub_9');
  assert.equal(subscricaoDoObjeto('checkout.session.completed', { subscription: { id: 'sub_8' } }), 'sub_8');
  const novaFatura = { parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_7', metadata: { cliente: 'joao' } } } };
  assert.equal(subscricaoDoObjeto('invoice.paid', novaFatura), 'sub_7');
  assert.equal(clienteDoObjeto(novaFatura), 'joao');
  const velhaFatura = { subscription: 'sub_6', subscription_details: { metadata: { cliente: 'maria' } } };
  assert.equal(subscricaoDoObjeto('invoice.payment_failed', velhaFatura), 'sub_6');
  assert.equal(clienteDoObjeto(velhaFatura), 'maria');
  assert.equal(clienteDoObjeto({ client_reference_id: 'ana' }), 'ana');
  assert.equal(clienteDoObjeto({ metadata: { cliente: 'admin' } }), null, 'reservado');
  assert.equal(clienteDoObjeto({ metadata: { cliente: '../x' } }), null, 'inválido');
  assert.equal(subscricaoDoObjeto('invoice.paid', {}), null);
});

test('configuração: erros claros e valores por omissão', () => {
  const vazia = lerConfig({});
  assert.ok(vazia.erros.some((e) => e.includes('PUBLIC_URL')));
  assert.ok(vazia.erros.some((e) => e.includes('SESSAO_SEGREDO')));
  assert.ok(vazia.erros.some((e) => e.includes('PAGAMENTOS_MQTT_PASS')));
  assert.ok(vazia.errosStripe.some((e) => e.includes('STRIPE_SECRET_KEY')));
  const boa = lerConfig({
    DOMUS_HOST: 'x.sslip.io', SESSAO_SEGREDO: SEGREDO, PAGAMENTOS_MQTT_PASS: 'p', STRIPE_SECRET_KEY: 'sk_test_abc',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc', STRIPE_PRICE_BASE: 'price_a', STRIPE_PRICE_CONFORTO: 'price_b', STRIPE_PRICE_PREMIUM: 'price_c',
  });
  assert.deepEqual(boa.erros, []);
  assert.deepEqual(boa.errosStripe, []);
  assert.equal(boa.publicUrl, 'https://x.sslip.io');
  assert.equal(boa.diasTeste, 30);
  assert.equal(boa.diasAviso, 15);
  assert.deepEqual(boa.stripe.metodos, ['card']);
  assert.equal(boa.planosDir, '/dados/planos');
  assert.equal(boa.csv, '/dados/pagamentos.csv');
  assert.ok(lerConfig({ PUBLIC_URL: 'http://exemplo.pt' }).erros.some((e) => e.includes('https')));
  assert.ok(lerConfig({ STRIPE_METODOS: 'card,bitcoin' }).errosStripe.some((e) => e.includes('STRIPE_METODOS')));
  assert.equal(lerConfig({ STRIPE_METODOS: 'automatico' }).stripe.metodos, null);
  assert.ok(lerConfig({ DIAS_TESTE: '-1' }).erros.some((e) => e.includes('DIAS_TESTE')));
  assert.ok(lerConfig({ STRIPE_PRICE_BASE: 'price_a', STRIPE_PRICE_CONFORTO: 'price_a', STRIPE_PRICE_PREMIUM: 'price_c',
    STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' }).errosStripe.some((e) => e.includes('diferentes')));
});

test('armazém: escrita atómica, listagem e procura por cliente Stripe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planos-'));
  try {
    const a = new ArmazemPlanos(dir);
    assert.equal(await a.ler('joao'), null);
    const r = transicionar(null, { plano: 'base', estado: 'ativo', gerido: 'stripe', stripe_cliente: 'cus_5', stripe_subscricao: 'sub_5' }, new Date(), 15);
    await a.gravar('joao', r);
    await escreverAtomico(join(dir, 'maria.json'), '{"plano":"premium","estado":"ativo","desde":"2026-10-01T10:00:00Z","gerido":"manual"}\n');
    assert.deepEqual(await a.clientes(), ['joao', 'maria']);
    assert.deepEqual(await readdir(dir), ['joao.json', 'maria.json'], 'sem ficheiros temporários');
    const texto = await readFile(join(dir, 'joao.json'), 'utf8');
    assert.ok(texto.endsWith('}\n') && !texto.slice(0, -1).includes('\n'), 'uma só linha (lida pelo domus.sh)');
    assert.equal(await a.porClienteStripe('cus_5'), 'joao');
    assert.equal(await a.porClienteStripe('cus_x'), null);
    assert.throws(() => a.caminho('../x'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('datas: ISO sem milissegundos e data civil de Lisboa', () => {
  assert.equal(iso(new Date('2026-10-01T10:00:00.123Z')), '2026-10-01T10:00:00Z');
  assert.equal(dataLisboa(new Date('2026-10-31T23:30:00Z')), '2026-10-31', 'inverno: UTC+0');
  assert.equal(dataLisboa(new Date('2026-07-31T23:30:00Z')), '2026-08-01', 'verão: UTC+1');
});
