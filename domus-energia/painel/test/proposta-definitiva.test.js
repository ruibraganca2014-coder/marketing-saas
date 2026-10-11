// Decisões do dono de 2026-10-11 sobre o fluxo das propostas na bolsa (PROPOSTAS_BOLSA=1, com os pagamentos ligados):
// A) deixa de haver "visita técnica" paga à parte nos pedidos com planta — o pedido vai para a bolsa sem pagamento
//    nenhum, o servidor recusa a compra da visita e a conta não a oferece; quem já a tinha paga mantém o desconto no sinal
//    e a devolução; a avaria continua a exigir o diagnóstico pago;
// B) o cliente paga o restante logo que confirma o trabalho ("Sim", ou os 7 dias), antes de o CEO aprovar; o eletricista
//    só fica "a pagar" com as três condições de sempre; com "Não" não há pagamento.
// Com PROPOSTAS_BOLSA=0 fica tudo como antes (último grupo).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { prazoPagamento } from '../src/eletricistas.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const doc = () => ({ tipo: 'application/pdf', dados: PDF.toString('base64') });
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const DIA = 24 * HORA;
const VISITA_SINTRA = 26.2;   // deslocação 7,20 € + 0,5 h × 38 €
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
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

/** As ajudas comuns aos grupos (cada grupo tem o seu painel `p`). */
function ajudas(obter) {
  let seq = 0;
  const p = () => obter();
  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p().pedir(metodo, `/painel/api/${caminho}`, { cookie: p().cookies[papel], corpo });
    if (r.estado === 401) {
      p().cookies[papel] = await p().entrar(p().u[papel].email);
      r = await p().pedir(metodo, `/painel/api/${caminho}`, { cookie: p().cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => p().pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const conta = (c, metodo, caminho, corpo) => p().pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const confirmar = (c, id, corpo) => conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, corpo);
  const atribuicao = (id, corpo) => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, 'ceo', corpo);
  const linha = (tid) => ({ ...p().app.db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = ?').get(tid) });
  const pagar = (c, id, fase) => conta(c, 'POST', `pedidos/${id}/pagar`, { fase });
  const simular = (c, ref) => conta(c, 'POST', `pagamentos/${ref}/simular`, { resultado: 'sucesso' });
  const meuPagamento = async (e, tid) => (await area(e, 'GET', 'pagamentos')).json.trabalhos.find((x) => x.id === tid);
  async function aprovado(extra = {}) {
    const n = ++seq;
    const e = { nome: `Eletricista Definitiva ${n}`, email: `eletricista.def.${n}.${Math.random().toString(36).slice(2, 8)}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${5000 + n}`,
      concelhos: ['Sintra'], seguro: doc(), consentimento: true, ...extra };
    assert.equal((await p().pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    e.id = p().app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p().pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p().pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p().codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Um pedido com planta enviado pelo site por um cliente com conta, sem comprar nada. Devolve {c, id}. */
  async function pedido(extra = {}) {
    const c = await p().contaConfirmada();
    const r = await p().pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim(), ...extra } });
    assert.equal(r.estado, 201, r.texto);
    return { c, id: r.json.pedido, resposta: r.json };
  }
  /** A proposta em três partes enviada e aceite pelo cliente, com o sinal pago (a obra nasce). */
  async function aceitarEPagarSinal(c, id, { mao = 1000, material = 500, deslocacao = 30 } = {}) {
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: mao, proposta_material: material, proposta_deslocacao: deslocacao })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: mao + material + deslocacao, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await simular(c, ac.json.pagamento.ref)).json.pagamento.estado, 'pago');
  }
  /** O eletricista faz o trabalho todo: visita marcada, fotos de antes e de depois, os três ensaios e "concluído". */
  async function fazer(e, tid) {
    if (linha(tid).estado === 'aceite') {
      assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p().relogio.agora() + 30 * HORA) })).estado, 200);
      p().relogio.avancar(31 * HORA);   // «Obra concluída» só a partir da hora da visita (decisão do dono, 2026-10-11)
    }
    for (const g of ['quadro_antes', 'quadro_depois']) {
      const f = await p().pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${g}`, { cookie: e.cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(f.estado, 201, f.texto);
    }
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    const r = await area(e, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
  }
  /** Obra de um cliente (sinal pago) atribuída diretamente a `e` e dada por concluída. Devolve {c, id, tid}. */
  async function obraFeita(e) {
    const { c, id } = await pedido();
    await aceitarEPagarSinal(c, id);
    const a = await atribuicao(id, { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    await fazer(e, tid);
    return { c, id, tid };
  }
  /** Um pagamento já pago, posto na base como num pedido antigo (com o fluxo novo já não se compra a visita). */
  function pagamentoAntigo(c, id, fase, valor) {
    const agora = new Date(p().relogio.agora()).toISOString();
    const contaId = p().app.db.prepare('SELECT conta_id FROM orcamentos WHERE id = ?').get(id).conta_id;
    const ref = `pp_${String(id).padStart(4, '0')}${'A'.repeat(18)}`;
    p().app.db.prepare(`INSERT INTO pagamentos_pedido (ref, conta_id, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, com_visita, criado, atualizado, expira, iva_pct, pago)
      VALUES (?, ?, ?, ?, ?, 'Visita técnica (pedido antigo)', 'pago', 'simulado', 'conta', 1, ?, ?, ?, 23, ?)`).run(ref, contaId, id, fase, Math.round(valor * 100), agora, agora, p().relogio.agora() + DIA, agora);
    return ref;
  }
  return { painel, area, conta, pedidoConta, confirmar, atribuicao, linha, pagar, simular, meuPagamento, aprovado, pedido, aceitarEPagarSinal, fazer, obraFeita, pagamentoAntigo };
}

describe('propostas na bolsa com os pagamentos ligados: a visita já não se paga à parte (A)', () => {
  let p;
  const x = ajudas(() => p);
  let e;
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await x.aprovado();
  });
  after(() => p.fechar());

  test('"Pedido verificado": o passo fica feito quando a empresa valida o pedido; até à proposta a conta diz que a estamos a preparar; em lista de espera fica o texto da lista', async () => {
    const { c, id } = await x.pedido();
    const validar = (n) => p.app.db.prepare("UPDATE orcamentos SET validacao = 'validado', validacao_em = ? WHERE id = ?").run('2026-10-11T10:00:00.000Z', n);
    validar(id);
    let l = await x.pedidoConta(c, id);
    assert.deepEqual(l.passos.map((s) => [s.chave, s.feito]), [['recebido', true], ['verificado', true], ['proposta', false], ['aceite', false], ['obra', false]]);
    assert.equal(l.passos[1].data, '2026-10-11T10:00:00.000Z');
    assert.equal(l.estado_texto, 'Pedido verificado. Estamos a preparar a proposta.');
    // Com a proposta enviada o texto passa a ser o da proposta; o passo continua feito.
    assert.equal((await x.painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 100, proposta_material: 50, proposta_deslocacao: 10 })).estado, 200);
    l = await x.pedidoConta(c, id);
    assert.equal(l.estado_texto, 'A sua proposta está pronta.');
    assert.deepEqual(l.passos.slice(1, 3).map((s) => s.feito), [true, true]);
    // Lista de espera: validado ou não, enquanto é novo fica o texto da lista de espera.
    const e2 = await x.pedido({ lista_espera: true });
    validar(e2.id);
    l = await x.pedidoConta(e2.c, e2.id);
    assert.equal(l.estado_texto, 'Pedido recebido. Fica em lista de espera, por ordem de chegada. Avisamos por email quando abrirmos. O relatório grátis já está aqui.');
    assert.equal(l.lista_espera, true);
    assert.equal(l.passos[1].feito, true);
  });

  test('o pedido com planta vai para a bolsa sem visita paga; o servidor recusa a compra da visita; a conta não a oferece e o andamento já não tem "Visita técnica" antes da proposta', async () => {
    const { c, id } = await x.pedido();
    // A conta: a visita vem incluída (`incluida`), nada pago; o relatório completo continua à venda.
    let l = await x.pedidoConta(c, id);
    assert.deepEqual([l.compras.visita.incluida, l.compras.visita.paga, l.compras.visita.pendente, l.visita_cancelar], [true, false, null, null]);
    assert.deepEqual([l.relatorio, l.compras.ativas, l.compras.relatorio.comprado], ['por_comprar', true, false]);
    assert.deepEqual(l.passos.map((s) => [s.chave, s.texto]), [['recebido', 'Pedido recebido'], ['verificado', 'Pedido verificado'], ['proposta', 'Proposta'], ['aceite', 'Proposta aceite'], ['obra', 'Visita e obra']]);
    // Por verificar: o passo ainda não está feito e a conta diz que a empresa vai verificar o pedido (não "contactamos").
    assert.equal(l.passos.find((s) => s.chave === 'verificado').feito, false);
    assert.equal(l.estado_texto, 'Pedido recebido. O relatório grátis já está aqui. Verificamos o pedido no dia útil seguinte. Se faltar alguma coisa, dizemos-lhe.');
    // O simulador fica a saber pelo catálogo que a visita já não se vende.
    assert.equal((await p.pedir('GET', '/api/catalogo')).json.pagamentos.visita_a_parte, false);
    // O servidor recusa a visita (sozinha ou com o relatório); o relatório compra-se como sempre.
    for (const fase of ['visita', 'pormenorizado_visita']) {
      const r = await x.pagar(c, id, fase);
      assert.equal(r.estado, 409, `${fase}: ${r.texto}`);
      assert.match(r.json.erro, /já não se paga à parte/);
    }
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ? AND fase IN ('visita', 'pormenorizado_visita')").get(id).n, 0);
    const rel = await x.pagar(c, id, 'relatorio_pormenorizado');
    assert.equal(rel.estado, 200, rel.texto);
    assert.equal(rel.json.pagamento.valor, 29);
    // No passo Enviar: um pedido que traga `compra: visita` é recebido na mesma, sem pagamento (vem `pagamento_erro`).
    const comVisita = await x.pedido({ compra: 'visita' });
    assert.equal(comVisita.resposta.pagamento, undefined);
    assert.match(comVisita.resposta.pagamento_erro, /já não se paga à parte/);
    // Sem pagamento nenhum, o pedido pode ir para a bolsa (antes pedia a visita paga) e fica por proposta.
    const at = (await x.atribuicao(id)).json;
    assert.deepEqual([at.pode, at.tipo, at.motivo], [true, 'visita', null]);
    const posto = await x.atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    assert.deepEqual([posto.json.trabalho.tipo, posto.json.trabalho.estado, posto.json.trabalho.por_proposta], ['visita', 'na_bolsa', true]);
    assert.equal((await x.area(e, 'GET', 'bolsa')).json.trabalhos.some((t) => t.id === posto.json.trabalho.id), true);
  });

  test('pedido antigo com a visita já paga: continua descontada no sinal e a devolução continua a funcionar; só não se vende de novo', async () => {
    // 1) descontada no sinal
    const { c, id } = await x.pedido();
    x.pagamentoAntigo(c, id, 'visita', VISITA_SINTRA);
    let l = await x.pedidoConta(c, id);
    assert.deepEqual([l.compras.visita.paga, l.compras.visita.incluida, l.visita_cancelar.pode, l.visita_cancelar.devolucao], [true, true, true, VISITA_SINTRA]);
    assert.equal((await x.pagar(c, id, 'visita')).estado, 409);
    assert.equal((await x.painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    l = await x.pedidoConta(c, id);
    const total = Math.round(1530 * 1.23 * 100) / 100;
    assert.equal(l.proposta_iva.total, total);
    assert.equal(l.sinal.desconto, VISITA_SINTRA, 'a visita paga antes sai do sinal');
    assert.ok(l.sinal.valor > 0 && l.sinal.valor + VISITA_SINTRA >= Math.round(total * 30) / 100 - 0.01, 'sinal = (30 % ou o material) menos a visita');
    const ac = await x.conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1530, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal(ac.json.pagamento.valor, l.sinal.valor);
    assert.match(ac.json.pagamento.descricao, /menos os 26,20 € já pagos/);
    // 2) a devolução: noutro pedido antigo, ainda por visitar, o cliente cancela a visita e recebe-a de volta
    const b = await x.pedido();
    const ref = x.pagamentoAntigo(b.c, b.id, 'visita', VISITA_SINTRA);
    const canc = await x.conta(b.c, 'POST', `pedidos/${b.id}/cancelar-visita`, {});
    assert.equal(canc.estado, 200, canc.texto);
    assert.deepEqual([canc.json.devolvido, canc.json.manual], [VISITA_SINTRA, false]);
    assert.equal(p.app.db.prepare('SELECT estado FROM pagamentos_pedido WHERE ref = ?').get(ref).estado, 'devolvido');
    l = await x.pedidoConta(b.c, b.id);
    assert.deepEqual([l.compras.visita.paga, l.visita_cancelar], [false, null]);
    assert.equal((await x.pagar(b.c, b.id, 'visita')).estado, 409, 'devolvida, não se vende de novo');
    assert.equal((await x.atribuicao(b.id)).json.pode, true, 'e continua a poder ir para a bolsa');
  });

  test('a avaria não muda: paga o diagnóstico ao enviar e só se atribui com ele pago', async () => {
    const c = await p.contaConfirmada();
    const av = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
    assert.equal(av.estado, 202, av.texto);
    assert.equal(av.json.pagamento.fase, 'avaria');
    const id = (await x.simular(c, av.json.pagamento.ref)).json.pagamento.orcamento_id;
    const l = await x.pedidoConta(c, id);
    assert.deepEqual([l.compras.avaria, l.compras.visita.paga, l.compras.visita.incluida], [true, true, undefined]);
    assert.deepEqual(l.passos.map((s) => s.chave), ['recebido', 'visita', 'proposta', 'aceite', 'obra'], 'na avaria o andamento fica como estava');
    assert.deepEqual([(await x.atribuicao(id)).json.pode, (await x.atribuicao(id)).json.tipo], [true, 'avaria']);
    // Sem o diagnóstico pago (aqui: devolvido) a avaria não se atribui — ao contrário do pedido com planta.
    p.app.db.prepare("UPDATE pagamentos_pedido SET estado = 'devolvido' WHERE ref = ?").run(av.json.pagamento.ref);
    const at = (await x.atribuicao(id)).json;
    assert.deepEqual([at.pode, at.tipo], [false, null]);
    assert.equal((await x.atribuicao(id, { acao: 'bolsa' })).estado, 409);
  });
});

describe('propostas na bolsa com os pagamentos ligados: o restante paga-se logo depois do "Sim" do cliente (B)', () => {
  let p;
  const x = ajudas(() => p);
  let e;
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await x.aprovado();
  });
  after(() => p.fechar());

  test('o fluxo todo: bolsa sem pagamento → proposta → escolha → sinal → obra → "Não" (sem pagamento) → "Sim" → restante pago ANTES de o CEO aprovar → aprovação → fatura → "a pagar"', async () => {
    const { c, id } = await x.pedido();
    const artigos = (await x.area(e, 'GET', 'catalogo')).json.artigos.slice(0, 1);
    const tv = (await x.atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await x.area(e, 'POST', `bolsa/${tv}/proposta`, { horas: 6, material: [{ sku: artigos[0].sku, qtd: 2 }], notas: null, disponibilidade: 'já esta semana' })).estado, 200);
    assert.equal((await x.atribuicao(id, { acao: 'escolher', eletricista_id: e.id })).estado, 200);
    await x.aceitarEPagarSinal(c, id);
    const tid = p.app.db.prepare("SELECT id FROM trabalhos_eletricista WHERE orcamento_id = ? AND tipo = 'obra'").get(id).id;
    // A área do eletricista: a lista diz que o fluxo é por proposta e a ficha da obra vem marcada "de proposta".
    assert.equal((await x.area(e, 'GET', 'trabalhos')).json.propostas_bolsa, true);
    assert.equal((await x.area(e, 'GET', `trabalhos/${tid}`)).json.trabalho.de_proposta, true);
    let l = await x.pedidoConta(c, id);
    assert.deepEqual(l.passos.map((s) => s.texto), ['Pedido recebido', 'Pedido verificado', 'Proposta', 'Proposta aceite', 'Visita e obra']);
    const restante = l.restante.valor;
    assert.ok(restante > 0);
    assert.equal(l.pode_pagar_restante, false, 'com a obra por fazer não se paga o restante');
    assert.equal((await x.pagar(c, id, 'restante')).estado, 409);

    // ---- o eletricista dá a obra por concluída: à espera do cliente, ainda não se paga
    await x.fazer(e, tid);
    l = await x.pedidoConta(c, id);
    assert.deepEqual([l.confirmacao.estado, l.pode_pagar_restante, l.restante.confirmada], ['por_confirmar', false, undefined]);
    assert.equal((await x.pagar(c, id, 'restante')).estado, 409);
    // Decisão do dono, 2026-10-11: já não diz "Instalação marcada."; o passo "Visita e obra" tem a data mas ainda não está feito.
    assert.equal(l.estado_texto, 'O trabalho foi dado por concluído. Falta a sua confirmação.');
    let passoObra = l.passos.find((s) => s.chave === 'obra');
    assert.deepEqual([passoObra.texto, passoObra.feito, passoObra.data], ['Visita e obra', false, `${l.obra.data}T${l.obra.hora}`]);

    // ---- "Não": volta ao eletricista; não há pagamento
    let r = await x.confirmar(c, id, { concluido: false, descricao: 'A tomada da cozinha continua sem corrente.' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.pedido.confirmacao.estado, r.json.pedido.pode_pagar_restante, r.json.pedido.restante.confirmada], ['contestada', false, undefined]);
    r = await x.pagar(c, id, 'restante');
    assert.deepEqual([r.estado, r.json.erro], [409, 'O restante paga-se quando a obra estiver concluída.']);
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'restante'").get(id).n, 0);
    assert.equal((await x.atribuicao(id, { acao: 'defeito' })).estado, 200);
    assert.equal((await x.area(e, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200);

    // ---- "Sim": o restante fica logo disponível, com o CEO ainda por aprovar
    r = await x.confirmar(c, id, { concluido: true, estrelas: 5 });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.pedido.confirmacao.estado, r.json.pedido.pode_pagar_restante, r.json.pedido.restante.confirmada, r.json.pedido.restante.obra_concluida, r.json.pedido.restante.valor],
      ['confirmada', true, true, false, restante]);
    assert.equal(r.json.pedido.estado_texto, 'Instalação concluída. A app fica ativa depois de pagar o restante.');
    passoObra = r.json.pedido.passos.find((s) => s.chave === 'obra');
    assert.equal(passoObra.feito, true, 'com o "Sim" do cliente a obra está feita');
    let ped = (await x.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.obra_concluida, ped.obra.estado], [null, 'agendada'], 'no painel a obra só fica concluída com a aprovação do CEO');
    assert.equal((await x.meuPagamento(e, tid)).pagamento, 'a_aguardar_aprovacao');
    const pg = await x.pagar(c, id, 'restante');
    assert.equal(pg.estado, 200, pg.texto);
    assert.equal(pg.json.pagamento.valor, restante);
    const pago = await x.simular(c, pg.json.pagamento.ref);
    assert.equal(pago.json.pagamento.estado, 'pago', 'o pagamento confirma');
    l = await x.pedidoConta(c, id);
    assert.deepEqual([l.restante.pago, l.obra_paga, l.pode_pagar_restante, l.estado_texto], [true, true, false, 'Instalação concluída.']);
    assert.equal((await x.pagar(c, id, 'restante')).estado, 409, 'não se paga duas vezes');

    // ---- cliente confirmou + restante pago, mas o CEO ainda não aprovou: o eletricista NÃO fica "a pagar"
    let m = await x.meuPagamento(e, tid);
    assert.deepEqual([m.pagamento, m.prazo, m.valor_fixado, m.pode_fatura], ['a_aguardar_aprovacao', null, false, false]);
    assert.equal((await x.area(e, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 409, 'fatura só depois de aprovado');
    assert.equal((await x.painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 409);
    ped = (await x.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ped.obra_concluida, ped.ligar_casa.pode], [null, true]);

    // ---- o CEO aprova depois: a obra fica concluída; o cliente não recebe o email "pode pagar o restante" (já pagou)
    p.emails.length = 0;
    const ap = await x.atribuicao(id, { acao: 'aprovar' });
    assert.equal(ap.estado, 200, ap.texto);
    ped = (await x.painel('GET', `orcamentos/${id}`)).json;
    assert.ok(ped.obra_concluida);
    assert.equal(ped.obra.estado, 'concluida');
    assert.ok(!p.emails.some((mail) => mail.para === c.email && /obra concluída/.test(mail.assunto)));
    m = await x.meuPagamento(e, tid);
    assert.deepEqual([m.pagamento, m.valor_fixado], ['fatura_em_falta', true]);
    assert.equal((await x.painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 409, 'sem fatura ainda não se paga');
    assert.equal((await x.area(e, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 201);
    m = await x.meuPagamento(e, tid);
    const t = x.linha(tid);
    const restanteEm = p.app.db.prepare("SELECT pago FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'restante' AND estado = 'pago'").get(id).pago;
    assert.deepEqual([m.pagamento, m.prazo], ['a_pagar', prazoPagamento([t.confirmada, t.aprovada, restanteEm])], 'as três condições: prazo = 7 dias depois da última (a aprovação)');
    assert.equal((await x.painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 200);
    l = await x.pedidoConta(c, id);
    assert.deepEqual([l.restante.pago, l.restante.obra_concluida, l.estado_texto], [true, true, 'Instalação concluída.']);
  });

  test('a aprovação pode vir antes do pagamento: "Sim" → o CEO aprova → o eletricista espera pelo restante → o cliente paga → "a pagar"', async () => {
    const { c, id, tid } = await x.obraFeita(e);
    assert.equal((await x.confirmar(c, id, { concluido: true, estrelas: 4 })).estado, 200);
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, true);
    assert.equal((await x.atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal((await x.area(e, 'POST', `trabalhos/${tid}/fatura`, doc())).estado, 201);
    assert.equal((await x.meuPagamento(e, tid)).pagamento, 'a_aguardar_restante', 'confirmado e aprovado, falta o restante');
    assert.equal((await x.painel('POST', `trabalhos-eletricista/${tid}/pago`, 'ceo', {})).estado, 409);
    const l = await x.pedidoConta(c, id);
    assert.deepEqual([l.pode_pagar_restante, l.restante.obra_concluida, l.restante.confirmada], [true, true, undefined]);
    const pg = await x.pagar(c, id, 'restante');
    assert.equal((await x.simular(c, pg.json.pagamento.ref)).json.pagamento.estado, 'pago');
    assert.equal((await x.meuPagamento(e, tid)).pagamento, 'a_pagar');
  });

  test('o CEO devolve o trabalho ao eletricista depois do "Sim": o restante por pagar deixa de estar disponível', async () => {
    const { c, id } = await x.obraFeita(e);
    assert.equal((await x.confirmar(c, id, { concluido: true, estrelas: 3 })).estado, 200);
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, true);
    assert.equal((await x.atribuicao(id, { acao: 'devolver', motivo: 'Falta fechar a tampa do quadro.' })).estado, 200);
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, false);
    assert.equal((await x.pagar(c, id, 'restante')).estado, 409);
  });

  test('obra sem eletricista externo: nada muda — o restante só depois de "Obra concluída" no painel', async () => {
    const { c, id } = await x.pedido();
    await x.aceitarEPagarSinal(c, id);
    let l = await x.pedidoConta(c, id);
    assert.deepEqual([l.pode_pagar_restante, l.confirmacao, l.restante.confirmada], [false, null, undefined]);
    assert.equal((await x.pagar(c, id, 'restante')).estado, 409);
    assert.equal((await x.painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {})).estado, 200);
    l = await x.pedidoConta(c, id);
    assert.deepEqual([l.pode_pagar_restante, l.restante.obra_concluida], [true, true]);
  });

  test('7 dias sem resposta do cliente: o trabalho fica aceite e o restante fica disponível, sem o CEO aprovar', async () => {
    const { c, id } = await x.obraFeita(e);
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, false);
    p.relogio.avancar(4 * DIA);   // (a sessão da conta dura 7 dias parada: lê-se a meio)
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, false);
    p.relogio.avancar(3 * DIA + HORA);
    const l = await x.pedidoConta(c, id);
    assert.deepEqual([l.confirmacao.estado, l.confirmacao.automatica, l.pode_pagar_restante, l.restante.confirmada], ['confirmada', true, true, true]);
    const pg = await x.pagar(c, id, 'restante');
    assert.equal(pg.estado, 200, pg.texto);
    assert.equal((await x.simular(c, pg.json.pagamento.ref)).json.pagamento.estado, 'pago');
    assert.equal((await x.painel('GET', `orcamentos/${id}`)).json.obra_concluida, null);
  });
});

describe('PROPOSTAS_BOLSA=0 com os pagamentos ligados: tudo como antes', () => {
  let p;
  const x = ajudas(() => p);
  let e;
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '0', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    e = await x.aprovado();
  });
  after(() => p.fechar());

  test('a visita continua a comprar-se e o pedido só vai para a bolsa com ela paga; o andamento tem "Visita técnica"', async () => {
    const { c, id } = await x.pedido();
    let l = await x.pedidoConta(c, id);
    assert.deepEqual([l.compras.visita.incluida, l.compras.visita.paga, l.compras.visita.valor], [undefined, false, VISITA_SINTRA]);
    assert.deepEqual(l.passos.map((s) => [s.chave, s.texto]), [['recebido', 'Pedido recebido'], ['visita', 'Visita técnica'], ['proposta', 'Proposta'], ['aceite', 'Proposta aceite'], ['obra', 'Instalação']]);
    assert.equal('visita_a_parte' in (await p.pedir('GET', '/api/catalogo')).json.pagamentos, false);
    let at = (await x.atribuicao(id)).json;
    assert.deepEqual([at.pode, at.tipo], [false, null]);
    assert.equal((await x.atribuicao(id, { acao: 'bolsa' })).estado, 409, 'sem a visita paga não vai para a bolsa');
    const pg = await x.pagar(c, id, 'visita');
    assert.equal(pg.estado, 200, pg.texto);
    assert.equal(pg.json.pagamento.valor, VISITA_SINTRA);
    assert.equal((await x.simular(c, pg.json.pagamento.ref)).json.pagamento.estado, 'pago');
    at = (await x.atribuicao(id)).json;
    assert.deepEqual([at.pode, at.tipo], [true, 'visita']);
    l = await x.pedidoConta(c, id);
    assert.deepEqual([l.compras.visita.paga, l.visita_cancelar.pode], [true, true]);
  });

  test('o "Sim" do cliente não abre o restante: só depois de o CEO aprovar', async () => {
    const { c, id, tid } = await x.obraFeita(e);
    assert.equal((await x.area(e, 'GET', `trabalhos/${tid}`)).json.trabalho.de_proposta, undefined);
    assert.equal('propostas_bolsa' in (await x.area(e, 'GET', 'trabalhos')).json, false);
    const r = await x.confirmar(c, id, { concluido: true, estrelas: 5 });
    assert.equal(r.estado, 200, r.texto);
    // O texto já não fica em "Instalação marcada." depois de o trabalho estar feito e confirmado (decisão do dono, 2026-10-11);
    // o passo da obra só fica feito quando o CEO aprovar (é aí que a obra fica concluída neste fluxo).
    assert.deepEqual([r.json.pedido.pode_pagar_restante, r.json.pedido.restante.confirmada, r.json.pedido.estado_texto], [false, undefined, 'Trabalho concluído.']);
    assert.equal(r.json.pedido.passos.find((s) => s.chave === 'obra').feito, false);
    const n = await x.pagar(c, id, 'restante');
    assert.deepEqual([n.estado, n.json.erro], [409, 'O restante paga-se quando a obra estiver concluída.']);
    assert.equal((await x.atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.equal((await x.pedidoConta(c, id)).pode_pagar_restante, true);
  });
});
