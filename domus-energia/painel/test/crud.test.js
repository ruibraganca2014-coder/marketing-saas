// Orçamentos (atualização, histórico, converter), obras (CEO, técnico só as
// suas, comercial só leitura), utilizadores, pagamentos (CSV), clientes,
// migrações e auditoria.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb, versaoEsquema, migrar, MIGRACOES } from '../src/db.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';
import { diaLisboa, somarDiasCivil } from '../src/util.js';

let p;
let tec2;
let cTec2;
before(async () => {
  p = await painelComEquipa();
  tec2 = await p.criarUtilizador('tecnico', 'tecnico2@domus.teste');
  cTec2 = await p.entrar(tec2.email);
  await writeFile(join(p.dados, 'clientes', 'joao.tsv'), [
    'sala\topenbeken\t1\t0\t1:interruptor:Teto:0:1:ultimo::Sala,2:luz::0:0:desligado::\tSala grande\t',
    'porta\topenbeken\t0\t1\t1:porta:Entrada:1:0:::,2:bateria:::0:::\tPorta\tHall',
    'velho\topenbeken\tVelho',
    '',
  ].join('\n'));
  await writeFile(join(p.dados, 'clientes', 'maria.tsv'), '');
  await writeFile(join(p.dados, 'planos', 'joao.json'), '{"plano":"premium","estado":"em_atraso","desde":"2026-09-01T10:00:00Z","proximo_pagamento":"2026-10-01T10:00:00Z","aviso_ate":"2026-10-16T10:00:00Z","gerido":"stripe","stripe_cliente":"cus_SEGREDO","stripe_subscricao":"sub_SEGREDO","teste_usado":true,"atualizado":"2026-09-01T10:00:00Z"}\n');
  await writeFile(join(p.dados, 'pagamentos', 'pagamentos.csv'), [
    'data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe',
    '2026-08-01;joao;premium;19,99;16,25;in_1',
    '2026-09-01;joao;premium;19,99;16,25;in_2',
    '2026-09-03;maria;base;4,99;4,06;in_3',
    'lixo;;;',
    '2026-09-05;=cmd|x;base;4,99;4,06;in_4',
    '',
  ].join('\n'));
});
after(() => p.fechar());

const api = (metodo, c, papel, corpo) => p.pedir(metodo, `/painel/api/${c}`, { cookie: typeof papel === 'string' && papel.startsWith('domus_painel=') ? papel : p.cookies[papel], corpo });

async function novoOrcamento(extra = {}) {
  const r = await api('POST', 'orcamentos', 'comercial', { nome: 'Cliente Teste', telefone: '210000000', servico: 'Casa inteligente', ...extra });
  assert.equal(r.estado, 201, r.texto);
  return r.json;
}

test('migrações: versão do esquema = n.º de migrações; reabrir não repete', async () => {
  assert.equal(versaoEsquema(p.app.db), MIGRACOES.length);
  const db2 = abrirDb(p.config.db);
  assert.equal(versaoEsquema(db2), MIGRACOES.length);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM config_orcamento').get().n, 9, 'sementes não duplicadas (7 + margem_pacotes_pct + iva_pct, semeado no arranque)');
  db2.close();
  const mem = abrirDb(':memory:');
  assert.equal(versaoEsquema(mem), MIGRACOES.length);
  mem.close();
});

test('migração 4 (deslocação por distância): base existente recebe os valores novos sem perder os editados', () => {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRACOES.slice(0, 3)) m(db);
  db.exec('PRAGMA user_version = 3');
  db.prepare("UPDATE config_orcamento SET valor = 12.5 WHERE chave = 'deslocacao_iva'").run();
  db.prepare("UPDATE config_orcamento SET valor = 45 WHERE chave = 'tarifa_hora_iva'").run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  const cfg = Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));
  assert.deepEqual(cfg, {
    tarifa_hora_iva: 45, margem_intervalo_pct: 15, deslocacao_iva: 12.5,
    deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100, margem_pacotes_pct: 20,
  });
  // Com valores do CEO: a migração outra vez não os muda nem duplica.
  db.prepare("UPDATE config_orcamento SET valor = 'Porto' WHERE chave = 'deslocacao_base'").run();
  MIGRACOES[3](db);
  assert.equal(db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'deslocacao_base'").get().valor, 'Porto');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM config_orcamento').get().n, 8, '7 + margem_pacotes_pct (migração 13)');
  db.close();
});

test('migração 12 (arquivado): os pedidos já anonimizados pelo RGPD passam a "arquivado"; o resto, os ids e a sequência ficam', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const m of MIGRACOES.slice(0, 11)) m(db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 11');
  const ins = db.prepare(`INSERT INTO orcamentos (criado, atualizado, nome, servico, estado, anonimizado) VALUES ('2026-01-01', '2026-01-01', ?, 'S', ?, ?)`);
  ins.run('Cliente', 'novo', null);
  ins.run('Anonimizado (RGPD)', 'aceite', '2026-09-29T14:14:08Z');
  ins.run('Anonimizado (RGPD)', 'novo', null);
  ins.run('Apagado', 'novo', null);
  db.prepare('DELETE FROM orcamentos WHERE id = 4').run();
  db.prepare(`INSERT INTO pagamentos_pedido (ref, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, expira)
    VALUES ('pp_x', 2, 'relatorio', 1900, 'R', 'pago', 'simulado', 'simulador', 'x', 'x', 0)`).run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.deepEqual(db.prepare('SELECT id, estado FROM orcamentos ORDER BY id').all().map((o) => [o.id, o.estado]), [[1, 'novo'], [2, 'arquivado'], [3, 'arquivado']]);
  assert.equal(db.prepare('SELECT orcamento_id FROM pagamentos_pedido WHERE ref = ?').get('pp_x').orcamento_id, 2, 'os pagamentos continuam ligados');
  assert.equal(Number(db.prepare(`INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES ('x', 'x', 'Novo', 'S')`).run().lastInsertRowid), 5, 'o id 4 (apagado) não volta');
  assert.throws(() => db.prepare("UPDATE orcamentos SET estado = 'xyz' WHERE id = 1").run(), /CHECK/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'orcamentos_conta'").get(), 'índices refeitos');
  db.close();
});

