// Acesso rápido (testes, só no lançador local; src/acesso-rapido.js): desligado por omissão, desligado com
// qualquer sinal de servidor a sério (https, DOMUS_HOST, NODE_ENV=production…), rotas 404 quando desligado;
// ligado: só a partir deste computador (nunca pela rede local), com a Origin do site, e abre sessões normais.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarPainel, SENHA } from './ajuda.js';
import { lerConfig } from '../src/config.js';
import { recusaAcessoRapido, eLoopback, eLocalOuPrivado, EQUIPA_TESTE, CLIENTES_TESTE } from '../src/acesso-rapido.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOCAL = 'http://localhost:8080';
// O ambiente que o local/iniciar.js dá ao painel (o que interessa aqui).
const ENV_LOCAL = { ACESSO_RAPIDO: '1', EMAIL_LOCAL: '1', ANFITRIAO: '127.0.0.1', PAINEL_ORIGENS: `${LOCAL},http://192.168.1.20:8090,http://qa1.localhost:8080` };
// Um pedido deste computador: vem de 127.0.0.1 (X-Forwarded-For do lançador), com a Origin de localhost.
const DO_LOCAL = { cabecalhos: { Origin: LOCAL }, ip: '127.0.0.1' };

const paineis = [];
async function painel(env) {
  const p = await iniciarPainel({ env });
  paineis.push(p);
  return p;
}
after(async () => { for (const p of paineis) await p.fechar(); });

const equipa = (p, papel, opcoes = DO_LOCAL) => p.pedir('POST', '/painel/api/dev/entrar', { corpo: { papel }, ...opcoes });
const cliente = (p, n, opcoes = DO_LOCAL) => p.pedir('POST', '/api/conta/dev/entrar', { corpo: { n }, ...opcoes });
const cookieDe = (r) => r.cabecalhos['set-cookie'][0].split(';')[0];

async function rotasNaoExistem(p) {
  for (const opcoes of [{}, DO_LOCAL]) {
    assert.equal((await equipa(p, 'ceo', opcoes)).estado, 404);
    assert.equal((await cliente(p, 1, opcoes)).estado, 404);
    assert.equal((await p.pedir('GET', '/painel/api/dev/entrar', opcoes)).estado, 404);
    assert.equal((await p.pedir('GET', '/api/conta/dev/entrar', opcoes)).estado, 404);
  }
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM utilizadores WHERE email LIKE '%.teste@domus.localhost'").get().n, 0);
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM contas WHERE email LIKE '%.teste@exemplo.pt'").get().n, 0);
}

test('desligado por omissão: sem ACESSO_RAPIDO as rotas não existem (404), mesmo num ambiente local', async () => {
  const p = await painel();
  assert.equal(p.config.acessoRapido, false);
  assert.deepEqual(p.config.erros, []);
  await rotasNaoExistem(p);
  const { ACESSO_RAPIDO: _, ...semVariavel } = ENV_LOCAL;
  const q = await painel(semVariavel);
  assert.equal(q.config.acessoRapido, false);
  await rotasNaoExistem(q);
  // Só "1" liga.
  for (const v of ['0', '', 'true', 'sim']) assert.equal(lerConfig({ ...ENV_LOCAL, ACESSO_RAPIDO: v }).acessoRapido, false, `ACESSO_RAPIDO=${v}`);
});

test('ACESSO_RAPIDO=1 com origens https://: erro no arranque, fica desligado e as rotas dão 404', async () => {
  const p = await painel({ ...ENV_LOCAL, PAINEL_ORIGENS: 'https://painel.teste' });
  assert.equal(p.config.acessoRapido, false);
  assert.equal(p.config.erros.length, 1);
  assert.match(p.config.erros[0], /ACESSO_RAPIDO=1 IGNORADO.*https:\/\/painel\.teste.*DESLIGADO/);
  await rotasNaoExistem(p);
  // Uma só origem https entre as locais chega para desligar.
  const q = await painel({ ...ENV_LOCAL, PAINEL_ORIGENS: `${LOCAL},https://domusenergia.pt` });
  assert.equal(q.config.acessoRapido, false);
  await rotasNaoExistem(q);
});

