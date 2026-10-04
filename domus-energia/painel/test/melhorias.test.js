// Simulador, fase 2 — passo "Melhorias" (docs/SIMULADOR-ORCAMENTO.md §0 "Melhorias — fase 2", §6): os 4 pacotes (o que
// levam nesta casa, sem duplicados), o preço "a partir de" com a margem dos pacotes e o total do orçamento, o "Quadro
// seguro" no quadro, o passo nos funis e a migração dos estados de antes, o pedido (e o que o painel aceita), a margem
// na configuração (migração 13) e o PDF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  estadoNovo, normalizarEstado, montarSimulacao, soCasaDe, usarCasa, PASSO, ordemPasso, maisAdiantado,
} from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { calcularPreco, pedidosDaSelecao, cent, encontrarArtigo } from '../../web/simulador/preco.js';
import { contarPlanta, sugerirCircuitos, divisoesDaContagem } from '../../web/simulador/regras.js';
import { plantaNovos, plantaInteligentes } from '../../web/simulador/acoes.js';
import { calcularMelhorias, mudarMelhoria, acertarMelhorias, quadroNoMaximo, CHAVES_MELHORIA, MELHORIAS, QUADRO_SEGURO } from '../../web/simulador/melhorias.js';
import { pedidosQuadro, pacoteDoQuadro, protecoesDoPacote, afddExistentes, CHAVES_PROTECOES } from '../../web/simulador/quadro.js';
import { blocosOrcamento } from '../../web/simulador/imprimir.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { abrirDb, migrar, MIGRACOES } from '../src/db.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS } from '../src/catalogo-sementes.js';
import { tudoNovo } from './ajuda.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS].filter((a) => a.ativo !== false);
const MAQUINAS = [{ modelo: 'termoacumulador', qtd: 1, piso: 0 }, { modelo: 'placa', qtd: 1, piso: 0 }, { modelo: 'maquina_lavar', qtd: 1, piso: 0 }];

/** Apartamento T2 com a planta desenhada pela casa, as divisões e os circuitos do pedido (como app.js acertarPedido). */
function casaT2(servico = ['nova']) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };
  e.planta = plantaDaCasa(e.casa, MAQUINAS);
  // Decisão do dono (2026-10-03): a omissão é Manter; com "Instalação nova" estes testes pedem tudo como novo (ajuda.js).
  if (servico.includes('nova')) e.planta = tudoNovo(e.planta);
  e.plantaFase = 'tudo';
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, servico), []));
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, {});
  e.passo = PASSO.melhorias;
  e.visitado = PASSO.melhorias;
  return e;
}
const porId = (l) => Object.fromEntries(l.map((m) => [m.id, m]));
/** O total do orçamento (sem deslocação) como app.js calcular: linhas das melhorias aceites + a margem delas. */
function total(e, config = {}) {
  acertarMelhorias(e);
  const aceites = calcularMelhorias(e, CATALOGO, config).filter((m) => m.aceite);
  const pedidos = [...pedidosDaSelecao(e), ...aceites.flatMap((m) => m.linhas)];
  return calcularPreco(pedidos, CATALOGO, config, { valor_iva: 0 }, aceites.reduce((t, m) => t + m.margem, 0)).total;
}

test('pacotes nesta casa: contagens, "a partir de" = (material + horas × tarifa) × (1 + margem dos pacotes)', () => {
  for (const servico of [['nova'], ['automatizar']]) {
    const e = casaT2(servico);
    const m = porId(calcularMelhorias(e, CATALOGO, {}));
    assert.deepEqual(Object.keys(m), CHAVES_MELHORIA);
    const qtd = (id, chave) => m[id].itens.find((i) => i.chave === chave)?.qtd ?? 0;
    // 2 quartos, sala e cozinha: 4 tomadas Wi-Fi (a casa de banho não); um módulo por interruptor da planta.
    const interruptores = e.planta.elementos.filter((x) => x.tipo === 'interruptor').length;
    assert.equal(qtd('casa-inteligente', 'tomada'), 4, servico.join());
    assert.equal(qtd('casa-inteligente', 'modulo_interruptor'), interruptores);
    assert.match(m['casa-inteligente'].resumo, new RegExp(`^${interruptores} interruptores, 4 tomadas$`));
    // Água: cozinha e casa de banho; movimento: a sala.
    assert.equal(qtd('seguranca', 'sensor_agua'), 2);
    assert.equal(qtd('seguranca', 'sensor_movimento'), 1);
    // Instalação nova: os circuitos das máquinas já são inteligentes (só o medidor); automatizar: as 3 máquinas ficam nos
    // circuitos que existem → 3 disjuntores com medição.
    assert.equal(qtd('poupar-energia', 'medidor_geral'), 1);
    assert.equal(qtd('poupar-energia', 'disjuntor_protecoes'), servico.includes('nova') ? 0 : 3);
    for (const x of Object.values(m)) {
      assert.ok(x.custo > 0 && !x.vazio && !x.incluido && !x.aceite, x.id);
      assert.equal(x.preco, cent(x.custo * 1.2), `${x.id}: margem de 20 % por omissão`);
    }
    // A margem vem da configuração do painel; sem catálogo não há preço.
    const sem = porId(calcularMelhorias(e, CATALOGO, { margem_pacotes_pct: 0 }));
    assert.equal(sem.seguranca.preco, sem.seguranca.custo);
    assert.equal(porId(calcularMelhorias(e, null, {})).seguranca.preco, null);
  }
});

