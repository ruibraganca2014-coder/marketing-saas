// App de diagnóstico (decisões do dono, 2026-10-24; web/diagnostico.html, web/diagnostico/*, src/diagnosticos.js):
// - as árvores (estrutura válida, referência ao manual em todos os nós, fins com causa e ação, passos de valor com unidade e
//   limite, sem becos sem saída nem ciclos) e o motor (avaliar, percurso, ficha);
// - as rotas: eletricista aprovado (/api/eletricista/diagnosticos*) e equipa do painel (/painel/api/diagnosticos*), cada um os
//   seus, o CEO todos; cliente, anónimo, outra área e o módulo desligado → 404; sincronização idempotente; ligar a um
//   trabalho de avaria e "Enviar para a ficha"; fotos (tipo, tamanho, número); RGPD; migração 60.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { painelComEquipa } from './ajuda.js';
import { MIGRACOES, migrar, versaoEsquema } from '../src/db.js';
import { diagnostico as validarDiagnostico } from '../src/validar.js';
import { FOTO_MAX_BYTES } from '../src/fotos.js';
import { FOTOS_POR_DIAGNOSTICO, REGRAS_OURO as REGRAS_SERVIDOR, EPI as EPI_SERVIDOR, SINAIS_PERIGO as SINAIS_SERVIDOR, TIPOS_AVARIA as TIPOS_SERVIDOR } from '../src/diagnosticos.js';
import { CHECKLIST, NOME_TIPO, MAX_CONCLUSAO as MAX_CONCLUSAO_PAINEL } from '../public/ecras/diagnostico-conteudo.js';
import { MANUAL_BT } from '../../web/manual-bt.js';
import { ARVORES, arvorePorId, VERSAO_ARVORES } from '../../web/diagnostico/arvores.js';
import {
  validarArvore, avaliar, seguinte, atual, responder, fimDe, paraFicha, textoLimite, lerNumero, novoId, noDe, variaveis,
  EPI, REGRAS_OURO, SINAIS_PERIGO, FICHA_VALORES, FICHA_VERIFICACOES, TIPOS_AVARIA, MAX_CONCLUSAO, ID_APOIO, FIM_APOIO, PARAR_ISOLAR, capitulosDoManual,
} from '../../web/diagnostico/motor.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const DESCONHECIDO = { erro: 'Endereço desconhecido.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const IDS = ARVORES.map((a) => a.id);

// ---------------------------------------------------------------- árvores e motor
/** Todos os caminhos do início até um fim (com a resposta de cada passo). */
function caminhos(a) {
  const out = [];
  const ir = (id, visto) => {
    const no = a.nos[id];
    if (no.tipo === 'fim') { out.push([...visto, id]); return; }
    const prox = no.tipo === 'simnao' ? [no.sim, no.nao] : no.tipo === 'escolha' ? no.opcoes.map((o) => o.seguinte)
      : no.tipo === 'dado' ? [no.seguinte] : [no.dentro, no.fora, no.aviso, no.abaixo, no.acima].filter(Boolean);
    for (const s of prox) ir(s, [...visto, id]);
  };
  ir(a.inicio, []);
  return out;
}

