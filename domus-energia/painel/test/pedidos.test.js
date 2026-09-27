// Fila pedidos-admin (docs/PAINEL-EMPRESA.md §2): JSON exato escrito pelo
// painel, execução pelo servidor/domus.sh processar-pedidos (modo simulação,
// DOMUS_DRY_RUN=1), resultado mostrado uma só vez, e o sentido inverso
// (./domus.sh painel-utilizador → o painel cria o utilizador).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarPainel, domus, esperar } from './ajuda.js';

let base;
let ENV;
let p;
let cookies;
let u;
const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z';

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'domus-painel-ped-'));
  ENV = { DOMUS_DRY_RUN: '1', DOMUS_DADOS: join(base, 'dados'), DOMUS_MOSQ_DIR: join(base, 'mosq'), DOMUS_HOST: 'teste.local', DOMUS_ENV: '/dev/null', DOMUS_ESPERA_PAINEL: '10' };
  for (const args of [['admin', 'admin-senha-1'], ['cliente', 'joao', 'joao-senha-1'], ['aparelho', 'joao', 'sala', 'openbeken', 'Sala', 'sala-senha-1']]) {
    const r = await domus(ENV, args);
    assert.equal(r.codigo, 0, r.stderr);
  }
  p = await iniciarPainel({ dados: join(base, 'dados') });
  u = {
    ceo: await p.criarUtilizador('ceo'),
    tecnico: await p.criarUtilizador('tecnico'),
    comercial: await p.criarUtilizador('comercial'),
  };
  cookies = { ceo: await p.entrar(u.ceo.email), tecnico: await p.entrar(u.tecnico.email), comercial: await p.entrar(u.comercial.email) };
});
after(async () => {
  await p.fechar();
  await rm(base, { recursive: true, force: true });
});

const fila = join('dados', 'pedidos-admin');
const lerPedido = async (id) => readFile(join(base, fila, `${id}.json`), 'utf8');
const api = (metodo, c, papel, corpo) => p.pedir(metodo, `/painel/api/${c}`, { cookie: cookies[papel], corpo });
const processar = async () => {
  const r = await domus(ENV, ['processar-pedidos']);
  assert.equal(r.codigo, 0, r.stderr);
  return r;
};

test('POST clientes → pedido "cliente" com o JSON exato, modo 600', async () => {
  const r = await api('POST', 'clientes', 'comercial', { codigo: 'rui', nome: 'Rui Costa', contacto: '912345678', localidade: 'Sintra' });
  assert.equal(r.estado, 202, r.texto);
  assert.equal(r.json.pedido.estado, 'pendente');
  const id = r.json.pedido.id;
  assert.match(id, /^p-\d{14}-[0-9a-f]{8}$/);
  const txt = await lerPedido(id);
  assert.match(txt, new RegExp(`^\\{"id":"${id}","tipo":"cliente","dados":\\{"codigo":"rui"\\},"por":"comercial@domus\\.teste","criado":"${ISO}"\\}\\n$`));
  assert.equal((await stat(join(base, fila, `${id}.json`))).mode & 0o777, 0o600);
  assert.ok(!txt.includes('Rui Costa'), 'nome e contacto ficam só na base de dados do painel');
  assert.equal((await api('POST', 'clientes', 'ceo', { codigo: 'rui', nome: 'Outro' })).estado, 409, 'pedido em curso');
  assert.equal((await api('POST', 'clientes', 'ceo', { codigo: 'joao', nome: 'João' })).estado, 409, 'já existe');
  for (const codigo of ['Rui', '-rui', 'rui-', 'a'.repeat(33), 'painel', 'admin', 'pagamentos', 'motor', '../x', 'r u', '']) {
    assert.equal((await api('POST', 'clientes', 'ceo', { codigo, nome: 'X' })).estado, 400, codigo);
  }
});

