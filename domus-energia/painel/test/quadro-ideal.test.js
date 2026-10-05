// Quadro existente → quadro ideal (decisões do dono, 2026-10-05): o que falta ao quadro que lá está para chegar ao
// ideal da casa (web/simulador/relatorio-casa.js diferencasQuadro) e o eletricista a desenhar o existente na área dele
// (POST /api/eletricista/trabalhos/:id/esquema-quadro; a ficha do trabalho traz `quadro`).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { diferencasQuadro } from '../../web/simulador/relatorio-casa.js';

const IDEAL = {
  disjuntor_geral: { amperes: 32 }, diferenciais: [{ sensibilidade_ma: 30, amperes: 40 }, { sensibilidade_ma: 30, amperes: 40 }],
  disjuntores: [{ amperes: 10 }, { amperes: 16 }, { amperes: 16 }, { amperes: 25 }, { amperes: 25 }], tamanho: 18,
};
const existente = (x = {}) => ({ disjuntor_geral: { amperes: 25 }, diferenciais: [{ sensibilidade_ma: 300, amperes: 40 }], disjuntores: [{ amperes: 10 }, { amperes: 16 }], modulos_livres: 4, fusiveis: false, ...x });

test('o que falta: geral, diferenciais de 30 mA, disjuntores por amperes e se cabe nos módulos livres', () => {
  const d = diferencasQuadro(existente(), IDEAL);
  assert.deepEqual(d.falta, [
    'Disjuntor geral: trocar o de 25 A por um de 32 A.',
    '2 diferenciais de 30 mA (tem 0, a casa pede 2).',
    '3 disjuntores: 1 de 16 A, 2 de 25 A.',
    'Não cabe: são precisos 7 módulos e só há 4 livres. Quadro novo de 18 módulos, ou um quadro ao lado.',
  ]);
  assert.deepEqual([d.cabe, d.modulos], [false, { precisos: 7, livres: 4 }]);
  assert.match(diferencasQuadro(existente({ modulos_livres: 9 }), IDEAL).falta.at(-1), /^Cabe no quadro: são precisos 7 módulos e há 9 livres\.$/);
  assert.match(diferencasQuadro(existente({ modulos_livres: null }), IDEAL).falta.at(-1), /confirmar os módulos livres/);
  assert.equal(diferencasQuadro(existente({ fusiveis: true }), IDEAL).falta[0], 'Tem fusíveis: trocar por disjuntores.');
  assert.match(diferencasQuadro(existente({ disjuntor_geral: null }), IDEAL).falta[0], /^Disjuntor geral de 32 A \(não tem/);
});

test('proteção completa: o que falta lista o geral Wi-Fi, as proteções e os AFDD, e conta os módulos deles', () => {
  const completo = { ...IDEAL, disjuntor_geral: { amperes: 32, wifi: true }, protecoes: ['descarregador', 'rele_tensao', 'medidor_geral'],
    disjuntores: [{ amperes: 10 }, { amperes: 16, afdd: true }, { amperes: 16, afdd: true }, { amperes: 25 }, { amperes: 25 }], tamanho: 24 };
  const tudo = { ...completo, modulos_livres: 3, fusiveis: false };
  assert.deepEqual(diferencasQuadro(tudo, completo).falta, []);
  const d = diferencasQuadro({ ...tudo, disjuntor_geral: { amperes: 32 }, protecoes: ['descarregador'], disjuntores: [{ amperes: 10 }, { amperes: 16, afdd: true }, { amperes: 16 }, { amperes: 25 }, { amperes: 25 }] }, completo);
  assert.deepEqual(d.falta, [
    'Disjuntor geral: trocar por um Wi-Fi.',
    'Proteção de sobretensão e subtensão.',
    'Medidor de energia geral.',
    'AFDD em 1 circuito (quartos e sala): tem 1, a casa pede 2.',
    'Não cabe: são precisos 5 módulos e só há 3 livres. Quadro novo de 24 módulos, ou um quadro ao lado.',
  ]);
});

test('quadro que já chega: nada em falta; sem quadro desenhado: null', () => {
  const igual = { ...IDEAL, modulos_livres: 0, fusiveis: false };
  assert.deepEqual(diferencasQuadro(igual, IDEAL), { falta: [], cabe: true, modulos: { precisos: 0, livres: 0 } });
  const maior = existente({ disjuntor_geral: { amperes: 40 }, diferenciais: IDEAL.diferenciais, disjuntores: [...IDEAL.disjuntores, { amperes: 32 }] });
  assert.deepEqual(diferencasQuadro(maior, IDEAL).falta, [], 'um geral maior e disjuntores a mais não contam como falta');
  assert.equal(diferencasQuadro(null, IDEAL), null);
  assert.equal(diferencasQuadro(existente(), null), null);
});

describe('o eletricista desenha o quadro existente', () => {
  let p;
  let e;
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  before(async () => {
    p = await painelComEquipa({ env: { SITE_URL: 'https://site.teste' } });
    const c = { nome: 'Eletricista Quadro', email: 'eletricista.quadro@exemplo.pt', telefone: '910 000 111', nif: '123456789', dgeg: 'TR-3001',
      concelhos: ['Sintra'], experiencia: '5_10', notas: '', seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: c })).estado, 201);
    const id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(c.email).id;
    assert.equal((await painel('POST', `eletricistas/${id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: c.email } })).estado, 200);
    const s = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: c.email, codigo: p.codigo(c.email) } });
    e = { id, cookie: s.cabecalhos['set-cookie'][0].split(';')[0] };
  });
  after(() => p.fechar());
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  const area = (metodo, caminho, corpo, cookie = e.cookie) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie, corpo });

  test('só no seu trabalho aceite: guarda, valida, apaga; a ficha traz `quadro`; o painel vê quem o desenhou', async () => {
    const o = await painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Quadro', telefone: '912 345 678', email: 'carla.quadro@exemplo.pt', localidade: 'Sintra', servico: 'Quadro elétrico' });
    assert.equal(o.estado, 201, o.texto);
    const tid = (await painel('POST', `orcamentos/${o.json.id}/eletricista`, 'ceo', { acao: 'bolsa' })).json.trabalho.id;
    const esquema = { disjuntor_geral: { amperes: 25 }, diferenciais: [{ sensibilidade_ma: 300, amperes: 40 }], disjuntores: [{ amperes: 10, afdd: true }, { amperes: 16 }], protecoes: ['descarregador'], modulos_livres: 4, fusiveis: false };
    assert.notEqual((await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema })).estado, 200, 'antes de aceitar o trabalho não é dele');
    assert.equal((await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema }, '')).estado, 401);
    assert.equal((await area('POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    let t = (await area('GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([t.quadro.existente, t.quadro.casa, t.quadro.pode_desenhar], [null, null, true], 'pedido sem simulação: sem casa para o ideal');
    assert.equal((await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema: { disjuntores: 'muitos' } })).estado, 400);
    assert.equal((await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema: { ...esquema, protecoes: ['para-raios'] } })).estado, 400);
    const r = await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema });
    assert.equal(r.estado, 200, r.texto);
    t = r.json.trabalho;
    assert.deepEqual([t.quadro.existente.disjuntor_geral, t.quadro.existente.disjuntores.length, t.quadro.existente.modulos_livres], [{ amperes: 25 }, 2, 4]);
    assert.deepEqual([t.quadro.existente.protecoes, t.quadro.existente.disjuntores[0], t.quadro.existente.ordem.slice(0, 2)], [['descarregador'], { amperes: 10, afdd: true }, ['geral', 'descarregador']]);
    assert.equal(t.quadro.existente.por, undefined, 'a área do eletricista não leva quem desenhou');
    assert.equal((await painel('GET', `orcamentos/${o.json.id}`)).json.esquema_quadro.por, `eletricista:${e.id}`);
    assert.equal((await area('POST', `trabalhos/${tid}/esquema-quadro`, { esquema: null })).estado, 200);
    assert.equal((await painel('GET', `orcamentos/${o.json.id}`)).json.esquema_quadro, null);
  });
});
