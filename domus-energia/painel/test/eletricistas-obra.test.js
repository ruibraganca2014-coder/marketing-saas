// Eletricistas externos, fase 4 ronda 2 (docs/ELETRICISTAS.md; src/eletricistas.js): avisos da bolsa por concelho (um
// email por trabalho e eletricista), a ficha de obra (material, fotos antes/depois, ensaios, diagnóstico), "Obra
// concluída" e as suas condições, o que o painel vê, a lista de trabalhos ao suspender e apagar um eletricista (RGPD).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { FOTOS_POR_GRUPO, PRAZO_VISITA_MS } from '../src/eletricistas.js';
import { FOTO_MAX_BYTES } from '../src/fotos.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});

test('migração 29: o trabalho ganha "concluida_eletricista", o material recebido e as fotos; os dados e as sequências ficam', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (let i = 0; i < 28; i++) MIGRACOES[i](db);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 28');
  const agora = '2026-10-02T10:00:00Z';
  db.prepare("INSERT INTO orcamentos (criado, atualizado, nome, servico) VALUES (?, ?, 'Ana', 'Casa')").run(agora, agora);
  db.prepare("INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, estado, consentimento, criado, atualizado) VALUES ('a@exemplo.pt', 'E', '910000000', '123456789', 'TR-1', 'aprovado', ?, ?, ?)").run(agora, agora, agora);
  const trab = db.prepare("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, aceite_em, visita, criado, atualizado) VALUES (1, ?, ?, 'bolsa', 'Sintra', 1, 70, 5, '2026-10-05T10:00', ?, ?)");
  trab.run('obra', 'retirado', agora, agora);
  trab.run('obra', 'visita_marcada', agora, agora);
  db.prepare("INSERT INTO trabalhos_eletricista_eventos (trabalho_id, eletricista_id, evento, quando, por) VALUES (2, 1, 'aceite', ?, 'eletricista:1')").run(agora);
  db.prepare("DELETE FROM trabalhos_eletricista WHERE id = 1").run();
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.ok(MIGRACOES.length >= 29);
  const t = db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = 2').get();
  assert.deepEqual([t.estado, t.eletricista_id, t.percentagem, t.visita, t.material_recebido, t.concluida], ['visita_marcada', 1, 70, '2026-10-05T10:00', '[]', null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_eventos').get().n, 1);
  db.prepare("UPDATE trabalhos_eletricista SET estado = 'concluida_eletricista', concluida = ? WHERE id = 2").run(agora);
  assert.throws(() => db.prepare("UPDATE trabalhos_eletricista SET estado = 'outro' WHERE id = 2").run(), /CHECK/);
  assert.throws(() => trab.run('obra', 'na_bolsa', agora, agora), /UNIQUE/, 'um concluído continua a ser o trabalho ativo do pedido');
  db.prepare("INSERT INTO trabalhos_eletricista_eventos (trabalho_id, eletricista_id, evento, quando) VALUES (2, 1, 'concluida', ?)").run(agora);
  // Os ids não se reutilizam (a sequência ficou): o próximo trabalho é o 3, não o 1 que foi apagado.
  db.prepare("UPDATE trabalhos_eletricista SET estado = 'retirado' WHERE id = 2").run();
  trab.run('obra', 'na_bolsa', agora, agora);
  assert.equal(db.prepare('SELECT MAX(id) AS m FROM trabalhos_eletricista').get().m, 3);
  const foto = db.prepare("INSERT INTO trabalhos_eletricista_fotos (id, trabalho_id, grupo, tipo_mime, bytes, eletricista_id, criado) VALUES (?, 2, ?, ?, 10, 1, ?)");
  foto.run('a'.repeat(24), 'quadro_antes', 'image/jpeg', agora);
  assert.throws(() => foto.run('b'.repeat(24), 'outro', 'image/jpeg', agora), /CHECK/);
  assert.throws(() => foto.run('c'.repeat(24), 'quadro_antes', 'image/svg+xml', agora), /CHECK/);
  db.prepare('INSERT INTO trabalhos_eletricista_avisos (trabalho_id, eletricista_id, quando) VALUES (2, 1, ?)').run(agora);
  assert.throws(() => db.prepare('INSERT INTO trabalhos_eletricista_avisos (trabalho_id, eletricista_id, quando) VALUES (2, 1, ?)').run(agora), /UNIQUE|PRIMARY/);
  assert.equal(db.prepare('SELECT anonimizado FROM eletricistas WHERE id = 1').get().anonimizado, null);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // Apagar o trabalho leva as fotos, os avisos e os eventos (cascata).
  db.prepare('DELETE FROM trabalhos_eletricista WHERE id = 2').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos').get().n + db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_avisos').get().n, 0);
  db.close();
});

