import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor, motorComAparelhos, autoLuzCorredor, APARELHOS, NTFY } from './ajuda.js';

const P = 'domus/joao';

test('arranque: publica _alarme, _automacoes e _historico retidos (nunca _ntfy)', () => {
  // v3: _alarme ganhou estado/tipo/ate/ignorados/por.
  const m = criarMotor({});
  m.motor.aoLigar();
  m.retida(`${P}/_aparelhos`, APARELHOS);
  m.motor.tick();
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_alarme`).payload), { ativo: false, estado: 'desarmado', tipo: null, desde: null, ate: null, ignorados: [], por: null });
  assert.equal(m.ultimo(`${P}/_automacoes`).payload, '[]');
  assert.equal(m.ultimo(`${P}/_automacoes`).retain, true);
  assert.equal(m.ultimo(`${P}/_historico`).retain, true);
  assert.equal(m.ultimo(`${P}/_ntfy`), undefined);
});

test('adota o alarme retido quando não há estado local', () => {
  const m = criarMotor({});
  m.motor.aoLigar();
  m.retida(`${P}/_alarme`, { ativo: true, desde: '2026-01-01T00:00:00Z' });
  m.retida(`${P}/_aparelhos`, APARELHOS);
  m.motor.tick();
  assert.equal(JSON.parse(m.ultimo(`${P}/_alarme`).payload).ativo, true);
});

test('ntfy: tópico lido do _ntfy retido do domus.sh; sem ele só FCM', () => {
  const m = criarMotor({});
  m.retida(`${P}/_aparelhos`, APARELHOS);
  m.motor.aoLigar();
  m.motor.tick();
  m.msg(`${P}/_alarme/set`, { ativo: true });
  m.avancar(30_000); // v3: atraso de saída (30 s por omissão)
  m.msg(`${P}/porta-entrada/1/get`, '1');
  assert.equal(m.notificacoes.length, 1);
  assert.equal(m.notificacoes[0].topicoNtfy, null);
  // Tópico de outro cliente ou inválido: ignorado.
  m.retida(`${P}/_ntfy`, { topico: 'domus-maria-abcdefghij0123456789' });
  m.retida(`${P}/_ntfy`, 'lixo');
  m.retida(`${P}/_ntfy`, NTFY);
  m.msg(`${P}/porta-entrada/1/get`, '0');
  m.msg(`${P}/porta-entrada/1/get`, '1');
  assert.equal(m.notificacoes[1].topicoNtfy, 'domus-joao-abcdefghij0123456789');
  // Só com "url" (formato antigo) também serve; mensagem vazia apaga.
  m.msg(`${P}/_ntfy`, { url: 'https://ntfy.h/domus-joao-zzzzzzzzzz' });
  assert.equal(m.motor.clientes.get('joao').topicoNtfy, 'domus-joao-zzzzzzzzzz');
  m.msg(`${P}/_ntfy`, '');
  assert.equal(m.motor.clientes.get('joao').topicoNtfy, null);
});

test('_automacoes/set válido: guarda e publica retido', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  const pub = m.ultimo(`${P}/_automacoes`);
  assert.equal(pub.retain, true);
  assert.equal(JSON.parse(pub.payload)[0].id, 'luz-corredor');
  assert.equal(m.armazenamento.dados.clientes.joao.automacoes.length, 1);
});

test('_automacoes/set inválido: evento erro e a lista não muda', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.limpar();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor({ entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 9 }] })]);
  const [ev] = m.eventos();
  assert.equal(ev.tipo, 'erro');
  assert.match(ev.mensagem, /não tem o canal 9/);
  assert.equal(JSON.parse(m.ultimo(`${P}/_automacoes`).payload)[0].entao[0].canal, 4);
  // JSON partido também dá erro, sem rebentar.
  m.msg(`${P}/_automacoes/set`, '[{"id": ');
  assert.match(m.eventos().at(-1).mensagem, /não é JSON válido/);
  // Histórico retido, mais recente primeiro.
  const hist = JSON.parse(m.ultimo(`${P}/_historico`).payload);
  assert.equal(hist.length, 2);
  assert.match(hist[0].mensagem, /JSON/);
});

test('comandos retidos (_alarme/set, _automacoes/set) são ignorados no arranque', () => {
  const m = motorComAparelhos();
  m.retida(`${P}/_alarme/set`, { ativo: true });
  m.retida(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  assert.equal(m.publicados.length, 0);
});

test('bloqueadas: admin cria, cliente só muda "ativa" e não pode apagar', () => {
  const m = motorComAparelhos();
  const empresa = { id: 'empresa', nome: 'Da empresa', quando: { tipo: 'hora', hora: '07:00' }, entao: [{ acao: 'ligar', aparelho: 'quadro', canal: 1 }] };
  m.msg(`${P}/_automacoes/admin`, { op: 'guardar', automacao: empresa, pedido: 'x1' });
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_automacoes/admin/resultado`).payload), { pedido: 'x1', ok: true });
  let lista = JSON.parse(m.ultimo(`${P}/_automacoes`).payload);
  assert.equal(lista[0].bloqueada, true);

  m.msg(`${P}/_automacoes/set`, [{ ...lista[0], ativa: false, nome: 'Mudado', entao: [{ acao: 'notificar', mensagem: 'x' }] }, autoLuzCorredor()]);
  lista = JSON.parse(m.ultimo(`${P}/_automacoes`).payload);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].ativa, false);
  assert.equal(lista[0].nome, 'Da empresa');
  assert.equal(lista[0].entao[0].acao, 'ligar');

  m.limpar();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  assert.match(m.eventos()[0].mensagem, /não pode ser apagada/);

  m.msg(`${P}/_automacoes/admin`, { op: 'apagar', id: 'empresa', pedido: 'x2' });
  assert.equal(JSON.parse(m.ultimo(`${P}/_automacoes/admin/resultado`).payload).ok, true);
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_automacoes`).payload).map((a) => a.id), ['luz-corredor']);

  m.msg(`${P}/_automacoes/admin`, { op: 'guardar', automacao: { id: 'mau' }, pedido: 'x3' });
  const r = JSON.parse(m.ultimo(`${P}/_automacoes/admin/resultado`).payload);
  assert.equal(r.ok, false);
  assert.match(r.erro, /quando/);
});

test('sensor: primeiro valor retido ignorado; dispara só na transição', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.limpar();
  m.retida(`${P}/pir-corredor/1/get`, '1'); // valor antigo no arranque
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/pir-corredor/1/get`, '1'); // igual ao anterior: não é transição
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
});

