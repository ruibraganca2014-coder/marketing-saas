// Simulador, fase 1 — funis (docs/SIMULADOR-ORCAMENTO.md §0 "Funis — fase 1", §6): os passos de cada funil, a
// migração dos estados antigos, a casa guardada ("Já tenho a planta"), o pedido da avaria rápida (e o que o painel
// aceita e mostra) e o PDF do orçamento (estrutura válida, sem preços de compra).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoNovo, normalizarEstado, temProgresso, montarSimulacao, FUNIS, PASSO, passosDoFunil, guardarCasa, carregarCasa,
  resumoCasa, usarCasa, temCasa, CHAVE_CASA, FOTO_AVARIA, legendaAvaria,
} from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { acaoDe, precisaEscolher, faltaAcao } from '../../web/simulador/acoes.js';
import { pdfDeImagens } from '../../web/simulador/pdf.js';
import { blocosOrcamento } from '../../web/simulador/imprimir.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { aVerificarNaVisita, avariaTxt, ehAvaria, estimativaTxt } from '../public/ecras/simulacao.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
const armazem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

/** Apartamento T2 com a planta desenhada pela casa (a do passo Planta). */
function casaT2() {
  const e = estadoNovo();
  e.funil = 'primeira';
  e.servico = ['nova'];
  e.casa = { ...e.casa, tipo: 'apartamento', tipologia: 'T2', quartos: 2, casas_banho: 1, salas: 1 };
  e.planta = plantaDaCasa(e.casa, []);
  e.plantaFase = 'tudo';
  e.passo = PASSO.preco;
  e.visitado = PASSO.preco;
  return e;
}

test('funis: passos e tempos (primeira ~14 min, já tenho planta ~5, avaria ~2; Melhorias antes do Orçamento)', () => {
  const min = (f) => Math.ceil(FUNIS[f].passos.reduce((s, i) => s + FUNIS[f].minutos[i], 0));
  assert.deepEqual(FUNIS.primeira.passos, [0, 1, 2, 3, 4, 5, 6, PASSO.melhorias, 7, 8]);
  assert.deepEqual(FUNIS.planta.passos, [PASSO.inicio, PASSO.trocar, PASSO.melhorias, PASSO.preco, PASSO.enviar]);
  assert.deepEqual(FUNIS.avaria.passos, [PASSO.inicio, PASSO.avaria, PASSO.enviar]);
  assert.deepEqual([min('primeira'), min('planta'), min('avaria')], [14, 5, 2]);
  assert.deepEqual(passosDoFunil(null), FUNIS.primeira.passos, 'sem caso escolhido: os da primeira vez');
});

test('migração: o passo "Serviço" passa a Início; estados de 9 passos ficam no mesmo passo e no funil da primeira vez', () => {
  const v9 = (x) => ({ ...estadoNovo(), passos: 9, ordem: 8, ...x });
  const semNada = normalizarEstado(v9({ passo: 0, servico: [] }));
  assert.deepEqual([semNada.passo, semNada.funil], [0, null], 'no Serviço sem escolha: Início sem caso');
  assert.equal(temProgresso(semNada), false);
  const comServico = normalizarEstado(v9({ passo: 0, servico: ['automatizar'] }));
  assert.deepEqual([comServico.passo, comServico.funil, comServico.servico], [0, 'primeira', ['automatizar']]);
  for (const [antes, depois] of [[1, 1], [3, 3], [6, 6], [7, 7], [8, 7]]) {
    const e = normalizarEstado(v9({ passo: antes, visitado: antes, servico: ['nova'] }));
    assert.deepEqual([e.passo, e.funil], [depois, 'primeira'], `passo ${antes} → ${depois}`);
  }
  // Estados de agora: nunca volta direto ao Enviar (avaria → Avaria); um passo fora do funil volta ao Início.
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'avaria', passo: PASSO.enviar }).passo, PASSO.avaria);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'planta', passo: PASSO.enviar }).passo, PASSO.preco);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'planta', passo: PASSO.planta }).passo, PASSO.inicio);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'x', passo: 3 }).funil, 'primeira');
  const av = normalizarEstado({ ...estadoNovo(), funil: 'avaria', passo: 9, avaria: { onde: 'cozinha', problema: 'fogo', descricao: 'x'.repeat(300) } });
  assert.deepEqual([av.avaria.onde, av.avaria.problema, av.avaria.descricao.length], ['cozinha', null, 200]);
  assert.equal(temProgresso(av), true);
});

