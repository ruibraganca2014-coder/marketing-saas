// Simulador, lote 7 (docs/SIMULADOR-ORCAMENTO.md §0, §3, §6): serviço pedido (passo 1) e ação por aparelho
// (Manter, Reparar, Substituir, Novo) — preço, migração dos estados antigos, pedido e lista de trabalho do relatório.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acaoOmissao, soReparacoes, precisaEscolher, faltaAcao, plantaNovos, pedidosAcoes, acaoDe, contarAcoes,
  inteligenteDe, plantaInteligentes,
} from '../../web/simulador/acoes.js';
import { acertarPlantaMexida, plantaDaCasa, divisoesDaCasa, zonaRotulo, tapaRotulo } from '../../web/simulador/casa.js';
import { pedidosDaSelecao, calcularPreco, horasTroca, quadroNoPedido, encontrarArtigo } from '../../web/simulador/preco.js';
import { estadoNovo, normalizarEstado, montarSimulacao, PASSOS } from '../../web/simulador/estado.js';
import { contarPlanta, divisoesDaContagem, temPergunta } from '../../web/simulador/regras.js';
import { circuitosExistentes, existentesNoQuadroNovo, resumoQuadro, avisosProtecoes } from '../../web/simulador/quadro.js';
import { listaTrabalho, aVerificarNaVisita, visitaTxt, urgenciaDe } from '../public/ecras/simulacao.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS].filter((a) => a.ativo !== false);

/** Cozinha com 2 tomadas, 2 interruptores, 1 luz, uma placa e a porta. */
function planta(acoes = {}) {
  const el = (id, tipo, props = {}) => ({ id, tipo, x_cm: 100, y_cm: 100, rot: 0, piso: 0, divisao: 'd1', props, ...(acoes[id] ?? {}) });
  return {
    escala_cm: 50, largura_cm: 1000, altura_cm: 800, fundo: null, respostas: true,
    divisoes: [{ id: 'd1', nome: 'Cozinha', piso: 0, x_cm: 0, y_cm: 0, largura_cm: 400, altura_cm: 300 }],
    elementos: [
      el('e1', 'tomada', { dupla: false, inteligente: false }), el('e2', 'tomada', { dupla: false, inteligente: false }),
      el('e3', 'interruptor', { botoes: 1 }), el('e4', 'interruptor', { botoes: 2 }), el('e5', 'luz'),
      el('e6', 'maquina', { modelo: 'placa', potencia_w: 7200 }), el('e7', 'porta', { entrada: false }),
    ],
  };
}

test('serviço: ação por omissão, fluxo curto e o que falta responder', () => {
  assert.equal(acaoOmissao(['nova']), 'novo');
  assert.equal(acaoOmissao(['nova', 'reparar']), 'novo', 'com Instalação nova junto de outro, a omissão é Novo');
  assert.equal(acaoOmissao(['automatizar']), 'manter');
  assert.equal(acaoOmissao(['reparar']), 'manter');
  assert.ok(soReparacoes(['reparar']) && !soReparacoes(['reparar', 'automatizar']));
  assert.ok(!precisaEscolher(['nova']) && precisaEscolher(['automatizar']) && !precisaEscolher(['reparar']));
  const t = { tipo: 'tomada', props: {} };
  assert.deepEqual(faltaAcao(t, ['nova']), [], 'Novo por omissão já conta como resposta');
  assert.deepEqual(faltaAcao(t, ['automatizar']), ['acao'], 'sem Instalação nova tem de escolher');
  assert.deepEqual(faltaAcao({ ...t, acao: 'reparar' }, ['automatizar']), ['avaria']);
  assert.deepEqual(faltaAcao({ ...t, acao: 'reparar', avaria: 'queimada' }, ['automatizar']), []);
  assert.deepEqual(faltaAcao({ ...t, acao: 'substituir' }, ['nova']), ['inteligente']);
  assert.deepEqual(faltaAcao({ tipo: 'maquina', props: { modelo: 'placa' }, acao: 'substituir' }, ['nova']), [], 'máquinas: sem "por um inteligente?"');
  assert.deepEqual(faltaAcao({ tipo: 'porta', props: {} }, ['automatizar']), [], 'a porta não tem ação');
  assert.equal(acaoDe({ tipo: 'janela', props: { estore: false }, acao: 'reparar' }, ['nova']), 'novo', 'janela sem estore: sem ação');
});

