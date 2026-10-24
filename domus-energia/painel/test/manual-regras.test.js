// Coerência "programa vs manual" (decisões do dono, 2026-10-24): onde o programa dava outro valor técnico, segue o manual
// de instalações BT da empresa (docs/SIMULADOR-ORCAMENTO.md §0 "Manual de instalações BT"). Um teste por regra mudada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiteW, amperesMaquina, seccaoCabo, circuitoProprio, sugerirCircuitos, avisosCircuito, MODELOS } from '../../web/simulador/regras.js';
import { tamanhoQuadro, dividirZonas, opcoesCircuitos, potenciaSugerida, minimoRtiebt, MAX_MONO_KVA, avisosProtecoes } from '../../web/simulador/quadro.js';
import { potenciaOmissao, estadoNovo } from '../../web/simulador/estado.js';

const linha = (nome, extra = {}) => ({ id: nome, nome, piso: 0, luzes: 0, tomadas: 0, maquinas: [], interruptores: [], ...extra });

test('IB ≤ In (6.2): 3 680 W num circuito de 16 A; o termoacumulador de 3 000 W fica nos 16 A (C11)', () => {
  assert.equal(limiteW(16), 3680);
  assert.equal(amperesMaquina({ modelo: 'termoacumulador', potencia_w: 3000 }), 16);
  assert.equal(amperesMaquina({ modelo: 'maquina_secar', potencia_w: 3000 }), 16);
  assert.equal(avisosCircuito({ n: 1, tipo: 'tomadas', amperes: 16, itens: { luzes: 0, tomadas: 1, maquinas: [{ modelo: 'outro', potencia_w: 1800 }, { modelo: 'outro', potencia_w: 1800 }] } }).length, 0, '3 600 W em 16 A não avisa');
});

test('placa 25 A / 4 mm², forno 16 A / 2,5 mm², carregador 40 A / 6 mm², iluminação exterior com circuito próprio de 10 A (2.2, 3.2, 13.6)', () => {
  assert.deepEqual([amperesMaquina({ modelo: 'placa', potencia_w: 7200 }), seccaoCabo(25)], [25, 4]);
  assert.deepEqual([amperesMaquina({ modelo: 'forno', potencia_w: 2500 }), seccaoCabo(16)], [16, 2.5]);
  assert.deepEqual([amperesMaquina({ modelo: 'carregador_ve', potencia_w: 7400 }), seccaoCabo(40)], [40, 6]);
  assert.equal(seccaoCabo(32), 6);
  assert.ok(circuitoProprio({ modelo: 'iluminacao_jardim', potencia_w: 150 }));
  assert.equal(amperesMaquina({ modelo: 'iluminacao_jardim', potencia_w: 150 }), 10);
  assert.deepEqual([MODELOS.maquina_loica.w, MODELOS.secador.w], [2000, 1600]);
  const forno = { n: 1, tipo: 'maquina', amperes: 16, itens: { luzes: 0, tomadas: 0, maquinas: [{ modelo: 'forno', potencia_w: 2500 }] } };
  assert.deepEqual(avisosCircuito(forno), [], 'o forno a 16 A já não pede 25 A');
  const placa = { ...forno, itens: { ...forno.itens, maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } };
  assert.ok(avisosCircuito(placa).some((a) => /Para a placa recomendamos um circuito de 25 A com cabo de 4 mm²/.test(a)));
});

test('cozinha com circuito de tomadas exclusivo; dia e noite separados a partir do T1 (3.2)', () => {
  const cont = [linha('Sala', { tomadas: 3, luzes: 1 }), linha('Quarto', { tomadas: 2, luzes: 1 }), linha('Cozinha', { tomadas: 3, luzes: 1 }), linha('Casa de banho', { tomadas: 1, luzes: 1 })];
  const c = sugerirCircuitos(cont, opcoesCircuitos({ tipo: 'apartamento', tipologia: 'T1', quartos: 1 }));
  assert.deepEqual(c.filter((x) => x.zona_humida).map((x) => [x.nome, x.divisoes]), [['Tomadas cozinha', ['Cozinha']], ['Tomadas zonas húmidas', ['Casa de banho']]]);
  assert.equal(c.filter((x) => x.tipo === 'iluminacao').length, 2, 'T1: pelo menos dois circuitos de iluminação');
  assert.deepEqual([dividirZonas({ tipo: 'apartamento', tipologia: 'T0', quartos: 0 }), dividirZonas({ tipo: 'apartamento', tipologia: 'T1', quartos: 1 })], [false, true]);
});

test('quadro com 20 % de reserva (3.3, exemplo 3.1: 20 ocupados → 24 módulos)', () => {
  assert.deepEqual([10, 11, 15, 16, 20, 21, 30, 31, 40, 41].map(tamanhoQuadro), [12, 18, 18, 24, 24, 36, 36, 48, 48, null]);
});