test('POST clientes/:c/aparelhos → pedido "aparelho" com o JSON exato (todas as chaves, por ordem)', async () => {
  const r = await api('POST', 'clientes/joao/aparelhos', 'tecnico', {
    id: 'cozinha', tipo: 'shelly', nome: 'Luz da cozinha', canais: '1:interruptor:Teto:arranque=ultimo', divisao: 'Cozinha', medidor: true,
  });
  assert.equal(r.estado, 202, r.texto);
  const id = r.json.pedido.id;
  assert.match(await lerPedido(id), new RegExp(`^\\{"id":"${id}","tipo":"aparelho","dados":\\{"cliente":"joao","id":"cozinha","tipo":"shelly","nome":"Luz da cozinha","canais":"1:interruptor:Teto:arranque=ultimo","divisao":"Cozinha","medidor":true,"geral":false,"bateria":false,"substituir":false\\},"por":"tecnico@domus\\.teste","criado":"${ISO}"\\}\\n$`));
  const r2 = await api('POST', 'clientes/joao/aparelhos', 'ceo', { id: 'minimo', tipo: 'openbeken', nome: 'Mínimo' });
  assert.match(await lerPedido(r2.json.pedido.id), /"dados":\{"cliente":"joao","id":"minimo","tipo":"openbeken","nome":"Mínimo","canais":"","divisao":"","medidor":false,"geral":false,"bateria":false,"substituir":false\}/);
  // Valores perigosos são recusados logo no painel (e de novo no domus.sh).
  for (const corpo of [
    { id: 'x1', tipo: 'shelly', nome: 'Com "aspas"' },
    { id: 'x2', tipo: 'shelly', nome: 'barra\\invertida' },
    { id: 'x3', tipo: 'shelly', nome: '--medidor' },
    { id: 'x4', tipo: 'shelly', nome: 'Linha\nnova' },
    { id: 'x5', tipo: 'shelly', nome: 'Ok', canais: '--bateria' },
    { id: 'x6', tipo: 'shelly', nome: 'Ok', canais: '1:interruptor;rm -rf /' },
    { id: 'x7', tipo: 'shelly', nome: 'Ok', divisao: '-x' },
    { id: 'x8', tipo: 'tasmota', nome: 'Ok' },
    { id: 'X9', tipo: 'shelly', nome: 'Ok' },
    { id: 'x10', tipo: 'shelly', nome: 'Ok', geral: true },
    { id: 'x11', tipo: 'shelly', nome: 'Ok', medidor: 'sim' },
    { id: 'x12', tipo: 'shelly', nome: 'Ok', extra: 1 },
    { id: 'sala', tipo: 'shelly', nome: 'Já existe' },
  ]) {
    const x = await api('POST', 'clientes/joao/aparelhos', 'ceo', corpo);
    assert.ok([400, 409].includes(x.estado), `${JSON.stringify(corpo)} → ${x.estado}`);
  }
  assert.equal((await api('POST', 'clientes/ninguem/aparelhos', 'ceo', { id: 'a', tipo: 'shelly', nome: 'A' })).estado, 404);
});

test('remover-aparelho e plano → JSON exato', async () => {
  let r = await api('POST', 'clientes/joao/aparelhos/sala/remover', 'tecnico', {});
  assert.equal(r.estado, 202);
  assert.match(await lerPedido(r.json.pedido.id), new RegExp(`^\\{"id":"${r.json.pedido.id}","tipo":"remover-aparelho","dados":\\{"cliente":"joao","id":"sala"\\},"por":"tecnico@domus\\.teste","criado":"${ISO}"\\}\\n$`));
  assert.equal((await api('POST', 'clientes/joao/aparelhos/naoexiste/remover', 'tecnico', {})).estado, 404);
  r = await api('POST', 'clientes/joao/plano', 'ceo', { plano: 'premium', estado: 'teste' });
  assert.equal(r.estado, 202);
  assert.match(await lerPedido(r.json.pedido.id), new RegExp(`^\\{"id":"${r.json.pedido.id}","tipo":"plano","dados":\\{"cliente":"joao","plano":"premium","estado":"teste"\\},"por":"ceo@domus\\.teste","criado":"${ISO}"\\}\\n$`));
  assert.equal((await api('POST', 'clientes/joao/plano', 'ceo', { plano: 'ouro' })).estado, 400);
  assert.equal((await api('POST', 'clientes/joao/plano', 'ceo', { plano: 'base', estado: 'pausado' })).estado, 400);
});

