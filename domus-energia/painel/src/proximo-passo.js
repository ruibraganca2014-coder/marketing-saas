// Ficha do pedido (decisão do dono, 2026-10-14): o andamento e a caixa "Próximo passo" com o botão certo. Funções
// puras: recebem os factos de UM pedido (api.js factosDoPedido) e dizem as fases, o que falta fazer, a quem, e de quem
// se está à espera. As regras do que falta são as mesmas do ecrã "Hoje" (api.js h.hoje), com os mesmos `tipo`, para a
// linha do Hoje e a caixa da ficha dizerem sempre o mesmo (test/proximo-passo.test.js compara as duas).

/**
 * Por ordem de prioridade (a primeira que se aplica é o "Próximo passo"; as outras ficam em "Também por fazer").
 * `sec`: a secção da ficha onde se trata; `alvo`: o id do elemento a mostrar (o botão ou o formulário verdadeiro).
 */
const ORDEM = ['avaria_urgente', 'decidir_predio', 'validar', 'sem_tecnico', 'ida_perdida', 'extra', 'aprovar_trabalho', 'escolher_proposta', 'enviar_proposta',
  'proposta_aceite', 'pagar_eletricista', 'pedido_novo', 'mensagem', 'visita'];

/** Um trabalho de eletricista ainda por acabar: na bolsa, com ele (visita por marcar ou marcada), feito à espera do cliente ou por aprovar. */
const TRABALHO_ABERTO = ['na_bolsa', 'aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada'];

/** As fases que o painel mostra: as da conta do cliente (painel/src/conta.js `passos`), mais o pagamento no fim. */
export const FASES = {
  recebido: 'Pedido recebido', verificado: 'Pedido verificado', proposta: 'Proposta', aceite: 'Proposta aceite',
  obra: 'Visita e obra', pago: 'Pago', ligada: 'Casa ligada',
};

const obraConcluidaDe = (f) => f.obra?.estado === 'concluida' || (f.estado === 'aceite' && Boolean(f.obra_concluida));
const restantePagoDe = (f) => (f.pagamentos ?? []).some((p) => p.fase === 'restante' && p.estado === 'pago');
/** Obra parada por segurança ou cancelada com o sinal devolvido: as fases antes da obra aconteceram. */
const paradaDe = (f) => Boolean(f.obra_parada) || (f.estado === 'perdido' && Boolean(f.proposta_aceite));

/**
 * O que falta fazer neste pedido, com quem o faz: [{tipo, papeis, desde, …}]. As mesmas condições do h.hoje, pedido
 * a pedido (o CEO: validar, eletricistas; o comercial: a proposta depois da visita e a visita de hoje; os dois: pedido
 * novo, proposta aceite por marcar, mensagem do cliente).
 */
