// Ronda de correções QA/auditoria (2026-10-02; docs/SIMULADOR-ORCAMENTO.md §0): "Outra divisão" com planta mexida
// (QA N1: renomear/renumerar pela origem), porta da rua na planta automática (QA N4/B7) e planta automática sem
// divisões sobrepostas (auditoria UI A7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plantaDaCasa, divisoesDaCasa, acertarPlantaMexida, marcarPortaDaRua, nomesOutras, outrasDaCasa } from '../../web/simulador/casa.js';
import { normalizarEstado, estadoNovo } from '../../web/simulador/estado.js';

const sinc = (casa, fase = 'tudo') => ({
  divisoes: divisoesDaCasa(casa, []).map((d) => ({ nome: d.nome, piso: d.piso ?? 0, ...(d.origem ? { origem: d.origem } : {}) })),
  maquinas: [], fase,
});
const nomes = (p) => p.divisoes.map((d) => d.nome);
const portasDaRua = (p) => p.elementos.filter((e) => e.tipo === 'porta' && e.props?.entrada === true);
const divisaoDe = (p, e) => p.divisoes.find((d) => d.id === e.divisao)?.nome;
function sobrepostas(p) {
  const r = [];
  const ds = p.divisoes;
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const a = ds[i], b = ds[j];
    if ((a.piso ?? 0) !== (b.piso ?? 0)) continue;
    if (a.x_cm < b.x_cm + b.largura_cm && b.x_cm < a.x_cm + a.largura_cm && a.y_cm < b.y_cm + b.altura_cm && b.y_cm < a.y_cm + a.altura_cm) r.push(`${a.nome}/${b.nome}`);
  }
  return r;
}

test('outras divisões: nomesOutras e outrasDaCasa (origem = linha de casa.outras)', () => {
  const casa = { tipo: 'apartamento', tipologia: 'T2', outras: [{ nome: '', qtd: 1 }, { nome: 'Ginásio', qtd: 2 }] };
  assert.deepEqual(nomesOutras(casa), ['Outra divisão', 'Ginásio', 'Ginásio 2']);
  assert.deepEqual(outrasDaCasa(casa), [{ nome: 'Outra divisão', linha: 0 }, { nome: 'Ginásio', linha: 1 }, { nome: 'Ginásio 2', linha: 1 }]);
  const p = plantaDaCasa(casa, []);
  assert.deepEqual(p.divisoes.filter((d) => d.origem).map((d) => [d.nome, d.origem]), [['Outra divisão', 'outra:0'], ['Ginásio', 'outra:1'], ['Ginásio 2', 'outra:1']]);
  assert.equal(p.divisoes.find((d) => d.nome === 'Sala').origem, undefined, 'as divisões da tipologia não têm origem');
  // estado.js guarda a origem ao normalizar (planta guardada / retomada)
  const e = normalizarEstado({ ...estadoNovo(), planta: p });
  assert.deepEqual(e.planta.divisoes.filter((d) => d.origem).map((d) => d.origem), ['outra:0', 'outra:1', 'outra:1']);
});

test('QA N1: planta mexida — mudar o nome da "Outra divisão" renomeia e renumera, mais/menos acrescenta/tira', () => {
  let casa = { tipo: 'apartamento', tipologia: 'T2', outras: [{ nome: '', qtd: 1 }] };
  const p = plantaDaCasa(casa, []);
  let antes = sinc(casa);
  const n0 = p.divisoes.length;
  casa = { ...casa, outras: [{ nome: 'Ginásio', qtd: 1 }] };
  acertarPlantaMexida(p, antes, sinc(casa), { casa }); antes = sinc(casa);
  assert.equal(p.divisoes.length, n0, 'renomear não acrescenta');
  assert.ok(nomes(p).includes('Ginásio') && !nomes(p).includes('Outra divisão'), `renomeada: ${nomes(p)}`);
  casa = { ...casa, outras: [{ nome: 'Ginásio', qtd: 2 }] };
  acertarPlantaMexida(p, antes, sinc(casa), { casa }); antes = sinc(casa);
  assert.deepEqual(nomes(p).slice(-2), ['Ginásio', 'Ginásio 2']);
  const nova = p.divisoes.at(-1);
  assert.equal(nova.origem, 'outra:0');
  assert.ok(p.elementos.some((e) => e.divisao === nova.id && e.tipo === 'porta'), 'a nova traz os aparelhos base');
  casa = { ...casa, outras: [{ nome: 'Sótão', qtd: 2 }, { nome: 'Adega', qtd: 1 }] };
  acertarPlantaMexida(p, antes, sinc(casa), { casa }); antes = sinc(casa);
  assert.deepEqual(nomes(p).slice(-3), ['Sótão', 'Sótão 2', 'Adega'], 'renumera as duas e acrescenta a linha nova');
  casa = { ...casa, outras: [{ nome: 'Adega', qtd: 1 }] };
  acertarPlantaMexida(p, antes, sinc(casa), { casa });
  assert.deepEqual(nomes(p).slice(-1), ['Adega']);
  assert.equal(p.divisoes.length, n0, 'tirar a linha tira as divisões dela');
  assert.deepEqual(sobrepostas(p), []);
});

