// App de diagnóstico de avarias (decisões do dono, 2026-10-24; web/diagnostico.html; docs/ELETRICISTAS.md "App de
// diagnóstico"): os diagnósticos feitos no telemóvel, sincronizados quando há rede.
// - Quem: os eletricistas aprovados (sessão da área do eletricista, /api/eletricista/diagnosticos*, só com o módulo
//   ELETRICISTAS ligado) e os utilizadores do painel, de qualquer papel (/painel/api/diagnosticos*). Não há conta nova.
// - Cada um vê os seus; o CEO vê todos no painel ("Diagnósticos"). Um diagnóstico de outro dá 404, como um que não existe.
// - Sincronização idempotente: o id (32 hex) é gerado no telemóvel; o mesmo id outra vez atualiza a mesma linha. Um
//   diagnóstico terminado (concluído ou parado) não volta a "em curso" (409: o telemóvel fica com o do servidor).
// - O servidor não conhece as árvores (web/diagnostico/arvores-*.js): guarda o percurso com os textos e valida a forma;
//   exige a barreira de segurança completa (as cinco regras de ouro e o EPI, manual B4.4 e B5.1).
// - Ligação opcional: o eletricista a um trabalho SEU (e fica o pedido desse trabalho); no painel, o CEO e o comercial a
//   um pedido. "Enviar para a ficha" preenche o diagnóstico da avaria pela mesma lógica e validação da ficha
//   (eletricistas.js gravarDiagnostico; api.js gravarDiagnosticoPedido).
// - Fotos: JPEG/PNG até 1 MB (verificadas pelos bytes, sem metadados), até FOTOS_POR_DIAGNOSTICO, fora da pasta pública.
// - RGPD: apagar um eletricista apaga os diagnósticos dele sem trabalho ligado (com as fotos) e tira a nota livre dos
//   outros; apagar a conta de um cliente tira dos diagnósticos ligados aos pedidos dele as fotos (fotos da casa, como as
//   da obra), a nota e a ligação.
// Na auditoria: criado, terminado, enviado para a ficha — sem texto escrito pelo autor.

import { readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, responder, lerJson, lerCorpo } from './http.js';
import { texto, numero, opcao, falha } from './validar.js';
import { LimiteTaxa } from './limite.js';
import { iso, escreverAtomico } from './util.js';
import { bytesDeImagem, FOTO_MAX_BYTES, semMetadados } from './fotos.js';
import { ESTADO_ARQUIVADO } from './db.js';

export const FOTOS_POR_DIAGNOSTICO = 6;
export const MAX_PASSOS = 200;
export const LIMITE_JSON = 128 * 1024;
export const RE_ID_DIAGNOSTICO = /^[a-f0-9]{32}$/;
export const RE_ID_FOTO_DIAGNOSTICO = /^[a-f0-9]{24}$/;
// As chaves da barreira de segurança (iguais às de web/diagnostico/motor.js REGRAS_OURO e EPI; o teste compara-as).
export const REGRAS_OURO = ['desligar', 'bloquear', 'verificar', 'terra', 'sinalizar'];
export const EPI = ['luvas', 'oculos', 'calcado', 'vestuario', 'ferramentas', 'instrumento', 'capacete'];
export const SINAIS_PERIGO = ['queimado', 'agua', 'aquecimento', 'faiscas', 'cabo'];
export const TIPOS_AVARIA = ['aberto', 'curto', 'terra', 'sobrecarga', 'outro'];
const ESTADOS = ['em_curso', 'concluido', 'parado'];
// As unidades das árvores (iguais a web/diagnostico/motor.js UNIDADES; o teste compara-as). "un." = uma contagem.
export const UNIDADES = ['V', 'kV', 'A', 'kA', 'mA', 'Ω', 'MΩ', 'ms', '%', 'm', 'h', 'kVA', 'lx', 'un.'];
const AVALIACOES = ['dentro', 'aviso', 'fora', 'abaixo', 'acima'];
const RE_ARVORE = /^[a-z][a-z0-9_-]{0,39}$/;
const RE_CHAVE = /^(sim|nao|nao_sei|v|lt|lf|o\d{1,2})$/;   // lt / lf: lista de verificação toda feita / com algo em falta
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const CAMPOS = ['id', 'arvore', 'arvore_versao', 'titulo', 'estado', 'seguranca', 'passos', 'causa', 'acao', 'tipo', 'perigo', 'nota', 'iniciado', 'terminado', 'trabalho_id', 'orcamento_id'];

