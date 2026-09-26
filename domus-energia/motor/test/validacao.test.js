import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAutomacoes } from '../src/validacao.js';
import { normalizarAparelhos } from '../src/aparelhos.js';
import { APARELHOS, autoLuzCorredor } from './ajuda.js';

const { aparelhos } = normalizarAparelhos(APARELHOS);
const validar = (lista, extra = {}) => validarAutomacoes(lista, { aparelhos, ...extra });
const erro = (lista, extra) => {
  const r = validar(lista, extra);
  assert.equal(r.ok, false, 'devia ter sido rejeitada');
  return r.erro;
};

test('aceita a automação de exemplo do contrato e normaliza', () => {
  const r = validar([autoLuzCorredor({ se: { alarme: false, entre: ['19:00', '07:00'] } })]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lista[0].se, { alarme: false, entre: ['19:00', '07:00'] });
  assert.equal(r.lista[0].entao[0].durante_s, 120);
});

test('aparelhos v1 sem canais têm um interruptor no canal 1', () => {
  const r = validar([{ id: 'ac', quando: { tipo: 'hora', hora: '08:00' }, entao: [{ acao: 'ligar', aparelho: 'ac-sala', canal: 1 }] }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lista[0].quando.dias, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.lista[0].ativa, true);
  assert.equal(r.lista[0].bloqueada, false);
});

test('rejeita listas e campos inválidos com mensagens claras', () => {
  assert.match(erro({}), /lista JSON/);
  assert.match(erro(Array.from({ length: 51 }, (_, i) => autoLuzCorredor({ id: `a${i}` }))), /No máximo 50/);
  assert.match(erro([autoLuzCorredor({ id: 'Maiúsculas' })]), /"id" inválido/);
  assert.match(erro([autoLuzCorredor({ id: 'x'.repeat(41) })]), /"id" inválido/);
  assert.match(erro([autoLuzCorredor(), autoLuzCorredor()]), /mesmo id "luz-corredor"/);
  assert.match(erro([autoLuzCorredor({ entao: [] })]), /entre 1 e 10 ações/);
  const onze = Array.from({ length: 11 }, () => ({ acao: 'notificar', mensagem: 'x' }));
  assert.match(erro([autoLuzCorredor({ entao: onze })]), /entre 1 e 10 ações/);
  assert.match(erro([autoLuzCorredor({ extra: 1 })]), /campo desconhecido "extra"/);
  assert.match(erro([autoLuzCorredor({ ativa: 'sim' })]), /"ativa" tem de ser true ou false/);
});

test('referências a aparelhos e canais têm de existir', () => {
  assert.match(erro([autoLuzCorredor({ quando: { tipo: 'sensor', aparelho: 'nao-existe', canal: 1, valor: 1 } })]), /aparelho "nao-existe" não existe/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 5 }] })]), /não tem o canal 5/);
  assert.match(erro([autoLuzCorredor({ quando: { tipo: 'potencia', aparelho: 'xpto', acima_w: 3500, durante_s: 60 } })]), /"xpto" não existe/);
});

test('ações só em canais controláveis', () => {
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'ligar', aparelho: 'porta-entrada', canal: 1 }] })]), /"porta" e não pode ser ligado/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'ligar', aparelho: 'estore-quarto', canal: 1 }] })]), /"estore" e não pode ser ligado/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'estore', aparelho: 'sala-4g', canal: 1, posicao: 50 }] })]), /não é um estore/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 101 }] })]), /"posicao".*0 e 100/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'voar' }] })]), /ação desconhecida/);
  assert.match(erro([autoLuzCorredor({ entao: [{ acao: 'notificar', mensagem: '  ' }] })]), /falta a "mensagem"/);
  assert.match(erro([autoLuzCorredor({ quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 2, valor: 1 } })]), /não serve de sensor/);
  const ok = validar([autoLuzCorredor({ entao: [{ acao: 'ligar', aparelho: 'led-cozinha', canal: 1 }, { acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 0 }] })]);
  assert.equal(ok.ok, true);
});

test('horas HH:MM, dias 1–7 e intervalo entre', () => {
  const hora = (q) => [{ id: 'h', quando: { tipo: 'hora', ...q }, entao: [{ acao: 'notificar', mensagem: 'x' }] }];
  assert.match(erro(hora({ hora: '7:00' })), /HH:MM/);
  assert.match(erro(hora({ hora: '24:00' })), /HH:MM/);
  assert.match(erro(hora({ hora: '07:60' })), /HH:MM/);
  assert.match(erro(hora({ hora: '07:00', dias: [0] })), /dia inválido/);
  assert.match(erro(hora({ hora: '07:00', dias: [8] })), /dia inválido/);
  assert.match(erro(hora({ hora: '07:00', dias: [] })), /não vazia/);
  assert.match(erro(hora({ hora: '07:00', dias: [1, 1] })), /repetidos/);
  assert.equal(validar(hora({ hora: '23:59', dias: [7, 1] })).lista[0].quando.dias.join(), '1,7');
  assert.match(erro([autoLuzCorredor({ se: { entre: ['19:00'] } })]), /"entre"/);
  assert.match(erro([autoLuzCorredor({ se: { entre: ['19:00', '19:00'] } })]), /não podem ser iguais/);
  assert.match(erro([autoLuzCorredor({ se: { alarme: 'sim' } })]), /"alarme" tem de ser/);
  assert.equal(validar([autoLuzCorredor({ se: { entre: ['22:00', '06:30'] } })]).ok, true);
});

test('o cliente não pode criar automações bloqueadas', () => {
  assert.match(erro([autoLuzCorredor({ bloqueada: true })]), /só a Domus Energia/);
});

test('bloqueadas: mantêm-se como estavam, exceto "ativa"', () => {
  const bloqueada = {
    id: 'empresa', nome: 'Da empresa', ativa: true, bloqueada: true,
    quando: { tipo: 'hora', hora: '07:00', dias: [1, 2, 3, 4, 5] },
    entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }],
  };
  const existentes = [bloqueada];
  // O cliente tenta alterar tudo — só "ativa" muda.
  const r = validar(
    [{ id: 'empresa', nome: 'Hackeada', ativa: false, bloqueada: false, quando: { tipo: 'hora', hora: '03:00' }, entao: [] }, autoLuzCorredor()],
    { existentes },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.lista[0], { ...bloqueada, ativa: false });
  assert.equal(r.lista[1].id, 'luz-corredor');
  // Não pode ser apagada.
  assert.match(erro([autoLuzCorredor()], { existentes }), /não pode ser apagada/);
  // Sem "ativa" mantém o valor anterior.
  assert.equal(validar([{ id: 'empresa' }], { existentes }).lista[0].ativa, true);
  // Em modo administração pode tudo.
  assert.equal(validar([autoLuzCorredor({ bloqueada: true })], { existentes, admin: true }).ok, true);
});
