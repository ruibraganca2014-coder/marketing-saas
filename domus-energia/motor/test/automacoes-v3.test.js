import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor, motorV3, APARELHOS_V3, ultimoJson } from './ajuda.js';

const P = 'domus/joao';
const registo = (m, id) => {
  m.motor.tick();
  return ultimoJson(m, `${P}/_automacoes/registo`)?.[id];
};
const guardar = (m, lista) => {
  m.limpar();
  m.msg(`${P}/_automacoes/set`, lista);
  const erro = m.eventos().find((e) => e.tipo === 'erro');
  assert.equal(erro, undefined, erro?.mensagem);
  m.limpar();
};
const notificar = (mensagem) => ({ acao: 'notificar', mensagem });

test('sensor + durante_s: "sem movimento há 10 min" dispara uma vez; cancelado se o valor muda', () => {
  const m = motorV3();
  guardar(m, [{ id: 'apagar', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 0, durante_s: 600 }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 4 }] }]);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.avancar(300_000);
  m.msg(`${P}/pir-corredor/1/get`, '1'); // houve movimento: recomeça
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.avancar(599_000);
  assert.deepEqual(m.comandos(), []);
  m.avancar(1_000);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=0`]);
  m.msg(`${P}/sala-4g/4/get`, '0'); // o aparelho confirma
  m.avancar(3_600_000);
  assert.equal(m.comandos().length, 1);
  assert.match(registo(m, 'apagar').motivo, /Movimento corredor = 0 há 600 s/);
});

test('sensor + durante_s sobrevive a um reinício do motor', () => {
  const m = motorV3();
  guardar(m, [{ id: 'apagar', quando: { tipo: 'sensor', aparelho: 'sala-4g', canal: 1, valor: 1, durante_s: 3600 }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }]);
  m.msg(`${P}/sala-4g/1/get`, '1');
  m.avancar(1_800_000);
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: m.relogio.t + 60_000 });
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.retida(`${P}/sala-4g/1/get`, '1'); // continua ligado
  m2.motor.aoLigar();
  m2.motor.tick();
  m2.limpar();
  m2.avancar(1_739_000);
  assert.deepEqual(m2.comandos(), []);
  m2.avancar(1_000);
  assert.deepEqual(m2.comandos(), [`${P}/sala-4g/1/set=0`]);
});

test('sol: pôr do sol −30 min no dia da mudança de hora (29/03/2026) e nascer a 25/10/2026', () => {
  const m = motorV3({ agora: '2026-03-29T17:00:00Z' });
  guardar(m, [
    { id: 'por', quando: { tipo: 'sol', evento: 'por', desvio_min: -30 }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 3 }] },
    { id: 'nascer', quando: { tipo: 'sol', evento: 'nascer' }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 3 }] },
  ]);
  // Pôr do sol às 19:56/19:57 (WEST) → −30 min ≈ 19:26/19:27 locais = 18:26/18:27 UTC.
  let disparo = null;
  for (let t = Date.parse('2026-03-29T17:00:00Z'); t <= Date.parse('2026-03-29T20:00:00Z'); t += 60_000) {
    m.em(new Date(t).toISOString());
    if (!disparo && m.comandos().length) disparo = new Date(t).toISOString().slice(11, 16);
  }
  assert.ok(['18:25', '18:26', '18:27'].includes(disparo), disparo);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/3/set=1`]);
  // 25/10: nascer ≈ 06:56 WET = 06:56 UTC (no dia anterior era 07:55 WEST).
  m.relogio.t = Date.parse('2026-10-25T05:30:00Z');
  m.motor.ultimoMinuto = null;
  m.limpar();
  disparo = null;
  for (let t = Date.parse('2026-10-25T05:30:00Z'); t <= Date.parse('2026-10-25T08:00:00Z'); t += 60_000) {
    m.em(new Date(t).toISOString());
    if (!disparo && m.comandos().length) disparo = new Date(t).toISOString().slice(11, 16);
  }
  assert.ok(['06:54', '06:55', '06:56', '06:57'].includes(disparo), disparo);
  assert.equal(m.comandos().length, 1);
});

