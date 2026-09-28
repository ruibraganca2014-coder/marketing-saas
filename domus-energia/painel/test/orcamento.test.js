// Endpoint público POST /api/orcamento (validação, armadilha, limites,
// simulação) e catálogo público GET /api/catalogo (nunca mostra custos nem
// fornecedores) + gestão do catálogo pelo CEO.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO } from '../src/catalogo-sementes.js';

let p;
before(async () => { p = await painelComEquipa(); });
after(() => p.fechar());

const BASE = { nome: 'Ana Silva', telefone: '912 345 678', servico: 'Casa inteligente', localidade: 'Oeiras', mensagem: 'Olá\nQueria um orçamento.' };
const enviar = (corpo, opcoes = {}) => p.pedir('POST', '/api/orcamento', { corpo, ...opcoes });
const contar = () => p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n;

test('pedido válido → 201 {ok:true, fotos_token, fotos_max}, estado "novo", visível ao comercial', async () => {
  const r = await enviar({ ...BASE, email: 'ana@exemplo.pt', website: '' });
  assert.equal(r.estado, 201);
  assert.deepEqual(Object.keys(r.json).sort(), ['fotos_max', 'fotos_token', 'ok']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.fotos_max, 40);
  assert.match(r.json.fotos_token, /^[A-Za-z0-9_-]{43}$/);
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
  assert.deepEqual(Object.keys(r.json).sort(), ['fotos_max', 'fotos_token', 'ok'], 'a mesma resposta de um pedido verdadeiro');
  assert.match(r.json.fotos_token, /^[A-Za-z0-9_-]{43}$/);
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

test('simulação: dados da casa (§6) — potência contratada, ligação; tudo opcional na área de cliente', async () => {
  const antes = contar();
  const sim = (casa) => ({ versao: 1, casa });
  for (const kva of [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7]) {
    for (const fases of ['mono', 'tri', null]) {
      const r = await enviar({ ...BASE, nome: `Casa ${kva} ${fases}`, simulacao: sim({ tipo: 'moradia', divisoes: 5, localidade: 'Oeiras', potencia_contratada_kva: kva, fases }) });
      assert.equal(r.estado, 201, `${kva} kVA ${fases}`);
    }
  }
  // "Não sei" (null) e área de cliente sem o passo "A casa": tipo/divisões em falta.
  for (const casa of [{ tipo: null, divisoes: null, localidade: null, potencia_contratada_kva: null, fases: null }, {}, { localidade: 'Porto' }, undefined]) {
    const r = await enviar({ ...BASE, nome: 'Cliente amplia', codigo_cliente: 'joao', simulacao: sim(casa) });
    assert.equal(r.estado, 201, JSON.stringify(casa));
  }
  const d = (await p.pedir('GET', `/painel/api/orcamentos/${p.app.db.prepare("SELECT id FROM orcamentos WHERE nome = 'Casa 10.35 tri'").get().id}`, { cookie: p.cookies.comercial })).json;
  assert.equal(d.simulacao.casa.potencia_contratada_kva, 10.35);
  assert.equal(d.simulacao.casa.fases, 'tri');
  const depois = contar();
  assert.equal(depois, antes + 28);
  for (const [casa, re] of [
    [{ potencia_contratada_kva: 7 }, /potência contratada/], [{ potencia_contratada_kva: '6.9' }, /potência contratada/], [{ potencia_contratada_kva: -1 }, /potência contratada/],
    [{ fases: 'bifasica' }, /ligação/], [{ fases: 3 }, /ligação/], [{ tipo: 'castelo' }, /tipo/], [{ divisoes: 0 }, /divisões/], [{ divisoes: 2.5 }, /divisões/],
    [{ localidade: 'L'.repeat(81) }, /localidade/], ['moradia', /objeto/], [[1], /objeto/],
  ]) {
    const r = await enviar({ ...BASE, simulacao: sim(casa) });
    assert.equal(r.estado, 400, JSON.stringify(casa));
    assert.match(r.json.erro, re);
  }
  assert.equal(contar(), depois);
});

test('simulação: limites da planta (§2.1) — 40 divisões, 400 elementos, 10 000 cm, fundo ≤ 700 KB', async () => {
  const antes = contar();
  const planta = (x) => ({ versao: 1, planta: { escala_cm: 50, largura_cm: 2000, altura_cm: 1500, fundo: null, divisoes: [], elementos: [], ...x } });
  const div = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, nome: 'D', x_cm: 0, y_cm: 0, largura_cm: 100, altura_cm: 100 }));
  const els = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, tipo: 'luz', x_cm: 10, y_cm: 10, rot: 0, divisao: null, props: {} }));
  const img = (n) => `data:image/jpeg;base64,${'A'.repeat(n - 23)}`;
  for (const [nome, sim, re] of [
    ['41 divisões', planta({ divisoes: div(41) }), /40 divisões/],
    ['401 elementos', planta({ elementos: els(401) }), /400 elementos/],
    ['largura', planta({ largura_cm: 10_001 }), /largura_cm/],
    ['altura texto', planta({ altura_cm: '900' }), /altura_cm/],
    ['escala 1 cm', planta({ escala_cm: 1 }), /escala_cm/],
    ['divisões não lista', planta({ divisoes: { a: 1 } }), /lista/],
    ['planta lista', { planta: [1] }, /objeto/],
    ['fundo grande', planta({ fundo: { imagem: img(700 * 1024 + 4), x_cm: 0, y_cm: 0, largura_cm: 2000, opacidade: 0.5 } }), /700 KB/],
    ['fundo texto grande', planta({ fundo: img(700 * 1024 + 4) }), /700 KB/],
  ]) {
    const r = await enviar({ ...BASE, simulacao: sim });
    assert.equal(r.estado, 400, nome);
    assert.match(r.json.erro, re, nome);
  }
  assert.equal(contar(), antes);
  const limite = planta({ largura_cm: 10_000, altura_cm: 10_000, divisoes: div(40), elementos: els(400), fundo: { imagem: img(700 * 1024), x_cm: 0, y_cm: 0, largura_cm: 2000, opacidade: 0.5 } });
  assert.equal((await enviar({ ...BASE, simulacao: limite })).estado, 201, 'no limite');
});

