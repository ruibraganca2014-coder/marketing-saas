// Simulador — inventário do passo "Divisões" e omissão Manter (docs/SIMULADOR-ORCAMENTO.md §0, decisões do dono de
// 2026-10-03): o passo levanta só os interruptores e as tomadas que a casa JÁ TEM (nada se assume: cada divisão fica por
// responder até o cliente dizer quantos tem e como é cada um, ou "Não tem"); pontos de luz, portas, janelas e sensores
// já não se levantam (só entram no preço pedidos como trabalho novo); o que a casa tem fica Manter (0 €).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoNovo, normalizarEstado, montarSimulacao, ORDEM, PASSO,
  TIPOS_INVENTARIO, inventarioDivisao, divisoesPorInventariar, marcarNaoTem, naoTem, inventarioParaEnvio, soCasaDe,
} from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { contarPlanta, divisoesDaContagem, sugerirCircuitos, circuitoVazio, numerar } from '../../web/simulador/regras.js';
import { plantaNovos, plantaInteligentes, contarAcoes, faltaAcao, acaoDe } from '../../web/simulador/acoes.js';
import { pedidosDaSelecao, calcularPreco, comObraMinima } from '../../web/simulador/preco.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { intervaloEstimativa } from '../src/pagamentos-pedido.js';
import { inventarioTxt } from '../public/ecras/simulacao.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS, SEMENTES_PONTOS_20, SEMENTES_DINHEIRO } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS, ...SEMENTES_PONTOS_20, ...SEMENTES_DINHEIRO].filter((a) => a.ativo !== false);
const T2 = { tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };

/** T2 com a planta desenhada pela casa; as divisões e os circuitos como app.js acertarPedido (circuitos base com "Instalação nova"). */
function casaT2(servico = ['nova']) {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = servico;
  e.casa = { ...e.casa, ...T2 };
  e.planta = plantaDaCasa(e.casa, []);
  e.plantaFase = 'tudo';
  return acertar(e);
}
function acertar(e) {
  const cont = contarPlanta(plantaInteligentes(plantaNovos(e.planta, e.servico), []));
  e.divisoes = divisoesDaContagem(cont);
  const c = sugerirCircuitos(cont, {});
  const de = (tipo, nome) => { const l = c.filter((x) => x.tipo === tipo); return l.length || !e.servico.includes('nova') ? l : [{ ...circuitoVazio(0, tipo), nome }]; };
  e.quadro.circuitos = numerar([...de('iluminacao', 'Iluminação'), ...de('tomadas', 'Tomadas'), ...c.filter((x) => x.tipo === 'maquina')]);
  return e;
}
const preco = (e) => comObraMinima(calcularPreco(pedidosDaSelecao(e), CATALOGO, {}, { valor_iva: 0 }));
const doTipo = (e, d, tipo) => e.planta.elementos.filter((x) => x.tipo === tipo && x.divisao === d.id);
/** Responde a tudo numa divisão: cada interruptor com `botoes`, cada tomada com `caixas`. */
function responder(e, d, botoes = 1, caixas = 1) {
  for (const x of doTipo(e, d, 'interruptor')) { x.props.botoes = botoes; x.confirmado = true; }
  for (const x of doTipo(e, d, 'tomada')) { x.props.caixas = caixas; x.props.dupla = caixas === 2; x.confirmado = true; }
}

test('a casa só desenha porta, interruptor e tomadas: pontos de luz, janelas e sensores já não se levantam', () => {
  const e = casaT2();
  assert.deepEqual([...new Set(e.planta.elementos.map((x) => x.tipo))].sort(), ['interruptor', 'porta', 'tomada']);
  assert.deepEqual(TIPOS_INVENTARIO, ['interruptor', 'tomada']);
});