test('presença: _presenca retido, chega_primeiro / sai_ultimo e condição "presenca"', () => {
  const m = motorV3({ agora: '2026-06-15T10:00:00Z' });
  guardar(m, [
    { id: 'chega', quando: { tipo: 'presenca', evento: 'chega_primeiro' }, entao: [notificar('Bem-vindo')] },
    { id: 'sai', quando: { tipo: 'presenca', evento: 'sai_ultimo' }, entao: [{ acao: 'modo', modo: 'fora' }] },
    { id: 'pir', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, se: { presenca: 'ninguem' }, entao: [notificar('Movimento sem ninguém')] },
  ]);
  m.msg(`${P}/_presenca/set`, { pessoa: 'tel-rui', nome: 'Rui', em_casa: true });
  assert.deepEqual(ultimoJson(m, `${P}/_presenca`), { pessoas: { 'tel-rui': { nome: 'Rui', em_casa: true, desde: '2026-06-15T10:00:00.000Z' } }, alguem: true });
  assert.equal(m.ultimo(`${P}/_presenca`).retain, true);
  m.msg(`${P}/_presenca/set`, { pessoa: 'tel-ana', nome: 'Ana', em_casa: true });
  assert.deepEqual(m.eventos().map((e) => e.mensagem), ['Bem-vindo']); // só o primeiro
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.equal(registo(m, 'pir').motivo, "Disparou (Movimento corredor = 1) mas não executou: Condição 'presença = ninguém' falsa (em casa: Rui, Ana)");
  m.msg(`${P}/_presenca/set`, { pessoa: 'tel-rui', em_casa: false });
  assert.equal(m.motor.clientes.get('joao').modo.modo, 'casa');
  m.msg(`${P}/_presenca/set`, { pessoa: 'tel-ana', remover: true });
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'fora');
  assert.equal(ultimoJson(m, `${P}/_modo`).por, 'automacao:sai');
  // Pedidos inválidos ignorados sem evento.
  m.limpar();
  m.msg(`${P}/_presenca/set`, { pessoa: 'x', em_casa: 'sim' });
  m.msg(`${P}/_presenca/set`, { pessoa: 'x', em_casa: true, lat: 1 });
  assert.equal(m.publicados.length, 0);
});

test('gatilho modo, ação modo (por "automacao:<id>") e proteção contra ciclos', () => {
  const m = motorV3();
  guardar(m, [
    { id: 'noite', quando: { tipo: 'modo', modo: 'noite' }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'ciclo-a', quando: { tipo: 'modo', modo: 'fora' }, entao: [{ acao: 'modo', modo: 'ferias' }] },
    { id: 'ciclo-b', quando: { tipo: 'modo', modo: 'ferias' }, entao: [{ acao: 'modo', modo: 'fora' }] },
  ]);
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/1/set=0`]);
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  // Termina (profundidade e limite por minuto) sem rebentar.
  const modos = m.publicados.filter((p) => p.topico === `${P}/_modo`).length;
  assert.ok(modos > 2 && modos < 30, `${modos}`);
  assert.match(ultimoJson(m, `${P}/_modo`).por, /^automacao:ciclo-/);
});

test('manual: _automacoes/executar executa (com condições), testar ignora-as, avaliar só avalia', () => {
  const m = motorV3({ agora: '2026-06-15T12:00:00Z' }); // segunda-feira, 13:00
  guardar(m, [{ id: 'botao', nome: 'Botão', ativa: true, quando: { tipo: 'manual' }, se: { modo: ['noite'] }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 2 }] }]);
  m.msg(`${P}/_automacoes/executar`, { id: 'botao' });
  assert.deepEqual(m.comandos(), []);
  let r = registo(m, 'botao');
  assert.equal(r.resultado, 'condicao_falsa');
  assert.match(r.motivo, /Condição 'modo = noite' falsa \(modo atual: casa\)/);
  m.msg(`${P}/_automacoes/executar`, { id: 'botao', avaliar: true });
  r = registo(m, 'botao');
  assert.deepEqual([r.resultado, r.ok], ['avaliacao', false]);
  assert.deepEqual(m.comandos(), []);
  m.msg(`${P}/_automacoes/executar`, { id: 'botao', testar: true });
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/2/set=1`]);
  r = registo(m, 'botao');
  assert.deepEqual([r.resultado, r.teste, r.ultimos[0].teste], ['teste', true, true]);
  assert.equal(r.ultimos.length, 3);
  assert.equal(r.semana, 0); // testes e avaliações não contam
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  m.msg(`${P}/_automacoes/executar`, { id: 'botao', por: 'web' });
  assert.equal(registo(m, 'botao').resultado, 'executada');
  assert.equal(registo(m, 'botao').semana, 1);
  // Erros: id desconhecido, campos a mais, testar+avaliar.
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'nada' });
  m.msg(`${P}/_automacoes/executar`, { id: 'botao', x: 1 });
  m.msg(`${P}/_automacoes/executar`, { id: 'botao', testar: true, avaliar: true });
  assert.deepEqual(m.eventos().map((e) => e.tipo), ['erro', 'erro', 'erro']);
});

