import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_PADRAO, fundirConfig, normalizarConfig } from '../src/casa.js';
import { criarMotor, motorComAparelhos, APARELHOS, ultimoJson } from './ajuda.js';

const P = 'domus/joao';

test('_config: valores por omissão publicados (retidos) no arranque', () => {
  const m = motorComAparelhos();
  const pub = m.motor.clientes.get('joao').config;
  assert.deepEqual(pub, { ...CONFIG_PADRAO });
  const m2 = criarMotor();
  m2.retida(`${P}/_aparelhos`, APARELHOS);
  m2.motor.aoLigar();
  m2.motor.tick();
  const p = m2.ultimo(`${P}/_config`);
  assert.equal(p.retain, true);
  assert.deepEqual(JSON.parse(p.payload), {
    atraso_saida_s: 30, atraso_entrada_s: 30, silencio: ['23:00', '07:00'], limiar_espera_w: 5,
    offline_min: 30, pausa_manual_min: 60, local: { lat: 38.72, lon: -9.14 }, relatorio_diario: '08:00',
    personalizar: {},
  });
});

test('_config/set: funde o objeto parcial, persiste e republica', () => {
  const m = motorComAparelhos();
  m.msg(`${P}/_config/set`, { atraso_saida_s: 60, silencio: null, local: { lat: 41.15, lon: -8.61 } });
  const c = ultimoJson(m, `${P}/_config`);
  assert.equal(c.atraso_saida_s, 60);
  assert.equal(c.atraso_entrada_s, 30);
  assert.equal(c.silencio, null);
  assert.deepEqual(c.local, { lat: 41.15, lon: -8.61 });
  assert.equal(m.ultimo(`${P}/_config`).retain, true);
  assert.equal(m.armazenamento.dados.clientes.joao.config.atraso_saida_s, 60);
  // Reinício: o estado local prevalece sobre um _config retido antigo.
  const m2 = criarMotor({ armazenamento: m.armazenamento });
  m2.retida(`${P}/_config`, { atraso_saida_s: 5 });
  m2.retida(`${P}/_aparelhos`, APARELHOS);
  m2.motor.aoLigar();
  m2.motor.tick();
  assert.equal(ultimoJson(m2, `${P}/_config`).atraso_saida_s, 60);
});

test('_config/set inválido: evento erro e nada muda (campos desconhecidos incluídos)', () => {
  const m = motorComAparelhos();
  const casos = [
    [{ atraso_saida_s: 301 }, /atraso_saida_s.*0 e 300/],
    [{ atraso_entrada_s: -1 }, /atraso_entrada_s/],
    [{ pausa_manual_min: 481 }, /pausa_manual_min.*0 e 480/],
    [{ silencio: ['23:00'] }, /silencio/],
    [{ silencio: ['23:00', '23:00'] }, /As horas de silêncio não podem ser iguais\./],
    [{ relatorio_diario: '8h' }, /relatorio_diario/],
    [{ local: { lat: 99, lon: 0 } }, /lat/],
    [{ local: { lat: 38, lon: -9, alt: 3 } }, /campo desconhecido "alt"/],
    [{ limiar_espera_w: 'x' }, /limiar_espera_w/],
    [{ offline_min: 0 }, /offline_min/],
    [{ cor: 'azul' }, /campo desconhecido "cor"/],
    [[1], /objeto JSON/],
  ];
  for (const [pedido, re] of casos) {
    m.limpar();
    m.msg(`${P}/_config/set`, pedido);
    const [ev] = m.eventos();
    assert.equal(ev?.tipo, 'erro', JSON.stringify(pedido));
    assert.match(ev.mensagem, re);
    assert.deepEqual(ultimoJson(m, `${P}/_config`), { ...CONFIG_PADRAO });
  }
  // Comando retido é ignorado.
  m.limpar();
  m.retida(`${P}/_config/set`, { atraso_saida_s: 1 });
  assert.equal(m.publicados.length, 0);
});

test('fundirConfig/normalizarConfig', () => {
  const r = fundirConfig({ offline_min: 10 }, { ...CONFIG_PADRAO });
  assert.equal(r.ok, true);
  assert.equal(r.config.offline_min, 10);
  assert.equal(fundirConfig('x', { ...CONFIG_PADRAO }).ok, false);
  // Uma configuração guardada com lixo fica com os valores por omissão nesses campos.
  const n = normalizarConfig({ atraso_saida_s: 999, offline_min: 5, estranho: 1 });
  assert.equal(n.atraso_saida_s, 30);
  assert.equal(n.offline_min, 5);
  assert.equal('estranho' in n, false);
});

test('personalizar: o cliente muda nome, divisão e esconde; o resto é recusado', () => {
  const bom = { 'tomada-3': { divisao: 'Cozinha', canais: { 1: { nome: 'Cafeteira', escondido: true } } } };
  const r = fundirConfig({ personalizar: bom }, { ...CONFIG_PADRAO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.personalizar, bom);
  assert.deepEqual(normalizarConfig(null).personalizar, {});
  for (const mau of [
    null, [], { 'Tomada!': {} }, { t: { cor: 'x' } }, { t: { divisao: '' } }, { t: { divisao: 'x'.repeat(41) } },
    { t: { canais: { 0: {} } } }, { t: { canais: { 65: {} } } }, { t: { canais: { 1: { nome: ' a' } } } },
    { t: { canais: { 1: { escondido: false } } } }, { t: { canais: { 1: { cor: 1 } } } },
  ]) assert.equal(fundirConfig({ personalizar: mau }, { ...CONFIG_PADRAO }).ok, false, JSON.stringify(mau));
  // Uma guardada inválida volta a {} (nunca falha).
  assert.deepEqual(normalizarConfig({ personalizar: { t: { cor: 1 } } }).personalizar, {});
});