test('potência (2.5): monofásica até 10,35 kVA; 3,45 kVA com 1 compartimento; T1 sugere 6,9 kVA; exemplo 2.1 do T2 → 10,35 kVA', () => {
  assert.equal(MAX_MONO_KVA, 10.35);
  assert.equal(minimoRtiebt(1), 3.45);
  // T0 só com kitchenette é 1 compartimento (3,45); com a cozinha à parte são 2 (6,9; auditoria de 2026-10-24).
  assert.deepEqual([potenciaOmissao({ tipologia: 'T0', extras: { kitnet: true } }), potenciaOmissao({ tipologia: 'T0' }), potenciaOmissao({ tipologia: 'T1' })], [3.45, 6.9, 6.9]);
  // Exemplo 2.1: 12 pontos de luz, 3 circuitos de tomadas, placa 7 200, forno 3 000, lavar 2 200, loiça 2 200, termo 2 000, ar
  // condicionado 1 200 (o manual divide-o por 0,9; aqui kVA ≈ kW) × 0,4 → ≈ 9,4 kVA → 10,35 kVA.
  const m = (modelo, w) => ({ modelo, potencia_w: w });
  const circ = [
    { tipo: 'iluminacao', itens: { luzes: 6, tomadas: 0, maquinas: [] } }, { tipo: 'iluminacao', itens: { luzes: 6, tomadas: 0, maquinas: [] } },
    ...[0, 1, 2].map(() => ({ tipo: 'tomadas', itens: { luzes: 0, tomadas: 5, maquinas: [] } })),
    ...[m('placa', 7200), m('forno', 3000), m('maquina_lavar', 2200), m('maquina_loica', 2200), m('termoacumulador', 2000), m('ar_condicionado', 1200)].map((x) => ({ tipo: 'maquina', itens: { luzes: 0, tomadas: 0, maquinas: [x] } })),
  ];
  const p = potenciaSugerida(circ, 4, true);
  assert.deepEqual([p.carga_w, p.kva, p.trifasica], [9400, 10.35, false]);
  assert.equal(potenciaSugerida(circ, null, false).kva, 10.35, 'serviços e industrial: o método antigo');
  // Acima de 10,35 kVA: o aviso da ligação trifásica.
  const e = estadoNovo();
  e.casa = { ...e.casa, tipo: 'moradia', tipologia: 'T3', fases: 'mono', potencia_contratada_kva: 13.8 };
  e.quadro.circuitos = [...circ, { tipo: 'maquina', itens: { luzes: 0, tomadas: 0, maquinas: [m('carregador_ve', 7400)] } }].map((c, i) => ({ n: i + 1, amperes: 16, nome: '', divisoes: [], inteligente: false, medir: false, zona_humida: false, ...c }));
  assert.ok(avisosProtecoes(e).some((a) => /a ligação deve ser trifásica: acima de 10,35 kVA só é monofásica com acordo da E-REDES/.test(a)));
});

// ---- Decisões do dono de 2026-10-24 (segunda ronda): compartimentos, tomadas, 63 A, tipo 1+2, estores e portão.
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { contarPlanta, divisoesDaContagem } from '../../web/simulador/regras.js';
import { compartimentosRtiebt, pedidosQuadro, resumoQuadro, amperesDiferencial } from '../../web/simulador/quadro.js';
import { analiseDaCasa } from '../../web/simulador/relatorio-casa.js';
import { pedidosPontosNovos } from '../../web/simulador/acoes.js';

function casaDe(tipologia, quartos, casasBanho, extra = {}, maquinas = []) {
  const e = estadoNovo();
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia, quartos, casas_banho: casasBanho, salas: 1, extras: { ...e.casa.extras, ...(extra.extras ?? {}) }, ...(extra.casa ?? {}) };
  e.planta = plantaDaCasa(e.casa, maquinas);
  e.plantaFase = 'tudo';
  const cont = contarPlanta(e.planta);
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, opcoesCircuitos(e.casa));
  return e;
}
const qtdDe = (ped, chave) => ped.filter((p) => p.chave === chave).reduce((s, p) => s + p.qtd, 0);

test('compartimentos: só quartos, salas e cozinha (um T3 tem 5, exemplo 14.1)', () => {
  const t3 = casaDe('T3', 3, 2, { extras: { corredor: true, lavandaria: true, garagem: true, varanda: true } });
  assert.equal(compartimentosRtiebt(t3), 5);
  assert.equal(compartimentosRtiebt(casaDe('T5+', 6, 3, { casa: { quartos: 6 } })), 8, '6 quartos + sala + cozinha: mais de 6 → 10,35 kVA');
});

