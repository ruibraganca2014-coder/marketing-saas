// Eletricistas externos, fase 4 ronda 1 (docs/ELETRICISTAS.md; src/eletricistas.js): candidatura pública (validação e
// documento do seguro), aprovar/suspender no painel, entrar só quando aprovado, sessões separadas (painel, conta de
// cliente, eletricista), bolsa por concelho sem dados do cliente nem preços, aceitar atómico, 48 h para marcar a
// visita, largar, retirar pelo CEO, estimativa do que o eletricista recebe (obra, visita, avaria) e o acesso rápido.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { iniciarPainel, painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { nifValido, tipoDoDocumento, SEGURO_MAX_BYTES, PRAZO_VISITA_MS, COOKIE_ELETRICISTA } from '../src/eletricistas.js';
import { ELETRICISTAS_TESTE } from '../src/acesso-rapido.js';
import { lerConfig } from '../src/config.js';
import { ROTAS } from '../src/api.js';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const seguro = (bytes = PDF, tipo = 'application/pdf') => ({ tipo, dados: bytes.toString('base64') });
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
let seq = 0;
const dadosCandidatura = (extra = {}) => {
  const n = ++seq;
  return { nome: `Eletricista Exemplo ${n}`, email: `eletricista${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${1000 + n}`,
    concelhos: ['Sintra', 'Cascais'], experiencia: '5_10', notas: 'Quadros e remodelações.', seguro: seguro(), consentimento: true, ...extra };
};

const sim = (qtd = 10) => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const CONTACTO = { nome: CLIENTE.nome, telefone: CLIENTE.telefone };   // o painel regista o pedido sem a morada (fica na ficha)
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const HORA = 3600_000;

