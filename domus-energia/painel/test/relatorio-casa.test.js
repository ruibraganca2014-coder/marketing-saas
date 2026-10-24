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
  assert.deepEqual(Object.fromEntries(a.numeros), { 'Área': '36 m²', 'Divisões': '3', Interruptores: '2', Tomadas: '3 (4 pontos)', 'Pontos de luz': '0', 'Máquinas e aparelhos': '4', 'Já inteligentes': '1' });
});

test('a potência chega? compara a contratada com a sugerida e soma as máquinas grandes', () => {
  const chega = analiseDaCasa(PLANTA, { potencia_contratada_kva: 10.35 }, 6.9).potencia;
  assert.deepEqual([chega.estado, chega.titulo], ['chega', 'A potência contratada chega']);
  const curta = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9).potencia;
  assert.equal(curta.estado, 'curta');
  // A placa e o forno somam 9 700 W: sugere-se o escalão que os aguenta ligados ao mesmo tempo (10,35 kVA), não só os 6,9 das cargas.
  assert.match(curta.texto[0], /Tem 3,45 kVA contratados; para o que a casa tem sugerimos 10,35 kVA\./);
  assert.match(curta.texto[1], /2 máquinas grandes \(placa de cozinha, forno\) somam \d+ \d{3} W, mais do que os 3 450 W do contrato/);
  assert.equal(analiseDaCasa(PLANTA, {}, null).potencia.estado, 'especial');
  assert.equal(analiseDaCasa(PLANTA, {}, 6.9).potencia.contratada_kva, 6.9, 'sem potência escolhida: 6,9 kVA');
});

test('decisão do dono (2026-10-24): uma máquina acima do contrato, ou as grandes todas juntas, nunca "chega"', () => {
  // Carregador de 7 400 W com 6,9 kVA contratados e as cargas a pedirem 6,9: curta, sugere 10,35 kVA.
  const ve = { divisoes: [div('g', 'Garagem', 0)], elementos: [el('c', 'maquina', 'g', { modelo: 'carregador_ve' })] };
  const p = analiseDaCasa(ve, { potencia_contratada_kva: 6.9 }, 6.9).potencia;
  assert.deepEqual([p.estado, p.titulo, p.sugerida_kva], ['curta', 'A potência contratada pode ser curta', 10.35]);
  assert.match(p.texto[0], /sugerimos 10,35 kVA\./);
  assert.equal(p.texto[1], 'A máquina grande (carregador de carro elétrico) tem 7 400 W, mais do que os 6 900 W do contrato: ligada, a luz vai abaixo.');
  assert.doesNotMatch(p.texto.join(' '), /chega/);
  // A placa e o forno (9 700 W) com 6,9 kVA: também curta; com 10,35 kVA chega.
  assert.equal(analiseDaCasa(PLANTA, { potencia_contratada_kva: 6.9 }, 6.9).potencia.estado, 'curta');
  assert.equal(analiseDaCasa(PLANTA, { potencia_contratada_kva: 10.35 }, 6.9).potencia.estado, 'chega');
  // Sem a sugestão das cargas (sem dados), a máquina acima do contrato já dá "curta".
  assert.equal(analiseDaCasa(ve, { potencia_contratada_kva: 6.9 }, undefined).potencia.estado, 'curta');
  // O desenho do quadro com os diferenciais do pedido: o do carregador de 40 A (manual 13.6) mesmo com 10,35 kVA (63 A nos
  // outros); num industrial trifásico de 6,9 kVA (geral 16 A) os diferenciais são de 40 A, como no preço (não 25 A).
  const q = analiseDaCasa({ ...ve, elementos: [...ve.elementos, el('t', 'tomada', 'g')] }, { potencia_contratada_kva: 10.35 }, 10.35).esquema;
  assert.deepEqual(q.diferenciais.map((d) => d.amperes).sort((a, b) => a - b), [40, 63]);
  const ind = analiseDaCasa({ divisoes: [div('n', 'Nave', 0, 1700, 1300)], elementos: [el('t', 'tomada', 'n')] }, { tipo: 'industrial', fases: 'tri', potencia_contratada_kva: 6.9 }, 3.45).esquema;
  assert.deepEqual([ind.disjuntor_geral.amperes, ind.diferenciais.map((d) => d.amperes)], [16, [40]]);
});

// Manual de instalações BT (2026-10-24, 3.2): as tomadas da cozinha num circuito só delas; placa 25 A / 4 mm², forno 16 A / 2,5 mm².
test('circuitos que a casa pede: tomadas, a cozinha e as outras zonas húmidas à parte e um circuito por máquina grande; sem luzes, avisa', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 6.9 }, 6.9);
  assert.deepEqual(a.circuitos.map((c) => c.codigo), ['C2', 'C5', 'C5', 'C3', 'C3']);
  assert.deepEqual(a.circuitos.slice(1, 3).map((c) => [c.nome, c.divisoes]), [['Tomadas cozinha', 'Cozinha'], ['Tomadas zonas húmidas', 'Casa de banho']]);
  assert.deepEqual(a.circuitos[3], { codigo: 'C3', nome: 'Placa de cozinha', divisoes: 'Cozinha', disjuntor: '25 A', cabo: '4 mm²' });
  assert.deepEqual(a.circuitos[4], { codigo: 'C3', nome: 'Forno', divisoes: 'Cozinha', disjuntor: '16 A', cabo: '2,5 mm²' });
  assert.match(a.notaCircuitos, /Falta a iluminação/);
  assert.equal(analiseDaCasa({ ...PLANTA, elementos: [...PLANTA.elementos, el('l1', 'luz', 'd2')] }, {}, 6.9).notaCircuitos, null);
});

