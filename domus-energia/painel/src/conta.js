// Conta de cliente (docs/CONTA-CLIENTE.md): /api/conta/*, servida pelo painel.
// - email + palavra-passe (scrypt, as regras do painel); email confirmado por código de 6 dígitos (15 min,
//   5 tentativas); "criar conta" e "esqueci a palavra-passe" respondem sempre o mesmo (nunca dizem se o email
//   tem conta); a sessão abre ao confirmar o código;
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
  novo: 'Pedido recebido. Vamos contactá-lo para marcar a visita técnica (incluída nos 19 €, descontados na obra).',
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
  const p = (k, um, varios) => (k ? `${k} ${k === 1 ? um : varios}` : null);
  const PACOTES = { essencial: 'Proteção básica no quadro elétrico', recomendado: 'Proteção recomendada no quadro elétrico', completo: 'Proteção completa no quadro elétrico' };
  const inclui = [
    p(conta.interruptores, 'interruptor inteligente (luzes pelo telemóvel)', 'interruptores inteligentes (luzes pelo telemóvel)'),
    p(conta.reguladas, 'luz com intensidade regulável', 'luzes com intensidade regulável'),
    p(conta.estores, 'estore automático', 'estores automáticos'),
    p(conta.movimento, 'sensor de movimento', 'sensores de movimento'),
    p(conta.porta, 'aviso de porta ou janela aberta', 'avisos de porta ou janela aberta'),
    p(conta.tomadas, 'tomada inteligente', 'tomadas inteligentes'),
    PACOTES[s.quadro?.pacote] ?? null,
  ].filter(Boolean);
  const PLANOS = { base: 'Base', conforto: 'Conforto', premium: 'Premium' };
  const min = Number.isFinite(s.total?.min) ? s.total.min : null;
  const max = Number.isFinite(s.total?.max) ? s.total.max : null;
  return {
    casa: [tipo, typeof casa.tipologia === 'string' ? casa.tipologia : null].filter(Boolean).join(' ') || null,
    localidade: typeof casa.localidade === 'string' ? casa.localidade.slice(0, 80) : null,
    divisoes: divisoes.length || (Number.isInteger(casa.divisoes) ? casa.divisoes : null),
    inclui,
    plano: PLANOS[s.plano_sugerido] ?? null,
    estimativa: min !== null && max !== null ? { min, max } : null,
  };
}

/**
 * @param {{db, config, registo, relogio: () => number, auditar: Function, fotos: object, correio: object}} ctx
 */
