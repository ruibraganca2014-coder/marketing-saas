// Ativação de aparelhos (decisões do dono, 2026-10-09; docs/ATIVACAO-APARELHOS.md): o chip (MAC) registado de cada
// aparelho, o alerta quando o aparelho responde com outro, e o registo pelos eletricistas dentro de um trabalho —
// à espera do CEO, ou direto se o eletricista for de confiança; o CEO aprova, recusa e anula.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { Alertas, normalizarMac } from '../src/alertas.js';

const MAC = '38:1F:8D:12:AB:CD', OUTRO = '38:1F:8D:99:00:01';

test('normalizarMac: com ou sem separadores, maiúsculas; o resto é null', () => {
  assert.equal(normalizarMac('38:1f:8d:12:ab:cd'), MAC);
  assert.equal(normalizarMac('381F8D12ABCD'), MAC);
  assert.equal(normalizarMac('38-1F-8D-12-AB-CD\n'), MAC);
  for (const mau of ['', null, undefined, '38:1F:8D:12:AB', 'zz:1F:8D:12:AB:CD:00', 12]) assert.equal(normalizarMac(mau), null, String(mau));
});

test('alertas: chip diferente do registado é crítico; chip por registar é baixo; sem registos não há alertas de chip', () => {
  let t = 1_000_000;
  const a = new Alertas({ config: { mqtt: {} }, registo: { info() {}, erro() {}, aviso() {} }, relogio: () => t });
  const vistos = [];
  a.aoVerMac = (...x) => vistos.push(x);
  a.receber('domus/joao/_aparelhos', Buffer.from(JSON.stringify([{ id: 'sala', nome: 'Sala' }, { id: 'termo', nome: 'Termo' }])), true);
  a.receber('domus/joao/sala/mac', Buffer.from('381f8d12abcd'));
  a.receber('domus/joao/sala/mac', Buffer.from(MAC));   // igual: não repete
  a.receber('domus/joao/termo/mac', Buffer.from(OUTRO));
  a.receber('domus/joao/termo/mac', Buffer.from('lixo'));
  assert.deepEqual(vistos, [['joao', 'sala', MAC], ['joao', 'termo', OUTRO]]);
  a.chips = () => new Map();
  a.chips = null;
  assert.deepEqual(a.lista().alertas.filter((x) => x.tipo.startsWith('chip')), [], 'sem quem diga o que está registado, nada');
  const chips = (o) => () => new Map(Object.entries(o).map(([k, mac]) => [k, { mac, visto: null }]));
  a.chips = chips({ sala: OUTRO });
  const al = a.lista().alertas.filter((x) => x.tipo.startsWith('chip'));
  assert.deepEqual(al.map((x) => [x.aparelho, x.tipo, x.gravidade]), [['sala', 'chip_diferente', 'critica'], ['termo', 'chip_por_registar', 'baixa']]);
  assert.match(al[0].mensagem, new RegExp(`registado ${OUTRO}, a responder ${MAC}`));
  a.chips = chips({ sala: MAC, termo: OUTRO });
  assert.deepEqual(a.lista().alertas.filter((x) => x.tipo.startsWith('chip')), [], 'a conferir: sem alertas');
  // Um aparelho a alternar de chip só conta uma mudança de 10 em 10 segundos; o último visto na base também dá alerta
  // (depois de um reinício do painel); um aparelho que a casa já não tem não dá.
  a.receber('domus/joao/sala/mac', Buffer.from(OUTRO));
  assert.equal(vistos.length, 2, 'cedo demais: ignorado');
  t += 10_001;
  a.receber('domus/joao/sala/mac', Buffer.from(OUTRO));
  assert.deepEqual(vistos.at(-1), ['joao', 'sala', OUTRO]);
  const b = new Alertas({ config: { mqtt: {} }, registo: { info() {}, erro() {}, aviso() {} } });
  b.receber('domus/joao/_aparelhos', Buffer.from(JSON.stringify([{ id: 'sala', nome: 'Sala' }])), true);
  b.chips = () => new Map([['sala', { mac: MAC, visto: OUTRO }], ['antigo', { mac: MAC, visto: OUTRO }]]);
  assert.deepEqual(b.lista().alertas.filter((x) => x.tipo.startsWith('chip')).map((x) => [x.aparelho, x.tipo]), [['sala', 'chip_diferente']]);
});