test('qualquer sinal de servidor a sério desliga (NODE_ENV, DOMUS_HOST, EMAIL_LOCAL, ANFITRIAO, origens)', () => {
  assert.equal(recusaAcessoRapido(ENV_LOCAL), null);
  assert.equal(lerConfig(ENV_LOCAL).acessoRapido, true);
  const recusados = {
    'NODE_ENV=production': { NODE_ENV: 'production' },
    DOMUS_HOST: { DOMUS_HOST: 'domusenergia.pt' },
    'sem EMAIL_LOCAL': { EMAIL_LOCAL: '' },
    'sem ANFITRIAO (todas as interfaces, como no Docker)': { ANFITRIAO: '' },
    'ANFITRIAO 0.0.0.0': { ANFITRIAO: '0.0.0.0' },
    'sem origens': { PAINEL_ORIGENS: '' },
    'origem http pública': { PAINEL_ORIGENS: 'http://domusenergia.pt' },
    'origem http de IP público': { PAINEL_ORIGENS: `${LOCAL},http://8.8.8.8:8090` },
    'SITE_ORIGENS https': { SITE_ORIGENS: 'https://domusenergia.pt' },
    'PUBLIC_URL https': { PUBLIC_URL: 'https://api.domusenergia.pt' },
    'SITE_URL https': { SITE_URL: 'https://domusenergia.pt' },
    'origem inválida': { PAINEL_ORIGENS: `${LOCAL},lixo` },
  };
  for (const [nome, extra] of Object.entries(recusados)) {
    const env = { ...ENV_LOCAL, ...extra };
    assert.equal(typeof recusaAcessoRapido(env), 'string', nome);
    const c = lerConfig(env);
    assert.equal(c.acessoRapido, false, nome);
    assert.equal(c.erros.length, 1, nome);
  }
  for (const ip of ['127.0.0.1', '127.8.9.1', '::1', '::ffff:127.0.0.1']) assert.equal(eLoopback(ip), true, ip);
  for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '::ffff:192.168.1.20', 'fd00::1']) {
    assert.equal(eLoopback(ip), false, ip);
    assert.equal(eLocalOuPrivado(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '193.136.1.1', '2001:db8::1', '', '?', 'localhost', undefined]) assert.equal(eLocalOuPrivado(ip), false, String(ip));
});

test('o servidor a sério nunca põe a variável (docker-compose.yml, .env.example, instalar.sh)', async () => {
  for (const f of ['docker-compose.yml', '.env.example', 'instalar.sh', 'domus.sh']) {
    const texto = await readFile(join(AQUI, '..', '..', 'servidor', f), 'utf8');
    assert.equal(/ACESSO_RAPIDO/i.test(texto), false, f);
  }
  // E o painel no Docker corre com NODE_ENV=production (um dos sinais que o desligam).
  assert.match(await readFile(join(AQUI, '..', 'Dockerfile'), 'utf8'), /ENV NODE_ENV=production/);
});

