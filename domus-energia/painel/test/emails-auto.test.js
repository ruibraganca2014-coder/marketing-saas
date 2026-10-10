// Emails automáticos ao cliente (docs/EMAILS-AUTOMATICOS.md), com relógio falso: boas-vindas (uma vez, por tipo de
// pedido, nunca nas horas de silêncio), lembrete da visita (na véspera, à hora da configuração; remarcar dá outro),
// pagamento em falta (3 dias → 7 dias → tarefa e mais nada; pago a meio pára), depois da obra (guia e pedido de
// avaliação, com "Não quero receber" assinado), a avaliação na conta (tarefa com 1 a 3 estrelas; convite do Google a
// todos, só com a ligação configurada), reiniciar o painel não repete nada, a configuração (só CEO, com limites), a
// ficha do CRM e o RGPD (o registo dos envios e a recusa saem com a conta). Segunda ronda: a obra concluída pelo técnico
// no ecrã Obras só cria a tarefa "Confirmar obra concluída" (o cliente não é avisado), e os emails só contam a partir da
// publicação (`emails_chave.inicio`, migração 35).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa, SENHA } from './ajuda.js';
import { agoraLisboa } from '../src/crm.js';
import { criarEmailsAuto, urlGoogle, ROTA_NAO_RECEBER } from '../src/emails-auto.js';
import { montarMensagem } from '../src/email.js';
import { somarDiasCivil } from '../src/util.js';
import { DatabaseSync } from 'node:sqlite';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const HORA = 3600_000, DIA = 24 * HORA;
const SIM = {
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' },
  divisoes: [{ nome: 'Sala', interruptores: [2, 1] }], itens: [{ sku: 'INT-VIDRO-2', qtd: 1, preco_iva: 60 }],
  mao_obra: { horas: 5, valor_iva: 175 }, deslocacao: { estado: 'estimada', valor_iva: 10 }, total: { min: 900, max: 1200 }, plano_sugerido: 'conforto',
};
/** Avaria rápida como o simulador a monta (paga-se o diagnóstico ao enviar). */
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const GOOGLE = 'https://g.page/r/CdomusEnergia/review';

let p;
before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } }); });
after(() => p.fechar());