test('pontos a rever: mais aparelhos do que tomadas, zonas húmidas, circuito próprio e potência curta; casa vazia não dá erro', () => {
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  assert.ok(a.rever.some((t) => /^Cozinha: 2 aparelhos para 1 ponto de tomada/.test(t)));
  assert.ok(a.rever.some((t) => /^Casa de banho: é zona húmida/.test(t)));
  assert.ok(a.rever.some((t) => /^Placa de cozinha, Forno: cada máquina precisa de um circuito próprio no quadro\.$/.test(t)));
  assert.ok(a.rever.some((t) => /^Potência contratada: 3,45 kVA para uma casa que pede 10,35 kVA\.$/.test(t)));
  assert.ok(!a.rever.some((t) => /^Sala/.test(t)), 'a sala não tem nada a assinalar');
  const vazia = analiseDaCasa({ divisoes: [], elementos: [] }, {}, 3.45);
  assert.deepEqual([vazia.circuitos, vazia.rever, vazia.numeros[0][1]], [[], [], '0 m²']);
  assert.doesNotThrow(() => analiseDaCasa(null, null, undefined));
});

test('PDF: os quatro blocos entram no relatório básico; sem análise (relatórios antigos) fica como estava', () => {
  const analise = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  const b = blocosRelatorio({ casa: 'Apartamento T2', divisoes: [], quadro: [], potencia: 'x', analise });
  const seccoes = b.filter((x) => x.tipo === 'seccao').map((x) => x.texto);
  assert.deepEqual(seccoes, ['A casa', 'A potência contratada pode ser curta', 'O que pode ligar ao mesmo tempo', 'Pontos a rever', 'O que fazíamos primeiro nesta casa', 'Quadro ideal e circuitos', 'Consumo estimado por mês', 'Divisões em pormenor']);
  // Do importante para o pormenor: o quadro ideal começa numa folha nova, com o desenho e os circuitos em tabela.
  const tipos = b.map((x) => x.tipo);
  assert.ok(tipos.indexOf('quebra') < tipos.indexOf('quadro') && tipos.indexOf('quadro') < tipos.indexOf('tabela'));
  const tabela = b.find((x) => x.tipo === 'tabela');
  assert.deepEqual(tabela.cabecalho, ['Circuito', 'Divisões', 'Disjuntor', 'Cabo']);
  assert.deepEqual(tabela.linhas[3], ['Placa de cozinha', 'Cozinha', '25 A', '4 mm²']);
  assert.ok(!tipos.includes('planta'), 'sem planta nos dados não há bloco da planta');
  assert.deepEqual(blocosRelatorio({ casa: 'x', divisoes: [], analise, planta: PLANTA, pisos: 2 }).filter((x) => x.tipo === 'planta').map((x) => x.piso), [0, 1]);
  assert.equal(blocosRelatorio({ casa: 'x', divisoes: [], quadro: [] }).filter((x) => x.tipo === 'seccao').length, 3);
});

