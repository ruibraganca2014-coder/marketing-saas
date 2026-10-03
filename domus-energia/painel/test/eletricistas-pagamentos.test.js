// Eletricistas externos, fase 4 ronda 3 (docs/ELETRICISTAS.md; src/eletricistas.js): a confirmação do cliente na conta
// (Sim com estrelas / Não com o que falta / 7 dias sem resposta), a aprovação do CEO (a obra fica concluída e o valor
// fixado), o pagamento ao eletricista (as três condições, o prazo, a fatura-recibo, o IBAN, "Pago"), quem larga nunca
// recebe, os valores da obra / visita / avaria com outra percentagem e outro IVA, a "visita sem defeito" e o interruptor.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { estadoPagamento, estadoRegresso, prazoPagamento, PRAZO_CONFIRMAR_MS, PRAZO_PAGAMENTO_MS, PRAZO_VISITA_MS, SEGURO_MAX_BYTES } from '../src/eletricistas.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const doc = (bytes = PDF, tipo = 'application/pdf') => ({ tipo, dados: bytes.toString('base64') });
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const IBAN = 'PT50000201231234567890154';   // IBAN de exemplo (válido no módulo 97)
const HORA = 3600_000;
const DIA = 24 * HORA;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();

test('migração 30: estados e eventos novos (confirmada, aprovada, paga…), colunas da confirmação, do valor, da fatura e do pagamento, e o IBAN; os dados ficam', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 29; i++) MIGRACOES[i](db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 29');
  const agora = '2026-10-02T10:00:00Z';
  db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES (?, ?, 'Ana', 'Casa')").run(agora, agora);
  db.prepare("INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, estado, consentimento, criado, atualizado) VALUES ('a@exemplo.pt', 'E', '910000000', '123456789', 'TR-1', 'aprovado', ?, ?, ?)").run(agora, agora, agora);
  const trab = db.prepare("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, aceite_em, visita, criado, atualizado) VALUES (1, 'obra', ?, 'bolsa', 'Sintra', 1, 70, 5, '2026-10-05T10:00', ?, ?)");
  trab.run('retirado', agora, agora);
  trab.run('concluida_eletricista', agora, agora);
  db.prepare("UPDATE trabalhos_eletricista SET concluida = ?, material_recebido = '[\"Quadro\"]' WHERE id = 2").run(agora);
  db.prepare("INSERT INTO trabalhos_eletricista_eventos (trabalho_id, eletricista_id, evento, quando, por) VALUES (2, 1, 'concluida', ?, 'eletricista:1')").run(agora);
  db.prepare("INSERT INTO trabalhos_eletricista_fotos (id, trabalho_id, grupo, tipo_mime, bytes, eletricista_id, criado) VALUES (?, 2, 'quadro_antes', 'image/jpeg', 10, 1, ?)").run('a'.repeat(24), agora);
  db.prepare('DELETE FROM trabalhos_eletricista WHERE id = 1').run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.ok(MIGRACOES.length >= 30);
  const t = db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = 2').get();
  assert.deepEqual([t.estado, t.eletricista_id, t.percentagem, t.concluida, t.material_recebido], ['concluida_eletricista', 1, 70, agora, '["Quadro"]']);
  for (const k of ['confirmada', 'confirmada_auto', 'estrelas', 'comentario', 'comentario_site', 'reclamacao', 'reclamacao_de', 'reclamacao_quando', 'reclamacao_decisao', 'reclamacao_decidida',
    'aprovada', 'aprovada_por', 'valor_cent', 'valor_detalhe', 'fatura_id', 'fatura_tipo', 'fatura_bytes', 'fatura_quando', 'paga', 'paga_por']) assert.equal(t[k], null, k);
  assert.equal(db.prepare('SELECT iban FROM eletricistas WHERE id = 1').get().iban, null);
  // 31: a ida sem defeito (linha própria do pagamento).
  for (const k of ['regresso_desde', 'regresso_cent', 'regresso_detalhe', 'regresso_fatura_id', 'regresso_fatura_tipo', 'regresso_fatura_bytes', 'regresso_fatura_quando', 'regresso_paga', 'regresso_paga_por']) assert.equal(t[k], null, k);
  assert.throws(() => db.prepare("UPDATE trabalhos_eletricista SET regresso_fatura_tipo = 'text/html' WHERE id = 2").run(), /CHECK/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_eventos').get().n + db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos').get().n, 2, 'eventos e fotos ficam');
  const ev = db.prepare("INSERT INTO trabalhos_eletricista_eventos (trabalho_id, eletricista_id, evento, quando, por) VALUES (2, 1, ?, ?, 'x')");
  for (const estado of ['confirmada', 'aprovada', 'paga']) db.prepare('UPDATE trabalhos_eletricista SET estado = ? WHERE id = 2').run(estado);
  for (const e of ['confirmada', 'contestada', 'devolvida', 'aprovada', 'paga']) ev.run(e, agora);
  assert.throws(() => ev.run('inventado', agora), /CHECK/);
  assert.throws(() => db.prepare("UPDATE trabalhos_eletricista SET estado = 'outro' WHERE id = 2").run(), /CHECK/);
  assert.throws(() => db.prepare('UPDATE trabalhos_eletricista SET estrelas = 6 WHERE id = 2').run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE trabalhos_eletricista SET reclamacao_de = 'outro' WHERE id = 2").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE trabalhos_eletricista SET fatura_tipo = 'image/svg+xml' WHERE id = 2").run(), /CHECK/);
  // Um trabalho pago continua a contar no índice (pedido, tipo): não se repete o mesmo trabalho (pagava-se duas vezes);
  // um de outro tipo pode. A sequência dos ids continua.
  assert.throws(() => trab.run('na_bolsa', agora, agora), /UNIQUE/);
  db.prepare("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, criado, atualizado) VALUES (1, 'visita', 'na_bolsa', 'bolsa', 'Sintra', ?, ?)").run(agora, agora);
  assert.equal(db.prepare('SELECT MAX(id) AS m FROM trabalhos_eletricista').get().m, 3);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

test('estado do pagamento: só "a pagar" com as três condições (todas as combinações) e a fatura; quem largou nunca recebe; prazo = 7 dias depois da última', () => {
  for (const confirmada of [false, true]) for (const aprovada of [false, true]) for (const restantePago of [false, true]) {
    const todas = confirmada && aprovada && restantePago;
    const esperado = !confirmada ? 'a_aguardar_cliente' : !aprovada ? 'a_aguardar_aprovacao' : !restantePago ? 'a_aguardar_restante' : 'a_pagar';
    assert.equal(estadoPagamento({ confirmada, aprovada, restantePago, fatura: true }), esperado, JSON.stringify({ confirmada, aprovada, restantePago }));
    assert.equal(estadoPagamento({ confirmada, aprovada, restantePago, fatura: true }) === 'a_pagar', todas);
    assert.equal(estadoPagamento({ confirmada, aprovada, restantePago, fatura: false }), todas ? 'fatura_em_falta' : esperado);
    assert.equal(estadoPagamento({ largou: true, confirmada, aprovada, restantePago, fatura: true }), 'sem_pagamento');
  }
  assert.equal(estadoPagamento({ paga: true, confirmada: true, aprovada: true, restantePago: true, fatura: true }), 'pago');
  assert.equal(estadoPagamento({ largou: true, paga: true }), 'sem_pagamento');
  assert.equal(estadoPagamento({}), 'a_aguardar_cliente');
  // A ida sem defeito: visita paga pelo cliente + trabalho aprovado + a fatura dessa ida.
  for (const visitaPaga of [false, true]) for (const aprovada of [false, true]) for (const fatura of [false, true]) {
    const esperado = !visitaPaga ? 'a_aguardar_visita' : !aprovada ? 'a_aguardar_aprovacao' : fatura ? 'a_pagar' : 'fatura_em_falta';
    assert.equal(estadoRegresso({ visitaPaga, aprovada, fatura }), esperado, JSON.stringify({ visitaPaga, aprovada, fatura }));
    assert.equal(estadoRegresso({ largou: true, visitaPaga, aprovada, fatura }), 'sem_pagamento');
  }
  assert.equal(estadoRegresso({ paga: true, visitaPaga: true, aprovada: true, fatura: true }), 'pago');
  assert.equal(prazoPagamento(['2026-10-01T10:00:00.000Z', '2026-10-05T09:00:00.000Z', '2026-10-03T00:00:00.000Z']), '2026-10-12T09:00:00Z');
  assert.equal(prazoPagamento(['2026-10-01T10:00:00.000Z', null]), '2026-10-08T10:00:00Z');
  assert.equal(prazoPagamento([null, undefined]), null);
  assert.equal(PRAZO_PAGAMENTO_MS, 7 * DIA);
  assert.equal(PRAZO_CONFIRMAR_MS, 7 * DIA);
});