test('o total do orçamento sobe exatamente o preço de cada pacote aceite (e volta ao tirar)', () => {
  const e = casaT2(['nova']);
  const base = total(e);
  for (const id of CHAVES_MELHORIA) {
    assert.equal(mudarMelhoria(e, id, true), true);
    // Os preços dos cartões aceites, como estão agora (com o Quadro seguro o medidor sai do "Poupar energia": já vem nele).
    const soma = calcularMelhorias(e, CATALOGO, {}).filter((m) => m.aceite).reduce((t, m) => cent(t + m.preco), 0);
    assert.equal(cent(total(e) - base), soma, `com ${id}`);
  }
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))['poupar-energia'].itens.some((i) => i.chave === 'medidor_geral'), false, 'o medidor não conta 2 vezes');
  for (const id of CHAVES_MELHORIA) mudarMelhoria(e, id, false);
  assert.equal(total(e), base);
  assert.deepEqual(e.melhorias, { aceites: [], quadroAnterior: null });
});

test('sem duplicados: o que a planta ou o pedido já têm não conta outra vez', () => {
  const e = casaT2(['nova']);
  const quarto = e.planta.divisoes.find((d) => d.nome === 'Quarto');
  const tomada = e.planta.elementos.find((x) => x.tipo === 'tomada' && x.divisao === quarto.id);
  tomada.inteligente = true;   // "Por um inteligente? Sim" (Novo)
  const sala = e.planta.divisoes.find((d) => d.nome === 'Sala');
  e.divisoes.find((d) => d.planta_id === sala.id).sensores_movimento = 1;
  const ints = e.planta.elementos.filter((x) => x.tipo === 'interruptor');
  ints[0].inteligente = true;
  const m = porId(calcularMelhorias(e, CATALOGO, {}));
  const qtd = (id, chave) => m[id].itens.find((i) => i.chave === chave)?.qtd ?? 0;
  assert.equal(qtd('casa-inteligente', 'tomada'), 3, 'o quarto já tem tomada inteligente');
  assert.equal(qtd('casa-inteligente', 'modulo_interruptor'), ints.length - 1, 'o interruptor inteligente não leva módulo');
  assert.equal(qtd('seguranca', 'sensor_movimento'), 0, 'a sala já tem sensor de movimento no pedido');
  // Portas e janelas: os sensores de porta que o pedido já leva contam (a porta da rua sugere um).
  // (A planta desenhada pela casa não tem porta da rua: +1 para a entrada.)
  const precisa = e.planta.elementos.filter((x) => (x.tipo === 'porta' && x.props.entrada) || x.tipo === 'janela').length;
  const ja = e.divisoes.reduce((s, d) => s + d.sensores_porta, 0);
  const semRua = !e.planta.elementos.some((x) => x.tipo === 'porta' && x.props.entrada);
  assert.equal(qtd('seguranca', 'sensor_porta'), Math.max(0, precisa - ja) + (semRua ? 1 : 0));
  // O quadro com medidor geral (no pedido): o "Poupar energia" já não o leva.
  e.quadro.protecoes.medidor_geral = true;
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))['poupar-energia'].vazio, true);
});

