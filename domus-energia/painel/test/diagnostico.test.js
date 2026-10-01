// Diagnóstico de avarias (decisão do dono; docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): o conteúdo
// (public/ecras/diagnostico-conteudo.js), a validação (validar.js diagnostico), a rota POST orcamentos/:id/diagnostico
// (CEO e comercial; auditoria), a migração 18 e o relatório do cliente: só o pormenorizado leva o diagnóstico, nunca o
// básico.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { diagnostico as validarDiagnostico } from '../src/validar.js';
import { abrirDb, versaoEsquema } from '../src/db.js';
import {
  SEGURANCA, SINAIS, FERRAMENTAS, PASSOS, TECNICAS, TIPOS_AVARIA, VALORES, PARAR, PROBLEMAS, CHECKLIST, CHAVES_CHECKLIST, CHAVES_VALOR,
  NOME_TIPO, sugestoesPara,
} from '../public/ecras/diagnostico-conteudo.js';
import { AVARIA_PROBLEMA } from '../src/validar.js';

const DIAG = { verificacoes: ['isolado', 'visual', 'tensao', 'continuidade'], valores: { tensao: 231.4, continuidade: 0.3 }, tipo: 'aberto', conclusao: 'Borne do neutro solto na tomada da cozinha.\nApertado e testado.' };
const SIM_REPARAR = { versao: 1, funil: 'avaria', avaria: { onde: ['cozinha'], problema: ['sem_corrente', 'disjuntor'], descricao: 'A tomada não dá nada' }, casa: { localidade: 'Sintra' }, itens: [], divisoes: [] };

test('conteúdo: 3 passos, 8 técnicas, 4 tipos, os 7 problemas do simulador, lista de verificação e valores com fonte', () => {
  assert.equal(PASSOS.length, 3);
  assert.ok(PASSOS.every((p) => p.passos.length >= 3));
  assert.equal(TECNICAS.length, 8);
  assert.ok(TECNICAS.every((t) => t.nome && t.oQue && t.quando && t.ferramenta));
  assert.deepEqual(TIPOS_AVARIA.map((t) => t.chave), ['aberto', 'curto', 'terra', 'sobrecarga']);
  assert.ok(TIPOS_AVARIA.every((t) => t.causas && t.sintomas && t.teste && t.protecao && ['baixo', 'médio', 'alto'].includes(t.perigo)));
  assert.deepEqual(Object.keys(NOME_TIPO), ['aberto', 'curto', 'terra', 'sobrecarga', 'outro']);
  assert.deepEqual(Object.keys(PROBLEMAS).sort(), [...AVARIA_PROBLEMA].sort(), 'uma entrada por escolha do passo Avaria');
  for (const p of Object.values(PROBLEMAS)) assert.ok(p.tipos.every((t) => NOME_TIPO[t]) && p.verificar.length > 40);
  assert.ok(SEGURANCA.length >= 4 && SINAIS.length >= 4 && FERRAMENTAS.length >= 4 && PARAR.length >= 3);
  assert.equal(new Set(CHAVES_CHECKLIST).size, CHECKLIST.length);
  assert.deepEqual(CHAVES_VALOR, ['rcd', 'tensao', 'continuidade', 'isolamento']);
  // Valores: os da RTIEBT citam o artigo; os outros vão marcados "referência prática".
  for (const v of VALORES) assert.ok(/^RTIEBT /.test(v.fonte) || v.fonte === 'referência prática', v.medicao);
  const fonte = (re) => VALORES.find((v) => re.test(v.medicao)).fonte;
  assert.match(fonte(/isolamento/), /612\.3/);
  assert.match(fonte(/condutor de proteção/), /612\.2/);
  assert.match(fonte(/terra das massas/), /801\.5\.6\.1/);
  assert.match(fonte(/diferencial/), /Anexo B/);
  assert.equal(fonte(/Tensão de alimentação/), 'referência prática');
  assert.equal(fonte(/Continuidade de um condutor/), 'referência prática');
  // Sugestões: sem repetir, com os nomes dos tipos; chaves desconhecidas e uma string só caem bem.
  const s = sugestoesPara(['disjuntor', 'disjuntor', 'x', 'choque']);
  assert.deepEqual(s.map((x) => x.chave), ['disjuntor', 'choque']);
  assert.deepEqual(s[0].tiposNome, ['Sobrecarga', 'Curto-circuito']);
  assert.deepEqual(sugestoesPara('luz').map((x) => x.chave), ['luz']);
  assert.deepEqual(sugestoesPara(null), []);
});

