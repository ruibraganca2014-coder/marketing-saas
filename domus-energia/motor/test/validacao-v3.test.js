import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAutomacoes, validarCenas, conflitos, cenasUsadas, contarAcoes } from '../src/validacao.js';
import { normalizarAparelhos } from '../src/aparelhos.js';
import { CONFIG_PADRAO } from '../src/casa.js';
import { APARELHOS_V3 } from './ajuda.js';

const { aparelhos, rejeitados } = normalizarAparelhos(APARELHOS_V3);
const cenas = new Set(['cinema']);
const base = (extra = {}) => ({
  id: 'a', nome: 'A', quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: 'x' }], ...extra,
});
const validar = (lista, extra = {}) => validarAutomacoes(lista, { aparelhos, config: { ...CONFIG_PADRAO }, cenas, ...extra });
const ok = (a) => {
  const r = validar([a]);
  assert.equal(r.ok, true, r.erro);
  return r.lista[0];
};
const erro = (a, re, extra) => {
  const r = validar([a], extra);
  assert.equal(r.ok, false, `devia ter sido rejeitada: ${JSON.stringify(a)}`);
  assert.match(r.erro, re);
};

test('_aparelhos v3: entrada, simular, arranque, carga, divisao (canal e aparelho)', () => {
  const sala = aparelhos.get('sala-4g');
  assert.equal(sala.divisao, 'Sala');
  assert.deepEqual(
    { ...sala.canais.get(1) },
    { n: 1, funcao: 'interruptor', nome: 'Teto', entrada: false, simular: false, carga: 'normal', arranque: 'ultimo', divisao: 'Sala' },
  );
  assert.equal(sala.canais.get(3).divisao, 'Exterior');
  assert.equal(sala.canais.get(2).simular, true);
  assert.equal(aparelhos.get('porta-entrada').canais.get(1).entrada, true);
  assert.equal(aparelhos.get('porta-entrada').canais.get(1).carga, undefined);
  assert.equal(aparelhos.get('termo').canais.get(1).carga, 'perigosa');
  assert.equal(aparelhos.get('termo').canais.get(1).arranque, 'desligado'); // por omissão
  assert.equal(aparelhos.get('quadro').geral, true);
  assert.deepEqual(rejeitados, []);
  // Campos em sítios errados são ignorados (com registo), o aparelho fica.
  const r = normalizarAparelhos([
    { id: 'x', nome: 'X', tipo: 'shelly', canais: [
      { n: 1, funcao: 'interruptor', carga: 'perigosa', arranque: 'ultimo', entrada: true },
      { n: 2, funcao: 'porta', simular: true, arranque: 'ligado' },
      { n: 3, funcao: 'estore', arranque: 'ultimo', carga: 'enorme' },
    ] },
  ]);
  const x = r.aparelhos.get('x');
  assert.equal(x.canais.get(1).arranque, 'desligado');
  assert.equal(x.canais.get(1).entrada, false);
  assert.equal(x.canais.get(2).simular, false);
  assert.equal(x.canais.get(3).arranque, 'desligado');
  assert.equal(x.canais.get(3).carga, 'normal');
  assert.equal(r.rejeitados.length, 6);
});

test('campos novos da automação aceites; desconhecidos rejeitados', () => {
  const a = ok(base({ descricao: '  Acender a luz do corredor à noite  ', categoria: 'conveniencia', ignorar_pausa: true }));
  assert.equal(a.descricao, 'Acender a luz do corredor à noite');
  assert.equal(a.categoria, 'conveniencia');
  assert.equal(a.ignorar_pausa, true);
  erro(base({ descricao: 'x'.repeat(201) }), /"descricao".*200/);
  erro(base({ categoria: 'lazer' }), /"categoria"/);
  erro(base({ ignorar_pausa: 'sim' }), /"ignorar_pausa"/);
  erro(base({ autor: 'eu' }), /campo desconhecido "autor"/);
});