test('quadro ideal, com proteção completa: geral Wi-Fi pela potência, descarregador, relé de tensão e medidor, um diferencial de 30 mA por grupo com os seus disjuntores a seguir (AFDD na sala) e 20 % de reserva', async () => {
  const { normalizarEsquema } = await import('../../web/simulador/quadro-desenho.js');
  const a = analiseDaCasa(PLANTA, { potencia_contratada_kva: 3.45 }, 6.9);
  const q = a.esquema;
  assert.deepEqual(q.disjuntor_geral, { amperes: 32, wifi: true }, '6,9 kVA a 230 V = 30 A → 32 A; proteção completa: geral Wi-Fi');
  assert.deepEqual(q.protecoes, ['descarregador', 'rele_tensao', 'medidor_geral']);
  assert.deepEqual(q.ordem.slice(0, 5), ['geral', 'descarregador', 'rele_tensao', 'medidor_geral', 'diferencial:0']);
  assert.deepEqual(q.disjuntores.filter((d) => d.afdd), [{ amperes: 16, afdd: true }], 'AFDD só no circuito das tomadas da sala');
  assert.equal(a.circuitos[0].disjuntor, '16 A com AFDD');
  assert.deepEqual(q.diferenciais, [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }]);
  assert.deepEqual(q.disjuntores.map((d) => d.amperes).sort((x, y) => x - y), [16, 16, 16, 16, 25]);
  assert.ok(q.ordem.indexOf('diferencial:1') > q.ordem.indexOf('disjuntor:0'), 'cada diferencial vem antes dos seus disjuntores');
  // 2 (geral) + 3×2 (proteções) + 2×2 (diferenciais) + 2 (AFDD) + 4 (disjuntores) = 18 módulos → × 1,2 = 21,6 → quadro de 24 (20 % de reserva), 6 livres.
  assert.deepEqual([q.tamanho, q.modulos_livres, q.ordem.filter((x) => x === 'livre').length], [24, 6, 6]);
  assert.match(q.resumo, /^Quadro de 24 módulos, com proteção completa: disjuntor geral Wi-Fi de 32 A, descarregador de sobretensões, proteção de sobretensão e subtensão, medidor de energia, 2 diferenciais de 30 mA, 5 disjuntores \(1 com AFDD\) e 6 módulos livres\.$/);
  const n = normalizarEsquema(q);
  assert.deepEqual([n.disjuntores, n.diferenciais.length, n.protecoes, n.ordem, n.disjuntor_geral], [q.disjuntores, 2, q.protecoes, q.ordem, q.disjuntor_geral], 'o desenhador aceita-o tal e qual');
  const { esquemaQuadro } = await import('../src/validar.js');
  // Só para o desenho (não se gravam): a etiqueta e a cor de cada disjuntor, uma fila por diferencial, a legenda e as cores.
  assert.deepEqual(q.etiquetas, [{ texto: 'Sala', cor: 'tomadas' }, { texto: 'Placa de cozinha', cor: 'maquina' }, { texto: 'Forno', cor: 'maquina' }, { texto: 'Cozinha', cor: 'humida' }, { texto: 'Casa de banho', cor: 'humida' }]);
  assert.equal(q.fila_por_diferencial, true);
  assert.deepEqual(q.cores, [['tomadas', 'Tomadas'], ['humida', 'Tomadas de zonas húmidas'], ['maquina', 'Máquinas grandes']]);
  assert.deepEqual(q.legenda.map((x) => x[0]), ['Geral Wi-Fi', 'Descarregador', 'Relé de tensão', 'Medidor', 'Diferencial de 30 mA', 'Disjuntor', 'AFDD']);
  const { tamanho: _t, resumo: _r, etiquetas: _e, fila_por_diferencial: _f, legenda: _l, cores: _c, grande: _g, polos: _p, ...gravavel } = q;
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

test('achados da revisão: trifásico acima de 10,35 kVA (era 13,8 até ao manual de instalações BT), quadro grande sem tamanho inventado, melhor par ao mesmo tempo e consumo mínimo', () => {
  // 20,7 kVA sem "fases": é trifásico (30 A → 32 A), não um geral de 63 A monofásico; as peças de 2 módulos contam 4.
  const tri = analiseDaCasa(PLANTA, { potencia_contratada_kva: 20.7 }, 6.9).esquema;
  assert.deepEqual([tri.disjuntor_geral.amperes, tri.polos], [32, 2]);
  // 2 × (2 + 6 + 4) + 2 (AFDD) + 4 = 30 ocupados: o de 36 leva 30 com a reserva de 20 % → quadro de 36, 6 livres.
  assert.match(tri.resumo, /^Quadro de 36 módulos, trifásico, .* e 6 módulos livres\.$/);
  // Muitas divisões: mais do que cabe num de 48 com folga → não se inventa um tamanho.
  const muitas = { divisoes: Array.from({ length: 12 }, (_, i) => div(`q${i}`, `Quarto ${i + 1}`, i * 400)), elementos: [] };
  for (let i = 0; i < 12; i++) { for (let k = 0; k < 6; k++) muitas.elementos.push(el(`t${i}-${k}`, 'tomada', `q${i}`)); muitas.elementos.push(el(`l${i}`, 'luz', `q${i}`), el(`m${i}`, 'maquina', `q${i}`, { modelo: 'ar_condicionado' })); }
  const g = analiseDaCasa(muitas, { potencia_contratada_kva: 13.8 }, 13.8).esquema;
  assert.equal(g.grande, true);
  assert.match(g.resumo, /^Quadro grande \(\d+ módulos ocupados: mais do que cabe num de 48 com folga, o tamanho confirma-se no local\)/);
  assert.doesNotMatch(g.resumo, /módulos livres/);
  // Forno 2 500 + lavar 2 000 + micro-ondas 1 200 com 3 450 W: o forno não deixa caber mais nada, mas lavar + micro-ondas cabem.
  const p = { divisoes: [div('d1', 'Cozinha', 0)], elementos: [el('m1', 'maquina', 'd1', { modelo: 'forno' }), el('m2', 'maquina', 'd1', { modelo: 'maquina_lavar' }), el('m3', 'maquina', 'd1', { modelo: 'micro_ondas' })] };
  assert.deepEqual(analiseDaCasa(p, { potencia_contratada_kva: 3.45 }, 3.45).simultaneo.linhas[0], { estado: 'aguenta', nomes: 'Máquina de lavar roupa + Micro-ondas', w: '3 200 W' });
  // Só uma campainha, sem divisões: 1 kWh não dá um cartão "0 kWh".
  assert.equal(analiseDaCasa({ divisoes: [], elementos: [el('c1', 'maquina', null, { modelo: 'campainha' })] }, {}, 3.45).consumo, null);
});
