// CRM e quadro de tarefas (docs/CRM-TAREFAS.md): ficha do cliente derivada dos pedidos e fusão pelo CEO, fases do
// negócio (automáticas e à mão, motivo de perda), notas e contactos por papel, origem do contacto (resposta da pessoa,
// utm_source, referrer), lembretes automáticos com relógio falso (1 dia útil / visita + 2 dias / 3 / 7 / 14 dias, com
// prazos editáveis), idempotência e cancelamento, tarefas (CRUD, checklist, permissões: só o CEO vê as de todos), a
// semana e a contagem do menu, o email diário, separar um pedido da ficha e o RGPD (conta apagada).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { registoMudo } from '../src/util.js';
import { telefoneNorm, concelhoDe, agoraLisboa } from '../src/crm.js';
import { criarTarefas, aposDiasUteis, feriadoNacional } from '../src/tarefas.js';
import { canalUtm, canalChegada, origemContacto } from '../../web/origem.js';

const HORA = 3600_000, DIA = 24 * HORA;
let p;
before(async () => { p = await painelComEquipa(); });
after(() => p.fechar());

/** Avança o relógio falso e volta a entrar (as sessões do painel duram 12 h). */
async function avancar(ms) {
  p.relogio.avancar(ms);
  for (const papel of ['ceo', 'tecnico', 'comercial']) p.cookies[papel] = await p.entrar(p.u[papel].email);
}
/** Avança o relógio falso até ao próximo dia da semana `dow` (0 = domingo … 6 = sábado) às `hm` de Lisboa. */
async function avancarAte(dow, hm) {
  let t = p.relogio.agora();
  for (let i = 0; i < 8 * 24 * 60; i++) {
    t += 60_000;
    const l = agoraLisboa(t);
    if (new Date(`${l.slice(0, 10)}T12:00:00Z`).getUTCDay() === dow && l.slice(11) === hm) break;
  }
  await avancar(t - p.relogio.agora());
}
const hojeLisboa = () => agoraLisboa(p.relogio.agora()).slice(0, 10);
const api = (papel, metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
/** Pedido do formulário do site (sem conta); devolve o id. */
async function pedidoSite(corpo) {
  const r = await p.pedir('POST', '/api/orcamento', { corpo: { servico: 'Casa inteligente', ...corpo } });
  assert.equal(r.estado, 201, r.texto);
  return p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
}
const tarefasDe = (orcamento) => p.app.db.prepare('SELECT * FROM tarefas WHERE orcamento_id = ? ORDER BY id').all(orcamento);
const fichaDe = (orcamento) => p.app.db.prepare('SELECT crm_cliente_id AS c FROM orcamentos WHERE id = ?').get(orcamento).c;

test('utilidades: telefone normalizado e concelho a partir da localidade', () => {
  assert.equal(telefoneNorm('+351 912 345 678'), '912345678');
  assert.equal(telefoneNorm('00351912345678'), '912345678');
  assert.equal(telefoneNorm('912-345-678'), '912345678');
  assert.equal(telefoneNorm('12'), null);
  assert.equal(concelhoDe('sintra'), 'Sintra');
  assert.equal(concelhoDe('Vila Nova de Gaia'), 'Vila Nova de Gaia');
  assert.equal(concelhoDe('Algures'), null);
});

test('origem do contacto: só a categoria e a página de entrada; valores desconhecidos são ignorados', async () => {
  const a = await pedidoSite({ nome: 'Origem Um', email: 'origem1@exemplo.pt', origem_contacto: 'google', origem_entrada: 'carregador' });
  const b = await pedidoSite({ nome: 'Origem Dois', email: 'origem2@exemplo.pt', origem_contacto: 'https://google.com/?q=x', origem_entrada: 'outra-coisa' });
  const c = await pedidoSite({ nome: 'Origem Três', email: 'origem3@exemplo.pt' });
  const linha = (id) => p.app.db.prepare('SELECT origem_contacto, origem_entrada FROM orcamentos WHERE id = ?').get(id);
  assert.deepEqual({ ...linha(a) }, { origem_contacto: 'google', origem_entrada: 'carregador' });
  assert.deepEqual({ ...linha(b) }, { origem_contacto: null, origem_entrada: null }, 'nunca guarda um endereço');
  assert.deepEqual({ ...linha(c) }, { origem_contacto: null, origem_entrada: null });
  // Edição à mão no CRM (comercial), com validação; o técnico não entra.
  let r = await api('comercial', 'POST', `crm/pedidos/${c}`, { origem_contacto: 'instagram' });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.origem_contacto, 'instagram');
  assert.equal((await api('comercial', 'POST', `crm/pedidos/${c}`, { origem_contacto: 'tiktok' })).estado, 400);
  assert.equal((await api('tecnico', 'POST', `crm/pedidos/${c}`, { origem_contacto: 'outro' })).estado, 403);
  // Filtro por origem no pipeline.
  r = await api('ceo', 'GET', 'crm/pedidos?origem=google');
  assert.ok(r.json.pedidos.some((x) => x.id === a) && r.json.pedidos.every((x) => x.origem_contacto === 'google'));
  // A ficha do pedido traz a origem.
  assert.equal((await api('ceo', 'GET', `orcamentos/${a}`)).json.origem_entrada, 'carregador');
});

test('origem do contacto: a resposta a "Como nos conheceu?" manda, depois o utm_source, depois o referrer; só a categoria sai do navegador', async () => {
  const loc = (search = '') => ({ search, hostname: 'domusenergia.pt' });
  const sessao = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
  // utm_source → categoria (o valor nunca sai).
  assert.equal(canalUtm('?utm_source=Google&utm_medium=cpc'), 'google');
  assert.equal(canalUtm('?utm_source=fb'), 'facebook');
  assert.equal(canalUtm('?utm_source=ig'), 'instagram');
  assert.equal(canalUtm('?utm_source=newsletter-outubro'), 'outro');
  assert.equal(canalUtm('?servico=carregador'), null);
  // Prioridade: resposta > utm_source > referrer.
  assert.deepEqual(origemContacto('recomendacao', loc('?utm_source=facebook'), 'https://www.google.com/', sessao()), { origem_contacto: 'recomendacao' });
  assert.deepEqual(origemContacto('', loc('?utm_source=facebook&servico=carregador'), 'https://www.google.com/', sessao()), { origem_contacto: 'facebook', origem_entrada: 'carregador' });
  assert.equal(origemContacto('', loc(), 'https://www.google.pt/search?q=eletricista', sessao()).origem_contacto, 'google');
  assert.equal(origemContacto('', loc(), '', sessao()).origem_contacto, 'direto');
  assert.equal(origemContacto('tiktok', loc(), 'https://www.instagram.com/', sessao()).origem_contacto, 'instagram', 'uma resposta desconhecida é ignorada');
  // Entre páginas: no navegador fica só a categoria (nunca o endereço nem o valor do utm) e vale na página seguinte.
  const s = sessao();
  assert.equal(canalChegada(loc('?utm_source=newsletter-outubro&utm_campaign=segredo'), 'https://l.instagram.com/?u=x', s), 'outro');
  assert.deepEqual([...s.m.entries()], [['domus.origem', 'outro']]);
  assert.equal(origemContacto('', loc('?servico=quadro-antigo'), 'https://domusenergia.pt/quadro-eletrico.html', s).origem_contacto, 'outro');
  assert.equal(origemContacto('carrinha_rua', loc(), 'https://domusenergia.pt/', s).origem_contacto, 'carrinha_rua');
  // Sem sessionStorage (bloqueado) funciona na mesma; um valor estranho guardado é ignorado.
  assert.equal(origemContacto('', loc('?utm_source=ig'), '', null).origem_contacto, 'instagram');
  const sujo = sessao(); sujo.m.set('domus.origem', 'https://exemplo.pt/x');
  assert.equal(canalChegada(loc(), '', sujo), 'direto');
  // Servidor: as categorias novas são aceites e filtram; as antigas continuam válidas; as desconhecidas são ignoradas.
  const linha = (id) => p.app.db.prepare('SELECT origem_contacto FROM orcamentos WHERE id = ?').get(id).origem_contacto;
  for (const v of ['facebook_instagram', 'recomendacao', 'eletricista_parceiro', 'carrinha_rua', 'facebook', 'direto']) {
    const id = await pedidoSite({ nome: `Origem ${v}`, email: `origem.${v}@exemplo.pt`, origem_contacto: v });
    assert.equal(linha(id), v);
  }
  const x = await pedidoSite({ nome: 'Origem Estranha', email: 'origem.estranha@exemplo.pt', origem_contacto: 'utm_source=segredo' });
  assert.equal(linha(x), null);
  let r = await api('ceo', 'GET', 'crm/pedidos?origem=recomendacao');
  assert.ok(r.json.pedidos.length === 1 && r.json.pedidos[0].origem_contacto === 'recomendacao');
  r = await api('comercial', 'POST', `crm/pedidos/${x}`, { origem_contacto: 'carrinha_rua' });
  assert.equal(r.json.origem_contacto, 'carrinha_rua');
});

