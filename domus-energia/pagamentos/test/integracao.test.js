// Testes de integração: Mosquitto 2 real (passwd/acl gerados pelo servidor/domus.sh),
// Stripe falso ao nível HTTP (SDK oficial com host/port/protocol) e o serviço HTTP real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import Stripe from 'stripe';

import { lerConfig } from '../src/config.js';
import { criarServico } from '../src/app.js';
import { registoMudo, iso } from '../src/util.js';
import {
  iniciarMosquitto, iniciarStripeFalso, lerRetida, esperar, subscricao, eventoAssinado, lerTexto,
  SENHAS, PRECOS, WEBHOOK_SEGREDO,
} from './ajuda.js';

const SEGREDO = 's'.repeat(48);
const stripeTeste = new Stripe('sk_test_assinaturas');
let mq; let falso; let servico; let base; let config;

function configPara(mqUrl, dados, extra = {}) {
  const c = lerConfig({
    PUBLIC_URL: 'https://domus.teste',
    SESSAO_SEGREDO: SEGREDO,
    PAGAMENTOS_MQTT_PASS: SENHAS.pagamentos,
    MQTT_URL: mqUrl,
    DADOS_DIR: dados,
    STRIPE_SECRET_KEY: 'sk_test_falso',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SEGREDO,
    STRIPE_PRICE_BASE: PRECOS.base,
    STRIPE_PRICE_CONFORTO: PRECOS.conforto,
    STRIPE_PRICE_PREMIUM: PRECOS.premium,
    ...extra,
  });
  c.porta = 0;
  c.anfitriao = '127.0.0.1';
  return c;
}

async function arrancar(cfg) {
  const s = criarServico({ config: cfg, registo: registoMudo, stripeOpcoes: falso.opcoes() });
  await s.iniciar();
  return { s, base: `http://127.0.0.1:${s.servidor.address().port}` };
}

before(async () => {
  mq = await iniciarMosquitto();
  falso = await iniciarStripeFalso();
  config = configPara(mq.url, mq.dados);
  ({ s: servico, base } = await arrancar(config));
  await esperar(() => servico.publicador?.ligado);
  config.confiarProxy = true; // como atrás do Caddy (X-Forwarded-For)
  await tokenDe('joao');
  await tokenDe('maria');
});

after(async () => {
  await servico?.parar();
  await falso?.parar();
  await mq?.parar();
});

async function post(caminho, corpo, { token, tipo = 'application/json', ip, em = base } = {}) {
  const headers = { 'Content-Type': tipo };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  const r = await fetch(`${em}${caminho}`, { method: 'POST', headers, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
  return { estado: r.status, corpo: await r.json(), headers: r.headers };
}

let contaIp = 0;
const ipNovo = () => `10.0.0.${++contaIp}`;

// Um token por cliente (válido 15 min): não gastar o limite de 5 sessões/minuto por código.
const tokens = {};
async function novoToken(c) {
  const r = await post('/api/sessao', { codigo: c, password: SENHAS[c] }, { ip: ipNovo() });
  assert.equal(r.estado, 200, JSON.stringify(r.corpo));
  return r.corpo.token;
}
async function tokenDe(c = 'joao') {
  tokens[c] ??= await novoToken(c);
  return tokens[c];
}

async function webhook(evento, { segredo } = {}) {
  const { payload, header } = eventoAssinado(stripeTeste, evento, segredo);
  const r = await fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload });
  return { estado: r.status, corpo: await r.json() };
}

const lerPlano = async (c) => JSON.parse(await readFile(join(mq.dados, 'planos', `${c}.json`), 'utf8'));
const planoRetido = async (c, leitor = c) => {
  const m = await lerRetida(mq.url, leitor, `domus/${c}/_plano`);
  return m && { ...m, json: JSON.parse(m.texto) };
};

// ------------------------------------------------------------------ sessão

