// Validação do CEO antes da bolsa (decisão do dono, 2026-10-10; migração 44): um pedido novo fica "por validar"; só o
// CEO valida, com todos os pontos da lista de verificação; sem validar não vai para a bolsa nem para um eletricista; o CEO
// pode devolvê-lo ao cliente para corrigir (email + conversa do pedido) e o cliente diz "Já corrigi" na conta.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

const SIM = { versao: 1, casa: { tipo: 'moradia', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1 }] };

describe('validação do CEO antes da bolsa', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { VALIDACAO_CEO: '1', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const conta = (metodo, caminho, opcoes = {}) => p.pedir(metodo, `/api/conta/${caminho}`, opcoes);
  async function pedidoPainel() {
    const r = await painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade: 'Sintra', servico: 'Remodelação elétrica' });
    assert.equal(r.estado, 201, r.texto);
    return r.json.id;
  }

  test('por validar: sem validar não vai para a bolsa; só o CEO valida e só com a lista toda; validar com bolsa põe-no lá', async () => {
    const id = await pedidoPainel();
    const f = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(f.validacao.estado, 'por_validar');
    assert.deepEqual(f.validacao.pontos.map((x) => x.chave), ['area', 'contacto'], 'pedido sem simulação: só a área e o contacto');
    assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'bolsa' })).estado, 409, 'sem validar não vai para a bolsa');
    assert.equal((await painel('POST', `orcamentos/${id}/validar`, 'comercial', { pontos: { area: true, contacto: true } })).estado, 403, 'o comercial não valida');
    assert.equal((await painel('POST', `orcamentos/${id}/validar`, 'ceo', { pontos: { area: true } })).estado, 400, 'falta um ponto');
    const v = await painel('POST', `orcamentos/${id}/validar`, 'ceo', { pontos: { area: true, contacto: true }, bolsa: true });
    assert.equal(v.estado, 200, v.texto);
    assert.deepEqual([v.json.validacao.estado, v.json.validacao.por], ['validado', p.u.ceo.email]);
    assert.equal(p.app.db.prepare("SELECT estado FROM trabalhos_eletricista WHERE orcamento_id = ?").get(id).estado, 'na_bolsa');
    assert.equal((await painel('POST', `orcamentos/${id}/validar`, 'ceo', { pontos: { area: true, contacto: true } })).estado, 409, 'já validado');
  });

  test('devolver ao cliente: email com o que falta, fica na conversa; o cliente vê na conta, diz "Já corrigi" e volta a por validar', async () => {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1', simulacao: SIM } });
    assert.equal(r.estado, 201, r.texto);
    const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    assert.deepEqual((await painel('GET', `orcamentos/${id}`)).json.validacao.pontos.map((x) => x.chave), ['planta', 'foto_quadro', 'area', 'contacto']);
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-cliente`, 'comercial', { nota: 'x' })).estado, 403);
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-cliente`, 'ceo', { nota: '' })).estado, 400);
    const antes = p.emails.length;
    const d = await painel('POST', `orcamentos/${id}/devolver-cliente`, 'ceo', { nota: 'A foto do quadro não se lê: tire outra com a porta aberta.' });
    assert.equal(d.estado, 200, d.texto);
    assert.equal(d.json.validacao.estado, 'devolvido');
    const m = p.emails.slice(antes).find((x) => x.para === c.email);
    assert.match(m.texto, /A foto do quadro não se lê/);
    assert.match(m.texto, /conta\.html#pedido-/);
    assert.equal((await conta('POST', `pedidos/${id}/corrigido`, { corpo: {} })).estado, 401, 'sem sessão');
    const visto = (await conta('GET', 'pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.equal(visto.correcao.nota, 'A foto do quadro não se lê: tire outra com a porta aberta.');
    assert.ok(visto.mensagens.some((x) => /A foto do quadro/.test(x.texto)), 'fica na conversa do pedido');
    const outro = await p.contaConfirmada();
    assert.equal((await conta('POST', `pedidos/${id}/corrigido`, { cookie: outro.cookie, corpo: {} })).estado, 404, 'outra conta');
    const ok = await conta('POST', `pedidos/${id}/corrigido`, { cookie: c.cookie, corpo: {} });
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.pedido.correcao, null);
    assert.equal((await painel('GET', `orcamentos/${id}`)).json.validacao.estado, 'por_validar');
    assert.equal((await conta('POST', `pedidos/${id}/corrigido`, { cookie: c.cookie, corpo: {} })).estado, 409, 'já não está à espera');
  });
  test('"Não aceito": só com proposta por aceitar e com motivo; o pedido volta a por validar com o motivo, o trabalho da bolsa é retirado e o CEO volta a validar', async () => {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1', simulacao: SIM } });
    assert.equal(r.estado, 201, r.texto);
    const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    const todos = { planta: true, foto_quadro: true, area: true, contacto: true };
    assert.equal((await conta('POST', `pedidos/${id}/recusar`, { cookie: c.cookie, corpo: { motivo: 'preco' } })).estado, 409, 'ainda sem proposta');
    assert.equal((await painel('POST', `orcamentos/${id}/validar`, 'ceo', { pontos: todos, bolsa: true })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 800 })).estado, 200);
    const antes = (await conta('GET', 'pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
    assert.deepEqual([antes.pode_aceitar, antes.pode_recusar, antes.proposta_recusada], [true, true, null]);
    assert.equal((await conta('POST', `pedidos/${id}/recusar`, { cookie: c.cookie, corpo: { motivo: 'nenhum' } })).estado, 400);
    const outro = await p.contaConfirmada();
    assert.equal((await conta('POST', `pedidos/${id}/recusar`, { cookie: outro.cookie, corpo: { motivo: 'preco' } })).estado, 404, 'outra conta');
    const n = await conta('POST', `pedidos/${id}/recusar`, { cookie: c.cookie, corpo: { motivo: 'preco', texto: 'Está acima do que contava.' } });
    assert.equal(n.estado, 200, n.texto);
    assert.deepEqual([n.json.pedido.pode_aceitar, n.json.pedido.pode_recusar, Boolean(n.json.pedido.proposta_recusada)], [false, false, true]);
    const f = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([f.estado, f.validacao.estado], ['contactado', 'por_validar']);
    assert.match(f.validacao.nota, /não aceite pelo cliente \(o preço\): Está acima/);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE orcamento_id = ? ORDER BY id DESC').get(id).estado, 'retirado');
    assert.equal((await conta('POST', `pedidos/${id}/recusar`, { cookie: c.cookie, corpo: { motivo: 'preco' } })).estado, 409, 'já recusada');
    // O CEO valida de novo e o pedido volta à bolsa.
    const v = await painel('POST', `orcamentos/${id}/validar`, 'ceo', { pontos: todos, bolsa: true });
    assert.equal(v.estado, 200, v.texto);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE orcamento_id = ? ORDER BY id DESC').get(id).estado, 'na_bolsa');
  });
});
