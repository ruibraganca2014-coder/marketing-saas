// Assistente (IA) do pedido (docs/ASSISTENTE-IA.md; src/assistente.js): "Resumir pedido" e "Sugerir diagnóstico" com a
// API da Anthropic simulada. Ao modelo vão só os dados técnicos (nunca nome, contactos, morada nem localidade em texto
// livre); o resultado fica em `orcamentos.ia`, só para CEO e comercial, e não mexe no diagnóstico do pedido.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { semContactos, dadosParaIa, validarResposta, MODELO_ASSISTENTE } from '../src/assistente.js';

const SIM = {
  versao: 1, funil: 'avaria', servico: ['reparar'], urgencia: 'urgente',
  avaria: { onde: ['cozinha'], problema: ['sem_corrente', 'disjuntor'], descricao: 'A tomada não dá nada. Liguem para o 912 345 678 ou maria.silva@exemplo.pt' },
  casa: { tipo: 'moradia', localidade: 'Rua das Flores 12, Sintra', potencia_contratada_kva: 6.9 },
  planta: { fundo: { imagem: 'data:image/png;base64,AAAA' }, divisoes: [], elementos: [] },
  deslocacao: { estado: 'estimada', localidade: 'Rua das Flores 12, Sintra', concelho: 'Sintra', distrito: 'Lisboa', distancia_km: 25, valor_iva: 10 },
  itens: [{ sku: 'DIAG-AVARIA', qtd: 1, preco_iva: 25, grupo: 'reparar', horas: 0.5 }], divisoes: [],
  fotos: [{ chave: 'avaria:foto', tipo: 'avaria', legenda: 'Avaria — casa da Maria' }],
};
const RESUMO = { resumo: 'Moradia em Sintra com uma tomada da cozinha sem corrente.', quer: ['Reparar a tomada da cozinha'], atencao: ['O disjuntor dispara'], perguntas: ['Desde quando?'] };
const DIAGNOSTICO = {
  causas: [{ causa: 'Borne solto na tomada', probabilidade: 'alta', porque: 'Só uma tomada sem corrente.', verificar: 'Medir tensão na tomada.' }],
  medicoes: ['Isolamento ≥ 1 MΩ a 500 V'], material: ['Tomada schuko'], seguranca: ['Cortar o circuito antes de abrir a tomada'], confianca: 'media', nota: '',
};
const EMAIL = { assunto: 'Domus Energia: visita ao seu pedido', texto: 'Olá,\n\nPodemos ir quinta-feira de manhã. A visita custa 35 €.\n\nDomus Energia' };
const PESSOAIS = ['Maria', 'Confidencial', '912', '345 678', 'exemplo.pt', 'Rua', 'Flores', 'Travessa', 'data:image'];

const respostaApi = (texto, extra = {}) => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODELO_ASSISTENTE, stop_reason: 'end_turn',
  // Como na API real: o raciocínio vem antes do texto.
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: texto }], usage: { input_tokens: 5000, output_tokens: 1000 }, ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });

async function novoPedido(p, extra = {}) {
  const c = await p.contaConfirmada('maria.silva@exemplo.pt'.replace('maria', `maria${Math.random().toString(36).slice(2, 8)}`));
  const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Maria Confidencial', telefone: '912 345 678', servico: 'Reparação', localidade: 'Sintra', morada: 'Travessa do Teste, 1', mensagem: 'Tomada sem corrente; o meu email é maria@exemplo.pt', simulacao: SIM, ...extra } });
  assert.equal(r.estado, 201, r.texto);
  novoPedido.cookie = c.cookie;   // a sessão da conta do cliente deste pedido
  return r.json.pedido;
}

test('semContactos: tira emails, códigos postais e números longos; deixa as medições', () => {
  assert.equal(semContactos('Ligue 912 345 678 ou +351 21 123 45 67, a.b@c.pt, 2710-123 Sintra, NIF 123456789'), 'Ligue [número] ou [número], [email], [código postal] Sintra, NIF [número]');
  assert.equal(semContactos('Disjuntor de 16 A dispara aos 230 V; quadro de 2019 com 12 módulos'), 'Disjuntor de 16 A dispara aos 230 V; quadro de 2019 com 12 módulos');
});

