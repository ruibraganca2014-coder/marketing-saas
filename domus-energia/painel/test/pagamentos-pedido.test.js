// Pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md): 19 € ao enviar a simulação (o pedido só aparece no painel
// depois de pago), sucesso/falha/cancelar simulados, idempotência, valores do servidor, sinal = 30 % − 19 €,
// restante no fim da obra, acesso cruzado negado, expiração em 24 h, relatório libertado pelo CEO e o modo stripe
// (Stripe falso ao nível do fetch; webhook assinado; a página simulada não existe).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { painelComEquipa } from './ajuda.js';
import { calcularSinal, foraDaArea } from '../src/pagamentos-pedido.js';

const SIM = {
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' },
  divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1, sensores_porta: 1 }, { nome: 'Quarto', interruptores: [1] }],
  itens: [{ sku: 'INT-VIDRO-2', qtd: 1, preco_iva: 60 }, { sku: 'INT-VIDRO-1', qtd: 2, preco_iva: 50 }, { sku: 'BAB-CURTAIN', qtd: 1, preco_iva: 40 },
    { sku: 'SENS-PORTA-WIFI', qtd: 1, preco_iva: 20 }, { sku: 'TONGOU-SY2-JWT', qtd: 3, preco_iva: 30 }],
  mao_obra: { horas: 5, valor_iva: 175 }, deslocacao: { estado: 'estimada', valor_iva: 10 },
  total: { min: 900, max: 1200 }, plano_sugerido: 'conforto', quadro: { pacote: 'recomendado', circuitos: [{ codigo: 'C1' }] },
};
const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);

test('sinal = 30 % da proposta menos os 19 € já pagos (nunca negativo); área servida', () => {
  assert.equal(calcularSinal(100_000, 1900), 28_100);
  assert.equal(calcularSinal(100_000, 0), 30_000);
  assert.equal(calcularSinal(5000, 1900), 0);
  assert.equal(calcularSinal(33_333, 1900), 8100);
  const cfg = { deslocacao_base: 'Lisboa', deslocacao_max_km: 100 };
  assert.equal(foraDaArea('Sintra', cfg), false);
  assert.equal(foraDaArea('Funchal', cfg), true, 'ilha');
  assert.equal(foraDaArea('Bragança', cfg), true, 'longe');
  assert.equal(foraDaArea('uma aldeia qualquer', cfg), false, 'desconhecido: a visita confirma');
});

