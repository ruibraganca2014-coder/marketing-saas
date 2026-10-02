// Eletricistas externos (fase 4, ronda 1; docs/ELETRICISTAS.md): /api/eletricista/*, servido pelo painel.
// - candidatura pública ("Trabalhe connosco"): dados, concelhos, n.º DGEG e o documento do seguro de responsabilidade
//   civil (PDF/JPEG/PNG até 5 MB, verificado pelos bytes; guardado em ELETRICISTAS_DIR, fora da pasta pública); limite
//   por IP, campo-armadilha, consentimento; a resposta é sempre a mesma (não diz se o email já tem candidatura);
// - o CEO aprova, recusa, suspende e reativa no painel (rotas /painel/api/eletricistas*, declaradas em api.js);
// - área do eletricista: entra com o email e um código de 6 dígitos (como a conta de cliente), com sessão PRÓPRIA —
//   cookie `domus_eletricista` (HttpOnly, SameSite=Lax, Path=/api/eletricista) guardado como SHA-256 na tabela
//   eletricistas_sessoes. Não abre nenhuma rota da conta de cliente nem do painel, e vice-versa. Só entra quem está
//   `aprovado` (verificado em CADA pedido: suspender fecha logo as sessões);
// - bolsa: só os trabalhos cujo concelho está nos concelhos do eletricista; ANTES de aceitar a resposta leva só o
//   concelho, o tipo de trabalho, as horas/dias estimados, o que ele recebe e o relatório técnico SEM preços e sem
//   nada do cliente (montado aqui, campo a campo: nunca se envia a linha do pedido); aceitar é atómico (o primeiro
//   fica com o trabalho, o segundo recebe 409);
// - depois de aceite (ou atribuído pelo CEO): nome, morada e telefone do cliente enquanto o trabalho está aberto, 48 h
//   para marcar a visita (senão volta à bolsa, e fica registado quem o deixou caducar), "Marcar visita" (avisa o
//   cliente por email, em nome da Domus Energia) e "Largar trabalho" (fica registado: ronda 3, quem larga não recebe).
// Ronda 2 — a ficha de obra: lista do material (levantado / recebido), fotos antes e depois (JPEG/PNG até 1 MB, pelos
// bytes; em ELETRICISTAS_DIR/trabalhos/<trabalho>/, só para esse eletricista e para o CEO), ensaios medidos (os do
// pedido, `orcamentos.ensaios`; fora do limite pede uma nota), diagnóstico da avaria (`orcamentos.diagnostico`) e "Obra
// concluída" (`concluida_eletricista`: avisa os CEO e o cliente e fica à espera da confirmação do cliente). A bolsa
// avisa por email os eletricistas do concelho (um email por trabalho e eletricista). Apagar um eletricista (RGPD).
// A confirmação e a avaliação do cliente, a aprovação do CEO e o pagamento (fatura-recibo) são da ronda 3.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, responder, lerJson, lerCorpo, verificarOrigemPublica, tipoJson, lerCookies } from './http.js';
import { texto, numero, opcao, idNum, falha, diaHora, RE_TELEFONE, diagnostico as validarDiagnostico } from './validar.js';
import { RE_EMAIL } from './pedidos.js';
import { LimiteTaxa } from './limite.js';
import { iso, deCent, escreverAtomico } from './util.js';
import { CODIGO_MS, CODIGO_TENTATIVAS } from './conta.js';
import { bytesDeImagem, FOTO_MAX_BYTES, RE_ID_FOTO } from './fotos.js';
import { ESTADO_ARQUIVADO, GRUPOS_FOTO_TRABALHO } from './db.js';
import { CHECKLIST, NOME_TIPO as NOME_TIPO_AVARIA, MAX_CONCLUSAO } from '../public/ecras/diagnostico-conteudo.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';
import { concelho as concelhoDe, deslocacaoServidor, diasDeObra, partirIva, VISITA_HORAS } from './pagamentos-pedido.js';

export const COOKIE_ELETRICISTA = 'domus_eletricista';
export const CAMINHO_API = '/api/eletricista/';
export const PRAZO_VISITA_MS = 48 * 3600_000;         // depois de aceite: 48 h para marcar a visita
export const SEGURO_MAX_BYTES = 5 * 1024 * 1024;      // documento do seguro
export const PERCENTAGEM_OMISSAO = 70;                // % da mão de obra sem IVA (config `eletricista_pct`)
export const MAX_CONCELHOS = 40;
export const RETENCAO_RECUSADA_MS = 365 * 24 * 3600_000;   // candidatura não aceite: apagada ao fim de 12 meses
export const EXPERIENCIAS = { menos_2: 'Menos de 2 anos', '2_5': '2 a 5 anos', '5_10': '5 a 10 anos', mais_10: 'Mais de 10 anos' };
export const NOME_TIPO_TRABALHO = { obra: 'Obra', visita: 'Visita técnica', avaria: 'Diagnóstico de avaria' };
export const FOTOS_POR_GRUPO = 4;                     // fotos por grupo (quadro/pontos, antes/depois)
export const NOME_GRUPO_FOTO = { quadro_antes: 'Quadro — antes', pontos_antes: 'Pontos — antes', quadro_depois: 'Quadro — depois', pontos_depois: 'Pontos — depois' };
export const ENSAIOS_OBRIGATORIOS = ['isolamento', 'diferencial', 'terra'];   // para dar a obra por concluída
const CHAVES_ENSAIOS = ['continuidade_pe', 'isolamento', 'terra', 'diferencial'];
const NOME_ENSAIO = { continuidade_pe: 'continuidade do PE', isolamento: 'resistência de isolamento', terra: 'resistência de terra', diferencial: 'disparo do diferencial' };
const EXTENSAO_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RE_CODIGO = /^\d{6}$/;
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const RENOVAR_MS = 60_000;
const EXTENSAO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const NOMES_CONCELHOS = new Set(CONCELHOS.map((c) => c[0]));
const TIPOS_CASA = { apartamento: 'Apartamento', moradia: 'Moradia', alojamento_local: 'Alojamento local', servicos: 'Serviços', industrial: 'Industrial' };
const ATIVOS = "('na_bolsa', 'aceite', 'visita_marcada', 'concluida_eletricista')";
const DO_ELETRICISTA = "('aceite', 'visita_marcada', 'concluida_eletricista')";   // o trabalho é de alguém

const sha = (t) => createHash('sha256').update(t).digest('hex');
const hashCodigo = (id, codigo) => sha(`eletricista:${id}:${codigo}`);

/** NIF português: 9 algarismos com o dígito de controlo certo (módulo 11). */
export function nifValido(v) {
  if (typeof v !== 'string' || !/^[1-9]\d{8}$/.test(v)) return false;
  const soma = [...v.slice(0, 8)].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const resto = 11 - (soma % 11);
  return (resto >= 10 ? 0 : resto) === Number(v[8]);
}

/** O tipo de um documento pelos primeiros bytes (PDF "%PDF-", JPEG, PNG), ou null. Nunca pelo nome nem pelo tipo declarado. */
export function tipoDoDocumento(buf) {
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytesDeImagem(buf, 'image/jpeg')) return 'image/jpeg';
  if (bytesDeImagem(buf, 'image/png')) return 'image/png';
  return null;
}

/** Host local (http, sem Secure no cookie), como na conta de cliente. */
function hostLocal(req) {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]';
}

/**
 * @param {{db, config, registo, relogio: () => number, auditar: Function, correio: object, pagamentos: () => object}} ctx
 *   `pagamentos()`: os pagamentos do pedido (pagamentos-pedido.js): visita paga, proposta em partes, relatório.
 */
