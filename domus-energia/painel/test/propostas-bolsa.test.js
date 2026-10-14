// Propostas na bolsa (decisão do dono, 2026-10-10; docs/ELETRICISTAS.md "Propostas na bolsa"; PROPOSTAS_BOLSA=1): num
// pedido com planta (trabalho 'visita') vários eletricistas do concelho propõem — horas, material do catálogo, notas e
// quando podem ir — sem verem nada do cliente além das fotos; o CEO compara e escolhe; o escolhido só vê o cliente e só
// marca a visita depois de o cliente aceitar a proposta, e aí a obra fica com ele; os outros ficam de reserva (por
// pedido). As avarias continuam a ser "o primeiro a aceitar".

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { painelComEquipa } from './ajuda.js';
import { calcularPreco } from '../../web/simulador/preco.js';
import { estadoNovo, montarSimulacao, PASSO, FOTO_AVARIA } from '../../web/simulador/estado.js';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SEMENTES_ACOES } from '../src/catalogo-sementes.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = () => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto',
});
const SIM_AVARIA = (() => {
  const e = estadoNovo();
  e.funil = 'avaria';
  e.passo = PASSO.avaria;
  e.avaria = { onde: 'cozinha', problema: 'sem_corrente', descricao: 'A tomada não dá nada' };
  e.contacto.localidade = 'Sintra';
  const catalogo = [...SEMENTES_CATALOGO, ...SEMENTES_QUADRO, ...SEMENTES_ACOES].filter((a) => a.ativo !== false);
  return montarSimulacao(e, calcularPreco([{ chave: 'diagnostico', qtd: 1, acao: 'reparar' }], catalogo, null), null, [{ chave: FOTO_AVARIA, legenda: 'Avaria' }]);
})();

