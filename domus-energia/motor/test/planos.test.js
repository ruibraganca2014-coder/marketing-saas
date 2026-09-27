import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMotor, motorV3, APARELHOS_V3, NTFY, ultimoJson } from './ajuda.js';
import { MemoriaEstado } from '../src/armazenamento.js';
import { permite, mensagemBloqueio, validarPlano, planoMinimo, FUNCIONALIDADES, PLANO_PADRAO } from '../src/planos.js';

const P = 'domus/joao';
const CONFORTO = 'Disponível a partir do plano Conforto.';
const SUSPENSA = 'Subscrição suspensa. Reative a subscrição para voltar a usar esta funcionalidade.';
const plano = (plano, estado = 'ativo', extra = {}) => ({ plano, estado, gerido: 'stripe', ...extra });
const cli = (m) => m.motor.clientes.get('joao');
const erros = (m) => m.eventos().filter((e) => e.tipo === 'erro');

// ------------------------------------------------------------ tabela (planos.js)

test('permite: tabela única por plano (§1)', () => {
  for (const k of ['controlo', 'automacoes', 'cenas', 'historico', 'relatorio']) {
    for (const p of ['base', 'conforto', 'premium']) assert.equal(permite(p, 'ativo', k), true, `${p}/${k}`);
  }
  for (const k of ['alarme', 'notificacoes', 'saude', 'energia', 'relatorio_diario']) {
    assert.equal(permite('base', 'ativo', k), false, k);
    assert.equal(permite('conforto', 'ativo', k), true, k);
    assert.equal(permite('premium', 'ativo', k), true, k);
  }
  for (const k of ['local', 'suporte_prioritario']) {
    assert.equal(permite('conforto', 'ativo', k), false);
    assert.equal(permite('premium', 'ativo', k), true);
  }
  assert.equal(Object.keys(FUNCIONALIDADES).length, 12);
  assert.equal(planoMinimo('alarme'), 'conforto');
  assert.equal(planoMinimo('local'), 'premium');
  assert.equal(permite('conforto', 'ativo', 'desconhecida'), false);
  assert.equal(permite('ouro', 'ativo', 'controlo'), false);
});

test('permite: teste e em_atraso têm o plano completo; suspenso e cancelado nada (§3)', () => {
  for (const e of ['teste', 'em_atraso']) {
    assert.equal(permite('conforto', e, 'alarme'), true);
    assert.equal(permite('base', e, 'alarme'), false);
    assert.equal(permite('base', e, 'automacoes'), true);
  }
  for (const e of ['suspenso', 'cancelado']) {
    for (const k of Object.keys(FUNCIONALIDADES)) assert.equal(permite('premium', e, k), false, `${e}/${k}`);
  }
  assert.equal(permite('conforto', 'pausado', 'controlo'), false);
});

test('mensagens de bloqueio em pt-PT', () => {
  assert.equal(mensagemBloqueio('base', 'ativo', 'alarme'), CONFORTO);
  assert.equal(mensagemBloqueio('conforto', 'ativo', 'local'), 'Disponível a partir do plano Premium.');
  assert.equal(mensagemBloqueio('conforto', 'suspenso', 'automacoes'), SUSPENSA);
  assert.equal(mensagemBloqueio('base', 'cancelado', 'cenas'), 'Subscrição cancelada. Reative a subscrição para voltar a usar esta funcionalidade.');
});

test('validarPlano: validação estrita do _plano (§2)', () => {
  const ok = validarPlano({ plano: 'conforto', estado: 'ativo', desde: '2026-10-01T10:00:00Z', proximo_pagamento: '2026-11-01T10:00:00Z', aviso_ate: null, gerido: 'stripe' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.plano, { plano: 'conforto', estado: 'ativo', gerido: 'stripe', desde: '2026-10-01T10:00:00Z', proximo_pagamento: '2026-11-01T10:00:00Z', aviso_ate: null });
  assert.equal(validarPlano({ plano: 'base', estado: 'em_atraso', aviso_ate: '2026-10-16T10:00:00.000Z' }).ok, true);
  assert.equal(validarPlano({ plano: 'base', estado: 'ativo' }).plano.gerido, 'manual');
  for (const [v, re] of [
    [null, /objeto/],
    [[], /objeto/],
    [{ plano: 'ouro', estado: 'ativo' }, /plano desconhecido/],
    [{ plano: 'base' }, /estado desconhecido/],
    [{ plano: 'base', estado: 'pausado' }, /estado desconhecido/],
    [{ plano: 'base', estado: 'ativo', gerido: 'paypal' }, /gerido/],
    [{ plano: 'base', estado: 'ativo', desde: 'ontem' }, /desde/],
    [{ plano: 'base', estado: 'ativo', aviso_ate: 5 }, /aviso_ate/],
    [{ plano: 'base', estado: 'ativo', extra: 1 }, /campo desconhecido "extra"/],
  ]) {
    const r = validarPlano(v);
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.match(r.erro, re);
  }
});

// ------------------------------------------------------------ _plano no motor

test('sem _plano: conforto/ativo/manual (clientes antigos não perdem nada)', () => {
  const m = motorV3();
  assert.deepEqual(m.motor.planoDe(cli(m)), PLANO_PADRAO);
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'fora');
  assert.equal(erros(m).length, 0);
});