test('sessão: credenciais certas → token de 15 min (HS256)', async () => {
  const r = await post('/api/sessao', { codigo: 'joao', password: SENHAS.joao }, { ip: ipNovo() });
  assert.equal(r.estado, 200);
  assert.equal(r.corpo.cliente, 'joao');
  const [cab, corpo] = r.corpo.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(cab, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const p = JSON.parse(Buffer.from(corpo, 'base64url'));
  assert.equal(p.sub, 'joao');
  assert.equal(p.exp - p.iat, 900);
  assert.equal(r.corpo.expira, iso(new Date(p.exp * 1000)));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('sessão: palavra-passe errada, aparelho, reservado e desconhecido → 401 com a mesma mensagem', async () => {
  const casos = [
    { codigo: 'joao', password: 'errada-123' },
    { codigo: 'joao-sala', password: SENHAS['joao-sala'] }, // credenciais válidas de um APARELHO
    { codigo: 'admin', password: SENHAS.admin },
    { codigo: 'pagamentos', password: SENHAS.pagamentos },
    { codigo: 'ninguem', password: 'qualquer-1' },
    { codigo: 'a/#', password: 'qualquer-1' },
  ];
  for (const c of casos) {
    const r = await post('/api/sessao', c, { ip: ipNovo() });
    assert.equal(r.estado, 401, `${c.codigo}: ${JSON.stringify(r.corpo)}`);
    assert.equal(r.corpo.erro, 'Código de cliente ou palavra-passe errados.');
  }
});

test('sessão: validação estrita do pedido', async () => {
  let r = await post('/api/sessao', { codigo: 'joao', password: SENHAS.joao, extra: 1 }, { ip: ipNovo() });
  assert.equal(r.estado, 400);
  assert.match(r.corpo.erro, /Campo desconhecido/);
  r = await post('/api/sessao', { codigo: 'joao' }, { ip: ipNovo() });
  assert.equal(r.estado, 400);
  r = await post('/api/sessao', '{"codigo":', { ip: ipNovo() });
  assert.equal(r.estado, 400);
  assert.equal(r.corpo.erro, 'JSON inválido.');
  r = await post('/api/sessao', 'codigo=joao', { tipo: 'application/x-www-form-urlencoded', ip: ipNovo() });
  assert.equal(r.estado, 415);
  r = await post('/api/sessao', [1], { ip: ipNovo() });
  assert.equal(r.estado, 400);
  r = await post('/api/sessao', { codigo: 'joao', password: 'x'.repeat(5000) }, { ip: ipNovo() });
  assert.equal(r.estado, 413);
  const g = await fetch(`${base}/api/sessao`);
  assert.equal(g.status, 405);
  const n = await fetch(`${base}/api/outra`, { method: 'POST' });
  assert.equal(n.status, 404);
  assert.equal((await n.json()).erro, 'Endereço desconhecido.');
});

test('sessão: limite de 5 tentativas por minuto por IP e por código', async () => {
  // serviço à parte, para os bloqueios não afetarem os outros testes
  const cfg = configPara(mq.url, mq.dados, { CONFIAR_PROXY: '1' });
  const outro = await arrancar(cfg);
  const post2 = (c, o) => post('/api/sessao', c, { ...o, em: outro.base });
  try {
    const ip = ipNovo();
    for (let i = 0; i < 5; i++) {
      const r = await post2({ codigo: 'maria', password: 'errada-123' }, { ip });
      assert.equal(r.estado, 401);
    }
    let r = await post2({ codigo: 'maria', password: SENHAS.maria }, { ip });
    assert.equal(r.estado, 429, 'mesmo com a palavra-passe certa');
    assert.match(r.corpo.erro, /^Demasiadas tentativas\. Tente de novo dentro de \d+ s\.$/);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    // por código: outro IP, mesmo código → também bloqueado
    r = await post2({ codigo: 'maria', password: SENHAS.maria }, { ip: ipNovo() });
    assert.equal(r.estado, 429);
    // por IP: mesmo IP, outro código → bloqueado
    r = await post2({ codigo: 'joao', password: SENHAS.joao }, { ip });
    assert.equal(r.estado, 429);
    // outro IP e outro código → normal
    r = await post2({ codigo: 'joao', password: SENHAS.joao }, { ip: ipNovo() });
    assert.equal(r.estado, 200);
  } finally {
    await outro.s.parar();
  }
});

// ------------------------------------------------------- checkout e portal

test('checkout e portal exigem um token válido', async () => {
  for (const caminho of ['/api/checkout', '/api/portal']) {
    let r = await post(caminho, { plano: 'base' });
    assert.equal(r.estado, 401);
    assert.equal(r.corpo.erro, 'Sessão inválida ou expirada. Entre de novo.');
    r = await post(caminho, { plano: 'base' }, { token: 'a.b.c' });
    assert.equal(r.estado, 401);
  }
  const antes = falso.pedidos.length;
  const t = await tokenDe('joao');
  const r = await post('/api/checkout', { plano: 'ouro' }, { token: t });
  assert.equal(r.estado, 400);
  assert.match(r.corpo.erro, /Plano inválido/);
  assert.equal(falso.pedidos.length, antes, 'nada foi pedido ao Stripe');
});

test('checkout: sessão de subscrição com preço, cliente, 30 dias de teste e só cartão', async () => {
  const t = await tokenDe('maria');
  const r = await post('/api/checkout', { plano: 'conforto' }, { token: t });
  assert.equal(r.estado, 200, JSON.stringify(r.corpo));
  assert.match(r.corpo.url, /^https:\/\/checkout\.stripe\.com\//);
  const p = falso.pedidos.at(-1);
  assert.equal(p.caminho, '/v1/checkout/sessions');
  assert.equal(p.auth, 'Bearer sk_test_falso');
  assert.equal(p.params.mode, 'subscription');
  assert.equal(p.params['line_items[0][price]'], PRECOS.conforto);
  assert.equal(p.params['line_items[0][quantity]'], '1');
  assert.equal(p.params.client_reference_id, 'maria');
  assert.equal(p.params['metadata[cliente]'], 'maria');
  assert.equal(p.params['subscription_data[metadata][cliente]'], 'maria');
  assert.equal(p.params['subscription_data[trial_period_days]'], '30');
  assert.equal(p.params['payment_method_types[0]'], 'card');
  assert.equal(p.params['payment_method_types[1]'], undefined);
  assert.equal(p.params.success_url, 'https://domus.teste/cliente.html?subscricao=ok');
  assert.equal(p.params.cancel_url, 'https://domus.teste/cliente.html?subscricao=cancelada');
  assert.equal(p.params.locale, 'pt');
  assert.equal(p.params.customer, undefined);
});

test('portal: sem subscrição no Stripe → 409', async () => {
  const t = await tokenDe('maria');
  const r = await post('/api/portal', {}, { token: t });
  assert.equal(r.estado, 409);
  assert.equal(r.corpo.erro, 'Ainda não tem pagamentos automáticos. Escolha primeiro um plano.');
});

// ----------------------------------------------------------------- webhook

test('webhook: assinatura inválida, em falta ou com outro segredo → 400', async () => {
  const evento = { id: 'evt_mau', type: 'customer.subscription.updated', data: { object: { id: 'sub_x' } } };
  const { payload, header } = eventoAssinado(stripeTeste, evento);
  const adulterado = header.replace(/v1=(.)/, (_, c) => `v1=${c === '0' ? '1' : '0'}`);
  let r = await fetch(`${base}/stripe/webhook`, { method: 'POST', body: payload, headers: { 'Stripe-Signature': adulterado } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).erro, 'Assinatura do Stripe inválida.');
  r = await fetch(`${base}/stripe/webhook`, { method: 'POST', body: payload });
  assert.equal(r.status, 400);
  r = await fetch(`${base}/stripe/webhook`, { method: 'POST', body: `${payload} `, headers: { 'Stripe-Signature': header } });
  assert.equal(r.status, 400, 'corpo alterado');
  const outro = await webhook(evento, { segredo: 'whsec_outro' });
  assert.equal(outro.estado, 400);
  assert.equal(await lerTexto(join(mq.dados, 'planos', 'x.json')), null);
});

test('checkout.session.completed em teste → estado "teste" e _plano retido exato', async () => {
  falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status: 'trialing', trialEnd: 1_792_000_000, preco: PRECOS.conforto, customer: 'cus_j' }));
  const r = await webhook({
    id: 'evt_c1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', object: 'checkout.session', mode: 'subscription', subscription: 'sub_j1', customer: 'cus_j', client_reference_id: 'joao', metadata: { cliente: 'joao', plano: 'conforto' } } },
  });
  assert.equal(r.estado, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.resultado, 'tratado');
  const f = await lerPlano('joao');
  assert.equal(f.estado, 'teste');
  assert.equal(f.gerido, 'stripe');
  assert.equal(f.stripe_cliente, 'cus_j');
  assert.equal(f.stripe_subscricao, 'sub_j1');
  assert.equal(f.teste_usado, true);
  const m = await planoRetido('joao');
  assert.equal(m.retida, true);
  assert.equal(m.texto, JSON.stringify({
    plano: 'conforto', estado: 'teste', desde: f.desde, proximo_pagamento: iso(new Date(1_792_000_000_000)), aviso_ate: null, gerido: 'stripe',
  }));
  assert.equal(await lerRetida(mq.url, 'maria', 'domus/joao/_plano', 500), null, 'a maria não lê o _plano do joao');
});