describe('propostas na bolsa: vários propõem, o CEO escolhe, a obra fica com o escolhido quando o cliente aceita', () => {
  let p;
  let seq = 0;
  let a, b, c;        // a e b trabalham em Sintra; c só em Cascais
  let artigos;        // dois artigos do catálogo
  let id, tid;        // o pedido e o trabalho do primeiro percurso
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', SITE_URL: 'https://site.teste' } });   // PAGAMENTO_PEDIDO=0: a visita é sem custo
    a = await aprovado();
    b = await aprovado();
    c = await aprovado({ concelhos: ['Cascais'] });
    artigos = (await area(a, 'GET', 'catalogo')).json.artigos.slice(0, 2);
  });
  after(() => p.fechar());

  // A sessão do painel acaba ao fim de 12 h paradas: depois de avançar o relógio entra-se de novo.
  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => p.pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const atribuicao = (pedidoId, corpo, papel = 'ceo') => painel(corpo ? 'POST' : 'GET', `orcamentos/${pedidoId}/eletricista`, papel, corpo);
  async function aprovado(extra = {}) {
    const n = ++seq;
    const e = { nome: `Eletricista Bolsa ${n}`, email: `eletricista.bolsa.${n}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${3000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    e.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  /** Um pedido com planta enviado pelo site (com conta), por visitar; devolve o id. */
  let conta;          // a conta do cliente do último pedido criado
  async function pedido(simulacao = sim()) {
    conta = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: conta.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    return p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
  }
  /** Uma foto do cliente no pedido (a do quadro), como as que o simulador envia. */
  async function fotoDoCliente(pedidoId) {
    const fid = 'ab'.repeat(12);
    await mkdir(join(p.config.fotosDir, String(pedidoId)), { recursive: true });
    await writeFile(join(p.config.fotosDir, String(pedidoId), `${fid}.jpg`), JPEG);
    p.app.db.prepare("INSERT INTO fotos (id, orcamento_id, chave, tipo_mime, bytes, legenda, criado) VALUES (?, ?, 'quadro', 'image/jpeg', ?, 'Quadro da Carla Neves', ?)")
      .run(fid, pedidoId, JPEG.length, new Date(p.relogio.agora()).toISOString());
    return fid;
  }
  const proposta = (horas, extra = {}) => ({ horas, material: [{ sku: artigos[0].sku, qtd: 2 }, { sku: artigos[1].sku, qtd: 1 }], notas: 'Quadro antigo, sem diferencial.', disponibilidade: 'a partir de 20 de outubro, manhãs', ...extra });
  const doCliente = (texto) => /Carla|Neves|912 345 678|Rua do Exemplo|cliente\d*@exemplo\.pt/.test(texto);

  test('na bolsa: dois propõem (e corrigem); quem é de outro concelho não vê (404); "aceitar" dá 409; nada do cliente além das fotos', async () => {
    id = await pedido();
    const fid = await fotoDoCliente(id);
    p.emails.length = 0;
    const posto = await atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    tid = posto.json.trabalho.id;
    assert.deepEqual([posto.json.trabalho.tipo, posto.json.trabalho.estado, posto.json.trabalho.por_proposta, posto.json.propostas_bolsa, posto.json.pode_escolher], ['visita', 'na_bolsa', true, true, true]);
    assert.deepEqual(posto.json.propostas, []);
    // O aviso da bolsa já não diz "o primeiro a aceitar": diz para enviar a proposta. Só a quem trabalha no concelho.
    const avisos = p.emails.filter((m) => /novo trabalho em Sintra/.test(m.assunto));
    assert.deepEqual(avisos.map((m) => m.para).sort(), [a.email, b.email].sort());
    assert.ok(avisos.every((m) => /envie a sua proposta/.test(m.texto) && !/primeiro a aceitar/.test(m.texto)));

    // A lista e o detalhe dizem que é por proposta (a página não adivinha).
    const lista = await area(a, 'GET', 'bolsa');
    assert.equal(lista.json.propostas_bolsa, true);
    assert.deepEqual([lista.json.trabalhos[0].id, lista.json.trabalhos[0].por_proposta, lista.json.trabalhos[0].proposta_enviada], [tid, true, false]);
    assert.ok(!doCliente(lista.texto), 'a lista não leva nada do cliente');
    const det = await area(a, 'GET', `bolsa/${tid}`);
    assert.equal(det.estado, 200, det.texto);
    assert.ok(!doCliente(det.texto), 'o detalhe não leva nome, morada, telefone nem email do cliente');
    const t = det.json.trabalho;
    assert.deepEqual([t.concelho, t.tipo, t.por_proposta, t.minha_proposta], ['Sintra', 'visita', true, null]);
    assert.ok(t.relatorio, 'leva o relatório técnico');
    // Na bolsa o relatório vai completo (é com ele que se faz a proposta): o material da simulação por divisão, o
    // "Quadro elétrico e geral" e as melhorias. Na obra com a proposta aceite já não vão (teste mais abaixo).
    assert.ok(t.relatorio.geral.titulo && Array.isArray(t.relatorio.geral.material) && Array.isArray(t.relatorio.melhorias));
    assert.ok(t.relatorio.divisoes.length > 0 && t.relatorio.divisoes.every((d) => Array.isArray(d.material)));
    assert.ok([...t.relatorio.divisoes.flatMap((d) => d.material), ...t.relatorio.geral.material].length > 0, 'há material da simulação para mostrar');
    assert.ok(!('cliente' in t) && !('orcamento_id' in t) && !/preco|valor_iva|total/.test(JSON.stringify(t.relatorio)), 'sem cliente, n.º do pedido nem preços');
    // As fotos do cliente: só o id, de onde é e o endereço (a legenda, texto livre do cliente, não sai).
    assert.deepEqual(t.fotos, [{ id: fid, nome: 'Quadro elétrico', url: `/api/eletricista/bolsa/${tid}/fotos/${fid}` }]);
    const foto = await area(a, 'GET', `bolsa/${tid}/fotos/${fid}`);
    assert.equal(foto.estado, 200);
    assert.equal(foto.cabecalhos['content-type'], 'image/jpeg');
    assert.equal(foto.cabecalhos['content-disposition'], undefined, 'o nome do ficheiro não leva o n.º do pedido');
    assert.equal(foto.cabecalhos['x-content-type-options'], 'nosniff');
    assert.equal((await area(a, 'GET', `bolsa/${tid}/fotos/${'cd'.repeat(12)}`)).estado, 404);

    // Quem não tem o concelho: o trabalho não existe para ele (nem o detalhe, nem a foto, nem propor).
    assert.equal((await area(c, 'GET', 'bolsa')).json.trabalhos.length, 0);
    assert.equal((await area(c, 'GET', `bolsa/${tid}`)).estado, 404);
    assert.equal((await area(c, 'GET', `bolsa/${tid}/fotos/${fid}`)).estado, 404);
    assert.equal((await area(c, 'POST', `bolsa/${tid}/proposta`, proposta(5))).estado, 404);
    assert.equal((await p.pedir('GET', `/api/eletricista/bolsa/${tid}/fotos/${fid}`)).estado, 401, 'sem sessão');

    // Já não há "aceitar" numa visita: 409 a dizer para fazer a proposta.
    const ac = await area(a, 'POST', `bolsa/${tid}/aceitar`, {});
    assert.equal(ac.estado, 409);
    assert.match(ac.json.erro, /envie a sua proposta/);

    // Propor: horas, material do catálogo e disponibilidade (obrigatória); nunca euros.
    for (const mau of [proposta(6, { disponibilidade: '' }), proposta(6, { disponibilidade: undefined }), proposta(0), proposta(6, { material: [{ sku: 'NAO-EXISTE', qtd: 1 }] }), proposta(6, { valor: 900 })]) {
      assert.equal((await area(a, 'POST', `bolsa/${tid}/proposta`, mau)).estado, 400, JSON.stringify(mau).slice(0, 90));
    }
    p.emails.length = 0;
    const pa = await area(a, 'POST', `bolsa/${tid}/proposta`, proposta(6));
    assert.equal(pa.estado, 200, pa.texto);
    assert.match(pa.json.mensagem, /Proposta enviada\. A Domus Energia escolhe o eletricista e avisa por email\./);
    assert.deepEqual([pa.json.trabalho.proposta_enviada, pa.json.trabalho.minha_proposta.horas, pa.json.trabalho.minha_proposta.disponibilidade], [true, 6, 'a partir de 20 de outubro, manhãs']);
    assert.deepEqual(pa.json.trabalho.minha_proposta.material, [{ sku: artigos[0].sku, nome: artigos[0].nome, qtd: 2 }, { sku: artigos[1].sku, nome: artigos[1].nome, qtd: 1 }]);
    assert.ok(!/valor|preco|sugestao/.test(JSON.stringify(pa.json.trabalho.minha_proposta)), 'o eletricista não recebe valores');
    assert.equal(p.emails.filter((m) => m.para === p.u.ceo.email && /chegou uma proposta/.test(m.assunto)).length, 1, 'o CEO é avisado');
    // Corrigir enquanto está na bolsa: substitui, e não volta a avisar o CEO.
    p.emails.length = 0;
    const corr = await area(a, 'POST', `bolsa/${tid}/proposta`, proposta(7, { disponibilidade: 'a partir de 22 de outubro' }));
    assert.equal(corr.estado, 200, corr.texto);
    assert.deepEqual([corr.json.trabalho.minha_proposta.horas, corr.json.trabalho.minha_proposta.disponibilidade], [7, 'a partir de 22 de outubro']);
    assert.equal(p.emails.length, 0);
    assert.equal((await area(b, 'POST', `bolsa/${tid}/proposta`, proposta(5, { material: [], notas: null, disponibilidade: 'já esta semana' }))).estado, 200);
    assert.equal((await area(b, 'GET', `bolsa/${tid}`)).json.trabalho.minha_proposta.horas, 5, 'cada um só vê a sua');
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM propostas_bolsa WHERE orcamento_id = ?').get(id).n, 2);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE id = ?').get(tid).estado, 'na_bolsa', 'propor não fica com o trabalho');
  });

  test('o CEO vê as duas propostas com os valores; o comercial não escolhe (403); escolher fixa o eletricista, copia a proposta e envia os dois emails', async () => {
    const at = await atribuicao(id);
    assert.equal(at.estado, 200, at.texto);
    assert.equal(at.json.pode_escolher, true);
    assert.deepEqual(at.json.propostas.map((x) => x.eletricista.nome).sort(), [a.nome, b.nome].sort());
    const preco = (sku) => p.app.db.prepare('SELECT preco_venda_iva_cent AS c FROM catalogo WHERE sku = ?').get(sku).c;
    const semIva = (cent) => Math.round(cent / 1.23);
    const de = (e) => at.json.propostas.find((x) => x.eletricista.id === e.id);
    const xa = de(a);
    const mao = semIva(7 * 38 * 100), mat = semIva(preco(artigos[0].sku) * 2) + semIva(preco(artigos[1].sku)), desl = Math.round(xa.deslocacao * 100);
    assert.deepEqual([xa.horas, xa.artigos, xa.disponibilidade, xa.estado, xa.pode_escolher, xa.percentagem], [7, 2, 'a partir de 22 de outubro', 'enviada', true, 70]);
    assert.equal(xa.mao_obra, mao / 100, 'horas × tarifa/hora (38 € com IVA), sem IVA');
    assert.equal(xa.material_valor, mat / 100);
    assert.equal(xa.preco, (mao + mat + desl) / 100, 'preço para o cliente = mão de obra + material + deslocação');
    assert.equal(xa.recebe, (Math.round(mao * 0.7) + desl) / 100, 'o eletricista recebe a percentagem dele × mão de obra + deslocação');
    assert.equal(xa.domus, Math.round(xa.preco * 100 - xa.recebe * 100) / 100, 'fica para a Domus = preço menos o que o eletricista recebe');
    assert.deepEqual([xa.avaliacao, xa.concluidos], [{ n: 0, media: null }, 0]);
    assert.ok(Date.parse(xa.quando) > 0);
    assert.deepEqual(xa.material.map((m) => [m.sku, m.qtd, typeof m.valor]), [[artigos[0].sku, 2, 'number'], [artigos[1].sku, 1, 'number']]);
    assert.deepEqual([de(b).horas, de(b).artigos, de(b).material_valor, de(b).disponibilidade], [5, 0, 0, 'já esta semana']);

    // Só o CEO escolhe; e só quem propôs.
    assert.equal((await atribuicao(id, { acao: 'escolher', eletricista_id: a.id }, 'comercial')).estado, 403);
    assert.equal((await atribuicao(id, { acao: 'escolher', eletricista_id: a.id }, 'tecnico')).estado, 403);
    assert.equal((await atribuicao(id, { acao: 'escolher', eletricista_id: c.id })).estado, 404, 'sem proposta neste pedido');
    assert.equal((await atribuicao(id, { acao: 'escolher' })).estado, 400);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE id = ?').get(tid).estado, 'na_bolsa');

    p.emails.length = 0;
    const esc = await atribuicao(id, { acao: 'escolher', eletricista_id: a.id });
    assert.equal(esc.estado, 200, esc.texto);
    const t = esc.json.trabalho;
    assert.deepEqual([t.id, t.estado, t.eletricista.id, t.percentagem, t.espera_cliente, t.prazo, t.aceite, t.por_proposta], [tid, 'aceite', a.id, 70, true, null, null, true]);
    assert.deepEqual(esc.json.propostas.map((x) => [x.eletricista.id, x.estado, x.pode_escolher]).sort(), [[a.id, 'escolhida', false], [b.id, 'reserva', false]].sort());
    // Os dois emails: ao escolhido e a quem fica de reserva (sem nada do cliente).
    const ma = p.emails.filter((m) => m.para === a.email);
    const mb = p.emails.filter((m) => m.para === b.email);
    assert.equal(ma.length, 1);
    assert.match(ma[0].texto, /Foi escolhido para um trabalho em Sintra\. O cliente ainda vai receber a proposta: avisamos quando aceitar\./);
    assert.equal(mb.length, 1);
    assert.match(mb[0].texto, /Desta vez o trabalho em Sintra foi para outro colega\. A sua proposta fica de reserva\./);
    assert.ok(!p.emails.some((m) => doCliente(m.texto)));
    // A proposta dele ficou no trabalho: "Preencher pela proposta do eletricista" funciona como sempre.
    const guardada = JSON.parse(p.app.db.prepare('SELECT proposta FROM trabalhos_eletricista WHERE id = ?').get(tid).proposta);
    assert.deepEqual([guardada.horas, guardada.material.length, guardada.disponibilidade], [7, 2, 'a partir de 22 de outubro']);
    const pe = (await painel('GET', `orcamentos/${id}`)).json.proposta_eletricista;
    assert.deepEqual([pe.horas, pe.eletricista.id, pe.sugestao.mao_obra, pe.material.length], [7, a.id, mao / 100, 2]);
    // Quem ficou de reserva já não vê o trabalho na bolsa.
    assert.equal((await area(b, 'GET', `bolsa/${tid}`)).estado, 409);
    assert.equal((await area(b, 'POST', `bolsa/${tid}/proposta`, proposta(4))).estado, 409);
    assert.equal((await area(b, 'GET', 'bolsa')).json.trabalhos.length, 0);
  });

  test('antes de o cliente aceitar: o escolhido não vê o cliente, não marca visita e as 48 h não contam — também com a proposta já enviada ao cliente', async () => {
    const ver = async () => {
      const l = await area(a, 'GET', 'trabalhos');
      const meu = l.json.trabalhos.find((x) => x.id === tid);
      assert.deepEqual([meu.estado, meu.aberto, meu.espera_cliente, meu.prazo, meu.aceite], ['aceite', true, true, null, null]);
      const f = await area(a, 'GET', `trabalhos/${tid}`);
      assert.equal(f.estado, 200, f.texto);
      assert.ok(!doCliente(f.texto), 'a ficha não leva nada do cliente');
      assert.deepEqual([f.json.trabalho.cliente, f.json.trabalho.espera_cliente, f.json.trabalho.editavel, f.json.trabalho.pode_proposta], [null, true, false, false]);
      assert.equal(f.json.trabalho.proposta.horas, 7, 'vê a proposta que enviou');
      const v = await area(a, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) });
      assert.equal(v.estado, 409);
      assert.match(v.json.erro, /ainda não aceitou a proposta/);
    };
    await ver();
    // Não há prazo para o cliente: passados 3 dias o trabalho continua a ser dele (não caduca nem volta à bolsa).
    p.relogio.avancar(72 * HORA);
    await ver();
    assert.equal((await atribuicao(id)).json.trabalho.eletricista.id, a.id);
    // O CEO envia a proposta ao cliente: o trabalho continua aberto (antes desta decisão a visita fechava aqui).
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 216.26, proposta_material: 300, proposta_deslocacao: 5.85 })).estado, 200);
    await ver();
    assert.deepEqual([(await atribuicao(id)).json.trabalho.aberto, (await atribuicao(id)).json.trabalho.espera_cliente], [true, true]);
  });

  test('o cliente aceita: nasce a obra para o mesmo eletricista, que passa a ver o cliente e a poder marcar a visita (48 h a contar daqui)', async () => {
    p.emails.length = 0;
    assert.equal((await painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'aceite' })).estado, 200);
    const linhas = p.app.db.prepare('SELECT id, tipo, estado, modo, eletricista_id, percentagem, aceite_em FROM trabalhos_eletricista WHERE orcamento_id = ? ORDER BY id').all(id);
    assert.deepEqual(linhas.map((x) => [x.tipo, x.estado, x.modo, x.eletricista_id, x.percentagem]), [['visita', 'retirado', 'bolsa', a.id, 70], ['obra', 'aceite', 'direto', a.id, 70]]);
    assert.ok(linhas[1].aceite_em > 0);
    const obraId = linhas[1].id;
    const ma = p.emails.filter((m) => m.para === a.email);
    assert.equal(ma.length, 1, 'um email ao escolhido (a visita fecha sem email)');
    assert.match(ma[0].texto, /O cliente aceitou a proposta[^\n]*: tem 48 h para marcar a visita\. Pode fazer a obra nessa visita\./);
    // Nos trabalhos dele fica a obra (a visita fechada já não aparece), com o prazo das 48 h.
    const l = (await area(a, 'GET', 'trabalhos')).json.trabalhos;
    assert.deepEqual(l.map((x) => [x.id, x.tipo, x.estado, x.aberto, x.espera_cliente]), [[obraId, 'obra', 'aceite', true, false]]);
    assert.equal(Date.parse(l[0].prazo), Math.floor((linhas[1].aceite_em + 48 * HORA) / 1000) * 1000);
    const f = (await area(a, 'GET', `trabalhos/${obraId}`)).json.trabalho;
    assert.deepEqual([f.cliente.nome, f.cliente.telefone, f.editavel], [CLIENTE.nome, CLIENTE.telefone, true]);
    assert.equal(f.recebe.percentagem, 70);
    // A obra leva o material e as horas da proposta aceite, e é essa a lista que se marca como recebida (teste no browser, 2026-10-11).
    assert.deepEqual(f.material.map((m) => [m.nome, m.quantidade, m.recebido]), [[artigos[0].nome, 2, false], [artigos[1].nome, 1, false]]);
    assert.equal(f.horas, 7);
    // Na obra o eletricista vê só o que o cliente comprou (decisão do dono, 2026-10-11): o relatório vai sem o material
    // da simulação (o das divisões, o "Quadro elétrico e geral" e as melhorias) e o quadro sem a casa de que se calcula
    // o "quadro ideal". Ficam a lista de trabalho por divisão, a planta e a proposta (horas e material).
    assert.equal(f.de_proposta, true);
    assert.ok(!('geral' in f.relatorio) && !('melhorias' in f.relatorio), 'sem "Quadro elétrico e geral" nem melhorias');
    assert.ok(f.relatorio.divisoes.length > 0 && f.relatorio.divisoes.every((d) => !('material' in d) && Array.isArray(d.trabalho)), 'as divisões levam o trabalho, sem material');
    assert.ok('planta' in f.relatorio && 'esquemas' in f.relatorio && 'acoes' in f.relatorio);
    assert.deepEqual([f.quadro.casa, f.quadro.pode_desenhar], [null, true], 'sem quadro ideal; o quadro existente continua a registar-se');
    assert.deepEqual([f.proposta.horas, f.proposta.material.map((m) => [m.nome, m.qtd])], [7, [[artigos[0].nome, 2], [artigos[1].nome, 1]]]);
    // A obra do painel e o stock também seguem a proposta aceite, não a simulação (teste dos agentes, 2026-10-11).
    const naObra = JSON.parse(p.app.db.prepare('SELECT material FROM obras WHERE orcamento_id = ?').get(id).material);
    assert.deepEqual(naObra.map((m) => [m.sku, m.quantidade, m.feito]), [[artigos[0].sku, 2, false], [artigos[1].sku, 1, false]]);
    const { criarStock } = await import('../src/stock.js');
    const doStock = criarStock({ db: p.app.db, relogio: () => p.relogio.agora() }).materialDoPedido(p.app.db.prepare('SELECT * FROM orcamentos WHERE id = ?').get(id));
    assert.deepEqual(doStock.map((x) => [x.artigo.sku, x.qtd]).sort(), [[artigos[0].sku, 2], [artigos[1].sku, 1]].sort());
    const mr = await area(a, 'POST', `trabalhos/${obraId}/material`, { recebido: [artigos[0].nome] });
    assert.equal(mr.estado, 200, mr.texto);
    assert.deepEqual(mr.json.trabalho.material.map((m) => m.recebido), [true, false]);
    assert.equal(f.recebe.total, Math.round(21626 * 0.7 + 585) / 100, 'recebe pela obra como sempre: percentagem × mão de obra + deslocação');
    assert.equal((await area(a, 'GET', `trabalhos/${tid}`)).estado, 404, 'a visita fechou');
    const v = await area(a, 'POST', `trabalhos/${obraId}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) });
    assert.equal(v.estado, 200, v.texto);
    assert.equal(v.json.trabalho.estado, 'visita_marcada');
    // No painel: a obra é dele, em atribuição direta; aceitar outra vez não cria outro trabalho.
    const at = (await atribuicao(id)).json;
    assert.deepEqual([at.trabalho.id, at.trabalho.tipo, at.trabalho.modo, at.trabalho.eletricista.id, at.trabalho.espera_cliente], [obraId, 'obra', 'direto', a.id, false]);
    assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM trabalhos_eletricista WHERE orcamento_id = ?').get(id).n, 2);
  });

  test('reserva: retirar o escolhido e voltar à bolsa mantém a proposta do outro e o CEO escolhe-a logo; a de quem larga não volta a aparecer', async () => {
    const id2 = await pedido();
    const t1 = (await atribuicao(id2, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await area(a, 'POST', `bolsa/${t1}/proposta`, proposta(6))).estado, 200);
    assert.equal((await area(b, 'POST', `bolsa/${t1}/proposta`, proposta(9, { disponibilidade: 'só em novembro' }))).estado, 200);
    assert.equal((await atribuicao(id2, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
    // O CEO retira o escolhido: as propostas ficam as duas de reserva, mas sem bolsa não se escolhe.
    const ret = await atribuicao(id2, { acao: 'retirar' });
    assert.equal(ret.estado, 200, ret.texto);
    assert.deepEqual(ret.json.propostas.map((x) => [x.eletricista.id, x.estado, x.pode_escolher]).sort(), [[a.id, 'reserva', false], [b.id, 'reserva', false]].sort());
    assert.equal(ret.json.pode_escolher, false);
    assert.equal((await painel('GET', `orcamentos/${id2}`)).json.proposta_eletricista, null, 'retirado: a proposta dele já não se preenche');
    assert.equal((await atribuicao(id2, { acao: 'escolher', eletricista_id: b.id })).estado, 409, 'primeiro volta à bolsa');
    // De volta à bolsa (um trabalho novo): as propostas continuam lá e escolhe-se logo a do outro.
    p.emails.length = 0;
    const posto = await atribuicao(id2, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    const t2 = posto.json.trabalho.id;
    assert.notEqual(t2, t1);
    assert.deepEqual(posto.json.propostas.map((x) => [x.eletricista.id, x.horas, x.pode_escolher]).sort(), [[a.id, 6, true], [b.id, 9, true]].sort());
    assert.equal((await area(b, 'GET', `bolsa/${t2}`)).json.trabalho.minha_proposta.horas, 9, 'o eletricista continua a ver a sua proposta');
    p.emails.length = 0;
    const esc = await atribuicao(id2, { acao: 'escolher', eletricista_id: b.id });
    assert.equal(esc.estado, 200, esc.texto);
    assert.deepEqual([esc.json.trabalho.id, esc.json.trabalho.eletricista.id, esc.json.trabalho.espera_cliente], [t2, b.id, true]);
    assert.equal((await painel('GET', `orcamentos/${id2}`)).json.proposta_eletricista.horas, 9, 'a proposta copiada é a do novo escolhido');
    assert.equal(p.emails.filter((m) => m.para === b.email && /foi escolhido/.test(m.assunto)).length, 1);
    assert.equal(p.emails.filter((m) => m.para === a.email).length, 0, 'quem já era reserva não volta a ser avisado');
    // O escolhido larga: o trabalho volta à bolsa, a proposta dele sai e a de reserva continua a poder ser escolhida.
    assert.equal((await area(b, 'POST', `trabalhos/${t2}/largar`, {})).estado, 200);
    const depois = (await atribuicao(id2)).json;
    assert.equal(depois.trabalho.estado, 'na_bolsa');
    assert.deepEqual(depois.propostas.map((x) => [x.eletricista.id, x.estado, x.pode_escolher]), [[a.id, 'reserva', true]]);
    assert.equal((await painel('GET', `orcamentos/${id2}`)).json.proposta_eletricista, null, 'a proposta de quem largou já não se preenche');
    assert.equal((await area(b, 'GET', `bolsa/${t2}`)).estado, 404, 'quem largou não volta a ver o trabalho');
    assert.equal((await atribuicao(id2, { acao: 'escolher', eletricista_id: b.id })).estado, 404);
    assert.equal((await atribuicao(id2, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
  });

  test('pela conta do cliente: "Não aceito" retira o escolhido (a proposta fica "não aceite pelo cliente") e "Aceito" dá-lhe a obra', async () => {
    const id3 = await pedido();
    const daConta = (caminho, corpo) => p.pedir('POST', `/api/conta/pedidos/${id3}/${caminho}`, { cookie: conta.cookie, corpo });
    const partes = { estado: 'proposta_enviada', proposta_mao_obra: 200, proposta_material: 300, proposta_deslocacao: 5.85 };
    const t1 = (await atribuicao(id3, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await area(a, 'POST', `bolsa/${t1}/proposta`, proposta(6))).estado, 200);
    assert.equal((await atribuicao(id3, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id3}`, 'ceo', partes)).estado, 200);
    // "Não aceito": o pedido volta ao CEO, o trabalho do escolhido é retirado e a proposta dele fica "não aceite pelo
    // cliente" (`recusada`; teste de 2026-10-14) — o CEO ainda a pode escolher outra vez, com o preço retificado.
    const nao = await daConta('recusar', { motivo: 'preco' });
    assert.equal(nao.estado, 200, nao.texto);
    let at = (await atribuicao(id3)).json;
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE id = ?').get(t1).estado, 'retirado');
    assert.deepEqual(at.propostas.map((x) => [x.eletricista.id, x.estado, x.pode_escolher]), [[a.id, 'recusada', false]]);
    assert.equal((await area(a, 'GET', 'trabalhos')).json.trabalhos.some((x) => x.id === t1), false);
    // O CEO volta a pôr na bolsa, escolhe a proposta de reserva e envia a proposta outra vez; agora o cliente aceita.
    const t2 = (await atribuicao(id3, { acao: 'bolsa' })).json.trabalho.id;
    assert.equal((await atribuicao(id3, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id3}`, 'ceo', partes)).estado, 200);
    p.emails.length = 0;
    const sim3 = await daConta('aceitar', {});
    assert.equal(sim3.estado, 200, sim3.texto);
    assert.equal(sim3.json.pedido.estado, 'aceite');
    const linhas = p.app.db.prepare('SELECT id, tipo, estado, modo, eletricista_id FROM trabalhos_eletricista WHERE orcamento_id = ? AND id >= ? ORDER BY id').all(id3, t2);
    assert.deepEqual(linhas.map((x) => [x.tipo, x.estado, x.modo, x.eletricista_id]), [['visita', 'retirado', 'bolsa', a.id], ['obra', 'aceite', 'direto', a.id]]);
    assert.equal(p.emails.filter((m) => m.para === a.email && /o cliente aceitou a proposta/.test(m.assunto)).length, 1);
    assert.equal((await area(a, 'GET', `trabalhos/${linhas[1].id}`)).json.trabalho.cliente.nome, CLIENTE.nome);
    assert.equal((await atribuicao(id3)).json.trabalho.da_bolsa, true, 'a ficha diz "Escolhido na bolsa", não "Atribuição direta"');
    // Regra de sempre dos trabalhos diretos: 48 h sem marcar a visita e a obra volta ao CEO, por atribuir.
    p.relogio.avancar(49 * HORA);
    at = (await atribuicao(id3)).json;
    assert.deepEqual([at.trabalho, at.pode, at.tipo], [null, true, 'obra']);
    assert.equal(p.app.db.prepare('SELECT estado FROM trabalhos_eletricista WHERE id = ?').get(linhas[1].id).estado, 'retirado');
  });

  test('"Não aceito" e o pedido de volta à bolsa (teste de 2026-10-14): o escolhido propõe de novo e as contagens batem certo', async () => {
    const id4 = await pedido();
    const daConta = (caminho, corpo) => p.pedir('POST', `/api/conta/pedidos/${id4}/${caminho}`, { cookie: conta.cookie, corpo });
    const partes = { estado: 'proposta_enviada', proposta_mao_obra: 200, proposta_material: 300, proposta_deslocacao: 5.85 };
    const t1 = (await atribuicao(id4, { acao: 'bolsa' })).json.trabalho.id;
    p.emails.length = 0;
    assert.equal((await area(a, 'POST', `bolsa/${t1}/proposta`, proposta(6))).estado, 200);
    // O aviso aos CEO leva à ficha do pedido (antes ia para Eletricistas).
    const aviso = p.emails.find((m) => /chegou uma proposta/.test(m.assunto));
    assert.match(aviso.texto, new RegExp(`/painel/#/orcamentos/${id4}\n`));
    assert.equal((await area(b, 'POST', `bolsa/${t1}/proposta`, proposta(8))).estado, 200);
    assert.equal((await atribuicao(id4, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
    assert.equal((await painel('POST', `orcamentos/${id4}`, 'ceo', partes)).estado, 200);
    p.emails.length = 0;
    assert.equal((await daConta('recusar', { motivo: 'preco' })).estado, 200);
    // Foi o cliente que não aceitou: o email ao escolhido diz isso (não "retirado pela Domus Energia").
    const retirado = p.emails.filter((m) => m.para === a.email);
    assert.equal(retirado.length, 1);
    assert.match(retirado[0].assunto, /o cliente não aceitou a proposta/);
    assert.match(retirado[0].texto, /O cliente não aceitou a proposta do trabalho em Sintra/);
    assert.doesNotMatch(retirado[0].texto, /retirado pela Domus Energia/);
    // De volta à bolsa: a proposta anterior do escolhido já não conta — o trabalho está aberto a uma proposta nova dele
    // (a anterior vem à parte, "não aceite pelo cliente") — e a de reserva de b volta a estar à espera, nos dois lados.
    const t2 = (await atribuicao(id4, { acao: 'bolsa' })).json.trabalho.id;
    const doA = (await area(a, 'GET', `bolsa/${t2}`)).json.trabalho;
    assert.deepEqual([doA.proposta_enviada, doA.minha_proposta, doA.proposta_anterior?.horas, doA.proposta_anterior?.nao_aceite_cliente], [false, null, 6, true]);
    assert.equal((await area(a, 'GET', 'bolsa')).json.trabalhos.find((x) => x.id === t2).proposta_enviada, false);
    assert.equal((await area(b, 'GET', `bolsa/${t2}`)).json.trabalho.proposta_enviada, true);
    const recebidas = async () => (await painel('GET', `orcamentos/${id4}`)).json.resumo_ficha.n_propostas;
    assert.equal(await recebidas(), 1, 'só a de b conta como recebida');
    assert.deepEqual((await atribuicao(id4)).json.propostas.map((x) => [x.eletricista.id, x.estado, x.pode_escolher]), [[a.id, 'recusada', true], [b.id, 'enviada', true]]);
    // a envia uma proposta nova: passa a contar, e os CEO são avisados outra vez.
    p.emails.length = 0;
    const nova = await area(a, 'POST', `bolsa/${t2}/proposta`, proposta(5));
    assert.equal(nova.estado, 200, nova.texto);
    assert.deepEqual([nova.json.trabalho.proposta_enviada, nova.json.trabalho.minha_proposta.horas, nova.json.trabalho.proposta_anterior], [true, 5, null]);
    assert.equal(await recebidas(), 2);
    assert.ok(p.emails.some((m) => /chegou uma proposta/.test(m.assunto)));
    assert.equal((await atribuicao(id4, { acao: 'escolher', eletricista_id: a.id })).estado, 200);
  });

  test('a avaria continua a ser "o primeiro a aceitar": sem propostas, com as 48 h e os dados do cliente', async () => {
    const idAv = await pedido(SIM_AVARIA);
    const posto = await atribuicao(idAv, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    const tAv = posto.json.trabalho.id;
    assert.deepEqual([posto.json.trabalho.tipo, posto.json.trabalho.por_proposta, posto.json.pode_escolher], ['avaria', false, false]);
    const naBolsa = (await area(a, 'GET', 'bolsa')).json.trabalhos.find((x) => x.id === tAv);
    assert.equal(naBolsa.por_proposta, undefined);
    assert.equal((await area(a, 'GET', `bolsa/${tAv}`)).json.trabalho.fotos, undefined);
    assert.equal((await area(a, 'POST', `bolsa/${tAv}/proposta`, proposta(2))).estado, 409, 'numa avaria não se propõe');
    const ac = await area(a, 'POST', `bolsa/${tAv}/aceitar`, {});
    assert.equal(ac.estado, 200, ac.texto);
    assert.deepEqual([ac.json.trabalho.estado, ac.json.trabalho.espera_cliente, ac.json.trabalho.cliente.nome], ['aceite', false, CLIENTE.nome]);
    assert.ok(ac.json.trabalho.prazo, 'as 48 h contam logo');
    assert.equal((await area(b, 'POST', `bolsa/${tAv}/aceitar`, {})).estado, 409, 'o segundo chega tarde');
    assert.equal((await atribuicao(idAv, { acao: 'escolher', eletricista_id: b.id })).estado, 409);
  });
});

test('PROPOSTAS_BOLSA=0: a visita volta a ser "o primeiro a aceitar" e as rotas das propostas não existem', async () => {
  const p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '0' } });
  try {
    const e = { nome: 'Eletricista Antigo', email: 'eletricista.antigo@exemplo.pt', telefone: '910 000 000', nif: NIFS[0], dgeg: 'TR-4001', concelhos: ['Sintra'],
      seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true };
    assert.equal((await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e })).estado, 201);
    const eid = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    const painel = (metodo, caminho, corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies.ceo, corpo });
    assert.equal((await painel('POST', `eletricistas/${eid}`, { acao: 'aprovar' })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const cookie = (await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } })).cabecalhos['set-cookie'][0].split(';')[0];
    const id = (await painel('POST', 'orcamentos', { nome: 'Carla Cliente', telefone: '912 345 678', localidade: 'Sintra', servico: 'Remodelação elétrica' })).json.id;
    const posto = await painel('POST', `orcamentos/${id}/eletricista`, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    assert.ok(!('propostas' in posto.json) && !('propostas_bolsa' in posto.json) && !('espera_cliente' in posto.json.trabalho));
    const tid = posto.json.trabalho.id;
    assert.equal((await painel('POST', `orcamentos/${id}/eletricista`, { acao: 'escolher', eletricista_id: eid })).estado, 400, 'a ação não existe');
    assert.equal((await p.pedir('GET', '/api/eletricista/bolsa', { cookie })).json.propostas_bolsa, false);
    assert.equal((await p.pedir('POST', `/api/eletricista/bolsa/${tid}/proposta`, { cookie, corpo: { horas: 5, material: [], notas: null, disponibilidade: 'amanhã' } })).estado, 404);
    const ac = await p.pedir('POST', `/api/eletricista/bolsa/${tid}/aceitar`, { cookie, corpo: {} });
    assert.equal(ac.estado, 200, ac.texto);
    assert.ok(ac.json.trabalho.prazo && ac.json.trabalho.cliente.nome === 'Carla Cliente' && ac.json.trabalho.espera_cliente === false);
  } finally {
    await p.fechar();
  }
});
