// Área de cliente — pré-visualização (decisão do dono, 2026-10-03; docs/CONTA-CLIENTE.md "Pré-visualização"): uma conta
// com sessão mas ainda SEM casa ligada entra na mesma e vê a casa "antes da instalação" — a planta que desenhou no
// simulador, as divisões com o que disse que a casa tem, o andamento do pedido e os botões para o sítio certo. Só de
// leitura: sem aparelhos, sem MQTT, nada que finja que há aparelhos. Aqui só a lógica (sem DOM; testes em
// painel/test/previsao.test.js): de onde vem a planta, o texto de cada divisão e que botões aparecem.

/** A planta tem divisões? (uma planta só com aparelhos soltos ou vazia não conta) */
export const temPlanta = (p) => Array.isArray(p?.divisoes) && p.divisoes.length > 0;

/**
 * As plantas que a conta tem, pela ordem em que se oferecem (a 1.ª é a que se mostra):
 * - o rascunho — a simulação guardada na conta e ainda por enviar (`rascunho` = {planta, atualizado}) — primeiro: a
 *   cópia da conta é apagada quando o pedido é enviado, por isso um rascunho com planta é sempre mais recente do que o
 *   último pedido (é o que o cliente está a fazer agora);
 * - depois os pedidos enviados que têm planta (`tem_planta`), do mais recente para o mais antigo (a ordem de GET pedidos).
 * [{chave: "rascunho" | "pedido:<id>", pedido: id | null, texto}]
 */
export function fontesDePlanta(pedidos = [], rascunho = null, dataTxt = (d) => d) {
  const r = [];
  if (temPlanta(rascunho?.planta)) r.push({ chave: "rascunho", pedido: null, texto: `Simulação por enviar${rascunho.atualizado ? ` (${dataTxt(rascunho.atualizado)})` : ""}` });
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (p?.tem_planta) r.push({ chave: `pedido:${p.id}`, pedido: p.id, texto: `Pedido n.º ${p.id}${p.criado ? ` (${dataTxt(p.criado)})` : ""}` });
  }
  return r;
}

