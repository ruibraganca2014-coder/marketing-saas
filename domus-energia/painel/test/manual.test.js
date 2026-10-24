// Manual de instalações elétricas de baixa tensão da empresa (decisões do dono, 2026-10-24; src/manual.js, web/manual-bt.js):
// o PDF interno só sai com sessão — qualquer utilizador do painel (/painel/api/manual-instalacoes-bt.pdf) e os
// eletricistas aprovados (/api/eletricista/manual-instalacoes-bt.pdf, só com ELETRICISTAS ligado). Sem sessão, com a
// sessão de outra área (conta de cliente, painel na área do eletricista) ou com o módulo desligado: 404, como um endereço
// que não existe. Está fora de web/ e de public/: não é servido como ficheiro estático.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { painelComEquipa } from './ajuda.js';
import { MANUAL_FICHEIRO, MANUAL_NOME } from '../src/manual.js';
import { MANUAL_BT, paginaPdf, ligacaoManual } from '../public/vendor/manual-bt.js';

const PAINEL = `/painel/api/${MANUAL_NOME}`;
const AREA = `/api/eletricista/${MANUAL_NOME}`;
const DESCONHECIDO = { erro: 'Endereço desconhecido.' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const candidatura = (n) => ({
  nome: `Eletricista do Manual ${n}`, email: `manual${n}@exemplo.pt`, telefone: '910 000 000', nif: ['123456789', '245987657'][n % 2], dgeg: `TR-${2000 + n}`,
  concelhos: ['Sintra'], experiencia: '5_10', notas: 'Quadros.', seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true,
});

/** O PDF enviado: 200, os cabeçalhos pedidos pelo dono e os bytes do ficheiro do servidor. */
async function confirmaPdf(r, msg) {
  assert.equal(r.estado, 200, `${msg}: ${r.texto.slice(0, 200)}`);
  assert.equal(r.cabecalhos['content-type'], 'application/pdf', msg);
  assert.equal(r.cabecalhos['x-content-type-options'], 'nosniff', msg);
  assert.match(r.cabecalhos['cache-control'], /^private\b/, msg);
  assert.equal(r.cabecalhos['content-disposition'], `inline; filename="${MANUAL_NOME}"`, msg);
  assert.equal(Number(r.cabecalhos['content-length']), (await stat(MANUAL_FICHEIRO)).size, msg);
  assert.equal(r.bruto.subarray(0, 5).toString('latin1'), '%PDF-', msg);
  assert.ok(r.bruto.equals(await readFile(MANUAL_FICHEIRO)), `${msg}: o ficheiro inteiro`);
}
const naoExiste = (r, msg) => assert.deepEqual([r.estado, r.json], [404, DESCONHECIDO], msg);

describe('manual de instalações BT: o ficheiro e o índice', () => {
  test('o PDF fica em painel/recursos (fora de web/ e de public/) e o índice tem as 6 partes, os 27 capítulos e os anexos', async () => {
    assert.ok(existsSync(MANUAL_FICHEIRO));
    assert.match(MANUAL_FICHEIRO.replace(/\\/g, '/'), /\/painel\/recursos\/manual-instalacoes-bt\.pdf$/);
    assert.equal(existsSync(new URL('../public/manual-instalacoes-bt.pdf', import.meta.url)), false);
    assert.equal(existsSync(new URL('../../web/manual-instalacoes-bt.pdf', import.meta.url)), false);
    assert.equal((await readFile(MANUAL_FICHEIRO)).subarray(0, 5).toString('latin1'), '%PDF-');
    const caps = MANUAL_BT.partes.flatMap((p) => p.capitulos.map((c) => c.n));
    assert.equal(MANUAL_BT.partes.filter((p) => /^Parte \d/.test(p.titulo)).length, 6);
    assert.deepEqual(caps.filter((n) => /^(B\d|\d\d)$/.test(n)).length, 27);
    assert.deepEqual(caps.slice(-3), ['A', 'B', 'C']);
    // As páginas sobem e cabem no PDF (a capa não tem número: a do PDF é a impressa + 1).
    const paginas = MANUAL_BT.partes.flatMap((p) => p.capitulos.map((c) => c.pagina));
    assert.deepEqual(paginas, [...paginas].sort((a, b) => a - b));
    assert.ok(paginaPdf(paginas.at(-1)) <= MANUAL_BT.paginas);
    assert.equal(ligacaoManual(PAINEL, 77), `${PAINEL}#page=78`, 'cap. 11 (choques elétricos) abre na página 78 do PDF');
    assert.equal(ligacaoManual(PAINEL), PAINEL);
    assert.equal(MANUAL_BT.nota, 'Edição provisória: o nome Adomus vai passar a Domus Energia.');
  });

  test('a cópia do painel (public/vendor/manual-bt.js) é igual à do site (web/manual-bt.js)', async () => {
    const site = await readFile(new URL('../../web/manual-bt.js', import.meta.url), 'utf8');
    const painel = await readFile(new URL('../public/vendor/manual-bt.js', import.meta.url), 'utf8');
    assert.equal(painel.replace(/\r\n/g, '\n'), site.replace(/\r\n/g, '\n'));
  });
});

describe('manual de instalações BT: quem o abre', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());

  test('painel: CEO, técnico e comercial abrem o PDF (GET e HEAD); sem sessão, com a conta de cliente ou com cookie inventado, 404', async () => {
    for (const papel of ['ceo', 'tecnico', 'comercial']) {
      await confirmaPdf(await p.pedir('GET', PAINEL, { cookie: p.cookies[papel] }), papel);
      const head = await p.pedir('HEAD', PAINEL, { cookie: p.cookies[papel] });
      assert.deepEqual([head.estado, head.cabecalhos['content-type'], head.bruto.length], [200, 'application/pdf', 0], `${papel} HEAD`);
    }
    const c = await p.contaConfirmada();
    for (const [cookie, quem] of [[undefined, 'anónimo'], [c.cookie, 'cliente'], ['domus_painel=inventado', 'cookie inventado']]) {
      naoExiste(await p.pedir('GET', PAINEL, { cookie }), `painel, ${quem}`);
      assert.equal((await p.pedir('HEAD', PAINEL, { cookie, site: false })).estado, 404, `painel HEAD, ${quem}`);
    }
    // Não há outro caminho: o ficheiro não é estático do painel nem do site.
    for (const caminho of [`/painel/${MANUAL_NOME}`, `/painel/recursos/${MANUAL_NOME}`, `/${MANUAL_NOME}`, `/painel/api/../recursos/${MANUAL_NOME}`]) {
      const r = await p.pedir('GET', caminho, { cookie: p.cookies.ceo });
      assert.notEqual(r.cabecalhos['content-type'], 'application/pdf', caminho);
    }
    // Com sessão, só se lê: POST dá 405 (sem sessão continua 404).
    assert.equal((await p.pedir('POST', PAINEL, { cookie: p.cookies.ceo, corpo: {} })).estado, 405);
    naoExiste(await p.pedir('POST', PAINEL, { corpo: {} }), 'POST anónimo');
  });

  test('área do eletricista: só o eletricista aprovado com sessão; candidato, sessão do painel ou de cliente e anónimo, 404', async () => {
    const r = await p.pedir('POST', '/api/eletricista/candidatura', { corpo: candidatura(1) });
    assert.equal(r.estado, 201, r.texto);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get('manual1@exemplo.pt').id;
    // Ainda candidato: não entra (nem há sessão) — o manual dá 404.
    naoExiste(await p.pedir('GET', AREA), 'anónimo');
    naoExiste(await p.pedir('GET', AREA, { cookie: p.cookies.ceo }), 'sessão do painel');
    naoExiste(await p.pedir('GET', AREA, { cookie: (await p.contaConfirmada()).cookie }), 'conta de cliente');
    assert.equal((await p.pedir('POST', `/painel/api/eletricistas/${id}`, { cookie: p.cookies.ceo, corpo: { acao: 'aprovar' } })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: 'manual1@exemplo.pt' } })).estado, 200);
    const e = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: 'manual1@exemplo.pt', codigo: p.codigo('manual1@exemplo.pt') } });
    assert.equal(e.estado, 200, e.texto);
    const cookie = e.cabecalhos['set-cookie'][0].split(';')[0];
    await confirmaPdf(await p.pedir('GET', AREA, { cookie }), 'eletricista aprovado');
    // A sessão do eletricista não abre o do painel.
    naoExiste(await p.pedir('GET', PAINEL, { cookie }), 'eletricista no painel');
    // Suspenso: a sessão fecha e o manual volta a dar 404.
    assert.equal((await p.pedir('POST', `/painel/api/eletricistas/${id}`, { cookie: p.cookies.ceo, corpo: { acao: 'suspender' } })).estado, 200);
    naoExiste(await p.pedir('GET', AREA, { cookie }), 'eletricista suspenso');
  });
});

describe('manual de instalações BT: com o módulo dos eletricistas desligado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { ELETRICISTAS: '0' } }); });
  after(() => p.fechar());

  test('a rota da área do eletricista não existe (404, com ou sem sessão); o painel continua a abrir o PDF', async () => {
    for (const cookie of [undefined, p.cookies.ceo]) naoExiste(await p.pedir('GET', AREA, { cookie }), `desligado, ${cookie ? 'CEO' : 'anónimo'}`);
    await confirmaPdf(await p.pedir('GET', PAINEL, { cookie: p.cookies.tecnico }), 'painel com o módulo desligado');
  });
});
