// Regressões da revisão de segurança e de código (e2e/revisão, 2026-09-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor, motorV3, APARELHOS_V3, NTFY, ultimoJson } from './ajuda.js';
import { MAX_EXECUCOES_MINUTO, MAX_NOTIFICACOES_MINUTO } from '../src/motor.js';
import { MAX_REGISTO_BYTES, textoRegistoLimitado } from '../src/motor-automacoes.js';
import { validarAutomacoes } from '../src/validacao.js';
import { normalizarAparelhos } from '../src/aparelhos.js';

const P = 'domus/joao';
const guardar = (m, lista) => {
  m.limpar();
  m.msg(`${P}/_automacoes/set`, lista);
  const erro = m.eventos().find((e) => e.tipo === 'erro');
  assert.equal(erro, undefined, erro?.mensagem);
  m.limpar();
};
const registo = (m, id) => {
  m.motor.tick();
  return ultimoJson(m, `${P}/_automacoes/registo`)?.[id];
};

test('M2: executar a mesma cena em rajada fica limitado a MAX_EXECUCOES_MINUTO por minuto', () => {
  const m = motorV3();
  m.msg(`${P}/_cenas/set`, [{ id: 'teto', nome: 'Teto', acoes: [{ acao: 'alternar', aparelho: 'sala-4g', canal: 1 }] }]);
  m.limpar();
  for (let i = 0; i < MAX_EXECUCOES_MINUTO + 15; i++) m.msg(`${P}/_cenas/executar`, { id: 'teto' });
  assert.equal(m.comandos().filter((c) => c.startsWith(`${P}/sala-4g/1/set`)).length, MAX_EXECUCOES_MINUTO);
  m.avancar(61_000);
  m.limpar();
  m.msg(`${P}/_cenas/executar`, { id: 'teto' });
  assert.equal(m.comandos().filter((c) => c.startsWith(`${P}/sala-4g/1/set`)).length, 1, 'passado um minuto volta a executar');
});

test('M2: no máximo MAX_NOTIFICACOES_MINUTO notificações não-alarme por minuto; alarmes passam sempre', () => {
  const m = motorV3({ config: { atraso_saida_s: 0 } });
  // 20 automações "notificar" disparadas pelo mesmo gatilho manual (cada uma dentro do seu limite).
  guardar(m, Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, nome: `N${i}`, ativa: true, quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: `m${i}` }] })));
  for (let i = 0; i < 15; i++) m.msg(`${P}/_automacoes/executar`, { id: `n${i}` });
  assert.equal(m.notificacoes.length, MAX_NOTIFICACOES_MINUTO);
  // O histórico fica com todas.
  assert.equal(ultimoJson(m, `${P}/_historico`).filter((e) => e.tipo === 'automacao').length, 15);
  // Alarme: passa mesmo com o limite esgotado.
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(1000);
  m.msg(`${P}/janela-wc/1/get`, '1');
  assert.ok(m.notificacoes.some((n) => n.tipo === 'alarme' && n.prioridade === 'urgent'), 'alarme notificado');
  // Um minuto depois volta a haver lugar.
  m.avancar(61_000);
  const antes = m.notificacoes.length;
  m.msg(`${P}/_automacoes/executar`, { id: 'n0' });
  assert.equal(m.notificacoes.length, antes + 1);
});

test('H1: _automacoes/registo com 50 automações × 20 entradas fica abaixo do limite', () => {
  const m = motorV3();
  const lista = Array.from({ length: 50 }, (_, i) => ({ id: `automacao-com-nome-comprido-${i}`, nome: `A${i}`, ativa: true, quando: { tipo: 'manual' },
    se: { modo: ['noite'] }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 2 }] }));
  guardar(m, lista);
  for (let k = 0; k < 20; k++) {
    for (const a of lista) m.msg(`${P}/_automacoes/executar`, { id: a.id }); // condição falsa → motivo comprido
    m.avancar(61_000);
  }
  m.motor.tick();
  const p = m.ultimo(`${P}/_automacoes/registo`);
  const bytes = Buffer.byteLength(p.payload);
  assert.ok(bytes <= MAX_REGISTO_BYTES, `registo com ${bytes} bytes`);
  const r = JSON.parse(p.payload);
  assert.equal(Object.keys(r).length, 50);
  assert.equal(r[lista[0].id].resultado, 'condicao_falsa');
  assert.ok(r[lista[0].id].ultimos.length >= 1);
  // Sem limite, o mesmo registo passaria dos 64 KB do broker antigo.
  assert.ok(Buffer.byteLength(JSON.stringify(m.motor.clientes.get('joao').registo)) > 65_536);
  // textoRegistoLimitado: no limite extremo fica só o topo.
  const t = JSON.parse(textoRegistoLimitado(m.motor.clientes.get('joao').registo, 20_000));
  assert.equal(t[lista[0].id].ultimos.length, 0);
  assert.equal(t[lista[0].id].resultado, 'condicao_falsa');
});

