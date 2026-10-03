// Emails das contas de cliente (códigos de confirmação e de "esqueci a palavra-passe").
// Cliente SMTP mínimo com node:net/node:tls, sem dependências: TLS direto (porta 465) ou STARTTLS
// obrigatório (587/25), AUTH PLAIN ou LOGIN, uma mensagem de texto (UTF-8, base64) por ligação.
// Sem SMTP configurado (e sempre no modo local), o email é escrito no registo do painel:
//   [email] para x@y: código 123456 …
// A palavra-passe SMTP nunca é registada (nem nos erros: só o código e o texto da resposta do servidor); com SMTP
// também não se regista o assunto nem o corpo das mensagens.

import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { RE_EMAIL } from './pedidos.js';

const CRLF = '\r\n';

/** Cabeçalho com texto não-ASCII (RFC 2047, base64 UTF-8); sem quebras de linha (injeção de cabeçalhos). */
function cabecalhoTexto(s) {
  const t = String(s).replace(/[\r\n]+/g, ' ').slice(0, 200);
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`;
}

/**
 * Mensagem RFC 5322 com o corpo em base64 (nenhuma linha começa por "."; sem problemas de 8 bits). `cabecalhos`:
 * cabeçalhos a mais ({nome: valor}; ex.: List-Unsubscribe), só ASCII visível e sem quebras de linha (os outros não entram).
 */
export function montarMensagem({ de, para, assunto, texto, cabecalhos = {}, agora = new Date() }) {
  const dominio = de.split('@')[1] || 'localhost';
  const corpo = Buffer.from(String(texto).replace(/\r?\n/g, CRLF), 'utf8').toString('base64').replace(/.{1,76}/g, (l) => `${l}${CRLF}`);
  return [
    `From: Domus Energia <${de}>`,
    `To: <${para}>`,
    `Subject: ${cabecalhoTexto(assunto)}`,
    `Date: ${agora.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    ...Object.entries(cabecalhos).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k) && /^[ -~]{1,900}$/.test(String(v))).map(([k, v]) => `${k}: ${v}`),
    '',
    corpo,
  ].join(CRLF);
}

/** Ligação SMTP: lê respostas (várias linhas "250-…" até "250 …") e envia comandos. */
function ligacao(socket, timeoutMs) {
  let tampao = '';
  let espera = null;
  let erroFatal = null;
  const respostas = [];
  const linhas = [];
  const alimentar = (d) => {
    tampao += d.toString('latin1');
    let i;
    while ((i = tampao.indexOf('\n')) >= 0) {
      const l = tampao.slice(0, i).replace(/\r$/, '');
      tampao = tampao.slice(i + 1);
      linhas.push(l);
      if (/^\d{3} /.test(l) || /^\d{3}$/.test(l)) {
        respostas.push({ codigo: Number(l.slice(0, 3)), linhas: linhas.splice(0).map((x) => x.slice(4)) });
      }
    }
    if (tampao.length > 64 * 1024) falhar(new Error('resposta SMTP demasiado longa'));
    entregar();
  };
  const falhar = (e) => { erroFatal ??= e; entregar(); };
  const entregar = () => {
    if (!espera) return;
    if (respostas.length) { const w = espera; espera = null; w.ok(respostas.shift()); }
    else if (erroFatal) { const w = espera; espera = null; w.erro(erroFatal); }
  };
  const ligar = (s) => {
    s.on('data', alimentar);
    s.on('error', falhar);
    s.on('close', () => falhar(new Error('ligação SMTP fechada')));
    s.setTimeout(timeoutMs, () => { falhar(new Error('tempo esgotado no servidor SMTP')); s.destroy(); });
  };
  ligar(socket);
  const api = {
    socket,
    /** Espera a próxima resposta; `esperado`: códigos aceites (senão erro com o texto do servidor). */
    ler(esperado) {
      return new Promise((ok, erro) => {
        espera = { ok, erro };
        entregar();
      }).then((r) => {
        if (esperado && !esperado.includes(r.codigo)) throw new Error(`SMTP ${r.codigo} ${r.linhas.join(' ').slice(0, 200)}`);
        return r;
      });
    },
    async comando(linha, esperado) {
      api.socket.write(`${linha}${CRLF}`);
      return api.ler(esperado);
    },
    /** Passa a ligação para TLS (STARTTLS). */
    async tls(servername) {
      socket.removeListener('data', alimentar);
      const seguro = tls.connect({ socket, servername, minVersion: 'TLSv1.2' });
      await new Promise((ok, erro) => { seguro.once('secureConnect', ok); seguro.once('error', erro); });
      api.socket = seguro;
      ligar(seguro);
    },
    fechar() { try { api.socket.end(); } catch { /* já fechada */ } api.socket.destroy(); },
  };
  return api;
}

