// Emails automáticos ao cliente (decisões do dono de 2026-10-03; docs/EMAILS-AUTOMATICOS.md). Só email. Quatro tipos:
// 1. boas-vindas — o pedido chegou e o que acontece a seguir (formulário do site ou simulador);
// 2. lembrete da visita — na véspera, à hora da configuração;
// 3. pagamento em falta — o sinal de uma proposta aceite ou o restante de uma obra concluída: um lembrete aos 3 dias,
//    outro aos 7 e, a seguir, uma tarefa para os CEO ("Ligar a … — pagamento em falta"); depois não sai mais nada;
// 4. depois da obra — 2 dias depois de concluída: um guia curto da conta e da área de cliente e o pedido de avaliação
//    (1 a 5 estrelas, na conta). É o único que leva "Não quero receber" (ligação assinada, sem sessão; RFC 8058).
// Cada envio fica em `emails_automaticos` com uma chave única, ANTES de enviar (nunca sai duas vezes, também depois de
// reiniciar o painel; um envio falhado não se repete) e sem o endereço nem o corpo. Corre na volta dos lembretes do CRM
// (tarefas.js, de 15 em 15 minutos) e, as boas-vindas, logo ao receber o pedido. Entre as 21:00 e as 08:00 de Lisboa não
// sai nada: fica para as 08:00. Pedidos anonimizados ou arquivados e contas apagadas nunca recebem nada. Só conta o que
// aconteceu depois da publicação (`emails_chave.inicio`, migração 35); o lembrete da visita vale para qualquer visita futura.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErroApi, responder, lerCorpo, CABECALHOS_SEGURANCA } from './http.js';
import { falha } from './validar.js';
import { ESTADO_ARQUIVADO } from './db.js';
import { iso, diaLisboa, somarDiasCivil } from './util.js';
import { horaLisboa, agoraLisboa } from './crm.js';

const DIA_MS = 24 * 3600_000;
/** Não se envia entre as 21:00 e as 08:00 (Lisboa): o que for devido fica para a primeira volta depois das 08:00. */
const SILENCIO_DE = '21:00', SILENCIO_ATE = '08:00';
/** As boas-vindas só fazem sentido logo: um pedido com mais de 24 h sem elas (painel parado) já não as recebe. */
const JANELA_BOAS_VINDAS_MS = DIA_MS;
/** Tolerância dos outros (painel parado, pagamento aberto): 7 dias depois de devido, o email já não sai. */
const JANELA_MS = 7 * DIA_MS;
/** Estados de um pedido ainda em curso antes da obra (boas-vindas e lembrete da visita). */
const ABERTOS = ['novo', 'contactado', 'visita_marcada', 'proposta_enviada'];
/**
 * Prazos (`config_orcamento`, editáveis pelo CEO no ecrã Tarefas; os limites são validados em api.js
 * `CONFIG_ORCAMENTO`): o valor por omissão de cada um. Os dois do pagamento e o da obra são dias; o da visita é a hora
 * (Lisboa) da véspera a partir da qual sai o lembrete.
 */
export const PRAZOS_EMAILS = { email_pagamento_1_dias: 3, email_pagamento_2_dias: 7, email_obra_dias: 2, email_visita_hora: 10 };
/** Chave da configuração com a ligação da avaliação no Google (texto; vazia = não há convite em lado nenhum). */
export const CHAVE_GOOGLE = 'google_avaliacao_url';
export const ROTA_NAO_RECEBER = '/api/conta/emails/nao-receber';

/** A ligação da avaliação no Google: https e um endereço do Google (g.page, goo.gl, google.com, google.pt); senão null. */
export function urlGoogle(v) {
  if (typeof v !== 'string' || v.length > 300) return null;
  let u;
  try { u = new URL(v.trim()); } catch { return null; }
  const h = u.hostname.toLowerCase();
  const doGoogle = ['g.page', 'goo.gl', 'google.com', 'google.pt'].some((d) => h === d || h.endsWith(`.${d}`));
  return u.protocol === 'https:' && !u.username && !u.password && doGoogle ? u.href : null;
}