test('gatilhos v3: sensor+durante_s, sol, presenca, modo, manual, sistema, potencia+rearmar_w', () => {
  assert.equal(ok(base({ quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 0, durante_s: 600 } })).quando.durante_s, 600);
  assert.equal(ok(base({ quando: { tipo: 'sensor', aparelho: 'sala-4g', canal: 1, valor: true } })).quando.valor, 1); // interruptor também
  erro(base({ quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 0, durante_s: -1 } }), /durante_s/);
  assert.deepEqual(ok(base({ quando: { tipo: 'sol', evento: 'por', desvio_min: -30 } })).quando, { tipo: 'sol', evento: 'por', desvio_min: -30 });
  assert.equal(ok(base({ quando: { tipo: 'sol', evento: 'nascer' } })).quando.desvio_min, 0);
  erro(base({ quando: { tipo: 'sol', evento: 'meio-dia' } }), /"nascer" ou "por"/);
  erro(base({ quando: { tipo: 'sol', evento: 'por', desvio_min: 181 } }), /desvio_min.*-180 e 180/);
  erro(base({ quando: { tipo: 'sol', evento: 'por' } }), /localização da casa/, { config: { ...CONFIG_PADRAO, local: null } });
  ok(base({ quando: { tipo: 'presenca', evento: 'sai_ultimo' } }));
  erro(base({ quando: { tipo: 'presenca', evento: 'chega' } }), /chega_primeiro/);
  ok(base({ quando: { tipo: 'modo', modo: 'noite' } }));
  erro(base({ quando: { tipo: 'modo', modo: 'praia' } }), /"modo"/);
  erro(base({ quando: { tipo: 'manual', extra: 1 } }), /campo desconhecido "extra"/);
  ok(base({ quando: { tipo: 'sistema', evento: 'aparelho_offline', aparelho: 'quadro' } }));
  ok(base({ quando: { tipo: 'sistema', evento: 'energia_reposta' } }));
  erro(base({ quando: { tipo: 'sistema', evento: 'energia_reposta', aparelho: 'quadro' } }), /não leva "aparelho"/);
  erro(base({ quando: { tipo: 'sistema', evento: 'aparelho_offline', aparelho: 'nada' } }), /"nada" não existe/);
  assert.equal(ok(base({ quando: { tipo: 'potencia', aparelho: 'quadro', acima_w: 3500, rearmar_w: 3200 } })).quando.rearmar_w, 3200);
  erro(base({ quando: { tipo: 'potencia', aparelho: 'quadro', acima_w: 3500, rearmar_w: 3500 } }), /rearmar_w/);
  erro(base({ quando: { tipo: 'voz' } }), /tipo desconhecido/);
});

test('condições v3: dias, sol, modo, presenca, aparelhos', () => {
  const se = ok(base({ se: { dias: [5, 1], sol: 'noite', modo: 'noite', presenca: 'ninguem', aparelhos: [{ aparelho: 'sala-4g', canal: 1, valor: true }, { aparelho: 'estore-quarto', canal: 1, valor: 50 }] } })).se;
  assert.deepEqual(se, { dias: [1, 5], sol: 'noite', modo: ['noite'], presenca: 'ninguem', aparelhos: [{ aparelho: 'sala-4g', canal: 1, valor: 1 }, { aparelho: 'estore-quarto', canal: 1, valor: 50 }] });
  erro(base({ se: { dias: [8] } }), /dia inválido/);
  erro(base({ se: { sol: 'tarde' } }), /"sol"/);
  erro(base({ se: { modo: ['casa', 'casa'] } }), /"modo"/);
  erro(base({ se: { presenca: 'todos' } }), /"presenca"/);
  erro(base({ se: { aparelhos: [{ aparelho: 'sala-4g', canal: 1, valor: 2 }] } }), /"valor" tem de ser 1 ou 0/);
  erro(base({ se: { aparelhos: [{ aparelho: 'sala-4g', canal: 9, valor: 1 }] } }), /não tem o canal 9/);
  erro(base({ se: { ambiente: {} } }), /campo desconhecido "ambiente"/);
});

