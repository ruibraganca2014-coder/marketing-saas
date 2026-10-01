// Fotos pelo telemóvel (QR; docs/SIMULADOR-ORCAMENTO.md §0 "Fotos pelo telemóvel (QR)" e §6.2): no computador, o
// botão "Tirar foto" do simulador mostra um QR; o telemóvel abre web/foto.html, tira a foto e envia-a para aqui; o
// computador vai buscá-la (sondagem) e guarda-a como se fosse local. Só fotos: nada do resto da simulação passa por
// aqui. Um token por simulação (`sim` = o `fotosId` do simulador), 24 h, 32 bytes aleatórios em base64url; na base
// de dados só o SHA-256. As fotos ficam em FOTOS_DIR/remotas/<hash[0:16]>/<id>.jpg|png até o computador as apagar
// (depois de as receber) ou até o token expirar (limpeza de 15 em 15 min). Mesmas validações de fotos.js.

import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, lerCorpo, lerJson, responder, verificarOrigemPublica } from './http.js';
import { escreverAtomico, iso } from './util.js';
import { FOTOS_MAX, FOTO_MAX_BYTES, RE_CHAVE_FOTO, bytesDeImagem } from './fotos.js';

export const TOKEN_REMOTO_MS = 24 * 3600_000;    // validade do token (e da foto no servidor)
export const LIMPEZA_MS = 15 * 60_000;
export const CHAVES_MAX = FOTOS_MAX;             // chaves (fotos) por token
export const RE_SIM = /^[a-f0-9]{8,40}$/;        // estado.fotosId do simulador
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const ROTULO_MAX = 120;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * @param {{db, config, registo, relogio: () => number, limiteFotos, limiteConsultas}} ctx
 *   limiteFotos: LimiteTaxa por IP dos envios (o mesmo de /api/orcamento/fotos); limiteConsultas: por IP, das
 *   sondagens do computador e dos pedidos de token.
 */