test('ficha do cliente: pedidos da mesma pessoa (email ou telefone) juntam-se; fusão manual só pelo CEO', async () => {
  const a = await pedidoSite({ nome: 'Ana Fusão', email: 'ana.fusao@exemplo.pt', telefone: '912 111 222' });
  const b = await pedidoSite({ nome: 'Ana F.', email: 'ANA.FUSAO@exemplo.pt' });                 // mesmo email (maiúsculas)
  const c = await pedidoSite({ nome: 'Ana', telefone: '+351912111222' });                         // mesmo telefone
  const d = await pedidoSite({ nome: 'Ana Fusão (outro email)', email: 'ana.outra@exemplo.pt' });  // outra ficha
  await api('ceo', 'GET', 'crm/clientes');
  assert.ok(fichaDe(a));
  assert.equal(fichaDe(b), fichaDe(a));
  assert.equal(fichaDe(c), fichaDe(a));
  assert.notEqual(fichaDe(d), fichaDe(a));
  const k = fichaDe(a), outra = fichaDe(d);
  let r = await api('comercial', 'GET', `crm/clientes/${k}`);
  assert.equal(r.estado, 200);
  assert.deepEqual(r.json.pedidos.map((x) => x.id).sort(), [a, b, c].sort());
  assert.ok(Array.isArray(r.json.pagamentos) && Array.isArray(r.json.registos) && Array.isArray(r.json.obras));
  // Uma nota na outra ficha e uma tarefa ligada a ela seguem para a ficha que fica.
  assert.equal((await api('comercial', 'POST', `crm/clientes/${outra}/registos`, { tipo: 'nota', texto: 'Mesma pessoa, outro email.' })).estado, 201);
  const t = (await api('comercial', 'POST', 'tarefas', { titulo: 'Confirmar morada', cliente_id: outra })).json;
  // Só o CEO funde.
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/fundir`, { outro: outra })).estado, 403);
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/fundir`, { outro: k })).estado, 400);
  r = await api('ceo', 'POST', `crm/clientes/${k}/fundir`, { outro: outra });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.pedidos.length, 4);
  assert.equal(r.json.registos.length, 1);
  assert.equal(p.app.db.prepare('SELECT cliente_id FROM tarefas WHERE id = ?').get(t.id).cliente_id, k);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM crm_clientes WHERE id = ?').get(outra).n, 0);
  // Um pedido novo com o email da ficha que saiu vem para a que ficou (os emails dos pedidos contam).
  const e = await pedidoSite({ nome: 'Ana outra vez', email: 'ana.outra@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  assert.equal(fichaDe(e), k);
  assert.ok(p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao = 'crm_clientes_fundidos' AND alvo = ?").get(`crm_cliente:${k}`));
});

test('fases: automáticas pelos eventos, à mão pelo pedido; perdido pede o motivo', async () => {
  const id = await pedidoSite({ nome: 'Bruno Fases', email: 'bruno.fases@exemplo.pt', localidade: 'Cascais' });
  let r = await api('comercial', 'GET', 'crm/pedidos');
  const fase = (lista) => lista.pedidos.find((x) => x.id === id)?.fase;
  assert.equal(fase(r.json), 'novo');
  assert.equal(r.json.pedidos.find((x) => x.id === id).concelho, 'Cascais');
  // Contacto registado na ficha → "contactado".
  const k = fichaDe(id);
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'chamada', texto: 'Ligou-se, quer visita.' })).estado, 201);
  assert.equal(p.app.db.prepare('SELECT estado FROM orcamentos WHERE id = ?').get(id).estado, 'contactado');
  // Visita marcada → "visita"; proposta enviada → "proposta"; o funil soma o valor.
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}/marcar-visita`, { data_visita: '2026-12-01T10:00' })).estado, 200);
  assert.equal(fase((await api('comercial', 'GET', 'crm/pedidos')).json), 'visita');
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'proposta_enviada', valor_proposta: 1234.5 })).estado, 200);
  r = await api('comercial', 'GET', 'crm/pedidos?concelho=Cascais');
  assert.equal(fase(r.json), 'proposta');
  assert.equal(r.json.funil.proposta.n, 1);
  assert.equal(r.json.funil.proposta.valor, 1234.5);
  assert.deepEqual(r.json.pedidos.map((x) => x.id), [id]);
  assert.equal((await api('comercial', 'GET', 'crm/pedidos?fase=proposta')).json.pedidos.every((x) => x.fase === 'proposta'), true);
  // Perdido: sem motivo → 400; "outro" sem texto → 400; com o tipo chega.
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'perdido' })).estado, 400);
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'perdido', motivo_perda_tipo: 'outro' })).estado, 400);
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'perdido', motivo_perda_tipo: 'barato' })).estado, 400);
  r = await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'perdido', motivo_perda_tipo: 'preco' });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.fase, 'perdido');
  assert.equal(r.json.motivo_perda_tipo, 'preco');
  // Voltar atrás à mão também é possível (a fase segue o estado).
  assert.equal((await api('ceo', 'POST', `orcamentos/${id}`, { estado: 'contactado' })).json.fase, 'contactado');
  // O técnico não mexe nas fases.
  assert.equal((await api('tecnico', 'POST', `orcamentos/${id}`, { estado: 'novo' })).estado, 403);
  // Filtros por responsável e datas.
  assert.equal((await api('ceo', 'POST', `crm/pedidos/${id}`, { responsavel_id: p.u.comercial.id })).estado, 200);
  r = await api('ceo', 'GET', `crm/pedidos?responsavel=${p.u.comercial.id}`);
  assert.deepEqual(r.json.pedidos.map((x) => x.id), [id]);
  assert.equal((await api('ceo', 'GET', 'crm/pedidos?de=2000-01-01&ate=2000-01-02')).json.pedidos.length, 0);
  assert.equal((await api('ceo', 'POST', `crm/pedidos/${id}`, { responsavel_id: 99999 })).estado, 400);
});

test('notas e contactos por papel: técnico só vê os clientes das suas obras, lê as notas e só regista visitas', async () => {
  const id = await pedidoSite({ nome: 'Carla Obra', email: 'carla.obra@exemplo.pt' });
  const outro = await pedidoSite({ nome: 'Daniel Sem Obra', email: 'daniel@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  const k = fichaDe(id), k2 = fichaDe(outro);
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'Cão no quintal.' })).estado, 201);
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'whatsapp', quando: '2026-01-02T09:30', texto: 'Enviada a proposta.' })).estado, 201);
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota' })).estado, 400, 'a nota precisa de texto');
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'fax', texto: 'x' })).estado, 400);
  assert.equal((await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'x', orcamento_id: outro })).estado, 400, 'pedido de outro cliente');
  // Sem obra atribuída o técnico não vê o cliente (404, não 403).
  assert.equal((await api('tecnico', 'GET', `crm/clientes/${k}`)).estado, 404);
  assert.equal((await api('tecnico', 'GET', 'crm/clientes')).json.clientes.length, 0);
  // Obra do pedido atribuída ao técnico.
  assert.equal((await api('ceo', 'POST', `orcamentos/${id}`, { estado: 'aceite' })).estado, 200);
  const obra = p.app.db.prepare('SELECT obra_id FROM orcamentos WHERE id = ?').get(id).obra_id;
  assert.equal((await api('ceo', 'POST', `obras/${obra}`, { tecnicos: [p.u.tecnico.id] })).estado, 200);
  let r = await api('tecnico', 'GET', `crm/clientes/${k}`);
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.registos.length, 2);
  assert.ok(!('pagamentos' in r.json) && !('valor_proposta' in r.json.pedidos[0]), 'sem dados financeiros');
  assert.deepEqual(r.json.pode.registar, ['visita']);
  assert.deepEqual((await api('tecnico', 'GET', 'crm/clientes')).json.clientes.map((c) => c.id), [k]);
  assert.equal((await api('tecnico', 'GET', `crm/clientes/${k2}`)).estado, 404);
  assert.equal((await api('tecnico', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'x' })).estado, 403);
  assert.equal((await api('tecnico', 'POST', `crm/clientes/${k}/registos`, { tipo: 'chamada', texto: 'x' })).estado, 403);
  assert.equal((await api('tecnico', 'POST', `crm/clientes/${k2}/registos`, { tipo: 'visita', texto: 'x' })).estado, 404);
  r = await api('tecnico', 'POST', `crm/clientes/${k}/registos`, { tipo: 'visita', texto: 'Visita feita, quadro antigo.' });
  assert.equal(r.estado, 201, r.texto);
  assert.equal(r.json.registos[0].tipo, 'visita');
  assert.equal(r.json.registos[0].por, p.u.tecnico.email);
  // Editar a ficha: CEO e comercial; técnico não.
  assert.equal((await api('tecnico', 'POST', `crm/clientes/${k}`, { nome: 'X' })).estado, 403);
  r = await api('comercial', 'POST', `crm/clientes/${k}`, { telefone: '934 000 111', responsavel_id: p.u.comercial.id });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.cliente.responsavel_nome, 'comercial teste');
  // O texto das notas não vai para a auditoria.
  const aud = p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'crm_registo'").all().map((x) => x.detalhes).join(' ');
  assert.ok(!/Cão no quintal|quadro antigo/.test(aud));
});

test('lembretes: pedido novo sem contacto ao fim de 1 dia útil (sexta → segunda; o fim de semana não conta), idempotente e cancelado quando a fase avança', async () => {
  // Dias úteis (segunda a sexta, Lisboa, sem os feriados nacionais): 2026-10-16 é sexta-feira.
  assert.equal(aposDiasUteis('2026-10-15T09:30', 1), '2026-10-16T09:30');
  assert.equal(aposDiasUteis('2026-10-16T15:00', 1), '2026-10-19T15:00', 'sexta → segunda à mesma hora');
  assert.equal(aposDiasUteis('2026-10-17T10:00', 1), '2026-10-20T00:00', 'sábado: conta de segunda às 00:00');
  assert.equal(aposDiasUteis('2026-10-18T23:00', 1), '2026-10-20T00:00', 'domingo: igual');
  assert.equal(aposDiasUteis('2026-10-15T09:30', 3), '2026-10-20T09:30');
  // Feriados nacionais: 2026-10-05 (segunda-feira) é feriado fixo; em 2026 a Páscoa é a 5 de abril.
  assert.equal(aposDiasUteis('2026-10-02T15:00', 1), '2026-10-06T15:00', 'sexta + feriado à segunda → terça');
  assert.equal(aposDiasUteis('2026-10-05T10:00', 1), '2026-10-07T00:00', 'feriado: conta do dia útil seguinte às 00:00');
  for (const d of ['2026-04-03', '2026-04-05', '2026-06-04', '2026-12-25']) assert.equal(feriadoNacional(d), true, d);
  for (const d of ['2026-04-06', '2026-02-17', '2026-10-06']) assert.equal(feriadoNacional(d), false, d);
  await avancarAte(5, '15:00');   // sexta-feira às 15:00
  const id = await pedidoSite({ nome: 'Eva Lembrete', email: 'eva.lembrete@exemplo.pt' });
  await avancar(25 * HORA);       // sábado às 16:00: passaram 24 h, mas não um dia útil
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id).length, 0, 'ao sábado não há lembrete');
  await avancarAte(1, '14:00');   // segunda-feira, uma hora antes
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id).length, 0, 'antes de um dia útil não há lembrete');
  await avancar(65 * 60_000);     // segunda-feira às 15:05
  let r = await api('ceo', 'GET', 'tarefas?vista=minhas');
  const t = r.json.tarefas.find((x) => x.orcamento_id === id);
  assert.ok(t, 'o lembrete aparece nas tarefas do CEO (sem responsável = os CEO)');
  assert.equal(t.titulo, 'Ligar a Eva Lembrete — pedido novo');
  assert.equal(t.responsavel_id, null);
  assert.equal(t.automatica, 'novo_24h');
  assert.equal(t.hoje, true);
  // Idempotente: mais leituras (e o temporizador) não o repetem.
  await api('comercial', 'GET', 'tarefas');
  await api('ceo', 'GET', 'tarefas/contagem');
  p.app.api.tarefas.lembretes();
  assert.equal(tarefasDe(id).length, 1);
  // Sem responsável é dos CEO: o comercial não o vê (nem no quadro, nem pelo número).
  assert.ok(!(await api('comercial', 'GET', 'tarefas')).json.tarefas.some((x) => x.id === t.id));
  assert.equal((await api('comercial', 'POST', `tarefas/${t.id}`, { estado: 'feito' })).estado, 404);
  // Os lembretes automáticos não se apagam.
  assert.equal((await api('ceo', 'POST', `tarefas/${t.id}/apagar`, {})).estado, 409);
  // Contacto registado → contactado → o lembrete é cancelado (sai do quadro, fica na base) e não volta.
  await api('comercial', 'POST', `crm/clientes/${fichaDe(id)}/registos`, { tipo: 'email', texto: 'Respondido por email.' });
  r = await api('ceo', 'GET', 'tarefas');
  assert.ok(!r.json.tarefas.some((x) => x.id === t.id));
  assert.ok(tarefasDe(id)[0].cancelada);
  await avancar(DIA);
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id).length, 1);
  // Um pedido de sábado: o dia útil conta de segunda às 00:00, o lembrete nasce na terça.
  await avancarAte(6, '11:00');
  const id2 = await pedidoSite({ nome: 'Sara Sábado', email: 'sara.sabado@exemplo.pt' });
  await avancarAte(1, '23:00');
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id2).length, 0, 'na segunda ainda não');
  await avancar(2 * HORA);
  await api('ceo', 'GET', 'tarefas');
  assert.deepEqual(tarefasDe(id2).map((x) => x.lembrete.split(':')[1]), ['novo_24h']);
});

test('lembretes: visita feita e proposta por enviar ao fim de 2 dias; some com a proposta; remarcar a visita dá outro', async () => {
  const id = await pedidoSite({ nome: 'Vera Visita', email: 'vera.visita@exemplo.pt' });
  await api('ceo', 'POST', `crm/pedidos/${id}`, { responsavel_id: p.u.comercial.id });
  const abertos = () => tarefasDe(id).filter((t) => !t.cancelada);
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}/marcar-visita`, { data_visita: agoraLisboa(p.relogio.agora() + 2 * HORA) })).estado, 200);
  await avancar(49 * HORA);       // 47 h depois da visita
  await api('comercial', 'GET', 'tarefas');
  assert.equal(tarefasDe(id).length, 0, 'antes dos 2 dias (e sem o lembrete do pedido novo: já tem visita)');
  await avancar(2 * HORA);
  let r = await api('comercial', 'GET', 'tarefas?vista=minhas');
  let t = r.json.tarefas.filter((x) => x.orcamento_id === id);
  assert.deepEqual(t.map((x) => x.titulo), ['Enviar proposta — Vera Visita']);
  assert.equal(t[0].automatica, 'visita_2d');
  assert.equal(t[0].responsavel_id, p.u.comercial.id);
  p.app.api.tarefas.lembretes();
  await api('ceo', 'GET', 'tarefas/contagem');
  assert.equal(tarefasDe(id).length, 1, 'idempotente');
  // Remarcar a visita para o futuro cancela-o; passados 2 dias da nova data nasce outro (chave nova).
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}/marcar-visita`, { data_visita: agoraLisboa(p.relogio.agora() + DIA) })).estado, 200);
  await api('comercial', 'GET', 'tarefas');
  assert.equal(abertos().length, 0);
  await avancar(3 * DIA + HORA);
  await api('comercial', 'GET', 'tarefas');
  assert.equal(abertos().length, 1);
  assert.equal(tarefasDe(id).length, 2);
  // Proposta enviada: o lembrete some sozinho.
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'proposta_enviada', valor_proposta: 900 })).estado, 200);
  await api('comercial', 'GET', 'tarefas');
  assert.equal(abertos().length, 0);
  // Visita só com o dia (sem hora): conta do fim desse dia.
  const id2 = await pedidoSite({ nome: 'Vasco Sem Hora', email: 'vasco.semhora@exemplo.pt' });
  assert.equal((await api('ceo', 'POST', `orcamentos/${id2}`, { estado: 'visita_marcada', data_visita: hojeLisboa() })).estado, 200);
  await avancar(2 * DIA);
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id2).length, 0);
  await avancar(DIA);
  await api('ceo', 'GET', 'tarefas');
  assert.deepEqual(tarefasDe(id2).map((x) => x.titulo), ['Enviar proposta — Vasco Sem Hora']);
});

test('lembretes: prazos editáveis pelo CEO, com limites validados no servidor; mudar um prazo não duplica lembretes', async () => {
  const cfg = async () => (await api('ceo', 'GET', 'config-orcamento')).json;
  const chaves = ['lembrete_novo_dias_uteis', 'lembrete_visita_dias', 'lembrete_proposta_1_dias', 'lembrete_proposta_2_dias', 'lembrete_proposta_3_dias'];
  const omissao = { lembrete_novo_dias_uteis: 1, lembrete_visita_dias: 2, lembrete_proposta_1_dias: 3, lembrete_proposta_2_dias: 7, lembrete_proposta_3_dias: 14 };
  assert.deepEqual(Object.fromEntries(chaves.map((k) => [k, (p.app.db.prepare('SELECT valor FROM config_orcamento WHERE chave = ?').get(k) ?? {}).valor])), omissao);
  assert.deepEqual(p.app.api.tarefas.prazos(), omissao);
  const mudar = (papel, corpo) => api(papel, 'POST', 'config-orcamento', corpo);
  // Só o CEO; limites; inteiros; os três da proposta crescentes.
  assert.equal((await mudar('comercial', { lembrete_visita_dias: 3 })).estado, 403);
  assert.equal((await mudar('tecnico', { lembrete_visita_dias: 3 })).estado, 403);
  for (const corpo of [{ lembrete_novo_dias_uteis: 0 }, { lembrete_novo_dias_uteis: 11 }, { lembrete_novo_dias_uteis: 1.5 }, { lembrete_novo_dias_uteis: 'já' },
    { lembrete_visita_dias: 31 }, { lembrete_proposta_3_dias: 91 }, { lembrete_proposta_1_dias: 7 }, { lembrete_proposta_1_dias: 10, lembrete_proposta_2_dias: 5 },
    { lembrete_proposta_3_dias: 7 }]) {
    assert.equal((await mudar('ceo', corpo)).estado, 400, JSON.stringify(corpo));
  }
  assert.deepEqual(p.app.api.tarefas.prazos(), omissao, 'um pedido recusado não muda nada');
  // O /api/catalogo (público) não mostra estes prazos.
  assert.ok(!JSON.stringify((await p.pedir('GET', '/api/catalogo')).json).includes('lembrete_'));
  try {
    let r = await mudar('ceo', { lembrete_proposta_1_dias: 1, lembrete_proposta_2_dias: 2, lembrete_proposta_3_dias: 5 });
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await cfg()).lembrete_proposta_2_dias, 2);
    const id = await pedidoSite({ nome: 'Paulo Prazos', email: 'paulo.prazos@exemplo.pt' });
    assert.equal((await api('ceo', 'POST', `orcamentos/${id}`, { estado: 'proposta_enviada', valor_proposta: 700 })).estado, 200);
    const abertos = () => tarefasDe(id).filter((t) => !t.cancelada).map((t) => t.titulo);
    await avancar(25 * HORA);
    await api('ceo', 'GET', 'tarefas');
    assert.deepEqual(abertos(), ['Seguir proposta — Paulo Prazos'], '1.º aviso ao fim de 1 dia');
    await avancar(DIA);
    await api('ceo', 'GET', 'tarefas');
    assert.deepEqual(abertos(), ['Seguir proposta — Paulo Prazos (2 dias)']);
    // O CEO alarga o 2.º prazo: o lembrete de 2 dias deixa de ser devido e o do 1.º aviso volta (o mesmo, não outro).
    assert.equal((await mudar('ceo', { lembrete_proposta_2_dias: 4 })).estado, 200);
    await api('ceo', 'GET', 'tarefas');
    assert.deepEqual(abertos(), ['Seguir proposta — Paulo Prazos']);
    assert.equal(tarefasDe(id).length, 2, 'sem duplicados');
    // Um dia útil a mais no pedido novo: o lembrete nasce mais tarde.
    assert.equal((await mudar('ceo', { lembrete_novo_dias_uteis: 2 })).estado, 200);
    await avancarAte(2, '10:00');   // terça-feira
    const novo = await pedidoSite({ nome: 'Nuno Dois Dias', email: 'nuno.doisdias@exemplo.pt' });
    await avancar(DIA + HORA);      // quarta: 1 dia útil
    await api('ceo', 'GET', 'tarefas');
    assert.equal(tarefasDe(novo).length, 0);
    await avancar(DIA);             // quinta: 2 dias úteis
    await api('ceo', 'GET', 'tarefas');
    assert.equal(tarefasDe(novo).length, 1);
  } finally {
    assert.equal((await mudar('ceo', omissao)).estado, 200);
  }
});

test('lembretes: proposta sem resposta aos 3 e 7 dias e "Perdido?" aos 14; vão para o responsável; a fase só muda com a pessoa', async () => {
  const id = await pedidoSite({ nome: 'Filipe Proposta', email: 'filipe.proposta@exemplo.pt' });
  await api('ceo', 'POST', `crm/pedidos/${id}`, { responsavel_id: p.u.comercial.id });
  assert.equal((await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'proposta_enviada', valor_proposta: 800 })).estado, 200);
  const abertos = () => tarefasDe(id).filter((t) => !t.cancelada);
  await avancar(2 * DIA + 23 * HORA);
  await api('comercial', 'GET', 'tarefas');
  assert.equal(abertos().length, 0, 'antes dos 3 dias nada');
  await avancar(2 * HORA);
  let r = await api('comercial', 'GET', 'tarefas?vista=minhas');
  let t = r.json.tarefas.filter((x) => x.orcamento_id === id);
  assert.deepEqual(t.map((x) => x.titulo), ['Seguir proposta — Filipe Proposta']);
  assert.equal(t[0].responsavel_id, p.u.comercial.id);
  assert.equal(t[0].automatica, 'proposta_3d');
  // Contagem do menu: a do comercial conta-o (é para hoje); daqui a 2 dias está atrasado.
  assert.equal((await api('comercial', 'GET', 'tarefas/contagem')).json.hoje >= 1, true);
  // Dia 7: o de 3 dias é substituído (cancelado) pelo de 7.
  await avancar(4 * DIA);
  await api('comercial', 'GET', 'tarefas');
  assert.deepEqual(abertos().map((x) => x.lembrete.split(':')[1]), ['proposta_7d']);
  assert.ok((await api('comercial', 'GET', 'tarefas/contagem')).json.total >= 1);
  // Dia 14: "Perdido?" — e a fase continua "proposta" até a pessoa decidir.
  await avancar(7 * DIA);
  r = await api('comercial', 'GET', 'tarefas');
  t = r.json.tarefas.filter((x) => x.orcamento_id === id);
  assert.deepEqual(t.map((x) => x.titulo), ['Perdido? — Filipe Proposta']);
  assert.equal(p.app.db.prepare('SELECT estado FROM orcamentos WHERE id = ?').get(id).estado, 'proposta_enviada');
  p.app.api.tarefas.lembretes();
  assert.equal(tarefasDe(id).length, 3, 'nunca em duplicado');
  // Decidir "perdido" cancela o lembrete.
  await api('comercial', 'POST', `orcamentos/${id}`, { estado: 'perdido', motivo_perda_tipo: 'sem_resposta' });
  await api('comercial', 'GET', 'tarefas');
  assert.equal(abertos().length, 0);
  // Uma proposta aceite online (à espera do sinal) não gera lembretes.
  const id2 = await pedidoSite({ nome: 'Gil Aceitou', email: 'gil@exemplo.pt' });
  await api('ceo', 'POST', `orcamentos/${id2}`, { estado: 'proposta_enviada', valor_proposta: 500 });
  p.app.db.prepare('UPDATE orcamentos SET proposta_aceite = ? WHERE id = ?').run(new Date().toISOString(), id2);
  await avancar(4 * DIA);
  await api('ceo', 'GET', 'tarefas');
  assert.equal(tarefasDe(id2).length, 0);
});

test('tarefas: criar, editar, checklist, feito, apagar e permissões por papel', async () => {
  // Validação.
  assert.equal((await api('comercial', 'POST', 'tarefas', {})).estado, 400);
  assert.equal((await api('comercial', 'POST', 'tarefas', { titulo: 'x', prazo_hora: '10:00' })).estado, 400, 'hora sem dia');
  assert.equal((await api('comercial', 'POST', 'tarefas', { titulo: 'x', checklist: [{ texto: 'a', extra: 1 }] })).estado, 400);
  assert.equal((await api('comercial', 'POST', 'tarefas', { titulo: 'x', estado: 'parada' })).estado, 400);
  // Criar (sem responsável: quem cria).
  let r = await api('comercial', 'POST', 'tarefas', { titulo: 'Encomendar material', descricao: 'Disjuntores 16 A', prazo: '2030-01-10', prazo_hora: '09:30',
    checklist: [{ texto: 'Pedir preço' }, { texto: 'Confirmar stock', feito: true }] });
  assert.equal(r.estado, 201, r.texto);
  const t = r.json;
  assert.equal(t.responsavel_id, p.u.comercial.id);
  assert.equal(t.estado, 'a_fazer');
  assert.deepEqual(t.checklist, [{ texto: 'Pedir preço', feito: false }, { texto: 'Confirmar stock', feito: true }]);
  // Mover no quadro e marcar a checklist.
  r = await api('comercial', 'POST', `tarefas/${t.id}`, { estado: 'em_curso', checklist: [{ texto: 'Pedir preço', feito: true }, { texto: 'Confirmar stock', feito: true }] });
  assert.equal(r.json.estado, 'em_curso');
  assert.equal(r.json.checklist.every((x) => x.feito), true);
  r = await api('ceo', 'POST', `tarefas/${t.id}`, { estado: 'feito' });
  assert.equal(r.json.feito_por, p.u.ceo.email);
  assert.ok(r.json.feito);
  r = await api('ceo', 'POST', `tarefas/${t.id}`, { estado: 'a_fazer' });
  assert.equal(r.json.feito, null);
  // Técnico: não vê as tarefas dos outros; cria as suas (só para si e só ligadas às suas obras).
  assert.ok(!(await api('tecnico', 'GET', 'tarefas')).json.tarefas.some((x) => x.id === t.id));
  assert.equal((await api('tecnico', 'POST', `tarefas/${t.id}`, { estado: 'feito' })).estado, 404);
  assert.equal((await api('tecnico', 'POST', 'tarefas', { titulo: 'x', responsavel_id: p.u.comercial.id })).estado, 403);
  const k = p.app.db.prepare('SELECT id FROM crm_clientes LIMIT 1').get().id;
  assert.equal((await api('tecnico', 'POST', 'tarefas', { titulo: 'x', cliente_id: k })).estado, 403);
  const obraAlheia = Number(p.app.db.prepare("INSERT INTO obras (cliente, data, estado, criado, atualizado) VALUES ('', '2030-01-01', 'agendada', 'x', 'x')").run().lastInsertRowid);
  assert.equal((await api('tecnico', 'POST', 'tarefas', { titulo: 'x', obra_id: obraAlheia })).estado, 403);
  r = await api('tecnico', 'POST', 'tarefas', { titulo: 'Levar escada', prazo: '2030-01-11' });
  assert.equal(r.estado, 201);
  const tt = r.json;
  assert.ok((await api('tecnico', 'GET', 'tarefas?vista=minhas')).json.tarefas.some((x) => x.id === tt.id));
  assert.equal((await api('tecnico', 'POST', `tarefas/${tt.id}`, { estado: 'feito' })).estado, 200);
  // O CEO atribui uma tarefa ao técnico: ele vê-a e muda o estado.
  r = await api('ceo', 'POST', 'tarefas', { titulo: 'Rever quadro', responsavel_id: p.u.tecnico.id });
  assert.ok((await api('tecnico', 'GET', 'tarefas')).json.tarefas.some((x) => x.id === r.json.id));
  assert.equal((await api('tecnico', 'POST', `tarefas/${r.json.id}`, { estado: 'em_curso' })).estado, 200);
  // Apagar: quem criou ou o CEO.
  assert.equal((await api('tecnico', 'POST', `tarefas/${r.json.id}/apagar`, {})).estado, 403);
  assert.equal((await api('ceo', 'POST', `tarefas/${r.json.id}/apagar`, {})).estado, 200);
  assert.equal((await api('comercial', 'POST', `tarefas/${t.id}/apagar`, {})).estado, 200);
  assert.equal((await api('comercial', 'POST', `tarefas/${t.id}/apagar`, {})).estado, 404);
  // Ligada a um pedido: fica também ligada à ficha do cliente do pedido.
  const id = await pedidoSite({ nome: 'Hugo Tarefa', email: 'hugo@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  r = await api('comercial', 'POST', 'tarefas', { titulo: 'Enviar catálogo', orcamento_id: id });
  assert.equal(r.json.cliente_id, fichaDe(id));
  // A auditoria não leva o título.
  assert.ok(!p.app.db.prepare("SELECT 1 FROM auditoria WHERE acao LIKE 'tarefa_%' AND detalhes LIKE '%Encomendar%'").get());
});

test('semana: tarefas com prazo e obras agendadas (só leitura), por papel; contagem do menu', async () => {
  const hoje = (await api('ceo', 'GET', 'tarefas/calendario')).json.hoje;
  const r0 = await api('ceo', 'GET', `tarefas/calendario?de=${hoje}`);
  assert.equal(r0.json.dias.length, 7);
  const { inicio, fim } = r0.json;
  const t = (await api('ceo', 'POST', 'tarefas', { titulo: 'Tarefa da semana', prazo: inicio, prazo_hora: '08:00' })).json;
  const fora = (await api('ceo', 'POST', 'tarefas', { titulo: 'Fora da semana', prazo: '2099-01-01' })).json;
  const obra = (await api('ceo', 'POST', 'obras', { cliente: 'semana-x', data: fim })).json;
  // (cliente desconhecido → a obra não se cria pelo endpoint; usa-se a base)
  const obraId = obra?.id ?? Number(p.app.db.prepare("INSERT INTO obras (cliente, data, estado, criado, atualizado) VALUES ('', ?, 'agendada', 'x', 'x')").run(fim).lastInsertRowid);
  let r = await api('ceo', 'GET', `tarefas/calendario?de=${inicio}`);
  assert.ok(r.json.tarefas.some((x) => x.id === t.id));
  assert.ok(!r.json.tarefas.some((x) => x.id === fora.id));
  assert.ok(r.json.obras.some((x) => x.id === obraId));
  // O técnico só vê as suas obras e as suas tarefas.
  r = await api('tecnico', 'GET', `tarefas/calendario?de=${inicio}`);
  assert.ok(!r.json.obras.some((x) => x.id === obraId));
  assert.ok(!r.json.tarefas.some((x) => x.id === t.id));
  p.app.db.prepare('INSERT INTO obra_tecnicos (obra_id, utilizador_id) VALUES (?, ?)').run(obraId, p.u.tecnico.id);
  assert.ok((await api('tecnico', 'GET', `tarefas/calendario?de=${inicio}`)).json.obras.some((x) => x.id === obraId));
  assert.equal((await api('ceo', 'GET', 'tarefas/calendario?de=ontem')).estado, 400);
  // Contagem: uma tarefa do CEO atrasada conta.
  const antes = (await api('ceo', 'GET', 'tarefas/contagem')).json;
  await api('ceo', 'POST', 'tarefas', { titulo: 'Atrasada', prazo: '2020-01-01' });
  const depois = (await api('ceo', 'GET', 'tarefas/contagem')).json;
  assert.equal(depois.atrasadas, antes.atrasadas + 1);
  assert.equal(depois.total, depois.atrasadas + depois.hoje);
});

test('tarefas: só o CEO vê e atribui as de todos; o comercial só as suas (lista, ficha, contagem, semana, ficha do cliente)', async () => {
  const nova = async (papel, corpo) => { const r = await api(papel, 'POST', 'tarefas', corpo); assert.equal(r.estado, 201, r.texto); return r.json; };
  const doCeo = await nova('ceo', { titulo: 'Só do CEO', prazo: '2020-02-04' });
  const doTec = await nova('ceo', { titulo: 'Do técnico', responsavel_id: p.u.tecnico.id, prazo: '2020-02-04' });
  const paraCom = await nova('ceo', { titulo: 'Para o comercial', responsavel_id: p.u.comercial.id, prazo: '2020-02-05' });
  const semDono = await nova('ceo', { titulo: 'Sem dono', responsavel_id: null });
  const ids = (r) => r.json.tarefas.map((x) => x.id);
  // Lista (qualquer vista ou filtro): só as suas.
  for (const q of ['tarefas', 'tarefas?vista=todas', `tarefas?responsavel=${p.u.ceo.id}`, 'tarefas?vista=minhas']) {
    const v = ids(await api('comercial', 'GET', q));
    for (const t of [doCeo, doTec, semDono]) assert.ok(!v.includes(t.id), `${q}: ${t.titulo}`);
  }
  assert.ok(ids(await api('comercial', 'GET', 'tarefas')).includes(paraCom.id));
  for (const t of [doCeo, doTec, paraCom, semDono]) assert.ok(ids(await api('ceo', 'GET', 'tarefas')).includes(t.id));
  // A equipa (para atribuir) só vai inteira para o CEO.
  assert.deepEqual((await api('comercial', 'GET', 'tarefas')).json.equipa.map((x) => x.id), [p.u.comercial.id]);
  assert.ok((await api('ceo', 'GET', 'tarefas')).json.equipa.length >= 3);
  // Uma tarefa alheia pelo número: 404 (não sabe que existe), a editar e a apagar.
  for (const t of [doCeo, doTec, semDono]) {
    assert.equal((await api('comercial', 'POST', `tarefas/${t.id}`, { estado: 'feito' })).estado, 404);
    assert.equal((await api('comercial', 'POST', `tarefas/${t.id}/apagar`, {})).estado, 404);
  }
  assert.equal((await api('comercial', 'POST', `tarefas/${paraCom.id}`, { estado: 'em_curso' })).estado, 200);
  assert.equal((await api('comercial', 'POST', `tarefas/${paraCom.id}/apagar`, {})).estado, 403, 'não a criou');
  // Atribuir: só a si próprio (nem a outra pessoa, nem aos CEO).
  assert.equal((await api('comercial', 'POST', 'tarefas', { titulo: 'x', responsavel_id: p.u.tecnico.id })).estado, 403);
  assert.equal((await api('comercial', 'POST', 'tarefas', { titulo: 'x', responsavel_id: null })).estado, 403);
  const minha = await nova('comercial', { titulo: 'Minha', responsavel_id: p.u.comercial.id });
  assert.equal(minha.responsavel_id, p.u.comercial.id);
  assert.equal((await api('comercial', 'POST', `tarefas/${minha.id}`, { responsavel_id: p.u.ceo.id })).estado, 403);
  assert.equal((await api('comercial', 'POST', `tarefas/${paraCom.id}`, { responsavel_id: null })).estado, 403);
  // O CEO passa-a a outra pessoa: quem a criou continua a vê-la e a guardá-la (sem mudar o responsável), mas não a passa a terceiros.
  assert.equal((await api('ceo', 'POST', `tarefas/${minha.id}`, { responsavel_id: p.u.tecnico.id })).estado, 200);
  let r = await api('comercial', 'POST', `tarefas/${minha.id}`, { titulo: 'Minha (revista)', responsavel_id: p.u.tecnico.id });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.responsavel_id, p.u.tecnico.id);
  assert.equal((await api('comercial', 'POST', `tarefas/${minha.id}`, { responsavel_id: p.u.ceo.id })).estado, 403);
  assert.equal((await api('comercial', 'POST', `tarefas/${minha.id}`, { responsavel_id: p.u.comercial.id })).estado, 200);
  // Contagem do menu: só as suas.
  const antes = (await api('comercial', 'GET', 'tarefas/contagem')).json;
  await nova('ceo', { titulo: 'Atrasada do CEO', prazo: '2020-01-01' });
  await nova('ceo', { titulo: 'Atrasada sem dono', prazo: '2020-01-01', responsavel_id: null });
  assert.deepEqual((await api('comercial', 'GET', 'tarefas/contagem')).json, antes);
  await nova('ceo', { titulo: 'Atrasada do comercial', prazo: '2020-01-01', responsavel_id: p.u.comercial.id });
  assert.equal((await api('comercial', 'GET', 'tarefas/contagem')).json.atrasadas, antes.atrasadas + 1);
  // Semana: só as suas.
  r = await api('comercial', 'GET', 'tarefas/calendario?de=2020-02-04');
  assert.deepEqual(r.json.tarefas.map((x) => x.id), [paraCom.id]);
  assert.ok((await api('ceo', 'GET', 'tarefas/calendario?de=2020-02-04')).json.tarefas.length >= 3);
  // Bloco "Tarefas" da ficha do cliente (GET tarefas?cliente=): o comercial só vê as suas desse cliente.
  const pedido = await pedidoSite({ nome: 'Tiago Tarefas', email: 'tiago.tarefas@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  const k = fichaDe(pedido);
  const daFichaCeo = await nova('ceo', { titulo: 'Do CEO na ficha', cliente_id: k });
  const daFichaCom = await nova('comercial', { titulo: 'Do comercial na ficha', cliente_id: k });
  assert.deepEqual(ids(await api('comercial', 'GET', `tarefas?cliente=${k}`)), [daFichaCom.id]);
  assert.deepEqual(ids(await api('ceo', 'GET', `tarefas?cliente=${k}`)).sort(), [daFichaCeo.id, daFichaCom.id].sort());
  // O técnico continua igual: só as suas.
  assert.deepEqual(ids(await api('tecnico', 'GET', 'tarefas')).filter((x) => [doCeo.id, paraCom.id, semDono.id].includes(x)), []);
  assert.ok(ids(await api('tecnico', 'GET', 'tarefas')).includes(doTec.id));
});

test('email diário: um por utilizador às 08:00 com as tarefas atrasadas e de hoje; nada sem tarefas; nunca dois no mesmo dia, nem depois de reiniciar', async () => {
  const T = p.app.api.tarefas;
  const diarios = () => p.emails.filter((m) => /para tratar hoje/.test(m.assunto));
  const vazio = await p.criarUtilizador('tecnico', 'vazio@domus.teste');
  const inativo = await p.criarUtilizador('comercial', 'inativo@domus.teste');
  await avancarAte(3, '07:30');   // quarta-feira, antes da hora
  const hoje = hojeLisboa();
  const deHoje = (await api('ceo', 'POST', 'tarefas', { titulo: 'Ligar ao Sr. Segredo', descricao: 'Telefone 919 999 999', responsavel_id: p.u.comercial.id, prazo: hoje, prazo_hora: '10:30' })).json;
  const semDono = (await api('ceo', 'POST', 'tarefas', { titulo: 'Sem dono de ontem', responsavel_id: null, prazo: '2020-03-03' })).json;
  const futura = (await api('ceo', 'POST', 'tarefas', { titulo: 'Futura', responsavel_id: p.u.comercial.id, prazo: '2099-01-01' })).json;
  const feita = (await api('ceo', 'POST', 'tarefas', { titulo: 'Já feita', responsavel_id: p.u.comercial.id, prazo: hoje, estado: 'feito' })).json;
  await api('ceo', 'POST', 'tarefas', { titulo: 'Do inativo', responsavel_id: inativo.id, prazo: hoje });
  p.app.db.prepare('UPDATE utilizadores SET ativo = 0 WHERE id = ?').run(inativo.id);
  p.emails.length = 0;
  assert.equal(T.resumoDiario(), 0, 'antes das 08:00 não sai nada');
  assert.equal(diarios().length, 0);
  await avancar(45 * 60_000);     // 08:15
  assert.ok(T.resumoDiario() >= 2);
  const m = diarios();
  const para = (email) => m.filter((x) => x.para === email);
  // Comercial: a de hoje (pelo número e a hora), sem a futura nem a feita; sem títulos nem descrições.
  assert.equal(para(p.u.comercial.email).length, 1);
  const mc = para(p.u.comercial.email)[0];
  assert.match(mc.texto, new RegExp(`Tarefa n\\.º ${deHoje.id} · 10:30`));
  assert.ok(!new RegExp(`n\\.º (${futura.id}|${feita.id}|${semDono.id})\\b`).test(mc.texto));
  assert.match(mc.texto, /painel\.teste\/painel\/#\/tarefas/);
  // CEO: também as sem responsável; não as dos outros.
  assert.equal(para(p.u.ceo.email).length, 1);
  assert.match(para(p.u.ceo.email)[0].texto, new RegExp(`Tarefa n\\.º ${semDono.id} · prazo 03/03/2020.*sem responsável`));
  assert.ok(!new RegExp(`n\\.º ${deHoje.id}\\b`).test(para(p.u.ceo.email)[0].texto));
  // Sem tarefas não sai nada; a um utilizador inativo também não.
  assert.equal(para(vazio.email).length, 0);
  assert.equal(para(inativo.email).length, 0);
  // Os títulos e as descrições não saem do servidor (nem no assunto, no texto ou no resumo que vai para o registo).
  for (const x of m) assert.ok(!/Segredo|919 999 999|Sem dono de ontem|Ligar a |proposta —/.test(`${x.assunto} ${x.texto} ${x.resumo}`), x.texto);
  assert.ok(!p.app.db.prepare("SELECT 1 FROM auditoria WHERE detalhes LIKE '%Segredo%'").get());
  // Nunca dois no mesmo dia: outra passagem não envia; nem um painel reiniciado sobre a mesma base.
  const n = m.length;
  assert.equal(T.resumoDiario(), 0);
  await avancar(6 * HORA);
  assert.equal(T.resumoDiario(), 0);
  const extra = [];
  const reiniciado = criarTarefas({ db: p.app.db, config: p.config, relogio: () => p.relogio.agora(), auditar: () => {}, crm: p.app.api.crm, registo: registoMudo,
    correio: { enviar: async (x) => { extra.push(x); return true; } } });
  assert.equal(reiniciado.resumoDiario(), 0);
  assert.equal(extra.length, 0);
  p.app.api.crm.aoLer(() => T.lembretes());   // as leituras do CRM voltam a usar as tarefas do painel
  assert.equal(diarios().length, n);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE ativo = 1 AND resumo_tarefas_dia = ?').get(hoje).n,
    p.app.db.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE ativo = 1').get().n);
  // No dia seguinte volta a sair (um por utilizador com tarefas).
  await avancar(DIA);
  assert.ok(T.resumoDiario() >= 2);
  assert.equal(para(p.u.comercial.email).length, 1, 'a lista de antes não mudou');
  assert.equal(diarios().filter((x) => x.para === p.u.comercial.email).length, 2);
});

test('separar (CEO): um pedido sai da ficha para uma ficha nova; a ligação automática não o volta a juntar', async () => {
  const a = await pedidoSite({ nome: 'Marido Silva', email: 'casal.silva@exemplo.pt', telefone: '915 000 111' });
  const b = await pedidoSite({ nome: 'Mulher Silva', email: 'casal.silva@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  const k = fichaDe(a);
  assert.equal(fichaDe(b), k);
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'Nota do pedido da mulher.', orcamento_id: b })).estado, 201);
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'Nota geral da ficha.' })).estado, 201);
  const t = (await api('ceo', 'POST', 'tarefas', { titulo: 'Tarefa do pedido b', orcamento_id: b })).json;
  assert.equal(t.cliente_id, k);
  // Só o CEO (o botão vem em `pode.separar`).
  assert.equal((await api('ceo', 'GET', `crm/clientes/${k}`)).json.pode.separar, true);
  assert.equal((await api('comercial', 'GET', `crm/clientes/${k}`)).json.pode.separar, false);
  assert.equal((await api('comercial', 'POST', `crm/pedidos/${b}/separar`, {})).estado, 403);
  assert.equal((await api('tecnico', 'POST', `crm/pedidos/${b}/separar`, {})).estado, 403);
  assert.equal(fichaDe(b), k, 'um pedido recusado não muda nada');
  assert.equal((await api('ceo', 'POST', 'crm/pedidos/999999/separar', {})).estado, 404);
  let r = await api('ceo', 'POST', `crm/pedidos/${b}/separar`, {});
  assert.equal(r.estado, 200, r.texto);
  const nova = r.json.nova_ficha;
  assert.ok(nova && nova !== k);
  assert.equal(fichaDe(b), nova);
  assert.equal(fichaDe(a), k);
  assert.deepEqual(r.json.pedidos.map((x) => x.id), [a]);
  assert.deepEqual(r.json.registos.map((x) => x.texto), ['Nota geral da ficha.']);
  // A ficha nova: o nome e os contactos do pedido, a nota e a tarefa desse pedido.
  r = await api('ceo', 'GET', `crm/clientes/${nova}`);
  assert.equal(r.json.cliente.nome, 'Mulher Silva');
  assert.equal(r.json.cliente.email, 'casal.silva@exemplo.pt');
  assert.deepEqual(r.json.pedidos.map((x) => x.id), [b]);
  assert.ok(r.json.pedidos[0].separado);
  assert.deepEqual(r.json.registos.map((x) => x.texto), ['Nota do pedido da mulher.']);
  assert.equal(r.json.pode.separar, false, 'só tem um pedido');
  assert.equal(p.app.db.prepare('SELECT cliente_id FROM tarefas WHERE id = ?').get(t.id).cliente_id, nova);
  assert.ok(p.app.db.prepare('SELECT crm_separado FROM orcamentos WHERE id = ?').get(b).crm_separado);
  // Auditado (sem dados pessoais).
  const aud = p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'crm_pedido_separado' AND alvo = ?").get(`crm_cliente:${k}`);
  assert.deepEqual(JSON.parse(aud.detalhes), { pedido: b, para: nova });
  // As passagens automáticas (ler o CRM, as tarefas, o temporizador) não o voltam a juntar, apesar do mesmo email.
  await api('ceo', 'GET', 'crm/clientes');
  await api('ceo', 'GET', 'crm/pedidos');
  await api('ceo', 'GET', 'tarefas');
  p.app.api.crm.ligarPedidos();
  p.app.api.tarefas.lembretes();
  assert.equal(fichaDe(b), nova);
  // Mesmo que perdesse a ficha, um pedido separado à mão não volta à antiga: ganha uma só dele.
  p.app.db.prepare('UPDATE orcamentos SET crm_cliente_id = NULL WHERE id = ?').run(b);
  p.app.api.crm.ligarPedidos();
  assert.ok(fichaDe(b) && ![k, nova].includes(fichaDe(b)));
  p.app.db.prepare('UPDATE orcamentos SET crm_cliente_id = ? WHERE id = ?').run(nova, b);
  // Um pedido novo da mesma pessoa (mesmo email) vai para a ficha de origem.
  const c = await pedidoSite({ nome: 'Marido Silva', email: 'casal.silva@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  assert.equal(fichaDe(c), k);
  // Uma ficha só com um pedido não se separa.
  assert.equal((await api('ceo', 'POST', `crm/pedidos/${b}/separar`, {})).estado, 400);
  // Juntar à mão continua a ser possível (decisão do CEO).
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/fundir`, { outro: nova })).estado, 200);
  assert.equal(fichaDe(b), k);
});

