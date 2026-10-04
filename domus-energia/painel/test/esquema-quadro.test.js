// Ronda B (decisão do dono): o esquema do quadro elétrico é feito pelo eletricista no painel a partir da foto do cliente
// (docs/PAINEL-EMPRESA.md "Esquema do quadro"): o modelo (web/simulador/quadro-desenho.js, cópia em
// painel/public/vendor), a ordem na calha (`ordem`), a validação do servidor (validar.js esquemaQuadro), a rota
// POST orcamentos/:id/esquema-quadro (CEO e comercial; auditoria) e a migração 17. O simulador já não manda
// `quadro.leitura_cliente` nem tem o POST /api/simulador/ler-quadro.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { painelComEquipa } from './ajuda.js';
import { simulacao as validarSimulacao, esquemaQuadro } from '../src/validar.js';
import { abrirDb, versaoEsquema } from '../src/db.js';
import { esquemaVazio, normalizarEsquema, normalizarOrdem, resumoEsquema, esquemaDaLeitura, MAX_LIVRES_ORDEM, MAX_ESQUEMA } from '../../web/simulador/quadro-desenho.js';
import { montarSimulacao, estadoNovo, normalizarEstado } from '../../web/simulador/estado.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const ESQUEMA = {
  disjuntor_geral: { amperes: 40 },
  diferenciais: [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }],
  disjuntores: [{ amperes: 16 }, { amperes: 10 }, { amperes: 20 }],
  modulos_livres: 3,
  estado: 'razoavel', fusiveis: false, sinais_aquecimento: null, notas: 'Quadro Hager.',
  ordem: ['geral', 'diferencial:0', 'disjuntor:0', 'disjuntor:1', 'livre', 'livre', 'livre', 'diferencial:1', 'disjuntor:2'],
};

test('vendor: painel/public/vendor/quadro-desenho.js é cópia de web/simulador/quadro-desenho.js', async () => {
  const site = await readFile(new URL('../../web/simulador/quadro-desenho.js', import.meta.url), 'utf8');
  const painel = await readFile(new URL('../public/vendor/quadro-desenho.js', import.meta.url), 'utf8');
  assert.equal(painel.replace(/\r\n/g, '\n'), site.replace(/\r\n/g, '\n'));
});

test('normalizarEsquema: a ordem na calha mantém-se; sem `ordem` fica por tipo; lugares inválidos, repetidos e a mais caem', () => {
  const l = normalizarEsquema(ESQUEMA);
  assert.deepEqual(l.ordem, ESQUEMA.ordem, 'a ordem gravada mantém-se (o disjuntor 3 depois dos livres)');
  assert.equal(resumoEsquema(l), 'Geral 40 A · 2 diferenciais · 3 disjuntores · 3 livres');
  const semOrdem = normalizarEsquema({ ...ESQUEMA, ordem: undefined });
  assert.deepEqual(semOrdem.ordem, ['geral', 'diferencial:0', 'diferencial:1', 'disjuntor:0', 'disjuntor:1', 'disjuntor:2', 'livre', 'livre', 'livre']);
  const suja = normalizarEsquema({ ...ESQUEMA, ordem: ['disjuntor:9', 'x', 'geral', 'geral', 'livre', 'livre', 'livre', 'livre', 'disjuntor:1', 7] });
  assert.deepEqual(suja.ordem, ['geral', 'livre', 'livre', 'livre', 'disjuntor:1', 'diferencial:0', 'diferencial:1', 'disjuntor:0', 'disjuntor:2'],
    'desconhecidos e repetidos caem, só 3 livres, o que falta junta-se no fim por tipo');
  // Os módulos livres mandam no n.º de "livre": a menos acrescentam-se no fim, a mais caem; no desenho até MAX_LIVRES_ORDEM.
  assert.equal(normalizarEsquema({ ...ESQUEMA, modulos_livres: 5 }).ordem.filter((t) => t === 'livre').length, 5);
  assert.equal(normalizarEsquema({ ...ESQUEMA, modulos_livres: 1 }).ordem.filter((t) => t === 'livre').length, 1);
  const muitos = normalizarEsquema({ ...ESQUEMA, modulos_livres: 200 });
  assert.equal(muitos.modulos_livres, 200);
  assert.equal(muitos.ordem.filter((t) => t === 'livre').length, MAX_LIVRES_ORDEM);
  assert.ok(muitos.ordem.length <= MAX_ESQUEMA.ordem);
  // Limites e vazio.
  assert.equal(normalizarEsquema(null), null);
  const n = normalizarEsquema({ disjuntores: [{ amperes: -3 }, { amperes: 16 }], modulos_livres: 9999, estado: 'velho', notas: 'a\nb', fusiveis: 'sim' });
  assert.deepEqual([n.disjuntores, n.modulos_livres, n.estado, n.notas, n.fusiveis, n.disjuntor_geral], [[{ amperes: null }, { amperes: 16 }], 200, null, 'a b', null, null]);
  assert.deepEqual(normalizarOrdem(undefined, esquemaVazio()), []);
});

