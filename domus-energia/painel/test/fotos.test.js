// Fotos do simulador (POST /api/orcamento/fotos): token (válido, expirado, errado, de outro pedido,
// armadilha), limites (tamanho, n.º, bytes mágicos, chave, legenda, origem, por IP), substituição
// pela mesma chave, acesso por papel, retenção de 12 meses, migração 5, pedidos sem fotos, e a
// leitura automática da foto do quadro com a API da Anthropic simulada (sucesso, JSON inválido,
// tempo esgotado, sem chave).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar } from '../src/db.js';
import { validarLeitura, MODELO_LEITURA } from '../src/leitura-quadro.js';

const BASE = { nome: 'Ana Fotos', telefone: '912 345 678', servico: 'Casa inteligente', localidade: 'Oeiras' };
const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const PNG = (n = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 2)]);

async function novoPedido(p, extra = {}) {
  const cookie = extra.simulacao ? (await p.contaConfirmada()).cookie : undefined;
  const r = await p.pedir('POST', '/api/orcamento', { corpo: { ...BASE, ...extra }, cookie });
  assert.equal(r.estado, 201, r.texto);
  const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
  return { id, token: r.json.fotos_token };
}

function enviarFoto(p, token, chave, corpo, { tipo = 'image/jpeg', legenda, cabecalhos = {}, ip, site = true } = {}) {
  const c = { ...cabecalhosFoto(token, chave, legenda), ...cabecalhos };
  return p.pedir('POST', '/api/orcamento/fotos', { corpo, tipo, cabecalhos: c, ip, site });
}
function cabecalhosFoto(token, chave, legenda) {
  const c = {};
  if (token !== undefined) c['X-Fotos-Token'] = token;
  if (chave !== undefined) c['X-Foto-Chave'] = chave;
  if (legenda !== undefined) c['X-Foto-Legenda'] = encodeURIComponent(legenda);
  return c;
}
const pedido = async (p, id, papel = 'ceo') => (await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies[papel] })).json;