test('o contacto vindo do perfil da conta não é progresso (um estado vazio não vai para a conta por cima da casa guardada)', () => {
  const e = estadoNovo();
  e.contacto = { ...e.contacto, nome: 'Ana', telefone: '912 345 678', email: 'ana@exemplo.pt', morada: 'Rua A, 1', localidade: 'Oeiras' };
  assert.equal(temProgresso(e), false);
  assert.equal(temProgresso(normalizarEstado(e)), false);
  e.funil = 'avaria';
  assert.equal(temProgresso(e), true, 'escolher um caso já é progresso');
});

test('casa guardada: sem as ações do pedido; "Já tenho a planta" põe tudo em Manter e o pedido leva funil "planta"', () => {
  const e = casaT2();
  const tomada = e.planta.elementos.find((x) => x.tipo === 'tomada');
  tomada.acao = 'reparar';
  tomada.avaria = 'queimada';
  const st = armazem();
  assert.equal(guardarCasa(st, e), true);
  assert.ok(st.m.has(CHAVE_CASA));
  const c = carregarCasa(st);
  assert.ok(c && c.soCasa && temCasa(c));
  assert.equal(temProgresso(c), false, 'só a casa não é uma simulação em curso');
  assert.equal(resumoCasa(c), `Apartamento T2, ${e.planta.divisoes.length} divisões`);
  assert.ok(c.planta.elementos.every((x) => x.acao === undefined && x.avaria === undefined), 'sem ações nem avarias');
  assert.equal(carregarCasa(armazem()), null);

  const n = usarCasa(estadoNovo(), c);
  assert.equal(n.funil, 'planta');
  assert.deepEqual(n.servico, ['automatizar', 'reparar']);
  assert.ok(precisaEscolher(n.servico));
  const comAcao = n.planta.elementos.filter((x) => ['tomada', 'interruptor', 'luz'].includes(x.tipo));
  assert.ok(comAcao.length && comAcao.every((x) => acaoDe(x, n.servico) === 'manter' && !faltaAcao(x, n.servico).length), 'tudo Manter e respondido');
  n.planta.elementos.find((x) => x.tipo === 'tomada').acao = 'substituir';
  n.planta.elementos.find((x) => x.tipo === 'tomada').inteligente = true;
  const sim = montarSimulacao(n, calcularPreco([], CATALOGO, null), 'base', []);
  assert.equal(sim.funil, 'planta');
  assert.equal(montarSimulacao(e, calcularPreco([], CATALOGO, null), 'base', []).funil, 'primeira');
  assert.doesNotThrow(() => validarSimulacao(sim));
});

