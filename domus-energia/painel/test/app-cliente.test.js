// App do cliente (área de cliente instalável, docs/APP-CLIENTE.md) — a lógica sem DOM de web/estado.js e web/cenas.js:
// a potência "agora" só conta medidores com ligação, no resumo e no relatório da casa; uma cena pedida só fica
// "executada" com o evento do servidor (sem ele acaba em erro por tempo esgotado); e a ligação direta para a app ntfy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../web/estado.js';
import { criarEsperaCena } from '../../web/cenas.js';

const AGORA = Date.parse('2026-10-12T12:00:00Z');
const tomada = (id, mais = {}) => ({ id, nome: id, tipo: 'openbeken', medidor: true, canais: [{ n: 1, funcao: 'interruptor', nome: id, divisao: 'Sala' }], ...mais });

/** Os modelos como a área de cliente os faz: a lista `_aparelhos` e as mensagens de cada aparelho (ligação e potência). */
function casa(lista, mensagens) {
  const aparelhos = E.lerAparelhos(JSON.stringify(lista));
  const estados = {};
  for (const [id, resto, texto] of mensagens) E.aplicarMensagem(estados, id, aparelhos.find((a) => a.id === id), resto, texto, { agora: AGORA });
  return { aparelhos, modelos: aparelhos.map((a) => E.modelo(a, estados[a.id], AGORA)) };
}
const relatorio = (c) => E.construirRelatorio({ ...c, agora: AGORA });

test('potência agora: um medidor sem ligação não conta, no resumo nem no relatório da casa', () => {
  const c = casa([tomada('tv'), tomada('termo')], [
    ['tv', 'connected', 'online'], ['tv', 'power/get', '95'],
    ['termo', 'connected', 'online'], ['termo', 'power/get', '2000'],
  ]);
  assert.equal(c.aparelhos.length, 2, 'a lista foi lida');
  assert.equal(E.resumo(c.modelos, null).potenciaW, 2095);
  assert.equal(relatorio(c).consumo.agoraW, 2095);

  // O termoacumulador perde a ligação: a última potência que disse (2000 W) já não é a de agora.
  const d = casa([tomada('tv'), tomada('termo')], [
    ['tv', 'connected', 'online'], ['tv', 'power/get', '95'],
    ['termo', 'power/get', '2000'], ['termo', 'connected', 'offline'],
  ]);
  assert.equal(d.modelos.find((m) => m.id === 'termo').potenciaW, 2000, 'o modelo guarda a última leitura');
  const r = E.resumo(d.modelos, null);
  assert.deepEqual([r.potenciaW, r.comPotencia], [95, 1]);
  assert.equal(relatorio(d).consumo.agoraW, 95, 'o relatório diz o mesmo que o resumo');
});

test('potência agora: com todos os medidores sem ligação não há valor (—), em vez de uma soma velha', () => {
  const c = casa([tomada('tv'), tomada('termo')], [
    ['tv', 'power/get', '95'], ['tv', 'connected', 'offline'],
    ['termo', 'power/get', '2000'], ['termo', 'connected', 'offline'],
  ]);
  assert.equal(E.resumo(c.modelos, null).comPotencia, 0);
  const r = relatorio(c);
  assert.equal(r.consumo.agoraW, null);
  assert.match(E.relatorioTexto(r), /Consumo: agora — /);
});

test('potência agora: com contador geral conta só ele, e sem ligação não se soma o resto no lugar dele', () => {
  const lista = [tomada('quadro', { geral: true }), tomada('tv')];
  const ligado = casa(lista, [['quadro', 'connected', 'online'], ['quadro', 'power/get', '480'], ['tv', 'connected', 'online'], ['tv', 'power/get', '95']]);
  assert.equal(E.resumo(ligado.modelos, null).potenciaW, 480);
  assert.equal(relatorio(ligado).consumo.agoraW, 480);
  const semGeral = casa(lista, [['quadro', 'power/get', '480'], ['quadro', 'connected', 'offline'], ['tv', 'connected', 'online'], ['tv', 'power/get', '95']]);
  assert.equal(E.resumo(semGeral.modelos, null).comPotencia, 0);
  assert.equal(relatorio(semGeral).consumo.agoraW, null);
});

