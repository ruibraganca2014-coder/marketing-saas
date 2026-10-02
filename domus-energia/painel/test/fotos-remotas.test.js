// Fotos pelo telemóvel (QR; /api/fotos-remotas, fotos-remotas.js): token (criar, reutilizar, na base só o hash,
// expirar), envio do telemóvel (aceitar JPEG/PNG; recusar token errado, chave não pedida, tipo, bytes, tamanho,
// origem), sondagem do computador (`desde`), entrega dos bytes, apagar depois de receber, limite de chaves por
// token, limites por IP, limpeza dos expirados (ficheiros incluídos) e a migração 19.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { iniciarPainel } from './ajuda.js';
import { MIGRACOES, migrar } from '../src/db.js';
import { TOKEN_REMOTO_MS, CHAVES_MAX } from '../src/fotos-remotas.js';

const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const PNG = (n = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 2)]);
const SIM = 'a1b2c3d4e5f60718293a4b5c';
const TOKEN_FALSO = 'A'.repeat(43);

const cab = (token) => (token === undefined ? {} : { 'X-Foto-Token': token });
/** O computador pede o QR (regista a chave; cria ou reutiliza o token). */
const pedir = (p, { sim = SIM, chave = 'quadro', rotulo = 'Foto do quadro elétrico', token, ip } = {}) =>
  p.pedir('POST', '/api/fotos-remotas', { corpo: { sim, chave, rotulo }, cabecalhos: cab(token), ip });
/** O telemóvel envia a foto. */
const enviar = (p, token, chave, corpo, { tipo = 'image/jpeg', site = true, ip } = {}) =>
  p.pedir('POST', `/api/fotos-remotas/${encodeURIComponent(chave)}`, { corpo, tipo, cabecalhos: cab(token), site, ip });
/** O computador sonda. */
const sondar = (p, token, desde) => p.pedir('GET', `/api/fotos-remotas${desde === undefined ? '' : `?desde=${desde}`}`, { cabecalhos: cab(token), site: false });
const tokensNaBase = (p) => p.app.db.prepare('SELECT * FROM fotos_remotas_tokens').all();

