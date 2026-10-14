// Web push da app do cliente (decisão do dono, 2026-10-14): validação das subscrições (lista de serviços, https,
// limites), registo por MQTT, regra do plano, limpeza das subscrições mortas (404/410) e envio pela `web-push`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { motorComAparelhos, silencioso } from './ajuda.js';
import { MemoriaEstado } from '../src/armazenamento.js';
import { criarNotificador } from '../src/notificacoes.js';
import {
  HOSTS_PUSH, MAX_SUBSCRICOES_WEBPUSH, WebPush, chavesVapid, conteudoPush, hostPermitido, motivoEndpoint, validarSubscricao,
} from '../src/webpush.js';

const P = 'domus/joao';
const CHAVE = 'BPublicaDeTeste_abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
const P256 = `B${'a'.repeat(86)}`; // 87 caracteres, como uma chave P-256 em base64url
const AUTH = 'abcdefghijklmnopqrstuv'; // 22 caracteres (16 bytes)
const sub = (endpoint, keys = { p256dh: P256, auth: AUTH }) => ({ endpoint, keys });
const fcm = (i) => `https://fcm.googleapis.com/fcm/send/telemovel-${i}`;
const plano = (p) => ({ plano: p, estado: 'ativo', gerido: 'stripe' });

// ------------------------------------------------------------------ validação

test('lista de serviços de push: só os conhecidos, numa só constante', () => {
  assert.ok(HOSTS_PUSH.includes('fcm.googleapis.com'));
  for (const h of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'api.push.apple.com', 'wns2-db5p.notify.windows.com', 'FCM.googleapis.com']) {
    assert.equal(hostPermitido(h), true, h);
  }
  for (const h of ['fcm.googleapis.com.mal.pt', 'mal-fcm.googleapis.com', 'push.apple.com', 'notify.windows.com', 'localhost', '127.0.0.1', 'evil.pt', 'xnotify.windows.com']) {
    assert.equal(hostPermitido(h), false, h);
  }
});

test('endpoint: https, sem porta nem utilizador, tamanho limitado (SSRF)', () => {
  assert.equal(motivoEndpoint(fcm(1)), null);
  assert.equal(motivoEndpoint('https://web.push.apple.com/QGuQyavXutnMH'), null);
  assert.match(motivoEndpoint('http://fcm.googleapis.com/fcm/send/x'), /https/);
  assert.match(motivoEndpoint('https://fcm.googleapis.com:8443/fcm/send/x'), /porta/);
  assert.match(motivoEndpoint('https://eu:senha@fcm.googleapis.com/fcm/send/x'), /utilizador/);
  assert.match(motivoEndpoint('https://169.254.169.254/latest/meta-data'), /desconhecido/);
  assert.match(motivoEndpoint('https://painel:8080/painel/api'), /porta|desconhecido/);
  assert.match(motivoEndpoint('https://fcm.googleapis.com.mal.pt/x'), /desconhecido/);
  assert.match(motivoEndpoint(`https://fcm.googleapis.com/${'x'.repeat(1100)}`), /comprido/);
  assert.match(motivoEndpoint('não é um endereço'), /inválido/);
  assert.match(motivoEndpoint(''), /sem endpoint/);
  assert.match(motivoEndpoint(42), /sem endpoint/);
});