test('Quadro seguro: põe o quadro na proteção máxima, repõe ao tirar, "Já incluído" no máximo; a casa guardada fica com as de antes', () => {
  const e = casaT2(['nova']);
  const antes = { ...e.quadro.protecoes };
  const m0 = porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO];
  // O Recomendado já tem descarregador e relé; a Completa junta AFDD, medidor e geral Wi-Fi (+ diferenciais Wi-Fi).
  assert.deepEqual(m0.itens.map((i) => i.chave).sort(), ['afdd', 'diferencial_wifi', 'geral_wifi', 'medidor_geral']);
  assert.match(m0.resumo, /medidor geral, geral Wi-Fi/);
  mudarMelhoria(e, QUADRO_SEGURO, true);
  assert.ok(quadroNoMaximo(e.quadro));
  // Decisão A: o passo Quadro mostra a proteção "Completa" (com os diferenciais Wi-Fi).
  assert.equal(pacoteDoQuadro(e.quadro), 'completo');
  assert.equal(e.quadro.pacote, 'completo');
  assert.equal(e.quadro.protecoes.idr_wifi, true);
  assert.deepEqual(e.melhorias.quadroAnterior, antes);
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].preco, m0.preco, 'o mesmo preço depois de aceitar');
  assert.deepEqual(soCasaDe(e).quadro.protecoes, antes, 'a casa guardada não fica com o Quadro seguro');
  // Escolher outra proteção no passo Quadro tira a melhoria (app.js: mudarMelhoria(…, false) antes do pacote novo).
  mudarMelhoria(e, QUADRO_SEGURO, false);
  assert.deepEqual(e.quadro.protecoes, antes);
  // Já no máximo (Completa + diferenciais Wi-Fi): "Já incluído", não se aceita; pedido pelo `?pacote=` (sem as de antes) sai no acerto.
  e.quadro.protecoes = { ...e.quadro.protecoes, afdd: true, idr_wifi: true };
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].incluido, false, 'sem medidor e geral Wi-Fi ainda não é o máximo');
  e.quadro.protecoes = protecoesDoPacote('completo', true);
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].incluido, true);
  assert.equal(mudarMelhoria(e, QUADRO_SEGURO, true), false);
  e.melhorias.aceites = [QUADRO_SEGURO];
  acertarMelhorias(e);
  assert.deepEqual(e.melhorias.aceites, []);
  // `?pacote=quadro-seguro` com o quadro abaixo do máximo: aplica-se no acerto.
  e.quadro.protecoes = { ...antes };
  e.melhorias.aceites = [QUADRO_SEGURO];
  acertarMelhorias(e);
  assert.ok(quadroNoMaximo(e.quadro) && e.melhorias.quadroAnterior);
});

test('Quadro seguro sem o quadro no pedido (automatizar): proteções no quadro que fica, como linhas da melhoria', () => {
  const e = casaT2(['automatizar']);
  const m = porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO];
  assert.deepEqual(m.itens.map((i) => i.chave).sort(), ['afdd', 'descarregador', 'diferencial_wifi', 'geral_wifi', 'medidor_geral', 'rele_tensao']);
  assert.ok(m.itens.find((i) => i.chave === 'afdd').qtd >= 2, 'AFDD dos circuitos que já existem (quartos e sala)');
  assert.equal(m.linhas.length, m.itens.length);
  assert.ok(m.linhas.every((l) => l.grupo === 'melhoria'));
});

test('passo Melhorias: entre "Trocar e reparar" e o Orçamento; estados de antes (ordem 9) ficam onde estavam', () => {
  assert.ok(ordemPasso(PASSO.trocar) < ordemPasso(PASSO.melhorias) && ordemPasso(PASSO.melhorias) < ordemPasso(PASSO.preco));
  assert.equal(maisAdiantado(PASSO.melhorias, PASSO.preco), PASSO.preco);
  assert.equal(maisAdiantado(PASSO.trocar, PASSO.melhorias), PASSO.melhorias);
  const v9 = (x) => ({ ...estadoNovo(), passos: 10, ordem: 9, funil: 'primeira', servico: ['nova'], ...x });
  const noOrcamento = normalizarEstado(v9({ passo: PASSO.preco, visitado: PASSO.preco }));
  assert.deepEqual([noOrcamento.passo, noOrcamento.visitado, noOrcamento.funil], [PASSO.preco, PASSO.preco, 'planta']);   // duas partes (2026-10-04): o Orçamento é de "Pedir um serviço"
  assert.deepEqual(noOrcamento.melhorias, { aceites: [], quadroAnterior: null });
  const noTrocar = normalizarEstado(v9({ funil: 'planta', passo: PASSO.trocar, visitado: PASSO.preco }));
  assert.deepEqual([noTrocar.passo, noTrocar.visitado], [PASSO.trocar, PASSO.preco]);
  // Estado de agora nas Melhorias; ids desconhecidos saem.
  const agora = normalizarEstado({ ...estadoNovo(), funil: 'planta', passo: PASSO.melhorias, melhorias: { aceites: ['seguranca', 'x', 'seguranca'], quadroAnterior: { afdd: true } } });
  assert.deepEqual([agora.passo, agora.melhorias], [PASSO.melhorias, { aceites: ['seguranca'], quadroAnterior: null }]);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'avaria', passo: PASSO.melhorias }).passo, PASSO.inicio, 'a avaria não tem Melhorias');
});