describe('fotos pelo telemóvel (QR)', () => {
  let p;
  before(async () => { p = await iniciarPainel({ env: { LIMITE_FOTOS_HORA: '1000', LIMITE_FOTOS_CONSULTAS_HORA: '100000' } }); });
  after(() => p.fechar());

  test('migração 19: tabelas novas; uma base antiga (18) migra sem mexer no resto', () => {
    assert.ok(MIGRACOES.length >= 19);   // a 20 (tomada tripla) veio depois
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrar(db);
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    assert.ok(tabelas.includes('fotos_remotas_tokens') && tabelas.includes('fotos_remotas'));
    db.close();
  });

  test('POST /api/fotos-remotas cria o token (43 base64url, 24 h) e regista a chave; na base só o SHA-256', async () => {
    const r = await pedir(p);
    assert.equal(r.estado, 201, r.texto);
    assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Math.abs(r.json.expira - (p.relogio.agora() + TOKEN_REMOTO_MS)) < 5000);
    assert.deepEqual(r.json.chaves.map((c) => [c.chave, c.rotulo, c.pronta]), [['quadro', 'Foto do quadro elétrico', false]]);
    const t = tokensNaBase(p).find((x) => x.sim === SIM);
    assert.ok(t);
    assert.match(t.hash, /^[a-f0-9]{64}$/);
    assert.notEqual(t.hash, r.json.token);
    assert.equal(JSON.stringify(tokensNaBase(p)).includes(r.json.token), false);
  });

  test('o mesmo token (X-Foto-Token) para a mesma simulação acrescenta chaves sem criar outro token; outra simulação → token novo', async () => {
    const r1 = await pedir(p, { sim: 'b'.repeat(24) });
    const antes = tokensNaBase(p).length;
    const r2 = await pedir(p, { sim: 'b'.repeat(24), chave: 'avaria:foto_2', rotulo: 'Foto 2 da avaria', token: r1.json.token });
    assert.equal(r2.estado, 200, r2.texto);
    assert.equal(r2.json.token, undefined);
    assert.deepEqual(r2.json.chaves.map((c) => c.chave), ['quadro', 'avaria:foto_2']);
    assert.equal(tokensNaBase(p).length, antes);
    // Repetir a chave não duplica.
    const r3 = await pedir(p, { sim: 'b'.repeat(24), chave: 'quadro', token: r1.json.token });
    assert.equal(r3.json.chaves.length, 2);
    // Outra simulação com o mesmo token: token novo.
    const r4 = await pedir(p, { sim: 'c'.repeat(24), token: r1.json.token });
    assert.equal(r4.estado, 201);
    assert.ok(r4.json.token && r4.json.token !== r1.json.token);
    assert.equal(tokensNaBase(p).length, antes + 1);
  });

  test('pedidos inválidos: sim, chave, rótulo comprido, origem desconhecida', async () => {
    assert.equal((await pedir(p, { sim: 'ZZZ' })).estado, 400);
    assert.equal((await pedir(p, { chave: 'quadro/../x' })).estado, 400);
    assert.equal((await pedir(p, { rotulo: 'x'.repeat(121) })).estado, 400);
    const r = await p.pedir('POST', '/api/fotos-remotas', { corpo: { sim: SIM, chave: 'quadro' }, site: false });
    assert.equal(r.estado, 403);
    assert.equal((await p.pedir('GET', '/api/fotos-remotas', { site: false })).estado, 401, 'sem token');
    assert.equal((await sondar(p, TOKEN_FALSO)).estado, 401, 'token desconhecido');
  });

  test('envio do telemóvel → sondagem → entrega → apagar: a foto chega ao computador tal como foi enviada', async () => {
    const sim = 'd'.repeat(24);
    const { json: { token } } = await pedir(p, { sim, chave: 'd1:tomada', rotulo: 'Tomadas (Sala)' });
    await pedir(p, { sim, chave: 'quadro', token });
    // Antes de haver fotos: sondar diz as duas por receber.
    let s = await sondar(p, token, 0);
    assert.equal(s.estado, 200, s.texto);
    assert.equal(s.json.seq, 0);
    assert.deepEqual(s.json.chaves.map((c) => [c.chave, c.pronta]), [['d1:tomada', false], ['quadro', false]]);
    assert.equal(s.cabecalhos['cache-control'], 'no-store');
    // O telemóvel envia (sem Origin do site: a página foto.html é do site, mas também pode ser same-origin sem Sec-Fetch-Site).
    const foto = JPEG(3000, 7);
    const e = await enviar(p, token, 'd1:tomada', foto);
    assert.equal(e.estado, 201, e.texto);
    assert.equal(e.json.seq, 1);
    assert.equal(e.json.chaves.find((c) => c.chave === 'd1:tomada').pronta, true);
    // Sondar desde 0: a foto 1 e a chave por receber; desde 1: só a por receber.
    s = await sondar(p, token, 0);
    const pronta = s.json.chaves.find((c) => c.pronta);
    assert.deepEqual([pronta.chave, pronta.seq, pronta.bytes, pronta.tipo_mime], ['d1:tomada', 1, foto.length, 'image/jpeg']);
    s = await sondar(p, token, 1);
    assert.deepEqual(s.json.chaves.map((c) => c.chave), ['quadro']);
    // Entrega dos bytes.
    const g = await p.pedir('GET', '/api/fotos-remotas/d1%3Atomada', { cabecalhos: cab(token), site: false });
    assert.equal(g.estado, 200);
    assert.equal(g.cabecalhos['content-type'], 'image/jpeg');
    assert.ok(g.bruto.equals(foto));
    // Fica fora da pasta pública, debaixo de FOTOS_DIR/remotas.
    const pastas = await readdir(join(p.config.fotosDir, 'remotas'));
    assert.equal(pastas.length >= 1, true);
    assert.ok(!p.config.fotosDir.startsWith(p.config.publicDir));
    // A mesma chave outra vez substitui (seq 2); PNG também serve.
    const e2 = await enviar(p, token, 'd1:tomada', PNG(), { tipo: 'image/png' });
    assert.equal(e2.estado, 201);
    assert.equal(e2.json.seq, 2);
    const g2 = await p.pedir('GET', '/api/fotos-remotas/d1%3Atomada', { cabecalhos: cab(token), site: false });
    assert.equal(g2.cabecalhos['content-type'], 'image/png');
    // Apagar depois de receber: os bytes saem, a chave fica "recebida" (o telemóvel mostra "enviada").
    const a = await p.pedir('POST', '/api/fotos-remotas/d1%3Atomada/apagar', { corpo: {}, cabecalhos: cab(token) });
    assert.equal(a.estado, 200, a.texto);
    assert.equal((await p.pedir('GET', '/api/fotos-remotas/d1%3Atomada', { cabecalhos: cab(token), site: false })).estado, 404);
    s = await sondar(p, token);
    const c = s.json.chaves.find((x) => x.chave === 'd1:tomada');
    assert.ok(c.recebida && !c.pronta);
    const ficheiros = await Promise.all(pastas.map((d) => readdir(join(p.config.fotosDir, 'remotas', d))));
    assert.equal(ficheiros.flat().some((f) => f.endsWith('.png') || f.endsWith('.jpg')), false, 'nenhum ficheiro desta foto fica no disco');
  });

  test('envio recusado: token errado/sem token (401), chave não pedida (404), tipo (415), bytes (415), vazio (400), > 1 MB (413), origem (403)', async () => {
    const sim = 'e'.repeat(24);
    const { json: { token } } = await pedir(p, { sim, chave: 'quadro' });
    assert.equal((await enviar(p, TOKEN_FALSO, 'quadro', JPEG())).estado, 401);
    assert.equal((await enviar(p, undefined, 'quadro', JPEG())).estado, 401);
    assert.equal((await enviar(p, token, 'd9:luz', JPEG())).estado, 404);
    assert.equal((await enviar(p, token, 'quadro', JPEG(), { tipo: 'image/gif' })).estado, 415);
    assert.equal((await enviar(p, token, 'quadro', Buffer.from('nao e imagem'))).estado, 415);
    assert.equal((await enviar(p, token, 'quadro', Buffer.alloc(0))).estado, 400);
    assert.equal((await enviar(p, token, 'quadro', JPEG(1024 * 1024 + 10))).estado, 413);
    assert.equal((await enviar(p, token, 'quadro', JPEG(), { site: false })).estado, 403);
    assert.equal((await p.pedir('GET', '/api/fotos-remotas/quadro', { cabecalhos: cab(token), site: false })).estado, 404, 'ainda sem foto');
    assert.equal((await p.pedir('GET', '/api/fotos-remotas/x%2Fy', { cabecalhos: cab(token), site: false })).estado, 400, 'chave inválida');
    assert.equal((await p.pedir('DELETE', '/api/fotos-remotas', { cabecalhos: cab(token) })).estado, 405);
  });

  test(`no máximo ${CHAVES_MAX} chaves por token`, async () => {
    const sim = 'f'.repeat(24);
    const { json: { token } } = await pedir(p, { sim, chave: 'quadro' });
    for (let i = 1; i < CHAVES_MAX; i++) assert.equal((await pedir(p, { sim, chave: `d${i}:luz`, token })).estado, 200);
    const r = await pedir(p, { sim, chave: 'd99:luz', token });
    assert.equal(r.estado, 400);
    assert.match(r.json.erro, /máximo/);
    assert.equal((await pedir(p, { sim, chave: 'quadro', token })).estado, 200, 'repetir uma chave que já existe não conta');
  });

  test('limite por IP dos envios (LIMITE_FOTOS_HORA, partilhado com /api/orcamento/fotos) e das sondagens', async () => {
    const q = await iniciarPainel({ env: { LIMITE_FOTOS_HORA: '2', LIMITE_FOTOS_CONSULTAS_HORA: '3' } });
    try {
      const { json: { token } } = await pedir(q, { ip: '9.9.9.1' });
      assert.equal((await enviar(q, token, 'quadro', JPEG(), { ip: '9.9.9.2' })).estado, 201);
      assert.equal((await enviar(q, token, 'quadro', JPEG(), { ip: '9.9.9.2' })).estado, 201);
      const r = await enviar(q, token, 'quadro', JPEG(), { ip: '9.9.9.2' });
      assert.equal(r.estado, 429);
      assert.ok(r.cabecalhos['retry-after']);
      // Sondagens: a 1.ª tentativa foi o pedido do token (ip 9.9.9.1).
      assert.equal((await q.pedir('GET', '/api/fotos-remotas', { cabecalhos: cab(token), site: false, ip: '9.9.9.1' })).estado, 200);
      assert.equal((await q.pedir('GET', '/api/fotos-remotas', { cabecalhos: cab(token), site: false, ip: '9.9.9.1' })).estado, 200);
      assert.equal((await q.pedir('GET', '/api/fotos-remotas', { cabecalhos: cab(token), site: false, ip: '9.9.9.1' })).estado, 429);
    } finally {
      await q.fechar();
    }
  });

  test('limite por IP dos tokens NOVOS (LIMITE_FOTOS_TOKENS_HORA): reutilizar o token da mesma simulação não conta', async () => {
    const q = await iniciarPainel({ env: { LIMITE_FOTOS_TOKENS_HORA: '2', LIMITE_FOTOS_CONSULTAS_HORA: '1000' } });
    try {
      const ip = '9.9.9.3';
      const a = await pedir(q, { sim: 'aaaa000000000001', ip });
      assert.equal(a.estado, 201, a.texto);
      // O mesmo token para a mesma simulação (outra chave): não cria token, não conta.
      assert.equal((await pedir(q, { sim: 'aaaa000000000001', chave: 'd1:tomada', token: a.json.token, ip })).estado, 200);
      assert.equal((await pedir(q, { sim: 'aaaa000000000002', ip })).estado, 201);
      const r = await pedir(q, { sim: 'aaaa000000000003', ip });
      assert.equal(r.estado, 429, r.texto);
      assert.match(r.json.erro, /Demasiados códigos/);
      assert.ok(r.cabecalhos['retry-after']);
      assert.equal(tokensNaBase(q).length, 2, 'o 3.º token não foi criado');
      // Outro IP continua a poder; e o token já criado continua a servir a quem atingiu o limite.
      assert.equal((await pedir(q, { sim: 'aaaa000000000003', ip: '9.9.9.4' })).estado, 201);
      assert.equal((await pedir(q, { sim: 'aaaa000000000001', chave: 'd2:luz', token: a.json.token, ip })).estado, 200);
      assert.equal((await sondar(q, a.json.token)).estado, 200);
    } finally {
      await q.fechar();
    }
  });

  test('expira ao fim de 24 h: 401 em tudo; a limpeza apaga o token, as chaves e os ficheiros', async () => {
    const sim = '0'.repeat(24);
    const { json: { token } } = await pedir(p, { sim, chave: 'quadro' });
    assert.equal((await enviar(p, token, 'quadro', JPEG())).estado, 201);
    const hash = tokensNaBase(p).find((t) => t.sim === sim).hash;
    const pasta = join(p.config.fotosDir, 'remotas', hash.slice(0, 16));
    assert.equal((await readdir(pasta)).length, 1);
    p.relogio.avancar(TOKEN_REMOTO_MS + 1000);
    try {
      assert.equal((await sondar(p, token)).estado, 401);
      assert.equal((await enviar(p, token, 'quadro', JPEG())).estado, 401);
      assert.equal((await p.pedir('GET', '/api/fotos-remotas/quadro', { cabecalhos: cab(token), site: false })).estado, 401);
      const n = await p.app.api.fotosRemotas.limpar();
      assert.ok(n >= 1);
      assert.equal(tokensNaBase(p).some((t) => t.sim === sim), false);
      assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos_remotas WHERE token_hash = ?').get(hash).n, 0);
      assert.equal(existsSync(pasta), false);
    } finally {
      p.relogio.avancar(-(TOKEN_REMOTO_MS + 1000));
    }
  });
});
