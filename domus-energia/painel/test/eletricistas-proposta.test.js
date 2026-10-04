// Caminho simples do pedido (decisões do dono, 2026-10-04; docs/ELETRICISTAS.md): com os pagamentos online desligados,
// o CEO põe na bolsa um pedido por visitar (visita sem custo: o eletricista só recebe com a obra); depois de marcar a
// visita, o eletricista envia a proposta — horas e material do catálogo, nunca euros — e o painel calcula os valores
// para o CEO rever e enviar ao cliente.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');

describe('pedido para a bolsa sem pagamentos online e proposta do eletricista', () => {
  let p;
  let e;
  before(async () => {
    p = await painelComEquipa({ env: { SITE_URL: 'https://site.teste' } });   // PAGAMENTO_PEDIDO=0 (a omissão dos testes): pagamentos desligados
    const c = { nome: 'Eletricista Proposta', email: 'eletricista.proposta@exemplo.pt', telefone: '910 000 000', nif: '123456789', dgeg: 'TR-2001',
      concelhos: ['Sintra'], experiencia: '5_10', notas: '', seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `eletricistas/${id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const s = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    e = { id, email: c.email, cookie: s.cabecalhos['set-cookie'][0].split(';')[0] };
  });
  after(() => p.fechar());

  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  async function pedido(localidade = 'Sintra') {
    const r = await painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade, servico: 'Remodelação elétrica' });
    assert.equal(r.estado, 201, r.texto);
    return r.json.id;
  }

  test('pagamentos desligados: um pedido por visitar vai para a bolsa como visita sem custo (o eletricista recebe 0)', async () => {
    const id = await pedido();
    const a = await painel('GET', `orcamentos/${id}/eletricista`);
    assert.equal(a.estado, 200, a.texto);
    assert.equal(a.json.pode, true, a.texto);
    const b = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'bolsa' });
    assert.equal(b.estado, 200, b.texto);
    assert.deepEqual([b.json.trabalho.tipo, b.json.trabalho.estado], ['visita', 'na_bolsa']);
    const naBolsa = (await area('GET', 'bolsa')).json.trabalhos;
    assert.equal(naBolsa.length, 1);
    assert.deepEqual({ ...naBolsa[0].recebe }, { percentagem: 70, mao_obra: 0, parte_mao_obra: 0, deslocacao: 0, total: 0, provisoria: false, gratis: true });
    // Um pedido já com a proposta enviada não se põe na bolsa como visita.
    const outro = await pedido();
    assert.equal((await painel('POST', `orcamentos/${outro}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 500 })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${outro}/eletricista`, 'ceo', { acao: 'bolsa' })).estado, 409);
  });

  test('proposta: só depois de marcar a visita; horas e material do catálogo (sem euros); o painel calcula e o CEO preenche', async () => {
    const id = await pedido();
    const tid = (await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await area('POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    // O catálogo do eletricista: artigo e categoria, nunca preços.
    const cat = await area('GET', 'catalogo');
    assert.equal(cat.estado, 200);
    assert.ok(cat.json.artigos.length > 10);
    assert.deepEqual(Object.keys(cat.json.artigos[0]).sort(), ['categoria', 'nome', 'sku']);
    assert.ok(cat.json.artigos.every((x) => Object.keys(x).length === 3), 'nenhum artigo leva preços');
    const [a1, a2] = cat.json.artigos;
    const boa = { horas: 6.5, material: [{ sku: a1.sku, qtd: 2 }, { sku: a2.sku, qtd: 1 }, { sku: a1.sku, qtd: 1 }], notas: 'Quadro antigo, sem diferencial.' };
    assert.equal((await area('POST', `trabalhos/${tid}/proposta`, boa)).estado, 409, 'antes de marcar a visita');
    assert.equal((await area('POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * 3600_000) })).estado, 200);
    let t = (await area('GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([t.pode_proposta, t.proposta, t.recebe.gratis], [true, null, true]);
    for (const mau of [{ ...boa, horas: 0 }, { ...boa, horas: 'muitas' }, { ...boa, material: 'cabo' }, { ...boa, material: [{ sku: 'NAO-EXISTE', qtd: 1 }] },
      { ...boa, material: [{ sku: a1.sku, qtd: 0 }] }, { ...boa, material: [{ sku: a1.sku, qtd: 1.5 }] }, { ...boa, valor: 100 }]) {
      assert.equal((await area('POST', `trabalhos/${tid}/proposta`, mau)).estado, 400, JSON.stringify(mau).slice(0, 80));
    }
    p.emails.length = 0;
    const r = await area('POST', `trabalhos/${tid}/proposta`, boa);
    assert.equal(r.estado, 200, r.texto);
    t = r.json.trabalho;
    assert.equal(t.proposta.horas, 6.5);
    assert.deepEqual(t.proposta.material, [{ sku: a1.sku, nome: a1.nome, qtd: 3 }, { sku: a2.sku, nome: a2.nome, qtd: 1 }], 'o mesmo artigo soma-se');
    assert.ok(!/valor|preco|sugestao/.test(JSON.stringify(t.proposta)), 'o eletricista não recebe valores');
    assert.ok(p.emails.some((m) => m.para === p.u.ceo.email && /enviou a proposta/.test(m.assunto)), 'os CEO são avisados');
    // No painel: a proposta com os valores sem IVA calculados no servidor.
    const o = (await painel('GET', `orcamentos/${id}`)).json;
    const pe = o.proposta_eletricista;
    assert.equal(pe.horas, 6.5);
    assert.equal(pe.eletricista.nome, 'Eletricista Proposta');
    assert.equal(pe.notas, boa.notas);
    const preco = (sku) => p.app.db.prepare('SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = ?').get(sku).c;
    const semIva = (cent) => Math.round(cent / 1.23) / 100;
    assert.equal(pe.sugestao.mao_obra, semIva(6.5 * 38 * 100), 'horas × tarifa/hora (38 € com IVA), sem IVA');
    assert.ok(Math.abs(pe.sugestao.material - (semIva(preco(a1.sku) * 3) + semIva(preco(a2.sku)))) < 0.011);
    assert.equal(pe.material.length, 2);
    // O comercial também vê; o estado do pedido não mudou; enviar outra vez substitui.
    assert.equal((await painel('GET', `orcamentos/${id}`, 'comercial')).json.proposta_eletricista.horas, 6.5);
    assert.equal(o.estado, 'visita_marcada');
    assert.equal((await area('POST', `trabalhos/${tid}/proposta`, { horas: 8, material: [], notas: null })).estado, 200);
    assert.deepEqual([(await painel('GET', `orcamentos/${id}`)).json.proposta_eletricista.horas, (await painel('GET', `orcamentos/${id}`)).json.proposta_eletricista.material.length], [8, 0]);
    // O CEO envia a proposta ao cliente: a visita fecha e o eletricista deixa de ver o cliente e de poder mexer.
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 200, proposta_material: 300, proposta_deslocacao: 0 })).estado, 200);
    t = (await area('GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([t.aberto, t.cliente, t.proposta, t.pode_proposta], [false, null, null, false]);
    assert.equal((await area('POST', `trabalhos/${tid}/proposta`, boa)).estado, 409);
    assert.equal((await painel('GET', `orcamentos/${id}`)).json.proposta_eletricista.horas, 8, 'o painel continua a ver a proposta');
  });
});