test('uma divisão fica por responder até os interruptores E as tomadas estarem respondidos; "Não tem" é uma resposta', () => {
  const e = casaT2();
  const [sala] = e.planta.divisoes;
  // Nada se assume: os que a planta traz são sugestões (nenhum respondido), nem o "1 botão" de omissão conta.
  let inv = inventarioDivisao(e, e.planta, sala);
  assert.equal(inv.interruptor.els.length, 1);
  assert.deepEqual([inv.interruptor.falta, inv.interruptor.respondido, inv.tomada.falta, inv.tomada.respondido, inv.respondida], [1, false, 3, false, false]);
  assert.equal(divisoesPorInventariar(e, e.planta).length, e.planta.divisoes.length, 'todas por responder ao chegar ao passo');
  // Só os interruptores respondidos: ainda falta.
  for (const x of doTipo(e, sala, 'interruptor')) { x.props.botoes = 2; x.confirmado = true; }
  inv = inventarioDivisao(e, e.planta, sala);
  assert.deepEqual([inv.interruptor.respondido, inv.tomada.respondido, inv.respondida], [true, false, false]);
  // Duas das três tomadas: falta uma.
  const toms = doTipo(e, sala, 'tomada');
  toms[0].confirmado = true;
  toms[1].confirmado = true;
  assert.deepEqual([inventarioDivisao(e, e.planta, sala).tomada.falta, inventarioDivisao(e, e.planta, sala).respondida], [1, false]);
  toms[2].props.caixas = 3;
  toms[2].confirmado = true;
  assert.equal(inventarioDivisao(e, e.planta, sala).respondida, true);
  assert.equal(divisoesPorInventariar(e, e.planta).some((d) => d.id === sala.id), false);
  // "Não tem": sem tomadas na divisão e a resposta dada; sem a resposta, zero aparelhos não conta como respondido.
  const cozinha = e.planta.divisoes[1];
  responder(e, cozinha);
  e.planta.elementos = e.planta.elementos.filter((x) => !(x.tipo === 'tomada' && x.divisao === cozinha.id));
  assert.equal(inventarioDivisao(e, e.planta, cozinha).tomada.respondido, false, 'zero tomadas sem "Não tem": por responder');
  marcarNaoTem(e, 'tomada', cozinha, true, e.planta.divisoes);
  assert.ok(naoTem(e, 'tomada', cozinha));
  inv = inventarioDivisao(e, e.planta, cozinha);
  assert.deepEqual([inv.tomada.sem, inv.tomada.respondido, inv.respondida], [true, true, true]);
  // Desmarcar volta a ficar por responder; com uma tomada na divisão o "Não tem" antigo deixa de valer.
  marcarNaoTem(e, 'tomada', cozinha, false, e.planta.divisoes);
  assert.equal(inventarioDivisao(e, e.planta, cozinha).respondida, false);
  marcarNaoTem(e, 'tomada', cozinha, true, e.planta.divisoes);
  e.planta.elementos.push({ id: 'e900', tipo: 'tomada', x_cm: cozinha.x_cm + 50, y_cm: cozinha.y_cm + 50, rot: 0, piso: 0, divisao: cozinha.id, props: { dupla: false, inteligente: false, caixas: 1 } });
  inv = inventarioDivisao(e, e.planta, cozinha);
  assert.deepEqual([inv.tomada.sem, inv.tomada.falta, inv.respondida], [false, 1, false]);
  // Uma divisão com outro nome (planta redesenhada) não herda o "Não tem".
  assert.equal(naoTem(e, 'tomada', { ...cozinha, nome: 'Copa' }), false);
});

