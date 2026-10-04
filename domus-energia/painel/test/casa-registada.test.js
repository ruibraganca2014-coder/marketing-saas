// "Casa registada" (decisões do dono, 2026-10-04; docs/SIMULADOR-ORCAMENTO.md "Duas partes"): o cliente descreve a casa
// no simulador com conta e fica como contacto no painel (CRM → Casas registadas) sem nenhum pedido; os CEO são avisados
// uma vez; com o primeiro pedido sai da lista.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

describe('casa registada', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  const conta = (metodo, caminho, opcoes = {}) => p.pedir(metodo, `/api/conta/${caminho}`, opcoes);
  const painel = (metodo, caminho, papel = 'ceo') => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel] });
  const ESTADO = { versao: 5, passo: 11, funil: 'primeira', casa: { tipo: 'apartamento', tipologia: 'T2', potencia_contratada_kva: 6.9 },
    planta: { divisoes: [{ id: 'd1', nome: 'Sala' }, { id: 'd2', nome: 'Quarto' }], elementos: [] } };

  test('sem sessão: 401; sem a casa guardada na conta: 400', async () => {
    assert.equal((await conta('POST', 'casa-registada', { corpo: {} })).estado, 401);
    const c = await p.contaConfirmada('sem.casa@exemplo.pt');
    assert.equal((await conta('POST', 'casa-registada', { cookie: c.cookie, corpo: {} })).estado, 400);
    assert.equal((await painel('GET', 'crm/casas')).json.casas.length, 0);
  });

  test('regista uma vez, avisa os CEO sem dados do cliente, aparece no CRM e sai com o primeiro pedido', async () => {
    const c = await p.contaConfirmada('com.casa@exemplo.pt');
    assert.equal((await conta('POST', 'simulacao', { cookie: c.cookie, corpo: { estado: ESTADO } })).estado, 200);
    p.emails.length = 0;
    assert.equal((await conta('POST', 'casa-registada', { cookie: c.cookie, corpo: {} })).estado, 200);
    const avisos = p.emails.filter((m) => /casa registada/.test(m.assunto));
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].para, p.u.ceo.email);
    assert.ok(!avisos[0].texto.includes('com.casa@exemplo.pt'), 'o email não leva dados do cliente');
    // Outra vez: nada muda nem volta a avisar.
    const quando = p.app.db.prepare('SELECT casa_registada AS q FROM contas WHERE email = ?').get('com.casa@exemplo.pt').q;
    assert.equal((await conta('POST', 'casa-registada', { cookie: c.cookie, corpo: {} })).estado, 200);
    assert.equal(p.emails.filter((m) => /casa registada/.test(m.assunto)).length, 1);
    assert.equal(p.app.db.prepare('SELECT casa_registada AS q FROM contas WHERE email = ?').get('com.casa@exemplo.pt').q, quando);
    // No painel: CEO e comercial veem o contacto e o resumo da casa; o técnico não.
    const l = (await painel('GET', 'crm/casas')).json.casas;
    assert.equal(l.length, 1);
    assert.deepEqual([l[0].email, l[0].registada, l[0].casa], ['com.casa@exemplo.pt', quando, { tipo: 'Apartamento', tipologia: 'T2', n_divisoes: 2, divisoes: ['Sala', 'Quarto'], potencia_kva: 6.9 }]);
    // A simulação é JSON do cliente: valores de outro tipo (objetos sem toString, listas, chaves herdadas) nunca deitam a lista abaixo.
    const MAU = { toString: 1, valueOf: 1 };
    for (const estado of [
      { versao: 5, casa: { tipo: '__proto__', tipologia: 7, potencia_contratada_kva: MAU }, planta: { divisoes: [{ nome: MAU }, { nome: ['a'] }, { nome: 0 }, { nome: '   ' }, null, { nome: ' Sala ' }] } },
      { versao: 5, casa: ['x'], planta: { divisoes: 'não' } },
      { versao: 5, casa: { tipo: 'constructor', potencia_contratada_kva: '0x10' }, planta: null },
    ]) {
      assert.equal((await conta('POST', 'simulacao', { cookie: c.cookie, corpo: { estado } })).estado, 200);
      const r = await painel('GET', 'crm/casas');
      assert.equal(r.estado, 200, r.texto);
      assert.deepEqual([r.json.casas[0].casa.tipo, r.json.casas[0].casa.potencia_kva], [null, null]);
    }
    assert.deepEqual((await painel('GET', 'crm/casas')).json.casas[0].casa.divisoes, []);
    assert.equal((await conta('POST', 'simulacao', { cookie: c.cookie, corpo: { estado: { versao: 5, casa: {}, planta: { divisoes: [{ nome: MAU }, { nome: ' Sala ' }] } } } })).estado, 200);
    assert.deepEqual((await painel('GET', 'crm/casas')).json.casas[0].casa.divisoes, ['Sala']);
    // Já registada e sem simulação guardada (apagada): continua a responder 200 (idempotente).
    assert.equal((await conta('POST', 'simulacao', { cookie: c.cookie, corpo: { estado: null } })).estado, 200);
    assert.equal((await conta('POST', 'casa-registada', { cookie: c.cookie, corpo: {} })).estado, 200);
    assert.equal((await painel('GET', 'crm/casas')).json.casas[0].casa, null);
    assert.equal((await conta('POST', 'simulacao', { cookie: c.cookie, corpo: { estado: ESTADO } })).estado, 200);
    assert.equal((await painel('GET', 'crm/casas', 'comercial')).json.casas.length, 1);
    assert.equal((await painel('GET', 'crm/casas', 'tecnico')).estado, 403);
    // Com o primeiro pedido (da conta ou com o mesmo email) passa a ficha do CRM: sai das casas registadas.
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Casa', telefone: '912 000 222', email: 'COM.casa@exemplo.pt', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1' } });
    assert.equal(r.estado, 201, r.texto);
    assert.equal((await painel('GET', 'crm/casas')).json.casas.length, 0);
    // Quem já tem pedidos e descreve a casa depois: fica registada, mas sem aviso (já é cliente no painel).
    const d = await p.contaConfirmada('ja.cliente@exemplo.pt');
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Já Cliente', telefone: '912 000 333', email: 'ja.cliente@exemplo.pt', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua B, 2' } })).estado, 201);
    assert.equal((await conta('POST', 'simulacao', { cookie: d.cookie, corpo: { estado: ESTADO } })).estado, 200);
    p.emails.length = 0;
    assert.equal((await conta('POST', 'casa-registada', { cookie: d.cookie, corpo: {} })).estado, 200);
    assert.equal(p.emails.filter((m) => /casa registada/.test(m.assunto)).length, 0);
  });
});