test('idempotência: o mesmo evento outra vez não muda nada', async () => {
  const antes = await readFile(join(mq.dados, 'planos', 'joao.json'), 'utf8');
  const r = await webhook({
    id: 'evt_c1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_j1', customer: 'cus_j', client_reference_id: 'joao' } },
  });
  assert.equal(r.estado, 200);
  assert.equal(r.corpo.resultado, 'repetido');
  assert.equal(await readFile(join(mq.dados, 'planos', 'joao.json'), 'utf8'), antes);
});

test('checkout com subscrição viva → portal para mudar de plano (nunca uma segunda subscrição)', async () => {
  const t = await tokenDe('joao');
  const checkouts = () => falso.pedidos.filter((x) => x.caminho === '/v1/checkout/sessions' && x.params.client_reference_id === 'joao').length;
  // plano diferente → fluxo de confirmação da mudança, com o preço escolhido
  let r = await post('/api/checkout', { plano: 'premium' }, { token: t });
  assert.equal(r.estado, 200);
  assert.equal(r.corpo.portal, true);
  assert.match(r.corpo.url, /^https:\/\/billing\.stripe\.com\//);
  let p = falso.pedidos.at(-1);
  assert.equal(p.caminho, '/v1/billing_portal/sessions');
  assert.equal(p.params.customer, 'cus_j');
  assert.equal(p.params['flow_data[type]'], 'subscription_update_confirm');
  assert.equal(p.params['flow_data[subscription_update_confirm][subscription]'], 'sub_j1');
  assert.equal(p.params['flow_data[subscription_update_confirm][items][0][id]'], 'si_sub_j1');
  assert.equal(p.params['flow_data[subscription_update_confirm][items][0][price]'], PRECOS.premium);
  assert.equal(p.params['flow_data[after_completion][redirect][return_url]'], 'https://domus.teste/cliente.html?subscricao=ok');
  // o mesmo plano → página inicial do portal
  r = await post('/api/checkout', { plano: 'conforto' }, { token: t });
  assert.equal(r.estado, 200);
  assert.equal(r.corpo.portal, true);
  p = falso.pedidos.at(-1);
  assert.equal(p.params['flow_data[type]'], undefined);
  assert.equal(p.params.return_url, 'https://domus.teste/cliente.html');
  assert.equal(checkouts(), 0);
});

test('checkout com subscrição viva: fluxos do portal desligados → subscription_update → portal simples', async () => {
  const t = await tokenDe('joao');
  try {
    falso.recusarFluxos.add('subscription_update_confirm');
    let r = await post('/api/checkout', { plano: 'base' }, { token: t });
    assert.equal(r.estado, 200);
    assert.equal(r.corpo.portal, true);
    let p = falso.pedidos.at(-1);
    assert.equal(p.params['flow_data[type]'], 'subscription_update');
    assert.equal(p.params['flow_data[subscription_update][subscription]'], 'sub_j1');
    falso.recusarFluxos.add('subscription_update');
    r = await post('/api/checkout', { plano: 'base' }, { token: t });
    assert.equal(r.estado, 200);
    p = falso.pedidos.at(-1);
    assert.equal(p.params['flow_data[type]'], undefined, 'portal simples');
    assert.equal(r.corpo.portal, true);
  } finally {
    falso.recusarFluxos.clear();
  }
});

test('checkout: past_due, unpaid, paused e incomplete → portal simples; canceled, incomplete_expired ou apagada → nova Checkout Session com o mesmo cliente', async () => {
  const t = await tokenDe('joao');
  const original = falso.subs.get('sub_j1');
  try {
    for (const status of ['past_due', 'unpaid', 'paused', 'incomplete']) {
      falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status, preco: PRECOS.conforto, customer: 'cus_j' }));
      const r = await post('/api/checkout', { plano: 'conforto' }, { token: t });
      assert.equal(r.estado, 200, status);
      assert.equal(r.corpo.portal, true, status);
      const p = falso.pedidos.at(-1);
      assert.equal(p.caminho, '/v1/billing_portal/sessions', status);
      assert.equal(p.params['flow_data[type]'], undefined, status);
    }
    falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status: 'active', preco: PRECOS.conforto, customer: 'cus_j', cancelAtPeriodEnd: true }));
    let r = await post('/api/checkout', { plano: 'premium' }, { token: t });
    assert.equal(falso.pedidos.at(-1).params['flow_data[type]'], undefined, 'cancelamento marcado: portal simples (renovar)');
    for (const status of ['canceled', 'incomplete_expired', null]) {
      if (status) falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status, preco: PRECOS.conforto, customer: 'cus_j' }));
      else falso.subs.delete('sub_j1'); // 404 no Stripe
      r = await post('/api/checkout', { plano: 'base' }, { token: t });
      assert.equal(r.estado, 200, String(status));
      assert.equal(r.corpo.portal, undefined, String(status));
      assert.match(r.corpo.url, /^https:\/\/checkout\.stripe\.com\//);
      const p = falso.pedidos.at(-1);
      assert.equal(p.caminho, '/v1/checkout/sessions');
      assert.equal(p.params.customer, 'cus_j', 'reutiliza o cliente Stripe');
      assert.equal(p.params['subscription_data[trial_period_days]'], undefined, 'o teste grátis já foi usado');
      assert.equal(p.params['line_items[0][price]'], PRECOS.base);
    }
  } finally {
    falso.subs.set('sub_j1', original);
  }
});

