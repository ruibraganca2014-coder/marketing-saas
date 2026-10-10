// Emails das contas de cliente (códigos de confirmação e de "esqueci a palavra-passe").
// Cliente SMTP mínimo com node:net/node:tls, sem dependências: TLS direto (porta 465) ou STARTTLS
// obrigatório (587/25), AUTH PLAIN ou LOGIN, uma mensagem (texto e HTML com o layout da empresa, UTF-8, base64) por ligação.
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

// ---------------------------------------------------------------- layout da empresa (decisão do dono, 2026-10-10)
// Todos os emails (códigos, automáticos, eletricistas, equipa) saem com o mesmo aspeto: faixa verde com o ícone e o
// nome, corpo creme, botões verdes e rodapé com a empresa. Quem os escreve continua a escrever só o texto: o HTML
// faz-se aqui a partir dele (htmlDoEmail) e segue ao lado do texto (multipart/alternative), para os programas de email
// que não mostram HTML. Cores do tema do site; tabelas e estilos na própria etiqueta, como os emails pedem.
const COR = { musgo: '#606C38', floresta: '#283618', creme: '#FEFAE0', papel: '#FFFDF0', areia: '#DDA15E', argila: '#9A5518', suave: '#5C6446', borda: '#E6E0BF' };
const EMPRESA = { marca: 'Domus Energia', nome: 'Estação Nómada, Unipessoal Lda.', nipc: '519 588 533', local: 'Barcarena, Oeiras', telefone: '968 728 723' };
const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RE_URL = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)]/g;
const LETRA = 'Arial,Helvetica,sans-serif';
/** Texto de uma linha: escapado, com os endereços a virar ligações. */
function linhaHtml(t) {
  let r = '', i = 0;
  for (const m of String(t).matchAll(RE_URL)) {
    r += `${escapar(t.slice(i, m.index))}<a href="${escapar(m[0])}" style="color:${COR.argila};">${escapar(m[0])}</a>`;
    i = m.index + m[0].length;
  }
  return r + escapar(String(t).slice(i));
}
const botaoHtml = (rotulo, url) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="background:${COR.musgo};border-radius:999px;">`
  + `<a href="${escapar(url)}" style="display:inline-block;padding:12px 24px;font:bold 15px ${LETRA};color:${COR.creme};text-decoration:none;">${escapar(rotulo)}</a></td></tr></table>`;
/**
 * O HTML de um email a partir do texto dele. Reconhece: o código (uma linha recuada só com 4 a 8 algarismos) → caixa
 * grande; "Rótulo: https://…" numa linha → botão (o de "não quero receber" fica uma ligação pequena); listas "1. …" e
 * "- …"; o resto, parágrafos. A assinatura "Domus Energia" do fim do texto não se repete (está no topo e no rodapé).
 * `site`: endereço do site (ícone e rodapé); `responder`: há caixa de respostas (Reply-To)?
 */
export function htmlDoEmail({ assunto = '', texto = '', site = '', responder = false } = {}) {
  const linhas = String(texto).replace(/\r/g, '').split('\n');
  while (linhas.length && !linhas.at(-1).trim()) linhas.pop();
  if (linhas.at(-1)?.trim() === EMPRESA.marca) linhas.pop();
  const partes = [];
  let par = [], lista = null;
  const P = `margin:0 0 14px;font:16px/1.5 ${LETRA};color:${COR.floresta};`;
  const fecharPar = () => { if (par.length) partes.push(`<p style="${P}">${par.map(linhaHtml).join('<br>')}</p>`); par = []; };
  const fecharLista = () => {
    if (lista) partes.push(`<${lista.tipo} style="margin:0 0 14px;padding-left:22px;font:16px/1.5 ${LETRA};color:${COR.floresta};">${lista.itens.map((x) => `<li style="margin:0 0 6px;">${linhaHtml(x)}</li>`).join('')}</${lista.tipo}>`);
    lista = null;
  };
  for (const bruta of linhas) {
    const l = bruta.trim();
    if (!l) { fecharPar(); fecharLista(); continue; }
    const codigo = /^\s{2,}(\d{4,8})\s*$/.exec(bruta)?.[1];
    const numerado = /^\d{1,2}[.)]\s+(.+)$/.exec(l);
    const ponto = /^[-•]\s+(.+)$/.exec(l);
    const botao = /^(.{2,70}?):\s*(https?:\/\/\S+)$/.exec(l);
    if (codigo) {
      fecharPar(); fecharLista();
      partes.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="background:${COR.creme};border:2px solid ${COR.musgo};border-radius:14px;padding:14px 28px;font:bold 30px 'Courier New',Courier,monospace;letter-spacing:3px;color:${COR.floresta};">${codigo}</td></tr></table>`);
    } else if (numerado || ponto) {
      fecharPar();
      const tipo = numerado ? 'ol' : 'ul';
      if (lista && lista.tipo !== tipo) fecharLista();
      lista ??= { tipo, itens: [] };
      lista.itens.push((numerado ?? ponto)[1]);
    } else if (botao && /não quer|deixar de receber/i.test(botao[1])) {
      fecharPar(); fecharLista();
      partes.push(`<p style="margin:0 0 14px;font:13px/1.5 ${LETRA};color:${COR.suave};"><a href="${escapar(botao[2])}" style="color:${COR.suave};">${escapar(botao[1])}</a></p>`);
    } else if (botao) {
      fecharPar(); fecharLista();
      partes.push(botaoHtml(botao[1], botao[2]));
    } else { fecharLista(); par.push(l); }
  }
  fecharPar(); fecharLista();
  const base = /^https:\/\/[^\s"'<>]+$/.test(site) ? site.replace(/\/+$/, '') : '';
  const icone = base ? `<td style="padding-right:12px;"><img src="${escapar(base)}/icones/icone-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;"></td>` : '';
  const sitio = base ? ` · <a href="${escapar(base)}" style="color:${COR.suave};">${escapar(base.replace(/^https:\/\//, ''))}</a>` : '';
  const R = `margin:0 0 4px;font:12px/1.5 ${LETRA};color:${COR.suave};`;
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(assunto)}</title></head>`
    + `<body style="margin:0;padding:0;background:${COR.creme};">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.creme};"><tr><td align="center" style="padding:20px 12px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COR.papel};border:1px solid ${COR.borda};border-radius:16px;overflow:hidden;">`
    + `<tr><td style="background:${COR.musgo};padding:16px 24px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${icone}`
    + `<td style="font:bold 20px Georgia,'Times New Roman',serif;color:${COR.creme};">Domus <span style="color:${COR.areia};">Energia</span></td></tr></table></td></tr>`
    + `<tr><td style="padding:26px 24px 12px;">${partes.join('')}</td></tr>`
    + `<tr><td style="padding:16px 24px 20px;border-top:1px solid ${COR.borda};">`
    + `<p style="${R}"><strong>${EMPRESA.marca}</strong> · ${escapar(EMPRESA.nome)} · NIPC ${EMPRESA.nipc} · ${escapar(EMPRESA.local)}</p>`
    + `<p style="${R}">${EMPRESA.telefone}${sitio}</p>`
    + `<p style="${R}margin:8px 0 0;">${responder ? 'Pode responder a este email: a resposta chega à nossa equipa.' : 'Email automático: não responda a esta mensagem. Para falar connosco, ligue ou use o site.'}</p>`
    + `</td></tr></table></td></tr></table></body></html>`;
}
const base64Linhas = (t) => Buffer.from(String(t).replace(/\r?\n/g, CRLF), 'utf8').toString('base64').replace(/.{1,76}/g, (l) => `${l}${CRLF}`);

