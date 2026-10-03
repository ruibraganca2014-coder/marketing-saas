// CRM do painel (decisões do dono de 2026-10-03; docs/CRM-TAREFAS.md): a ficha do cliente (uma por pessoa, derivada
// dos pedidos — mesma conta de cliente, email ou telefone — e que o CEO funde ou separa à mão), as fases do negócio de cada
// pedido (os estados que o pedido já tem), as notas e os contactos da equipa, a origem do contacto e o responsável.
// Toda a autorização é verificada AQUI, no servidor: a tabela de rotas (api.js) diz os papéis; os handlers verificam
// o que depende do registo (o técnico só vê os clientes das obras que lhe estão atribuídas).

import { ErroApi, responder, lerJson } from './http.js';
import { texto, opcao, idNum, diaHora, falha, RE_TELEFONE } from './validar.js';
import { ESTADO_ARQUIVADO, ORIGENS_CONTACTO, TIPOS_REGISTO, transacao } from './db.js';
import { RE_EMAIL } from './pedidos.js';
import { iso, diaLisboa, deCent } from './util.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';

/** Fases do negócio (pipeline) e o estado do pedido que cada uma é. */
export const FASES = ['novo', 'contactado', 'visita', 'proposta', 'aceite', 'perdido'];
export const FASE_DO_ESTADO = { novo: 'novo', contactado: 'contactado', visita_marcada: 'visita', proposta_enviada: 'proposta', aceite: 'aceite', perdido: 'perdido' };
/** Páginas de anúncio de entrada (`?servico=` do simulador, web/simulador/entrada.js). */
export const ENTRADAS = ['carregador', 'quadro-antigo'];
/** Registos que contam como contacto com o cliente (a nota não conta). */
const CONTACTOS = TIPOS_REGISTO.filter((t) => t !== 'nota');
const NOME_ANONIMIZADO = 'Anonimizado (RGPD)';

/** Telefone só com os algarismos e sem o indicativo de Portugal (para comparar "912 345 678" com "+351912345678"). */
export function telefoneNorm(t) {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('351')) d = d.slice(3);
  return d.length >= 6 ? d : null;
}

const semAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const CONCELHO_POR_NOME = new Map(CONCELHOS.map((c) => [semAcentos(c[0]), c[0]]));
/** O concelho (nome da lista) a partir da localidade escrita no pedido; null se não for um dos 308. */
export const concelhoDe = (localidade) => CONCELHO_POR_NOME.get(semAcentos(localidade)) ?? null;

const FMT_HORA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "AAAA-MM-DDTHH:MM" em Lisboa (a forma das datas com hora do painel). */
export const agoraLisboa = (ms) => `${diaLisboa(new Date(ms))}T${FMT_HORA.format(new Date(ms))}`;
export const horaLisboa = (ms) => FMT_HORA.format(new Date(ms));

