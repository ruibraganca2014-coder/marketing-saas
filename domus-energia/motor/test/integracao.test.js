// Teste de integração: broker MQTT em processo (aedes) + index.js real +
// servidor ntfy falso. Simula um PIR e um interruptor de 4 canais OpenBeken.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { iniciar } from '../src/index.js';
import { lerConfig } from '../src/config.js';
import { silencioso } from './ajuda.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const P = 'domus/joao';
const TOPICO = 'domus-joao-k3j4h5g6f7d8s9a0q1w2';

const APARELHOS = [
  { id: 'pir-corredor', nome: 'Movimento corredor', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'movimento' }, { n: 2, funcao: 'bateria' }] },
  {
    id: 'sala-4g', nome: 'Interruptor sala', tipo: 'openbeken',
    canais: [1, 2, 3, 4].map((n) => ({ n, funcao: 'interruptor', nome: `Canal ${n}` })),
  },
];

let broker, servidorMqtt, portaMqtt, servidorNtfy, portaNtfy, dados, motor, cliente;
/** Pedidos recebidos pelo ntfy falso. */
const pedidosNtfy = [];
/** Todas as mensagens vistas pelo "cliente" de teste. */
const mensagens = [];
const esperas = [];

function aoChegar() {
  for (const e of [...esperas]) {
    const m = mensagens.find((x, i) => i >= e.desde && e.cond(x));
    if (m) {
      esperas.splice(esperas.indexOf(e), 1);
      e.resolver(m);
    }
  }
}

/** Espera por uma mensagem (a partir de agora) que cumpra a condição. */
function esperar(cond, ms = 5000, desde = mensagens.length) {
  return new Promise((resolver, rejeitar) => {
    const e = { cond, desde, resolver };
    esperas.push(e);
    aoChegar();
    setTimeout(() => {
      if (esperas.includes(e)) {
        esperas.splice(esperas.indexOf(e), 1);
        rejeitar(new Error(`timeout à espera de mensagem: ${cond}`));
      }
    }, ms).unref();
  });
}

const publicar = (c, topico, payload, retain = false) =>
  new Promise((r, j) => c.publish(topico, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1, retain }, (e) => (e ? j(e) : r())));

/** Ambiente sem as variáveis do node:test (senão o filho julga ser um teste). */
function envSemTeste() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST')) delete env[k];
  return env;
}

function ligarCliente(username) {
  return new Promise((resolver, rejeitar) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${portaMqtt}`, { username, password: 'x', reconnectPeriod: 0 });
    c.once('connect', () => resolver(c));
    c.once('error', rejeitar);
  });
}

before(async () => {
  broker = await Aedes.createBroker({
    // Simula a ACL: só "admin" e "motor" publicam no canal de administração.
    authorizePublish: (c, pacote, cb) => {
      if (pacote.topic.endsWith('/_automacoes/admin') && !['admin', 'motor'].includes(c?.utilizador)) {
        return cb(new Error('proibido'));
      }
      cb(null);
    },
    authenticate: (c, username, _p, cb) => {
      c.utilizador = username;
      cb(null, true);
    },
  });
  servidorMqtt = net.createServer(broker.handle);
  await new Promise((r) => servidorMqtt.listen(0, '127.0.0.1', r));
  portaMqtt = servidorMqtt.address().port;

  servidorNtfy = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => {
      pedidosNtfy.push({ metodo: req.method, url: req.url, cabecalhos: req.headers, corpo });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => servidorNtfy.listen(0, '127.0.0.1', r));
  portaNtfy = servidorNtfy.address().port;

  dados = fs.mkdtempSync(path.join(os.tmpdir(), 'domus-motor-'));

  // O administrador publica a lista de aparelhos (retida) antes de o motor arrancar.
  const admin = await ligarCliente('admin');
  await publicar(admin, `${P}/_aparelhos`, APARELHOS, true);
  // Como o domus.sh: tópico ntfy secreto do cliente, retido.
  await publicar(admin, `${P}/_ntfy`, { url: `https://ntfy.exemplo.pt/${TOPICO}`, servidor: 'https://ntfy.exemplo.pt', topico: TOPICO }, true);
  await publicar(admin, `${P}/pir-corredor/1/get`, '1', true); // valor antigo retido: não pode disparar
  admin.end();

  cliente = await ligarCliente('joao');
  cliente.on('message', (topico, payload, pacote) => {
    mensagens.push({ topico, payload: payload.toString(), retain: pacote.retain });
    aoChegar();
  });
  await new Promise((r) => cliente.subscribe('domus/#', { qos: 1 }, r));

  const config = {
    ...lerConfig({
      MQTT_URL: `mqtt://127.0.0.1:${portaMqtt}`,
      MQTT_USER: 'motor',
      MQTT_PASS: 'x',
      DADOS_DIR: dados,
      NTFY_URL: `http://127.0.0.1:${portaNtfy}`,
      NTFY_USER: 'motor',
      NTFY_PASS: 'segredo',
      FCM_SERVICE_ACCOUNT: path.join(dados, 'nao-existe.json'),
      MOTOR_TICK_MS: '50',
      MOTOR_ESPERA_ARRANQUE_MS: '200',
    }),
  };
  motor = iniciar(config, { log: silencioso });
});

after(async () => {
  await motor?.parar();
  cliente?.end(true);
  await new Promise((r) => broker.close(r));
  await new Promise((r) => servidorMqtt.close(r));
  await new Promise((r) => servidorNtfy.close(r));
  fs.rmSync(dados, { recursive: true, force: true });
});