test('portal: com cliente Stripe → url do Customer Portal', async () => {
  const t = await tokenDe('joao');
  const r = await post('/api/portal', {}, { token: t });
  assert.equal(r.estado, 200);
  assert.match(r.corpo.url, /^https:\/\/billing\.stripe\.com\//);
  const p = falso.pedidos.at(-1);
  assert.equal(p.params.customer, 'cus_j');
  assert.equal(p.params.return_url, 'https://domus.teste/cliente.html');
  const e = await post('/api/portal', { x: 1 }, { token: t });
  assert.equal(e.estado, 400);
});

test('invoice.payment_failed → em_atraso com aviso_ate = agora + 15 dias; nova falha mantém a data', async () => {
  falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status: 'past_due', preco: PRECOS.conforto, customer: 'cus_j' }));
  const antes = Date.now();
  const fatura = { id: 'in_f1', object: 'invoice', customer: 'cus_j', amount_paid: 0, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_j1', metadata: { cliente: 'joao' } } } };
  const r = await webhook({ id: 'evt_f1', type: 'invoice.payment_failed', data: { object: fatura } });
  assert.equal(r.estado, 200);
  const f = await lerPlano('joao');
  assert.equal(f.estado, 'em_atraso');
  const aviso = Date.parse(f.aviso_ate);
  assert.ok(aviso >= Math.floor(antes / 1000) * 1000 + 15 * 86_400_000 && aviso <= Date.now() + 15 * 86_400_000, f.aviso_ate);
  const m = await planoRetido('joao');
  assert.equal(m.json.estado, 'em_atraso');
  assert.equal(m.json.aviso_ate, f.aviso_ate);
  // subscrição atualizada / nova falha (outro evento): mesma data de aviso
  await webhook({ id: 'evt_f2', type: 'customer.subscription.updated', data: { object: { id: 'sub_j1', object: 'subscription' } } });
  await webhook({ id: 'evt_f3', type: 'invoice.payment_failed', data: { object: { ...fatura, id: 'in_f2' } } });
  assert.equal((await lerPlano('joao')).aviso_ate, f.aviso_ate);
});