test('pedido (§6): `melhorias` e as linhas "melhoria"; o painel aceita e recusa o que está mal', () => {
  const e = casaT2(['nova']);
  mudarMelhoria(e, 'casa-inteligente', true);
  acertarMelhorias(e);
  const aceites = calcularMelhorias(e, CATALOGO, {}).filter((m) => m.aceite);
  const pedidos = [...pedidosDaSelecao(e), ...aceites.flatMap((m) => m.linhas)];
  const preco = calcularPreco(pedidos, CATALOGO, {}, { valor_iva: 0 }, aceites.reduce((t, m) => t + m.margem, 0));
  const env = aceites.map((m) => ({ id: m.id, nome: m.nome, itens: m.itens.map((i) => ({ sku: { modulo_interruptor: 'BAB-MOD-2CH', tomada: 'TOMADA-WIFI' }[i.chave], qtd: i.qtd })), preco: m.preco }));
  const sim = montarSimulacao(e, preco, 'base', [], null, env);
  assert.equal(sim.melhorias.length, 1);
  assert.deepEqual(sim.melhorias[0].itens.map((i) => i.sku), ['BAB-MOD-2CH', 'TOMADA-WIFI']);
  assert.ok(sim.itens.some((i) => i.sku === 'BAB-MOD-2CH' && i.grupo === 'melhoria'));
  assert.equal(preco.melhorias_margem_iva, aceites[0].margem);
  // Bug 2: a margem dos pacotes vai no pedido (o painel soma-a ao "Total (sem intervalo)").
  assert.equal(sim.melhorias_margem_iva, aceites[0].margem);
  assert.equal(cent(preco.artigos_iva + preco.mao_obra_iva + preco.deslocacao_iva + sim.melhorias_margem_iva), preco.total);
  assert.equal(typeof validarSimulacao(sim), 'string');
  assert.deepEqual(montarSimulacao(e, preco, 'base').melhorias, [], 'sem melhorias: lista vazia');
  const mal = (melhorias) => assert.throws(() => validarSimulacao({ ...sim, melhorias }), (err) => err.estado === 400, JSON.stringify(melhorias));
  const boa = sim.melhorias[0];
  mal('x');
  mal([{ ...boa, id: 'outra' }]);
  mal([boa, boa]);
  mal([{ ...boa, nome: '' }]);
  mal([{ ...boa, itens: [{ sku: 'bab mod', qtd: 1 }] }]);
  mal([{ ...boa, itens: [{ sku: 'BAB-MOD-2CH', qtd: 0 }] }]);
  mal([{ ...boa, preco: -1 }]);
  assert.equal(typeof validarSimulacao({ ...sim, melhorias: [{ ...boa, preco: null }] }), 'string', 'sem catálogo: preço null');
  const { melhorias_margem_iva: _, ...semMargem } = sim;
  assert.equal(typeof validarSimulacao(semMargem), 'string', 'pedidos antigos: sem a margem');
  for (const x of [-1, '5', null, Infinity, 2_000_000]) {
    assert.throws(() => validarSimulacao({ ...sim, melhorias_margem_iva: x }), (err) => err.estado === 400, String(x));
  }
});

