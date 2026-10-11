// "Aproveitar a foto da casa; pedir se não houver" (decisão do dono, 2026-10-11): um pedido novo de uma casa da conta
// leva a foto do quadro mais recente dos outros pedidos da MESMA conta e da MESMA casa (cópia: linha e ficheiro novos);
// GET /api/conta/eu diz ao simulador se a casa aberta já a tem (`foto_quadro`); com a validação do CEO ligada, o segundo
// pedido já se valida. E a regra do passo Enviar do simulador (web/simulador/estado.js fotoQuadroNoEnviar).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { MODELO_LEITURA } from '../src/leitura-quadro.js';
import { fotoQuadroNoEnviar } from '../../web/simulador/estado.js';

const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const SIM = { versao: 1, casa: { tipo: 'moradia', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1 }] };

/** Ajudas sobre um painel de teste `p()`. */
function ajudas(p) {
  const conta = (metodo, caminho, opcoes = {}) => p().pedir(metodo, `/api/conta/${caminho}`, opcoes);
  /** Pedido do simulador com a conta `c`; devolve {id, token}. */
  async function pedir(c, simulacao = SIM) {
    const r = await p().pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1', simulacao } });
    assert.equal(r.estado, 201, r.texto);
    return { id: r.json.pedido, token: r.json.fotos_token };
  }
  /** A foto do quadro enviada pelo navegador a seguir ao pedido (com o token). */
  async function enviarQuadro(token, corpo = JPEG(), legenda = 'Quadro elétrico') {
    const r = await p().pedir('POST', '/api/orcamento/fotos', { corpo, tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': token, 'X-Foto-Chave': 'quadro', 'X-Foto-Legenda': encodeURIComponent(legenda) } });
    assert.equal(r.estado, 201, r.texto);
    return r.json.id;
  }
  const fotos = (id) => p().app.db.prepare('SELECT * FROM fotos WHERE orcamento_id = ? ORDER BY criado, id').all(id);
  const ficheiro = (f) => join(p().config.fotosDir, String(f.orcamento_id), `${f.id}.jpg`);
  const temFoto = async (c) => (await conta('GET', 'eu', { cookie: c.cookie })).json.foto_quadro;
  return { conta, pedir, enviarQuadro, fotos, ficheiro, temFoto };
}

describe('a foto do quadro da casa aproveita-se no pedido seguinte', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { LIMITE_FOTOS_HORA: '1000' } }); });
  after(() => p.fechar());
  const { conta, pedir, enviarQuadro, fotos, ficheiro, temFoto } = ajudas(() => p);

  test('o segundo pedido da mesma casa leva a foto do primeiro (linha e ficheiro novos, iguais); o primeiro mantém a sua; sem foto anterior nada se copia', async () => {
    const a = await p.contaConfirmada();
    assert.equal(await temFoto(a), false, 'conta sem pedidos');
    const um = await pedir(a);
    assert.deepEqual(fotos(um.id), [], 'sem foto anterior: nada copiado');
    assert.equal(await temFoto(a), false, 'pedido sem foto do quadro');
    const semFoto = await pedir(a);
    assert.deepEqual(fotos(semFoto.id), [], 'o primeiro pedido não tinha foto: nada copiado');
    const original = JPEG(3000, 5);
    await enviarQuadro(um.token, original, 'Quadro da entrada');
    assert.equal(await temFoto(a), true);
    const [f1] = fotos(um.id);

    const dois = await pedir(a);
    const copiadas = fotos(dois.id);
    assert.equal(copiadas.length, 1);
    const [f2] = copiadas;
    assert.notEqual(f2.id, f1.id, 'id novo');
    assert.match(f2.id, /^[a-f0-9]{24}$/);
    assert.deepEqual([f2.chave, f2.tipo_mime, f2.bytes, f2.legenda], ['quadro', 'image/jpeg', f1.bytes, 'Quadro da entrada']);
    assert.ok(f2.criado >= f1.criado);
    assert.ok((await readFile(ficheiro(f2))).equals(original), 'ficheiro novo igual ao original');
    assert.deepEqual(fotos(um.id), [f1], 'o primeiro pedido mantém a sua');
    assert.ok((await readFile(ficheiro(f1))).equals(original));
    // No painel e na conta é uma foto normal do pedido novo.
    const o = (await p.pedir('GET', `/painel/api/orcamentos/${dois.id}`, { cookie: p.cookies.ceo })).json;
    assert.deepEqual(o.fotos.map((f) => [f.id, f.chave]), [[f2.id, 'quadro']]);
    assert.equal((await p.pedir('GET', o.fotos[0].url, { cookie: p.cookies.ceo })).bruto.length, original.length);
    const meu = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos.find((x) => x.id === dois.id);
    assert.deepEqual(meu.fotos.map((f) => f.id), [f2.id]);
  });

  test('o pedido de OUTRA casa da mesma conta não a leva; o de outra conta também não; o campo foto_quadro segue a casa aberta', async () => {
    const a = await p.contaConfirmada();
    const b = await p.contaConfirmada();
    const um = await pedir(a);
    await enviarQuadro(um.token);
    assert.deepEqual([await temFoto(a), await temFoto(b)], [true, false]);
    const deB = await pedir(b);
    assert.deepEqual(fotos(deB.id), [], 'outra conta');
    const casas = await conta('POST', 'casas', { cookie: a.cookie, corpo: { nome: 'Casa de férias' } });
    assert.equal(casas.estado, 201, casas.texto);
    const [segunda, primeira] = casas.json.casas.map((k) => k.id);
    assert.equal(await temFoto(a), false, 'a casa nova (aberta) não tem foto');
    const naSegunda = await pedir(a);
    assert.deepEqual(fotos(naSegunda.id), [], 'outra casa da mesma conta');
    // Com foto na segunda casa, cada casa fica com a sua.
    await enviarQuadro(naSegunda.token, JPEG(1500, 9));
    assert.equal(await temFoto(a), true);
    const outroNaSegunda = await pedir(a);
    assert.equal(fotos(outroNaSegunda.id)[0].bytes, fotos(naSegunda.id)[0].bytes);
    assert.equal((await conta('POST', `casas/${primeira}/abrir`, { cookie: a.cookie, corpo: {} })).estado, 200);
    assert.equal(await temFoto(a), true);
    const naPrimeira = await pedir(a);
    assert.equal(fotos(naPrimeira.id)[0].bytes, fotos(um.id)[0].bytes, 'a da primeira casa');
    assert.notEqual(fotos(naPrimeira.id)[0].bytes, fotos(naSegunda.id)[0].bytes);
    assert.ok(segunda);
  });

  test('uma foto do quadro nova enviada para o segundo pedido substitui a copiada (fica uma só); o pedido seguinte leva a mais recente', async () => {
    const a = await p.contaConfirmada();
    const um = await pedir(a);
    await enviarQuadro(um.token, JPEG(2000, 1));
    const dois = await pedir(a);
    const [copiada] = fotos(dois.id);
    assert.ok(existsSync(ficheiro(copiada)));
    p.relogio.avancar(1000);
    const nova = JPEG(4000, 3);
    const idNova = await enviarQuadro(dois.token, nova);
    const depois = fotos(dois.id);
    assert.deepEqual(depois.map((f) => [f.id, f.bytes]), [[idNova, nova.length]], 'fica só a nova');
    assert.equal(existsSync(ficheiro(copiada)), false, 'o ficheiro da copiada saiu');
    assert.equal(fotos(um.id).length, 1, 'a do primeiro pedido não se toca');
    p.relogio.avancar(1000);
    const tres = await pedir(a);
    assert.ok((await readFile(ficheiro(fotos(tres.id)[0]))).equals(nova), 'a mais recente da casa');
  });

  test('se a cópia falhar (ficheiro em falta), o pedido nasce na mesma, sem foto; a avaria não leva a foto do quadro', async () => {
    const a = await p.contaConfirmada();
    const um = await pedir(a);
    await enviarQuadro(um.token);
    const avaria = await pedir(a, { versao: 1, funil: 'avaria', avaria: { onde: ['sala'], problema: ['luz'], descricao: '' } });
    assert.deepEqual(fotos(avaria.id), [], 'avaria: sem o ponto da foto do quadro, não leva');
    await unlink(ficheiro(fotos(um.id)[0]));
    const dois = await pedir(a);
    assert.deepEqual(fotos(dois.id), [], 'sem linha em `fotos`');
    assert.equal(existsSync(join(p.config.fotosDir, String(dois.id))), false, 'sem ficheiros a meio');
  });

  test('apagar a conta: a foto copiada sai com o pedido, como as outras', async () => {
    const a = await p.contaConfirmada();
    const um = await pedir(a);
    await enviarQuadro(um.token);
    const dois = await pedir(a);
    const [f2] = fotos(dois.id);
    const r = await conta('POST', 'apagar', { cookie: a.cookie, corpo: { password: 'senha-de-teste-1' } });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([fotos(um.id), fotos(dois.id)], [[], []]);
    assert.equal(existsSync(ficheiro(f2)), false);
  });
});

