// Ficha do pedido (decisão do dono, 2026-10-14): o andamento e a caixa "Próximo passo" (src/proximo-passo.js). As
// regras são as do ecrã Hoje: para cada pedido e cada papel, o que a ficha diz por fazer é o que o Hoje lista.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { pendentesDoPedido, andamentoDoPedido, proximoPasso } from '../src/proximo-passo.js';

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
    for (const n of ['Novo', 'Validado', 'Visita', 'Aceite', 'Confirmado', 'Aprovado', 'Enviada']) ids[n] = await criar(n);
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
  });
  after(() => p?.fechar());

  test('para cada pedido e papel, os tipos por fazer da ficha são os do Hoje', async () => {
    for (const papel of ['ceo', 'comercial']) {
      const hoje = (await p.pedir('GET', '/painel/api/hoje', { cookie: p.cookies[papel] })).json.itens;
      for (const [nome, id] of Object.entries(ids)) {
        const r = await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies[papel] });
        assert.equal(r.estado, 200, r.texto);
        const px = r.json.proximo[papel];
        const ficha = [px.tipo, ...px.outros.map((x) => x.tipo)].filter(Boolean).sort();
        const doHoje = [...new Set(hoje.filter((x) => x.pedido === id).map((x) => x.tipo))].sort();
        assert.deepEqual(ficha, doHoje, `${nome} (${papel})`);
        assert.ok(Array.isArray(r.json.andamento) && r.json.andamento[0].chave === 'recebido');
      }
    }
  });

  test('o que cada pedido mostra ao CEO', async () => {
    const px = async (n) => (await p.pedir('GET', `/painel/api/orcamentos/${ids[n]}`, { cookie: p.cookies.ceo })).json.proximo.ceo;
    assert.equal((await px('Novo')).tipo, 'validar');
    assert.equal((await px('Validado')).tipo, 'pedido_novo');
    assert.equal((await px('Aceite')).tipo, 'proposta_aceite');
    // O eletricista sem n.º da DGEG válido: primeiro o técnico responsável, depois aprovar.
    const conf = await px('Confirmado');
    assert.deepEqual([conf.tipo, ...conf.outros.map((x) => x.tipo)], ['sem_tecnico', 'aprovar_trabalho']);
    assert.equal((await px('Aprovado')).tipo, 'pagar_eletricista');
    assert.equal((await px('Enviada')).espera, 'À espera do cliente: aceitar a proposta.');
  });
});
