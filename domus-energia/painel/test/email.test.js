// Emails das contas de cliente (email.js): cliente SMTP mínimo contra um servidor SMTP falso em memória
// (AUTH PLAIN e LOGIN, mensagem em base64 UTF-8, 535, STARTTLS exigido, tempo esgotado) e, sem SMTP, o
// email escrito no registo ("[email] para x: código 123456"). A palavra-passe SMTP nunca aparece no registo.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { enviarSmtp, criarCorreio, montarMensagem } from '../src/email.js';
import { lerConfig } from '../src/config.js';

const SENHA_SMTP = 'segredo-smtp-123';

/** Servidor SMTP falso: `auth` = "PLAIN" | "LOGIN" | "PLAIN LOGIN"; `starttls`: anuncia STARTTLS; `falhar535`; `mudo`. */
function servidorFalso({ auth = 'PLAIN LOGIN', starttls = false, falhar535 = false, mudo = false } = {}) {
  const sessoes = [];
  const srv = net.createServer((s) => {
    const sessao = { comandos: [], dados: '', auth: null };
    sessoes.push(sessao);
    if (mudo) return;   // nunca responde (tempo esgotado)
    let tampao = '';
    let emDados = false;
    let passoLogin = 0;
    const r = (l) => s.write(`${l}\r\n`);
    r('220 falso ESMTP');
    s.on('data', (d) => {
      tampao += d.toString('latin1');
      let i;
      while ((i = tampao.indexOf('\r\n')) >= 0) {
        const l = tampao.slice(0, i);
        tampao = tampao.slice(i + 2);
        if (emDados) {
          if (l === '.') { emDados = false; r('250 2.0.0 aceite'); } else sessao.dados += `${l}\r\n`;
          continue;
        }
        sessao.comandos.push(l);
        if (passoLogin === 1) { sessao.auth = { utilizador: Buffer.from(l, 'base64').toString() }; passoLogin = 2; r('334 UGFzc3dvcmQ6'); continue; }
        if (passoLogin === 2) { sessao.auth.password = Buffer.from(l, 'base64').toString(); passoLogin = 0; r(falhar535 ? '535 5.7.8 autenticacao falhou' : '235 ok'); continue; }
        const [cmd] = l.split(' ');
        switch (cmd.toUpperCase()) {
          case 'EHLO': s.write(`250-falso\r\n${starttls ? '250-STARTTLS\r\n' : ''}250-AUTH ${auth}\r\n250 8BITMIME\r\n`); break;
          case 'AUTH':
            if (/^AUTH PLAIN /i.test(l)) {
              const [, u, pw] = Buffer.from(l.slice(11), 'base64').toString().split('\0');
              sessao.auth = { utilizador: u, password: pw };
              r(falhar535 ? '535 5.7.8 autenticacao falhou' : '235 ok');
            } else { passoLogin = 1; r('334 VXNlcm5hbWU6'); }
            break;
          case 'MAIL': case 'RCPT': r('250 ok'); break;
          case 'DATA': emDados = true; r('354 fim com .'); break;
          case 'QUIT': r('221 adeus'); s.end(); break;
          default: r('502 nao'); break;
        }
      }
    });
    s.on('error', () => {});
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, porta: srv.address().port, sessoes })));
}

const smtp = (porta, extra = {}) => ({ host: '127.0.0.1', porta, utilizador: 'conta@brevo', password: SENHA_SMTP, seguranca: 'nenhuma', timeoutMs: 2000, ...extra });
const MSG = { de: 'nao-responder@domusenergia.pt', para: 'cliente@exemplo.pt', assunto: 'Domus Energia: o seu código é 123456', texto: 'Olá,\n\n    123456\n\nÉ válido 15 minutos.\n.\nfim' };

