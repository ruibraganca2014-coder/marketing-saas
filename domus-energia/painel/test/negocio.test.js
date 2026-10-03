// GET resumo/negocio (dashboard do negócio no Início; docs/DASHBOARD.md): cada indicador com dados pequenos, os
// limites dos períodos (hora de Lisboa, semanas de segunda a domingo), a comparação com o período anterior
// equivalente, as devoluções, a margem com um custo de compra em falta, os papéis e a base vazia.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { iniciarPainel } from './ajuda.js';
import { periodoNegocio, PERIODOS } from '../src/negocio.js';
import { meiaNoiteLisboa, iso } from '../src/util.js';

// "Agora" de todos os testes: quarta-feira, 14 de outubro de 2026, 13:00 em Lisboa (hora de verão, UTC+1).
const AGORA = '2026-10-14T12:00:00Z';

/** Painel com o relógio em AGORA e uma sessão por papel (as sessões abrem já com o relógio acertado). */
async function painelEm(env = {}) {
  const p = await iniciarPainel({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', ...env } });
  p.relogio.desvio = Date.parse(AGORA) - Date.now();
  p.cookies = {};
  for (const papel of ['ceo', 'tecnico', 'comercial']) p.cookies[papel] = await p.entrar((await p.criarUtilizador(papel)).email);
  p.negocio = async (papel, periodo) => p.pedir('GET', `/painel/api/resumo/negocio${periodo ? `?periodo=${periodo}` : ''}`, { cookie: p.cookies[papel] });
  return p;
}

test('meiaNoiteLisboa: UTC+1 no verão, UTC no inverno e nos dias em que a hora muda', () => {
  assert.equal(iso(meiaNoiteLisboa('2026-10-01')), '2026-09-30T23:00:00Z');
  assert.equal(iso(meiaNoiteLisboa('2026-01-01')), '2026-01-01T00:00:00Z');
  assert.equal(iso(meiaNoiteLisboa('2026-03-29')), '2026-03-29T00:00:00Z', 'a hora de verão começa à 01:00 UTC desse dia');
  assert.equal(iso(meiaNoiteLisboa('2026-10-25')), '2026-10-24T23:00:00Z', 'a hora de verão acaba à 01:00 UTC desse dia');
  assert.equal(iso(meiaNoiteLisboa('2026-10-26')), '2026-10-26T00:00:00Z');
});

test('períodos: mês, semana (segunda a domingo), mês passado e ano, com o anterior equivalente', () => {
  const em = (chave, quando) => { const { inicio, fim, anterior, completo } = periodoNegocio(chave, new Date(quando)); return { inicio, fim, anterior, completo }; };
  assert.deepEqual(PERIODOS, ['semana', 'mes', 'mes_passado', 'ano']);
  assert.deepEqual(em('mes', AGORA), { inicio: '2026-10-01', fim: '2026-10-31', anterior: { inicio: '2026-09-01', fim: '2026-09-14' }, completo: false });
  assert.deepEqual(em('semana', AGORA), { inicio: '2026-10-12', fim: '2026-10-18', anterior: { inicio: '2026-10-05', fim: '2026-10-07' }, completo: false });
  assert.deepEqual(em('mes_passado', AGORA), { inicio: '2026-09-01', fim: '2026-09-30', anterior: { inicio: '2026-08-01', fim: '2026-08-31' }, completo: true });
  assert.deepEqual(em('ano', AGORA), { inicio: '2026-01-01', fim: '2026-12-31', anterior: { inicio: '2025-01-01', fim: '2025-10-14' }, completo: false });
  // O mês muda à meia-noite de Lisboa (23:00 UTC no verão), não à meia-noite UTC.
  assert.equal(em('mes', '2026-09-30T22:59:59Z').inicio, '2026-09-01');
  assert.equal(em('mes', '2026-09-30T23:00:00Z').inicio, '2026-10-01');
  // A semana começa à segunda: domingo às 23:59 de Lisboa ainda é a semana anterior.
  assert.equal(em('semana', '2026-10-11T22:59:59Z').inicio, '2026-10-05');
  assert.deepEqual(em('semana', '2026-10-11T23:00:00Z'), { inicio: '2026-10-12', fim: '2026-10-18', anterior: { inicio: '2026-10-05', fim: '2026-10-05' }, completo: false });
  // O ano muda à meia-noite de Lisboa (inverno: igual a UTC).
  assert.equal(em('ano', '2026-12-31T23:59:59Z').inicio, '2026-01-01');
  assert.equal(em('ano', '2027-01-01T00:00:00Z').inicio, '2027-01-01');
  // Dia 31 com o mês anterior mais curto, e 29 de fevereiro: o anterior acaba no último dia que existe.
  assert.deepEqual(em('mes', '2026-03-31T12:00:00Z').anterior, { inicio: '2026-02-01', fim: '2026-02-28' });
  assert.deepEqual(em('ano', '2028-02-29T12:00:00Z').anterior, { inicio: '2027-01-01', fim: '2027-02-28' });
  assert.deepEqual(em('mes_passado', '2026-01-10T12:00:00Z'), { inicio: '2025-12-01', fim: '2025-12-31', anterior: { inicio: '2025-11-01', fim: '2025-11-30' }, completo: true });
});

describe('base vazia', () => {
  let p;
  before(async () => { p = await painelEm(); });
  after(() => p.fechar());

  test('negócio novo: tudo a zero, sem divisões por zero nem NaN', async () => {
    for (const periodo of PERIODOS) {
      const r = await p.negocio('ceo', periodo);
      assert.equal(r.estado, 200, r.texto);
      assert.ok(!/NaN|Infinity|undefined/.test(r.texto), r.texto);
      const j = r.json;
      assert.equal(j.periodo.chave, periodo);
      assert.deepEqual({ n: j.pedidos.n, anterior: j.pedidos.anterior, variacao: j.pedidos.variacao }, { n: 0, anterior: 0, variacao: { dif: 0, pct: null } });
      assert.equal(j.pedidos.semanas.length, 8);
      assert.ok(j.pedidos.semanas.every((s) => s.n === 0));
      assert.deepEqual(j.aceitacao, { enviadas: 0, aceites: 0, taxa: null, anterior: { enviadas: 0, aceites: 0, taxa: null }, variacao_pontos: null });
      assert.deepEqual(j.origens, []);
      assert.deepEqual(j.receita, { sem_iva: 0, com_iva: 0, pagamentos: 0, devolvido: 0, pedidos_sem_iva: 0, planos_sem_iva: 0, simulados: 0,
        anterior: { sem_iva: 0, com_iva: 0 }, variacao: { dif: 0, pct: null } });
      assert.deepEqual(j.margem, { valor: 0, material: 0, eletricistas: 0, obras: 0, obras_sem_lista: 0, sem_custo: { artigos: 0, lista: [] },
        anterior: { valor: 0 }, variacao: { dif: 0, pct: null } });
      assert.deepEqual(j.por_receber, { online: true, total: 0, n: 0, lista: [] });
      assert.equal(j.stock_abaixo_minimo, 0);
      assert.equal(j.obras_por_agendar, 0);
      assert.deepEqual(j.avaliacao, { n: 0, media: null });
    }
  });

  test('com os pagamentos online desligados não há "por receber" (nem erros)', async () => {
    const q = await painelEm({ PAGAMENTO_PEDIDO: '0' });
    try {
      assert.deepEqual((await q.negocio('ceo')).json.por_receber, { online: false, total: 0, n: 0, lista: [] });
    } finally { await q.fechar(); }
  });
});

describe('com dados', () => {
  let p;
  const ids = {};

  /** Dados de um painel: pedidos, propostas enviadas (auditoria), pagamentos, catálogo, obras, eletricistas e avaliações. */
  async function semear(q) {
    const db = q.app.db;
    const conta = Number(db.prepare("INSERT INTO contas (email, confirmado, criado, atualizado) VALUES ('cliente@exemplo.pt', ?, ?, ?)").run(AGORA, AGORA, AGORA).lastInsertRowid);
    const orc = db.prepare(`INSERT INTO orcamentos (criado, atualizado, nome, telefone, servico, estado, origem_contacto, valor_proposta_cent, proposta_aceite,
      obra_concluida, conta_id, simulacao, avaliacao_estrelas) VALUES (?, ?, ?, '210000000', 'Outro', ?, ?, ?, ?, ?, ?, ?, ?)`);
    const pedido = (nome, criado, estado, origem = null, x = {}) => {
      ids[nome] = Number(orc.run(criado, criado, nome, estado, origem, x.proposta ?? null, x.aceite ?? null, x.concluida ?? null, x.conta ? conta : null,
        x.itens ? JSON.stringify({ itens: x.itens }) : null, x.estrelas ?? null).lastInsertRowid);
    };
    // Limites em hora de Lisboa (UTC+1 em setembro e outubro): 22:59:59Z é 23:59:59 da véspera; 23:00:00Z é a meia-noite.
    pedido('P1', '2026-09-30T22:59:59Z', 'perdido', 'google');                 // 30 de setembro
    pedido('P2', '2026-09-30T23:00:00Z', 'aceite', 'google', { proposta: 40_000, concluida: '2026-10-09T10:00:00Z', conta: true, estrelas: 1,
      itens: [{ sku: 'T-A', qtd: 2 }, { sku: 'T-B', qtd: 1 }, { sku: 'T-C', qtd: 3 }] });   // 1 de outubro
    pedido('P3', '2026-10-11T22:59:59Z', 'novo', 'facebook');                   // domingo, 11 de outubro
    pedido('P4', '2026-10-11T23:00:00Z', 'proposta_enviada', null, { proposta: 100_000, aceite: '2026-10-12T12:00:00Z', conta: true });   // segunda, 12 de outubro
    pedido('P5', '2026-10-13T10:00:00Z', 'aceite', 'recomendacao', { proposta: 50_000, concluida: '2026-10-13T16:00:00Z', estrelas: 2 });
    pedido('P6', '2026-09-10T10:00:00Z', 'aceite', 'google', { proposta: 30_000, concluida: '2026-09-13T10:00:00Z', conta: true, itens: [{ sku: 'T-A', qtd: 1 }] });
    pedido('P7', '2026-10-06T10:00:00Z', 'novo', 'google');                     // terça da semana anterior
    pedido('P8', '2025-12-31T23:59:59Z', 'perdido');                            // 2025 (inverno: Lisboa = UTC)
    pedido('P9', '2026-01-01T00:00:00Z', 'perdido');                            // 2026
    pedido('P10', '2025-06-01T10:00:00Z', 'perdido');

    // Propostas enviadas (auditoria): conta a PRIMEIRA vez de cada pedido (a P6 foi reenviada em outubro: fica em setembro).
    const aud = db.prepare("INSERT INTO auditoria (quando, email, acao, alvo, detalhes) VALUES (?, 'ceo@domus.teste', 'orcamento_atualizado', ?, ?)");
    const enviada = (nome, quando) => aud.run(quando, `orcamento:${ids[nome]}`, JSON.stringify({ estado: 'proposta_enviada' }));
    enviada('P2', '2026-10-02T10:00:00Z');
    enviada('P4', '2026-10-12T09:00:00Z');
    enviada('P5', '2026-10-13T11:00:00Z');
    enviada('P6', '2026-09-11T10:00:00Z');
    enviada('P6', '2026-10-05T10:00:00Z');
    aud.run('2026-10-13T12:00:00Z', `orcamento:${ids.P3}`, JSON.stringify({ notas: 'proposta_enviada' }));   // não é uma mudança de estado

    // Pagamentos dos pedidos (IVA a 23 %: 123,00 € = 100,00 € + IVA) e as mensalidades dos planos (CSV).
    const pag = db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, pago, expira, iva_pct, devolvido, devolvido_cent)
      VALUES (?, ?, ?, ?, 'x', ?, ?, 'conta', ?, ?, ?, 0, ?, ?, ?)`);
    const pagamento = (ref, nome, fase, cent, estado, pago, x = {}) => pag.run(ref, nome ? ids[nome] : null, fase, cent, estado, x.modo ?? 'stripe', pago ?? AGORA, pago ?? AGORA,
      pago, x.iva === undefined ? 23 : x.iva, x.devolvido ?? null, x.devolvido_cent ?? null);
    pagamento('pg1', 'P2', 'sinal', 12_300, 'pago', '2026-10-03T10:00:00Z');
    // Pago à meia-noite de 1 de outubro (Lisboa) e devolvido por inteiro a 10 de outubro: em outubro dá zero.
    pagamento('pg2', 'P5', 'visita', 6_150, 'devolvido', '2026-09-30T23:00:00Z', { devolvido: '2026-10-10T10:00:00Z', devolvido_cent: 6_150 });
    // Pago em setembro e devolvido em parte em outubro: a devolução desconta em outubro.
    pagamento('pg3', 'P6', 'sinal', 24_600, 'pago', '2026-09-12T10:00:00Z', { devolvido: '2026-10-08T10:00:00Z', devolvido_cent: 2_460 });
    pagamento('pg4', 'P4', 'sinal', 99_999, 'pendente', null);                  // por pagar: não é receita
    pagamento('pg5', null, 'relatorio_pormenorizado', 1_230, 'pago', '2026-09-30T22:59:59Z');   // 30 de setembro
    pagamento('pg6', null, 'relatorio', 1_230, 'pago', '2026-10-13T10:00:00Z', { iva: null, modo: 'simulado' });   // sem taxa guardada: 23 %
    await writeFile(join(q.dados, 'pagamentos', 'pagamentos.csv'), ['data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe',
      '2026-09-10;a;base;4,99;4,06;in_0', '2026-10-05;b;conforto;9,99;8,12;in_1', ''].join('\n'));

    // Catálogo: T-A com custo; T-B com preço de venda e SEM custo (em falta); T-C sem custo e com venda 0 (não é material).
    const art = db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_compra_cent, preco_venda_iva_cent, stock_qtd, stock_reservado, stock_minimo, atualizado)
      VALUES (?, ?, 'outro', ?, ?, ?, ?, ?, ?)`);
    art.run('T-A', 'Artigo A', 1_000, 3_000, 2, 0, 5, AGORA);                     // abaixo do mínimo (2 < 5)
    art.run('T-B', 'Artigo B', null, 5_000, 0, 0, 0, AGORA);                      // sem stock gerido
    const tc = Number(art.run('T-C', 'Artigo C', null, 0, 1, 3, 0, AGORA).lastInsertRowid);
    db.prepare("INSERT INTO stock_movimentos (artigo_id, qtd, motivo, quando) VALUES (?, 1, 'entrada', ?)").run(tc, AGORA);   // gerido, disponível −2

    // Obras: uma por agendar; a cancelada e a já agendada não contam.
    const obra = db.prepare("INSERT INTO obras (cliente, data, estado, por_agendar, criado, atualizado) VALUES ('', '2026-10-20', ?, ?, ?, ?)");
    obra.run('agendada', 1, AGORA, AGORA);
    obra.run('cancelada', 1, AGORA, AGORA);
    obra.run('agendada', 0, AGORA, AGORA);

    // Eletricistas externos: valor fixado ao aprovar (pela data da aprovação) e a ida sem defeito (pela data da decisão).
    const e = Number(db.prepare(`INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, estado, consentimento, criado, atualizado)
      VALUES ('e@exemplo.pt', 'E', '910000000', '123456789', '1', 'aprovado', ?, ?, ?)`).run(AGORA, AGORA, AGORA).lastInsertRowid);
    const trab = db.prepare(`INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, criado, atualizado, aprovada, valor_cent,
      regresso_desde, regresso_cent, estrelas) VALUES (?, ?, ?, 'direto', 'Lisboa', ?, ?, ?, ?, ?, ?, ?, ?)`);
    trab.run(ids.P2, 'obra', 'aprovada', e, AGORA, AGORA, '2026-10-09T10:00:00Z', 3_000, null, null, 4);
    trab.run(ids.P6, 'obra', 'paga', e, AGORA, AGORA, '2026-09-13T10:00:00Z', 1_500, '2026-10-07T10:00:00Z', 500, 5);
    trab.run(ids.P5, 'obra', 'confirmada', e, AGORA, AGORA, null, null, null, null, null);   // por aprovar: ainda não é custo
  }

  before(async () => { p = await painelEm(); await semear(p); });
  after(() => p.fechar());
  const de = async (papel, periodo) => (await p.negocio(papel, periodo)).json;

  test('sem ?periodo= abre em "Este mês"; período desconhecido: 400', async () => {
    const r = await de('ceo');
    assert.deepEqual(r.periodo, { chave: 'mes', inicio: '2026-10-01', fim: '2026-10-31', hoje: '2026-10-14', completo: false, anterior: { inicio: '2026-09-01', fim: '2026-09-14' } });
    assert.deepEqual(r.periodos, PERIODOS);
    assert.equal((await p.negocio('ceo', 'trimestre')).estado, 400);
  });

  test('pedidos recebidos: limites em hora de Lisboa e comparação com o período anterior equivalente', async () => {
    // Outubro: P2 (meia-noite de dia 1), P3, P4, P5, P7; 1 a 14 de setembro: P6 (a P1, de dia 30, fica fora da comparação).
    assert.deepEqual((({ n, anterior, variacao }) => ({ n, anterior, variacao }))((await de('ceo', 'mes')).pedidos), { n: 5, anterior: 1, variacao: { dif: 4, pct: 400 } });
    // Semana de 12 a 18: P4 (segunda às 00:00) e P5; segunda a quarta da semana anterior: P7 (a P3, de domingo, fica fora).
    assert.deepEqual((({ n, anterior, variacao }) => ({ n, anterior, variacao }))((await de('ceo', 'semana')).pedidos), { n: 2, anterior: 1, variacao: { dif: 1, pct: 100 } });
    // Setembro inteiro (P1, P6) contra agosto inteiro (nada): sem percentagem.
    assert.deepEqual((({ n, anterior, variacao }) => ({ n, anterior, variacao }))((await de('ceo', 'mes_passado')).pedidos), { n: 2, anterior: 0, variacao: { dif: 2, pct: null } });
    // 2026: todos menos P8 e P10; 2025 até 14 de outubro: P10 (a P8, de 31 de dezembro, fica fora).
    assert.deepEqual((({ n, anterior, variacao }) => ({ n, anterior, variacao }))((await de('ceo', 'ano')).pedidos), { n: 8, anterior: 1, variacao: { dif: 7, pct: 700 } });
  });

  test('pedidos por semana: as últimas 8 semanas, de segunda a domingo, iguais em todos os períodos', async () => {
    const esperado = [['2026-08-24', 0], ['2026-08-31', 0], ['2026-09-07', 1], ['2026-09-14', 0], ['2026-09-21', 0], ['2026-09-28', 2], ['2026-10-05', 2], ['2026-10-12', 2]];
    for (const periodo of ['mes', 'ano']) {
      const s = (await de('comercial', periodo)).pedidos.semanas;
      assert.deepEqual(s.map((x) => [x.inicio, x.n]), esperado);
      assert.deepEqual([s[7].inicio, s[7].fim], ['2026-10-12', '2026-10-18']);
    }
  });

  test('taxa de aceitação: propostas enviadas no período (primeiro envio) que já estão aceites', async () => {
    // Outubro: P2 (aceite), P4 (por aceitar), P5 (aceite). 1 a 14 de setembro: P6 (aceite; o reenvio de outubro não conta).
    assert.deepEqual((await de('ceo', 'mes')).aceitacao, { enviadas: 3, aceites: 2, taxa: 67, anterior: { enviadas: 1, aceites: 1, taxa: 100 }, variacao_pontos: -33 });
    assert.deepEqual((await de('comercial', 'mes_passado')).aceitacao, { enviadas: 1, aceites: 1, taxa: 100, anterior: { enviadas: 0, aceites: 0, taxa: null }, variacao_pontos: null });
  });

  test('origem dos contactos: pedidos do período por origem e quantos ficaram aceites', async () => {
    assert.deepEqual((await de('comercial', 'mes')).origens, [
      { origem: 'google', pedidos: 2, aceites: 1 }, { origem: null, pedidos: 1, aceites: 0 },
      { origem: 'facebook', pedidos: 1, aceites: 0 }, { origem: 'recomendacao', pedidos: 1, aceites: 1 },
    ]);
    assert.deepEqual((await de('ceo', 'mes_passado')).origens, [{ origem: 'google', pedidos: 2, aceites: 1 }]);
  });

  test('receita: pagamentos pela data em que foram pagos, menos as devoluções pela data delas, mais os planos', async () => {
    const r = (await de('ceo', 'mes')).receita;
    // Sem IVA: pg1 100,00 + pg2 50,00 − 50,00 (devolvido) − 20,00 (devolução de pg3) + pg6 10,00 + plano 8,12.
    assert.deepEqual(r, { sem_iva: 98.12, com_iva: 120.69, pagamentos: 4, devolvido: 86.1, pedidos_sem_iva: 90, planos_sem_iva: 8.12, simulados: 1,
      // 1 a 14 de setembro: pg3 200,00 + plano 4,06 (o pg5, de dia 30, fica fora).
      anterior: { sem_iva: 204.06, com_iva: 250.99 }, variacao: { dif: -105.94, pct: -52 } });
    const s = (await de('ceo', 'mes_passado')).receita;
    assert.deepEqual([s.sem_iva, s.com_iva, s.pagamentos, s.devolvido], [214.06, 263.29, 3, 0], 'setembro: pg3, pg5 e o plano; o pg2 (meia-noite de 1 de outubro) não');
  });

  test('margem: receita sem IVA − material das obras concluídas − eletricistas; aviso com os artigos sem custo', async () => {
    const m = (await de('ceo', 'mes')).margem;
    // Material: P2 = 2 × 10,00 (T-B sem custo conta 0; T-C tem venda 0, não é material); P5 não tem lista. Eletricistas: 30,00 + 5,00 da ida.
    assert.deepEqual({ ...m, sem_custo: { ...m.sem_custo, lista: m.sem_custo.lista.map((a) => a.sku) } }, {
      valor: 43.12, material: 20, eletricistas: 35, obras: 2, obras_sem_lista: 1, sem_custo: { artigos: 1, lista: ['T-B'] },
      // 1 a 14 de setembro: 204,06 − 10,00 (P6) − 15,00.
      anterior: { valor: 179.06 }, variacao: { dif: -135.94, pct: -76 },
    });
    assert.equal(m.sem_custo.lista[0].nome, 'Artigo B');
    const s = (await de('ceo', 'mes_passado')).margem;
    assert.deepEqual([s.valor, s.material, s.eletricistas, s.obras, s.sem_custo.artigos], [189.06, 10, 15, 1, 0]);
  });

  test('por receber: sinal das propostas aceites e restante das obras concluídas, os mais antigos primeiro', async () => {
    const r = (await de('ceo', 'mes')).por_receber;
    // P6: 369,00 − (246,00 − 24,60) = 147,60; P2: 492,00 − 123,00 = 369,00; P4: 30 % de 1230,00 = 369,00. A P5 não tem conta.
    assert.deepEqual(r, { online: true, total: 885.6, n: 3, lista: [
      { id: ids.P6, nome: 'P6', fase: 'restante', valor: 147.6, desde: '2026-09-13T10:00:00Z' },
      { id: ids.P2, nome: 'P2', fase: 'restante', valor: 369, desde: '2026-10-09T10:00:00Z' },
      { id: ids.P4, nome: 'P4', fase: 'sinal', valor: 369, desde: '2026-10-12T12:00:00Z' },
    ] });
    assert.deepEqual((await de('ceo', 'semana')).por_receber, r, 'não depende do período');
  });

  test('stock abaixo do mínimo, obras por agendar e avaliação média (uma por pedido)', async () => {
    const r = await de('ceo', 'mes');
    assert.equal(r.stock_abaixo_minimo, 2, 'T-A abaixo do mínimo e T-C com o disponível negativo');
    assert.equal(r.obras_por_agendar, 1);
    // P2: 4 (a do trabalho do eletricista; a 1 da conta não conta outra vez); P6: 5; P5: 2 (da conta).
    assert.deepEqual(r.avaliacao, { n: 3, media: 3.7 });
  });

  test('papéis: o comercial não recebe nenhum valor; o técnico não entra', async () => {
    for (const periodo of PERIODOS) {
      const r = await p.negocio('comercial', periodo);
      assert.equal(r.estado, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ['aceitacao', 'origens', 'papel', 'pedidos', 'periodo', 'periodos']);
      assert.ok(!/receita|margem|por_receber|iva|valor|material|eletricistas|stock|avaliacao|obras/.test(r.texto), r.texto);
      const t = await p.negocio('tecnico', periodo);
      assert.equal(t.estado, 403);
      assert.deepEqual(t.json, { erro: 'Não tem acesso a esta área.' });
    }
    assert.equal((await p.pedir('GET', '/painel/api/resumo/negocio')).estado, 401);
    // O resumo de sempre não ganhou nada com isto.
    const resumo = (await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.tecnico })).json;
    assert.deepEqual(Object.keys(resumo).sort(), ['alertas', 'hoje', 'obras_hoje', 'obras_semana', 'papel', 'semana']);
  });

  test('o stock do ecrã Stock e o do dashboard contam os mesmos artigos', async () => {
    const itens = (await p.pedir('GET', '/painel/api/stock', { cookie: p.cookies.ceo })).json.itens;
    assert.equal(itens.filter((a) => a.abaixo).length, (await de('ceo')).stock_abaixo_minimo);
  });

  test('módulo dos eletricistas desligado: o custo dos eletricistas é zero, sem erros', async () => {
    const q = await painelEm({ ELETRICISTAS: '0' });
    try {
      await semear(q);
      const r = await q.negocio('ceo', 'mes');
      assert.equal(r.estado, 200, r.texto);
      assert.equal(r.json.margem.eletricistas, 0);
      assert.equal(r.json.margem.valor, 78.12, '98,12 − 20,00 de material');
    } finally { await q.fechar(); }
  });
});
