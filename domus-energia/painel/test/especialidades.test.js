// Três regras decididas pelo dono em 2026-10-13 (docs/ELETRICISTAS.md "Especialidades e prioridade", "Técnico
// responsável" e a candidatura sem n.º da DGEG; migração 52):
// - ESPECIALIDADES: cada pedido tem uma (o programa sugere, o CEO confirma ao validar); os PARCEIROS dessa especialidade
//   no concelho veem o pedido na bolsa 24 horas antes dos outros eletricistas;
// - o N.º DA DGEG é opcional na candidatura;
// - cada OBRA tem um técnico responsável (um eletricista aprovado com n.º da DGEG): sem ele não se dá por concluída.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { painelComEquipa } from './ajuda.js';
import { especialidadeSugerida, ESPECIALIDADES, PRIORIDADE_MS } from '../src/eletricistas.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const NIFS = ['123456789', '245987657', '501964843', '999999990', '211111112', '222222220'];
const CLIENTE = { nome: 'Carla Neves Cliente', telefone: '912 345 678', morada: 'Rua do Exemplo, 12, 2.º Esq.' };
const HORA = 3600_000;
const lisboa = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).slice(0, 16).replace(' ', 'T');
const sim = (extra = {}) => ({
  versao: 1, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Sintra' }, divisoes: [{ nome: 'Sala' }],
  itens: [{ sku: 'TONGOU-SY2-JWT', qtd: 10, preco_iva: 54.9 }], mao_obra: { horas: 5, valor_iva: 190 }, deslocacao: { estado: 'estimada', valor_iva: 0 },
  total: { min: 600, max: 800 }, plano_sugerido: 'conforto', ...extra,
});
/** Nada do cliente (nome, morada, telefone, email) num texto que vai para um eletricista. */
const doCliente = (texto) => /Carla|Neves|912 345 678|Rua do Exemplo|cliente\d*@exemplo\.pt|carla@exemplo\.pt/.test(texto);

/** As ajudas comuns aos painéis destes testes. */
function ajudas(obterP) {
  let seq = 0;
  const painel = async (metodo, caminho, papel = 'ceo', corpo) => {
    const p = obterP();
    let r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    if (r.estado === 401) {   // a sessão do painel acaba ao fim de 12 h paradas: depois de avançar o relógio entra-se de novo
      p.cookies[papel] = await p.entrar(p.u[papel].email);
      r = await p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
    }
    return r;
  };
  const area = (e, metodo, caminho, corpo) => obterP().pedir(metodo, `/api/eletricista/${caminho}`, { cookie: e.cookie, corpo });
  const atribuicao = (id, corpo, papel = 'ceo') => painel(corpo ? 'POST' : 'GET', `orcamentos/${id}/eletricista`, papel, corpo);
  /** Candidatura → (aprovação) → sessão. `especialidades`: as de parceiro, postas pelo CEO. `aprovar: false`: fica pendente. */
  async function eletricista({ especialidades = null, aprovar = true, ...extra } = {}) {
    const p = obterP();
    const n = ++seq;
    const e = { nome: `Eletricista Esp ${n}`, email: `eletricista.esp.${n}.${Math.random().toString(36).slice(2, 8)}@exemplo.pt`, telefone: '910 000 000', nif: NIFS[n % NIFS.length], dgeg: `TR-${6000 + n}`,
      concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true, ...extra };
    const c = await p.pedir('POST', '/api/eletricista/candidatura', { corpo: e });
    assert.equal(c.estado, 201, c.texto);
    e.id = p.app.db.prepare('SELECT id FROM eletricistas WHERE email = ?').get(e.email).id;
    if (!aprovar) return e;
    assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { acao: 'aprovar' })).estado, 200);
    if (especialidades) assert.equal((await painel('POST', `eletricistas/${e.id}`, 'ceo', { especialidades })).estado, 200);
    assert.equal((await p.pedir('POST', '/api/eletricista/codigo', { corpo: { email: e.email } })).estado, 200);
    const r = await p.pedir('POST', '/api/eletricista/entrar', { corpo: { email: e.email, codigo: p.codigo(e.email) } });
    assert.equal(r.estado, 200, r.texto);
    return { ...e, cookie: r.cabecalhos['set-cookie'][0].split(';')[0] };
  }
  const naBolsa = async (e) => (await area(e, 'GET', 'bolsa')).json.trabalhos.map((t) => t.id);
  const emailsPara = (e, desde = 0) => obterP().emails.slice(desde).filter((m) => m.para === e.email);
  return { painel, area, atribuicao, eletricista, naBolsa, emailsPara };
}

describe('especialidadeSugerida: o que o cliente pediu na simulação decide a sugestão', () => {
  const maquina = (modelo, acao) => ({ tipo: 'maquina', props: { modelo }, acao });
  test('as quatro chaves e os nomes', () => {
    assert.deepEqual(ESPECIALIDADES, { geral: 'Instalação geral e quadros', domotica: 'Domótica e automação', solar: 'Solar e carregadores de carro', redes: 'Redes, telecomunicações e segurança' });
    assert.equal(PRIORIDADE_MS, 24 * HORA);
  });
  test('geral: sem simulação, avaria, quadro, obras e tomadas', () => {
    for (const s of [null, undefined, 'texto', [], {}, sim(), sim({ funil: 'avaria', servico: ['reparar'], quer: { objetivos: ['alarme'] } }),
      sim({ funil: 'planta', caminho: 'quadro', servico: ['reparar'] }), sim({ funil: 'planta', caminho: 'obras', servico: ['nova'] }),
      sim({ servico: ['nova'], planta: { elementos: [{ tipo: 'tomada', props: {}, acao: 'novo' }, maquina('forno', 'novo')] } }),
      // Um carregador ou uma câmara que ficam como estão não fazem parte do pedido.
      sim({ planta: { elementos: [maquina('carregador_ve', 'manter'), maquina('camara', 'manter')] } })]) {
      assert.equal(especialidadeSugerida(s), 'geral', JSON.stringify(s)?.slice(0, 120));
    }
  });
  test('solar: carregador de carro (a linha dedicada nos artigos, ou a máquina pedida na planta)', () => {
    assert.equal(especialidadeSugerida(sim({ itens: [{ sku: 'LINHA-DEDICADA-VE', qtd: 1 }] })), 'solar');
    assert.equal(especialidadeSugerida(sim({ planta: { elementos: [maquina('carregador_ve', 'novo')] } })), 'solar');
    assert.equal(especialidadeSugerida(sim({ planta: { elementos: [maquina('carregador_ve_22', 'reparar')] } })), 'solar');
  });
  test('redes: alarme e segurança, câmaras e equipamento de rede', () => {
    assert.equal(especialidadeSugerida(sim({ quer: { objetivos: ['alarme'] } })), 'redes');
    assert.equal(especialidadeSugerida(sim({ melhorias: [{ id: 'seguranca', nome: 'Segurança', itens: [] }] })), 'redes');
    assert.equal(especialidadeSugerida(sim({ planta: { elementos: [maquina('camara', 'novo')] } })), 'redes');
    assert.equal(especialidadeSugerida(sim({ planta: { elementos: [maquina('box_router', 'substituir')] } })), 'redes');
  });
  test('domótica: automatizar, casa inteligente, estores, sensores e objetivos de automação', () => {
    assert.equal(especialidadeSugerida(sim({ funil: 'planta', caminho: 'automatizar', servico: ['automatizar'] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ servico: ['nova', 'automatizar'] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ melhorias: [{ id: 'casa-inteligente' }] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ melhorias: [{ id: 'poupar-energia' }] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ quer: { objetivos: ['estores'] } })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ divisoes: [{ nome: 'Sala', estores: 2 }] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ divisoes: [{ nome: 'Sala', estores: 0 }, { nome: 'Entrada', sensores_movimento: 1 }] })), 'domotica');
    assert.equal(especialidadeSugerida(sim({ melhorias: [{ id: 'quadro-seguro' }] })), 'geral', 'o "Quadro seguro" é do quadro');
  });
  test('pedido misto: ganha a mais específica (solar, redes, domótica, geral)', () => {
    // Automatizar a casa E um carregador novo → solar.
    assert.equal(especialidadeSugerida(sim({ servico: ['automatizar'], quer: { objetivos: ['alarme', 'estores'] }, planta: { elementos: [maquina('carregador_ve', 'novo')] } })), 'solar');
    // Automatizar a casa E alarme → redes.
    assert.equal(especialidadeSugerida(sim({ servico: ['nova', 'automatizar'], quer: { objetivos: ['estores', 'alarme'] }, divisoes: [{ nome: 'Sala', estores: 3 }] })), 'redes');
    // Obras E estores automáticos → domótica.
    assert.equal(especialidadeSugerida(sim({ funil: 'planta', caminho: 'obras', servico: ['nova'], quer: { objetivos: ['estores'] } })), 'domotica');
  });
});

