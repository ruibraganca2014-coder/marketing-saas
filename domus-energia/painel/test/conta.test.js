// Conta de cliente (/api/conta/*, docs/CONTA-CLIENTE.md): criar só com o email, código (certo/errado/expirado/limite),
// entrar com código, palavra-passe opcional, entrar/sair, esqueci/repor, sessão obrigatória no POST /api/orcamento com simulação, acesso cruzado negado,
// fotos na conta, guardar/retomar a simulação, aceitar a proposta (+409), apagar a conta (CEO), CORS e origens
// do site público (SITE_ORIGENS) e as credenciais MQTT da casa só para a conta dona.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir } from 'node:fs/promises';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { painelComEquipa, iniciarPainel, SENHA, esperar } from './ajuda.js';
import { CODIGO_MS } from '../src/conta.js';

const SIM = { versao: 1, casa: { tipo: 'moradia', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1 }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 1 }], total: { min: 900, max: 1200 }, plano_sugerido: 'conforto', quadro: { pacote: 'recomendado', circuitos: [{ codigo: 'C1' }] } };
const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const ck = (r) => r.cabecalhos['set-cookie']?.[0]?.split(';')[0];

describe('conta de cliente', () => {
  let p;
  let n = 0;
  const email = () => `pessoa${++n}@exemplo.pt`;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  const conta = (metodo, caminho, opcoes = {}) => p.pedir(metodo, `/api/conta/${caminho}`, opcoes);
  const painel = (metodo, caminho, papel, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  async function pedidoComConta(c, extra = {}) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1', simulacao: SIM, ...extra } });
    assert.equal(r.estado, 201, r.texto);
    return { id: p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id, token: r.json.fotos_token };
  }

  /** Sessão de uma conta por confirmar como as que se abriam antes (criar abria logo a sessão). */
  function sessaoAntiga(e) {
    const token = randomBytes(32).toString('base64url');
    const id = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(e).id;
    const agora = p.relogio.agora();
    p.app.db.prepare('INSERT INTO contas_sessoes (id, conta_id, criada, expira, renovada) VALUES (?, ?, ?, ?, ?)')
      .run(createHash('sha256').update(token).digest('hex'), id, agora, agora + 3600_000, agora);
    return `domus_conta=${token}`;
  }

  test('criar (só o email): sempre a mesma resposta (201, sem sessão), código por email (fora do assunto); email com conta → código para entrar; validações', async () => {
    const e = email();
    const r = await conta('POST', 'criar', { corpo: { email: e } });
    assert.equal(r.estado, 201, r.texto);
    assert.equal(r.cabecalhos['set-cookie'], undefined, 'a sessão só abre ao confirmar o código');
    assert.equal(r.json.email, e);
    assert.match(r.json.mensagem, /Enviámos um código/);
    assert.match(p.codigo(e), /^\d{6}$/);
    assert.doesNotMatch(p.emails.at(-1).assunto, /\d{6}/, 'o código não vai no assunto');
    assert.match(p.emails.at(-1).texto, /confirmar o seu email/);
    assert.equal(p.app.db.prepare('SELECT hash FROM contas WHERE email = ?').get(e).hash, null, 'sem palavra-passe');
    // Email que já tem conta (confirmada): a mesma resposta; vai um código para entrar (quem tem o email tem a conta).
    const { email: ja } = await p.contaConfirmada(email());
    const antes = p.emails.length;
    const dup = await conta('POST', 'criar', { corpo: { email: ja.toUpperCase() } });
    assert.equal(dup.estado, 201);
    assert.equal(dup.cabecalhos['set-cookie'], undefined);
    assert.deepEqual({ ...dup.json, email: 'x' }, { ...r.json, email: 'x' });
    assert.equal(p.emails.length, antes + 1);
    assert.match(p.emails.at(-1).texto, /entrar na sua conta/);
    assert.match(p.codigo(ja), /^\d{6}$/);
    // Conta por confirmar (voltou mais tarde): recebe um código de confirmar novo.
    const n0 = p.emails.length;
    assert.equal((await conta('POST', 'criar', { corpo: { email: e } })).estado, 201);
    assert.equal(p.emails.length, n0 + 1);
    assert.match(p.emails.at(-1).texto, /confirmar o seu email/);
    assert.equal((await conta('POST', 'criar', { corpo: { email: 'nao-e-email' } })).estado, 400);
    assert.equal((await conta('POST', 'criar', { corpo: { email: email(), password: SENHA } })).estado, 400, 'já não leva palavra-passe');
    assert.equal((await conta('POST', 'criar', { corpo: { email: email(), extra: 1 } })).estado, 400);
  });

  test('confirmar sem sessão (email, código): erro sempre igual; abre a sessão (cookie próprio); 5 erradas gastam o código; conta sem palavra-passe', async () => {
    const e = email();
    await conta('POST', 'criar', { corpo: { email: e } });
    const certo = p.codigo(e);
    const errado = certo === '000000' ? '111111' : '000000';
    const ip = '198.51.100.40';
    const conf = (corpo, extra = {}) => conta('POST', 'confirmar', { corpo, ip, ...extra });
    const e1 = await conf({ email: e, codigo: errado });
    const nada = await conf({ email: 'nao-existe@exemplo.pt', codigo: errado });
    assert.equal(e1.estado, 400);
    assert.deepEqual(e1.json, nada.json, 'a mesma resposta exista ou não a conta');
    assert.equal((await conf({ email: e, codigo: '12' })).estado, 400);
    assert.equal((await conf({ email: e, codigo: certo, password: SENHA })).estado, 400, 'sem palavra-passe no corpo');
    // Expirado: a mesma resposta.
    p.relogio.avancar(CODIGO_MS + 1000);
    const exp = await conf({ email: e, codigo: certo });
    assert.deepEqual([exp.estado, exp.json], [400, nada.json]);
    // Código novo; 5 erradas gastam-no (mesmo o certo deixa de servir), sempre com a mesma resposta.
    await conta('POST', 'criar', { corpo: { email: e } });
    const novo = p.codigo(e);
    const mau = novo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.deepEqual((await conf({ email: e, codigo: mau })).json, nada.json);
    assert.deepEqual((await conf({ email: e, codigo: novo })).json, nada.json);
    // Outro código → confirma e abre a sessão (conta sem palavra-passe).
    await conta('POST', 'criar', { corpo: { email: e } });
    const ok = await conf({ email: e, codigo: p.codigo(e) });
    assert.equal(ok.estado, 200, ok.texto);
    assert.deepEqual(ok.json.conta, { email: e, confirmado: true, tem_password: false, nome: null, telefone: null, morada: null, localidade: null });
    const c = ok.cabecalhos['set-cookie'][0];
    assert.match(c, /^domus_conta=[A-Za-z0-9_-]{43};/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Path=\/api;/);
    assert.doesNotMatch(c, /Secure/, 'http://127.0.0.1: sem Secure');
    const eu = await conta('GET', 'eu', { cookie: ck(ok) });
    assert.equal(eu.estado, 200);
    assert.equal(eu.json.conta.tem_password, false);
    // O código já foi usado: não serve de novo (mesma resposta). Sem palavra-passe, "entrar" não entra.
    assert.deepEqual((await conf({ email: e, codigo: p.codigo(e) })).json, nada.json);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 401);
    // Fora de localhost o cookie leva Secure (entrar com código; uma hora depois: a quota de 3 emails/hora já foi gasta).
    p.relogio.avancar(3600_000 + 1000);
    await conta('POST', 'codigo', { corpo: { email: e } });
    const s = await conf({ email: e, codigo: p.codigo(e) }, { cabecalhos: { Host: 'api.domusenergia.pt' } });
    assert.equal(s.estado, 200, s.texto);
    assert.match(s.cabecalhos['set-cookie'][0], /Secure/);
  });

  test('entrar com código (conta já existente): POST codigo responde igual com e sem conta; o código entra e é de uso único; limites (10/h por IP, 3 emails/h)', async () => {
    const { email: e } = await p.contaConfirmada(email(), null);
    const antes = p.emails.length;
    const ip = '198.51.100.41';
    const a = await conta('POST', 'codigo', { corpo: { email: e }, ip });
    const b = await conta('POST', 'codigo', { corpo: { email: 'nao-existe@exemplo.pt' }, ip });
    assert.equal(a.estado, 200, a.texto);
    assert.deepEqual({ ...a.json, email: 'x' }, { ...b.json, email: 'x' });
    assert.equal(p.emails.length, antes + 1, 'só um email (o da conta que existe)');
    assert.match(p.emails.at(-1).assunto, /entrar/);
    assert.doesNotMatch(p.emails.at(-1).assunto, /\d{6}/);
    const codigo = p.codigo(e);
    const ok = await conta('POST', 'confirmar', { corpo: { email: e, codigo }, ip });
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.conta.tem_password, false);
    assert.equal((await conta('GET', 'eu', { cookie: ck(ok) })).estado, 200);
    assert.equal((await conta('POST', 'confirmar', { corpo: { email: e, codigo }, ip })).estado, 400, 'uso único');
    assert.equal(p.app.db.prepare('SELECT acao FROM auditoria WHERE alvo = ? ORDER BY id DESC LIMIT 1').get(`conta:${p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(e).id}`).acao, 'conta_entrou_codigo');
    // Quota de emails: o de criar e 3 de "codigo"/"criar" por hora por email; acima, em silêncio (mesma resposta).
    assert.equal((await conta('POST', 'codigo', { corpo: { email: e }, ip: '198.51.100.42' })).estado, 200);
    assert.equal(p.emails.length, antes + 2, '3.º email da hora (o 1.º foi o de criar)');
    assert.equal((await conta('POST', 'criar', { corpo: { email: e }, ip: '198.51.100.43' })).estado, 201);
    assert.equal((await conta('POST', 'codigo', { corpo: { email: e }, ip: '198.51.100.44' })).estado, 200);
    assert.equal(p.emails.length, antes + 2, 'acima de 3/hora, em silêncio');
    // Por IP: 10 pedidos de código por hora.
    const ip2 = '198.51.100.45';
    for (let i = 0; i < 10; i++) assert.equal((await conta('POST', 'codigo', { corpo: { email: `x${i}@exemplo.pt` }, ip: ip2 })).estado, 200);
    const lim = await conta('POST', 'codigo', { corpo: { email: 'x@exemplo.pt' }, ip: ip2 });
    assert.equal(lim.estado, 429);
    assert.ok(Number(lim.cabecalhos['retry-after']) > 0);
    assert.equal((await conta('POST', 'codigo', { corpo: { email: 'nao-e-email' }, ip: '198.51.100.46' })).estado, 400);
  });

  test('definir a palavra-passe (com sessão e email confirmado): regras do painel; dá o "entrar" com palavra-passe; o código continua a entrar', async () => {
    const { cookie, email: e } = await p.contaConfirmada(email(), null);
    assert.equal((await conta('POST', 'palavra-passe', { corpo: { password: SENHA } })).estado, 401, 'sem sessão');
    assert.equal((await conta('POST', 'palavra-passe', { cookie, corpo: { password: 'curta' } })).estado, 400);
    assert.equal((await conta('POST', 'palavra-passe', { cookie, corpo: { password: SENHA, extra: 1 } })).estado, 400);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 401, 'ainda sem palavra-passe');
    const r = await conta('POST', 'palavra-passe', { cookie, corpo: { password: SENHA } });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.conta.tem_password, true);
    assert.equal((await conta('GET', 'eu', { cookie })).json.conta.tem_password, true);
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 200, 'a sessão continua');
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 200);
    // Mudar: a nova vale, a antiga não.
    assert.equal((await conta('POST', 'palavra-passe', { cookie, corpo: { password: 'outra-palavra-passe-2' } })).estado, 200);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: 'outra-palavra-passe-2' } })).estado, 200);
    // O código continua a entrar.
    await conta('POST', 'codigo', { corpo: { email: e }, ip: '198.51.100.47' });
    assert.equal((await conta('POST', 'confirmar', { corpo: { email: e, codigo: p.codigo(e) }, ip: '198.51.100.47' })).estado, 200);
    // Conta por confirmar (sessão antiga): 403.
    const e2 = email();
    await conta('POST', 'criar', { corpo: { email: e2 } });
    assert.equal((await conta('POST', 'palavra-passe', { cookie: sessaoAntiga(e2), corpo: { password: SENHA } })).estado, 403);
  });

  test('sessão de conta por confirmar (aberta antes desta versão): código com mensagens detalhadas; reenviar 3/hora', async () => {
    const e = email();
    await conta('POST', 'criar', { corpo: { email: e } });
    const cookie = sessaoAntiga(e);
    const certo = p.codigo(e);
    const errado = certo === '000000' ? '111111' : '000000';
    const e1 = await conta('POST', 'confirmar', { cookie, corpo: { codigo: errado } });
    assert.equal(e1.estado, 400);
    assert.match(e1.json.erro, /Restam 4/);
    p.relogio.avancar(CODIGO_MS + 1000);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: certo } })).estado, 410);
    assert.equal((await conta('POST', 'reenviar', { cookie, corpo: {} })).estado, 200);
    const novo = p.codigo(e);
    const mau = novo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: mau } })).estado, 400);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: mau } })).estado, 429);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: novo } })).estado, 429);
    assert.equal((await conta('POST', 'reenviar', { cookie, corpo: {} })).estado, 200);
    const ok = await conta('POST', 'confirmar', { cookie, corpo: { codigo: p.codigo(e) } });
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.conta.confirmado, true);
    // Reenviar: 3 por hora por email (o de criar conta também conta).
    const e2 = email();
    await conta('POST', 'criar', { corpo: { email: e2 } });
    const c2 = sessaoAntiga(e2);
    assert.equal((await conta('POST', 'reenviar', { cookie: c2, corpo: {} })).estado, 200);
    assert.equal((await conta('POST', 'reenviar', { cookie: c2, corpo: {} })).estado, 200);
    const lim = await conta('POST', 'reenviar', { cookie: c2, corpo: {} });
    assert.equal(lim.estado, 429);
    assert.ok(Number(lim.cabecalhos['retry-after']) > 0);
  });

  test('entrar/sair: mesma mensagem para tudo (incl. conta por confirmar); sair invalida a sessão; terceiros não bloqueiam a conta', async () => {
    const { cookie, email: e } = await p.contaConfirmada(email());
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 200);
    const mal = await conta('POST', 'entrar', { corpo: { email: e, password: 'errada-errada' } });
    const nada = await conta('POST', 'entrar', { corpo: { email: 'ninguem@exemplo.pt', password: 'errada-errada' } });
    const porConfirmar = email();
    await conta('POST', 'criar', { corpo: { email: porConfirmar } });
    const pc = await conta('POST', 'entrar', { corpo: { email: porConfirmar, password: SENHA } });
    assert.equal(mal.estado, 401);
    assert.equal(nada.estado, 401);
    assert.equal(pc.estado, 401, 'conta por confirmar (e sem palavra-passe) entra ao confirmar o código');
    assert.equal(mal.json.erro, nada.json.erro);
    assert.equal(pc.json.erro, nada.json.erro);
    const ok = await conta('POST', 'entrar', { corpo: { email: e.toUpperCase(), password: SENHA } });
    assert.equal(ok.estado, 200);
    const c2 = ck(ok);
    assert.equal((await conta('POST', 'sair', { cookie: c2, corpo: {} })).estado, 200);
    assert.equal((await conta('GET', 'eu', { cookie: c2 })).estado, 401);
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 200, 'a outra sessão continua');
    // De IPs diferentes, 20 falhas seguidas não bloqueiam a conta: a pessoa entra.
    for (let i = 0; i < 20; i++) assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: 'errada-errada' } })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 200);
    // Do mesmo IP: atraso progressivo curto a partir da 3.ª falha seguida (1 s, 2 s, …).
    const ip = '198.51.100.7';
    const errar = () => conta('POST', 'entrar', { corpo: { email: e, password: 'errada-errada' }, ip });
    for (let i = 0; i < 3; i++) assert.equal((await errar()).estado, 401);
    const a1 = await errar();
    assert.equal(a1.estado, 429);
    assert.equal(a1.cabecalhos['retry-after'], '1');
    p.relogio.avancar(1100);
    assert.equal((await errar()).estado, 401);
    assert.equal((await errar()).cabecalhos['retry-after'], '2');
    p.relogio.avancar(2100);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA }, ip })).estado, 200);
    assert.equal((await errar()).estado, 429, 'limite do par email+IP: 5 por minuto');
    p.relogio.avancar(61_000);
    assert.equal((await errar()).estado, 401, 'depois de entrar o atraso recomeça do zero');
    // Travão por email: 50 tentativas por hora (de quaisquer IPs).
    const e3 = email();
    for (let i = 0; i < 50; i++) assert.equal((await conta('POST', 'entrar', { corpo: { email: e3, password: 'errada-errada' } })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e3, password: 'errada-errada' } })).estado, 429);
    // Sem Origin do site: recusado (CSRF)
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA }, site: false, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
  });

  test('esqueci: mesma resposta com e sem conta; repor indistinguível (também com o código gasto); muda a palavra-passe e fecha as sessões', async () => {
    const { cookie, email: e } = await p.contaConfirmada(email());
    const antes = p.emails.length;
    const a = await conta('POST', 'esqueci', { corpo: { email: e } });
    const b = await conta('POST', 'esqueci', { corpo: { email: 'nao-existe@exemplo.pt' } });
    assert.equal(a.estado, 200);
    assert.deepEqual(a.json, b.json);
    assert.equal(p.emails.length, antes + 1, 'só um email (o da conta que existe)');
    assert.doesNotMatch(p.emails.at(-1).assunto, /\d{6}/, 'o código não vai no assunto');
    const codigo = p.codigo(e);
    const nova = 'palavra-passe-nova-1';
    const mau = codigo === '000000' ? '111111' : '000000';
    const inexistente = await conta('POST', 'repor', { corpo: { email: 'nao-existe@exemplo.pt', codigo, password: nova } });
    assert.equal(inexistente.estado, 400);
    // 6 erradas: sempre a mesma resposta que para um email sem conta (nunca "429 demasiadas tentativas").
    for (let i = 0; i < 6; i++) {
      const r = await conta('POST', 'repor', { corpo: { email: e, codigo: mau, password: nova } });
      assert.deepEqual([r.estado, r.json], [inexistente.estado, inexistente.json]);
    }
    // …mas o código ficou gasto ao fim de 5.
    assert.deepEqual((await conta('POST', 'repor', { corpo: { email: e, codigo, password: nova } })).json, inexistente.json);
    await conta('POST', 'esqueci', { corpo: { email: e } });
    const codigo2 = p.codigo(e);
    const r = await conta('POST', 'repor', { corpo: { email: e, codigo: codigo2, password: nova } });
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 401, 'sessões antigas fechadas');
    assert.equal((await conta('GET', 'eu', { cookie: ck(r) })).estado, 200);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: nova } })).estado, 200);
    // O código é de uso único.
    assert.equal((await conta('POST', 'repor', { corpo: { email: e, codigo: codigo2, password: 'outra-palavra-1' } })).estado, 400);
    // Limite por email (10/hora), igual com e sem conta; e por IP (20/hora).
    const { email: f } = await p.contaConfirmada(email());
    for (const x of [f, 'tambem-nao-existe@exemplo.pt']) {
      for (let i = 0; i < 10; i++) assert.equal((await conta('POST', 'repor', { corpo: { email: x, codigo: '123456', password: nova } })).estado, 400);
      assert.equal((await conta('POST', 'repor', { corpo: { email: x, codigo: '123456', password: nova } })).estado, 429, x);
    }
    const ip = '198.51.100.20';
    for (let i = 0; i < 20; i++) await conta('POST', 'repor', { corpo: { email: `ip${i}@exemplo.pt`, codigo: '123456', password: nova }, ip });
    assert.equal((await conta('POST', 'repor', { corpo: { email: 'ip-fim@exemplo.pt', codigo: '123456', password: nova }, ip })).estado, 429);
  });

  test('criar com o email de outra pessoa: no máximo 3 códigos por hora (com o de criar) e não gasta a quota do "Esqueci"', async () => {
    const { email: e } = await p.contaConfirmada(email());
    const antes = p.emails.length;
    // Mais 2 "criar" (o 1.º foi o da própria conta: 3/hora por email) de IPs diferentes: chegam 2 códigos para entrar; um
    // 3.º "codigo" fica em silêncio (quota dos emails) — o "criar" tem o seu limite (3/hora por email: 429).
    for (let i = 1; i <= 2; i++) {
      assert.equal((await conta('POST', 'criar', { corpo: { email: e }, ip: `203.0.113.${i}` })).estado, 201);
    }
    assert.equal((await conta('POST', 'codigo', { corpo: { email: e }, ip: '203.0.113.3' })).estado, 200);
    assert.equal(p.emails.length, antes + 2, '3 códigos por hora por email, em silêncio acima');
    assert.equal((await conta('POST', 'criar', { corpo: { email: e }, ip: '203.0.113.4' })).estado, 429, 'criar: 3 por hora por email');
    assert.match(p.emails.at(-1).texto, /entrar na sua conta/);
    // O dono da conta continua a conseguir repor a palavra-passe (3 códigos por hora, quota própria).
    for (let i = 1; i <= 3; i++) {
      assert.equal((await conta('POST', 'esqueci', { corpo: { email: e }, ip: `203.0.113.${10 + i}` })).estado, 200);
      assert.equal(p.emails.length, antes + 2 + i, `código de repor n.º ${i}`);
      assert.match(p.codigo(e), /^\d{6}$/);
    }
    assert.equal((await conta('POST', 'esqueci', { corpo: { email: e }, ip: '203.0.113.20' })).estado, 200);
    assert.equal(p.emails.length, antes + 5, 'acima de 3/hora, em silêncio');
  });

  test('POST /api/orcamento: com simulação exige sessão com email confirmado; pedido ligado à conta; sem simulação não', async () => {
    const corpo = { nome: 'Sem Conta', telefone: '912 000 222', servico: 'Casa inteligente', simulacao: SIM };
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo })).estado, 401);
    const e = email();
    await conta('POST', 'criar', { corpo: { email: e } });
    const antiga = sessaoAntiga(e);
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo, cookie: antiga })).estado, 403, 'email por confirmar');
    // Guarda a simulação em curso (é apagada depois de enviar).
    assert.equal((await conta('POST', 'simulacao', { cookie: antiga, corpo: { estado: { versao: 5, passo: 6 } } })).estado, 200);
    const nc = ck(await conta('POST', 'confirmar', { corpo: { email: e, codigo: p.codigo(e) } }));
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { ...corpo, email: 'outro@exemplo.pt', morada: 'Rua B, 2', localidade: 'Évora' }, cookie: nc });
    assert.equal(r.estado, 201, r.texto);
    assert.ok(r.json.fotos_token);
    const o = p.app.db.prepare('SELECT * FROM orcamentos ORDER BY id DESC LIMIT 1').get();
    assert.equal(o.email, e, 'o email do pedido é o da conta');
    assert.ok(o.conta_id);
    const eu = (await conta('GET', 'eu', { cookie: nc })).json;
    assert.equal(eu.conta.nome, 'Sem Conta');
    assert.equal(eu.conta.morada, 'Rua B, 2');
    assert.equal(eu.conta.localidade, 'Évora');
    assert.equal(eu.simulacao_atualizada, null, 'simulação em curso apagada');
    // Formulário do site (sem simulação): continua sem conta.
    const f = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Formulário', telefone: '912 000 333', servico: 'Casa inteligente' } });
    assert.equal(f.estado, 201);
    assert.equal(p.app.db.prepare('SELECT conta_id FROM orcamentos ORDER BY id DESC LIMIT 1').get().conta_id, null);
    // O painel mostra a conta do pedido.
    const d = (await painel('GET', `orcamentos/${o.id}`, 'comercial')).json;
    assert.deepEqual({ email: d.conta.email, confirmado: d.conta.confirmado }, { email: e, confirmado: true });
    assert.equal(d.morada, 'Rua B, 2');
  });

  test('acesso cruzado: cada conta só vê os seus pedidos, fotos e propostas; conta ≠ painel', async () => {
    const a = await p.contaConfirmada(email());
    const b = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    const la = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos;
    const lb = (await conta('GET', 'pedidos', { cookie: b.cookie })).json.pedidos;
    assert.deepEqual(la.map((x) => x.id), [id]);
    assert.deepEqual(lb, []);
    assert.equal(la[0].resumo.casa, 'Moradia T2');
    assert.equal(la[0].resumo.estimativa.min, 900);
    assert.ok(!('simulacao' in la[0]) && !('itens' in la[0].resumo), 'resumo simples, sem o técnico');
    const fotoA = await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } });
    assert.equal(fotoA.estado, 201, fotoA.texto);
    assert.equal((await conta('GET', `pedidos/${id}/fotos/${fotoA.json.id}`, { cookie: b.cookie })).estado, 404);
    assert.equal((await conta('POST', `pedidos/${id}/fotos`, { cookie: b.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } })).estado, 404);
    await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1000 });
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: b.cookie, corpo: {} })).estado, 404);
    assert.equal((await conta('GET', 'pedidos', { cookie: 'domus_conta=' + 'x'.repeat(43) })).estado, 401);
    // O cookie da conta não abre o painel, e o do painel não abre a conta.
    assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: a.cookie })).estado, 401);
    assert.equal((await p.pedir('GET', '/painel/api/orcamentos', { cookie: a.cookie })).estado, 401);
    assert.equal((await conta('GET', 'eu', { cookie: p.cookies.ceo })).estado, 401);
    // Sem email confirmado: não vê pedidos.
    const e3 = email();
    await conta('POST', 'criar', { corpo: { email: e3 } });
    assert.equal((await conta('GET', 'pedidos', { cookie: sessaoAntiga(e3) })).estado, 403);
  });

  test('fotos na conta: acrescentar/trocar com as validações de fotos.js; ver; 409 depois de aceite', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    const enviar = (corpo, cab = {}, tipo = 'image/jpeg') => conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo, tipo, cabecalhos: { 'X-Foto-Chave': 'conta1:outra', ...cab } });
    assert.equal((await enviar(Buffer.from('não é imagem'))).estado, 415);
    assert.equal((await enviar(JPEG(), { 'X-Foto-Chave': 'chave inválida' })).estado, 400);
    assert.equal((await enviar(JPEG(1024 * 1024 + 10))).estado, 413);
    assert.equal((await enviar(JPEG(), {}, 'text/plain')).estado, 415);
    const r1 = await enviar(JPEG(100, 1), { 'X-Foto-Legenda': encodeURIComponent('Sala') });
    assert.equal(r1.estado, 201, r1.texto);
    const r2 = await enviar(JPEG(100, 2));
    assert.equal(r2.estado, 201);
    let ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.equal(ped.fotos.length, 1, 'a mesma chave troca a foto');
    assert.equal(ped.fotos[0].id, r2.json.id);
    assert.equal(ped.pode_fotos, true);
    const img = await p.pedir('GET', ped.fotos[0].url, { cookie: a.cookie });
    assert.equal(img.estado, 200);
    assert.equal(img.cabecalhos['content-type'], 'image/jpeg');
    assert.equal(img.bruto[50], 2);
    // O painel vê-a.
    assert.equal((await painel('GET', `orcamentos/${id}`, 'comercial')).json.fotos.length, 1);
    // Aceite → já não aceita fotos.
    await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'aceite' });
    assert.equal((await enviar(JPEG())).estado, 409);
    ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.equal(ped.pode_fotos, false);
  });

  test('simulação guardada na conta: guardar, retomar noutra sessão (outro aparelho), apagar; limites', async () => {
    const a = await p.contaConfirmada(email());
    const estado = { versao: 5, passo: 3, casa: { tipo: 'apartamento' }, planta: { fundo: 'data:image/png;base64,AAAA' } };
    const g = await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado } });
    assert.equal(g.estado, 200);
    assert.ok(g.json.atualizado);
    const outra = ck(await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } }));
    const l = await conta('GET', 'simulacao', { cookie: outra });
    assert.deepEqual(l.json.estado, estado);
    assert.equal(l.json.atualizado, g.json.atualizado);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: [1] } })).estado, 400);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: { x: 'data:text/html;base64,AAAA' } } })).estado, 400);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: { x: 'a'.repeat(1_600_000) } } })).estado, 413);
    assert.equal((await conta('POST', 'simulacao', { corpo: { estado } })).estado, 401);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: null } })).estado, 200);
    assert.equal((await conta('GET', 'simulacao', { cookie: outra })).json.estado, null);
  });

  test('aceitar a proposta: valor e texto do painel; aceite com auditoria (IP) e histórico; 409 se já aceite/convertida', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409, 'ainda sem proposta');
    const u = await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1234.5, proposta_texto: 'Inclui tudo.\nObra em 2 dias.' });
    assert.equal(u.estado, 200, u.texto);
    const ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.deepEqual(ped.proposta, { valor: 1234.5, texto: 'Inclui tudo.\nObra em 2 dias.', aceite: null });
    assert.equal(ped.pode_aceitar, true);
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: { valor: 999 } })).estado, 409, 'o valor mudou');
    const r = await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: { valor: 1234.5 }, ip: '203.0.113.9' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedido.estado, 'aceite');
    assert.ok(r.json.pedido.proposta.aceite);
    const aud = p.app.db.prepare('SELECT * FROM auditoria WHERE acao = \'proposta_aceite_cliente\' AND alvo = ?').get(`orcamento:${id}`);
    assert.equal(aud.ip, '203.0.113.9');
    assert.ok(aud.quando);
    const d = (await painel('GET', `orcamentos/${id}`, 'comercial')).json;
    assert.equal(d.estado, 'aceite');
    assert.equal(d.proposta_aceite, r.json.pedido.proposta.aceite);
    assert.ok(d.historico.some((x) => x.acao === 'proposta_aceite_cliente'));
    const resumo = (await painel('GET', 'resumo', 'ceo')).json;
    assert.ok(resumo.propostas_aceites_online.some((x) => x.id === id));
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409, 'já aceite');
  });

  test('credenciais MQTT da casa: só para a conta dona, depois da conversão (resultado do domus.sh cifrado)', async () => {
    const a = await p.contaConfirmada(email());
    const b = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    assert.equal((await conta('GET', 'casa', { cookie: a.cookie })).estado, 404, 'ainda sem casa');
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' });
    const cv = await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'casa-conta', data: '2026-11-01' });
    assert.equal(cv.estado, 201, cv.texto);
    const pid = cv.json.pedido.id;
    // O domus.sh escreve o resultado com a palavra-passe gerada.
    await writeFile(join(p.dados, 'pedidos-admin', `${pid}.resultado.json`), JSON.stringify({ id: pid, tipo: 'cliente', ok: true, cliente: 'casa-conta', aparelho: null, password: 'SenhaMqttGerada1', saida: '', avisos: null, concluido: new Date().toISOString() }));
    await esperar(() => p.app.db.prepare('SELECT casa_cifra FROM contas WHERE email = ?').get(a.email)?.casa_cifra);
    const cifra = p.app.db.prepare('SELECT casa_codigo, casa_cifra FROM contas WHERE email = ?').get(a.email);
    assert.equal(cifra.casa_codigo, 'casa-conta');
    assert.doesNotMatch(cifra.casa_cifra, /SenhaMqttGerada1/, 'guardada cifrada');
    const r = await conta('GET', 'casa', { cookie: a.cookie });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json, { codigo: 'casa-conta', password: 'SenhaMqttGerada1' });
    assert.equal((await conta('GET', 'eu', { cookie: a.cookie })).json.tem_casa, true);
    assert.equal((await conta('GET', 'casa', { cookie: b.cookie })).estado, 404, 'outra conta');
    assert.equal((await conta('GET', 'casa')).estado, 401, 'sem sessão');
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT detalhes FROM auditoria').all()).includes('SenhaMqttGerada1'), 'nunca na auditoria');
    // AES-GCM com AAD (id da conta): a cifra copiada para outra conta não se lê.
    p.app.db.prepare('UPDATE contas SET casa_codigo = ?, casa_cifra = ? WHERE email = ?').run('casa-b', cifra.casa_cifra, b.email);
    assert.equal((await conta('GET', 'casa', { cookie: b.cookie })).estado, 404, 'cifra de outra conta');
    // Etiqueta com menos de 16 bytes: recusada.
    const [iv, tag, dados] = cifra.casa_cifra.split('.');
    const curta = [iv, Buffer.from(tag, 'base64').subarray(0, 12).toString('base64'), dados].join('.');
    p.app.db.prepare('UPDATE contas SET casa_cifra = ? WHERE email = ?').run(curta, a.email);
    assert.equal((await conta('GET', 'casa', { cookie: a.cookie })).estado, 404, 'etiqueta curta');
    // Cifra antiga (sem AAD): lê-se e fica logo cifrada de novo, com AAD.
    const iv2 = randomBytes(12);
    const cf = createCipheriv('aes-256-gcm', p.config.contaChave, iv2);
    const d2 = Buffer.concat([cf.update('SenhaAntiga1', 'utf8'), cf.final()]);
    const antiga = [iv2, cf.getAuthTag(), d2].map((x) => x.toString('base64')).join('.');
    p.app.db.prepare('UPDATE contas SET casa_cifra = ? WHERE email = ?').run(antiga, a.email);
    assert.equal((await conta('GET', 'casa', { cookie: a.cookie })).json.password, 'SenhaAntiga1');
    const recifrada = p.app.db.prepare('SELECT casa_cifra FROM contas WHERE email = ?').get(a.email).casa_cifra;
    assert.notEqual(recifrada, antiga);
    assert.equal((await conta('GET', 'casa', { cookie: a.cookie })).json.password, 'SenhaAntiga1');
    p.app.db.prepare('UPDATE contas SET casa_cifra = ? WHERE email = ?').run(recifrada, b.email);
    assert.equal((await conta('GET', 'casa', { cookie: b.cookie })).estado, 404, 'a recifrada também só serve a esta conta');
    // Pedido convertido: a proposta já não se aceita e as fotos já não entram.
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409);
    assert.equal((await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } })).estado, 409);
  });

  test('apagar a minha conta (cliente): exige sessão e a palavra-passe certa (ou um código, sem palavra-passe); apaga pedidos sem seguimento e anonimiza os pagos; sessão acaba; auditoria', async () => {
    // Sem palavra-passe: confirma com um código para entrar (POST codigo); errado → 403; certo → apaga.
    const sc = await p.contaConfirmada(email(), null);
    assert.equal((await conta('POST', 'apagar', { cookie: sc.cookie, corpo: {} })).estado, 400);
    assert.equal((await conta('POST', 'apagar', { cookie: sc.cookie, corpo: { password: SENHA } })).estado, 403, 'sem palavra-passe definida');
    await conta('POST', 'codigo', { corpo: { email: sc.email }, ip: '198.51.100.50' });
    const cod = p.codigo(sc.email);
    assert.equal((await conta('POST', 'apagar', { cookie: sc.cookie, corpo: { codigo: cod === '000000' ? '111111' : '000000' }, ip: '198.51.100.50' })).estado, 403);
    const rc = await conta('POST', 'apagar', { cookie: sc.cookie, corpo: { codigo: cod }, ip: '198.51.100.50' });
    assert.equal(rc.estado, 200, rc.texto);
    assert.equal((await conta('GET', 'eu', { cookie: sc.cookie })).estado, 401);
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } });
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(a.email).id;
    // Um segundo pedido com um pagamento pago: fica anonimizado, com o pagamento.
    const { id: pago } = await pedidoComConta(a);
    const agoraIso = new Date().toISOString();
    p.app.db.prepare("INSERT INTO pagamentos_pedido (ref, orcamento_id, conta_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, pago, expira) VALUES ('pp_teste_apagar_cliente_01', ?, ?, 'relatorio_pormenorizado', 2900, 'Relatório pormenorizado', 'pago', 'simulado', 'conta', ?, ?, ?, ?)").run(pago, contaId, agoraIso, agoraIso, agoraIso, Date.now() + 3600_000);
    // Sem sessão → 401; sem palavra-passe → 400; palavra-passe errada → 403 e a conta fica.
    assert.equal((await conta('POST', 'apagar', { corpo: { password: SENHA } })).estado, 401);
    assert.equal((await conta('POST', 'apagar', { cookie: a.cookie, corpo: {} })).estado, 400);
    const errada = await conta('POST', 'apagar', { cookie: a.cookie, corpo: { password: 'nao-e-esta-1' } });
    assert.equal(errada.estado, 403, errada.texto);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas WHERE id = ?').get(contaId).n, 1);
    assert.equal((await conta('POST', 'apagar', { cookie: a.cookie, corpo: { password: SENHA, extra: 1 } })).estado, 400);
    // Certa: 200, cookie apagado, conta e pedido sem seguimento fora, pedido pago anonimizado com o pagamento.
    const r = await conta('POST', 'apagar', { cookie: a.cookie, corpo: { password: SENHA } });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual({ ...r.json }, { ok: true, pedidos_apagados: 1, pedidos_anonimizados: 1, pedidos_mantidos: 0 });
    assert.match(r.cabecalhos['set-cookie'][0], /^domus_conta=;.*Max-Age=0/);
    assert.equal((await conta('GET', 'eu', { cookie: a.cookie })).estado, 401, 'a sessão acabou');
    assert.equal((await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } })).estado, 401);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas WHERE id = ?').get(contaId).n, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE id = ?').get(id).n, 0);
    const o = p.app.db.prepare('SELECT nome, telefone, email, simulacao, conta_id, anonimizado FROM orcamentos WHERE id = ?').get(pago);
    assert.deepEqual({ ...o, anonimizado: Boolean(o.anonimizado) }, { nome: 'Anonimizado (RGPD)', telefone: null, email: null, simulacao: null, conta_id: null, anonimizado: true });
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ?').get(pago).n, 1, 'o pagamento pago fica (contabilidade)');
    const aud = p.app.db.prepare('SELECT acao, detalhes, ip FROM auditoria WHERE alvo = ?').all(`conta:${contaId}`);
    assert.deepEqual(aud.map((x) => [x.acao, JSON.parse(x.detalhes).por, x.ip]), [['conta_apagada', 'cliente', null]]);
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(a.email), 'o email não fica na auditoria');
  });

  test('painel (só CEO): lista de contas, desativar (fecha sessões), apagar com os dados pessoais (RGPD)', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } });
    assert.equal((await painel('GET', 'contas', 'comercial')).estado, 403);
    const l = (await painel('GET', 'contas', 'ceo')).json.contas;
    const c = l.find((x) => x.email === a.email);
    assert.equal(c.confirmado, true);
    assert.equal(c.n_pedidos, 1);
    assert.equal((await painel('POST', `contas/${c.id}`, 'ceo', { ativo: false })).estado, 200);
    assert.equal((await conta('GET', 'eu', { cookie: a.cookie })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } })).estado, 401);
    await painel('POST', `contas/${c.id}`, 'ceo', { ativo: true });
    assert.equal((await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } })).estado, 200);
    const pasta = join(p.config.fotosDir, String(id));
    assert.equal((await readdir(pasta)).length, 1);
    // Irreversível: o CEO escreve o email da conta para confirmar (sem ele, ou com outro, nada acontece).
    assert.equal((await painel('POST', `contas/${c.id}/apagar`, 'ceo', {})).estado, 400);
    assert.equal((await painel('POST', `contas/${c.id}/apagar`, 'ceo', { email: 'outro@exemplo.pt' })).estado, 400);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas WHERE id = ?').get(c.id).n, 1);
    const r = await painel('POST', `contas/${c.id}/apagar`, 'ceo', { email: a.email.toUpperCase() });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedidos_apagados, 1);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas WHERE id = ?').get(c.id).n, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE id = ?').get(id).n, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(id).n, 0);
    await assert.rejects(readdir(pasta));
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(a.email), 'o email não fica na auditoria');
    assert.equal((await painel('POST', `contas/${c.id}/apagar`, 'ceo', { email: a.email })).estado, 404);
  });

  test('apagar (RGPD): auditoria sem IPs nem detalhes do pedido e da conta; ids nunca reutilizados (o histórico não passa a outra pessoa)', async () => {
    const IP = '203.0.113.77';
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' }, ip: IP });
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(a.email).id;
    // Um pedido desta conta que fica (convertido): a linha fica, sem o IP.
    p.app.db.prepare("INSERT INTO auditoria (quando, email, acao, alvo, ip) VALUES ('2026-09-01T10:00:00.000Z', ?, 'proposta_aceite_cliente', 'orcamento:999999', ?)").run(`conta:${contaId}`, IP);
    const aud = (alvo) => p.app.db.prepare('SELECT acao, detalhes, ip, email FROM auditoria WHERE alvo = ? ORDER BY id').all(alvo).map((x) => ({ ...x }));
    assert.ok(aud(`orcamento:${id}`).some((x) => x.ip === IP));
    assert.ok(aud(`conta:${contaId}`).length);
    assert.equal((await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: a.email })).estado, 200);
    assert.deepEqual(aud(`orcamento:${id}`), [{ acao: 'orcamento_apagado_rgpd', detalhes: null, ip: null, email: 'sistema' }]);
    assert.deepEqual(aud(`conta:${contaId}`).map((x) => x.acao), ['conta_apagada'], 'só o rasto do CEO');
    assert.deepEqual(aud('orcamento:999999').map((x) => [x.acao, x.ip]), [['proposta_aceite_cliente', null]]);
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(IP), 'o IP do cliente não fica');
    // A seguir: nova conta e novo pedido nunca ficam com os ids apagados, nem com o histórico deles.
    const b = await p.contaConfirmada(email());
    const novo = await pedidoComConta(b);
    assert.ok(novo.id > id, `${novo.id} > ${id}`);
    assert.ok(p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(b.email).id > contaId);
    const d = (await painel('GET', `orcamentos/${novo.id}`, 'ceo')).json;
    assert.deepEqual(d.historico.map((x) => x.acao), ['orcamento_recebido']);
  });
});