const euro = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
/** "terça-feira, 6 de outubro às 10:00" (ou só o dia): a data é a hora de Lisboa sem fuso, formata-se tal e qual. */
const dataVisita = (q) => (/T\d{2}:\d{2}/.test(q)
  ? new Date(`${q.slice(0, 16)}:00Z`).toLocaleString('pt-PT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  : new Date(`${q.slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-PT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }));

export function criarEmailsAuto({ db, config, relogio, auditar, correio, crm, tarefas, pagamentos }) {
  const agoraIso = () => iso(relogio());
  const site = config.siteUrl || null;
  const ligacaoConta = () => (site ? ['', `A sua conta: ${site}/conta.html`] : []);
  /** Endereço público do painel (as rotas /api/conta/*): a ligação "Não quero receber" aponta para ele. */
  const basePainel = config.origens?.[0] || site;

  /** Os prazos em vigor (o que o CEO guardou; senão o valor por omissão). */
  function prazos() {
    const cfg = Object.fromEntries(db.prepare("SELECT chave, valor FROM config_orcamento WHERE chave LIKE 'email_%'").all().map((r) => [r.chave, r.valor]));
    return Object.fromEntries(Object.entries(PRAZOS_EMAILS).map(([k, omissao]) => [k, Number.isInteger(cfg[k]) && cfg[k] >= 1 ? cfg[k] : omissao]));
  }
  /**
   * Desde quando contam os emails automáticos (ISO; o instante da publicação, migração 35): o que aconteceu antes —
   * pedido recebido, proposta aceite, obra concluída — nunca recebe um email automático nem a tarefa do pagamento.
   */
  const inicio = () => db.prepare('SELECT inicio FROM emails_chave WHERE id = 1').get().inicio;
  /** A ligação da avaliação no Google que o CEO guardou (validada outra vez ao ler), ou null. */
  const google = () => urlGoogle(db.prepare('SELECT valor FROM config_orcamento WHERE chave = ?').get(CHAVE_GOOGLE)?.valor);

  // ------------------------------------------------------------ a quem e o registo dos envios
  const emailDaConta = db.prepare('SELECT email FROM contas WHERE id = ?');
  /**
   * O email do cliente de um pedido: o da conta; num pedido sem conta (formulário do site), o que a pessoa escreveu.
   * Um pedido com simulação teve sempre conta: sem ela, a conta foi apagada e não recebe nada. Anonimizados e
   * arquivados: nunca.
   */
  function destinatario(o) {
    if (o.anonimizado || o.estado === ESTADO_ARQUIVADO) return null;
    if (o.conta_id) return emailDaConta.get(o.conta_id)?.email ?? null;
    return o.simulacao === null ? o.email ?? null : null;
  }
  const jaEnviado = db.prepare('SELECT 1 FROM emails_automaticos WHERE chave = ?');
  const registar = db.prepare('INSERT OR IGNORE INTO emails_automaticos (chave, orcamento_id, tipo, quando) VALUES (?, ?, ?, ?)');
  /** Regista (chave única) e só depois envia: devolve false se já tinha saído. No registo do servidor só o tipo e o pedido. */
  function enviar(o, tipo, chave, para, mensagem) {
    if (!registar.run(chave, o.id, tipo, agoraIso()).changes) return false;
    correio.enviar({ para, resumo: `email automático (${tipo}) do pedido ${o.id}`, ...mensagem });
    return true;
  }
  const silencio = (agora) => { const hm = horaLisboa(agora); return hm >= SILENCIO_DE || hm < SILENCIO_ATE; };

  // ------------------------------------------------------------ "Não quero receber" (só o email depois da obra)
  const segredo = db.prepare('SELECT chave FROM emails_chave WHERE id = 1').get().chave;
  const assinar = (id) => createHmac('sha256', segredo).update(`nao-receber:${id}`).digest('base64url');
  /** Token da ligação: "<pedido>.<HMAC-SHA256>" — sem o email nem outro dado pessoal no endereço. */
  const token = (id) => `${id}.${assinar(id)}`;
  /** O número do pedido de um token válido; null se foi forjado ou está mal formado. */
  function pedidoDoToken(t) {
    const m = /^([1-9]\d{0,9})\.([A-Za-z0-9_-]{43})$/.exec(typeof t === 'string' ? t : '');
    if (!m) return null;
    return timingSafeEqual(Buffer.from(m[2]), Buffer.from(assinar(m[1]))) ? Number(m[1]) : null;
  }
  const recusado = db.prepare('SELECT quando FROM emails_recusados WHERE email = ?');
  /** Quando o dono de um destes emails recusou o email depois da obra (o mais antigo), ou null. */
  const recusou = (...emails) => emails.filter(Boolean).map((e) => recusado.get(String(e).toLowerCase())?.quando).filter(Boolean).sort()[0] ?? null;
  /** Guarda a recusa do email do cliente desse pedido (vale para todos os pedidos com esse email). */
  function recusar(id) {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
    const para = o ? destinatario(o) : null;
    if (!para) return;
    const r = db.prepare('INSERT OR IGNORE INTO emails_recusados (email, quando) VALUES (?, ?)').run(para.toLowerCase(), agoraIso());
    if (r.changes) auditar(null, 'emails_recusados', `orcamento:${o.id}`, { tipo: 'obra' });
  }

  /** Página mínima (sem scripts nem nada de fora) da ligação "Não quero receber". */
  function pagina(res, estado, titulo, corpo) {
    const html = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<meta name="robots" content="noindex"><title>${titulo} — Domus Energia</title>`
      + '<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1c2430}button{font:inherit;padding:.6rem 1rem;cursor:pointer}</style>'
      + `</head><body><h1>${titulo}</h1>${corpo}</body></html>`;
    res.writeHead(estado, {
      ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html),
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    });
    res.end(html);
  }
  const FICAM = 'Os emails sobre o seu pedido (confirmações, visitas e pagamentos) continuam a ser enviados.';
  /**
   * GET mostra a página de confirmação (com o botão); POST guarda a recusa — o botão da página, ou o "um clique" do
   * programa de email (`List-Unsubscribe-Post`, RFC 8058: sem sessão, sem cookies; quem autoriza é o token assinado).
   * Devolve true se o endereço era este.
   */
  async function tratar(req, res, url) {
    if (url.pathname !== ROTA_NAO_RECEBER) return false;
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) { responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET, POST' }); return true; }
    const id = pedidoDoToken(url.searchParams.get('t'));
    if (id === null) {
      pagina(res, 404, 'Ligação inválida', '<p>Esta ligação não é válida. Para deixar de receber o email, responda ao email que recebeu.</p>');
      return true;
    }
    if (req.method === 'POST') {
      await lerCorpo(req, 4096);
      recusar(id);
      pagina(res, 200, 'Pedido registado', `<p>Não vai receber mais o email com o guia e o pedido de avaliação depois de uma obra.</p><p>${FICAM}</p>`);
    } else {
      pagina(res, 200, 'Não quero receber', '<p>Carregue no botão para deixar de receber o email com o guia e o pedido de avaliação depois de uma obra.</p>'
        + `<p>${FICAM}</p><form method="post"><button type="submit">Não quero receber</button></form>`);
    }
    return true;
  }

  // ------------------------------------------------------------ 1. boas-vindas
  const avariaPaga = db.prepare("SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ? AND fase = 'avaria' AND estado = 'pago' LIMIT 1");
  /**
   * "Recebemos o seu pedido" e o que acontece a seguir, uma vez por pedido do site. A avaria paga ao enviar não o
   * recebe: o email "pagamento recebido" já diz que o pedido chegou e que vamos marcar a visita.
   */
  function boasVindas(o) {
    const chave = `${o.id}:boas_vindas`;
    if (jaEnviado.get(chave) || o.origem !== 'site' || o.criado < inicio() || !ABERTOS.includes(o.estado) || avariaPaga.get(o.id)) return false;
    const para = destinatario(o);
    if (!para) return false;
    const comConta = Boolean(o.conta_id);
    // Lista de espera (coluna `lista_espera`: simulador ou formulário do site): sem prazo de contacto nem visita.
    const espera = o.lista_espera === 1;
    const passos = espera ? [
      'O seu pedido ficou em lista de espera: ainda não começámos as obras.',
      ...(comConta ? ['O relatório básico (o intervalo de preço e a lista de trabalho) já está na sua conta.'] : []),
      'Contactamos consigo quando abrirmos as marcações.',
    ] : comConta ? [
      'O relatório básico (o intervalo de preço e a lista de trabalho) já está na sua conta.',
      'Vamos contactá-lo em breve, normalmente no dia útil seguinte, para confirmar o que precisa.',
      ...(config.pagamentoPedido ? ['Se quiser avançar já, pode pedir na sua conta o relatório completo ou a visita técnica.'] : []),
      'Depois da visita técnica enviamos-lhe a proposta, que pode aceitar na sua conta.',
    ] : [
      'Vamos contactá-lo em breve, normalmente no dia útil seguinte, para perceber o que precisa.',
      'Se for preciso ver a casa, marcamos consigo uma visita técnica.',
      'Depois enviamos-lhe a proposta com o valor.',
    ];
    return enviar(o, 'boas_vindas', chave, para, {
      assunto: 'Domus Energia: recebemos o seu pedido',
      texto: ['Olá,', '', `Recebemos o seu pedido n.º ${o.id}. Obrigado!`, '', 'O que acontece a seguir:', ...passos.map((t, i) => `${i + 1}. ${t}`), '',
        'Se precisar de falar connosco antes, responda a este email ou ligue-nos.', ...(comConta ? ligacaoConta() : []), '', 'Domus Energia'].join('\n'),
    });
  }
  /** Logo ao receber o pedido (api.js): sai já, a não ser nas horas de silêncio (aí sai na volta das 08:00). */
  function aoReceber(id) {
    if (silencio(relogio())) return false;
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
    return o ? boasVindas(o) : false;
  }

  // ------------------------------------------------------------ 2. lembrete da visita (na véspera)
  const marcacao = db.prepare(`SELECT quando FROM auditoria WHERE alvo = ? AND json_valid(detalhes) AND json_extract(detalhes, '$.data_visita') = ?
    ORDER BY id DESC LIMIT 1`);
  /**
   * Na véspera, a partir da hora da configuração: as visitas dos pedidos (`data_visita`: as do painel e as que os
   * eletricistas externos marcam) e as idas à obra marcadas por um eletricista externo (`trabalhos_eletricista.visita`).
   * A chave leva a data: uma visita remarcada tem um lembrete novo. Uma visita marcada (ou remarcada) na própria véspera
   * depois dessa hora, ou no próprio dia, não tem lembrete: o cliente acabou de receber o email "visita marcada".
   */
  function visitas(agora, pz) {
    const hoje = diaLisboa(new Date(agora));
    const envio = `${hoje}T${String(pz.email_visita_hora).padStart(2, '0')}:00`;
    if (agoraLisboa(agora) < envio) return 0;
    const amanha = somarDiasCivil(hoje, 1);
    const marcadas = db.prepare(`SELECT * FROM orcamentos WHERE substr(data_visita, 1, 10) = ? AND anonimizado IS NULL AND cliente IS NULL
      AND estado IN (${ABERTOS.map(() => '?').join(', ')})`).all(amanha, ...ABERTOS).map((o) => [o, o.data_visita]);
    if (config.eletricistas) {
      for (const t of db.prepare("SELECT orcamento_id, visita FROM trabalhos_eletricista WHERE estado = 'visita_marcada' AND tipo = 'obra' AND substr(visita, 1, 10) = ?").all(amanha)) {
        const o = db.prepare("SELECT * FROM orcamentos WHERE id = ? AND anonimizado IS NULL AND estado = 'aceite' AND obra_concluida IS NULL").get(t.orcamento_id);
        if (o) marcadas.push([o, t.visita]);
      }
    }
    let n = 0;
    for (const [o, quando] of marcadas) {
      const chave = `${o.id}:visita:${quando}`;
      if (jaEnviado.get(chave)) continue;
      const marcadaEm = marcacao.get(`orcamento:${o.id}`, quando)?.quando;
      if (marcadaEm && agoraLisboa(Date.parse(marcadaEm)) >= envio) continue;
      const para = destinatario(o);
      if (!para) continue;
      if (enviar(o, 'visita', chave, para, {
        assunto: 'Domus Energia: a visita é amanhã',
        texto: ['Olá,', '', `Lembramos que a visita do seu pedido n.º ${o.id} é amanhã: ${dataVisita(quando)}.`, 'Se não puder, responda a este email ou ligue-nos.',
          ...(o.conta_id ? ligacaoConta() : []), '', 'Domus Energia'].join('\n'),
      })) n++;
    }
    return n;
  }

  // ------------------------------------------------------------ 3. pagamento em falta (3 dias → 7 dias → tarefa)
  /**
   * O sinal de uma proposta aceite ou o restante de uma obra concluída (`pagamentos.emFalta`), contado desde que foi
   * pedido: 1.º lembrete, 2.º lembrete e, com o 2.º, a tarefa para os CEO; depois não sai mais nada. Pago, cancelado
   * (a proposta mudou, o pedido ficou perdido) ou devolvido: deixa de estar em falta e a tarefa aberta é cancelada.
   * Com um pagamento aberto ainda válido (ex.: referência Multibanco gerada há menos de 24 h) espera-se que expire.
   * A chave leva a fase e a data do pedido de pagamento: uma proposta aceite de novo recomeça a contagem.
   */
  function emFalta(agora, pz) {
    const candidatos = db.prepare(`SELECT * FROM orcamentos WHERE anonimizado IS NULL AND conta_id IS NOT NULL
      AND ((estado = 'proposta_enviada' AND proposta_aceite IS NOT NULL) OR (estado = 'aceite' AND obra_concluida IS NOT NULL))`).all();
    const tarefasDevidas = new Set();
    const desde = inicio();
    let n = 0;
    for (const o of candidatos) {
      const f = pagamentos().emFalta(o);
      // Pedido de pagamento anterior à publicação dos emails automáticos: sem lembretes e sem tarefa.
      if (!f || f.desde < desde) continue;
      const passou = agora - Date.parse(f.desde);
      const etapa = passou >= pz.email_pagamento_2_dias * DIA_MS ? 2 : passou >= pz.email_pagamento_1_dias * DIA_MS ? 1 : 0;
      const tarefa = `${o.id}:pagamento_falta:${f.fase}:${f.desde}`;
      if (etapa === 2) tarefasDevidas.add(tarefa);
      if (!etapa || f.a_pagar || passou >= pz.email_pagamento_2_dias * DIA_MS + JANELA_MS) continue;
      if (etapa === 2) tarefas.criarAutomatica('pagamento_falta', o, tarefa, pz.email_pagamento_2_dias);
      const para = destinatario(o);
      if (!para) continue;
      const oque = f.fase === 'sinal' ? 'O sinal' : 'O restante da obra';
      if (enviar(o, `pagamento_${etapa}`, `${o.id}:pagamento_${etapa}:${f.fase}:${f.desde}`, para, {
        assunto: etapa === 1 ? 'Domus Energia: pagamento por fazer' : 'Domus Energia: pagamento por fazer (segundo aviso)',
        texto: ['Olá,', '', etapa === 1 ? `${oque} do seu pedido n.º ${o.id} (${euro(f.cent)}, com IVA) ainda está por pagar. Pode pagar na sua conta quando quiser.`
          : `Voltamos a lembrar: ${oque.toLowerCase()} do seu pedido n.º ${o.id} (${euro(f.cent)}, com IVA) continua por pagar. Pode pagar na sua conta.`,
        f.fase === 'sinal' ? 'A instalação só fica confirmada depois de pagar o sinal.' : 'A app da casa fica ativa depois de pagar o restante.',
        'Se já pagou (por exemplo, por referência Multibanco), não precisa de fazer nada: a confirmação pode demorar.',
        etapa === 1 ? 'Se tiver alguma dúvida, responda a este email ou ligue-nos.' : 'Se houver algum problema com o pagamento, responda a este email ou ligue-nos: resolvemos consigo.',
        ...ligacaoConta(), '', 'Domus Energia'].join('\n'),
      })) n++;
    }
    tarefas.cancelarAutomaticas('pagamento_falta', tarefasDevidas, 'o pagamento já não está em falta');
    return n;
  }

  // ------------------------------------------------------------ 4. depois da obra (guia e pedido de avaliação)
  const estrelasTrabalho = db.prepare('SELECT estrelas FROM trabalhos_eletricista WHERE orcamento_id = ? AND estrelas IS NOT NULL ORDER BY id DESC LIMIT 1');
  /**
   * `email_obra_dias` depois de a obra ser dada por concluída no painel, uma vez por pedido: o guia da conta e da área
   * de cliente e, se o cliente ainda não avaliou, o pedido de avaliação. Quem recusou ("Não quero receber") não o recebe.
   */
  function depoisDaObra(agora, pz) {
    if (!basePainel) return 0;   // sem endereço público não há ligação "Não quero receber": não se envia
    const obras = db.prepare(`SELECT * FROM orcamentos WHERE estado = 'aceite' AND anonimizado IS NULL AND obra_concluida > ? AND obra_concluida <= ? AND obra_concluida >= ?`)
      .all(iso(agora - pz.email_obra_dias * DIA_MS - JANELA_MS), iso(agora - pz.email_obra_dias * DIA_MS), inicio());
    let n = 0;
    for (const o of obras) {
      const chave = `${o.id}:obra`;
      if (jaEnviado.get(chave)) continue;
      const para = destinatario(o);
      if (!para || recusou(para)) continue;
      const avaliado = (o.avaliacao_estrelas ?? estrelasTrabalho.get(o.id)?.estrelas ?? null) !== null;
      const sair = `${basePainel}${ROTA_NAO_RECEBER}?t=${token(o.id)}`;
      if (enviar(o, 'obra', chave, para, {
        assunto: 'Domus Energia: como usar a sua conta e a sua casa',
        cabecalhos: { 'List-Unsubscribe': `<${sair}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        texto: ['Olá,', '', `A obra do seu pedido n.º ${o.id} está concluída. Obrigado por ter escolhido a Domus Energia!`, '', 'Um guia rápido:',
          `- A minha conta${site ? ` (${site}/conta.html)` : ''}: o seu pedido, os pagamentos com os recibos e o relatório.`,
          ...(o.plano_escolhido || o.cliente ? [`- Área de cliente${site ? ` (${site}/cliente.html)` : ''}: a sua casa, para ver e comandar os aparelhos instalados. Entra com o mesmo email; fica ativa depois de a obra estar paga.`] : []),
          ...(avaliado ? [] : ['', `Como correu? Diga-nos de 1 a 5 estrelas na sua conta, no pedido n.º ${o.id}: demora menos de um minuto.`]),
          '', 'Se alguma coisa não ficou bem, responda a este email ou ligue-nos.', '', 'Domus Energia', '',
          `Não quer receber este email (o guia e o pedido de avaliação) depois de uma obra? Abra esta ligação: ${sair}`].join('\n'),
      })) n++;
    }
    return n;
  }

  // ------------------------------------------------------------ a volta (de 15 em 15 minutos, tarefas.js)
  /** Envia o que for devido agora; nas horas de silêncio não faz nada. Devolve quantos emails saíram. */
  function verificar() {
    const agora = relogio();
    if (silencio(agora)) return 0;
    crm.ligarPedidos();
    const pz = prazos();
    let n = 0;
    for (const o of db.prepare("SELECT * FROM orcamentos WHERE origem = 'site' AND anonimizado IS NULL AND criado >= ? ORDER BY id").all(iso(agora - JANELA_BOAS_VINDAS_MS))) if (boasVindas(o)) n++;
    return n + visitas(agora, pz) + emFalta(agora, pz) + depoisDaObra(agora, pz);
  }

  // ------------------------------------------------------------ avaliação na conta (1 a 5 estrelas)
  /**
   * O que a conta mostra da avaliação de um pedido: {pode, estrelas, do_pedido, google}. As estrelas são as da
   * confirmação do trabalho de um eletricista externo (`confirmacao`, eletricistas.js) ou, sem ela, as que o cliente dá
   * aqui depois da obra concluída (`pode`). `google`: o convite para a avaliação pública no Google, a TODOS os que
   * avaliaram, com qualquer número de estrelas (decisão do dono: não se filtra), e só com a ligação configurada.
   */
  function paraCliente(o, confirmacao) {
    const estrelas = confirmacao?.estrelas ?? o.avaliacao_estrelas ?? null;
    const pode = estrelas === null && o.estado === 'aceite' && Boolean(o.obra_concluida) && !['por_confirmar', 'contestada'].includes(confirmacao?.estado);
    if (estrelas === null && !pode) return null;
    return { pode, estrelas, do_pedido: estrelas !== null && !confirmacao?.estrelas, google: estrelas === null ? null : google() };
  }
  /** Avaliação baixa (1 a 3 estrelas): tarefa urgente (prazo de hoje) para os CEO, uma só por pedido. */
  function aposAvaliar(o, estrelas) {
    if (!(estrelas >= 1 && estrelas <= 3)) return;
    crm.ligarPedidos();
    tarefas.criarAutomatica('avaliacao_baixa', db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id), `${o.id}:avaliacao_baixa:pedido`, estrelas);
  }
  /** O cliente avalia na conta o trabalho de um pedido com a obra concluída (uma vez; `c`: a conta). */
  function avaliar(o, estrelas, c, ip) {
    if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) falha('Escolha a avaliação: de 1 a 5 estrelas.');
    const agora = agoraIso();
    const r = db.prepare(`UPDATE orcamentos SET avaliacao_estrelas = ?, avaliacao_quando = ? WHERE id = ? AND avaliacao_estrelas IS NULL AND estado = 'aceite' AND obra_concluida IS NOT NULL`)
      .run(estrelas, agora, o.id);
    if (!r.changes) throw new ErroApi(409, 'Este pedido não tem uma avaliação por fazer.');
    auditar({ id: null, email: `conta:${c.id}` }, 'avaliacao_cliente', `orcamento:${o.id}`, { estrelas }, ip);
    aposAvaliar(o, estrelas);
  }

  /** Para a ficha do CRM: os emails automáticos enviados (tipo e data, sem corpo) dos pedidos `ids`. */
  function enviados(ids) {
    if (!ids.length) return [];
    return db.prepare(`SELECT orcamento_id, tipo, quando FROM emails_automaticos WHERE orcamento_id IN (${ids.map(() => '?').join(', ')}) ORDER BY quando DESC, id DESC`).all(...ids);
  }

  return { destinatario, verificar, aoReceber, tratar, paraCliente, avaliar, aposAvaliar, enviados, recusou, prazos, inicio, token, pedidoDoToken };
}
