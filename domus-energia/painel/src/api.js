// API do painel (/painel/api/, docs/PAINEL-EMPRESA.md §3) e endpoints públicos
// (/api/orcamento, /api/catalogo). Toda a autorização é feita AQUI, no
// servidor, em cada pedido: cada rota declara os papéis que a podem usar e os
// handlers verificam ainda o que depende do registo (ex.: obras do técnico).

import {
  ErroApi, responder, lerJson, verificarOrigem, tipoJson, ipDe,
} from './http.js';
import {
  texto, numero, booleano, opcao, dia, diaHora, hora, idNum, simulacao as validarSimulacao,
  RE_TELEFONE, falha,
} from './validar.js';
import { RE_ID, RESERVADOS, PLANOS, ESTADOS_PLANO, PRECO_IVA, semIva } from './dados.js';
import { ESTADOS_ORCAMENTO, ESTADOS_OBRA, PAPEIS, CATEGORIAS, transacao } from './db.js';
import { RE_EMAIL, RE_PEDIDO, formatarPedido } from './pedidos.js';
import { hashSenha, verificarSenha, problemaSenha, gerarSenha } from './senhas.js';
import { LimiteTaxa } from './limite.js';
import { iso, diaLisboa, semanaLisboa, deCent, paraCent } from './util.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';

const TODOS = ['ceo', 'tecnico', 'comercial'];
const P = '/painel/api/';
export const KITS = { essencial: 3, conforto: 7, premium: 10, outro: null };
const LIMITE_ORCAMENTO = 1_250_000;   // bytes: simulação (≤ 1 MB) + campos
const RE_SKU = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const MAX_APARELHOS_CONVERTER = 60;
const CONFIG_ORCAMENTO = {
  tarifa_hora_iva: { min: 0, max: 1000, rotulo: 'a tarifa por hora' },
  margem_intervalo_pct: { min: 0, max: 100, rotulo: 'a margem do intervalo (%)' },
  deslocacao_iva: { min: 0, max: 10_000, rotulo: 'o valor fixo da deslocação' },          // valor fixo (mínimo) de cada deslocação
  deslocacao_km_gratis: { min: 0, max: 1000, rotulo: 'os km grátis da deslocação' },
  deslocacao_preco_km_iva: { min: 0, max: 100, rotulo: 'o preço por km da deslocação' },
  deslocacao_max_km: { min: 0, max: 2000, rotulo: 'a distância máxima da deslocação' },
};
// Base da deslocação: um dos 308 concelhos (nome exato de painel/public/vendor/concelhos.js).
const NOMES_CONCELHOS = new Set(CONCELHOS.map((c) => c[0]));
// O que o /api/catalogo (público) mostra da configuração: só o que o simulador usa no preço.
const CONFIG_PUBLICA = [...Object.keys(CONFIG_ORCAMENTO), 'deslocacao_base'];

/**
 * Tabela de rotas: método, caminho (":x" = parâmetro), papéis. "publico" =
 * sem sessão. Exportada para os testes verificarem a matriz de papéis de
 * TODAS as rotas.
 */
/** Funções de canal que o domus.sh aceita (FUNCOES em servidor/domus.sh). */
const FUNCOES_CANAL = ['interruptor', 'luz', 'estore', 'porta', 'movimento', 'bateria'];

export const ROTAS = [
  ['POST', 'entrar', 'publico', 'entrar'],
  ['POST', 'sair', 'publico', 'sair'],
  ['GET', 'eu', TODOS, 'eu'],
  ['POST', 'eu/senha', TODOS, 'mudarSenha'],
  ['GET', 'resumo', TODOS, 'resumo'],
  ['GET', 'clientes', TODOS, 'clientes'],
  ['GET', 'clientes/:c', TODOS, 'cliente'],
  ['POST', 'clientes', ['ceo', 'comercial'], 'criarCliente'],
  ['POST', 'clientes/:c/aparelhos', ['ceo', 'tecnico'], 'pedirAparelho'],
  ['POST', 'clientes/:c/aparelhos/:a/remover', ['ceo', 'tecnico'], 'removerAparelho'],
  ['POST', 'clientes/:c/plano', ['ceo'], 'pedirPlano'],
  ['GET', 'alertas', ['ceo', 'tecnico'], 'alertas'],
  ['GET', 'orcamentos', ['ceo', 'comercial'], 'orcamentos'],
  ['POST', 'orcamentos', ['ceo', 'comercial'], 'criarOrcamento'],
  ['GET', 'orcamentos/:id', ['ceo', 'comercial'], 'orcamento'],
  ['POST', 'orcamentos/:id', ['ceo', 'comercial'], 'atualizarOrcamento'],
  ['POST', 'orcamentos/:id/converter', ['ceo', 'comercial'], 'converter'],
  ['GET', 'obras', TODOS, 'obras'],
  ['GET', 'obras/:id', TODOS, 'obra'],
  ['POST', 'obras', ['ceo'], 'criarObra'],
  ['POST', 'obras/:id', ['ceo', 'tecnico'], 'atualizarObra'],
  ['GET', 'pagamentos', ['ceo'], 'pagamentos'],
  ['GET', 'utilizadores', ['ceo'], 'utilizadores'],
  ['POST', 'utilizadores', ['ceo'], 'criarUtilizador'],
  ['POST', 'utilizadores/:id', ['ceo'], 'atualizarUtilizador'],
  ['GET', 'auditoria', ['ceo'], 'auditoria'],
  ['GET', 'pedidos', TODOS, 'pedidos'],
  ['GET', 'pedidos/:id', TODOS, 'pedido'],
  ['GET', 'catalogo', ['ceo'], 'catalogo'],
  ['POST', 'catalogo', ['ceo'], 'criarArtigo'],
  ['POST', 'catalogo/:id', ['ceo'], 'atualizarArtigo'],
  ['GET', 'config-orcamento', ['ceo'], 'configOrcamento'],
  ['POST', 'config-orcamento', ['ceo'], 'atualizarConfigOrcamento'],
].map(([metodo, caminho, papeis, nome]) => {
  const partes = caminho.split('/');
  return { metodo, caminho, papeis, nome, partes };
});

/** Horas de mão de obra da simulação do cliente (mao_obra.horas), ou null se não houver/for inválida. */
function horasDaSimulacao(json) {
  try {
    const h = JSON.parse(json ?? 'null')?.mao_obra?.horas;
    return typeof h === 'number' && Number.isFinite(h) && h > 0 && h <= 500 ? Math.round(h * 100) / 100 : null;
  } catch { return null; }
}

/** Especificações (JSON) sem o "preço provisório — confirmar" da nota; null se não o tinham. */
function semPrecoProvisorio(json) {
  let e;
  try { e = JSON.parse(json || '{}'); } catch { return null; }
  if (!e || typeof e.nota !== 'string' || !/preço provisório — confirmar/i.test(e.nota)) return null;
  const nota = e.nota.replace(/preço provisório — confirmar[;.]?\s*/i, '').trim();
  if (nota) e.nota = nota; else delete e.nota;
  return JSON.stringify(e);
}

function encontrarRota(metodo, resto) {
  const segs = resto.split('/');
  let caminhoExiste = false;
  for (const r of ROTAS) {
    if (r.partes.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (r.partes[i].startsWith(':')) {
        if (!segs[i]) { ok = false; break; }
        params[r.partes[i].slice(1)] = segs[i];
      } else if (r.partes[i] !== segs[i]) { ok = false; break; }
    }
    if (!ok) continue;
    caminhoExiste = true;
    if (r.metodo === metodo || (metodo === 'HEAD' && r.metodo === 'GET')) return { rota: r, params };
  }
  return { caminhoExiste };
}

const publicoUtilizador = (u) => ({
  id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: Boolean(u.ativo), criado: u.criado, atualizado: u.atualizado,
});