test('Quadro seguro com o quadro no pedido: `quadro_delta` = a diferença do quadro (com sinal), que custa o que o cartão diz; vai no pedido', () => {
  const e = casaT2(['nova']);
  mudarMelhoria(e, QUADRO_SEGURO, true);
  acertarMelhorias(e);
  const ms = calcularMelhorias(e, CATALOGO, {});
  const qs = ms.find((m) => m.id === QUADRO_SEGURO);
  assert.ok(qs.aceite && Array.isArray(qs.delta));
  assert.ok(qs.delta.some((i) => i.qtd < 0), 'sai alguma coisa (diferenciais normais, geral, caixa menor)');
  assert.ok(!ms.find((m) => m.id === 'casa-inteligente').delta, 'só o Quadro seguro');
  // O custo pela diferença (entra − sai) é o do cartão.
  const custo = (l) => { const pr = calcularPreco(l, CATALOGO, {}, { valor_iva: 0 }); return cent(pr.artigos_iva + pr.mao_obra_iva); };
  const entra = custo(qs.delta.filter((i) => i.qtd > 0)), sai = custo(qs.delta.filter((i) => i.qtd < 0).map((i) => ({ ...i, qtd: -i.qtd })));
  assert.ok(Math.abs(cent(entra - sai) - qs.custo) <= 0.01, `${entra} − ${sai} ≈ ${qs.custo}`);
  const sku = (chave) => encontrarArtigo(chave, CATALOGO).sku;
  const env = [{ id: qs.id, nome: qs.nome, itens: qs.itens.map((i) => ({ sku: sku(i.chave), qtd: i.qtd })), preco: qs.preco, quadro_delta: qs.delta.map((i) => ({ sku: sku(i.chave), qtd: i.qtd })) }];
  const preco = calcularPreco([...pedidosDaSelecao(e), ...qs.linhas], CATALOGO, {}, { valor_iva: 0 }, qs.margem);
  const sim = montarSimulacao(e, preco, 'base', [], null, env);
  assert.deepEqual(sim.melhorias[0].quadro_delta, env[0].quadro_delta);
  assert.equal(typeof validarSimulacao(sim), 'string');
  // Sem o quadro no pedido (automatizar), o custo são as linhas da melhoria: sem `quadro_delta`.
  const a = casaT2(['automatizar']);
  mudarMelhoria(a, QUADRO_SEGURO, true);
  acertarMelhorias(a);
  assert.equal(calcularMelhorias(a, CATALOGO, {}).find((m) => m.id === QUADRO_SEGURO).delta, undefined);
  const mal = (d, id = QUADRO_SEGURO) => assert.throws(() => validarSimulacao({ ...sim, melhorias: [{ ...sim.melhorias[0], id, quadro_delta: d }] }), (err) => err.estado === 400, JSON.stringify(d));
  mal([{ sku: 'GERAL-2P-63A', qtd: 0 }]);
  mal([{ sku: 'GERAL-2P-63A', qtd: -1000 }]);
  mal([{ sku: 'GERAL-2P-63A', qtd: 1.5 }]);
  mal({});
  mal(Array(31).fill({ sku: 'GERAL-2P-63A', qtd: 1 }));
  mal([{ sku: 'GERAL-2P-63A', qtd: 1 }], 'seguranca');
});

test('margem dos pacotes: 20 % numa base nova e na migração 13, sem mexer num valor editado', () => {
  const nova = abrirDb(':memory:');
  assert.equal(nova.prepare("SELECT valor FROM config_orcamento WHERE chave = 'margem_pacotes_pct'").get().valor, 20);
  nova.close();
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRACOES.slice(0, 12)) m(db);
  db.exec('PRAGMA user_version = 12');
  db.exec("INSERT INTO config_orcamento (chave, valor) VALUES ('margem_pacotes_pct', 35)");
  migrar(db);
  assert.equal(db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'margem_pacotes_pct'").get().valor, 35);
  db.close();
});

test('PDF do orçamento: secção "Melhorias" só com melhorias aceites', () => {
  const d = { data: new Date('2026-09-30T12:00:00Z'), casa: 'Apartamento T2', inclui: ['Instalação por técnico habilitado'], intervalo: '1 000 € – 1 200 €', planos: [], nota: 'x' };
  assert.ok(!blocosOrcamento(d).some((b) => b.texto === 'Melhorias'));
  const b = blocosOrcamento({ ...d, melhorias: ['Casa inteligente: 5 interruptores, 4 tomadas — 377 €'] });
  const i = b.findIndex((x) => x.tipo === 'seccao' && x.texto === 'Melhorias');
  assert.ok(i > 0 && b[i + 1].texto.startsWith('Casa inteligente'));
});

// ------------------------------------------------------------ correções do QA da fase 2

/** Automatizar (sem "Instalação nova") com "Melhorar o quadro? Sim" e o quadro atual ou novo. */
function comQuadroMelhorado(quadroNovo) {
  const e = casaT2(['automatizar']);
  e.mexerQuadro = true;
  e.quadro.quadro_novo = quadroNovo;
  return e;
}
const qtdDe = (l, k) => l.filter((p) => p.chave === k).reduce((t, p) => t + p.qtd, 0);

