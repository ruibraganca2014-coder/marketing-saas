// Quadro de tarefas do painel (decisões do dono de 2026-10-03; docs/CRM-TAREFAS.md): tarefas com descrição, ligação
// opcional a um cliente, pedido ou obra, responsável (NULL = os CEO), prazo (dia e hora opcional), estado (A fazer /
// Em curso / Feito) e checklist; a semana (tarefas com prazo + obras agendadas) e a contagem do menu. Os lembretes
// automáticos do CRM (pedido novo sem contacto ao fim de 1 dia útil; visita feita e proposta por enviar ao fim de 2
// dias; proposta sem resposta aos 3, 7 e 14 dias — prazos editáveis pelo CEO) nascem aqui, ao ler (e de 15 em 15
// minutos), uma só vez cada um (chave única), e cancelam-se sozinhos quando a fase do pedido avança. Só o CEO vê e
// atribui todas as tarefas; o comercial e o técnico só as suas. O email diário das 08:00 (Lisboa) também sai daqui.

import { ErroApi, responder, lerJson } from './http.js';
import { texto, opcao, idNum, dia, hora, falha, booleano } from './validar.js';
import { ESTADOS_TAREFA, ESTADO_ARQUIVADO } from './db.js';
import { iso, diaLisboa, semanaLisboa, somarDiasCivil } from './util.js';
import { horaLisboa, agoraLisboa } from './crm.js';

const DIA_MS = 24 * 3600_000;
const MAX_CHECKLIST = 50;
const dias = (d, util = false) => `${d} ${d === 1 ? 'dia' : 'dias'}${util ? (d === 1 ? ' útil' : ' úteis') : ''}`;
/**
 * Tipos de lembrete automático: título e texto (`d` = o prazo em dias, da configuração), e o nome sem dados do
 * cliente que vai no email diário. Os nomes dos tipos ficaram dos prazos de origem (são só identificadores).
 */
const LEMBRETES = {
  novo_24h: { titulo: (n) => `Ligar a ${n} — pedido novo`, neutro: 'ligar ao cliente (pedido novo)',
    texto: (d) => `Pedido novo há mais de ${dias(d, true)} sem contacto registado. Ligue ao cliente e registe o contacto na ficha (o pedido passa a "Contactado").` },
  visita_2d: { titulo: (n) => `Enviar proposta — ${n}`, neutro: 'enviar a proposta (visita feita)',
    texto: (d) => `A visita foi há mais de ${dias(d)} e a proposta ainda não foi enviada. Prepare e envie a proposta ao cliente.` },
  proposta_3d: { titulo: (n) => `Seguir proposta — ${n}`, neutro: 'seguir a proposta',
    texto: (d) => `A proposta foi enviada há ${dias(d)} e o cliente ainda não a aceitou. Contacte o cliente.` },
  proposta_7d: { titulo: (n, d) => `Seguir proposta — ${n} (${dias(d)})`, neutro: 'seguir a proposta (segundo aviso)',
    texto: (d) => `A proposta foi enviada há ${dias(d)} e o cliente ainda não a aceitou. Contacte o cliente outra vez.` },
  proposta_14d: { titulo: (n) => `Perdido? — ${n}`, neutro: 'decidir se o pedido está perdido',
    texto: (d) => `A proposta foi enviada há ${dias(d)} sem resposta. Decida: marcar o pedido como perdido (com o motivo) ou continuar a seguir. A fase só muda quando decidir.` },
};
/**
 * Tarefas automáticas que não são lembretes do CRM (emails-auto.js; docs/EMAILS-AUTOMATICOS.md): nascem uma vez (a mesma
 * chave única) e não se cancelam com a fase do pedido. `d`: os dias sem pagar, ou as estrelas da avaliação.
 */
const AUTOMATICAS = {
  obra_confirmar: { titulo: (n) => `Confirmar obra concluída — ${n}`, neutro: 'confirmar a obra concluída',
    texto: () => 'O técnico marcou a obra como concluída no ecrã Obras. O cliente ainda não foi avisado: só depois de carregar em "Marcar obra concluída" na ficha do pedido é que o cliente é avisado, o restante é pedido e os emails automáticos (pagamento em falta, depois da obra) começam.' },
  pagamento_falta: { titulo: (n) => `Ligar a ${n} — pagamento em falta`, neutro: 'ligar ao cliente (pagamento em falta)',
    texto: (d) => `O cliente foi lembrado duas vezes por email e o pagamento continua por fazer há ${dias(d)}. Ligue-lhe. Já não saem mais lembretes automáticos.` },
  avaliacao_baixa: { titulo: (n) => `Avaliação baixa — ligar a ${n}`, neutro: 'ligar ao cliente (avaliação baixa)',
    texto: (d) => `O cliente avaliou o trabalho com ${d} em 5 estrelas. Urgente: ligue-lhe para perceber o que não correu bem.` },
};
/**
 * Prazos dos lembretes (`config_orcamento`, editáveis pelo CEO no ecrã Tarefas; os limites são validados em api.js
 * `CONFIG_ORCAMENTO`): o valor por omissão de cada um.
 */