describe('especialidades: o CEO define os parceiros, confirma a especialidade ao validar, e os parceiros veem primeiro durante 24 horas', () => {
  let p;
  let P, F, G, Q;     // P: parceiro de domótica em Sintra; F: de fora, em Sintra; G: parceiro de solar em Sintra; Q: parceiro de redes, só em Cascais
  const a = ajudas(() => p);
  before(async () => {
    // Como em produção: validação do CEO antes da bolsa e propostas na bolsa.
    p = await painelComEquipa({ env: { VALIDACAO_CEO: '1', PROPOSTAS_BOLSA: '1', SITE_URL: 'https://site.teste' } });
    P = await a.eletricista({ especialidades: ['domotica'] });
    F = await a.eletricista();
    G = await a.eletricista({ especialidades: ['solar'] });
    Q = await a.eletricista({ especialidades: ['redes'], concelhos: ['Cascais'] });
  });
  after(() => p.fechar());

  /** Um pedido criado no painel (sem simulação: a lista de verificação tem só a área e o contacto). */
  async function pedido(localidade = 'Sintra') {
    const r = await a.painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Neves Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade, servico: 'Remodelação elétrica' });
    assert.equal(r.estado, 201, r.texto);
    return r.json.id;
  }
  const validar = (id, extra = {}, papel = 'ceo') => a.painel('POST', `orcamentos/${id}/validar`, papel, { pontos: { area: true, contacto: true }, ...extra });
  /** Valida com a especialidade dada e põe logo na bolsa; devolve o id do trabalho. */
  async function paraBolsa(id, especialidade) {
    const v = await validar(id, { bolsa: true, especialidade });
    assert.equal(v.estado, 200, v.texto);
    assert.equal(v.json.aviso, null, v.json.aviso);
    return p.app.db.prepare("SELECT id FROM trabalhos_eletricista WHERE orcamento_id = ? AND estado = 'na_bolsa'").get(id).id;
  }
  const proposta = async () => ({ horas: 6, material: [{ sku: (await a.area(P, 'GET', 'catalogo')).json.artigos[0].sku, qtd: 1 }], notas: null, disponibilidade: 'a partir de segunda-feira' });

  test('parceiros: só o CEO os define (o comercial não: 403), só chaves da lista, e a ficha mostra-os', async () => {
    assert.equal((await a.painel('POST', `eletricistas/${F.id}`, 'comercial', { especialidades: ['geral'] })).estado, 403);
    assert.equal((await a.painel('POST', `eletricistas/${F.id}`, 'tecnico', { especialidades: ['geral'] })).estado, 403);
    for (const mau of [['canalizador'], 'domotica', [1], [null]]) assert.equal((await a.painel('POST', `eletricistas/${F.id}`, 'ceo', { especialidades: mau })).estado, 400, JSON.stringify(mau));
    const lista = (await a.painel('GET', 'eletricistas')).json;
    assert.deepEqual(lista.especialidades, ESPECIALIDADES);
    const de = (e) => lista.eletricistas.find((x) => x.id === e.id);
    assert.deepEqual([de(P).especialidades, de(F).especialidades, de(G).especialidades, de(Q).especialidades], [['domotica'], [], ['solar'], ['redes']]);
    assert.ok([P, F, G, Q].every((e) => de(e).habilitado === true));
    // Duas especialidades (ficam pela ordem da lista, sem repetidos) e tirar todas (volta a ser de fora).
    const r = await a.painel('POST', `eletricistas/${F.id}`, 'ceo', { especialidades: ['redes', 'geral', 'redes'] });
    assert.deepEqual(r.json.eletricista.especialidades, ['geral', 'redes']);
    assert.deepEqual(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'eletricista_atualizado' AND alvo = ? ORDER BY id DESC LIMIT 1").get(`eletricista:${F.id}`).detalhes.includes('"especialidades":["geral","redes"]'), true);
    assert.deepEqual((await a.painel('POST', `eletricistas/${F.id}`, 'ceo', { especialidades: [] })).json.eletricista.especialidades, []);
    assert.equal(p.app.db.prepare('SELECT especialidades FROM eletricistas WHERE id = ?').get(F.id).especialidades, null);
  });

  test('validar guarda a especialidade: a sugerida se o CEO não escolher, ou a que ele mudou', async () => {
    // Sem simulação a sugerida é "geral".
    const id = await pedido();
    let f = (await a.painel('GET', `orcamentos/${id}`)).json;
    assert.deepEqual([f.especialidade, f.especialidade_sugerida, f.pode_mudar_especialidade], [null, 'geral', true]);
    assert.equal((await validar(id, { especialidade: 'canalizacao' })).estado, 400, 'só as quatro da lista');
    assert.equal((await validar(id, { especialidade: 'domotica' }, 'comercial')).estado, 403);
    f = (await validar(id)).json;
    assert.deepEqual([f.validacao.estado, f.especialidade, f.especialidade_sugerida], ['validado', 'geral', 'geral']);
    // O CEO muda-a ao validar.
    const id2 = await pedido();
    f = (await validar(id2, { especialidade: 'redes' })).json;
    assert.deepEqual([f.especialidade, f.especialidade_sugerida], ['redes', 'geral']);
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'pedido_validado' AND alvo = ?").get(`orcamento:${id2}`).detalhes, /"especialidade":"redes"/);
    // Um pedido do simulador para automatizar a casa: a sugerida é "domotica" e é ela que fica se o CEO não mudar.
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Casa inteligente', localidade: 'Sintra', simulacao: sim({ quer: { objetivos: ['estores'] } }) } });
    assert.ok(r.estado === 201 || r.estado === 202, r.texto);
    const id3 = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    p.app.db.prepare("INSERT INTO fotos (id, orcamento_id, chave, tipo_mime, bytes, legenda, criado) VALUES (?, ?, 'quadro', 'image/jpeg', ?, 'Quadro', ?)").run('ab'.repeat(12), id3, JPEG.length, new Date(p.relogio.agora()).toISOString());
    assert.equal((await a.painel('GET', `orcamentos/${id3}`)).json.especialidade_sugerida, 'domotica');
    assert.equal((await a.painel('GET', 'orcamentos')).json.orcamentos.find((x) => x.id === id3).especialidade_sugerida, 'domotica', 'também na lista');
    f = (await a.painel('POST', `orcamentos/${id3}/validar`, 'ceo', { pontos: { planta: true, foto_quadro: true, area: true, contacto: true } })).json;
    assert.deepEqual([f.validacao.estado, f.especialidade], ['validado', 'domotica']);
  });

  test('prioridade: com um parceiro no concelho só ele vê e é avisado; quem é de fora (ou parceiro de outra especialidade) não vê; passadas 24 h todos veem e são avisados', async () => {
    const id = await pedido();
    const n0 = p.emails.length;
    const tid = await paraBolsa(id, 'domotica');
    // Só o parceiro de domótica é avisado, com a linha da especialidade; nada do cliente.
    const avisos = p.emails.slice(n0).filter((m) => /novo trabalho em Sintra/.test(m.assunto));
    assert.deepEqual(avisos.map((m) => m.para), [P.email]);
    assert.match(avisos[0].texto, /É da sua especialidade \(Domótica e automação\): tem 24 horas antes de abrir aos outros eletricistas\./);
    assert.ok(!doCliente(avisos[0].texto) && !doCliente(avisos[0].assunto));
    // Só ele o vê na bolsa, com a especialidade e até quando é só dele.
    const lista = (await a.area(P, 'GET', 'bolsa')).json.trabalhos;
    assert.deepEqual(lista.map((t) => t.id), [tid]);
    assert.deepEqual([lista[0].especialidade, lista[0].especialidade_nome], ['domotica', 'Domótica e automação']);
    const ate = Date.parse(lista[0].prioridade_ate);
    assert.ok(Math.abs(ate - (p.relogio.agora() + 24 * HORA)) < 60_000, 'a prioridade dura 24 horas');
    assert.equal((await a.area(P, 'GET', `bolsa/${tid}`)).json.trabalho.prioridade_ate, lista[0].prioridade_ate);
    for (const fora of [F, G, Q]) {
      assert.ok(!(await a.naBolsa(fora)).includes(tid), `${fora.nome} não vê`);
      assert.equal((await a.area(fora, 'GET', `bolsa/${tid}`)).estado, 404);
      assert.equal((await a.area(fora, 'POST', `bolsa/${tid}/proposta`, await proposta())).estado, 404, 'nem propõe');
    }
    // O painel diz quem vê e até quando.
    let at = (await a.atribuicao(id)).json;
    assert.deepEqual([at.prioridade.especialidade, at.prioridade.especialidade_nome, at.prioridade.parceiros, at.prioridade.ate], ['domotica', 'Domótica e automação', [{ id: P.id, nome: P.nome }], lista[0].prioridade_ate]);
    assert.deepEqual(at.candidatos.map((x) => x.id), [P.id], 'os candidatos são quem vê o pedido agora');
    assert.equal(at.trabalho.especialidade, 'domotica');
    // A prioridade só controla quem vê: o parceiro propõe como sempre.
    const pr = await a.area(P, 'POST', `bolsa/${tid}/proposta`, await proposta());
    assert.equal(pr.estado, 200, pr.texto);

    // 23 horas depois ainda é só dele.
    p.relogio.avancar(23 * HORA);
    assert.ok(!(await a.naBolsa(F)).includes(tid));
    // Passadas as 24 horas (o relógio do servidor, verificado na leitura): abre aos outros, que são avisados; o parceiro não volta a ser.
    p.relogio.avancar(HORA + 60_000);
    const n1 = p.emails.length;
    assert.ok((await a.naBolsa(F)).includes(tid), 'o eletricista de fora já vê');
    assert.ok((await a.naBolsa(G)).includes(tid), 'e o parceiro de outra especialidade também');
    assert.ok(!(await a.naBolsa(Q)).includes(tid), 'quem não trabalha no concelho continua sem ver');
    const depois = p.emails.slice(n1).filter((m) => /novo trabalho em Sintra/.test(m.assunto));
    assert.deepEqual(depois.map((m) => m.para).sort(), [F.email, G.email].sort());
    assert.ok(depois.every((m) => !/É da sua especialidade/.test(m.texto) && !doCliente(m.texto)));
    assert.equal((await a.area(F, 'GET', 'bolsa')).json.trabalhos.find((t) => t.id === tid).prioridade_ate, null);
    assert.equal((await a.area(P, 'GET', 'bolsa')).json.trabalhos.find((t) => t.id === tid).prioridade_ate, null);
    at = (await a.atribuicao(id)).json;
    assert.equal(at.prioridade, null);
    assert.ok(at.propostas.some((x) => x.eletricista.id === P.id), 'a proposta do parceiro continua lá');
    assert.equal(p.emails.slice(n1).filter((m) => /novo trabalho em Sintra/.test(m.assunto)).length, 2, 'ler outra vez não volta a avisar');
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'trabalho_prioridade_terminou' AND alvo = ?").get(`orcamento:${id}`).detalhes, /"como":"24 horas"/);
  });

  test('o temporizador também abre a prioridade passadas as 24 h (sem ninguém ler a bolsa)', async () => {
    const id = await pedido();
    const tid = await paraBolsa(id, 'domotica');
    p.relogio.avancar(PRIORIDADE_MS + 60_000);
    const n = p.emails.length;
    p.app.api.eletricistas.expirar();
    assert.equal(p.app.db.prepare('SELECT prioridade_ate FROM trabalhos_eletricista WHERE id = ?').get(tid).prioridade_ate, null);
    assert.deepEqual(p.emails.slice(n).filter((m) => /novo trabalho em Sintra/.test(m.assunto)).map((m) => m.para).sort(), [F.email, G.email].sort());
  });

  test('sem parceiro dessa especialidade no concelho abre logo a todos (um parceiro de outro concelho não conta)', async () => {
    const id = await pedido();
    const n0 = p.emails.length;
    const tid = await paraBolsa(id, 'redes');   // o único parceiro de redes (Q) só trabalha em Cascais
    assert.equal(p.app.db.prepare('SELECT prioridade_ate FROM trabalhos_eletricista WHERE id = ?').get(tid).prioridade_ate, null);
    assert.deepEqual(p.emails.slice(n0).filter((m) => /novo trabalho em Sintra/.test(m.assunto)).map((m) => m.para).sort(), [P.email, F.email, G.email].sort());
    assert.ok(p.emails.slice(n0).every((m) => !/É da sua especialidade/.test(m.texto)));
    for (const e of [P, F, G]) assert.ok((await a.naBolsa(e)).includes(tid));
    const at = (await a.atribuicao(id)).json;
    assert.deepEqual([at.prioridade, at.trabalho.especialidade, at.trabalho.especialidade_nome], [null, 'redes', 'Redes, telecomunicações e segurança']);
    // Em Cascais o mesmo pedido de redes tem um parceiro: só ele vê.
    const id2 = await pedido('Cascais');
    const tid2 = await paraBolsa(id2, 'redes');
    assert.deepEqual((await a.atribuicao(id2)).json.prioridade.parceiros, [{ id: Q.id, nome: Q.nome }]);
    assert.deepEqual(await a.naBolsa(Q), [tid2]);
  });

  test('"Abrir já a todos": só o CEO; acaba a prioridade, os outros são avisados; a segunda vez dá 409', async () => {
    const id = await pedido();
    const tid = await paraBolsa(id, 'solar');
    assert.ok((await a.naBolsa(G)).includes(tid) && !(await a.naBolsa(F)).includes(tid));
    assert.equal((await a.atribuicao(id, { acao: 'abrir_todos' }, 'comercial')).estado, 403);
    const n = p.emails.length;
    const r = await a.atribuicao(id, { acao: 'abrir_todos' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.prioridade, null);
    assert.ok((await a.naBolsa(F)).includes(tid) && (await a.naBolsa(P)).includes(tid) && (await a.naBolsa(G)).includes(tid));
    assert.deepEqual(p.emails.slice(n).filter((m) => /novo trabalho em Sintra/.test(m.assunto)).map((m) => m.para).sort(), [P.email, F.email].sort());
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'trabalho_prioridade_terminou' AND alvo = ?").get(`orcamento:${id}`).detalhes, /"como":"aberto pelo CEO"/);
    const outra = await a.atribuicao(id, { acao: 'abrir_todos' });
    assert.equal(outra.estado, 409);
    assert.match(outra.json.erro, /não está só para os parceiros/);
  });

  test('pedir proposta só a um eletricista manda por cima: só ele vê, mesmo havendo parceiros da especialidade', async () => {
    const id = await pedido();
    assert.equal((await validar(id, { especialidade: 'domotica' })).estado, 200);
    const n = p.emails.length;
    const r = await a.atribuicao(id, { acao: 'atribuir', eletricista_id: F.id });
    assert.equal(r.estado, 200, r.texto);
    const tid = r.json.trabalho.id;
    assert.deepEqual([r.json.trabalho.estado, r.json.trabalho.so_para?.id, r.json.prioridade], ['na_bolsa', F.id, null]);
    assert.ok((await a.naBolsa(F)).includes(tid), 'o eletricista a quem se pediu vê');
    assert.ok(!(await a.naBolsa(P)).includes(tid), 'o parceiro da especialidade não');
    assert.equal(p.emails.slice(n).filter((m) => m.para === P.email).length, 0);
    p.relogio.avancar(25 * HORA);
    assert.ok(!(await a.naBolsa(P)).includes(tid), 'nem passadas as 24 horas');
  });

  test('mudar a especialidade: só o CEO, até haver proposta aceite; com o pedido na bolsa a prioridade é calculada de novo', async () => {
    const id = await pedido();
    const tid = await paraBolsa(id, 'geral');   // sem parceiros de "geral": aberto a todos
    for (const e of [P, F, G]) assert.ok((await a.naBolsa(e)).includes(tid));
    assert.equal((await a.painel('POST', `orcamentos/${id}/especialidade`, 'comercial', { especialidade: 'solar' })).estado, 403);
    assert.equal((await a.painel('POST', `orcamentos/${id}/especialidade`, 'ceo', { especialidade: 'outra' })).estado, 400);
    assert.equal((await a.painel('POST', `orcamentos/${id}/especialidade`, 'ceo', {})).estado, 400);
    const r = await a.painel('POST', `orcamentos/${id}/especialidade`, 'ceo', { especialidade: 'solar' });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.especialidade, 'solar');
    // Agora só o parceiro de solar o vê, durante 24 horas a contar da mudança.
    const at = (await a.atribuicao(id)).json;
    assert.deepEqual([at.prioridade.especialidade, at.prioridade.parceiros.map((x) => x.id)], ['solar', [G.id]]);
    assert.ok(Math.abs(Date.parse(at.prioridade.ate) - (p.relogio.agora() + 24 * HORA)) < 60_000);
    assert.ok((await a.naBolsa(G)).includes(tid) && !(await a.naBolsa(F)).includes(tid) && !(await a.naBolsa(P)).includes(tid));
    // De volta a uma especialidade sem parceiros: abre outra vez a todos.
    assert.equal((await a.painel('POST', `orcamentos/${id}/especialidade`, 'ceo', { especialidade: 'geral' })).estado, 200);
    assert.equal((await a.atribuicao(id)).json.prioridade, null);
    assert.ok((await a.naBolsa(F)).includes(tid));
    // Com proposta aceite já não se muda.
    p.app.db.prepare("UPDATE orcamentos SET estado = 'proposta_enviada', proposta_aceite = ? WHERE id = ?").run(new Date(p.relogio.agora()).toISOString(), id);
    const tarde = await a.painel('POST', `orcamentos/${id}/especialidade`, 'ceo', { especialidade: 'redes' });
    assert.equal(tarde.estado, 409);
    assert.equal((await a.painel('GET', `orcamentos/${id}`)).json.pode_mudar_especialidade, false);
  });

  test('nenhum email enviado a um eletricista leva o email, o nome, a morada ou o telefone do cliente', () => {
    const deEletricistas = p.emails.filter((m) => [P, F, G, Q].some((e) => e.email === m.para));
    assert.ok(deEletricistas.length > 10);
    for (const m of deEletricistas) assert.ok(!doCliente(`${m.assunto}\n${m.texto}`), m.assunto);
  });
});