describe('ronda 2: avisos da bolsa, ficha de obra, obra concluída, painel e RGPD', () => {
  let p;
  let seq = 0;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());

  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const enviarFoto = (e, tid, grupo, bytes = JPEG, tipo = 'image/jpeg') => p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${grupo}`, { cookie: e.cookie, corpo: bytes, tipo });
  async function candidato(extra = {}) {
    const n = ++seq;
    const c = { nome: `Eletricista Ronda2 ${n}`, email: `eletricista.r2.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${2000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    return { ...c, id: p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id };
  }
  async function aprovado(extra) {
    const e = await candidato(extra);
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  async function obra(localidade = 'Sintra') {
    const r = await painel('POST', 'orcamentos', 'ceo', { nome: CLIENTE.nome, telefone: CLIENTE.telefone, email: 'cliente.obra@exemplo.pt', localidade, servico: 'Remodelação elétrica' });
    assert.equal(r.estado, 201, r.texto);
    assert.equal((await painel('POST', `orcamentos/${r.json.id}`, 'ceo', { morada: CLIENTE.morada, proposta_mao_obra: 1240, proposta_material: 615, proposta_deslocacao: 35 })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${r.json.id}`, 'ceo', { estado: 'aceite' })).estado, 200);
    // Material da obra (lista do painel).
    const obraId = (await painel('GET', `orcamentos/${r.json.id}`)).json.obra_id;
    assert.equal((await painel('POST', `obras/${obraId}`, 'ceo', { material: [{ nome: 'Quadro de 24 módulos', quantidade: 1 }, { nome: 'Disjuntor 16 A', quantidade: 4 }] })).estado, 200);
    return r.json.id;
  }
  const atribuicao = (id, corpo) => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, 'ceo', corpo);
  /** Obra atribuída a `e` (com a visita marcada, se `visita`). Devolve {id, tid}. */
  async function trabalhoDe(e, { visita = true, localidade = 'Sintra' } = {}) {
    const id = await obra(localidade);
    const a = await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    if (visita) assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    return { id, tid };
  }
  const ficha = async (e, tid) => (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
  const bolsaEmails = () => p.emails.filter((m) => /novo trabalho em/i.test(m.assunto));
  const voltouEmails = () => p.emails.filter((m) => /voltou à bolsa/i.test(m.assunto));

  test('avisos da bolsa: um email a cada eletricista aprovado do concelho, sem nada do cliente nem valores; um por trabalho e eletricista', async () => {
    const a = await aprovado({ concelhos: ['Torres Vedras', 'Mafra'] });
    const b = await aprovado({ concelhos: ['Torres Vedras'] });
    const fora = await aprovado({ concelhos: ['Almada'] });
    const suspenso = await aprovado({ concelhos: ['Torres Vedras'] });
    await painel('POST', `eletricistas/${suspenso.id}`, 'ceo', { acao: 'suspender' });
    const pendente = await candidato({ concelhos: ['Torres Vedras'] });
    p.emails.length = 0;
    const id = await obra('Torres Vedras');
    const posto = await atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    const tid = posto.json.trabalho.id;
    assert.deepEqual(bolsaEmails().map((m) => m.para).sort(), [a.email, b.email].sort(), 'só os aprovados do concelho');
    for (const m of bolsaEmails()) {
      assert.equal(m.assunto, 'Domus Energia: novo trabalho em Torres Vedras');
      assert.match(m.texto, /https:\/\/site\.teste\/eletricista\.html/);
      for (const dado of [CLIENTE.nome, 'Carla', CLIENTE.telefone, 'Rua do Exemplo', 'cliente.obra', '1240', '903', '€']) assert.ok(!m.texto.includes(dado), `o aviso não leva "${dado}"`);
      assert.ok(!/pedido n\.º/.test(m.texto));
    }
    assert.equal(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'trabalho_na_bolsa' ORDER BY id DESC LIMIT 1").get().detalhes.includes('"avisados":2'), true);
    // Aprovado entretanto: quando o trabalho voltar à bolsa recebe o aviso "novo"; quem já o tinha recebido recebe "voltou
    // à bolsa" — menos quem o largou (ou deixou caducar), que nunca mais é avisado deste trabalho.
    const novo = await aprovado({ concelhos: ['Torres Vedras'] });
    await painel('POST', `eletricistas/${suspenso.id}`, 'ceo', { acao: 'reativar' });
    assert.equal((await area(a, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    p.emails.length = 0;
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/largar`, {})).estado, 200);
    assert.deepEqual(bolsaEmails().map((m) => m.para).sort(), [novo.email, suspenso.email].sort(), 'só quem ainda não tinha sido avisado');
    assert.deepEqual(voltouEmails().map((m) => m.para), [b.email], 'quem já sabia do trabalho recebe "voltou à bolsa"; quem o largou não');
    assert.equal(voltouEmails()[0].assunto, 'Domus Energia: um trabalho voltou à bolsa em Torres Vedras');
    for (const dado of [CLIENTE.nome, 'Carla', CLIENTE.telefone, 'Rua do Exemplo', 'cliente.obra', '1240', '€', 'pedido n.º']) assert.ok(!voltouEmails()[0].texto.includes(dado), `o aviso não leva "${dado}"`);
    // Volta outra vez (48 h sem visita): os outros da zona recebem "voltou à bolsa"; nem quem o largou nem quem o deixou caducar.
    assert.equal((await area(b, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    p.emails.length = 0;
    p.relogio.avancar(PRAZO_VISITA_MS + 1000);
    assert.equal(p.app.api.eletricistas.expirar(), 1);
    assert.equal(bolsaEmails().length, 0);
    assert.deepEqual(voltouEmails().map((m) => m.para).sort(), [novo.email, suspenso.email].sort());
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_avisos WHERE trabalho_id = ?').get(tid).n, 4);
    // Outro trabalho no mesmo concelho: aviso novo. Atribuição direta: sem aviso da bolsa.
    const id2 = await obra('Torres Vedras');
    p.emails.length = 0;
    await atribuicao(id2, { acao: 'bolsa' });
    assert.equal(bolsaEmails().length, 4);
    const id3 = await obra('Torres Vedras');
    p.emails.length = 0;
    await atribuicao(id3, { acao: 'atribuir', eletricista_id: b.id });
    assert.equal(bolsaEmails().length, 0);
    assert.ok(![fora.email, pendente.email].some((x) => p.app.db.prepare('SELECT 1 FROM trabalhos_eletricista_avisos v JOIN eletricistas e ON e.id = v.eletricista_id WHERE e.email = ?').get(x)));
  });

  test('material: a lista do trabalho com o que já foi levantado ou recebido, por trabalho', async () => {
    const e = await aprovado();
    const outro = await aprovado();
    const { id, tid } = await trabalhoDe(e);
    let f = await ficha(e, tid);
    assert.deepEqual(f.material, [{ nome: 'Quadro de 24 módulos', quantidade: 1, recebido: false }, { nome: 'Disjuntor 16 A', quantidade: 4, recebido: false }]);
    assert.equal(f.editavel, true);
    const r = await area(e, 'POST', `trabalhos/${tid}/material`, { recebido: ['Disjuntor 16 A'] });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json.trabalho.material.map((m) => m.recebido), [false, true]);
    for (const mau of [{ recebido: ['Outra coisa'] }, { recebido: 'Disjuntor 16 A' }, { recebido: [1] }, {}, { feito: [] }]) {
      assert.equal((await area(e, 'POST', `trabalhos/${tid}/material`, mau)).estado, 400, JSON.stringify(mau));
    }
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/material`, { recebido: [] })).estado, 404, 'outro eletricista');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/material`, { corpo: { recebido: [] } })).estado, 401);
    f = await ficha(e, tid);
    assert.deepEqual(f.material.filter((m) => m.recebido).map((m) => m.nome), ['Disjuntor 16 A']);
    const pn = (await atribuicao(id)).json.trabalho;
    assert.deepEqual(pn.material.map((m) => [m.nome, m.recebido]), [['Quadro de 24 módulos', false], ['Disjuntor 16 A', true]]);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/material`, { recebido: [] })).json.trabalho.material.some((m) => m.recebido), false);
  });

  test('fotos antes/depois: JPEG ou PNG verdadeiros até 1 MB, 4 por grupo, só para o eletricista do trabalho e para o CEO', async () => {
    const e = await aprovado();
    const outro = await aprovado();
    const c = await p.contaConfirmada();
    const { id, tid } = await trabalhoDe(e);
    const maus = [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 415],
      [Buffer.from('<html><script>alert(1)</script>'), 'image/jpeg', 415],
      [PNG, 'image/jpeg', 415],
      [PDF, 'application/pdf', 415],
      [Buffer.alloc(0), 'image/jpeg', 400],
      [Buffer.concat([JPEG, Buffer.alloc(FOTO_MAX_BYTES)]), 'image/jpeg', 413],
    ];
    for (const [bytes, tipo, estado] of maus) assert.equal((await enviarFoto(e, tid, 'quadro_antes', bytes, tipo)).estado, estado, `${tipo} ${bytes.length}`);
    assert.equal((await enviarFoto(e, tid, 'outro_grupo')).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos').get().n, 0);
    // Quem não é o eletricista do trabalho não envia nem vê.
    assert.equal((await enviarFoto(outro, tid, 'quadro_antes')).estado, 404);
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/quadro_antes`, { corpo: JPEG, tipo: 'image/jpeg' })).estado, 401);
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/quadro_antes`, { corpo: JPEG, tipo: 'image/jpeg', cookie: c.cookie })).estado, 401, 'sessão de cliente');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/quadro_antes`, { corpo: JPEG, tipo: 'image/jpeg', cookie: p.cookies.ceo })).estado, 401, 'sessão do painel');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/quadro_antes`, { corpo: JPEG, tipo: 'image/jpeg', cookie: e.cookie, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
    const r1 = await enviarFoto(e, tid, 'quadro_antes');
    assert.equal(r1.estado, 201, r1.texto);
    const r2 = await enviarFoto(e, tid, 'pontos_depois', PNG, 'image/png');
    assert.equal(r2.estado, 201);
    const f = await ficha(e, tid);
    assert.deepEqual(f.fotos.map((x) => [x.grupo, x.bytes]), [['quadro_antes', JPEG.length], ['pontos_depois', PNG.length]]);
    assert.deepEqual(f.grupos_fotos.map((g) => g.grupo), ['quadro_antes', 'pontos_antes', 'quadro_depois', 'pontos_depois']);
    assert.equal(f.fotos_max, FOTOS_POR_GRUPO);
    assert.equal(f.fotos[0].url, `/api/eletricista/trabalhos/${tid}/fotos/${r1.json.id}`);
    // No disco: fora da pasta pública, nome aleatório.
    const pasta = join(p.config.eletricistasDir, 'trabalhos', String(tid));
    assert.deepEqual((await readdir(pasta)).sort(), [`${r1.json.id}.jpg`, `${r2.json.id}.png`].sort());
    assert.match(r1.json.id, /^[a-f0-9]{24}$/);
    // Ver: o próprio (com nosniff e CSP sandbox), nunca outro eletricista, o cliente ou um anónimo.
    const ver = await p.pedir('GET', f.fotos[0].url, { cookie: e.cookie });
    assert.equal(ver.estado, 200);
    assert.ok(ver.bruto.equals(JPEG));
    assert.deepEqual([ver.cabecalhos['content-type'], ver.cabecalhos['x-content-type-options'], ver.cabecalhos['content-security-policy'], ver.cabecalhos['cache-control']],
      ['image/jpeg', 'nosniff', "default-src 'none'; sandbox", 'private, no-store']);
    assert.equal((await p.pedir('GET', f.fotos[1].url, { cookie: e.cookie })).cabecalhos['content-type'], 'image/png');
    for (const cookie of [outro.cookie, c.cookie, p.cookies.ceo, undefined]) {
      assert.ok([401, 404].includes((await p.pedir('GET', f.fotos[0].url, { cookie })).estado));
    }
    assert.equal((await p.pedir('GET', f.fotos[0].url, { cookie: outro.cookie })).estado, 404);
    assert.equal((await area(e, 'GET', `trabalhos/${tid}/fotos/${'0'.repeat(24)}`)).estado, 404);
    // A foto de outro trabalho não sai pelo endereço deste.
    const outroTrabalho = await trabalhoDe(outro);
    assert.equal((await enviarFoto(outro, outroTrabalho.tid, 'quadro_antes')).estado, 201);
    const alheia = (await ficha(outro, outroTrabalho.tid)).fotos[0];
    assert.equal((await area(e, 'GET', `trabalhos/${tid}/fotos/${alheia.id}`)).estado, 404);
    assert.equal((await area(e, 'GET', `trabalhos/${outroTrabalho.tid}/fotos/${alheia.id}`)).estado, 404);
    // Painel: só o CEO.
    const pn = (await atribuicao(id)).json.trabalho;
    assert.deepEqual(pn.fotos.map((x) => [x.grupo, x.grupo_nome]), [['quadro_antes', 'Quadro — antes'], ['pontos_depois', 'Pontos — depois']]);
    assert.equal(pn.fotos[0].url, `/painel/api/trabalhos-eletricista/${tid}/fotos/${r1.json.id}`);
    const verCeo = await p.pedir('GET', pn.fotos[0].url, { cookie: p.cookies.ceo });
    assert.deepEqual([verCeo.estado, verCeo.cabecalhos['content-type'], verCeo.cabecalhos['x-content-type-options']], [200, 'image/jpeg', 'nosniff']);
    assert.ok(verCeo.bruto.equals(JPEG));
    for (const papel of ['comercial', 'tecnico']) assert.equal((await painel('GET', `trabalhos-eletricista/${tid}/fotos/${r1.json.id}`, papel)).estado, 403);
    assert.equal((await p.pedir('GET', pn.fotos[0].url)).estado, 401);
    assert.equal((await p.pedir('GET', pn.fotos[0].url, { cookie: e.cookie })).estado, 401, 'a sessão do eletricista não abre o painel');
    assert.equal((await painel('GET', `trabalhos-eletricista/${outroTrabalho.tid}/fotos/${r1.json.id}`)).estado, 404);
    // Máximo por grupo; apagar liberta.
    for (let i = 1; i < FOTOS_POR_GRUPO; i++) assert.equal((await enviarFoto(e, tid, 'quadro_antes')).estado, 201);
    const cheio = await enviarFoto(e, tid, 'quadro_antes');
    assert.equal(cheio.estado, 409);
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/fotos/${r1.json.id}/apagar`, {})).estado, 404);
    const ap = await area(e, 'POST', `trabalhos/${tid}/fotos/${r1.json.id}/apagar`, {});
    assert.equal(ap.estado, 200);
    assert.equal(ap.json.trabalho.fotos.some((x) => x.id === r1.json.id), false);
    assert.equal(existsSync(join(pasta, `${r1.json.id}.jpg`)), false);
    assert.equal((await enviarFoto(e, tid, 'quadro_antes')).estado, 201);
    // As fotos do trabalho saem com o pedido quando a conta do cliente é apagada (RGPD).
    await p.app.api.eletricistas.apagarFotosDoPedido(id);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos WHERE trabalho_id = ?').get(tid).n, 0);
    assert.equal(existsSync(pasta), false);
  });

  test('ensaios: ficam no pedido; fora do limite não é recusado mas pede uma nota; o painel vê os valores assinalados', async () => {
    const e = await aprovado();
    const outro = await aprovado();
    const { id, tid } = await trabalhoDe(e);
    let f = await ficha(e, tid);
    assert.deepEqual(f.ensaios.limites, { isolamento_min: 0.5, diferencial_max: 300, terra_max: 100 });
    assert.deepEqual([f.ensaios.isolamento, f.ensaios.fora], [null, []]);
    const bons = { continuidade_pe: 0.4, isolamento: 250, terra: 100, diferencial: 300 };
    const r = await area(e, 'POST', `trabalhos/${tid}/ensaios`, bons);
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.trabalho.ensaios.isolamento, r.json.trabalho.ensaios.terra, r.json.trabalho.ensaios.diferencial, r.json.trabalho.ensaios.fora], [250, 100, 300, []], 'no limite conta como dentro');
    // Fora do limite, sem nota: 400; com nota: guardado e assinalado.
    for (const [mau, nome] of [[{ isolamento: 0.3 }, 'isolamento'], [{ diferencial: 301 }, 'diferencial'], [{ terra: 100.5 }, 'terra']]) {
      const x = await area(e, 'POST', `trabalhos/${tid}/ensaios`, { ...bons, ...mau });
      assert.equal(x.estado, 400, nome);
      assert.match(x.json.erro, /fora do limite.*nota/i);
    }
    const comNota = await area(e, 'POST', `trabalhos/${tid}/ensaios`, { ...bons, terra: 180, diferencial: 420, notas: 'Terra alta: elétrodo antigo, a reforçar.' });
    assert.equal(comNota.estado, 200, comNota.texto);
    assert.deepEqual(comNota.json.trabalho.ensaios.fora, ['diferencial', 'terra']);
    for (const mau of [{ isolamento: -1 }, { isolamento: 'muito' }, { outro: 1 }, { terra: 2_000_000 }]) assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, mau)).estado, 400, JSON.stringify(mau));
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/ensaios`, bons)).estado, 404);
    // Ficam no pedido (os mesmos que o painel regista e que o relatório completo do cliente mostra).
    const ped = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.ensaios.isolamento, ped.ensaios.terra, ped.ensaios.diferencial, ped.ensaios.continuidade_pe], [250, 180, 420, 0.4]);
    const pn = (await atribuicao(id)).json.trabalho;
    assert.deepEqual([pn.ensaios.fora, pn.ensaios.notas], [['diferencial', 'terra'], 'Terra alta: elétrodo antigo, a reforçar.']);
    const aud = p.app.db.prepare("SELECT email, detalhes FROM auditoria WHERE acao = 'ensaios_registados' AND alvo = ? ORDER BY id DESC LIMIT 1").get(`orcamento:${id}`);
    assert.equal(aud.email, `eletricista:${e.id}`);
    // Os limites vêm da configuração do painel.
    await painel('POST', 'config-orcamento', 'ceo', { ensaio_terra_ohm: 200 });
    assert.deepEqual((await ficha(e, tid)).ensaios.fora, ['diferencial']);
    await painel('POST', 'config-orcamento', 'ceo', { ensaio_terra_ohm: 100 });
    // Diagnóstico: só nos trabalhos de avaria.
    f = await ficha(e, tid);
    assert.equal(f.diagnostico, null);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/diagnostico`, { diagnostico: { verificacoes: ['visual'], conclusao: 'x' } })).estado, 409);
  });

  test('obra concluída: só com a visita marcada, uma foto de antes, uma de depois e os três ensaios; depois fica à espera do cliente e só de leitura', async () => {
    const e = await aprovado({ nome: 'Zeferino Eletricista Externo' });
    const outro = await aprovado();
    const { id, tid } = await trabalhoDe(e, { visita: false });
    const concluir = (quem = e) => area(quem, 'POST', `trabalhos/${tid}/concluir`, {});
    let f = await ficha(e, tid);
    assert.deepEqual(f.falta, ['marcar a visita', 'uma foto de antes', 'uma foto de depois', 'ensaio: resistência de isolamento', 'ensaio: disparo do diferencial', 'ensaio: resistência de terra']);
    let r = await concluir();
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /Ainda falta: marcar a visita; uma foto de antes/);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    assert.equal((await enviarFoto(e, tid, 'pontos_antes')).estado, 201);
    assert.match((await concluir()).json.erro, /^Ainda falta: uma foto de depois; ensaio/);
    assert.equal((await enviarFoto(e, tid, 'quadro_depois', PNG, 'image/png')).estado, 201);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40 })).estado, 200);
    r = await concluir();
    assert.equal(r.estado, 409);
    assert.equal(r.json.erro, 'Ainda falta: ensaio: disparo do diferencial.');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    assert.deepEqual((await ficha(e, tid)).falta, []);
    assert.equal((await concluir(outro)).estado, 404, 'outro eletricista');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/concluir`, { corpo: {} })).estado, 401);
    p.emails.length = 0;
    r = await concluir();
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.trabalho.estado, r.json.trabalho.editavel, r.json.trabalho.aberto, r.json.trabalho.falta], ['concluida_eletricista', false, true, []]);
    assert.ok(Math.abs(Date.parse(r.json.trabalho.concluida) - p.relogio.agora()) < 5000);
    assert.equal(r.json.trabalho.cliente.nome, CLIENTE.nome, 'o cliente continua à vista até a obra fechar');
    // Emails: os CEO e o cliente (em nome da Domus, sem o eletricista).
    assert.deepEqual(p.emails.map((m) => m.para).sort(), ['ceo@domus.teste', 'cliente.obra@exemplo.pt']);
    const aoCliente = p.emails.find((m) => m.para === 'cliente.obra@exemplo.pt');
    assert.match(aoCliente.texto, /confirme na sua conta/);
    assert.ok(!aoCliente.texto.includes('Zeferino') && !aoCliente.texto.includes(e.email));
    assert.ok(!p.emails.find((m) => m.para === 'ceo@domus.teste').texto.includes('Carla'));
    assert.deepEqual({ ...p.app.db.prepare('SELECT evento, eletricista_id FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? ORDER BY id DESC LIMIT 1').get(tid) }, { evento: 'concluida', eletricista_id: e.id });
    // Só de leitura: nada muda depois de concluída.
    assert.equal((await concluir()).estado, 409);
    for (const [caminho, corpo] of [['material', { recebido: [] }], ['ensaios', { isolamento: 1 }], ['visita', { data_visita: lisboa(p.relogio.agora() + 50 * HORA) }], ['largar', {}],
      [`fotos/${r.json.trabalho.fotos[0].id}/apagar`, {}]]) {
      const x = await area(e, 'POST', `trabalhos/${tid}/${caminho}`, corpo);
      assert.equal(x.estado, 409, caminho);
      assert.match(x.json.erro, /concluído/);
    }
    assert.equal((await enviarFoto(e, tid, 'quadro_antes')).estado, 409);
    assert.equal((await p.pedir('GET', r.json.trabalho.fotos[0].url, { cookie: e.cookie })).estado, 200, 'continua a ver as suas fotos');
    // Continua nos trabalhos dele e não caduca nem volta à bolsa.
    p.relogio.avancar(PRAZO_VISITA_MS + HORA);
    p.app.api.eletricistas.expirar();
    assert.deepEqual((await area(e, 'GET', 'trabalhos')).json.trabalhos.filter((x) => x.id === tid).map((x) => x.estado), ['concluida_eletricista']);
    // Painel: estado, fotos, ensaios e material; o pedido e a obra ficam como estavam (a confirmação do cliente é da ronda 3).
    const pn = (await atribuicao(id)).json.trabalho;
    assert.deepEqual([pn.estado, pn.fotos.length, pn.ensaios.diferencial, pn.falta, pn.eletricista.id], ['concluida_eletricista', 2, 28, [], e.id]);
    assert.ok(pn.concluida);
    const ped = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.estado, ped.obra_concluida, ped.obra.estado], ['aceite', null, 'agendada']);
    assert.equal((await atribuicao(id, { acao: 'bolsa' })).estado, 409, 'continua atribuído');
    // Suspender: o painel lista os trabalhos em curso (este conta); o CEO pode retirar cada um.
    const lista = (await painel('GET', 'eletricistas')).json.eletricistas.find((x) => x.id === e.id);
    assert.deepEqual(lista.trabalhos.map((t) => [t.id, t.orcamento_id, t.tipo, t.estado, t.concelho]), [[tid, id, 'obra', 'concluida_eletricista', 'Sintra']]);
    assert.equal(lista.trabalhos_em_curso, 1);
    assert.equal((await atribuicao(id, { acao: 'retirar' })).estado, 200);
    assert.deepEqual((await painel('GET', `eletricistas/${e.id}`)).json.eletricista.trabalhos, []);
    assert.equal((await area(e, 'GET', `trabalhos/${tid}`)).estado, 404);
  });

  test('avaria e visita técnica: concluir pede o mesmo que a obra (visita marcada, foto de antes, foto de depois e os três ensaios); a avaria também a conclusão do diagnóstico', async () => {
    const e = await aprovado();
    const c = await p.contaConfirmada();
    const av = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
    assert.equal(av.estado, 202, av.texto);
    const pago = await p.pedir('POST', `/api/conta/pagamentos/${av.json.pagamento.ref}/simular`, { cookie: c.cookie, corpo: { resultado: 'sucesso' } });
    const id = pago.json.pagamento.orcamento_id;
    const tid = (await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    let f = await ficha(e, tid);
    const ENSAIOS = ['ensaio: resistência de isolamento', 'ensaio: disparo do diferencial', 'ensaio: resistência de terra'];
    assert.deepEqual(f.falta, ['uma foto de antes', 'uma foto de depois', ...ENSAIOS, 'a conclusão do diagnóstico']);
    assert.equal(f.diagnostico.atual, null);
    assert.deepEqual(f.diagnostico.modelo.checklist.map((x) => x.chave), ['isolado', 'visual', 'rcd', 'tensao', 'continuidade', 'isolamento', 'funcional']);
    assert.equal(f.diagnostico.modelo.tipos.aberto, 'Circuito aberto');
    for (const mau of [{ diagnostico: { verificacoes: ['inventada'] } }, { diagnostico: { tipo: 'outro_tipo' } }, { diagnostico: { valores: { tensao: -5 } } }, { diagnostico: 'texto' }, { outro: 1 }]) {
      assert.equal((await area(e, 'POST', `trabalhos/${tid}/diagnostico`, mau)).estado, 400, JSON.stringify(mau));
    }
    const d = await area(e, 'POST', `trabalhos/${tid}/diagnostico`, { diagnostico: { verificacoes: ['isolado', 'visual'], valores: { tensao: 0 }, tipo: 'aberto', conclusao: 'Borne solto na caixa de derivação: reapertado.' } });
    assert.equal(d.estado, 200, d.texto);
    assert.deepEqual([d.json.trabalho.diagnostico.atual.tipo, d.json.trabalho.diagnostico.atual.verificacoes, d.json.trabalho.falta], ['aberto', ['isolado', 'visual', 'tensao'], ['uma foto de antes', 'uma foto de depois', ...ENSAIOS]]);
    assert.ok(!('por' in d.json.trabalho.diagnostico.atual));
    const ped = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.diagnostico.tipo, ped.diagnostico.por], ['aberto', `eletricista:${e.id}`]);
    assert.equal((await enviarFoto(e, tid, 'pontos_antes')).estado, 201);
    let r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.deepEqual([r.estado, r.json.erro], [409, `Ainda falta: uma foto de depois; ${ENSAIOS.join('; ')}.`], 'só a foto de antes e o diagnóstico não chegam');
    assert.equal((await enviarFoto(e, tid, 'pontos_depois')).estado, 201);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 409, 'faltam os ensaios');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    p.emails.length = 0;
    r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.trabalho.estado, 'concluida_eletricista');
    assert.ok(p.emails.some((m) => m.para === c.email && /confirme na sua conta/.test(m.texto)));
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/diagnostico`, { diagnostico: null })).estado, 409);
    assert.equal((await atribuicao(id)).json.trabalho.diagnostico, true);
    // Visita técnica paga: o mesmo que a obra (sem diagnóstico).
    const c2 = await p.contaConfirmada();
    const vis = await p.pedir('POST', '/api/orcamento', { cookie: c2.cookie, corpo: { ...CLIENTE, servico: 'Casa', localidade: 'Sintra', simulacao: sim(), compra: 'visita' } });
    await p.pedir('POST', `/api/conta/pagamentos/${vis.json.pagamento.ref}/simular`, { cookie: c2.cookie, corpo: { resultado: 'sucesso' } });
    const tv = (await atribuicao(vis.json.pedido, { acao: 'atribuir', eletricista_id: e.id })).json.trabalho.id;
    assert.deepEqual((await ficha(e, tv)).falta, ['marcar a visita', 'uma foto de antes', 'uma foto de depois', ...ENSAIOS]);
    assert.equal((await area(e, 'POST', `trabalhos/${tv}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    assert.equal((await enviarFoto(e, tv, 'quadro_antes')).estado, 201);
    assert.equal((await area(e, 'POST', `trabalhos/${tv}/concluir`, {})).estado, 409, 'a foto de antes já não chega');
    assert.equal((await enviarFoto(e, tv, 'quadro_depois')).estado, 201);
    assert.equal((await area(e, 'POST', `trabalhos/${tv}/ensaios`, { isolamento: 200, terra: 100, diferencial: 28 })).estado, 200);
    assert.deepEqual((await ficha(e, tv)).falta, []);
    assert.equal((await area(e, 'POST', `trabalhos/${tv}/concluir`, {})).estado, 200);
  });

  test('apagar eletricista (RGPD, só CEO, com confirmação): sem trabalhos a linha sai; com histórico fica anonimizado; o documento e as sessões saem sempre', async () => {
    // Sem histórico nenhum: apagado por inteiro.
    const novo = await aprovado();
    const pastaDoc = join(p.config.eletricistasDir, String(novo.id));
    assert.equal(existsSync(pastaDoc), true);
    for (const papel of ['comercial', 'tecnico']) assert.equal((await painel('POST', `eletricistas/${novo.id}/apagar`, papel, { email: novo.email })).estado, 403);
    assert.equal((await p.pedir('POST', `/painel/api/eletricistas/${novo.id}/apagar`, { corpo: { email: novo.email } })).estado, 401);
    assert.equal((await painel('POST', `eletricistas/${novo.id}/apagar`, 'ceo', { email: 'outro@exemplo.pt' })).estado, 400, 'confirma-se com o email');
    assert.equal((await painel('POST', `eletricistas/${novo.id}/apagar`, 'ceo', {})).estado, 400);
    const r = await painel('POST', `eletricistas/${novo.id}/apagar`, 'ceo', { email: novo.email.toUpperCase() });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.modo, r.json.eletricistas.some((x) => x.id === novo.id)], ['apagado', false]);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM eletricistas WHERE id = ?').get(novo.id).n, 0);
    assert.equal(existsSync(pastaDoc), false, 'o documento do seguro sai');
    assert.equal((await area(novo, 'GET', 'eu')).estado, 401);
    assert.equal((await painel('GET', `eletricistas/${novo.id}/seguro`)).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE alvo = ? AND acao != ?').get(`eletricista:${novo.id}`, 'eletricista_apagado').n, 0);
    // Com trabalhos em curso: recusa até o CEO os retirar.
    const e = await aprovado({ nome: 'Henrique Com Historico' });
    const { id, tid } = await trabalhoDe(e);
    assert.equal((await enviarFoto(e, tid, 'quadro_antes')).estado, 201);
    const rec = await painel('POST', `eletricistas/${e.id}/apagar`, 'ceo', { email: e.email });
    assert.equal(rec.estado, 409);
    assert.match(rec.json.erro, /trabalhos em curso/);
    assert.equal((await atribuicao(id, { acao: 'retirar' })).estado, 200);
    const an = await painel('POST', `eletricistas/${e.id}/apagar`, 'ceo', { email: e.email });
    assert.equal(an.estado, 200, an.texto);
    assert.equal(an.json.modo, 'anonimizado');
    const linha = { ...p.app.db.prepare('SELECT * FROM eletricistas WHERE id = ?').get(e.id) };
    assert.deepEqual([linha.nome, linha.email, linha.telefone, linha.nif, linha.dgeg, linha.concelhos, linha.estado, linha.seguro_id, linha.notas, linha.experiencia],
      ['Eletricista apagado (RGPD)', `apagado-${e.id}@anonimizado.invalid`, '', '', '', '[]', 'suspenso', null, null, null]);
    assert.ok(linha.anonimizado);
    assert.equal(existsSync(join(p.config.eletricistasDir, String(e.id))), false);
    assert.equal(JSON.stringify(an.json).includes('Henrique') || JSON.stringify(an.json).includes(e.email), false);
    // O histórico dos trabalhos fica (eventos, fotos do trabalho), sem a identidade.
    assert.ok(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_eventos WHERE eletricista_id = ?').get(e.id).n >= 2);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos WHERE trabalho_id = ?').get(tid).n, 1);
    assert.equal((await atribuicao(id)).json.historico[0].eletricista, 'Eletricista apagado (RGPD)');
    // Não entra, não se altera, não se apaga outra vez, e o email fica livre para uma candidatura nova.
    assert.equal((await area(e, 'GET', 'eu')).estado, 401);
    p.emails.length = 0;
    await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } });
    assert.equal(p.emails.length, 0);
    for (const corpo of [{ acao: 'reativar' }, { percentagem: 50 }, { concelhos: ['Sintra'] }]) assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', corpo)).estado, 409);
    assert.equal((await painel('POST', `eletricistas/${e.id}/apagar`, 'ceo', { email: linha.email })).estado, 409);
    assert.equal((await atribuicao(await obra(), { acao: 'atribuir', eletricista_id: e.id })).estado, 409);
    const ficha = (await painel('GET', `eletricistas/${e.id}`)).json.eletricista;
    assert.deepEqual([ficha.nome, ficha.seguro, ficha.estado], ['Eletricista apagado (RGPD)', null, 'suspenso']);
    assert.ok(ficha.anonimizado);
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: { nome: 'Henrique Outra Vez', email: e.email, telefone: '910 000 000', nif: '123456789', dgeg: 'TR-9', concelhos: ['Sintra'],
      seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true } })).estado, 201);
    assert.equal(p.app.db.prepare("SELECT estado FROM eletricistas WHERE email = ?").get(e.email).estado, 'pendente');
  });
});
