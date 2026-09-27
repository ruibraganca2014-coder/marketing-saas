#!/usr/bin/env node
// Motor de regras da Domus Energia — ligação ao MQTT, ntfy/FCM e disco.
// A lógica está em motor.js; aqui só se liga tudo.

import mqtt from 'mqtt';
import { pathToFileURL } from 'node:url';
import { lerConfig } from './config.js';
import { Motor } from './motor.js';
import { FicheiroEstado } from './armazenamento.js';
import { Ntfy, Fcm, criarNotificador } from './notificacoes.js';

const agoraTexto = () => new Date().toISOString();

export const log = {
  info: (...a) => console.log(agoraTexto(), ...a),
  aviso: (...a) => console.warn(agoraTexto(), 'AVISO', ...a),
  erro: (...a) => console.error(agoraTexto(), 'ERRO', ...a),
};

/**
 * Arranca o motor com a configuração dada.
 * @param {import('./config.js').Config} config
 * @param {{log?: typeof log}} [opcoes]
 */
export function iniciar(config, opcoes = {}) {
  const l = opcoes.log ?? log;
  const armazenamento = new FicheiroEstado(config.ficheiroEstado, { log: l });
  const semEscrita = armazenamento.verificarEscrita();
  if (semEscrita) l.erro(`[estado] ${semEscrita}`);
  const ntfy = new Ntfy({
    url: config.ntfyUrl,
    token: config.ntfyToken,
    utilizador: config.ntfyUser,
    senha: config.ntfyPass,
    log: l,
  });
  const fcm = new Fcm({ ficheiroConta: config.fcmServiceAccount, log: l });

  /** @type {mqtt.MqttClient} */
  let cliente;
  const motor = new Motor({
    publicar: (topico, payload, o) => {
      cliente.publish(topico, payload, { qos: 1, retain: !!o?.retain }, (e) => {
        if (e) l.erro(`[mqtt] publicação em ${topico} falhou: ${e.message}`);
      });
    },
    notificar: criarNotificador({ ntfy, fcm, log: l }),
    armazenamento,
    log: l,
    esperaArranqueMs: config.esperaArranqueMs,
    maxPayload: config.maxPayload,
  });

  cliente = mqtt.connect(config.mqttUrl, {
    username: config.mqttUser,
    password: config.mqttPass,
    clientId: `domus-motor-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 15_000,
    keepalive: 60,
  });

  cliente.on('connect', () => {
    l.info(`[mqtt] ligado a ${config.mqttUrl} como ${config.mqttUser}`);
    cliente.subscribe('domus/#', { qos: 1 }, (e) => {
      if (e) {
        l.erro(`[mqtt] subscrição falhou: ${e.message}`);
        return;
      }
      motor.aoLigar();
    });
  });
  cliente.on('message', (topico, payload, pacote) => motor.aoMensagem(topico, payload, !!pacote.retain));
  cliente.on('reconnect', () => l.info('[mqtt] a tentar religar…'));
  cliente.on('offline', () => l.aviso('[mqtt] sem ligação ao broker'));
  cliente.on('error', (e) => l.erro(`[mqtt] ${e.message}`));

  const intervalo = setInterval(() => motor.tick(), config.tickMs);

  let parado = false;
  /** Termina de forma ordenada: grava o estado e fecha o MQTT. */
  async function parar() {
    if (parado) return;
    parado = true;
    clearInterval(intervalo);
    armazenamento.descarregar();
    await new Promise((resolve) => cliente.end(false, {}, () => resolve(undefined)));
    l.info('[motor] parado');
  }

  return { motor, cliente, parar };
}

// Execução direta: `node src/index.js`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = lerConfig();
  log.info(`[motor] a arrancar (dados em ${config.dadosDir}, fuso ${process.env.TZ || 'Europe/Lisbon'})`);
  const { parar } = iniciar(config);
  const terminar = (sinal) => {
    log.info(`[motor] recebido ${sinal}, a terminar…`);
    const forcar = setTimeout(() => process.exit(1), 10_000);
    forcar.unref();
    parar().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => terminar('SIGTERM'));
  process.on('SIGINT', () => terminar('SIGINT'));
  process.on('unhandledRejection', (e) => log.erro('[motor] promessa rejeitada:', e));
  process.on('uncaughtException', (e) => log.erro('[motor] exceção não tratada:', e));
}
