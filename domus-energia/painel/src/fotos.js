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

/** Orientação (1 a 8) do bloco Exif de um JPEG, ou null. `d` são os dados do segmento APP1. */
function orientacaoExif(d) {
  if (d.length < 14 || d.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const t = d.subarray(6);
  const le = t.toString('latin1', 0, 2) === 'II';
  if (!le && t.toString('latin1', 0, 2) !== 'MM') return null;
  const u16 = (i) => (le ? t.readUInt16LE(i) : t.readUInt16BE(i));
  const ifd = le ? t.readUInt32LE(4) : t.readUInt32BE(4);
  if (ifd + 2 > t.length) return null;
  const n = u16(ifd);
  for (let i = 0, e = ifd + 2; i < n && e + 12 <= t.length; i += 1, e += 12) {
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/** Um bloco Exif mínimo, só com a orientação (para a foto não ficar deitada depois de limpa). */
function exifSoOrientacao(v) {
  return Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, v, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

/**
 * A foto sem os dados escondidos (2026-10-11): o sítio onde foi tirada (GPS), a data, o modelo do telemóvel e os
 * comentários. As fotos do cliente são mostradas a eletricistas que não podem saber a morada. No JPEG saem os blocos
 * APP1 (Exif, XMP), APP13 (IPTC), os outros APPn sem uso e os comentários; ficam o JFIF, o perfil de cor (APP2), o
 * Adobe (APP14) e a orientação. No PNG saem eXIf, tEXt, zTXt, iTXt e tIME. A imagem em si não é tocada. Um ficheiro
 * que não se consegue percorrer fica como veio.
 */
export function semMetadados(buf, tipo) {
  try {
    if (tipo === 'image/jpeg') {
      const partes = [buf.subarray(0, 2)];
      let i = 2, orientacao = null, tirou = false, ondeExif = 1;
      while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff) return buf;
        const m = buf[i + 1];
        if (m === 0xff) { i += 1; continue; }                       // enchimento
        if (m === 0xda || m === 0xd9) break;                        // começa a imagem (ou acaba): o resto vai tal e qual
        const fim = i + 2 + buf.readUInt16BE(i + 2);
        if (fim > buf.length || fim < i + 4) return buf;
        const fica = m === 0xe0 || m === 0xe2 || m === 0xee || !((m >= 0xe1 && m <= 0xef) || m === 0xfe);
        if (m === 0xe1 && orientacao === null) orientacao = orientacaoExif(buf.subarray(i + 4, fim));
        if (fica) { partes.push(buf.subarray(i, fim)); if (m === 0xe0) ondeExif = partes.length; } else tirou = true;
        i = fim;
      }
      if (!tirou) return buf;
      partes.push(buf.subarray(i));
      if (orientacao && orientacao !== 1) partes.splice(ondeExif, 0, exifSoOrientacao(orientacao));
      return Buffer.concat(partes);
    }
    if (tipo === 'image/png') {
      const partes = [buf.subarray(0, 8)];
      let i = 8, tirou = false;
      while (i + 12 <= buf.length) {
        const fim = i + 12 + buf.readUInt32BE(i);
        if (fim > buf.length) return buf;
        if (['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(buf.toString('latin1', i + 4, i + 8))) tirou = true; else partes.push(buf.subarray(i, fim));
        i = fim;
      }
      if (i !== buf.length || !tirou) return buf;
      return Buffer.concat(partes);
    }
  } catch { /* ficheiro estranho: fica como veio */ }
  return buf;
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
    let corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((e) => {
      if (e instanceof ErroApi && e.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw e;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    corpo = semMetadados(corpo, tipo);

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

  // ------------------------------------------------------------ aproveitar a foto de outro pedido
  /**
   * Copia a foto `chave` do pedido `deOrcamentoId` para o pedido `paraOrcamentoId` (decisão do dono, 2026-10-11: um
   * pedido novo de uma casa aproveita a foto do quadro que o cliente já deu noutro pedido dessa casa; quem chama
   * garante que os dois são da mesma conta e da mesma casa — conta.js aproveitarFotoQuadro). Ficheiro novo (id novo) na
   * pasta do pedido novo e linha nova em `fotos`: fica uma foto normal desse pedido (sai com ele ao apagar/anonimizar).
   * Se o pedido novo já tem uma foto com essa chave, não se mexe. Devolve a foto nova, ou null se não havia o que copiar.
   * Um ficheiro em falta lança erro (quem chama regista-o). A leitura automática NÃO se agenda de novo (não se paga duas
   * vezes pela mesma foto): se o pedido de origem tem a leitura feita dessa foto, vai com ela.
   */
  async function copiarFoto(deOrcamentoId, paraOrcamentoId, chave) {
    const origem = db.prepare('SELECT * FROM fotos WHERE orcamento_id = ? AND chave = ?').get(deOrcamentoId, chave);
    const jaTem = () => Boolean(db.prepare('SELECT 1 FROM fotos WHERE orcamento_id = ? AND chave = ?').get(paraOrcamentoId, chave));
    if (!origem || deOrcamentoId === paraOrcamentoId || jaTem()) return null;
    const corpo = await readFile(ficheiro(origem));
    const foto = { id: randomBytes(12).toString('hex'), orcamento_id: paraOrcamentoId, chave, tipo_mime: origem.tipo_mime, bytes: origem.bytes, legenda: origem.legenda, criado: iso(relogio()) };
    await mkdir(pasta(paraOrcamentoId), { recursive: true, mode: 0o700 });
    await escreverAtomico(ficheiro(foto), corpo);
    try {
      // Enquanto se copiava chegou uma foto nova com esta chave: fica a nova.
      if (jaTem()) { await unlink(ficheiro(foto)).catch(() => {}); return null; }
      db.prepare('INSERT INTO fotos (id, orcamento_id, chave, tipo_mime, bytes, legenda, criado) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(foto.id, paraOrcamentoId, chave, foto.tipo_mime, foto.bytes, foto.legenda, foto.criado);
    } catch (e) {
      await unlink(ficheiro(foto)).catch(() => {});
      throw e;
    }
    if (chave === 'quadro') {
      let lida = null;
      try { lida = JSON.parse(db.prepare('SELECT leitura_quadro FROM orcamentos WHERE id = ?').get(deOrcamentoId)?.leitura_quadro ?? 'null'); } catch { /* guardada estragada: fica sem leitura */ }
      if (lida?.estado === 'feita' && lida.foto_id === origem.id) gravarLeitura(paraOrcamentoId, { ...lida, foto_id: foto.id, copiada_de: deOrcamentoId });
    }
    registo.info(`orçamento ${paraOrcamentoId}: foto ${chave} aproveitada do orçamento ${deOrcamentoId} (${foto.bytes} bytes)`);
    return foto;
  }

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
    emitirToken, tokenFalso, receber, copiarFoto, listar, contar, obter, ler, apagar, apagarTodas, apagarRetidas,
    leituraQuadro, iniciar, parar, leiturasEmCurso, ligada: Boolean(leitor),
  };
}
