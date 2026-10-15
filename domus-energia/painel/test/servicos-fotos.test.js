// Serviços com preço depois das fotos (decisões do dono, 2026-10-14; docs/SIMULADOR-ORCAMENTO.md §0 "Serviços com preço
// depois das fotos"; public/vendor/servicos-fotos.js): videoporteiro e intercomunicador e antenas de TV e ITED (redes),
// motores e portões automáticos (domótica) e — só como pedido de orçamento — para-raios e coluna montante (geral). O
// cliente descreve e manda fotos em "Pedir um serviço" (funil `servico`); o pedido entra grátis (sem diagnóstico pago),
// validado vai para a bolsa por proposta e o preço vem na proposta. O prédio precisa de projeto e técnico responsável:
// nunca vai sozinho para a bolsa (nem com a validação) — o CEO decide no painel (ficha "Próximo passo" e Hoje).
// Os artigos do catálogo (migração 57) são provisórios, escondidos do cliente, com a especialidade de cada um, e os que
// mexem na instalação de telecomunicações levam `precisa_ited` (a ficha ITED da ANACOM, para uma tarefa seguinte).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { migrar, MIGRACOES, versaoEsquema, abrirDb } from '../src/db.js';
import { SEMENTES_SERVICOS_FOTOS } from '../src/catalogo-sementes.js';
import { especialidadeSugerida } from '../src/eletricistas.js';
import { pendentesDoPedido, proximoPasso, linhasDoHoje } from '../src/proximo-passo.js';
import { SERVICOS_FOTOS, servicoFotosDe, precisaProjeto, precisaFichaIted, textoServicoFotos, textoPredio, FOTO_SERVICO } from '../public/vendor/servicos-fotos.js';
import { estadoNovo, montarSimulacao, montarPedido, normalizarEstado, PASSO, FUNIS, CARTOES_FUNIL } from '../../web/simulador/estado.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
/** A simulação que o simulador envia para um serviço com fotos (estado.js montarSimulacaoServico). */
function simServico(tipo, opcoes, extra = {}) {
  const e = estadoNovo();
  e.funil = 'servico';
  e.passo = PASSO.servico;
  e.contacto.localidade = 'Sintra';
  e.servicoFotos = { tipo, opcoes, descricao: 'Fica à entrada, do lado esquerdo.', predio: { nome: 'Condomínio Rua das Flores, 7', pisos: 6, fogos: 12 }, ...extra };
  return montarSimulacao(e, { deslocacao: { estado: 'estimada', valor_iva: 46.4 } }, null, [{ chave: FOTO_SERVICO, legenda: 'Entrada' }]);
}

