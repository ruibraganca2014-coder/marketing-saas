// Avarias fora de horas (decisão do dono, 2026-10-13; docs/PAGAMENTOS-PEDIDO.md "Avarias fora de horas"; migração 54):
// - só as avarias têm dois preços: fora de horas (noite, sábado, domingo e feriados nacionais) o diagnóstico e a mão de
//   obra custam mais `fora_horas_pct` (50 %); a deslocação é a mesma;
// - o cliente escolhe ao pedir (`simulacao.horario`) e o servidor calcula o valor; paga logo o que escolheu;
// - se a visita ficar marcada em horário normal, a diferença é devolvida sozinha, uma só vez; depois disso (como para
//   quem pagou o preço normal) a visita já não se marca fora do horário normal;
// - só os eletricistas que ligaram "Faço serviço de noite e ao fim de semana" veem e são avisados dessas avarias, e
//   recebem a mesma percentagem sobre a mão de obra mais alta; num concelho sem nenhum, o pedido fora de horas é recusado.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { foraDeHoras, feriadosNacionais, pascoa } from '../public/vendor/horario.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, normalizarEstado, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const DIA = 24 * 3600_000;
const IBAN = 'PT50000201231234567890154';
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
/** A avaria rápida como o simulador a monta; `horario`: a escolha do cliente (sem ela, um pedido de antes desta regra). */
function simAvaria(horario, extra = {}) {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const preco = calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], CATALOGO, null);
  return { ...montarSimulacao(e, preco, null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]), ...(horario ? { horario } : {}), ...extra };
}
// Sintra, configuração de omissão: diagnóstico 25 € + 0,5 h × 38 € = 44 €; deslocação 7,20 €.
const NORMAL = 51.2;          // 44 + 7,20
const FORA = 73.2;            // 44 × 1,5 + 7,20 (a deslocação não sobe)
const DIFERENCA = 22;         // 50 % de 44 €

