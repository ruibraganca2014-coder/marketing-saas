// Ajudas dos testes: Mosquitto real (com passwd e acl gerados pelo próprio
// servidor/domus.sh), Stripe falso ao nível HTTP e leitura de mensagens retidas.

import { spawn, execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { promisify } from 'node:util';
import mqtt from 'mqtt';

const execFileP = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
export const DOMUS_SH = join(AQUI, '..', '..', 'servidor', 'domus.sh');

export const SENHAS = {
  admin: 'admin-senha-1',
  pagamentos: 'pagamentos-senha-1',
  joao: 'joao-senha-1',
  maria: 'maria-senha-1',
  'joao-sala': 'sala-senha-1',
};

export const PRECOS = { base: 'price_base1', conforto: 'price_conforto1', premium: 'price_premium1' };
export const WEBHOOK_SEGREDO = 'whsec_testesegredo123';

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function binario(nome, alternativas) {
  for (const p of alternativas) if (existsSync(p)) return p;
  return nome;
}

/**
 * Arranca um Mosquitto temporário e cria, com o domus.sh (DOMUS_LOCAL=1),
 * admin, pagamentos, os clientes joao e maria e o aparelho joao-sala.
 */
export async function iniciarMosquitto() {
  const dir = await mkdtemp(join(tmpdir(), 'domus-pag-'));
  const porta = await portaLivre();
  await writeFile(join(dir, 'passwd'), '', { mode: 0o600 });
  await writeFile(join(dir, 'acl'), '', { mode: 0o600 });
  await writeFile(join(dir, 'mosquitto.conf'), [
    'per_listener_settings false',
    `user ${userInfo().username}`,
    'allow_anonymous false',
    `password_file ${dir}/passwd`,
    `acl_file ${dir}/acl`,
    'persistence false',
    `listener ${porta} 127.0.0.1`,
    `log_dest file ${dir}/mosquitto.log`,
    'log_type all',
    '',
  ].join('\n'));
  const exe = process.env.MOSQUITTO || binario('mosquitto', ['/usr/sbin/mosquitto', '/usr/local/sbin/mosquitto']);
  const proc = spawn(exe, ['-c', join(dir, 'mosquitto.conf')], { stdio: 'ignore' });
  await esperarPorta(porta);

  const env = {
    ...process.env,
    DOMUS_LOCAL: '1',
    DOMUS_DADOS: join(dir, 'dados'),
    DOMUS_MOSQ_DIR: dir,
    DOMUS_PORTA: String(porta),
    DOMUS_RECARREGAR: `kill -HUP ${proc.pid}`,
    DOMUS_HOST: 'teste.local',
    DOMUS_ENV: '/dev/null',
  };
  const domus = async (...args) => {
    try {
      return (await execFileP(DOMUS_SH, args, { env })).stdout;
    } catch (e) {
      throw new Error(`domus.sh ${args.join(' ')}: ${e.stderr || e.message}`);
    }
  };
  await domus('admin', SENHAS.admin);
  await domus('pagamentos', SENHAS.pagamentos);
  await domus('cliente', 'joao', SENHAS.joao);
  await domus('cliente', 'maria', SENHAS.maria);
  await domus('aparelho', 'joao', 'sala', 'openbeken', 'Sala', SENHAS['joao-sala']);

  return {
    dir,
    porta,
    url: `mqtt://127.0.0.1:${porta}`,
    dados: join(dir, 'dados'),
    domus,
    async parar() {
      proc.kill();
      await new Promise((r) => proc.once('exit', r));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function esperarPorta(porta, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const ok = await new Promise((r) => {
      const s = net.connect(porta, '127.0.0.1', () => { s.end(); r(true); });
      s.on('error', () => r(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('o Mosquitto não arrancou');
}

/** Lê a mensagem retida de um tópico (ou null). */
export function lerRetida(url, utilizador, topico, ms = 1500) {
  return new Promise((resolve, reject) => {
    const cli = mqtt.connect(url, {
      username: utilizador, password: SENHAS[utilizador], reconnectPeriod: 0, clientId: `leitor-${Math.random()}`,
    });
    const t = setTimeout(() => { cli.end(true); resolve(null); }, ms);
    cli.on('error', (e) => { clearTimeout(t); cli.end(true); reject(e); });
    cli.on('message', (tp, m, pk) => {
      if (tp !== topico) return;
      clearTimeout(t);
      cli.end(true);
      resolve({ texto: m.toString(), retida: pk.retain });
    });
    cli.on('connect', () => cli.subscribe(topico, { qos: 1 }));
  });
}

/** Espera até `fn()` devolver algo verdadeiro. */
export async function esperar(fn, ms = 3000) {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fim) throw new Error('tempo esgotado à espera');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Stripe falso ao nível HTTP (o SDK oficial fala com ele via host/port/protocol).
 * Guarda os pedidos; as subscrições devolvidas estão em `subs`.
 */
export async function iniciarStripeFalso() {
  const pedidos = [];
  const subs = new Map();
  const recusarFluxos = new Set(); // flow_data[type] que o portal "não tem ativos"
  let n = 0;
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const params = Object.fromEntries(new URLSearchParams(corpo));
      pedidos.push({ metodo: req.method, caminho: url.pathname, params, auth: req.headers.authorization });
      const json = (estado, o) => {
        res.writeHead(estado, { 'Content-Type': 'application/json', 'Request-Id': `req_${++n}` });
        res.end(JSON.stringify(o));
      };
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        return json(200, { id: `cs_test_${n}`, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/cs_test_${n}` });
      }
      if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
        if (recusarFluxos.has(params['flow_data[type]'])) {
          return json(400, { error: { type: 'invalid_request_error', message: 'This feature is not enabled in the portal configuration' } });
        }
        return json(200, { id: `bps_${n}`, object: 'billing_portal.session', url: `https://billing.stripe.com/p/session/test_${n}` });
      }
      const m = /^\/v1\/subscriptions\/([A-Za-z0-9_]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const s = subs.get(m[1]);
        if (s) return json(200, s);
        return json(404, { error: { type: 'invalid_request_error', message: 'No such subscription' } });
      }
      return json(404, { error: { type: 'invalid_request_error', message: `Rota falsa desconhecida ${url.pathname}` } });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    porta: srv.address().port,
    pedidos,
    subs,
    recusarFluxos,
    opcoes() {
      return { host: '127.0.0.1', port: srv.address().port, protocol: 'http', maxNetworkRetries: 0 };
    },
    parar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }),
  };
}

/** Subscrição no formato da API atual (período nos itens). */
export function subscricao({ id = 'sub_1', cliente = 'joao', status = 'active', preco = PRECOS.conforto,
  fim = 1_790_000_000, trialEnd = null, customer = 'cus_1', cancelAtPeriodEnd = false } = {}) {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    metadata: cliente ? { cliente } : {},
    trial_end: trialEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: null,
    items: { object: 'list', data: [{ id: `si_${id}`, object: 'subscription_item', price: { id: preco, object: 'price' }, current_period_end: fim }] },
  };
}

/** Evento Stripe e o cabeçalho Stripe-Signature correspondente. */
export function eventoAssinado(stripe, evento, segredo = WEBHOOK_SEGREDO) {
  const payload = JSON.stringify({ object: 'event', api_version: '2026-08-26.dahlia', created: 1_790_000_000, livemode: false, ...evento });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: segredo });
  return { payload, header };
}

export async function lerTexto(caminho) {
  try {
    return await readFile(caminho, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