describe('árvores de diagnóstico: estrutura', () => {
  test('ronda 1: as 10 árvores pedidas pelo dono, ids únicos, versionadas; o validador não encontra erros', () => {
    assert.deepEqual(IDS, ['diferencial', 'disjuntor', 'sem-corrente', 'sem-energia', 'luzes', 'aquecimento', 'choque', 'terra', 'isolamento', 'motor']);
    assert.equal(new Set(IDS).size, IDS.length);
    assert.ok(Number.isInteger(VERSAO_ARVORES) && VERSAO_ARVORES >= 1);
    for (const a of ARVORES) assert.deepEqual(validarArvore(a, { manual: MANUAL_BT, arvores: IDS }), [], a.id);
    // O diferencial cobre as quatro situações pedidas; o disjuntor as duas.
    assert.deepEqual(arvorePorId('diferencial').nos.quando.opcoes.map((o) => o.texto),
      ['Sempre, logo ao rearmar', 'Quando se liga um aparelho', 'Com chuva ou humidade', 'Com trovoada', 'Ao acaso, sem padrão']);
    assert.match(arvorePorId('disjuntor').nos.quando.opcoes.map((o) => o.texto).join('|'), /Logo ao ligar.*Ao fim de algum tempo/);
    assert.match(JSON.stringify(arvorePorId('sem-energia')), /DCP/);
  });

  test('cada nó tem referência ao manual (capítulo e página dentro do capítulo); os caps. 10, 11, 16 e 20 estão todos', () => {
    const caps = capitulosDoManual(MANUAL_BT);
    const usados = new Set();
    for (const a of ARVORES) {
      for (const [id, no] of Object.entries(a.nos)) {
        const refs = Array.isArray(no.ref) ? no.ref : [no.ref];
        assert.ok(refs.length && refs.every((r) => r && r.cap && Number.isInteger(r.pagina)), `${a.id}.${id}`);
        for (const r of refs) {
          const n = r.cap.split('.')[0];
          const c = caps.find((x) => x.n === (/^\d$/.test(n) ? `0${n}` : n));
          assert.ok(c && r.pagina >= c.de && r.pagina <= c.ate, `${a.id}.${id}: ${r.cap} p. ${r.pagina}`);
          usados.add(c.n);
        }
      }
    }
    for (const n of ['10', '11', '16', '20', 'B4', 'B5']) assert.ok(usados.has(n), `capítulo ${n}`);
  });

  test('sem becos sem saída: todos os caminhos acabam num fim com causa, ação e tipo de avaria; os de valor têm unidade e limite com fonte', () => {
    let fins = 0;
    for (const a of ARVORES) {
      const todos = caminhos(a);
      assert.ok(todos.length >= 5, a.id);
      for (const c of todos) {
        const fim = a.nos[c.at(-1)];
        assert.equal(fim.tipo, 'fim');
        assert.ok(fim.causa.length >= 10 && fim.acao.length >= 10 && TIPOS_AVARIA.includes(fim.tipoAvaria), `${a.id}.${c.at(-1)}`);
      }
      for (const [id, no] of Object.entries(a.nos)) {
        if (no.tipo === 'fim') { fins++; if (no.seguir) assert.ok(arvorePorId(no.seguir), `${a.id}.${id} segue para ${no.seguir}`); continue; }
        if (no.tipo === 'valor') {
          assert.ok(['V', 'A', 'Ω', 'MΩ', 'ms', '%'].includes(no.unidade), `${a.id}.${id}`);
          assert.ok(textoLimite(no, { In: 16 }).length > 2 && no.limite.fonte.length > 10, `${a.id}.${id}`);
          assert.ok(no.dentro && no.fora);
        }
        if (no.ficha?.valor) assert.equal(FICHA_VALORES[no.ficha.valor], no.unidade, `${a.id}.${id}`);
      }
    }
    assert.ok(fins >= 100, `${fins} fins`);
  });

  test('o validador apanha os erros: nó inexistente, ciclo, sem referência, fim sem ação, valor sem limite, variável não pedida', () => {
    const base = () => structuredClone(arvorePorId('disjuntor'));
    const erros = (a) => validarArvore(a, { manual: MANUAL_BT, arvores: IDS }).join(' | ');
    let a = base(); a.nos.sem_aparelhos.sim = 'nao_existe'; assert.match(erros(a), /não existe/);
    a = base(); a.nos.aparelho_um.nao = 'sem_aparelhos'; assert.match(erros(a), /ciclo/);
    a = base(); delete a.nos.sem_aparelhos.ref; assert.match(erros(a), /referência/);
    a = base(); a.nos.fim_sobrecarga.acao = ''; assert.match(erros(a), /fim sem ação/);
    a = base(); delete a.nos.corrente.limite; assert.match(erros(a), /limite/);
    a = base(); a.nos.corrente.unidade = 'kW'; assert.match(erros(a), /unidade/);
    a = base(); a.nos.quando.opcoes[0].seguinte = 'corrente'; assert.match(erros(a), /compara com "In"/);
    a = base(); a.nos.sem_aparelhos.ref = { cap: '20.2', pagina: 40 }; assert.match(erros(a), /fora do capítulo/);
    a = base(); a.nos.solto = { tipo: 'simnao', texto: 'Nó sem ligação', ref: { cap: '20.2', pagina: 116 }, sim: 'fim_curva', nao: 'fim_curva' }; assert.match(erros(a), /inalcançável/);
    a = base(); a.nos.iso_curto.ficha = { verificacao: 'isolamento', valor: 'tensao' }; assert.match(erros(a), /é em V/);
  });

  test('a barreira de segurança e os sinais de perigo: as chaves do servidor são as da app; textos do manual (B4.4, B5)', () => {
    assert.deepEqual(REGRAS_OURO.map((r) => r.chave), REGRAS_SERVIDOR);
    assert.deepEqual(EPI.map((r) => r.chave), EPI_SERVIDOR);
    assert.deepEqual(SINAIS_PERIGO.map((r) => r.chave), SINAIS_SERVIDOR);
    assert.deepEqual(TIPOS_AVARIA, TIPOS_SERVIDOR);
    assert.match(REGRAS_OURO.find((r) => r.chave === 'verificar').texto, /bipolar testado antes e depois/);
    assert.deepEqual(SINAIS_PERIGO.map((s) => s.texto.split(' ')[0]), ['Cheiro', 'Água', 'Aquecimento', 'Faíscas,', 'Cabo']);
    assert.ok(PARAR_ISOLAR.passos.some((p) => /112/.test(p)));
    assert.equal(FIM_APOIO.parar, true);
  });

  test('a ficha: as verificações, as unidades e os tipos da app são os da lista de verificação do painel', () => {
    assert.deepEqual(FICHA_VERIFICACOES, CHECKLIST.map((c) => c.chave));
    assert.deepEqual(FICHA_VALORES, Object.fromEntries(CHECKLIST.filter((c) => c.valor).map((c) => [c.chave, c.valor.unidade])));
    assert.deepEqual(TIPOS_AVARIA, Object.keys(NOME_TIPO));
    assert.equal(MAX_CONCLUSAO, MAX_CONCLUSAO_PAINEL);
  });
});

