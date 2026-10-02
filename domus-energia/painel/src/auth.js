// Autenticação do painel: sessões na SQLite (o cookie só leva um token
// aleatório de 32 bytes; a base de dados guarda o SHA-256 dele), limite de
// tentativas por IP e por email e bloqueio depois de falhas seguidas.

import { randomBytes, createHash } from 'node:crypto';
import { LimiteTaxa } from './limite.js';
import { hashSenha, verificarSenha } from './senhas.js';
import { ErroApi, lerCookies } from './http.js';
import { iso } from './util.js';

export const COOKIE = 'domus_painel';
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RENOVAR_MS = 60_000;

const sha = (t) => createHash('sha256').update(t).digest('hex');

export class Autenticacao {
  constructor({ db, config, registo, relogio = () => Date.now() }) {
    this.db = db;
    this.config = config;
    this.registo = registo;
    this.relogio = relogio;
    this.porIp = new LimiteTaxa(config.limiteLogin, 60_000, relogio);
    this.porEmail = new LimiteTaxa(config.limiteLogin, 60_000, relogio);
    this.limpeza = setInterval(() => this.limpar(), 10 * 60_000);
    this.limpeza.unref();
  }

  fechar() {
    clearInterval(this.limpeza);
  }

  limpar() {
    this.porIp.limpar();
    this.porEmail.limpar();
    const agora = this.relogio();
    this.db.prepare('DELETE FROM sessoes WHERE expira < ? OR criada < ?').run(agora, agora - this.config.sessaoMaxMs);
    this.db.prepare('DELETE FROM falhas_login WHERE (bloqueado_ate IS NULL OR bloqueado_ate < ?) AND falhas = 0').run(agora);
  }

  cookie(token, maxAgeS) {
    return `${COOKIE}=${token}; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeS}`;
  }

  cookieApagar() {
    return `${COOKIE}=; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  }

  /** Verifica as credenciais; devolve {token, utilizador} ou lança ErroApi. */
  async entrar(email, senha, ip) {
    const e = email.trim().toLowerCase();
    const espera = Math.max(this.porIp.espera(ip), this.porEmail.espera(e));
    if (espera) {
      this.registo.aviso(`entrar: demasiadas tentativas (ip ${ip})`);
      throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${espera} s.`, { 'Retry-After': String(espera) });
    }
    this.porIp.registar(ip);
    this.porEmail.registar(e);
    const agora = this.relogio();
    const falhas = this.db.prepare('SELECT falhas, bloqueado_ate FROM falhas_login WHERE email = ?').get(e);
    if (falhas?.bloqueado_ate && falhas.bloqueado_ate > agora) {
      const s = Math.ceil((falhas.bloqueado_ate - agora) / 1000);
      throw new ErroApi(429, `Conta bloqueada temporariamente depois de várias tentativas falhadas. Tente de novo dentro de ${Math.ceil(s / 60)} min.`, { 'Retry-After': String(s) });
    }
    const u = this.db.prepare('SELECT * FROM utilizadores WHERE email = ?').get(e);
    const ok = await verificarSenha(senha, u?.hash);
    if (!ok || !u || !u.ativo) {
      const n = (falhas?.falhas ?? 0) + 1;
      if (n >= this.config.falhasBloqueio) {
        this.db.prepare(`INSERT INTO falhas_login (email, falhas, bloqueado_ate) VALUES (?, 0, ?)
          ON CONFLICT(email) DO UPDATE SET falhas = 0, bloqueado_ate = excluded.bloqueado_ate`).run(e, agora + this.config.bloqueioMs);
        this.registo.aviso(`entrar: ${n} falhas seguidas, bloqueado 15 min (ip ${ip})`);
        if (u) this.auditar?.(null, 'conta_bloqueada', `utilizador:${u.id}`, { email: u.email }, ip);
      } else {
        this.db.prepare(`INSERT INTO falhas_login (email, falhas, bloqueado_ate) VALUES (?, ?, NULL)
          ON CONFLICT(email) DO UPDATE SET falhas = excluded.falhas, bloqueado_ate = NULL`).run(e, n);
      }
      throw new ErroApi(401, 'Email ou palavra-passe errados.');
    }
    this.db.prepare('DELETE FROM falhas_login WHERE email = ?').run(e);
    return { token: this.abrirSessao(u.id), utilizador: u };
  }

  /** Sessão nova para o utilizador (já verificado por quem chama); devolve o token do cookie. */
  abrirSessao(uid) {
    const token = randomBytes(32).toString('base64url');
    const agora = this.relogio();
    this.db.prepare('INSERT INTO sessoes (id, utilizador_id, criada, expira, renovada) VALUES (?, ?, ?, ?, ?)')
      .run(sha(token), uid, agora, agora + this.config.sessaoMs, agora);
    return token;
  }

  /** Utilizador da sessão do pedido (ou null). Renova a sessão (e o cookie). */
  sessao(req, res) {
    const token = lerCookies(req)[COOKIE];
    if (!token || !RE_TOKEN.test(token)) return null;
    const id = sha(token);
    const agora = this.relogio();
    const s = this.db.prepare(`SELECT s.*, u.id AS uid, u.nome, u.email, u.papel, u.ativo
      FROM sessoes s JOIN utilizadores u ON u.id = s.utilizador_id WHERE s.id = ?`).get(id);
    if (!s) return null;
    if (s.expira <= agora || s.criada + this.config.sessaoMaxMs <= agora || !s.ativo) {
      this.db.prepare('DELETE FROM sessoes WHERE id = ?').run(id);
      return null;
    }
    if (agora - s.renovada >= RENOVAR_MS) {
      const expira = Math.min(agora + this.config.sessaoMs, s.criada + this.config.sessaoMaxMs);
      this.db.prepare('UPDATE sessoes SET expira = ?, renovada = ? WHERE id = ?').run(expira, agora, id);
      res?.setHeader('Set-Cookie', this.cookie(token, Math.max(1, Math.floor((expira - agora) / 1000))));
    }
    return { id: s.uid, nome: s.nome, email: s.email, papel: s.papel, sessao: id, sessaoExpira: iso(s.expira) };
  }

  sair(req) {
    const token = lerCookies(req)[COOKIE];
    if (token && RE_TOKEN.test(token)) this.db.prepare('DELETE FROM sessoes WHERE id = ?').run(sha(token));
  }

  terminarSessoes(uid) {
    this.db.prepare('DELETE FROM sessoes WHERE utilizador_id = ?').run(uid);
  }

  /** Primeiro arranque: PAINEL_CEO_EMAIL + PAINEL_CEO_PASS criam o CEO se não houver utilizadores. */
  async criarPrimeiroCeo() {
    const { ceoEmail, ceoPass } = this.config;
    if (!ceoEmail || !ceoPass) return false;
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM utilizadores').get().n;
    if (n > 0) {
      this.registo.aviso('PAINEL_CEO_EMAIL/PAINEL_CEO_PASS ignorados: já há utilizadores (retire-os do .env)');
      return false;
    }
    const agora = iso(this.relogio());
    this.db.prepare('INSERT INTO utilizadores (nome, email, papel, hash, ativo, criado, atualizado) VALUES (?, ?, \'ceo\', ?, 1, ?, ?)')
      .run(ceoEmail.split('@')[0], ceoEmail.trim().toLowerCase(), await hashSenha(ceoPass), agora, agora);
    this.registo.info(`primeiro CEO criado (${ceoEmail}); retire PAINEL_CEO_PASS do .env`);
    return true;
  }
}
