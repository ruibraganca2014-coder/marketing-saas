// Procedimentos (SOP / base de conhecimento) e checklists por obra (decisões do dono de 2026-10-03;
// docs/PROCEDIMENTOS.md). Um procedimento por tipo de trabalho: título, descrição e passos ordenados (texto curto, nota
// opcional, "obrigatório" e "segurança"), só texto simples. Só o CEO cria, edita, publica e arquiva; não há sugestões.
// O CEO trabalha numa cópia (`procedimentos`); cada publicação fica numa versão imutável (`procedimentos_versoes`), que
// é o que os técnicos, o comercial e os eletricistas externos leem — os rascunhos e os arquivados só o CEO os vê.
// Checklists: numa obra começa-se a checklist de um procedimento publicado (cada procedimento uma vez por obra); fica
// presa à versão com que começou. Marcam os passos o técnico da obra, o eletricista externo desse trabalho (rotas em
// eletricistas.js) e o CEO; cada marca guarda quem e quando. Nada disto impede a obra de ficar concluída: a tarefa
// "Confirmar obra concluída" do CEO diz quando faltam passos obrigatórios (tarefas.js). Os textos dos passos nunca vão
// para a auditoria nem para o registo: só números (procedimento, versão, checklist, passo).

import { ErroApi, responder, lerJson } from './http.js';
import { texto, opcao, idNum, falha, booleano } from './validar.js';
import { TIPOS_PROCEDIMENTO, transacao } from './db.js';
import { iso } from './util.js';

export const MAX_PASSOS = 40;
export const MAX_TITULO = 120;
export const MAX_DESCRICAO = 600;
export const MAX_PASSO = 200;
export const MAX_NOTA = 1000;
export const NOME_TIPO_PROCEDIMENTO = {
  visita: 'Visita técnica', diagnostico: 'Diagnóstico de avaria', quadro: 'Quadro elétrico', aparelhos: 'Aparelhos inteligentes',
  carregador: 'Carregador de veículo elétrico', entrega: 'Entrega ao cliente', outro: 'Outro',
};
/** A nota no cimo de cada rascunho de arranque (migração 36), até o CEO o publicar. */
export const NOTA_RASCUNHO = 'Rascunho por rever: os passos de segurança têm de ser validados pelo responsável técnico antes de publicar.';

/** Passos validados: [{texto, nota, obrigatorio, seguranca}], sempre com os quatro campos e por esta ordem. */
export function validarPassos(v) {
  if (!Array.isArray(v)) falha('Os passos têm de ser uma lista.');
  if (v.length > MAX_PASSOS) falha(`Demasiados passos (máx. ${MAX_PASSOS}).`);
  return v.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) falha(`Passo ${i + 1}: inválido.`);
    for (const k of Object.keys(x)) if (!['texto', 'nota', 'obrigatorio', 'seguranca'].includes(k)) falha(`Passo ${i + 1}: campo desconhecido "${k}".`);
    return {
      texto: texto(x.texto, `o texto do passo ${i + 1}`, { max: MAX_PASSO, obrigatorio: true }),
      nota: texto(x.nota, `a nota do passo ${i + 1}`, { max: MAX_NOTA, multilinha: true }),
      obrigatorio: x.obrigatorio === undefined ? false : booleano(x.obrigatorio, `passo ${i + 1}: obrigatório`),
      seguranca: x.seguranca === undefined ? false : booleano(x.seguranca, `passo ${i + 1}: segurança`),
    };
  });
}