describe('site público noutra origem (SITE_ORIGENS): CORS e origem', () => {
  let p;
  const SITE = 'https://domusenergia.pt';
  before(async () => { p = await iniciarPainel({ env: { SITE_ORIGENS: `${SITE}, nao-e-url, https://domusenergia.pt/caminho, http://inseguro.exemplo, http://qc1.localhost:8080` } }); });
  after(() => p.fechar());

  test('preflight OPTIONS: 204 só para as origens da lista, com os cabeçalhos X-Fotos-*; nunca "*"', async () => {
    const pf = (origem, caminho = '/api/conta/entrar') => p.pedir('OPTIONS', caminho, { site: false, cabecalhos: { Origin: origem, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    const ok = await pf(SITE);
    assert.equal(ok.estado, 204);
    assert.equal(ok.cabecalhos['access-control-allow-origin'], SITE);
    assert.equal(ok.cabecalhos['access-control-allow-credentials'], 'true');
    assert.match(ok.cabecalhos['access-control-allow-headers'], /X-Fotos-Token/);
    assert.match(ok.cabecalhos['access-control-allow-headers'], /X-Foto-Chave/);
    assert.equal((await pf(SITE, '/api/orcamento/fotos')).estado, 204);
    const nao = await pf('https://outro.exemplo');
    assert.equal(nao.estado, 403);
    assert.equal(nao.cabecalhos['access-control-allow-origin'], undefined);
    // O painel nunca responde a CORS.
    const painel = await pf(SITE, '/painel/api/entrar');
    assert.equal(painel.cabecalhos['access-control-allow-origin'], undefined);
  });

  test('POST do site (same-site) aceite com CORS; cross-site e origem fora da lista recusados; cookie SameSite=Lax', async () => {
    const cab = { Origin: SITE, 'Sec-Fetch-Site': 'same-site' };
    const r = await p.pedir('POST', '/api/conta/criar', { site: false, cabecalhos: cab, corpo: { email: 'site@exemplo.pt' } });
    assert.equal(r.estado, 201, r.texto);
    assert.equal(r.cabecalhos['access-control-allow-origin'], SITE);
    const cf = await p.pedir('POST', '/api/conta/confirmar', { site: false, cabecalhos: cab, corpo: { email: 'site@exemplo.pt', codigo: p.codigo('site@exemplo.pt') } });
    assert.equal(cf.estado, 200, cf.texto);
    assert.match(cf.cabecalhos['set-cookie'][0], /SameSite=Lax/);
    const cookie = ck(cf);
    const g = await p.pedir('GET', '/api/conta/eu', { site: false, cookie, cabecalhos: { Origin: SITE, 'Sec-Fetch-Site': 'same-site' } });
    assert.equal(g.estado, 200);
    assert.equal(g.cabecalhos['access-control-allow-origin'], SITE);
    assert.equal((await p.pedir('POST', '/api/conta/entrar', { site: false, cabecalhos: { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' }, corpo: { email: 'site@exemplo.pt', password: SENHA } })).estado, 403);
    assert.equal((await p.pedir('POST', '/api/conta/entrar', { site: false, cabecalhos: { Origin: 'https://outro.exemplo', 'Sec-Fetch-Site': 'same-site' }, corpo: { email: 'site@exemplo.pt', password: SENHA } })).estado, 403);
    // O formulário do site (sem simulação) também pode vir do site público.
    const f = await p.pedir('POST', '/api/orcamento', { site: false, cabecalhos: cab, corpo: { nome: 'Site', telefone: '912 000 444', servico: 'Casa inteligente' } });
    assert.equal(f.estado, 201, f.texto);
    assert.equal(f.cabecalhos['access-control-allow-origin'], SITE);
    // Origem inválida na variável, ou http:// fora de localhost: ignorada com aviso.
    assert.ok(p.config.avisos.some((a) => /SITE_ORIGENS: origem inválida/.test(a)));
    assert.ok(p.config.avisos.some((a) => a.includes('SITE_ORIGENS: origem sem https ignorada: http://inseguro.exemplo')));
    assert.deepEqual(p.config.siteOrigens, [SITE, 'http://qc1.localhost:8080']);
  });
});
