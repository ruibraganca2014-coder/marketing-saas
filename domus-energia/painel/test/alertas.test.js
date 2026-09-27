// Alertas técnicos em direto, com um Mosquitto 2 REAL e as permissões (ACL)
// geradas pelo servidor/domus.sh: o painel liga-se como "painel" (só leitura).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import { join } from 'node:path';
import { iniciarMosquitto, iniciarPainel, esperar, SENHAS_MQTT } from './ajuda.js';
import { iso } from '../src/util.js';

let mq;
let p;
let admin;
let cookies;

async function publicar(topico, msg, retain = true) {
  await admin.publishAsync(topico, typeof msg === 'string' ? msg : JSON.stringify(msg), { qos: 1, retain });
}

before(async () => {
  mq = await iniciarMosquitto();
  await mq.domus('aparelho', 'joao', 'sala', 'openbeken', 'Sala', 'sala-senha-1');
  await mq.domus('aparelho', 'joao', 'porta', 'openbeken', 'Porta da rua', '--bateria', '--canais', '1:porta:Porta:entrada,2:bateria', 'porta-senha-1');
  await mq.domus('aparelho', 'joao', 'luz', 'shelly', 'Luz', 'luz-senha-1');
  await mq.domus('aparelho', 'maria', 'quadro', 'shelly', 'Quadro', '--medidor', 'quadro-senha-1');
  admin = await mqtt.connectAsync(mq.url, { username: 'admin', password: SENHAS_MQTT.admin, clientId: 'teste-admin' });
  const agora = Date.now();
  await publicar('domus/joao/_saude', {
    sala: { online: true, ultima_noticia: iso(agora), rssi: -60, uptime_s: 100, reinicios_24h: 0, bateria: null, bateria_dias: null, offline_desde: null },
    porta: { online: true, ultima_noticia: iso(agora - 30 * 3600_000), rssi: null, uptime_s: null, reinicios_24h: 0, bateria: 10, bateria_dias: 5, offline_desde: null },
    luz: { online: true, ultima_noticia: iso(agora), rssi: -85, uptime_s: 50, reinicios_24h: 7, bateria: null, bateria_dias: null, offline_desde: null },
  });
  await publicar('domus/joao/_alarme', { ativo: true, estado: 'armado', tipo: 'total', desde: iso(agora) });
  await publicar('domus/joao/_modo', { modo: 'fora', desde: iso(agora), por: 'app' });
  await publicar('domus/joao/sala/connected', 'offline');
  await publicar('domus/maria/_alarme', { ativo: true, estado: 'disparado', tipo: 'total', desde: iso(agora) });
  await publicar('domus/maria/quadro/online', 'false');
  await publicar('domus/maria/_saude', { quadro: { online: false, ultima_noticia: iso(agora - 600_000), rssi: -70, reinicios_24h: 0, bateria: null, bateria_dias: 30, offline_desde: iso(agora - 600_000) } });

  p = await iniciarPainel({
    mqtt: true,
    dados: mq.dados,
    env: { MQTT_URL: mq.url, PAINEL_MQTT_PASS: SENHAS_MQTT.painel, CLIENTES_DIR: join(mq.dados, 'clientes'), PLANOS_DIR: join(mq.dados, 'planos') },
  });
  cookies = {};
  for (const papel of ['ceo', 'tecnico', 'comercial']) {
    const u = await p.criarUtilizador(papel);
    cookies[papel] = await p.entrar(u.email);
  }
});

after(async () => {
  await p?.fechar();
  await admin?.endAsync();
  await mq?.parar();
});

const alertas = async (papel = 'tecnico', q = '') => (await p.pedir('GET', `/painel/api/alertas${q}`, { cookie: cookies[papel] })).json;

test('o painel liga-se como "painel" e calcula os alertas de todas as casas', async () => {
  const r = await esperar(async () => {
    const a = await alertas();
    return a.ligado && a.alertas.length >= 7 ? a : null;
  }, 8000);
  const chave = (a) => `${a.cliente}/${a.aparelho ?? '-'}/${a.tipo}/${a.gravidade}`;
  assert.deepEqual(r.alertas.map(chave), [
    'joao/porta/bateria_fraca/critica',         // bateria < 15 % num sensor do alarme, com o alarme armado
    'maria/-/alarme_disparado/critica',
    'joao/porta/sem_noticias/alta',              // sensor a pilhas sem notícias há 30 h (alarme armado → sobe)
    'joao/sala/offline/alta',                    // connected = offline
    'maria/quadro/offline/alta',                 // online = false
    'joao/luz/reinicios/media',                  // 7 reinícios em 24 h
    'joao/luz/sinal_fraco/baixa',                // rssi -85
  ]);
  assert.equal(r.alertas.length, 7);
  assert.deepEqual(r.contagem, { critica: 2, alta: 3, media: 1, baixa: 1 });
  const porta = r.alertas.find((a) => a.tipo === 'bateria_fraca');
  assert.equal(porta.aparelho_nome, 'Porta da rua');
  assert.equal(porta.valor, 10);
  assert.match(porta.mensagem, /Bateria fraca \(10 %\)/);
  assert.match(r.alertas.find((a) => a.tipo === 'sem_noticias').mensagem, /Sem notícias há 30 h/);
  // Ordenado por gravidade.
  const g = { critica: 4, alta: 3, media: 2, baixa: 1 };
  for (let i = 1; i < r.alertas.length; i++) assert.ok(g[r.alertas[i - 1].gravidade] >= g[r.alertas[i].gravidade]);
});

