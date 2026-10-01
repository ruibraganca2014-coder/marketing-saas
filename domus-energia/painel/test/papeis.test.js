// Matriz de papéis de TODAS as rotas (docs/PAINEL-EMPRESA.md §1 e §3):
// anónimo → 401; papel sem acesso → 403 (sem efeitos); papel com acesso →
// nunca 401/403. A lista abaixo é escrita à mão a partir do contrato e tem de
// cobrir exatamente as rotas do servidor (ROTAS).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { ROTAS } from '../src/api.js';

const C = 'ceo', T = 'tecnico', M = 'comercial';
const TODOS = [C, T, M];
// [método, caminho de teste, papéis com acesso, corpo]
const MATRIZ = [
  ['GET', 'eu', TODOS],
  ['POST', 'eu/senha', TODOS, {}],
  ['GET', 'resumo', TODOS],
  ['GET', 'clientes', TODOS],
  ['GET', 'clientes/joao', TODOS],
  ['POST', 'clientes', [C, M], {}],
  ['POST', 'clientes/joao/aparelhos', [C, T], {}],
  ['POST', 'clientes/joao/aparelhos/sala/remover', [C, T], {}],
  ['POST', 'clientes/joao/plano', [C], {}],
  ['GET', 'alertas', [C, T]],
  ['GET', 'orcamentos', [C, M]],
  ['POST', 'orcamentos', [C, M], {}],
  ['GET', 'orcamentos/999', [C, M]],
  ['POST', 'orcamentos/999', [C, M], {}],
  ['POST', 'orcamentos/999/converter', [C, M], {}],
  ['POST', 'orcamentos/999/libertar-relatorio', [C], {}],
  ['GET', 'orcamentos/999/relatorio-cliente', [C]],
  ['POST', 'orcamentos/999/obra-concluida', [C, M], {}],
  ['POST', 'orcamentos/999/marcar-visita', [C, M], { data_visita: '2026-10-05T10:00' }],
  ['POST', 'orcamentos/999/ensaios', [C, M], {}],
  ['POST', 'orcamentos/999/esquema-quadro', [C, M], {}],
  ['GET', 'orcamentos/999/fotos/0123456789abcdef01234567', [C, M]],
  ['POST', 'orcamentos/999/fotos/0123456789abcdef01234567/apagar', [C, M], {}],
  ['GET', 'obras', TODOS],
  ['GET', 'obras/999', TODOS],
  ['POST', 'obras', [C], {}],
  ['POST', 'obras/999', [C, T], {}],
  ['GET', 'pagamentos', [C]],
  ['GET', 'pagamentos-pedido', [C]],
  ['GET', 'utilizadores', [C]],
  ['POST', 'utilizadores', [C], {}],
  ['POST', 'utilizadores/999', [C], {}],
  ['GET', 'auditoria', [C]],
  ['GET', 'pedidos', TODOS],
  ['GET', 'pedidos/p-20260101000000-00000000', TODOS],
  ['GET', 'catalogo', [C]],
  ['POST', 'catalogo', [C], {}],
  ['POST', 'catalogo/999', [C], {}],
  ['GET', 'config-orcamento', [C]],
  ['POST', 'config-orcamento', [C], {}],
  ['GET', 'contas', [C]],
  ['POST', 'contas/999', [C], {}],
  ['POST', 'contas/999/apagar', [C], {}],
];
const PUBLICAS = [['POST', 'entrar'], ['POST', 'sair']];

