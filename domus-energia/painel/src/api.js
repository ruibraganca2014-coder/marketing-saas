// API do painel (/painel/api/, docs/PAINEL-EMPRESA.md §3) e endpoints públicos
// (/api/orcamento, /api/catalogo). Toda a autorização é feita AQUI, no
// servidor, em cada pedido: cada rota declara os papéis que a podem usar e os
// handlers verificam ainda o que depende do registo (ex.: obras do técnico).

import {
  ErroApi, responder, lerJson, verificarOrigem, verificarOrigemPublica, cors, tipoJson, ipDe,
} from './http.js';
import {
  texto, numero, booleano, opcao, dia, diaHora, hora, idNum, simulacao as validarSimulacao,
  RE_TELEFONE, falha, esquemaQuadro as validarEsquemaQuadro, diagnostico as validarDiagnostico,
} from './validar.js';
import { RE_ID, RESERVADOS, PLANOS, ESTADOS_PLANO, PRECO_IVA, semIva } from './dados.js';
import { ESTADOS_ORCAMENTO, ESTADO_ARQUIVADO, ESTADOS_OBRA, ESTADOS_PAGAMENTO, PAPEIS, CATEGORIAS, ORIGENS_CONTACTO, MOTIVOS_PERDA, transacao } from './db.js';
import { RE_EMAIL, RE_PEDIDO, formatarPedido } from './pedidos.js';
import { hashSenha, verificarSenha, problemaSenha, gerarSenha } from './senhas.js';
import { LimiteTaxa } from './limite.js';
import { iso, diaLisboa, semanaLisboa, deCent, paraCent } from './util.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';
import { criarFotos, FOTOS_MAX, RE_ID_FOTO } from './fotos.js';
import { criarFotosRemotas } from './fotos-remotas.js';
import { dadosParaIa, ErroAssistente, MAX_DADOS_IA } from './assistente.js';
import { criarContas } from './conta.js';
import { criarCorreio } from './email.js';
import { criarPagamentosPedido, PLANOS_MENSAIS } from './pagamentos-pedido.js';
import { criarStock } from './stock.js';
import { normalizarEsquema } from '../public/vendor/quadro-desenho.js';
import { criarAcessoRapido, ROTA_EQUIPA, ROTA_CLIENTE, ROTA_CONTAS, ROTA_ELETRICISTA } from './acesso-rapido.js';
import { criarEletricistas, CAMINHO_API as API_ELETRICISTA } from './eletricistas.js';
import { criarCrm, ENTRADAS } from './crm.js';
import { criarTarefas, PRAZOS_LEMBRETES } from './tarefas.js';
import { criarEmailsAuto, PRAZOS_EMAILS, CHAVE_GOOGLE, urlGoogle } from './emails-auto.js';
import { criarNegocio, PERIODOS } from './negocio.js';
import { criarProcedimentos } from './procedimentos.js';

const TODOS = ['ceo', 'tecnico', 'comercial'];
const P = '/painel/api/';
export const KITS = { essencial: 3, conforto: 7, premium: 10, outro: null };
const LIMITE_ORCAMENTO = 1_250_000;   // bytes: simulação (≤ 1 MB) + campos
const RE_SKU = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
const MAX_APARELHOS_CONVERTER = 60;
const CONFIG_ORCAMENTO = {
  tarifa_hora_iva: { min: 0, max: 1000, rotulo: 'a tarifa por hora' },
  // Fase 3: intervalo da estimativa assimétrico (−10 % / +20 %; migração 14). O antigo `margem_intervalo_pct` fica na
  // base mas já não se usa nem se edita.
  intervalo_menos_pct: { min: 0, max: 100, rotulo: 'o intervalo para baixo (%)' },
  intervalo_mais_pct: { min: 0, max: 100, rotulo: 'o intervalo para cima (%)' },
  // Fase 3: preço do relatório completo (com IVA; docs/PAGAMENTOS-PEDIDO.md).
  preco_relatorio_iva: { min: 0, max: 1000, rotulo: 'o preço do relatório completo' },
  // Fase 2: margem dos pacotes do passo "Melhorias" (sobre material + mão de obra; web/simulador/melhorias.js).
  margem_pacotes_pct: { min: 0, max: 100, rotulo: 'a margem dos pacotes (%)' },
  deslocacao_iva: { min: 0, max: 10_000, rotulo: 'o valor fixo da deslocação' },          // valor fixo (mínimo) de cada deslocação
  deslocacao_km_gratis: { min: 0, max: 1000, rotulo: 'os km grátis da deslocação' },
  deslocacao_preco_km_iva: { min: 0, max: 100, rotulo: 'o preço por km da deslocação' },
  deslocacao_max_km: { min: 0, max: 2000, rotulo: 'a distância máxima da deslocação' },
  // IVA dos pagamentos online (proposta sem IVA → pagamentos com IVA; docs/PAGAMENTOS-PEDIDO.md).
  iva_pct: { min: 0, max: 50, rotulo: 'a taxa de IVA (%)' },
  // Decisões do dono de 2026-10-02 (migração 23): obra mínima (abaixo cobra-se o mínimo; o simulador avisa) e o valor
  // acima do qual não se paga por cartão (só Multibanco ou MB Way).
  obra_minima_iva: { min: 0, max: 10_000, rotulo: 'a obra mínima' },
  // Horas por dia de obra (migração 24): a deslocação é ida e volta por dia; dias = horas ÷ este valor.
  horas_por_dia: { min: 1, max: 24, rotulo: 'as horas por dia de obra' },
  // … no máximo estes dias de deslocação por obra (migração 25; decisão do dono).
  deslocacao_max_dias: { min: 1, max: 365, rotulo: 'o máximo de dias de deslocação por obra' },
  cartao_max_iva: { min: 0, max: 1_000_000, rotulo: 'o limite do cartão' },
  // Relatório completo: valores de referência da lista de ensaios (migração 16; docs/PAGAMENTOS-PEDIDO.md).
  ensaio_isolamento_mohm: { min: 0, max: 1000, rotulo: 'a resistência de isolamento mínima (MΩ)' },
  ensaio_diferencial_ms: { min: 0, max: 10_000, rotulo: 'o tempo de disparo máximo do diferencial (ms)' },
  ensaio_terra_ohm: { min: 0, max: 100_000, rotulo: 'a resistência de terra máxima (Ω)' },
  // Eletricistas externos (migração 27; docs/ELETRICISTAS.md): % da mão de obra sem IVA que recebem, por omissão.
  eletricista_pct: { min: 0, max: 100, rotulo: 'a percentagem da mão de obra dos eletricistas externos (%)' },
  // Prazos dos lembretes automáticos do CRM (migração 33; docs/CRM-TAREFAS.md; tarefas.js PRAZOS_LEMBRETES): dias
  // inteiros; os três da proposta têm de ser crescentes.
  lembrete_novo_dias_uteis: { min: 1, max: 10, inteiro: true, rotulo: 'o prazo do lembrete do pedido novo (dias úteis)' },
  lembrete_visita_dias: { min: 1, max: 30, inteiro: true, rotulo: 'o prazo do lembrete da proposta por enviar (dias depois da visita)' },
  lembrete_proposta_1_dias: { min: 1, max: 30, inteiro: true, rotulo: 'o prazo do primeiro lembrete da proposta (dias)' },
  lembrete_proposta_2_dias: { min: 2, max: 60, inteiro: true, rotulo: 'o prazo do segundo lembrete da proposta (dias)' },
  lembrete_proposta_3_dias: { min: 3, max: 90, inteiro: true, rotulo: 'o prazo do lembrete "Perdido?" (dias)' },
  // Emails automáticos ao cliente (migração 34; docs/EMAILS-AUTOMATICOS.md; emails-auto.js PRAZOS_EMAILS): os dois
  // lembretes do pagamento em falta (crescentes) e o email depois da obra, em dias; a hora (Lisboa) do lembrete da
  // visita, na véspera, fora das horas de silêncio.
  email_pagamento_1_dias: { min: 1, max: 30, inteiro: true, rotulo: 'o prazo do primeiro lembrete do pagamento em falta (dias)' },
  email_pagamento_2_dias: { min: 2, max: 60, inteiro: true, rotulo: 'o prazo do segundo lembrete do pagamento em falta (dias)' },
  email_obra_dias: { min: 1, max: 30, inteiro: true, rotulo: 'o prazo do email depois da obra (dias)' },
  email_visita_hora: { min: 8, max: 20, inteiro: true, rotulo: 'a hora do lembrete da visita (na véspera)' },
};
const CHAVES_ENSAIOS = ['continuidade_pe', 'isolamento', 'terra', 'diferencial'];
// Base da deslocação: um dos 308 concelhos (nome exato de painel/public/vendor/concelhos.js).
const NOMES_CONCELHOS = new Set(CONCELHOS.map((c) => c[0]));
// O que o /api/catalogo (público) mostra da configuração: só o que o simulador usa no preço.
const CONFIG_PUBLICA = [...Object.keys(CONFIG_ORCAMENTO).filter((k) => k !== 'iva_pct' && k !== 'cartao_max_iva' && k !== 'eletricista_pct' && !k.startsWith('ensaio_') && !k.startsWith('lembrete_') && !k.startsWith('email_')), 'deslocacao_base'];

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
  // Dashboard do negócio no Início (docs/DASHBOARD.md; negocio.js): os valores em euros só vão para o CEO; o técnico não entra.
  ['GET', 'resumo/negocio', ['ceo', 'comercial'], 'resumoNegocio'],
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
  ['POST', 'orcamentos/:id/libertar-relatorio', ['ceo'], 'libertarRelatorio'],
  ['GET', 'orcamentos/:id/relatorio-cliente', ['ceo'], 'previaRelatorioCliente'],
  ['POST', 'orcamentos/:id/obra-concluida', ['ceo', 'comercial'], 'obraConcluida'],
  ['POST', 'orcamentos/:id/marcar-visita', ['ceo', 'comercial'], 'marcarVisita'],
  ['POST', 'orcamentos/:id/visita-faltou', ['ceo', 'comercial'], 'visitaFaltou'],
  ['POST', 'orcamentos/:id/devolver-sinal', ['ceo'], 'devolverSinal'],
  ['POST', 'orcamentos/:id/ensaios', ['ceo', 'comercial'], 'registarEnsaios'],
  ['POST', 'orcamentos/:id/esquema-quadro', ['ceo', 'comercial'], 'guardarEsquemaQuadro'],
  ['POST', 'orcamentos/:id/diagnostico', ['ceo', 'comercial'], 'guardarDiagnostico'],
  // Assistente (IA) do pedido (docs/ASSISTENTE-IA.md): só ao carregar no botão; o resultado é só para a equipa.
  ['POST', 'orcamentos/:id/ia/resumo', ['ceo', 'comercial'], 'iaResumo'],
  ['POST', 'orcamentos/:id/ia/diagnostico', ['ceo', 'comercial'], 'iaDiagnostico'],
  // Escrever ao cliente (ronda 2 do assistente): o rascunho do email pela IA e o envio pelo painel (fica na ficha do CRM).
  ['POST', 'orcamentos/:id/ia/resposta', ['ceo', 'comercial'], 'iaResposta'],
  ['POST', 'orcamentos/:id/mensagem', ['ceo', 'comercial'], 'enviarMensagem'],
  ['GET', 'orcamentos/:id/fotos/:foto', ['ceo', 'comercial'], 'foto'],
  ['POST', 'orcamentos/:id/fotos/:foto/apagar', ['ceo', 'comercial'], 'apagarFoto'],
  ['GET', 'obras', TODOS, 'obras'],
  ['GET', 'obras/:id', TODOS, 'obra'],
  ['POST', 'obras', ['ceo'], 'criarObra'],
  ['POST', 'obras/:id', ['ceo', 'tecnico'], 'atualizarObra'],
  ['GET', 'pagamentos', ['ceo'], 'pagamentos'],
  ['GET', 'pagamentos-pedido', ['ceo'], 'pagamentosPedido'],
  ['POST', 'devolucoes/:id/devolvida', ['ceo'], 'devolucaoFeita'],
  ['GET', 'utilizadores', ['ceo'], 'utilizadores'],
  ['POST', 'utilizadores', ['ceo'], 'criarUtilizador'],
  ['POST', 'utilizadores/:id', ['ceo'], 'atualizarUtilizador'],
  ['GET', 'auditoria', ['ceo'], 'auditoria'],
  ['GET', 'pedidos', TODOS, 'pedidos'],
  ['GET', 'pedidos/:id', TODOS, 'pedido'],
  ['GET', 'catalogo', ['ceo'], 'catalogo'],
  ['POST', 'catalogo', ['ceo'], 'criarArtigo'],
  ['POST', 'catalogo/:id', ['ceo'], 'atualizarArtigo'],
  ['POST', 'catalogo/:id/stock', ['ceo'], 'movimentoStock'],
  ['GET', 'stock', ['ceo'], 'stock'],
  ['GET', 'config-orcamento', ['ceo'], 'configOrcamento'],
  ['POST', 'config-orcamento', ['ceo'], 'atualizarConfigOrcamento'],
  ['GET', 'contas', ['ceo'], 'contas'],
  ['POST', 'contas/:id', ['ceo'], 'atualizarConta'],
  ['POST', 'contas/:id/apagar', ['ceo'], 'apagarConta'],
  ['GET', 'eletricistas', ['ceo'], 'eletricistas'],
  ['GET', 'eletricistas/:id', ['ceo'], 'eletricista'],
  ['POST', 'eletricistas/:id', ['ceo'], 'atualizarEletricista'],
  ['GET', 'eletricistas/:id/seguro', ['ceo'], 'seguroEletricista'],
  ['GET', 'orcamentos/:id/eletricista', ['ceo'], 'atribuicaoEletricista'],
  ['POST', 'orcamentos/:id/eletricista', ['ceo'], 'atribuirEletricista'],
  ['POST', 'eletricistas/:id/apagar', ['ceo'], 'apagarEletricista'],
  ['GET', 'trabalhos-eletricista/:id/fotos/:foto', ['ceo'], 'fotoTrabalhoEletricista'],
  ['GET', 'pagamentos-eletricistas', ['ceo'], 'pagamentosEletricistas'],
  ['POST', 'trabalhos-eletricista/:id/pago', ['ceo'], 'pagoEletricista'],
  ['GET', 'trabalhos-eletricista/:id/fatura', ['ceo'], 'faturaEletricista'],
  // CRM e tarefas (docs/CRM-TAREFAS.md; crm.js, tarefas.js): o técnico só vê os clientes das suas obras; as tarefas de
  // todos só o CEO (o comercial e o técnico: as suas).
  ['GET', 'crm/pedidos', ['ceo', 'comercial'], 'crmPedidos'],
  ['POST', 'crm/pedidos/:id', ['ceo', 'comercial'], 'crmAtualizarPedido'],
  ['POST', 'crm/pedidos/:id/separar', ['ceo'], 'crmSeparar'],
  ['GET', 'crm/clientes', TODOS, 'crmClientes'],
  ['GET', 'crm/clientes/:id', TODOS, 'crmCliente'],
  ['POST', 'crm/clientes/:id', ['ceo', 'comercial'], 'crmAtualizarCliente'],
  ['POST', 'crm/clientes/:id/fundir', ['ceo'], 'crmFundir'],
  ['POST', 'crm/clientes/:id/registos', TODOS, 'crmRegisto'],
  ['GET', 'tarefas', TODOS, 'tarefas'],
  ['POST', 'tarefas', TODOS, 'criarTarefa'],
  ['GET', 'tarefas/calendario', TODOS, 'calendarioTarefas'],
  ['GET', 'tarefas/contagem', TODOS, 'contagemTarefas'],
  ['POST', 'tarefas/:id', TODOS, 'atualizarTarefa'],
  ['POST', 'tarefas/:id/apagar', TODOS, 'apagarTarefa'],
  // Procedimentos (SOP) e checklists por obra (docs/PROCEDIMENTOS.md; procedimentos.js): todos leem os publicados, só o
  // CEO vê os rascunhos, edita, publica e arquiva; nas checklists de uma obra marcam o CEO e o técnico dessa obra.
  ['GET', 'procedimentos', TODOS, 'procedimentos'],
  ['POST', 'procedimentos', ['ceo'], 'criarProcedimento'],
  ['GET', 'procedimentos/:id', TODOS, 'procedimento'],
  ['POST', 'procedimentos/:id', ['ceo'], 'atualizarProcedimento'],
  ['POST', 'procedimentos/:id/estado', ['ceo'], 'estadoProcedimento'],
  ['GET', 'obras/:id/checklists', TODOS, 'checklistsObra'],
  ['POST', 'obras/:id/checklists', ['ceo', 'tecnico'], 'iniciarChecklist'],
  ['POST', 'obras/:id/checklists/:lista', ['ceo', 'tecnico'], 'marcarPassoChecklist'],
].map(([metodo, caminho, papeis, nome]) => {
  const partes = caminho.split('/');
  return { metodo, caminho, papeis, nome, partes };
});