test('NIF (módulo 11) e tipo do documento pelos bytes', () => {
  for (const n of NIFS) assert.equal(nifValido(n), true, n);
  for (const n of ['123456780', '12345678', '1234567890', '023456789', 'abcdefghi', '', null, 123456789]) assert.equal(nifValido(n), false, String(n));
  assert.equal(tipoDoDocumento(PDF), 'application/pdf');
  assert.equal(tipoDoDocumento(PNG), 'image/png');
  assert.equal(tipoDoDocumento(JPEG), 'image/jpeg');
  for (const b of [Buffer.from('MZ\x90\x00executável'), Buffer.from('<html><script>alert(1)</script>'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('%PDF'), Buffer.alloc(0)]) {
    assert.equal(tipoDoDocumento(b), null);
  }
});

test('migrações 27 e 28: tabelas dos eletricistas e dos trabalhos, estados no CHECK, um trabalho ativo por pedido e tipo', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 26; i++) MIGRACOES[i](db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 26');
  const agora = '2026-10-02T10:00:00Z';
  db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES (?, ?, 'Ana', 'Casa')").run(agora, agora);
  db.prepare("UPDATE config_orcamento SET valor = 41 WHERE chave = 'tarifa_hora_iva'").run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.ok(MIGRACOES.length >= 28);
  assert.equal(db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'eletricista_pct'").get().valor, 70);
  assert.equal(db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'tarifa_hora_iva'").get().valor, 41, 'o resto da configuração fica igual');
  const ins = db.prepare("INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, estado, consentimento, criado, atualizado) VALUES (?, 'E', '910000000', '123456789', 'TR-1', ?, ?, ?, ?)");
  ins.run('a@exemplo.pt', 'pendente', agora, agora, agora);
  assert.throws(() => ins.run('A@EXEMPLO.PT', 'pendente', agora, agora, agora), /UNIQUE/, 'o email é único sem contar maiúsculas');
  assert.throws(() => ins.run('b@exemplo.pt', 'outro', agora, agora, agora), /CHECK/);
  const trab = db.prepare("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, criado, atualizado) VALUES (1, ?, ?, 'bolsa', 'Sintra', ?, ?)");
  trab.run('obra', 'na_bolsa', agora, agora);
  assert.throws(() => trab.run('obra', 'aceite', agora, agora), /UNIQUE/, 'um só trabalho ativo por pedido e tipo');
  trab.run('visita', 'na_bolsa', agora, agora);
  db.prepare("UPDATE trabalhos_eletricista SET estado = 'retirado' WHERE tipo = 'obra'").run();
  trab.run('obra', 'na_bolsa', agora, agora);   // depois de retirado pode voltar a ser posto na bolsa
  assert.throws(() => trab.run('avaria', 'outro', agora, agora), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO trabalhos_eletricista_eventos (trabalho_id, evento, quando) VALUES (1, 'outro', ?)").run(agora), /CHECK/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

describe('candidatura pública', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());
  const candidatar = (corpo, opcoes = {}) => p.pedir('POST', '/api/eletricista/candidatura', { corpo, ...opcoes });
  const linhas = () => p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n;

  test('validação no servidor: campos, NIF, concelhos da lista, consentimento e campos desconhecidos', async () => {
    const maus = {
      'sem nome': { nome: '' }, 'email errado': { email: 'nao-e-email' }, 'telemóvel curto': { telefone: '12345' }, 'NIF errado': { nif: '123456780' },
      'sem DGEG': { dgeg: '' }, 'sem concelhos': { concelhos: [] }, 'concelho fora da lista': { concelhos: ['Sintra', 'Atlântida'] },
      'concelhos não é lista': { concelhos: 'Sintra' }, 'demasiados concelhos': { concelhos: Array.from({ length: 41 }, () => 'Sintra') },
      'experiência desconhecida': { experiencia: 'muita' }, 'sem consentimento': { consentimento: false }, 'consentimento em texto': { consentimento: 'sim' },
      'sem documento': { seguro: undefined }, 'documento vazio': { seguro: { tipo: 'application/pdf', dados: '' } },
      'documento com campo a mais': { seguro: { ...seguro(), nome: '../../x.pdf' } }, 'campo desconhecido': { estado: 'aprovado' }, 'percentagem do candidato': { percentagem: 100 },
    };
    for (const [nome, extra] of Object.entries(maus)) {
      const r = await candidatar(dadosCandidatura(extra));
      assert.equal(r.estado, 400, `${nome}: ${r.texto}`);
      assert.equal(typeof r.json.erro, 'string');
    }
    assert.equal(linhas(), 0);
    assert.equal(p.emails.length, 0);
  });

  test('documento: só PDF, JPEG ou PNG verdadeiros (pelos bytes) e até 5 MB', async () => {
    const maus = [
      [seguro(Buffer.from('MZ\x90\x00 isto é um executável'), 'application/pdf'), 415],
      [seguro(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), 415],
      [seguro(PNG, 'application/pdf'), 415, 'o tipo declarado tem de ser o dos bytes'],
      [seguro(PDF, 'image/svg+xml'), 415],
      [seguro(PDF, 'text/html'), 415],
      [{ tipo: 'application/pdf', dados: '%%%não é base64%%%' }, 400],
      [seguro(Buffer.concat([PDF, Buffer.alloc(SEGURO_MAX_BYTES)])), 413],
    ];
    for (const [doc, estado, nota] of maus) {
      const r = await candidatar(dadosCandidatura({ seguro: doc }));
      assert.equal(r.estado, estado, `${nota ?? doc.tipo}: ${r.texto.slice(0, 200)}`);
    }
    assert.equal(linhas(), 0);
    // No limite (5 MB certos) entra; PNG e JPEG também.
    const grande = Buffer.concat([PDF, Buffer.alloc(SEGURO_MAX_BYTES - PDF.length)]);
    assert.equal((await candidatar(dadosCandidatura({ seguro: seguro(grande) }))).estado, 201);
    assert.equal((await candidatar(dadosCandidatura({ seguro: seguro(PNG, 'image/png') }))).estado, 201);
    assert.equal((await candidatar(dadosCandidatura({ seguro: seguro(JPEG, 'image/jpeg') }))).estado, 201);
    assert.equal(linhas(), 3);
  });

  test('candidatura certa: fica pendente, o documento fora da pasta pública, emails ao candidato e à empresa; nada no catálogo público', async () => {
    p.emails.length = 0;
    const c = dadosCandidatura({ concelhos: ['Sintra', 'Cascais', 'Sintra'], nif: '245 987 657' });
    const r = await candidatar(c);
    assert.equal(r.estado, 201, r.texto);
    assert.deepEqual(Object.keys(r.json).sort(), ['mensagem', 'ok']);
    const e = p.app.db.prepare('SELECT * FROM eletricistas WHERE email = ?').get(c.email);
    assert.deepEqual([e.estado, e.nif, e.concelhos, e.percentagem, e.seguro_tipo, e.seguro_bytes], ['pendente', '245987657', '["Cascais","Sintra"]', null, 'application/pdf', PDF.length]);
    assert.match(e.seguro_id, /^[a-f0-9]{24}$/);
    assert.ok(e.consentimento);
    const pasta = join(p.config.eletricistasDir, String(e.id));
    assert.deepEqual(await readdir(pasta), [`${e.seguro_id}.pdf`]);
    assert.ok(!p.config.eletricistasDir.startsWith(p.config.publicDir), 'fora da pasta pública do painel');
    assert.equal((await p.pedir('GET', `/painel/eletricistas/${e.id}/${e.seguro_id}.pdf`)).estado, 404, 'não se serve como ficheiro estático');
    assert.deepEqual(p.emails.map((m) => m.para).sort(), ['ceo@domus.teste', c.email].sort());
    const aviso = p.emails.find((m) => m.para === 'ceo@domus.teste');
    for (const dado of [c.nome, c.email, '245987657', c.telefone]) assert.ok(!aviso.texto.includes(dado), 'o aviso à empresa não leva os dados do candidato');
    // Email repetido: a mesma resposta, nada muda, e quem tem o email é avisado.
    const outra = await candidatar({ ...dadosCandidatura(), email: c.email.toUpperCase(), nome: 'Outro Nome' });
    assert.equal(outra.estado, 201);
    assert.deepEqual(outra.json, r.json);
    assert.equal(p.app.db.prepare('SELECT nome FROM eletricistas WHERE email = ?').get(c.email).nome, c.nome);
    assert.match(p.emails.at(-1).assunto, /já temos a sua candidatura/);
    // A percentagem dos eletricistas não sai no catálogo público.
    const cat = await p.pedir('GET', '/api/catalogo');
    assert.ok(!('eletricista_pct' in cat.json.config));
  });

  test('armadilha, origem, tipo do pedido e limite por IP', async () => {
    const antes = linhas();
    const robo = await candidatar(dadosCandidatura({ website: 'http://spam.exemplo' }));
    assert.equal(robo.estado, 201, 'responde como se tivesse corrido bem');
    assert.equal(linhas(), antes);
    assert.equal((await candidatar(dadosCandidatura(), { cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
    assert.equal((await candidatar(dadosCandidatura(), { site: false })).estado, 403);
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: 'nome=x', tipo: 'application/x-www-form-urlencoded' })).estado, 415);
    // GET: as páginas perguntam se o módulo existe (desligado dá 404; ver o "interruptor" em baixo).
    // Leva a percentagem da mão de obra em vigor (a página "Trabalhe connosco" mostra-a).
    assert.deepEqual((await p.pedir('GET', '/api/eletricista/candidatura')).json, { aberta: true, percentagem: 70 });
    assert.equal((await p.pedir('GET', '/api/eletricista/codigo')).estado, 405);
    assert.equal((await p.pedir('GET', '/api/eletricista/nada')).estado, 404);
    const ip = '203.0.113.9';
    for (let i = 0; i < 5; i++) assert.equal((await candidatar(dadosCandidatura(), { ip })).estado, 201);
    const r = await candidatar(dadosCandidatura(), { ip });
    assert.equal(r.estado, 429);
    assert.ok(Number(r.cabecalhos['retry-after']) > 0);
  });
});

describe('painel, área do eletricista, bolsa e trabalhos (pagamentos simulados)', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());

  // Os testes das 48 h avançam o relógio para lá das 12 h da sessão do painel: entra de novo quando ela acaba.
  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const cookieDe = (r) => r.cabecalhos['set-cookie'][0].split(';')[0];

  async function candidato(extra) {
    const c = dadosCandidatura(extra);
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    return { ...c, id: p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id };
  }
  async function entrar(e) {
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return cookieDe(r);
  }
  /** Eletricista aprovado e com sessão aberta. */
  async function aprovado(extra) {
    const e = await candidato(extra);
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    return { ...e, cookie: await entrar(e) };
  }
  /** Pedido aceite com a obra criada (proposta em três partes, sem IVA), em `localidade`. */
  async function obra(localidade = 'Sintra', partes = { proposta_mao_obra: 1240, proposta_material: 615, proposta_deslocacao: 35 }) {
    const r = await painel('POST', 'orcamentos', 'ceo', { ...CONTACTO, email: 'cliente.obra@exemplo.pt', localidade, servico: 'Remodelação elétrica' });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.id;
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { morada: CLIENTE.morada, ...partes })).estado, 200);
    const a = await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' });
    assert.equal(a.estado, 200, a.texto);
    assert.ok(a.json.obra_id, 'a obra nasce com o pedido aceite');
    return id;
  }
  const atribuicao = (id, corpo) => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, 'ceo', corpo);
  const bolsa = async (e) => (await area(e, 'GET', 'bolsa')).json.trabalhos;
  const eventos = (trabalhoId) => p.app.db.prepare('SELECT evento, eletricista_id FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? ORDER BY id').all(trabalhoId).map((x) => ({ ...x }));
  /** Todas as chaves de um objeto, a qualquer nível. */
  const chaves = (v, out = new Set()) => {
    if (Array.isArray(v)) for (const x of v) chaves(x, out);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); chaves(x, out); }
    return out;
  };

  test('painel (só CEO): lista, ficha, documento com os cabeçalhos certos, aprovar com email, concelhos e percentagem', async () => {
    const e = await candidato();
    const lista = await painel('GET', 'eletricistas');
    assert.equal(lista.estado, 200);
    assert.equal(lista.json.percentagem_omissao, 70);
    const linha = lista.json.eletricistas.find((x) => x.id === e.id);
    assert.deepEqual([linha.estado, linha.nome, linha.email, linha.nif, linha.dgeg, linha.percentagem, linha.percentagem_efetiva, linha.experiencia],
      ['pendente', e.nome, e.email, e.nif, e.dgeg, null, 70, '5 a 10 anos']);
    assert.deepEqual(linha.seguro, { tipo: 'application/pdf', bytes: PDF.length, url: `/painel/api/eletricistas/${e.id}/seguro` });
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await painel('GET', 'eletricistas', papel)).estado, 403);
      assert.equal((await painel('GET', `eletricistas/${e.id}/seguro`, papel)).estado, 403);
      assert.equal((await painel('POST', `eletricistas/${e.id}`, papel, { acao: 'aprovar' })).estado, 403);
    }
    assert.equal((await p.pedir('GET', `/painel/api/eletricistas/${e.id}/seguro`)).estado, 401);
    const doc = await painel('GET', `eletricistas/${e.id}/seguro`);
    assert.equal(doc.estado, 200);
    assert.ok(doc.bruto.equals(PDF));
    assert.equal(doc.cabecalhos['content-type'], 'application/pdf');
    assert.equal(doc.cabecalhos['x-content-type-options'], 'nosniff');
    assert.equal(doc.cabecalhos['content-security-policy'], "default-src 'none'; sandbox");
    assert.match(doc.cabecalhos['content-disposition'], /^attachment; filename="seguro-eletricista-\d+\.pdf"$/);
    assert.equal(doc.cabecalhos['cache-control'], 'private, no-store');
    assert.equal((await painel('GET', 'eletricistas/99999/seguro')).estado, 404);
    // Aprovar: email com a ligação para a área.
    p.emails.length = 0;
    const ap = await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' });
    assert.equal(ap.json.eletricista.estado, 'aprovado');
    assert.ok(ap.json.eletricista.decidido);
    assert.deepEqual(p.emails.map((m) => m.para), [e.email]);
    assert.match(p.emails[0].texto, /https:\/\/site\.teste\/eletricista\.html/);
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 409, 'já está aprovado');
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'recusar' })).estado, 409, 'só se recusa uma candidatura pendente');
    // Concelhos e percentagem.
    const ed = await painel('POST', `eletricistas/${e.id}`, 'ceo', { concelhos: ['Mafra', 'Sintra'], percentagem: 75 });
    assert.deepEqual([ed.json.eletricista.concelhos, ed.json.eletricista.percentagem, ed.json.eletricista.percentagem_efetiva], [['Mafra', 'Sintra'], 75, 75]);
    for (const mau of [{ percentagem: 101 }, { percentagem: -1 }, { percentagem: 'muito' }, { concelhos: ['Nenhures'] }, { concelhos: [] }, { acao: 'apagar' }, {}, { estado: 'aprovado' }]) {
      assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', mau)).estado, 400, JSON.stringify(mau));
    }
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: null })).json.eletricista.percentagem_efetiva, 70, 'null = a da configuração');
    // A percentagem por omissão é uma chave da configuração (Catálogo → Configuração).
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { eletricista_pct: 65 })).json.eletricista_pct, 65);
    assert.equal((await painel('GET', `eletricistas/${e.id}`)).json.eletricista.percentagem_efetiva, 65);
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { eletricista_pct: 70 })).estado, 200);
    const aud = p.app.db.prepare("SELECT acao FROM auditoria WHERE alvo = ? ORDER BY id").all(`eletricista:${e.id}`).map((a) => a.acao);
    assert.deepEqual(aud.slice(0, 3), ['eletricista_candidatura', 'eletricista_aprovado', 'eletricista_atualizado']);
  });

  test('entrar: só quem está aprovado; suspender fecha a sessão; a resposta nunca diz se o email existe', async () => {
    const e = await candidato();
    p.emails.length = 0;
    const pedirCodigo = (email) => p.pedir('POST', '/api/eletricista/codigo', { corpo: { email } });
    const pend = await pedirCodigo(e.email);
    const nada = await pedirCodigo('ninguem@exemplo.pt');
    assert.equal(pend.estado, 200);
    assert.equal(pend.json.mensagem, nada.json.mensagem);
    assert.equal(p.emails.length, 0, 'pendente: não sai código nenhum');
    assert.equal((await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: '123456' } })).estado, 400);
    for (const c of ['eu', 'bolsa', 'trabalhos', 'bolsa/1', 'trabalhos/1']) assert.equal((await p.pedir('GET', `/api/eletricista/${c}`)).estado, 401, c);
    for (const c of ['bolsa/1/aceitar', 'trabalhos/1/visita', 'trabalhos/1/largar']) assert.equal((await p.pedir('POST', `/api/eletricista/${c}`, { corpo: {} })).estado, 401, c);
    await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' });
    p.emails.length = 0;
    await pedirCodigo(e.email);
    assert.equal(p.emails.length, 1);
    assert.ok(!/\d{6}/.test(p.emails[0].assunto), 'o código vai só no corpo');
    const codigo = p.codigo(e.email);
    const errado = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: codigo === '000000' ? '000001' : '000000' } });
    assert.equal(errado.estado, 400);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo } });
    assert.equal(r.estado, 200);
    // (Nos testes o Host é 127.0.0.1: sem Secure, como o cookie da conta; fora de localhost leva Secure.)
    assert.match(r.cabecalhos['set-cookie'][0], /^domus_eletricista=[A-Za-z0-9_-]{43}; Path=\/api\/eletricista; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const fora = await p.pedir('POST', '/api/eletricista/sair', { corpo: {}, cabecalhos: { Host: 'painel.teste' } });
    assert.match(fora.cabecalhos['set-cookie'][0], /; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/);
    assert.deepEqual(Object.keys(r.json.eletricista).sort(), ['concelhos', 'email', 'iban', 'nome', 'percentagem']);
    const cookie = cookieDe(r);
    assert.equal((await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo } })).estado, 400, 'o código só serve uma vez');
    assert.equal((await p.pedir('GET', '/api/eletricista/eu', { cookie })).json.eletricista.email, e.email);
    // Suspender: a sessão deixa de valer e não entra; reativar: volta a entrar.
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'suspender' })).json.eletricista.estado, 'suspenso');
    assert.equal((await p.pedir('GET', '/api/eletricista/eu', { cookie })).estado, 401);
    assert.equal((await p.pedir('GET', '/api/eletricista/bolsa', { cookie })).estado, 401);
    p.emails.length = 0;
    await pedirCodigo(e.email);
    assert.equal(p.emails.length, 0, 'suspenso: não sai código');
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'reativar' })).json.eletricista.estado, 'aprovado');
    assert.equal((await p.pedir('GET', '/api/eletricista/eu', { cookie })).estado, 401, 'a sessão antiga não volta');
    const novo = await entrar(e);
    assert.equal((await p.pedir('GET', '/api/eletricista/eu', { cookie: novo })).estado, 200);
    // Sair.
    assert.equal((await p.pedir('POST', '/api/eletricista/sair', { cookie: novo, corpo: {} })).estado, 200);
    assert.equal((await p.pedir('GET', '/api/eletricista/eu', { cookie: novo })).estado, 401);
    // Candidatura recusada: nunca entra.
    const rec = await candidato();
    assert.equal((await painel('POST', `eletricistas/${rec.id}`, 'ceo', { acao: 'recusar' })).json.eletricista.estado, 'recusado');
    p.emails.length = 0;
    await pedirCodigo(rec.email);
    assert.equal(p.emails.length, 0);
  });

  test('sessões separadas: a do eletricista não abre a conta nem o painel, e as outras não abrem a área do eletricista', async () => {
    const e = await aprovado();
    const c = await p.contaConfirmada();
    const tokens = { eletricista: e.cookie.split('=')[1], conta: c.cookie.split('=')[1], painel: p.cookies.ceo.split('=')[1] };
    const rotas = { eletricista: '/api/eletricista/eu', conta: '/api/conta/eu', painel: '/painel/api/eu' };
    const nomes = { eletricista: COOKIE_ELETRICISTA, conta: 'domus_conta', painel: 'domus_painel' };
    for (const dono of Object.keys(tokens)) {
      for (const alvo of Object.keys(rotas)) {
        // O cookie tal como é (com o seu nome) e o token posto no cookie da área alvo.
        const tal = await p.pedir('GET', rotas[alvo], { cookie: `${nomes[dono]}=${tokens[dono]}` });
        const trocado = await p.pedir('GET', rotas[alvo], { cookie: `${nomes[alvo]}=${tokens[dono]}` });
        assert.equal(tal.estado, dono === alvo ? 200 : 401, `cookie de ${dono} em ${alvo}`);
        assert.equal(trocado.estado, dono === alvo ? 200 : 401, `token de ${dono} no cookie de ${alvo}`);
      }
    }
    // Os três cookies juntos: cada área só lê o seu.
    const todos = `${e.cookie}; ${c.cookie}; ${p.cookies.comercial}`;
    assert.equal((await p.pedir('GET', '/painel/api/eletricistas', { cookie: todos })).estado, 403, 'comercial');
    assert.equal((await p.pedir('GET', '/painel/api/eletricistas', { cookie: `${e.cookie}; ${c.cookie}` })).estado, 401);
    assert.equal((await p.pedir('GET', '/api/conta/pedidos', { cookie: e.cookie })).estado, 401);
    assert.equal((await p.pedir('GET', '/api/eletricista/bolsa', { cookie: `${c.cookie}; ${p.cookies.ceo}` })).estado, 401);
  });

  test('atribuição: só pedidos com obra por fazer ou visita/diagnóstico pagos; só o CEO; concelho reconhecido', async () => {
    const e = await aprovado({ concelhos: ['Sintra'] });
    const semObra = (await painel('POST', 'orcamentos', 'ceo', { ...CONTACTO, localidade: 'Sintra', servico: 'Casa' })).json.id;
    const a = await atribuicao(semObra);
    assert.deepEqual([a.json.pode, a.json.tipo, a.json.trabalho], [false, null, null]);
    assert.match(a.json.motivo, /obra por fazer/);
    assert.equal((await atribuicao(semObra, { acao: 'bolsa' })).estado, 409);
    assert.equal((await atribuicao(semObra, { acao: 'atribuir', eletricista_id: e.id })).estado, 409);
    const id = await obra('Sintra');
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await painel('GET', `orcamentos/${id}/eletricista`, papel)).estado, 403);
      assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, papel, { acao: 'bolsa' })).estado, 403);
    }
    const b = await atribuicao(id);
    assert.deepEqual([b.json.pode, b.json.tipo, b.json.concelho], [true, 'obra', 'Sintra']);
    assert.ok(b.json.candidatos.some((x) => x.id === e.id && x.recebe === 903));
    for (const mau of [{ acao: 'atribuir' }, { acao: 'atribuir', eletricista_id: '1' }, { acao: 'outra' }, {}]) assert.equal((await atribuicao(id, mau)).estado, 400, JSON.stringify(mau));
    assert.equal((await atribuicao(id, { acao: 'atribuir', eletricista_id: 99999 })).estado, 404);
    assert.equal((await atribuicao(id, { acao: 'retirar' })).estado, 409, 'nada para retirar');
    // Eletricista de outro concelho, pendente ou suspenso: não se atribui.
    const fora = await aprovado({ concelhos: ['Almada'] });
    const pend = await candidato({ concelhos: ['Sintra'] });
    assert.equal((await atribuicao(id, { acao: 'atribuir', eletricista_id: fora.id })).estado, 409);
    assert.equal((await atribuicao(id, { acao: 'atribuir', eletricista_id: pend.id })).estado, 409);
    // Localidade que não é um concelho: não vai para a bolsa.
    const aldeia = await obra('Aldeia Sem Concelho');
    const al = await atribuicao(aldeia);
    assert.equal(al.json.pode, false);
    assert.match(al.json.motivo, /concelho reconhecido/);
    assert.equal((await atribuicao(aldeia, { acao: 'bolsa' })).estado, 409);
    // Pedido arquivado ou perdido: nada.
    await painel('POST', `orcamentos/${aldeia}`, 'ceo', { estado: 'perdido', motivo_perda: 'teste' });
    assert.equal((await atribuicao(aldeia)).json.tipo, null);
  });

  test('bolsa: só os concelhos do eletricista; antes de aceitar nada do cliente nem preços (no servidor)', async () => {
    const sintra = await aprovado({ concelhos: ['Sintra', 'Cascais'] });
    const almada = await aprovado({ concelhos: ['Almada', 'Seixal'] });
    // Pedido com simulação (relatório técnico), de uma conta de cliente.
    const c = await p.contaConfirmada('cliente.bolsa@exemplo.pt');
    const env = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Casa inteligente do Alberto', localidade: 'Sintra', mensagem: 'Ligar depois das 18h', simulacao: sim() } });
    assert.equal(env.estado, 201, env.texto);
    const id = env.json.pedido;
    await painel('POST', `orcamentos/${id}`, 'ceo', { proposta_mao_obra: 1240, proposta_material: 615, proposta_deslocacao: 35, notas: 'Nota interna secreta' });
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' })).estado, 200);
    const posto = await atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    assert.deepEqual([posto.json.trabalho.estado, posto.json.trabalho.modo, posto.json.trabalho.eletricista, posto.json.pode], ['na_bolsa', 'bolsa', null, false]);
    assert.equal((await atribuicao(id, { acao: 'bolsa' })).estado, 409, 'já está na bolsa');
    // O painel diz quem vê o trabalho na bolsa: os aprovados do concelho (QA: dizia "Visível para 0: ninguém").
    const quem = posto.json.candidatos.map((x) => x.id);
    assert.ok(quem.includes(sintra.id) && !quem.includes(almada.id), JSON.stringify(quem));
    const tid = posto.json.trabalho.id;
    assert.deepEqual(await bolsa(almada), [], 'fora dos concelhos: não vê');
    assert.equal((await area(almada, 'GET', `bolsa/${tid}`)).estado, 404);
    assert.equal((await area(almada, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404, 'nem aceita pelo endereço');
    const lista = await area(sintra, 'GET', 'bolsa');
    assert.deepEqual(lista.json.concelhos, ['Cascais', 'Sintra']);
    assert.equal(lista.json.trabalhos.length, 1);
    const item = lista.json.trabalhos[0];
    assert.deepEqual(Object.keys(item).sort(), ['concelho', 'dias', 'horas', 'id', 'recebe', 'tipo', 'titulo']);
    assert.deepEqual([item.id, item.concelho, item.tipo, item.titulo, item.dias], [tid, 'Sintra', 'obra', 'Obra — Apartamento T2', 1]);
    assert.ok(item.horas > 0);
    assert.deepEqual(item.recebe, { percentagem: 70, mao_obra: 1240, parte_mao_obra: 868, deslocacao: 35, total: 903, provisoria: false });
    const det = await area(sintra, 'GET', `bolsa/${tid}`);
    assert.equal(det.estado, 200);
    const t = det.json.trabalho;
    assert.deepEqual(Object.keys(t).sort(), ['concelho', 'dias', 'horas', 'id', 'recebe', 'relatorio', 'tipo', 'titulo']);
    assert.deepEqual(Object.keys(t.relatorio).sort(), ['acoes', 'divisoes', 'esquema_quadro', 'esquemas', 'geral', 'melhorias', 'planta', 'terra_nota']);
    assert.deepEqual(t.relatorio.geral.material, [{ artigo: t.relatorio.geral.material[0].artigo, quantidade: 10 }], 'material: só artigo e quantidade');
    // Nada do cliente, em lado nenhum das duas respostas…
    for (const texto of [lista.texto, det.texto]) {
      for (const dado of [CLIENTE.nome, 'Carla', 'Neves', '912 345 678', '912345678', CLIENTE.morada, 'Rua do Exemplo', c.email, 'cliente.bolsa', 'Alberto', 'Ligar depois', 'Nota interna']) {
        assert.ok(!texto.includes(dado), `não pode sair "${dado}"`);
      }
    }
    // … nem preços: nenhuma chave de preço fora do "recebe" (o que o próprio eletricista recebe), nem o n.º do pedido.
    const { recebe, ...semRecebe } = t;
    const ks = [...chaves(semRecebe)];
    for (const k of ks) assert.ok(!/preco|total|valor|iva|custo|sinal|proposta|cliente|pedido|orcamento|morada|telefone|email|nome_cliente/i.test(k), `chave "${k}"`);
    assert.ok(!ks.includes('ensaios') && !ks.includes('diagnostico') && !ks.includes('material_obra'));
    assert.equal(recebe.total, 903);
    // Antes de aceitar não há "os meus trabalhos" nem ficha.
    assert.deepEqual((await area(sintra, 'GET', 'trabalhos')).json.trabalhos, []);
    assert.equal((await area(sintra, 'GET', `trabalhos/${tid}`)).estado, 404);
    assert.equal((await area(sintra, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 24 * HORA) })).estado, 404);
    // O CEO retira da bolsa: desaparece.
    const ret = await atribuicao(id, { acao: 'retirar' });
    assert.deepEqual([ret.json.trabalho, ret.json.pode], [null, true]);
    assert.deepEqual(await bolsa(sintra), []);
    assert.equal((await area(sintra, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404);
    assert.deepEqual(eventos(tid).map((x) => x.evento), ['posto_na_bolsa', 'retirado']);
  });

  test('aceitar é atómico: dois ao mesmo tempo, um fica com o trabalho e o outro recebe 409', async () => {
    const a = await aprovado({ concelhos: ['Oeiras'] });
    const b = await aprovado({ concelhos: ['Oeiras'] });
    const id = await obra('Oeiras');
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await bolsa(a)).length, 1);
    assert.equal((await bolsa(b)).length, 1);
    const rs = await Promise.all([area(a, 'POST', `bolsa/${tid}/aceitar`, {}), area(b, 'POST', `bolsa/${tid}/aceitar`, {})]);
    assert.deepEqual(rs.map((r) => r.estado).sort(), [200, 409]);
    const perdeu = rs.find((r) => r.estado === 409);
    assert.equal(perdeu.json.erro, 'Outro eletricista aceitou este trabalho primeiro.');
    const [ganhou, outro] = rs[0].estado === 200 ? [a, b] : [b, a];
    assert.equal(p.app.db.prepare('SELECT eletricista_id FROM trabalhos_eletricista WHERE id = ?').get(tid).eletricista_id, ganhou.id);
    assert.equal((await area(outro, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 409, 'a seguir também');
    assert.equal((await area(outro, 'GET', `bolsa/${tid}`)).estado, 409);
    assert.deepEqual(await bolsa(outro), []);
    assert.equal((await area(outro, 'GET', `trabalhos/${tid}`)).estado, 404, 'quem não ficou com o trabalho não vê o cliente');
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/largar`, {})).estado, 404);
    assert.equal((await area(ganhou, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404, 'já é dele: não está na bolsa');
    assert.deepEqual(eventos(tid), [{ evento: 'posto_na_bolsa', eletricista_id: null }, { evento: 'aceite', eletricista_id: ganhou.id }]);
    const pn = (await atribuicao(id)).json.trabalho;
    assert.deepEqual([pn.estado, pn.eletricista.id, pn.percentagem], ['aceite', ganhou.id, 70]);
  });

  test('depois de aceitar: cliente, relatório, material, prazo de 48 h; marcar visita avisa o cliente em nome da Domus', async () => {
    const e = await aprovado({ concelhos: ['Cascais'], nome: 'Zeferino Eletricista Externo' });
    const id = await obra('Cascais');
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    const t0 = p.relogio.agora();
    const ac = await area(e, 'POST', `bolsa/${tid}/aceitar`, {});
    assert.equal(ac.estado, 200, ac.texto);
    const t = ac.json.trabalho;
    assert.deepEqual([t.estado, t.aberto, t.visita], ['aceite', true, null]);
    assert.deepEqual(t.cliente, { nome: CLIENTE.nome, telefone: CLIENTE.telefone, morada: CLIENTE.morada, localidade: 'Cascais' });
    assert.ok(!ac.texto.includes('cliente.obra@exemplo.pt'), 'o email do cliente nunca sai');
    assert.ok(Math.abs(Date.parse(t.prazo) - (t0 + PRAZO_VISITA_MS)) < 5000, '48 h depois de aceitar');
    assert.equal(t.recebe.total, 903);
    const meus = (await area(e, 'GET', 'trabalhos')).json.trabalhos;
    assert.deepEqual(meus.map((x) => [x.id, x.estado]), [[tid, 'aceite']]);
    assert.ok(!('cliente' in meus[0]), 'a lista não leva os dados do cliente');
    // Marcar visita: dia e hora, no futuro.
    for (const mau of [{}, { data_visita: '2026-13-40T10:00' }, { data_visita: lisboa(p.relogio.agora()).slice(0, 10) }, { data_visita: lisboa(p.relogio.agora() - HORA) }, { data_visita: 'amanhã' }]) {
      assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, mau)).estado, 400, JSON.stringify(mau));
    }
    p.emails.length = 0;
    const quando = lisboa(p.relogio.agora() + 30 * HORA);
    const v = await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: quando });
    assert.equal(v.estado, 200, v.texto);
    assert.deepEqual([v.json.trabalho.estado, v.json.trabalho.visita, v.json.trabalho.prazo], ['visita_marcada', quando, null]);
    const ob = p.app.db.prepare('SELECT data, hora, por_agendar FROM obras WHERE orcamento_id = ?').get(id);
    assert.deepEqual([ob.data, ob.hora, ob.por_agendar], [quando.slice(0, 10), quando.slice(11), 0], 'a obra fica com a data');
    assert.deepEqual(p.emails.map((m) => m.para), ['cliente.obra@exemplo.pt']);
    assert.match(p.emails[0].texto, /em nome da Domus Energia/);
    assert.ok(!p.emails[0].texto.includes('Zeferino') && !p.emails[0].texto.includes(e.email), 'sem o nome nem o email do eletricista');
    // Com a visita marcada as 48 h deixam de contar.
    p.relogio.avancar(PRAZO_VISITA_MS + HORA);
    assert.equal((await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho.estado, 'visita_marcada');
    // Mudar a data.
    const outra = lisboa(p.relogio.agora() + 50 * HORA);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: outra })).json.trabalho.visita, outra);
    assert.deepEqual(eventos(tid).map((x) => x.evento), ['posto_na_bolsa', 'aceite', 'visita_marcada', 'visita_marcada']);
    // Obra concluída: o trabalho fecha e os dados do cliente deixam de sair.
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {})).estado, 200);
    const fim = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([fim.aberto, fim.cliente, fim.relatorio, fim.material], [false, null, null, []]);
    assert.ok(!JSON.stringify(fim).includes('Carla'));
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: outra })).estado, 409, 'fechado');
  });

  test('48 h sem visita marcada: volta à bolsa sozinho, fica registado quem deixou caducar, e esse já não o vê', async () => {
    const a = await aprovado({ concelhos: ['Mafra'] });
    const b = await aprovado({ concelhos: ['Mafra'] });
    const id = await obra('Mafra');
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await area(a, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    p.relogio.avancar(PRAZO_VISITA_MS - 60_000);
    assert.equal((await area(a, 'GET', `trabalhos/${tid}`)).estado, 200, 'ainda dentro do prazo');
    assert.deepEqual(await bolsa(b), []);
    p.emails.length = 0;
    p.relogio.avancar(2 * 60_000);
    // Verificado ao ler (sem esperar pelo temporizador): basta outro eletricista abrir a bolsa.
    assert.deepEqual((await bolsa(b)).map((x) => x.id), [tid], 'voltou à bolsa');
    assert.equal((await area(a, 'GET', `trabalhos/${tid}`)).estado, 404);
    assert.deepEqual((await area(a, 'GET', 'trabalhos')).json.trabalhos, []);
    assert.deepEqual(await bolsa(a), [], 'quem o deixou caducar não o volta a ver');
    assert.equal((await area(a, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404);
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 24 * HORA) })).estado, 404);
    assert.deepEqual(eventos(tid), [{ evento: 'posto_na_bolsa', eletricista_id: null }, { evento: 'aceite', eletricista_id: a.id }, { evento: 'expirou', eletricista_id: a.id }]);
    const linha = p.app.db.prepare('SELECT estado, eletricista_id, aceite_em, percentagem FROM trabalhos_eletricista WHERE id = ?').get(tid);
    assert.deepEqual([linha.estado, linha.eletricista_id, linha.aceite_em, linha.percentagem], ['na_bolsa', null, null, null]);
    assert.equal((await painel('GET', `eletricistas/${a.id}`)).json.eletricista.trabalhos_largados, 1);
    assert.ok(p.emails.some((m) => m.para === 'ceo@domus.teste' && /48 h/.test(m.texto)), 'a empresa é avisada');
    assert.ok(!p.emails.some((m) => m.para === 'cliente.obra@exemplo.pt'), 'sem visita marcada o cliente não recebe nada');
    // O outro aceita e o prazo dele conta de novo.
    const ac = await area(b, 'POST', `bolsa/${tid}/aceitar`, {});
    assert.equal(ac.estado, 200);
    assert.ok(Math.abs(Date.parse(ac.json.trabalho.prazo) - (p.relogio.agora() + PRAZO_VISITA_MS)) < 5000);
    // Atribuição direta que caduca: volta ao CEO (por atribuir), não à bolsa.
    const id2 = await obra('Mafra');
    const dir = await atribuicao(id2, { acao: 'atribuir', eletricista_id: a.id });
    assert.deepEqual([dir.json.trabalho.estado, dir.json.trabalho.modo, dir.json.trabalho.eletricista.id], ['aceite', 'direto', a.id]);
    const tid2 = dir.json.trabalho.id;
    assert.equal((await area(a, 'GET', `trabalhos/${tid2}`)).json.trabalho.cliente.nome, CLIENTE.nome);
    p.relogio.avancar(PRAZO_VISITA_MS + 1000);
    assert.equal(p.app.api.eletricistas.expirar(), 2, 'o trabalho periódico (de 15 em 15 min) também os apanha: este e o que o outro aceitou acima');
    const depois = await atribuicao(id2);
    assert.deepEqual([depois.json.trabalho, depois.json.pode], [null, true]);
    assert.deepEqual(await bolsa(b), [], 'não foi para a bolsa');
    assert.deepEqual(eventos(tid2), [{ evento: 'atribuido', eletricista_id: a.id }, { evento: 'expirou', eletricista_id: a.id }]);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE id = ?').get(tid2).estado, 'retirado');
  });

  test('largar: volta à bolsa, fica registado, o cliente deixa de se ver e é avisado se a visita já estava marcada', async () => {
    const a = await aprovado({ concelhos: ['Loures'] });
    const b = await aprovado({ concelhos: ['Loures'] });
    const id = await obra('Loures');
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    await area(a, 'POST', `bolsa/${tid}/aceitar`, {});
    const quando = lisboa(p.relogio.agora() + 40 * HORA);
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/visita`, { data_visita: quando })).estado, 200);
    p.emails.length = 0;
    const l = await area(a, 'POST', `trabalhos/${tid}/largar`, {});
    assert.equal(l.estado, 200, l.texto);
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/largar`, {})).estado, 404, 'já não é dele');
    assert.equal((await area(a, 'GET', `trabalhos/${tid}`)).estado, 404);
    assert.deepEqual(await bolsa(a), []);
    assert.deepEqual((await bolsa(b)).map((x) => x.id), [tid]);
    const veem = (await atribuicao(id)).json.candidatos.map((x) => x.id);
    assert.ok(veem.includes(b.id) && !veem.includes(a.id), 'no painel, quem largou já não conta como quem vê a bolsa');
    assert.deepEqual(eventos(tid).at(-1), { evento: 'largou', eletricista_id: a.id });
    assert.equal(p.app.db.prepare('SELECT por_agendar FROM obras WHERE orcamento_id = ?').get(id).por_agendar, 1, 'a obra volta a "por agendar"');
    assert.ok(p.emails.some((m) => m.para === 'cliente.obra@exemplo.pt' && /desmarcada/.test(m.texto)));
    assert.ok(p.emails.some((m) => m.para === 'ceo@domus.teste' && /largou/.test(m.texto)));
    const hist = (await atribuicao(id)).json.historico.map((x) => [x.evento, x.eletricista]);
    assert.deepEqual(hist[0], ['largou', a.nome]);
    const aud = p.app.db.prepare("SELECT email FROM auditoria WHERE acao = 'trabalho_largou' ORDER BY id DESC LIMIT 1").get();
    assert.equal(aud.email, `eletricista:${a.id}`);
  });

  test('o CEO retira o trabalho em qualquer altura (na bolsa, aceite ou com visita marcada)', async () => {
    const e = await aprovado({ concelhos: ['Odivelas'] });
    const id = await obra('Odivelas');
    const tid = (await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    p.emails.length = 0;
    const r = await atribuicao(id, { acao: 'retirar' });
    assert.deepEqual([r.estado, r.json.trabalho, r.json.pode], [200, null, true]);
    assert.equal((await area(e, 'GET', `trabalhos/${tid}`)).estado, 404, 'o eletricista deixa de ver o cliente');
    assert.deepEqual((await area(e, 'GET', 'trabalhos')).json.trabalhos, []);
    assert.deepEqual(eventos(tid).at(-1), { evento: 'retirado', eletricista_id: e.id });
    assert.deepEqual(p.emails.map((m) => m.para), [e.email]);
    // Volta a atribuir (trabalho novo) e retira logo, ainda sem visita.
    const tid2 = (await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
    assert.notEqual(tid2, tid);
    assert.equal((await atribuicao(id, { acao: 'retirar' })).estado, 200);
    assert.equal((await area(e, 'POST', `trabalhos/${tid2}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 404);
    assert.equal((await painel('GET', `eletricistas/${e.id}`)).json.eletricista.trabalhos_largados, 0, 'retirado pelo CEO não conta como largado');
  });

  test('o que o eletricista recebe: obra (percentagem × mão de obra sem IVA + deslocação), percentagem própria fixada ao aceitar, visita e avaria', async () => {
    const e = await aprovado({ concelhos: ['Sintra'] });
    await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: 75 });
    // Obra: 75 % × 1240 + 35.
    const id = await obra('Sintra');
    const tid = (await atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    const item = (await bolsa(e)).find((x) => x.id === tid);
    assert.deepEqual(item.recebe, { percentagem: 75, mao_obra: 1240, parte_mao_obra: 930, deslocacao: 35, total: 965, provisoria: false });
    await area(e, 'POST', `bolsa/${tid}/aceitar`, {});
    // A percentagem muda depois: o trabalho já aceite fica com a que tinha.
    await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: 50 });
    assert.equal((await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho.recebe.total, 965);
    assert.equal((await atribuicao(id)).json.trabalho.recebe.total, 965);
    await painel('POST', `eletricistas/${e.id}`, 'ceo', { percentagem: null });
    // Obra sem proposta em partes nem simulação: sem estimativa.
    const semPartes = await obra('Sintra', { valor_proposta: 2000 });
    assert.equal((await atribuicao(semPartes)).json.candidatos.find((x) => x.id === e.id).recebe, null);
    // Avaria (Sintra): o cliente pagou 25 € de diagnóstico + 0,5 h × 38 € + 7,20 € de deslocação (com IVA). O
    // eletricista: 70 % × a meia hora SEM IVA (19 € ÷ 1,23 = 15,45 €) + a deslocação sem IVA (5,85 €); os 25 € ficam na Domus.
    const c = await p.contaConfirmada();
    const av = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
    assert.equal(av.estado, 202, av.texto);
    assert.equal(av.json.pagamento.valor, 51.2);
    const pago = await conta(c, 'POST', `pagamentos/${av.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    const idAv = pago.json.pagamento.orcamento_id;
    const atr = await atribuicao(idAv);
    assert.deepEqual([atr.json.pode, atr.json.tipo, atr.json.tipo_nome], [true, 'avaria', 'Diagnóstico de avaria']);
    const tAv = (await atribuicao(idAv, { acao: 'bolsa' })).json.trabalho.id;
    const bAv = (await bolsa(e)).find((x) => x.id === tAv);
    assert.deepEqual([bAv.tipo, bAv.titulo, bAv.horas, bAv.dias], ['avaria', 'Diagnóstico de avaria', 0.5, 1]);
    assert.deepEqual(bAv.recebe, { percentagem: 70, mao_obra: 15.45, parte_mao_obra: 10.82, deslocacao: 5.85, total: 16.67, provisoria: false });
    // Aceita e marca: a data fica no pedido (o cliente vê-a na conta) e o pedido passa a "visita marcada".
    await area(e, 'POST', `bolsa/${tAv}/aceitar`, {});
    const quando = lisboa(p.relogio.agora() + 26 * HORA);
    assert.equal((await area(e, 'POST', `trabalhos/${tAv}/visita`, { data_visita: quando })).estado, 200);
    const ped = (await painel('GET', `orcamentos/${idAv}`)).json;
    assert.deepEqual([ped.estado, ped.data_visita], ['visita_marcada', quando]);
    assert.equal((await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === idAv).data_visita, quando);
    // Larga depois de marcar: a data sai do pedido.
    assert.equal((await area(e, 'POST', `trabalhos/${tAv}/largar`, {})).estado, 200);
    const ped2 = (await painel('GET', `orcamentos/${idAv}`)).json;
    assert.deepEqual([ped2.estado, ped2.data_visita], ['contactado', null]);
    // Visita técnica paga (pedido com simulação): 70 % × 0,5 h sem IVA + deslocação — os mesmos valores em Sintra.
    const c2 = await p.contaConfirmada();
    const vis = await p.pedir('POST', '/api/orcamento', { cookie: c2.cookie, corpo: { ...CLIENTE, servico: 'Casa', localidade: 'Sintra', simulacao: sim(), compra: 'visita' } });
    assert.equal(vis.estado, 201, vis.texto);
    const semPagar = await atribuicao(vis.json.pedido);
    assert.equal(semPagar.json.pode, false, 'a visita ainda não está paga');
    await conta(c2, 'POST', `pagamentos/${vis.json.pagamento.ref}/simular`, { resultado: 'sucesso' });
    const atrV = await atribuicao(vis.json.pedido);
    assert.deepEqual([atrV.json.pode, atrV.json.tipo], [true, 'visita']);
    assert.equal(atrV.json.candidatos.find((x) => x.id === e.id).recebe, 16.67);
    const tV = (await atribuicao(vis.json.pedido, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho;
    assert.deepEqual([tV.tipo, tV.estado, tV.recebe.total], ['visita', 'aceite', 16.67]);
    const fichaV = (await area(e, 'GET', `trabalhos/${tV.id}`)).json.trabalho;
    assert.equal(fichaV.titulo, 'Visita técnica — Apartamento T2');
    assert.ok(fichaV.relatorio.divisoes && !JSON.stringify(fichaV.relatorio).includes('preco_unitario'));
    // Proposta enviada depois da visita: o trabalho da visita fecha (os dados do cliente deixam de sair).
    await painel('POST', `orcamentos/${vis.json.pedido}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 900 });
    assert.equal((await area(e, 'GET', `trabalhos/${tV.id}`)).json.trabalho.cliente, null);
  });
});