test('subscrição: chaves p256dh e auth em base64url com o tamanho certo; campos a mais não passam', () => {
  const ok = validarSubscricao({ ...sub(fcm(1)), expirationTime: null, extra: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.subscricao, sub(fcm(1)));
  assert.equal(validarSubscricao(null).ok, false);
  assert.equal(validarSubscricao({ endpoint: fcm(1) }).ok, false);
  assert.equal(validarSubscricao(sub(fcm(1), { p256dh: 'curta', auth: AUTH })).ok, false);
  assert.equal(validarSubscricao(sub(fcm(1), { p256dh: P256, auth: 'a+b/c=d==efghijklmnopq' })).ok, false);
  assert.equal(validarSubscricao(sub(fcm(1), { p256dh: P256, auth: 'x'.repeat(40) })).ok, false);
  assert.equal(validarSubscricao(sub('http://fcm.googleapis.com/fcm/send/x')).ok, false);
});

// ------------------------------------------------------------------ motor

test('registo por _webpush/registar: dedup por endpoint, máximo 10, remover; _webpush retido sem endpoints', () => {
  const armazenamento = new MemoriaEstado();
  const m = motorComAparelhos({ chaveWebPush: CHAVE, armazenamento });
  for (let i = 0; i < 12; i++) m.msg(`${P}/_webpush/registar`, { subscricao: sub(fcm(i)) });
  const publicacoes = () => m.publicados.filter((p) => p.topico === `${P}/_webpush`).length;
  const antes = publicacoes();
  m.msg(`${P}/_webpush/registar`, { subscricao: sub(fcm(5)) }); // o mesmo telemóvel outra vez: vai para o fim
  assert.equal(publicacoes(), antes, 'repetir o registo não republica (a app regista-se a cada ligação: sem ciclo)');
  let lista = m.motor.clientes.get('joao').subscricoesWebPush;
  assert.equal(lista.length, MAX_SUBSCRICOES_WEBPUSH);
  assert.equal(lista[0].endpoint, fcm(2));
  assert.equal(lista.at(-1).endpoint, fcm(5));
  const pub = m.ultimo(`${P}/_webpush`);
  assert.equal(pub.retain, true);
  assert.deepEqual(JSON.parse(pub.payload), { chave: CHAVE, total: 10 });
  assert.equal(m.publicados.some((p) => p.topico === `${P}/_webpush` && p.payload.includes('fcm.googleapis.com')), false);
  // Inválidas (http, outro serviço, lixo) e mensagens retidas: ignoradas.
  m.msg(`${P}/_webpush/registar`, { subscricao: sub('https://169.254.169.254/x') });
  m.msg(`${P}/_webpush/registar`, { subscricao: sub('http://fcm.googleapis.com/fcm/send/x') });
  m.msg(`${P}/_webpush/registar`, 'lixo');
  m.retida(`${P}/_webpush/registar`, { subscricao: sub(fcm(99)) });
  lista = m.motor.clientes.get('joao').subscricoesWebPush;
  assert.equal(lista.length, 10);
  assert.equal(lista.some((s) => s.endpoint === fcm(99)), false);
  // Desativar neste telemóvel.
  m.msg(`${P}/_webpush/registar`, { endpoint: fcm(5), remover: true });
  lista = m.motor.clientes.get('joao').subscricoesWebPush;
  assert.equal(lista.some((s) => s.endpoint === fcm(5)), false);
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_webpush`).payload), { chave: CHAVE, total: 9 });
  // Persistido (e relido ao arrancar outra vez).
  m.motor.armazenamento.pedirGravacao(() => m.motor.exportar());
  assert.equal(armazenamento.dados.clientes.joao.subscricoesWebPush.length, 9);
  const m2 = motorComAparelhos({ chaveWebPush: CHAVE, armazenamento });
  assert.equal(m2.motor.clientes.get('joao').subscricoesWebPush.length, 9);
});

test('_webpush publicado ao sincronizar (chave null se o web push estiver desligado)', () => {
  const m = motorComAparelhos();
  m.motor.aoLigar();
  m.motor.tick();
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_webpush`).payload), { chave: null, total: 0 });
});

