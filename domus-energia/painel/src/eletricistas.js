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
// Ronda 3 — confirmação, aprovação e pagamento: o cliente confirma na conta ("Sim" com 1 a 5 estrelas, ou "Não" com o
// que falta; 7 dias sem resposta = aceite), o CEO aprova (a obra fica concluída no painel e o valor a pagar fica FIXADO)
// ou devolve ao eletricista, o eletricista envia a fatura-recibo e indica o IBAN, e o CEO marca "Pago". Só fica "a
// pagar" com as três condições: cliente confirmou, restante pago (obras) e CEO aprovou; prazo de 7 dias depois da
// última. Quem largou o trabalho ou o deixou caducar nunca recebe por ele.
// Propostas na bolsa (decisão do dono, 2026-10-10; `config.propostasBolsa`, ligado por omissão): num pedido com planta
// (trabalho 'visita' posto na bolsa) já não há "aceitar" — vários eletricistas do concelho propõem (horas, material do
// catálogo, notas e quando podem ir; veem também as fotos que o cliente enviou, sem mais nada dele), o CEO compara e
// escolhe quando quiser, e os outros ficam de reserva (as propostas são do PEDIDO: tabela propostas_bolsa). O escolhido
// só vê o cliente e só tem as 48 h para marcar a visita DEPOIS de o cliente aceitar a proposta: aí a visita fecha e nasce
// o trabalho 'obra' para ele (aoClienteAceitar). As avarias e as atribuições diretas ficam como sempre.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroApi, responder, lerJson, lerCorpo, verificarOrigemPublica, tipoJson, lerCookies } from './http.js';
import { texto, numero, opcao, idNum, falha, diaHora, RE_TELEFONE, diagnostico as validarDiagnostico, esquemaQuadro as validarEsquemaQuadro } from './validar.js';
import { normalizarEsquema } from '../public/vendor/quadro-desenho.js';
import { RE_EMAIL } from './pedidos.js';
import { LimiteTaxa } from './limite.js';
import { iso, deCent, escreverAtomico } from './util.js';
import { CODIGO_MS, CODIGO_TENTATIVAS } from './conta.js';
import { bytesDeImagem, FOTO_MAX_BYTES, RE_ID_FOTO, semMetadados } from './fotos.js';
import { ESTADO_ARQUIVADO, GRUPOS_FOTO_TRABALHO } from './db.js';
import { CHECKLIST, NOME_TIPO as NOME_TIPO_AVARIA, MAX_CONCLUSAO } from '../public/ecras/diagnostico-conteudo.js';
import { CONCELHOS } from '../public/vendor/concelhos.js';
import { concelho as concelhoDe, deslocacaoServidor, diasDeObra, partirIva, comIva, VISITA_HORAS } from './pagamentos-pedido.js';

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
// Um trabalho ATIVO ocupa o pedido (não se atribui outro) até ser aprovado; EM CURSO = de alguém e ainda por pagar.
const ATIVOS = "('na_bolsa', 'aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada')";
const LISTA_DO_ELETRICISTA = ['aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada', 'aprovada', 'paga'];   // o trabalho é de alguém
const DO_ELETRICISTA = `(${LISTA_DO_ELETRICISTA.map((x) => `'${x}'`).join(', ')})`;
const EM_CURSO = "('aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada', 'aprovada')";
const LISTA_CONCLUIDOS = ['concluida_eletricista', 'confirmada', 'aprovada', 'paga'];   // aparecem nos pagamentos
const CONCLUIDOS = `(${LISTA_CONCLUIDOS.map((x) => `'${x}'`).join(', ')})`;
const EDITAVEIS = ['aceite', 'visita_marcada'];                                      // ainda se mexe na ficha
export const PRAZO_CONFIRMAR_MS = 7 * 24 * 3600_000;   // sem resposta do cliente: o trabalho fica aceite
export const PRAZO_PAGAMENTO_MS = 7 * 24 * 3600_000;   // pagar até 7 dias depois da última das três condições
export const TEXTO_PAGAMENTO = {
  sem_pagamento: 'Sem pagamento (largou o trabalho)', a_aguardar_cliente: 'A aguardar o cliente', a_aguardar_aprovacao: 'A aguardar aprovação',
  a_aguardar_visita: 'A aguardar o pagamento da visita pelo cliente',
  a_aguardar_restante: 'A aguardar o restante do cliente', fatura_em_falta: 'Fatura em falta', a_pagar: 'A pagar', pago: 'Pago',
};

/**
 * O estado do pagamento de um trabalho ao eletricista. Só fica `a_pagar` com TODAS as condições: o cliente confirmou
 * (ou passaram os 7 dias), o CEO aprovou e o cliente pagou o restante (nas obras; a visita e o diagnóstico já estão
 * pagos) — e com a fatura-recibo enviada. Quem largou o trabalho ou o deixou caducar nunca recebe (`sem_pagamento`).
 */
export function estadoPagamento({ largou = false, paga = false, confirmada = false, aprovada = false, restantePago = false, fatura = false }) {
  if (largou) return 'sem_pagamento';
  if (paga) return 'pago';
  if (!confirmada) return 'a_aguardar_cliente';
  if (!aprovada) return 'a_aguardar_aprovacao';
  if (!restantePago) return 'a_aguardar_restante';
  return fatura ? 'a_pagar' : 'fatura_em_falta';
}

/**
 * O estado da ida sem defeito (decisão do dono): o eletricista voltou depois de um "Não" do cliente e o CEO decidiu
 * "sem defeito". Fica `a_pagar` só com a visita paga pelo cliente, o trabalho aprovado pelo CEO e a fatura-recibo
 * desta ida; quem largou o trabalho nunca recebe.
 */
export function estadoRegresso({ largou = false, paga = false, visitaPaga = false, aprovada = false, fatura = false }) {
  if (largou) return 'sem_pagamento';
  if (paga) return 'pago';
  if (!visitaPaga) return 'a_aguardar_visita';
  if (!aprovada) return 'a_aguardar_aprovacao';
  return fatura ? 'a_pagar' : 'fatura_em_falta';
}

/** O prazo do pagamento: 7 dias depois da ÚLTIMA das datas (confirmação, aprovação, restante pago); null sem nenhuma. */
export function prazoPagamento(datas) {
  const ms = datas.map((d) => Date.parse(d ?? '')).filter(Number.isFinite);
  return ms.length ? iso(Math.max(...ms) + PRAZO_PAGAMENTO_MS) : null;
}

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
 *   `concluirObra(o, u, ip)`: a ação "Obra concluída" do painel (api.js), usada ao aprovar o trabalho de uma obra.
 *   `fotos`: as fotos do pedido (fotos.js), para quem está a propor na bolsa ver as que o cliente enviou.
 */