/** O pedido cujo andamento se mostra: o da planta escolhida; com o rascunho (ou sem planta), o mais recente. null sem pedidos. */
export function pedidoDoAndamento(pedidos = [], fonte = null) {
  const l = Array.isArray(pedidos) ? pedidos : [];
  return (fonte?.pedido != null ? l.find((p) => p.id === fonte.pedido) : null) ?? l[0] ?? null;
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
/**
 * O que o cliente disse que a divisão tem (o inventário do passo "Divisões": {interruptores: [botões…] | null, tomadas:
 * [1 simples | 2 dupla | 3 tripla…] | null}): "2 interruptores (1 e 2 botões) · 3 tomadas (2 simples, 1 dupla)";
 * lista vazia = "sem interruptores" / "sem tomadas"; null (sem resposta nenhuma) quando não há inventário.
 */
export function textoInventario(i) {
  const ints = Array.isArray(i?.interruptores) ? i.interruptores : null;
  const toms = Array.isArray(i?.tomadas) ? i.tomadas : null;
  if (!ints && !toms) return null;
  const partes = [];
  if (ints) {
    const b = [...new Set(ints)].sort((x, y) => x - y);
    partes.push(ints.length ? `${plural(ints.length, "interruptor", "interruptores")} (${b.join(" e ")} ${b.length === 1 && b[0] === 1 ? "botão" : "botões"})` : "sem interruptores");
  }
  if (toms) {
    const tipos = [[1, "simples", "simples"], [2, "dupla", "duplas"], [3, "tripla", "triplas"]]
      .map(([c, um, varios]) => { const n = toms.filter((x) => x === c).length; return n ? `${n} ${n === 1 ? um : varios}` : null; }).filter(Boolean);
    partes.push(toms.length ? `${plural(toms.length, "tomada", "tomadas")} (${tipos.join(", ")})` : "sem tomadas");
  }
  return partes.join(" · ");
}

/** Tipos de aparelho da planta que entram no resumo de uma divisão (a porta é só desenho): [tipo, singular, plural]. */
const TIPOS_NA_PLANTA = [["interruptor", "interruptor", "interruptores"], ["tomada", "tomada", "tomadas"], ["luz", "ponto de luz", "pontos de luz"],
  ["janela", "janela", "janelas"], ["sensor_movimento", "sensor de movimento", "sensores de movimento"],
  ["sensor_porta", "sensor de porta ou janela", "sensores de porta ou janela"], ["maquina", "máquina ou aparelho", "máquinas e aparelhos"],
  ["quadro", "quadro elétrico", "quadros elétricos"]];
/**
 * O que está desenhado na planta numa divisão (decisão do dono, 2026-10-04: os pedidos de antes do inventário do passo
 * "Divisões" não trazem as respostas, e a lista tem de bater com o desenho): "1 interruptor · 3 tomadas · 2 máquinas e
 * aparelhos"; null sem nada desenhado.
 */
export function textoDaPlanta(planta, divisaoId) {
  const els = (Array.isArray(planta?.elementos) ? planta.elementos : []).filter((e) => e?.divisao === divisaoId);
  const partes = TIPOS_NA_PLANTA.map(([tipo, um, varios]) => {
    const doTipo = els.filter((e) => e.tipo === tipo);
    if (!doTipo.length) return null;
    // As máquinas pelo nome (o servidor manda-o: "Forno", "Placa de cozinha"), quando todas o têm e são poucas.
    const nomes = tipo === "maquina" ? doTipo.map((e) => (typeof e.nome === "string" ? e.nome.trim().toLowerCase() : "")) : [];
    if (nomes.length && nomes.length <= 6 && nomes.every(Boolean)) return [...new Set(nomes)].join(", ");
    return plural(doTipo.length, um, varios);
  }).filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * As divisões da planta, por piso e pela ordem da planta, com o que o cliente disse de cada uma:
 * [{id, nome, piso, texto}] — `texto` = textoInventario; sem resposta, o que está desenhado na planta (textoDaPlanta);
 * sem nada desenhado, "Sem aparelhos desenhados.".
 */
export function divisoesDaPrevisao(planta, inventario = null) {
  if (!temPlanta(planta)) return [];
  const piso = (d) => { const n = Math.round(Number(d?.piso)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const inv = new Map((Array.isArray(inventario) ? inventario : []).map((x) => [x?.divisao, x]));
  return [...planta.divisoes].sort((a, b) => piso(a) - piso(b)).map((d) => ({
    id: d.id, nome: String(d.nome ?? "").trim() || "Divisão", piso: piso(d),
    texto: textoInventario(inv.get(d.id)) ?? textoDaPlanta(planta, d.id) ?? "Sem aparelhos desenhados.",
  }));
}

/**
 * Os botões da pré-visualização (só levam ao sítio certo: a compra e o relatório ficam em "A minha conta"):
 * - sem planta nenhuma: "Simular orçamento" (ou "Continuar a simulação", se há um rascunho começado sem planta);
 * - com um rascunho por enviar: "Continuar a simulação";
 * - com um pedido: "Ver o pedido e o relatório" e, quando a visita técnica ainda se pode comprar (compras ligadas, por
 *   pagar, dentro da área, sem data marcada nem obra), "Pedir visita".
 * [{chave, texto, href, principal}]
 */
export function botoesDaPrevisao({ temPlanta: comPlanta = false, temRascunho = false, pedido = null } = {}) {
  const r = [];
  if (temRascunho) r.push({ chave: "continuar", texto: "Continuar a simulação", href: "simulador.html" });
  else if (!comPlanta) r.push({ chave: "simular", texto: "Simular orçamento", href: "simulador.html" });
  if (pedido) {
    const href = `conta.html#pedido-${pedido.id}`;
    r.push({ chave: "pedido", texto: "Ver o pedido e o relatório", href });
    const cp = pedido.compras;
    const v = cp?.visita;
    if (cp?.pode && cp.ativas && v && !v.paga && !v.fora_area && !v.sem_concelho && v.valor != null && !pedido.data_visita && !pedido.obra) {
      r.push({ chave: "visita", texto: "Pedir visita", href });
    }
  }
  return r.map((b, i) => ({ ...b, principal: i === 0 }));
}