describe('fotos sem leitura automática (sem ANTHROPIC_API_KEY)', () => {
  let p;
  let chamadas = 0;
  before(async () => {
    p = await painelComEquipa({ env: { LIMITE_FOTOS_HORA: '1000' }, fetch: async () => { chamadas++; throw new Error('não devia chamar'); } });
  });
  after(() => p.fechar());

  test('pedido sem fotos fica igual: simulação tal como chegou, galeria vazia, leitura "sem_foto"', async () => {
    const simulacao = { versao: 1, itens: [{ sku: 'X', qtd: 1 }], total: { min: 1, max: 2 } };
    const { id } = await novoPedido(p, { nome: 'Sem Fotos', simulacao });
    const o = await pedido(p, id);
    assert.deepEqual(o.simulacao, simulacao);
    assert.deepEqual(o.fotos, []);
    assert.equal(o.n_fotos, 0);
    assert.deepEqual(o.leitura_quadro, { estado: 'sem_foto' });
    const lista = (await p.pedir('GET', '/painel/api/orcamentos', { cookie: p.cookies.comercial })).json.orcamentos;
    assert.equal(lista.find((x) => x.id === id).n_fotos, 0);
    assert.equal(existsSync(join(p.config.fotosDir, String(id))), false, 'sem pasta de fotos');
  });

  test('token válido: 201 {ok, id}; ficheiro fora da pasta pública; metadados da simulação na galeria', async () => {
    const sim = { versao: 1, fotos: [
      { chave: 'quadro', tipo: 'quadro', divisao: null, divisao_nome: null, piso: 0, legenda: 'Quadro da entrada' },
      { chave: 'd1:tomada', tipo: 'tomada', divisao: 'd1', divisao_nome: 'Cozinha', piso: 0, legenda: null },
    ] };
    const { id, token } = await novoPedido(p, { simulacao: sim });
    const r1 = await enviarFoto(p, token, 'quadro', JPEG());
    assert.equal(r1.estado, 201, r1.texto);
    assert.equal(r1.json.ok, true);
    assert.match(r1.json.id, /^[a-f0-9]{24}$/);
    const r2 = await enviarFoto(p, token, 'd1:tomada', PNG(), { tipo: 'image/png', legenda: 'Tomada partida, ao pé do fogão' });
    assert.equal(r2.estado, 201, r2.texto);
    const ficheiros = await readdir(join(p.dados, 'painel', 'fotos', String(id)));
    assert.deepEqual(ficheiros.sort(), [`${r1.json.id}.jpg`, `${r2.json.id}.png`].sort());
    assert.ok(!p.config.fotosDir.startsWith(p.config.publicDir));
    const o = await pedido(p, id, 'comercial');
    assert.equal(o.n_fotos, 2);
    assert.deepEqual(o.fotos.map((f) => f.chave), ['quadro', 'd1:tomada'], 'o quadro primeiro');
    const t = o.fotos[1];
    assert.equal(t.divisao_nome, 'Cozinha');
    assert.equal(t.tipo, 'tomada');
    assert.equal(t.legenda, 'Tomada partida, ao pé do fogão', 'legenda do cabeçalho (encodeURIComponent)');
    assert.equal(o.fotos[0].legenda, 'Quadro da entrada', 'sem cabeçalho: a legenda dos metadados');
    assert.equal(t.url, `/painel/api/orcamentos/${id}/fotos/${r2.json.id}`);
    assert.deepEqual(o.leitura_quadro, { estado: 'desligada' }, 'sem ANTHROPIC_API_KEY');
    await p.app.api.fotos.leiturasEmCurso();
    assert.equal(chamadas, 0, 'sem chave não chama nada');
  });

  test('token expirado (30 min), errado, em falta, da armadilha → 401; token de outro pedido só serve esse pedido', async () => {
    const a = await novoPedido(p, { nome: 'Pedido A' });
    const b = await novoPedido(p, { nome: 'Pedido B' });
    assert.notEqual(a.token, b.token);
    // O token de A põe a foto em A (nunca em B).
    const r = await enviarFoto(p, a.token, 'quadro', JPEG());
    assert.equal(r.estado, 201);
    assert.equal(p.app.db.prepare('SELECT orcamento_id FROM fotos WHERE id = ?').get(r.json.id).orcamento_id, a.id);
    assert.equal((await pedido(p, b.id)).fotos.length, 0);
    for (const tok of ['x'.repeat(43), 'curto', undefined, b.token.slice(0, -1) + (b.token.endsWith('A') ? 'B' : 'A')]) {
      const e = await enviarFoto(p, tok, 'quadro', JPEG());
      assert.equal(e.estado, 401, `token ${tok}: ${e.texto}`);
      assert.match(e.json.erro, /inválida ou expirada/);
    }
    const arm = await p.pedir('POST', '/api/orcamento', { corpo: { ...BASE, website: 'spam' } });
    assert.equal((await enviarFoto(p, arm.json.fotos_token, 'quadro', JPEG())).estado, 401, 'o token da armadilha não tem efeito');
    // Na base só o hash.
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos_tokens WHERE hash = ?').get(a.token).n, 0);
    p.relogio.avancar(31 * 60_000);
    try {
      assert.equal((await enviarFoto(p, b.token, 'quadro', JPEG())).estado, 401, 'expirado ao fim de 30 min');
    } finally {
      p.relogio.avancar(-31 * 60_000);
    }
    assert.equal((await enviarFoto(p, b.token, 'quadro', JPEG())).estado, 201, 'dentro dos 30 min');
  });

  test('limites: tamanho, tipo, bytes mágicos, chave, legenda, vazia, origem, método', async () => {
    const { id, token } = await novoPedido(p);
    let r = await enviarFoto(p, token, 'quadro', JPEG(1024 * 1024));
    assert.equal(r.estado, 413);
    assert.match(r.json.erro, /1 MB/);
    assert.equal((await enviarFoto(p, token, 'quadro', JPEG(1024 * 1024 - 4))).estado, 201, 'exatamente 1 MB');
    r = await enviarFoto(p, token, 'quadro', JPEG(), { tipo: 'image/gif' });
    assert.equal(r.estado, 415);
    assert.equal((await enviarFoto(p, token, 'quadro', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { tipo: 'image/png' })).estado, 415, 'SVG com tipo PNG');
    assert.equal((await enviarFoto(p, token, 'quadro', PNG(), { tipo: 'image/jpeg' })).estado, 415, 'PNG declarado como JPEG');
    assert.equal((await enviarFoto(p, token, 'quadro', Buffer.from('GIF89a......'), { tipo: 'image/jpeg' })).estado, 415);
    assert.equal((await enviarFoto(p, token, 'quadro', Buffer.alloc(0))).estado, 400);
    for (const chave of ['', '../etc', 'd1', 'd1:Tomada', 'd1:tomada/x', 'a b:luz', 'x'.repeat(65) + ':luz', 'd1:tomada:extra', undefined]) {
      r = await enviarFoto(p, token, chave, JPEG());
      assert.equal(r.estado, 400, `chave ${chave}: ${r.texto}`);
    }
    assert.equal((await enviarFoto(p, token, 'd1:luz', JPEG(), { legenda: 'x'.repeat(121) })).estado, 400, 'legenda > 120');
    assert.equal((await enviarFoto(p, token, 'd1:luz', JPEG(), { cabecalhos: { 'X-Foto-Legenda': '%E0%A4%A' } })).estado, 400, 'legenda mal codificada');
    assert.equal((await enviarFoto(p, token, 'd1:luz', JPEG(), { legenda: 'x'.repeat(120) })).estado, 201);
    // Origem (CSRF) como no /api/orcamento.
    assert.equal((await enviarFoto(p, token, 'd1:porta', JPEG(), { site: false })).estado, 403, 'sem Origin nem Sec-Fetch-Site');
    assert.equal((await enviarFoto(p, token, 'd1:porta', JPEG(), { cabecalhos: { Origin: 'https://mau.exemplo' } })).estado, 403);
    assert.equal((await p.pedir('GET', '/api/orcamento/fotos')).estado, 405);
    assert.equal((await pedido(p, id)).n_fotos, 2, 'só as válidas ficaram');
  });

  test('máx. 40 por pedido; a mesma chave substitui a anterior (registo e ficheiro)', async () => {
    const { id, token } = await novoPedido(p);
    let primeira;
    for (let i = 0; i < 40; i++) {
      const r = await enviarFoto(p, token, `d${i}:luz`, JPEG(100, i));
      assert.equal(r.estado, 201, r.texto);
      if (i === 0) primeira = r.json.id;
    }
    const r41 = await enviarFoto(p, token, 'd99:luz', JPEG());
    assert.equal(r41.estado, 400);
    assert.match(r41.json.erro, /máximo de 40/);
    // Substituir uma que já existe continua a dar (não passa das 40).
    const nova = await enviarFoto(p, token, 'd0:luz', JPEG(300, 9), { legenda: 'nova' });
    assert.equal(nova.estado, 201);
    const o = await pedido(p, id);
    assert.equal(o.n_fotos, 40);
    const d0 = o.fotos.filter((f) => f.chave === 'd0:luz');
    assert.equal(d0.length, 1);
    assert.equal(d0[0].id, nova.json.id);
    assert.equal(d0[0].legenda, 'nova');
    const ficheiros = await readdir(join(p.config.fotosDir, String(id)));
    assert.equal(ficheiros.length, 40);
    assert.ok(!ficheiros.includes(`${primeira}.jpg`), 'o ficheiro antigo foi apagado');
    const img = await p.pedir('GET', `/painel/api/orcamentos/${id}/fotos/${nova.json.id}`, { cookie: p.cookies.ceo });
    assert.deepEqual(img.bruto, JPEG(300, 9));
  });

  test('servir: só CEO/comercial com sessão, tipo certo, nosniff; 404 noutro pedido; apagar (CEO/comercial)', async () => {
    const a = await novoPedido(p);
    const b = await novoPedido(p);
    const f = (await enviarFoto(p, a.token, 'quadro', PNG(500), { tipo: 'image/png' })).json.id;
    const url = `/painel/api/orcamentos/${a.id}/fotos/${f}`;
    for (const papel of ['ceo', 'comercial']) {
      const r = await p.pedir('GET', url, { cookie: p.cookies[papel] });
      assert.equal(r.estado, 200);
      assert.equal(r.cabecalhos['content-type'], 'image/png');
      assert.equal(r.cabecalhos['x-content-type-options'], 'nosniff');
      assert.match(r.cabecalhos['content-security-policy'], /sandbox/);
      assert.equal(r.cabecalhos['cache-control'], 'private, no-store');
      assert.deepEqual(r.bruto, PNG(500));
    }
    assert.equal((await p.pedir('GET', url)).estado, 401);
    assert.equal((await p.pedir('GET', url, { cookie: p.cookies.tecnico })).estado, 403);
    assert.equal((await p.pedir('GET', `/painel/api/orcamentos/${b.id}/fotos/${f}`, { cookie: p.cookies.ceo })).estado, 404, 'a foto é de outro pedido');
    assert.equal((await p.pedir('GET', `/painel/api/orcamentos/${a.id}/fotos/..%2F..%2Fpainel.db`, { cookie: p.cookies.ceo })).estado, 404);
    assert.equal((await p.pedir('GET', `/painel/api/orcamentos/${a.id}/fotos`, { cookie: p.cookies.ceo })).estado, 404, 'sem listagem');
    // Apagar.
    const apagar = `${url}/apagar`;
    assert.equal((await p.pedir('POST', apagar, { corpo: {}, cookie: p.cookies.tecnico })).estado, 403);
    const r = await p.pedir('POST', apagar, { corpo: {}, cookie: p.cookies.comercial });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json.fotos, []);
    assert.equal((await p.pedir('GET', url, { cookie: p.cookies.ceo })).estado, 404);
    assert.equal(existsSync(join(p.config.fotosDir, String(a.id), `${f}.png`)), false);
    assert.ok(r.json.historico.some((h) => h.acao === 'foto_apagada' && h.detalhes.chave === 'quadro'), 'fica no histórico');
    assert.equal((await p.pedir('POST', apagar, { corpo: {}, cookie: p.cookies.ceo })).estado, 404);
  });

  test('retenção: pedidos sem seguimento há mais de 12 meses perdem as fotos; aceites e recentes ficam', async () => {
    const casos = {};
    for (const nome of ['perdido_velho', 'novo_velho', 'aceite_velho', 'convertido_velho', 'perdido_recente']) {
      casos[nome] = await novoPedido(p, { nome });
      assert.equal((await enviarFoto(p, casos[nome].token, 'quadro', JPEG())).estado, 201);
    }
    const ha = (dias) => new Date(Date.now() - dias * 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const upd = p.app.db.prepare('UPDATE orcamentos SET estado = ?, atualizado = ?, motivo_perda = ?, obra_id = ? WHERE id = ?');
    upd.run('perdido', ha(370), 'caro', null, casos.perdido_velho.id);
    upd.run('novo', ha(366), null, null, casos.novo_velho.id);
    upd.run('aceite', ha(400), null, null, casos.aceite_velho.id);
    upd.run('proposta_enviada', ha(400), null, 1, casos.convertido_velho.id);
    upd.run('perdido', ha(300), 'caro', null, casos.perdido_recente.id);
    const r = await p.app.api.fotos.apagarRetidas();
    assert.ok(r.pedidos >= 2);
    const n = (c) => p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(casos[c].id).n;
    assert.equal(n('perdido_velho'), 0);
    assert.equal(n('novo_velho'), 0);
    assert.equal(existsSync(join(p.config.fotosDir, String(casos.perdido_velho.id))), false, 'pasta apagada');
    for (const c of ['aceite_velho', 'convertido_velho', 'perdido_recente']) assert.equal(n(c), 1, `${c} mantém as fotos`);
    const aud = p.app.db.prepare('SELECT * FROM auditoria WHERE acao = \'fotos_apagadas_retencao\' AND alvo = ?').get(`orcamento:${casos.perdido_velho.id}`);
    assert.ok(aud, 'fica na auditoria');
    assert.deepEqual((await p.app.api.fotos.apagarRetidas()).fotos, 0, 'correr outra vez não faz nada');
  });
});

