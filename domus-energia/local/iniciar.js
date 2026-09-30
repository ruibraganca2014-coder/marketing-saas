// Domus Energia — tudo a correr no computador, sem Docker.
//
// Faz o papel do servidor/docker-compose.yml:
//   http://localhost:8080/         -> site (pasta ../web; o config.js é servido com o MQTT local)
//   ws://localhost:8080/mqtt       -> broker MQTT (aedes, em vez do Mosquitto)
//   mqtt://localhost:1883          -> o mesmo broker, para aparelhos e ferramentas
//   http://localhost:8080/painel/  -> painel da empresa (porta interna 8081)
//   http://localhost:8080/api/...  -> pagamentos (porta interna 8082); /api/orcamento(/fotos), /api/catalogo e
//                                     /api/conta/* (conta de cliente) -> painel
//
// Diferenças para o servidor a sério (é só para desenvolver e testar):
//   - o broker aceita qualquer utilizador e palavra-passe e não tem ACL;
//   - não há ntfy (as notificações do motor falham e ficam no registo);
//   - o ./domus.sh não corre: os pedidos do painel (criar clientes, aparelhos) ficam pendentes;
//   - os emails das contas de cliente (códigos) não saem: aparecem neste terminal, "[painel] [email] para x: código 123456";
//   - os pagamentos do pedido são simulados (docs/PAGAMENTOS-PEDIDO.md): nenhum dinheiro real, nenhuma chave Stripe.
//
// Outras origens para testar no browser (ex.: http://qc1.localhost:8080): ORIGENS_EXTRA="http://qc1.localhost:8080,..." npm start.
//
// Uso: npm run instalar (uma vez) e depois npm start.

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const WEB = join(RAIZ, 'web');
const DADOS = join(AQUI, 'dados');

const PORTA_SITE = Number(process.env.PORTA || 8080);
const PORTA_MQTT = Number(process.env.PORTA_MQTT || 1883);
const PORTA_PAINEL = 8081;
const PORTA_PAGAMENTOS = 8082;
const ORIGEM = `http://localhost:${PORTA_SITE}`;
// Origens aceites pelo painel nos pedidos que alteram dados (CSRF): a do site e as de ORIGENS_EXTRA.
const ORIGENS = [ORIGEM, ...String(process.env.ORIGENS_EXTRA || '').split(',').map((o) => o.trim()).filter(Boolean)].join(',');

for (const s of ['painel', 'planos', 'clientes', 'pagamentos', 'pedidos-admin', 'motor']) {
  mkdirSync(join(DADOS, s), { recursive: true });
}
for (const s of ['painel', 'pagamentos', 'motor']) {
  if (!existsSync(join(RAIZ, s, 'node_modules'))) {
    console.error(`Falta instalar as dependências de ${s}/. Corre primeiro: npm run instalar`);
    process.exit(1);
  }
}

// Segredos locais, gerados na primeira vez e guardados em dados/local.json.
const fichSegredos = join(DADOS, 'local.json');
if (!existsSync(fichSegredos)) {
  writeFileSync(fichSegredos, JSON.stringify({
    sessaoSegredo: randomBytes(32).toString('hex'),
    ceoEmail: 'ceo@domus.localhost',
    ceoPass: randomBytes(9).toString('base64url'),
  }, null, 2));
}
const segredos = JSON.parse(readFileSync(fichSegredos, 'utf8'));
// Chave da conta de cliente (CONTA_CHAVE), acrescentada aos local.json antigos.
if (!segredos.contaChave) {
  segredos.contaChave = randomBytes(32).toString('hex');
  writeFileSync(fichSegredos, JSON.stringify(segredos, null, 2));
}

// ---------------------------------------------------------------- broker MQTT
const broker = await Aedes.createBroker({
  authenticate: (_c, _u, _p, cb) => cb(null, true),
});
const servidorMqtt = net.createServer(broker.handle);
await new Promise((ok) => servidorMqtt.listen(PORTA_MQTT, '127.0.0.1', ok));