const json = (s, omissao) => { try { return JSON.parse(s ?? 'null') ?? omissao; } catch { return omissao; } };
function dataIso(v, rotulo, obrigatorio = false) {
  if (v === undefined || v === null || v === '') { if (obrigatorio) falha(`Indique ${rotulo}.`); return null; }
  if (typeof v !== 'string' || !RE_ISO.test(v) || !Number.isFinite(Date.parse(v))) falha(`Diagnóstico: ${rotulo} inválida.`);
  return new Date(v).toISOString();
}
function chaves(v, rotulo, opcoes) {
  if (!Array.isArray(v) || v.some((k) => !opcoes.includes(k)) || new Set(v).size !== v.length) falha(`Diagnóstico: ${rotulo} inválido.`);
  return opcoes.filter((k) => v.includes(k));
}

/** A barreira de segurança: as cinco regras de ouro e todo o EPI marcados (como na app), com a hora. */
function seguranca(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) falha('Diagnóstico: falta a barreira de segurança.');
  for (const k of Object.keys(v)) if (!['epi', 'regras', 'quando'].includes(k)) falha('Diagnóstico: barreira de segurança com campos desconhecidos.');
  const regras = chaves(v.regras, 'regras de ouro', REGRAS_OURO);
  const epi = chaves(v.epi, 'EPI', EPI);
  if (regras.length !== REGRAS_OURO.length || epi.length !== EPI.length) falha('Diagnóstico: a barreira de segurança tem de estar toda confirmada (EPI e as cinco regras de ouro).');
  return { epi, regras, quando: dataIso(v.quando, 'a hora da barreira de segurança', true) };
}

function passos(v) {
  if (!Array.isArray(v) || v.length > MAX_PASSOS) falha(`Diagnóstico: os passos têm de ser uma lista (máx. ${MAX_PASSOS}).`);
  return v.map((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) falha(`Diagnóstico: passo ${i + 1} inválido.`);
    for (const k of Object.keys(p)) if (!['no', 'pergunta', 'resposta', 'chave', 'valor', 'unidade', 'avaliacao', 'limite', 'tensao', 'quando'].includes(k)) falha(`Diagnóstico: passo ${i + 1} com campo desconhecido.`);
    const r = {
      no: texto(p.no, `o nó do passo ${i + 1}`, { max: 40, obrigatorio: true, re: RE_ARVORE }),
      pergunta: texto(p.pergunta, `a pergunta do passo ${i + 1}`, { max: 300, obrigatorio: true }),
      resposta: texto(p.resposta, `a resposta do passo ${i + 1}`, { max: 160, obrigatorio: true }),
      chave: texto(p.chave, `a chave do passo ${i + 1}`, { max: 8, obrigatorio: true, re: RE_CHAVE }),
      tensao: p.tensao === true,
      quando: dataIso(p.quando, `a hora do passo ${i + 1}`, true),
    };
    if (p.valor !== undefined && p.valor !== null) {
      r.valor = numero(p.valor, `o valor do passo ${i + 1}`, { min: 0, max: 10_000_000, casas: 3 });
      r.unidade = opcao(p.unidade, `a unidade do passo ${i + 1}`, UNIDADES);
      if (p.avaliacao !== undefined && p.avaliacao !== null) r.avaliacao = opcao(p.avaliacao, `a avaliação do passo ${i + 1}`, AVALIACOES);
      const l = texto(p.limite, `o limite do passo ${i + 1}`, { max: 120 });
      if (l) r.limite = l;
    }
    return r;
  });
}

