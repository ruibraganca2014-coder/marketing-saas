// Ecrã "Hoje" (decisão do dono, 2026-10-14): GET hoje devolve, a cada papel, só as suas coisas por fazer — uma linha por
// coisa, com a ligação para onde se trata — a mais antiga primeiro. O comercial e o técnico nunca recebem o que é só do CEO.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { diaLisboa, somarDiasCivil } from '../src/util.js';

const SO_CEO = ['validar', 'ativacao', 'email_falhado', 'copia', 'escolher_proposta', 'aprovar_trabalho', 'pagar_eletricista', 'extra', 'ida_perdida', 'sem_tecnico', 'candidatura', 'proposta_precos'];

describe('ecrã Hoje', () => {
  let p, tec2, ana, bruno;
  before(async () => {
    p = await painelComEquipa({ env: { VALIDACAO_CEO: '1' } });
    tec2 = await p.criarUtilizador('tecnico', 'tecnico2@domus.teste');
    const criar = async (nome, localidade) => {
      const r = await p.pedir('POST', '/painel/api/orcamentos', { cookie: p.cookies.ceo, corpo: { nome, telefone: '912 345 678', email: `${nome.split(' ')[0].toLowerCase()}@exemplo.pt`, localidade, servico: 'Reparação' } });
      assert.equal(r.estado, 201, r.texto);
      return r.json.id;
    };
    // O Bruno chega primeiro mas fica com a data de hoje; a Ana é de há 3 dias: tem de aparecer antes.
    bruno = await criar('Bruno Costa', 'Cascais');
    ana = await criar('Ana Fernandes', 'Sintra');
    const agora = p.relogio.agora();
    p.app.db.prepare('UPDATE orcamentos SET criado = ? WHERE id = ?').run(new Date(agora - 3 * 86400_000).toISOString(), ana);
    p.app.db.prepare("INSERT INTO mensagens_pedido (orcamento_id, de, texto, criado) VALUES (?, 'cliente', 'Olá', ?)").run(bruno, new Date(agora - 3600_000).toISOString());
    p.app.db.prepare("INSERT INTO emails_falhados (quando, para, assunto, erro, tentativas) VALUES (?, 'x@exemplo.pt', 'Domus Energia: a sua proposta', 'caixa cheia', 3)").run(new Date(agora).toISOString());
    // Obras: uma hoje do técnico, uma hoje do outro técnico, uma amanhã do técnico.
    const hoje = diaLisboa(new Date(agora));
    const obra = (data, hora, tecnico) => {
      const t = new Date(agora).toISOString();
      const id = Number(p.app.db.prepare("INSERT INTO obras (cliente, data, hora, estado, criado, atualizado) VALUES ('joao', ?, ?, 'agendada', ?, ?)").run(data, hora, t, t).lastInsertRowid);
      p.app.db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(id, tecnico);
      return id;
    };
    obra(hoje, '09:30', p.u.tecnico.id);
    obra(hoje, '10:00', tec2.id);
    obra(somarDiasCivil(hoje, 1), '09:00', p.u.tecnico.id);
  });
  after(() => p.fechar());
  const hoje = async (papel) => {
    const r = await p.pedir('GET', '/painel/api/hoje', { cookie: p.cookies[papel] });
    assert.equal(r.estado, 200, r.texto);
    return r.json.itens;
  };

  test('CEO: pedidos por validar (o mais antigo primeiro), a mensagem do cliente e o email que falhou', async () => {
    const itens = await hoje('ceo');
    const validar = itens.filter((x) => x.tipo === 'validar');
    assert.deepEqual(validar.map((x) => x.pedido), [ana, bruno]);
    assert.equal(validar[0].texto, 'Validar o pedido de Ana Fernandes');
    assert.equal(validar[0].localidade, 'Sintra');
    assert.equal(validar[0].ligacao, `#/orcamentos/${ana}`);
    assert.ok(itens.some((x) => x.tipo === 'mensagem' && x.pedido === bruno && x.texto === 'Responder à mensagem de Bruno Costa'));
    assert.ok(itens.some((x) => x.tipo === 'email_falhado' && x.ligacao === null));
    // Validar já inclui os pedidos novos: não aparecem duas vezes.
    assert.equal(itens.filter((x) => x.tipo === 'pedido_novo').length, 0);
    const tempos = itens.map((x) => (x.desde ? Date.parse(x.desde) : 0));
    assert.deepEqual(tempos, [...tempos].sort((a, b) => a - b), 'a mais antiga primeiro');
    assert.equal(itens.some((x) => x.tipo === 'obra'), false);
  });

  test('comercial: os pedidos novos e a mensagem, nada do que é só do CEO', async () => {
    const itens = await hoje('comercial');
    assert.deepEqual(itens.filter((x) => x.tipo === 'pedido_novo').map((x) => x.pedido), [ana, bruno]);
    assert.equal(itens.find((x) => x.pedido === ana).texto, 'Contactar Ana Fernandes');
    assert.ok(itens.some((x) => x.tipo === 'mensagem'));
    assert.deepEqual(itens.filter((x) => SO_CEO.includes(x.tipo)), []);
  });

  test('técnico: só as suas obras de hoje; nenhum pedido', async () => {
    const itens = await hoje('tecnico');
    const obras = itens.filter((x) => x.tipo === 'obra');
    assert.equal(obras.length, 1);
    assert.equal(obras[0].hora, '09:30');
    assert.match(obras[0].ligacao, /^#\/obras\/\d+$/);
    assert.deepEqual(itens.filter((x) => x.tipo !== 'obra' && x.tipo !== 'alerta'), []);
    const outro = await p.entrar('tecnico2@domus.teste');
    const r = (await p.pedir('GET', '/painel/api/hoje', { cookie: outro })).json.itens;
    assert.deepEqual(r.filter((x) => x.tipo === 'obra').map((x) => x.hora), ['10:00']);
  });

  test('validado e ainda novo: o CEO vê "Contactar"; sem sessão: 401', async () => {
    p.app.db.prepare("UPDATE orcamentos SET validacao = 'validado' WHERE id = ?").run(ana);
    const itens = await hoje('ceo');
    assert.equal(itens.some((x) => x.tipo === 'validar' && x.pedido === ana), false);
    assert.ok(itens.some((x) => x.tipo === 'pedido_novo' && x.pedido === ana));
    assert.equal((await p.pedir('GET', '/painel/api/hoje')).estado, 401);
  });
});