test('botões e tipos de tomada: ida e volta no estado guardado e no pedido enviado (planta e inventário)', () => {
  const e = casaT2();
  const [sala, cozinha, ...resto] = e.planta.divisoes;
  const ints = doTipo(e, sala, 'interruptor'), toms = doTipo(e, sala, 'tomada');
  Object.assign(ints[0], { confirmado: true }).props.botoes = 3;
  [1, 2, 3].forEach((c, i) => { toms[i].props.caixas = c; toms[i].props.dupla = c === 2; toms[i].confirmado = true; });
  // Cozinha: os interruptores respondidos e "Não tem" tomadas.
  for (const x of doTipo(e, cozinha, 'interruptor')) { x.props.botoes = 4; x.confirmado = true; }
  e.planta.elementos = e.planta.elementos.filter((x) => !(x.tipo === 'tomada' && x.divisao === cozinha.id));
  marcarNaoTem(e, 'tomada', cozinha, true, e.planta.divisoes);
  const g = normalizarEstado(JSON.parse(JSON.stringify(e)));
  assert.equal(g.ordem, ORDEM);
  const el = (id) => g.planta.elementos.find((x) => x.id === id);
  assert.deepEqual([el(ints[0].id).props.botoes, el(ints[0].id).confirmado], [3, true]);
  assert.deepEqual(toms.map((t) => [el(t.id).props.caixas, el(t.id).props.dupla, el(t.id).confirmado]), [[1, false, true], [2, true, true], [3, false, true]]);
  assert.deepEqual(g.naoTem, e.naoTem);
  assert.equal(inventarioDivisao(g, g.planta, g.planta.divisoes[0]).respondida, true);
  assert.equal(inventarioDivisao(g, g.planta, g.planta.divisoes[1]).respondida, true);
  // Os que ninguém respondeu continuam por responder; `confirmado` só existe nos interruptores e nas tomadas.
  assert.equal(g.planta.elementos.filter((x) => x.divisao === resto[0].id).some((x) => x.confirmado), false);
  const porta = normalizarEstado({ ...JSON.parse(JSON.stringify(e)), planta: { ...e.planta, elementos: e.planta.elementos.map((x) => ({ ...x, confirmado: true })) } }).planta.elementos.find((x) => x.tipo === 'porta');
  assert.equal(porta.confirmado, undefined);
  // A casa guardada ("Já tenho a planta") leva as respostas.
  assert.deepEqual(soCasaDe(g).naoTem, g.naoTem);
  assert.equal(soCasaDe(g).planta.elementos.find((x) => x.id === ints[0].id).confirmado, true);
  // Pedido: os botões e as caixas vão na planta (props) e no inventário; por responder = null; "Não tem" = [].
  const sim = montarSimulacao(g, preco(g), 'base', []);
  const naPlanta = (id) => sim.planta.elementos.find((x) => x.id === id);
  assert.equal(naPlanta(ints[0].id).props.botoes, 3);
  assert.deepEqual(toms.map((t) => naPlanta(t.id).props.caixas), [1, 2, 3]);
  assert.equal(naPlanta(ints[0].id).confirmado, undefined, 'a marca não vai na planta: vai o inventário');
  assert.deepEqual(sim.inventario[0], { divisao: sala.id, nome: 'Sala', piso: 0, interruptores: [3], tomadas: [1, 2, 3] });
  assert.deepEqual(sim.inventario[1], { divisao: cozinha.id, nome: 'Cozinha', piso: 0, interruptores: [4], tomadas: [] });
  assert.deepEqual([sim.inventario[2].interruptores, sim.inventario[2].tomadas], [null, null], 'por responder');
  assert.equal(inventarioParaEnvio(estadoNovo(), estadoNovo().planta), null, 'sem planta');
  assert.doesNotThrow(() => validarSimulacao(sim));
});

test('preço: o que a casa já tem (Manter) não soma nada; luz, sensor e estore só entram pedidos como trabalho novo', () => {
  // Automatizar com tudo em Manter: nada no orçamento, e cada divisão está respondida sem nenhum toque.
  const a = casaT2(['automatizar']);
  assert.deepEqual(pedidosDaSelecao(a), []);
  assert.ok(a.planta.elementos.every((x) => acaoDe(x, a.servico) === 'manter' && faltaAcao(x, a.servico).length === 0));
  assert.deepEqual(contarAcoes(a.planta, a.servico), { manter: a.planta.elementos.filter((x) => x.tipo !== 'porta').length, reparar: 0, substituir: 0, novo: 0 });
  // "Instalação nova" (decisão do dono, 2026-10-04): tudo começa em Novo — as tomadas e os interruptores entram como pontos novos.
  assert.ok(preco(casaT2(['nova'])).linhas.some((l) => /^(TOMADA|INTERRUPTOR)-/.test(l.sku)));
  const e = casaT2(['automatizar']);
  const base = preco(e);
  assert.ok(base.linhas.every((l) => !/^(PONTO-LUZ|TOMADA|INTERRUPTOR)-/.test(l.sku) && !/^(SENS|BAB-CURTAIN)/.test(l.sku)), base.linhas.map((l) => l.sku).join());
  // Responder ao inventário (botões, tipos) não mexe no preço: é o que a casa já tem.
  for (const d of e.planta.divisoes) responder(e, d, 2, 3);
  assert.equal(preco(acertar(e)).total, base.total);
  // Pedidos como novos ("Acrescentar um aparelho" em Trocar e reparar: `acao: "novo"`): 2 luzes, 1 sensor, 1 estore.
  const sala = e.planta.divisoes[0];
  const novo = (id, tipo, props = {}) => ({ id, tipo, x_cm: sala.x_cm + 100, y_cm: sala.y_cm + 100, rot: 0, piso: 0, divisao: sala.id, props, acao: 'novo' });
  e.planta.elementos.push(novo('e901', 'luz'), novo('e902', 'luz'), novo('e903', 'sensor_movimento'), novo('e904', 'janela', { estore: true, motorizado: true }));
  const com = preco(acertar(e));
  const qtd = (sku) => com.linhas.filter((l) => l.sku === sku).reduce((s, l) => s + l.qtd, 0);
  assert.deepEqual([qtd('PONTO-LUZ-NOVO'), qtd('SENS-PIR-WIFI'), qtd('BAB-CURTAIN')], [2, 1, 1]);
  assert.ok(com.total > base.total + 2 * 45);
  // Os mesmos aparelhos sem ação (desenhados antes de "Trocar e reparar": o que a casa tem) não somam nada.
  for (const x of e.planta.elementos) if (/^e90/.test(x.id)) delete x.acao;
  assert.equal(preco(acertar(e)).total, base.total);
  // A janela pedida como nova guarda a ação mesmo antes de ter estore (marca-se a seguir).
  const j = normalizarEstado({ ...JSON.parse(JSON.stringify(e)), planta: { ...e.planta, elementos: [novo('e905', 'janela', { estore: false, motorizado: false })] } }).planta.elementos[0];
  assert.equal(j.acao, 'novo');
});

