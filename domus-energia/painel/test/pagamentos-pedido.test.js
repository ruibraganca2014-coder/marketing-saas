// Pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md), fase 3 (monetização): enviar é GRÁTIS (o pedido passa logo a
// orçamento e o cliente tem o relatório básico: intervalo −10/+20 % e lista de trabalho, sem material nem preços);
// compram-se à parte o relatório completo (29 €, revisto e libertado pelo CEO) e a visita técnica (deslocação +
// 0,5 h × tarifa; fora da área não há), no passo Enviar (os dois juntos) ou na conta; o CEO marca a visita (data na
// conta e no email); a avaria rápida paga o diagnóstico e a deslocação ao enviar. Sinal = 30 % − tudo o que já foi pago.
// Também: sucesso/falha/cancelar simulados, idempotência, valores do servidor, acesso cruzado, expiração, RGPD e o
// modo stripe (Stripe falso ao nível do fetch; webhook assinado; a página simulada não existe).

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { painelComEquipa } from './ajuda.js';
import {
  calcularSinal, foraDaArea, comIva, partirIva, deslocacaoServidor, intervaloEstimativa, valorVisitaCent, precoRelatorioCent,
  metodosPagamento, diasDeObra,
} from '../src/pagamentos-pedido.js';
import { lerConfig } from '../src/config.js';
import { calcularPreco, cent as centSim } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const SIM = {
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' },
  divisoes: [{ nome: 'Sala', interruptores: [2, 1], estores: 1, sensores_porta: 1 }, { nome: 'Quarto', interruptores: [1] }],
  itens: [{ sku: 'INT-VIDRO-2', qtd: 1, preco_iva: 60 }, { sku: 'INT-VIDRO-1', qtd: 2, preco_iva: 50 }, { sku: 'BAB-CURTAIN', qtd: 1, preco_iva: 40 },
    { sku: 'SENS-PORTA-WIFI', qtd: 1, preco_iva: 20 }, { sku: 'TONGOU-SY2-JWT', qtd: 3, preco_iva: 30 }],
  mao_obra: { horas: 5, valor_iva: 175 }, deslocacao: { estado: 'estimada', valor_iva: 10 },
  total: { min: 900, max: 1200 }, plano_sugerido: 'conforto', quadro: { pacote: 'recomendado', circuitos: [{ codigo: 'C1' }] },
  visita: { dias: ['seg', 'qua'], periodo: 'manha' }, urgencia: 'semana',
};
const CATALOGO = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
/** Avaria rápida (fase 1) como o simulador a monta: diagnóstico, sem planta. */
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const preco = calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], CATALOGO, null);
  return montarSimulacao(e, preco, null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();
const JPEG = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
// Configuração de omissão (base nova): Lisboa, 20 km grátis, 0,40 €/km, 38 €/h. Sintra ≈ 29 km → deslocação 7,20 € por
// dia de obra (ida e volta: 9 km pagos × 2 × 0,40 €; decisão 4 do dono, 2026-10-02). A visita e a avaria são um dia.
const DESLOC_SINTRA = 7.2;
const VISITA_SINTRA = 26.2;            // 7,20 + 0,5 × 38
const DIAG_SINTRA = 25 + 19 + 7.2;     // DIAG-AVARIA 25 € + 0,5 h × 38 + deslocação

test('valores do servidor: sinal = 30 % COM IVA menos TUDO o que foi pago antes; intervalo −10/+20; visita; relatório; área', () => {
  // Doc: 1000 € + IVA 23 % = 1230 €; relatório 29 € + visita 25 € pagos antes → sinal = 369 − 54 = 315 €; restante 861 €.
  assert.equal(comIva(100_000, 23), 123_000);
  assert.equal(calcularSinal(comIva(100_000, 23), 2900 + 2500), 31_500);
  assert.equal(comIva(100_000, 23) - 5400 - 31_500, 86_100);
  assert.deepEqual(partirIva(2900, 23), { base: 2358, iva: 542 });
  assert.deepEqual(partirIva(86_100, 23), { base: 70_000, iva: 16_100 });
  assert.equal(calcularSinal(100_000, 0), 30_000);
  assert.equal(calcularSinal(5000, 2900), 0, 'nunca negativo');
  // Decisão 6: o sinal cobre o material — o maior entre 30 % e o custo do material, menos o já pago; nunca acima do total.
  assert.equal(calcularSinal(123_000, 5400, 50_000), 44_600, 'material 500 € > 30 % (369 €): 500 − 54');
  assert.equal(calcularSinal(123_000, 5400, 20_000), 31_500, 'material abaixo dos 30 %: vale os 30 %');
  assert.equal(calcularSinal(10_000, 0, 50_000), 10_000, 'nunca acima do total');
  assert.equal(calcularSinal(10_000, 4000, 50_000), 6000, 'nem do que falta pagar');
  // Decisão 7: acima do limite do cartão (500 €) só Multibanco ou MB Way.
  const metodos = ['card', 'mb_way', 'multibanco'];
  assert.deepEqual(metodosPagamento(50_000, {}, metodos), metodos, '500,00 € ainda com cartão');
  assert.deepEqual(metodosPagamento(50_001, {}, metodos), ['mb_way', 'multibanco']);
  assert.deepEqual(metodosPagamento(50_001, { cartao_max_iva: 1000 }, metodos), metodos, 'limite configurável');
  assert.deepEqual(metodosPagamento(50_001, {}, ['card']), ['multibanco'], 'só cartão configurado: fica o Multibanco');
  // Decisão 4: dias de obra = horas ÷ 8 (para cima, mínimo 1); a deslocação é ida e volta por dia.
  assert.deepEqual([diasDeObra(0, {}), diasDeObra(8, {}), diasDeObra(8.1, {}), diasDeObra(26, {}), diasDeObra(26, { horas_por_dia: 10 })], [1, 1, 2, 4, 3]);
  // Intervalo assimétrico (−10 % / +20 %, múltiplos de 5); a configuração antiga (só margem_intervalo_pct) continua a ler-se.
  assert.deepEqual(intervaloEstimativa(1000, { intervalo_menos_pct: 10, intervalo_mais_pct: 20 }), { min: 900, max: 1200 });
  assert.deepEqual(intervaloEstimativa(1000, {}), { min: 900, max: 1200 }, 'omissão −10/+20');
  assert.deepEqual(intervaloEstimativa(1000, { margem_intervalo_pct: 15 }), { min: 850, max: 1150 }, 'só a chave antiga');
  assert.deepEqual(intervaloEstimativa(1000, { intervalo_menos_pct: 5, intervalo_mais_pct: 30, margem_intervalo_pct: 15 }), { min: 950, max: 1300 });
  // Os mesmos números no simulador (preco.js).
  const sim = calcularPreco([{ chave: 'tomada', qtd: 1 }], [{ sku: 'TOMADA-WIFI', categoria: 'tomada', preco_venda_iva: 1000, horas_instalacao: 0 }], { intervalo_menos_pct: 10, intervalo_mais_pct: 20 }, { valor_iva: 0 });
  assert.deepEqual([sim.min, sim.max], [900, 1200]);
  const simAntigo = calcularPreco([{ chave: 'tomada', qtd: 1 }], [{ sku: 'TOMADA-WIFI', categoria: 'tomada', preco_venda_iva: 1000, horas_instalacao: 0 }], { margem_intervalo_pct: 15 }, { valor_iva: 0 });
  assert.deepEqual([simAntigo.min, simAntigo.max], [850, 1150], 'servidor antigo (só margem_intervalo_pct): simétrico como antes');
  const cfg = { deslocacao_base: 'Lisboa', deslocacao_max_km: 100 };
  assert.equal(foraDaArea('Sintra', cfg), false);
  assert.equal(foraDaArea('Funchal', cfg), true, 'ilha');
  assert.equal(foraDaArea('Bragança', cfg), true, 'longe');
  assert.equal(foraDaArea('uma aldeia qualquer', cfg), false, 'desconhecido: a visita confirma');
  const cd = { ...cfg, deslocacao_iva: 5, deslocacao_km_gratis: 20, deslocacao_preco_km_iva: 0.4, tarifa_hora_iva: 40 };
  assert.equal(deslocacaoServidor('Sintra', cd), 12.2, '5 + (29 − 20) × 2 × 0,40 (ida e volta)');
  assert.equal(deslocacaoServidor('Sintra', cd, 3), 36.6, '3 dias de obra');
  // Teto: no máximo `deslocacao_max_dias` (5) dias de deslocação por obra.
  assert.equal(deslocacaoServidor('Sintra', cd, 9), 61, '9 dias de obra pagam 5 de deslocação');
  assert.equal(deslocacaoServidor('Sintra', { ...cd, deslocacao_max_dias: 2 }, 9), 24.4, 'teto configurável');
  assert.equal(valorVisitaCent('Sintra', cd), 3220, 'deslocação 12,20 + 0,5 h × 40');
  assert.equal(valorVisitaCent('uma aldeia qualquer', cd), null, 'B2: sem concelho reconhecido não há visita');
  assert.equal(valorVisitaCent('', cd), null, 'sem localidade não há visita');
  assert.equal(valorVisitaCent('Funchal', cd), null, 'fora da área: não há visita');
  assert.equal(precoRelatorioCent({}), 2900);
  assert.equal(precoRelatorioCent({ preco_relatorio_iva: 35 }), 3500);
});

describe('modo simulado', () => {
  let p;
  before(async () => { p = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } }); });
  after(() => p.fechar());

  const nOrc = () => p.app.db.prepare('SELECT COUNT(*) AS n FROM orcamentos').get().n;
  const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
  /** Enviar (grátis): 201 com o pedido; `compra` = pormenorizado | pormenorizado_visita traz também o pagamento. */
  async function enviar(c, extra = {}) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'Casa inteligente', localidade: 'Sintra', simulacao: SIM, ...extra } });
    assert.equal(r.estado, 201, r.texto);
    assert.ok(r.json.pedido, 'o pedido já existe');
    return r.json;
  }
  async function enviarAvaria(c, extra = {}) {
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente Avaria', telefone: '912 000 111', servico: 'Reparação', localidade: 'Sintra', simulacao: SIM_AVARIA, ...extra } });
    assert.equal(r.estado, 202, r.texto);
    return r.json.pagamento;
  }
  const simular = (c, ref, resultado) => p.pedir('POST', `/api/conta/pagamentos/${ref}/simular`, { cookie: c.cookie, corpo: { resultado } });
  const ver = (c, ref, q = '') => p.pedir('GET', `/api/conta/pagamentos/${ref}${q}`, { cookie: c.cookie });
  const comprar = (c, id, fase) => p.pedir('POST', `/api/conta/pedidos/${id}/pagar`, { cookie: c.cookie, corpo: { fase } });
  const pedidoConta = async (c, id) => (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === id);
  /** Compra paga (simulada) na conta; devolve o pagamento. */
  async function comprado(c, id, fase) {
    const r = await comprar(c, id, fase);
    assert.equal(r.estado, 200, r.texto);
    const ok = await simular(c, r.json.pagamento.ref, 'sucesso');
    assert.equal(ok.json.pagamento.estado, 'pago', ok.texto);
    return ok.json.pagamento;
  }

  test('enviar é grátis: pedido "novo" logo, relatório básico na conta (intervalo −10/+20 e lista de trabalho; sem material nem preços)', async () => {
    const c = await p.contaConfirmada();
    const antes = nOrc();
    const novosAntes = (await painel('GET', 'resumo')).json.pedidos_novos;
    // O browser não escolhe o valor (campo desconhecido → 400) nem uma compra que não existe.
    assert.equal((await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'A', telefone: '912 000 111', servico: 'S', simulacao: SIM, valor: 1 } })).estado, 400);
    assert.equal((await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'A', telefone: '912 000 111', servico: 'S', simulacao: SIM, compra: 'tudo' } })).estado, 400);
    assert.equal((await p.pedir('POST', '/api/orcamento', { corpo: { nome: 'A', telefone: '912 000 111', servico: 'S', compra: 'pormenorizado' } })).estado, 400, 'sem simulação não se compra');
    const r = await enviar(c);
    assert.equal(r.pagamento, undefined, 'nada para pagar');
    assert.ok(r.fotos_token);
    assert.equal(nOrc(), antes + 1);
    assert.equal((await painel('GET', 'resumo')).json.pedidos_novos, novosAntes + 1);
    const o = (await painel('GET', `orcamentos/${r.pedido}`)).json;
    assert.equal(o.estado, 'novo');
    assert.deepEqual(o.pagamentos, []);
    assert.equal(o.compras.relatorio.comprado, false);
    assert.equal(o.compras.visita.valor, VISITA_SINTRA);
    // Fotos com o token da resposta.
    const fo = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': r.fotos_token, 'X-Foto-Chave': 'quadro', 'X-Foto-Legenda': 'Quadro' } });
    assert.equal(fo.estado, 201, fo.texto);
    // Na conta: básico já disponível; pormenorizado por comprar (29 €); visita por comprar (deslocação + 0,5 h).
    const l = await pedidoConta(c, r.pedido);
    assert.equal(l.estado_texto, 'Pedido recebido. O relatório básico já está aqui.');
    assert.equal(l.relatorio_basico, true);
    assert.equal(l.relatorio, 'por_comprar');
    assert.deepEqual([l.compras.ativas, l.compras.pode, l.compras.relatorio.valor, l.compras.visita.valor, l.compras.visita.fora_area], [true, true, 29, VISITA_SINTRA, false]);
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${r.pedido}/relatorio`, { cookie: c.cookie })).estado, 409, 'o pormenorizado não, sem o comprar');
    const b = await p.pedir('GET', `/api/conta/pedidos/${r.pedido}/relatorio-basico`, { cookie: c.cookie });
    assert.equal(b.estado, 200, b.texto);
    const rel = b.json.relatorio;
    const rc = (await painel('GET', `orcamentos/${r.pedido}/relatorio-cliente`)).json.relatorio;
    // Ronda de correções (B4): o intervalo é do total SEM a deslocação; a deslocação vai à parte ("+ deslocação X €").
    const total = Math.round((rc.total - rc.deslocacao) * 100) / 100;
    assert.deepEqual(rel.intervalo, { min: Math.round((total * 0.9) / 5) * 5, max: Math.round((total * 1.2) / 5) * 5 }, 'do total do servidor sem deslocação, −10 % / +20 %');
    assert.equal(rel.deslocacao, DESLOC_SINTRA, 'a deslocação à parte');
    assert.equal(rel.com_deslocacao, true);
    assert.deepEqual(rel.divisoes.map((d) => d.nome), ['Sala', 'Quarto', 'Quadro elétrico e geral']);
    assert.ok(rel.divisoes[0].trabalho.some((t) => /Novo: 2 interruptores/.test(t)));
    for (const proibido of ['material', 'preco_unitario', 'mao_obra', 'total', 'geral', 'artigo']) assert.ok(!b.texto.includes(`"${proibido}"`), `o básico não tem ${proibido}`);
    assert.doesNotMatch(b.texto, /INT-VIDRO|Interruptor de parede|fornecedor|circuito/i, 'nem artigos, nem plano técnico');
    // Outra conta não o vê.
    const x = await p.contaConfirmada();
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${r.pedido}/relatorio-basico`, { cookie: x.cookie })).estado, 404);
  });

  test('intervalo configurável no painel (−5 % / +30 %): o relatório básico segue-o', async () => {
    const c = await p.contaConfirmada();
    const { pedido } = await enviar(c);
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { intervalo_menos_pct: 5, intervalo_mais_pct: 30 })).estado, 200);
    try {
      const rc = (await painel('GET', `orcamentos/${pedido}/relatorio-cliente`)).json.relatorio;
      const total = Math.round((rc.total - rc.deslocacao) * 100) / 100;
      const rel = (await p.pedir('GET', `/api/conta/pedidos/${pedido}/relatorio-basico`, { cookie: c.cookie })).json.relatorio;
      assert.deepEqual(rel.intervalo, { min: Math.round((total * 0.95) / 5) * 5, max: Math.round((total * 1.3) / 5) * 5 });
      assert.deepEqual((await p.pedir('GET', '/api/catalogo')).json.config.intervalo_mais_pct, 30, 'o simulador recebe-o');
      assert.equal((await painel('POST', 'config-orcamento', 'ceo', { intervalo_menos_pct: 101 })).estado, 400);
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { intervalo_menos_pct: 10, intervalo_mais_pct: 20 });
    }
  });

  test('relatório completo (29 €, do servidor): falhar não mexe no pedido; pago → em revisão; o CEO só liberta depois de comprado', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 409, 'ainda não foi comprado');
    const r = await comprar(c, id, 'relatorio_pormenorizado');
    assert.equal(r.estado, 200, r.texto);
    const pg = r.json.pagamento;
    assert.deepEqual([pg.fase, pg.valor, pg.estado, pg.modo, pg.orcamento_id], ['relatorio_pormenorizado', 29, 'pendente', 'simulado', id]);
    assert.equal(pg.url, `pagamento-simulado.html?ref=${pg.ref}`);
    assert.match(pg.descricao, /^Relatório completo do pedido n\.º \d+ \(descontado na obra\)$/);
    assert.equal((await comprar(c, id, 'relatorio_pormenorizado')).json.pagamento.ref, pg.ref, 'clicar outra vez: o mesmo pagamento');
    // Falha: o pedido continua igual (não se perde nada) e volta-se à conta.
    const f = await simular(c, pg.ref, 'falha');
    assert.equal(f.json.pagamento.estado, 'falhado');
    assert.equal(f.json.voltar, `conta.html?pagamento=${pg.ref}`);
    assert.match(p.emails.at(-1).texto, /não foi concluído/);
    assert.equal((await painel('GET', `orcamentos/${id}`)).json.estado, 'novo');
    assert.equal((await pedidoConta(c, id)).relatorio, 'por_comprar');
    // De novo: pago → "em revisão" (até o CEO libertar); o email diz isso.
    const pago = await comprado(c, id, 'relatorio_pormenorizado');
    assert.deepEqual([pago.recibo.valor, pago.recibo.base, pago.recibo.iva], [29, 23.58, 5.42]);
    assert.match(p.emails.at(-1).texto, /Recebemos o seu pagamento \(SIMULAÇÃO/);
    assert.match(p.emails.at(-1).texto, /relatório completo fica pronto na sua conta depois de revisto/);
    let l = await pedidoConta(c, id);
    assert.equal(l.relatorio, 'em_revisao');
    assert.equal(l.compras.relatorio.comprado, true);
    assert.equal((await comprar(c, id, 'relatorio_pormenorizado')).estado, 409, 'já comprado');
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).json.erro, 'O relatório está em revisão (até 24 h).');
    const o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual(o.pagamentos.map((x) => [x.fase, x.fase_texto, x.valor, x.estado]), [['relatorio_pormenorizado', 'Relatório completo', 29, 'falhado'], ['relatorio_pormenorizado', 'Relatório completo', 29, 'pago']]);
    const lib = await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {});
    assert.equal(lib.estado, 200, lib.texto);
    l = await pedidoConta(c, id);
    assert.equal(l.relatorio, 'disponivel');
    const rel = (await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).json.relatorio;
    assert.ok(rel.divisoes[0].material.length, 'o pormenorizado tem o material');
    assert.match(rel.nota, /descontado na obra/);
  });

  test('visita técnica: deslocação + 0,5 h × tarifa (servidor); fora da área recusada; paga → o CEO marca → conta e email com a data e a disponibilidade no painel', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    const pg = await comprado(c, id, 'visita');
    assert.deepEqual([pg.fase, pg.valor, pg.com_visita], ['visita', VISITA_SINTRA, true]);
    assert.match(p.emails.at(-1).texto, /Vamos marcar a visita técnica/);
    let l = await pedidoConta(c, id);
    assert.equal(l.compras.visita.paga, true);
    assert.equal(l.relatorio, 'por_comprar', 'a visita não inclui o relatório');
    assert.equal((await comprar(c, id, 'visita')).estado, 409, 'já paga');
    assert.equal((await comprar(c, id, 'pormenorizado_visita')).estado, 409, 'nem os dois juntos');
    // O CEO (ou o comercial) marca a visita: data e hora; "Visita marcada"; email e conta com a data.
    assert.equal((await painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: '2026-10-05' })).estado, 400, 'sem hora');
    assert.equal((await painel('POST', `orcamentos/${id}/marcar-visita`, 'tecnico', { data_visita: '2026-10-05T10:30' })).estado, 403);
    const mv = await painel('POST', `orcamentos/${id}/marcar-visita`, 'comercial', { data_visita: '2026-10-05T10:30' });
    assert.equal(mv.estado, 200, mv.texto);
    assert.equal(mv.json.estado, 'visita_marcada');
    assert.equal(mv.json.data_visita, '2026-10-05T10:30');
    assert.ok(mv.json.compras.visita.paga);
    assert.deepEqual(mv.json.simulacao.visita, { dias: ['seg', 'qua'], periodo: 'manha' }, 'a disponibilidade do cliente vem na ficha');
    assert.ok(mv.json.historico.some((h) => h.acao === 'visita_marcada' && h.detalhes.data_visita === '2026-10-05T10:30'));
    const email = p.emails.at(-1);
    assert.equal(email.assunto, 'Domus Energia: visita técnica marcada');
    assert.match(email.texto, /segunda-feira, 5 de outubro.*10:30/);
    l = await pedidoConta(c, id);
    assert.equal(l.data_visita, '2026-10-05T10:30');
    assert.equal(l.estado_texto, 'Visita técnica marcada.');
    // Fora da área: não há visita (nem na conta, nem ao comprar).
    const d = await p.contaConfirmada();
    const { pedido: longe } = await enviar(d, { localidade: 'Funchal' });
    const ld = await pedidoConta(d, longe);
    assert.deepEqual([ld.compras.visita.valor, ld.compras.visita.fora_area], [null, true]);
    const rf = await comprar(d, longe, 'visita');
    assert.equal(rf.estado, 409);
    assert.match(rf.json.erro, /fora da área servida/);
    assert.equal((await comprar(d, longe, 'relatorio_pormenorizado')).estado, 200, 'o relatório compra-se na mesma');
    // B2: concelho não reconhecido — também não há visita (409), nem no passo Enviar nem na conta; o relatório sim.
    const e = await p.contaConfirmada();
    const rx = await enviar(e, { localidade: 'Xyzlândia', compra: 'pormenorizado_visita' });
    assert.equal(rx.pagamento, undefined, 'sem pagamento aberto');
    assert.match(rx.pagamento_erro, /Não reconhecemos o concelho/);
    const lx = await pedidoConta(e, rx.pedido);
    assert.deepEqual([lx.compras.visita.valor, lx.compras.visita.fora_area, lx.compras.visita.sem_concelho], [null, false, true]);
    const rvx = await comprar(e, rx.pedido, 'visita');
    assert.equal(rvx.estado, 409);
    assert.match(rvx.json.erro, /Não reconhecemos o concelho/);
    assert.equal((await comprar(e, rx.pedido, 'pormenorizado_visita')).estado, 409);
    assert.equal((await comprar(e, rx.pedido, 'relatorio_pormenorizado')).estado, 200, 'o relatório compra-se na mesma');
  });

  test('passo Enviar: "relatório completo e visita" = um só pagamento (29 € + visita) sobre o pedido já criado; fora da área o pedido fica e diz porquê', async () => {
    const c = await p.contaConfirmada();
    const antes = nOrc();
    const r = await enviar(c, { compra: 'pormenorizado_visita' });
    assert.equal(nOrc(), antes + 1, 'o pedido existe antes de pagar');
    const pg = r.pagamento;
    assert.deepEqual([pg.fase, pg.valor, pg.orcamento_id], ['pormenorizado_visita', centSim(29 + VISITA_SINTRA), r.pedido]);
    assert.match(pg.descricao, /^Relatório completo e visita técnica do pedido/);
    // Comprar só o relatório na conta, com o combinado por pagar: o combinado sai (não se paga duas vezes).
    const so = await comprar(c, r.pedido, 'relatorio_pormenorizado');
    assert.equal((await ver(c, pg.ref)).json.pagamento.estado, 'cancelado');
    await simular(c, so.json.pagamento.ref, 'cancelar');
    const pago = await comprado(c, r.pedido, 'pormenorizado_visita');
    assert.equal(pago.fase_texto, 'Relatório completo e visita técnica');
    const l = await pedidoConta(c, r.pedido);
    assert.deepEqual([l.relatorio, l.compras.visita.paga], ['em_revisao', true]);
    // Só o pormenorizado no Enviar.
    const r2 = await enviar(c, { compra: 'pormenorizado' });
    assert.deepEqual([r2.pagamento.fase, r2.pagamento.valor], ['relatorio_pormenorizado', 29]);
    // Fora da área com visita: o pedido é enviado na mesma (grátis) e a resposta explica.
    const r3 = await enviar(c, { compra: 'pormenorizado_visita', localidade: 'Funchal' });
    assert.equal(r3.pagamento, undefined);
    assert.match(r3.pagamento_erro, /fora da área servida/);
    assert.equal((await painel('GET', `orcamentos/${r3.pedido}`)).json.estado, 'novo');
  });

  test('avaria rápida: paga ao enviar o diagnóstico + deslocação (visita pedida); invisível até paga; fora da área 409; nada de relatório à parte', async () => {
    const c = await p.contaConfirmada();
    const antes = nOrc();
    const pg = await enviarAvaria(c);
    assert.deepEqual([pg.fase, pg.valor, pg.com_visita, pg.estado], ['avaria', centSim(DIAG_SINTRA), true, 'pendente']);
    assert.match(pg.descricao, /Diagnóstico da avaria e deslocação/);
    assert.equal(nOrc(), antes, 'ainda não é um pedido do painel');
    assert.equal((await enviarAvaria(c)).ref, pg.ref, 'clicar outra vez: o mesmo pagamento');
    const f = await simular(c, pg.ref, 'falha');
    assert.equal(f.json.voltar, `simulador.html?pagamento=${pg.ref}`);
    assert.equal(nOrc(), antes);
    const pg2 = await enviarAvaria(c);
    assert.notEqual(pg2.ref, pg.ref);
    const ok = await simular(c, pg2.ref, 'sucesso');
    const id = ok.json.pagamento.orcamento_id;
    assert.ok(id);
    assert.equal(nOrc(), antes + 1);
    assert.match(p.emails.at(-1).texto, /Vamos marcar a visita técnica/);
    const o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'novo');
    assert.ok(o.historico.some((h) => h.acao === 'orcamento_recebido' && h.detalhes.pagamento === pg2.ref));
    assert.equal(o.compras.visita.paga, true, 'a visita está paga');
    // Fotos: o token vem no regresso (só para a avaria acabada de pagar).
    const v = await ver(c, pg2.ref, '?fotos=1');
    const fo = await p.pedir('POST', '/api/orcamento/fotos', { corpo: JPEG(), tipo: 'image/jpeg', cabecalhos: { 'X-Fotos-Token': v.json.fotos_token, 'X-Foto-Chave': FOTO_AVARIA, 'X-Foto-Legenda': 'Avaria' } });
    assert.equal(fo.estado, 201, fo.texto);
    // Na avaria não se vende o relatório nem a visita à parte.
    const l = await pedidoConta(c, id);
    assert.deepEqual([l.relatorio, l.compras.pode, l.compras.avaria], [null, false, true]);
    assert.equal((await comprar(c, id, 'relatorio_pormenorizado')).estado, 409);
    // Fora da área: não se envia (fale connosco).
    const rf = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'X', telefone: '912 000 111', servico: 'R', localidade: 'Funchal', simulacao: { ...SIM_AVARIA, casa: { ...SIM_AVARIA.casa, localidade: 'Funchal' } } } });
    assert.equal(rf.estado, 409, rf.texto);
    assert.match(rf.json.erro, /fora da área servida.*telefone ou WhatsApp/);
  });

  test('idempotência: o mesmo evento e sucesso repetido não duplicam; evento com o valor errado é ignorado', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviarAvaria(c);
    const ev = {
      id: 'evt_teste_repetido', type: 'checkout.session.completed',
      data: { object: { id: 'cs_x', object: 'checkout.session', client_reference_id: pg.ref, amount_total: Math.round(DIAG_SINTRA * 100), currency: 'eur', payment_status: 'paid' } },
    };
    const pag = p.app.api.pagamentosPedido;
    const antes = nOrc();
    assert.equal(pag.tratarEvento(ev), 'pago');
    assert.equal(pag.tratarEvento(ev), 'repetido');
    assert.equal(pag.tratarEvento({ ...ev, id: 'evt_teste_outro' }), 'repetido', 'outro evento, o mesmo pagamento');
    assert.equal((await simular(c, pg.ref, 'sucesso')).estado, 200, 'sucesso outra vez responde o mesmo');
    assert.equal(nOrc(), antes + 1, 'um só pedido');
    const { pedido } = await enviar(c);
    const r = (await comprar(c, pedido, 'relatorio_pormenorizado')).json.pagamento;
    assert.equal(pag.tratarEvento({ ...ev, id: 'evt_valor', data: { object: { ...ev.data.object, client_reference_id: r.ref, amount_total: 100 } } }), 'ignorado');
    assert.equal((await ver(c, r.ref)).json.pagamento.estado, 'pendente');
    assert.equal((await simular(c, r.ref, 'cancelar')).json.pagamento.estado, 'cancelado');
  });

  test('acesso cruzado: outra conta não vê nem paga (404); sem sessão 401; origem desconhecida 403', async () => {
    const a = await p.contaConfirmada();
    const b = await p.contaConfirmada();
    const { pedido: id } = await enviar(a);
    const pg = (await comprar(a, id, 'relatorio_pormenorizado')).json.pagamento;
    assert.equal((await ver(b, pg.ref)).estado, 404);
    assert.equal((await simular(b, pg.ref, 'sucesso')).estado, 404);
    assert.equal((await p.pedir('GET', `/api/conta/pagamentos/${pg.ref}`)).estado, 401);
    assert.equal((await p.pedir('POST', `/api/conta/pagamentos/${pg.ref}/simular`, { cookie: a.cookie, corpo: { resultado: 'sucesso' }, site: false, cabecalhos: { Origin: 'https://mau.exemplo', 'Sec-Fetch-Site': 'cross-site' } })).estado, 403);
    assert.equal((await ver(a, pg.ref)).json.pagamento.estado, 'pendente');
    for (const fase of ['sinal', 'relatorio_pormenorizado', 'visita']) assert.equal((await comprar(b, id, fase)).estado, 404, fase);
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: b.cookie })).estado, 404);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: b.cookie, corpo: { plano: 'base' } })).estado, 404);
  });

  test('proposta 1000 € + IVA 23 % = 1230 € com relatório (29 €) e visita pagos: sinal = 369 − 29 − visita; restante 861 €', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    await comprado(c, id, 'relatorio_pormenorizado');
    await comprado(c, id, 'visita');
    const sinalEsperado = centSim(369 - 29 - VISITA_SINTRA);
    assert.equal((await painel('POST', `orcamentos/${id}`, 'comercial', { estado: 'proposta_enviada', valor_proposta: 1000, proposta_texto: 'Instalação completa.' })).estado, 200);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000 } })).estado, 400, 'sem plano');
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 999, plano: 'base' } })).estado, 409);
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'conforto' } });
    assert.equal(ac.estado, 200, ac.texto);
    assert.deepEqual([ac.json.pagamento.fase, ac.json.pagamento.valor, ac.json.pagamento.iva_pct], ['sinal', sinalEsperado, 23]);
    assert.match(ac.json.pagamento.descricao, /^Sinal de 30 % da proposta .*1230,00 € com IVA\), menos os 55,20 € já pagos/);
    assert.equal(ac.json.pedido.aguarda_sinal, true);
    assert.deepEqual(ac.json.pedido.sinal, { valor: sinalEsperado, pct: 30, desconto: centSim(29 + VISITA_SINTRA), pago: false, cobre_material: false });
    assert.deepEqual(ac.json.pedido.proposta_iva, { base: 1000, iva_pct: 23, iva: 230, total: 1230 });
    assert.equal(ac.json.pedido.compras.pode, false, 'aceite: já não se compra o relatório nem a visita');
    assert.equal((await comprar(c, id, 'visita')).estado, 409);
    let o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'proposta_enviada', 'só "aceite" depois do sinal');
    assert.equal(o.aguarda_sinal, true);
    assert.equal((await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'conforto' } })).json.pagamento.ref, ac.json.pagamento.ref);
    assert.equal((await comprar(c, id, 'restante')).estado, 409, 'restante antes do tempo');
    assert.equal((await simular(c, ac.json.pagamento.ref, 'sucesso')).json.pagamento.estado, 'pago');
    o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.equal(o.estado, 'aceite');
    assert.ok(o.historico.some((h) => h.acao === 'proposta_aceite_cliente'));
    assert.ok((await painel('GET', 'resumo')).json.propostas_aceites_online.some((x) => x.id === id));
    assert.equal((await comprar(c, id, 'sinal')).estado, 409, 'sinal já pago');
    assert.equal((await comprar(c, id, 'restante')).estado, 409, 'obra por concluir');
    assert.equal((await pedidoConta(c, id)).restante.valor, 861);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'comercial', {})).estado, 200);
    assert.match(p.emails.at(-1).texto, /861,00 €, com IVA/);
    assert.deepEqual((await painel('GET', `orcamentos/${id}`)).json.valores_pagamento,
      { proposta: 1000, iva_pct: 23, iva: 230, total: 1230, pago_antes: centSim(29 + VISITA_SINTRA), sinal: sinalEsperado, restante: 861,
        base: 1000, minima: null, desconto: centSim(29 + VISITA_SINTRA), em_falta: 861, material_origem: null, sinal_material: false });
    assert.equal((await pedidoConta(c, id)).pode_pagar_restante, true);
    const rs = await comprar(c, id, 'restante');
    assert.equal(rs.json.pagamento.valor, 861);
    const fim = await simular(c, rs.json.pagamento.ref, 'sucesso');
    assert.deepEqual([fim.json.pagamento.recibo.base, fim.json.pagamento.recibo.iva, fim.json.pagamento.recibo.valor], [700, 161, 861]);
    assert.match(p.emails.at(-1).texto, /Valor: 861,00 € \(700,00 € \+ IVA 23 % 161,00 €\)/);
    o = (await painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual(o.pagamentos.filter((x) => x.estado === 'pago').map((x) => [x.fase, x.valor]),
      [['relatorio_pormenorizado', 29], ['visita', VISITA_SINTRA], ['sinal', sinalEsperado], ['restante', 861]]);
    const total = o.pagamentos.filter((x) => x.estado === 'pago').reduce((t, x) => t + Math.round(x.valor * 100), 0);
    assert.equal(total, 123_000, 'no fim pagou exatamente a proposta com IVA');
  });

  test('avaria paga e a reparação avança: o diagnóstico e a deslocação são descontados no sinal', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviarAvaria(c);
    const id = (await simular(c, pg.ref, 'sucesso')).json.pagamento.orcamento_id;
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 200 });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 200, plano: 'base' } });
    assert.equal(ac.json.pagamento.valor, centSim(0.3 * 246 - DIAG_SINTRA), '30 % × 246 − 47,60');
  });

  test('a proposta muda com o sinal por pagar: o sinal sai e o cliente aceita de novo', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    await comprado(c, id, 'relatorio_pormenorizado');
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
    await painel('POST', `orcamentos/${id}`, 'ceo', { valor_proposta: 2000 });
    assert.equal((await ver(c, ac.json.pagamento.ref)).json.pagamento.estado, 'cancelado');
    assert.equal((await simular(c, ac.json.pagamento.ref, 'sucesso')).estado, 409);
    const ac2 = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 2000, plano: 'base' } });
    assert.equal(ac2.json.pagamento.valor, 709, '30 % × 2460 − 29');
  });

  test('pedidos antigos (19 € pagos, fase "relatorio"): contam como relatório e visita comprados e descontam no sinal', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    const agora = new Date().toISOString();
    p.app.db.prepare(`INSERT INTO pagamentos_pedido (ref, conta_id, orcamento_id, fase, valor_cent, descricao, estado, modo, retorno, com_visita, criado, atualizado, pago, expira, iva_pct)
      VALUES ('pp_antigo19eurosAAAAAAAA', (SELECT conta_id FROM orcamentos WHERE id = ?), ?, 'relatorio', 1900, 'Relatório técnico e visita técnica (19 € descontados na obra)', 'pago', 'simulado', 'simulador', 1, ?, ?, ?, 0, 23)`).run(id, id, agora, agora, agora);
    const l = await pedidoConta(c, id);
    assert.deepEqual([l.relatorio, l.compras.relatorio.comprado, l.compras.visita.paga], ['em_revisao', true, true]);
    assert.equal(l.pagamentos[0].fase_texto, 'Relatório técnico e visita (19 €)');
    assert.equal((await comprar(c, id, 'visita')).estado, 409);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
    assert.equal(ac.json.pagamento.valor, 350, '30 % × 1230 − 19 (como antes)');
    const csv = (await painel('GET', 'pagamentos-pedido?formato=csv')).texto;
    assert.ok(csv.split('\r\n').some((x) => x.startsWith(agora.slice(0, 10)) || x.includes('pp_antigo19eurosAAAAAAAA')));
  });

  const precoCat = (sku) => p.app.db.prepare('SELECT preco_venda_iva_cent FROM catalogo WHERE sku = ?').get(sku).preco_venda_iva_cent / 100;
  const horasCat = (sku, troca = false) => {
    const a = p.app.db.prepare('SELECT horas_instalacao, horas_troca FROM catalogo WHERE sku = ?').get(sku);
    return troca ? (a.horas_troca ?? a.horas_instalacao * 0.5) : a.horas_instalacao;
  };
  const cent = (x) => Math.round(x * 100) / 100;
  /** Pedido enviado com o relatório completo já pago; devolve o id. */
  async function comRelatorio(c, simulacao) {
    const { pedido } = await enviar(c, simulacao ? { simulacao } : {});
    await comprado(c, pedido, 'relatorio_pormenorizado');
    return pedido;
  }

  test('relatório completo: em revisão até o CEO o libertar (com pré-visualização); versão do cliente sem dados internos e com os preços do CATÁLOGO', async () => {
    const c = await p.contaConfirmada();
    // O browser manda preços absurdos: o relatório usa os do catálogo do servidor.
    const barato = { ...SIM, itens: SIM.itens.map((i) => ({ ...i, preco_iva: 1 })), mao_obra: { horas: 1, valor_iva: 1 }, deslocacao: { estado: 'estimada', valor_iva: 1 } };
    const id = await comRelatorio(c, barato);
    assert.equal((await pedidoConta(c, id)).relatorio, 'em_revisao');
    assert.equal((await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).estado, 409);
    const previa = await painel('GET', `orcamentos/${id}/relatorio-cliente`);
    assert.equal(previa.estado, 200, previa.texto);
    assert.equal((await painel('GET', `orcamentos/${id}/relatorio-cliente`, 'comercial')).estado, 403);
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'comercial', {})).estado, 403);
    const lib = await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {});
    assert.equal(lib.estado, 200, lib.texto);
    assert.ok(lib.json.relatorio_libertado);
    assert.match(p.emails.at(-1).texto, /relatório técnico/);
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 409);
    assert.equal((await pedidoConta(c, id)).relatorio, 'disponivel');
    const r = await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie });
    assert.equal(r.estado, 200, r.texto);
    const rel = r.json.relatorio;
    assert.deepEqual({ ...previa.json.relatorio, libertado: null }, { ...rel, libertado: null }, 'a pré-visualização é o que o cliente vê');
    assert.deepEqual(rel.divisoes.map((d) => d.nome), ['Sala', 'Quarto']);
    const sala = rel.divisoes[0];
    assert.ok(sala.trabalho.some((t) => /Novo: 2 interruptores/.test(t)), 'pedido antigo (sem ações): tudo Novo');
    assert.equal(sala.total, cent(precoCat('INT-VIDRO-2') + precoCat('INT-VIDRO-1') + precoCat('BAB-CURTAIN') + precoCat('SENS-PORTA-WIFI')));
    assert.equal(rel.divisoes[1].total, precoCat('INT-VIDRO-1'));
    assert.equal(rel.geral.material.length, 1, 'o que não é de nenhuma divisão (quadro)');
    assert.equal(rel.geral.total, cent(3 * precoCat('TONGOU-SY2-JWT')));
    const horas = cent(horasCat('INT-VIDRO-2') + 2 * horasCat('INT-VIDRO-1') + horasCat('BAB-CURTAIN') + horasCat('SENS-PORTA-WIFI') + 3 * horasCat('TONGOU-SY2-JWT'));
    assert.deepEqual(rel.mao_obra, { horas, valor: cent(horas * 38) }, 'horas do catálogo × tarifa da configuração');
    assert.equal(rel.deslocacao, DESLOC_SINTRA, 'Sintra: (29 − 20 km) × 0,40 €');
    assert.equal(rel.total, cent(sala.total + rel.divisoes[1].total + rel.geral.total + rel.mao_obra.valor + rel.deslocacao));
    assert.doesNotMatch(r.texto, /fornecedor|preco_compra|link|circuito/i);
  });

  test('relatório do cliente: lista de trabalho por divisão e ação (Reparar/Substituir/Novo, avarias), Manter só contado', async () => {
    const c = await p.contaConfirmada();
    const SIM_T = {
      ...SIM, servico: ['automatizar', 'reparar'], divisoes: [{ nome: 'Cozinha' }],
      trabalho: [{ divisao: 'd1', nome: 'Cozinha', piso: 0, acoes: [
        { acao: 'manter', tipo: 'luz', modelo: null, qtd: 3, material: [], horas: 0, foto: null },
        { acao: 'reparar', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'DIAG-AVARIA', qtd: 1 }], horas: 0.5, foto: 'd1:tomada', avarias: ['queimada'] },
        { acao: 'substituir', tipo: 'interruptor', modelo: null, qtd: 2, material: [{ sku: 'INT-VIDRO-1', qtd: 2 }], horas: 0.5, foto: null, inteligentes: 2 },
        { acao: 'novo', tipo: 'tomada', modelo: null, qtd: 1, material: [{ sku: 'TOMADA-WIFI', qtd: 1 }], horas: 0.3, foto: null },
      ] }],
      totais_acao: { manter: { aparelhos: 3 }, reparar: { aparelhos: 1, artigos_iva: 99999, horas: 1 }, substituir: { aparelhos: 2 }, novo: { aparelhos: 1 } },
      itens: [{ sku: 'DIAG-AVARIA', qtd: 1, preco_iva: 1, grupo: 'reparar' }, { sku: 'INT-VIDRO-1', qtd: 2, preco_iva: 1, grupo: 'substituir' },
        { sku: 'TOMADA-WIFI', qtd: 1, preco_iva: 1 }, { sku: 'TONGOU-SY2-JWT', qtd: 1, preco_iva: 1, grupo: 'quadro' }],
    };
    const { pedido: id } = await enviar(c, { simulacao: SIM_T });
    const rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.deepEqual(rel.acoes, { manter: 3, reparar: 1, substituir: 2, novo: 1 });
    assert.equal(rel.divisoes.length, 1);
    const coz = rel.divisoes[0];
    assert.equal(coz.nome, 'Cozinha');
    assert.deepEqual(coz.trabalho, ['Reparar: 1 tomada («queimada»; ver foto)', 'Substituir: 2 interruptores por inteligentes (sem foto)', 'Novo: 1 tomada']);
    assert.deepEqual(coz.material.map((m) => [m.quantidade, m.preco_unitario]), [[1, precoCat('DIAG-AVARIA')], [2, precoCat('INT-VIDRO-1')], [1, precoCat('TOMADA-WIFI')]]);
    assert.deepEqual(rel.geral.material.map((m) => m.quantidade), [1], 'o quadro à parte');
    const horas = cent(horasCat('DIAG-AVARIA') + 2 * horasCat('INT-VIDRO-1', true) + horasCat('TOMADA-WIFI') + horasCat('TONGOU-SY2-JWT'));
    assert.equal(rel.mao_obra.horas, horas, 'ao substituir, as horas de troca');
    assert.doesNotMatch(JSON.stringify(rel), /99999/, 'nada dos totais do browser');
    // O básico tem a mesma lista de trabalho (sem o material).
    const basico = (await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio-basico`, { cookie: c.cookie })).json.relatorio;
    assert.deepEqual(basico.divisoes[0], { nome: 'Cozinha', trabalho: coz.trabalho });
    assert.deepEqual(basico.acoes, rel.acoes);
  });

  test('relatório completo — conteúdo técnico: planta (sem fundo), esquema por luz (comando por divisão), terra e ensaios (ordem 612.1, referência da configuração); o básico não os tem', async () => {
    const c = await p.contaConfirmada();
    const planta = {
      escala_cm: 50, largura_cm: 1000, altura_cm: 600, fundo: { imagem: 'data:image/jpeg;base64,AAAA', x_cm: 0, y_cm: 0, largura_cm: 1000, opacidade: 0.5 },
      divisoes: [
        { id: 'd1', nome: 'Sala', piso: 0, x_cm: 0, y_cm: 0, largura_cm: 500, altura_cm: 400 },
        { id: 'd2', nome: 'Quarto', piso: 0, x_cm: 500, y_cm: 0, largura_cm: 400, altura_cm: 400, pontos: [[500, 0], [900, 0], [900, 200], [700, 400], [500, 400]] },
        { id: 'd3', nome: 'Corredor', piso: 1, x_cm: 0, y_cm: 400, largura_cm: 900, altura_cm: 150 },
      ],
      elementos: [
        { id: 'e1', tipo: 'luz', x_cm: 250, y_cm: 200, rot: 0, piso: 0, divisao: 'd1', props: {} },
        { id: 'e2', tipo: 'luz', x_cm: 150, y_cm: 200, rot: 0, piso: 0, divisao: 'd1', props: {}, nome: 'Luz do sofá' },
        { id: 'e3', tipo: 'interruptor', x_cm: 60, y_cm: 390, rot: 0, piso: 0, divisao: 'd1', props: { botoes: 1, comando: 'escada' } },
        { id: 'e4', tipo: 'interruptor', x_cm: 440, y_cm: 390, rot: 0, piso: 0, divisao: 'd1', props: { botoes: 1, comando: 'escada' } },
        { id: 'e5', tipo: 'tomada', x_cm: 10, y_cm: 100, rot: 90, piso: 0, divisao: 'd1', props: { dupla: true } },
        { id: 'e6', tipo: 'maquina', x_cm: 400, y_cm: 100, rot: 0, piso: 0, divisao: 'd1', props: { modelo: 'termoacumulador', potencia_w: 2000 } },
        { id: 'e7', tipo: 'maquina', x_cm: 60, y_cm: 60, rot: 0, piso: 0, divisao: 'd1', props: { modelo: 'campainha', potencia_w: 10 } },
        { id: 'e8', tipo: 'luz', x_cm: 700, y_cm: 200, rot: 0, piso: 0, divisao: 'd2', props: {} },
        { id: 'e9', tipo: 'interruptor', x_cm: 520, y_cm: 390, rot: 0, piso: 0, divisao: 'd2', props: { botoes: 2 } },
        { id: 'e10', tipo: 'luz', x_cm: 450, y_cm: 475, rot: 0, piso: 1, divisao: 'd3', props: {} },
        { id: 'e11', tipo: 'quadro', x_cm: 20, y_cm: 420, rot: 0, piso: 1, divisao: 'd3', props: {} },
      ],
    };
    const { pedido: id } = await enviar(c, { simulacao: { ...SIM, planta } });
    const rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    // Planta: só o que se desenha (sem a imagem de fundo), com o nome do modelo nas máquinas.
    assert.equal(rel.planta.fundo, undefined);
    assert.equal(rel.planta.elementos.length, 11);
    assert.equal(rel.planta.elementos.find((e) => e.id === 'e6').nome, 'termoacumulador');
    assert.deepEqual(rel.planta.elementos.find((e) => e.id === 'e3').props, { comando: 'escada' });
    assert.deepEqual(rel.planta.divisoes[1].pontos, planta.divisoes[1].pontos);
    // Esquema por luz: Sala com 2 comutadores de escada; Quarto simples; Corredor sem interruptor → a confirmar.
    assert.deepEqual(rel.esquemas.map((d) => [d.nome, d.piso, d.interruptores, d.luzes.map((l) => [l.nome, l.comando])]), [
      ['Sala', 0, 2, [['Ponto de luz 1', 'escada'], ['Luz do sofá', 'escada']]],
      ['Quarto', 0, 1, [['Ponto de luz 1', 'simples']]],
      ['Corredor', 1, 0, [['Ponto de luz 1', 'simples']]],
    ]);
    assert.equal(rel.esquemas[0].luzes[0].texto, 'Comando: escada (2 comutadores)');
    assert.match(rel.esquemas[2].luzes[0].texto, /simples \(1 interruptor\) — sem interruptor na planta, a confirmar na visita/);
    assert.equal(rel.terra_nota, 'Verificar terra (PE) nas tomadas na visita.');
    // Ensaios pela ordem 612.1 com os valores de referência por omissão; nada medido ainda.
    assert.deepEqual(rel.ensaios.lista.map((e) => [e.chave, e.referencia, e.medido]), [
      ['continuidade_pe', 'valor medido (sem limite fixado; fonte de 4 a 24 V, ≥ 0,2 A)', null],
      ['isolamento', '≥ 0,5 MΩ, a 500 V DC', null],
      ['terra', '≤ 100 Ω; e RA × IΔn ≤ 50 V', null],
      ['diferencial', 'dispara a uma corrente ≤ IΔn; tempo ≤ 300 ms', null],
    ]);
    assert.match(rel.ensaios.lista[3].norma, /EN 61008\/61009/);
    assert.equal(rel.ensaios.nota, 'Valores de referência a confirmar pelo técnico.');
    // O básico (grátis) não leva nada disto.
    const basico = (await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio-basico`, { cookie: c.cookie })).json.relatorio;
    for (const k of ['planta', 'esquemas', 'terra_nota', 'ensaios']) assert.equal(basico[k], undefined, `${k} só no pormenorizado`);
    assert.doesNotMatch(JSON.stringify(basico), /\(PE\)|ensaio|Comando:/);
    // Comprado e libertado: a conta vê o mesmo.
    await comprado(c, id, 'relatorio_pormenorizado');
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 200);
    const conta = (await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie })).json.relatorio;
    assert.deepEqual(conta.esquemas, rel.esquemas);
    assert.deepEqual(conta.ensaios, rel.ensaios);
    assert.equal(conta.planta.elementos.length, 11);
    // A avaria rápida não tem planta nem esquemas (mas a lista de ensaios fica).
    const refAv = await enviarAvaria(c);
    await simular(c, refAv.ref, 'sucesso');
    const idAv = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.compras?.avaria).id;
    const relAv = (await painel('GET', `orcamentos/${idAv}/relatorio-cliente`)).json.relatorio;
    assert.equal(relAv.planta, null);
    assert.deepEqual(relAv.esquemas, []);
    assert.equal(relAv.ensaios.lista.length, 4);
  });

  test('relatório completo — esquema do quadro: o cliente recebe só o desenho (sem o email de quem o fez nem as notas de trabalho)', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    assert.equal((await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio.esquema_quadro, null, 'sem esquema: null');
    const esquema = {
      disjuntor_geral: { amperes: 40 }, diferenciais: [{ sensibilidade_ma: 30, amperes: 40 }], disjuntores: [{ amperes: 16 }, { amperes: 10 }],
      modulos_livres: 2, estado: 'razoavel', fusiveis: false, sinais_aquecimento: null, notas: 'Marca Hager; confirmar o neutro na visita.',
      ordem: ['geral', 'diferencial:0', 'disjuntor:0', 'livre', 'disjuntor:1', 'livre'],
    };
    const r = await painel('POST', `orcamentos/${id}/esquema-quadro`, 'comercial', { esquema });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.esquema_quadro.por, p.u.comercial.email, 'o painel vê quem o fez');
    const eq = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio.esquema_quadro;
    assert.deepEqual(Object.keys(eq).sort(), ['data', 'diferenciais', 'disjuntor_geral', 'disjuntores', 'estado', 'fusiveis', 'modulos_livres', 'ordem']);
    assert.deepEqual(eq.ordem, esquema.ordem);
    assert.equal(eq.disjuntor_geral.amperes, 40);
    assert.equal(eq.por, undefined, 'sem o email do eletricista');
    assert.equal(eq.notas, undefined, 'sem as notas de trabalho');
    // Comprado e libertado: a conta recebe o mesmo JSON, sem rasto do email nem das notas.
    await comprado(c, id, 'relatorio_pormenorizado');
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 200);
    const conta = await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio`, { cookie: c.cookie });
    assert.equal(conta.estado, 200, conta.texto);
    assert.deepEqual(conta.json.relatorio.esquema_quadro, eq);
    assert.doesNotMatch(conta.texto, /domus\.teste|Hager/);
  });

  test('ensaios: referência configurável no painel (Catálogo → Configuração, não pública); valores medidos registados no painel (ida e volta) e mostrados ao cliente', async () => {
    const c = await p.contaConfirmada();
    const { pedido: id } = await enviar(c);
    // Configuração: a chave existe por omissão (migração 16), muda no painel e não sai no /api/catalogo.
    const cfg = (await painel('GET', 'config-orcamento')).json;
    assert.deepEqual([cfg.ensaio_isolamento_mohm, cfg.ensaio_diferencial_ms, cfg.ensaio_terra_ohm], [0.5, 300, 100]);
    assert.equal((await p.pedir('GET', '/api/catalogo')).json.config.ensaio_terra_ohm, undefined, 'não é pública');
    const m = await painel('POST', 'config-orcamento', 'ceo', { ensaio_isolamento_mohm: 1, ensaio_diferencial_ms: 200, ensaio_terra_ohm: 50 });
    assert.equal(m.estado, 200, m.texto);
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { ensaio_terra_ohm: -1 })).estado, 400);
    try {
      let rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
      assert.deepEqual(rel.ensaios.lista.map((e) => e.referencia), ['valor medido (sem limite fixado; fonte de 4 a 24 V, ≥ 0,2 A)', '≥ 1 MΩ, a 500 V DC', '≤ 50 Ω; e RA × IΔn ≤ 50 V', 'dispara a uma corrente ≤ IΔn; tempo ≤ 200 ms']);
      // Medidos: o comercial regista; a ficha e o relatório trazem-nos; um valor inválido dá 400; o técnico não pode (403).
      assert.equal((await painel('GET', `orcamentos/${id}`)).json.ensaios, null);
      assert.equal((await painel('POST', `orcamentos/${id}/ensaios`, 'tecnico', { terra: 12 })).estado, 403);
      assert.equal((await painel('POST', `orcamentos/${id}/ensaios`, 'comercial', { terra: 'x' })).estado, 400);
      assert.equal((await painel('POST', `orcamentos/${id}/ensaios`, 'comercial', { terra: 12, outra: 1 })).estado, 400, 'campo desconhecido');
      const r = await painel('POST', `orcamentos/${id}/ensaios`, 'comercial', { continuidade_pe: 0.35, isolamento: 250, terra: 12.5, diferencial: 24, notas: 'Medido com o Fluke 1664' });
      assert.equal(r.estado, 200, r.texto);
      assert.deepEqual({ ...r.json.ensaios, data: null }, { continuidade_pe: 0.35, isolamento: 250, terra: 12.5, diferencial: 24, notas: 'Medido com o Fluke 1664', data: null });
      assert.ok(r.json.ensaios.data);
      assert.deepEqual((await painel('GET', `orcamentos/${id}`)).json.ensaios, r.json.ensaios, 'ida e volta');
      rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
      assert.deepEqual(rel.ensaios.lista.map((e) => e.medido), [0.35, 250, 12.5, 24]);
      assert.equal(rel.ensaios.notas, 'Medido com o Fluke 1664');
      // Em branco apaga a medição.
      const r2 = await painel('POST', `orcamentos/${id}/ensaios`, 'ceo', { continuidade_pe: null, isolamento: 250 });
      assert.deepEqual([r2.json.ensaios.continuidade_pe, r2.json.ensaios.isolamento, r2.json.ensaios.terra, r2.json.ensaios.notas], [null, 250, null, null]);
      const aud = p.app.db.prepare("SELECT acao FROM auditoria WHERE acao = 'ensaios_registados'").all();
      assert.equal(aud.length, 2);
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { ensaio_isolamento_mohm: 0.5, ensaio_diferencial_ms: 300, ensaio_terra_ohm: 100 });
    }
  });

  test('relatório do cliente (fase 2): secção Melhorias — material de cada pacote e instalação e configuração (margem pelo catálogo e pela configuração, não a do browser), total igual', async () => {
    const c = await p.contaConfirmada();
    const MEL = [
      { id: 'seguranca', nome: 'Segurança', itens: [{ sku: 'SENS-PORTA-WIFI', qtd: 2 }, { sku: 'SENS-PIR-WIFI', qtd: 1 }, { sku: 'SENS-AGUA-WIFI', qtd: 2 }], preco: 1 },
      { id: 'casa-inteligente', nome: 'Casa inteligente', itens: [{ sku: 'BAB-MOD-2CH', qtd: 3 }, { sku: 'TOMADA-WIFI', qtd: 2 }], preco: 1 },
      { id: 'seguranca', nome: 'Repetida', itens: [{ sku: 'SENS-AGUA-WIFI', qtd: 999 }], preco: 1 },
    ];
    const extra = MEL.slice(0, 2).flatMap((m) => m.itens.map((i) => ({ ...i, preco_iva: 1, grupo: 'melhoria' })));
    const sim = { ...SIM, itens: [...SIM.itens, ...extra], melhorias: MEL.slice(0, 2), melhorias_margem_iva: 0.01 };
    const { pedido: id } = await enviar(c, { simulacao: sim });
    // O básico: os nomes dos pacotes aceites, sem preços.
    const basico = (await p.pedir('GET', `/api/conta/pedidos/${id}/relatorio-basico`, { cookie: c.cookie })).json.relatorio;
    assert.deepEqual(basico.melhorias, ['Segurança', 'Casa inteligente']);
    // A repetida (que o validador não deixa enviar) só se testa direto na linha guardada.
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify({ ...sim, melhorias: MEL, melhorias_margem_iva: 99999 }), id);
    // O que o simulador calcula (melhorias.js calcularMelhorias): (material + horas × tarifa) × margem, por pacote.
    const catalogo = p.app.db.prepare('SELECT sku, preco_venda_iva_cent, horas_instalacao FROM catalogo').all()
      .map((a) => ({ sku: a.sku, preco_venda_iva: a.preco_venda_iva_cent / 100, horas_instalacao: a.horas_instalacao }));
    const CHAVE = { 'SENS-PORTA-WIFI': 'sensor_porta', 'SENS-PIR-WIFI': 'sensor_movimento', 'SENS-AGUA-WIFI': 'sensor_agua', 'BAB-MOD-2CH': 'modulo_interruptor', 'TOMADA-WIFI': 'tomada' };
    const margemSim = (pct) => centSim(MEL.slice(0, 2).reduce((t, m) => {
      const pr = calcularPreco(m.itens.map((i) => ({ chave: CHAVE[i.sku], qtd: i.qtd, grupo: 'melhoria' })), catalogo, {}, { valor_iva: 0 });
      const custo = centSim(pr.artigos_iva + pr.mao_obra_iva);
      return t + centSim(centSim(custo * (1 + pct / 100)) - custo);
    }, 0));
    let rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.deepEqual(rel.melhorias.pacotes.map((x) => x.nome), ['Segurança', 'Casa inteligente'], 'sem repetidos');
    assert.equal(rel.melhorias.titulo, 'Melhorias');
    assert.ok(margemSim(20) > 0);
    assert.equal(rel.melhorias.instalacao, margemSim(20), 'margem_pacotes_pct = 20 (migração 13)');
    const matDe = (m) => m.itens.map((i) => [i.qtd, precoCat(i.sku)]);
    assert.deepEqual(rel.melhorias.pacotes.map((x) => x.material.map((l) => [l.quantidade, l.preco_unitario])), MEL.slice(0, 2).map(matDe));
    assert.equal(rel.melhorias.pacotes[0].total, cent(MEL[0].itens.reduce((t, i) => t + i.qtd * precoCat(i.sku), 0)));
    assert.equal(rel.divisoes[0].material.find((l) => /porta/i.test(l.artigo))?.quantidade, 1, 'a Sala fica com o seu sensor de porta');
    assert.equal(rel.geral.total, cent(3 * precoCat('TONGOU-SY2-JWT')), 'o quadro sem o material dos pacotes');
    assert.equal(rel.melhorias.total, cent(rel.melhorias.pacotes.reduce((t, x) => t + x.total, 0) + rel.melhorias.instalacao));
    const semMargem = cent(rel.divisoes.reduce((t, d) => t + d.total, 0) + rel.geral.total + rel.mao_obra.valor + rel.deslocacao);
    const todoMaterial = cent(sim.itens.reduce((t, i) => t + i.qtd * precoCat(i.sku), 0));
    assert.equal(rel.total, cent(todoMaterial + rel.mao_obra.valor + rel.deslocacao + margemSim(20)), 'total igual ao de antes');
    assert.equal(rel.total, cent(semMargem + rel.melhorias.total), 'no total');
    assert.doesNotMatch(JSON.stringify(rel), /99999|[Mm]argem/);
    p.app.db.prepare('UPDATE config_orcamento SET valor = ? WHERE chave = ?').run(30, 'margem_pacotes_pct');
    try {
      rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
      assert.equal(rel.melhorias.instalacao, margemSim(30));
    } finally {
      p.app.db.prepare('UPDATE config_orcamento SET valor = ? WHERE chave = ?').run(20, 'margem_pacotes_pct');
    }
    const QS = { id: 'quadro-seguro', nome: 'Quadro seguro', itens: [{ sku: 'RCBO-WIFI-TOSMR1', qtd: 2 }, { sku: 'GERAL-WIFI-2P-63A', qtd: 1 }], preco: 1,
      quadro_delta: [{ sku: 'IDR-2P-40A-30MA', qtd: -2 }, { sku: 'GERAL-2P-63A', qtd: -1 }, { sku: 'RCBO-WIFI-TOSMR1', qtd: 2 }, { sku: 'GERAL-WIFI-2P-63A', qtd: 1 }] };
    const simQs = { ...SIM, itens: [...SIM.itens, { sku: 'RCBO-WIFI-TOSMR1', qtd: 3, preco_iva: 1, grupo: 'quadro' }, { sku: 'GERAL-WIFI-2P-63A', qtd: 1, preco_iva: 1, grupo: 'quadro' }], melhorias: [QS] };
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify(simQs), id);
    rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    const custoDe = (l) => { const pr = calcularPreco(l, catalogo, {}, { valor_iva: 0 }); return centSim(pr.artigos_iva + pr.mao_obra_iva); };
    const CH = { 'IDR-2P-40A-30MA': 'diferencial', 'GERAL-2P-63A': 'disjuntor_geral', 'RCBO-WIFI-TOSMR1': 'diferencial_wifi', 'GERAL-WIFI-2P-63A': 'geral_wifi' };
    const linhasQs = (f) => QS.quadro_delta.filter(f).map((i) => ({ chave: CH[i.sku], qtd: Math.abs(i.qtd) }));
    const custoQs = centSim(custoDe(linhasQs((i) => i.qtd > 0)) - custoDe(linhasQs((i) => i.qtd < 0)));
    assert.ok(custoQs > 0 && custoQs < custoDe(linhasQs((i) => i.qtd > 0)));
    const margemQs = rel.melhorias.instalacao;
    assert.ok(Math.abs(margemQs - centSim(centSim(custoQs * 1.2) - custoQs)) <= 0.01, `${margemQs} ≈ 20 % de ${custoQs}`);
    assert.deepEqual(rel.melhorias.pacotes[0].material.map((l) => [l.quantidade, l.preco_unitario]), [[2, precoCat('RCBO-WIFI-TOSMR1')], [1, precoCat('GERAL-WIFI-2P-63A')]]);
    assert.deepEqual(rel.geral.material.map((l) => [l.quantidade, l.preco_unitario]), [[3, precoCat('TONGOU-SY2-JWT')], [1, precoCat('RCBO-WIFI-TOSMR1')]], 'o resto do quadro fica; nada contado 2 vezes');
    const todoQs = cent(simQs.itens.reduce((t, i) => t + i.qtd * precoCat(i.sku), 0));
    assert.equal(rel.total, cent(todoQs + rel.mao_obra.valor + rel.deslocacao + margemQs), 'total igual ao de antes');
    p.app.db.prepare('UPDATE orcamentos SET simulacao = ? WHERE id = ?').run(JSON.stringify(SIM), id);
    rel = (await painel('GET', `orcamentos/${id}/relatorio-cliente`)).json.relatorio;
    assert.equal(rel.melhorias, null);
  });

  test('expiração: avaria por pagar há 24 h → expirada (o pedido guardado sai); não se paga', async () => {
    const c = await p.contaConfirmada();
    const pg = await enviarAvaria(c);
    p.relogio.avancar(24 * 3600_000 + 1000);
    try {
      const v = await ver(c, pg.ref);
      assert.equal(v.json.pagamento.estado, 'expirado');
      assert.equal(p.app.db.prepare('SELECT pedido FROM pagamentos_pedido WHERE ref = ?').get(pg.ref).pedido, null);
      assert.equal((await simular(c, pg.ref, 'sucesso')).estado, 409);
      assert.notEqual((await enviarAvaria(c)).ref, pg.ref);
    } finally {
      p.relogio.avancar(-(24 * 3600_000 + 1000));
    }
  });

  test('apagar a conta (RGPD): pedido com pagamentos pagos é ANONIMIZADO (pagamentos ligados, CSV); por pagar saem', async () => {
    const c = await p.contaConfirmada();
    const id = await comRelatorio(c);
    await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000, notas: 'Ligar ao Sr. X', proposta_texto: 'Automatizar a sala.' });
    const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
    await simular(c, ac.json.pagamento.ref, 'sucesso');
    await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {});
    const rs = await comprar(c, id, 'restante');
    await simular(c, rs.json.pagamento.ref, 'sucesso');
    const pend = await enviarAvaria(c);
    // Texto livre sobre a casa, registado no painel (migrações 16–18): também sai na anonimização.
    p.app.db.prepare('UPDATE orcamentos SET ensaios = ?, esquema_quadro = ?, diagnostico = ? WHERE id = ?').run(
      JSON.stringify({ isolamento: 1.5, notas: 'Ensaios na casa do Bruno' }), JSON.stringify({ disjuntor_geral: { amperes: 40 }, notas: 'Casa do Bruno, portão azul', por: 'x@domus.teste' }),
      JSON.stringify({ verificacoes: ['visual'], valores: {}, tipo: 'aberto', conclusao: 'Conclusão com dados do Bruno', por: 'x@domus.teste' }), id);
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    const r = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.pedidos_anonimizados, 1);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE ref = ?').get(pend.ref).n, 0, 'o por pagar sai');
    const o = p.app.db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id);
    assert.ok(o.anonimizado);
    assert.equal(o.nome, 'Anonimizado (RGPD)');
    for (const k of ['telefone', 'email', 'localidade', 'morada', 'mensagem', 'notas', 'simulacao', 'conta_id', 'ensaios', 'esquema_quadro', 'diagnostico']) assert.equal(o[k], null, k);
    assert.doesNotMatch(JSON.stringify(o), /Bruno/);
    assert.equal(o.valor_proposta_cent, 100_000, 'os valores ficam');
    const pagos = p.app.db.prepare('SELECT * FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = \'pago\' ORDER BY id').all(id);
    assert.deepEqual(pagos.map((x) => [x.fase, x.conta_id, x.pedido]), [['relatorio_pormenorizado', null, null], ['sinal', null, null], ['restante', null, null]]);
    assert.ok(!JSON.stringify(p.app.db.prepare('SELECT * FROM auditoria').all()).includes(c.email), 'o email não fica na auditoria');
    const g = await painel('GET', 'pagamentos-pedido?estado=pago');
    const doPedido = g.json.pagamentos.filter((x) => x.orcamento_id === id);
    assert.deepEqual(doPedido.map((x) => [x.fase, x.fase_texto, x.valor, x.base, x.iva]).sort(),
      [['relatorio_pormenorizado', 'Relatório completo', 29, 23.58, 5.42], ['restante', 'Restante', 861, 700, 161], ['sinal', 'Sinal', 340, 276.42, 63.58]]);
    assert.equal((await painel('GET', 'pagamentos-pedido', 'comercial')).estado, 403);
    const csv = await painel('GET', 'pagamentos-pedido?formato=csv');
    const linhas = csv.texto.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(linhas[0], 'data;referencia;descricao;base;iva;total;estado;pedido');
    assert.ok(linhas.some((x) => x.includes(rs.json.pagamento.ref) && x.endsWith(`;700,00;161,00;861,00;pago;${id}`)));
    const fic = (await painel('GET', `orcamentos/${id}`)).json;
    assert.ok(fic.anonimizado);
    assert.equal(fic.conta, null);
    assert.equal(fic.compras, null, 'sem simulação (anonimizado): sem compras');
  });

  test('RGPD: o pedido anonimizado passa a "arquivado": fora do quadro, das listas e dos novos; só o CEO o vê; não muda', async () => {
    const c = await p.contaConfirmada();
    const id = await comRelatorio(c);
    const ref = p.app.db.prepare('SELECT ref FROM pagamentos_pedido WHERE orcamento_id = ? AND estado = \'pago\'').get(id).ref;
    const novosAntes = (await painel('GET', 'resumo')).json.pedidos_novos;
    const contaId = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(c.email).id;
    const r = await painel('POST', `contas/${contaId}/apagar`, 'ceo', { email: c.email });
    assert.equal(r.json.pedidos_anonimizados, 1, r.texto);
    assert.equal(p.app.db.prepare('SELECT estado FROM orcamentos WHERE id = ?').get(id).estado, 'arquivado');
    assert.ok(!(await painel('GET', 'orcamentos')).json.orcamentos.some((o) => o.id === id));
    assert.equal((await painel('GET', 'resumo')).json.pedidos_novos, novosAntes - 1);
    assert.equal((await painel('GET', 'resumo', 'comercial')).json.orcamentos_por_estado.arquivado, undefined);
    const arq = await painel('GET', 'orcamentos?estado=arquivado');
    assert.ok(arq.json.orcamentos.some((o) => o.id === id && o.estado === 'arquivado'));
    assert.equal((await painel('GET', 'orcamentos?estado=arquivado', 'comercial')).estado, 403);
    assert.equal((await painel('GET', `orcamentos/${id}`, 'comercial')).estado, 404);
    for (const corpo of [{ estado: 'novo' }, { notas: 'x' }, { nome: 'Outro' }]) assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', corpo)).estado, 409, JSON.stringify(corpo));
    assert.equal((await painel('POST', `orcamentos/${id}/libertar-relatorio`, 'ceo', {})).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/obra-concluida`, 'ceo', {})).estado, 409);
    assert.equal((await painel('POST', `orcamentos/${id}/marcar-visita`, 'ceo', { data_visita: '2026-10-05T10:00' })).estado, 409);
    const outro = (await enviar(await p.contaConfirmada())).pedido;
    assert.equal((await painel('POST', `orcamentos/${outro}`, 'ceo', { estado: 'arquivado' })).estado, 400);
    assert.ok((await painel('GET', 'pagamentos-pedido')).json.pagamentos.some((x) => x.orcamento_id === id && x.ref === ref));
    assert.ok((await painel('GET', 'pagamentos-pedido?formato=csv')).texto.split('\r\n').some((x) => x.includes(ref) && x.endsWith(`;pago;${id}`)));
  });

  test('retentativas: pagar outra vez a avaria depois de falhar/cancelar não gasta o limite de pedidos por IP', async () => {
    const c = await p.contaConfirmada();
    const ip = '198.51.100.23';
    let pg = null;
    for (let i = 0; i < 8; i++) {
      const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, ip, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'R', localidade: 'Sintra', simulacao: SIM_AVARIA } });
      assert.equal(r.estado, 202, `tentativa ${i + 1}: ${r.texto}`);
      pg = r.json.pagamento;
      assert.equal((await simular(c, pg.ref, i % 2 ? 'cancelar' : 'falha')).estado, 200);
    }
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM pagamentos_pedido WHERE ref = ? AND pedido IS NULL').get(pg.ref).n, 1, 'o pedido guardado sai ao falhar/cancelar');
    const d = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: d.cookie, ip, corpo: { nome: 'Outro', telefone: '912 000 112', servico: 'S', localidade: 'Sintra', simulacao: SIM } });
    assert.equal(r.estado, 201, r.texto);
  });

  test('IVA configurável no painel (iva_pct): 1000 € com 6 % e o relatório pago → sinal 30 % × 1060 − 29 = 289 €; preço do relatório configurável', async () => {
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 6 })).estado, 200);
    try {
      const c = await p.contaConfirmada();
      const id = await comRelatorio(c);
      await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', valor_proposta: 1000 });
      const ac = await p.pedir('POST', `/api/conta/pedidos/${id}/aceitar`, { cookie: c.cookie, corpo: { valor: 1000, plano: 'base' } });
      assert.equal(ac.json.pagamento.valor, 289);
      assert.equal(ac.json.pagamento.iva_pct, 6);
      assert.equal((await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 51 })).estado, 400);
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { iva_pct: 23 });
    }
    assert.equal((await painel('POST', 'config-orcamento', 'ceo', { preco_relatorio_iva: 35 })).estado, 200);
    try {
      const c = await p.contaConfirmada();
      const { pedido } = await enviar(c);
      assert.equal((await comprar(c, pedido, 'relatorio_pormenorizado')).json.pagamento.valor, 35);
      assert.equal((await pedidoConta(c, pedido)).compras.relatorio.valor, 35);
      assert.equal((await p.pedir('GET', '/api/catalogo')).json.config.preco_relatorio_iva, 35, 'o simulador mostra-o');
    } finally {
      await painel('POST', 'config-orcamento', 'ceo', { preco_relatorio_iva: 29 });
    }
  });
});