describe('modo simulado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  const nOrc = () => p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n;
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  async function enviar(c, extra = {}) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Pago', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', simulacao: SIM, ...extra } });
    assert.equal(r.estado, 202, r.texto);
    return r.json.pagamento;
  }
  const simular = (c, ref, resultado) => p.pedir('POST', `/api/conta/pagamentos/${ref}/simular`, { cookie: c.cookie, corpo: { resultado } });
  const ver = (c, ref, q = '') => p.pedir('GET', `/api/conta/pagamentos/${ref}${q}`, { cookie: c.cookie });

  async function pedidoPago(c) {
    const pg = await enviar(c);
    const r = await simular(c, pg.ref, 'sucesso');
    assert.equal(r.estado, 200, r.texto);
    return { ref: pg.ref, id: r.json.pagamento.orcamento_id };
  }

  test('enviar: 19 € calculados no servidor, "a aguardar pagamento" (não aparece no painel); falha → volta; sucesso → pedido recebido', async () => {
    const c = await p.contaConfirmada();
    const antes = nOrc();
    const novosAntes = (await painel('GET', 'resumo')).json.pedidos_novos;
    // O browser não escolhe o valor (campo desconhecido → 400).
    const x = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'A', telefone: '912 000 111', servico: 'S', simulacao: SIM, valor: 1 } });
    assert.equal(x.estado, 400);
    const pg = await enviar(c, { simulacao: { ...SIM, total: { min: 1, max: 2 } } });
    assert.equal(pg.valor, 19);
    assert.equal(pg.estado, 'pendente');
    assert.equal(pg.modo, 'simulado');
    assert.equal(pg.com_visita, true);
    assert.match(pg.descricao, /visita técnica \(19 € descontados na obra\)/);
    assert.equal(pg.url, `pagamento-simulado.html?ref=${pg.ref}`);
    assert.equal(nOrc(), antes, 'ainda não é um pedido do painel');
    assert.equal((await painel('GET', 'resumo')).json.pedidos_novos, novosAntes);
    // Clicar outra vez antes de pagar: o mesmo pagamento (não cria dois).
    assert.equal((await enviar(c)).ref, pg.ref);
    // Falha simulada: volta ao simulador com a simulação intacta; nada no painel; email "não concluído".
    const f = await simular(c, pg.ref, 'falha');
    assert.equal(f.estado, 200, f.texto);
    assert.equal(f.json.pagamento.estado, 'falhado');
    assert.equal(f.json.voltar, `simulador.html?pagamento=${pg.ref}`);
    assert.equal(nOrc(), antes);
    assert.match(p.emails.at(-1).texto, /não foi concluído/);
    assert.equal((await simular(c, pg.ref, 'sucesso')).estado, 409, 'um pagamento falhado não se paga');
    // Tentar de novo: pagamento novo; sucesso → pedido "novo" no painel, com a conta e o registo do pagamento.
    const pg2 = await enviar(c);
    assert.notEqual(pg2.ref, pg.ref);
    const ok = await simular(c, pg2.ref, 'sucesso');
    assert.equal(ok.json.pagamento.estado, 'pago');
    assert.equal(ok.json.pagamento.recibo.valor, 19);
    assert.equal(ok.json.pagamento.recibo.referencia, pg2.ref);
    assert.equal(ok.json.pagamento.recibo.simulado, true);
    const id = ok.json.pagamento.orcamento_id;
    assert.ok(id);
    assert.equal(nOrc(), antes + 1);
    const o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'novo');
    assert.equal(o.conta.email, c.email);
    assert.deepEqual(o.pagamentos.map((x) => [x.fase, x.valor, x.estado, x.modo]), [['relatorio', 19, 'pago', 'simulado']]);
    assert.ok(o.historico.some((h) => h.acao === 'orcamento_recebido' && h.detalhes.pagamento === pg2.ref));
    assert.ok(o.historico.some((h) => h.acao === 'pagamento_confirmado'));
    assert.equal((await painel('GET', 'resumo')).json.pedidos_novos, novosAntes + 1);
    assert.match(p.emails.at(-1).texto, /Recebemos o seu pagamento \(SIMULAÇÃO/);
    assert.match(p.emails.at(-1).texto, new RegExp(pg2.ref));
    // Fotos: o token vem no regresso (só para o pedido acabado de pagar) e funciona.
    const v = await ver(c, pg2.ref, '?fotos=1');
    assert.equal(v.json.pagamento.estado, 'pago');
    const fo = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': v.json.fotos_token, 'X-Foto-Chave': 'quadro', 'X-Foto-Legenda': 'Quadro' } });
    assert.equal(fo.estado, 201, fo.texto);
    // Sem ?fotos=1 não há token.
    assert.equal((await ver(c, pg2.ref)).json.fotos_token, undefined);
  });

  test('idempotência: pagar outra vez, o mesmo evento e sucesso repetido não duplicam', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviar(c);
    const ev = {
      id: 'evt_teste_repetido', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x', object: 'checkout.session', client_reference_id: pg.ref, amount_total: 1900, currency: 'eur', payment_status: 'paid' } },
    };
    const pag = p.app.api.pagamentosPedido;
    const antes = nOrc();
    assert.equal(pag.tratarEvento(ev), 'pago');
    assert.equal(pag.tratarEvento(ev), 'repetido');
    assert.equal(pag.tratarEvento({ ...ev, id: 'evt_teste_outro' }), 'repetido', 'outro evento, o mesmo pagamento');
    const r = await simular(c, pg.ref, 'sucesso');
    assert.equal(r.estado, 200, 'sucesso outra vez responde o mesmo');
    assert.equal(nOrc(), antes + 1, 'um só pedido');
    // Valor errado num evento: ignorado.
    const pg2 = await enviar(c);
    assert.equal(pag.tratarEvento({ ...ev, id: 'evt_valor', data: { object: { ...ev.data.object, client_reference_id: pg2.ref, amount_total: 100 } } }), 'ignorado');
    assert.equal((await ver(c, pg2.ref)).json.pagamento.estado, 'pendente');
    // Cancelar.
    const cn = await simular(c, pg2.ref, 'cancelar');
    assert.equal(cn.json.pagamento.estado, 'cancelado');
    assert.equal(nOrc(), antes + 1);
  });

  test('acesso cruzado: outra conta não vê nem paga (404); sem sessão 401; origem desconhecida 403', async () => {
    const a = await p.contaConfirmada();
    const b = await p.contaConfirmada();
    const pg = await enviar(a);
    assert.equal((await ver(b, pg.ref)).estado, 404);
    assert.equal((await simular(b, pg.ref, 'sucesso')).estado, 404);
    assert.equal((await p.pedir('GET', `/api/conta/pagamentos/${pg.ref}`)).estado, 401);
    assert.equal((await p.pedir('POST', `/api/conta/pagamentos/${pg.ref}/simular`, { cookie: a.cookie, corpo: { resultado: 'sucesso' }, site: false, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
    assert.equal((await ver(a, pg.ref)).json.pagamento.estado, 'pendente');
    const { id } = await pedidoPago(a);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: b.cookie, corpo: { fase: 'sinal' } })).estado, 404);
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: b.cookie })).estado, 404);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: b.cookie, corpo: { plano: 'base' } })).estado, 404);
  });

  test('proposta 1000 €: aceitar + plano → sinal 281 € ("aceite — a aguardar sinal"); pago → aceite; obra concluída → restante 700 €', async () => {
    const c = await p.contaConfirmada();
    const { id } = await pedidoPago(c);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1000, proposta_texto: 'Instalação completa.' })).estado, 200);
    // Sem plano: 400. Valor diferente: 409.
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000 } })).estado, 400);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 999, plano: 'base' } })).estado, 409);
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'conforto' } });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal(ac.json.pagamento.fase, 'sinal');
    assert.equal(ac.json.pagamento.valor, 281);
    assert.equal(ac.json.pagamento.plano, 'conforto');
    assert.equal(ac.json.pedido.aguarda_sinal, true);
    assert.equal(ac.json.pedido.sinal.valor, 281);
    let o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'proposta_enviada', 'só "aceite" depois do sinal');
    assert.equal(o.aguarda_sinal, true);
    assert.equal(o.plano_escolhido, 'conforto');
    // Aceitar outra vez: o mesmo sinal por pagar.
    const ac2 = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'conforto' } });
    assert.equal(ac2.json.pagamento.ref, ac.json.pagamento.ref);
    // Restante antes do tempo: 409.
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } })).estado, 409);
    assert.equal((await simular(c, ac.json.pagamento.ref, 'sucesso')).json.pagamento.estado, 'pago');
    o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'aceite');
    assert.equal(o.aguarda_sinal, false);
    assert.ok(o.historico.some((h) => h.acao === 'proposta_aceite_cliente'));
    assert.ok((await painel('GET', 'resumo')).json.propostas_aceites_online.some((x) => x.id === id));
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'sinal' } })).estado, 409, 'sinal já pago');
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } })).estado, 409, 'obra por concluir');
    let lista = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(lista.pode_pagar_restante, false);
    assert.equal(lista.restante.valor, 700);
    // O painel marca a obra concluída → "Pagar o restante" (700 €).
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 409);
    lista = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(lista.pode_pagar_restante, true);
    const rs = await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } });
    assert.equal(rs.estado, 200, rs.texto);
    assert.equal(rs.json.pagamento.valor, 700);
    assert.equal(rs.json.pagamento.url, `pagamento-simulado.html?ref=${rs.json.pagamento.ref}`);
    const fim = await simular(c, rs.json.pagamento.ref, 'sucesso');
    assert.equal(fim.json.voltar, `conta.html?pagamento=${rs.json.pagamento.ref}`);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } })).estado, 409);
    o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual(o.pagamentos.filter((x) => x.estado === 'pago').map((x) => [x.fase, x.valor]), [['relatorio', 19], ['sinal', 281], ['restante', 700]]);
    lista = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(lista.pagamentos.length, 3);
    assert.ok(lista.pagamentos.every((x) => x.estado === 'pago' && x.recibo));
  });

  test('a proposta muda com o sinal por pagar: o sinal sai e o cliente aceita de novo', async () => {
    const c = await p.contaConfirmada();
    const { id } = await pedidoPago(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
    await painel('POST', `orcamentos/${id}`, 'ceo', { valor_proposta: 2000 });
    assert.equal((await ver(c, ac.json.pagamento.ref)).json.pagamento.estado, 'cancelado');
    assert.equal((await simular(c, ac.json.pagamento.ref, 'sucesso')).estado, 409);
    const ac2 = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 2000, plano: 'base' } });
    assert.equal(ac2.json.pagamento.valor, 581);
  });

  test('relatório técnico: em revisão até o CEO o libertar; versão do cliente sem dados internos', async () => {
    const c = await p.contaConfirmada();
    const { id } = await pedidoPago(c);
    let l = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(l.relatorio, 'em_revisao');
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'comercial', {})).estado, 403);
    const lib = await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {});
    assert.equal(lib.estado, 200, lib.texto);
    assert.ok(lib.json.relatorio_libertado);
    assert.match(p.emails.at(-1).texto, /relatório técnico/);
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 409);
    l = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(l.relatorio, 'disponivel');
    const r = await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie });
    assert.equal(r.estado, 200, r.texto);
    const rel = r.json.relatorio;
    assert.deepEqual(rel.divisoes.map((d) => d.nome), ['Sala', 'Quarto']);
    const sala = rel.divisoes[0];
    assert.ok(sala.trabalho.some((t) => /2 interruptores/.test(t)));
    assert.equal(sala.total, 60 + 50 + 40 + 20);
    assert.equal(rel.divisoes[1].total, 50);
    assert.equal(rel.geral.material.length, 1, 'o que não é de nenhuma divisão (quadro)');
    assert.equal(rel.geral.total, 90);
    assert.equal(rel.total, 170 + 50 + 90 + 175 + 10);
    assert.doesNotMatch(r.texto, /fornecedor|preco_compra|link|circuito/i);
  });

  test('expiração: por pagar há 24 h → expirado (o pedido guardado sai); não se paga', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviar(c);
    p.relogio.avancar(24 * 3600_000 + 1000);
    try {
      const v = await ver(c, pg.ref);
      assert.equal(v.json.pagamento.estado, 'expirado');
      assert.equal(p.app.db.prepare('SELECT pedido FROM pagamentos_pedido WHERE ref = ?').get(pg.ref).pedido, null);
      assert.equal((await simular(c, pg.ref, 'sucesso')).estado, 409);
      // Enviar outra vez cria um pagamento novo.
      assert.notEqual((await enviar(c)).ref, pg.ref);
    } finally {
      p.relogio.avancar(-(24 * 3600_000 + 1000));
    }
  });

  test('fora da área: paga 19 € só pelo relatório (sem visita)', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviar(c, { localidade: 'Funchal' });
    assert.equal(pg.valor, 19);
    assert.equal(pg.com_visita, false);
    assert.match(pg.descricao, /sem visita/);
  });

  test('apagar a conta (RGPD): pagamentos por pagar saem; os pagos ficam sem conta nem pedido', async () => {
    const c = await p.contaConfirmada();
    await pedidoPago(c);
    const pend = await enviar(c);
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `contas/${contaId}/apagar`, 'ceo', {})).estado, 200);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE ref = ?').get(pend.ref).n, 0);
    const pagos = p.app.db.prepare('SELECT * FROM pagamentos_pedido WHERE conta_id IS NULL AND orcamento_id IS NULL AND estado = \'pago\'').all();
    assert.ok(pagos.length >= 1);
    assert.ok(pagos.every((x) => x.pedido === null));
  });
});