test('H1: mensagens maiores do que maxPayload nunca são publicadas (registadas como erro)', () => {
  const erros = [];
  const publicados = [];
  const { Motor } = m0;
  const motor = new Motor({ publicar: (t, p) => publicados.push(t), log: { info() {}, aviso() {}, erro: (e) => erros.push(e) }, maxPayload: 1000 });
  motor.publicar('domus/joao/_historico', 'x'.repeat(1001), true);
  motor.publicar('domus/joao/_historico', 'x'.repeat(1000), true);
  assert.deepEqual(publicados, ['domus/joao/_historico']);
  assert.match(erros[0], /1001 bytes \(limite 1000\): não publicada/);
});
import * as m0 from '../src/motor.js';

test('L1: mudança de hora de março — gatilhos das 01:xx disparam às 02:00 (uma vez)', () => {
  // 29/03/2026: em Lisboa as 01:00 WET passam a 02:00 WEST (00:59Z → 01:00Z).
  const m = motorV3({ agora: '2026-03-29T00:57:00Z' });
  guardar(m, [
    { id: 'a0130', nome: 'A', ativa: true, quando: { tipo: 'hora', hora: '01:30' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'a0200', nome: 'B', ativa: true, quando: { tipo: 'hora', hora: '02:00' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 2 }] },
    { id: 'a0100dom', nome: 'C', ativa: true, quando: { tipo: 'hora', hora: '01:00', dias: [7] }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 3 }] },
    { id: 'a0100seg', nome: 'D', ativa: true, quando: { tipo: 'hora', hora: '01:00', dias: [1] }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4 }] },
  ]);
  for (let i = 0; i < 6; i++) m.avancar(60_000); // até 01:03Z = 02:03 WEST
  assert.deepEqual(m.comandos().sort(), [`${P}/sala-4g/1/set=1`, `${P}/sala-4g/2/set=1`, `${P}/sala-4g/3/set=1`]);
  assert.match(registo(m, 'a0130').ultimos.find((u) => u.resultado === 'executada').motivo, /hora 01:30 \(não existiu hoje .* executada às 02:00\)/);
  // Num dia normal, 01:30 dispara às 01:30.
  const n = motorV3({ agora: '2026-04-05T00:28:00Z' }); // 01:28 WEST
  guardar(n, [{ id: 'a0130', nome: 'A', ativa: true, quando: { tipo: 'hora', hora: '01:30' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }] }]);
  n.avancar(60_000);
  assert.deepEqual(n.comandos(), []);
  n.avancar(60_000);
  assert.deepEqual(n.comandos(), [`${P}/sala-4g/1/set=1`]);
});

test('L7: "Avaliar agora" não muda ultima/resultado (só entra em ultimos)', () => {
  const m = motorV3({ agora: '2026-06-15T12:00:00Z' });
  guardar(m, [{ id: 'b', nome: 'B', ativa: true, quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: 'x' }] }]);
  // Nunca executada + avaliação: continua "nunca executada".
  m.msg(`${P}/_automacoes/executar`, { id: 'b', avaliar: true });
  let r = registo(m, 'b');
  assert.equal(r.ultima, null);
  assert.equal(r.resultado, null);
  assert.deepEqual(r.ultimos.map((u) => [u.resultado, u.ok]), [['avaliacao', true]]);
  m.msg(`${P}/_automacoes/executar`, { id: 'b' });
  r = registo(m, 'b');
  const ultima = r.ultima;
  m.avancar(5000);
  m.msg(`${P}/_automacoes/executar`, { id: 'b', avaliar: true });
  r = registo(m, 'b');
  assert.equal(r.ultima, ultima);
  assert.equal(r.resultado, 'executada');
  assert.equal(r.ok, undefined);
  assert.deepEqual(r.ultimos.map((u) => u.resultado), ['avaliacao', 'executada', 'avaliacao']);
});

test('L9: contadores antigos são esquecidos e o estado de aparelhos removidos é apagado', () => {
  const m = motorV3();
  guardar(m, [{ id: 'b', nome: 'B', ativa: true, quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: 'x' }] }]);
  m.msg(`${P}/_automacoes/executar`, { id: 'b' });
  assert.equal(m.motor.execucoes.size, 1);
  assert.equal(m.motor.notificacoesRecentes.size, 1);
  m.avancar(61_000);
  m.avancar(60_000);
  assert.equal(m.motor.execucoes.size, 0);
  assert.equal(m.motor.notificacoesRecentes.size, 0);
  m.msg(`${P}/quadro/energycounter/get`, '1000');
  m.msg(`${P}/janela-wc/1/get`, '0');
  const c = m.motor.clientes.get('joao');
  assert.ok(c.estado.has('janela-wc') && c.estado.has('quadro'));
  m.retida(`${P}/_aparelhos`, APARELHOS_V3.filter((a) => a.id !== 'janela-wc'));
  assert.ok(!c.estado.has('janela-wc'), 'estado do aparelho removido apagado');
  assert.ok(c.estado.has('quadro'));
  assert.ok(!('janela-wc' in m.motor.exportar().clientes.joao.aparelhos), 'também no estado guardado');
});

test('mensagens de duração para pessoas (sem "durante_s" nem 86400)', () => {
  const { aparelhos } = normalizarAparelhos(APARELHOS_V3);
  const r = validarAutomacoes([{ id: 'a', nome: 'A', quando: { tipo: 'manual' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1, durante_s: 86_401 }] }], { aparelhos });
  assert.equal(r.ok, false);
  assert.match(r.erro, /a duração não pode passar de 24 horas\./);
  assert.doesNotMatch(r.erro, /durante_s|86400/);
});