test('Instalação nova sem ações: os mesmos pedidos de antes mais os pontos novos (ronda regras)', () => {
  const p = planta();
  const antes = divisoesDaContagem(contarPlanta(p));
  const agora = divisoesDaContagem(contarPlanta(plantaNovos(p, ['nova'])));
  assert.deepEqual(agora, antes);
  const base = { casa: null, quadro: { circuitos: [] }, extras: {} };
  const pa = pedidosDaSelecao({ ...base, divisoes: antes }).map(({ chave, qtd }) => ({ chave, qtd }));
  const pn = pedidosDaSelecao({ ...base, servico: ['nova'], planta: p, divisoes: agora }).map(({ chave, qtd }) => ({ chave, qtd }));
  // Os pontos novos com preço fechado (2 tomadas, 2 interruptores, 1 luz) juntam-se; o resto é igual.
  const pontos = [{ chave: 'ponto_tomada', qtd: 2 }, { chave: 'ponto_interruptor', qtd: 2 }, { chave: 'ponto_luz', qtd: 1 }];
  assert.deepEqual(pn, [...pa, ...pontos]);
  assert.equal(calcularPreco(pn, CATALOGO, null).total, calcularPreco([...pa, ...pontos], CATALOGO, null).total);
});

test('preço por ação: Manter 0 €, Reparar = diagnóstico, Substituir = aparelho + horas de troca', () => {
  const p = planta({
    e1: { acao: 'reparar', avaria: 'queimada' },
    e2: { acao: 'substituir', inteligente: true },
    e3: { acao: 'substituir', inteligente: false },
    e4: { acao: 'manter' },
    e5: { acao: 'manter' },
    e6: { acao: 'substituir' },
  });
  const sv = ['automatizar', 'reparar'];
  assert.deepEqual(contarAcoes(p, sv), { manter: 2, reparar: 1, substituir: 3, novo: 0 });
  assert.deepEqual(pedidosAcoes(p, sv).map((x) => `${x.acao}:${x.chave}×${x.qtd}`).sort(),
    ['reparar:diagnostico×1', 'substituir:aparelho_normal×1', 'substituir:tomada×1', 'substituir:troca_maquina×1']);
  const divisoes = divisoesDaContagem(contarPlanta(plantaNovos(p, sv)));
  assert.deepEqual(divisoes[0].interruptores, [], 'Manter e Substituir não entram nas linhas dos Novos');
  const pedidos = pedidosDaSelecao({ casa: null, servico: sv, planta: p, quadro: { circuitos: [] }, divisoes, extras: {} });
  const preco = calcularPreco(pedidos, CATALOGO, null);
  const linha = (sku) => preco.linhas.find((l) => l.sku === sku);
  assert.equal(linha('DIAG-AVARIA').total, 25);
  assert.equal(linha('DIAG-AVARIA').horas, 0.5);
  assert.equal(linha('TOMADA-WIFI').grupo, 'substituir');
  // TOMADA-WIFI não tem horas_troca: 50 % das 0,1 h de instalação.
  assert.equal(linha('TOMADA-WIFI').horas, 0.05);
  assert.equal(linha('APARELHO-NORMAL').horas, 0.25, 'horas_troca do catálogo');
  assert.equal(linha('TROCA-MAQUINA').horas, 0.5);
  assert.equal(horasTroca({ horas_instalacao: 1, horas_troca: null }), 0.5);
  assert.equal(horasTroca({ horas_instalacao: 1, horas_troca: 0.3 }), 0.3);
});

test('quadro no pedido: sempre com Instalação nova; sem ela, só se o cliente quiser melhorar o quadro', () => {
  assert.ok(quadroNoPedido({}), 'estado sem serviço (antigo)');
  assert.ok(quadroNoPedido({ servico: ['nova', 'reparar'] }));
  assert.ok(!quadroNoPedido({ servico: ['automatizar'] }));
  assert.ok(quadroNoPedido({ servico: ['reparar'], mexerQuadro: true }));
  const e = estadoNovo();
  e.servico = ['reparar'];
  assert.ok(!pedidosDaSelecao(e).some((x) => x.grupo === 'quadro'), 'só reparações: sem diferenciais nem caixa');
  e.servico = ['nova'];
  assert.ok(pedidosDaSelecao(e).some((x) => x.grupo === 'quadro'));
});

