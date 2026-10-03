// Área de cliente — pré-visualização da conta sem casa ligada (decisão do dono, 2026-10-03; web/previsao.js): de onde
// vem a planta (rascunho por enviar antes dos pedidos; o pedido mais recente com planta), o que se diz de cada divisão
// (o inventário do passo "Divisões") e que botões aparecem. O lado do servidor está em conta.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { temPlanta, fontesDePlanta, pedidoDoAndamento, textoInventario, divisoesDaPrevisao, botoesDaPrevisao } from '../../web/previsao.js';
import { estadoNovo, normalizarEstado, inventarioParaEnvio, temProgresso, marcarNaoTem } from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const PLANTA = { largura_cm: 900, altura_cm: 600, divisoes: [{ id: 'd2', nome: 'Quarto', piso: 1 }, { id: 'd1', nome: 'Sala', piso: 0 }, { id: 'd3', nome: '', piso: 0 }], elementos: [] };
const COMPRAS = { ativas: true, pode: true, visita: { valor: 26.2, paga: false, fora_area: false, sem_concelho: false } };

test('que planta se mostra: o rascunho por enviar primeiro; depois os pedidos com planta, do mais recente para o mais antigo', () => {
  assert.equal(temPlanta(PLANTA), true);
  for (const p of [null, undefined, {}, { divisoes: [] }, { divisoes: 'x' }, { elementos: [{}] }]) assert.equal(temPlanta(p), false);
  const pedidos = [{ id: 9, criado: '2026-10-02', tem_planta: false }, { id: 7, criado: '2026-09-20', tem_planta: true }, { id: 3, criado: '2026-08-01', tem_planta: true }];
  const data = (d) => `dia ${d}`;
  assert.deepEqual(fontesDePlanta(pedidos, null, data), [
    { chave: 'pedido:7', pedido: 7, texto: 'Pedido n.º 7 (dia 2026-09-20)' }, { chave: 'pedido:3', pedido: 3, texto: 'Pedido n.º 3 (dia 2026-08-01)' },
  ]);
  const comRascunho = fontesDePlanta(pedidos, { planta: PLANTA, atualizado: '2026-10-03' }, data);
  assert.deepEqual(comRascunho.map((f) => f.chave), ['rascunho', 'pedido:7', 'pedido:3']);
  assert.equal(comRascunho[0].texto, 'Simulação por enviar (dia 2026-10-03)');
  // Um rascunho sem divisões desenhadas não é uma planta; sem nada, lista vazia ("Ainda não temos a planta…").
  assert.deepEqual(fontesDePlanta(pedidos, { planta: { divisoes: [] } }).map((f) => f.chave), ['pedido:7', 'pedido:3']);
  assert.deepEqual(fontesDePlanta([{ id: 9, tem_planta: false }], null), []);
  assert.deepEqual(fontesDePlanta(undefined, undefined), []);
  // O andamento: o pedido da planta escolhida; com o rascunho (ou sem planta), o pedido mais recente; sem pedidos, nenhum.
  assert.equal(pedidoDoAndamento(pedidos, comRascunho[1]).id, 7);
  assert.equal(pedidoDoAndamento(pedidos, comRascunho[0]).id, 9);
  assert.equal(pedidoDoAndamento(pedidos, null).id, 9);
  assert.equal(pedidoDoAndamento([], comRascunho[0]), null);
});

test('as divisões e o que a casa tem: o inventário em palavras; "sem …" no "Não tem"; por dizer quando falta', () => {
  assert.equal(textoInventario({ interruptores: [1, 2], tomadas: [1, 1, 2, 3] }), '2 interruptores (1 e 2 botões) · 4 tomadas (2 simples, 1 dupla, 1 tripla)');
  assert.equal(textoInventario({ interruptores: [1], tomadas: [] }), '1 interruptor (1 botão) · sem tomadas');
  assert.equal(textoInventario({ interruptores: [], tomadas: null }), 'sem interruptores');
  assert.equal(textoInventario({ interruptores: null, tomadas: null }), null);
  assert.equal(textoInventario(undefined), null);
  const l = divisoesDaPrevisao(PLANTA, [{ divisao: 'd1', interruptores: [2], tomadas: [3, 3] }, { divisao: 'd2', interruptores: null, tomadas: null }]);
  assert.deepEqual(l, [
    { id: 'd1', nome: 'Sala', piso: 0, texto: '1 interruptor (2 botões) · 2 tomadas (2 triplas)' },
    { id: 'd3', nome: 'Divisão', piso: 0, texto: 'Ainda por dizer o que tem.' },
    { id: 'd2', nome: 'Quarto', piso: 1, texto: 'Ainda por dizer o que tem.' },
  ]);
  assert.equal(divisoesDaPrevisao(PLANTA, null).every((d) => d.texto === 'Ainda por dizer o que tem.'), true, 'pedido de antes, sem inventário');
  assert.deepEqual(divisoesDaPrevisao(null), []);
});

