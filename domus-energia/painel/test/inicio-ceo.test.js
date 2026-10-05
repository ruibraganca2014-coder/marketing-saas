// Início simples do CEO (decisão do dono, 2026-10-05): GET resumo traz `tratar` (contagens do que está à espera dele)
// e `visitas_semana`; os outros papéis não recebem `tratar`.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';

describe('início do CEO: para tratar', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });

  test('contagens a zero numa base nova; um pedido novo e uma mensagem do cliente contam; só o CEO recebe', async () => {
    let r = (await painel('GET', 'resumo')).json;
    assert.deepEqual({ ...r.tratar, alertas_criticos: 0 }, { ...r.tratar, pedidos_novos: 0, propostas_aceites: 0, mensagens: 0, alertas_criticos: 0 });
    assert.deepEqual(r.visitas_semana, []);
    const novo = await painel('POST', 'orcamentos', 'ceo', { nome: 'Ana Início', telefone: '912 345 678', email: 'ana.inicio@exemplo.pt', localidade: 'Sintra', servico: 'Reparação' });
    assert.equal(novo.estado, 201, novo.texto);
    const agora = new Date(p.relogio.agora()).toISOString();
    p.app.db.prepare("INSERT INTO mensagens_pedido (orcamento_id, de, assunto, texto, criado) VALUES (?, 'equipa', 'Olá', 'Pergunta', ?)").run(novo.json.id, agora);
    assert.equal((await painel('GET', 'resumo')).json.tratar.mensagens, 0, 'a última mensagem é da equipa');
    p.app.db.prepare("INSERT INTO mensagens_pedido (orcamento_id, de, texto, criado) VALUES (?, 'cliente', 'Resposta', ?)").run(novo.json.id, agora);
    r = (await painel('GET', 'resumo')).json;
    assert.deepEqual([r.tratar.pedidos_novos, r.tratar.mensagens], [1, 1]);
    assert.equal((await painel('GET', 'resumo', 'comercial')).json.tratar, undefined);
    assert.equal((await painel('GET', 'resumo', 'tecnico')).json.tratar, undefined);
  });
});
