// Cliente que regressa (decisões do dono, 2026-10-04; web/regresso.js): quando o cartão "Já tenho a planta" abre já
// escolhido no Início do simulador, que pedido conta como "em andamento" e qual se mostra, e os três estados do botão da
// página inicial. O campo `em_andamento` do servidor está em conta.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAVE_CASA_GUARDADA, temCasaGuardada, preEscolherCasa, pedidoEmAndamento, textoPedidoEmAndamento, urlDoPedido, botaoInicio } from '../../web/regresso.js';
import { CHAVE_CASA, estadoNovo, guardarCasa, carregarCasa, temProgresso } from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const armazem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('casa guardada neste navegador: a mesma chave do simulador; sem armazenamento (ou bloqueado) não há casa', () => {
  assert.equal(CHAVE_CASA_GUARDADA, CHAVE_CASA);
  const s = armazem();
  assert.equal(temCasaGuardada(s), false);
  const e = estadoNovo();
  e.casa.tipo = 'moradia';
  e.casa.tipologia = 'T1';
  e.planta = plantaDaCasa(e.casa);
  assert.equal(guardarCasa(s, e), true);
  assert.ok(carregarCasa(s));
  assert.equal(temCasaGuardada(s), true);
  assert.equal(temCasaGuardada(null), false);
  assert.equal(temCasaGuardada({ getItem() { throw new Error('bloqueado'); } }), false);
});

test('o cartão da casa abre já escolhido: só numa simulação nova, com casa guardada, e nunca por cima de uma escolha do cliente', () => {
  assert.equal(preEscolherCasa({ funil: null, temCasa: true }), true);
  assert.equal(preEscolherCasa({ funil: null, temCasa: false }), false, 'sem casa guardada: como sempre');
  for (const funil of ['primeira', 'planta', 'avaria']) assert.equal(preEscolherCasa({ funil, temCasa: true }), false, `caso já escolhido (${funil})`);
  assert.equal(preEscolherCasa({ funil: null, temCasa: true, recusou: true }), false, 'depois de "Começar de novo"');
  assert.equal(preEscolherCasa(), false);
  // O cartão escolhido pela página é o funil "planta" sem mais nada: para o estado seria "progresso" — por isso o
  // simulador não o grava nem o manda para a conta enquanto a escolha não for do cliente (app.js emCurso).
  const e = estadoNovo();
  assert.equal(temProgresso(e, 0), false);
  e.funil = 'planta';
  assert.equal(temProgresso(e, 0), true);
});

test('pedido em andamento: o mais recente com `em_andamento`; quantos são; painel antigo (sem o campo) → nenhum', () => {
  const pedidos = [
    { id: 14, estado: 'perdido', em_andamento: false },
    { id: 12, estado: 'visita_marcada', em_andamento: true },
    { id: 9, estado: 'aceite', em_andamento: false },
    { id: 7, estado: 'novo', em_andamento: true },
  ];
  assert.deepEqual(pedidoEmAndamento(pedidos), { id: 12, quantos: 2 });
  assert.deepEqual(pedidoEmAndamento([pedidos[3]]), { id: 7, quantos: 1 });
  assert.equal(pedidoEmAndamento([pedidos[0], pedidos[2]]), null);
  // Painel antigo: a lista não traz o campo — fica como antes (sem aviso), mesmo com pedidos por fechar.
  assert.equal(pedidoEmAndamento([{ id: 12, estado: 'novo' }, { id: 7, estado: 'aceite' }]), null);
  for (const l of [null, undefined, {}, 'x', [], [null], [{ em_andamento: true }], [{ id: '3', em_andamento: true }], [{ id: 3, em_andamento: 'sim' }]]) assert.equal(pedidoEmAndamento(l), null);
  assert.equal(textoPedidoEmAndamento({ id: 12, quantos: 1 }), 'Já tem o pedido n.º 12 em andamento.');
  assert.equal(textoPedidoEmAndamento({ id: 12, quantos: 2 }), 'Já tem o pedido n.º 12 em andamento (e mais 1 em andamento).');
  assert.equal(textoPedidoEmAndamento({ id: 12, quantos: 4 }), 'Já tem o pedido n.º 12 em andamento (e mais 3 em andamento).');
  assert.equal(textoPedidoEmAndamento(null), '');
  assert.equal(urlDoPedido(12), 'conta.html#pedido-12');
});

test('botão da página inicial: visitante novo fica como está; casa guardada ou sessão → continuar; sessão com pedido em andamento → o pedido', () => {
  assert.equal(botaoInicio({ sessao: false, temCasa: false, pedido: null }), null);
  assert.equal(botaoInicio(), null);
  const continuar = { texto: 'Continuar com a minha casa', href: 'simulador.html' };
  assert.deepEqual(botaoInicio({ sessao: false, temCasa: true }), continuar);
  assert.deepEqual(botaoInicio({ sessao: true, temCasa: false }), continuar);
  assert.deepEqual(botaoInicio({ sessao: true, temCasa: true }), continuar);
  assert.deepEqual(botaoInicio({ sessao: true, temCasa: true, pedido: { id: 12, quantos: 2 } }), { texto: 'Ver o meu pedido', href: 'conta.html#pedido-12' });
  // Sem sessão nunca se fala de pedidos (nem se pedem).
  assert.deepEqual(botaoInicio({ sessao: false, temCasa: true, pedido: { id: 12, quantos: 1 } }), continuar);
  assert.equal(botaoInicio({ sessao: false, temCasa: false, pedido: { id: 12, quantos: 1 } }), null);
});

test('as páginas: o botão nasce com o texto e o destino de sempre (sem JavaScript); o Início tem o aviso e a frase; a conta tem o cartão do pedido', async () => {
  const index = await readFile(join(WEB, 'index.html'), 'utf8');
  assert.match(index, /<a class="btn" id="hero-simular" href="simulador\.html"><svg[^>]*>.*?<\/svg><span id="hero-simular-texto">Descrever a minha casa<\/span><\/a>/);
  assert.match(index, /href="simulador\.html\?caso=servico">.*?<span>Pedir um serviço<\/span>/);
  assert.match(index, /href="simulador\.html\?caso=avaria">.*?<span>Tenho uma avaria<\/span>/);
  const sim = await readFile(join(WEB, 'simulador.html'), 'utf8');
  assert.match(sim, /<div class="msg info" id="inicio-pedido" role="status" hidden><\/div>\s*<p class="msg info" id="inicio-casa" role="status" hidden><\/p>\s*<fieldset class="escolhas">\s*<legend>Qual é o seu caso\?/);
  const conta = await readFile(join(WEB, 'conta.js'), 'utf8');
  assert.ok(conta.includes('c.id = `pedido-${p.id}`'), 'conta.html#pedido-<id>');
});