test('validar.js diagnostico: limpa e ordena; recusa chaves, valores, tipos e conclusões inválidos', () => {
  const d = validarDiagnostico({ ...DIAG, verificacoes: ['continuidade', 'isolado', 'tensao', 'visual'], valores: { tensao: '231,4', continuidade: 0.3, rcd: '' } });
  assert.deepEqual(d, { verificacoes: ['isolado', 'visual', 'tensao', 'continuidade'], valores: { tensao: 231.4, continuidade: 0.3 }, tipo: 'aberto', conclusao: DIAG.conclusao });
  assert.deepEqual(validarDiagnostico({}), { verificacoes: [], valores: {}, tipo: null, conclusao: null });
  const mau = (x, re = /Diagnóstico/) => assert.throws(() => validarDiagnostico({ ...DIAG, ...x }), re, JSON.stringify(x));
  mau({ extra: 1 }, /campo desconhecido/);
  mau({ verificacoes: ['isolado', 'isolado'] }, /sem repetir/);
  mau({ verificacoes: ['voar'] }, /chaves conhecidas/);
  mau({ verificacoes: 'isolado' });
  mau({ valores: { visual: 1 } }, /medição desconhecida/);
  mau({ valores: { tensao: -1 } }, /entre 0 e 1000/);
  mau({ valores: { tensao: 'abc' } }, /tem de ser um número/);
  mau({ valores: [1] });
  mau({ tipo: 'fantasma' }, /tipo de avaria inválido/);
  mau({ conclusao: 'x'.repeat(2001) }, /demasiado longo/);
  mau({ conclusao: 12 }, /tem de ser texto/);
  assert.throws(() => validarDiagnostico(null), /Diagnóstico/);
  assert.throws(() => validarDiagnostico([]), /Diagnóstico/);
});

test('migração 18: orcamentos.diagnostico', () => {
  const db = abrirDb(':memory:');
  assert.ok(versaoEsquema(db) >= 18);
  assert.ok(db.prepare('PRAGMA table_info(orcamentos)').all().some((c) => c.name === 'diagnostico'));
  db.close();
});

