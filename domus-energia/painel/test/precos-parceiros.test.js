// Tabela de preços da especialidade (decisão do dono, 2026-10-14; migração 55): cada artigo do catálogo tem uma
// especialidade; os eletricistas PARCEIROS veem, na área deles, os artigos das suas especialidades só com as horas de
// mão de obra de hoje e o que receberiam (nunca o preço ao cliente nem o custo de compra) e propõem horas e material;
// nada muda no catálogo até o CEO aprovar no Catálogo (com uma linha no ecrã Hoje).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar } from '../src/db.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];

describe('migração 55: a especialidade de cada artigo', () => {
  test('os artigos que já existiam ficam com a especialidade certa (domótica os de casa inteligente; geral o resto)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (let i = 0; i < 54; i++) MIGRACOES[i](db);
    db.exec('PRAGMA user_version = 54');
    migrar(db);
    const esp = (sku) => db.prepare('SELECT especialidade FROM catalogo WHERE sku = ?').get(sku)?.especialidade;
    for (const sku of ['INT-VIDRO-1', 'BAB-MOD-2CH', 'BAB-CURTAIN', 'SENS-PIR-WIFI', 'BAB-HC-T010', 'RPI-CENTRAL', 'TOMADA-WIFI', 'DIMMER-WIFI', 'TONGOU-SY2-JWT', 'FECHADURA-SEG']) {
      assert.equal(esp(sku), 'domotica', sku);
    }
    for (const sku of ['CAIXA-QUADRO-24', 'MCB-1PN-C', 'IDR-2P-40A-30MA', 'GERAL-2P-63A', 'TOMADA-NOVA', 'PONTO-LUZ-NOVO', 'INTERRUPTOR-NOVO', 'LINHA-DEDICADA', 'DIAG-AVARIA']) {
      assert.equal(esp(sku), 'geral', sku);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalogo WHERE especialidade IN ('solar', 'redes')").get().n, 0);
    assert.throws(() => db.prepare("UPDATE catalogo SET especialidade = 'outra' WHERE sku = 'MCB-1PN-C'").run());
    db.close();
  });
});