describe('acesso rápido: "Eletricista de teste" só no lançador local', () => {
  const LOCAL = 'http://localhost:8080';
  const ENV_LOCAL = { ACESSO_RAPIDO: '1', EMAIL_LOCAL: '1', ANFITRIAO: '127.0.0.1', PAINEL_ORIGENS: `${LOCAL},http://192.168.1.20:8090,http://qa1.localhost:8080` };
  const DO_LOCAL = { cabecalhos: { Origin: LOCAL }, ip: '127.0.0.1' };
  const paineis = [];
  after(async () => { for (const p of paineis) await p.fechar(); });
  const entrar = (p, n = 1, opcoes = DO_LOCAL) => p.pedir('POST', '/api/eletricista/dev/entrar', { corpo: { n }, ...opcoes });

  test('desligado (sempre, no servidor): a rota não existe', async () => {
    const p = await iniciarPainel();
    paineis.push(p);
    for (const opcoes of [{}, DO_LOCAL]) {
      assert.equal((await entrar(p, 1, opcoes)).estado, 404);
      assert.equal((await p.pedir('GET', '/api/eletricista/dev/entrar', opcoes)).estado, 404);
    }
    const q = await iniciarPainel({ env: { ...ENV_LOCAL, PAINEL_ORIGENS: `${LOCAL},https://domusenergia.pt` } });
    paineis.push(q);
    assert.equal(q.config.acessoRapido, false);
    assert.equal((await entrar(q)).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n + q.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n, 0);
  });

  test('ligado: só deste computador; cria o eletricista de teste já aprovado e abre a sessão própria, sem emails', async () => {
    const p = await iniciarPainel({ env: ENV_LOCAL });
    paineis.push(p);
    const REDE = 'http://192.168.1.20:8090';
    const recusados = {
      'IP de fora': { ...DO_LOCAL, ip: '8.8.8.8' }, 'IP da rede local': { ...DO_LOCAL, ip: '192.168.1.77' },
      'telemóvel pela rede local': { cabecalhos: { Origin: REDE, Host: '192.168.1.20:8090' }, ip: '192.168.1.77' },
      'Host da rede local': { cabecalhos: { Origin: LOCAL, Host: '192.168.1.20:8090' }, ip: '127.0.0.1' },
      'Origin de outro site': { cabecalhos: { Origin: 'http://mau.exemplo:8080' }, ip: '127.0.0.1' }, 'sem Origin': { site: false, ip: '127.0.0.1' },
    };
    for (const [nome, opcoes] of Object.entries(recusados)) assert.equal((await entrar(p, 1, opcoes)).estado, 404, nome);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n, 0);
    assert.equal((await entrar(p, 1, { cabecalhos: { Origin: 'http://outro.localhost:9999' }, ip: '127.0.0.1' })).estado, 403, 'CSRF: origem que não é a do site');
    assert.equal((await p.pedir('GET', '/api/eletricista/dev/entrar', DO_LOCAL)).estado, 405);
    for (const n of [0, 2, '1', null, 'constructor']) assert.equal((await entrar(p, n)).estado, 400, String(n));
    const r = await entrar(p);
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.eletricista.email, ELETRICISTAS_TESTE[1].email);
    assert.match(r.cabecalhos['set-cookie'][0], /^domus_eletricista=[A-Za-z0-9_-]{43}; Path=\/api\/eletricista; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const cookie = r.cabecalhos['set-cookie'][0].split(';')[0];
    assert.equal((await p.pedir('GET', '/api/eletricista/bolsa', { cookie })).estado, 200);
    assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie })).estado, 401);
    assert.equal((await p.pedir('GET', '/api/conta/eu', { cookie })).estado, 401);
    assert.equal((await entrar(p)).estado, 200);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n, 1, 'não cria outro');
    assert.equal(p.emails.length, 0);
    assert.ok(!existsSync(join(p.config.eletricistasDir, '1')), 'sem documento');
    // Suspenso no painel: o botão deixa de entrar.
    p.app.db.prepare("UPDATE eletricistas SET estado = 'suspenso'").run();
    assert.equal((await entrar(p)).estado, 409);
    // Outra origem de testes deste computador.
    p.app.db.prepare("UPDATE eletricistas SET estado = 'aprovado'").run();
    assert.equal((await entrar(p, 1, { cabecalhos: { Origin: 'http://qa1.localhost:8080', Host: 'qa1.localhost:8080' }, ip: '127.0.0.1' })).estado, 200);
  });
});

