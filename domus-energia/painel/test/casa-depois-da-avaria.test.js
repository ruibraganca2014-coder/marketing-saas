// A casa descrita fica na conta depois de uma avaria (teste de 2026-10-14): o cliente descreveu a casa (planta com 4
// divisões), pediu um serviço e depois, no simulador, "Tenho uma avaria" — a avaria em curso gravava-se por cima da casa
// e, ao enviá-la, a conta ficava sem nada ("planta por desenhar", GET /api/conta/simulacao → estado null). O site promete
// "não precisa de a descrever outra vez".

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const CLIENTE = { nome: 'Rita Sousa', telefone: '912 345 678', morada: 'Rua do Exemplo, 12', localidade: 'Sintra' };
const DIVISOES = [{ id: 'd1', nome: 'Sala' }, { id: 'd2', nome: 'Cozinha' }, { id: 'd3', nome: 'Quarto' }, { id: 'd4', nome: 'Casa de banho' }];
/** A casa como o simulador a guarda na conta depois de enviar o primeiro pedido (estado.js soCasaDe). */
const CASA = { versao: 5, soCasa: true, passo: 0, funil: null, casa: { tipo: 'apartamento', tipologia: 'T2', potencia_contratada_kva: 6.9 },
  planta: { divisoes: DIVISOES, elementos: [] }, guardado: '2026-10-14T09:00:00.000Z' };
/** Um pedido com planta (o que o simulador envia: montarSimulacao). */
const SIM_PLANTA = {
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: DIVISOES.map((d) => ({ nome: d.nome })),
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
};
/** A avaria em curso, como o simulador a grava ao escolher "Tenho uma avaria" (estado novo, sem casa). */
function avariaEmCurso() {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  return e;
}
const simAvaria = () => {
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(avariaEmCurso(), calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
};

describe('a casa da conta sobrevive a um pedido de avaria', () => {
  let p;
  before(async () => { p = await painelComEquipa(); });
  after(() => p.fechar());
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });

  test('casa guardada → "Tenho uma avaria" → enviar: a conta continua com a casa (planta com 4 divisões)', async () => {
    const c = await p.contaConfirmada('casa.avaria@exemplo.pt');
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: CASA })).estado, 200);
    // A avaria em curso vai para a conta (retomar noutro aparelho) e é ela que o simulador lê — sem a casa às costas.
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: avariaEmCurso() })).estado, 200);
    const emCurso = (await conta(c, 'GET', 'simulacao')).json.estado;
    assert.equal(emCurso.funil, 'avaria');
    assert.equal('_casaDaConta' in emCurso, false, 'a casa guardada não sai para o navegador');
    assert.equal((await conta(c, 'GET', 'casas')).json.casas[0].planta, true);
    // Envia a avaria.
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Avaria', simulacao: simAvaria() } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    // A casa continua na conta, como casa guardada.
    const depois = (await conta(c, 'GET', 'simulacao')).json.estado;
    assert.ok(depois, 'a conta não ficou sem a casa');
    assert.equal(depois.soCasa, true);
    assert.deepEqual(depois.planta.divisoes.map((d) => d.nome), DIVISOES.map((d) => d.nome));
    assert.equal((await conta(c, 'GET', 'eu')).json.simulacao_tipo, 'casa');
    assert.equal((await conta(c, 'GET', 'casas')).json.casas[0].planta, true, 'a conta não diz "planta por desenhar"');
  });

  test('com a casa guardada e sem nada em curso, uma avaria enviada também a deixa ficar', async () => {
    const c = await p.contaConfirmada('casa.avaria.2@exemplo.pt');
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: CASA })).estado, 200);
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Avaria', simulacao: simAvaria() } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    assert.equal((await conta(c, 'GET', 'simulacao')).json.estado?.soCasa, true);
  });

  test('um pedido COM a casa (a simulação em curso tem planta) apaga a simulação como sempre: o simulador grava a casa a seguir', async () => {
    const c = await p.contaConfirmada('casa.pedido@exemplo.pt');
    const sim = { ...CASA, soCasa: false, funil: 'primeira', passo: 11 };
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: sim })).estado, 200);
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', simulacao: SIM_PLANTA } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    assert.equal((await conta(c, 'GET', 'simulacao')).json.estado, null);
  });

  test('"Começar de novo" (null) apaga tudo, também a casa guardada', async () => {
    const c = await p.contaConfirmada('casa.apagar@exemplo.pt');
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: CASA })).estado, 200);
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: avariaEmCurso() })).estado, 200);
    assert.equal((await conta(c, 'POST', 'simulacao', { estado: null })).estado, 200);
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Avaria', simulacao: simAvaria() } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    assert.equal((await conta(c, 'GET', 'simulacao')).json.estado, null);
  });
});