describe('servicos-fotos.js: as definições e as funções puras', () => {
  test('a cópia do painel é igual à do site', async () => {
    const site = await readFile(new URL('../../web/simulador/servicos-fotos.js', import.meta.url), 'utf8');
    const painel = await readFile(new URL('../public/vendor/servicos-fotos.js', import.meta.url), 'utf8');
    assert.equal(painel.replace(/\r\n/g, '\n'), site.replace(/\r\n/g, '\n'), 'painel/public/vendor/servicos-fotos.js é cópia de web/simulador/servicos-fotos.js');
  });
  test('quatro serviços com a especialidade certa; os SKUs são os artigos da migração 57', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(SERVICOS_FOTOS).map(([k, d]) => [k, d.especialidade])),
      { videoporteiro: 'redes', antenas: 'redes', portoes: 'domotica', predio: 'geral' });
    const skus = Object.values(SERVICOS_FOTOS).flatMap((d) => Object.values(d.opcoes).map((o) => o.sku)).sort();
    assert.deepEqual(skus, SEMENTES_SERVICOS_FOTOS.map((s) => s.sku).sort());
    for (const s of SEMENTES_SERVICOS_FOTOS) {
      const [tipo] = Object.entries(SERVICOS_FOTOS).find(([, d]) => Object.values(d.opcoes).some((o) => o.sku === s.sku));
      assert.equal(s.especialidade, SERVICOS_FOTOS[tipo].especialidade, s.sku);
    }
  });
  test('o pedido limpo, o prédio, a ficha ITED, os textos e a especialidade sugerida', () => {
    const v = simServico('videoporteiro', ['reparar', 'instalar']);
    assert.deepEqual(servicoFotosDe(v), { tipo: 'videoporteiro', opcoes: ['instalar', 'reparar'], descricao: 'Fica à entrada, do lado esquerdo.', predio: null });
    assert.equal(textoServicoFotos(v), 'Videoporteiro e intercomunicador: Instalar ou trocar o videoporteiro (moradia); Reparar o videoporteiro ou o intercomunicador');
    assert.deepEqual([precisaProjeto(v), precisaFichaIted(v), especialidadeSugerida(v)], [false, false, 'redes']);
    const a = simServico('antenas', ['tomadas']);
    assert.deepEqual([precisaFichaIted(a), precisaFichaIted(simServico('antenas', ['antena', 'reparar'])), especialidadeSugerida(a)], [true, false, 'redes']);
    assert.equal(especialidadeSugerida(simServico('portoes', ['portao', 'bomba'])), 'domotica');
    const p = simServico('predio', ['para_raios']);
    assert.deepEqual([precisaProjeto(p), especialidadeSugerida(p), textoPredio(p)], [true, 'geral', '6 pisos · 12 fogos']);
    assert.deepEqual(p.servico_fotos.predio, { nome: 'Condomínio Rua das Flores, 7', pisos: 6, fogos: 12 });
    assert.equal(v.servico_fotos.predio, undefined, 'o prédio só vai no pedido de prédio');
    // Outro funil, ou um tipo desconhecido: nada.
    for (const s of [null, {}, { funil: 'avaria' }, { funil: 'servico' }, { funil: 'servico', servico_fotos: { tipo: 'toString' } }, { funil: 'planta', servico_fotos: { tipo: 'antenas', opcoes: ['antena'] } }]) {
      assert.equal(servicoFotosDe(s), null, JSON.stringify(s));
      assert.equal(precisaProjeto(s), false);
    }
  });
  test('o simulador: funil "servico" (Início, O serviço, Enviar), sem cartão próprio; o estado guarda-se e volta', () => {
    assert.deepEqual(FUNIS.servico.passos, [PASSO.inicio, PASSO.servico, PASSO.enviar]);
    assert.deepEqual(CARTOES_FUNIL, ['primeira', 'planta', 'avaria']);
    const e = estadoNovo();
    e.funil = 'servico';
    e.passo = PASSO.servico;
    e.servicoFotos = { tipo: 'predio', opcoes: ['coluna', 'x'], descricao: 'abc', predio: { nome: 'Cond.', pisos: 3, fogos: 600 } };
    const n = normalizarEstado(JSON.parse(JSON.stringify(e)));
    assert.deepEqual([n.funil, n.passo, n.servicoFotos.opcoes, n.servicoFotos.predio.fogos], ['servico', PASSO.servico, ['coluna'], null]);
    // Sem serviço escolhido volta ao Início de "Pedir um serviço".
    const sem = normalizarEstado(JSON.parse(JSON.stringify({ ...e, servicoFotos: { tipo: 'nada' } })));
    assert.deepEqual([sem.funil, sem.passo], ['planta', PASSO.inicio]);
    // O pedido: sem preço, sem planta, só as fotos do serviço; o "Serviço" do pedido é o nome dele.
    const s = simServico('portoes', ['comando']);
    assert.deepEqual([s.funil, s.total, s.planta, s.itens, s.fotos.map((f) => f.chave)], ['servico', null, null, [], [FOTO_SERVICO]]);
    assert.equal(montarPedido(estadoNovo(), s).servico, 'Motores e portões automáticos');
  });
});