test('_plano inválido é ignorado; vazio volta ao plano por omissão; o motor nunca o publica', () => {
  const m = motorV3();
  m.msg(`${P}/_plano`, plano('base'));
  assert.equal(m.motor.planoDe(cli(m)).plano, 'base');
  m.msg(`${P}/_plano`, { plano: 'premium', estado: 'ativo', hack: true });
  m.msg(`${P}/_plano`, 'isto não é JSON');
  m.msg(`${P}/_plano`, { plano: 'ouro', estado: 'ativo' });
  assert.equal(m.motor.planoDe(cli(m)).plano, 'base');
  m.msg(`${P}/_plano`, '');
  assert.deepEqual(m.motor.planoDe(cli(m)), PLANO_PADRAO);
  assert.equal(m.publicados.filter((p) => p.topico === `${P}/_plano`).length, 0);
});

test('plano base: modos fora/noite/férias recusados com erro pt-PT; casa permitido', () => {
  const m = motorV3();
  m.msg(`${P}/_plano`, plano('base'));
  m.limpar();
  for (const modo of ['fora', 'noite', 'ferias']) m.msg(`${P}/_modo/set`, { modo });
  m.msg(`${P}/_alarme/set`, { ativo: true });
  const e = erros(m);
  assert.equal(e.length, 4);
  for (const x of e) assert.equal(x.mensagem, CONFORTO);
  assert.deepEqual(e.map((x) => x.titulo), ['Modo não alterado', 'Modo não alterado', 'Modo não alterado', 'Alarme não alterado']);
  assert.equal(cli(m).modo.modo, 'casa');
  assert.equal(cli(m).alarme.estado, 'desarmado');
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'casa'); // republicado para a app voltar ao estado real
  m.limpar();
  m.msg(`${P}/_modo/set`, { modo: 'casa' });
  m.msg(`${P}/_alarme/set`, { ativo: false });
  assert.equal(erros(m).length, 0);
});

test('plano base: automações e cenas com modos armados são recusadas ao gravar', () => {
  const m = motorV3();
  m.msg(`${P}/_plano`, plano('base'));
  const aut = (id, extra) => ({ id, nome: id, quando: { tipo: 'manual' }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }], ...extra });
  const casos = [
    [aut('sair', { entao: [{ acao: 'modo', modo: 'fora' }] }), 'Automação "sair": o modo Fora não está incluído no seu plano. '],
    [aut('dormir', { entao: [{ acao: 'se', condicao: { entre: ['22:00', '06:00'] }, entao: [{ acao: 'modo', modo: 'noite' }] }] }), 'Automação "dormir": o modo Noite não está incluído no seu plano. '],
    [aut('ao-noite', { quando: { tipo: 'modo', modo: 'noite' } }), 'Automação "ao-noite": o modo Noite não está incluído no seu plano. '],
  ];
  for (const [a, prefixo] of casos) {
    m.limpar();
    m.msg(`${P}/_automacoes/set`, [a]);
    const [e] = erros(m);
    assert.equal(e.titulo, 'Automações não guardadas');
    assert.equal(e.mensagem, prefixo + CONFORTO);
    assert.deepEqual(cli(m).automacoes, []);
  }
  // Permitido: modo casa, gatilho modo casa e condições sobre o modo.
  m.limpar();
  m.msg(`${P}/_automacoes/set`, [
    aut('chegar', { entao: [{ acao: 'modo', modo: 'casa' }] }),
    aut('em-casa', { quando: { tipo: 'modo', modo: 'casa' } }),
    aut('cond', { se: { modo: ['fora', 'casa'] } }),
  ]);
  assert.equal(erros(m).length, 0);
  assert.equal(cli(m).automacoes.length, 3);
  // Cenas.
  m.limpar();
  m.msg(`${P}/_cenas/set`, [{ id: 'ferias', nome: 'Férias', acoes: [{ acao: 'modo', modo: 'ferias' }] }]);
  assert.equal(erros(m)[0].titulo, 'Cenas não guardadas');
  assert.equal(erros(m)[0].mensagem, `Cena "ferias": o modo Férias não está incluído no seu plano. ${CONFORTO}`);
  m.msg(`${P}/_cenas/set`, [{ id: 'sair', nome: 'Sair', acoes: [{ acao: 'modo', modo: 'casa' }] }]);
  assert.equal(cli(m).cenas.length, 1);
});