test('limite por IP (429 + Retry-After): contam todas as tentativas, outros IPs não afetados', async () => {
  const p = await painelComEquipa({ env: { LIMITE_FOTOS_HORA: '5' } });
  try {
    const { token } = await novoPedido(p);
    const ip = '10.9.9.9';
    for (let i = 0; i < 4; i++) assert.equal((await enviarFoto(p, token, `d${i}:luz`, JPEG(), { ip })).estado, 201);
    assert.equal((await enviarFoto(p, 'x'.repeat(43), 'quadro', JPEG(), { ip })).estado, 401, 'a recusada também conta');
    const r = await enviarFoto(p, token, 'd9:luz', JPEG(), { ip });
    assert.equal(r.estado, 429);
    assert.ok(Number(r.cabecalhos['retry-after']) > 0);
    assert.equal((await enviarFoto(p, token, 'd9:luz', JPEG(), { ip: '10.9.9.10' })).estado, 201);
  } finally {
    await p.fechar();
  }
});

test('migração 5: uma base já existente ganha as tabelas das fotos sem perder os pedidos', () => {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRACOES.slice(0, 4)) m(db);
  db.exec('PRAGMA user_version = 4');
  db.prepare('INSERT INTO orcamentos (criado, atualizado, nome, servico, simulacao) VALUES (\'2026-01-01T00:00:00Z\', \'2026-01-01T00:00:00Z\', \'Antigo\', \'Casa\', \'{"versao":1}\')').run();
  migrar(db);
  const o = db.prepare('SELECT * FROM orcamentos').get();
  assert.equal(o.nome, 'Antigo');
  assert.equal(o.simulacao, '{"versao":1}');
  assert.equal(o.leitura_quadro, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n, 0);
  db.close();
});