export function criarApi(ctx) {
  const { db, config, auth, dados, alertas, pedidos, registo } = ctx;
  const relogio = ctx.relogio || (() => Date.now());
  const agoraIso = () => iso(relogio());

  const porIpOrcamento = new LimiteTaxa(config.limiteOrcamentoHora, 3600_000, relogio);
  const global = new LimiteTaxa(config.limiteOrcamentoGlobal, 3600_000, relogio);

  // ------------------------------------------------------------ auditoria
  const insAuditoria = db.prepare('INSERT INTO auditoria (quando, utilizador_id, email, acao, alvo, detalhes, ip) VALUES (?, ?, ?, ?, ?, ?, ?)');
  function auditar(u, acao, alvo = null, detalhes = null, ip = null) {
    const limpo = detalhes && JSON.stringify(detalhes, (k, v) => (/^(password|pass|senha|hash|token)$/i.test(k) ? undefined : v));
    insAuditoria.run(agoraIso(), u?.id ?? null, u?.email ?? 'sistema', acao, alvo, limpo, ip);
    // Guarda só as últimas 50 000 entradas.
    if (Math.random() < 0.01) db.prepare('DELETE FROM auditoria WHERE id <= (SELECT MAX(id) FROM auditoria) - 50000').run();
  }
  ctx.auditar = auditar;
  if (auth) auth.auditar = auditar;
  if (pedidos) pedidos.auditar = auditar;

  // ------------------------------------------------------------ utilidades
  const fichas = () => new Map(db.prepare('SELECT * FROM fichas_cliente').all().map((f) => [f.codigo, f]));
  const pedidoPendente = (tipo, cliente) => db.prepare('SELECT id FROM pedidos_admin WHERE tipo = ? AND cliente = ? AND estado = \'pendente\'').get(tipo, cliente);

  function codigoCliente(c) {
    if (!RE_ID.test(c)) throw new ErroApi(404, 'Cliente não encontrado.');
    return c;
  }

  const temFinanceiro = (u) => u.papel === 'ceo';

  function formatarOrcamento(o, completo = false) {
    const r = {
      id: o.id, criado: o.criado, atualizado: o.atualizado, origem: o.origem, nome: o.nome, telefone: o.telefone,
      email: o.email, localidade: o.localidade, servico: o.servico, mensagem: o.mensagem, codigo_cliente: o.codigo_cliente,
      estado: o.estado, notas: o.notas, data_visita: o.data_visita, valor_proposta: deCent(o.valor_proposta_cent),
      motivo_perda: o.motivo_perda, cliente: o.cliente, obra_id: o.obra_id, pedido_id: o.pedido_id,
      tem_simulacao: o.simulacao !== null, simulacao_bytes: o.simulacao ? Buffer.byteLength(o.simulacao) : 0,
    };
    if (completo) {
      r.simulacao = o.simulacao ? JSON.parse(o.simulacao) : null;
      r.catalogo = artigosDaSimulacao(r.simulacao);
      r.historico = db.prepare('SELECT quando, email, acao, detalhes FROM auditoria WHERE alvo = ? ORDER BY id').all(`orcamento:${o.id}`)
        .map((h) => ({ quando: h.quando, por: h.email, acao: h.acao, detalhes: h.detalhes ? JSON.parse(h.detalhes) : null }));
    }
    return r;
  }

  /**
   * Artigos do catálogo referidos na simulação (para o visualizador mostrar os nomes e
   * marcar os que já não existem): só dados que o comercial pode ver — nunca preço de
   * compra, fornecedor nem link. {SKU: {nome, categoria, especificacoes, preco_venda_iva, horas_instalacao, ativo}}.
   */
  const artigoPorSku = db.prepare('SELECT sku, nome, categoria, especificacoes, preco_venda_iva_cent, horas_instalacao, ativo FROM catalogo WHERE sku = ?');
  function artigosDaSimulacao(sim) {
    const out = {};
    if (!sim || !Array.isArray(sim.itens)) return out;
    for (const i of sim.itens.slice(0, 500)) {
      if (!i || typeof i.sku !== 'string' || !RE_SKU.test(i.sku) || out[i.sku]) continue;
      const a = artigoPorSku.get(i.sku);
      if (!a) continue;
      let esp = {};
      try { esp = JSON.parse(a.especificacoes || '{}'); } catch { /* ignorado */ }
      // A "nota" é interna (ex.: "preço provisório — confirmar"), como no /api/catalogo: não sai aqui para
      // ninguém (o CEO vê-a no ecrã Catálogo; o visualizador não a usa).
      const { nota, ...especificacoes } = esp && typeof esp === 'object' && !Array.isArray(esp) ? esp : {};
      out[a.sku] = { nome: a.nome, categoria: a.categoria, especificacoes, preco_venda_iva: deCent(a.preco_venda_iva_cent), horas_instalacao: a.horas_instalacao, ativo: Boolean(a.ativo) };
    }
    return out;
  }

  const tecnicosDe = db.prepare('SELECT u.id, u.nome FROM obra_tecnicos t JOIN utilizadores u ON u.id = t.utilizador_id WHERE t.obra_id = ? ORDER BY u.nome');
  function formatarObra(o, mapaFichas) {
    let material = [];
    try { material = JSON.parse(o.material); } catch { /* ignorado */ }
    return {
      id: o.id, cliente: o.cliente, cliente_nome: mapaFichas?.get(o.cliente)?.nome ?? null, orcamento_id: o.orcamento_id,
      data: o.data, hora: o.hora, kit: o.kit, estado: o.estado, material,
      horas_estimadas: o.horas_estimadas, horas_reais: o.horas_reais, notas: o.notas,
      tecnicos: tecnicosDe.all(o.id).map((t) => ({ id: t.id, nome: t.nome })),
      criado: o.criado, atualizado: o.atualizado,
    };
  }
  const obraDoTecnico = (obraId, uid) => Boolean(db.prepare('SELECT 1 FROM obra_tecnicos WHERE obra_id = ? AND utilizador_id = ?').get(obraId, uid));

  function formatarArtigo(a) {
    return {
      id: a.id, sku: a.sku, nome: a.nome, categoria: a.categoria, fornecedor: a.fornecedor, link: a.link,
      preco_compra: deCent(a.preco_compra_cent), preco_venda_iva: deCent(a.preco_venda_iva_cent),
      horas_instalacao: a.horas_instalacao, especificacoes: JSON.parse(a.especificacoes || '{}'),
      ativo: Boolean(a.ativo), visivel_cliente: Boolean(a.visivel_cliente), atualizado: a.atualizado,
    };
  }
  const lerConfigOrcamento = () => Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));

  function material(v) {
    if (!Array.isArray(v)) falha('O material tem de ser uma lista.');
    if (v.length > 200) falha('Demasiados artigos no material (máx. 200).');
    return v.map((m, i) => {
      if (typeof m === 'string') m = { nome: m };
      if (!m || typeof m !== 'object' || Array.isArray(m)) falha(`Material ${i + 1}: inválido.`);
      for (const k of Object.keys(m)) if (!['nome', 'quantidade', 'feito', 'sku'].includes(k)) falha(`Material ${i + 1}: campo desconhecido "${k}".`);
      const r = {
        nome: texto(m.nome, `o nome do material ${i + 1}`, { max: 120, obrigatorio: true }),
        quantidade: m.quantidade === undefined ? 1 : numero(m.quantidade, `a quantidade do material ${i + 1}`, { min: 0, max: 10_000, nulo: false }),
        feito: m.feito === undefined ? false : booleano(m.feito, `material ${i + 1}: feito`),
      };
      const sku = texto(m.sku, 'o SKU', { max: 40, re: RE_SKU });
      if (sku) r.sku = sku;
      return r;
    });
  }

  function tecnicos(v) {
    if (!Array.isArray(v) || v.length > 10) falha('Técnicos: lista de ids (máx. 10).');
    const ids = [...new Set(v)];
    for (const id of ids) {
      if (!Number.isInteger(id)) falha('Técnicos: ids inválidos.');
      const u = db.prepare('SELECT papel, ativo FROM utilizadores WHERE id = ?').get(id);
      if (!u || u.papel !== 'tecnico' || !u.ativo) falha(`O utilizador ${id} não é um técnico ativo.`);
    }
    return ids;
  }

  async function clienteConhecido(c) {
    return (await dados.clienteExiste(c)) || Boolean(db.prepare('SELECT 1 FROM fichas_cliente WHERE codigo = ?').get(c));
  }

  // Resumo do cliente (lista e ficha). Financeiro só para o CEO.
  async function resumoCliente(c, u, mapaFichas, contagemAlertas, existe = true) {
    const f = mapaFichas.get(c);
    const ap = existe ? await dados.aparelhos(c) : null;
    const pl = existe ? await dados.plano(c) : null;
    const r = {
      codigo: c, nome: f?.nome ?? null, contacto: f?.contacto ?? null, localidade: f?.localidade ?? null,
      pendente: !existe, plano: pl?.plano ?? null, estado: pl?.estado ?? null, n_aparelhos: ap ? ap.length : 0,
    };
    if (u.papel !== 'comercial') r.alertas = contagemAlertas.get(c) ?? 0;
    if (temFinanceiro(u) && pl) {
      r.proximo_pagamento = pl.proximo_pagamento;
      r.aviso_ate = pl.aviso_ate;
      r.gerido = pl.gerido;
      r.sem_ficheiro_plano = pl.sem_ficheiro;
      r.valor_mensal_iva = PRECO_IVA[pl.plano];
      r.valor_mensal_sem_iva = semIva(PRECO_IVA[pl.plano]);
    }
    return r;
  }

  function contagemAlertasPorCliente() {
    const m = new Map();
    for (const a of alertas.lista().alertas) m.set(a.cliente, (m.get(a.cliente) ?? 0) + 1);
    return m;
  }

  async function todosClientes(u) {
    const mapa = fichas();
    const contagem = u.papel === 'comercial' ? new Map() : contagemAlertasPorCliente();
    const existentes = await dados.codigosClientes();
    const out = [];
    for (const c of existentes) out.push(await resumoCliente(c, u, mapa, contagem, true));
    const set = new Set(existentes);
    for (const c of mapa.keys()) if (!set.has(c)) out.push(await resumoCliente(c, u, mapa, contagem, false));
    return out;
  }

  // ------------------------------------------------------------ handlers
  const h = {};

  h.entrar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'password']);
    if (typeof v.email !== 'string' || typeof v.password !== 'string' || !v.email || !v.password) throw new ErroApi(400, 'Indique o email e a palavra-passe.');
    if (v.email.length > 254 || v.password.length > 200) throw new ErroApi(401, 'Email ou palavra-passe errados.');
    const { token, utilizador } = await auth.entrar(v.email, v.password, ip);
    auditar(utilizador, 'entrar', `utilizador:${utilizador.id}`, null, ip);
    responder(res, 200, { utilizador: publicoUtilizador(utilizador) }, { 'Set-Cookie': auth.cookie(token, Math.floor(config.sessaoMs / 1000)) });
  };

  h.sair = async ({ req, res, ip }) => {
    await lerJson(req, []);
    const u = auth.sessao(req, null);
    auth.sair(req);
    if (u) auditar(u, 'sair', `utilizador:${u.id}`, null, ip);
    responder(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieApagar() });
  };

  h.eu = ({ res, u }) => responder(res, 200, {
    utilizador: { id: u.id, nome: u.nome, email: u.email, papel: u.papel }, sessao_expira: u.sessaoExpira,
  });

  // A própria pessoa muda a palavra-passe (a que o CEO lhe entregou ao criar a conta).
  // Pede a atual; as outras sessões terminam, esta continua.
  h.mudarSenha = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, ['atual', 'nova']);
    const espera = auth.porEmail.espera(u.email);
    if (espera) throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${espera} s.`, { 'Retry-After': String(espera) });
    if (typeof v.atual !== 'string' || !v.atual) falha('Indique a palavra-passe atual.');
    const atual = db.prepare('SELECT hash FROM utilizadores WHERE id = ?').get(u.id);
    if (!(await verificarSenha(v.atual, atual?.hash))) {
      auth.porEmail.registar(u.email);
      falha('A palavra-passe atual está errada.');
    }
    const prob = problemaSenha(v.nova);
    if (prob) falha(prob);
    if (v.nova === v.atual) falha('A palavra-passe nova tem de ser diferente da atual.');
    db.prepare('UPDATE utilizadores SET hash = ?, atualizado = ? WHERE id = ?').run(await hashSenha(v.nova), agoraIso(), u.id);
    db.prepare('DELETE FROM sessoes WHERE utilizador_id = ? AND id != ?').run(u.id, u.sessao);
    auditar(u, 'palavra_passe_mudada', `utilizador:${u.id}`, null, ip);
    responder(res, 200, { ok: true });
  };

  h.resumo = async ({ res, u }) => {
    const hoje = diaLisboa(new Date(relogio()));
    const { inicio, fim } = semanaLisboa(new Date(relogio()));
    const obrasSemana = (uid) => db.prepare(`SELECT o.* FROM obras o
      ${uid ? 'JOIN obra_tecnicos t ON t.obra_id = o.id AND t.utilizador_id = ?' : ''}
      WHERE o.data BETWEEN ? AND ? AND o.estado != 'cancelada' ORDER BY o.data, o.hora`).all(...(uid ? [uid, inicio, fim] : [inicio, fim]));
    const mapa = fichas();
    const r = { papel: u.papel, hoje, semana: { inicio, fim } };
    if (u.papel === 'ceo') {
      const porPlano = { base: 0, conforto: 0, premium: 0 };
      const porEstado = Object.fromEntries(ESTADOS_PLANO.map((e) => [e, 0]));
      let mrrCent = 0;
      const codigos = await dados.codigosClientes();
      for (const c of codigos) {
        const p = await dados.plano(c);
        porPlano[p.plano] += 1;
        porEstado[p.estado] += 1;
        if (p.estado === 'ativo') mrrCent += paraCent(semIva(PRECO_IVA[p.plano]));
      }
      const mes = hoje.slice(0, 7);
      const linhas = (await dados.pagamentos()).filter((l) => l.data.startsWith(mes));
      const al = alertas.lista();
      r.clientes = { total: codigos.length, por_plano: porPlano, por_estado: porEstado };
      r.receita_recorrente_mensal = deCent(mrrCent);
      r.recebido_mes = {
        mes, pagamentos: linhas.length,
        com_iva: deCent(linhas.reduce((s, l) => s + paraCent(l.valor_com_iva), 0)),
        sem_iva: deCent(linhas.reduce((s, l) => s + paraCent(l.valor_sem_iva), 0)),
      };
      r.pedidos_novos = db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE estado = \'novo\'').get().n;
      r.obras_semana = obrasSemana(null).map((o) => formatarObra(o, mapa));
      r.alertas = { ligado: al.ligado, contagem: al.contagem, criticos: al.alertas.filter((a) => a.gravidade === 'critica').slice(0, 20) };
      r.pedidos_admin_pendentes = db.prepare('SELECT COUNT(*) AS n FROM pedidos_admin WHERE estado = \'pendente\'').get().n;
    } else if (u.papel === 'tecnico') {
      const semana = obrasSemana(u.id).map((o) => formatarObra(o, mapa));
      const al = alertas.lista();
      r.obras_hoje = semana.filter((o) => o.data === hoje);
      r.obras_semana = semana;
      r.alertas = { ligado: al.ligado, contagem: al.contagem, principais: al.alertas.slice(0, 20) };
    } else {
      const porEstado = Object.fromEntries(ESTADOS_ORCAMENTO.map((e) => [e, 0]));
      for (const x of db.prepare('SELECT estado, COUNT(*) AS n FROM orcamentos GROUP BY estado').all()) porEstado[x.estado] = x.n;
      r.orcamentos_por_estado = porEstado;
      r.pedidos_novos = porEstado.novo;
      r.visitas_semana = db.prepare(`SELECT * FROM orcamentos WHERE substr(data_visita, 1, 10) BETWEEN ? AND ?
        AND estado NOT IN ('perdido') ORDER BY data_visita`).all(inicio, fim).map((o) => formatarOrcamento(o));
    }
    responder(res, 200, r);
  };

  h.clientes = async ({ res, u, url }) => {
    let lista = await todosClientes(u);
    const plano = url.searchParams.get('plano');
    const estado = url.searchParams.get('estado');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
    if (plano) lista = lista.filter((c) => c.plano === plano);
    if (estado) lista = lista.filter((c) => c.estado === estado);
    if (q) lista = lista.filter((c) => [c.codigo, c.nome, c.localidade].some((x) => x && x.toLowerCase().includes(q)));
    responder(res, 200, { clientes: lista });
  };

  h.cliente = async ({ res, u, params }) => {
    const c = codigoCliente(params.c);
    const existe = await dados.clienteExiste(c);
    const mapa = fichas();
    if (!existe && !mapa.has(c)) throw new ErroApi(404, 'Cliente não encontrado.');
    const contagem = u.papel === 'comercial' ? new Map() : contagemAlertasPorCliente();
    const r = await resumoCliente(c, u, mapa, contagem, existe);
    r.aparelhos = existe ? (await dados.aparelhos(c)) ?? [] : [];
    if (u.papel !== 'comercial') {
      r.alertas_lista = alertas.lista({ cliente: c }).alertas;
      r.casa = alertas.casa(c);
    }
    const obras = u.papel === 'tecnico'
      ? db.prepare('SELECT o.* FROM obras o JOIN obra_tecnicos t ON t.obra_id = o.id AND t.utilizador_id = ? WHERE o.cliente = ? ORDER BY o.data DESC').all(u.id, c)
      : db.prepare('SELECT * FROM obras WHERE cliente = ? ORDER BY data DESC').all(c);
    r.obras = obras.map((o) => formatarObra(o, mapa));
    if (u.papel !== 'tecnico') {
      const f = mapa.get(c);
      const o = f?.orcamento_id ? db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(f.orcamento_id)
        : db.prepare('SELECT * FROM orcamentos WHERE cliente = ? ORDER BY id LIMIT 1').get(c);
      r.orcamento_origem = o ? { id: o.id, criado: o.criado, servico: o.servico, estado: o.estado, valor_proposta: deCent(o.valor_proposta_cent) } : null;
    }
    r.pedidos = db.prepare('SELECT * FROM pedidos_admin WHERE cliente = ? ORDER BY criado DESC LIMIT 20').all(c)
      .filter((p) => u.papel === 'ceo' || p.por_id === u.id || p.estado === 'pendente')
      .map((p) => { const f = formatarPedido(p); if (u.papel !== 'ceo' && p.por_id !== u.id) delete f.resultado_disponivel; return f; });
    if (temFinanceiro(u)) {
      const linhas = (await dados.pagamentos()).filter((l) => l.cliente === c).reverse();
      r.pagamentos = linhas.slice(0, 50);
      r.total_pago = deCent(linhas.reduce((s, l) => s + paraCent(l.valor_com_iva), 0));
    }
    responder(res, 200, r);
  };

  h.criarCliente = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, ['codigo', 'nome', 'contacto', 'localidade']);
    const codigo = texto(v.codigo, 'o código do cliente', { max: 32, obrigatorio: true, re: RE_ID,
      reMsg: 'Código inválido: 1 a 32 letras minúsculas, dígitos e "-" (sem "-" no início ou no fim).' });
    if (RESERVADOS.has(codigo)) falha(`O código "${codigo}" é reservado.`);
    const nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    const contacto = texto(v.contacto, 'o contacto', { max: 200 });
    const localidade = texto(v.localidade, 'a localidade', { max: 80 });
    if (await dados.clienteExiste(codigo)) throw new ErroApi(409, 'Já existe um cliente com este código.');
    if (pedidoPendente('cliente', codigo)) throw new ErroApi(409, 'Já há um pedido de criação deste cliente em curso.');
    const agora = agoraIso();
    db.prepare(`INSERT INTO fichas_cliente (codigo, nome, contacto, localidade, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(codigo) DO UPDATE SET nome = excluded.nome, contacto = excluded.contacto, localidade = excluded.localidade, atualizado = excluded.atualizado`)
      .run(codigo, nome, contacto, localidade, agora, agora);
    const pedido = await pedidos.criar({ tipo: 'cliente', dados: { codigo }, cliente: codigo, utilizador: u });
    auditar(u, 'pedido_cliente', `cliente:${codigo}`, { pedido: pedido.id, nome, localidade }, ip);
    responder(res, 202, { pedido });
  };

  const CAMPOS_APARELHO = ['id', 'tipo', 'nome', 'canais', 'divisao', 'medidor', 'geral', 'bateria', 'substituir'];
  /**
   * Opções de um aparelho (as mesmas do "domus.sh aparelho"), validadas e com as
   * chaves por omissão preenchidas. Usada por POST clientes/:c/aparelhos e pela
   * lista "aparelhos" de POST orcamentos/:id/converter.
   */
  function camposAparelho(v) {
    const id = texto(v.id, 'o id do aparelho', { max: 32, obrigatorio: true, re: RE_ID,
      reMsg: 'Id do aparelho inválido: 1 a 32 letras minúsculas, dígitos e "-".' });
    const tipo = opcao(v.tipo, 'tipo', ['openbeken', 'shelly']);
    const nome = texto(v.nome, 'o nome do aparelho', { max: 60, obrigatorio: true, re: /^[^"\\-][^"\\]*$/,
      reMsg: 'Nome do aparelho: sem aspas nem "\\", e não pode começar por "-".' });
    const canais = texto(v.canais, 'os canais', { max: 1000,
      re: /^[1-9]\d?:[a-z]+(:[^,:"\\]*)*(,[1-9]\d?:[a-z]+(:[^,:"\\]*)*)*$/,
      reMsg: 'Canais: formato "n:funcao[:nome][:opção]...", separados por vírgulas (ver domus.sh aparelho).' });
    // As mesmas regras do domus.sh (FUNCOES; número de canal único): senão o erro só aparecia no servidor.
    const numeros = new Set();
    for (const item of canais ? canais.split(',') : []) {
      const [n, funcao] = item.split(':');
      if (!FUNCOES_CANAL.includes(funcao)) falha(`Canais: função "${funcao}" desconhecida (${FUNCOES_CANAL.join(', ')}).`);
      if (numeros.has(n)) falha(`Canais: o canal ${n} aparece mais de uma vez.`);
      numeros.add(n);
    }
    const divisao = texto(v.divisao, 'a divisão', { max: 40, re: /^[^"\\:,-][^"\\:,]*$/, reMsg: 'Divisão: sem aspas, ":" ou ",".' });
    // O domus.sh conta a divisão em bytes (máx. 40) quando corre sem locale UTF-8 (cron/systemd).
    if (divisao && Buffer.byteLength(divisao) > 40) falha('Divisão demasiado longa (máx. 40 bytes; acentos contam 2).');
    const medidor = v.medidor === undefined ? false : booleano(v.medidor, 'medidor');
    const geral = v.geral === undefined ? false : booleano(v.geral, 'geral');
    const bateria = v.bateria === undefined ? false : booleano(v.bateria, 'bateria');
    const substituir = v.substituir === undefined ? false : booleano(v.substituir, 'substituir');
    if (geral && !medidor) falha('"geral" só com "medidor" (é o medidor geral da casa).');
    if (geral && bateria) falha('"geral" não pode ser usado com "bateria".');
    return { id, tipo, nome, canais: canais ?? '', divisao: divisao ?? '', medidor, geral, bateria, substituir };
  }
  const pedidoAparelhoPendente = (c, id) => db.prepare('SELECT 1 FROM pedidos_admin WHERE tipo = \'aparelho\' AND cliente = ? AND estado = \'pendente\' AND json_extract(dados, \'$.id\') = ?').get(c, id);

  h.pedirAparelho = async ({ req, res, u, params, ip }) => {
    const c = codigoCliente(params.c);
    const a = camposAparelho(await lerJson(req, CAMPOS_APARELHO));
    const aps = await dados.aparelhos(c);
    if (!aps) throw new ErroApi(404, 'Cliente não encontrado (ou ainda não criado no servidor).');
    if (aps.some((x) => x.id === a.id) && !a.substituir) throw new ErroApi(409, 'O cliente já tem um aparelho com este id (use "substituir": true para o reconfigurar).');
    if (pedidoAparelhoPendente(c, a.id)) throw new ErroApi(409, 'Já há um pedido para este aparelho em curso.');
    const pedido = await pedidos.criar({ tipo: 'aparelho', cliente: c, utilizador: u, dados: { cliente: c, ...a } });
    auditar(u, 'pedido_aparelho', `cliente:${c}`, { pedido: pedido.id, aparelho: a.id, tipo: a.tipo }, ip);
    responder(res, 202, { pedido });
  };

  h.removerAparelho = async ({ req, res, u, params, ip }) => {
    const c = codigoCliente(params.c);
    if (!RE_ID.test(params.a)) throw new ErroApi(404, 'Aparelho não encontrado.');
    await lerJson(req, []);
    const aps = await dados.aparelhos(c);
    if (!aps) throw new ErroApi(404, 'Cliente não encontrado.');
    if (!aps.some((a) => a.id === params.a)) throw new ErroApi(404, 'Aparelho não encontrado.');
    const pedido = await pedidos.criar({ tipo: 'remover-aparelho', cliente: c, utilizador: u, dados: { cliente: c, id: params.a } });
    auditar(u, 'pedido_remover_aparelho', `cliente:${c}`, { pedido: pedido.id, aparelho: params.a }, ip);
    responder(res, 202, { pedido });
  };

  h.pedirPlano = async ({ req, res, u, params, ip }) => {
    const c = codigoCliente(params.c);
    const v = await lerJson(req, ['plano', 'estado']);
    const plano = opcao(v.plano, 'plano', PLANOS);
    const estado = v.estado === undefined ? 'ativo' : opcao(v.estado, 'estado', ESTADOS_PLANO);
    if (!(await dados.clienteExiste(c))) throw new ErroApi(404, 'Cliente não encontrado.');
    const pedido = await pedidos.criar({ tipo: 'plano', cliente: c, utilizador: u, dados: { cliente: c, plano, estado } });
    auditar(u, 'pedido_plano', `cliente:${c}`, { pedido: pedido.id, plano, estado }, ip);
    responder(res, 202, { pedido });
  };

  h.alertas = ({ res, url }) => {
    const c = url.searchParams.get('cliente');
    if (c !== null && !RE_ID.test(c)) falha('Cliente inválido.');
    const r = alertas.lista({ cliente: c || undefined });
    if (c) r.casa = alertas.casa(c);
    responder(res, 200, r);
  };

  // ---- orçamentos
  h.orcamentos = ({ res, url }) => {
    const estado = url.searchParams.get('estado');
    if (estado !== null) opcao(estado, 'estado', ESTADOS_ORCAMENTO);
    const linhas = estado
      ? db.prepare('SELECT * FROM orcamentos WHERE estado = ? ORDER BY id DESC LIMIT 1000').all(estado)
      : db.prepare('SELECT * FROM orcamentos ORDER BY id DESC LIMIT 1000').all();
    responder(res, 200, { orcamentos: linhas.map((o) => formatarOrcamento(o)) });
  };

  const obterOrcamento = (s) => {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(idNum(s));
    if (!o) throw new ErroApi(404, 'Pedido de orçamento não encontrado.');
    return o;
  };

  h.orcamento = ({ res, params }) => responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));

  function camposContacto(v, obrigatorio) {
    const r = {};
    if (obrigatorio || v.nome !== undefined) r.nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    if (v.telefone !== undefined) r.telefone = texto(v.telefone, 'o telefone', { max: 30, re: RE_TELEFONE, reMsg: 'Telefone inválido.' });
    if (v.email !== undefined) r.email = texto(v.email, 'o email', { max: 254, re: RE_EMAIL, reMsg: 'Email inválido.' });
    if (v.localidade !== undefined) r.localidade = texto(v.localidade, 'a localidade', { max: 80 });
    if (obrigatorio || v.servico !== undefined) r.servico = texto(v.servico, 'o serviço', { max: 80, obrigatorio: true });
    if (v.mensagem !== undefined) r.mensagem = texto(v.mensagem, 'a mensagem', { max: 2000, multilinha: true });
    return r;
  }

  h.criarOrcamento = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, ['nome', 'telefone', 'email', 'localidade', 'servico', 'mensagem', 'notas']);
    const c = camposContacto(v, true);
    if (!c.telefone && !c.email) falha('Indique um telefone ou um email.');
    const notas = texto(v.notas, 'as notas', { max: 4000, multilinha: true });
    const agora = agoraIso();
    const id = Number(db.prepare(`INSERT INTO orcamentos (criado, atualizado, origem, nome, telefone, email, localidade, servico, mensagem, notas)
      VALUES (?, ?, 'painel', ?, ?, ?, ?, ?, ?, ?)`).run(agora, agora, c.nome, c.telefone ?? null, c.email ?? null,
      c.localidade ?? null, c.servico, c.mensagem ?? null, notas).lastInsertRowid);
    auditar(u, 'orcamento_criado', `orcamento:${id}`, { origem: 'painel' }, ip);
    responder(res, 201, formatarOrcamento(obterOrcamento(String(id)), true));
  };

  h.atualizarOrcamento = async ({ req, res, u, params, ip }) => {
    const o = obterOrcamento(params.id);
    const v = await lerJson(req, ['estado', 'notas', 'data_visita', 'valor_proposta', 'motivo_perda',
      'nome', 'telefone', 'email', 'localidade', 'servico', 'mensagem']);
    const mud = camposContacto(v, false);
    if (v.estado !== undefined) mud.estado = opcao(v.estado, 'estado', ESTADOS_ORCAMENTO);
    if (v.notas !== undefined) mud.notas = texto(v.notas, 'as notas', { max: 4000, multilinha: true });
    if (v.data_visita !== undefined) mud.data_visita = diaHora(v.data_visita, 'a data da visita');
    if (v.valor_proposta !== undefined) mud.valor_proposta_cent = v.valor_proposta === null ? null : paraCent(numero(v.valor_proposta, 'o valor da proposta', { max: 1_000_000 }));
    if (v.motivo_perda !== undefined) mud.motivo_perda = texto(v.motivo_perda, 'o motivo da perda', { max: 500, multilinha: true });
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const final = { ...o, ...mud };
    if (!final.telefone && !final.email) falha('Indique um telefone ou um email.');
    if (final.estado === 'perdido' && !final.motivo_perda) falha('Indique o motivo da perda.');
    if (final.estado === 'visita_marcada' && !final.data_visita) falha('Indique a data da visita.');
    if (o.obra_id && mud.estado && mud.estado !== 'aceite') falha('Este pedido já foi convertido em cliente e obra.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE orcamentos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado = ? WHERE id = ?`)
      .run(...cols.map((k) => mud[k]), agoraIso(), o.id);
    const det = {};
    for (const k of cols) if (o[k] !== mud[k]) det[k === 'valor_proposta_cent' ? 'valor_proposta' : k] = k === 'valor_proposta_cent' ? deCent(mud[k]) : mud[k];
    auditar(u, 'orcamento_atualizado', `orcamento:${o.id}`, det, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Dois "Converter" ao mesmo tempo (duplo clique, dois separadores): o 2.º espera pela verificação de
  // `obra_id`, que só fica gravada no fim; sem isto criava obras e pedidos-admin em dobro.
  const aConverter = new Set();
  h.converter = async (ctx) => {
    const chave = String(ctx.params.id);
    if (aConverter.has(chave)) throw new ErroApi(409, 'Este pedido já está a ser convertido.');
    aConverter.add(chave);
    try {
      return await converterOrcamento(ctx);
    } finally {
      aConverter.delete(chave);
    }
  };

  async function converterOrcamento({ req, res, u, params, ip }) {
    const o = obterOrcamento(params.id);
    const v = await lerJson(req, ['codigo', 'data', 'hora', 'kit', 'tecnicos', 'notas', 'horas_estimadas', 'aparelhos'], 64 * 1024);
    if (o.estado !== 'aceite') throw new ErroApi(409, 'Só se converte um pedido com o estado "aceite".');
    if (o.obra_id) throw new ErroApi(409, 'Este pedido já foi convertido.');
    const codigo = texto(v.codigo, 'o código do cliente', { max: 32, obrigatorio: true, re: RE_ID,
      reMsg: 'Código inválido: 1 a 32 letras minúsculas, dígitos e "-" (sem "-" no início ou no fim).' });
    if (RESERVADOS.has(codigo)) falha(`O código "${codigo}" é reservado.`);
    const dataVisita = o.data_visita ? o.data_visita.slice(0, 10) : null;
    const data = dia(v.data ?? dataVisita, 'a data da obra', { obrigatorio: true });
    const h2 = hora(v.hora, 'a hora');
    const kit = opcao(v.kit, 'kit', Object.keys(KITS), { obrigatorio: false });
    const horasEst = v.horas_estimadas !== undefined ? numero(v.horas_estimadas, 'as horas estimadas', { max: 500 }) : (horasDaSimulacao(o.simulacao) ?? (kit ? KITS[kit] : null));
    const notas = texto(v.notas, 'as notas', { max: 4000, multilinha: true });
    if (v.tecnicos !== undefined && u.papel !== 'ceo') throw new ErroApi(403, 'Só o CEO atribui técnicos.');
    const tecs = v.tecnicos === undefined ? [] : tecnicos(v.tecnicos);
    // Aparelhos a pedir ao servidor (pré-preenchidos no painel a partir da simulação), validados
    // como em POST clientes/:c/aparelhos; os pedidos-admin ficam pela ordem da lista, depois do cliente.
    let aparelhos = [];
    if (v.aparelhos !== undefined && v.aparelhos !== null) {
      if (!Array.isArray(v.aparelhos)) falha('Aparelhos: tem de ser uma lista.');
      if (v.aparelhos.length > MAX_APARELHOS_CONVERTER) falha(`Demasiados aparelhos (máx. ${MAX_APARELHOS_CONVERTER}).`);
      aparelhos = v.aparelhos.map((a, i) => {
        if (!a || typeof a !== 'object' || Array.isArray(a)) falha(`Aparelho ${i + 1}: inválido.`);
        for (const k of Object.keys(a)) if (!CAMPOS_APARELHO.includes(k)) falha(`Aparelho ${i + 1}: campo desconhecido "${k}".`);
        try {
          return camposAparelho(a);
        } catch (e) {
          if (e instanceof ErroApi && e.estado === 400) falha(`Aparelho ${i + 1}: ${e.message}`);
          throw e;
        }
      });
      const vistos = new Set();
      for (const a of aparelhos) {
        if (vistos.has(a.id)) falha(`O aparelho "${a.id}" aparece repetido.`);
        vistos.add(a.id);
      }
    }
    // Material a partir da simulação (itens do catálogo), se houver.
    let mat = [];
    if (o.simulacao) {
      try {
        const sim = JSON.parse(o.simulacao);
        if (Array.isArray(sim.itens)) {
          const nomeSku = db.prepare('SELECT nome FROM catalogo WHERE sku = ?');
          mat = sim.itens.slice(0, 200).filter((i) => i && typeof i.sku === 'string' && RE_SKU.test(i.sku))
            .map((i) => ({ sku: i.sku, nome: nomeSku.get(i.sku)?.nome ?? i.sku, quantidade: Number.isFinite(i.qtd) && i.qtd > 0 ? Math.min(Math.round(i.qtd), 10_000) : 1, feito: false }));
        }
      } catch { /* simulação sem itens válidos */ }
    }
    const existe = await dados.clienteExiste(codigo);
    const fichaExistente = db.prepare('SELECT * FROM fichas_cliente WHERE codigo = ?').get(codigo);
    if (!existe && fichaExistente && fichaExistente.orcamento_id && fichaExistente.orcamento_id !== o.id) {
      throw new ErroApi(409, 'Esse código já está reservado para outro cliente novo. Escolha outro.');
    }
    if (aparelhos.length && existe) {
      const aps = (await dados.aparelhos(codigo)) ?? [];
      for (const a of aparelhos) {
        if (aps.some((x) => x.id === a.id) && !a.substituir) throw new ErroApi(409, `O cliente já tem um aparelho "${a.id}" (use "substituir": true para o reconfigurar).`);
      }
    }
    for (const a of aparelhos) {
      if (pedidoAparelhoPendente(codigo, a.id)) throw new ErroApi(409, `Já há um pedido para o aparelho "${a.id}" em curso.`);
    }
    let pedido = null;
    if (!existe && !pedidoPendente('cliente', codigo)) {
      pedido = await pedidos.criar({ tipo: 'cliente', dados: { codigo }, cliente: codigo, utilizador: u, orcamentoId: o.id });
    }
    // O domus.sh trata os pedidos pela ordem dos nomes (ids crescentes): cliente primeiro, depois os aparelhos.
    const pedidosAparelhos = [];
    for (const a of aparelhos) {
      pedidosAparelhos.push(await pedidos.criar({ tipo: 'aparelho', cliente: codigo, utilizador: u, orcamentoId: o.id, dados: { cliente: codigo, ...a } }));
    }
    const agora = agoraIso();
    const obraId = transacao(db, () => {
      db.prepare(`INSERT INTO fichas_cliente (codigo, nome, contacto, localidade, orcamento_id, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(codigo) DO UPDATE SET orcamento_id = COALESCE(fichas_cliente.orcamento_id, excluded.orcamento_id),
          nome = COALESCE(fichas_cliente.nome, excluded.nome), contacto = COALESCE(fichas_cliente.contacto, excluded.contacto),
          localidade = COALESCE(fichas_cliente.localidade, excluded.localidade), atualizado = excluded.atualizado`)
        .run(codigo, o.nome, [o.telefone, o.email].filter(Boolean).join(' · ') || null, o.localidade, o.id, agora, agora);
      const id = Number(db.prepare(`INSERT INTO obras (cliente, orcamento_id, data, hora, kit, estado, material, horas_estimadas, notas, criado, atualizado)
        VALUES (?, ?, ?, ?, ?, 'agendada', ?, ?, ?, ?, ?)`).run(codigo, o.id, data, h2, kit, JSON.stringify(mat), horasEst, notas, agora, agora).lastInsertRowid);
      for (const t of tecs) db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(id, t);
      db.prepare('UPDATE orcamentos SET cliente = ?, obra_id = ?, pedido_id = ?, atualizado = ? WHERE id = ?').run(codigo, id, pedido?.id ?? null, agora, o.id);
      return id;
    });
    auditar(u, 'orcamento_convertido', `orcamento:${o.id}`, { cliente: codigo, obra: obraId, pedido: pedido?.id ?? null, aparelhos: pedidosAparelhos.length }, ip);
    for (const [i, a] of aparelhos.entries()) auditar(u, 'pedido_aparelho', `cliente:${codigo}`, { pedido: pedidosAparelhos[i].id, aparelho: a.id, tipo: a.tipo, orcamento: o.id }, ip);
    auditar(u, 'obra_criada', `obra:${obraId}`, { cliente: codigo, data, kit, orcamento: o.id }, ip);
    responder(res, 201, {
      cliente: codigo, cliente_existia: existe, pedido, aparelhos: pedidosAparelhos,
      obra: formatarObra(db.prepare('SELECT * FROM obras WHERE id = ?').get(obraId), fichas()),
    });
  };

  // ---- obras
  h.obras = ({ res, u, url }) => {
    const cond = [];
    const args = [];
    let join = '';
    if (u.papel === 'tecnico') { join = 'JOIN obra_tecnicos t ON t.obra_id = o.id AND t.utilizador_id = ?'; args.push(u.id); }
    const de = url.searchParams.get('de');
    const ate = url.searchParams.get('ate');
    const estado = url.searchParams.get('estado');
    const cliente = url.searchParams.get('cliente');
    if (de !== null) { cond.push('o.data >= ?'); args.push(dia(de, 'a data inicial', { obrigatorio: true })); }
    if (ate !== null) { cond.push('o.data <= ?'); args.push(dia(ate, 'a data final', { obrigatorio: true })); }
    if (estado !== null) { cond.push('o.estado = ?'); args.push(opcao(estado, 'estado', ESTADOS_OBRA)); }
    if (cliente !== null) { if (!RE_ID.test(cliente)) falha('Cliente inválido.'); cond.push('o.cliente = ?'); args.push(cliente); }
    const linhas = db.prepare(`SELECT o.* FROM obras o ${join} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY o.data, o.hora, o.id LIMIT 2000`).all(...args);
    const mapa = fichas();
    responder(res, 200, { obras: linhas.map((o) => formatarObra(o, mapa)) });
  };

  const obterObra = (s, u) => {
    const o = db.prepare('SELECT * FROM obras WHERE id = ?').get(idNum(s));
    if (!o) throw new ErroApi(404, 'Obra não encontrada.');
    if (u.papel === 'tecnico' && !obraDoTecnico(o.id, u.id)) throw new ErroApi(403, 'Esta obra não lhe está atribuída.');
    return o;
  };

  h.obra = ({ res, u, params }) => responder(res, 200, formatarObra(obterObra(params.id, u), fichas()));

  async function camposObra(v, parcial) {
    const r = {};
    if (!parcial || v.cliente !== undefined) {
      r.cliente = texto(v.cliente, 'o cliente', { max: 32, obrigatorio: true, re: RE_ID, reMsg: 'Código de cliente inválido.' });
      if (!(await clienteConhecido(r.cliente))) falha('Cliente desconhecido (crie-o primeiro).');
    }
    if (!parcial || v.data !== undefined) r.data = dia(v.data, 'a data', { obrigatorio: true });
    if (v.hora !== undefined) r.hora = hora(v.hora, 'a hora');
    if (v.kit !== undefined) r.kit = opcao(v.kit, 'kit', Object.keys(KITS), { obrigatorio: false });
    if (v.estado !== undefined) r.estado = opcao(v.estado, 'estado', ESTADOS_OBRA);
    if (v.material !== undefined) r.material = JSON.stringify(material(v.material));
    if (v.horas_estimadas !== undefined) r.horas_estimadas = numero(v.horas_estimadas, 'as horas estimadas', { max: 500 });
    else if (r.kit !== undefined && !parcial) r.horas_estimadas = r.kit ? KITS[r.kit] : null;
    if (v.horas_reais !== undefined) r.horas_reais = numero(v.horas_reais, 'as horas reais', { max: 500 });
    if (v.notas !== undefined) r.notas = texto(v.notas, 'as notas', { max: 4000, multilinha: true });
    if (v.orcamento_id !== undefined) {
      if (v.orcamento_id !== null && !(Number.isInteger(v.orcamento_id) && db.prepare('SELECT 1 FROM orcamentos WHERE id = ?').get(v.orcamento_id))) falha('Pedido de orçamento inexistente.');
      r.orcamento_id = v.orcamento_id;
    }
    return r;
  }
  const CAMPOS_OBRA = ['cliente', 'data', 'hora', 'kit', 'estado', 'material', 'horas_estimadas', 'horas_reais', 'notas', 'tecnicos', 'orcamento_id'];

  h.criarObra = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, CAMPOS_OBRA, 64 * 1024);
    const r = await camposObra(v, false);
    const tecs = v.tecnicos === undefined ? [] : tecnicos(v.tecnicos);
    const agora = agoraIso();
    const id = transacao(db, () => {
      const cols = Object.keys(r);
      const novo = Number(db.prepare(`INSERT INTO obras (${cols.join(', ')}, criado, atualizado) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
        .run(...cols.map((k) => r[k]), agora, agora).lastInsertRowid);
      for (const t of tecs) db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(novo, t);
      return novo;
    });
    auditar(u, 'obra_criada', `obra:${id}`, { cliente: r.cliente, data: r.data, kit: r.kit ?? null, tecnicos: tecs }, ip);
    responder(res, 201, formatarObra(db.prepare('SELECT * FROM obras WHERE id = ?').get(id), fichas()));
  };

  h.atualizarObra = async ({ req, res, u, params, ip }) => {
    const o = obterObra(params.id, u);
    const v = await lerJson(req, CAMPOS_OBRA, 64 * 1024);
    if (u.papel === 'tecnico') {
      const proibidos = Object.keys(v).filter((k) => !['estado', 'horas_reais', 'material', 'notas'].includes(k));
      if (proibidos.length) throw new ErroApi(403, 'Só pode alterar o estado, as horas reais, o material e as notas das suas obras.');
      if (v.estado === 'cancelada') throw new ErroApi(403, 'Só o CEO cancela obras.');
    }
    const r = await camposObra(v, true);
    const tecs = v.tecnicos === undefined ? null : tecnicos(v.tecnicos);
    if (!Object.keys(r).length && tecs === null) falha('Nada para alterar.');
    transacao(db, () => {
      const cols = Object.keys(r);
      db.prepare(`UPDATE obras SET ${cols.map((k) => `${k} = ?, `).join('')}atualizado = ? WHERE id = ?`).run(...cols.map((k) => r[k]), agoraIso(), o.id);
      if (tecs) {
        db.prepare('DELETE FROM obra_tecnicos WHERE obra_id = ?').run(o.id);
        for (const t of tecs) db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(o.id, t);
      }
    });
    const det = { ...r };
    if (det.material) det.material = `${JSON.parse(det.material).length} artigos`;
    if (tecs) det.tecnicos = tecs;
    auditar(u, 'obra_atualizada', `obra:${o.id}`, det, ip);
    responder(res, 200, formatarObra(db.prepare('SELECT * FROM obras WHERE id = ?').get(o.id), fichas()));
  };

  // ---- pagamentos (só leitura do CSV)
  h.pagamentos = async ({ res, url }) => {
    const mes = url.searchParams.get('mes');
    if (mes !== null && !/^\d{4}-\d{2}$/.test(mes)) falha('Mês inválido (AAAA-MM).');
    let linhas = await dados.pagamentos();
    if (mes) linhas = linhas.filter((l) => l.data.startsWith(mes));
    if (url.searchParams.get('formato') === 'csv') {
      const seguro = (s) => (/^[=+\-@\t\r]/.test(String(s)) ? `'${s}` : String(s)).replace(/[;\r\n"]/g, ' ');
      const dec = (n) => n.toFixed(2).replace('.', ',');
      const csv = ['data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe']
        .concat(linhas.map((l) => [l.data, seguro(l.cliente), seguro(l.plano), dec(l.valor_com_iva), dec(l.valor_sem_iva), seguro(l.id_stripe)].join(';')))
        .join('\r\n');
      const corpo = Buffer.from(`\ufeff${csv}\r\n`);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pagamentos${mes ? `-${mes}` : ''}.csv"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': corpo.length,
      });
      return res.end(corpo);
    }
    const porMes = new Map();
    for (const l of linhas) {
      const m = l.data.slice(0, 7);
      const t = porMes.get(m) ?? { mes: m, pagamentos: 0, com: 0, sem: 0 };
      t.pagamentos += 1; t.com += paraCent(l.valor_com_iva); t.sem += paraCent(l.valor_sem_iva);
      porMes.set(m, t);
    }
    const totais = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes))
      .map((t) => ({ mes: t.mes, pagamentos: t.pagamentos, com_iva: deCent(t.com), sem_iva: deCent(t.sem) }));
    responder(res, 200, {
      linhas: [...linhas].reverse(),
      totais_mes: totais,
      total: {
        pagamentos: linhas.length,
        com_iva: deCent(linhas.reduce((s, l) => s + paraCent(l.valor_com_iva), 0)),
        sem_iva: deCent(linhas.reduce((s, l) => s + paraCent(l.valor_sem_iva), 0)),
      },
    });
  };

  // ---- utilizadores do painel
  h.utilizadores = ({ res }) => responder(res, 200, {
    utilizadores: db.prepare('SELECT * FROM utilizadores ORDER BY ativo DESC, nome').all().map(publicoUtilizador),
  });

  const ceosAtivos = () => db.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE papel = \'ceo\' AND ativo = 1').get().n;

  h.criarUtilizador = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, ['nome', 'email', 'papel', 'password']);
    const nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    const email = texto(v.email, 'o email', { max: 254, obrigatorio: true, re: RE_EMAIL, reMsg: 'Email inválido.' }).toLowerCase();
    const papel = opcao(v.papel, 'papel', PAPEIS);
    let senha = v.password;
    const gerada = senha === undefined || senha === null || senha === '';
    if (gerada) senha = gerarSenha();
    const prob = problemaSenha(senha);
    if (prob) falha(prob);
    if (db.prepare('SELECT 1 FROM utilizadores WHERE email = ?').get(email)) throw new ErroApi(409, 'Já existe um utilizador com este email.');
    const agora = agoraIso();
    const id = Number(db.prepare('INSERT INTO utilizadores (nome, email, papel, hash, ativo, criado, atualizado) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(nome, email, papel, await hashSenha(senha), agora, agora).lastInsertRowid);
    auditar(u, 'utilizador_criado', `utilizador:${id}`, { email, papel }, ip);
    const r = { utilizador: publicoUtilizador(db.prepare('SELECT * FROM utilizadores WHERE id = ?').get(id)) };
    if (gerada) r.password = senha;           // mostrada só nesta resposta
    responder(res, 201, r);
  };

  h.atualizarUtilizador = async ({ req, res, u, params, ip }) => {
    const alvo = db.prepare('SELECT * FROM utilizadores WHERE id = ?').get(idNum(params.id));
    if (!alvo) throw new ErroApi(404, 'Utilizador não encontrado.');
    const v = await lerJson(req, ['nome', 'papel', 'ativo', 'repor_password', 'password']);
    const mud = {};
    if (v.nome !== undefined) mud.nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    if (v.papel !== undefined) mud.papel = opcao(v.papel, 'papel', PAPEIS);
    if (v.ativo !== undefined) mud.ativo = booleano(v.ativo, 'ativo') ? 1 : 0;
    let nova = null;
    if (v.repor_password !== undefined && booleano(v.repor_password, 'repor_password')) nova = gerarSenha();
    if (v.password !== undefined) {
      const prob = problemaSenha(v.password);
      if (prob) falha(prob);
      nova = v.password;
    }
    if (!Object.keys(mud).length && !nova) falha('Nada para alterar.');
    const perdeCeo = alvo.papel === 'ceo' && alvo.ativo && ((mud.papel && mud.papel !== 'ceo') || mud.ativo === 0);
    if (perdeCeo && ceosAtivos() <= 1) throw new ErroApi(409, 'Tem de haver pelo menos um CEO ativo.');
    if (nova) mud.hash = await hashSenha(nova);
    const cols = Object.keys(mud);
    db.prepare(`UPDATE utilizadores SET ${cols.map((k) => `${k} = ?, `).join('')}atualizado = ? WHERE id = ?`).run(...cols.map((k) => mud[k]), agoraIso(), alvo.id);
    // Papel, desativação ou palavra-passe nova: as sessões abertas terminam.
    if (mud.papel !== undefined || mud.ativo === 0 || nova) auth.terminarSessoes(alvo.id);
    if (nova) db.prepare('DELETE FROM falhas_login WHERE email = ?').run(alvo.email);
    const det = { ...mud };
    delete det.hash;
    if (nova) det.palavra_passe_reposta = true;
    auditar(u, 'utilizador_atualizado', `utilizador:${alvo.id}`, { email: alvo.email, ...det, ativo: det.ativo === undefined ? undefined : Boolean(det.ativo) }, ip);
    const r = { utilizador: publicoUtilizador(db.prepare('SELECT * FROM utilizadores WHERE id = ?').get(alvo.id)) };
    if (nova && v.repor_password) r.password = nova;   // mostrada só nesta resposta
    responder(res, 200, r);
  };

  h.auditoria = ({ res, url }) => {
    const alvo = url.searchParams.get('alvo');
    const linhas = alvo
      ? db.prepare('SELECT * FROM auditoria WHERE alvo = ? ORDER BY id DESC LIMIT 500').all(String(alvo).slice(0, 80))
      : db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 500').all();
    responder(res, 200, {
      auditoria: linhas.map((a) => ({
        id: a.id, quando: a.quando, utilizador_id: a.utilizador_id, email: a.email, acao: a.acao, alvo: a.alvo,
        detalhes: a.detalhes ? JSON.parse(a.detalhes) : null, ip: a.ip,
      })),
    });
  };

  // ---- pedidos-admin
  h.pedidos = async ({ res, u }) => {
    await pedidos.verificar();
    const linhas = u.papel === 'ceo'
      ? db.prepare('SELECT * FROM pedidos_admin ORDER BY criado DESC LIMIT 200').all()
      : db.prepare('SELECT * FROM pedidos_admin WHERE por_id = ? ORDER BY criado DESC LIMIT 200').all(u.id);
    responder(res, 200, { pedidos: linhas.map(formatarPedido) });
  };

  h.pedido = async ({ res, u, params }) => {
    if (!RE_PEDIDO.test(params.id)) throw new ErroApi(404, 'Pedido não encontrado.');
    const r = await pedidos.resultado(params.id, u);
    if (!r) throw new ErroApi(404, 'Pedido não encontrado.');
    if (r === 'proibido') throw new ErroApi(403, 'Este pedido não é seu.');
    responder(res, 200, r);
  };

  // ---- catálogo e configuração do simulador (só CEO)
  h.catalogo = ({ res }) => responder(res, 200, {
    itens: db.prepare('SELECT * FROM catalogo ORDER BY categoria, nome').all().map(formatarArtigo),
    config: lerConfigOrcamento(),
  });

  function camposArtigo(v, parcial) {
    const r = {};
    if (!parcial || v.sku !== undefined) {
      r.sku = texto(v.sku, 'o SKU', { max: 40, obrigatorio: true, re: RE_SKU, reMsg: 'SKU: maiúsculas, dígitos, ".", "_" e "-" (máx. 40).' });
    }
    if (!parcial || v.nome !== undefined) r.nome = texto(v.nome, 'o nome', { max: 160, obrigatorio: true });
    if (!parcial || v.categoria !== undefined) r.categoria = opcao(v.categoria, 'categoria', CATEGORIAS);
    if (v.fornecedor !== undefined) r.fornecedor = texto(v.fornecedor, 'o fornecedor', { max: 160 });
    if (v.link !== undefined) {
      r.link = texto(v.link, 'o link', { max: 500, re: /^https:\/\/[^\s"<>]+$/, reMsg: 'Link: endereço https:// completo.' });
    }
    if (v.preco_compra !== undefined) r.preco_compra_cent = v.preco_compra === null ? null : paraCent(numero(v.preco_compra, 'o preço de compra', { max: 100_000 }));
    if (!parcial || v.preco_venda_iva !== undefined) r.preco_venda_iva_cent = paraCent(numero(v.preco_venda_iva, 'o preço de venda', { max: 100_000, nulo: false }));
    if (v.horas_instalacao !== undefined) r.horas_instalacao = numero(v.horas_instalacao, 'as horas de instalação', { max: 100, nulo: false });
    if (v.especificacoes !== undefined) {
      const e = v.especificacoes;
      if (!e || typeof e !== 'object' || Array.isArray(e)) falha('As especificações têm de ser um objeto JSON.');
      const j = JSON.stringify(e);
      if (Buffer.byteLength(j) > 8192) falha('Especificações demasiado grandes (máx. 8 KB).');
      r.especificacoes = j;
    }
    if (v.ativo !== undefined) r.ativo = booleano(v.ativo, 'ativo') ? 1 : 0;
    if (v.visivel_cliente !== undefined) r.visivel_cliente = booleano(v.visivel_cliente, 'visivel_cliente') ? 1 : 0;
    return r;
  }
  const CAMPOS_ARTIGO = ['sku', 'nome', 'categoria', 'fornecedor', 'link', 'preco_compra', 'preco_venda_iva', 'horas_instalacao', 'especificacoes', 'ativo', 'visivel_cliente'];

  h.criarArtigo = async ({ req, res, u, ip }) => {
    const r = camposArtigo(await lerJson(req, CAMPOS_ARTIGO, 32 * 1024), false);
    if (db.prepare('SELECT 1 FROM catalogo WHERE sku = ?').get(r.sku)) throw new ErroApi(409, 'Já existe um artigo com este SKU.');
    const cols = Object.keys(r);
    const id = Number(db.prepare(`INSERT INTO catalogo (${cols.join(', ')}, atualizado) VALUES (${cols.map(() => '?').join(', ')}, ?)`)
      .run(...cols.map((k) => r[k]), agoraIso()).lastInsertRowid);
    auditar(u, 'catalogo_criado', `catalogo:${id}`, { sku: r.sku }, ip);
    responder(res, 201, formatarArtigo(db.prepare('SELECT * FROM catalogo WHERE id = ?').get(id)));
  };

  h.atualizarArtigo = async ({ req, res, u, params, ip }) => {
    const a = db.prepare('SELECT * FROM catalogo WHERE id = ?').get(idNum(params.id));
    if (!a) throw new ErroApi(404, 'Artigo não encontrado.');
    const r = camposArtigo(await lerJson(req, CAMPOS_ARTIGO, 32 * 1024), true);
    if (!Object.keys(r).length) falha('Nada para alterar.');
    if (r.sku && r.sku !== a.sku && db.prepare('SELECT 1 FROM catalogo WHERE sku = ?').get(r.sku)) throw new ErroApi(409, 'Já existe um artigo com este SKU.');
    // Preço de venda mudado pelo CEO: deixa de ser "provisório" (tira essa parte da nota).
    if (r.preco_venda_iva_cent !== undefined && r.preco_venda_iva_cent !== a.preco_venda_iva_cent) {
      const esp = semPrecoProvisorio(r.especificacoes ?? a.especificacoes);
      if (esp !== null) r.especificacoes = esp;
    }
    const cols = Object.keys(r);
    db.prepare(`UPDATE catalogo SET ${cols.map((k) => `${k} = ?, `).join('')}atualizado = ? WHERE id = ?`).run(...cols.map((k) => r[k]), agoraIso(), a.id);
    auditar(u, 'catalogo_atualizado', `catalogo:${a.id}`, { sku: a.sku, campos: cols }, ip);
    responder(res, 200, formatarArtigo(db.prepare('SELECT * FROM catalogo WHERE id = ?').get(a.id)));
  };

  h.configOrcamento = ({ res }) => responder(res, 200, lerConfigOrcamento());

  h.atualizarConfigOrcamento = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, [...Object.keys(CONFIG_ORCAMENTO), 'deslocacao_base']);
    const mud = {};
    for (const [k, { rotulo, ...lim }] of Object.entries(CONFIG_ORCAMENTO)) {
      if (v[k] !== undefined) mud[k] = numero(v[k], rotulo, { ...lim, nulo: false });
    }
    if (v.deslocacao_base !== undefined) {
      if (typeof v.deslocacao_base !== 'string' || !NOMES_CONCELHOS.has(v.deslocacao_base)) falha('A base da deslocação tem de ser um dos 308 concelhos (nome da lista).');
      mud.deslocacao_base = v.deslocacao_base;
    }
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    for (const [k, val] of Object.entries(mud)) db.prepare('UPDATE config_orcamento SET valor = ? WHERE chave = ?').run(val, k);
    auditar(u, 'config_orcamento_atualizada', 'config-orcamento', mud, ip);
    responder(res, 200, lerConfigOrcamento());
  };

  // ------------------------------------------------------------ públicos
  async function orcamentoPublico(req, res, ip) {
    if (!verificarOrigem(req, config.origens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    const espera = Math.max(porIpOrcamento.espera(ip), global.espera('*'));
    if (espera) {
      registo.aviso(`orçamento: limite atingido (ip ${ip})`);
      throw new ErroApi(429, 'Recebemos vários pedidos seguidos deste endereço. Tente mais tarde ou contacte-nos por telefone.', { 'Retry-After': String(espera) });
    }
    porIpOrcamento.registar(ip);
    global.registar('*');
    const v = await lerJson(req, ['nome', 'telefone', 'email', 'localidade', 'servico', 'mensagem', 'website', 'codigo_cliente', 'simulacao'], LIMITE_ORCAMENTO);
    // Campo-armadilha: só robôs o preenchem. Responde como se tivesse corrido bem.
    if (v.website !== undefined && v.website !== null && v.website !== '') {
      registo.aviso(`orçamento: armadilha preenchida (ip ${ip}), descartado`);
      return responder(res, 201, { ok: true });
    }
    const c = camposContacto(v, true);
    if (!c.telefone && !c.email) falha('Indique um telefone ou um email para o podermos contactar.');
    const codigoCli = texto(v.codigo_cliente, 'o código de cliente', { max: 32, re: RE_ID, reMsg: 'Código de cliente inválido.' });
    const sim = validarSimulacao(v.simulacao);
    const agora = agoraIso();
    const id = Number(db.prepare(`INSERT INTO orcamentos (criado, atualizado, origem, nome, telefone, email, localidade, servico, mensagem, codigo_cliente, simulacao)
      VALUES (?, ?, 'site', ?, ?, ?, ?, ?, ?, ?, ?)`).run(agora, agora, c.nome, c.telefone ?? null, c.email ?? null, c.localidade ?? null,
      c.servico, c.mensagem ?? null, codigoCli, sim).lastInsertRowid);
    auditar(null, 'orcamento_recebido', `orcamento:${id}`, { origem: 'site', simulacao: Boolean(sim) }, ip);
    registo.info(`orçamento ${id} recebido`);
    responder(res, 201, { ok: true });
  }

  function catalogoPublico(req, res) {
    const itens = db.prepare('SELECT sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes FROM catalogo WHERE ativo = 1 AND visivel_cliente = 1 ORDER BY categoria, nome').all()
      .map((a) => {
        // A "nota" é interna (ex.: "preço provisório — confirmar"): só o CEO a vê no painel.
        const { nota, ...especificacoes } = JSON.parse(a.especificacoes || '{}');
        return { sku: a.sku, nome: a.nome, categoria: a.categoria, preco_venda_iva: deCent(a.preco_venda_iva_cent), horas_instalacao: a.horas_instalacao, especificacoes };
      });
    const cfg = lerConfigOrcamento();
    const config = Object.fromEntries(CONFIG_PUBLICA.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
    responder(res, 200, { itens, config }, { 'Cache-Control': 'public, max-age=60' });
  }

  // ------------------------------------------------------------ despacho
  async function tratar(req, res, url) {
    const caminho = url.pathname;
    const ip = ipDe(req, config.confiarProxy);
    try {
      if (caminho === '/api/orcamento') {
        if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' });
        return await orcamentoPublico(req, res, ip);
      }
      if (caminho === '/api/catalogo') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
        return catalogoPublico(req, res);
      }
      const resto = caminho.slice(P.length);
      const { rota, params, caminhoExiste } = encontrarRota(req.method, resto);
      if (!rota) {
        if (caminhoExiste) return responder(res, 405, { erro: 'Método não permitido.' });
        return responder(res, 404, { erro: 'Endereço desconhecido.' });
      }
      if (rota.metodo === 'POST') {
        // CSRF: só pedidos do próprio site, e sempre JSON.
        if (!verificarOrigem(req, config.origens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
        if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
      }
      let u = null;
      if (rota.papeis !== 'publico') {
        u = auth.sessao(req, res);
        if (!u) throw new ErroApi(401, 'Sessão inválida ou expirada. Entre de novo.');
        if (!rota.papeis.includes(u.papel)) throw new ErroApi(403, 'Não tem acesso a esta área.');
      }
      return await h[rota.nome]({ req, res, u, params, url, ip });
    } catch (e) {
      if (res.headersSent) return undefined;
      if (e instanceof ErroApi) return responder(res, e.estado, { erro: e.message }, e.cabecalhos);
      registo.erro(`${req.method} ${caminho}: ${e?.stack || e}`);
      return responder(res, 500, { erro: 'Erro interno. Tente de novo mais tarde.' });
    }
  }

  return { tratar, auditar };
}