test('fluxo completo: automação por MQTT, movimento, durante_s, alarme e ntfy', async () => {
  // 1. O motor publica o estado retido do cliente após o arranque.
  await esperar((m) => m.topico === `${P}/_automacoes` && m.payload === '[]', 5000, 0);
  // O valor retido do PIR não disparou nada.
  assert.equal(mensagens.some((m) => m.topico.endsWith('/set')), false);

  // 2. A app envia a automação.
  const aut = {
    id: 'luz-corredor',
    nome: 'Luz do corredor com movimento',
    ativa: true,
    bloqueada: false,
    quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 },
    entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4, durante_s: 1 }],
  };
  const guardada = esperar((m) => m.topico === `${P}/_automacoes` && m.payload.includes('luz-corredor'));
  await publicar(cliente, `${P}/_automacoes/set`, [aut]);
  assert.equal((await guardada).retain, false); // entregue ao vivo (retida no broker)

  // Automação inválida → evento erro.
  const erro = esperar((m) => m.topico === `${P}/_eventos` && JSON.parse(m.payload).tipo === 'erro');
  await publicar(cliente, `${P}/_automacoes/set`, [{ ...aut, entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 7 }] }]);
  assert.match(JSON.parse((await erro).payload).mensagem, /canal 7/);

  // 3. Movimento → canal 4 liga e desliga 1 s depois.
  await publicar(cliente, `${P}/pir-corredor/1/get`, '0');
  const liga = esperar((m) => m.topico === `${P}/sala-4g/4/set` && m.payload === '1');
  const desliga = esperar((m) => m.topico === `${P}/sala-4g/4/set` && m.payload === '0', 5000);
  const t0 = Date.now();
  await publicar(cliente, `${P}/pir-corredor/1/get`, '1');
  await liga;
  await desliga;
  const decorrido = Date.now() - t0;
  assert.ok(decorrido >= 950 && decorrido < 3000, `desligou ao fim de ${decorrido} ms`);

  // 4. Alarme ligado + movimento → notificação urgente no ntfy.
  const alarme = esperar((m) => m.topico === `${P}/_alarme` && JSON.parse(m.payload).ativo === true);
  await publicar(cliente, `${P}/_alarme/set`, { ativo: true });
  assert.equal(typeof JSON.parse((await alarme).payload).desde, 'string');
  const evAlarme = esperar((m) => m.topico === `${P}/_eventos` && JSON.parse(m.payload).tipo === 'alarme');
  await publicar(cliente, `${P}/pir-corredor/1/get`, '0');
  await publicar(cliente, `${P}/pir-corredor/1/get`, '1');
  await evAlarme;
  const inicio = Date.now();
  while (!pedidosNtfy.length && Date.now() - inicio < 3000) await new Promise((r) => setTimeout(r, 20));
  assert.equal(pedidosNtfy.length, 1);
  const [p] = pedidosNtfy;
  assert.equal(p.metodo, 'POST');
  assert.equal(p.url, `/${TOPICO}`);
  assert.equal(p.cabecalhos.priority, 'urgent');
  assert.equal(p.cabecalhos.tags, 'rotating_light');
  assert.equal(p.cabecalhos.authorization, `Basic ${Buffer.from('motor:segredo').toString('base64')}`);
  assert.match(p.corpo, /Movimento detetado: Movimento corredor/);

  // 5. Histórico retido com os eventos.
  const hist = await esperar((m) => m.topico === `${P}/_historico` && JSON.parse(m.payload)[0]?.tipo === 'alarme', 3000, 0);
  assert.equal(JSON.parse(hist.payload).length, 2); // erro + alarme
});

test('CLI de administração cria uma automação bloqueada; o cliente não usa o canal admin', async () => {
  const ficheiro = path.join(dados, 'empresa.json');
  fs.writeFileSync(ficheiro, JSON.stringify({
    id: 'empresa-noite', nome: 'Desligar tudo à noite',
    quando: { tipo: 'hora', hora: '01:00' },
    entao: [1, 2, 3, 4].map((canal) => ({ acao: 'desligar', aparelho: 'sala-4g', canal })),
  }));
  const guardada = esperar((m) => m.topico === `${P}/_automacoes` && m.payload.includes('empresa-noite'), 10_000);
  const saida = await new Promise((resolver, rejeitar) => {
    execFile(process.execPath, [path.join(DIR, '../src/admin.js'), 'automacao', 'joao', ficheiro], {
      env: { ...envSemTeste(), MQTT_URL: `mqtt://127.0.0.1:${portaMqtt}`, ADMIN_MQTT_USER: 'admin', ADMIN_MQTT_PASS: 'x' },
      timeout: 20_000,
    }, (e, stdout, stderr) => (e ? rejeitar(new Error(`${e.message}\n${stderr}`)) : resolver(stdout)));
  });
  assert.match(saida, /OK/);
  const lista = JSON.parse((await guardada).payload);
  assert.equal(lista.find((a) => a.id === 'empresa-noite').bloqueada, true);

  // O cliente não consegue publicar no canal de administração (ACL).
  // (Numa ligação à parte: o aedes fecha a ligação de quem publica sem permissão.)
  const intruso = await ligarCliente('joao');
  intruso.on('error', () => {});
  intruso.publish(`${P}/_automacoes/admin`, JSON.stringify({ op: 'apagar', id: 'empresa-noite' }), { qos: 0 });
  await new Promise((r) => setTimeout(r, 300));
  intruso.end(true);
  const ultima = mensagens.filter((m) => m.topico === `${P}/_automacoes`).at(-1);
  assert.ok(JSON.parse(ultima.payload).some((a) => a.id === 'empresa-noite'));

  // O estado ficou gravado em disco.
  await motor.parar();
  const estado = JSON.parse(fs.readFileSync(path.join(dados, 'estado.json'), 'utf8'));
  assert.equal(estado.clientes.joao.alarme.ativo, true);
  assert.equal(estado.clientes.joao.automacoes.length, 2);
});
