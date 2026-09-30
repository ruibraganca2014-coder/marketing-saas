// Pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md): 19 € ao enviar a simulação (o pedido só aparece no painel
// depois de pago), sucesso/falha/cancelar simulados, idempotência, valores do servidor, sinal = 30 % − 19 €,
// restante no fim da obra, acesso cruzado negado, expiração em 24 h, relatório libertado pelo CEO e o modo stripe
// (Stripe falso ao nível do fetch; webhook assinado; a página simulada não existe).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { painelComEquipa } from './ajuda.js';
import { calcularSinal, foraDaArea, comIva, partirIva, deslocacaoServidor } from '../src/pagamentos-pedido.js';
import { lerConfig } from '../src/config.js';
import { calcularPreco, cent as centSim } from '../../web/simulador/preco.js';

const SIM = {
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' },
  divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1, sensores_porta: 1 }, { nome: 'Quarto', interruptores: [1] }],
  itens: [{ sku: 'INT-VIDRO-2', qtd: 1, preco_iva: 60 }, { sku: 'INT-VIDRO-1', qtd: 2, preco_iva: 50 }, { sku: 'BAB-CURTAIN', qtd: 1, preco_iva: 40 },
    { sku: 'SENS-PORTA-WIFI', qtd: 1, preco_iva: 20 }, { sku: 'TONGOU-SY2-JWT', qtd: 3, preco_iva: 30 }],
  mao_obra: { horas: 5, valor_iva: 175 }, deslocacao: { estado: 'estimada', valor_iva: 10 },
  total: { min: 900, max: 1200 }, plano_sugerido: 'conforto', quadro: { pacote: 'recomendado', circuitos: [{ codigo: 'C1' }] },
};
const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);