describe('modo stripe', () => {
  let p;
  const chamadas = [];
  const SEGREDO = 'whsec_teste_123';
  const fetchStripe = async (url, op) => {
    chamadas.push({ url, op });
    const params = new URLSearchParams(op.body ?? '');
    if (/checkout\/sessions$/.test(url)) {
      return new Response(JSON.stringify({ id: `cs_test_${chamadas.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${chamadas.length}`, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) }), { status: 200 });
    }
    const m = /checkout\/sessions\/(cs_test_\d+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], object: 'checkout.session', status: 'open', payment_status: 'unpaid', amount_total: 1900, currency: 'eur' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  before(async () => {
    p = await painelComEquipa({ fetchStripe, env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: SEGREDO, SITE_URL: 'https://site.teste' } });
  });
  after(() => p.fechar());

  const assinar = (corpo, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', SEGREDO).update(`${t}.${corpo}`).digest('hex')}`;
  const webhook = (ev, assinatura) => {
    const corpo = JSON.stringify(ev);
    return p.pedir('POST', '/api/conta/pagamentos/stripe-webhook', { corpo, site: false, cabecalhos: { 'Stripe-Signature': assinatura ?? assinar(corpo) } });
  };

  test('Checkout com cartão/MB Way/Multibanco; a página simulada não existe; webhook assinado confirma (uma vez)', async () => {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', localidade: 'Sintra', simulacao: SIM } });
    assert.equal(r.estado, 202, r.texto);
    const pg = r.json.pagamento;
    assert.equal(pg.modo, 'stripe');
    assert.match(pg.url, /^https:\/\/checkout\.stripe\.com\//);
    const criar = new URLSearchParams(chamadas.at(-1).op.body);
    assert.equal(criar.get('line_items[0][price_data][unit_amount]'), '1900');
    assert.equal(criar.get('client_reference_id'), pg.ref);
    assert.deepEqual(['0', '1', '2'].map((i) => criar.get(`payment_method_types[${i}]`)), ['card', 'mb_way', 'multibanco']);
    assert.equal(criar.get('success_url'), `https://site.teste/simulador.html?pagamento=${pg.ref}`);
    assert.equal(chamadas.at(-1).op.headers['Idempotency-Key'], `domus-${pg.ref}`);
    // A página simulada não serve no modo stripe.
    assert.equal((await p.pedir('POST', `/api/conta/pagamentos/${pg.ref}/simular`, { cookie: c.cookie, corpo: { resultado: 'sucesso' } })).estado, 404);
    const sessao = p.app.db.prepare('SELECT stripe_sessao FROM pagamentos_pedido WHERE ref = ?').get(pg.ref).stripe_sessao;
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: sessao, object: 'checkout.session', client_reference_id: pg.ref, amount_total: 1900, currency: 'eur', payment_status: 'paid' } } };
    assert.equal((await webhook(ev, 't=1,v1=00')).estado, 400, 'assinatura inválida');
    const antes = p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n;
    const w = await webhook(ev);
    assert.equal(w.estado, 200, w.texto);
    assert.equal(w.json.resultado, 'pago');
    assert.equal((await webhook(ev)).json.resultado, 'repetido');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n, antes + 1);
    // Sessão de outro pagamento (não corresponde): ignorada.
    const r2 = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', simulacao: SIM } });
    const ev2 = { ...ev, id: 'evt_2', data: { object: { ...ev.data.object, client_reference_id: r2.json.pagamento.ref } } };
    assert.equal((await webhook(ev2)).json.resultado, 'ignorado');
    // Regresso ao site: lê a sessão no Stripe (ainda aberta → continua por pagar).
    const v = await p.pedir('GET', `/api/conta/pagamentos/${r2.json.pagamento.ref}`, { cookie: c.cookie });
    assert.equal(v.json.pagamento.estado, 'pendente');
  });

  test('sem webhook no modo simulado', async () => {
    const q = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } });
    try {
      assert.equal((await q.pedir('POST', '/api/conta/pagamentos/stripe-webhook', { corpo: '{}', site: false })).estado, 404);
    } finally { await q.fechar(); }
  });
});
