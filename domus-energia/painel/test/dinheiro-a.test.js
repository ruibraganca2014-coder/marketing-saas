// Decisões do dono sobre o dinheiro (2026-10-02), lado do servidor, do painel e da conta (docs/PAGAMENTOS-PEDIDO.md
// "Decisões de 2026-10-02"): a casa só se liga com o restante pago; sinal = o maior entre 30 % e o custo do material;
// acima de 500 € só Multibanco ou MB Way; obra mínima de 100 €; visita cancelada com mais de 24 h devolvida (com menos,
// ou com falta, não); "Quero que comecem já"; stock simples (migração 22) e proposta em três partes (migração 23).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';

/** Simulação só com disjuntores Tongou (custo de compra conhecido nas sementes: 14,30 €). */
const sim = (qtd = 10, extra = []) => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Lisboa' },
  divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd, preco_iva: 54.9 }, ...extra],
  mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
/** "AAAA-MM-DDTHH:MM" em Lisboa para um instante (ms). */
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const HORA = 3600_000;

test('migrações 22 e 23: stock no catálogo e movimentos; proposta em três partes; pagamentos com "devolvido"; configuração sem mexer no editado', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 21; i++) MIGRACOES[i](db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 21');
  const agora = '2026-10-01T10:00:00Z';
  db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico, valor_proposta_cent) VALUES (?, ?, 'Ana', 'Casa', 100000)").run(agora, agora);
  db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, pago, expira, iva_pct)
    VALUES ('pp_antes', 1, 'visita', 2260, 'Visita', 'pago', 'simulado', 'conta', ?, ?, ?, 0, 23)`).run(agora, agora, agora);
  db.prepare("INSERT INTO config_orcamento (chave, valor) VALUES ('obra_minima_iva', 150)").run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  // 22: colunas de stock (0 por omissão) e a tabela dos movimentos, com os motivos no CHECK.
  const a = db.prepare("SELECT id, stock_qtd, stock_reservado, stock_minimo FROM catalogo WHERE sku = 'TONGOU-SY2-JWT'").get();
  assert.deepEqual([a.stock_qtd, a.stock_reservado, a.stock_minimo], [0, 0, 0]);
  const mov = db.prepare('INSERT INTO stock_movimentos (artigo_id, qtd, motivo, orcamento_id, por, quando) VALUES (?, ?, ?, ?, ?, ?)');
  for (const m of ['entrada', 'reserva', 'libertacao', 'saida', 'acerto']) mov.run(a.id, 1, m, 1, 'ceo@x', agora);
  assert.throws(() => mov.run(a.id, 1, 'outro', 1, 'ceo@x', agora), /CHECK/);
  // 23: o pedido e o pagamento ficam iguais; partes a NULL (proposta de um só valor); estado "devolvido" aceite.
  const o = db.prepare('SELECT * FROM orcamentos WHERE id = 1').get();
  assert.deepEqual([o.valor_proposta_cent, o.proposta_mao_obra_cent, o.proposta_material_cent, o.proposta_deslocacao_cent, o.inicio_imediato, o.visita_faltou], [100000, null, null, null, null, null]);
  const p = db.prepare("SELECT * FROM pagamentos_pedido WHERE ref = 'pp_antes'").get();
  assert.deepEqual([p.id, p.estado, p.valor_cent, p.devolvido, p.devolvido_cent], [1, 'pago', 2260, null, null]);
  assert.throws(() => db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, expira)
    VALUES ('pp_dup', 1, 'visita', 2260, 'x', 'pago', 'simulado', 'conta', ?, ?, 0)`).run(agora, agora), /UNIQUE/, 'índice único (pedido, fase) paga refeito');
  db.prepare("UPDATE pagamentos_pedido SET estado = 'devolvido', devolvido = ?, devolvido_cent = valor_cent WHERE ref = 'pp_antes'").run(agora);
  const novo = db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, expira)
    VALUES ('pp_depois', 1, 'visita', 2260, 'x', 'pago', 'simulado', 'conta', ?, ?, 0)`).run(agora, agora);
  assert.equal(Number(novo.lastInsertRowid), 2, 'a sequência continua; devolvida, a visita compra-se outra vez');
  assert.throws(() => db.prepare("UPDATE pagamentos_pedido SET estado = 'inventado' WHERE id = 2").run(), /CHECK/);
  const cfg = Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));
  assert.deepEqual([cfg.obra_minima_iva, cfg.cartao_max_iva], [150, 500], 'o valor que o CEO já tinha fica; o novo entra');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

describe('decisões do dinheiro (modo simulado)', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  async function enviar(c, simulacao = sim(), localidade = 'Lisboa') {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'Casa inteligente', localidade, simulacao } });
    assert.equal(r.estado, 201, r.texto);
    return r.json.pedido;
  }
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const ficha = async (id, papel = 'ceo') => (await painel('GET', `orcamentos/${id}`, papel)).json;
  async function pagar(c, id, fase, extra = {}) {
    const r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase, ...extra });
    assert.equal(r.estado, 200, r.texto);
    const ok = await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    assert.equal(ok.json.pagamento.estado, 'pago', ok.texto);
    return ok.json.pagamento;
  }
  const artigo = (sku) => p.app.db.prepare('SELECT * FROM catalogo WHERE sku = ?').get(sku);
  const movimentos = (id) => p.app.db.prepare('SELECT m.motivo, m.qtd, c.sku FROM stock_movimentos m JOIN catalogo c ON c.id = m.artigo_id WHERE m.orcamento_id = ? ORDER BY m.id').all(id).map((m) => [m.motivo, m.sku, m.qtd]);

  test('o /api/catalogo (público) não mostra stock nem custos; o stock é só do CEO', async () => {
    const pub = await p.pedir('GET', '/api/catalogo');
    assert.equal(pub.estado, 200);
    for (const a of pub.json.itens) assert.deepEqual(Object.keys(a).sort(), ['categoria', 'especificacoes', 'horas_instalacao', 'horas_troca', 'nome', 'preco_venda_iva', 'sku']);
    assert.doesNotMatch(pub.texto, /stock|preco_compra|custo|fornecedor|cartao_max/i);
    assert.equal(pub.json.config.obra_minima_iva, 100, 'a obra mínima vai para o simulador');
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await painel('GET', 'stock', papel)).estado, 403);
      assert.equal((await painel('POST', `catalogo/${artigo('TONGOU-SY2-JWT').id}/stock`, papel, { qtd: 1, motivo: 'entrada' })).estado, 403);
    }
  });

  test('stock: entrada com o custo real, acerto, mínimo e lista com os artigos abaixo do mínimo primeiro', async () => {
    const a = artigo('SENS-PIR-WIFI');
    assert.equal((await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 0, motivo: 'entrada' })).estado, 400);
    assert.equal((await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: -2, motivo: 'entrada' })).estado, 400, 'uma entrada é positiva');
    assert.equal((await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 1.5, motivo: 'acerto' })).estado, 201, 'arredondado a inteiro');
    assert.equal((await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 2, motivo: 'saida' })).estado, 400, 'só entrada ou acerto à mão');
    assert.equal((await painel('POST', 'catalogo/99999/stock', 'ceo', { qtd: 2, motivo: 'entrada' })).estado, 404);
    const e = await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 10, motivo: 'entrada', preco_compra: 7.45, nota: 'Encomenda de outubro' });
    assert.equal(e.estado, 201, e.texto);
    assert.deepEqual([e.json.stock_qtd, e.json.preco_compra, e.json.stock_gerido], [12, 7.45, true], 'o custo real (preço + transporte + alfândega) fica no artigo');
    const ac = await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: -3, motivo: 'acerto', nota: 'inventário' });
    assert.equal(ac.json.stock_qtd, 9);
    const min = await painel('POST', `catalogo/${a.id}`, 'ceo', { stock_minimo: 20 });
    assert.equal(min.estado, 200, min.texto);
    assert.equal(min.json.stock_minimo, 20);
    assert.equal((await painel('POST', `catalogo/${a.id}`, 'ceo', { stock_minimo: -1 })).estado, 400);
    assert.equal((await painel('POST', `catalogo/${a.id}`, 'ceo', { stock_qtd: 50 })).estado, 400, 'a quantidade só muda por movimentos');
    const l = (await painel('GET', 'stock')).json;
    assert.deepEqual([l.itens[0].sku, l.itens[0].abaixo, l.itens[0].stock_qtd, l.itens[0].disponivel, l.itens[0].stock_minimo], ['SENS-PIR-WIFI', true, 9, 9, 20], 'abaixo do mínimo primeiro');
    assert.deepEqual(l.movimentos.slice(0, 2).map((m) => [m.motivo, m.qtd, m.nota, m.por]), [['acerto', -3, 'inventário', p.u.ceo.email], ['entrada', 10, 'Encomenda de outubro', p.u.ceo.email]]);
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'stock_movimento'").get());
    const cat = (await painel('GET', 'catalogo')).json.itens.find((x) => x.sku === 'SENS-PIR-WIFI');
    assert.deepEqual([cat.stock_qtd, cat.stock_minimo, cat.preco_compra], [9, 20, 7.45], 'o Catálogo mostra stock, mínimo e custo');
    await painel('POST', `catalogo/${a.id}`, 'ceo', { stock_minimo: 0 });
  });

  test('proposta em três partes: sugerida pela simulação (catálogo do servidor), o total é a soma, a conta vê o detalhe; um só valor continua a valer', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c);
    const f = await ficha(id);
    const a = artigo('TONGOU-SY2-JWT');
    // Sugestão sem IVA: mão de obra = horas do catálogo × tarifa; material = artigos; deslocação (Lisboa: 0).
    const horas = 10 * a.horas_instalacao;
    assert.deepEqual(f.proposta_sugerida, { mao_obra: Math.round((horas * 38 / 1.23) * 100) / 100, material: Math.round(10 * a.preco_venda_iva_cent / 1.23) / 100, deslocacao: 0, horas });
    assert.equal(f.proposta_partes, null);
    // As três ou nenhuma.
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: 100 })).estado, 400);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: 100, proposta_material: null, proposta_deslocacao: 0 })).estado, 400);
    const r = await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', proposta_mao_obra: 300.5, proposta_material: 450, proposta_deslocacao: 20, valor_proposta: 1 });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.valor_proposta, 770.5, 'o total é a soma (o valor mandado à parte não conta)');
    assert.deepEqual(r.json.proposta_partes, { mao_obra: 300.5, material: 450, deslocacao: 20 });
    const l = await pedidoConta(c, id);
    assert.deepEqual(l.proposta_partes, { mao_obra: 300.5, material: 450, deslocacao: 20 });
    assert.deepEqual(l.proposta_iva, { base: 770.5, iva_pct: 23, iva: 177.22, total: 947.72 });
    // Mudar só o valor (como antes): volta a uma proposta de um só valor.
    const um = await painel('POST', `orcamentos/${id}`, 'ceo', { valor_proposta: 800 });
    assert.deepEqual([um.json.valor_proposta, um.json.proposta_partes], [800, null]);
    assert.equal((await pedidoConta(c, id)).proposta_partes, null);
    // E as três a null também.
    await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: 1, proposta_material: 2, proposta_deslocacao: 3 });
    const nulas = await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: null, proposta_material: null, proposta_deslocacao: null, valor_proposta: 900 });
    assert.deepEqual([nulas.json.valor_proposta, nulas.json.proposta_partes], [900, null]);
  });

  test('sinal = o maior entre 30 % e o material: custo de compra quando todos os artigos o têm; senão o material da proposta (venda); senão só os 30 %', async () => {
    const c = await p.contaConfirmada();
    // 10 disjuntores a 14,30 € de custo = 143 € (+ IVA 23 % = 175,89 €, a mesma base do total); proposta 300 € + IVA =
    // 369 € → 30 % = 110,70 € < 175,89 €.
    const id = await enviar(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 100, proposta_material: 200, proposta_deslocacao: 0 });
    let v = (await ficha(id)).valores_pagamento;
    assert.deepEqual([v.total, v.sinal, v.restante, v.material_origem, v.sinal_material], [369, 175.89, 193.11, 'custo', true]);
    assert.equal(v.material, undefined, 'o valor do custo não vai na ficha (o comercial vê-a)');
    let l = await pedidoConta(c, id);
    assert.deepEqual(l.sinal, { valor: 175.89, pct: 30, desconto: 0, pago: false, cobre_material: true });
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 300, plano: 'base' });
    assert.equal(ac.json.pagamento.valor, 175.89);
    // A taxa é a da configuração (não um 1,23 fixo): com IVA a 6 %, 143 € × 1,06 = 151,58 € > 30 % × 318 €.
    await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: 100, proposta_material: 200, proposta_deslocacao: 0.01 });
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 6 })).estado, 200);
    try { assert.deepEqual([(await ficha(id)).valores_pagamento.total, (await ficha(id)).valores_pagamento.sinal], [318.01, 151.58]); } finally { await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 23 }); }
    assert.match(ac.json.pagamento.descricao, /^Sinal da proposta do pedido n\.º \d+ \(369,00 € com IVA\): cobre o material$/);
    // Proposta maior: os 30 % passam o material.
    const id2 = await enviar(c);
    await painel('POST', `orcamentos/${id2}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    v = (await ficha(id2)).valores_pagamento;
    assert.deepEqual([v.sinal, v.material_origem, v.sinal_material], [369, 'custo', false]);
    // Um artigo sem custo de compra (interruptor): vale o material da proposta em três partes, pelo valor de venda.
    const id3 = await enviar(c, sim(10, [{ sku: 'INT-VIDRO-1', qtd: 1, preco_iva: 24.9 }]));
    await painel('POST', `orcamentos/${id3}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 100, proposta_material: 400, proposta_deslocacao: 0 });
    v = (await ficha(id3)).valores_pagamento;
    assert.deepEqual([v.total, v.sinal, v.material_origem, v.sinal_material], [615, 492, 'venda', true], '400 € de material + IVA');
    // Sem custo e sem partes (proposta de um só valor, como antes): só os 30 %.
    await painel('POST', `orcamentos/${id3}`, 'ceo', { valor_proposta: 501 });
    v = (await ficha(id3)).valores_pagamento;
    assert.deepEqual([v.sinal, v.material_origem, v.sinal_material], [Math.round(501 * 1.23 * 30) / 100, null, false]);
    // O sinal nunca passa o total.
    const id4 = await enviar(c, sim(40));
    await painel('POST', `orcamentos/${id4}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 400 });
    v = (await ficha(id4)).valores_pagamento;
    assert.deepEqual([v.total, v.sinal, v.restante], [492, 492, 0], 'material 572 € (+ IVA) > total: o sinal é o total');
  });

  test('do sinal à casa ligada: "Quero que comecem já", stock reservado com o sinal, saída com a obra concluída, converter só com o restante pago', async () => {
    const c = await p.contaConfirmada();
    const a = artigo('TONGOU-SY2-JWT');
    await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 25, motivo: 'entrada' });
    const antes = artigo('TONGOU-SY2-JWT');
    const id = await enviar(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 100, proposta_material: 200, proposta_deslocacao: 0 });
    assert.equal((await ficha(id)).ligar_casa, null, 'antes de aceite não há casa para ligar');
    assert.equal((await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 300, plano: 'conforto', inicio_imediato: 'sim' })).estado, 200, 'um valor que não é booleano é ignorado');
    assert.equal((await pedidoConta(c, id)).inicio_imediato, null);
    const pg = await pagar(c, id, 'sinal', { inicio_imediato: true });
    assert.equal(pg.valor, 175.89);
    let f = await ficha(id);
    assert.equal(f.estado, 'aceite');
    assert.ok(f.inicio_imediato, 'fica no pedido, com a data');
    assert.deepEqual([f.material_reserva.ja, f.material_reserva.a_partir], [true, null], '"Material: reservar já"');
    assert.ok(f.historico.some((h) => h.acao === 'inicio_imediato' && h.detalhes.quer === true));
    // Sinal pago: o material fica reservado (uma vez).
    assert.deepEqual(movimentos(id), [['reserva', 'TONGOU-SY2-JWT', 10]]);
    assert.deepEqual([artigo('TONGOU-SY2-JWT').stock_qtd, artigo('TONGOU-SY2-JWT').stock_reservado], [antes.stock_qtd, antes.stock_reservado + 10]);
    assert.deepEqual([f.stock.reservado, f.stock.saiu, f.stock.artigos.map((x) => [x.sku, x.qtd])], [true, false, [['TONGOU-SY2-JWT', 10]]]);
    // Já não muda depois do sinal pago.
    assert.equal((await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'sinal', inicio_imediato: false })).estado, 409);
    assert.ok((await pedidoConta(c, id)).inicio_imediato);
    // A casa só se liga com a obra toda paga.
    assert.deepEqual(f.ligar_casa, { pode: false, falta: 193.11, aviso: null });
    const corpo = { codigo: 'casa-nova', data: '2026-11-10', kit: 'conforto' };
    let cv = await painel('POST', `orcamentos/${id}/converter`, 'ceo', corpo);
    assert.equal(cv.estado, 409);
    assert.equal(cv.json.erro, 'Falta o cliente pagar o restante (193,11 €): a casa só se liga com a obra paga.');
    // Obra concluída: o material sai do armazém, a reserva fecha; continua a faltar o restante.
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 200);
    assert.match(p.emails.at(-1).texto, /A app da casa fica ativa depois de pagar o restante\./);
    assert.deepEqual(movimentos(id), [['reserva', 'TONGOU-SY2-JWT', 10], ['saida', 'TONGOU-SY2-JWT', -10]]);
    assert.deepEqual([artigo('TONGOU-SY2-JWT').stock_qtd, artigo('TONGOU-SY2-JWT').stock_reservado], [antes.stock_qtd - 10, antes.stock_reservado]);
    assert.equal((await painel('POST', `orcamentos/${id}/converter`, 'ceo', corpo)).estado, 409, 'obra concluída mas por pagar');
    let l = await pedidoConta(c, id);
    assert.deepEqual([l.obra_paga, l.pode_pagar_restante, l.restante.valor], [false, true, 193.11]);
    assert.equal(l.estado_texto, 'Instalação concluída. A app fica ativa depois de pagar o restante.');
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM pedidos_admin WHERE orcamento_id = ?").get(id).n, 0, 'nada pedido ao servidor');
    // Restante pago: converter cria o cliente, a obra (já concluída) e o plano.
    await pagar(c, id, 'restante');
    f = await ficha(id);
    assert.deepEqual(f.ligar_casa, { pode: true, falta: 0, aviso: null });
    cv = await painel('POST', `orcamentos/${id}/converter`, 'ceo', corpo);
    assert.equal(cv.estado, 201, cv.texto);
    assert.equal(cv.json.obra.estado, 'concluida');
    assert.equal(cv.json.pedido_plano.tipo ?? 'plano', 'plano');
    assert.equal((await pedidoConta(c, id)).obra_paga, true);
    assert.deepEqual(movimentos(id).length, 2, 'converter não mexe outra vez no stock');
  });

  test('stock: pedido que deixa de estar aceite ou obra cancelada liberta a reserva; aceite à mão reserva; artigos sem stock gerido ficam de fora', async () => {
    const c = await p.contaConfirmada();
    const a = artigo('TONGOU-SY2-JWT');
    if (!p.app.db.prepare('SELECT 1 FROM stock_movimentos WHERE artigo_id = ?').get(a.id)) await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 5, motivo: 'entrada' });
    const res0 = artigo('TONGOU-SY2-JWT').stock_reservado;
    // INT-VIDRO-1 nunca entrou em armazém nem tem mínimo: não se reserva.
    const id = await enviar(c, sim(2, [{ sku: 'INT-VIDRO-1', qtd: 3, preco_iva: 24.9 }]));
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite', valor_proposta: 500 })).estado, 200);
    assert.deepEqual(movimentos(id), [['reserva', 'TONGOU-SY2-JWT', 2]]);
    assert.equal(artigo('TONGOU-SY2-JWT').stock_reservado, res0 + 2);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'perdido', motivo_perda: 'desistiu' })).estado, 200);
    assert.deepEqual(movimentos(id).at(-1), ['libertacao', 'TONGOU-SY2-JWT', -2]);
    assert.equal(artigo('TONGOU-SY2-JWT').stock_reservado, res0);
    // Volta a aceite: reserva outra vez; guardar sem mudar o estado não duplica.
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' });
    await painel('POST', `orcamentos/${id}`, 'ceo', { notas: 'ok' });
    assert.equal(movimentos(id).filter((m) => m[0] === 'reserva').length, 2);
    assert.equal(artigo('TONGOU-SY2-JWT').stock_reservado, res0 + 2);
  });

  test('visita: cancelar com mais de 24 h devolve tudo (e compra-se outra vez); com menos não há devolução; "Cliente faltou" fica com o pagamento', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c, sim(), 'Sintra');
    const pg = await pagar(c, id, 'visita');
    assert.equal(pg.valor, 26.2);
    // Sem data marcada: cancela-se com devolução.
    let l = await pedidoConta(c, id);
    assert.deepEqual(l.visita_cancelar, { pode: true, devolucao: 26.2, motivo: null, avaria: false });
    // Marcada para daqui a 3 dias: continua a poder.
    assert.equal((await painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: lisboa(p.relogio.agora() + 72 * HORA) })).estado, 200);
    assert.equal((await pedidoConta(c, id)).visita_cancelar.pode, true);
    assert.equal((await painel('POST', `orcamentos/${id}/visita-faltou`, 'ceo', {})).estado, 409, 'a visita ainda não aconteceu');
    const outro = await p.contaConfirmada();
    assert.equal((await conta(outro, 'POST', `pedidos/${id}/cancelar-visita`, {})).estado, 404, 'só a conta dona');
    const cancelar = await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {});
    assert.equal(cancelar.estado, 200, cancelar.texto);
    assert.deepEqual(cancelar.json, { ok: true, devolvido: 26.2, manual: false });
    assert.match(p.emails.at(-1).texto, /Devolvemos 26,20 € para o mesmo meio de pagamento/);
    let f = await ficha(id);
    assert.deepEqual([f.estado, f.data_visita, f.compras.visita.paga], ['contactado', null, false]);
    assert.deepEqual(f.pagamentos.map((x) => [x.fase, x.estado, x.estado_texto, x.devolvido]), [['visita', 'devolvido', 'Devolvido', 26.2]]);
    assert.ok(f.historico.some((h) => h.acao === 'visita_cancelada_cliente' && h.detalhes.devolvido === 26.2));
    assert.equal((await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {})).estado, 409, 'já cancelada');
    l = await pedidoConta(c, id);
    assert.equal(l.visita_cancelar, null);
    assert.equal(l.pagamentos[0].devolvido, 26.2);
    // Comprar outra vez e marcar para daqui a 10 h: já não há devolução.
    await pagar(c, id, 'visita');
    await painel('POST', `orcamentos/${id}/marcar-visita`, 'comercial', { data_visita: lisboa(p.relogio.agora() + 10 * HORA) });
    l = await pedidoConta(c, id);
    assert.deepEqual([l.visita_cancelar.pode, l.visita_cancelar.motivo], [false, 'Já não é possível cancelar com devolução (faltam menos de 24 h para a visita).']);
    const tarde = await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {});
    assert.equal(tarde.estado, 409);
    assert.match(tarde.json.erro, /Já não é possível cancelar com devolução/);
    // Depois da hora: o painel regista "Cliente faltou"; o pagamento fica.
    p.relogio.avancar(11 * HORA);
    try {
      assert.equal((await painel('POST', `orcamentos/${id}/visita-faltou`, 'tecnico', {})).estado, 403);
      const fl = await painel('POST', `orcamentos/${id}/visita-faltou`, 'comercial', {});
      assert.equal(fl.estado, 200, fl.texto);
      assert.ok(fl.json.visita_faltou);
      assert.ok(fl.json.historico.some((h) => h.acao === 'visita_faltou' && h.detalhes.devolvido === false));
      assert.deepEqual([fl.json.pagamentos.at(-1).estado, fl.json.pagamentos.at(-1).nao_realizada], ['pago', true], 'a visita não é devolvida');
      assert.deepEqual([fl.json.data_visita, fl.json.estado], [null, 'contactado'], 'a data sai');
      assert.match(p.emails.at(-1).texto, /não é devolvida nem descontada/);
      assert.equal((await painel('POST', `orcamentos/${id}/visita-faltou`, 'ceo', {})).estado, 409, 'já registada');
      l = await pedidoConta(c, id);
      assert.deepEqual([l.visita_cancelar, Boolean(l.visita_faltou), l.compras.visita.paga], [null, true, false]);
      assert.equal((await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {})).estado, 409);
    } finally { p.relogio.avancar(-11 * HORA); }
    // Relatório + visita comprados juntos: devolve-se só a parte da visita (o relatório fica pago).
    const id2 = await enviar(c, sim(), 'Sintra');
    await pagar(c, id2, 'pormenorizado_visita');
    assert.equal((await pedidoConta(c, id2)).visita_cancelar.devolucao, 26.2);
    assert.equal((await conta(c, 'POST', `pedidos/${id2}/cancelar-visita`, {})).json.devolvido, 26.2);
    f = await ficha(id2);
    assert.deepEqual(f.pagamentos.map((x) => [x.fase, x.estado, x.valor, x.devolvido]), [['pormenorizado_visita', 'pago', 55.2, 26.2]]);
    assert.deepEqual([f.compras.relatorio.comprado, f.compras.visita.paga], [true, false]);
    // No sinal só se desconta o que ficou pago (29 €).
    await painel('POST', `orcamentos/${id2}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    assert.equal((await ficha(id2)).valores_pagamento.pago_antes, 29);
    // Já cancelada: não há segunda devolução.
    assert.equal((await conta(c, 'POST', `pedidos/${id2}/cancelar-visita`, {})).estado, 409);
  });

  test('acima de 500 € só Multibanco ou MB Way (os métodos vão no pagamento; o limite muda no painel)', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 2000 });   // 2460 € → sinal 738 €
    const l = await pedidoConta(c, id);
    assert.equal(l.cartao_max, 500);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 2000, plano: 'base' });
    assert.deepEqual([ac.json.pagamento.valor, ac.json.pagamento.metodos], [738, ['MB Way', 'Multibanco']]);
    // Um pagamento pequeno (relatório, 29 €) continua com cartão.
    const id2 = await enviar(c);
    const rel = await conta(c, 'POST', `pedidos/${id2}/pagar`, { fase: 'relatorio_pormenorizado' });
    assert.deepEqual(rel.json.pagamento.metodos, ['Cartão', 'MB Way', 'Multibanco']);
    // O limite edita-se no painel (e não é público).
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { cartao_max_iva: 1000 })).estado, 200);
    try {
      assert.deepEqual((await conta(c, 'GET', `pagamentos/${ac.json.pagamento.ref}`)).json.pagamento.metodos, ['Cartão', 'MB Way', 'Multibanco']);
      assert.equal((await p.pedir('GET', '/api/catalogo')).json.config.cartao_max_iva, undefined);
    } finally { await painel('POST', 'config-orcamento', 'ceo', { cartao_max_iva: 500 }); }
  });

  test('obra mínima de 100 € com IVA: abaixo cobra-se o mínimo e a visita já paga não é descontada; com as três partes a deslocação soma por cima', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c, sim(1), 'Sintra');
    await pagar(c, id, 'visita');   // 26,20 €
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 50 });   // 61,50 € com IVA
    let v = (await ficha(id)).valores_pagamento;
    assert.deepEqual([v.proposta, v.total, v.base, v.iva, v.minima, v.pago_antes, v.desconto, v.sinal, v.restante],
      [50, 100, 81.3, 18.7, 100, 26.2, 0, 30, 70]);
    let l = await pedidoConta(c, id);
    assert.equal(l.obra_minima, 100);
    assert.deepEqual(l.proposta_iva, { base: 81.3, iva_pct: 23, iva: 18.7, total: 100 });
    assert.deepEqual(l.sinal, { valor: 30, pct: 30, desconto: 0, pago: false, cobre_material: false });
    // Paga o sinal e o restante: no fim pagou 100 € pela obra, mais a visita à parte.
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 50, plano: 'base' });
    assert.equal(ac.json.pagamento.valor, 30);
    assert.doesNotMatch(ac.json.pagamento.descricao, /já pagos/);
    await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {});
    assert.equal((await pagar(c, id, 'restante')).valor, 70);
    v = (await ficha(id)).valores_pagamento;
    assert.deepEqual([v.restante, v.em_falta], [0, 0]);
    // Acima do mínimo: tudo como antes (a visita é descontada).
    const id2 = await enviar(c, sim(1), 'Sintra');
    await pagar(c, id2, 'visita');
    await painel('POST', `orcamentos/${id2}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 100 });   // 123 €
    v = (await ficha(id2)).valores_pagamento;
    assert.deepEqual([v.total, v.minima, v.desconto, v.sinal], [123, null, 26.2, Math.round((36.9 - 26.2) * 100) / 100]);
    assert.equal((await pedidoConta(c, id2)).obra_minima, null);
    // Três partes: o trabalho (mão de obra + material) abaixo do mínimo → mínimo + deslocação.
    await painel('POST', `orcamentos/${id2}`, 'ceo', { proposta_mao_obra: 30, proposta_material: 10, proposta_deslocacao: 60 });   // 123 € no total, 49,20 € de trabalho
    v = (await ficha(id2)).valores_pagamento;
    assert.deepEqual([v.proposta, v.total, v.minima, v.desconto], [100, 173.8, 100, 0]);
    // O mínimo muda no painel; uma proposta de 0 € fica 0 (não há obra a cobrar).
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { obra_minima_iva: 0 })).estado, 200);
    try { assert.equal((await ficha(id2)).valores_pagamento.minima, null); } finally { await painel('POST', 'config-orcamento', 'ceo', { obra_minima_iva: 100 }); }
    const id3 = await enviar(c, sim(1));
    await painel('POST', `orcamentos/${id3}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 0 });
    v = (await ficha(id3)).valores_pagamento;
    assert.deepEqual([v.total, v.minima, v.sinal], [0, null, 0]);
    // O relatório básico nunca mostra um intervalo abaixo do mínimo.
    const b = (await conta(c, 'GET', `pedidos/${id3}/relatorio-basico`)).json.relatorio;
    assert.ok(b.intervalo.min >= 100 && b.intervalo.max >= 100, JSON.stringify(b.intervalo));
    assert.equal(b.obra_minima, 100);
  });

  test('deslocação: ida e volta por dia de obra, no máximo 5 dias (deslocacao_max_dias; público e editável no painel)', async () => {
    const c = await p.contaConfirmada();
    // 100 disjuntores × 0,5 h = 50 h → 7 dias de obra; Sintra = 7,20 €/dia → paga só 5 dias = 36 €.
    const id = await enviar(c, sim(100), 'Sintra');
    const rel = async () => (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.equal((await rel()).deslocacao, 36);
    assert.equal((await ficha(id)).proposta_sugerida.deslocacao, Math.round(3600 / 1.23) / 100, 'a proposta sugerida segue o teto');
    const basico = (await conta(c, 'GET', `pedidos/${id}/relatorio-basico`)).json.relatorio;
    assert.deepEqual([basico.deslocacao, basico.dias, basico.deslocacao_dias, basico.deslocacao_limitada], [36, 7, 5, true], '"≈ 7 dias de obra" e "(ida e volta; máximo 5 dias)"');
    assert.deepEqual([(await rel()).dias, (await rel()).deslocacao_dias, (await rel()).deslocacao_limitada], [7, 5, true]);
    assert.equal((await p.pedir('GET', '/api/catalogo')).json.config.deslocacao_max_dias, 5, 'o simulador recebe o teto');
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { deslocacao_max_dias: 0 })).estado, 400);
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { deslocacao_max_dias: 2 })).estado, 200);
    try { assert.equal((await rel()).deslocacao, 14.4); } finally { await painel('POST', 'config-orcamento', 'ceo', { deslocacao_max_dias: 5 }); }
    // Uma obra pequena (5 h = 1 dia) paga um dia.
    const id2 = await enviar(c, sim(10), 'Sintra');
    const r2 = (await painel('GET', `orcamentos/${id2}/relatorio-cliente`)).json.relatorio;
    assert.deepEqual([r2.deslocacao, r2.dias, r2.deslocacao_dias, r2.deslocacao_limitada], [7.2, 1, 1, false], '"(ida e volta, 1 dia)"');
  });

  test('material: sem "Quero que comecem já" reserva-se 14 dias depois do sinal', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1000, plano: 'base', inicio_imediato: false });
    const pago = await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    const f = await ficha(id);
    assert.equal(f.inicio_imediato, null);
    assert.equal(f.material_reserva.ja, false);
    assert.equal(Date.parse(f.material_reserva.a_partir) - Date.parse(pago.json.pagamento.pago), 14 * 24 * HORA);
  });
});

test('pagamentos desligados: converte-se como antes (sem exigir o restante), com um aviso na ficha', async () => {
  const q = await painelComEquipa();   // PAGAMENTO_PEDIDO=0
  try {
    const cria = await q.pedir('POST', '/painel/api/orcamentos', { cookie: q.cookies.ceo, corpo: { nome: 'Ana', telefone: '912 000 111', servico: 'Casa' } });
    const id = cria.json.id;
    const r = await q.pedir('POST', `/painel/api/orcamentos/${id}`, { cookie: q.cookies.ceo, corpo: { estado: 'aceite', valor_proposta: 1000 } });
    assert.equal(r.json.ligar_casa.pode, true);
    assert.match(r.json.ligar_casa.aviso, /^Pagamentos desligados: confirme por fora que a obra está paga/);
    const cv = await q.pedir('POST', `/painel/api/orcamentos/${id}/converter`, { cookie: q.cookies.ceo, corpo: { codigo: 'ana', data: '2026-11-10', kit: 'conforto' } });
    assert.equal(cv.estado, 201, cv.texto);
    assert.equal(cv.json.obra.estado, 'agendada');
  } finally { await q.fechar(); }
});

describe('decisões do dinheiro (modo stripe)', () => {
  let p;
  let stripeMetodo = null;
  const chamadas = [];
  const fetchStripe = async (url, op) => {
    chamadas.push({ url, op });
    const params = new URLSearchParams(op.body ?? '');
    if (/checkout\/sessions$/.test(url)) {
      return new Response(JSON.stringify({ id: `cs_test_${chamadas.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${chamadas.length}`, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) }), { status: 200 });
    }
    const m = /checkout\/sessions\/(cs_test_\d+)(\?|$)/.exec(url);
    // Com `expand`, o Stripe devolve o PaymentIntent com o método usado (stripeMetodo: card por omissão).
    if (m) return new Response(JSON.stringify({ id: m[1], object: 'checkout.session', status: 'complete', payment_status: 'paid',
      payment_intent: stripeMetodo ? { id: 'pi_teste_1', latest_charge: { payment_method_details: { type: stripeMetodo } } } : 'pi_teste_1' }), { status: 200 });
    if (/\/refunds$/.test(url)) return new Response(JSON.stringify({ id: 're_teste_1', status: 'succeeded' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  before(async () => {
    p = await painelComEquipa({ fetchStripe, env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: 'whsec_x', SITE_URL: 'https://site.teste' } });
  });
  after(() => p.fechar());
  const metodosDe = (c) => { const q = new URLSearchParams(c.op.body); return ['0', '1', '2'].map((i) => q.get(`payment_method_types[${i}]`)); };

  test('Checkout: acima de 500 € sem cartão (mb_way e multibanco); a visita cancelada com mais de 24 h é reembolsada pela API do Stripe', async () => {
    const c = await p.contaConfirmada();
    const env = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', localidade: 'Sintra', simulacao: sim(), compra: 'visita' } });
    assert.equal(env.estado, 201, env.texto);
    const id = env.json.pedido;
    const visita = env.json.pagamento;
    assert.deepEqual(metodosDe(chamadas.at(-1)), ['card', 'mb_way', 'multibanco'], '26,20 €: com cartão');
    // Pago (evento do Stripe): cancelar com mais de 24 h → GET da sessão (payment_intent) e POST refunds.
    const sessao = p.app.db.prepare('SELECT stripe_sessao FROM pagamentos_pedido WHERE ref = ?').get(visita.ref).stripe_sessao;
    assert.equal(p.app.api.pagamentosPedido.tratarEvento({ id: 'evt_v', type: 'checkout.session.completed', data: { object: { id: sessao, object: 'checkout.session', client_reference_id: visita.ref, amount_total: 2620, currency: 'eur', payment_status: 'paid' } } }), 'pago');
    const r = await p.pedir('POST', `/api/conta/pedidos/${id}/cancelar-visita`, { cookie: c.cookie, corpo: {} });
    assert.equal(r.estado, 200, r.texto);
    const reembolso = chamadas.at(-1);
    assert.match(reembolso.url, /\/v1\/refunds$/);
    const q = new URLSearchParams(reembolso.op.body);
    assert.deepEqual([q.get('payment_intent'), q.get('amount'), q.get('metadata[ref]')], ['pi_teste_1', '2620', visita.ref]);
    assert.equal(reembolso.op.headers['Idempotency-Key'], `domus-reembolso-${visita.ref}`);
    assert.equal(p.app.db.prepare('SELECT estado FROM pagamentos_pedido WHERE ref = ?').get(visita.ref).estado, 'devolvido');
    // Sinal de 738 € (> 500 €): sem cartão.
    await p.pedir('POST', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.ceo, corpo: { estado: 'proposta_enviada', valor_proposta: 2000 } });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 2000, plano: 'base' } });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal(ac.json.pagamento.valor, 738);
    assert.deepEqual(metodosDe(chamadas.at(-1)), ['mb_way', 'multibanco', null]);
  });
});