describe('migração 57: os artigos dos serviços com fotos e a decisão do prédio', () => {
  test('base nova: provisórios, sem preço de lista, escondidos do cliente, com a especialidade; ITED e projeto assinalados', () => {
    const db = abrirDb(':memory:');
    const art = (sku) => { const a = db.prepare('SELECT * FROM catalogo WHERE sku = ?').get(sku); return a && { ...a, e: JSON.parse(a.especificacoes) }; };
    for (const s of SEMENTES_SERVICOS_FOTOS) {
      const a = art(s.sku);
      assert.ok(a, s.sku);
      assert.deepEqual([a.especialidade, a.visivel_cliente, a.ativo, a.preco_venda_iva_cent, a.e.preco_depois_fotos, /preço provisório/.test(a.e.nota)], [s.especialidade, 0, 1, 0, true, true], s.sku);
    }
    assert.deepEqual(SEMENTES_SERVICOS_FOTOS.filter((s) => art(s.sku).e.precisa_ited).map((s) => s.sku), ['TOMADA-TV-REDE']);
    assert.deepEqual(SEMENTES_SERVICOS_FOTOS.filter((s) => art(s.sku).e.precisa_projeto).map((s) => s.sku), ['PARA-RAIOS', 'COLUNA-MONTANTE']);
    assert.deepEqual(['VIDEOPORTEIRO-MORADIA', 'ANTENA-TDT', 'MOTOR-PORTAO', 'PARA-RAIOS'].map((k) => art(k).especialidade), ['redes', 'redes', 'domotica', 'geral']);
    // O público (GET /api/catalogo) não os mostra: escondidos até o CEO aprovar as horas dos parceiros e os mostrar.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalogo WHERE visivel_cliente = 1 AND especificacoes LIKE '%servico_fotos%'").get().n, 0);
    db.close();
  });
  test('base existente (56): os pedidos ficam; um SKU que o CEO já criou fica como ele o deixou; a decisão do prédio começa vazia', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (let i = 0; i < 56; i++) { db.exec('BEGIN'); MIGRACOES[i](db); db.exec('COMMIT'); }
    db.exec('PRAGMA user_version = 56');
    db.prepare(`INSERT INTO catalogo (sku, nome, categoria, preco_venda_iva_cent, horas_instalacao, especificacoes, atualizado)
      VALUES ('ANTENA-TDT', 'Antena do CEO', 'outro', 9900, 1.5, '{}', 'x')`).run();
    db.prepare("INSERT INTO orcamentos (origem, nome, servico, estado, criado, atualizado) VALUES ('site', 'Cliente Antigo', 'Outro', 'novo', 'x', 'x')").run();
    const antes = db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
    migrar(db);
    assert.equal(versaoEsquema(db), MIGRACOES.length);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n, antes + SEMENTES_SERVICOS_FOTOS.length - 1);
    assert.deepEqual({ ...db.prepare("SELECT nome, preco_venda_iva_cent, horas_instalacao, especialidade, visivel_cliente FROM catalogo WHERE sku = 'ANTENA-TDT'").get() },
      { nome: 'Antena do CEO', preco_venda_iva_cent: 9900, horas_instalacao: 1.5, especialidade: 'geral', visivel_cliente: 1 });
    assert.deepEqual({ ...db.prepare("SELECT nome, predio_decisao, predio_decisao_em, predio_decisao_por FROM orcamentos WHERE nome = 'Cliente Antigo'").get() },
      { nome: 'Cliente Antigo', predio_decisao: null, predio_decisao_em: null, predio_decisao_por: null });
    assert.throws(() => db.prepare("UPDATE orcamentos SET predio_decisao = 'talvez'").run());
    db.close();
  });
});