export function criarEletricistas({ db, config, registo, relogio, auditar, correio, pagamentos, concluirObra = () => {}, procedimentos = null, aparelhos = () => null, fotos = null }) {
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

  /**
   * `{tipo, dados}` (base64) → {tipo, bytes: Buffer}; o tipo declarado tem de ser o dos bytes. As mesmas regras para o
   * documento do seguro e para a fatura-recibo (PDF, JPG ou PNG até 5 MB); `m` = as mensagens de cada um.
   */
  function documento(v, m) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) falha(m.junte);
    for (const k of Object.keys(v)) if (!['tipo', 'dados'].includes(k)) falha(`${m.nome}: campo desconhecido "${k}".`);
    if (typeof v.tipo !== 'string' || !EXTENSAO[v.tipo]) throw new ErroApi(415, m.tipo);
    if (typeof v.dados !== 'string' || !v.dados) falha(m.vazio);
    if (v.dados.length > Math.ceil(SEGURO_MAX_BYTES / 3) * 4) throw new ErroApi(413, m.grande);
    if (!RE_BASE64.test(v.dados)) falha(m.codificado);
    const bytes = Buffer.from(v.dados, 'base64');
    if (!bytes.length) falha(m.vazio);
    if (bytes.length > SEGURO_MAX_BYTES) throw new ErroApi(413, m.grande);
    if (tipoDoDocumento(bytes) !== v.tipo) throw new ErroApi(415, m.invalido);
    return { tipo: v.tipo, bytes };
  }
  const MSG_SEGURO = {
    junte: 'Junte o documento do seguro de responsabilidade civil (PDF, JPG ou PNG).', nome: 'Documento do seguro',
    tipo: 'O documento do seguro tem de ser PDF, JPG ou PNG.', vazio: 'O documento do seguro está vazio.',
    grande: 'O documento do seguro é demasiado grande (máx. 5 MB).', codificado: 'O documento do seguro não está bem codificado.',
    invalido: 'O documento do seguro não é um PDF, JPG ou PNG válido.',
  };
  const MSG_FATURA = {
    junte: 'Junte a fatura-recibo (PDF, JPG ou PNG).', nome: 'Fatura-recibo',
    tipo: 'A fatura-recibo tem de ser PDF, JPG ou PNG.', vazio: 'A fatura-recibo está vazia.',
    grande: 'A fatura-recibo é demasiado grande (máx. 5 MB).', codificado: 'A fatura-recibo não está bem codificada.',
    invalido: 'A fatura-recibo não é um PDF, JPG ou PNG válido.',
  };
  const documentoSeguro = (v) => documento(v, MSG_SEGURO);

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

  // O IBAN sai sempre mascarado ("PT50 •••• 0154"), mesmo para o próprio; inteiro só para o CEO, nos pagamentos.
  const publico = (e) => ({ nome: e.nome, email: e.email, concelhos: concelhosDe(e), percentagem: percentagemDe(e), iban: pagamentos().ibanMascarado(e.iban ?? null) });

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
   * O que se pode atribuir num pedido AGORA: 'obra' (pedido aceite com a obra por fazer), 'visita' (visita técnica paga;
   * com as propostas na bolsa, qualquer pedido por visitar que não seja avaria, sem pagamento nenhum) ou 'avaria'
   * (diagnóstico pago), ou null. Um trabalho está ABERTO enquanto isto for o tipo dele: com a obra
   * concluída ou cancelada, a proposta enviada depois da visita, ou o pedido perdido, fecha (e os dados do cliente
   * deixam de sair para o eletricista). Um trabalho aprovado pelo CEO (ou já pago) está sempre fechado.
   */
  function tipoAtribuivel(o) {
    if (!o || o.anonimizado || o.estado === ESTADO_ARQUIVADO) return null;
    if (o.estado === 'aceite') {
      const b = obraDe(o);
      return b && !['concluida', 'cancelada'].includes(b.estado) && !o.obra_concluida ? 'obra' : null;
    }
    // Com os pagamentos online desligados (decisão do dono, 2026-10-04) a visita não se paga antes: o pedido por
    // visitar atribui-se na mesma, como visita sem custo (o eletricista só recebe se houver obra: recebeDe).
    // Propostas na bolsa (decisão do dono, 2026-10-11): deixou de haver visita técnica paga à parte — o pedido com planta
    // vai para a bolsa sem pagamento nenhum (a visita vem depois de o cliente aceitar, incluída no sinal). A avaria
    // continua a exigir o diagnóstico pago (pagamentos-pedido.js visitaIncluida).
    if (['novo', 'contactado', 'visita_marcada'].includes(o.estado) && (pagamentos().temVisita(o) || !config.pagamentoPedido || pagamentos().visitaIncluida(o))) return simDe(o)?.funil === 'avaria' ? 'avaria' : 'visita';
    return null;
  }
  // Propostas na bolsa (decisão do dono, 2026-10-10): uma visita posta na bolsa é POR PROPOSTA (não se aceita: o CEO
  // escolhe). O escolhido fica com o trabalho `aceite` mas SEM `aceite_em` — é isso que diz "à espera de o cliente
  // aceitar": o prazo das 48 h não conta (expirar só olha para quem tem `aceite_em`), não vê o cliente e não marca visita.
  const porProposta = (t) => config.propostasBolsa && t.tipo === 'visita' && t.modo === 'bolsa';
  // (Não depende do interruptor: um 'aceite' sem `aceite_em` só nasce da escolha entre propostas. Desligar PROPOSTAS_BOLSA
  // com um escolhido à espera não lhe pode abrir os dados do cliente nem deixar o trabalho preso.)
  const esperaCliente = (t) => t.tipo === 'visita' && t.modo === 'bolsa' && t.estado === 'aceite' && (t.aceite_em === null || t.aceite_em === undefined);
  // O trabalho do escolhido continua aberto com a proposta já enviada ao cliente (senão fechava antes de o cliente aceitar).
  const aberto = (t, o) => !['aprovada', 'paga'].includes(t.estado)
    && (tipoAtribuivel(o) === t.tipo || (esperaCliente(t) && o?.estado === 'proposta_enviada' && !o.anonimizado));

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

  /**
   * O que o eletricista recebe por ESTE trabalho: a estimativa de sempre; numa visita (ou diagnóstico) que o cliente
   * não pagou — pagamentos online desligados — nada (`gratis`): a visita de orçamento é por conta dele e só ganha com a obra.
   */
  /** O que o escolhido vai receber, visto pela proposta dele (enquanto o cliente não aceita): percentagem × mão de obra + deslocação. */
  function recebeDoTrabalho(t, o, pct) {
    const p = config.propostasBolsa && esperaCliente(t) ? propostaDe(t) : null;
    if (!p) return recebeDe(o, t.tipo, pct);
    const s = valoresDaProposta(o, p).sugestao;
    const parte = Math.round(s.mao_obra * pct) / 100;
    return { percentagem: pct, mao_obra: s.mao_obra, parte_mao_obra: parte, deslocacao: s.deslocacao, total: Math.round((parte + s.deslocacao) * 100) / 100, provisoria: false };
  }
  function recebeDe(o, tipo, pct) {
    if (tipo !== 'obra' && !pagamentos().temVisita(o)) return { percentagem: pct, mao_obra: 0, parte_mao_obra: 0, deslocacao: 0, total: 0, provisoria: false, gratis: true };
    return estimativa(o, tipo, pct);
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
   * diagnóstico registados no painel. `soComprado` (obra com proposta aceite; decisão do dono, 2026-10-11): sem o material da
   * simulação (o das divisões, o "Quadro elétrico e geral" e as melhorias) — o cliente comprou o material da proposta,
   * que vai em `material` ("Material a levantar"). Ficam a lista de trabalho por divisão, a planta e os esquemas.
   */
  function relatorioTecnico(rel, completo, soComprado = false) {
    if (!rel) return null;
    const mat = (linhas) => linhas.map((l) => ({ artigo: l.artigo, quantidade: l.quantidade }));
    const r = soComprado ? {
      acoes: rel.acoes,
      divisoes: rel.divisoes.map((d) => ({ nome: d.nome, trabalho: d.trabalho })),
      planta: rel.planta, esquemas: rel.esquemas, terra_nota: rel.terra_nota, esquema_quadro: rel.esquema_quadro,
    } : {
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
    const r = { id: t.id, concelho: t.concelho, tipo: t.tipo, titulo: titulo(o, t.tipo), ...duracao(o, t.tipo, rel), recebe: recebeDe(o, t.tipo, percentagemDe(e)) };
    if (comRelatorio) r.relatorio = relatorioTecnico(rel, false);
    // Por proposta (decisão do dono, 2026-10-10): a página mostra o formulário em vez de "Aceitar"; quem propõe vê ainda
    // as fotos que o cliente enviou (só o nome da divisão: a legenda é texto livre do cliente e não sai) e a sua proposta.
    if (porProposta(t)) {
      const minha = propostaBolsa(o.id, e.id);
      r.por_proposta = true;
      r.proposta_enviada = Boolean(minha) && minha.estado !== 'retirada';
      if (comRelatorio) {
        r.fotos = fotosDoCliente(t, o);
        r.minha_proposta = r.proposta_enviada ? { ...propostaDe({ proposta: jsonDaProposta(minha) }), disponibilidade: minha.disponibilidade } : null;
      }
    }
    return r;
  }
  /** As fotos do pedido para quem propõe: id, de onde é ("Quadro elétrico" ou o nome da divisão) e o endereço na área do eletricista. */
  function fotosDoCliente(t, o) {
    if (!fotos) return [];
    // Revisão de segurança (2026-10-11): só as fotos que já existiam quando o CEO validou o pedido (o cliente pode
    // juntar ou trocar fotos depois; essas não vão para a bolsa sem nova validação) e sem o nome da divisão, que é
    // texto escrito pelo cliente.
    let n = 0;
    return fotos.listar(o, simDe(o), `/api/eletricista/bolsa/${t.id}/fotos/`).filter((f) => !o.validacao_em || !f.criado || f.criado <= o.validacao_em)
      .map((f) => ({ id: f.id, nome: f.chave === 'quadro' ? 'Quadro elétrico' : `Foto ${++n}`, url: f.url }));
  }

  /** O trabalho do próprio eletricista: os dados do cliente só enquanto está aberto. */
  function paraEletricista(t, o, completo = false) {
    const rel = relatorioDe(o);
    const estaAberto = aberto(t, o);
    // Escolhido entre as propostas da bolsa, com o cliente ainda por aceitar: sem dados do cliente e sem mexer em nada.
    const espera = estaAberto && esperaCliente(t);
    const r = {
      id: t.id, concelho: t.concelho, tipo: t.tipo, titulo: titulo(o, t.tipo), estado: t.estado, aberto: estaAberto, espera_cliente: espera, ...duracao(o, t.tipo, rel),
      recebe: recebeDoTrabalho(t, o, Number.isFinite(t.percentagem) ? t.percentagem : percentagemOmissao()),
      aceite: t.aceite_em ? iso(t.aceite_em) : null,
      prazo: t.estado === 'aceite' && t.aceite_em ? iso(t.aceite_em + PRAZO_VISITA_MS) : null,
      visita: t.visita ?? null, concluida: t.concluida ?? null,
    };
    // Obra parada por segurança (aoPararObra): já não vale a estimativa — recebe só o trabalho já feito, fixado pelo CEO.
    const fixado = detalheDe(t);
    if (fixado?.obra_parada) { r.recebe = fixado; r.obra_parada = true; }
    if (!completo) return r;
    r.cliente = estaAberto && !espera ? { nome: o.nome, telefone: o.telefone ?? null, morada: o.morada ?? null, localidade: o.localidade ?? null } : null;
    // Proposta depois da visita (horas + material do catálogo, sem valores): só numa visita ou diagnóstico já marcados.
    r.proposta = estaAberto ? propostaDe(t) : null;
    // Obra vinda de proposta (propostas na bolsa): o preço que o cliente aceitou é definitivo — a ficha avisa que trabalho
    // a mais só com o cliente a aceitar primeiro (decisão do dono, 2026-10-11).
    if (config.propostasBolsa && t.tipo === 'obra' && r.proposta) r.de_proposta = true;
    // Na obra com proposta aceite o eletricista vê só o que o cliente comprou (decisão do dono, 2026-10-11): o relatório
    // vai sem o material da simulação e o quadro sem a casa (sem ela a área dele não calcula o "quadro ideal").
    r.relatorio = estaAberto ? relatorioTecnico(rel, !espera, r.de_proposta === true) : null;
    r.material = estaAberto ? materialDoTrabalho(t, o, rel) : [];
    // Quadro elétrico (decisão do dono, 2026-10-05): o existente, que o eletricista desenha (pela foto ou na visita), e a
    // casa do pedido (planta, potência e fases), para a área dele calcular o quadro ideal e o que falta.
    r.quadro = estaAberto ? quadroDoPedido(o, r) : null;
    if (r.de_proposta && r.quadro) r.quadro.casa = null;
    if (espera && r.quadro) r.quadro.pode_desenhar = false;
    r.pode_proposta = estaAberto && t.tipo !== 'obra' && t.estado === 'visita_marcada';
    // Ficha de obra (ronda 2): fotos antes e depois, ensaios medidos, diagnóstico (avaria) e o que falta para concluir.
    r.editavel = estaAberto && !espera && EDITAVEIS.includes(t.estado);
    // O trabalho voltou: o que o cliente disse que falta, ou o motivo da devolução da Domus (ronda 3).
    r.reclamacao = estaAberto && EDITAVEIS.includes(t.estado) && t.reclamacao
      ? { texto: t.reclamacao, de: t.reclamacao_de, quando: t.reclamacao_quando, decisao: t.reclamacao_decisao ?? null } : null;
    r.fotos = estaAberto ? fotosDe(t.id).map((f) => fotoPublica(f, `/api/eletricista/trabalhos/${t.id}/fotos/`)) : [];
    r.grupos_fotos = GRUPOS_FOTO_TRABALHO.map((g) => ({ grupo: g, nome: NOME_GRUPO_FOTO[g] }));
    r.fotos_max = FOTOS_POR_GRUPO;
    r.ensaios = estaAberto ? ensaiosDoPedido(o) : null;
    r.diagnostico = estaAberto && t.tipo === 'avaria' ? { modelo: MODELO_DIAGNOSTICO, atual: diagnosticoDoPedido(o) } : null;
    r.falta = r.editavel ? faltaParaConcluir(t, o) : [];
    // Trabalho a mais (decisão do dono, 2026-10-11): os que ele propôs nesta obra, com o estado — nunca o preço ao
    // cliente — e se pode propor outro (um à espera de cada vez).
    r.extras = t.tipo === 'obra' ? extrasParaEletricista(t) : [];
    r.pode_extra = r.editavel && t.tipo === 'obra' && !extraPendente(t.id);
    // Ida perdida (decisão do dono, 2026-10-11): as que ele assinalou nesta obra, com o estado, e se pode assinalar
    // agora "O cliente não estava" (só depois da hora da visita marcada; uma à espera de cada vez).
    r.idas_perdidas = t.tipo === 'obra' ? idasParaEletricista(t) : [];
    r.pode_ida_perdida = r.editavel && recusaDaIda(t) === null;
    // Checklists dos procedimentos (docs/PROCEDIMENTOS.md): só numa obra, com a obra do pedido, enquanto está aberta.
    r.checklists = estaAberto && t.tipo === 'obra' && o.obra_id && procedimentos ? procedimentos.daObra(o.obra_id, { eletricista: t.eletricista_id }) : null;
    return r;
  }

  /** O quadro existente do pedido (sem quem o desenhou) e os dados da casa de que o quadro ideal se calcula. */
  function quadroDoPedido(o, r) {
    let existente = null;
    try { const e = o.esquema_quadro ? JSON.parse(o.esquema_quadro) : null; if (e && typeof e === 'object' && !Array.isArray(e)) { const { por: _por, ...resto } = e; existente = resto; } } catch { existente = null; }
    const s = simDe(o);
    const p = s?.planta && typeof s.planta === 'object' ? s.planta : null;
    const lista = (v) => (Array.isArray(v) ? v : []);
    const casa = p ? {
      planta: {
        divisoes: lista(p.divisoes).slice(0, 60).map((d) => ({ id: d?.id, nome: d?.nome, piso: d?.piso, x_cm: d?.x_cm, y_cm: d?.y_cm, largura_cm: d?.largura_cm, altura_cm: d?.altura_cm, ...(Array.isArray(d?.pontos) ? { pontos: d.pontos } : {}) })),
        elementos: lista(p.elementos).slice(0, 400).map((e) => ({ tipo: e?.tipo, divisao: e?.divisao ?? null, props: e?.props && typeof e.props === 'object' ? e.props : {} })),
      },
      potencia_contratada_kva: typeof s.casa?.potencia_contratada_kva === 'number' ? s.casa.potencia_contratada_kva : null,
      fases: s.casa?.fases === 'tri' || s.casa?.fases === 'mono' ? s.casa.fases : null,
      // O que decide os circuitos e os AFDD (quadro.js dividirZonas, circuitoComAfdd): sem isto o ideal do eletricista
      // não era o do relatório do cliente.
      tipo: typeof s.casa?.tipo === 'string' ? s.casa.tipo.slice(0, 40) : null,
      tipologia: typeof s.casa?.tipologia === 'string' ? s.casa.tipologia.slice(0, 10) : null,
      quartos: Number.isInteger(s.casa?.quartos) ? s.casa.quartos : null,
      area_m2: typeof s.casa?.area_m2 === 'number' ? s.casa.area_m2 : null,
      potencia_sugerida_kva: typeof s.quadro?.potencia_sugerida_kva === 'number' ? s.quadro.potencia_sugerida_kva : null,
    } : null;
    return { existente, casa, pode_desenhar: r.aberto && EDITAVEIS.includes(r.estado) };
  }

  // ---- material: a lista do pedido com o que o eletricista já levantou ou recebeu (por trabalho)
  const recebidoDe = (t) => { try { const v = JSON.parse(t.material_recebido ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
  function materialDoTrabalho(t, o, rel = relatorioDe(o)) {
    const recebido = new Set(recebidoDe(t));
    // Com proposta do eletricista no trabalho (propostas na bolsa), o material é o que ele propôs e o cliente aceitou.
    const p = config.propostasBolsa && t.tipo === 'obra' ? propostaDe(t) : null;
    const lista = p ? p.material.map((m) => ({ nome: m.nome, quantidade: m.qtd })) : materialDe(o, t.tipo, rel);
    return lista.map((m) => ({ ...m, recebido: recebido.has(m.nome) }));
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
   * O que falta para dar o trabalho por concluído (lista vazia = pode), igual na obra, na visita técnica e no
   * diagnóstico: a visita marcada, pelo menos uma foto de antes e uma de depois e os três ensaios (isolamento,
   * diferencial e terra); na avaria, também a conclusão do diagnóstico.
   */
  function faltaParaConcluir(t, o) {
    const falta = [];
    if (t.estado === 'aceite') falta.push('marcar a visita');
    const n = (grupos) => db.prepare(`SELECT COUNT(*) AS n FROM trabalhos_eletricista_fotos WHERE trabalho_id = ? AND grupo IN (${grupos.map(() => '?').join(', ')})`).get(t.id, ...grupos).n;
    if (!n(['quadro_antes', 'pontos_antes'])) falta.push('uma foto de antes');
    if (!n(['quadro_depois', 'pontos_depois'])) falta.push('uma foto de depois');
    const e = pagamentos().ensaiosDe(o) ?? {};
    for (const k of ENSAIOS_OBRIGATORIOS) if (e[k] === null || e[k] === undefined) falta.push(`ensaio: ${NOME_ENSAIO[k]}`);
    if (t.tipo === 'avaria' && !diagnosticoDoPedido(o)?.conclusao) falta.push('a conclusão do diagnóstico');
    // Trabalho a mais à espera da Domus Energia ou do cliente: a obra não se dá por concluída sem a resposta.
    if (extraPendente(t.id)) falta.push('a resposta ao trabalho a mais');
    // Ida perdida à espera da Domus Energia: sem a resposta não se sabe se a visita conta, e a obra não se conclui.
    if (idaPendente(t.id)) falta.push('a resposta à ida perdida');
    // Só se conclui a partir da hora marcada para a visita (decisão do dono, 2026-10-11).
    if (visitaPorAcontecer(t)) falta.push(`a visita ainda não aconteceu (marcada para ${dataTexto(t.visita)})`);
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
  const agoraLisboa = (desvioMs = 0) => new Date(relogio() + desvioMs).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
  /** A visita marcada ainda não chegou (as duas são hora de Lisboa sem fuso, "AAAA-MM-DDTHH:MM": comparam-se como texto). */
  const visitaPorAcontecer = (t) => Boolean(t.visita) && t.visita > agoraLisboa();
  // Remarcar para trás (decisão do dono, 2026-10-11): quem foi mais cedo regista a data verdadeira, até 7 dias antes.
  const REMARCAR_ATRAS_MS = 7 * 86_400_000;

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
    fecharExtras(t, agora);
    fecharIdas(t, agora);
    // Propostas na bolsa: a proposta de quem largou (ou deixou caducar) não volta a aparecer ao CEO, e a cópia que ficou
    // no trabalho sai com ele (senão "Preencher pela proposta do eletricista" continuava a mostrá-la). As de reserva ficam.
    if (config.propostasBolsa) {
      db.prepare("UPDATE propostas_bolsa SET estado = 'retirada' WHERE orcamento_id = ? AND eletricista_id = ?").run(t.orcamento_id, t.eletricista_id);
      if (porProposta(t)) db.prepare('UPDATE trabalhos_eletricista SET proposta = NULL WHERE id = ?').run(t.id);
    }
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
    // De volta à bolsa: os outros eletricistas da zona recebem "voltou à bolsa" (nunca quem o largou ou deixou caducar).
    if (t.modo === 'bolsa') avisarBolsa(trabalho(t.id), true);
    return true;
  }

  /**
   * Aviso da bolsa: um email a cada eletricista aprovado com o concelho do trabalho — "Novo trabalho em <concelho>" e a
   * ligação para a área, sem nada do cliente nem valores. UM email "novo trabalho" por trabalho e por eletricista
   * (`trabalhos_eletricista_avisos`). Quando o trabalho VOLTA à bolsa (`voltou`), quem já tinha sido avisado recebe
   * "voltou à bolsa" — menos quem o largou ou o deixou caducar, que nunca mais é avisado dele. Devolve quantos emails saíram.
   */
  function avisarBolsa(t, voltou = false) {
    if (!t || t.estado !== 'na_bolsa') return 0;
    const ins = db.prepare('INSERT OR IGNORE INTO trabalhos_eletricista_avisos (trabalho_id, eletricista_id, quando) VALUES (?, ?, ?)');
    // Por proposta (decisão do dono, 2026-10-10) já não é "o primeiro a aceitar": o email diz para enviar a proposta.
    const comoFica = porProposta(t) ? 'Veja o relatório técnico na área do eletricista e envie a sua proposta (horas, material e quando pode ir): a Domus Energia escolhe o eletricista.'
      : 'Veja o relatório técnico e o valor que recebe na área do eletricista. O primeiro a aceitar fica com o trabalho.';
    let n = 0;
    for (const e of aprovadosEm(t.concelho).slice(0, 500)) {
      if (largouOuExpirou(t, e) || (t.so_para && t.so_para !== e.id)) continue;
      if (!ins.run(t.id, e.id, agoraIso()).changes) {
        if (!voltou) continue;
        n += 1;
        correio.enviar({ para: e.email, assunto: `Domus Energia: um trabalho voltou à bolsa em ${t.concelho}`, resumo: `aviso da bolsa: trabalho ${t.id} voltou, ao eletricista ${e.id}`,
          texto: ['Olá,', '', `Um trabalho em ${t.concelho} (${porProposta(t) ? 'pedido com planta' : NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}) voltou à bolsa e está outra vez disponível.`,
            comoFica, ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
        continue;
      }
      n += 1;
      correio.enviar({ para: e.email, assunto: `Domus Energia: novo trabalho em ${t.concelho}`, resumo: `aviso da bolsa: trabalho ${t.id} ao eletricista ${e.id}`,
        texto: ['Olá,', '', `Há um trabalho novo na bolsa em ${t.concelho} (${porProposta(t) ? 'pedido com planta' : NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}).`,
          comoFica, ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
    return n;
  }

  /**
   * Os prazos, verificados em cada leitura e de 15 em 15 minutos: 48 h depois de aceite sem visita marcada o trabalho
   * volta; 7 dias depois de dado por concluído sem resposta do cliente fica aceite (sem avaliação). Devolve quantos
   * trabalhos voltaram (48 h).
   */
  function expirar() {
    const idos = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado = 'aceite' AND aceite_em <= ?").all(relogio() - PRAZO_VISITA_MS);
    for (const t of idos) devolver(t, 'expirou', 'sistema');
    const calados = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado = 'concluida_eletricista' AND concluida <= ?").all(iso(relogio() - PRAZO_CONFIRMAR_MS));
    for (const t of calados) {
      // A data da confirmação é o fim dos 7 dias (não o momento em que alguém leu): é dela que conta o prazo do pagamento.
      const quando = iso(Date.parse(t.concluida) + PRAZO_CONFIRMAR_MS);
      if (!db.prepare("UPDATE trabalhos_eletricista SET estado = 'confirmada', confirmada = ?, confirmada_auto = 1, atualizado = ? WHERE id = ? AND estado = 'concluida_eletricista'").run(quando, agoraIso(), t.id).changes) continue;
      evento(t, 'confirmada', t.eletricista_id, 'sistema');
      auditar(null, 'trabalho_confirmado_auto', `orcamento:${t.orcamento_id}`, { trabalho: t.id, criterio: '7 dias sem resposta do cliente' });
      avisarEmpresa('Domus Energia: um trabalho ficou aceite (7 dias sem resposta)', [
        `O cliente do pedido n.º ${t.orcamento_id} não respondeu em 7 dias: o trabalho ficou aceite.`, 'Falta a sua aprovação, na ficha do pedido.']);
    }
    return idos.length;
  }

  // Quem largou o trabalho ou o deixou caducar: não o volta a ver na bolsa, e NUNCA recebe por ele.
  const largouOuExpirou = (t, e) => Boolean(db.prepare("SELECT 1 FROM trabalhos_eletricista_eventos WHERE trabalho_id = ? AND eletricista_id = ? AND evento IN ('largou', 'expirou') LIMIT 1").get(t.id, e.id));
  /** O eletricista vê este trabalho na bolsa? Concelho dele, pedido aberto, e nunca o largou nem deixou caducar. */
  // `so_para` (migração 48): a proposta foi pedida só a um eletricista — os outros do concelho não veem o trabalho.
  const visivelNaBolsa = (t, e, o) => t.estado === 'na_bolsa' && concelhosDe(e).includes(t.concelho) && Boolean(o) && aberto(t, o) && !largouOuExpirou(t, e)
    && (t.so_para === null || t.so_para === undefined || t.so_para === e.id);

  h.bolsa = ({ res, e }) => {
    expirar();
    const lista = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado = 'na_bolsa' ORDER BY id DESC LIMIT 200").all()
      .map((t) => [t, pedidoDe(t.orcamento_id)]).filter(([t, o]) => visivelNaBolsa(t, e, o)).map(([t, o]) => paraBolsa(t, o, e));
    // `propostas_bolsa`: a página não adivinha se as visitas são por proposta (cada trabalho leva ainda `por_proposta`).
    responder(res, 200, { concelhos: concelhosDe(e), trabalhos: lista, propostas_bolsa: config.propostasBolsa });
  };

  /** Trabalho da bolsa visível para este eletricista (404 para os outros: nem fica a saber que existe). */
  function daBolsa(e, idTexto) {
    const t = trabalho(idNum(idTexto));
    const o = t ? pedidoDe(t.orcamento_id) : null;
    if (!t || !o || !concelhosDe(e).includes(t.concelho)) throw new ErroApi(404, 'Trabalho não encontrado.');
    if (LISTA_DO_ELETRICISTA.includes(t.estado) && t.eletricista_id !== e.id && t.modo === 'bolsa') throw new ErroApi(409, porProposta(t) ? 'A Domus Energia já escolheu outro eletricista para este trabalho.' : 'Outro eletricista aceitou este trabalho primeiro.');
    if (!visivelNaBolsa(t, e, o)) throw new ErroApi(404, 'Trabalho não encontrado.');
    return { t, o };
  }

  h.bolsaDetalhe = ({ res, e, params }) => {
    expirar();
    const { t, o } = daBolsa(e, params.id);
    responder(res, 200, { trabalho: paraBolsa(t, o, e, true), prazo_visita_horas: PRAZO_VISITA_MS / 3600_000, propostas_bolsa: config.propostasBolsa });
  };

  // Aceitar: atómico. O UPDATE só muda a linha se ainda está na bolsa; o segundo a chegar não muda nada e recebe 409.
  h.aceitar = async ({ req, res, e, params, ip }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t } = daBolsa(e, params.id);
    // Por proposta (decisão do dono, 2026-10-10): uma visita da bolsa não se aceita — propõe-se e o CEO escolhe.
    if (porProposta(t)) throw new ErroApi(409, 'Neste trabalho não há "Aceitar": envie a sua proposta (horas, material e quando pode ir) e a Domus Energia escolhe o eletricista.');
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
    // `propostas_bolsa` (só com o fluxo ligado): a página diz "em que for escolhido" no estado vazio.
    responder(res, 200, { trabalhos: lista, ...(config.propostasBolsa ? { propostas_bolsa: true } : {}) });
  };

  /** Trabalho deste eletricista (404 para os outros). */
  function meu(e, idTexto) {
    const t = trabalho(idNum(idTexto));
    const o = t ? pedidoDe(t.orcamento_id) : null;
    if (!t || !o || t.eletricista_id !== e.id || !LISTA_DO_ELETRICISTA.includes(t.estado)) throw new ErroApi(404, 'Trabalho não encontrado.');
    return { t, o };
  }
  const JA_CONCLUIDO = 'Já deu este trabalho por concluído: está a aguardar a confirmação do cliente.';
  /** … e que ainda se pode mexer: aberto e ainda não dado por concluído. */
  function meuEditavel(e, idTexto) {
    const { t, o } = meu(e, idTexto);
    if (t.estado === 'concluida_eletricista') throw new ErroApi(409, JA_CONCLUIDO);
    if (!EDITAVEIS.includes(t.estado) || !aberto(t, o)) throw new ErroApi(409, 'Este trabalho já está fechado.');
    // Escolhido na bolsa mas o cliente ainda não aceitou a proposta: não marca visita nem mexe na ficha.
    if (esperaCliente(t)) throw new ErroApi(409, 'O cliente ainda não aceitou a proposta: avisamos por email quando aceitar.');
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
    // A primeira marcação é sempre no futuro. Com a visita já marcada aceita-se uma data passada (até 7 dias): o
    // eletricista que foi mais cedo regista a data verdadeira, e só assim pode dar o trabalho por concluído.
    const passada = quando <= agoraLisboa();
    if (passada && !t.visita) falha('Escolha um dia e uma hora no futuro.');
    if (passada && quando < agoraLisboa(-REMARCAR_ATRAS_MS)) falha('A data da visita não pode ser de há mais de 7 dias.');
    const agora = agoraIso();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'visita_marcada', visita = ?, atualizado = ?
      WHERE id = ? AND eletricista_id = ? AND estado IN ('aceite', 'visita_marcada')`).run(quando, agora, t.id, e.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho já não é seu.');
    if (t.tipo === 'obra') db.prepare('UPDATE obras SET data = ?, hora = ?, por_agendar = 0, atualizado = ? WHERE id = ?').run(quando.slice(0, 10), quando.slice(11), agora, o.obra_id);
    else db.prepare("UPDATE orcamentos SET data_visita = ?, estado = CASE WHEN estado IN ('novo', 'contactado') THEN 'visita_marcada' ELSE estado END, visita_faltou = NULL, atualizado = ? WHERE id = ?").run(quando, agora, o.id);
    evento(t, 'visita_marcada', e.id, `eletricista:${e.id}`);
    auditar(quem(e), 'visita_marcada', `orcamento:${o.id}`, { data_visita: quando, trabalho: t.id, por: 'eletricista externo' }, ip);
    // Uma data passada é só o registo de quando a visita foi: o cliente não recebe "visita marcada" para um dia que já passou.
    const email = passada ? null : emailCliente(o);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: visita marcada', resumo: `visita do pedido ${o.id} marcada para ${quando}`,
        texto: ['Olá,', '', `A visita do seu pedido n.º ${o.id} está marcada para ${dataTexto(quando)}.`, 'Vai a sua casa um técnico em nome da Domus Energia.', ...(t.tipo === 'obra' && pagamentos().visitaIncluida(o) ? ['Se for possível, a obra fica feita nesse dia.'] : []),
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
    if (t.estado === 'concluida_eletricista') throw new ErroApi(409, JA_CONCLUIDO);
    if (!EDITAVEIS.includes(t.estado)) throw new ErroApi(409, 'Este trabalho já está fechado.');
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
    // A lista que o eletricista vê (teste de 2026-10-11: numa obra vinda de uma proposta a validação usava a da simulação e recusava tudo).
    const nomes = new Set(materialDoTrabalho(t, o).map((m) => m.nome));
    if (!Array.isArray(v.recebido) || v.recebido.length > 500 || v.recebido.some((x) => typeof x !== 'string' || !nomes.has(x))) falha('Material: indique os artigos da lista deste trabalho.');
    db.prepare('UPDATE trabalhos_eletricista SET material_recebido = ?, atualizado = ? WHERE id = ?').run(JSON.stringify([...new Set(v.recebido)]), agoraIso(), t.id);
    responder(res, 200, fichaAtual(t));
  };

  // ---- procedimentos (docs/PROCEDIMENTOS.md): os publicados, só de leitura, e as checklists da obra do próprio trabalho
  h.procedimentos = ({ res }) => responder(res, 200, { procedimentos: procedimentos.publicados(false) });
  h.procedimento = ({ res, params }) => responder(res, 200, { procedimento: procedimentos.publicado(params.id, false) });

  /** A obra do trabalho, para as checklists: só num trabalho de obra, deste eletricista e ainda por concluir. */
  function obraDoMeu(e, idTexto) {
    const { t, o } = meuEditavel(e, idTexto);
    if (t.tipo !== 'obra' || !o.obra_id) throw new ErroApi(409, 'As checklists são das obras: este trabalho não tem obra.');
    return { t, o };
  }
  // Começar a checklist de um procedimento publicado na obra deste trabalho.
  h.iniciarChecklist = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['procedimento_id']);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    expirar();
    const { t, o } = obraDoMeu(e, params.id);
    procedimentos.iniciar(o.obra_id, v.procedimento_id, { eletricista: e }, ip);
    responder(res, 201, fichaAtual(t));
  };
  // Marcar ou desmarcar um passo (fica quem e quando).
  h.marcarPasso = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['passo', 'feito']);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    expirar();
    const { t, o } = obraDoMeu(e, params.id);
    procedimentos.marcar(o.obra_id, params.lista, v, { eletricista: e }, ip);
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
    let corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((erro) => {
      if (erro instanceof ErroApi && erro.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw erro;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    corpo = semMetadados(corpo, tipo);
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

  // ------------------------------------------------------------ proposta do eletricista (depois da visita)
  const artigoAtivo = db.prepare('SELECT sku, nome, categoria, preco_venda_iva_cent FROM catalogo WHERE sku = ? AND ativo = 1');
  /** A proposta guardada no trabalho, com os nomes do catálogo (sem preços): {horas, material: [{sku, nome, qtd}], notas, quando} ou null. */
  function propostaDe(t) {
    let p = null;
    try { p = JSON.parse(t.proposta ?? 'null'); } catch { p = null; }
    if (!p || typeof p !== 'object') return null;
    const nome = db.prepare('SELECT nome FROM catalogo WHERE sku = ?');
    return { horas: p.horas, notas: p.notas ?? null, quando: p.quando, material: (Array.isArray(p.material) ? p.material : []).map((m) => ({ sku: m.sku, nome: nome.get(m.sku)?.nome ?? m.sku, qtd: m.qtd })) };
  }
  /** O catálogo para o eletricista escolher o material: só o artigo e a categoria, nunca preços. */
  h.catalogo = ({ res }) => responder(res, 200, { artigos: db.prepare('SELECT sku, nome, categoria FROM catalogo WHERE ativo = 1 ORDER BY categoria, nome').all() });

  // POST trabalhos/:id/proposta {horas, material: [{sku, qtd}], notas}: o que a obra precisa, visto na visita. O
  // eletricista nunca escreve euros: o painel calcula a proposta (propostaDoPedido) e o CEO revê-a antes de a enviar.
  /**
   * O eletricista desenha o quadro existente do pedido (decisão do dono, 2026-10-05): o mesmo esquema do painel
   * (validar.js esquemaQuadro), guardado em `orcamentos.esquema_quadro`; `null` apaga. Só no seu trabalho, enquanto aberto.
   */
  h.esquemaQuadro = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['esquema'], 64 * 1024);
    // Sem o campo não se apaga nada (um corpo vazio apagava o esquema guardado): só `esquema: null` apaga.
    if (v.esquema === undefined) falha('Indique o esquema do quadro (ou null para o apagar).');
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const agora = agoraIso();
    let guardado = null;
    if (v.esquema !== undefined && v.esquema !== null) {
      validarEsquemaQuadro(v.esquema);
      guardado = { ...normalizarEsquema(v.esquema), data: agora, por: `eletricista:${e.id}` };
    }
    db.prepare('UPDATE orcamentos SET esquema_quadro = ?, atualizado = ? WHERE id = ?').run(guardado ? JSON.stringify(guardado) : null, agora, o.id);
    auditar(quem(e), 'esquema_quadro_eletricista', `orcamento:${o.id}`, guardado ? {
      trabalho: t.id, geral: guardado.disjuntor_geral?.amperes ?? null, diferenciais: guardado.diferenciais.length, disjuntores: guardado.disjuntores.length, modulos_livres: guardado.modulos_livres,
    } : { trabalho: t.id, apagado: true }, ip);
    responder(res, 200, fichaAtual(t));
  };

  // ---- Ativação de aparelhos (decisões do dono, 2026-10-09; docs/ATIVACAO-APARELHOS.md): dentro de um trabalho seu, o
  // eletricista regista o chip (MAC) de cada aparelho que montou. Fica à espera do CEO, ou vale logo se o eletricista
  // for de confiança (`ativa_sem_aprovacao`). Só nos aparelhos que a casa do pedido já tem: quem cria aparelhos e lhes
  // dá credenciais é sempre o painel.
  const ativacoesDoTrabalho = (t) => db.prepare('SELECT id, aparelho, mac, serie, estado, criado, decidido FROM aparelhos_ativacoes WHERE trabalho_id = ? ORDER BY id DESC LIMIT 100').all(t.id);
  /** A casa do pedido: só a que o painel lhe ligou ao converter (`orcamentos.cliente`). O `codigo_cliente` vem do formulário público e não serve de prova. */
  const casaDoPedido = (o) => o.cliente ?? null;
  async function aparelhosDoTrabalho(e, t, o) {
    const ap = aparelhos();
    // Com o trabalho fechado o eletricista deixa de ver a casa (como os dados do cliente): ficam só os seus registos.
    const c = aberto(t, o) ? casaDoPedido(o) : null;
    const lista = c && ap ? await ap.listar(c) : null;
    return {
      cliente: c, casa_criada: Boolean(lista), sem_aprovacao: Boolean(e.ativa_sem_aprovacao),
      pode_registar: Boolean(lista) && EDITAVEIS.includes(t.estado) && aberto(t, o),
      aparelhos: (lista ?? []).map((a) => ({ id: a.id, nome: a.nome, divisao: a.divisao ?? null, chip: a.chip.estado })),
      pedidos: ativacoesDoTrabalho(t),
    };
  }
  h.aparelhosTrabalho = async ({ res, e, params }) => {
    expirar();
    const { t, o } = meu(e, params.id);
    responder(res, 200, await aparelhosDoTrabalho(e, t, o));
  };
  h.chipTrabalho = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['aparelho', 'mac', 'serie']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const ap = aparelhos();
    const c = casaDoPedido(o);
    const lista = c && ap ? await ap.listar(c) : null;
    if (!lista) throw new ErroApi(409, 'Este pedido ainda não tem a casa criada no programa: fale com a Domus.');
    const id = texto(v.aparelho, 'o aparelho', { max: 32, obrigatorio: true });
    if (!lista.some((a) => a.id === id)) throw new ErroApi(404, 'Esse aparelho não é desta casa.');
    const mac = ap.mac(v.mac);
    if (!mac) falha('Código do chip (MAC): 12 algarismos hexadecimais, por exemplo 38:1F:8D:12:AB:CD.');
    const serie = texto(v.serie, 'o número de série', { max: 40 }) ?? null;
    const agora = agoraIso();
    const direto = Boolean(e.ativa_sem_aprovacao);
    // Um pedido por aparelho e por trabalho: o novo substitui o que ainda estava à espera.
    const jaEsperava = db.prepare("UPDATE aparelhos_ativacoes SET estado = 'anulada', decidido = ?, decidido_por = ? WHERE trabalho_id = ? AND aparelho = ? AND estado = 'pendente'").run(agora, `eletricista:${e.id}`, t.id, id).changes > 0;
    // Registo direto: as aprovações anteriores deste aparelho ficam substituídas (senão anular uma antiga apagava o chip da nova).
    if (direto) db.prepare("UPDATE aparelhos_ativacoes SET estado = 'anulada', decidido = ?, decidido_por = 'substituída' WHERE cliente = ? AND aparelho = ? AND estado = 'aprovada'").run(agora, c, id);
    const aid = Number(db.prepare(`INSERT INTO aparelhos_ativacoes (cliente, aparelho, mac, serie, trabalho_id, eletricista_id, estado, criado, decidido, decidido_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c, id, mac, serie, t.id, e.id, direto ? 'aprovada' : 'pendente', agora, direto ? agora : null, direto ? 'automático' : null).lastInsertRowid);
    if (direto) ap.registar(c, id, { mac, serie }, `eletricista:${e.id}`);
    auditar(quem(e), 'aparelho_chip_eletricista', `cliente:${c}`, { ativacao: aid, trabalho: t.id, aparelho: id, mac, direto }, ip);
    // Um email por aparelho à espera: corrigir o código de um registo que já esperava não volta a avisar.
    if (!direto && !jaEsperava) {
      const painel = config.origens[0] ? ['', `Painel: ${config.origens[0]}/painel/#/ativacoes`] : [];
      for (const { email } of db.prepare("SELECT email FROM utilizadores WHERE papel = 'ceo' AND ativo = 1 LIMIT 5").all()) {
        correio.enviar({ para: email, assunto: 'Domus Energia: ativação de aparelho por aprovar', resumo: `ativação ${aid} por aprovar (aparelho ${id} de ${c})`,
          texto: ['Olá,', '', `${e.nome} registou o chip do aparelho "${id}" da casa "${c}" (pedido n.º ${o.id}).`, `Chip: ${mac}${serie ? ` · série ${serie}` : ''}`, '',
            'Fica à espera da sua aprovação.', ...painel, '', 'Domus Energia'].join('\n') });
      }
    }
    responder(res, 200, await aparelhosDoTrabalho(e, t, o));
  };

  /** As horas, o material do catálogo (o mesmo artigo soma-se) e as notas de uma proposta: as mesmas regras depois da visita e na bolsa. */
  function lerProposta(v) {
    const horas = numero(v.horas, 'as horas de trabalho', { min: 0.5, max: 500, casas: 1, nulo: false });
    if (!Array.isArray(v.material) || v.material.length > 60) falha('O material tem de ser uma lista (até 60 artigos).');
    const qtds = new Map();
    for (const m of v.material) {
      if (!m || typeof m !== 'object' || typeof m.sku !== 'string' || !artigoAtivo.get(m.sku)) falha('Material: escolha os artigos do catálogo.');
      if (!Number.isInteger(m.qtd) || m.qtd < 1 || m.qtd > 999) falha('Material: quantidade entre 1 e 999.');
      qtds.set(m.sku, Math.min(999, (qtds.get(m.sku) ?? 0) + m.qtd));
    }
    const notas = texto(v.notas, 'as notas', { max: 1000, multilinha: true });
    return { horas, material: [...qtds].map(([sku, qtd]) => ({ sku, qtd })), notas };
  }

  h.proposta = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['horas', 'material', 'notas']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    if (t.tipo === 'obra') throw new ErroApi(409, 'A proposta faz-se depois da visita técnica, não numa obra.');
    if (t.estado !== 'visita_marcada') throw new ErroApi(409, 'Marque primeiro a visita com o cliente.');
    const { horas, material, notas } = lerProposta(v);
    const agora = agoraIso();
    const proposta = { horas, material, notas, quando: agora };
    db.prepare('UPDATE trabalhos_eletricista SET proposta = ?, atualizado = ? WHERE id = ? AND eletricista_id = ?').run(JSON.stringify(proposta), agora, t.id, e.id);
    auditar(quem(e), 'proposta_eletricista', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, horas, artigos: proposta.material.length }, ip);
    avisarEmpresa('Domus Energia: um eletricista enviou a proposta de um pedido', [
      `O eletricista enviou a proposta do pedido n.º ${o.id} (${t.concelho}): as horas de trabalho e o material.`,
      'Veja-a na ficha do pedido, em Orçamentos: "Preencher pela proposta do eletricista", reveja os valores e envie a proposta ao cliente.']);
    responder(res, 200, fichaAtual(t));
  };

  /**
   * A proposta do eletricista de um pedido, para o painel (ficha do pedido): a mais recente das visitas/diagnósticos,
   * com os valores calculados SEM IVA — mão de obra = horas × a tarifa/hora; material = os preços de venda do
   * catálogo; deslocação = a do concelho do pedido. null sem proposta.
   */
  function propostaDoPedido(o) {
    const t = db.prepare("SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND proposta IS NOT NULL AND tipo <> 'obra' ORDER BY id DESC LIMIT 1").get(o.id);
    const p = t ? propostaDe(t) : null;
    if (!p) return null;
    const e = t.eletricista_id ? linha(t.eletricista_id) : null;
    const { material, sugestao } = valoresDaProposta(o, p);
    // `visita_incluida`: a visita faz-se depois de aceitar a proposta e vai no preço (pagamentos-pedido.js visitaIncluida) —
    // para o texto que "Preencher pela proposta do eletricista" escreve ao cliente não a prometer no fluxo antigo.
    return { trabalho: t.id, eletricista: e ? { id: e.id, nome: e.nome } : null, quando: p.quando, horas: p.horas, notas: p.notas, material, sugestao,
      visita_incluida: Boolean(pagamentos()?.visitaIncluida?.(o)) };
  }
  /**
   * Os valores SEM IVA de uma proposta ({horas, material: [{sku, nome, qtd}]}) neste pedido: o material com o valor de
   * cada linha e as três partes (`sugestao`). O mesmo cálculo para "Preencher pela proposta do eletricista" e para a
   * tabela comparativa das propostas da bolsa.
   */
  function valoresDaProposta(o, p) {
    const cfg = lerCfg();
    const iva = pagamentos().ivaAtual();
    const semIva = (cent) => partirIva(Math.round(cent), iva).base;
    const tarifa = Number.isFinite(Number(cfg.tarifa_hora_iva)) ? Number(cfg.tarifa_hora_iva) : 38;
    const material = p.material.map((m) => { const a = db.prepare('SELECT preco_venda_iva_cent FROM catalogo WHERE sku = ?').get(m.sku); return { ...m, valor: a ? deCent(semIva(a.preco_venda_iva_cent * m.qtd)) : null }; });
    const d = deslocacaoServidor(localidadeDe(o), cfg);
    return {
      material,
      sugestao: {
        mao_obra: deCent(semIva(p.horas * tarifa * 100)),
        material: deCent(material.reduce((s, m) => s + Math.round((m.valor ?? 0) * 100), 0)),
        deslocacao: d === null ? 0 : deCent(semIva(d * 100)),
      },
    };
  }

  // ------------------------------------------------------------ propostas na bolsa (decisão do dono, 2026-10-10)
  // Num trabalho 'visita' da bolsa não há "aceitar": cada eletricista do concelho envia a sua proposta — as horas e o
  // material do catálogo (como a proposta depois da visita: nunca euros), as notas e quando pode ir — e pode corrigi-la
  // enquanto o trabalho está na bolsa. Fica guardada por PEDIDO e por eletricista (propostas_bolsa): o trabalho retirado e
  // posto outra vez na bolsa é outra linha, e as propostas de reserva têm de continuar na tabela do CEO.
  const propostaBolsa = (orcamentoId, eletricistaId) => db.prepare('SELECT * FROM propostas_bolsa WHERE orcamento_id = ? AND eletricista_id = ?').get(orcamentoId, eletricistaId) ?? null;
  /** A proposta da bolsa no formato da coluna `trabalhos_eletricista.proposta` (é o que se copia para o trabalho ao escolher). */
  function jsonDaProposta(p) {
    let material = [];
    try { const m = JSON.parse(p.material); if (Array.isArray(m)) material = m; } catch { material = []; }
    return JSON.stringify({ horas: p.horas, material, notas: p.notas ?? null, disponibilidade: p.disponibilidade, quando: p.atualizado });
  }

  // POST bolsa/:id/proposta {horas, material: [{sku, qtd}], notas, disponibilidade}: propor (ou corrigir a proposta) num
  // trabalho por proposta que este eletricista vê na bolsa. O CEO é avisado da primeira vez (corrigir não volta a avisar).
  h.proporBolsa = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['horas', 'material', 'notas', 'disponibilidade']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = daBolsa(e, params.id);
    if (!porProposta(t)) throw new ErroApi(409, 'Neste trabalho não se propõe: o primeiro a aceitar fica com ele.');
    const { horas, material, notas } = lerProposta(v);
    const disponibilidade = texto(v.disponibilidade, 'quando pode ir (ex.: a partir de 20 de outubro, manhãs)', { max: 200, min: 3, obrigatorio: true });
    const antes = propostaBolsa(o.id, e.id);
    const agora = agoraIso();
    db.prepare(`INSERT INTO propostas_bolsa (orcamento_id, eletricista_id, horas, material, notas, disponibilidade, estado, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, 'enviada', ?, ?)
      ON CONFLICT(orcamento_id, eletricista_id) DO UPDATE SET horas = excluded.horas, material = excluded.material, notas = excluded.notas,
        disponibilidade = excluded.disponibilidade, estado = 'enviada', atualizado = excluded.atualizado`).run(o.id, e.id, horas, JSON.stringify(material), notas, disponibilidade, agora, agora);
    auditar(quem(e), 'proposta_bolsa', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, horas, artigos: material.length, corrigida: Boolean(antes) }, ip);
    if (!antes || antes.estado === 'retirada') {
      avisarEmpresa('Domus Energia: chegou uma proposta de um eletricista', [
        `Um eletricista enviou uma proposta para o pedido n.º ${o.id} (${t.concelho}): as horas, o material e quando pode ir.`,
        'Compare as propostas na ficha do pedido, em "Eletricista externo", e escolha quando quiser.']);
    }
    responder(res, 200, { trabalho: paraBolsa(t, o, e, true), mensagem: 'Proposta enviada. A Domus Energia escolhe o eletricista e avisa por email.' });
  };

  // As fotos que o cliente enviou no pedido, para quem está a propor: o MESMO critério da bolsa (daBolsa → visivelNaBolsa;
  // 404 para os outros), e só num trabalho por proposta. O nome do ficheiro não leva o n.º do pedido (o do painel leva).
  h.fotoBolsa = async ({ res, e, params }) => {
    const { t, o } = daBolsa(e, params.id);
    const f = porProposta(t) && fotos && fotosDoCliente(t, o).some((x) => x.id === params.foto) ? fotos.obter(o.id, params.foto) : null;
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

  /**
   * A tabela comparativa do CEO (ficha do pedido): as propostas deste pedido que ainda contam — à espera, de reserva ou a
   * escolhida; nunca a de quem largou — de eletricistas ainda aprovados. Valores SEM IVA: o preço para o cliente = mão
   * de obra + material + deslocação (valoresDaProposta); o eletricista recebe a percentagem DELE × mão de obra + a
   * deslocação; para a Domus fica o resto. `pode_escolher`: com o trabalho na bolsa e o eletricista ainda a vê-lo.
   */
  function propostasDoPedido(o, ativo) {
    const naBolsa = Boolean(ativo) && ativo.estado === 'na_bolsa' && porProposta(ativo);
    return db.prepare("SELECT * FROM propostas_bolsa WHERE orcamento_id = ? AND estado <> 'retirada' ORDER BY atualizado, id").all(o.id)
      .map((p) => [p, linha(p.eletricista_id)]).filter(([, e]) => e && e.estado === 'aprovado').map(([p, e]) => {
        const dados = propostaDe({ proposta: jsonDaProposta(p) });
        const { material, sugestao } = valoresDaProposta(o, dados);
        const cent = (v) => Math.round(v * 100);
        const pct = percentagemDe(e);
        const recebe = Math.round((cent(sugestao.mao_obra) * pct) / 100) + cent(sugestao.deslocacao);
        const preco = cent(sugestao.mao_obra) + cent(sugestao.material) + cent(sugestao.deslocacao);
        return {
          eletricista: { id: e.id, nome: e.nome }, estado: p.estado, horas: p.horas, material, artigos: material.length, notas: p.notas ?? null,
          disponibilidade: p.disponibilidade, quando: p.atualizado, percentagem: pct,
          mao_obra: sugestao.mao_obra, material_valor: sugestao.material, deslocacao: sugestao.deslocacao,
          preco: deCent(preco), recebe: deCent(recebe), domus: deCent(preco - recebe),
          avaliacao: avaliacaoDe(e.id),
          concluidos: db.prepare("SELECT COUNT(*) AS n FROM trabalhos_eletricista WHERE eletricista_id = ? AND estado IN ('confirmada', 'aprovada', 'paga')").get(e.id).n,
          pode_escolher: naBolsa && p.estado !== 'escolhida' && visivelNaBolsa(ativo, e, o),
        };
      });
  }

  /**
   * "Escolher" (só o CEO; ficha do pedido): o trabalho da bolsa passa para este eletricista — `aceite`, com a percentagem
   * fixada e SEM `aceite_em` (as 48 h só contam depois de o cliente aceitar) — e a proposta dele é copiada para o
   * trabalho, para "Preencher pela proposta do eletricista" funcionar como sempre. Ele recebe um email; os outros que
   * estavam à espera recebem outro e ficam de reserva.
   */
  function escolher(o, idEletricista, u, ip) {
    expirar();
    if (!Number.isInteger(idEletricista)) falha('Escolha o eletricista.');
    const t = ativoDoPedido(o.id);
    if (!t || t.estado !== 'na_bolsa' || !porProposta(t)) throw new ErroApi(409, 'Só se escolhe uma proposta com o pedido na bolsa: ponha-o primeiro na bolsa.');
    if (!aberto(t, o)) throw new ErroApi(409, 'Este pedido já não está por visitar: retire-o da bolsa.');
    const e = linha(idEletricista);
    const p = e ? propostaBolsa(o.id, e.id) : null;
    if (!p || !['enviada', 'reserva'].includes(p.estado)) throw new ErroApi(404, 'Esse eletricista não tem uma proposta neste pedido.');
    if (e.estado !== 'aprovado' || !visivelNaBolsa(t, e, o)) throw new ErroApi(409, `Só se escolhe um eletricista aprovado que trabalhe em ${t.concelho} e que não tenha largado este trabalho.`);
    const agora = agoraIso();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'aceite', eletricista_id = ?, percentagem = ?, aceite_em = NULL, proposta = ?, atualizado = ?
      WHERE id = ? AND estado = 'na_bolsa'`).run(e.id, percentagemDe(e), jsonDaProposta(p), agora, t.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho já não está na bolsa.');
    // Só quem estava à espera é avisado de que ficou de reserva (quem já era reserva de uma escolha anterior já sabe).
    const outros = db.prepare("SELECT eletricista_id FROM propostas_bolsa WHERE orcamento_id = ? AND estado = 'enviada' AND eletricista_id <> ?").all(o.id, e.id);
    db.prepare("UPDATE propostas_bolsa SET estado = CASE WHEN eletricista_id = ? THEN 'escolhida' ELSE 'reserva' END WHERE orcamento_id = ? AND estado <> 'retirada'").run(e.id, o.id);
    evento(t, 'atribuido', e.id, u.email);
    auditar(u, 'trabalho_escolhido', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, percentagem: percentagemDe(e), horas: p.horas, reservas: outros.length }, ip);
    correio.enviar({ para: e.email, assunto: `Domus Energia: foi escolhido para um trabalho em ${t.concelho}`, resumo: `trabalho ${t.id}: eletricista ${e.id} escolhido entre as propostas`,
      texto: [`Olá ${e.nome},`, '', `Foi escolhido para um trabalho em ${t.concelho}. O cliente ainda vai receber a proposta: avisamos quando aceitar.`,
        'Até lá não precisa de fazer nada: o trabalho está em "Trabalhos", na área do eletricista.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    for (const { eletricista_id: id } of outros) {
      const x = linha(id);
      if (!x || x.estado !== 'aprovado') continue;
      correio.enviar({ para: x.email, assunto: `Domus Energia: o trabalho em ${t.concelho} foi para outro colega`, resumo: `trabalho ${t.id}: proposta do eletricista ${x.id} fica de reserva`,
        texto: [`Olá ${x.nome},`, '', `Desta vez o trabalho em ${t.concelho} foi para outro colega. A sua proposta fica de reserva.`,
          'Se o trabalho voltar a ficar livre, a Domus Energia pode escolher a sua proposta e avisamos por email.', '', 'Domus Energia'].join('\n') });
    }
    return trabalho(t.id);
  }

  /**
   * O cliente aceitou a proposta (o pedido passou a `aceite` e a obra nasceu: api.js obraDoPedido): a obra fica
   * AUTOMATICAMENTE com o eletricista escolhido (decisão do dono, 2026-10-10). A visita dele fecha sem email (fica
   * `retirado`, com o evento) e nasce o trabalho 'obra' em modo direto, com a mesma percentagem e `aceite_em` = agora: é
   * daqui que contam as 48 h para marcar a visita, e a partir daqui é o fluxo de obra de sempre (vê o cliente, marca,
   * ficha de obra, conclui, o cliente confirma, o CEO aprova e paga). A visita está incluída: não se paga à parte. Se ele
   * largar a obra ou a deixar caducar vale a regra dos trabalhos diretos (volta ao CEO, por atribuir). Sem escolhido,
   * nada muda. Devolve o trabalho da obra, ou null.
   */
  function aoClienteAceitar(o) {
    if (!o) return null;
    const t = db.prepare("SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND tipo = 'visita' AND modo = 'bolsa' AND estado = 'aceite' AND aceite_em IS NULL ORDER BY id DESC LIMIT 1").get(o.id);
    const e = t?.eletricista_id ? linha(t.eletricista_id) : null;
    if (!t || !e) return null;
    const agora = relogio();
    db.prepare("UPDATE trabalhos_eletricista SET estado = 'retirado', atualizado = ? WHERE id = ? AND estado = 'aceite'").run(iso(agora), t.id);
    evento(t, 'retirado', e.id, 'sistema');
    // Entretanto suspenso, ou a obra já tem um trabalho: a obra fica por atribuir à mão, como antes.
    if (e.estado !== 'aprovado' || db.prepare("SELECT 1 FROM trabalhos_eletricista WHERE orcamento_id = ? AND tipo = 'obra' AND estado != 'retirado' LIMIT 1").get(o.id)) return null;
    const id = Number(db.prepare(`INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, aceite_em, criado, atualizado)
      VALUES (?, 'obra', 'aceite', 'direto', ?, ?, ?, ?, ?, ?)`).run(o.id, t.concelho, e.id, t.percentagem, agora, iso(agora), iso(agora)).lastInsertRowid);
    // A obra leva o que ficou combinado (teste de 2026-10-11: o eletricista via as horas e o material da simulação):
    // a proposta dele fica no trabalho da obra e as horas na obra.
    if (t.proposta) {
      db.prepare('UPDATE trabalhos_eletricista SET proposta = ? WHERE id = ?').run(t.proposta, id);
      let horas = null;
      try { horas = Number(JSON.parse(t.proposta)?.horas); } catch { horas = null; }
      if (o.obra_id && Number.isFinite(horas) && horas > 0) db.prepare('UPDATE obras SET horas_estimadas = ?, atualizado = ? WHERE id = ?').run(horas, iso(agora), o.obra_id);
      // … e o material na obra (teste de 2026-10-11: a obra nascia com a lista da simulação, que o cliente não comprou).
      const mat = propostaDe({ proposta: t.proposta })?.material ?? [];
      if (o.obra_id && mat.length) {
        db.prepare("UPDATE obras SET material = ?, atualizado = ? WHERE id = ? AND estado NOT IN ('concluida', 'cancelada')")
          .run(JSON.stringify(mat.map((m) => ({ sku: m.sku, nome: m.nome, quantidade: m.qtd, feito: false }))), iso(agora), o.obra_id);
      }
    }
    const obra = trabalho(id);
    evento(obra, 'atribuido', e.id, 'sistema');
    auditar(null, 'trabalho_obra_do_escolhido', `orcamento:${o.id}`, { trabalho: id, visita: t.id, eletricista: e.id, percentagem: t.percentagem });
    correio.enviar({ para: e.email, assunto: 'Domus Energia: o cliente aceitou a proposta', resumo: `trabalho ${id}: o cliente aceitou, obra do eletricista ${e.id}`,
      texto: [`Olá ${e.nome},`, '', `O cliente aceitou a proposta do trabalho em ${t.concelho}: tem 48 h para marcar a visita. Pode fazer a obra nessa visita.`,
        'O nome, a morada e o telefone do cliente já estão na área do eletricista, em "Trabalhos".', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    return obra;
  }

  // "Obra concluída": só com a visita marcada, as fotos e os ensaios (faltaParaConcluir). O trabalho fica
  // `concluida_eletricista`, os CEO e o cliente são avisados e fica a aguardar a confirmação do cliente (7 dias).
  h.concluir = async ({ req, res, e, params, ip }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    if (extraPendente(t.id)) throw new ErroApi(409, 'Há um trabalho a mais à espera de resposta.');
    if (idaPendente(t.id)) throw new ErroApi(409, 'Há uma ida perdida à espera da Domus Energia.');
    if (visitaPorAcontecer(t)) throw new ErroApi(409, `A visita está marcada para ${dataTexto(t.visita)}. Se já fez o trabalho, mude primeiro a data da visita.`);
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
          'Pedimos-lhe que confirme na sua conta que ficou tudo bem, ou que nos diga o que falta. Sem resposta em 7 dias, o trabalho fica aceite.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    responder(res, 200, fichaAtual(t));
  };

  // ------------------------------------------------------------ trabalho a mais (decisão do dono, 2026-10-11; migração 47)
  // O preço da proposta aceite é definitivo. Se no local o eletricista encontrar o que não se via na planta nem nas fotos,
  // PROPÕE o trabalho a mais (descrição, horas e material do catálogo: nunca euros); o CEO põe o preço e envia ao cliente;
  // o cliente aceita ou não na conta. Só com o "aceito" o eletricista faz esse trabalho, e o valor soma ao restante que o
  // cliente paga no fim (pagamentos-pedido.js valores). O eletricista nunca vê o preço ao cliente.
  const extraDe = (idTexto) => db.prepare('SELECT * FROM trabalhos_extra WHERE id = ?').get(idNum(idTexto)) ?? null;
  const extraPendente = (trabalhoId) => Boolean(db.prepare("SELECT 1 FROM trabalhos_extra WHERE trabalho_id = ? AND estado IN ('proposto', 'enviado') LIMIT 1").get(trabalhoId));
  /** O material de um extra com os nomes do catálogo (sem preços): [{sku, nome, qtd}]. */
  const materialDoExtra = (x) => { let m = []; try { m = JSON.parse(x.material); } catch { m = []; } return propostaDe({ proposta: JSON.stringify({ horas: x.horas, material: m }) }).material; };
  /** O que o eletricista recebe por um extra (€ sem IVA), no formato de `recebe`: a percentagem dele × a mão de obra. */
  function recebeDoExtra(maoObraCent, pct) {
    const parte = Math.round((maoObraCent * pct) / 100);
    return { percentagem: pct, mao_obra: deCent(maoObraCent), parte_mao_obra: deCent(parte), deslocacao: 0, total: deCent(parte), provisoria: false };
  }
  const pctDoTrabalho = (t) => (Number.isFinite(t?.percentagem) ? t.percentagem : percentagemOmissao());
  /** O trabalho do extra ainda está com o eletricista que o propôs, por concluir? (Só assim se envia ao cliente e se aceita.) */
  function extraVivo(x) {
    const t = trabalho(x.trabalho_id);
    return Boolean(t) && t.eletricista_id === x.eletricista_id && EDITAVEIS.includes(t.estado);
  }
  /** O trabalho saiu do eletricista (largou, caducou ou foi retirado): os extras à espera de resposta deixam de valer. */
  function fecharExtras(t, agora) {
    db.prepare("UPDATE trabalhos_extra SET estado = 'retirado', nota = 'O trabalho saiu do eletricista.', atualizado = ? WHERE trabalho_id = ? AND estado IN ('proposto', 'enviado')").run(agora, t.id);
  }
  /** A mão de obra (cêntimos sem IVA) dos extras que o cliente aceitou neste trabalho: é sobre ela que o eletricista recebe a mais. */
  const maoObraExtras = (trabalhoId) => db.prepare("SELECT COALESCE(SUM(COALESCE(mao_obra_cent, 0)), 0) AS s FROM trabalhos_extra WHERE trabalho_id = ? AND estado = 'aceite'").get(trabalhoId).s;
  /** O valor a receber por um trabalho com o trabalho a mais aceite: junta `extras` (mão de obra) e `parte_extras` e soma ao total. */
  // Com idas perdidas confirmadas (migração 50): a deslocação de cada ida vai inteira para ele (`idas_perdidas`, € sem
  // IVA), como a deslocação da obra, e soma também ao total.
  function comExtras(valor, t) {
    const mao = valor && t.tipo === 'obra' ? maoObraExtras(t.id) : 0;
    const idas = valor && t.tipo === 'obra' ? idasDoTrabalho(t) : 0;
    if (!mao && !idas) return valor;
    const parte = Math.round((mao * valor.percentagem) / 100);
    return { ...valor, ...(mao ? { extras: deCent(mao), parte_extras: deCent(parte) } : {}), ...(idas ? { idas_perdidas: deCent(idas) } : {}), total: deCent(Math.round(valor.total * 100) + parte + idas) };
  }

  /** Os extras de um trabalho para quem o tem: descrição, horas, material e estado. Nunca o preço ao cliente. */
  function extrasParaEletricista(t) {
    return db.prepare('SELECT * FROM trabalhos_extra WHERE trabalho_id = ? ORDER BY id').all(t.id)
      // Os de outro eletricista que teve este trabalho antes: só os que o cliente aceitou (são para fazer).
      .filter((x) => x.eletricista_id === t.eletricista_id || x.estado === 'aceite')
      .map((x) => ({
        id: x.id, descricao: x.descricao, horas: x.horas, material: materialDoExtra(x), estado: x.estado, quando: x.respondido_em ?? x.enviado_em ?? x.atualizado,
        // Só o motivo da Domus Energia quando não avançou (o que o cliente escreveu ao recusar não vai para o eletricista).
        nota: x.estado === 'retirado' ? x.nota ?? null : null,
        recebe: x.estado === 'aceite' ? recebeDoExtra(x.mao_obra_cent ?? 0, pctDoTrabalho(t)) : null,
        pode_retirar: x.estado === 'proposto' && x.eletricista_id === t.eletricista_id,
      }));
  }

  // POST trabalhos/:id/extra {descricao, horas, material: [{sku, qtd}]}: propor trabalho a mais na sua obra, enquanto
  // ainda está a trabalhar. Um à espera de resposta de cada vez. Os CEO são avisados por email.
  h.proporExtra = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['descricao', 'horas', 'material']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    if (t.tipo !== 'obra') throw new ErroApi(409, 'O trabalho a mais só se propõe numa obra.');
    const descricao = texto(v.descricao, 'o que encontrou e o que é preciso fazer', { max: 600, min: 5, multilinha: true, obrigatorio: true });
    const { horas, material } = lerProposta({ horas: v.horas, material: v.material });
    if (extraPendente(t.id)) throw new ErroApi(409, 'Já há um trabalho a mais à espera de resposta nesta obra: espere pela resposta ou retire-o antes de propor outro.');
    // Com o restante já pago online não há onde somar o valor (o restante paga-se uma vez): trata-se por fora.
    if (pagamentos().restantePago(o).quando) throw new ErroApi(409, 'O cliente já pagou o restante desta obra: fale com a Domus Energia.');
    const agora = agoraIso();
    const id = Number(db.prepare(`INSERT INTO trabalhos_extra (orcamento_id, trabalho_id, eletricista_id, descricao, horas, material, estado, criado, atualizado)
      VALUES (?, ?, ?, ?, ?, ?, 'proposto', ?, ?)`).run(o.id, t.id, e.id, descricao, horas, JSON.stringify(material), agora, agora).lastInsertRowid);
    auditar(quem(e), 'trabalho_extra_proposto', `orcamento:${o.id}`, { extra: id, trabalho: t.id, eletricista: e.id, horas, artigos: material.length }, ip);
    avisarEmpresa('Domus Energia: um eletricista propôs trabalho a mais', [
      `O eletricista encontrou trabalho a mais na obra do pedido n.º ${o.id} (${t.concelho}): diz o que é, as horas e o material.`,
      'Veja-o na ficha do pedido, em Orçamentos: ponha o preço e envie ao cliente, ou não avance. Sem o cliente aceitar, esse trabalho não é feito.']);
    responder(res, 200, fichaAtual(t));
  };

  // POST trabalhos/:id/extra/:extra/retirar: o eletricista desiste do que propôs, só enquanto a Domus Energia não o enviou ao cliente.
  h.retirarExtra = async ({ req, res, e, params, ip }) => {
    await lerJson(req, []);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meu(e, params.id);
    const x = extraDe(params.extra);
    if (!x || x.trabalho_id !== t.id || x.eletricista_id !== e.id) throw new ErroApi(404, 'Trabalho a mais não encontrado.');
    const agora = agoraIso();
    const r = db.prepare("UPDATE trabalhos_extra SET estado = 'retirado', nota = NULL, atualizado = ? WHERE id = ? AND estado = 'proposto'").run(agora, x.id);
    if (!r.changes) throw new ErroApi(409, x.estado === 'enviado' ? 'Este trabalho a mais já foi enviado ao cliente: já não se retira aqui. Fale com a Domus Energia.' : 'Este trabalho a mais já teve resposta.');
    auditar(quem(e), 'trabalho_extra_retirado', `orcamento:${o.id}`, { extra: x.id, trabalho: t.id, eletricista: e.id }, ip);
    responder(res, 200, fichaAtual(t));
  };

  /**
   * Os extras de um pedido para o painel (ficha do pedido), todos: o que o eletricista propôs, a `sugestao` de preço
   * (SEM IVA, como na proposta: mão de obra = horas × a tarifa/hora; material ao preço de venda do catálogo), o preço que
   * o CEO pôs (`valores`, com o total com IVA) e o que o eletricista recebe (a percentagem dele × a mão de obra).
   */
  function extrasDoPedido(o) {
    return db.prepare('SELECT * FROM trabalhos_extra WHERE orcamento_id = ? ORDER BY id').all(o.id).map((x) => {
      const e = x.eletricista_id ? linha(x.eletricista_id) : null;
      const { material, sugestao } = valoresDaProposta(o, { horas: x.horas, material: materialDoExtra(x) });
      const posto = x.mao_obra_cent !== null && x.mao_obra_cent !== undefined;
      const cent = posto ? x.mao_obra_cent + (x.material_cent ?? 0) : null;
      return {
        id: x.id, trabalho: x.trabalho_id, eletricista: e ? { id: e.id, nome: e.nome } : null, descricao: x.descricao, horas: x.horas, material,
        estado: x.estado, nota: x.nota ?? null, criado: x.criado, enviado_em: x.enviado_em ?? null, respondido_em: x.respondido_em ?? null,
        sugestao: { mao_obra: sugestao.mao_obra, material: sugestao.material },
        valores: posto ? { mao_obra: deCent(x.mao_obra_cent), material: deCent(x.material_cent ?? 0), total: deCent(cent), total_iva: deCent(comIva(cent, pagamentos().ivaDoPedido(o))) } : null,
        recebe: recebeDoExtra(posto ? x.mao_obra_cent : Math.round(sugestao.mao_obra * 100), pctDoTrabalho(trabalho(x.trabalho_id))),
        pode_enviar: x.estado === 'proposto' && extraVivo(x), pode_nao_avancar: ['proposto', 'enviado'].includes(x.estado),
      };
    });
  }
  /** O extra `idTexto` deste pedido (404 se for de outro). */
  function extraDoPedido(o, idTexto) {
    const x = extraDe(idTexto);
    if (!x || x.orcamento_id !== o.id) throw new ErroApi(404, 'Trabalho a mais não encontrado.');
    return x;
  }

  /**
   * "Enviar ao cliente" (só o CEO): põe o preço do trabalho a mais — mão de obra e material, € SEM IVA — e o extra fica
   * à espera do cliente. Devolve { extra, total (cêntimos com IVA) } para o email ao cliente (api.js).
   */
  function enviarExtra(o, idTexto, v, u, ip) {
    expirar();
    const x = extraDoPedido(o, idTexto);
    const mao = numero(v.mao_obra, 'a mão de obra do trabalho a mais', { min: 0, max: 100_000, nulo: false });
    const mat = numero(v.material, 'o material do trabalho a mais', { min: 0, max: 100_000, nulo: false });
    const maoCent = Math.round(mao * 100), matCent = Math.round(mat * 100);
    if (maoCent + matCent <= 0) falha('Indique o preço do trabalho a mais: a mão de obra, o material, ou os dois.');
    if (x.estado !== 'proposto') throw new ErroApi(409, x.estado === 'enviado' ? 'Este trabalho a mais já foi enviado ao cliente.' : 'Este trabalho a mais já não está à espera de preço.');
    if (!extraVivo(x)) throw new ErroApi(409, 'A obra já não está com o eletricista que propôs este trabalho a mais: não avance com ele.');
    const agora = agoraIso();
    const r = db.prepare("UPDATE trabalhos_extra SET estado = 'enviado', mao_obra_cent = ?, material_cent = ?, enviado_em = ?, atualizado = ? WHERE id = ? AND estado = 'proposto'").run(maoCent, matCent, agora, agora, x.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho a mais já não está à espera de preço.');
    auditar(u, 'trabalho_extra_enviado', `orcamento:${o.id}`, { extra: x.id, trabalho: x.trabalho_id, mao_obra: mao, material: mat }, ip);
    return { extra: db.prepare('SELECT * FROM trabalhos_extra WHERE id = ?').get(x.id), total: comIva(maoCent + matCent, pagamentos().ivaDoPedido(o)) };
  }

  /** "Não avançar" (só o CEO), com o motivo: o extra por rever, ou já enviado ao cliente e ainda sem resposta, fica `retirado`. */
  function naoAvancarExtra(o, idTexto, motivo, u, ip) {
    const x = extraDoPedido(o, idTexto);
    const porque = texto(motivo, 'o motivo', { max: 500, min: 3, multilinha: true, obrigatorio: true });
    const agora = agoraIso();
    const r = db.prepare("UPDATE trabalhos_extra SET estado = 'retirado', nota = ?, atualizado = ? WHERE id = ? AND estado IN ('proposto', 'enviado')").run(porque, agora, x.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho a mais já teve resposta.');
    auditar(u, 'trabalho_extra_nao_avancou', `orcamento:${o.id}`, { extra: x.id, trabalho: x.trabalho_id, estava: x.estado }, ip);
  }

  /** O que a conta do cliente vê: só os extras enviados (por responder), aceites ou não aceites, com o valor sem IVA e o total com IVA. */
  function extrasParaCliente(o) {
    const iva = pagamentos().ivaDoPedido(o);
    return db.prepare("SELECT * FROM trabalhos_extra WHERE orcamento_id = ? AND estado IN ('enviado', 'aceite', 'recusado') ORDER BY id").all(o.id).map((x) => {
      const cent = (x.mao_obra_cent ?? 0) + (x.material_cent ?? 0);
      return { id: x.id, descricao: x.descricao, valor: deCent(cent), valor_iva: deCent(comIva(cent, iva)), estado: x.estado, quando: x.respondido_em ?? x.enviado_em ?? x.atualizado };
    });
  }

  /**
   * "Aceito" / "Não aceito" do cliente (conta.js; só o dono do pedido, só num extra enviado). Aceite: soma ao restante e
   * o eletricista pode fazer esse trabalho. Não aceite: nada muda no dinheiro e o eletricista não o faz; o que o cliente
   * escreveu fica na `nota` (só para a Domus Energia). O eletricista é avisado por email.
   */
  function responderExtra(o, idTexto, aceita, textoCliente, c, ip) {
    expirar();
    const x = extraDoPedido(o, idTexto);
    const nota = aceita ? null : texto(textoCliente, 'o motivo', { max: 500, multilinha: true });
    if (x.estado !== 'enviado') throw new ErroApi(409, 'Este trabalho a mais já não está à espera da sua resposta.');
    const agora = agoraIso();
    // A obra já não está com quem o propôs (ou já foi dada por concluída): já não se aceita.
    if (aceita && !extraVivo(x)) throw new ErroApi(409, 'Este trabalho a mais já não está disponível. Fale connosco.');
    const r = db.prepare("UPDATE trabalhos_extra SET estado = ?, nota = ?, respondido_em = ?, atualizado = ? WHERE id = ? AND orcamento_id = ? AND estado = 'enviado'").run(aceita ? 'aceite' : 'recusado', nota, agora, agora, x.id, o.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho a mais já não está à espera da sua resposta.');
    const cent = (x.mao_obra_cent ?? 0) + (x.material_cent ?? 0);
    auditar({ id: null, email: `conta:${c.id}` }, aceita ? 'trabalho_extra_aceite_cliente' : 'trabalho_extra_recusado_cliente', `orcamento:${o.id}`, { extra: x.id, trabalho: x.trabalho_id, valor: deCent(cent), via: 'online' }, ip);
    const t = trabalho(x.trabalho_id);
    const e = x.eletricista_id ? linha(x.eletricista_id) : null;
    if (e && !e.anonimizado && t && t.eletricista_id === e.id) {
      correio.enviar({ para: e.email, assunto: aceita ? 'Domus Energia: o cliente aceitou o trabalho a mais' : 'Domus Energia: o cliente não aceitou o trabalho a mais',
        resumo: `trabalho ${t.id}: trabalho a mais ${x.id} ${aceita ? 'aceite' : 'não aceite'} pelo cliente`,
        texto: [`Olá ${e.nome},`, '', aceita ? `O cliente aceitou o trabalho a mais do pedido n.º ${o.id} (obra em ${t.concelho}): pode avançar.`
          : `O cliente não aceitou o trabalho a mais do pedido n.º ${o.id} (obra em ${t.concelho}): não faça esse trabalho.`,
          'Está na ficha do trabalho, na área do eletricista.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
  }
  /** Quantos extras estão à espera do CEO (Início do painel: "trabalho a mais por rever"). */
  const extrasPorRever = () => db.prepare("SELECT COUNT(*) AS n FROM trabalhos_extra WHERE estado = 'proposto'").get().n;

  // ------------------------------------------------------------ ida perdida (decisão do dono, 2026-10-11; migração 50)
  // O cliente pode mudar a visita sem custo até 24 horas antes. Se o eletricista for à hora marcada e não puder entrar por
  // motivo do cliente, sem aviso com 24 horas, o cliente paga a deslocação dessa ida — o valor do concelho, uma ida e
  // volta, como a visita e a proposta o calculam —, que soma ao restante (pagamentos-pedido.js valores); o eletricista
  // recebe essa deslocação a mais; marca-se nova visita. O ELETRICISTA ASSINALA, O CEO CONFIRMA (ou anula, com o motivo).
  const IDA_PERDIDA_MINIMO = 25;   // € com IVA
  const idaPendente = (trabalhoId) => Boolean(db.prepare("SELECT 1 FROM idas_perdidas WHERE trabalho_id = ? AND estado = 'proposta' LIMIT 1").get(trabalhoId));
  /** As deslocações (cêntimos sem IVA) das idas perdidas confirmadas deste trabalho, de quem o tem agora: vão inteiras para ele. */
  const idasDoTrabalho = (t) => (t?.eletricista_id
    ? db.prepare("SELECT COALESCE(SUM(COALESCE(deslocacao_cent, 0)), 0) AS s FROM idas_perdidas WHERE trabalho_id = ? AND eletricista_id = ? AND estado = 'confirmada'").get(t.id, t.eletricista_id).s : 0);
  /**
   * A deslocação de uma ida a este pedido (cêntimos SEM IVA): a do concelho, uma ida e volta (`deslocacaoServidor`, a
   * mesma conta da visita e da proposta), com o IVA do pedido tirado. 0 fora da área servida (não há valor para cobrar).
   * Nunca menos do que o mínimo de uma ida perdida (decisão do dono, 2026-10-12: 25 € com IVA) — em Lisboa a deslocação
   * é 0 € e a falta do cliente ficava sem custo, com o eletricista a perder a viagem.
   */
  function deslocacaoDaIda(o) {
    const d = deslocacaoServidor(localidadeDe(o), lerCfg());
    return d === null ? 0 : partirIva(Math.round(Math.max(d, IDA_PERDIDA_MINIMO) * 100), pagamentos().ivaDoPedido(o)).base;
  }
  /** Porque é que não se pode assinalar agora uma ida perdida neste trabalho (texto para o 409), ou null se pode. */
  function recusaDaIda(t) {
    if (t.tipo !== 'obra') return 'A ida perdida só se assinala numa obra.';
    if (t.estado !== 'visita_marcada' || !t.visita) return 'Só com a visita marcada pode dizer que o cliente não estava.';
    if (visitaPorAcontecer(t)) return `A visita está marcada para ${dataTexto(t.visita)}: só depois dessa hora pode dizer que o cliente não estava.`;
    if (idaPendente(t.id)) return 'Já há uma ida perdida à espera da Domus Energia neste trabalho.';
    if (db.prepare('SELECT 1 FROM idas_perdidas WHERE trabalho_id = ? AND visita = ? LIMIT 1').get(t.id, t.visita)) return 'Esta visita já foi assinalada. Combine nova data com o cliente e marque a visita.';
    return null;
  }
  /** A ida ainda é de quem a assinalou, com o trabalho por concluir e a obra do pedido em curso? (Só assim o CEO a confirma.) */
  function idaViva(x, t, o) {
    return Boolean(t) && t.eletricista_id === x.eletricista_id && EDITAVEIS.includes(t.estado) && aberto(t, o);
  }
  /** O trabalho saiu do eletricista (largou, caducou ou foi retirado): a ida perdida à espera do CEO fica anulada. */
  function fecharIdas(t, agora) {
    db.prepare("UPDATE idas_perdidas SET estado = 'anulada', motivo = 'O trabalho saiu do eletricista.', decidido_em = ?, decidido_por = 'sistema' WHERE trabalho_id = ? AND estado = 'proposta'").run(agora, t.id);
  }
  /** As idas perdidas que este eletricista assinalou no trabalho: o estado, o motivo da anulação e o que recebe pelas confirmadas (€ sem IVA). */
  function idasParaEletricista(t) {
    return db.prepare('SELECT * FROM idas_perdidas WHERE trabalho_id = ? AND eletricista_id = ? ORDER BY id').all(t.id, t.eletricista_id).map((x) => ({
      id: x.id, visita: x.visita, nota: x.nota ?? null, estado: x.estado, quando: x.decidido_em ?? x.criado,
      motivo: x.estado === 'anulada' ? x.motivo ?? null : null,
      recebe: x.estado === 'confirmada' ? deCent(x.deslocacao_cent ?? 0) : null,
    }));
  }

  // POST trabalhos/:id/ida-perdida {nota?}: "O cliente não estava" — numa obra com a visita marcada, só depois da hora
  // dela (o relógio do servidor), uma à espera de cada vez. Fica à espera do CEO; enquanto espera nada muda no trabalho.
  h.idaPerdida = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['nota']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    expirar();
    const { t, o } = meuEditavel(e, params.id);
    const nota = texto(v.nota, 'o que aconteceu', { max: 300, multilinha: true });
    const recusa = recusaDaIda(t);
    if (recusa) throw new ErroApi(409, recusa);
    // Com o restante já pago online não há onde somar a deslocação (o restante paga-se uma vez): trata-se por fora.
    if (pagamentos().restantePago(o).quando) throw new ErroApi(409, 'O cliente já pagou o restante desta obra: fale com a Domus Energia.');
    const agora = agoraIso();
    const id = Number(db.prepare("INSERT INTO idas_perdidas (orcamento_id, trabalho_id, eletricista_id, visita, nota, estado, criado) VALUES (?, ?, ?, ?, ?, 'proposta', ?)")
      .run(o.id, t.id, e.id, t.visita, nota, agora).lastInsertRowid);
    auditar(quem(e), 'ida_perdida_assinalada', `orcamento:${o.id}`, { ida: id, trabalho: t.id, eletricista: e.id, data_visita: t.visita }, ip);
    avisarEmpresa('Domus Energia: um eletricista diz que o cliente não estava', [
      `O eletricista foi à visita do pedido n.º ${o.id} (${t.concelho}), marcada para ${dataTexto(t.visita)}, e diz que o cliente não estava.`,
      'Veja na ficha do pedido, em Orçamentos, no cartão "Visita perdida": confirme (a deslocação dessa ida soma ao que o cliente paga no fim) ou anule.']);
    responder(res, 200, fichaAtual(t));
  };

  /**
   * As idas perdidas de um pedido para o painel (cartão "Visita perdida"), todas: a visita que se perdeu, a nota do
   * eletricista, a deslocação SEM IVA e com IVA — a guardada, nas confirmadas; a de agora, nas que estão por decidir —
   * e o que o eletricista recebe (a deslocação inteira, sem IVA).
   */
  function idasDoPedido(o) {
    const iva = pagamentos().ivaDoPedido(o);
    return db.prepare('SELECT * FROM idas_perdidas WHERE orcamento_id = ? ORDER BY id').all(o.id).map((x) => {
      const e = x.eletricista_id ? linha(x.eletricista_id) : null;
      const cent = x.estado === 'confirmada' ? x.deslocacao_cent ?? 0 : deslocacaoDaIda(o);
      return {
        id: x.id, trabalho: x.trabalho_id, eletricista: e ? { id: e.id, nome: e.nome } : null, visita: x.visita, nota: x.nota ?? null,
        estado: x.estado, motivo: x.motivo ?? null, criado: x.criado, decidido_em: x.decidido_em ?? null, decidido_por: x.decidido_por ?? null,
        deslocacao: deCent(cent), deslocacao_iva: deCent(comIva(cent, iva)), recebe: deCent(cent),
        pode_decidir: x.estado === 'proposta',
      };
    });
  }
  /** A ida perdida `idTexto` deste pedido (404 se for de outro). */
  function idaDoPedido(o, idTexto) {
    const x = db.prepare('SELECT * FROM idas_perdidas WHERE id = ?').get(idNum(idTexto)) ?? null;
    if (!x || x.orcamento_id !== o.id) throw new ErroApi(404, 'Ida perdida não encontrada.');
    return x;
  }

  /**
   * "Confirmar: cobrar a deslocação" (só o CEO): a deslocação dessa ida fica guardada (SEM IVA) e passa a somar ao
   * restante do cliente e ao que o eletricista recebe. O trabalho volta a "por marcar visita": fica `aceite`, sem data,
   * com 48 h novas para marcar (o prazo de sempre conta a partir de agora) — a não ser que o eletricista já tenha
   * marcado outra data entretanto, que então fica. O cliente e o eletricista são avisados por email.
   */
  function confirmarIda(o, idTexto, u, ip) {
    expirar();
    const x = idaDoPedido(o, idTexto);
    if (x.estado !== 'proposta') throw new ErroApi(409, 'Esta ida perdida já foi decidida.');
    if (pagamentos().restantePago(o).quando) throw new ErroApi(409, 'O cliente já pagou o restante desta obra: já não há onde somar a deslocação. Anule o registo e trate por fora.');
    const t = trabalho(x.trabalho_id);
    if (!idaViva(x, t, o)) throw new ErroApi(409, 'A obra já não está em curso com o eletricista que assinalou esta ida: anule o registo.');
    const cent = deslocacaoDaIda(o);
    if (!(cent > 0)) throw new ErroApi(409, 'Este pedido está fora da área servida: não há deslocação a cobrar. Anule o registo.');
    const agora = relogio();
    const r = db.prepare("UPDATE idas_perdidas SET estado = 'confirmada', deslocacao_cent = ?, decidido_em = ?, decidido_por = ? WHERE id = ? AND estado = 'proposta'").run(cent, iso(agora), u.email, x.id);
    if (!r.changes) throw new ErroApi(409, 'Esta ida perdida já foi decidida.');
    // De volta a "por marcar visita", só se a data ainda é a que se perdeu.
    const voltou = db.prepare("UPDATE trabalhos_eletricista SET estado = 'aceite', visita = NULL, aceite_em = ?, atualizado = ? WHERE id = ? AND eletricista_id = ? AND estado = 'visita_marcada' AND visita = ?")
      .run(agora, iso(agora), t.id, x.eletricista_id, x.visita).changes > 0;
    if (voltou && o.obra_id) db.prepare('UPDATE obras SET por_agendar = 1, atualizado = ? WHERE id = ?').run(iso(agora), o.obra_id);
    const total = comIva(cent, pagamentos().ivaDoPedido(o));
    auditar(u, 'ida_perdida_confirmada', `orcamento:${o.id}`, { ida: x.id, trabalho: x.trabalho_id, eletricista: x.eletricista_id, data_visita: x.visita, deslocacao: deCent(cent), deslocacao_iva: deCent(total), nova_visita_por_marcar: voltou }, ip);
    const euro = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
    const email = emailCliente(o);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: não o encontrámos na visita', resumo: `pedido ${o.id}: ida perdida confirmada (${euro(total)} com IVA)`,
        texto: ['Olá,', '', `Não o encontrámos na visita de ${dataTexto(x.visita)} do seu pedido n.º ${o.id}.`,
          `Como combinado nos Termos e Condições, a deslocação dessa ida (${euro(total)} com IVA) soma ao que paga no fim da obra.`,
          'Vamos marcar nova visita consigo. Pode mudar a data sem custo até 24 horas antes.',
          'Se não concordar, responda a este email ou ligue-nos.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
    const e = x.eletricista_id ? linha(x.eletricista_id) : null;
    if (e && !e.anonimizado) {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: ida perdida confirmada', resumo: `trabalho ${t.id}: ida perdida ${x.id} confirmada`,
        texto: [`Olá ${e.nome},`, '', `Confirmámos a ida perdida de ${dataTexto(x.visita)} (obra em ${t.concelho}): recebe mais ${euro(cent)} (sem IVA) pela deslocação dessa ida.`,
          voltou ? `Combine nova data com o cliente e marque a visita na área do eletricista: tem ${PRAZO_VISITA_MS / 3600_000} h.` : 'A nova data da visita já está marcada.',
          ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
  }

  /** "Anular (o cliente tem razão)" (só o CEO), com o motivo: nada muda no dinheiro nem no trabalho; o eletricista vê o motivo. O cliente não é avisado. */
  function anularIda(o, idTexto, motivo, u, ip) {
    const x = idaDoPedido(o, idTexto);
    const porque = texto(motivo, 'o motivo', { max: 500, min: 3, multilinha: true, obrigatorio: true });
    const r = db.prepare("UPDATE idas_perdidas SET estado = 'anulada', motivo = ?, decidido_em = ?, decidido_por = ? WHERE id = ? AND estado = 'proposta'").run(porque, agoraIso(), u.email, x.id);
    if (!r.changes) throw new ErroApi(409, 'Esta ida perdida já foi decidida.');
    auditar(u, 'ida_perdida_anulada', `orcamento:${o.id}`, { ida: x.id, trabalho: x.trabalho_id, eletricista: x.eletricista_id, data_visita: x.visita }, ip);
  }
  /** Quantas idas perdidas estão à espera do CEO (Início do painel: "ida perdida por confirmar"). */
  const idasPorConfirmar = () => db.prepare("SELECT COUNT(*) AS n FROM idas_perdidas WHERE estado = 'proposta'").get().n;

  // ------------------------------------------------------------ parar a obra por segurança (decisão do dono, 2026-10-11; api.js pararObra)
  const OBRA_PARADA = 'A obra foi parada por segurança.';
  /**
   * Antes de se mexer em dinheiro: a obra ainda se pode parar do lado do eletricista? Com o trabalho já dado por
   * concluído (à espera do cliente ou da aprovação) não; e só se regista um valor a pagar "pelo que fez" com a obra nas
   * mãos de um eletricista. Devolve o trabalho ativo do pedido (ou null).
   */
  function verificarParagem(o, valorCent) {
    expirar();
    const t = ativoDoPedido(o.id);
    if (t && ['concluida_eletricista', 'confirmada'].includes(t.estado)) throw new ErroApi(409, 'O eletricista já deu a obra por concluída: já não se para aqui. Se a obra não ficou feita, devolva-lhe primeiro o trabalho.');
    if (valorCent > 0 && !(t?.eletricista_id && t.tipo === 'obra' && EDITAVEIS.includes(t.estado))) throw new ErroApi(409, 'A obra deste pedido não está com um eletricista: não há a quem pagar o trabalho já feito.');
    return t;
  }
  /**
   * A obra foi parada por segurança (api.js, só o CEO): os trabalhos a mais à espera de resposta ficam retirados e as
   * idas perdidas por decidir anuladas; o trabalho do eletricista fecha de forma que ele receba SÓ o trabalho já feito —
   * com `valorCent` (€ sem IVA, indicado pelo CEO) acima de zero fica `aprovada` com esse valor fixado (`valor_detalhe`
   * com `obra_parada`), e segue o caminho de sempre em "Pagamentos a eletricistas" (fatura-recibo e "Pago"), sem esperar
   * pela confirmação do cliente nem pelo restante, que já não existem; com zero (ou sem eletricista) é retirado, como no
   * "Retirar". Devolve { trabalho, estado } ou null (o pedido não tinha trabalho ativo).
   */
  function aoPararObra(o, valorCent, u, ip) {
    const agora = agoraIso();
    db.prepare("UPDATE trabalhos_extra SET estado = 'retirado', nota = ?, atualizado = ? WHERE orcamento_id = ? AND estado IN ('proposto', 'enviado')").run(OBRA_PARADA, agora, o.id);
    db.prepare("UPDATE idas_perdidas SET estado = 'anulada', motivo = ?, decidido_em = ?, decidido_por = ? WHERE orcamento_id = ? AND estado = 'proposta'").run(OBRA_PARADA, agora, u.email, o.id);
    const t = ativoDoPedido(o.id);
    if (!t) return null;
    const e = t.eletricista_id ? linha(t.eletricista_id) : null;
    if (!(valorCent > 0) || !e) { retirar(o, u, ip); return { trabalho: t.id, estado: 'retirado' }; }
    const detalhe = { percentagem: pctDoTrabalho(t), mao_obra: 0, parte_mao_obra: 0, deslocacao: 0, total: deCent(valorCent), obra_parada: true };
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'aprovada', aprovada = ?, aprovada_por = ?, valor_cent = ?, valor_detalhe = ?, atualizado = ?
      WHERE id = ? AND estado IN ('aceite', 'visita_marcada')`).run(agora, u.email, valorCent, JSON.stringify(detalhe), agora, t.id);
    if (!r.changes) throw new ErroApi(409, 'O trabalho do eletricista mudou entretanto: veja a ficha do pedido e tente de novo.');
    evento(t, 'aprovada', e.id, u.email);
    auditar(u, 'trabalho_aprovado', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, tipo: t.tipo, valor: deCent(valorCent), obra_parada: true }, ip);
    if (!e.anonimizado) {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: a obra foi parada por segurança', resumo: `trabalho ${t.id}: obra parada por segurança, ${deCent(valorCent)} € pelo trabalho já feito`,
        texto: [`Olá ${e.nome},`, '', `A obra em ${t.concelho} foi parada por segurança e não avança.`,
          `Pelo trabalho que já fez recebe ${deCent(valorCent).toFixed(2).replace('.', ',')} € (sem IVA).`,
          'Envie a fatura-recibo na área do eletricista, em "Pagamentos": o valor está lá. Confirme também o seu IBAN.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
    return { trabalho: t.id, estado: 'aprovada' };
  }

  // ------------------------------------------------------------ pagamento ao eletricista (ronda 3)
  const pastaFatura = (trabalhoId) => join(config.eletricistasDir, 'faturas', String(trabalhoId));
  const ficheiroFatura = (t) => join(pastaFatura(t.id), `${t.fatura_id}.${EXTENSAO[t.fatura_tipo]}`);
  const detalheDe = (t) => { try { const v = JSON.parse(t.valor_detalhe ?? 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };

  /**
   * O pagamento de um trabalho ao eletricista: estado (estadoPagamento), o valor (o FIXADO ao aprovar; antes disso a
   * estimativa), o prazo (7 dias depois da última das três condições) e a fatura-recibo. `urlFatura`: de onde se
   * descarrega (área do eletricista ou painel).
   */
  function pagamentoDe(t, o, urlFatura) {
    const restante = t.tipo === 'obra' ? pagamentos().restantePago(o) : { pago: true, quando: null };
    const parada = detalheDe(t)?.obra_parada === true;
    const estado = estadoPagamento({
      largou: !t.eletricista_id || largouOuExpirou(t, { id: t.eletricista_id }), paga: t.estado === 'paga',
      // Obra parada por segurança (aoPararObra): o valor é o do trabalho já feito, fixado pelo CEO; já não há confirmação
      // do cliente nem restante por que esperar — falta só a fatura-recibo.
      confirmada: Boolean(t.confirmada) || parada, aprovada: Boolean(t.aprovada), restantePago: restante.pago || parada, fatura: Boolean(t.fatura_id),
    });
    return {
      pagamento: estado, pagamento_texto: TEXTO_PAGAMENTO[estado],
      valor: detalheDe(t) ?? comExtras(recebeDe(o, t.tipo, Number.isFinite(t.percentagem) ? t.percentagem : percentagemOmissao()), t), valor_fixado: t.valor_cent !== null && t.valor_cent !== undefined,
      prazo: parada ? prazoPagamento([t.aprovada]) : t.confirmada && t.aprovada && restante.pago ? prazoPagamento([t.confirmada, t.aprovada, restante.quando]) : null,
      pago_em: t.paga ?? null,
      fatura: t.fatura_id ? { tipo: t.fatura_tipo, bytes: t.fatura_bytes, quando: t.fatura_quando, url: urlFatura } : null,
      pode_fatura: t.estado === 'aprovada',
    };
  }

  /** A ida sem defeito de um trabalho (ou null): valor fixado na decisão do CEO, estado, prazo e a sua fatura-recibo. */
  function regressoDe(t, o, urlFatura) {
    if (t.regresso_cent === null || t.regresso_cent === undefined) return null;
    const visitaPaga = pagamentos().visitaExtraPaga(o, t.regresso_desde);
    const estado = estadoRegresso({
      largou: !t.eletricista_id || largouOuExpirou(t, { id: t.eletricista_id }), paga: Boolean(t.regresso_paga),
      visitaPaga: Boolean(visitaPaga), aprovada: Boolean(t.aprovada), fatura: Boolean(t.regresso_fatura_id),
    });
    let valor = null;
    try { valor = JSON.parse(t.regresso_detalhe ?? 'null'); } catch { valor = null; }
    return {
      pagamento: estado, pagamento_texto: TEXTO_PAGAMENTO[estado], valor, valor_fixado: true,
      prazo: visitaPaga && t.aprovada ? prazoPagamento([visitaPaga, t.aprovada]) : null, pago_em: t.regresso_paga ?? null, pago_por: t.regresso_paga_por ?? null,
      fatura: t.regresso_fatura_id ? { tipo: t.regresso_fatura_tipo, bytes: t.regresso_fatura_bytes, quando: t.regresso_fatura_quando, url: `${urlFatura}?parte=regresso` } : null,
      pode_fatura: ['aprovada', 'paga'].includes(t.estado) && !t.regresso_paga,
    };
  }
  /** As linhas de pagamento de um trabalho: a do trabalho e, havendo, a da ida sem defeito (`parte: 'regresso'`). */
  function linhasDe(t, o, base, urlFatura) {
    const linhas = [{ ...base, parte: 'trabalho', ...pagamentoDe(t, o, urlFatura) }];
    const r = regressoDe(t, o, urlFatura);
    if (r) linhas.push({ ...base, parte: 'regresso', titulo: 'Ida sem defeito (visita)', ...r });
    return linhas;
  }

  function pagamentosDoEletricista(e) {
    expirar();
    const lista = db.prepare(`SELECT * FROM trabalhos_eletricista WHERE eletricista_id = ? AND estado IN ${CONCLUIDOS} ORDER BY id DESC LIMIT 200`).all(e.id)
      .map((t) => [t, pedidoDe(t.orcamento_id)]).filter(([, o]) => o)
      .flatMap(([t, o]) => linhasDe(t, o, { id: t.id, concelho: t.concelho, tipo: t.tipo, titulo: titulo(o, t.tipo), concluida: t.concluida ?? null }, `/api/eletricista/trabalhos/${t.id}/fatura`));
    return { iban: pagamentos().ibanMascarado(linha(e.id)?.iban ?? null), prazo_dias: PRAZO_PAGAMENTO_MS / (24 * 3600_000), trabalhos: lista };
  }

  h.pagamentos = ({ res, e }) => responder(res, 200, pagamentosDoEletricista(e));

  // O IBAN para a transferência: português, validado (módulo 97); vazio apaga. Nunca vai para o registo nem para a auditoria.
  h.iban = async ({ req, res, e, ip }) => {
    const v = await lerJson(req, ['iban']);
    esperar([[L.acoes, String(e.id)]]);
    contar([[L.acoes, String(e.id)]]);
    const vazio = v.iban === null || v.iban === undefined || v.iban === '';
    const limpo = vazio ? null : pagamentos().ibanPt(v.iban);
    if (!vazio && !limpo) falha('O IBAN não parece certo: PT50 seguido de 21 algarismos.');
    db.prepare('UPDATE eletricistas SET iban = ?, atualizado = ? WHERE id = ?').run(limpo, agoraIso(), e.id);
    auditar(quem(e), 'eletricista_iban', `eletricista:${e.id}`, { definido: Boolean(limpo) }, ip);
    responder(res, 200, { iban: pagamentos().ibanMascarado(limpo) });
  };

  // A fatura-recibo do trabalho (PDF, JPG ou PNG até 5 MB, as regras do documento do seguro): depois de aprovado (o
  // valor fica fixado nessa altura) e até estar pago; enviar outra substitui a anterior.
  h.fatura = async ({ req, res, e, params, ip }) => {
    const v = await lerJson(req, ['tipo', 'dados', 'parte'], Math.ceil(SEGURO_MAX_BYTES / 3) * 4 + 64 * 1024);
    esperar([[L.ficha, String(e.id)]]);
    contar([[L.ficha, String(e.id)]]);
    const parte = opcao(v.parte ?? 'trabalho', 'parte', ['trabalho', 'regresso']);
    if (parte === 'regresso') return faturaRegresso(req, res, e, params, ip, v);
    const { t } = meu(e, params.id);
    if (t.estado !== 'aprovada') throw new ErroApi(409, t.estado === 'paga' ? 'Este trabalho já está pago.' : 'A fatura-recibo envia-se depois de o trabalho estar aprovado (é aí que o valor fica fixado).');
    const doc = documento({ tipo: v.tipo, dados: v.dados }, MSG_FATURA);
    const nova = { id: t.id, fatura_id: randomBytes(12).toString('hex'), fatura_tipo: doc.tipo };
    await escreverAtomico(ficheiroFatura(nova), doc.bytes);
    const agora = agoraIso();
    const r = db.prepare("UPDATE trabalhos_eletricista SET fatura_id = ?, fatura_tipo = ?, fatura_bytes = ?, fatura_quando = ?, atualizado = ? WHERE id = ? AND eletricista_id = ? AND estado = 'aprovada'")
      .run(nova.fatura_id, doc.tipo, doc.bytes.length, agora, agora, t.id, e.id);
    if (!r.changes) { await unlink(ficheiroFatura(nova)).catch(() => {}); throw new ErroApi(409, 'Este trabalho já não aceita a fatura-recibo.'); }
    if (t.fatura_id) await unlink(ficheiroFatura(t)).catch(() => {});
    auditar(quem(e), 'fatura_eletricista', `orcamento:${t.orcamento_id}`, { trabalho: t.id, documento: doc.tipo, substitui: Boolean(t.fatura_id) }, ip);
    if (!t.fatura_id) avisarEmpresa('Domus Energia: fatura-recibo de um eletricista', [`Chegou a fatura-recibo do trabalho do pedido n.º ${t.orcamento_id}.`, 'Veja em Pagamentos, em "Pagamentos a eletricistas".']);
    responder(res, 201, pagamentosDoEletricista(e));
  };

  // A fatura-recibo da ida sem defeito: as mesmas regras; depois de o trabalho estar aprovado e até essa ida estar paga.
  async function faturaRegresso(req, res, e, params, ip, v) {
    const { t } = meu(e, params.id);
    if (t.regresso_cent === null || t.regresso_cent === undefined) throw new ErroApi(409, 'Este trabalho não tem uma ida sem defeito a pagar.');
    if (t.regresso_paga) throw new ErroApi(409, 'Esta ida já está paga.');
    if (!['aprovada', 'paga'].includes(t.estado)) throw new ErroApi(409, 'A fatura-recibo envia-se depois de o trabalho estar aprovado.');
    const doc = documento({ tipo: v.tipo, dados: v.dados }, MSG_FATURA);
    const nova = { id: t.id, fatura_id: randomBytes(12).toString('hex'), fatura_tipo: doc.tipo };
    await escreverAtomico(ficheiroFatura(nova), doc.bytes);
    const agora = agoraIso();
    const r = db.prepare(`UPDATE trabalhos_eletricista SET regresso_fatura_id = ?, regresso_fatura_tipo = ?, regresso_fatura_bytes = ?, regresso_fatura_quando = ?, atualizado = ?
      WHERE id = ? AND eletricista_id = ? AND regresso_cent IS NOT NULL AND regresso_paga IS NULL`).run(nova.fatura_id, doc.tipo, doc.bytes.length, agora, agora, t.id, e.id);
    if (!r.changes) { await unlink(ficheiroFatura(nova)).catch(() => {}); throw new ErroApi(409, 'Esta ida já não aceita a fatura-recibo.'); }
    if (t.regresso_fatura_id) await unlink(ficheiroFatura({ id: t.id, fatura_id: t.regresso_fatura_id, fatura_tipo: t.regresso_fatura_tipo })).catch(() => {});
    auditar(quem(e), 'fatura_eletricista', `orcamento:${t.orcamento_id}`, { trabalho: t.id, parte: 'regresso', documento: doc.tipo, substitui: Boolean(t.regresso_fatura_id) }, ip);
    responder(res, 201, pagamentosDoEletricista(e));
  }

  async function lerFatura(t, parte = 'trabalho') {
    const regresso = parte === 'regresso';
    const f = t && (regresso ? { id: t.id, fatura_id: t.regresso_fatura_id, fatura_tipo: t.regresso_fatura_tipo } : t);
    if (!f?.fatura_id || !EXTENSAO[f.fatura_tipo]) throw new ErroApi(404, 'Fatura não encontrada.');
    let corpo;
    try { corpo = await readFile(ficheiroFatura(f)); } catch { throw new ErroApi(404, 'Fatura não encontrada.'); }
    return { id: t.id, tipo: f.fatura_tipo, extensao: EXTENSAO[f.fatura_tipo], corpo, regresso };
  }
  const parteFatura = (texto) => (texto === null || texto === undefined ? 'trabalho' : opcao(texto, 'parte', ['trabalho', 'regresso']));
  // A fatura só sai para o eletricista do trabalho (e para o CEO, no painel): nosniff, CSP sandbox, PDF como anexo.
  h.verFatura = async ({ res, e, params, url }) => {
    const d = await lerFatura(meu(e, params.id).t, parteFatura(url.searchParams.get('parte')));
    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': d.tipo, 'Content-Length': d.corpo.length,
      'Content-Disposition': `${d.tipo === 'application/pdf' ? 'attachment' : 'inline'}; filename="fatura-recibo-${d.regresso ? 'ida-' : ''}trabalho-${d.id}.${d.extensao}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(d.corpo);
  };

  // ------------------------------------------------------------ o cliente confirma (conta.js) e o CEO decide (painel)
  /**
   * O que a conta do cliente mostra do trabalho feito em casa dele — NUNCA quem o fez: por confirmar (com o prazo dos 7
   * dias), confirmado (com a avaliação que deu) ou contestado (o que disse que faltava). null sem nada para mostrar.
   */
  function paraCliente(o) {
    const t = db.prepare("SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado != 'retirado' ORDER BY id DESC LIMIT 1").get(o.id);
    if (!t) return null;
    const tipo = NOME_TIPO_TRABALHO[t.tipo];
    if (t.estado === 'concluida_eletricista') return { estado: 'por_confirmar', tipo, concluida: t.concluida, prazo: iso(Date.parse(t.concluida) + PRAZO_CONFIRMAR_MS) };
    if (t.confirmada) {
      return { estado: 'confirmada', tipo, quando: t.confirmada, automatica: Boolean(t.confirmada_auto), sem_defeito: t.reclamacao_decisao === 'sem_defeito',
        estrelas: t.estrelas ?? null, comentario: t.comentario ?? null, site: Boolean(t.comentario_site) };
    }
    if (t.reclamacao_de === 'cliente' && ['na_bolsa', ...EDITAVEIS].includes(t.estado)) {
      return { estado: 'contestada', tipo, quando: t.reclamacao_quando, descricao: t.reclamacao ?? null, decisao: t.reclamacao_decisao ?? null };
    }
    return null;
  }

  /**
   * "O trabalho ficou concluído?" (conta do cliente): Sim — 1 a 5 estrelas (obrigatórias), comentário e "podem usar o
   * meu comentário no site" opcionais — ou Não, com o que falta (obrigatório): o trabalho volta ao eletricista com esse
   * texto e o CEO decide (defeito / sem defeito). Só com um trabalho à espera de confirmação.
   */
  function confirmarCliente(o, v, c, ip) {
    expirar();
    const t = db.prepare("SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado = 'concluida_eletricista' ORDER BY id DESC LIMIT 1").get(o.id);
    if (!t) throw new ErroApi(409, 'Não há nenhum trabalho à espera da sua confirmação.');
    const cliente = { id: null, email: `conta:${c.id}` };
    const agora = agoraIso();
    const e = t.eletricista_id ? linha(t.eletricista_id) : null;
    if (v.concluido === true) {
      const estrelas = v.estrelas;
      if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) falha('Escolha a avaliação: de 1 a 5 estrelas.');
      const comentario = texto(v.comentario, 'o comentário', { max: 1000, multilinha: true });
      if (v.site !== undefined && typeof v.site !== 'boolean') falha('Pode usar no site: tem de ser true ou false.');
      const site = Boolean(v.site) && Boolean(comentario);
      const r = db.prepare("UPDATE trabalhos_eletricista SET estado = 'confirmada', confirmada = ?, confirmada_auto = 0, estrelas = ?, comentario = ?, comentario_site = ?, atualizado = ? WHERE id = ? AND estado = 'concluida_eletricista'")
        .run(agora, estrelas, comentario, site ? 1 : 0, agora, t.id);
      if (!r.changes) throw new ErroApi(409, 'Não há nenhum trabalho à espera da sua confirmação.');
      evento(t, 'confirmada', t.eletricista_id, 'cliente');
      auditar(cliente, 'trabalho_confirmado_cliente', `orcamento:${o.id}`, { trabalho: t.id, estrelas, comentario: Boolean(comentario), site }, ip);
      avisarEmpresa('Domus Energia: o cliente confirmou um trabalho', [
        `O cliente do pedido n.º ${o.id} confirmou que o trabalho ficou concluído (${estrelas} em 5 estrelas).`, 'Falta a sua aprovação, na ficha do pedido.']);
      return;
    }
    if (v.concluido !== false) falha('Diga se o trabalho ficou concluído.');
    const descricao = texto(v.descricao, 'o que ficou por fazer', { max: 1000, min: 5, multilinha: true, obrigatorio: true });
    // Uma decisão "sem defeito" anterior deixa de valer: a visita ainda por pagar sai, e a ida do eletricista com ela
    // (se o cliente já a pagou, a ida fica).
    if (t.regresso_cent !== null && t.regresso_cent !== undefined && !pagamentos().visitaExtraPaga(o, t.regresso_desde) && !t.regresso_paga) {
      db.prepare('UPDATE trabalhos_eletricista SET regresso_desde = NULL, regresso_cent = NULL, regresso_detalhe = NULL, regresso_fatura_id = NULL, regresso_fatura_tipo = NULL, regresso_fatura_bytes = NULL, regresso_fatura_quando = NULL WHERE id = ?').run(t.id);
      if (t.regresso_fatura_id) unlink(ficheiroFatura({ id: t.id, fatura_id: t.regresso_fatura_id, fatura_tipo: t.regresso_fatura_tipo })).catch(() => {});
    }
    const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'visita_marcada', concluida = NULL, reclamacao = ?, reclamacao_de = 'cliente', reclamacao_quando = ?,
      reclamacao_decisao = NULL, reclamacao_decidida = NULL, atualizado = ? WHERE id = ? AND estado = 'concluida_eletricista'`).run(descricao, agora, agora, t.id);
    if (!r.changes) throw new ErroApi(409, 'Não há nenhum trabalho à espera da sua confirmação.');
    evento(t, 'contestada', t.eletricista_id, 'cliente');
    auditar(cliente, 'trabalho_contestado_cliente', `orcamento:${o.id}`, { trabalho: t.id }, ip);
    avisarEmpresa('Domus Energia: o cliente diz que o trabalho não ficou concluído', [
      `O cliente do pedido n.º ${o.id} respondeu que o trabalho não ficou concluído. O trabalho voltou ao eletricista.`,
      'Veja o que o cliente escreveu na ficha do pedido e decida: defeito (o eletricista volta sem receber mais) ou sem defeito (o cliente paga uma visita).']);
    if (e) {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: um trabalho voltou para si', resumo: `trabalho ${t.id}: o cliente diz que não ficou concluído`,
        texto: [`Olá ${e.nome},`, '', `O cliente do trabalho em ${t.concelho} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}) respondeu que não ficou concluído.`,
          'Veja o que falta na ficha do trabalho, combine a ida com o cliente e volte a dar o trabalho por concluído.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    }
  }

  /**
   * A data em que o cliente confirmou a OBRA feita por um eletricista externo (o "Sim" na conta, os 7 dias sem resposta,
   * ou o "sem defeito" do CEO — tudo o que deixa o trabalho `confirmada`) e que o CEO ainda não aprovou; null sem isso.
   * Com as propostas na bolsa, o restante paga-se a partir daqui (decisão do dono, 2026-10-11; pagamentos-pedido.js
   * restanteDisponivel). Com um "Não" o trabalho volta a `visita_marcada`: não há pagamento.
   */
  /**
   * A obra deste pedido está com um eletricista externo e o cliente ainda não a confirmou (na bolsa, em curso, ou dada
   * por concluída à espera do "Sim" do cliente)? Devolve { estado, nome } ou null. Enquanto assim for, o painel não a
   * marca como concluída à mão (decisão do dono, 2026-10-11): saltava a confirmação e as estrelas do cliente, e
   * pedia-lhe o restante por um trabalho que ele ainda não viu. O caminho certo é o eletricista concluir e o cliente
   * confirmar (ou os 7 dias sem resposta); para tirar o trabalho ao eletricista, "Retirar" na ficha do pedido.
   */
  const obraPorConfirmar = (o) => db.prepare(`SELECT t.estado, e.nome FROM trabalhos_eletricista t LEFT JOIN eletricistas e ON e.id = t.eletricista_id
    WHERE t.orcamento_id = ? AND t.tipo = 'obra' AND t.estado IN ('na_bolsa', 'aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada') ORDER BY t.id DESC LIMIT 1`).get(o.id) ?? null;
  const clienteConfirmou = (o) => (config.propostasBolsa
    ? db.prepare("SELECT confirmada FROM trabalhos_eletricista WHERE orcamento_id = ? AND tipo = 'obra' AND estado = 'confirmada' ORDER BY id DESC LIMIT 1").get(o.id)?.confirmada ?? null : null);

  /** A data em que o CEO decidiu "sem defeito: cobrar visita ao cliente" neste pedido (pagamentos-pedido.js: visitaExtra), ou null. */
  const visitaSemDefeito = (o) => db.prepare("SELECT reclamacao_decidida FROM trabalhos_eletricista WHERE orcamento_id = ? AND reclamacao_decisao = 'sem_defeito' ORDER BY id DESC LIMIT 1").get(o.id)?.reclamacao_decidida ?? null;

  /**
   * As decisões do CEO sobre um trabalho dado por concluído (ficha do pedido):
   * - `aprovar` (só depois de o cliente confirmar, ou dos 7 dias): numa obra, marca a obra concluída no painel (a ação
   *   de sempre: sai o material do stock e o cliente passa a poder pagar o restante); o valor a pagar ao eletricista
   *   fica FIXADO (percentagem × mão de obra sem IVA + deslocação sem IVA);
   * - `devolver` (com o motivo): o trabalho volta ao eletricista e o cliente volta a confirmar no fim;
   * - `defeito` / `sem_defeito`: a decisão sobre o "Não" do cliente (decisão 8) — com defeito o eletricista volta sem
   *   receber mais; sem defeito o trabalho fica aceite e o cliente paga uma visita (o valor da visita técnica).
   */
  function decidir(o, acao, motivo, u, ip) {
    expirar();
    const t = ativoDoPedido(o.id);
    const e = t?.eletricista_id ? linha(t.eletricista_id) : null;
    if (!t || !e) throw new ErroApi(409, 'Este pedido não tem um trabalho com um eletricista.');
    const agora = agoraIso();
    const nomeTrabalho = `${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()} em ${t.concelho}`;
    if (acao === 'aprovar') {
      if (t.estado !== 'confirmada') throw new ErroApi(409, t.estado === 'concluida_eletricista' ? 'O cliente ainda não confirmou o trabalho (fica aceite ao fim de 7 dias sem resposta).' : 'Só se aprova um trabalho dado por concluído e confirmado pelo cliente.');
      // Com trabalho a mais aceite pelo cliente (migração 47): a percentagem dele × essa mão de obra soma ao valor (`extras`, `parte_extras`).
      // Com idas perdidas confirmadas (migração 50): a deslocação de cada uma soma inteira (`idas_perdidas`).
      const valor = comExtras(recebeDe(o, t.tipo, Number.isFinite(t.percentagem) ? t.percentagem : percentagemDe(e)), t);
      if (!valor) throw new ErroApi(409, 'Não foi possível calcular o valor a pagar ao eletricista: preencha a proposta em três partes (mão de obra, material e deslocação).');
      if (t.tipo === 'obra' && !o.obra_concluida) concluirObra(o, u, ip);
      const r = db.prepare("UPDATE trabalhos_eletricista SET estado = 'aprovada', aprovada = ?, aprovada_por = ?, valor_cent = ?, valor_detalhe = ?, atualizado = ? WHERE id = ? AND estado = 'confirmada'")
        .run(agora, u.email, Math.round(valor.total * 100), JSON.stringify({ ...valor, provisoria: undefined }), agora, t.id);
      if (!r.changes) throw new ErroApi(409, 'Este trabalho já foi aprovado.');
      evento(t, 'aprovada', e.id, u.email);
      auditar(u, 'trabalho_aprovado', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, tipo: t.tipo, valor: valor.total, percentagem: valor.percentagem, ...(valor.parte_extras ? { trabalho_a_mais: valor.parte_extras } : {}), ...(valor.idas_perdidas ? { idas_perdidas: valor.idas_perdidas } : {}) }, ip);
      correio.enviar({ para: e.email, assunto: 'Domus Energia: trabalho aprovado', resumo: `trabalho ${t.id} aprovado`,
        texto: [`Olá ${e.nome},`, '', `O trabalho (${nomeTrabalho}) foi aprovado.`,
          'Envie a fatura-recibo na área do eletricista, em "Pagamentos": o valor está lá. Confirme também o seu IBAN.',
          `Pagamos por transferência até ${PRAZO_PAGAMENTO_MS / (24 * 3600_000)} dias depois de o trabalho estar confirmado pelo cliente, aprovado e (nas obras) com o restante pago pelo cliente.`,
          ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
      return;
    }
    if (acao === 'devolver') {
      if (!['concluida_eletricista', 'confirmada'].includes(t.estado)) throw new ErroApi(409, 'Só se devolve um trabalho dado por concluído e ainda não aprovado.');
      const porque = texto(motivo, 'o motivo da devolução', { max: 1000, min: 5, multilinha: true, obrigatorio: true });
      const r = db.prepare(`UPDATE trabalhos_eletricista SET estado = 'visita_marcada', concluida = NULL, confirmada = NULL, confirmada_auto = NULL, estrelas = NULL, comentario = NULL, comentario_site = NULL,
        reclamacao = ?, reclamacao_de = 'ceo', reclamacao_quando = ?, atualizado = ? WHERE id = ? AND estado IN ('concluida_eletricista', 'confirmada')`).run(porque, agora, agora, t.id);
      if (!r.changes) throw new ErroApi(409, 'Só se devolve um trabalho dado por concluído e ainda não aprovado.');
      evento(t, 'devolvida', e.id, u.email);
      auditar(u, 'trabalho_devolvido', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, estava: t.estado }, ip);
      correio.enviar({ para: e.email, assunto: 'Domus Energia: um trabalho voltou para si', resumo: `trabalho ${t.id} devolvido ao eletricista ${e.id}`,
        texto: [`Olá ${e.nome},`, '', `A Domus Energia devolveu-lhe o trabalho (${nomeTrabalho}): ainda falta alguma coisa.`,
          'Veja o motivo na ficha do trabalho e volte a dar o trabalho por concluído quando estiver feito.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
      return;
    }
    // defeito / sem_defeito: a reclamação do cliente ainda por decidir, com o trabalho nas mãos do eletricista
    if (t.reclamacao_de !== 'cliente' || t.reclamacao_decisao || !['visita_marcada', 'concluida_eletricista'].includes(t.estado)) {
      throw new ErroApi(409, 'Não há nenhuma reclamação do cliente por decidir neste trabalho.');
    }
    if (acao === 'defeito') {
      db.prepare("UPDATE trabalhos_eletricista SET reclamacao_decisao = 'defeito', reclamacao_decidida = ?, atualizado = ? WHERE id = ?").run(agora, agora, t.id);
      auditar(u, 'reclamacao_defeito', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id }, ip);
      correio.enviar({ para: e.email, assunto: 'Domus Energia: trabalho por corrigir', resumo: `trabalho ${t.id}: defeito, o eletricista volta sem receber mais`,
        texto: [`Olá ${e.nome},`, '', `No trabalho (${nomeTrabalho}) ficou confirmado que falta corrigir o que o cliente indicou.`,
          'A ida para corrigir faz parte do trabalho: não é paga à parte.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
      return;
    }
    // A ida do eletricista (decisão do dono): percentagem × a meia hora sem IVA + deslocação sem IVA, como uma visita
    // técnica; fixada agora, paga quando o cliente pagar esta visita e o CEO aprovar o trabalho.
    const ida = estimativa(o, 'visita', Number.isFinite(t.percentagem) ? t.percentagem : percentagemDe(e));
    db.prepare(`UPDATE trabalhos_eletricista SET estado = 'confirmada', concluida = COALESCE(concluida, ?), confirmada = ?, confirmada_auto = 1,
      reclamacao_decisao = 'sem_defeito', reclamacao_decidida = ?, regresso_desde = ?, regresso_cent = ?, regresso_detalhe = ?, atualizado = ? WHERE id = ?`)
      .run(agora, agora, agora, agora, ida ? Math.round(ida.total * 100) : null, ida ? JSON.stringify({ ...ida, provisoria: undefined }) : null, agora, t.id);
    evento(t, 'confirmada', e.id, u.email);
    auditar(u, 'reclamacao_sem_defeito', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, ida: ida?.total ?? null }, ip);
    const email = emailCliente(o);
    if (email) {
      correio.enviar({ para: email, assunto: 'Domus Energia: o trabalho em sua casa', resumo: `pedido ${o.id}: sem defeito, visita a cobrar ao cliente`,
        texto: ['Olá,', '', `Voltámos a ver o trabalho do seu pedido n.º ${o.id} e não encontrámos defeito: o trabalho fica dado como concluído.`,
          'Como combinado nos Termos e Condições, a visita em que não se encontra defeito é paga. Pode pagá-la na sua conta.',
          'Se não concordar, responda a este email ou ligue-nos.', ...ligacaoConta(), '', 'Domus Energia'].join('\n') });
    }
  }

  /** "Pagamentos a eletricistas" (painel, só CEO): cada trabalho concluído com o valor, o prazo, a fatura e o IBAN inteiro. */
  function pagamentosPainel() {
    expirar();
    const trabalhos = db.prepare(`SELECT * FROM trabalhos_eletricista WHERE eletricista_id IS NOT NULL AND estado IN ${CONCLUIDOS} ORDER BY id DESC LIMIT 500`).all()
      .map((t) => [t, pedidoDe(t.orcamento_id), linha(t.eletricista_id)]).filter(([, o, e]) => o && e)
      .flatMap(([t, o, e]) => linhasDe(t, o, {
        id: t.id, orcamento_id: t.orcamento_id, tipo: t.tipo, tipo_nome: NOME_TIPO_TRABALHO[t.tipo], concelho: t.concelho,
        eletricista: { id: e.id, nome: e.nome, nif: e.nif || null }, iban: e.iban ?? null,
        concluida: t.concluida ?? null, confirmada: t.confirmada ?? null, confirmada_auto: Boolean(t.confirmada_auto), aprovada: t.aprovada ?? null, pago_por: t.paga_por ?? null,
      }, `/painel/api/trabalhos-eletricista/${t.id}/fatura`));
    return { trabalhos, ...totais(), prazo_dias: PRAZO_PAGAMENTO_MS / (24 * 3600_000) };
  }

  /** O que se deve (aprovado e por pagar) e o que já se pagou aos eletricistas, em € sem IVA; `mes` (AAAA-MM) filtra pela data. */
  function resumoPagamentos(mes = null) {
    const doMes = (d) => !mes || String(d ?? '').startsWith(mes);
    const todos = db.prepare("SELECT * FROM trabalhos_eletricista WHERE estado IN ('aprovada', 'paga') AND valor_cent IS NOT NULL ORDER BY id").all();
    // Cada trabalho aprovado é uma linha; a ida sem defeito (havendo) é outra, com o seu valor e o seu "Pago".
    const linhas = todos.flatMap((t) => [
      { t, ref: `eletricista-${t.id}`, cent: t.valor_cent, paga: t.estado === 'paga' ? t.paga : null,
        descricao: `Eletricista externo: ${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()} (trabalho n.º ${t.id})` },
      ...(t.regresso_cent !== null && t.regresso_cent !== undefined ? [{ t, ref: `eletricista-${t.id}-ida`, cent: t.regresso_cent, paga: t.regresso_paga ?? null,
        descricao: `Eletricista externo: ida sem defeito (trabalho n.º ${t.id})` }] : []),
    ]);
    const pagos = linhas.filter((l) => l.paga && doMes(l.paga));
    const devidos = linhas.filter((l) => !l.paga && doMes(l.t.aprovada));
    const total = (l) => ({ trabalhos: l.length, total: deCent(l.reduce((s, x) => s + x.cent, 0)) });
    const linhaDe = (l, estado) => ({ data: l.paga ?? l.t.aprovada, ref: l.ref, orcamento_id: l.t.orcamento_id, estado, descricao: l.descricao, valor: deCent(l.cent) });
    return { linhas: [...pagos.map((l) => linhaDe(l, 'eletricista_pago')), ...devidos.map((l) => linhaDe(l, 'eletricista_a_pagar'))], a_pagar: total(devidos), pago: total(pagos) };
  }
  const totais = () => { const r = resumoPagamentos(); return { a_pagar: r.a_pagar, pago: r.pago }; };

  /**
   * "Pago": o CEO fez a transferência. Só com as três condições e a fatura-recibo; nunca a quem largou o trabalho.
   * `parte: 'regresso'`: a ida sem defeito (visita paga pelo cliente, trabalho aprovado e a fatura dessa ida).
   */
  function marcarPago(idTexto, u, ip, parteTexto) {
    expirar();
    const parte = parteFatura(parteTexto);
    const t = trabalho(idNum(idTexto));
    const o = t ? pedidoDe(t.orcamento_id) : null;
    const e = t?.eletricista_id ? linha(t.eletricista_id) : null;
    if (!t || !o || !e) throw new ErroApi(404, 'Trabalho não encontrado.');
    if (parte === 'regresso') {
      const r = regressoDe(t, o, null);
      if (!r) throw new ErroApi(409, 'Este trabalho não tem uma ida sem defeito a pagar.');
      if (r.pagamento === 'pago') throw new ErroApi(409, 'Esta ida já está paga.');
      if (r.pagamento === 'sem_pagamento') throw new ErroApi(409, 'Este eletricista largou o trabalho ou deixou-o caducar: não recebe por ele.');
      if (r.pagamento !== 'a_pagar') throw new ErroApi(409, `Ainda não se pode pagar esta ida: ${TEXTO_PAGAMENTO[r.pagamento].toLowerCase()}.`);
      const agora = agoraIso();
      if (!db.prepare('UPDATE trabalhos_eletricista SET regresso_paga = ?, regresso_paga_por = ?, atualizado = ? WHERE id = ? AND regresso_paga IS NULL').run(agora, u.email, agora, t.id).changes) throw new ErroApi(409, 'Esta ida já está paga.');
      auditar(u, 'eletricista_pago', `orcamento:${o.id}`, { trabalho: t.id, parte: 'regresso', eletricista: e.id, valor: deCent(t.regresso_cent) }, ip);
      correio.enviar({ para: e.email, assunto: 'Domus Energia: pagamento feito', resumo: `ida sem defeito do trabalho ${t.id} paga ao eletricista ${e.id}`,
        texto: [`Olá ${e.nome},`, '', `Fizemos a transferência de ${deCent(t.regresso_cent).toFixed(2).replace('.', ',')} € da ida sem defeito do trabalho em ${t.concelho}.`,
          ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
      return trabalho(t.id);
    }
    const p = pagamentoDe(t, o, null);
    if (p.pagamento === 'pago') throw new ErroApi(409, 'Este trabalho já está pago.');
    if (p.pagamento === 'sem_pagamento') throw new ErroApi(409, 'Este eletricista largou o trabalho ou deixou-o caducar: não recebe por ele.');
    if (p.pagamento !== 'a_pagar') throw new ErroApi(409, `Ainda não se pode pagar este trabalho: ${TEXTO_PAGAMENTO[p.pagamento].toLowerCase()}.`);
    const agora = agoraIso();
    const r = db.prepare("UPDATE trabalhos_eletricista SET estado = 'paga', paga = ?, paga_por = ?, atualizado = ? WHERE id = ? AND estado = 'aprovada'").run(agora, u.email, agora, t.id);
    if (!r.changes) throw new ErroApi(409, 'Este trabalho já está pago.');
    evento(t, 'paga', e.id, u.email);
    auditar(u, 'eletricista_pago', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, valor: deCent(t.valor_cent) }, ip);
    correio.enviar({ para: e.email, assunto: 'Domus Energia: pagamento feito', resumo: `trabalho ${t.id} pago ao eletricista ${e.id}`,
      texto: [`Olá ${e.nome},`, '', `Fizemos a transferência de ${deCent(t.valor_cent).toFixed(2).replace('.', ',')} € do trabalho em ${t.concelho} (${NOME_TIPO_TRABALHO[t.tipo].toLowerCase()}).`,
        'Obrigado pelo trabalho.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
    return trabalho(t.id);
  }

  /** A fatura-recibo de um trabalho, para o painel (só CEO; a rota é verificada em api.js). */
  const faturaParaPainel = (idTexto, parte) => lerFatura(trabalho(idNum(idTexto)), parteFatura(parte));

  // ------------------------------------------------------------ painel (só CEO; rotas em api.js)
  function paraPainel(e) {
    return {
      id: e.id, nome: e.nome, email: e.email, telefone: e.telefone, nif: e.nif, dgeg: e.dgeg, concelhos: concelhosDe(e),
      experiencia: EXPERIENCIAS[e.experiencia] ?? null, notas: e.notas ?? null, estado: e.estado,
      percentagem: Number.isFinite(e.percentagem) ? e.percentagem : null, percentagem_efetiva: percentagemDe(e),
      // Ativação de aparelhos: de confiança = o chip que regista num trabalho vale logo, sem esperar pelo CEO.
      ativa_sem_aprovacao: Boolean(e.ativa_sem_aprovacao),
      seguro: e.seguro_id ? { tipo: e.seguro_tipo, bytes: e.seguro_bytes, url: `/painel/api/eletricistas/${e.id}/seguro` } : null,
      consentimento: e.consentimento, criado: e.criado, decidido: e.decidido ?? null, ultimo_acesso: e.ultimo_acesso ?? null,
      anonimizado: e.anonimizado ?? null,
      // O IBAN vai mascarado nas listas e na ficha; inteiro só em "Pagamentos a eletricistas", para a transferência.
      iban: pagamentos().ibanMascarado(e.iban ?? null),
      // Avaliação dos clientes (ronda 3): média e n.º de avaliações, e os comentários (os que podem ir para o site vão marcados).
      avaliacao: avaliacaoDe(e.id),
      comentarios: db.prepare('SELECT orcamento_id, estrelas, comentario, comentario_site, confirmada FROM trabalhos_eletricista WHERE eletricista_id = ? AND estrelas IS NOT NULL ORDER BY confirmada DESC LIMIT 50').all(e.id)
        .map((c) => ({ orcamento_id: c.orcamento_id, estrelas: c.estrelas, comentario: c.comentario ?? null, pode_site: Boolean(c.comentario_site) && Boolean(c.comentario), quando: c.confirmada })),
      // Trabalhos em curso (aceites, com visita marcada, concluídos à espera do cliente ou da aprovação, ou por pagar): o painel lista-os ao suspender.
      trabalhos: emCurso(e.id).map((t) => ({ id: t.id, orcamento_id: t.orcamento_id, tipo: t.tipo, tipo_nome: NOME_TIPO_TRABALHO[t.tipo], estado: t.estado, concelho: t.concelho, visita: t.visita ?? null })),
      trabalhos_em_curso: emCurso(e.id).length,
      trabalhos_largados: db.prepare("SELECT COUNT(*) AS n FROM trabalhos_eletricista_eventos WHERE eletricista_id = ? AND evento IN ('largou', 'expirou')").get(e.id).n,
    };
  }

  const emCurso = (id) => db.prepare(`SELECT * FROM trabalhos_eletricista WHERE eletricista_id = ? AND estado IN ${EM_CURSO} ORDER BY id`).all(id);
  function avaliacaoDe(id) {
    const r = db.prepare('SELECT COUNT(*) AS n, AVG(estrelas) AS media FROM trabalhos_eletricista WHERE eletricista_id = ? AND estrelas IS NOT NULL').get(id);
    return { n: r.n, media: r.n ? Math.round(r.media * 10) / 10 : null };
  }

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
    if (v.ativa_sem_aprovacao !== undefined) {
      if (typeof v.ativa_sem_aprovacao !== 'boolean') falha('"ativa_sem_aprovacao" tem de ser true ou false.');
      mud.ativa_sem_aprovacao = v.ativa_sem_aprovacao ? 1 : 0;
    }
    if (!Object.keys(mud).length) falha('Nada para alterar.');
    const cols = Object.keys(mud);
    db.prepare(`UPDATE eletricistas SET ${cols.map((k) => `${k} = ?, `).join('')}atualizado = ? WHERE id = ?`).run(...cols.map((k) => mud[k]), agoraIso(), e.id);
    // Quem deixa de estar aprovado sai logo (a sessão também o verifica em cada pedido).
    if (mud.estado && mud.estado !== 'aprovado') {
      db.prepare('DELETE FROM eletricistas_sessoes WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM eletricistas_codigos WHERE eletricista_id = ?').run(e.id);
    }
    auditar(u, acao ? `eletricista_${{ aprovar: 'aprovado', recusar: 'recusado', suspender: 'suspenso', reativar: 'reativado' }[acao]}` : 'eletricista_atualizado', `eletricista:${e.id}`,
      { ...(mud.concelhos ? { concelhos: JSON.parse(mud.concelhos).length } : {}), ...('percentagem' in mud ? { percentagem: mud.percentagem } : {}), ...('ativa_sem_aprovacao' in mud ? { ativa_sem_aprovacao: !!mud.ativa_sem_aprovacao } : {}) }, ip);
    if (acao === 'aprovar') {
      correio.enviar({ para: e.email, assunto: 'Domus Energia: candidatura aprovada', resumo: `eletricista ${e.id} aprovado`,
        texto: [`Olá ${e.nome},`, '', 'A sua candidatura foi aprovada: já pode entrar na área do eletricista.',
          'Entra com este email e um código de 6 algarismos que enviamos na altura (sem palavra-passe).',
          config.propostasBolsa ? 'Na bolsa vê os trabalhos dos seus concelhos. Nos pedidos com planta envia a sua proposta (horas, material e quando pode ir) e a Domus Energia escolhe. Nos outros, o primeiro a aceitar fica com o trabalho e tem 48 h para marcar a visita.'
            : 'Na bolsa vê os trabalhos dos seus concelhos; o primeiro a aceitar fica com o trabalho e tem 48 h para marcar a visita.', ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
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
   * a contabilidade e para a regra "quem larga não recebe") fica ANONIMIZADA: sem nome, email, telefone, NIF, IBAN, DGEG,
   * concelhos, experiência nem notas (as faturas-recibo dos trabalhos pagos ficam: são documentos de contabilidade).
   * Com trabalhos em curso ou por pagar recusa (o CEO retira-os ou paga-os primeiro).
   */
  async function apagar(idTexto, u, ip) {
    const e = obter(idTexto);
    if (e.anonimizado) throw new ErroApi(409, 'Este eletricista já foi apagado (RGPD).');
    const idaPorPagar = db.prepare("SELECT 1 FROM trabalhos_eletricista WHERE eletricista_id = ? AND regresso_cent IS NOT NULL AND regresso_paga IS NULL AND estado IN ('confirmada', 'aprovada', 'paga') LIMIT 1").get(e.id);
    if (emCurso(e.id).length || idaPorPagar) throw new ErroApi(409, 'Este eletricista tem trabalhos em curso ou por pagar: retire-os ou pague-os primeiro.');
    const historico = Boolean(db.prepare(`SELECT 1 FROM trabalhos_eletricista WHERE eletricista_id = ?1 UNION ALL SELECT 1 FROM trabalhos_eletricista_eventos WHERE eletricista_id = ?1
      UNION ALL SELECT 1 FROM trabalhos_eletricista_fotos WHERE eletricista_id = ?1 LIMIT 1`).get(e.id));
    const agora = agoraIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM eletricistas_sessoes WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM eletricistas_codigos WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM trabalhos_eletricista_avisos WHERE eletricista_id = ?').run(e.id);
      db.prepare('DELETE FROM propostas_bolsa WHERE eletricista_id = ?').run(e.id);   // as propostas da bolsa (notas e disponibilidade são texto dele)
      db.prepare('DELETE FROM auditoria WHERE alvo = ?').run(`eletricista:${e.id}`);
      db.prepare('UPDATE auditoria SET ip = NULL WHERE email = ?').run(`eletricista:${e.id}`);
      if (historico) {
        db.prepare(`UPDATE eletricistas SET email = ?, nome = 'Eletricista apagado (RGPD)', telefone = '', nif = '', dgeg = '', concelhos = '[]', experiencia = NULL, notas = NULL,
          estado = 'suspenso', percentagem = NULL, seguro_id = NULL, seguro_tipo = NULL, seguro_bytes = NULL, iban = NULL, ultimo_acesso = NULL, anonimizado = ?, atualizado = ? WHERE id = ?`)
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

  /** As fotos tiradas pelos eletricistas num pedido saem com ele (conta de cliente apagada, RGPD), e o que o cliente escreveu (comentário, reclamação) também. */
  async function apagarFotosDoPedido(orcamentoId) {
    // Trabalho a mais: o que o cliente escreveu ao não aceitar sai (o motivo da Domus Energia fica).
    db.prepare("UPDATE trabalhos_extra SET nota = NULL WHERE orcamento_id = ? AND estado = 'recusado'").run(orcamentoId);
    db.prepare("UPDATE trabalhos_eletricista SET comentario = NULL, comentario_site = NULL, reclamacao = CASE WHEN reclamacao_de = 'cliente' THEN NULL ELSE reclamacao END WHERE orcamento_id = ?").run(orcamentoId);
    for (const { id } of db.prepare('SELECT id FROM trabalhos_eletricista WHERE orcamento_id = ?').all(orcamentoId)) {
      db.prepare('DELETE FROM trabalhos_eletricista_fotos WHERE trabalho_id = ?').run(id);
      await rm(pastaFotos(id), { recursive: true, force: true });
    }
  }

  // ---- atribuição (ficha do pedido e da obra)
  const ativoDoPedido = (orcamentoId) => db.prepare(`SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado IN ${ATIVOS} ORDER BY id DESC LIMIT 1`).get(orcamentoId) ?? null;
  /** Um trabalho deste tipo já aprovado (ou pago) neste pedido: não se atribui outro igual (pagava-se duas vezes). */
  const feitoDoPedido = (orcamentoId, tipo = null) => db.prepare(`SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado IN ('aprovada', 'paga')${tipo ? ' AND tipo = ?' : ''} ORDER BY id DESC LIMIT 1`)
    .get(...(tipo ? [orcamentoId, tipo] : [orcamentoId])) ?? null;
  const aprovadosEm = (nomeConcelho) => db.prepare("SELECT * FROM eletricistas WHERE estado = 'aprovado' ORDER BY nome COLLATE NOCASE").all().filter((e) => concelhosDe(e).includes(nomeConcelho));

  /** O bloco "Eletricista externo" de um pedido, para o painel. */
  function atribuicao(o) {
    expirar();
    const tipo = tipoAtribuivel(o);
    const ativo = ativoDoPedido(o.id);
    const repetido = !ativo && tipo ? feitoDoPedido(o.id, tipo) : null;
    // Sem trabalho ativo, o painel mostra o último já aprovado ou pago (valor, fatura, estado do pagamento).
    const t = ativo ?? feitoDoPedido(o.id);
    const c = concelhoDe(localidadeDe(o))?.nome ?? null;
    const e = t?.eletricista_id ? linha(t.eletricista_id) : null;
    const alvo = ativo?.tipo ?? tipo ?? t?.tipo ?? null;
    const pode = Boolean(tipo) && !ativo && !repetido && Boolean(c);
    // Na bolsa, os candidatos são quem a vê agora (o mesmo filtro da área do eletricista: quem largou ou deixou caducar já não a vê).
    const naBolsa = ativo?.estado === 'na_bolsa';
    const candidatos = alvo && (ativo?.concelho ?? c) ? aprovadosEm(ativo?.concelho ?? c).filter((x) => !naBolsa || visivelNaBolsa(ativo, x, o)) : [];
    const doCliente = t && ['visita_marcada', 'concluida_eletricista'].includes(t.estado) && t.reclamacao_de === 'cliente' && !t.reclamacao_decisao;
    return {
      // Propostas na bolsa (decisão do dono, 2026-10-10): a tabela comparativa do pedido — fica também sem trabalho ativo
      // (as de reserva esperam que o CEO volte a pôr o pedido na bolsa) — e se já se pode escolher.
      ...(config.propostasBolsa ? { propostas_bolsa: true, propostas: propostasDoPedido(o, ativo), pode_escolher: naBolsa && porProposta(ativo) } : {}),
      pode, tipo: alvo, tipo_nome: alvo ? NOME_TIPO_TRABALHO[alvo] : null, concelho: ativo?.concelho ?? c ?? t?.concelho ?? null,
      motivo: t || pode ? null : !tipo ? 'Só se atribui um pedido ainda sem proposta aceite (numa avaria, com o diagnóstico pago; com a visita vendida à parte, com ela paga) ou um pedido aceite com a obra por fazer.'
        : 'A localidade do pedido não é um concelho reconhecido: corrija-a na ficha do pedido.',
      trabalho: t ? {
        // Ronda 3: confirmação e avaliação do cliente, reclamação, aprovação e pagamento; e o que o CEO pode fazer agora.
        ativo: Boolean(ativo), confirmada: t.confirmada ?? null, confirmada_auto: Boolean(t.confirmada_auto),
        prazo_confirmacao: t.estado === 'concluida_eletricista' && t.concluida ? iso(Date.parse(t.concluida) + PRAZO_CONFIRMAR_MS) : null,
        estrelas: t.estrelas ?? null, comentario: t.comentario ?? null, comentario_site: Boolean(t.comentario_site) && Boolean(t.comentario),
        reclamacao: t.reclamacao || t.reclamacao_decisao ? { texto: t.reclamacao ?? null, de: t.reclamacao_de ?? null, quando: t.reclamacao_quando ?? null, decisao: t.reclamacao_decisao ?? null, decidida: t.reclamacao_decidida ?? null } : null,
        aprovada: t.aprovada ?? null, aprovada_por: t.aprovada_por ?? null, pago_por: t.paga_por ?? null,
        pagamento: e && LISTA_CONCLUIDOS.includes(t.estado) ? pagamentoDe(t, o, `/painel/api/trabalhos-eletricista/${t.id}/fatura`) : null,
        visita_sem_defeito: t.reclamacao_decisao === 'sem_defeito' ? pagamentos().visitaExtra(o) : null,
        regresso: e ? regressoDe(t, o, `/painel/api/trabalhos-eletricista/${t.id}/fatura`) : null,
        pode_aprovar: t.estado === 'confirmada', pode_devolver: ['concluida_eletricista', 'confirmada'].includes(t.estado), pode_decidir: Boolean(doCliente),
        id: t.id, tipo: t.tipo, estado: t.estado, modo: t.modo, aberto: aberto(t, o), eletricista: e ? { id: e.id, nome: e.nome } : null,
        so_para: t.so_para ? { id: t.so_para, nome: linha(t.so_para)?.nome ?? null } : null,
        // A parte dele no trabalho a mais que o cliente já aceitou (€, sem IVA): soma à estimativa antes de aprovar.
        recebe_extras: e && t.tipo === 'obra' ? Math.round(maoObraExtras(t.id) * (Number.isFinite(t.percentagem) ? t.percentagem : percentagemDe(e)) / 100) / 100 : 0,
        // … e a deslocação das idas perdidas já confirmadas (€, sem IVA): também soma à estimativa antes de aprovar.
        recebe_idas: e && t.tipo === 'obra' ? deCent(idasDoTrabalho(t)) : 0,
        // Por proposta: escolhido pelo CEO; `espera_cliente` = o cliente ainda não aceitou (sem prazo, sem dados do cliente).
        ...(config.propostasBolsa ? { por_proposta: porProposta(t), espera_cliente: esperaCliente(t) } : {}),
        percentagem: t.percentagem ?? null, aceite: t.aceite_em ? iso(t.aceite_em) : null,
        prazo: t.estado === 'aceite' && t.aceite_em ? iso(t.aceite_em + PRAZO_VISITA_MS) : null, visita: t.visita ?? null,
        recebe: e ? recebeDoTrabalho(t, o, Number.isFinite(t.percentagem) ? t.percentagem : percentagemDe(e)) : null,
        // Ficha de obra do eletricista (ronda 2): estado, material recebido, fotos, ensaios e o que falta para concluir.
        concluida: t.concluida ?? null,
        material: materialDoTrabalho(t, o),
        fotos: fotosDe(t.id).map((f) => ({ ...fotoPublica(f, `/painel/api/trabalhos-eletricista/${t.id}/fotos/`), grupo_nome: NOME_GRUPO_FOTO[f.grupo] })),
        ensaios: ensaiosDoPedido(o),
        diagnostico: t.tipo === 'avaria' ? Boolean(diagnosticoDoPedido(o)?.conclusao) : null,
        falta: e && EDITAVEIS.includes(t.estado) && !(config.propostasBolsa && esperaCliente(t)) ? faltaParaConcluir(t, o) : [],
      } : null,
      candidatos: !pode && !naBolsa ? [] : candidatos.map((x) => ({ id: x.id, nome: x.nome, percentagem: percentagemDe(x), recebe: alvo ? recebeDe(o, alvo, percentagemDe(x))?.total ?? null : null })),
      historico: db.prepare(`SELECT v.evento, v.quando, v.por, e.nome FROM trabalhos_eletricista_eventos v JOIN trabalhos_eletricista t ON t.id = v.trabalho_id
        LEFT JOIN eletricistas e ON e.id = v.eletricista_id WHERE t.orcamento_id = ? ORDER BY v.id DESC LIMIT 50`).all(o.id)
        .map((x) => ({ evento: x.evento, quando: x.quando, eletricista: x.nome ?? null, por: x.por })),
    };
  }

  /** Cria o trabalho do pedido (um ativo por pedido): na bolsa, ou já atribuído (48 h para marcar a visita). */
  function novoTrabalho(o, modo, e, soPara = null) {
    expirar();
    const tipo = tipoAtribuivel(o);
    if (!tipo) throw new ErroApi(409, 'Só se atribui um pedido ainda sem proposta aceite (numa avaria, com o diagnóstico pago; com a visita vendida à parte, com ela paga) ou um pedido aceite com a obra por fazer.');
    if (ativoDoPedido(o.id)) throw new ErroApi(409, 'Este pedido já está na bolsa ou atribuído a um eletricista: retire-o primeiro.');
    if (feitoDoPedido(o.id, tipo)) throw new ErroApi(409, 'Este trabalho já foi feito e aprovado neste pedido.');
    const c = concelhoDe(localidadeDe(o))?.nome ?? null;
    if (!c) throw new ErroApi(409, 'A localidade do pedido não é um concelho reconhecido: corrija-a na ficha do pedido.');
    for (const x of [e, soPara]) if (x && (x.estado !== 'aprovado' || !concelhosDe(x).includes(c))) throw new ErroApi(409, `Só se atribui a um eletricista aprovado que trabalhe em ${c}.`);
    const agora = relogio();
    const id = Number(db.prepare(`INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, eletricista_id, percentagem, aceite_em, criado, atualizado, so_para)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.id, tipo, e ? 'aceite' : 'na_bolsa', modo, c, e?.id ?? null, e ? percentagemDe(e) : null, e ? agora : null, iso(agora), iso(agora), soPara?.id ?? null).lastInsertRowid);
    return trabalho(id);
  }

  function atribuir(o, idEletricista, u, ip) {
    if (!Number.isInteger(idEletricista)) falha('Escolha o eletricista.');
    const e = linha(idEletricista);
    if (!e) throw new ErroApi(404, 'Eletricista não encontrado.');
    // Pedido com planta ainda sem proposta aceite, com as propostas na bolsa (decisão do dono, 2026-10-11): atribuir
    // diretamente já não entrega os dados do cliente nem pede visita — pede a proposta só a este eletricista. O trabalho
    // vai para a bolsa visível só para ele; o resto é igual (ele propõe, o CEO escolhe e envia, o cliente aceita, e só
    // então ele vê o nome e a morada).
    if (config.propostasBolsa && tipoAtribuivel(o) === 'visita') {
      const t = novoTrabalho(o, 'bolsa', null, e);
      evento(t, 'posto_na_bolsa', e.id, u.email);
      db.prepare('INSERT OR IGNORE INTO trabalhos_eletricista_avisos (trabalho_id, eletricista_id, quando) VALUES (?, ?, ?)').run(t.id, e.id, agoraIso());
      auditar(u, 'trabalho_proposta_pedida', `orcamento:${o.id}`, { trabalho: t.id, eletricista: e.id, tipo: t.tipo, concelho: t.concelho }, ip);
      correio.enviar({ para: e.email, assunto: `Domus Energia: pedimos-lhe uma proposta em ${t.concelho}`, resumo: `trabalho ${t.id}: proposta pedida só ao eletricista ${e.id}`,
        texto: [`Olá ${e.nome},`, '', `Pedimos-lhe uma proposta para um pedido com planta em ${t.concelho}.`,
          'Veja a planta, as fotos e o relatório técnico na área do eletricista, em "Bolsa", e envie a sua proposta (horas, material e quando pode ir).',
          ...ligacaoArea(), '', 'Domus Energia'].join('\n') });
      return t;
    }
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

  /** O CEO retira o trabalho (da bolsa ou de quem o tem), em qualquer altura até o aprovar. As datas do pedido ficam como estão. */
  /**
   * O cliente não aceitou a proposta (conta.js recusarProposta): sai só o trabalho que estava à espera dele — o do
   * eletricista escolhido, ou o que ainda estava na bolsa. Um trabalho já feito (visita ou diagnóstico concluídos,
   * por aprovar ou por pagar) fica como está (revisão de segurança, 2026-10-11).
   */
  function aoClienteRecusar(o, u, ip) {
    const t = ativoDoPedido(o.id);
    if (!t || !(t.estado === 'na_bolsa' || esperaCliente(t))) return null;
    return retirar(o, u, ip);
  }
  function retirar(o, u, ip) {
    expirar();
    const t = ativoDoPedido(o.id);
    if (!t) throw new ErroApi(409, 'Este pedido não está na bolsa nem atribuído.');
    db.prepare("UPDATE trabalhos_eletricista SET estado = 'retirado', atualizado = ? WHERE id = ?").run(agoraIso(), t.id);
    evento(t, 'retirado', t.eletricista_id, u.email);
    fecharExtras(t, agoraIso());
    fecharIdas(t, agoraIso());
    auditar(u, 'trabalho_retirado', `orcamento:${o.id}`, { trabalho: t.id, eletricista: t.eletricista_id ?? null, estava: t.estado }, ip);
    // Propostas na bolsa: retirado pelo CEO (ou pelo "Não aceito" do cliente), o escolhido não largou nada — a proposta
    // dele volta a ficar de reserva, com as dos outros, para quando o pedido voltar à bolsa.
    // A cópia que ficou no trabalho sai (senão "Preencher pela proposta do eletricista" mostrava a de quem já não o tem).
    if (config.propostasBolsa && t.eletricista_id) db.prepare("UPDATE propostas_bolsa SET estado = 'reserva' WHERE orcamento_id = ? AND eletricista_id = ? AND estado = 'escolhida'").run(o.id, t.eletricista_id);
    if (porProposta(t)) db.prepare('UPDATE trabalhos_eletricista SET proposta = NULL WHERE id = ?').run(t.id);
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
    ['POST', 'bolsa/:id/proposta', true, 'proporBolsa'],   // {horas, material: [{sku, qtd}], notas, disponibilidade}: propor na bolsa (visita por proposta)
    ['GET', 'bolsa/:id/fotos/:foto', true, 'fotoBolsa'],    // as fotos que o cliente enviou, para quem está a propor
    ['GET', 'trabalhos', true, 'trabalhos'],
    ['GET', 'trabalhos/:id', true, 'trabalho'],
    ['POST', 'trabalhos/:id/visita', true, 'marcarVisita'],
    ['POST', 'trabalhos/:id/largar', true, 'largar'],
    ['GET', 'catalogo', true, 'catalogo'],   // os artigos para a proposta (sem preços)
    ['GET', 'trabalhos/:id/aparelhos', true, 'aparelhosTrabalho'],     // os aparelhos da casa do pedido e os chips que este trabalho registou
    ['POST', 'trabalhos/:id/chip', true, 'chipTrabalho'],              // {aparelho, mac, serie} — regista o chip (à espera do CEO, ou direto)
    ['POST', 'trabalhos/:id/esquema-quadro', true, 'esquemaQuadro'],   // {esquema} — o quadro existente, desenhado pelo eletricista
    ['POST', 'trabalhos/:id/proposta', true, 'proposta'],   // {horas, material: [{sku, qtd}], notas}, depois da visita
    ['POST', 'trabalhos/:id/material', true, 'material'],
    ['POST', 'trabalhos/:id/ensaios', true, 'ensaios'],
    ['POST', 'trabalhos/:id/diagnostico', true, 'diagnostico'],
    ['POST', 'trabalhos/:id/concluir', true, 'concluir'],
    ['POST', 'trabalhos/:id/extra', true, 'proporExtra'],   // {descricao, horas, material: [{sku, qtd}]}: trabalho a mais, numa obra
    ['POST', 'trabalhos/:id/extra/:extra/retirar', true, 'retirarExtra'],   // só enquanto a Domus Energia não o enviou ao cliente
    ['POST', 'trabalhos/:id/ida-perdida', true, 'idaPerdida'],   // {nota?}: "O cliente não estava", numa obra, depois da hora da visita marcada
    ['GET', 'trabalhos/:id/fotos/:foto', true, 'foto'],
    ['POST', 'trabalhos/:id/fotos/:foto', true, 'receberFoto'],   // :foto = o grupo (quadro_antes…); o corpo são os bytes
    ['POST', 'trabalhos/:id/fotos/:foto/apagar', true, 'apagarFoto'],
    ['GET', 'pagamentos', true, 'pagamentos'],
    ['POST', 'iban', true, 'iban'],
    ['GET', 'trabalhos/:id/fatura', true, 'verFatura'],
    ['POST', 'trabalhos/:id/fatura', true, 'fatura'],   // {tipo, dados} em base64, como o documento do seguro
    ['GET', 'procedimentos', true, 'procedimentos'],   // os procedimentos publicados (só leitura)
    ['GET', 'procedimentos/:id', true, 'procedimento'],
    ['POST', 'trabalhos/:id/checklists', true, 'iniciarChecklist'],   // {procedimento_id}: começa a checklist na obra do trabalho
    ['POST', 'trabalhos/:id/checklists/:lista', true, 'marcarPasso'],   // {passo, feito}
  ].filter(([, , , nome]) => config.propostasBolsa || !['proporBolsa', 'fotoBolsa'].includes(nome))   // com PROPOSTAS_BOLSA=0 estas rotas não existem (404, como antes)
    .map(([metodo, caminho, sessaoPrecisa, nome]) => ({ metodo, partes: caminho.split('/'), caminho, sessao: sessaoPrecisa, nome }));
  h.candidatura = candidatura;
  // As páginas perguntam se o módulo existe (com ELETRICISTAS desligado isto dá 404 e elas mostram só uma linha).
  // Leva a percentagem da mão de obra em vigor (configuração), para a página "Trabalhe connosco" não a ter escrita à mão.
  h.aberta = ({ res }) => responder(res, 200, { aberta: true, percentagem: percentagemOmissao() });

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
    tratar, sessao, listar, obter, atualizar, seguro, paraPainel, atribuicao, atribuir, porNaBolsa, retirar, aoClienteRecusar, expirar, limpar,
    apagar, fotoParaPainel, apagarFotosDoPedido,
    prazos: expirar, paraCliente, confirmarCliente, clienteConfirmou, obraPorConfirmar, visitaSemDefeito, decidir, pagamentosPainel, resumoPagamentos, marcarPago, faturaParaPainel,
    iniciar, parar, ROTAS_ELETRICISTA, estimativa, propostaDoPedido, escolher, aoClienteAceitar,
    extrasDoPedido, enviarExtra, naoAvancarExtra, extrasParaCliente, responderExtra, extrasPorRever,
    idasDoPedido, confirmarIda, anularIda, idasPorConfirmar, verificarParagem, aoPararObra,
    abrirSessao, publico,   // só para o acesso rápido de testes (acesso-rapido.js)
  };
}