test('avaria rápida (§6): funil "avaria", serviço reparar, avaria, foto e diagnóstico; sem planta; o painel aceita e mostra', () => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada do micro-ondas não dá nada' };
  e.urgencia = 'urgente';
  e.contacto.localidade = 'Oeiras';
  const preco = calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], CATALOGO, null);
  const legenda = legendaAvaria(e.avaria);
  assert.equal(legenda, 'Avaria — Tomada sem corrente · Cozinha');
  const sim = montarSimulacao(e, preco, null, [{ chave: FOTO_AVARIA, legenda }]);
  assert.equal(sim.funil, 'avaria');
  assert.deepEqual(sim.servico, ['reparar']);
  assert.deepEqual(sim.avaria, { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada do micro-ondas não dá nada' });
  assert.equal(sim.planta, null);
  assert.equal(sim.quadro, null);
  assert.deepEqual(sim.trabalho, []);
  assert.equal(sim.totais_acao.reparar.aparelhos, 1);
  assert.deepEqual(sim.itens.map((i) => [i.sku, i.qtd, i.grupo]), [['DIAG-AVARIA', 1, 'reparar']]);
  assert.ok(sim.total.min > 0);
  assert.equal(sim.total.max, sim.total.min, 'o diagnóstico é um valor fixo (sem intervalo)');
  assert.equal(sim.total.min, Math.round((preco.artigos_iva + preco.mao_obra_iva) * 100) / 100, 'sem a deslocação');
  assert.match(estimativaTxt(sim), /^\d+,\d{2}\s€ \+ deslocação$/, 'no painel: o diagnóstico fixo, sem intervalo');
  assert.equal(sim.urgencia, 'urgente');
  assert.deepEqual(sim.fotos, [{ chave: FOTO_AVARIA, tipo: 'avaria', divisao: null, divisao_nome: 'Cozinha', piso: null, legenda }]);
  assert.equal(sim.casa.localidade, 'Oeiras');
  assert.doesNotThrow(() => validarSimulacao(sim));
  assert.throws(() => validarSimulacao({ ...sim, funil: 'outro' }), /Funil inválido/);
  assert.throws(() => validarSimulacao({ ...sim, avaria: { ...sim.avaria, onde: 'sotao' } }), /onde inválido/);
  assert.throws(() => validarSimulacao({ ...sim, avaria: { ...sim.avaria, descricao: 'x'.repeat(201) } }), /200 caracteres/);
  // Painel: ficha e "A verificar na visita" (sem potência nem ligação a confirmar num pedido sem casa).
  assert.ok(ehAvaria(sim));
  assert.equal(avariaTxt(sim), 'Tomada sem corrente · Cozinha — «A tomada do micro-ondas não dá nada»');
  const v = aVerificarNaVisita(sim);
  assert.equal(v[0].tema, 'Avaria');
  assert.match(v[0].texto, /ver foto.*sem planta/i);
  assert.ok(!v.some((x) => ['Potência contratada', 'Ligação'].includes(x.tema)));
});

test('PDF do orçamento: blocos sem preços de compra e um PDF válido (uma página por imagem)', () => {
  const b = blocosOrcamento({
    data: new Date('2026-09-30T12:00:00Z'), casa: 'Apartamento T2 · 5 divisões · Oeiras', intervalo: '690 € – 930 € + deslocação',
    inclui: ['3 tomadas inteligentes', 'Instalação por técnico habilitado'],
    planos: [{ nome: 'Base', preco: '4,99 € por mês', sugerido: false }, { nome: 'Conforto', preco: '9,99 € por mês', sugerido: true }],
    nota: 'Estimativa; valor final após a visita.',
  });
  const txt = b.map((x) => x.texto).join('\n');
  assert.equal(b[0].texto, 'Domus Energia');
  assert.match(txt, /30 de setembro de 2026/);
  assert.match(txt, /690 € – 930 €/);
  assert.match(txt, /Conforto: 9,99 € por mês \(sugerido\)/);
  assert.equal(b.at(-1).texto, 'Estimativa; valor final após a visita.');
  assert.doesNotMatch(txt, /compra|fornecedor|SKU|DIAG-|TONGOU/i);
  // O PDF (pdf.js): cabeçalho, 3 páginas, a tabela de referências aponta para cada objeto.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pag = { jpeg, largura_px: 10, altura_px: 10, largura_pt: 595.28, altura_pt: 841.89 };
  const bytes = pdfDeImagens([pag, pag, { ...pag, largura_pt: 841.89, altura_pt: 595.28 }]);
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.match(s, /\/Type \/Pages \/Kids \[3 0 R 6 0 R 9 0 R\] \/Count 3/);
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.ok(s.slice(xref).startsWith('xref'));
  const offs = [...s.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(offs.length, 11);
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`));
});