export function criarProcedimentos({ db, relogio, auditar }) {
  const agoraIso = () => iso(relogio());
  const passosDe = (json) => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; } };
  const nomeUtilizador = db.prepare('SELECT nome FROM utilizadores WHERE id = ?');
  const nomeEletricista = db.prepare('SELECT nome FROM eletricistas WHERE id = ?');
  const versaoDe = db.prepare('SELECT * FROM procedimentos_versoes WHERE procedimento_id = ? AND versao = ?');
  const linha = (id) => db.prepare('SELECT * FROM procedimentos WHERE id = ?').get(id) ?? null;

  // ------------------------------------------------------------ biblioteca
  /** O CEO mudou a cópia de trabalho depois da última publicação (ou nunca publicou)? */
  function porPublicar(p, v = versaoDe.get(p.id, p.versao)) {
    return !v || v.titulo !== p.titulo || v.tipo !== p.tipo || (v.descricao ?? null) !== (p.descricao ?? null) || v.passos !== p.passos;
  }

  /** O procedimento como o CEO o vê: a cópia de trabalho, o estado e o que está publicado. */
  function paraCeo(p, completo = false) {
    const v = p.versao ? versaoDe.get(p.id, p.versao) : null;
    const passos = passosDe(p.passos);
    const r = {
      id: p.id, titulo: p.titulo, tipo: p.tipo, tipo_nome: NOME_TIPO_PROCEDIMENTO[p.tipo] ?? p.tipo, descricao: p.descricao ?? null, estado: p.estado,
      versao: p.versao, publicado: v?.publicado ?? null, publicado_por: v?.publicado_por_id ? nomeUtilizador.get(v.publicado_por_id)?.nome ?? null : null,
      por_rever: Boolean(p.por_rever), aviso: p.por_rever ? NOTA_RASCUNHO : null, por_publicar: porPublicar(p, v),
      n_passos: passos.length, atualizado: p.atualizado,
    };
    if (completo) {
      r.passos = passos;
      r.em_obras = db.prepare('SELECT COUNT(*) AS n FROM obra_checklists WHERE procedimento_id = ?').get(p.id).n;
    }
    return r;
  }

  /** A versão publicada, como a leem a equipa e (sem `comQuem`) os eletricistas externos. */
  function paraLeitura(p, v, completo = false, comQuem = true) {
    const passos = passosDe(v.passos);
    const r = {
      id: p.id, titulo: v.titulo, tipo: v.tipo, tipo_nome: NOME_TIPO_PROCEDIMENTO[v.tipo] ?? v.tipo, descricao: v.descricao ?? null, estado: 'publicado',
      versao: v.versao, publicado: v.publicado, n_passos: passos.length,
    };
    if (comQuem) r.publicado_por = v.publicado_por_id ? nomeUtilizador.get(v.publicado_por_id)?.nome ?? null : null;
    if (completo) r.passos = passos;
    return r;
  }

  /** Os procedimentos publicados (a última versão de cada um), por título. */
  function publicados(comQuem = true) {
    return db.prepare("SELECT * FROM procedimentos WHERE estado = 'publicado' AND versao > 0 ORDER BY titulo COLLATE NOCASE, id").all()
      .map((p) => paraLeitura(p, versaoDe.get(p.id, p.versao), false, comQuem));
  }
  /** Um procedimento publicado (404 para um rascunho, um arquivado ou um que não existe: quem não é CEO não sabe que existem). */
  function publicado(idTexto, comQuem = true) {
    const p = linha(idNum(idTexto));
    if (!p || p.estado !== 'publicado' || !p.versao) throw new ErroApi(404, 'Procedimento não encontrado.');
    return paraLeitura(p, versaoDe.get(p.id, p.versao), true, comQuem);
  }

  const CAMPOS = ['titulo', 'tipo', 'descricao', 'passos'];
  function campos(v, parcial) {
    const r = {};
    if (!parcial || v.titulo !== undefined) r.titulo = texto(v.titulo, 'o título', { max: MAX_TITULO, obrigatorio: true });
    if (!parcial || v.tipo !== undefined) r.tipo = opcao(v.tipo, 'tipo de trabalho', TIPOS_PROCEDIMENTO);
    if (v.descricao !== undefined) r.descricao = texto(v.descricao, 'a descrição', { max: MAX_DESCRICAO, multilinha: true });
    if (v.passos !== undefined) r.passos = JSON.stringify(validarPassos(v.passos));
    return r;
  }

  // ------------------------------------------------------------ checklists de uma obra
  const checklistsDe = db.prepare(`SELECT c.*, v.versao, v.titulo, v.tipo, v.passos FROM obra_checklists c JOIN procedimentos_versoes v ON v.id = c.versao_id
    WHERE c.obra_id = ? ORDER BY c.id`);
  const marcasDe = db.prepare('SELECT * FROM obra_checklist_passos WHERE checklist_id = ?');
  const contar = (passos, feitos) => ({
    feitos: passos.filter((_, i) => feitos.has(i)).length, total: passos.length,
    obrigatorios_falta: passos.filter((x, i) => x.obrigatorio && !feitos.has(i)).length,
  });

  /** O resumo das checklists de uma obra (para a lista de obras): {n, feitos, total, obrigatorios_falta}, ou null sem nenhuma. */
  function resumoObra(obraId) {
    const listas = checklistsDe.all(obraId);
    if (!listas.length) return null;
    const r = { n: listas.length, feitos: 0, total: 0, obrigatorios_falta: 0 };
    for (const c of listas) {
      const x = contar(passosDe(c.passos), new Set(marcasDe.all(c.id).map((m) => m.passo)));
      r.feitos += x.feitos; r.total += x.total; r.obrigatorios_falta += x.obrigatorios_falta;
    }
    return r;
  }

  /**
   * Quem marcou (ou começou), pelo nome de agora: um utilizador desativado continua com o seu nome; um eletricista
   * apagado pelo RGPD aparece como ficou ("Eletricista apagado (RGPD)"). `visao`: {papel} no painel (o nome do
   * eletricista externo só para o CEO) ou {eletricista} na área do eletricista (só o próprio nome; o resto é "Domus Energia").
   */
  function quemFoi(utilizadorId, eletricistaId, visao) {
    if (visao.eletricista) return eletricistaId === visao.eletricista ? nomeEletricista.get(eletricistaId)?.nome ?? 'Eletricista' : 'Domus Energia';
    if (eletricistaId) return visao.papel === 'ceo' ? `${nomeEletricista.get(eletricistaId)?.nome ?? 'Eletricista'} (eletricista externo)` : 'Eletricista externo';
    return utilizadorId ? nomeUtilizador.get(utilizadorId)?.nome ?? null : null;
  }

  /** As checklists de uma obra com cada passo (feito, por quem e quando) e os procedimentos publicados que ainda se podem começar. */
  function daObra(obraId, visao) {
    const listas = checklistsDe.all(obraId).map((c) => {
      const passos = passosDe(c.passos);
      const marcas = new Map(marcasDe.all(c.id).map((m) => [m.passo, m]));
      const atual = linha(c.procedimento_id);
      return {
        id: c.id, procedimento_id: c.procedimento_id, titulo: c.titulo, tipo: c.tipo, versao: c.versao,
        // O procedimento já tem uma versão publicada mais recente: esta checklist continua com a dela.
        versao_recente: atual && atual.estado === 'publicado' && atual.versao > c.versao ? atual.versao : null,
        iniciada: c.iniciada, iniciada_por: quemFoi(c.iniciada_por_id, c.iniciada_por_eletricista_id, visao),
        passos: passos.map((x, i) => {
          const m = marcas.get(i);
          return { texto: x.texto, nota: x.nota ?? null, obrigatorio: Boolean(x.obrigatorio), seguranca: Boolean(x.seguranca), feito: Boolean(m),
            por: m ? quemFoi(m.por_id, m.por_eletricista_id, visao) : null, quando: m?.quando ?? null };
        }),
        ...contar(passos, new Set(marcas.keys())),
      };
    });
    const usados = new Set(listas.map((c) => c.procedimento_id));
    return {
      checklists: listas,
      disponiveis: publicados(false).filter((p) => !usados.has(p.id)).map((p) => ({ id: p.id, titulo: p.titulo, tipo: p.tipo, tipo_nome: p.tipo_nome, versao: p.versao, n_passos: p.n_passos })),
    };
  }

  /** Começa na obra a checklist de um procedimento publicado, presa à versão publicada neste momento. `quem`: {utilizador} ou {eletricista}. */
  function iniciar(obraId, procedimentoId, quem, ip = null) {
    if (!Number.isInteger(procedimentoId) || procedimentoId < 1) falha('Indique o procedimento.');
    const p = linha(procedimentoId);
    if (!p || p.estado !== 'publicado' || !p.versao) {
      // Só o CEO sabe que os rascunhos existem.
      if (p && quem.utilizador?.papel === 'ceo') throw new ErroApi(409, 'Só se começa a checklist de um procedimento publicado.');
      throw new ErroApi(404, 'Procedimento não encontrado.');
    }
    if (db.prepare('SELECT 1 FROM obra_checklists WHERE obra_id = ? AND procedimento_id = ?').get(obraId, p.id)) throw new ErroApi(409, 'Esta obra já tem a checklist deste procedimento.');
    const v = versaoDe.get(p.id, p.versao);
    const id = Number(db.prepare('INSERT INTO obra_checklists (obra_id, procedimento_id, versao_id, iniciada, iniciada_por_id, iniciada_por_eletricista_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(obraId, p.id, v.id, agoraIso(), quem.utilizador?.id ?? null, quem.eletricista?.id ?? null).lastInsertRowid);
    auditar(quem.utilizador ?? { id: null, email: `eletricista:${quem.eletricista.id}` }, 'obra_checklist_iniciada', `obra:${obraId}`, { checklist: id, procedimento: p.id, versao: p.versao }, ip);
    return id;
  }

  /**
   * Marca ou desmarca um passo. Marcar um passo já marcado não muda quem o marcou nem quando; desmarcar apaga a marca.
   * A checklist tem de ser desta obra (404).
   */
  function marcar(obraId, checklistTexto, v, quem, ip = null) {
    const c = db.prepare('SELECT c.*, v.passos FROM obra_checklists c JOIN procedimentos_versoes v ON v.id = c.versao_id WHERE c.id = ? AND c.obra_id = ?').get(idNum(checklistTexto), obraId);
    if (!c) throw new ErroApi(404, 'Checklist não encontrada.');
    if (!Number.isInteger(v.passo) || v.passo < 0 || v.passo >= passosDe(c.passos).length) falha('Passo inválido.');
    const feito = booleano(v.feito, 'feito');
    const r = feito
      ? db.prepare('INSERT OR IGNORE INTO obra_checklist_passos (checklist_id, passo, quando, por_id, por_eletricista_id) VALUES (?, ?, ?, ?, ?)').run(c.id, v.passo, agoraIso(), quem.utilizador?.id ?? null, quem.eletricista?.id ?? null)
      : db.prepare('DELETE FROM obra_checklist_passos WHERE checklist_id = ? AND passo = ?').run(c.id, v.passo);
    if (r.changes) auditar(quem.utilizador ?? { id: null, email: `eletricista:${quem.eletricista.id}` }, 'obra_checklist_passo', `obra:${obraId}`, { checklist: c.id, passo: v.passo + 1, feito }, ip);
  }

  /** Para a tarefa "Confirmar obra concluída" do CEO: a frase sobre os passos obrigatórios em falta nas checklists da obra, ou null. */
  function avisoObra(obraId) {
    const n = resumoObra(obraId)?.obrigatorios_falta ?? 0;
    return n ? `Checklists da obra: ${n === 1 ? 'falta 1 passo obrigatório' : `faltam ${n} passos obrigatórios`} por marcar.` : null;
  }

  // ------------------------------------------------------------ handlers do painel
  const h = {};

  // A biblioteca: o CEO vê tudo (rascunhos e arquivados incluídos); os outros só os publicados, na versão publicada.
  h.procedimentos = ({ res, u }) => {
    if (u.papel !== 'ceo') return responder(res, 200, { procedimentos: publicados(), tipos: NOME_TIPO_PROCEDIMENTO });
    const ordem = { publicado: 0, rascunho: 1, arquivado: 2 };
    const todos = db.prepare('SELECT * FROM procedimentos ORDER BY titulo COLLATE NOCASE, id').all().map((p) => paraCeo(p)).sort((a, b) => ordem[a.estado] - ordem[b.estado]);
    return responder(res, 200, { procedimentos: todos, tipos: NOME_TIPO_PROCEDIMENTO, limites: { passos: MAX_PASSOS, titulo: MAX_TITULO, descricao: MAX_DESCRICAO, passo: MAX_PASSO, nota: MAX_NOTA } });
  };

  h.procedimento = ({ res, u, params }) => {
    if (u.papel !== 'ceo') return responder(res, 200, publicado(params.id));
    const p = linha(idNum(params.id));
    if (!p) throw new ErroApi(404, 'Procedimento não encontrado.');
    return responder(res, 200, paraCeo(p, true));
  };

  h.criarProcedimento = async ({ req, res, u, ip }) => {
    const r = campos(await lerJson(req, CAMPOS, 128 * 1024), false);
    const agora = agoraIso();
    const id = Number(db.prepare("INSERT INTO procedimentos (titulo, tipo, descricao, passos, estado, versao, por_rever, criado, criado_por_id, atualizado) VALUES (?, ?, ?, ?, 'rascunho', 0, 0, ?, ?, ?)")
      .run(r.titulo, r.tipo, r.descricao ?? null, r.passos ?? '[]', agora, u.id, agora).lastInsertRowid);
    auditar(u, 'procedimento_criado', `procedimento:${id}`, { tipo: r.tipo, passos: passosDe(r.passos ?? '[]').length }, ip);
    responder(res, 201, paraCeo(linha(id), true));
  };

  // Editar mexe só na cópia de trabalho: a equipa continua a ver a versão publicada até o CEO publicar outra vez.
  h.atualizarProcedimento = async ({ req, res, u, params, ip }) => {
    const p = linha(idNum(params.id));
    if (!p) throw new ErroApi(404, 'Procedimento não encontrado.');
    const r = campos(await lerJson(req, CAMPOS, 128 * 1024), true);
    if (p.estado === 'arquivado') throw new ErroApi(409, 'Procedimento arquivado: reponha-o para o alterar.');
    const cols = Object.keys(r);
    if (!cols.length) falha('Nada para alterar.');
    db.prepare(`UPDATE procedimentos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado = ? WHERE id = ?`).run(...cols.map((k) => r[k]), agoraIso(), p.id);
    auditar(u, 'procedimento_atualizado', `procedimento:${p.id}`, { campos: cols, ...(r.passos ? { passos: passosDe(r.passos).length } : {}) }, ip);
    responder(res, 200, paraCeo(linha(p.id), true));
  };

  // Publicar (a versão sobe quando o conteúdo mudou), arquivar e repor (um arquivado volta a rascunho).
  h.estadoProcedimento = async ({ req, res, u, params, ip }) => {
    const p = linha(idNum(params.id));
    if (!p) throw new ErroApi(404, 'Procedimento não encontrado.');
    const acao = opcao((await lerJson(req, ['acao'])).acao, 'ação', ['publicar', 'arquivar', 'repor']);
    const agora = agoraIso();
    if (acao === 'publicar') {
      if (p.estado === 'arquivado') throw new ErroApi(409, 'Procedimento arquivado: reponha-o primeiro.');
      if (!passosDe(p.passos).length) falha('Um procedimento sem passos não se publica.');
      const mudou = porPublicar(p);
      if (!mudou && p.estado === 'publicado') throw new ErroApi(409, 'Não há alterações por publicar.');
      const versao = mudou ? p.versao + 1 : p.versao;
      transacao(db, () => {
        if (mudou) {
          db.prepare('INSERT INTO procedimentos_versoes (procedimento_id, versao, titulo, tipo, descricao, passos, publicado, publicado_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(p.id, versao, p.titulo, p.tipo, p.descricao ?? null, p.passos, agora, u.id);
        }
        db.prepare("UPDATE procedimentos SET estado = 'publicado', versao = ?, por_rever = 0, atualizado = ? WHERE id = ?").run(versao, agora, p.id);
      });
      auditar(u, 'procedimento_publicado', `procedimento:${p.id}`, { versao }, ip);
    } else if (acao === 'arquivar') {
      if (p.estado === 'arquivado') throw new ErroApi(409, 'O procedimento já está arquivado.');
      db.prepare("UPDATE procedimentos SET estado = 'arquivado', atualizado = ? WHERE id = ?").run(agora, p.id);
      auditar(u, 'procedimento_arquivado', `procedimento:${p.id}`, null, ip);
    } else {
      if (p.estado !== 'arquivado') throw new ErroApi(409, 'Só se repõe um procedimento arquivado.');
      db.prepare("UPDATE procedimentos SET estado = 'rascunho', atualizado = ? WHERE id = ?").run(agora, p.id);
      auditar(u, 'procedimento_reposto', `procedimento:${p.id}`, null, ip);
    }
    responder(res, 200, paraCeo(linha(p.id), true));
  };

  // ---- checklists na ficha da obra (ecrã Obras). Ler: quem vê a obra (o técnico só as suas). Começar e marcar: o CEO e
  // o técnico atribuído à obra (a rota já deixa o comercial de fora).
  function obraPara(idTexto, u) {
    const o = db.prepare('SELECT id FROM obras WHERE id = ?').get(idNum(idTexto));
    if (!o) throw new ErroApi(404, 'Obra não encontrada.');
    if (u.papel === 'tecnico' && !db.prepare('SELECT 1 FROM obra_tecnicos WHERE obra_id = ? AND utilizador_id = ?').get(o.id, u.id)) throw new ErroApi(403, 'Esta obra não lhe está atribuída.');
    return o;
  }
  const fichaObra = (o, u) => ({ ...daObra(o.id, { papel: u.papel }), pode: u.papel !== 'comercial', resumo: resumoObra(o.id) });

  h.checklistsObra = ({ res, u, params }) => responder(res, 200, fichaObra(obraPara(params.id, u), u));

  h.iniciarChecklist = async ({ req, res, u, params, ip }) => {
    const o = obraPara(params.id, u);
    const v = await lerJson(req, ['procedimento_id']);
    iniciar(o.id, v.procedimento_id, { utilizador: u }, ip);
    responder(res, 201, fichaObra(o, u));
  };

  h.marcarPassoChecklist = async ({ req, res, u, params, ip }) => {
    const o = obraPara(params.id, u);
    const v = await lerJson(req, ['passo', 'feito']);
    marcar(o.id, params.lista, v, { utilizador: u }, ip);
    responder(res, 200, fichaObra(o, u));
  };

  return { h, publicados, publicado, daObra, resumoObra, iniciar, marcar, avisoObra };
}
