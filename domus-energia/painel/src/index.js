// Arranque do serviço do painel (ver README.md).

import { lerConfig } from './config.js';
import { criarApp } from './app.js';
import { criarRegisto } from './util.js';

// Ficheiros novos (base de dados, pedidos) só para o próprio utilizador.
process.umask(0o077);

const registo = criarRegisto();
const config = lerConfig();
const app = await criarApp({ config, registo });
app.servidor.listen(config.porta, () => registo.info(`painel à escuta na porta ${config.porta}`));

let aTerminar = false;
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, async () => {
    if (aTerminar) return;
    aTerminar = true;
    registo.info(`${sinal}: a terminar`);
    await app.fechar().catch(() => {});
    process.exit(0);
  });
}