let p;
before(async () => {
  p = await painelComEquipa();
  const agora = new Date().toISOString();
  p.app.db.prepare('INSERT INTO fichas_cliente (codigo, nome, criado, atualizado) VALUES (\'joao\', \'João\', ?, ?)').run(agora, agora);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${p.dados}/clientes/joao.tsv`, 'sala\topenbeken\t0\t0\t1:interruptor:Teto:0:0:desligado::\tSala\t\n');
});
after(() => p.fechar());

const padrao = (caminho) => caminho.replace(/^clientes\/joao/, 'clientes/:c').replace(/aparelhos\/sala/, 'aparelhos/:a')
  .replace(/\/(999|p-\d+-0+)(?=\/|$)/, '/:id').replace(/fotos\/[0-9a-f]{24}/, 'fotos/:foto');

test('a matriz cobre exatamente as rotas do servidor', () => {
  const doServidor = ROTAS.map((r) => `${r.metodo} ${r.caminho}`).sort();
  const daMatriz = MATRIZ.map(([m, c]) => `${m} ${padrao(c)}`).concat(PUBLICAS.map(([m, c]) => `${m} ${c}`)).sort();
  assert.deepEqual(daMatriz, doServidor);
  for (const r of ROTAS) {
    const esperado = MATRIZ.find(([m, c]) => m === r.metodo && padrao(c) === r.caminho);
    if (esperado) assert.deepEqual([...r.papeis].sort(), [...esperado[2]].sort(), `${r.metodo} ${r.caminho}`);
    else assert.equal(r.papeis, 'publico');
  }
});

for (const [metodo, caminho, papeis, corpo] of MATRIZ) {
  test(`${metodo} ${caminho}: anónimo 401, ${papeis.join('/')} com acesso, outros 403`, async () => {
    const url = `/painel/api/${caminho}`;
    const anon = await p.pedir(metodo, url, { corpo });
    assert.equal(anon.estado, 401, `anónimo: ${anon.texto}`);
    assert.equal(typeof anon.json.erro, 'string');
    for (const papel of TODOS) {
      const antes = p.app.db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE utilizador_id = ?').get(p.u[papel].id).n;
      const r = await p.pedir(metodo, url, { corpo, cookie: p.cookies[papel] });
      if (papeis.includes(papel)) {
        assert.ok(![401, 403].includes(r.estado), `${papel} devia ter acesso: ${r.estado} ${r.texto}`);
        assert.ok(r.estado < 500, `${papel}: ${r.estado} ${r.texto}`);
      } else {
        assert.equal(r.estado, 403, `${papel} não devia ter acesso: ${r.estado} ${r.texto}`);
        assert.equal(r.json.erro, 'Não tem acesso a esta área.');
        const depois = p.app.db.prepare('SELECT COUNT(*) AS n FROM auditoria WHERE utilizador_id = ?').get(p.u[papel].id).n;
        assert.equal(depois, antes, 'recusado sem efeitos');
      }
    }
  });
}

test('rotas públicas e endereços desconhecidos', async () => {
  assert.equal((await p.pedir('POST', '/painel/api/sair', { corpo: {} })).estado, 200);
  assert.equal((await p.pedir('GET', '/painel/api/naoexiste', { cookie: p.cookies.ceo })).estado, 404);
  assert.equal((await p.pedir('DELETE', '/painel/api/obras', { cookie: p.cookies.ceo })).estado, 405);
  assert.equal((await p.pedir('GET', '/painel/api/entrar')).estado, 405);
  assert.equal((await p.pedir('GET', '/api/orcamento')).estado, 405);
  assert.equal((await p.pedir('GET', '/api/catalogo')).estado, 200);
  assert.equal((await p.pedir('GET', '/api/outra')).estado, 404, '/api/* dos pagamentos não é do painel');
});

test('financeiro só para o CEO (clientes, resumo)', async () => {
  const lista = {};
  for (const papel of TODOS) lista[papel] = (await p.pedir('GET', '/painel/api/clientes', { cookie: p.cookies[papel] })).json.clientes;
  const joao = (papel) => lista[papel].find((c) => c.codigo === 'joao');
  assert.ok('proximo_pagamento' in joao(C) && 'valor_mensal_sem_iva' in joao(C));
  assert.equal(joao(C).n_aparelhos, 1);
  for (const papel of [T, M]) {
    for (const k of ['proximo_pagamento', 'aviso_ate', 'gerido', 'valor_mensal_iva', 'valor_mensal_sem_iva', 'pagamentos', 'total_pago']) {
      assert.ok(!(k in joao(papel)), `${papel} não vê ${k}`);
    }
  }
  const rT = (await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.tecnico })).json;
  const rM = (await p.pedir('GET', '/painel/api/resumo', { cookie: p.cookies.comercial })).json;
  for (const r of [rT, rM]) {
    for (const k of ['receita_recorrente_mensal', 'recebido_mes', 'clientes']) assert.ok(!(k in r), `${r.papel} não vê ${k}`);
  }
  assert.ok(!('alertas' in rM), 'o comercial não vê alertas técnicos');
});

test('estáticos: /painel redireciona, ficheiros com tipo certo, sem listagem nem fugas', async () => {
  const { writeFile, mkdir, symlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const pub = p.config.publicDir;
  // Sem index.html: página provisória.
  let r = await p.pedir('GET', '/painel/');
  assert.equal(r.estado, 200);
  assert.match(r.texto, /ainda não foram instalados/);
  await mkdir(join(pub, 'ecras'), { recursive: true });
  await writeFile(join(pub, 'index.html'), '<!doctype html><title>P</title>');
  await writeFile(join(pub, 'app.js'), 'export {};');
  await writeFile(join(pub, 'ecras', 'a.css'), 'a{}');
  await writeFile(join(pub, '.segredo'), 'x');
  await writeFile(join(p.dir, 'fora.txt'), 'fora');
  await symlink(join(p.dir, 'fora.txt'), join(pub, 'ligacao.txt'));
  r = await p.pedir('GET', '/painel');
  assert.equal(r.estado, 301);
  assert.equal(r.cabecalhos.location, '/painel/');
  r = await p.pedir('GET', '/painel/');
  assert.equal(r.cabecalhos['content-type'], 'text/html; charset=utf-8');
  assert.match(r.cabecalhos['content-security-policy'], /script-src 'self';/);
  assert.equal(r.cabecalhos['x-content-type-options'], 'nosniff');
  assert.equal((await p.pedir('GET', '/painel/app.js')).cabecalhos['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await p.pedir('GET', '/painel/ecras/a.css')).cabecalhos['content-type'], 'text/css; charset=utf-8');
  assert.equal((await p.pedir('GET', '/painel/clientes')).texto, '<!doctype html><title>P</title>', 'ecrã da aplicação → index.html');
  for (const c of ['/painel/ecras/', '/painel/.segredo', '/painel/ligacao.txt', '/painel/../package.json', '/painel/%2e%2e/package.json',
    '/painel/ecras/..%2f..%2fpackage.json', '/painel/nada.js']) {
    assert.equal((await p.pedir('GET', c)).estado, 404, c);
  }
  assert.equal((await p.pedir('POST', '/painel/app.js', { corpo: {} })).estado, 405);
});
