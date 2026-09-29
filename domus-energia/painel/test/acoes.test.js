// Simulador, lote 7 (docs/SIMULADOR-ORCAMENTO.md §0, §3, §6): serviço pedido (passo 1) e ação por aparelho
// (Manter, Reparar, Substituir, Novo) — preço, migração dos estados antigos, pedido e lista de trabalho do relatório.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acaoOmissao, soReparacoes, precisaEscolher, faltaAcao, plantaNovos, pedidosAcoes, acaoDe, contarAcoes,
} from '../../web/simulador/acoes.js';
import { pedidosDaSelecao, calcularPreco, horasTroca, quadroNoPedido } from '../../web/simulador/preco.js';
import { estadoNovo, normalizarEstado, montarSimulacao, PASSOS } from '../../web/simulador/estado.js';
import { contarPlanta, divisoesDaContagem } from '../../web/simulador/regras.js';
import { listaTrabalho, aVerificarNaVisita } from '../public/ecras/simulacao.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);

/** Cozinha com 2 tomadas, 2 interruptores, 1 luz, uma placa e a porta. */
function planta(acoes = {}) {
  const el = (id, tipo, props = {}) => ({ id, tipo, x_cm: 100, y_cm: 100, rot: 0, piso: 0, divisao: 'd1', props, ...(acoes[id] ?? {}) });
  return {
    escala_cm: 50, largura_cm: 1000, altura_cm: 800, fundo: null, respostas: true,
    divisoes: [{ id: 'd1', nome: 'Cozinha', piso: 0, x_cm: 0, y_cm: 0, largura_cm: 400, altura_cm: 300 }],
    elementos: [
      el('e1', 'tomada', { dupla: false, inteligente: false }), el('e2', 'tomada', { dupla: false, inteligente: false }),
      el('e3', 'interruptor', { botoes: 1 }), el('e4', 'interruptor', { botoes: 2 }), el('e5', 'luz'),
      el('e6', 'maquina', { modelo: 'placa', potencia_w: 7200 }), el('e7', 'porta', { entrada: false }),
    ],
  };
}

test('serviço: ação por omissão, fluxo curto e o que falta responder', () => {
  assert.equal(acaoOmissao(['nova']), 'novo');
  assert.equal(acaoOmissao(['nova', 'reparar']), 'novo', 'com Instalação nova junto de outro, a omissão é Novo');
  assert.equal(acaoOmissao(['automatizar']), 'manter');
  assert.equal(acaoOmissao(['reparar']), 'manter');
  assert.ok(soReparacoes(['reparar']) && !soReparacoes(['reparar', 'automatizar']));
  assert.ok(!precisaEscolher(['nova']) && precisaEscolher(['automatizar']) && !precisaEscolher(['reparar']));
  const t = { tipo: 'tomada', props: {} };
  assert.deepEqual(faltaAcao(t, ['nova']), [], 'Novo por omissão já conta como resposta');
  assert.deepEqual(faltaAcao(t, ['automatizar']), ['acao'], 'sem Instalação nova tem de escolher');
  assert.deepEqual(faltaAcao({ ...t, acao: 'reparar' }, ['automatizar']), ['avaria']);
  assert.deepEqual(faltaAcao({ ...t, acao: 'reparar', avaria: 'queimada' }, ['automatizar']), []);
  assert.deepEqual(faltaAcao({ ...t, acao: 'substituir' }, ['nova']), ['inteligente']);
  assert.deepEqual(faltaAcao({ tipo: 'maquina', props: { modelo: 'placa' }, acao: 'substituir' }, ['nova']), [], 'máquinas: sem "por um inteligente?"');
  assert.deepEqual(faltaAcao({ tipo: 'porta', props: {} }, ['automatizar']), [], 'a porta não tem ação');
  assert.equal(acaoDe({ tipo: 'janela', props: { estore: false }, acao: 'reparar' }, ['nova']), 'novo', 'janela sem estore: sem ação');
});