/** Corpo (base64) da mensagem recebida, descodificado. */
function corpoDe(dados) {
  const [cab, corpo] = dados.split('\r\n\r\n');
  return { cab, texto: Buffer.from(corpo.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

describe('cliente SMTP (servidor falso em memória)', () => {
  const abertos = [];
  after(() => { for (const s of abertos) s.close(); });

  for (const auth of ['PLAIN', 'LOGIN']) {
    test(`envia com AUTH ${auth}: credenciais, envelope e mensagem UTF-8 em base64`, async () => {
      const f = await servidorFalso({ auth });
      abertos.push(f.srv);
      await enviarSmtp(smtp(f.porta), MSG);
      const s = f.sessoes[0];
      assert.deepEqual(s.auth, { utilizador: 'conta@brevo', password: SENHA_SMTP });
      assert.ok(s.comandos.includes('MAIL FROM:<nao-responder@domusenergia.pt>'));
      assert.ok(s.comandos.includes('RCPT TO:<cliente@exemplo.pt>'));
      const { cab, texto } = corpoDe(s.dados);
      const assunto = /^Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/m.exec(cab);
      assert.ok(assunto, 'assunto com acento em RFC 2047');
      assert.equal(Buffer.from(assunto[1], 'base64').toString('utf8'), MSG.assunto);
      assert.match(cab, /Content-Transfer-Encoding: base64/);
      assert.equal(texto, MSG.texto.replace(/\n/g, '\r\n'));
      assert.ok(s.comandos.includes('QUIT'));
    });
  }

  test('535: erro sem a palavra-passe', async () => {
    const f = await servidorFalso({ auth: 'PLAIN', falhar535: true });
    abertos.push(f.srv);
    await assert.rejects(enviarSmtp(smtp(f.porta), MSG), (e) => /535/.test(e.message) && !e.message.includes(SENHA_SMTP) && !e.message.includes(Buffer.from(`\0conta@brevo\0${SENHA_SMTP}`).toString('base64')));
  });

  test('STARTTLS exigido: servidor sem STARTTLS → recusado antes de enviar a palavra-passe', async () => {
    const f = await servidorFalso({ starttls: false });
    abertos.push(f.srv);
    await assert.rejects(enviarSmtp(smtp(f.porta, { seguranca: 'starttls' }), MSG), /STARTTLS/);
    assert.ok(!f.sessoes[0].comandos.some((c) => /^AUTH/i.test(c)), 'nunca mandou AUTH');
  });

  test('tempo esgotado (servidor mudo) e ligação recusada', async () => {
    const f = await servidorFalso({ mudo: true });
    abertos.push(f.srv);
    const t0 = Date.now();
    await assert.rejects(enviarSmtp(smtp(f.porta, { timeoutMs: 300 }), MSG), /tempo esgotado/);
    assert.ok(Date.now() - t0 < 3000);
    const livre = await new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
    await assert.rejects(enviarSmtp(smtp(livre), MSG), /não foi possível ligar/);
  });

  test('endereços inválidos e cabeçalhos sem quebras de linha (injeção)', async () => {
    await assert.rejects(enviarSmtp(smtp(1), { ...MSG, para: 'x@y\r\nBcc: a@b.pt' }), /inválido/);
    const m = montarMensagem({ ...MSG, assunto: 'Olá\r\nBcc: mau@exemplo.pt' });
    assert.doesNotMatch(m, /^Bcc:/m);
  });

  test('criarCorreio com SMTP: envia, regista sem a palavra-passe; erro não rejeita (vai para o registo)', async () => {
    const f = await servidorFalso();
    abertos.push(f.srv);
    const linhas = [];
    const registo = { info: (m) => linhas.push(m), aviso: (m) => linhas.push(m), erro: (m) => linhas.push(m) };
    const config = { smtp: smtp(f.porta), emailRemetente: 'nao-responder@domusenergia.pt' };
    const c = criarCorreio({ config, registo });
    assert.equal(c.ligado, true);
    assert.equal(await c.enviar({ para: 'cliente@exemplo.pt', assunto: 'A', texto: 'código 654321' }), true);
    const c2 = criarCorreio({ config: { ...config, smtp: smtp(f.porta, { password: 'errada' }) }, registo });
    const mau = await servidorFalso({ falhar535: true });
    abertos.push(mau.srv);
    const c3 = criarCorreio({ config: { ...config, smtp: smtp(mau.porta) }, registo });
    assert.equal(await c3.enviar({ para: 'cliente@exemplo.pt', assunto: 'B', texto: 'x' }), false);
    assert.ok(c2.ligado);
    assert.ok(linhas.some((l) => /não enviado/.test(l)));
    assert.ok(!linhas.join('\n').includes(SENHA_SMTP), 'a palavra-passe SMTP nunca vai para o registo');
    assert.ok(!linhas.join('\n').includes('654321'), 'com SMTP o código não vai para o registo');
  });
});

describe('sem SMTP / modo local', () => {
  test('o email vai para o registo: "[email] para x: código 123456"', async () => {
    const linhas = [];
    const registo = { info: (m) => linhas.push(m), aviso: () => {}, erro: () => {} };
    const c = criarCorreio({ config: { smtp: null, emailRemetente: '' }, registo });
    assert.equal(c.ligado, false);
    await c.enviar({ para: 'x@exemplo.pt', assunto: 'Código', texto: 'código 123456', resumo: 'código 123456 (confirmar o email)' });
    assert.ok(linhas.some((l) => l.startsWith('[email] para x@exemplo.pt: código 123456')));
    // EMAIL_LOCAL=1 ignora o SMTP configurado.
    const local = criarCorreio({ config: { smtp: smtp(1), emailRemetente: '' }, registo, local: true });
    assert.equal(local.ligado, false);
  });

  test('config: SMTP_* e EMAIL_REMETENTE; 465 → TLS direto, 587 → STARTTLS; avisos sem SMTP_HOST', () => {
    const a = lerConfig({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORTA: '587', SMTP_UTILIZADOR: 'u', SMTP_PASSWORD: 'p', EMAIL_REMETENTE: 'nao-responder@domusenergia.pt' });
    assert.equal(a.smtp.seguranca, 'starttls');
    assert.equal(a.smtp.porta, 587);
    assert.equal(a.emailRemetente, 'nao-responder@domusenergia.pt');
    assert.equal(lerConfig({ SMTP_HOST: 'h', SMTP_PORTA: '465' }).smtp.seguranca, 'tls');
    const b = lerConfig({});
    assert.equal(b.smtp, null);
    assert.ok(b.avisos.some((x) => /SMTP_HOST/.test(x)));
    assert.ok(!JSON.stringify(a.avisos).includes('p"'), 'avisos sem segredos');
  });
});
