// Ficha do pedido (decisão do dono, 2026-10-14): o andamento e a caixa "Próximo passo" (src/proximo-passo.js). As
// regras são as do ecrã Hoje: para cada pedido e cada papel, o que a ficha diz por fazer é o que o Hoje lista.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { pendentesDoPedido, andamentoDoPedido, proximoPasso, linhasDoHoje } from '../src/proximo-passo.js';

const base = (x = {}) => ({
  estado: 'novo', criado: '2026-10-01T10:00:00.000Z', telefone: '912 345 678', mensagem_para: 'ana@exemplo.pt',
  validacao_ligada: true, validacao: 'por_validar', validacao_nota: null, validacao_em: null, proposta_aceite: null, cliente: null,
  valor_proposta: null, data_visita: null, agora_lx: '2026-10-14T12:00', mensagem_cliente: null, eletricistas: true, propostas_bolsa: true,
  n_propostas: 0, propostas_desde: null, trabalhos: [], trabalho_obra: null, extra_proposto: null, extra_enviado: null, ida_proposta: null,
  sem_tecnico: null, obra: null, obra_concluida: null, obra_parada: null, pagamentos: [], aguarda_sinal: false, ligar_pode: null, ...x,
});
const atual = (f) => andamentoDoPedido(f).find((x) => x.atual)?.chave ?? null;