test('descida para base: automações antigas com modos armados ficam (só ativa muda) e a ação é recusada na execução', () => {
  const m = motorV3();
  const sair = { id: 'sair', nome: 'Sair de casa', quando: { tipo: 'manual' }, entao: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }, { acao: 'modo', modo: 'fora' }] };
  const luz = { id: 'luz', nome: 'Luz', quando: { tipo: 'manual' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 2 }] };
  m.msg(`${P}/_automacoes/set`, [sair]);
  m.msg(`${P}/_cenas/set`, [{ id: 'fora', nome: 'Fora', acoes: [{ acao: 'modo', modo: 'fora' }] }]);
  m.msg(`${P}/_plano`, plano('base'));
  m.limpar();
  // A app reenvia a lista completa (a antiga sem alterações + uma nova): aceite.
  m.msg(`${P}/_automacoes/set`, [cli(m).automacoes[0], luz]);
  assert.equal(erros(m).length, 0);
  m.msg(`${P}/_automacoes/set`, [{ ...cli(m).automacoes[0], ativa: false }, luz]);
  assert.equal(cli(m).automacoes[0].ativa, false);
  m.msg(`${P}/_automacoes/set`, [{ ...cli(m).automacoes[0], ativa: true }, luz]);
  // Alterada → recusada.
  m.msg(`${P}/_automacoes/set`, [{ ...cli(m).automacoes[0], nome: 'Outro nome' }, luz]);
  assert.equal(erros(m).length, 1);
  assert.equal(cli(m).automacoes[0].nome, 'Sair de casa');
  // Cena antiga reenviada sem mudanças: aceite.
  m.msg(`${P}/_cenas/set`, [...cli(m).cenas, { id: 'nova', nome: 'Nova', acoes: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }]);
  assert.equal(erros(m).length, 1);
  assert.equal(cli(m).cenas.length, 2);
  // Execução: o resto das ações corre, o modo não muda e fica no registo.
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'sair' });
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/1/set=0`]);
  assert.equal(cli(m).modo.modo, 'casa');
  const reg = cli(m).registo.sair.ultimos;
  assert.ok(reg.some((x) => x.resultado === 'falhou' && x.motivo === `Modo Fora não ativado: ${CONFORTO}`));
  m.msg(`${P}/_cenas/executar`, { id: 'fora' });
  assert.equal(cli(m).modo.modo, 'casa');
});

test('plano base: sem notificações (eventos no histórico), sem _saude/_energia, sem relatório diário', () => {
  const m = motorV3({ agora: '2026-09-26T06:58:00Z', config: { relatorio_diario: '08:00' } }); // 07:58 em Lisboa
  m.msg(`${P}/_plano`, plano('base'));
  m.msg(`${P}/_automacoes/set`, [{ id: 'aviso', nome: 'Aviso', quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: 'Olá' }] }]);
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'aviso' });
  m.msg(`${P}/quadro/energycounter/get`, '1000');
  m.msg(`${P}/quadro/energycounter/get`, '1500');
  m.msg(`${P}/sala-4g/connected`, 'offline');
  for (let i = 0; i < 10; i++) m.avancar(60_000); // passa as 08:00 e dois múltiplos de 5 min
  assert.equal(m.notificacoes.length, 0);
  assert.equal(cli(m).historico[0].mensagem, 'Olá');
  assert.equal(m.publicados.filter((p) => p.topico === `${P}/_saude` || p.topico === `${P}/_energia`).length, 0);
  // O motor continua a contar a energia (subida de plano = dados certos logo).
  m.limpar();
  m.msg(`${P}/_plano`, plano('conforto'));
  assert.equal(ultimoJson(m, `${P}/_energia`).hoje_kwh, 0.5);
  assert.equal(m.ultimo(`${P}/_energia`).retain, true);
  assert.equal(ultimoJson(m, `${P}/_saude`)['sala-4g'].online, false);
  m.msg(`${P}/_automacoes/executar`, { id: 'aviso' });
  assert.equal(m.notificacoes.length, 1);
});

test('descida de plano com alarme armado → casa com evento por "plano"; _saude/_energia apagados; subida não muda nada', () => {
  const m = motorV3();
  m.msg(`${P}/quadro/energycounter/get`, '1000');
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(30_000);
  assert.equal(cli(m).alarme.estado, 'armado');
  m.limpar();
  m.msg(`${P}/_plano`, plano('base'));
  const ev = m.eventos().find((e) => e.tipo === 'modo');
  assert.equal(ev.por, 'plano');
  assert.equal(ev.mensagem, 'Modo Casa (por plano). Alarme desarmado.');
  assert.deepEqual(ultimoJson(m, `${P}/_modo`), { modo: 'casa', desde: cli(m).modo.desde, por: 'plano' });
  assert.equal(ultimoJson(m, `${P}/_alarme`).estado, 'desarmado');
  for (const t of ['_saude', '_energia']) {
    const p = m.ultimo(`${P}/${t}`);
    assert.deepEqual([p.payload, p.retain], ['', true], t);
  }
  // Mudança só de metadados (mesmo plano/estado): nada acontece.
  m.limpar();
  m.msg(`${P}/_plano`, plano('base', 'ativo', { proximo_pagamento: '2026-11-01T10:00:00Z' }));
  assert.equal(m.publicados.length, 0);
  // Subida: nada de especial (o modo fica casa); _saude/_energia voltam.
  m.msg(`${P}/_plano`, plano('premium'));
  assert.equal(m.eventos().length, 0);
  assert.equal(cli(m).modo.modo, 'casa');
  assert.notEqual(m.ultimo(`${P}/_saude`).payload, '');
  assert.notEqual(m.ultimo(`${P}/_energia`).payload, '');
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  assert.equal(cli(m).modo.modo, 'noite');
});

test('em_atraso e teste: funcionalidades completas do plano', () => {
  for (const estado of ['em_atraso', 'teste']) {
    const m = motorV3();
    m.msg(`${P}/_plano`, plano('conforto', estado, { aviso_ate: '2026-10-16T10:00:00Z' }));
    m.msg(`${P}/_modo/set`, { modo: 'fora' });
    m.avancar(30_000);
    m.msg(`${P}/janela-wc/1/get`, '1');
    assert.equal(cli(m).alarme.estado, 'disparado', estado);
    assert.equal(m.notificacoes.at(-1).prioridade, 'urgent');
  }
  const b = motorV3();
  b.msg(`${P}/_plano`, plano('base', 'teste'));
  b.limpar();
  b.msg(`${P}/_modo/set`, { modo: 'fora' });
  assert.equal(erros(b)[0].mensagem, CONFORTO);
});

test('suspenso: casa forçado, nada executa, temporizadores cancelados, estado dos aparelhos continua a ser lido', () => {
  const m = motorV3();
  m.msg(`${P}/_automacoes/set`, [
    { id: 'pir', nome: 'Corredor', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4, durante_s: 120 }] },
    { id: 'seq', nome: 'Sequência', quando: { tipo: 'manual' }, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 1 }, { acao: 'esperar', s: 60 }, { acao: 'ligar', aparelho: 'sala-4g', canal: 2 }] },
    { id: 'hora', nome: 'Hora', quando: { tipo: 'hora', hora: '11:05', dias: [1, 2, 3, 4, 5, 6, 7] }, entao: [{ acao: 'notificar', mensagem: 'Hora' }] },
  ]);
  m.msg(`${P}/_cenas/set`, [{ id: 'cinema', nome: 'Cinema', acoes: [{ acao: 'desligar', aparelho: 'sala-4g', canal: 1 }] }]);
  m.msg(`${P}/_modo/set`, { modo: 'ferias' });
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.msg(`${P}/sala-4g/4/get`, '1');
  m.msg(`${P}/_automacoes/executar`, { id: 'seq' });
  assert.equal(m.motor.reversoes.length, 1);
  assert.equal(m.motor.sequencias.length, 1);
  m.limpar();

  m.msg(`${P}/_plano`, plano('conforto', 'suspenso'));
  // Modo casa com evento por "plano"; a luz ligada pela automação é desligada já.
  const ev = m.eventos().find((e) => e.tipo === 'modo');
  assert.equal(ev.por, 'plano');
  assert.equal(cli(m).modo.modo, 'casa');
  assert.equal(cli(m).alarme.ativo, false);
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=0`]);
  assert.equal(m.motor.reversoes.length, 0);
  assert.equal(m.motor.sequencias.length, 0);
  assert.equal(m.ultimo(`${P}/_saude`).payload, '');
  m.limpar();

  // Nada corre: sensores, hora, esperar pendente, pedidos de execução.
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  m.em('2026-06-15T10:05:00Z'); // 11:05 em Lisboa
  m.avancar(120_000);
  m.msg(`${P}/_automacoes/executar`, { id: 'seq', testar: true });
  m.msg(`${P}/_cenas/executar`, { id: 'cinema' });
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.msg(`${P}/_automacoes/set`, []);
  assert.deepEqual(m.comandos(), []);
  assert.equal(m.notificacoes.length, 0);
  assert.equal(cli(m).automacoes.length, 3);
  const e = erros(m);
  assert.deepEqual(e.map((x) => x.titulo), ['Automação não executada', 'Cena não executada', 'Modo não alterado', 'Automações não guardadas']);
  for (const x of e) assert.equal(x.mensagem, SUSPENSA);
  // Os estados continuam a ser seguidos (eventos de porta no histórico, valores dos canais).
  m.msg(`${P}/sala-4g/3/get`, '1');
  m.msg(`${P}/janela-wc/1/get`, '1');
  assert.equal(m.motor.valorCanal(cli(m), 'sala-4g', 3), 1);
  assert.equal(cli(m).historico[0].titulo, 'Porta aberta');
  assert.equal(m.notificacoes.length, 0);

  // Reativação: tudo volta logo, com o estado atual.
  m.limpar();
  m.msg(`${P}/_plano`, plano('conforto', 'ativo'));
  assert.notEqual(m.ultimo(`${P}/_saude`).payload, '');
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.comandos(), [`${P}/sala-4g/4/set=1`]);
  m.msg(`${P}/_modo/set`, { modo: 'fora', forcar: true });
  assert.equal(cli(m).modo.modo, 'fora');
  assert.deepEqual(cli(m).alarme.ignorados, [{ aparelho: 'janela-wc', canal: 1 }]);
});

