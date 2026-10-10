// Ronda final de QA (2026-10-03): sensor da porta da rua fora do preço base (sugerido no pacote Segurança), "Kitnet" →
// "Kitchenette" com os estados antigos a carregar, e a confirmação "A planta está parecida…?" guardada no estado.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoNovo, normalizarEstado, assinaturaDivisoes, renomearKitnet, PASSO } from '../../web/simulador/estado.js';
import { plantaDaCasa, divisoesDaCasa, tipoDivisao } from '../../web/simulador/casa.js';
import { contarPlanta, divisoesDaContagem, sugerirCircuitos, EXTRAS_CASA } from '../../web/simulador/regras.js';
import { plantaNovos, plantaInteligentes } from '../../web/simulador/acoes.js';
import { pedidosDaSelecao, planoSugerido } from '../../web/simulador/preco.js';
import { calcularMelhorias } from '../../web/simulador/melhorias.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS].filter((a) => a.ativo !== false);

function casa(servico, c = {}) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T1', quartos: 1, casas_banho: 1, salas: 1, ...c, extras: { ...e.casa.extras, ...(c.extras ?? {}) } };
  e.planta = plantaDaCasa(e.casa, []);
  e.plantaFase = 'tudo';
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, servico), []));
  e.divisoes = divisoesDaContagem(cont);
  e.quadro.circuitos = sugerirCircuitos(cont, {});
  return e;
}
const gravarECarregar = (e) => normalizarEstado(JSON.parse(JSON.stringify(e)));

test('Instalação nova: a porta da rua não põe sensor no preço base; o pacote Segurança sugere-o', () => {
  const e = casa(['nova']);
  assert.ok(e.planta.elementos.some((x) => x.tipo === 'porta' && x.props.entrada), 'a planta automática marca a porta da rua');
  assert.equal(e.divisoes.reduce((s, d) => s + d.sensores_porta, 0), 0, 'Divisões: sem "aviso de porta ou janela aberta"');
  const pedidos = pedidosDaSelecao(e);
  assert.equal(pedidos.some((p) => p.chave === 'sensor_porta'), false, 'nada de sensor no preço base');
  assert.equal(planoSugerido(pedidos), 'base', 'sem sensores, o plano sugerido já não é o Conforto');
  const seg = calcularMelhorias(e, CATALOGO, {}).find((m) => m.id === 'seguranca');
  assert.equal(seg.itens.find((i) => i.chave === 'sensor_porta')?.qtd, 1);
  assert.match(seg.resumo, /^1 sensor de porta\/janela \(com a porta da rua\)/);
  // Um sensor desenhado pelo cliente continua a contar (é escolha dele).
  const sala = e.planta.divisoes.find((d) => d.nome === 'Sala');
  const porta = e.planta.elementos.find((x) => x.tipo === 'porta' && x.props.entrada);
  e.planta.elementos.push({ id: 'e999', tipo: 'sensor_porta', divisao: porta.divisao ?? sala.id, piso: 0, x_cm: porta.x_cm, y_cm: porta.y_cm, rot: 0, props: {}, acao: 'novo' });
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, ['nova']), []));
  assert.equal(divisoesDaContagem(cont).reduce((s, d) => s + d.sensores_porta, 0), 1);
});

test('"Kitchenette" em vez de "Kitnet"; um estado guardado com o nome antigo carrega com o novo', () => {
  assert.equal(EXTRAS_CASA.kitnet, 'Kitchenette');
  const k = { extras: { kitnet: true } };
  assert.ok(divisoesDaCasa({ ...casa(['nova']).casa, ...k, extras: { ...casa(['nova']).casa.extras, kitnet: true } }, []).some((d) => d.nome === 'Kitchenette'));
  assert.equal(tipoDivisao('Kitchenette'), 'sala_cozinha');
  assert.equal(tipoDivisao('Kitnet 2'), 'sala_cozinha', 'os nomes antigos continuam a contar');
  assert.equal(renomearKitnet('Kitnet 2'), 'Kitchenette 2');
  assert.equal(renomearKitnet('Sala'), 'Sala');
  // Estado antigo: planta, divisões, circuitos, sincronização e divisões vistas com "Kitnet".
  const e = casa(['nova'], k);
  const d = e.planta.divisoes.find((x) => x.nome === 'Kitchenette');
  const antigo = JSON.parse(JSON.stringify(e).replaceAll('Kitchenette', 'Kitnet'));
  antigo.vistas = { divisoes: [`${d.id}:Kitnet`], trocar: [] };
  antigo.plantaSinc = { divisoes: [{ nome: 'Kitnet', piso: 0 }], maquinas: [], fase: 'tudo' };
  const n = normalizarEstado(antigo);
  assert.ok(n, 'carrega');
  assert.ok(n.planta.divisoes.some((x) => x.id === d.id && x.nome === 'Kitchenette'));
  assert.ok(n.divisoes.some((x) => x.nome === 'Kitchenette'));
  assert.ok(!JSON.stringify(n.quadro.circuitos).includes('Kitnet'));
  assert.deepEqual(n.vistas.divisoes, [`${d.id}:Kitchenette`]);
  assert.equal(n.plantaSinc.divisoes[0].nome, 'Kitchenette');
  assert.equal(n.casa.extras.kitnet, true, 'a chave fica');
});