export function criarContas({ db, config, registo, relogio, auditar, fotos, correio, pagamentos = () => null }) {
  const agoraIso = () => iso(relogio());
  const lim = (n, ms) => new LimiteTaxa(n, ms, relogio);
  const L = {
    criarIp: lim(5, 3600_000), criarEmail: lim(3, 3600_000),
    // Entrar: por IP e por par email+IP; por email só um travão alto (um terceiro não consegue bloquear a conta).
    entrarIp: lim(10, 60_000), entrarPar: lim(5, 60_000), entrarEmail: lim(50, 3600_000),
    codigoIp: lim(20, 3600_000), reporEmail: lim(10, 3600_000),
    // Emails por email, com quotas separadas: um terceiro que chama "criar" com o email de outra pessoa não gasta a
    // quota do "Esqueci" (código de repor) e só faz chegar 1 aviso "já tem conta" por hora.
    emailEnvio: lim(3, 3600_000), reporEnvio: lim(3, 3600_000), avisoConta: lim(1, 3600_000), emailIp: lim(10, 3600_000),
    esqueciIp: lim(5, 3600_000),
    simulacao: lim(120, 3600_000),
    fotosIp: lim(config.limiteFotosHora, 3600_000),
    casa: lim(30, 3600_000),
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
      id: s.conta_id, email: s.email, confirmado: Boolean(s.confirmado), sessao: id,
      nome: s.nome, telefone: s.telefone, morada: s.morada, localidade: s.localidade,
      simulacao_atualizada: s.simulacao_atualizada, casa_codigo: s.casa_codigo, sessaoExpira: iso(s.expira),
    };
  }

  const publico = (c) => ({
    email: c.email, confirmado: Boolean(c.confirmado),
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
    const assunto = tipo === 'confirmar' ? 'Domus Energia: confirme o seu email' : 'Domus Energia: mudar a palavra-passe';
    const texto = [
      'Olá,',
      '',
      tipo === 'confirmar'
        ? 'Para confirmar o seu email na Domus Energia, escreva este código:'
        : 'Pediu para mudar a palavra-passe da sua conta Domus Energia. Escreva este código:',
      '',
      `    ${codigo}`,
      '',
      'O código vale 15 minutos.',
      tipo === 'repor' ? 'Se não foi você, ignore este email: a sua palavra-passe continua a mesma.' : 'Se não foi você, ignore este email.',
      ...(site ? ['', `A sua conta: ${site}`] : []),
      '',
      'Domus Energia',
    ].join('\n');
    return correio.enviar({ para: email, assunto, texto, resumo: `código ${codigo} (${tipo === 'confirmar' ? 'confirmar o email' : 'mudar a palavra-passe'})` });
  }

  /** "Criar conta" com um email que já tem conta: vai este aviso em vez do código (a resposta ao browser é a mesma). */
  function enviarAvisoConta(email) {
    const site = config.siteUrl ? `${config.siteUrl}/conta.html` : null;
    const texto = [
      'Olá,',
      '',
      'Alguém tentou criar uma conta na Domus Energia com este email, mas já existe uma conta com ele.',
      '',
      'Se foi você, entre com a sua palavra-passe, ou use "Esqueci a palavra-passe" para receber um código e escolher uma nova.',
      'Se não foi você, ignore este email: a sua conta continua igual.',
      ...(site ? ['', `A sua conta: ${site}`] : []),
      '',
      'Domus Energia',
    ].join('\n');
    return correio.enviar({ para: email, assunto: 'Domus Energia: já tem conta com este email', texto, resumo: 'aviso: pediram para criar conta com um email que já tem conta' });
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

  // Criar conta: a resposta é sempre a mesma (não revela se o email já tem conta) e não abre sessão — a sessão abre
  // ao confirmar o código (POST confirmar com email, palavra-passe e código). Email novo → conta por confirmar e
  // código; conta por confirmar com a mesma palavra-passe → código novo; qualquer outra conta → aviso por email.
  h.criar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'password']);
    const email = emailValido(v.email);
    const prob = problemaSenha(v.password);
    if (prob) falha(prob);
    esperar([[L.criarIp, ip], [L.criarEmail, email]]);
    contar([[L.criarIp, ip], [L.criarEmail, email]]);
    const existe = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    // Acima de cada quota, em silêncio (a resposta é a mesma): códigos de confirmar 3/hora por email; avisos 1/hora.
    const pode = (l) => { if (l.espera(email)) return false; l.registar(email); return true; };
    if (!existe) {
      const agora = agoraIso();
      const id = Number(db.prepare('INSERT INTO contas (email, hash, criado, atualizado) VALUES (?, ?, ?, ?)')
        .run(email, await hashSenha(v.password), agora, agora).lastInsertRowid);
      auditar(quem({ id }), 'conta_criada', `conta:${id}`, null, ip);
      if (pode(L.emailEnvio)) enviarCodigo(email, 'confirmar', novoCodigo(id, 'confirmar'));
    } else {
      const mesma = await verificarSenha(v.password, existe.hash);   // scrypt nos dois casos: tempo parecido
      if (mesma && existe.ativo && !existe.confirmado) { if (pode(L.emailEnvio)) enviarCodigo(email, 'confirmar', novoCodigo(existe.id, 'confirmar')); }
      else if (pode(L.avisoConta)) enviarAvisoConta(email);
    }
    responder(res, 201, { ok: true, email, mensagem: 'Enviámos um código para o email. Veja também o correio não desejado (spam).' });
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
      throw new ErroApi(401, 'Email ou palavra-passe errados. Se criou a conta e ainda não confirmou o email, use "Criar conta" outra vez, com a mesma palavra-passe, para receber um código novo.');
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

  h.eu = ({ res, c }) => responder(res, 200, {
    conta: publico(c), simulacao_atualizada: c.simulacao_atualizada ?? null,
    tem_casa: Boolean(c.casa_codigo), sessao_expira: c.sessaoExpira,
    // Pagamentos do pedido: {ativo, modo, demonstracao…} (a conta mostra a faixa "Modo de demonstração").
    pagamentos: pagamentos()?.info() ?? null,
  });

  // Confirmar o email. Sem sessão (depois de "Criar conta"): {email, password, codigo}, sempre a mesma resposta de
  // erro; as tentativas do código só contam com a palavra-passe certa (um terceiro não o gasta); abre a sessão.
  // Com sessão (contas por confirmar com sessão aberta antes desta versão): {codigo}, com as mensagens detalhadas.
  h.confirmar = async ({ req, res, c, ip }) => {
    if (!c) return confirmarSemSessao({ req, res, ip });
    const v = await lerJson(req, ['codigo']);
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

  async function confirmarSemSessao({ req, res, ip }) {
    const v = await lerJson(req, ['email', 'password', 'codigo']);
    const email = emailValido(v.email);
    if (typeof v.password !== 'string' || !v.password || v.password.length > 200) falha('Indique a palavra-passe da conta.');
    esperar([[L.codigoIp, ip]]);
    contar([[L.codigoIp, ip]]);
    const codigo = String(v.codigo ?? '').replace(/\s/g, '');
    if (!RE_CODIGO.test(codigo)) falha('O código tem 6 algarismos.');
    const c = db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    const ok = await verificarSenha(v.password, c?.hash);
    const r = ok && c.ativo && !c.confirmado ? verificarCodigo(c.id, 'confirmar', codigo) : { r: 'errado' };
    if (r.r !== 'ok') throw new ErroApi(400, ERRO_CODIGO);
    const agora = agoraIso();
    db.prepare('UPDATE contas SET confirmado = ?, atualizado = ? WHERE id = ?').run(agora, agora, c.id);
    auditar(quem(c), 'conta_email_confirmado', `conta:${c.id}`, null, ip);
    const ck = abrirSessao(req, c.id);
    responder(res, 200, { conta: publico(db.prepare('SELECT * FROM contas WHERE id = ?').get(c.id)) }, { 'Set-Cookie': ck });
  }

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

  const obraDe = db.prepare('SELECT data, hora, estado FROM obras WHERE id = ?');
  function pedidoParaCliente(o) {
    const obra = o.obra_id ? obraDe.get(o.obra_id) : null;
    const valor = deCent(o.valor_proposta_cent);
    const pag = pagamentos()?.paraCliente(o) ?? null;
    const temProposta = valor !== null && ['proposta_enviada', 'aceite'].includes(o.estado);
    const depoisVisita = ['proposta_enviada', 'aceite'].includes(o.estado) || Boolean(obra);
    const passos = [
      { chave: 'recebido', texto: 'Pedido recebido', feito: true, data: o.criado },
      { chave: 'visita', texto: 'Visita técnica', feito: Boolean(o.data_visita) || depoisVisita, data: o.data_visita },
      { chave: 'proposta', texto: 'Proposta', feito: temProposta },
      { chave: 'aceite', texto: 'Proposta aceite', feito: o.estado === 'aceite' || Boolean(obra), data: o.estado === 'aceite' ? o.proposta_aceite : null },
      { chave: 'obra', texto: obra?.estado === 'concluida' ? 'Instalação concluída' : 'Instalação', feito: Boolean(obra), data: obra?.data ?? null },
    ];
    let estadoTexto = TEXTO_ESTADO[o.estado] ?? 'Pedido recebido.';
    if (pag?.aguarda_sinal) estadoTexto = 'Proposta aceite — falta pagar o sinal para confirmarmos a instalação.';
    if (o.estado === 'aceite' && o.obra_concluida && !obra) estadoTexto = 'Obra concluída.';
    if (obra) estadoTexto = obra.estado === 'concluida' ? 'Instalação concluída.' : obra.estado === 'cancelada' ? 'Instalação cancelada. Vamos contactá-lo.' : 'Instalação marcada.';
    const podeFotos = !['aceite', 'perdido'].includes(o.estado) && !o.obra_id;
    let sim = null;
    try { sim = o.simulacao ? JSON.parse(o.simulacao) : null; } catch { sim = null; }
    return {
      id: o.id, criado: o.criado, estado: o.estado, estado_texto: estadoTexto, passos,
      data_visita: o.data_visita, servico: o.servico,
      proposta: temProposta ? { valor, texto: o.proposta_texto ?? null, aceite: o.proposta_aceite ?? null } : null,
      pode_aceitar: o.estado === 'proposta_enviada' && valor !== null && !o.obra_id && !o.proposta_aceite,
      plano_sugerido: ['base', 'conforto', 'premium'].includes(sim?.plano_sugerido) ? sim.plano_sugerido : null,
      ...(pag ?? {}),
      pode_fotos: podeFotos,
      obra: obra ? { data: obra.data, hora: obra.hora, estado: obra.estado } : null,
      resumo: resumoSimulacao(o.simulacao),
      fotos: fotos.listar(o, sim, `/api/conta/pedidos/${o.id}/fotos/`).map((f) => ({ id: f.id, chave: f.chave, legenda: f.legenda, url: f.url, criado: f.criado })),
      fotos_max: 40,
    };
  }

  h.pedidos = ({ res, c }) => {
    const linhas = db.prepare('SELECT * FROM orcamentos WHERE conta_id = ? ORDER BY id DESC LIMIT 50').all(c.id);
    responder(res, 200, { pedidos: linhas.map(pedidoParaCliente) });
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
    if (o.estado === 'aceite' || o.estado === 'perdido' || o.obra_id) throw new ErroApi(409, 'Este pedido já não aceita fotos novas. Mostre-as ao eletricista na visita.');
    esperar([[L.fotosIp, ip]]);
    contar([[L.fotosIp, ip]]);
    const f = await fotos.receber(req, o.id);
    db.prepare('UPDATE orcamentos SET atualizado = ? WHERE id = ?').run(agoraIso(), o.id);
    auditar(quem(c), 'foto_cliente', `orcamento:${o.id}`, { chave: f.chave }, ip);
    responder(res, 201, { ok: true, id: f.id });
  };

  // "Aceito a proposta" com o plano mensal escolhido (docs/PAGAMENTOS-PEDIDO.md): fica "Aceite — a aguardar sinal" e
  // devolve o pagamento do sinal (30 % menos os 19 € já pagos); só depois de pago passa a "aceite" no painel
  // ("Proposta aceite pelo cliente (online)", data/hora/IP na auditoria). Sem pagamentos (PAGAMENTO_PEDIDO=0) ou
  // com sinal 0 fica logo aceite. Aceitar outra vez enquanto o sinal está por pagar devolve o mesmo pagamento.
  h.aceitar = async ({ req, res, c, params, ip }) => {
    const o = pedidoDaConta(c, params.id);
    const v = await lerJson(req, ['valor', 'plano']);
    if (o.estado === 'aceite' || o.obra_id) throw new ErroApi(409, 'Esta proposta já foi aceite.');
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
    } else if (comPagamento) falha('Escolha o plano mensal: Base, Conforto ou Premium.');
    const agora = agoraIso();
    if (!comPagamento) {
      const r = db.prepare(`UPDATE orcamentos SET estado = 'aceite', proposta_aceite = ?, plano_escolhido = COALESCE(?, plano_escolhido), atualizado = ?
        WHERE id = ? AND conta_id = ? AND estado = 'proposta_enviada' AND obra_id IS NULL`).run(agora, plano, agora, o.id, c.id);
      if (!r.changes) throw new ErroApi(409, 'Esta proposta já foi aceite.');
      auditar(quem(c), 'proposta_aceite_cliente', `orcamento:${o.id}`, { estado: 'aceite', valor_proposta: deCent(o.valor_proposta_cent), via: 'online', plano }, ip);
      registo.info(`orçamento ${o.id}: proposta aceite pelo cliente (online)`);
      return responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)), pagamento: null });
    }
    if (!o.proposta_aceite || o.plano_escolhido !== plano) {
      db.prepare(`UPDATE orcamentos SET proposta_aceite = COALESCE(proposta_aceite, ?), plano_escolhido = ?, atualizado = ?
        WHERE id = ? AND conta_id = ? AND estado = 'proposta_enviada' AND obra_id IS NULL`).run(agora, plano, agora, o.id, c.id);
      if (!o.proposta_aceite) {
        auditar(quem(c), 'proposta_aceite_aguarda_sinal', `orcamento:${o.id}`, { valor_proposta: deCent(o.valor_proposta_cent), plano }, ip);
        registo.info(`orçamento ${o.id}: proposta aceite pelo cliente (online), a aguardar o sinal`);
      }
    }
    const atual = db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id);
    const pagamento = await pag.aoAceitar(c, atual);
    if (!pagamento) auditar(quem(c), 'proposta_aceite_cliente', `orcamento:${o.id}`, { estado: 'aceite', valor_proposta: deCent(o.valor_proposta_cent), via: 'online', plano, sinal: 0 }, ip);
    responder(res, 200, { pedido: pedidoParaCliente(db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(o.id)), pagamento });
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
    const semObra = db.prepare(`SELECT id FROM orcamentos o WHERE conta_id = ? AND obra_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM obras b WHERE b.orcamento_id = o.id)`).all(c.id).map((x) => x.id);
    const pago = db.prepare('SELECT 1 FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = \'pago\' LIMIT 1');
    const anonimizar = semObra.filter((id) => pago.get(id));
    const alvos = semObra.filter((id) => !anonimizar.includes(id));
    const mantidos = db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE conta_id = ?').get(c.id).n - semObra.length;
    for (const id of semObra) await fotos.apagarTodas(id);
    db.exec('BEGIN IMMEDIATE');
    try {
      // Auditoria: o histórico dos pedidos apagados/anonimizados e da conta sai (com os IPs e os detalhes); de cada
      // pedido fica só uma linha "apagado (RGPD)" / "anonimizado (RGPD)" sem dados pessoais (a da conta é a
      // "conta_apagada" que o chamador escreve). Nas linhas que ficam (pedidos convertidos, mantidos) sai o IP da conta.
      // Pagamentos: os por pagar saem (com o pedido guardado); os pagos ficam (contabilidade), ligados ao pedido
      // (anonimizado ou mantido), sem a conta.
      db.prepare('DELETE FROM pagamentos_pedido WHERE conta_id = ? AND estado != \'pago\'').run(c.id);
      db.prepare('UPDATE pagamentos_pedido SET pedido = NULL, conta_id = NULL WHERE conta_id = ?').run(c.id);
      for (const id of alvos) {
        db.prepare('DELETE FROM pagamentos_pedido WHERE orcamento_id = ? AND estado != \'pago\'').run(id);
        db.prepare('DELETE FROM orcamentos WHERE id = ?').run(id);
        db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`orcamento:${id}`);
        auditar(null, 'orcamento_apagado_rgpd', `orcamento:${id}`);
      }
      const agora = agoraIso();
      for (const id of anonimizar) {
        db.prepare('DELETE FROM pagamentos_pedido WHERE orcamento_id = ? AND estado != \'pago\'').run(id);
        db.prepare('DELETE FROM fotos_tokens WHERE orcamento_id = ?').run(id);
        db.prepare(`UPDATE orcamentos SET nome = 'Anonimizado (RGPD)', telefone = NULL, email = NULL, localidade = NULL, morada = NULL,
          mensagem = NULL, notas = NULL, motivo_perda = NULL, simulacao = NULL, leitura_quadro = NULL, codigo_cliente = NULL,
          conta_id = NULL, anonimizado = ?, atualizado = ? WHERE id = ?`).run(agora, agora, id);
        db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`orcamento:${id}`);
        auditar(null, 'orcamento_anonimizado_rgpd', `orcamento:${id}`, { pagamentos_mantidos: db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ?').get(id).n });
      }
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
    ['POST', 'entrar', null, 'entrar'],
    ['POST', 'sair', null, 'sair'],
    ['POST', 'esqueci', null, 'esqueci'],
    ['POST', 'repor', null, 'repor'],
    ['GET', 'eu', 'sessao', 'eu'],
    ['POST', 'confirmar', 'opcional', 'confirmar'],
    ['POST', 'reenviar', 'sessao', 'reenviar'],
    ['GET', 'simulacao', 'sessao', 'lerSimulacao'],
    ['POST', 'simulacao', 'sessao', 'guardarSimulacao'],
    ['GET', 'pedidos', 'confirmada', 'pedidos'],
    ['GET', 'pedidos/:id/fotos/:foto', 'confirmada', 'foto'],
    ['POST', 'pedidos/:id/fotos', 'confirmada', 'acrescentarFoto'],
    ['POST', 'pedidos/:id/aceitar', 'confirmada', 'aceitar'],
    ['GET', 'casa', 'confirmada', 'casa'],
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
  };
}