test('invoice.paid → ativo e linha no pagamentos.csv (com e sem IVA de 23 %)', async () => {
  falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status: 'active', preco: PRECOS.conforto, customer: 'cus_j', fim: 1_795_000_000 }));
  const fatura = {
    id: 'in_p1', object: 'invoice', customer: 'cus_j', amount_paid: 999, currency: 'eur',
    status_transitions: { paid_at: Date.parse('2026-11-01T00:30:00Z') / 1000 },
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_j1', metadata: { cliente: 'joao' } } },
    lines: { data: [{ pricing: { type: 'price_details', price_details: { price: PRECOS.conforto } } }] },
  };
  const r = await webhook({ id: 'evt_p1', type: 'invoice.paid', data: { object: fatura } });
  assert.equal(r.estado, 200);
  const f = await lerPlano('joao');
  assert.equal(f.estado, 'ativo');
  assert.equal(f.aviso_ate, null);
  assert.equal(f.proximo_pagamento, iso(new Date(1_795_000_000_000)));
  assert.equal((await planoRetido('joao')).json.estado, 'ativo');
  const csv = await readFile(join(mq.dados, 'pagamentos.csv'), 'utf8');
  assert.equal(csv, 'data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe\n2026-11-01;joao;conforto;9,99;8,12;in_p1\n');
  // repetido (mesmo evento) e o mesmo pagamento noutro evento: uma só linha
  assert.equal((await webhook({ id: 'evt_p1', type: 'invoice.paid', data: { object: fatura } })).corpo.resultado, 'repetido');
  await webhook({ id: 'evt_p1b', type: 'invoice.paid', data: { object: fatura } });
  assert.equal(await readFile(join(mq.dados, 'pagamentos.csv'), 'utf8'), csv);
});