test('"A planta está parecida…?": a resposta fica gravada e vale enquanto as divisões não mudarem', () => {
  const e = casa(['automatizar']);
  e.passo = PASSO.casa;
  e.visitado = PASSO.casa;
  assert.equal(e.plantaConfirmada, null);
  e.plantaConfirmada = assinaturaDivisoes(e.planta);
  const n = gravarECarregar(e);
  assert.equal(n.plantaConfirmada, assinaturaDivisoes(n.planta), 'recarregar não volta a perguntar');
  // Divisões mudadas depois da resposta (gravadas assim): volta a perguntar.
  const mexido = JSON.parse(JSON.stringify(e));
  mexido.planta.divisoes[0].x_cm += 100;
  assert.equal(normalizarEstado(mexido).plantaConfirmada, null);
  // Estado de antes (sem o campo) ou com lixo: pergunta uma vez.
  const antes = JSON.parse(JSON.stringify(e));
  delete antes.plantaConfirmada;
  assert.equal(normalizarEstado(antes).plantaConfirmada, null);
  assert.equal(normalizarEstado({ ...JSON.parse(JSON.stringify(e)), plantaConfirmada: 42 }).plantaConfirmada, null);
  assert.match(assinaturaDivisoes(e.planta), /^[0-9a-f]{8}$/);
  assert.notEqual(assinaturaDivisoes(e.planta), assinaturaDivisoes(mexido.planta));
});

test('planta automática: a porta da rua numa parede de fora; tomadas de divisões vizinhas sem se sobreporem', () => {
  const casas = ['T0', 'T1', 'T2', 'T3', 'T4'].flatMap((tipologia) => [
    { tipo: 'apartamento', tipologia, extras: {} },
    { tipo: 'apartamento', tipologia, extras: { entrada: true, corredor: true, kitnet: true } },
    { tipo: 'moradia', tipologia, pisos: 2, extras: { garagem: true, jardim: true } },
  ]);
  for (const c of casas) {
    const e = casa(['nova'], c);
    const p = e.planta;
    const porta = p.elementos.find((x) => x.tipo === 'porta' && x.props.entrada);
    assert.ok(porta, `${c.tipologia}: há porta da rua`);
    const d = p.divisoes.find((x) => x.id === porta.divisao);
    const fora = [d.x_cm + 10, d.x_cm + d.largura_cm - 10].includes(porta.x_cm) || [d.y_cm + 10, d.y_cm + d.altura_cm - 10].includes(porta.y_cm);
    assert.ok(fora, `${c.tipologia}: a porta está junto a uma parede da divisão`);
    // Do outro lado dessa parede (20 cm para fora) não há outra divisão do mesmo piso.
    const lado = porta.y_cm === d.y_cm + d.altura_cm - 10 ? [0, 20] : porta.y_cm === d.y_cm + 10 ? [0, -20] : porta.x_cm === d.x_cm + 10 ? [-20, 0] : [20, 0];
    const [x, y] = [porta.x_cm + lado[0], porta.y_cm + lado[1]];
    const outra = p.divisoes.find((o) => o !== d && (o.piso ?? 0) === (d.piso ?? 0) && x > o.x_cm && x < o.x_cm + o.largura_cm && y > o.y_cm && y < o.y_cm + o.altura_cm);
    assert.equal(outra, undefined, `${c.tipo} ${c.tipologia} ${JSON.stringify(c.extras)}: porta da rua da ${d.nome} dá para a ${outra?.nome}`);
    // Tomadas de divisões diferentes no mesmo piso: pelo menos 40 cm entre elas.
    const tomadas = p.elementos.filter((x) => x.tipo === 'tomada');
    for (const a of tomadas) for (const b of tomadas) {
      if (a === b || a.divisao === b.divisao || (a.piso ?? 0) !== (b.piso ?? 0)) continue;
      assert.ok(Math.hypot(a.x_cm - b.x_cm, a.y_cm - b.y_cm) >= 40, `${c.tipo} ${c.tipologia}: tomadas sobrepostas`);
    }
  }
});

