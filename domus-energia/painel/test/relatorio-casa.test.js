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
  assert.deepEqual(seccoes, ['A casa', 'Divisões', 'A casa em números', 'A potência contratada pode ser curta', 'O que pode ligar ao mesmo tempo', 'Consumo estimado por mês', 'Circuitos que esta casa pede', 'Pontos a rever', 'O que fazíamos primeiro nesta casa']);
  assert.ok(b.some((x) => x.tipo === 'item' && /^C3 · Placa de cozinha \(Cozinha\): disjuntor de 25 A, cabo de 6 mm²$/.test(x.texto)));
  assert.equal(blocosRelatorio({ casa: 'x', divisoes: [], quadro: [] }).filter((x) => x.tipo === 'seccao').length, 3);
});

test('quadro ideal, com proteção completa: geral Wi-Fi pela potência, descarregador, relé de tensão e medidor, um diferencial de 30 mA por grupo com os seus disjuntores a seguir (AFDD na sala) e 25 % de folga', async () => {
  const { normalizarEsquema } = await import('../../web/simulador/quadro-desenho.js');
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  const q = a.esquema;
  assert.deepEqual(q.disjuntor_geral, { amperes: 32, wifi: true }, '6,9 kVA a 230 V = 30 A → 32 A; proteção completa: geral Wi-Fi');
  assert.deepEqual(q.protecoes, ['descarregador', 'rele_tensao', 'medidor_geral']);
  assert.deepEqual(q.ordem.slice(0, 5), ['geral', 'descarregador', 'rele_tensao', 'medidor_geral', 'diferencial:0']);
  assert.deepEqual(q.disjuntores.filter((d) => d.afdd), [{ amperes: 16, afdd: true }], 'AFDD só no circuito das tomadas da sala');
  assert.equal(a.circuitos[0].disjuntor, '16 A com AFDD');
  assert.deepEqual(q.diferenciais, [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }]);
  assert.deepEqual(q.disjuntores.map((d) => d.amperes).sort((x, y) => x - y), [16, 16, 25, 25]);
  assert.ok(q.ordem.indexOf('diferencial:1') > q.ordem.indexOf('disjuntor:0'), 'cada diferencial vem antes dos seus disjuntores');
  // 2 (geral) + 3×2 (proteções) + 2×2 (diferenciais) + 2 (AFDD) + 3 (disjuntores) = 17 módulos → quadro de 24 (25 % livres), 7 livres.
  assert.deepEqual([q.tamanho, q.modulos_livres, q.ordem.filter((x) => x === 'livre').length], [24, 7, 7]);
  assert.match(q.resumo, /^Quadro de 24 módulos, com proteção completa: disjuntor geral Wi-Fi de 32 A, descarregador de sobretensões, proteção de sobretensão e subtensão, medidor de energia, 2 diferenciais de 30 mA, 4 disjuntores \(1 com AFDD\) e 7 módulos livres\.$/);
  const n = normalizarEsquema(q);
  assert.deepEqual([n.disjuntores, n.diferenciais.length, n.protecoes, n.ordem, n.disjuntor_geral], [q.disjuntores, 2, q.protecoes, q.ordem, q.disjuntor_geral], 'o desenhador aceita-o tal e qual');
  const { esquemaQuadro } = await import('../src/validar.js');
  // Só para o desenho (não se gravam): a etiqueta e a cor de cada disjuntor, uma fila por diferencial, a legenda e as cores.
  assert.deepEqual(q.etiquetas, [{ texto: 'C2 Sala', cor: 'tomadas' }, { texto: 'C3 Placa de cozinha', cor: 'maquina' }, { texto: 'C3 Forno', cor: 'maquina' }, { texto: 'C5 Cozinha, Casa de banho', cor: 'humida' }]);
  assert.equal(q.fila_por_diferencial, true);
  assert.deepEqual(q.cores, [['tomadas', 'Tomadas'], ['humida', 'Tomadas de zonas húmidas'], ['maquina', 'Máquinas grandes']]);
  assert.deepEqual(q.legenda.map((x) => x[0]), ['Geral Wi-Fi', 'Descarregador', 'Relé de tensão', 'Medidor', 'Diferencial de 30 mA', 'Disjuntor', 'AFDD']);
  const { tamanho: _t, resumo: _r, etiquetas: _e, fila_por_diferencial: _f, legenda: _l, cores: _c, ...gravavel } = q;
  assert.doesNotThrow(() => esquemaQuadro(gravavel), 'e o servidor também');
  assert.equal(analiseDaCasa({ divisoes: [], elementos: [] }, {}, 3.45).esquema, null, 'sem circuitos não há quadro');
  assert.equal(analiseDaCasa(PLANTA, { potencia_contratada_kva: 10.35 }, 6.9).esquema.disjuntor_geral.amperes, 50, 'a contratada maior manda: 10,35 kVA → 50 A');
});

test('ao mesmo tempo, consumo e próximo passo: combinações contra o contrato, estimativa por valores típicos e até 3 trabalhos', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 6.9 }, 6.9);
  // Placa 7 200 W, forno 2 500 W, micro-ondas 1 200 W (o frigorífico, 150 W, não entra); contrato 6 900 W.
  assert.equal(a.simultaneo.limite, '6,9 kVA (6 900 W)');
  assert.deepEqual(a.simultaneo.linhas, [
    { estado: 'aguenta', nomes: 'Forno + Micro-ondas', w: '3 700 W' },
    { estado: 'dispara', nomes: 'Placa de cozinha + Forno', w: '9 700 W' },
    { estado: 'dispara', nomes: 'Placa de cozinha + Forno + Micro-ondas', w: '10 900 W' },
  ]);
  // 40 + 18 + 25 + 5 (aparelhos) + 20 + 36 m² × 0,3 ≈ 31 (base) = 119 → 120 kWh; × 0,24 € ≈ 30 €.
  assert.deepEqual([a.consumo.kwh, a.consumo.euros, a.consumo.maiores], [120, 30, [['Placa de cozinha', '40 kWh'], ['Frigorífico', '25 kWh'], ['Forno', '18 kWh']]]);
  assert.match(a.consumo.nota, /^Estimativa por valores típicos/);
  assert.deepEqual(a.proximo, ['Pôr o quadro como o do desenho, com a proteção completa.', 'Circuito só para cada máquina grande: placa de cozinha, forno.', 'Mais tomadas em: Cozinha.']);
  const vazia = analiseDaCasa({ divisoes: [], elementos: [] }, {}, 3.45);
  assert.deepEqual([vazia.simultaneo, vazia.consumo, vazia.proximo], [null, null, []]);
});
