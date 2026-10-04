// Fotos do simulador (docs/PAINEL-EMPRESA.md, "Fotos do pedido"): o POST /api/orcamento devolve um
// token (30 min, só para esse pedido; na base de dados só o SHA-256) e o browser envia as fotos, uma a
// uma, para POST /api/orcamento/fotos. Ficam em DADOS/painel/fotos/<orcamento>/<id>.jpg|png (fora da
// pasta pública) com um registo na tabela `fotos`; o painel serve-as só a quem vê o orçamento.
// A foto do quadro ("quadro") é lida por um modelo de visão (leitura-quadro.js) em segundo plano.
// Retenção: apagarRetidas() apaga as fotos dos pedidos sem seguimento há mais de 12 meses.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, lerCorpo } from './http.js';
import { escreverAtomico, iso } from './util.js';

export const FOTOS_MAX = 40;                     // por pedido
export const FOTO_MAX_BYTES = 1024 * 1024;       // por foto
export const TOKEN_FOTOS_MS = 30 * 60_000;       // validade do token
export const RETENCAO_MS = 365 * 24 * 3600_000;  // 12 meses sem seguimento → fotos apagadas
export const RE_CHAVE_FOTO = /^(?:quadro|[A-Za-z0-9_-]{1,64}:[a-z0-9_]{1,32})$/;
export const RE_ID_FOTO = /^[a-f0-9]{24}$/;
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Os bytes mágicos batem com o tipo declarado (JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A)? */
export function bytesDeImagem(buf, tipo) {
  if (tipo === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (tipo === 'image/png') return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

/**
 * @param {{db, config, registo, relogio: () => number, leitor: object|null, auditar: Function}} ctx
 */
export function criarFotos({ db, config, registo, relogio, leitor, auditar }) {
  const pasta = (orcamentoId) => join(config.fotosDir, String(orcamentoId));
  const ficheiro = (f) => join(pasta(f.orcamento_id), `${f.id}.${EXTENSAO[f.tipo_mime]}`);
  const emCurso = new Set();

  // ------------------------------------------------------------ token
  function emitirToken(orcamentoId) {
    const token = randomBytes(32).toString('base64url');
    const agora = relogio();
    db.prepare('DELETE FROM fotos_tokens WHERE expira <= ?').run(agora);
    db.prepare('INSERT INTO fotos_tokens (hash, orcamento_id, expira) VALUES (?, ?, ?)').run(sha256(token), orcamentoId, agora + TOKEN_FOTOS_MS);
    return token;
  }

  /** Token falso (armadilha): mesma forma, sem registo — as fotos com ele dão 401. */
  const tokenFalso = () => randomBytes(32).toString('base64url');

  function orcamentoDoToken(token) {
    if (typeof token !== 'string' || !RE_TOKEN.test(token)) return null;
    const t = db.prepare('SELECT orcamento_id, expira FROM fotos_tokens WHERE hash = ?').get(sha256(token));
    if (!t || t.expira <= relogio()) return null;
    return t.orcamento_id;
  }

  // ------------------------------------------------------------ receber (público)
  /**
   * POST /api/orcamento/fotos (token nos cabeçalhos) e POST /api/conta/pedidos/:id/fotos (`orcamentoConta`: o
   * pedido da conta com sessão, já verificado em conta.js — sem token). A origem e o limite por IP já foram
   * verificados antes; as validações da foto são as mesmas nos dois caminhos.
   */
  async function receber(req, orcamentoConta = null) {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!EXTENSAO[tipo]) throw new ErroApi(415, 'A foto tem de ser JPEG ou PNG (Content-Type: image/jpeg ou image/png).');
    const orcamentoId = orcamentoConta ?? orcamentoDoToken(req.headers['x-fotos-token']);
    if (!orcamentoId) throw new ErroApi(401, 'Autorização das fotos inválida ou expirada. Envie o pedido de novo.');
    const chave = String(req.headers['x-foto-chave'] ?? '');
    if (!RE_CHAVE_FOTO.test(chave)) throw new ErroApi(400, 'Identificação da foto inválida (X-Foto-Chave).');
    let legenda = null;
    if (req.headers['x-foto-legenda'] !== undefined) {
      try {
        legenda = decodeURIComponent(String(req.headers['x-foto-legenda']));
      } catch {
        throw new ErroApi(400, 'Legenda da foto inválida (X-Foto-Legenda).');
      }
      legenda = legenda.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
      if (legenda.length > 120) throw new ErroApi(400, 'A legenda da foto tem no máximo 120 caracteres.');
      legenda ||= null;
    }
    const corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((e) => {
      if (e instanceof ErroApi && e.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw e;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');

    const anterior = db.prepare('SELECT * FROM fotos WHERE orcamento_id = ? AND chave = ?').get(orcamentoId, chave);
    if (!anterior) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(orcamentoId).n;
      if (n >= FOTOS_MAX) throw new ErroApi(400, `Este pedido já tem o máximo de ${FOTOS_MAX} fotos.`);
    }
    const foto = { id: randomBytes(12).toString('hex'), orcamento_id: orcamentoId, chave, tipo_mime: tipo, bytes: corpo.length, legenda, criado: iso(relogio()) };
    await mkdir(pasta(orcamentoId), { recursive: true, mode: 0o700 });
    await escreverAtomico(ficheiro(foto), corpo);
    try {
      // A mesma chave substitui a anterior (registo e ficheiro).
      db.prepare('DELETE FROM fotos WHERE orcamento_id = ? AND chave = ?').run(orcamentoId, chave);
      db.prepare('INSERT INTO fotos (id, orcamento_id, chave, tipo_mime, bytes, legenda, criado) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(foto.id, orcamentoId, chave, tipo, corpo.length, legenda, foto.criado);
    } catch (e) {
      await unlink(ficheiro(foto)).catch(() => {});
      throw e;
    }
    if (anterior) await unlink(ficheiro(anterior)).catch(() => {});
    registo.info(`orçamento ${orcamentoId}: foto ${chave} recebida (${corpo.length} bytes)`);
    if (chave === 'quadro') agendarLeitura(orcamentoId, foto);
    return foto;
  }

  // ------------------------------------------------------------ leitura do quadro (assíncrona)
  const gravarLeitura = (orcamentoId, v) => db.prepare('UPDATE orcamentos SET leitura_quadro = ? WHERE id = ?').run(JSON.stringify(v), orcamentoId);
  const fotoQuadroAtual = (orcamentoId) => db.prepare('SELECT id FROM fotos WHERE orcamento_id = ? AND chave = \'quadro\'').get(orcamentoId)?.id ?? null;

  function agendarLeitura(orcamentoId, foto) {
    if (!leitor) return;                         // sem ANTHROPIC_API_KEY: não se chama nada
    const tarefa = (async () => {
      await new Promise((r) => setImmediate(r)); // a resposta ao browser sai primeiro
      const imagem = await readFile(ficheiro(foto));
      try {
        const r = await leitor.ler(imagem, foto.tipo_mime, ` (orçamento ${orcamentoId})`);
        // Se entretanto chegou outra foto do quadro, esta leitura já não serve.
        if (fotoQuadroAtual(orcamentoId) !== foto.id) return;
        gravarLeitura(orcamentoId, { estado: 'feita', foto_id: foto.id, modelo: r.modelo, quando: iso(relogio()), leitura: r.leitura, tokens: r.uso, custo_usd: r.custo_usd });
      } catch (e) {
        if (fotoQuadroAtual(orcamentoId) !== foto.id) return;
        gravarLeitura(orcamentoId, { estado: 'erro', foto_id: foto.id, modelo: leitor.modelo, quando: iso(relogio()), erro: String(e?.message || e).slice(0, 300) });
      }
    })().catch((e) => registo.erro(`leitura do quadro (orçamento ${orcamentoId}): ${e?.stack || e}`));
    emCurso.add(tarefa);
    tarefa.finally(() => emCurso.delete(tarefa));
  }

  /**
   * Lê agora a foto do quadro do pedido e espera pelo resultado (botão "Preencher a partir da foto" do painel, para as
   * fotos que chegaram antes de haver chave ou cuja leitura falhou). Devolve false sem leitor ou sem foto do quadro.
   */
  async function lerQuadroAgora(orcamentoId) {
    const foto = leitor ? db.prepare("SELECT * FROM fotos WHERE orcamento_id = ? AND chave = 'quadro'").get(orcamentoId) : null;
    if (!foto) return false;
    const imagem = await readFile(ficheiro(foto));
    try {
      const r = await leitor.ler(imagem, foto.tipo_mime, ` (orçamento ${orcamentoId})`);
      if (fotoQuadroAtual(orcamentoId) === foto.id) gravarLeitura(orcamentoId, { estado: 'feita', foto_id: foto.id, modelo: r.modelo, quando: iso(relogio()), leitura: r.leitura, tokens: r.uso, custo_usd: r.custo_usd });
    } catch (e) {
      if (fotoQuadroAtual(orcamentoId) === foto.id) gravarLeitura(orcamentoId, { estado: 'erro', foto_id: foto.id, modelo: leitor.modelo, quando: iso(relogio()), erro: String(e?.message || e).slice(0, 300) });
    }
    return true;
  }

  /** Estado da leitura para o painel: desligada | sem_foto | pendente | feita | erro. */
  function leituraQuadro(o) {
    const fotoId = fotoQuadroAtual(o.id);
    let guardada = null;
    try { guardada = o.leitura_quadro ? JSON.parse(o.leitura_quadro) : null; } catch { /* ignorado */ }
    if (guardada && guardada.foto_id === fotoId) return guardada;
    if (!fotoId) return guardada ? { ...guardada, foto_apagada: true } : { estado: 'sem_foto' };
    if (!leitor) return { estado: 'desligada' };
    return { estado: 'pendente', foto_id: fotoId };
  }

  // ------------------------------------------------------------ painel
  /** Fotos de um pedido com os metadados da simulação (`simulacao.fotos`, pela chave). */
  function listar(o, sim, base = `/painel/api/orcamentos/${o.id}/fotos/`) {
    const meta = new Map();
    for (const m of Array.isArray(sim?.fotos) ? sim.fotos : []) {
      if (m && typeof m === 'object' && typeof m.chave === 'string' && !meta.has(m.chave)) meta.set(m.chave, m);
    }
    const txt = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    return db.prepare('SELECT * FROM fotos WHERE orcamento_id = ? ORDER BY chave = \'quadro\' DESC, criado, id').all(o.id).map((f) => {
      const m = meta.get(f.chave) ?? {};
      const [divisao, tipoChave] = f.chave === 'quadro' ? [null, 'quadro'] : f.chave.split(':');
      return {
        id: f.id, chave: f.chave,
        tipo: txt(m.tipo, 40) ?? tipoChave,
        divisao: txt(m.divisao, 64) ?? divisao,
        divisao_nome: txt(m.divisao_nome, 80),
        piso: Number.isInteger(m.piso) ? m.piso : (typeof m.piso === 'string' && /^-?\d{1,2}$/.test(m.piso) ? Number(m.piso) : null),
        legenda: f.legenda ?? txt(m.legenda),
        tipo_mime: f.tipo_mime, bytes: f.bytes, criado: f.criado,
        url: `${base}${f.id}`,
      };
    });
  }

  const contar = (orcamentoId) => db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(orcamentoId).n;

  function obter(orcamentoId, fotoId) {
    if (!RE_ID_FOTO.test(fotoId)) return null;
    return db.prepare('SELECT * FROM fotos WHERE id = ? AND orcamento_id = ?').get(fotoId, orcamentoId) ?? null;
  }

  async function ler(f) {
    return readFile(ficheiro(f));
  }

  async function apagar(f) {
    db.prepare('DELETE FROM fotos WHERE id = ?').run(f.id);
    await unlink(ficheiro(f)).catch(() => {});
  }

  async function apagarTodas(orcamentoId) {
    const n = db.prepare('DELETE FROM fotos WHERE orcamento_id = ?').run(orcamentoId).changes;
    db.prepare('DELETE FROM fotos_tokens WHERE orcamento_id = ?').run(orcamentoId);
    await rm(pasta(orcamentoId), { recursive: true, force: true });
    return Number(n);
  }

  /**
   * Retenção: apaga as fotos dos pedidos "perdidos ou sem resposta" — estado diferente de "aceite",
   * nunca convertidos em cliente/obra e sem nenhuma alteração (campo `atualizado`) há mais de 12
   * meses. Os aceites/convertidos guardam as fotos com o cliente; o CEO/comercial pode apagá-las à mão.
   */
  async function apagarRetidas() {
    const limite = iso(relogio() - RETENCAO_MS);
    const alvos = db.prepare(`SELECT DISTINCT o.id FROM orcamentos o JOIN fotos f ON f.orcamento_id = o.id
      WHERE o.estado != 'aceite' AND o.obra_id IS NULL AND o.atualizado < ?`).all(limite);
    let total = 0;
    for (const { id } of alvos) {
      const n = await apagarTodas(id);
      total += n;
      auditar(null, 'fotos_apagadas_retencao', `orcamento:${id}`, { fotos: n, criterio: '12 meses sem seguimento' });
    }
    if (total) registo.info(`retenção: ${total} fotos apagadas de ${alvos.length} pedidos sem seguimento há mais de 12 meses`);
    return { pedidos: alvos.length, fotos: total };
  }

  let temporizador = null;
  let primeira = null;
  function iniciar(intervaloMs = 24 * 3600_000) {
    const correr = () => apagarRetidas().catch((e) => registo.erro(`retenção das fotos: ${e?.stack || e}`));
    temporizador = setInterval(correr, intervaloMs);
    temporizador.unref();
    primeira = setTimeout(correr, 60_000);        // 1 min depois de arrancar, depois 1 vez por dia
    primeira.unref();
  }

  async function parar() {
    clearInterval(temporizador);
    clearTimeout(primeira);
    await Promise.allSettled([...emCurso]);
  }

  /** Espera pelas leituras em curso (testes). */
  const leiturasEmCurso = () => Promise.allSettled([...emCurso]);

  return {
    emitirToken, tokenFalso, receber, listar, contar, obter, ler, apagar, apagarTodas, apagarRetidas,
    leituraQuadro, lerQuadroAgora, iniciar, parar, leiturasEmCurso, ligada: Boolean(leitor),
  };
}