test('validar.js esquemaQuadro: aceita o esquema normalizado e recusa o resto; a simulação já não leva leitura_cliente', () => {
  assert.doesNotThrow(() => esquemaQuadro(normalizarEsquema(ESQUEMA)));
  assert.doesNotThrow(() => esquemaQuadro(esquemaVazio()));
  const mau = (x, re = /Esquema do quadro/) => assert.throws(() => esquemaQuadro({ ...ESQUEMA, ...x }), re, JSON.stringify(x));
  mau({ origem: 'foto' });
  mau({ corrigida: true });
  mau({ disjuntor_geral: { amperes: 0 } });
  mau({ disjuntores: Array(81).fill({ amperes: 16 }) });
  mau({ diferenciais: [{ sensibilidade_ma: 5000, amperes: 40 }] });
  mau({ modulos_livres: 1.5 });
  mau({ estado: 'otimo' });
  mau({ notas: 'x'.repeat(301) });
  mau({ ordem: ['geral', 'disjuntor:x'] }, /lugar inválido/);
  mau({ ordem: Array(151).fill('livre') }, /até 150/);
  mau({ ordem: 'geral' }, /até 150/);
  assert.throws(() => esquemaQuadro(null), /Esquema do quadro/);
  // O simulador antigo que mande `quadro.leitura_cliente`: cai sem erro (não é 400).
  const json = validarSimulacao({ versao: 1, quadro: { circuitos: [], leitura_cliente: { origem: 'manual' } } });
  assert.doesNotMatch(json, /leitura_cliente/);
});

test('simulador: o pedido não leva leitura_cliente e os estados antigos com `leitura`/`sugestoes` carregam-se sem elas', () => {
  const e = normalizarEstado({ ...estadoNovo(), quadro: { circuitos: [], leitura: { origem: 'foto', disjuntores: [{ amperes: 16 }] }, sugestoes: { notas: ['x'] } } });
  assert.equal(e.quadro.leitura, undefined);
  assert.equal(e.quadro.sugestoes, undefined);
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  const sim = montarSimulacao(e, calcularPreco([], catalogo, null), 'base', []);
  assert.equal(sim.quadro.leitura_cliente, undefined);
  assert.equal(sim.quadro.foto, null, 'a foto do quadro continua a ir no pedido (null sem foto)');
});

test('migração 17: orcamentos.esquema_quadro', () => {
  const db = abrirDb(':memory:');
  assert.ok(versaoEsquema(db) >= 17);
  assert.ok(db.prepare('PRAGMA table_info(orcamentos)').all().some((c) => c.name === 'esquema_quadro'));
  db.close();
});

