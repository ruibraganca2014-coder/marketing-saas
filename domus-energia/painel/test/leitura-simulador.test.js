// Ronda B: leitura da foto do quadro no simulador (POST /api/simulador/ler-quadro; API da Anthropic sempre simulada),
// o quadro corrigido pelo cliente no pedido (`quadro.leitura_cliente`), a leitura no formato do simulador
// (web/simulador/quadro.js) e as fotos da avaria (até 5: "avaria:foto", "avaria:foto_2"…).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { MODELO_LEITURA } from '../src/leitura-quadro.js';
import { LEITURAS_POR_SIMULACAO } from '../src/leitura-simulador.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { leituraDaFoto, normalizarLeitura, sugestoesDaLeitura, resumoLeitura, leituraVazia } from '../../web/simulador/quadro.js';
import { aVerificarNaVisita, blocoLeituraCliente } from '../public/ecras/simulacao.js';

const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
const LEITURA_OK = {
  e_quadro_eletrico: true,
  disjuntores_total: 6,
  disjuntores: [{ amperes: 10, quantidade: 2 }, { amperes: 16, quantidade: 3 }],
  diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 1 }],
  disjuntor_geral: { visivel: true, amperes: 32, tipo: 'disjuntor 2P' },
  modulos_livres_estimados: 2,
  marcas: ['Hager'],
  estado_aparente: 'antigo',
  fusiveis: false,
  sinais_aquecimento: false,
  notas: 'Só um diferencial.',
  confianca: 'media',
};
const respostaApi = (texto) => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODELO_LEITURA, stop_reason: 'end_turn',
  content: [{ type: 'text', text: texto }], usage: { input_tokens: 2000, output_tokens: 300 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const ler = (p, { sim = 'simulacao-teste-0001', ip, corpo = JPEG(), tipo = 'image/jpeg', cabecalhos = {}, site = true } = {}) =>
  p.pedir('POST', '/api/simulador/ler-quadro', { corpo, tipo, ip, site, cabecalhos: { 'X-Simulacao-Id': sim, ...cabecalhos } });

describe('POST /api/simulador/ler-quadro sem ANTHROPIC_API_KEY', () => {
  let p;
  let chamadas = 0;
  before(async () => { p = await painelComEquipa({ fetch: async () => { chamadas++; throw new Error('não devia chamar'); } }); });
  after(() => p.fechar());

  test('503 "leitura indisponível" e não chama nada; origem desconhecida 403; método 405', async () => {
    const r = await ler(p);
    assert.equal(r.estado, 503, r.texto);
    assert.match(r.json.erro, /indisponível/i);
    assert.equal(chamadas, 0);
    assert.equal((await ler(p, { site: false })).estado, 403);
    assert.equal((await p.pedir('GET', '/api/simulador/ler-quadro')).estado, 405);
  });
});

describe('POST /api/simulador/ler-quadro com a API simulada', () => {
  let p;
  let modo = 'ok';
  const pedidos = [];
  async function fetchFalso(url, opcoes) {
    pedidos.push({ url, corpo: JSON.parse(opcoes.body), cabecalhos: opcoes.headers });
    if (modo === 'ok') return respostaApi(JSON.stringify(LEITURA_OK));
    return new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 });
  }
  before(async () => {
    p = await painelComEquipa({ env: { ANTHROPIC_API_KEY: 'sk-ant-teste', LIMITE_LEITURA_QUADRO_DIA: '8', LIMITE_LEITURA_QUADRO_IP_DIA: '4' }, fetch: fetchFalso });
  });
  after(() => p.fechar());

  test('lê a foto e devolve a leitura validada; ao modelo só vai a imagem (sem dados do cliente)', async () => {
    const r = await ler(p, { sim: 'sim-ok-000001' });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json, { ok: true, leitura: LEITURA_OK });
    const ultimo = pedidos.at(-1);
    assert.equal(ultimo.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(ultimo.corpo.model, MODELO_LEITURA);
    const conteudo = ultimo.corpo.messages[0].content;
    assert.deepEqual(conteudo.map((c) => c.type), ['image', 'text']);
    assert.equal(conteudo[0].source.data, JPEG().toString('base64'));
    assert.doesNotMatch(JSON.stringify(ultimo.corpo), /sim-ok-000001|10\.0\./, 'nem o id da simulação nem o IP');
  });

  test('validações: tipo, bytes mágicos, vazia, id da simulação', async () => {
    assert.equal((await ler(p, { tipo: 'image/gif' })).estado, 415);
    assert.equal((await ler(p, { corpo: Buffer.from('não é imagem') })).estado, 415);
    assert.equal((await ler(p, { sim: 'curto' })).estado, 400);
    assert.equal((await ler(p, { sim: 'tem espaços e mais' })).estado, 400);
  });

  test(`limites: ${LEITURAS_POR_SIMULACAO} por simulação, por IP e no total por dia (429 com Retry-After)`, async () => {
    const antes = pedidos.length;
    for (let i = 0; i < LEITURAS_POR_SIMULACAO; i++) assert.equal((await ler(p, { sim: 'sim-limite-0001' })).estado, 200);
    const r = await ler(p, { sim: 'sim-limite-0001' });
    assert.equal(r.estado, 429);
    assert.match(r.json.erro, /3 fotos nesta simulação/);
    assert.ok(Number(r.cabecalhos['retry-after']) > 0);
    assert.equal(pedidos.length - antes, LEITURAS_POR_SIMULACAO, 'a 4.ª não chega ao modelo');
    // Por IP (4 por dia aqui): outra simulação do mesmo IP também conta.
    for (let i = 0; i < 4; i++) assert.equal((await ler(p, { sim: `sim-ip-${i}-00000`, ip: '10.9.9.9' })).estado, 200);
    assert.equal((await ler(p, { sim: 'sim-ip-9-00000', ip: '10.9.9.9' })).estado, 429);
    // No total (8 por dia aqui; já foram 1 + 3 + 4 = 8).
    const g = await ler(p, { sim: 'sim-global-00001', ip: '10.8.8.8' });
    assert.equal(g.estado, 429);
    assert.match(g.json.erro, /hoje/);
    // Passado um dia, volta a haver leituras.
    p.relogio.avancar(24 * 3600_000 + 1000);
    try {
      assert.equal((await ler(p, { sim: 'sim-limite-0001' })).estado, 200);
    } finally {
      p.relogio.avancar(-(24 * 3600_000 + 1000));
    }
  });
});