export function pendentesDoPedido(f) {
  const out = [];
  const juntar = (tipo, papeis, desde, extra = {}) => out.push({ tipo, papeis, desde: desde ?? null, ...extra });
  // Pedido perdido ou arquivado (decisão do dono, 2026-10-14): só o pagamento do trabalho que o eletricista já fez.
  if (f.estado === 'arquivado' || f.estado === 'perdido') {
    const aprovado = f.eletricistas && (f.trabalhos ?? []).find((x) => x.estado === 'aprovada');
    if (aprovado) juntar('pagar_eletricista', ['ceo'], aprovado.aprovada ?? aprovado.atualizado, { eletricista: aprovado.eletricista ?? null });
    return out;
  }
  // Para-raios ou coluna montante (decisão do dono, 2026-10-14): precisa de projeto e técnico responsável e não vai
  // sozinho para a bolsa (nem com a validação): o CEO decide, caso a caso, se a Domus o aceita. Até lá fica no topo.
  if (f.predio && !f.predio.decisao && ['novo', 'contactado', 'visita_marcada'].includes(f.estado) && !f.proposta_aceite) juntar('decidir_predio', ['ceo'], f.criado);
  const porValidar = f.validacao_ligada && f.validacao === 'por_validar' && !['aceite', 'perdido'].includes(f.estado);
  if (porValidar) {
    const nota = String(f.validacao_nota ?? '');
    juntar('validar', ['ceo'], f.validacao_em ?? f.criado, { motivo: /^O cliente diz que já corrigiu/.test(nota) ? 'corrigido' : /^Proposta não aceite/.test(nota) ? 'recusada' : null, em_falta: Boolean(f.validacao_em_falta) });
  }
  // Teste de 2026-10-14: o pedido devolvido ao cliente espera que ele o corrija, e o que está com os eletricistas (na bolsa
  // ou com um deles, que contacta o cliente e marca a visita) espera por eles — em nenhum dos dois a equipa o contacta.
  const comEletricista = f.eletricistas && (f.trabalhos ?? []).some((x) => TRABALHO_ABERTO.includes(x.estado));
  if (f.estado === 'novo' && f.validacao !== 'devolvido' && !comEletricista) juntar('pedido_novo', porValidar ? ['comercial'] : ['ceo', 'comercial'], f.criado);
  // Com a obra feita ou marcada e o restante por pagar, a casa ainda não se liga: fica no fim (o que se pode fazer já vem antes).
  // A obra com um eletricista e ainda não aprovada (teste de 2026-10-14): quem a marca e faz é ele, e o cliente confirma;
  // até lá não há nada da equipa (esperaDoPedido diz de quem se espera; o "Aprovar o trabalho" vem dos trabalhos).
  const obraComEletricista = f.eletricistas && TRABALHO_ABERTO.includes(f.trabalho_obra);
  if (f.estado === 'aceite' && f.proposta_aceite && !f.cliente && !obraComEletricista) juntar('proposta_aceite', ['ceo', 'comercial'], f.proposta_aceite, { depois: Boolean(f.obra) && !f.obra.por_agendar && f.ligar_pode === false });
  if (f.mensagem_cliente) juntar('mensagem', ['ceo', 'comercial'], f.mensagem_cliente);
  if (f.eletricistas) {
    const t = f.trabalhos ?? [];
    if (f.propostas_bolsa && f.n_propostas > 0 && t.some((x) => x.estado === 'na_bolsa')) juntar('escolher_proposta', ['ceo'], f.propostas_desde);
    // Avaria urgente, fora de horas (decisão do dono, 2026-10-14): foi logo para a bolsa; o CEO acompanha até alguém a aceitar.
    const urgenteNaBolsa = f.urgente && t.find((x) => x.tipo === 'avaria' && x.estado === 'na_bolsa');
    if (urgenteNaBolsa) juntar('avaria_urgente', ['ceo'], urgenteNaBolsa.atualizado);
    const comProposta = t.find((x) => x.proposta && x.estado !== 'retirado');
    if (comProposta && ['novo', 'contactado', 'visita_marcada'].includes(f.estado)) juntar('enviar_proposta', ['ceo'], comProposta.atualizado);
    const confirmado = t.find((x) => x.estado === 'confirmada');
    if (confirmado) juntar('aprovar_trabalho', ['ceo'], confirmado.confirmada ?? confirmado.atualizado);
    const aprovado = t.find((x) => x.estado === 'aprovada');
    if (aprovado) juntar('pagar_eletricista', ['ceo'], aprovado.aprovada ?? aprovado.atualizado, { eletricista: aprovado.eletricista ?? null });
    if (f.extra_proposto) juntar('extra', ['ceo'], f.extra_proposto);
    if (f.ida_proposta) juntar('ida_perdida', ['ceo'], f.ida_proposta);
    if (f.sem_tecnico) juntar('sem_tecnico', ['ceo'], f.sem_tecnico);
  }
  // Comercial: a visita já foi e a proposta ainda não seguiu; ou a visita é hoje, mais logo (hora de Lisboa).
  if (f.estado === 'visita_marcada' && f.data_visita && f.agora_lx) {
    if (f.data_visita < f.agora_lx) juntar('enviar_proposta', ['comercial'], f.data_visita);
    else if (String(f.data_visita).slice(0, 10) === f.agora_lx.slice(0, 10)) juntar('visita', ['comercial'], f.data_visita, { hora: String(f.data_visita).slice(11, 16) || null });
  }
  return out.sort((a, b) => Number(Boolean(a.depois)) - Number(Boolean(b.depois)) || ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));
}