describe('POST /painel/api/orcamentos/:id/esquema-quadro', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());
  const api = (metodo, caminho, papel, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { corpo, cookie: p.cookies[papel] });

  test('guarda (normalizado, com data e autor), devolve a ficha, fica na auditoria e no pedido; apaga com null; 400 inválido', async () => {
    const o = (await api('POST', 'orcamentos', 'ceo', { nome: 'Rui Quadro', telefone: '912345678', localidade: 'Oeiras', servico: 'Instalação' })).json;
    const id = o.id ?? o.orcamento?.id;
    assert.ok(id, JSON.stringify(o));
    assert.equal((await api('GET', `orcamentos/${id}`, 'ceo')).json.esquema_quadro, null, 'sem esquema');
    // Com lugares a mais e repetidos: o servidor normaliza como o editor.
    let r = await api('POST', `orcamentos/${id}/esquema-quadro`, 'comercial', { esquema: { ...ESQUEMA, ordem: [...ESQUEMA.ordem, 'geral', 'livre'] } });
    assert.equal(r.estado, 200, r.texto);
    const e = r.json.esquema_quadro;
    assert.deepEqual(e.ordem, ESQUEMA.ordem);
    assert.equal(e.disjuntor_geral.amperes, 40);
    assert.equal(e.por, p.u.comercial.email);
    assert.match(e.data, /^\d{4}-\d{2}-\d{2}T/);
    const g = await api('GET', `orcamentos/${id}`, 'ceo');
    assert.deepEqual(g.json.esquema_quadro.ordem, ESQUEMA.ordem, 'a ficha completa traz o esquema');
    const h = g.json.historico.find((x) => x.acao === 'esquema_quadro_atualizado');
    assert.ok(h, 'auditoria "Esquema do quadro atualizado"');
    assert.deepEqual(h.detalhes, { geral: 40, diferenciais: 2, disjuntores: 3, modulos_livres: 3, estado: 'razoavel' });
    assert.equal((await api('POST', `orcamentos/${id}/esquema-quadro`, 'ceo', { esquema: { ...ESQUEMA, extra: 1 } })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/esquema-quadro`, 'ceo', { esquema: { ordem: ['nada'] } })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/esquema-quadro`, 'ceo', { outro: 1 })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/esquema-quadro`, 'tecnico', { esquema: ESQUEMA })).estado, 403);
    assert.equal((await api('POST', 'orcamentos/999/esquema-quadro', 'ceo', { esquema: ESQUEMA })).estado, 404);
    r = await api('POST', `orcamentos/${id}/esquema-quadro`, 'ceo', { esquema: null });
    assert.equal(r.estado, 200);
    assert.equal(r.json.esquema_quadro, null, 'apagado');
    // Na base fica JSON (a linha `o.esquema_quadro` que o relatório pormenorizado lê).
    await api('POST', `orcamentos/${id}/esquema-quadro`, 'ceo', { esquema: ESQUEMA });
    const linha = p.app.db.prepare('SELECT esquema_quadro FROM orcamentos WHERE id = ?').get(id);
    assert.deepEqual(JSON.parse(linha.esquema_quadro).ordem, ESQUEMA.ordem);
  });
});

test('esquemaDaLeitura: rascunho do esquema pela leitura automática da foto (quantidades por calibre, sem ordem lida)', () => {
  const leitura = {
    e_quadro_eletrico: true, disjuntores_total: 6, disjuntores: [{ amperes: 10, quantidade: 2 }, { amperes: 16, quantidade: 3 }],
    diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 2 }], disjuntor_geral: { visivel: true, amperes: 32, tipo: 'disjuntor 2P' },
    modulos_livres_estimados: 3, marcas: ['Hager'], estado_aparente: 'razoavel', fusiveis: false, sinais_aquecimento: null, notas: 'Confirmar a terra.', confianca: 'media',
  };
  const l = esquemaDaLeitura(leitura);
  assert.deepEqual(l.disjuntor_geral, { amperes: 32 });
  assert.deepEqual(l.diferenciais, [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }]);
  assert.deepEqual(l.disjuntores.map((d) => d.amperes), [10, 10, 16, 16, 16, null], 'o 6.º foi contado mas não lido');
  assert.equal(l.modulos_livres, 3);
  assert.deepEqual([l.estado, l.fusiveis, l.sinais_aquecimento, l.notas], ['razoavel', false, null, 'Confirmar a terra.']);
  assert.deepEqual(l.ordem, ['geral', 'diferencial:0', 'diferencial:1', 'disjuntor:0', 'disjuntor:1', 'disjuntor:2', 'disjuntor:3', 'disjuntor:4', 'disjuntor:5', 'livre', 'livre', 'livre']);
  assert.equal(resumoEsquema(l), 'Geral 32 A · 2 diferenciais · 6 disjuntores · 3 livres');
  // Geral que não se vê, estado "não se vê", quantidades absurdas e leitura que não é de um quadro.
  const pouco = esquemaDaLeitura({ ...leitura, disjuntor_geral: { visivel: false, amperes: null, tipo: null }, estado_aparente: 'nao_se_ve', disjuntores_total: null, disjuntores: [{ amperes: 16, quantidade: 5000 }] });
  assert.deepEqual([pouco.disjuntor_geral, pouco.estado, pouco.disjuntores.length], [null, null, MAX_ESQUEMA.disjuntores]);
  assert.equal(esquemaDaLeitura({ ...leitura, e_quadro_eletrico: false }), null);
  assert.equal(esquemaDaLeitura(null), null);
});