test('Instalação nova sem ações: os mesmos pedidos (e o mesmo preço) de antes', () => {
  const p = planta();
  const antes = divisoesDaContagem(contarPlanta(p));
  const agora = divisoesDaContagem(contarPlanta(plantaNovos(p, ['nova'])));
  assert.deepEqual(agora, antes);
  const base = { casa: null, quadro: { circuitos: [] }, extras: {} };
  const pa = pedidosDaSelecao({ ...base, divisoes: antes }).map(({ chave, qtd }) => ({ chave, qtd }));
  const pn = pedidosDaSelecao({ ...base, servico: ['nova'], planta: p, divisoes: agora }).map(({ chave, qtd }) => ({ chave, qtd }));
  assert.deepEqual(pn, pa);
  assert.equal(calcularPreco(pn, CATALOGO, null).total, calcularPreco(pa, CATALOGO, null).total);
});

test('preço por ação: Manter 0 €, Reparar = diagnóstico, Substituir = aparelho + horas de troca', () => {
  const p = planta({
    e1: { acao: 'reparar', avaria: 'queimada' },
    e2: { acao: 'substituir', inteligente: true },
    e3: { acao: 'substituir', inteligente: false },
    e4: { acao: 'manter' },
    e5: { acao: 'manter' },
    e6: { acao: 'substituir' },
  });
  const sv = ['automatizar', 'reparar'];
  assert.deepEqual(contarAcoes(p, sv), { manter: 2, reparar: 1, substituir: 3, novo: 0 });
  assert.deepEqual(pedidosAcoes(p, sv).map((x) => `${x.acao}:${x.chave}×${x.qtd}`).sort(),
    ['reparar:diagnostico×1', 'substituir:aparelho_normal×1', 'substituir:tomada×1', 'substituir:troca_maquina×1']);
  const divisoes = divisoesDaContagem(contarPlanta(plantaNovos(p, sv)));
  assert.deepEqual(divisoes[0].interruptores, [], 'Manter e Substituir não entram nas linhas dos Novos');
  const pedidos = pedidosDaSelecao({ casa: null, servico: sv, planta: p, quadro: { circuitos: [] }, divisoes, extras: {} });
  const preco = calcularPreco(pedidos, CATALOGO, null);
  const linha = (sku) => preco.linhas.find((l) => l.sku === sku);
  assert.equal(linha('DIAG-AVARIA').total, 25);
  assert.equal(linha('DIAG-AVARIA').horas, 0.5);
  assert.equal(linha('TOMADA-WIFI').grupo, 'substituir');
  // TOMADA-WIFI não tem horas_troca: 50 % das 0,1 h de instalação.
  assert.equal(linha('TOMADA-WIFI').horas, 0.05);
  assert.equal(linha('APARELHO-NORMAL').horas, 0.25, 'horas_troca do catálogo');
  assert.equal(linha('TROCA-MAQUINA').horas, 0.5);
  assert.equal(horasTroca({ horas_instalacao: 1, horas_troca: null }), 0.5);
  assert.equal(horasTroca({ horas_instalacao: 1, horas_troca: 0.3 }), 0.3);
});

test('quadro no pedido: sempre com Instalação nova; sem ela, só se o cliente quiser melhorar o quadro', () => {
  assert.ok(quadroNoPedido({}), 'estado sem serviço (antigo)');
  assert.ok(quadroNoPedido({ servico: ['nova', 'reparar'] }));
  assert.ok(!quadroNoPedido({ servico: ['automatizar'] }));
  assert.ok(quadroNoPedido({ servico: ['reparar'], mexerQuadro: true }));
  const e = estadoNovo();
  e.servico = ['reparar'];
  assert.ok(!pedidosDaSelecao(e).some((x) => x.grupo === 'quadro'), 'só reparações: sem diferenciais nem caixa');
  e.servico = ['nova'];
  assert.ok(pedidosDaSelecao(e).some((x) => x.grupo === 'quadro'));
});

test('estados antigos: 6 passos → 7 (tudo +1), sem serviço = Instalação nova; ações da planta guardadas', () => {
  assert.equal(PASSOS.length, 7);
  assert.equal(PASSOS[0], 'Serviço');
  const velho = { ...estadoNovo(), passos: 6, ordem: 4, passo: 2, visitado: 3 };
  delete velho.servico;
  const e = normalizarEstado(velho);
  assert.equal(e.passo, 3, 'Divisões (2) → 3');
  assert.equal(e.visitado, 4);
  assert.deepEqual(e.servico, ['nova']);
  const novo = normalizarEstado({ ...estadoNovo(), servico: ['reparar', 'x'], planta: planta({ e1: { acao: 'reparar', avaria: 'x'.repeat(300) }, e7: { acao: 'reparar' }, e2: { acao: 'voar' } }) });
  assert.deepEqual(novo.servico, ['reparar']);
  const el = (id) => novo.planta.elementos.find((x) => x.id === id);
  assert.equal(el('e1').acao, 'reparar');
  assert.equal(el('e1').avaria.length, 200, 'descrição até 200 caracteres');
  assert.equal(el('e7').acao, undefined, 'a porta não tem ação');
  assert.equal(el('e2').acao, undefined, 'ação desconhecida sai');
  const semServico = normalizarEstado({ ...estadoNovo(), servico: [] });
  assert.deepEqual(semServico.servico, [], 'estado novo sem escolha: continua por escolher');
});