test('bug 1: AFDD nos circuitos que já existem — na proteção "Completa" do quadro e no Quadro seguro, com ou sem o quadro no pedido', () => {
  const fora = casaT2(['automatizar']);
  const n = afddExistentes({ ...fora, mexerQuadro: true });
  assert.ok(n >= 2, 'T2: iluminação + tomadas dos quartos e sala');
  assert.equal(afddExistentes(fora), 0, 'sem melhorar o quadro não conta');
  assert.equal(afddExistentes({ ...casaT2(['nova']), mexerQuadro: true }), 0, 'instalação nova: os circuitos são todos novos');
  const afddQs = (e) => porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].itens.find((i) => i.chave === 'afdd')?.qtd ?? 0;
  assert.equal(afddQs(fora), n, 'sem o quadro no pedido');
  for (const qn of ['atual', 'novo']) {
    const e = comQuadroMelhorado(qn);
    const m = porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO];
    assert.equal(afddQs(e), n, `quadro ${qn}: o cartão tem o AFDD dos circuitos que existem`);
    assert.match(m.resumo, new RegExp(`AFDD em ${n} circuitos`));
    // A proteção "Completa" do próprio quadro cobra o mesmo AFDD (e, num quadro novo, menos disjuntores simples).
    const completa = { ...e, quadro: { ...e.quadro, protecoes: protecoesDoPacote('completo', false) } };
    assert.equal(qtdDe(pedidosQuadro(completa), 'afdd'), n, `quadro ${qn}: Completa`);
    if (qn === 'novo') assert.equal(qtdDe(pedidosQuadro(e), 'disjuntor_circuito') - qtdDe(pedidosQuadro(completa), 'disjuntor_circuito'), n);
    // Aceite, o total sobe o preço do cartão.
    const base = total(e);
    mudarMelhoria(e, QUADRO_SEGURO, true);
    assert.equal(cent(total(e) - base), porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].preco, `quadro ${qn}: total`);
  }
});

test('bug 3: "Já incluído" e aceitar seguem a mesma regra (sem o quadro no pedido conta o quadro que fica, não o escolhido)', () => {
  const e = casaT2(['automatizar']);
  e.quadro.protecoes = protecoesDoPacote('completo', true);   // escolhido no passo Quadro, mas "Melhorar o quadro? Não"
  const m = porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO];
  assert.equal(m.incluido, false);
  assert.ok(m.preco > 0);
  assert.equal(mudarMelhoria(e, QUADRO_SEGURO, true), true, 'o cartão com preço aceita-se');
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].aceite, true);
  // A casa guardada já com a proteção máxima instalada: "Já incluído" e não se aceita.
  const f = casaT2(['automatizar']);
  f.instalado = { protecoes: protecoesDoPacote('completo', true), maquinas: [] };
  assert.equal(porId(calcularMelhorias(f, CATALOGO, {}))[QUADRO_SEGURO].incluido, true);
  assert.equal(mudarMelhoria(f, QUADRO_SEGURO, true), false);
});

test('bug 4: `?pacote=` só com as chaves dos pacotes (nada herdado do objeto)', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.ok(MELHORIAS[k] !== undefined || k === '__proto__', `${k} existe no objeto (o bug)`);
    assert.equal(CHAVES_MELHORIA.includes(k), false, k);
  }
  assert.deepEqual(normalizarEstado({ ...estadoNovo(), melhorias: { aceites: ['constructor', 'seguranca'] } }).melhorias.aceites, ['seguranca']);
});

