// Procedimentos (SOP) e checklists por obra (docs/PROCEDIMENTOS.md; src/procedimentos.js): as sementes da migração 36
// (seis rascunhos, uma vez), quem vê rascunhos e publicados (CEO, técnico, comercial, eletricista externo, módulo
// desligado), só o CEO edita e publica, a versão que sobe e a checklist presa à sua versão, quem marca os passos (com
// quem e quando), os obrigatórios em falta na lista de obras e na tarefa "Confirmar obra concluída" do CEO.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema, abrirDb, TIPOS_PROCEDIMENTO } from '../src/db.js';
import { validarPassos, MAX_PASSOS, MAX_PASSO, MAX_TITULO, NOTA_RASCUNHO } from '../src/procedimentos.js';
import { SEMENTES_PROCEDIMENTOS } from '../src/procedimentos-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const PASSOS = [
  { texto: 'Cortar e bloquear a alimentação', nota: 'Sinalizar o disjuntor.', obrigatorio: true, seguranca: true },
  { texto: 'Fazer o trabalho', nota: null, obrigatorio: false, seguranca: false },
  { texto: 'Registar os ensaios', nota: null, obrigatorio: true, seguranca: false },
];

test('migração 36: seis rascunhos por rever, uma só vez; os passos de segurança são obrigatórios e respeitam os limites', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.ok(MIGRACOES.length >= 36);
  const todos = () => db.prepare('SELECT * FROM procedimentos ORDER BY id').all();
  assert.equal(todos().length, 6);
  assert.deepEqual(todos().map((p) => p.titulo), ['Visita técnica', 'Diagnóstico de avaria', 'Substituição de quadro elétrico',
    'Instalação de aparelhos inteligentes (relés e medidores no quadro)', 'Instalação de carregador de veículo elétrico', 'Entrega ao cliente (app, conta, explicação)']);
  for (const p of todos()) {
    assert.deepEqual([p.estado, p.versao, p.por_rever], ['rascunho', 0, 1], p.titulo);
    assert.ok(TIPOS_PROCEDIMENTO.includes(p.tipo));
    assert.ok(p.titulo.length <= MAX_TITULO);
    const passos = JSON.parse(p.passos);
    // As sementes passam na mesma validação do editor do CEO (comprimentos, máximo de passos) e ficam iguais.
    assert.deepEqual(validarPassos(passos), passos, p.titulo);
    assert.ok(passos.length >= 10 && passos.length <= MAX_PASSOS);
    assert.ok(passos.some((x) => x.seguranca), `${p.titulo}: tem passos de segurança`);
    assert.ok(passos.every((x) => !x.seguranca || x.obrigatorio), `${p.titulo}: segurança é sempre obrigatório`);
    // Sem artigos de regulamento nem valores fora dos que o painel já usa.
    assert.doesNotMatch(p.passos, /RTIEBT|artigo|\d{3}\.\d/i);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procedimentos_versoes').get().n, 0);
  assert.equal(SEMENTES_PROCEDIMENTOS.length, 6);
  // Nunca mais: migrar outra vez não volta a semear, nem depois de o CEO mexer na tabela.
  migrar(db);
  assert.equal(todos().length, 6);
  db.prepare('DELETE FROM procedimentos WHERE id = 6').run();
  migrar(db);
  assert.equal(todos().length, 5);
  // Restrições do esquema: estado e tipo conhecidos; cada procedimento uma vez por obra.
  assert.throws(() => db.prepare("UPDATE procedimentos SET estado = 'outro' WHERE id = 1").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE procedimentos SET tipo = 'outra-coisa' WHERE id = 1").run(), /CHECK/);
  db.close();
  // Num ficheiro, abrir a base outra vez (reiniciar o painel) também não semeia de novo.
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'domus-proc-'));
  const a = abrirDb(join(dir, 'painel.db'));
  a.prepare('DELETE FROM procedimentos WHERE id > 2').run();
  a.close();
  const b = abrirDb(join(dir, 'painel.db'));
  assert.equal(b.prepare('SELECT COUNT(*) AS n FROM procedimentos').get().n, 2);
  b.close();
  await rm(dir, { recursive: true, force: true });
});