// ------------------------------------------------------------ cenas: confirmação do servidor
/** Uma espera com o relógio do teste; devolve o que foi dito ao cliente. */
function espera(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dito = [];
  return { e: criarEsperaCena((texto, tipo) => dito.push([tipo, texto])), dito };
}

test('cena sem confirmação do servidor: acaba em erro por tempo esgotado, nunca em "executada"', (t) => {
  const { e, dito } = espera(t);
  e.pedir('Boa noite');
  t.mock.timers.tick(9_999);
  assert.deepEqual(dito, [], 'antes do prazo ainda não se diz nada');
  t.mock.timers.tick(1);
  assert.equal(dito.length, 1);
  assert.equal(dito[0][0], 'erro');
  assert.match(dito[0][1], /não confirmou a cena "Boa noite"/);
  // Uma confirmação que chegue depois do prazo já não muda o que foi dito.
  e.evento({ titulo: 'Cena: Boa noite' });
  assert.equal(dito.length, 1);
});

test('cena confirmada: só o evento "Cena: <nome>" dessa cena a dá por executada, e o prazo deixa de contar', (t) => {
  const { e, dito } = espera(t);
  e.pedir('Boa noite');
  e.evento({ titulo: 'Cena: Sair de casa' });
  e.evento({ titulo: 'Porta aberta' });
  assert.deepEqual(dito, [], 'eventos de outras coisas não confirmam');
  e.evento({ titulo: 'Cena: Boa noite' });
  assert.deepEqual(dito, [['ok', 'Cena "Boa noite" executada.']]);
  t.mock.timers.tick(60_000);
  assert.equal(dito.length, 1, 'sem erro de tempo esgotado depois da confirmação');
});

test('cena recusada pelo servidor: mostra o motivo e não espera pelo prazo; sem cena pedida o erro não é dela', (t) => {
  const { e, dito } = espera(t);
  assert.equal(e.erro({ titulo: 'Cena não executada', mensagem: 'x' }), false);
  e.pedir('Boa noite');
  assert.equal(e.erro({ titulo: 'Cenas não guardadas', mensagem: 'x' }), false, 'erro de outra coisa');
  assert.equal(e.erro({ titulo: 'Cena não executada', mensagem: 'A cena já não existe.' }), true);
  assert.deepEqual(dito, [['erro', 'A cena já não existe.']]);
  t.mock.timers.tick(60_000);
  assert.equal(dito.length, 1);
});

test('cena: sair da casa (limpar) cancela a espera', (t) => {
  const { e, dito } = espera(t);
  e.pedir('Boa noite');
  e.limpar();
  t.mock.timers.tick(60_000);
  assert.deepEqual(dito, []);
});

// ------------------------------------------------------------ ligação direta para a app ntfy
test('ligação para a app ntfy: ntfy://servidor/tópico (https), ?secure=false em http, e nada quando o endereço não é só isso', () => {
  assert.equal(E.ligacaoNtfy('https://ntfy.exemplo.pt/domus-joao-9f3k2'), 'ntfy://ntfy.exemplo.pt/domus-joao-9f3k2');
  assert.equal(E.ligacaoNtfy('https://ntfy.exemplo.pt:8443/domus_joao'), 'ntfy://ntfy.exemplo.pt:8443/domus_joao');
  assert.equal(E.ligacaoNtfy('http://192.168.1.10/domus-joao'), 'ntfy://192.168.1.10/domus-joao?secure=false');
  for (const mau of ['https://exemplo.pt/ntfy/domus-joao', 'https://ntfy.exemplo.pt/', 'https://ntfy.exemplo.pt/a?b=1', 'https://u:p@ntfy.exemplo.pt/a',
    'https://ntfy.exemplo.pt/a%20b', 'ftp://ntfy.exemplo.pt/a', 'nada', '', null]) {
    assert.equal(E.ligacaoNtfy(mau), null, String(mau));
  }
  // O que a área de cliente recebe em `_ntfy` (lerNtfy) dá a ligação.
  const lido = E.lerNtfy(JSON.stringify({ url: 'https://ntfy.exemplo.pt/domus-joao-9f3k2', servidor: 'https://ntfy.exemplo.pt', topico: 'domus-joao-9f3k2' }));
  assert.equal(E.ligacaoNtfy(lido.url), 'ntfy://ntfy.exemplo.pt/domus-joao-9f3k2');
});