describe('próximo passo (funções puras)', () => {
  test('pedido novo por validar: o CEO valida; o comercial contacta', () => {
    const f = base();
    const ceo = proximoPasso(f, 'ceo');
    assert.equal(ceo.tipo, 'validar');
    assert.equal(ceo.texto, 'Validar o pedido.');
    assert.deepEqual(ceo.acao, { rotulo: 'Validar', sec: 'validacao', alvo: 'validacao-ceo' });
    assert.deepEqual(ceo.outros, [], 'o "Contactar" não aparece ao CEO com o pedido por validar (como no Hoje)');
    const com = proximoPasso(f, 'comercial');
    assert.equal(com.tipo, 'pedido_novo');
    assert.equal(com.acao.ligacao, 'tel:912345678');
    assert.equal(atual(f), 'verificado');
  });

  test('pedido perdido ou arquivado: do eletricista só o pagamento do trabalho feito; casa por ligar não fica com tudo ✓', () => {
    const trabalhos = [{ estado: 'aprovada', aprovada: '2026-10-10T10:00:00.000Z', eletricista: 'Ana' }];
    for (const estado of ['perdido', 'arquivado']) {
      const f = base({ estado, trabalhos, extra_proposto: '2026-10-11T10:00:00.000Z', sem_tecnico: '2026-10-11T10:00:00.000Z', mensagem_cliente: '2026-10-12T10:00:00.000Z' });
      assert.deepEqual(pendentesDoPedido(f).map((x) => x.tipo), ['pagar_eletricista'], estado);
    }
    assert.deepEqual(pendentesDoPedido(base({ estado: 'perdido' })), []);
    const porLigar = base({ estado: 'aceite', validacao: 'validado', proposta_aceite: '2026-10-05T10:00:00.000Z', valor_proposta: 100,
      obra: { id: 'o1', estado: 'concluida' }, pagamentos: [{ fase: 'restante', estado: 'pago' }] });
    assert.equal(atual(porLigar), 'ligada');
    assert.equal(atual({ ...porLigar, cliente: 'joao' }), null);
  });

  test('o cliente corrigiu: "Rever e validar"; sem validação ligada, o CEO contacta', () => {
    assert.equal(proximoPasso(base({ validacao_nota: 'O cliente diz que já corrigiu: x' }), 'ceo').acao.rotulo, 'Rever e validar');
    const semFoto = proximoPasso(base({ validacao_em_falta: true }), 'ceo');
    assert.equal(semFoto.texto, 'Falta a foto do quadro elétrico: devolver o pedido ao cliente.');
    assert.deepEqual(semFoto.acao, { rotulo: 'Devolver ao cliente', sec: 'validacao', alvo: 'validacao-nota' });
    const f = base({ validacao_ligada: false });
    assert.equal(proximoPasso(f, 'ceo').tipo, 'pedido_novo');
    assert.equal(andamentoDoPedido(f).some((x) => x.chave === 'verificado'), false);
  });

  test('propostas na bolsa: escolher, depois enviar ao cliente; nada disto ao comercial', () => {
    const f = base({ validacao: 'validado', estado: 'contactado', n_propostas: 2, trabalhos: [{ tipo: 'visita', estado: 'na_bolsa' }] });
    const ceo = proximoPasso(f, 'ceo');
    assert.equal(ceo.tipo, 'escolher_proposta');
    assert.equal(ceo.texto, 'Escolher a proposta de um eletricista (2 recebidas).');
    const com = proximoPasso(f, 'comercial');
    assert.equal(com.tipo, null);
    assert.equal(com.texto, 'Nada a fazer agora.');
    assert.match(com.espera, /^À espera do CEO: escolher a proposta/);
    const g = base({ validacao: 'validado', estado: 'contactado', trabalhos: [{ tipo: 'visita', estado: 'aceite', proposta: '{}', atualizado: 'x' }] });
    assert.equal(proximoPasso(g, 'ceo').tipo, 'enviar_proposta');
    assert.equal(proximoPasso(g, 'ceo').acao.alvo, 'proposta-eletricista');
  });

  test('na bolsa sem propostas: nada a fazer, à espera dos eletricistas', () => {
    const p = proximoPasso(base({ validacao: 'validado', estado: 'contactado', trabalhos: [{ tipo: 'visita', estado: 'na_bolsa' }] }), 'ceo');
    assert.equal(p.tipo, null);
    assert.match(p.espera, /eletricistas/);
  });

  test('proposta enviada: à espera do cliente; aceite a aguardar sinal: o sinal', () => {
    const f = base({ validacao: 'validado', estado: 'proposta_enviada', valor_proposta: 1000 });
    assert.equal(proximoPasso(f, 'ceo').espera, 'À espera do cliente: aceitar a proposta.');
    assert.equal(atual(f), 'aceite');
    assert.equal(proximoPasso(base({ ...f, aguarda_sinal: true }), 'ceo').espera, 'À espera do cliente: pagar o sinal.');
  });

  test('proposta aceite sem casa ligada: converter, marcar a data ou abrir a obra', () => {
    const f = base({ validacao: 'validado', estado: 'aceite', valor_proposta: 1000, proposta_aceite: '2026-10-10T10:00:00Z' });
    assert.equal(proximoPasso(f, 'comercial').acao.alvo, 'form-converter');
    const porAgendar = proximoPasso(base({ ...f, obra: { id: 7, estado: 'agendada', por_agendar: true } }), 'ceo');
    assert.equal(porAgendar.texto, 'O cliente aceitou a proposta: marcar a data da obra.');
    assert.equal(porAgendar.acao.ligacao, '#/obras/7');
    assert.equal(atual(base({ ...f, obra: { id: 7, estado: 'agendada', por_agendar: true } })), 'obra');
  });

  test('obra: trabalho a mais e ida perdida antes de aprovar; aprovado: pagar ao eletricista', () => {
    const f = base({ validacao: 'validado', estado: 'aceite', cliente: 'ana', extra_proposto: 'x', ida_proposta: 'y', trabalhos: [{ tipo: 'obra', estado: 'confirmada' }] });
    const p = proximoPasso(f, 'ceo');
    assert.equal(p.tipo, 'ida_perdida');
    assert.deepEqual(p.outros.map((x) => x.tipo), ['extra', 'aprovar_trabalho']);
    const pagar = proximoPasso(base({ validacao: 'validado', estado: 'aceite', cliente: 'ana', obra_concluida: 'z', trabalhos: [{ tipo: 'obra', estado: 'aprovada', eletricista: 'Rui Elétrico' }] }), 'ceo');
    assert.equal(pagar.texto, 'Pagar a Rui Elétrico o trabalho deste pedido.');
    assert.equal(pagar.acao.ligacao, '#/pagamentos');
    // A casa por ligar à espera do restante fica depois do que se pode fazer já.
    const comCasa = proximoPasso(base({ validacao: 'validado', estado: 'aceite', proposta_aceite: 'x', obra_concluida: 'z', obra: { id: 3, estado: 'concluida' }, ligar_pode: false, trabalhos: [{ tipo: 'obra', estado: 'aprovada' }] }), 'ceo');
    assert.deepEqual([comCasa.tipo, ...comCasa.outros.map((x) => x.tipo)], ['pagar_eletricista', 'proposta_aceite']);
    assert.equal(comCasa.outros[0].texto, 'Obra concluída. Falta o cliente pagar o restante para ligar a casa.');
  });

  test('mensagem do cliente: os dois papéis respondem', () => {
    const f = base({ validacao: 'validado', estado: 'proposta_enviada', valor_proposta: 10, mensagem_cliente: 'x' });
    for (const papel of ['ceo', 'comercial']) assert.deepEqual(proximoPasso(f, papel).acao, { rotulo: 'Responder', sec: 'mensagens', alvo: 'mensagem-cliente' });
  });

  test('comercial: a visita já foi (enviar a proposta) ou é hoje mais logo', () => {
    assert.equal(proximoPasso(base({ validacao: 'validado', estado: 'visita_marcada', data_visita: '2026-10-13T10:00' }), 'comercial').tipo, 'enviar_proposta');
    const hoje = proximoPasso(base({ validacao: 'validado', estado: 'visita_marcada', data_visita: '2026-10-14T15:30' }), 'comercial');
    assert.equal(hoje.texto, 'Visita hoje às 15:30.');
    assert.equal(hoje.acao, null);
  });

  test('concluído e pago; perdido; arquivado', () => {
    const pago = base({ validacao: 'validado', estado: 'aceite', cliente: 'ana', valor_proposta: 10, obra_concluida: 'x', obra: { id: 1, estado: 'concluida' }, pagamentos: [{ fase: 'restante', estado: 'pago' }] });
    assert.ok(andamentoDoPedido(pago).every((x) => x.feito));
    assert.equal(proximoPasso(pago, 'ceo').espera, 'Pedido concluído.');
    const porPagar = { ...pago, pagamentos: [{ fase: 'restante', estado: 'pendente' }] };
    assert.equal(proximoPasso(porPagar, 'ceo').espera, 'À espera do cliente: pagar o restante.');
    assert.equal(atual(porPagar), 'pago');
    assert.equal(atual(base({ estado: 'perdido' })), null);
    assert.equal(proximoPasso(base({ estado: 'perdido' }), 'ceo').espera, 'Pedido perdido: não há mais nada a fazer.');
    assert.deepEqual(pendentesDoPedido(base({ estado: 'arquivado', mensagem_cliente: 'x' })), []);
  });

  test('teste de 2026-10-14: a linha do Hoje sai da mesma regra que a caixa da ficha', () => {
    const f = { nome: 'Ana', validacao: 'validado', estado: 'aceite', valor_proposta: 10, proposta_aceite: 'x' };
    const linha = (x, papel = 'ceo') => linhasDoHoje(base(x), papel, '#/orcamentos/1').map((y) => [y.tipo, y.texto, y.ligacao]);
    assert.deepEqual(linha({ ...f, obra: { id: 3, estado: 'concluida' }, ligar_pode: true }), [['proposta_aceite', 'Ligar a casa de Ana', '#/orcamentos/1']]);
    assert.deepEqual(linha({ ...f, obra: { id: 3, estado: 'agendada' }, ligar_pode: false }),
      [['proposta_aceite', 'Obra marcada em casa de Ana: falta o cliente pagar o restante para ligar a casa', '#/obras/3']]);
    assert.deepEqual(linha({ ...f, obra: { id: 3, estado: 'agendada', por_agendar: true } }), [['proposta_aceite', 'Marcar a data da obra de Ana', '#/obras/3']]);
    assert.deepEqual(linha({ nome: 'Rui', validacao_em_falta: true }), [['validar', 'Devolver ao cliente o pedido de Rui (falta a foto do quadro)', '#/orcamentos/1']]);
    assert.deepEqual(linha({ nome: 'Rui', validacao: 'validado' }, 'comercial'), [['pedido_novo', 'Contactar Rui', '#/orcamentos/1']]);
    // A caixa da ficha traz a mesma linha (o teste de baixo compara-a com o Hoje).
    const px = proximoPasso(base({ ...f, obra: { id: 3, estado: 'concluida' }, ligar_pode: true }), 'comercial');
    assert.deepEqual([px.texto, px.linha], ['Ligar a casa do cliente (app e mensalidade).', 'Ligar a casa de Ana']);
  });

  test('teste de 2026-10-14: pedido devolvido ao cliente ou já com os eletricistas: nada para a equipa', () => {
    const dev = base({ validacao: 'devolvido' });
    assert.deepEqual(pendentesDoPedido(dev), []);
    assert.equal(proximoPasso(dev, 'comercial').espera, 'À espera do cliente: corrigir o pedido (foi-lhe devolvido).');
    for (const tipo of ['visita', 'avaria']) {
      const bolsa = base({ validacao: 'validado', trabalhos: [{ tipo, estado: 'na_bolsa' }] });
      assert.deepEqual(pendentesDoPedido(bolsa), [], tipo);
      assert.match(proximoPasso(bolsa, 'ceo').espera, /^À espera dos eletricistas/, tipo);
    }
    assert.match(proximoPasso(base({ validacao: 'validado' }), 'comercial').texto, /"Em preparação"/, 'o nome do estado no painel');
  });

  test('teste de 2026-10-14: a obra com um eletricista — ele marca e faz, o cliente confirma, o CEO aprova, e só então ligar', () => {
    const f = { nome: 'Ana', validacao: 'validado', estado: 'aceite', valor_proposta: 1000, proposta_aceite: '2026-10-10T10:00:00Z', obra: { id: 4, estado: 'agendada', por_agendar: true }, ligar_pode: false };
    const passo = (trabalho_obra, extra = {}) => proximoPasso(base({ ...f, trabalho_obra, trabalhos: [{ tipo: 'obra', estado: trabalho_obra }], ...extra }), 'ceo');
    assert.deepEqual([passo('aceite').tipo, passo('aceite').espera], [null, 'À espera do eletricista: marcar a visita (tem 48 h).']);
    assert.deepEqual([passo('visita_marcada').tipo, passo('visita_marcada').espera], [null, 'À espera do eletricista: fazer a obra.']);
    const conc = passo('concluida_eletricista', { obra: { id: 4, estado: 'agendada' } });
    assert.equal(conc.tipo, null);
    assert.match(conc.espera, /^À espera do cliente: confirmar/);
    assert.deepEqual([passo('confirmada').tipo, ...passo('confirmada').outros.map((x) => x.tipo)], ['aprovar_trabalho']);
    // Aprovado: a obra fica concluída; falta pagar ao eletricista e, com o restante pago, ligar a casa.
    const aprovado = proximoPasso(base({ ...f, obra: { id: 4, estado: 'concluida' }, ligar_pode: true, trabalhos: [{ tipo: 'obra', estado: 'aprovada', eletricista: 'Elias' }] }), 'ceo');
    assert.deepEqual([aprovado.tipo, ...aprovado.outros.map((x) => x.tipo)], ['proposta_aceite', 'pagar_eletricista']);
    assert.equal(aprovado.linha, 'Ligar a casa de Ana');
    // Sem eletricista (obra com os técnicos do painel): como antes.
    assert.equal(proximoPasso(base({ ...f, eletricistas: false }), 'ceo').tipo, 'proposta_aceite');
  });
});