test('automatizar + quadro novo: um disjuntor 1P+N por circuito que a casa já tem (estimativa pelas divisões)', () => {
  // 1 piso: Sala, 2 Quartos, Corredor (4 secas → 2 de tomadas), Cozinha e Casa de banho (1 cada) + 1 iluminação = 5.
  // 2.º piso: Quarto (1 seca → 1 de tomadas) + 1 iluminação = 2. Total 7.
  const d = (id, nome, piso = 0) => ({ id, nome, piso, x_cm: 0, y_cm: 0, largura_cm: 300, altura_cm: 300 });
  const pl = { escala_cm: 50, largura_cm: 2000, altura_cm: 1500, fundo: null, respostas: true, elementos: [],
    divisoes: [d('d1', 'Sala'), d('d2', 'Quarto'), d('d3', 'Quarto 2'), d('d4', 'Corredor'), d('d5', 'Cozinha'), d('d6', 'Casa de banho'), d('d7', 'Quarto 3', 1)] };
  assert.equal(circuitosExistentes({ planta: pl }), 7);
  assert.equal(circuitosExistentes({ planta: null, divisoes: [] }), 2, 'pelo menos iluminação e tomadas');
  const e = estadoNovo();
  e.servico = ['automatizar'];
  e.planta = pl;
  e.mexerQuadro = true;
  e.quadro.quadro_novo = 'novo';
  e.quadro.circuitos = [];
  const disj = () => pedidosDaSelecao(e).find((x) => x.chave === 'disjuntor_circuito')?.qtd ?? 0;
  assert.equal(existentesNoQuadroNovo(e), 7);
  assert.equal(disj(), 7, 'MCB-1PN-C × 7');
  assert.equal(resumoQuadro(e).circuitos_existentes, 7);
  assert.ok(avisosProtecoes(e).some((a) => /n\.º de circuitos a confirmar na visita/.test(a)));
  e.quadro.quadro_novo = 'atual';
  assert.equal(disj(), 0, 'quadro atual: os disjuntores já lá estão');
  e.quadro.quadro_novo = null;
  assert.equal(disj(), 7, '"Não sei" conta como quadro novo (por precaução)');
  e.mexerQuadro = false;
  assert.equal(existentesNoQuadroNovo(e), 0, 'sem mexer no quadro');
  e.mexerQuadro = true;
  e.servico = ['nova', 'automatizar'];
  assert.equal(existentesNoQuadroNovo(e), 0, 'com Instalação nova os circuitos são todos novos');
});

test('pedido de automatizar/reparar com quadro: avisos e circuitos_existentes pelo mesmo cálculo dos artigos', () => {
  const d = (id, nome, piso = 0) => ({ id, nome, piso, x_cm: 0, y_cm: 0, largura_cm: 300, altura_cm: 300 });
  const pl = { escala_cm: 50, largura_cm: 2000, altura_cm: 1500, fundo: null, respostas: true, elementos: [],
    divisoes: [d('d1', 'Sala'), d('d2', 'Quarto'), d('d3', 'Quarto 2'), d('d4', 'Corredor'), d('d5', 'Cozinha'), d('d6', 'Casa de banho'), d('d7', 'Quarto 3', 1)] };
  for (const servico of [['automatizar'], ['reparar']]) {
    const e = estadoNovo();
    e.servico = servico;
    e.planta = pl;
    e.mexerQuadro = true;
    e.quadro.quadro_novo = null;   // "Não sei": o aviso diz o tamanho do quadro novo incluído
    e.quadro.circuitos = [];
    const pedidos = pedidosDaSelecao(e);
    const caixa = pedidos.find((x) => x.grupo === 'quadro' && /^caixa_\d+$/.test(x.chave));
    const sim = montarSimulacao(e, calcularPreco(pedidos, CATALOGO, null), 'base', []);
    assert.equal(sim.quadro.circuitos_existentes, 7, 'simulacao.quadro leva circuitos_existentes');
    assert.ok(sim.avisos.some((a) => /Quadro novo com os circuitos que a casa já tem: contámos 7/.test(a)), servico.join());
    const aviso = sim.avisos.find((a) => /quadro novo de \d+ módulos/.test(a));
    assert.ok(aviso && caixa, 'aviso e caixa do quadro');
    assert.equal(Number(aviso.match(/quadro novo de (\d+) módulos/)[1]), Number(caixa.chave.slice(6)), 'o aviso diz a caixa do preço');
    assert.equal(sim.quadro.modulos.tamanho, Number(caixa.chave.slice(6)));
  }
});