test('dadosParaIa: só o técnico — sem nome, contactos, morada, localidade em texto livre, planta nem fotos', () => {
  const d = dadosParaIa({ nome: 'Maria Confidencial', telefone: '912 345 678', email: 'm@exemplo.pt', morada: 'Travessa do Teste, 1', localidade: 'Sintra', servico: 'Reparação', mensagem: 'O meu número é 912345678', criado: '2026-10-04T10:00:00.000Z', notas: 'Nota interna sobre a Maria' },
    { simulacao: SIM, catalogo: { 'DIAG-AVARIA': { nome: 'Diagnóstico de avaria' } }, concelho: 'Sintra', diagnostico: { tipo: 'aberto', por: 'ceo@domus.teste' } });
  const json = JSON.stringify(d);
  for (const x of [...PESSOAIS, 'Nota interna', 'ceo@domus.teste']) assert.ok(!json.includes(x), `sem ${x}: ${json}`);
  assert.equal(d.concelho, 'Sintra');
  assert.equal(d.mensagem_do_cliente, 'O meu número é [número]');
  assert.equal(d.simulacao.avaria.descricao, 'A tomada não dá nada. Liguem para o [número] ou [email]');
  assert.deepEqual(d.simulacao.material, [{ artigo: 'Diagnóstico de avaria', qtd: 1, grupo: 'reparar', horas: 0.5 }]);
  assert.deepEqual(d.simulacao.deslocacao, { estado: 'estimada', distrito: 'Lisboa', distancia_km: 25 });
  assert.equal(d.simulacao.planta, undefined);
  assert.deepEqual(d.diagnostico_ja_registado, { tipo: 'aberto' });
});

test('validarResposta: limites, campos em falta e contactos na resposta', () => {
  assert.deepEqual(validarResposta('resumo', RESUMO), RESUMO);
  assert.equal(validarResposta('resumo', { ...RESUMO, resumo: 'Ligar ao 912 345 678' }).resumo, 'Ligar ao [número]');
  assert.equal(validarResposta('resumo', { ...RESUMO, quer: Array(20).fill('x') }).quer.length, 8);
  assert.throws(() => validarResposta('resumo', { ...RESUMO, resumo: '  ' }), /resumo vazio/);
  assert.throws(() => validarResposta('resumo', { ...RESUMO, quer: 'x' }), /quer/);
  assert.deepEqual(validarResposta('diagnostico', DIAGNOSTICO), DIAGNOSTICO);
  assert.throws(() => validarResposta('diagnostico', { ...DIAGNOSTICO, causas: [] }), /causas/);
  assert.throws(() => validarResposta('diagnostico', { ...DIAGNOSTICO, confianca: 'total' }), /confianca/);
});

describe('assistente desligado (sem ANTHROPIC_API_KEY)', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  test('a ficha diz que está desligado e os botões respondem 503 sem chamar nada', async () => {
    const id = await novoPedido(p);
    const o = (await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.ceo })).json;
    assert.deepEqual(o.ia, { ligado: false, resumo: null, diagnostico: null });
    const r = await p.pedir('POST', `/painel/api/orcamentos/${id}/ia/resumo`, { cookie: p.cookies.ceo, corpo: {} });
    assert.equal(r.estado, 503);
    assert.match(r.json.erro, /ANTHROPIC_API_KEY/);
  });
});

