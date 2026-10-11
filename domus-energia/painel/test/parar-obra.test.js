// Parar a obra por segurança (decisão do dono, 2026-10-11; docs/ELETRICISTAS.md "Parar a obra por segurança"; migração
// 50): se o cliente não aceita um trabalho a mais e o que se encontrou impede uma instalação segura, a obra não avança
// e devolve-se o sinal menos o material já encomendado à medida e o trabalho já feito. O CEO indica o que fica retido
// (e o que se paga ao eletricista pelo que já fez).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
const MOTIVO = 'O quadro não tem terra de proteção e a instalação antiga não aguenta os circuitos novos sem a refazer.';
const euroTxt = (v) => `${v.toFixed(2).replace('.', ',')} €`;
const cent = (v) => Math.round(v * 100);

describe('parar a obra por segurança: o CEO indica o que fica retido, devolve-se o resto do sinal e a obra fecha', () => {
  let p;
  let seq = 0;
  let e;              // um eletricista aprovado em Sintra
  let artigo;         // um artigo do catálogo (para o trabalho a mais)
  let idArtigo;       // o artigo da simulação, com stock gerido
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await aprovado();
    artigo = (await area(e, 'GET', 'catalogo')).json.artigos[0];
    // O artigo da simulação passa a ter stock gerido: com o sinal pago ficam 10 reservados.
    idArtigo = p.app.db.prepare("SELECT id FROM catalogo WHERE sku = 'TONGOU-SY2-JWT'").get().id;
    assert.equal((await painel('POST', `catalogo/${idArtigo}/stock`, 'ceo', { qtd: 50, motivo: 'entrada' })).estado, 201);
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
  const reservado = () => p.app.db.prepare('SELECT stock_reservado FROM catalogo WHERE id = ?').get(idArtigo).stock_reservado;
  const linhaTrabalho = (tid) => ({ ...p.app.db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = ?').get(tid) });
  const emailsPara = (email, desde) => p.emails.slice(desde).filter((m) => m.para === email);
  const parar = (id, corpo, papel = 'ceo') => painel('POST', `orcamentos/${id}/parar-obra`, papel, corpo);

  async function aprovado() {
    const n = ++seq;
    const x = { nome: `Eletricista Parar ${n}`, email: `eletricista.parar.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${9000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: x })).estado, 201);
    x.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(x.email).id;
    assert.equal((await painel('POST', `eletricistas/${x.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: x.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: x.email, codigo: p.codigo(x.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...x, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Um pedido com planta enviado pelo site por um cliente com conta, com a proposta (1000 + 500 + 30 €) enviada. Devolve {c, id}. */
  async function comProposta() {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    return { c, id };
  }
  /** … aceite, com o sinal pago (por omissão por cartão). Devolve {c, id, sinal} (o sinal em €). */
  async function aceite(metodo = 'card') {
    const { c, id } = await comProposta();
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1530, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso', metodo })).json.pagamento.estado, 'pago');
    return { c, id, sinal: ac.json.pagamento.valor };
  }
  /** … com a obra atribuída ao eletricista e a visita marcada (e já passada). Devolve {c, id, sinal, tid}. */
  async function obra(metodo = 'card') {
    const x = await aceite(metodo);
    const a = await painel('POST', `orcamentos/${x.id}/eletricista`, 'ceo', { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    p.relogio.avancar(31 * HORA);
    return { ...x, tid };
  }

  test('o percurso todo: validações, devolução parcial, obra cancelada, stock libertado, trabalho a mais e ida perdida pendentes fechados, o eletricista recebe só o que fez, email e conta do cliente com a conta feita', async () => {
    const antesStock = reservado();
    const { c, id, sinal, tid } = await obra();
    assert.equal(reservado(), antesStock + 10, 'o material ficou reservado com o sinal');
    // Um trabalho a mais já enviado ao cliente (que não o aceita) e uma ida perdida por confirmar.
    const xid = (await area(e, 'POST', `trabalhos/${tid}/extra`, { descricao: 'A instalação antiga não tem terra: é preciso refazer os circuitos.', horas: 6, material: [{ sku: artigo.sku, qtd: 1 }] })).json.trabalho.extras[0].id;
    assert.equal((await painel('POST', `orcamentos/${id}/extras/${xid}/enviar`, 'ceo', { mao_obra: 300, material: 80 })).estado, 200);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid}/recusar`, { texto: 'Não posso pagar isso agora.' })).estado, 200);
    const xid2 = (await area(e, 'POST', `trabalhos/${tid}/extra`, { descricao: 'Trocar também a caixa de derivação da cozinha.', horas: 1, material: [] })).json.trabalho.extras[1].id;
    assert.equal((await painel('POST', `orcamentos/${id}/extras/${xid2}/enviar`, 'ceo', { mao_obra: 40, material: 0 })).estado, 200);
    const iid = (await area(e, 'POST', `trabalhos/${tid}/ida-perdida`, { nota: 'Voltei no dia seguinte e não estava ninguém.' })).json.trabalho.idas_perdidas[0].id;
    const antes = await pedidoConta(c, id);
    assert.deepEqual([antes.estado, antes.sinal.pago, antes.sinal.valor], ['aceite', true, sinal]);
    assert.ok(antes.restante.valor > 0);
    assert.equal(antes.obra_parada, null);

    // ---- só o CEO; motivo obrigatório (10 a 600 caracteres); valores ≥ 0; o retido nunca passa o sinal
    const bom = { motivo: MOTIVO, material: 100, trabalho: 50, eletricista: 40 };
    assert.equal((await parar(id, bom, 'comercial')).estado, 403);
    assert.equal((await parar(id, bom, 'tecnico')).estado, 403);
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/parar-obra`, { corpo: bom })).estado, 401);
    assert.equal((await parar(id, { ...bom, motivo: undefined })).estado, 400);
    assert.equal((await parar(id, { ...bom, motivo: 'Curto.' })).estado, 400);
    assert.equal((await parar(id, { ...bom, motivo: 'x'.repeat(601) })).estado, 400);
    assert.equal((await parar(id, { ...bom, material: -1 })).estado, 400);
    assert.equal((await parar(id, { ...bom, trabalho: 'muito' })).estado, 400);
    assert.equal((await parar(id, { ...bom, eletricista: -5 })).estado, 400);
    let r = await parar(id, { ...bom, material: sinal, trabalho: 0.01 });
    assert.equal(r.estado, 400);
    assert.match(r.json.erro, /não podem passar o sinal pago/);
    assert.equal((await parar(99999, bom)).estado, 404);
    // Nada mexeu até aqui.
    assert.equal((await pedidoConta(c, id)).estado, 'aceite');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM obras_paradas').get().n, 0);
    assert.equal(reservado(), antesStock + 10);

    // ---- parar: devolve o sinal menos 100 € de material e 50 € de trabalho; o eletricista recebe 40 € pelo que fez
    const devolver = Math.round((sinal - 150) * 100) / 100;
    const nEmails = p.emails.length;
    r = await parar(id, bom);
    assert.equal(r.estado, 200, r.texto);
    const o = r.json;
    assert.deepEqual([o.estado, o.obra.estado, o.motivo_perda], ['perdido', 'cancelada', `Obra parada por segurança: ${MOTIVO}`]);
    assert.deepEqual(o.pagamentos.filter((x) => x.fase === 'sinal').map((x) => [x.estado, x.valor, x.devolvido, x.a_devolver]), [['pago', sinal, devolver, null]], 'devolução parcial: o pagamento fica pago, com o devolvido');
    assert.deepEqual(o.devolucoes, [], 'pago por cartão: a devolução é automática, sem IBAN');
    assert.deepEqual({ ...o.obra_parada, quando: null }, { motivo: MOTIVO, sinal, material: 100, trabalho: 50, devolver, manual: false, simulado: true, quando: null, eletricista: 40, por: p.u.ceo.email });
    const aud = o.historico.find((h) => h.acao === 'obra_parada_seguranca');
    assert.deepEqual([aud.detalhes.sinal, aud.detalhes.material, aud.detalhes.trabalho, aud.detalhes.devolvido, aud.detalhes.eletricista, aud.detalhes.estado, aud.detalhes.motivo, aud.detalhes.trabalho_estado],
      [sinal, 100, 50, devolver, 40, 'perdido', MOTIVO, 'aprovada']);
    assert.equal(reservado(), antesStock, 'o material reservado foi libertado');
    assert.deepEqual(p.app.db.prepare('SELECT id, estado FROM obras WHERE orcamento_id = ?').all(id).map((x) => x.estado), ['cancelada'], 'a obra não se apaga');
    // Os pendentes fecham: o trabalho a mais à espera do cliente fica retirado e a ida perdida anulada; o já recusado fica.
    const extra = (x) => p.app.db.prepare('SELECT estado, nota FROM trabalhos_extra WHERE id = ?').get(x);
    assert.deepEqual([extra(xid).estado, extra(xid2).estado, extra(xid2).nota], ['recusado', 'retirado', 'A obra foi parada por segurança.']);
    const ida = p.app.db.prepare('SELECT estado, motivo FROM idas_perdidas WHERE id = ?').get(iid);
    assert.deepEqual([ida.estado, ida.motivo], ['anulada', 'A obra foi parada por segurança.']);
    assert.equal((await painel('GET', 'resumo')).json.tratar.idas_perdidas, 0);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/extras/${xid2}/aceitar`, {})).estado, 409, 'o trabalho a mais já não se aceita');
    // Só se para uma vez; e o "Cancelar obra e devolver sinal" também já não devolve outra vez.
    assert.equal((await parar(id, bom)).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/devolver-sinal`, 'ceo', {})).estado, 409);

    // ---- o eletricista: o trabalho fecha aprovado com os 40 € (sem IVA), sem esperar pelo cliente nem pelo restante
    const t = linhaTrabalho(tid);
    assert.deepEqual([t.estado, t.valor_cent, t.aprovada_por, t.confirmada], ['aprovada', 4000, p.u.ceo.email, null]);
    assert.deepEqual(JSON.parse(t.valor_detalhe), { percentagem: 70, mao_obra: 0, parte_mao_obra: 0, deslocacao: 0, total: 40, obra_parada: true });
    const avisoE = emailsPara(e.email, nEmails);
    assert.equal(avisoE.length, 1);
    assert.equal(avisoE[0].assunto, 'Domus Energia: a obra foi parada por segurança');
    assert.match(avisoE[0].texto, /Pelo trabalho que já fez recebe 40,00 € \(sem IVA\)\./);
    let f = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.estado, f.aberto, f.cliente, f.obra_parada, f.recebe.total], ['aprovada', false, null, true, 40], 'fechado: sem os dados do cliente, com o valor do que fez');
    let pg = (await area(e, 'GET', 'pagamentos')).json.trabalhos.find((x) => x.id === tid);
    assert.deepEqual([pg.pagamento, pg.valor.total, pg.valor.obra_parada, pg.valor_fixado, pg.pode_fatura], ['fatura_em_falta', 40, true, true, true]);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 409, 'sem fatura-recibo ainda não se paga');
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/fatura`, { tipo: 'application/pdf', dados: PDF.toString('base64') })).estado, 201);
    pg = (await painel('GET', 'pagamentos-eletricistas')).json.trabalhos.find((x) => x.id === tid);
    assert.deepEqual([pg.pagamento, pg.valor.total, Boolean(pg.prazo)], ['a_pagar', 40, true]);
    assert.equal((await painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 200);
    assert.equal(linhaTrabalho(tid).estado, 'paga');
    // A conta do cliente não ganha um "trabalho concluído" por confirmar nem por avaliar.
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 5 })).estado, 409);

    // ---- o cliente: o email com o motivo e a conta feita; na conta, o bloco com os mesmos valores e nada por pagar
    const email = emailsPara(c.email, nEmails);
    assert.equal(email.length, 1);
    assert.equal(email[0].assunto, `Domus Energia: a obra do seu pedido n.º ${id} não pode avançar em segurança`);
    for (const linha of [`A obra do seu pedido n.º ${id} não pode avançar em segurança.`, MOTIVO, `Sinal pago: ${euroTxt(sinal)}`, 'Material já encomendado: 100,00 €', 'Trabalho já feito: 50,00 €',
      `A devolver: ${euroTxt(devolver)}`, `Devolvemos ${euroTxt(devolver)} para o mesmo meio de pagamento (até 14 dias)`, 'responda a este email ou ligue-nos', 'https://site.teste/conta.html']) {
      assert.ok(email[0].texto.includes(linha), linha);
    }
    assert.ok(!email[0].texto.includes('40,00'), 'o que se paga ao eletricista não vai para o cliente');
    const l = await pedidoConta(c, id);
    assert.deepEqual([l.estado, l.estado_texto], ['perdido', 'A obra não pode avançar em segurança: veja abaixo.']);
    assert.deepEqual({ ...l.obra_parada, quando: null }, { motivo: MOTIVO, sinal, material: 100, trabalho: 50, devolver, manual: false, simulado: true, quando: null });
    assert.deepEqual([l.restante, l.pode_pagar_restante, l.proposta, l.obra, l.confirmacao, l.em_andamento], [null, false, null, null, null, false], 'sem restante por pagar, sem proposta por aceitar, sem obra');
    assert.ok(!l.extras.some((x) => x.estado === 'enviado'), 'nenhum trabalho a mais por aceitar');
    assert.equal((await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'restante' })).estado, 409);
    assert.ok(!JSON.stringify(l).includes('"eletricista"'), 'a conta não leva o valor do eletricista');
  });

  test('pago por Multibanco: a parte a devolver segue por transferência (a conta pede o IBAN); com tudo retido não há devolução; sem valor para o eletricista o trabalho é retirado', async () => {
    // ---- Multibanco, devolução parcial, 0 € para o eletricista
    const a = await obra('multibanco');
    const n = p.emails.length;
    let r = await parar(a.id, { motivo: MOTIVO, material: 200, trabalho: 0 });
    assert.equal(r.estado, 200, r.texto);
    const devolver = Math.round((a.sinal - 200) * 100) / 100;
    assert.deepEqual([r.json.estado, r.json.obra.estado, r.json.pagamentos.filter((x) => x.fase === 'sinal').map((x) => [x.estado, x.a_devolver, x.devolvido]), r.json.devolucoes.map((d) => [d.motivo, d.estado, d.valor])],
      ['perdido', 'cancelada', [['pago', devolver, null]], [['sinal', 'pede_iban', devolver]]]);
    assert.deepEqual([r.json.obra_parada.devolver, r.json.obra_parada.manual, r.json.obra_parada.eletricista], [devolver, true, 0]);
    assert.ok(emailsPara(a.c.email, n)[0].texto.includes(`Como pagou por referência Multibanco, devolvemos ${euroTxt(devolver)} por transferência bancária: indique o IBAN na sua conta.`));
    const l = await pedidoConta(a.c, a.id);
    assert.deepEqual([l.obra_parada.manual, l.devolucoes.map((d) => [d.estado, d.valor])], [true, [['pede_iban', devolver]]]);
    // Sem nada a pagar-lhe, o trabalho sai do eletricista como no "Retirar" (não fica nada por pagar).
    assert.deepEqual([linhaTrabalho(a.tid).estado, linhaTrabalho(a.tid).valor_cent], ['retirado', null]);
    assert.ok(emailsPara(e.email, n).some((m) => m.assunto === 'Domus Energia: trabalho retirado'));
    assert.equal((await area(e, 'GET', `trabalhos/${a.tid}`)).estado, 404);

    // ---- tudo retido (material + trabalho = sinal): não há devolução nenhuma
    const b = await obra();
    const n2 = p.emails.length;
    const metade = Math.floor(cent(b.sinal) / 2) / 100;
    r = await parar(b.id, { motivo: MOTIVO, material: metade, trabalho: Math.round((b.sinal - metade) * 100) / 100, eletricista: 25.5 });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.estado, r.json.obra_parada.devolver, r.json.devolucoes, r.json.pagamentos.filter((x) => x.fase === 'sinal').map((x) => [x.estado, x.devolvido, x.a_devolver])],
      ['perdido', 0, [], [['pago', null, null]]]);
    const email = emailsPara(b.c.email, n2)[0].texto;
    assert.ok(email.includes('A devolver: 0,00 €') && email.includes('não há valor a devolver') && !email.includes('Devolvemos'));
    assert.deepEqual([linhaTrabalho(b.tid).estado, linhaTrabalho(b.tid).valor_cent], ['aprovada', 2550]);
    assert.equal((await pedidoConta(b.c, b.id)).obra_parada.devolver, 0);
  });

  test('estados errados (409): sem proposta aceite, sem sinal pago, obra já dada por concluída ou concluída, e valor para um eletricista que o pedido não tem', async () => {
    const corpo = { motivo: MOTIVO, material: 0, trabalho: 0 };
    // Proposta enviada, ainda por aceitar.
    const a = await comProposta();
    let r = await parar(a.id, corpo);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /Só se para a obra de um pedido aceite/);
    // Aceite à mão no painel, sem sinal pago.
    assert.equal((await painel('POST', `orcamentos/${a.id}`, 'ceo', { estado: 'aceite' })).estado, 200);
    r = await parar(a.id, corpo);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /não tem o sinal pago/);
    // Com o sinal pago mas sem eletricista: não há a quem pagar o trabalho já feito; sem esse valor, para-se.
    const b = await aceite();
    r = await parar(b.id, { ...corpo, eletricista: 30 });
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /não está com um eletricista/);
    assert.equal((await pedidoConta(b.c, b.id)).estado, 'aceite', 'nada foi devolvido');
    // Obra concluída no painel: o sinal já não se devolve.
    const d = await aceite();
    assert.equal((await painel('POST', `orcamentos/${d.id}/obra-concluida`, 'ceo', {})).estado, 200);
    r = await parar(d.id, corpo);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /A obra já foi feita/);
    // O eletricista já deu a obra por concluída (à espera do cliente): já não se para aqui.
    const f = await obra();
    for (const g of ['quadro_antes', 'quadro_depois']) assert.equal((await p.pedir('POST', `/api/eletricista/trabalhos/${f.tid}/fotos/${g}`, { cookie: e.cookie, corpo: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]), tipo: 'image/jpeg' })).estado, 201);
    assert.equal((await area(e, 'POST', `trabalhos/${f.tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    assert.equal((await area(e, 'POST', `trabalhos/${f.tid}/concluir`, {})).estado, 200);
    r = await parar(f.id, corpo);
    assert.equal(r.estado, 409);
    assert.match(r.json.erro, /já deu a obra por concluída/);
    assert.equal((await pedidoConta(f.c, f.id)).estado, 'aceite');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM obras_paradas WHERE orcamento_id IN (?, ?, ?, ?)').get(a.id, b.id, d.id, f.id).n, 0);
    // … e o pedido sem eletricista para-se sem problema (devolve o sinal todo).
    r = await parar(b.id, corpo);
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.estado, r.json.obra_parada.devolver, r.json.pagamentos.filter((x) => x.fase === 'sinal').map((x) => [x.estado, x.devolvido])], ['perdido', b.sinal, [['devolvido', b.sinal]]]);
  });
});

describe('parar a obra por segurança com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  test('a ação existe na mesma (a obra é da equipa): devolve o sinal menos o retido; não aceita valor para um eletricista', async () => {
    const c = await p.contaConfirmada();
    let r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    const painel = (caminho, corpo) => p.pedir('POST', `/painel/api/${caminho}`, { cookie: p.cookies.ceo, corpo });
    assert.equal((await painel(`orcamentos/${id}`, { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1530, plano: 'base' } });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await p.pedir('POST', `/api/conta/pagamentos/${ac.json.pagamento.ref}/simular`, { cookie: c.cookie, corpo: { resultado: 'sucesso' } })).json.pagamento.estado, 'pago');
    const sinal = ac.json.pagamento.valor;
    assert.equal((await painel(`orcamentos/${id}/parar-obra`, { motivo: MOTIVO, material: 0, trabalho: 0, eletricista: 10 })).estado, 409);
    r = await painel(`orcamentos/${id}/parar-obra`, { motivo: MOTIVO, material: 60, trabalho: 0 });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.estado, r.json.obra.estado, r.json.obra_parada.devolver, r.json.idas_perdidas], ['perdido', 'cancelada', Math.round((sinal - 60) * 100) / 100, undefined]);
  });
});