describe('foraDeHoras: dias úteis das 08:00 às 20:00 (hora de Lisboa) é horário normal; o resto é fora de horas', () => {
  test('os limites do dia: 07:59 fora, 08:00 normal, 19:59 normal, 20:00 fora', () => {
    // 2026-10-14 é uma quarta-feira sem feriado.
    assert.deepEqual(['07:59', '08:00', '12:30', '19:59', '20:00', '23:59', '00:00'].map((h) => foraDeHoras(`2026-10-14T${h}`)), [true, false, false, false, true, true, true]);
  });
  test('a semana: sexta às 23:00 e sábado e domingo às 10:00 são fora de horas; segunda e sexta às 10:00 não', () => {
    assert.equal(foraDeHoras('2026-10-16T23:00'), true, 'sexta à noite');
    assert.equal(foraDeHoras('2026-10-16T10:00'), false, 'sexta de manhã');
    assert.equal(foraDeHoras('2026-10-17T10:00'), true, 'sábado');
    assert.equal(foraDeHoras('2026-10-18T10:00'), true, 'domingo');
    assert.equal(foraDeHoras('2026-10-19T10:00'), false, 'segunda');
    assert.equal(foraDeHoras('2026-10-19 10:00'), false, 'com espaço em vez de T');
  });
  test('feriados nacionais fixos a meio da semana', () => {
    // 2026: 1 dez (terça), 8 dez (terça), 25 dez (sexta), 10 jun (quarta), 1 mai (sexta); 2027: 1 jan (sexta), 5 out (terça).
    for (const d of ['2026-12-01', '2026-12-08', '2026-12-25', '2026-06-10', '2026-05-01', '2027-01-01', '2027-10-05', '2027-04-26', '2027-11-01']) {
      if (d === '2027-04-26') { assert.equal(foraDeHoras(`${d}T10:00`), false, '26 de abril não é feriado'); continue; }
      assert.equal(foraDeHoras(`${d}T10:00`), true, d);
    }
    assert.equal(foraDeHoras('2026-12-02T10:00'), false, 'o dia a seguir ao feriado é normal');
    assert.equal(feriadosNacionais(2026).length, 13);
    for (const fixo of ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25']) assert.ok(feriadosNacionais(2031).includes(fixo), fixo);
  });
  test('feriados móveis de dois anos: Sexta-feira Santa, Páscoa e Corpo de Deus', () => {
    assert.deepEqual([pascoa(2026), pascoa(2027), pascoa(2024), pascoa(2038)], [{ mes: 4, dia: 5 }, { mes: 3, dia: 28 }, { mes: 3, dia: 31 }, { mes: 4, dia: 25 }]);
    // 2026: Sexta-feira Santa a 3 de abril, Corpo de Deus a 4 de junho (quinta). 2027: 26 de março e 27 de maio.
    for (const d of ['2026-04-03', '2026-04-05', '2026-06-04', '2027-03-26', '2027-03-28', '2027-05-27']) assert.equal(foraDeHoras(`${d}T10:00`), true, d);
    for (const d of ['2026-04-02', '2026-04-06', '2026-06-03', '2027-03-25', '2027-05-26', '2027-04-02', '2027-06-04']) assert.equal(foraDeHoras(`${d}T10:00`), false, d);
  });
  test('o que não é uma data com hora devolve null (nunca se adivinha)', () => {
    for (const mau of [null, undefined, '', '2026-10-14', '14/10/2026 10:00', '2026-02-30T10:00', '2026-10-14T24:00', 42, {}]) assert.equal(foraDeHoras(mau), null, String(mau));
  });
  test('simulador: o estado guarda a escolha (por omissão horário normal) e ignora valores desconhecidos', () => {
    assert.equal(estadoNovo().horario, 'normal');
    assert.equal(normalizarEstado({ ...estadoNovo(), horario: 'fora_horas' }).horario, 'fora_horas');
    assert.equal(normalizarEstado({ ...estadoNovo(), horario: 'grátis' }).horario, 'normal');
    assert.equal(simAvaria().horario, undefined, 'a simulação da avaria não inventa a escolha');
  });
});

/** As ajudas comuns aos painéis destes testes. */
function ajudas(obterP) {
  let seq = 0;
  const painel = (metodo, caminho, papel = 'ceo', corpo) => obterP().pedir(metodo, `/painel/api/${caminho}`, { cookie: obterP().cookies[papel], corpo });
  const area = (e, metodo, caminho, corpo) => obterP().pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const conta = (c, metodo, caminho, corpo) => obterP().pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const atribuicao = (id, corpo) => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, 'ceo', corpo);
  /** Candidatura → aprovação → sessão. `foraHoras`: liga logo "Faço serviço de noite e ao fim de semana" na área dele. */
  async function eletricista({ foraHoras = false, ...extra } = {}) {
    const p = obterP();
    const n = ++seq;
    const e = { nome: `Eletricista Horas ${n}`, email: `eletricista.horas.${n}.${Math.random().toString(36).slice(2, 8)}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${7000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    e.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    e.cookie = r.cabecalhos['set-cookie'][0].split(';')[0];
    if (foraHoras) assert.equal((await area(e, 'POST', 'fora-horas', { ligado: true })).estado, 200);
    return e;
  }
  /** POST /api/orcamento de uma avaria (a resposta inteira). */
  const enviar = (c, horario, extra = {}, simExtra = {}) => obterP().pedir('POST', '/api/orcamento', { cookie: c.cookie,
    corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: simAvaria(horario, simExtra), ...extra } });
  /** Avaria enviada e paga (modo simulado; `metodo`: como se "pagou"): {c, id, ref}. */
  async function avariaPaga(horario, metodo = 'card') {
    const c = await obterP().contaConfirmada();
    const r = await enviar(c, horario);
    assert.equal(r.estado, 202, r.texto);
    const pago = await conta(c, 'POST', `pagamentos/${r.json.pagamento.ref}/simular`, { resultado: 'sucesso', metodo });
    assert.equal(pago.estado, 200, pago.texto);
    return { c, id: pago.json.pagamento.orcamento_id, ref: r.json.pagamento.ref, valor: r.json.pagamento.valor };
  }
  const naBolsa = async (e) => (await area(e, 'GET', 'bolsa')).json.trabalhos;
  /** Põe o pedido na bolsa e devolve o id do trabalho. */
  async function paraBolsa(id) {
    const r = await atribuicao(id, { acao: 'bolsa' });
    assert.equal(r.estado, 200, r.texto);
    return r.json.trabalho.id;
  }
  /**
   * Uma data com hora daqui a `desde` dias ou mais: `fimDeSemana` true = um sábado, domingo ou feriado; false = um dia
   * útil, à `hora` dada (às 10:00 fica em horário normal; às 21:30, por exemplo, é a noite de um dia útil).
   */
  function data(fimDeSemana, desde = 3, hora = '10:00') {
    for (let d = desde; d < desde + 30; d++) {
      const dia = lisboa(obterP().relogio.agora() + d * DIA).slice(0, 10);
      if (foraDeHoras(`${dia}T10:00`) === fimDeSemana) return `${dia}T${hora}`;
    }
    throw new Error('sem data');
  }
  const pagamento = (ref) => obterP().app.db.prepare('SELECT * FROM pagamentos_pedido WHERE ref = ?').get(ref);
  const pedidoConta = async (c, id) => (await conta(c, 'GET', 'pedidos')).json.pedidos.find((x) => x.id === id);
  const emailsDevolucao = (c) => obterP().emails.filter((m) => m.para === c.email && m.assunto === 'Domus Energia: devolvemos a diferença do fora de horas');
  return { painel, area, conta, atribuicao, eletricista, enviar, avariaPaga, naBolsa, paraBolsa, data, pagamento, pedidoConta, emailsDevolucao };
}

describe('avarias fora de horas, com os pagamentos ligados (modo simulado)', () => {
  let p;
  let N, H;   // N: eletricista de Sintra que só faz horário normal; H: de Sintra, faz fora de horas
  const a = ajudas(() => p);
  before(async () => {
    p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    N = await a.eletricista();
  });
  after(() => p.fechar());
  const catalogo = async () => (await p.pedir('GET', '/api/catalogo')).json;

  test('migração 54: só acrescenta colunas (por omissão NÃO faz fora de horas; pagamentos antigos sem acréscimo) e a chave fora_horas_pct = 50', () => {
    const colunas = (t) => p.app.db.prepare(`PRAGMA table_info(${t})`).all();
    const fh = colunas('eletricistas').find((c) => c.name === 'fora_horas');
    assert.deepEqual([fh.notnull, fh.dflt_value], [1, '0']);
    assert.equal(p.app.db.prepare('SELECT fora_horas FROM eletricistas WHERE id = ?').get(N.id).fora_horas, 0);
    assert.ok(colunas('pagamentos_pedido').some((c) => c.name === 'fora_horas_cent') && colunas('pagamentos_pedido').some((c) => c.name === 'fora_horas_devolvida'));
    assert.ok(colunas('devolucoes_pedido').some((c) => c.name === 'fora_horas'));
    assert.equal(p.app.db.prepare("SELECT valor FROM config_orcamento WHERE chave = 'fora_horas_pct'").get().valor, 50);
  });

  test('sem ninguém que faça fora de horas no concelho: a resposta pública di-lo (lista vazia) e o pedido fora de horas é recusado (409); o horário normal passa', async () => {
    assert.deepEqual((await catalogo()).fora_horas_concelhos, []);
    const c = await p.contaConfirmada();
    const r = await a.enviar(c, 'fora_horas');
    assert.equal(r.estado, 409, r.texto);
    assert.match(r.json.erro, /Neste concelho ainda não fazemos serviço de noite nem ao fim de semana/);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE conta_id = (SELECT id FROM contas WHERE email = ?)').get(c.email).n, 0, 'nada ficou por pagar');
    assert.equal((await a.enviar(c, 'normal')).estado, 202);
    // A escolha é validada: só os dois valores, e "fora de horas" só nas avarias.
    assert.equal((await a.enviar(await p.contaConfirmada(), 'de_noite')).estado, 400);
    const planta = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Casa', localidade: 'Sintra', simulacao: { ...simAvaria('fora_horas'), funil: 'planta' } } });
    assert.equal(planta.estado, 400);
    assert.match(planta.json.erro, /Só as avarias se pedem fora de horas/);
  });

  test('o eletricista liga e desliga "Faço serviço de noite e ao fim de semana"; o CEO vê-o e pode mudá-lo (o comercial e o técnico não); a resposta pública só diz os concelhos', async () => {
    assert.equal((await a.area(N, 'GET', 'eu')).json.eletricista.fora_horas, false, 'por omissão não');
    H = await a.eletricista({ concelhos: ['Sintra', 'Cascais'] });
    for (const mau of [{}, { ligado: 'sim' }, { ligado: 1 }, { ligado: null }]) assert.equal((await a.area(H, 'POST', 'fora-horas', mau)).estado, 400, JSON.stringify(mau));
    assert.equal((await p.pedir('POST', '/api/eletricista/fora-horas', { corpo: { ligado: true } })).estado, 401, 'sem sessão');
    const r = await a.area(H, 'POST', 'fora-horas', { ligado: true });
    assert.deepEqual([r.estado, r.json], [200, { fora_horas: true }]);
    assert.equal((await a.area(H, 'GET', 'eu')).json.eletricista.fora_horas, true);
    assert.equal((await a.area(N, 'GET', 'eu')).json.eletricista.fora_horas, false, 'só o dele muda');
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'eletricista_fora_horas' AND alvo = ? ORDER BY id DESC LIMIT 1").get(`eletricista:${H.id}`).detalhes, /"fora_horas":true/);
    // O CEO vê-o na lista e na ficha.
    const lista = (await a.painel('GET', 'eletricistas')).json.eletricistas;
    assert.deepEqual([lista.find((x) => x.id === H.id).fora_horas, lista.find((x) => x.id === N.id).fora_horas], [true, false]);
    assert.equal((await a.painel('GET', `eletricistas/${H.id}`)).json.eletricista.fora_horas, true);
    // Público: só os nomes dos concelhos, por ordem; nada de quantos nem quem.
    const cat = await catalogo();
    assert.deepEqual(cat.fora_horas_concelhos, ['Cascais', 'Sintra']);
    assert.ok(!JSON.stringify(cat).includes(H.nome) && !JSON.stringify(cat).includes(H.email));
    // Só o CEO o muda no painel.
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'comercial', { fora_horas: false })).estado, 403);
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'tecnico', { fora_horas: false })).estado, 403);
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'ceo', { fora_horas: 'não' })).estado, 400);
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'ceo', { fora_horas: false })).json.eletricista.fora_horas, false);
    assert.deepEqual((await catalogo()).fora_horas_concelhos, []);
    assert.equal((await a.area(H, 'GET', 'eu')).json.eletricista.fora_horas, false, 'o eletricista vê o que o CEO mudou');
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'ceo', { fora_horas: true })).json.eletricista.fora_horas, true);
    // Um eletricista suspenso não conta; reativado volta a contar. Desligar na área dele também tira o concelho.
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'ceo', { acao: 'suspender' })).estado, 200);
    assert.deepEqual((await catalogo()).fora_horas_concelhos, []);
    assert.equal((await a.painel('POST', `eletricistas/${H.id}`, 'ceo', { acao: 'reativar' })).estado, 200);
    assert.deepEqual((await catalogo()).fora_horas_concelhos, ['Cascais', 'Sintra']);
    // (a suspensão fechou-lhe a sessão: entra de novo)
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: H.email } })).estado, 200);
    H.cookie = (await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: H.email, codigo: p.codigo(H.email) } })).cabecalhos['set-cookie'][0].split(';')[0];
    assert.equal((await a.area(H, 'POST', 'fora-horas', { ligado: false })).json.fora_horas, false);
    assert.deepEqual((await catalogo()).fora_horas_concelhos, []);
    assert.equal((await a.area(H, 'POST', 'fora-horas', { ligado: true })).json.fora_horas, true);
  });

  test('configuração: fora_horas_pct é pública (o simulador mostra os dois preços), só o CEO a muda, entre 0 e 200', async () => {
    assert.equal((await catalogo()).config.fora_horas_pct, 50);
    assert.equal((await a.painel('POST', 'config-orcamento', 'comercial', { fora_horas_pct: 80 })).estado, 403);
    assert.equal((await a.painel('POST', 'config-orcamento', 'tecnico', { fora_horas_pct: 80 })).estado, 403);
    for (const mau of [-1, 200.5, 201, 'muito', null]) assert.equal((await a.painel('POST', 'config-orcamento', 'ceo', { fora_horas_pct: mau })).estado, 400, String(mau));
    assert.equal((await a.painel('POST', 'config-orcamento', 'ceo', { fora_horas_pct: 100 })).estado, 200);
    assert.equal((await catalogo()).config.fora_horas_pct, 100);
    // Com 100 % o diagnóstico e a mão de obra dobram (44 € → 88 €); a deslocação fica nos 7,20 €.
    const c = await p.contaConfirmada();
    assert.equal((await a.enviar(c, 'fora_horas')).json.pagamento.valor, 95.2);
    assert.equal((await a.painel('POST', 'config-orcamento', 'ceo', { fora_horas_pct: 50 })).estado, 200);
    assert.equal((await a.enviar(c, 'fora_horas')).json.pagamento.valor, FORA, 'o pagamento por pagar é trocado pelo do preço novo');
  });

  test('preço do diagnóstico, ao cêntimo e com IVA: normal 51,20 €; fora de horas 73,20 € (mais 50 % de 44 €; a deslocação igual nos dois)', async () => {
    const c = await p.contaConfirmada();
    const n = (await a.enviar(c, 'normal')).json.pagamento;
    assert.deepEqual([n.valor, n.fase, n.fora_horas, n.fora_horas_valor], [NORMAL, 'avaria', undefined, undefined]);
    assert.match(n.descricao, /^Diagnóstico da avaria e deslocação \(51,20\s€, descontados na reparação\)$/);
    const f = (await a.enviar(c, 'fora_horas')).json.pagamento;
    assert.notEqual(f.ref, n.ref, 'mudar a escolha troca o pagamento por pagar');
    assert.deepEqual([f.valor, f.fase, f.fora_horas, f.fora_horas_valor, f.fora_horas_devolvida], [FORA, 'avaria', true, DIFERENCA, null]);
    assert.match(f.descricao, /^Diagnóstico da avaria e deslocação, fora de horas \(73,20\s€, descontados na reparação\)$/);
    assert.equal(Math.round((f.valor - n.valor) * 100), 2200, 'a diferença é só 50 % do diagnóstico e da mão de obra (44 €)');
    assert.deepEqual([f.base, f.iva, f.iva_pct], [59.51, 13.69, 23], 'base e IVA do recibo');
    assert.equal(a.pagamento(n.ref).estado, 'cancelado');
    assert.deepEqual([a.pagamento(f.ref).valor_cent, a.pagamento(f.ref).fora_horas_cent], [7320, 2200]);
    assert.equal((await a.enviar(c, 'fora_horas')).json.pagamento.ref, f.ref, 'clicar outra vez: o mesmo pagamento');
  });

  test('o navegador não consegue impor o preço: um valor no pedido é recusado e os preços da simulação não contam', async () => {
    const c = await p.contaConfirmada();
    for (const campo of ['valor', 'preco', 'fora_horas', 'horario']) assert.equal((await a.enviar(c, 'fora_horas', { [campo]: 1 })).estado, 400, campo);
    // A simulação diz que o diagnóstico custa 1 € e que não há acréscimo: o servidor cobra o dele.
    const barato = { total: { min: 1, max: 1 }, itens: [{ sku: 'DIAG-AVARIA', qtd: 1, preco_iva: 1, grupo: 'reparar', horas: 0 }], mao_obra: { horas: 0, valor_iva: 0 }, deslocacao: { estado: 'estimada', valor_iva: 0 }, fora_horas_pct: 0, fora_horas_cent: 0 };
    assert.equal((await a.enviar(c, 'fora_horas', {}, barato)).json.pagamento.valor, FORA);
    assert.equal((await a.enviar(c, 'normal', {}, barato)).json.pagamento.valor, NORMAL);
  });

  test('bolsa: só quem ligou "fora de horas" vê a avaria e é avisado; recebe a mesma percentagem sobre a mão de obra mais alta', async () => {
    const { id } = await a.avariaPaga('fora_horas');
    // O painel mostra o selo e os valores.
    const ficha = (await a.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ficha.horario, ficha.fora_horas], ['fora_horas', { em_vigor: true, pct: 50, pago: DIFERENCA, devolvido: null, devolvido_em: null, por_transferencia: false }]);
    assert.equal((await a.painel('GET', 'orcamentos')).json.orcamentos.find((x) => x.id === id).fora_horas.em_vigor, true, 'também na lista (selo)');
    // Atribuir diretamente a quem não faz fora de horas: recusado; e ele nem aparece nos candidatos.
    assert.deepEqual((await a.atribuicao(id)).json.candidatos.map((x) => x.id), [H.id]);
    const direto = await a.atribuicao(id, { acao: 'atribuir', eletricista_id: N.id });
    assert.equal(direto.estado, 409);
    assert.match(direto.json.erro, /não faz serviço de noite nem ao fim de semana/);
    const n0 = p.emails.length;
    const tid = await a.paraBolsa(id);
    const avisos = p.emails.slice(n0).filter((m) => /novo trabalho em Sintra/.test(m.assunto));
    assert.deepEqual(avisos.map((m) => m.para), [H.email], 'só o que faz fora de horas é avisado');
    assert.match(avisos[0].texto, /É uma avaria fora de horas \(noite, fim de semana ou feriado\): recebe mais 50 % na mão de obra\./);
    assert.ok(!/Carla|Neves|912 345 678|Rua do Exemplo/.test(avisos[0].texto), 'nada do cliente');
    assert.ok(!(await a.naBolsa(N)).some((t) => t.id === tid), 'quem não faz fora de horas não a vê');
    assert.equal((await a.area(N, 'GET', `bolsa/${tid}`)).estado, 404);
    assert.equal((await a.area(N, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404);
    const cartao = (await a.naBolsa(H)).find((t) => t.id === tid);
    assert.equal(cartao.fora_horas, 50);
    // Mão de obra normal sem IVA: 19 € ÷ 1,23 = 15,45 €; fora de horas 23,18 €; 70 % = 16,23 €; + deslocação 5,85 €.
    assert.deepEqual(cartao.recebe, { percentagem: 70, mao_obra: 23.18, parte_mao_obra: 16.23, deslocacao: 5.85, total: 22.08, provisoria: false, fora_horas: 50 });
    assert.equal((await a.area(H, 'GET', `bolsa/${tid}`)).json.trabalho.fora_horas, 50);
    // Uma avaria em horário normal: os dois veem-na, sem selo, ao valor de sempre.
    const normal = await a.avariaPaga('normal');
    const tn = await a.paraBolsa(normal.id);
    for (const e of [N, H]) {
      const t = (await a.naBolsa(e)).find((x) => x.id === tn);
      assert.deepEqual([t.fora_horas, t.recebe], [undefined, { percentagem: 70, mao_obra: 15.45, parte_mao_obra: 10.82, deslocacao: 5.85, total: 16.67, provisoria: false }]);
    }
    assert.equal((await a.painel('GET', `orcamentos/${normal.id}`)).json.fora_horas, null);
    // Quem desliga deixa de a ver; quem liga passa a vê-la.
    await a.area(H, 'POST', 'fora-horas', { ligado: false });
    assert.ok(!(await a.naBolsa(H)).some((t) => t.id === tid));
    await a.area(N, 'POST', 'fora-horas', { ligado: true });
    assert.ok((await a.naBolsa(N)).some((t) => t.id === tid));
    await a.area(N, 'POST', 'fora-horas', { ligado: false });
    await a.area(H, 'POST', 'fora-horas', { ligado: true });
  });

  test('marcar fora de horas não devolve nada; marcar em horário normal devolve a diferença UMA SÓ VEZ e avisa o cliente; depois já não se marca fora de horas (409) e o eletricista recebe o valor normal', async () => {
    const { c, id, ref } = await a.avariaPaga('fora_horas');
    const tid = await a.paraBolsa(id);
    assert.equal((await a.area(H, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    // 1) Fora de horas (um sábado, domingo ou feriado às 10:00): fica marcada, sem devolução.
    const sabado = a.data(true);
    let r = await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: sabado });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.trabalho.visita, r.json.trabalho.fora_horas, r.json.trabalho.so_horario_normal, r.json.trabalho.recebe.total], [sabado, 50, undefined, 22.08]);
    let pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.devolvido_cent, pg.a_devolver, pg.fora_horas_devolvida], ['pago', null, null, null]);
    assert.equal(a.emailsDevolucao(c).length, 0);
    // À noite num dia útil também é fora de horas: nada muda.
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: a.data(false, 3, '21:30') })).estado, 200);
    assert.equal(a.pagamento(ref).fora_horas_devolvida, null);
    // 2) Alterada para um dia útil às 10:00: a diferença (22,00 €) é devolvida e o cliente avisado.
    const util = a.data(false);
    r = await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: util });
    assert.equal(r.estado, 200, r.texto);
    pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.valor_cent, pg.devolvido_cent, pg.a_devolver, Boolean(pg.fora_horas_devolvida), pg.com_visita], ['pago', 7320, 2200, null, true, 1]);
    const avisos = a.emailsDevolucao(c);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0].texto, /A visita do seu pedido n\.º \d+ ficou marcada em horário normal: devolvemos 22,00\s€\./);
    assert.match(avisos[0].texto, /mesmo meio de pagamento/);
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'fora_horas_devolvido' AND alvo = ?").get(`orcamento:${id}`).detalhes, /"devolvido":22/);
    // O eletricista passa ao valor normal e a ficha diz que já só se marca em horário normal.
    assert.deepEqual([r.json.trabalho.fora_horas, r.json.trabalho.so_horario_normal, r.json.trabalho.recebe], [undefined, true, { percentagem: 70, mao_obra: 15.45, parte_mao_obra: 10.82, deslocacao: 5.85, total: 16.67, provisoria: false }]);
    // 3) Outra alteração dentro do horário normal: não devolve outra vez.
    const util2 = a.data(false, 6, '15:00');
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: util2 })).estado, 200);
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: util2 })).estado, 200, 'nem quando é o painel a marcar');
    pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.devolvido_cent, pg.a_devolver], ['pago', 2200, null]);
    assert.equal(a.emailsDevolucao(c).length, 1, 'um só email');
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'fora_horas_devolvido' AND alvo = ?").get(`orcamento:${id}`).n, 1);
    // 4) Alterar para sábado depois da devolução: recusado, e a visita fica como estava (nunca se cobra outra vez).
    for (const quem of ['eletricista', 'ceo', 'ficha']) {
      const x = quem === 'eletricista' ? await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: sabado })
        : quem === 'ceo' ? await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: sabado }) : await a.painel('POST', `orcamentos/${id}`, 'ceo', { data_visita: sabado });
      assert.equal(x.estado, 409, `${quem}: ${x.texto}`);
      assert.equal(x.json.erro, 'A diferença já foi devolvida ao cliente: marque num dia útil entre as 8h e as 20h.');
    }
    assert.equal((await a.area(H, 'GET', `trabalhos/${tid}`)).json.trabalho.visita, util2);
    assert.equal((await a.painel('GET', `orcamentos/${id}`)).json.data_visita, util2);
    assert.equal(a.pagamento(ref).devolvido_cent, 2200);
    // A conta mostra o que pagou, que pediu fora de horas e a devolução; o painel também.
    const l = await a.pedidoConta(c, id);
    assert.deepEqual([l.fora_horas.em_vigor, l.fora_horas.pago, l.fora_horas.devolvido, Boolean(l.fora_horas.devolvido_em), l.fora_horas.por_transferencia], [false, DIFERENCA, DIFERENCA, true, false]);
    const linha = l.pagamentos.find((x) => x.fase === 'avaria');
    assert.deepEqual([linha.valor, linha.estado, linha.fora_horas, linha.fora_horas_valor, linha.devolvido, Boolean(linha.fora_horas_devolvida)], [FORA, 'pago', true, DIFERENCA, DIFERENCA, true]);
    const ficha = (await a.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ficha.fora_horas.em_vigor, ficha.fora_horas.devolvido, ficha.pagamentos[0].devolvido, ficha.pagamentos[0].fora_horas_valor], [false, DIFERENCA, DIFERENCA, DIFERENCA]);
    // Na reparação desconta-se o que ficou pago: o preço normal.
    const o = p.app.db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
    assert.equal(p.app.api.pagamentosPedido.valores(o).pago_antes, 5120);
    // Larga o trabalho: de volta à bolsa já é uma avaria em horário normal — quem não faz fora de horas também a vê.
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/largar`, {})).estado, 200);
    const t = (await a.naBolsa(N)).find((x) => x.id === tid);
    assert.deepEqual([t.fora_horas, t.recebe.total], [undefined, 16.67]);
  });

  test('quem pagou o preço normal não se marca fora de horas: 409 com a mensagem, para o eletricista e para o painel; em horário normal marca-se sem devolução', async () => {
    const { c, id, ref } = await a.avariaPaga('normal');
    const tid = await a.paraBolsa(id);
    assert.equal((await a.area(N, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    assert.equal((await a.area(N, 'GET', `trabalhos/${tid}`)).json.trabalho.so_horario_normal, true);
    for (const quando of [a.data(true), a.data(false, 3, '20:00'), a.data(false, 3, '07:59')]) {
      const r = await a.area(N, 'POST', `trabalhos/${tid}/visita`, { data_visita: quando });
      assert.equal(r.estado, 409, `${quando}: ${r.texto}`);
      assert.equal(r.json.erro, 'Este cliente pediu horário normal: marque num dia útil entre as 8h e as 20h.');
      assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: quando })).estado, 409);
    }
    assert.equal((await a.area(N, 'GET', `trabalhos/${tid}`)).json.trabalho.visita, null, 'nada ficou marcado');
    assert.equal((await a.painel('GET', `orcamentos/${id}`)).json.data_visita, null);
    const util = a.data(false, 3, '08:00');
    const ok = await a.area(N, 'POST', `trabalhos/${tid}/visita`, { data_visita: util });
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.trabalho.recebe.total, 16.67);
    assert.equal((await a.area(N, 'POST', `trabalhos/${tid}/visita`, { data_visita: a.data(false, 3, '19:59') })).estado, 200);
    const pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.valor_cent, pg.devolvido_cent, pg.fora_horas_cent, pg.fora_horas_devolvida], ['pago', 5120, null, null, null]);
    assert.equal(a.emailsDevolucao(c).length, 0);
    const l = await a.pedidoConta(c, id);
    assert.deepEqual([l.fora_horas, l.pagamentos[0].fora_horas], [null, undefined]);
  });

  test('fluxo antigo (pedido sem a escolha): o preço de sempre, sem campos novos no pagamento, e a visita marca-se a qualquer hora como hoje', async () => {
    const { c, id, ref, valor } = await a.avariaPaga(null);
    assert.equal(valor, NORMAL);
    const tid = await a.paraBolsa(id);
    assert.ok((await a.naBolsa(N)).some((t) => t.id === tid), 'todos a veem');
    assert.equal((await a.area(N, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    const r = await a.area(N, 'POST', `trabalhos/${tid}/visita`, { data_visita: a.data(true) });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.trabalho.fora_horas, r.json.trabalho.so_horario_normal, r.json.trabalho.recebe.total], [undefined, undefined, 16.67]);
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 3, '22:00') })).estado, 200);
    const pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.valor_cent, pg.devolvido_cent, pg.fora_horas_cent], ['pago', 5120, null, null]);
    const ficha = (await a.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ficha.horario, ficha.fora_horas], [null, null]);
    assert.ok(!('fora_horas' in (await a.pedidoConta(c, id)).pagamentos[0]));
  });

  test('o painel a marcar em horário normal também devolve; e se o cliente cancelar depois o diagnóstico, devolve-se só o resto (nunca em dobro)', async () => {
    const { c, id, ref } = await a.avariaPaga('fora_horas');
    const util = a.data(false, 5);
    const mv = await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'comercial', { data_visita: util });
    assert.equal(mv.estado, 200, mv.texto);
    assert.deepEqual([mv.json.fora_horas.em_vigor, mv.json.fora_horas.devolvido], [false, DIFERENCA]);
    assert.deepEqual([a.pagamento(ref).devolvido_cent, a.emailsDevolucao(c).length], [2200, 1]);
    // A conta deixa cancelar com mais de 24 h: devolve o que ainda está pago (51,20 €), não os 73,20 €.
    const l = await a.pedidoConta(c, id);
    assert.deepEqual(l.visita_cancelar, { pode: true, devolucao: NORMAL, motivo: null, avaria: true });
    const canc = await a.conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {});
    assert.deepEqual(canc.json, { ok: true, devolvido: NORMAL, manual: false });
    const pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.devolvido_cent, pg.a_devolver, pg.com_visita], ['devolvido', 7320, null, 0]);
    assert.equal((await a.conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {})).estado, 409, 'já está tudo devolvido');
  });

  test('pagou por referência Multibanco: a diferença vai por transferência (a conta pede o IBAN), uma só vez; o CEO marca "Devolvido"', async () => {
    const { c, id, ref } = await a.avariaPaga('fora_horas', 'multibanco');
    const util = a.data(false, 5);
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: util })).estado, 200);
    let pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.devolvido_cent, pg.a_devolver, Boolean(pg.fora_horas_devolvida), pg.com_visita], ['pago', null, 2200, true, 1]);
    assert.match(a.emailsDevolucao(c)[0].texto, /ficou marcada em horário normal: vamos devolver 22,00\s€\.[\s\S]*indique o IBAN na sua conta/);
    let l = await a.pedidoConta(c, id);
    assert.deepEqual([l.devolucoes.length, l.devolucoes[0].valor, l.devolucoes[0].motivo, l.devolucoes[0].motivo_texto, l.devolucoes[0].estado], [1, DIFERENCA, 'horario', 'Visita marcada em horário normal', 'pede_iban']);
    assert.deepEqual([l.fora_horas.devolvido, l.fora_horas.por_transferencia, l.compras.visita.paga], [DIFERENCA, true, true]);
    // Marcar outra vez não cria outra devolução.
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 7) })).estado, 200);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM devolucoes_pedido WHERE orcamento_id = ?').get(id).n, 1);
    assert.equal(a.pagamento(ref).a_devolver, 2200);
    // O cliente dá o IBAN e o CEO faz a transferência: só agora conta como devolvido; o pagamento continua a valer.
    const dev = l.devolucoes[0].id;
    assert.equal((await a.conta(c, 'POST', `devolucoes/${dev}/iban`, { iban: IBAN, titular: 'Carla Neves' })).estado, 200);
    assert.equal((await a.painel('POST', `devolucoes/${dev}/devolvida`, 'ceo', {})).estado, 200);
    pg = a.pagamento(ref);
    assert.deepEqual([pg.estado, pg.devolvido_cent, pg.a_devolver], ['pago', 2200, null]);
    l = await a.pedidoConta(c, id);
    assert.deepEqual([l.fora_horas.por_transferencia, l.compras.visita.paga, l.visita_cancelar.devolucao], [false, true, NORMAL]);
  });
});