const E = () => p.app.api.emailsAuto;
const db = () => p.app.db;
const api = (papel, metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
const hojeLisboa = () => agoraLisboa(p.relogio.agora()).slice(0, 10);
/** Avança o relógio falso e volta a abrir as sessões do painel (duram 12 h). */
async function avancar(ms) {
  p.relogio.avancar(ms);
  for (const papel of ['ceo', 'tecnico', 'comercial']) p.cookies[papel] = await p.entrar(p.u[papel].email);
}
/** Avança até à próxima vez que forem `hm` em Lisboa (nunca fica onde está). */
async function ate(hm) {
  let t = p.relogio.agora();
  for (let i = 0; i < 2 * 24 * 60; i++) { t += 60_000; if (agoraLisboa(t).slice(11) === hm) break; }
  await avancar(t - p.relogio.agora());
}
/** A sessão da conta dura 7 dias sem uso: volta a entrar com a palavra-passe. */
async function reentrar(c) {
  const r = await p.pedir('POST', '/api/conta/entrar', { corpo: { email: c.email, password: SENHA } });
  assert.equal(r.estado, 200, r.texto);
  c.cookie = r.cabecalhos['set-cookie'][0].split(';')[0];
}
/** Emails automáticos (pelo assunto) enviados a `email` desde a posição `desde` da caixa de testes. */
const AUTO = /recebemos o seu pedido|a visita é amanhã|pagamento por fazer|como usar a sua conta/;
const autos = (email, desde = 0) => p.emails.slice(desde).filter((m) => m.para === email && AUTO.test(m.assunto));
const registo = (id) => db().prepare('SELECT tipo, chave FROM emails_automaticos WHERE orcamento_id = ? ORDER BY id').all(id).map((x) => ({ ...x }));
const tarefasDe = (id, tipo) => db().prepare('SELECT * FROM tarefas WHERE orcamento_id = ? AND lembrete LIKE ? ORDER BY id').all(id, `%:${tipo}:%`);
/** O painel "reiniciado": outra instância sobre a mesma base (o que já saiu está no registo). */
const reiniciado = () => criarEmailsAuto({ db: db(), config: p.config, relogio: () => p.relogio.agora(), auditar: () => {}, correio: { enviar: (m) => p.emails.push(m) },
  crm: p.app.api.crm, tarefas: p.app.api.tarefas, pagamentos: () => p.app.api.pagamentosPedido });

let seq = 0;
/** Pedido do formulário do site (sem conta); devolve {id, email}. */
async function pedidoSite(extra = {}) {
  const email = `form${++seq}@exemplo.pt`;
  const r = await p.pedir('POST', '/api/orcamento', { corpo: { nome: `Cliente Formulário ${seq}`, email, servico: 'Casa inteligente', ...extra } });
  assert.equal(r.estado, 201, r.texto);
  return { id: db().prepare('SELECT MAX(id) AS id FROM orcamentos').get().id, email: extra.email === null ? null : email };
}
/** Pedido do simulador (com conta); devolve {id, c}. */
async function pedidoConta(c = null) {
  c ??= await p.contaConfirmada();
  const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua do Teste, 1', simulacao: SIM } });
  assert.equal(r.estado, 201, r.texto);
  return { id: r.json.pedido, c };
}
/** Pedido com conta, proposta de 1000 € enviada e aceite online: fica a aguardar o sinal. */
async function aguardaSinal() {
  const { id, c } = await pedidoConta();
  assert.equal((await api('ceo', 'POST', `orcamentos/${id}`, { estado: 'proposta_enviada', valor_proposta: 1000 })).estado, 200);
  const r = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1000, plano: 'conforto' });
  assert.equal(r.estado, 200, r.texto);
  return { id, c, ref: r.json.pagamento.ref };
}
const pagar = async (c, ref) => assert.equal((await conta(c, 'POST', `pagamentos/${ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
/** Pedido com conta, sinal pago e obra dada por concluída no painel (o restante fica por pagar). */
async function obraConcluida() {
  const x = await aguardaSinal();
  await pagar(x.c, x.ref);
  assert.equal((await api('ceo', 'POST', `orcamentos/${x.id}/obra-concluida`, {})).estado, 200);
  return x;
}

test('utilidades: a ligação do Google só aceita https do Google; os cabeçalhos a mais não deixam injetar linhas', () => {
  assert.equal(urlGoogle(GOOGLE), GOOGLE);
  assert.ok(urlGoogle('https://search.google.com/local/writereview?placeid=abc'));
  assert.ok(urlGoogle('https://maps.app.goo.gl/abc'));
  for (const mau of ['http://g.page/r/x/review', 'https://g.page.mau.pt/x', 'https://google.com.mau.pt/', 'https://mau.pt/?u=google.com', 'javascript:alert(1)', '', null, 5]) {
    assert.equal(urlGoogle(mau), null, String(mau));
  }
  const m = montarMensagem({ de: 'a@b.pt', para: 'c@d.pt', assunto: 'x', texto: 'y', cabecalhos: {
    'List-Unsubscribe': '<https://painel.teste/x?t=1.abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Mau': 'a\r\nBcc: z@z.pt', 'Mau\r\nBcc': 'z' } });
  const [cab] = m.split('\r\n\r\n');
  assert.match(cab, /\r\nList-Unsubscribe: <https:\/\/painel\.teste\/x\?t=1\.abc>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click$/);
  assert.doesNotMatch(cab, /Bcc|X-Mau/);
  assert.doesNotMatch(montarMensagem({ de: 'a@b.pt', para: 'c@d.pt', assunto: 'x', texto: 'y' }), /List-Unsubscribe/, 'os outros emails ficam iguais');
});

describe('boas-vindas', () => {
  test('uma vez, logo ao receber: formulário (sem conta) e simulador (com conta) com os passos de cada um; sem email ou do painel não sai', async () => {
    await ate('10:00');
    const a = await pedidoSite();
    let m = autos(a.email);
    assert.equal(m.length, 1);
    assert.equal(m[0].assunto, 'Domus Energia: recebemos o seu pedido');
    assert.match(m[0].texto, new RegExp(`Recebemos o seu pedido n\\.º ${a.id}\\.`));
    assert.match(m[0].texto, /1\. Vamos contactá-lo em breve/);
    assert.doesNotMatch(m[0].texto, /Cliente Formulário|A sua conta/, 'sem o nome e sem a ligação da conta (não tem)');
    assert.equal(m[0].cabecalhos, undefined, 'email de serviço: sem "Não quero receber"');
    assert.deepEqual(registo(a.id), [{ tipo: 'boas_vindas', chave: `${a.id}:boas_vindas` }]);
    // A volta seguinte, e o painel reiniciado, não repetem.
    assert.equal(E().verificar(), 0);
    assert.equal(reiniciado().verificar(), 0);
    assert.equal(autos(a.email).length, 1);
    // Simulador: o relatório básico e a compra na conta.
    const b = await pedidoConta();
    m = autos(b.c.email);
    assert.equal(m.length, 1);
    assert.match(m[0].texto, /1\. O relatório básico .* já está na sua conta\./);
    assert.match(m[0].texto, /pode pedir na sua conta o relatório completo ou a visita técnica/);
    assert.match(m[0].texto, /A sua conta: https:\/\/site\.teste\/conta\.html/);
    // Só com telefone: não há para onde enviar. Criado no painel pela equipa: não é um pedido recebido do site.
    const antes = p.emails.length;
    const s = await pedidoSite({ email: null, telefone: '912 345 678' });
    assert.equal((await api('comercial', 'POST', 'orcamentos', { nome: 'Do Painel', email: 'painel@exemplo.pt', servico: 'Quadro' })).estado, 201);
    assert.equal(E().verificar(), 0);
    assert.equal(p.emails.length, antes);
    assert.deepEqual(registo(s.id), []);
  });

  test('lista de espera (o simulador marca o pedido com lista_espera): email e conta sem prazo de contacto nem visita', async () => {
    await ate('10:00');
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Espera', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua do Teste, 1', simulacao: { ...SIM, lista_espera: true } } });
    assert.equal(r.estado, 201, r.texto);
    const m = autos(c.email);
    assert.equal(m.length, 1);
    assert.match(m[0].texto, /1\. O seu pedido ficou em lista de espera/);
    assert.match(m[0].texto, /Contactamos consigo quando abrirmos as marcações\./);
    assert.doesNotMatch(m[0].texto, /dia útil seguinte|visita técnica/);
    const l = (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === r.json.pedido);
    assert.equal(l.estado_texto, 'Pedido recebido e em lista de espera: contactamos quando abrirmos as marcações. O relatório básico já está aqui.');
  });

  test('avaria paga ao enviar: o email "pagamento recebido" já confirma o pedido — não sai um segundo email', async () => {
    await ate('10:00');
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Avaria', telefone: '912 000 111', servico: 'Reparação', localidade: 'Sintra', morada: 'Rua do Teste, 1', simulacao: SIM_AVARIA } });
    assert.equal(r.estado, 202, r.texto);
    const antes = p.emails.length;
    await pagar(c, r.json.pagamento.ref);
    E().verificar();
    const dele = p.emails.slice(antes).filter((m) => m.para === c.email);
    assert.deepEqual(dele.map((m) => m.assunto), ['Domus Energia: pagamento recebido']);
    assert.match(dele[0].texto, /O seu pedido foi recebido\. Vamos marcar a visita técnica/);
  });

  test('horas de silêncio: entre as 21:00 e as 08:00 não sai nada; sai uma vez na primeira volta depois das 08:00; perdido entretanto não recebe', async () => {
    await ate('22:30');
    const a = await pedidoSite();
    const b = await pedidoSite();
    assert.equal(autos(a.email).length, 0);
    assert.equal(E().verificar(), 0);
    assert.equal((await api('ceo', 'POST', `orcamentos/${b.id}`, { estado: 'perdido', motivo_perda_tipo: 'sem_resposta' })).estado, 200);
    await ate('07:59');
    assert.equal(E().verificar(), 0, '07:59 ainda é silêncio');
    await ate('08:00');
    assert.equal(E().verificar(), 1);
    assert.equal(E().verificar(), 0);
    assert.equal(autos(a.email).length, 1);
    assert.equal(autos(b.email).length, 0, 'a condição já não vale: pedido perdido');
    await ate('20:59');
    assert.equal(autos((await pedidoSite()).email).length, 1, '20:59 ainda sai');
    await ate('21:00');
    assert.equal(autos((await pedidoSite()).email).length, 0, '21:00 já não');
  });

  test('um pedido com mais de 24 h sem boas-vindas (painel parado) já não as recebe', async () => {
    await ate('22:00');
    const a = await pedidoSite();
    await avancar(2 * DIA);
    await ate('10:00');
    E().verificar();
    assert.equal(autos(a.email).length, 0);
  });
});

describe('lembrete da visita', () => {
  const marcar = (id, quando) => api('ceo', 'POST', `orcamentos/${id}/marcar-visita`, { data_visita: quando });

  test('na véspera, a partir da hora da configuração, uma vez; remarcar dá um lembrete novo; reiniciar não repete', async () => {
    await ate('09:00');
    const a = await pedidoSite();
    const amanha = somarDiasCivil(hojeLisboa(), 1);
    assert.equal((await marcar(a.id, `${amanha}T15:00`)).estado, 200);
    assert.equal(E().verificar(), 0, 'antes das 10:00 não sai');
    await ate('10:00');
    assert.equal(E().verificar(), 1);
    const m = autos(a.email).at(-1);
    assert.equal(m.assunto, 'Domus Energia: a visita é amanhã');
    assert.match(m.texto, new RegExp(`a visita do seu pedido n\\.º ${a.id} é amanhã: .* às 15:00\\.`));
    assert.deepEqual(registo(a.id).at(-1), { tipo: 'visita', chave: `${a.id}:visita:${amanha}T15:00` });
    assert.doesNotMatch(m.texto, /A sua conta/, 'pedido sem conta: sem a ligação da conta');
    assert.equal(E().verificar(), 0);
    assert.equal(reiniciado().verificar(), 0);
    // Remarcada para dois dias depois: nada hoje; na véspera da data nova, outro lembrete.
    const depois = somarDiasCivil(amanha, 1);
    assert.equal((await marcar(a.id, `${depois}T11:30`)).estado, 200);
    assert.equal(E().verificar(), 0);
    await ate('10:00');
    assert.equal(E().verificar(), 1);
    assert.match(autos(a.email).at(-1).texto, /às 11:30\./);
    assert.equal(autos(a.email).filter((x) => /a visita é amanhã/.test(x.assunto)).length, 2);
  });

  test('marcada na véspera depois da hora do envio, ou para o próprio dia: sem lembrete; visita desmarcada: sem lembrete', async () => {
    await ate('11:00');
    const a = await pedidoSite();   // marcada às 11:00 para amanhã: o cliente acabou de saber
    const b = await pedidoSite();   // marcada para hoje
    const c = await pedidoSite();   // marcada ontem… e o pedido fica perdido antes da hora
    const hoje = hojeLisboa(), amanha = somarDiasCivil(hoje, 1), depois = somarDiasCivil(hoje, 2);
    assert.equal((await marcar(a.id, `${amanha}T09:00`)).estado, 200);
    assert.equal((await marcar(b.id, `${hoje}T18:00`)).estado, 200);
    assert.equal((await marcar(c.id, `${depois}T09:00`)).estado, 200);
    const antes = p.emails.length;
    assert.equal(E().verificar(), 0);
    await ate('09:30');   // o dia da visita de `a`, véspera da de `c`
    assert.equal((await api('ceo', 'POST', `orcamentos/${c.id}`, { estado: 'perdido', motivo_perda_tipo: 'prazo' })).estado, 200);
    await ate('12:00');
    assert.equal(E().verificar(), 0);
    assert.equal(p.emails.slice(antes).filter((m) => /a visita é amanhã/.test(m.assunto)).length, 0);
  });

  test('a hora é da configuração (só CEO, entre as 8 e as 20)', async () => {
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { email_visita_hora: 16 })).estado, 200);
    await ate('09:00');
    const a = await pedidoSite();
    assert.equal((await marcar(a.id, `${somarDiasCivil(hojeLisboa(), 1)}T10:00`)).estado, 200);
    await ate('15:59');
    assert.equal(E().verificar(), 0);
    await ate('16:00');
    assert.equal(E().verificar(), 1);
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { email_visita_hora: 10 })).estado, 200);
  });
});

describe('pagamento em falta', () => {
  test('sinal: lembrete aos 3 dias, outro aos 7 com a tarefa para os CEO, e depois mais nada; reiniciar não repete', async () => {
    await ate('10:00');
    const { id, c } = await aguardaSinal();
    const desde = db().prepare('SELECT proposta_aceite AS d FROM orcamentos WHERE id = ?').get(id).d;
    const dele = () => autos(c.email).filter((m) => /pagamento por fazer/.test(m.assunto));
    await avancar(2 * DIA);
    E().verificar();
    assert.equal(dele().length, 0, 'aos 2 dias ainda não');
    await avancar(DIA + 5 * 60_000);
    E().verificar();
    assert.equal(dele().length, 1);
    assert.equal(dele()[0].assunto, 'Domus Energia: pagamento por fazer');
    assert.match(dele()[0].texto, new RegExp(`O sinal do seu pedido n\\.º ${id} \\(369,00 €, com IVA\\) ainda está por pagar`));
    assert.equal(tarefasDe(id, 'pagamento_falta').length, 0, 'aos 3 dias ainda não há tarefa');
    E().verificar();
    assert.equal(reiniciado().verificar(), 0);
    assert.equal(dele().length, 1);
    await avancar(4 * DIA);
    E().verificar();
    assert.equal(dele().length, 2);
    assert.equal(dele()[1].assunto, 'Domus Energia: pagamento por fazer (segundo aviso)');
    const t = tarefasDe(id, 'pagamento_falta');
    assert.equal(t.length, 1);
    assert.equal(t[0].titulo, 'Ligar a Cliente Conta — pagamento em falta');
    assert.equal(t[0].responsavel_id, null, 'para os CEO');
    assert.equal(t[0].cliente_id, db().prepare('SELECT crm_cliente_id AS k FROM orcamentos WHERE id = ?').get(id).k, 'ligada à ficha');
    assert.equal(t[0].lembrete, `${id}:pagamento_falta:sinal:${desde}`);
    // Mais nada: nem ao fim de uma semana, nem de duas; a tarefa não se duplica nem é cancelada pelos lembretes do CRM.
    for (const d of [1, 6, 8]) { await avancar(d * DIA); E().verificar(); reiniciado().verificar(); }
    assert.equal(dele().length, 2);
    assert.equal((await api('ceo', 'GET', 'tarefas')).json.tarefas.filter((x) => x.orcamento_id === id && x.automatica === 'pagamento_falta').length, 1);
    assert.deepEqual(registo(id).map((x) => x.tipo), ['boas_vindas', 'pagamento_1', 'pagamento_2']);
  });

  test('pago a meio: a sequência pára (sem segundo aviso nem tarefa); com um pagamento aberto ainda válido espera-se', async () => {
    await ate('10:00');
    const { id, c } = await aguardaSinal();
    const dele = () => autos(c.email).filter((m) => /pagamento por fazer/.test(m.assunto));
    await avancar(3 * DIA + 5 * 60_000);
    // O cliente abre o pagamento (ex.: gera uma referência Multibanco): enquanto estiver válido (24 h) não se lembra.
    await reentrar(c);
    const novo = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'sinal' });
    assert.equal(novo.estado, 200, novo.texto);
    E().verificar();
    assert.equal(dele().length, 0);
    await avancar(DIA + 5 * 60_000);   // a referência expirou sem pagar
    E().verificar();
    assert.equal(dele().length, 1);
    // Paga antes dos 7 dias.
    const outra = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'sinal' });
    await pagar(c, outra.json.pagamento.ref);
    await avancar(4 * DIA);
    E().verificar();
    assert.equal(dele().length, 1);
    assert.equal(tarefasDe(id, 'pagamento_falta').length, 0);
  });

  test('restante da obra: os dois lembretes e a tarefa; pago depois, a tarefa aberta é cancelada; proposta mudada cancela o do sinal', async () => {
    await ate('10:00');
    const { id, c } = await obraConcluida();
    const dele = () => autos(c.email).filter((m) => /pagamento por fazer/.test(m.assunto));
    await avancar(3 * DIA + 5 * 60_000);
    E().verificar();
    assert.match(dele()[0].texto, new RegExp(`O restante da obra do seu pedido n\\.º ${id} \\(861,00 €, com IVA\\)`));
    await avancar(4 * DIA);
    E().verificar();
    assert.equal(dele().length, 2);
    assert.equal(tarefasDe(id, 'pagamento_falta').length, 1);
    await reentrar(c);
    const r = await conta(c, 'POST', `pedidos/${id}/pagar`, { fase: 'restante' });
    await pagar(c, r.json.pagamento.ref);
    E().verificar();
    assert.ok(tarefasDe(id, 'pagamento_falta')[0].cancelada, 'pago: a tarefa sai do quadro');
    // Sinal por pagar e o CEO muda a proposta (o cliente tem de aceitar de novo): deixa de estar em falta.
    const s = await aguardaSinal();
    assert.equal((await api('ceo', 'POST', `orcamentos/${s.id}`, { valor_proposta: 1200 })).estado, 200);
    await avancar(3 * DIA + 5 * 60_000);
    E().verificar();
    assert.equal(autos(s.c.email).filter((m) => /pagamento por fazer/.test(m.assunto)).length, 0);
  });
});

describe('depois da obra e "Não quero receber"', () => {
  const sair = (m) => /Abra esta ligação: (\S+)/.exec(m.texto)[1];
  const caminho = (url) => url.replace('https://painel.teste', '');

  test('2 dias depois da obra concluída, uma vez: guia, pedido de avaliação e a ligação assinada (cabeçalhos RFC 8058)', async () => {
    await ate('10:00');
    const { id, c } = await obraConcluida();
    const dele = () => autos(c.email).filter((m) => /como usar a sua conta/.test(m.assunto));
    await avancar(DIA + 23 * HORA);
    E().verificar();
    assert.equal(dele().length, 0, 'antes dos 2 dias não');
    await avancar(HORA + 5 * 60_000);
    E().verificar();
    assert.equal(dele().length, 1);
    const m = dele()[0];
    assert.match(m.texto, new RegExp(`A obra do seu pedido n\\.º ${id} está concluída`));
    assert.match(m.texto, /A minha conta \(https:\/\/site\.teste\/conta\.html\)/);
    assert.match(m.texto, /Área de cliente \(https:\/\/site\.teste\/cliente\.html\)/);
    assert.match(m.texto, new RegExp(`Diga-nos de 1 a 5 estrelas na sua conta, no pedido n\\.º ${id}`));
    assert.doesNotMatch(m.texto, /Google/, 'o convite do Google não vai no email');
    const url = sair(m);
    assert.equal(url, `https://painel.teste${ROTA_NAO_RECEBER}?t=${E().token(id)}`);
    assert.doesNotMatch(url, /@|exemplo/, 'sem o email no endereço');
    assert.deepEqual(m.cabecalhos, { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    E().verificar();
    assert.equal(reiniciado().verificar(), 0);
    assert.equal(dele().length, 1);
    assert.deepEqual(registo(id).at(-1), { tipo: 'obra', chave: `${id}:obra` });
  });

  test('token: válido só o assinado; GET mostra a confirmação e não recusa; POST (botão ou um clique, sem sessão) recusa', async () => {
    await ate('10:00');
    const { id, c } = await obraConcluida();
    const t = E().token(id);
    assert.equal(E().pedidoDoToken(t), id);
    const [, assinatura] = t.split('.');
    for (const mau of [`${id + 1}.${assinatura}`, `${id}.${assinatura.slice(0, -1)}${assinatura.at(-1) === 'A' ? 'B' : 'A'}`, `${id}.`, String(id), '', 'x.y', `${id}.${'A'.repeat(43)}`]) {
      assert.equal(E().pedidoDoToken(mau), null, mau);
      const r = await p.pedir('POST', `${ROTA_NAO_RECEBER}?t=${encodeURIComponent(mau)}`, { site: false, corpo: 'List-Unsubscribe=One-Click', tipo: 'application/x-www-form-urlencoded' });
      assert.equal(r.estado, 404, mau);
    }
    assert.equal(E().recusou(c.email), null, 'um token forjado não recusa nada');
    const g = await p.pedir('GET', `${ROTA_NAO_RECEBER}?t=${t}`, { site: false });
    assert.equal(g.estado, 200);
    assert.match(g.cabecalhos['content-type'], /text\/html/);
    assert.match(g.texto, /<form method="post"><button type="submit">Não quero receber<\/button><\/form>/);
    assert.equal(E().recusou(c.email), null, 'abrir a ligação (GET) não recusa');
    // Um clique do programa de email: POST sem cookies, sem Origin, corpo "List-Unsubscribe=One-Click".
    const r = await p.pedir('POST', `${ROTA_NAO_RECEBER}?t=${t}`, { site: false, corpo: 'List-Unsubscribe=One-Click', tipo: 'application/x-www-form-urlencoded' });
    assert.equal(r.estado, 200, r.texto);
    assert.match(r.texto, /Não vai receber mais o email com o guia/);
    assert.ok(E().recusou(c.email.toUpperCase()));
    assert.equal((await p.pedir('POST', `${ROTA_NAO_RECEBER}?t=${t}`, { site: false })).estado, 200, 'repetir não faz mal');
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM emails_recusados WHERE email = ?').get(c.email).n, 1);
    assert.equal((await p.pedir('PUT', `${ROTA_NAO_RECEBER}?t=${t}`, { site: false })).estado, 405);
    // A recusa vale para o email depois da obra (este pedido e os seguintes) e não para os emails de serviço.
    await avancar(2 * DIA + 5 * 60_000);
    E().verificar();
    assert.equal(autos(c.email).filter((m) => /como usar a sua conta/.test(m.assunto)).length, 0);
    await avancar(DIA);
    E().verificar();
    assert.equal(autos(c.email).filter((m) => /pagamento por fazer/.test(m.assunto)).length, 1, 'o lembrete do pagamento sai na mesma');
    await reentrar(c);
    const antes = p.emails.length;
    const outro = await pedidoConta(c);
    assert.equal(autos(c.email, antes).length, 1, 'as boas-vindas de um pedido novo também');
    assert.deepEqual(registo(outro.id).map((x) => x.tipo), ['boas_vindas']);
    // Na ficha do CRM: a lista dos emails enviados (sem corpo) e a recusa, só para ler.
    const k = db().prepare('SELECT crm_cliente_id AS k FROM orcamentos WHERE id = ?').get(id).k;
    const f = (await api('ceo', 'GET', `crm/clientes/${k}`)).json;
    assert.ok(f.cliente.emails_recusados);
    assert.deepEqual(f.emails_automaticos.filter((x) => x.orcamento_id === id).map((x) => x.tipo).sort(), ['boas_vindas', 'pagamento_1']);
    assert.deepEqual(Object.keys(f.emails_automaticos[0]).sort(), ['orcamento_id', 'quando', 'tipo']);
    assert.equal((await api('tecnico', 'GET', `crm/clientes/${k}`)).estado, 404);
  });
});

describe('avaliação na conta e convite do Google', () => {
  const pedidoNaConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);

  test('sem a ligação configurada não há convite; com ela, aparece a quem deu 5 e a quem deu 1; 1 a 3 estrelas cria a tarefa uma vez', async () => {
    await ate('10:00');
    const a = await obraConcluida(), b = await obraConcluida();
    const semObra = await pedidoConta();
    assert.equal((await pedidoNaConta(semObra.c, semObra.id)).avaliacao, null, 'sem obra concluída não se avalia');
    assert.equal((await conta(semObra.c, 'POST', `pedidos/${semObra.id}/avaliar`, { estrelas: 5 })).estado, 409);
    assert.deepEqual((await pedidoNaConta(a.c, a.id)).avaliacao, { pode: true, estrelas: null, do_pedido: false, google: null });
    // Validação e dono.
    assert.equal((await conta(a.c, 'POST', `pedidos/${a.id}/avaliar`, { estrelas: 0 })).estado, 400);
    assert.equal((await conta(a.c, 'POST', `pedidos/${a.id}/avaliar`, { estrelas: 4.5 })).estado, 400);
    assert.equal((await conta(b.c, 'POST', `pedidos/${a.id}/avaliar`, { estrelas: 5 })).estado, 404, 'o pedido de outra conta');
    // 5 estrelas, ainda sem ligação: sem convite e sem tarefa.
    let r = await conta(a.c, 'POST', `pedidos/${a.id}/avaliar`, { estrelas: 5 });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json.pedido.avaliacao, { pode: false, estrelas: 5, do_pedido: true, google: null });
    assert.equal((await conta(a.c, 'POST', `pedidos/${a.id}/avaliar`, { estrelas: 1 })).estado, 409, 'avalia-se uma vez');
    assert.equal(tarefasDe(a.id, 'avaliacao_baixa').length, 0);
    // O CEO configura a ligação (só https do Google; só o CEO).
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { google_avaliacao_url: 'https://mau.exemplo/review' })).estado, 400);
    assert.equal((await api('comercial', 'POST', 'config-orcamento', { google_avaliacao_url: GOOGLE })).estado, 403);
    r = await api('ceo', 'POST', 'config-orcamento', { google_avaliacao_url: GOOGLE });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.google_avaliacao_url, GOOGLE);
    assert.equal((await pedidoNaConta(a.c, a.id)).avaliacao.google, GOOGLE, '5 estrelas: convite');
    // 1 estrela: o MESMO convite (não se filtra pelas estrelas) e a tarefa urgente para os CEO, uma só.
    r = await conta(b.c, 'POST', `pedidos/${b.id}/avaliar`, { estrelas: 1 });
    assert.deepEqual(r.json.pedido.avaliacao, { pode: false, estrelas: 1, do_pedido: true, google: GOOGLE });
    E().aposAvaliar({ id: b.id }, 1);
    const t = tarefasDe(b.id, 'avaliacao_baixa');
    assert.equal(t.length, 1);
    assert.equal(t[0].titulo, 'Avaliação baixa — ligar a Cliente Conta');
    assert.equal(t[0].prazo, hojeLisboa(), 'urgente: prazo de hoje');
    assert.equal(t[0].responsavel_id, null);
    assert.match(t[0].descricao, /1 em 5 estrelas/);
    assert.equal((await api('ceo', 'GET', 'tarefas')).json.tarefas.filter((x) => x.orcamento_id === b.id && x.automatica === 'avaliacao_baixa' && !x.cancelada).length, 1);
    // Ligação tirada: o convite some em todo o lado.
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { google_avaliacao_url: '' })).estado, 200);
    assert.equal((await pedidoNaConta(a.c, a.id)).avaliacao.google, null);
    assert.equal((await pedidoNaConta(b.c, b.id)).avaliacao.google, null);
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { google_avaliacao_url: GOOGLE })).estado, 200);
    // Já avaliado: o email depois da obra não volta a pedir a avaliação.
    await avancar(2 * DIA + 5 * 60_000);
    E().verificar();
    const m = autos(a.c.email).find((x) => /como usar a sua conta/.test(x.assunto));
    assert.ok(m);
    assert.doesNotMatch(m.texto, /estrelas/);
  });

  test('a avaliação dada ao confirmar o trabalho de um eletricista externo conta: 3 estrelas → tarefa e convite; 4 → só o convite', async () => {
    await ate('10:00');
    for (const [estrelas, tarefas] of [[3, 1], [4, 0]]) {
      const { id, c } = await pedidoConta();
      const agora = new Date(p.relogio.agora()).toISOString();
      db().prepare(`INSERT INTO trabalhos_eletricista (orcamento_id, tipo, estado, modo, concelho, concluida, criado, atualizado)
        VALUES (?, 'visita', 'concluida_eletricista', 'direto', 'Sintra', ?, ?, ?)`).run(id, agora, agora, agora);
      assert.equal((await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id).avaliacao, null, 'por confirmar: avalia-se na confirmação');
      const r = await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas });
      assert.equal(r.estado, 200, r.texto);
      assert.deepEqual(r.json.pedido.avaliacao, { pode: false, estrelas, do_pedido: false, google: GOOGLE });
      assert.equal(tarefasDe(id, 'avaliacao_baixa').length, tarefas);
    }
  });
});

