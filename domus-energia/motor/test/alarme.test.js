import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor, motorV3, APARELHOS_V3, semente, ultimoJson } from './ajuda.js';

const P = 'domus/joao';
const alarme = (m) => ultimoJson(m, `${P}/_alarme`);

test('modo fora: atraso de saída a_armar → armado; _modo retido com "por"', () => {
  const m = motorV3({ agora: '2026-09-26T22:00:00Z' });
  m.msg(`${P}/_modo/set`, { modo: 'fora', por: 'web' });
  assert.deepEqual(ultimoJson(m, `${P}/_modo`), { modo: 'fora', desde: '2026-09-26T22:00:00.000Z', por: 'web' });
  assert.equal(m.ultimo(`${P}/_modo`).retain, true);
  assert.deepEqual(alarme(m), {
    ativo: true, estado: 'a_armar', tipo: 'total', desde: '2026-09-26T22:00:00.000Z', ate: '2026-09-26T22:00:30.000Z', ignorados: [], por: 'web',
  });
  const ev = m.eventos().find((e) => e.tipo === 'modo');
  assert.equal(ev.por, 'web');
  assert.match(ev.mensagem, /Modo Fora \(por web\)\. Alarme a armar: 30 s para sair\./);
  // Durante o atraso de saída, abrir a porta ou haver movimento não dispara.
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/porta-entrada/1/get`, '1');
  m.msg(`${P}/porta-entrada/1/get`, '0');
  assert.equal(m.notificacoes.length, 0);
  m.avancar(29_000);
  assert.equal(alarme(m).estado, 'a_armar');
  m.avancar(1_000);
  assert.equal(alarme(m).estado, 'armado');
  assert.equal(alarme(m).ate, null);
  // Pedido inválido: erro e nada muda.
  m.limpar();
  m.msg(`${P}/_modo/set`, { modo: 'praia' });
  m.msg(`${P}/_modo/set`, { modo: 'casa', extra: 1 });
  assert.deepEqual(m.eventos().map((e) => e.tipo), ['erro', 'erro']);
  assert.equal(m.motor.clientes.get('joao').modo.modo, 'fora');
  // Comando retido: ignorado.
  m.retida(`${P}/_modo/set`, { modo: 'casa' });
  assert.equal(m.motor.clientes.get('joao').modo.modo, 'fora');
});

test('recusa armar com portas abertas; "forcar" arma e ignora-as até fecharem', () => {
  const m = motorV3();
  m.msg(`${P}/janela-wc/1/get`, '1');
  m.limpar();
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  const [erro] = m.eventos();
  assert.equal(erro.tipo, 'erro');
  assert.equal(erro.mensagem, 'Não armado: Janela WC está aberta.');
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'casa');
  assert.equal(alarme(m).estado, 'desarmado');
  m.msg(`${P}/porta-entrada/1/get`, '1');
  m.limpar();
  m.msg(`${P}/_alarme/set`, { ativo: true }); // v2 também recusa
  assert.equal(m.eventos()[0].mensagem, 'Não armado: Porta de entrada e Janela WC estão abertas.');
  m.msg(`${P}/porta-entrada/1/get`, '0');

  m.msg(`${P}/_modo/set`, { modo: 'fora', forcar: true });
  assert.deepEqual(alarme(m).ignorados, [{ aparelho: 'janela-wc', canal: 1 }]);
  assert.match(m.eventos().at(-1).mensagem, /Ignorados \(abertos\): Janela WC/);
  m.avancar(30_000);
  m.limpar();
  // A janela ignorada fecha → volta a estar protegida; abrir outra vez dispara.
  m.msg(`${P}/janela-wc/1/get`, '0');
  assert.deepEqual(alarme(m).ignorados, []);
  m.msg(`${P}/janela-wc/1/get`, '1');
  assert.equal(alarme(m).estado, 'disparado');
  assert.equal(m.notificacoes.at(-1).prioridade, 'urgent');
});

test('porta de entrada: entrada (aviso normal, mesmo no silêncio) → sem desarme → disparado urgente', () => {
  const m = motorV3({ agora: '2026-09-26T23:30:00Z', config: { silencio: ['23:00', '07:00'] } }); // 00:30 em Lisboa
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(30_000);
  m.limpar();
  m.msg(`${P}/porta-entrada/1/get`, '1');
  const a = alarme(m);
  assert.equal(a.estado, 'entrada');
  assert.equal(Date.parse(a.ate) - Date.parse(a.desde), 30_000);
  assert.equal(m.notificacoes.length, 1);
  assert.equal(m.notificacoes[0].prioridade, 'default');
  assert.match(m.notificacoes[0].mensagem, /Porta de entrada aberta\. Desarme o alarme nos próximos 30 s\./);
  // O movimento no caminho de entrada não dispara durante o atraso.
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.avancar(29_000);
  assert.equal(alarme(m).estado, 'entrada');
  assert.equal(m.notificacoes.length, 1);
  m.avancar(1_000);
  assert.equal(alarme(m).estado, 'disparado');
  const ev = m.eventos().find((e) => e.tipo === 'alarme');
  assert.equal(ev.aparelho, 'porta-entrada');
  assert.equal(m.notificacoes[1].prioridade, 'urgent');
  // Mantém-se disparado até desarmar.
  m.avancar(600_000);
  assert.equal(alarme(m).estado, 'disparado');
  m.msg(`${P}/_modo/set`, { modo: 'casa', por: 'app' });
  assert.equal(alarme(m).estado, 'desarmado');
  assert.equal(alarme(m).por, 'app');
});

test('entrada: desarmar a tempo não dispara; outra porta durante a entrada dispara logo', () => {
  const m = motorV3();
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(30_000);
  m.msg(`${P}/porta-entrada/1/get`, '1');
  m.avancar(10_000);
  m.msg(`${P}/_alarme/set`, { ativo: false }); // v2: = modo casa
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'casa');
  m.avancar(60_000);
  assert.equal(alarme(m).estado, 'desarmado');
  assert.equal(m.notificacoes.filter((n) => n.prioridade === 'urgent').length, 0);

  m.msg(`${P}/porta-entrada/1/get`, '0');
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(30_000);
  m.msg(`${P}/porta-entrada/1/get`, '1');
  m.msg(`${P}/janela-wc/1/get`, '1');
  assert.equal(alarme(m).estado, 'disparado');
  assert.match(m.eventos().find((e) => e.tipo === 'alarme').mensagem, /Porta aberta: Janela WC\./);
});

test('modo noite (perímetro): movimento não dispara, portas sim', () => {
  const m = motorV3();
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  assert.equal(alarme(m).tipo, 'perimetro');
  m.avancar(30_000);
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.equal(alarme(m).estado, 'armado');
  // Mudar de noite para fora com o alarme armado: continua armado, passa a total.
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  assert.deepEqual([alarme(m).estado, alarme(m).tipo], ['armado', 'total']);
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  m.msg(`${P}/janela-wc/1/get`, '1');
  assert.equal(alarme(m).estado, 'disparado');
  // v2 {"ativo":true} com o alarme já armado não muda o modo.
  m.msg(`${P}/_alarme/set`, { ativo: true });
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'noite');
});

test('o estado do alarme (a_armar/entrada com "ate") persiste entre reinícios', () => {
  const m = motorV3({ agora: '2026-09-26T22:00:00Z' });
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  const guardado = m.armazenamento.dados.clientes.joao;
  assert.equal(guardado.alarme.estado, 'a_armar');
  assert.equal(guardado.modo.modo, 'fora');

  // Reinício 10 s depois: continua a armar e arma aos 30 s.
  const m2 = criarMotor({ armazenamento: m.armazenamento, agora: '2026-09-26T22:00:10Z' });
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(alarme(m2).estado, 'a_armar');
  m2.em('2026-09-26T22:00:30Z');
  assert.equal(alarme(m2).estado, 'armado');
  m2.msg(`${P}/porta-entrada/1/get`, '1');
  assert.equal(alarme(m2).estado, 'entrada');

  // Motor parado durante a entrada: ao voltar já passou o prazo → disparado.
  const m3 = criarMotor({ armazenamento: m2.armazenamento, agora: '2026-09-26T22:05:00Z' });
  m3.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m3.retida(`${P}/_ntfy`, { topico: 'domus-joao-abcdefghij0123456789' });
  m3.motor.aoLigar();
  m3.motor.tick();
  assert.equal(alarme(m3).estado, 'disparado');
  assert.equal(m3.notificacoes[0].prioridade, 'urgent');
  assert.match(m3.notificacoes[0].mensagem, /Porta de entrada aberta e o alarme não foi desarmado a tempo/);
});

test('adota um _alarme retido da v2 (sem estado) e um _modo retido', () => {
  const m = criarMotor();
  m.retida(`${P}/_alarme`, { ativo: true, desde: '2026-01-01T00:00:00Z' });
  m.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m.motor.aoLigar();
  m.motor.tick();
  assert.deepEqual([alarme(m).estado, alarme(m).tipo], ['armado', 'total']);
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'fora');
  const m2 = criarMotor();
  m2.retida(`${P}/_modo`, { modo: 'noite', desde: '2026-01-01T00:00:00Z', por: 'app' });
  m2.retida(`${P}/_alarme`, { ativo: true, estado: 'armado', tipo: 'perimetro', desde: null, ate: null, ignorados: [], por: 'app' });
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(ultimoJson(m2, `${P}/_modo`).modo, 'noite');
  assert.equal(alarme(m2).tipo, 'perimetro');
});

test('sensor do alarme offline com o alarme armado → aviso uma vez', () => {
  const m = motorV3({ agora: '2026-06-15T10:00:00Z' });
  m.msg(`${P}/janela-wc/1/get`, '0');
  m.msg(`${P}/porta-entrada/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  m.avancar(30_000);
  m.limpar();
  // 24 h depois só a janela e a porta continuam a dar notícias.
  for (let h = 0; h < 25; h++) {
    m.avancar(3_600_000);
    m.msg(`${P}/janela-wc/2/get`, '90');
    m.msg(`${P}/porta-entrada/2/get`, '90');
  }
  // Perímetro: o PIR não conta para o alarme.
  assert.equal(m.eventos().filter((e) => e.titulo === 'Sensor do alarme offline').length, 0);
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(60_000);
  m.avancar(60_000);
  const avisos = m.eventos().filter((e) => e.titulo === 'Sensor do alarme offline');
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].aparelho, 'pir-corredor');
  assert.match(avisos[0].mensagem, /Movimento corredor está offline com o alarme armado/);
});

