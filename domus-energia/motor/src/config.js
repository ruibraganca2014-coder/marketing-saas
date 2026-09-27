// Configuração a partir de variáveis de ambiente (ver README.md).

import path from 'node:path';

/**
 * @typedef {object} Config
 * @property {string} mqttUrl
 * @property {string} mqttUser
 * @property {string} mqttPass
 * @property {string} dadosDir
 * @property {string} ficheiroEstado
 * @property {string} ntfyUrl
 * @property {string} [ntfyUser]
 * @property {string} [ntfyPass]
 * @property {string} [ntfyToken]
 * @property {string} fcmServiceAccount
 * @property {number} tickMs
 * @property {number} esperaArranqueMs
 * @property {number} maxPayload
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function lerConfig(env = process.env) {
  const dadosDir = env.DADOS_DIR || '/dados';
  const ntfyUrl = (env.NTFY_URL || 'http://ntfy').replace(/\/+$/, '');
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://mosquitto:1883',
    mqttUser: env.MQTT_USER || 'motor',
    mqttPass: env.MQTT_PASS || '',
    dadosDir,
    ficheiroEstado: path.join(dadosDir, 'estado.json'),
    ntfyUrl,
    ntfyUser: env.NTFY_USER || undefined,
    ntfyPass: env.NTFY_PASS || undefined,
    ntfyToken: env.NTFY_TOKEN || undefined,
    fcmServiceAccount: env.FCM_SERVICE_ACCOUNT ?? path.join(dadosDir, 'firebase-service-account.json'),
    tickMs: Number(env.MOTOR_TICK_MS) || 1000,
    esperaArranqueMs: Number(env.MOTOR_ESPERA_ARRANQUE_MS ?? 3000),
    // Tem de ficar abaixo do max_packet_size do Mosquitto (1 MB em servidor/mosquitto/mosquitto.conf).
    maxPayload: Number(env.MQTT_MAX_PAYLOAD) || 900 * 1024,
  };
}
