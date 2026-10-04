// Simulador, fase 1 — funis (docs/SIMULADOR-ORCAMENTO.md §0 "Funis — fase 1", §6): os passos de cada funil, a
// migração dos estados antigos, a casa guardada ("Já tenho a planta"), o pedido da avaria rápida (e o que o painel
// aceita e mostra) e o PDF do orçamento (estrutura válida, sem preços de compra).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoNovo, normalizarEstado, temProgresso, montarSimulacao, FUNIS, PASSO, PASSOS, passosDoFunil, guardarCasa, carregarCasa,
  resumoCasa, usarCasa, temCasa, CHAVE_CASA, FOTO_AVARIA, legendaAvaria, avariaPerigosa, ordemPasso, maisAdiantado, AVARIA_PROBLEMA, AVARIA_PERIGO,
} from '../../web/simulador/estado.js';
import { plantaDaCasa } from '../../web/simulador/casa.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { acaoDe, precisaEscolher, faltaAcao } from '../../web/simulador/acoes.js';
import { pdfDeImagens } from '../../web/simulador/pdf.js';
import { blocosOrcamento, blocosRelatorio } from '../../web/simulador/imprimir.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { aVerificarNaVisita, avariaTxt, ehAvaria, estimativaTxt } from '../public/ecras/simulacao.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES, SEMENTES_PONTOS } from '../src/catalogo-sementes.js';

const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES, ...SEMENTES_PONTOS].filter((a) => a.ativo !== false);
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

test('funis: duas partes — descrever a casa ~5 min (sem o passo Planta) e pedir um serviço ~5 min (fase 3 da auditoria: um só Relatório, Equipamentos pré-marcados, Enviar sem palavra-passe), já tenho planta ~5, avaria ~2; Melhorias antes do Orçamento; o 12 reformado)', () => {
  const min = (f) => Math.ceil(FUNIS[f].passos.reduce((s, i) => s + FUNIS[f].minutos[i], 0));
  assert.deepEqual(FUNIS.primeira.passos, [PASSO.inicio, PASSO.casa, PASSO.quer, PASSO.divisoes, PASSO.quadro, PASSO.relatorio]);
  assert.deepEqual(FUNIS.planta.passos, [PASSO.inicio, PASSO.trocar, PASSO.melhorias, PASSO.preco, PASSO.enviar]);
  assert.deepEqual([FUNIS.primeira.nome, FUNIS.planta.nome], ['Descrever a minha casa', 'Pedir um serviço'], 'decisão do dono (2026-10-04): duas partes');
  assert.deepEqual(FUNIS.avaria.passos, [PASSO.inicio, PASSO.avaria, PASSO.enviar]);
  assert.deepEqual([min('primeira'), min('planta'), min('avaria')], [5, 5, 2]);
  assert.ok(!FUNIS.primeira.passos.includes(PASSO.planta), 'decisão do dono (2026-10-04): o passo Planta saiu do funil');
  assert.ok(!Object.values(FUNIS).some((f) => f.passos.includes(PASSO.completo)), 'o Relatório completo (12) não está em nenhum funil');
  assert.equal(PASSOS[PASSO.relatorio], 'Relatório');
  assert.equal(FUNIS.primeira.minutos[PASSO.quadro], 1, 'B3: o passo Quadro é só a foto');
  assert.deepEqual(FUNIS.primeira.passos, [...FUNIS.primeira.passos].sort((a, b) => ordemPasso(a) - ordemPasso(b)), 'primeira: pela ordem dos passos');
  // O Relatório fecha "Descrever a minha casa"; "Pedir um serviço" já não passa por ele.
  assert.ok(FUNIS.primeira.passos.at(-1) === PASSO.relatorio && !FUNIS.planta.passos.includes(PASSO.relatorio));
  assert.deepEqual(passosDoFunil(null), FUNIS.primeira.passos, 'sem caso escolhido: os da primeira vez');
});