/**
 * Envia um email por SMTP. `smtp`: {host, porta, utilizador, password, seguranca: "tls"|"starttls"|"nenhuma", timeoutMs}.
 * Lança Error com uma mensagem sem segredos.
 */
export async function enviarSmtp(smtp, { de, para, assunto, texto, cabecalhos }) {
  if (!RE_EMAIL.test(de) || !RE_EMAIL.test(para)) throw new Error('endereço de email inválido');
  const timeoutMs = smtp.timeoutMs ?? 20_000;
  const socket = await new Promise((ok, erro) => {
    const s = smtp.seguranca === 'tls'
      ? tls.connect({ host: smtp.host, port: smtp.porta, servername: smtp.host, minVersion: 'TLSv1.2' })
      : net.connect({ host: smtp.host, port: smtp.porta });
    const t = setTimeout(() => { s.destroy(); erro(new Error('tempo esgotado a ligar ao servidor SMTP')); }, timeoutMs);
    s.once(smtp.seguranca === 'tls' ? 'secureConnect' : 'connect', () => { clearTimeout(t); ok(s); });
    s.once('error', (e) => { clearTimeout(t); erro(new Error(`não foi possível ligar ao servidor SMTP (${e.code || e.message})`)); });
  });
  const c = ligacao(socket, timeoutMs);
  const nome = hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  try {
    await c.ler([220]);
    let ehlo = await c.comando(`EHLO ${nome}`, [250]);
    if (smtp.seguranca === 'starttls') {
      if (!ehlo.linhas.some((l) => /^STARTTLS\b/i.test(l))) throw new Error('o servidor SMTP não oferece STARTTLS (recusado: a palavra-passe iria sem cifra)');
      await c.comando('STARTTLS', [220]);
      await c.tls(smtp.host);
      ehlo = await c.comando(`EHLO ${nome}`, [250]);
    }
    if (smtp.utilizador) {
      const auth = ehlo.linhas.find((l) => /^AUTH\b/i.test(l)) ?? '';
      if (/\bPLAIN\b/i.test(auth)) {
        const cred = Buffer.from(`\0${smtp.utilizador}\0${smtp.password}`, 'utf8').toString('base64');
        await c.comando(`AUTH PLAIN ${cred}`, [235]);
      } else if (/\bLOGIN\b/i.test(auth)) {
        await c.comando('AUTH LOGIN', [334]);
        await c.comando(Buffer.from(smtp.utilizador, 'utf8').toString('base64'), [334]);
        await c.comando(Buffer.from(smtp.password, 'utf8').toString('base64'), [235]);
      } else {
        throw new Error('o servidor SMTP não aceita AUTH PLAIN nem LOGIN');
      }
    }
    await c.comando(`MAIL FROM:<${de}>`, [250]);
    await c.comando(`RCPT TO:<${para}>`, [250, 251]);
    await c.comando('DATA', [354]);
    c.socket.write(`${montarMensagem({ de, para, assunto, texto, cabecalhos })}${CRLF}.${CRLF}`);
    await c.ler([250]);
    await c.comando('QUIT', [221]).catch(() => {});
  } catch (e) {
    // Um "535 autenticação falhou" não traz a palavra-passe; o comando AUTH (com ela) nunca entra na mensagem.
    throw new Error(String(e?.message || e).replace(/AUTH PLAIN \S+/g, 'AUTH PLAIN ***'));
  } finally {
    c.fechar();
  }
}

/**
 * Correio das contas: `enviar({para, assunto, texto, cabecalhos?})` devolve uma Promise que nunca rejeita (o erro vai para o
 * registo). Sem SMTP (ou `local`), escreve o email no registo — é assim que se lê o código no modo local.
 */
export function criarCorreio({ config, registo, local = false }) {
  const smtp = local ? null : config.smtp;
  const de = config.emailRemetente || (config.smtp?.utilizador && RE_EMAIL.test(config.smtp.utilizador) ? config.smtp.utilizador : 'nao-responder@domus.localhost');
  const emCurso = new Set();
  function enviar({ para, assunto, texto, resumo, cabecalhos }) {
    if (!smtp) {
      // Bem visível no terminal/registo (modo local ou sem SMTP): "[email] para x: código 123456".
      registo.info(`[email] para ${para}: ${resumo ?? assunto}`);
      registo.info(`[email] ${assunto}\n${texto}`);
      return Promise.resolve(true);
    }
    // Com SMTP nunca se regista o assunto nem o corpo (podem levar códigos): só o resultado.
    const p = enviarSmtp(smtp, { de, para, assunto, texto, cabecalhos })
      .then(() => { registo.info('email enviado'); return true; })
      .catch((e) => { registo.erro(`email para o cliente não enviado: ${e.message}`); return false; });
    emCurso.add(p);
    p.finally(() => emCurso.delete(p));
    return p;
  }
  return { enviar, ligado: Boolean(smtp), emCurso: () => Promise.allSettled([...emCurso]) };
}
