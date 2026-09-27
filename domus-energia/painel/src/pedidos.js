// Fila de pedidos-admin (docs/PAINEL-EMPRESA.md §2).
//
// O painel NÃO tem as palavras-passe do servidor. Para criar clientes, aparelhos
// ou mudar planos escreve dados/pedidos-admin/<id>.json, uma linha JSON com as
// chaves SEMPRE nesta ordem (o domus.sh valida-a com expressões exatas):
//   {"id":"p-AAAAMMDDhhmmss-xxxxxxxx","tipo":"...","dados":{...},"por":"email","criado":"...Z"}
// O temporizador do VPS corre "./domus.sh processar-pedidos", que escreve
// <id>.resultado.json (modo 600; inclui a palavra-passe gerada) e move o pedido
// para feitos/. O resultado é mostrado UMA vez a quem fez o pedido (ou ao CEO)
// e apagado logo a seguir.
//
// No sentido inverso, "./domus.sh painel-utilizador <email> <papel>" escreve
// u-AAAAMMDDhhmmss-xxxxxxxx.json (tipo painel-utilizador, por "domus.sh") que
// ESTE serviço aplica (cria/atualiza o utilizador do painel), responde em
// <id>.resultado.json (sem a palavra-passe) e apaga o pedido.

import { readdir, readFile, lstat, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { escreverAtomico, iso } from './util.js';
import { hashSenha, problemaSenha } from './senhas.js';
import { PAPEIS } from './db.js';

export const TIPOS_PEDIDO = ['cliente', 'aparelho', 'remover-aparelho', 'plano'];
export const RE_PEDIDO = /^[pu]-\d{14}-[0-9a-f]{8}$/;
export const RE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
const MAX_RESULTADO = 256 * 1024;
const MAX_PEDIDO_U = 16 * 1024;

// Os ids crescem sempre (o domus.sh trata os pedidos pela ordem dos nomes): no mesmo
// segundo, a parte aleatória é maior que a do id anterior. Assim, um cliente e os
// seus aparelhos pedidos de seguida (converter orçamento) são feitos por essa ordem.
const ultimoId = { p: '', u: '' };
function novoId(prefixo, agora) {
  let d = new Date(agora).toISOString().replace(/\D/g, '').slice(0, 14);
  let sufixo = randomBytes(4).readUInt32BE(0) >>> 1;          // metade de baixo: há folga para crescer
  const ant = ultimoId[prefixo];
  if (ant) {
    const [, dAnt, sAnt] = ant.split('-');
    if (d < dAnt) d = dAnt;                                    // relógio que voltou atrás
    if (d === dAnt) {
      const nAnt = parseInt(sAnt, 16);
      if (sufixo <= nAnt) sufixo = nAnt + 1 + (sufixo % 4096);
      if (sufixo > 0xffffffff) {                               // sem folga: passa para o segundo seguinte
        d = String(BigInt(d) + 1n);
        sufixo = randomBytes(4).readUInt32BE(0) >>> 1;
      }
    }
  }
  const id = `${prefixo}-${d}-${sufixo.toString(16).padStart(8, '0')}`;
  ultimoId[prefixo] = id;
  return id;
}

/** Dados de cada tipo, com as chaves sempre na mesma ordem (o domus.sh depende disto). */
export function dadosCanonicos(tipo, d) {
  switch (tipo) {
    case 'cliente':
      return { codigo: d.codigo };
    case 'aparelho':
      return {
        cliente: d.cliente, id: d.id, tipo: d.tipo, nome: d.nome, canais: d.canais ?? '', divisao: d.divisao ?? '',
        medidor: Boolean(d.medidor), geral: Boolean(d.geral), bateria: Boolean(d.bateria), substituir: Boolean(d.substituir),
      };
    case 'remover-aparelho':
      return { cliente: d.cliente, id: d.id };
    case 'plano':
      return { cliente: d.cliente, plano: d.plano, estado: d.estado };
    default:
      throw new Error(`tipo de pedido desconhecido: ${tipo}`);
  }
}

async function lerFicheiroSeguro(caminho, max) {
  const st = await lstat(caminho);
  if (!st.isFile() || st.nlink !== 1 || st.size > max) throw new Error('ficheiro inválido');
  return readFile(caminho, 'utf8');
}

export class Pedidos {
  constructor({ config, db, registo, auditar, relogio = () => Date.now() }) {
    this.config = config;
    this.db = db;
    this.registo = registo;
    this.auditar = auditar;
    this.relogio = relogio;
    this.dir = config.pedidosDir;
    this.temporizador = null;
    this.aVerificar = null;
  }

  caminho(id, resultado = false) {
    if (!RE_PEDIDO.test(id)) throw new Error('id de pedido inválido');
    return join(this.dir, resultado ? `${id}.resultado.json` : `${id}.json`);
  }

  /** Escreve o pedido na fila e regista-o na base de dados. */
  async criar({ tipo, dados, cliente = null, utilizador, orcamentoId = null }) {
    if (!TIPOS_PEDIDO.includes(tipo)) throw new Error('tipo inválido');
    const agora = this.relogio();
    const id = novoId('p', agora);
    const criado = iso(agora);
    const pedido = { id, tipo, dados: dadosCanonicos(tipo, dados), por: utilizador.email, criado };
    await mkdir(this.dir, { recursive: true });
    await escreverAtomico(this.caminho(id), `${JSON.stringify(pedido)}\n`, 0o600);
    this.db.prepare(`INSERT INTO pedidos_admin (id, tipo, cliente, dados, por_id, por_email, criado, orcamento_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tipo, cliente, JSON.stringify(pedido.dados), utilizador.id, utilizador.email, criado, orcamentoId);
    return { id, tipo, estado: 'pendente', criado };
  }

  /** Lê e valida um <id>.resultado.json (ou null se ainda não existe). */
  async lerResultado(id) {
    let txt;
    try {
      txt = await lerFicheiroSeguro(this.caminho(id, true), MAX_RESULTADO);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      this.registo.aviso(`pedido ${id}: resultado ilegível (${e.code || e.message})`);
      return null;
    }
    let r;
    try {
      r = JSON.parse(txt);
    } catch {
      return { id, ok: false, erro: 'Resultado ilegível.' };
    }
    if (!r || typeof r !== 'object' || r.id !== id) return { id, ok: false, erro: 'Resultado ilegível.' };
    const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    return {
      id,
      tipo: s(r.tipo, 32),
      ok: r.ok === true,
      erro: s(r.erro, 1000),
      cliente: s(r.cliente, 64),
      aparelho: s(r.aparelho, 64),
      password: s(r.password, 200),
      saida: s(r.saida, 64 * 1024),
      concluido: s(r.concluido, 40),
    };
  }

  /** Atualiza o estado na base de dados a partir do resultado (sem o apagar). */
  #registarResultado(p, r) {
    if (p.estado !== 'pendente') return;
    const estado = r.ok ? 'concluido' : 'erro';
    this.db.prepare('UPDATE pedidos_admin SET estado = ?, concluido = ?, erro = ? WHERE id = ? AND estado = \'pendente\'')
      .run(estado, r.concluido || iso(this.relogio()), r.ok ? null : (r.erro || 'Falhou.'), p.id);
    p.estado = estado;
    this.auditar(null, `pedido_${estado}`, `pedido:${p.id}`, { tipo: p.tipo, cliente: p.cliente, erro: r.ok ? undefined : r.erro });
  }

  /**
   * Resultado de um pedido para quem o pode ver (quem o fez ou o CEO). Se o
   * ficheiro do resultado ainda existe, devolve-o completo (com a palavra-passe
   * gerada) e APAGA-O: só é mostrado uma vez.
   */
  async resultado(id, utilizador) {
    const p = this.db.prepare('SELECT * FROM pedidos_admin WHERE id = ?').get(id);
    if (!p) return null;
    if (utilizador.papel !== 'ceo' && p.por_id !== utilizador.id) return 'proibido';
    const r = await this.lerResultado(id);
    let resultado = null;
    if (r) {
      this.#registarResultado(p, r);
      await unlink(this.caminho(id, true)).catch(() => {});
      this.db.prepare('UPDATE pedidos_admin SET mostrado = ? WHERE id = ?').run(iso(this.relogio()), id);
      this.auditar(utilizador, 'pedido_resultado_mostrado', `pedido:${id}`, { tipo: p.tipo, com_palavra_passe: Boolean(r.password) });
      resultado = r;
    }
    const atual = this.db.prepare('SELECT * FROM pedidos_admin WHERE id = ?').get(id);
    return { pedido: formatarPedido(atual), resultado };
  }

  /** Verificação periódica: estados dos pedidos, limpeza e pedidos painel-utilizador. */
  async verificar() {
    if (this.aVerificar) return this.aVerificar;
    this.aVerificar = (async () => {
      try {
        const pendentes = this.db.prepare('SELECT * FROM pedidos_admin WHERE estado = \'pendente\'').all();
        for (const p of pendentes) {
          const r = await this.lerResultado(p.id);
          if (r) this.#registarResultado(p, r);
        }
        // Resultados nunca vistos (com palavras-passe) não ficam para sempre.
        const limite = iso(this.relogio() - this.config.resultadoRetencaoMs);
        const velhos = this.db.prepare('SELECT id FROM pedidos_admin WHERE mostrado IS NULL AND estado != \'pendente\' AND criado < ?').all(limite);
        for (const { id } of velhos) {
          await unlink(this.caminho(id, true)).catch(() => {});
          this.db.prepare('UPDATE pedidos_admin SET mostrado = ? WHERE id = ?').run('expirado', id);
        }
        await this.aplicarUtilizadores();
      } catch (e) {
        if (e.code !== 'ENOENT') this.registo.erro(`pedidos-admin: ${e.message}`);
      } finally {
        this.aVerificar = null;
      }
    })();
    return this.aVerificar;
  }

  /** Aplica os pedidos "painel-utilizador" escritos pelo domus.sh. */
  async aplicarUtilizadores() {
    let nomes;
    try {
      nomes = (await readdir(this.dir)).filter((f) => /^u-\d{14}-[0-9a-f]{8}\.json$/.test(f)).sort();
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const nome of nomes) {
      const id = nome.slice(0, -5);
      const caminho = join(this.dir, nome);
      let r;
      try {
        const pedido = JSON.parse(await lerFicheiroSeguro(caminho, MAX_PEDIDO_U));
        r = await this.#aplicarUtilizador(id, pedido);
      } catch (e) {
        r = { id, tipo: 'painel-utilizador', ok: false, erro: e instanceof ErroPedido ? e.message : 'Pedido inválido.' };
      }
      await unlink(caminho).catch(() => {});    // tem a palavra-passe em claro: nunca fica
      r.concluido = iso(this.relogio());
      await escreverAtomico(this.caminho(id, true), `${JSON.stringify(r)}\n`, 0o600);
      this.registo.info(`painel-utilizador ${id}: ${r.ok ? 'aplicado' : `recusado (${r.erro})`}`);
    }
  }

  async #aplicarUtilizador(id, p) {
    const chaves = ['id', 'tipo', 'dados', 'por', 'criado'];
    if (!p || typeof p !== 'object' || Object.keys(p).join() !== chaves.join()) throw new ErroPedido('Pedido inválido.');
    if (p.id !== id || p.tipo !== 'painel-utilizador' || p.por !== 'domus.sh') throw new ErroPedido('Pedido inválido.');
    const d = p.dados;
    if (!d || typeof d !== 'object' || Object.keys(d).sort().join() !== 'email,nome,papel,password') throw new ErroPedido('Pedido inválido.');
    if (typeof d.email !== 'string' || d.email.length > 254 || !RE_EMAIL.test(d.email)) throw new ErroPedido('Email inválido.');
    if (!PAPEIS.includes(d.papel)) throw new ErroPedido('Papel inválido (ceo, tecnico ou comercial).');
    const nome = typeof d.nome === 'string' && d.nome.trim() ? d.nome.trim().slice(0, 120) : d.email.split('@')[0];
    if (/[\u0000-\u001f\u007f]/.test(nome)) throw new ErroPedido('Nome inválido.');
    const prob = problemaSenha(d.password);
    if (prob) throw new ErroPedido(prob);
    const hash = await hashSenha(d.password);
    const agora = iso(this.relogio());
    const existe = this.db.prepare('SELECT id FROM utilizadores WHERE email = ?').get(d.email);
    let uid;
    if (existe) {
      this.db.prepare('UPDATE utilizadores SET papel = ?, hash = ?, ativo = 1, atualizado = ? WHERE id = ?').run(d.papel, hash, agora, existe.id);
      this.db.prepare('DELETE FROM sessoes WHERE utilizador_id = ?').run(existe.id);
      uid = existe.id;
    } else {
      uid = Number(this.db.prepare('INSERT INTO utilizadores (nome, email, papel, hash, ativo, criado, atualizado) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(nome, d.email.toLowerCase(), d.papel, hash, agora, agora).lastInsertRowid);
    }
    this.db.prepare('DELETE FROM falhas_login WHERE email = ?').run(d.email);
    this.auditar({ id: null, email: 'domus.sh' }, existe ? 'utilizador_atualizado' : 'utilizador_criado', `utilizador:${uid}`,
      { email: d.email.toLowerCase(), papel: d.papel, origem: 'domus.sh painel-utilizador' });
    return { id, tipo: 'painel-utilizador', ok: true, email: d.email.toLowerCase(), papel: d.papel, novo: !existe };
  }

  iniciar() {
    const correr = () => this.verificar().catch(() => {});
    correr();
    this.temporizador = setInterval(correr, this.config.pedidosPollMs);
    this.temporizador.unref();
  }

  async parar() {
    clearInterval(this.temporizador);
    if (this.aVerificar) await this.aVerificar.catch(() => {});
  }
}

class ErroPedido extends Error {}

export function formatarPedido(p) {
  if (!p) return null;
  let dados = {};
  try { dados = JSON.parse(p.dados); } catch { /* ignorado */ }
  return {
    id: p.id, tipo: p.tipo, cliente: p.cliente, dados, por: p.por_email, criado: p.criado,
    estado: p.estado, concluido: p.concluido, erro: p.erro,
    resultado_disponivel: p.estado !== 'pendente' && !p.mostrado,
    mostrado: p.mostrado, orcamento_id: p.orcamento_id,
  };
}
