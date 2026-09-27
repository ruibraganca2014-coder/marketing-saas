// Endpoint público POST /api/orcamento (validação, armadilha, limites,
// simulação) e catálogo público GET /api/catalogo (nunca mostra custos nem
// fornecedores) + gestão do catálogo pelo CEO.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { SEMENTES_CATALOGO } from '../src/catalogo-sementes.js';

let p;
before(async () => { p = await painelComEquipa(); });
after(() => p.fechar());

const BASE = { nome: 'Ana Silva', telefone: '912 345 678', servico: 'Casa inteligente', localidade: 'Oeiras', mensagem: 'Olá\nQueria um orçamento.' };
const enviar = (corpo, opcoes = {}) => p.pedir('POST', '/api/orcamento', { corpo, ...opcoes });
const contar = () => p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n;

test('pedido válido → 201 {ok:true}, estado "novo", visível ao comercial', async () => {
  const r = await enviar({ ...BASE, email: 'ana@exemplo.pt', website: '' });
  assert.equal(r.estado, 201);
  assert.deepEqual(r.json, { ok: true });
  const lista = (await p.pedir('GET', '/painel/api/orcamentos', { cookie: p.cookies.comercial })).json.orcamentos;
  const o = lista.find((x) => x.nome === 'Ana Silva');
  assert.equal(o.estado, 'novo');
  assert.equal(o.origem, 'site');
  assert.equal(o.telefone, '912 345 678');
  assert.equal(o.email, 'ana@exemplo.pt');
  assert.equal(o.mensagem, 'Olá\nQueria um orçamento.');
  assert.equal(o.tem_simulacao, false);
  const resumo = (await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.comercial })).json;
  assert.ok(resumo.pedidos_novos >= 1, 'alerta de pedido novo no resumo');
  // Só telefone, só email: ambos aceites.
  assert.equal((await enviar({ nome: 'B', email: 'b@exemplo.pt', servico: 'Outro' })).estado, 201);
});

test('armadilha "website" preenchida → 201 mas descartado', async () => {
  const antes = contar();
  const r = await enviar({ ...BASE, website: 'http://spam.exemplo' });
  assert.equal(r.estado, 201);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(contar(), antes);
});

test('validação: nome, contacto, limites, campos desconhecidos, JSON', async () => {
  const antes = contar();
  const casos = [
    [{ ...BASE, nome: '' }, 400, /nome/],
    [{ ...BASE, nome: 'x'.repeat(121) }, 400, /máx. 120/],
    [{ nome: 'A', servico: 'Outro' }, 400, /telefone ou um email/],
    [{ ...BASE, telefone: 'liga-me' }, 400, /Telefone/],
    [{ ...BASE, email: 'nao-e-email' }, 400, /Email/],
    [{ ...BASE, servico: '' }, 400, /serviço/],
    [{ ...BASE, servico: 'x'.repeat(81) }, 400, /máx. 80/],
    [{ ...BASE, localidade: 'x'.repeat(81) }, 400, /máx. 80/],
    [{ ...BASE, mensagem: 'x'.repeat(2001) }, 400, /máx. 2000/],
    [{ ...BASE, nome: 'Ana\u0000' }, 400, /inválidos/],
    [{ ...BASE, admin: true }, 400, /desconhecido/],
    [{ ...BASE, nome: 12 }, 400, /texto/],
    [{ ...BASE, codigo_cliente: 'Joao!' }, 400, /Código/],
  ];
  for (const [corpo, estado, re] of casos) {
    const r = await enviar(corpo);
    assert.equal(r.estado, estado, JSON.stringify(corpo).slice(0, 80));
    assert.match(r.json.erro, re);
  }
  assert.equal((await enviar('{"nome":', {})).estado, 400);
  assert.equal((await enviar('[]')).estado, 400);
  assert.equal((await enviar(JSON.stringify(BASE), { tipo: 'text/plain' })).estado, 415);
  assert.equal((await enviar(BASE, { site: false, cabecalhos: { Origin: 'https://outro.exemplo' } })).estado, 403);
  assert.equal(contar(), antes, 'nada guardado');
});

test('limite: 5 pedidos por hora por IP (429 + Retry-After), outros IPs não afetados', async () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < 5; i++) assert.equal((await enviar({ ...BASE, nome: `Limite ${i}` }, { ip })).estado, 201);
  const r = await enviar({ ...BASE, nome: 'Limite 6' }, { ip });
  assert.equal(r.estado, 429);
  assert.ok(Number(r.cabecalhos['retry-after']) > 3000);
  assert.equal((await enviar({ ...BASE, website: 'x' }, { ip })).estado, 429, 'a armadilha também conta');
  assert.equal((await enviar({ ...BASE, nome: 'Outro IP' }, { ip: '198.51.100.8' })).estado, 201);
  p.relogio.avancar(3600_000 + 1000);
  assert.equal((await enviar({ ...BASE, nome: 'Uma hora depois' }, { ip })).estado, 201);
});