describe('configuração e RGPD', () => {
  test('prazos: só o CEO, inteiros dentro dos limites, o segundo lembrete depois do primeiro; não saem no catálogo público', async () => {
    const cfg = (await api('ceo', 'GET', 'config-orcamento')).json;
    assert.deepEqual([cfg.email_pagamento_1_dias, cfg.email_pagamento_2_dias, cfg.email_obra_dias, cfg.email_visita_hora], [3, 7, 2, 10]);
    for (const mau of [{ email_visita_hora: 7 }, { email_visita_hora: 21 }, { email_visita_hora: 10.5 }, { email_obra_dias: 0 }, { email_obra_dias: 31 },
      { email_pagamento_1_dias: 0 }, { email_pagamento_2_dias: 61 }, { email_pagamento_1_dias: 7 }, { email_pagamento_2_dias: 3 }, { email_pagamento_1_dias: 5, email_pagamento_2_dias: 5 }]) {
      assert.equal((await api('ceo', 'POST', 'config-orcamento', mau)).estado, 400, JSON.stringify(mau));
    }
    assert.equal((await api('comercial', 'POST', 'config-orcamento', { email_obra_dias: 3 })).estado, 403);
    assert.equal((await api('tecnico', 'GET', 'config-orcamento')).estado, 403);
    const r = await api('ceo', 'POST', 'config-orcamento', { email_pagamento_1_dias: 2, email_pagamento_2_dias: 5, email_obra_dias: 1 });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(E().prazos(), { email_pagamento_1_dias: 2, email_pagamento_2_dias: 5, email_obra_dias: 1, email_visita_hora: 10 });
    const pub = (await p.pedir('GET', '/api/catalogo')).json.config;
    assert.deepEqual(Object.keys(pub).filter((k) => /email|google/.test(k)), []);
    // Com os prazos novos: obra concluída há 1 dia → o email depois da obra; restante há 2 dias → 1.º lembrete.
    await ate('10:00');
    const { c } = await obraConcluida();
    await avancar(DIA + 5 * 60_000);
    E().verificar();
    assert.equal(autos(c.email).filter((m) => /como usar a sua conta/.test(m.assunto)).length, 1);
    await avancar(DIA);
    E().verificar();
    assert.equal(autos(c.email).filter((m) => /pagamento por fazer/.test(m.assunto)).length, 1);
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { email_pagamento_1_dias: 3, email_pagamento_2_dias: 7, email_obra_dias: 2 })).estado, 200);
  });

  test('conta apagada: o registo dos envios e a recusa saem com ela; pedidos anonimizados e contas apagadas não recebem nada', async () => {
    await ate('10:00');
    const a = await obraConcluida();           // com pagamentos: é anonimizado
    const b = await pedidoConta(a.c);          // sem pagamentos: é apagado
    await avancar(2 * DIA + 5 * 60_000);
    E().verificar();
    assert.deepEqual(registo(a.id).map((x) => x.tipo), ['boas_vindas', 'obra']);
    assert.deepEqual(registo(b.id).map((x) => x.tipo), ['boas_vindas']);
    assert.equal((await p.pedir('POST', `${ROTA_NAO_RECEBER}?t=${E().token(a.id)}`, { site: false })).estado, 200);
    assert.ok(E().recusou(a.c.email));
    const contaId = db().prepare('SELECT id FROM contas WHERE email = ?').get(a.c.email).id;
    const r = await api('ceo', 'POST', `contas/${contaId}/apagar`, { email: a.c.email });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedidos_anonimizados, 1);
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM emails_automaticos WHERE orcamento_id IN (?, ?)').get(a.id, b.id).n, 0);
    assert.equal(E().recusou(a.c.email), null);
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'emails_recusados' AND alvo = ?").get(`orcamento:${a.id}`).n, 0);
    // O restante continua por pagar no pedido anonimizado: não sai nenhum lembrete nem nasce tarefa.
    const antes = p.emails.length;
    for (const d of [1, 4, 3]) { await avancar(d * DIA); E().verificar(); }
    assert.equal(autos(a.c.email, antes).length, 0);
    assert.equal(tarefasDe(a.id, 'pagamento_falta').length, 0);
    // A ligação antiga continua assinada, mas já não há a quem recusar: responde bem e não guarda nada.
    assert.equal((await p.pedir('POST', `${ROTA_NAO_RECEBER}?t=${E().token(a.id)}`, { site: false })).estado, 200);
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM emails_recusados WHERE email = ?').get(a.c.email).n, 0);
  });
});

