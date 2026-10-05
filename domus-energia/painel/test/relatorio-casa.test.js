// Relatório grátis da casa (web/simulador/relatorio-casa.js; decisão do dono, 2026-10-05): números, potência,
// circuitos que a casa pede e pontos a rever, tirados da planta — e os mesmos blocos no PDF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analiseDaCasa } from '../../web/simulador/relatorio-casa.js';
import { blocosRelatorio } from '../../web/simulador/imprimir.js';

const div = (id, nome, x, largura = 400, altura = 300) => ({ id, nome, x_cm: x, y_cm: 0, largura_cm: largura, altura_cm: altura });
const el = (id, tipo, divisao, props = {}) => ({ id, tipo, divisao, x_cm: 10, y_cm: 10, props });
const PLANTA = {
  divisoes: [div('d1', 'Cozinha', 0), div('d2', 'Sala', 400, 500, 400), div('d3', 'Casa de banho', 900, 200, 200)],
  elementos: [
    el('i1', 'interruptor', 'd1', { botoes: 1, inteligente: true }), el('i2', 'interruptor', 'd2', { botoes: 2 }),
    el('t1', 'tomada', 'd1'), el('t2', 'tomada', 'd2', { caixas: 2, dupla: true }), el('t3', 'tomada', 'd3'),
    el('m1', 'maquina', 'd1', { modelo: 'placa' }), el('m2', 'maquina', 'd1', { modelo: 'forno' }),
    el('m3', 'maquina', 'd1', { modelo: 'frigorifico' }), el('m4', 'maquina', 'd1', { modelo: 'micro_ondas' }),
  ],
};

test('a casa em números: área, divisões, interruptores, tomadas (e pontos), máquinas e os que já são inteligentes', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 6.9 }, 6.9);
  assert.deepEqual(Object.fromEntries(a.numeros), { 'Área': '36 m²', 'Divisões': '3', Interruptores: '2', Tomadas: '3 (4 pontos)', 'Máquinas e aparelhos': '4', 'Já inteligentes': '1' });
});

test('a potência chega? compara a contratada com a sugerida e soma as máquinas grandes', () => {
  const chega = analiseDaCasa(PLANTA, { potencia_contratada_kva: 10.35 }, 6.9).potencia;
  assert.deepEqual([chega.estado, chega.titulo], ['chega', 'A potência contratada chega']);
  const curta = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9).potencia;
  assert.equal(curta.estado, 'curta');
  assert.match(curta.texto[0], /Tem 3,45 kVA contratados; para o que a casa tem sugerimos 6,9 kVA\./);
  assert.match(curta.texto[1], /2 máquinas grandes \(placa de cozinha, forno\) somam \d+ \d{3} W, mais do que os 3 450 W do contrato/);
  assert.equal(analiseDaCasa(PLANTA, {}, null).potencia.estado, 'especial');
  assert.equal(analiseDaCasa(PLANTA, {}, 6.9).potencia.contratada_kva, 6.9, 'sem potência escolhida: 6,9 kVA');
});

test('circuitos que a casa pede: tomadas, zonas húmidas à parte e um circuito por máquina grande; sem luzes, avisa', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 6.9 }, 6.9);
  assert.deepEqual(a.circuitos.map((c) => c.codigo), ['C2', 'C5', 'C3', 'C3']);
  assert.deepEqual(a.circuitos[2], { codigo: 'C3', nome: 'Placa de cozinha', divisoes: 'Cozinha', disjuntor: '25 A', cabo: '6 mm²' });
  assert.match(a.notaCircuitos, /Falta a iluminação/);
  assert.equal(analiseDaCasa({ ...PLANTA, elementos: [...PLANTA.elementos, el('l1', 'luz', 'd2')] }, {}, 6.9).notaCircuitos, null);
});