export function criarCrm({ db, config, relogio, auditar, pagamentos, emails = () => null }) {
  const agoraIso = () => iso(relogio());

  // ------------------------------------------------------------ identidade do cliente
  /**
   * Liga cada pedido ainda sem ficha (os anonimizados ficam de fora) à ficha da mesma pessoa: primeiro a mesma conta de
   * cliente, depois o mesmo email, depois o mesmo telefone (de qualquer pedido já ligado ou da própria ficha); sem
   * nenhum, cria uma ficha nova com o nome e os contactos do pedido. Não mexe em `orcamentos.atualizado` (retenção).
   * Um pedido que o CEO separou à mão (`crm_separado`) nunca volta a ser junto por aqui: fica na ficha para onde foi
   * (e, se a perdesse, ganhava uma só dele).
   */
  function ligarPedidos() {
    const soltos = db.prepare('SELECT id, nome, email, telefone, conta_id, crm_separado FROM orcamentos WHERE crm_cliente_id IS NULL AND anonimizado IS NULL AND estado != ? ORDER BY id').all(ESTADO_ARQUIVADO);
    if (!soltos.length) return 0;
    const porConta = new Map(), porEmail = new Map(), porTel = new Map();
    const juntar = (c, conta, email, tel) => {
      if (conta && !porConta.has(conta)) porConta.set(conta, c);
      if (email && !porEmail.has(String(email).toLowerCase())) porEmail.set(String(email).toLowerCase(), c);
      const t = telefoneNorm(tel);
      if (t && !porTel.has(t)) porTel.set(t, c);
    };
    for (const k of db.prepare('SELECT id, email, telefone, conta_id FROM crm_clientes WHERE anonimizado IS NULL ORDER BY id').all()) juntar(k.id, k.conta_id, k.email, k.telefone);
    for (const o of db.prepare(`SELECT o.crm_cliente_id AS c, o.email, o.telefone, o.conta_id FROM orcamentos o JOIN crm_clientes k ON k.id = o.crm_cliente_id
      WHERE k.anonimizado IS NULL AND o.anonimizado IS NULL ORDER BY o.id`).all()) juntar(o.c, o.conta_id, o.email, o.telefone);
    const agora = agoraIso();
    const ins = db.prepare('INSERT INTO crm_clientes (nome, email, telefone, conta_id, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?)');
    const ligar = db.prepare('UPDATE orcamentos SET crm_cliente_id = ? WHERE id = ? AND crm_cliente_id IS NULL');
    transacao(db, () => {
      for (const o of soltos) {
        let c = o.crm_separado ? null : (o.conta_id && porConta.get(o.conta_id)) || (o.email && porEmail.get(String(o.email).toLowerCase())) || porTel.get(telefoneNorm(o.telefone));
        if (!c) c = Number(ins.run(o.nome, o.email, o.telefone, o.crm_separado ? null : o.conta_id, agora, agora).lastInsertRowid);
        else if (o.conta_id) db.prepare('UPDATE crm_clientes SET conta_id = ? WHERE id = ? AND conta_id IS NULL').run(o.conta_id, c);
        ligar.run(c, o.id);
        juntar(c, o.conta_id, o.email, o.telefone);
      }
    });
    return soltos.length;
  }

  // ------------------------------------------------------------ fases do negócio
  const temVisitaPaga = (o) => Boolean(pagamentos()?.temVisita(o));
  /**
   * A fase do negócio de um pedido: o estado do pedido (visita_marcada = "visita", proposta_enviada = "proposta"); um
   * pedido novo ou contactado com a visita técnica já paga está na fase "visita" (a data marca-se depois).
   */
  function faseDe(o) {
    const f = FASE_DO_ESTADO[o.estado] ?? null;
    if ((f === 'novo' || f === 'contactado') && temVisitaPaga(o)) return 'visita';
    return f;
  }
  const ultimaMudanca = db.prepare(`SELECT quando FROM auditoria WHERE alvo = ? AND json_valid(detalhes) AND json_extract(detalhes, '$.estado') = ?
    ORDER BY id DESC LIMIT 1`);
  /** Desde quando o pedido está no estado atual (ISO): a última mudança registada na auditoria; senão a criação (novo) ou a última alteração. */
  function desdeFase(o) {
    return ultimaMudanca.get(`orcamento:${o.id}`, o.estado)?.quando ?? (o.estado === 'novo' ? o.criado : o.atualizado);
  }

  // ------------------------------------------------------------ utilidades
  const equipa = () => db.prepare('SELECT id, nome, papel FROM utilizadores WHERE ativo = 1 ORDER BY nome').all();
  const nomeUtilizador = db.prepare('SELECT nome FROM utilizadores WHERE id = ?');
  const nomeDe = (id) => (id ? nomeUtilizador.get(id)?.nome ?? null : null);

  /** Responsável (utilizador ativo do painel) ou null. */
  function responsavel(v) {
    if (v === null) return null;
    if (!Number.isInteger(v)) falha('Responsável: id de um utilizador do painel (ou null).');
    if (!db.prepare('SELECT 1 FROM utilizadores WHERE id = ? AND ativo = 1').get(v)) falha('O responsável tem de ser um utilizador ativo do painel.');
    return v;
  }

  /** Fichas de cliente que o técnico vê: as dos pedidos das obras que lhe estão atribuídas (pela obra ou pela casa). */
  function clientesDoTecnico(uid) {
    return new Set(db.prepare(`SELECT DISTINCT o.crm_cliente_id AS c FROM obras b JOIN obra_tecnicos t ON t.obra_id = b.id AND t.utilizador_id = ?
      JOIN orcamentos o ON o.id = b.orcamento_id OR (b.cliente != '' AND o.cliente = b.cliente) WHERE o.crm_cliente_id IS NOT NULL`).all(uid).map((x) => x.c));
  }
  const podeVer = (u, id) => u.papel !== 'tecnico' || clientesDoTecnico(u.id).has(id);
  /** O id da ficha se o utilizador a pode abrir (técnico: só as das suas obras; anonimizada: só o CEO); senão null. */
  function fichaAberta(u, id) {
    const k = id ? db.prepare('SELECT id, anonimizado FROM crm_clientes WHERE id = ?').get(id) : null;
    return k && podeVer(u, k.id) && (!k.anonimizado || u.papel === 'ceo') ? k.id : null;
  }

  function obterCliente(s, u) {
    const k = db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(idNum(s));
    // O técnico não sabe que existem as fichas que não vê (404, como um id que não existe).
    if (!k || !podeVer(u, k.id)) throw new ErroApi(404, 'Cliente não encontrado.');
    return k;
  }

  /** Um pedido na vista do CRM. Valores só para quem vê os orçamentos (CEO e comercial). */
  function pedidoCrm(o, u) {
    const r = {
      id: o.id, criado: o.criado, cliente_id: o.crm_cliente_id, nome: o.nome, servico: o.servico, localidade: o.localidade,
      concelho: concelhoDe(o.localidade), estado: o.estado, fase: faseDe(o), data_visita: o.data_visita,
    };
    if (u.papel === 'tecnico') return r;
    return {
      ...r, valor_proposta: deCent(o.valor_proposta_cent), aguarda_sinal: o.estado === 'proposta_enviada' && Boolean(o.proposta_aceite),
      responsavel_id: o.responsavel_id ?? null, responsavel_nome: nomeDe(o.responsavel_id),
      origem: o.origem, origem_contacto: o.origem_contacto ?? null, origem_entrada: o.origem_entrada ?? null,
      motivo_perda_tipo: o.motivo_perda_tipo ?? null, motivo_perda: o.motivo_perda ?? null, tem_simulacao: o.simulacao !== null,
      separado: o.crm_separado ?? null,
    };
  }

  // ------------------------------------------------------------ handlers
  const h = {};
  // `lembretes` (tarefas.js) corre antes de cada leitura: liga os pedidos novos às fichas e cria/cancela os lembretes.
  let antesDeLer = () => ligarPedidos();
  const aoLer = (fn) => { antesDeLer = fn; };

  // Pipeline e lista dos pedidos com filtros (fase, origem, concelho, responsável, datas). Só CEO e comercial.
  h.crmPedidos = ({ res, u, url }) => {
    antesDeLer();
    const q = url.searchParams;
    const fase = q.get('fase') ? opcao(q.get('fase'), 'fase', FASES) : null;
    const origem = q.get('origem') ? opcao(q.get('origem'), 'origem', [...ORIGENS_CONTACTO, 'sem']) : null;
    const concelho = q.get('concelho') || null;
    const resp = q.get('responsavel') || null;
    if (resp !== null && resp !== 'sem' && !/^[1-9]\d{0,9}$/.test(resp)) falha('Responsável inválido.');
    const de = q.get('de') ? diaHora(q.get('de'), 'a data inicial')?.slice(0, 10) : null;
    const ate = q.get('ate') ? diaHora(q.get('ate'), 'a data final')?.slice(0, 10) : null;
    const todos = db.prepare('SELECT * FROM orcamentos WHERE estado != ? ORDER BY id DESC LIMIT 2000').all(ESTADO_ARQUIVADO).map((o) => pedidoCrm(o, u));
    const filtrados = todos.filter((p) => (!origem || (origem === 'sem' ? !p.origem_contacto : p.origem_contacto === origem))
      && (!concelho || p.concelho === concelho)
      && (!resp || (resp === 'sem' ? !p.responsavel_id : String(p.responsavel_id) === resp))
      && (!de || diaLisboa(new Date(p.criado)) >= de) && (!ate || diaLisboa(new Date(p.criado)) <= ate));
    // O funil conta todas as fases (com os outros filtros); a lista também filtra pela fase.
    const funil = Object.fromEntries(FASES.map((f) => [f, { n: 0, valor: 0 }]));
    for (const p of filtrados) { funil[p.fase].n += 1; funil[p.fase].valor = Math.round((funil[p.fase].valor + (p.valor_proposta ?? 0)) * 100) / 100; }
    responder(res, 200, {
      pedidos: fase ? filtrados.filter((p) => p.fase === fase) : filtrados, funil, fases: FASES,
      concelhos: [...new Set(todos.map((p) => p.concelho).filter(Boolean))].sort(), equipa: equipa(),
    });
  };

  // Responsável e origem do contacto de um pedido (a fase muda-se em POST orcamentos/:id, com as mesmas regras de sempre).
  h.crmAtualizarPedido = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['responsavel_id', 'origem_contacto', 'origem_entrada']);
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(idNum(params.id));
    if (!o) throw new ErroApi(404, 'Pedido de orçamento não encontrado.');
    if (o.estado === ESTADO_ARQUIVADO) throw new ErroApi(409, 'Pedido arquivado (RGPD): não se pode alterar.');
    const mud = {};
    if (v.responsavel_id !== undefined) mud.responsavel_id = responsavel(v.responsavel_id);
    if (v.origem_contacto !== undefined) mud.origem_contacto = opcao(v.origem_contacto, 'origem do contacto', ORIGENS_CONTACTO, { obrigatorio: false });
    if (v.origem_entrada !== undefined) mud.origem_entrada = opcao(v.origem_entrada, 'página de entrada', ENTRADAS, { obrigatorio: false });
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE orcamentos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado = ? WHERE id = ?`).run(...cols.map((k) => mud[k]), agoraIso(), o.id);
    auditar(u, 'orcamento_atualizado', `orcamento:${o.id}`, mud, ip);
    antesDeLer();
    responder(res, 200, pedidoCrm(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id), u));
  };

  // Lista das fichas de cliente (o técnico: só as dos clientes das suas obras).
  h.crmClientes = ({ res, u, url }) => {
    antesDeLer();
    const q = semAcentos(url.searchParams.get('q') || '').slice(0, 100);
    const vistos = u.papel === 'tecnico' ? clientesDoTecnico(u.id) : null;
    const pedidos = new Map();
    for (const o of db.prepare('SELECT * FROM orcamentos WHERE crm_cliente_id IS NOT NULL ORDER BY id DESC').all()) {
      if (!pedidos.has(o.crm_cliente_id)) pedidos.set(o.crm_cliente_id, []);
      pedidos.get(o.crm_cliente_id).push(o);
    }
    const ultimo = new Map(db.prepare(`SELECT cliente_id, MAX(quando) AS q FROM crm_registos WHERE tipo != 'nota' GROUP BY cliente_id`).all().map((x) => [x.cliente_id, x.q]));
    const clientes = db.prepare('SELECT * FROM crm_clientes ORDER BY id DESC').all()
      .filter((k) => (!vistos || vistos.has(k.id)) && (u.papel === 'ceo' || !k.anonimizado))
      .filter((k) => !q || [k.nome, k.email, k.telefone, ...(pedidos.get(k.id) ?? []).map((o) => o.localidade)].some((x) => x && semAcentos(x).includes(q)))
      .map((k) => {
        const ps = pedidos.get(k.id) ?? [];
        return {
          id: k.id, nome: k.nome, email: k.email, telefone: k.telefone, anonimizado: k.anonimizado ?? null,
          n_pedidos: ps.length, fase: ps[0] ? faseDe(ps[0]) : null, localidade: ps.find((o) => o.localidade)?.localidade ?? null,
          responsavel_id: k.responsavel_id ?? null, responsavel_nome: nomeDe(k.responsavel_id), ultimo_contacto: ultimo.get(k.id) ?? null,
        };
      });
    responder(res, 200, { clientes });
  };

  /** A ficha do cliente: dados, pedidos, pagamentos, obras, relatórios, trabalhos de eletricistas e o histórico da equipa. */
  function ficha(k, u) {
    const ceo = u.papel === 'ceo', tecnico = u.papel === 'tecnico';
    const pedidos = db.prepare('SELECT * FROM orcamentos WHERE crm_cliente_id = ? ORDER BY id DESC').all(k.id)
      .filter((o) => o.estado !== ESTADO_ARQUIVADO || ceo);
    const ids = pedidos.map((o) => o.id);
    const casas = [...new Set(pedidos.map((o) => o.cliente).filter(Boolean))];
    const conta = k.conta_id ? db.prepare('SELECT id, email, confirmado, ativo FROM contas WHERE id = ?').get(k.conta_id) : null;
    const marcas = (n) => Array(n).fill('?').join(', ');
    let obras = ids.length || casas.length ? db.prepare(`SELECT * FROM obras WHERE ${[ids.length ? `orcamento_id IN (${marcas(ids.length)})` : null,
      casas.length ? `cliente IN (${marcas(casas.length)})` : null].filter(Boolean).join(' OR ')} ORDER BY data DESC`).all(...ids, ...casas) : [];
    if (tecnico) obras = obras.filter((b) => db.prepare('SELECT 1 FROM obra_tecnicos WHERE obra_id = ? AND utilizador_id = ?').get(b.id, u.id));
    const r = {
      cliente: {
        id: k.id, nome: k.nome, email: k.email, telefone: k.telefone, anonimizado: k.anonimizado ?? null, criado: k.criado,
        responsavel_id: k.responsavel_id ?? null, responsavel_nome: nomeDe(k.responsavel_id), casas,
        conta: conta && !tecnico ? { id: conta.id, email: conta.email, confirmado: Boolean(conta.confirmado), ativo: Boolean(conta.ativo) } : null,
      },
      pedidos: pedidos.map((o) => pedidoCrm(o, u)),
      obras: obras.map((b) => ({ id: b.id, orcamento_id: b.orcamento_id, cliente: b.cliente || null, data: b.data, hora: b.hora, estado: b.estado, por_agendar: Boolean(b.por_agendar) })),
      registos: db.prepare('SELECT * FROM crm_registos WHERE cliente_id = ? ORDER BY quando DESC, id DESC').all(k.id)
        .map((x) => ({ id: x.id, tipo: x.tipo, quando: x.quando, texto: x.texto, orcamento_id: x.orcamento_id, por: x.por_email, criado: x.criado })),
      pode: { editar: !tecnico && !k.anonimizado, fundir: ceo && !k.anonimizado, separar: ceo && !k.anonimizado && pedidos.length > 1,
        registar: k.anonimizado ? [] : tecnico ? ['visita'] : TIPOS_REGISTO },
    };
    if (!tecnico) {
      // Pagamentos do pedido (os mesmos que a ficha do pedido mostra ao CEO e ao comercial) e os relatórios técnicos.
      r.pagamentos = pedidos.flatMap((o) => pagamentos().listarParaPainel(o.id).map((p) => ({ orcamento_id: o.id, ...p })));
      r.relatorios = pedidos.filter((o) => o.simulacao).map((o) => ({ orcamento_id: o.id, criado: o.criado, libertado: o.relatorio_libertado ?? null }));
      r.equipa = equipa();
      // Emails automáticos (docs/EMAILS-AUTOMATICOS.md): os que saíram para os pedidos desta ficha (tipo e data, sem o
      // corpo) e se o cliente recusou o email depois da obra ("Não quero receber"; só leitura).
      r.emails_automaticos = emails()?.enviados(ids) ?? [];
      r.cliente.emails_recusados = emails()?.recusou(k.email, conta?.email, ...pedidos.map((o) => o.email)) ?? null;
    }
    // Trabalhos de eletricistas externos: só com o módulo ligado e só para o CEO (como o resto do módulo no painel).
    if (ceo && config.eletricistas && ids.length) {
      r.trabalhos_eletricista = db.prepare(`SELECT t.id, t.orcamento_id, t.tipo, t.estado, t.criado, e.nome AS eletricista FROM trabalhos_eletricista t
        LEFT JOIN eletricistas e ON e.id = t.eletricista_id WHERE t.orcamento_id IN (${marcas(ids.length)}) ORDER BY t.id DESC`).all(...ids);
    }
    return r;
  }

  h.crmCliente = ({ res, u, params }) => {
    antesDeLer();
    const k = obterCliente(params.id, u);
    if (k.anonimizado && u.papel !== 'ceo') throw new ErroApi(404, 'Cliente não encontrado.');
    responder(res, 200, ficha(k, u));
  };

  // Dados de contacto da ficha e o responsável pelo cliente (CEO e comercial).
  h.crmAtualizarCliente = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['nome', 'email', 'telefone', 'responsavel_id']);
    const k = obterCliente(params.id, u);
    if (k.anonimizado) throw new ErroApi(409, 'Ficha anonimizada (RGPD): não se pode alterar.');
    const mud = {};
    if (v.nome !== undefined) mud.nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    if (v.email !== undefined) mud.email = texto(v.email, 'o email', { max: 254, re: RE_EMAIL, reMsg: 'Email inválido.' });
    if (v.telefone !== undefined) mud.telefone = texto(v.telefone, 'o telefone', { max: 30, re: RE_TELEFONE, reMsg: 'Telefone inválido.' });
    if (v.responsavel_id !== undefined) mud.responsavel_id = responsavel(v.responsavel_id);
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE crm_clientes SET ${cols.map((c) => `${c} = ?`).join(', ')}, atualizado = ? WHERE id = ?`).run(...cols.map((c) => mud[c]), agoraIso(), k.id);
    // Na auditoria só os campos mudados e o responsável (sem os dados pessoais).
    auditar(u, 'crm_cliente_atualizado', `crm_cliente:${k.id}`, { campos: cols, ...(cols.includes('responsavel_id') ? { responsavel_id: mud.responsavel_id } : {}) }, ip);
    responder(res, 200, ficha(db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(k.id), u));
  };

  // Fundir duas fichas da mesma pessoa (só o CEO): os pedidos, os registos e as tarefas da outra passam para esta, e
  // os contactos que faltam nesta vêm da outra; a outra ficha sai.
  h.crmFundir = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['outro']);
    const k = obterCliente(params.id, u);
    if (!Number.isInteger(v.outro)) falha('Indique a ficha a juntar a esta (outro: id).');
    const o = db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(v.outro);
    if (!o) throw new ErroApi(404, 'A outra ficha não existe.');
    if (o.id === k.id) falha('Escolha outra ficha (não a mesma).');
    if (k.anonimizado || o.anonimizado) throw new ErroApi(409, 'Uma ficha anonimizada (RGPD) não se funde.');
    const n = transacao(db, () => {
      const pedidos = db.prepare('UPDATE orcamentos SET crm_cliente_id = ? WHERE crm_cliente_id = ?').run(k.id, o.id).changes;
      db.prepare('UPDATE crm_registos SET cliente_id = ? WHERE cliente_id = ?').run(k.id, o.id);
      db.prepare('UPDATE tarefas SET cliente_id = ? WHERE cliente_id = ?').run(k.id, o.id);
      db.prepare(`UPDATE crm_clientes SET email = COALESCE(email, ?), telefone = COALESCE(telefone, ?), conta_id = COALESCE(conta_id, ?),
        responsavel_id = COALESCE(responsavel_id, ?), atualizado = ? WHERE id = ?`).run(o.email, o.telefone, o.conta_id, o.responsavel_id, agoraIso(), k.id);
      db.prepare('DELETE FROM crm_clientes WHERE id = ?').run(o.id);
      return pedidos;
    });
    auditar(u, 'crm_clientes_fundidos', `crm_cliente:${k.id}`, { de: o.id, pedidos: n }, ip);
    responder(res, 200, ficha(db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(k.id), u));
  };

  // Separar (só o CEO; o inverso de "Juntar"): um pedido sai da ficha onde está para uma ficha nova, só dele, com o
  // nome e os contactos do pedido; as notas, os contactos e as tarefas ligados a ESSE pedido vão com ele. A conta de
  // cliente fica na ficha de origem. Fica marcado (`crm_separado`) para a ligação automática não o voltar a juntar.
  h.crmSeparar = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    ligarPedidos();
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(idNum(params.id));
    if (!o) throw new ErroApi(404, 'Pedido de orçamento não encontrado.');
    if (o.estado === ESTADO_ARQUIVADO || o.anonimizado) throw new ErroApi(409, 'Pedido arquivado (RGPD): não se pode separar.');
    const k = o.crm_cliente_id ? db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(o.crm_cliente_id) : null;
    if (!k) throw new ErroApi(409, 'Este pedido não está em nenhuma ficha.');
    if (k.anonimizado) throw new ErroApi(409, 'Uma ficha anonimizada (RGPD) não se separa.');
    if (db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE crm_cliente_id = ?').get(k.id).n < 2) falha('A ficha só tem este pedido: não há nada para separar.');
    const agora = agoraIso();
    const nova = transacao(db, () => {
      const id = Number(db.prepare('INSERT INTO crm_clientes (nome, email, telefone, conta_id, criado, atualizado) VALUES (?, ?, ?, NULL, ?, ?)')
        .run(o.nome, o.email, o.telefone, agora, agora).lastInsertRowid);
      db.prepare('UPDATE orcamentos SET crm_cliente_id = ?, crm_separado = ? WHERE id = ?').run(id, agora, o.id);
      db.prepare('UPDATE crm_registos SET cliente_id = ? WHERE orcamento_id = ?').run(id, o.id);
      db.prepare('UPDATE tarefas SET cliente_id = ? WHERE orcamento_id = ?').run(id, o.id);
      return id;
    });
    auditar(u, 'crm_pedido_separado', `crm_cliente:${k.id}`, { pedido: o.id, para: nova }, ip);
    antesDeLer();
    responder(res, 200, { ...ficha(db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(k.id), u), nova_ficha: nova });
  };

  // Nota ou contacto (chamada, email, WhatsApp, visita) na ficha. O técnico só regista visitas, nos seus clientes.
  // Um contacto passa os pedidos novos do cliente (ou só o pedido indicado) a "contactado".
  h.crmRegisto = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['tipo', 'quando', 'texto', 'orcamento_id']);
    const k = obterCliente(params.id, u);
    if (k.anonimizado) throw new ErroApi(409, 'Ficha anonimizada (RGPD): não se pode alterar.');
    const tipo = opcao(v.tipo, 'tipo', TIPOS_REGISTO);
    if (u.papel === 'tecnico' && tipo !== 'visita') throw new ErroApi(403, 'O técnico só regista visitas.');
    const agora = relogio();
    const quando = v.quando === undefined || v.quando === null || v.quando === '' ? agoraLisboa(agora) : diaHora(v.quando, 'a data do contacto');
    if (quando.slice(0, 10) > diaLisboa(new Date(agora + 24 * 3600_000))) falha('A data do contacto não pode ser no futuro.');
    const txt = texto(v.texto, 'o texto', { max: 2000, multilinha: true, obrigatorio: tipo === 'nota' }) ?? '';
    let orcamentoId = null;
    if (v.orcamento_id !== undefined && v.orcamento_id !== null) {
      if (!Number.isInteger(v.orcamento_id) || !db.prepare('SELECT 1 FROM orcamentos WHERE id = ? AND crm_cliente_id = ?').get(v.orcamento_id, k.id)) falha('Esse pedido não é deste cliente.');
      orcamentoId = v.orcamento_id;
    }
    const id = Number(db.prepare('INSERT INTO crm_registos (cliente_id, orcamento_id, tipo, quando, texto, por_id, por_email, criado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(k.id, orcamentoId, tipo, quando, txt, u.id, u.email, agoraIso()).lastInsertRowid);
    // O texto não vai para a auditoria (dados pessoais ficam só na ficha, que sai com a conta: RGPD).
    auditar(u, 'crm_registo', `crm_cliente:${k.id}`, { registo: id, tipo, orcamento: orcamentoId }, ip);
    if (CONTACTOS.includes(tipo)) {
      const novos = db.prepare(`SELECT id FROM orcamentos WHERE estado = 'novo' AND crm_cliente_id = ? ${orcamentoId ? 'AND id = ?' : ''}`).all(...(orcamentoId ? [k.id, orcamentoId] : [k.id]));
      for (const { id: oid } of novos) {
        db.prepare("UPDATE orcamentos SET estado = 'contactado', atualizado = ? WHERE id = ? AND estado = 'novo'").run(agoraIso(), oid);
        auditar(u, 'orcamento_atualizado', `orcamento:${oid}`, { estado: 'contactado', via: `contacto registado no CRM (${tipo})` }, ip);
      }
    }
    antesDeLer();
    responder(res, 201, ficha(db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(k.id), u));
  };

  // ------------------------------------------------------------ RGPD (conta de cliente apagada; conta.js apagar)
  /** As fichas ligadas a uma conta (antes de a apagar). */
  function clientesDaConta(contaId) {
    return [...new Set(db.prepare(`SELECT crm_cliente_id AS c FROM orcamentos WHERE conta_id = ?1 AND crm_cliente_id IS NOT NULL
      UNION SELECT id AS c FROM crm_clientes WHERE conta_id = ?1`).all(contaId).map((x) => x.c))];
  }
  /**
   * Corre DENTRO da transação que apaga a conta, depois de os pedidos saírem ou serem anonimizados: as notas e os
   * contactos da equipa saem sempre; as tarefas ligadas ficam só com um título neutro (sem descrição, checklist nem
   * ligação ao cliente ou ao pedido); a ficha é anonimizada, a não ser que ainda tenha pedidos com dados (os convertidos
   * em casa e obra ficam pelo contrato) — aí só perde a ligação à conta. O histórico da ficha na auditoria sai.
   */
  function aoApagarConta(ids, pedidos, contaId) {
    const agora = agoraIso();
    const marcas = (n) => Array(n).fill('?').join(', ');
    if (ids.length || pedidos.length) {
      db.prepare(`UPDATE tarefas SET titulo = CASE WHEN lembrete IS NOT NULL THEN 'Lembrete automático (cliente apagado — RGPD)' ELSE 'Tarefa (cliente apagado — RGPD)' END,
        descricao = NULL, checklist = '[]', cliente_id = NULL, orcamento_id = NULL, atualizado = ?
        WHERE ${[ids.length ? `cliente_id IN (${marcas(ids.length)})` : null, pedidos.length ? `orcamento_id IN (${marcas(pedidos.length)})` : null].filter(Boolean).join(' OR ')}`)
        .run(agora, ...ids, ...pedidos);
    }
    for (const id of ids) {
      db.prepare('DELETE FROM crm_registos WHERE cliente_id = ?').run(id);
      const restam = db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE crm_cliente_id = ? AND anonimizado IS NULL AND estado != ?').get(id, ESTADO_ARQUIVADO).n;
      if (restam) {
        db.prepare('UPDATE crm_clientes SET conta_id = NULL, atualizado = ? WHERE id = ? AND conta_id = ?').run(agora, id, contaId);
      } else {
        db.prepare('UPDATE crm_clientes SET nome = ?, email = NULL, telefone = NULL, conta_id = NULL, anonimizado = ?, atualizado = ? WHERE id = ?').run(NOME_ANONIMIZADO, agora, agora, id);
        db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`crm_cliente:${id}`);
        auditar(null, 'crm_cliente_anonimizado_rgpd', `crm_cliente:${id}`);
      }
    }
  }

  return { h, ligarPedidos, faseDe, desdeFase, clientesDaConta, aoApagarConta, clientesDoTecnico, fichaAberta, responsavel, equipa, nomeDe, aoLer };
}