test('catálogo público: só ativos e visíveis, sem preço de compra, fornecedor nem link; cache 300 s', async () => {
  const cab = { cookie: p.cookies.ceo };
  const lista = (await p.pedir('GET', '/painel/api/catalogo', cab)).json.itens;
  assert.equal(lista.length, SEMENTES_CATALOGO.length + SEMENTES_QUADRO.length, 'sementes do SIMULADOR-ORCAMENTO §3 (com as do quadro)');
  const sy1 = lista.find((a) => a.sku === 'TONGOU-SY1-JWT');
  assert.equal(sy1.preco_compra, 11.04);
  assert.equal(sy1.preco_venda_iva, 39.9);
  assert.equal(sy1.fornecedor, 'Tongou/Changyou (Temu: loja Chayo)');
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
  assert.equal(pub.cabecalhos['cache-control'], 'public, max-age=60');
  const skus = pub.json.itens.map((a) => a.sku);
  assert.ok(skus.includes('TONGOU-SY1-JWT') && skus.includes('NOVO-1'));
  assert.ok(!skus.includes('SENS-PIR-WIFI'), 'não visível ao cliente');
  assert.ok(!skus.includes('TESTE-INATIVO'), 'inativo');
  for (const a of pub.json.itens) assert.deepEqual(Object.keys(a).sort(), ['categoria', 'especificacoes', 'horas_instalacao', 'nome', 'preco_venda_iva', 'sku']);
  for (const segredo of ['preco_compra', 'fornecedor', 'link', 'alibaba', 'Secreto', '11.04', '14.3', '6.82', '3.21', 'Tongou/Changyou', 'Zhouqiao', 'armazenista']) {
    assert.ok(!pub.texto.includes(segredo), `o público não vê "${segredo}"`);
  }
  assert.deepEqual(pub.json.config, { tarifa_hora_iva: 35, margem_intervalo_pct: 15, deslocacao_iva: 0, deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100 });
  assert.deepEqual(pub.json.itens.find((a) => a.sku === 'NOVO-1'), { sku: 'NOVO-1', nome: 'Novo', categoria: 'luz', preco_venda_iva: 9.9, horas_instalacao: 0.2, especificacoes: { rede: 'zigbee' } });
});