test('estado de antes (ordem 13): tomadas e interruptores ficam sugestões por responder; luzes sem ação saem; escolhas ficam', () => {
  const e = casaT2(['automatizar']);
  const sala = e.planta.divisoes[0];
  const luz = (id, extra = {}) => ({ id, tipo: 'luz', x_cm: sala.x_cm + 100, y_cm: sala.y_cm + 100, rot: 0, piso: 0, divisao: sala.id, props: {}, ...extra });
  e.planta.elementos.push(luz('e901'), luz('e902', { acao: 'reparar', avaria: 'não acende' }), luz('e903', { acao: 'novo' }));
  const ints = doTipo(e, sala, 'interruptor');
  ints[0].props.botoes = 2;
  ints[0].acao = 'substituir';
  ints[0].inteligente = true;
  // Um estado de antes nunca teve `confirmado` nem `naoTem`; se os trouxesse (adulterado), caíam.
  ints[0].confirmado = true;
  const velho = { ...JSON.parse(JSON.stringify(e)), ordem: 13, passo: PASSO.preco, visitado: PASSO.preco, naoTem: { interruptor: ['d1:Sala'], tomada: ['d1:Sala'] } };
  const n = normalizarEstado(velho);
  assert.equal(n.ordem, ORDEM);
  assert.deepEqual([n.passo, n.visitado], [PASSO.preco, PASSO.preco], 'fica no seu passo (o "Seguinte", a barra e o Enviar levam-no às Divisões)');
  assert.deepEqual(n.naoTem, { interruptor: [], tomada: [] });
  assert.equal(n.planta.elementos.some((x) => x.confirmado), false);
  assert.equal(divisoesPorInventariar(n, n.planta).length, n.planta.divisoes.length, 'todas as divisões por responder');
  assert.deepEqual(n.planta.elementos.filter((x) => x.tipo === 'luz').map((x) => [x.id, x.acao]), [['e902', 'reparar'], ['e903', 'novo']], 'a luz sem ação (a que a casa desenhava) sai');
  const i = n.planta.elementos.find((x) => x.id === ints[0].id);
  assert.deepEqual([i.props.botoes, i.acao, i.inteligente], [2, 'substituir', true], 'o valor fica como sugestão e a escolha fica');
  // Os aparelhos que só tinham a omissão seguem a do serviço: Manter (com "Instalação nova" seria Novo).
  const semEscolha = n.planta.elementos.filter((x) => x.tipo === 'tomada');
  assert.ok(semEscolha.length && semEscolha.every((x) => x.acao === undefined && acaoDe(x, n.servico) === 'manter'));
  // Um estado de agora mantém tudo.
  const agora = normalizarEstado({ ...velho, ordem: ORDEM });
  assert.equal(agora.planta.elementos.find((x) => x.id === ints[0].id).confirmado, true);
  assert.equal(agora.planta.elementos.some((x) => x.id === 'e901'), true);
  assert.deepEqual(agora.naoTem, { interruptor: ['d1:Sala'], tomada: ['d1:Sala'] });
});