describe('sem parceiros registados nada muda (os fluxos de antes): a bolsa abre logo a todos', () => {
  let p;
  const a = ajudas(() => p);
  before(async () => { p = await painelComEquipa(); });   // os interruptores dos testes antigos: sem validação e sem propostas na bolsa
  after(() => p.fechar());

  test('pedido sem especialidade confirmada, eletricistas de fora: todos veem e são avisados, e o primeiro a aceitar fica com ele', async () => {
    const x = await a.eletricista();
    const y = await a.eletricista();
    const r = await a.painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Neves Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade: 'Sintra', servico: 'Reparação' });
    const id = r.json.id;
    const n = p.emails.length;
    const posto = await a.atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    const tid = posto.json.trabalho.id;
    assert.deepEqual([posto.json.prioridade, posto.json.trabalho.especialidade, posto.json.trabalho.precisa_tecnico, posto.json.trabalho.tecnico], [null, 'geral', false, null]);
    assert.equal((await a.painel('GET', `orcamentos/${id}`)).json.especialidade, null, 'por confirmar: para a prioridade vale a sugerida');
    assert.deepEqual(p.emails.slice(n).filter((m) => /novo trabalho em Sintra/.test(m.assunto)).map((m) => m.para).sort(), [x.email, y.email].sort());
    assert.ok((await a.naBolsa(x)).includes(tid) && (await a.naBolsa(y)).includes(tid));
    assert.equal((await a.area(y, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    assert.equal((await a.area(x, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 409);
  });

  test('no fluxo simples o parceiro com prioridade aceita como sempre; se largar, o trabalho volta à bolsa e abre a todos (já não há parceiro que o veja)', async () => {
    const parceiro = await a.eletricista({ especialidades: ['geral'], concelhos: ['Mafra'] });
    const fora = await a.eletricista({ concelhos: ['Mafra'] });
    const id = (await a.painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Neves Cliente', telefone: '912 345 678', localidade: 'Mafra', servico: 'Reparação' })).json.id;
    const tid = (await a.atribuicao(id, { acao: 'bolsa' })).json.trabalho.id;
    assert.ok(!(await a.naBolsa(fora)).includes(tid));
    assert.equal((await a.area(fora, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 404, 'quem não vê não aceita');
    assert.equal((await a.area(parceiro, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    const n = p.emails.length;
    assert.equal((await a.area(parceiro, 'POST', `trabalhos/${tid}/largar`, {})).estado, 200);
    assert.equal(p.app.db.prepare('SELECT prioridade_ate FROM trabalhos_eletricista WHERE id = ?').get(tid).prioridade_ate, null);
    assert.ok((await a.naBolsa(fora)).includes(tid));
    assert.ok(a.emailsPara(fora, n).some((m) => /novo trabalho em Mafra/.test(m.assunto)), 'o de fora é avisado agora');
    assert.equal(a.emailsPara(parceiro, n).filter((m) => /bolsa/.test(m.assunto)).length, 0, 'quem largou nunca mais é avisado');
  });

  test('uma visita técnica não tem técnico responsável (só as obras e as avarias): quem não tem n.º da DGEG não fica bloqueado por isso', async () => {
    const s = await a.eletricista({ dgeg: undefined, concelhos: ['Oeiras'] });
    const id = (await a.painel('POST', 'orcamentos', 'ceo', { nome: 'Carla Neves Cliente', telefone: '912 345 678', localidade: 'Oeiras', servico: 'Reparação' })).json.id;
    const at = await a.atribuicao(id, { acao: 'atribuir', eletricista_id: s.id });
    assert.equal(at.estado, 200, at.texto);
    assert.deepEqual([at.json.trabalho.tipo, at.json.trabalho.precisa_tecnico, at.json.trabalho.tecnico, at.json.pode_tecnico], ['visita', false, null, false]);
    const f = (await a.area(s, 'GET', `trabalhos/${at.json.trabalho.id}`)).json.trabalho;
    assert.equal(f.tecnico, null);
    assert.ok(!f.falta.includes('o técnico responsável'));
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: s.id })).estado, 409, 'só numa obra ou numa avaria');
    assert.deepEqual((await a.painel('GET', 'resumo')).json.tratar.sem_tecnico, 0);
  });

  test('uma avaria tem técnico responsável, como as obras: sem n.º da DGEG fica por indicar; o CEO indica e deixa de faltar', async () => {
    const s = await a.eletricista({ dgeg: undefined, concelhos: ['Cascais'] });
    const hab = await a.eletricista({ concelhos: ['Cascais'] });
    const c = await p.contaConfirmada();   // a simulação só se envia com conta
    const avaria = { versao: 1, funil: 'avaria', avaria: { onde: ['cozinha'], problema: ['sem_corrente'], descricao: 'A tomada não dá nada' }, casa: { tipo: 'apartamento', tipologia: 'T2', localidade: 'Cascais' } };
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Carla Neves Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade: 'Cascais', morada: 'Rua do Exemplo, 1', servico: 'Reparação', simulacao: avaria } });
    assert.equal(r.estado, 201, r.texto);
    const id = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    const at = await a.atribuicao(id, { acao: 'atribuir', eletricista_id: s.id });
    assert.equal(at.estado, 200, at.texto);
    const tid = at.json.trabalho.id;
    assert.deepEqual([at.json.trabalho.tipo, at.json.trabalho.precisa_tecnico, at.json.pode_tecnico], ['avaria', true, true]);
    let f = (await a.area(s, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.tecnico.indicado, f.falta.includes('o técnico responsável')], [false, true]);
    const t = (await a.painel('GET', 'resumo')).json.tratar;
    assert.deepEqual([t.sem_tecnico, t.sem_tecnico_pedido], [1, id]);
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: s.id })).estado, 409, 'quem não tem n.º da DGEG não assina');
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: hab.id })).estado, 200);
    f = (await a.area(s, 'GET', `trabalhos/${tid}`)).json.trabalho;
    assert.deepEqual([f.tecnico.indicado, f.tecnico.nome, f.falta.includes('o técnico responsável')], [true, hab.nome, false]);
    assert.equal((await a.painel('GET', 'resumo')).json.tratar.sem_tecnico, 0);
    // Quem tem n.º da DGEG e fica com uma avaria é o técnico dela, sem ninguém fazer nada.
    const r2 = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { nome: 'Carla Neves Cliente', telefone: '912 345 678', email: 'carla@exemplo.pt', localidade: 'Cascais', morada: 'Rua do Exemplo, 1', servico: 'Reparação', simulacao: avaria } });
    assert.equal(r2.estado, 201, r2.texto);
    const id2 = p.app.db.prepare('SELECT MAX(id) AS id FROM orcamentos').get().id;
    const at2 = await a.atribuicao(id2, { acao: 'atribuir', eletricista_id: hab.id });
    assert.equal(at2.estado, 200, at2.texto);
    assert.deepEqual([at2.json.trabalho.tipo, (await a.area(hab, 'GET', `trabalhos/${at2.json.trabalho.id}`)).json.trabalho.tecnico.proprio], ['avaria', true]);
  });
});