test('férias: simulação de presença entre o pôr do sol e as 23:30 (gerador com semente), nunca cargas perigosas', () => {
  const correr = () => {
    // 15/06/2026: pôr do sol em Lisboa ≈ 21:04 (20:04 UTC).
    const m = motorV3({ agora: '2026-06-15T18:00:00Z', aleatorio: semente(42) });
    m.msg(`${P}/_modo/set`, { modo: 'ferias' });
    m.limpar();
    const cmds = [];
    for (let t = 0; t < 7 * 60; t++) {
      m.avancar(60_000);
      for (const p of m.publicados) if (!p.topico.includes('/_')) cmds.push({ hora: new Date(m.relogio.t).toISOString().slice(11, 16), cmd: `${p.topico}=${p.payload.replace(/"id":\d+,/, '')}` });
      m.limpar();
    }
    return { m, cmds };
  };
  const { m, cmds } = correr();
  assert.ok(cmds.length >= 4, `só ${cmds.length} comandos`);
  // Nada antes do pôr do sol (20:04 UTC) nem depois das 23:30 locais (22:30 UTC) além de apagar.
  for (const c of cmds) assert.ok(c.hora >= '20:04' && c.hora <= '22:31', `${c.hora} ${c.cmd}`);
  // Só os canais "simular" que não são perigosos.
  assert.equal(cmds.some((c) => c.cmd.includes('/termo/')), false);
  assert.ok(cmds.every((c) => c.cmd.includes('/sala-4g/2/set') || c.cmd.includes('/led-cozinha/')));
  assert.ok(cmds.some((c) => c.cmd.includes('/sala-4g/2/set=1')));
  // Às 23:30 fica tudo apagado.
  const ultimoSala = cmds.filter((c) => c.cmd.includes('/sala-4g/2/set')).at(-1);
  assert.equal(ultimoSala.cmd.endsWith('=0'), true);
  assert.deepEqual(m.motor.clientes.get('joao').simulacao.canais, {});
  // Mesma semente → mesma sequência.
  assert.deepEqual(correr().cmds, cmds);
});

test('férias sem localização: começa às 19:00; sair de férias apaga o que a simulação ligou', () => {
  const m = motorV3({ agora: '2026-12-10T18:00:00Z', aleatorio: () => 0, config: { local: null } }); // 18:00 em Lisboa (inverno)
  m.msg(`${P}/sala-4g/2/get`, '0');
  m.msg(`${P}/_modo/set`, { modo: 'ferias' });
  m.limpar();
  m.em('2026-12-10T18:59:00Z');
  assert.deepEqual(m.comandos(), []);
  m.em('2026-12-10T19:00:00Z');
  assert.ok(m.comandos().includes(`${P}/sala-4g/2/set=1`));
  m.msg(`${P}/sala-4g/2/get`, '1'); // eco do aparelho
  m.limpar();
  m.msg(`${P}/_modo/set`, { modo: 'casa' });
  assert.ok(m.comandos().includes(`${P}/sala-4g/2/set=0`));
  // Os comandos da simulação não contam como "mexido à mão".
  m.msg(`${P}/sala-4g/2/get`, '0');
  assert.deepEqual(m.motor.clientes.get('joao').pausas, {});
});
