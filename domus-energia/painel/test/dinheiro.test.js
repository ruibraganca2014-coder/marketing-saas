// Simulador, ronda dinheiro (docs/SIMULADOR-ORCAMENTO.md §0 "Ronda dinheiro"; decisões 3, 4, 5 e 9 do dono, 2026-10-02):
// pontos novos de preço fechado com horas dentro, deslocação ida e volta por dia de obra (no máximo 5 dias), linha
// dedicada até 15 m (140 € numa casa que já existe, 70 € em instalação nova, 390 € no carregador, com tudo), obra mínima
// e a migração 24 do catálogo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb, migrar, versaoEsquema, MIGRACOES } from '../src/db.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS, SEMENTES_PONTOS_20, SEMENTES_DINHEIRO, HORAS_PONTOS } from '../src/catalogo-sementes.js';
import { pontosDoElemento, pedidosDoElemento, pedidosPontosNovos, plantaNovos, plantaInteligentes, perguntaMedicao } from '../../web/simulador/acoes.js';
import { pedidosDaSelecao, calcularPreco, comObraMinima, diasDeObra, textoDias, textoIntervalo, precoFechado, encontrarArtigo, PEDIDOS, CONFIG_OMISSAO } from '../../web/simulador/preco.js';
import { calcularDeslocacao } from '../../web/simulador/deslocacao.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { contarPlanta, divisoesDaContagem, sugerirCircuitos } from '../../web/simulador/regras.js';
import { pedidosQuadro, resumoQuadro } from '../../web/simulador/quadro.js';
import { estadoNovo, normalizarEstado, montarSimulacao } from '../../web/simulador/estado.js';
import { aplicarEntrada } from '../../web/simulador/entrada.js';
import { simulacao as validarSimulacao } from '../src/validar.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS, ...SEMENTES_PONTOS_20, ...SEMENTES_DINHEIRO].filter((a) => a.ativo !== false);
/** O catálogo de antes desta ronda: pontos com 0 horas e sem a marca de preço fechado; sem linhas dedicadas. */
const CATALOGO_ANTES = CATALOGO.filter((a) => !SEMENTES_DINHEIRO.includes(a))
  .map((a) => (HORAS_PONTOS[a.sku] ? { ...a, horas_instalacao: 0, especificacoes: { funcao: a.especificacoes.funcao } } : a));
const qtd = (pedidos, chave) => pedidos.filter((p) => p.chave === chave).reduce((s, p) => s + p.qtd, 0);
const cent = (x) => Math.round(x * 100) / 100;
const MAQ = [{ modelo: 'termoacumulador', qtd: 1, piso: 0 }, { modelo: 'placa', qtd: 1, piso: 0 }, { modelo: 'maquina_lavar', qtd: 1, piso: 0 }];
const T1 = { tipo: 'apartamento', tipologia: 'T1', quartos: 1, casas_banho: 1, salas: 1 };
const T2 = { tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };

/** Casa com a planta desenhada por ela, as divisões e os circuitos (como app.js acertarPedido). */
function casa(c, servico, maquinas = [], mexer = () => {}) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, ...c, extras: { ...e.casa.extras, ...(c.extras ?? {}) } };
  e.planta = plantaDaCasa(e.casa, maquinas);
  e.plantaFase = 'tudo';
  mexer(e);
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, servico), []));
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, {});
  return e;
}
const preco = (e, localidade = 'Lisboa', catalogo = CATALOGO, config = {}) => calcularPreco(pedidosDaSelecao(e), catalogo, config, calcularDeslocacao(localidade, config));