test('nota "preço provisório — confirmar": só o CEO a vê; sai quando o CEO muda o preço de venda', async () => {
  const cab = { cookie: p.cookies.ceo };
  const lista = (await p.pedir('GET', '/painel/api/catalogo', cab)).json.itens;
  const dif = lista.find((a) => a.especificacoes?.nota === 'preço provisório — confirmar');
  const caixa = lista.find((a) => /^preço provisório — confirmar; /.test(a.especificacoes?.nota ?? ''));
  assert.ok(dif && caixa, 'há artigos com a nota nas sementes');
  const pub = await p.pedir('GET', '/api/catalogo');
  assert.ok(!pub.texto.includes('provisório'), 'o público não vê a nota');
  assert.ok(pub.json.itens.every((a) => !('nota' in a.especificacoes)));
  // Outros campos não tiram a nota; o mesmo preço também não.
  let r = await p.pedir('POST', `/painel/api/catalogo/${dif.id}`, { ...cab, corpo: { horas_instalacao: dif.horas_instalacao, preco_venda_iva: dif.preco_venda_iva } });
  assert.equal(r.json.especificacoes.nota, 'preço provisório — confirmar');
  r = await p.pedir('POST', `/painel/api/catalogo/${dif.id}`, { ...cab, corpo: { preco_venda_iva: dif.preco_venda_iva + 1 } });
  assert.equal(r.estado, 200, r.texto);
  assert.ok(!('nota' in r.json.especificacoes), 'preço confirmado: a nota sai');
  assert.equal(r.json.especificacoes.funcao, dif.especificacoes.funcao, 'o resto das especificações fica');
  r = await p.pedir('POST', `/painel/api/catalogo/${caixa.id}`, { ...cab, corpo: { preco_venda_iva: caixa.preco_venda_iva + 1, especificacoes: caixa.especificacoes } });
  assert.equal(r.json.especificacoes.nota, caixa.especificacoes.nota.replace('preço provisório — confirmar; ', ''), 'o resto da nota fica');
  // Repõe.
  for (const a of [dif, caixa]) {
    assert.equal((await p.pedir('POST', `/painel/api/catalogo/${a.id}`, { ...cab, corpo: { preco_venda_iva: a.preco_venda_iva } })).estado, 200);
    r = await p.pedir('POST', `/painel/api/catalogo/${a.id}`, { ...cab, corpo: { especificacoes: a.especificacoes } });
    assert.equal(r.json.especificacoes.nota, a.especificacoes.nota, 'a nota pode voltar a pôr-se à mão');
  }
  // A nota a meio do texto: sai com o ";" e os espaços a seguir (e nada mais).
  r = await p.pedir('POST', `/painel/api/catalogo/${dif.id}`, { ...cab, corpo: { especificacoes: { ...dif.especificacoes, nota: 'Modelo X; preço provisório — confirmar;stock limitado' } } });
  r = await p.pedir('POST', `/painel/api/catalogo/${dif.id}`, { ...cab, corpo: { preco_venda_iva: dif.preco_venda_iva + 2 } });
  assert.equal(r.json.especificacoes.nota, 'Modelo X; stock limitado');
  await p.pedir('POST', `/painel/api/catalogo/${dif.id}`, { ...cab, corpo: { preco_venda_iva: dif.preco_venda_iva, especificacoes: dif.especificacoes } });
});

test('GET orcamentos/:id: os artigos da simulação não trazem a nota interna (nem ao CEO nem ao comercial)', async () => {
  const sim = { versao: 1, itens: [{ sku: 'IDR-2P-40A-30MA', qtd: 2, preco_iva: 45 }, { sku: 'CAIXA-QUADRO-12', qtd: 1, preco_iva: 40 }] };
  assert.equal((await enviar({ ...BASE, nome: 'Nota Interna', simulacao: sim })).estado, 201);
  const o = (await p.pedir('GET', '/painel/api/orcamentos', { cookie: p.cookies.ceo })).json.orcamentos.find((x) => x.nome === 'Nota Interna');
  for (const papel of ['ceo', 'comercial']) {
    const r = await p.pedir('GET', `/painel/api/orcamentos/${o.id}`, { cookie: p.cookies[papel] });
    assert.equal(r.estado, 200);
    assert.deepEqual(Object.keys(r.json.catalogo).sort(), ['CAIXA-QUADRO-12', 'IDR-2P-40A-30MA']);
    assert.ok(!r.texto.includes('provisório'), `${papel}: sem "preço provisório"`);
    for (const a of Object.values(r.json.catalogo)) assert.ok(!('nota' in a.especificacoes), papel);
    assert.equal(r.json.catalogo['IDR-2P-40A-30MA'].especificacoes.funcao, 'diferencial', 'o resto das especificações fica');
  }
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
  assert.deepEqual(r.json, { tarifa_hora_iva: 40, margem_intervalo_pct: 20, deslocacao_iva: 0, deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100 });
  assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo: { margem_intervalo_pct: 101 } })).estado, 400);
  assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo: { outra: 1 } })).estado, 400);
  // Mensagens com os nomes em português (não as chaves).
  for (const [corpo, erro] of [
    [{ deslocacao_km_gratis: 5000 }, 'Os km grátis da deslocação: entre 0 e 1000.'],
    [{ tarifa_hora_iva: 'x' }, 'A tarifa por hora: tem de ser um número.'],
    [{ deslocacao_max_km: null }, 'Indique a distância máxima da deslocação.'],
    [{ deslocacao_preco_km_iva: -1 }, 'O preço por km da deslocação: entre 0 e 100.'],
  ]) assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo })).json.erro, erro, JSON.stringify(corpo));
  assert.deepEqual((await p.pedir('GET', '/api/catalogo')).json.config, { tarifa_hora_iva: 40, margem_intervalo_pct: 20, deslocacao_iva: 0, deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100 });
  for (const papel of ['tecnico', 'comercial']) {
    assert.equal((await p.pedir('GET', '/painel/api/catalogo', { cookie: p.cookies[papel] })).estado, 403);
    assert.equal((await p.pedir('POST', '/painel/api/config-orcamento', { cookie: p.cookies[papel], corpo: { tarifa_hora_iva: 1 } })).estado, 403);
  }
  assert.ok(p.app.db.prepare('SELECT 1 FROM auditoria WHERE acao = \'config_orcamento_atualizada\'').get());
});