describe('POST /painel/api/orcamentos/:id/diagnostico', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());
  const api = (metodo, caminho, papel, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { corpo, cookie: p.cookies[papel] });

  test('guarda (limpo, com data e autor), devolve a ficha, fica na auditoria; null apaga; 400/403/404', async () => {
    const o = (await api('POST', 'orcamentos', 'ceo', { nome: 'Rui Avaria', telefone: '912345678', localidade: 'Oeiras', servico: 'Reparação' })).json;
    const id = o.id ?? o.orcamento?.id;
    assert.ok(id, JSON.stringify(o));
    assert.equal((await api('GET', `orcamentos/${id}`, 'ceo')).json.diagnostico, null, 'sem diagnóstico');
    let r = await api('POST', `orcamentos/${id}/diagnostico`, 'comercial', { diagnostico: { ...DIAG, valores: { ...DIAG.valores, rcd: null } } });
    assert.equal(r.estado, 200, r.texto);
    const d = r.json.diagnostico;
    assert.deepEqual(d.verificacoes, DIAG.verificacoes);
    assert.deepEqual(d.valores, DIAG.valores);
    assert.equal(d.tipo, 'aberto');
    assert.equal(d.conclusao, DIAG.conclusao);
    assert.equal(d.por, p.u.comercial.email);
    assert.match(d.data, /^\d{4}-\d{2}-\d{2}T/);
    const g = await api('GET', `orcamentos/${id}`, 'ceo');
    assert.deepEqual(g.json.diagnostico.verificacoes, DIAG.verificacoes, 'a ficha completa traz o diagnóstico');
    const h = g.json.historico.find((x) => x.acao === 'diagnostico_atualizado');
    assert.ok(h, 'auditoria "Diagnóstico atualizado"');
    assert.deepEqual(h.detalhes, { verificacoes: 4, tipo: 'aberto', conclusao: true });
    // Inválidos: 400 sem mexer no que está guardado.
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { diagnostico: { ...DIAG, extra: 1 } })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { diagnostico: { verificacoes: ['nada'] } })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { diagnostico: { valores: { tensao: 5000 } } })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { outro: 1 })).estado, 400);
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'tecnico', { diagnostico: DIAG })).estado, 403);
    assert.equal((await api('POST', 'orcamentos/999/diagnostico', 'ceo', { diagnostico: DIAG })).estado, 404);
    assert.deepEqual((await api('GET', `orcamentos/${id}`, 'ceo')).json.diagnostico.valores, DIAG.valores, 'os 400 não mexeram');
    // Na base fica JSON; null apaga e fica na auditoria.
    assert.deepEqual(JSON.parse(p.app.db.prepare('SELECT diagnostico FROM orcamentos WHERE id = ?').get(id).diagnostico).tipo, 'aberto');
    r = await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { diagnostico: null });
    assert.equal(r.estado, 200);
    assert.equal(r.json.diagnostico, null, 'apagado');
    const apagado = (await api('GET', `orcamentos/${id}`, 'ceo')).json.historico.filter((x) => x.acao === 'diagnostico_atualizado');
    assert.deepEqual(apagado.at(-1).detalhes, { apagado: true });
  });

  test('relatório do cliente: o diagnóstico vai só no pormenorizado (sem o autor), nunca no básico; o técnico do painel também o tem', async () => {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Avaria', telefone: '912 000 111', servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_REPARAR } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    const semDiag = (await api('GET', `orcamentos/${id}/relatorio-cliente`, 'ceo')).json.relatorio;
    assert.equal(semDiag.diagnostico, null, 'sem diagnóstico: null no pormenorizado');
    assert.equal((await api('POST', `orcamentos/${id}/diagnostico`, 'ceo', { diagnostico: DIAG })).estado, 200);
    const rc = (await api('GET', `orcamentos/${id}/relatorio-cliente`, 'ceo')).json.relatorio;
    assert.deepEqual(rc.diagnostico.verificacoes.map((v) => v.chave), DIAG.verificacoes);
    assert.deepEqual(rc.diagnostico.verificacoes.find((v) => v.chave === 'tensao'), { chave: 'tensao', nome: CHECKLIST.find((x) => x.chave === 'tensao').nome, medido: 231.4, unidade: 'V' });
    assert.deepEqual(rc.diagnostico.verificacoes.find((v) => v.chave === 'visual').medido, null);
    assert.equal(rc.diagnostico.tipo_nome, 'Circuito aberto');
    assert.equal(rc.diagnostico.conclusao, DIAG.conclusao);
    assert.equal(rc.diagnostico.por, undefined, 'o cliente não vê quem o fez');
    const b = await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio-basico`, { cookie: c.cookie });
    assert.equal(b.estado, 200, b.texto);
    assert.equal(b.json.relatorio.diagnostico, undefined, 'o básico não leva o diagnóstico');
    assert.doesNotMatch(b.texto, /Borne do neutro|Circuito aberto|diagnostico/);
    // A ficha do painel (GET orcamentos/:id) traz a simulação da avaria e o diagnóstico com o autor.
    const f = (await api('GET', `orcamentos/${id}`, 'ceo')).json;
    assert.deepEqual(f.simulacao.avaria.problema, ['sem_corrente', 'disjuntor']);
    assert.equal(f.diagnostico.por, p.u.ceo.email);
  });
});