test('primeira mensagem ao vivo (sem valor anterior) conta como transição', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
});

test('durante_s: volta ao estado oposto; nova deteção prolonga', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.limpar();
  m.avancar(100_000);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1'); // prolonga até t+100+120
  m.avancar(30_000);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
  m.limpar();
  m.avancar(89_000);
  assert.deepEqual(m.comandos(), []);
  m.avancar(1_000);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=0`]);
  m.limpar();
  m.avancar(300_000);
  assert.deepEqual(m.comandos(), []);
});

test('durante_s sobrevive a um reinício do motor', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  const t = m.relogio.t;

  // "Reinício": novo motor com o mesmo armazenamento, 5 minutos depois.
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: t + 300_000 });
  m2.motor.tick(); // ainda não conhece os aparelhos: a reversão espera
  assert.deepEqual(m2.comandos(), []);
  m2.retida(`${P}/_aparelhos`, APARELHOS);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.deepEqual(m2.comandos(), [`${P}/sala-4g/4/set=0`]);
  assert.equal(m2.armazenamento.dados.reversoes.length, 0);
});

test('condição "entre" que passa a meia-noite', () => {
  const m = motorComAparelhos({ agora: '2026-06-15T12:00:00Z' }); // 13:00 em Lisboa
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor({ se: { entre: ['19:00', '07:00'] } })]);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.relogio.t = Date.parse('2026-06-15T23:30:00Z'); // 00:30 de dia 16 em Lisboa
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.relogio.t = Date.parse('2026-06-16T06:00:00Z'); // 07:00 — já fora
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos().filter((c) => c.endsWith('=1')), []);
});

test('condição "alarme" e automação inativa', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor({ se: { alarme: true } })]);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/_alarme/set`, { ativo: true });
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor({ ativa: false, se: { alarme: true } })]);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), []);
});

const autoHora = (hora, dias) => ({
  id: 'manha', nome: 'Manhã', quando: { tipo: 'hora', hora, ...(dias ? { dias } : {}) },
  entao: [{ acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 100 }],
});
const estoreAbrir = `${P}/estore-quarto/rpc`;

