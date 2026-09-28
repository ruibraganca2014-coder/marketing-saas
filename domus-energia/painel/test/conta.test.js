// Conta de cliente (/api/conta/*, docs/CONTA-CLIENTE.md): criar, código (certo/errado/expirado/limite),
// entrar/sair, esqueci/repor, sessão obrigatória no POST /api/orcamento com simulação, acesso cruzado negado,
// fotos na conta, guardar/retomar a simulação, aceitar a proposta (+409), apagar a conta (CEO), CORS e origens
// do site público (SITE_ORIGENS) e as credenciais MQTT da casa só para a conta dona.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa, iniciarPainel, SENHA, esperar } from './ajuda.js';
import { CODIGO_MS } from '../src/conta.js';

const SIM = { versao: 1, casa: { tipo: 'moradia', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1 }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 1 }], total: { min: 900, max: 1200 }, plano_sugerido: 'conforto', quadro: { pacote: 'recomendado', circuitos: [{ codigo: 'C1' }] } };
const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const ck = (r) => r.cabecalhos['set-cookie']?.[0]?.split(';')[0];

describe('conta de cliente', () => {
  let p;
  let n = 0;
  const email = () => `pessoa${++n}@exemplo.pt`;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  const conta = (metodo, caminho, opcoes = {}) => p.pedir(metodo, `/api/conta/${caminho}`, opcoes);
  const painel = (metodo, caminho, papel, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  async function pedidoComConta(c, extra = {}) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Conta', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', morada: 'Rua A, 1', simulacao: SIM, ...extra } });
    assert.equal(r.estado, 201, r.texto);
    return { id: p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id, token: r.json.fotos_token };
  }

  test('criar: 201 com cookie próprio (HttpOnly, SameSite=Lax, Path=/api), código por email; validações; 409 se já existe', async () => {
    const e = email();
    const r = await conta('POST', 'criar', { corpo: { email: e, password: SENHA } });
    assert.equal(r.estado, 201, r.texto);
    const c = r.cabecalhos['set-cookie'][0];
    assert.match(c, /^domus_conta=[A-Za-z0-9_-]{43};/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Path=\/api;/);
    assert.doesNotMatch(c, /Secure/, 'http://127.0.0.1: sem Secure');
    assert.deepEqual(r.json.conta, { email: e, confirmado: false, nome: null, telefone: null, morada: null, localidade: null });
    assert.match(p.codigo(e), /^\d{6}$/);
    assert.equal((await conta('POST', 'criar', { corpo: { email: e.toUpperCase(), password: SENHA } })).estado, 409);
    assert.equal((await conta('POST', 'criar', { corpo: { email: 'nao-e-email', password: SENHA } })).estado, 400);
    assert.equal((await conta('POST', 'criar', { corpo: { email: email(), password: 'curta' } })).estado, 400);
    assert.equal((await conta('POST', 'criar', { corpo: { email: email(), password: SENHA, extra: 1 } })).estado, 400);
    // Fora de localhost o cookie leva Secure.
    const s = await conta('POST', 'criar', { corpo: { email: email(), password: SENHA }, cabecalhos: { Host: 'api.domusenergia.pt' } });
    assert.match(s.cabecalhos['set-cookie'][0], /Secure/);
  });

  test('código: errado (restam n), certo confirma, expirado (410), 5 tentativas → esgotado (429); reenviar', async () => {
    const e = email();
    const r = await conta('POST', 'criar', { corpo: { email: e, password: SENHA } });
    const cookie = ck(r);
    const certo = p.codigo(e);
    const errado = certo === '000000' ? '111111' : '000000';
    const e1 = await conta('POST', 'confirmar', { cookie, corpo: { codigo: errado } });
    assert.equal(e1.estado, 400);
    assert.match(e1.json.erro, /Restam 4/);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: '12' } })).estado, 400);
    // Expirado
    p.relogio.avancar(CODIGO_MS + 1000);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: certo } })).estado, 410);
    // Código novo; 5 erradas esgotam-no (mesmo o certo deixa de servir)
    assert.equal((await conta('POST', 'reenviar', { cookie, corpo: {} })).estado, 200);
    const novo = p.codigo(e);
    const mau = novo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: mau } })).estado, 400);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: mau } })).estado, 429);
    assert.equal((await conta('POST', 'confirmar', { cookie, corpo: { codigo: novo } })).estado, 429);
    // Novo código → confirma
    assert.equal((await conta('POST', 'reenviar', { cookie, corpo: {} })).estado, 200);
    const ok = await conta('POST', 'confirmar', { cookie, corpo: { codigo: p.codigo(e) } });
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.conta.confirmado, true);
    // Reenviar: 3 por hora por email
    const e2 = email();
    const c2 = ck(await conta('POST', 'criar', { corpo: { email: e2, password: SENHA } }));
    assert.equal((await conta('POST', 'reenviar', { cookie: c2, corpo: {} })).estado, 200);
    assert.equal((await conta('POST', 'reenviar', { cookie: c2, corpo: {} })).estado, 200);
    const lim = await conta('POST', 'reenviar', { cookie: c2, corpo: {} });
    assert.equal(lim.estado, 429);
    assert.ok(Number(lim.cabecalhos['retry-after']) > 0);
  });

  test('entrar/sair: errada 401 (mesma mensagem que email inexistente), certa 200, sair invalida a sessão; limite por email', async () => {
    const { cookie, email: e } = await p.contaConfirmada(email());
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 200);
    const mal = await conta('POST', 'entrar', { corpo: { email: e, password: 'errada-errada' } });
    const nada = await conta('POST', 'entrar', { corpo: { email: 'ninguem@exemplo.pt', password: 'errada-errada' } });
    assert.equal(mal.estado, 401);
    assert.equal(nada.estado, 401);
    assert.equal(mal.json.erro, nada.json.erro);
    const ok = await conta('POST', 'entrar', { corpo: { email: e.toUpperCase(), password: SENHA } });
    assert.equal(ok.estado, 200);
    const c2 = ck(ok);
    assert.equal((await conta('POST', 'sair', { cookie: c2, corpo: {} })).estado, 200);
    assert.equal((await conta('GET', 'eu', { cookie: c2 })).estado, 401);
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 200, 'a outra sessão continua');
    // 5 por minuto por email (de IPs diferentes)
    const e3 = email();
    for (let i = 0; i < 5; i++) await conta('POST', 'entrar', { corpo: { email: e3, password: 'errada-errada' } });
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e3, password: 'errada-errada' } })).estado, 429);
    // Sem Origin do site: recusado (CSRF)
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA }, site: false, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
  });

  test('esqueci: mesma resposta com e sem conta; repor com o código muda a palavra-passe e fecha as sessões', async () => {
    const { cookie, email: e } = await p.contaConfirmada(email());
    const antes = p.emails.length;
    const a = await conta('POST', 'esqueci', { corpo: { email: e } });
    const b = await conta('POST', 'esqueci', { corpo: { email: 'nao-existe@exemplo.pt' } });
    assert.equal(a.estado, 200);
    assert.deepEqual(a.json, b.json);
    assert.equal(p.emails.length, antes + 1, 'só um email (o da conta que existe)');
    const codigo = p.codigo(e);
    const nova = 'palavra-passe-nova-1';
    assert.equal((await conta('POST', 'repor', { corpo: { email: e, codigo: codigo === '000000' ? '111111' : '000000', password: nova } })).estado, 400);
    assert.equal((await conta('POST', 'repor', { corpo: { email: 'nao-existe@exemplo.pt', codigo, password: nova } })).estado, 400);
    const r = await conta('POST', 'repor', { corpo: { email: e, codigo, password: nova } });
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await conta('GET', 'eu', { cookie })).estado, 401, 'sessões antigas fechadas');
    assert.equal((await conta('GET', 'eu', { cookie: ck(r) })).estado, 200);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: SENHA } })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: e, password: nova } })).estado, 200);
    // O código é de uso único.
    assert.equal((await conta('POST', 'repor', { corpo: { email: e, codigo, password: 'outra-palavra-1' } })).estado, 400);
  });

  test('POST /api/orcamento: com simulação exige sessão com email confirmado; pedido ligado à conta; sem simulação não', async () => {
    const corpo = { nome: 'Sem Conta', telefone: '912 000 222', servico: 'Casa inteligente', simulacao: SIM };
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo })).estado, 401);
    const e = email();
    const nc = ck(await conta('POST', 'criar', { corpo: { email: e, password: SENHA } }));
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo, cookie: nc })).estado, 403, 'email por confirmar');
    // Guarda a simulação em curso (é apagada depois de enviar).
    assert.equal((await conta('POST', 'simulacao', { cookie: nc, corpo: { estado: { versao: 5, passo: 6 } } })).estado, 200);
    await conta('POST', 'confirmar', { cookie: nc, corpo: { codigo: p.codigo(e) } });
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { ...corpo, email: 'outro@exemplo.pt', morada: 'Rua B, 2', localidade: 'Évora' }, cookie: nc });
    assert.equal(r.estado, 201, r.texto);
    assert.ok(r.json.fotos_token);
    const o = p.app.db.prepare('SELECT * FROM orcamentos ORDER BY id DESC LIMIT 1').get();
    assert.equal(o.email, e, 'o email do pedido é o da conta');
    assert.ok(o.conta_id);
    const eu = (await conta('GET', 'eu', { cookie: nc })).json;
    assert.equal(eu.conta.nome, 'Sem Conta');
    assert.equal(eu.conta.morada, 'Rua B, 2');
    assert.equal(eu.conta.localidade, 'Évora');
    assert.equal(eu.simulacao_atualizada, null, 'simulação em curso apagada');
    // Formulário do site (sem simulação): continua sem conta.
    const f = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Formulário', telefone: '912 000 333', servico: 'Casa inteligente' } });
    assert.equal(f.estado, 201);
    assert.equal(p.app.db.prepare('SELECT conta_id FROM orcamentos ORDER BY id DESC LIMIT 1').get().conta_id, null);
    // O painel mostra a conta do pedido.
    const d = (await painel('GET', `orcamentos/${o.id}`, 'comercial')).json;
    assert.deepEqual({ email: d.conta.email, confirmado: d.conta.confirmado }, { email: e, confirmado: true });
    assert.equal(d.morada, 'Rua B, 2');
  });

  test('acesso cruzado: cada conta só vê os seus pedidos, fotos e propostas; conta ≠ painel', async () => {
    const a = await p.contaConfirmada(email());
    const b = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    const la = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos;
    const lb = (await conta('GET', 'pedidos', { cookie: b.cookie })).json.pedidos;
    assert.deepEqual(la.map((x) => x.id), [id]);
    assert.deepEqual(lb, []);
    assert.equal(la[0].resumo.casa, 'Moradia T2');
    assert.equal(la[0].resumo.estimativa.min, 900);
    assert.ok(!('simulacao' in la[0]) && !('itens' in la[0].resumo), 'resumo simples, sem o técnico');
    const fotoA = await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } });
    assert.equal(fotoA.estado, 201, fotoA.texto);
    assert.equal((await conta('GET', `pedidos/${id}/fotos/${fotoA.json.id}`, { cookie: b.cookie })).estado, 404);
    assert.equal((await conta('POST', `pedidos/${id}/fotos`, { cookie: b.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } })).estado, 404);
    await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1000 });
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: b.cookie, corpo: {} })).estado, 404);
    assert.equal((await conta('GET', 'pedidos', { cookie: 'domus_conta=' + 'x'.repeat(43) })).estado, 401);
    // O cookie da conta não abre o painel, e o do painel não abre a conta.
    assert.equal((await p.pedir('GET', '/painel/api/eu', { cookie: a.cookie })).estado, 401);
    assert.equal((await p.pedir('GET', '/painel/api/orcamentos', { cookie: a.cookie })).estado, 401);
    assert.equal((await conta('GET', 'eu', { cookie: p.cookies.ceo })).estado, 401);
    // Sem email confirmado: não vê pedidos.
    const nc = ck(await conta('POST', 'criar', { corpo: { email: email(), password: SENHA } }));
    assert.equal((await conta('GET', 'pedidos', { cookie: nc })).estado, 403);
  });

  test('fotos na conta: acrescentar/trocar com as validações de fotos.js; ver; 409 depois de aceite', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    const enviar = (corpo, cab = {}, tipo = 'image/jpeg') => conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo, tipo, cabecalhos: { 'X-Foto-Chave': 'conta1:outra', ...cab } });
    assert.equal((await enviar(Buffer.from('não é imagem'))).estado, 415);
    assert.equal((await enviar(JPEG(), { 'X-Foto-Chave': 'chave inválida' })).estado, 400);
    assert.equal((await enviar(JPEG(1024 * 1024 + 10))).estado, 413);
    assert.equal((await enviar(JPEG(), {}, 'text/plain')).estado, 415);
    const r1 = await enviar(JPEG(100, 1), { 'X-Foto-Legenda': encodeURIComponent('Sala') });
    assert.equal(r1.estado, 201, r1.texto);
    const r2 = await enviar(JPEG(100, 2));
    assert.equal(r2.estado, 201);
    let ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.equal(ped.fotos.length, 1, 'a mesma chave troca a foto');
    assert.equal(ped.fotos[0].id, r2.json.id);
    assert.equal(ped.pode_fotos, true);
    const img = await p.pedir('GET', ped.fotos[0].url, { cookie: a.cookie });
    assert.equal(img.estado, 200);
    assert.equal(img.cabecalhos['content-type'], 'image/jpeg');
    assert.equal(img.bruto[50], 2);
    // O painel vê-a.
    assert.equal((await painel('GET', `orcamentos/${id}`, 'comercial')).json.fotos.length, 1);
    // Aceite → já não aceita fotos.
    await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'aceite' });
    assert.equal((await enviar(JPEG())).estado, 409);
    ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.equal(ped.pode_fotos, false);
  });

  test('simulação guardada na conta: guardar, retomar noutra sessão (outro aparelho), apagar; limites', async () => {
    const a = await p.contaConfirmada(email());
    const estado = { versao: 5, passo: 3, casa: { tipo: 'apartamento' }, planta: { fundo: 'data:image/png;base64,AAAA' } };
    const g = await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado } });
    assert.equal(g.estado, 200);
    assert.ok(g.json.atualizado);
    const outra = ck(await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } }));
    const l = await conta('GET', 'simulacao', { cookie: outra });
    assert.deepEqual(l.json.estado, estado);
    assert.equal(l.json.atualizado, g.json.atualizado);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: [1] } })).estado, 400);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: { x: 'data:text/html;base64,AAAA' } } })).estado, 400);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: { x: 'a'.repeat(1_600_000) } } })).estado, 413);
    assert.equal((await conta('POST', 'simulacao', { corpo: { estado } })).estado, 401);
    assert.equal((await conta('POST', 'simulacao', { cookie: a.cookie, corpo: { estado: null } })).estado, 200);
    assert.equal((await conta('GET', 'simulacao', { cookie: outra })).json.estado, null);
  });

  test('aceitar a proposta: valor e texto do painel; aceite com auditoria (IP) e histórico; 409 se já aceite/convertida', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409, 'ainda sem proposta');
    const u = await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1234.5, proposta_texto: 'Inclui tudo.\nObra em 2 dias.' });
    assert.equal(u.estado, 200, u.texto);
    const ped = (await conta('GET', 'pedidos', { cookie: a.cookie })).json.pedidos[0];
    assert.deepEqual(ped.proposta, { valor: 1234.5, texto: 'Inclui tudo.\nObra em 2 dias.', aceite: null });
    assert.equal(ped.pode_aceitar, true);
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: { valor: 999 } })).estado, 409, 'o valor mudou');
    const r = await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: { valor: 1234.5 }, ip: '203.0.113.9' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedido.estado, 'aceite');
    assert.ok(r.json.pedido.proposta.aceite);
    const aud = p.app.db.prepare('SELECT * FROM auditoria WHERE acao = \'proposta_aceite_cliente\' AND alvo = ?').get(`orcamento:${id}`);
    assert.equal(aud.ip, '203.0.113.9');
    assert.ok(aud.quando);
    const d = (await painel('GET', `orcamentos/${id}`, 'comercial')).json;
    assert.equal(d.estado, 'aceite');
    assert.equal(d.proposta_aceite, r.json.pedido.proposta.aceite);
    assert.ok(d.historico.some((x) => x.acao === 'proposta_aceite_cliente'));
    const resumo = (await painel('GET', 'resumo', 'ceo')).json;
    assert.ok(resumo.propostas_aceites_online.some((x) => x.id === id));
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409, 'já aceite');
  });

  test('credenciais MQTT da casa: só para a conta dona, depois da conversão (resultado do domus.sh cifrado)', async () => {
    const a = await p.contaConfirmada(email());
    const b = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    assert.equal((await conta('GET', 'casa', { cookie: a.cookie })).estado, 404, 'ainda sem casa');
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' });
    const cv = await painel('POST', `orcamentos/${id}/converter`, 'ceo', { codigo: 'casa-conta', data: '2026-11-01' });
    assert.equal(cv.estado, 201, cv.texto);
    const pid = cv.json.pedido.id;
    // O domus.sh escreve o resultado com a palavra-passe gerada.
    await writeFile(join(p.dados, 'pedidos-admin', `${pid}.resultado.json`), JSON.stringify({ id: pid, tipo: 'cliente', ok: true, cliente: 'casa-conta', aparelho: null, password: 'SenhaMqttGerada1', saida: '', avisos: null, concluido: new Date().toISOString() }));
    await esperar(() => p.app.db.prepare('SELECT casa_cifra FROM contas WHERE email = ?').get(a.email)?.casa_cifra);
    const cifra = p.app.db.prepare('SELECT casa_codigo, casa_cifra FROM contas WHERE email = ?').get(a.email);
    assert.equal(cifra.casa_codigo, 'casa-conta');
    assert.doesNotMatch(cifra.casa_cifra, /SenhaMqttGerada1/, 'guardada cifrada');
    const r = await conta('GET', 'casa', { cookie: a.cookie });
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual(r.json, { codigo: 'casa-conta', password: 'SenhaMqttGerada1' });
    assert.equal((await conta('GET', 'eu', { cookie: a.cookie })).json.tem_casa, true);
    assert.equal((await conta('GET', 'casa', { cookie: b.cookie })).estado, 404, 'outra conta');
    assert.equal((await conta('GET', 'casa')).estado, 401, 'sem sessão');
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT detalhes FROM auditoria').all()).includes('SenhaMqttGerada1'), 'nunca na auditoria');
    // Pedido convertido: a proposta já não se aceita e as fotos já não entram.
    assert.equal((await conta('POST', `pedidos/${id}/aceitar`, { cookie: a.cookie, corpo: {} })).estado, 409);
    assert.equal((await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } })).estado, 409);
  });

  test('painel (só CEO): lista de contas, desativar (fecha sessões), apagar com os dados pessoais (RGPD)', async () => {
    const a = await p.contaConfirmada(email());
    const { id } = await pedidoComConta(a);
    await conta('POST', `pedidos/${id}/fotos`, { cookie: a.cookie, corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Foto-Chave': 'quadro' } });
    assert.equal((await painel('GET', 'contas', 'comercial')).estado, 403);
    const l = (await painel('GET', 'contas', 'ceo')).json.contas;
    const c = l.find((x) => x.email === a.email);
    assert.equal(c.confirmado, true);
    assert.equal(c.n_pedidos, 1);
    assert.equal((await painel('POST', `contas/${c.id}`, 'ceo', { ativo: false })).estado, 200);
    assert.equal((await conta('GET', 'eu', { cookie: a.cookie })).estado, 401);
    assert.equal((await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } })).estado, 401);
    await painel('POST', `contas/${c.id}`, 'ceo', { ativo: true });
    assert.equal((await conta('POST', 'entrar', { corpo: { email: a.email, password: SENHA } })).estado, 200);
    const pasta = join(p.config.fotosDir, String(id));
    assert.equal((await readdir(pasta)).length, 1);
    const r = await painel('POST', `contas/${c.id}/apagar`, 'ceo', {});
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedidos_apagados, 1);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM contas WHERE id = ?').get(c.id).n, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE id = ?').get(id).n, 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE orcamento_id = ?').get(id).n, 0);
    await assert.rejects(readdir(pasta));
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(a.email), 'o email não fica na auditoria');
    assert.equal((await painel('POST', `contas/${c.id}/apagar`, 'ceo', {})).estado, 404);
  });
});