test('pontos de preço fechado: o total do T1 e do T2 fica igual ao cêntimo; as horas sobem com as dos pontos', () => {
  for (const [c, total, horasAntes, horas, dias] of [[T1, 1567.5, 8.25, 18.65, 3], [T2, 1727.5, 8.25, 21.1, 3]]) {
    const e = casa(c, ['nova']);
    const antes = preco(e, 'Lisboa', CATALOGO_ANTES), agora = preco(e);
    assert.equal(antes.total, total, `${c.tipologia} antes`);
    assert.equal(agora.total, total, `${c.tipologia} agora: igual ao cêntimo`);
    assert.deepEqual([agora.min, agora.max], [antes.min, antes.max]);
    assert.equal(antes.horas, horasAntes);
    assert.equal(agora.horas, horas);
    assert.equal(agora.dias, dias);
    // Nada mudou no que o cliente paga à parte: artigos (com os pontos ao preço fechado) e mão de obra fora deles.
    assert.equal(agora.artigos_iva, antes.artigos_iva);
    assert.equal(agora.mao_obra_iva, antes.mao_obra_iva);
    // A mão de obra dentro dos pontos = as horas deles × a tarifa; total = artigos + mão de obra + deslocação.
    assert.equal(agora.mao_obra_incluida_iva, cent((horas - horasAntes) * 38));
    assert.equal(cent(agora.artigos_iva + agora.mao_obra_iva + agora.deslocacao_iva), agora.total);
  }
  // Cada ponto: o mesmo preço ao cliente (45 / 40 / 55 / 65 / 35 €) com as horas da decisão lá dentro.
  const esperado = { ponto_luz: [45, 0.75], ponto_tomada: [40, 0.6], ponto_tomada_dupla: [55, 0.75], ponto_tomada_tripla: [65, 0.9], ponto_interruptor: [35, 0.5] };
  for (const [chave, [p, h]] of Object.entries(esperado)) {
    const a = encontrarArtigo(chave, CATALOGO);
    assert.ok(precoFechado(a), chave);
    const l = calcularPreco([{ chave, qtd: 2 }], CATALOGO, {}).linhas[0];
    assert.deepEqual([l.preco_iva, l.total, l.horas, l.fechado, l.mao_obra_incluida_iva], [p, 2 * p, 2 * h, true, cent(2 * h * 38)], chave);
  }
});

test('preço fechado: a tarifa muda e o preço ao cliente não mexe; a mão de obra de dentro nunca passa o preço', () => {
  const pedidos = [{ chave: 'ponto_luz', qtd: 4 }, { chave: 'ponto_tomada', qtd: 10 }];
  for (const tarifa of [20, 38, 60, 500]) {
    const p = calcularPreco(pedidos, CATALOGO, { tarifa_hora_iva: tarifa });
    assert.equal(p.total, 4 * 45 + 10 * 40, `tarifa ${tarifa}`);
    assert.equal(p.mao_obra_iva, 0);
    assert.equal(p.horas, 4 * 0.75 + 10 * 0.6);
    assert.equal(p.mao_obra_incluida_iva, tarifa === 500 ? 580 : cent(9 * tarifa), `tarifa ${tarifa}`);
  }
  // Um artigo normal ao lado continua a pagar as suas horas à parte.
  const misto = calcularPreco([...pedidos, { chave: 'campainha', qtd: 1 }], CATALOGO, {});
  assert.equal(misto.mao_obra_iva, 19);
  assert.equal(misto.total, 580 + 39 + 19);
});

