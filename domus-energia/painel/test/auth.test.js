// Autenticação: entrar, palavra-passe errada, cookie, sair, expiração e
// renovação, limites de tentativas, bloqueio, contas desativadas, CSRF.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarPainel, SENHA, ORIGEM } from './ajuda.js';
import { hashSenha, verificarSenha, problemaSenha } from '../src/senhas.js';

let p;
let ceo;
before(async () => {
  p = await iniciarPainel();
  ceo = await p.criarUtilizador('ceo', 'ceo@domus.teste');
});
after(() => p.fechar());

const entrar = (email, password, opcoes) => p.pedir('POST', '/painel/api/entrar', { corpo: { email, password }, ...opcoes });

test('scrypt: hash com sal, verifica certo/errado, formato', async () => {
  const a = await hashSenha('uma-senha-longa');
  const b = await hashSenha('uma-senha-longa');
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b, 'sal aleatório');
  assert.equal(await verificarSenha('uma-senha-longa', a), true);
  assert.equal(await verificarSenha('outra-senha', a), false);
  assert.equal(await verificarSenha('x', 'lixo'), false);
  assert.equal(problemaSenha('curta'), 'A palavra-passe deve ter pelo menos 10 caracteres.');
  assert.equal(problemaSenha('a'.repeat(10)), null);
  const guardado = p.app.db.prepare('SELECT hash FROM utilizadores WHERE id = ?').get(ceo.id).hash;
  assert.ok(guardado.startsWith('scrypt$') && !guardado.includes(SENHA));
});

test('entrar: cookie HttpOnly, Secure, SameSite=Strict, Path=/painel, 12 h', async () => {
  const r = await entrar(ceo.email, SENHA);
  assert.equal(r.estado, 200);
  assert.deepEqual(r.json.utilizador.email, ceo.email);
  assert.equal(r.json.utilizador.papel, 'ceo');
  assert.equal(r.json.utilizador.hash, undefined);
  const c = r.cabecalhos['set-cookie'][0];
  assert.match(c, /^domus_painel=[A-Za-z0-9_-]{43};/);
  for (const f of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/painel', 'Max-Age=43200']) assert.ok(c.split('; ').includes(f), `${f} em ${c}`);
  assert.equal(r.cabecalhos['cache-control'], 'no-store');
  // A base de dados guarda o SHA-256 do token, não o token.
  const token = c.split(';')[0].split('=')[1];
  const ids = p.app.db.prepare('SELECT id FROM sessoes').all().map((s) => s.id);
  assert.ok(!ids.includes(token) && ids.every((i) => /^[0-9a-f]{64}$/.test(i)));
  const eu = await p.pedir('GET', '/painel/api/eu', { cookie: c.split(';')[0] });
  assert.equal(eu.estado, 200);
  assert.equal(eu.json.utilizador.papel, 'ceo');
});

test('entrar: palavra-passe errada, email desconhecido e dados em falta', async () => {
  const r1 = await entrar(ceo.email, 'errada-errada');
  const r2 = await entrar('ninguem@domus.teste', SENHA);
  assert.equal(r1.estado, 401);
  assert.equal(r2.estado, 401);
  assert.equal(r1.json.erro, r2.json.erro, 'mesma mensagem (não revela se o email existe)');
  assert.equal(r1.cabecalhos['set-cookie'], undefined);
  assert.equal((await entrar('', '')).estado, 400);
  assert.equal((await p.pedir('POST', '/painel/api/entrar', { corpo: { email: ceo.email, password: SENHA, x: 1 } })).estado, 400);
  assert.equal((await entrar(ceo.email.toUpperCase(), SENHA)).estado, 200, 'email sem distinção de maiúsculas');
});

test('sem sessão, cookie inventado ou mal formado → 401', async () => {
  assert.equal((await p.pedir('GET', '/painel/api/eu')).estado, 401);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: `domus_painel=${'A'.repeat(43)}` })).estado, 401);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: 'domus_painel=../../x' })).estado, 401);
});