describe('motor do diagnóstico', () => {
  const dif = arvorePorId('diferencial');
  const disj = arvorePorId('disjuntor');

  test('avaliar: mínimo com aviso (isolamento), máximo com variável (corrente), abaixo (terra), entre com abaixo/acima (tensão)', () => {
    const iso = dif.nos.iso_circuito;
    assert.deepEqual([avaliar(iso, 0.3), avaliar(iso, 0.5), avaliar(iso, 0.8), avaliar(iso, 1), avaliar(iso, 250)], ['fora', 'aviso', 'aviso', 'dentro', 'dentro']);
    assert.equal(textoLimite(iso), '≥ 0,5 MΩ (objetivo ≥ 1 MΩ)');
    const cor = disj.nos.corrente;
    assert.deepEqual([avaliar(cor, 16, { In: 16 }), avaliar(cor, 16.1, { In: 16 })], ['dentro', 'fora']);
    assert.equal(textoLimite(cor, { In: 16 }), '≤ 16 A');
    const terra = arvorePorId('terra').nos.medir;
    assert.deepEqual([avaliar(terra, 99.9), avaliar(terra, 100)], ['dentro', 'fora'], 'terra: < 100 Ω');
    const ent = arvorePorId('sem-energia').nos.tensao_entrada;
    assert.deepEqual([avaliar(ent, 0), avaliar(ent, 230), avaliar(ent, 253), avaliar(ent, 380)], ['fora', 'dentro', 'dentro', 'acima']);
    assert.equal(seguinte(ent, { chave: 'v', valor: 380 }), 'fim_sobretensao');
    assert.equal(seguinte(ent, { chave: 'v', valor: 0 }), 'dcp');
    assert.equal(seguinte(ent, { chave: 'nao_sei' }), ID_APOIO);
    assert.equal(seguinte(ent, { chave: 'v', valor: -1 }), null);
    assert.deepEqual([lerNumero('0,35'), lerNumero(' 230 '), lerNumero(''), Number.isNaN(lerNumero('abc'))], [0.35, 230, null, true]);
    assert.match(novoId(), /^[a-f0-9]{32}$/);
  });

  test('percurso: diferencial que dispara sempre → isolamento fora do limite → troço encontrado; voltar atrás; ficha válida no servidor', () => {
    const passos = [];
    const r = (resp) => { const x = responder(dif, passos, resp, '2026-10-24T10:00:00.000Z'); passos.push(x.passo); return x.seguinte; };
    assert.equal(r({ chave: 'o0' }), 'isolar_grupo');
    assert.equal(r({ chave: 'sim' }), 'um_a_um');
    assert.equal(r({ chave: 'o0' }), 'circuito_aparelhos');
    assert.equal(r({ chave: 'sim' }), 'iso_circuito');
    assert.throws(() => responder(dif, passos, { chave: 'v', valor: Number.NaN }), /número/);
    assert.equal(r({ chave: 'v', valor: 0.12 }), 'localizar_troco');
    assert.deepEqual([passos.at(-1).avaliacao, passos.at(-1).resposta, passos.at(-1).limite], ['fora', '0,12 MΩ', '≥ 0,5 MΩ (objetivo ≥ 1 MΩ)']);
    // Voltar atrás = tirar o último passo.
    assert.equal(atual(dif, passos.slice(0, -1)), 'iso_circuito');
    assert.equal(r({ chave: 'sim' }), 'fim_iso_troco');
    const fim = fimDe(dif, passos);
    assert.equal(fim.tipoAvaria, 'terra');
    assert.throws(() => responder(dif, passos, { chave: 'sim' }), /fim/);
    const diag = { seguranca: { regras: REGRAS_OURO.map((x) => x.chave) }, passos, causa: fim.causa, acao: fim.acao, tipo: fim.tipoAvaria, nota: 'Caixa da varanda com água.' };
    const f = paraFicha(dif, diag);
    assert.deepEqual(f.verificacoes, ['isolado', 'visual', 'isolamento']);
    assert.deepEqual(f.valores, { isolamento: 0.12 });
    assert.equal(f.tipo, 'terra');
    assert.match(f.conclusao, /^Causa provável: Defeito de isolamento.*\nAção: .*\nNota: Caixa da varanda com água\.$/s);
    assert.deepEqual(validarDiagnostico(f), f, 'o servidor aceita a ficha tal e qual');
    // "Não sei" vai para o fim de apoio (parar e chamar apoio).
    const p2 = [];
    p2.push(responder(dif, p2, { chave: 'nao_sei' }).passo);
    assert.equal(fimDe(dif, p2), FIM_APOIO);
    assert.equal(noDe(dif, atual(dif, p2)).parar, true);
  });

  test('variáveis: o calibre escolhido entra no limite da corrente; os passos "dado" (chapa do motor) também', () => {
    const passos = [];
    for (const resp of [{ chave: 'o1' }, { chave: 'o2' }]) passos.push(responder(disj, passos, resp).passo);
    assert.deepEqual(variaveis(disj, passos), { In: 16 });
    const x = responder(disj, passos, { chave: 'v', valor: 21.5 });
    assert.deepEqual([x.seguinte, x.passo.avaliacao, x.passo.limite], ['fim_sobrecarga', 'fora', '≤ 16 A']);
    const motor = arvorePorId('motor');
    const pm = [];
    for (const resp of [{ chave: 'o1' }, { chave: 'o1' }, { chave: 'v', valor: 8.4 }]) pm.push(responder(motor, pm, resp).passo);
    assert.equal(atual(motor, pm), 'corrente');
    assert.equal(responder(motor, pm, { chave: 'v', valor: 9 }).seguinte, 'fim_sobrecarga_motor');
    // A conclusão nunca passa o máximo da ficha.
    const longa = paraFicha(disj, { passos: [], causa: 'x'.repeat(1500), acao: 'y'.repeat(1500), tipo: 'curto' });
    assert.equal(longa.conclusao.length, MAX_CONCLUSAO);
  });
});