test('migração 3 (catálogo do quadro): base existente recebe os artigos novos sem duplicar nem mudar preços editados', () => {
  const db = new DatabaseSync(':memory:');
  // Base "antiga": só as migrações 1 e 2, com o CEO a mudar um preço e a criar à mão um SKU que a migração 3 também traz.
  MIGRACOES[0](db);
  MIGRACOES[1](db);
  db.exec('PRAGMA user_version = 2');
  db.prepare("UPDATE catalogo SET preco_venda_iva_cent = 4444, atualizado = 'x' WHERE sku = 'TONGOU-SY2-JWT'").run();
  db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes, atualizado)
    VALUES ('IDR-2P-40A-30MA', 'Diferencial do CEO', 'disjuntor', 3333, 0.4, '{}', 'x')`).run();
  const antes = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
  assert.equal(antes, SEMENTES_CATALOGO.length + 1);
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  const n = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
  assert.equal(n, antes + SEMENTES_QUADRO.length - 1 + SEMENTES_ACOES.length, 'todos os novos menos o que já existia (e os das ações, migração 10)');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT sku FROM catalogo GROUP BY sku HAVING COUNT(*) > 1)').get().n, 0, 'sem duplicados');
  assert.equal(db.prepare("SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = 'TONGOU-SY2-JWT'").get().c, 4444, 'preço editado mantém-se');
  const idr = db.prepare("SELECT nome, preco_venda_iva_cent AS c, horas_instalacao AS h FROM catalogo WHERE sku = 'IDR-2P-40A-30MA'").get();
  assert.deepEqual({ ...idr }, { nome: 'Diferencial do CEO', c: 3333, h: 0.4 }, 'artigo do CEO com o mesmo SKU não é alterado');
  for (const s of SEMENTES_QUADRO.filter((x) => x.sku !== 'IDR-2P-40A-30MA')) {
    const a = db.prepare('SELECT preco_venda_iva_cent AS c, especificacoes AS e, ativo FROM catalogo WHERE sku = ?').get(s.sku);
    assert.equal(a.c, Math.round(s.preco_venda_iva * 100), s.sku);
    assert.equal(a.ativo, 1);
    // Preços aprovados pelo dono: só o AFDD continua com a nota "preço provisório — confirmar".
    if (s.sku === 'AFDD-1PN-16A') assert.match(JSON.parse(a.e).nota, /provisório — confirmar/, s.sku);
    else assert.doesNotMatch(JSON.parse(a.e).nota ?? '', /provisório/, s.sku);
  }
  // Correr outra vez não faz nada (a versão já é a última).
  migrar(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, n);
  db.close();
  // Base nova: sementes e artigos do quadro, cada SKU uma vez.
  const nova = abrirDb(':memory:');
  assert.equal(nova.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, SEMENTES_CATALOGO.length + SEMENTES_QUADRO.length + SEMENTES_ACOES.length);
  nova.close();
});

test('migração 8 (ids nunca reutilizados): base existente mantém dados, índices e chaves; um id apagado não volta', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRACOES.slice(0, 7)) m(db);
  db.exec('PRAGMA user_version = 7');
  const t = '2026-09-01T10:00:00.000Z';
  db.prepare("INSERT INTO contas (id, email, hash, criado, atualizado) VALUES (1, 'a@exemplo.pt', 'h', ?, ?), (2, 'b@exemplo.pt', 'h', ?, ?)").run(t, t, t, t);
  db.prepare("INSERT INTO orcamentos (id, criado, atualizado, nome, servico, conta_id) VALUES (1, ?, ?, 'A', 's', 1), (2, ?, ?, 'B', 's', 2), (3, ?, ?, 'C', 's', NULL)").run(t, t, t, t, t, t);
  db.prepare("INSERT INTO fotos (id, orcamento_id, chave, tipo_mime, bytes, criado) VALUES ('f1', 2, 'quadro', 'image/jpeg', 10, ?)").run(t);
  db.prepare("INSERT INTO contas_sessoes (id, conta_id, criada, expira, renovada) VALUES ('s1', 2, 1, 2, 1)").run();
  // Apagados antes desta migração (só ficou o rasto na auditoria): o pedido 4 e a conta 3.
  db.prepare("INSERT INTO auditoria (quando, acao, alvo) VALUES (?, 'orcamento_recebido', 'orcamento:4'), (?, 'conta_criada', 'conta:3')").run(t, t);
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'chaves estrangeiras ligadas de novo');
  for (const tabela of ['orcamentos', 'contas']) {
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(tabela).sql, /id INTEGER PRIMARY KEY AUTOINCREMENT/);
  }
  assert.deepEqual(db.prepare('SELECT id, nome, conta_id FROM orcamentos ORDER BY id').all().map((x) => ({ ...x })),
    [{ id: 1, nome: 'A', conta_id: 1 }, { id: 2, nome: 'B', conta_id: 2 }, { id: 3, nome: 'C', conta_id: null }]);
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orcamentos'").all().map((x) => x.name).sort();
  assert.deepEqual(indices, ['orcamentos_conta', 'orcamentos_estado']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n, 1, 'o DROP não apagou em cascata');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_sessoes').get().n, 1);
  // Ids novos: nunca um já usado (nem o 4/3 que só ficou na auditoria), mesmo depois de apagar o último.
  const novoOrc = () => Number(db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES (?, ?, 'N', 's')").run(t, t).lastInsertRowid);
  const n5 = novoOrc();
  assert.equal(n5, 5);
  db.prepare('DELETE FROM orcamentos WHERE id = ?').run(n5);
  assert.equal(novoOrc(), 6);
  assert.equal(Number(db.prepare("INSERT INTO contas (email, hash, criado, atualizado) VALUES ('c@exemplo.pt', 'h', ?, ?)").run(t, t).lastInsertRowid), 4);
  // As chaves estrangeiras continuam a apontar para as tabelas recriadas.
  db.prepare('DELETE FROM orcamentos WHERE id = 2').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n, 0, 'fotos em cascata');
  db.prepare('DELETE FROM contas WHERE id = 1').run();
  assert.equal(db.prepare('SELECT conta_id FROM orcamentos WHERE id = 1').get().conta_id, null, 'ON DELETE SET NULL');
  db.prepare('DELETE FROM contas WHERE id = 2').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_sessoes').get().n, 0, 'sessões em cascata');
  db.close();
});

test('orçamentos: atualizar estado, notas, visita, proposta; histórico; validação', async () => {
  const o = await novoOrcamento();
  let r = await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'contactado', notas: 'Ligou de manhã.' });
  assert.equal(r.estado, 200);
  assert.equal(r.json.estado, 'contactado');
  assert.equal((await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'visita_marcada' })).estado, 400, 'visita sem data');
  r = await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'visita_marcada', data_visita: '2026-10-02T15:30' });
  assert.equal(r.json.data_visita, '2026-10-02T15:30');
  r = await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: '1234,5' });
  assert.equal(r.json.valor_proposta, 1234.5, 'o comercial gere o valor da proposta');
  assert.equal((await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'perdido' })).estado, 400, 'perdido sem motivo');
  for (const corpo of [{ estado: 'ganho' }, { data_visita: '2026-02-30' }, { valor_proposta: -1 }, { telefone: null, email: null }, {}, { cliente: 'x' }]) {
    assert.equal((await api('POST', `orcamentos/${o.id}`, 'ceo', corpo)).estado, 400, JSON.stringify(corpo));
  }
  r = await api('GET', `orcamentos/${o.id}`, 'ceo');
  assert.deepEqual(r.json.historico.map((h) => h.acao), ['orcamento_criado', 'orcamento_atualizado', 'orcamento_atualizado', 'orcamento_atualizado']);
  assert.equal(r.json.historico[1].detalhes.estado, 'contactado');
  assert.equal(r.json.historico[3].detalhes.valor_proposta, 1234.5);
  assert.equal(r.json.historico[1].por, 'comercial@domus.teste');
  const filtrado = (await api('GET', 'orcamentos?estado=proposta_enviada', 'ceo')).json.orcamentos;
  assert.ok(filtrado.length >= 1 && filtrado.every((x) => x.estado === 'proposta_enviada'));
  assert.equal((await api('GET', 'orcamentos?estado=xpto', 'ceo')).estado, 400);
  assert.equal((await api('GET', 'orcamentos/abc', 'ceo')).estado, 404);
});

test('converter: só "aceite"; cria pedido de cliente + obra com material da simulação; uma vez', async () => {
  const { cookie } = await p.contaConfirmada('rui@exemplo.pt');
  const r0 = await p.pedir('POST', '/api/orcamento', { cookie, corpo: { nome: 'Rui Costa', email: 'rui@exemplo.pt', localidade: 'Sintra', servico: 'Casa inteligente',
    simulacao: { versao: 1, itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 4 }, { sku: 'SENS-PORTA-WIFI', qtd: 2 }, { sku: 'inválido!', qtd: 1 }] } } });
  assert.equal(r0.estado, 201);
  const o = (await api('GET', 'orcamentos', 'comercial')).json.orcamentos.find((x) => x.nome === 'Rui Costa');
  assert.equal((await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'rui', data: '2026-10-10' })).estado, 409, 'ainda não aceite');
  await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'aceite', data_visita: '2026-10-01' });
  for (const corpo of [{ codigo: 'Rui' }, { codigo: 'admin' }, { codigo: 'painel' }, { codigo: 'rui', kit: 'ouro' }, { codigo: 'rui', data: 'amanha' }]) {
    assert.equal((await api('POST', `orcamentos/${o.id}/converter`, 'comercial', corpo)).estado, 400, JSON.stringify(corpo));
  }
  assert.equal((await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'rui', tecnicos: [p.u.tecnico.id] })).estado, 403, 'só o CEO atribui técnicos');
  const r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'rui', kit: 'conforto' });
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.cliente, 'rui');
  assert.equal(r.json.cliente_existia, false);
  assert.equal(r.json.pedido.tipo, 'cliente');
  assert.equal(r.json.obra.data, '2026-10-01', 'data da visita por omissão');
  assert.equal(r.json.obra.kit, 'conforto');
  assert.equal(r.json.obra.horas_estimadas, 7);
  assert.equal(r.json.obra.estado, 'agendada');
  assert.deepEqual(r.json.obra.material, [
    { sku: 'TONGOU-SY2-JWT', nome: 'Disjuntor inteligente Wi-Fi com medição e proteções (1–63 A ajustável)', quantidade: 4, feito: false },
    { sku: 'SENS-PORTA-WIFI', nome: 'Sensor de porta/janela Wi-Fi', quantidade: 2, feito: false },
  ]);
  const ficheiros = await readdir(join(p.dados, 'pedidos-admin'));
  assert.ok(ficheiros.includes(`${r.json.pedido.id}.json`));
  assert.equal(JSON.parse(await readFile(join(p.dados, 'pedidos-admin', `${r.json.pedido.id}.json`), 'utf8')).dados.codigo, 'rui');
  assert.equal((await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'rui' })).estado, 409, 'só uma vez');
  const d = (await api('GET', `orcamentos/${o.id}`, 'comercial')).json;
  assert.equal(d.cliente, 'rui');
  assert.equal(d.obra_id, r.json.obra.id);
  // A ficha do cliente novo (ainda por criar no servidor) aparece como pendente, com o orçamento de origem.
  const f = (await api('GET', 'clientes/rui', 'comercial')).json;
  assert.equal(f.pendente, true);
  assert.equal(f.nome, 'Rui Costa');
  assert.equal(f.localidade, 'Sintra');
  assert.equal(f.orcamento_origem.id, o.id);
  assert.equal(f.pedidos[0].tipo, 'cliente');
  // Cliente que já existe: não há pedido, só a obra.
  const o2 = await novoOrcamento({ nome: 'João outra vez' });
  await api('POST', `orcamentos/${o2.id}`, 'ceo', { estado: 'aceite' });
  const r2 = await api('POST', `orcamentos/${o2.id}/converter`, 'ceo', { codigo: 'joao', data: '2026-10-20', tecnicos: [p.u.tecnico.id] });
  assert.equal(r2.estado, 201);
  assert.equal(r2.json.pedido, null);
  assert.equal(r2.json.cliente_existia, true);
  assert.deepEqual(r2.json.obra.tecnicos.map((t) => t.id), [p.u.tecnico.id]);
});

test('converter com aparelhos: validados como POST clientes/:c/aparelhos; pedidos-admin pela ordem (cliente, depois aparelhos)', async () => {
  const sim = { versao: 1, itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 1, preco_iva: 54.9 }, { sku: 'SENS-PORTA-WIFI', qtd: 1, preco_iva: 19.9 }, { sku: 'JA-NAO-EXISTE', qtd: 2, preco_iva: 5 }] };
  const { cookie } = await p.contaConfirmada();
  const r0 = await p.pedir('POST', '/api/orcamento', { cookie, corpo: { nome: 'Sara Lima', telefone: '912000333', servico: 'Casa inteligente', simulacao: sim } });
  assert.equal(r0.estado, 201);
  const o = (await api('GET', 'orcamentos', 'comercial')).json.orcamentos.find((x) => x.nome === 'Sara Lima');
  // A ficha completa traz os artigos do catálogo da simulação, sem dados privados.
  const completo = await api('GET', `orcamentos/${o.id}`, 'comercial');
  assert.deepEqual(Object.keys(completo.json.catalogo).sort(), ['SENS-PORTA-WIFI', 'TONGOU-SY2-JWT']);
  assert.deepEqual(completo.json.catalogo['SENS-PORTA-WIFI'], { nome: 'Sensor de porta/janela Wi-Fi', categoria: 'sensor', especificacoes: { bateria: true, rede: 'wifi' }, preco_venda_iva: 19.9, horas_instalacao: 0.25, ativo: true });
  for (const segredo of ['preco_compra', 'fornecedor', 'link', 'Zhouqiao', 'Tongou/Changyou']) assert.ok(!JSON.stringify(completo.json.catalogo).includes(segredo), segredo);
  await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'aceite', data_visita: '2026-10-03' });
  const disj = { id: 'circuito-1', tipo: 'openbeken', nome: 'Circuito 1 Cozinha', canais: '1:interruptor:Forno:carga=perigosa', divisao: 'Cozinha', medidor: true };
  const porta = { id: 'porta-entrada', tipo: 'openbeken', nome: 'Sensor da porta de entrada', canais: '1:porta:Porta:entrada,2:bateria', divisao: 'Hall', bateria: true };
  const estore = { id: 'estore-sala', tipo: 'shelly', nome: 'Estore da sala', canais: '1:estore:Estore', divisao: 'Sala' };
  const antes = new Set(await readdir(join(p.dados, 'pedidos-admin')));
  for (const [aparelhos, estado] of [
    ['x', 400], [[1], 400], [[{ ...disj, cor: 'azul' }], 400], [[{ ...disj, id: 'Circuito 1' }], 400], [[{ ...disj, tipo: 'sonoff' }], 400],
    [[{ ...disj, nome: '"x"' }], 400], [[{ ...disj, canais: '1:interruptor:a,b' }], 400], [[{ ...disj, divisao: 'Sala, cozinha' }], 400],
    [[{ ...porta, geral: true }], 400], [[disj, disj], 400], [Array.from({ length: 61 }, (_, i) => ({ ...disj, id: `c-${i}` })), 400],
  ]) {
    const r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'sara', aparelhos });
    assert.equal(r.estado, estado, `${JSON.stringify(aparelhos).slice(0, 80)} → ${r.texto}`);
  }
  assert.match((await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'sara', aparelhos: [disj, { ...porta, id: 'X' }] })).json.erro, /^Aparelho 2: Id do aparelho inválido/);
  assert.deepEqual(new Set(await readdir(join(p.dados, 'pedidos-admin'))), antes, 'nada escrito quando a validação falha');
  assert.equal((await api('GET', `orcamentos/${o.id}`, 'comercial')).json.obra_id, null, 'nem obra criada');
  const r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'sara', kit: 'conforto', aparelhos: [disj, porta, estore] });
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.pedido.tipo, 'cliente');
  assert.deepEqual(r.json.aparelhos.map((x) => x.tipo), ['aparelho', 'aparelho', 'aparelho']);
  const ids = [r.json.pedido.id, ...r.json.aparelhos.map((x) => x.id)];
  assert.deepEqual([...ids].sort(), ids, 'os ids (nomes dos ficheiros) crescem pela ordem dos pedidos: o domus.sh fá-los por essa ordem');
  const novos = (await readdir(join(p.dados, 'pedidos-admin'))).filter((n) => !antes.has(n) && n.endsWith('.json')).sort();
  assert.deepEqual(novos, ids.map((id) => `${id}.json`));
  const linhas = await Promise.all(novos.map((n) => readFile(join(p.dados, 'pedidos-admin', n), 'utf8')));
  assert.deepEqual(JSON.parse(linhas[0]).dados, { codigo: 'sara' });
  assert.match(linhas[1], new RegExp(`^\\{"id":"${ids[1]}","tipo":"aparelho","dados":\\{"cliente":"sara","id":"circuito-1","tipo":"openbeken","nome":"Circuito 1 Cozinha","canais":"1:interruptor:Forno:carga=perigosa","divisao":"Cozinha","medidor":true,"geral":false,"bateria":false,"substituir":false\\},"por":"comercial@domus\\.teste","criado":"[0-9TZ:.-]+"\\}\\n$`));
  assert.deepEqual(JSON.parse(linhas[2]).dados, { cliente: 'sara', id: 'porta-entrada', tipo: 'openbeken', nome: 'Sensor da porta de entrada', canais: '1:porta:Porta:entrada,2:bateria', divisao: 'Hall', medidor: false, geral: false, bateria: true, substituir: false });
  assert.deepEqual(JSON.parse(linhas[3]).dados, { cliente: 'sara', id: 'estore-sala', tipo: 'shelly', nome: 'Estore da sala', canais: '1:estore:Estore', divisao: 'Sala', medidor: false, geral: false, bateria: false, substituir: false });
  // Os pedidos ficam na ficha do cliente e contam no orçamento (material só com os artigos do catálogo).
  assert.deepEqual(r.json.obra.material.map((m) => m.sku), ['TONGOU-SY2-JWT', 'SENS-PORTA-WIFI', 'JA-NAO-EXISTE']);
  const ficha = (await api('GET', 'clientes/sara', 'comercial')).json;
  assert.deepEqual(ficha.pedidos.map((x) => x.tipo).sort(), ['aparelho', 'aparelho', 'aparelho', 'cliente']);
  assert.ok(p.app.db.prepare('SELECT 1 FROM auditoria WHERE acao = \'orcamento_convertido\' AND json_extract(detalhes, \'$.aparelhos\') = 3').get());
  // Cliente que já existe: aparelho com o mesmo id → 409 (sem "substituir"); com "substituir" → pedido.
  const o2 = await novoOrcamento({ nome: 'João aparelhos' });
  await api('POST', `orcamentos/${o2.id}`, 'ceo', { estado: 'aceite' });
  const sala = { id: 'sala', tipo: 'openbeken', nome: 'Sala nova' };
  assert.equal((await api('POST', `orcamentos/${o2.id}/converter`, 'ceo', { codigo: 'joao', data: '2026-10-21', aparelhos: [sala] })).estado, 409);
  const r2 = await api('POST', `orcamentos/${o2.id}/converter`, 'ceo', { codigo: 'joao', data: '2026-10-21', aparelhos: [{ ...sala, substituir: true }, { id: 'pir-hall', tipo: 'openbeken', nome: 'Movimento do hall', canais: '1:movimento:Movimento,2:bateria', bateria: true }] });
  assert.equal(r2.estado, 201, r2.texto);
  assert.equal(r2.json.pedido, null, 'cliente já existe: sem pedido de cliente');
  assert.deepEqual(r2.json.aparelhos.map((x) => x.id), [...r2.json.aparelhos.map((x) => x.id)].sort());
  assert.equal(r2.json.aparelhos.length, 2);
});

test('ids dos pedidos-admin crescem mesmo no mesmo segundo', async () => {
  const ids = [];
  for (let i = 0; i < 40; i++) ids.push((await p.app.pedidos.criar({ tipo: 'plano', cliente: 'maria', utilizador: { id: p.u.ceo.id, email: 'ceo@domus.teste' }, dados: { cliente: 'maria', plano: 'base', estado: 'ativo' } })).id);
  assert.deepEqual([...ids].sort(), ids);
  assert.ok(ids.every((id) => /^p-\d{14}-[0-9a-f]{8}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('obras: CEO cria e gere; técnico só vê e altera as suas (campos limitados); comercial só lê', async () => {
  let r = await api('POST', 'obras', 'ceo', { cliente: 'joao', data: '2026-10-05', hora: '09:00', kit: 'premium', tecnicos: [p.u.tecnico.id], material: ['Disjuntor', { nome: 'Cabo', quantidade: 20 }] });
  assert.equal(r.estado, 201, r.texto);
  const obra = r.json;
  assert.equal(obra.horas_estimadas, 10, 'kit premium: 10 h');
  assert.deepEqual(obra.material, [{ nome: 'Disjuntor', quantidade: 1, feito: false }, { nome: 'Cabo', quantidade: 20, feito: false }]);
  r = await api('POST', 'obras', 'ceo', { cliente: 'maria', data: '2026-10-06', kit: 'essencial', tecnicos: [tec2.id] });
  const outra = r.json;
  assert.equal(outra.horas_estimadas, 3);
  for (const corpo of [{ cliente: 'ninguem', data: '2026-10-05' }, { cliente: 'joao' }, { cliente: 'joao', data: '2026-10-05', estado: 'feita' },
    { cliente: 'joao', data: '2026-10-05', tecnicos: [p.u.comercial.id] }, { cliente: 'joao', data: '2026-10-05', material: 'x' }, { cliente: 'joao', data: '2026-10-05', hora: '25:00' }]) {
    assert.equal((await api('POST', 'obras', 'ceo', corpo)).estado, 400, JSON.stringify(corpo));
  }
  // Técnico: lista só as suas.
  const minhas = (await api('GET', 'obras', 'tecnico')).json.obras;
  assert.ok(minhas.some((o) => o.id === obra.id));
  assert.ok(!minhas.some((o) => o.id === outra.id));
  assert.equal((await api('GET', `obras/${outra.id}`, 'tecnico')).estado, 403);
  assert.equal((await api('POST', `obras/${outra.id}`, 'tecnico', { notas: 'x' })).estado, 403);
  assert.equal((await api('GET', `obras/${obra.id}`, 'tecnico')).estado, 200);
  r = await api('POST', `obras/${obra.id}`, 'tecnico', { estado: 'em_curso', horas_reais: 4.5, notas: 'Falta o quadro.',
    material: [{ nome: 'Disjuntor', quantidade: 1, feito: true }, { nome: 'Cabo', quantidade: 20, feito: false }] });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.estado, 'em_curso');
  assert.equal(r.json.horas_reais, 4.5);
  assert.equal(r.json.material[0].feito, true);
  for (const corpo of [{ data: '2026-12-01' }, { tecnicos: [p.u.tecnico.id, tec2.id] }, { cliente: 'maria' }, { kit: 'essencial' }, { horas_estimadas: 1 }]) {
    assert.equal((await api('POST', `obras/${obra.id}`, 'tecnico', corpo)).estado, 403, JSON.stringify(corpo));
  }
  assert.equal((await api('POST', `obras/${obra.id}`, 'tecnico', { estado: 'cancelada' })).estado, 403, 'só o CEO cancela');
  assert.equal((await api('GET', `obras/${obra.id}`, 'ceo')).json.data, '2026-10-05', 'nada mudou');
  // Técnico 2 não vê a obra do técnico 1.
  assert.equal((await api('GET', `obras/${obra.id}`, cTec2)).estado, 403);
  // Comercial: agenda só de leitura.
  const agenda = (await api('GET', 'obras?de=2026-10-01&ate=2026-10-31', 'comercial')).json.obras;
  assert.ok(agenda.some((o) => o.id === obra.id) && agenda.some((o) => o.id === outra.id));
  assert.equal((await api('POST', `obras/${obra.id}`, 'comercial', { notas: 'x' })).estado, 403);
  assert.equal((await api('POST', 'obras', 'comercial', { cliente: 'joao', data: '2026-10-05' })).estado, 403);
  // CEO: reatribuir e cancelar.
  r = await api('POST', `obras/${obra.id}`, 'ceo', { tecnicos: [tec2.id], estado: 'cancelada' });
  assert.equal(r.estado, 200);
  assert.deepEqual(r.json.tecnicos.map((t) => t.id), [tec2.id]);
  assert.equal((await api('GET', `obras/${obra.id}`, 'tecnico')).estado, 403, 'deixou de ser do técnico 1');
  assert.equal((await api('GET', 'obras?estado=cancelada', 'ceo')).json.obras.length >= 1, true);
  const aud = (await api('GET', `auditoria?alvo=obra:${obra.id}`, 'ceo')).json.auditoria;
  assert.deepEqual(aud.map((a) => a.acao), ['obra_atualizada', 'obra_atualizada', 'obra_criada']);
  assert.equal(aud[1].email, 'tecnico@domus.teste');
});

test('clientes: lista, ficha (aparelhos, plano, obras), filtros, financeiro só CEO', async () => {
  const lista = (await api('GET', 'clientes', 'ceo')).json.clientes;
  const joao = lista.find((c) => c.codigo === 'joao');
  const maria = lista.find((c) => c.codigo === 'maria');
  assert.equal(joao.n_aparelhos, 3);
  assert.equal(joao.plano, 'premium');
  assert.equal(joao.estado, 'em_atraso');
  assert.equal(joao.proximo_pagamento, '2026-10-01T10:00:00Z');
  assert.equal(joao.valor_mensal_sem_iva, 16.25);
  assert.equal(maria.plano, 'conforto', 'sem ficheiro de plano: conforto ativo (PROTOCOLO-PLANOS §2)');
  assert.equal(maria.estado, 'ativo');
  assert.equal(maria.sem_ficheiro_plano, true);
  assert.deepEqual((await api('GET', 'clientes?plano=premium', 'comercial')).json.clientes.map((c) => c.codigo), ['joao']);
  assert.deepEqual((await api('GET', 'clientes?estado=em_atraso', 'tecnico')).json.clientes.map((c) => c.codigo), ['joao']);
  const f = (await api('GET', 'clientes/joao', 'ceo')).json;
  assert.deepEqual(f.aparelhos.map((a) => a.id), ['sala', 'porta', 'velho']);
  assert.deepEqual(f.aparelhos[0], { id: 'sala', tipo: 'openbeken', nome: 'Sala grande', medidor: true, geral: false, bateria: false, divisao: null,
    canais: [{ n: 1, funcao: 'interruptor', nome: 'Teto', simular: true, arranque: 'ultimo', divisao: 'Sala' }, { n: 2, funcao: 'luz', arranque: 'desligado' }] });
  assert.equal(f.aparelhos[1].bateria, true);
  assert.deepEqual(f.aparelhos[1].canais[0], { n: 1, funcao: 'porta', nome: 'Entrada', entrada: true });
  assert.deepEqual(f.pagamentos.map((x) => x.id_stripe), ['in_2', 'in_1']);
  assert.equal(f.total_pago, 39.98);
  assert.ok(Array.isArray(f.obras) && f.obras.length >= 1);
  assert.ok(!JSON.stringify(f).includes('SEGREDO'), 'ids do Stripe nunca saem');
  for (const papel of ['tecnico', 'comercial']) {
    const x = (await api('GET', 'clientes/joao', papel)).json;
    for (const k of ['pagamentos', 'total_pago', 'proximo_pagamento', 'valor_mensal_iva', 'aviso_ate']) assert.ok(!(k in x), `${papel}: ${k}`);
    assert.equal(x.plano, 'premium', `${papel} vê o plano e o estado`);
  }
  const fT = (await api('GET', 'clientes/joao', 'tecnico')).json;
  assert.ok(fT.obras.every((o) => o.tecnicos.some((t) => t.id === p.u.tecnico.id)), 'técnico: só as suas obras na ficha');
  assert.ok(!('orcamento_origem' in fT));
  assert.ok(!('alertas_lista' in (await api('GET', 'clientes/joao', 'comercial')).json));
  assert.equal((await api('GET', 'clientes/ninguem', 'ceo')).estado, 404);
  assert.equal((await api('GET', 'clientes/..%2f..%2fetc', 'ceo')).estado, 404);
});

test('pagamentos (CEO): linhas do CSV, totais por mês, exportar CSV seguro', async () => {
  const r = (await api('GET', 'pagamentos', 'ceo')).json;
  assert.equal(r.linhas.length, 4, 'linhas inválidas ignoradas');
  assert.deepEqual(r.totais_mes, [
    { mes: '2026-09', pagamentos: 3, com_iva: 29.97, sem_iva: 24.37 },
    { mes: '2026-08', pagamentos: 1, com_iva: 19.99, sem_iva: 16.25 },
  ]);
  assert.deepEqual(r.total, { pagamentos: 4, com_iva: 49.96, sem_iva: 40.62 });
  assert.equal((await api('GET', 'pagamentos?mes=2026-08', 'ceo')).json.linhas.length, 1);
  assert.equal((await api('GET', 'pagamentos?mes=agosto', 'ceo')).estado, 400);
  const csv = await api('GET', 'pagamentos?formato=csv&mes=2026-09', 'ceo');
  assert.equal(csv.estado, 200);
  assert.equal(csv.cabecalhos['content-type'], 'text/csv; charset=utf-8');
  assert.equal(csv.cabecalhos['content-disposition'], 'attachment; filename="pagamentos-2026-09.csv"');
  const linhas = csv.texto.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(linhas[0], 'data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe');
  assert.equal(linhas[1], '2026-09-01;joao;premium;19,99;16,25;in_2');
  assert.ok(linhas.some((l) => l.startsWith("2026-09-05;'=cmd|x;")), 'fórmulas neutralizadas');
  for (const papel of ['tecnico', 'comercial']) assert.equal((await api('GET', 'pagamentos?formato=csv', papel)).estado, 403);
});

test('utilizadores (CEO): criar com palavra-passe gerada (mostrada uma vez), mudar papel, repor, desativar, último CEO', async () => {
  let r = await api('POST', 'utilizadores', 'ceo', { nome: 'Nova Técnica', email: 'Nova@Domus.teste', papel: 'tecnico' });
  assert.equal(r.estado, 201);
  assert.equal(r.json.utilizador.email, 'nova@domus.teste');
  assert.equal(r.json.utilizador.hash, undefined);
  assert.match(r.json.password, /^[A-Za-z0-9]{16}$/);
  const id = r.json.utilizador.id;
  const c = await p.entrar('nova@domus.teste', r.json.password);
  assert.equal((await api('POST', 'utilizadores', 'ceo', { nome: 'X', email: 'nova@domus.teste', papel: 'ceo' })).estado, 409);
  for (const corpo of [{ nome: 'X', email: 'x', papel: 'ceo' }, { nome: 'X', email: 'y@domus.teste', papel: 'admin' }, { nome: 'X', email: 'z@domus.teste', papel: 'ceo', password: 'curta' }]) {
    assert.equal((await api('POST', 'utilizadores', 'ceo', corpo)).estado, 400, JSON.stringify(corpo));
  }
  r = await api('POST', `utilizadores/${id}`, 'ceo', { papel: 'comercial' });
  assert.equal(r.json.utilizador.papel, 'comercial');
  assert.equal((await api('GET', 'eu', c)).estado, 401, 'mudança de papel termina as sessões');
  r = await api('POST', `utilizadores/${id}`, 'ceo', { repor_password: true });
  assert.match(r.json.password, /^[A-Za-z0-9]{16}$/);
  await p.entrar('nova@domus.teste', r.json.password);
  r = await api('POST', `utilizadores/${id}`, 'ceo', { password: 'escolhida-pelo-ceo' });
  assert.equal(r.json.password, undefined, 'palavra-passe escolhida não é devolvida');
  await p.entrar('nova@domus.teste', 'escolhida-pelo-ceo');
  // Último CEO ativo não pode deixar de o ser.
  assert.equal((await api('POST', `utilizadores/${p.u.ceo.id}`, 'ceo', { papel: 'tecnico' })).estado, 409);
  assert.equal((await api('POST', `utilizadores/${p.u.ceo.id}`, 'ceo', { ativo: false })).estado, 409);
  const lista = (await api('GET', 'utilizadores', 'ceo')).json.utilizadores;
  assert.ok(lista.every((u) => !('hash' in u)));
  const aud = JSON.stringify((await api('GET', 'auditoria', 'ceo')).json);
  assert.ok(!aud.includes('escolhida-pelo-ceo') && !aud.includes('scrypt$'), 'auditoria sem palavras-passe nem hashes');
  assert.ok(aud.includes('palavra_passe_reposta'));
});

test('auditoria: quem, o quê, quando; últimas 500, mais recentes primeiro', async () => {
  for (let i = 0; i < 30; i++) p.app.api.auditar({ id: 1, email: 'x@y' }, 'teste_massa', `t:${i}`);
  const a = (await api('GET', 'auditoria', 'ceo')).json.auditoria;
  assert.ok(a.length <= 500);
  assert.equal(a[0].acao, 'teste_massa');
  assert.equal(a[0].alvo, 't:29');
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].id > a[i].id);
  for (let i = 0; i < 520; i++) p.app.api.auditar(null, 'mais', null);
  assert.equal((await api('GET', 'auditoria', 'ceo')).json.auditoria.length, 500);
  assert.ok(a.some((x) => x.acao === 'orcamento_convertido' && x.email === 'comercial@domus.teste' && x.quando && x.ip));
});

test('datas de Lisboa (resumo)', () => {
  assert.equal(somarDiasCivil('2026-10-25', 1), '2026-10-26');
  assert.match(diaLisboa(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test('converter: dois pedidos ao mesmo tempo → só um converte (sem obras nem pedidos em dobro)', async () => {
  const r0 = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Duplo Clique', email: 'duplo@exemplo.pt', servico: 'Casa inteligente' } });
  assert.equal(r0.estado, 201);
  const o = (await api('GET', 'orcamentos', 'comercial')).json.orcamentos.find((x) => x.nome === 'Duplo Clique');
  await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'aceite', data_visita: '2026-10-05' });
  const antes = (await readdir(join(p.dados, 'pedidos-admin'))).length;
  const aparelhos = [{ id: 'luz-sala', tipo: 'shelly', nome: 'Luz da sala', canais: '1:luz:Luz', divisao: 'Sala' }];
  const rs = await Promise.all([1, 2].map(() => api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'duplo', aparelhos })));
  assert.deepEqual(rs.map((r) => r.estado).sort(), [201, 409], rs.map((r) => r.texto).join(' | '));
  assert.equal((await readdir(join(p.dados, 'pedidos-admin'))).length - antes, 2, 'um pedido de cliente + um de aparelho');
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM obras WHERE orcamento_id = ?').get(o.id).n, 1);
});

test('aparelho: canais com número repetido ou função desconhecida são recusados (como no domus.sh)', async () => {
  const r0 = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Canais Maus', email: 'canais@exemplo.pt', servico: 'Casa inteligente' } });
  assert.equal(r0.estado, 201);
  const o = (await api('GET', 'orcamentos', 'comercial')).json.orcamentos.find((x) => x.nome === 'Canais Maus');
  await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'aceite', data_visita: '2026-10-06' });
  const base = { id: 'qx', tipo: 'openbeken', nome: 'Qx' };
  for (const canais of ['1:interruptor:X,1:luz:Y', '1:tomada:X', '2:luz:A,3:portao:B']) {
    const r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'canais', aparelhos: [{ ...base, canais }] });
    assert.equal(r.estado, 400, `${canais} → ${r.texto}`);
  }
  const r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'canais', aparelhos: [{ ...base, canais: '1:interruptor:X,2:luz:Y' }] });
  assert.equal(r.estado, 201, r.texto);
});

test('converter: horas da obra = mão de obra da simulação (se houver); o pedido pode mudá-las; sem simulação, as do kit', async () => {
  const comSim = async (nome, sim) => {
    const o = await novoOrcamento({ nome });
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(sim === null ? null : JSON.stringify(sim), o.id);
    await api('POST', `orcamentos/${o.id}`, 'comercial', { estado: 'aceite' });
    return o;
  };
  let o = await comSim('Horas Sim', { versao: 1, itens: [], mao_obra: { horas: 39.25, valor_iva: 1373.75 } });
  let r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'horas-sim', kit: 'conforto', data: '2026-11-02' });
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.obra.horas_estimadas, 39.25, 'da simulação, não do kit');
  o = await comSim('Horas Mudadas', { versao: 1, itens: [], mao_obra: { horas: 39.25 } });
  r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'horas-mud', kit: 'conforto', data: '2026-11-02', horas_estimadas: 30.5 });
  assert.equal(r.json.obra.horas_estimadas, 30.5, 'o valor do formulário ganha');
  o = await comSim('Horas Kit', { versao: 1, itens: [], mao_obra: { horas: null } });
  r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'horas-kit', kit: 'premium', data: '2026-11-02' });
  assert.equal(r.json.obra.horas_estimadas, 10, 'simulação sem horas: as do kit');
  o = await comSim('Sem Sim', null);
  r = await api('POST', `orcamentos/${o.id}/converter`, 'comercial', { codigo: 'horas-nada', kit: 'essencial', data: '2026-11-02' });
  assert.equal(r.json.obra.horas_estimadas, 3, 'sem simulação: as do kit');
});