test('tomadas da planta automática pelos mínimos do manual (2.3): sala 5, quarto 4, cozinha 4, casa de banho 1, corredor 1, garagem 2', () => {
  const e = casaDe('T2', 2, 1, { extras: { corredor: true, garagem: true } });
  const nomes = new Map(e.planta.divisoes.map((d) => [d.id, d.nome]));
  const conta = {};
  for (const x of e.planta.elementos.filter((x) => x.tipo === 'tomada')) conta[nomes.get(x.divisao)] = (conta[nomes.get(x.divisao)] ?? 0) + 1;
  assert.deepEqual(conta, { Sala: 5, Cozinha: 4, Corredor: 1, Quarto: 4, 'Quarto 2': 4, 'Casa de banho': 1, Garagem: 2 });
  // Nenhuma tomada a menos de 50 cm de outro aparelho do piso (também do outro lado de uma parede partilhada).
  const els = e.planta.elementos.filter((x) => ['tomada', 'interruptor', 'porta'].includes(x.tipo));
  for (const t of els.filter((x) => x.tipo === 'tomada')) {
    for (const o of els) if (o !== t) assert.ok(Math.hypot(o.x_cm - t.x_cm, o.y_cm - t.y_cm) >= 50, `${nomes.get(t.divisao)} ${t.x_cm},${t.y_cm}`);
  }
});

test('diferenciais de 63 A a partir de 10,35 kVA (anexo A.2); abaixo, 40 A', () => {
  assert.deepEqual([amperesDiferencial({ potencia_contratada_kva: 6.9 }, { kva: 6.9 }), amperesDiferencial({ potencia_contratada_kva: 10.35 }, { kva: 6.9 }), amperesDiferencial({ potencia_contratada_kva: 6.9 }, { kva: 13.8 }), amperesDiferencial({}, { kva: null })], [40, 63, 63, 63]);
  const e = casaDe('T2', 2, 1, { casa: { potencia_contratada_kva: 10.35 } });
  const ped = pedidosQuadro(e);
  assert.equal(qtdDe(ped, 'diferencial_63'), resumoQuadro(e).grupos.length);
  assert.equal(qtdDe(ped, 'diferencial_tipo_a'), 0);
  assert.match(resumoQuadro(e).linhas.find((l) => l.chave === 'diferencial').nome, /^Diferencial 63 A \/ 30 mA tipo A$/);
  assert.equal(qtdDe(pedidosQuadro(casaDe('T2', 2, 1)), 'diferencial_63'), 0);
});

test('para-raios "sim": o descarregador de tipo 1+2 no preço, em vez do tipo 2', () => {
  const e = casaDe('T2', 2, 1);
  e.quadro.para_raios = 'sim';
  const ped = pedidosQuadro(e);
  assert.deepEqual([qtdDe(ped, 'descarregador_t1'), qtdDe(ped, 'descarregador')], [1, 0]);
  assert.ok(resumoQuadro(e).linhas.some((l) => /tipo 1\+2/.test(l.nome)));
  e.quadro.para_raios = 'nao';
  assert.deepEqual([qtdDe(pedidosQuadro(e), 'descarregador_t1'), qtdDe(pedidosQuadro(e), 'descarregador')], [0, 1]);
});

test('estores motorizados: um circuito próprio de 10 A / 1,5 mm² (C13), sem disjuntor inteligente; portão: circuito próprio de 16 A com linha dedicada (C14)', () => {
  const e = casaDe('T2', 2, 1, {}, ['portao']);
  const sala = e.planta.divisoes.find((d) => d.nome === 'Sala');
  for (const k of [1, 2]) e.planta.elementos.push({ id: `j${k}`, tipo: 'janela', x_cm: sala.x_cm + 100 * k, y_cm: sala.y_cm + 10, rot: 0, piso: 0, divisao: sala.id, props: { estore: true, motorizado: true } });
  const c = sugerirCircuitos(contarPlanta(e.planta), opcoesCircuitos(e.casa));
  const est = c.find((x) => x.nome === 'Estores elétricos');
  assert.deepEqual([est.amperes, est.inteligente, est.medir, est.divisoes, est.itens.maquinas[0].potencia_w], [10, false, false, ['Sala'], 300]);
  const portao = c.find((x) => x.itens.maquinas.some((m) => m.modelo === 'portao'));
  assert.deepEqual([portao.tipo, portao.amperes], ['maquina', 16]);
  assert.deepEqual(pedidosPontosNovos({ elementos: [{ tipo: 'maquina', props: { modelo: 'portao' }, acao: 'novo' }] }, ['automatizar']), [{ chave: 'linha_dedicada', qtd: 1 }]);
  // O relatório: não são "máquinas grandes"; têm circuito próprio e a cor deles (iluminação exterior: a da iluminação).
  const a = analiseDaCasa(e.planta, e.casa, 6.9);
  assert.ok(!a.potencia.texto.some((t) => /portão/i.test(t)), 'o portão não soma nas máquinas grandes');
  assert.ok(a.rever.some((t) => /^Portão automático, Estores elétricos: têm circuito próprio no quadro/.test(t)));
  assert.ok(a.esquema.etiquetas.some((x) => x.cor === 'proprio'));
  assert.ok(a.esquema.cores.some(([k, n]) => k === 'proprio' && n === 'Estores e portão'));
});