test('deslocação: ida e volta por dia de obra (Almada 0 €, Sintra 7,20 €/dia, Torres Vedras 26,40 €/dia); visita e avaria = 1 dia', () => {
  assert.equal(diasDeObra(0), 1);
  assert.equal(diasDeObra(8), 1);
  assert.equal(diasDeObra(8.25), 2);
  assert.equal(diasDeObra(25.85), 4);
  assert.equal(diasDeObra(12, 6), 2, 'horas por dia da configuração');
  assert.equal(diasDeObra(12, 0), 2, 'valor inválido: 8 h');
  assert.equal(CONFIG_OMISSAO.horas_por_dia, 8);
  assert.equal(textoDias(1), '≈ 1 dia de obra');
  assert.equal(textoDias(4), '≈ 4 dias de obra');
  // Um dia (a visita técnica, a avaria): km acima dos 20 grátis × 2 × 0,40 €.
  const dia = (loc) => calcularDeslocacao(loc, {});
  assert.deepEqual([dia('Almada').distancia_km, dia('Almada').valor_iva], [7, 0]);
  assert.deepEqual([dia('Sintra').distancia_km, dia('Sintra').valor_iva], [29, 7.2]);
  assert.deepEqual([dia('Torres Vedras').distancia_km, dia('Torres Vedras').valor_iva], [53, 26.4]);
  assert.equal(calcularDeslocacao('Sintra', {}, 3).valor_iva, 21.6);
  // Teto: no máximo 5 dias de deslocação por obra (`deslocacao_max_dias`).
  const dez = calcularDeslocacao('Sintra', {}, 10);
  assert.deepEqual([dez.dias, dez.limitado, dez.valor_iva], [5, true, 36]);
  assert.deepEqual([calcularDeslocacao('Sintra', {}, 5).limitado, calcularDeslocacao('Sintra', { deslocacao_max_dias: 2 }, 3).valor_iva, calcularDeslocacao('Sintra', { deslocacao_max_dias: 0 }, 10).valor_iva], [false, 14.4, 36]);
  assert.equal(calcularDeslocacao('Porto', {}, 3).valor_iva, null, 'fora da área (100 km): como antes');
  // T2 nova com termoacumulador, placa e máquina de lavar: 25,85 h → 4 dias.
  const e = casa(T2, ['nova'], MAQ);
  const lx = preco(e), alm = preco(e, 'Almada'), sintra = preco(e, 'Sintra'), tv = preco(e, 'Torres Vedras');
  assert.deepEqual([lx.horas, lx.dias, lx.total], [25.85, 4, 2232.2]);
  assert.deepEqual([alm.deslocacao_iva, alm.total], [0, 2232.2]);
  assert.deepEqual([sintra.deslocacao_iva, sintra.deslocacao.dias, sintra.deslocacao.limitado, sintra.total], [28.8, 4, false, 2261]);
  assert.deepEqual([tv.deslocacao_iva, tv.deslocacao.dias, tv.total], [105.6, 4, 2337.8]);
  assert.equal(preco(e, 'Sintra', CATALOGO, { horas_por_dia: 10 }).deslocacao_iva, 21.6, '25,85 h a 10 h por dia = 3 dias');
  // Obra longa (4 h por dia = 7 dias): a deslocação fica nos 5 dias; os dias de obra continuam 7.
  const longa = preco(e, 'Sintra', CATALOGO, { horas_por_dia: 4 });
  assert.deepEqual([longa.dias, longa.deslocacao.dias, longa.deslocacao.limitado, longa.deslocacao_iva], [7, 5, true, 36]);
  assert.equal(preco(e, 'Sintra', CATALOGO, { horas_por_dia: 4, deslocacao_max_dias: 6 }).deslocacao_iva, 43.2);
  assert.equal(preco(e, 'Porto').deslocacao_iva, 0, 'fora da área não soma');
  // Avaria: o diagnóstico (0,5 h) é 1 dia.
  const avaria = calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], CATALOGO, {}, calcularDeslocacao('Torres Vedras', {}));
  assert.deepEqual([avaria.dias, avaria.deslocacao_iva, avaria.total], [1, 26.4, 70.4]);
  // O pedido leva os dias e o painel aceita-o.
  const sim = montarSimulacao(e, sintra, 'base', []);
  assert.deepEqual(sim.deslocacao, { estado: 'estimada', localidade: 'Sintra', concelho: 'Sintra', distrito: 'Lisboa', distancia_km: 29, valor_iva: 28.8, dias: 4, limitado: false });
  assert.equal(montarSimulacao(e, longa, 'base', []).deslocacao.limitado, true);
  assert.deepEqual(sim.mao_obra, { horas: 25.85, valor_iva: sintra.mao_obra_iva, incluida_iva: sintra.mao_obra_incluida_iva, dias: 4 });
  assert.equal(sim.obra_minima_iva, null);
  const ponto = sim.itens.find((i) => i.sku === 'TOMADA-NOVA');
  assert.equal(ponto.fechado, true);
  assert.equal(ponto.mao_obra_incluida_iva, cent(ponto.qtd * 0.6 * 38));
  assert.equal(sim.itens.find((i) => i.sku === 'TONGOU-SY2-JWT').fechado, undefined);
  assert.doesNotThrow(() => validarSimulacao(sim));
});