test('hora: dispara uma vez no minuto certo (inverno, UTC+0)', () => {
  const m = motorComAparelhos({ agora: '2026-01-14T07:58:30Z' }); // quarta-feira
  m.msg(`${P}/_automacoes/set`, [autoHora('08:00', [1, 2, 3, 4, 5])]);
  m.limpar();
  m.em('2026-01-14T07:59:59Z');
  assert.equal(m.comandos().length, 0);
  m.em('2026-01-14T08:00:00Z');
  m.em('2026-01-14T08:00:30Z');
  m.em('2026-01-14T08:00:59Z');
  const cmds = m.publicados.filter((p) => p.topico === estoreAbrir);
  assert.equal(cmds.length, 1);
  const rpc = JSON.parse(cmds[0].payload);
  assert.equal(rpc.method, 'Cover.GoToPosition');
  assert.equal(rpc.src, 'motor');
  assert.deepEqual(rpc.params, { id: 0, pos: 100 });
  // Sábado (6) não está na lista.
  m.limpar();
  m.em('2026-01-17T08:00:10Z');
  assert.equal(m.comandos().length, 0);
});

test('hora: dia da mudança para a hora de verão (29/03/2026) e verão', () => {
  const m = motorComAparelhos({ agora: '2026-03-28T23:00:00Z' });
  m.msg(`${P}/_automacoes/set`, [autoHora('08:00')]);
  m.limpar();
  // Às 08:00Z já são 09:00 em Lisboa — não dispara; dispara às 07:00Z.
  m.em('2026-03-29T06:59:00Z');
  assert.equal(m.comandos().length, 0);
  m.em('2026-03-29T07:00:05Z');
  assert.equal(m.comandos().length, 1);
  m.em('2026-03-29T08:00:05Z');
  assert.equal(m.comandos().length, 1);
});

test('hora: na mudança de outubro, 01:30 (que acontece duas vezes) só dispara uma vez', () => {
  const m = motorComAparelhos({ agora: '2026-10-24T23:00:00Z' });
  m.msg(`${P}/_automacoes/set`, [autoHora('01:30')]);
  m.limpar();
  m.em('2026-10-25T00:30:10Z'); // 01:30 WEST
  assert.equal(m.comandos().length, 1);
  m.em('2026-10-25T01:30:10Z'); // 01:30 WET (repetida)
  assert.equal(m.comandos().length, 1);
});

test('hora: não repete depois de um reinício no mesmo minuto', () => {
  const m = motorComAparelhos({ agora: '2026-01-14T07:59:50Z' });
  m.msg(`${P}/_automacoes/set`, [autoHora('08:00')]);
  m.em('2026-01-14T08:00:05Z');
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: '2026-01-14T08:00:40Z' });
  m2.retida(`${P}/_aparelhos`, APARELHOS);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(m2.publicados.filter((p) => p.topico === estoreAbrir).length, 0);
});

test('potência acima do limite durante X s dispara uma vez por excesso', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [{
    id: 'consumo', nome: 'Consumo alto',
    quando: { tipo: 'potencia', aparelho: 'quadro', acima_w: 3500, durante_s: 60 },
    entao: [{ acao: 'desligar', aparelho: 'ac-sala', canal: 1 }, { acao: 'notificar', mensagem: 'Consumo alto: AC desligado.' }],
  }]);
  m.limpar();
  m.msg(`${P}/quadro/power/get`, '4000');
  m.avancar(30_000);
  m.msg(`${P}/quadro/power/get`, '3000'); // desce: recomeça
  m.msg(`${P}/quadro/power/get`, '3600');
  m.avancar(59_000);
  assert.deepEqual(m.comandos(), []);
  m.avancar(1_000);
  assert.deepEqual(m.comandos(), [`${P}/ac-sala/command/switch:0=off`, `${P}/ac-sala/command=status_update`]);
  assert.equal(m.notificacoes.length, 1);
  assert.equal(m.notificacoes[0].prioridade, 'default');
  assert.equal(m.eventos()[0].tipo, 'automacao');
  m.msg(`${P}/quadro/power/get`, '5000');
  m.avancar(120_000);
  assert.equal(m.comandos().length, 2); // continua acima: não repete
  // Desce abaixo do limite: o estado de contagem é limpo.
  m.msg(`${P}/quadro/power/get`, '10');
  assert.equal(m.motor.potencia.size, 0);
});