test('o pedido de notificação leva as subscrições; plano sem notificações não envia nada', () => {
  const m = motorComAparelhos({ chaveWebPush: CHAVE });
  m.msg(`${P}/_webpush/registar`, { subscricao: sub(fcm(1)) });
  m.msg(`${P}/_automacoes/set`, [{ id: 'aviso', nome: 'Aviso', quando: { tipo: 'manual' }, entao: [{ acao: 'notificar', mensagem: 'Olá' }] }]);
  m.msg(`${P}/_plano`, plano('base'));
  m.limpar();
  m.msg(`${P}/_automacoes/executar`, { id: 'aviso' });
  assert.equal(m.notificacoes.length, 0);
  m.msg(`${P}/_plano`, plano('conforto'));
  m.msg(`${P}/_automacoes/executar`, { id: 'aviso' });
  assert.equal(m.notificacoes.length, 1);
  assert.deepEqual(m.notificacoes[0].subscricoesWebPush, [sub(fcm(1))]);
  assert.equal(m.notificacoes[0].mensagem, 'Olá');
});

test('subscrições mortas (404/410 do serviço) são apagadas e o total republicado', async () => {
  const m = motorComAparelhos({ chaveWebPush: CHAVE, respostaNotificar: () => ({ subscricoesInvalidas: [fcm(2)] }) });
  m.msg(`${P}/_webpush/registar`, { subscricao: sub(fcm(1)) });
  m.msg(`${P}/_webpush/registar`, { subscricao: sub(fcm(2)) });
  m.msg(`${P}/_alarme/set`, { ativo: true });
  m.avancar(30_000);
  m.msg(`${P}/porta-entrada/1/get`, '1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(m.motor.clientes.get('joao').subscricoesWebPush.map((s) => s.endpoint), [fcm(1)]);
  assert.deepEqual(JSON.parse(m.ultimo(`${P}/_webpush`).payload), { chave: CHAVE, total: 1 });
});

// ------------------------------------------------------------------ envio (web-push simulado)

function bibliotecaFalsa(respostas = {}) {
  const chamadas = [];
  return {
    chamadas,
    generateVAPIDKeys: () => ({ publicKey: CHAVE, privateKey: 'privada_de_teste_abcdefghijklmnopqrstuvwxyz0' }),
    async sendNotification(s, corpo, opcoes) {
      chamadas.push({ s, corpo, opcoes });
      const estado = respostas[s.endpoint];
      if (estado) throw Object.assign(new Error(`Received unexpected response code ${estado}`), { statusCode: estado });
      return { statusCode: 201 };
    },
  };
}

const pedido = (extra = {}) => ({
  cliente: 'joao', topicoNtfy: null, tokensFcm: [], tipo: 'alarme', titulo: 'Alarme disparado', mensagem: 'Porta de entrada',
  prioridade: 'urgent', tags: ['rotating_light'], subscricoesWebPush: [sub(fcm(1))], ...extra,
});

test('envio: web-push chamado com o conteúdo do ntfy, VAPID e urgência; 410/404 devolvidos, outros erros só registados', async () => {
  const lib = bibliotecaFalsa({ [fcm(2)]: 410, [fcm(3)]: 404, [fcm(4)]: 500 });
  const avisos = [];
  const w = new WebPush({ contacto: 'https://exemplo.pt', biblioteca: lib, chaves: { publicKey: CHAVE, privateKey: 'priv' }, log: { ...silencioso, aviso: (t) => avisos.push(t) } });
  assert.equal(w.chavePublica, CHAVE);
  const mortas = await w.enviar(pedido({ subscricoesWebPush: [1, 2, 3, 4].map((i) => sub(fcm(i))).concat(sub('https://evil.pt/x')) }));
  assert.deepEqual(mortas.sort(), [fcm(2), fcm(3)].sort());
  assert.equal(lib.chamadas.length, 4); // o endpoint fora da lista nunca é contactado
  const { s, corpo, opcoes } = lib.chamadas[0];
  assert.deepEqual(s, sub(fcm(1)));
  assert.deepEqual(JSON.parse(corpo), { titulo: 'Alarme disparado', mensagem: 'Porta de entrada', tipo: 'alarme', prioridade: 'urgent' });
  assert.deepEqual(opcoes.vapidDetails, { subject: 'https://exemplo.pt', publicKey: CHAVE, privateKey: 'priv' });
  assert.equal(opcoes.urgency, 'high');
  assert.equal(opcoes.TTL, 3600);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /fcm\.googleapis\.com falhou \(500\)/);
  assert.equal(avisos[0].includes('telemovel-4'), false); // o endpoint não vai para o registo
  // Aviso normal: urgência normal, 1 dia de validade.
  lib.chamadas.length = 0;
  await w.enviar(pedido({ tipo: 'aviso', prioridade: 'high' }));
  assert.equal(lib.chamadas[0].opcoes.urgency, 'normal');
  assert.equal(lib.chamadas[0].opcoes.TTL, 86_400);
  assert.equal(JSON.parse(conteudoPush(pedido())).titulo, 'Alarme disparado');
});