test('sair: apaga a sessão no servidor e o cookie', async () => {
  const cookie = await p.entrar(ceo.email);
  const r = await p.pedir('POST', '/painel/api/sair', { corpo: {}, cookie });
  assert.equal(r.estado, 200);
  assert.match(r.cabecalhos['set-cookie'][0], /^domus_painel=; Path=\/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie })).estado, 401, 'o mesmo cookie deixa de servir');
});

test('sessão: expira ao fim de 12 h sem uso, renova-se com o uso, máximo 7 dias', async () => {
  const cookie = await p.entrar(ceo.email);
  p.relogio.avancar(11 * 3600_000);
  const r = await p.pedir('GET', '/painel/api/eu', { cookie });
  assert.equal(r.estado, 200);
  assert.match(r.cabecalhos['set-cookie'][0], /Max-Age=43200/, 'renovada: cookie reenviado');
  p.relogio.avancar(11 * 3600_000);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie })).estado, 200, '22 h depois, mas usada às 11 h');
  p.relogio.avancar(12 * 3600_000 + 1000);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie })).estado, 401, '12 h sem uso: expirada');
  // Máximo absoluto de 7 dias, mesmo com uso contínuo.
  const c2 = await p.entrar(ceo.email);
  for (let i = 0; i < 16; i++) {
    p.relogio.avancar(11 * 3600_000);
    await p.pedir('GET', '/painel/api/eu', { cookie: c2 });
  }
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: c2 })).estado, 401);
});

test('limite: 5 tentativas por minuto por IP (429 + Retry-After)', async () => {
  const ip = '192.0.2.10';
  for (let i = 0; i < 5; i++) assert.equal((await entrar(`x${i}@domus.teste`, 'errada-errada', { ip })).estado, 401);
  const r = await entrar(ceo.email, SENHA, { ip });
  assert.equal(r.estado, 429, 'mesmo com a palavra-passe certa');
  assert.ok(Number(r.cabecalhos['retry-after']) > 0);
  assert.equal((await entrar(ceo.email, SENHA, { ip: '192.0.2.11' })).estado, 200, 'outro IP não é afetado');
  p.relogio.avancar(61_000);
  assert.equal((await entrar(ceo.email, SENHA, { ip })).estado, 200, 'um minuto depois volta a poder');
});

test('limite: 5 tentativas por minuto por email (IPs diferentes)', async () => {
  const alvo = await p.criarUtilizador('comercial', 'alvo-limite@domus.teste');
  for (let i = 0; i < 5; i++) assert.equal((await entrar(alvo.email, 'errada-errada')).estado, 401);
  assert.equal((await entrar(alvo.email, SENHA)).estado, 429);
  p.relogio.avancar(61_000);
  assert.equal((await entrar(alvo.email, SENHA)).estado, 200);
});

test('bloqueio: 10 falhas seguidas bloqueiam 15 min (mesmo com a palavra-passe certa)', async () => {
  const alvo = await p.criarUtilizador('tecnico', 'alvo-bloqueio@domus.teste');
  for (let i = 0; i < 10; i++) {
    if (i === 5) p.relogio.avancar(61_000);       // não bater no limite por minuto
    assert.equal((await entrar(alvo.email, 'errada-errada')).estado, 401, `falha ${i + 1}`);
  }
  p.relogio.avancar(61_000);
  const r = await entrar(alvo.email, SENHA);
  assert.equal(r.estado, 429);
  assert.match(r.json.erro, /bloqueada/);
  assert.ok(Number(r.cabecalhos['retry-after']) > 800);
  p.relogio.avancar(15 * 60_000);
  assert.equal((await entrar(alvo.email, SENHA)).estado, 200, 'passado o bloqueio');
  // Um sucesso zera as falhas.
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM falhas_login WHERE email = ?').get(alvo.email).n, 0);
  // Auditoria do bloqueio.
  assert.ok(p.app.db.prepare('SELECT 1 FROM auditoria WHERE acao = \'conta_bloqueada\' AND alvo = ?').get(`utilizador:${alvo.id}`));
});

