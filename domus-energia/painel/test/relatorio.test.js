// Relatório técnico do orçamento (painel/public/ecras/simulacao.js aVerificarNaVisita): a secção
// "A VERIFICAR NA VISITA" sai das respostas "Não sei", dos avisos e do que a simulação calculou.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aVerificarNaVisita } from '../public/ecras/simulacao.js';

const temas = (l) => l.map((x) => x.tema);
const texto = (l, tema) => l.filter((x) => x.tema === tema).map((x) => x.texto).join(' | ');

test('"Não sei" (para-raios, quadro, potência, ligação), localidade não reconhecida e avisos', () => {
  const l = aVerificarNaVisita({
    casa: { potencia_contratada_kva: null, fases: null },
    quadro: { circuitos: [], pacote: 'recomendado', protecoes: { descarregador: true }, para_raios: null, quadro_novo: null, quadro_novo_no_preco: true, modulos: { tamanho: 18, novos: 6 }, potencia_sugerida_kva: 6.9, potencia_carga_w: 5400 },
    deslocacao: { estado: 'visita', localidade: 'Aldeia X', valor_iva: 10 },
    avisos: ['Este circuito pode não aguentar. (orientativo — confirmamos na visita)'],
  });
  assert.match(texto(l, 'Para-raios / linha aérea'), /NÃO SABE.*recomendado \(RTIEBT 801\.5\.10\) \(já está incluído\)/);
  assert.match(texto(l, 'Quadro elétrico'), /NÃO SABE se o quadro atual serve.*quadro novo por precaução.*6 módulos novos/);
  assert.match(texto(l, 'Potência contratada'), /NÃO SABE.*sugerida 6,9 kVA/);
  assert.match(texto(l, 'Ligação'), /NÃO SABE se a ligação é monofásica ou trifásica/);
  assert.match(texto(l, 'Localidade'), /«Aldeia X» não foi reconhecida/);
  assert.equal(texto(l, 'Aviso da simulação'), 'Este circuito pode não aguentar.', 'sem o "(orientativo…)"');
});