test('estados antigos: 6 passos → 9 (cada passo no seu equivalente), sem serviço = Instalação nova; ações da planta guardadas', () => {
  assert.deepEqual(PASSOS, ['Início', 'A casa', 'Equipamentos', 'Planta', 'Quadro elétrico', 'Divisões', 'Trocar e reparar', 'Orçamento', 'Enviar', 'Avaria', 'Melhorias', 'Relatório básico', 'Relatório completo']);
  const velho = { ...estadoNovo(), passos: 6, ordem: 4, passo: 2, visitado: 3 };
  delete velho.servico;
  const e = normalizarEstado(velho);
  assert.equal(e.passo, 5, 'Divisões (2) → 5');
  assert.equal(e.visitado, 4, 'o quadro (3 → 4) também já foi visto; agora vem depois das Divisões e da Planta');
  const noResumo = normalizarEstado({ ...estadoNovo(), passos: 6, ordem: 4, passo: 4, visitado: 5 });
  assert.deepEqual([noResumo.passo, noResumo.visitado], [7, 7], 'Resumo (4) → Resumo (7); nunca volta direto ao Enviar');
  assert.deepEqual(e.servico, ['nova']);
  const novo = normalizarEstado({ ...estadoNovo(), servico: ['reparar', 'x'], planta: planta({ e1: { acao: 'reparar', avaria: 'x'.repeat(300) }, e7: { acao: 'reparar' }, e2: { acao: 'voar' } }) });
  assert.deepEqual(novo.servico, ['reparar']);
  const el = (id) => novo.planta.elementos.find((x) => x.id === id);
  assert.equal(el('e1').acao, 'reparar');
  assert.equal(el('e1').avaria.length, 200, 'descrição até 200 caracteres');
  assert.equal(el('e7').acao, undefined, 'a porta não tem ação');
  assert.equal(el('e2').acao, undefined, 'ação desconhecida sai');
  const semServico = normalizarEstado({ ...estadoNovo(), servico: [] });
  assert.deepEqual(semServico.servico, [], 'estado novo sem escolha: continua por escolher');
});