test('ligado (ambiente do lançador local): equipa de teste, sessão normal por papel, sem palavra-passe à vista', async () => {
  const p = await painel(ENV_LOCAL);
  assert.equal(p.config.acessoRapido, true);
  assert.deepEqual(p.config.erros, []);
  for (const papel of Object.keys(EQUIPA_TESTE)) {
    const r = await equipa(p, papel);
    assert.equal(r.estado, 200, papel);
    assert.deepEqual(Object.keys(r.json), ['utilizador']);
    assert.deepEqual(Object.keys(r.json.utilizador).sort(), ['email', 'id', 'nome', 'papel']);
    assert.equal(r.json.utilizador.email, EQUIPA_TESTE[papel].email);
    assert.match(r.cabecalhos['set-cookie'][0], /^domus_painel=[A-Za-z0-9_-]{43}; Path=\/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    const eu = await p.pedir('GET', '/painel/api/eu', { cookie: cookieDe(r) });
    assert.equal(eu.estado, 200);
    assert.equal(eu.json.utilizador.papel, papel);
    // A autorização é a de sempre: só o CEO vê a equipa.
    assert.equal((await p.pedir('GET', '/painel/api/utilizadores', { cookie: cookieDe(r) })).estado, papel === 'ceo' ? 200 : 403);
  }
  // Segunda vez: o mesmo utilizador (não cria outro).
  const outra = await equipa(p, 'ceo');
  assert.equal(outra.estado, 200);
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM utilizadores WHERE email LIKE '%.teste@domus.localhost'").get().n, 3);
  // A entrada normal continua a funcionar e a palavra-passe aleatória não serve a ninguém.
  await p.criarUtilizador('ceo', 'ceo@domus.teste');
  assert.match(await p.entrar('ceo@domus.teste', SENHA, DO_LOCAL), /^domus_painel=/);
  assert.equal((await p.pedir('POST', '/painel/api/entrar', { corpo: { email: EQUIPA_TESTE.ceo.email, password: SENHA }, ...DO_LOCAL })).estado, 401);
  // Auditoria: fica escrito que foi pelo acesso rápido.
  const linhas = p.app.db.prepare("SELECT acao, detalhes FROM auditoria WHERE detalhes LIKE '%acesso_rapido%'").all();
  assert.ok(linhas.some((l) => l.acao === 'utilizador_criado') && linhas.some((l) => l.acao === 'entrar'));
  // Papéis que não existem, campos a mais, utilizador desativado.
  for (const papel of ['admin', '', 'constructor', '__proto__', 1, null]) assert.equal((await equipa(p, papel)).estado, 400, String(papel));
  assert.equal((await p.pedir('POST', '/painel/api/dev/entrar', { corpo: { papel: 'ceo', email: 'x@y.pt' }, ...DO_LOCAL })).estado, 400);
  p.app.db.prepare('UPDATE utilizadores SET ativo = 0 WHERE email = ?').run(EQUIPA_TESTE.tecnico.email);
  assert.equal((await equipa(p, 'tecnico')).estado, 409);
});

test('ligado: clientes de teste 1 e 2, conta confirmada e sessão aberta sem email com código', async () => {
  const p = await painel(ENV_LOCAL);
  for (const n of [1, 2]) {
    const r = await cliente(p, n);
    assert.equal(r.estado, 200);
    assert.equal(r.json.conta.email, CLIENTES_TESTE[n]);
    assert.equal(r.json.conta.confirmado, true);
    assert.equal(r.json.conta.tem_password, false);
    assert.match(r.cabecalhos['set-cookie'][0], /^domus_conta=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const eu = await p.pedir('GET', '/api/conta/eu', { cookie: cookieDe(r) });
    assert.equal(eu.estado, 200);
    assert.equal(eu.json.conta.email, CLIENTES_TESTE[n]);
    assert.equal((await p.pedir('GET', '/api/conta/pedidos', { cookie: cookieDe(r) })).estado, 200);
    // A sessão da conta não abre o painel.
    assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: cookieDe(r) })).estado, 401);
  }
  assert.equal((await cliente(p, 1)).estado, 200);
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM contas WHERE email LIKE '%.teste@exemplo.pt'").get().n, 2);
  assert.equal(p.emails.length, 0, 'nenhum email');
  for (const n of [0, 3, '1', 1.5, null, 'constructor']) assert.equal((await cliente(p, n)).estado, 400, String(n));
  // Uma conta de teste criada pelo caminho normal e ainda por confirmar fica confirmada ao entrar por aqui.
  p.app.db.prepare('UPDATE contas SET confirmado = NULL WHERE email = ?').run(CLIENTES_TESTE[2]);
  assert.equal((await cliente(p, 2)).json.conta.confirmado, true);
  p.app.db.prepare('UPDATE contas SET ativo = 0 WHERE email = ?').run(CLIENTES_TESTE[2]);
  assert.equal((await cliente(p, 2)).estado, 409);
});