export function criarEletricistas({ db, config, registo, relogio, auditar, correio, pagamentos }) {
  const agoraIso = () => iso(relogio());
  const lim = (n, ms) => new LimiteTaxa(n, ms, relogio);
  const L = {
    candidaturaIp: lim(5, 3600_000), candidaturaGlobal: lim(100, 3600_000),
    pedirCodigoIp: lim(10, 3600_000), emailEnvio: lim(3, 3600_000), codigoIp: lim(20, 3600_000),
    acoes: lim(120, 3600_000),   // aceitar, marcar visita e largar, por eletricista
    ficha: lim(600, 3600_000),   // material, ensaios e diagnóstico, por eletricista
    fotos: lim(config.limiteFotosHora, 3600_000),   // fotos da obra, por eletricista
  };
  function esperar(pares) {
    const s = Math.max(...pares.map(([l, k]) => l.espera(k)));
    if (s) throw new ErroApi(429, `Demasiadas tentativas. Tente de novo dentro de ${s > 90 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`, { 'Retry-After': String(s) });
  }
  const contar = (pares) => { for (const [l, k] of pares) l.registar(k); };

  // Na auditoria o eletricista aparece como "eletricista:<id>" (sem o email).
  const quem = (e) => ({ id: null, email: `eletricista:${e.id}` });
  const lerCfg = () => Object.fromEntries(db.prepare('SELECT chave, valor FROM config_orcamento').all().map((r) => [r.chave, r.valor]));
  const linha = (id) => db.prepare('SELECT * FROM eletricistas WHERE id = ?').get(id) ?? null;
  const concelhosDe = (e) => { try { const v = JSON.parse(e.concelhos); return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : []; } catch { return []; } };
  function percentagemOmissao() {
    const v = Number(lerCfg().eletricista_pct);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : PERCENTAGEM_OMISSAO;
  }
  const percentagemDe = (e) => (Number.isFinite(e.percentagem) ? e.percentagem : percentagemOmissao());
  const ligacaoArea = () => (config.siteUrl ? ['', `Área do eletricista: ${config.siteUrl}/eletricista.html`] : []);

  /** Aviso à empresa (os CEO ativos do painel): sem dados do documento nem do cliente. */
  function avisarEmpresa(assunto, linhas) {
    const painel = config.origens[0] ? ['', `Painel: ${config.origens[0]}/painel/#/eletricistas`] : [];
    for (const { email } of db.prepare("SELECT email FROM utilizadores WHERE papel = 'ceo' AND ativo = 1 LIMIT 5").all()) {
      correio.enviar({ para: email, assunto, resumo: assunto, texto: ['Olá,', '', ...linhas, ...painel, '', 'Domus Energia'].join('\n') });
    }
  }

  // ------------------------------------------------------------ documento do seguro
  const pasta = (id) => join(config.eletricistasDir, String(id));
  const ficheiro = (e) => join(pasta(e.id), `${e.seguro_id}.${EXTENSAO[e.seguro_tipo]}`);

  /** `{tipo, dados}` (base64) → {tipo, bytes: Buffer}; o tipo declarado tem de ser o dos bytes. */
  function documentoSeguro(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) falha('Junte o documento do seguro de responsabilidade civil (PDF, JPG ou PNG).');
    for (const k of Object.keys(v)) if (!['tipo', 'dados'].includes(k)) falha(`Documento do seguro: campo desconhecido "${k}".`);
    if (typeof v.tipo !== 'string' || !EXTENSAO[v.tipo]) throw new ErroApi(415, 'O documento do seguro tem de ser PDF, JPG ou PNG.');
    if (typeof v.dados !== 'string' || !v.dados) falha('O documento do seguro está vazio.');
    if (v.dados.length > Math.ceil(SEGURO_MAX_BYTES / 3) * 4) throw new ErroApi(413, 'O documento do seguro é demasiado grande (máx. 5 MB).');
    if (!RE_BASE64.test(v.dados)) falha('O documento do seguro não está bem codificado.');
    const bytes = Buffer.from(v.dados, 'base64');
    if (!bytes.length) falha('O documento do seguro está vazio.');
    if (bytes.length > SEGURO_MAX_BYTES) throw new ErroApi(413, 'O documento do seguro é demasiado grande (máx. 5 MB).');
    if (tipoDoDocumento(bytes) !== v.tipo) throw new ErroApi(415, 'O documento do seguro não é um PDF, JPG ou PNG válido.');
    return { tipo: v.tipo, bytes };
  }

  // ------------------------------------------------------------ candidatura (pública)
  function listaConcelhos(v) {
    if (!Array.isArray(v) || !v.length) falha('Escolha pelo menos um concelho onde trabalha.');
    if (v.length > MAX_CONCELHOS) falha(`Escolha no máximo ${MAX_CONCELHOS} concelhos.`);
    const out = [];
    for (const c of v) {
      if (typeof c !== 'string' || !NOMES_CONCELHOS.has(c)) falha('Concelho desconhecido: escolha da lista.');
      if (!out.includes(c)) out.push(c);
    }
    return out.sort((a, b) => a.localeCompare(b, 'pt'));
  }

  const RESPOSTA_CANDIDATURA = { ok: true, mensagem: 'Candidatura recebida. Respondemos por email em poucos dias úteis.' };
  const CAMPOS_CANDIDATURA = ['nome', 'email', 'telefone', 'nif', 'dgeg', 'concelhos', 'experiencia', 'notas', 'seguro', 'consentimento', 'website'];

  async function candidatura({ req, res, ip }) {
    esperar([[L.candidaturaIp, ip], [L.candidaturaGlobal, '*']]);
    contar([[L.candidaturaIp, ip], [L.candidaturaGlobal, '*']]);
    const v = await lerJson(req, CAMPOS_CANDIDATURA, Math.ceil(SEGURO_MAX_BYTES / 3) * 4 + 64 * 1024);
    // Campo-armadilha: só robôs o preenchem. Responde como se tivesse corrido bem.
    if (v.website !== undefined && v.website !== null && v.website !== '') {
      registo.aviso(`candidatura de eletricista: armadilha preenchida (ip ${ip}), descartada`);
      return responder(res, 201, RESPOSTA_CANDIDATURA);
    }
    const nome = texto(v.nome, 'o nome', { max: 120, min: 3, obrigatorio: true });
    const email = texto(v.email, 'o email', { max: 254, obrigatorio: true, re: RE_EMAIL, reMsg: 'O email não parece certo (ex.: nome@exemplo.pt).' }).toLowerCase();
    const telefone = texto(v.telefone, 'o telemóvel', { max: 30, obrigatorio: true, re: RE_TELEFONE, reMsg: 'Telemóvel inválido.' });
    if (telefone.replace(/\D/g, '').length < 9) falha('Telemóvel inválido.');
    const nif = String(texto(v.nif, 'o NIF', { max: 20, obrigatorio: true })).replace(/[\s.]/g, '');
    if (!nifValido(nif)) falha('O NIF não parece certo (9 algarismos).');
    const dgeg = texto(v.dgeg, 'o n.º de habilitação da DGEG', { max: 40, min: 2, obrigatorio: true });
    const concelhos = listaConcelhos(v.concelhos);
    const experiencia = opcao(v.experiencia, 'experiência', Object.keys(EXPERIENCIAS), { obrigatorio: false });
    const notas = texto(v.notas, 'os trabalhos que faz', { max: 1000, multilinha: true });
    if (v.consentimento !== true) falha('Para enviar a candidatura tem de aceitar a Política de Privacidade.');
    const doc = documentoSeguro(v.seguro);
    const existe = db.prepare('SELECT id, estado FROM eletricistas WHERE email = ?').get(email);
    if (existe) {
      // A mesma resposta (não revela se o email já tem candidatura) e nada muda: quem tem o email recebe o aviso
      // (dentro da quota de 3 emails por hora por email: um terceiro não o usa para encher a caixa de alguém).
      if (!L.emailEnvio.espera(email)) L.emailEnvio.registar(email);
      else return responder(res, 201, RESPOSTA_CANDIDATURA);
      correio.enviar({ para: email, assunto: 'Domus Energia: já temos a sua candidatura', resumo: `candidatura repetida do eletricista ${existe.id}`,
        texto: ['Olá,', '', 'Recebemos uma candidatura nova com este email, mas já tínhamos uma: fica a valer a primeira.',
          'Se quiser mudar os dados ou o documento do seguro, responda a este email.', '', 'Domus Energia'].join('\n') });
      return responder(res, 201, RESPOSTA_CANDIDATURA);
    }
    const agora = agoraIso();
    const seguroId = randomBytes(12).toString('hex');
    const id = Number(db.prepare(`INSERT INTO eletricistas (email, nome, telefone, nif, dgeg, concelhos, experiencia, notas, estado, seguro_id, seguro_tipo, seguro_bytes, consentimento, criado, atualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?)`).run(email, nome, telefone, nif, dgeg, JSON.stringify(concelhos), experiencia, notas,
      seguroId, doc.tipo, doc.bytes.length, agora, agora, agora).lastInsertRowid);
    try {
      await escreverAtomico(ficheiro({ id, seguro_id: seguroId, seguro_tipo: doc.tipo }), doc.bytes);
    } catch (e) {
      db.prepare('DELETE FROM eletricistas WHERE id = ?').run(id);
      throw e;
    }
    auditar(quem({ id }), 'eletricista_candidatura', `eletricista:${id}`, { concelhos: concelhos.length, documento: doc.tipo }, ip);
    registo.info(`candidatura de eletricista ${id} recebida`);
    correio.enviar({ para: email, assunto: 'Domus Energia: recebemos a sua candidatura', resumo: `candidatura do eletricista ${id} recebida`,
      texto: [`Olá ${nome},`, '', 'Recebemos a sua candidatura para trabalhar com a Domus Energia.',
        'Vamos confirmar a habilitação na DGEG e o seguro de responsabilidade civil e respondemos por email em poucos dias úteis.',
        `Concelhos: ${concelhos.join(', ')}.`, '', 'Domus Energia'].join('\n') });
    avisarEmpresa('Domus Energia: candidatura nova de eletricista', [`Chegou a candidatura n.º ${id} de um eletricista (${concelhos.join(', ')}).`, 'Veja os dados e o documento do seguro no painel, em Eletricistas.']);
    return responder(res, 201, RESPOSTA_CANDIDATURA);
  }

  // ------------------------------------------------------------ sessão
  function cookie(req, token, maxAgeS) {
    return `${COOKIE_ELETRICISTA}=${token}; Path=/api/eletricista; HttpOnly;${hostLocal(req) ? '' : ' Secure;'} SameSite=Lax; Max-Age=${maxAgeS}`;
  }
  const cookieApagar = (req) => cookie(req, '', 0);

  function abrirSessao(req, id) {
    const token = randomBytes(32).toString('base64url');
    const agora = relogio();
    db.prepare('INSERT INTO eletricistas_sessoes (id, eletricista_id, criada, expira, renovada) VALUES (?, ?, ?, ?, ?)')
      .run(sha(token), id, agora, agora + config.contaSessaoMs, agora);
    db.prepare('UPDATE eletricistas SET ultimo_acesso = ? WHERE id = ?').run(agoraIso(), id);
    return cookie(req, token, Math.floor(config.contaSessaoMs / 1000));
  }

  /** O eletricista da sessão do pedido (ou null): só `aprovado`. Renova a sessão (e o cookie, se `res`). */
  function sessao(req, res) {
    const token = lerCookies(req)[COOKIE_ELETRICISTA];
    if (!token || !RE_TOKEN.test(token)) return null;
    const id = sha(token);
    const agora = relogio();
    const s = db.prepare('SELECT s.criada, s.expira, s.renovada, e.* FROM eletricistas_sessoes s JOIN eletricistas e ON e.id = s.eletricista_id WHERE s.id = ?').get(id);
    if (!s) return null;
    if (s.expira <= agora || s.criada + config.contaSessaoMaxMs <= agora || s.estado !== 'aprovado') {
      db.prepare('DELETE FROM eletricistas_sessoes WHERE id = ?').run(id);
      return null;
    }
    let expira = s.expira;
    if (agora - s.renovada >= RENOVAR_MS) {
      expira = Math.min(agora + config.contaSessaoMs, s.criada + config.contaSessaoMaxMs);
      db.prepare('UPDATE eletricistas_sessoes SET expira = ?, renovada = ? WHERE id = ?').run(expira, agora, id);
      db.prepare('UPDATE eletricistas SET ultimo_acesso = ? WHERE id = ?').run(iso(agora), s.id);
      res?.setHeader('Set-Cookie', cookie(req, token, Math.max(1, Math.floor((expira - agora) / 1000))));
    }
    return { ...s, sessaoExpira: iso(expira) };
  }

  const publico = (e) => ({ nome: e.nome, email: e.email, concelhos: concelhosDe(e), percentagem: percentagemDe(e) });

  // ------------------------------------------------------------ entrar com código
  function novoCodigo(id) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare(`INSERT INTO eletricistas_codigos (eletricista_id, hash, expira, tentativas) VALUES (?, ?, ?, 0)
      ON CONFLICT(eletricista_id) DO UPDATE SET hash = excluded.hash, expira = excluded.expira, tentativas = 0`).run(id, hashCodigo(id, codigo), relogio() + CODIGO_MS);
    return codigo;
  }
  /** true se o código está certo (e apaga-o); conta a tentativa errada. */
  function verificarCodigo(id, codigo) {
    const c = db.prepare('SELECT * FROM eletricistas_codigos WHERE eletricista_id = ?').get(id);
    if (!c || c.expira <= relogio() || c.tentativas >= CODIGO_TENTATIVAS) return false;
    if (timingSafeEqual(Buffer.from(hashCodigo(id, codigo)), Buffer.from(c.hash))) {
      db.prepare('DELETE FROM eletricistas_codigos WHERE eletricista_id = ?').run(id);
      return true;
    }
    db.prepare('UPDATE eletricistas_codigos SET tentativas = tentativas + 1 WHERE eletricista_id = ?').run(id);
    return false;
  }
  const emailValido = (v) => texto(v, 'o email', { max: 254, obrigatorio: true, re: RE_EMAIL, reMsg: 'O email não parece certo (ex.: nome@exemplo.pt).' }).toLowerCase();
  const ERRO_CODIGO = 'Código errado ou expirado. Confirme o código, ou peça um novo (ao fim de 5 tentativas erradas o código deixa de valer).';

  const h = {};

  // Pedir o código: a mesma resposta exista ou não o eletricista e esteja ou não aprovado; o código só sai para quem
  // está aprovado (3 por hora por email). O código vai só no corpo do email.
  h.codigo = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email']);
    const email = emailValido(v.email);
    esperar([[L.pedirCodigoIp, ip]]);
    contar([[L.pedirCodigoIp, ip]]);
    const e = db.prepare('SELECT * FROM eletricistas WHERE email = ?').get(email);
    if (e && e.estado === 'aprovado' && !L.emailEnvio.espera(email)) {
      L.emailEnvio.registar(email);
      const codigo = novoCodigo(e.id);
      correio.enviar({ para: e.email, assunto: 'Domus Energia: o seu código para entrar', resumo: `código ${codigo} (entrar na área do eletricista)`,
        texto: ['Olá,', '', 'Para entrar na área do eletricista da Domus Energia, escreva este código:', '', `    ${codigo}`, '',
          'O código vale 15 minutos.', 'Se não foi você, ignore este email.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, { ok: true, email, mensagem: 'Se este email for de um eletricista aprovado, enviámos um código para entrar. Veja também o correio não desejado (spam).' });
  };

  h.entrar = async ({ req, res, ip }) => {
    const v = await lerJson(req, ['email', 'codigo']);
    const email = emailValido(v.email);
    esperar([[L.codigoIp, ip]]);
    contar([[L.codigoIp, ip]]);
    const codigo = String(v.codigo ?? '').replace(/\s/g, '');
    if (!RE_CODIGO.test(codigo)) falha('O código tem 6 algarismos.');
    const e = db.prepare('SELECT * FROM eletricistas WHERE email = ?').get(email);
    if (!e || e.estado !== 'aprovado' || !verificarCodigo(e.id, codigo)) throw new ErroApi(400, ERRO_CODIGO);
    auditar(quem(e), 'eletricista_entrou', `eletricista:${e.id}`, null, ip);
    responder(res, 200, { eletricista: publico(e) }, { 'Set-Cookie': abrirSessao(req, e.id) });
  };

  h.sair = async ({ req, res }) => {
    await lerJson(req, []);
    const token = lerCookies(req)[COOKIE_ELETRICISTA];
    if (token && RE_TOKEN.test(token)) db.prepare('DELETE FROM eletricistas_sessoes WHERE id = ?').run(sha(token));
    responder(res, 200, { ok: true }, { 'Set-Cookie': cookieApagar(req) });
  };

  h.eu = ({ res, e }) => responder(res, 200, { eletricista: publico(e), sessao_expira: e.sessaoExpira, prazo_visita_horas: PRAZO_VISITA_MS / 3600_000 });

  // ------------------------------------------------------------ o trabalho: de que pedido, de que tipo, aberto ou não
  const pedidoDe = (id) => db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id) ?? null;
  const obraDe = (o) => (o.obra_id ? db.prepare('SELECT * FROM obras WHERE id = ?').get(o.obra_id) ?? null : null);
  const simDe = (o) => { try { const s = JSON.parse(o.simulacao ?? 'null'); return s && typeof s === 'object' ? s : null; } catch { return null; } };
  const localidadeDe = (o) => o.localidade || simDe(o)?.casa?.localidade || '';

  /**
   * O que se pode atribuir num pedido AGORA: 'obra' (pedido aceite com a obra por fazer), 'visita' (visita técnica paga)
   * ou 'avaria' (diagnóstico pago), ou null. Um trabalho está ABERTO enquanto isto for o tipo dele: com a obra
   * concluída ou cancelada, a proposta enviada depois da visita, ou o pedido perdido, fecha (e os dados do cliente
   * deixam de sair para o eletricista).
   */
  function tipoAtribuivel(o) {
    if (!o || o.anonimizado || o.estado === ESTADO_ARQUIVADO) return null;
    if (o.estado === 'aceite') {
      const b = obraDe(o);
      return b && !['concluida', 'cancelada'].includes(b.estado) && !o.obra_concluida ? 'obra' : null;
    }
    if (['novo', 'contactado', 'visita_marcada'].includes(o.estado) && pagamentos().temVisita(o)) return simDe(o)?.funil === 'avaria' ? 'avaria' : 'visita';
    return null;
  }
  const aberto = (t, o) => tipoAtribuivel(o) === t.tipo;

  /** "Obra — Apartamento T2": só de dados estruturados (nunca o texto livre do pedido). */
  function titulo(o, tipo) {
    const casa = simDe(o)?.casa ?? {};
    const c = [TIPOS_CASA[casa.tipo], typeof casa.tipologia === 'string' && /^[A-Za-z0-9+ ]{1,8}$/.test(casa.tipologia) ? casa.tipologia : null].filter(Boolean).join(' ');
    return c && tipo !== 'avaria' ? `${NOME_TIPO_TRABALHO[tipo]} — ${c}` : NOME_TIPO_TRABALHO[tipo];
  }

  const horasDiagnostico = () => {
    const h0 = Number(db.prepare("SELECT horas_instalacao FROM catalogo WHERE sku = 'DIAG-AVARIA'").get()?.horas_instalacao);
    return Number.isFinite(h0) && h0 > 0 ? h0 : VISITA_HORAS;
  };

  /**
   * Quanto o eletricista recebe (estimativa, € SEM IVA): percentagem × mão de obra + a deslocação paga pelo cliente.
   * Obra: as partes da proposta (mão de obra e deslocação); sem proposta em partes, as sugeridas pela simulação
   * (`provisoria`). Visita: 0,5 h × tarifa. Avaria: a meia hora de mão de obra do diagnóstico — a taxa de diagnóstico
   * (25 €) fica na Domus. null quando não há de onde tirar a mão de obra.
   */
  function estimativa(o, tipo, pct) {
    const pag = pagamentos();
    const cfg = lerCfg();
    const semIva = (euros) => partirIva(Math.round(euros * 100), pag.ivaAtual()).base;
    let mao = null, desl = 0, provisoria = false;
    if (tipo === 'obra') {
      if (o.proposta_mao_obra_cent !== null && o.proposta_mao_obra_cent !== undefined) { mao = o.proposta_mao_obra_cent; desl = o.proposta_deslocacao_cent ?? 0; }
      else {
        const s = o.simulacao ? pag.propostaSugerida(o) : null;
        if (s) { mao = Math.round(s.mao_obra * 100); desl = Math.round(s.deslocacao * 100); provisoria = true; }
      }
    } else {
      const tarifa = Number.isFinite(Number(cfg.tarifa_hora_iva)) ? Number(cfg.tarifa_hora_iva) : 38;
      mao = semIva((tipo === 'avaria' ? horasDiagnostico() : VISITA_HORAS) * tarifa);
      const d = deslocacaoServidor(localidadeDe(o), cfg);
      desl = d === null ? 0 : semIva(d);
    }
    if (mao === null) return null;
    const parte = Math.round((mao * pct) / 100);
    return { percentagem: pct, mao_obra: deCent(mao), parte_mao_obra: deCent(parte), deslocacao: deCent(desl), total: deCent(parte + desl), provisoria };
  }

  /** Horas e dias estimados do trabalho. */
  function duracao(o, tipo, rel) {
    if (tipo !== 'obra') return { horas: tipo === 'avaria' ? horasDiagnostico() : VISITA_HORAS, dias: 1 };
    const horas = obraDe(o)?.horas_estimadas ?? rel?._interno?.horas ?? null;
    return { horas: horas || null, dias: horas ? diasDeObra(horas, lerCfg()) : rel?.dias ?? null };
  }

  /**
   * O relatório técnico para o eletricista, montado campo a campo a partir do relatório do cliente: lista de trabalho
   * e material por divisão (artigo e quantidade), planta técnica, esquemas e esquema do quadro. SEM preços, totais,
   * mão de obra, deslocação ou número do pedido. `completo` (só depois de atribuído): junta a lista de ensaios e o
   * diagnóstico registados no painel.
   */
  function relatorioTecnico(rel, completo) {
    if (!rel) return null;
    const mat = (linhas) => linhas.map((l) => ({ artigo: l.artigo, quantidade: l.quantidade }));
    const r = {
      acoes: rel.acoes,
      divisoes: rel.divisoes.map((d) => ({ nome: d.nome, trabalho: d.trabalho, material: mat(d.material) })),
      geral: { titulo: rel.geral.titulo, material: mat(rel.geral.material) },
      melhorias: rel.melhorias ? rel.melhorias.pacotes.map((p) => ({ nome: p.nome, material: mat(p.material) })) : [],
      planta: rel.planta, esquemas: rel.esquemas, terra_nota: rel.terra_nota, esquema_quadro: rel.esquema_quadro,
    };
    if (completo) { r.ensaios = rel.ensaios; r.diagnostico = rel.diagnostico; }
    return r;
  }
  const relatorioDe = (o) => (o.simulacao ? pagamentos().relatorioCliente(o, true) : null);

  /** O trabalho ANTES de aceitar: nada do cliente (nem nome, contactos, morada, localidade exata ou n.º do pedido). */
  function paraBolsa(t, o, e, comRelatorio = false) {
    const rel = relatorioDe(o);
    const r = { id: t.id, concelho: t.concelho, tipo: t.tipo, titulo: titulo(o, t.tipo), ...duracao(o, t.tipo, rel), recebe: estimativa(o, t.tipo, percentagemDe(e)) };
    if (comRelatorio) r.relatorio = relatorioTecnico(rel, false);
    return r;
  }

  /** O trabalho do próprio eletricista: os dados do cliente só enquanto está aberto. */
  function paraEletricista(t, o, completo = false) {
    const rel = relatorioDe(o);
    const estaAberto = aberto(t, o);
    const r = {
      id: t.id, concelho: t.concelho, tipo: t.tipo, titulo: titulo(o, t.tipo), estado: t.estado, aberto: estaAberto, ...duracao(o, t.tipo, rel),
      recebe: estimativa(o, t.tipo, Number.isFinite(t.percentagem) ? t.percentagem : percentagemOmissao()),
      aceite: t.aceite_em ? iso(t.aceite_em) : null,
      prazo: t.estado === 'aceite' && t.aceite_em ? iso(t.aceite_em + PRAZO_VISITA_MS) : null,
      visita: t.visita ?? null, concluida: t.concluida ?? null,
    };
    if (!completo) return r;
    r.cliente = estaAberto ? { nome: o.nome, telefone: o.telefone ?? null, morada: o.morada ?? null, localidade: o.localidade ?? null } : null;
    r.relatorio = estaAberto ? relatorioTecnico(rel, true) : null;
    r.material = estaAberto ? materialDoTrabalho(t, o, rel) : [];
    // Ficha de obra (ronda 2): fotos antes e depois, ensaios medidos, diagnóstico (avaria) e o que falta para concluir.
    r.editavel = estaAberto && ['aceite', 'visita_marcada'].includes(t.estado);
    r.fotos = estaAberto ? fotosDe(t.id).map((f) => fotoPublica(f, `/api/eletricista/trabalhos/${t.id}/fotos/`)) : [];
    r.grupos_fotos = GRUPOS_FOTO_TRABALHO.map((g) => ({ grupo: g, nome: NOME_GRUPO_FOTO[g] }));
    r.fotos_max = FOTOS_POR_GRUPO;
    r.ensaios = estaAberto ? ensaiosDoPedido(o) : null;
    r.diagnostico = estaAberto && t.tipo === 'avaria' ? { modelo: MODELO_DIAGNOSTICO, atual: diagnosticoDoPedido(o) } : null;
    r.falta = estaAberto && t.estado !== 'concluida_eletricista' ? faltaParaConcluir(t, o) : [];
    return r;
  }

  // ---- material: a lista do pedido com o que o eletricista já levantou ou recebeu (por trabalho)
  const recebidoDe = (t) => { try { const v = JSON.parse(t.material_recebido ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
  function materialDoTrabalho(t, o, rel = relatorioDe(o)) {
    const recebido = new Set(recebidoDe(t));
    return materialDe(o, t.tipo, rel).map((m) => ({ ...m, recebido: recebido.has(m.nome) }));
  }

  // ---- fotos da obra (antes / depois): ELETRICISTAS_DIR/trabalhos/<trabalho>/<id>.jpg|png
  const pastaFotos = (trabalhoId) => join(config.eletricistasDir, 'trabalhos', String(trabalhoId));
  const ficheiroFoto = (f) => join(pastaFotos(f.trabalho_id), `${f.id}.${EXTENSAO_FOTO[f.tipo_mime]}`);
  const fotosDe = (trabalhoId) => db.prepare('SELECT * FROM trabalhos_eletricista_fotos WHERE trabalho_id = ? ORDER BY rowid').all(trabalhoId);
  const fotoPublica = (f, base) => ({ id: f.id, grupo: f.grupo, url: `${base}${f.id}`, bytes: f.bytes, criado: f.criado });

  // ---- ensaios: os do pedido (`orcamentos.ensaios`, migração 16), com os limites da configuração
  function limitesEnsaios() {
    const cfg = lerCfg();
    const n = (k, omissao) => (Number.isFinite(Number(cfg[k])) && Number(cfg[k]) >= 0 ? Number(cfg[k]) : omissao);
    return { isolamento_min: n('ensaio_isolamento_mohm', 0.5), diferencial_max: n('ensaio_diferencial_ms', 300), terra_max: n('ensaio_terra_ohm', 100) };
  }
  /** Os ensaios fora do limite: isolamento abaixo do mínimo, diferencial ou terra acima do máximo. */
  function ensaiosFora(e, lim = limitesEnsaios()) {
    const fora = [];
    if (e.isolamento !== null && e.isolamento !== undefined && e.isolamento < lim.isolamento_min) fora.push('isolamento');
    if (e.diferencial !== null && e.diferencial !== undefined && e.diferencial > lim.diferencial_max) fora.push('diferencial');
    if (e.terra !== null && e.terra !== undefined && e.terra > lim.terra_max) fora.push('terra');
    return fora;
  }
  function ensaiosDoPedido(o) {
    const e = pagamentos().ensaiosDe(o) ?? { continuidade_pe: null, isolamento: null, terra: null, diferencial: null, notas: null, data: null };
    const limites = limitesEnsaios();
    return { ...e, limites, fora: ensaiosFora(e, limites) };
  }

  // ---- diagnóstico da avaria: a lista de verificação do painel (diagnostico-conteudo.js), sem quem o fez
  const MODELO_DIAGNOSTICO = {
    checklist: CHECKLIST.map((c) => ({ chave: c.chave, nome: c.nome, unidade: c.valor?.unidade ?? null, referencia: c.referencia ?? null })),
    tipos: NOME_TIPO_AVARIA, max_conclusao: MAX_CONCLUSAO,
  };
  function diagnosticoDoPedido(o) {
    const d = pagamentos().diagnosticoDe(o);
    return d ? { verificacoes: d.verificacoes, valores: d.valores, tipo: d.tipo, conclusao: d.conclusao, data: d.data } : null;
  }

  /**
   * O que falta para "Obra concluída" (lista vazia = pode): a visita marcada e pelo menos uma foto de antes; na obra,
   * também uma foto de depois e os três ensaios (isolamento, diferencial e terra); na avaria, a conclusão do diagnóstico.
   */
  function faltaParaConcluir(t, o) {
    const falta = [];
    if (t.estado === 'aceite') falta.push('marcar a visita');
    const n = (grupos) => db.prepare(`SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos WHERE trabalho_id = ? AND grupo IN (${grupos.map(() => '?').join(', ')})`).get(t.id, ...grupos).n;
    if (!n(['quadro_antes', 'pontos_antes'])) falta.push('uma foto de antes');
    if (t.tipo === 'obra') {
      if (!n(['quadro_depois', 'pontos_depois'])) falta.push('uma foto de depois');
      const e = pagamentos().ensaiosDe(o) ?? {};
      for (const k of ENSAIOS_OBRIGATORIOS) if (e[k] === null || e[k] === undefined) falta.push(`ensaio: ${NOME_ENSAIO[k]}`);
    }
    if (t.tipo === 'avaria' && !diagnosticoDoPedido(o)?.conclusao) falta.push('a conclusão do diagnóstico');
    return falta;
  }

  /** Lista de material: a da obra (painel); senão a do relatório. Só nome e quantidade. */
  function materialDe(o, tipo, rel) {
    let lista = [];
    if (tipo === 'obra') { try { lista = JSON.parse(obraDe(o)?.material ?? '[]'); } catch { lista = []; } }
    if (Array.isArray(lista) && lista.length) return lista.filter((m) => m && typeof m.nome === 'string').map((m) => ({ nome: m.nome, quantidade: m.quantidade ?? 1 }));
    if (!rel) return [];
    return [...rel.divisoes.flatMap((d) => d.material), ...rel.geral.material, ...(rel.melhorias?.pacotes ?? []).flatMap((p) => p.material)]
      .map((l) => ({ nome: l.artigo, quantidade: l.quantidade }));
  }

  // ------------------------------------------------------------ estados do trabalho
  const insEvento = db.prepare('INSERT INTO trabalhos_eletricista_eventos (trabalho_id, eletricista_id, evento, quando, por) VALUES (?, ?, ?, ?, ?)');
  const evento = (t, nome, eletricistaId, por) => insEvento.run(t.id, eletricistaId ?? null, nome, agoraIso(), por);
  const trabalho = (id) => db.prepare('SELECT * FROM trabalhos_eletricista WHERE id = ?').get(id) ?? null;
  const emailCliente = (o) => (o.conta_id ? db.prepare('SELECT email FROM contas WHERE id = ?').get(o.conta_id)?.email : null) ?? o.email ?? null;
  const ligacaoConta = () => (config.siteUrl ? ['', `A sua conta: ${config.siteUrl}/conta.html`] : []);
  /** "sexta-feira, 9 de outubro, 10:00" a partir de "AAAA-MM-DDTHH:MM" (hora de Lisboa, sem fuso: formata-se tal e qual). */
  const dataTexto = (quando) => new Date(`${quando}:00Z`).toLocaleString('pt-PT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const agoraLisboa = () => new Date(relogio()).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');

  /**
   * O eletricista deixou o trabalho (largou-o, ou passaram as 48 h): um trabalho da bolsa volta à bolsa; um atribuído
   * diretamente pelo CEO volta ao CEO (fica `retirado`, por atribuir). Fica o evento com o eletricista. Com a visita já
   * marcada, a data sai do pedido e o cliente é avisado. Devolve false se o trabalho já não era dele.
   */
  function devolver(t, nomeEvento, por) {
    const agora = agoraIso();
    const r = t.modo === 'bolsa'
      ? db.prepare(`UPDATE trabalhos_eletricista SET estado = 'na_bolsa', eletricista_id = NULL, percentagem = NULL, aceite_em = NULL, visita = NULL, atualizado = ?
          WHERE id = ? AND eletricista_id = ? AND estado IN ('aceite', 'visita_marcada')`).run(agora, t.id, t.eletricista_id)
      : db.prepare(`UPDATE trabalhos_eletricista SET estado = 'retirado', visita = NULL, atualizado = ?
          WHERE id = ? AND eletricista_id = ? AND estado IN ('aceite', 'visita_marcada')`).run(agora, t.id, t.eletricista_id);
    if (!r.changes) return false;
    evento(t, nomeEvento, t.eletricista_id, por);
    const o = pedidoDe(t.orcamento_id);
    auditar(nomeEvento === 'expirou' ? null : { id: null, email: por }, `trabalho_${nomeEvento}`, `orcamento:${t.orcamento_id}`,
      { trabalho: t.id, eletricista: t.eletricista_id, volta: t.modo === 'bolsa' ? 'bolsa' : 'por atribuir' });
    if (t.estado === 'visita_marcada' && o) {
      if (t.tipo === 'obra') db.prepare('UPDATE obras SET por_agendar = 1, atualizado = ? WHERE id = ?').run(agora, o.obra_id);
      else db.prepare("UPDATE orcamentos SET data_visita = NULL, estado = CASE WHEN estado = 'visita_marcada' THEN 'contactado' ELSE estado END, atualizado = ? WHERE id = ?").run(agora, o.id);
      const email = emailCliente(o);
      if (email) {
        correio.enviar({ para: email, assunto: 'Domus Energia: a visita vai ter nova data', resumo: `visita do pedido ${o.id} desmarcada`,
          texto: ['Olá,', '', `A visita do seu pedido n.º ${o.id}, marcada para ${dataTexto(t.visita)}, foi desmarcada.`,
            'Vamos marcar uma data nova e avisamos por email. Pedimos desculpa pelo incómodo.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
      }
    }
    avisarEmpresa('Domus Energia: um eletricista deixou um trabalho', [
      `${nomeEvento === 'expirou' ? 'Passaram 48 h sem visita marcada' : 'O eletricista largou o trabalho'} do pedido n.º ${t.orcamento_id}.`,
      t.modo === 'bolsa' ? 'O trabalho voltou à bolsa.' : 'O trabalho voltou a ficar por atribuir.']);
    // De volta à bolsa: quem ainda não foi avisado deste trabalho (ex.: aprovado entretanto) recebe o email.
    if (t.modo === 'bolsa') avisarBolsa(trabalho(t.id));
    return true;
  }

  /**
   * Aviso da bolsa: um email a cada eletricista aprovado com o concelho do trabalho — "Novo trabalho em <concelho>" e a
   * ligação para a área, sem nada do cliente nem valores. UM email por trabalho e por eletricista
   * (`trabalhos_eletricista_avisos`): se o trabalho voltar à bolsa, quem já foi avisado (incluindo quem o largou) não
   * recebe outro. Devolve quantos emails saíram.
   */
  function avisarBolsa(t) {
    if (!t || t.estado !== 'na_bolsa') return 0;
    const ins = db.prepare('INSERT OR IGNORE INTO trabalhos_eletricista_avisos (trabalho_id, eletricista_id, quando) VALUES (?, ?, ?)');
    let n = 0;
    for (const e of aprovadosEm(t.concelho).slice(0, 500)) {
      if (!ins.run(t.id, e.id, agoraIso()).changes) continue;
      n += 1;
      correio.enviar({ para: e.email, assunto: `Domus Energia: novo trabalho em ${t.concelho}`, resumo: `aviso da bolsa: trabalho ${t.id} ao eletricista ${e.id}`,
        texto: ['Olá,', '', `Há um trabalho novo na bolsa em ${t.concelho} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}).`,
          'Veja o relatório técnico e o valor que recebe na área do eletricista. O primeiro a aceitar fica com o trabalho.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
    return n;
  }

  /** 48 h depois de aceite sem visita marcada: o trabalho volta (corre em cada leitura e de 15 em 15 minutos). */
  function expirar() {
    const idos = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado = 'aceite' AND aceite_em <= ?").all(relogio() - PRAZO_VISITA_MS);
    for (const t of idos) devolver(t, 'expirou', 'sistema');
    return idos.length;
  }

  const largouOuExpirou = (t, e) => Boolean(db.prepare("SELECT 1 FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? AND eletricista_id = ? AND evento IN ('largou', 'expirou') LIMIT 1").get(t.id, e.id));
  /** O eletricista vê este trabalho na bolsa? Concelho dele, pedido aberto, e nunca o largou nem deixou caducar. */
  const visivelNaBolsa = (t, e, o) => t.estado === 'na_bolsa' && concelhosDe(e).includes(t.concelho) && Boolean(o) && aberto(t, o) && !largouOuExpirou(t, e);

  h.bolsa = ({ res, e }) => {
    expirar();
    const lista = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado = 'na_bolsa' ORDER BY id DESC LIMIT 200").all()
      .map((t) => [t, pedidoDe(t.orcamento_id)]).filter(([t, o]) => visivelNaBolsa(t, e, o)).map(([t, o]) => paraBolsa(t, o, e));
    responder(res, 200, { concelhos: concelhosDe(e), trabalhos: lista });
  };

  /** Trabalho da bolsa visível para este eletricista (404 para os outros: nem fica a saber que existe). */
  function daBolsa(e, idTexto) {
    const t = trabalho(idNum(idTexto));
    const o = t ? pedidoDe(t.orcamento_id) : null;
    if (!t || !o || !concelhosDe(e).includes(t.concelho)) throw new ErroApi(404, 'Trabalho não encontrado.');
    if (['aceite', 'visita_marcada', 'concluida_eletricista'].includes(t.estado) && t.eletricista_id !== e.id && t.modo === 'bolsa') throw new ErroApi(409, 'Outro eletricista aceitou este trabalho primeiro.');
    if (!visivelNaBolsa(t, e, o)) throw new ErroApi(404, 'Trabalho não encontrado.');
    return { t, o };
  }

  h.bolsaDetalhe = ({ res, e, params }) => {
    expirar();
    const { t, o } = daBolsa(e, params.id);
    responder(res, 200, { trabalho: paraBolsa(t, o, e, true), prazo_visita_horas: PRAZO_VISITA_MS / 3600_000 });
  };

  // Aceitar: atómico. O UPDATE só muda a linha se ainda está na bolsa; o segundo a chegar não muda nada e recebe 409.
  h.aceitar = async ({ req, res, e, params, ip }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t } = daBolsa(e, params.id);
    const agora = relogio();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'aceite', eletricista_id = ?, percentagem = ?, aceite_em = ?, atualizado = ?
      WHERE id = ? AND estado = 'na_bolsa'`).run(e.id, percentagemDe(e), agora, iso(agora), t.id);
    if (!r.changes) throw new ErroApi(409, 'Outro eletricista aceitou este trabalho primeiro.');
    evento(t, 'aceite', e.id, `eletricista:${e.id}`);
    auditar(quem(e), 'trabalho_aceite', `orcamento:${t.orcamento_id}`, { trabalho: t.id, eletricista: e.id, percentagem: percentagemDe(e) }, ip);
    responder(res, 200, { trabalho: paraEletricista(trabalho(t.id), pedidoDe(t.orcamento_id), true) });
  };

  h.trabalhos = ({ res, e }) => {
    expirar();
    const lista = db.prepare(`SELECT * FROM trabalhos_eletricista WHERE eletricista_id = ? AND estado IN ${DO_ELETRICISTA} ORDER BY id DESC LIMIT 200`).all(e.id)
      .map((t) => [t, pedidoDe(t.orcamento_id)]).filter(([, o]) => o).map(([t, o]) => paraEletricista(t, o));
    responder(res, 200, { trabalhos: lista });
  };

  /** Trabalho deste eletricista, em curso (404 para os outros). */
  function meu(e, idTexto) {
    const t = trabalho(idNum(idTexto));
    const o = t ? pedidoDe(t.orcamento_id) : null;
    if (!t || !o || t.eletricista_id !== e.id || !['aceite', 'visita_marcada', 'concluida_eletricista'].includes(t.estado)) throw new ErroApi(404, 'Trabalho não encontrado.');
    return { t, o };
  }
  /** … e que ainda se pode mexer: aberto e ainda não dado por concluído. */
  function meuEditavel(e, idTexto) {
    const { t, o } = meu(e, idTexto);
    if (t.estado === 'concluida_eletricista') throw new ErroApi(409, 'Já deu este trabalho por concluído: está a aguardar a confirmação do cliente.');
    if (!aberto(t, o)) throw new ErroApi(409, 'Este trabalho já está fechado.');
    return { t, o };
  }
  const fichaAtual = (t) => ({ trabalho: paraEletricista(trabalho(t.id), pedidoDe(t.orcamento_id), true) });

  h.trabalho = ({ res, e, params }) => {
    expirar();
    const { t, o } = meu(e, params.id);
    responder(res, 200, { trabalho: paraEletricista(t, o, true) });
  };

  // "Marcar visita" (dia e hora, no futuro): o trabalho passa a `visita_marcada` (o prazo de 48 h deixa de contar), a
  // data fica no pedido (visita técnica ou diagnóstico) ou na obra, e o cliente recebe o email em nome da Domus Energia
  // (sem o nome do eletricista).
  h.marcarVisita = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['data_visita']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const quando = diaHora(v.data_visita, 'a data da visita');
    if (!quando || !/T\d{2}:\d{2}$/.test(quando)) falha('Indique o dia e a hora da visita.');
    if (quando <= agoraLisboa()) falha('Escolha um dia e uma hora no futuro.');
    const agora = agoraIso();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'visita_marcada', visita = ?, atualizado = ?
      WHERE id = ? AND eletricista_id = ? AND estado IN ('aceite', 'visita_marcada')`).run(quando, agora, t.id, e.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho já não é seu.');
    if (t.tipo === 'obra') db.prepare('UPDATE obras SET data = ?, hora = ?, por_agendar = 0, atualizado = ? WHERE id = ?').run(quando.slice(0, 10), quando.slice(11), agora, o.obra_id);
    else db.prepare("UPDATE orcamentos SET data_visita = ?, estado = CASE WHEN estado IN ('novo', 'contactado') THEN 'visita_marcada' ELSE estado END, visita_faltou = NULL, atualizado = ? WHERE id = ?").run(quando, agora, o.id);
    evento(t, 'visita_marcada', e.id, `eletricista:${e.id}`);
    auditar(quem(e), 'visita_marcada', `orcamento:${o.id}`, { data_visita: quando, trabalho: t.id, por: 'eletricista externo' }, ip);
    const email = emailCliente(o);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: visita marcada', resumo: `visita do pedido ${o.id} marcada para ${quando}`,
        texto: ['Olá,', '', `A visita do seu pedido n.º ${o.id} está marcada para ${dataTexto(quando)}.`, 'Vai a sua casa um técnico em nome da Domus Energia.',
          'Se não puder, responda a este email ou ligue-nos.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, { trabalho: paraEletricista(trabalho(t.id), pedidoDe(o.id), true) });
  };

  h.largar = async ({ req, res, e, params }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t } = meu(e, params.id);
    if (t.estado === 'concluida_eletricista') throw new ErroApi(409, 'Já deu este trabalho por concluído: está a aguardar a confirmação do cliente.');
    if (!devolver(t, 'largou', `eletricista:${e.id}`)) throw new ErroApi(409, 'Este trabalho já não é seu.');
    responder(res, 200, { ok: true });
  };

  // ------------------------------------------------------------ ficha de obra (ronda 2)
  // Material: a lista toda do que já foi levantado ou recebido (nomes da lista do trabalho).
  h.material = async ({ req, res, e, params }) => {
    const v = await lerJson(req, ['recebido']);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const nomes = new Set(materialDe(o, t.tipo, relatorioDe(o)).map((m) => m.nome));
    if (!Array.isArray(v.recebido) || v.recebido.length > 500 || v.recebido.some((x) => typeof x !== 'string' || !nomes.has(x))) falha('Material: indique os artigos da lista deste trabalho.');
    db.prepare('UPDATE trabalhos_eletricista SET material_recebido = ?, atualizado = ? WHERE id = ?').run(JSON.stringify([...new Set(v.recebido)]), agoraIso(), t.id);
    responder(res, 200, fichaAtual(t));
  };

  // Ensaios medidos (continuidade do PE, isolamento, terra, diferencial): ficam no pedido, como os do painel. Um valor
  // fora do limite não é recusado, mas pede uma nota a explicar.
  h.ensaios = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, [...CHAVES_ENSAIOS, 'notas']);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const ens = {};
    for (const k of CHAVES_ENSAIOS) ens[k] = numero(v[k], `a ${NOME_ENSAIO[k]}`, { min: 0, max: 1_000_000, casas: 3 });
    ens.notas = texto(v.notas, 'a nota dos ensaios', { max: 1000, multilinha: true });
    const fora = ensaiosFora(ens);
    if (fora.length && !ens.notas) falha(`Valor fora do limite (${fora.map((k) => NOME_ENSAIO[k]).join(', ')}): escreva uma nota a explicar.`);
    const agora = agoraIso();
    ens.data = agora;
    ens.por = `eletricista:${e.id}`;
    db.prepare('UPDATE orcamentos SET ensaios = ?, atualizado = ? WHERE id = ?').run(JSON.stringify(ens), agora, o.id);
    auditar(quem(e), 'ensaios_registados', `orcamento:${o.id}`, { ...Object.fromEntries(CHAVES_ENSAIOS.map((k) => [k, ens[k]])), fora, trabalho: t.id }, ip);
    responder(res, 200, fichaAtual(t));
  };

  // Diagnóstico da avaria (só nos trabalhos de avaria): a mesma validação do painel; `null` apaga.
  h.diagnostico = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['diagnostico']);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    if (t.tipo !== 'avaria') throw new ErroApi(409, 'Só os trabalhos de avaria têm diagnóstico.');
    const agora = agoraIso();
    const guardado = v.diagnostico === undefined || v.diagnostico === null ? null : { ...validarDiagnostico(v.diagnostico), data: agora, por: `eletricista:${e.id}` };
    db.prepare('UPDATE orcamentos SET diagnostico = ?, atualizado = ? WHERE id = ?').run(guardado ? JSON.stringify(guardado) : null, agora, o.id);
    auditar(quem(e), 'diagnostico_atualizado', `orcamento:${o.id}`, guardado ? { verificacoes: guardado.verificacoes.length, tipo: guardado.tipo, conclusao: Boolean(guardado.conclusao), trabalho: t.id } : { apagado: true, trabalho: t.id }, ip);
    responder(res, 200, fichaAtual(t));
  };

  // Foto da obra: os bytes (JPEG ou PNG, até 1 MB, verificados pelos primeiros bytes) no corpo; o grupo no endereço.
  h.receberFoto = async ({ req, res, e, params }) => {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!EXTENSAO_FOTO[tipo]) throw new ErroApi(415, 'A foto tem de ser JPEG ou PNG (Content-Type: image/jpeg ou image/png).');
    if (!GRUPOS_FOTO_TRABALHO.includes(params.foto)) throw new ErroApi(404, 'Grupo de fotos desconhecido.');
    esperar([[L.fotos, String(e.id)]]);
    contar([[L.fotos, String(e.id)]]);
    expirar();
    const { t } = meuEditavel(e, params.id);
    if (db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos WHERE trabalho_id = ? AND grupo = ?').get(t.id, params.foto).n >= FOTOS_POR_GRUPO) {
      throw new ErroApi(409, `Este grupo já tem o máximo de ${FOTOS_POR_GRUPO} fotos. Apague uma para pôr outra.`);
    }
    const corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((erro) => {
      if (erro instanceof ErroApi && erro.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw erro;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    const f = { id: randomBytes(12).toString('hex'), trabalho_id: t.id, grupo: params.foto, tipo_mime: tipo };
    await escreverAtomico(ficheiroFoto(f), corpo);
    try {
      db.prepare('INSERT INTO trabalhos_eletricista_fotos (id, trabalho_id, grupo, tipo_mime, bytes, eletricista_id, criado) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(f.id, t.id, f.grupo, tipo, corpo.length, e.id, agoraIso());
    } catch (erro) {
      await unlink(ficheiroFoto(f)).catch(() => {});
      throw erro;
    }
    responder(res, 201, { ok: true, id: f.id, ...fichaAtual(t) });
  };

  const fotoDoTrabalho = (t, id) => (RE_ID_FOTO.test(id) ? db.prepare('SELECT * FROM trabalhos_eletricista_fotos WHERE id = ? AND trabalho_id = ?').get(id, t.id) ?? null : null);
  async function enviarFoto(res, f) {
    let corpo;
    try { corpo = await readFile(ficheiroFoto(f)); } catch { throw new ErroApi(404, 'Foto não encontrada.'); }
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': f.tipo_mime, 'Content-Length': corpo.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(corpo);
  }

  // A foto só sai para o eletricista do trabalho, e só enquanto o trabalho está aberto.
  h.foto = async ({ res, e, params }) => {
    const { t, o } = meu(e, params.id);
    const f = aberto(t, o) ? fotoDoTrabalho(t, params.foto) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    await enviarFoto(res, f);
  };

  h.apagarFoto = async ({ req, res, e, params }) => {
    await lerJson(req, []);
    const { t } = meuEditavel(e, params.id);
    const f = fotoDoTrabalho(t, params.foto);
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    db.prepare('DELETE FROM trabalhos_eletricista_fotos WHERE id = ?').run(f.id);
    await unlink(ficheiroFoto(f)).catch(() => {});
    responder(res, 200, fichaAtual(t));
  };

  // "Obra concluída": só com a visita marcada, as fotos e os ensaios (faltaParaConcluir). O trabalho fica
  // `concluida_eletricista`, os CEO e o cliente são avisados e fica a aguardar a confirmação do cliente (ronda 3).
  h.concluir = async ({ req, res, e, params, ip }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const falta = faltaParaConcluir(t, o);
    if (falta.length) throw new ErroApi(409, `Ainda falta: ${falta.join('; ')}.`);
    const agora = agoraIso();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'concluida_eletricista', concluida = ?, atualizado = ?
      WHERE id = ? AND eletricista_id = ? AND estado = 'visita_marcada'`).run(agora, agora, t.id, e.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho já não é seu.');
    evento(t, 'concluida', e.id, `eletricista:${e.id}`);
    auditar(quem(e), 'trabalho_concluido_eletricista', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, tipo: t.tipo, fotos: fotosDe(t.id).length }, ip);
    avisarEmpresa('Domus Energia: um eletricista deu um trabalho por concluído', [
      `O eletricista deu por concluído o trabalho do pedido n.º ${o.id} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}, ${t.concelho}).`,
      'Veja as fotos e os ensaios na ficha do pedido. Falta a confirmação do cliente.']);
    const email = emailCliente(o);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: o trabalho em sua casa está concluído', resumo: `trabalho do pedido ${o.id} concluído pelo técnico`,
        texto: ['Olá,', '', `O nosso técnico deu por concluído o trabalho do seu pedido n.º ${o.id}.`,
          'Pedimos-lhe que confirme na sua conta que ficou tudo bem. Se faltar alguma coisa, responda a este email ou ligue-nos.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, fichaAtual(t));
  };

  // ------------------------------------------------------------ painel (só CEO; rotas em api.js)
  function paraPainel(e) {
    return {
      id: e.id, nome: e.nome, email: e.email, telefone: e.telefone, nif: e.nif, dgeg: e.dgeg, concelhos: concelhosDe(e),
      experiencia: EXPERIENCIAS[e.experiencia] ?? null, notas: e.notas ?? null, estado: e.estado,
      percentagem: Number.isFinite(e.percentagem) ? e.percentagem : null, percentagem_efetiva: percentagemDe(e),
      seguro: e.seguro_id ? { tipo: e.seguro_tipo, bytes: e.seguro_bytes, url: `/painel/api/eletricistas/${e.id}/seguro` } : null,
      consentimento: e.consentimento, criado: e.criado, decidido: e.decidido ?? null, ultimo_acesso: e.ultimo_acesso ?? null,
      anonimizado: e.anonimizado ?? null,
      // Trabalhos em curso (aceites, com visita marcada ou concluídos à espera do cliente): o painel lista-os ao suspender.
      trabalhos: emCurso(e.id).map((t) => ({ id: t.id, orcamento_id: t.orcamento_id, tipo: t.tipo, tipo_nome: NOME_TIPO_TRABALHO[t.tipo], estado: t.estado, concelho: t.concelho, visita: t.visita ?? null })),
      trabalhos_em_curso: emCurso(e.id).length,
      trabalhos_largados: db.prepare("SELECT COUNT(*) AS n FROM trabalhos_eletricista_eventos WHERE eletricista_id = ? AND evento IN ('largou', 'expirou')").get(e.id).n,
    };
  }

  const emCurso = (id) => db.prepare(`SELECT * FROM trabalhos_eletricista WHERE eletricista_id = ? AND estado IN ${DO_ELETRICISTA} ORDER BY id`).all(id);

  function listar() {
    expirar();
    return {
      eletricistas: db.prepare("SELECT * FROM eletricistas ORDER BY anonimizado IS NOT NULL, estado = 'pendente' DESC, nome COLLATE NOCASE LIMIT 2000").all().map(paraPainel),
      percentagem_omissao: percentagemOmissao(),
    };
  }

  function obter(idTexto) {
    const e = linha(idNum(idTexto));
    if (!e) throw new ErroApi(404, 'Eletricista não encontrado.');
    return e;
  }

  const TRANSICOES = { aprovar: [['pendente', 'recusado'], 'aprovado'], recusar: [['pendente'], 'recusado'], suspender: [['aprovado'], 'suspenso'], reativar: [['suspenso'], 'aprovado'] };

  /** Aprovar / recusar / suspender / reativar, os concelhos e a percentagem da mão de obra (null = a da configuração). */
  function atualizar(idTexto, v, u, ip) {
    const e = obter(idTexto);
    if (e.anonimizado) throw new ErroApi(409, 'Este eletricista foi apagado (RGPD): não se pode alterar.');
    const mud = {};
    let acao = null;
    if (v.acao !== undefined) {
      acao = opcao(v.acao, 'ação', Object.keys(TRANSICOES));
      const [de, para] = TRANSICOES[acao];
      if (!de.includes(e.estado)) throw new ErroApi(409, `Não é possível ${acao} um eletricista com o estado "${e.estado}".`);
      mud.estado = para;
      if (acao === 'aprovar' || acao === 'recusar') mud.decidido = agoraIso();
    }
    if (v.concelhos !== undefined) mud.concelhos = JSON.stringify(listaConcelhos(v.concelhos));
    if (v.percentagem !== undefined) mud.percentagem = v.percentagem === null ? null : numero(v.percentagem, 'a percentagem da mão de obra', { min: 0, max: 100, casas: 1, nulo: false });
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE eletricistas SET ${cols.map((k) => `${k} = ?, `).join('')}atualizado = ? WHERE id = ?`).run(...cols.map((k) => mud[k]), agoraIso(), e.id);
    // Quem deixa de estar aprovado sai logo (a sessão também o verifica em cada pedido).
    if (mud.estado && mud.estado !== 'aprovado') {
      db.prepare('DELETE FROM eletricistas_sessoes WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM eletricistas_codigos WHERE eletricista_id = ?').run(e.id);
    }
    auditar(u, acao ? `eletricista_${{ aprovar: 'aprovado', recusar: 'recusado', suspender: 'suspenso', reativar: 'reativado' }[acao]}` : 'eletricista_atualizado', `eletricista:${e.id}`,
      { ...(mud.concelhos ? { concelhos: JSON.parse(mud.concelhos).length } : {}), ...('percentagem' in mud ? { percentagem: mud.percentagem } : {}) }, ip);
    if (acao === 'aprovar') {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: candidatura aprovada', resumo: `eletricista ${e.id} aprovado`,
        texto: [`Olá ${e.nome},`, '', 'A sua candidatura foi aprovada: já pode entrar na área do eletricista.',
          'Entra com este email e um código de 6 algarismos que enviamos na altura (sem palavra-passe).',
          'Na bolsa vê os trabalhos dos seus concelhos; o primeiro a aceitar fica com o trabalho e tem 48 h para marcar a visita.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    } else if (acao === 'recusar') {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: a sua candidatura', resumo: `eletricista ${e.id}: candidatura não aceite`,
        texto: [`Olá ${e.nome},`, '', 'Obrigado pelo interesse em trabalhar com a Domus Energia. Desta vez não avançamos com a sua candidatura.', '', 'Domus Energia'].join('\n') });
    }
    return linha(e.id);
  }

  /** O documento do seguro (só para o CEO): {tipo, extensao, corpo}. */
  async function seguro(idTexto) {
    const e = obter(idTexto);
    if (!e.seguro_id || !EXTENSAO[e.seguro_tipo]) throw new ErroApi(404, 'Documento não encontrado.');
    try {
      return { id: e.id, tipo: e.seguro_tipo, extensao: EXTENSAO[e.seguro_tipo], corpo: await readFile(ficheiro(e)) };
    } catch {
      throw new ErroApi(404, 'Documento não encontrado.');
    }
  }

  /**
   * Apagar um eletricista (RGPD; só o CEO): saem as sessões, os códigos, os avisos da bolsa, o documento do seguro e o
   * histórico dele na auditoria. Sem trabalhos nenhuns, a linha é apagada; com histórico de trabalhos (necessário para
   * a contabilidade e para a regra "quem larga não recebe") fica ANONIMIZADA: sem nome, email, telefone, NIF, DGEG,
   * concelhos, experiência nem notas. Com trabalhos em curso recusa (o CEO retira-os primeiro).
   */
  async function apagar(idTexto, u, ip) {
    const e = obter(idTexto);
    if (e.anonimizado) throw new ErroApi(409, 'Este eletricista já foi apagado (RGPD).');
    if (emCurso(e.id).length) throw new ErroApi(409, 'Este eletricista tem trabalhos em curso: retire-os primeiro.');
    const historico = Boolean(db.prepare(`SELECT 1 FROM trabalhos_eletricista WHERE eletricista_id = ?1 UNION ALL SELECT 1 FROM trabalhos_eletricista_eventos WHERE eletricista_id = ?1
      UNION ALL SELECT 1 FROM trabalhos_eletricista_fotos WHERE eletricista_id = ?1 LIMIT 1`).get(e.id));
    const agora = agoraIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM eletricistas_sessoes WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM eletricistas_codigos WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM trabalhos_eletricista_avisos WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`eletricista:${e.id}`);
      db.prepare('UPDATE auditoria SET ip = NULL WHERE email = ?').run(`eletricista:${e.id}`);
      if (historico) {
        db.prepare(`UPDATE eletricistas SET email = ?, nome = 'Eletricista apagado (RGPD)', telefone = '', nif = '', dgeg = '', concelhos = '[]', experiencia = NULL, notas = NULL,
          estado = 'suspenso', percentagem = NULL, seguro_id = NULL, seguro_tipo = NULL, seguro_bytes = NULL, ultimo_acesso = NULL, anonimizado = ?, atualizado = ? WHERE id = ?`)
          .run(`apagado-${e.id}@anonimizado.invalid`, agora, agora, e.id);
      } else db.prepare('DELETE FROM eletricistas WHERE id = ?').run(e.id);
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw erro;
    }
    await rm(pasta(e.id), { recursive: true, force: true });
    auditar(u, 'eletricista_apagado', `eletricista:${e.id}`, { modo: historico ? 'anonimizado (fica o histórico de trabalhos)' : 'apagado' }, ip);
    return { eletricista: e.id, modo: historico ? 'anonimizado' : 'apagado' };
  }

  /** Foto de um trabalho, para o painel (só CEO; a rota é verificada em api.js). */
  async function fotoParaPainel(trabalhoTexto, fotoId) {
    const t = trabalho(idNum(trabalhoTexto));
    const f = t ? fotoDoTrabalho(t, fotoId) : null;
    if (!f) throw new ErroApi(404, 'Foto não encontrada.');
    try { return { tipo: f.tipo_mime, corpo: await readFile(ficheiroFoto(f)) }; } catch { throw new ErroApi(404, 'Foto não encontrada.'); }
  }

  /** As fotos tiradas pelos eletricistas num pedido saem com ele (conta de cliente apagada, RGPD). */
  async function apagarFotosDoPedido(orcamentoId) {
    for (const { id } of db.prepare('SELECT id FROM trabalhos_eletricista WHERE orcamento_id = ?').all(orcamentoId)) {
      db.prepare('DELETE FROM trabalhos_eletricista_fotos WHERE trabalho_id = ?').run(id);
      await rm(pastaFotos(id), { recursive: true, force: true });
    }
  }

  // ---- atribuição (ficha do pedido e da obra)
  const ativoDoPedido = (orcamentoId) => db.prepare(`SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado IN ${ATIVOS} ORDER BY id DESC LIMIT 1`).get(orcamentoId) ?? null;
  const aprovadosEm = (nomeConcelho) => db.prepare("SELECT * FROM eletricistas WHERE estado = 'aprovado' ORDER BY nome COLLATE NOCASE").all().filter((e) => concelhosDe(e).includes(nomeConcelho));

  /** O bloco "Eletricista externo" de um pedido, para o painel. */
  function atribuicao(o) {
    expirar();
    const tipo = tipoAtribuivel(o);
    const t = ativoDoPedido(o.id);
    const c = concelhoDe(localidadeDe(o))?.nome ?? null;
    const e = t?.eletricista_id ? linha(t.eletricista_id) : null;
    const alvo = t?.tipo ?? tipo;
    const candidatos = alvo && (t?.concelho ?? c) ? aprovadosEm(t?.concelho ?? c) : [];
    return {
      pode: Boolean(tipo) && !t && Boolean(c), tipo: alvo, tipo_nome: alvo ? NOME_TIPO_TRABALHO[alvo] : null, concelho: t?.concelho ?? c,
      motivo: t || (tipo && c) ? null : !tipo ? 'Só se atribui um pedido aceite com a obra por fazer, ou com a visita técnica ou o diagnóstico pagos.'
        : 'A localidade do pedido não é um concelho reconhecido: corrija-a na ficha do pedido.',
      trabalho: t ? {
        id: t.id, tipo: t.tipo, estado: t.estado, modo: t.modo, aberto: aberto(t, o), eletricista: e ? { id: e.id, nome: e.nome } : null,
        percentagem: t.percentagem ?? null, aceite: t.aceite_em ? iso(t.aceite_em) : null,
        prazo: t.estado === 'aceite' && t.aceite_em ? iso(t.aceite_em + PRAZO_VISITA_MS) : null, visita: t.visita ?? null,
        recebe: e ? estimativa(o, t.tipo, Number.isFinite(t.percentagem) ? t.percentagem : percentagemDe(e)) : null,
        // Ficha de obra do eletricista (ronda 2): estado, material recebido, fotos, ensaios e o que falta para concluir.
        concluida: t.concluida ?? null,
        material: materialDoTrabalho(t, o),
        fotos: fotosDe(t.id).map((f) => ({ ...fotoPublica(f, `/painel/api/trabalhos-eletricista/${t.id}/fotos/`), grupo_nome: NOME_GRUPO_FOTO[f.grupo] })),
        ensaios: ensaiosDoPedido(o),
        diagnostico: t.tipo === 'avaria' ? Boolean(diagnosticoDoPedido(o)?.conclusao) : null,
        falta: e && t.estado !== 'concluida_eletricista' ? faltaParaConcluir(t, o) : [],
      } : null,
      candidatos: candidatos.map((x) => ({ id: x.id, nome: x.nome, percentagem: percentagemDe(x), recebe: alvo ? estimativa(o, alvo, percentagemDe(x))?.total ?? null : null })),
      historico: db.prepare(`SELECT v.evento, v.quando, v.por, e.nome FROM trabalhos_eletricista_eventos v JOIN trabalhos_eletricista t ON t.id = v.trabalho_id
        LEFT JOIN eletricistas e ON e.id = v.eletricista_id WHERE t.orcamento_id = ? ORDER BY v.id DESC LIMIT 50`).all(o.id)
        .map((x) => ({ evento: x.evento, quando: x.quando, eletricista: x.nome ?? null, por: x.por })),
    };
  }

  /** Cria o trabalho do pedido (um ativo por pedido): na bolsa, ou já atribuído (48 h para marcar a visita). */
  function novoTrabalho(o, modo, e) {
    expirar();
    const tipo = tipoAtribuivel(o);
    if (!tipo) throw new ErroApi(409, 'Só se atribui um pedido aceite com a obra por fazer, ou com a visita técnica ou o diagnóstico pagos.');
    if (ativoDoPedido(o.id)) throw new ErroApi(409, 'Este pedido já está na bolsa ou atribuído a um eletricista: retire-o primeiro.');
    const c = concelhoDe(localidadeDe(o))?.nome ?? null;
    if (!c) throw new ErroApi(409, 'A localidade do pedido não é um concelho reconhecido: corrija-a na ficha do pedido.');
    if (e && (e.estado !== 'aprovado' || !concelhosDe(e).includes(c))) throw new ErroApi(409, `Só se atribui a um eletricista aprovado que trabalhe em ${c}.`);
    const agora = relogio();
    const id = Number(db.prepare(`INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, aceite_em, criado, atualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.id, tipo, e ? 'aceite' : 'na_bolsa', modo, c, e?.id ?? null, e ? percentagemDe(e) : null, e ? agora : null, iso(agora), iso(agora)).lastInsertRowid);
    return trabalho(id);
  }

  function atribuir(o, idEletricista, u, ip) {
    if (!Number.isInteger(idEletricista)) falha('Escolha o eletricista.');
    const e = linha(idEletricista);
    if (!e) throw new ErroApi(404, 'Eletricista não encontrado.');
    const t = novoTrabalho(o, 'direto', e);
    evento(t, 'atribuido', e.id, u.email);
    auditar(u, 'trabalho_atribuido', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, tipo: t.tipo, percentagem: t.percentagem }, ip);
    correio.enviar({ para: e.email, assunto: 'Domus Energia: tem um trabalho novo', resumo: `trabalho ${t.id} atribuído ao eletricista ${e.id}`,
      texto: [`Olá ${e.nome},`, '', `Atribuímos-lhe um trabalho em ${t.concelho} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}).`,
        'Tem 48 h para marcar a visita com o cliente, na área do eletricista, em "Trabalhos".', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    return t;
  }

  function porNaBolsa(o, u, ip) {
    const t = novoTrabalho(o, 'bolsa', null);
    evento(t, 'posto_na_bolsa', null, u.email);
    const avisados = avisarBolsa(t);
    auditar(u, 'trabalho_na_bolsa', `orcamento:${o.id}`, { trabalho: t.id, tipo: t.tipo, concelho: t.concelho, eletricistas: aprovadosEm(t.concelho).length, avisados }, ip);
    return t;
  }

  /** O CEO retira o trabalho (da bolsa ou de quem o tem), em qualquer altura. As datas do pedido ficam como estão. */
  function retirar(o, u, ip) {
    expirar();
    const t = ativoDoPedido(o.id);
    if (!t) throw new ErroApi(409, 'Este pedido não está na bolsa nem atribuído.');
    db.prepare("UPDATE trabalhos_eletricista SET estado = 'retirado', atualizado = ? WHERE id = ?").run(agoraIso(), t.id);
    evento(t, 'retirado', t.eletricista_id, u.email);
    auditar(u, 'trabalho_retirado', `orcamento:${o.id}`, { trabalho: t.id, eletricista: t.eletricista_id ?? null, estava: t.estado }, ip);
    const e = t.eletricista_id ? linha(t.eletricista_id) : null;
    if (e) {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: trabalho retirado', resumo: `trabalho ${t.id} retirado ao eletricista ${e.id}`,
        texto: [`Olá ${e.nome},`, '', `O trabalho em ${t.concelho} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}) foi retirado pela Domus Energia e já não está nos seus trabalhos.`,
          'Se tiver dúvidas, fale connosco.', '', 'Domus Energia'].join('\n') });
    }
    return t;
  }

  // ------------------------------------------------------------ limpeza e prazo de 48 h (de 15 em 15 minutos)
  async function limpar() {
    const agora = relogio();
    db.prepare('DELETE FROM eletricistas_sessoes WHERE expira < ? OR criada < ?').run(agora, agora - config.contaSessaoMaxMs);
    db.prepare('DELETE FROM eletricistas_codigos WHERE expira < ?').run(agora);
    // Candidaturas não aceites: os dados e o documento saem 12 meses depois da decisão (web/privacidade.html).
    const velhas = db.prepare("SELECT id FROM eletricistas WHERE estado = 'recusado' AND decidido < ?").all(iso(agora - RETENCAO_RECUSADA_MS));
    for (const { id } of velhas) {
      db.prepare('DELETE FROM eletricistas WHERE id = ?').run(id);
      await rm(pasta(id), { recursive: true, force: true });
      auditar(null, 'eletricista_apagado_retencao', `eletricista:${id}`, { criterio: 'candidatura não aceite há 12 meses' });
    }
    return velhas.length;
  }

  let temporizador = null;
  function iniciar(intervaloMs = 15 * 60_000) {
    temporizador = setInterval(() => {
      try { expirar(); } catch (e) { registo.erro(`eletricistas, prazo das 48 h: ${e?.stack || e}`); }
      limpar().catch((e) => registo.erro(`eletricistas, limpeza: ${e?.stack || e}`));
    }, intervaloMs);
    temporizador.unref();
  }
  const parar = () => clearInterval(temporizador);

  // ------------------------------------------------------------ despacho /api/eletricista/*
  // [método, caminho, precisa de sessão, handler]
  const ROTAS_ELETRICISTA = [
    ['GET', 'candidatura', false, 'aberta'],
    ['POST', 'candidatura', false, 'candidatura'],
    ['POST', 'codigo', false, 'codigo'],
    ['POST', 'entrar', false, 'entrar'],
    ['POST', 'sair', false, 'sair'],
    ['GET', 'eu', true, 'eu'],
    ['GET', 'bolsa', true, 'bolsa'],
    ['GET', 'bolsa/:id', true, 'bolsaDetalhe'],
    ['POST', 'bolsa/:id/aceitar', true, 'aceitar'],
    ['GET', 'trabalhos', true, 'trabalhos'],
    ['GET', 'trabalhos/:id', true, 'trabalho'],
    ['POST', 'trabalhos/:id/visita', true, 'marcarVisita'],
    ['POST', 'trabalhos/:id/largar', true, 'largar'],
    ['POST', 'trabalhos/:id/material', true, 'material'],
    ['POST', 'trabalhos/:id/ensaios', true, 'ensaios'],
    ['POST', 'trabalhos/:id/diagnostico', true, 'diagnostico'],
    ['POST', 'trabalhos/:id/concluir', true, 'concluir'],
    ['GET', 'trabalhos/:id/fotos/:foto', true, 'foto'],
    ['POST', 'trabalhos/:id/fotos/:foto', true, 'receberFoto'],   // :foto = o grupo (quadro_antes…); o corpo são os bytes
    ['POST', 'trabalhos/:id/fotos/:foto/apagar', true, 'apagarFoto'],
  ].map(([metodo, caminho, sessaoPrecisa, nome]) => ({ metodo, partes: caminho.split('/'), caminho, sessao: sessaoPrecisa, nome }));
  h.candidatura = candidatura;
  // As páginas perguntam se o módulo existe (com ELETRICISTAS desligado isto dá 404 e elas mostram só uma linha).
  h.aberta = ({ res }) => responder(res, 200, { aberta: true });

  async function tratar(req, res, url, ip) {
    const segs = url.pathname.slice(CAMINHO_API.length).split('/');
    let rota = null;
    let params = {};
    let existe = false;
    for (const r of ROTAS_ELETRICISTA) {
      if (r.partes.length !== segs.length) continue;
      const p = {};
      if (!r.partes.every((x, i) => (x.startsWith(':') ? (p[x.slice(1)] = segs[i]) !== '' : x === segs[i]))) continue;
      existe = true;
      if (r.metodo === req.method || (req.method === 'HEAD' && r.metodo === 'GET')) { rota = r; params = p; break; }
    }
    if (!rota) return responder(res, existe ? 405 : 404, { erro: existe ? 'Método não permitido.' : 'Endereço desconhecido.' });
    if (rota.metodo === 'POST') {
      if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
      if (rota.nome !== 'receberFoto' && !tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    }
    let e = null;
    if (rota.sessao) {
      e = sessao(req, res);
      if (!e) throw new ErroApi(401, 'Sessão inválida ou expirada. Entre de novo.');
    }
    return h[rota.nome]({ req, res, e, params, url, ip });
  }

  return {
    tratar, sessao, listar, obter, atualizar, seguro, paraPainel, atribuicao, atribuir, porNaBolsa, retirar, expirar, limpar,
    apagar, fotoParaPainel, apagarFotosDoPedido,
    iniciar, parar, ROTAS_ELETRICISTA, estimativa,
    abrirSessao, publico,   // só para o acesso rápido de testes (acesso-rapido.js)
  };
}