test('fatura de 0 € no início do teste não conta como pagamento', async () => {
  falso.subs.set('sub_m1', subscricao({ id: 'sub_m1', cliente: 'maria', status: 'trialing', trialEnd: 1_792_000_000, preco: PRECOS.base, customer: 'cus_m' }));
  const r = await webhook({
    id: 'evt_m0', type: 'invoice.paid',
    data: { object: { id: 'in_m0', customer: 'cus_m', amount_paid: 0, subscription: 'sub_m1', subscription_details: { metadata: { cliente: 'maria' } } } },
  });
  assert.equal(r.estado, 200);
  assert.equal((await lerPlano('maria')).estado, 'teste', 'API antiga (invoice.subscription) também serve');
  assert.ok(!(await readFile(join(mq.dados, 'pagamentos.csv'), 'utf8')).includes('in_m0'));
});

test('checkout sem novo período de teste para quem já o usou; reutiliza o cliente Stripe', async () => {
  falso.subs.set('sub_m1', subscricao({ id: 'sub_m1', cliente: 'maria', status: 'canceled', preco: PRECOS.base, customer: 'cus_m' }));
  await webhook({ id: 'evt_m1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_m1', object: 'subscription' } } });
  assert.equal((await lerPlano('maria')).estado, 'cancelado');
  const t = await tokenDe('maria');
  const r = await post('/api/checkout', { plano: 'base' }, { token: t });
  assert.equal(r.estado, 200);
  const p = falso.pedidos.at(-1);
  assert.equal(p.caminho, '/v1/checkout/sessions');
  assert.equal(p.params['subscription_data[trial_period_days]'], undefined);
  assert.equal(p.params.customer, 'cus_m');
});

