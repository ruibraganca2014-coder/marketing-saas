// Dashboard do negócio (Início do painel; docs/DASHBOARD.md): os indicadores de um período, comparados com o período
// anterior equivalente. Tudo calculado AQUI (o ecrã só mostra), em cêntimos, e cortado por papel: os valores em euros
// (receita, margem, por receber) e os indicadores de "agora" (stock, obras por agendar, avaliação) só vão para o CEO; o
// comercial recebe os pedidos recebidos, a taxa de aceitação e a origem dos contactos, sem valores.
//
// Períodos em hora de Lisboa; semanas de segunda a domingo. As datas guardadas são instantes ISO em UTC: cada período é
// o intervalo [meia-noite de Lisboa do primeiro dia, meia-noite de Lisboa do dia a seguir ao último).

import { iso, diaLisboa, semanaLisboa, somarDiasCivil, meiaNoiteLisboa, deCent, paraCent } from './util.js';
import { partirIva, IVA_OMISSAO } from './pagamentos-pedido.js';

export const PERIODOS = ['semana', 'mes', 'mes_passado', 'ano'];
const SEMANAS_SERIE = 8;
const MAIS_ANTIGOS = 5;
const ARTIGOS_SEM_CUSTO = 10;

const primeiroDoMes = (dia) => `${dia.slice(0, 7)}-01`;
const ultimoDoMes = (dia) => somarDiasCivil(primeiroDoMes(somarDiasCivil(primeiroDoMes(dia), 32)), -1);
const menor = (a, b) => (a < b ? a : b);

/**
 * O período pedido e o anterior equivalente (dias civis de Lisboa, os dois extremos incluídos). Um período a decorrer
 * (esta semana, este mês, este ano) compara-se com a MESMA parte do período anterior — do primeiro dia até ao dia
 * equivalente a hoje (dia 14 → dias 1 a 14 do mês anterior; quarta → segunda a quarta da semana anterior) —, senão a
 * comparação saía sempre a descer no início do período. "Mês passado" compara-se com o mês inteiro antes dele.
 */
export function periodoNegocio(chave, agora = new Date()) {
  const hoje = diaLisboa(agora);
  if (chave === 'semana') {
    const { inicio, fim } = semanaLisboa(agora);
    return { chave, inicio, fim, hoje, completo: false, anterior: { inicio: somarDiasCivil(inicio, -7), fim: somarDiasCivil(hoje, -7) } };
  }
  if (chave === 'ano') {
    const ano = Number(hoje.slice(0, 4));
    // 29 de fevereiro: no ano anterior vai até 28.
    const equivalente = `${ano - 1}${hoje.slice(4) === '-02-29' ? '-02-28' : hoje.slice(4)}`;
    return { chave, inicio: `${ano}-01-01`, fim: `${ano}-12-31`, hoje, completo: false, anterior: { inicio: `${ano - 1}-01-01`, fim: equivalente } };
  }
  const inicio = primeiroDoMes(hoje);
  const antes = primeiroDoMes(somarDiasCivil(inicio, -1));
  if (chave === 'mes_passado') {
    const antesDisso = primeiroDoMes(somarDiasCivil(antes, -1));
    return { chave, inicio: antes, fim: ultimoDoMes(antes), hoje, completo: true, anterior: { inicio: antesDisso, fim: ultimoDoMes(antesDisso) } };
  }
  // Este mês: dia 31 num mês anterior de 30 (ou 28) dias compara-se com o mês anterior inteiro.
  return { chave: 'mes', inicio, fim: ultimoDoMes(inicio), hoje, completo: false,
    anterior: { inicio: antes, fim: menor(`${antes.slice(0, 7)}${hoje.slice(7)}`, ultimoDoMes(antes)) } };
}

/**
 * Limites de um intervalo de dias de Lisboa para comparar com as datas ISO guardadas: sem o "Z" do fim, para valerem
 * também para datas com milissegundos ("…T23:00:00" ≤ "…T23:00:00.123Z" e ≤ "…T23:00:00Z").
 */
const limites = ({ inicio, fim }) => ({ de: iso(meiaNoiteLisboa(inicio)).slice(0, 19), ate: iso(meiaNoiteLisboa(somarDiasCivil(fim, 1))).slice(0, 19) });
const dentro = (quando, l) => typeof quando === 'string' && quando >= l.de && quando < l.ate;

/** Diferença para o período anterior: {dif, pct}; `pct` (inteiro) é null quando o anterior é 0 (não há percentagem). */
const variacao = (atual, anterior) => ({ dif: atual - anterior, pct: anterior ? Math.round(((atual - anterior) / Math.abs(anterior)) * 100) : null });
const variacaoEuros = (atual, anterior) => ({ dif: deCent(atual - anterior), pct: variacao(atual, anterior).pct });
const taxa = (aceites, enviadas) => (enviadas ? Math.round((aceites / enviadas) * 100) : null);

