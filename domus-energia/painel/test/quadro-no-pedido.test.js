// O quadro elétrico no preço (web/simulador/preco.js quadroNoPedido): em "Obras" (Pedir um serviço) só entra se o
// cliente o pedir (decisão do dono, 2026-10-11); na instalação nova da primeira vez continua a entrar sempre.
// E os disjuntores inteligentes (circuitosDoPedido): em "Obras" com o quadro em "Manter como está" não entram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadroNoPedido, circuitosDoPedido, pedidosDaSelecao, calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO } from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { contarPlanta, sugerirCircuitos, divisoesDaContagem, disjuntoresInteligentes } from '../../web/simulador/regras.js';
import { plantaNovos, plantaInteligentes } from '../../web/simulador/acoes.js';
import { calcularMelhorias, mudarMelhoria, QUADRO_SEGURO } from '../../web/simulador/melhorias.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS } from '../src/catalogo-sementes.js';
import { tudoNovo } from './ajuda.js';

test('quadro no preço: em "Obras" só com "Melhorar" ou "Quadro novo"; instalação nova sempre; automatizar e reparar só se pedir', () => {
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: 'obras', mexerQuadro: false }), false, 'obras: trocar uma tomada não traz quadro');
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: 'obras', mexerQuadro: true }), true, 'obras: o cliente pediu');
  assert.equal(quadroNoPedido({ servico: ['nova'], caminho: null, mexerQuadro: false }), true, 'instalação nova (primeira vez)');
  assert.equal(quadroNoPedido({ servico: ['nova'] }), true);
  assert.equal(quadroNoPedido({ servico: ['automatizar'], caminho: 'automatizar', mexerQuadro: false }), false);
  assert.equal(quadroNoPedido({ servico: ['reparar'], caminho: 'quadro', mexerQuadro: true }), true, 'trocar o quadro');
  assert.equal(quadroNoPedido({}), true, 'estado antigo sem serviço: como antes');
});

// Em "Obras" com o quadro em "Manter como está" também não entram disjuntores inteligentes (decisão do dono,
// 2026-10-11): a obra leva só o que o cliente marcou.
const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS].filter((a) => a.ativo !== false);
const MAQUINAS = [{ modelo: 'termoacumulador', qtd: 1, piso: 0 }, { modelo: 'placa', qtd: 1, piso: 0 }, { modelo: 'maquina_lavar', qtd: 1, piso: 0 }];
const INTELIGENTES = ['disjuntor_protecoes', 'disjuntor_simples'];
const SY = /^TONGOU-SY[12]-/;
/** T2 com tudo novo e os circuitos calculados (como app.js acertarPedido); `mais`: o funil, o caminho e a escolha do quadro. */
function casaT2(mais) {
  const e = estadoNovo();
  e.servico = ['nova'];
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };
  e.planta = tudoNovo(plantaDaCasa(e.casa, MAQUINAS));
  e.plantaFase = 'tudo';
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, e.servico), []));
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, {});
  e.passo = PASSO.melhorias;
  e.visitado = PASSO.melhorias;
  return Object.assign(e, mais);
}
/** Disjuntores inteligentes do pedido (sem os das melhorias, que têm a sua lista). */
const qtdInteligentes = (pedidos) => pedidos.filter((p) => INTELIGENTES.includes(p.chave) && p.grupo !== 'melhoria').reduce((s, p) => s + p.qtd, 0);
const precoDe = (e) => calcularPreco(pedidosDaSelecao(e), CATALOGO, {}, { valor_iva: 0 });
const enviado = (e) => montarSimulacao(e, precoDe(e), 'base');
const enviadosSy = (e) => enviado(e).itens.filter((i) => SY.test(i.sku)).reduce((t, i) => t + i.qtd, 0);

