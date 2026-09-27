// GET resumo: números por papel (CEO: clientes por plano/estado, receita
// recorrente s/ IVA, recebido no mês, pedidos novos, obras da semana;
// técnico: as suas obras hoje/semana; comercial: pedidos por estado e visitas).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { diaLisboa, semanaLisboa, somarDiasCivil } from '../src/util.js';

let p;
let tec2;
const hoje = diaLisboa(new Date());
const { inicio, fim } = semanaLisboa(new Date());
const mes = hoje.slice(0, 7);
const mesAnterior = somarDiasCivil(`${mes}-01`, -1).slice(0, 7);

before(async () => {
  p = await painelComEquipa();
  tec2 = await p.criarUtilizador('tecnico', 'tec2@domus.teste');
  const plano = (plano, estado) => `${JSON.stringify({ plano, estado, desde: '2026-01-01T00:00:00Z', proximo_pagamento: null, aviso_ate: null, gerido: 'stripe' })}\n`;
  for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) await writeFile(join(p.dados, 'clientes', `${c}.tsv`), '');
  await writeFile(join(p.dados, 'planos', 'a.json'), plano('base', 'ativo'));
  await writeFile(join(p.dados, 'planos', 'b.json'), plano('conforto', 'ativo'));
  await writeFile(join(p.dados, 'planos', 'c.json'), plano('premium', 'ativo'));
  await writeFile(join(p.dados, 'planos', 'd.json'), plano('conforto', 'suspenso'));
  await writeFile(join(p.dados, 'planos', 'f.json'), plano('premium', 'teste'));
  // "e" sem ficheiro: conforto ativo (PROTOCOLO-PLANOS §2). Ficheiro de um cliente que não existe: ignorado.
  await writeFile(join(p.dados, 'planos', 'fantasma.json'), plano('premium', 'ativo'));
  await writeFile(join(p.dados, 'pagamentos', 'pagamentos.csv'), [
    'data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe',
    `${mesAnterior}-15;a;base;4,99;4,06;in_0`,
    `${mes}-01;b;conforto;9,99;8,12;in_1`,
    `${mes}-01;c;premium;19,99;16,25;in_2`,
    '',
  ].join('\n'));
  const db = p.app.db;
  const agora = new Date().toISOString();
  const orc = db.prepare(`INSERT INTO orcamentos (criado, atualizado, nome, telefone, servico, estado, data_visita, motivo_perda) VALUES (?, ?, 'X', '210000000', 'Outro', ?, ?, ?)`);
  orc.run(agora, agora, 'novo', null, null);
  orc.run(agora, agora, 'novo', null, null);
  orc.run(agora, agora, 'contactado', null, null);
  orc.run(agora, agora, 'visita_marcada', `${hoje}T10:00`, null);
  orc.run(agora, agora, 'visita_marcada', somarDiasCivil(fim, 1), null);
  orc.run(agora, agora, 'perdido', hoje, 'Preço');
  const obra = db.prepare('INSERT INTO obras (cliente, data, estado, criado, atualizado) VALUES (?, ?, ?, ?, ?)');
  const tec = db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)');
  const o1 = obra.run('a', hoje, 'agendada', agora, agora).lastInsertRowid;
  tec.run(o1, p.u.tecnico.id);
  const o2 = obra.run('b', inicio, 'em_curso', agora, agora).lastInsertRowid;
  tec.run(o2, tec2.id);
  const o3 = obra.run('c', fim, 'cancelada', agora, agora).lastInsertRowid;
  tec.run(o3, p.u.tecnico.id);
  const o4 = obra.run('c', somarDiasCivil(fim, 1), 'agendada', agora, agora).lastInsertRowid;
  tec.run(o4, p.u.tecnico.id);
  const o5 = obra.run('d', fim, 'agendada', agora, agora).lastInsertRowid;
  tec.run(o5, p.u.tecnico.id);
  p.app.db.prepare('INSERT INTO pedidos_admin (id, tipo, cliente, dados, por_email, criado) VALUES (\'p-20260101000000-00000001\', \'cliente\', \'z\', \'{}\', \'x\', ?)').run(agora);
});
after(() => p.fechar());

const resumo = async (papel) => (await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies[papel] })).json;

test('CEO: clientes, receita recorrente, recebido no mês, pedidos novos, obras da semana', async () => {
  const r = await resumo('ceo');
  assert.equal(r.papel, 'ceo');
  assert.deepEqual(r.semana, { inicio, fim });
  assert.deepEqual(r.clientes, {
    total: 6,
    por_plano: { base: 1, conforto: 3, premium: 2 },
    por_estado: { ativo: 4, teste: 1, em_atraso: 0, suspenso: 1, cancelado: 0 },
  });
  // Ativos: a (base 4,06) + b (conforto 8,12) + c (premium 16,25) + e (conforto, sem ficheiro, 8,12). f em teste e d suspenso não contam.
  assert.equal(r.receita_recorrente_mensal, 36.55);
  assert.deepEqual(r.recebido_mes, { mes, pagamentos: 2, com_iva: 29.98, sem_iva: 24.37 });
  assert.equal(r.pedidos_novos, 2);
  assert.deepEqual(r.obras_semana.map((o) => o.cliente).sort(), ['a', 'b', 'd'], 'sem canceladas nem da semana seguinte');
  assert.equal(r.pedidos_admin_pendentes, 1);
  assert.equal(r.alertas.ligado, false, 'sem MQTT neste teste');
  assert.deepEqual(r.alertas.contagem, { critica: 0, alta: 0, media: 0, baixa: 0 });
});

test('técnico: só as suas obras de hoje e da semana, e alertas; nada financeiro', async () => {
  const r = await resumo('tecnico');
  assert.deepEqual(r.obras_hoje.map((o) => o.cliente).sort(), hoje === fim ? ['a', 'd'] : ['a'], 'a obra "d" é no domingo');
  assert.deepEqual(r.obras_semana.map((o) => o.cliente).sort(), ['a', 'd']);
  assert.ok(r.obras_semana.every((o) => o.tecnicos.some((t) => t.id === p.u.tecnico.id)));
  assert.ok('alertas' in r);
  for (const k of ['receita_recorrente_mensal', 'recebido_mes', 'clientes', 'orcamentos_por_estado', 'pedidos_novos']) assert.ok(!(k in r), k);
});

test('comercial: pedidos por estado e visitas da semana; sem dinheiro nem alertas', async () => {
  const r = await resumo('comercial');
  assert.deepEqual(r.orcamentos_por_estado, { novo: 2, contactado: 1, visita_marcada: 2, proposta_enviada: 0, aceite: 0, perdido: 1 });
  assert.equal(r.pedidos_novos, 2);
  assert.equal(r.visitas_semana.length, 1, 'a visita desta semana (a da semana seguinte e a do perdido não contam)');
  assert.equal(r.visitas_semana[0].data_visita, `${hoje}T10:00`);
  for (const k of ['receita_recorrente_mensal', 'recebido_mes', 'clientes', 'alertas', 'obras_semana']) assert.ok(!(k in r), k);
  assert.ok(!JSON.stringify(r).includes('com_iva'));
});