describe('avarias fora de horas no modo stripe: o reembolso da diferença sai uma só vez, com a sua chave de idempotência', () => {
  let p;
  const chamadas = [];
  const a = ajudas(() => p);
  const fetchStripe = async (url, op) => {
    chamadas.push({ url, op });
    const params = new URLSearchParams(op.body ?? '');
    if (/checkout\/sessions$/.test(url)) return new Response(JSON.stringify({ id: `cs_test_${chamadas.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${chamadas.length}`, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) }), { status: 200 });
    const m = /checkout\/sessions\/(cs_test_\d+)(\?|$)/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], object: 'checkout.session', status: 'complete', payment_status: 'paid', payment_intent: { id: 'pi_1', latest_charge: { payment_method_details: { type: 'card' } } } }), { status: 200 });
    return new Response(JSON.stringify({ id: 're_1', status: 'succeeded' }), { status: 200 });
  };
  before(async () => {
    p = await painelComEquipa({ fetchStripe, env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: 'whsec_x', SITE_URL: 'https://site.teste' } });
    await a.eletricista({ foraHoras: true });
  });
  after(() => p.fechar());

  test('a sessão do Checkout leva o valor de fora de horas; marcar em horário normal faz UM POST /refunds de 22,00 €; cancelar depois devolve o resto com a chave de sempre', async () => {
    const c = await p.contaConfirmada();
    const env = await a.enviar(c, 'fora_horas');
    assert.equal(env.estado, 202, env.texto);
    const ref = env.json.pagamento.ref;
    assert.equal(new URLSearchParams(chamadas.find((x) => /checkout\/sessions$/.test(x.url)).op.body).get('line_items[0][price_data][unit_amount]'), '7320');
    const sessao = a.pagamento(ref).stripe_sessao;
    assert.equal(p.app.api.pagamentosPedido.tratarEvento({ id: `evt_${ref}`, type: 'checkout.session.completed', data: { object: { id: sessao, object: 'checkout.session', client_reference_id: ref, amount_total: 7320, currency: 'eur', payment_status: 'paid' } } }), 'pago');
    const id = a.pagamento(ref).orcamento_id;
    const reembolsos = () => chamadas.filter((x) => /\/refunds$/.test(x.url));
    // Fora de horas: nenhuma chamada ao Stripe.
    const n = chamadas.length;
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(true, 5) })).estado, 200);
    assert.equal(chamadas.length, n);
    // Horário normal: um reembolso de 2200 cêntimos sobre o PaymentIntent, com a chave própria.
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 5) })).estado, 200);
    assert.equal(reembolsos().length, 1);
    const r = reembolsos()[0];
    assert.deepEqual([new URLSearchParams(r.op.body).get('amount'), new URLSearchParams(r.op.body).get('payment_intent'), r.op.headers['Idempotency-Key']], ['2200', 'pi_1', `domus-reembolso-${ref}-horario`]);
    assert.equal(a.pagamento(ref).devolvido_cent, 2200);
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 8) })).estado, 200);
    assert.equal(reembolsos().length, 1, 'a segunda marcação não devolve outra vez');
    // O cliente cancela o diagnóstico: devolve-se o resto (5120), com a chave das devoluções de sempre.
    assert.deepEqual((await a.conta(c, 'POST', `pedidos/${id}/cancelar-visita`, {})).json, { ok: true, devolvido: NORMAL, manual: false });
    assert.equal(reembolsos().length, 2);
    assert.deepEqual([new URLSearchParams(reembolsos()[1].op.body).get('amount'), reembolsos()[1].op.headers['Idempotency-Key']], ['5120', `domus-reembolso-${ref}`]);
    assert.deepEqual([a.pagamento(ref).estado, a.pagamento(ref).devolvido_cent], ['devolvido', 7320]);
  });

  test('se o serviço de pagamentos falhar ao devolver, a visita não fica marcada em horário normal (tenta-se de novo e devolve)', async () => {
    const c = await p.contaConfirmada();
    const ref = (await a.enviar(c, 'fora_horas')).json.pagamento.ref;
    const sessao = a.pagamento(ref).stripe_sessao;
    p.app.api.pagamentosPedido.tratarEvento({ id: `evt_${ref}`, type: 'checkout.session.completed', data: { object: { id: sessao, object: 'checkout.session', client_reference_id: ref, amount_total: 7320, currency: 'eur', payment_status: 'paid' } } });
    const id = a.pagamento(ref).orcamento_id;
    const original = p.app.db.prepare('SELECT stripe_sessao FROM pagamentos_pedido WHERE ref = ?').get(ref).stripe_sessao;
    p.app.db.prepare('UPDATE pagamentos_pedido SET stripe_sessao = NULL WHERE ref = ?').run(ref);   // o Stripe não tem como devolver
    const falhou = await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 5) });
    assert.equal(falhou.estado, 409, falhou.texto);
    assert.equal((await a.painel('GET', `orcamentos/${id}`)).json.data_visita, null);
    assert.deepEqual([a.pagamento(ref).devolvido_cent, a.pagamento(ref).fora_horas_devolvida], [null, null]);
    p.app.db.prepare('UPDATE pagamentos_pedido SET stripe_sessao = ? WHERE ref = ?').run(original, ref);
    assert.equal((await a.painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: a.data(false, 5) })).estado, 200);
    assert.equal(a.pagamento(ref).devolvido_cent, 2200);
  });
});

