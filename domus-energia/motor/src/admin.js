#!/usr/bin/env node
// Administração das automações e cenas bloqueadas (criadas pela Domus Energia).
//
// Fala com o motor em funcionamento pelos tópicos
//   domus/<cliente>/_automacoes/admin  e  domus/<cliente>/_cenas/admin   (pedido, não retido)
//   …/admin/resultado                                                    (resposta do motor)
// que, pela ACL do Mosquitto, só `admin` e `motor` podem publicar.
//
// Uso:
//   node src/admin.js automacao <cliente> <ficheiro.json | ->
//   node src/admin.js apagar-automacao <cliente> <id>
//   node src/admin.js listar-automacoes <cliente>
//   node src/admin.js cena <cliente> <ficheiro.json | ->
//   node src/admin.js apagar-cena <cliente> <id>
//   node src/admin.js listar-cenas <cliente>
//
// Ligação: MQTT_URL, ADMIN_MQTT_USER/ADMIN_MQTT_PASS (por omissão MQTT_USER/
// MQTT_PASS — dentro do contentor `motor` já estão definidos).

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { CLIENTE_RE } from './aparelhos.js';

const USO = `Uso:
  node src/admin.js automacao <cliente> <ficheiro.json | ->
      Cria ou substitui automação(ões) bloqueada(s). O ficheiro tem um objeto
      (uma automação) ou uma lista. "bloqueada" fica true se não for indicado.
      Use "-" para ler do stdin.
  node src/admin.js apagar-automacao <cliente> <id>
  node src/admin.js listar-automacoes <cliente>
  node src/admin.js cena <cliente> <ficheiro.json | ->
      Cria ou substitui cena(s) bloqueada(s) (o cliente não as pode alterar nem apagar).
  node src/admin.js apagar-cena <cliente> <id>
  node src/admin.js listar-cenas <cliente>

Variáveis: MQTT_URL (mqtt://mosquitto:1883), ADMIN_MQTT_USER / ADMIN_MQTT_PASS
(por omissão MQTT_USER / MQTT_PASS).`;

function sair(msg, codigo = 1) {
  (codigo ? console.error : console.log)(msg);
  process.exit(codigo);
}

function ligar() {
  const url = process.env.MQTT_URL || 'mqtt://mosquitto:1883';
  return mqtt.connect(url, {
    username: process.env.ADMIN_MQTT_USER || process.env.MQTT_USER || 'admin',
    password: process.env.ADMIN_MQTT_PASS || process.env.MQTT_PASS || '',
    clientId: `domus-admin-cli-${process.pid}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
  });
}

/**
 * Envia um pedido ao motor e espera pela resposta.
 * @param {string} cliente
 * @param {object} pedido
 */
function pedirAoMotor(cliente, pedido, recurso = '_automacoes') {
  const id = randomUUID();
  const base = `domus/${cliente}/${recurso}/admin`;
  const c = ligar();
  const limite = setTimeout(() => {
    c.end(true);
    sair('Sem resposta do motor em 15 s. O serviço "motor" está a correr?');
  }, 15_000);
  c.on('error', (e) => sair(`Erro MQTT: ${e.message}`));
  c.on('connect', () => {
    c.subscribe(`${base}/resultado`, { qos: 1 }, (e) => {
      if (e) sair(`Subscrição recusada: ${e.message}`);
      c.publish(base, JSON.stringify({ ...pedido, pedido: id }), { qos: 1, retain: false }, (e2) => {
        if (e2) sair(`Publicação recusada: ${e2.message}`);
      });
    });
  });
  c.on('message', (_t, payload) => {
    let r;
    try {
      r = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    if (r?.pedido !== id) return;
    clearTimeout(limite);
    c.end(false, {}, () => (r.ok ? sair(`OK: ${recurso === '_cenas' ? 'cenas atualizadas' : 'automações atualizadas'}.`, 0) : sair(`Recusado pelo motor: ${r.erro}`)));
  });
}

function listar(cliente, recurso = '_automacoes') {
  const c = ligar();
  const limite = setTimeout(() => {
    c.end(true);
    sair(`Sem ${recurso === '_cenas' ? 'cenas' : 'automações'} publicadas para este cliente.`, 0);
  }, 5_000);
  c.on('error', (e) => sair(`Erro MQTT: ${e.message}`));
  c.on('connect', () => c.subscribe(`domus/${cliente}/${recurso}`, { qos: 1 }));
  c.on('message', (_t, payload) => {
    clearTimeout(limite);
    console.log(JSON.stringify(JSON.parse(payload.toString('utf8') || '[]'), null, 2));
    c.end(false, {}, () => process.exit(0));
  });
}

const [comando, cliente, arg] = process.argv.slice(2);
if (!comando || comando === '-h' || comando === '--help') sair(USO, comando ? 0 : 1);
if (!cliente || !CLIENTE_RE.test(cliente)) sair(`Cliente inválido.\n\n${USO}`);

switch (comando) {
  case 'cena':
  case 'automacao': {
    if (!arg) sair(USO);
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(arg === '-' ? 0 : arg, 'utf8'));
    } catch (e) {
      sair(`Não foi possível ler ${arg === '-' ? 'o stdin' : arg}: ${e.message}`);
    }
    const lista = Array.isArray(dados) ? dados : [dados];
    if (comando === 'cena') pedirAoMotor(cliente, { op: 'guardar', cenas: lista }, '_cenas');
    else pedirAoMotor(cliente, { op: 'guardar', automacoes: lista });
    break;
  }
  case 'apagar-cena':
    if (!arg) sair(USO);
    pedirAoMotor(cliente, { op: 'apagar', id: arg }, '_cenas');
    break;
  case 'listar-cenas':
    listar(cliente, '_cenas');
    break;
  case 'apagar-automacao':
    if (!arg) sair(USO);
    pedirAoMotor(cliente, { op: 'apagar', id: arg });
    break;
  case 'listar-automacoes':
    listar(cliente);
    break;
  default:
    sair(`Comando desconhecido: ${comando}\n\n${USO}`);
}
