// Simulador, fase 2 — passo "Melhorias" (docs/SIMULADOR-ORCAMENTO.md §0 "Melhorias — fase 2", §6): os 4 pacotes (o que
// levam nesta casa, sem duplicados), o preço "a partir de" com a margem dos pacotes e o total do orçamento, o "Quadro
// seguro" no quadro, o passo nos funis e a migração dos estados de antes, o pedido (e o que o painel aceita), a margem
// na configuração (migração 13) e o PDF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  estadoNovo, normalizarEstado, montarSimulacao, soCasaDe, PASSO, ordemPasso, maisAdiantado,
} from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { calcularPreco, pedidosDaSelecao, cent } from '../../web/simulador/preco.js';
import { contarPlanta, sugerirCircuitos, divisoesDaContagem } from '../../web/simulador/regras.js';
import { plantaNovos, plantaInteligentes } from '../../web/simulador/acoes.js';
import { calcularMelhorias, mudarMelhoria, acertarMelhorias, quadroNoMaximo, CHAVES_MELHORIA, QUADRO_SEGURO } from '../../web/simulador/melhorias.js';
import { blocosOrcamento } from '../../web/simulador/imprimir.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { abrirDb, migrar, MIGRACOES } from '../src/db.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
const MAQUINAS = [{ modelo: 'termoacumulador', qtd: 1, piso: 0 }, { modelo: 'placa', qtd: 1, piso: 0 }, { modelo: 'maquina_lavar', qtd: 1, piso: 0 }];

/** Apartamento T2 com a planta desenhada pela casa, as divisões e os circuitos do pedido (como app.js acertarPedido). */
function casaT2(servico = ['nova']) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };
  e.planta = plantaDaCasa(e.casa, MAQUINAS);
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
  let soma = 0;
  for (const id of CHAVES_MELHORIA) {
    const preco = porId(calcularMelhorias(e, CATALOGO, {}))[id].preco;
    assert.equal(mudarMelhoria(e, id, true), true);
    soma = cent(soma + preco);
    assert.equal(cent(total(e) - base), soma, `com ${id}`);
  }
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
  const precisa = e.planta.elementos.filter((x) => (x.tipo === 'porta' && x.props.entrada) || x.tipo === 'janela').length;
  const ja = e.divisoes.reduce((s, d) => s + d.sensores_porta, 0);
  assert.equal(qtd('seguranca', 'sensor_porta'), Math.max(0, precisa - ja));
  // O quadro com medidor geral (no pedido): o "Poupar energia" já não o leva.
  e.quadro.protecoes.medidor_geral = true;
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))['poupar-energia'].vazio, true);
});

test('Quadro seguro: põe o quadro na proteção máxima, repõe ao tirar, "Já incluído" no máximo; a casa guardada fica com as de antes', () => {
  const e = casaT2(['nova']);
  const antes = { ...e.quadro.protecoes };
  const m0 = porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO];
  assert.deepEqual(m0.itens.map((i) => i.chave).sort(), ['afdd', 'diferencial_wifi']);   // o Recomendado já tem descarregador e relé
  mudarMelhoria(e, QUADRO_SEGURO, true);
  assert.ok(quadroNoMaximo(e.quadro));
  assert.deepEqual(e.melhorias.quadroAnterior, antes);
  assert.equal(porId(calcularMelhorias(e, CATALOGO, {}))[QUADRO_SEGURO].preco, m0.preco, 'o mesmo preço depois de aceitar');
  assert.deepEqual(soCasaDe(e).quadro.protecoes, antes, 'a casa guardada não fica com o Quadro seguro');
  // Escolher outra proteção no passo Quadro tira a melhoria (app.js: mudarMelhoria(…, false) antes do pacote novo).
  mudarMelhoria(e, QUADRO_SEGURO, false);
  assert.deepEqual(e.quadro.protecoes, antes);
  // Já no máximo: "Já incluído", não se aceita; pedido pelo `?pacote=` (sem as de antes) sai no acerto.
  e.quadro.protecoes = { ...e.quadro.protecoes, afdd: true, idr_wifi: true };
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
  assert.deepEqual(m.itens.map((i) => i.chave).sort(), ['afdd', 'descarregador', 'diferencial_wifi', 'rele_tensao']);
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
  assert.deepEqual([noOrcamento.passo, noOrcamento.visitado, noOrcamento.funil], [PASSO.preco, PASSO.preco, 'primeira']);
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
