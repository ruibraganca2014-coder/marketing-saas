// Emails das contas de cliente (email.js): cliente SMTP mínimo contra um servidor SMTP falso em memória
// (AUTH PLAIN e LOGIN, mensagem em base64 UTF-8, 535, STARTTLS exigido, tempo esgotado) e, sem SMTP, o
// email escrito no registo ("[email] para x: código 123456"). A palavra-passe SMTP nunca aparece no registo.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { enviarSmtp, criarCorreio, montarMensagem, enderecoRemetente, htmlDoEmail } from '../src/email.js';
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
    assert.equal(await c.enviar({ para: 'cliente@exemplo.pt', assunto: 'Assunto 777888', texto: 'código 654321', resumo: 'código 654321' }), true);
    const c2 = criarCorreio({ config: { ...config, smtp: smtp(f.porta, { password: 'errada' }) }, registo });
    const mau = await servidorFalso({ falhar535: true });
    abertos.push(mau.srv);
    const c3 = criarCorreio({ config: { ...config, smtp: smtp(mau.porta) }, registo });
    assert.equal(await c3.enviar({ para: 'cliente@exemplo.pt', assunto: 'Assunto 999000', texto: 'x' }), false);
    assert.ok(c2.ligado);
    assert.ok(linhas.some((l) => /não enviado/.test(l)));
    assert.ok(!linhas.join('\n').includes(SENHA_SMTP), 'a palavra-passe SMTP nunca vai para o registo');
    assert.ok(!linhas.join('\n').includes('654321'), 'com SMTP o código não vai para o registo');
    assert.ok(!/777888|999000/.test(linhas.join('\n')), 'com SMTP nem o assunto vai para o registo (também no erro)');
  });

  test('EMAIL_REMETENTE como "Nome <endereço>": envia com o endereço no envelope; inválido fica à vista no arranque', async () => {
    assert.equal(enderecoRemetente('Domus Energia <noreply@exemplo.pt>'), 'noreply@exemplo.pt');
    assert.equal(enderecoRemetente('noreply@exemplo.pt'), 'noreply@exemplo.pt');
    assert.equal(enderecoRemetente(''), '');
    const f = await servidorFalso();
    abertos.push(f.srv);
    const linhas = [];
    const registo = { info: (m) => linhas.push(m), aviso: (m) => linhas.push(m), erro: (m) => linhas.push(m) };
    const c = criarCorreio({ config: { smtp: smtp(f.porta), emailRemetente: 'Domus Energia <noreply@exemplo.pt>' }, registo });
    assert.equal(await c.enviar({ para: 'rui_teste@exemplo.pt', assunto: 'Assunto', texto: 'x' }), true);
    assert.ok(f.sessoes[0].comandos.some((l) => /^MAIL FROM:<noreply@exemplo\.pt>$/i.test(l)), f.sessoes[0].comandos.join(' | '));
    assert.match(f.sessoes[0].dados, /^From: Domus Energia <noreply@exemplo\.pt>\r$/m);
    assert.ok(!linhas.some((l) => /inválido/.test(l)));
    criarCorreio({ config: { smtp: smtp(f.porta), emailRemetente: 'sem arroba' }, registo });
    assert.ok(linhas.some((l) => /EMAIL_REMETENTE inválido/.test(l)));
  });

  test('EMAIL_RESPOSTAS: os emails levam Reply-To para a caixa da empresa; sem ela ou mal escrita, não levam', async () => {
    assert.equal(lerConfig({ EMAIL_RESPOSTAS: ' geral@exemplo.pt ' }).emailRespostas, 'geral@exemplo.pt');
    assert.equal(lerConfig({}).emailRespostas, '');
    const f = await servidorFalso();
    abertos.push(f.srv);
    const linhas = [];
    const registo = { info: (m) => linhas.push(m), aviso: (m) => linhas.push(m), erro: (m) => linhas.push(m) };
    const base = { smtp: smtp(f.porta), emailRemetente: 'noreply@exemplo.pt' };
    const msg = { para: 'cliente@exemplo.pt', assunto: 'Assunto', texto: 'x' };
    assert.equal(await criarCorreio({ config: { ...base, emailRespostas: 'geral@exemplo.pt' }, registo }).enviar({ ...msg, cabecalhos: { 'List-Unsubscribe': '<https://exemplo.pt/sair>' } }), true);
    assert.match(f.sessoes[0].dados, /^Reply-To: <geral@exemplo\.pt>\r$/m);
    assert.match(f.sessoes[0].dados, /^List-Unsubscribe: <https:\/\/exemplo\.pt\/sair>\r$/m, 'os outros cabeçalhos continuam');
    assert.match(f.sessoes[0].dados, /^From: Domus Energia <noreply@exemplo\.pt>\r$/m, 'o remetente não muda');
    assert.equal(await criarCorreio({ config: base, registo }).enviar(msg), true);
    assert.doesNotMatch(f.sessoes[1].dados, /^Reply-To:/m);
    assert.ok(!linhas.some((l) => /EMAIL_RESPOSTAS/.test(l)));
    assert.equal(await criarCorreio({ config: { ...base, emailRespostas: 'geral@exemplo.pt\r\nBcc: mau@exemplo.pt' }, registo }).enviar(msg), true);
    assert.doesNotMatch(f.sessoes[2].dados, /^(Reply-To|Bcc):/m);
    assert.ok(linhas.some((l) => /EMAIL_RESPOSTAS inválido/.test(l)));
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
    // SMTP_SEGURANCA e SMTP_TIMEOUT_MS (também no docker-compose e no .env.example); vazia = pela porta.
    assert.deepEqual([lerConfig({ SMTP_HOST: 'h', SMTP_PORTA: '587', SMTP_SEGURANCA: 'tls', SMTP_TIMEOUT_MS: '5000' }).smtp].map((s) => [s.seguranca, s.timeoutMs])[0], ['tls', 5000]);
    assert.equal(lerConfig({ SMTP_HOST: 'h', SMTP_PORTA: '587', SMTP_SEGURANCA: '' }).smtp.seguranca, 'starttls');
    const compose = readFileSync(new URL('../../servidor/docker-compose.yml', import.meta.url), 'utf8');
    const exemplo = readFileSync(new URL('../../servidor/.env.example', import.meta.url), 'utf8');
    for (const v of ['SMTP_SEGURANCA', 'SMTP_TIMEOUT_MS']) {
      assert.match(compose, new RegExp(`^\\s+${v}: \\$\\{${v}:-`, 'm'), `${v} no docker-compose`);
      assert.match(exemplo, new RegExp(`^${v}=`, 'm'), `${v} no .env.example`);
    }
    const b = lerConfig({});
    assert.equal(b.smtp, null);
    assert.ok(b.avisos.some((x) => /SMTP_HOST/.test(x)));
    assert.ok(!JSON.stringify(a.avisos).includes('p"'), 'avisos sem segredos');
  });
});