test('servidor: aceita o pedido de antes (sem inventário) e o novo; recusa um inventário mal formado; calcula o mesmo intervalo', () => {
  const e = casaT2(['automatizar']);
  for (const d of e.planta.divisoes) responder(e, d, 1, 2);
  const sala = e.planta.divisoes[0];
  e.planta.elementos.push({ id: 'e901', tipo: 'luz', x_cm: sala.x_cm + 100, y_cm: sala.y_cm + 100, rot: 0, piso: 0, divisao: sala.id, props: {}, acao: 'novo' });
  const p = preco(acertar(e));
  const sim = montarSimulacao(e, p, 'base', []);
  assert.ok(sim.inventario.every((d) => Array.isArray(d.interruptores) && Array.isArray(d.tomadas)));
  assert.doesNotThrow(() => validarSimulacao(JSON.parse(JSON.stringify(sim))));
  // O pedido de antes: sem `inventario` (ou null) e com a ação "novo" em tudo — continua aceite tal como chega.
  const antigo = JSON.parse(JSON.stringify(sim));
  delete antigo.inventario;
  for (const x of antigo.planta.elementos) if (x.acao) x.acao = 'novo';
  assert.doesNotThrow(() => validarSimulacao(antigo));
  assert.doesNotThrow(() => validarSimulacao({ ...antigo, inventario: null }));
  assert.equal(JSON.parse(validarSimulacao(antigo)).planta.elementos.find((x) => x.tipo === 'tomada').acao, 'novo', 'guardado como chegou (nada se recalcula)');
  for (const inventario of ['x', [1], [{ interruptores: [5] }], [{ interruptores: [0] }], [{ tomadas: [4] }], [{ tomadas: 'dupla' }], [{ interruptores: [1.5] }], Array.from({ length: 41 }, () => ({}))]) {
    assert.throws(() => validarSimulacao({ versao: 1, inventario }), /Inventário/, JSON.stringify(inventario).slice(0, 40));
  }
  // O servidor faz as contas pelos `itens` do pedido: o intervalo dele é o do simulador.
  assert.deepEqual(intervaloEstimativa(p.total, {}), { min: p.trabalhos_min, max: p.trabalhos_max });
  assert.equal(sim.itens.find((i) => i.sku === 'PONTO-LUZ-NOVO').qtd, 1);
  assert.equal(sim.itens.some((i) => i.sku === 'TOMADA-NOVA' || i.sku === 'INTERRUPTOR-NOVO'), false, 'o que a casa já tem não vai nos itens');
  // Ficha do painel: "Tem hoje (dito pelo cliente)".
  assert.equal(inventarioTxt({ interruptores: [1, 2], tomadas: [1, 1, 2, 3] }), '2 interruptores (1 + 2 bot.) · 4 tomadas (2 simples, 1 dupla, 1 tripla)');
  assert.equal(inventarioTxt({ interruptores: [], tomadas: [3] }), 'sem interruptores · 1 tomada (1 tripla)');
  assert.equal(inventarioTxt({ interruptores: null, tomadas: null }), null);
  assert.equal(inventarioTxt(undefined), null);
});

test('passo Enviar: nome, telefone, localidade e morada obrigatórios, pela ordem do ecrã; o email é o da conta', async () => {
  const { problemaContacto, montarPedido } = await import('../../web/simulador/estado.js');
  const ok = { nome: 'Ana', telefone: '912 345 678', email: 'ana@exemplo.pt', localidade: 'Sintra', morada: 'Rua A, 1', mensagem: '' };
  assert.equal(problemaContacto(ok), null);
  assert.equal(problemaContacto({ ...ok, email: '' }), null, 'o email não é pedido aqui (é o da conta)');
  assert.deepEqual(problemaContacto({ nome: '', telefone: '', localidade: '', morada: '' }).campo, 'nome');
  assert.deepEqual(problemaContacto({ ...ok, telefone: ' ' }), { campo: 'telefone', texto: 'Falta o telefone: escreva o número (ex.: 912 345 678).' });
  assert.equal(problemaContacto({ ...ok, telefone: '', localidade: '', morada: '' }).campo, 'telefone', 'o primeiro em falta, pela ordem do ecrã');
  assert.equal(problemaContacto({ ...ok, localidade: '', morada: '' }).campo, 'localidade');
  assert.deepEqual(problemaContacto({ ...ok, morada: '' }), { campo: 'morada', texto: 'Falta a morada da obra.' });
  // Um rascunho antigo sem telefone nem morada: os campos ficam vazios e pedem-se ao enviar.
  const velho = normalizarEstado({ ...estadoNovo(), contacto: { nome: 'Ana', email: 'ana@exemplo.pt', localidade: 'Sintra' } });
  assert.deepEqual([velho.contacto.telefone, velho.contacto.morada], ['', '']);
  assert.equal(problemaContacto(velho.contacto).campo, 'telefone');
  for (const telefone of ['912345678', '912 345 678', '+351 912 345 678', '00351 912 345 678', '+44 20 7946 0958']) assert.equal(problemaContacto({ ...ok, telefone }), null, telefone);
  assert.equal(problemaContacto({ ...ok, telefone: '12' }).campo, 'telefone');
  // O corpo do pedido não mudou: os mesmos campos de antes (o email da conta continua a ir; o servidor usa o da sessão).
  const corpo = montarPedido({ ...estadoNovo(), contacto: ok }, { versao: 1 });
  assert.deepEqual(Object.keys(corpo), ['nome', 'servico', 'telefone', 'email', 'localidade', 'morada', 'simulacao']);
});