test('ações v3: luz, alternar, cena, modo, esperar', () => {
  const entao = ok(base({ entao: [
    { acao: 'luz', aparelho: 'led-cozinha', canal: 1, brilho: 20 },
    { acao: 'alternar', aparelho: 'sala-4g', canal: 1 },
    { acao: 'cena', cena: 'cinema' },
    { acao: 'modo', modo: 'fora' },
    { acao: 'esperar', s: 300 },
  ] })).entao;
  assert.deepEqual(entao.map((a) => a.acao), ['luz', 'alternar', 'cena', 'modo', 'esperar']);
  assert.equal(entao[3].forcar, false);
  erro(base({ entao: [{ acao: 'luz', aparelho: 'sala-4g', canal: 1, brilho: 20 }] }), /não é uma luz regulável/);
  erro(base({ entao: [{ acao: 'luz', aparelho: 'led-cozinha', canal: 1, brilho: 101 }] }), /"brilho"/);
  erro(base({ entao: [{ acao: 'alternar', aparelho: 'estore-quarto', canal: 1 }] }), /não é um interruptor nem uma luz/);
  erro(base({ entao: [{ acao: 'cena', cena: 'praia' }] }), /a cena "praia" não existe/);
  erro(base({ entao: [{ acao: 'modo', modo: 'fora', forcar: 1 }] }), /"forcar"/);
  erro(base({ entao: [{ acao: 'esperar', s: 0 }] }), /"s".*1 e 3600/);
  erro(base({ entao: [{ acao: 'esperar', s: 3601 }] }), /"s".*1 e 3600/);
});

test('se/senão: no máximo 2 níveis e 20 ações no total (contando as aninhadas)', () => {
  const nota = { acao: 'notificar', mensagem: 'x' };
  const se = (entao, senao) => ({ acao: 'se', condicao: { modo: ['noite'] }, entao, ...(senao ? { senao } : {}) });
  const doisNiveis = ok(base({ entao: [se([se([nota], [nota])], [nota])] }));
  assert.equal(contarAcoes(doisNiveis.entao), 5); // 2 "se" + 3 notificar
  erro(base({ entao: [se([se([se([nota])])])] }), /2 níveis/);
  erro(base({ entao: [se([nota], [])].concat(Array.from({ length: 19 }, () => nota)) }), /20 ações no total/);
  erro(base({ entao: [{ acao: 'se', entao: [nota] }] }), /falta a "condicao"/);
  erro(base({ entao: [{ acao: 'se', condicao: { modo: ['casa'] }, entao: [] }] }), /pelo menos uma ação/);
  erro(base({ entao: [se([{ acao: 'voar' }])] }), /ação desconhecida/);
});

test('carga perigosa: só liga com durante_s ≤ 4 h (automações e cenas)', () => {
  erro(base({ entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1 }] }), /carga perigosa.*durante_s/);
  erro(base({ entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1, durante_s: 14_401 }] }), /carga perigosa/);
  erro(base({ entao: [{ acao: 'alternar', aparelho: 'termo', canal: 1 }] }), /carga perigosa/);
  erro(base({ entao: [{ acao: 'se', condicao: { modo: ['casa'] }, entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1 }] }] }), /carga perigosa/);
  ok(base({ entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1, durante_s: 14_400 }] }));
  ok(base({ entao: [{ acao: 'desligar', aparelho: 'termo', canal: 1 }] }));
  const r = validarCenas([{ id: 'banho', acoes: [{ acao: 'ligar', aparelho: 'termo', canal: 1 }] }], { aparelhos });
  assert.equal(r.ok, false);
  assert.match(r.erro, /carga perigosa/);
});