test('linha dedicada até 15 m: 140 € ao juntar uma máquina a uma casa que já existe, 70 € em instalação nova; 390 € no carregador, com tudo lá dentro', () => {
  assert.equal(PEDIDOS.linha_dedicada.sku, 'LINHA-DEDICADA');
  assert.equal(PEDIDOS.linha_dedicada_nova.sku, 'LINHA-DEDICADA-NOVA');
  assert.equal(PEDIDOS.linha_dedicada_ve.sku, 'LINHA-DEDICADA-VE');
  const maq = (modelo, extra = {}) => ({ tipo: 'maquina', props: { modelo, ...extra } });
  for (const m of ['placa', 'forno', 'termoacumulador', 'maquina_lavar', 'maquina_secar', 'maquina_loica', 'ar_condicionado']) assert.deepEqual(pontosDoElemento(maq(m)), ['linha_dedicada'], m);
  assert.deepEqual(pontosDoElemento(maq('carregador_ve')), ['linha_dedicada_ve']);
  assert.deepEqual(pontosDoElemento(maq('carregador_ve_22')), ['linha_dedicada_ve']);
  assert.deepEqual(pontosDoElemento(maq('frigorifico')), [], 'máquina pequena: nas tomadas');
  assert.deepEqual(pontosDoElemento(maq('outro', { potencia_w: 2500 })), ['linha_dedicada'], 'outra máquina ≥ 2000 W tem circuito próprio');
  assert.deepEqual(pontosDoElemento(maq('outro', { potencia_w: 500 })), []);
  // Em "Instalação nova" a linha da máquina é a de 70 €; a do carregador é sempre a de 390 €.
  assert.deepEqual(pontosDoElemento(maq('placa'), ['nova']), ['linha_dedicada_nova']);
  assert.deepEqual(pontosDoElemento(maq('placa'), ['nova', 'reparar']), ['linha_dedicada_nova']);
  assert.deepEqual(pontosDoElemento(maq('placa'), ['automatizar', 'reparar']), ['linha_dedicada']);
  assert.deepEqual(pontosDoElemento(maq('carregador_ve'), ['nova']), ['linha_dedicada_ve']);
  assert.deepEqual(pedidosDoElemento(maq('forno'), 'novo', [], ['nova']), ['linha_dedicada_nova']);
  assert.deepEqual(pedidosDoElemento(maq('forno'), 'novo', [], ['automatizar']), ['linha_dedicada']);
  // Só as novas: mantida ou trocada fica no circuito que já tem.
  const planta = { elementos: [{ ...maq('placa'), acao: 'novo' }, { ...maq('forno'), acao: 'manter' }, { ...maq('termoacumulador'), acao: 'substituir' }, { ...maq('carregador_ve'), acao: 'novo' }] };
  assert.deepEqual(pedidosPontosNovos(planta, ['automatizar']), [{ chave: 'linha_dedicada', qtd: 1 }, { chave: 'linha_dedicada_ve', qtd: 1 }]);
  // T2 nova com 3 máquinas: + 3 × 70 € e + 3 × 0,75 h (dentro do preço); sem elas, nenhuma linha.
  const e = casa(T2, ['nova'], MAQ);
  const p = preco(e);
  assert.equal(qtd(pedidosDaSelecao(e), 'linha_dedicada_nova'), 3);
  assert.equal(qtd(pedidosDaSelecao(e), 'linha_dedicada'), 0);
  assert.equal(p.total, 2232.2);
  const lista = montarSimulacao(e, p, 'base', [], (chave) => ({ sku: encontrarArtigo(chave, CATALOGO).sku, horas: 0 })).trabalho.flatMap((g) => g.acoes.flatMap((a) => a.material));
  assert.equal(lista.filter((m) => m.sku === 'LINHA-DEDICADA-NOVA').reduce((s, m) => s + m.qtd, 0), 3, 'a lista de trabalho leva a mesma linha do preço');
  // A mesma casa já feita, a juntar as 3 máquinas (automatizar, Novo): 3 × 140 €.
  const junta = casa(T2, ['automatizar'], MAQ, (s) => { for (const x of s.planta.elementos) if (x.tipo === 'maquina') x.acao = 'novo'; });
  assert.equal(qtd(pedidosDaSelecao(junta), 'linha_dedicada'), 3);
  assert.equal(preco(junta).linhas.find((l) => l.sku === 'LINHA-DEDICADA').total, 420);
  assert.equal(preco(e, 'Lisboa', CATALOGO_ANTES).completo, false, 'servidor sem a migração 24: fica "há artigos sem preço"');
  assert.equal(cent(p.total - 3 * 70), 2022.2, 'o total de antes desta ronda');
  assert.equal(qtd(pedidosDaSelecao(casa(T2, ['nova'])), 'linha_dedicada_nova'), 0);
  // Carregador novo sem "Instalação nova" (o anúncio): só a linha, 390 € com tudo; a medição no telemóvel é opcional.
  const evCasa = { tipo: 'moradia', tipologia: 'T3', quartos: 3, casas_banho: 2, salas: 1, extras: { garagem: true } };
  const ev = casa(evCasa, ['automatizar'],
    [{ modelo: 'carregador_ve', qtd: 1, piso: 0 }], (s) => { for (const x of s.planta.elementos) if (x.tipo === 'maquina') x.acao = 'novo'; });
  const pe = preco(ev);
  assert.deepEqual(pe.linhas.map((l) => [l.sku, l.qtd, l.preco_iva]), [['LINHA-DEDICADA-VE', 1, 390]]);
  assert.deepEqual([pe.total, pe.min, pe.max, pe.horas, pe.dias, pe.mao_obra_iva], [390, 350, 470, 4, 1, 0]);
  assert.equal(pe.mao_obra_incluida_iva, 152);
  assert.deepEqual(ev.quadro.circuitos.map((c) => [c.inteligente, c.medir]), [[false, false]]);
  // "Com medição no telemóvel? Sim": junta o disjuntor inteligente (54,90 € + 0,5 h) por cima dos 390 €.
  assert.ok(perguntaMedicao('maquina', { modelo: 'carregador_ve' }) && perguntaMedicao('maquina', { modelo: 'carregador_ve_22' }));
  assert.ok(!perguntaMedicao('maquina', { modelo: 'placa' }) && !perguntaMedicao('tomada', {}));
  const med = casa(evCasa, ['automatizar'], [{ modelo: 'carregador_ve', qtd: 1, piso: 0 }], (s) => { for (const x of s.planta.elementos) if (x.tipo === 'maquina') { x.acao = 'novo'; x.inteligente = true; } });
  const pm = preco(med);
  assert.deepEqual(pm.linhas.map((l) => [l.sku, l.qtd]), [['TONGOU-SY2-JWT', 1], ['LINHA-DEDICADA-VE', 1]]);
  assert.equal(pm.total, 463.9);
  const guardado = normalizarEstado(JSON.parse(JSON.stringify(med))).planta.elementos.find((x) => x.tipo === 'maquina');
  assert.equal(guardado.inteligente, true, 'a resposta fica guardada no estado');
  assert.equal(montarSimulacao(med, pm, 'base', []).planta.elementos.find((x) => x.tipo === 'maquina').inteligente, true);
  assert.equal(montarSimulacao(ev, pe, 'base', []).planta.elementos.find((x) => x.tipo === 'maquina').inteligente, false);
  // As outras máquinas novas continuam com o disjuntor inteligente no seu circuito.
  assert.ok(junta.quadro.circuitos.every((c) => c.inteligente));
  // Mantido (a omissão de "automatizar"): nada.
  assert.deepEqual(pedidosDaSelecao(casa({ ...T2, tipo: 'moradia' }, ['automatizar'], [{ modelo: 'carregador_ve', qtd: 1, piso: 0 }])), []);
  // Com o quadro no pedido (instalação nova, quadro novo): nem o diferencial tipo A nem o disjuntor do carregador à parte.
  const nova = casa({ ...T2, tipo: 'moradia' }, ['nova'], ['carregador_ve'], (s) => { s.quadro.quadro_novo = 'novo'; });
  for (const c of nova.quadro.circuitos) { c.inteligente = false; c.medir = false; }
  const pq = pedidosQuadro(nova);
  assert.equal(qtd(pq, 'diferencial_tipo_a'), 0);
  assert.equal(qtd(pq, 'disjuntor_circuito'), nova.quadro.circuitos.length - 1, 'todos menos o do carregador');
  assert.equal(qtd(pedidosDaSelecao(nova), 'linha_dedicada_ve'), 1);
  // Carregador de 22 kW numa casa trifásica com quadro novo: o tetrapolar também vai dentro da linha.
  const tri = casa({ ...T2, tipo: 'moradia', fases: 'tri' }, ['nova'], ['carregador_ve_22'], (s) => { s.quadro.quadro_novo = 'novo'; });
  tri.quadro.circuitos = sugerirCircuitos(contarPlanta(plantaNovos(tri.planta, ['nova'])), { fases: 'tri' });
  assert.equal(resumoQuadro(tri).tetrapolares, 1);
  assert.equal(qtd(pedidosQuadro(tri), 'disjuntor_tetrapolar'), 0);
  assert.equal(qtd(pedidosDaSelecao(tri), 'linha_dedicada_ve'), 1);
  assert.equal(qtd(pedidosDaSelecao(tri), 'disjuntor_protecoes'), nova.quadro.circuitos.length - 1, 'sem disjuntor inteligente no circuito do carregador');
});

