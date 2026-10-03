// Acesso rápido (só para a fase de testes, no computador do dono; docs/SEGURANCA.md "Acesso rápido"): entrar sem
// palavra-passe com utilizadores e contas DE TESTE, pelos botões que o lançador local (local/iniciar.js) junta às páginas.
//   POST /painel/api/dev/entrar {papel}  → sessão normal do painel (cookie domus_painel) como ceo | comercial | tecnico
//   POST /api/conta/dev/entrar {n}       → sessão normal da conta de cliente (cookie domus_conta), conta de teste 1 | 2
//   POST /api/conta/dev/entrar {id}      → o mesmo, para uma conta de cliente que já existe na base local (pelo id)
//   POST /api/conta/dev/contas {}        → as contas de cliente da base local (só id, email, nome, tem_casa), para os
//                                          botões do ecrã de entrada da Área de cliente (local/acesso-rapido.js)
//   POST /api/eletricista/dev/entrar {n} → sessão normal da área do eletricista (cookie domus_eletricista), eletricista de teste 1
// Num servidor a sério é impossível, por camadas:
//   1. só existe com ACESSO_RAPIDO=1, que só o lançador local põe (o servidor/docker-compose.yml nunca);
//   2. mesmo com a variável, o arranque recusa-o (erro no registo, fica DESLIGADO) se houver um sinal de servidor a
//      sério: NODE_ENV=production (painel/Dockerfile), DOMUS_HOST, falta do EMAIL_LOCAL=1, o painel a ouvir fora de
//      127.0.0.1, ou uma origem que não seja http:// de um endereço local (qualquer https:// desliga);
//   3. desligado, as rotas não existem (404, pelo caminho normal das rotas desconhecidas);
//   4. ligado, só funciona NESTE computador: cada pedido tem de chegar ao painel por 127.0.0.1 (o lançador), vir de
//      127.0.0.1/::1 e ter o Host e a Origin de localhost, *.localhost, 127.0.0.1 ou [::1]; pela rede local
//      (http://192.168.x.x:8090) ou de fora dá 404. E, como nos outros POST, a Origin tem de ser do próprio site (CSRF).