test('potência com histerese (rearmar_w)', () => {
  const m = motorV3();
  guardar(m, [{ id: 'pico', quando: { tipo: 'potencia', aparelho: 'quadro', acima_w: 3500, rearmar_w: 3000 }, entao: [notificar('Consumo alto')] }]);
  const n = () => m.eventos().filter((e) => e.mensagem === 'Consumo alto').length;
  m.msg(`${P}/quadro/power/get`, '3600');
  m.avancar(1000);
  assert.equal(n(), 1);
  m.msg(`${P}/quadro/power/get`, '3200'); // abaixo do limite mas acima de rearmar_w
  m.msg(`${P}/quadro/power/get`, '3600');
  m.avancar(1000);
  assert.equal(n(), 1);
  m.msg(`${P}/quadro/power/get`, '2900'); // rearma
  m.msg(`${P}/quadro/power/get`, '3600');
  m.avancar(1000);
  assert.equal(n(), 2);
  // Por omissão, rearma a 90 % de acima_w.
  guardar(m, [{ id: 'p2', quando: { tipo: 'potencia', aparelho: 'quadro', acima_w: 1000 }, entao: [notificar('P2')] }]);
  const k = () => m.eventos().filter((e) => e.mensagem === 'P2').length;
  m.msg(`${P}/quadro/power/get`, '1100');
  m.avancar(1000);
  m.msg(`${P}/quadro/power/get`, '950');
  m.msg(`${P}/quadro/power/get`, '1100');
  m.avancar(1000);
  assert.equal(k(), 1);
  m.msg(`${P}/quadro/power/get`, '899');
  m.msg(`${P}/quadro/power/get`, '1100');
  m.avancar(1000);
  assert.equal(k(), 2);
});