test('entrada ?servico=carregador: o carregador fica marcado como Novo no estado (e sobrevive à gravação)', () => {
  const e = estadoNovo();
  assert.deepEqual(e.maquinasNovas, []);
  assert.equal(aplicarEntrada(e, new URLSearchParams('servico=carregador')), true);
  assert.deepEqual(e.maquinasNovas, ['carregador_ve']);
  assert.deepEqual(e.servico, ['automatizar']);
  assert.deepEqual(normalizarEstado(JSON.parse(JSON.stringify(e))).maquinasNovas, ['carregador_ve']);
  assert.deepEqual(normalizarEstado(JSON.parse(JSON.stringify({ ...e, maquinasNovas: ['xpto', 3, 'placa', 'placa'] }))).maquinasNovas, ['placa']);
  const q = estadoNovo();
  aplicarEntrada(q, new URLSearchParams('servico=quadro-antigo'));
  assert.deepEqual(q.maquinasNovas, []);
});

test('obra mínima: abaixo de 100 € cobra-se 100 €; o intervalo nunca fica abaixo; a deslocação soma por cima', () => {
  assert.equal(CONFIG_OMISSAO.obra_minima_iva, 100);
  const pequeno = [{ chave: 'aparelho_normal', qtd: 1, acao: 'substituir' }];   // 9,90 € + 0,25 h = 19,40 €
  const p = calcularPreco(pequeno, CATALOGO, {});
  assert.deepEqual([p.total, p.min, p.max], [19.4, 15, 25], 'calcularPreco sozinho não aplica o mínimo (avaria, pacotes)');
  const m = comObraMinima(p);
  assert.deepEqual([m.total, m.min, m.max, m.obra_minima], [100, 100, 100, 100]);
  assert.equal(textoIntervalo(m), '100 €');
  // Perto do mínimo: o máximo fica o da estimativa.
  const quase = comObraMinima(calcularPreco([{ chave: 'aparelho_normal', qtd: 5, acao: 'substituir' }], CATALOGO, {}));   // 97,00 €
  assert.deepEqual([quase.total, quase.min, quase.max, quase.obra_minima], [100, 100, 115, 100]);
  // Acima do mínimo: só o intervalo não desce abaixo dele.
  const acima = comObraMinima(calcularPreco([{ chave: 'aparelho_normal', qtd: 6, acao: 'substituir' }], CATALOGO, {}));   // 116,40 €
  assert.deepEqual([acima.total, acima.min, acima.max, acima.obra_minima], [116.4, 105, 140, null]);
  const grande = preco(casa(T2, ['nova']));
  assert.deepEqual(comObraMinima(grande), { ...grande, obra_minima: null });
  // Com deslocação (Torres Vedras, 1 dia: 26,40 €): 100 € + a deslocação.
  const longe = comObraMinima(calcularPreco(pequeno, CATALOGO, {}, calcularDeslocacao('Torres Vedras', {})));
  assert.deepEqual([longe.total, longe.min, longe.max, longe.obra_minima], [126.4, 125, 125, 100]);
  // Configuração: outro mínimo; 0 desliga; sem linhas ou sem catálogo fica como está.
  assert.equal(comObraMinima(calcularPreco(pequeno, CATALOGO, { obra_minima_iva: 150 })).total, 150);
  assert.equal(comObraMinima(calcularPreco(pequeno, CATALOGO, { obra_minima_iva: 0 })).total, 19.4);
  assert.equal(comObraMinima(calcularPreco([], CATALOGO, {})).total, 0);
  assert.equal(comObraMinima(calcularPreco(pequeno, null, {})).total, null);
  // O pedido leva a obra mínima.
  const e = estadoNovo();
  e.servico = ['automatizar'];
  assert.equal(montarSimulacao(e, m, 'base', []).obra_minima_iva, 100);
});

