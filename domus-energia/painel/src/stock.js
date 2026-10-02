// Stock simples (migração 22; decisão 13 do dono; docs/PAINEL-EMPRESA.md "Stock"). Por artigo do catálogo: a quantidade
// em armazém (`stock_qtd`), a reservada para obras aceites (`stock_reservado`) e o mínimo (`stock_minimo`); cada
// alteração fica em `stock_movimentos` (entrada, reserva, libertação, saída, acerto). Só o CEO o vê; nada disto sai
// para o cliente (o /api/catalogo escolhe as colunas à mão).
//
// Um artigo tem "stock gerido" quando tem um mínimo ou pelo menos um movimento (uma entrada, um acerto): só esses são
// reservados e descontados pelas obras. Os diagnósticos, os pontos de preço fechado e os artigos que nunca entraram em
// armazém ficam de fora (senão apareciam com stock negativo).
//
// Obra: sinal pago (ou pedido aceite) → `reservar`; obra concluída → `saida`; pedido que deixa de estar aceite ou obra
// cancelada → `libertar`. As três são idempotentes. O material de um pedido são os `itens` da simulação (SKU e
// quantidade). Tudo síncrono (node:sqlite): pode correr dentro da transação de quem chama.

import { ErroApi } from './http.js';
import { iso, deCent } from './util.js';

const RE_SKU = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

