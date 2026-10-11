// Ida perdida (decisão do dono, 2026-10-11; docs/ELETRICISTAS.md "Ida perdida"; migração 50): o cliente pode mudar a
// visita sem custo até 24 horas antes. Se o eletricista for à hora marcada e não puder entrar por motivo do cliente, o
// cliente paga a deslocação dessa ida (o valor do concelho), que soma ao restante; o eletricista recebe essa deslocação
// a mais; marca-se nova visita. O eletricista assinala, o CEO confirma (ou anula, com o motivo).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { deslocacaoServidor, partirIva, comIva } from '../src/pagamentos-pedido.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
const NOTA = 'Toquei à campainha três vezes e liguei duas: ninguém atendeu.';
const euroTxt = (cent) => `${(cent / 100).toFixed(2).replace('.', ',')} €`;

describe('ida perdida: o eletricista assinala depois da hora, o CEO confirma, a deslocação soma ao restante e ao que o eletricista recebe', () => {
  let p;
  let seq = 0;
  let e, outro;       // dois eletricistas aprovados em Sintra
  let DESL, DESL_IVA; // a deslocação de uma ida a Sintra, em cêntimos: sem IVA e com IVA (23 %)
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await aprovado();
    outro = await aprovado();
    // O valor do concelho, pela configuração do servidor (a mesma conta da visita e da proposta), com o IVA tirado.
    const cfg = Object.fromEntries(p.app.db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));
    DESL = partirIva(Math.round(deslocacaoServidor('Sintra', cfg) * 100), 23).base;
    DESL_IVA = comIva(DESL, 23);
    assert.ok(DESL > 0, 'a deslocação de Sintra tem valor');
  });
  after(() => p.fechar());

  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (x, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: x.cookie, corpo });
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const ficha = async (x, tid) => (await area(x, 'GET', `trabalhos/${tid}`)).json.trabalho;
  const noPainel = async (id, papel = 'ceo') => (await painel('GET', `orcamentos/${id}`, papel)).json;
  const linhaIda = (iid) => ({ ...p.app.db.prepare('SELECT * FROM idas_perdidas WHERE id = ?').get(iid) });
  const linhaTrabalho = (tid) => ({ ...p.app.db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = ?').get(tid) });
  const emailsPara = (email, desde) => p.emails.slice(desde).filter((m) => m.para === email);
  const assinalar = (x, tid, corpo = { nota: NOTA }) => area(x, 'POST', `trabalhos/${tid}/ida-perdida`, corpo);
  const confirmar = (id, iid, papel = 'ceo') => painel('POST', `orcamentos/${id}/idas-perdidas/${iid}/confirmar`, papel, {});
  const anular = (id, iid, corpo, papel = 'ceo') => painel('POST', `orcamentos/${id}/idas-perdidas/${iid}/anular`, papel, corpo);
  const marcar = (x, tid, daquiA = 30 * HORA) => area(x, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + daquiA) });

  async function aprovado(extra = {}) {
    const n = ++seq;
    const x = { nome: `Eletricista Ida ${n}`, email: `eletricista.ida.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${8000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: x })).estado, 201);
    x.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(x.email).id;
    assert.equal((await painel('POST', `eletricistas/${x.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: x.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: x.email, codigo: p.codigo(x.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...x, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Obra de um cliente (proposta de 1000 + 500 + 30 € aceite, sinal pago) atribuída a `x`, com a visita marcada para daqui a 30 h. Devolve {c, id, tid, visita}. */
  async function obra(x = e) {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1530, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    const a = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'atribuir', eletricista_id: x.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    const visita = lisboa(p.relogio.agora() + 30 * HORA);
    assert.equal((await marcar(x, tid)).estado, 200);
    return { c, id, tid, visita };
  }
  /** As fotos de antes e de depois e os três ensaios: o que falta para concluir. */
  async function preparar(x, tid) {
    for (const g of ['quadro_antes', 'quadro_depois']) {
      const f = await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${g}`, { cookie: x.cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(f.estado, 201, f.texto);
    }
    assert.equal((await area(x, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
  }

  test('o percurso todo: só depois da hora, uma à espera de cada vez, o CEO confirma, o restante sobe a deslocação com IVA, o eletricista recebe-a a mais e marca nova visita; duas confirmadas somam as duas', async () => {
    const { c, id, tid, visita } = await obra();
    const antes = await pedidoConta(c, id);
    assert.deepEqual(antes.idas_perdidas, []);
    assert.ok(antes.restante.valor > 0);

    // ---- antes da hora marcada não se assinala (o relógio é o do servidor)
    let f = await ficha(e, tid);
    assert.deepEqual([f.estado, f.visita, f.pode_ida_perdida, f.idas_perdidas], ['visita_marcada', visita, false, []]);
    let r = await assinalar(e, tid);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /só depois dessa hora pode dizer que o cliente não estava/);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM idas_perdidas').get().n, 0);
    p.relogio.avancar(31 * HORA);
    assert.equal((await ficha(e, tid)).pode_ida_perdida, true);

    // ---- assinalar: só o próprio, com sessão, nota até 300 caracteres
    assert.equal((await assinalar(outro, tid)).estado, 404, 'o trabalho de outro eletricista não existe para este');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/ida-perdida`, { corpo: { nota: NOTA } })).estado, 401);
    assert.equal((await assinalar(e, tid, { nota: 'x'.repeat(301) })).estado, 400);
    const nEmails = p.emails.length;
    r = await assinalar(e, tid);
    assert.equal(r.estado, 200, r.texto);
    f = r.json.trabalho;
    assert.equal(f.idas_perdidas.length, 1);
    const iid = f.idas_perdidas[0].id;
    assert.deepEqual({ ...f.idas_perdidas[0], quando: null }, { id: iid, visita, nota: NOTA, estado: 'proposta', quando: null, motivo: null, recebe: null });
    // Enquanto espera, nada muda no trabalho: a mesma data, o mesmo estado.
    assert.deepEqual([f.estado, f.visita, f.pode_ida_perdida], ['visita_marcada', visita, false]);
    assert.ok(emailsPara(p.u.ceo.email, nEmails).some((m) => m.assunto === 'Domus Energia: um eletricista diz que o cliente não estava'), 'o CEO é avisado por email');
    assert.equal(emailsPara(c.email, nEmails).length, 0, 'o cliente ainda não recebe nada');
    // Uma à espera de cada vez; e a obra não se dá por concluída sem a resposta.
    r = await assinalar(e, tid, {});
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /Já há uma ida perdida à espera/);
    r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 409);
    assert.equal(r.json.erro, 'Há uma ida perdida à espera da Domus Energia.');
    assert.ok(f.falta.includes('a resposta à ida perdida'));
    // O cliente ainda não vê nada e o dinheiro não mexeu; o CEO tem uma por confirmar, com o pedido certo.
    let l = await pedidoConta(c, id);
    assert.deepEqual([l.idas_perdidas, l.restante.valor], [[], antes.restante.valor]);
    let resumo = (await painel('GET', 'resumo')).json.tratar;
    assert.deepEqual([resumo.idas_perdidas, resumo.idas_perdidas_pedido], [1, id]);

    // ---- o CEO vê a visita, a nota, a deslocação (sem e com IVA) e o que o eletricista recebe; só ele decide
    let o = await noPainel(id);
    assert.equal(o.idas_perdidas.length, 1);
    assert.deepEqual({ ...o.idas_perdidas[0], criado: null }, { id: iid, trabalho: tid, eletricista: { id: e.id, nome: e.nome }, visita, nota: NOTA, estado: 'proposta', motivo: null, criado: null,
      decidido_em: null, decidido_por: null, deslocacao: DESL / 100, deslocacao_iva: DESL_IVA / 100, recebe: DESL / 100, pode_decidir: true });
    assert.equal((await noPainel(id, 'comercial')).idas_perdidas.length, 1, 'o comercial vê o cartão');
    for (const papel of ['comercial', 'tecnico']) {
      assert.equal((await confirmar(id, iid, papel)).estado, 403);
      assert.equal((await anular(id, iid, { motivo: 'O cliente avisou.' }, papel)).estado, 403);
    }
    assert.equal((await confirmar(id, 99999)).estado, 404);
    const outra = await obra(outro);
    assert.equal((await confirmar(outra.id, iid)).estado, 404, 'a ida é de outro pedido');
    assert.equal(linhaIda(iid).estado, 'proposta');
    const nAntes = p.emails.length;
    r = await confirmar(id, iid);
    assert.equal(r.estado, 200, r.texto);
    o = r.json;
    assert.deepEqual([o.idas_perdidas[0].estado, o.idas_perdidas[0].decidido_por, o.idas_perdidas[0].deslocacao, o.idas_perdidas[0].deslocacao_iva, o.idas_perdidas[0].pode_decidir],
      ['confirmada', p.u.ceo.email, DESL / 100, DESL_IVA / 100, false]);
    assert.equal(o.valores_pagamento.idas_perdidas, DESL / 100);
    assert.equal(linhaIda(iid).deslocacao_cent, DESL, 'a deslocação fica guardada sem IVA, em cêntimos');
    assert.ok(o.historico.some((h) => h.acao === 'ida_perdida_assinalada') && o.historico.some((h) => h.acao === 'ida_perdida_confirmada' && h.detalhes.deslocacao_iva === DESL_IVA / 100));
    assert.equal((await confirmar(id, iid)).estado, 409, 'só se decide uma vez');
    assert.equal((await anular(id, iid, { motivo: 'Afinal não.' })).estado, 409);
    resumo = (await painel('GET', 'resumo')).json.tratar;
    assert.deepEqual([resumo.idas_perdidas, resumo.idas_perdidas_pedido], [0, null]);

    // ---- o cliente: o restante sobe exatamente a deslocação com IVA; o sinal já pago não muda; recebe o email com o valor
    l = await pedidoConta(c, id);
    assert.equal(Math.round((l.restante.valor - antes.restante.valor) * 100), DESL_IVA);
    assert.equal(Math.round((l.proposta_iva.total - antes.proposta_iva.total) * 100), DESL_IVA);
    assert.equal(Math.round((l.proposta_iva.base - antes.proposta_iva.base) * 100), DESL);
    assert.equal(l.sinal.valor, antes.sinal.valor);
    assert.deepEqual(l.idas_perdidas, [{ visita, valor: DESL / 100, valor_iva: DESL_IVA / 100 }]);
    assert.equal(l.proposta.valor, 1530, 'a proposta aceite não muda');
    assert.equal(l.obra.por_agendar, true, 'a visita volta a estar por marcar');
    const email = emailsPara(c.email, nAntes);
    assert.equal(email.length, 1);
    assert.equal(email[0].assunto, 'Domus Energia: não o encontrámos na visita');
    assert.match(email[0].texto, new RegExp(`Não o encontrámos na visita de .+ do seu pedido n\\.º ${id}\\.`));
    assert.ok(email[0].texto.includes(`a deslocação dessa ida (${euroTxt(DESL_IVA)} com IVA) soma ao que paga no fim da obra`));
    assert.match(email[0].texto, /Vamos marcar nova visita consigo\./);

    // ---- o eletricista: avisado, vê o que recebe a mais e o trabalho volta a "por marcar visita" (com 48 h novas)
    const aviso = emailsPara(e.email, nAntes);
    assert.equal(aviso.length, 1);
    assert.match(aviso[0].texto, new RegExp(`recebe mais ${euroTxt(DESL).replace('.', '\\.')} \\(sem IVA\\)`));
    assert.match(aviso[0].texto, /marque a visita na área do eletricista: tem 48 h\./);
    f = await ficha(e, tid);
    assert.deepEqual([f.estado, f.visita, f.pode_ida_perdida, f.idas_perdidas[0].estado, f.idas_perdidas[0].recebe], ['aceite', null, false, 'confirmada', DESL / 100]);
    assert.ok(f.prazo, 'o prazo das 48 h conta de novo');
    assert.ok(f.falta.includes('marcar a visita') && !f.falta.includes('a resposta à ida perdida'));
    assert.ok(p.relogio.agora() - linhaTrabalho(tid).aceite_em < 60_000, 'as 48 h contam a partir da confirmação');
    assert.equal((await assinalar(e, tid)).estado, 409, 'sem visita marcada não se assinala');
    const at = (await painel('GET', `orcamentos/${id}/eletricista`)).json.trabalho;
    assert.equal(at.recebe_idas, DESL / 100, 'a estimativa do painel já leva a ida perdida');

    // ---- nova visita, que também se perde: a segunda confirmada soma por cima da primeira
    assert.equal((await marcar(e, tid)).estado, 200);
    assert.equal((await pedidoConta(c, id)).obra.por_agendar, false);
    p.relogio.avancar(31 * HORA);
    r = await assinalar(e, tid, {});
    assert.equal(r.estado, 200, r.texto);
    const iid2 = r.json.trabalho.idas_perdidas[1].id;
    assert.equal(r.json.trabalho.idas_perdidas[1].nota, null, 'a nota é opcional');
    assert.equal((await confirmar(id, iid2)).estado, 200);
    l = await pedidoConta(c, id);
    assert.equal(Math.round((l.restante.valor - antes.restante.valor) * 100), 2 * DESL_IVA);
    assert.equal(l.idas_perdidas.length, 2);

    // ---- terceira visita: a obra faz-se; ao aprovar, o eletricista recebe 70 % × 1000 + 30 da proposta e as duas deslocações
    assert.equal((await marcar(e, tid)).estado, 200);
    p.relogio.avancar(31 * HORA);
    await preparar(e, tid);
    r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
    r = await assinalar(e, tid);
    assert.equal(r.estado, 409, 'com a obra dada por concluída já não se assinala');
    assert.match(r.json.erro, /Já deu este trabalho por concluído/);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 5 })).estado, 200);
    r = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'aprovar' });
    assert.equal(r.estado, 200, r.texto);
    const t = linhaTrabalho(tid);
    assert.equal(t.valor_cent, 70000 + 3000 + 2 * DESL);
    const detalhe = JSON.parse(t.valor_detalhe);
    assert.equal(detalhe.idas_perdidas, (2 * DESL) / 100);
    assert.equal(detalhe.total, (73000 + 2 * DESL) / 100);
    // … e o cliente paga o restante com as duas deslocações dentro; a obra fica toda paga.
    r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'restante' });
    assert.ok(r.estado === 200 || r.estado === 201, r.texto);
    assert.equal(Math.round(r.json.pagamento.valor * 100), Math.round(antes.restante.valor * 100) + 2 * DESL_IVA);
    assert.equal((await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    assert.equal((await pedidoConta(c, id)).obra_paga, true);
  });

  test('anular: o motivo é obrigatório, nada muda no dinheiro nem no trabalho, o eletricista vê o motivo e o cliente não recebe email; a mesma visita não se assinala outra vez', async () => {
    const { c, id, tid, visita } = await obra();
    const antes = await pedidoConta(c, id);
    p.relogio.avancar(31 * HORA);
    const iid = (await assinalar(e, tid)).json.trabalho.idas_perdidas[0].id;
    assert.equal((await anular(id, iid, {})).estado, 400, 'o motivo é obrigatório');
    assert.equal((await anular(id, iid, { motivo: '  ' })).estado, 400);
    assert.equal((await anular(id, iid, { motivo: 'x'.repeat(501) })).estado, 400);
    assert.equal(linhaIda(iid).estado, 'proposta');
    const n = p.emails.length;
    let r = await anular(id, iid, { motivo: 'O cliente avisou na véspera que não podia.' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.idas_perdidas[0].estado, r.json.idas_perdidas[0].motivo, r.json.idas_perdidas[0].pode_decidir], ['anulada', 'O cliente avisou na véspera que não podia.', false]);
    assert.equal(r.json.valores_pagamento.idas_perdidas, undefined);
    assert.ok(r.json.historico.some((h) => h.acao === 'ida_perdida_anulada'));
    assert.equal(p.emails.slice(n).filter((m) => m.para === c.email).length, 0, 'sem email ao cliente');
    assert.equal((await anular(id, iid, { motivo: 'Outra vez.' })).estado, 409);
    assert.equal((await confirmar(id, iid)).estado, 409, 'uma anulada já não se confirma');
    // Nada muda no dinheiro.
    const l = await pedidoConta(c, id);
    assert.deepEqual([l.restante.valor, l.proposta_iva.total, l.idas_perdidas], [antes.restante.valor, antes.proposta_iva.total, []]);
    // O eletricista vê "Anulada" com o motivo; o trabalho fica como estava (a mesma data) e essa visita não se assinala outra vez.
    let f = await ficha(e, tid);
    assert.deepEqual([f.estado, f.visita, f.idas_perdidas[0].estado, f.idas_perdidas[0].motivo, f.idas_perdidas[0].recebe, f.pode_ida_perdida], ['visita_marcada', visita, 'anulada', 'O cliente avisou na véspera que não podia.', null, false]);
    r = await assinalar(e, tid);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /Esta visita já foi assinalada/);
    // Marca nova data (o caminho de sempre) e, depois dela, conclui: sem ida à espera, nada o impede; recebe o de sempre.
    assert.equal((await marcar(e, tid)).estado, 200);
    p.relogio.avancar(31 * HORA);
    await preparar(e, tid);
    f = await ficha(e, tid);
    assert.deepEqual(f.falta, []);
    assert.equal(f.pode_ida_perdida, true, 'a visita nova, já passada, pode voltar a ser assinalada');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 4 })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal(linhaTrabalho(tid).valor_cent, 73000);
  });

  test('se o trabalho sai do eletricista (o CEO retira-o, ou ele larga-o), a ida à espera fica anulada e já não se confirma', async () => {
    // ---- retirado pelo CEO
    const a = await obra();
    p.relogio.avancar(31 * HORA);
    const iid = (await assinalar(e, a.tid)).json.trabalho.idas_perdidas[0].id;
    assert.equal((await painel('POST', `orcamentos/${a.id}/eletricista`, 'ceo', { acao: 'retirar' })).estado, 200);
    assert.deepEqual([linhaIda(iid).estado, linhaIda(iid).motivo, linhaIda(iid).decidido_por], ['anulada', 'O trabalho saiu do eletricista.', 'sistema']);
    assert.equal((await confirmar(a.id, iid)).estado, 409);
    assert.equal((await painel('GET', 'resumo')).json.tratar.idas_perdidas, 0);
    assert.deepEqual((await pedidoConta(a.c, a.id)).idas_perdidas, []);
    // ---- largado pelo eletricista
    const b = await obra();
    p.relogio.avancar(31 * HORA);
    const iid2 = (await assinalar(e, b.tid)).json.trabalho.idas_perdidas[0].id;
    assert.equal((await area(e, 'POST', `trabalhos/${b.tid}/largar`, {})).estado, 200);
    assert.deepEqual([linhaIda(iid2).estado, linhaIda(iid2).motivo], ['anulada', 'O trabalho saiu do eletricista.']);
    assert.equal((await confirmar(b.id, iid2)).estado, 409);
    // Uma ida já confirmada fica: o cliente continua a dever essa deslocação, mesmo que o trabalho mude de mãos.
    const d = await obra();
    p.relogio.avancar(31 * HORA);
    const iid3 = (await assinalar(e, d.tid)).json.trabalho.idas_perdidas[0].id;
    assert.equal((await confirmar(d.id, iid3)).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${d.id}/eletricista`, 'ceo', { acao: 'retirar' })).estado, 200);
    assert.equal(linhaIda(iid3).estado, 'confirmada');
    assert.equal((await pedidoConta(d.c, d.id)).idas_perdidas.length, 1);
  });

  test('com o restante já pago não se confirma (409): já não há onde somar a deslocação', async () => {
    const { c, id, tid } = await obra();
    p.relogio.avancar(31 * HORA);
    const iid = (await assinalar(e, tid)).json.trabalho.idas_perdidas[0].id;
    // Com uma ida à espera a obra não se conclui, por isso o restante não se chega a pagar pela conta: põe-se aqui à mão
    // um restante pago (a partir do sinal), só para provar a recusa do servidor.
    p.app.db.prepare(`INSERT INTO pagamentos_pedido (ref, conta_id, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, criado, atualizado, expira, iva_pct, pago)
      SELECT 'pp_' || substr(ref, 4, 20) || 'zz', conta_id, orcamento_id, 'restante', 1000, 'Restante (teste)', 'pago', modo, retorno, criado, atualizado, expira, iva_pct, pago
      FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'sinal'`).run(id);
    const r = await confirmar(id, iid);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /já pagou o restante/);
    assert.equal(linhaIda(iid).estado, 'proposta');
    assert.equal((await anular(id, iid, { motivo: 'Trata-se por fora.' })).estado, 200, 'anular continua a poder-se');
    assert.equal((await pedidoConta(c, id)).idas_perdidas.length, 0);
  });
});

describe('ida perdida com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0' } }); });
  after(() => p.fechar());

  test('as rotas não existem (404) e o resumo do CEO não traz a contagem', async () => {
    assert.equal((await p.pedir('POST', '/painel/api/orcamentos/1/idas-perdidas/1/confirmar', { cookie: p.cookies.ceo, corpo: {} })).estado, 404);
    assert.equal((await p.pedir('POST', '/painel/api/orcamentos/1/idas-perdidas/1/anular', { cookie: p.cookies.ceo, corpo: { motivo: 'Não.' } })).estado, 404);
    assert.equal((await p.pedir('POST', '/api/eletricista/trabalhos/1/ida-perdida', { corpo: {} })).estado, 404);
    assert.equal((await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.ceo })).json.tratar.idas_perdidas, undefined);
  });
});
