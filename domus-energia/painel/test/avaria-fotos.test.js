// Ronda B: as fotos da avaria (até 5: "avaria:foto", "avaria:foto_2"…) no pedido e no painel.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { simulacao as validarSimulacao } from '../src/validar.js';
import { aVerificarNaVisita } from '../public/ecras/simulacao.js';

const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);

test('avaria: as fotos "avaria:foto_2"… contam como foto (pedido antigo só com "avaria:foto" também)', () => {
  const base = { versao: 1, funil: 'avaria', avaria: { onde: ['sala'], problema: ['luz'], descricao: '' } };
  const v = (fotos) => aVerificarNaVisita({ ...base, fotos }).find((x) => x.tema === 'Avaria').texto;
  assert.match(v([{ chave: 'avaria:foto_2' }]), /ver foto/);
  assert.match(v([{ chave: 'avaria:foto' }]), /ver foto/);
  assert.match(v([]), /sem foto/);
  assert.doesNotThrow(() => validarSimulacao({ ...base, fotos: ['avaria:foto', 'avaria:foto_2', 'avaria:foto_3', 'avaria:foto_4', 'avaria:foto_5'].map((chave) => ({ chave, tipo: 'avaria', legenda: 'Avaria' })) }));
});

describe('avaria: até 5 fotos no pedido (POST /api/orcamento/fotos)', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { LIMITE_FOTOS_HORA: '1000' } }); });
  after(() => p.fechar());
  test('as 5 chaves da avaria são aceites e aparecem na galeria; faiscas/choque aceites', async () => {
    const chaves = ['avaria:foto', 'avaria:foto_2', 'avaria:foto_3', 'avaria:foto_4', 'avaria:foto_5'];
    const simulacao = { versao: 1, funil: 'avaria', avaria: { onde: ['sala', 'cozinha'], problema: ['faiscas', 'choque'], descricao: '' }, fotos: chaves.map((chave) => ({ chave, tipo: 'avaria', legenda: 'Avaria' })) };
    const { cookie } = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'Ana Avaria', telefone: '912 345 678', servico: 'Reparação', localidade: 'Oeiras', morada: 'Rua do Teste, 1', simulacao }, cookie });
    assert.equal(r.estado, 201, r.texto);
    for (const chave of chaves) {
      const f = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': r.json.fotos_token, 'X-Foto-Chave': chave } });
      assert.equal(f.estado, 201, `${chave}: ${f.texto}`);
    }
    const o = (await p.pedir('GET', `/painel/api/orcamentos/${r.json.pedido}`, { cookie: p.cookies.ceo })).json;
    assert.deepEqual(o.fotos.map((f) => f.chave).sort(), [...chaves].sort());
    assert.deepEqual(o.simulacao.avaria.problema, ['faiscas', 'choque']);
  });
});