test('migração: o passo "Serviço" passa a Início; estados de 9 passos ficam no mesmo passo e no funil da primeira vez', () => {
  const v9 = (x) => ({ ...estadoNovo(), passos: 9, ordem: 8, ...x });
  const semNada = normalizarEstado(v9({ passo: 0, servico: [] }));
  assert.deepEqual([semNada.passo, semNada.funil], [0, null], 'no Serviço sem escolha: Início sem caso');
  assert.equal(temProgresso(semNada), false);
  const comServico = normalizarEstado(v9({ passo: 0, servico: ['automatizar'] }));
  assert.deepEqual([comServico.passo, comServico.funil, comServico.servico], [0, 'primeira', ['automatizar']]);
  // (Quem estava na Planta ou no Quadro volta às Divisões, que agora vêm antes deles.)
  for (const [antes, depois] of [[1, 1], [3, 5], [4, 5], [6, 6], [7, 7], [8, 7]]) {
    const e = normalizarEstado(v9({ passo: antes, visitado: antes, servico: ['nova'] }));
    assert.deepEqual([e.passo, e.funil], [depois, FUNIS.planta.passos.includes(depois) && depois !== PASSO.inicio ? 'planta' : 'primeira'], `passo ${antes} → ${depois}`);
  }
  // Estados de agora: nunca volta direto ao Enviar (avaria → Avaria); um passo fora do funil volta ao Início.
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'avaria', passo: PASSO.enviar }).passo, PASSO.avaria);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'planta', passo: PASSO.enviar }).passo, PASSO.preco);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'planta', passo: PASSO.planta }).passo, PASSO.inicio);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'x', passo: 3 }).funil, 'primeira');
  const av = normalizarEstado({ ...estadoNovo(), funil: 'avaria', passo: 9, avaria: { onde: 'cozinha', problema: 'fogo', descricao: 'x'.repeat(300) } });
  // Ronda B: onde e problema são listas (a string antiga passa a [valor]; as chaves desconhecidas saem).
  assert.deepEqual([av.avaria.onde, av.avaria.problema, av.avaria.descricao.length], [['cozinha'], [], 200]);
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
  assert.ok(!precisaEscolher(n.servico), 'a omissão Manter já conta como resposta (decisão do dono, 2026-10-03)');
  const comAcao = n.planta.elementos.filter((x) => ['tomada', 'interruptor'].includes(x.tipo));
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
  assert.deepEqual(sim.avaria, { onde: ['cozinha'], problema: ['sem_corrente'], descricao: 'A tomada do micro-ondas não dá nada' }, 'listas (ronda B)');
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
  assert.equal(avariaTxt(sim), 'Cozinha — Tomada sem corrente — «A tomada do micro-ondas não dá nada»');
  // Ronda B: várias escolhas (listas) e os pedidos antigos (uma string) — os dois formatos.
  const varias = { ...sim, avaria: { onde: ['sala', 'cozinha'], problema: ['luz', 'disjuntor'], descricao: '' } };
  assert.doesNotThrow(() => validarSimulacao(varias));
  assert.equal(avariaTxt(varias), 'Sala, Cozinha — Luz não acende, Disjuntor dispara');
  const antiga = { ...sim, avaria: { onde: 'sala', problema: 'faiscas', descricao: '' } };
  assert.doesNotThrow(() => validarSimulacao(antiga));
  assert.equal(avariaTxt(antiga), 'Sala — Faz faíscas');
  assert.doesNotThrow(() => validarSimulacao({ ...sim, avaria: { onde: ['exterior'], problema: ['choque'], descricao: '' } }));
  for (const mau of [{ onde: [] }, { onde: ['sala', 'sala'] }, { problema: ['fogo'] }, { problema: Array(8).fill('luz') }]) {
    assert.throws(() => validarSimulacao({ ...sim, avaria: { ...sim.avaria, ...mau } }), /inválido/, JSON.stringify(mau));
  }
  assert.equal(legendaAvaria({ onde: ['sala', 'cozinha'], problema: ['luz', 'choque'] }), 'Avaria — Luz não acende, Dá choque · Sala, Cozinha');
  assert.ok(avariaPerigosa({ problema: ['luz', 'choque'] }) && !avariaPerigosa({ problema: ['luz'] }));
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