describe('layout da empresa nos emails (HTML ao lado do texto)', () => {
  const TEXTO = ['Olá,', '', 'Para entrar na sua conta, escreva este código:', '', '    123456', '', 'O código vale 15 minutos.', '1. Abra o site', '2. Escreva <o código> & entre', '', 'A sua conta: https://exemplo.pt/conta.html', 'Não quero receber estes emails: https://exemplo.pt/sair?t=1&x=2', '', 'Domus Energia'].join('\n');
  /** As partes (descodificadas) de uma mensagem multipart. */
  const partes = (m) => {
    const fronteira = /boundary="([^"]+)"/.exec(m)[1];
    return m.split(`--${fronteira}`).slice(1, -1).map((p) => {
      const [cab, ...corpo] = p.replace(/^\r\n/, '').split('\r\n\r\n');
      return { cab, texto: Buffer.from(corpo.join('').replace(/\r\n/g, ''), 'base64').toString('utf8') };
    });
  };

  test('htmlDoEmail: código em caixa, botão, lista, rodapé da empresa; o texto vai escapado', () => {
    const h = htmlDoEmail({ assunto: 'Código', texto: TEXTO, site: 'https://exemplo.pt', responder: false });
    assert.match(h, /123&nbsp;456/);
    assert.match(h, /<a href="https:\/\/exemplo\.pt\/conta\.html"[^>]*>A sua conta<\/a>/);
    assert.match(h, /<ol[^>]*><li[^>]*>Abra o site<\/li><li[^>]*>Escreva &lt;o código&gt; &amp; entre<\/li><\/ol>/);
    assert.match(h, /href="https:\/\/exemplo\.pt\/sair\?t=1&amp;x=2"/);
    assert.match(h, /<img src="https:\/\/exemplo\.pt\/icones\/icone-192\.png"/);
    assert.match(h, /Estação Nómada, Unipessoal Lda\. · NIPC 519 588 533 · Barcarena, Oeiras/);
    assert.match(h, /Email automático: não responda/);
    assert.equal(h.match(/Domus Energia/g).length, 1, 'a assinatura do fim do texto não se repete');
    assert.match(htmlDoEmail({ texto: 'x', responder: true }), /Pode responder a este email/);
    assert.doesNotMatch(htmlDoEmail({ texto: 'x', site: 'javascript:alert(1)' }), /<img|javascript:/, 'sem site válido não há ícone');
    assert.doesNotMatch(htmlDoEmail({ texto: '<script>x</script>' }), /<script>/);
  });

  test('montarMensagem com html: multipart/alternative com o texto igual e o HTML; sem html fica como era', () => {
    const m = montarMensagem({ de: 'a@b.pt', para: 'c@d.pt', assunto: 'x', texto: TEXTO, html: htmlDoEmail({ texto: TEXTO }) });
    assert.match(m, /^Content-Type: multipart\/alternative; boundary="/m);
    const [t, h] = partes(m);
    assert.match(t.cab, /text\/plain; charset=utf-8/);
    assert.equal(t.texto, TEXTO.replace(/\n/g, '\r\n'));
    assert.match(h.cab, /text\/html; charset=utf-8/);
    assert.match(h.texto, /^<!doctype html>/);
    assert.doesNotMatch(m, /^\./m, 'nenhuma linha começa por "."');
    assert.match(montarMensagem({ de: 'a@b.pt', para: 'c@d.pt', assunto: 'x', texto: 'y' }), /^Content-Type: text\/plain; charset=utf-8\r$/m);
  });

  test('criarCorreio com SMTP manda as duas versões', async () => {
    const f = await servidorFalso();
    const registo = { info() {}, aviso() {}, erro() {} };
    const c = criarCorreio({ config: { smtp: smtp(f.porta), emailRemetente: 'noreply@exemplo.pt', emailRespostas: 'geral@exemplo.pt', siteUrl: 'https://exemplo.pt' }, registo });
    assert.equal(await c.enviar({ para: 'cliente@exemplo.pt', assunto: 'Assunto', texto: TEXTO }), true);
    f.srv.close();
    const [t, h] = partes(f.sessoes[0].dados);
    assert.match(t.texto, /123456/);
    assert.match(h.texto, /Pode responder a este email/);
    assert.match(h.texto, /icones\/icone-192\.png/);
  });
});