test('processar-pedidos executa tudo; resultado (com a palavra-passe) mostrado UMA vez a quem pediu', async () => {
  const pedidos = (await api('GET', 'pedidos', 'ceo')).json.pedidos;
  assert.ok(pedidos.length >= 5 && pedidos.every((x) => x.estado === 'pendente'));
  const r = await processar();
  assert.match(r.stdout, /pedido p-\d{14}-[0-9a-f]{8} de comercial@domus\.teste: ok/);
  const ficheiros = await readdir(join(base, fila));
  const resultados = ficheiros.filter((f) => f.endsWith('.resultado.json'));
  assert.equal(resultados.length, pedidos.length);
  for (const f of resultados) assert.equal((await stat(join(base, fila, f))).mode & 0o777, 0o600, f);
  const feitos = await readdir(join(base, fila, 'feitos'));
  for (const x of pedidos) assert.ok(feitos.includes(`${x.id}.json`), 'movido para feitos/');
  assert.ok(!ficheiros.some((f) => /^p-.*\d\.json$/.test(f)), 'a fila ficou vazia');

  // O painel vê os estados sem apagar os resultados.
  await p.app.pedidos.verificar();
  const depois = (await api('GET', 'pedidos', 'ceo')).json.pedidos;
  const cli = depois.find((x) => x.tipo === 'cliente' && x.cliente === 'rui');
  assert.equal(cli.estado, 'concluido');
  assert.equal(cli.resultado_disponivel, true);

  // Outro utilizador (não CEO) não o vê; quem pediu vê-o uma vez.
  assert.equal((await api('GET', `pedidos/${cli.id}`, 'tecnico')).estado, 403);
  const r1 = await api('GET', `pedidos/${cli.id}`, 'comercial');
  assert.equal(r1.estado, 200);
  assert.equal(r1.json.resultado.ok, true);
  assert.equal(r1.json.resultado.cliente, 'rui');
  assert.match(r1.json.resultado.password, /^[A-Za-z0-9]{20}$/);
  assert.match(r1.json.resultado.saida, new RegExp(`Palavra-passe \\.\\. ${r1.json.resultado.password}`));
  assert.equal(r1.json.pedido.estado, 'concluido');
  assert.equal(r1.cabecalhos['cache-control'], 'no-store');
  await assert.rejects(stat(join(base, fila, `${cli.id}.resultado.json`)), { code: 'ENOENT' }, 'apagado depois de mostrado');
  const r2 = await api('GET', `pedidos/${cli.id}`, 'comercial');
  assert.equal(r2.json.resultado, null, 'segunda vez: sem palavra-passe');
  assert.equal(r2.json.pedido.resultado_disponivel, false);
  assert.ok(r2.json.pedido.mostrado);
  assert.equal((await api('GET', `pedidos/${cli.id}`, 'ceo')).json.resultado, null);
  // O cliente foi criado de facto (estado do domus.sh) e aparece na lista, já não pendente.
  const rui = (await api('GET', 'clientes/rui', 'ceo')).json;
  assert.equal(rui.pendente, false);
  assert.equal(rui.nome, 'Rui Costa');

  // Aparelho: palavra-passe + instruções, para o técnico que pediu.
  const ap = depois.find((x) => x.tipo === 'aparelho' && x.dados.id === 'cozinha');
  const ra = (await api('GET', `pedidos/${ap.id}`, 'tecnico')).json;
  assert.equal(ra.resultado.ok, true);
  assert.equal(ra.resultado.aparelho, 'cozinha');
  assert.match(ra.resultado.saida, /MQTT prefix \.+ domus\/joao\/cozinha/);
  assert.ok(ra.resultado.saida.includes(ra.resultado.password));
  // Os outros tiveram efeito no estado do servidor.
  const joao = (await api('GET', 'clientes/joao', 'ceo')).json;
  assert.deepEqual(joao.aparelhos.map((a) => a.id).sort(), ['cozinha', 'minimo'], 'sala removida, cozinha e minimo criados');
  assert.equal(joao.plano, 'premium');
  assert.equal(joao.estado, 'teste');
  // Auditoria: resultado mostrado (sem a palavra-passe).
  const aud = JSON.stringify((await api('GET', 'auditoria', 'ceo')).json);
  assert.ok(aud.includes('pedido_resultado_mostrado') && !aud.includes(r1.json.resultado.password));
});