/** As fases do pedido: [{chave, texto, feito, atual}]; a atual é a primeira por fazer (nenhuma num pedido perdido ou arquivado). */
export function andamentoDoPedido(f) {
  const parada = paradaDe(f);
  const obra = Boolean(f.obra) && f.obra.estado !== 'cancelada';
  const depois = ['proposta_enviada', 'aceite'].includes(f.estado) || obra;
  const temProposta = (f.valor_proposta != null && depois) || f.estado === 'aceite';
  const concluida = obraConcluidaDe(f);
  const fases = [
    { chave: 'recebido', feito: true },
    ...(f.validacao_ligada ? [{ chave: 'verificado', feito: f.validacao === 'validado' || depois || parada }] : []),
    { chave: 'proposta', feito: temProposta || parada },
    { chave: 'aceite', feito: f.estado === 'aceite' || obra || parada },
    { chave: 'obra', feito: concluida },
    // Pago: o restante pago; sem pagamentos online (pedido antigo ou registado no painel), basta a obra concluída.
    { chave: 'pago', feito: restantePagoDe(f) || (concluida && !(f.pagamentos ?? []).length) },
    // Casa ligada (2026-10-14): enquanto falta "Ligar casa" a última fase não fica com ✓.
    { chave: 'ligada', feito: Boolean(f.cliente) },
  ].map((x) => ({ ...x, texto: FASES[x.chave] }));
  const fim = ['perdido', 'arquivado'].includes(f.estado);
  const atual = fim ? null : fases.find((x) => !x.feito);
  return fases.map((x) => ({ ...x, atual: x === atual }));
}

/** Sem nada por fazer: de quem se está à espera, numa frase; null se o pedido está fechado ou não há de quem esperar. */
export function esperaDoPedido(f) {
  if (f.estado === 'arquivado') return 'Pedido arquivado (RGPD): fica só para a contabilidade.';
  if (f.estado === 'perdido') return 'Pedido perdido: não há mais nada a fazer.';
  const t = f.trabalhos ?? [];
  const obraT = f.trabalho_obra;
  if (f.validacao === 'devolvido' && f.estado !== 'aceite') return 'À espera do cliente: corrigir o pedido (foi-lhe devolvido).';
  if (f.aguarda_sinal) return 'À espera do cliente: pagar o sinal.';
  if (f.estado === 'proposta_enviada') return 'À espera do cliente: aceitar a proposta.';
  if (f.extra_enviado) return 'À espera do cliente: responder ao trabalho a mais.';
  if (obraT === 'concluida_eletricista') return 'À espera do cliente: confirmar que a obra ficou concluída (fica aceite ao fim de 7 dias).';
  if (obraT === 'na_bolsa') return 'À espera dos eletricistas: a obra está na bolsa.';
  if (obraT === 'aceite') return `À espera do eletricista: marcar a visita (tem ${f.urgente ? 2 : 48} h).`;
  if (obraT === 'visita_marcada') return 'À espera do eletricista: fazer a obra.';
  if (t.some((x) => x.estado === 'na_bolsa')) return 'À espera dos eletricistas: o pedido está na bolsa, ainda sem propostas.';
  if (t.some((x) => ['aceite', 'visita_marcada'].includes(x.estado))) return 'À espera do eletricista: ir ao local e fazer a proposta.';
  const concluida = obraConcluidaDe(f);
  if (concluida && (f.pagamentos ?? []).length && !restantePagoDe(f)) return 'À espera do cliente: pagar o restante.';
  if (f.estado === 'aceite' && f.ligar_pode === false) return 'À espera do cliente: pagar o restante.';
  if (concluida) return 'Pedido concluído.';
  return null;
}

/**
 * As duas frases de cada coisa por fazer, lado a lado para não divergirem (teste de 2026-10-14: o Hoje e a ficha diziam
 * coisas diferentes do mesmo pedido): `texto`, o da caixa da ficha (sem o nome do cliente: a ficha já é dele), e
 * `linha`, a do ecrã Hoje, com o nome (`f.nome`). O Hoje (api.js h.hoje) tira a linha daqui, dos mesmos factos da ficha.
 */
