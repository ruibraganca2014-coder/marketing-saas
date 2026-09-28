// Ligação temporária ao telemóvel (docs/SIMULADOR-ORCAMENTO.md, passo 4 "Continue no telemóvel"): /api/ligacao/*.
// - Sem conta: o computador pede uma ligação e envia o estado da simulação; o painel devolve um token aleatório
//   (32 bytes, base64url; aqui só o SHA-256), válido 24 h desde a criação. O token vai no QR, no fragmento do
//   endereço (#ligar=…, nunca chega aos registos) e depois só no cabeçalho X-Ligacao-Token. Dá acesso a esta
//   simulação e às suas fotos e a mais nada; o contacto não passa por aqui (é tirado do estado).
// - Sincronização: o estado tem uma versão (`versao_estado`); cada escrita diz em que versão se baseou e, se entretanto
//   outro aparelho escreveu, recebe 409 com o estado atual (o browser junta as duas e escreve outra vez). As
//   leituras (poll ~4 s) usam ETag = `versao` (muda com o estado e com as fotos) → 304 sem corpo quando nada mudou.
// - Fotos: as mesmas validações das fotos do pedido (fotos.js); no máximo FOTOS_MAX guardadas e LIGACAO_ENVIOS_MAX
//   envios por ligação. Ao enviar o pedido (POST /api/orcamento com `ligacao`), as fotos que o pedido indica passam
//   para ele sem voltar a ser enviadas e a ligação termina. "Começar de novo" termina-a (POST /api/ligacao/terminar).
// - Limpeza de hora a hora: ligações expiradas (com as fotos) e pastas órfãs com mais de 24 h.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, responder, lerJson, verificarOrigemPublica } from './http.js';
import { LimiteTaxa } from './limite.js';
import { iso, escreverAtomico } from './util.js';
import { FOTOS_MAX, RE_ID_FOTO, tipoFoto, chaveLegendaFoto, corpoFoto, extensaoFoto } from './fotos.js';
import { validarEstado } from './conta.js';

export const LIGACAO_MS = 24 * 3600_000;
export const LIGACAO_FOTOS_MAX = FOTOS_MAX;       // guardadas de cada vez (as que cabem no pedido)
export const LIGACAO_ENVIOS_MAX = 100;            // envios de fotos por ligação (trocas incluídas)
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RE_ID = /^[a-f0-9]{16}$/;
const TERMINOU = 'Esta ligação terminou ou expirou. Continue no aparelho onde começou a simulação.';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Estado sem o contacto (nada de dados pessoais na ligação); null se não for um objeto válido. */
function estadoSemContacto(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const { contacto, ...resto } = v;
  return resto;
}

/**
 * @param {{db, config, registo, relogio: () => number, fotos: object}} ctx
 */