describe('a foto aproveitada e a validação do CEO', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { VALIDACAO_CEO: '1', LIMITE_FOTOS_HORA: '1000' } }); });
  after(() => p.fechar());
  const { pedir, enviarQuadro } = ajudas(() => p);
  const painel = (metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies.ceo, corpo });

  test('o segundo pedido da casa (com a foto aproveitada) já se valida; sem foto na casa continua em falta', async () => {
    const todos = { planta: true, foto_quadro: true, area: true, contacto: true };
    const a = await p.contaConfirmada();
    const um = await pedir(a);
    assert.equal((await painel('POST', `orcamentos/${um.id}/validar`, { pontos: todos })).estado, 409, 'sem foto do quadro não se valida');
    await enviarQuadro(um.token);
    const dois = await pedir(a);
    const pontos = (await painel('GET', `orcamentos/${dois.id}`)).json.validacao.pontos;
    assert.deepEqual(pontos.find((x) => x.chave === 'foto_quadro'), { chave: 'foto_quadro', texto: 'A foto do quadro elétrico lê-se.' });
    const v = await painel('POST', `orcamentos/${dois.id}/validar`, { pontos: todos });
    assert.equal(v.estado, 200, v.texto);
    assert.equal(v.json.validacao.estado, 'validado');
  });
});