test('cancelado: como suspenso (modo básico), com mensagem própria', () => {
  const m = motorV3();
  m.msg(`${P}/_plano`, plano('premium', 'cancelado'));
  m.limpar();
  m.msg(`${P}/_modo/set`, { modo: 'noite' });
  assert.equal(erros(m)[0].mensagem, 'Subscrição cancelada. Reative a subscrição para voltar a usar esta funcionalidade.');
});

test('arranque: _plano retido antes da sincronização aplica-se ao estado adotado; o plano é persistido', () => {
  const armazenamento = new MemoriaEstado();
  const m = criarMotor({ armazenamento });
  m.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m.retida(`${P}/_ntfy`, NTFY);
  m.retida(`${P}/_modo`, { modo: 'fora', desde: '2026-06-15T09:00:00Z', por: 'app' });
  m.retida(`${P}/_alarme`, { ativo: true, estado: 'armado', tipo: 'total', desde: '2026-06-15T09:00:00Z', ate: null, ignorados: [], por: 'app' });
  m.retida(`${P}/_plano`, plano('base'));
  m.motor.aoLigar();
  m.motor.tick();
  assert.equal(ultimoJson(m, `${P}/_modo`).modo, 'casa');
  assert.equal(m.eventos().find((e) => e.tipo === 'modo').por, 'plano');
  assert.equal(m.ultimo(`${P}/_saude`).payload, '');
  assert.equal(m.ultimo(`${P}/_energia`).payload, '');
  assert.equal(m.publicados.filter((p) => p.topico === `${P}/_saude` && p.payload !== '').length, 0);
  // Reinício do motor: o plano vem do estado guardado (antes do _plano retido chegar).
  const m2 = criarMotor({ armazenamento });
  assert.equal(m2.motor.planoDe(m2.motor.clientes.get('joao')).plano, 'base');
  m2.retida(`${P}/_aparelhos`, APARELHOS_V3);
  m2.motor.aoLigar();
  m2.motor.tick();
  m2.limpar();
  m2.msg(`${P}/_modo/set`, { modo: 'fora' });
  assert.equal(erros(m2)[0].mensagem, CONFORTO);
});