test('pontos a rever: mais aparelhos do que tomadas, zonas húmidas, circuito próprio e potência curta; casa vazia não dá erro', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  assert.ok(a.rever.some((t) => /^Cozinha: 2 aparelhos para 1 ponto de tomada/.test(t)));
  assert.ok(a.rever.some((t) => /^Casa de banho: é zona húmida/.test(t)));
  assert.ok(a.rever.some((t) => /^Placa de cozinha, Forno: cada uma deve ter um circuito só para ela/.test(t)));
  assert.ok(a.rever.some((t) => /^Potência contratada: 3,45 kVA para uma casa que pede 6,9 kVA\.$/.test(t)));
  assert.ok(!a.rever.some((t) => /^Sala/.test(t)), 'a sala não tem nada a assinalar');
  const vazia = analiseDaCasa({ divisoes: [], elementos: [] }, {}, 3.45);
  assert.deepEqual([vazia.circuitos, vazia.rever, vazia.numeros[0][1]], [[], [], '0 m²']);
  assert.doesNotThrow(() => analiseDaCasa(null, null, undefined));
});

test('PDF: os quatro blocos entram no relatório básico; sem análise (relatórios antigos) fica como estava', () => {
  const analise = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  const b = blocosRelatorio({ casa: 'Apartamento T2', divisoes: [], quadro: [], potencia: 'x', analise });
  const seccoes = b.filter((x) => x.tipo === 'seccao').map((x) => x.texto);
  assert.deepEqual(seccoes, ['A casa', 'Divisões', 'A casa em números', 'A potência contratada pode ser curta', 'Circuitos que esta casa pede', 'Pontos a rever']);
  assert.ok(b.some((x) => x.tipo === 'item' && /^C3 · Placa de cozinha \(Cozinha\): disjuntor de 25 A, cabo de 6 mm²$/.test(x.texto)));
  assert.equal(blocosRelatorio({ casa: 'x', divisoes: [], quadro: [] }).filter((x) => x.tipo === 'seccao').length, 3);
});

test('quadro sugerido: geral pela potência, um diferencial de 30 mA por grupo com os seus disjuntores a seguir e 25 % de folga', async () => {
  const { normalizarEsquema } = await import('../../web/simulador/quadro-desenho.js');
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  const q = a.esquema;
  assert.equal(q.disjuntor_geral.amperes, 32, '6,9 kVA a 230 V = 30 A → 32 A');
  assert.deepEqual(q.diferenciais, [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }]);
  assert.deepEqual(q.disjuntores.map((d) => d.amperes).sort((x, y) => x - y), [16, 16, 25, 25]);
  assert.equal(q.ordem[0], 'geral');
  assert.equal(q.ordem[1], 'diferencial:0');
  assert.ok(q.ordem.indexOf('diferencial:1') > q.ordem.indexOf('disjuntor:0'), 'cada diferencial vem antes dos seus disjuntores');
  // 2 (geral) + 2×2 (diferenciais) + 4 (disjuntores) = 10 módulos → quadro de 18 (25 % livres), 8 livres.
  assert.deepEqual([q.tamanho, q.modulos_livres, q.ordem.filter((x) => x === 'livre').length], [18, 8, 8]);
  assert.match(q.resumo, /^Quadro de 18 módulos: disjuntor geral de 32 A, 2 diferenciais de 30 mA, 4 disjuntores e 8 módulos livres\.$/);
  const n = normalizarEsquema(q);
  assert.deepEqual([n.disjuntores.length, n.diferenciais.length, n.ordem.length], [4, 2, q.ordem.length], 'o desenhador aceita-o tal e qual');
  assert.equal(analiseDaCasa({ divisoes: [], elementos: [] }, {}, 3.45).esquema, null, 'sem circuitos não há quadro');
  assert.equal(analiseDaCasa(PLANTA, { potencia_contratada_kva: 10.35 }, 6.9).esquema.disjuntor_geral.amperes, 50, 'a contratada maior manda: 10,35 kVA → 50 A');
});