/**
 * @param {{db, config, relogio, auditar, eletricistas: () => object, gravarDiagnosticoPedido: Function}} ctx
 *   `gravarDiagnosticoPedido(orcamentoId, diagnostico, u, ip)`: o diagnóstico do pedido no painel (api.js), a mesma
 *   lógica de POST /painel/api/orcamentos/:id/diagnostico.
 */
export function criarDiagnosticos({ db, config, relogio, auditar, eletricistas = () => null, gravarDiagnosticoPedido }) {
  const agoraIso = () => iso(relogio());
  const limGuardar = new LimiteTaxa(600, 3600_000, relogio);
  const limFotos = new LimiteTaxa(config.limiteFotosHora, 3600_000, relogio);
  const esperar = (l, k) => {
    const s = l.espera(k);
    if (s) throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${s > 90 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`, { 'Retry-After': String(s) });
    l.registar(k);
  };
  const pasta = (id) => join(config.diagnosticosDir, id);
  const ficheiroFoto = (f) => join(pasta(f.diagnostico_id), `${f.id}.${EXTENSAO[f.tipo_mime]}`);

  // ---- quem: eletricista (`e`) ou utilizador do painel (`u`)
  const doEletricista = (e) => ({ origem: 'eletricista', coluna: 'eletricista_id', id: e.id, auditoria: { id: null, email: `eletricista:${e.id}` }, ceo: false, chave: `e${e.id}`, base: '/api/eletricista/diagnosticos' });
  const doPainel = (u) => ({ origem: 'painel', coluna: 'utilizador_id', id: u.id, auditoria: u, ceo: u.papel === 'ceo', papel: u.papel, chave: `u${u.id}`, base: '/painel/api/diagnosticos' });
  const eDele = (d, a) => d[a.coluna] === a.id && d.origem === a.origem;
  const NAO_ENCONTRADO = 'Diagnóstico não encontrado.';
  /** O diagnóstico `id` que `a` pode ver (o seu, ou qualquer um para o CEO), ou 404. */
  function visivel(idTexto, a) {
    const d = RE_ID_DIAGNOSTICO.test(idTexto) ? db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(idTexto) : null;
    if (!d || !(eDele(d, a) || a.ceo)) throw new ErroApi(404, NAO_ENCONTRADO);
    return d;
  }
  function doProprio(idTexto, a) {
    const d = visivel(idTexto, a);
    if (!eDele(d, a)) throw new ErroApi(404, NAO_ENCONTRADO);
    return d;
  }

  function autorDe(d) {
    if (d.origem === 'eletricista') {
      const e = d.eletricista_id ? db.prepare('SELECT nome FROM eletricistas WHERE id = ?').get(d.eletricista_id) : null;
      return { origem: 'eletricista', id: d.eletricista_id, nome: e?.nome ?? 'Eletricista apagado (RGPD)' };
    }
    const u = d.utilizador_id ? db.prepare('SELECT nome, papel FROM utilizadores WHERE id = ?').get(d.utilizador_id) : null;
    return { origem: 'painel', id: d.utilizador_id, nome: u?.nome ?? 'Utilizador apagado', papel: u?.papel ?? null };
  }
  const contarFotos = (id) => db.prepare('SELECT COUNT(*) AS n FROM diagnosticos_fotos WHERE diagnostico_id = ?').get(id).n;
  function resumo(d) {
    const ps = json(d.passos, []);
    return {
      id: d.id, arvore: d.arvore, arvore_versao: d.arvore_versao, titulo: d.titulo, estado: d.estado, tipo: d.tipo, causa: d.causa, perigo: d.perigo,
      autor: autorDe(d), trabalho_id: d.trabalho_id, orcamento_id: d.orcamento_id, iniciado: d.iniciado, terminado: d.terminado, ficha_enviada: d.ficha_enviada,
      passos: ps.length, valores_fora: ps.filter((p) => ['fora', 'abaixo', 'acima'].includes(p.avaliacao)).length, fotos: contarFotos(d.id), atualizado: d.atualizado,
    };
  }
  function completo(d, a) {
    const fotos = db.prepare('SELECT id, tipo_mime, bytes, criado FROM diagnosticos_fotos WHERE diagnostico_id = ? ORDER BY criado, id').all(d.id)
      .map((f) => ({ id: f.id, tipo: f.tipo_mime, bytes: f.bytes, criado: f.criado, url: `${a.base}/${d.id}/fotos/${f.id}` }));
    return { ...resumo(d), seguranca: json(d.seguranca, null), passos: json(d.passos, []), acao: d.acao, nota: d.nota, fotos, criado: d.criado };
  }

  // ---- guardar (sincronizar)
  function ligacao(v, a) {
    if (a.origem === 'eletricista') {
      if (v.orcamento_id !== undefined && v.orcamento_id !== null) falha('Diagnóstico: ligue a um dos seus trabalhos, não a um pedido.');
      if (v.trabalho_id === undefined || v.trabalho_id === null || v.trabalho_id === '') return { trabalho_id: null, orcamento_id: null };
      const t = Number.isInteger(v.trabalho_id) ? db.prepare('SELECT id, orcamento_id FROM trabalhos_eletricista WHERE id = ? AND eletricista_id = ?').get(v.trabalho_id, a.id) : null;
      if (!t) falha('Trabalho desconhecido: escolha um dos seus trabalhos.');
      return { trabalho_id: t.id, orcamento_id: t.orcamento_id };
    }
    if (v.trabalho_id !== undefined && v.trabalho_id !== null) falha('Diagnóstico: no painel liga-se a um pedido, não a um trabalho de eletricista.');
    if (v.orcamento_id === undefined || v.orcamento_id === null || v.orcamento_id === '') return { trabalho_id: null, orcamento_id: null };
    if (!['ceo', 'comercial'].includes(a.papel)) falha('Só o CEO e o comercial ligam um diagnóstico a um pedido.');
    const o = Number.isInteger(v.orcamento_id) ? db.prepare('SELECT id, estado FROM orcamentos WHERE id = ?').get(v.orcamento_id) : null;
    if (!o || o.estado === ESTADO_ARQUIVADO) falha('Pedido desconhecido: confirme o número do pedido.');
    return { trabalho_id: null, orcamento_id: o.id };
  }

  async function guardar(req, res, a, ip) {
    const v = await lerJson(req, CAMPOS, LIMITE_JSON);
    esperar(limGuardar, a.chave);
    const id = texto(v.id, 'o id do diagnóstico', { max: 32, obrigatorio: true, re: RE_ID_DIAGNOSTICO, reMsg: 'Diagnóstico: id inválido.' });
    const r = {
      arvore: texto(v.arvore, 'a árvore', { max: 40, obrigatorio: true, re: RE_ARVORE }),
      arvore_versao: numero(v.arvore_versao, 'a versão da árvore', { min: 1, max: 10_000, casas: 0, nulo: false }),
      titulo: texto(v.titulo, 'o título', { max: 120, obrigatorio: true }),
      estado: opcao(v.estado, 'o estado', ESTADOS),
      seguranca: seguranca(v.seguranca),
      passos: passos(v.passos ?? []),
      causa: texto(v.causa, 'a causa', { max: 500 }),
      acao: texto(v.acao, 'a ação', { max: 1000, multilinha: true }),
      tipo: opcao(v.tipo, 'o tipo de avaria', TIPOS_AVARIA, { obrigatorio: false }),
      perigo: opcao(v.perigo, 'o sinal de perigo', SINAIS_PERIGO, { obrigatorio: false }),
      nota: texto(v.nota, 'a nota', { max: 2000, multilinha: true }),
      iniciado: dataIso(v.iniciado, 'a data de início', true),
      terminado: dataIso(v.terminado, 'a data de fim'),
      ...ligacao(v, a),
    };
    if (r.estado === 'concluido' && (!r.causa || !r.acao)) falha('Diagnóstico concluído sem a causa e a ação.');
    if (r.estado === 'parado' && !r.perigo && !r.causa) falha('Diagnóstico parado sem o motivo.');
    if (r.estado !== 'em_curso' && !r.terminado) r.terminado = agoraIso();
    if (r.estado === 'em_curso') r.terminado = null;
    const agora = agoraIso();
    const existe = db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(id);
    if (existe && !eDele(existe, a)) throw new ErroApi(404, NAO_ENCONTRADO);
    if (existe && existe.estado !== 'em_curso' && r.estado === 'em_curso') throw new ErroApi(409, 'Este diagnóstico já foi terminado: fica o que está guardado.');
    const valores = [r.trabalho_id, r.orcamento_id, r.arvore, r.arvore_versao, r.titulo, r.estado, JSON.stringify(r.seguranca), JSON.stringify(r.passos),
      r.causa, r.acao, r.tipo, r.perigo, r.nota, r.iniciado, r.terminado, agora];
    if (existe) {
      db.prepare(`UPDATE diagnosticos SET trabalho_id = ?, orcamento_id = ?, arvore = ?, arvore_versao = ?, titulo = ?, estado = ?, seguranca = ?, passos = ?,
        causa = ?, acao = ?, tipo = ?, perigo = ?, nota = ?, iniciado = ?, terminado = ?, atualizado = ? WHERE id = ?`).run(...valores, id);
    } else {
      db.prepare(`INSERT INTO diagnosticos (trabalho_id, orcamento_id, arvore, arvore_versao, titulo, estado, seguranca, passos, causa, acao, tipo, perigo, nota,
        iniciado, terminado, atualizado, id, origem, eletricista_id, utilizador_id, criado) VALUES (${Array(21).fill('?').join(', ')})`)
        .run(...valores, id, a.origem, a.origem === 'eletricista' ? a.id : null, a.origem === 'painel' ? a.id : null, agora);
      auditar(a.auditoria, 'diagnostico_criado', `diagnostico:${id}`, { arvore: r.arvore, estado: r.estado, passos: r.passos.length, ligado: Boolean(r.trabalho_id || r.orcamento_id) }, ip);
    }
    if (r.estado !== 'em_curso' && existe?.estado !== r.estado) {
      auditar(a.auditoria, 'diagnostico_terminado', `diagnostico:${id}`, { arvore: r.arvore, estado: r.estado, tipo: r.tipo, perigo: r.perigo, passos: r.passos.length }, ip);
    }
    const d = db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(id);
    responder(res, existe ? 200 : 201, { diagnostico: completo(d, a) });
  }

  // ---- listas
  function listar(url, a) {
    const q = url.searchParams;
    const onde = [];
    const args = [];
    if (!a.ceo) { onde.push(`${a.coluna} = ? AND origem = ?`); args.push(a.id, a.origem); }
    else {
      const autor = /^(eletricista|utilizador):([1-9]\d{0,9})$/.exec(q.get('autor') ?? '');
      if (autor) { onde.push(autor[1] === 'eletricista' ? "origem = 'eletricista' AND eletricista_id = ?" : "origem = 'painel' AND utilizador_id = ?"); args.push(Number(autor[2])); }
    }
    if (ESTADOS.includes(q.get('estado'))) { onde.push('estado = ?'); args.push(q.get('estado')); }
    if (RE_ARVORE.test(q.get('arvore') ?? '')) { onde.push('arvore = ?'); args.push(q.get('arvore')); }
    if (q.get('ligado') === '1') onde.push('(trabalho_id IS NOT NULL OR orcamento_id IS NOT NULL)');
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('desde') ?? '')) { onde.push('iniciado >= ?'); args.push(`${q.get('desde')}T00:00:00.000Z`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('ate') ?? '')) { onde.push('iniciado <= ?'); args.push(`${q.get('ate')}T23:59:59.999Z`); }
    const linhas = db.prepare(`SELECT * FROM diagnosticos ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''} ORDER BY iniciado DESC, id LIMIT 500`).all(...args);
    const r = { diagnosticos: linhas.map(resumo) };
    if (a.ceo) {
      r.autores = [
        ...db.prepare("SELECT DISTINCT e.id, e.nome FROM diagnosticos d JOIN eletricistas e ON e.id = d.eletricista_id WHERE d.origem = 'eletricista' ORDER BY e.nome").all().map((x) => ({ chave: `eletricista:${x.id}`, nome: x.nome, origem: 'eletricista' })),
        ...db.prepare("SELECT DISTINCT u.id, u.nome FROM diagnosticos d JOIN utilizadores u ON u.id = d.utilizador_id WHERE d.origem = 'painel' ORDER BY u.nome").all().map((x) => ({ chave: `utilizador:${x.id}`, nome: x.nome, origem: 'painel' })),
      ];
    }
    return r;
  }

  // ---- fotos
  async function receberFoto(req, res, a, params) {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!EXTENSAO[tipo]) throw new ErroApi(415, 'A foto tem de ser JPEG ou PNG (Content-Type: image/jpeg ou image/png).');
    if (!RE_ID_FOTO_DIAGNOSTICO.test(params.foto)) throw new ErroApi(404, 'Foto não encontrada.');
    const d = doProprio(params.id, a);
    esperar(limFotos, a.chave);
    let corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((erro) => {
      if (erro instanceof ErroApi && erro.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw erro;
    });
    const ja = db.prepare('SELECT diagnostico_id FROM diagnosticos_fotos WHERE id = ?').get(params.foto);
    if (ja) {
      if (ja.diagnostico_id !== d.id) throw new ErroApi(404, 'Foto não encontrada.');
      return responder(res, 200, { ok: true, id: params.foto, fotos: contarFotos(d.id) });   // a mesma foto outra vez (sincronização)
    }
    if (contarFotos(d.id) >= FOTOS_POR_DIAGNOSTICO) throw new ErroApi(409, `Este diagnóstico já tem o máximo de ${FOTOS_POR_DIAGNOSTICO} fotos.`);
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    corpo = semMetadados(corpo, tipo);
    const f = { id: params.foto, diagnostico_id: d.id, tipo_mime: tipo };
    await escreverAtomico(ficheiroFoto(f), corpo);
    try {
      db.prepare('INSERT INTO diagnosticos_fotos (id, diagnostico_id, tipo_mime, bytes, criado) VALUES (?, ?, ?, ?, ?)').run(f.id, d.id, tipo, corpo.length, agoraIso());
    } catch (erro) {
      await unlink(ficheiroFoto(f)).catch(() => {});
      throw erro;
    }
    responder(res, 201, { ok: true, id: f.id, fotos: contarFotos(d.id) });
  }

  async function enviarFoto(res, a, params) {
    const d = visivel(params.id, a);
    const f = RE_ID_FOTO_DIAGNOSTICO.test(params.foto) ? db.prepare('SELECT * FROM diagnosticos_fotos WHERE id = ? AND diagnostico_id = ?').get(params.foto, d.id) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    let corpo;
    try { corpo = await readFile(ficheiroFoto(f)); } catch { throw new ErroApi(404, 'Foto não encontrada.'); }
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': f.tipo_mime, 'Content-Length': corpo.length, 'Cache-Control': 'private, no-store',
    });
    res.end(corpo);
  }

  // ---- "Enviar para a ficha"
  async function ficha(req, res, a, params, ip, gravar) {
    const v = await lerJson(req, ['diagnostico'], 16 * 1024);
    const d = doProprio(params.id, a);
    if (v.diagnostico === undefined || v.diagnostico === null) falha('Falta o diagnóstico para a ficha.');
    gravar(d, v.diagnostico);
    const agora = agoraIso();
    db.prepare('UPDATE diagnosticos SET ficha_enviada = ?, atualizado = ? WHERE id = ?').run(agora, agora, d.id);
    auditar(a.auditoria, 'diagnostico_enviado_ficha', `diagnostico:${d.id}`, a.origem === 'eletricista' ? { trabalho: d.trabalho_id } : { orcamento: d.orcamento_id }, ip);
    responder(res, 200, { diagnostico: completo(db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(d.id), a) });
  }

  // ---- RGPD
  /** Apagar um eletricista (dentro da transação de eletricistas.js apagar): devolve as pastas de fotos a apagar depois. */
  function aoApagarEletricista(eletricistaId) {
    const sem = db.prepare("SELECT id FROM diagnosticos WHERE origem = 'eletricista' AND eletricista_id = ? AND trabalho_id IS NULL").all(eletricistaId).map((x) => x.id);
    for (const id of sem) {
      db.prepare('DELETE FROM diagnosticos WHERE id = ?').run(id);   // as fotos saem em cascata
      db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`diagnostico:${id}`);
    }
    db.prepare("UPDATE diagnosticos SET nota = NULL WHERE origem = 'eletricista' AND eletricista_id = ?").run(eletricistaId);
    return sem;
  }
  async function apagarPastas(ids) {
    for (const id of ids ?? []) if (RE_ID_DIAGNOSTICO.test(id)) await rm(pasta(id), { recursive: true, force: true });
  }
  /** Conta de cliente apagada (conta.js apagar, por cada pedido que sai ou é anonimizado): sem fotos da casa, nota nem ligação. */
  async function aoApagarPedido(orcamentoId) {
    const ids = db.prepare('SELECT id FROM diagnosticos WHERE orcamento_id = ?1 OR trabalho_id IN (SELECT id FROM trabalhos_eletricista WHERE orcamento_id = ?1)').all(orcamentoId).map((x) => x.id);
    for (const id of ids) {
      db.prepare('DELETE FROM diagnosticos_fotos WHERE diagnostico_id = ?').run(id);
      db.prepare('UPDATE diagnosticos SET nota = NULL, orcamento_id = NULL, trabalho_id = NULL, atualizado = ? WHERE id = ?').run(agoraIso(), id);
    }
    await apagarPastas(ids);
  }

  // ---- os handlers das duas áreas
  const gravarNoTrabalho = (e, ip) => (d, valor) => {
    if (!d.trabalho_id) throw new ErroApi(409, 'Ligue primeiro o diagnóstico a um trabalho de avaria.');
    const el = eletricistas();
    if (!el) throw new ErroApi(404, 'Endereço desconhecido.');
    el.gravarDiagnostico(e, String(d.trabalho_id), valor, ip);
  };
  const gravarNoPedido = (u, ip) => (d, valor) => {
    if (!d.orcamento_id) throw new ErroApi(409, 'Ligue primeiro o diagnóstico a um pedido.');
    gravarDiagnosticoPedido(d.orcamento_id, valor, u, ip);
  };
  const eletricista = {
    diagnosticosLista: ({ res, e, url }) => responder(res, 200, listar(url, doEletricista(e))),
    diagnosticoGuardar: ({ req, res, e, ip }) => guardar(req, res, doEletricista(e), ip),
    diagnosticoVer: ({ res, e, params }) => { const a = doEletricista(e); responder(res, 200, { diagnostico: completo(visivel(params.id, a), a) }); },
    diagnosticoFicha: ({ req, res, e, params, ip }) => ficha(req, res, doEletricista(e), params, ip, gravarNoTrabalho(e, ip)),
    diagnosticoFoto: ({ res, e, params }) => enviarFoto(res, doEletricista(e), params),
    diagnosticoReceberFoto: ({ req, res, e, params }) => receberFoto(req, res, doEletricista(e), params),
  };
  const painel = {
    lista: ({ res, u, url }) => responder(res, 200, listar(url, doPainel(u))),
    guardar: ({ req, res, u, ip }) => guardar(req, res, doPainel(u), ip),
    ver: ({ res, u, params }) => { const a = doPainel(u); responder(res, 200, { diagnostico: completo(visivel(params.id, a), a) }); },
    ficha: ({ req, res, u, params, ip }) => ficha(req, res, doPainel(u), params, ip, gravarNoPedido(u, ip)),
    foto: ({ res, u, params }) => enviarFoto(res, doPainel(u), params),
    receberFoto: ({ req, res, u, params }) => receberFoto(req, res, doPainel(u), params),
  };
  return { eletricista, painel, aoApagarEletricista, apagarPastas, aoApagarPedido };
}