test('decisão C: sem porta da rua desenhada, 1 sensor de porta para a entrada; as janelas só se desenhadas', () => {
  const e = casaT2(['nova']);
  // A planta automática já marca a porta da rua (QA N4, casa.js marcarPortaDaRua): aqui desmarca-se (e recontam-se as
  // divisões, que levam o sensor dessa porta) para testar a decisão C.
  for (const x of e.planta.elementos) if (x.tipo === 'porta') x.props.entrada = false;
  e.divisoes = divisoesDaContagem(contarPlanta(plantaInteligentes(plantaNovos(e.planta, ['nova']), [])));
  const sp = (x) => porId(calcularMelhorias(x, CATALOGO, {})).seguranca.itens.find((i) => i.chave === 'sensor_porta')?.qtd ?? 0;
  assert.equal(e.planta.elementos.some((x) => x.tipo === 'janela' || (x.tipo === 'porta' && x.props.entrada)), false);
  assert.equal(sp(e), 1);
  assert.match(porId(calcularMelhorias(e, CATALOGO, {})).seguranca.resumo, /^1 sensor de porta\/janela \(com a porta da rua\), 1 de movimento, 2 de água$/);
  // Com a porta da rua desenhada: a dela (e não mais uma).
  const sala = e.planta.divisoes.find((d) => d.nome === 'Sala');
  e.planta.elementos.find((x) => x.tipo === 'porta' && x.divisao === sala.id).props.entrada = true;
  assert.equal(sp(e), 1);
  // Com um sensor de porta já nessa porta: nenhum.
  e.planta.elementos.push({ id: 'sp1', tipo: 'sensor_porta', divisao: sala.id, piso: 0, x_cm: 0, y_cm: 0, rot: 0, props: {} });
  assert.equal(sp(e), 0);
  // Janelas desenhadas contam uma a uma.
  e.planta.elementos.push({ id: 'j1', tipo: 'janela', divisao: sala.id, piso: 0, x_cm: 0, y_cm: 0, rot: 0, props: {} });
  assert.equal(sp(e), 1);
  assert.match(porId(calcularMelhorias(e, CATALOGO, {})).seguranca.resumo, /^1 sensor de porta\/janela, /, 'a porta da rua já tem sensor: o da janela');
});

test('decisão D: "Já tenho a planta" — o que a casa guardada já instalou não se cobra outra vez (e as casas antigas ficam como antes)', () => {
  // 1.ª simulação: instalação nova com a proteção "Completa" e as máquinas com disjuntor inteligente.
  const primeira = casaT2(['nova']);
  primeira.quadro.protecoes = protecoesDoPacote('completo', false);
  const casa = soCasaDe(primeira);
  assert.deepEqual(casa.instalado.protecoes, { ...protecoesDoPacote('completo', false) });
  const maquinas = primeira.planta.elementos.filter((x) => x.tipo === 'maquina');
  assert.equal(casa.instalado.maquinas.length, maquinas.length, 'as 3 máquinas com SY2');
  assert.deepEqual(normalizarEstado(JSON.parse(JSON.stringify(casa))).instalado, casa.instalado, 'guardado e lido');
  // "Já tenho a planta": tudo Manter.
  const plantaFunil = (c) => { const e = usarCasa(estadoNovo(), c); e.passo = PASSO.melhorias; return e; };
  const e = plantaFunil(casa);
  assert.deepEqual(e.instalado, casa.instalado);
  const m = porId(calcularMelhorias(e, CATALOGO, {}));
  assert.equal(m['poupar-energia'].vazio, true, 'medidor (Completa) e máquinas já com disjuntor inteligente');
  const qs = m[QUADRO_SEGURO];
  assert.deepEqual(qs.itens.map((i) => i.chave), ['diferencial_wifi'], 'só falta o que a Completa não tem');
  // Com o Quadro seguro na 1.ª simulação: já incluído.
  const comQs = casaT2(['nova']);
  mudarMelhoria(comQs, QUADRO_SEGURO, true);
  const e2 = plantaFunil(soCasaDe(comQs));
  assert.equal(porId(calcularMelhorias(e2, CATALOGO, {}))[QUADRO_SEGURO].incluido, true);
  assert.equal(mudarMelhoria(e2, QUADRO_SEGURO, true), false);
  // Casa guardada antes disto (sem `instalado`): como antes — quadro no mínimo, as 3 máquinas sem disjuntor inteligente.
  const { instalado: _, ...antiga } = casa;
  const e3 = plantaFunil(normalizarEstado(JSON.parse(JSON.stringify(antiga))));
  assert.equal(e3.instalado, null);
  const m3 = porId(calcularMelhorias(e3, CATALOGO, {}));
  assert.equal(m3['poupar-energia'].itens.find((i) => i.chave === 'disjuntor_protecoes')?.qtd, maquinas.length);
  assert.ok(m3[QUADRO_SEGURO].itens.some((i) => i.chave === 'descarregador'), 'base Essencial');
  // Guardar outra vez a casa no funil da planta (sem o quadro no pedido) mantém o que já estava instalado.
  assert.deepEqual(soCasaDe(e).instalado, casa.instalado);
  assert.deepEqual(Object.keys(casa.instalado.protecoes), CHAVES_PROTECOES);
});