describe('proximo-passo: o prédio por decidir (Hoje e ficha dizem o mesmo)', () => {
  const f = (extra = {}) => ({ nome: 'Condomínio X', estado: 'novo', criado: '2026-10-14T10:00:00Z', predio: { decisao: null }, eletricistas: true, trabalhos: [], ...extra });
  test('por decidir: no topo do CEO, com o texto pedido; o comercial vê de quem se espera', () => {
    const p = proximoPasso(f({ validacao_ligada: true, validacao: 'por_validar' }), 'ceo');
    assert.equal(p.tipo, 'decidir_predio');
    assert.equal(p.texto, 'Pedido de orçamento de um prédio: decidir se a Domus o aceita (precisa de projeto e técnico responsável).');
    assert.deepEqual(p.acao, { rotulo: 'Decidir', sec: 'validacao', alvo: 'predio-decisao' });
    assert.ok(p.outros.some((x) => x.tipo === 'validar'), 'a validação fica em "Também por fazer"');
    const hoje = linhasDoHoje(f(), 'ceo', '#/orcamentos/7');
    assert.deepEqual(hoje[0], { tipo: 'decidir_predio', texto: 'Pedido de orçamento de um prédio (Condomínio X): decidir se a Domus o aceita (precisa de projeto e técnico responsável)',
      desde: '2026-10-14T10:00:00Z', ligacao: '#/orcamentos/7' });
    assert.ok(!linhasDoHoje(f(), 'comercial', '#/orcamentos/7').some((x) => x.tipo === 'decidir_predio'));
  });
  test('decidido, perdido, com proposta aceite ou noutro pedido: não aparece', () => {
    for (const x of [f({ predio: { decisao: 'aceite' } }), f({ estado: 'perdido' }), f({ estado: 'proposta_enviada' }), f({ predio: null }), f({ proposta_aceite: 'x' })]) {
      assert.ok(!pendentesDoPedido(x).some((p) => p.tipo === 'decidir_predio'), JSON.stringify(x));
    }
  });
});