describe('ficha do pedido e ecrã Hoje dizem o mesmo', () => {
  let p;
  const ids = {};
  before(async () => {
    p = await painelComEquipa({ env: { VALIDACAO_CEO: '1', ELETRICISTAS: '1' } });
    const db = p.app.db;
    const criar = async (nome) => {
      const r = await p.pedir('POST', '/painel/api/orcamentos', { cookie: p.cookies.ceo, corpo: { nome, telefone: '912 345 678', email: `${nome.toLowerCase()}@exemplo.pt`, localidade: 'Sintra', servico: 'Reparação' } });
      assert.equal(r.estado, 201, r.texto);
      return r.json.id;
    };
    const agora = new Date(p.relogio.agora()).toISOString();
    const upd = (sql, ...v) => db.prepare(sql).run(...v);
    for (const n of ['Novo', 'Validado', 'Visita', 'Aceite', 'Confirmado', 'Aprovado', 'Enviada', 'Perdido', 'Devolvido', 'Ligar', 'Semfoto', 'Bolsa', 'Obrael']) ids[n] = await criar(n);
    upd("UPDATE orcamentos SET validacao = 'validado' WHERE id != ?", ids.Novo);
    upd("INSERT INTO mensagens_pedido (orcamento_id, de, texto, criado) VALUES (?, 'cliente', 'Olá', ?)", ids.Validado, agora);
    upd("UPDATE orcamentos SET estado = 'visita_marcada', data_visita = '2020-01-01T10:00' WHERE id = ?", ids.Visita);
    upd("UPDATE orcamentos SET estado = 'aceite', proposta_aceite = ? WHERE id = ?", agora, ids.Aceite);
    upd("UPDATE orcamentos SET estado = 'proposta_enviada', valor_proposta_cent = 100000 WHERE id = ?", ids.Enviada);
    upd("INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, estado, consentimento, criado, atualizado) VALUES ('e@exemplo.pt', 'Elias', '910000000', '123456789', 'TR-1', 'aprovado', ?, ?, ?)", agora, agora, agora);
    const trab = db.prepare("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, criado, atualizado) VALUES (?, 'obra', ?, 'bolsa', 'Sintra', 1, 70, ?, ?)");
    trab.run(ids.Confirmado, 'confirmada', agora, agora);
    trab.run(ids.Aprovado, 'aprovada', agora, agora);
    upd("UPDATE orcamentos SET estado = 'aceite', cliente = 'cli' WHERE id IN (?, ?)", ids.Confirmado, ids.Aprovado);
    // Teste de 2026-10-14: perdido com uma mensagem do cliente por responder; devolvido ao cliente; obra concluída e paga
    // (ligar a casa); sem a foto do quadro; na bolsa depois de validado; e a obra com um eletricista.
    upd("UPDATE orcamentos SET estado = 'perdido' WHERE id = ?", ids.Perdido);
    upd("INSERT INTO mensagens_pedido (orcamento_id, de, texto, criado) VALUES (?, 'cliente', 'Afinal?', ?)", ids.Perdido, agora);
    upd("UPDATE orcamentos SET validacao = 'devolvido', validacao_nota = 'Falta a planta' WHERE id = ?", ids.Devolvido);
    const obra = (estado, porAgendar) => Number(db.prepare("INSERT INTO obras (cliente, data, estado, por_agendar, criado, atualizado) VALUES ('', '2026-10-20', ?, ?, ?, ?)").run(estado, porAgendar, agora, agora).lastInsertRowid);
    upd("UPDATE orcamentos SET estado = 'aceite', proposta_aceite = ?, obra_id = ?, obra_concluida = ? WHERE id = ?", agora, obra('concluida', 0), agora, ids.Ligar);
    upd(`UPDATE orcamentos SET validacao = NULL, simulacao = '{"itens":[]}' WHERE id = ?`, ids.Semfoto);
    upd("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, percentagem, criado, atualizado) VALUES (?, 'visita', 'na_bolsa', 'bolsa', 'Sintra', 70, ?, ?)", ids.Bolsa, agora, agora);
    upd("UPDATE orcamentos SET estado = 'aceite', proposta_aceite = ?, obra_id = ? WHERE id = ?", agora, obra('agendada', 1), ids.Obrael);
    upd("INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, tecnico_id, percentagem, criado, atualizado) VALUES (?, 'obra', 'aceite', 'bolsa', 'Sintra', 1, 1, 70, ?, ?)", ids.Obrael, agora, agora);
  });
  after(() => p?.fechar());

  test('para cada pedido e papel, o que a ficha diz por fazer (tipo e texto) é o que o Hoje lista', async () => {
    for (const papel of ['ceo', 'comercial']) {
      const hoje = (await p.pedir('GET', '/painel/api/hoje', { cookie: p.cookies[papel] })).json.itens;
      for (const [nome, id] of Object.entries(ids)) {
        const r = await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies[papel] });
        assert.equal(r.estado, 200, r.texto);
        const px = r.json.proximo;
        const ficha = [px.tipo, ...px.outros.map((x) => x.tipo)].filter(Boolean).sort();
        const doHoje = [...new Set(hoje.filter((x) => x.pedido === id).map((x) => x.tipo))].sort();
        assert.deepEqual(ficha, doHoje, `${nome} (${papel})`);
        // Teste de 2026-10-14: o texto também (o Hoje dizia "Marcar a obra…" quando a ficha já dizia "Ligar a casa").
        const linhasFicha = [px.linha, ...px.outros.map((x) => x.linha)].filter(Boolean).sort();
        assert.deepEqual(linhasFicha, hoje.filter((x) => x.pedido === id).map((x) => x.texto).sort(), `${nome} (${papel}): texto`);
        assert.ok(Array.isArray(r.json.andamento) && r.json.andamento[0].chave === 'recebido');
      }
    }
  });

  test('o que cada pedido mostra ao CEO', async () => {
    const px = async (n) => (await p.pedir('GET', `/painel/api/orcamentos/${ids[n]}`, { cookie: p.cookies.ceo })).json.proximo;
    assert.equal((await px('Novo')).tipo, 'validar');
    assert.equal((await px('Validado')).tipo, 'pedido_novo');
    assert.equal((await px('Aceite')).tipo, 'proposta_aceite');
    // O eletricista sem n.º da DGEG válido: primeiro o técnico responsável, depois aprovar.
    const conf = await px('Confirmado');
    assert.deepEqual([conf.tipo, ...conf.outros.map((x) => x.tipo)], ['sem_tecnico', 'aprovar_trabalho']);
    assert.equal((await px('Aprovado')).tipo, 'pagar_eletricista');
    assert.equal((await px('Enviada')).espera, 'À espera do cliente: aceitar a proposta.');
    // Teste de 2026-10-14.
    assert.deepEqual([(await px('Perdido')).tipo, (await px('Perdido')).espera], [null, 'Pedido perdido: não há mais nada a fazer.']);
    assert.deepEqual([(await px('Devolvido')).tipo, (await px('Devolvido')).espera], [null, 'À espera do cliente: corrigir o pedido (foi-lhe devolvido).']);
    assert.deepEqual([(await px('Ligar')).tipo, (await px('Ligar')).linha], ['proposta_aceite', 'Ligar a casa de Ligar']);
    assert.equal((await px('Semfoto')).linha, 'Devolver ao cliente o pedido de Semfoto (falta a foto do quadro)');
    assert.match((await px('Bolsa')).espera, /^À espera dos eletricistas/);
    assert.deepEqual([(await px('Obrael')).tipo, (await px('Obrael')).espera], [null, 'À espera do eletricista: marcar a visita (tem 48 h).']);
    const hoje = (await p.pedir('GET', '/painel/api/hoje', { cookie: p.cookies.ceo })).json.itens;
    for (const n of ['Perdido', 'Devolvido', 'Bolsa', 'Obrael']) assert.deepEqual(hoje.filter((x) => x.pedido === ids[n]), [], n);
    assert.equal(hoje.find((x) => x.pedido === ids.Ligar).texto, 'Ligar a casa de Ligar');
  });

  test('teste de 2026-10-14: a ficha só traz o "Próximo passo" de quem a abre', async () => {
    const r = async (papel) => (await p.pedir('GET', `/painel/api/orcamentos/${ids.Novo}`, { cookie: p.cookies[papel] })).json.proximo;
    assert.equal((await r('ceo')).tipo, 'validar');
    const com = await r('comercial');
    assert.equal(com.tipo, 'pedido_novo');
    assert.equal('ceo' in com || 'comercial' in com, false, 'sem os passos dos outros papéis');
    assert.equal((await r('tecnico')) ?? null, null);
  });
});