// ---------------------------------------------------------------- servidor
test('migração 60: as tabelas diagnosticos e diagnosticos_fotos, com as chaves e as verificações', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrar(db);
  assert.equal(versaoEsquema(db), MIGRACOES.length);
  assert.ok(MIGRACOES.length >= 60);
  const agora = '2026-10-24T10:00:00.000Z';
  const ins = db.prepare(`INSERT INTO diagnosticos (id, origem, arvore, arvore_versao, titulo, estado, seguranca, iniciado, criado, atualizado)
    VALUES (?, 'painel', 'diferencial', 1, 'O diferencial dispara', ?, '{}', ?, ?, ?)`);
  ins.run('a'.repeat(32), 'em_curso', agora, agora, agora);
  assert.throws(() => ins.run('b'.repeat(31), 'em_curso', agora, agora, agora), /CHECK/);
  assert.throws(() => ins.run('c'.repeat(32), 'outro', agora, agora, agora), /CHECK/);
  const foto = db.prepare("INSERT INTO diagnosticos_fotos (id, diagnostico_id, tipo_mime, bytes, criado) VALUES (?, ?, 'image/jpeg', 10, ?)");
  foto.run('d'.repeat(24), 'a'.repeat(32), agora);
  assert.throws(() => foto.run('e'.repeat(24), 'f'.repeat(32), agora), /FOREIGN KEY/);
  db.prepare('DELETE FROM diagnosticos').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM diagnosticos_fotos').get().n, 0, 'as fotos saem com o diagnóstico');
  db.close();
});

const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'disjuntor', descricao: 'O diferencial dispara' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const CLIENTE = { nome: 'Teresa Diagnóstico Cliente', telefone: '912 345 678', morada: 'Rua do Teste, 1' };

/** Um diagnóstico como a app o envia (concluído pelo percurso do diferencial, isolamento fora do limite). */
function registo(extra = {}) {
  const a = arvorePorId('diferencial');
  const passos = [];
  for (const resp of [{ chave: 'o0' }, { chave: 'sim' }, { chave: 'o0' }, { chave: 'sim' }, { chave: 'v', valor: 0.12 }, { chave: 'sim' }]) passos.push(responder(a, passos, resp).passo);
  const fim = fimDe(a, passos);
  return {
    id: novoId(), arvore: a.id, arvore_versao: a.versao, titulo: a.titulo, estado: 'concluido',
    seguranca: { epi: EPI.map((x) => x.chave), regras: REGRAS_OURO.map((x) => x.chave), quando: new Date().toISOString() },
    passos, causa: fim.causa, acao: fim.acao, tipo: fim.tipoAvaria, perigo: null, nota: 'Caixa exterior com água.',
    iniciado: new Date().toISOString(), terminado: new Date().toISOString(), ...extra,
  };
}

