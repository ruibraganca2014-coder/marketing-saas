// Domus Energia — tudo a correr no computador, sem Docker.
//
// Faz o papel do servidor/docker-compose.yml:
//   http://localhost:8080/         -> site (pasta ../web; o config.js é servido com o MQTT local)
//   ws://localhost:8080/mqtt       -> broker MQTT (aedes, em vez do Mosquitto)
//   mqtt://localhost:1883          -> o mesmo broker, para aparelhos e ferramentas
//   http://localhost:8080/painel/  -> painel da empresa (porta interna 8081)
//   http://localhost:8080/api/...  -> pagamentos (porta interna 8082); /api/orcamento(/fotos), /api/catalogo e
//                                     /api/conta/* (conta de cliente), /api/fotos-remotas* (fotos pelo telemóvel) e
//                                     /api/eletricista/* (eletricistas externos) -> painel
//
// Diferenças para o servidor a sério (é só para desenvolver e testar):
//   - o broker aceita qualquer utilizador e palavra-passe e não tem ACL;
//   - não há ntfy (as notificações do motor falham e ficam no registo);
//   - o ./domus.sh não corre: os pedidos do painel (criar clientes, aparelhos) ficam pendentes;
//   - os emails das contas de cliente (códigos) não saem: aparecem neste terminal, "[painel] [email] para x: código 123456";
//   - os pagamentos do pedido são simulados (docs/PAGAMENTOS-PEDIDO.md): nenhum dinheiro real, nenhuma chave Stripe.
//
// Acesso rápido (testes): só aqui e só neste computador (localhost; pela rede local não), as páginas ganham a barra "Acesso rápido (testes)" (em baixo, à esquerda) para
// entrar sem palavra-passe como CEO, Comercial, Técnico, Cliente de teste 1/2 ou Eletricista de teste. Este lançador passa ACESSO_RAPIDO=1
// ao painel (que só o aceita num ambiente local: painel/src/acesso-rapido.js, docs/SEGURANCA.md) e junta às páginas
// o local/acesso-rapido.js — que não existe em web/ nem em painel/public. ACESSO_RAPIDO=0 npm start desliga.
//
// Outras origens para testar no browser (ex.: http://qc1.localhost:8080): ORIGENS_EXTRA="http://qc1.localhost:8080,..." npm start.
//
// Uso: npm run instalar (uma vez) e depois npm start.

import http from 'node:http';
import { networkInterfaces } from 'node:os';
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
// Rede local (Wi-Fi): o site ouve em todas as interfaces para o telemóvel abrir foto.html pelo QR
// (http://<IP do computador>:8090 — a porta 8080 costuma estar bloqueada na rede por antivírus/firewall, por isso a
// rede local usa outra, PORTA_REDE); essas origens também são aceites pelo painel. REDE_LOCAL=0 desliga.
const REDE_LOCAL = process.env.REDE_LOCAL !== '0';
const PORTA_REDE = Number(process.env.PORTA_REDE || 8090);
// Só endereços de rede privada (o Wi-Fi de casa): o de uma VPN (ex.: 100.x do Tailscale) não é a rede local e, como
// origem, fazia o painel desligar o acesso rápido de testes (painel/src/acesso-rapido.js recusaAcessoRapido).
const IP_PRIVADO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;
const IPS_LOCAIS = REDE_LOCAL ? Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal && IP_PRIVADO.test(a.address)).map((a) => a.address) : [];
const ORIGENS_REDE = IPS_LOCAIS.map((ip) => `http://${ip}:${PORTA_REDE}`);
// Acesso rápido (testes; ver o cabeçalho). ACESSO_RAPIDO=0 desliga.
const ACESSO_RAPIDO = process.env.ACESSO_RAPIDO !== '0';
// Origens aceites pelo painel nos pedidos que alteram dados (CSRF): a do site e as de ORIGENS_EXTRA.
const ORIGENS = [ORIGEM, ...ORIGENS_REDE, ...String(process.env.ORIGENS_EXTRA || '').split(',').map((o) => o.trim()).filter(Boolean)].join(',');

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
  // Acesso rápido (testes): só este lançador põe a variável; o servidor/docker-compose.yml nunca.
  ACESSO_RAPIDO: ACESSO_RAPIDO ? '1' : '0',
  // Eletricistas externos (fase 4, ainda por publicar): só este lançador liga o módulo; o servidor/docker-compose.yml não.
  ELETRICISTAS: process.env.ELETRICISTAS === '0' ? '0' : '1',
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
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