test('sinal = 30 % da proposta COM IVA menos os 19 € já pagos (nunca negativo); IVA; área servida e deslocação', () => {
  // Decisão do dono: 1000 € + IVA 23 % = 1230 €; sinal = 30 % × 1230 − 19 = 350 €; restante = 1230 − 19 − 350 = 861 €.
  assert.equal(comIva(100_000, 23), 123_000);
  assert.equal(calcularSinal(comIva(100_000, 23), 1900), 35_000);
  assert.equal(comIva(100_000, 23) - 1900 - 35_000, 86_100);
  assert.deepEqual(partirIva(1900, 23), { base: 1545, iva: 355 });
  assert.deepEqual(partirIva(86_100, 23), { base: 70_000, iva: 16_100 });
  assert.equal(calcularSinal(100_000, 1900), 28_100);
  assert.equal(calcularSinal(100_000, 0), 30_000);
  assert.equal(calcularSinal(5000, 1900), 0);
  assert.equal(calcularSinal(33_333, 1900), 8100);
  const cfg = { deslocacao_base: 'Lisboa', deslocacao_max_km: 100 };
  assert.equal(foraDaArea('Sintra', cfg), false);
  assert.equal(foraDaArea('Funchal', cfg), true, 'ilha');
  assert.equal(foraDaArea('Bragança', cfg), true, 'longe');
  assert.equal(foraDaArea('uma aldeia qualquer', cfg), false, 'desconhecido: a visita confirma');
  const cd = { ...cfg, deslocacao_iva: 5, deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4 };
  assert.equal(deslocacaoServidor('Sintra', cd), 8.6, '5 + (29 − 20) × 0,40');
  assert.equal(deslocacaoServidor('uma aldeia qualquer', cd), 5, 'só o fixo');
  assert.equal(deslocacaoServidor('Funchal', cd), null, 'fora da área: não soma');
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
    assert.match(p.emails.at(-1).texto, /Data: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/, 'data com o ano em 4 algarismos (hora de Lisboa)');
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

  test('proposta 1000 € + IVA 23 % = 1230 €: aceitar + plano → sinal 350 € ("aceite — a aguardar sinal"); pago → aceite; obra concluída → restante 861 €', async () => {
    const c = await p.contaConfirmada();
    const { id } = await pedidoPago(c);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1000, proposta_texto: 'Instalação completa.' })).estado, 200);
    // Sem plano: 400. Valor diferente: 409.
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000 } })).estado, 400);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 999, plano: 'base' } })).estado, 409);
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'conforto' } });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal(ac.json.pagamento.fase, 'sinal');
    assert.equal(ac.json.pagamento.valor, 350);
    assert.equal(ac.json.pagamento.iva_pct, 23);
    assert.equal(ac.json.pagamento.base, 284.55);
    assert.equal(ac.json.pagamento.iva, 65.45);
    assert.match(ac.json.pagamento.descricao, /1230,00 € com IVA/);
    assert.equal(ac.json.pagamento.plano, 'conforto');
    assert.equal(ac.json.pedido.aguarda_sinal, true);
    assert.equal(ac.json.pedido.sinal.valor, 350);
    assert.deepEqual(ac.json.pedido.proposta_iva, { base: 1000, iva_pct: 23, iva: 230, total: 1230 });
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
    assert.equal(lista.restante.valor, 861);
    // O painel marca a obra concluída → "Pagar o restante" (700 €).
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 409);
    assert.match(p.emails.at(-1).texto, /861,00 €, com IVA/);
    assert.match(p.emails.at(-1).texto, /1000,00 € \+ IVA 23 % \(230,00 €\) = 1230,00 €/);
    assert.deepEqual((await painel('GET', `orcamentos/${id}`)).json.valores_pagamento, { proposta: 1000, iva_pct: 23, iva: 230, total: 1230, relatorio: 19, sinal: 350, restante: 861 });
    lista = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(lista.pode_pagar_restante, true);
    const rs = await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } });
    assert.equal(rs.estado, 200, rs.texto);
    assert.equal(rs.json.pagamento.valor, 861);
    assert.equal(rs.json.pagamento.url, `pagamento-simulado.html?ref=${rs.json.pagamento.ref}`);
    const fim = await simular(c, rs.json.pagamento.ref, 'sucesso');
    assert.equal(fim.json.voltar, `conta.html?pagamento=${rs.json.pagamento.ref}`);
    // Recibo e email com a base e o IVA.
    assert.deepEqual([fim.json.pagamento.recibo.base, fim.json.pagamento.recibo.iva, fim.json.pagamento.recibo.valor], [700, 161, 861]);
    assert.match(p.emails.at(-1).texto, /Valor: 861,00 € \(700,00 € \+ IVA 23 % 161,00 €\)/);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } })).estado, 409);
    o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual(o.pagamentos.filter((x) => x.estado === 'pago').map((x) => [x.fase, x.valor]), [['relatorio', 19], ['sinal', 350], ['restante', 861]]);
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
    assert.equal(ac2.json.pagamento.valor, 719, '30 % × 2460 − 19');
  });

  const precoCat = (sku) => p.app.db.prepare('SELECT preco_venda_iva_cent FROM catalogo WHERE sku = ?').get(sku).preco_venda_iva_cent / 100;
  const horasCat = (sku, troca = false) => {
    const a = p.app.db.prepare('SELECT horas_instalacao, horas_troca FROM catalogo WHERE sku = ?').get(sku);
    return troca ? (a.horas_troca ?? a.horas_instalacao * 0.5) : a.horas_instalacao;
  };
  const cent = (x) => Math.round(x * 100) / 100;

  test('relatório técnico: em revisão até o CEO o libertar (com pré-visualização); versão do cliente sem dados internos e com os preços do CATÁLOGO', async () => {
    const c = await p.contaConfirmada();
    // O browser manda preços absurdos: o relatório usa os do catálogo do servidor.
    const barato = { ...SIM, itens: SIM.itens.map((i) => ({ ...i, preco_iva: 1 })), mao_obra: { horas: 1, valor_iva: 1 }, deslocacao: { estado: 'estimada', valor_iva: 1 } };
    const pg = await enviar(c, { simulacao: barato });
    const id = (await simular(c, pg.ref, 'sucesso')).json.pagamento.orcamento_id;
    let l = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(l.relatorio, 'em_revisao');
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).estado, 409);
    // O CEO pré-visualiza a versão do cliente antes de libertar (o comercial não).
    const previa = await painel('GET', `orcamentos/${id}/relatorio-cliente`);
    assert.equal(previa.estado, 200, previa.texto);
    assert.equal((await painel('GET', `orcamentos/${id}/relatorio-cliente`, 'comercial')).estado, 403);
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
    assert.deepEqual({ ...previa.json.relatorio, libertado: null }, { ...rel, libertado: null }, 'a pré-visualização é o que o cliente vê');
    assert.deepEqual(rel.divisoes.map((d) => d.nome), ['Sala', 'Quarto']);
    const sala = rel.divisoes[0];
    assert.ok(sala.trabalho.some((t) => /Novo: 2 interruptores/.test(t)), 'pedido antigo (sem ações): tudo Novo');
    assert.equal(sala.total, cent(precoCat('INT-VIDRO-2') + precoCat('INT-VIDRO-1') + precoCat('BAB-CURTAIN') + precoCat('SENS-PORTA-WIFI')));
    assert.equal(rel.divisoes[1].total, precoCat('INT-VIDRO-1'));
    assert.equal(rel.geral.material.length, 1, 'o que não é de nenhuma divisão (quadro)');
    assert.equal(rel.geral.total, cent(3 * precoCat('TONGOU-SY2-JWT')));
    const horas = cent(horasCat('INT-VIDRO-2') + 2 * horasCat('INT-VIDRO-1') + horasCat('BAB-CURTAIN') + horasCat('SENS-PORTA-WIFI') + 3 * horasCat('TONGOU-SY2-JWT'));
    assert.deepEqual(rel.mao_obra, { horas, valor: cent(horas * 38) }, 'horas do catálogo × tarifa da configuração');
    assert.equal(rel.deslocacao, 3.6, 'Sintra: (29 − 20 km) × 0,40 €');
    assert.equal(rel.total, cent(sala.total + rel.divisoes[1].total + rel.geral.total + rel.mao_obra.valor + rel.deslocacao));
    assert.doesNotMatch(r.texto, /fornecedor|preco_compra|link|circuito/i);
  });

  test('relatório do cliente: lista de trabalho por divisão e ação (Reparar/Substituir/Novo, avarias), Manter só contado', async () => {
    const c = await p.contaConfirmada();
    const SIM_T = {
      ...SIM, servico: ['automatizar', 'reparar'], divisoes: [{ nome: 'Cozinha' }],
      trabalho: [{ divisao: 'd1', nome: 'Cozinha', piso: 0, acoes: [
        { acao: 'manter', tipo: 'luz', modelo: null, qtd: 3, material: [], horas: 0, foto: null },
        { acao: 'reparar', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'DIAG-AVARIA', qtd: 1 }], horas: 0.5, foto: 'd1:tomada', avarias: ['queimada'] },
        { acao: 'substituir', tipo: 'interruptor', modelo: null, qtd: 2, material: [{ sku: 'INT-VIDRO-1', qtd: 2 }], horas: 0.5, foto: null, inteligentes: 2 },
        { acao: 'novo', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'TOMADA-WIFI', qtd: 1 }], horas: 0.3, foto: null },
      ] }],
      totais_acao: { manter: { aparelhos: 3 }, reparar: { aparelhos: 1, artigos_iva: 99999, horas: 1 }, substituir: { aparelhos: 2 }, novo: { aparelhos: 1 } },
      itens: [{ sku: 'DIAG-AVARIA', qtd: 1, preco_iva: 1, grupo: 'reparar' }, { sku: 'INT-VIDRO-1', qtd: 2, preco_iva: 1, grupo: 'substituir' },
        { sku: 'TOMADA-WIFI', qtd: 1, preco_iva: 1 }, { sku: 'TONGOU-SY2-JWT', qtd: 1, preco_iva: 1, grupo: 'quadro' }],
    };
    const pg = await enviar(c, { simulacao: SIM_T });
    const id = (await simular(c, pg.ref, 'sucesso')).json.pagamento.orcamento_id;
    const rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.deepEqual(rel.acoes, { manter: 3, reparar: 1, substituir: 2, novo: 1 });
    assert.equal(rel.divisoes.length, 1);
    const coz = rel.divisoes[0];
    assert.equal(coz.nome, 'Cozinha');
    assert.deepEqual(coz.trabalho, ['Reparar: 1 tomada («queimada»; ver foto)', 'Substituir: 2 interruptores por inteligentes (sem foto)', 'Novo: 1 tomada']);
    assert.deepEqual(coz.material.map((m) => [m.quantidade, m.preco_unitario]), [[1, precoCat('DIAG-AVARIA')], [2, precoCat('INT-VIDRO-1')], [1, precoCat('TOMADA-WIFI')]]);
    assert.deepEqual(rel.geral.material.map((m) => m.quantidade), [1], 'o quadro à parte');
    const horas = cent(horasCat('DIAG-AVARIA') + 2 * horasCat('INT-VIDRO-1', true) + horasCat('TOMADA-WIFI') + horasCat('TONGOU-SY2-JWT'));
    assert.equal(rel.mao_obra.horas, horas, 'ao substituir, as horas de troca');
    assert.doesNotMatch(JSON.stringify(rel), /99999/, 'nada dos totais do browser');
  });

  test('relatório do cliente (fase 2): margem dos pacotes das Melhorias pelo catálogo e pela configuração (não a do browser), no total', async () => {
    const c = await p.contaConfirmada();
    const MEL = [
      { id: 'seguranca', nome: 'Segurança', itens: [{ sku: 'SENS-PORTA-WIFI', qtd: 2 }, { sku: 'SENS-PIR-WIFI', qtd: 1 }, { sku: 'SENS-AGUA-WIFI', qtd: 2 }], preco: 1 },
      { id: 'casa-inteligente', nome: 'Casa inteligente', itens: [{ sku: 'BAB-MOD-2CH', qtd: 3 }, { sku: 'TOMADA-WIFI', qtd: 2 }], preco: 1 },
      { id: 'seguranca', nome: 'Repetida', itens: [{ sku: 'SENS-AGUA-WIFI', qtd: 999 }], preco: 1 },
    ];
    const extra = MEL.slice(0, 2).flatMap((m) => m.itens.map((i) => ({ ...i, preco_iva: 1, grupo: 'melhoria' })));
    const sim = { ...SIM, itens: [...SIM.itens, ...extra], melhorias: MEL.slice(0, 2), melhorias_margem_iva: 0.01 };
    const pg = await enviar(c, { simulacao: sim });
    const id = (await simular(c, pg.ref, 'sucesso')).json.pagamento.orcamento_id;
    // A repetida (que o validador não deixa enviar) só se testa direto na linha guardada.
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify({ ...sim, melhorias: MEL, melhorias_margem_iva: 99999 }), id);
    // O que o simulador calcula (melhorias.js calcularMelhorias): (material + horas × tarifa) × margem, por pacote.
    const catalogo = p.app.db.prepare('SELECT sku, preco_venda_iva_cent, horas_instalacao FROM catalogo').all()
      .map((a) => ({ sku: a.sku, preco_venda_iva: a.preco_venda_iva_cent / 100, horas_instalacao: a.horas_instalacao }));
    const CHAVE = { 'SENS-PORTA-WIFI': 'sensor_porta', 'SENS-PIR-WIFI': 'sensor_movimento', 'SENS-AGUA-WIFI': 'sensor_agua', 'BAB-MOD-2CH': 'modulo_interruptor', 'TOMADA-WIFI': 'tomada' };
    const margemSim = (pct) => centSim(MEL.slice(0, 2).reduce((t, m) => {
      const pr = calcularPreco(m.itens.map((i) => ({ chave: CHAVE[i.sku], qtd: i.qtd, grupo: 'melhoria' })), catalogo, {}, { valor_iva: 0 });
      const custo = centSim(pr.artigos_iva + pr.mao_obra_iva);
      return t + centSim(centSim(custo * (1 + pct / 100)) - custo);
    }, 0));
    let rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.deepEqual(rel.melhorias, ['Segurança', 'Casa inteligente'], 'sem repetidos');
    assert.ok(margemSim(20) > 0);
    assert.equal(rel.margem_pacotes, margemSim(20), 'margem_pacotes_pct = 20 (migração 13)');
    const semMargem = cent(rel.divisoes.reduce((t, d) => t + d.total, 0) + rel.geral.total + rel.mao_obra.valor + rel.deslocacao);
    assert.equal(rel.total, cent(semMargem + rel.margem_pacotes), 'no total');
    assert.doesNotMatch(JSON.stringify(rel), /99999/);
    // A margem é a da configuração do servidor.
    p.app.db.prepare('UPDATE config_orcamento SET valor = ? WHERE chave = ?').run(30, 'margem_pacotes_pct');
    try {
      rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
      assert.equal(rel.margem_pacotes, margemSim(30));
    } finally {
      p.app.db.prepare('UPDATE config_orcamento SET valor = ? WHERE chave = ?').run(20, 'margem_pacotes_pct');
    }
    // "Quadro seguro" com o quadro no pedido: conta a diferença do quadro (`quadro_delta`; o que sai desconta), não os itens.
    const QS = { id: 'quadro-seguro', nome: 'Quadro seguro', itens: [{ sku: 'RCBO-WIFI-TOSMR1', qtd: 2 }, { sku: 'GERAL-WIFI-2P-63A', qtd: 1 }], preco: 1,
      quadro_delta: [{ sku: 'IDR-2P-40A-30MA', qtd: -2 }, { sku: 'GERAL-2P-63A', qtd: -1 }, { sku: 'RCBO-WIFI-TOSMR1', qtd: 2 }, { sku: 'GERAL-WIFI-2P-63A', qtd: 1 }] };
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify({ ...sim, melhorias: [QS] }), id);
    rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    const custoDe = (l) => { const pr = calcularPreco(l, catalogo, {}, { valor_iva: 0 }); return centSim(pr.artigos_iva + pr.mao_obra_iva); };
    const CH = { 'IDR-2P-40A-30MA': 'diferencial', 'GERAL-2P-63A': 'disjuntor_geral', 'RCBO-WIFI-TOSMR1': 'diferencial_wifi', 'GERAL-WIFI-2P-63A': 'geral_wifi' };
    const linhasQs = (f) => QS.quadro_delta.filter(f).map((i) => ({ chave: CH[i.sku], qtd: Math.abs(i.qtd) }));
    const custoQs = centSim(custoDe(linhasQs((i) => i.qtd > 0)) - custoDe(linhasQs((i) => i.qtd < 0)));
    assert.ok(custoQs > 0 && custoQs < custoDe(linhasQs((i) => i.qtd > 0)));
    assert.ok(Math.abs(rel.margem_pacotes - centSim(centSim(custoQs * 1.2) - custoQs)) <= 0.01, `${rel.margem_pacotes} ≈ 20 % de ${custoQs}`);
    // Sem melhorias (pedidos antigos): sem a linha.
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify(SIM), id);
    rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.equal(rel.margem_pacotes, null);
    assert.deepEqual(rel.melhorias, []);
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

  test('apagar a conta (RGPD): pedido com pagamentos pagos é ANONIMIZADO (pagamentos ligados, CSV); por pagar saem', async () => {
    const c = await p.contaConfirmada();
    const { id } = await pedidoPago(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000, notas: 'Ligar ao Sr. X', proposta_texto: 'Automatizar a sala.' });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
    await simular(c, ac.json.pagamento.ref, 'sucesso');
    await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {});
    const rs = await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'restante' } });
    await simular(c, rs.json.pagamento.ref, 'sucesso');
    const pend = await enviar(c);
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    const r = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedidos_anonimizados, 1);
    assert.equal(r.json.pedidos_apagados, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE ref = ?').get(pend.ref).n, 0, 'o por pagar sai');
    const o = p.app.db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
    assert.ok(o, 'o pedido fica');
    assert.ok(o.anonimizado);
    assert.equal(o.nome, 'Anonimizado (RGPD)');
    for (const k of ['telefone', 'email', 'localidade', 'morada', 'mensagem', 'notas', 'simulacao', 'conta_id']) assert.equal(o[k], null, k);
    assert.equal(o.valor_proposta_cent, 100_000, 'os valores ficam');
    assert.equal(o.proposta_texto, 'Automatizar a sala.', 'a descrição fica');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(id).n, 0);
    const pagos = p.app.db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? ORDER BY id').all(id);
    assert.deepEqual(pagos.map((x) => [x.fase, x.estado, x.conta_id, x.pedido]), [['relatorio', 'pago', null, null], ['sinal', 'pago', null, null], ['restante', 'pago', null, null]]);
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(c.email), 'o email não fica na auditoria');
    // Lista global (só CEO) e CSV: data, referência, descrição, base, IVA, total, estado, pedido.
    const g = await painel('GET', 'pagamentos-pedido?estado=pago');
    assert.equal(g.estado, 200, g.texto);
    const doPedido = g.json.pagamentos.filter((x) => x.orcamento_id === id);
    assert.deepEqual(doPedido.map((x) => [x.fase, x.valor, x.base, x.iva]).sort(), [['relatorio', 19, 15.45, 3.55], ['restante', 861, 700, 161], ['sinal', 350, 284.55, 65.45]]);
    assert.equal((await painel('GET', 'pagamentos-pedido', 'comercial')).estado, 403);
    const csv = await painel('GET', 'pagamentos-pedido?formato=csv');
    assert.equal(csv.estado, 200);
    const linhas = csv.texto.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(linhas[0], 'data;referencia;descricao;base;iva;total;estado;pedido');
    assert.ok(linhas.some((x) => x.includes(rs.json.pagamento.ref) && x.endsWith(`;700,00;161,00;861,00;pago;${id}`)));
    // O pedido anonimizado continua no painel, sem dados pessoais nem conta.
    const fic = (await painel('GET', `orcamentos/${id}`)).json;
    assert.ok(fic.anonimizado);
    assert.equal(fic.conta, null);
    assert.equal(fic.pagamentos.filter((x) => x.estado === 'pago').length, 3);
  });

  test('RGPD: o pedido anonimizado passa a "arquivado": fora do quadro, das listas e dos novos; só o CEO o vê; não muda', async () => {
    const c = await p.contaConfirmada();
    const { id, ref } = await pedidoPago(c);
    const novosAntes = (await painel('GET', 'resumo')).json.pedidos_novos;
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    const r = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email });
    assert.equal(r.json.pedidos_anonimizados, 1, r.texto);
    assert.equal(p.app.db.prepare('SELECT estado FROM orcamentos WHERE id = ?').get(id).estado, 'arquivado');
    // Fora da lista normal (quadro e listas), dos novos e das contagens por estado.
    assert.ok(!(await painel('GET', 'orcamentos')).json.orcamentos.some((o) => o.id === id));
    assert.equal((await painel('GET', 'resumo')).json.pedidos_novos, novosAntes - 1);
    const rc = (await painel('GET', 'resumo', 'comercial')).json;
    assert.equal(rc.orcamentos_por_estado.arquivado, undefined);
    assert.ok(!(await painel('GET', 'orcamentos', 'comercial')).json.orcamentos.some((o) => o.id === id));
    // Filtro "Arquivados": só o CEO.
    const arq = await painel('GET', 'orcamentos?estado=arquivado');
    assert.equal(arq.estado, 200, arq.texto);
    assert.ok(arq.json.orcamentos.some((o) => o.id === id && o.estado === 'arquivado'));
    assert.equal((await painel('GET', 'orcamentos?estado=arquivado', 'comercial')).estado, 403);
    assert.equal((await painel('GET', `orcamentos/${id}`)).json.estado, 'arquivado');
    assert.equal((await painel('GET', `orcamentos/${id}`, 'comercial')).estado, 404);
    // Não muda: nem o estado, nem os dados, nem as ações.
    for (const corpo of [{ estado: 'novo' }, { notas: 'x' }, { nome: 'Outro' }]) {
      const m = await painel('POST', `orcamentos/${id}`, 'ceo', corpo);
      assert.equal(m.estado, 409, JSON.stringify(corpo));
    }
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {})).estado, 409);
    assert.equal(p.app.db.prepare('SELECT estado FROM orcamentos WHERE id = ?').get(id).estado, 'arquivado');
    // Nenhum pedido passa a "arquivado" à mão.
    const outro = (await pedidoPago(await p.contaConfirmada())).id;
    assert.equal((await painel('POST', `orcamentos/${outro}`, 'ceo', { estado: 'arquivado' })).estado, 400);
    // Continua nos pagamentos e no CSV.
    assert.ok((await painel('GET', 'pagamentos-pedido')).json.pagamentos.some((x) => x.orcamento_id === id && x.ref === ref));
    assert.ok((await painel('GET', 'pagamentos-pedido?formato=csv')).texto.split('\r\n').some((x) => x.includes(ref) && x.endsWith(`;pago;${id}`)));
  });

  test('retentativas: pagar outra vez depois de falhar/cancelar não gasta o limite de pedidos por IP', async () => {
    const c = await p.contaConfirmada();
    const ip = '198.51.100.23';
    let pg = null;
    for (let i = 0; i < 8; i++) {
      const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, ip, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', localidade: 'Sintra', simulacao: SIM } });
      assert.equal(r.estado, 202, `tentativa ${i + 1}: ${r.texto}`);
      pg = r.json.pagamento;
      assert.equal((await simular(c, pg.ref, i % 2 ? 'cancelar' : 'falha')).estado, 200);
    }
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE ref = ? AND pedido IS NULL').get(pg.ref).n, 1, 'o pedido guardado sai ao falhar/cancelar');
    // Outra pessoa no mesmo IP continua a poder enviar (o limite por IP não foi gasto).
    const d = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: d.cookie, ip, corpo: { nome: 'Outro', telefone: '912 000 112', servico: 'S', localidade: 'Sintra', simulacao: SIM } });
    assert.equal(r.estado, 202, r.texto);
  });

  test('IVA configurável no painel (iva_pct): a proposta de 1000 € com 6 % → sinal 30 % × 1060 − 19 = 299 €', async () => {
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 6 })).estado, 200);
    try {
      const c = await p.contaConfirmada();
      const { id } = await pedidoPago(c);
      await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
      const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
      assert.equal(ac.json.pagamento.valor, 299);
      assert.equal(ac.json.pagamento.iva_pct, 6);
      assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 51 })).estado, 400);
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 23 });
    }
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

  test('modo: sem PAGAMENTOS_MODO nem chave → pagamentos DESLIGADOS (envia sem pagar, aviso no painel); simulado só explícito (faixa de demonstração); só a chave → stripe', async () => {
    const semNada = lerConfig({ PAGAMENTO_PEDIDO: '1' });
    assert.equal(semNada.pagamentoPedido, false);
    assert.equal(semNada.pagamentosDesligadosSemModo, true);
    assert.ok(semNada.avisos.some((a) => /DESLIGADOS/.test(a)));
    assert.equal(lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }).pagamentosModo, 'stripe');
    assert.equal(lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }).pagamentoPedido, true);
    assert.equal(lerConfig({ PAGAMENTOS_MODO: 'simulado' }).pagamentoPedido, true);
    assert.equal(lerConfig({ PAGAMENTOS_MODO: 'invalido' }).pagamentoPedido, false);
    assert.equal(lerConfig({}).ivaTaxa, 23);
    assert.equal(lerConfig({ IVA_TAXA: '6' }).ivaTaxa, 6);
    const q = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1' } });
    try {
      const c = await q.contaConfirmada();
      const r = await q.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', simulacao: SIM } });
      assert.equal(r.estado, 201, 'enviado sem pagar, como antes');
      assert.equal(r.json.pagamento, undefined);
      assert.deepEqual((await q.pedir('GET', '/api/catalogo')).json.pagamentos, { ativo: false, modo: null, demonstracao: false });
      const eu = (await q.pedir('GET', '/painel/api/eu', { cookie: q.cookies.ceo })).json.pagamentos;
      assert.equal(eu.desligados_sem_configuracao, true);
      assert.equal(eu.ativo, false);
    } finally { await q.fechar(); }
    const s = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } });
    try {
      assert.deepEqual((await s.pedir('GET', '/api/catalogo')).json.pagamentos, { ativo: true, modo: 'simulado', demonstracao: true });
      const c = await s.contaConfirmada();
      assert.equal((await s.pedir('GET', '/api/conta/eu', { cookie: c.cookie })).json.pagamentos.demonstracao, true);
    } finally { await s.fechar(); }
  });

  test('sem webhook no modo simulado', async () => {
    const q = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } });
    try {
      assert.equal((await q.pedir('POST', '/api/conta/pagamentos/stripe-webhook', { corpo: '{}', site: false })).estado, 404);
    } finally { await q.fechar(); }
  });
});