test('"Obras" com "Manter como está": zero disjuntores inteligentes e total mais baixo; com "Quadro novo" ou "Melhorar", como antes', () => {
  const manter = casaT2({ funil: 'planta', caminho: 'obras', mexerQuadro: false });
  const esperados = disjuntoresInteligentes(manter.quadro.circuitos, manter.quadro.disjuntor).total;
  assert.ok(esperados > 0, 'os circuitos calculados pedem disjuntores inteligentes');
  assert.equal(qtdInteligentes(pedidosDaSelecao(manter)), 0);
  assert.ok(manter.quadro.circuitos.some((c) => c.inteligente), 'o estado não muda: mudar a escolha do quadro repõe-nos');
  assert.deepEqual(circuitosDoPedido(manter).map((c) => [c.inteligente, c.medir]), manter.quadro.circuitos.map(() => [false, false]));
  // O pedido que segue: nem nos itens, nem nos circuitos do quadro (o painel e o eletricista leem daqui), nem nos módulos.
  const s = enviado(manter);
  assert.deepEqual(s.itens.filter((i) => SY.test(i.sku)), []);
  assert.equal(s.quadro.no_preco, false);
  assert.equal(s.quadro.circuitos.length, manter.quadro.circuitos.length);
  assert.ok(s.quadro.circuitos.every((c) => c.inteligente === false && c.medir === false));
  assert.ok(!s.quadro.modulos.linhas.some((l) => /inteligentes/.test(l.nome)));
  // O que o cliente marcou continua lá (os pontos novos e as linhas das máquinas).
  assert.ok(s.itens.length > 0 && precoDe(manter).total > 0);

  for (const quadro_novo of ['novo', 'atual']) {
    const com = casaT2({ funil: 'planta', caminho: 'obras', mexerQuadro: true });
    com.quadro.quadro_novo = quadro_novo;
    assert.equal(qtdInteligentes(pedidosDaSelecao(com)), esperados, quadro_novo);
    assert.equal(circuitosDoPedido(com), com.quadro.circuitos, 'os circuitos tal e qual');
    assert.ok(precoDe(com).total > precoDe(manter).total, 'sem os disjuntores (e sem o quadro) o total é mais baixo');
    assert.equal(enviadosSy(com), esperados);
    assert.ok(enviado(com).quadro.circuitos.some((c) => c.inteligente));
  }
  // O total de "Manter" é o de antes menos os disjuntores inteligentes (o material e a mão de obra deles), e mais nada.
  const soDisjuntores = calcularPreco(pedidosDaSelecao({ ...manter, mexerQuadro: true }).filter((p) => INTELIGENTES.includes(p.chave)), CATALOGO, {}, { valor_iva: 0 });
  const semQuadro = calcularPreco(pedidosDaSelecao({ ...manter, mexerQuadro: true }).filter((p) => p.grupo !== 'quadro'), CATALOGO, {}, { valor_iva: 0 });
  assert.ok(soDisjuntores.total > 0);
  assert.equal(Math.round((semQuadro.total - precoDe(manter).total) * 100), Math.round(soDisjuntores.total * 100));
});

test('os outros caminhos não mudam: instalação nova da primeira vez, automatizar, reparar e trocar o quadro levam os disjuntores dos circuitos', () => {
  for (const mais of [{ funil: 'primeira', caminho: null }, { funil: 'primeira' }, { funil: 'planta', caminho: 'automatizar', servico: ['automatizar'], mexerQuadro: false },
    { funil: 'planta', caminho: 'reparar', servico: ['reparar'], mexerQuadro: false }, { funil: 'planta', caminho: 'quadro', servico: ['reparar'], mexerQuadro: true }]) {
    const e = casaT2(mais);
    const esperados = disjuntoresInteligentes(e.quadro.circuitos, e.quadro.disjuntor).total;
    assert.ok(esperados > 0);
    assert.equal(qtdInteligentes(pedidosDaSelecao(e)), esperados, JSON.stringify(mais));
    assert.equal(circuitosDoPedido(e), e.quadro.circuitos, 'os circuitos tal e qual');
    assert.equal(enviadosSy(e), esperados, JSON.stringify(mais));
  }
});

test('melhorias em "Obras" com "Manter": Casa inteligente e Segurança dão o mesmo, o Quadro seguro traz as proteções e o Poupar energia a medição das máquinas novas', () => {
  const manter = casaT2({ funil: 'planta', caminho: 'obras', mexerQuadro: false });
  const novo = casaT2({ funil: 'planta', caminho: 'obras', mexerQuadro: true });
  const porId = (e) => Object.fromEntries(calcularMelhorias(e, CATALOGO, {}).map((m) => [m.id, m]));
  const a = porId(manter), b = porId(novo);
  for (const id of ['casa-inteligente', 'seguranca']) assert.deepEqual([a[id].itens, a[id].preco], [b[id].itens, b[id].preco], id);
  // Quadro seguro com o quadro fora do pedido: as proteções entram como linhas da melhoria.
  assert.ok(!a[QUADRO_SEGURO].incluido && !a[QUADRO_SEGURO].vazio && a[QUADRO_SEGURO].preco > 0);
  for (const chave of ['afdd', 'descarregador', 'rele_tensao', 'geral_wifi']) assert.ok(a[QUADRO_SEGURO].itens.some((i) => i.chave === chave), chave);
  assert.ok(!a[QUADRO_SEGURO].itens.some((i) => INTELIGENTES.includes(i.chave)));
  // Poupar energia: o medidor geral e um disjuntor com medição por cada máquina nova (3) — sem a melhoria já não o têm.
  // Com o quadro no pedido as máquinas novas já têm disjuntor inteligente: só o medidor, como antes.
  const qtd = (m, chave) => m.itens.find((i) => i.chave === chave)?.qtd ?? 0;
  assert.deepEqual([qtd(a['poupar-energia'], 'medidor_geral'), qtd(a['poupar-energia'], 'disjuntor_protecoes')], [1, 3]);
  assert.deepEqual([qtd(b['poupar-energia'], 'medidor_geral'), qtd(b['poupar-energia'], 'disjuntor_protecoes')], [1, 0]);
  // Aceite, entra no pedido como linha da melhoria (é a melhoria que os traz).
  assert.equal(mudarMelhoria(manter, 'poupar-energia', true), true);
  const aceites = calcularMelhorias(manter, CATALOGO, {}).filter((m) => m.aceite);
  assert.deepEqual(aceites.flatMap((m) => m.linhas).filter((l) => l.chave === 'disjuntor_protecoes').map((l) => [l.qtd, l.grupo]), [[3, 'melhoria']]);
});