test('alarme: ativar, porta aberta → evento alarme + notificação urgente', () => {
  const m = motorComAparelhos({ agora: '2026-09-26T22:10:00Z' });
  m.retida(`${P}/porta-entrada/1/get`, '0');
  m.msg(`${P}/porta-entrada/1/get`, '1'); // alarme desligado: só evento "sensor"
  assert.deepEqual(m.eventos().map((e) => e.tipo), ['sensor']);
  assert.equal(m.notificacoes.length, 0);
  m.msg(`${P}/porta-entrada/1/get`, '0');
  m.limpar();

  m.msg(`${P}/_alarme/set`, { ativo: true });
  const alarme = m.ultimo(`${P}/_alarme`);
  assert.equal(alarme.retain, true);
  // v3: {"ativo":true} = modo fora, com atraso de saída de 30 s.
  assert.deepEqual(JSON.parse(alarme.payload), {
    ativo: true, estado: 'a_armar', tipo: 'total', desde: '2026-09-26T22:10:00.000Z', ate: '2026-09-26T22:10:30.000Z', ignorados: [], por: 'app',
  });
  assert.equal(m.armazenamento.dados.clientes.joao.alarme.ativo, true);
  m.avancar(30_000);
  assert.equal(JSON.parse(m.ultimo(`${P}/_alarme`).payload).estado, 'armado');

  m.msg(`${P}/porta-entrada/1/get`, '1');
  const ev = m.eventos().find((e) => e.tipo === 'alarme');
  assert.ok(ev);
  assert.equal(ev.aparelho, 'porta-entrada');
  assert.equal(m.notificacoes.length, 1);
  assert.equal(m.notificacoes[0].prioridade, 'urgent');
  assert.equal(m.notificacoes[0].topicoNtfy, NTFY.topico);

  // Movimento também dispara; valor retido não.
  m.limpar();
  m.retida(`${P}/pir-corredor/1/get`, '1');
  assert.equal(m.notificacoes.length, 0);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.equal(m.notificacoes.length, 1);

  m.msg(`${P}/_alarme/set`, { ativo: 'talvez' });
  assert.equal(m.eventos().at(-1).tipo, 'erro');
  m.msg(`${P}/_alarme/set`, { ativo: false });
  assert.equal(JSON.parse(m.ultimo(`${P}/_alarme`).payload).ativo, false);
});

test('bateria < 15 %: um aviso por dia e por aparelho', () => {
  const m = motorComAparelhos({ agora: '2026-06-15T10:00:00Z' });
  m.msg(`${P}/pir-corredor/2/get`, '14');
  m.msg(`${P}/pir-corredor/2/get`, '12');
  m.msg(`${P}/porta-entrada/2/get`, '10');
  let avisos = m.eventos().filter((e) => e.tipo === 'aviso');
  assert.equal(avisos.length, 2);
  assert.match(avisos[0].mensagem, /Movimento corredor: bateria a 14 %/);
  assert.equal(m.notificacoes[0].prioridade, 'high');
  m.relogio.t = Date.parse('2026-06-16T10:00:00Z');
  m.msg(`${P}/pir-corredor/2/get`, '11');
  m.msg(`${P}/pir-corredor/2/get`, '50');
  avisos = m.eventos().filter((e) => e.tipo === 'aviso');
  assert.equal(avisos.length, 3);
});

test('aparelho a pilhas sem notícias há mais de 24 h: aviso uma vez', () => {
  const m = motorComAparelhos({ agora: '2026-06-15T10:00:00Z' });
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.limpar();
  m.avancar(24 * 3600_000);
  assert.equal(m.eventos().length, 0);
  m.avancar(60_000);
  const avisos = m.eventos().filter((e) => e.tipo === 'aviso');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].mensagem, /Movimento corredor: sem notícias há 24 h/);
  m.avancar(3600_000);
  assert.equal(m.eventos().length, 1);
  // Volta a dar notícias → pode avisar outra vez no futuro.
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.avancar(25 * 3600_000);
  assert.equal(m.eventos().filter((e) => e.tipo === 'aviso').length, 2);
});