test('lote 8: 7 passos (ordem 5) e 8 (ordem 6) → 9 com "Planta" e "Trocar e reparar"; ações e avarias mantêm-se; quadro com problemas, visita e urgência', () => {
  const ac = { e1: { acao: 'reparar', avaria: 'queimada' }, e3: { acao: 'substituir', inteligente: true } };
  for (const [antes, depois] of [[0, 0], [2, 2], [3, 5], [4, 5], [5, 7], [6, 7]]) {
    const e = normalizarEstado({ ...estadoNovo(), passos: 7, ordem: 5, passo: antes, visitado: antes, servico: ['automatizar'], planta: planta(ac) });
    assert.equal(e.passo, depois, `passo ${antes} → ${depois}`);
    assert.equal(e.planta.elementos.find((x) => x.id === 'e1').avaria, 'queimada');
    assert.equal(e.planta.elementos.find((x) => x.id === 'e3').acao, 'substituir');
    assert.deepEqual(e.visita, { dias: [], periodo: 'qualquer' });
    assert.equal(e.urgencia, 'normal');
    assert.equal(e.quadroAvaria, null);
  }
  assert.equal(normalizarEstado({ ...estadoNovo(), passos: 7, ordem: 5, passo: 5, visitado: 6 }).visitado, 7, 'do Enviar volta ao Resumo, como antes');
  for (const [antes, depois] of [[3, 5], [4, 5], [5, 6], [6, 7], [7, 7]]) {
    assert.equal(normalizarEstado({ ...estadoNovo(), passos: 8, ordem: 6, passo: antes, visitado: antes }).passo, depois, `8 passos: ${antes} → ${depois}`);
  }
  const n = normalizarEstado({ ...estadoNovo(), visita: { dias: ['sex', 'seg', 'dom', 'seg'], periodo: 'noite' }, urgencia: 'ja', quadroAvaria: 'x'.repeat(300) });
  assert.deepEqual(n.visita, { dias: ['seg', 'sex'], periodo: 'qualquer' });
  assert.equal(n.urgencia, 'normal');
  assert.equal(n.quadroAvaria.length, 200);

  // Quadro com problemas: mais um diagnóstico (25 €), no pedido (`quadro.avaria`) e no relatório.
  const e = estadoNovo();
  e.servico = ['reparar'];
  e.planta = planta(ac);
  e.quadroAvaria = 'o geral vai abaixo';
  e.visita = { dias: ['ter', 'qui'], periodo: 'tarde' };
  e.urgencia = 'urgente';
  e.divisoes = divisoesDaContagem(contarPlanta(plantaNovos(e.planta, e.servico)));
  const pedidos = pedidosDaSelecao(e);
  assert.deepEqual(pedidos.filter((p) => p.chave === 'diagnostico'), [{ chave: 'diagnostico', qtd: 2, acao: 'reparar' }]);
  const preco = calcularPreco(pedidos, CATALOGO, null);
  const sim = montarSimulacao(e, preco, 'base', []);
  assert.equal(sim.quadro.avaria, 'o geral vai abaixo');
  assert.deepEqual(sim.visita, { dias: ['ter', 'qui'], periodo: 'tarde' });
  assert.equal(sim.urgencia, 'urgente');
  assert.equal(sim.totais_acao.reparar.aparelhos, 2, 'o aparelho e o quadro');
  assert.equal(sim.totais_acao.reparar.artigos_iva, 50);
  assert.equal(montarSimulacao({ ...e, quadroAvaria: null }, preco, 'base', []).quadro.avaria, null);
  // Painel: ficha e relatório.
  assert.equal(visitaTxt(sim), 'Terça e quinta, à tarde');
  assert.equal(visitaTxt({ visita: { dias: [], periodo: 'qualquer' } }), 'Qualquer dia, a qualquer hora');
  assert.equal(visitaTxt({}), null, 'pedidos antigos: sem disponibilidade');
  assert.equal(urgenciaDe(sim), 'urgente');
  assert.equal(urgenciaDe({ urgencia: 'x' }), null);
  const v = aVerificarNaVisita(sim);
  assert.equal(v[0].tema, 'Urgência');
  assert.match(v[0].texto, /URGENTE.*terça e quinta, à tarde/);
  assert.ok(v.some((x) => x.tema === 'Reparação' && /Quadro elétrico — «o geral vai abaixo»/.test(x.texto)));
  assert.ok(aVerificarNaVisita({ ...sim, urgencia: 'normal' }).some((x) => x.tema === 'Visita' && /terça e quinta/.test(x.texto)));
});

test('pedido (§6): serviço, ação por aparelho, lista de trabalho e totais por ação; relatório técnico', () => {
  const e = estadoNovo();
  e.servico = ['reparar'];
  e.planta = planta({ e1: { acao: 'reparar', avaria: 'queimada' }, e3: { acao: 'substituir', inteligente: true } });
  e.divisoes = divisoesDaContagem(contarPlanta(plantaNovos(e.planta, e.servico)));
  const pedidos = pedidosDaSelecao(e);
  const preco = calcularPreco(pedidos, CATALOGO, null);
  const linhaArtigo = (chave, acao) => ({ sku: chave === 'diagnostico' ? 'DIAG-AVARIA' : 'INT-VIDRO-1', horas: acao === 'substituir' ? 0.25 : 0.5 });
  const sim = montarSimulacao(e, preco, 'base', [{ chave: 'd1:tomada', tipo: 'tomada', legenda: 'Cozinha — Tomadas' }], linhaArtigo);
  assert.deepEqual(sim.servico, ['reparar']);
  const el = (id) => sim.planta.elementos.find((x) => x.id === id);
  assert.deepEqual([el('e1').acao, el('e1').avaria], ['reparar', 'queimada']);
  assert.deepEqual([el('e3').acao, el('e3').inteligente], ['substituir', true]);
  assert.equal(el('e2').acao, 'manter', 'a ação que vale vai sempre');
  assert.equal(el('e7').acao, undefined);
  assert.equal(sim.quadro.no_preco, false);
  assert.equal(sim.totais_acao.reparar.aparelhos, 1);
  assert.equal(sim.totais_acao.reparar.artigos_iva, 25);
  assert.equal(sim.totais_acao.manter.aparelhos, 4);
  const rep = sim.trabalho[0].acoes.find((a) => a.acao === 'reparar');
  assert.deepEqual({ ...rep }, { acao: 'reparar', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'DIAG-AVARIA', qtd: 1 }], horas: 0.5, foto: 'd1:tomada', avarias: ['queimada'] });
  assert.ok(sim.itens.every((i) => i.grupo && 'horas' in i));
  assert.ok(sim.avisos.some((a) => /ficam nos circuitos que já existem/.test(a)));

  const lista = listaTrabalho(sim, { 'DIAG-AVARIA': { nome: 'Diagnóstico de avaria' } });
  assert.equal(lista.divisoes.length, 1);
  const txt = lista.divisoes[0].linhas.map((l) => `${l.acao}: ${l.texto}`);
  assert.deepEqual(txt, ['reparar: 1 tomada («queimada» — ver foto)', 'substituir: 1 interruptor por um inteligente (sem foto)']);
  assert.equal(lista.divisoes[0].linhas[0].material, 'Diagnóstico de avaria ×1');
  assert.equal(lista.manter, 4);
  const v = aVerificarNaVisita(sim).filter((x) => x.tema === 'Reparação');
  assert.equal(v.length, 1);
  assert.match(v[0].texto, /Cozinha: tomada — «queimada» \(ver foto\)/);
});