test('simulação: guardada tal como chegou e devolvida em GET orcamentos/:id', async () => {
  const png = `data:image/png;base64,${Buffer.from('imagem-png-de-teste').toString('base64')}`;
  const simulacao = {
    versao: 1, casa: { tipo: 'moradia', divisoes: 7, localidade: 'Oeiras' },
    planta: { escala_cm: 50, fundo: png, divisoes: [{ nome: 'Sala', x: 0, y: 0, l: 8, a: 10 }], elementos: [{ tipo: 'luz', brilho: true }] },
    quadro: { circuitos: [{ n: 1, amperes: 16, tipo: 'tomadas', inteligente: true }] },
    itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 4, preco_iva: 54.9 }, { sku: 'SENS-PORTA-WIFI', qtd: 2, preco_iva: 19.9 }],
    mao_obra: { horas: 7.5, valor_iva: 262.5 }, total: { min: 690, max: 930 }, plano_sugerido: 'conforto',
    avisos: ['Este circuito pode não aguentar (orientativo — confirmamos na visita)'], acentos: 'ção ü 😀',
  };
  const r = await enviar({ ...BASE, nome: 'Com simulação', simulacao, codigo_cliente: 'joao' });
  assert.equal(r.estado, 201);
  const o = (await p.pedir('GET', '/painel/api/orcamentos', { cookie: p.cookies.ceo })).json.orcamentos.find((x) => x.nome === 'Com simulação');
  assert.equal(o.tem_simulacao, true);
  assert.equal(o.codigo_cliente, 'joao');
  assert.equal(o.simulacao, undefined, 'a lista não traz a simulação (pesada)');
  const d = (await p.pedir('GET', `/painel/api/orcamentos/${o.id}`, { cookie: p.cookies.comercial })).json;
  assert.deepEqual(d.simulacao, simulacao);
});

test('simulação: tipo e tamanho (≤ 1 MB), imagens só JPEG/PNG', async () => {
  const antes = contar();
  const grande = { fundo: `data:image/jpeg;base64,${'A'.repeat(1024 * 1024)}` };
  let r = await enviar({ ...BASE, simulacao: grande });
  assert.equal(r.estado, 413);
  assert.match(r.json.erro, /1 MB/);
  r = await enviar({ ...BASE, simulacao: { x: 'y'.repeat(1_300_000) } });
  assert.equal(r.estado, 413, 'corpo acima de 1,25 MB');
  for (const sim of [[1, 2], 'texto', 5, true]) {
    r = await enviar({ ...BASE, simulacao: sim });
    assert.equal(r.estado, 400, JSON.stringify(sim));
    assert.match(r.json.erro, /objeto/);
  }
  for (const url of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:text/html;base64,PGI+', 'DATA:image/gif;base64,R0lG',
    'data:image/png;base64,not base64!', ' data:image/png,abc']) {
    r = await enviar({ ...BASE, simulacao: { planta: { fundo: url } } });
    assert.equal(r.estado, 400, url);
    assert.match(r.json.erro, /JPEG ou PNG/);
  }
  let fundo = { a: 1 };
  for (let i = 0; i < 40; i++) fundo = { f: fundo };
  assert.equal((await enviar({ ...BASE, simulacao: fundo })).estado, 400, 'profundidade');
  assert.equal(contar(), antes);
  // Perto do limite mas dentro: aceite.
  const ok = { fundo: `data:image/jpeg;base64,${'A'.repeat(900 * 1024)}` };
  assert.equal((await enviar({ ...BASE, simulacao: ok })).estado, 201);
});