/**
 * Dependências: `stock` (stock.js: material de um pedido e artigos abaixo do mínimo), `pagamentos()` (pagamentos-pedido.js:
 * o que cada cliente tem em falta) e `dados` (dados.js: o CSV das mensalidades dos planos).
 */
export function criarNegocio({ db, config, relogio, stock, pagamentos, dados }) {
  // ------------------------------------------------------------ pedidos, aceitação e origem (CEO e comercial)
  /** Pedidos recebidos em cada intervalo, pela data de criação. Contam todos os que existem (também os arquivados pelo RGPD). */
  function pedidosRecebidos(atual, anterior) {
    return db.prepare(`SELECT COALESCE(SUM(criado >= ? AND criado < ?), 0) AS atual, COALESCE(SUM(criado >= ? AND criado < ?), 0) AS anterior
      FROM orcamentos WHERE criado >= ?`).get(atual.de, atual.ate, anterior.de, anterior.ate, menor(atual.de, anterior.de));
  }

  /** Pedidos recebidos por semana (segunda a domingo), nas últimas 8 semanas com a atual: [{inicio, fim, n}]. Não depende do período. */
  function pedidosPorSemana(agora) {
    const { inicio } = semanaLisboa(agora);
    const semanas = Array.from({ length: SEMANAS_SERIE }, (_, i) => {
      const de = somarDiasCivil(inicio, -7 * (SEMANAS_SERIE - 1 - i));
      return { inicio: de, fim: somarDiasCivil(de, 6), n: 0 };
    });
    const lims = semanas.map(limites);
    for (const { criado } of db.prepare('SELECT criado FROM orcamentos WHERE criado >= ?').all(lims[0].de)) {
      const i = lims.findIndex((l) => dentro(criado, l));
      if (i >= 0) semanas[i].n += 1;
    }
    return semanas;
  }

  /**
   * Taxa de aceitação: das propostas ENVIADAS no intervalo (a primeira vez que o pedido passou a "proposta enviada",
   * pela auditoria), quantas estão hoje "aceite" (sinal pago, ou aceite à mão) — seja qual for o dia em que foram
   * aceites. Um pedido posto em "aceite" sem nunca ter passado por "proposta enviada" não entra; um pedido arquivado
   * pelo RGPD também não (o histórico dele sai da auditoria).
   */
  function aceitacao(atual, anterior) {
    const r = db.prepare(`SELECT COALESCE(SUM(e.q >= ? AND e.q < ?), 0) AS enviadas, COALESCE(SUM(e.q >= ? AND e.q < ? AND o.estado = 'aceite'), 0) AS aceites,
        COALESCE(SUM(e.q >= ? AND e.q < ?), 0) AS enviadas_antes, COALESCE(SUM(e.q >= ? AND e.q < ? AND o.estado = 'aceite'), 0) AS aceites_antes
      FROM (SELECT alvo, MIN(quando) AS q FROM auditoria WHERE acao = 'orcamento_atualizado' AND json_valid(detalhes)
        AND json_extract(detalhes, '$.estado') = 'proposta_enviada' GROUP BY alvo HAVING q >= ? AND q < ?) e
      JOIN orcamentos o ON o.id = CAST(substr(e.alvo, 11) AS INTEGER)`).get(atual.de, atual.ate, atual.de, atual.ate, anterior.de, anterior.ate, anterior.de, anterior.ate,
      menor(atual.de, anterior.de), atual.ate > anterior.ate ? atual.ate : anterior.ate);
    const t = taxa(r.aceites, r.enviadas);
    const antes = taxa(r.aceites_antes, r.enviadas_antes);
    return {
      enviadas: r.enviadas, aceites: r.aceites, taxa: t,
      anterior: { enviadas: r.enviadas_antes, aceites: r.aceites_antes, taxa: antes },
      // Diferença em pontos percentuais; null quando um dos períodos não tem propostas enviadas.
      variacao_pontos: t === null || antes === null ? null : t - antes,
    };
  }

  /** Origem dos contactos: os pedidos recebidos no intervalo por origem (null = sem origem registada) e quantos estão hoje "aceite". */
  function origens(l) {
    return db.prepare(`SELECT origem_contacto AS origem, COUNT(*) AS pedidos, COALESCE(SUM(estado = 'aceite'), 0) AS aceites
      FROM orcamentos WHERE criado >= ? AND criado < ? GROUP BY origem_contacto ORDER BY pedidos DESC, origem_contacto`).all(l.de, l.ate);
  }

  // ------------------------------------------------------------ receita e margem (só CEO)
  /**
   * Dinheiro recebido em cada intervalo (cêntimos): os pagamentos dos pedidos pela data em que foram pagos, menos as
   * devoluções pela data em que foram feitas (uma devolução por transferência ainda por fazer não desconta), mais as
   * mensalidades dos planos (CSV dos pagamentos, pelo dia da linha). Sem IVA: cada pagamento pela sua taxa.
   */
  async function receita(periodos) {
    const lims = periodos.map(limites);
    const r = periodos.map(() => ({ sem: 0, com: 0, pedidosSem: 0, planosSem: 0, pagamentos: 0, devolvido: 0, simulados: 0 }));
    const de = lims.reduce((m, l) => menor(m, l.de), lims[0].de);
    const linhas = db.prepare(`SELECT valor_cent, iva_pct, pago, devolvido, devolvido_cent, modo FROM pagamentos_pedido
      WHERE estado IN ('pago', 'devolvido') AND (pago >= ? OR devolvido >= ?)`).all(de, de);
    for (const p of linhas) {
      const iva = Number.isFinite(p.iva_pct) ? p.iva_pct : IVA_OMISSAO;
      lims.forEach((l, i) => {
        if (dentro(p.pago, l)) {
          const base = partirIva(p.valor_cent, iva).base;
          r[i].com += p.valor_cent; r[i].sem += base; r[i].pedidosSem += base; r[i].pagamentos += 1;
          if (p.modo === 'simulado') r[i].simulados += 1;
        }
        if (p.devolvido_cent && dentro(p.devolvido, l)) {
          const base = partirIva(p.devolvido_cent, iva).base;
          r[i].com -= p.devolvido_cent; r[i].sem -= base; r[i].pedidosSem -= base; r[i].devolvido += p.devolvido_cent;
        }
      });
    }
    for (const linha of await dados.pagamentos()) {
      const dia = String(linha.data).slice(0, 10);
      periodos.forEach((p, i) => {
        if (dia < p.inicio || dia > p.fim) return;
        const sem = paraCent(linha.valor_sem_iva);
        r[i].com += paraCent(linha.valor_com_iva); r[i].sem += sem; r[i].planosSem += sem; r[i].pagamentos += 1;
      });
    }
    return r;
  }

  /**
   * Custo de compra do material das obras dadas por concluídas no intervalo (`orcamentos.obra_concluida`): os artigos da
   * simulação de cada pedido × o custo de compra de HOJE no catálogo. Um artigo com preço de venda e sem custo de compra
   * conta 0 (a margem fica acima do real): vai em `semCusto` (SKU → artigo). `semLista`: obras sem simulação (pedidos do
   * formulário, criados no painel ou arquivados pelo RGPD), de que não se sabe o material.
   */
  function custoMaterial(l) {
    let cent = 0;
    let semLista = 0;
    const semCusto = new Map();
    const obras = db.prepare('SELECT id, simulacao FROM orcamentos WHERE obra_concluida >= ? AND obra_concluida < ?').all(l.de, l.ate);
    for (const o of obras) {
      if (!o.simulacao) { semLista += 1; continue; }
      for (const { artigo: a, qtd } of stock.materialDoPedido(o)) {
        if (a.preco_compra_cent === null || a.preco_compra_cent === undefined) { if (a.preco_venda_iva_cent > 0) semCusto.set(a.sku, a); continue; }
        cent += a.preco_compra_cent * qtd;
      }
    }
    return { cent, obras: obras.length, semLista, semCusto };
  }

  /**
   * Eletricistas externos (só com o módulo ligado; sem ele 0): o valor fixado ao aprovar cada trabalho, pela data da
   * aprovação (já pago ou ainda por pagar), e a ida sem defeito pela data da decisão. Sem IVA.
   */
  function custoEletricistas(l) {
    if (!config.eletricistas) return 0;
    return db.prepare(`SELECT COALESCE(SUM(CASE WHEN aprovada >= ? AND aprovada < ? THEN valor_cent ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN regresso_desde >= ? AND regresso_desde < ? THEN COALESCE(regresso_cent, 0) ELSE 0 END), 0) AS cent
      FROM trabalhos_eletricista WHERE estado IN ('aprovada', 'paga') AND valor_cent IS NOT NULL`).get(l.de, l.ate, l.de, l.ate).cent;
  }

  // ------------------------------------------------------------ agora (só CEO; não dependem do período)
  /**
   * Por receber: o que os clientes já foram chamados a pagar e ainda não pagaram — o sinal de uma proposta aceite online
   * e o restante de uma obra dada por concluída (a mesma regra dos lembretes de pagamento em falta: `emFalta`). Com IVA,
   * que é o que o cliente paga. Só os pedidos com conta de cliente e com os pagamentos online ligados.
   */
  function porReceber() {
    if (!config.pagamentoPedido) return { online: false, total: 0, n: 0, lista: [] };
    const candidatos = db.prepare(`SELECT * FROM orcamentos o WHERE conta_id IS NOT NULL
      AND ((estado = 'proposta_enviada' AND proposta_aceite IS NOT NULL) OR (estado = 'aceite' AND obra_concluida IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM pagamentos_pedido p WHERE p.orcamento_id = o.id AND p.estado = 'pago'
        AND p.fase = CASE WHEN o.estado = 'aceite' THEN 'restante' ELSE 'sinal' END)`).all();
    const emFalta = candidatos.map((o) => ({ o, f: pagamentos().emFalta(o) })).filter((x) => x.f)
      .sort((a, b) => String(a.f.desde).localeCompare(String(b.f.desde)) || a.o.id - b.o.id);
    return {
      online: true, total: deCent(emFalta.reduce((s, x) => s + x.f.cent, 0)), n: emFalta.length,
      lista: emFalta.slice(0, MAIS_ANTIGOS).map(({ o, f }) => ({ id: o.id, nome: o.nome, fase: f.fase, valor: deCent(f.cent), desde: f.desde })),
    };
  }

  /**
   * Avaliação média dos clientes: uma avaliação por pedido — a da confirmação do trabalho de um eletricista externo (a
   * mais recente do pedido) e, só quando o pedido não tem nenhuma dessas, a que o cliente deu na conta. Todas as que existem.
   */
  function avaliacao() {
    const r = db.prepare(`SELECT COUNT(*) AS n, AVG(e) AS media FROM (
      SELECT t.estrelas AS e FROM trabalhos_eletricista t WHERE t.estrelas IS NOT NULL
        AND t.id = (SELECT MAX(x.id) FROM trabalhos_eletricista x WHERE x.orcamento_id = t.orcamento_id AND x.estrelas IS NOT NULL)
      UNION ALL
      SELECT o.avaliacao_estrelas FROM orcamentos o WHERE o.avaliacao_estrelas IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM trabalhos_eletricista x WHERE x.orcamento_id = o.id AND x.estrelas IS NOT NULL))`).get();
    return { n: r.n, media: r.n ? Math.round(r.media * 10) / 10 : null };
  }

  const obrasPorAgendar = () => db.prepare("SELECT COUNT(*) AS n FROM obras WHERE por_agendar = 1 AND estado IN ('agendada', 'em_curso')").get().n;

  // ------------------------------------------------------------ resumo
  /** O dashboard de um período para o utilizador `u` (ceo ou comercial): o comercial não recebe nenhum valor em euros. */
  async function resumo(u, chave) {
    const agora = new Date(relogio());
    const periodo = periodoNegocio(chave, agora);
    const atual = limites(periodo);
    const anterior = limites(periodo.anterior);
    const n = pedidosRecebidos(atual, anterior);
    const r = {
      papel: u.papel, periodo, periodos: PERIODOS,
      pedidos: { n: n.atual, anterior: n.anterior, variacao: variacao(n.atual, n.anterior), semanas: pedidosPorSemana(agora) },
      aceitacao: aceitacao(atual, anterior),
      origens: origens(atual),
    };
    if (u.papel !== 'ceo') return r;

    const [rec, recAntes] = await receita([periodo, periodo.anterior]);
    r.receita = {
      sem_iva: deCent(rec.sem), com_iva: deCent(rec.com), pagamentos: rec.pagamentos, devolvido: deCent(rec.devolvido),
      pedidos_sem_iva: deCent(rec.pedidosSem), planos_sem_iva: deCent(rec.planosSem), simulados: rec.simulados,
      anterior: { sem_iva: deCent(recAntes.sem), com_iva: deCent(recAntes.com) }, variacao: variacaoEuros(rec.sem, recAntes.sem),
    };
    const mat = custoMaterial(atual);
    const eletr = custoEletricistas(atual);
    const margem = rec.sem - mat.cent - eletr;
    const margemAntes = recAntes.sem - custoMaterial(anterior).cent - custoEletricistas(anterior);
    r.margem = {
      valor: deCent(margem), material: deCent(mat.cent), eletricistas: deCent(eletr), obras: mat.obras, obras_sem_lista: mat.semLista,
      // Artigos usados nas obras do período sem custo de compra (a margem fica acima do real): quantos e os primeiros.
      sem_custo: { artigos: mat.semCusto.size, lista: [...mat.semCusto.values()].slice(0, ARTIGOS_SEM_CUSTO).map((a) => ({ id: a.id, sku: a.sku, nome: a.nome })) },
      anterior: { valor: deCent(margemAntes) }, variacao: variacaoEuros(margem, margemAntes),
    };
    r.por_receber = porReceber();
    r.stock_abaixo_minimo = stock.abaixoDoMinimo();
    r.obras_por_agendar = obrasPorAgendar();
    r.avaliacao = avaliacao();
    return r;
  }

  return { resumo };
}