test('casas e planos: a ficha da casa traz a ficha da pessoa no CRM quando há uma ligada (e o utilizador a pode abrir)', async () => {
  const id = await pedidoSite({ nome: 'Clara Casa', email: 'clara.casa@exemplo.pt' });
  await api('ceo', 'GET', 'crm/clientes');
  const k = fichaDe(id);
  const agora = new Date().toISOString();
  p.app.db.prepare('INSERT INTO fichas_cliente (codigo, nome, contacto, localidade, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?)').run('casa-clara', 'Clara Casa', '', '', agora, agora);
  p.app.db.prepare('INSERT INTO fichas_cliente (codigo, nome, contacto, localidade, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?)').run('casa-sem-crm', 'Sem CRM', '', '', agora, agora);
  p.app.db.prepare('UPDATE orcamentos SET cliente = ? WHERE id = ?').run('casa-clara', id);
  assert.equal((await api('ceo', 'GET', 'clientes/casa-clara')).json.crm_cliente_id, k);
  assert.equal((await api('comercial', 'GET', 'clientes/casa-clara')).json.crm_cliente_id, k);
  assert.equal((await api('tecnico', 'GET', 'clientes/casa-clara')).json.crm_cliente_id, null, 'o técnico sem obra nessa casa não abre a ficha');
  assert.equal((await api('ceo', 'GET', 'clientes/casa-sem-crm')).json.crm_cliente_id, null);
});