const cena = (extra = {}) => ({ id: 'cinema', nome: 'Noite de cinema', icone: 'filme', acoes: [{ acao: 'luz', aparelho: 'led-cozinha', canal: 1, brilho: 20 }], ...extra });

test('cenas: validação, máximo 30, sem "se" nem cenas dentro de cenas', () => {
  const r = validarCenas([cena(), { id: 'sair', acoes: [{ acao: 'modo', modo: 'fora' }, { acao: 'esperar', s: 5 }, { acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }], { aparelhos });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.lista[1], { id: 'sair', nome: 'sair', bloqueada: false, acoes: [{ acao: 'modo', modo: 'fora', forcar: false }, { acao: 'esperar', s: 5 }, { acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] });
  const e = (lista, re, extra = {}) => {
    const x = validarCenas(lista, { aparelhos, ...extra });
    assert.equal(x.ok, false);
    assert.match(x.erro, re);
  };
  e(Array.from({ length: 31 }, (_, i) => cena({ id: `c${i}` })), /No máximo 30 cenas/);
  e([cena({ icone: 'gato' })], /"icone"/);
  e([cena({ acoes: [{ acao: 'cena', cena: 'outra' }] })], /não pode executar outra cena/);
  e([cena({ acoes: [{ acao: 'se', condicao: { modo: ['casa'] }, entao: [{ acao: 'notificar', mensagem: 'x' }] }] })], /não podem ter "se"/);
  e([cena({ extra: 1 })], /campo desconhecido "extra"/);
  e([cena(), cena()], /mesmo id/);
  e([cena({ acoes: [] })], /entre 1 e 20/);
  e([cena({ bloqueada: true })], /só a Domus Energia/);
  // Cena usada por uma automação não pode ser apagada.
  e([], /é usada pela automação "Filme"/, { usadas: new Map([['cinema', 'Filme']]) });
});

test('cenas bloqueadas (da empresa): nada é editável e não podem ser apagadas', () => {
  const empresa = { id: 'empresa', nome: 'Sair de casa', icone: 'porta', bloqueada: true, acoes: [{ acao: 'modo', modo: 'fora', forcar: false }] };
  const r = validarCenas([{ id: 'empresa', nome: 'Mudada', acoes: [{ acao: 'notificar', mensagem: 'x' }] }, cena()], { aparelhos, existentes: [empresa] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lista[0], empresa);
  const x = validarCenas([cena()], { aparelhos, existentes: [empresa] });
  assert.match(x.erro, /não pode ser apagada/);
  assert.equal(validarCenas([cena({ bloqueada: true })], { aparelhos, admin: true }).ok, true);
});

test('conflitos: mesmo gatilho, mesmo canal, sentidos opostos', () => {
  const q = { tipo: 'hora', hora: '07:00', dias: [1, 2, 3, 4, 5, 6, 7] };
  const lista = [
    { id: 'a', ativa: true, quando: q, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'b', ativa: true, quando: q, entao: [{ acao: 'se', condicao: { modo: ['casa'] }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }] },
    { id: 'c', ativa: true, quando: { ...q, hora: '08:00' }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'd', ativa: false, quando: q, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'e', ativa: true, quando: q, entao: [{ acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 100 }] },
    { id: 'f', ativa: true, quando: q, entao: [{ acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 0 }] },
  ];
  assert.deepEqual(conflitos(lista, aparelhos), [
    { ids: ['a', 'b'], mensagem: "'a' liga e 'b' desliga Teto no mesmo gatilho" },
    { ids: ['e', 'f'], mensagem: "'e' põe Estore quarto a 100 % e 'f' a 0 % no mesmo gatilho" },
  ]);
  assert.deepEqual([...cenasUsadas([{ nome: 'X', entao: [{ acao: 'cena', cena: 'cinema' }] }])], [['cinema', 'X']]);
});