test('ronda 3: `?pacote=quadro-seguro` aplica-se logo (o passo Quadro mostra "Completa"); tirar repõe as proteções de antes', () => {
  const e = estadoNovo();
  const antes = { ...e.quadro.protecoes };
  const pacoteAntes = pacoteDoQuadro(e.quadro);
  assert.notEqual(pacoteAntes, 'completo');
  e.melhorias.aceites = [QUADRO_SEGURO];   // app.js preEscolherPacote, logo no arranque
  acertarMelhorias(e);
  assert.equal(e.quadro.pacote, 'completo');
  assert.ok(quadroNoMaximo(e.quadro));
  assert.deepEqual(e.melhorias.quadroAnterior, antes);
  mudarMelhoria(e, QUADRO_SEGURO, false);
  assert.deepEqual([e.quadro.protecoes, e.quadro.pacote, e.melhorias.aceites], [antes, pacoteAntes, []]);
});

test('ronda 3: estados de antes das Melhorias já para lá delas — a barra não as dá como feitas até lá ir', () => {
  assert.equal(estadoNovo().melhoriasPorVer, false);
  const v9 = (x) => ({ ...estadoNovo(), passos: 10, ordem: 9, funil: 'primeira', servico: ['nova'], ...x });
  assert.equal(normalizarEstado(v9({ passo: PASSO.preco, visitado: PASSO.preco })).melhoriasPorVer, true);
  assert.equal(normalizarEstado(v9({ funil: 'planta', passo: PASSO.trocar, visitado: PASSO.preco })).melhoriasPorVer, true);
  assert.equal(normalizarEstado(v9({ passo: PASSO.trocar, visitado: PASSO.trocar })).melhoriasPorVer, false, 'ainda não passou por elas');
  assert.equal(normalizarEstado({ ...estadoNovo(), passos: 9, ordem: 8, passo: PASSO.preco, visitado: PASSO.preco, servico: ['nova'] }).melhoriasPorVer, true, 'ordem 8');
  // Estados de agora: só com a marca gravada (e enquanto está para lá das Melhorias).
  const agora = (x) => normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.preco, visitado: PASSO.preco, ...x });
  assert.equal(agora({}).melhoriasPorVer, false);
  assert.equal(agora({ melhoriasPorVer: true }).melhoriasPorVer, true);
  assert.equal(agora({ melhoriasPorVer: true, passo: PASSO.melhorias, visitado: PASSO.melhorias }).melhoriasPorVer, false);
});

test('ronda 3: pacote aceite que fica "Nada a acrescentar"/"Já incluído" sai dos aceites (já nas Melhorias)', () => {
  const e = casaT2(['nova']);
  // Só o medidor geral no Poupar energia: as máquinas já têm disjuntor inteligente.
  for (const c of e.quadro.circuitos) if (c.tipo === 'maquina') c.inteligente = true;
  let m = porId(calcularMelhorias(e, CATALOGO, {}));
  assert.deepEqual(m['poupar-energia'].itens.map((i) => i.chave), ['medidor_geral']);
  mudarMelhoria(e, 'poupar-energia', true);
  mudarMelhoria(e, QUADRO_SEGURO, true);   // traz o medidor: o Poupar energia fica sem nada
  acertarMelhorias(e);
  assert.deepEqual(e.melhorias.aceites, ['poupar-energia', QUADRO_SEGURO], 'antes das Melhorias fica (sem planta ainda não há nada)');
  acertarMelhorias(e, true);
  assert.deepEqual(e.melhorias.aceites, [QUADRO_SEGURO]);
  m = porId(calcularMelhorias(e, CATALOGO, {}));
  assert.equal(m['poupar-energia'].vazio, true);
  // Tirar o Quadro seguro não o traz de volta às escondidas.
  mudarMelhoria(e, QUADRO_SEGURO, false);
  acertarMelhorias(e, true);
  assert.deepEqual(e.melhorias.aceites, []);
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))['poupar-energia'].aceite, false);
  // O `?pacote=` sem planta (nada a acrescentar ainda) só fica enquanto o cliente não chegou às Melhorias.
  const n = estadoNovo();
  n.melhorias.aceites = ['seguranca'];
  acertarMelhorias(n);
  assert.deepEqual(n.melhorias.aceites, ['seguranca']);
  acertarMelhorias(n, true);
  assert.deepEqual(n.melhorias.aceites, []);
});
