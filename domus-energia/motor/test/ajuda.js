// Utilitários comuns aos testes.
import { Motor } from '../src/motor.js';
import { MemoriaEstado } from '../src/armazenamento.js';

export const APARELHOS = [
  { id: 'quadro', nome: 'Quadro geral', tipo: 'openbeken', medidor: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Geral' }] },
  {
    id: 'sala-4g', nome: 'Interruptor sala', tipo: 'openbeken',
    canais: [
      { n: 1, funcao: 'interruptor', nome: 'Teto' },
      { n: 2, funcao: 'interruptor', nome: 'Candeeiro' },
      { n: 3, funcao: 'interruptor', nome: 'Varanda' },
      { n: 4, funcao: 'interruptor', nome: 'Corredor' },
    ],
  },
  { id: 'porta-entrada', nome: 'Porta de entrada', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'porta' }, { n: 2, funcao: 'bateria' }] },
  { id: 'pir-corredor', nome: 'Movimento corredor', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'movimento' }, { n: 2, funcao: 'bateria' }] },
  { id: 'estore-quarto', nome: 'Estore quarto', tipo: 'shelly', canais: [{ n: 1, funcao: 'estore' }] },
  { id: 'led-cozinha', nome: 'LED cozinha', tipo: 'shelly', canais: [{ n: 1, funcao: 'luz' }] },
  { id: 'ac-sala', nome: 'Ar condicionado', tipo: 'shelly' },
];

export const silencioso = { info() {}, aviso() {}, erro() {} };

/**
 * Cria um motor de teste com relógio falso.
 * @param {{agora?: number|string, armazenamento?: MemoriaEstado, aleatorio?: () => number, respostaNotificar?: Function}} [o]
 */
export function criarMotor(o = {}) {
  const relogio = { t: typeof o.agora === 'string' ? Date.parse(o.agora) : o.agora ?? Date.parse('2026-06-15T10:00:00Z') };
  const publicados = [];
  const notificacoes = [];
  const armazenamento = o.armazenamento ?? new MemoriaEstado();
  const motor = new Motor({
    publicar: (topico, payload, op) => publicados.push({ topico, payload, retain: !!op?.retain }),
    notificar: (p) => {
      notificacoes.push(p);
      return o.respostaNotificar?.(p);
    },
    relogio: { agora: () => relogio.t },
    armazenamento,
    log: silencioso,
    esperaArranqueMs: 0,
    ...(o.aleatorio ? { aleatorio: o.aleatorio } : {}),
  });
  const api = {
    motor,
    relogio,
    publicados,
    notificacoes,
    armazenamento,
    /** Mensagem ao vivo (não retida). */
    msg(topico, payload) {
      motor.aoMensagem(topico, typeof payload === 'string' ? payload : JSON.stringify(payload), false);
    },
    retida(topico, payload) {
      motor.aoMensagem(topico, typeof payload === 'string' ? payload : JSON.stringify(payload), true);
    },
    avancar(ms) {
      relogio.t += ms;
      motor.tick();
    },
    em(iso) {
      relogio.t = Date.parse(iso);
      motor.tick();
    },
    limpar() {
      publicados.length = 0;
      notificacoes.length = 0;
    },
    comandos() {
      return publicados.filter((p) => !p.topico.includes('/_')).map((p) => `${p.topico}=${p.payload}`);
    },
    eventos() {
      return publicados.filter((p) => p.topico.endsWith('/_eventos')).map((p) => JSON.parse(p.payload));
    },
    ultimo(topico) {
      const l = publicados.filter((p) => p.topico === topico);
      return l.length ? l[l.length - 1] : undefined;
    },
  };
  return api;
}

/** Motor com o cliente "joao" e os aparelhos de exemplo já conhecidos. */
export const NTFY = { url: 'https://ntfy.exemplo.pt/domus-joao-abcdefghij0123456789', servidor: 'https://ntfy.exemplo.pt', topico: 'domus-joao-abcdefghij0123456789' };

export function motorComAparelhos(o = {}) {
  const m = criarMotor(o);
  m.retida('domus/joao/_aparelhos', APARELHOS);
  m.retida('domus/joao/_ntfy', NTFY);
  m.motor.aoLigar();
  m.motor.tick();
  m.limpar();
  return m;
}

export const autoLuzCorredor = (extra = {}) => ({
  id: 'luz-corredor',
  nome: 'Luz do corredor com movimento',
  ativa: true,
  bloqueada: false,
  quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 },
  entao: [{ acao: 'ligar', aparelho: 'sala-4g', canal: 4, durante_s: 120 }],
  ...extra,
});

/** Aparelhos com os campos da v3 (entrada, simular, carga, divisao…). */
export const APARELHOS_V3 = [
  { id: 'quadro', nome: 'Quadro geral', tipo: 'openbeken', medidor: true, geral: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Geral' }] },
  {
    id: 'sala-4g', nome: 'Interruptor sala', tipo: 'openbeken', divisao: 'Sala',
    canais: [
      { n: 1, funcao: 'interruptor', nome: 'Teto', arranque: 'ultimo' },
      { n: 2, funcao: 'interruptor', nome: 'Candeeiro', simular: true },
      { n: 3, funcao: 'interruptor', nome: 'Varanda', divisao: 'Exterior' },
      { n: 4, funcao: 'interruptor', nome: 'Corredor' },
    ],
  },
  { id: 'porta-entrada', nome: 'Porta de entrada', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'porta', entrada: true }, { n: 2, funcao: 'bateria' }] },
  { id: 'janela-wc', nome: 'Janela WC', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'porta', nome: 'Janela WC' }, { n: 2, funcao: 'bateria' }] },
  { id: 'pir-corredor', nome: 'Movimento corredor', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'movimento' }, { n: 2, funcao: 'bateria' }] },
  { id: 'estore-quarto', nome: 'Estore quarto', tipo: 'shelly', canais: [{ n: 1, funcao: 'estore' }] },
  { id: 'led-cozinha', nome: 'LED cozinha', tipo: 'shelly', canais: [{ n: 1, funcao: 'luz', simular: true }] },
  { id: 'led-quarto', nome: 'LED quarto', tipo: 'openbeken', canais: [{ n: 1, funcao: 'luz' }] },
  { id: 'termo', nome: 'Termoacumulador', tipo: 'shelly', medidor: true, canais: [{ n: 1, funcao: 'interruptor', carga: 'perigosa', simular: true }] },
  { id: 'ac-sala', nome: 'Ar condicionado', tipo: 'shelly' },
];

/** Motor v3 de teste: aparelhos v3, atrasos do alarme a 30 s, sem silêncio nem relatório (salvo indicação). */
export function motorV3(o = {}) {
  const m = criarMotor(o);
  m.retida('domus/joao/_aparelhos', APARELHOS_V3);
  m.retida('domus/joao/_ntfy', NTFY);
  m.motor.aoLigar();
  m.motor.tick();
  m.msg('domus/joao/_config/set', { silencio: null, relatorio_diario: null, ...(o.config ?? {}) });
  m.limpar();
  return m;
}

/** Gerador pseudo-aleatório reprodutível (mulberry32). */
export function semente(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Último payload JSON publicado num tópico. */
export function ultimoJson(m, topico) {
  const p = m.ultimo(topico);
  return p ? JSON.parse(p.payload) : undefined;
}