describe('obra concluída pelo técnico no ecrã Obras: o CEO confirma', () => {
  const tarefasObra = (id) => tarefasDe(id, 'obra_confirmar');
  const obra = (papel, id, corpo) => api(papel, 'POST', `obras/${id}`, corpo);

  test('nasce uma tarefa para os CEO (uma por obra); o cliente não é avisado nem o pedido muda; confirmar no pedido cancela-a', async () => {
    await ate('10:00');
    const { id, c, ref } = await aguardaSinal();
    await pagar(c, ref);   // sinal pago: a obra nasce
    const obraId = db().prepare('SELECT obra_id AS b FROM orcamentos WHERE id = ?').get(id).b;
    assert.equal((await obra('ceo', obraId, { tecnicos: [p.u.tecnico.id] })).estado, 200);
    assert.equal((await obra('tecnico', obraId, { estado: 'em_curso' })).estado, 200);
    assert.equal(tarefasObra(id).length, 0, 'em curso: nada');
    const antes = p.emails.length;
    assert.equal((await obra('tecnico', obraId, { estado: 'concluida' })).estado, 200);
    let t = tarefasObra(id);
    assert.equal(t.length, 1);
    assert.equal(t[0].titulo, 'Confirmar obra concluída — Cliente Conta');
    assert.match(t[0].descricao, /O técnico marcou a obra como concluída.*só depois de carregar em "Marcar obra concluída" na ficha do pedido/);
    assert.deepEqual([t[0].orcamento_id, t[0].obra_id, t[0].responsavel_id, t[0].prazo, t[0].lembrete], [id, obraId, null, hojeLisboa(), `${id}:obra_confirmar:${obraId}`]);
    assert.equal(t[0].cliente_id, db().prepare('SELECT crm_cliente_id AS k FROM orcamentos WHERE id = ?').get(id).k);
    // Daqui o cliente não sabe de nada: sem email, sem "obra concluída" no pedido, sem restante por pagar na conta.
    assert.equal(p.emails.slice(antes).filter((m) => m.para === c.email).length, 0);
    assert.equal(db().prepare('SELECT obra_concluida AS q FROM orcamentos WHERE id = ?').get(id).q, null);
    await avancar(4 * DIA);
    E().verificar();
    assert.equal(autos(c.email).filter((m) => /pagamento por fazer|como usar a sua conta/.test(m.assunto)).length, 0, 'sem confirmação não começam os emails');
    // O quadro do CEO mostra-a (os lembretes do CRM não a cancelam); o técnico não a vê.
    let q = (await api('ceo', 'GET', 'tarefas')).json.tarefas.filter((x) => x.orcamento_id === id && x.automatica === 'obra_confirmar');
    assert.equal(q.length, 1);
    assert.equal((await api('tecnico', 'GET', 'tarefas')).json.tarefas.filter((x) => x.automatica === 'obra_confirmar').length, 0);
    // Guardar outra vez a obra concluída não duplica; sair de concluída cancela-a; voltar reabre a MESMA.
    assert.equal((await obra('tecnico', obraId, { estado: 'concluida', notas: 'Tudo feito.' })).estado, 200);
    assert.equal(tarefasObra(id).length, 1);
    assert.equal((await obra('ceo', obraId, { estado: 'em_curso' })).estado, 200);
    await api('ceo', 'GET', 'tarefas/contagem');
    assert.ok(tarefasObra(id)[0].cancelada, 'a obra deixou de estar concluída');
    assert.equal((await obra('tecnico', obraId, { estado: 'concluida' })).estado, 200);
    t = tarefasObra(id);
    assert.equal(t.length, 1);
    assert.equal(t[0].cancelada, null, 'reaberta');
    // O CEO confirma no pedido: o cliente é avisado (email de sempre) e a tarefa sai sozinha.
    assert.equal((await api('ceo', 'POST', `orcamentos/${id}/obra-concluida`, {})).estado, 200);
    assert.equal(p.emails.at(-1).assunto, 'Domus Energia: obra concluída');
    q = (await api('ceo', 'GET', 'tarefas')).json.tarefas.filter((x) => x.orcamento_id === id && x.automatica === 'obra_confirmar');
    assert.equal(q.length, 0);
    assert.ok(tarefasObra(id)[0].cancelada);
    // Depois de confirmada, concluir outra vez no ecrã Obras já não cria nada.
    assert.equal((await obra('ceo', obraId, { estado: 'em_curso' })).estado, 200);
    assert.equal((await obra('ceo', obraId, { estado: 'concluida' })).estado, 200);
    assert.ok(tarefasObra(id)[0].cancelada);
    assert.equal(tarefasObra(id).length, 1);
  });

  test('tarefa feita não volta a nascer; obra sem pedido ligado não cria tarefa', async () => {
    await ate('10:00');
    const { id, c, ref } = await aguardaSinal();
    await pagar(c, ref);
    const obraId = db().prepare('SELECT obra_id AS b FROM orcamentos WHERE id = ?').get(id).b;
    assert.equal((await obra('ceo', obraId, { estado: 'concluida' })).estado, 200);
    const t = tarefasObra(id)[0];
    assert.equal((await api('ceo', 'POST', `tarefas/${t.id}`, { estado: 'feito' })).estado, 200);
    assert.equal((await obra('ceo', obraId, { estado: 'em_curso' })).estado, 200);
    assert.equal((await obra('ceo', obraId, { estado: 'concluida' })).estado, 200);
    assert.deepEqual(tarefasObra(id).map((x) => [x.id, x.estado]), [[t.id, 'feito']]);
    // Obra sem pedido (criada à mão para uma casa): nada.
    const agora = new Date(p.relogio.agora()).toISOString();
    const solta = Number(db().prepare("INSERT INTO obras (cliente, data, estado, material, criado, atualizado) VALUES ('casa-solta', ?, 'agendada', '[]', ?, ?)").run(hojeLisboa(), agora, agora).lastInsertRowid);
    const n = db().prepare("SELECT COUNT(*) AS n FROM tarefas WHERE lembrete LIKE '%:obra_confirmar:%'").get().n;
    assert.equal((await obra('ceo', solta, { estado: 'concluida' })).estado, 200);
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM tarefas WHERE lembrete LIKE '%:obra_confirmar:%'").get().n, n);
  });
});

