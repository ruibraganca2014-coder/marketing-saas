// Montagem do serviço: Stripe, MQTT, HTTP e verificação periódica dos atrasos.

import Stripe from 'stripe';
import { Pagamentos } from './pagamentos.js';
import { Publicador, verificarCredenciais } from './mqtt.js';
import { criarServidor } from './servidor.js';

/**
 * @param {{config: object, registo: object, stripeOpcoes?: object, stripe?: object}} o
 *   `stripeOpcoes` (testes): host/port/protocol de um Stripe falso.
 */
export function criarServico({ config, registo, stripeOpcoes = {}, stripe: stripeDado }) {
  for (const e of config.erros) registo.erro(`configuração: ${e}`);
  for (const e of config.errosStripe) registo.aviso(`configuração do Stripe: ${e} (checkout, portal e webhook desligados)`);

  let stripe = stripeDado ?? null;
  if (!stripe && !config.errosStripe.length) {
    stripe = new Stripe(config.stripe.chave, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'domus-pagamentos' },
      ...stripeOpcoes,
    });
  }

  const pagamentos = new Pagamentos({ config, stripe, publicador: null, registo });
  let publicador = null;
  let temporizador = null;

  const servidor = criarServidor({
    config,
    pagamentos,
    stripe,
    registo,
    verificarCredenciais: (c, p) => verificarCredenciais(config.mqttUrl, c, p),
  });

  async function verificar() {
    try {
      const n = await pagamentos.verificarAtrasos();
      if (n) registo.info(`verificação de atrasos: ${n} cliente(s) suspenso(s)`);
    } catch (e) {
      registo.erro(`verificação de atrasos: ${e.message}`);
    }
  }

  return {
    pagamentos,
    servidor,
    get publicador() { return publicador; },

    async iniciar() {
      if (!config.erros.length) {
        publicador = new Publicador({
          url: config.mqttUrl,
          utilizador: config.mqttUtilizador,
          senha: config.mqttSenha,
          registo,
          aoLigar: () => pagamentos.republicarTodos(),
        });
        pagamentos.publicador = publicador;
        await verificar();
        temporizador = setInterval(verificar, config.verificarMin * 60_000);
        temporizador.unref();
      }
      await new Promise((resolve, reject) => {
        servidor.once('error', reject);
        servidor.listen(config.porta, config.anfitriao, () => {
          servidor.off('error', reject);
          resolve();
        });
      });
      registo.info(`pagamentos a ouvir em ${config.anfitriao}:${servidor.address().port}`);
    },

    async parar() {
      clearInterval(temporizador);
      await new Promise((r) => servidor.close(() => r()));
      servidor.closeAllConnections?.();
      await publicador?.fechar();
    },
  };
}