test('pedidos antigos (sem serviço nem ações): lista de trabalho com tudo Novo e o circuito da placa', () => {
  const sim = {
    planta: planta(),
    quadro: { circuitos: [{ n: 3, tipo: 'maquina', divisoes: ['Cozinha'], itens: { maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } }] },
  };
  const l = listaTrabalho(sim);
  assert.equal(l.divisoes[0].linhas.length, 1);
  assert.equal(l.divisoes[0].linhas[0].acao, 'novo');
  assert.match(l.divisoes[0].linhas[0].texto, /2 tomadas.*circuito novo para placa/);
});

test('tomadas e interruptores normais por omissão; "Luzes pelo telemóvel" → interruptores novos inteligentes; sem pergunta obrigatória', () => {
  assert.equal(temPergunta('tomada', {}), false);
  assert.equal(temPergunta('interruptor', { botoes: 1 }), false);
  assert.equal(temPergunta('janela', {}), true);
  const int = { id: 'e1', tipo: 'interruptor', props: { botoes: 2 } };
  const tom = { id: 'e2', tipo: 'tomada', props: { dupla: false, inteligente: false } };
  assert.equal(inteligenteDe(int, []), false);
  assert.equal(inteligenteDe(int, ['luzes']), true);
  assert.equal(inteligenteDe({ ...int, inteligente: false }, ['luzes']), false);   // a resposta do cliente manda
  assert.equal(inteligenteDe(tom, ['poupar']), false);
  assert.equal(inteligenteDe({ ...tom, props: { inteligente: true } }, []), true);  // estado antigo já respondido
  assert.equal(inteligenteDe({ ...tom, inteligente: true }, []), true);             // "Por uma inteligente?" em Trocar e reparar
  const p = planta();
  const semObj = divisoesDaContagem(contarPlanta(plantaInteligentes(p, [])));
  const comLuzes = divisoesDaContagem(contarPlanta(plantaInteligentes(p, ['luzes'])));
  assert.deepEqual(semObj[0].interruptores, []);
  assert.equal(comLuzes[0].interruptores.length, 2);
  // Estados antigos: tomadas/interruptores "por responder" passam a normais sem bloquear.
  const velho = normalizarEstado({ ...estadoNovo(), planta: { ...p, elementos: p.elementos.map((e) => ({ ...e, por_responder: true })) } });
  assert.equal(velho.planta.elementos.filter((e) => e.por_responder).length, 0);
});