describe('só conta a partir da publicação (migração 35)', () => {
  const original = () => db().prepare('SELECT inicio FROM emails_chave WHERE id = 1').get().inicio;
  /** Põe o início dos emails automáticos em "agora" (relógio falso), com um minuto de folga antes e depois. */
  async function publicarAgora() {
    await avancar(60_000);   // as datas guardam-se ao segundo: o que acabou de acontecer fica claramente antes
    db().prepare('UPDATE emails_chave SET inicio = ? WHERE id = 1').run(new Date(p.relogio.agora()).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    await avancar(60_000);
  }

  test('migração 35 sobre uma base na 34: guarda o instante em que corre e não mexe no segredo das ligações', () => {
    const base = new DatabaseSync(':memory:');
    for (const m of MIGRACOES.slice(0, 34)) m(base);
    base.exec('PRAGMA user_version = 34');
    const chave = base.prepare('SELECT chave FROM emails_chave WHERE id = 1').get().chave;
    const antes = Date.now() - 1000;
    migrar(base);
    assert.equal(versaoEsquema(base), MIGRACOES.length);
    const l = base.prepare('SELECT * FROM emails_chave').all();
    assert.equal(l.length, 1);
    assert.equal(l[0].chave, chave);
    assert.ok(Date.parse(l[0].inicio) >= antes && Date.parse(l[0].inicio) <= Date.now());
    migrar(base);
    assert.equal(base.prepare('SELECT inicio FROM emails_chave WHERE id = 1').get().inicio, l[0].inicio, 'reabrir não muda o início');
    base.close();
  });

  test('o início fica guardado pela migração e o CEO vê-o (só leitura)', async () => {
    assert.match(original(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(original()) <= Date.now());
    assert.equal(E().inicio(), original());
    assert.equal((await api('ceo', 'GET', 'config-orcamento')).json.emails_auto_inicio, original());
    assert.equal((await api('ceo', 'POST', 'config-orcamento', { emails_auto_inicio: '2020-01-01T00:00:00Z' })).estado, 400, 'não se edita');
  });

  test('antes do início: sem boas-vindas, sem lembretes de pagamento nem tarefa, sem email depois da obra; logo a seguir: tudo; a visita futura é lembrada', async () => {
    const guardado = original();
    try {
      // Pedido recebido nas horas de silêncio, ainda sem boas-vindas, e a publicação acontece antes das 08:00.
      await ate('22:30');
      const velho = await pedidoSite();
      await ate('09:00');
      const sinalVelho = await aguardaSinal();   // proposta aceite antes
      const obraVelha = await obraConcluida();   // obra concluída antes (restante por pagar)
      const visita = await pedidoSite();         // visita marcada antes, para amanhã
      assert.equal((await api('ceo', 'POST', `orcamentos/${visita.id}/marcar-visita`, { data_visita: `${somarDiasCivil(hojeLisboa(), 1)}T15:00` })).estado, 200);
      const marca = p.emails.length;
      await publicarAgora();
      const sinalNovo = await aguardaSinal();    // tudo isto um minuto depois do início
      const obraNova = await obraConcluida();
      const novo = await pedidoSite();
      assert.equal(autos(novo.email).length, 1, 'pedido depois do início: boas-vindas');
      await ate('10:00');
      E().verificar();
      assert.equal(autos(velho.email).length, 0, 'pedido anterior ao início: sem boas-vindas');
      assert.equal(autos(visita.email, marca).filter((m) => /a visita é amanhã/.test(m.assunto)).length, 1, 'a visita acontece depois do início: lembrete');
      const pag = (x) => autos(x.c.email, marca).filter((m) => /pagamento por fazer/.test(m.assunto)).length;
      const guia = (x) => autos(x.c.email, marca).filter((m) => /como usar a sua conta/.test(m.assunto)).length;
      await avancar(2 * DIA + 5 * 60_000);
      E().verificar();
      assert.deepEqual([guia(obraVelha), guia(obraNova)], [0, 1]);
      await avancar(DIA);
      E().verificar();
      assert.deepEqual([pag(sinalVelho), pag(obraVelha), pag(sinalNovo), pag(obraNova)], [0, 0, 1, 1]);
      await avancar(4 * DIA);
      E().verificar();
      reiniciado().verificar();
      assert.deepEqual([pag(sinalVelho), pag(obraVelha), pag(sinalNovo), pag(obraNova)], [0, 0, 2, 2]);
      assert.deepEqual([sinalVelho, obraVelha, sinalNovo, obraNova].map((x) => tarefasDe(x.id, 'pagamento_falta').length), [0, 0, 1, 1], 'sem sequência de emails não há tarefa');
      assert.deepEqual(registo(sinalVelho.id).map((x) => x.tipo), ['boas_vindas'], 'as boas-vindas saíram na altura; mais nada');
    } finally {
      db().prepare('UPDATE emails_chave SET inicio = ? WHERE id = 1').run(guardado);
    }
  });
});