describe('a foto aproveitada e a leitura automática (API simulada)', () => {
  let p;
  let chamadas = 0;
  const LEITURA = {
    e_quadro_eletrico: true, disjuntores_total: 6, disjuntores: [{ amperes: 16, quantidade: 6 }], diferenciais: [{ sensibilidade_ma: 30, amperes: 40, quantidade: 1 }],
    disjuntor_geral: { visivel: true, amperes: 32, tipo: 'disjuntor 2P' }, modulos_livres_estimados: 3, marcas: ['Hager'], estado_aparente: 'razoavel',
    fusiveis: false, sinais_aquecimento: false, notas: 'Um só diferencial.', confianca: 'media',
  };
  before(async () => {
    p = await painelComEquipa({
      env: { ANTHROPIC_API_KEY: 'sk-ant-teste', LEITURA_QUADRO: '1', LIMITE_FOTOS_HORA: '1000' },
      fetch: async () => {
        chamadas++;
        return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: MODELO_LEITURA, stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(LEITURA) }], usage: { input_tokens: 2100, output_tokens: 350 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
  });
  after(() => p.fechar());
  const { pedir, enviarQuadro, fotos } = ajudas(() => p);
  const leitura = async (id) => (await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.ceo })).json.leitura_quadro;

  test('a foto copiada não é lida outra vez: a leitura feita no pedido de origem vai com ela', async () => {
    const a = await p.contaConfirmada();
    const um = await pedir(a);
    await enviarQuadro(um.token);
    await p.app.api.fotos.leiturasEmCurso();
    assert.equal(chamadas, 1);
    const l1 = await leitura(um.id);
    assert.equal(l1.estado, 'feita');
    const dois = await pedir(a);
    await p.app.api.fotos.leiturasEmCurso();
    assert.equal(chamadas, 1, 'a cópia não chama o modelo');
    const l2 = await leitura(dois.id);
    assert.deepEqual([l2.estado, l2.foto_id, l2.copiada_de], ['feita', fotos(dois.id)[0].id, um.id]);
    assert.deepEqual(l2.leitura, l1.leitura);
    assert.equal((await leitura(um.id)).foto_id, fotos(um.id)[0].id, 'a do pedido de origem fica como estava');
  });
});

test('simulador, passo Enviar de "Pedir um serviço": a foto do quadro pede-se só se não houver (nem neste navegador, nem na casa)', () => {
  for (const caminho of ['automatizar', 'reparar', 'quadro', 'obras']) {
    const e = { funil: 'planta', caminho };
    assert.equal(fotoQuadroNoEnviar(e, false, false), 'pedir', caminho);
    assert.equal(fotoQuadroNoEnviar(e, false, undefined), 'pedir', 'sem sessão (não se sabe da casa): pede-se');
    assert.equal(fotoQuadroNoEnviar(e, false, true), 'aproveitar', caminho);
    assert.equal(fotoQuadroNoEnviar(e, true, false), 'tem', caminho);
    assert.equal(fotoQuadroNoEnviar(e, true, true), 'tem', 'a deste navegador vai com o pedido e substitui a da casa');
  }
  for (const funil of ['primeira', 'avaria', undefined]) assert.equal(fotoQuadroNoEnviar({ funil }, false, false), null, `funil ${funil}: nada a mostrar`);
});