describe('ronda 3: confirmação do cliente, aprovação do CEO e pagamento ao eletricista', () => {
  let p;
  let seq = 0;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());

  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const confirmar = (c, id, corpo) => conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, corpo);
  const atribuicao = (id, corpo) => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, 'ceo', corpo);
  const linha = (tid) => ({ ...p.app.db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = ?').get(tid) });
  const meusPagamentos = async (e) => (await area(e, 'GET', 'pagamentos')).json;
  const noPainel = async (tid) => (await painel('GET', 'pagamentos-eletricistas')).json.trabalhos.find((x) => x.id === tid);

  async function aprovado(extra = {}) {
    const n = ++seq;
    const c = { nome: `Eletricista Ronda3 ${n}`, email: `eletricista.r3.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${3000 + n}`,
      concelhos: ['Sintra'], seguro: doc(), consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `eletricistas/${id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...c, id, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Pedido de um cliente com conta, proposta em três partes aceite e o sinal pago (a obra nasce). Devolve {c, id}. */
  async function obraDoCliente({ mao = 1000, material = 500, deslocacao = 30 } = {}) {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Casa inteligente', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: mao, proposta_material: material, proposta_deslocacao: deslocacao })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: mao + material + deslocacao, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    return { c, id };
  }
  /** O eletricista faz o trabalho todo: visita marcada, fotos de antes e de depois, os três ensaios e "concluído". */
  async function fazer(e, tid, { avaria = false } = {}) {
    if (linha(tid).estado === 'aceite') assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    for (const g of ['quadro_antes', 'quadro_depois']) {
      const f = await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${g}`, { cookie: e.cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(f.estado, 201, f.texto);
    }
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    if (avaria) assert.equal((await area(e, 'POST', `trabalhos/${tid}/diagnostico`, { diagnostico: { verificacoes: ['isolado'], tipo: 'aberto', conclusao: 'Borne solto: reapertado.' } })).estado, 200);
    const r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
  }
  /** Obra de um cliente atribuída a `e` e dada por concluída. Devolve {c, id, tid}. */
  async function obraConcluida(e, partes) {
    const { c, id } = await obraDoCliente(partes);
    const a = await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    await fazer(e, tid);
    return { c, id, tid };
  }
  async function pagarRestante(c, id) {
    const r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'restante' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
  }

  test('o fluxo todo de uma obra: o cliente diz "Não" e depois "Sim" com estrelas, o CEO aprova (obra concluída, valor fixado), restante, fatura, IBAN e "Pago"', async () => {
    const e = await aprovado({ nome: 'Zeferino Eletricista Externo' });
    const outro = await aprovado();
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: 65 })).estado, 200);
    const { c, id, tid } = await obraConcluida(e);
    const estranho = await p.contaConfirmada();

    // ---- a conta do cliente: "O trabalho ficou concluído?" — sem nada de quem o fez
    let l = await pedidoConta(c, id);
    assert.deepEqual([l.confirmacao.estado, l.confirmacao.tipo], ['por_confirmar', 'Obra']);
    assert.equal(Date.parse(l.confirmacao.prazo) - Date.parse(l.confirmacao.concluida), 7 * DIA);
    for (const dado of ['Zeferino', e.email, e.nif, 'eletricista']) assert.ok(!JSON.stringify(l).includes(dado), `a conta não leva "${dado}"`);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/confirmar-trabalho`, { corpo: { concluido: true, estrelas: 5 } })).estado, 401);
    assert.equal((await confirmar(estranho, id, { concluido: true, estrelas: 5 })).estado, 404, 'o pedido de outra conta');
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/confirmar-trabalho`, { cookie: e.cookie, corpo: { concluido: true, estrelas: 5 } })).estado, 401, 'a sessão do eletricista não confirma');
    for (const mau of [{}, { concluido: 'sim' }, { concluido: true }, { concluido: true, estrelas: 0 }, { concluido: true, estrelas: 6 }, { concluido: true, estrelas: 4.5 }, { concluido: true, estrelas: '5' },
      { concluido: true, estrelas: 5, site: 'sim' }, { concluido: true, estrelas: 5, comentario: 'x'.repeat(1001) }, { concluido: false }, { concluido: false, descricao: '   ' }, { concluido: true, estrelas: 5, outro: 1 }]) {
      assert.equal((await confirmar(c, id, mau)).estado, 400, JSON.stringify(mau));
    }
    assert.equal(linha(tid).estado, 'concluida_eletricista');
    // O CEO ainda não pode aprovar; devolver já pode (testado mais abaixo).
    let a = (await atribuicao(id)).json.trabalho;
    assert.deepEqual([a.pode_aprovar, a.pode_devolver, a.pode_decidir, a.pagamento.pagamento], [false, true, false, 'a_aguardar_cliente']);
    let r = await atribuicao(id, { acao: 'aprovar' });
    assert.deepEqual([r.estado, r.json.erro], [409, 'O cliente ainda não confirmou o trabalho (fica aceite ao fim de 7 dias sem resposta).']);

    // ---- "Não": volta ao eletricista com o texto do cliente; o CEO decide "defeito" (volta sem receber mais)
    p.emails.length = 0;
    r = await confirmar(c, id, { concluido: false, descricao: 'A tomada da cozinha continua sem corrente.' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.pedido.confirmacao.estado, r.json.pedido.confirmacao.descricao, r.json.pedido.confirmacao.decisao], ['contestada', 'A tomada da cozinha continua sem corrente.', null]);
    assert.deepEqual([linha(tid).estado, linha(tid).concluida, linha(tid).reclamacao_de], ['visita_marcada', null, 'cliente']);
    assert.ok(p.emails.some((m) => m.para === e.email && /respondeu que não ficou concluído/.test(m.texto)));
    assert.ok(p.emails.some((m) => m.para === p.u.ceo.email && /defeito/.test(m.texto)));
    assert.ok(!p.emails.some((m) => m.para === e.email && m.texto.includes(c.email)), 'o email do cliente nunca vai para o eletricista');
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 5 })).estado, 409, 'já não está à espera de confirmação');
    let f = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.estado, f.editavel, f.reclamacao.texto, f.reclamacao.de, f.reclamacao.decisao, f.falta], ['visita_marcada', true, 'A tomada da cozinha continua sem corrente.', 'cliente', null, []]);
    a = (await atribuicao(id)).json.trabalho;
    assert.deepEqual([a.pode_decidir, a.pode_aprovar, a.reclamacao.de, a.reclamacao.texto], [true, false, 'cliente', 'A tomada da cozinha continua sem corrente.']);
    for (const papel of ['comercial', 'tecnico']) assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, papel, { acao: 'defeito' })).estado, 403);
    assert.equal((await atribuicao(id, { acao: 'outra' })).estado, 400);
    assert.equal((await atribuicao(id, { acao: 'defeito' })).estado, 200);
    assert.deepEqual([linha(tid).estado, linha(tid).reclamacao_decisao], ['visita_marcada', 'defeito']);
    assert.match(p.emails.at(-1).texto, /não é paga à parte/);
    assert.equal((await atribuicao(id, { acao: 'sem_defeito' })).estado, 409, 'a reclamação já foi decidida');
    assert.equal((await pedidoConta(c, id)).visita_sem_defeito, null, 'com defeito o cliente não paga visita nenhuma');

    // ---- o eletricista corrige e volta a concluir; o cliente diz "Sim" com 4 estrelas, comentário e autorização para o site
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200);
    p.emails.length = 0;
    r = await confirmar(c, id, { concluido: true, estrelas: 4, comentario: 'Ficou tudo a funcionar. Obrigada!', site: true });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.pedido.confirmacao.estado, r.json.pedido.confirmacao.estrelas, r.json.pedido.confirmacao.comentario, r.json.pedido.confirmacao.site, r.json.pedido.confirmacao.automatica],
      ['confirmada', 4, 'Ficou tudo a funcionar. Obrigada!', true, false]);
    assert.ok(p.emails.some((m) => m.para === p.u.ceo.email && /4 em 5 estrelas/.test(m.texto)));
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 1 })).estado, 409, 'só se confirma uma vez');
    assert.equal((await confirmar(c, id, { concluido: false, descricao: 'Afinal não ficou.' })).estado, 409);
    assert.deepEqual([linha(tid).estado, linha(tid).estrelas, linha(tid).confirmada_auto], ['confirmada', 4, 0]);

    // ---- o eletricista vê o pagamento "a aguardar aprovação"; a fatura só depois de aprovado
    let m = await meusPagamentos(e);
    assert.deepEqual(m.trabalhos.map((x) => [x.id, x.pagamento, x.valor.total, x.valor_fixado, x.prazo, x.fatura, x.pode_fatura]), [[tid, 'a_aguardar_aprovacao', 680, false, null, null, false]]);
    assert.deepEqual([m.iban, m.prazo_dias], [null, 7]);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 409, 'fatura antes de aprovado');
    assert.deepEqual((await meusPagamentos(outro)).trabalhos, [], 'cada um só vê os seus');
    assert.equal((await p.pedir('GET', '/api/eletricista/pagamentos')).estado, 401);

    // ---- o CEO aprova: a obra fica concluída no painel (a mesma ação de sempre: stock e email do restante) e o valor fica fixado
    for (const papel of ['comercial', 'tecnico']) assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, papel, { acao: 'aprovar' })).estado, 403);
    let ped = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.obra_concluida, ped.obra.estado], [null, 'agendada']);
    assert.equal((await pedidoConta(c, id)).pode_pagar_restante, false);
    p.emails.length = 0;
    r = await atribuicao(id, { acao: 'aprovar' });
    assert.equal(r.estado, 200, r.texto);
    ped = (await painel('GET', `orcamentos/${id}`)).json;
    assert.ok(ped.obra_concluida);
    assert.equal(ped.obra.estado, 'concluida');
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'obra_concluida' AND alvo = ?").get(`orcamento:${id}`));
    assert.ok(p.emails.some((x) => x.para === c.email && /Pode pagar o restante/.test(x.texto)));
    assert.ok(p.emails.some((x) => x.para === e.email && /foi aprovado/.test(x.texto) && /fatura-recibo/.test(x.texto)));
    l = await pedidoConta(c, id);
    assert.equal(l.pode_pagar_restante, true, 'o restante do cliente fica pagável');
    let t = linha(tid);
    assert.deepEqual([t.estado, t.valor_cent, t.aprovada_por, JSON.parse(t.valor_detalhe)], ['aprovada', 68000, p.u.ceo.email, { percentagem: 65, mao_obra: 1000, parte_mao_obra: 650, deslocacao: 30, total: 680 }]);
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 409, 'já aprovado');
    assert.equal((await atribuicao(id, { acao: 'devolver', motivo: 'Falta uma tampa.' })).estado, 409, 'depois de aprovado já não se devolve');
    assert.equal((await atribuicao(id, { acao: 'retirar' })).estado, 409, 'nem se retira');
    // O valor está fixado: mudar a percentagem ou a proposta depois não o altera.
    await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: 10 });
    a = (await atribuicao(id)).json;
    assert.deepEqual([a.pode, a.trabalho.ativo, a.trabalho.estado, a.trabalho.pagamento.valor.total, a.trabalho.pagamento.pagamento, a.trabalho.estrelas, a.trabalho.comentario_site],
      [false, false, 'aprovada', 680, 'a_aguardar_restante', 4, true]);
    // Aprovado: o trabalho fecha para o eletricista (sem dados do cliente nem fotos), mas continua nos pagamentos.
    f = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.aberto, f.cliente, f.relatorio, f.fotos, f.editavel], [false, null, null, [], false]);

    // ---- as três condições: falta o restante do cliente → não se paga
    m = await meusPagamentos(e);
    assert.deepEqual([m.trabalhos[0].pagamento, m.trabalhos[0].pagamento_texto, m.trabalhos[0].valor.total, m.trabalhos[0].valor_fixado, m.trabalhos[0].prazo, m.trabalhos[0].pode_fatura],
      ['a_aguardar_restante', 'A aguardar o restante do cliente', 680, true, null, true]);
    r = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {});
    assert.deepEqual([r.estado, r.json.erro], [409, 'Ainda não se pode pagar este trabalho: a aguardar o restante do cliente.']);
    p.relogio.avancar(2 * DIA);
    await pagarRestante(c, id);
    const restanteEm = p.app.db.prepare("SELECT pago FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'restante'").get(id).pago;
    m = await meusPagamentos(e);
    assert.deepEqual([m.trabalhos[0].pagamento, m.trabalhos[0].pagamento_texto], ['fatura_em_falta', 'Fatura em falta']);
    assert.equal(m.trabalhos[0].prazo, prazoPagamento([restanteEm]), 'prazo = 7 dias depois da última condição (o restante)');
    assert.ok(Date.parse(restanteEm) > Date.parse(linha(tid).aprovada) && Date.parse(restanteEm) > Date.parse(linha(tid).confirmada));
    r = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {});
    assert.deepEqual([r.estado, r.json.erro], [409, 'Ainda não se pode pagar este trabalho: fatura em falta.']);

    // ---- IBAN: validado (módulo 97), mascarado para o próprio e nas listas do painel; inteiro só em "Pagamentos a eletricistas"
    for (const mau of ['PT50000201231234567890155', 'ES9121000418450200051332', 'PT50 0002', 'abc', 12345]) assert.equal((await area(e, 'POST', 'iban', { iban: mau })).estado, 400, String(mau));
    assert.equal((await p.pedir('POST', '/api/eletricista/iban', { corpo: { iban: IBAN } })).estado, 401);
    r = await area(e, 'POST', 'iban', { iban: 'pt50 0002 0123 1234 5678 9015 4' });
    assert.deepEqual([r.estado, r.json], [200, { iban: 'PT50 •••• 0154' }]);
    assert.equal(p.app.db.prepare('SELECT iban FROM eletricistas WHERE id = ?').get(e.id).iban, IBAN);
    assert.equal((await area(e, 'GET', 'eu')).json.eletricista.iban, 'PT50 •••• 0154');
    assert.equal((await meusPagamentos(e)).iban, 'PT50 •••• 0154');
    const naLista = (await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id);
    assert.equal(naLista.iban, 'PT50 •••• 0154');
    assert.equal((await painel('GET', `eletricistas/${e.id}`)).json.eletricista.iban, 'PT50 •••• 0154');
    assert.ok(!JSON.stringify((await painel('GET', 'eletricistas')).json).includes(IBAN));

    // ---- fatura-recibo: as regras do documento do seguro (PDF/JPG/PNG pelos bytes, até 5 MB); só o eletricista do trabalho
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 404);
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fatura`, { corpo: doc() })).estado, 401);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'))).estado, 415);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc(Buffer.from('MZ\x90\x00executável'), 'application/pdf'))).estado, 415);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { tipo: 'text/html', dados: 'PGh0bWw+' })).estado, 415);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc(JPEG, 'image/png'))).estado, 415, 'o tipo declarado tem de ser o dos bytes');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { tipo: 'application/pdf' })).estado, 400);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc(Buffer.concat([PDF, Buffer.alloc(SEGURO_MAX_BYTES)])))).estado, 413);
    assert.equal(linha(tid).fatura_id, null);
    p.emails.length = 0;
    r = await area(e, 'POST', `trabalhos/${tid}/fatura`, doc(PNG, 'image/png'));
    assert.equal(r.estado, 201, r.texto);
    const primeira = linha(tid).fatura_id;
    r = await area(e, 'POST', `trabalhos/${tid}/fatura`, doc());
    assert.equal(r.estado, 201, 'enviar outra substitui');
    t = linha(tid);
    assert.match(t.fatura_id, /^[0-9a-f]{24}$/);
    const pastaFatura = join(p.config.eletricistasDir, 'faturas', String(tid));
    assert.equal(existsSync(join(pastaFatura, `${t.fatura_id}.pdf`)), true);
    assert.equal(existsSync(join(pastaFatura, `${primeira}.png`)), false, 'a anterior sai');
    assert.deepEqual([r.json.trabalhos[0].pagamento, r.json.trabalhos[0].fatura.tipo, r.json.trabalhos[0].fatura.url], ['a_pagar', 'application/pdf', `/api/eletricista/trabalhos/${tid}/fatura`]);
    assert.equal(p.emails.filter((x) => x.para === p.u.ceo.email && /fatura-recibo/.test(x.assunto)).length, 1, 'a empresa é avisada (uma vez)');
    let d = await area(e, 'GET', `trabalhos/${tid}/fatura`);
    assert.deepEqual([d.estado, d.cabecalhos['content-type'], d.cabecalhos['x-content-type-options'], d.cabecalhos['content-security-policy'], d.bruto.equals(PDF)],
      [200, 'application/pdf', 'nosniff', "default-src 'none'; sandbox", true]);
    assert.match(d.cabecalhos['content-disposition'], /^attachment; filename="fatura-recibo-trabalho-\d+\.pdf"$/);
    assert.equal((await area(outro, 'GET', `trabalhos/${tid}/fatura`)).estado, 404);
    assert.equal((await p.pedir('GET', `/api/eletricista/trabalhos/${tid}/fatura`, { cookie: c.cookie })).estado, 401, 'a sessão do cliente não a abre');

    // ---- painel "Pagamentos a eletricistas" (só CEO): valor em partes, prazo, fatura e o IBAN inteiro
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await painel('GET', 'pagamentos-eletricistas', papel)).estado, 403);
      assert.equal((await painel('GET', `trabalhos-eletricista/${tid}/fatura`, papel)).estado, 403);
      assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, papel, {})).estado, 403);
    }
    assert.equal((await p.pedir('GET', '/painel/api/pagamentos-eletricistas')).estado, 401);
    let pn = await noPainel(tid);
    assert.deepEqual([pn.orcamento_id, pn.tipo_nome, pn.eletricista.nome, pn.iban, pn.pagamento, pn.valor, pn.prazo, pn.fatura.url],
      [id, 'Obra', 'Zeferino Eletricista Externo', IBAN, 'a_pagar', { percentagem: 65, mao_obra: 1000, parte_mao_obra: 650, deslocacao: 30, total: 680 }, prazoPagamento([restanteEm]), `/painel/api/trabalhos-eletricista/${tid}/fatura`]);
    let geral = (await painel('GET', 'pagamentos-eletricistas')).json;
    const antes = { a_pagar: geral.a_pagar, pago: geral.pago };
    assert.ok(antes.a_pagar.total >= 680);
    d = await painel('GET', `trabalhos-eletricista/${tid}/fatura`);
    assert.deepEqual([d.estado, d.cabecalhos['content-type'], d.cabecalhos['x-content-type-options'], d.bruto.equals(PDF)], [200, 'application/pdf', 'nosniff', true]);
    assert.equal((await painel('GET', 'trabalhos-eletricista/99999/fatura')).estado, 404);

    // ---- "Pago": fica a data e quem; não se paga duas vezes; o email e a auditoria nunca levam o IBAN
    p.emails.length = 0;
    r = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {});
    assert.equal(r.estado, 200, r.texto);
    t = linha(tid);
    assert.deepEqual([t.estado, t.paga_por, Boolean(t.paga)], ['paga', p.u.ceo.email, true]);
    assert.deepEqual([r.json.a_pagar.total, r.json.pago.total], [Math.round((antes.a_pagar.total - 680) * 100) / 100, Math.round((antes.pago.total + 680) * 100) / 100]);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 409);
    assert.ok(p.emails.some((x) => x.para === e.email && /transferência de 680,00 €/.test(x.texto)));
    pn = await noPainel(tid);
    assert.deepEqual([pn.pagamento, pn.pago_por, pn.pago_em], ['pago', p.u.ceo.email, t.paga]);
    m = await meusPagamentos(e);
    assert.deepEqual([m.trabalhos[0].pagamento, m.trabalhos[0].pago_em, m.trabalhos[0].pode_fatura], ['pago', t.paga, false]);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 409, 'depois de pago a fatura já não muda');
    for (const x of p.app.db.prepare('SELECT detalhes FROM auditoria').all()) assert.ok(!String(x.detalhes ?? '').includes(IBAN.slice(4)), 'o IBAN nunca vai para a auditoria');
    assert.ok(!p.emails.some((x) => x.texto.includes(IBAN) || x.texto.includes('0154')), 'nem para os emails');
    assert.deepEqual(p.app.db.prepare('SELECT evento FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? ORDER BY id').all(tid).map((x) => x.evento),
      ['atribuido', 'visita_marcada', 'concluida', 'contestada', 'concluida', 'confirmada', 'aprovada', 'paga']);

    // ---- totais: os eletricistas vão numa linha à parte, sem se misturar com a receita dos clientes
    const tot = (await painel('GET', 'pagamentos-pedido')).json;
    assert.ok(tot.eletricistas.pago.total >= 680);
    assert.ok(tot.pagamentos.every((x) => !/eletricista/i.test(x.estado)), 'as linhas dos clientes ficam como estavam');
    const soClientes = tot.pagamentos.filter((x) => x.estado === 'pago').reduce((s, x) => s + Math.round(x.valor * 100) - Math.round((x.devolvido ?? 0) * 100), 0);
    assert.equal(Math.round(tot.total_pago.total * 100), soClientes, 'o total pago pelos clientes não desconta os eletricistas');
    const csv = (await painel('GET', 'pagamentos-pedido?formato=csv')).texto;
    assert.match(csv, new RegExp(`;eletricista-${tid};Eletricista externo: obra \\(trabalho n\\.º ${tid}\\);-680,00;;-680,00;eletricista_pago;${id}\\r\\n`));
    assert.ok(!csv.includes(IBAN));
    assert.equal((await painel('GET', 'pagamentos-pedido?formato=csv&estado=pago')).texto.includes('eletricista_'), false, 'com filtro de estado saem só os pagamentos dos clientes');
    assert.equal((await painel('GET', 'pagamentos-pedido?mes=2001-01')).json.eletricistas.pago.total, 0);

    // ---- avaliação: média e n.º no painel; o comentário com autorização vai marcado "pode ir para o site"
    const lista = (await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id);
    assert.deepEqual([lista.avaliacao, lista.comentarios.map((x) => [x.orcamento_id, x.estrelas, x.comentario, x.pode_site])], [{ n: 1, media: 4 }, [[id, 4, 'Ficou tudo a funcionar. Obrigada!', true]]]);
    assert.deepEqual((await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === outro.id).avaliacao, { n: 0, media: null });
    assert.deepEqual([lista.trabalhos_em_curso, lista.trabalhos], [0, []], 'um trabalho pago já não está em curso');

    // ---- RGPD: apagar o eletricista tira o IBAN; a fatura-recibo (contabilidade) fica
    r = await painel('POST', `eletricistas/${e.id}/apagar`, 'ceo', { email: e.email });
    assert.deepEqual([r.estado, r.json.modo], [200, 'anonimizado']);
    assert.equal(p.app.db.prepare('SELECT iban FROM eletricistas WHERE id = ?').get(e.id).iban, null);
    assert.equal(existsSync(join(pastaFatura, `${t.fatura_id}.pdf`)), true);
    // … e apagar a conta do cliente tira o que ele escreveu (comentário e reclamação); as estrelas ficam.
    p.app.db.prepare("UPDATE orcamentos SET estado = 'perdido' WHERE id = ?").run(id);
    await p.app.api.eletricistas.apagarFotosDoPedido(id);
    assert.deepEqual([linha(tid).comentario, linha(tid).reclamacao, linha(tid).estrelas], [null, null, 4]);
  });

  test('as três condições no servidor, em todas as combinações: "Pago" só com cliente confirmado + CEO aprovado + restante pago (e a fatura)', async () => {
    const e = await aprovado();
    // Duas obras: numa o cliente já pagou o restante (o CEO deu a obra por concluída à mão), na outra ainda não.
    const paga = await obraConcluida(e);
    assert.equal((await painel('POST', `orcamentos/${paga.id}/obra-concluida`, 'ceo', {})).estado, 200);
    await pagarRestante(paga.c, paga.id);
    const porPagar = await obraConcluida(e);
    assert.equal((await painel('POST', `orcamentos/${porPagar.id}/obra-concluida`, 'ceo', {})).estado, 200);
    const agora = new Date(p.relogio.agora()).toISOString();
    const por = p.app.db.prepare(`UPDATE trabalhos_eletricista SET estado = ?, confirmada = ?, aprovada = ?, concluida = ?, valor_cent = 68000, fatura_id = ?, fatura_tipo = 'application/pdf', fatura_bytes = 10 WHERE id = ?`);
    for (const [obra, restante] of [[porPagar, false], [paga, true]]) {
      for (const confirmada of [false, true]) for (const aprovada of [false, true]) for (const fatura of [true, false]) {
        const todas = confirmada && aprovada && restante;
        if (todas && fatura) continue;   // a única combinação que paga: fica para o fim
        por.run(aprovada ? 'aprovada' : confirmada ? 'confirmada' : 'concluida_eletricista', confirmada ? agora : null, aprovada ? agora : null, agora, fatura ? 'a'.repeat(24) : null, obra.tid);
        const esperado = !confirmada ? 'a_aguardar_cliente' : !aprovada ? 'a_aguardar_aprovacao' : !restante ? 'a_aguardar_restante' : 'fatura_em_falta';
        const caso = JSON.stringify({ confirmada, aprovada, restante, fatura });
        assert.equal((await noPainel(obra.tid)).pagamento, esperado, caso);
        assert.equal((await meusPagamentos(e)).trabalhos.find((x) => x.id === obra.tid).pagamento, esperado, caso);
        assert.equal((await noPainel(obra.tid)).prazo === null, !todas, `só há prazo com as três condições: ${caso}`);
        assert.equal((await painel('POST', `trabalhos-eletricista/${obra.tid}/pago`, 'ceo', {})).estado, 409, caso);
        assert.equal(linha(obra.tid).paga, null, caso);
      }
    }
    por.run('aprovada', agora, agora, agora, 'a'.repeat(24), paga.tid);
    assert.equal((await noPainel(paga.tid)).pagamento, 'a_pagar');
    assert.equal((await painel('POST', `trabalhos-eletricista/${paga.tid}/pago`, 'ceo', {})).estado, 200);
    assert.equal(linha(paga.tid).estado, 'paga');
    por.run('aprovada', agora, agora, agora, 'a'.repeat(24), porPagar.tid);
    assert.equal((await painel('POST', `trabalhos-eletricista/${porPagar.tid}/pago`, 'ceo', {})).estado, 409, 'com tudo menos o restante do cliente não se paga');
  });

  test('7 dias sem resposta do cliente: o trabalho fica aceite sozinho (verificado ao ler), sem avaliação; o prazo conta do fim dos 7 dias', async () => {
    const e = await aprovado();
    const { c, id, tid } = await obraConcluida(e);
    const concluida = linha(tid).concluida;
    p.relogio.avancar(4 * DIA);
    assert.equal((await pedidoConta(c, id)).confirmacao.estado, 'por_confirmar');
    assert.equal((await meusPagamentos(e)).trabalhos[0].pagamento, 'a_aguardar_cliente');
    p.relogio.avancar(3 * DIA - 60_000);
    assert.equal((await pedidoConta(c, id)).confirmacao.estado, 'por_confirmar', 'a um minuto dos 7 dias ainda espera');
    assert.equal(linha(tid).estado, 'concluida_eletricista');
    p.relogio.avancar(61_000);
    p.emails.length = 0;
    const l = await pedidoConta(c, id);   // a leitura da conta é que dá pelo prazo
    assert.deepEqual([l.confirmacao.estado, l.confirmacao.automatica, l.confirmacao.estrelas, l.confirmacao.comentario], ['confirmada', true, null, null]);
    const t = linha(tid);
    assert.deepEqual([t.estado, t.confirmada_auto, t.estrelas, Date.parse(t.confirmada) - Date.parse(concluida)], ['confirmada', 1, null, 7 * DIA]);
    assert.ok(p.emails.some((m) => m.para === p.u.ceo.email && /7 dias/.test(m.texto)));
    assert.equal(p.app.db.prepare("SELECT por FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? AND evento = 'confirmada'").get(tid).por, 'sistema');
    assert.equal((await confirmar(c, id, { concluido: false, descricao: 'Afinal falta uma coisa.' })).estado, 409, 'depois dos 7 dias já não se contesta na conta');
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 5 })).estado, 409);
    assert.equal((await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id).avaliacao.n, 0, 'sem avaliação');
    // O CEO aprova a seguir; lido outra vez não muda nada.
    assert.equal(p.app.api.eletricistas.prazos(), 0);
    assert.equal(linha(tid).confirmada, t.confirmada);
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal((await meusPagamentos(e)).trabalhos[0].pagamento, 'a_aguardar_restante');
  });

  test('quem larga o trabalho ou o deixa caducar nunca recebe por ele: não aparece nos pagamentos dele e o servidor recusa "Pago"', async () => {
    const largou = await aprovado();
    const caducou = await aprovado();
    const fez = await aprovado();
    const { c, id } = await obraDoCliente();
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    // O primeiro aceita, marca a visita e larga; o segundo aceita e deixa passar as 48 h; o terceiro faz o trabalho.
    assert.equal((await area(largou, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    assert.equal((await area(largou, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    assert.equal((await area(largou, 'POST', `trabalhos/${tid}/largar`, {})).estado, 200);
    assert.equal((await area(caducou, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    p.relogio.avancar(PRAZO_VISITA_MS + 1000);
    assert.equal((await area(fez, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    await fazer(fez, tid);
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 5 })).estado, 200);
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 200);
    await pagarRestante(c, id);
    assert.equal((await area(fez, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 201);
    for (const x of [largou, caducou]) {
      assert.deepEqual((await meusPagamentos(x)).trabalhos, [], 'nada a receber');
      assert.equal((await area(x, 'GET', `trabalhos/${tid}`)).estado, 404);
      assert.equal((await area(x, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 404, 'nem pode enviar fatura');
      assert.equal((await area(x, 'GET', `bolsa/${tid}`)).estado, 409);
    }
    assert.deepEqual((await meusPagamentos(fez)).trabalhos.map((x) => [x.id, x.pagamento, x.valor.total]), [[tid, 'a_pagar', 730]]);
    // Mesmo que o trabalho ficasse outra vez em nome de quem o largou (ou deixou caducar), o servidor não paga.
    for (const x of [largou, caducou]) {
      p.app.db.prepare('UPDATE trabalhos_eletricista SET eletricista_id = ? WHERE id = ?').run(x.id, tid);
      assert.deepEqual([(await noPainel(tid)).pagamento, (await meusPagamentos(x)).trabalhos[0].pagamento], ['sem_pagamento', 'sem_pagamento']);
      const r = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {});
      assert.deepEqual([r.estado, r.json.erro], [409, 'Este eletricista largou o trabalho ou deixou-o caducar: não recebe por ele.']);
    }
    p.app.db.prepare('UPDATE trabalhos_eletricista SET eletricista_id = ? WHERE id = ?').run(fez.id, tid);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 200);
    assert.deepEqual([linha(tid).estado, linha(tid).eletricista_id], ['paga', fez.id]);
    // Atribuição direta: quem larga fica com o trabalho "retirado" — também sem nada a receber.
    const outra = await obraDoCliente();
    const t2 = (await atribuicao(outra.id, { acao: 'atribuir', eletricista_id: largou.id })).json.trabalho.id;
    assert.equal((await area(largou, 'POST', `trabalhos/${t2}/largar`, {})).estado, 200);
    assert.deepEqual((await meusPagamentos(largou)).trabalhos, []);
    assert.equal((await painel('POST', `trabalhos-eletricista/${t2}/pago`, 'ceo', {})).estado, 409);
    assert.equal(await noPainel(t2), undefined);
  });

  test('valores com outra percentagem (65 %) e outro IVA (6 %): obra, visita técnica e avaria (a taxa de diagnóstico fica na Domus); a percentagem de "Trabalhe connosco" segue a configuração', async () => {
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 6, eletricista_pct: 65 })).estado, 200);
    try {
      assert.deepEqual((await p.pedir('GET', '/api/eletricista/candidatura')).json, { aberta: true, percentagem: 65 });
      const e = await aprovado();
      // Obra: 65 % × 1200 (mão de obra sem IVA) + 42,50 (deslocação sem IVA) = 822,50 — o IVA não entra.
      const o = await obraConcluida(e, { mao: 1200, material: 300, deslocacao: 42.5 });
      assert.equal((await confirmar(o.c, o.id, { concluido: true, estrelas: 5 })).estado, 200);
      assert.equal((await atribuicao(o.id, { acao: 'aprovar' })).estado, 200);
      assert.deepEqual(JSON.parse(linha(o.tid).valor_detalhe), { percentagem: 65, mao_obra: 1200, parte_mao_obra: 780, deslocacao: 42.5, total: 822.5 });
      // Visita técnica (Sintra): o cliente pagou 0,5 h × 38 € + 7,20 € com IVA. Sem IVA a 6 %: 17,92 € e 6,79 €.
      // O eletricista: 65 % × 17,92 = 11,65 € + 6,79 € = 18,44 €.
      const c2 = await p.contaConfirmada();
      const vis = await p.pedir('POST', '/api/orcamento', { cookie: c2.cookie, corpo: { ...CLIENTE, servico: 'Casa', localidade: 'Sintra', simulacao: sim(), compra: 'visita' } });
      assert.equal((await conta(c2, 'POST', `pagamentos/${vis.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
      const idV = vis.json.pedido;
      const tv = (await atribuicao(idV, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
      await fazer(e, tv);
      assert.equal((await pedidoConta(c2, idV)).confirmacao.tipo, 'Visita técnica');
      assert.equal((await confirmar(c2, idV, { concluido: true, estrelas: 3 })).estado, 200);
      assert.equal((await atribuicao(idV, { acao: 'aprovar' })).estado, 200);
      assert.deepEqual(JSON.parse(linha(tv).valor_detalhe), { percentagem: 65, mao_obra: 17.92, parte_mao_obra: 11.65, deslocacao: 6.79, total: 18.44 });
      // A visita já está paga pelo cliente: com a confirmação e a aprovação só falta a fatura; o prazo conta da última das duas.
      let m = (await meusPagamentos(e)).trabalhos.find((x) => x.id === tv);
      assert.deepEqual([m.pagamento, m.valor.total, m.prazo], ['fatura_em_falta', 18.44, prazoPagamento([linha(tv).confirmada, linha(tv).aprovada])]);
      // Aprovar uma visita não mexe na obra do pedido, e fecha o trabalho; não se atribui outra visita igual.
      const ped = (await painel('GET', `orcamentos/${idV}`)).json;
      assert.deepEqual([ped.obra_concluida ?? null, ped.estado], [null, 'visita_marcada']);
      const a = (await atribuicao(idV)).json;
      assert.deepEqual([a.pode, a.trabalho.estado, a.trabalho.ativo, a.candidatos], [false, 'aprovada', false, []]);
      assert.equal((await atribuicao(idV, { acao: 'atribuir', eletricista_id: e.id })).estado, 409);
      assert.equal((await atribuicao(idV, { acao: 'bolsa' })).estado, 409);
      assert.equal((await area(e, 'GET', `trabalhos/${tv}`)).json.trabalho.cliente, null);
      // Avaria (Sintra): o cliente pagou 25 € de diagnóstico + 19 € de meia hora + 7,20 € de deslocação = 51,20 €. O
      // eletricista recebe 65 % da meia hora sem IVA + a deslocação sem IVA; os 25 € ficam na Domus.
      const c3 = await p.contaConfirmada();
      const av = await p.pedir('POST', '/api/orcamento', { cookie: c3.cookie, corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
      assert.equal(av.json.pagamento.valor, 51.2);
      const idA = (await conta(c3, 'POST', `pagamentos/${av.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.orcamento_id;
      const ta = (await atribuicao(idA, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
      await fazer(e, ta, { avaria: true });
      assert.equal((await confirmar(c3, idA, { concluido: true, estrelas: 5 })).estado, 200);
      assert.equal((await atribuicao(idA, { acao: 'aprovar' })).estado, 200);
      const valor = JSON.parse(linha(ta).valor_detalhe);
      assert.deepEqual(valor, { percentagem: 65, mao_obra: 17.92, parte_mao_obra: 11.65, deslocacao: 6.79, total: 18.44 });
      assert.ok(valor.total < (51.2 - 25) / 1.06, 'a taxa de diagnóstico (25 €) não entra na conta do eletricista');
      // O IVA volta a 23 %: o que já foi aprovado não muda (valor fixado).
      await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 23 });
      m = (await meusPagamentos(e)).trabalhos;
      assert.deepEqual(m.map((x) => [x.tipo, x.valor.total, x.valor_fixado]), [['avaria', 18.44, true], ['visita', 18.44, true], ['obra', 822.5, true]]);
      assert.deepEqual((await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id).avaliacao, { n: 3, media: 4.3 });
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 23, eletricista_pct: 70 });
    }
  });

  test('"Não" sem defeito: o CEO cobra uma visita ao cliente (o valor da visita técnica), que não desconta na obra; o trabalho fica aceite', async () => {
    const e = await aprovado();
    const { c, id, tid } = await obraConcluida(e);
    assert.equal((await confirmar(c, id, { concluido: false, descricao: 'O interruptor do quarto faz barulho.' })).estado, 200);
    let l = await pedidoConta(c, id);
    assert.equal(l.visita_sem_defeito, null, 'antes da decisão do CEO não há nada a pagar');
    let r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' });
    assert.deepEqual([r.estado, r.json.erro], [409, 'Não há nada para pagar.']);
    p.emails.length = 0;
    assert.equal((await atribuicao(id, { acao: 'sem_defeito' })).estado, 200);
    let t = linha(tid);
    assert.deepEqual([t.estado, t.confirmada_auto, t.reclamacao_decisao, t.estrelas], ['confirmada', 1, 'sem_defeito', null]);
    assert.ok(p.emails.some((m) => m.para === c.email && /não encontrámos defeito/.test(m.texto) && /é paga/.test(m.texto)));
    assert.equal((await atribuicao(id, { acao: 'defeito' })).estado, 409);
    l = await pedidoConta(c, id);
    // Sintra: 0,5 h × 38 € + 7,20 € de deslocação = 26,20 € (com IVA), o valor da visita técnica.
    assert.deepEqual([l.confirmacao.estado, l.confirmacao.sem_defeito, l.visita_sem_defeito.valor, l.visita_sem_defeito.paga], ['confirmada', true, 26.2, false]);
    const antes = (await painel('GET', `orcamentos/${id}`)).json.valores_pagamento;
    assert.equal((await pedidoConta(await p.contaConfirmada(), id)), undefined);
    assert.equal((await conta(await p.contaConfirmada(), 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' })).estado, 404, 'só o dono do pedido');
    r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.pagamento.fase, r.json.pagamento.valor, r.json.pagamento.estado], ['visita', 26.2, 'pendente']);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' })).json.pagamento.ref, r.json.pagamento.ref, 'clicar duas vezes não cria dois');
    assert.equal((await pedidoConta(c, id)).visita_sem_defeito.pendente, r.json.pagamento.ref);
    const pago = await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    assert.deepEqual([pago.json.pagamento.estado, pago.json.pagamento.sem_defeito, pago.json.pagamento.nao_realizada], ['pago', true, undefined]);
    assert.match(p.emails.at(-1).texto, /não encontrámos defeito: não é descontado na obra/);
    l = await pedidoConta(c, id);
    assert.deepEqual([l.visita_sem_defeito.paga, l.visita_sem_defeito.pendente], [true, null]);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' })).estado, 409, 'paga uma vez');
    // Não desconta: o sinal, o restante e o que falta da obra ficam iguais.
    const depois = (await painel('GET', `orcamentos/${id}`)).json.valores_pagamento;
    assert.deepEqual([depois.total, depois.restante, depois.em_falta], [antes.total, antes.restante, antes.em_falta]);
    const noPainelPag = (await painel('GET', 'pagamentos-pedido')).json.pagamentos.find((x) => x.ref === r.json.pagamento.ref);
    assert.deepEqual([noPainelPag.sem_defeito, noPainelPag.nao_realizada], [true, false]);
    // O CEO aprova a seguir: o eletricista recebe o trabalho (uma vez); a visita sem defeito fica na Domus.
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal(linha(tid).valor_cent, 73000);
    assert.equal((await atribuicao(id)).json.trabalho.visita_sem_defeito.paga, true);
  });

  test('ida sem defeito: o eletricista recebe a ida (70 % da meia hora sem IVA + deslocação sem IVA) numa linha própria, só com a visita paga pelo cliente e o trabalho aprovado; nunca com "defeito"', async () => {
    const e = await aprovado();
    const outro = await aprovado();
    const { c, id, tid } = await obraConcluida(e);
    assert.equal((await confirmar(c, id, { concluido: false, descricao: 'O interruptor do quarto faz barulho.' })).estado, 200);
    assert.equal((await meusPagamentos(e)).trabalhos.some((x) => x.parte === 'regresso'), false, 'antes da decisão não há ida');
    assert.equal((await atribuicao(id, { acao: 'sem_defeito' })).estado, 200);
    // Sintra, IVA 23 %: meia hora a 38 €/h = 19 € → 15,45 € sem IVA; 70 % = 10,82 €; deslocação 7,20 € → 5,85 €.
    assert.deepEqual([linha(tid).regresso_cent, JSON.parse(linha(tid).regresso_detalhe)], [1667, { percentagem: 70, mao_obra: 15.45, parte_mao_obra: 10.82, deslocacao: 5.85, total: 16.67 }]);
    const ida = async (x = e) => (await meusPagamentos(x)).trabalhos.find((l) => l.id === tid && l.parte === 'regresso');
    const idaPainel = async () => (await painel('GET', 'pagamentos-eletricistas')).json.trabalhos.find((l) => l.id === tid && l.parte === 'regresso');
    let r = await ida();
    assert.deepEqual([r.titulo, r.pagamento, r.pagamento_texto, r.valor.total, r.prazo, r.pode_fatura], ['Ida sem defeito (visita)', 'a_aguardar_visita', 'A aguardar o pagamento da visita pelo cliente', 16.67, null, false]);
    assert.equal((await meusPagamentos(e)).trabalhos.find((l) => l.id === tid && l.parte === 'trabalho').valor.total, 730, 'a linha do trabalho continua à parte');
    assert.equal(await ida(outro), undefined);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { ...doc(), parte: 'regresso' })).estado, 409, 'fatura antes de aprovado');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { ...doc(), parte: 'outra' })).estado, 400);
    // O CEO aprova: continua à espera da visita do cliente.
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal((await ida()).pagamento, 'a_aguardar_visita');
    assert.equal((await atribuicao(id)).json.trabalho.regresso.pagamento, 'a_aguardar_visita');
    let x = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', { parte: 'regresso' });
    assert.deepEqual([x.estado, x.json.erro], [409, 'Ainda não se pode pagar esta ida: a aguardar o pagamento da visita pelo cliente.']);
    // O cliente paga a visita: falta a fatura desta ida; o prazo conta da última (visita paga, aprovação).
    p.relogio.avancar(DIA);
    const pv = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'visita_sem_defeito' });
    assert.equal((await conta(c, 'POST', `pagamentos/${pv.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    const visitaPagaEm = p.app.db.prepare('SELECT pago FROM pagamentos_pedido WHERE ref = ?').get(pv.json.pagamento.ref).pago;
    r = await ida();
    assert.deepEqual([r.pagamento, r.prazo, r.pode_fatura], ['fatura_em_falta', prazoPagamento([visitaPagaEm, linha(tid).aprovada]), true]);
    assert.equal(r.prazo, prazoPagamento([visitaPagaEm]), 'a visita foi paga depois da aprovação');
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/fatura`, { ...doc(), parte: 'regresso' })).estado, 404);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { ...doc(Buffer.from('<svg/>'), 'image/png'), parte: 'regresso' })).estado, 415);
    x = await area(e, 'POST', `trabalhos/${tid}/fatura`, { ...doc(), parte: 'regresso' });
    assert.equal(x.estado, 201, x.texto);
    r = x.json.trabalhos.find((l) => l.id === tid && l.parte === 'regresso');
    assert.deepEqual([r.pagamento, r.fatura.url], ['a_pagar', `/api/eletricista/trabalhos/${tid}/fatura?parte=regresso`]);
    assert.equal(x.json.trabalhos.find((l) => l.id === tid && l.parte === 'trabalho').fatura, null, 'a fatura do trabalho é outra');
    const d = await area(e, 'GET', `trabalhos/${tid}/fatura?parte=regresso`);
    assert.deepEqual([d.estado, d.cabecalhos['x-content-type-options'], d.bruto.equals(PDF)], [200, 'nosniff', true]);
    assert.match(d.cabecalhos['content-disposition'], /fatura-recibo-ida-trabalho-\d+\.pdf/);
    assert.equal((await area(e, 'GET', `trabalhos/${tid}/fatura`)).estado, 404, 'sem a fatura do trabalho');
    assert.equal((await area(e, 'GET', `trabalhos/${tid}/fatura?parte=outra`)).estado, 400);
    assert.equal((await painel('GET', `trabalhos-eletricista/${tid}/fatura?parte=regresso`)).estado, 200);
    assert.equal((await painel('GET', `trabalhos-eletricista/${tid}/fatura?parte=regresso`, 'comercial')).estado, 403);
    // Painel: a ida a pagar numa linha própria; "Pago" só dela (o trabalho continua à espera do restante).
    assert.deepEqual([(await idaPainel()).pagamento, (await idaPainel()).iban], ['a_pagar', null]);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'comercial', { parte: 'regresso' })).estado, 403);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', { parte: 'outra' })).estado, 400);
    x = await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', { parte: 'regresso' });
    assert.equal(x.estado, 200, x.texto);
    assert.deepEqual([linha(tid).regresso_paga_por, linha(tid).estado, linha(tid).paga], [p.u.ceo.email, 'aprovada', null]);
    assert.deepEqual([(await ida()).pagamento, (await ida()).pode_fatura], ['pago', false]);
    assert.equal((await noPainel(tid)).pagamento, 'a_aguardar_restante');
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', { parte: 'regresso' })).estado, 409, 'paga uma vez');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { ...doc(), parte: 'regresso' })).estado, 409, 'paga: a fatura já não muda');
    const csv = (await painel('GET', 'pagamentos-pedido?formato=csv')).texto;
    assert.match(csv, new RegExp(`;eletricista-${tid}-ida;Eletricista externo: ida sem defeito \\(trabalho n\\.º ${tid}\\);-16,67;;-16,67;eletricista_pago;${id}\\r\\n`));
    assert.match(csv, new RegExp(`;eletricista-${tid};Eletricista externo: obra \\(trabalho n\\.º ${tid}\\);-730,00;;-730,00;eletricista_a_pagar;${id}\\r\\n`));
    // "Defeito": nunca há ida a pagar.
    const outra = await obraConcluida(e);
    assert.equal((await confirmar(outra.c, outra.id, { concluido: false, descricao: 'Falta uma tampa na sala.' })).estado, 200);
    assert.equal((await atribuicao(outra.id, { acao: 'defeito' })).estado, 200);
    assert.equal(linha(outra.tid).regresso_cent, null);
    assert.equal((await meusPagamentos(e)).trabalhos.some((l) => l.id === outra.tid && l.parte === 'regresso'), false);
    assert.equal((await painel('POST', `trabalhos-eletricista/${outra.tid}/pago`, 'ceo', { parte: 'regresso' })).json.erro, 'Este trabalho não tem uma ida sem defeito a pagar.');
  });

  test('um "Não" novo depois de "sem defeito": com a visita por pagar, a cobrança e a ida do eletricista desaparecem; já paga, a ida fica', async () => {
    const e = await aprovado();
    const voltar = async (o) => {
      assert.equal((await atribuicao(o.id, { acao: 'devolver', motivo: 'Rever a instalação com o cliente.' })).estado, 200);
      assert.equal((await area(e, 'POST', `trabalhos/${o.tid}/concluir`, {})).estado, 200);
      assert.equal((await confirmar(o.c, o.id, { concluido: false, descricao: 'Continua o mesmo barulho.' })).estado, 200);
    };
    // Por pagar: desaparece.
    const a = await obraConcluida(e);
    assert.equal((await confirmar(a.c, a.id, { concluido: false, descricao: 'O interruptor faz barulho.' })).estado, 200);
    assert.equal((await atribuicao(a.id, { acao: 'sem_defeito' })).estado, 200);
    assert.equal(linha(a.tid).regresso_cent, 1667);
    await voltar(a);
    assert.deepEqual([linha(a.tid).regresso_cent, linha(a.tid).regresso_desde, linha(a.tid).reclamacao_decisao], [null, null, null]);
    assert.equal((await pedidoConta(a.c, a.id)).visita_sem_defeito, null);
    assert.equal((await meusPagamentos(e)).trabalhos.some((l) => l.id === a.tid && l.parte === 'regresso'), false);
    // Já paga pelo cliente: a ida fica (e paga-se quando o trabalho for aprovado).
    const b = await obraConcluida(e);
    assert.equal((await confirmar(b.c, b.id, { concluido: false, descricao: 'O interruptor faz barulho.' })).estado, 200);
    assert.equal((await atribuicao(b.id, { acao: 'sem_defeito' })).estado, 200);
    const pv = await conta(b.c, 'POST', `pedidos/${b.id}/pagar`, { fase: 'visita_sem_defeito' });
    await conta(b.c, 'POST', `pagamentos/${pv.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    await voltar(b);
    assert.equal(linha(b.tid).regresso_cent, 1667);
    assert.equal((await area(e, 'POST', `trabalhos/${b.tid}/concluir`, {})).estado, 200);
    assert.equal((await confirmar(b.c, b.id, { concluido: true, estrelas: 5 })).estado, 200);
    assert.equal((await meusPagamentos(e)).trabalhos.find((l) => l.id === b.tid && l.parte === 'regresso').pagamento, 'a_aguardar_aprovacao');
  });

  test('o CEO devolve o trabalho ao eletricista (com o motivo): a confirmação e a avaliação do cliente saem e o cliente volta a confirmar', async () => {
    const e = await aprovado();
    const { c, id, tid } = await obraConcluida(e);
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 2, comentario: 'Ficou uma calha torta.' })).estado, 200);
    for (const papel of ['comercial', 'tecnico']) assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, papel, { acao: 'devolver', motivo: 'Endireitar a calha.' })).estado, 403);
    assert.equal((await atribuicao(id, { acao: 'devolver' })).estado, 400, 'o motivo é obrigatório');
    assert.equal((await atribuicao(id, { acao: 'devolver', motivo: '  ' })).estado, 400);
    p.emails.length = 0;
    const r = await atribuicao(id, { acao: 'devolver', motivo: 'Endireitar a calha da sala.' });
    assert.equal(r.estado, 200, r.texto);
    const t = linha(tid);
    assert.deepEqual([t.estado, t.confirmada, t.estrelas, t.comentario, t.reclamacao, t.reclamacao_de], ['visita_marcada', null, null, null, 'Endireitar a calha da sala.', 'ceo']);
    assert.ok(p.emails.some((m) => m.para === e.email && /devolveu-lhe o trabalho/.test(m.texto)));
    const f = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.editavel, f.reclamacao.de, f.reclamacao.texto], [true, 'ceo', 'Endireitar a calha da sala.']);
    assert.equal((await pedidoConta(c, id)).confirmacao, null, 'a devolução da Domus não aparece ao cliente como reclamação dele');
    assert.equal((await atribuicao(id)).json.trabalho.pode_decidir, false, 'defeito / sem defeito é só para o "Não" do cliente');
    assert.equal((await atribuicao(id, { acao: 'defeito' })).estado, 409);
    assert.deepEqual((await meusPagamentos(e)).trabalhos, [], 'enquanto não volta a concluir não está nos pagamentos');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200);
    assert.equal((await pedidoConta(c, id)).confirmacao.estado, 'por_confirmar');
    assert.equal((await confirmar(c, id, { concluido: true, estrelas: 5 })).estado, 200);
    assert.deepEqual((await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id).avaliacao, { n: 1, media: 5 });
    // Com trabalhos por pagar não se apaga o eletricista (RGPD): primeiro paga-se ou retira-se.
    assert.equal((await atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal((await painel('POST', `eletricistas/${e.id}/apagar`, 'ceo', { email: e.email })).estado, 409);
  });
});