describe('modo stripe', () => {
  let p;
  const chamadas = [];
  const SEGREDO = 'whsec_teste_123';
  const fetchStripe = async (url, op) => {
    chamadas.push({ url, op });
    const params = new URLSearchParams(op.body ?? '');
    if (/checkout\/sessions$/.test(url)) {
      return new Response(JSON.stringify({ id: `cs_test_${chamadas.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${chamadas.length}`, amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) }), { status: 200 });
    }
    const m = /checkout\/sessions\/(cs_test_\d+)$/.exec(url);
    if (m) return new Response(JSON.stringify({ id: m[1], object: 'checkout.session', status: 'open', payment_status: 'unpaid', amount_total: 2900, currency: 'eur' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  before(async () => {
    p = await painelComEquipa({ fetchStripe, env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PEDIDO_WEBHOOK_SECRET: SEGREDO, SITE_URL: 'https://site.teste' } });
  });
  after(() => p.fechar());

  const assinar = (corpo, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', SEGREDO).update(`${t}.${corpo}`).digest('hex')}`;
  const webhook = (ev, assinatura) => {
    const corpo = JSON.stringify(ev);
    return p.pedir('POST', '/api/conta/pagamentos/stripe-webhook', { corpo, site: false, cabecalhos: { 'Stripe-Signature': assinatura ?? assinar(corpo) } });
  };

  test('Checkout com cartão/MB Way/Multibanco (compra no passo Enviar, volta à conta); a página simulada não existe; webhook assinado confirma (uma vez)', async () => {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', localidade: 'Sintra', simulacao: SIM, compra: 'pormenorizado' } });
    assert.equal(r.estado, 201, r.texto);
    const pg = r.json.pagamento;
    assert.equal(pg.modo, 'stripe');
    assert.match(pg.url, /^https:\/\/checkout\.stripe\.com\//);
    const criar = new URLSearchParams(chamadas.at(-1).op.body);
    assert.equal(criar.get('line_items[0][price_data][unit_amount]'), '2900');
    assert.equal(criar.get('client_reference_id'), pg.ref);
    assert.equal(criar.get('metadata[fase]'), 'relatorio_pormenorizado');
    assert.deepEqual(['0', '1', '2'].map((i) => criar.get(`payment_method_types[${i}]`)), ['card', 'mb_way', 'multibanco']);
    assert.equal(criar.get('success_url'), `https://site.teste/conta.html?pagamento=${pg.ref}`);
    assert.equal(chamadas.at(-1).op.headers['Idempotency-Key'], `domus-${pg.ref}`);
    assert.equal((await p.pedir('POST', `/api/conta/pagamentos/${pg.ref}/simular`, { cookie: c.cookie, corpo: { resultado: 'sucesso' } })).estado, 404);
    const sessao = p.app.db.prepare('SELECT stripe_sessao FROM pagamentos_pedido WHERE ref = ?').get(pg.ref).stripe_sessao;
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: sessao, object: 'checkout.session', client_reference_id: pg.ref, amount_total: 2900, currency: 'eur', payment_status: 'paid' } } };
    assert.equal((await webhook(ev, 't=1,v1=00')).estado, 400, 'assinatura inválida');
    const w = await webhook(ev);
    assert.equal(w.estado, 200, w.texto);
    assert.equal(w.json.resultado, 'pago');
    assert.equal((await webhook(ev)).json.resultado, 'repetido');
    const l = (await p.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos.find((x) => x.id === r.json.pedido);
    assert.equal(l.relatorio, 'em_revisao');
    // Sessão de outro pagamento (não corresponde): ignorada.
    const r2 = await p.pedir('POST', `/api/conta/pedidos/${r.json.pedido}/pagar`, { cookie: c.cookie, corpo: { fase: 'visita' } });
    assert.equal(r2.estado, 200, r2.texto);
    const ev2 = { ...ev, id: 'evt_2', data: { object: { ...ev.data.object, client_reference_id: r2.json.pagamento.ref } } };
    assert.equal((await webhook(ev2)).json.resultado, 'ignorado');
    const v = await p.pedir('GET', `/api/conta/pagamentos/${r2.json.pagamento.ref}`, { cookie: c.cookie });
    assert.equal(v.json.pagamento.estado, 'pendente');
  });

  test('modo: sem PAGAMENTOS_MODO nem chave → pagamentos DESLIGADOS (envia grátis, compras desligadas com aviso; a avaria vai sem pagar); simulado só explícito; só a chave → stripe', async () => {
    const semNada = lerConfig({ PAGAMENTO_PEDIDO: '1' });
    assert.equal(semNada.pagamentoPedido, false);
    assert.equal(semNada.pagamentosDesligadosSemModo, true);
    assert.ok(semNada.avisos.some((a) => /DESLIGADOS/.test(a)));
    assert.equal(lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }).pagamentosModo, 'stripe');
    assert.equal(lerConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }).pagamentoPedido, true);
    assert.equal(lerConfig({ PAGAMENTOS_MODO: 'simulado' }).pagamentoPedido, true);
    assert.equal(lerConfig({ PAGAMENTOS_MODO: 'invalido' }).pagamentoPedido, false);
    assert.equal(lerConfig({}).ivaTaxa, 23);
    assert.equal(lerConfig({ IVA_TAXA: '6' }).ivaTaxa, 6);
    const q = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1' } });
    try {
      const c = await q.contaConfirmada();
      const r = await q.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'S', simulacao: SIM, compra: 'pormenorizado' } });
      assert.equal(r.estado, 201, 'enviado (grátis)');
      assert.equal(r.json.pagamento, undefined);
      assert.match(r.json.pagamento_erro, /pagamentos online estão desligados/);
      const l = (await q.pedir('GET', '/api/conta/pedidos', { cookie: c.cookie })).json.pedidos[0];
      assert.equal(l.compras.ativas, false);
      assert.equal((await q.pedir('POST', `/api/conta/pedidos/${l.id}/pagar`, { cookie: c.cookie, corpo: { fase: 'relatorio_pormenorizado' } })).estado, 404);
      // Sem pagamentos o CEO pode libertar o relatório (não há compra).
      assert.equal((await q.pedir('POST', `/painel/api/orcamentos/${l.id}/libertar-relatorio`, { cookie: q.cookies.ceo, corpo: {} })).estado, 200);
      const av = await q.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Cliente', telefone: '912 000 111', servico: 'R', simulacao: SIM_AVARIA } });
      assert.equal(av.estado, 201, 'a avaria vai sem pagar');
      assert.deepEqual((await q.pedir('GET', '/api/catalogo')).json.pagamentos, { ativo: false, modo: null, demonstracao: false });
      const eu = (await q.pedir('GET', '/painel/api/eu', { cookie: q.cookies.ceo })).json.pagamentos;
      assert.equal(eu.desligados_sem_configuracao, true);
      assert.equal(eu.ativo, false);
    } finally { await q.fechar(); }
    const s = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } });
    try {
      assert.deepEqual((await s.pedir('GET', '/api/catalogo')).json.pagamentos, { ativo: true, modo: 'simulado', demonstracao: true });
      const c = await s.contaConfirmada();
      assert.equal((await s.pedir('GET', '/api/conta/eu', { cookie: c.cookie })).json.pagamentos.demonstracao, true);
    } finally { await s.fechar(); }
  });

  test('sem webhook no modo simulado', async () => {
    const q = await painelComEquipa({ env: { PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado' } });
    try {
      assert.equal((await q.pedir('POST', '/api/conta/pagamentos/stripe-webhook', { corpo: '{}', site: false })).estado, 404);
    } finally { await q.fechar(); }
  });
});
