// Ajudas dos testes: painel num diretório temporário (porta aleatória),
// cliente HTTP com cookies e cabeçalhos à escolha, relógio controlável e um
// Mosquitto real com passwd/acl gerados pelo próprio servidor/domus.sh.

import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { lerConfig } from '../src/config.js';
import { criarApp } from '../src/app.js';
import { registoMudo, iso } from '../src/util.js';
import { hashSenha } from '../src/senhas.js';

const execFileP = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
export const DOMUS_SH = join(AQUI, '..', '..', 'servidor', 'domus.sh');
export const ORIGEM = 'https://painel.teste';
export const SENHA = 'senha-de-teste-1';

/** Cabeçalhos de um pedido "do próprio site" (navegador). */
export const DO_SITE = { Origin: ORIGEM, 'Sec-Fetch-Site': 'same-origin' };

/**
 * Painel de teste. `env` acrescenta/substitui variáveis de ambiente; `fetch` simula a API da
 * Anthropic (leitura da foto do quadro). Devolve {url, app, dados, relogio, pedir, entrar, criarUtilizador, fechar}.
 */
export async function iniciarPainel({ env = {}, mqtt = false, dados: dadosDir, fetch } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'domus-painel-'));
  const dados = dadosDir ?? join(dir, 'dados');
  for (const p of ['painel', 'planos', 'pagamentos', 'clientes', 'pedidos-admin']) await mkdir(join(dados, p), { recursive: true });
  const config = lerConfig({
    DADOS_DIR: dados,
    PAINEL_ORIGENS: ORIGEM,
    PUBLIC_DIR: join(dir, 'public'),
    CONFIAR_PROXY: '1',
    PEDIDOS_POLL_MS: '200',
    ...env,
  });
  const relogio = { desvio: 0, agora() { return Date.now() + this.desvio; }, avancar(ms) { this.desvio += ms; } };
  const app = await criarApp({ config, registo: registoMudo, relogio: () => relogio.agora(), mqtt, ...(fetch ? { fetch } : {}) });
  await new Promise((r) => app.servidor.listen(0, '127.0.0.1', r));
  const porta = app.servidor.address().port;
  let ipSeq = 0;

  /**
   * Pedido HTTP. opções: corpo (objeto → JSON; string ou Buffer → tal e qual), cookie,
   * cabecalhos, ip (X-Forwarded-For; por omissão um IP novo por pedido para
   * não tocar nos limites), tipo (Content-Type).
   */
  function pedir(metodo, caminho, { corpo, cookie, cabecalhos, ip, tipo, site = true } = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...(site ? DO_SITE : {}), ...(cabecalhos || {}) };
      if (cookie) h.Cookie = cookie;
      h['X-Forwarded-For'] = ip ?? `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
      let dadosCorpo = null;
      if (corpo !== undefined) {
        dadosCorpo = Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
        h['Content-Type'] = tipo ?? 'application/json';
        h['Content-Length'] = dadosCorpo.length;
      } else if (tipo) {
        h['Content-Type'] = tipo;
      }
      const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: h }, (res) => {
        const partes = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () => {
          const bruto = Buffer.concat(partes);
          const texto = bruto.toString('utf8');
          let json = null;
          try { json = texto ? JSON.parse(texto) : null; } catch { /* não é JSON */ }
          resolve({ estado: res.statusCode, cabecalhos: res.headers, texto, json, bruto });
        });
      });
      req.on('error', reject);
      if (dadosCorpo) req.write(dadosCorpo);
      req.end();
    });
  }

  async function criarUtilizador(papel, email = `${papel}@domus.teste`, { senha = SENHA, nome } = {}) {
    const agora = iso(new Date());
    const r = app.db.prepare('INSERT INTO utilizadores (nome, email, papel, hash, ativo, criado, atualizado) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(nome ?? `${papel} teste`, email, papel, await hashSenha(senha), agora, agora);
    return { id: Number(r.lastInsertRowid), email, papel };
  }

  /** Entra e devolve o cookie ("domus_painel=..."). */
  async function entrar(email, senha = SENHA, opcoes = {}) {
    const r = await pedir('POST', '/painel/api/entrar', { corpo: { email, password: senha }, ...opcoes });
    if (r.estado !== 200) throw new Error(`entrar ${email}: ${r.estado} ${r.texto}`);
    return r.cabecalhos['set-cookie'][0].split(';')[0];
  }

  return {
    dir, dados, config, app, relogio, porta, pedir, criarUtilizador, entrar,
    async fechar() {
      await app.fechar();
      if (!dadosDir) await rm(dir, { recursive: true, force: true });
      else await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Painel com um utilizador de cada papel (com sessão aberta). */
export async function painelComEquipa(opcoes) {
  const p = await iniciarPainel(opcoes);
  const ceo = await p.criarUtilizador('ceo');
  const tecnico = await p.criarUtilizador('tecnico');
  const comercial = await p.criarUtilizador('comercial');
  const cookies = {
    ceo: await p.entrar(ceo.email),
    tecnico: await p.entrar(tecnico.email),
    comercial: await p.entrar(comercial.email),
  };
  return { ...p, u: { ceo, tecnico, comercial }, cookies };
}

/** Espera até `fn()` ser verdadeiro (ou falha ao fim de `ms`). */
export async function esperar(fn, ms = 5000, passo = 50) {
  const fim = Date.now() + ms;
  let ultimo;
  while (Date.now() < fim) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await new Promise((r) => setTimeout(r, passo));
  }
  throw new Error(`tempo esgotado à espera (último: ${JSON.stringify(ultimo)})`);
}

/** Corre o servidor/domus.sh com o ambiente dado. */
export async function domus(env, args, { stdin } = {}) {
  return new Promise((resolve) => {
    const p = execFile(DOMUS_SH, args, { env: { ...process.env, ...env } }, (erro, stdout, stderr) => {
      resolve({ codigo: erro ? (erro.code ?? 1) : 0, stdout, stderr });
    });
    if (stdin !== undefined) p.stdin.end(stdin);
  });
}

// ---------------------------------------------------------------- Mosquitto

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

export const SENHAS_MQTT = { admin: 'admin-senha-1', painel: 'painel-senha-1', joao: 'joao-senha-1', maria: 'maria-senha-1' };

/**
 * Mosquitto temporário (mesmas regras do mosquitto.conf) com o estado criado
 * pelo domus.sh (DOMUS_LOCAL=1): admin, painel, clientes joao e maria.
 */
export async function iniciarMosquitto() {
  const dir = await mkdtemp(join(tmpdir(), 'domus-painel-mq-'));
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
  const exe = process.env.MOSQUITTO || ['/usr/sbin/mosquitto', '/usr/local/sbin/mosquitto'].find((p) => existsSync(p)) || 'mosquitto';
  const proc = spawn(exe, ['-c', join(dir, 'mosquitto.conf')], { stdio: 'ignore' });
  await esperarPorta(porta);
  const env = {
    DOMUS_LOCAL: '1',
    DOMUS_DADOS: join(dir, 'dados'),
    DOMUS_MOSQ_DIR: dir,
    DOMUS_PORTA: String(porta),
    DOMUS_RECARREGAR: `kill -HUP ${proc.pid}`,
    DOMUS_HOST: 'teste.local',
    DOMUS_ENV: '/dev/null',
  };
  const d = async (...args) => {
    try {
      return (await execFileP(DOMUS_SH, args, { env: { ...process.env, ...env } })).stdout;
    } catch (e) {
      throw new Error(`domus.sh ${args.join(' ')}: ${e.stderr || e.message}`);
    }
  };
  await d('admin', SENHAS_MQTT.admin);
  await d('painel-mqtt', SENHAS_MQTT.painel);
  await d('cliente', 'joao', SENHAS_MQTT.joao);
  await d('cliente', 'maria', SENHAS_MQTT.maria);
  return {
    dir, porta, env, url: `mqtt://127.0.0.1:${porta}`, dados: join(dir, 'dados'), domus: d,
    async parar() {
      proc.kill();
      await new Promise((r) => proc.once('exit', r));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