describe('assistente (API simulada)', () => {
  let p;
  let modo = 'ok';
  const pedidos = [];
  async function fetchFalso(url, opcoes) {
    const corpo = JSON.parse(opcoes.body);
    pedidos.push({ url, opcoes, corpo });
    const tipo = corpo.system.includes('eletricista sénior') ? DIAGNOSTICO : corpo.system.includes('Escreves emails') ? EMAIL : RESUMO;
    if (modo === 'ok') return respostaApi(JSON.stringify(tipo));
    if (modo === 'fallback') return respostaApi(JSON.stringify(tipo), { model: 'claude-opus-4-8', content: [{ type: 'fallback', from: { model: MODELO_ASSISTENTE }, to: { model: 'claude-opus-4-8' } }, { type: 'text', text: JSON.stringify(tipo) }] });
    if (modo === 'sem-fallbacks') return corpo.fallbacks ? new Response('{"type":"error","error":{"type":"invalid_request_error","message":"fallbacks"}}', { status: 400 }) : respostaApi(JSON.stringify(tipo));
    if (modo === 'recusa') return respostaApi('', { stop_reason: 'refusal', content: [] });
    if (modo === 'esquema') return respostaApi(JSON.stringify({ ...tipo, resumo: '' }));
    if (modo === '500-depois-ok') return pedidos.length % 2 ? new Response('{"type":"error","error":{"type":"api_error"}}', { status: 500 }) : respostaApi(JSON.stringify(tipo));
    return new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 });
  }
  before(async () => { p = await painelComEquipa({ env: { ANTHROPIC_API_KEY: 'sk-ant-teste', LIMITE_IA_DIA: '13', SITE_URL: 'https://site.teste' }, fetch: fetchFalso }); });
  after(() => p.fechar());

  const ia = (id, tipo, papel = 'ceo') => p.pedir('POST', `/painel/api/orcamentos/${id}/ia/${tipo}`, { cookie: p.cookies[papel], corpo: {} });
  const usar = (m) => { modo = m; pedidos.length = 0; };

  test('resumo: ao modelo vão só os dados técnicos; o resultado fica no pedido com quem, quando, modelo e custo', async () => {
    usar('ok');
    const id = await novoPedido(p);
    const r = await ia(id, 'resumo');
    assert.equal(r.estado, 200, r.texto);
    assert.equal(pedidos.length, 1);
    const { url, opcoes, corpo } = pedidos[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(opcoes.headers['x-api-key'], 'sk-ant-teste');
    assert.equal(opcoes.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(corpo.model, 'claude-opus-5-5');
    assert.equal(corpo.fallbacks, 'default');
    assert.equal(corpo.output_config.effort, 'medium');
    assert.equal(corpo.output_config.format.type, 'json_schema');
    assert.equal(corpo.thinking, undefined, 'no Opus 5.5 o raciocínio não se configura');
    for (const x of PESSOAIS) assert.ok(!opcoes.body.includes(x), `sem dados pessoais (${x})`);
    assert.ok(opcoes.body.includes('Sintra') && opcoes.body.includes('sem_corrente'), 'vai o concelho e a avaria');
    assert.deepEqual(r.json.ia.ligado, true);
    const { data, ...resto } = r.json.ia.resumo;
    assert.deepEqual(resto, { ...RESUMO, por: p.u.ceo.email, modelo: 'claude-opus-5-5', custo_usd: 0.04 });
    assert.ok(Date.parse(data));
    assert.equal(r.json.ia.diagnostico, null);
    const h = r.json.historico.filter((x) => x.acao === 'ia_resumo');
    assert.deepEqual(h.at(-1).detalhes, { modelo: 'claude-opus-5-5', tokens_entrada: 5000, tokens_saida: 1000, custo_usd: 0.04 });
  });

  test('diagnóstico: mais esforço, fica ao lado do resumo e não mexe no diagnóstico do pedido; o comercial também pode', async () => {
    usar('ok');
    const id = await novoPedido(p);
    assert.equal((await ia(id, 'resumo')).estado, 200);
    const r = await ia(id, 'diagnostico', 'comercial');
    assert.equal(r.estado, 200, r.texto);
    assert.equal(pedidos[1].corpo.output_config.effort, 'high');
    assert.deepEqual(r.json.ia.diagnostico.causas, DIAGNOSTICO.causas);
    assert.equal(r.json.ia.diagnostico.por, p.u.comercial.email);
    assert.equal(r.json.ia.resumo.resumo, RESUMO.resumo, 'o resumo continua lá');
    assert.equal(r.json.diagnostico, null, 'o diagnóstico do pedido não é preenchido');
  });

  test('o técnico não pode; o cliente nunca vê o resultado', async () => {
    usar('ok');
    const c = await p.contaConfirmada();
    const env = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Maria Confidencial', telefone: '912 345 678', servico: 'Reparação', localidade: 'Sintra', morada: 'Travessa do Teste, 1', simulacao: SIM } });
    assert.equal(env.estado, 201, env.texto);
    const id = env.json.pedido;
    assert.equal((await ia(id, 'resumo', 'tecnico')).estado, 403);
    assert.equal(pedidos.length, 0);
    assert.equal((await ia(id, 'resumo')).estado, 200);
    const conta = await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie });
    assert.equal(conta.estado, 200);
    assert.ok(!conta.texto.includes(RESUMO.resumo) && !conta.texto.includes('"ia"'), 'a conta do cliente não traz o resultado');
  });

  test('escrever ao cliente: a IA redige a partir da ideia (sem dados pessoais, nada guardado) e o painel envia e regista no CRM', async () => {
    usar('ok');
    const id = await novoPedido(p);
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/ia/resposta`, { cookie: p.cookies.ceo, corpo: {} })).estado, 400, 'sem a ideia');
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/ia/resposta`, { cookie: p.cookies.tecnico, corpo: { instrucao: 'x' } })).estado, 403);
    assert.equal(pedidos.length, 0);
    const r = await p.pedir('POST', `/painel/api/orcamentos/${id}/ia/resposta`, { cookie: p.cookies.comercial, corpo: { instrucao: 'Podemos ir quinta de manhã; a visita custa 35 €.' } });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json, { ...EMAIL, modelo: 'claude-opus-5-5', custo_usd: 0.04 });
    assert.match(pedidos[0].corpo.messages[0].content, /<o_que_dizer>\nPodemos ir quinta de manhã; a visita custa 35 €\.\n<\/o_que_dizer>/);
    for (const x of PESSOAIS) assert.ok(!pedidos[0].opcoes.body.includes(x), `sem dados pessoais (${x})`);
    let o = (await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.ceo })).json;
    assert.deepEqual([o.ia.resumo, o.ia.diagnostico, o.estado], [null, null, 'novo'], 'o rascunho não se guarda nem mexe no pedido');
    assert.match(o.mensagem_para, /^maria.+@exemplo\.pt$/);
    // Enviar: vai para o email da conta do cliente, fica na ficha do CRM e o pedido passa a "contactado".
    const antes = p.emails.length;
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/mensagem`, { cookie: p.cookies.ceo, corpo: { assunto: EMAIL.assunto, texto: '' } })).estado, 400);
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/mensagem`, { cookie: p.cookies.tecnico, corpo: EMAIL })).estado, 403);
    const e = await p.pedir('POST', `/painel/api/orcamentos/${id}/mensagem`, { cookie: p.cookies.comercial, corpo: EMAIL });
    assert.equal(e.estado, 200, e.texto);
    assert.equal(p.emails.length, antes + 1);
    assert.deepEqual([p.emails.at(-1).para, p.emails.at(-1).assunto], [o.mensagem_para, EMAIL.assunto]);
    assert.ok(p.emails.at(-1).texto.startsWith(EMAIL.texto));
    assert.equal(e.json.estado, 'contactado');
    const h = e.json.historico.filter((x) => x.acao === 'mensagem_enviada');
    assert.deepEqual(h.at(-1).detalhes, { caracteres: EMAIL.texto.length }, 'o texto não vai para a auditoria');
    const reg = p.app.db.prepare("SELECT tipo, texto, por_email FROM crm_registos WHERE orcamento_id = ? AND tipo = 'email'").all(id);
    assert.deepEqual(reg.map((x) => ({ ...x })), [{ tipo: 'email', texto: `${EMAIL.assunto}\n\n${EMAIL.texto}`, por_email: p.u.comercial.email }]);
  });

  test('conversa do pedido: o email leva a ligação da conta; o cliente responde lá, a resposta aparece no painel e nasce a tarefa', async () => {
    usar('ok');
    const id = await novoPedido(p);
    const cliente = novoPedido.cookie;
    const conta = async () => (await p.pedir('GET', '/api/conta/pedidos', { cookie: cliente })).json.pedidos.find((x) => x.id === id);
    const responder = (texto, cookie = cliente) => p.pedir('POST', `/api/conta/pedidos/${id}/mensagens`, { cookie, corpo: { texto } });
    // Antes de a equipa escrever: sem conversa, o cliente não pode escrever.
    assert.deepEqual([(await conta()).mensagens, (await conta()).pode_responder], [[], false]);
    assert.equal((await responder('Olá?')).estado, 409);
    assert.equal((await p.pedir('POST', `/painel/api/orcamentos/${id}/mensagem`, { cookie: p.cookies.ceo, corpo: EMAIL })).estado, 200);
    assert.ok(p.emails.at(-1).texto.startsWith(EMAIL.texto), 'o texto revisto vai tal e qual');
    assert.match(p.emails.at(-1).texto, new RegExp(`Para responder, entre na sua conta: \\S+/conta\\.html#pedido-${id}$`));
    let c = await conta();
    assert.equal(c.pode_responder, true);
    assert.equal(c.mensagens.length, 1);
    assert.deepEqual({ ...c.mensagens[0], quando: null }, { de: 'equipa', assunto: EMAIL.assunto, texto: EMAIL.texto, quando: null }, 'sem quem da equipa escreveu');
    assert.ok(!JSON.stringify(c.mensagens).includes(p.u.ceo.email));
    // O cliente responde: só o dono do pedido, com texto.
    assert.equal((await responder('  ')).estado, 400);
    const outro = await p.contaConfirmada();
    assert.equal((await responder('Sou outro', outro.cookie)).estado, 404);
    const r = await responder('Quinta de manhã serve.\nEnvio a foto hoje.');
    assert.equal(r.estado, 201, r.texto);
    assert.deepEqual(r.json.pedido.mensagens.map((m) => m.de), ['equipa', 'cliente']);
    const o = (await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.comercial })).json;
    assert.deepEqual(o.mensagens.map((m) => [m.de, m.texto, m.por]), [['equipa', EMAIL.texto, p.u.ceo.email], ['cliente', 'Quinta de manhã serve.\nEnvio a foto hoje.', null]]);
    assert.ok(o.historico.some((x) => x.acao === 'mensagem_cliente'));
    const t = p.app.db.prepare("SELECT titulo, orcamento_id, responsavel_id FROM tarefas WHERE lembrete LIKE ?").all(`${id}:cliente_respondeu:%`);
    assert.deepEqual(t.map((x) => ({ ...x })), [{ titulo: 'Cliente respondeu — Maria Confidencial', orcamento_id: id, responsavel_id: null }]);
  });

  test('a API recusa `fallbacks` (400): repete sem ele e deixa de o mandar', async () => {
    usar('sem-fallbacks');
    const id = await novoPedido(p);
    assert.equal((await ia(id, 'resumo')).estado, 200);
    assert.deepEqual(pedidos.map((x) => x.corpo.fallbacks), ['default', undefined]);
    assert.equal(pedidos[1].opcoes.headers['anthropic-beta'], undefined);
  });

  test('falhas: recusa e 401 não repetem; 500 e resposta inválida repetem uma vez; nada fica guardado', async () => {
    const id = await novoPedido(p);
    usar('recusa');
    let r = await ia(id, 'resumo');
    assert.equal(r.estado, 502);
    assert.match(r.json.erro, /recusou/);
    assert.equal(pedidos.length, 1);
    usar('401');
    assert.equal((await ia(id, 'resumo')).estado, 502);
    assert.equal(pedidos.length, 1);
    usar('esquema');
    assert.equal((await ia(id, 'resumo')).estado, 502);
    assert.equal(pedidos.length, 2);
    assert.equal((await p.pedir('GET', `/painel/api/orcamentos/${id}`, { cookie: p.cookies.ceo })).json.ia.resumo, null);
  });

  test('resposta servida por outro modelo (fallback): guarda o modelo que respondeu', async () => {
    usar('fallback');
    const id = await novoPedido(p);
    const r = await ia(id, 'resumo');
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.ia.resumo.modelo, 'claude-opus-4-8');
  });

  test('limite por 24 h (LIMITE_IA_DIA): 429 sem chamar a API; volta a deixar passado um dia', async () => {
    usar('ok');
    const id = await novoPedido(p);
    let r;
    for (let i = 0; i < 14; i++) { r = await ia(id, 'resumo'); if (r.estado !== 200) break; }
    assert.equal(r.estado, 429);
    assert.match(r.json.erro, /13 vezes/);
    const antes = pedidos.length;
    assert.equal((await ia(id, 'diagnostico')).estado, 429);
    assert.equal(pedidos.length, antes);
    p.relogio.avancar(24 * 3600_000 + 1000);
    p.cookies.ceo = await p.entrar(p.u.ceo.email);   // a sessão do painel não dura um dia parada
    assert.equal((await ia(id, 'diagnostico')).estado, 200);
  });
});