export function criarFotosRemotas({ db, config, registo, relogio, limiteFotos, limiteConsultas }) {
  const pasta = (hash) => join(config.fotosDir, 'remotas', hash.slice(0, 16));
  const ficheiro = (f) => join(pasta(f.token_hash), `${f.id}.${EXTENSAO[f.tipo_mime]}`);

  // ------------------------------------------------------------ token
  function tokenDe(req) {
    const t = req.headers['x-foto-token'];
    if (typeof t !== 'string' || !RE_TOKEN.test(t)) return null;
    const r = db.prepare('SELECT * FROM fotos_remotas_tokens WHERE hash = ?').get(sha256(t));
    if (!r || r.expira <= relogio()) return null;
    return r;
  }
  const tokenOuErro = (req) => {
    const t = tokenDe(req);
    if (!t) throw new ErroApi(401, 'Esta ligação já não é válida. No computador, carregue outra vez em "Tirar foto" para obter um código novo.');
    return t;
  };

  /**
   * POST /api/fotos-remotas {sim, chave, rotulo?} (+ X-Foto-Token opcional): regista a chave pedida; cria o token
   * se não vier um válido para a mesma simulação. Devolve {token?, expira, chaves}.
   */
  async function pedir(req, res) {
    const v = await lerJson(req, ['sim', 'chave', 'rotulo']);
    if (typeof v.sim !== 'string' || !RE_SIM.test(v.sim)) throw new ErroApi(400, 'Identificação da simulação inválida (sim).');
    if (typeof v.chave !== 'string' || !RE_CHAVE_FOTO.test(v.chave)) throw new ErroApi(400, 'Identificação da foto inválida (chave).');
    let rotulo = v.rotulo === undefined || v.rotulo === null ? null : String(v.rotulo).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (rotulo !== null && rotulo.length > ROTULO_MAX) throw new ErroApi(400, `O rótulo da foto tem no máximo ${ROTULO_MAX} caracteres.`);
    rotulo ||= null;
    const agora = relogio();
    let t = tokenDe(req);
    let token = null;
    if (!t || t.sim !== v.sim) {
      token = randomBytes(32).toString('base64url');
      t = { hash: sha256(token), sim: v.sim, expira: agora + TOKEN_REMOTO_MS, criado: iso(agora) };
      db.prepare('INSERT INTO fotos_remotas_tokens (hash, sim, expira, seq, criado) VALUES (?, ?, ?, 0, ?)').run(t.hash, t.sim, t.expira, t.criado);
    }
    const ja = db.prepare('SELECT 1 FROM fotos_remotas WHERE token_hash = ? AND chave = ?').get(t.hash, v.chave);
    if (!ja) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM fotos_remotas WHERE token_hash = ?').get(t.hash).n;
      if (n >= CHAVES_MAX) throw new ErroApi(400, `Esta simulação já tem o máximo de ${CHAVES_MAX} fotos pelo telemóvel.`);
      db.prepare('INSERT INTO fotos_remotas (token_hash, chave, rotulo, pedida) VALUES (?, ?, ?, ?)').run(t.hash, v.chave, rotulo, iso(agora));
    } else {
      db.prepare('UPDATE fotos_remotas SET rotulo = ?, pedida = ? WHERE token_hash = ? AND chave = ?').run(rotulo, iso(agora), t.hash, v.chave);
    }
    responder(res, token ? 201 : 200, { ok: true, ...(token ? { token } : {}), expira: t.expira, chaves: chaves(t) });
  }

  /** As chaves pedidas de um token: [{chave, rotulo, seq (null por receber), recebida, bytes, tipo_mime}]. */
  function chaves(t, desde = 0) {
    return db.prepare('SELECT chave, rotulo, seq, recebida, bytes, tipo_mime FROM fotos_remotas WHERE token_hash = ? AND (seq IS NULL OR seq > ?) ORDER BY rowid')
      .all(t.hash, desde)
      .map((f) => ({ chave: f.chave, rotulo: f.rotulo, seq: f.seq, recebida: f.recebida, bytes: f.bytes, tipo_mime: f.tipo_mime, pronta: f.seq !== null && f.bytes !== null }));
  }

  /** GET /api/fotos-remotas[?desde=n] (X-Foto-Token): o estado; com `desde` só as chaves por receber e as fotos com seq > n. */
  function estado(req, res, url) {
    const t = tokenOuErro(req);
    const d = url.searchParams.get('desde');
    const desde = d !== null && /^\d{1,9}$/.test(d) ? Number(d) : 0;
    responder(res, 200, { ok: true, expira: t.expira, seq: t.seq, chaves: chaves(t, desde) }, { 'Cache-Control': 'no-store' });
  }

  // ------------------------------------------------------------ a foto (telemóvel → servidor → computador)
  /** POST /api/fotos-remotas/:chave (X-Foto-Token, corpo = bytes JPEG/PNG): a foto do telemóvel. */
  async function receber(req, res, chave) {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!EXTENSAO[tipo]) throw new ErroApi(415, 'A foto tem de ser JPEG ou PNG (Content-Type: image/jpeg ou image/png).');
    const t = tokenOuErro(req);
    const pedida = db.prepare('SELECT * FROM fotos_remotas WHERE token_hash = ? AND chave = ?').get(t.hash, chave);
    if (!pedida) throw new ErroApi(404, 'O computador não está à espera desta foto. Volte ao computador e carregue em "Tirar foto".');
    const corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((e) => {
      if (e instanceof ErroApi && e.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw e;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    const f = { id: randomBytes(12).toString('hex'), token_hash: t.hash, tipo_mime: tipo };
    await escreverAtomico(ficheiro(f), corpo);
    const seq = t.seq + 1;
    try {
      db.prepare('UPDATE fotos_remotas_tokens SET seq = ? WHERE hash = ?').run(seq, t.hash);
      db.prepare('UPDATE fotos_remotas SET id = ?, tipo_mime = ?, bytes = ?, seq = ?, recebida = ? WHERE token_hash = ? AND chave = ?')
        .run(f.id, tipo, corpo.length, seq, iso(relogio()), t.hash, chave);
    } catch (e) {
      await unlink(ficheiro(f)).catch(() => {});
      throw e;
    }
    // A mesma chave outra vez: a foto anterior sai do disco.
    if (pedida.id) await unlink(ficheiro(pedida)).catch(() => {});
    registo.info(`fotos pelo telemóvel: ${chave} recebida (${corpo.length} bytes, seq ${seq})`);
    responder(res, 201, { ok: true, seq, chaves: chaves(t) });
  }

  /** GET /api/fotos-remotas/:chave (X-Foto-Token): os bytes da foto, para o computador. */
  async function entregar(req, res, chave) {
    const t = tokenOuErro(req);
    const f = db.prepare('SELECT * FROM fotos_remotas WHERE token_hash = ? AND chave = ? AND id IS NOT NULL').get(t.hash, chave);
    if (!f) throw new ErroApi(404, 'Ainda não há foto para esta chave.');
    let corpo;
    try {
      corpo = await readFile(ficheiro(f));
    } catch {
      throw new ErroApi(404, 'A foto já não está no servidor.');
    }
    res.writeHead(200, { 'Content-Type': f.tipo_mime, 'Content-Length': corpo.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(corpo);
  }

  /** POST /api/fotos-remotas/:chave/apagar (X-Foto-Token): o computador já a tem — os bytes saem do servidor (a chave fica "enviada"). */
  async function apagar(req, res, chave) {
    const t = tokenOuErro(req);
    const f = db.prepare('SELECT * FROM fotos_remotas WHERE token_hash = ? AND chave = ? AND id IS NOT NULL').get(t.hash, chave);
    if (f) {
      db.prepare('UPDATE fotos_remotas SET id = NULL, bytes = NULL WHERE token_hash = ? AND chave = ?').run(t.hash, chave);
      await unlink(ficheiro(f)).catch(() => {});
    }
    responder(res, 200, { ok: true });
  }

  // ------------------------------------------------------------ limpeza
  /** Apaga os tokens expirados e as pastas das suas fotos. Devolve quantos tokens saíram. */
  async function limpar() {
    const agora = relogio();
    const idos = db.prepare('SELECT hash FROM fotos_remotas_tokens WHERE expira <= ?').all(agora);
    for (const { hash } of idos) {
      db.prepare('DELETE FROM fotos_remotas_tokens WHERE hash = ?').run(hash);   // as chaves/fotos saem em cascata
      await rm(pasta(hash), { recursive: true, force: true });
    }
    if (idos.length) registo.info(`fotos pelo telemóvel: ${idos.length} ligações expiradas apagadas`);
    return idos.length;
  }

  let temporizador = null;
  function iniciar(intervaloMs = LIMPEZA_MS) {
    temporizador = setInterval(() => limpar().catch((e) => registo.erro(`fotos pelo telemóvel, limpeza: ${e?.stack || e}`)), intervaloMs);
    temporizador.unref();
  }
  function parar() {
    clearInterval(temporizador);
  }

  // ------------------------------------------------------------ despacho (/api/fotos-remotas…)
  const RE_CAMINHO = /^\/api\/fotos-remotas(?:\/([^/]+)(\/apagar)?)?$/;

  /** Trata um pedido /api/fotos-remotas…; devolve false se o caminho não é destas rotas. A origem e o CORS já vêm de api.js. */
  async function tratar(req, res, url, ip) {
    const m = RE_CAMINHO.exec(url.pathname);
    if (!m) return false;
    let chave = null;
    if (m[1] !== undefined) {
      try { chave = decodeURIComponent(m[1]); } catch { throw new ErroApi(400, 'Identificação da foto inválida.'); }
      if (!RE_CHAVE_FOTO.test(chave)) throw new ErroApi(400, 'Identificação da foto inválida.');
    }
    const post = req.method === 'POST';
    const get = req.method === 'GET';
    if (post && !verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    const limite = chave && post && !m[2] ? limiteFotos : limiteConsultas;
    const espera = limite.espera(ip);
    if (espera) {
      registo.aviso(`fotos pelo telemóvel: limite atingido (ip ${ip})`);
      throw new ErroApi(429, 'Demasiados pedidos seguidos deste endereço. Tente mais tarde.', { 'Retry-After': String(espera) });
    }
    limite.registar(ip);
    if (!chave) {
      if (post) { await pedir(req, res); return true; }
      if (get) { estado(req, res, url); return true; }
      return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, POST' }), true;
    }
    if (m[2]) {
      if (!post) return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' }), true;
      await apagar(req, res, chave);
      return true;
    }
    if (post) { await receber(req, res, chave); return true; }
    if (get) { await entregar(req, res, chave); return true; }
    return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, POST' }), true;
  }

  return { tratar, limpar, iniciar, parar };
}