test('payloads inválidos são ignorados sem rebentar', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.limpar();
  const lixo = ['', 'abc', '{', 'null', '[]', '{"output":"x"}', '\u0000\u0001'];
  for (const l of lixo) {
    m.msg(`${P}/pir-corredor/1/get`, l);
    m.msg(`${P}/estore-quarto/status/cover:0`, l);
    m.msg(`${P}/ac-sala/status/switch:0`, l);
    m.msg(`${P}/_fcm/registar`, l);
    m.msg(`${P}/_alarme/set`, l);
    m.msg(`${P}/_automacoes/admin`, l);
    m.msg(`${P}/_aparelhos/../x`, l);
    m.motor.aoMensagem(`${P}/pir-corredor/1/get`, undefined);
    m.motor.aoMensagem('domus/JOAO/_alarme/set', l);
    m.motor.aoMensagem('domus', l);
  }
  m.msg(`${P}/_aparelhos`, '{partido');
  assert.deepEqual(m.comandos(), []);
  // O estado continua a funcionar.
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
});

test('estados Shelly: switch, input, cover e light', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [{
    id: 'ac', quando: { tipo: 'sensor', aparelho: 'ac-sala', canal: 1, valor: 1 },
    entao: [{ acao: 'ligar', aparelho: 'led-cozinha', canal: 1, durante_s: 5 }],
  }]);
  m.limpar();
  m.msg(`${P}/ac-sala/status/switch:0`, { output: true, apower: 12.3, voltage: 230, current: 0.05, aenergy: { total: 10 } });
  const [cmd] = m.publicados.filter((p) => p.topico === `${P}/led-cozinha/rpc`);
  const rpc = JSON.parse(cmd.payload);
  assert.equal(rpc.method, 'Light.Set');
  assert.deepEqual(rpc.params, { id: 0, on: true });
  assert.equal(m.motor.clientes.get('joao').estado.get('ac-sala').potenciaW, 12.3);
  m.limpar();
  m.avancar(5_000);
  assert.deepEqual(JSON.parse(m.publicados.find((p) => p.topico === `${P}/led-cozinha/rpc`).payload).params, { id: 0, on: false });
});

test('FCM: registo com deduplicação, máximo 10 e remoção de tokens inválidos', async () => {
  const m = motorComAparelhos({ respostaNotificar: (p) => ({ tokensInvalidos: p.tokensFcm.filter((t) => t.endsWith('-morto')) }) });
  const tok = (i) => `token-fcm-de-teste-numero-${i}`;
  for (let i = 0; i < 12; i++) m.msg(`${P}/_fcm/registar`, { token: tok(i) });
  m.msg(`${P}/_fcm/registar`, { token: tok(5) });
  let tokens = m.motor.clientes.get('joao').tokensFcm;
  assert.equal(tokens.length, 10);
  assert.equal(tokens[0], tok(2));
  assert.equal(tokens.at(-1), tok(5));
  m.msg(`${P}/_fcm/registar`, { token: tok(5), remover: true });
  assert.equal(m.motor.clientes.get('joao').tokensFcm.includes(tok(5)), false);
  m.msg(`${P}/_fcm/registar`, { token: 'token-fcm-de-teste-morto' });
  m.msg(`${P}/_alarme/set`, { ativo: true });
  m.avancar(30_000); // v3: atraso de saída
  m.msg(`${P}/porta-entrada/1/get`, '1');
  await new Promise((r) => setImmediate(r));
  tokens = m.motor.clientes.get('joao').tokensFcm;
  assert.equal(tokens.includes('token-fcm-de-teste-morto'), false);
  assert.equal(tokens.length, 9);
  assert.deepEqual(m.armazenamento.dados.clientes.joao.tokensFcm, tokens);
});

test('histórico guarda só os últimos 100 eventos', () => {
  const m = motorComAparelhos();
  for (let i = 0; i < 105; i++) m.msg(`${P}/_alarme/set`, 'x');
  const hist = JSON.parse(m.ultimo(`${P}/_historico`).payload);
  assert.equal(hist.length, 100);
  assert.equal(m.eventos().length, 105);
  assert.equal(m.publicados.filter((p) => p.topico.endsWith('/_eventos')).every((p) => !p.retain), true);
});

