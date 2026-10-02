// Decisões do dono de 2026-10-02, segunda parte (docs/PAGAMENTOS-PEDIDO.md "Obra e casa" e "Devoluções"): a obra nasce
// com o sinal pago e a casa liga-se só com o restante pago (a mesma obra); sinal devolvido ou pedido cancelado → obra
// cancelada; cancelar o diagnóstico da avaria como a visita; uma visita a que o cliente faltou não desconta no sinal;
// totais e CSV com as devoluções; devolução manual por transferência (IBAN) nos pagamentos por referência Multibanco.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const sim = (qtd = 10) => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Lisboa' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
/** Avaria rápida como o simulador a monta: diagnóstico, sem planta. */
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const DIAG_SINTRA = 51.2;   // 25 € + 0,5 h × 38 € + deslocação 7,20 €
const VISITA_SINTRA = 26.2;
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const IBAN = 'PT50 0002 0123 1234 5678 9015 4';
const IBAN_LIMPO = 'PT50000201231234567890154';

test('migração 26: obras por agendar; pagamento com falta ou devolução manual sai do índice único; devoluções com os estados no CHECK', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 25; i++) MIGRACOES[i](db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 25');
  const agora = '2026-10-01T10:00:00Z';
  db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES (?, ?, 'Ana', 'Casa')").run(agora, agora);
  db.prepare("INSERT INTO obras (cliente, orcamento_id, data, criado, atualizado) VALUES ('ana', 1, '2026-10-10', ?, ?)").run(agora, agora);
  const pagar = (ref) => db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, pago, expira, iva_pct)
    VALUES (?, 1, 'visita', 2620, 'Visita', 'pago', 'simulado', 'conta', ?, ?, ?, 0, 23)`).run(ref, agora, agora, agora);
  pagar('pp_1');
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.equal(db.prepare('SELECT por_agendar FROM obras WHERE id = 1').get().por_agendar, 0, 'as obras que já existem estão agendadas');
  const p1 = db.prepare("SELECT * FROM pagamentos_pedido WHERE ref = 'pp_1'").get();
  assert.deepEqual([p1.estado, p1.faltou, p1.faltou_cent, p1.a_devolver, p1.metodo], ['pago', null, null, null, null]);
  assert.throws(() => pagar('pp_2'), /UNIQUE/, 'uma fase paga só uma vez');
  db.prepare("UPDATE pagamentos_pedido SET faltou = ?, faltou_cent = valor_cent WHERE ref = 'pp_1'").run(agora);
  pagar('pp_2');   // o cliente faltou à primeira: paga uma visita nova
  assert.throws(() => pagar('pp_3'), /UNIQUE/);
  db.prepare("UPDATE pagamentos_pedido SET a_devolver = valor_cent WHERE ref = 'pp_2'").run();
  pagar('pp_3');   // devolução manual por fazer: a visita compra-se outra vez
  const dev = db.prepare('INSERT INTO devolucoes_pedido (pagamento_id, orcamento_id, valor_cent, motivo, estado, criado) VALUES (2, 1, 2620, ?, ?, ?)');
  for (const e of ['pede_iban', 'por_fazer', 'devolvido']) dev.run('visita', e, agora);
  assert.throws(() => dev.run('visita', 'outro', agora), /CHECK/);
  assert.throws(() => dev.run('outro', 'por_fazer', agora), /CHECK/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

describe('obra, casa, faltas e devoluções (modo simulado)', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  async function enviar(c, simulacao = sim(), localidade = 'Lisboa') {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Carla Neves', telefone: '912 000 111', servico: 'Casa inteligente', localidade, simulacao } });
    assert.equal(r.estado, 201, r.texto);
    return r.json.pedido;
  }
  async function enviarAvaria(c, metodo) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Carla Avaria', telefone: '912 000 111', servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
    assert.equal(r.estado, 202, r.texto);
    const ok = await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso', ...(metodo ? { metodo } : {}) });
    assert.equal(ok.json.pagamento.estado, 'pago', ok.texto);
    return ok.json.pagamento.orcamento_id;
  }
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const ficha = async (id, papel = 'ceo') => (await painel('GET', `orcamentos/${id}`, papel)).json;
  async function pagar(c, id, fase, metodo) {
    const r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase });
    assert.equal(r.estado, 200, r.texto);
    const ok = await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso', ...(metodo ? { metodo } : {}) });
    assert.equal(ok.json.pagamento.estado, 'pago', ok.texto);
    return ok.json.pagamento;
  }
  /** Proposta de 1000 € aceite e sinal pago; devolve o pagamento do sinal. */
  async function comSinal(c, id, metodo) {
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1000, plano: 'conforto' });
    assert.equal(ac.estado, 200, ac.texto);
    const ok = await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso', ...(metodo ? { metodo } : {}) });
    assert.equal(ok.json.pagamento.estado, 'pago', ok.texto);
    return ok.json.pagamento;
  }
  const obrasDe = (id) => p.app.db.prepare('SELECT * FROM obras WHERE orcamento_id = ? ORDER BY id').all(id);
  const csv = async (q = '') => (await painel('GET', `pagamentos-pedido?formato=csv${q}`)).texto.replace(/^﻿/, '').trim().split('\r\n');

  test('sinal pago → nasce UMA obra (por agendar, casa por ligar); segundo evento não cria outra; restante pago → "ligar casa" reaproveita a mesma obra', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c);
    assert.equal(obrasDe(id).length, 0, 'antes do sinal não há obra');
    const sinal = await comSinal(c, id);
    let obras = obrasDe(id);
    assert.equal(obras.length, 1);
    assert.deepEqual([obras[0].cliente, obras[0].estado, obras[0].por_agendar, obras[0].horas_estimadas], ['', 'agendada', 1, 5]);
    assert.deepEqual(JSON.parse(obras[0].material).map((m) => [m.sku, m.quantidade]), [['TONGOU-SY2-JWT', 10]]);
    const obraId = obras[0].id;
    let f = await ficha(id);
    assert.deepEqual([f.estado, f.cliente, f.obra_id, f.obra.por_agendar, f.obra.estado], ['aceite', null, obraId, true, 'agendada'], 'a casa ainda não está ligada');
    assert.deepEqual(f.ligar_casa, { pode: false, falta: 861, aviso: null });
    assert.ok(f.historico.every((h) => h.acao !== 'orcamento_convertido'));
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pedidos_admin WHERE orcamento_id = ?').get(id).n, 0, 'nada pedido ao servidor: nem cliente nem plano');
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'obra_criada' AND alvo = ?").get(`obra:${obraId}`));
    // Aparece em Obras (para agendar e atribuir o técnico), com o nome do pedido e "casa por ligar — falta o restante".
    const naLista = (await painel('GET', 'obras')).json.obras.find((o) => o.id === obraId);
    assert.deepEqual([naLista.cliente, naLista.cliente_nome, naLista.casa_ligada, naLista.casa, naLista.por_agendar, naLista.orcamento_id], [null, 'Carla Neves', false, 'falta_restante', true, id]);
    assert.ok((await painel('GET', 'resumo')).json.propostas_aceites_online.some((x) => x.id === id), 'continua na lista "por converter"');
    // O mesmo pagamento confirmado outra vez (segundo webhook): continua uma só obra.
    const pag = p.app.api.pagamentosPedido;
    assert.equal(pag.tratarEvento({ id: 'evt_sinal_outra_vez', type: 'checkout.session.completed', data: { object: { id: 'cs_x', object: 'checkout.session', client_reference_id: sinal.ref, amount_total: Math.round(sinal.valor * 100), currency: 'eur', payment_status: 'paid' } } }), 'repetido');
    pag.aoFicarAceite(id, 'sistema');
    assert.equal(obrasDe(id).length, 1);
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM stock_movimentos WHERE orcamento_id = ? AND motivo = 'reserva'").get(id).n <= 1, true);
    // A conta: aceite, sem data (ninguém a escolheu ainda).
    let l = await pedidoConta(c, id);
    assert.deepEqual([l.estado_texto, l.obra.por_agendar, l.obra.data], ['Proposta aceite. Vamos marcar a instalação.', true, null]);
    assert.equal(l.passos.find((s) => s.chave === 'obra').feito, false);
    // O CEO agenda e atribui o técnico em Obras; o técnico vê-a.
    const ag = await painel('POST', `obras/${obraId}`, 'ceo', { data: '2026-11-20', tecnicos: [p.u.tecnico.id] });
    assert.equal(ag.estado, 200, ag.texto);
    assert.deepEqual([ag.json.por_agendar, ag.json.data, ag.json.casa], [false, '2026-11-20', 'falta_restante']);
    assert.ok((await painel('GET', 'obras', 'tecnico')).json.obras.some((o) => o.id === obraId));
    l = await pedidoConta(c, id);
    assert.deepEqual([l.estado_texto, l.obra.data], ['Instalação marcada.', '2026-11-20']);
    // "Ligar casa" continua bloqueado até ao restante.
    assert.equal((await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'carla' })).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {})).estado, 200);
    assert.equal(obrasDe(id)[0].estado, 'concluida');
    assert.equal((await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'carla' })).estado, 409, 'obra feita mas por pagar');
    await pagar(c, id, 'restante');
    assert.equal((await painel('GET', 'obras')).json.obras.find((o) => o.id === obraId).casa, 'por_ligar');
    // Restante pago: ligar a casa (só o código) — a MESMA obra, com a data e o técnico que já tinha.
    const cv = await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'carla' });
    assert.equal(cv.estado, 201, cv.texto);
    assert.deepEqual([cv.json.obra.id, cv.json.obra.cliente, cv.json.obra.data, cv.json.obra.estado, cv.json.obra.casa, cv.json.obra.tecnicos.map((t) => t.id)], [obraId, 'carla', '2026-11-20', 'concluida', 'ligada', [p.u.tecnico.id]]);
    assert.equal(cv.json.pedido.tipo, 'cliente');
    assert.equal(cv.json.pedido_plano.tipo ?? 'plano', 'plano', 'a mensalidade começa agora');
    obras = obrasDe(id);
    assert.equal(obras.length, 1, 'nunca duas obras para um pedido');
    f = await ficha(id);
    assert.deepEqual([f.cliente, f.obra_id], ['carla', obraId]);
    assert.equal((await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'carla' })).estado, 409, 'já convertido');
    assert.ok(!(await painel('GET', 'resumo')).json.propostas_aceites_online.some((x) => x.id === id));
  });

  test('sinal devolvido (CEO) ou pedido cancelado antes da obra: a obra fica cancelada (não se apaga) e a reserva é libertada; voltar a aceite reaproveita a obra', async () => {
    const c = await p.contaConfirmada();
    const a = p.app.db.prepare("SELECT id FROM catalogo WHERE sku = 'TONGOU-SY2-JWT'").get();
    if (!p.app.db.prepare('SELECT 1 FROM stock_movimentos WHERE artigo_id = ?').get(a.id)) await painel('POST', `catalogo/${a.id}/stock`, 'ceo', { qtd: 50, motivo: 'entrada' });
    const reservado = () => p.app.db.prepare('SELECT stock_reservado FROM catalogo WHERE id = ?').get(a.id).stock_reservado;
    const antes = reservado();
    const id = await enviar(c);
    await comSinal(c, id);
    const obraId = obrasDe(id)[0].id;
    assert.equal(reservado(), antes + 10);
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-sinal`, 'comercial', {})).estado, 403, 'só o CEO');
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-sinal`, 'ceo', { valor: 9999 })).estado, 400, 'nunca mais do que o sinal');
    // Devolve o sinal menos 69 € de material já encomendado.
    const r = await painel('POST', `orcamentos/${id}/devolver-sinal`, 'ceo', { valor: 300, motivo: 'O cliente desistiu' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.estado, r.json.motivo_perda, r.json.obra.estado, r.json.obra_id], ['perdido', 'O cliente desistiu', 'cancelada', obraId]);
    assert.deepEqual(r.json.pagamentos.map((x) => [x.fase, x.estado, x.valor, x.devolvido]), [['sinal', 'pago', 369, 300]], 'devolução parcial: o pagamento fica pago, com o devolvido');
    assert.ok(r.json.historico.some((h) => h.acao === 'sinal_devolvido' && h.detalhes.devolvido === 300));
    assert.deepEqual(obrasDe(id).map((o) => [o.id, o.estado]), [[obraId, 'cancelada']], 'a obra não se apaga');
    assert.equal(reservado(), antes, 'reserva libertada');
    assert.match(p.emails.at(-1).texto, /Devolvemos 300,00 € do sinal para o mesmo meio de pagamento/);
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-sinal`, 'ceo', {})).estado, 409, 'já devolvido');
    assert.equal((await pedidoConta(c, id)).estado_texto, 'Pedido fechado.');
    // Devolução total: o pagamento passa a "devolvido".
    const id2 = await enviar(c);
    await comSinal(c, id2);
    const r2 = await painel('POST', `orcamentos/${id2}/devolver-sinal`, 'ceo', {});
    assert.deepEqual(r2.json.pagamentos.map((x) => [x.fase, x.estado, x.devolvido]), [['sinal', 'devolvido', 369]]);
    assert.equal(obrasDe(id2)[0].estado, 'cancelada');
    // Depois de a obra estar feita já não se devolve aqui.
    const id3 = await enviar(c);
    await comSinal(c, id3);
    await painel('POST', `orcamentos/${id3}/obra-concluida`, 'ceo', {});
    assert.equal((await painel('POST', `orcamentos/${id3}/devolver-sinal`, 'ceo', {})).estado, 409);
    // Pedido cancelado à mão (aceite → perdido): obra cancelada; volta a aceite: a mesma obra, outra vez por agendar.
    const id4 = await enviar(c);
    await comSinal(c, id4);
    const obra4 = obrasDe(id4)[0].id;
    assert.equal((await painel('POST', `orcamentos/${id4}`, 'ceo', { estado: 'perdido', motivo_perda: 'desistiu' })).estado, 200);
    assert.deepEqual(obrasDe(id4).map((o) => [o.id, o.estado]), [[obra4, 'cancelada']]);
    assert.equal((await painel('POST', `orcamentos/${id4}`, 'ceo', { estado: 'aceite' })).estado, 200);
    assert.deepEqual(obrasDe(id4).map((o) => [o.id, o.estado, o.por_agendar]), [[obra4, 'agendada', 1]]);
  });

  test('avaria: "Cancelar diagnóstico" segue a regra da visita — sem data ou com mais de 24 h devolve tudo; com menos de 24 h não; "Cliente faltou" também se aplica', async () => {
    const c = await p.contaConfirmada();
    // Sem data marcada (conta como mais de 24 h): devolução total e o pedido fica fechado.
    const id = await enviarAvaria(c);
    let l = await pedidoConta(c, id);
    assert.deepEqual(l.visita_cancelar, { pode: true, devolucao: DIAG_SINTRA, motivo: null, avaria: true });
    const r = await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {});
    assert.deepEqual(r.json, { ok: true, devolvido: DIAG_SINTRA, manual: false });
    assert.match(p.emails.at(-1).texto, /Cancelou o diagnóstico da avaria/);
    let f = await ficha(id);
    assert.deepEqual([f.estado, f.motivo_perda, f.pagamentos.map((x) => [x.fase, x.estado, x.devolvido])], ['perdido', 'Diagnóstico cancelado pelo cliente (devolvido).', [['avaria', 'devolvido', DIAG_SINTRA]]]);
    assert.ok(f.historico.some((h) => h.acao === 'visita_cancelada_cliente' && h.detalhes.avaria === true));
    // Marcada para daqui a 3 dias: devolve.
    const id2 = await enviarAvaria(c);
    await painel('POST', `orcamentos/${id2}/marcar-visita`, 'ceo', { data_visita: lisboa(p.relogio.agora() + 72 * HORA) });
    assert.equal((await pedidoConta(c, id2)).visita_cancelar.pode, true);
    assert.equal((await conta(c, 'POST', `pedidos/${id2}/cancelar-visita`, {})).estado, 200);
    // Avaria urgente, marcada para hoje (daqui a 5 h): já não há devolução.
    const id3 = await enviarAvaria(c);
    await painel('POST', `orcamentos/${id3}/marcar-visita`, 'ceo', { data_visita: lisboa(p.relogio.agora() + 5 * HORA) });
    l = await pedidoConta(c, id3);
    assert.deepEqual(l.visita_cancelar, { pode: false, devolucao: null, motivo: 'Já não é possível cancelar com devolução (faltam menos de 24 h para o diagnóstico).', avaria: true });
    const tarde = await conta(c, 'POST', `pedidos/${id3}/cancelar-visita`, {});
    assert.equal(tarde.estado, 409);
    assert.match(tarde.json.erro, /menos de 24 h para o diagnóstico/);
    assert.equal((await ficha(id3)).pagamentos[0].estado, 'pago');
    // Não estava em casa: "Cliente faltou" — o diagnóstico fica pago, sem devolução, e deixa de valer como visita.
    p.relogio.avancar(6 * HORA);
    try {
      const fl = await painel('POST', `orcamentos/${id3}/visita-faltou`, 'ceo', {});
      assert.equal(fl.estado, 200, fl.texto);
      assert.deepEqual(fl.json.pagamentos.map((x) => [x.fase, x.estado, x.nao_realizada]), [['avaria', 'pago', true]]);
      l = await pedidoConta(c, id3);
      assert.deepEqual([l.visita_cancelar, l.compras.visita.paga, l.compras.pode, l.pagamentos[0].nao_realizada], [null, false, true, true], 'para avançar, marca e paga uma visita nova');
      assert.equal((await conta(c, 'POST', `pedidos/${id3}/pagar`, { fase: 'relatorio_pormenorizado' })).estado, 409, 'na avaria não há relatório à parte');
      const nova = await pagar(c, id3, 'visita');
      assert.equal(nova.valor, VISITA_SINTRA);
      // No sinal só desconta a visita nova (o diagnóstico a que faltou não).
      await painel('POST', `orcamentos/${id3}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
      const v = (await ficha(id3)).valores_pagamento;
      assert.deepEqual([v.pago_antes, v.sinal], [VISITA_SINTRA, Math.round((369 - VISITA_SINTRA) * 100) / 100]);
    } finally { p.relogio.avancar(-6 * HORA); }
  });

  test('visita a que o cliente faltou não desconta no sinal; a visita nova, paga depois, desconta (só essa)', async () => {
    const c = await p.contaConfirmada();
    const id = await enviar(c, sim(), 'Sintra');
    await pagar(c, id, 'visita');
    await painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: lisboa(p.relogio.agora() + 2 * HORA) });
    p.relogio.avancar(3 * HORA);
    try {
      assert.equal((await painel('POST', `orcamentos/${id}/visita-faltou`, 'comercial', {})).estado, 200);
      await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
      let v = (await ficha(id)).valores_pagamento;
      assert.deepEqual([v.total, v.pago_antes, v.desconto, v.sinal, v.restante], [1230, 0, 0, 369, 861], 'a visita não realizada não é "já pago"');
      let l = await pedidoConta(c, id);
      assert.deepEqual(l.sinal, { valor: 369, pct: 30, desconto: 0, pago: false, cobre_material: false });
      assert.deepEqual(l.pagamentos.map((x) => [x.fase, x.estado, x.nao_realizada ?? false]), [['visita', 'pago', true]], '"Visita não realizada — não desconta"');
      assert.deepEqual([l.compras.visita.paga, l.compras.pode], [false, true]);
      // Marca e paga uma visita nova (a segunda "visita" paga do mesmo pedido: a primeira saiu do índice único).
      const nova = await pagar(c, id, 'visita');
      assert.equal(nova.valor, VISITA_SINTRA);
      v = (await ficha(id)).valores_pagamento;
      assert.deepEqual([v.pago_antes, v.sinal, v.restante], [VISITA_SINTRA, Math.round((369 - VISITA_SINTRA) * 100) / 100, 861], 'só a visita que conta');
      l = await pedidoConta(c, id);
      assert.deepEqual(l.pagamentos.map((x) => [x.fase, x.estado, x.nao_realizada ?? false]), [['visita', 'pago', true], ['visita', 'pago', false]], 'a conta mostra as duas: a não realizada e a nova');
      assert.equal(l.sinal.desconto, VISITA_SINTRA);
      // No fim o cliente pagou a proposta com IVA mais a visita a que faltou.
      const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1000, plano: 'base' });
      await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
      await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {});
      assert.equal((await pagar(c, id, 'restante')).valor, 861);
      const pagos = (await ficha(id)).pagamentos.filter((x) => x.estado === 'pago');
      assert.equal(Math.round(pagos.reduce((t, x) => t + x.valor * 100, 0)), 123_000 + 2620);
      assert.deepEqual((await ficha(id)).ligar_casa, { pode: true, falta: 0, aviso: null });
    } finally { p.relogio.avancar(-3 * HORA); }
  });

  test('totais e CSV dos pagamentos dos pedidos: uma devolução parcial desconta nos totais e vai numa linha própria, a negativo', async () => {
    const c = await p.contaConfirmada();
    const antes = (await painel('GET', 'pagamentos-pedido')).json.total_pago;
    const id = await enviar(c, sim(), 'Sintra');
    const pg = await pagar(c, id, 'pormenorizado_visita');   // 29 € + 26,20 €
    let t = (await painel('GET', 'pagamentos-pedido')).json.total_pago;
    assert.equal(Math.round((t.total - antes.total) * 100), 5520);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {})).json.devolvido, VISITA_SINTRA);
    const g = (await painel('GET', 'pagamentos-pedido')).json;
    t = g.total_pago;
    assert.equal(Math.round((t.total - antes.total) * 100), 2900, 'fica só o relatório');
    assert.equal(Math.round((t.base - antes.base) * 100), 2358);
    assert.equal(Math.round((t.iva - antes.iva) * 100), 542);
    assert.equal(t.pagamentos, antes.pagamentos + 1);
    const lin = g.pagamentos.find((x) => x.ref === pg.ref);
    assert.deepEqual([lin.valor, lin.estado, lin.devolvido, lin.devolvido_base, lin.devolvido_iva], [55.2, 'pago', 26.2, 21.3, 4.9]);
    const linhas = (await csv()).filter((x) => x.includes(pg.ref));
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /;44,88;10,32;55,20;pago;\d+$/);
    assert.match(linhas[1], /;Devolução: Relatório completo e visita técnica do pedido[^;]*;-21,30;-4,90;-26,20;devolucao;\d+$/);
    // Uma devolução total: o pagamento fica "devolvido" (fora dos pagos) e o CSV soma zero.
    const id2 = await enviar(c, sim(), 'Sintra');
    const v = await pagar(c, id2, 'visita');
    await conta(c, 'POST', `pedidos/${id2}/cancelar-visita`, {});
    assert.equal((await painel('GET', 'pagamentos-pedido')).json.total_pago.total, t.total);
    const l2 = (await csv()).filter((x) => x.includes(v.ref));
    assert.match(l2[0], /;26,20;devolvido;\d+$/);
    assert.match(l2[1], /;-26,20;devolucao;\d+$/);
    assert.equal((await painel('GET', 'pagamentos-pedido?estado=devolvido')).json.pagamentos.some((x) => x.ref === v.ref), true);
  });

  test('pago por referência Multibanco: a devolução é manual — a conta dá o IBAN (validado, mascarado, fora dos registos), o painel mostra "Devolução por fazer" e só conta depois de o CEO marcar "Devolvido"', async () => {
    const c = await p.contaConfirmada();
    const outro = await p.contaConfirmada();
    const id = await enviar(c, sim(), 'Sintra');
    const pg = await pagar(c, id, 'visita', 'multibanco');
    const antes = (await painel('GET', 'pagamentos-pedido')).json.total_pago;
    const r = await conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {});
    assert.deepEqual(r.json, { ok: true, devolvido: VISITA_SINTRA, manual: true });
    assert.match(p.emails.at(-1).texto, /Como pagou por referência Multibanco, devolvemos 26,20 € por transferência bancária: indique o IBAN/);
    // A visita está cancelada, mas o dinheiro ainda não voltou: o pagamento continua "pago", com o valor a devolver.
    let f = await ficha(id);
    assert.deepEqual(f.pagamentos.map((x) => [x.fase, x.estado, x.a_devolver, x.devolvido, x.metodo]), [['visita', 'pago', VISITA_SINTRA, null, 'multibanco']]);
    assert.deepEqual([f.data_visita, f.compras.visita.paga], [null, false]);
    assert.deepEqual(f.devolucoes.map((d) => [d.valor, d.motivo, d.estado, d.estado_texto, d.iban]), [[VISITA_SINTRA, 'visita', 'pede_iban', 'À espera do IBAN do cliente', null]]);
    const dev = f.devolucoes[0].id;
    assert.equal((await painel('GET', 'pagamentos-pedido')).json.total_pago.total, antes.total, 'ainda conta como pago');
    assert.equal((await csv()).filter((x) => x.includes(pg.ref)).length, 1, 'sem linha de devolução no CSV');
    assert.equal((await painel('POST', `devolucoes/${dev}/devolvida`, 'ceo', {})).estado, 409, 'falta o IBAN');
    // Já não se desconta no sinal, e a visita compra-se outra vez.
    let l = await pedidoConta(c, id);
    assert.deepEqual(l.devolucoes.map((d) => [d.id, d.estado, d.iban]), [[dev, 'pede_iban', null]]);
    assert.equal(l.pagamentos[0].a_devolver, VISITA_SINTRA);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita' })).estado, 200);
    // IBAN: só a conta dona; português e com o módulo 97 certo.
    assert.equal((await conta(outro, 'POST', `devolucoes/${dev}/iban`, { iban: IBAN, titular: 'Outro' })).estado, 404);
    for (const iban of ['', 'PT50 0002 0123 1234 5678 9015 5', 'ES91 2100 0418 4502 0005 1332', 'PT50 0002 0123', 12]) {
      assert.equal((await conta(c, 'POST', `devolucoes/${dev}/iban`, { iban, titular: 'Carla Neves' })).estado, 400, String(iban));
    }
    assert.equal((await conta(c, 'POST', `devolucoes/${dev}/iban`, { iban: IBAN, titular: ' ' })).estado, 400, 'sem titular');
    const dado = await conta(c, 'POST', `devolucoes/${dev}/iban`, { iban: IBAN.toLowerCase(), titular: 'Carla Neves' });
    assert.equal(dado.estado, 200, dado.texto);
    assert.deepEqual([dado.json.devolucao.estado, dado.json.devolucao.iban, dado.json.devolucao.titular], ['por_fazer', 'PT50 •••• 0154', 'Carla Neves']);
    assert.ok(!dado.texto.includes(IBAN_LIMPO), 'a conta só recebe o IBAN mascarado');
    assert.equal(p.app.db.prepare('SELECT iban FROM devolucoes_pedido WHERE id = ?').get(dev).iban, IBAN_LIMPO, 'guardado só na devolução');
    // O painel: mascarado na ficha (o comercial vê-a); inteiro, com o titular, só na lista do CEO.
    const fc = await painel('GET', `orcamentos/${id}`, 'comercial');
    assert.ok(!fc.texto.includes(IBAN_LIMPO));
    assert.deepEqual(fc.json.devolucoes.map((d) => [d.estado_texto, d.iban]), [['Devolução por fazer', 'PT50 •••• 0154']]);
    const lista = (await painel('GET', 'pagamentos-pedido')).json.devolucoes_por_fazer.find((d) => d.id === dev);
    assert.deepEqual([lista.valor, lista.estado, lista.iban, lista.titular, lista.orcamento_id], [VISITA_SINTRA, 'por_fazer', IBAN_LIMPO, 'Carla Neves', id]);
    assert.equal((await painel('GET', 'pagamentos-pedido', 'comercial')).estado, 403);
    // Nunca nos registos: nem auditoria, nem emails, nem o pedido, nem o pagamento.
    for (const [nome, texto] of [['auditoria', JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all())], ['emails', JSON.stringify(p.emails)],
      ['orcamentos', JSON.stringify(p.app.db.prepare('SELECT * FROM orcamentos').all())], ['pagamentos', JSON.stringify(p.app.db.prepare('SELECT * FROM pagamentos_pedido').all())]]) {
      assert.ok(!texto.includes(IBAN_LIMPO) && !texto.includes('0002 0123'), nome);
    }
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'devolucao_iban'").get());
    // "Devolvido" (só o CEO): data e quem; agora sim conta como devolvido; do IBAN fica só o fim.
    assert.equal((await painel('POST', `devolucoes/${dev}/devolvida`, 'comercial', {})).estado, 403);
    const feito = await painel('POST', `devolucoes/${dev}/devolvida`, 'ceo', {});
    assert.equal(feito.estado, 200, feito.texto);
    assert.deepEqual([feito.json.devolucao.estado, feito.json.devolucao.iban, feito.json.devolucao.devolvido_por, Boolean(feito.json.devolucao.devolvido)], ['devolvido', 'PT50 •••• 0154', p.u.ceo.email, true]);
    assert.ok(!feito.json.devolucoes_por_fazer.some((d) => d.id === dev));
    assert.equal(p.app.db.prepare('SELECT iban FROM devolucoes_pedido WHERE id = ?').get(dev).iban, 'PT50 •••• 0154');
    assert.match(p.emails.at(-1).texto, /Fizemos a transferência de 26,20 € para a conta que indicou \(PT50 •••• 0154\)/);
    f = await ficha(id);
    assert.deepEqual(f.pagamentos.filter((x) => x.ref === pg.ref).map((x) => [x.estado, x.a_devolver, x.devolvido]), [['devolvido', null, VISITA_SINTRA]]);
    assert.equal(Math.round(((await painel('GET', 'pagamentos-pedido')).json.total_pago.total - antes.total) * 100), -2620);
    assert.match((await csv()).filter((x) => x.includes(pg.ref))[1], /;-26,20;devolucao;\d+$/);
    assert.equal((await painel('POST', `devolucoes/${dev}/devolvida`, 'ceo', {})).estado, 409, 'já marcada');
    assert.equal((await conta(c, 'POST', `devolucoes/${dev}/iban`, { iban: IBAN, titular: 'Carla Neves' })).estado, 409, 'já feita: o IBAN não se muda');
    l = await pedidoConta(c, id);
    assert.deepEqual(l.devolucoes.map((d) => [d.estado, d.iban]), [['devolvido', 'PT50 •••• 0154']]);
    // Cartão e MB Way continuam automáticos.
    const id2 = await enviar(c, sim(), 'Sintra');
    await pagar(c, id2, 'visita', 'mb_way');
    assert.deepEqual((await conta(c, 'POST', `pedidos/${id2}/cancelar-visita`, {})).json, { ok: true, devolvido: VISITA_SINTRA, manual: false });
    assert.equal((await ficha(id2)).devolucoes.length, 0);
    // Sinal pago por Multibanco e devolvido pelo CEO: também por transferência, à espera do IBAN.
    const id3 = await enviar(c);
    await comSinal(c, id3, 'multibanco');
    const ds = await painel('POST', `orcamentos/${id3}/devolver-sinal`, 'ceo', {});
    assert.equal(ds.estado, 200, ds.texto);
    assert.deepEqual([ds.json.estado, ds.json.obra.estado, ds.json.pagamentos.map((x) => [x.fase, x.estado, x.a_devolver]), ds.json.devolucoes.map((d) => [d.motivo, d.estado, d.valor])],
      ['perdido', 'cancelada', [['sinal', 'pago', 369]], [['sinal', 'pede_iban', 369]]]);
    assert.match(p.emails.at(-1).texto, /devolvemos 369,00 € do sinal por transferência bancária: indique o IBAN/);
    assert.equal((await painel('POST', `orcamentos/${id3}/devolver-sinal`, 'ceo', {})).estado, 409);
    // Apagar a conta (RGPD): das devoluções feitas sai o titular; o pedido com obra é anonimizado, não apagado.
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email })).estado, 200);
    assert.deepEqual([p.app.db.prepare('SELECT titular, iban FROM devolucoes_pedido WHERE id = ?').get(dev).titular, p.app.db.prepare('SELECT nome FROM orcamentos WHERE id = ?').get(id3).nome], [null, 'Anonimizado (RGPD)']);
  });
});

describe('devolução manual (modo stripe)', () => {
  let p;
  const chamadas = [];
  let metodo = 'multibanco';
  const fetchStripe = async (url, op) => {
    chamadas.push({ url, op });
    const params = new URLSearchParams(op.body ?? '');
    if (/checkout\/sessions$/.test(url)) return new Response(JSON.stringify({ id: `cs_test_${chamadas.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${chamadas.length}`, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) }), { status: 200 });
    const m = /checkout\/sessions\/(cs_test_\d+)(\?|$)/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], object: 'checkout.session', status: 'complete', payment_status: 'paid', payment_intent: { id: 'pi_1', latest_charge: { payment_method_details: { type: metodo } } } }), { status: 200 });
    return new Response(JSON.stringify({ id: 're_1', status: 'succeeded' }), { status: 200 });
  };
  before(async () => { p = await painelComEquipa({ fetchStripe, env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: 'whsec_x', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());

  test('o método vem do Stripe (PaymentIntent): Multibanco → sem POST refunds, fica "à espera do IBAN"; MB Way → reembolso automático; evento assíncrono anota Multibanco', async () => {
    const pag = p.app.api.pagamentosPedido;
    async function visitaPaga(c, tipo = 'checkout.session.completed') {
      const env = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', localidade: 'Sintra', simulacao: sim(), compra: 'visita' } });
      assert.equal(env.estado, 201, env.texto);
      const ref = env.json.pagamento.ref;
      const sessao = p.app.db.prepare('SELECT stripe_sessao FROM pagamentos_pedido WHERE ref = ?').get(ref).stripe_sessao;
      assert.equal(pag.tratarEvento({ id: `evt_${ref}`, type: tipo, data: { object: { id: sessao, object: 'checkout.session', client_reference_id: ref, amount_total: 2620, currency: 'eur', payment_status: 'paid' } } }), 'pago');
      return { id: env.json.pedido, ref };
    }
    const c = await p.contaConfirmada();
    // Multibanco (o PaymentIntent diz o método): nenhuma chamada a /refunds.
    metodo = 'multibanco';
    const a = await visitaPaga(c);
    const n = chamadas.length;
    const r = await p.pedir('POST', `/api/conta/pedidos/${a.id}/cancelar-visita`, { cookie: c.cookie, corpo: {} });
    assert.deepEqual(r.json, { ok: true, devolvido: 26.2, manual: true });
    assert.deepEqual(chamadas.slice(n).map((x) => [x.op.method, /refunds/.test(x.url)]), [['GET', false]], 'só leu a sessão');
    assert.match(chamadas.at(-1).url, /expand(\[\]|%5B%5D)=payment_intent\.latest_charge$/);
    assert.deepEqual(Object.values(p.app.db.prepare('SELECT estado, a_devolver, metodo FROM pagamentos_pedido WHERE ref = ?').get(a.ref)), ['pago', 2620, 'multibanco']);
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM devolucoes_pedido WHERE estado = 'pede_iban'").get().n, 1);
    // MB Way: reembolso automático pelo Stripe.
    metodo = 'mb_way';
    const b = await visitaPaga(c);
    const rb = await p.pedir('POST', `/api/conta/pedidos/${b.id}/cancelar-visita`, { cookie: c.cookie, corpo: {} });
    assert.deepEqual(rb.json, { ok: true, devolvido: 26.2, manual: false });
    assert.match(chamadas.at(-1).url, /\/v1\/refunds$/);
    assert.equal(p.app.db.prepare('SELECT estado FROM pagamentos_pedido WHERE ref = ?').get(b.ref).estado, 'devolvido');
    // Confirmado por evento assíncrono (só o Multibanco confirma depois): fica logo anotado.
    const d = await visitaPaga(c, 'checkout.session.async_payment_succeeded');
    assert.equal(p.app.db.prepare('SELECT metodo FROM pagamentos_pedido WHERE ref = ?').get(d.ref).metodo, 'multibanco');
  });
});