test('janela "confirme antes de continuar" dos outros passos: a assinatura muda só com o que o passo confirma; o estado guarda-a', async () => {
  const { assinaturaPasso, PASSOS_A_CONFIRMAR, PASSO } = await import('../../web/simulador/estado.js');
  assert.deepEqual(PASSOS_A_CONFIRMAR, [PASSO.quer, PASSO.divisoes, PASSO.planta, PASSO.tomadas, PASSO.quadro, PASSO.trocar, PASSO.melhorias]);
  const e = estadoNovo();
  e.planta = { ...e.planta, divisoes: [{ id: 'd1', nome: 'Sala' }], elementos: [{ id: 'e1', tipo: 'tomada', divisao: 'd1', x: 10, y: 10, props: { caixas: 1 } }, { id: 'e2', tipo: 'luz', divisao: 'd1', x: 50, y: 50, props: {} }] };
  const de = (passo, foto = null) => assinaturaPasso(e, passo, foto);
  const antes = Object.fromEntries(PASSOS_A_CONFIRMAR.map((k) => [k, de(k)]));
  assert.ok(PASSOS_A_CONFIRMAR.every((k) => typeof antes[k] === 'string' && antes[k].length <= 40));
  for (const k of [PASSO.inicio, PASSO.casa, PASSO.relatorio, PASSO.preco, PASSO.enviar]) assert.equal(de(k), null, `sem janela no passo ${k}`);
  // Marcar uma máquina muda só os Equipamentos.
  e.quer.maquinas.push('placa');
  assert.notEqual(de(PASSO.quer), antes[PASSO.quer]);
  for (const k of [PASSO.divisoes, PASSO.planta, PASSO.trocar, PASSO.melhorias]) assert.equal(de(k), antes[k]);
  // "Inteligente" numa tomada do inventário (a tomada que a casa já tem): muda só as Divisões.
  e.planta.elementos[0].props = { caixas: 1, inteligente: true };
  assert.notEqual(de(PASSO.divisoes), antes[PASSO.divisoes]);
  assert.equal(de(PASSO.trocar), antes[PASSO.trocar]);
  assert.equal(de(PASSO.planta), antes[PASSO.planta]);
  // Escolher o que fazer a um aparelho: muda Trocar e reparar (e as Divisões, que mostram o mesmo aparelho); a Planta não.
  e.planta.elementos[0].acao = 'substituir'; e.planta.elementos[0].inteligente = true;
  assert.notEqual(de(PASSO.trocar), antes[PASSO.trocar]);
  assert.equal(de(PASSO.planta), antes[PASSO.planta]);
  e.planta.elementos[1].x = 80;
  assert.notEqual(de(PASSO.planta), antes[PASSO.planta]);
  // Quadro: é a foto que se confirma.
  assert.notEqual(de(PASSO.quadro, 1234), de(PASSO.quadro, 99));
  assert.equal(de(PASSO.quadro, 1234), de(PASSO.quadro, 1234));
  // O estado guarda as confirmações (só as dos passos com janela, texto curto) e recarregar mantém-nas.
  assert.deepEqual(estadoNovo().confirmados, {});
  e.confirmados = { [PASSO.quer]: de(PASSO.quer), [PASSO.casa]: 'x', [PASSO.trocar]: 'y'.repeat(60), [PASSO.melhorias]: 7 };
  const n = normalizarEstado(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(n.confirmados, { [PASSO.quer]: de(PASSO.quer) });
  assert.deepEqual(normalizarEstado({ ...JSON.parse(JSON.stringify(e)), confirmados: 'sim' }).confirmados, {});
});

test('potência contratada pelo tamanho da casa: T0/T1 3,45 · T2/T3 6,9 · T4/T5+ 10,35 · sem tipologia 6,9; a escolha do cliente fica', async () => {
  const { potenciaOmissao, POTENCIA_OMISSAO_KVA } = await import('../../web/simulador/estado.js');
  assert.deepEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5+'].map((t) => potenciaOmissao({ tipologia: t })), [3.45, 3.45, 6.9, 6.9, 10.35, 10.35]);
  for (const casa of [null, {}, { tipologia: null }, { tipo: 'servicos', tipologia: null }, { tipologia: 'T9' }]) assert.equal(potenciaOmissao(casa), POTENCIA_OMISSAO_KVA);
  const e = estadoNovo();
  assert.deepEqual([e.casa.potencia_contratada_kva, e.potenciaEditada], [6.9, false]);
  // Guardar e carregar mantém a escolha; um estado de antes (sem o campo) com outro valor que não 6,9 conta como escolha.
  e.casa.potencia_contratada_kva = 10.35; e.potenciaEditada = true;
  assert.deepEqual([normalizarEstado(JSON.parse(JSON.stringify(e))).potenciaEditada, normalizarEstado(JSON.parse(JSON.stringify(e))).casa.potencia_contratada_kva], [true, 10.35]);
  const antes = JSON.parse(JSON.stringify(e)); delete antes.potenciaEditada;
  assert.equal(normalizarEstado(antes).potenciaEditada, true);
  antes.casa.potencia_contratada_kva = 6.9;
  assert.equal(normalizarEstado(antes).potenciaEditada, false);
});