describe('ronda 3 com o interruptor ELETRICISTAS desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());
  const DESCONHECIDO = { erro: 'Endereço desconhecido.' };

  test('as rotas novas não existem (404): área do eletricista, painel e conta; a conta e os totais ficam como antes', async () => {
    for (const [metodo, caminho] of [['GET', 'pagamentos'], ['POST', 'iban'], ['GET', 'trabalhos/1/fatura'], ['POST', 'trabalhos/1/fatura']]) {
      const r = await p.pedir(metodo, `/api/eletricista/${caminho}`, { corpo: metodo === 'POST' ? {} : undefined });
      assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], `${metodo} ${caminho}`);
    }
    for (const [metodo, caminho] of [['GET', 'pagamentos-eletricistas'], ['POST', 'trabalhos-eletricista/1/pago'], ['GET', 'trabalhos-eletricista/1/fatura']]) {
      for (const papel of [null, 'ceo', 'comercial']) {
        const r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: papel ? p.cookies[papel] : undefined, corpo: metodo === 'POST' ? {} : undefined });
        assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], `${metodo} ${caminho} (${papel ?? 'anónimo'})`);
      }
    }
    const c = await p.contaConfirmada();
    const ped = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(ped.estado, 201, ped.texto);
    const id = ped.json.pedido;
    const r = await p.pedir('POST', `/api/conta/pedidos/${id}/confirmar-trabalho`, { cookie: c.cookie, corpo: { concluido: true, estrelas: 5 } });
    assert.equal(r.estado, 404, 'a rota da confirmação não existe');
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase: 'visita_sem_defeito' } })).estado, 400, 'a fase nova não é aceite');
    const l = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.deepEqual([l.confirmacao, l.visita_sem_defeito], [null, null]);
    const tot = await p.pedir('GET', '/painel/api/pagamentos-pedido', { cookie: p.cookies.ceo });
    assert.deepEqual([tot.estado, tot.json.eletricistas], [200, null]);
    assert.ok(!(await p.pedir('GET', '/painel/api/pagamentos-pedido?formato=csv', { cookie: p.cookies.ceo })).texto.includes('eletricista'));
  });
});