test('pedido (§6): serviço, ação por aparelho, lista de trabalho e totais por ação; relatório técnico', () => {
  const e = estadoNovo();
  e.servico = ['reparar'];
  e.planta = planta({ e1: { acao: 'reparar', avaria: 'queimada' }, e3: { acao: 'substituir', inteligente: true } });
  e.divisoes = divisoesDaContagem(contarPlanta(plantaNovos(e.planta, e.servico)));
  const pedidos = pedidosDaSelecao(e);
  const preco = calcularPreco(pedidos, CATALOGO, null);
  const linhaArtigo = (chave, acao) => ({ sku: chave === 'diagnostico' ? 'DIAG-AVARIA' : 'INT-VIDRO-1', horas: acao === 'substituir' ? 0.25 : 0.5 });
  const sim = montarSimulacao(e, preco, 'base', [{ chave: 'd1:tomada', tipo: 'tomada', legenda: 'Cozinha — Tomadas' }], linhaArtigo);
  assert.deepEqual(sim.servico, ['reparar']);
  const el = (id) => sim.planta.elementos.find((x) => x.id === id);
  assert.deepEqual([el('e1').acao, el('e1').avaria], ['reparar', 'queimada']);
  assert.deepEqual([el('e3').acao, el('e3').inteligente], ['substituir', true]);
  assert.equal(el('e2').acao, 'manter', 'a ação que vale vai sempre');
  assert.equal(el('e7').acao, undefined);
  assert.equal(sim.quadro.no_preco, false);
  assert.equal(sim.totais_acao.reparar.aparelhos, 1);
  assert.equal(sim.totais_acao.reparar.artigos_iva, 25);
  assert.equal(sim.totais_acao.manter.aparelhos, 4);
  const rep = sim.trabalho[0].acoes.find((a) => a.acao === 'reparar');
  assert.deepEqual({ ...rep }, { acao: 'reparar', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'DIAG-AVARIA', qtd: 1 }], horas: 0.5, foto: 'd1:tomada', avarias: ['queimada'] });
  assert.ok(sim.itens.every((i) => i.grupo && 'horas' in i));
  assert.ok(sim.avisos.some((a) => /ficam nos circuitos que já existem/.test(a)));

  const lista = listaTrabalho(sim, { 'DIAG-AVARIA': { nome: 'Diagnóstico de avaria' } });
  assert.equal(lista.divisoes.length, 1);
  const txt = lista.divisoes[0].linhas.map((l) => `${l.acao}: ${l.texto}`);
  assert.deepEqual(txt, ['reparar: 1 tomada («queimada» — ver foto)', 'substituir: 1 interruptor por um inteligente']);
  assert.equal(lista.divisoes[0].linhas[0].material, 'Diagnóstico de avaria ×1');
  assert.equal(lista.manter, 4);
  const v = aVerificarNaVisita(sim).filter((x) => x.tema === 'Reparação');
  assert.equal(v.length, 1);
  assert.match(v[0].texto, /Cozinha: tomada — «queimada» \(ver foto\)/);
});

test('pedidos antigos (sem serviço nem ações): lista de trabalho com tudo Novo e o circuito da placa', () => {
  const sim = {
    planta: planta(),
    quadro: { circuitos: [{ n: 3, tipo: 'maquina', divisoes: ['Cozinha'], itens: { maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } }] },
  };
  const l = listaTrabalho(sim);
  assert.equal(l.divisoes[0].linhas.length, 1);
  assert.equal(l.divisoes[0].linhas[0].acao, 'novo');
  assert.match(l.divisoes[0].linhas[0].texto, /2 tomadas.*circuito novo para placa/);
});