export function criarStock({ db, relogio }) {
  const agora = () => iso(relogio());
  const insMov = db.prepare('INSERT INTO stock_movimentos (artigo_id, qtd, motivo, orcamento_id, por, nota, quando) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const porSku = db.prepare('SELECT * FROM catalogo WHERE sku = ?');
  const temMovimentos = db.prepare('SELECT 1 FROM stock_movimentos WHERE artigo_id = ? LIMIT 1');
  const gerido = (a) => a.stock_minimo > 0 || Boolean(temMovimentos.get(a.id));

  /** Material de um pedido: [{artigo (linha do catálogo), qtd}] pelos `itens` da simulação (SKUs repetidos somados). */
  function materialDoPedido(o) {
    let sim = null;
    try { sim = JSON.parse(o?.simulacao ?? 'null'); } catch { sim = null; }
    const qtds = new Map();
    for (const i of Array.isArray(sim?.itens) ? sim.itens.slice(0, 500) : []) {
      if (!i || typeof i.sku !== 'string' || !RE_SKU.test(i.sku)) continue;
      const q = Number.isFinite(i.qtd) && i.qtd > 0 ? Math.min(Math.round(i.qtd), 10_000) : 0;
      if (q) qtds.set(i.sku, (qtds.get(i.sku) ?? 0) + q);
    }
    const out = [];
    for (const [sku, qtd] of qtds) {
      const artigo = porSku.get(sku);
      if (artigo) out.push({ artigo, qtd });
    }
    return out;
  }

  /**
   * Custo de compra do material de um pedido (cêntimos): soma de quantidade × `preco_compra_cent`. `completo` = todos os
   * artigos com preço de venda têm custo conhecido (um artigo sem custo e com venda 0, como a troca de uma máquina, não
   * é material). null sem itens.
   */
  function custoMaterial(o) {
    const mat = materialDoPedido(o);
    if (!mat.length) return null;
    let cent = 0;
    let completo = true;
    for (const { artigo: a, qtd } of mat) {
      if (a.preco_compra_cent === null || a.preco_compra_cent === undefined) { if (a.preco_venda_iva_cent > 0) completo = false; continue; }
      cent += a.preco_compra_cent * qtd;
    }
    return { cent, completo };
  }

  /** Por artigo de um pedido: o que está reservado e ainda não saiu nem foi libertado, e se já houve saída. */
  const doPedido = (orcamentoId) => db.prepare(`SELECT artigo_id, SUM(CASE WHEN motivo IN ('reserva', 'libertacao') THEN qtd ELSE 0 END) AS aberto,
    SUM(motivo = 'saida') AS saidas FROM stock_movimentos WHERE orcamento_id = ? GROUP BY artigo_id`).all(orcamentoId);

  /** Reserva o material do pedido (uma vez: com reserva em aberto ou saída feita não faz nada). Devolve o n.º de artigos. */
  function reservar(o, por = 'sistema') {
    if (doPedido(o.id).some((x) => x.saidas > 0 || x.aberto > 0)) return 0;
    let n = 0;
    for (const { artigo: a, qtd } of materialDoPedido(o)) {
      if (!gerido(a)) continue;
      insMov.run(a.id, qtd, 'reserva', o.id, por, null, agora());
      db.prepare('UPDATE catalogo SET stock_reservado = stock_reservado + ? WHERE id = ?').run(qtd, a.id);
      n += 1;
    }
    return n;
  }

  /** Liberta o que o pedido tem reservado e ainda não saiu (pedido cancelado). Devolve o n.º de artigos. */
  function libertar(orcamentoId, por = 'sistema', nota = null) {
    let n = 0;
    for (const x of doPedido(orcamentoId)) {
      if (x.saidas > 0 || !(x.aberto > 0)) continue;
      insMov.run(x.artigo_id, -x.aberto, 'libertacao', orcamentoId, por, nota, agora());
      db.prepare('UPDATE catalogo SET stock_reservado = MAX(0, stock_reservado - ?) WHERE id = ?').run(x.aberto, x.artigo_id);
      n += 1;
    }
    return n;
  }

  /** Obra concluída: o material sai do armazém e a reserva fecha (uma vez). Devolve o n.º de artigos. */
  function saida(o, por = 'sistema') {
    const antes = new Map(doPedido(o.id).map((x) => [x.artigo_id, x]));
    if ([...antes.values()].some((x) => x.saidas > 0)) return 0;
    let n = 0;
    for (const { artigo: a, qtd } of materialDoPedido(o)) {
      const aberto = Math.max(0, antes.get(a.id)?.aberto ?? 0);
      if (!gerido(a) && !aberto) continue;
      insMov.run(a.id, -qtd, 'saida', o.id, por, null, agora());
      db.prepare('UPDATE catalogo SET stock_qtd = stock_qtd - ?, stock_reservado = MAX(0, stock_reservado - ?) WHERE id = ?').run(qtd, aberto, a.id);
      n += 1;
    }
    // Reservas de artigos que já não estão no pedido: libertadas.
    libertar(o.id, por, 'obra concluída');
    return n;
  }

  /** Entrada (qtd > 0) ou acerto (qtd ≠ 0, com sinal) feitos no painel. Devolve a linha do artigo atualizada. */
  function movimentar(artigoId, { qtd, motivo, nota = null }, por) {
    const a = db.prepare('SELECT * FROM catalogo WHERE id = ?').get(artigoId);
    if (!a) throw new ErroApi(404, 'Artigo não encontrado.');
    insMov.run(a.id, qtd, motivo, null, por, nota, agora());
    db.prepare('UPDATE catalogo SET stock_qtd = stock_qtd + ?, atualizado = ? WHERE id = ?').run(qtd, agora(), a.id);
    return db.prepare('SELECT * FROM catalogo WHERE id = ?').get(a.id);
  }

  /** Reserva do material de um pedido para o painel: {reservado, saiu, artigos: [{sku, nome, qtd, disponivel}]} (só os de stock gerido). */
  function resumoPedido(o) {
    const mov = new Map(doPedido(o.id).map((x) => [x.artigo_id, x]));
    const artigos = materialDoPedido(o).filter(({ artigo: a }) => gerido(a) || mov.has(a.id)).map(({ artigo: a, qtd }) => ({
      sku: a.sku, nome: a.nome, qtd, disponivel: a.stock_qtd - a.stock_reservado,
    }));
    const lista = [...mov.values()];
    return { reservado: lista.some((x) => x.saidas === 0 && x.aberto > 0), saiu: lista.some((x) => x.saidas > 0), artigos };
  }

  /** Ecrã Stock (CEO): os artigos (abaixo do mínimo primeiro) e os últimos movimentos. */
  function listar() {
    const itens = db.prepare('SELECT * FROM catalogo ORDER BY nome').all().map((a) => {
      const g = gerido(a);
      const disponivel = a.stock_qtd - a.stock_reservado;
      return {
        id: a.id, sku: a.sku, nome: a.nome, categoria: a.categoria, ativo: Boolean(a.ativo), gerido: g,
        stock_qtd: a.stock_qtd, stock_reservado: a.stock_reservado, disponivel, stock_minimo: a.stock_minimo,
        preco_compra: deCent(a.preco_compra_cent), abaixo: g && (disponivel < a.stock_minimo || disponivel < 0),
      };
    }).filter((a) => a.ativo || a.gerido);
    itens.sort((x, y) => Number(y.abaixo) - Number(x.abaixo) || Number(y.gerido) - Number(x.gerido) || x.nome.localeCompare(y.nome, 'pt'));
    const movimentos = db.prepare(`SELECT m.id, m.qtd, m.motivo, m.orcamento_id, m.por, m.nota, m.quando, c.sku, c.nome
      FROM stock_movimentos m JOIN catalogo c ON c.id = m.artigo_id ORDER BY m.id DESC LIMIT 200`).all();
    return { itens, movimentos };
  }

  return { materialDoPedido, custoMaterial, reservar, libertar, saida, movimentar, resumoPedido, listar, gerido };
}