test('condições: motivos claros no registo (dias, sol, modo, aparelhos, alarme, entre)', () => {
  const m = motorV3({ agora: '2026-06-20T12:00:00Z' }); // sábado, 13:00 (dia)
  const aut = (id, se) => ({ id, quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, se, entao: [notificar(id)] });
  guardar(m, [
    aut('dias', { dias: [1, 2, 3, 4, 5] }),
    aut('sol', { sol: 'noite' }),
    aut('modo', { modo: ['noite', 'fora'] }),
    aut('ap', { aparelhos: [{ aparelho: 'sala-4g', canal: 1, valor: 1 }] }),
    aut('ap2', { aparelhos: [{ aparelho: 'sala-4g', canal: 2, valor: 1 }] }),
    aut('alarme', { alarme: true }),
    aut('entre', { entre: ['19:00', '07:00'] }),
    aut('tudo', { dias: [6], sol: 'dia', modo: ['casa'], presenca: 'ninguem', aparelhos: [{ aparelho: 'sala-4g', canal: 2, valor: 0 }] }),
  ]);
  m.msg(`${P}/sala-4g/2/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  const motivo = (id) => registo(m, id).motivo.replace(/^Disparou \(Movimento corredor = 1\) mas não executou: /, '');
  assert.equal(motivo('dias'), "Condição 'dias = seg, ter, qua, qui, sex' falsa (hoje: sáb)");
  assert.match(motivo('sol'), /^Condição 'sol = noite' falsa \(agora é dia; nascer às 06:1\d, pôr às 21:0\d\)$/);
  assert.equal(motivo('modo'), "Condição 'modo = noite ou fora' falsa (modo atual: casa)");
  assert.equal(motivo('ap'), "Condição 'Teto = 1' falsa (valor atual desconhecido)");
  assert.equal(motivo('ap2'), "Condição 'Candeeiro = 1' falsa (valor atual: 0)");
  assert.equal(motivo('alarme'), "Condição 'alarme = ligado' falsa (alarme atual: desligado)");
  assert.equal(motivo('entre'), "Condição 'entre 19:00 e 07:00' falsa (agora: 13:00)");
  assert.equal(registo(m, 'tudo').resultado, 'executada');
  assert.deepEqual(m.eventos().filter((e) => e.tipo === 'automacao').map((e) => e.mensagem), ['tudo']);
  assert.equal(registo(m, 'dias').resultado, 'condicao_falsa');
});

test('ações: luz com brilho (OpenBeken e Shelly), alternar, cena', () => {
  const m = motorV3();
  m.msg(`${P}/_cenas/set`, [{ id: 'cinema', nome: 'Cinema', icone: 'filme', acoes: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }]);
  guardar(m, [{
    id: 'acoes', quando: { tipo: 'manual' },
    entao: [
      { acao: 'luz', aparelho: 'led-quarto', canal: 1, brilho: 30 },
      { acao: 'luz', aparelho: 'led-cozinha', canal: 1, brilho: 80 },
      { acao: 'luz', aparelho: 'led-cozinha', canal: 1, brilho: 0 },
      { acao: 'alternar', aparelho: 'sala-4g', canal: 2 },
      { acao: 'cena', cena: 'cinema' },
    ],
  }]);
  m.msg(`${P}/sala-4g/2/get`, '1');
  m.msg(`${P}/_automacoes/executar`, { id: 'acoes' });
  const cmds = m.comandos().map((c) => c.replace(/"id":\d+,/, ''));
  assert.deepEqual(cmds, [
    `${P}/led-quarto/1/set=1`,
    `${P}/led-quarto/led_dimmer/set=30`,
    `${P}/led-cozinha/rpc={"src":"motor","method":"Light.Set","params":{"id":0,"on":true,"brightness":80}}`,
    `${P}/led-cozinha/rpc={"src":"motor","method":"Light.Set","params":{"id":0,"on":false}}`,
    `${P}/sala-4g/2/set=0`,
    `${P}/sala-4g/1/set=0`,
  ]);
});

test('esperar: ações em sequência, novo disparo recomeça, sobrevive a reinícios', () => {
  const m = motorV3();
  guardar(m, [{
    id: 'seq', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 },
    entao: [
      { acao: 'ligar', aparelho: 'sala-4g', canal: 4 },
      { acao: 'esperar', s: 60 },
      { acao: 'luz', aparelho: 'led-quarto', canal: 1, brilho: 10 },
      { acao: 'esperar', s: 120 },
      { acao: 'desligar', aparelho: 'sala-4g', canal: 4 },
      notificar('Fim'),
    ],
  }]);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
  m.avancar(59_000);
  assert.equal(m.comandos().length, 1);
  m.avancar(1_000);
  assert.deepEqual(m.comandos().slice(1), [`${P}/led-quarto/1/set=1`, `${P}/led-quarto/led_dimmer/set=10`]);
  // Novo disparo: a sequência pendente é substituída.
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.equal(m.motor.sequencias.length, 1);
  m.limpar();
  // Reinício a meio do "esperar".
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: m.relogio.t + 30_000 });
  assert.equal(m2.armazenamento.dados.sequencias.length, 1);
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.motor.aoLigar();
  m2.motor.tick();
  m2.limpar();
  m2.avancar(29_000);
  assert.deepEqual(m2.comandos(), []);
  m2.avancar(1_000);
  assert.deepEqual(m2.comandos(), [`${P}/led-quarto/1/set=1`, `${P}/led-quarto/led_dimmer/set=10`]);
  m2.avancar(120_000);
  assert.deepEqual(m2.comandos().slice(2), [`${P}/sala-4g/4/set=0`]);
  assert.deepEqual(m2.eventos().map((e) => e.mensagem), ['Fim']);
  assert.equal(m2.motor.sequencias.length, 0);
});

test('se/senão: o ramo é escolhido quando é alcançado (depois de esperar)', () => {
  const m = motorV3();
  guardar(m, [{
    id: 'ramo', quando: { tipo: 'manual' },
    entao: [
      { acao: 'esperar', s: 10 },
      {
        acao: 'se', condicao: { modo: ['noite'] },
        entao: [{ acao: 'luz', aparelho: 'led-quarto', canal: 1, brilho: 5 }],
        senao: [{ acao: 'se', condicao: { aparelhos: [{ aparelho: 'sala-4g', canal: 1, valor: 1 }] }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }], senao: [notificar('Nada a fazer')] }],
      },
    ],
  }]);
  m.msg(`${P}/_automacoes/executar`, { id: 'ramo' });
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  m.avancar(10_000);
  assert.deepEqual(m.comandos(), [`${P}/led-quarto/1/set=1`, `${P}/led-quarto/led_dimmer/set=5`]);
  m.msg(`${P}/_modo/set`, { modo: 'casa' });
  m.msg(`${P}/sala-4g/1/get`, '1');
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'ramo' });
  m.avancar(10_000);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/1/set=0`]);
  m.msg(`${P}/sala-4g/1/get`, '0');
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'ramo' });
  m.avancar(10_000);
  assert.deepEqual(m.eventos().map((e) => e.mensagem), ['Nada a fazer']);
});

