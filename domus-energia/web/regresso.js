// Cliente que regressa (decisões do dono, 2026-10-04; docs/SIMULADOR-ORCAMENTO.md §0): quem já desenhou a casa e enviou
// um pedido não volta a cair num Início em branco. Aqui só as regras (sem DOM; testes em painel/test/regresso.test.js),
// usadas pelo Início do simulador (simulador/app.js) e pelo botão da página inicial (site.js):
// - quando o cartão "Já tenho a planta" abre já escolhido;
// - que pedido conta como "em andamento" e qual se mostra;
// - o texto e o destino do botão do topo ("Descrever a minha casa").

/** A chave da casa guardada neste navegador — igual a simulador/estado.js CHAVE_CASA (a página inicial não carrega o simulador). */
export const CHAVE_CASA_GUARDADA = "domus.simulador.casa";

/** Há uma casa guardada neste navegador? (só se a chave existe; quem a lê a sério é o simulador: estado.js carregarCasa) */
export function temCasaGuardada(storage) {
  try { return !!storage?.getItem(CHAVE_CASA_GUARDADA); } catch { return false; }
}

/**
 * O cartão "Já tenho a planta — Continuar com a sua casa" abre já escolhido? Só numa simulação NOVA (nenhum caso
 * escolhido), com casa guardada (neste navegador ou na conta) e se o cliente não a recusou nesta página ("Começar de
 * novo": quer começar do zero, a casa fica só oferecida no cartão). Nunca por cima de uma escolha do cliente.
 */
export function preEscolherCasa({ funil = null, temCasa = false, recusou = false } = {}) {
  return !funil && !!temCasa && !recusou;
}

/**
 * O pedido em andamento que se mostra: o mais recente (a lista de GET /api/conta/pedidos vem do mais recente para o mais
 * antigo) com `em_andamento: true` — enviado e ainda não fechado, arquivado nem com a obra concluída (quem decide é o
 * servidor: painel/src/conta.js pedidoParaCliente). `quantos`: os que estão em andamento. null sem nenhum — também com
 * um painel antigo, que não manda o campo (fica tudo como antes: sem aviso).
 */
export function pedidoEmAndamento(pedidos) {
  const l = (Array.isArray(pedidos) ? pedidos : []).filter((p) => p?.em_andamento === true && Number.isInteger(p.id) && p.id > 0);
  return l.length ? { id: l[0].id, quantos: l.length } : null;
}

/** "Já tem o pedido n.º 12 em andamento." (com mais: "… (e mais 2 em andamento)") */
export function textoPedidoEmAndamento(p) {
  if (!p) return "";
  const mais = p.quantos - 1;
  return mais > 0 ? `Já tem o pedido n.º ${p.id} em andamento (e mais ${mais} em andamento).` : `Já tem o pedido n.º ${p.id} em andamento.`;
}

/** O endereço do pedido na conta (conta.js: cada cartão tem id="pedido-<id>"). */
export const urlDoPedido = (id) => `conta.html#pedido-${id}`;

/**
 * O botão do topo da página inicial: visitante novo (sem sessão nem casa guardada) → null (fica o que está escrito na
 * página: "Descrever a minha casa"); sessão aberta ou casa guardada neste navegador → "Continuar com a minha casa";
 * sessão com um pedido em andamento → "Ver o meu pedido", para a conta. `pedido`: o de pedidoEmAndamento (só com sessão).
 */
export function botaoInicio({ sessao = false, temCasa = false, pedido = null } = {}) {
  if (sessao && pedido) return { texto: "Ver o meu pedido", href: urlDoPedido(pedido.id) };
  if (sessao || temCasa) return { texto: "Continuar com a minha casa", href: "simulador.html" };
  return null;
}