describe('avarias fora de horas com os pagamentos desligados (ou em lista de espera): a escolha fica registada, sem preço nem devolução', () => {
  let p;
  let N, H;
  const a = ajudas(() => p);
  before(async () => {
    p = await painelComEquipa({ env: { SITE_URL: 'https://site.teste' } });   // PAGAMENTO_PEDIDO=0, como os testes antigos
    N = await a.eletricista();
  });
  after(() => p.fechar());

  test('sem ninguém no concelho: 409 na mesma; com alguém: entra grátis, só ele a vê, e marcar em horário normal não devolve nada', async () => {
    const c = await p.contaConfirmada();
    assert.equal((await a.enviar(c, 'fora_horas')).estado, 409);
    H = await a.eletricista({ foraHoras: true });
    const r = await a.enviar(c, 'fora_horas');
    assert.equal(r.estado, 201, r.texto);
    assert.equal(r.json.pagamento, undefined);
    const id = r.json.pedido;
    const ficha = (await a.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([ficha.horario, ficha.fora_horas, ficha.pagamentos], ['fora_horas', { em_vigor: true, pct: 50, pago: null, devolvido: null, devolvido_em: null, por_transferencia: false }, []]);
    const tid = await a.paraBolsa(id);
    assert.ok(!(await a.naBolsa(N)).some((t) => t.id === tid));
    assert.ok((await a.naBolsa(H)).some((t) => t.id === tid));
    assert.equal((await a.area(H, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    const n0 = p.emails.length;
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: a.data(false) })).estado, 200);
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/visita`, { data_visita: a.data(true) })).estado, 200, 'sem devolução feita, volta a poder ir para fora de horas');
    assert.ok(!p.emails.slice(n0).some((m) => /devolvemos/.test(m.assunto)));
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido').get().n, 0);
    // Uma avaria sem a escolha (como hoje) e outra em horário normal entram grátis e todos as veem.
    const antiga = await a.enviar(await p.contaConfirmada(), null);
    assert.equal(antiga.estado, 201);
    const tAntiga = await a.paraBolsa(antiga.json.pedido);
    assert.ok((await a.naBolsa(N)).some((t) => t.id === tAntiga));
  });

  test('em lista de espera a avaria fora de horas entra sem pagar, com a escolha guardada', async () => {
    assert.equal((await a.painel('POST', 'lista-espera', 'ceo', { ativa: true, arranque: 'setembro de 2027' })).estado, 200);
    const r = await a.enviar(await p.contaConfirmada(), 'fora_horas');
    assert.equal(r.estado, 201, r.texto);
    assert.equal((await a.painel('GET', `orcamentos/${r.json.pedido}`)).json.horario, 'fora_horas');
    assert.equal((await a.painel('POST', 'lista-espera', 'ceo', { ativa: false })).estado, 200);
  });
});