describe('ponta a ponta: o pedido entra grátis, vai para a bolsa (menos o prédio) e o CEO decide o prédio', () => {
  let p;
  let seq = 0;
  let red, dom, ger;   // um parceiro de redes, um de domótica e um eletricista de fora, todos em Sintra
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', VALIDACAO_CEO: '1', SITE_URL: 'https://site.teste' } });
    red = await aprovado(['redes']);
    dom = await aprovado(['domotica']);
    ger = await aprovado(null);
  });
  after(() => p.fechar());

  const painel = (metodo, caminho, corpo, papel = 'ceo') => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const ficha = async (id, papel = 'ceo') => { const r = await painel('GET', `orcamentos/${id}`, undefined, papel); assert.equal(r.estado, 200, r.texto); return r.json.orcamento ?? r.json; };
  async function aprovado(especialidades) {
    const n = ++seq;
    const e = { nome: `Eletricista Serviço ${n}`, email: `eletricista.servico.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${7000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    e.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, { acao: 'aprovar' })).estado, 200);
    if (especialidades) assert.equal((await painel('POST', `eletricistas/${e.id}`, { especialidades })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  let conta;
  async function pedido(simulacao) {
    conta = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: conta.cookie, corpo: { ...CLIENTE, servico: 'x', localidade: 'Sintra', simulacao } });
    assert.equal(r.estado, 201, r.texto);   // grátis: nunca "a aguardar pagamento" (202)
    return p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
  }
  const validar = (id, extra = {}) => painel('POST', `orcamentos/${id}/validar`, { pontos: { fotos_servico: true, area: true, contacto: true }, bolsa: true, ...extra });
  const trabalhoDe = (id) => p.app.db.prepare('SELECT * FROM trabalhos_eletricista WHERE orcamento_id = ? ORDER BY id DESC LIMIT 1').get(id) ?? null;
  const hoje = async () => (await painel('GET', 'hoje')).json.itens;

  test('servidor: o funil "servico" leva sempre o pedido de serviço, bem formado; no prédio, o condomínio, os pisos e os fogos', async () => {
    const c = await p.contaConfirmada();
    const enviar = (simulacao) => p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'x', localidade: 'Sintra', simulacao } });
    const base = simServico('antenas', ['antena']);
    const casos = [
      [{ ...base, servico_fotos: undefined }, /Diga que serviço precisa/],
      [{ ...base, servico_fotos: { tipo: 'telhado', opcoes: ['x'] } }, /Serviço inválido/],
      [{ ...base, servico_fotos: { tipo: 'antenas', opcoes: [] } }, /escolha o que precisa/],
      [{ ...base, servico_fotos: { tipo: 'antenas', opcoes: ['coluna'] } }, /escolha o que precisa/],
      [{ ...base, servico_fotos: { tipo: 'antenas', opcoes: ['antena', 'antena'] } }, /escolha o que precisa/],
      [{ ...base, servico_fotos: { tipo: 'antenas', opcoes: ['antena'], descricao: 'x'.repeat(601) } }, /descrição até 600/],
      [{ ...base, servico_fotos: { tipo: 'antenas', opcoes: ['antena'], predio: { nome: 'Cond.', pisos: 2, fogos: 4 } } }, /só vão no pedido de para-raios/],
      [{ ...base, servico_fotos: { tipo: 'predio', opcoes: ['coluna'] } }, /indique o condomínio/],
      [{ ...base, servico_fotos: { tipo: 'predio', opcoes: ['coluna'], predio: { nome: 'C', pisos: 2, fogos: 4 } } }, /entre 2 e 80/],
      [{ ...base, servico_fotos: { tipo: 'predio', opcoes: ['coluna'], predio: { nome: 'Cond.', pisos: 0, fogos: 4 } } }, /pisos entre 1 e 60/],
      [{ ...base, servico_fotos: { tipo: 'predio', opcoes: ['coluna'], predio: { nome: 'Cond.', pisos: 2, fogos: 501 } } }, /fogos entre 1 e 500/],
      [{ ...base, funil: 'planta' }, /só vai no funil "servico"/],
    ];
    for (const [s, re] of casos) {
      const r = await enviar(s);
      assert.equal(r.estado, 400, `${JSON.stringify(s.servico_fotos)} ${r.texto}`);
      assert.match(r.json.erro, re);
    }
  });

  test('videoporteiro: grátis, especialidade redes, validado vai para a bolsa por proposta; o eletricista vê o serviço sem o cliente', async () => {
    const id = await pedido(simServico('videoporteiro', ['instalar']));
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ?').get(id).n, 0, 'sem diagnóstico nem nada pago');
    const o = await ficha(id);
    assert.equal(o.servico, 'x');
    assert.deepEqual([o.especialidade_sugerida, o.servico_fotos.tipo, o.servico_fotos.nome, o.servico_fotos.precisa_projeto, o.servico_fotos.precisa_ited, o.servico_fotos.decisao],
      ['redes', 'videoporteiro', 'Videoporteiro e intercomunicador', false, false, null]);
    assert.deepEqual(o.validacao.pontos.map((x) => x.chave), ['fotos_servico', 'area', 'contacto']);
    assert.equal(o.compras.servico, true);
    const v = await validar(id);
    assert.equal(v.estado, 200, v.texto);
    assert.equal(v.json.aviso, null);
    const t = trabalhoDe(id);
    assert.deepEqual([t.tipo, t.estado, t.modo, t.especialidade], ['visita', 'na_bolsa', 'bolsa', 'redes']);
    // O parceiro de redes vê-o primeiro (24 h); o de domótica e o de fora ainda não.
    const lista = (await area(red, 'GET', 'bolsa')).json.trabalhos;
    const meu = lista.find((x) => x.id === t.id);
    assert.ok(meu, 'o parceiro de redes vê o trabalho');
    assert.deepEqual([meu.titulo, meu.por_proposta, meu.especialidade], ['Visita técnica — Videoporteiro e intercomunicador', true, 'redes']);
    assert.ok(!(await area(dom, 'GET', 'bolsa')).json.trabalhos.some((x) => x.id === t.id));
    const det = await area(red, 'GET', `bolsa/${t.id}`);
    assert.equal(det.estado, 200, det.texto);
    assert.match(det.texto, /Instalar ou trocar o videoporteiro \(moradia\)/);
    assert.ok(!/Carla|Neves|912 345 678|Rua do Exemplo/.test(det.texto), 'nada do cliente antes da escolha');
    // O cliente: sem relatório completo à venda; o pedido diz o serviço e que o preço vem na proposta.
    const pc = (await p.pedir('GET', '/api/conta/pedidos', { cookie: conta.cookie })).json.pedidos.find((x) => x.id === id);
    assert.deepEqual([pc.relatorio, pc.compras.servico], [null, true]);
    assert.equal(pc.resumo.servico, 'Videoporteiro e intercomunicador: Instalar ou trocar o videoporteiro (moradia)');
    assert.match(pc.resumo.inclui[0], /Preço depois de ver as fotos/);
    const basico = await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio-basico`, { cookie: conta.cookie });
    assert.equal(basico.estado, 200, basico.texto);
    assert.deepEqual([basico.json.relatorio.intervalo, basico.json.relatorio.servico], [null, 'Videoporteiro e intercomunicador']);
    assert.match(basico.json.relatorio.nota, /Preço depois de ver as fotos/);
  });

  test('motores e portões: especialidade domótica, na bolsa depois de validado; antenas com tomadas: ficha ITED assinalada', async () => {
    const id = await pedido(simServico('portoes', ['portao', 'bomba']));
    assert.equal((await validar(id)).estado, 200);
    assert.deepEqual([trabalhoDe(id).estado, trabalhoDe(id).especialidade], ['na_bolsa', 'domotica']);
    assert.ok((await area(dom, 'GET', 'bolsa')).json.trabalhos.some((x) => x.id === trabalhoDe(id).id));
    const ited = await pedido(simServico('antenas', ['tomadas', 'antena']));
    const o = await ficha(ited);
    assert.deepEqual([o.especialidade_sugerida, o.servico_fotos.precisa_ited, o.servico_fotos.opcoes], ['redes', true, ['Antena de TV (TDT): instalar ou orientar', 'Tomadas de TV ou de rede novas']]);
    assert.equal((await validar(ited)).estado, 200);
    assert.equal(trabalhoDe(ited).estado, 'na_bolsa');
  });

  let predio;
  test('para-raios: nunca vai sozinho para a bolsa — nem validado, nem por "Pôr na bolsa"; Hoje e ficha dizem para decidir', async () => {
    predio = await pedido(simServico('predio', ['para_raios', 'coluna']));
    const o = await ficha(predio);
    assert.deepEqual([o.especialidade_sugerida, o.servico_fotos.precisa_projeto, o.servico_fotos.predio.texto, o.servico_fotos.predio.nome, o.servico_fotos.decisao],
      ['geral', true, '6 pisos · 12 fogos', 'Condomínio Rua das Flores, 7', null]);
    assert.equal(o.proximo.tipo, 'decidir_predio');
    assert.equal(o.proximo.texto, 'Pedido de orçamento de um prédio: decidir se a Domus o aceita (precisa de projeto e técnico responsável).');
    const linha = (await hoje()).find((x) => x.pedido === predio && x.tipo === 'decidir_predio');
    assert.ok(linha, 'o Hoje do CEO tem a linha');
    assert.equal(linha.texto, `Pedido de orçamento de um prédio (${CLIENTE.nome}): decidir se a Domus o aceita (precisa de projeto e técnico responsável)`);
    assert.equal(linha.ligacao, `#/orcamentos/${predio}`);
    // Validar com a bolsa: fica validado, mas não vai para a bolsa (e diz porquê).
    const v = await validar(predio);
    assert.equal(v.estado, 200, v.texto);
    assert.match(v.json.aviso, /É de um prédio \(precisa de projeto e técnico responsável\): não foi para a bolsa/);
    assert.equal(trabalhoDe(predio), null);
    assert.equal((await ficha(predio)).validacao.estado, 'validado');
    assert.ok((await hoje()).some((x) => x.pedido === predio && x.tipo === 'decidir_predio'), 'validado, continua por decidir');
    // "Pôr na bolsa" e "Atribuir a…" também não.
    const bolsa = await painel('POST', `orcamentos/${predio}/eletricista`, { acao: 'bolsa' });
    assert.equal(bolsa.estado, 409);
    assert.match(bolsa.json.erro, /decida primeiro se a Domus Energia o aceita/);
    assert.equal((await painel('POST', `orcamentos/${predio}/eletricista`, { acao: 'atribuir', eletricista_id: ger.id })).estado, 409);
    const at = (await painel('GET', `orcamentos/${predio}/eletricista`)).json;
    assert.deepEqual([at.pode, /decida primeiro/.test(at.motivo)], [false, true]);
    // O cliente: pedido de orçamento, a empresa decide.
    const pc = (await p.pedir('GET', '/api/conta/pedidos', { cookie: conta.cookie })).json.pedidos.find((x) => x.id === predio);
    assert.match(pc.estado_texto ?? pc.estadoTexto ?? JSON.stringify(pc), /precisa de projeto e técnico responsável/);
  });

  test('o CEO aceita o prédio: sai do Hoje e só então vai para a bolsa (geral); decidir outra vez dá 409; só o CEO', async () => {
    assert.equal((await painel('POST', `orcamentos/${predio}/predio`, { aceita: true }, 'comercial')).estado, 403);
    assert.equal((await painel('POST', `orcamentos/${predio}/predio`, {})).estado, 400);
    const r = await painel('POST', `orcamentos/${predio}/predio`, { aceita: true });
    assert.equal(r.estado, 200, r.texto);
    const o = r.json.orcamento ?? r.json;
    assert.deepEqual([o.servico_fotos.decisao.estado, o.servico_fotos.decisao.por, o.estado], ['aceite', p.u.ceo.email, 'novo']);
    assert.notEqual(o.proximo.tipo, 'decidir_predio');
    assert.ok(!(await hoje()).some((x) => x.pedido === predio && x.tipo === 'decidir_predio'));
    assert.equal((await painel('POST', `orcamentos/${predio}/predio`, { aceita: false })).estado, 409);
    const bolsa = await painel('POST', `orcamentos/${predio}/eletricista`, { acao: 'bolsa' });
    assert.equal(bolsa.estado, 200, bolsa.texto);
    assert.deepEqual([trabalhoDe(predio).tipo, trabalhoDe(predio).estado, trabalhoDe(predio).especialidade], ['visita', 'na_bolsa', 'geral']);
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'predio_aceite' AND alvo = ?").get(`orcamento:${predio}`));
  });

  test('o CEO não aceita outro prédio: fica perdido, com o motivo; o cliente vê-o; num pedido que não é de prédio dá 409', async () => {
    const id = await pedido(simServico('predio', ['coluna']));
    const r = await painel('POST', `orcamentos/${id}/predio`, { aceita: false, motivo: 'Sem técnico responsável disponível este mês.' });
    assert.equal(r.estado, 200, r.texto);
    const o = r.json.orcamento ?? r.json;
    assert.deepEqual([o.estado, o.servico_fotos.decisao.estado, o.motivo_perda_tipo], ['perdido', 'recusado', 'outro']);
    assert.match(o.motivo_perda, /^Prédio: a Domus Energia não aceitou o pedido \(precisa de projeto e técnico responsável\)\. Sem técnico/);
    assert.ok(!(await hoje()).some((x) => x.pedido === id));
    const pc = (await p.pedir('GET', '/api/conta/pedidos', { cookie: conta.cookie })).json.pedidos.find((x) => x.id === id);
    assert.match(JSON.stringify(pc), /de momento não fazemos este trabalho no seu prédio/);
    const outro = await pedido(simServico('antenas', ['antena']));
    assert.equal((await painel('POST', `orcamentos/${outro}/predio`, { aceita: true })).estado, 409);
  });
});

describe('com os pagamentos online ligados: o serviço com fotos continua grátis, sem relatório completo à venda', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', PROPOSTAS_BOLSA: '1', SITE_URL: 'https://site.teste' } }); });
  after(() => p.fechar());
  test('enviar dá 201 (não 202), sem pagamento; comprar o relatório completo dá 409', async () => {
    const conta = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: conta.cookie, corpo: { ...CLIENTE, servico: 'x', localidade: 'Sintra', simulacao: simServico('portoes', ['portao']), compra: 'pormenorizado' } });
    assert.equal(r.estado, 201, r.texto);
    const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE orcamento_id = ? AND estado != 'cancelado'").get(id).n, 0);
    const c = await p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: conta.cookie, corpo: { fase: 'relatorio_pormenorizado' } });
    assert.equal(c.estado, 409, c.texto);
    assert.match(c.json.erro, /não há relatório completo/);
  });
});