describe('painel e eletricista', () => {
  let p;
  let e;
  let tid;
  let oid;
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  before(async () => {
    p = await painelComEquipa({ env: { SITE_URL: 'https://site.teste' } });
    await mkdir(join(p.dados, 'clientes'), { recursive: true });
    await writeFile(join(p.dados, 'clientes', 'joao.tsv'), ['sala\topenbeken\t1\t0\t1:interruptor:Teto:0:1:ultimo::Sala\tSala grande\t', 'termo\topenbeken\t1\t0\t1:interruptor:Termo:0:0:desligado:perigosa:\tTermoacumulador\tCasa de banho', ''].join('\n'));
    const c = { nome: 'Eletricista Chip', email: 'eletricista.chip@exemplo.pt', telefone: '910 000 222', nif: '123456789', dgeg: 'TR-3002',
      concelhos: ['Sintra'], experiencia: '5_10', notas: '', seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `eletricistas/${id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const s = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    e = { id, cookie: s.cabecalhos['set-cookie'][0].split(';')[0] };
    const o = await painel('POST', 'orcamentos', 'ceo', { nome: 'João Chip', telefone: '912 345 678', email: 'joao.chip@exemplo.pt', localidade: 'Sintra', servico: 'Casa inteligente' });
    oid = o.json.id;
    tid = (await painel('POST', `orcamentos/${oid}/eletricista`, 'ceo', { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await area('POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
  });
  after(() => p.fechar());

  test('painel: o CEO regista o chip; a ficha mostra o estado; o aparelho a responder com outro dá alerta crítico e um email', async () => {
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'tecnico', { mac: MAC })).estado, 403, 'só o CEO');
    assert.equal((await painel('POST', 'clientes/joao/aparelhos', 'tecnico', { id: 'sala', tipo: 'openbeken', nome: 'Sala', substituir: true, mac: MAC })).estado, 403, 'nem pelo pedido de aparelho');
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'ceo', { mac: 'não é' })).estado, 400);
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/nao-existe/chip', 'ceo', { mac: MAC })).estado, 404);
    const r = await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'ceo', { mac: '381f8d12abcd', serie: 'DOM-0001' });
    assert.deepEqual([r.estado, r.json.chip.mac, r.json.chip.serie, r.json.chip.estado], [200, MAC, 'DOM-0001', 'por_ver']);
    const chipDe = async (id) => (await painel('GET', 'clientes/joao')).json.aparelhos.find((a) => a.id === id).chip;
    assert.equal((await chipDe('termo')).estado, 'por_registar');
    // O aparelho anuncia o chip certo: confere, sem alertas nem emails.
    p.app.alertas.receber('domus/joao/_aparelhos', Buffer.from(JSON.stringify([{ id: 'sala', nome: 'Sala grande' }, { id: 'termo', nome: 'Termoacumulador' }])), true);
    p.app.alertas.receber('domus/joao/sala/mac', Buffer.from(MAC));
    assert.equal((await chipDe('sala')).estado, 'confere');
    const antes = p.emails.length;
    // Agora responde outro chip no lugar dele.
    p.relogio.avancar(11_000);
    p.app.alertas.receber('domus/joao/sala/mac', Buffer.from(OUTRO));
    const c = await chipDe('sala');
    assert.deepEqual([c.estado, c.mac, c.visto], ['diferente', MAC, OUTRO]);
    const al = (await painel('GET', 'alertas?cliente=joao')).json.alertas.filter((x) => x.tipo === 'chip_diferente');
    assert.deepEqual(al.map((x) => [x.aparelho, x.gravidade]), [['sala', 'critica']]);
    assert.equal(p.emails.length, antes + 1, 'um email ao CEO');
    assert.match(p.emails.at(-1).texto, /chip diferente do que foi registado/);
    p.relogio.avancar(11_000);
    p.app.alertas.receber('domus/joao/sala/mac', Buffer.from(MAC));
    p.relogio.avancar(11_000);
    p.app.alertas.receber('domus/joao/sala/mac', Buffer.from(OUTRO));
    assert.equal(p.emails.length, antes + 1, 'avisa uma vez por chip registado');
    // Registar um chip que não é o que o aparelho já anuncia também avisa (o aparelho não muda, por isso não viria outro aviso).
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'ceo', { mac: '38:1F:8D:00:00:07' })).json.chip.estado, 'diferente');
    assert.equal(p.emails.length, antes + 2);
    // O CEO aceita o chip novo: deixa de haver alerta.
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'ceo', { mac: OUTRO })).json.chip.estado, 'confere');
    assert.equal((await painel('GET', 'alertas?cliente=joao')).json.alertas.filter((x) => x.tipo === 'chip_diferente').length, 0);
    assert.equal((await painel('POST', 'clientes/joao/aparelhos/sala/chip', 'ceo', { mac: null })).json.chip.estado, 'por_registar');
  });

  test('eletricista: só vê os aparelhos quando o pedido tem casa; regista o chip e fica à espera; o CEO aprova, recusa e anula', async () => {
    let r = await area('GET', `trabalhos/${tid}/aparelhos`);
    assert.deepEqual([r.estado, r.json.casa_criada, r.json.pode_registar, r.json.aparelhos], [200, false, false, []], 'pedido sem casa');
    assert.equal((await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: MAC })).estado, 409);
    // O `codigo_cliente` vem do formulário público: não dá acesso a casa nenhuma.
    p.app.db.prepare('UPDATE orcamentos SET codigo_cliente = ? WHERE id = ?').run('joao', oid);
    r = await area('GET', `trabalhos/${tid}/aparelhos`);
    assert.deepEqual([r.json.cliente, r.json.casa_criada, r.json.aparelhos], [null, false, []], 'só a casa que o painel ligou ao pedido');
    assert.equal((await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: MAC })).estado, 409);
    p.app.db.prepare('UPDATE orcamentos SET codigo_cliente = NULL, cliente = ? WHERE id = ?').run('joao', oid);
    r = await area('GET', `trabalhos/${tid}/aparelhos`);
    assert.deepEqual([r.json.cliente, r.json.casa_criada, r.json.pode_registar, r.json.sem_aprovacao], ['joao', true, true, false]);
    assert.deepEqual(r.json.aparelhos, [{ id: 'sala', nome: 'Sala grande', divisao: null, chip: 'por_registar' }, { id: 'termo', nome: 'Termoacumulador', divisao: 'Casa de banho', chip: 'por_registar' }]);
    assert.equal((await p.pedir('GET', `/api/eletricista/trabalhos/${tid}/aparelhos`)).estado, 401);
    assert.equal((await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'de-outra-casa', mac: MAC })).estado, 404);
    assert.equal((await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: '12' })).estado, 400);
    const antes = p.emails.length;
    r = await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: MAC, serie: 'DOM-0002' });
    assert.deepEqual([r.estado, r.json.pedidos[0].estado, r.json.pedidos[0].mac, r.json.aparelhos[1].chip], [200, 'pendente', MAC, 'por_registar'], 'ainda não vale');
    assert.equal(p.emails.length, antes + 1, 'o CEO é avisado');
    assert.equal((await painel('GET', '')).json?.tratar?.ativacoes ?? (await painel('GET', 'resumo')).json.tratar.ativacoes, 1);
    // Corrige o código antes de aprovado: o pedido anterior é anulado, fica um à espera.
    r = await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: OUTRO });
    assert.deepEqual(r.json.pedidos.map((x) => x.estado), ['pendente', 'anulada']);
    assert.equal(p.emails.length, antes + 1, 'corrigir o código não volta a avisar');
    let l = (await painel('GET', 'ativacoes')).json;
    assert.deepEqual([l.pendentes.length, l.pendentes[0].aparelho, l.pendentes[0].mac, l.pendentes[0].eletricista.nome, l.pendentes[0].pedido_id], [1, 'termo', OUTRO, 'Eletricista Chip', oid]);
    assert.equal((await painel('GET', 'ativacoes', 'tecnico')).estado, 403);
    const aid = l.pendentes[0].id;
    assert.equal((await painel('POST', `ativacoes/${aid}`, 'ceo', { acao: 'anular' })).estado, 409, 'só se anula o que foi aprovado');
    l = (await painel('POST', `ativacoes/${aid}`, 'ceo', { acao: 'aprovar' })).json;
    assert.deepEqual([l.pendentes.length, l.recentes[0].estado, l.recentes[0].chip_atual.mac], [0, 'aprovada', OUTRO]);
    assert.equal((await painel('GET', 'clientes/joao')).json.aparelhos.find((a) => a.id === 'termo').chip.por, `eletricista:${e.id}`);
    assert.equal((await painel('POST', `ativacoes/${aid}`, 'ceo', { acao: 'aprovar' })).estado, 409);
    // O CEO é o superutilizador: anula, e o chip deixa de estar registado.
    l = (await painel('POST', `ativacoes/${aid}`, 'ceo', { acao: 'anular', nota: 'aparelho trocado' })).json;
    assert.deepEqual([l.recentes[0].estado, l.recentes[0].nota, l.recentes[0].chip_atual.estado], ['anulada', 'aparelho trocado', 'por_registar']);
    // Recusar um pedido pendente.
    await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'sala', mac: MAC });
    const pid = (await painel('GET', 'ativacoes')).json.pendentes[0].id;
    assert.equal((await painel('POST', `ativacoes/${pid}`, 'ceo', { acao: 'recusar' })).json.recentes[0].estado, 'recusada');
    assert.equal((await painel('GET', 'clientes/joao')).json.aparelhos.find((a) => a.id === 'sala').chip.estado, 'por_registar');
  });

  test('eletricista de confiança: o registo vale logo, sem email; o CEO continua a poder anular', async () => {
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { ativa_sem_aprovacao: 'sim' })).estado, 400);
    const r0 = await painel('POST', `eletricistas/${e.id}`, 'ceo', { ativa_sem_aprovacao: true });
    assert.deepEqual([r0.estado, r0.json.eletricista.ativa_sem_aprovacao], [200, true]);
    const antes = p.emails.length;
    // O termoacumulador ainda não anunciou chip nenhum: o registo vale logo e fica "por ver", sem emails.
    const r = await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: MAC });
    assert.deepEqual([r.estado, r.json.sem_aprovacao, r.json.pedidos[0].estado, r.json.aparelhos[1].chip], [200, true, 'aprovada', 'por_ver'], 'vale logo');
    assert.equal(p.emails.length, antes, 'sem pedido de aprovação');
    // Um registo direto que não bate com o que o aparelho anuncia avisa o CEO (a sala anunciou outro chip).
    const d = await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'sala', mac: '38:1F:8D:00:00:08' });
    assert.equal(d.json.aparelhos[0].chip, 'diferente');
    assert.equal(p.emails.length, antes + 1);
    assert.match(p.emails.at(-1).texto, /chip diferente do que foi registado/);
    await area('POST', `trabalhos/${tid}/chip`, { aparelho: 'termo', mac: MAC });
    const l = (await painel('GET', 'ativacoes')).json;
    assert.deepEqual([l.pendentes.length, l.recentes[0].decidido_por, l.recentes[0].chip_atual.mac], [0, 'automático', MAC]);
    assert.equal((await painel('POST', `ativacoes/${l.recentes[0].id}`, 'ceo', { acao: 'anular' })).json.recentes[0].chip_atual.estado, 'por_registar');
  });
});