describe('interruptor ELETRICISTAS: desligado por omissão (o módulo ainda não está publicado)', () => {
  const AQUI = dirname(fileURLToPath(import.meta.url));
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());
  const DESCONHECIDO = { erro: 'Endereço desconhecido.' };

  test('só ELETRICISTAS=1 liga; o servidor a sério nunca põe a variável (docker-compose.yml, .env.example, instalar.sh)', async () => {
    assert.equal(lerConfig({}).eletricistas, false);
    for (const v of ['0', '', 'true', 'sim', 'on']) assert.equal(lerConfig({ ELETRICISTAS: v }).eletricistas, false, `ELETRICISTAS=${v}`);
    assert.equal(lerConfig({ ELETRICISTAS: '1' }).eletricistas, true);
    assert.equal(p.config.eletricistas, false);
    for (const f of ['docker-compose.yml', '.env.example', 'instalar.sh', 'domus.sh']) {
      assert.equal(/ELETRICISTAS\s*[=:]/.test(await readFile(join(AQUI, '..', '..', 'servidor', f), 'utf8')), false, f);
    }
    // … e o lançador local põe-na.
    assert.match(await readFile(join(AQUI, '..', '..', 'local', 'iniciar.js'), 'utf8'), /ELETRICISTAS: process\.env\.ELETRICISTAS === '0' \? '0' : '1'/);
  });

  test('desligado: todas as rotas /api/eletricista/* dão 404 (o mesmo dos endereços desconhecidos), com ou sem sessão, e nada fica gravado', async () => {
    const c = await p.contaConfirmada();
    const desconhecida = await p.pedir('GET', '/api/outra');
    assert.deepEqual([desconhecida.estado, desconhecida.json], [404, DESCONHECIDO]);
    for (const r of p.app.api.eletricistas.ROTAS_ELETRICISTA) {
      // (Ronda 2: também o material, os ensaios, o diagnóstico, as fotos e "concluir".)
      const caminho = `/api/eletricista/${r.caminho.replace(':id', '1').replace(':foto', r.nome === 'receberFoto' ? 'quadro_antes' : '0123456789abcdef01234567')}`;
      for (const cookie of [undefined, p.cookies.ceo, c.cookie, `${COOKIE_ELETRICISTA}=${'a'.repeat(43)}`]) {
        const x = r.nome === 'receberFoto'
          ? await p.pedir('POST', caminho, { cookie, corpo: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), tipo: 'image/jpeg' })
          : await p.pedir(r.metodo, caminho, { cookie, corpo: r.metodo === 'POST' ? {} : undefined });
        assert.deepEqual([x.estado, x.json], [404, DESCONHECIDO], `${r.metodo} ${caminho}`);
        assert.equal(x.cabecalhos['set-cookie'], undefined);
      }
    }
    // A candidatura completa e o pedido de código também: nada entra na base, nenhum email, nenhum ficheiro.
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: dadosCandidatura() })).estado, 404);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: 'alguem@exemplo.pt' } })).estado, 404);
    assert.equal((await p.pedir('POST', '/api/eletricista/dev/entrar', { corpo: { n: 1 }, cabecalhos: { Origin: 'http://localhost:8080' }, ip: '127.0.0.1' })).estado, 404);
    assert.equal((await p.pedir('GET', '/api/eletricista/')).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n, 0);
    assert.equal(p.emails.filter((m) => /candidatura|eletricista/i.test(m.assunto)).length, 0);
    assert.equal(existsSync(p.config.eletricistasDir), false);
    assert.ok(p.app.api.eletricistas.ROTAS_ELETRICISTA.length >= 20, 'inclui as rotas da ficha de obra');
  });

  test('desligado: as rotas do painel dos eletricistas dão 404 (anónimo e CEO), o "eu" diz que não há módulo e nada sai no catálogo', async () => {
    const nomes = ['eletricistas', 'eletricista', 'atualizarEletricista', 'seguroEletricista', 'atribuicaoEletricista', 'atribuirEletricista',
      'apagarEletricista', 'fotoTrabalhoEletricista',   // ronda 2
      'pagamentosEletricistas', 'pagoEletricista', 'faturaEletricista'];   // ronda 3
    const rotas = ROTAS.filter((r) => nomes.includes(r.nome));
    assert.equal(rotas.length, 11);
    assert.equal(ROTAS.filter((r) => /eletricista/i.test(r.caminho)).length, 11, 'todas as rotas dos eletricistas estão atrás do interruptor');
    for (const r of rotas) {
      const caminho = `/painel/api/${r.caminho.replace(':id', '1').replace(':foto', '0123456789abcdef01234567')}`;
      for (const papel of [null, 'ceo', 'comercial', 'tecnico']) {
        const x = await p.pedir(r.metodo, caminho, { cookie: papel ? p.cookies[papel] : undefined, corpo: r.metodo === 'POST' ? { acao: 'bolsa' } : undefined });
        assert.deepEqual([x.estado, x.json], [404, DESCONHECIDO], `${r.metodo} ${caminho} (${papel ?? 'anónimo'})`);
      }
    }
    // O resto do painel fica igual, e diz ao ecrã que o módulo não existe (o menu e a atribuição escondem-se).
    const eu = await p.pedir('GET', '/painel/api/eu', { cookie: p.cookies.ceo });
    assert.deepEqual([eu.estado, eu.json.eletricistas], [200, false]);
    const entrou = await p.pedir('POST', '/painel/api/entrar', { corpo: { email: 'ceo@domus.teste', password: 'senha-de-teste-1' } });
    assert.equal(entrou.json.eletricistas, false);
    const pedido = await p.pedir('POST', '/painel/api/orcamentos', { cookie: p.cookies.ceo, corpo: { nome: 'Ana', telefone: '912 000 000', localidade: 'Sintra', servico: 'Casa' } });
    assert.equal(pedido.estado, 201);
    const ficha = await p.pedir('GET', `/painel/api/orcamentos/${pedido.json.id}`, { cookie: p.cookies.ceo });
    assert.ok(!/eletricista/i.test(Object.keys(ficha.json).join(' ')), 'a ficha do pedido não leva nada dos eletricistas');
    assert.equal((await p.pedir('GET', `/painel/api/orcamentos/${pedido.json.id}/eletricista`, { cookie: p.cookies.ceo })).estado, 404);
    assert.ok(!('eletricista_pct' in (await p.pedir('GET', '/api/catalogo')).json.config));
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista').get().n, 0);
    // As migrações 27 e 28 correm na mesma (as tabelas existem, vazias).
    assert.equal(versaoEsquema(p.app.db), MIGRACOES.length);
  });

  test('ligado (ELETRICISTAS=1, como nos outros testes): o "eu" diz que há módulo; com o acesso rápido mas sem o módulo o botão não entra', async () => {
    const q = await iniciarPainel();
    try {
      assert.equal(q.config.eletricistas, true);
      const ceo = await q.criarUtilizador('ceo');
      const cookie = await q.entrar(ceo.email);
      assert.equal((await q.pedir('GET', '/painel/api/eu', { cookie })).json.eletricistas, true);
      assert.equal((await q.pedir('GET', '/painel/api/eletricistas', { cookie })).estado, 200);
      assert.equal((await q.pedir('GET', '/api/eletricista/eu')).estado, 401);
    } finally { await q.fechar(); }
    const LOCAL = 'http://localhost:8080';
    const r = await iniciarPainel({ env: { ELETRICISTAS: '0', ACESSO_RAPIDO: '1', EMAIL_LOCAL: '1', ANFITRIAO: '127.0.0.1', PAINEL_ORIGENS: LOCAL } });
    try {
      assert.equal(r.config.acessoRapido, true);
      const DO_LOCAL = { cabecalhos: { Origin: LOCAL }, ip: '127.0.0.1' };
      assert.equal((await r.pedir('POST', '/api/eletricista/dev/entrar', { corpo: { n: 1 }, ...DO_LOCAL })).estado, 404);
      assert.equal((await r.pedir('POST', '/painel/api/dev/entrar', { corpo: { papel: 'ceo' }, ...DO_LOCAL })).estado, 200, 'os outros botões continuam');
      assert.equal(r.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas').get().n, 0);
    } finally { await r.fechar(); }
  });
});