test('RGPD: apagar a conta tira as notas e os contactos, anonimiza a ficha e deixa só um título neutro nas tarefas', async () => {
  const { cookie, email } = await p.contaConfirmada('rgpd.crm@exemplo.pt');
  const r0 = await p.pedir('POST', '/api/orcamento', { cookie, corpo: { nome: 'Inês Apagar', email, telefone: '913 222 333', servico: 'Casa inteligente',
    simulacao: { versao: 1, itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 1 }] }, origem_contacto: 'facebook' } });
  assert.equal(r0.estado, 201, r0.texto);
  const id = r0.json.pedido;
  await api('ceo', 'GET', 'crm/clientes');
  const k = fichaDe(id);
  assert.ok(k);
  await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'Mora no 3.º esquerdo.' });
  await api('comercial', 'POST', `crm/clientes/${k}/registos`, { tipo: 'chamada', texto: 'Ligar depois das 18 h.' });
  const t = (await api('comercial', 'POST', 'tarefas', { titulo: 'Ligar à Inês Apagar', descricao: 'Telefone 913 222 333', orcamento_id: id, checklist: [{ texto: 'Inês' }] })).json;
  await avancar(2 * DIA);
  const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(email).id;
  const r = await api('ceo', 'POST', `contas/${contaId}/apagar`, { email });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM crm_registos WHERE cliente_id = ?').get(k).n, 0);
  const ficha = p.app.db.prepare('SELECT * FROM crm_clientes WHERE id = ?').get(k);
  assert.equal(ficha.nome, 'Anonimizado (RGPD)');
  assert.equal(ficha.email, null);
  assert.equal(ficha.telefone, null);
  assert.ok(ficha.anonimizado);
  const tarefa = p.app.db.prepare('SELECT * FROM tarefas WHERE id = ?').get(t.id);
  assert.equal(tarefa.titulo, 'Tarefa (cliente apagado — RGPD)');
  assert.equal(tarefa.descricao, null);
  assert.equal(tarefa.checklist, '[]');
  assert.equal(tarefa.cliente_id, null);
  assert.equal(tarefa.orcamento_id, null);
  // Nada da pessoa fica na base (nem na auditoria).
  const tudo = JSON.stringify([
    p.app.db.prepare('SELECT * FROM tarefas').all(), p.app.db.prepare('SELECT * FROM crm_clientes').all(),
    p.app.db.prepare('SELECT * FROM crm_registos').all(), p.app.db.prepare('SELECT * FROM auditoria').all(),
  ]);
  for (const x of ['Inês Apagar', '913 222 333', '3.º esquerdo', 'rgpd.crm@exemplo.pt']) assert.ok(!tudo.includes(x), x);
  // A ficha anonimizada só o CEO a vê; os outros recebem 404.
  assert.equal((await api('comercial', 'GET', `crm/clientes/${k}`)).estado, 404);
  assert.equal((await api('ceo', 'GET', `crm/clientes/${k}`)).json.cliente.anonimizado !== null, true);
  // Uma ficha anonimizada não recebe registos.
  assert.equal((await api('ceo', 'POST', `crm/clientes/${k}/registos`, { tipo: 'nota', texto: 'x' })).estado, 409);
});