describe('procedimentos e checklists por obra', () => {
  let p;
  let seq = 0;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  const api = (papel, metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  /** Procedimento novo do CEO (rascunho); com `publicar`, já publicado. Devolve o id. */
  async function procedimento(titulo, { passos = PASSOS, publicar = true } = {}) {
    const r = await api('ceo', 'POST', 'procedimentos', { titulo, tipo: 'quadro', descricao: 'Para os testes.', passos });
    assert.equal(r.estado, 201, r.texto);
    if (publicar) assert.equal((await api('ceo', 'POST', `procedimentos/${r.json.id}/estado`, { acao: 'publicar' })).estado, 200);
    return r.json.id;
  }
  /** Pedido aceite com a sua obra (nasce ao aceitar) e, com `tecnico`, atribuída a esse técnico. Devolve {pedido, obra}. */
  async function obraNova({ tecnico = null, localidade = 'Sintra' } = {}) {
    const n = ++seq;
    const r = await api('ceo', 'POST', 'orcamentos', { nome: `Cliente Checklist ${n}`, telefone: '912 345 678', email: `cliente.checklist.${n}@exemplo.pt`, localidade, servico: 'Quadro novo' });
    assert.equal(r.estado, 201, r.texto);
    assert.equal((await api('ceo', 'POST', `orcamentos/${r.json.id}`, { proposta_mao_obra: 400, proposta_material: 300, proposta_deslocacao: 20 })).estado, 200);
    assert.equal((await api('ceo', 'POST', `orcamentos/${r.json.id}`, { estado: 'aceite' })).estado, 200);
    const obra = (await api('ceo', 'GET', `orcamentos/${r.json.id}`)).json.obra_id;
    if (tecnico) assert.equal((await api('ceo', 'POST', `obras/${obra}`, { tecnicos: [tecnico] })).estado, 200);
    return { pedido: r.json.id, obra };
  }
  /** Eletricista externo aprovado, com a sessão aberta. */
  async function eletricista() {
    const n = ++seq;
    const c = { nome: `Eletricista Checklist ${n}`, email: `eletricista.checklist.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${3000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await api('ceo', 'POST', `eletricistas/${id}`, { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...c, id, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }

  test('rascunhos: só o CEO os vê (com a nota "por rever"); técnico, comercial e eletricista só os publicados', async () => {
    const e = await eletricista();
    let r = await api('ceo', 'GET', 'procedimentos');
    assert.equal(r.estado, 200);
    assert.equal(r.json.procedimentos.length, 6);
    assert.ok(r.json.procedimentos.every((x) => x.estado === 'rascunho' && x.por_rever && x.aviso === NOTA_RASCUNHO && x.versao === 0 && x.por_publicar));
    const visita = r.json.procedimentos.find((x) => x.titulo === 'Visita técnica').id;
    r = await api('ceo', 'GET', `procedimentos/${visita}`);
    assert.equal(r.json.aviso, 'Rascunho por rever: os passos de segurança têm de ser validados pelo responsável técnico antes de publicar.');
    assert.ok(r.json.passos.length >= 10);
    for (const papel of ['tecnico', 'comercial']) {
      assert.deepEqual((await api(papel, 'GET', 'procedimentos')).json.procedimentos, [], papel);
      r = await api(papel, 'GET', `procedimentos/${visita}`);
      assert.deepEqual([r.estado, r.json.erro], [404, 'Procedimento não encontrado.'], papel);
    }
    assert.deepEqual((await area(e, 'GET', 'procedimentos')).json.procedimentos, []);
    assert.equal((await area(e, 'GET', `procedimentos/${visita}`)).estado, 404);
    assert.equal((await p.pedir('GET', '/api/eletricista/procedimentos')).estado, 401, 'sem sessão de eletricista');
    assert.equal((await p.pedir('GET', '/api/eletricista/procedimentos', { cookie: p.cookies.ceo })).estado, 401, 'a sessão do painel não serve');

    // Publicado: todos o leem, na versão 1, com a data e quem publicou (o eletricista sem o nome de quem publicou).
    r = await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'publicar' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.estado, r.json.versao, r.json.por_rever, r.json.aviso, r.json.por_publicar, r.json.publicado_por], ['publicado', 1, false, null, false, 'ceo teste']);
    for (const papel of ['tecnico', 'comercial']) {
      const lista = (await api(papel, 'GET', 'procedimentos')).json.procedimentos;
      assert.deepEqual(lista.map((x) => [x.id, x.versao, x.estado, x.publicado_por]), [[visita, 1, 'publicado', 'ceo teste']], papel);
      r = await api(papel, 'GET', `procedimentos/${visita}`);
      assert.equal(r.estado, 200);
      assert.ok(r.json.passos.some((x) => x.seguranca && x.obrigatorio) && typeof r.json.publicado === 'string');
      assert.ok(!('por_rever' in r.json) && !('por_publicar' in r.json));
    }
    r = await area(e, 'GET', 'procedimentos');
    assert.deepEqual(r.json.procedimentos.map((x) => [x.id, x.versao]), [[visita, 1]]);
    assert.ok(!('publicado_por' in r.json.procedimentos[0]));
    r = await area(e, 'GET', `procedimentos/${visita}`);
    assert.equal(r.estado, 200);
    assert.ok(r.json.procedimento.passos.length >= 10 && !('publicado_por' in r.json.procedimento));

    // Arquivado: sai para todos menos para o CEO; reposto volta a rascunho e publica-se sem subir a versão (nada mudou).
    assert.equal((await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'arquivar' })).json.estado, 'arquivado');
    assert.deepEqual((await api('tecnico', 'GET', 'procedimentos')).json.procedimentos, []);
    assert.equal((await api('tecnico', 'GET', `procedimentos/${visita}`)).estado, 404);
    assert.equal((await area(e, 'GET', `procedimentos/${visita}`)).estado, 404);
    assert.equal((await api('ceo', 'POST', `procedimentos/${visita}`, { titulo: 'Outro' })).estado, 409, 'arquivado não se altera');
    assert.equal((await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'publicar' })).estado, 409);
    assert.equal((await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'repor' })).json.estado, 'rascunho');
    assert.deepEqual((await api('comercial', 'GET', 'procedimentos')).json.procedimentos, []);
    r = await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'publicar' });
    assert.deepEqual([r.json.estado, r.json.versao], ['publicado', 1]);
    assert.equal((await api('ceo', 'POST', `procedimentos/${visita}/estado`, { acao: 'arquivar' })).estado, 200);
  });

  test('só o CEO cria, edita, publica e arquiva; validação com limites; nada de textos na auditoria', async () => {
    const id = await procedimento('Só o CEO edita', { publicar: false });
    for (const papel of ['tecnico', 'comercial']) {
      assert.equal((await api(papel, 'POST', 'procedimentos', { titulo: 'X', tipo: 'outro' })).estado, 403, papel);
      assert.equal((await api(papel, 'POST', `procedimentos/${id}`, { titulo: 'X' })).estado, 403, papel);
      assert.equal((await api(papel, 'POST', `procedimentos/${id}/estado`, { acao: 'publicar' })).estado, 403, papel);
    }
    assert.equal(p.app.db.prepare('SELECT titulo FROM procedimentos WHERE id = ?').get(id).titulo, 'Só o CEO edita');
    // Não há sugestões nem escrita na área do eletricista: as rotas não existem.
    const e = await eletricista();
    assert.equal((await area(e, 'POST', 'procedimentos', { titulo: 'X', tipo: 'outro' })).estado, 405);
    assert.equal((await area(e, 'POST', `procedimentos/${id}`, { titulo: 'X' })).estado, 405);
    assert.equal((await area(e, 'POST', `procedimentos/${id}/sugestao`, { texto: 'X' })).estado, 404);
    // Limites.
    const mau = (corpo) => api('ceo', 'POST', 'procedimentos', { titulo: 'T', tipo: 'outro', ...corpo });
    assert.equal((await mau({ titulo: 'a'.repeat(MAX_TITULO + 1) })).estado, 400);
    assert.equal((await mau({ titulo: '' })).estado, 400);
    assert.equal((await mau({ tipo: 'inventado' })).estado, 400);
    assert.equal((await mau({ descricao: 'a'.repeat(601) })).estado, 400);
    assert.equal((await mau({ passos: Array.from({ length: MAX_PASSOS + 1 }, () => ({ texto: 'x' })) })).estado, 400);
    assert.equal((await mau({ passos: [{ texto: 'a'.repeat(MAX_PASSO + 1) }] })).estado, 400);
    assert.equal((await mau({ passos: [{ texto: '' }] })).estado, 400);
    assert.equal((await mau({ passos: [{ texto: 'ok', nota: 'a'.repeat(1001) }] })).estado, 400);
    assert.equal((await mau({ passos: [{ texto: 'ok', obrigatorio: 'sim' }] })).estado, 400);
    assert.equal((await mau({ passos: [{ texto: 'ok', html: '<b>' }] })).estado, 400);
    assert.equal((await mau({ estado: 'publicado' })).estado, 400, 'o estado só muda pela rota própria');
    let r = await mau({ passos: Array.from({ length: MAX_PASSOS }, (_, i) => ({ texto: `Passo ${i + 1}` })) });
    assert.equal(r.estado, 201);
    assert.deepEqual(r.json.passos[0], { texto: 'Passo 1', nota: null, obrigatorio: false, seguranca: false });
    // Sem passos não se publica.
    r = await mau({});
    assert.equal((await api('ceo', 'POST', `procedimentos/${r.json.id}/estado`, { acao: 'publicar' })).estado, 400);
    assert.equal((await api('ceo', 'POST', `procedimentos/${r.json.id}/estado`, { acao: 'apagar' })).estado, 400);
    assert.equal((await api('ceo', 'POST', 'procedimentos/99999/estado', { acao: 'publicar' })).estado, 404);
    // Auditoria: só números e nomes de campos.
    const linhas = p.app.db.prepare("SELECT acao, detalhes FROM auditoria WHERE acao LIKE 'procedimento_%'").all();
    assert.ok(linhas.some((l) => l.acao === 'procedimento_criado'));
    for (const l of linhas) assert.doesNotMatch(l.detalhes ?? '', /Cortar|Passo 1|Só o CEO|Para os testes/);
  });

  test('publicar um procedimento alterado sobe a versão; a checklist já começada fica na versão com que começou', async () => {
    const id = await procedimento('Versões');
    const { obra } = await obraNova({ tecnico: p.u.tecnico.id });
    let r = await api('tecnico', 'POST', `obras/${obra}/checklists`, { procedimento_id: id });
    assert.equal(r.estado, 201, r.texto);
    const lista = r.json.checklists[0];
    assert.deepEqual([lista.versao, lista.total, lista.feitos, lista.obrigatorios_falta, lista.versao_recente], [1, 3, 0, 2, null]);
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists/${lista.id}`, { passo: 1, feito: true })).estado, 200);
    // Sem alterações não há versão nova.
    assert.equal((await api('ceo', 'POST', `procedimentos/${id}/estado`, { acao: 'publicar' })).estado, 409);
    // O CEO muda a cópia de trabalho: a equipa continua a ver a versão 1 até ele publicar.
    const novos = [{ texto: 'Passo novo no início', obrigatorio: true }, ...PASSOS];
    r = await api('ceo', 'POST', `procedimentos/${id}`, { titulo: 'Versões (revisto)', passos: novos });
    assert.deepEqual([r.estado, r.json.versao, r.json.por_publicar, r.json.estado, r.json.em_obras], [200, 1, true, 'publicado', 1]);
    r = await api('tecnico', 'GET', `procedimentos/${id}`);
    assert.deepEqual([r.json.titulo, r.json.versao, r.json.passos.length], ['Versões', 1, 3]);
    r = await api('ceo', 'POST', `procedimentos/${id}/estado`, { acao: 'publicar' });
    assert.deepEqual([r.json.versao, r.json.por_publicar], [2, false]);
    r = await api('tecnico', 'GET', `procedimentos/${id}`);
    assert.deepEqual([r.json.titulo, r.json.versao, r.json.passos.length], ['Versões (revisto)', 2, 4]);
    // A checklist da obra: versão 1, os mesmos 3 passos e a marca feita; sabe que há uma versão mais recente.
    r = await api('tecnico', 'GET', `obras/${obra}/checklists`);
    const c = r.json.checklists[0];
    assert.deepEqual([c.titulo, c.versao, c.total, c.feitos, c.versao_recente], ['Versões', 1, 3, 1, 2]);
    assert.deepEqual(c.passos.map((x) => x.texto), PASSOS.map((x) => x.texto));
    assert.equal(c.passos[1].feito, true);
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists/${c.id}`, { passo: 3, feito: true })).estado, 400, 'o passo 4 só existe na versão 2');
    // Cada procedimento uma vez por obra; numa obra nova começa já na versão 2.
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists`, { procedimento_id: id })).estado, 409);
    const outra = await obraNova({ tecnico: p.u.tecnico.id });
    r = await api('ceo', 'POST', `obras/${outra.obra}/checklists`, { procedimento_id: id });
    assert.deepEqual([r.json.checklists[0].versao, r.json.checklists[0].total], [2, 4]);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM procedimentos_versoes WHERE procedimento_id = ?').get(id).n, 2);
    // Arquivado: já não se começa, mas a checklist que existe continua a marcar-se.
    assert.equal((await api('ceo', 'POST', `procedimentos/${id}/estado`, { acao: 'arquivar' })).estado, 200);
    const terceira = await obraNova({ tecnico: p.u.tecnico.id });
    assert.equal((await api('tecnico', 'POST', `obras/${terceira.obra}/checklists`, { procedimento_id: id })).estado, 404);
    assert.equal((await api('ceo', 'POST', `obras/${terceira.obra}/checklists`, { procedimento_id: id })).estado, 409);
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists/${c.id}`, { passo: 0, feito: true })).estado, 200);
  });

  test('marcar passos: o técnico da obra e o CEO sim, outro técnico e o comercial não; fica quem e quando', async () => {
    const id = await procedimento('Quem marca');
    const rascunho = await procedimento('Ainda rascunho', { publicar: false });
    const outro = await p.criarUtilizador('tecnico', 'tecnico2@domus.teste', { nome: 'Técnico Dois' });
    const cookieOutro = await p.entrar(outro.email);
    const { obra } = await obraNova({ tecnico: p.u.tecnico.id });
    const doOutro = (metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: cookieOutro, corpo });

    // Começar: um rascunho não (o técnico nem sabe que existe); um técnico de fora e o comercial também não.
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists`, { procedimento_id: rascunho })).estado, 404);
    assert.equal((await api('ceo', 'POST', `obras/${obra}/checklists`, { procedimento_id: rascunho })).estado, 409);
    assert.equal((await doOutro('POST', `obras/${obra}/checklists`, { procedimento_id: id })).estado, 403);
    assert.equal((await api('comercial', 'POST', `obras/${obra}/checklists`, { procedimento_id: id })).estado, 403);
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists`, {})).estado, 400);
    let r = await api('tecnico', 'GET', `obras/${obra}/checklists`);
    assert.deepEqual([r.json.checklists.length, r.json.pode, r.json.resumo], [0, true, null]);
    assert.ok(r.json.disponiveis.some((x) => x.id === id) && !r.json.disponiveis.some((x) => x.id === rascunho));
    r = await api('tecnico', 'POST', `obras/${obra}/checklists`, { procedimento_id: id });
    assert.equal(r.estado, 201, r.texto);
    const lista = r.json.checklists[0].id;
    assert.equal(r.json.checklists[0].iniciada_por, 'tecnico teste');
    assert.ok(!r.json.disponiveis.some((x) => x.id === id));

    // Marcar.
    const antes = p.relogio.agora();
    r = await api('tecnico', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 0, feito: true });
    assert.equal(r.estado, 200, r.texto);
    let passo = r.json.checklists[0].passos[0];
    assert.deepEqual([passo.feito, passo.por, passo.seguranca, passo.obrigatorio], [true, 'tecnico teste', true, true]);
    assert.ok(Date.parse(passo.quando) >= antes - 1000 && Date.parse(passo.quando) <= p.relogio.agora() + 1000);
    assert.deepEqual(r.json.resumo, { n: 1, feitos: 1, total: 3, obrigatorios_falta: 1 });
    assert.equal((await doOutro('POST', `obras/${obra}/checklists/${lista}`, { passo: 1, feito: true })).estado, 403, 'outro técnico não marca');
    assert.equal((await doOutro('GET', `obras/${obra}/checklists`)).estado, 403, 'nem lê');
    assert.equal((await api('comercial', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 1, feito: true })).estado, 403);
    assert.equal((await p.pedir('POST', `/painel/api/obras/${obra}/checklists/${lista}`, { corpo: { passo: 1, feito: true } })).estado, 401);
    // O comercial lê (como lê as obras), sem poder marcar.
    r = await api('comercial', 'GET', `obras/${obra}/checklists`);
    assert.deepEqual([r.estado, r.json.pode, r.json.checklists[0].feitos], [200, false, 1]);
    // O CEO marca outro passo; marcar de novo um passo já marcado não muda quem o marcou.
    r = await api('ceo', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 1, feito: true });
    assert.equal(r.json.checklists[0].passos[1].por, 'ceo teste');
    r = await api('ceo', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 0, feito: true });
    assert.deepEqual([r.json.checklists[0].passos[0].por, r.json.checklists[0].passos[0].quando], ['tecnico teste', passo.quando]);
    // Desmarcar apaga a marca.
    r = await api('tecnico', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 1, feito: false });
    passo = r.json.checklists[0].passos[1];
    assert.deepEqual([passo.feito, passo.por, passo.quando], [false, null, null]);
    // Pedidos inválidos; a checklist tem de ser desta obra.
    for (const corpo of [{ passo: 3, feito: true }, { passo: -1, feito: true }, { passo: '0', feito: true }, { passo: 0 }, { passo: 0, feito: 'sim' }, { passo: 0, feito: true, por: 'x' }]) {
      assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists/${lista}`, corpo)).estado, 400, JSON.stringify(corpo));
    }
    const outra = await obraNova({ tecnico: p.u.tecnico.id });
    assert.equal((await api('tecnico', 'POST', `obras/${outra.obra}/checklists/${lista}`, { passo: 2, feito: true })).estado, 404);
    assert.equal((await api('ceo', 'GET', 'obras/99999/checklists')).estado, 404);
    // Um utilizador desativado: as marcas dele continuam legíveis, com o nome.
    assert.equal((await api('ceo', 'POST', `utilizadores/${p.u.tecnico.id}`, { ativo: false })).estado, 200);
    r = await api('ceo', 'GET', `obras/${obra}/checklists`);
    assert.deepEqual([r.json.checklists[0].passos[0].feito, r.json.checklists[0].passos[0].por, r.json.checklists[0].iniciada_por], [true, 'tecnico teste', 'tecnico teste']);
    assert.equal((await api('ceo', 'POST', `utilizadores/${p.u.tecnico.id}`, { ativo: true })).estado, 200);
    p.cookies.tecnico = await p.entrar(p.u.tecnico.email);
    // Auditoria: quem, a obra, a checklist e o número do passo — nunca o texto do passo.
    const linhas = p.app.db.prepare("SELECT email, alvo, detalhes FROM auditoria WHERE acao IN ('obra_checklist_iniciada', 'obra_checklist_passo') AND alvo = ?").all(`obra:${obra}`);
    assert.ok(linhas.length >= 4);
    assert.deepEqual(JSON.parse(linhas[0].detalhes), { checklist: lista, procedimento: id, versao: 1 });
    assert.deepEqual(JSON.parse(linhas[1].detalhes), { checklist: lista, passo: 1, feito: true });
    for (const l of linhas) assert.doesNotMatch(l.detalhes, /Cortar|alimentação|Sinalizar|Registar|trabalho/);
  });

  test('eletricista externo: só a obra do seu trabalho; marca com o nome dele; retirado ou suspenso, as marcas ficam', async () => {
    const id = await procedimento('Na área do eletricista');
    const a = await eletricista();
    const b = await eletricista();
    const { pedido, obra } = await obraNova();
    let r = await api('ceo', 'POST', `orcamentos/${pedido}/eletricista`, { acao: 'atribuir', eletricista_id: a.id });
    assert.equal(r.estado, 200, r.texto);
    const tid = r.json.trabalho.id;
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    // A ficha traz as checklists da obra e os procedimentos publicados que se podem começar.
    r = await area(a, 'GET', `trabalhos/${tid}`);
    assert.deepEqual(r.json.trabalho.checklists.checklists, []);
    assert.ok(r.json.trabalho.checklists.disponiveis.some((x) => x.id === id));
    // O CEO começa a checklist e marca um passo; o eletricista vê "Domus Energia", nunca o nome de quem é da equipa.
    r = await api('ceo', 'POST', `obras/${obra}/checklists`, { procedimento_id: id });
    const lista = r.json.checklists[0].id;
    assert.equal((await api('ceo', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 0, feito: true })).estado, 200);
    r = await area(a, 'POST', `trabalhos/${tid}/checklists/${lista}`, { passo: 2, feito: true });
    assert.equal(r.estado, 200, r.texto);
    let c = r.json.trabalho.checklists.checklists[0];
    assert.deepEqual(c.passos.map((x) => [x.feito, x.por]), [[true, 'Domus Energia'], [false, null], [true, a.nome]]);
    assert.equal(c.iniciada_por, 'Domus Energia');
    assert.equal(typeof c.passos[2].quando, 'string');
    assert.doesNotMatch(JSON.stringify(r.json.trabalho.checklists), /ceo teste/);
    // O CEO vê o nome do eletricista; o técnico (se a obra fosse dele) só "Eletricista externo".
    r = await api('ceo', 'GET', `obras/${obra}/checklists`);
    assert.equal(r.json.checklists[0].passos[2].por, `${a.nome} (eletricista externo)`);
    assert.equal((await api('ceo', 'POST', `obras/${obra}`, { tecnicos: [p.u.tecnico.id] })).estado, 200);
    r = await api('tecnico', 'GET', `obras/${obra}/checklists`);
    assert.equal(r.json.checklists[0].passos[2].por, 'Eletricista externo');
    // Outro eletricista: nem a ficha, nem marcar, nem começar.
    assert.equal((await area(b, 'GET', `trabalhos/${tid}`)).estado, 404);
    assert.equal((await area(b, 'POST', `trabalhos/${tid}/checklists/${lista}`, { passo: 1, feito: true })).estado, 404);
    assert.equal((await area(b, 'POST', `trabalhos/${tid}/checklists`, { procedimento_id: id })).estado, 404);
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/checklists/${lista}`, { corpo: { passo: 1, feito: true } })).estado, 401);
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/checklists/${lista}`, { cookie: p.cookies.ceo, corpo: { passo: 1, feito: true } })).estado, 401);
    // Com o trabalho dele não chega às checklists de outra obra.
    const alheia = await obraNova({ tecnico: p.u.tecnico.id });
    r = await api('ceo', 'POST', `obras/${alheia.obra}/checklists`, { procedimento_id: id });
    const listaAlheia = r.json.checklists[0].id;
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/checklists/${listaAlheia}`, { passo: 0, feito: true })).estado, 404);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM obra_checklist_passos WHERE checklist_id = ?').get(listaAlheia).n, 0);
    // O eletricista começa outra checklist na sua obra; um rascunho não existe para ele.
    const segundo = await procedimento('Segundo procedimento');
    const rascunho = await procedimento('Rascunho escondido', { publicar: false });
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/checklists`, { procedimento_id: rascunho })).estado, 404);
    r = await area(a, 'POST', `trabalhos/${tid}/checklists`, { procedimento_id: segundo });
    assert.equal(r.estado, 201, r.texto);
    assert.deepEqual(r.json.trabalho.checklists.checklists.map((x) => [x.procedimento_id, x.iniciada_por]), [[id, 'Domus Energia'], [segundo, a.nome]]);
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/checklists`, { procedimento_id: segundo })).estado, 409);
    // Suspenso e retirado do trabalho: deixa de entrar, mas as marcas dele continuam legíveis com o nome.
    assert.equal((await api('ceo', 'POST', `orcamentos/${pedido}/eletricista`, { acao: 'retirar' })).estado, 200);
    assert.equal((await area(a, 'POST', `trabalhos/${tid}/checklists/${lista}`, { passo: 1, feito: true })).estado, 404, 'já não é dele');
    assert.equal((await api('ceo', 'POST', `eletricistas/${a.id}`, { acao: 'suspender' })).estado, 200);
    r = await api('ceo', 'GET', `obras/${obra}/checklists`);
    c = r.json.checklists[0];
    assert.deepEqual([c.passos[2].feito, c.passos[2].por], [true, `${a.nome} (eletricista externo)`]);
    assert.equal(r.json.checklists[1].iniciada_por, `${a.nome} (eletricista externo)`);
    // Auditoria: o eletricista fica como "eletricista:<id>", sem textos.
    const l = p.app.db.prepare("SELECT email, detalhes FROM auditoria WHERE acao = 'obra_checklist_passo' AND email = ?").get(`eletricista:${a.id}`);
    assert.deepEqual(JSON.parse(l.detalhes), { checklist: lista, passo: 3, feito: true });
  });

  test('obra concluída com obrigatórios em falta: não bloqueia; a lista de obras e a tarefa "Confirmar obra concluída" do CEO dizem quantos faltam', async () => {
    const id = await procedimento('Obrigatórios em falta');
    const { pedido, obra } = await obraNova({ tecnico: p.u.tecnico.id });
    let r = await api('tecnico', 'POST', `obras/${obra}/checklists`, { procedimento_id: id });
    const lista = r.json.checklists[0].id;
    assert.equal((await api('tecnico', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 1, feito: true })).estado, 200);
    // A lista de obras (CEO e técnico) e a ficha levam o resumo.
    for (const papel of ['ceo', 'tecnico']) {
      r = await api(papel, 'GET', 'obras');
      assert.deepEqual(r.json.obras.find((x) => x.id === obra).checklists, { n: 1, feitos: 1, total: 3, obrigatorios_falta: 2 }, papel);
    }
    assert.equal((await api('ceo', 'GET', `obras/${obra}`)).json.checklists.obrigatorios_falta, 2);
    const semChecklist = await obraNova();
    assert.equal((await api('ceo', 'GET', `obras/${semChecklist.obra}`)).json.checklists, null);
    // O técnico dá a obra por concluída com dois obrigatórios por marcar: não é bloqueado.
    r = await api('tecnico', 'POST', `obras/${obra}`, { estado: 'concluida' });
    assert.deepEqual([r.estado, r.json.estado], [200, 'concluida']);
    // A tarefa do CEO diz quantos faltam (calculado ao ler), sem os textos dos passos.
    const tarefa = async () => (await api('ceo', 'GET', 'tarefas')).json.tarefas.find((t) => t.automatica === 'obra_confirmar' && t.obra_id === obra);
    let t = await tarefa();
    assert.ok(t, 'a tarefa nasceu');
    assert.equal(t.orcamento_id, pedido);
    assert.equal(t.aviso, 'Checklists da obra: faltam 2 passos obrigatórios por marcar.');
    assert.equal((await api('ceo', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 0, feito: true })).estado, 200);
    assert.equal((await tarefa()).aviso, 'Checklists da obra: falta 1 passo obrigatório por marcar.');
    assert.equal((await api('ceo', 'POST', `obras/${obra}/checklists/${lista}`, { passo: 2, feito: true })).estado, 200);
    assert.equal((await tarefa()).aviso, null);
    assert.equal((await api('ceo', 'GET', `obras/${obra}`)).json.checklists.obrigatorios_falta, 0);
    // As outras tarefas não levam aviso; o texto guardado da tarefa não muda.
    r = await api('ceo', 'POST', 'tarefas', { titulo: 'Tarefa à mão', obra_id: obra });
    assert.equal(r.json.aviso, null);
    assert.doesNotMatch(p.app.db.prepare('SELECT descricao FROM tarefas WHERE id = ?').get(t.id).descricao, /Checklists/);
    // Uma obra concluída sem checklists: a tarefa nasce sem aviso.
    const simples = await obraNova({ tecnico: p.u.tecnico.id });
    assert.equal((await api('tecnico', 'POST', `obras/${simples.obra}`, { estado: 'concluida' })).estado, 200);
    t = (await api('ceo', 'GET', 'tarefas')).json.tarefas.find((x) => x.automatica === 'obra_confirmar' && x.obra_id === simples.obra);
    assert.equal(t.aviso, null);
  });
});

describe('procedimentos com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0' } }); });
  after(() => p.fechar());

  test('as rotas dos procedimentos na área do eletricista não existem; no painel funcionam na mesma', async () => {
    const DESCONHECIDO = { erro: 'Endereço desconhecido.' };
    for (const [metodo, caminho] of [['GET', 'procedimentos'], ['GET', 'procedimentos/1'], ['POST', 'trabalhos/1/checklists'], ['POST', 'trabalhos/1/checklists/1']]) {
      for (const cookie of [undefined, p.cookies.ceo]) {
        const r = await p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie, corpo: metodo === 'POST' ? {} : undefined });
        assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], `${metodo} ${caminho}`);
      }
    }
    const api = (papel, metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    let r = await api('ceo', 'GET', 'procedimentos');
    assert.equal(r.json.procedimentos.length, 6);
    const id = r.json.procedimentos[0].id;
    assert.equal((await api('ceo', 'POST', `procedimentos/${id}/estado`, { acao: 'publicar' })).estado, 200);
    assert.deepEqual((await api('tecnico', 'GET', 'procedimentos')).json.procedimentos.map((x) => x.id), [id]);
  });
});