export function criarLigacoes({ db, config, registo, relogio, fotos }) {
  const lim = (n, ms) => new LimiteTaxa(n, ms, relogio);
  const L = {
    criar: lim(config.limiteLigacoesHora ?? 20, 3600_000),
    ler: lim(config.limiteLigacaoLeiturasHora ?? 3600, 3600_000),
    escrever: lim(config.limiteLigacaoEscritasHora ?? 1200, 3600_000),
    fotos: lim(config.limiteFotosHora ?? 120, 3600_000),
  };
  function limite(l, ip, texto) {
    const s = l.espera(ip);
    if (s) throw new ErroApi(429, texto, { 'Retry-After': String(s) });
    l.registar(ip);
  }
  const dir = config.ligacoesDir;
  const pasta = (id) => join(dir, id);
  const ficheiro = (f) => join(pasta(f.ligacao_id), `${f.id}.${extensaoFoto(f.tipo_mime)}`);

  // ------------------------------------------------------------ token
  function daToken(token) {
    if (typeof token !== 'string' || !RE_TOKEN.test(token)) return null;
    const l = db.prepare('SELECT * FROM ligacoes WHERE hash = ?').get(sha256(token));
    if (!l || l.expira <= relogio()) return null;
    return l;
  }
  function exigir(req) {
    const l = daToken(req.headers['x-ligacao-token']);
    if (!l) throw new ErroApi(404, TERMINOU);
    return l;
  }

  const listaFotos = (l) => db.prepare('SELECT id, chave, bytes, legenda, criado FROM ligacoes_fotos WHERE ligacao_id = ? ORDER BY criado, id').all(l.id);
  const subirVersao = (id) => db.prepare('UPDATE ligacoes SET versao = versao + 1, atualizada = ? WHERE id = ?').run(relogio(), id);

  async function apagar(l) {
    db.prepare('DELETE FROM ligacoes WHERE id = ?').run(l.id);   // as fotos saem em cascata
    await rm(pasta(l.id), { recursive: true, force: true });
  }

  // ------------------------------------------------------------ rotas
  const h = {};

  h.criar = async ({ req, res, ip }) => {
    limite(L.criar, ip, 'Pediu demasiadas ligações ao telemóvel seguidas. Tente mais tarde.');
    const v = await lerJson(req, ['estado'], 1_600_000);
    const json = validarEstado(estadoSemContacto(v.estado ?? null));
    if (!json) throw new ErroApi(400, 'Indique o estado da simulação.');
    const token = randomBytes(32).toString('base64url');
    const agora = relogio();
    const id = randomBytes(8).toString('hex');
    db.prepare('INSERT INTO ligacoes (id, hash, criada, expira, atualizada, estado) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, sha256(token), agora, agora + LIGACAO_MS, agora, json);
    registo.info(`ligação ao telemóvel ${id} criada`);
    responder(res, 201, { token, expira: iso(agora + LIGACAO_MS), versao: 1, versao_estado: 1, fotos_max: LIGACAO_FOTOS_MAX });
  };

  // GET /api/ligacao/estado (If-None-Match: "<versao>" → 304; ?estado=<versao_estado> → sem o estado se for o mesmo)
  h.ler = ({ req, res, url, ip }) => {
    limite(L.ler, ip, 'Demasiados pedidos seguidos. Tente daqui a pouco.');
    const l = exigir(req);
    const etag = `"${l.versao}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end();
    }
    const r = { versao: l.versao, versao_estado: l.versao_estado, expira: iso(l.expira), fotos: listaFotos(l), fotos_max: LIGACAO_FOTOS_MAX };
    if (url.searchParams.get('estado') !== String(l.versao_estado)) r.estado = JSON.parse(l.estado);
    responder(res, 200, r, { ETag: etag });
  };

  // POST /api/ligacao/estado {base, estado}: só se `base` for a versão atual; senão 409 com o estado atual.
  h.escrever = async ({ req, res, ip }) => {
    limite(L.escrever, ip, 'Demasiadas alterações seguidas. Tente daqui a pouco.');
    const l = exigir(req);
    const v = await lerJson(req, ['base', 'estado'], 1_600_000);
    if (!Number.isInteger(v.base) || v.base < 1) throw new ErroApi(400, 'Indique a versão em que se baseou (base).');
    const json = validarEstado(estadoSemContacto(v.estado ?? null));
    if (!json) throw new ErroApi(400, 'Indique o estado da simulação.');
    const r = db.prepare(`UPDATE ligacoes SET estado = ?, versao_estado = versao_estado + 1, versao = versao + 1, atualizada = ?
      WHERE id = ? AND versao_estado = ? AND expira > ?`).run(json, relogio(), l.id, v.base, relogio());
    if (!r.changes) {
      const atual = db.prepare('SELECT * FROM ligacoes WHERE id = ?').get(l.id);
      if (!atual) throw new ErroApi(404, TERMINOU);
      return responder(res, 409, {
        erro: 'O outro aparelho mudou a simulação entretanto.',
        versao: atual.versao, versao_estado: atual.versao_estado, estado: JSON.parse(atual.estado), fotos: listaFotos(atual),
      }, { ETag: `"${atual.versao}"` });
    }
    const n = db.prepare('SELECT versao, versao_estado FROM ligacoes WHERE id = ?').get(l.id);
    responder(res, 200, { ok: true, versao: n.versao, versao_estado: n.versao_estado }, { ETag: `"${n.versao}"` });
  };

  // POST /api/ligacao/fotos: uma foto (bytes), com X-Ligacao-Token, X-Foto-Chave e X-Foto-Legenda. A mesma chave substitui.
  h.foto = async ({ req, res, ip }) => {
    limite(L.fotos, ip, 'Recebemos demasiadas fotos seguidas deste endereço. Tente mais tarde.');
    const tipo = tipoFoto(req);
    const l = exigir(req);
    const { chave, legenda } = chaveLegendaFoto(req);
    const anterior = db.prepare('SELECT * FROM ligacoes_fotos WHERE ligacao_id = ? AND chave = ?').get(l.id, chave);
    if (!anterior && db.prepare('SELECT COUNT(*) AS n FROM ligacoes_fotos WHERE ligacao_id = ?').get(l.id).n >= LIGACAO_FOTOS_MAX) {
      throw new ErroApi(400, `Já tem ${LIGACAO_FOTOS_MAX} fotos, o máximo. Apague uma para tirar outra.`);
    }
    if (l.envios_fotos >= LIGACAO_ENVIOS_MAX) throw new ErroApi(429, 'Enviou demasiadas fotos por esta ligação. Envie o pedido e acrescente as que faltam na sua conta.');
    const corpo = await corpoFoto(req, tipo);
    const f = { id: randomBytes(12).toString('hex'), ligacao_id: l.id, chave, tipo_mime: tipo, bytes: corpo.length, legenda, criado: iso(relogio()) };
    await mkdir(pasta(l.id), { recursive: true, mode: 0o700 });
    await escreverAtomico(ficheiro(f), corpo);
    try {
      // A ligação pode ter terminado enquanto a foto chegava: a chave estrangeira recusa e o ficheiro sai.
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM ligacoes_fotos WHERE ligacao_id = ? AND chave = ?').run(l.id, chave);
        db.prepare('INSERT INTO ligacoes_fotos (id, ligacao_id, chave, tipo_mime, bytes, legenda, criado) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(f.id, l.id, chave, tipo, f.bytes, legenda, f.criado);
        db.prepare('UPDATE ligacoes SET envios_fotos = envios_fotos + 1, versao = versao + 1, atualizada = ? WHERE id = ?').run(relogio(), l.id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } catch {
      await unlink(ficheiro(f)).catch(() => {});
      throw new ErroApi(404, TERMINOU);
    }
    if (anterior) await unlink(ficheiro(anterior)).catch(() => {});
    const versao = db.prepare('SELECT versao FROM ligacoes WHERE id = ?').get(l.id)?.versao ?? null;
    responder(res, 201, { ok: true, id: f.id, chave, versao });
  };

  // GET /api/ligacao/fotos/:id — a imagem (só desta ligação).
  h.lerFoto = async ({ req, res, params, ip }) => {
    limite(L.ler, ip, 'Demasiados pedidos seguidos. Tente daqui a pouco.');
    const l = exigir(req);
    const f = RE_ID_FOTO.test(params.foto) ? db.prepare('SELECT * FROM ligacoes_fotos WHERE id = ? AND ligacao_id = ?').get(params.foto, l.id) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    let corpo;
    try { corpo = await readFile(ficheiro(f)); } catch { throw new ErroApi(404, 'Foto não encontrada.'); }
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': f.tipo_mime, 'Content-Length': corpo.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(corpo);
  };

  // POST /api/ligacao/fotos/apagar {chave}
  h.apagarFoto = async ({ req, res, ip }) => {
    limite(L.escrever, ip, 'Demasiadas alterações seguidas. Tente daqui a pouco.');
    const l = exigir(req);
    const v = await lerJson(req, ['chave']);
    const f = typeof v.chave === 'string' ? db.prepare('SELECT * FROM ligacoes_fotos WHERE ligacao_id = ? AND chave = ?').get(l.id, v.chave) : null;
    if (f) {
      db.prepare('DELETE FROM ligacoes_fotos WHERE id = ?').run(f.id);
      subirVersao(l.id);
      await unlink(ficheiro(f)).catch(() => {});
    }
    const versao = db.prepare('SELECT versao FROM ligacoes WHERE id = ?').get(l.id)?.versao ?? null;
    responder(res, 200, { ok: true, apagada: Boolean(f), versao });
  };

  // POST /api/ligacao/terminar — "Começar de novo" (idempotente: uma ligação que já terminou também responde ok).
  h.terminar = async ({ req, res }) => {
    await lerJson(req, []);
    const l = daToken(req.headers['x-ligacao-token']);
    if (l) {
      await apagar(l);
      registo.info(`ligação ao telemóvel ${l.id} terminada`);
    }
    responder(res, 200, { ok: true });
  };

  // ------------------------------------------------------------ envio do pedido
  /**
   * POST /api/orcamento com `ligacao`: as fotos da ligação cujas chaves o pedido indica (`simulacao.fotos`) passam
   * para o pedido (movidas, sem novo envio), e a ligação termina. Devolve as chaves que passaram.
   */
  async function passarParaPedido(token, orcamentoId, chaves) {
    const l = daToken(token);
    if (!l) return [];
    const quer = new Set(chaves);
    const feitas = [];
    for (const f of db.prepare('SELECT * FROM ligacoes_fotos WHERE ligacao_id = ? ORDER BY chave = \'quadro\' DESC, criado, id').all(l.id)) {
      if (!quer.has(f.chave)) continue;
      try {
        if (await fotos.adotar(orcamentoId, f, ficheiro(f))) feitas.push(f.chave);
      } catch (e) {
        registo.erro(`ligação ${l.id}: foto ${f.chave} não passou para o orçamento ${orcamentoId}: ${e?.message || e}`);
      }
    }
    await apagar(l);
    registo.info(`ligação ao telemóvel ${l.id}: ${feitas.length} fotos passaram para o orçamento ${orcamentoId}; ligação terminada`);
    return feitas;
  }

  // ------------------------------------------------------------ limpeza
  /** Ligações expiradas (com as fotos) e pastas sem ligação há mais de 24 h (restos de uma falha). */
  async function limpar() {
    const agora = relogio();
    const velhas = db.prepare('SELECT id FROM ligacoes WHERE expira <= ?').all(agora);
    for (const l of velhas) await apagar(l);
    let orfas = 0;
    let nomes = [];
    try { nomes = await readdir(dir); } catch { nomes = []; }
    for (const nome of nomes) {
      if (!RE_ID.test(nome) || db.prepare('SELECT 1 FROM ligacoes WHERE id = ?').get(nome)) continue;
      try {
        const s = await stat(join(dir, nome));
        if (agora - s.mtimeMs < LIGACAO_MS) continue;
        await rm(join(dir, nome), { recursive: true, force: true });
        orfas++;
      } catch { /* já não existe */ }
    }
    for (const l of Object.values(L)) l.limpar();
    if (velhas.length || orfas) registo.info(`ligações ao telemóvel: ${velhas.length} expiradas e ${orfas} pastas órfãs apagadas`);
    return { expiradas: velhas.length, orfas };
  }

  let temporizador = null;
  function iniciar(intervaloMs = 3600_000) {
    temporizador = setInterval(() => limpar().catch((e) => registo.erro(`limpeza das ligações: ${e?.stack || e}`)), intervaloMs);
    temporizador.unref();
  }
  function parar() { clearInterval(temporizador); }

  // ------------------------------------------------------------ despacho /api/ligacao*
  const ROTAS = [
    ['POST', '', 'criar'],
    ['GET', 'estado', 'ler'],
    ['POST', 'estado', 'escrever'],
    ['POST', 'fotos', 'foto'],
    ['GET', 'fotos/:foto', 'lerFoto'],
    ['POST', 'fotos/apagar', 'apagarFoto'],
    ['POST', 'terminar', 'terminar'],
  ].map(([metodo, caminho, nome]) => ({ metodo, partes: caminho ? caminho.split('/') : [], nome }));

  async function tratar(req, res, url, ip) {
    const resto = url.pathname === '/api/ligacao' ? '' : url.pathname.slice('/api/ligacao/'.length);
    const segs = resto ? resto.split('/') : [];
    let rota = null;
    let params = {};
    let existe = false;
    for (const r of ROTAS) {
      if (r.partes.length !== segs.length) continue;
      const p = {};
      if (!r.partes.every((x, i) => (x.startsWith(':') ? (p[x.slice(1)] = segs[i]) !== '' : x === segs[i]))) continue;
      // "fotos/apagar" (POST) antes de "fotos/:foto" (GET): o nome fixo ganha.
      existe = true;
      if (r.metodo === req.method || (req.method === 'HEAD' && r.metodo === 'GET')) { rota = r; params = p; break; }
    }
    if (!rota) return responder(res, existe ? 405 : 404, { erro: existe ? 'Método não permitido.' : 'Endereço desconhecido.' });
    if (rota.metodo === 'POST' && !verificarOrigemPublica(req, config.origens, config.siteOrigens)) {
      throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    }
    return h[rota.nome]({ req, res, params, url, ip });
  }

  return { tratar, passarParaPedido, limpar, iniciar, parar, daToken };
}