test('pausa manual: canal mexido à mão pausa as automações desse canal (exceto ignorar_pausa)', () => {
  const m = motorV3({ agora: '2026-06-15T12:00:00Z' }); // 13:00 em Lisboa
  guardar(m, [
    { id: 'luz', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4, durante_s: 120 }, notificar('Movimento')] },
    { id: 'forte', ignorar_pausa: true, quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 3 }] },
    { id: 'so-luz', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4 }] },
  ]);
  m.msg(`${P}/sala-4g/4/get`, '0');
  m.msg(`${P}/sala-4g/3/get`, '0');
  // Eco dos comandos do motor: não é mexer à mão.
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/sala-4g/4/get`, '1');
  m.msg(`${P}/sala-4g/3/get`, '1');
  assert.deepEqual(m.motor.clientes.get('joao').pausas, {});
  // Alguém desliga o corredor no interruptor.
  m.msg(`${P}/sala-4g/4/get`, '0');
  assert.equal(registo(m, 'luz').resultado, 'pausada');
  assert.equal(registo(m, 'luz').motivo, 'Pausa manual: Corredor mexido à mão; em pausa para este canal até 14:00.');
  assert.equal(registo(m, 'forte').resultado, 'executada');
  m.msg(`${P}/sala-4g/3/get`, '0'); // e a varanda
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/3/set=1`]); // só a que ignora a pausa
  assert.equal(registo(m, 'so-luz').resultado, 'pausada');
  assert.equal(registo(m, 'so-luz').motivo, 'Disparou (Movimento corredor = 1) mas não executou. Pausa manual: Corredor até 14:00.');
  assert.equal(registo(m, 'luz').resultado, 'executada'); // notificou; o canal ficou de fora
  assert.match(registo(m, 'luz').motivo, /Pausa manual: Corredor até 14:00 \(ações nesses canais não executadas\)/);
  // Passada a hora, volta a agir.
  m.avancar(3_600_000);
  m.limpar();
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.ok(m.comandos().includes(`${P}/sala-4g/4/set=1`));
  // pausa_manual_min = 0 desliga a funcionalidade.
  m.msg(`${P}/_config/set`, { pausa_manual_min: 0 });
  m.msg(`${P}/sala-4g/4/get`, '1');
  m.msg(`${P}/sala-4g/4/get`, '0');
  assert.equal(m.motor.pausaAtiva(m.motor.clientes.get('joao'), 'sala-4g', 4), null);
});

