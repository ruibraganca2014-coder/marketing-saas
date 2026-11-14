// App do cliente (área de cliente instalável, docs/APP-CLIENTE.md) — a lógica sem DOM de web/estado.js e web/cenas.js:
// a potência "agora" só conta medidores com ligação, no resumo e no relatório da casa; uma cena pedida só fica
// "executada" com o evento do servidor (sem ele acaba em erro por tempo esgotado); e a ligação direta para a app ntfy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../web/estado.js';
import { criarEsperaCena, cenasDoTopo } from '../../web/cenas.js';

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

test('planta como ecrã inicial: cada divisão da planta com os seus aparelhos (nome sem acentos nem maiúsculas), luzes acesas, ligados e sem ligação; os de fora da planta à parte', () => {
  const planta = { divisoes: [{ id: 'd1', nome: 'Sala' }, { id: 'd2', nome: 'Cozinha' }, { id: 'd3', nome: 'Escritório' }] };
  const luz = (id, divisao) => ({ id, nome: `Luz ${id}`, tipo: 'openbeken', divisao, canais: [{ n: 1, funcao: 'interruptor', nome: 'Luz', carga: 'luz' }] });
  const c = casa([luz('teto', 'sala'), luz('candeeiro', 'Sala'), tomada('tv', { divisao: 'SALA' }), luz('bancada', 'Cozinha'), tomada('garagem', { divisao: 'Garagem' }), tomada('solta', { canais: [{ n: 1, funcao: 'interruptor', nome: 'solta' }] })], [
    ['teto', 'connected', 'online'], ['teto', '1/get', '1'],
    ['candeeiro', 'connected', 'online'], ['candeeiro', '1/get', '0'],
    ['tv', 'connected', 'online'], ['tv', '1/get', '1'],
    ['bancada', 'connected', 'offline'], ['bancada', '1/get', '1'],
  ]);
  const r = E.divisoesDaPlanta(planta, c.aparelhos, c.modelos);
  const [sala, cozinha, escritorio] = r.divisoes;
  assert.deepEqual({ ...sala }, { id: 'd1', nome: 'Sala', aparelhos: 3, ligados: 2, luzes: 1, semLigacao: 0 });
  assert.deepEqual([cozinha.aparelhos, cozinha.ligados, cozinha.semLigacao], [1, 0, 1], 'sem ligação não conta como acesa');
  assert.equal(escritorio.aparelhos, 0);
  assert.deepEqual(r.fora, ['Garagem', E.SEM_DIVISAO]);
  assert.equal(E.textoDivisaoPlanta(sala), '1 luz acesa · 1 ligado · 3 aparelhos');
  assert.equal(E.textoDivisaoPlanta(cozinha), '1 sem ligação · 1 aparelho');
  assert.equal(E.textoDivisaoPlanta(escritorio), 'Sem aparelhos');
  assert.deepEqual(E.divisoesDaPlanta(null, c.aparelhos, c.modelos).divisoes, [], 'sem planta');
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

test('"Apagar tudo": conta as luzes reguláveis e os interruptores com nome de luz; nunca o geral, tomadas nem cargas perigosas', () => {
  const ap = E.lerAparelhos(JSON.stringify([
    { id: 'quadro', nome: 'Quadro geral', medidor: true, geral: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Luz geral' }] },
    { id: 'sala', nome: 'Sala', canais: [{ n: 1, funcao: 'interruptor', nome: 'Teto' }, { n: 2, funcao: 'interruptor', nome: 'Candeeiro' }] },
    { id: 'tv', nome: 'Tomada da televisão', canais: [{ n: 1, funcao: 'interruptor' }] },
    { id: 'led', nome: 'LED cozinha', canais: [{ n: 1, funcao: 'luz' }] },
    { id: 'wc', nome: 'Iluminação WC', canais: [{ n: 1, funcao: 'interruptor' }] },
    { id: 'termo', nome: 'Termoacumulador da luz', canais: [{ n: 1, funcao: 'interruptor', carga: 'perigosa', nome: 'Termo' }] },
    { id: 'estore', nome: 'Estore da sala', canais: [{ n: 1, funcao: 'estore', nome: 'Luz do dia' }] },
  ]));
  const luzes = ap.flatMap((a) => a.canais.filter((c) => E.ehLuz(ap, a.id, c.n)).map((c) => `${a.id}:${c.n}`));
  assert.deepEqual(luzes, ['sala:1', 'sala:2', 'led:1', 'wc:1']);
  // Com algum canal marcado pelo técnico (carga "luz"), contam só os marcados e as reguláveis; o nome deixa de contar.
  const m = E.lerAparelhos(JSON.stringify([
    { id: 'sala', nome: 'Sala', canais: [{ n: 1, funcao: 'interruptor', nome: 'Teto', carga: 'luz' }, { n: 2, funcao: 'interruptor', nome: 'Candeeiro' }] },
    { id: 'tv', nome: 'Tomada', canais: [{ n: 1, funcao: 'interruptor', nome: 'Televisão', carga: 'luz' }] },
    { id: 'led', nome: 'LED cozinha', canais: [{ n: 1, funcao: 'luz' }] },
    { id: 'estore', nome: 'Estore', canais: [{ n: 1, funcao: 'estore', carga: 'luz' }] },
  ]));
  assert.deepEqual(m.flatMap((a) => a.canais.filter((c) => E.ehLuz(m, a.id, c.n)).map((c) => `${a.id}:${c.n}`)), ['sala:1', 'tv:1', 'led:1']);
});

test('cenas no topo: só as favoritas; sem nenhuma favorita, todas (casas antigas)', () => {
  const a = { id: 'a' }, b = { id: 'b', favorita: true }, c = { id: 'c' };
  assert.deepEqual(cenasDoTopo([a, b, c]), [b]);
  assert.deepEqual(cenasDoTopo([a, c]), [a, c]);
  assert.deepEqual(cenasDoTopo(null), []);
});

// ------------------------------------------------------------ avisos da própria app (web push, 2026-10-14)
test('avisos da app: _webpush lido com validação; chave VAPID em bytes', () => {
  const chave = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  assert.deepEqual(E.lerWebPush(JSON.stringify({ chave, total: 2 })), { chave, total: 2 });
  assert.deepEqual(E.lerWebPush(JSON.stringify({ chave: null, total: 0 })), { chave: null, total: 0 });
  assert.deepEqual(E.lerWebPush(JSON.stringify({ chave: '<script>', total: -1 })), { chave: null, total: 0 });
  assert.equal(E.lerWebPush('lixo'), null);
  const bytes = E.chaveParaBytes(chave);
  assert.equal(bytes.length, 65); // chave pública P-256 não comprimida
  assert.equal(bytes[0], 4);
});

test('avisos da app: o que o cartão mostra (Android, computador, iPhone com e sem a app instalada)', () => {
  const base = { sistema: 'android', instalada: false, suportado: true, permissao: 'default', ativo: false, chave: 'x'.repeat(87) };
  assert.equal(E.estadoAvisos(base).estado, 'pode');
  assert.match(E.estadoAvisos(base).texto, /telemóvel/);
  assert.match(E.estadoAvisos({ ...base, sistema: 'computador' }).texto, /computador/);
  assert.equal(E.estadoAvisos({ ...base, ativo: true, permissao: 'granted' }).estado, 'ativo');
  assert.equal(E.estadoAvisos({ ...base, permissao: 'denied' }).estado, 'negado');
  assert.equal(E.estadoAvisos({ ...base, chave: null }).estado, 'indisponivel');
  assert.equal(E.estadoAvisos({ ...base, suportado: false }).estado, 'sem-suporte');
  const iphone = E.estadoAvisos({ ...base, sistema: 'iphone', suportado: false });
  assert.equal(iphone.estado, 'iphone-instalar');
  assert.match(iphone.texto, /ecrã principal/);
  assert.match(iphone.texto, /16\.4/);
  assert.equal(E.estadoAvisos({ ...base, sistema: 'iphone', suportado: false, instalada: true }).estado, 'iphone-antigo');
  assert.equal(E.estadoAvisos({ ...base, sistema: 'iphone', instalada: true }).estado, 'pode');
});

test('service worker só para os avisos: sem "fetch" e sem cache (decisão de 2026-10-09 mantida)', async () => {
  const { readFile } = await import('node:fs/promises');
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  const codigo = sw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(codigo, /addEventListener\("push"/);
  assert.match(codigo, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(codigo, /addEventListener\(["']fetch["']|onfetch|caches\.|importScripts/);
});

// Organizar os aparelhos (decisões do dono, 2026-11-10): nome por mosaico, divisão por aparelho, esconder; o nome do
// painel fica em nomeTecnico e o que é igual ao do painel não se guarda.
test('organizar: aplicar e mudar o que o cliente personaliza', () => {
  const duplo = { id: 'int-sala', nome: 'Interruptor sala', tipo: 'openbeken', canais: [
    { n: 1, funcao: 'luz', nome: 'Teto', divisao: 'Sala' }, { n: 2, funcao: 'luz', divisao: 'Sala' }] };
  const base = E.lerAparelhos(JSON.stringify([tomada('tomada-3'), duplo]));
  const pers = { 'tomada-3': { divisao: 'Cozinha', canais: { 1: { nome: 'Cafeteira' } } }, 'int-sala': { canais: { 2: { escondido: true } } } };
  const [t, d] = E.aplicarPersonalizar(base, pers);
  assert.equal(t.nome, 'Cafeteira', 'um só canal: o mosaico usa o nome do aparelho');
  assert.equal(t.nomeTecnico, 'tomada-3');
  assert.equal(t.divisao, 'Cozinha');
  assert.equal(t.canais[0].divisao, 'Cozinha', 'o relatório agrupa pela divisão do canal');
  assert.equal(t.divisaoTecnica, 'Sala');
  assert.equal(d.nome, 'Interruptor sala');
  assert.equal(d.canais[1].escondido, true);
  assert.equal(E.temVisivel(d), true, 'um canal ainda à vista');
  assert.equal(E.temVisivel(E.aplicarPersonalizar(base, { 'int-sala': { canais: { 1: { escondido: true }, 2: { escondido: true } } } })[1]), false);
  assert.equal(E.aplicarPersonalizar(base, {})[0], base[0], 'sem alterações: o mesmo objeto');
  assert.deepEqual(E.lerPersonalizar('{"offline_min":30,"personalizar":{"a":{}}}'), { a: {} });
  assert.deepEqual(E.lerPersonalizar('{"personalizar":[]}'), {});

  // Igual ao do painel ou vazio não se guarda; repor apaga o aparelho.
  const tB = base[0];
  assert.deepEqual(E.mudarPersonalizar({}, tB, { divisao: 'Sala', canais: { 1: { nome: ' tomada-3 ', escondido: false } } }), {});
  assert.deepEqual(E.mudarPersonalizar({}, tB, { divisao: ' Despensa ', canais: { 1: { nome: 'Arca', escondido: true } } }),
    { 'tomada-3': { divisao: 'Despensa', canais: { 1: { nome: 'Arca', escondido: true } } } });
  const r = E.mudarPersonalizar(pers, tB, {});
  assert.equal('tomada-3' in r, false);
  assert.ok(r['int-sala'], 'os outros aparelhos ficam');
  assert.ok(pers['tomada-3'], 'não muda o original');
});

test('organizar: o painel e o eletricista veem o nome da app ao lado do do quadro', async () => {
  const { Alertas } = await import('../src/alertas.js');
  const a = new Alertas({ config: { mqtt: {} }, registo: { info() {}, erro() {}, aviso() {} } });
  a.receber('domus/joao/_config', Buffer.from(JSON.stringify({ offline_min: 30, personalizar: {
    'tomada-3': { divisao: 'Cozinha', canais: { 1: { nome: 'Cafeteira' } } },
    'int-sala': { canais: { 1: { nome: 'Teto' }, 2: { escondido: true } } },
  } })), true);
  assert.equal(a.doCliente('joao', 'tomada-3'), 'Cafeteira · Cozinha');
  assert.equal(a.doCliente('joao', 'int-sala'), 'Teto · 1 escondido');
  assert.equal(a.doCliente('joao', 'outro'), null);
  assert.equal(a.doCliente('maria', 'tomada-3'), null);
  a.receber('domus/joao/_config', Buffer.from(''), true);   // retida apagada
  assert.equal(a.doCliente('joao', 'tomada-3'), null);
});
test('caixa de casa: `_ponte` = "0" põe os OpenBeken offline na app (os Shelly não); "1" ou vazio volta ao normal', () => {
  const lista = [tomada('tv'), { ...tomada('luz'), tipo: 'shelly' }];
  const aparelhos = E.lerAparelhos(JSON.stringify(lista));
  const estados = {};
  for (const [id, resto, texto] of [['tv', 'connected', 'online'], ['tv', 'power/get', '95'], ['luz', 'online', 'true']]) {
    E.aplicarMensagem(estados, id, aparelhos.find((a) => a.id === id), resto, texto, { agora: AGORA });
  }
  const modelos = (caiu) => aparelhos.map((a) => E.modelo(a, estados[a.id], AGORA, undefined, caiu));
  assert.deepEqual(modelos(false).map((m) => m.online), [true, true]);
  const caidos = modelos(true);
  assert.deepEqual(caidos.map((m) => m.online), [false, true], 'o connected retido diz online, mas a caixa caiu');
  assert.equal(E.disponivel(caidos[0]), false, 'não se pode tocar');
  assert.equal(E.resumo(caidos, null).potenciaW, 0, 'a potência de um OpenBeken inacessível não conta');
});

test('caixa de casa: o painel dá um alerta de casa com `_ponte` = "0" e tira-o com "1" ou vazio', async () => {
  const { Alertas } = await import('../src/alertas.js');
  const a = new Alertas({ config: { mqtt: {} }, registo: { info() {}, erro() {}, aviso() {} }, relogio: () => AGORA });
  const doJoao = () => a.lista({ cliente: 'joao' }).alertas.filter((x) => x.tipo === 'caixa_sem_ligacao');
  a.receber('domus/joao/_ponte', Buffer.from('1'), true);
  assert.equal(doJoao().length, 0);
  a.receber('domus/joao/_ponte', Buffer.from('0'));
  assert.equal(doJoao().length, 1);
  assert.equal(doJoao()[0].gravidade, 'alta');
  assert.equal(doJoao()[0].aparelho, null, 'um só alerta, da casa');
  assert.equal(doJoao()[0].desde, '2026-10-12T12:00:00Z');
  a.receber('domus/joao/_ponte', Buffer.from(''), true);   // remover-caixa apaga o retido
  assert.equal(doJoao().length, 0);
  a.receber('domus/joao/_ponte', Buffer.from('0'), true);   // retido ao arrancar o painel: não se sabe desde quando
  assert.equal(doJoao()[0].desde, null);
});