test('?cliente= filtra e traz o estado da casa; comercial não vê alertas', async () => {
  const m = await alertas('ceo', '?cliente=maria');
  assert.ok(m.alertas.length === 2 && m.alertas.every((a) => a.cliente === 'maria'));
  assert.equal(m.casa.alarme.estado, 'disparado');
  const j = await alertas('ceo', '?cliente=joao');
  assert.equal(j.casa.modo.modo, 'fora');
  assert.equal((await p.pedir('GET', '/painel/api/alertas?cliente=../x', { cookie: cookies.ceo })).estado, 400);
  assert.equal((await p.pedir('GET', '/painel/api/alertas', { cookie: cookies.comercial })).estado, 403);
  const ficha = (await p.pedir('GET', '/painel/api/clientes/joao', { cookie: cookies.tecnico })).json;
  assert.equal(ficha.alertas, 5);
  assert.equal(ficha.alertas_lista.length, 5);
  const resumo = (await p.pedir('GET', '/painel/api/resumo', { cookie: cookies.ceo })).json;
  assert.equal(resumo.alertas.ligado, true);
  assert.equal(resumo.alertas.contagem.critica, 2);
  assert.deepEqual(resumo.alertas.criticos.map((a) => a.tipo).sort(), ['alarme_disparado', 'bateria_fraca']);
});

test('lista viva: muda assim que chegam mensagens (retidas, _eventos e apagadas)', async () => {
  await publicar('domus/maria/_alarme', { ativo: false, estado: 'desarmado', desde: iso(new Date()) });
  await publicar('domus/joao/sala/connected', 'online');
  await esperar(async () => {
    const a = await alertas();
    return !a.alertas.some((x) => x.tipo === 'alarme_disparado') && !a.alertas.some((x) => x.aparelho === 'sala') ? a : null;
  });
  // Evento de alarme (não retido) → alarme disparado.
  await publicar('domus/maria/_eventos', { tipo: 'alarme', texto: 'Alarme: movimento na sala', aparelho: 'quadro' }, false);
  const a = await esperar(async () => {
    const x = await alertas('ceo', '?cliente=maria');
    return x.alertas.some((y) => y.tipo === 'alarme_disparado') ? x : null;
  });
  assert.equal(a.casa.eventos[0].texto, 'Alarme: movimento na sala');
  // Retida apagada (_saude vazia) → os alertas de saúde do joao desaparecem.
  await publicar('domus/joao/_saude', '');
  await esperar(async () => ((await alertas('ceo', '?cliente=joao')).alertas.every((y) => y.aparelho !== 'luz') ? true : null));
  // Mensagens estragadas são ignoradas sem partir nada.
  await publicar('domus/joao/_saude', '{isto não é json');
  await publicar('domus/joao/_aparelhos', '[1,2,{"id":"../x"}]');
  assert.equal((await p.pedir('GET', '/painel/api/alertas', { cookie: cookies.ceo })).estado, 200);
});

test('ACL: o utilizador "painel" só lê domus/# — não publica em lado nenhum', async () => {
  const recebidas = [];
  const obs = await mqtt.connectAsync(mq.url, { username: 'admin', password: SENHAS_MQTT.admin, clientId: 'teste-obs' });
  await obs.subscribeAsync(['domus/#', 'fora/#']);
  obs.on('message', (t, m) => { if (m.toString().startsWith('painel-')) recebidas.push(t); });
  const painel = await mqtt.connectAsync(mq.url, { username: 'painel', password: SENHAS_MQTT.painel, clientId: 'teste-painel', reconnectPeriod: 0 });
  const topicos = ['domus/joao/_alarme/set', 'domus/joao/_modo/set', 'domus/joao/sala/1/set', 'domus/joao/_plano', 'domus/joao/_aparelhos', 'domus/maria/quadro/rpc', 'fora/x'];
  for (const t of topicos) await painel.publishAsync(t, `painel-${t}`, { qos: 1 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  assert.deepEqual(recebidas, [], 'nenhuma publicação do painel chegou');
  // Mas lê tudo.
  const lido = await new Promise((resolve) => {
    painel.on('message', (t) => { if (t === 'domus/joao/_alarme') resolve(t); });
    painel.subscribe('domus/joao/_alarme');
  });
  assert.equal(lido, 'domus/joao/_alarme');
  await painel.endAsync();
  await obs.endAsync();
  const { readFile } = await import('node:fs/promises');
  const acl = await readFile(join(mq.dir, 'acl'), 'utf8');
  assert.match(acl, /\nuser painel\ntopic read domus\/#\n/);
});