test('registo: aparelho do gatilho offline, ação sem resposta em 5 s, máximo 20 entradas', () => {
  const m = motorV3({ agora: '2026-06-15T13:02:00Z' }); // 14:02 em Lisboa
  guardar(m, [
    { id: 'interruptor', quando: { tipo: 'sensor', aparelho: 'sala-4g', canal: 1, valor: 1 }, entao: [{ acao: 'ligar', aparelho: 'led-quarto', canal: 1 }] },
  ]);
  m.msg(`${P}/sala-4g/connected`, 'online');
  m.msg(`${P}/sala-4g/connected`, 'offline');
  let r = registo(m, 'interruptor');
  assert.equal(r.resultado, 'falhou');
  assert.equal(r.motivo, 'Não disparou: aparelho do gatilho (Interruptor sala) offline desde 14:02');
  assert.equal(m.ultimo(`${P}/_automacoes/registo`).retain, true);
  // O LED não confirma o comando.
  m.msg(`${P}/sala-4g/1/get`, '1');
  assert.equal(registo(m, 'interruptor').resultado, 'executada');
  m.avancar(4_000);
  assert.equal(registo(m, 'interruptor').resultado, 'executada');
  m.avancar(1_000);
  r = registo(m, 'interruptor');
  assert.equal(r.resultado, 'falhou');
  assert.equal(r.motivo, 'Ação falhou: LED quarto não respondeu em 5 s.');
  // Com confirmação não há falha.
  m.msg(`${P}/sala-4g/1/get`, '0');
  m.msg(`${P}/sala-4g/1/get`, '1');
  m.msg(`${P}/led-quarto/1/get`, '1');
  m.avancar(10_000);
  assert.equal(registo(m, 'interruptor').resultado, 'executada');
  for (let i = 0; i < 50; i++) {
    m.avancar(4_000);
    m.msg(`${P}/sala-4g/1/get`, String(i % 2));
  }
  r = registo(m, 'interruptor');
  assert.equal(r.ultimos.length, 20);
  assert.equal(r.ultimos[0].ts, r.ultima);
  assert.ok(r.semana >= 15);
});

test('carga perigosa e conflitos ao gravar; _automacoes/avisos retido', () => {
  const m = motorV3();
  m.msg(`${P}/_automacoes/set`, [{ id: 'aquecer', quando: { tipo: 'hora', hora: '06:00' }, entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1 }] }]);
  const [ev] = m.eventos();
  assert.equal(ev.tipo, 'erro');
  assert.match(ev.mensagem, /Termoacumulador" é uma carga perigosa: só pode ser ligada com "durante_s" até 14400 s \(4 h\)/);
  m.limpar();
  const q = { tipo: 'hora', hora: '07:00' };
  m.msg(`${P}/_automacoes/set`, [
    { id: 'aquecer', quando: q, entao: [{ acao: 'ligar', aparelho: 'termo', canal: 1, durante_s: 3600 }] },
    { id: 'a', quando: q, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }] },
    { id: 'b', quando: q, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] },
  ]);
  assert.equal(m.eventos().length, 0); // não bloqueia
  assert.deepEqual(ultimoJson(m, `${P}/_automacoes/avisos`), [{ ids: ['a', 'b'], mensagem: "'a' liga e 'b' desliga Teto no mesmo gatilho" }]);
  assert.equal(m.ultimo(`${P}/_automacoes/avisos`).retain, true);
  assert.equal(ultimoJson(m, `${P}/_automacoes`).length, 3);
});

