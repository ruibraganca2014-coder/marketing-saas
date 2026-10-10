// Conta de cliente (docs/CONTA-CLIENTE.md): /api/conta/*, servida pelo painel.
// - só o email (fase 3 da auditoria): "criar conta" e "pedir código" mandam um código de 6 dígitos (15 min,
//   5 tentativas) e respondem sempre o mesmo (nunca dizem se o email tem conta); a sessão abre ao confirmar o
//   código. A palavra-passe é opcional (scrypt, as regras do painel): define-se na conta e dá o "Entrar com
//   palavra-passe"; "esqueci" e "repor" continuam a existir (código + palavra-passe nova);
// - sessão própria: cookie `domus_conta` (HttpOnly, SameSite=Lax, Path=/api, Secure fora de localhost) guardado
//   como SHA-256 na tabela contas_sessoes — separada das sessões do painel: uma conta de cliente não abre
//   nenhuma rota /painel/api/;
// - o cliente só vê os SEUS pedidos (conta_id); acrescenta/troca fotos enquanto o pedido não está aceite nem
//   convertido; aceita a proposta e escolhe o plano mensal (fica "aceite" no painel depois de pagar o sinal:
//   docs/PAGAMENTOS-PEDIDO.md; data/hora/IP na auditoria);
// - guarda o estado do simulador em curso (retomar noutro aparelho);
// - depois da conversão em cliente, guarda cifradas (AES-256-GCM, CONTA_CHAVE) as credenciais MQTT da casa, que
//   o domus.sh devolve no resultado do pedido-admin "cliente", e entrega-as à própria conta (área de cliente).

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ErroApi, responder, lerJson, verificarOrigemPublica, tipoJson, lerCookies } from './http.js';
import { texto, idNum, falha, RE_TELEFONE } from './validar.js';
import { RE_EMAIL } from './pedidos.js';
import { hashSenha, verificarSenha, problemaSenha } from './senhas.js';
import { LimiteTaxa } from './limite.js';
import { iso, deCent } from './util.js';
import { RE_ID_FOTO } from './fotos.js';
import { ESTADO_ARQUIVADO } from './db.js';

export const COOKIE_CONTA = 'domus_conta';
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RENOVAR_MS = 60_000;
export const CODIGO_MS = 15 * 60_000;           // validade dos códigos de 6 dígitos
export const CODIGO_TENTATIVAS = 5;             // tentativas por código
const MAX_ESTADO = 1_500_000;                   // estado do simulador guardado na conta (bytes)
const RETENCAO_MS = 365 * 24 * 3600_000;        // igual à das fotos: 12 meses sem seguimento
const NAO_CONFIRMADA_MS = 30 * 24 * 3600_000;   // conta sem email confirmado: apagada ao fim de 30 dias

const sha = (t) => createHash('sha256').update(t).digest('hex');
const hashCodigo = (contaId, tipo, codigo) => sha(`${contaId}:${tipo}:${codigo}`);
const RE_CODIGO = /^\d{6}$/;

// Estados reais do painel → texto simples para o cliente.
const TEXTO_ESTADO = {
  novo: 'Pedido recebido. O relatório básico já está aqui.',
  contactado: 'Pedido em análise. Já falámos consigo.',
  visita_marcada: 'Visita técnica marcada.',
  proposta_enviada: 'A sua proposta está pronta.',
  aceite: 'Proposta aceite. Vamos marcar a instalação.',
  perdido: 'Pedido fechado.',
};

/** Host do pedido é local (localhost, *.localhost, 127.0.0.1, [::1])? Aí o cookie vai sem Secure (http). */
function hostLocal(req) {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]';
}

/** Estado do simulador (objeto JSON): tamanho, níveis e imagens só JPEG/PNG (como a simulação). */
function validarEstado(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) falha('O estado da simulação tem de ser um objeto.');
  const pilha = [[v, 0]];
  let nos = 0;
  while (pilha.length) {
    const [x, prof] = pilha.pop();
    if (++nos > 200_000) falha('A simulação tem demasiados elementos.');
    if (prof > 40) falha('A simulação tem demasiados níveis.');
    if (typeof x === 'string') {
      if (/^\s*data:/i.test(x) && !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(x)) falha('A simulação só aceita imagens JPEG ou PNG.');
    } else if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) pilha.push([x[k], prof + 1]);
    }
  }
  const json = JSON.stringify(v);
  if (Buffer.byteLength(json) > MAX_ESTADO) throw new ErroApi(413, 'A simulação é demasiado grande para guardar na conta.');
  return json;
}