describe('leitura que falha', () => {
  let p;
  before(async () => {
    p = await painelComEquipa({ env: { ANTHROPIC_API_KEY: 'sk-ant-teste' }, fetch: async () => new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 }) });
  });
  after(() => p.fechar());
  test('a API responde mal → 502 e o simulador passa a desenhar à mão', async () => {
    const r = await ler(p);
    assert.equal(r.estado, 502);
    assert.match(r.json.erro, /à mão/);
  });
});

test('simulador: a leitura do servidor passa a um componente por unidade; sugestões; normalização', () => {
  const l = leituraDaFoto(LEITURA_OK);
  assert.equal(l.origem, 'foto');
  assert.deepEqual(l.disjuntor_geral, { amperes: 32 });
  assert.deepEqual(l.diferenciais, [{ sensibilidade_ma: 30, amperes: 40 }]);
  assert.deepEqual(l.disjuntores.map((d) => d.amperes), [10, 10, 16, 16, 16, null], 'o 6.º contado sem calibre legível');
  assert.equal(l.modulos_livres, 2);
  assert.equal(resumoLeitura(l), 'Geral 32 A · 1 diferencial · 6 disjuntores · 2 livres');
  const s = sugestoesDaLeitura(l);
  assert.equal(s.melhorar, true, 'quadro antigo');
  assert.equal(s.quadroNovo, false);
  assert.equal(s.protecaoExistente, 'basica', '30 mA: básica já existe');
  assert.equal(s.poucoEspaco, true);
  assert.ok(s.notas.some((t) => /Básica já existe/.test(t)));
  const fus = sugestoesDaLeitura({ ...l, fusiveis: true, diferenciais: [] });
  assert.deepEqual([fus.melhorar, fus.quadroNovo, fus.protecaoExistente], [true, true, null]);
  assert.equal(sugestoesDaLeitura(leituraDaFoto({ ...LEITURA_OK, e_quadro_eletrico: false })), null, 'não é um quadro');
  assert.equal(sugestoesDaLeitura(leituraVazia()), null, 'manual vazio: nada a sugerir');
  assert.equal(normalizarLeitura(null), null);
  const n = normalizarLeitura({ origem: 'x', disjuntores: [{ amperes: -3 }, { amperes: 16 }], modulos_livres: 9999, estado: 'velho', notas: 'a\nb' });
  assert.deepEqual([n.origem, n.disjuntores, n.modulos_livres, n.estado, n.notas], ['manual', [{ amperes: null }, { amperes: 16 }], 200, null, 'a b']);
});