test('customer.subscription.deleted → cancelado (sem próximo pagamento)', async () => {
  falso.subs.set('sub_j1', subscricao({ id: 'sub_j1', status: 'canceled', preco: PRECOS.conforto, customer: 'cus_j' }));
  const r = await webhook({ id: 'evt_d1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_j1', object: 'subscription', metadata: { cliente: 'joao' } } } });
  assert.equal(r.estado, 200);
  const m = await planoRetido('joao');
  assert.equal(m.json.estado, 'cancelado');
  assert.equal(m.json.proximo_pagamento, null);
});

test('evento sem cliente conhecido é ignorado; preço desconhecido → 500 (o Stripe repete)', async () => {
  falso.subs.set('sub_z', subscricao({ id: 'sub_z', cliente: null, customer: 'cus_desconhecido' }));
  let r = await webhook({ id: 'evt_z', type: 'customer.subscription.updated', data: { object: { id: 'sub_z' } } });
  assert.equal(r.estado, 200);
  assert.equal(r.corpo.resultado, 'ignorado');
  falso.subs.set('sub_p', subscricao({ id: 'sub_p', cliente: 'joao', status: 'active', preco: 'price_outro', customer: 'cus_j' }));
  r = await webhook({ id: 'evt_p', type: 'customer.subscription.created', data: { object: { id: 'sub_p' } } });
  assert.equal(r.estado, 500);
  r = await webhook({ id: 'evt_outro', type: 'charge.succeeded', data: { object: { id: 'ch_1' } } });
  assert.equal(r.corpo.resultado, 'ignorado');
  r = await webhook({ id: 'evt_semsub', type: 'customer.subscription.updated', data: { object: { id: 'sub_naoexiste' } } });
  assert.equal(r.estado, 200, 'subscrição inexistente no Stripe: repetir não adianta');
  assert.equal(r.corpo.resultado, 'ignorado');
});

test('tarefa diária: em_atraso com aviso ultrapassado → suspenso (e publicado)', async () => {
  falso.subs.set('sub_j2', subscricao({ id: 'sub_j2', status: 'past_due', preco: PRECOS.base, customer: 'cus_j' }));
  await webhook({ id: 'evt_j2', type: 'customer.subscription.created', data: { object: { id: 'sub_j2' } } });
  const f = await lerPlano('joao');
  assert.equal(f.estado, 'em_atraso');
  const p = servico.pagamentos;
  assert.equal(await p.verificarAtrasos(), 0, 'ainda dentro do aviso');
  const relogio = p.relogio;
  p.relogio = () => new Date(Date.parse(f.aviso_ate) + 1000);
  try {
    assert.equal(await p.verificarAtrasos(), 1);
  } finally {
    p.relogio = relogio;
  }
  const g = await lerPlano('joao');
  assert.equal(g.estado, 'suspenso');
  assert.equal(g.proximo_pagamento, null);
  assert.equal((await planoRetido('joao')).json.estado, 'suspenso');
  // continua sem pagar → continua suspenso
  await webhook({ id: 'evt_j2b', type: 'invoice.payment_failed', data: { object: { id: 'in_j2', subscription: 'sub_j2', customer: 'cus_j', amount_paid: 0 } } });
  assert.equal((await lerPlano('joao')).estado, 'suspenso');
});

test('cliente suspenso (sincronizar-planos) ainda entra no /api para reativar', async () => {
  const out = await mq.domus('sincronizar-planos');
  assert.match(out, /ACL atualizada/);
  // já não lê o resto da árvore, mas lê o _plano
  assert.equal(await lerRetida(mq.url, 'joao', 'domus/joao/_aparelhos', 500), null);
  assert.equal((await planoRetido('joao')).json.estado, 'suspenso');
  const t = await novoToken('joao'); // sessão nova, já com a ACL de suspenso
  const r = await post('/api/portal', {}, { token: t });
  assert.equal(r.estado, 200);
  // paga → ativo
  falso.subs.set('sub_j2', subscricao({ id: 'sub_j2', status: 'active', preco: PRECOS.base, customer: 'cus_j' }));
  await webhook({ id: 'evt_j2c', type: 'invoice.paid', data: { object: { id: 'in_j2p', subscription: 'sub_j2', customer: 'cus_j', amount_paid: 499, status_transitions: { paid_at: 1_790_000_000 } } } });
  assert.equal((await lerPlano('joao')).estado, 'ativo');
  assert.match(await readFile(join(mq.dados, 'pagamentos.csv'), 'utf8'), /;joao;base;4,99;4,06;in_j2p\n$/);
  await mq.domus('sincronizar-planos');
  assert.ok(await lerRetida(mq.url, 'joao', 'domus/joao/_aparelhos', 1000), 'volta a ler a árvore');
});

