// Lista de espera decidida pelo servidor (decisão do dono, 2026-10-12; migração 51): o CEO liga-a, desliga-a e muda a
// data de arranque no painel; o site pergunta ao servidor (/api/conta/lista-espera.js) e o pedido é marcado pelo que o
// servidor decide, não pelo que o navegador diz.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { lerConfig } from '../src/config.js';

const PEDIDO = { nome: 'Cliente Espera', telefone: '912 000 111', email: 'espera@exemplo.pt', servico: 'Casa inteligente', localidade: 'Sintra' };

describe('lista de espera decidida pelo servidor', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { LISTA_ESPERA: '1' } }); });
  after(() => p.fechar());
  const painel = (metodo, papel = 'ceo', corpo) => p.pedir(metodo, '/painel/api/lista-espera', { cookie: p.cookies[papel], corpo });
  const js = () => p.pedir('GET', '/api/conta/lista-espera.js');
  const marcado = async (corpo = {}) => {
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { ...PEDIDO, ...corpo } });
    assert.equal(r.estado, 201, r.texto);
    return p.app.db.prepare('SELECT lista_espera FROM orcamentos ORDER BY id DESC LIMIT 1').get().lista_espera;
  };

  test('por omissão está ligada, com "setembro de 2027"; com LISTA_ESPERA=0 desligada', () => {
    assert.deepEqual(lerConfig({}).listaEspera, { ativa: true, arranque: 'setembro de 2027' });
    assert.deepEqual(lerConfig({ LISTA_ESPERA: '0', LISTA_ESPERA_ARRANQUE: 'março de 2028' }).listaEspera, { ativa: false, arranque: 'março de 2028' });
  });

  test('o site recebe o que o servidor decide, num script público com cache curta', async () => {
    const r = await js();
    assert.equal(r.estado, 200);
    assert.match(r.cabecalhos['content-type'], /^text\/javascript/);
    assert.equal(r.cabecalhos['cache-control'], 'public, max-age=60');
    assert.equal(r.cabecalhos['x-content-type-options'], 'nosniff');
    assert.equal(r.texto, 'if(window.DOMUS)window.DOMUS.listaEspera={"ativa":true,"arranque":"setembro de 2027"};\n');
    assert.equal((await p.pedir('POST', '/api/conta/lista-espera.js', { corpo: {} })).estado, 405);
  });

  test('o servidor marca o pedido pelo que ele decide: ligada, marca mesmo sem o navegador o dizer; desligada, não marca mesmo que o diga', async () => {
    assert.equal(await marcado(), 1);
    assert.equal(await marcado({ lista_espera: false }), 1);
    assert.equal((await painel('POST', 'ceo', { ativa: false })).estado, 200);
    assert.equal(await marcado({ lista_espera: true }), 0);
    assert.equal(await marcado(), 0);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos WHERE lista_espera = 1').get().n, 2, 'os que já estavam em lista de espera continuam marcados');
    assert.equal((await painel('POST', 'ceo', { ativa: true })).estado, 200);
  });

  test('painel: toda a equipa vê; só o CEO muda; a data é obrigatória e curta; fica no histórico', async () => {
    assert.deepEqual((await painel('GET', 'comercial')).json, { ativa: true, arranque: 'setembro de 2027' });
    assert.equal((await painel('GET', 'tecnico')).estado, 200);
    assert.equal((await painel('POST', 'comercial', { ativa: false })).estado, 403);
    assert.equal((await p.pedir('GET', '/painel/api/lista-espera')).estado, 401);
    assert.equal((await painel('POST', 'ceo', { arranque: '   ' })).estado, 400);
    assert.equal((await painel('POST', 'ceo', { arranque: 'x'.repeat(61) })).estado, 400);
    assert.equal((await painel('POST', 'ceo', { ativa: 'sim' })).estado, 400);
    const r = await painel('POST', 'ceo', { arranque: 'janeiro de 2028 </script>' });
    assert.deepEqual(r.json, { ativa: true, arranque: 'janeiro de 2028 </script>' });
    // O texto vai para dentro de um script: o "<" segue escapado.
    const t = (await js()).texto;
    assert.ok(!t.includes('</script>') && t.includes('janeiro de 2028 \\x3c/script>'), t);
    const aud = p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'lista_espera_mudada' ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual(JSON.parse(aud.detalhes).antes, { ativa: true, arranque: 'setembro de 2027' });
    assert.equal((await painel('POST', 'ceo', { arranque: 'setembro de 2027' })).estado, 200);
  });
});