test('ronda A: estados de antes dos relatórios (ordem 10 e 9) retomam com sentido na ordem nova', () => {
  const v10 = (x) => ({ ...estadoNovo(), passos: 11, ordem: 10, funil: 'primeira', servico: ['nova'], ...x });
  const r = (x) => { const e = normalizarEstado(x); return [e.passo, e.visitado, e.relatoriosPorVer]; };
  // Na Planta (antes: a seguir aos Equipamentos): as Divisões ainda não foram vistas → volta às Divisões.
  assert.deepEqual(r(v10({ passo: PASSO.planta, visitado: PASSO.planta })), [PASSO.divisoes, PASSO.divisoes, []]);
  // No Quadro (antes: a seguir à Planta): as Divisões por ver → volta às Divisões; Planta e Quadro ficam para depois.
  assert.deepEqual(r(v10({ passo: PASSO.quadro, visitado: PASSO.quadro })), [PASSO.divisoes, PASSO.divisoes, []]);
  // Ordem 11 (ronda A: Quadro antes das Divisões): no Quadro → Divisões; na Planta com tudo visto segue para o Quadro (o passo Planta saiu).
  const v11 = (x) => ({ ...estadoNovo(), passos: 13, ordem: 11, funil: 'primeira', servico: ['nova'], ...x });
  assert.deepEqual(r(v11({ passo: PASSO.quadro, visitado: PASSO.quadro })), [PASSO.divisoes, PASSO.divisoes, []]);
  assert.deepEqual(r(v11({ passo: PASSO.planta, visitado: PASSO.planta })), [PASSO.quadro, PASSO.quadro, []]);
  assert.deepEqual(r(v11({ passo: PASSO.preco, visitado: PASSO.preco, relatoriosPorVer: [PASSO.completo] })), [PASSO.preco, PASSO.preco, []], 'o 12 já não existe: nada por ver');
  assert.deepEqual(r(v11({ passo: PASSO.completo, visitado: PASSO.completo })), [PASSO.relatorio, PASSO.relatorio, []], 'no Relatório completo → Relatório (o fim de "Descrever a minha casa")');
  // Ordem 12 (ronda B: a ordem de agora com os dois relatórios): o 12 passa ao 11; o resto fica igual.
  const v12 = (x) => ({ ...estadoNovo(), passos: 13, ordem: 12, funil: 'primeira', servico: ['nova'], ...x });
  assert.deepEqual(r(v12({ passo: PASSO.completo, visitado: PASSO.completo })), [PASSO.relatorio, PASSO.relatorio, []]);
  assert.deepEqual(r(v12({ passo: PASSO.melhorias, visitado: PASSO.completo, relatoriosPorVer: [PASSO.completo] })), [PASSO.melhorias, PASSO.melhorias, []]);
  assert.deepEqual(r(v12({ passo: PASSO.preco, visitado: PASSO.preco, relatoriosPorVer: [PASSO.relatorio, PASSO.completo] })), [PASSO.preco, PASSO.preco, [PASSO.relatorio]]);
  assert.deepEqual(r(v12({ passo: PASSO.quadro, visitado: PASSO.quadro })), [PASSO.quadro, PASSO.quadro, []]);
  // Um estado de agora guardado no passo Planta (que saiu do funil) segue para o Quadro.
  assert.deepEqual(r({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.planta, visitado: PASSO.planta }), [PASSO.quadro, PASSO.quadro, []]);
  assert.deepEqual(r(v12({ funil: 'planta', passo: PASSO.completo, visitado: PASSO.completo })), [PASSO.preco, PASSO.preco, []], '"Pedir um serviço" já não tem Relatório: segue para o Orçamento');
  assert.equal(normalizarEstado(v12({ passo: PASSO.preco, visitado: PASSO.preco })).melhoriasPorVer, false, 'ordem 12 já tinha as Melhorias');
  assert.deepEqual(r(v12({ passo: PASSO.enviar, visitado: PASSO.enviar })), [PASSO.preco, PASSO.preco, []]);
  // Nas Divisões já tinha visto o Trocar: pode ir até ele pela barra; o Relatório básico fica por ver.
  // (Duas partes, 2026-10-04: "Trocar e reparar" já é de "Pedir um serviço"; na casa o mais adiantado fica no Quadro.)
  assert.deepEqual(r(v10({ passo: PASSO.divisoes, visitado: PASSO.trocar })), [PASSO.divisoes, PASSO.quadro, []]);
  // No Orçamento: fica lá; os dois relatórios ficam por ver (a barra não os dá como feitos).
  assert.deepEqual(r(v10({ passo: PASSO.preco, visitado: PASSO.preco })), [PASSO.preco, PASSO.preco, []]);   // duas partes: "Pedir um serviço" não tem Relatório
  assert.deepEqual(r(v10({ passo: PASSO.melhorias, visitado: PASSO.melhorias })), [PASSO.melhorias, PASSO.melhorias, []]);
  // Já tenho a planta: o Relatório é novo.
  assert.deepEqual(r(v10({ funil: 'planta', passo: PASSO.trocar, visitado: PASSO.preco })), [PASSO.trocar, PASSO.preco, []]);
  // Ordem 9 (antes das Melhorias) e 8 (antes dos funis): o mesmo, e as Melhorias por ver como antes.
  const v9 = normalizarEstado({ ...estadoNovo(), passos: 10, ordem: 9, funil: 'primeira', servico: ['nova'], passo: PASSO.preco, visitado: PASSO.preco });
  assert.deepEqual([v9.passo, v9.relatoriosPorVer, v9.melhoriasPorVer], [PASSO.preco, [], true]);
  const v8 = normalizarEstado({ ...estadoNovo(), passos: 9, ordem: 8, passo: PASSO.preco, visitado: PASSO.preco, servico: ['nova'] });
  assert.deepEqual([v8.passo, v8.relatoriosPorVer], [PASSO.preco, []]);
  // A avaria não muda.
  assert.deepEqual(r(v10({ funil: 'avaria', passo: PASSO.avaria, visitado: PASSO.avaria })), [PASSO.avaria, PASSO.avaria, []]);
  // Estados de agora: os relatórios por ver guardam-se (só os que ficaram para trás).
  const agora = normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.preco, visitado: PASSO.preco, relatoriosPorVer: [PASSO.relatorio, PASSO.completo, 99] });
  assert.deepEqual(agora.relatoriosPorVer, [PASSO.relatorio]);
  assert.deepEqual(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.planta, visitado: PASSO.planta, relatoriosPorVer: [PASSO.relatorio] }).relatoriosPorVer, []);
  // Fase 3 da auditoria: as 8 máquinas pré-marcadas só uma vez (querSugerido); um estado de antes com máquinas (ou já para lá dos Equipamentos) não as recebe.
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.casa, visitado: PASSO.casa }).querSugerido, false);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.casa, visitado: PASSO.casa, querSugerido: true }).querSugerido, true);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.quer, visitado: PASSO.divisoes }).querSugerido, true);
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], casa: { ...estadoNovo().casa, tipo: 'apartamento' }, quer: { maquinas: ['placa'], porPiso: { placa: { 0: 1 } } } }).querSugerido, true);
  assert.equal(maisAdiantado(PASSO.planta, PASSO.divisoes, PASSO.quadro), PASSO.quadro, 'o Quadro vem depois da Planta e das Divisões');
});

