// Ligação temporária ao telemóvel (/api/ligacao/*, painel/src/ligacao.js; passo 4 do simulador): criar (token só
// com hash, 24 h, sem contacto), ler/escrever o estado com versão (ETag/304, conflito 409), token inválido/expirado,
// limites (origem, tamanho, por IP, fotos), fotos por token (as validações das fotos do pedido), passagem das fotos
// para o orçamento ao enviar, terminar ("Começar de novo"), limpeza periódica e CORS.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { iniciarPainel } from './ajuda.js';
import { LIGACAO_FOTOS_MAX } from '../src/ligacao.js';

const JPEG = (n = 2000, x = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, x)]);
const PNG = (n = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 2)]);
const ESTADO = () => ({
  versao: 1, passo: 3, casa: { tipo: 'moradia', tipologia: 'T2' },
  planta: { divisoes: [{ id: 'd1', nome: 'Sala' }], elementos: [{ id: 'e1', tipo: 'tomada', divisao: 'd1' }] },
  verificadas: [], contacto: { nome: 'Ana', telefone: '912345678', email: 'ana@exemplo.pt' },
});

describe('ligação ao telemóvel', () => {
  let p;
  before(async () => { p = await iniciarPainel({ env: { LIMITE_FOTOS_HORA: '1000', LIMITE_LIGACAO_LEITURAS_HORA: '30', SITE_ORIGENS: 'https://site.teste' } }); });
  after(() => p.fechar());

  const tk = (token) => ({ 'X-Ligacao-Token': token });
  async function criar(estado = ESTADO(), opcoes = {}) {
    const r = await p.pedir('POST', '/api/ligacao', { corpo: { estado }, ...opcoes });
    assert.equal(r.estado, 201, r.texto);
    return r.json;
  }
  const ler = (token, { etag, estado, ip } = {}) => p.pedir('GET', `/api/ligacao/estado${estado ? `?estado=${estado}` : ''}`,
    { cabecalhos: { ...tk(token), ...(etag ? { 'If-None-Match': etag } : {}) }, ip });
  const escrever = (token, base, estado) => p.pedir('POST', '/api/ligacao/estado', { corpo: { base, estado }, cabecalhos: tk(token) });
  const foto = (token, chave, corpo = JPEG(), { tipo = 'image/jpeg', legenda } = {}) => p.pedir('POST', '/api/ligacao/fotos', {
    corpo, tipo, cabecalhos: { ...tk(token), 'X-Foto-Chave': chave, ...(legenda ? { 'X-Foto-Legenda': encodeURIComponent(legenda) } : {}) },
  });

  test('criar: token forte (só o SHA-256 na base), válido 24 h, sem o contacto; origem e estado validados', async () => {
    const r = await criar();
    assert.match(r.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.versao, 1);
    assert.equal(r.versao_estado, 1);
    const falta = Date.parse(r.expira) - Date.now();
    assert.ok(falta > 23.9 * 3600_000 && falta <= 24 * 3600_000 + 5000, `expira ${r.expira}`);
    const linha = p.app.db.prepare('SELECT * FROM ligacoes').all().at(-1);
    assert.equal(linha.hash, createHash('sha256').update(r.token).digest('hex'));
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM ligacoes WHERE hash = ? OR estado LIKE ?').get(r.token, `%${r.token}%`).n, 0, 'o token nunca fica na base');
    assert.equal(JSON.parse(linha.estado).contacto, undefined, 'o contacto não passa pela ligação');
    assert.doesNotMatch(linha.estado, /912345678|ana@exemplo/);
    // Origem de outro site → 403; sem estado → 400; não-JSON → 415; imagem que não é JPEG/PNG → 400.
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: { estado: ESTADO() }, site: false, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: {} })).estado, 400);
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: { estado: null } })).estado, 400);
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: 'x', tipo: 'text/plain' })).estado, 415);
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: { estado: { planta: { fundo: { imagem: 'data:image/svg+xml;base64,AAAA' } } } } })).estado, 400);
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: { estado: ESTADO(), outro: 1 } })).estado, 400, 'campo desconhecido');
    assert.equal((await p.pedir('GET', '/api/ligacao')).estado, 405);
  });

  test('estado demasiado grande → 413; limite de ligações novas por IP → 429 com Retry-After', async () => {
    const grande = { ...ESTADO(), lixo: 'x'.repeat(1_550_000) };
    assert.equal((await p.pedir('POST', '/api/ligacao', { corpo: { estado: grande } })).estado, 413);
    const ip = '10.9.9.9';
    for (let i = 0; i < p.config.limiteLigacoesHora; i++) await criar(ESTADO(), { ip });
    const r = await p.pedir('POST', '/api/ligacao', { corpo: { estado: ESTADO() }, ip });
    assert.equal(r.estado, 429);
    assert.ok(Number(r.cabecalhos['retry-after']) > 0);
  });

  test('ler: estado com ETag; If-None-Match igual → 304 sem corpo; ?estado=<versão> omite o estado', async () => {
    const { token } = await criar();
    const r = await ler(token);
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.cabecalhos.etag, '"1"');
    assert.equal(r.json.estado.planta.divisoes[0].nome, 'Sala');
    assert.deepEqual(r.json.fotos, []);
    assert.equal(r.json.fotos_max, LIGACAO_FOTOS_MAX);
    const r304 = await ler(token, { etag: '"1"' });
    assert.equal(r304.estado, 304);
    assert.equal(r304.bruto.length, 0);
    const semEstado = await ler(token, { estado: 1 });
    assert.equal(semEstado.estado, 200);
    assert.equal(semEstado.json.estado, undefined);
  });

  test('token inválido, em falta, de outra forma ou expirado (24 h) → 404; só dá acesso a esta simulação', async () => {
    const a = await criar();
    const b = await criar({ ...ESTADO(), casa: { tipo: 'apartamento' } });
    for (const t of [undefined, 'curto', 'x'.repeat(43), a.token.slice(0, -1) + (a.token.endsWith('A') ? 'B' : 'A')]) {
      const r = await p.pedir('GET', '/api/ligacao/estado', { cabecalhos: t ? tk(t) : {} });
      assert.equal(r.estado, 404, `token ${t}`);
      assert.match(r.json.erro, /terminou ou expirou/);
    }
    assert.equal((await ler(b.token)).json.estado.casa.tipo, 'apartamento');
    assert.equal((await ler(a.token)).json.estado.casa.tipo, 'moradia');
    p.relogio.avancar(24 * 3600_000 + 1000);
    try {
      assert.equal((await ler(a.token)).estado, 404, 'expirada');
      assert.equal((await escrever(a.token, 1, ESTADO())).estado, 404);
      assert.equal((await foto(a.token, 'quadro')).estado, 404);
    } finally {
      p.relogio.avancar(-(24 * 3600_000 + 1000));
    }
  });

  test('escrever: com a versão certa sobe a versão; com uma versão antiga → 409 com o estado atual (nada se perde)', async () => {
    const { token } = await criar();
    // Computador e telemóvel leem a versão 1.
    const e1 = ESTADO();
    e1.verificadas = ['d1'];
    const ok = await escrever(token, 1, e1);
    assert.equal(ok.estado, 200, ok.texto);
    assert.equal(ok.json.versao_estado, 2);
    assert.equal(ok.cabecalhos.etag, `"${ok.json.versao}"`);
    // O outro aparelho ainda está na 1: conflito, recebe o estado atual para juntar e escrever de novo.
    const e2 = ESTADO();
    e2.planta.elementos.push({ id: 'e2', tipo: 'luz', divisao: 'd1' });
    const conflito = await escrever(token, 1, e2);
    assert.equal(conflito.estado, 409);
    assert.equal(conflito.json.versao_estado, 2);
    assert.deepEqual(conflito.json.estado.verificadas, ['d1']);
    const junto = { ...conflito.json.estado, planta: e2.planta };
    const ok2 = await escrever(token, 2, junto);
    assert.equal(ok2.estado, 200);
    const final = (await ler(token)).json.estado;
    assert.deepEqual(final.verificadas, ['d1']);
    assert.equal(final.planta.elementos.length, 2);
    // Validações: base em falta, estado inválido, contacto retirado também nas escritas.
    assert.equal((await escrever(token, undefined, ESTADO())).estado, 400);
    assert.equal((await escrever(token, 3, null)).estado, 400);
    assert.equal((await escrever(token, 3, { ...junto, contacto: { nome: 'X' } })).estado, 200);
    assert.equal((await ler(token)).json.estado.contacto, undefined);
    // Origem desconhecida → 403.
    assert.equal((await p.pedir('POST', '/api/ligacao/estado', { corpo: { base: 4, estado: junto }, site: false, cabecalhos: { ...tk(token), Origin: 'https://mau.exemplo' } })).estado, 403);
  });

  test('fotos por token: validações do pedido, aparecem nas leituras (versão sobe), substituição, apagar, só desta ligação', async () => {
    const a = await criar();
    const b = await criar();
    const r1 = await foto(a.token, 'd1:tomada', JPEG(3000), { legenda: 'Sala — Tomadas' });
    assert.equal(r1.estado, 201, r1.texto);
    assert.match(r1.json.id, /^[a-f0-9]{24}$/);
    const lido = await ler(a.token);
    assert.equal(lido.json.versao, 2, 'a foto sobe a versão (o outro aparelho vê-a no poll)');
    assert.deepEqual(lido.json.fotos.map((f) => [f.chave, f.id, f.bytes, f.legenda]), [['d1:tomada', r1.json.id, 3004, 'Sala — Tomadas']]);
    const img = await p.pedir('GET', `/api/ligacao/fotos/${r1.json.id}`, { cabecalhos: tk(a.token) });
    assert.equal(img.estado, 200);
    assert.equal(img.cabecalhos['content-type'], 'image/jpeg');
    assert.match(img.cabecalhos['content-security-policy'], /sandbox/);
    assert.deepEqual(img.bruto, JPEG(3000));
    assert.equal((await p.pedir('GET', `/api/ligacao/fotos/${r1.json.id}`, { cabecalhos: tk(b.token) })).estado, 404, 'o token de outra ligação não a vê');
    assert.equal((await p.pedir('GET', `/api/ligacao/fotos/${r1.json.id}`)).estado, 404, 'sem token');
    // Mesma chave substitui (o ficheiro antigo sai).
    const r2 = await foto(a.token, 'd1:tomada', PNG(), { tipo: 'image/png' });
    assert.equal(r2.estado, 201);
    const pasta = join(p.config.ligacoesDir, p.app.db.prepare('SELECT ligacao_id FROM ligacoes_fotos WHERE id = ?').get(r2.json.id).ligacao_id);
    assert.deepEqual(await readdir(pasta), [`${r2.json.id}.png`]);
    // Validações das fotos do pedido.
    assert.equal((await foto(a.token, 'quadro', Buffer.from('não é imagem'))).estado, 415, 'bytes mágicos');
    assert.equal((await foto(a.token, 'quadro', JPEG(), { tipo: 'image/gif' })).estado, 415);
    assert.equal((await foto(a.token, 'quadro', JPEG(1024 * 1024))).estado, 413);
    assert.equal((await foto(a.token, '../x', JPEG())).estado, 400, 'chave');
    assert.equal((await foto(a.token, 'quadro', Buffer.alloc(0))).estado, 400, 'vazia');
    // Apagar.
    const ap = await p.pedir('POST', '/api/ligacao/fotos/apagar', { corpo: { chave: 'd1:tomada' }, cabecalhos: tk(a.token) });
    assert.equal(ap.estado, 200);
    assert.equal(ap.json.apagada, true);
    assert.deepEqual((await ler(a.token)).json.fotos, []);
    assert.deepEqual(await readdir(pasta), []);
  });

  test(`máximo de ${LIGACAO_FOTOS_MAX} fotos guardadas por ligação (trocar a mesma chave continua a dar)`, async () => {
    const { token } = await criar();
    for (let i = 0; i < LIGACAO_FOTOS_MAX; i++) assert.equal((await foto(token, `d${i}:luz`, JPEG(50))).estado, 201);
    const r = await foto(token, 'd99:luz', JPEG(50));
    assert.equal(r.estado, 400);
    assert.match(r.json.erro, /máximo/);
    assert.equal((await foto(token, 'd0:luz', JPEG(60))).estado, 201, 'substituir não conta');
  });

  test('envio do pedido: as fotos indicadas passam para o orçamento (movidas, sem novo envio) e a ligação termina', async () => {
    const { token } = await criar();
    const q = await foto(token, 'quadro', JPEG(500), { legenda: 'Quadro elétrico' });
    await foto(token, 'd1:tomada', PNG(300), { tipo: 'image/png' });
    await foto(token, 'd2:luz', JPEG(200));   // linha que deixou de existir: não vai
    const lig = p.app.db.prepare('SELECT id FROM ligacoes_fotos WHERE id = ?').get(q.json.id);
    assert.ok(lig);
    const pastaLig = join(p.config.ligacoesDir, p.app.db.prepare('SELECT ligacao_id FROM ligacoes_fotos WHERE id = ?').get(q.json.id).ligacao_id);
    const { cookie } = await p.contaConfirmada();
    const simulacao = { versao: 1, fotos: [
      { chave: 'quadro', tipo: 'quadro', legenda: 'Quadro elétrico' },
      { chave: 'd1:tomada', tipo: 'tomada', divisao: 'd1', divisao_nome: 'Sala', legenda: 'Sala — Tomadas' },
      { chave: 'd3:porta', tipo: 'porta', divisao: 'd3', legenda: 'Entrada — Porta' },   // tirada no computador, vai depois
    ] };
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Ana', telefone: '912 345 678', servico: 'Simulador de orçamento', simulacao, ligacao: token }, cookie });
    assert.equal(r.estado, 201, r.texto);
    assert.deepEqual(r.json.fotos_servidor.sort(), ['d1:tomada', 'quadro']);
    const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    const noPedido = p.app.db.prepare('SELECT chave, tipo_mime, bytes FROM fotos WHERE orcamento_id = ? ORDER BY chave').all(id);
    assert.deepEqual(noPedido.map((f) => [f.chave, f.tipo_mime, f.bytes]), [['d1:tomada', 'image/png', 308], ['quadro', 'image/jpeg', 504]]);
    assert.equal((await readdir(join(p.config.fotosDir, String(id)))).length, 2);
    // A que faltava vai pelo token do pedido, como antes (conta no máximo do pedido).
    const t = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(100), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': r.json.fotos_token, 'X-Foto-Chave': 'd3:porta' } });
    assert.equal(t.estado, 201, t.texto);
    // A ligação terminou: leituras 404, pasta e registos apagados.
    assert.equal((await ler(token)).estado, 404);
    assert.equal(existsSync(pastaLig), false);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM ligacoes_fotos WHERE id = ?').get(q.json.id).n, 0);
    // Um token inválido ou já usado não dá erro no pedido (só não passa nenhuma foto).
    const r2 = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Ana', telefone: '912 345 678', servico: 'Simulador de orçamento', simulacao, ligacao: token }, cookie });
    assert.equal(r2.estado, 201);
    assert.deepEqual(r2.json.fotos_servidor, []);
  });

  test('terminar ("Começar de novo"): apaga a ligação e as fotos; idempotente', async () => {
    const { token } = await criar();
    await foto(token, 'quadro');
    const id = p.app.db.prepare('SELECT id FROM ligacoes ORDER BY criada DESC, rowid DESC').get().id;
    assert.ok(existsSync(join(p.config.ligacoesDir, id)));
    const r = await p.pedir('POST', '/api/ligacao/terminar', { corpo: {}, cabecalhos: tk(token) });
    assert.equal(r.estado, 200);
    assert.equal((await ler(token)).estado, 404);
    assert.equal(existsSync(join(p.config.ligacoesDir, id)), false);
    assert.equal((await p.pedir('POST', '/api/ligacao/terminar', { corpo: {}, cabecalhos: tk(token) })).estado, 200, 'de novo: ok');
  });

  test('limpeza: ligações expiradas (com fotos) e pastas órfãs com mais de 24 h; as recentes ficam', async () => {
    const velha = await criar();
    await foto(velha.token, 'quadro');
    const idVelha = p.app.db.prepare('SELECT id FROM ligacoes ORDER BY criada DESC, rowid DESC').get().id;
    const orfaVelha = join(p.config.ligacoesDir, 'a'.repeat(16));
    const orfaNova = join(p.config.ligacoesDir, 'b'.repeat(16));
    await mkdir(orfaVelha, { recursive: true });
    await mkdir(orfaNova, { recursive: true });
    // O relógio do painel avança 24 h a seguir: a velha fica com 25 h, a nova com 1 h.
    const antes = new Date(Date.now() - 3600_000);
    const depois = new Date(Date.now() + 23 * 3600_000);
    await utimes(orfaVelha, antes, antes);
    await utimes(orfaNova, depois, depois);
    p.relogio.avancar(24 * 3600_000 + 1000);
    let nova;
    try {
      nova = await criar();
      const r = await p.app.api.ligacoes.limpar();
      assert.ok(r.expiradas >= 1);
      assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM ligacoes WHERE id = ?').get(idVelha).n, 0);
      assert.equal(existsSync(join(p.config.ligacoesDir, idVelha)), false);
      assert.equal(existsSync(orfaVelha), false, 'órfã velha apagada');
      assert.equal(existsSync(orfaNova), true, 'órfã recente fica (pode ser uma ligação a nascer)');
      assert.equal((await ler(nova.token)).estado, 200, 'a ligação nova fica');
    } finally {
      p.relogio.avancar(-(24 * 3600_000 + 1000));
    }
  });

  test('limite de leituras por IP → 429; CORS para o site noutra origem aceita X-Ligacao-Token', async () => {
    const { token } = await criar();
    const ip = '10.8.8.8';
    // LIMITE_LIGACAO_LEITURAS_HORA=30 neste teste (por omissão 3600: um poll a cada ~4 s em 2 aparelhos).
    const L = p.config.limiteLigacaoLeiturasHora;
    let ultimo;
    for (let i = 0; i < L + 1; i++) ultimo = await ler(token, { ip, etag: '"1"' });
    assert.equal(ultimo.estado, 429);
    const pre = await p.pedir('OPTIONS', '/api/ligacao/estado', { site: false, cabecalhos: { Origin: 'https://site.teste', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-ligacao-token' } });
    assert.equal(pre.estado, 204);
    assert.match(pre.cabecalhos['access-control-allow-headers'], /X-Ligacao-Token/);
    const cors = await p.pedir('GET', '/api/ligacao/estado', { site: false, cabecalhos: { Origin: 'https://site.teste', ...tk(token) } });
    assert.equal(cors.cabecalhos['access-control-allow-origin'], 'https://site.teste');
    assert.match(cors.cabecalhos['access-control-expose-headers'], /ETag/);
  });
});

// ------------------------------------------------------------ junção no browser (web/simulador/ligacao.js)
describe('junção dos dois aparelhos (fundirEstados)', async () => {
  const { fundir, fundirEstados, paraLigacao, lerTokenLigacao, CAMPOS_LOCAIS } = await import('../../web/simulador/ligacao.js');
  const planta = (divisoes, elementos) => ({ divisoes, elementos });
  const d = (id, nome, extra = {}) => ({ id, nome, piso: 0, x_cm: 0, y_cm: 0, largura_cm: 300, altura_cm: 300, ...extra });
  const e = (id, tipo, divisao, props = {}) => ({ id, tipo, divisao, x_cm: 10, y_cm: 10, rot: 0, piso: 0, props });
  const base = () => ({
    casa: { tipo: 'moradia' }, verificadas: ['d1'], extras: { central: false, termostatos: 0 },
    planta: planta([d('d1', 'Sala'), d('d2', 'Quarto 1')], [e('e1', 'tomada', 'd1'), e('e2', 'luz', 'd1'), e('e3', 'luz', 'd2')]),
  });
  const clone = (x) => JSON.parse(JSON.stringify(x));

  test('cada lado mudou coisas diferentes: fica tudo (verificadas juntas, aparelhos dos dois, campos simples)', () => {
    const b = base();
    const pc = clone(b);   // computador: tira a luz do quarto, marca d2, liga a central
    pc.planta.elementos = pc.planta.elementos.filter((x) => x.id !== 'e3');
    pc.verificadas.push('d2');
    pc.extras.central = true;
    const tel = clone(b);  // telemóvel: tomada inteligente na sala, uma tomada nova, tira a verificação de d1
    tel.planta.elementos[0].props = { inteligente: true };
    tel.planta.elementos.push(e('e4', 'tomada', 'd2'));
    tel.verificadas = [];
    const r = fundirEstados(b, tel, pc);   // o telemóvel escreve por último
    assert.deepEqual(r.verificadas, ['d2']);
    assert.equal(r.extras.central, true);
    assert.deepEqual(r.planta.elementos.map((x) => x.id), ['e1', 'e2', 'e4']);
    assert.equal(r.planta.elementos[0].props.inteligente, true);
    // A mesma junção do outro lado dá o mesmo resultado (a ordem dos aparelhos pode mudar, o conteúdo não).
    const r2 = fundirEstados(b, pc, tel);
    const ord = (x) => ({ ...x, planta: { ...x.planta, elementos: [...x.planta.elementos].sort((a, c) => a.id.localeCompare(c.id)) } });
    assert.deepEqual(ord(r2), ord(r));
  });

  test('o mesmo aparelho mudado nos dois: campo a campo, e no mesmo campo ganha quem escreve', () => {
    const b = base();
    const a = clone(b);
    a.planta.elementos[0].x_cm = 99;
    a.planta.elementos[0].props = { inteligente: true };
    const c = clone(b);
    c.planta.elementos[0].y_cm = 77;
    c.planta.elementos[0].props = { inteligente: false, x: 1 };
    const r = fundirEstados(b, a, c);
    assert.equal(r.planta.elementos[0].x_cm, 99);
    assert.equal(r.planta.elementos[0].y_cm, 77);
    assert.equal(r.planta.elementos[0].props.inteligente, true, 'local (quem escreve) ganha no mesmo campo');
    assert.equal(r.planta.elementos[0].props.x, 1);
  });

  test('tirado num lado e não mexido no outro sai; divisão nova dos dois lados com o mesmo id não se mistura', () => {
    const b = base();
    const a = clone(b);
    a.planta.divisoes.push(d('d3', 'Cozinha'));
    a.planta.elementos.push(e('e4', 'tomada', 'd3'));
    a.verificadas.push('d3');
    const c = clone(b);
    c.planta.divisoes.push(d('d3', 'Escritório', { x_cm: 600 }));
    c.planta.elementos.push(e('e4', 'luz', 'd3'));
    c.planta.divisoes = c.planta.divisoes.filter((x) => x.id !== 'd2');
    c.planta.elementos = c.planta.elementos.filter((x) => x.divisao !== 'd2');
    const r = fundirEstados(b, a, c);
    const nomes = r.planta.divisoes.map((x) => `${x.id}:${x.nome}`);
    assert.deepEqual(nomes, ['d1:Sala', 'd3:Escritório', 'd4:Cozinha'], 'a Cozinha deste lado passou a d4');
    const cozinha = r.planta.elementos.filter((x) => x.divisao === 'd4');
    assert.deepEqual(cozinha.map((x) => x.tipo), ['tomada']);
    assert.notEqual(cozinha[0].id, 'e4', 'o aparelho novo deste lado também muda de id');
    assert.deepEqual(r.planta.elementos.filter((x) => x.divisao === 'd3').map((x) => x.tipo), ['luz']);
    assert.ok(r.verificadas.includes('d4') && !r.verificadas.includes('d3'), 'a verificação acompanha a divisão');
    assert.equal(r.planta.divisoes.some((x) => x.id === 'd2'), false, 'o Quarto 1 tirado no outro lado saiu');
  });

  test('fundir: sem mudanças deste lado fica o remoto; campos apagados; listas sem id ficam com quem escreve', () => {
    assert.deepEqual(fundir({ a: 1 }, { a: 1 }, { a: 2 }), { a: 2 });
    assert.deepEqual(fundir({ a: 1, b: 1 }, { a: 1 }, { a: 1, b: 1, c: 3 }), { a: 1, c: 3 });
    assert.deepEqual(fundir({ l: [{ n: 1 }] }, { l: [{ n: 2 }] }, { l: [{ n: 3 }] }), { l: [{ n: 2 }] });
    assert.equal(fundirEstados(null, { a: 1 }, { a: 2 }).a, 2, 'sem base (ao retomar): o do servidor');
  });

  test('paraLigacao tira o que é de cada aparelho (passo, fotos, contacto); o token só vem do fragmento', () => {
    const s = paraLigacao({ passo: 3, visitado: 5, guardado: 'x', fotosId: 'abc', contacto: { nome: 'Ana' }, casa: { tipo: 'moradia' } });
    assert.deepEqual(s, { casa: { tipo: 'moradia' } });
    assert.deepEqual(CAMPOS_LOCAIS.sort(), ['contacto', 'fotosId', 'guardado', 'passo', 'visitado']);
    const t = 'A'.repeat(43);
    assert.equal(lerTokenLigacao(`#ligar=${t}`), t);
    assert.equal(lerTokenLigacao(`ligar=${t}`), t);
    assert.equal(lerTokenLigacao('#ligar=curto'), null);
    assert.equal(lerTokenLigacao(`#ligar=${t}&x=1`), null);
    assert.equal(lerTokenLigacao(''), null);
  });
});