test('planta mexida: acrescenta/tira só a máquina ou a divisão que mudou (divisão mais parecida com dica)', () => {
  const casa = { tipo: 'apartamento', tipologia: 'T1', casas_banho: 1, salas: 1, pisos: 1, extras: { kitnet: true } };
  const sinc = (c, maquinas) => ({ divisoes: divisoesDaCasa(c, []).map((d) => ({ nome: d.nome, piso: d.piso ?? 0 })), maquinas, fase: 'tudo' });
  const p = plantaDaCasa(casa, []);
  p.divisoes.at(-1).x_cm += 50;   // o cliente mexeu (a última, para a direita)
  const antes = JSON.stringify(p.divisoes);
  const n = p.elementos.length;
  const placa = [{ modelo: 'placa', qtd: 1, piso: null }];
  const dicas = acertarPlantaMexida(p, sinc(casa, []), sinc(casa, placa), { casa });
  assert.equal(JSON.stringify(p.divisoes), antes);
  assert.equal(p.elementos.length, n + 1);
  const m = p.elementos.find((e) => e.tipo === 'maquina');
  assert.equal(p.divisoes.find((d) => d.id === m.divisao).nome, 'Kitnet');
  assert.deepEqual(dicas, ['Placa de cozinha: posta na Kitnet.']);
  acertarPlantaMexida(p, sinc(casa, placa), sinc(casa, []), { casa });
  assert.equal(p.elementos.length, n);
  // Mais um quarto e a garagem: aparecem ao lado, sem sobrepor; desmarcar tira só essas.
  const casa2 = { ...casa, tipologia: 'T2', extras: { kitnet: true, garagem: true } };
  acertarPlantaMexida(p, sinc(casa, []), sinc(casa2, []), { casa: casa2 });
  assert.deepEqual(p.divisoes.map((d) => d.nome).slice(-3).sort(), ['Corredor', 'Garagem', 'Quarto 2']);   // T2: também o corredor
  for (const a of p.divisoes) for (const b of p.divisoes) {
    if (a === b) continue;
    const livre = a.x_cm >= b.x_cm + b.largura_cm || b.x_cm >= a.x_cm + a.largura_cm || a.y_cm >= b.y_cm + b.altura_cm || b.y_cm >= a.y_cm + a.altura_cm;
    assert.ok(livre, `${a.nome} sobrepõe ${b.nome}`);
  }
  acertarPlantaMexida(p, sinc(casa2, []), sinc(casa, []), { casa });
  assert.equal(JSON.stringify(p.divisoes), antes);
  assert.equal(p.elementos.length, n);
});

test('máquinas postas automaticamente não caem no nome/medidas da divisão (planta T2 gerada e mexida)', () => {
  const casa = { tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1, pisos: 1, extras: {} };
  const sinc = (maquinas) => ({ divisoes: divisoesDaCasa(casa, []).map((d) => ({ nome: d.nome, piso: d.piso ?? 0 })), maquinas, fase: 'tudo' });
  const maquinas = ['placa', 'forno', 'frigorifico', 'ar_condicionado', 'termoacumulador'].map((modelo) => ({ modelo, qtd: 1, piso: null }));
  const semRotulo = (p, caso) => {
    const ms = p.elementos.filter((e) => e.tipo === 'maquina');
    assert.ok(ms.length > 0, caso);
    for (const m of ms) for (const d of p.divisoes) {
      assert.ok(!tapaRotulo(zonaRotulo(d), m.x_cm, m.y_cm), `${caso}: ${m.props.modelo} (${m.x_cm}, ${m.y_cm}) sobre o nome de ${d.nome}`);
    }
  };
  semRotulo(plantaDaCasa(casa, maquinas), 'gerada');
  // Planta mexida (o caso do forno: a cozinha arrastada −350, +300 para cima da sala; o forno caía em "3,5 × 3 m · 10,5 m²"):
  // cada divisão arrastada, com os aparelhos, para vários sítios; depois o forno.
  const soForno = ['forno'].map((modelo) => ({ modelo, qtd: 1, piso: null }));
  const base = plantaDaCasa(casa, []);
  for (const alvo of base.divisoes) for (const [dx, dy] of [[250, -50], [-350, 300], [-400, 450], [250, 250], [0, 400]]) {
    if (alvo.x_cm + dx < 0 || alvo.y_cm + dy < 0) continue;
    const p = structuredClone(base);
    const d = p.divisoes.find((x) => x.id === alvo.id);
    d.x_cm += dx; d.y_cm += dy;
    for (const e of p.elementos) if (e.divisao === d.id) { e.x_cm += dx; e.y_cm += dy; }
    acertarPlantaMexida(p, sinc([]), sinc(soForno), { casa });
    semRotulo(p, `${alvo.nome} +${dx},${dy}`);
  }
});