test('QA N1: planta antiga sem origem — as divisões com esses nomes passam a ter origem (não se duplicam nem saem)', () => {
  const casa = { tipo: 'apartamento', tipologia: 'T2', outras: [{ nome: 'Ginásio', qtd: 1 }] };
  const p = plantaDaCasa(casa, []);
  for (const d of p.divisoes) delete d.origem;
  const antes = { ...sinc(casa), divisoes: sinc(casa).divisoes.map(({ nome, piso }) => ({ nome, piso })) };
  const casa2 = { ...casa, outras: [{ nome: 'Ginásio', qtd: 2 }] };
  acertarPlantaMexida(p, antes, sinc(casa2), { casa: casa2 });
  assert.deepEqual(nomes(p).slice(-2), ['Ginásio', 'Ginásio 2']);
  assert.equal(p.divisoes.filter((d) => d.nome.startsWith('Ginásio')).length, 2);
  assert.equal(p.divisoes.find((d) => d.nome === 'Ginásio').origem, 'outra:0');
});

test('QA N4/B7: a planta automática marca uma porta da rua (entrada/hall, senão corredor, senão sala; no r/c)', () => {
  const casos = [
    [{ tipo: 'apartamento', tipologia: 'T1' }, 'Sala'],
    [{ tipo: 'apartamento', tipologia: 'T2' }, 'Corredor'],
    [{ tipo: 'apartamento', tipologia: 'T3', extras: { entrada: true } }, 'Entrada'],
    [{ tipo: 'moradia', tipologia: 'T3', pisos: 2 }, 'Sala'],
    [{ tipo: 'apartamento', tipologia: 'T0' }, 'Estúdio'],
  ];
  for (const [casa, onde] of casos) {
    const p = plantaDaCasa(casa, []);
    const l = portasDaRua(p);
    assert.equal(l.length, 1, `${casa.tipologia}: uma só porta da rua`);
    assert.equal(l[0].piso ?? 0, 0, 'no r/c');
    assert.equal(divisaoDe(p, l[0]), onde, `${casa.tipologia}: na divisão certa`);
  }
  // Planta mexida: ao passar da fase "divisoes" à fase "tudo" os aparelhos entram e a porta da rua também
  const casa = { tipo: 'apartamento', tipologia: 'T2' };
  const p = plantaDaCasa(casa, []); p.elementos = [];
  acertarPlantaMexida(p, sinc(casa, 'divisoes'), sinc(casa, 'tudo'), { casa });
  assert.equal(portasDaRua(p).length, 1);
  assert.equal(marcarPortaDaRua(p), null, 'com uma porta da rua não marca outra');
  // Sem portas: nada
  assert.equal(marcarPortaDaRua({ divisoes: [], elementos: [] }), null);
});

test('auditoria A7: planta automática sem divisões sobrepostas (várias tipologias, com outras divisões e máquinas)', () => {
  const casos = [
    { tipo: 'apartamento', tipologia: 'T0' }, { tipo: 'apartamento', tipologia: 'T1' }, { tipo: 'apartamento', tipologia: 'T2' },
    { tipo: 'apartamento', tipologia: 'T2', casas_banho: 2, salas: 2 }, { tipo: 'apartamento', tipologia: 'T3' },
    { tipo: 'apartamento', tipologia: 'T4', casas_banho: 3, extras: { entrada: true, lavandaria: true, despensa: true, varanda: true } },
    { tipo: 'moradia', tipologia: 'T3', pisos: 2, extras: { garagem: true, jardim: true } },
    { tipo: 'moradia', tipologia: 'T5', quartos: 6, pisos: 3, casas_banho: 4 },
    { tipo: 'apartamento', tipologia: 'T2', outras: [{ nome: 'Ginásio', qtd: 3 }, { nome: 'Sótão', qtd: 2 }] },
    { tipo: 'servicos', area_m2: 120, espacos: 5 }, { tipo: 'industrial', area_m2: 400, espacos: 6 },
  ];
  for (const casa of casos) {
    const p = plantaDaCasa(casa, [{ modelo: 'carregador_carro', qtd: 1 }, { modelo: 'ar_condicionado', qtd: 2 }]);
    assert.deepEqual(sobrepostas(p), [], JSON.stringify(casa));
    for (const d of p.divisoes) assert.ok(d.x_cm >= 0 && d.y_cm >= 0 && d.x_cm + d.largura_cm <= p.largura_cm && d.y_cm + d.altura_cm <= p.altura_cm, `${d.nome} dentro da folha`);
  }
  // Planta mexida: as divisões que entram (sitioDivisao) também não sobrepõem
  let casa = { tipo: 'apartamento', tipologia: 'T2' };
  const p = plantaDaCasa(casa, []);
  let antes = sinc(casa);
  for (const c of [{ ...casa, casas_banho: 3 }, { ...casa, casas_banho: 3, salas: 2 }, { ...casa, casas_banho: 3, salas: 2, outras: [{ nome: 'Ginásio', qtd: 4 }] }]) {
    acertarPlantaMexida(p, antes, sinc(c), { casa: c }); antes = sinc(c); casa = c;
    assert.deepEqual(sobrepostas(p), [], JSON.stringify(c));
  }
});