import { BlockList, isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { ErroApi, responder, lerJson, verificarOrigem, tipoJson } from './http.js';
import { hashSenha } from './senhas.js';
import { iso } from './util.js';

export const ROTA_EQUIPA = '/painel/api/dev/entrar';
export const ROTA_CLIENTE = '/api/conta/dev/entrar';
/** Lista das contas da base local (botões da Área de cliente). POST, como as outras: passa pela mesma porta (Origin, JSON). */
export const ROTA_CONTAS = '/api/conta/dev/contas';
export const MAX_CONTAS_LISTA = 200;
export const ROTA_ELETRICISTA = '/api/eletricista/dev/entrar';

// Perfis de teste: uma linha por botão. Para juntar outro acrescenta-se aqui e em local/acesso-rapido.js (ATALHOS).
export const EQUIPA_TESTE = {
  ceo: { email: 'ceo.teste@domus.localhost', nome: 'CEO de teste' },
  comercial: { email: 'comercial.teste@domus.localhost', nome: 'Comercial de teste' },
  tecnico: { email: 'tecnico.teste@domus.localhost', nome: 'Técnico de teste' },
};
export const CLIENTES_TESTE = { 1: 'cliente1.teste@exemplo.pt', 2: 'cliente2.teste@exemplo.pt' };
// Eletricista externo de teste (fase 4): já aprovado, com concelhos da Grande Lisboa; dados fictícios (NIF de exemplo).
export const ELETRICISTAS_TESTE = {
  1: { email: 'eletricista1.teste@exemplo.pt', nome: 'Eletricista de teste', telefone: '900 000 001', nif: '999999990', dgeg: 'TESTE-0001',
    concelhos: ['Amadora', 'Cascais', 'Lisboa', 'Oeiras', 'Sintra'] },
};

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
const PRIVADOS = new BlockList();
PRIVADOS.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVADOS.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVADOS.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVADOS.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVADOS.addSubnet('fc00::', 7, 'ipv6');
PRIVADOS.addSubnet('fe80::', 10, 'ipv6');

function naLista(lista, ip) {
  const a = String(ip ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const v = isIP(a);
  return v > 0 && lista.check(a, v === 6 ? 'ipv6' : 'ipv4');
}
/** O endereço é deste computador (127.0.0.0/8, ::1)? */
export const eLoopback = (ip) => naLista(LOOPBACK, ip);
/** O endereço é deste computador ou de uma rede privada (10/8, 172.16/12, 192.168/16, link-local, fc00::/7)? */
export const eLocalOuPrivado = (ip) => eLoopback(ip) || naLista(PRIVADOS, ip);

const nomeLocal = (h) => h === 'localhost' || h.endsWith('.localhost');
/** O anfitrião (sem porta; IPv6 com ou sem parênteses) é este computador: localhost, *.localhost, 127.0.0.0/8 ou ::1? */
const anfitriaoDaqui = (h) => nomeLocal(h) || eLoopback(h.replace(/^\[|\]$/g, ''));
/** O Host e a Origin do pedido são deste computador? (pela rede local o Host é o IP do computador: não) */
function pedidoDaqui(req) {
  try {
    return anfitriaoDaqui(new URL(`http://${req.headers.host}`).hostname) && anfitriaoDaqui(new URL(String(req.headers.origin)).hostname);
  } catch { return false; }
}

/**
 * Porque é que o acesso rápido NÃO pode ligar neste ambiente (texto para o registo), ou null se pode.
 * Só o ambiente do lançador local passa em tudo; qualquer sinal de servidor a sério recusa.
 */
export function recusaAcessoRapido(env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return 'NODE_ENV=production';
  if (env.DOMUS_HOST) return 'DOMUS_HOST definido (servidor a sério)';
  if (env.EMAIL_LOCAL !== '1') return 'falta EMAIL_LOCAL=1 (não é o lançador local)';
  const anfitriao = String(env.ANFITRIAO || '');
  if (!nomeLocal(anfitriao) && !eLoopback(anfitriao)) return 'o painel não está a ouvir só em 127.0.0.1 (ANFITRIAO)';
  const origens = [env.PAINEL_ORIGENS, env.SITE_ORIGENS, env.PUBLIC_URL, env.SITE_URL]
    .flatMap((v) => String(v || '').split(',')).map((o) => o.trim()).filter(Boolean);
  if (!origens.length) return 'sem origens (PAINEL_ORIGENS)';
  for (const o of origens) {
    let u;
    try { u = new URL(o); } catch { return `origem inválida: ${o}`; }
    const h = u.hostname.replace(/^\[|\]$/g, '');
    if (u.protocol !== 'http:' || !(nomeLocal(h) || eLocalOuPrivado(h))) return `origem que não é http:// de um endereço local: ${o}`;
  }
  return null;
}

export function criarAcessoRapido({ db, config, auth, contas, eletricistas, auditar, relogio }) {
  const agoraIso = () => iso(relogio());

  async function entrarEquipa(req, res, ip) {
    const v = await lerJson(req, ['papel']);
    const perfil = typeof v.papel === 'string' && Object.hasOwn(EQUIPA_TESTE, v.papel) ? EQUIPA_TESTE[v.papel] : null;
    if (!perfil) throw new ErroApi(400, 'Papel de teste desconhecido.');
    const ler = () => db.prepare('SELECT * FROM utilizadores WHERE email = ?').get(perfil.email);
    let u = ler();
    if (!u) {
      // Palavra-passe aleatória que não fica em lado nenhum (só o hash): este utilizador só entra por aqui.
      const hash = await hashSenha(randomBytes(24).toString('base64url'));
      const agora = agoraIso();
      const novo = db.prepare('INSERT OR IGNORE INTO utilizadores (nome, email, papel, hash, ativo, criado, atualizado) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(perfil.nome, perfil.email, v.papel, hash, agora, agora).changes;
      u = ler();
      if (novo) auditar(null, 'utilizador_criado', `utilizador:${u.id}`, { email: u.email, papel: u.papel, origem: 'acesso_rapido' }, ip);
    }
    if (!u.ativo || u.papel !== v.papel) throw new ErroApi(409, 'Este utilizador de teste foi desativado ou mudou de papel no painel (Equipa).');
    const token = auth.abrirSessao(u.id);
    auditar(u, 'entrar', `utilizador:${u.id}`, { origem: 'acesso_rapido' }, ip);
    responder(res, 200, { utilizador: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } },
      { 'Set-Cookie': auth.cookie(token, Math.floor(config.sessaoMs / 1000)) });
  }

  /**
   * As contas de cliente que existem na base (decisão do dono, 2026-10-03: um botão por conta no ecrã de entrada da
   * Área de cliente, só no lançador local): ativas e com o email confirmado, as mais recentes primeiro, até
   * MAX_CONTAS_LISTA — só o que o botão precisa (id, email, nome, se tem casa ligada). Nada de telefones, moradas,
   * pedidos nem credenciais.
   */
  async function listarContas(req, res) {
    await lerJson(req, []);
    const contasDaqui = db.prepare('SELECT id, email, nome, casa_codigo FROM contas WHERE ativo = 1 AND confirmado IS NOT NULL ORDER BY id DESC LIMIT ?').all(MAX_CONTAS_LISTA)
      .map((c) => ({ id: c.id, email: c.email, nome: c.nome ?? null, tem_casa: Boolean(c.casa_codigo) }));
    responder(res, 200, { contas: contasDaqui });
  }

  /** Uma conta que já existe (pelo id): a mesma sessão de sempre (contas.abrirSessao), sem lhe mexer; só ativa e confirmada. */
  function entrarContaExistente(req, res, ip, id) {
    const c = Number.isInteger(id) && id > 0 ? db.prepare('SELECT * FROM contas WHERE id = ?').get(id) : null;
    if (!c) throw new ErroApi(400, 'Conta desconhecida.');
    if (!c.ativo) throw new ErroApi(409, 'Esta conta foi desativada no painel (Contas).');
    if (!c.confirmado) throw new ErroApi(409, 'Esta conta ainda não confirmou o email.');
    const cookie = contas.abrirSessao(req, c.id);
    auditar({ id: null, email: `conta:${c.id}` }, 'conta_entrou_teste', `conta:${c.id}`, { origem: 'acesso_rapido' }, ip);
    responder(res, 200, { conta: contas.publico(c) }, { 'Set-Cookie': cookie });
  }

  async function entrarCliente(req, res, ip) {
    const v = await lerJson(req, ['n', 'id']);
    // {id}: uma conta que já existe na base local; {n}: uma das contas de teste (criada na primeira vez). Só um dos dois.
    if (v.id !== undefined && v.n === undefined) return entrarContaExistente(req, res, ip, v.id);
    const email = v.id === undefined && Number.isInteger(v.n) && Object.hasOwn(CLIENTES_TESTE, v.n) ? CLIENTES_TESTE[v.n] : null;
    if (!email) throw new ErroApi(400, 'Cliente de teste desconhecido.');
    const ler = () => db.prepare('SELECT * FROM contas WHERE email = ?').get(email);
    let c = ler();
    const agora = agoraIso();
    if (!c) {
      // Conta já confirmada e sem palavra-passe (não sai nenhum email com código).
      const nova = db.prepare('INSERT OR IGNORE INTO contas (email, hash, confirmado, criado, atualizado) VALUES (?, NULL, ?, ?, ?)').run(email, agora, agora, agora).changes;
      c = ler();
      if (nova) auditar({ id: null, email: `conta:${c.id}` }, 'conta_criada', `conta:${c.id}`, { origem: 'acesso_rapido' }, ip);
    }
    if (!c.ativo) throw new ErroApi(409, 'Esta conta de teste foi desativada no painel (Contas).');
    if (!c.confirmado) {
      db.prepare('UPDATE contas SET confirmado = ?, atualizado = ? WHERE id = ?').run(agora, agora, c.id);
      c = ler();
    }
    const cookie = contas.abrirSessao(req, c.id);
    auditar({ id: null, email: `conta:${c.id}` }, 'conta_entrou_teste', `conta:${c.id}`, { origem: 'acesso_rapido' }, ip);
    responder(res, 200, { conta: contas.publico(c) }, { 'Set-Cookie': cookie });
  }

  async function entrarEletricista(req, res, ip) {
    const v = await lerJson(req, ['n']);
    const perfil = Number.isInteger(v.n) && Object.hasOwn(ELETRICISTAS_TESTE, v.n) ? ELETRICISTAS_TESTE[v.n] : null;
    if (!perfil) throw new ErroApi(400, 'Eletricista de teste desconhecido.');
    const ler = () => db.prepare('SELECT * FROM eletricistas WHERE email = ?').get(perfil.email);
    let e = ler();
    if (!e) {
      // Já aprovado e sem documento (não sai nenhum email): este eletricista só existe no lançador local.
      const agora = agoraIso();
      const novo = db.prepare(`INSERT OR IGNORE INTO eletricistas (email, nome, telefone, nif, dgeg, concelhos, estado, consentimento, criado, atualizado, decidido)
        VALUES (?, ?, ?, ?, ?, ?, 'aprovado', ?, ?, ?, ?)`).run(perfil.email, perfil.nome, perfil.telefone, perfil.nif, perfil.dgeg, JSON.stringify(perfil.concelhos), agora, agora, agora, agora).changes;
      e = ler();
      if (novo) auditar({ id: null, email: `eletricista:${e.id}` }, 'eletricista_aprovado', `eletricista:${e.id}`, { origem: 'acesso_rapido' }, ip);
    }
    if (e.estado !== 'aprovado') throw new ErroApi(409, 'Este eletricista de teste não está aprovado no painel (Eletricistas).');
    const cookie = eletricistas.abrirSessao(req, e.id);
    auditar({ id: null, email: `eletricista:${e.id}` }, 'eletricista_entrou', `eletricista:${e.id}`, { origem: 'acesso_rapido' }, ip);
    responder(res, 200, { eletricista: eletricistas.publico(e) }, { 'Set-Cookie': cookie });
  }

  /** `caminho` é ROTA_EQUIPA, ROTA_CLIENTE, ROTA_CONTAS ou ROTA_ELETRICISTA. Os ErroApi são tratados por quem chama (api.js). */
  async function tratar(req, res, caminho, ip) {
    // Só neste computador: chega pelo lançador (127.0.0.1), vem de 127.0.0.1/::1 e com o Host e a Origin de localhost;
    // pela rede local ou de fora é como se não existisse.
    if (!eLoopback(req.socket.remoteAddress) || !eLoopback(ip) || !pedidoDaqui(req)) return responder(res, 404, { erro: 'Endereço desconhecido.' });
    if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' });
    if (!verificarOrigem(req, config.origens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    if (!tipoJson(req)) throw new ErroApi(415, 'O pedido tem de ser JSON (Content-Type: application/json).');
    if (caminho === ROTA_ELETRICISTA) return entrarEletricista(req, res, ip);
    if (caminho === ROTA_CONTAS) return listarContas(req, res);
    return caminho === ROTA_EQUIPA ? entrarEquipa(req, res, ip) : entrarCliente(req, res, ip);
  }

  return { tratar };
}