test('cenas: _cenas/set retido, executar (evento, modo "por cena:<id>"), bloqueadas, erros', () => {
  const m = motorV3();
  m.msg(`${P}/_cenas/set`, [{
    id: 'sair', nome: 'Sair de casa', icone: 'porta',
    acoes: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }, { acao: 'estore', aparelho: 'estore-quarto', canal: 1, posicao: 0 }, { acao: 'modo', modo: 'fora' }],
  }]);
  assert.equal(m.ultimo(`${P}/_cenas`).retain, true);
  assert.equal(ultimoJson(m, `${P}/_cenas`)[0].nome, 'Sair de casa');
  m.limpar();
  m.msg(`${P}/_cenas/executar`, { id: 'sair', por: 'app' });
  const cmds = m.comandos();
  assert.equal(cmds[0], `${P}/sala-4g/1/set=0`);
  assert.match(cmds[1], /estore-quarto\/rpc=.*Cover.GoToPosition.*"pos":0/);
  assert.deepEqual(ultimoJson(m, `${P}/_modo`).por, 'cena:sair');
  assert.equal(m.eventos()[0].titulo, 'Cena: Sair de casa');
  // Erros.
  m.limpar();
  m.msg(`${P}/_cenas/executar`, { id: 'praia' });
  m.msg(`${P}/_cenas/set`, [{ id: 'x', acoes: [{ acao: 'cena', cena: 'sair' }] }]);
  assert.deepEqual(m.eventos().map((e) => e.titulo), ['Cena não executada', 'Cenas não guardadas']);
  // Cena usada por uma automação não pode ser apagada.
  guardar(m, [{ id: 'usa', nome: 'Usa', quando: { tipo: 'manual' }, entao: [{ acao: 'cena', cena: 'sair' }] }]);
  m.msg(`${P}/_cenas/set`, []);
  assert.match(m.eventos()[0].mensagem, /é usada pela automação "Usa"/);
  // Administração: cena bloqueada; o cliente não a altera.
  m.msg(`${P}/_cenas/admin`, { op: 'guardar', cena: { id: 'empresa', nome: 'Da empresa', acoes: [notificar('x')] }, pedido: 'p1' });
  assert.deepEqual(ultimoJson(m, `${P}/_cenas/admin/resultado`), { pedido: 'p1', ok: true });
  const lista = ultimoJson(m, `${P}/_cenas`);
  assert.equal(lista.find((c) => c.id === 'empresa').bloqueada, true);
  m.msg(`${P}/_cenas/set`, lista.map((c) => ({ ...c, nome: 'Mudada' })));
  assert.equal(ultimoJson(m, `${P}/_cenas`).find((c) => c.id === 'empresa').nome, 'Da empresa');
  assert.equal(ultimoJson(m, `${P}/_cenas`).find((c) => c.id === 'sair').nome, 'Mudada');
  // Comandos retidos são ignorados.
  m.limpar();
  m.retida(`${P}/_cenas/executar`, { id: 'sair' });
  m.retida(`${P}/_automacoes/executar`, { id: 'usa', testar: true });
  assert.equal(m.publicados.length, 0);
});

test('cenas e automações persistem e são adotadas das mensagens retidas', () => {
  const m = motorV3();
  m.msg(`${P}/_cenas/set`, [{ id: 'cinema', acoes: [notificar('x')] }]);
  guardar(m, [{ id: 'a', quando: { tipo: 'manual' }, entao: [{ acao: 'cena', cena: 'cinema' }] }]);
  const m2 = criarMotor({ armazenamento: m.armazenamento });
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(ultimoJson(m2, `${P}/_cenas`)[0].id, 'cinema');
  const m3 = criarMotor();
  m3.retida(`${P}/_cenas`, [{ id: 'retida', nome: 'Retida', bloqueada: true, acoes: [notificar('y')] }]);
  m3.retida(`${P}/_presenca`, { pessoas: { t1: { nome: 'Rui', em_casa: true, desde: '2026-01-01T00:00:00Z' } }, alguem: true });
  m3.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m3.motor.aoLigar();
  m3.motor.tick();
  assert.equal(ultimoJson(m3, `${P}/_cenas`)[0].bloqueada, true);
  assert.equal(ultimoJson(m3, `${P}/_presenca`).alguem, true);
});