test('comandos para aparelhos nunca são retidos; só o estado do motor', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [
    autoLuzCorredor({ entao: [
      { acao: 'ligar', aparelho: 'sala-4g', canal: 4, durante_s: 1 },
      { acao: 'ligar', aparelho: 'ac-sala', canal: 1, durante_s: 1 },
      { acao: 'ligar', aparelho: 'led-cozinha', canal: 1 },
      { acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 30 },
      { acao: 'notificar', mensagem: 'Movimento' },
    ] }),
  ]);
  m.msg(`${P}/_alarme/set`, { ativo: false });
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.avancar(2_000);
  const comandos = m.publicados.filter((p) => /\/(\d+\/set|command(\/.*)?|rpc)$/.test(p.topico));
  assert.ok(comandos.length >= 7, `só ${comandos.length} comandos`);
  assert.deepEqual(comandos.filter((p) => p.retain), []);
  const retidos = new Set(m.publicados.filter((p) => p.retain).map((p) => p.topico.slice(`${P}/`.length)));
  // v3: também _config, _modo, _cenas, _presenca, _saude, _energia, _automacoes/avisos e /registo.
  const permitidos = ['_alarme', '_automacoes', '_historico', '_config', '_modo', '_cenas', '_presenca', '_saude', '_energia', '_automacoes/avisos', '_automacoes/registo'];
  for (const t of retidos) assert.ok(permitidos.includes(t), `retido inesperado: ${t}`);
  assert.ok(retidos.has('_alarme') && retidos.has('_automacoes') && retidos.has('_historico'));
  assert.equal(m.publicados.filter((p) => p.topico.endsWith('/_eventos')).some((p) => p.retain), false);
});

test('temporizador de ocupação: novo disparo ou movimento repetido recomeçam a contagem', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]); // durante_s = 120
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/sala-4g/4/get`, '1'); // eco do aparelho: não cancela
  m.limpar();
  m.avancar(100_000);
  m.msg(`${P}/pir-corredor/1/get`, '1'); // continua a haver movimento (1 → 1)
  m.avancar(100_000); // 200 s desde o início: sem o prolongamento já teria desligado
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.avancar(10_000);
  m.msg(`${P}/pir-corredor/1/get`, '1'); // novo disparo: recomeça (t = 210 s → 330 s)
  m.limpar();
  m.avancar(119_000);
  assert.deepEqual(m.comandos(), []);
  m.avancar(1_000);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=0`]);
});

test('reversão cancelada quando alguém muda o canal à mão', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/sala-4g/4/get`, '1'); // eco do comando do motor
  m.avancar(30_000);
  m.msg(`${P}/sala-4g/4/get`, '0'); // utilizador desliga
  m.msg(`${P}/sala-4g/4/get`, '1'); // e volta a ligar à mão
  m.limpar();
  m.avancar(600_000);
  assert.deepEqual(m.comandos(), []);
  assert.equal(m.armazenamento.dados.reversoes.length, 0);
});

test('não agenda reversão se o canal já estava ligado por outra pessoa', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_automacoes/set`, [autoLuzCorredor()]);
  m.msg(`${P}/sala-4g/4/get`, '1'); // luz acesa à mão
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.limpar();
  m.avancar(600_000);
  assert.deepEqual(m.comandos(), []);
});

test('estado do alarme persiste entre reinícios', () => {
  const m = motorComAparelhos({ agora: '2026-09-26T22:10:00Z' });
  m.msg(`${P}/_alarme/set`, { ativo: true });
  m.avancar(30_000); // v3: atraso de saída
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: '2026-09-27T08:00:00Z' });
  m2.retida(`${P}/_aparelhos`, APARELHOS);
  m2.retida(`${P}/_alarme`, { ativo: false, desde: null }); // retida antiga: o estado local prevalece
  m2.motor.aoLigar();
  m2.motor.tick();
  const al = JSON.parse(m2.ultimo(`${P}/_alarme`).payload);
  assert.equal(al.ativo, true);
  assert.equal(al.estado, 'armado');
  assert.equal(al.desde, '2026-09-26T22:10:30.000Z'); // v3: "desde" = início do estado atual
  m2.msg(`${P}/porta-entrada/1/get`, '1');
  assert.equal(m2.eventos().some((e) => e.tipo === 'alarme'), true);
  assert.equal(m2.notificacoes[0].prioridade, 'urgent');
});