test('gerido "manual" (domus.sh plano): eventos do Stripe não mudam o estado', async () => {
  await mq.domus('plano', 'maria', 'premium');
  const m = await planoRetido('maria');
  assert.deepEqual(Object.keys(m.json), ['plano', 'estado', 'desde', 'proximo_pagamento', 'aviso_ate', 'gerido']);
  assert.equal(m.json.gerido, 'manual');
  falso.subs.set('sub_m1', subscricao({ id: 'sub_m1', cliente: 'maria', status: 'past_due', preco: PRECOS.base, customer: 'cus_m' }));
  await webhook({ id: 'evt_mm', type: 'invoice.payment_failed', data: { object: { id: 'in_mm', subscription: 'sub_m1', customer: 'cus_m', amount_paid: 0 } } });
  const f = await lerPlano('maria');
  assert.equal(f.estado, 'ativo');
  assert.equal(f.plano, 'premium');
  assert.equal(f.stripe_cliente, 'cus_m', 'o domus.sh preserva o cliente Stripe');
});

test('arranque: republica o _plano de todos os ficheiros', async () => {
  await mkdir(join(mq.dados, 'planos'), { recursive: true });
  await writeFile(join(mq.dados, 'planos', 'ana.json'),
    '{"plano":"base","estado":"ativo","desde":"2026-10-01T10:00:00Z","proximo_pagamento":null,"aviso_ate":null,"gerido":"manual"}\n');
  const n = await servico.pagamentos.republicarTodos();
  assert.ok(n >= 3);
  const m = await lerRetida(mq.url, 'admin', 'domus/ana/_plano');
  assert.equal(m.texto, '{"plano":"base","estado":"ativo","desde":"2026-10-01T10:00:00Z","proximo_pagamento":null,"aviso_ate":null,"gerido":"manual"}');
  // um segundo serviço a arrancar também republica (retido)
  const outro = await arrancar(configPara(mq.url, mq.dados));
  await esperar(() => outro.s.publicador?.ligado);
  await outro.s.parar();
});

test('sem configuração do Stripe: sessão funciona, checkout/portal/webhook → 503', async () => {
  const cfg = configPara(mq.url, mq.dados, { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
  const { s, base: b } = await arrancar(cfg);
  try {
    const ses = await fetch(`${b}/api/sessao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: 'maria', password: SENHAS.maria }) });
    assert.equal(ses.status, 200);
    const { token } = await ses.json();
    const c = await fetch(`${b}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{"plano":"base"}' });
    assert.equal(c.status, 503);
    assert.equal((await c.json()).erro, 'Os pagamentos ainda não estão configurados neste servidor.');
    const w = await fetch(`${b}/stripe/webhook`, { method: 'POST', body: '{}' });
    assert.equal(w.status, 503);
  } finally {
    await s.parar();
  }
  const semNada = await arrancar({ ...configPara(mq.url, mq.dados), erros: ['falta SESSAO_SEGREDO'] });
  try {
    const r = await fetch(`${semNada.base}/api/sessao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 503);
  } finally {
    await semNada.s.parar();
  }
});

test('broker em baixo → sessão responde 503 (não 401)', async () => {
  const cfg = configPara('mqtt://127.0.0.1:1', mq.dados);
  const { s, base: b } = await arrancar(cfg);
  try {
    const r = await fetch(`${b}/api/sessao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: 'joao', password: SENHAS.joao }) });
    assert.equal(r.status, 503);
  } finally {
    await s.parar();
  }
});