describe('site público noutra origem (SITE_ORIGENS): CORS e origem', () => {
  let p;
  const SITE = 'https://domusenergia.pt';
  before(async () => { p = await iniciarPainel({ env: { SITE_ORIGENS: `${SITE}, nao-e-url, https://domusenergia.pt/caminho` } }); });
  after(() => p.fechar());

  test('preflight OPTIONS: 204 só para as origens da lista, com os cabeçalhos X-Fotos-*; nunca "*"', async () => {
    const pf = (origem, caminho = '/api/conta/entrar') => p.pedir('OPTIONS', caminho, { site: false, cabecalhos: { Origin: origem, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    const ok = await pf(SITE);
    assert.equal(ok.estado, 204);
    assert.equal(ok.cabecalhos['access-control-allow-origin'], SITE);
    assert.equal(ok.cabecalhos['access-control-allow-credentials'], 'true');
    assert.match(ok.cabecalhos['access-control-allow-headers'], /X-Fotos-Token/);
    assert.match(ok.cabecalhos['access-control-allow-headers'], /X-Foto-Chave/);
    assert.equal((await pf(SITE, '/api/orcamento/fotos')).estado, 204);
    const nao = await pf('https://outro.exemplo');
    assert.equal(nao.estado, 403);
    assert.equal(nao.cabecalhos['access-control-allow-origin'], undefined);
    // O painel nunca responde a CORS.
    const painel = await pf(SITE, '/painel/api/entrar');
    assert.equal(painel.cabecalhos['access-control-allow-origin'], undefined);
  });

  test('POST do site (same-site) aceite com CORS; cross-site e origem fora da lista recusados; cookie SameSite=Lax', async () => {
    const cab = { Origin: SITE, 'Sec-Fetch-Site': 'same-site' };
    const r = await p.pedir('POST', '/api/conta/criar', { site: false, cabecalhos: cab, corpo: { email: 'site@exemplo.pt', password: SENHA } });
    assert.equal(r.estado, 201, r.texto);
    assert.equal(r.cabecalhos['access-control-allow-origin'], SITE);
    assert.match(r.cabecalhos['set-cookie'][0], /SameSite=Lax/);
    const cookie = ck(r);
    const g = await p.pedir('GET', '/api/conta/eu', { site: false, cookie, cabecalhos: { Origin: SITE, 'Sec-Fetch-Site': 'same-site' } });
    assert.equal(g.estado, 200);
    assert.equal(g.cabecalhos['access-control-allow-origin'], SITE);
    assert.equal((await p.pedir('POST', '/api/conta/entrar', { site: false, cabecalhos: { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' }, corpo: { email: 'site@exemplo.pt', password: SENHA } })).estado, 403);
    assert.equal((await p.pedir('POST', '/api/conta/entrar', { site: false, cabecalhos: { Origin: 'https://outro.exemplo', 'Sec-Fetch-Site': 'same-site' }, corpo: { email: 'site@exemplo.pt', password: SENHA } })).estado, 403);
    // O formulário do site (sem simulação) também pode vir do site público.
    const f = await p.pedir('POST', '/api/orcamento', { site: false, cabecalhos: cab, corpo: { nome: 'Site', telefone: '912 000 444', servico: 'Casa inteligente' } });
    assert.equal(f.estado, 201, f.texto);
    assert.equal(f.cabecalhos['access-control-allow-origin'], SITE);
    // Origem inválida na variável: ignorada com aviso.
    assert.ok(p.config.avisos.some((a) => /SITE_ORIGENS/.test(a)));
    assert.deepEqual(p.config.siteOrigens, [SITE]);
  });
});