describe('n.º da DGEG opcional e técnico responsável por obra', () => {
  let p;
  let H, S, T, U;     // H: com n.º da DGEG; S: sem; T: com (o técnico que o CEO indica); U: com, mas ainda por aprovar
  const a = ajudas(() => p);
  before(async () => {
    p = await painelComEquipa({ env: { PROPOSTAS_BOLSA: '1', PAGAMENTO_PEDIDO: '1', PAGAMENTOS_MODO: 'simulado', SITE_URL: 'https://site.teste' } });
    H = await a.eletricista();
    S = await a.eletricista({ dgeg: undefined });
    T = await a.eletricista();
    U = await a.eletricista({ aprovar: false });
  });
  after(() => p.fechar());
  const conta = (c, metodo, caminho, corpo) => p.pedir(metodo, `/api/conta/${caminho}`, { cookie: c.cookie, corpo });
  const ficha = async (x, tid) => (await a.area(x, 'GET', `trabalhos/${tid}`)).json.trabalho;
  const semTecnico = async () => { const t = (await a.painel('GET', 'resumo')).json.tratar; return [t.sem_tecnico, t.sem_tecnico_pedido]; };

  /** Um pedido com a proposta aceite e o sinal pago (a obra existe e está por atribuir). Devolve {c, id}. */
  async function obraPorAtribuir() {
    const c = await p.contaConfirmada();
    const r = await p.pedir('POST', '/api/orcamento', { cookie: c.cookie, corpo: { ...CLIENTE, servico: 'Remodelação elétrica', localidade: 'Sintra', simulacao: sim() } });
    assert.equal(r.estado, 201, r.texto);
    const id = r.json.pedido;
    assert.equal((await a.painel('POST', `orcamentos/${id}`, 'ceo', { estado: 'proposta_enviada', proposta_mao_obra: 1000, proposta_material: 500, proposta_deslocacao: 30 })).estado, 200);
    const ac = await conta(c, 'POST', `pedidos/${id}/aceitar`, { valor: 1530, plano: 'base' });
    assert.equal(ac.estado, 200, ac.texto);
    assert.equal((await conta(c, 'POST', `pagamentos/${ac.json.pagamento.ref}/simular`, { resultado: 'sucesso' })).json.pagamento.estado, 'pago');
    return { c, id };
  }
  /** A obra atribuída a `x`, com a visita marcada e já passada, as fotos e os ensaios: só falta (ou não) o técnico. */
  async function obraPronta(x) {
    const { c, id } = await obraPorAtribuir();
    const at = await a.atribuicao(id, { acao: 'atribuir', eletricista_id: x.id });
    assert.equal(at.estado, 200, at.texto);
    const tid = at.json.trabalho.id;
    assert.equal(at.json.trabalho.tipo, 'obra');
    assert.equal((await a.area(x, 'POST', `trabalhos/${tid}/visita`, { data_visita: lisboa(p.relogio.agora() + 30 * HORA) })).estado, 200);
    p.relogio.avancar(31 * HORA);
    for (const g of ['quadro_antes', 'quadro_depois']) {
      const f = await p.pedir('POST', `/api/eletricista/trabalhos/${tid}/fotos/${g}`, { cookie: x.cookie, corpo: JPEG, tipo: 'image/jpeg' });
      assert.equal(f.estado, 201, f.texto);
    }
    assert.equal((await a.area(x, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 200, terra: 40, diferencial: 28 })).estado, 200);
    return { c, id, tid, atribuida: at.json };
  }

  test('candidatura sem n.º da DGEG: é aceite, o email não fala em habilitação e a ficha diz que não pode assinar obras', async () => {
    const linha = p.app.db.prepare('SELECT dgeg, estado FROM eletricistas WHERE id = ?').get(S.id);
    assert.deepEqual([linha.dgeg, linha.estado], ['', 'aprovado']);
    const m = p.emails.find((x) => x.para === S.email && /recebemos a sua candidatura/.test(x.assunto));
    assert.match(m.texto, /Vamos confirmar os seus dados e o seguro de responsabilidade civil/);
    assert.match(m.texto, /cada obra tem de ser assinada por um técnico responsável/);
    assert.ok(!/confirmar a habilitação na DGEG/.test(m.texto));
    // Quem a tem continua a receber o texto de sempre.
    assert.match(p.emails.find((x) => x.para === H.email && /recebemos a sua candidatura/.test(x.assunto)).texto, /Vamos confirmar a habilitação na DGEG e o seguro/);
    const lista = (await a.painel('GET', 'eletricistas')).json.eletricistas;
    assert.deepEqual([lista.find((x) => x.id === S.id).dgeg, lista.find((x) => x.id === S.id).habilitado, lista.find((x) => x.id === H.id).habilitado], ['', false, true]);
    // Vazio, só espaços ou null também contam como "não tem"; preenchido mantém a validação (2 a 40 caracteres).
    for (const [i, dgeg] of ['', '   ', null].entries()) {
      const email = `sem.dgeg.${i}@exemplo.pt`;
      const r = await p.pedir('POST', '/api/eletricista/candidatura', { corpo: { nome: 'Sem Habilitação', email, telefone: '910 000 000', nif: NIFS[0], dgeg, concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true } });
      assert.equal(r.estado, 201, r.texto);
      assert.equal(p.app.db.prepare('SELECT dgeg FROM eletricistas WHERE email = ?').get(email).dgeg, '');
    }
    for (const dgeg of ['X', 'x'.repeat(41)]) {
      const r = await p.pedir('POST', '/api/eletricista/candidatura', { corpo: { nome: 'Habilitação Errada', email: 'dgeg.errada@exemplo.pt', telefone: '910 000 000', nif: NIFS[0], dgeg, concelhos: ['Sintra'], seguro: { tipo: 'application/pdf', dados: PDF.toString('base64') }, consentimento: true } });
      assert.equal(r.estado, 400, dgeg);
    }
  });

  test('técnico automático: quem fica com a obra e tem n.º da DGEG é o técnico responsável, e conclui como sempre', async () => {
    const { id, tid, atribuida } = await obraPronta(H);
    assert.deepEqual([atribuida.trabalho.precisa_tecnico, atribuida.trabalho.tecnico.id, atribuida.trabalho.tecnico.nome, atribuida.trabalho.tecnico.automatico, atribuida.trabalho.tecnico.valido, atribuida.trabalho.tecnico.por],
      [true, H.id, H.nome, true, true, 'sistema']);
    assert.equal(atribuida.pode_tecnico, true);
    const f = await ficha(H, tid);
    assert.deepEqual(f.tecnico, { indicado: true, proprio: true, nome: null });
    assert.deepEqual(f.falta, []);
    assert.deepEqual(await semTecnico(), [0, null]);
    assert.equal((await a.area(H, 'GET', 'obras-assino')).json.obras.length, 0, 'a sua própria obra está em "Trabalhos", não em "Obras que assino"');
    const r = await a.area(H, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
    assert.equal((await a.atribuicao(id)).json.trabalho.estado, 'concluida_eletricista');
  });

  test('sem n.º da DGEG: a obra fica por indicar, "Obra concluída" dá 409 e `falta` di-lo; o CEO indica (só um aprovado com DGEG) e já conclui', async () => {
    const { c, id, tid, atribuida } = await obraPronta(S);
    assert.deepEqual([atribuida.trabalho.precisa_tecnico, atribuida.trabalho.tecnico], [true, null]);
    // Quem pode ser indicado: os aprovados com n.º da DGEG (nem o S, que não o tem, nem o U, que está por aprovar).
    assert.deepEqual(atribuida.tecnicos.map((x) => x.id).sort(), [H.id, T.id].sort());
    let f = await ficha(S, tid);
    assert.deepEqual(f.tecnico, { indicado: false, proprio: false, nome: null });
    assert.deepEqual(f.falta, ['o técnico responsável']);
    assert.deepEqual((await a.atribuicao(id)).json.trabalho.falta, ['o técnico responsável']);
    assert.deepEqual(await semTecnico(), [1, id]);
    assert.equal((await a.painel('GET', 'resumo', 'comercial')).json.tratar, undefined);
    let r = await a.area(S, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 409);
    assert.equal(r.json.erro, 'Esta obra ainda não tem técnico responsável: a Domus Energia tem de o indicar antes de a dar por concluída.');

    // Indicar: só o CEO, e só um eletricista aprovado com n.º da DGEG.
    const indicar = (eid, papel = 'ceo') => a.painel('POST', `orcamentos/${id}/tecnico`, papel, { eletricista_id: eid });
    assert.equal((await indicar(T.id, 'comercial')).estado, 403);
    assert.equal((await indicar(T.id, 'tecnico')).estado, 403);
    assert.equal((await indicar(undefined)).estado, 400);
    assert.equal((await indicar('3')).estado, 400);
    assert.equal((await indicar(999_999)).estado, 404);
    for (const [x, porque] of [[S, 'sem n.º da DGEG'], [U, 'por aprovar']]) {
      r = await indicar(x.id);
      assert.equal(r.estado, 409, porque);
      assert.match(r.json.erro, /aprovado com n\.º de habilitação na DGEG/);
    }
    assert.deepEqual(await semTecnico(), [1, id]);
    const n = p.emails.length;
    r = await indicar(T.id);
    assert.equal(r.estado, 200, r.texto);
    assert.deepEqual([r.json.trabalho.tecnico.id, r.json.trabalho.tecnico.nome, r.json.trabalho.tecnico.automatico, r.json.trabalho.tecnico.valido, r.json.trabalho.tecnico.por], [T.id, T.nome, false, true, p.u.ceo.email]);
    assert.match(p.app.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'tecnico_responsavel_indicado' AND alvo = ?").get(`orcamento:${id}`).detalhes, new RegExp(`"tecnico":${T.id}`));
    // O técnico indicado recebe um email, sem nada do cliente.
    const m = a.emailsPara(T, n);
    assert.equal(m.length, 1);
    assert.match(m[0].assunto, /é o técnico responsável de uma obra em Sintra/);
    assert.match(m[0].texto, /Foi indicado como técnico responsável da obra em Sintra/);
    assert.ok(!doCliente(`${m[0].assunto}\n${m[0].texto}`) && !m[0].texto.includes(c.email));
    assert.equal(a.emailsPara(S, n).length, 0);
    assert.deepEqual(await semTecnico(), [0, null]);

    // O executante vê quem assina, já não lhe falta nada e conclui.
    f = await ficha(S, tid);
    assert.deepEqual([f.tecnico, f.falta], [{ indicado: true, proprio: false, nome: T.nome }, []]);
    r = await a.area(S, 'POST', `trabalhos/${tid}/concluir`, {});
    assert.equal(r.estado, 200, r.texto);
    // Ainda se pode mudar enquanto a obra não está aprovada (indicar o mesmo outra vez não volta a avisar).
    const n2 = p.emails.length;
    assert.equal((await indicar(T.id)).estado, 200);
    assert.equal(a.emailsPara(T, n2).length, 0);
    assert.equal((await indicar(H.id)).json.trabalho.tecnico.id, H.id);
    assert.equal((await indicar(T.id)).json.trabalho.tecnico.id, T.id);
  });

  test('"Obras que assino": o técnico indicado vê a obra só para leitura — sem valores, sem pagamentos e sem o telefone ou o email do cliente; os outros não a veem', async () => {
    const { c, id, tid } = await obraPronta(S);
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: T.id })).estado, 200);
    const lista = await a.area(T, 'GET', 'obras-assino');
    assert.equal(lista.estado, 200, lista.texto);
    const item = lista.json.obras.find((x) => x.id === tid);
    assert.deepEqual(Object.keys(item).sort(), ['aberto', 'concelho', 'concluida', 'especialidade', 'especialidade_nome', 'estado', 'executante', 'id', 'indicado_em', 'tipo', 'titulo', 'visita']);
    assert.deepEqual([item.concelho, item.tipo, item.estado, item.aberto, item.executante], ['Sintra', 'obra', 'visita_marcada', true, { nome: S.nome }]);
    assert.ok(!doCliente(lista.texto), 'a lista não leva nada do cliente');
    const det = await a.area(T, 'GET', `obras-assino/${tid}`);
    assert.equal(det.estado, 200, det.texto);
    const o = det.json.obra;
    assert.deepEqual(Object.keys(o).sort(), ['aberto', 'cliente', 'concelho', 'concluida', 'ensaios', 'especialidade', 'especialidade_nome', 'estado', 'executante', 'fotos', 'id', 'indicado_em', 'material', 'relatorio', 'tipo', 'titulo', 'visita']);
    // O cliente: o nome e a morada, como o executante os vê depois de a proposta ser aceite; nunca o telefone nem o email.
    assert.deepEqual(o.cliente, { nome: CLIENTE.nome, morada: CLIENTE.morada, localidade: 'Sintra' });
    assert.ok(!det.texto.includes('912 345 678') && !det.texto.includes(c.email));
    assert.ok(o.relatorio && Array.isArray(o.relatorio.divisoes), 'leva o relatório técnico');
    assert.deepEqual([o.ensaios.isolamento, o.ensaios.terra, o.ensaios.diferencial], [200, 40, 28]);
    assert.deepEqual(o.fotos.map((x) => x.grupo).sort(), ['quadro_antes', 'quadro_depois']);
    // Sem valores: nada do que o executante recebe, percentagens, preços ou IBAN.
    assert.ok(!/recebe|percentagem|preco|valor_iva|"total"|iban|mao_obra|deslocacao/.test(det.texto), 'sem valores');
    const foto = await a.area(T, 'GET', `obras-assino/${tid}/fotos/${o.fotos[0].id}`);
    assert.equal(foto.estado, 200);
    assert.equal(foto.cabecalhos['content-type'], 'image/jpeg');
    assert.equal(o.fotos[0].url, `/api/eletricista/obras-assino/${tid}/fotos/${o.fotos[0].id}`);
    // Não é um trabalho dele: não está em "Trabalhos", não mexe em nada e não recebe por ele.
    assert.ok(!(await a.area(T, 'GET', 'trabalhos')).json.trabalhos.some((x) => x.id === tid));
    assert.equal((await a.area(T, 'GET', `trabalhos/${tid}`)).estado, 404);
    assert.equal((await a.area(T, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 404);
    assert.equal((await a.area(T, 'POST', `trabalhos/${tid}/ensaios`, { isolamento: 1, terra: 1, diferencial: 1 })).estado, 404);
    assert.equal((await a.area(T, 'GET', `trabalhos/${tid}/fotos/${o.fotos[0].id}`)).estado, 404);
    // Quem não é o técnico desta obra (nem o próprio executante, que a tem em "Trabalhos") não a vê aqui; sem sessão, 401.
    for (const x of [H, S]) {
      assert.equal((await a.area(x, 'GET', `obras-assino/${tid}`)).estado, 404);
      assert.equal((await a.area(x, 'GET', `obras-assino/${tid}/fotos/${o.fotos[0].id}`)).estado, 404);
      assert.ok(!(await a.area(x, 'GET', 'obras-assino')).json.obras.some((y) => y.id === tid));
    }
    assert.equal((await p.pedir('GET', `/api/eletricista/obras-assino/${tid}`)).estado, 401);
    // O executante conclui, o cliente confirma e o CEO aprova: quem recebe é o executante; o técnico não tem nada em "Pagamentos".
    assert.equal((await a.area(S, 'POST', `trabalhos/${tid}/concluir`, {})).estado, 200);
    assert.equal((await conta(c, 'POST', `pedidos/${id}/confirmar-trabalho`, { concluido: true, estrelas: 5 })).estado, 200);
    assert.equal((await a.atribuicao(id, { acao: 'aprovar' })).estado, 200);
    assert.ok((await a.area(S, 'GET', 'pagamentos')).json.trabalhos.some((x) => x.id === tid));
    assert.ok(!(await a.area(T, 'GET', 'pagamentos')).json.trabalhos.some((x) => x.id === tid), 'o técnico não recebe pelo sistema');
    // Aprovada, a obra fecha: o técnico continua a vê-la na lista, mas já sem o cliente, o relatório nem as fotos.
    const fechada = (await a.area(T, 'GET', `obras-assino/${tid}`)).json.obra;
    assert.deepEqual([fechada.aberto, fechada.cliente, fechada.relatorio, fechada.fotos, fechada.ensaios], [false, null, null, [], null]);
    // … e já não se muda o técnico.
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: H.id })).estado, 409);
  });

  test('obra na bolsa: quem a aceita e tem n.º da DGEG fica como técnico; se a largar, deixa de o ser; um técnico indicado pelo CEO fica', async () => {
    const { id } = await obraPorAtribuir();
    const posto = await a.atribuicao(id, { acao: 'bolsa' });
    assert.equal(posto.estado, 200, posto.texto);
    const tid = posto.json.trabalho.id;
    assert.deepEqual([posto.json.trabalho.tipo, posto.json.trabalho.tecnico, posto.json.pode_tecnico], ['obra', null, true]);
    assert.deepEqual(await semTecnico(), [0, null], 'na bolsa ainda não é de ninguém: não conta');
    assert.equal((await a.area(H, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    assert.deepEqual([(await a.atribuicao(id)).json.trabalho.tecnico.id, (await a.atribuicao(id)).json.trabalho.tecnico.automatico], [H.id, true]);
    assert.equal((await a.area(H, 'POST', `trabalhos/${tid}/largar`, {})).estado, 200);
    assert.equal((await a.atribuicao(id)).json.trabalho.tecnico, null);
    // O CEO indica o T com a obra ainda na bolsa; quem a aceitar a seguir (sem DGEG) já tem técnico.
    assert.equal((await a.painel('POST', `orcamentos/${id}/tecnico`, 'ceo', { eletricista_id: T.id })).estado, 200);
    assert.equal((await a.area(S, 'POST', `bolsa/${tid}/aceitar`, {})).estado, 200);
    assert.deepEqual((await ficha(S, tid)).tecnico, { indicado: true, proprio: false, nome: T.nome });
    assert.deepEqual(await semTecnico(), [0, null]);
    // Se o técnico indicado for suspenso, a obra volta a ficar sem técnico que possa assinar.
    assert.equal((await a.painel('POST', `eletricistas/${T.id}`, 'ceo', { acao: 'suspender' })).estado, 200);
    // (Conta esta obra e a do teste de cima que o T também assina e ainda não foi aprovada; a mais antiga vem primeiro.)
    const [quantas] = await semTecnico();
    assert.equal(quantas, 2);
    assert.deepEqual([(await a.atribuicao(id)).json.trabalho.tecnico.valido, (await ficha(S, tid)).tecnico.indicado, (await ficha(S, tid)).falta.includes('o técnico responsável')], [false, false, true]);
    assert.equal((await a.painel('POST', `eletricistas/${T.id}`, 'ceo', { acao: 'reativar' })).estado, 200);
    assert.deepEqual(await semTecnico(), [0, null]);
  });

  test('nenhum email enviado a um eletricista leva o email do cliente', () => {
    const contas = p.app.db.prepare('SELECT email FROM contas').all().map((x) => x.email);
    assert.ok(contas.length >= 4);
    const deEletricistas = p.emails.filter((m) => [H, S, T, U].some((e) => e.email === m.para));
    assert.ok(deEletricistas.length > 8);
    for (const m of deEletricistas) assert.ok(!contas.some((e) => `${m.assunto}\n${m.texto}`.includes(e)), m.assunto);
  });
});