export const PRAZOS_LEMBRETES = { lembrete_novo_dias_uteis: 1, lembrete_visita_dias: 2, lembrete_proposta_1_dias: 3, lembrete_proposta_2_dias: 7, lembrete_proposta_3_dias: 14 };
/** Hora (Lisboa) a partir da qual sai o email diário das tarefas. */
const HORA_RESUMO = '08:00';

/** Feriados nacionais de data fixa ("MM-DD"); os móveis (Sexta-feira Santa, Páscoa e Corpo de Deus) calculam-se em `feriadoNacional`. */
const FERIADOS_FIXOS = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'];

/** Se o dia "AAAA-MM-DD" é feriado nacional português (os municipais não contam). */
export function feriadoNacional(d) {
  if (FERIADOS_FIXOS.includes(d.slice(5))) return true;
  // Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher).
  const ano = Number(d.slice(0, 4));
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascoa = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  return [-2, 0, 60].some((n) => somarDiasCivil(pascoa, n) === d);
}

/**
 * Quando faz `n` dias úteis (segunda a sexta, Lisboa; sem os feriados nacionais) depois de `local` ("AAAA-MM-DDTHH:MM"
 * de Lisboa): a mesma hora `n` dias úteis depois; um sábado, domingo ou feriado conta a partir das 00:00 do dia útil seguinte.
 * Sexta às 15:00 + 1 → segunda às 15:00; sábado ou domingo + 1 → terça às 00:00.
 */
export function aposDiasUteis(local, n) {
  const naoUtil = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) || feriadoNacional(d);
  let d = local.slice(0, 10), hm = local.slice(11, 16);
  if (naoUtil(d)) { hm = '00:00'; while (naoUtil(d)) d = somarDiasCivil(d, 1); }
  for (let i = 0; i < n; i++) { d = somarDiasCivil(d, 1); while (naoUtil(d)) d = somarDiasCivil(d, 1); }
  return `${d}T${hm}`;
}

