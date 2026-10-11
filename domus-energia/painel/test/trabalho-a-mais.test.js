// Trabalho a mais (decisão do dono, 2026-10-11; docs/ELETRICISTAS.md "Trabalho a mais"; migração 47): o preço da
// proposta aceite é definitivo. Se no local o eletricista encontrar o que não se via na planta nem nas fotos, propõe o
// trabalho a mais (descrição, horas e material do catálogo); o CEO põe o preço e envia ao cliente; o cliente aceita ou
// não na conta; só com o "aceito" o eletricista o faz, e o valor soma ao restante que o cliente paga no fim. O
// eletricista nunca vê o preço ao cliente.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

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
const DESCRICAO = 'A caixa de derivação do corredor está queimada: é preciso trocá-la e refazer as ligações.';

describe('trabalho a mais: o eletricista propõe, o CEO põe o preço, o cliente aceita ou não, e o valor soma ao restante', () => {
  let p;
  let seq = 0;
  let e, outro;       // dois eletricistas aprovados em Sintra
  let artigo;         // um artigo do catálogo
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await aprovado();
    outro = await aprovado();
    artigo = (await area(e, 'GET', 'catalogo')).json.artigos[0];
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
  const conta = (c, metodo, caminho, corpo, ip) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo, ip });
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const ficha = async (x, tid) => (await area(x, 'GET', `trabalhos/${tid}`)).json.trabalho;
  const noPainel = async (id, papel = 'ceo') => (await painel('GET', `orcamentos/${id}`, papel)).json;
  const linhaExtra = (xid) => ({ ...p.app.db.prepare('SELECT * FROM trabalhos_extra WHERE id = ?').get(xid) });
  const emailsPara = (email, desde) => p.emails.slice(desde).filter((m) => m.para === email);
  const propor = (x, tid, corpo = {}) => area(x, 'POST', `trabalhos/${tid}/extra`, { descricao: DESCRICAO, horas: 2, material: [{ sku: artigo.sku, qtd: 1 }], ...corpo });
  const enviar = (id, xid, corpo, papel = 'ceo') => painel('POST', `orcamentos/${id}/extras/${xid}/enviar`, papel, corpo);
  const naoAvancar = (id, xid, corpo, papel = 'ceo') => painel('POST', `orcamentos/${id}/extras/${xid}/nao-avancar`, papel, corpo);

  async function aprovado(extra = {}) {
    const n = ++seq;
    const x = { nome: `Eletricista Extra ${n}`, email: `eletricista.extra.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${7000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: x })).estado, 201);
    x.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(x.email).id;
    assert.equal((await painel('POST', `eletricistas/${x.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: x.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: x.email, codigo: p.codigo(x.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...x, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Um pedido com planta enviado pelo site por um cliente com conta. Devolve {c, id}. */
  async function pedido() {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    return { c, id: r.json.pedido };
  }
  /** Obra de um cliente (proposta de 1000 + 500 + 30 € aceite, sinal pago) atribuída a `x`, com a visita marcada. Devolve {c, id, tid}. */
  async function obra(x = e) {
    const { c, id } = await pedido();
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1530, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    const a = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'atribuir', eletricista_id: x.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    assert.equal(a.json.trabalho.tipo, 'obra');
    assert.equal((await area(x, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    return { c, id, tid };
  }
  /** As fotos de antes e de depois e os três ensaios: o que falta para concluir, fora o trabalho a mais. */
  async function preparar(x, tid) {
    for (const g of ['quadro_antes', 'quadro_depois']) {
      const f = await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${g}`, { cookie: x.cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(f.estado, 201, f.texto);
    }
    assert.equal((await area(x, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
  }

  test('o percurso todo: propor (validações, um pendente de cada vez), o CEO envia com o preço, o cliente aceita, o restante sobe o valor com IVA e o eletricista recebe a mais', async () => {
    const { c, id, tid } = await obra();
    await preparar(e, tid);
    const antes = await pedidoConta(c, id);
    assert.deepEqual(antes.extras, []);
    assert.equal(antes.trabalho_a_mais, null);
    assert.equal((await ficha(e, tid)).pode_extra, true);
    assert.deepEqual((await ficha(e, tid)).extras, []);

    // ---- propor: só no seu trabalho, com descrição, horas e material do catálogo
    assert.equal((await propor(outro, tid)).estado, 404, 'o trabalho de outro eletricista não existe para este');
    assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/extra`, { corpo: { descricao: DESCRICAO, horas: 2, material: [] } })).estado, 401);
    assert.equal((await propor(e, tid, { descricao: '' })).estado, 400);
    assert.equal((await propor(e, tid, { descricao: 'x'.repeat(601) })).estado, 400);
    assert.equal((await propor(e, tid, { horas: 0 })).estado, 400);
    assert.equal((await propor(e, tid, { horas: 501 })).estado, 400);
    assert.equal((await propor(e, tid, { material: [{ sku: 'NAO-EXISTE', qtd: 1 }] })).estado, 400);
    assert.equal((await propor(e, tid, { material: [{ sku: artigo.sku, qtd: 0 }] })).estado, 400);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_extra').get().n, 0);
    const nEmails = p.emails.length;
    let r = await propor(e, tid);
    assert.equal(r.estado, 200, r.texto);
    let f = r.json.trabalho;
    assert.equal(f.extras.length, 1);
    const xid = f.extras[0].id;
    assert.equal(f.extras[0].estado, 'proposto');
    assert.equal(f.extras[0].descricao, DESCRICAO);
    assert.equal(f.extras[0].horas, 2);
    assert.deepEqual(f.extras[0].material, [{ sku: artigo.sku, nome: artigo.nome, qtd: 1 }]);
    assert.equal(f.extras[0].recebe, null);
    assert.equal(f.extras[0].pode_retirar, true);
    assert.equal(f.pode_extra, false);
    assert.ok(emailsPara(p.u.ceo.email, nEmails).some((m) => m.assunto === 'Domus Energia: um eletricista propôs trabalho a mais'), 'o CEO é avisado por email');
    // Um pendente de cada vez.
    r = await propor(e, tid, { descricao: 'Outra coisa que apareceu no quadro.' });
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /à espera de resposta/);
    // Concluir fica bloqueado enquanto não houver resposta.
    r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 409);
    assert.equal(r.json.erro, 'Há um trabalho a mais à espera de resposta.');
    assert.deepEqual((await ficha(e, tid)).falta, ['a resposta ao trabalho a mais']);
    // O cliente ainda não vê nada; o CEO tem um por rever.
    assert.deepEqual((await pedidoConta(c, id)).extras, []);
    assert.equal((await painel('GET', 'resumo')).json.tratar.extras, 1);

    // ---- o CEO vê a sugestão de preço (como na proposta) e o que o eletricista recebe; só ele envia
    let o = await noPainel(id);
    assert.equal(o.extras.length, 1);
    assert.equal(o.extras[0].estado, 'proposto');
    assert.equal(o.extras[0].eletricista.id, e.id);
    assert.equal(o.extras[0].sugestao.mao_obra, Math.round((2 * 38 * 100) / 1.23) / 100, 'mão de obra = horas × a tarifa/hora, sem IVA');
    assert.ok(o.extras[0].sugestao.material > 0);
    assert.equal(o.extras[0].material[0].valor, o.extras[0].sugestao.material);
    assert.equal(o.extras[0].recebe.percentagem, 70);
    assert.equal(o.extras[0].recebe.total, Math.round(o.extras[0].sugestao.mao_obra * 70) / 100);
    assert.equal(o.extras[0].valores, null);
    assert.equal(o.extras[0].pode_enviar, true);
    assert.equal((await noPainel(id, 'comercial')).extras.length, 1, 'o comercial vê o trabalho a mais na ficha');
    assert.equal((await enviar(id, xid, { mao_obra: 80, material: 20 }, 'comercial')).estado, 403);
    assert.equal((await enviar(id, xid, { mao_obra: 80, material: 20 }, 'tecnico')).estado, 403);
    assert.equal((await enviar(id, xid, { mao_obra: 0, material: 0 })).estado, 400);
    assert.equal((await enviar(id, xid, { mao_obra: -1, material: 20 })).estado, 400);
    assert.equal((await enviar(id, xid, { material: 20 })).estado, 400);
    assert.equal((await enviar(id, 99999, { mao_obra: 80, material: 20 })).estado, 404);
    assert.equal(linhaExtra(xid).estado, 'proposto');
    const nAntesEnvio = p.emails.length;
    r = await enviar(id, xid, { mao_obra: 80, material: 20 });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.extras[0].estado, 'enviado');
    assert.deepEqual(r.json.extras[0].valores, { mao_obra: 80, material: 20, total: 100, total_iva: 123 });
    assert.equal(r.json.extras[0].recebe.total, 56, '70 % × 80 € de mão de obra');
    assert.equal((await enviar(id, xid, { mao_obra: 80, material: 20 })).estado, 409, 'só se envia uma vez');
    assert.equal((await painel('GET', 'resumo')).json.tratar.extras, 0);
    // O email ao cliente: o total com IVA e a frase que diz que sem resposta não se faz.
    const email = emailsPara(c.email, nAntesEnvio);
    assert.equal(email.length, 1);
    assert.equal(email[0].assunto, 'Domus Energia: trabalho a mais por aceitar');
    assert.match(email[0].texto, /123,00 € \(com IVA\)/);
    assert.match(email[0].texto, /Na sua conta diz se aceita ou não\. Sem a sua resposta, este trabalho não é feito\./);
    assert.match(email[0].texto, /https:\/\/site\.teste\/conta\.html/);
    assert.ok(email[0].texto.includes(DESCRICAO));
    // O eletricista vê "à espera do cliente", sem preço nenhum, e já não o retira; concluir continua bloqueado.
    f = await ficha(e, tid);
    assert.equal(f.extras[0].estado, 'enviado');
    assert.equal(f.extras[0].recebe, null);
    assert.doesNotMatch(JSON.stringify(f.extras), /valor|cent|123|"total"/);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/extra/${xid}/retirar`, {})).estado, 409);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 409);

    // ---- o cliente: vê o valor, e só ele responde
    let l = await pedidoConta(c, id);
    assert.equal(l.extras.length, 1);
    assert.deepEqual({ ...l.extras[0], quando: null }, { id: xid, descricao: DESCRICAO, valor: 100, valor_iva: 123, estado: 'enviado', quando: null });
    assert.equal(l.restante.valor, antes.restante.valor, 'enviado ainda não mexe no dinheiro');
    const alheia = await p.contaConfirmada();
    assert.equal((await conta(alheia, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {})).estado, 404, 'outra conta não chega a este pedido');
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/extras/${xid}/aceitar`, { corpo: {} })).estado, 401);
    const outra = await obra(outro);
    assert.equal((await conta(outra.c, 'POST', `pedidos/${outra.id}/extras/${xid}/aceitar`, {})).estado, 404, 'o trabalho a mais é de outro pedido');
    assert.equal(linhaExtra(xid).estado, 'enviado');
    const nAntesAceitar = p.emails.length;
    r = await conta(c, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {}, '203.0.113.47');
    assert.equal(r.estado, 200, r.texto);
    l = r.json.pedido;
    assert.equal(l.extras[0].estado, 'aceite');
    assert.ok(l.extras[0].quando);
    // O restante sobe exatamente o valor com IVA; o sinal já pago não muda; o total passa a levar o trabalho a mais.
    assert.equal(Math.round((l.restante.valor - antes.restante.valor) * 100), 12300);
    assert.equal(Math.round((l.proposta_iva.total - antes.proposta_iva.total) * 100), 12300);
    assert.equal(Math.round((l.proposta_iva.base - antes.proposta_iva.base) * 100), 10000);
    assert.equal(l.sinal.valor, antes.sinal.valor);
    assert.deepEqual(l.trabalho_a_mais, { valor: 100, total: 123 });
    assert.equal(l.proposta.valor, 1530, 'a proposta aceite não muda');
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {})).estado, 409, 'só se responde uma vez');
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/recusar`, {})).estado, 409);
    const aud = p.app.db.prepare("SELECT * FROM auditoria WHERE acao = 'trabalho_extra_aceite_cliente' AND alvo = ?").get(`orcamento:${id}`);
    assert.equal(aud.ip, '203.0.113.47', 'o aceite fica na auditoria com o IP');
    o = await noPainel(id);
    assert.equal(o.extras[0].estado, 'aceite');
    assert.equal(o.valores_pagamento.extras, 100);
    assert.ok(o.historico.some((h) => h.acao === 'trabalho_extra_enviado') && o.historico.some((h) => h.acao === 'trabalho_extra_proposto'));
    // O eletricista é avisado, vê que pode fazer e o que recebe a mais; e já pode concluir (e propor outro).
    const aviso = emailsPara(e.email, nAntesAceitar);
    assert.equal(aviso.length, 1);
    assert.match(aviso[0].texto, new RegExp(`aceitou o trabalho a mais do pedido n\\.º ${id} .*: pode avançar\\.`));
    f = await ficha(e, tid);
    assert.equal(f.extras[0].estado, 'aceite');
    assert.deepEqual(f.extras[0].recebe, { percentagem: 70, mao_obra: 80, parte_mao_obra: 56, deslocacao: 0, total: 56, provisoria: false });
    assert.equal(f.pode_extra, true);
    assert.deepEqual(f.falta, []);
    r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await propor(e, tid)).estado, 409, 'com a obra dada por concluída já não se propõe');

    // ---- o cliente confirma, o CEO aprova: o eletricista recebe 70 % × 1000 + 30 da proposta e 70 % × 80 do trabalho a mais
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 5 })).estado, 200);
    r = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'aprovar' });
    assert.equal(r.estado, 200, r.texto);
    const t = p.app.db.prepare('SELECT valor_cent, valor_detalhe FROM trabalhos_eletricista WHERE id = ?').get(tid);
    assert.equal(t.valor_cent, 70000 + 3000 + 5600);
    const detalhe = JSON.parse(t.valor_detalhe);
    assert.equal(detalhe.extras, 80);
    assert.equal(detalhe.parte_extras, 56);
    assert.equal(detalhe.total, 786);
    // E o cliente paga o restante com o trabalho a mais dentro; a obra fica toda paga.
    l = await pedidoConta(c, id);
    assert.equal(l.pode_pagar_restante, true);
    r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'restante' });
    assert.ok(r.estado === 200 || r.estado === 201, r.texto);
    assert.equal(Math.round(r.json.pagamento.valor * 100), Math.round((antes.restante.valor + 123) * 100));
    assert.equal((await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    assert.equal((await pedidoConta(c, id)).obra_paga, true);
  });

  test('o cliente não aceita: nada muda no dinheiro, o eletricista vê que não é para fazer (sem o texto do cliente) e pode concluir; ao apagar a conta o texto sai', async () => {
    const { c, id, tid } = await obra();
    await preparar(e, tid);
    const antes = await pedidoConta(c, id);
    const xid = (await propor(e, tid)).json.trabalho.extras[0].id;
    assert.equal((await enviar(id, xid, { mao_obra: 50, material: 0 })).estado, 200);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/recusar`, { texto: 'x'.repeat(501) })).estado, 400);
    const n = p.emails.length;
    const r = await conta(c, 'POST', `pedidos/${id}/extras/${xid}/recusar`, { texto: 'Fica para outra altura.' });
    assert.equal(r.estado, 200, r.texto);
    const l = r.json.pedido;
    assert.equal(l.extras[0].estado, 'recusado');
    assert.equal(l.restante.valor, antes.restante.valor);
    assert.equal(l.proposta_iva.total, antes.proposta_iva.total);
    assert.equal(l.trabalho_a_mais, null);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {})).estado, 409);
    assert.match(emailsPara(e.email, n)[0].texto, /não aceitou o trabalho a mais .*: não faça esse trabalho\./);
    const f = await ficha(e, tid);
    assert.equal(f.extras[0].estado, 'recusado');
    assert.equal(f.extras[0].nota, null, 'o que o cliente escreveu não vai para o eletricista');
    assert.equal(f.extras[0].recebe, null);
    assert.doesNotMatch(JSON.stringify(f), /Fica para outra altura/);
    assert.equal((await noPainel(id)).extras[0].nota, 'Fica para outra altura.', 'a empresa vê o que o cliente escreveu');
    assert.equal(f.pode_extra, true);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200, 'sem pendentes, conclui');
    // Aprovado sem trabalho a mais aceite: o valor é o de sempre.
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 4 })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal(p.app.db.prepare('SELECT valor_cent FROM trabalhos_eletricista WHERE id = ?').get(tid).valor_cent, 73000);
    // Conta apagada (RGPD): o pedido fica anonimizado e o texto do cliente sai do trabalho a mais.
    const contaId = p.app.db.prepare('SELECT conta_id FROM orcamentos WHERE id = ?').get(id).conta_id;
    const ap = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email });
    assert.equal(ap.estado, 200, ap.texto);
    assert.ok(p.app.db.prepare('SELECT anonimizado FROM orcamentos WHERE id = ?').get(id).anonimizado);
    assert.equal(linhaExtra(xid).nota, null);
    assert.equal(linhaExtra(xid).estado, 'recusado');
  });

  test('o CEO não avança (com o motivo, só ele), o eletricista retira o seu enquanto está por rever, e um já enviado que caiu não se aceita', async () => {
    const { c, id, tid } = await obra();
    // ---- "Não avançar" num por rever: o eletricista vê o motivo e pode propor outro
    let xid = (await propor(e, tid)).json.trabalho.extras[0].id;
    assert.equal((await naoAvancar(id, xid, { motivo: 'Já estava na proposta.' }, 'comercial')).estado, 403);
    assert.equal((await naoAvancar(id, xid, {})).estado, 400, 'o motivo é obrigatório');
    let r = await naoAvancar(id, xid, { motivo: 'Já estava na proposta.' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.extras[0].estado, 'retirado');
    assert.equal(r.json.extras[0].nota, 'Já estava na proposta.');
    assert.equal((await naoAvancar(id, xid, { motivo: 'Outra vez.' })).estado, 409);
    assert.equal((await enviar(id, xid, { mao_obra: 10, material: 0 })).estado, 409);
    let f = await ficha(e, tid);
    assert.equal(f.extras[0].estado, 'retirado');
    assert.equal(f.extras[0].nota, 'Já estava na proposta.');
    assert.equal(f.pode_extra, true);
    assert.deepEqual((await pedidoConta(c, id)).extras, []);

    // ---- retirar: só o próprio, só enquanto está por rever
    r = await propor(e, tid, { descricao: 'Falta um ponto de luz na despensa.' });
    assert.equal(r.estado, 200, r.texto);
    xid = r.json.trabalho.extras.at(-1).id;
    assert.equal((await area(outro, 'POST', `trabalhos/${tid}/extra/${xid}/retirar`, {})).estado, 404);
    const deOutro = await obra(outro);
    assert.equal((await area(outro, 'POST', `trabalhos/${deOutro.tid}/extra/${xid}/retirar`, {})).estado, 404, 'o extra de outro trabalho não se retira pelo seu');
    r = await area(e, 'POST', `trabalhos/${tid}/extra/${xid}/retirar`, {});
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.trabalho.extras.at(-1).estado, 'retirado');
    assert.equal(r.json.trabalho.extras.at(-1).nota, null);
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/extra/${xid}/retirar`, {})).estado, 409);
    assert.equal((await enviar(id, xid, { mao_obra: 10, material: 0 })).estado, 409, 'um retirado já não se envia');
    assert.equal((await painel('GET', 'resumo')).json.tratar.extras, 0);

    // ---- "Não avançar" num já enviado: sai da conta do cliente e já não se aceita
    xid = (await propor(e, tid)).json.trabalho.extras.at(-1).id;
    assert.equal((await enviar(id, xid, { mao_obra: 40, material: 10 })).estado, 200);
    assert.equal((await pedidoConta(c, id)).extras.length, 1);
    assert.equal((await naoAvancar(id, xid, { motivo: 'O cliente ligou: fica para depois.' })).estado, 200);
    assert.deepEqual((await pedidoConta(c, id)).extras, []);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {})).estado, 409);
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM trabalhos_extra WHERE orcamento_id = ? AND estado = 'retirado'").get(id).n, 3);
    f = await ficha(e, tid);
    assert.deepEqual(f.falta.filter((x) => /trabalho a mais/.test(x)), []);
  });

  test('atribuir num pedido com planta pede a proposta só a esse eletricista; e se o trabalho sai do eletricista, o trabalho a mais à espera cai', async () => {
    // Pedido com planta ainda sem proposta aceite: "atribuir" já não entrega o cliente nem pede visita (decisão do dono,
    // 2026-10-11) — pede a proposta só a esse eletricista. O trabalho fica na bolsa, visível só para ele.
    const v = await pedido();
    const a = await painel('POST', `orcamentos/${v.id}/eletricista`, 'ceo', { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    assert.deepEqual([a.json.trabalho.tipo, a.json.trabalho.estado, a.json.trabalho.eletricista, a.json.trabalho.so_para.id], ['visita', 'na_bolsa', null, e.id]);
    assert.match(p.emails.at(-1).assunto, /pedimos-lhe uma proposta/);
    const naBolsa = async (x) => (await area(x, 'GET', 'bolsa')).json.trabalhos.map((t) => t.id);
    assert.ok((await naBolsa(e)).includes(a.json.trabalho.id), 'ele vê o pedido na bolsa');
    assert.ok(!(await naBolsa(outro)).includes(a.json.trabalho.id), 'os outros do concelho não');
    assert.equal((await area(outro, 'GET', `bolsa/${a.json.trabalho.id}`)).estado, 404);
    const visto = (await area(e, 'GET', `bolsa/${a.json.trabalho.id}`)).json.trabalho;
    assert.ok(!JSON.stringify(visto).includes('912 345 678') && !visto.cliente, 'sem os dados do cliente');
    // Ainda não é dele: não marca visita nem propõe trabalho a mais.
    assert.equal((await area(e, 'POST', `trabalhos/${a.json.trabalho.id}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 404);
    assert.notEqual((await propor(e, a.json.trabalho.id)).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${v.id}/eletricista`, 'ceo', { acao: 'retirar' })).estado, 200);

    // O CEO retira a obra ao eletricista com um trabalho a mais enviado ao cliente: cai, e o cliente já não o aceita.
    const { c, id, tid } = await obra();
    const xid = (await propor(e, tid)).json.trabalho.extras[0].id;
    assert.equal((await enviar(id, xid, { mao_obra: 60, material: 0 })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'retirar' })).estado, 200);
    assert.equal(linhaExtra(xid).estado, 'retirado');
    assert.deepEqual((await pedidoConta(c, id)).extras, []);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/aceitar`, {})).estado, 409);
  });
});

describe('trabalho a mais com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0' } }); });
  after(() => p.fechar());

  test('as rotas não existem (404) e o resumo do CEO não traz a contagem', async () => {
    assert.equal((await p.pedir('POST', '/painel/api/orcamentos/1/extras/1/enviar', { cookie: p.cookies.ceo, corpo: { mao_obra: 10, material: 0 } })).estado, 404);
    assert.equal((await p.pedir('POST', '/painel/api/orcamentos/1/extras/1/nao-avancar', { cookie: p.cookies.ceo, corpo: { motivo: 'Não.' } })).estado, 404);
    const c = await p.contaConfirmada();
    assert.equal((await p.pedir('POST', '/api/conta/pedidos/1/extras/1/aceitar', { cookie: c.cookie, corpo: {} })).estado, 404);
    assert.equal((await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.ceo })).json.tratar.extras, undefined);
  });
});