test('envio: sem subscrições ou sem chaves não faz nada', async () => {
  const lib = bibliotecaFalsa();
  const w = new WebPush({ contacto: 'x', biblioteca: lib, chaves: { publicKey: CHAVE, privateKey: 'p' }, log: silencioso });
  assert.deepEqual(await w.enviar(pedido({ subscricoesWebPush: [] })), []);
  const desligado = new WebPush({ ficheiroChaves: path.join(os.tmpdir(), 'nao', 'existe', '\0'), contacto: 'x', biblioteca: { generateVAPIDKeys() { throw new Error('falhou'); } }, log: silencioso });
  assert.equal(desligado.chavePublica, null);
  assert.deepEqual(await desligado.enviar(pedido()), []);
  assert.equal(lib.chamadas.length, 0);
});

test('notificador: uma falha do web push não impede o ntfy nem o FCM', async () => {
  const enviados = [];
  const erros = [];
  const notificar = criarNotificador({
    ntfy: { enviar: async (p) => { enviados.push(p.titulo); } },
    fcm: { enviar: async () => [] },
    webPush: { enviar: async () => { throw new Error('rede em baixo'); } },
    log: { erro: (t) => erros.push(t) },
  });
  const r = await notificar(pedido());
  assert.deepEqual(enviados, ['Alarme disparado']);
  assert.deepEqual(r, { tokensInvalidos: [], subscricoesInvalidas: [] });
  assert.match(erros[0], /\[webpush\] joao: rede em baixo/);
  const r2 = await criarNotificador({
    ntfy: { enviar: async () => { throw new Error('ntfy em baixo'); } },
    fcm: { enviar: async () => [] },
    webPush: { enviar: async () => [fcm(9)] },
    log: { erro() {} },
  })(pedido());
  assert.deepEqual(r2.subscricoesInvalidas, [fcm(9)]);
});

// ------------------------------------------------------------------ chaves VAPID

test('chaves VAPID: criadas uma vez (modo 600), relidas depois, nunca no registo; ficheiro estragado não é trocado', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'domus-vapid-'));
  try {
    const ficheiro = path.join(pasta, 'motor', 'vapid.json');
    const lib = bibliotecaFalsa();
    const registo = [];
    const log = { info: (...a) => registo.push(a.join(' ')), aviso: (...a) => registo.push(a.join(' ')), erro: (...a) => registo.push(a.join(' ')) };
    const c1 = chavesVapid(ficheiro, lib, log);
    assert.equal(c1.publicKey, CHAVE);
    if (process.platform !== 'win32') assert.equal(fs.statSync(ficheiro).mode & 0o777, 0o600);
    const c2 = chavesVapid(ficheiro, { generateVAPIDKeys() { throw new Error('não devia gerar outra vez'); } }, log);
    assert.deepEqual(c2, c1);
    assert.equal(registo.some((t) => t.includes(c1.privateKey) || t.includes(c1.publicKey)), false);
    fs.writeFileSync(ficheiro, '{partido');
    assert.throws(() => chavesVapid(ficheiro, lib, log));
    const w = new WebPush({ ficheiroChaves: ficheiro, contacto: 'x', biblioteca: lib, log });
    assert.equal(w.chavePublica, null); // desligado, sem trocar a chave
    assert.equal(fs.readFileSync(ficheiro, 'utf8'), '{partido');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