describe('app de diagnóstico: rotas, permissões, sincronização, ficha, fotos e RGPD', () => {
  let p;
  let seq = 0;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  const painel = (metodo, caminho, papel, corpo, extra = {}) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo, ...extra });
  const area = (e, metodo, caminho, corpo, extra = {}) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e?.cookie, corpo, ...extra });
  async function aprovado(extra = {}) {
    const n = ++seq;
    const c = { nome: `Eletricista Diagnóstico ${n}`, email: `diag${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${3000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `eletricistas/${id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...c, id, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Uma avaria paga pelo cliente, atribuída a `e`, com a visita marcada: {id (pedido), tid (trabalho), conta}. */
  async function avariaDe(e) {
    const conta = await p.contaConfirmada();
    const av = await p.pedir('POST', '/api/orcamento', { cookie: conta.cookie, corpo: { ...CLIENTE, servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA } });
    assert.equal(av.estado, 202, av.texto);
    const pago = await p.pedir('POST', `/api/conta/pagamentos/${av.json.pagamento.ref}/simular`, { cookie: conta.cookie, corpo: { resultado: 'sucesso' } });
    const id = pago.json.pagamento.orcamento_id;
    const a = await painel('POST', `orcamentos/${id}/eletricista`, 'ceo', { acao: 'atribuir', eletricista_id: e.id });
    assert.equal(a.estado, 200, a.texto);
    const tid = a.json.trabalho.id;
    assert.equal((await area(e, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    return { id, tid, conta };
  }

  test('quem entra: eletricista aprovado e qualquer papel do painel; anónimo, cliente, cookie inventado e a sessão da outra área → 404', async () => {
    const e = await aprovado();
    assert.equal((await area(e, 'GET', 'diagnosticos')).estado, 200);
    for (const papel of ['ceo', 'tecnico', 'comercial']) assert.equal((await painel('GET', 'diagnosticos', papel)).estado, 200, papel);
    const cliente = await p.contaConfirmada();
    const d = registo();
    for (const [cookie, quem] of [[undefined, 'anónimo'], [cliente.cookie, 'cliente'], ['domus_eletricista=' + 'a'.repeat(43), 'inventado'], [p.cookies.ceo, 'sessão do painel']]) {
      for (const [m, c, corpo] of [['GET', 'diagnosticos'], ['POST', 'diagnosticos', d], ['GET', `diagnosticos/${d.id}`], ['POST', `diagnosticos/${d.id}/ficha`, { diagnostico: {} }],
        ['GET', `diagnosticos/${d.id}/fotos/${'0'.repeat(24)}`]]) {
        const r = await p.pedir(m, `/api/eletricista/${c}`, { cookie, corpo });
        assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], `${quem} ${m} ${c}`);
      }
      const foto = await p.pedir('POST', `/api/eletricista/diagnosticos/${d.id}/fotos/${'0'.repeat(24)}`, { cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(foto.estado, 404, `${quem} foto`);
    }
    for (const [cookie, quem] of [[undefined, 'anónimo'], [cliente.cookie, 'cliente'], [e.cookie, 'eletricista no painel']]) {
      for (const [m, c, corpo] of [['GET', 'diagnosticos'], ['POST', 'diagnosticos', d], ['GET', `diagnosticos/${d.id}`]]) {
        const r = await p.pedir(m, `/painel/api/${c}`, { cookie, corpo });
        assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], `${quem} ${m} ${c}`);
      }
    }
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos').get().n, 0, 'nada ficou gravado');
    // Suspenso: a sessão fecha e as rotas dão 404.
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'suspender' })).estado, 200);
    assert.deepEqual((await area(e, 'GET', 'diagnosticos')).json, DESCONHECIDO);
  });

  test('sincronização: o mesmo id duas vezes é uma linha; atualiza; não volta de terminado a em curso; validação e barreira de segurança', async () => {
    const e = await aprovado();
    const d = registo({ estado: 'em_curso', terminado: null, causa: null, acao: null, tipo: null, passos: registo().passos.slice(0, 3) });
    let r = await area(e, 'POST', 'diagnosticos', d);
    assert.equal(r.estado, 201, r.texto);
    assert.deepEqual([r.json.diagnostico.estado, r.json.diagnostico.passos.length, r.json.diagnostico.autor.nome], ['em_curso', 3, e.nome]);
    r = await area(e, 'POST', 'diagnosticos', d);
    assert.equal(r.estado, 200, 'a mesma sincronização outra vez');
    const fim = registo({ id: d.id });
    r = await area(e, 'POST', 'diagnosticos', fim);
    assert.equal(r.estado, 200);
    assert.deepEqual([r.json.diagnostico.estado, r.json.diagnostico.passos.length, r.json.diagnostico.valores_fora, r.json.diagnostico.tipo], ['concluido', 6, 1, 'terra']);
    assert.equal((await area(e, 'POST', 'diagnosticos', fim)).estado, 200);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos WHERE id = ?').get(d.id).n, 1);
    const aud = p.app.db.prepare('SELECT acao, email, detalhes FROM auditoria WHERE alvo = ? ORDER BY id').all(`diagnostico:${d.id}`);
    assert.deepEqual(aud.map((x) => x.acao), ['diagnostico_criado', 'diagnostico_terminado']);
    assert.ok(aud.every((x) => x.email === `eletricista:${e.id}` && !/água|Caixa|Defeito/.test(x.detalhes)), 'sem texto escrito pelo autor');
    r = await area(e, 'POST', 'diagnosticos', d);
    assert.equal(r.estado, 409, 'terminado não volta a em curso');
    // Outro eletricista com o mesmo id: 404 (não muda nada nem diz que existe).
    const outro = await aprovado();
    assert.deepEqual((await area(outro, 'POST', 'diagnosticos', fim)).json, { erro: 'Diagnóstico não encontrado.' });
    assert.equal((await area(outro, 'GET', `diagnosticos/${d.id}`)).estado, 404);
    assert.equal((await area(outro, 'GET', 'diagnosticos')).json.diagnosticos.length, 0);
    // Validação.
    for (const [mau, re] of [
      [{ id: 'xyz' }, /id inválido/], [{ seguranca: { ...fim.seguranca, regras: ['desligar'] } }, /barreira de segurança/],
      [{ seguranca: { ...fim.seguranca, epi: [] } }, /barreira de segurança/], [{ seguranca: null }, /barreira/],
      [{ estado: 'concluido', causa: null }, /causa e a ação/], [{ estado: 'parado', perigo: null, causa: null }, /motivo/],
      [{ perigo: 'inventado' }, /sinal de perigo/], [{ tipo: 'nuclear' }, /tipo de avaria/],
      [{ passos: [{ no: 'quando', pergunta: 'x', resposta: 'y', chave: 'zz', quando: new Date().toISOString() }] }, /chave/],
      [{ passos: Array(201).fill(fim.passos[0]) }, /máx\. 200/], [{ outro: 1 }, /./], [{ trabalho_id: 99999 }, /Trabalho desconhecido/],
      [{ orcamento_id: 1 }, /trabalhos/], [{ nota: 'x'.repeat(2001) }, /demasiado longo/],
    ]) {
      const x = await area(outro, 'POST', 'diagnosticos', registo(mau));
      assert.equal(x.estado, 400, JSON.stringify(mau).slice(0, 80));
      assert.match(x.json.erro, re);
    }
    assert.equal((await area(outro, 'POST', 'diagnosticos', 'nao é json', { tipo: 'text/plain' })).estado, 415);
  });

  test('painel: cada um os seus; o CEO vê todos (com os do eletricista), filtra e abre; ligar a um pedido só CEO e comercial', async () => {
    const e = await aprovado();
    assert.equal((await area(e, 'POST', 'diagnosticos', registo({ arvore: 'disjuntor', titulo: 'O disjuntor dispara' }))).estado, 201);
    const dt = registo();
    assert.equal((await painel('POST', 'diagnosticos', 'tecnico', dt)).estado, 201);
    assert.equal((await painel('POST', 'diagnosticos', 'comercial', registo())).estado, 201);
    const meus = (await painel('GET', 'diagnosticos', 'tecnico')).json;
    assert.deepEqual([meus.diagnosticos.length, meus.diagnosticos[0].id, meus.autores], [1, dt.id, undefined]);
    assert.equal((await painel('GET', `diagnosticos/${dt.id}`, 'comercial')).estado, 404, 'o comercial não vê o do técnico');
    const ceo = (await painel('GET', 'diagnosticos', 'ceo')).json;
    assert.ok(ceo.diagnosticos.length >= 3);
    assert.ok(ceo.autores.some((a) => a.chave === `eletricista:${e.id}`) && ceo.autores.some((a) => a.chave === `utilizador:${p.u.tecnico.id}`));
    assert.deepEqual((await painel('GET', `diagnosticos?autor=eletricista:${e.id}`, 'ceo')).json.diagnosticos.map((x) => x.arvore), ['disjuntor']);
    assert.ok((await painel('GET', 'diagnosticos?arvore=disjuntor&estado=concluido', 'ceo')).json.diagnosticos.every((x) => x.arvore === 'disjuntor'));
    const det = (await painel('GET', `diagnosticos/${dt.id}`, 'ceo')).json.diagnostico;
    assert.deepEqual([det.autor.nome, det.passos.length, det.seguranca.regras.length, det.nota], ['tecnico teste', 6, 5, 'Caixa exterior com água.']);
    // Ligar a um pedido.
    const o = await painel('POST', 'orcamentos', 'ceo', { nome: 'Pedido Diagnóstico', telefone: '912 000 000', localidade: 'Sintra', servico: 'Reparação' });
    assert.match((await painel('POST', 'diagnosticos', 'tecnico', registo({ orcamento_id: o.json.id }))).json.erro, /Só o CEO e o comercial/);
    assert.match((await painel('POST', 'diagnosticos', 'comercial', registo({ orcamento_id: 999999 }))).json.erro, /Pedido desconhecido/);
    const ligado = registo({ orcamento_id: o.json.id });
    assert.equal((await painel('POST', 'diagnosticos', 'comercial', ligado)).estado, 201);
    // "Enviar para a ficha" do pedido: a mesma validação do diagnóstico da ficha; o técnico não tem a rota (404).
    assert.deepEqual((await painel('POST', `diagnosticos/${dt.id}/ficha`, 'tecnico', { diagnostico: {} })).json, DESCONHECIDO);
    assert.equal((await painel('POST', `diagnosticos/${ligado.id}/ficha`, 'comercial', { diagnostico: { verificacoes: ['inventada'] } })).estado, 400);
    const ficha = paraFicha(arvorePorId('diferencial'), ligado);
    const f = await painel('POST', `diagnosticos/${ligado.id}/ficha`, 'comercial', { diagnostico: ficha });
    assert.equal(f.estado, 200, f.texto);
    assert.ok(f.json.diagnostico.ficha_enviada);
    const ped = (await painel('GET', `orcamentos/${o.json.id}`, 'ceo')).json;
    assert.deepEqual([ped.diagnostico.tipo, ped.diagnostico.valores.isolamento, ped.diagnostico.por], ['terra', 0.12, p.u.comercial.email]);
    assert.equal((await painel('POST', `diagnosticos/${dt.id}/ficha`, 'ceo', { diagnostico: ficha })).estado, 404, 'o CEO só envia os seus');
  });

  test('ligar a um trabalho de avaria do eletricista e "Enviar para a ficha": preenche o diagnóstico da avaria (mesma validação)', async () => {
    const e = await aprovado();
    const outro = await aprovado();
    const { id, tid } = await avariaDe(e);
    assert.match((await area(outro, 'POST', 'diagnosticos', registo({ trabalho_id: tid }))).json.erro, /Trabalho desconhecido/, 'só os seus trabalhos');
    const sem = registo();
    assert.equal((await area(e, 'POST', 'diagnosticos', sem)).estado, 201);
    assert.equal((await area(e, 'POST', `diagnosticos/${sem.id}/ficha`, { diagnostico: paraFicha(arvorePorId('diferencial'), sem) })).estado, 409, 'sem trabalho ligado');
    const d = registo({ trabalho_id: tid });
    const r = await area(e, 'POST', 'diagnosticos', d);
    assert.deepEqual([r.estado, r.json.diagnostico.trabalho_id, r.json.diagnostico.orcamento_id], [201, tid, id]);
    assert.equal((await area(e, 'POST', `diagnosticos/${d.id}/ficha`, { diagnostico: { tipo: 'nuclear' } })).estado, 400);
    assert.equal((await area(e, 'POST', `diagnosticos/${d.id}/ficha`, {})).estado, 400, 'sem o diagnóstico não apaga a ficha');
    const f = await area(e, 'POST', `diagnosticos/${d.id}/ficha`, { diagnostico: paraFicha(arvorePorId('diferencial'), d) });
    assert.equal(f.estado, 200, f.texto);
    const t = (await area(e, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([t.diagnostico.atual.tipo, t.diagnostico.atual.verificacoes, t.diagnostico.atual.valores], ['terra', ['isolado', 'visual', 'isolamento'], { isolamento: 0.12 }]);
    assert.match(t.diagnostico.atual.conclusao, /^Causa provável: Defeito de isolamento/);
    const ped = (await painel('GET', `orcamentos/${id}`, 'ceo')).json;
    assert.equal(ped.diagnostico.por, `eletricista:${e.id}`);
    assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'diagnostico_enviado_ficha' AND alvo = ?").get(`diagnostico:${d.id}`));
    // O CEO vê-o no painel, ligado ao trabalho e ao pedido.
    const noPainel = (await painel('GET', `diagnosticos/${d.id}`, 'ceo')).json.diagnostico;
    assert.deepEqual([noPainel.trabalho_id, noPainel.orcamento_id, Boolean(noPainel.ficha_enviada), noPainel.autor.origem], [tid, id, true, 'eletricista']);
  });

  test('fotos: JPEG/PNG verificadas pelos bytes, até 1 MB, até 6 por diagnóstico; a mesma foto outra vez não duplica; só o autor e o CEO as veem', async () => {
    const e = await aprovado();
    const d = registo();
    assert.equal((await area(e, 'POST', 'diagnosticos', d)).estado, 201);
    const fid = (n) => n.toString(16).padStart(24, '0');
    const foto = (id, bytes = JPEG, tipo = 'image/jpeg', quem = e) => area(quem, 'POST', `diagnosticos/${d.id}/fotos/${id}`, bytes, { tipo });
    assert.equal((await foto(fid(1))).estado, 201);
    assert.deepEqual([(await foto(fid(1))).estado, p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos_fotos WHERE diagnostico_id = ?').get(d.id).n], [200, 1], 'idempotente');
    assert.equal((await foto(fid(2), PNG, 'image/png')).estado, 201);
    assert.equal((await foto(fid(3), Buffer.from('<svg/>'), 'image/svg+xml')).estado, 415);
    assert.equal((await foto(fid(3), PNG, 'image/jpeg')).estado, 415, 'tipo declarado diferente dos bytes');
    assert.equal((await foto(fid(3), Buffer.concat([JPEG, Buffer.alloc(FOTO_MAX_BYTES)]))).estado, 413);
    assert.equal((await foto('naohex')).estado, 404);
    for (let i = 3; i <= FOTOS_POR_DIAGNOSTICO; i++) assert.equal((await foto(fid(i))).estado, 201);
    assert.equal((await foto(fid(99))).estado, 409, `máximo de ${FOTOS_POR_DIAGNOSTICO}`);
    const det = (await area(e, 'GET', `diagnosticos/${d.id}`)).json.diagnostico;
    assert.equal(det.fotos.length, FOTOS_POR_DIAGNOSTICO);
    const g = await area(e, 'GET', `diagnosticos/${d.id}/fotos/${fid(1)}`);
    assert.deepEqual([g.estado, g.cabecalhos['content-type'], g.cabecalhos['cache-control'], g.bruto.subarray(0, 3).toString('hex')], [200, 'image/jpeg', 'private, no-store', 'ffd8ff']);
    assert.equal((await painel('GET', `diagnosticos/${d.id}/fotos/${fid(1)}`, 'ceo')).estado, 200, 'o CEO vê');
    assert.equal((await painel('GET', `diagnosticos/${d.id}/fotos/${fid(1)}`, 'comercial')).estado, 404);
    const outro = await aprovado();
    assert.equal((await area(outro, 'GET', `diagnosticos/${d.id}/fotos/${fid(1)}`)).estado, 404);
    assert.equal((await foto(fid(50), JPEG, 'image/jpeg', outro)).estado, 404, 'não põe fotos no diagnóstico de outro');
    assert.ok(existsSync(join(p.config.diagnosticosDir, d.id, `${fid(1)}.jpg`)));
  });

  test('RGPD: apagar um eletricista apaga os diagnósticos sem trabalho (e as fotos) e tira a nota dos ligados; apagar a conta do cliente tira as fotos e a ligação', async () => {
    const e = await aprovado();
    const { tid, conta } = await avariaDe(e);
    const solto = registo();
    const ligado = registo({ trabalho_id: tid });
    for (const d of [solto, ligado]) {
      assert.equal((await area(e, 'POST', 'diagnosticos', d)).estado, 201);
      assert.equal((await area(e, 'POST', `diagnosticos/${d.id}/fotos/${d.id.slice(0, 24)}`, JPEG, { tipo: 'image/jpeg' })).estado, 201);
    }
    // Apagar a conta do cliente (o pedido da avaria tem pagamento: fica anonimizado).
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(conta.email).id;
    const ap = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: conta.email });
    assert.equal(ap.estado, 200, ap.texto);
    const l = p.app.db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(ligado.id);
    assert.deepEqual([l.trabalho_id, l.orcamento_id, l.nota, l.causa !== null], [null, null, null, true], 'fica o diagnóstico técnico, sem ligação nem nota');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos_fotos WHERE diagnostico_id = ?').get(ligado.id).n, 0);
    assert.equal(existsSync(join(p.config.diagnosticosDir, ligado.id)), false, 'as fotos da casa saem do disco');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos_fotos WHERE diagnostico_id = ?').get(solto.id).n, 1, 'o solto não tinha ligação a este pedido');
    // Apagar o eletricista: o solto sai (com a pasta); um ligado a um trabalho fica sem a nota.
    const e2 = await aprovado();
    const av2 = await avariaDe(e2);
    const lig2 = registo({ trabalho_id: av2.tid });
    const solto2 = registo();
    for (const d of [lig2, solto2]) assert.equal((await area(e2, 'POST', 'diagnosticos', d)).estado, 201);
    assert.equal((await area(e2, 'POST', `diagnosticos/${solto2.id}/fotos/${'b'.repeat(24)}`, JPEG, { tipo: 'image/jpeg' })).estado, 201);
    assert.equal((await painel('POST', `orcamentos/${av2.id}/eletricista`, 'ceo', { acao: 'retirar' })).estado, 200);
    const apE = await painel('POST', `eletricistas/${e2.id}/apagar`, 'ceo', { email: e2.email });
    assert.equal(apE.estado, 200, apE.texto);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM diagnosticos WHERE id = ?').get(solto2.id).n, 0);
    assert.equal(existsSync(join(p.config.diagnosticosDir, solto2.id)), false);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE alvo = ?').get(`diagnostico:${solto2.id}`).n, 0);
    const fica = p.app.db.prepare('SELECT * FROM diagnosticos WHERE id = ?').get(lig2.id);
    assert.deepEqual([fica.nota, fica.trabalho_id, fica.eletricista_id], [null, av2.tid, e2.id]);
    const noPainel = (await painel('GET', `diagnosticos/${lig2.id}`, 'ceo')).json.diagnostico;
    assert.equal(noPainel.autor.nome, 'Eletricista apagado (RGPD)');
  });
});