test('botões: só levam ao sítio certo — continuar/simular, ver o pedido e o relatório, pedir visita quando se pode', () => {
  const chaves = (o) => botoesDaPrevisao(o).map((b) => b.chave);
  // Sem planta nenhuma: "Simular orçamento" (ou continuar o que começou).
  assert.deepEqual(botoesDaPrevisao({}), [{ chave: 'simular', texto: 'Simular orçamento', href: 'simulador.html', principal: true }]);
  assert.deepEqual(chaves({ temRascunho: true }), ['continuar']);
  // Só um rascunho com planta: continuar a simulação.
  assert.deepEqual(botoesDaPrevisao({ temPlanta: true, temRascunho: true }), [{ chave: 'continuar', texto: 'Continuar a simulação', href: 'simulador.html', principal: true }]);
  // Pedido enviado: ver o pedido (em "A minha conta", nesse pedido) e pedir a visita, que se compra lá.
  const pedido = { id: 12, compras: COMPRAS, data_visita: null, obra: null };
  assert.deepEqual(botoesDaPrevisao({ temPlanta: true, pedido }), [
    { chave: 'pedido', texto: 'Ver o pedido e o relatório', href: 'conta.html#pedido-12', principal: true },
    { chave: 'visita', texto: 'Pedir visita', href: 'conta.html#pedido-12', principal: false },
  ]);
  assert.deepEqual(chaves({ temPlanta: true, temRascunho: true, pedido }), ['continuar', 'pedido', 'visita']);
  assert.deepEqual(chaves({ temPlanta: false, pedido }), ['simular', 'pedido', 'visita'], 'pedido sem planta (ex.: avaria)');
  // A visita só quando ainda se pode comprar.
  const sem = (mud) => chaves({ temPlanta: true, pedido: { ...pedido, ...mud } });
  assert.deepEqual(sem({ compras: { ...COMPRAS, ativas: false } }), ['pedido'], 'pagamentos desligados');
  assert.deepEqual(sem({ compras: { ...COMPRAS, pode: false } }), ['pedido']);
  assert.deepEqual(sem({ compras: { ...COMPRAS, visita: { ...COMPRAS.visita, paga: true } } }), ['pedido'], 'já paga');
  assert.deepEqual(sem({ compras: { ...COMPRAS, visita: { ...COMPRAS.visita, valor: null, fora_area: true } } }), ['pedido'], 'fora da área');
  assert.deepEqual(sem({ compras: { ...COMPRAS, visita: { ...COMPRAS.visita, valor: null, sem_concelho: true } } }), ['pedido']);
  assert.deepEqual(sem({ data_visita: '2026-10-10T10:00' }), ['pedido'], 'visita já marcada');
  assert.deepEqual(sem({ obra: { estado: 'marcada' } }), ['pedido']);
  assert.deepEqual(sem({ compras: undefined }), ['pedido'], 'sem o módulo dos pagamentos');
});

test('o rascunho guardado na conta lê-se como o simulador o lê: a planta e o inventário (também de um estado de antes)', () => {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = ['automatizar'];
  e.passo = 5;
  e.visitado = 5;
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T1', quartos: 1, casas_banho: 1, salas: 1 };
  e.planta = plantaDaCasa(e.casa, []);
  const sala = e.planta.divisoes[0];
  for (const x of e.planta.elementos) if (x.divisao === sala.id && x.tipo === 'interruptor') { x.props.botoes = 2; x.confirmado = true; }
  e.planta.elementos = e.planta.elementos.filter((x) => !(x.divisao === sala.id && x.tipo === 'tomada'));
  marcarNaoTem(e, 'tomada', sala, true, e.planta.divisoes);
  const lido = normalizarEstado(JSON.parse(JSON.stringify(e)));
  assert.equal(temProgresso(lido), true);
  const inv = inventarioParaEnvio(lido, lido.planta);
  const l = divisoesDaPrevisao(lido.planta, inv);
  assert.equal(l.length, lido.planta.divisoes.length);
  assert.deepEqual([l[0].nome, l[0].texto], ['Sala', '1 interruptor (2 botões) · sem tomadas']);
  assert.equal(l[1].texto, 'Ainda por dizer o que tem.');
  assert.deepEqual(fontesDePlanta([], { planta: lido.planta, atualizado: null }).map((f) => f.texto), ['Simulação por enviar']);
  // Um estado de antes do inventário (ordem 13): abre na mesma, com tudo por dizer.
  const velho = normalizarEstado({ ...JSON.parse(JSON.stringify(e)), ordem: 13 });
  assert.equal(divisoesDaPrevisao(velho.planta, inventarioParaEnvio(velho, velho.planta)).every((d) => d.texto === 'Ainda por dizer o que tem.'), true);
});

test('a página: a pré-visualização não liga ao MQTT nem tem controlos; a porta fechada a vermelho já não é o caminho da conta', async () => {
  const vista = await readFile(join(WEB, 'cliente-previsao.js'), 'utf8');
  assert.equal(/mqtt|publish|subscribe|\/comando/i.test(vista.replace(/^\s*\/\/.*$/gm, '')), false, 'sem MQTT na pré-visualização');
  assert.match(vista, /Pré-visualização — a sua casa antes da instalação/);
  assert.match(vista, /Ainda não temos a planta da sua casa/);
  assert.match(vista, /simulador\/planta-svg\.js/, 'o desenho é o do simulador (não um novo)');
  const cliente = await readFile(join(WEB, 'cliente.js'), 'utf8');
  assert.match(cliente, /if \(eu\?\.conta && !eu\.tem_casa\) \{ await abrirPrevisao\(eu\); return; \}/, 'sem casa ligada: pré-visualização antes de pedir as credenciais');
  assert.match(await readFile(join(WEB, 'cliente.html'), 'utf8'), /id="vista-previsao" hidden/);
});