test('conta desativada: não entra e as sessões abertas terminam', async () => {
  const u = await p.criarUtilizador('comercial', 'desativar@domus.teste');
  const cookie = await p.entrar(u.email);
  const cCeo = await p.entrar(ceo.email);
  const r = await p.pedir('POST', `/painel/api/utilizadores/${u.id}`, { corpo: { ativo: false }, cookie: cCeo });
  assert.equal(r.estado, 200);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie })).estado, 401);
  assert.equal((await entrar(u.email, SENHA)).estado, 401);
});

test('CSRF: pedidos que alteram dados exigem Origin/Sec-Fetch-Site do site e JSON', async () => {
  const corpo = { email: ceo.email, password: SENHA };
  const casos = [
    [{}, 403, 'sem Origin nem Sec-Fetch-Site'],
    [{ Origin: 'https://mau.exemplo' }, 403, 'Origin de outro site'],
    [{ Origin: 'null' }, 403, 'Origin null'],
    [{ Origin: ORIGEM, 'Sec-Fetch-Site': 'cross-site' }, 403, 'Sec-Fetch-Site cross-site'],
    [{ 'Sec-Fetch-Site': 'same-site' }, 403, 'Sec-Fetch-Site same-site (subdomínio)'],
    [{ 'Sec-Fetch-Site': 'same-origin' }, 200, 'só Sec-Fetch-Site same-origin'],
    [{ Origin: ORIGEM }, 200, 'só Origin do site'],
  ];
  for (const [cab, esperado, desc] of casos) {
    const r = await p.pedir('POST', '/painel/api/entrar', { corpo, cabecalhos: cab, site: false });
    assert.equal(r.estado, esperado, desc);
  }
  for (const tipo of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
    const r = await p.pedir('POST', '/painel/api/entrar', { corpo: JSON.stringify(corpo), tipo });
    assert.equal(r.estado, 415, tipo);
  }
  // Numa rota com sessão: o cookie sozinho não chega.
  const cookie = await p.entrar(ceo.email);
  const r = await p.pedir('POST', '/painel/api/utilizadores', { corpo: { nome: 'X', email: 'csrf@domus.teste', papel: 'tecnico' }, cookie, site: false, cabecalhos: { Origin: 'https://mau.exemplo' } });
  assert.equal(r.estado, 403);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE email = ?').get('csrf@domus.teste').n, 0);
  const r2 = await p.pedir('POST', '/painel/api/utilizadores', { corpo: 'nome=X', tipo: 'application/x-www-form-urlencoded', cookie });
  assert.equal(r2.estado, 415);
});

test('entrar e sair ficam na auditoria (sem palavras-passe)', async () => {
  const linhas = p.app.db.prepare('SELECT * FROM auditoria WHERE acao IN (\'entrar\', \'sair\')').all();
  assert.ok(linhas.length > 3);
  assert.ok(linhas.every((l) => l.email && l.quando && l.ip));
  const tudo = JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all());
  assert.ok(!tudo.includes(SENHA));
});

test('primeiro arranque: PAINEL_CEO_EMAIL + PAINEL_CEO_PASS criam o CEO (só sem utilizadores)', async () => {
  const q = await iniciarPainel({ env: { PAINEL_CEO_EMAIL: 'Dona@Domus.teste', PAINEL_CEO_PASS: 'primeira-senha-ceo' } });
  try {
    const c = await q.entrar('dona@domus.teste', 'primeira-senha-ceo');
    assert.equal((await q.pedir('GET', '/painel/api/eu', { cookie: c })).json.utilizador.papel, 'ceo');
    assert.ok(q.app.db.prepare('SELECT 1 FROM auditoria WHERE acao = \'utilizador_criado\' AND alvo = \'utilizador:1\'').get());
  } finally {
    await q.fechar();
  }
  const r = await iniciarPainel({ env: { PAINEL_CEO_EMAIL: 'curta@domus.teste', PAINEL_CEO_PASS: 'curta' } });
  try {
    assert.equal(r.app.db.prepare('SELECT COUNT(*) AS n FROM utilizadores').get().n, 0, 'palavra-passe curta: ignorado');
  } finally {
    await r.fechar();
  }
});