// ---------------------------------------------------------------- serviços
const filhos = [];
const { ANTHROPIC_API_KEY: chaveAnthropic, ...ambiente } = process.env;
function arrancar(nome, env) {
  const f = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
    cwd: join(RAIZ, nome),
    // A chave da Anthropic só vai para o painel (é passada em `env`); os outros serviços não a recebem.
    env: { ...ambiente, TZ: 'Europe/Lisbon', MQTT_URL: `mqtt://127.0.0.1:${PORTA_MQTT}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefixo = `[${nome}] `;
  const escrever = (saida) => (b) => {
    for (const linha of String(b).split(/\r?\n/)) if (linha) saida.write(prefixo + linha + '\n');
  };
  f.stdout.on('data', escrever(process.stdout));
  f.stderr.on('data', escrever(process.stderr));
  f.on('exit', (codigo) => console.error(`${prefixo}terminou (código ${codigo})`));
  filhos.push(f);
}

arrancar('painel', {
  PORTA: String(PORTA_PAINEL),
  ANFITRIAO: '127.0.0.1',
  DADOS_DIR: DADOS,
  PAINEL_ORIGENS: ORIGENS,
  MQTT_USER: 'painel',
  // Conta de cliente: os emails (códigos) vão sempre para o terminal; chave local para as credenciais da casa.
  EMAIL_LOCAL: '1',
  CONTA_CHAVE: segredos.contaChave,
  // Pagamentos do pedido (relatório, visita, avaria, sinal, restante): sempre SIMULADOS no local (página pagamento-simulado.html).
  PAGAMENTOS_MODO: 'simulado',
  PAINEL_MQTT_PASS: 'local',
  PAINEL_CEO_EMAIL: segredos.ceoEmail,
  PAINEL_CEO_PASS: segredos.ceoPass,
  CONFIAR_PROXY: '1',
  // Leitura automática da foto do quadro: só se a variável existir no terminal que corre o npm start.
  ...(chaveAnthropic ? { ANTHROPIC_API_KEY: chaveAnthropic } : {}),
});
arrancar('pagamentos', {
  PORTA: String(PORTA_PAGAMENTOS),
  ANFITRIAO: '127.0.0.1',
  DADOS_DIR: DADOS,
  PAGAMENTOS_CSV: join(DADOS, 'pagamentos', 'pagamentos.csv'),
  EVENTOS_FICH: join(DADOS, 'pagamentos', 'eventos-stripe.json'),
  PUBLIC_URL: ORIGEM,
  SESSAO_SEGREDO: segredos.sessaoSegredo,
  MQTT_USER: 'pagamentos',
  PAGAMENTOS_MQTT_PASS: 'local',
  CONFIAR_PROXY: '1',
});
arrancar('motor', {
  DADOS_DIR: join(DADOS, 'motor'),
  MQTT_USER: 'motor',
  MQTT_PASS: 'local',
  NTFY_URL: 'http://127.0.0.1:9',
  NTFY_PUBLIC_URL: `${ORIGEM}/ntfy`,
});

// ---------------------------------------------------------------- site + proxy
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

function destino(caminho) {
  if (caminho === '/api/orcamento' || caminho === '/api/orcamento/fotos' || caminho === '/api/catalogo' || caminho.startsWith('/api/conta/')) return PORTA_PAINEL;
  if (caminho === '/painel' || caminho.startsWith('/painel/')) return PORTA_PAINEL;
  if (caminho.startsWith('/api/') || caminho === '/stripe/webhook') return PORTA_PAGAMENTOS;
  return null;
}

function reencaminhar(req, res, porta) {
  const cabecalhos = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-proto': 'http' };
  const p = http.request({ host: '127.0.0.1', port: porta, method: req.method, path: req.url, headers: cabecalhos }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  p.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Serviço ainda a arrancar ou parado. Vê o terminal.');
  });
  // Resposta antes do fim do corpo (ex.: 401/413 nas fotos): o resto do corpo ficava por ler e a
  // ligação keep-alive morria no pedido seguinte (ECONNRESET). Lê-se e deita-se fora, como o Node faz.
  res.on('finish', () => {
    if (!req.complete) { req.unpipe(p); req.resume(); }
  });
  req.pipe(p);
}

async function servirSite(req, res, caminho) {
  if (caminho === '/config.js') {
    // O config.js real aponta para o servidor; aqui troca-se só o mqttUrl.
    const original = await readFile(join(WEB, 'config.js'), 'utf8');
    const local = original.replace(/mqttUrl:\s*"[^"]*"/, `mqttUrl: "ws://localhost:${PORTA_SITE}/mqtt"`);
    res.writeHead(200, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' });
    return res.end(local);
  }
  let ficheiro = normalize(join(WEB, decodeURIComponent(caminho)));
  if (ficheiro !== WEB && !ficheiro.startsWith(WEB + sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (caminho.endsWith('/')) ficheiro = join(ficheiro, 'index.html');
  try {
    const corpo = await readFile(ficheiro);
    res.writeHead(200, { 'content-type': TIPOS[extname(ficheiro).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
}

// "//x" seria lido como outro anfitrião; assim o caminho é sempre só o caminho.
const caminhoDe = (url) => new URL(`${ORIGEM}${url.startsWith('/') ? url : `/${url}`}`).pathname;

const servidor = http.createServer((req, res) => {
  const caminho = caminhoDe(req.url);
  const porta = destino(caminho);
  if (porta) return reencaminhar(req, res, porta);
  servirSite(req, res, caminho).catch(() => { res.writeHead(500); res.end(); });
});

const wss = new WebSocketServer({ noServer: true });
servidor.on('upgrade', (req, socket, cabeca) => {
  const caminho = caminhoDe(req.url);
  if (caminho !== '/mqtt' && !caminho.startsWith('/mqtt/')) return socket.destroy();
  wss.handleUpgrade(req, socket, cabeca, (ws) => broker.handle(createWebSocketStream(ws)));
});

await new Promise((ok) => servidor.listen(PORTA_SITE, '127.0.0.1', ok));

console.log(`
Domus Energia a correr localmente
  Site:           ${ORIGEM}/
  Área de cliente ${ORIGEM}/cliente.html   (qualquer código e palavra-passe entram: o broker local não verifica)
  Simulador:      ${ORIGEM}/simulador.html
  Conta:          ${ORIGEM}/conta.html     (códigos dos emails aparecem aqui, "[email] para ...")
  Painel:         ${ORIGEM}/painel/        (credenciais do CEO em local/dados/local.json)
  MQTT:           mqtt://localhost:${PORTA_MQTT}  e  ws://localhost:${PORTA_SITE}/mqtt
Ctrl+C para parar.
`);

function parar() {
  for (const f of filhos) f.kill();
  servidor.close();
  servidorMqtt.close();
  broker.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