test('erro no domus.sh → resultado ok:false com a mensagem', async () => {
  const r = await api('POST', 'clientes/joao/aparelhos', 'ceo', { id: 'sensor', tipo: 'openbeken', nome: 'Sensor', canais: '1:porta:simular' });
  assert.equal(r.estado, 202);
  await processar();
  const x = (await api('GET', `pedidos/${r.json.pedido.id}`, 'ceo')).json;
  assert.equal(x.pedido.estado, 'erro');
  assert.equal(x.resultado.ok, false);
  assert.match(x.resultado.erro, /'simular' só é válido/);
  assert.equal(x.resultado.password, undefined);
});

test('pedido inexistente, id mal formado e resultado adulterado', async () => {
  assert.equal((await api('GET', 'pedidos/p-20260101000000-00000000', 'ceo')).estado, 404);
  assert.equal((await api('GET', 'pedidos/..%2f..%2fetc%2fpasswd', 'ceo')).estado, 404);
  const r = await api('POST', 'clientes/joao/plano', 'ceo', { plano: 'base' });
  const id = r.json.pedido.id;
  await writeFile(join(base, fila, `${id}.resultado.json`), '{"id":"outro","ok":true,"password":"x"}');
  const x = (await api('GET', `pedidos/${id}`, 'ceo')).json;
  assert.equal(x.resultado.ok, false, 'id do resultado não corresponde');
  assert.equal(x.resultado.password, undefined);
  await rm(join(base, fila, `${id}.json`), { force: true });
});

test('./domus.sh painel-utilizador: o painel aplica o pedido (e recusa os inválidos)', async () => {
  let r = await domus(ENV, ['painel-utilizador', 'nova.tecnica@domus.teste', 'tecnico', 'Nova Técnica'], { stdin: 'senha-escolhida-longa\n' });
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /Utilizador nova\.tecnica@domus\.teste \(tecnico\) criado\/atualizado no painel/);
  const c = await p.entrar('nova.tecnica@domus.teste', 'senha-escolhida-longa');
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: c })).json.utilizador.papel, 'tecnico');
  const ficheiros = await readdir(join(base, fila));
  assert.ok(!ficheiros.some((f) => f.startsWith('u-')), 'pedido (com a palavra-passe) e resultado apagados');
  // Repor como CEO (o mesmo email): muda papel e palavra-passe e termina as sessões.
  r = await domus(ENV, ['painel-utilizador', 'nova.tecnica@domus.teste', 'ceo'], { stdin: 'outra-senha-longa\n' });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: c })).estado, 401);
  await p.entrar('nova.tecnica@domus.teste', 'outra-senha-longa');
  // Recusados pelo próprio domus.sh (nada escrito).
  for (const [args, re] of [
    [['painel-utilizador', 'nao-e-email', 'ceo'], /email inválido/],
    [['painel-utilizador', 'a@domus.teste', 'admin'], /papel inválido/],
    [['painel-utilizador', 'a@domus.teste'], /uso:/],
  ]) {
    const x = await domus(ENV, args, { stdin: 'senha-longa-1234\n' });
    assert.notEqual(x.codigo, 0);
    assert.match(x.stderr, re);
  }
  const curta = await domus(ENV, ['painel-utilizador', 'a@domus.teste', 'ceo'], { stdin: 'curta\n' });
  assert.match(curta.stderr, /pelo menos 10 caracteres/);
  // Um pedido u- adulterado (não veio do domus.sh) é recusado pelo painel.
  const id = 'u-20260101000000-0000abcd';
  await writeFile(join(base, fila, `${id}.json`), JSON.stringify({ id, tipo: 'painel-utilizador', dados: { email: 'intruso@x.pt', papel: 'ceo', nome: 'I', password: 'uma-senha-longa' }, por: 'painel', criado: 'x' }), { mode: 0o600 });
  const res = await esperar(async () => {
    try { return JSON.parse(await readFile(join(base, fila, `${id}.resultado.json`), 'utf8')); } catch { return null; }
  });
  assert.equal(res.ok, false);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE email = ?').get('intruso@x.pt').n, 0);
  await rm(join(base, fila, `${id}.resultado.json`));
  const aud = p.app.db.prepare('SELECT * FROM auditoria WHERE email = \'domus.sh\'').all();
  assert.equal(aud.length, 2);
  assert.ok(!JSON.stringify(aud).includes('senha-escolhida-longa'));
});