/**
 * Mensagem RFC 5322 com o corpo em base64 (nenhuma linha começa por "."; sem problemas de 8 bits). `cabecalhos`:
 * cabeçalhos a mais ({nome: valor}; ex.: List-Unsubscribe), só ASCII visível e sem quebras de linha (os outros não entram).
 * Com `html`, a mensagem leva as duas versões (multipart/alternative: o texto primeiro, o HTML depois).
 */
export function montarMensagem({ de, para, assunto, texto, html = null, cabecalhos = {}, agora = new Date() }) {
  const dominio = de.split('@')[1] || 'localhost';
  const fronteira = `=_domus_${randomBytes(12).toString('hex')}`;
  const parte = (tipo, t) => [`Content-Type: ${tipo}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', base64Linhas(t)];
  return [
    `From: Domus Energia <${de}>`,
    `To: <${para}>`,
    `Subject: ${cabecalhoTexto(assunto)}`,
    `Date: ${agora.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
    ...(html ? [`Content-Type: multipart/alternative; boundary="${fronteira}"`] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64']),
    'Auto-Submitted: auto-generated',
    ...Object.entries(cabecalhos).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k) && /^[ -~]{1,900}$/.test(String(v))).map(([k, v]) => `${k}: ${v}`),
    '',
    ...(html ? [`--${fronteira}`, ...parte('text/plain', texto), `--${fronteira}`, ...parte('text/html', html), `--${fronteira}--`, ''] : [base64Linhas(texto)]),
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
export async function enviarSmtp(smtp, { de, para, assunto, texto, html, cabecalhos }) {
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
    c.socket.write(`${montarMensagem({ de, para, assunto, texto, html, cabecalhos })}${CRLF}.${CRLF}`);
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
/**
 * O endereço de um remetente escrito como "Nome <endereco@dominio>" (o formato habitual do EMAIL_REMETENTE); um
 * endereço simples fica igual. O nome à vista é sempre "Domus Energia" (montarMensagem).
 */
export const enderecoRemetente = (s) => (/<\s*([^<>\s]+)\s*>\s*$/.exec(String(s ?? ''))?.[1] ?? String(s ?? '')).trim();

export function criarCorreio({ config, registo, local = false }) {
  const smtp = local ? null : config.smtp;
  const de = enderecoRemetente(config.emailRemetente) || (config.smtp?.utilizador && RE_EMAIL.test(config.smtp.utilizador) ? config.smtp.utilizador : 'nao-responder@domus.localhost');
  // Um remetente mal escrito fazia falhar todos os envios sem ninguém dar por isso: fica à vista no arranque.
  if (smtp && !RE_EMAIL.test(de)) registo.erro('EMAIL_REMETENTE inválido: nenhum email vai ser enviado (use nome@dominio ou "Nome <nome@dominio>")');
  // EMAIL_RESPOSTAS: a caixa que a empresa lê. Com ela, "Responder" no email do cliente vai para lá (Reply-To) e não
  // para o remetente (que pode ser um "noreply"). Mal escrita: ignorada, com o erro à vista no arranque.
  const respostas = enderecoRemetente(config.emailRespostas);
  if (respostas && !RE_EMAIL.test(respostas)) registo.erro('EMAIL_RESPOSTAS inválido: ignorado (use nome@dominio); as respostas dos clientes vão para o remetente');
  const responderPara = RE_EMAIL.test(respostas) ? { 'Reply-To': `<${respostas}>` } : {};
  const emCurso = new Set();
  // Sem SMTP o código não chega a ninguém: o último de cada email fica em memória para o acesso rápido de testes o
  // mostrar no ecrã (acesso-rapido.js ROTA_CODIGO, só no lançador local). Com SMTP nunca se guarda.
  const ultimos = new Map();
  function enviar({ para, assunto, texto, resumo, cabecalhos }) {
    if (!smtp) {
      const codigo = /^código (\d{6})\b/.exec(resumo ?? '')?.[1];
      if (codigo) { const k = String(para).trim().toLowerCase(); ultimos.delete(k); ultimos.set(k, { codigo, quando: Date.now() }); if (ultimos.size > 50) ultimos.delete(ultimos.keys().next().value); }
      // Bem visível no terminal/registo (modo local ou sem SMTP): "[email] para x: código 123456".
      registo.info(`[email] para ${para}: ${resumo ?? assunto}`);
      registo.info(`[email] ${assunto}\n${texto}`);
      return Promise.resolve(true);
    }
    // Com SMTP nunca se regista o assunto nem o corpo (podem levar códigos): só o resultado.
    const html = htmlDoEmail({ assunto, texto, site: config.siteUrl, responder: 'Reply-To' in responderPara });
    const p = enviarSmtp(smtp, { de, para, assunto, texto, html, cabecalhos: { ...responderPara, ...cabecalhos } })
      .then(() => { registo.info('email enviado'); return true; })
      .catch((e) => { registo.erro(`email para o cliente não enviado: ${e.message}`); return false; });
    emCurso.add(p);
    p.finally(() => emCurso.delete(p));
    return p;
  }
  /** O último código que ficou só no registo (sem SMTP) para o email `para`, se tem menos de 15 minutos; senão null. */
  const ultimoCodigo = (para) => {
    const u = ultimos.get(String(para ?? '').trim().toLowerCase());
    return u && Date.now() - u.quando < 15 * 60_000 ? u.codigo : null;
  };
  return { enviar, ligado: Boolean(smtp), ultimoCodigo, emCurso: () => Promise.allSettled([...emCurso]) };
}