/**
 * Rotas do módulo dos eletricistas externos (docs/ELETRICISTAS.md): só existem com `config.eletricistas`
 * (ELETRICISTAS=1); sem ele respondem 404, como qualquer endereço desconhecido.
 */
const ROTAS_ELETRICISTAS = new Set(['eletricistas', 'eletricista', 'atualizarEletricista', 'seguroEletricista', 'atribuicaoEletricista', 'atribuirEletricista',
  'apagarEletricista', 'fotoTrabalhoEletricista', 'pagamentosEletricistas', 'pagoEletricista', 'faturaEletricista']);

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
  const porContaRetentativa = new LimiteTaxa(20, 3600_000, relogio);   // pagar a avaria e enviar outra vez, por conta

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

  // Fotos do simulador e leitura automática da foto do quadro (fotos.js, leitura-quadro.js).
  const fotos = criarFotos({ db, config, registo, relogio, leitor: ctx.leitor ?? null, auditar });
  const porIpFotos = new LimiteTaxa(config.limiteFotosHora, 3600_000, relogio);
  // Fotos pelo telemóvel (QR; fotos-remotas.js): os envios contam no mesmo limite por IP; as sondagens do computador
  // (de 3 em 3 s) e os pedidos de token têm o seu; a criação de tokens NOVOS (uma linha na base por 24 h) tem outro, mais baixo.
  const fotosRemotas = criarFotosRemotas({ db, config, registo, relogio, limiteFotos: porIpFotos,
    limiteConsultas: new LimiteTaxa(config.limiteFotosConsultasHora, 3600_000, relogio), limiteTokens: new LimiteTaxa(config.limiteFotosTokensHora, 3600_000, relogio) });

  // Conta de cliente (/api/conta/*, conta.js) e emails (códigos) por SMTP ou, sem SMTP, no registo.
  const correio = ctx.correio ?? criarCorreio({ config, registo, local: config.emailLocal });
  // Pagamentos do pedido (relatório, visita, avaria, sinal, restante; docs/PAGAMENTOS-PEDIDO.md): criados a seguir, as contas usam-nos.
  let pagPed = null;
  let eletricistas = null;   // criado mais abaixo (precisa dos pagamentos do pedido)
  let crm = null;            // idem (CRM: a conta apagada leva as notas e os contactos da ficha, RGPD)
  let emailsAuto = null;     // idem (emails automáticos: a avaliação na conta e o registo dos envios na ficha do CRM)
  const contas = criarContas({ db, config, registo, relogio, auditar, fotos, correio, pagamentos: () => pagPed,
    aoApagarPedido: (id) => eletricistas.apagarFotosDoPedido(id), eletricistas: () => (config.eletricistas ? eletricistas : null), crm: () => crm,
    emails: () => emailsAuto, tarefas: () => tarefas });
  // Stock simples (stock.js, migração 22): reserva com o sinal pago, saída com a obra concluída, custo do material.
  const stock = criarStock({ db, relogio });
  pagPed = criarPagamentosPedido({
    db, config, registo, relogio, auditar, correio, fotos, stock, sessao: (req, res) => contas.sessao(req, res),
    criarObra: (o, por) => obraDoPedido(o, { id: null, email: por }),
    criarOrcamento: (pedido, contaId) => inserirOrcamentoSite({ ...pedido, contaId }), fetch: ctx.fetchStripe,
    // "Visita sem defeito" (eletricistas.js): a data em que o CEO decidiu cobrar a visita ao cliente, ou null.
    visitaSemDefeito: (o) => (config.eletricistas ? eletricistas.visitaSemDefeito(o) : null),
  });
  if (pedidos) pedidos.aoResultado = (p, r) => contas.aoResultadoPedido(p, r);
  // Procedimentos (SOP) e checklists por obra (procedimentos.js; docs/PROCEDIMENTOS.md).
  const procedimentos = criarProcedimentos({ db, relogio, auditar });
  // Eletricistas externos (/api/eletricista/*, eletricistas.js): candidatura, área própria (sessão separada) e bolsa.
  eletricistas = criarEletricistas({ db, config, registo, relogio, auditar, correio, pagamentos: () => pagPed,
    concluirObra: (o, u, ip) => concluirObra(o, u, ip), procedimentos });
  // CRM e quadro de tarefas (crm.js, tarefas.js; docs/CRM-TAREFAS.md): lembretes automáticos ao ler e de 15 em 15 min.
  crm = criarCrm({ db, config, relogio, auditar, pagamentos: () => pagPed, emails: () => emailsAuto });
  const tarefas = criarTarefas({ db, config, relogio, auditar, crm, registo, correio, procedimentos });
  // Emails automáticos ao cliente (emails-auto.js; docs/EMAILS-AUTOMATICOS.md): correm na volta dos lembretes do CRM.
  emailsAuto = criarEmailsAuto({ db, config, relogio, auditar, correio, crm, tarefas, pagamentos: () => pagPed });
  tarefas.aCadaVolta(() => emailsAuto.verificar());
  // Dashboard do negócio (negocio.js; docs/DASHBOARD.md): indicadores por período, cortados por papel.
  const negocio = criarNegocio({ db, config, relogio, stock, pagamentos: () => pagPed, dados });
  // Acesso rápido de testes (acesso-rapido.js): só existe com config.acessoRapido (lançador local, nunca no servidor).
  const rapido = config.acessoRapido ? criarAcessoRapido({ db, config, auth, contas, eletricistas, auditar, relogio }) : null;
  // Taxa de IVA dos pagamentos online: IVA_TAXA (omissão 23) só na primeira vez; depois manda o painel (Catálogo).
  db.prepare('INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES (\'iva_pct\', ?)').run(config.ivaTaxa ?? 23);

  // ------------------------------------------------------------ utilidades
  const fichas = () => new Map(db.prepare('SELECT * FROM fichas_cliente').all().map((f) => [f.codigo, f]));
  const pedidoPendente = (tipo, cliente) => db.prepare('SELECT id FROM pedidos_admin WHERE tipo = ? AND cliente = ? AND estado = \'pendente\'').get(tipo, cliente);

  function codigoCliente(c) {
    if (!RE_ID.test(c)) throw new ErroApi(404, 'Cliente não encontrado.');
    return c;
  }

  const temFinanceiro = (u) => u.papel === 'ceo';
  /** `simulacao.urgencia` (validada ao receber: normal | semana | urgente) a partir do JSON guardado; null sem ela. */
  const urgenciaDaSimulacao = (json) => (typeof json === 'string' ? /"urgencia":"(normal|semana|urgente)"/.exec(json)?.[1] ?? null : null);
  /** `orcamentos.esquema_quadro` (JSON; migração 17) como objeto {…esquema, data, por}, ou null. */
  const esquemaQuadroDe = (o) => {
    if (!o?.esquema_quadro) return null;
    try { const e = JSON.parse(o.esquema_quadro); return e && typeof e === 'object' && !Array.isArray(e) ? e : null; } catch { return null; }
  };

  function formatarOrcamento(o, completo = false) {
    const r = {
      id: o.id, criado: o.criado, atualizado: o.atualizado, origem: o.origem, nome: o.nome, telefone: o.telefone,
      email: o.email, localidade: o.localidade, morada: o.morada, servico: o.servico, mensagem: o.mensagem, codigo_cliente: o.codigo_cliente,
      estado: o.estado, notas: o.notas, data_visita: o.data_visita, valor_proposta: deCent(o.valor_proposta_cent),
      motivo_perda: o.motivo_perda, cliente: o.cliente, obra_id: o.obra_id, pedido_id: o.pedido_id,
      tem_simulacao: o.simulacao !== null, simulacao_bytes: o.simulacao ? Buffer.byteLength(o.simulacao) : 0,
      // Lote 8: a urgência do pedido (selo "Urgente" no quadro de pedidos) sem ler a simulação toda.
      urgencia: urgenciaDaSimulacao(o.simulacao),
      n_fotos: fotos.contar(o.id),
      // Conta de cliente do pedido (null nos pedidos sem conta, ex. os antigos e o formulário do site).
      conta: contas.resumoParaPainel(o.conta_id),
      proposta_texto: o.proposta_texto, proposta_aceite: o.proposta_aceite,
      // Pagamentos do pedido: aceite pelo cliente mas o sinal ainda por pagar = "Aceite — a aguardar sinal".
      aguarda_sinal: o.estado === 'proposta_enviada' && Boolean(o.proposta_aceite),
      relatorio_libertado: o.relatorio_libertado ?? null, plano_escolhido: o.plano_escolhido ?? null, obra_concluida: o.obra_concluida ?? null,
      // Ensaios medidos na visita/obra (migração 16; o relatório completo mostra-os), ou null.
      ensaios: pagPed.ensaiosDe(o),
      // Esquema do quadro feito pelo eletricista (migração 17; {…esquema, data, por}), ou null.
      esquema_quadro: esquemaQuadroDe(o),
      // Diagnóstico da avaria feito pelo eletricista (migração 18; {verificacoes, valores, tipo, conclusao, data, por}), ou null.
      diagnostico: pagPed.diagnosticoDe(o),
      pagamentos: pagPed.listarParaPainel(o.id),
      // Fase 3: o que o cliente comprou (relatório completo, visita) e os preços dele.
      compras: o.simulacao ? pagPed.compras(o) : null,
      // Proposta (sem IVA) → total com IVA, sinal e restante (o que o cliente paga online).
      valores_pagamento: pagPed.resumoValores(o),
      // Decisões de 2026-10-02: a proposta em três partes (sem IVA; null = um só valor), se a casa já se pode ligar
      // (obra toda paga), "Quero que comecem já", a falta à visita e quando reservar o material.
      proposta_partes: pagPed.partes(o),
      ligar_casa: o.estado === 'aceite' ? pagPed.ligacaoCasa(o) : null,
      inicio_imediato: o.inicio_imediato ?? null, visita_faltou: o.visita_faltou ?? null,
      material_reserva: pagPed.reservaMaterial(o),
      // A obra do pedido (nasce com o sinal pago; a casa liga-se depois): {id, data, estado, por_agendar} ou null.
      obra: resumoObra(o.obra_id),
      // Devoluções por transferência (pagamentos por Multibanco): estado e valor; o IBAN só mascarado.
      devolucoes: pagPed.devolucoesDoPedido(o.id),
      anonimizado: o.anonimizado ?? null,
      // CRM (migração 32): a ficha do cliente, a fase do negócio, o responsável, a origem do contacto e o tipo do motivo de perda.
      crm_cliente_id: o.crm_cliente_id ?? null, fase: crm.faseDe(o), responsavel_id: o.responsavel_id ?? null,
      origem_contacto: o.origem_contacto ?? null, origem_entrada: o.origem_entrada ?? null, motivo_perda_tipo: o.motivo_perda_tipo ?? null,
    };
    if (completo) {
      // As três partes sugeridas pela simulação (catálogo do servidor) para o CEO abrir a proposta, e o stock do pedido.
      r.proposta_sugerida = o.simulacao ? pagPed.propostaSugerida(o) : null;
      r.stock = o.simulacao ? stock.resumoPedido(o) : null;
      r.simulacao = o.simulacao ? JSON.parse(o.simulacao) : null;
      r.catalogo = artigosDaSimulacao(r.simulacao);
      r.fotos = fotos.listar(o, r.simulacao);
      r.leitura_quadro = fotos.leituraQuadro(o);
      // Assistente (IA): {ligado, resumo, diagnostico} — o último resultado de cada botão, ou null.
      r.ia = { ligado: Boolean(ctx.assistente), resumo: null, diagnostico: null, ...iaDe(o) };
      // "Escrever ao cliente": o email para onde vai (o da conta, ou o do formulário), ou null se não há para onde.
      r.mensagem_para = emailsAuto.destinatario(o);
      // A conversa do pedido: os emails enviados pela equipa e as respostas do cliente na conta (migração 38).
      r.mensagens = db.prepare('SELECT id, de, assunto, texto, por_email AS por, criado FROM mensagens_pedido WHERE orcamento_id = ? ORDER BY id').all(o.id);
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
  const resumoObra = (id) => {
    const b = id ? db.prepare('SELECT id, data, estado, por_agendar FROM obras WHERE id = ?').get(id) : null;
    return b ? { id: b.id, data: b.data, estado: b.estado, por_agendar: Boolean(b.por_agendar) } : null;
  };
  const nomeDoOrcamento = db.prepare('SELECT nome FROM orcamentos WHERE id = ?');
  /** A casa de uma obra: "ligada"; "por_ligar" (já se pode ligar); "falta_restante" (só com o restante pago). Sem valores: o técnico vê-a. */
  const casaDaObra = (b) => {
    if (b.cliente) return 'ligada';
    const orc = b.orcamento_id ? db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(b.orcamento_id) : null;
    return orc && orc.estado === 'aceite' && !pagPed.ligacaoCasa(orc).pode ? 'falta_restante' : 'por_ligar';
  };
  function formatarObra(o, mapaFichas) {
    let material = [];
    try { material = JSON.parse(o.material); } catch { /* ignorado */ }
    return {
      // Obra criada com o sinal pago: a casa ainda não está ligada (`cliente` vazio até à conversão, que só se faz com o
      // restante pago) e a data é provisória até alguém a escolher (`por_agendar`). O nome vem do pedido.
      id: o.id, cliente: o.cliente || null, cliente_nome: mapaFichas?.get(o.cliente)?.nome ?? (!o.cliente && o.orcamento_id ? nomeDoOrcamento.get(o.orcamento_id)?.nome ?? null : null),
      orcamento_id: o.orcamento_id, casa_ligada: Boolean(o.cliente), casa: casaDaObra(o), por_agendar: Boolean(o.por_agendar),
      data: o.data, hora: o.hora, kit: o.kit, estado: o.estado, material,
      horas_estimadas: o.horas_estimadas, horas_reais: o.horas_reais, notas: o.notas,
      tecnicos: tecnicosDe.all(o.id).map((t) => ({ id: t.id, nome: t.nome })),
      // Checklists dos procedimentos (docs/PROCEDIMENTOS.md): {n, feitos, total, obrigatorios_falta}, ou null sem nenhuma.
      checklists: procedimentos.resumoObra(o.id),
      criado: o.criado, atualizado: o.atualizado,
    };
  }
  const obraDoTecnico = (obraId, uid) => Boolean(db.prepare('SELECT 1 FROM obra_tecnicos WHERE obra_id = ? AND utilizador_id = ?').get(obraId, uid));

  function formatarArtigo(a) {
    return {
      id: a.id, sku: a.sku, nome: a.nome, categoria: a.categoria, fornecedor: a.fornecedor, link: a.link,
      preco_compra: deCent(a.preco_compra_cent), preco_venda_iva: deCent(a.preco_venda_iva_cent),
      horas_instalacao: a.horas_instalacao, horas_troca: a.horas_troca ?? null, especificacoes: JSON.parse(a.especificacoes || '{}'),
      ativo: Boolean(a.ativo), visivel_cliente: Boolean(a.visivel_cliente), atualizado: a.atualizado,
      // Stock (migração 22; só CEO): em armazém, reservado para obras aceites, mínimo e se o artigo tem stock gerido.
      stock_qtd: a.stock_qtd ?? 0, stock_reservado: a.stock_reservado ?? 0, stock_minimo: a.stock_minimo ?? 0, stock_gerido: stock.gerido(a),
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
  const h = { ...crm.h, ...tarefas.h, ...procedimentos.h };

  h.entrar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'password']);
    if (typeof v.email !== 'string' || typeof v.password !== 'string' || !v.email || !v.password) throw new ErroApi(400, 'Indique o email e a palavra-passe.');
    if (v.email.length > 254 || v.password.length > 200) throw new ErroApi(401, 'Email ou palavra-passe errados.');
    const { token, utilizador } = await auth.entrar(v.email, v.password, ip);
    auditar(utilizador, 'entrar', `utilizador:${utilizador.id}`, null, ip);
    responder(res, 200, { utilizador: publicoUtilizador(utilizador), pagamentos: pagPed.info(), eletricistas: config.eletricistas }, { 'Set-Cookie': auth.cookie(token, Math.floor(config.sessaoMs / 1000)) });
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
    // Faixa no painel: "Modo de demonstração — pagamentos simulados" ou "Pagamentos desligados".
    pagamentos: pagPed.info(),
    // Módulo dos eletricistas externos ligado (ELETRICISTAS=1)? O painel esconde o ecrã e a atribuição sem ele.
    eletricistas: config.eletricistas,
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

  // Propostas aceites pelo cliente na conta e ainda por converter (aviso no início do painel).
  const propostasAceitesOnline = () => db.prepare(`SELECT id, nome, proposta_aceite, valor_proposta_cent FROM orcamentos
    WHERE estado = 'aceite' AND proposta_aceite IS NOT NULL AND cliente IS NULL ORDER BY proposta_aceite DESC LIMIT 50`).all()
    .map((o) => ({ id: o.id, nome: o.nome, quando: o.proposta_aceite, valor_proposta: deCent(o.valor_proposta_cent) }));

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
      r.propostas_aceites_online = propostasAceitesOnline();
      r.pedidos_admin_pendentes = db.prepare('SELECT COUNT(*) AS n FROM pedidos_admin WHERE estado = \'pendente\'').get().n;
    } else if (u.papel === 'tecnico') {
      const semana = obrasSemana(u.id).map((o) => formatarObra(o, mapa));
      const al = alertas.lista();
      r.obras_hoje = semana.filter((o) => o.data === hoje);
      r.obras_semana = semana;
      r.alertas = { ligado: al.ligado, contagem: al.contagem, principais: al.alertas.slice(0, 20) };
    } else {
      const porEstado = Object.fromEntries(ESTADOS_ORCAMENTO.map((e) => [e, 0]));
      for (const x of db.prepare('SELECT estado, COUNT(*) AS n FROM orcamentos WHERE estado != ? GROUP BY estado').all(ESTADO_ARQUIVADO)) porEstado[x.estado] = x.n;
      r.orcamentos_por_estado = porEstado;
      r.pedidos_novos = porEstado.novo;
      r.propostas_aceites_online = propostasAceitesOnline();
      r.visitas_semana = db.prepare(`SELECT * FROM orcamentos WHERE substr(data_visita, 1, 10) BETWEEN ? AND ?
        AND estado NOT IN ('perdido', '${ESTADO_ARQUIVADO}') ORDER BY data_visita`).all(inicio, fim).map((o) => formatarOrcamento(o));
    }
    responder(res, 200, r);
  };

  // Dashboard do negócio (Início): `?periodo=` semana | mes (omissão) | mes_passado | ano, comparado com o anterior equivalente.
  h.resumoNegocio = async ({ res, u, url }) => {
    responder(res, 200, await negocio.resumo(u, opcao(url.searchParams.get('periodo') ?? 'mes', 'período', PERIODOS)));
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
    // A ficha da pessoa no CRM (docs/CRM-TAREFAS.md), quando há uma ligada a esta casa e o utilizador a pode abrir.
    crm.ligarPedidos();
    r.crm_cliente_id = crm.fichaAberta(u, db.prepare('SELECT crm_cliente_id AS k FROM orcamentos WHERE cliente = ? AND crm_cliente_id IS NOT NULL ORDER BY id LIMIT 1').get(c)?.k);
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
  // Os arquivados (RGPD) não vêm por omissão: só com ?estado=arquivado, e só para o CEO.
  h.orcamentos = ({ res, u, url }) => {
    crm.ligarPedidos();
    const estado = url.searchParams.get('estado') || null;
    if (estado === ESTADO_ARQUIVADO) { if (u.papel !== 'ceo') throw new ErroApi(403, 'Só o CEO vê os pedidos arquivados.'); }
    else if (estado !== null) opcao(estado, 'estado', ESTADOS_ORCAMENTO);
    const linhas = estado
      ? db.prepare('SELECT * FROM orcamentos WHERE estado = ? ORDER BY id DESC LIMIT 1000').all(estado)
      : db.prepare('SELECT * FROM orcamentos WHERE estado != ? ORDER BY id DESC LIMIT 1000').all(ESTADO_ARQUIVADO);
    responder(res, 200, { orcamentos: linhas.map((o) => formatarOrcamento(o)) });
  };

  const obterOrcamento = (s) => {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(idNum(s));
    if (!o) throw new ErroApi(404, 'Pedido de orçamento não encontrado.');
    return o;
  };

  /** Um pedido arquivado (RGPD) não muda: nem o estado, nem os dados, nem as ações (relatório, obra, fotos). */
  const naoArquivado = (o) => {
    if (o.estado === ESTADO_ARQUIVADO) throw new ErroApi(409, 'Pedido arquivado (RGPD): não se pode alterar.');
    return o;
  };

  h.orcamento = ({ res, u, params }) => {
    crm.ligarPedidos();
    const o = obterOrcamento(params.id);
    if (o.estado === ESTADO_ARQUIVADO && u.papel !== 'ceo') throw new ErroApi(404, 'Pedido de orçamento não encontrado.');
    responder(res, 200, formatarOrcamento(o, true));
  };

  // Foto de um pedido: só para quem vê o orçamento (rota), com o tipo certo e sem que o browser a
  // possa interpretar como outra coisa (nosniff, CSP sandbox). Não há listagem de pastas.
  const obterFoto = (params) => {
    const o = obterOrcamento(params.id);
    const f = RE_ID_FOTO.test(params.foto) ? fotos.obter(o.id, params.foto) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    return { o, f };
  };

  h.foto = async ({ res, params }) => {
    const { f } = obterFoto(params);
    let corpo;
    try {
      corpo = await fotos.ler(f);
    } catch {
      throw new ErroApi(404, 'Foto não encontrada.');
    }
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': f.tipo_mime,
      'Content-Length': corpo.length,
      'Content-Disposition': `inline; filename="pedido-${f.orcamento_id}-${f.chave.replace(/[^A-Za-z0-9_-]/g, '-')}.${f.tipo_mime === 'image/png' ? 'png' : 'jpg'}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(corpo);
  };

  h.apagarFoto = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    const { o, f } = obterFoto(params);
    naoArquivado(o);
    await fotos.apagar(f);
    auditar(u, 'foto_apagada', `orcamento:${o.id}`, { chave: f.chave }, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  function camposContacto(v, obrigatorio) {
    const r = {};
    if (obrigatorio || v.nome !== undefined) r.nome = texto(v.nome, 'o nome', { max: 120, obrigatorio: true });
    if (v.telefone !== undefined) r.telefone = texto(v.telefone, 'o telefone', { max: 30, re: RE_TELEFONE, reMsg: 'Telefone inválido.' });
    if (v.email !== undefined) r.email = texto(v.email, 'o email', { max: 254, re: RE_EMAIL, reMsg: 'Email inválido.' });
    if (v.localidade !== undefined) r.localidade = texto(v.localidade, 'a localidade', { max: 80 });
    if (v.morada !== undefined) r.morada = texto(v.morada, 'a morada', { max: 200 });
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
    const o = naoArquivado(obterOrcamento(params.id));
    const v = await lerJson(req, ['estado', 'notas', 'data_visita', 'valor_proposta', 'proposta_texto', 'motivo_perda', 'motivo_perda_tipo',
      'nome', 'telefone', 'email', 'localidade', 'morada', 'servico', 'mensagem', ...PARTES_PROPOSTA]);
    const mud = camposContacto(v, false);
    if (v.estado !== undefined) mud.estado = opcao(v.estado, 'estado', ESTADOS_ORCAMENTO);
    if (v.notas !== undefined) mud.notas = texto(v.notas, 'as notas', { max: 4000, multilinha: true });
    if (v.data_visita !== undefined) mud.data_visita = diaHora(v.data_visita, 'a data da visita');
    if (v.valor_proposta !== undefined) mud.valor_proposta_cent = v.valor_proposta === null ? null : paraCent(numero(v.valor_proposta, 'o valor da proposta', { max: 1_000_000 }));
    // Texto da proposta que o cliente vê na conta (com o valor), a partir do estado "proposta_enviada".
    if (v.proposta_texto !== undefined) mud.proposta_texto = texto(v.proposta_texto, 'o texto da proposta', { max: 4000, multilinha: true });
    if (v.motivo_perda !== undefined) mud.motivo_perda = texto(v.motivo_perda, 'o motivo da perda', { max: 500, multilinha: true });
    // CRM: o motivo de perda escolhido (preço, prazo, sem resposta, outro); o texto continua a ser o pormenor.
    if (v.motivo_perda_tipo !== undefined) mud.motivo_perda_tipo = opcao(v.motivo_perda_tipo, 'motivo da perda', MOTIVOS_PERDA, { obrigatorio: false });
    // Proposta em três partes (sem IVA; decisão 15): as três ou nenhuma. Com elas o valor da proposta é a soma; mudar só
    // o valor (como antes) volta a uma proposta de um só valor.
    const dadas = PARTES_PROPOSTA.filter((k) => v[k] !== undefined);
    if (dadas.length) {
      const nulas = PARTES_PROPOSTA.filter((k) => v[k] === null).length;
      if (dadas.length !== 3 || (nulas && nulas !== 3)) falha('Indique as três partes da proposta (mão de obra, material e deslocação) ou nenhuma.');
      const ROTULO = { proposta_mao_obra: 'a mão de obra', proposta_material: 'o material', proposta_deslocacao: 'a deslocação' };
      for (const k of PARTES_PROPOSTA) mud[`${k}_cent`] = nulas ? null : paraCent(numero(v[k], ROTULO[k], { max: 1_000_000, nulo: false }));
      if (!nulas) mud.valor_proposta_cent = PARTES_PROPOSTA.reduce((t, k) => t + mud[`${k}_cent`], 0);
    } else if (mud.valor_proposta_cent !== undefined && mud.valor_proposta_cent !== o.valor_proposta_cent && o.proposta_mao_obra_cent !== null) {
      for (const k of PARTES_PROPOSTA) mud[`${k}_cent`] = null;
    }
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const final = { ...o, ...mud };
    if (!final.telefone && !final.email) falha('Indique um telefone ou um email.');
    if (final.estado === 'perdido' && !final.motivo_perda && !final.motivo_perda_tipo) falha('Indique o motivo da perda.');
    if (final.estado === 'perdido' && final.motivo_perda_tipo === 'outro' && !final.motivo_perda) falha('Com o motivo "Outro", escreva qual foi.');
    if (final.estado === 'visita_marcada' && !final.data_visita) falha('Indique a data da visita.');
    if (o.cliente && mud.estado && mud.estado !== 'aceite') falha('Este pedido já foi convertido em cliente e obra.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE orcamentos SET ${cols.map((k) => `${k} = ?`).join(', ')}, atualizado = ? WHERE id = ?`)
      .run(...cols.map((k) => mud[k]), agoraIso(), o.id);
    const det = {};
    for (const k of cols) if (o[k] !== mud[k]) det[k.endsWith('_cent') ? k.slice(0, -5) : k] = k.endsWith('_cent') ? deCent(mud[k]) : mud[k];
    // Aceite pelo cliente e a aguardar o sinal: se a proposta (valor, partes ou estado) mudou, o sinal por pagar sai e o
    // cliente volta a aceitar (docs/PAGAMENTOS-PEDIDO.md).
    if (o.proposta_aceite && o.estado === 'proposta_enviada' && ('valor_proposta' in det || PARTES_PROPOSTA.some((k) => k in det) || (mud.estado && mud.estado !== 'proposta_enviada'))) {
      pagPed.aoMudarProposta(o.id);
    }
    // Um pedido que passa a aceite (à mão, sem sinal online) reserva o material e ganha a obra (por agendar); um que
    // deixa de o estar liberta o material e a obra fica cancelada (nunca se apaga).
    if (mud.estado && mud.estado !== o.estado) {
      if (mud.estado === 'aceite') { stock.reservar(obterOrcamento(params.id), u.email); obraDoPedido(obterOrcamento(params.id), u, ip); }
      else if (o.estado === 'aceite') { stock.libertar(o.id, u.email, 'o pedido deixou de estar aceite'); cancelarObraDoPedido(o, u, ip); }
    }
    auditar(u, 'orcamento_atualizado', `orcamento:${o.id}`, det, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  const PARTES_PROPOSTA = ['proposta_mao_obra', 'proposta_material', 'proposta_deslocacao'];

  /** Material de uma obra a partir da simulação do pedido (itens do catálogo): [{sku, nome, quantidade, feito}]. */
  function materialDaSimulacao(o) {
    if (!o.simulacao) return [];
    try {
      const sim = JSON.parse(o.simulacao);
      if (!Array.isArray(sim.itens)) return [];
      const nomeSku = db.prepare('SELECT nome FROM catalogo WHERE sku = ?');
      return sim.itens.slice(0, 200).filter((i) => i && typeof i.sku === 'string' && RE_SKU.test(i.sku))
        .map((i) => ({ sku: i.sku, nome: nomeSku.get(i.sku)?.nome ?? i.sku, quantidade: Number.isFinite(i.qtd) && i.qtd > 0 ? Math.min(Math.round(i.qtd), 10_000) : 1, feito: false }));
    } catch { return []; }   // simulação sem itens válidos
  }

  /**
   * A obra de um pedido aceite (decisão do dono: a obra nasce com o sinal pago; a casa liga-se depois, com o restante
   * pago). Uma só por pedido: se já existe devolve-a (uma cancelada volta a "agendada", por agendar). Nasce sem casa
   * (`cliente` vazio), com o material e as horas da simulação e uma data provisória (`por_agendar`): hoje, ou o dia a
   * partir do qual se reserva o material (14 dias depois do sinal, sem "Quero que comecem já"). Devolve o id.
   */
  function obraDoPedido(o, u, ip = null) {
    const agora = agoraIso();
    const existente = db.prepare('SELECT * FROM obras WHERE id = ? OR orcamento_id = ? ORDER BY id LIMIT 1').get(o.obra_id ?? -1, o.id);
    if (existente) {
      if (existente.estado === 'cancelada' && !existente.cliente) {
        db.prepare("UPDATE obras SET estado = 'agendada', por_agendar = 1, atualizado = ? WHERE id = ?").run(agora, existente.id);
        auditar(u, 'obra_atualizada', `obra:${existente.id}`, { estado: 'agendada', orcamento: o.id, motivo: 'o pedido voltou a aceite' }, ip);
      }
      if (o.obra_id !== existente.id) db.prepare('UPDATE orcamentos SET obra_id = ? WHERE id = ?').run(existente.id, o.id);
      return existente.id;
    }
    const reserva = pagPed.reservaMaterial(o);
    const data = diaLisboa(new Date(reserva?.a_partir ?? relogio()));
    const id = Number(db.prepare(`INSERT INTO obras (cliente, orcamento_id, data, estado, material, horas_estimadas, por_agendar, criado, atualizado)
      VALUES ('', ?, ?, 'agendada', ?, ?, 1, ?, ?)`).run(o.id, data, JSON.stringify(materialDaSimulacao(o)), horasDaSimulacao(o.simulacao), agora, agora).lastInsertRowid);
    db.prepare('UPDATE orcamentos SET obra_id = ? WHERE id = ?').run(id, o.id);
    auditar(u, 'obra_criada', `obra:${id}`, { orcamento: o.id, data, por_agendar: true, casa_ligada: false }, ip);
    return id;
  }

  /** O pedido deixou de estar aceite (ou o sinal foi devolvido) antes de a obra ser feita: a obra fica cancelada. */
  function cancelarObraDoPedido(o, u, ip = null) {
    if (!o.obra_id) return;
    const r = db.prepare("UPDATE obras SET estado = 'cancelada', atualizado = ? WHERE id = ? AND estado NOT IN ('concluida', 'cancelada')").run(agoraIso(), o.obra_id);
    if (r.changes) auditar(u, 'obra_atualizada', `obra:${o.obra_id}`, { estado: 'cancelada', orcamento: o.id }, ip);
  }

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
    naoArquivado(o);
    if (o.estado !== 'aceite') throw new ErroApi(409, 'Só se converte um pedido com o estado "aceite".');
    if (o.cliente) throw new ErroApi(409, 'Este pedido já foi convertido.');
    // Decisão 1 do dono: a casa (conta do cliente no servidor, aparelhos, plano) só se liga com a obra toda paga. Com
    // os pagamentos desligados (ou num pedido sem conta) fica como antes; o painel mostra o aviso.
    const ligacao = pagPed.ligacaoCasa(o);
    if (!ligacao.pode) throw new ErroApi(409, `Falta o cliente pagar o restante (${ligacao.falta.toFixed(2).replace('.', ',')} €): a casa só se liga com a obra paga.`);
    const codigo = texto(v.codigo, 'o código do cliente', { max: 32, obrigatorio: true, re: RE_ID,
      reMsg: 'Código inválido: 1 a 32 letras minúsculas, dígitos e "-" (sem "-" no início ou no fim).' });
    if (RESERVADOS.has(codigo)) falha(`O código "${codigo}" é reservado.`);
    // A obra já existe desde o sinal (obraDoPedido): ligar a casa reaproveita-a — nunca cria outra — e só muda nela o
    // que vier no pedido (data, hora, kit, horas, notas, técnicos). Sem obra (pedidos aceites antes disto) cria-a.
    const obraAtual = o.obra_id ? db.prepare('SELECT * FROM obras WHERE id = ?').get(o.obra_id) ?? null : null;
    const dataVisita = o.data_visita ? o.data_visita.slice(0, 10) : null;
    // A data: a do pedido; senão a da obra já agendada; senão o dia da visita; senão a provisória da obra.
    const provisoria = (v.data === undefined || v.data === null) && Boolean(obraAtual?.por_agendar) && !dataVisita;
    const data = dia(v.data ?? (obraAtual && !obraAtual.por_agendar ? obraAtual.data : null) ?? dataVisita ?? obraAtual?.data, 'a data da obra', { obrigatorio: true });
    const h2 = v.hora === undefined && obraAtual ? obraAtual.hora : hora(v.hora, 'a hora');
    const kit = v.kit === undefined && obraAtual ? obraAtual.kit : opcao(v.kit, 'kit', Object.keys(KITS), { obrigatorio: false });
    const horasEst = v.horas_estimadas !== undefined ? numero(v.horas_estimadas, 'as horas estimadas', { max: 500 })
      : obraAtual ? obraAtual.horas_estimadas ?? (v.kit !== undefined && kit ? KITS[kit] : null) : (horasDaSimulacao(o.simulacao) ?? (kit ? KITS[kit] : null));
    const notas = v.notas === undefined && obraAtual ? obraAtual.notas : texto(v.notas, 'as notas', { max: 4000, multilinha: true });
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
    const mat = materialDaSimulacao(o);
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
      let id;
      if (obraAtual) {
        id = obraAtual.id;
        const estado = obraAtual.estado === 'cancelada' ? 'cancelada' : o.obra_concluida ? 'concluida' : obraAtual.estado;
        db.prepare('UPDATE obras SET cliente = ?, data = ?, hora = ?, kit = ?, horas_estimadas = ?, notas = ?, por_agendar = ?, estado = ?, atualizado = ? WHERE id = ?')
          .run(codigo, data, h2, kit, horasEst, notas, provisoria ? 1 : 0, estado, agora, id);
        if (v.tecnicos !== undefined) db.prepare('DELETE FROM obra_tecnicos WHERE obra_id = ?').run(id);
      } else {
        id = Number(db.prepare(`INSERT INTO obras (cliente, orcamento_id, data, hora, kit, estado, material, horas_estimadas, notas, criado, atualizado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(codigo, o.id, data, h2, kit, o.obra_concluida ? 'concluida' : 'agendada', JSON.stringify(mat), horasEst, notas, agora, agora).lastInsertRowid);
      }
      for (const t of tecs) db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(id, t);
      db.prepare('UPDATE orcamentos SET cliente = ?, obra_id = ?, pedido_id = ?, atualizado = ? WHERE id = ?').run(codigo, id, pedido?.id ?? null, agora, o.id);
      return id;
    });
    auditar(u, 'orcamento_convertido', `orcamento:${o.id}`, { cliente: codigo, obra: obraId, pedido: pedido?.id ?? null, aparelhos: pedidosAparelhos.length }, ip);
    for (const [i, a] of aparelhos.entries()) auditar(u, 'pedido_aparelho', `cliente:${codigo}`, { pedido: pedidosAparelhos[i].id, aparelho: a.id, tipo: a.tipo, orcamento: o.id }, ip);
    auditar(u, obraAtual ? 'obra_atualizada' : 'obra_criada', `obra:${obraId}`, { cliente: codigo, data, kit, orcamento: o.id, ...(obraAtual ? { casa_ligada: true } : {}) }, ip);
    // Plano mensal escolhido ao aceitar: no modo simulado a subscrição começa com a casa ligada (pedido-admin
    // "plano", a seguir ao do cliente); no modo stripe o cliente ativa-a na área de cliente (serviço pagamentos/).
    let pedidoPlano = null;
    if (o.plano_escolhido && PLANOS_MENSAIS.includes(o.plano_escolhido) && pagPed.modo === 'simulado' && !pedidoPendente('plano', codigo)) {
      pedidoPlano = await pedidos.criar({ tipo: 'plano', cliente: codigo, utilizador: u, orcamentoId: o.id, dados: { cliente: codigo, plano: o.plano_escolhido, estado: 'ativo' } });
      auditar(u, 'pedido_plano', `cliente:${codigo}`, { pedido: pedidoPlano.id, plano: o.plano_escolhido, estado: 'ativo', origem: 'plano escolhido ao aceitar (subscrição simulada)' }, ip);
    }
    responder(res, 201, {
      pedido_plano: pedidoPlano,
      cliente: codigo, cliente_existia: existe, pedido, aparelhos: pedidosAparelhos,
      obra: formatarObra(db.prepare('SELECT * FROM obras WHERE id = ?').get(obraId), fichas()),
    });
  };

  // ---- relatório técnico e fim da obra (pagamentos do pedido, docs/PAGAMENTOS-PEDIDO.md)
  const emailDaConta = (contaId) => (contaId ? db.prepare('SELECT email FROM contas WHERE id = ?').get(contaId)?.email ?? null : null);
  const ligacaoConta = () => (config.siteUrl ? ['', `A sua conta: ${config.siteUrl}/conta.html`] : []);

  // O relatório (versão do cliente) só aparece na conta depois de o CEO o rever e libertar.
  h.libertarRelatorio = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    const o = naoArquivado(obterOrcamento(params.id));
    if (!o.simulacao) throw new ErroApi(409, 'Este pedido não tem simulação: não há relatório para libertar.');
    if (o.relatorio_libertado) throw new ErroApi(409, 'O relatório já foi libertado ao cliente.');
    // Fase 3: só depois de o cliente o comprar (com os pagamentos desligados não se compra: o CEO decide).
    if (pagPed.ativo && !pagPed.temRelatorio(o)) throw new ErroApi(409, 'O cliente ainda não comprou o relatório completo.');
    const agora = agoraIso();
    db.prepare('UPDATE orcamentos SET relatorio_libertado = ?, atualizado = ? WHERE id = ? AND relatorio_libertado IS NULL').run(agora, agora, o.id);
    auditar(u, 'relatorio_libertado', `orcamento:${o.id}`, null, ip);
    const email = emailDaConta(o.conta_id);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: o seu relatório técnico está pronto', resumo: `relatório do pedido ${o.id} libertado`,
        texto: ['Olá,', '', `O relatório técnico do seu pedido n.º ${o.id} já foi revisto pela nossa equipa e está na sua conta.`, ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Fase 3: "Marcar visita" — a data e a hora da visita técnica (paga, ou a da avaria). Passa a "Visita marcada" (se ainda
  // estava antes disso) e avisa o cliente por email; a conta mostra a data.
  h.marcarVisita = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['data_visita']);
    const o = naoArquivado(obterOrcamento(params.id));
    const quando = diaHora(v.data_visita, 'a data da visita');
    if (!quando || !/T\d{2}:\d{2}/.test(quando)) falha('Indique o dia e a hora da visita.');
    if (o.cliente || ['aceite', 'perdido'].includes(o.estado)) throw new ErroApi(409, 'Este pedido já não tem visita técnica.');
    const agora = agoraIso();
    const estado = ['novo', 'contactado'].includes(o.estado) ? 'visita_marcada' : o.estado;
    db.prepare('UPDATE orcamentos SET data_visita = ?, estado = ?, visita_faltou = NULL, atualizado = ? WHERE id = ?').run(quando, estado, agora, o.id);
    auditar(u, 'visita_marcada', `orcamento:${o.id}`, { data_visita: quando, estado }, ip);
    const email = emailDaConta(o.conta_id);
    if (email) {
      // A data é a hora de Lisboa sem fuso (datetime-local): formata-se tal e qual.
      const txt = new Date(`${quando}:00Z`).toLocaleString('pt-PT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      correio.enviar({ para: email, assunto: 'Domus Energia: visita técnica marcada', resumo: `visita do pedido ${o.id} marcada para ${quando}`,
        texto: ['Olá,', '', `A visita técnica do seu pedido n.º ${o.id} está marcada para ${txt}.`, 'Se não puder, responda a este email ou ligue-nos.',
          ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // "Cliente faltou" (decisão 10 do dono): o técnico foi e o cliente não estava (ou cancelou em cima da hora). A visita
  // (ou o diagnóstico da avaria) não é devolvida nem descontada no sinal: o pagamento fica marcado (`faltou`), a falta
  // fica registada (auditoria), a data sai e o cliente é avisado. Para avançar, o cliente marca e paga uma visita nova.
  h.visitaFaltou = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    const o = naoArquivado(obterOrcamento(params.id));
    if (!pagPed.temVisita(o)) throw new ErroApi(409, 'Este pedido não tem uma visita paga.');
    if (o.visita_faltou) throw new ErroApi(409, 'A falta já está registada.');
    const falta = pagPed.faltaParaVisita(o);
    if (falta === null) throw new ErroApi(409, 'A visita ainda não tem data marcada.');
    if (falta > 0) throw new ErroApi(409, 'A visita ainda não aconteceu.');
    const agora = agoraIso();
    const ref = pagPed.marcarFalta(o);
    db.prepare("UPDATE orcamentos SET visita_faltou = ?, data_visita = NULL, estado = CASE WHEN estado = 'visita_marcada' THEN 'contactado' ELSE estado END, atualizado = ? WHERE id = ?").run(agora, agora, o.id);
    auditar(u, 'visita_faltou', `orcamento:${o.id}`, { data_visita: o.data_visita, devolvido: false, ...(ref ? { ref } : {}) }, ip);
    const email = emailDaConta(o.conta_id);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: não o encontrámos na visita', resumo: `visita do pedido ${o.id}: cliente faltou`,
        texto: ['Olá,', '', `O nosso técnico foi à visita do seu pedido n.º ${o.id} e não o encontrou.`,
          'Como dizem os Termos, uma visita a que falta (ou cancelada com menos de 24 h) não é devolvida nem descontada na obra. Para avançar, marque e pague uma visita nova na sua conta.',
          ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // "Cancelar obra e devolver sinal" (só CEO): antes de a obra ser feita. Devolve o sinal (todo, ou `valor`: o sinal
  // menos o material já encomendado e os serviços prestados), o pedido fica "perdido", a obra cancelada (não se apaga)
  // e o material reservado é libertado.
  h.devolverSinal = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['valor', 'motivo']);
    const o = naoArquivado(obterOrcamento(params.id));
    if (o.cliente) throw new ErroApi(409, 'Este pedido já foi convertido em cliente e obra.');
    const valor = v.valor === undefined || v.valor === null ? null : paraCent(numero(v.valor, 'o valor a devolver', { min: 0.01, max: 1_000_000, nulo: false }));
    const motivo = texto(v.motivo, 'o motivo', { max: 500, multilinha: true }) ?? 'Obra cancelada: sinal devolvido.';
    const r = await pagPed.devolverSinal(o, valor);
    const agora = agoraIso();
    db.prepare("UPDATE orcamentos SET estado = 'perdido', motivo_perda = ?, atualizado = ? WHERE id = ?").run(motivo, agora, o.id);
    stock.libertar(o.id, u.email, 'sinal devolvido');
    cancelarObraDoPedido(o, u, ip);
    auditar(u, 'sinal_devolvido', `orcamento:${o.id}`, { ref: r.ref, devolvido: deCent(r.cent), modo: r.modo, estado: 'perdido', ...(r.manual ? { manual: true } : {}) }, ip);
    const email = emailDaConta(o.conta_id);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: sinal devolvido', resumo: `sinal do pedido ${o.id} devolvido (${deCent(r.cent)} €)`,
        texto: ['Olá,', '', `A obra do seu pedido n.º ${o.id} foi cancelada.`,
          r.manual ? `Como pagou por referência Multibanco, devolvemos ${deCent(r.cent).toFixed(2).replace('.', ',')} € do sinal por transferência bancária: indique o IBAN na sua conta.`
            : `Devolvemos ${deCent(r.cent).toFixed(2).replace('.', ',')} € do sinal para o mesmo meio de pagamento (até 14 dias)${r.modo === 'simulado' ? ' (SIMULAÇÃO: não foi cobrado nem devolvido nada)' : ''}.`,
          ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Ensaios medidos na visita/obra (relatório completo, lista de ensaios): continuidade do PE (Ω), isolamento (MΩ),
  // terra (Ω) e disparo do diferencial (ms), mais notas. Um valor vazio apaga a medição; o cliente vê-os no relatório.
  h.registarEnsaios = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, [...CHAVES_ENSAIOS, 'notas']);
    const o = naoArquivado(obterOrcamento(params.id));
    if (!o.simulacao) throw new ErroApi(409, 'Este pedido não tem simulação: não há lista de ensaios.');
    const ROTULO = { continuidade_pe: 'a continuidade do PE (Ω)', isolamento: 'a resistência de isolamento (MΩ)', terra: 'a resistência de terra (Ω)', diferencial: 'o tempo de disparo do diferencial (ms)' };
    const ens = {};
    for (const k of CHAVES_ENSAIOS) ens[k] = numero(v[k], ROTULO[k], { min: 0, max: 1_000_000, casas: 3 });
    ens.notas = texto(v.notas, 'as notas dos ensaios', { max: 1000, multilinha: true });
    const agora = agoraIso();
    ens.data = agora;
    db.prepare('UPDATE orcamentos SET ensaios = ?, atualizado = ? WHERE id = ?').run(JSON.stringify(ens), agora, o.id);
    auditar(u, 'ensaios_registados', `orcamento:${o.id}`, Object.fromEntries(CHAVES_ENSAIOS.map((k) => [k, ens[k]])), ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Esquema do quadro elétrico feito pelo eletricista a partir da foto do cliente (ronda B; docs/PAINEL-EMPRESA.md
  // "Esquema do quadro"): o corpo é o esquema (validar.js esquemaQuadro; normalizado como no editor), guardado em
  // `orcamentos.esquema_quadro` com a data e quem o fez; `null`/`{}` apaga. Só no relatório completo do cliente.
  h.guardarEsquemaQuadro = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['esquema'], 64 * 1024);
    const o = naoArquivado(obterOrcamento(params.id));
    const agora = agoraIso();
    let guardado = null;
    if (v.esquema !== undefined && v.esquema !== null) {
      validarEsquemaQuadro(v.esquema);
      guardado = { ...normalizarEsquema(v.esquema), data: agora, por: u.email };
    }
    db.prepare('UPDATE orcamentos SET esquema_quadro = ?, atualizado = ? WHERE id = ?').run(guardado ? JSON.stringify(guardado) : null, agora, o.id);
    auditar(u, 'esquema_quadro_atualizado', `orcamento:${o.id}`, guardado ? {
      geral: guardado.disjuntor_geral?.amperes ?? null, diferenciais: guardado.diferenciais.length, disjuntores: guardado.disjuntores.length,
      modulos_livres: guardado.modulos_livres, estado: guardado.estado,
    } : { apagado: true }, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Diagnóstico de avarias (docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): a lista de verificação, as medições, o tipo
  // de avaria encontrado e a conclusão (validar.js diagnostico), guardados em `orcamentos.diagnostico` com a data e quem
  // o fez; `null` apaga. O relatório técnico mostra-o; o cliente vê-o só no relatório completo.
  h.guardarDiagnostico = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['diagnostico']);
    const o = naoArquivado(obterOrcamento(params.id));
    const agora = agoraIso();
    const guardado = v.diagnostico === undefined || v.diagnostico === null ? null : { ...validarDiagnostico(v.diagnostico), data: agora, por: u.email };
    db.prepare('UPDATE orcamentos SET diagnostico = ?, atualizado = ? WHERE id = ?').run(guardado ? JSON.stringify(guardado) : null, agora, o.id);
    auditar(u, 'diagnostico_atualizado', `orcamento:${o.id}`, guardado
      ? { verificacoes: guardado.verificacoes.length, tipo: guardado.tipo, conclusao: Boolean(guardado.conclusao) } : { apagado: true }, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // Assistente (IA) do pedido (assistente.js; docs/ASSISTENTE-IA.md): ao modelo vão só os dados técnicos (sem nome,
  // contactos nem morada; da localidade só o concelho). O resultado fica em `orcamentos.ia` e não mexe em mais nada.
  const limiteIa = new LimiteTaxa(config.limiteIaDia, 24 * 3600_000, relogio);
  const iaDe = (o) => {
    if (!o?.ia) return {};
    try { const v = JSON.parse(o.ia); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  async function pedirIa(tipo, { req, res, u, params, ip }) {
    // O rascunho do email leva o que a pessoa da equipa quer dizer (é ela que dá os factos; o modelo só redige).
    const instrucao = tipo === 'resposta' ? texto((await lerJson(req, ['instrucao'])).instrucao, 'o que quer dizer ao cliente', { max: 1000, multilinha: true, obrigatorio: true }) : null;
    const o = naoArquivado(obterOrcamento(params.id));
    if (!ctx.assistente) throw new ErroApi(503, 'Assistente desligado: o servidor não tem a chave ANTHROPIC_API_KEY.');
    const sim = o.simulacao ? JSON.parse(o.simulacao) : null;
    const leitura = fotos.leituraQuadro(o);
    const local = [sim?.deslocacao?.concelho, o.localidade].find((x) => typeof x === 'string' && NOMES_CONCELHOS.has(x.trim()));
    const dadosIa = dadosParaIa(o, {
      simulacao: sim, catalogo: artigosDaSimulacao(sim), concelho: local?.trim() ?? null, leitura: leitura?.leitura ?? null,
      esquema: esquemaQuadroDe(o), ensaios: pagPed.ensaiosDe(o), diagnostico: pagPed.diagnosticoDe(o),
    });
    if (JSON.stringify(dadosIa).length > MAX_DADOS_IA) throw new ErroApi(413, 'Este pedido é demasiado grande para o assistente.');
    const espera = limiteIa.espera('todos');
    if (espera) throw new ErroApi(429, `O assistente já foi usado ${config.limiteIaDia} vezes nas últimas 24 horas (limite LIMITE_IA_DIA). Tente mais tarde.`, { 'Retry-After': String(espera) });
    limiteIa.registar('todos');
    let r;
    try {
      r = await ctx.assistente.pedir(tipo, dadosIa, ` (orçamento ${o.id})`, instrucao);
    } catch (e) {
      if (e instanceof ErroAssistente) throw new ErroApi(502, `O assistente não conseguiu responder (${e.message}). Tente outra vez.`);
      throw e;
    }
    const custo = { modelo: r.modelo, tokens_entrada: r.uso.entrada, tokens_saida: r.uso.saida, custo_usd: r.custo_usd };
    if (tipo === 'resposta') {
      // O rascunho não se guarda: vai para o formulário, onde é revisto antes de "Enviar email".
      auditar(u, 'ia_resposta', `orcamento:${o.id}`, custo, ip);
      return responder(res, 200, { ...r.resultado, modelo: r.modelo, custo_usd: r.custo_usd });
    }
    const agora = agoraIso();
    const ia = { ...iaDe(obterOrcamento(params.id)), [tipo]: { ...r.resultado, data: agora, por: u.email, modelo: r.modelo, custo_usd: r.custo_usd } };
    db.prepare('UPDATE orcamentos SET ia = ? WHERE id = ?').run(JSON.stringify(ia), o.id);
    auditar(u, `ia_${tipo}`, `orcamento:${o.id}`, custo, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  }
  h.iaResumo = (c) => pedirIa('resumo', c);
  h.iaDiagnostico = (c) => pedirIa('diagnostico', c);
  h.iaResposta = (c) => pedirIa('resposta', c);

  // "Escrever ao cliente" (docs/ASSISTENTE-IA.md §8): envia o email que a pessoa da equipa reviu, pelo remetente dos
  // outros emails, para o email do cliente do pedido (emails-auto.js destinatario) e regista-o na ficha do CRM como
  // contacto "email" (um pedido "novo" passa a "contactado"). O texto não vai para a auditoria nem para o registo.
  const limiteMensagens = new LimiteTaxa(30, 3600_000, relogio);   // por utilizador
  h.enviarMensagem = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['assunto', 'texto']);
    const o = naoArquivado(obterOrcamento(params.id));
    const para = emailsAuto.destinatario(o);
    if (!para) throw new ErroApi(409, 'Este pedido não tem um email do cliente para onde enviar.');
    const assunto = texto(v.assunto, 'o assunto', { max: 150, obrigatorio: true });
    const corpo = texto(v.texto, 'a mensagem', { max: 5000, multilinha: true, obrigatorio: true });
    const espera = limiteMensagens.espera(u.id);
    if (espera) throw new ErroApi(429, 'Enviou muitos emails seguidos. Tente daqui a pouco.', { 'Retry-After': String(espera) });
    limiteMensagens.registar(u.id);
    // Com conta, o email leva no fim a ligação para o cliente responder na conta (a resposta entra na ficha do pedido).
    const rodape = o.conta_id && config.siteUrl ? `\n\nPara responder, entre na sua conta: ${config.siteUrl}/conta.html#pedido-${o.id}` : '';
    if (!(await correio.enviar({ para, assunto, texto: `${corpo}${rodape}`, resumo: `mensagem ao cliente do pedido ${o.id}` }))) {
      throw new ErroApi(502, 'O email não foi enviado (falha no servidor de email). Tente outra vez.');
    }
    db.prepare("INSERT INTO mensagens_pedido (orcamento_id, de, assunto, texto, por_email, criado) VALUES (?, 'equipa', ?, ?, ?, ?)").run(o.id, assunto, corpo, u.email, agoraIso());
    crm.registarEmailEnviado(o.id, `${assunto}\n\n${corpo}`, u, ip);
    auditar(u, 'mensagem_enviada', `orcamento:${o.id}`, { caracteres: corpo.length }, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  // "Pré-visualizar versão do cliente" (CEO, antes de "Libertar"): o mesmo relatório que a conta vai ver.
  h.previaRelatorioCliente = ({ res, params }) => {
    const o = obterOrcamento(params.id);
    if (!o.simulacao) throw new ErroApi(409, 'Este pedido não tem simulação: não há relatório para o cliente.');
    responder(res, 200, { relatorio: pagPed.relatorioCliente(o) });
  };

  // Obra concluída: o cliente passa a ver "Pagar o restante" na conta.
  h.obraConcluida = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    concluirObra(naoArquivado(obterOrcamento(params.id)), u, ip);
    responder(res, 200, formatarOrcamento(obterOrcamento(params.id), true));
  };

  /** Marca a obra de um pedido como concluída (o botão do painel e a aprovação do trabalho de um eletricista externo). */
  function concluirObra(o, u, ip) {
    if (o.estado !== 'aceite') throw new ErroApi(409, 'Só um pedido aceite (com o sinal pago) pode ter a obra concluída.');
    if (o.obra_concluida) throw new ErroApi(409, 'A obra já está marcada como concluída.');
    const agora = agoraIso();
    db.prepare('UPDATE orcamentos SET obra_concluida = ?, atualizado = ? WHERE id = ?').run(agora, agora, o.id);
    if (o.obra_id) db.prepare("UPDATE obras SET estado = 'concluida', atualizado = ? WHERE id = ? AND estado != 'cancelada'").run(agora, o.obra_id);
    // Stock: o material da obra sai do armazém (e a reserva fecha).
    stock.saida(o, u.email);
    const v = pagPed.valores({ ...o, obra_concluida: agora });
    auditar(u, 'obra_concluida', `orcamento:${o.id}`, { restante: deCent(v.restante) }, ip);
    const email = emailDaConta(o.conta_id);
    if (email && v.restante > 0) {
      correio.enviar({ para: email, assunto: 'Domus Energia: obra concluída', resumo: `obra do pedido ${o.id} concluída; restante ${deCent(v.restante)} €`,
        texto: ['Olá,', '', `A obra do seu pedido n.º ${o.id} está concluída. Pode pagar o restante (${deCent(v.restante).toFixed(2).replace('.', ',')} €, com IVA) na sua conta.`,
          'A app da casa fica ativa depois de pagar o restante.',
          `Proposta: ${deCent(v.base).toFixed(2).replace('.', ',')} € + IVA ${String(v.iva_pct).replace('.', ',')} % (${deCent(v.iva).toFixed(2).replace('.', ',')} €) = ${deCent(v.total).toFixed(2).replace('.', ',')} €, menos o que já pagou.`,
          ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
  }

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
    // Obra criada com o sinal pago, com data provisória: escolher a data agenda-a.
    if (r.data !== undefined && o.por_agendar) r.por_agendar = 0;
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
    // Stock: obra concluída → o material do pedido sai do armazém; obra cancelada → a reserva é libertada.
    if (r.estado && r.estado !== o.estado && o.orcamento_id) {
      const orc = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.orcamento_id);
      if (orc && r.estado === 'concluida') stock.saida(orc, u.email);
      else if (orc && r.estado === 'cancelada') stock.libertar(orc.id, u.email, 'obra cancelada');
    }
    // Concluída aqui (ecrã Obras) sem "Obra concluída" no pedido: o cliente NÃO é avisado nem o restante pedido; nasce a
    // tarefa "Confirmar obra concluída" para os CEO (decisão do dono; docs/CRM-TAREFAS.md). Sai sozinha ao confirmar.
    if (r.estado === 'concluida' && r.estado !== o.estado) tarefas.obraPorConfirmar(o.id);
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

  // ---- pagamentos dos pedidos (relatório, visita, avaria, sinal, restante; só CEO): lista e CSV (data, referência, descrição, base,
  // IVA, total, estado, pedido). Os pedidos anonimizados (RGPD) continuam ligados: a contabilidade fica completa.
  h.pagamentosPedido = ({ res, url }) => {
    const mes = url.searchParams.get('mes');
    if (mes !== null && !/^\d{4}-\d{2}$/.test(mes)) falha('Mês inválido (AAAA-MM).');
    const estado = url.searchParams.get('estado');
    if (estado !== null) opcao(estado, 'estado', ESTADOS_PAGAMENTO);
    const linhas = pagPed.listarTodos({ estado, mes });
    if (url.searchParams.get('formato') === 'csv') {
      const seguro = (s) => (/^[=+\-@\t\r]/.test(String(s ?? '')) ? `'${s}` : String(s ?? '')).replace(/[;\r\n"]/g, ' ');
      const dec = (n) => (n == null ? '' : n.toFixed(2).replace('.', ','));
      const csv = ['data;referencia;descricao;base;iva;total;estado;pedido']
        // Uma devolução (visita cancelada, sinal devolvido) vai numa linha própria, a negativo, com a data dela.
        .concat(linhas.flatMap((l) => [[l.data, l.ref, seguro(l.descricao), dec(l.base), dec(l.iva), dec(l.valor), l.estado, l.orcamento_id ?? ''].join(';'),
          ...(l.devolvido ? [[l.devolvido_em ?? l.data, l.ref, seguro(`Devolução: ${l.descricao}`), dec(-l.devolvido_base), dec(-l.devolvido_iva), dec(-l.devolvido), 'devolucao', l.orcamento_id ?? ''].join(';')] : [])]))
        // Eletricistas externos (docs/ELETRICISTAS.md): o que se lhes deve e o que já foi pago, em linhas próprias, a
        // negativo (é uma despesa, sem IVA) e com o estado `eletricista_…`: não entram nos totais dos clientes.
        .concat(estado ? [] : pagEletricistas(mes).linhas.map((l) => [l.data, l.ref, seguro(l.descricao), dec(-l.valor), '', dec(-l.valor), l.estado, l.orcamento_id ?? ''].join(';')))
        .join('\r\n');
      const corpo = Buffer.from(`﻿${csv}\r\n`);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pagamentos-pedidos${mes ? `-${mes}` : ''}.csv"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': corpo.length,
      });
      return res.end(corpo);
    }
    // Totais: o que ficou pago, já sem as devoluções parciais (uma devolução total deixa o pagamento "devolvido").
    const pagos = linhas.filter((l) => l.estado === 'pago');
    const soma = (k, dev) => deCent(pagos.reduce((s, l) => s + paraCent(l[k]) - paraCent(l[dev] ?? 0), 0));
    responder(res, 200, {
      pagamentos: linhas, total_pago: { pagamentos: pagos.length, base: soma('base', 'devolvido_base'), iva: soma('iva', 'devolvido_iva'), total: soma('valor', 'devolvido') },
      // Devoluções por transferência ainda por fazer (pagamentos por Multibanco): valor, IBAN e titular, para o CEO.
      devolucoes_por_fazer: pagPed.devolucoesPorFazer(),
      // Eletricistas externos: o que se deve e o que já se pagou (sem IVA), à parte da receita dos clientes; null sem o módulo.
      eletricistas: config.eletricistas ? { a_pagar: pagEletricistas(mes).a_pagar, pago: pagEletricistas(mes).pago } : null,
    });
  };
  const pagEletricistas = (mes) => (config.eletricistas ? eletricistas.resumoPagamentos(mes) : { linhas: [], a_pagar: null, pago: null });

  // "Devolvido": o CEO fez a transferência de uma devolução manual (pagamento por referência Multibanco). Fica a data e
  // quem; só agora conta como devolvido nos totais e no CSV. O IBAN não vai para a auditoria.
  h.devolucaoFeita = async ({ req, res, u, params, ip }) => {
    await lerJson(req, []);
    const d = pagPed.marcarDevolvida(idNum(params.id), u.email);
    auditar(u, 'devolucao_feita', d.orcamento_id ? `orcamento:${d.orcamento_id}` : `conta:${d.conta_id}`, { devolucao: d.id, ref: d.ref, valor: d.valor }, ip);
    const email = emailDaConta(d.conta_id);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: devolução feita', resumo: `devolução ${d.id} feita (${d.valor} €)`,
        texto: ['Olá,', '', `Fizemos a transferência de ${d.valor.toFixed(2).replace('.', ',')} € para a conta que indicou (${d.iban}).`, ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, { devolucao: { ...d, conta_id: undefined }, devolucoes_por_fazer: pagPed.devolucoesPorFazer() });
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
    // Horas ao substituir (lote 7); null = 50 % das de instalação.
    if (v.horas_troca !== undefined) r.horas_troca = v.horas_troca === null ? null : numero(v.horas_troca, 'as horas de troca', { max: 100 });
    if (v.especificacoes !== undefined) {
      const e = v.especificacoes;
      if (!e || typeof e !== 'object' || Array.isArray(e)) falha('As especificações têm de ser um objeto JSON.');
      const j = JSON.stringify(e);
      if (Buffer.byteLength(j) > 8192) falha('Especificações demasiado grandes (máx. 8 KB).');
      r.especificacoes = j;
    }
    if (v.ativo !== undefined) r.ativo = booleano(v.ativo, 'ativo') ? 1 : 0;
    if (v.visivel_cliente !== undefined) r.visivel_cliente = booleano(v.visivel_cliente, 'visivel_cliente') ? 1 : 0;
    // Stock (migração 22): só o mínimo se edita aqui; a quantidade muda por movimentos (POST catalogo/:id/stock).
    if (v.stock_minimo !== undefined) r.stock_minimo = numero(v.stock_minimo, 'o stock mínimo', { max: 1_000_000, casas: 0, nulo: false });
    return r;
  }
  const CAMPOS_ARTIGO = ['sku', 'nome', 'categoria', 'fornecedor', 'link', 'preco_compra', 'preco_venda_iva', 'horas_instalacao', 'horas_troca', 'especificacoes', 'ativo', 'visivel_cliente', 'stock_minimo'];

  // ---- stock (só CEO; stock.js): os artigos (abaixo do mínimo primeiro) e os últimos movimentos
  h.stock = ({ res }) => responder(res, 200, stock.listar());

  // "Entrada de stock" (quantidade > 0; com o custo real de compra: preço + transporte + alfândega) ou "acerto"
  // (inventário: quantidade com sinal).
  h.movimentoStock = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['qtd', 'motivo', 'nota', 'preco_compra']);
    const motivo = opcao(v.motivo, 'motivo', ['entrada', 'acerto']);
    const qtd = numero(v.qtd, 'a quantidade', { min: motivo === 'entrada' ? 1 : -1_000_000, max: 1_000_000, casas: 0, nulo: false });
    if (qtd === 0) falha('A quantidade não pode ser 0.');
    const nota = texto(v.nota, 'a nota', { max: 200 });
    const custo = v.preco_compra === undefined || v.preco_compra === null ? null : paraCent(numero(v.preco_compra, 'o custo de compra', { max: 100_000, nulo: false }));
    const id = idNum(params.id);
    if (!db.prepare('SELECT 1 FROM catalogo WHERE id = ?').get(id)) throw new ErroApi(404, 'Artigo não encontrado.');
    if (custo !== null) db.prepare('UPDATE catalogo SET preco_compra_cent = ? WHERE id = ?').run(custo, id);
    const a = stock.movimentar(id, { qtd, motivo, nota }, u.email);
    auditar(u, 'stock_movimento', `catalogo:${a.id}`, { sku: a.sku, motivo, qtd, ...(custo !== null ? { preco_compra: deCent(custo) } : {}) }, ip);
    responder(res, 201, formatarArtigo(a));
  };

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

  // `emails_auto_inicio` (só leitura): desde quando contam os emails automáticos ao cliente (migração 35).
  h.configOrcamento = ({ res }) => responder(res, 200, { ...lerConfigOrcamento(), emails_auto_inicio: emailsAuto.inicio() });

  h.atualizarConfigOrcamento = async ({ req, res, u, ip }) => {
    const v = await lerJson(req, [...Object.keys(CONFIG_ORCAMENTO), 'deslocacao_base', CHAVE_GOOGLE]);
    const mud = {};
    for (const [k, { rotulo, ...lim }] of Object.entries(CONFIG_ORCAMENTO)) {
      if (v[k] !== undefined) mud[k] = numero(v[k], rotulo, { ...lim, nulo: false });
      if (lim.inteiro && mud[k] !== undefined && !Number.isInteger(mud[k])) falha(`${rotulo[0].toUpperCase()}${rotulo.slice(1)}: tem de ser um número inteiro.`);
    }
    // Lembretes da proposta (CRM): cada etapa depois da anterior, contando com os valores que não mudam.
    if (Object.keys(mud).some((k) => k.startsWith('lembrete_proposta_'))) {
      const p = { ...PRAZOS_LEMBRETES, ...lerConfigOrcamento(), ...mud };
      if (!(p.lembrete_proposta_1_dias < p.lembrete_proposta_2_dias && p.lembrete_proposta_2_dias < p.lembrete_proposta_3_dias)) falha('Os três prazos da proposta têm de ser crescentes (ex.: 3, 7 e 14 dias).');
    }
    // Lembretes do pagamento em falta (emails automáticos): o segundo depois do primeiro.
    if (mud.email_pagamento_1_dias !== undefined || mud.email_pagamento_2_dias !== undefined) {
      const p = { ...PRAZOS_EMAILS, ...lerConfigOrcamento(), ...mud };
      if (!(p.email_pagamento_1_dias < p.email_pagamento_2_dias)) falha('O segundo lembrete do pagamento em falta tem de ser depois do primeiro (ex.: 3 e 7 dias).');
    }
    // Ligação da avaliação no Google (texto): vazia ou null tira-a (sem ela não há convite em lado nenhum).
    let semGoogle = false;
    if (v[CHAVE_GOOGLE] !== undefined) {
      if (v[CHAVE_GOOGLE] === null || v[CHAVE_GOOGLE] === '') semGoogle = true;
      else {
        mud[CHAVE_GOOGLE] = urlGoogle(v[CHAVE_GOOGLE]);
        if (!mud[CHAVE_GOOGLE]) falha('A ligação da avaliação no Google tem de ser um endereço https do Google (ex.: https://g.page/r/…/review).');
      }
    }
    if (v.deslocacao_base !== undefined) {
      if (typeof v.deslocacao_base !== 'string' || !NOMES_CONCELHOS.has(v.deslocacao_base)) falha('A base da deslocação tem de ser um dos 308 concelhos (nome da lista).');
      mud.deslocacao_base = v.deslocacao_base;
    }
    if (!Object.keys(mud).length && !semGoogle) falha('Nada para alterar.');
    for (const [k, val] of Object.entries(mud)) db.prepare('INSERT INTO config_orcamento (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, val);
    if (semGoogle) db.prepare('DELETE FROM config_orcamento WHERE chave = ?').run(CHAVE_GOOGLE);
    auditar(u, 'config_orcamento_atualizada', 'config-orcamento', semGoogle ? { ...mud, [CHAVE_GOOGLE]: null } : mud, ip);
    responder(res, 200, lerConfigOrcamento());
  };

  // ---- contas de cliente (só CEO): ver, desativar/reativar, apagar com os dados pessoais (RGPD)
  h.contas = ({ res }) => responder(res, 200, { contas: contas.listar() });

  h.atualizarConta = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['ativo']);
    const ativo = booleano(v.ativo, 'ativo');
    const c = contas.definirAtivo(params.id, ativo);
    auditar(u, ativo ? 'conta_reativada' : 'conta_desativada', `conta:${c.id}`, null, ip);
    responder(res, 200, { contas: contas.listar() });
  };

  // Apagar (RGPD): irreversível, por isso o CEO escreve o email da conta para confirmar.
  h.apagarConta = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['email']);
    const alvo = db.prepare('SELECT email FROM contas WHERE id = ?').get(idNum(params.id));
    if (!alvo) throw new ErroApi(404, 'Conta não encontrada.');
    if (typeof v.email !== 'string' || v.email.trim().toLowerCase() !== String(alvo.email).toLowerCase()) {
      falha('Para confirmar, escreva o email da conta que quer apagar.');
    }
    const r = await contas.apagar(params.id);
    auditar(u, 'conta_apagada', `conta:${r.conta}`, { pedidos_apagados: r.pedidos_apagados, pedidos_anonimizados: r.pedidos_anonimizados, pedidos_mantidos: r.pedidos_mantidos }, ip);
    responder(res, 200, { ...r, contas: contas.listar() });
  };

  // ---- eletricistas externos (só CEO; docs/ELETRICISTAS.md): candidaturas, aprovar/recusar/suspender/reativar,
  // concelhos e percentagem da mão de obra; o documento do seguro; atribuir um pedido ou pô-lo na bolsa.
  h.eletricistas = ({ res }) => responder(res, 200, eletricistas.listar());

  h.eletricista = ({ res, params }) => responder(res, 200, { eletricista: eletricistas.paraPainel(eletricistas.obter(params.id)) });

  h.atualizarEletricista = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['acao', 'concelhos', 'percentagem']);
    const e = eletricistas.atualizar(params.id, v, u, ip);
    responder(res, 200, { eletricista: eletricistas.paraPainel(e), ...eletricistas.listar() });
  };

  // O documento do seguro: só PDF/JPEG/PNG (o tipo foi verificado pelos bytes ao receber), sem que o navegador o possa
  // interpretar como outra coisa (nosniff, CSP sandbox); o PDF descarrega-se (attachment), a imagem abre.
  h.seguroEletricista = async ({ res, params }) => {
    const d = await eletricistas.seguro(params.id);
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': d.tipo, 'Content-Length': d.corpo.length,
      'Content-Disposition': `${d.tipo === 'application/pdf' ? 'attachment' : 'inline'}; filename="seguro-eletricista-${d.id}.${d.extensao}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(d.corpo);
  };

  // Apagar (RGPD): irreversível, por isso o CEO escreve o email do eletricista para confirmar (como nas contas de cliente).
  h.apagarEletricista = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['email']);
    const alvo = eletricistas.obter(params.id);
    if (typeof v.email !== 'string' || v.email.trim().toLowerCase() !== String(alvo.email).toLowerCase()) falha('Para confirmar, escreva o email do eletricista que quer apagar.');
    const r = await eletricistas.apagar(params.id, u, ip);
    responder(res, 200, { ...r, ...eletricistas.listar() });
  };

  // Foto que o eletricista tirou na obra (antes / depois): só o CEO, com o tipo certo e sem que o navegador a interprete.
  h.fotoTrabalhoEletricista = async ({ res, params }) => {
    const f = await eletricistas.fotoParaPainel(params.id, params.foto);
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': f.tipo, 'Content-Length': f.corpo.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(f.corpo);
  };

  // Pagamentos a eletricistas (ronda 3): o que está por aprovar, a pagar (com o prazo, a fatura-recibo e o IBAN) e pago.
  h.pagamentosEletricistas = ({ res }) => responder(res, 200, eletricistas.pagamentosPainel());

  // "Pago": o CEO fez a transferência (fica a data e quem). Só com as três condições cumpridas e a fatura-recibo.
  h.pagoEletricista = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['parte']);
    eletricistas.marcarPago(params.id, u, ip, v.parte);
    responder(res, 200, eletricistas.pagamentosPainel());
  };

  // A fatura-recibo do eletricista: como o documento do seguro (tipo verificado pelos bytes, nosniff, CSP sandbox).
  h.faturaEletricista = async ({ res, params, url }) => {
    const d = await eletricistas.faturaParaPainel(params.id, url.searchParams.get('parte'));
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': d.tipo, 'Content-Length': d.corpo.length,
      'Content-Disposition': `${d.tipo === 'application/pdf' ? 'attachment' : 'inline'}; filename="fatura-recibo-${d.regresso ? 'ida-' : ''}trabalho-${d.id}.${d.extensao}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(d.corpo);
  };

  h.atribuicaoEletricista = ({ res, params }) => responder(res, 200, eletricistas.atribuicao(obterOrcamento(params.id)));

  // "Atribuir a…" (eletricista aprovado, com o concelho do pedido), "Pôr na bolsa" ou "Retirar" (em qualquer altura).
  h.atribuirEletricista = async ({ req, res, u, params, ip }) => {
    const v = await lerJson(req, ['acao', 'eletricista_id', 'motivo']);
    const o = naoArquivado(obterOrcamento(params.id));
    const acao = opcao(v.acao, 'ação', ['atribuir', 'bolsa', 'retirar', 'aprovar', 'devolver', 'defeito', 'sem_defeito']);
    if (acao === 'atribuir') eletricistas.atribuir(o, v.eletricista_id, u, ip);
    else if (acao === 'bolsa') eletricistas.porNaBolsa(o, u, ip);
    else if (acao === 'retirar') eletricistas.retirar(o, u, ip);
    // Ronda 3: aprovar o trabalho confirmado pelo cliente, devolvê-lo ao eletricista (com o motivo) ou decidir o "Não"
    // do cliente (defeito: o eletricista volta sem receber mais; sem defeito: o cliente paga uma visita).
    else eletricistas.decidir(o, acao, v.motivo, u, ip);
    responder(res, 200, eletricistas.atribuicao(obterOrcamento(params.id)));
  };

  // ------------------------------------------------------------ públicos
  async function orcamentoPublico(req, res, ip) {
    if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    // Tentar pagar de novo a avaria (falhou, cancelou ou ainda está por pagar) não gasta o limite por IP: a conta tem
    // uma tentativa nas últimas 24 h, que é reaproveitada ou substituída; há um limite próprio por conta.
    const sessaoConta = pagPed.ativo ? contas.sessao(req, res) : null;
    const retentativa = Boolean(sessaoConta?.confirmado) && pagPed.temTentativaRecente(sessaoConta.id);
    const espera = retentativa ? porContaRetentativa.espera(String(sessaoConta.id)) : Math.max(porIpOrcamento.espera(ip), global.espera('*'));
    if (espera) {
      registo.aviso(`orçamento: limite atingido (ip ${ip}${retentativa ? `, conta ${sessaoConta.id}, retentativas` : ''})`);
      throw new ErroApi(429, 'Recebemos vários pedidos seguidos deste endereço. Tente mais tarde ou contacte-nos por telefone.', { 'Retry-After': String(espera) });
    }
    if (retentativa) porContaRetentativa.registar(String(sessaoConta.id));
    else {
      porIpOrcamento.registar(ip);
      global.registar('*');
    }
    const v = await lerJson(req, ['nome', 'telefone', 'email', 'localidade', 'morada', 'servico', 'mensagem', 'website', 'codigo_cliente', 'simulacao', 'compra',
      'origem_contacto', 'origem_entrada'], LIMITE_ORCAMENTO);
    // Campo-armadilha: só robôs o preenchem. Responde como se tivesse corrido bem.
    if (v.website !== undefined && v.website !== null && v.website !== '') {
      registo.aviso(`orçamento: armadilha preenchida (ip ${ip}), descartado`);
      // Mesma resposta que um pedido verdadeiro (não denuncia a armadilha); o token não existe na base.
      return responder(res, 201, { ok: true, fotos_token: fotos.tokenFalso(), fotos_max: FOTOS_MAX });
    }
    // Com a simulação é preciso a conta de cliente com o email confirmado (docs/CONTA-CLIENTE.md); o pedido fica
    // ligado à conta e o email do pedido é o da conta. Sem simulação (formulário de contacto do site) não.
    let conta = null;
    if (v.simulacao !== undefined && v.simulacao !== null) {
      conta = contas.sessao(req, res);
      if (!conta) throw new ErroApi(401, 'Para enviar a simulação, crie uma conta ou entre na sua conta.');
      if (!conta.confirmado) throw new ErroApi(403, 'Confirme primeiro o seu email com o código que lhe enviámos.');
      v.email = conta.email;
    }
    const c = camposContacto(v, true);
    if (!c.telefone && !c.email) falha('Indique um telefone ou um email para o podermos contactar.');
    // Pedidos do simulador (com simulação; decisão do dono, 2026-10-03): telefone, localidade (concelho) e morada da obra
    // são obrigatórios, como no passo Enviar. O formulário de contacto do site (sem simulação) fica como estava: nome e
    // telefone ou email. O telefone segue a regra de sempre (RE_TELEFONE: com ou sem +351/00351, com espaços).
    if (conta) {
      if (!c.telefone) falha('Falta o telefone: é obrigatório para enviar a simulação.');
      if (!c.localidade) falha('Falta a localidade (concelho) da obra: é obrigatória para enviar a simulação.');
      if (!c.morada) falha('Falta a morada da obra: é obrigatória para enviar a simulação.');
    }
    const codigoCli = texto(v.codigo_cliente, 'o código de cliente', { max: 32, re: RE_ID, reMsg: 'Código de cliente inválido.' });
    const sim = validarSimulacao(v.simulacao);
    // Fase 3 (docs/PAGAMENTOS-PEDIDO.md): o que o cliente compra no passo Enviar — só o relatório básico (grátis), o
    // relatório completo, a visita técnica, ou os dois. O valor é sempre o do servidor.
    const COMPRA = { basico: null, pormenorizado: 'relatorio_pormenorizado', visita: 'visita', pormenorizado_visita: 'pormenorizado_visita' };
    const compra = v.compra === undefined || v.compra === null ? 'basico' : opcao(v.compra, 'compra', Object.keys(COMPRA));
    if (compra !== 'basico' && !(conta && sim)) falha('Só se compra o relatório com a simulação.');
    let simObj = null;
    if (sim) { try { simObj = JSON.parse(sim); } catch { simObj = null; } }
    // Origem do contacto (CRM): só a categoria do canal (google, facebook, instagram, direto, outro), calculada no
    // navegador a partir do document.referrer, e a página de anúncio de entrada (`?servico=`). Nunca o endereço de onde
    // veio. Um valor desconhecido é ignorado (o pedido nunca falha por isto).
    const origem = {
      contacto: ORIGENS_CONTACTO.includes(v.origem_contacto) ? v.origem_contacto : null,
      entrada: ENTRADAS.includes(v.origem_entrada) ? v.origem_entrada : null,
    };
    // Avaria rápida = pagar o diagnóstico e a deslocação ao enviar: fica "a aguardar pagamento" (não aparece no painel)
    // e só passa a orçamento quando o pagamento for confirmado. Fora da área servida: 409 (fale connosco).
    if (conta && sim && pagPed.ativo && simObj?.funil === 'avaria') {
      const local = c.localidade ?? simObj?.casa?.localidade ?? null;
      const pagamento = await pagPed.iniciarAvaria({ conta, pedido: { c, codigoCli, sim, ip, origem }, localidade: local });
      registo.info(`avaria a aguardar pagamento (${pagamento.ref})`);
      return responder(res, 202, { ok: true, pagamento });
    }
    // O resto é grátis: passa logo a orçamento ("novo"), com o relatório básico na conta.
    const id = inserirOrcamentoSite({ c, codigoCli, sim, contaId: conta?.id ?? null, ip, origem });
    // Token para as fotos deste pedido (POST /api/orcamento/fotos, 30 min); sem fotos não é usado.
    const r = { ok: true, fotos_token: fotos.emitirToken(id), fotos_max: FOTOS_MAX };
    if (conta) r.pedido = id;
    // A compra vai a seguir, sobre o pedido que já existe: se falhar, o pedido fica (compra-se depois na conta).
    if (COMPRA[compra]) {
      try {
        r.pagamento = await pagPed.comprar(conta, db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id), COMPRA[compra]);
      } catch (e) {
        if (!(e instanceof ErroApi)) registo.erro(`orçamento ${id}: compra ${compra}: ${e?.stack || e}`);
        r.pagamento_erro = e instanceof ErroApi ? e.message : 'Não foi possível abrir o pagamento. Pode comprar na sua conta.';
      }
    }
    responder(res, 201, r);
  }

  /** Grava um pedido do site (formulário ou simulador); também quando o pagamento da avaria é confirmado. */
  function inserirOrcamentoSite({ c, codigoCli = null, sim = null, contaId = null, ip = null, pagamento = null, com_visita: comVisita = null, origem = null }) {
    const agora = agoraIso();
    const id = Number(db.prepare(`INSERT INTO orcamentos (criado, atualizado, origem, nome, telefone, email, localidade, morada, servico, mensagem, codigo_cliente, simulacao, conta_id,
      origem_contacto, origem_entrada)
      VALUES (?, ?, 'site', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(agora, agora, c.nome, c.telefone ?? null, c.email ?? null, c.localidade ?? null,
      c.morada ?? null, c.servico, c.mensagem ?? null, codigoCli ?? null, sim ?? null, contaId,
      ORIGENS_CONTACTO.includes(origem?.contacto) ? origem.contacto : null, ENTRADAS.includes(origem?.entrada) ? origem.entrada : null).lastInsertRowid);
    if (contaId) contas.aposOrcamento(contaId, c);
    auditar(contaId ? { id: null, email: `conta:${contaId}` } : null, 'orcamento_recebido', `orcamento:${id}`,
      { origem: 'site', simulacao: Boolean(sim), conta: Boolean(contaId), ...(pagamento ? { pagamento, visita: comVisita } : {}) }, ip);
    registo.info(`orçamento ${id} recebido`);
    // Boas-vindas (emails automáticos): logo ao receber, fora das horas de silêncio. A avaria paga ao enviar não as
    // recebe (o email "pagamento recebido" já confirma o pedido). Um erro aqui nunca falha o pedido.
    if (!pagamento) { try { emailsAuto.aoReceber(id); } catch (e) { registo.erro(`boas-vindas do orçamento ${id}: ${e?.stack || e}`); } }
    return id;
  }

  /** POST /api/orcamento/fotos: uma foto (bytes) por pedido; token, chave e legenda nos cabeçalhos. */
  async function fotoPublica(req, res, ip) {
    if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    const espera = porIpFotos.espera(ip);
    if (espera) {
      registo.aviso(`fotos: limite atingido (ip ${ip})`);
      throw new ErroApi(429, 'Recebemos demasiadas fotos seguidas deste endereço. Tente mais tarde.', { 'Retry-After': String(espera) });
    }
    porIpFotos.registar(ip);
    const f = await fotos.receber(req);
    responder(res, 201, { ok: true, id: f.id });
  }

  function catalogoPublico(req, res) {
    const itens = db.prepare('SELECT sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, horas_troca, especificacoes FROM catalogo WHERE ativo = 1 AND visivel_cliente = 1 ORDER BY categoria, nome').all()
      .map((a) => {
        // A "nota" é interna (ex.: "preço provisório — confirmar"): só o CEO a vê no painel.
        const { nota, ...especificacoes } = JSON.parse(a.especificacoes || '{}');
        return { sku: a.sku, nome: a.nome, categoria: a.categoria, preco_venda_iva: deCent(a.preco_venda_iva_cent), horas_instalacao: a.horas_instalacao, horas_troca: a.horas_troca ?? null, especificacoes };
      });
    const cfg = lerConfigOrcamento();
    const config = Object.fromEntries(CONFIG_PUBLICA.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
    // Pagamentos do pedido: o simulador mostra a faixa "Modo de demonstração" e as compras do passo Enviar (desligados: não há).
    const { ativo, modo, demonstracao } = pagPed.info();
    responder(res, 200, { itens, config, pagamentos: { ativo, modo, demonstracao } }, { 'Cache-Control': 'public, max-age=60' });
  }

  // ------------------------------------------------------------ despacho
  async function tratar(req, res, url) {
    const caminho = url.pathname;
    const ip = ipDe(req, config.confiarProxy);
    try {
      // Rotas públicas: CORS com credenciais só para o site público noutra origem (SITE_ORIGENS).
      if (!caminho.startsWith(P) && cors(req, res, config.siteOrigens)) return undefined;
      if (caminho.startsWith('/api/fotos-remotas') && await fotosRemotas.tratar(req, res, url, ip)) return undefined;
      // Sem o acesso rápido (sempre, no servidor) estes endereços seguem em frente e dão 404 como qualquer outro desconhecido.
      if (rapido && (caminho === ROTA_EQUIPA || caminho === ROTA_CLIENTE || caminho === ROTA_CONTAS || (caminho === ROTA_ELETRICISTA && config.eletricistas))) return await rapido.tratar(req, res, caminho, ip);
      // Sem ELETRICISTAS=1 o módulo não existe: /api/eletricista/* segue em frente e dá 404 como qualquer outro desconhecido.
      if (config.eletricistas && caminho.startsWith(API_ELETRICISTA)) return await eletricistas.tratar(req, res, url, ip);
      if (caminho.startsWith('/api/conta/')) {
        // "Não quero receber" dos emails automáticos: sem sessão e sem origem (o token assinado autoriza; RFC 8058).
        if (await emailsAuto.tratar(req, res, url)) return undefined;
        if (await pagPed.tratar(req, res, url, ip)) return undefined;
        return await contas.tratar(req, res, url, ip);
      }
      if (caminho === '/api/orcamento') {
        if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' });
        return await orcamentoPublico(req, res, ip);
      }
      if (caminho === '/api/orcamento/fotos') {
        if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' });
        return await fotoPublica(req, res, ip);
      }
      if (caminho === '/api/catalogo') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
        return catalogoPublico(req, res);
      }
      const resto = caminho.slice(P.length);
      const { rota, params, caminhoExiste } = encontrarRota(req.method, resto);
      if (!rota || (!config.eletricistas && ROTAS_ELETRICISTAS.has(rota.nome))) {
        if (!rota && caminhoExiste) return responder(res, 405, { erro: 'Método não permitido.' });
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

  return { tratar, auditar, fotos, fotosRemotas, contas, correio, pagamentosPedido: pagPed, eletricistas, crm, tarefas, emailsAuto, procedimentos };
}