export function criarTarefas({ db, config, relogio, auditar, crm, registo, correio }) {
  const agoraIso = () => iso(relogio());

  /** Os prazos dos lembretes em vigor (o que o CEO guardou; senão o valor por omissão). */
  function prazos() {
    const cfg = Object.fromEntries(db.prepare("SELECT chave, valor FROM config_orcamento WHERE chave LIKE 'lembrete%'").all().map((r) => [r.chave, r.valor]));
    return Object.fromEntries(Object.entries(PRAZOS_LEMBRETES).map(([k, omissao]) => [k, Number.isInteger(cfg[k]) && cfg[k] >= 1 ? cfg[k] : omissao]));
  }

  // ------------------------------------------------------------ lembretes automáticos
  /** O lembrete que o pedido merece agora (só o mais recente das etapas), ou null. */
  function lembreteDe(o, agora, pz) {
    // Visita marcada cuja data já passou há `lembrete_visita_dias` e ainda sem proposta (sem hora: conta do fim do dia).
    // A chave leva a data da visita: remarcar a visita dá um lembrete novo.
    if (o.estado === 'visita_marcada') {
      if (!o.data_visita) return null;
      const hm = o.data_visita.slice(11, 16);
      const devido = `${somarDiasCivil(o.data_visita.slice(0, 10), pz.lembrete_visita_dias + (hm ? 0 : 1))}T${hm || '00:00'}`;
      return agoraLisboa(agora) >= devido ? { tipo: 'visita_2d', d: pz.lembrete_visita_dias, chave: `${o.id}:visita_2d:${o.data_visita}` } : null;
    }
    const fase = crm.faseDe(o);
    if (fase !== 'novo' && !(fase === 'proposta' && !o.proposta_aceite)) return null;
    const desde = crm.desdeFase(o);
    const passou = agora - Date.parse(desde);
    if (!Number.isFinite(passou)) return null;
    let tipo = null, d = null;
    if (fase === 'novo') {
      // Dias úteis (segunda a sexta, Lisboa): um pedido de sexta à tarde só pede a chamada na segunda à mesma hora.
      d = pz.lembrete_novo_dias_uteis;
      tipo = agoraLisboa(agora) >= aposDiasUteis(agoraLisboa(Date.parse(desde)), d) ? 'novo_24h' : null;
    } else {
      [tipo, d] = [['proposta_14d', pz.lembrete_proposta_3_dias], ['proposta_7d', pz.lembrete_proposta_2_dias], ['proposta_3d', pz.lembrete_proposta_1_dias]]
        .find(([, n]) => passou >= n * DIA_MS) ?? [null, null];
    }
    return tipo ? { tipo, d, chave: `${o.id}:${tipo}:${desde}` } : null;
  }

  /**
   * Liga os pedidos novos às fichas, cancela os lembretes abertos que já não se aplicam (a fase avançou, ou passou à
   * etapa seguinte) e cria os que faltam. Idempotente: a chave `lembrete` é única (um lembrete feito ou ainda aberto
   * nunca volta a nascer); uma proposta reenviada (nova data na auditoria) tem chaves novas. Um lembrete cancelado sem
   * ter sido feito que volta a ser devido (o CEO mudou os prazos) reabre-se em vez de nascer outro.
   */
  function lembretes() {
    crm.ligarPedidos();
    const agora = relogio();
    const pz = prazos();
    const pedidos = new Map(db.prepare(`SELECT * FROM orcamentos WHERE estado IN ('novo', 'contactado', 'visita_marcada', 'proposta_enviada') AND anonimizado IS NULL`).all().map((o) => [o.id, o]));
    const devidos = new Map();
    for (const o of pedidos.values()) { const l = lembreteDe(o, agora, pz); if (l) devidos.set(l.chave, { o, ...l }); }
    let n = 0;
    for (const t of db.prepare("SELECT id, lembrete, orcamento_id FROM tarefas WHERE lembrete IS NOT NULL AND cancelada IS NULL AND estado != 'feito'").all()) {
      // Só os lembretes do CRM: as outras tarefas automáticas (pagamento em falta, avaliação baixa) não dependem da fase.
      if (!LEMBRETES[t.lembrete.split(':')[1]] || devidos.has(t.lembrete)) continue;
      db.prepare('UPDATE tarefas SET cancelada = ?, atualizado = ? WHERE id = ? AND cancelada IS NULL').run(agoraIso(), agoraIso(), t.id);
      auditar(null, 'tarefa_cancelada', `tarefa:${t.id}`, { lembrete: t.lembrete.split(':')[1] ?? null, orcamento: t.orcamento_id, motivo: 'a fase do pedido avançou' });
    }
    // "Confirmar obra concluída": sai sozinha quando o CEO confirma no pedido ou a obra deixa de estar concluída.
    cancelarAutomaticas('obra_confirmar', new Set(db.prepare(POR_CONFIRMAR).all().map((x) => `${x.id}:obra_confirmar:${x.obra}`)), 'a obra foi confirmada no pedido ou deixou de estar concluída');
    const existe = db.prepare('SELECT id, cancelada, estado FROM tarefas WHERE lembrete = ?');
    const respAtivo = db.prepare('SELECT 1 FROM utilizadores WHERE id = ? AND ativo = 1');
    for (const { o, tipo, d, chave } of devidos.values()) {
      const ja = existe.get(chave);
      if (ja) {
        if (ja.cancelada && ja.estado !== 'feito') {
          db.prepare('UPDATE tarefas SET cancelada = NULL, atualizado = ? WHERE id = ?').run(agoraIso(), ja.id);
          auditar(null, 'tarefa_reaberta', `tarefa:${ja.id}`, { lembrete: tipo, orcamento: o.id, motivo: 'o lembrete voltou a ser devido' });
        }
        continue;
      }
      const cliResp = o.crm_cliente_id ? db.prepare('SELECT responsavel_id FROM crm_clientes WHERE id = ?').get(o.crm_cliente_id)?.responsavel_id : null;
      // O responsável do pedido; senão o do cliente; senão os CEO (NULL).
      const resp = [o.responsavel_id, cliResp].find((x) => x && respAtivo.get(x)) ?? null;
      const agoraTxt = agoraIso();
      const r = db.prepare(`INSERT OR IGNORE INTO tarefas (titulo, descricao, cliente_id, orcamento_id, responsavel_id, prazo, estado, lembrete, criado, criado_por, atualizado)
        VALUES (?, ?, ?, ?, ?, ?, 'a_fazer', ?, ?, 'sistema', ?)`).run(LEMBRETES[tipo].titulo(o.nome, d), LEMBRETES[tipo].texto(d), o.crm_cliente_id ?? null, o.id, resp,
        diaLisboa(new Date(agora)), chave, agoraTxt, agoraTxt);
      if (r.changes) {
        n++;
        auditar(null, 'tarefa_criada', `tarefa:${r.lastInsertRowid}`, { lembrete: tipo, orcamento: o.id, responsavel_id: resp });
      }
    }
    return n;
  }
  crm.aoLer(() => lembretes());

  /**
   * As obras concluídas no ecrã Obras cujo pedido (aceite) ainda não tem "Obra concluída" confirmada pelo CEO: o cliente
   * não foi avisado nem o restante pedido. Obras sem pedido (ou de um pedido anonimizado) ficam de fora.
   */
  const POR_CONFIRMAR = `SELECT o.*, b.id AS obra FROM obras b JOIN orcamentos o ON o.id = b.orcamento_id
    WHERE b.estado = 'concluida' AND o.estado = 'aceite' AND o.obra_concluida IS NULL AND o.anonimizado IS NULL`;

  /**
   * Tarefa automática fora do CRM (`AUTOMATICAS`), para os CEO (sem responsável) e com o prazo de hoje, ligada ao pedido,
   * à ficha do cliente e (`obraId`) à obra. Idempotente: a chave `<pedido>:<tipo>:…` é única (feita ou aberta, nunca
   * nasce outra); uma que foi cancelada sem ter sido feita e volta a ser devida reabre-se, como os lembretes do CRM.
   */
  function criarAutomatica(tipo, o, chave, d, obraId = null) {
    const agoraTxt = agoraIso();
    const ja = db.prepare('SELECT id, cancelada, estado FROM tarefas WHERE lembrete = ?').get(chave);
    if (ja) {
      if (!ja.cancelada || ja.estado === 'feito') return false;
      db.prepare('UPDATE tarefas SET cancelada = NULL, prazo = ?, atualizado = ? WHERE id = ?').run(diaLisboa(new Date(relogio())), agoraTxt, ja.id);
      auditar(null, 'tarefa_reaberta', `tarefa:${ja.id}`, { lembrete: tipo, orcamento: o.id, motivo: 'voltou a ser devida' });
      return true;
    }
    const r = db.prepare(`INSERT OR IGNORE INTO tarefas (titulo, descricao, cliente_id, orcamento_id, obra_id, responsavel_id, prazo, estado, lembrete, criado, criado_por, atualizado)
      VALUES (?, ?, ?, ?, ?, NULL, ?, 'a_fazer', ?, ?, 'sistema', ?)`).run(AUTOMATICAS[tipo].titulo(o.nome), AUTOMATICAS[tipo].texto(d), o.crm_cliente_id ?? null, o.id, obraId,
      diaLisboa(new Date(relogio())), chave, agoraTxt, agoraTxt);
    if (r.changes) auditar(null, 'tarefa_criada', `tarefa:${r.lastInsertRowid}`, { lembrete: tipo, orcamento: o.id, responsavel_id: null });
    return Boolean(r.changes);
  }
  /**
   * A obra passou a concluída no ecrã Obras (api.js atualizarObra): tarefa "Confirmar obra concluída — <cliente>" para
   * os CEO, uma por obra. Daqui não se avisa o cliente nem se mexe no pedido: isso é o CEO que faz, na ficha do pedido.
   */
  function obraPorConfirmar(obraId) {
    crm.ligarPedidos();
    const o = db.prepare(`${POR_CONFIRMAR} AND b.id = ?`).get(obraId);
    return o ? criarAutomatica('obra_confirmar', o, `${o.id}:obra_confirmar:${obraId}`, null, obraId) : false;
  }
  /** Cancela (como os lembretes do CRM) as tarefas automáticas abertas do `tipo` cuja chave já não está em `devidas`. */
  function cancelarAutomaticas(tipo, devidas, motivo) {
    for (const t of db.prepare("SELECT id, lembrete, orcamento_id FROM tarefas WHERE lembrete LIKE ? AND cancelada IS NULL AND estado != 'feito'").all(`%:${tipo}:%`)) {
      if (devidas.has(t.lembrete)) continue;
      db.prepare('UPDATE tarefas SET cancelada = ?, atualizado = ? WHERE id = ? AND cancelada IS NULL').run(agoraIso(), agoraIso(), t.id);
      auditar(null, 'tarefa_cancelada', `tarefa:${t.id}`, { lembrete: tipo, orcamento: t.orcamento_id, motivo });
    }
  }

  // ------------------------------------------------------------ utilidades
  const nomeCliente = db.prepare('SELECT nome FROM crm_clientes WHERE id = ?');
  function estadoPrazo(t, agora = relogio()) {
    if (!t.prazo || t.estado === 'feito') return { atrasada: false, hoje: false };
    const hoje = diaLisboa(new Date(agora));
    const atrasada = t.prazo < hoje || (t.prazo === hoje && Boolean(t.prazo_hora) && t.prazo_hora < horaLisboa(agora));
    return { atrasada, hoje: !atrasada && t.prazo === hoje };
  }
  function formatar(t) {
    let checklist = [];
    try { checklist = JSON.parse(t.checklist); } catch { /* ignorado */ }
    return {
      id: t.id, titulo: t.titulo, descricao: t.descricao, estado: t.estado, prazo: t.prazo, prazo_hora: t.prazo_hora, checklist,
      cliente_id: t.cliente_id, cliente_nome: t.cliente_id ? nomeCliente.get(t.cliente_id)?.nome ?? null : null,
      orcamento_id: t.orcamento_id, obra_id: t.obra_id,
      responsavel_id: t.responsavel_id, responsavel_nome: t.responsavel_id ? crm.nomeDe(t.responsavel_id) : null,
      automatica: t.lembrete ? t.lembrete.split(':')[1] ?? true : null, cancelada: t.cancelada ?? null,
      criado: t.criado, criado_por: t.criado_por, feito: t.feito ?? null, feito_por: t.feito_por ?? null, atualizado: t.atualizado,
      ...estadoPrazo(t),
    };
  }
  /** Só o CEO vê o quadro todo; o comercial e o técnico só as tarefas de que são responsáveis ou que criaram. */
  const visivel = (t, u) => u.papel === 'ceo' || t.responsavel_id === u.id || t.criado_por_id === u.id;
  /** "As minhas": de que sou responsável; para os CEO também as sem responsável (os lembretes sem dono). */
  const minha = (t, u) => t.responsavel_id === u.id || (t.responsavel_id === null && u.papel === 'ceo');

  function obter(s, u) {
    const t = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(idNum(s));
    // Quem não é CEO não sabe que existem as tarefas que não vê (404).
    if (!t || !visivel(t, u)) throw new ErroApi(404, 'Tarefa não encontrada.');
    return t;
  }

  function checklist(v) {
    if (!Array.isArray(v)) falha('A checklist tem de ser uma lista.');
    if (v.length > MAX_CHECKLIST) falha(`Demasiados itens na checklist (máx. ${MAX_CHECKLIST}).`);
    return v.map((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) falha(`Checklist ${i + 1}: inválido.`);
      for (const k of Object.keys(x)) if (!['texto', 'feito'].includes(k)) falha(`Checklist ${i + 1}: campo desconhecido "${k}".`);
      return { texto: texto(x.texto, `o item ${i + 1} da checklist`, { max: 200, obrigatorio: true }), feito: x.feito === undefined ? false : booleano(x.feito, `checklist ${i + 1}: feito`) };
    });
  }

  const CAMPOS = ['titulo', 'descricao', 'cliente_id', 'orcamento_id', 'obra_id', 'responsavel_id', 'prazo', 'prazo_hora', 'estado', 'checklist'];
  /**
   * Campos validados. Só o CEO atribui a outra pessoa (ou aos CEO, com null): o comercial e o técnico só a si próprios
   * (uma tarefa que o CEO passou a outra pessoa guarda-se sem mudar o responsável). O técnico liga só às suas obras
   * (nunca a clientes ou pedidos).
   */
  function campos(v, u, atual) {
    const r = {};
    const tecnico = u.papel === 'tecnico';
    if (!atual || v.titulo !== undefined) r.titulo = texto(v.titulo, 'o título', { max: 160, obrigatorio: true });
    if (v.descricao !== undefined) r.descricao = texto(v.descricao, 'a descrição', { max: 4000, multilinha: true });
    if (tecnico && ((v.cliente_id !== undefined && v.cliente_id !== (atual?.cliente_id ?? null)) || (v.orcamento_id !== undefined && v.orcamento_id !== (atual?.orcamento_id ?? null)))) {
      throw new ErroApi(403, 'O técnico só liga tarefas às suas obras.');
    }
    if (v.cliente_id !== undefined) {
      if (v.cliente_id !== null && !(Number.isInteger(v.cliente_id) && db.prepare('SELECT 1 FROM crm_clientes WHERE id = ? AND anonimizado IS NULL').get(v.cliente_id))) falha('Cliente inexistente.');
      r.cliente_id = v.cliente_id;
    }
    if (v.orcamento_id !== undefined) {
      const o = v.orcamento_id === null ? null : Number.isInteger(v.orcamento_id) ? db.prepare('SELECT id, estado, crm_cliente_id FROM orcamentos WHERE id = ?').get(v.orcamento_id) : null;
      if (v.orcamento_id !== null && (!o || o.estado === ESTADO_ARQUIVADO)) falha('Pedido de orçamento inexistente.');
      r.orcamento_id = v.orcamento_id;
      // Ligada a um pedido sem cliente indicado: fica também ligada à ficha do cliente desse pedido.
      if (o?.crm_cliente_id && v.cliente_id === undefined) r.cliente_id = o.crm_cliente_id;
    }
    if (v.obra_id !== undefined) {
      if (v.obra_id !== null && !(Number.isInteger(v.obra_id) && db.prepare('SELECT 1 FROM obras WHERE id = ?').get(v.obra_id))) falha('Obra inexistente.');
      if (tecnico && v.obra_id !== null && v.obra_id !== (atual?.obra_id ?? null)
        && !db.prepare('SELECT 1 FROM obra_tecnicos WHERE obra_id = ? AND utilizador_id = ?').get(v.obra_id, u.id)) throw new ErroApi(403, 'O técnico só liga tarefas às suas obras.');
      r.obra_id = v.obra_id;
    }
    if (v.responsavel_id !== undefined) {
      if (u.papel !== 'ceo' && v.responsavel_id !== u.id && !(atual && v.responsavel_id === atual.responsavel_id)) throw new ErroApi(403, 'Só o CEO atribui tarefas a outra pessoa: pode atribuí-las a si.');
      r.responsavel_id = crm.responsavel(v.responsavel_id);
    }
    if (v.prazo !== undefined) r.prazo = dia(v.prazo, 'o prazo');
    if (v.prazo_hora !== undefined) r.prazo_hora = hora(v.prazo_hora, 'a hora do prazo');
    if (v.estado !== undefined) r.estado = opcao(v.estado, 'estado', ESTADOS_TAREFA);
    if (v.checklist !== undefined) r.checklist = JSON.stringify(checklist(v.checklist));
    const prazo = r.prazo !== undefined ? r.prazo : atual?.prazo ?? null;
    if (r.prazo_hora && !prazo) falha('Indique o dia do prazo (a hora é opcional).');
    if (prazo === null && atual?.prazo_hora && r.prazo !== undefined) r.prazo_hora = null;
    return r;
  }

  // ------------------------------------------------------------ handlers
  const h = {};

  // Lista (quadro ou "As minhas"): ?vista=minhas | todas (omissão), ?estado=, ?responsavel=, ?cliente=, ?orcamento=, ?obra=.
  h.tarefas = ({ res, u, url }) => {
    lembretes();
    const q = url.searchParams;
    const vista = q.get('vista') ? opcao(q.get('vista'), 'vista', ['minhas', 'todas']) : 'todas';
    const estado = q.get('estado') ? opcao(q.get('estado'), 'estado', ESTADOS_TAREFA) : null;
    const num = (k) => { const x = q.get(k); if (x === null) return null; if (!/^[1-9]\d{0,9}$/.test(x)) falha(`Filtro ${k} inválido.`); return Number(x); };
    const resp = num('responsavel'), cliente = num('cliente'), orcamento = num('orcamento'), obra = num('obra');
    // As feitas há mais de 30 dias saem do quadro (ficam na base; aparecem filtrando por "Feito").
    const limite = iso(relogio() - 30 * DIA_MS);
    const lista = db.prepare('SELECT * FROM tarefas WHERE cancelada IS NULL ORDER BY (prazo IS NULL), prazo, prazo_hora, id DESC LIMIT 2000').all()
      .filter((t) => visivel(t, u) && (vista !== 'minhas' || minha(t, u)) && (!estado || t.estado === estado)
        && (estado === 'feito' || t.estado !== 'feito' || (t.feito ?? t.atualizado) >= limite)
        && (!resp || t.responsavel_id === resp) && (!cliente || t.cliente_id === cliente) && (!orcamento || t.orcamento_id === orcamento) && (!obra || t.obra_id === obra));
    responder(res, 200, { tarefas: lista.map(formatar), equipa: u.papel === 'ceo' ? crm.equipa() : [{ id: u.id, nome: crm.nomeDe(u.id), papel: u.papel }] });
  };

  h.criarTarefa = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, CAMPOS, 64 * 1024);
    const r = campos(v, u, null);
    // Sem responsável indicado: quem a cria. (null explícito = os CEO.)
    if (v.responsavel_id === undefined) r.responsavel_id = u.id;
    const estado = r.estado ?? 'a_fazer';
    const agora = agoraIso();
    const cols = Object.keys(r).filter((k) => k !== 'estado');
    const id = Number(db.prepare(`INSERT INTO tarefas (${cols.join(', ')}, estado, criado, criado_por, criado_por_id, feito, feito_por, atualizado)
      VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?)`).run(...cols.map((k) => r[k]), estado, agora, u.email, u.id,
      estado === 'feito' ? agora : null, estado === 'feito' ? u.email : null, agora).lastInsertRowid);
    // Na auditoria sem o título nem a descrição (podem ter o nome do cliente).
    auditar(u, 'tarefa_criada', `tarefa:${id}`, { estado, responsavel_id: r.responsavel_id ?? null, prazo: r.prazo ?? null, orcamento: r.orcamento_id ?? null, obra: r.obra_id ?? null }, ip);
    responder(res, 201, formatar(db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id)));
  };

  h.atualizarTarefa = async ({ req, res, u, params, ip }) => {
    const t = obter(params.id, u);
    const v = await lerJson(req, CAMPOS, 64 * 1024);
    if (t.cancelada) throw new ErroApi(409, 'Lembrete cancelado (a fase do pedido avançou): já não se altera.');
    const r = campos(v, u, t);
    if (!Object.keys(r).length) falha('Nada para alterar.');
    const agora = agoraIso();
    if (r.estado && r.estado !== t.estado) {
      r.feito = r.estado === 'feito' ? agora : null;
      r.feito_por = r.estado === 'feito' ? u.email : null;
    }
    const cols = Object.keys(r);
    db.prepare(`UPDATE tarefas SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado = ? WHERE id = ?`).run(...cols.map((k) => r[k]), agora, t.id);
    const det = { campos: cols.filter((k) => !['feito', 'feito_por'].includes(k)) };
    if (r.estado) det.estado = r.estado;
    if ('responsavel_id' in r) det.responsavel_id = r.responsavel_id;
    auditar(u, 'tarefa_atualizada', `tarefa:${t.id}`, det, ip);
    responder(res, 200, formatar(db.prepare('SELECT * FROM tarefas WHERE id = ?').get(t.id)));
  };

  // Apagar: o CEO, ou quem a criou. Os lembretes automáticos não se apagam (marcam-se como feitos): senão voltavam a nascer.
  h.apagarTarefa = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    const t = obter(params.id, u);
    if (t.lembrete) throw new ErroApi(409, 'Os lembretes automáticos não se apagam: marque-o como feito.');
    if (u.papel !== 'ceo' && t.criado_por_id !== u.id) throw new ErroApi(403, 'Só o CEO ou quem criou a tarefa a pode apagar.');
    db.prepare('DELETE FROM tarefas WHERE id = ?').run(t.id);
    auditar(u, 'tarefa_apagada', `tarefa:${t.id}`, null, ip);
    responder(res, 200, { ok: true });
  };

  // A semana (segunda a domingo, Lisboa) que contém ?de= (ou hoje): as tarefas com prazo nesses dias e as obras
  // agendadas (só leitura; o técnico vê as suas, o comercial e o CEO todas). As tarefas: as que cada um vê.
  h.calendarioTarefas = ({ res, u, url }) => {
    lembretes();
    const de = url.searchParams.get('de') ? dia(url.searchParams.get('de'), 'a data', { obrigatorio: true }) : diaLisboa(new Date(relogio()));
    const { inicio, fim } = semanaLisboa(new Date(`${de}T12:00:00Z`));
    const tarefas = db.prepare('SELECT * FROM tarefas WHERE cancelada IS NULL AND prazo BETWEEN ? AND ? ORDER BY prazo, (prazo_hora IS NULL), prazo_hora, id').all(inicio, fim)
      .filter((t) => visivel(t, u)).map(formatar);
    const obras = db.prepare(`SELECT o.* FROM obras o ${u.papel === 'tecnico' ? 'JOIN obra_tecnicos t ON t.obra_id = o.id AND t.utilizador_id = ?' : ''}
      WHERE o.data BETWEEN ? AND ? AND o.estado != 'cancelada' ORDER BY o.data, o.hora, o.id`).all(...(u.papel === 'tecnico' ? [u.id, inicio, fim] : [inicio, fim]))
      .map((b) => ({
        id: b.id, data: b.data, hora: b.hora, estado: b.estado, por_agendar: Boolean(b.por_agendar), orcamento_id: b.orcamento_id,
        cliente_nome: b.cliente ? db.prepare('SELECT nome FROM fichas_cliente WHERE codigo = ?').get(b.cliente)?.nome ?? b.cliente
          : b.orcamento_id ? db.prepare('SELECT nome FROM orcamentos WHERE id = ?').get(b.orcamento_id)?.nome ?? null : null,
      }));
    const dias = Array.from({ length: 7 }, (_, i) => somarDiasCivil(inicio, i));
    responder(res, 200, { inicio, fim, hoje: diaLisboa(new Date(relogio())), dias, tarefas, obras });
  };

  // Contagem do menu: as minhas tarefas por fazer que estão atrasadas ou são para hoje.
  h.contagemTarefas = ({ res, u }) => {
    lembretes();
    let atrasadas = 0, hoje = 0;
    for (const t of db.prepare("SELECT * FROM tarefas WHERE cancelada IS NULL AND estado != 'feito' AND prazo IS NOT NULL").all()) {
      if (!minha(t, u)) continue;
      const e = estadoPrazo(t);
      if (e.atrasada) atrasadas++; else if (e.hoje) hoje++;
    }
    responder(res, 200, { atrasadas, hoje, total: atrasadas + hoje });
  };

  // ------------------------------------------------------------ email diário (08:00 de Lisboa)
  const dataPt = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  /**
   * Um email por utilizador ativo do painel com as suas tarefas por fazer atrasadas e para hoje (os CEO: também as sem
   * responsável), na primeira passagem depois das 08:00 de Lisboa. Sem tarefas não sai nada. Nunca dois no mesmo dia:
   * o dia fica em `utilizadores.resumo_tarefas_dia` ANTES de enviar (também vale depois de reiniciar o painel; um
   * envio falhado não se repete). O email NÃO leva os títulos nem as descrições (podem ter o nome do cliente; e sem
   * SMTP o email é escrito no registo): só o número, o prazo e, nos lembretes automáticos, o tipo e o pedido.
   */
  function resumoDiario() {
    const agora = relogio();
    if (horaLisboa(agora) < HORA_RESUMO) return 0;
    const hoje = diaLisboa(new Date(agora));
    const porTratar = db.prepare('SELECT id, nome, email, papel FROM utilizadores WHERE ativo = 1 AND (resumo_tarefas_dia IS NULL OR resumo_tarefas_dia < ?) ORDER BY id').all(hoje);
    if (!porTratar.length) return 0;
    lembretes();
    const abertas = db.prepare("SELECT * FROM tarefas WHERE cancelada IS NULL AND estado != 'feito' AND prazo IS NOT NULL AND prazo <= ? ORDER BY prazo, (prazo_hora IS NULL), prazo_hora, id").all(hoje);
    const painel = config?.origens?.[0] ? ['', `Painel: ${config.origens[0]}/painel/#/tarefas`] : [];
    const linha = (t) => `- Tarefa n.º ${t.id}${t.prazo < hoje ? ` · prazo ${dataPt(t.prazo)}` : ''}${t.prazo_hora ? ` · ${t.prazo_hora}` : ''}`
      + `${t.lembrete ? ` · lembrete automático: ${(LEMBRETES[t.lembrete.split(':')[1]] ?? AUTOMATICAS[t.lembrete.split(':')[1]])?.neutro ?? 'CRM'}` : ''}${t.orcamento_id ? ` · pedido n.º ${t.orcamento_id}` : ''}`
      + `${t.obra_id ? ` · obra n.º ${t.obra_id}` : ''}${t.responsavel_id === null ? ' · sem responsável' : ''}`;
    let n = 0;
    for (const u of porTratar) {
      db.prepare('UPDATE utilizadores SET resumo_tarefas_dia = ? WHERE id = ?').run(hoje, u.id);
      const minhas = abertas.filter((t) => minha(t, u));
      if (!minhas.length) continue;
      const atrasadas = minhas.filter((t) => t.prazo < hoje), deHoje = minhas.filter((t) => t.prazo === hoje);
      const total = `${minhas.length} ${minhas.length === 1 ? 'tarefa' : 'tarefas'}`;
      correio.enviar({
        para: u.email, assunto: `Domus Energia: ${total} para tratar hoje`, resumo: `email diário das tarefas ao utilizador ${u.id}: ${atrasadas.length} atrasadas, ${deHoje.length} para hoje`,
        texto: [`Olá ${u.nome},`, '', `Tem ${total} por fazer: ${atrasadas.length} ${atrasadas.length === 1 ? 'atrasada' : 'atrasadas'} e ${deHoje.length} para hoje.`,
          ...(atrasadas.length ? ['', 'Atrasadas:', ...atrasadas.map(linha)] : []), ...(deHoje.length ? ['', 'Para hoje:', ...deHoje.map(linha)] : []),
          '', 'Os títulos não vão neste email (podem ter o nome de clientes): estão no painel, em "Tarefas".', ...painel, '', 'Domus Energia'].join('\n'),
      });
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------ de 15 em 15 minutos (como os pagamentos e os eletricistas)
  // O email diário verifica-se de minuto a minuto (só uma leitura dos utilizadores; sai logo a seguir às 08:00).
  // Na mesma volta, depois dos lembretes, correm os emails automáticos ao cliente (`aCadaVolta`; emails-auto.js).
  let temporizador = null, temporizadorResumo = null;
  let cadaVolta = null;
  const aCadaVolta = (fn) => { cadaVolta = fn; };
  function iniciar(intervaloMs = 15 * 60_000, intervaloResumoMs = 60_000) {
    temporizador = setInterval(() => {
      try { lembretes(); } catch (e) { registo?.erro(`lembretes do CRM: ${e?.stack || e}`); }
      try { cadaVolta?.(); } catch (e) { registo?.erro(`emails automáticos: ${e?.stack || e}`); }
    }, intervaloMs);
    temporizador.unref();
    temporizadorResumo = setInterval(() => { try { resumoDiario(); } catch (e) { registo?.erro(`email diário das tarefas: ${e?.stack || e}`); } }, intervaloResumoMs);
    temporizadorResumo.unref();
  }
  const parar = () => { clearInterval(temporizador); clearInterval(temporizadorResumo); };

  return { h, lembretes, resumoDiario, prazos, criarAutomatica, cancelarAutomaticas, obraPorConfirmar, aCadaVolta, iniciar, parar };
}