test('migração 24: horas e marca nos pontos sem mexer no preço do CEO; linhas dedicadas e horas por dia; base nova igual', () => {
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < 23; i++) MIGRACOES[i](db);
  db.exec('PRAGMA user_version = 23');
  // Uma base de antes desta ronda: pontos com 0 horas e sem a marca; o CEO mudou o preço da luz (50 €) e deu horas à tomada.
  db.exec(`UPDATE catalogo SET horas_instalacao = 0, especificacoes = json_remove(especificacoes, '$.preco_fechado') WHERE sku IN (${Object.keys(HORAS_PONTOS).map((s) => `'${s}'`).join(',')})`);
  db.exec("UPDATE catalogo SET preco_venda_iva_cent = 5000 WHERE sku = 'PONTO-LUZ-NOVO'");
  db.exec("UPDATE catalogo SET horas_instalacao = 1 WHERE sku = 'TOMADA-NOVA'");
  db.exec("DELETE FROM catalogo WHERE sku LIKE 'LINHA-DEDICADA%'");
  db.exec("DELETE FROM config_orcamento WHERE chave = 'horas_por_dia'");
  db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes, atualizado)
    VALUES ('LINHA-DEDICADA', 'Linha do CEO', 'outro', 16000, 2, '{}', 'x')`).run();
  const n0 = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  const art = (sku) => { const a = db.prepare('SELECT preco_venda_iva_cent AS c, horas_instalacao AS h, especificacoes AS e FROM catalogo WHERE sku = ?').get(sku); return { c: a.c, h: a.h, e: JSON.parse(a.e) }; };
  assert.deepEqual([art('PONTO-LUZ-NOVO').c, art('PONTO-LUZ-NOVO').h, art('PONTO-LUZ-NOVO').e.preco_fechado], [5000, 0.75, true], 'o preço do CEO fica; entram as horas e a marca');
  assert.equal(art('PONTO-LUZ-NOVO').e.funcao, 'ponto_luz', 'o resto das especificações fica');
  assert.deepEqual([art('TOMADA-NOVA').h, art('TOMADA-NOVA').e.preco_fechado], [1, undefined], 'um ponto a que o CEO já deu horas fica como ele o deixou');
  for (const sku of ['TOMADA-DUPLA-NOVA', 'TOMADA-TRIPLA-NOVA', 'INTERRUPTOR-NOVO']) assert.deepEqual([art(sku).h, art(sku).e.preco_fechado], [HORAS_PONTOS[sku], true], sku);
  assert.deepEqual([art('INTERRUPTOR-NOVO').c, art('TOMADA-DUPLA-NOVA').c, art('TOMADA-TRIPLA-NOVA').c], [3500, 5500, 6500]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, n0 + 2, 'entram a linha do carregador e a da instalação nova');
  assert.deepEqual([art('LINHA-DEDICADA-NOVA').c, art('LINHA-DEDICADA-NOVA').h, art('LINHA-DEDICADA-NOVA').e.preco_fechado, art('LINHA-DEDICADA-NOVA').e.funcao], [7000, 0.75, true, 'linha_dedicada_nova']);
  assert.deepEqual([art('LINHA-DEDICADA').c, art('LINHA-DEDICADA').h], [16000, 2], 'a do CEO fica');
  assert.deepEqual([art('LINHA-DEDICADA-VE').c, art('LINHA-DEDICADA-VE').h, art('LINHA-DEDICADA-VE').e.preco_fechado, art('LINHA-DEDICADA-VE').e.funcao], [39000, 4, true, 'linha_dedicada_ve']);
  assert.equal(db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'horas_por_dia'").get().valor, 8);
  // Base nova: tudo de uma vez, com os valores da decisão.
  const nova = abrirDb(':memory:');
  const de = (sku) => nova.prepare('SELECT preco_venda_iva_cent AS c, horas_instalacao AS h FROM catalogo WHERE sku = ?').get(sku);
  assert.deepEqual({ ...de('LINHA-DEDICADA') }, { c: 14000, h: 1.5 });
  assert.deepEqual({ ...de('LINHA-DEDICADA-VE') }, { c: 39000, h: 4 });
  assert.deepEqual({ ...de('LINHA-DEDICADA-NOVA') }, { c: 7000, h: 0.75 });
  assert.deepEqual({ ...de('PONTO-LUZ-NOVO') }, { c: 4500, h: 0.75 });
  // Cada pedido encontra o artigo pelo SKU e, sem ele, pela função.
  for (const k of ['linha_dedicada', 'linha_dedicada_ve', 'linha_dedicada_nova']) {
    assert.equal(encontrarArtigo(k, CATALOGO).sku, PEDIDOS[k].sku, k);
    assert.equal(encontrarArtigo(k, CATALOGO.map((x) => ({ ...x, sku: `X-${x.sku}` }))).sku, `X-${PEDIDOS[k].sku}`, `${k} pela função`);
  }
});
