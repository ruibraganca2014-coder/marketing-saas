// Serviço "pagamentos" da Domus Energia (docs/PROTOCOLO-PLANOS.md §4).
import { lerConfig } from './config.js';
import { criarServico } from './app.js';
import { criarRegisto } from './util.js';

const registo = criarRegisto();
const servico = criarServico({ config: lerConfig(), registo });

try {
  await servico.iniciar();
} catch (e) {
  registo.erro(`não arrancou: ${e.message}`);
  process.exit(1);
}

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, async () => {
    registo.info(`${sinal}: a terminar`);
    await servico.parar().catch(() => {});
    process.exit(0);
  });
}