test('para-raios "sim", potência curta, trifásica, máquinas ≥ 2000 W, carregador e quadros parciais', () => {
  const planta = {
    divisoes: [
      { id: 'd1', nome: 'Cozinha', piso: 0, x_cm: 0, y_cm: 0, largura_cm: 400, altura_cm: 400, pontos: [[0, 0], [400, 0], [400, 200], [200, 400], [0, 400]] },
      { id: 'd2', nome: 'Quarto', piso: 1, x_cm: 0, y_cm: 0, largura_cm: 300, altura_cm: 300 },
      { id: 'd3', nome: 'Arrumos', piso: 1, x_cm: 400, y_cm: 0, largura_cm: 100, altura_cm: 100 },
    ],
    elementos: [
      { id: 'e1', tipo: 'luz', piso: 0, x_cm: 100, y_cm: 100, divisao: 'd1' },
      { id: 'e2', tipo: 'luz', piso: 1, x_cm: 100, y_cm: 100, divisao: 'd2' },
    ],
  };
  const l = aVerificarNaVisita({
    casa: { potencia_contratada_kva: 6.9, fases: 'tri' },
    planta,
    quadro: {
      circuitos: [
        { n: 1, nome: 'Iluminação', tipo: 'iluminacao', amperes: 10, divisoes: ['d1', 'd2'], itens: { luzes: 2, tomadas: 0, maquinas: [] } },
        { n: 2, nome: 'Placa', tipo: 'maquina', codigo: 'C3', amperes: 25, seccao_mm2: 6, diferencial: 1, inteligente: true, divisoes: ['d1'], itens: { maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } },
        { n: 3, nome: 'Carregador', tipo: 'maquina', amperes: 40, seccao_mm2: 10, diferencial: 3, divisoes: [], itens: { maquinas: [{ modelo: 'carregador_ve', potencia_w: 7400 }] } },
      ],
      pacote: 'essencial', protecoes: { descarregador: false }, para_raios: 'sim', quadro_novo: 'atual',
      diferenciais: [{ n: 3, circuitos: [3], carregador: true }],
      modulos: { tamanho: 24, quadros: 1, parciais: 1, tamanho_parcial: 12, novos: 14, cabe: true }, potencia_sugerida_kva: 10.35, potencia_carga_w: 9000,
    },
  });
  assert.match(texto(l, 'Para-raios / linha aérea'), /SIM.*NÃO está incluído/);
  assert.match(texto(l, 'Quadro elétrico'), /atual serve.*14 módulos novos \(acima de 12: ampliação incluída\)/);
  assert.match(texto(l, 'Potência contratada'), /6,9 kVA pode ser CURTA: sugerida 10,35 kVA/);
  assert.match(texto(l, 'Ligação'), /^Trifásica/);
  assert.match(texto(l, 'Máquina ≥ 2000 W'), /^Placa 7200 W — circuito 2 \(C3\): 25 A, cabo 6 mm², diferencial 1, inteligente/);
  assert.ok(!/Carregador/.test(texto(l, 'Máquina ≥ 2000 W')), 'o carregador tem linha própria');
  assert.match(texto(l, 'Carregador do carro'), /circuito 3 de 40 A, 10 mm².*diferencial próprio, no mínimo tipo A — tipo A exigido \(RTIEBT 722.*previsto \(IDR tipo A\)/);
  assert.match(texto(l, 'Quadros parciais'), /1 quadro parcial de 12 módulos \(Piso 1\)/);
  assert.match(texto(l, 'Quadros parciais'), /Circuito 1 \(Iluminação\) serve Piso 0 \(r\/c\) e Piso 1/);
  assert.match(texto(l, 'Planta'), /forma livre.*Cozinha \(14 m², Piso 0 \(r\/c\)\)/);
  assert.match(texto(l, 'Planta'), /Sem nenhum aparelho desenhado: Arrumos/);
});

test('simulação antiga (sem perguntas do quadro nem deslocação) e sem planta: não inventa, mas avisa', () => {
  const l = aVerificarNaVisita({
    casa: { potencia_contratada_kva: 6.9, fases: 'mono' },
    divisoes: [{ nome: 'Sala', interruptores: [1] }],
    quadro: { circuitos: [{ n: 1, amperes: 32, tipo: 'maquina', itens: { maquinas: [{ modelo: 'placa', potencia_w: 7200 }] } }] },
    itens: [{ sku: 'JA-NAO-EXISTE', qtd: 1 }, { sku: 'TONGOU-SY2-JWT', qtd: 1 }],
  }, { 'TONGOU-SY2-JWT': { nome: 'SY2' } });
  assert.deepEqual([...new Set(temas(l))], ['Quadro elétrico', 'Máquina ≥ 2000 W', 'Planta', 'Material']);
  assert.match(texto(l, 'Quadro elétrico'), /Simulação antiga/);
  assert.match(texto(l, 'Planta'), /não desenhou a planta/);
  assert.match(texto(l, 'Material'), /^JA-NAO-EXISTE já não está no catálogo/);
  assert.deepEqual(aVerificarNaVisita(null), [], 'sem simulação: nada');
});

test('leitura automática da foto do quadro alimenta "A verificar na visita" (feita, erro, desligada, não é quadro)', () => {
  const sim = { quadro: { circuitos: [], pacote: 'recomendado', para_raios: 'nao', quadro_novo: 'atual', modulos: { novos: 6 } } };
  const leitura = (x) => ({ estado: 'feita', leitura: {
    e_quadro_eletrico: true, disjuntores_total: 5, disjuntores: [{ amperes: 16, quantidade: 5 }], diferenciais: [],
    disjuntor_geral: { visivel: true, amperes: 25, tipo: null }, modulos_livres_estimados: 2, marcas: [], estado_aparente: 'antigo',
    fusiveis: true, sinais_aquecimento: true, notas: '', confianca: 'baixa', ...x,
  } });
  const l = aVerificarNaVisita(sim, {}, leitura({}));
  const t = texto(l, 'Foto do quadro');
  assert.match(t, /ar antigo/);
  assert.match(t, /FUSÍVEIS/);
  assert.match(t, /SINAIS DE AQUECIMENTO/);
  assert.match(t, /nenhum diferencial/);
  assert.match(t, /~2 módulos livres para 6 módulos novos/);
  assert.match(t, /confiança BAIXA/);
  assert.match(t, /Confirmar a leitura automática da foto do quadro \(5 disjuntores, 0 diferenciais, geral 25 A\)/);
  const bom = aVerificarNaVisita(sim, {}, leitura({ estado_aparente: 'bom', fusiveis: false, sinais_aquecimento: false, diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 2 }], modulos_livres_estimados: 8, confianca: 'alta' }));
  assert.deepEqual(bom.filter((x) => x.tema === 'Foto do quadro').map((x) => x.texto), ['Confirmar a leitura automática da foto do quadro (5 disjuntores, 2 diferenciais, geral 25 A).']);
  assert.match(texto(aVerificarNaVisita(sim, {}, leitura({ e_quadro_eletrico: false })), 'Foto do quadro'), /não parece ser do quadro/);
  assert.match(texto(aVerificarNaVisita(sim, {}, { estado: 'erro', erro: 'x' }), 'Foto do quadro'), /falhou/);
  assert.match(texto(aVerificarNaVisita(sim, {}, { estado: 'desligada' }), 'Foto do quadro'), /leitura automática desligada/);
  for (const sem of [null, { estado: 'sem_foto' }, { estado: 'pendente' }]) assert.ok(!temas(aVerificarNaVisita(sim, {}, sem)).includes('Foto do quadro'), 'sem leitura: nada');
});