describe('app de diagnóstico com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0' } }); });
  after(() => p.fechar());

  test('as rotas da área do eletricista não existem (404); o painel continua a guardar e a listar', async () => {
    const d = registo();
    for (const [m, c, corpo] of [['GET', 'diagnosticos'], ['POST', 'diagnosticos', d], ['GET', `diagnosticos/${d.id}`]]) {
      for (const cookie of [undefined, p.cookies.ceo]) assert.deepEqual((await p.pedir(m, `/api/eletricista/${c}`, { cookie, corpo })).json, DESCONHECIDO);
    }
    assert.equal((await p.pedir('POST', '/painel/api/diagnosticos', { cookie: p.cookies.tecnico, corpo: d })).estado, 201);
    assert.equal((await p.pedir('GET', '/painel/api/diagnosticos', { cookie: p.cookies.ceo })).json.diagnosticos.length, 1);
  });
});

describe('a app (ficheiros do site)', () => {
  const WEB = new URL('../../web/', import.meta.url);
  test('página, manifesto e service worker próprios (âmbito /diagnostico); o sw.js do site não mudou de regra', async () => {
    const html = await readFile(new URL('diagnostico.html', WEB), 'utf8');
    assert.match(html, /<link rel="manifest" href="diagnostico\.json">/);
    const man = JSON.parse(await readFile(new URL('diagnostico.json', WEB), 'utf8'));
    assert.deepEqual([man.lang, man.start_url, man.scope, man.display, man.id], ['pt-PT', 'diagnostico.html', 'diagnostico', 'standalone', 'diagnostico.html']);
    assert.ok(man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512'));
    for (const i of man.icons) assert.ok(existsSync(new URL(i.src, WEB)), i.src);
    const sw = await readFile(new URL('diagnostico-sw.js', WEB), 'utf8');
    assert.match(sw, /domus-diagnostico-/);
    for (const f of ['diagnostico.js', 'diagnostico.css', 'diagnostico/motor.js', 'diagnostico/arvores.js', 'diagnostico/limites.js', ...IDS.length ? ['diagnostico/arvores-protecoes.js', 'diagnostico/arvores-alimentacao.js', 'diagnostico/arvores-terra.js', 'diagnostico/arvores-aparelhos.js'] : []]) {
      assert.ok(sw.includes(`"${f}"`), `o service worker guarda ${f}`);
      assert.ok(existsSync(new URL(f, WEB)), f);
    }
    assert.match(await readFile(new URL('diagnostico.js', WEB), 'utf8'), /register\("diagnostico-sw\.js", \{ scope: "diagnostico" \}\)/);
    const site = await readFile(new URL('sw.js', WEB), 'utf8');
    assert.doesNotMatch(site, /addEventListener\("fetch"/, 'o sw.js do site continua sem cache');
  });
});