/** Resumo simples da simulação para o cliente (sem nada técnico: nem circuitos, nem artigos, nem horas). */
function resumoSimulacao(json) {
  let s;
  try { s = JSON.parse(json ?? 'null'); } catch { return null; }
  if (!s || typeof s !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const TIPOS = { apartamento: 'Apartamento', moradia: 'Moradia', alojamento_local: 'Alojamento local', servicos: 'Serviços', industrial: 'Industrial', outro: 'Imóvel' };
  const casa = s.casa && typeof s.casa === 'object' ? s.casa : {};
  const tipo = TIPOS[casa.tipo] ?? null;
  const conta = { interruptores: 0, estores: 0, porta: 0, movimento: 0, tomadas: 0, reguladas: 0 };
  const divisoes = Array.isArray(s.divisoes) ? s.divisoes.slice(0, 200) : [];
  for (const d of divisoes) {
    if (!d || typeof d !== 'object') continue;
    conta.interruptores += Array.isArray(d.interruptores) ? Math.min(d.interruptores.length, 50) : 0;
    conta.estores += n(d.estores);
    conta.porta += n(d.sensores_porta);
    conta.movimento += n(d.sensores_movimento);
    conta.tomadas += n(d.tomadas_inteligentes);
    conta.reguladas += n(d.luzes_regulaveis);
  }
  // Lote 7: trocas e reparações da lista de trabalho (simulacao.trabalho).
  let trocasInteligentes = 0; let trocas = 0; let reparacoes = 0;
  for (const g of Array.isArray(s.trabalho) ? s.trabalho.slice(0, 200) : []) {
    for (const a of Array.isArray(g?.acoes) ? g.acoes.slice(0, 100) : []) {
      if (a?.acao === 'reparar') reparacoes += n(a.qtd);
      if (a?.acao === 'substituir') { const i = Math.min(n(a.inteligentes), n(a.qtd)); trocasInteligentes += i; trocas += n(a.qtd) - i; }
    }
  }
  // Disjuntores inteligentes (medição por circuito) nos itens do pedido, como no "O que inclui" do simulador (sem os
  // das Melhorias, que têm a sua lista).
  const partes = (Array.isArray(s.itens) ? s.itens.slice(0, 500) : [])
    .filter((i) => typeof i?.sku === 'string' && /^TONGOU-SY[12]-/.test(i.sku) && i.grupo !== 'melhoria').reduce((t, i) => t + n(i.qtd), 0);
  // Fase 2: os pacotes aceites no passo "Melhorias" (nome e o preço "a partir de" dado ao cliente).
  const melhorias = (Array.isArray(s.melhorias) ? s.melhorias.slice(0, 4) : [])
    .filter((m) => m && typeof m.nome === 'string' && m.nome.trim())
    .map((m) => ({ nome: m.nome.slice(0, 80), preco: Number.isFinite(m.preco) && m.preco >= 0 ? m.preco : null }));
  const p = (k, um, varios) => (k ? `${k} ${k === 1 ? um : varios}` : null);
  const PACOTES = { essencial: 'Proteção básica no quadro elétrico', recomendado: 'Proteção recomendada no quadro elétrico', completo: 'Proteção completa no quadro elétrico' };
  const inclui = [
    p(conta.interruptores, 'interruptor inteligente (luzes pelo telemóvel)', 'interruptores inteligentes (luzes pelo telemóvel)'),
    p(conta.reguladas, 'luz com intensidade regulável', 'luzes com intensidade regulável'),
    p(conta.estores, 'estore automático', 'estores automáticos'),
    p(conta.movimento, 'sensor de movimento', 'sensores de movimento'),
    p(conta.porta, 'aviso de porta ou janela aberta', 'avisos de porta ou janela aberta'),
    p(conta.tomadas, 'tomada inteligente', 'tomadas inteligentes'),
    p(trocasInteligentes, 'aparelho trocado por um inteligente', 'aparelhos trocados por inteligentes'),
    p(trocas, 'aparelho trocado', 'aparelhos trocados'),
    p(reparacoes, 'reparação', 'reparações'),
    // Só quando o quadro entra no pedido (sem "Quer melhorar o quadro?" = Não); pedidos antigos sem no_preco contam.
    partes ? `Ver quanto gasta e ligar ou desligar ${partes === 1 ? '1 parte' : `${partes} partes`} da casa no telemóvel` : null,
    s.quadro?.no_preco === false || !PACOTES[s.quadro?.pacote] ? null : `${PACOTES[s.quadro.pacote]}${s.quadro.quadro_novo_no_preco === true ? ', com quadro novo' : ''}`,
    'Instalação por técnico habilitado',
  ].filter(Boolean);
  const PLANOS = { base: 'Base', conforto: 'Conforto', premium: 'Premium' };
  const min = Number.isFinite(s.total?.min) ? s.total.min : null;
  // Fase 1: a avaria rápida (sem planta) — o que se passa e onde; inclui o diagnóstico.
  if (s.funil === 'avaria') {
    const ONDE = { sala: 'Sala', cozinha: 'Cozinha', quarto: 'Quarto', casa_banho: 'Casa de banho', exterior: 'Exterior', quadro: 'Quadro elétrico', outro: 'Outro' };
    const PROBLEMA = { sem_corrente: 'Tomada sem corrente', luz: 'Luz não acende', disjuntor: 'Disjuntor dispara', queimado: 'Cheiro a queimado', faiscas: 'Faz faíscas', choque: 'Dá choque', outro: 'Outro' };
    const av = s.avaria && typeof s.avaria === 'object' ? s.avaria : {};
    const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const max0 = Number.isFinite(s.total?.max) ? s.total.max : null;
    return {
      casa: 'Sem planta (avaria)',
      // "Sala, Cozinha — Luz não acende, Disjuntor dispara" (ronda B: várias escolhas; os antigos trazem uma string).
      avaria: [lista(av.onde).map((k) => ONDE[k]).filter(Boolean).join(', '), lista(av.problema).map((k) => PROBLEMA[k]).filter(Boolean).join(', ') || 'Avaria'].filter(Boolean).join(' — '),
      localidade: typeof casa.localidade === 'string' ? casa.localidade.slice(0, 80) : null,
      divisoes: null,
      inclui: ['Diagnóstico da avaria (a reparação orça-se na visita)', 'Visita de técnico habilitado'],
      plano: null,
      estimativa: min !== null && max0 !== null ? { min, max: max0 } : null,
    };
  }
  const max = Number.isFinite(s.total?.max) ? s.total.max : null;
  return {
    casa: [tipo, typeof casa.tipologia === 'string' ? casa.tipologia : null].filter(Boolean).join(' ') || null,
    localidade: typeof casa.localidade === 'string' ? casa.localidade.slice(0, 80) : null,
    divisoes: divisoes.length || (Number.isInteger(casa.divisoes) ? casa.divisoes : null),
    inclui,
    melhorias,
    plano: PLANOS[s.plano_sugerido] ?? null,
    estimativa: min !== null && max !== null ? { min, max } : null,
  };
}

/**
 * @param {{db, config, registo, relogio: () => number, auditar: Function, fotos: object, correio: object}} ctx
 */
export function criarContas({ db, config, registo, relogio, auditar, fotos, correio, pagamentos = () => null, aoApagarPedido = async () => {}, eletricistas = () => null, crm = () => null, emails = () => null, tarefas = () => null }) {
  const agoraIso = () => iso(relogio());
  const lim = (n, ms) => new LimiteTaxa(n, ms, relogio);
  const L = {
    // "criar" é agora também o caminho de quem já tem conta (um só botão "Enviar código", 2026-10-05): o limite por IP
    // passa a ser o do antigo "entrar com código" (10/hora); por email continuam 3 emails por hora.
    criarIp: lim(10, 3600_000), criarEmail: lim(3, 3600_000),
    // Entrar: por IP e por par email+IP; por email só um travão alto (um terceiro não consegue bloquear a conta).
    entrarIp: lim(10, 60_000), entrarPar: lim(5, 60_000), entrarEmail: lim(50, 3600_000),
    codigoIp: lim(20, 3600_000), reporEmail: lim(10, 3600_000),
    // Emails por email, com quotas separadas: um terceiro que chama "criar" ou "codigo" com o email de outra pessoa
    // não gasta a quota do "Esqueci" (código de repor); os códigos de confirmar/entrar são 3 por hora por email.
    emailEnvio: lim(3, 3600_000), reporEnvio: lim(3, 3600_000), emailIp: lim(10, 3600_000),
    esqueciIp: lim(5, 3600_000), pedirCodigoIp: lim(10, 3600_000),
    simulacao: lim(120, 3600_000),
    fotosIp: lim(config.limiteFotosHora, 3600_000),
    casa: lim(30, 3600_000),
    mensagens: lim(10, 3600_000),   // respostas do cliente na conversa do pedido, por conta
    apagarIp: lim(5, 3600_000),   // apagar a própria conta (palavra-passe errada conta)
  };
  // Falhas seguidas a entrar, por par email+IP → atraso progressivo curto (1 s, 2 s, 4 s… até 60 s) a partir da 3.ª.
  const falhasEntrar = new Map();   // "email|ip" → {n, ate, ultima}
  const FALHAS_ESQUECER_MS = 15 * 60_000;
  const parEntrar = (email, ip) => `${email}|${ip}`;

  function esperar(pares) {
    const s = Math.max(...pares.map(([l, k]) => l.espera(k)));
    if (s) throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${s > 90 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`, { 'Retry-After': String(s) });
  }
  const contar = (pares) => { for (const [l, k] of pares) l.registar(k); };

  // Na auditoria a conta aparece como "conta:<id>" (sem o email: sai com a conta, RGPD).
  const quem = (c) => ({ id: null, email: `conta:${c.id}` });

  // ------------------------------------------------------------ sessão
  // Path=/api (e não /api/conta): o POST /api/orcamento com simulação também usa esta sessão. O cookie chega assim
  // aos pagamentos (/api/* no Caddy), que o ignoram (usam Bearer) e nunca registam cabeçalhos.
  function cookie(req, token, maxAgeS) {
    return `${COOKIE_CONTA}=${token}; Path=/api; HttpOnly;${hostLocal(req) ? '' : ' Secure;'} SameSite=Lax; Max-Age=${maxAgeS}`;
  }
  const cookieApagar = (req) => cookie(req, '', 0);

  function abrirSessao(req, contaId) {
    const token = randomBytes(32).toString('base64url');
    const agora = relogio();
    db.prepare('INSERT INTO contas_sessoes (id, conta_id, criada, expira, renovada) VALUES (?, ?, ?, ?, ?)')
      .run(sha(token), contaId, agora, agora + config.contaSessaoMs, agora);
    db.prepare('UPDATE contas SET ultimo_acesso = ? WHERE id = ?').run(agoraIso(), contaId);
    return cookie(req, token, Math.floor(config.contaSessaoMs / 1000));
  }

  /** Conta da sessão do pedido (ou null). Renova a sessão (e o cookie, se `res`). */
  function sessao(req, res) {
    const token = lerCookies(req)[COOKIE_CONTA];
    if (!token || !RE_TOKEN.test(token)) return null;
    const id = sha(token);
    const agora = relogio();
    const s = db.prepare('SELECT s.*, c.* , s.id AS sid FROM contas_sessoes s JOIN contas c ON c.id = s.conta_id WHERE s.id = ?').get(id);
    if (!s) return null;
    if (s.expira <= agora || s.criada + config.contaSessaoMaxMs <= agora || !s.ativo) {
      db.prepare('DELETE FROM contas_sessoes WHERE id = ?').run(id);
      return null;
    }
    if (agora - s.renovada >= RENOVAR_MS) {
      const expira = Math.min(agora + config.contaSessaoMs, s.criada + config.contaSessaoMaxMs);
      db.prepare('UPDATE contas_sessoes SET expira = ?, renovada = ? WHERE id = ?').run(expira, agora, id);
      db.prepare('UPDATE contas SET ultimo_acesso = ? WHERE id = ?').run(iso(agora), s.conta_id);
      res?.setHeader('Set-Cookie', cookie(req, token, Math.max(1, Math.floor((expira - agora) / 1000))));
    }
    return {
      id: s.conta_id, email: s.email, confirmado: Boolean(s.confirmado), sessao: id, tem_password: Boolean(s.hash),
      nome: s.nome, telefone: s.telefone, morada: s.morada, localidade: s.localidade,
      simulacao_atualizada: s.simulacao_atualizada, casa_codigo: s.casa_codigo, sessaoExpira: iso(s.expira),
    };
  }

  const publico = (c) => ({
    email: c.email, confirmado: Boolean(c.confirmado), tem_password: Boolean('tem_password' in c ? c.tem_password : c.hash),   // linha da tabela ou a sessão
    nome: c.nome ?? null, telefone: c.telefone ?? null, morada: c.morada ?? null, localidade: c.localidade ?? null,
  });

  // ------------------------------------------------------------ códigos por email
  function novoCodigo(contaId, tipo) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare(`INSERT INTO contas_codigos (conta_id, tipo, hash, expira, tentativas) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(conta_id, tipo) DO UPDATE SET hash = excluded.hash, expira = excluded.expira, tentativas = 0`)
      .run(contaId, tipo, hashCodigo(contaId, tipo, codigo), relogio() + CODIGO_MS);
    return codigo;
  }

  /** Verifica um código: 'ok' (e apaga-o) | 'errado' (restam n) | 'expirado' | 'esgotado'. */
  function verificarCodigo(contaId, tipo, codigo) {
    const c = db.prepare('SELECT * FROM contas_codigos WHERE conta_id = ? AND tipo = ?').get(contaId, tipo);
    if (!c || c.expira <= relogio()) return { r: 'expirado' };
    if (c.tentativas >= CODIGO_TENTATIVAS) return { r: 'esgotado' };
    const certo = RE_CODIGO.test(codigo) && timingSafeEqual(Buffer.from(hashCodigo(contaId, tipo, codigo)), Buffer.from(c.hash));
    if (certo) {
      db.prepare('DELETE FROM contas_codigos WHERE conta_id = ? AND tipo = ?').run(contaId, tipo);
      return { r: 'ok' };
    }
    const n = c.tentativas + 1;
    db.prepare('UPDATE contas_codigos SET tentativas = ? WHERE conta_id = ? AND tipo = ?').run(n, contaId, tipo);
    return n >= CODIGO_TENTATIVAS ? { r: 'esgotado' } : { r: 'errado', restam: CODIGO_TENTATIVAS - n };
  }

  function enviarCodigo(email, tipo, codigo) {
    const site = config.siteUrl ? `${config.siteUrl}/conta.html` : null;
    // O código vai só no corpo (o assunto aparece em notificações e nos registos).
    const ASSUNTO = { confirmar: 'Domus Energia: confirme o seu email', entrar: 'Domus Energia: o seu código para entrar', repor: 'Domus Energia: mudar a palavra-passe' };
    const FRASE = {
      confirmar: 'Para confirmar o seu email na Domus Energia, escreva este código:',
      entrar: 'Para entrar na sua conta Domus Energia, escreva este código:',
      repor: 'Pediu para mudar a palavra-passe da sua conta Domus Energia. Escreva este código:',
    };
    const RESUMO = { confirmar: 'confirmar o email', entrar: 'entrar', repor: 'mudar a palavra-passe' };
    const texto = [
      'Olá,',
      '',
      FRASE[tipo],
      '',
      `    ${codigo}`,
      '',
      'O código vale 15 minutos.',
      tipo === 'repor' ? 'Se não foi você, ignore este email: a sua palavra-passe continua a mesma.' : 'Se não foi você, ignore este email: a sua conta continua igual.',
      ...(site ? ['', `A sua conta: ${site}`] : []),
      '',
      'Domus Energia',
    ].join('\n');
    return correio.enviar({ para: email, assunto: ASSUNTO[tipo], texto, resumo: `código ${codigo} (${RESUMO[tipo]})` });
  }

  /** O código para o email de uma conta (confirmar, se o email está por confirmar; senão entrar), dentro da quota 3/hora. */
  function codigoParaConta(c) {
    if (!c.ativo || L.emailEnvio.espera(c.email)) return;
    L.emailEnvio.registar(c.email);
    const tipo = c.confirmado ? 'entrar' : 'confirmar';
    enviarCodigo(c.email, tipo, novoCodigo(c.id, tipo));
  }

  function emailValido(v) {
    const e = texto(v, 'o email', { max: 254, obrigatorio: true, re: RE_EMAIL, reMsg: 'O email não parece certo (ex.: nome@exemplo.pt).' });
    return e.toLowerCase();
  }

  function mensagemCodigo(v) {
    if (v.r === 'errado') return new ErroApi(400, `Código errado. ${v.restam === 1 ? 'Resta 1 tentativa' : `Restam ${v.restam} tentativas`}.`);
    if (v.r === 'esgotado') return new ErroApi(429, 'Demasiadas tentativas com este código. Peça um código novo.');
    return new ErroApi(410, 'O código expirou. Peça um código novo.');
  }

  // ------------------------------------------------------------ handlers
  const h = {};

  // Criar conta (só o email): a resposta é sempre a mesma (não revela se o email já tem conta) e não abre sessão — a
  // sessão abre ao confirmar o código (POST confirmar com email e código). Email novo → conta por confirmar (sem
  // palavra-passe) e código de confirmar; conta já existente → o código para entrar (ou de confirmar, se ainda não
  // confirmou). Quem tem o email tem a conta; a palavra-passe é opcional (POST palavra-passe, com sessão).
  h.criar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email']);
    const email = emailValido(v.email);
    esperar([[L.criarIp, ip], [L.criarEmail, email]]);
    contar([[L.criarIp, ip], [L.criarEmail, email]]);
    const existe = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    if (!existe) {
      const agora = agoraIso();
      const id = Number(db.prepare('INSERT INTO contas (email, hash, criado, atualizado) VALUES (?, NULL, ?, ?)').run(email, agora, agora).lastInsertRowid);
      auditar(quem({ id }), 'conta_criada', `conta:${id}`, null, ip);
      codigoParaConta({ id, email, ativo: 1, confirmado: null });
    } else codigoParaConta(existe);
    responder(res, 201, { ok: true, email, mensagem: 'Enviámos um código para o email. Veja também o correio não desejado (spam).' });
  };

  // "Continuar" com o email (decisão do dono, 2026-10-06): o site diz se o email já tem conta. Com conta, segue o código
  // (de entrar, ou de confirmar se ainda não confirmou); sem conta NÃO se cria nada nem se envia nada — responde
  // `existe: false` e o site pede "Criar conta" (POST criar). O dono aceitou que isto revela se um email tem conta
  // (antes nenhuma resposta o dizia); fica o limite por IP (10/hora) e a quota de 3 emails por hora por email.
  h.continuar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email']);
    const email = emailValido(v.email);
    esperar([[L.pedirCodigoIp, ip]]);
    contar([[L.pedirCodigoIp, ip]]);
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    if (!c) return responder(res, 200, { ok: true, email, existe: false });
    codigoParaConta(c);
    responder(res, 200, { ok: true, email, existe: true, mensagem: 'Enviámos um código para o email. Veja também o correio não desejado (spam).' });
  };

  // Pedir um código para entrar (conta já existente; "Entrar com código" e "Esqueci-me da palavra-passe"): a mesma
  // resposta exista ou não a conta; limites por IP (10/hora) e a quota de 3 emails por hora por email.
  h.codigo = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email']);
    const email = emailValido(v.email);
    esperar([[L.pedirCodigoIp, ip]]);
    contar([[L.pedirCodigoIp, ip]]);
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    if (c) codigoParaConta(c);
    responder(res, 200, { ok: true, email, mensagem: 'Se houver uma conta com este email, enviámos um código para entrar. Veja também o correio não desejado (spam).' });
  };

  // Entrar: só contas com o email confirmado (uma conta por confirmar entra ao confirmar o código). A mesma resposta
  // para tudo o que falha. Limites por IP e por par email+IP, com atraso progressivo curto; por email só um travão
  // alto (50/h), para que um terceiro não consiga bloquear a conta de alguém.
  h.entrar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'password']);
    if (typeof v.email !== 'string' || typeof v.password !== 'string' || !v.email || !v.password) falha('Indique o email e a palavra-passe.');
    if (v.email.length > 254 || v.password.length > 200) throw new ErroApi(401, 'Email ou palavra-passe errados.');
    const email = v.email.trim().toLowerCase();
    const par = parEntrar(email, ip);
    esperar([[L.entrarIp, ip], [L.entrarPar, par], [L.entrarEmail, email]]);
    const agora = relogio();
    const f = falhasEntrar.get(par);
    if (f?.ate > agora) {
      const s = Math.ceil((f.ate - agora) / 1000);
      throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${s} s.`, { 'Retry-After': String(s) });
    }
    contar([[L.entrarIp, ip], [L.entrarPar, par], [L.entrarEmail, email]]);
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    const ok = await verificarSenha(v.password, c?.hash);
    if (!ok || !c || !c.ativo || !c.confirmado) {
      const n = (f && agora - f.ultima < FALHAS_ESQUECER_MS ? f.n : 0) + 1;
      falhasEntrar.set(par, { n, ultima: agora, ate: n >= 3 ? agora + Math.min(2 ** (n - 3), 60) * 1000 : 0 });
      // Limpeza por expiração (nunca apaga os atrasos em curso).
      if (falhasEntrar.size > 10_000) for (const [k, x] of falhasEntrar) if (agora - x.ultima >= FALHAS_ESQUECER_MS) falhasEntrar.delete(k);
      throw new ErroApi(401, 'Email ou palavra-passe errados. Sem palavra-passe, ou esqueceu-se dela? Entre com um código.');
    }
    falhasEntrar.delete(par);
    const ck = abrirSessao(req, c.id);
    responder(res, 200, { conta: publico(c) }, { 'Set-Cookie': ck });
  };

  h.sair = async ({ req, res }) => {
    await lerJson(req, []);
    const token = lerCookies(req)[COOKIE_CONTA];
    if (token && RE_TOKEN.test(token)) db.prepare('DELETE FROM contas_sessoes WHERE id = ?').run(sha(token));
    responder(res, 200, { ok: true }, { 'Set-Cookie': cookieApagar(req) });
  };

  /**
   * O que está guardado em `contas.simulacao`: 'casa' (só a casa: depois de enviar um pedido, ou a descrição da casa já
   * acabada e registada) ou 'em_curso' (uma simulação por acabar). A conta só diz "por acabar" na segunda.
   */
  function tipoSimulacao(c) {
    if (!c.simulacao_atualizada) return null;
    const r = db.prepare('SELECT simulacao, casa_registada FROM contas WHERE id = ?').get(c.id);
    let e = null;
    try { e = JSON.parse(r?.simulacao ?? 'null'); } catch { /* guardada estragada: conta como em curso */ }
    return e?.soCasa === true || (e?.funil === 'primeira' && r?.casa_registada) ? 'casa' : 'em_curso';
  }
  h.eu = ({ res, c }) => responder(res, 200, {
    conta: publico(c), simulacao_atualizada: c.simulacao_atualizada ?? null, simulacao_tipo: tipoSimulacao(c),
    tem_casa: Boolean(c.casa_codigo), sessao_expira: c.sessaoExpira,
    // Pagamentos do pedido: {ativo, modo, demonstracao…} (a conta mostra a faixa "Modo de demonstração").
    pagamentos: pagamentos()?.info() ?? null,
  });

  // Confirmar o email. Sem sessão (depois de "Criar conta"): {email, password, codigo}, sempre a mesma resposta de
  // erro; as tentativas do código só contam com a palavra-passe certa (um terceiro não o gasta); abre a sessão.
  // Com sessão (contas por confirmar com sessão aberta antes desta versão): {codigo}, com as mensagens detalhadas.
  // Com sessão e `email` no corpo ("Entrar com código" de outra conta, ou da mesma com a casa por ligar: a Área de
  // cliente mostra a entrada com a sessão aberta) é uma entrada nova por código: abre a sessão dessa conta.
  h.confirmar = async ({ req, res, c, ip }) => {
    const v = await lerJson(req, ['email', 'codigo']);
    if (!c || v.email !== undefined) return confirmarSemSessao({ req, res, ip, v });
    if (c.confirmado) return responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) });
    esperar([[L.codigoIp, ip]]);
    contar([[L.codigoIp, ip]]);
    const codigo = String(v.codigo ?? '').replace(/\s/g, '');
    if (!RE_CODIGO.test(codigo)) falha('O código tem 6 algarismos.');
    const r = verificarCodigo(c.id, 'confirmar', codigo);
    if (r.r !== 'ok') throw mensagemCodigo(r);
    db.prepare('UPDATE contas SET confirmado = ?, atualizado = ? WHERE id = ?').run(agoraIso(), agoraIso(), c.id);
    auditar(quem(c), 'conta_email_confirmado', `conta:${c.id}`, null, ip);
    responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) });
  };

  const ERRO_CODIGO = 'Código errado ou expirado. Confirme o código, ou peça um novo (ao fim de 5 tentativas erradas o código deixa de valer).';

  // {email, codigo}: o código de confirmar (conta por confirmar: confirma o email) ou de entrar (conta confirmada);
  // abre a sessão. Sempre a mesma resposta de erro (um terceiro só fica a saber que errou).
  async function confirmarSemSessao({ req, res, ip, v }) {
    const email = emailValido(v.email);
    esperar([[L.codigoIp, ip]]);
    contar([[L.codigoIp, ip]]);
    const codigo = String(v.codigo ?? '').replace(/\s/g, '');
    if (!RE_CODIGO.test(codigo)) falha('O código tem 6 algarismos.');
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    const tipo = c?.confirmado ? 'entrar' : 'confirmar';
    const r = c && c.ativo ? verificarCodigo(c.id, tipo, codigo) : { r: 'errado' };
    if (r.r !== 'ok') throw new ErroApi(400, ERRO_CODIGO);
    const agora = agoraIso();
    if (!c.confirmado) {
      db.prepare('UPDATE contas SET confirmado = ?, atualizado = ? WHERE id = ?').run(agora, agora, c.id);
      auditar(quem(c), 'conta_email_confirmado', `conta:${c.id}`, null, ip);
    } else auditar(quem(c), 'conta_entrou_codigo', `conta:${c.id}`, null, ip);
    for (const k of falhasEntrar.keys()) if (k.startsWith(`${email}|`)) falhasEntrar.delete(k);
    const ck = abrirSessao(req, c.id);
    responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) }, { 'Set-Cookie': ck });
  }

  // Definir (ou mudar) a palavra-passe, com a sessão aberta e o email confirmado: dá o "Entrar com palavra-passe".
  // Não fecha as outras sessões (quem está dentro já provou o email).
  h.definirSenha = async ({ req, res, c, ip }) => {
    const v = await lerJson(req, ['password']);
    const prob = problemaSenha(v.password);
    if (prob) falha(prob);
    const agora = agoraIso();
    db.prepare('UPDATE contas SET hash = ?, atualizado = ? WHERE id = ?').run(await hashSenha(v.password), agora, c.id);
    auditar(quem(c), 'conta_palavra_passe_definida', `conta:${c.id}`, null, ip);
    responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) });
  };

  h.reenviar = async ({ req, res, c, ip }) => {
    await lerJson(req, []);
    if (c.confirmado) return responder(res, 200, { ok: true, confirmado: true });
    esperar([[L.emailEnvio, c.email], [L.emailIp, ip]]);
    contar([[L.emailEnvio, c.email], [L.emailIp, ip]]);
    enviarCodigo(c.email, 'confirmar', novoCodigo(c.id, 'confirmar'));
    responder(res, 200, { ok: true });
  };

  // "Esqueci a palavra-passe": a resposta é sempre a mesma (não revela se o email tem conta).
  h.esqueci = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email']);
    const email = emailValido(v.email);
    esperar([[L.esqueciIp, ip]]);
    contar([[L.esqueciIp, ip]]);
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    // Quota própria (3/hora por email): "criar" e "reenviar" não a gastam.
    if (c && c.ativo && !L.reporEnvio.espera(email)) {
      L.reporEnvio.registar(email);
      enviarCodigo(c.email, 'repor', novoCodigo(c.id, 'repor'));
      auditar(quem(c), 'conta_repor_pedido', `conta:${c.id}`, null, ip);
    }
    responder(res, 200, { ok: true, mensagem: 'Se houver uma conta com este email, enviámos um código para mudar a palavra-passe. Veja também o correio não desejado (spam).' });
  };

  h.repor = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'codigo', 'password']);
    const email = emailValido(v.email);
    const prob = problemaSenha(v.password);
    if (prob) falha(prob);
    // A mesma resposta e os mesmos limites (por IP e por email) exista ou não a conta; o código deixa de valer ao
    // fim de 5 tentativas erradas, mas quem as faz não fica a saber (continua a ver "errado ou expirado").
    esperar([[L.codigoIp, ip], [L.reporEmail, email]]);
    contar([[L.codigoIp, ip], [L.reporEmail, email]]);
    const codigo = String(v.codigo ?? '').replace(/\s/g, '');
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    const r = c && c.ativo && RE_CODIGO.test(codigo) ? verificarCodigo(c.id, 'repor', codigo) : { r: 'errado' };
    if (r.r !== 'ok') throw new ErroApi(400, ERRO_CODIGO);
    const agora = agoraIso();
    // Quem recebeu o código no email também confirmou o email.
    db.prepare('UPDATE contas SET hash = ?, confirmado = COALESCE(confirmado, ?), atualizado = ? WHERE id = ?').run(await hashSenha(v.password), agora, agora, c.id);
    db.prepare('DELETE FROM contas_sessoes WHERE conta_id = ?').run(c.id);
    for (const k of falhasEntrar.keys()) if (k.startsWith(`${email}|`)) falhasEntrar.delete(k);
    auditar(quem(c), 'conta_palavra_passe_reposta', `conta:${c.id}`, null, ip);
    const ck = abrirSessao(req, c.id);
    responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) }, { 'Set-Cookie': ck });
  };

  // Simulação em curso (retomar noutro aparelho). As fotos por enviar ficam só no navegador onde foram tiradas.
  h.lerSimulacao = ({ res, c }) => {
    const r = db.prepare('SELECT simulacao, simulacao_atualizada FROM contas WHERE id = ?').get(c.id);
    let estado = null;
    try { estado = r?.simulacao ? JSON.parse(r.simulacao) : null; } catch { estado = null; }
    responder(res, 200, { estado, atualizado: r?.simulacao_atualizada ?? null });
  };

  h.guardarSimulacao = async ({ req, res, c }) => {
    esperar([[L.simulacao, String(c.id)]]);
    contar([[L.simulacao, String(c.id)]]);
    const v = await lerJson(req, ['estado'], MAX_ESTADO + 64 * 1024);
    if (v.estado === undefined) falha('Indique o estado da simulação (ou null para apagar).');
    const json = validarEstado(v.estado);
    const agora = json ? agoraIso() : null;
    db.prepare('UPDATE contas SET simulacao = ?, simulacao_atualizada = ? WHERE id = ?').run(json, agora, c.id);
    responder(res, 200, { ok: true, atualizado: agora });
  };

  /**
   * "Casa registada" (decisão do dono, 2026-10-04): o cliente acabou de descrever a casa no simulador (a `simulacao` da
   * conta) sem pedir serviço. Fica a data (só a primeira vez) e os CEO recebem um aviso, sem dados do cliente no email:
   * a casa vê-se no painel (CRM → Casas registadas).
   */
  h.registarCasa = async ({ req, res, c, ip }) => {
    await lerJson(req, []);
    const r = db.prepare('SELECT simulacao, casa_registada FROM contas WHERE id = ?').get(c.id);
    if (!r?.simulacao && !r?.casa_registada) falha('Descreva primeiro a sua casa no simulador.');
    if (!r.casa_registada) {
      db.prepare('UPDATE contas SET casa_registada = ? WHERE id = ?').run(agoraIso(), c.id);
      auditar(quem(c), 'casa_registada', `conta:${c.id}`, null, ip);
      // Quem já tem pedidos já é cliente no painel: sem aviso (nem entra nas "Casas registadas" do CRM).
      const jaCliente = db.prepare('SELECT 1 FROM orcamentos WHERE conta_id = ? OR lower(email) = lower(?) LIMIT 1').get(c.id, c.email);
      const painel = config.origens[0] ? ['', `Painel: ${config.origens[0]}/painel/#/crm`] : [];
      for (const { email } of jaCliente ? [] : db.prepare("SELECT email FROM utilizadores WHERE papel = 'ceo' AND ativo = 1 LIMIT 5").all()) {
        correio.enviar({ para: email, assunto: 'Domus Energia: casa registada no simulador', resumo: `casa registada pela conta ${c.id}`,
          texto: ['Olá,', '', 'Um cliente descreveu a casa no simulador e ficou com conta. Ainda não pediu nenhum serviço.', 'Veja o contacto e a casa no painel, em CRM → Casas registadas.', ...painel, '', 'Domus Energia'].join('\n') });
      }
    }
    responder(res, 200, { ok: true });
  };

  const obraDe = db.prepare('SELECT data, hora, estado, por_agendar FROM obras WHERE id = ?');
  function pedidoParaCliente(o) {
    // A obra nasce com o sinal pago, ainda sem data escolhida (`por_agendar`): só conta como "Instalação marcada" depois
    // de agendada. Uma obra cancelada de um pedido que já não está aceite não se mostra.
    const daObra = o.obra_id ? obraDe.get(o.obra_id) : null;
    const obra = daObra && !(daObra.estado === 'cancelada' && o.estado !== 'aceite') ? daObra : null;
    const agendada = Boolean(obra) && !obra.por_agendar;
    const valor = deCent(o.valor_proposta_cent);
    const pag = pagamentos()?.paraCliente(o) ?? null;
    const temProposta = valor !== null && ['proposta_enviada', 'aceite'].includes(o.estado);
    const depoisVisita = ['proposta_enviada', 'aceite'].includes(o.estado) || Boolean(obra);
    const passos = [
      { chave: 'recebido', texto: 'Pedido recebido', feito: true, data: o.criado },
      { chave: 'visita', texto: 'Visita técnica', feito: Boolean(o.data_visita) || depoisVisita, data: o.data_visita },
      { chave: 'proposta', texto: 'Proposta', feito: temProposta },
      { chave: 'aceite', texto: 'Proposta aceite', feito: o.estado === 'aceite' || Boolean(obra), data: o.estado === 'aceite' ? o.proposta_aceite : null },
      { chave: 'obra', texto: obra?.estado === 'concluida' ? 'Instalação concluída' : 'Instalação', feito: agendada, data: agendada ? obra.data : null },
    ];
    let estadoTexto = TEXTO_ESTADO[o.estado] ?? 'Pedido recebido.';
    if (pag?.aguarda_sinal) estadoTexto = 'Proposta aceite — falta pagar o sinal para confirmarmos a instalação.';
    if (o.estado === 'aceite' && o.obra_concluida && !obra) estadoTexto = pag?.obra_paga === false ? 'Obra concluída. A app fica ativa depois de pagar o restante.' : 'Obra concluída.';
    if (obra) {
      estadoTexto = obra.estado === 'concluida' ? (pag?.obra_paga === false ? 'Instalação concluída. A app fica ativa depois de pagar o restante.' : 'Instalação concluída.')
        : obra.estado === 'cancelada' ? 'Instalação cancelada. Vamos contactá-lo.' : agendada ? 'Instalação marcada.' : estadoTexto;
    }
    const podeFotos = !['aceite', 'perdido'].includes(o.estado) && !o.cliente;
    let sim = null;
    try { sim = o.simulacao ? JSON.parse(o.simulacao) : null; } catch { sim = null; }
    // Avaria: não há "relatório básico" com estimativa; o passo seguinte é a visita do diagnóstico.
    if (sim?.funil === 'avaria' && estadoTexto === TEXTO_ESTADO.novo) estadoTexto = 'Pedido recebido. Vamos marcar a visita para o diagnóstico.';
    // Prazo de contacto (decisão do dono, 2026-10-10; igual a web/simulador/app.js textoPrazo), enquanto o pedido é novo.
    // Lista de espera (web/config.js listaEspera; coluna `lista_espera` do pedido): sem prazo de contacto.
    if (o.estado === 'novo' && o.lista_espera === 1) {
      estadoTexto = `Pedido recebido e em lista de espera: contactamos quando abrirmos as marcações.${sim?.funil === 'avaria' ? '' : ' O relatório básico já está aqui.'}`;
    } else if (o.estado === 'novo') estadoTexto += sim?.urgencia === 'urgente'
      ? ' Como é urgente, ligamos-lhe no próprio dia se chegou até às 18h de um dia útil; senão, na manhã do dia útil seguinte.'
      : ' Contactamos no dia útil seguinte.';
    const confirmacao = eletricistas()?.paraCliente(o) ?? null;
    // A conversa do pedido (migração 38): os emails da equipa e as respostas do cliente; nunca quem da equipa escreveu.
    const mensagens = db.prepare('SELECT de, assunto, texto, criado AS quando FROM mensagens_pedido WHERE orcamento_id = ? ORDER BY id').all(o.id);
    return {
      id: o.id, criado: o.criado, estado: o.estado, estado_texto: estadoTexto, passos,
      // Cliente que regressa (decisão do dono, 2026-10-04; web/regresso.js): o pedido ainda está em andamento? — enviado e
      // ainda não fechado (perdido), arquivado/anonimizado, nem com a obra dada por concluída (pelo painel ou na obra
      // ligada). É o que o Início do simulador e o botão da página inicial leem ("Já tem o pedido n.º N em andamento").
      em_andamento: !['perdido', ESTADO_ARQUIVADO].includes(o.estado) && !o.anonimizado && !o.obra_concluida && daObra?.estado !== 'concluida',
      data_visita: o.data_visita, servico: o.servico,
      proposta: temProposta ? { valor, texto: o.proposta_texto ?? null, aceite: o.proposta_aceite ?? null } : null,
      pode_aceitar: o.estado === 'proposta_enviada' && valor !== null && !o.cliente && !o.proposta_aceite,
      plano_sugerido: ['base', 'conforto', 'premium'].includes(sim?.plano_sugerido) ? sim.plano_sugerido : null,
      ...(pag ?? {}),
      pode_fotos: podeFotos,
      obra: obra ? { data: agendada ? obra.data : null, hora: agendada ? obra.hora : null, estado: obra.estado, por_agendar: !agendada } : null,
      // Trabalho feito por um eletricista externo (docs/ELETRICISTAS.md): "O trabalho ficou concluído?" — por confirmar,
      // confirmado (com a avaliação) ou devolvido; nunca quem o fez. null sem o módulo ou sem trabalho.
      confirmacao,
      // Avaliação do trabalho (1 a 5 estrelas) e, depois de avaliar, o convite para a avaliação no Google
      // (docs/EMAILS-AUTOMATICOS.md): {pode, estrelas, do_pedido, google} ou null.
      avaliacao: emails()?.paraCliente(o, confirmacao) ?? null,
      resumo: resumoSimulacao(o.simulacao),
      // Pré-visualização da Área de cliente (decisão do dono, 2026-10-03): o pedido tem uma planta com divisões? (a planta
      // em si vem de GET pedidos/:id/planta, só quando é precisa.)
      tem_planta: sim?.funil !== 'avaria' && Array.isArray(sim?.planta?.divisoes) && sim.planta.divisoes.length > 0,
      fotos: fotos.listar(o, sim, `/api/conta/pedidos/${o.id}/fotos/`).map((f) => ({ id: f.id, chave: f.chave, legenda: f.legenda, url: f.url, criado: f.criado })),
      fotos_max: 40,
      mensagens,
      // Só se responde a uma conversa que a equipa começou, num pedido que não está arquivado.
      pode_responder: mensagens.some((m) => m.de === 'equipa') && o.estado !== ESTADO_ARQUIVADO && !o.anonimizado,
    };
  }

  h.pedidos = ({ res, c }) => {
    eletricistas()?.prazos();   // 7 dias sem resposta do cliente: o trabalho fica aceite (verificado ao ler)
    const linhas = db.prepare('SELECT * FROM orcamentos WHERE conta_id = ? ORDER BY id DESC LIMIT 50').all(c.id);
    responder(res, 200, { pedidos: linhas.map(pedidoParaCliente) });
  };

  /**
   * Pré-visualização da Área de cliente (decisão do dono, 2026-10-03; conta sem casa ligada): a planta que o cliente
   * desenhou neste pedido — só o desenho (divisões e aparelhos, sem a imagem de fundo nem nada técnico: o mesmo filtro
   * do relatório, pagamentos-pedido.js plantaParaRelatorio) — e o que ele disse que a casa tem (`inventario` do passo
   * "Divisões": botões de cada interruptor, tipo de cada tomada; null por responder). Só da própria conta (404 nos outros).
   */
  h.plantaPedido = ({ res, c, params }) => {
    const o = pedidoDaConta(c, params.id);
    let sim = null;
    try { sim = o.simulacao ? JSON.parse(o.simulacao) : null; } catch { sim = null; }
    const planta = sim && sim.funil !== 'avaria' ? pagamentos()?.plantaParaCliente(sim.planta) ?? null : null;
    const lista = (v, max) => (Array.isArray(v) ? v.slice(0, 400).map((x) => Math.min(max, Math.max(1, Math.round(Number(x)) || 1))) : null);
    const inventario = planta && Array.isArray(sim.inventario)
      ? sim.inventario.slice(0, 40).filter((d) => d && typeof d === 'object' && typeof d.divisao === 'string')
        .map((d) => ({ divisao: d.divisao.slice(0, 40), interruptores: lista(d.interruptores, 4), tomadas: lista(d.tomadas, 3) }))
      : null;
    responder(res, 200, { pedido: o.id, planta, inventario });
  };

  /** Pedido desta conta (404 para os outros — o cliente nem fica a saber que existe). */
  function pedidoDaConta(c, idTexto) {
    const o = db.prepare('SELECT * FROM orcamentos WHERE id = ? AND conta_id = ?').get(idNum(idTexto), c.id);
    if (!o) throw new ErroApi(404, 'Pedido não encontrado.');
    return o;
  }

  h.foto = async ({ res, c, params }) => {
    const o = pedidoDaConta(c, params.id);
    const f = RE_ID_FOTO.test(params.foto) ? fotos.obter(o.id, params.foto) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    let corpo;
    try { corpo = await fotos.ler(f); } catch { throw new ErroApi(404, 'Foto não encontrada.'); }
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': f.tipo_mime, 'Content-Length': corpo.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(corpo);
  };

  h.acrescentarFoto = async ({ req, res, c, params, ip }) => {
    const o = pedidoDaConta(c, params.id);
    if (o.estado === 'aceite' || o.estado === 'perdido' || o.cliente) throw new ErroApi(409, 'Este pedido já não aceita fotos novas. Mostre-as ao eletricista na visita.');
    esperar([[L.fotosIp, ip]]);
    contar([[L.fotosIp, ip]]);
    const f = await fotos.receber(req, o.id);
    db.prepare('UPDATE orcamentos SET atualizado = ? WHERE id = ?').run(agoraIso(), o.id);
    auditar(quem(c), 'foto_cliente', `orcamento:${o.id}`, { chave: f.chave }, ip);
    responder(res, 201, { ok: true, id: f.id });
  };

  // "Aceito a proposta" com o plano mensal escolhido (docs/PAGAMENTOS-PEDIDO.md): fica "Aceite — a aguardar sinal" e
  // devolve o pagamento do sinal (30 % menos o que já foi pago: relatório, visita, avaria); só depois de pago passa a
  // "aceite" no painel ("Proposta aceite pelo cliente (online)", data/hora/IP na auditoria). Sem pagamentos (PAGAMENTO_PEDIDO=0) ou
  // com sinal 0 fica logo aceite. Aceitar outra vez enquanto o sinal está por pagar devolve o mesmo pagamento.
  h.aceitar = async ({ req, res, c, params, ip }) => {
    const o = pedidoDaConta(c, params.id);
    const v = await lerJson(req, ['valor', 'plano', 'inicio_imediato']);
    if (o.estado === 'aceite' || o.cliente) throw new ErroApi(409, 'Esta proposta já foi aceite.');
    if (o.estado !== 'proposta_enviada' || o.valor_proposta_cent === null) throw new ErroApi(409, 'Ainda não há uma proposta para aceitar.');
    if (v.valor !== undefined && (typeof v.valor !== 'number' || Math.round(v.valor * 100) !== o.valor_proposta_cent)) {
      throw new ErroApi(409, 'A proposta mudou entretanto. Veja o valor atualizado antes de aceitar.');
    }
    const pag = pagamentos();
    const comPagamento = Boolean(pag?.ativo);
    let plano = null;
    if (v.plano !== undefined && v.plano !== null) {
      if (!['base', 'conforto', 'premium'].includes(v.plano)) falha('Escolha o plano mensal: Base, Conforto ou Premium.');
      plano = v.plano;
    }   // sem plano: as mensalidades já não se mostram ao cliente (decisão do dono, 2026-10-05); o plano fica por escolher
    const agora = agoraIso();
    if (!comPagamento) {
      const r = db.prepare(`UPDATE orcamentos SET estado = 'aceite', proposta_aceite = ?, plano_escolhido = COALESCE(?, plano_escolhido), atualizado = ?
        WHERE id = ? AND conta_id = ? AND estado = 'proposta_enviada' AND cliente IS NULL`).run(agora, plano, agora, o.id, c.id);
      if (!r.changes) throw new ErroApi(409, 'Esta proposta já foi aceite.');
      // Aceite (sem pagamentos online): o material fica reservado e a obra nasce, por agendar.
      pag?.aoFicarAceite(o.id, quem(c).email);
      auditar(quem(c), 'proposta_aceite_cliente', `orcamento:${o.id}`, { estado: 'aceite', valor_proposta: deCent(o.valor_proposta_cent), via: 'online', plano }, ip);
      registo.info(`orçamento ${o.id}: proposta aceite pelo cliente (online)`);
      return responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)), pagamento: null });
    }
    if (!o.proposta_aceite || o.plano_escolhido !== plano) {
      db.prepare(`UPDATE orcamentos SET proposta_aceite = COALESCE(proposta_aceite, ?), plano_escolhido = ?, atualizado = ?
        WHERE id = ? AND conta_id = ? AND estado = 'proposta_enviada' AND cliente IS NULL`).run(agora, plano, agora, o.id, c.id);
      if (!o.proposta_aceite) {
        auditar(quem(c), 'proposta_aceite_aguarda_sinal', `orcamento:${o.id}`, { valor_proposta: deCent(o.valor_proposta_cent), plano }, ip);
        registo.info(`orçamento ${o.id}: proposta aceite pelo cliente (online), a aguardar o sinal`);
      }
    }
    // "Quero que comecem já" (decisão 11 do dono): fica no pedido, com a data, antes de pagar o sinal.
    if (typeof v.inicio_imediato === 'boolean') pag.definirInicioImediato(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id), v.inicio_imediato, c.id, ip);
    const atual = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id);
    const pagamento = await pag.aoAceitar(c, atual);
    if (!pagamento) auditar(quem(c), 'proposta_aceite_cliente', `orcamento:${o.id}`, { estado: 'aceite', valor_proposta: deCent(o.valor_proposta_cent), via: 'online', plano, sinal: 0 }, ip);
    responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)), pagamento });
  };

  // "O trabalho ficou concluído?" (docs/ELETRICISTAS.md): Sim (1 a 5 estrelas, comentário opcional, "podem usar o meu
  // comentário no site") ou Não (o que falta). Só o dono do pedido, e só com um trabalho à espera de confirmação.
  h.confirmarTrabalho = async ({ req, res, c, params, ip }) => {
    const o = pedidoDaConta(c, params.id);
    const v = await lerJson(req, ['concluido', 'estrelas', 'comentario', 'site', 'descricao']);
    eletricistas().confirmarCliente(o, v, c, ip);
    // Avaliação baixa (1 a 3 estrelas): tarefa urgente para os CEO (docs/EMAILS-AUTOMATICOS.md).
    if (v.concluido === true) emails()?.aposAvaliar(o, v.estrelas);
    responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)) });
  };

  // "Como correu?" (docs/EMAILS-AUTOMATICOS.md): 1 a 5 estrelas, uma vez, num pedido com a obra concluída que ainda não
  // foi avaliado na confirmação do trabalho. Só o dono do pedido.
  h.avaliar = async ({ req, res, c, params, ip }) => {
    const o = pedidoDaConta(c, params.id);
    const v = await lerJson(req, ['estrelas']);
    if (!emails().paraCliente(o, eletricistas()?.paraCliente(o) ?? null)?.pode) throw new ErroApi(409, 'Este pedido não tem uma avaliação por fazer.');
    emails().avaliar(o, v.estrelas, c, ip);
    responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)) });
  };

  // Resposta do cliente na conversa do pedido (docs/ASSISTENTE-IA.md §9): só o dono do pedido, só depois de a equipa
  // lhe ter escrito. Fica na ficha do pedido no painel e nasce a tarefa "Cliente respondeu — <cliente>" para os CEO.
  h.responderMensagem = async ({ req, res, c, params }) => {
    const o = pedidoDaConta(c, params.id);
    const v = await lerJson(req, ['texto']);
    if (!pedidoParaCliente(o).pode_responder) throw new ErroApi(409, 'Este pedido não tem uma conversa a que responder.');
    const corpo = texto(v.texto, 'a sua mensagem', { max: 2000, multilinha: true, obrigatorio: true });
    esperar([[L.mensagens, String(c.id)]]);
    contar([[L.mensagens, String(c.id)]]);
    const id = Number(db.prepare("INSERT INTO mensagens_pedido (orcamento_id, de, texto, criado) VALUES (?, 'cliente', ?, ?)").run(o.id, corpo, agoraIso()).lastInsertRowid);
    auditar(quem(c), 'mensagem_cliente', `orcamento:${o.id}`, { caracteres: corpo.length });
    crm()?.ligarPedidos();
    tarefas()?.criarAutomatica('cliente_respondeu', db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id), `${o.id}:cliente_respondeu:${id}`, null);
    responder(res, 201, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)) });
  };

  // Credenciais MQTT da casa (área de cliente "Entrar com email"): só para a própria conta, com o email confirmado.
  h.casa = ({ res, c }) => {
    esperar([[L.casa, String(c.id)]]);
    contar([[L.casa, String(c.id)]]);
    const r = db.prepare('SELECT casa_codigo, casa_cifra FROM contas WHERE id = ?').get(c.id);
    const password = c.confirmado && r?.casa_cifra ? decifrar(r.casa_cifra, c.id) : null;
    if (!r?.casa_codigo || !password) {
      throw new ErroApi(404, r?.casa_codigo
        ? `A entrada com email ainda não está disponível para a sua casa. Entre com o código de cliente (${r.casa_codigo}) e a palavra-passe que recebeu.`
        : 'A sua conta ainda não tem uma casa ligada. Fica disponível depois da instalação.');
    }
    responder(res, 200, { codigo: r.casa_codigo, password });
  };

  // ------------------------------------------------------------ cifra (CONTA_CHAVE)
  // AAD = "conta:<id>": uma cifra copiada para outra conta não se lê. Etiqueta sempre de 16 bytes.
  const aad = (contaId) => Buffer.from(`conta:${contaId}`, 'utf8');
  function cifrar(texto, contaId) {
    const iv = randomBytes(12);
    const cf = createCipheriv('aes-256-gcm', config.contaChave, iv, { authTagLength: 16 });
    cf.setAAD(aad(contaId));
    const dados = Buffer.concat([cf.update(texto, 'utf8'), cf.final()]);
    return [iv, cf.getAuthTag(), dados].map((b) => b.toString('base64')).join('.');
  }
  /** Decifra (com o AAD da conta; o que foi cifrado antes, sem AAD, também se lê — e é logo cifrado de novo). */
  function decifrar(s, contaId) {
    if (!config.contaChave) return null;
    const partes = String(s).split('.');
    const [iv, tag, dados] = partes.map((b) => Buffer.from(b, 'base64'));
    const tentar = (comAad) => {
      try {
        const d = createDecipheriv('aes-256-gcm', config.contaChave, iv, { authTagLength: 16 });
        if (comAad) d.setAAD(aad(contaId));
        d.setAuthTag(tag);
        return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    };
    let texto = null;
    if (partes.length === 3 && iv.length === 12 && tag.length === 16) {
      texto = tentar(true);
      if (texto === null) {
        texto = tentar(false);
        if (texto !== null) db.prepare('UPDATE contas SET casa_cifra = ? WHERE id = ?').run(cifrar(texto, contaId), contaId);
      }
    }
    if (texto === null) registo.aviso('conta: credenciais da casa ilegíveis (CONTA_CHAVE mudou?)');
    return texto;
  }

  /**
   * Resultado de um pedido-admin (pedidos.js): um "cliente" criado a partir de um orçamento com conta liga a casa
   * à conta. A palavra-passe gerada pelo domus.sh fica cifrada (sem CONTA_CHAVE fica só o código).
   */
  function aoResultadoPedido(p, r) {
    if (p.tipo !== 'cliente' || !r.ok || !p.orcamento_id) return;
    const o = db.prepare('SELECT conta_id, cliente FROM orcamentos WHERE id = ?').get(p.orcamento_id);
    if (!o?.conta_id) return;
    const codigo = r.cliente || o.cliente || p.cliente;
    const cifra = r.password && config.contaChave ? cifrar(r.password, o.conta_id) : null;
    db.prepare('UPDATE contas SET casa_codigo = ?, casa_cifra = COALESCE(?, casa_cifra), atualizado = ? WHERE id = ?').run(codigo, cifra, agoraIso(), o.conta_id);
    auditar(null, 'conta_casa_ligada', `conta:${o.conta_id}`, { cliente: codigo, entrada_com_email: Boolean(cifra) });
  }

  // ------------------------------------------------------------ orçamento (POST /api/orcamento)
  /** Depois de um pedido com conta: guarda o contacto no perfil e apaga a simulação em curso (já foi enviada). */
  function aposOrcamento(contaId, k) {
    db.prepare(`UPDATE contas SET nome = COALESCE(?, nome), telefone = COALESCE(?, telefone), morada = COALESCE(?, morada),
      localidade = COALESCE(?, localidade), simulacao = NULL, simulacao_atualizada = NULL, atualizado = ? WHERE id = ?`)
      .run(k.nome ?? null, k.telefone ?? null, k.morada ?? null, k.localidade ?? null, agoraIso(), contaId);
  }

  /** Conta associada a um orçamento, para o painel: {id, email, confirmado, ativo} ou null. */
  function resumoParaPainel(contaId) {
    if (!contaId) return null;
    const c = db.prepare('SELECT id, email, confirmado, ativo FROM contas WHERE id = ?').get(contaId);
    return c ? { id: c.id, email: c.email, confirmado: Boolean(c.confirmado), ativo: Boolean(c.ativo) } : null;
  }

  // ------------------------------------------------------------ painel (só CEO)
  function listar() {
    return db.prepare(`SELECT c.id, c.email, c.confirmado, c.ativo, c.criado, c.ultimo_acesso, c.casa_codigo, c.nome,
      (SELECT COUNT(*) FROM orcamentos o WHERE o.conta_id = c.id) AS n_pedidos FROM contas c ORDER BY c.id DESC LIMIT 2000`).all()
      .map((c) => ({
        id: c.id, email: c.email, nome: c.nome, confirmado: Boolean(c.confirmado), ativo: Boolean(c.ativo), criado: c.criado,
        ultimo_acesso: c.ultimo_acesso, casa: c.casa_codigo, n_pedidos: c.n_pedidos,
      }));
  }

  function obterConta(idTexto) {
    const c = db.prepare('SELECT * FROM contas WHERE id = ?').get(idNum(idTexto));
    if (!c) throw new ErroApi(404, 'Conta não encontrada.');
    return c;
  }

  function definirAtivo(idTexto, ativo) {
    const c = obterConta(idTexto);
    db.prepare('UPDATE contas SET ativo = ?, atualizado = ? WHERE id = ?').run(ativo ? 1 : 0, agoraIso(), c.id);
    if (!ativo) db.prepare('DELETE FROM contas_sessoes WHERE conta_id = ?').run(c.id);
    return c;
  }

  /**
   * Apagar uma conta com os seus dados pessoais (RGPD): a conta, as sessões, os códigos, a simulação guardada e as
   * credenciais da casa; os pedidos dela que NÃO chegaram a cliente/obra (com as fotos e os detalhes no histórico).
   * Os pedidos com PAGAMENTOS PAGOS não se apagam: são ANONIMIZADOS (saem o nome, os contactos, a morada, a mensagem,
   * as notas, a simulação e as fotos; ficam o id, as datas, os valores, as referências e a descrição do serviço/proposta)
   * e os pagamentos continuam ligados a eles — retenção contabilística de 10 anos (docs/CONTA-CLIENTE.md).
   * Os pedidos convertidos em cliente e obra ficam (contrato e faturação), só perdem a ligação à conta.
   */
  async function apagar(idTexto) {
    const c = obterConta(idTexto);
    // Pedidos ainda sem casa ligada (não convertidos). A obra nasce com o sinal pago, antes da casa: um pedido com obra
    // (ou com pagamentos pagos ou devolvidos) não se apaga, é anonimizado; a obra fica, ligada ao pedido anonimizado.
    const semObra = db.prepare('SELECT id FROM orcamentos o WHERE conta_id = ? AND cliente IS NULL').all(c.id).map((x) => x.id);
    const pago = db.prepare(`SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ?1 AND estado IN ('pago', 'devolvido')
      UNION ALL SELECT 1 FROM obras WHERE orcamento_id = ?1 LIMIT 1`);
    const anonimizar = semObra.filter((id) => pago.get(id));
    const alvos = semObra.filter((id) => !anonimizar.includes(id));
    const mantidos = db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE conta_id = ?').get(c.id).n - semObra.length;
    // … com as fotos do pedido saem as que o eletricista externo tirou na casa (docs/ELETRICISTAS.md).
    for (const id of semObra) { await fotos.apagarTodas(id); await aoApagarPedido(id); }
    // CRM (docs/CRM-TAREFAS.md): as fichas de cliente desta conta, lidas antes de os pedidos saírem.
    const fichasCrm = crm()?.clientesDaConta(c.id) ?? [];
    db.exec('BEGIN IMMEDIATE');
    try {
      // Emails automáticos (docs/EMAILS-AUTOMATICOS.md): o registo dos envios dos pedidos desta conta (também dos que
      // ficam, anonimizados ou convertidos) e a recusa "Não quero receber" deste email saem com ela.
      db.prepare('DELETE FROM emails_automaticos WHERE orcamento_id IN (SELECT id FROM orcamentos WHERE conta_id = ?)').run(c.id);
      db.prepare('DELETE FROM emails_recusados WHERE email = ?').run(String(c.email).toLowerCase());
      // Auditoria: o histórico dos pedidos apagados/anonimizados e da conta sai (com os IPs e os detalhes); de cada
      // pedido fica só uma linha "apagado (RGPD)" / "anonimizado (RGPD)" sem dados pessoais (a da conta é a
      // "conta_apagada" que o chamador escreve). Nas linhas que ficam (pedidos convertidos, mantidos) sai o IP da conta.
      // Pagamentos: os por pagar saem (com o pedido guardado); os pagos ficam (contabilidade), ligados ao pedido
      // (anonimizado ou mantido), sem a conta.
      // Devoluções por transferência: das já feitas sai o titular (do IBAN já só ficava o fim); uma ainda por fazer
      // guarda o IBAN até o CEO a fazer (é preciso para devolver o dinheiro).
      db.prepare("UPDATE devolucoes_pedido SET titular = NULL WHERE conta_id = ? AND estado = 'devolvido'").run(c.id);
      db.prepare("DELETE FROM pagamentos_pedido WHERE conta_id = ? AND estado NOT IN ('pago', 'devolvido')").run(c.id);
      db.prepare('UPDATE pagamentos_pedido SET pedido = NULL, conta_id = NULL WHERE conta_id = ?').run(c.id);
      for (const id of alvos) {
        db.prepare("DELETE FROM pagamentos_pedido WHERE orcamento_id = ? AND estado NOT IN ('pago', 'devolvido')").run(id);
        db.prepare('DELETE FROM orcamentos WHERE id = ?').run(id);
        db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`orcamento:${id}`);
        auditar(null, 'orcamento_apagado_rgpd', `orcamento:${id}`);
      }
      const agora = agoraIso();
      for (const id of anonimizar) {
        db.prepare("DELETE FROM pagamentos_pedido WHERE orcamento_id = ? AND estado NOT IN ('pago', 'devolvido')").run(id);
        db.prepare('DELETE FROM fotos_tokens WHERE orcamento_id = ?').run(id);
        db.prepare('DELETE FROM mensagens_pedido WHERE orcamento_id = ?').run(id);
        db.prepare(`UPDATE orcamentos SET nome = 'Anonimizado (RGPD)', telefone = NULL, email = NULL, localidade = NULL, morada = NULL,
          mensagem = NULL, notas = NULL, motivo_perda = NULL, simulacao = NULL, leitura_quadro = NULL, codigo_cliente = NULL,
          ensaios = NULL, esquema_quadro = NULL, diagnostico = NULL, ia = NULL,
          conta_id = NULL, anonimizado = ?, estado = ?, atualizado = ? WHERE id = ?`).run(agora, ESTADO_ARQUIVADO, agora, id);
        db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`orcamento:${id}`);
        auditar(null, 'orcamento_anonimizado_rgpd', `orcamento:${id}`, { estado: ESTADO_ARQUIVADO, pagamentos_mantidos: db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ?').get(id).n });
      }
      // CRM: as notas e os contactos saem, as tarefas ficam só com um título neutro e a ficha é anonimizada.
      crm()?.aoApagarConta(fichasCrm, semObra, c.id);
      db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`conta:${c.id}`);
      db.prepare('UPDATE auditoria SET ip = NULL WHERE email = ?').run(`conta:${c.id}`);
      db.prepare('DELETE FROM contas WHERE id = ?').run(c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { conta: c.id, pedidos_apagados: alvos.length, pedidos_anonimizados: anonimizar.length, pedidos_mantidos: mantidos };
  }

  // O cliente apaga a própria conta (RGPD, "Apagar a minha conta" em conta.html): confirma com a palavra-passe atual
  // ou, sem palavra-passe, com um código para entrar (POST codigo com o email da conta; tipo 'entrar', uso único);
  // qualquer sessão (também por confirmar). O rasto fica como 'conta_apagada' pelo próprio (sem email: sai com a conta);
  // a sessão acaba (todas as sessões saem com a conta) e o cookie é apagado.
  h.apagarConta = async ({ req, res, c, ip }) => {
    const v = await lerJson(req, ['password', 'codigo']);
    const codigo = typeof v.codigo === 'string' ? v.codigo.replace(/\s/g, '') : '';
    if (!codigo && (typeof v.password !== 'string' || !v.password)) falha(c.tem_password ? 'Escreva a palavra-passe para confirmar.' : 'Escreva o código que lhe enviámos para confirmar.');
    esperar([[L.apagarIp, ip]]);
    contar([[L.apagarIp, ip]]);
    if (codigo) {
      const r = c.confirmado && RE_CODIGO.test(codigo) ? verificarCodigo(c.id, 'entrar', codigo) : { r: 'errado' };
      if (r.r !== 'ok') throw new ErroApi(403, 'Código errado ou expirado. Peça um código novo.');
    } else {
      const linha = db.prepare('SELECT hash FROM contas WHERE id = ?').get(c.id);
      if (v.password.length > 200 || !(await verificarSenha(v.password, linha?.hash))) throw new ErroApi(403, 'Palavra-passe errada.');
    }
    const r = await apagar(String(c.id));
    auditar(null, 'conta_apagada', `conta:${r.conta}`, { por: 'cliente', pedidos_apagados: r.pedidos_apagados, pedidos_anonimizados: r.pedidos_anonimizados, pedidos_mantidos: r.pedidos_mantidos });
    responder(res, 200, { ok: true, pedidos_apagados: r.pedidos_apagados, pedidos_anonimizados: r.pedidos_anonimizados, pedidos_mantidos: r.pedidos_mantidos }, { 'Set-Cookie': cookieApagar(req) });
  };

  // ------------------------------------------------------------ retenção (coerente com a das fotos)
  async function apagarRetidas() {
    const agora = relogio();
    let n = 0;
    db.prepare('DELETE FROM contas_sessoes WHERE expira < ? OR criada < ?').run(agora, agora - config.contaSessaoMaxMs);
    db.prepare('DELETE FROM contas_codigos WHERE expira < ?').run(agora);
    // Contas sem email confirmado ao fim de 30 dias (não podem ter pedidos).
    for (const { id } of db.prepare('SELECT id FROM contas WHERE confirmado IS NULL AND criado < ?').all(iso(agora - NAO_CONFIRMADA_MS))) {
      await apagar(String(id));
      auditar(null, 'conta_apagada_retencao', `conta:${id}`, { criterio: 'email por confirmar há 30 dias' });
      n++;
    }
    // Contas sem acesso há 12 meses, sem casa ligada e com todos os pedidos sem seguimento há 12 meses
    // (o mesmo critério das fotos: não aceite, nunca convertido, sem alterações).
    const limite = iso(agora - RETENCAO_MS);
    const velhas = db.prepare(`SELECT c.id FROM contas c WHERE COALESCE(c.ultimo_acesso, c.criado) < ? AND c.casa_codigo IS NULL
      AND NOT EXISTS (SELECT 1 FROM orcamentos o WHERE o.conta_id = c.id AND (o.estado = 'aceite' OR o.obra_id IS NOT NULL OR o.atualizado >= ?))`).all(limite, limite);
    for (const { id } of velhas) {
      const r = await apagar(String(id));
      auditar(null, 'conta_apagada_retencao', `conta:${id}`, { criterio: '12 meses sem seguimento', pedidos_apagados: r.pedidos_apagados });
      n++;
    }
    db.prepare('UPDATE contas SET simulacao = NULL, simulacao_atualizada = NULL WHERE simulacao_atualizada < ?').run(limite);
    // Pedidos anonimizados (RGPD): saem com os pagamentos 10 anos depois do último pagamento (retenção contabilística).
    const dezAnos = iso(agora - 10 * 365.25 * 24 * 3600_000);
    const velhos = db.prepare(`SELECT id FROM orcamentos o WHERE anonimizado IS NOT NULL AND anonimizado < ?
      AND NOT EXISTS (SELECT 1 FROM pagamentos_pedido p WHERE p.orcamento_id = o.id AND COALESCE(p.pago, p.criado) >= ?)`).all(dezAnos, dezAnos);
    for (const { id } of velhos) {
      db.prepare('DELETE FROM pagamentos_pedido WHERE orcamento_id = ?').run(id);
      db.prepare('DELETE FROM orcamentos WHERE id = ? AND obra_id IS NULL').run(id);
      auditar(null, 'orcamento_apagado_retencao', `orcamento:${id}`, { criterio: '10 anos depois do último pagamento (anonimizado)' });
    }
    if (n) registo.info(`retenção: ${n} contas de cliente apagadas`);
    return n;
  }

  let temporizador = null;
  let primeira = null;
  function iniciar(intervaloMs = 24 * 3600_000) {
    const correr = () => apagarRetidas().catch((e) => registo.erro(`retenção das contas: ${e?.stack || e}`));
    temporizador = setInterval(correr, intervaloMs);
    temporizador.unref();
    primeira = setTimeout(correr, 90_000);
    primeira.unref();
  }
  function parar() {
    clearInterval(temporizador);
    clearTimeout(primeira);
  }

  // ------------------------------------------------------------ despacho /api/conta/*
  // [método, caminho, precisa de sessão ("sessao" | "confirmada" | null), handler]
  const ROTAS_CONTA = [
    ['POST', 'criar', null, 'criar'],
    ['POST', 'continuar', null, 'continuar'],   // {email} → {existe}; com conta manda o código, sem conta não cria nada
    ['POST', 'codigo', null, 'codigo'],
    ['POST', 'entrar', null, 'entrar'],
    ['POST', 'sair', null, 'sair'],
    ['POST', 'esqueci', null, 'esqueci'],
    ['POST', 'repor', null, 'repor'],
    ['GET', 'eu', 'sessao', 'eu'],
    ['POST', 'confirmar', 'opcional', 'confirmar'],
    ['POST', 'reenviar', 'sessao', 'reenviar'],
    ['POST', 'palavra-passe', 'confirmada', 'definirSenha'],
    ['GET', 'simulacao', 'sessao', 'lerSimulacao'],
    ['POST', 'simulacao', 'sessao', 'guardarSimulacao'],
    ['GET', 'pedidos', 'confirmada', 'pedidos'],
    ['GET', 'pedidos/:id/planta', 'confirmada', 'plantaPedido'],
    ['GET', 'pedidos/:id/fotos/:foto', 'confirmada', 'foto'],
    ['POST', 'pedidos/:id/fotos', 'confirmada', 'acrescentarFoto'],
    ['POST', 'pedidos/:id/aceitar', 'confirmada', 'aceitar'],
    ['POST', 'pedidos/:id/avaliar', 'confirmada', 'avaliar'],
    ['POST', 'pedidos/:id/mensagens', 'confirmada', 'responderMensagem'],
    // Só com o módulo dos eletricistas ligado (ELETRICISTAS=1); sem ele a rota não existe (404).
    ...(config.eletricistas ? [['POST', 'pedidos/:id/confirmar-trabalho', 'confirmada', 'confirmarTrabalho']] : []),
    ['GET', 'casa', 'confirmada', 'casa'],
    ['POST', 'casa-registada', 'confirmada', 'registarCasa'],
    ['POST', 'apagar', 'sessao', 'apagarConta'],
  ].map(([metodo, caminho, sessao, nome]) => ({ metodo, partes: caminho.split('/'), caminho, sessao, nome }));

  async function tratar(req, res, url, ip) {
    const segs = url.pathname.slice('/api/conta/'.length).split('/');
    let rota = null;
    let params = {};
    let existe = false;
    for (const r of ROTAS_CONTA) {
      if (r.partes.length !== segs.length) continue;
      const p = {};
      if (!r.partes.every((x, i) => (x.startsWith(':') ? (p[x.slice(1)] = segs[i]) !== '' : x === segs[i]))) continue;
      existe = true;
      if (r.metodo === req.method || (req.method === 'HEAD' && r.metodo === 'GET')) { rota = r; params = p; break; }
    }
    if (!rota) return responder(res, existe ? 405 : 404, { erro: existe ? 'Método não permitido.' : 'Endereço desconhecido.' });
    if (rota.metodo === 'POST') {
      if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
      if (rota.nome !== 'acrescentarFoto' && !tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    }
    let c = null;
    if (rota.sessao === 'opcional') c = sessao(req, res);
    else if (rota.sessao) {
      c = sessao(req, res);
      if (!c) throw new ErroApi(401, 'Sessão inválida ou expirada. Entre de novo na sua conta.');
      if (rota.sessao === 'confirmada' && !c.confirmado) throw new ErroApi(403, 'Confirme primeiro o seu email com o código que lhe enviámos.');
    }
    return h[rota.nome]({ req, res, c, params, url, ip });
  }

  return {
    tratar, sessao, aposOrcamento, aoResultadoPedido, resumoParaPainel, listar, definirAtivo, apagar, apagarRetidas,
    iniciar, parar, ROTAS_CONTA,
    abrirSessao, publico,   // só para o acesso rápido de testes (acesso-rapido.js)
  };
}
