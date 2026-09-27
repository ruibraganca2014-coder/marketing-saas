// Montagem do serviço: base de dados, autenticação, alertas (MQTT), fila de
// pedidos-admin, API e ficheiros do painel.

import http from 'node:http';
import { abrirDb } from './db.js';
import { Autenticacao } from './auth.js';
import { Dados } from './dados.js';
import { Alertas } from './alertas.js';
import { Pedidos, RE_EMAIL } from './pedidos.js';
import { criarApi } from './api.js';
import { criarEstatico } from './estatico.js';
import { responder, CABECALHOS_SEGURANCA } from './http.js';
import { problemaSenha } from './senhas.js';

/**
 * @param {{config: object, registo: object, relogio?: () => number, mqtt?: boolean}} opcoes
 */
export async function criarApp({ config, registo, relogio = () => Date.now(), mqtt = true }) {
  for (const a of config.avisos || []) registo.aviso(a);
  const db = abrirDb(config.db);
  const auth = new Autenticacao({ db, config, registo, relogio });
  const dados = new Dados(config);
  const alertas = new Alertas({ config, registo, relogio });
  const pedidos = new Pedidos({ config, db, registo, auditar: () => {}, relogio });
  const api = criarApi({ db, config, auth, dados, alertas, pedidos, registo, relogio });
  const estatico = criarEstatico(config.publicDir);

  if (config.ceoEmail || config.ceoPass) {
    if (!RE_EMAIL.test(config.ceoEmail) || problemaSenha(config.ceoPass)) {
      registo.erro('PAINEL_CEO_EMAIL/PAINEL_CEO_PASS inválidos (email válido e palavra-passe com 10 a 200 caracteres): ignorados');
    } else if (await auth.criarPrimeiroCeo()) {
      const u = db.prepare('SELECT id FROM utilizadores WHERE email = ?').get(config.ceoEmail.trim().toLowerCase());
      api.auditar(null, 'utilizador_criado', `utilizador:${u.id}`, { email: config.ceoEmail.trim().toLowerCase(), papel: 'ceo', origem: 'PAINEL_CEO_EMAIL' });
    }
  }

  const servidor = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://painel');
    } catch {
      return responder(res, 400, { erro: 'Endereço inválido.' });
    }
    const c = url.pathname;
    if (c === '/api/orcamento' || c === '/api/catalogo' || c.startsWith('/painel/api/')) return api.tratar(req, res, url);
    if (c === '/painel') {
      res.writeHead(301, { ...CABECALHOS_SEGURANCA, Location: '/painel/', 'Content-Length': 0 });
      return res.end();
    }
    if (c.startsWith('/painel/')) {
      return estatico(req, res, c).catch((e) => {
        registo.erro(`estático ${c}: ${e.message}`);
        if (!res.headersSent) responder(res, 500, { erro: 'Erro interno.' });
      });
    }
    return responder(res, 404, { erro: 'Endereço desconhecido.' });
  });
  servidor.headersTimeout = 15_000;
  servidor.requestTimeout = 60_000;

  if (mqtt) alertas.iniciar();
  pedidos.iniciar();

  return {
    servidor, db, auth, dados, alertas, pedidos, api,
    async fechar() {
      await pedidos.parar();
      auth.fechar();
      await alertas.fechar();
      await new Promise((r) => { servidor.close(() => r()); servidor.closeAllConnections?.(); });
      db.close();
    },
  };
}
