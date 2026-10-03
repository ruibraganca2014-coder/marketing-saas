// Simulador, ronda regras (docs/SIMULADOR-ORCAMENTO.md §0 "Ronda regras"): pontos novos com preço fechado, tipos de
// comando do interruptor, comando "escada" sugerido na planta automática, tomada dupla e campainha, diferencial tipo A
// do carregador VE, potência mínima da RTIEBT 801.5.2.2 e a migração 15 do catálogo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { abrirDb, migrar, versaoEsquema, MIGRACOES } from '../src/db.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS, SEMENTES_PONTOS_20, SEMENTES_DINHEIRO } from '../src/catalogo-sementes.js';
import { pontosDoElemento, pedidosDoElemento, pedidosPontosNovos, plantaNovos, plantaInteligentes } from '../../web/simulador/acoes.js';
import { pedidosDaSelecao, calcularPreco, encontrarArtigo, PEDIDOS } from '../../web/simulador/preco.js';
import { plantaDaCasa, aparelhosOmissao, comandoSugerido } from '../../web/simulador/casa.js';
import { contarPlanta, divisoesDaContagem, sugerirCircuitos, COMANDOS, comandoDe, ELEMENTOS, PROPS_PERMITIDAS, caixasDe } from '../../web/simulador/regras.js';
import { pedidosQuadro, resumoQuadro, potenciaSugerida, compartimentosRtiebt, minimoRtiebt, avisosProtecoes, gruposDiferenciais } from '../../web/simulador/quadro.js';
import { estadoNovo, normalizarEstado, montarSimulacao, normalizarProps } from '../../web/simulador/estado.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { tudoNovo } from './ajuda.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS, ...SEMENTES_PONTOS_20, ...SEMENTES_DINHEIRO].filter((a) => a.ativo !== false);
const CATALOGO_ANTIGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
const qtd = (pedidos, chave) => pedidos.filter((p) => p.chave === chave).reduce((s, p) => s + p.qtd, 0);

/** Apartamento T2 com a planta desenhada pela casa, as divisões e os circuitos (como app.js acertarPedido). */
function casaT2(servico = ['nova'], maquinas = []) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1, pisos: 1, extras: { ...e.casa.extras, corredor: true } };
  e.planta = plantaDaCasa(e.casa, maquinas);
  // Decisão do dono (2026-10-03): a omissão é Manter; com "Instalação nova" estes testes pedem tudo como novo (ajuda.js).
  if (servico.includes('nova')) e.planta = tudoNovo(e.planta);
  e.plantaFase = 'tudo';
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, servico), []));
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, {});
  return e;
}