test('lista de trabalho = preço: a mesma decisão (normal/inteligente, artigo, horas) em Novo, Trocar e Reparar', () => {
  // Como app.js linhaArtigo: SKU e horas por unidade (Substituir: as horas de troca).
  const linhaArtigo = (chave, acao) => {
    const a = encontrarArtigo(chave, CATALOGO);
    return { sku: a.sku, horas: acao === 'substituir' ? horasTroca(a) : Number(a.horas_instalacao) };
  };
  const cenarios = [
    { servico: ['nova'], objetivos: [], acoes: {} },
    { servico: ['nova'], objetivos: ['luzes'], acoes: {} },
    { servico: ['nova'], objetivos: ['luzes'], acoes: { e3: { inteligente: false }, e1: { inteligente: true } } },
    { servico: ['nova'], objetivos: [], acoes: { e4: { inteligente: true }, e2: { inteligente: false } } },
    { servico: ['automatizar'], objetivos: ['luzes'], acoes: {
      e1: { acao: 'novo', inteligente: true }, e2: { acao: 'novo', inteligente: false }, e3: { acao: 'novo' },
      e4: { acao: 'substituir', inteligente: false }, e5: { acao: 'reparar', avaria: 'pisca' }, e6: { acao: 'substituir' } } },
    { servico: ['automatizar', 'reparar'], objetivos: [], acoes: {
      e1: { acao: 'substituir', inteligente: true }, e2: { acao: 'reparar', avaria: 'queimada' }, e3: { acao: 'novo', inteligente: true },
      e4: { acao: 'novo' }, e5: { acao: 'substituir' }, e6: { acao: 'manter' } } },
  ];
  for (const c of cenarios) {
    const e = estadoNovo();
    e.servico = c.servico;
    e.quer.objetivos = c.objetivos;
    e.planta = planta(c.acoes);
    e.divisoes = divisoesDaContagem(contarPlanta(plantaInteligentes(plantaNovos(e.planta, e.servico), c.objetivos)));
    const preco = calcularPreco(pedidosDaSelecao(e), CATALOGO, null);
    const sim = montarSimulacao(e, preco, 'base', [], linhaArtigo);
    const doPreco = new Map(), daLista = new Map();
    let hPreco = 0, hLista = 0;
    for (const i of sim.itens.filter((x) => x.grupo !== 'quadro')) { doPreco.set(i.sku, (doPreco.get(i.sku) ?? 0) + i.qtd); hPreco += i.horas; }
    for (const g of sim.trabalho) for (const a of g.acoes) {
      for (const m of a.material) daLista.set(m.sku, (daLista.get(m.sku) ?? 0) + m.qtd);
      hLista += a.horas;
    }
    const txt = JSON.stringify(c);
    assert.deepEqual(Object.fromEntries([...daLista].sort()), Object.fromEntries([...doPreco].sort()), `material: ${txt}`);
    assert.equal(Math.round(hLista * 100), Math.round(hPreco * 100), `horas: ${txt}`);
  }
});

test('lista de trabalho: a foto de uma linha só vai para o grupo da ação que a pediu (não para o Manter)', () => {
  const e = estadoNovo();
  e.servico = ['reparar'];
  e.planta = planta({ e1: { acao: 'reparar', avaria: 'queimada' } });
  e.divisoes = [];
  const sim = montarSimulacao(e, calcularPreco(pedidosDaSelecao(e), CATALOGO, null), 'base', [{ chave: 'd1:tomada', tipo: 'tomada' }]);
  const tomadas = sim.trabalho[0].acoes.filter((a) => a.tipo === 'tomada');
  assert.deepEqual(tomadas.map((a) => [a.acao, a.foto]), [['manter', null], ['reparar', 'd1:tomada']]);
});

test('fora da área servida: os avisos do pedido terminam em "(orientativo — a confirmar)" (sem visita)', () => {
  const e = estadoNovo();
  e.servico = ['automatizar'];
  e.planta = planta({ e1: { acao: 'manter' } });
  e.divisoes = [];
  const preco = calcularPreco(pedidosDaSelecao(e), CATALOGO, null);
  const dentro = montarSimulacao(e, preco, 'base', []).avisos;
  const fora = montarSimulacao(e, { ...preco, deslocacao: { estado: 'fora_area', valor_iva: null } }, 'base', []).avisos;
  assert.ok(dentro.length && dentro.every((a) => a.endsWith('(orientativo — confirmamos na visita)')));
  assert.equal(fora.length, dentro.length);
  assert.ok(fora.every((a) => a.endsWith('(orientativo — a confirmar)') && !/na visita/.test(a)), fora.join('\n'));
});