test('ligado: só deste computador (pela rede local ou de fora 404), com a Origin do site, por POST JSON', async () => {
  const p = await painel(ENV_LOCAL);
  const REDE = 'http://192.168.1.20:8090';   // está nas origens do painel (QR das fotos), mas o acesso rápido não a aceita
  const recusados = {
    'IP de fora': { ...DO_LOCAL, ip: '8.8.8.8' },
    'IP de fora (IPv6)': { ...DO_LOCAL, ip: '2001:db8::1' },
    'IP inválido': { ...DO_LOCAL, ip: 'lixo' },
    'IP da rede local': { ...DO_LOCAL, ip: '192.168.1.77' },
    'IP privado': { ...DO_LOCAL, ip: '10.1.2.3' },
    'telemóvel pelo ouvinte da rede local': { cabecalhos: { Origin: REDE, Host: '192.168.1.20:8090' }, ip: '192.168.1.77' },
    'o próprio computador pelo endereço da rede local': { cabecalhos: { Origin: REDE, Host: '192.168.1.20:8090' }, ip: '192.168.1.20' },
    'Host da rede local': { cabecalhos: { Origin: LOCAL, Host: '192.168.1.20:8090' }, ip: '127.0.0.1' },
    'Origin da rede local': { cabecalhos: { Origin: REDE }, ip: '127.0.0.1' },
    'Origin https': { cabecalhos: { Origin: 'https://painel.teste' }, ip: '127.0.0.1' },
    'Origin de outro site': { cabecalhos: { Origin: 'http://mau.exemplo:8080' }, ip: '127.0.0.1' },
    'sem Origin': { site: false, ip: '127.0.0.1' },
  };
  for (const [nome, opcoes] of Object.entries(recusados)) {
    assert.equal((await equipa(p, 'ceo', opcoes)).estado, 404, nome);
    assert.equal((await cliente(p, 1, opcoes)).estado, 404, nome);
  }
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal((await equipa(p, 'comercial', { ...DO_LOCAL, ip })).estado, 200, ip);
  // Outra origem de testes deste computador (ORIGENS_EXTRA do lançador).
  assert.equal((await equipa(p, 'comercial', { cabecalhos: { Origin: 'http://qa1.localhost:8080', Host: 'qa1.localhost:8080' }, ip: '127.0.0.1' })).estado, 200);
  // O cookie é o de sempre (com Secure: o navegador aceita-o em localhost).
  assert.match((await equipa(p, 'ceo')).cabecalhos['set-cookie'][0], /; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  // CSRF: uma origem deste computador que não é a do site é recusada, como nos outros POST.
  assert.equal((await equipa(p, 'ceo', { cabecalhos: { Origin: 'http://outro.localhost:9999' }, ip: '127.0.0.1' })).estado, 403);
  assert.equal((await cliente(p, 1, { cabecalhos: { Origin: LOCAL, 'Sec-Fetch-Site': 'cross-site' }, ip: '127.0.0.1' })).estado, 403);
  assert.equal((await p.pedir('POST', '/painel/api/dev/entrar', { corpo: 'papel=ceo', tipo: 'application/x-www-form-urlencoded', ...DO_LOCAL })).estado, 415);
  assert.equal((await p.pedir('GET', '/painel/api/dev/entrar', DO_LOCAL)).estado, 405);
  assert.equal((await p.pedir('GET', '/api/conta/dev/entrar', DO_LOCAL)).estado, 405);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas').get().n, 0);
});