test('configuração da deslocação (base, km grátis, €/km, máximo): validação e exposição pública só do necessário', async () => {
  const cab = { cookie: p.cookies.ceo };
  const cfg = (corpo) => p.pedir('POST', '/painel/api/config-orcamento', { ...cab, corpo });
  let r = await cfg({ deslocacao_base: 'Évora', deslocacao_km_gratis: 10, deslocacao_preco_km_iva: 0.55, deslocacao_max_km: 150, deslocacao_iva: 5 });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.deslocacao_base, 'Évora');
  assert.equal(r.json.deslocacao_preco_km_iva, 0.55);
  for (const corpo of [
    { deslocacao_base: 'Evora' },            // nome exato da lista (com acento)
    { deslocacao_base: 'Cacém' },            // freguesia, não concelho
    { deslocacao_base: 12 },
    { deslocacao_base: '' },
    { deslocacao_km_gratis: -1 },
    { deslocacao_preco_km_iva: 101 },
    { deslocacao_max_km: 2001 },
    { deslocacao_max_km: 'muito' },
  ]) assert.equal((await cfg(corpo)).estado, 400, JSON.stringify(corpo));
  assert.equal((await p.pedir('GET', '/painel/api/config-orcamento', cab)).json.deslocacao_base, 'Évora', 'valores inválidos não mudam nada');
  // Uma chave que não é do simulador (ex. um custo interno) nunca aparece no /api/catalogo.
  p.app.db.prepare("INSERT INTO config_orcamento (chave, valor) VALUES ('custo_interno_km', 0.12)").run();
  const pub = (await p.pedir('GET', '/api/catalogo')).json.config;
  assert.deepEqual(pub, { tarifa_hora_iva: 40, margem_intervalo_pct: 20, deslocacao_iva: 5, deslocacao_base: 'Évora', deslocacao_km_gratis: 10, deslocacao_preco_km_iva: 0.55, deslocacao_max_km: 150 });
  p.app.db.prepare("DELETE FROM config_orcamento WHERE chave = 'custo_interno_km'").run();
  assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'config_orcamento_atualizada' AND detalhes LIKE '%deslocacao_base%'").get());
  // Repõe os valores de exemplo.
  assert.equal((await cfg({ deslocacao_base: 'Lisboa', deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, deslocacao_max_km: 100, deslocacao_iva: 0 })).estado, 200);
});

test('simulação com deslocação (localidade, concelho, distrito, km, €) é aceite e guardada', async () => {
  const deslocacao = { estado: 'estimada', localidade: 'Sintra', concelho: 'Sintra', distrito: 'Lisboa', distancia_km: 29, valor_iva: 3.6 };
  const r = await enviar({ ...BASE, nome: 'Com deslocação', localidade: 'Sintra', simulacao: { versao: 1, casa: { localidade: 'Sintra' }, deslocacao, total: { min: 100, max: 130 } } });
  assert.equal(r.estado, 201, r.texto);
  const o = p.app.db.prepare("SELECT simulacao FROM orcamentos WHERE nome = 'Com deslocação'").get();
  assert.deepEqual(JSON.parse(o.simulacao).deslocacao, deslocacao);
  assert.equal((await enviar({ ...BASE, simulacao: { casa: { localidade: 'x'.repeat(81) } } })).estado, 400, 'casa.localidade ≤ 80');
});