function frasesDe(p, f) {
  const nome = f.nome ?? 'o cliente';
  const fr = (texto, linha) => ({ texto, linha });
  switch (p.tipo) {
    // Falta a foto do quadro (ponto em_falta): não se valida, devolve-se ao cliente (decisão do dono, 2026-10-11).
    case 'validar':
      if (p.em_falta) return fr('Falta a foto do quadro elétrico: devolver o pedido ao cliente.', `Devolver ao cliente o pedido de ${nome} (falta a foto do quadro)`);
      if (p.motivo === 'corrigido') return fr('O cliente diz que já corrigiu: rever o pedido e validar.', `Rever o pedido corrigido por ${nome}`);
      if (p.motivo === 'recusada') return fr('O cliente não aceitou a proposta: rever e validar de novo, ou dar o pedido como perdido.', `Rever a proposta não aceite por ${nome}`);
      return fr('Validar o pedido.', `Validar o pedido de ${nome}`);
    case 'decidir_predio': return fr('Pedido de orçamento de um prédio: decidir se a Domus o aceita (precisa de projeto e técnico responsável).',
      `Pedido de orçamento de um prédio (${nome}): decidir se a Domus o aceita (precisa de projeto e técnico responsável)`);
    case 'avaria_urgente': return fr('Avaria urgente na bolsa: à espera de um eletricista (fora de horas). Se ninguém a aceitar, atribua-a.', `Avaria urgente de ${nome} na bolsa: à espera de um eletricista`);
    case 'pedido_novo': return fr('Contactar o cliente e, a seguir, mudar o estado para "Em preparação".', `Contactar ${nome}`);
    case 'proposta_aceite':
      if (!f.obra) return fr('O cliente aceitou a proposta: converter em cliente e marcar a obra.', `Marcar a obra da proposta aceite por ${nome}`);
      if (f.obra.por_agendar) return fr('O cliente aceitou a proposta: marcar a data da obra.', `Marcar a data da obra de ${nome}`);
      if (f.ligar_pode === false) {
        const obra = obraConcluidaDe(f) ? 'Obra concluída' : 'Obra marcada';
        return fr(`${obra}. Falta o cliente pagar o restante para ligar a casa.`, `${obra} em casa de ${nome}: falta o cliente pagar o restante para ligar a casa`);
      }
      return fr('Ligar a casa do cliente (app e mensalidade).', `Ligar a casa de ${nome}`);
    case 'mensagem': return fr('O cliente escreveu: responder à mensagem.', `Responder à mensagem de ${nome}`);
    case 'escolher_proposta': return fr(`Escolher a proposta de um eletricista (${f.n_propostas} ${f.n_propostas === 1 ? 'recebida' : 'recebidas'}).`, `Escolher a proposta de eletricista para ${nome}`);
    case 'enviar_proposta': return p.papeis.includes('ceo') ? fr('Rever a proposta do eletricista e enviá-la ao cliente.', `Enviar ao cliente a proposta do eletricista para ${nome}`)
      : fr('A visita já foi: enviar a proposta ao cliente.', `Enviar a proposta a ${nome}`);
    case 'aprovar_trabalho': return fr('O cliente confirmou o trabalho: aprovar o trabalho do eletricista.', `Aprovar o trabalho do eletricista em casa de ${nome}`);
    case 'pagar_eletricista': return fr(`Pagar a ${p.eletricista ?? 'o eletricista'} o trabalho deste pedido.`, `Pagar a ${p.eletricista ?? 'o eletricista'} o trabalho em casa de ${nome}`);
    case 'extra': return fr('Pôr o preço no trabalho a mais e enviá-lo ao cliente.', `Pôr o preço no trabalho a mais em casa de ${nome}`);
    case 'ida_perdida': return fr('O eletricista diz que o cliente não estava: confirmar ou anular a ida perdida.', `Confirmar ou anular a ida perdida a casa de ${nome}`);
    case 'sem_tecnico': return fr('Indicar o técnico responsável da obra.', `Indicar o técnico responsável da obra de ${nome}`);
    case 'visita': return fr(`Visita hoje${p.hora ? ` às ${p.hora}` : ''}.`, `Visita a ${nome}`);
    default: return fr(p.tipo, `${p.tipo}: ${nome}`);
  }
}
const textoDe = (p, f) => frasesDe(p, f).texto;

/**
 * O botão da caixa: {rotulo, sec, alvo} (abre a secção e mostra o alvo) ou {rotulo, ligacao} (vai para outro ecrã ou
 * liga ao cliente); null sem botão. Só ações do papel de quem vê (o servidor recusa as outras de qualquer forma).
 */
