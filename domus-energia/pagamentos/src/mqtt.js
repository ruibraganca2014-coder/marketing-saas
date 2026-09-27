// MQTT: publicação de `domus/<c>/_plano` (utilizador "pagamentos") e
// verificação das credenciais de um cliente (não há outra base de dados de
// utilizadores: tenta-se uma ligação ao broker com esse utilizador).

import mqtt from 'mqtt';
import { randomBytes } from 'node:crypto';

/** Códigos CONNACK de credenciais recusadas (MQTT 3.1.1: 4 e 5; MQTT 5: 134 e 135). */
const RECUSADO = new Set([4, 5, 134, 135]);

/**
 * Verifica o código e a palavra-passe de um cliente ligando-se ao broker como
 * esse utilizador. Para distinguir um cliente de um aparelho (ex. "joao-sala",
 * que também é um utilizador MQTT), subscreve os tópicos retidos que só o
 * cliente lê: `domus/<c>/_aparelhos` (sempre publicado pelo domus.sh ao criar
 * o cliente) e `domus/<c>/_plano` (o único que um cliente suspenso lê).
 *
 * @returns {Promise<'ok'|'credenciais'|'nao_cliente'|'indisponivel'>}
 */
export function verificarCredenciais(url, codigo, senha, { timeoutMs = 5000, esperaRetidasMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let terminado = false;
    let espera = null;
    const cli = mqtt.connect(url, {
      username: codigo,
      password: senha,
      clientId: `domus-sessao-${randomBytes(6).toString('hex')}`,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
      protocolVersion: 4,
      keepalive: 30,
    });
    const acabar = (r) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(geral);
      clearTimeout(espera);
      cli.end(true);
      resolve(r);
    };
    const geral = setTimeout(() => acabar('indisponivel'), timeoutMs + esperaRetidasMs + 500);
    cli.on('error', (e) => acabar(RECUSADO.has(e?.code) ? 'credenciais' : 'indisponivel'));
    cli.on('close', () => acabar('indisponivel'));
    const topicos = [`domus/${codigo}/_aparelhos`, `domus/${codigo}/_plano`];
    cli.on('message', (t) => { if (topicos.includes(t)) acabar('ok'); });
    cli.on('connect', () => {
      cli.subscribe(topicos, { qos: 0 }, (err, concedidas) => {
        if (err) return acabar('indisponivel');
        if (Array.isArray(concedidas) && concedidas.every((g) => g.qos >= 128)) return acabar('nao_cliente');
        espera = setTimeout(() => acabar('nao_cliente'), esperaRetidasMs);
      });
    });
  });
}

/**
 * Ligação permanente ao broker como "pagamentos". Publica `_plano` retido
 * (QoS 1). Em cada (re)ligação chama `aoLigar` (republicar tudo).
 */
export class Publicador {
  constructor({ url, utilizador, senha, registo, aoLigar }) {
    this.registo = registo;
    this.cli = mqtt.connect(url, {
      username: utilizador,
      password: senha,
      clientId: `domus-pagamentos-${randomBytes(4).toString('hex')}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      protocolVersion: 4,
    });
    let avisado = false;
    this.cli.on('connect', () => {
      avisado = false;
      registo.info(`MQTT: ligado como ${utilizador}`);
      Promise.resolve(aoLigar?.()).catch((e) => registo.erro(`republicação: ${e.message}`));
    });
    this.cli.on('error', (e) => {
      if (!avisado) registo.erro(`MQTT: ${e.message}`);
      avisado = true;
    });
  }

  get ligado() {
    return this.cli.connected;
  }

  /** Publica (retido, QoS 1). Não lança: o ficheiro já está gravado e é republicado ao voltar a ligar. */
  async publicar(topico, mensagem, timeoutMs = 5000) {
    if (!this.cli.connected) {
      this.registo.aviso(`MQTT desligado: ${topico} será publicado quando voltar a ligar`);
      return false;
    }
    try {
      await Promise.race([
        this.cli.publishAsync(topico, mensagem, { qos: 1, retain: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), timeoutMs).unref()),
      ]);
      return true;
    } catch (e) {
      this.registo.erro(`MQTT: não publicou ${topico}: ${e.message}`);
      return false;
    }
  }

  fechar() {
    return this.cli.endAsync(true).catch(() => {});
  }
}