function destino(caminho) {
  if (caminho === '/api/orcamento' || caminho === '/api/orcamento/fotos' || caminho === '/api/catalogo' || caminho.startsWith('/api/conta/') || caminho.startsWith('/api/eletricista/') || caminho.startsWith('/api/fotos-remotas')) return PORTA_PAINEL;
  if (caminho === '/painel' || caminho.startsWith('/painel/')) return PORTA_PAINEL;
  if (caminho.startsWith('/api/') || caminho === '/stripe/webhook') return PORTA_PAGAMENTOS;
  return null;
}

// Acesso rápido (testes): a barra é um script deste lançador, junto ao fim de cada página (menos a foto.html do telemóvel).
// Só neste computador: o pedido vem de 127.0.0.1/::1 e pelo ouvinte de localhost (nunca pelo da rede local).
const daqui = (req) => ACESSO_RAPIDO && req.socket.localPort === PORTA_SITE
  && /^(::1|(::ffff:)?127\.\d+\.\d+\.\d+)$/.test(req.socket.remoteAddress ?? '');
const comAcessoRapido = (html) => {
  const marca = '<script src="/acesso-rapido.js"></script>\n';
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + marca : html.slice(0, i) + marca + html.slice(i);
};

function reencaminhar(req, res, porta) {
  const cabecalhos = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-proto': 'http' };
  const p = http.request({ host: '127.0.0.1', port: porta, method: req.method, path: req.url, headers: cabecalhos }, (r) => {
    // Páginas do painel (index.html): leva a barra do acesso rápido, como as do site.
    if (daqui(req) && porta === PORTA_PAINEL && req.method === 'GET' && r.statusCode === 200 && String(r.headers['content-type']).startsWith('text/html')) {
      const partes = [];
      r.on('data', (b) => partes.push(b));
      r.on('end', () => {
        const corpo = Buffer.from(comAcessoRapido(Buffer.concat(partes).toString('utf8')));
        res.writeHead(200, { ...r.headers, 'content-length': corpo.length });
        res.end(corpo);
      });
      return;
    }
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
    let local = original.replace(/mqttUrl:\s*"[^"]*"/, `mqttUrl: "ws://localhost:${PORTA_SITE}/mqtt"`);
    // O QR das fotos (fotos-remotas.js) usa este endereço quando o site está aberto em localhost.
    if (ORIGENS_REDE[0]) local = local.replace(/^};/m, `  fotosBase: "${ORIGENS_REDE[0]}",
};`);
    res.writeHead(200, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' });
    return res.end(local);
  }
  if (daqui(req) && caminho === '/acesso-rapido.js') {
    res.writeHead(200, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' });
    return res.end(await readFile(join(AQUI, 'acesso-rapido.js')));
  }
  let ficheiro = normalize(join(WEB, decodeURIComponent(caminho)));
  if (ficheiro !== WEB && !ficheiro.startsWith(WEB + sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (caminho.endsWith('/')) ficheiro = join(ficheiro, 'index.html');
  try {
    let corpo = await readFile(ficheiro);
    if (daqui(req) && extname(ficheiro).toLowerCase() === '.html' && !ficheiro.endsWith(`${sep}foto.html`)) corpo = Buffer.from(comAcessoRapido(corpo.toString('utf8')));
    res.writeHead(200, { 'content-type': TIPOS[extname(ficheiro).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  } catch {
    // Como o Caddy (handle_errors): a página web/404.html; sem ela, texto.
    const pagina = await readFile(join(WEB, '404.html')).catch(() => null);
    res.writeHead(404, { 'content-type': pagina ? TIPOS['.html'] : 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : pagina ?? 'Não encontrado');
  }
}

// "//x" seria lido como outro anfitrião; assim o caminho é sempre só o caminho.
const caminhoDe = (url) => new URL(`${ORIGEM}${url.startsWith('/') ? url : `/${url}`}`).pathname;

function atender(req, res) {
  const caminho = caminhoDe(req.url);
  const porta = destino(caminho);
  if (porta) return reencaminhar(req, res, porta);
  servirSite(req, res, caminho).catch(() => { res.writeHead(500); res.end(); });
}
const servidor = http.createServer(atender);

const wss = new WebSocketServer({ noServer: true });
servidor.on('upgrade', (req, socket, cabeca) => {
  const caminho = caminhoDe(req.url);
  if (caminho !== '/mqtt' && !caminho.startsWith('/mqtt/')) return socket.destroy();
  wss.handleUpgrade(req, socket, cabeca, (ws) => broker.handle(createWebSocketStream(ws)));
});

await new Promise((ok) => servidor.listen(PORTA_SITE, '127.0.0.1', ok));
// Segundo ouvinte, só para a rede local (o mesmo site; sem MQTT por WebSocket).
if (REDE_LOCAL) await new Promise((ok) => http.createServer(atender).listen(PORTA_REDE, '0.0.0.0', ok));

console.log(`
Domus Energia a correr localmente
  Site:           ${ORIGEM}/
  Área de cliente ${ORIGEM}/cliente.html   (qualquer código e palavra-passe entram: o broker local não verifica)
  Simulador:      ${ORIGEM}/simulador.html
  Conta:          ${ORIGEM}/conta.html     (códigos dos emails aparecem aqui, "[email] para ...")
  Eletricistas:   ${ORIGEM}/trabalhe-connosco.html (candidatura)  e  ${ORIGEM}/eletricista.html (área do eletricista)
  Painel:         ${ORIGEM}/painel/        (credenciais do CEO em local/dados/local.json)
  Acesso rápido:  ${ACESSO_RAPIDO ? 'ligado — barra "Acesso rápido (testes)" em baixo, à esquerda: entra sem palavra-passe; só neste computador, não pela rede local (ACESSO_RAPIDO=0 desliga)' : 'desligado (ACESSO_RAPIDO=0)'}
  MQTT:           mqtt://localhost:${PORTA_MQTT}  e  ws://localhost:${PORTA_SITE}/mqtt
  Casa de teste:  ${process.env.APARELHOS !== '0' ? `${ORIGEM}/cliente.html com o código "demo" (8 aparelhos simulados; APARELHOS=0 desliga)` : 'desligada (APARELHOS=0)'}
  Rede local:     ${ORIGENS_REDE.join('  ') || '(desligada)'}   (telemóvel no mesmo Wi-Fi; QR das fotos; REDE_LOCAL=0 desliga)
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

// Aparelhos simulados (decisão do dono, 2026-10-09): a casa "demo" arranca com o lançador, para a área de cliente e a
// ativação de aparelhos se poderem experimentar sem mais nada. APARELHOS=0 desliga.
if (process.env.APARELHOS !== '0') {
  const sim = spawn(process.execPath, [join(AQUI, 'aparelhos-simulados.js'), 'demo'], { cwd: AQUI, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] });
  sim.stdout.on('data', (b) => process.stdout.write(String(b)));
  sim.stderr.on('data', (b) => process.stderr.write(String(b)));
  filhos.push(sim);
}
process.on('SIGTERM', parar);