test('catálogo público: só ativos e visíveis, sem preço de compra, fornecedor nem link; cache 300 s', async () => {
  const cab = { cookie: p.cookies.ceo };
  const lista = (await p.pedir('GET', '/painel/api/catalogo', cab)).json.itens;
  assert.equal(lista.length, SEMENTES_CATALOGO.length, 'sementes do SIMULADOR-ORCAMENTO §3');
  const sy1 = lista.find((a) => a.sku === 'TONGOU-SY1-JWT');
  assert.equal(sy1.preco_compra, 12.28);
  assert.equal(sy1.preco_venda_iva, 39.9);
  assert.equal(sy1.fornecedor, 'Tongou/Changyou (Temu: Chayo)');
  // CEO: link, artigo escondido e artigo inativo.
  const pir = lista.find((a) => a.sku === 'SENS-PIR-WIFI');
  let r = await p.pedir('POST', `/painel/api/catalogo/${sy1.id}`, { ...cab, corpo: { link: 'https://www.alibaba.com/produto-secreto', fornecedor: 'Fornecedor Secreto Lda' } });
  assert.equal(r.estado, 200);
  assert.equal((await p.pedir('POST', `/painel/api/catalogo/${pir.id}`, { ...cab, corpo: { visivel_cliente: false } })).estado, 200);
  r = await p.pedir('POST', '/painel/api/catalogo', { ...cab, corpo: { sku: 'TESTE-INATIVO', nome: 'Inativo', categoria: 'outro', preco_venda_iva: 1, preco_compra: 0.5, ativo: false } });
  assert.equal(r.estado, 201);
  assert.equal((await p.pedir('POST', '/painel/api/catalogo', { ...cab, corpo: { sku: 'TESTE-INATIVO', nome: 'X', categoria: 'outro', preco_venda_iva: 1 } })).estado, 409);
  r = await p.pedir('POST', '/painel/api/catalogo', { ...cab, corpo: { sku: 'NOVO-1', nome: 'Novo', categoria: 'luz', preco_venda_iva: 9.9, preco_compra: 3.21, horas_instalacao: 0.2, especificacoes: { rede: 'zigbee' } } });
  assert.equal(r.estado, 201);

  const pub = await p.pedir('GET', '/api/catalogo', { site: false });
  assert.equal(pub.estado, 200);
  assert.equal(pub.cabecalhos['cache-control'], 'public, max-age=300');
  const skus = pub.json.itens.map((a) => a.sku);
  assert.ok(skus.includes('TONGOU-SY1-JWT') && skus.includes('NOVO-1'));
  assert.ok(!skus.includes('SENS-PIR-WIFI'), 'não visível ao cliente');
  assert.ok(!skus.includes('TESTE-INATIVO'), 'inativo');
  for (const a of pub.json.itens) assert.deepEqual(Object.keys(a).sort(), ['categoria', 'especificacoes', 'horas_instalacao', 'nome', 'preco_venda_iva', 'sku']);
  for (const segredo of ['preco_compra', 'fornecedor', 'link', 'alibaba', 'Secreto', '12.28', '3.21', 'Tongou/Changyou', 'Zhouqiao', 'armazenista']) {
    assert.ok(!pub.texto.includes(segredo), `o público não vê "${segredo}"`);
  }
  assert.deepEqual(pub.json.config, { tarifa_hora_iva: 35, margem_intervalo_pct: 15, deslocacao_iva: 0 });
  assert.deepEqual(pub.json.itens.find((a) => a.sku === 'NOVO-1'), { sku: 'NOVO-1', nome: 'Novo', categoria: 'luz', preco_venda_iva: 9.9, horas_instalacao: 0.2, especificacoes: { rede: 'zigbee' } });
});

test('catálogo e configuração: validação e só o CEO', async () => {
  const cab = { cookie: p.cookies.ceo };
  for (const corpo of [
    { sku: 'minusculas', nome: 'X', categoria: 'luz', preco_venda_iva: 1 },
    { sku: 'OK-1', nome: 'X', categoria: 'foguete', preco_venda_iva: 1 },
    { sku: 'OK-2', nome: 'X', categoria: 'luz', preco_venda_iva: -1 },
    { sku: 'OK-3', nome: 'X', categoria: 'luz', preco_venda_iva: 1, link: 'javascript:alert(1)' },
    { sku: 'OK-3', nome: 'X', categoria: 'luz', preco_venda_iva: 1, link: 'http://alibaba.com/x' },
    { sku: 'OK-3', nome: 'X', categoria: 'luz', preco_venda_iva: 1, link: 'https://a.pt/"><script>' },
    { sku: 'OK-4', nome: 'X', categoria: 'luz', preco_venda_iva: 1, especificacoes: [1] },
    { sku: 'OK-5', nome: 'X', categoria: 'luz' },
  ]) {
    assert.equal((await p.pedir('POST', '/painel/api/catalogo', { ...cab, corpo })).estado, 400, JSON.stringify(corpo));
  }
  let r = await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo: { tarifa_hora_iva: 40, margem_intervalo_pct: 20 } });
  assert.equal(r.estado, 200);
  assert.deepEqual(r.json, { tarifa_hora_iva: 40, margem_intervalo_pct: 20, deslocacao_iva: 0 });
  assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo: { margem_intervalo_pct: 101 } })).estado, 400);
  assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo: { outra: 1 } })).estado, 400);
  assert.deepEqual((await p.pedir('GET', '/api/catalogo')).json.config, { tarifa_hora_iva: 40, margem_intervalo_pct: 20, deslocacao_iva: 0 });
  for (const papel of ['tecnico', 'comercial']) {
    assert.equal((await p.pedir('GET', '/painel/api/catalogo', { cookie: p.cookies[papel] })).estado, 403);
    assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { cookie: p.cookies[papel], corpo: { tarifa_hora_iva: 1 } })).estado, 403);
  }
  assert.ok(p.app.db.prepare('SELECT 1 FROM auditoria WHERE acao = \'config_orcamento_atualizada\'').get());
});