describe('tabela de preços da especialidade', () => {
  let p, D, G, F;   // D: parceiro de domótica; G: parceiro de geral; F: eletricista de fora
  let seq = 0;
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  async function eletricista(especialidades = null) {
    const n = ++seq;
    const e = { nome: `Eletricista Preços ${n}`, email: `eletricista.precos.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${7000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    e.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    if (especialidades) assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { especialidades })).estado, 200);
    await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } });
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  const artigo = (sku) => p.app.db.prepare('SELECT * FROM catalogo WHERE sku = ?').get(sku);

  before(async () => {
    p = await painelComEquipa();
    D = await eletricista(['domotica']);
    G = await eletricista(['geral']);
    F = await eletricista();
  });
  after(() => p.fechar());

  test('o parceiro vê só os artigos da sua especialidade, só com as horas e o que recebe (70 % da mão de obra)', async () => {
    const r = await area(D, 'GET', 'precos');
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json.especialidades, [{ chave: 'domotica', nome: 'Domótica e automação' }]);
    assert.equal(r.json.percentagem, 70);
    const skus = r.json.artigos.map((a) => a.sku);
    assert.ok(skus.includes('INT-VIDRO-1') && skus.includes('SENS-PIR-WIFI'));
    assert.ok(!skus.includes('MCB-1PN-C') && !skus.includes('TOMADA-NOVA'), 'nada de geral');
    assert.ok(!skus.includes('SENS-PORTA-ZB'), 'só os artigos ativos');
    assert.ok(r.json.artigos.every((a) => a.especialidade === 'domotica'));
    // O termóstato (1 h): 38 € c/ IVA = 30,89 € sem IVA; 70 % = 21,62 €.
    const t = r.json.artigos.find((a) => a.sku === 'BAB-HC-T010');
    assert.equal(t.horas, 1);
    assert.equal(t.recebe, 21.62);
    // Decisão do dono (2026-10-14): nem o preço ao cliente, nem o custo de compra, o fornecedor, a margem ou o material do catálogo.
    for (const a of r.json.artigos) assert.deepEqual(Object.keys(a).sort(), ['especialidade', 'horas', 'id', 'nome', 'recebe', 'sku']);
    assert.doesNotMatch(r.texto, /preco|venda|compra|custo|fornecedor|margem|"material"|link|especificacoes/i);
    // A sessão diz de que especialidades é parceiro (a página só mostra a secção a quem é).
    assert.deepEqual((await area(D, 'GET', 'eu')).json.eletricista.parceiro_de, [{ chave: 'domotica', nome: 'Domótica e automação' }]);
    assert.ok((await area(G, 'GET', 'precos')).json.artigos.some((a) => a.sku === 'MCB-1PN-C'));
  });

  test('o eletricista de fora não tem a tabela (403) nem pode propor; sem sessão: 401', async () => {
    assert.equal((await area(F, 'GET', 'precos')).estado, 403);
    assert.equal((await area(F, 'POST', 'precos', { artigo_id: artigo('MCB-1PN-C').id, horas: 1 })).estado, 403);
    assert.deepEqual((await area(F, 'GET', 'eu')).json.eletricista.parceiro_de, []);
    assert.equal((await p.pedir('GET', '/api/eletricista/precos')).estado, 401);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM propostas_precos').get().n, 0);
  });

  test('validação: só artigos da sua especialidade, horas > 0 e até 100, textos e custo', async () => {
    const int = artigo('INT-VIDRO-1').id;
    assert.equal((await area(D, 'POST', 'precos', { artigo_id: artigo('MCB-1PN-C').id, horas: 1 })).estado, 403, 'artigo de geral');
    assert.equal((await area(D, 'POST', 'precos', { nome: 'Quadro novo', especialidade: 'geral', horas: 1 })).estado, 403, 'artigo novo de outra especialidade');
    for (const corpo of [{ artigo_id: int }, { artigo_id: int, horas: 0 }, { artigo_id: int, horas: -1 }, { artigo_id: int, horas: 101 }, { artigo_id: int, horas: 'x' },
      { artigo_id: int, horas: 1, custo: -2 }, { artigo_id: int, horas: 1, material: 'x'.repeat(301) }, { artigo_id: int, horas: 1, nota: 'x'.repeat(601) },
      { artigo_id: int, horas: 1, nome: 'Outro nome' }, { nome: 'ab', horas: 1 }, { horas: 1 }, { artigo_id: int, horas: 1, preco_venda_iva: 10 }]) {
      assert.equal((await area(D, 'POST', 'precos', corpo)).estado, 400, JSON.stringify(corpo));
    }
    assert.equal((await area(D, 'POST', 'precos', { artigo_id: 999999, horas: 1 })).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM propostas_precos').get().n, 0);
  });

  let pInt, pNovo;
  test('o parceiro propõe (e corrige) para um artigo e um artigo novo; nada muda no catálogo', async () => {
    const antes = artigo('INT-VIDRO-1');
    const r = await area(D, 'POST', 'precos', { artigo_id: antes.id, horas: 0.75, material: 'Caixa de aparelhagem funda', custo: 3.5, nota: 'Vidro parte-se fácil' });
    assert.equal(r.estado, 201, r.texto);
    pInt = r.json.proposta.id;
    assert.equal(r.json.proposta.estado, 'pendente');
    assert.equal(r.json.proposta.recebe, 16.22);   // 0,75 h × 38 € = 28,50 € c/ IVA → 23,17 € sem IVA × 70 %
    const c = await area(D, 'POST', 'precos', { artigo_id: antes.id, horas: 0.7, material: 'Caixa funda' });
    assert.equal(c.estado, 200, c.texto);
    assert.equal(c.json.proposta.id, pInt, 'a proposta à espera é corrigida, não duplicada');
    const n = await area(D, 'POST', 'precos', { nome: 'Sensor de inundação Zigbee', horas: 0.3, material: 'Sensor e pilha' });
    assert.equal(n.estado, 201, n.texto);
    pNovo = n.json.proposta.id;
    assert.equal(n.json.proposta.novo, true);
    assert.equal(n.json.proposta.especialidade, 'domotica');
    assert.deepEqual(artigo('INT-VIDRO-1'), antes, 'o catálogo fica como estava');
    const lista = (await area(D, 'GET', 'precos')).json.propostas;
    assert.deepEqual(lista.map((x) => x.id).sort(), [pInt, pNovo].sort());
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'proposta_precos'").get());
  });

  test('Hoje: uma linha por proposta, só para o CEO, a mais antiga primeiro', async () => {
    const r = await painel('GET', 'hoje');
    const linhas = r.json.itens.filter((x) => x.tipo === 'proposta_precos');
    assert.deepEqual(linhas.map((x) => x.texto).sort(), [
      `Rever a proposta de preços de ${D.nome} (Interruptor de parede tátil Wi-Fi 1 botão)`,
      `Rever a proposta de preços de ${D.nome} (artigo novo: Sensor de inundação Zigbee)`,
    ].sort());
    const tempos = linhas.map((x) => Date.parse(x.desde));
    assert.deepEqual(tempos, [...tempos].sort((a, b) => a - b), 'a mais antiga primeiro');
    assert.ok(linhas.every((x) => x.ligacao === '#/catalogo'));
    for (const papel of ['comercial', 'tecnico']) {
      assert.deepEqual((await painel('GET', 'hoje', papel)).json.itens.filter((x) => x.tipo === 'proposta_precos'), []);
    }
  });

  test('só o CEO vê e decide as propostas', async () => {
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await painel('GET', 'propostas-precos', papel)).estado, 403);
      assert.equal((await painel('POST', `propostas-precos/${pInt}/aprovar`, papel, {})).estado, 403);
      assert.equal((await painel('POST', `propostas-precos/${pInt}/recusar`, papel, {})).estado, 403);
    }
    const r = await painel('GET', 'propostas-precos');
    assert.equal(r.estado, 200, r.texto);
    const x = r.json.pendentes.find((y) => y.id === pInt);
    assert.equal(x.eletricista.nome, D.nome);
    assert.equal(x.antes.horas, 0.5);
    assert.equal(x.proposta.horas, 0.7);
    assert.equal(x.proposta.material, 'Caixa funda');
  });

  test('o CEO aprova: as horas, o material e o custo passam para o artigo; fica quem e quando; o parceiro recebe um email', async () => {
    const desde = p.emails.length;
    const r = await painel('POST', `propostas-precos/${pInt}/aprovar`, 'ceo', {});
    assert.equal(r.estado, 200, r.texto);
    const a = artigo('INT-VIDRO-1');
    assert.equal(a.horas_instalacao, 0.7);
    assert.equal(JSON.parse(a.especificacoes).material, 'Caixa funda');
    assert.equal(a.preco_compra_cent, null, 'sem custo proposto, o custo fica como estava');
    const linha = p.app.db.prepare('SELECT * FROM propostas_precos WHERE id = ?').get(pInt);
    assert.equal(linha.estado, 'aprovada');
    assert.equal(linha.decidido_por, p.u.ceo.email);
    assert.ok(linha.decidido);
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'proposta_precos_aprovada'").get());
    assert.ok(p.emails.slice(desde).some((m) => m.para === D.email && /aprovada/.test(m.assunto)));
    assert.equal((await painel('POST', `propostas-precos/${pInt}/aprovar`, 'ceo', {})).estado, 409, 'já decidida');
    assert.equal((await area(D, 'GET', 'precos')).json.artigos.find((x) => x.sku === 'INT-VIDRO-1').horas, 0.7);
  });

  test('o CEO aprova um artigo novo (com SKU, categoria e preço de venda; pode mudar as horas): fica escondido do cliente', async () => {
    assert.equal((await painel('POST', `propostas-precos/${pNovo}/aprovar`, 'ceo', { categoria: 'sensor', preco_venda_iva: 40 })).estado, 400, 'sem SKU');
    const r = await painel('POST', `propostas-precos/${pNovo}/aprovar`, 'ceo', { sku: 'SENS-INUND-ZB', categoria: 'sensor', preco_venda_iva: 40, horas: 0.25 });
    assert.equal(r.estado, 200, r.texto);
    const a = artigo('SENS-INUND-ZB');
    assert.equal(a.nome, 'Sensor de inundação Zigbee');
    assert.equal(a.horas_instalacao, 0.25);
    assert.equal(a.especialidade, 'domotica');
    assert.equal(a.visivel_cliente, 0);
    assert.equal(a.preco_venda_iva_cent, 4000);
    assert.equal(r.json.artigo.sku, 'SENS-INUND-ZB');
    assert.equal(p.app.db.prepare('SELECT artigo_id FROM propostas_precos WHERE id = ?').get(pNovo).artigo_id, a.id);
    assert.equal((await painel('GET', 'hoje')).json.itens.filter((x) => x.tipo === 'proposta_precos').length, 0);
  });

  test('o CEO recusa com um motivo: o catálogo não muda e o parceiro vê o motivo', async () => {
    const t = artigo('BAB-HC-T010');
    const r = await area(D, 'POST', 'precos', { artigo_id: t.id, horas: 3, custo: 20 });
    assert.equal(r.estado, 201, r.texto);
    const d = await painel('POST', `propostas-precos/${r.json.proposta.id}/recusar`, 'ceo', { motivo: 'Uma hora chega para este modelo.' });
    assert.equal(d.estado, 200, d.texto);
    assert.deepEqual(artigo('BAB-HC-T010'), t);
    const minha = (await area(D, 'GET', 'precos')).json.propostas.find((x) => x.id === r.json.proposta.id);
    assert.equal(minha.estado, 'recusada');
    assert.equal(minha.motivo, 'Uma hora chega para este modelo.');
  });

  test('o CEO muda a especialidade de um artigo no Catálogo', async () => {
    const a = artigo('LINHA-DEDICADA-VE');
    const r = await painel('POST', `catalogo/${a.id}`, 'ceo', { especialidade: 'solar' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.especialidade, 'solar');
    assert.equal((await painel('POST', `catalogo/${a.id}`, 'ceo', { especialidade: 'outra' })).estado, 400);
    assert.ok((await painel('GET', 'catalogo')).json.itens.every((x) => ['geral', 'domotica', 'solar', 'redes'].includes(x.especialidade)));
  });
});