function acaoDe(p, f) {
  switch (p.tipo) {
    case 'validar': return p.em_falta ? { rotulo: 'Devolver ao cliente', sec: 'validacao', alvo: 'validacao-nota' } : { rotulo: p.motivo ? 'Rever e validar' : 'Validar', sec: 'validacao', alvo: 'validacao-ceo' };
    case 'pedido_novo': return f.telefone ? { rotulo: `Ligar ${f.telefone}`, ligacao: `tel:${String(f.telefone).replace(/[^\d+]/g, '')}` }
      : f.mensagem_para ? { rotulo: 'Escrever ao cliente', sec: 'mensagens', alvo: 'mensagem-cliente' } : null;
    case 'proposta_aceite':
      if (f.obra && (f.obra.por_agendar || f.ligar_pode === false)) return { rotulo: 'Abrir a obra', ligacao: `#/obras/${encodeURIComponent(f.obra.id)}` };
      return { rotulo: f.obra ? 'Ligar casa' : 'Converter em cliente e obra', sec: 'obra', alvo: 'form-converter' };
    case 'mensagem': return { rotulo: 'Responder', sec: 'mensagens', alvo: 'mensagem-cliente' };
    case 'escolher_proposta': return { rotulo: 'Ver as propostas', sec: 'eletricista', alvo: 'propostas-titulo' };
    case 'avaria_urgente': return { rotulo: 'Ver a bolsa', sec: 'eletricista', alvo: 'bolsa-estado' };
    case 'decidir_predio': return { rotulo: 'Decidir', sec: 'validacao', alvo: 'predio-decisao' };
    case 'enviar_proposta': return { rotulo: 'Preparar a proposta', sec: 'proposta', alvo: p.papeis.includes('ceo') ? 'proposta-eletricista' : 'proposta-partes' };
    case 'aprovar_trabalho': return { rotulo: 'Aprovar o trabalho', sec: 'eletricista', alvo: 'eletricista-aprovar' };
    case 'pagar_eletricista': return { rotulo: 'Abrir Pagamentos', ligacao: '#/pagamentos' };
    case 'extra': return { rotulo: 'Pôr o preço', sec: 'obra', alvo: 'trabalho-a-mais' };
    case 'ida_perdida': return { rotulo: 'Decidir a ida perdida', sec: 'obra', alvo: 'visita-perdida' };
    case 'sem_tecnico': return { rotulo: 'Indicar o técnico', sec: 'eletricista', alvo: 'tecnico-escolha' };
    default: return null;
  }
}

/** A secção que abre quando o botão vai para outro sítio (ligar ao cliente, a obra, os Pagamentos) ou não há botão. */
const SEC_DO_TIPO = { pedido_novo: 'proposta', proposta_aceite: 'obra', pagar_eletricista: 'eletricista', visita: 'obra' };
/** A secção que abre com cada fase atual, quando não há nada por fazer. */
const SEC_DA_FASE = { recebido: 'cliente', verificado: 'validacao', proposta: 'proposta', aceite: 'obra', obra: 'obra', pago: 'pagamentos' };

/**
 * As linhas do ecrã Hoje de um pedido, para um papel (teste de 2026-10-14: o Hoje tira o que falta e o texto daqui, dos
 * mesmos factos da ficha, para nunca dizer outra coisa): [{tipo, texto, desde, hora?, ligacao}]. A ligação é a do botão
 * da ficha quando ele vai para outro ecrã (a obra, os Pagamentos); senão, a ficha do pedido (`fichaDoPedido`).
 */
export function linhasDoHoje(f, papel, fichaDoPedido) {
  return pendentesDoPedido(f).filter((p) => p.papeis.includes(papel)).map((p) => {
    const ligacao = acaoDe(p, f)?.ligacao;
    return { tipo: p.tipo, texto: frasesDe(p, f).linha, desde: p.desde, ...(p.tipo === 'visita' ? { hora: p.hora ?? null } : {}),
      ligacao: ligacao && ligacao.startsWith('#/') ? ligacao : fichaDoPedido };
  });
}

/**
 * A caixa "Próximo passo" para um papel: {tipo, texto, acao, sec, outros: [{tipo, texto}]} ou, sem nada desse papel,
 * {tipo: null, texto: 'Nada a fazer agora.', espera, sec}. `espera` diz de quem se espera (o cliente, o eletricista ou
 * o CEO, quando o que falta é dele e não de quem vê).
 */
export function proximoPasso(f, papel) {
  const todos = pendentesDoPedido(f);
  const meus = todos.filter((p) => p.papeis.includes(papel));
  const fase = andamentoDoPedido(f).find((x) => x.atual);
  if (meus.length) {
    const [p, ...resto] = meus;
    const acao = acaoDe(p, f);
    return { tipo: p.tipo, texto: textoDe(p, f), linha: frasesDe(p, f).linha, acao, sec: acao?.sec ?? SEC_DO_TIPO[p.tipo] ?? null,
      outros: resto.map((x) => ({ tipo: x.tipo, texto: textoDe(x, f), linha: frasesDe(x, f).linha, acao: acaoDe(x, f) })) };
  }
  const doCeo = papel !== 'ceo' ? todos.find((p) => p.papeis.includes('ceo')) : null;
  const espera = doCeo ? `À espera do CEO: ${textoDe(doCeo, f).replace(/^./, (c) => c.toLowerCase())}` : esperaDoPedido(f);
  return { tipo: null, texto: 'Nada a fazer agora.', espera, acao: null, sec: fase ? SEC_DA_FASE[fase.chave] : null, outros: [] };
}