// ------------------------------------------------------------ leitura automática (API simulada)

const LEITURA_OK = {
  e_quadro_eletrico: true,
  disjuntores_total: 6,
  disjuntores: [{ amperes: 10, quantidade: 2 }, { amperes: 16, quantidade: 3 }, { amperes: 20, quantidade: 1 }],
  diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 1 }],
  disjuntor_geral: { visivel: true, amperes: 32, tipo: 'disjuntor 2P' },
  modulos_livres_estimados: 3,
  marcas: ['Hager'],
  estado_aparente: 'razoavel',
  fusiveis: false,
  sinais_aquecimento: false,
  notas: 'Só um diferencial para todos os circuitos.',
  confianca: 'media',
};
const respostaApi = (texto, extra = {}) => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODELO_LEITURA, stop_reason: 'end_turn',
  content: [{ type: 'text', text: texto }], usage: { input_tokens: 2100, output_tokens: 350 }, ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('leitura automática da foto do quadro (API simulada)', () => {
  let p;
  let modo = 'ok';
  const pedidos = [];
  async function fetchFalso(url, opcoes) {
    pedidos.push({ url, opcoes, corpo: JSON.parse(opcoes.body) });
    if (modo === 'ok') return respostaApi(JSON.stringify(LEITURA_OK));
    if (modo === 'json') return respostaApi('isto não é JSON {');
    if (modo === 'esquema') return respostaApi(JSON.stringify({ ...LEITURA_OK, confianca: 'total' }));
    if (modo === '500-depois-ok') return pedidos.length % 2 ? new Response('{"type":"error","error":{"type":"api_error"}}', { status: 500 }) : respostaApi(JSON.stringify(LEITURA_OK));
    if (modo === '401') return new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 });
    // modo 'pendurado': só acaba quando o sinal (timeout) aborta.
    return new Promise((_, rejeitar) => opcoes.signal.addEventListener('abort', () => rejeitar(opcoes.signal.reason)));
  }
  before(async () => {
    p = await painelComEquipa({ env: { ANTHROPIC_API_KEY: 'sk-ant-teste', LEITURA_QUADRO_TIMEOUT_MS: '150', LIMITE_FOTOS_HORA: '1000' }, fetch: fetchFalso });
  });
  after(() => p.fechar());

  async function comQuadro(m, nome = 'Leitura') {
    modo = m;
    pedidos.length = 0;
    const { id, token } = await novoPedido(p, { nome, email: 'cliente@exemplo.pt', simulacao: { versao: 1, fotos: [{ chave: 'quadro', tipo: 'quadro' }] } });
    const inicio = Date.now();
    const r = await enviarFoto(p, token, 'quadro', JPEG(5000, 7));
    assert.equal(r.estado, 201, r.texto);
    const demorou = Date.now() - inicio;
    await p.app.api.fotos.leiturasEmCurso();
    return { id, foto: r.json.id, demorou, o: await pedido(p, id) };
  }

  test('sucesso: só a imagem e as instruções vão ao modelo; leitura validada e guardada com o pedido', async () => {
    const { o, foto } = await comQuadro('ok', 'Maria Confidencial');
    assert.equal(pedidos.length, 1);
    const { url, opcoes, corpo } = pedidos[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(opcoes.headers['x-api-key'], 'sk-ant-teste');
    assert.equal(opcoes.headers['anthropic-version'], '2023-06-01');
    assert.equal(corpo.model, 'claude-haiku-4-5');
    assert.equal(corpo.output_config.format.type, 'json_schema');
    const img = corpo.messages[0].content.find((c) => c.type === 'image');
    assert.deepEqual(img.source, { type: 'base64', media_type: 'image/jpeg', data: JPEG(5000, 7).toString('base64') });
    for (const pessoal of ['Maria', 'Confidencial', '912', 'cliente@exemplo.pt', 'Oeiras']) assert.ok(!opcoes.body.includes(pessoal), `sem dados pessoais (${pessoal})`);
    assert.equal(o.leitura_quadro.estado, 'feita');
    assert.equal(o.leitura_quadro.foto_id, foto);
    assert.equal(o.leitura_quadro.modelo, 'claude-haiku-4-5');
    assert.deepEqual(o.leitura_quadro.leitura, LEITURA_OK);
    assert.deepEqual(o.leitura_quadro.tokens, { entrada: 2100, saida: 350 });
    assert.equal(o.leitura_quadro.custo_usd, 0.00385);
  });

  test('não atrasa a resposta: o browser recebe o 201 antes de a leitura acabar (tempo esgotado + 1 tentativa)', async () => {
    const { o, demorou } = await comQuadro('pendurado');
    assert.ok(demorou < 150, `a resposta demorou ${demorou} ms`);
    assert.equal(pedidos.length, 2, '1 tentativa extra');
    assert.equal(o.leitura_quadro.estado, 'erro');
    assert.match(o.leitura_quadro.erro, /tempo esgotado/);
  });

  test('JSON inválido ou fora do esquema → 2 tentativas e erro guardado; 500 → repete e fica feita; 401 não repete', async () => {
    let r = await comQuadro('json');
    assert.equal(pedidos.length, 2);
    assert.equal(r.o.leitura_quadro.estado, 'erro');
    assert.match(r.o.leitura_quadro.erro, /JSON válido/);
    r = await comQuadro('esquema');
    assert.equal(pedidos.length, 2);
    assert.match(r.o.leitura_quadro.erro, /inválida: confianca/);
    r = await comQuadro('500-depois-ok');
    assert.equal(pedidos.length, 2);
    assert.equal(r.o.leitura_quadro.estado, 'feita');
    r = await comQuadro('401');
    assert.equal(pedidos.length, 1, 'chave errada: não repete');
    assert.match(r.o.leitura_quadro.erro, /401/);
  });

  test('fotos que não são do quadro não chamam o modelo; foto do quadro nova → leitura nova', async () => {
    modo = 'ok';
    pedidos.length = 0;
    const { id, token } = await novoPedido(p);
    assert.equal((await enviarFoto(p, token, 'd1:tomada', JPEG())).estado, 201);
    await p.app.api.fotos.leiturasEmCurso();
    assert.equal(pedidos.length, 0);
    assert.equal((await pedido(p, id)).leitura_quadro.estado, 'sem_foto');
    const f1 = (await enviarFoto(p, token, 'quadro', JPEG())).json.id;
    await p.app.api.fotos.leiturasEmCurso();
    const f2 = (await enviarFoto(p, token, 'quadro', JPEG(10))).json.id;
    await p.app.api.fotos.leiturasEmCurso();
    const o = await pedido(p, id);
    assert.equal(pedidos.length, 2);
    assert.notEqual(f1, f2);
    assert.equal(o.leitura_quadro.foto_id, f2);
  });
});

test('validarLeitura: tipos, limites e campos a mais', () => {
  assert.deepEqual(validarLeitura(LEITURA_OK), LEITURA_OK);
  const mau = (x) => assert.throws(() => validarLeitura({ ...LEITURA_OK, ...x }), /inválida/);
  mau({ disjuntores_total: -1 });
  mau({ disjuntores_total: 2.5 });
  mau({ disjuntores: [{ amperes: 16 }] });
  mau({ diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 1, extra: 1 }] });
  mau({ estado_aparente: 'novo' });
  mau({ marcas: 'Hager' });
  mau({ disjuntor_geral: { visivel: 'sim', amperes: 32, tipo: null } });
  mau({ outro: 1 });
  assert.throws(() => validarLeitura([]), /inválida/);
});