test('painel: valida quadro.leitura_cliente e mostra-a na ficha', () => {
  const l = normalizarLeitura({ ...leituraDaFoto(LEITURA_OK), corrigida: true });
  const sim = { versao: 1, quadro: { leitura_cliente: l } };
  assert.doesNotThrow(() => validarSimulacao(sim));
  assert.doesNotThrow(() => validarSimulacao({ versao: 1, quadro: { leitura_cliente: null } }));
  assert.doesNotThrow(() => validarSimulacao({ versao: 1, quadro: { leitura_cliente: leituraVazia() } }));
  const mau = (x) => assert.throws(() => validarSimulacao({ versao: 1, quadro: { leitura_cliente: { ...l, ...x } } }), /Quadro \(leitura\)/, JSON.stringify(x));
  mau({ origem: 'servidor' });
  mau({ extra: 1 });
  mau({ disjuntor_geral: { amperes: 0 } });
  mau({ disjuntor_geral: { amperes: 32, tipo: 'x' } });
  mau({ disjuntores: Array(81).fill({ amperes: 16 }) });
  mau({ disjuntores: [{ amperes: 16, marca: 'x' }] });
  mau({ diferenciais: [{ sensibilidade_ma: 5000, amperes: 40 }] });
  mau({ modulos_livres: 1.5 });
  mau({ estado: 'otimo' });
  mau({ fusiveis: 'sim' });
  mau({ notas: 'x'.repeat(301) });
  mau({ notas: 'a\u0000b' });
  // (O bloco com a leitura desenha-se no navegador; verificado no Playwright.)
  assert.equal(blocoLeituraCliente({ versao: 1, quadro: {} }), null, 'pedidos antigos: sem bloco');
});

test('avaria: as fotos "avaria:foto_2"… contam como foto (pedido antigo só com "avaria:foto" também)', () => {
  const base = { versao: 1, funil: 'avaria', avaria: { onde: ['sala'], problema: ['luz'], descricao: '' } };
  const v = (fotos) => aVerificarNaVisita({ ...base, fotos }).find((x) => x.tema === 'Avaria').texto;
  assert.match(v([{ chave: 'avaria:foto_2' }]), /ver foto/);
  assert.match(v([{ chave: 'avaria:foto' }]), /ver foto/);
  assert.match(v([]), /sem foto/);
  assert.doesNotThrow(() => validarSimulacao({ ...base, fotos: ['avaria:foto', 'avaria:foto_2', 'avaria:foto_3', 'avaria:foto_4', 'avaria:foto_5'].map((chave) => ({ chave, tipo: 'avaria', legenda: 'Avaria' })) }));
});

describe('avaria: até 5 fotos no pedido (POST /api/orcamento/fotos)', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { LIMITE_FOTOS_HORA: '1000' } }); });
  after(() => p.fechar());
  test('as 5 chaves da avaria são aceites e aparecem na galeria; faiscas/choque aceites', async () => {
    const chaves = ['avaria:foto', 'avaria:foto_2', 'avaria:foto_3', 'avaria:foto_4', 'avaria:foto_5'];
    const simulacao = { versao: 1, funil: 'avaria', avaria: { onde: ['sala', 'cozinha'], problema: ['faiscas', 'choque'], descricao: '' }, fotos: chaves.map((chave) => ({ chave, tipo: 'avaria', legenda: 'Avaria' })) };
    const { cookie } = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Ana Avaria', telefone: '912 345 678', servico: 'Reparação', localidade: 'Oeiras', simulacao }, cookie });
    assert.equal(r.estado, 201, r.texto);
    for (const chave of chaves) {
      const f = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': r.json.fotos_token, 'X-Foto-Chave': chave } });
      assert.equal(f.estado, 201, `${chave}: ${f.texto}`);
    }
    const o = (await p.pedir('GET', `/painel/api/orcamentos/${r.json.pedido}`, { cookie: p.cookies.ceo })).json;
    assert.deepEqual(o.fotos.map((f) => f.chave).sort(), [...chaves].sort());
    assert.deepEqual(o.simulacao.avaria.problema, ['faiscas', 'choque']);
  });
});