test('ronda A: "Já tenho a planta" → o que precisa (caminho) segue o funil; compras e avaria do Início guardam-se', () => {
  const n = (x) => normalizarEstado({ ...estadoNovo(), ...x });
  assert.equal(n({ funil: 'planta', caminho: 'automatizar' }).caminho, 'automatizar');
  assert.equal(n({ funil: 'primeira', caminho: 'carregar', servico: ['nova'] }).caminho, 'carregar');
  assert.equal(n({ funil: 'primeira', caminho: 'automatizar', servico: ['nova'] }).caminho, null, 'automatizar só no "Já tenho a planta"');
  assert.equal(n({ funil: 'planta', caminho: 'obras' }).caminho, 'obras', 'duas partes: as obras também se pedem em "Pedir um serviço"');
  assert.equal(normalizarEstado({ ...estadoNovo(), funil: 'primeira', servico: ['nova'], passo: PASSO.preco, visitado: PASSO.preco }).funil, 'planta', 'quem já estava no Orçamento passa a "Pedir um serviço"');
  assert.equal(n({ funil: 'avaria', caminho: 'reparar' }).caminho, null);
  assert.equal(n({ funil: 'planta', caminho: 'x' }).caminho, null);
  // Estado de antes (sem caminho), já para lá do Início no "Já tenho a planta": fica com o do serviço.
  assert.equal(normalizarEstado({ ...estadoNovo(), passos: 11, ordem: 10, funil: 'planta', servico: ['automatizar', 'reparar'], passo: PASSO.trocar, visitado: PASSO.trocar }).caminho, 'automatizar');
  // O relatório completo escolhido num passo é o mesmo que o passo Enviar mostra (estado.compras).
  assert.deepEqual(n({ compras: { relatorio: true, visita: 'sim' } }).compras, { relatorio: true, visita: false });
  // "O que se passa" no Início: as chaves novas e as perigosas (aviso de segurança).
  assert.deepEqual(Object.keys(AVARIA_PROBLEMA), ['sem_corrente', 'luz', 'disjuntor', 'queimado', 'faiscas', 'choque', 'outro']);
  assert.ok(AVARIA_PERIGO.every((k) => AVARIA_PROBLEMA[k]));
  assert.deepEqual(n({ funil: 'avaria', avaria: { problema: ['choque', 'luz', 'x'] } }).avaria.problema, ['luz', 'choque'], 'várias escolhas');
});

test('ronda A: relatório básico em PDF — a casa, as divisões, o quadro e a potência, sem preços', () => {
  const b = blocosRelatorio({
    data: new Date('2026-10-01T12:00:00Z'), casa: 'Apartamento T2 · 5 divisões', divisoes: [{ nome: 'Sala', itens: '2 tomadas e 1 interruptor' }, { nome: 'Quarto', itens: '' }],
    quadro: ['8 circuitos · proteção básica', 'Quadro de 24 módulos'], potencia: 'Potência sugerida: 6,9 kVA.',
  });
  const txt = b.map((x) => x.texto).join('\n');
  assert.equal(b[1].texto, 'Relatório básico');
  assert.match(txt, /Sala: 2 tomadas e 1 interruptor/);
  assert.match(txt, /Quarto: sem aparelhos/);
  assert.match(txt, /Potência sugerida: 6,9 kVA/);
  assert.doesNotMatch(txt, /\d\s?€|compra|fornecedor|SKU/i, 'sem preços');
});