test('migração 15: os artigos da ronda regras entram numa base existente sem duplicar nem mexer no editado', () => {
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < 14; i++) MIGRACOES[i](db);
  db.exec('PRAGMA user_version = 14');
  // O CEO já tinha criado o ponto de luz com o seu preço: fica.
  db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes, atualizado)
    VALUES ('PONTO-LUZ-NOVO', 'Ponto de luz do CEO', 'outro', 5000, 0, '{}', 'x')`).run();
  const antes = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, antes + SEMENTES_PONTOS.length - 1 + SEMENTES_PONTOS_20.length + SEMENTES_DINHEIRO.length);   // a 20 traz a tomada tripla; a 24, as linhas dedicadas
  assert.equal(db.prepare("SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = 'PONTO-LUZ-NOVO'").get().c, 5000);
  for (const s of SEMENTES_PONTOS) assert.ok(db.prepare('SELECT 1 FROM catalogo WHERE sku = ?').get(s.sku), s.sku);
  const a = db.prepare("SELECT preco_venda_iva_cent AS c, especificacoes AS e FROM catalogo WHERE sku = 'IDR-2P-40A-30MA-A'").get();
  assert.equal(a.c, 4500);
  assert.equal(JSON.parse(a.e).tipo, 'A');
  // Base nova: tudo de uma vez.
  const nova = abrirDb(':memory:');
  assert.equal(nova.prepare("SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = 'TOMADA-NOVA'").get().c, 4000);
  // Cada pedido do simulador encontra o seu artigo pelo SKU e, sem ele, pela função.
  for (const k of ['ponto_luz', 'ponto_tomada', 'ponto_tomada_dupla', 'ponto_interruptor', 'comutador_escada', 'inversor', 'botao_pressao', 'campainha', 'diferencial_tipo_a']) {
    assert.equal(encontrarArtigo(k, CATALOGO).sku, PEDIDOS[k].sku, k);
    assert.equal(encontrarArtigo(k, CATALOGO.map((x) => ({ ...x, sku: `X-${x.sku}` }))).sku, `X-${PEDIDOS[k].sku}`, `${k} pela função`);
  }
  // O diferencial AC nunca cai no tipo A (e vice-versa) quando se procura pela função.
  assert.equal(encontrarArtigo('diferencial', CATALOGO.map((x) => ({ ...x, sku: `X-${x.sku}` }))).sku, 'X-IDR-2P-40A-30MA');
});

test('pontos novos: preço fechado por ponto; inteligente = o ponto + o aparelho; Manter/Trocar/Reparar sem ponto', () => {
  const luz = { tipo: 'luz', props: {} };
  const tom = { tipo: 'tomada', props: { dupla: false, inteligente: false } };
  const dupla = { tipo: 'tomada', props: { dupla: true } };
  const int = { tipo: 'interruptor', props: { botoes: 1 } };
  assert.deepEqual(pontosDoElemento(luz), ['ponto_luz']);
  assert.deepEqual(pontosDoElemento(tom), ['ponto_tomada']);
  assert.deepEqual(pontosDoElemento(dupla), ['ponto_tomada_dupla']);
  assert.deepEqual(pontosDoElemento(int), ['ponto_interruptor']);
  assert.deepEqual(pontosDoElemento({ tipo: 'maquina', props: { modelo: 'campainha' } }), ['campainha', 'botao_pressao']);
  // Ronda dinheiro: a máquina nova com circuito próprio leva a linha dedicada; as pequenas não.
  assert.deepEqual(pontosDoElemento({ tipo: 'maquina', props: { modelo: 'placa' } }), ['linha_dedicada']);
  assert.deepEqual(pontosDoElemento({ tipo: 'maquina', props: { modelo: 'frigorifico' } }), []);
  // Novo inteligente: o ponto e o aparelho Wi-Fi (o ponto nunca se conta duas vezes).
  assert.deepEqual(pedidosDoElemento({ ...int, inteligente: true }, 'novo'), ['ponto_interruptor', 'interruptor_1']);
  assert.deepEqual(pedidosDoElemento({ ...tom, inteligente: true }, 'novo'), ['ponto_tomada', 'tomada']);
  assert.deepEqual(pedidosDoElemento(tom, 'novo'), ['ponto_tomada']);
  assert.deepEqual(pedidosDoElemento(tom, 'substituir'), ['aparelho_normal']);
  assert.deepEqual(pedidosDoElemento(tom, 'reparar'), ['diagnostico']);
  assert.deepEqual(pedidosDoElemento(tom, 'manter'), []);
  // Só os Novos entram nos pontos.
  const planta = { elementos: [{ ...luz, acao: 'manter' }, { ...tom, acao: 'novo' }, { ...dupla, acao: 'substituir' }, { ...int, acao: 'novo' }, { ...int }] };
  assert.deepEqual(pedidosPontosNovos(planta, ['automatizar']), [{ chave: 'ponto_tomada', qtd: 1 }, { chave: 'ponto_interruptor', qtd: 1 }]);
  // Decisão do dono (2026-10-03): sem ação escolhida é Manter também com "Instalação nova" (o interruptor sem ação não leva ponto).
  assert.deepEqual(pedidosPontosNovos(planta, ['nova']), [{ chave: 'ponto_tomada', qtd: 1 }, { chave: 'ponto_interruptor', qtd: 1 }]);
});

test('T2 nova: o total sobe exatamente o preço dos pontos (45 / 40 / 35 €) e o pedido leva-os em itens e trabalho', () => {
  const e = casaT2(['nova']);
  // Decisão do dono (2026-10-03): a casa já não desenha pontos de luz — só entram os que o cliente pede como novos.
  assert.equal(e.planta.elementos.filter((x) => x.tipo === 'luz').length, 0, 'a casa não levanta pontos de luz');
  const sala = e.planta.divisoes.find((d) => d.nome === 'Sala');
  for (const id of ['e901', 'e902']) e.planta.elementos.push({ id, tipo: 'luz', x_cm: sala.x_cm + 100, y_cm: sala.y_cm + 100, rot: 0, piso: 0, divisao: sala.id, props: {}, acao: 'novo' });
  const pontos = pedidosPontosNovos(e.planta, e.servico);
  const n = (t) => e.planta.elementos.filter((x) => x.tipo === t).length;
  assert.equal(qtd(pontos, 'ponto_luz'), n('luz'));
  assert.equal(qtd(pontos, 'ponto_tomada'), n('tomada'));
  assert.equal(qtd(pontos, 'ponto_interruptor'), n('interruptor'));
  // O corredor do T2 nasce com 2 interruptores de escada: 2 comutadores.
  assert.equal(qtd(pontos, 'comutador_escada'), 2);
  const pedidos = pedidosDaSelecao(e);
  const semPontos = pedidos.filter((p) => !pontos.some((x) => x.chave === p.chave));
  const antes = calcularPreco(semPontos, CATALOGO, null).total;
  const agora = calcularPreco(pedidos, CATALOGO, null).total;
  const esperado = n('luz') * 45 + n('tomada') * 40 + n('interruptor') * 35 + 2 * 14 + 2 * 0.15 * 38;
  assert.equal(Math.round((agora - antes) * 100) / 100, Math.round(esperado * 100) / 100);
  assert.equal(n('luz'), 2, 'as 2 luzes pedidas como novas contam (45 € cada)');
  assert.ok(agora > antes + 500, `T2 nova: ${antes} → ${agora}`);
  // Sem os artigos no catálogo (servidor antigo) o preço fica incompleto, sem rebentar.
  const velho = calcularPreco(pedidos, CATALOGO_ANTIGO, null);
  assert.equal(velho.completo, false);
  // Pedido: itens com os SKUs e a lista de trabalho com o mesmo material (grupo "novo").
  const linhaArtigo = (chave, acao) => { const a = encontrarArtigo(chave, CATALOGO); return { sku: a.sku, horas: Number(a.horas_instalacao) }; };
  const sim = montarSimulacao(e, calcularPreco(pedidos, CATALOGO, null), 'base', [], linhaArtigo);
  const skus = Object.fromEntries(sim.itens.map((i) => [i.sku, i.qtd]));
  assert.equal(skus['PONTO-LUZ-NOVO'], n('luz'));
  assert.equal(skus['TOMADA-NOVA'], n('tomada'));
  assert.equal(skus['INTERRUPTOR-NOVO'], n('interruptor'));
  assert.equal(skus['COMUTADOR-ESCADA'], 2);
  const corredor = sim.trabalho.find((g) => g.nome === 'Corredor');
  const ints = corredor.acoes.find((a) => a.tipo === 'interruptor');
  assert.deepEqual(ints.material.sort((a, b) => a.sku.localeCompare(b.sku)), [{ sku: 'COMUTADOR-ESCADA', qtd: 2 }, { sku: 'INTERRUPTOR-NOVO', qtd: 2 }]);
  assert.deepEqual(ints.comandos, { escada: 2 });
  assert.equal(validarSimulacao(sim) !== null, true, 'o painel aceita o pedido com `comando`');
  // Automatizar (tudo Manter): nenhum ponto.
  assert.deepEqual(pedidosPontosNovos(casaT2(['automatizar']).planta, ['automatizar']), []);
});

test('comandos: material por tipo, botões mínimos, estados antigos "simples", planta automática com escada nas passagens', () => {
  assert.deepEqual(Object.keys(COMANDOS), ['simples', 'lustre', 'escada', 'inversor', 'botao']);
  assert.equal(ELEMENTOS.interruptor.props.comando, 'simples');
  assert.ok(PROPS_PERMITIDAS.includes('comando'));
  assert.equal(comandoDe({}), 'simples');
  assert.equal(comandoDe({ comando: 'xpto' }), 'simples');
  assert.equal(normalizarProps('interruptor', { botoes: 2 }).comando, 'simples');
  assert.equal(normalizarProps('interruptor', { botoes: 2, comando: 'escada' }).comando, 'escada');
  const int = (comando) => ({ tipo: 'interruptor', props: { botoes: 1, comando } });
  assert.deepEqual(pontosDoElemento(int('simples')), ['ponto_interruptor']);
  assert.deepEqual(pontosDoElemento(int('lustre')), ['ponto_interruptor']);
  assert.deepEqual(pontosDoElemento(int('escada')), ['ponto_interruptor', 'comutador_escada']);
  assert.deepEqual(pontosDoElemento(int('inversor')), ['ponto_interruptor', 'inversor']);
  assert.deepEqual(pontosDoElemento(int('botao')), ['ponto_interruptor', 'botao_pressao']);
  assert.equal(COMANDOS.lustre.botoes_min, 2);
  // Planta automática: corredor, entrada e escadas com 2 portas e 2 interruptores de escada; o quarto com 1 simples,
  // dentro da divisão junto à porta (40 cm para dentro da parede de baixo).
  assert.equal(comandoSugerido('Corredor'), 'escada');
  assert.equal(comandoSugerido('Entrada'), 'escada');
  assert.equal(comandoSugerido('Escadas (r/c)'), 'escada');
  assert.equal(comandoSugerido('Quarto'), 'simples');
  assert.equal(comandoSugerido('Sala', 2), 'escada');
  const corredor = aparelhosOmissao('Corredor', { x_cm: 100, y_cm: 100, largura_cm: 400, altura_cm: 150 });
  assert.equal(corredor.filter((a) => a.tipo === 'porta').length, 2);
  const ints = corredor.filter((a) => a.tipo === 'interruptor');
  assert.equal(ints.length, 2);
  assert.ok(ints.every((a) => a.props.comando === 'escada'));
  const quarto = aparelhosOmissao('Quarto', { x_cm: 0, y_cm: 0, largura_cm: 350, altura_cm: 300 });
  const i = quarto.find((a) => a.tipo === 'interruptor'), p = quarto.find((a) => a.tipo === 'porta');
  assert.equal(i.props.comando, 'simples');
  assert.equal(i.y_cm, 290, 'na face de dentro da parede, como a porta (10 cm para dentro)');
  assert.ok(Math.abs(i.x_cm - p.x_cm) === 70, 'ao lado da porta');
  // Decisão do dono (2026-10-03): a casa já não desenha pontos de luz (nem nas divisões grandes): só porta, interruptor e tomadas.
  assert.equal(quarto.some((a) => a.tipo === 'luz'), false);
  const nave = aparelhosOmissao('Nave / oficina', { x_cm: 0, y_cm: 0, largura_cm: 1500, altura_cm: 1000 });
  assert.deepEqual([...new Set(nave.map((a) => a.tipo))].sort(), ['interruptor', 'porta', 'tomada']);
  // O estado gravado mantém o comando; os antigos sem ele ficam simples.
  const e = casaT2(['nova']);
  const n = normalizarEstado(JSON.parse(JSON.stringify(e)));
  assert.equal(n.planta.elementos.filter((x) => x.tipo === 'interruptor' && x.props.comando === 'escada').length, 2);
  for (const x of e.planta.elementos) delete x.props.comando;
  assert.ok(normalizarEstado(JSON.parse(JSON.stringify(e))).planta.elementos.filter((x) => x.tipo === 'interruptor').every((x) => x.props.comando === 'simples'));
});

test('tomada dupla e campainha: artigos próprios (55 € e campainha + botão) nos pedidos e nos circuitos', () => {
  const e = casaT2(['nova'], ['campainha']);
  const camp = e.planta.elementos.find((x) => x.tipo === 'maquina' && x.props.modelo === 'campainha');
  assert.ok(camp, 'a campainha vai para a planta (Entrada/Corredor/Sala)');
  e.planta.elementos.find((x) => x.tipo === 'tomada').props.dupla = true;
  const pontos = pedidosPontosNovos(e.planta, e.servico);
  assert.equal(qtd(pontos, 'ponto_tomada_dupla'), 1);
  assert.equal(qtd(pontos, 'campainha'), 1);
  assert.equal(qtd(pontos, 'botao_pressao'), 1);
  const preco = calcularPreco(pontos, CATALOGO, null);
  const linha = (sku) => preco.linhas.find((l) => l.sku === sku);
  assert.equal(linha('TOMADA-DUPLA-NOVA').preco_iva, 55);
  assert.equal(linha('CAMPAINHA').preco_iva, 39);
  assert.equal(linha('BOTAO-PRESSAO').preco_iva, 12);
  // A tomada dupla conta como 1 ponto no circuito (RTIEBT 801.5.3) e a campainha como máquina pequena das tomadas.
  const cont = contarPlanta(e.planta);
  assert.equal(cont.reduce((s, c) => s + c.tomadas_duplas, 0), 1);
  assert.ok(cont.some((c) => c.maquinas.some((m) => m.modelo === 'campainha')));
});

test('carregador VE: diferencial tipo A sempre (nunca o AC nem o Wi-Fi), dentro da linha dedicada (ronda dinheiro), com a nota "tipo A exigido (RTIEBT 722)"', () => {
  const e = casaT2(['nova'], ['carregador_ve']);
  assert.ok(e.quadro.circuitos.some((c) => c.itens.maquinas.some((m) => m.modelo === 'carregador_ve')));
  const grupos = gruposDiferenciais(e.quadro.circuitos);
  assert.equal(grupos.filter((g) => g.carregador).length, 1);
  for (const wifi of [false, true]) {
    e.quadro.protecoes = { ...e.quadro.protecoes, idr_wifi: wifi };
    const ped = pedidosQuadro(e);
    assert.equal(qtd(ped, 'diferencial_tipo_a'), 0, `wifi=${wifi}: o tipo A vai na linha dedicada do carregador, não à parte`);
    assert.equal(qtd(ped, wifi ? 'diferencial_wifi' : 'diferencial'), grupos.length - 1);
    assert.equal(qtd(ped, wifi ? 'diferencial' : 'diferencial_wifi'), 0);
  }
  const r = resumoQuadro(e);
  const l = r.linhas.find((x) => x.chave === 'diferencial_tipo_a');
  assert.equal(l.qtd, 1);
  assert.equal(r.linhas.find((x) => x.chave === 'diferencial').qtd, grupos.length - 1);
  assert.ok(avisosProtecoes(e).some((a) => /tipo A exigido \(RTIEBT 722\)/.test(a)));
  const preco = calcularPreco(pedidosDaSelecao(e), CATALOGO, null);
  assert.equal(preco.linhas.find((x) => x.sku === 'IDR-2P-40A-30MA-A'), undefined, 'sem linha à parte');
  assert.equal(preco.linhas.find((x) => x.sku === 'LINHA-DEDICADA-VE').preco_iva, 390);
  // Sem carregador: nenhum tipo A.
  assert.equal(qtd(pedidosQuadro(casaT2(['nova'])), 'diferencial_tipo_a'), 0);
});

test('potência sugerida nunca abaixo do mínimo da RTIEBT 801.5.2.2 (6,9 kVA com 2–6 compartimentos; 10,35 com mais de 6)', () => {
  assert.equal(minimoRtiebt(1), null);
  assert.equal(minimoRtiebt(2), 6.9);
  assert.equal(minimoRtiebt(6), 6.9);
  assert.equal(minimoRtiebt(7), 10.35);
  // Sem compartimentos: como antes (pela carga).
  const pouca = [{ itens: { luzes: 4, tomadas: 4, maquinas: [] } }];
  assert.deepEqual(potenciaSugerida(pouca), { carga_w: 192, kva: 3.45, trifasica: false, minimo_kva: null, minimo_rtiebt: false });
  assert.deepEqual(potenciaSugerida(pouca, 4), { carga_w: 192, kva: 6.9, trifasica: false, minimo_kva: 6.9, minimo_rtiebt: true });
  assert.deepEqual(potenciaSugerida(pouca, 8), { carga_w: 192, kva: 10.35, trifasica: false, minimo_kva: 10.35, minimo_rtiebt: true });
  // Carga acima do mínimo: vale a carga.
  const muita = [{ itens: { luzes: 0, tomadas: 0, maquinas: [{ modelo: 'carregador_ve', potencia_w: 7400 }, { modelo: 'placa', potencia_w: 7200 }] } }];
  const m = potenciaSugerida(muita, 4);
  assert.equal(m.kva, 10.35);
  assert.equal(m.minimo_rtiebt, false);
  // T2 (sala, cozinha, 2 quartos, casa de banho = 5 compartimentos; o corredor não conta): 6,9 kVA, "mínimo RTIEBT".
  const e = casaT2(['nova']);
  assert.equal(compartimentosRtiebt(e), 5);
  const r = resumoQuadro(e);
  assert.equal(r.potencia.kva, 6.9);
  assert.equal(r.potencia.minimo_rtiebt, true);
  assert.ok(avisosProtecoes(e).some((a) => /mínimo da RTIEBT \(801\.5\.2\.2\)/.test(a)));
  const sim = montarSimulacao(e, calcularPreco(pedidosDaSelecao(e), CATALOGO, null), 'base', []);
  assert.equal(sim.quadro.potencia_sugerida_kva, 6.9);
  assert.equal(sim.quadro.potencia_minima_kva, 6.9);
  assert.equal(sim.quadro.potencia_minima_rtiebt, true);
  // Serviços: a 801 é só para habitação.
  const s = estadoNovo();
  s.casa = { ...s.casa, tipo: 'servicos', area_m2: 80, espacos: 4 };
  s.planta = plantaDaCasa(s.casa, []);
  assert.equal(compartimentosRtiebt(s), null);
  assert.equal(resumoQuadro(s).potencia.minimo_kva, null);
});

test('ronda sinalizar — tomada tripla: caixas 1–3 (dupla antiga → 2), ponto TOMADA-TRIPLA-NOVA a 65 €, 1 ponto no circuito, migração 20', () => {
  // Normalização: `caixas` manda; `dupla` segue-a (compatibilidade); estados antigos só com `dupla` passam a 2 caixas.
  assert.deepEqual(normalizarProps('tomada', { dupla: true }), { dupla: true, inteligente: false, caixas: 2 });
  assert.deepEqual(normalizarProps('tomada', { caixas: 3 }), { dupla: false, inteligente: false, caixas: 3 });
  assert.deepEqual(normalizarProps('tomada', { caixas: 2, dupla: false }), { dupla: true, inteligente: false, caixas: 2 });
  assert.deepEqual(normalizarProps('tomada', { caixas: 7, inteligente: true }), { dupla: false, inteligente: true, caixas: 1 });   // fora de 1–3: simples
  assert.deepEqual(normalizarProps('tomada', { caixas: 1, dupla: true }), { dupla: true, inteligente: false, caixas: 2 });   // `dupla` posto à mão vale
  assert.deepEqual(normalizarProps('tomada', { caixas: 'x' }), { dupla: false, inteligente: false, caixas: 1 });
  assert.deepEqual(normalizarProps('tomada', {}), { dupla: false, inteligente: false, caixas: 1 });
  assert.equal(caixasDe({ dupla: true }), 2);
  assert.equal(caixasDe({ caixas: 3, dupla: false }), 3);
  assert.equal(caixasDe({}), 1);
  assert.ok(PROPS_PERMITIDAS.includes('caixas'));
  // Pontos: tripla → ponto_tomada_tripla (o inteligente junta a tomada Wi-Fi, como as outras).
  const tripla = { tipo: 'tomada', props: { caixas: 3 } };
  assert.deepEqual(pontosDoElemento(tripla), ['ponto_tomada_tripla']);
  assert.deepEqual(pontosDoElemento({ tipo: 'tomada', props: { caixas: 2 } }), ['ponto_tomada_dupla']);
  assert.deepEqual(pedidosDoElemento({ ...tripla, inteligente: true }, 'novo'), ['ponto_tomada_tripla', 'tomada']);
  assert.equal(PEDIDOS.ponto_tomada_tripla.sku, 'TOMADA-TRIPLA-NOVA');
  // Preço: 65 € e, no circuito, 1 ponto (como a dupla: RTIEBT 801.5.3).
  const e = casaT2(['nova']);
  const tom = e.planta.elementos.find((x) => x.tipo === 'tomada');
  tom.props = { ...tom.props, caixas: 3, dupla: false };
  const pontos = pedidosPontosNovos(e.planta, e.servico);
  assert.equal(qtd(pontos, 'ponto_tomada_tripla'), 1);
  const preco = calcularPreco(pontos, CATALOGO, null);
  assert.equal(preco.linhas.find((l) => l.sku === 'TOMADA-TRIPLA-NOVA').preco_iva, 65);
  const antes = contarPlanta(casaT2(['nova']).planta).reduce((s, c) => s + c.tomadas, 0);
  assert.equal(contarPlanta(e.planta).reduce((s, c) => s + c.tomadas, 0), antes);
  // O pedido leva `caixas` e passa na validação do painel.
  const sim = montarSimulacao(normalizarEstado(e), calcularPreco(pontos, CATALOGO, null), 'base', []);
  const t = sim.planta.elementos.find((x) => x.id === tom.id);
  assert.equal(t.props.caixas, 3);
  assert.equal(t.props.dupla, false);
  assert.doesNotThrow(() => validarSimulacao(sim));
  // Migração 20: numa base na versão 19 entra só a tomada tripla; não mexe num artigo do CEO com o mesmo SKU.
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < 19; i++) MIGRACOES[i](db);
  db.exec('PRAGMA user_version = 19');
  db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes, atualizado)
    VALUES ('TOMADA-TRIPLA-NOVA', 'Tripla do CEO', 'outro', 7000, 0, '{}', 'x')`).run();
  const n0 = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, n0 + SEMENTES_DINHEIRO.length);   // a 24 traz as linhas dedicadas
  assert.equal(db.prepare("SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = 'TOMADA-TRIPLA-NOVA'").get().c, 7000);
  const nova = abrirDb(':memory:');
  const a = nova.prepare("SELECT preco_venda_iva_cent AS c, especificacoes AS e FROM catalogo WHERE sku = 'TOMADA-TRIPLA-NOVA'").get();
  assert.equal(a.c, 6500);
  assert.equal(JSON.parse(a.e).funcao, 'ponto_tomada_tripla');
});
