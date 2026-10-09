// Núcleo do motor de regras da Domus Energia.
//
// Não sabe nada de rede nem de disco: recebe tudo por injeção (publicar,
// notificar, relógio, armazenamento, gerador aleatório), o que permite
// testá-lo com um relógio falso. O `index.js` liga-o ao MQTT, ao ntfy/FCM e
// ao ficheiro de estado.
//
// Contrato: docs/PROTOCOLO-MQTT.md (v1), docs/PROTOCOLO-MQTT-v2.md (v2) e
// docs/PROTOCOLO-MQTT-v3.md (v3). A lógica da v3 está repartida por:
//   motor-casa.js        — _config, modos, alarme, presença, simulação de férias
//   motor-automacoes.js  — automações v3, cenas, registo, pausa manual, sequências
//   motor-saude.js       — _saude, _energia, energia reposta, relatório diário
//   motor-planos.js      — _plano (docs/PROTOCOLO-PLANOS.md): funcionalidades por plano

import { CLIENTE_RE, normalizarAparelhos } from './aparelhos.js';
import { texto, lerJson, numero } from './util.js';
import { partesLocais, dentroDoIntervalo, FUSO } from './tempo.js';
import { normalizarConfig } from './casa.js';
import { metodosCasa } from './motor-casa.js';
import { metodosAutomacoes, MAX_EXECUCOES_MINUTO } from './motor-automacoes.js';
import { metodosSaude } from './motor-saude.js';
import { metodosPlanos } from './motor-planos.js';
import { validarPlano } from './planos.js';

/** @typedef {import('./aparelhos.js').Aparelho} Aparelho */
/** @typedef {import('./validacao.js').Automacao} Automacao */
/** @typedef {import('./validacao.js').Cena} Cena */
/** @typedef {import('./casa.js').ConfigCasa} ConfigCasa */

export const MAX_HISTORICO = 100;
export const MAX_TOKENS_FCM = 10;
export const BATERIA_FRACA = 15;
export const SILENCIO_MS = 24 * 3600 * 1000;
/** Tamanho máximo por omissão de uma mensagem publicada pelo motor (o broker aceita 1 MB). */
export const MAX_PAYLOAD_PADRAO = 900 * 1024;
/** Máximo de notificações (não de alarme) por cliente por minuto. */
export const MAX_NOTIFICACOES_MINUTO = 10;
export { MAX_EXECUCOES_MINUTO };

/**
 * @typedef {object} Evento
 * @property {string} ts
 * @property {'alarme'|'sensor'|'automacao'|'aviso'|'erro'|'modo'} tipo
 * @property {string} titulo
 * @property {string} mensagem
 * @property {string} [aparelho]
 * @property {string} [por]
 */

/**
 * @typedef {object} PedidoNotificacao
 * @property {string} cliente
 * @property {string|null} topicoNtfy  null = cliente sem tópico ntfy (só FCM)
 * @property {string[]} tokensFcm
 * @property {Evento['tipo']} tipo
 * @property {string} titulo
 * @property {string} mensagem
 * @property {'urgent'|'high'|'default'} prioridade
 * @property {string[]} tags
 */

/**
 * @typedef {object} Armazenamento
 * @property {() => any} carregar                    devolve o estado guardado (ou null)
 * @property {(obter: () => any) => void} pedirGravacao  pede uma gravação (pode ser adiada)
 */

/**
 * @typedef {object} OpcoesMotor
 * @property {(topico: string, payload: string, opcoes?: {retain?: boolean}) => void} publicar
 * @property {(pedido: PedidoNotificacao) => (Promise<{tokensInvalidos?: string[]}|void>|void)} [notificar]
 * @property {{agora: () => number}} [relogio]
 * @property {Armazenamento} [armazenamento]
 * @property {{info: Function, aviso: Function, erro: Function}} [log]
 * @property {number} [esperaArranqueMs] tempo a aguardar pelas mensagens retidas antes de publicar o estado
 * @property {number} [maxPayload] tamanho máximo (bytes) de uma mensagem publicada; maiores são registadas e descartadas
 * @property {() => number} [aleatorio]  gerador [0, 1) da simulação de presença (injetável nos testes)
 */

/**
 * @typedef {object} EstadoCanal
 * @property {number} [valor]
 * @property {number} [brilho]
 * @property {number} [ultimaMudanca]
 */

/**
 * @typedef {object} EstadoAparelho
 * @property {boolean} [online]
 * @property {number} [ultimaNoticia]
 * @property {boolean} [avisoSilencio]
 * @property {string} [avisoBateriaDia]
 * @property {number} [potenciaW]
 * @property {number} [tensaoV]
 * @property {number} [correnteA]
 * @property {number} [energiaWh]
 * @property {Map<number, EstadoCanal>} canais
 * @property {number|null} [offlineDesde]  aparelhos sem bateria: desde quando está offline
 * @property {number|null} [voltouEm]      voltou a online (deteção de energia reposta)
 * @property {number|null} [offlineAntes]  início do último período offline
 * @property {number} [rssi]
 * @property {number} [uptimeS]
 * @property {number[]} [reinicios]        instantes dos reinícios (últimas 24 h)
 * @property {[number, number][]} [amostras] amostras de bateria [ms, %]
 * @property {number|null} [rssiFracoDesde]
 * @property {Record<string, boolean>} [avisos] avisos de saúde já enviados (uma vez por ocorrência)
 * @property {import('./energia.js').ContaEnergia} [energia]
 */

/**
 * @typedef {object} Alarme
 * @property {boolean} ativo
 * @property {'desarmado'|'a_armar'|'armado'|'entrada'|'disparado'} estado
 * @property {'total'|'perimetro'|null} tipo
 * @property {string|null} desde
 * @property {string|null} ate
 * @property {{aparelho: string, canal: number}[]} ignorados
 * @property {string|null} por
 */

/**
 * @typedef {object} Cliente
 * @property {string} codigo
 * @property {Map<string, Aparelho>|null} aparelhos
 * @property {Map<string, EstadoAparelho>} estado
 * @property {Alarme|null} alarme                                      null = ainda desconhecido
 * @property {{aparelho: string, nome: string}|null} alarmeGatilho      sensor que pôs o alarme em "entrada"
 * @property {{modo: string, desde: string|null, por: string|null}|null} modo
 * @property {ConfigCasa|null} config
 * @property {Automacao[]|null} automacoes                             null = ainda desconhecido
 * @property {Cena[]|null} cenas
 * @property {{pessoas: Record<string, {nome: string, em_casa: boolean, desde: string}>, alguem: boolean}|null} presenca
 * @property {Record<string, any>|null} registo                         registo das automações (publicado)
 * @property {Record<string, Record<string, number>>} contagens         execuções por automação e por dia
 * @property {{ids: string[], mensagem: string}[]} avisosConflito
 * @property {Record<string, number>} pausas                            "aparelho/canal" → fim da pausa manual (ms)
 * @property {Record<string, {desde: number, disparado: boolean}>} duracoes  gatilhos sensor com durante_s
 * @property {{canais: Record<string, {proxima: number, ligado: boolean}>}} simulacao
 * @property {{aparelho: string, canal: number, valor: number|null, alvo: number|null, desde: number, ate: number, expira: number, automacao: string|null, teste: boolean, respondeu: boolean, avisado?: boolean}[]} esperas
 *   comandos do motor à espera de confirmação (não persistido)
 * @property {Evento[]|null} historico                                 null = ainda desconhecido
 * @property {string|null} topicoNtfy   lido do `_ntfy` retido (criado pelo domus.sh)
 * @property {boolean} avisouSemNtfy
 * @property {string[]} tokensFcm
 * @property {Record<string, string>} horaDisparos  id da automação → "data hora" do último disparo
 * @property {string|null} relatorioDia
 * @property {boolean} avisoCasaOffline
 * @property {boolean} registoSujo
 * @property {boolean} saudeSuja
 * @property {string|null} saudeAssinatura
 * @property {string|null} saudeTexto
 * @property {string|null} energiaTexto
 * @property {import('./motor-planos.js').PlanoCliente|null} plano  `_plano` retido (null = sem plano: conforto/ativo)
 */

const logPadrao = {
  info: (...a) => console.log(...a),
  aviso: (...a) => console.warn(...a),
  erro: (...a) => console.error(...a),
};

export { texto, lerJson, numero };

export class Motor {
  /** @param {OpcoesMotor} opcoes */
  constructor(opcoes) {
    this.publicarBruto = opcoes.publicar;
    this.notificador = opcoes.notificar ?? (() => {});
    this.relogio = opcoes.relogio ?? { agora: () => Date.now() };
    this.armazenamento = opcoes.armazenamento ?? null;
    this.log = opcoes.log ?? logPadrao;
    this.esperaArranqueMs = opcoes.esperaArranqueMs ?? 3000;
    this.aleatorio = opcoes.aleatorio ?? Math.random;
    /** Tamanho máximo de uma mensagem publicada (bytes); ver MQTT_MAX_PAYLOAD. */
    this.maxPayload = opcoes.maxPayload ?? MAX_PAYLOAD_PADRAO;

    /** @type {Map<string, Cliente>} */
    this.clientes = new Map();
    /** Reversões pendentes de `durante_s` (persistidas). */
    /** @type {{cliente: string, aparelho: string, canal: number, ligar: boolean, quando: number, automacao: string}[]} */
    this.reversoes = [];
    /**
     * Sequências de ações à espera de um `esperar` (persistidas).
     * @type {{cliente: string, origem: 'automacao'|'cena', ref: string, acoes: any[], quando: number, teste?: boolean, por?: string}[]}
     */
    this.sequencias = [];
    /** Estado das automações de potência: "cliente/id" → {desde, disparado}. */
    /** @type {Map<string, {desde: number, disparado: boolean}>} */
    this.potencia = new Map();
    /** Execuções recentes por automação (limite anti-ciclo). */
    /** @type {Map<string, number[]>} */
    this.execucoes = new Map();
    /** Notificações enviadas no último minuto por cliente (limite anti-abuso). */
    /** @type {Map<string, number[]>} */
    this.notificacoesRecentes = new Map();
    /** Profundidade de execuções encadeadas (automação → modo → automação…). */
    this.profundidade = 0;
    /** Clientes cujo estado retido ainda tem de ser (re)publicado. */
    /** @type {Set<string>} */
    this.porSincronizar = new Set();
    /** Clientes já sincronizados pelo menos uma vez (estado próprio publicado). */
    /** @type {Set<string>} */
    this.sincronizados = new Set();
    this.ligadoEm = null;
    /** Último minuto (UTC, em minutos desde 1970) já tratado. */
    this.ultimoMinuto = null;

    this.carregar();
  }

  // ---------------------------------------------------------------- estado

  /** @param {string} codigo @returns {Cliente} */
  cliente(codigo) {
    let c = this.clientes.get(codigo);
    if (!c) {
      c = {
        codigo,
        aparelhos: null,
        estado: new Map(),
        alarme: null,
        alarmeGatilho: null,
        modo: null,
        config: null,
        automacoes: null,
        cenas: null,
        presenca: null,
        registo: null,
        contagens: {},
        avisosConflito: [],
        pausas: {},
        duracoes: {},
        simulacao: { canais: {} },
        esperas: [],
        historico: null,
        topicoNtfy: null,
        avisouSemNtfy: false,
        tokensFcm: [],
        horaDisparos: {},
        relatorioDia: null,
        avisoCasaOffline: false,
        registoSujo: false,
        saudeSuja: false,
        saudeAssinatura: null,
        saudeTexto: null,
        energiaTexto: null,
        plano: null,
      };
      this.clientes.set(codigo, c);
    }
    return c;
  }

  /** @param {Cliente} c @param {string} id @returns {EstadoAparelho} */
  estadoAparelho(c, id) {
    let e = c.estado.get(id);
    if (!e) {
      e = { canais: new Map() };
      c.estado.set(id, e);
    }
    return e;
  }

  /** Configuração da casa (por omissão enquanto não houver). @param {Cliente} c @returns {ConfigCasa} */
  cfg(c) {
    if (!c.config) c.config = normalizarConfig(null);
    return c.config;
  }

  agoraIso() {
    return new Date(this.relogio.agora()).toISOString();
  }

  carregar() {
    let dados = null;
    try {
      dados = this.armazenamento?.carregar() ?? null;
    } catch (e) {
      this.log.erro(`[estado] não foi possível ler o estado guardado: ${e.message}`);
    }
    if (!dados || typeof dados !== 'object') return;
    for (const [codigo, d] of Object.entries(dados.clientes ?? {})) {
      if (!CLIENTE_RE.test(codigo) || !d || typeof d !== 'object') continue;
      const c = this.cliente(codigo);
      if (d.alarme && typeof d.alarme.ativo === 'boolean') c.alarme = this.normalizarAlarme(d.alarme);
      if (d.alarmeGatilho && typeof d.alarmeGatilho.nome === 'string') c.alarmeGatilho = d.alarmeGatilho;
      if (d.modo && typeof d.modo.modo === 'string') c.modo = this.normalizarModo(d.modo);
      if (d.config && typeof d.config === 'object') c.config = normalizarConfig(d.config);
      if (Array.isArray(d.automacoes)) c.automacoes = d.automacoes;
      if (Array.isArray(d.cenas)) c.cenas = d.cenas;
      if (d.presenca && typeof d.presenca.pessoas === 'object') c.presenca = d.presenca;
      if (d.registo && typeof d.registo === 'object') c.registo = d.registo;
      if (d.contagens && typeof d.contagens === 'object') c.contagens = d.contagens;
      if (d.pausas && typeof d.pausas === 'object') c.pausas = { ...d.pausas };
      if (d.duracoes && typeof d.duracoes === 'object') c.duracoes = { ...d.duracoes };
      if (d.simulacao?.canais && typeof d.simulacao.canais === 'object') c.simulacao = { canais: { ...d.simulacao.canais } };
      if (typeof d.relatorioDia === 'string') c.relatorioDia = d.relatorioDia;
      if (d.avisoCasaOffline === true) c.avisoCasaOffline = true;
      if (Array.isArray(d.historico)) c.historico = d.historico.slice(0, MAX_HISTORICO);
      if (Array.isArray(d.tokensFcm)) c.tokensFcm = d.tokensFcm.filter((t) => typeof t === 'string').slice(-MAX_TOKENS_FCM);
      if (d.horaDisparos && typeof d.horaDisparos === 'object') c.horaDisparos = { ...d.horaDisparos };
      if (d.plano) {
        const p = validarPlano(d.plano);
        if (p.ok) c.plano = p.plano;
      }
      for (const [id, e] of Object.entries(d.aparelhos ?? {})) {
        if (!e || typeof e !== 'object') continue;
        const ea = this.estadoAparelho(c, id);
        if (typeof e.ultimaNoticia === 'number') ea.ultimaNoticia = e.ultimaNoticia;
        if (e.avisoSilencio === true) ea.avisoSilencio = true;
        if (typeof e.avisoBateriaDia === 'string') ea.avisoBateriaDia = e.avisoBateriaDia;
        if (typeof e.offlineDesde === 'number') ea.offlineDesde = e.offlineDesde;
        if (typeof e.rssi === 'number') ea.rssi = e.rssi;
        if (typeof e.uptimeS === 'number') ea.uptimeS = e.uptimeS;
        if (Array.isArray(e.reinicios)) ea.reinicios = e.reinicios.filter((t) => typeof t === 'number');
        if (Array.isArray(e.amostras)) ea.amostras = e.amostras.filter((a) => Array.isArray(a) && a.length === 2);
        if (typeof e.rssiFracoDesde === 'number') ea.rssiFracoDesde = e.rssiFracoDesde;
        if (e.avisos && typeof e.avisos === 'object') ea.avisos = { ...e.avisos };
        if (e.energia && typeof e.energia.dia === 'string') ea.energia = { ...e.energia };
      }
    }
    if (Array.isArray(dados.reversoes)) {
      this.reversoes = dados.reversoes.filter(
        (r) => r && CLIENTE_RE.test(r.cliente) && typeof r.aparelho === 'string' && Number.isInteger(r.canal) && typeof r.quando === 'number',
      );
    }
    if (Array.isArray(dados.sequencias)) {
      this.sequencias = dados.sequencias.filter(
        (s) => s && CLIENTE_RE.test(s.cliente) && typeof s.ref === 'string' && Array.isArray(s.acoes) && typeof s.quando === 'number',
      );
    }
    this.log.info(
      `[estado] carregado: ${this.clientes.size} cliente(s), ${this.reversoes.length} reversão(ões) e ${this.sequencias.length} sequência(s) pendente(s)`,
    );
  }

  /** Estado persistente, serializável em JSON. */
  exportar() {
    const clientes = {};
    for (const c of this.clientes.values()) {
      const aparelhos = {};
      for (const [id, e] of c.estado) {
        const x = {};
        if (e.ultimaNoticia) x.ultimaNoticia = e.ultimaNoticia;
        if (e.avisoSilencio) x.avisoSilencio = true;
        if (e.avisoBateriaDia) x.avisoBateriaDia = e.avisoBateriaDia;
        if (e.offlineDesde) x.offlineDesde = e.offlineDesde;
        if (typeof e.rssi === 'number') x.rssi = e.rssi;
        if (typeof e.uptimeS === 'number') x.uptimeS = e.uptimeS;
        if (e.reinicios?.length) x.reinicios = e.reinicios;
        if (e.amostras?.length) x.amostras = e.amostras;
        if (e.rssiFracoDesde) x.rssiFracoDesde = e.rssiFracoDesde;
        if (e.avisos && Object.values(e.avisos).some(Boolean)) x.avisos = e.avisos;
        if (e.energia) x.energia = e.energia;
        if (Object.keys(x).length) aparelhos[id] = x;
      }
      clientes[c.codigo] = {
        alarme: c.alarme,
        alarmeGatilho: c.alarmeGatilho,
        modo: c.modo,
        config: c.config,
        automacoes: c.automacoes,
        cenas: c.cenas,
        presenca: c.presenca,
        registo: c.registo,
        contagens: c.contagens,
        pausas: c.pausas,
        duracoes: c.duracoes,
        simulacao: c.simulacao,
        relatorioDia: c.relatorioDia,
        avisoCasaOffline: c.avisoCasaOffline,
        historico: c.historico,
        tokensFcm: c.tokensFcm,
        horaDisparos: c.horaDisparos,
        plano: c.plano,
        aparelhos,
      };
    }
    return { versao: 3, clientes, reversoes: this.reversoes, sequencias: this.sequencias };
  }

  guardar() {
    try {
      this.armazenamento?.pedirGravacao(() => this.exportar());
    } catch (e) {
      this.log.erro(`[estado] erro ao guardar: ${e.message}`);
    }
  }

  publicar(topico, payload, retain = false) {
    try {
      const texto = typeof payload === 'string' ? payload : JSON.stringify(payload);
      // Uma mensagem QoS 1 maior do que o limite do broker (max_packet_size) faz o
      // Mosquitto cortar a ligação; o cliente MQTT volta a enviá-la ao religar e o
      // motor fica preso num ciclo de religações. Nunca a pôr na fila.
      const bytes = Buffer.byteLength(texto);
      if (bytes > this.maxPayload) {
        this.log.erro(`[mqtt] mensagem para ${topico} com ${bytes} bytes (limite ${this.maxPayload}): não publicada`);
        return;
      }
      this.publicarBruto(topico, texto, { retain });
    } catch (e) {
      this.log.erro(`[mqtt] erro ao publicar em ${topico}: ${e.message}`);
    }
  }

  // --------------------------------------------------------------- arranque

  /** Chamado a cada (re)ligação ao broker, depois de subscrever `domus/#`. */
  aoLigar() {
    this.ligadoEm = this.relogio.agora();
    for (const codigo of this.clientes.keys()) this.porSincronizar.add(codigo);
  }

  /**
   * Publica (retido) o estado que pertence ao motor: `_config`, `_modo`,
   * `_alarme`, `_automacoes` (+ `/avisos`, `/registo`), `_cenas`,
   * `_presenca`, `_historico`, `_saude` e `_energia`. Só depois de receber as
   * mensagens retidas, para poder adotar o que já lá estava se o estado local
   * se tiver perdido.
   * @param {Cliente} c
   */
  sincronizar(c) {
    this.cfg(c);
    if (!c.alarme) c.alarme = this.normalizarAlarme(null);
    if (!c.modo) c.modo = this.modoDoAlarme(c.alarme);
    if (!c.automacoes) c.automacoes = [];
    if (!c.cenas) c.cenas = [];
    if (!c.presenca) c.presenca = { pessoas: {}, alguem: false };
    if (!c.registo) c.registo = {};
    if (!c.historico) c.historico = [];
    this.sincronizados.add(c.codigo);
    c.avisosConflito = this.calcularConflitos(c);
    const base = `domus/${c.codigo}`;
    this.publicar(`${base}/_config`, c.config, true);
    this.publicar(`${base}/_modo`, c.modo, true);
    this.publicar(`${base}/_alarme`, c.alarme, true);
    this.publicar(`${base}/_automacoes`, c.automacoes, true);
    this.publicar(`${base}/_automacoes/avisos`, c.avisosConflito, true);
    this.publicarRegisto(c);
    this.publicar(`${base}/_cenas`, c.cenas, true);
    this.publicar(`${base}/_presenca`, c.presenca, true);
    this.publicar(`${base}/_historico`, c.historico, true);
    if (c.aparelhos) {
      this.publicarSaude(c, true);
      this.publicarEnergia(c, true);
    }
    // Plano: alarme fora do plano → casa; _saude/_energia fora do plano → apagados.
    this.imporPlano(c, null);
    this.guardar();
  }

  // -------------------------------------------------------------- mensagens

  /**
   * Trata uma mensagem MQTT. Nunca lança.
   * @param {string} topico
   * @param {Buffer|string} payload
   * @param {boolean} [retida] mensagem retida entregue ao subscrever (valor antigo)
   */
  aoMensagem(topico, payload, retida = false) {
    try {
      this.tratarMensagem(topico, payload, retida);
    } catch (e) {
      this.log.erro(`[mqtt] erro ao tratar ${topico}: ${e.stack ?? e.message}`);
    }
  }

  tratarMensagem(topico, payload, retida) {
    const partes = topico.split('/');
    if (partes[0] !== 'domus' || partes.length < 3) return;
    const codigo = partes[1];
    if (!CLIENTE_RE.test(codigo)) return;
    const resto = partes.slice(2).join('/');

    if (resto.startsWith('_')) {
      switch (resto) {
        case '_aparelhos':
          return this.aoAparelhos(codigo, payload);
        case '_alarme':
          return retida && this.adotarAlarme(codigo, payload);
        case '_alarme/set':
          return !retida && this.aoAlarmeSet(codigo, payload);
        case '_modo':
          return retida && this.adotarModo(codigo, payload);
        case '_modo/set':
          return !retida && this.aoModoSet(codigo, payload);
        case '_config':
          return retida && this.adotarConfig(codigo, payload);
        case '_config/set':
          return !retida && this.aoConfigSet(codigo, payload);
        case '_automacoes':
          return retida && this.adotarAutomacoes(codigo, payload);
        case '_automacoes/set':
          return !retida && this.aoAutomacoesSet(codigo, payload);
        case '_automacoes/admin':
          return !retida && this.aoAutomacoesAdmin(codigo, payload);
        case '_automacoes/executar':
          return !retida && this.aoAutomacoesExecutar(codigo, payload);
        case '_automacoes/registo':
          return retida && this.adotarRegisto(codigo, payload);
        case '_cenas':
          return retida && this.adotarCenas(codigo, payload);
        case '_cenas/set':
          return !retida && this.aoCenasSet(codigo, payload);
        case '_cenas/admin':
          return !retida && this.aoCenasAdmin(codigo, payload);
        case '_cenas/executar':
          return !retida && this.aoCenasExecutar(codigo, payload);
        case '_presenca':
          return retida && this.adotarPresenca(codigo, payload);
        case '_presenca/set':
          return !retida && this.aoPresencaSet(codigo, payload);
        case '_historico':
          return retida && this.adotarHistorico(codigo, payload);
        case '_ntfy':
          return this.aoNtfy(codigo, payload);
        case '_plano':
          return this.aoPlano(codigo, payload);
        case '_fcm/registar':
          return !retida && this.aoFcm(codigo, payload);
        default:
          return; // _eventos, _saude, _energia…: publicados por nós ou desconhecidos
      }
    }

    const c = this.clientes.get(codigo);
    const ap = c?.aparelhos?.get(partes[2]);
    if (!c || !ap) return;
    const sub = partes.slice(3).join('/');
    if (ap.tipo === 'openbeken') this.aoOpenBeken(c, ap, sub, payload, retida);
    else this.aoShelly(c, ap, sub, payload, retida);
  }

  aoAparelhos(codigo, payload) {
    const lista = lerJson(payload);
    if (lista === undefined) {
      this.log.aviso(`[aparelhos] ${codigo}: _aparelhos não é JSON válido; ignorado`);
      return;
    }
    const { aparelhos, rejeitados } = normalizarAparelhos(lista);
    for (const r of rejeitados) this.log.aviso(`[aparelhos] ${codigo}: ${r}`);
    const c = this.cliente(codigo);
    const novo = c.aparelhos === null;
    c.aparelhos = aparelhos;
    // Aparelhos removidos: esquece o estado (canais, energia, saúde…).
    let removidos = 0;
    for (const id of [...c.estado.keys()]) {
      if (!aparelhos.has(id)) {
        c.estado.delete(id);
        removidos++;
      }
    }
    if (removidos) this.guardar();
    c.saudeSuja = true;
    this.log.info(`[aparelhos] ${codigo}: ${aparelhos.size} aparelho(s)`);
    if (novo) this.porSincronizar.add(codigo);
  }

  adotarHistorico(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (c.historico || !Array.isArray(v)) return;
    c.historico = v.filter((e) => e && typeof e === 'object' && typeof e.tipo === 'string').slice(0, MAX_HISTORICO);
    this.guardar();
  }

  /**
   * `_ntfy` (retido, publicado pelo domus.sh):
   * {"url":"https://ntfy.HOST/domus-joao-…","servidor":"https://ntfy.HOST","topico":"domus-joao-…"}.
   * O motor só lê o tópico; nunca o gera nem o publica. Mensagem vazia = apagado.
   */
  aoNtfy(codigo, payload) {
    const c = this.cliente(codigo);
    if (texto(payload) === '') {
      c.topicoNtfy = null;
      return;
    }
    const v = lerJson(payload);
    let topico = v && typeof v.topico === 'string' ? v.topico : undefined;
    if (!topico && v && typeof v.url === 'string') topico = v.url.replace(/\/+$/, '').split('/').pop();
    const re = new RegExp(`^domus-${codigo}-[A-Za-z0-9_-]{8,64}$`);
    if (!topico || !re.test(topico)) {
      this.log.aviso(`[ntfy] ${codigo}: _ntfy inválido; ignorado`);
      return;
    }
    if (c.topicoNtfy !== topico) this.log.info(`[ntfy] ${codigo}: tópico definido`);
    c.topicoNtfy = topico;
    c.avisouSemNtfy = false;
  }

  // ---------------------------------------------------------------- aparelhos

  /** Marca notícias de um aparelho (não conta valores retidos nem "offline"). */
  noticia(c, ap, retida) {
    if (retida) return;
    const e = this.estadoAparelho(c, ap.id);
    e.ultimaNoticia = this.relogio.agora();
    if (e.avisoSilencio) {
      e.avisoSilencio = false;
      c.saudeSuja = true;
      this.guardar();
      // Aparelho a pilhas que voltou a dar notícias depois de 24 h calado.
      this.dispararSistema(c, 'aparelho_online', ap);
    }
    this.definirOnline(c, ap, true, false);
  }

  aoOpenBeken(c, ap, sub, payload, retida) {
    const e = this.estadoAparelho(c, ap.id);
    const t = texto(payload);
    if (sub === 'connected') {
      if (t === 'online') {
        if (retida) this.definirOnline(c, ap, true, true);
        else this.noticia(c, ap, false);
      } else if (t === 'offline') {
        this.definirOnline(c, ap, false, retida);
      }
      return;
    }
    let m = /^(\d+)\/get$/.exec(sub);
    if (m) {
      const n = Number(m[1]);
      const v = numero(t);
      if (v === undefined || !ap.canais.has(n)) return;
      this.noticia(c, ap, retida);
      this.atualizarCanal(c, ap, n, v, retida);
      return;
    }
    if (sub === 'led_dimmer/get') {
      const v = numero(t);
      const canal = [...ap.canais.values()].find((x) => x.funcao === 'luz');
      if (v === undefined || !canal) return;
      this.noticia(c, ap, retida);
      this.canalEstado(c, ap.id, canal.n).brilho = v;
      return;
    }
    // Estado periódico do OpenBeken (se o aparelho o publicar).
    if (sub === 'rssi' || sub === 'uptime') {
      const v = numero(t);
      if (v === undefined) return;
      this.noticia(c, ap, retida);
      if (sub === 'rssi') this.atualizarRssi(c, ap, v);
      else this.atualizarUptime(c, ap, v, retida);
      return;
    }
    m = /^(power|voltage|current|energycounter)\/get$/.exec(sub);
    if (m) {
      const v = numero(t);
      if (v === undefined) return;
      this.noticia(c, ap, retida);
      if (m[1] === 'power') this.atualizarPotencia(c, ap, v, retida);
      else if (m[1] === 'voltage') e.tensaoV = v;
      else if (m[1] === 'current') e.correnteA = v;
      else this.atualizarEnergia(c, ap, v);
    }
  }

  aoShelly(c, ap, sub, payload, retida) {
    const e = this.estadoAparelho(c, ap.id);
    if (sub === 'online') {
      const t = texto(payload);
      if (t === 'true') {
        if (retida) this.definirOnline(c, ap, true, true);
        else this.noticia(c, ap, false);
      } else if (t === 'false') {
        this.definirOnline(c, ap, false, retida);
      }
      return;
    }
    if (sub === 'status/wifi' || sub === 'status/sys') {
      const j = lerJson(payload);
      if (!j || typeof j !== 'object') return;
      this.noticia(c, ap, retida);
      if (sub === 'status/wifi' && numero(j.rssi) !== undefined) this.atualizarRssi(c, ap, numero(j.rssi));
      if (sub === 'status/sys' && numero(j.uptime) !== undefined) this.atualizarUptime(c, ap, numero(j.uptime), retida);
      return;
    }
    const m = /^status\/(switch|input|cover|light|devicepower):(\d+)$/.exec(sub);
    if (!m) return;
    const j = lerJson(payload);
    if (!j || typeof j !== 'object') return;
    const id = Number(m[2]);
    const n = id + 1;
    this.noticia(c, ap, retida);
    switch (m[1]) {
      case 'switch':
        if (ap.canais.has(n) && typeof j.output === 'boolean') this.atualizarCanal(c, ap, n, j.output ? 1 : 0, retida);
        if (id === 0) {
          if (numero(j.voltage) !== undefined) e.tensaoV = numero(j.voltage);
          if (numero(j.current) !== undefined) e.correnteA = numero(j.current);
          if (numero(j.aenergy?.total) !== undefined) this.atualizarEnergia(c, ap, numero(j.aenergy.total));
          if (numero(j.apower) !== undefined) this.atualizarPotencia(c, ap, numero(j.apower), retida);
        }
        break;
      case 'input':
        if (ap.canais.has(n) && typeof j.state === 'boolean') this.atualizarCanal(c, ap, n, j.state ? 1 : 0, retida);
        break;
      case 'cover': {
        const pos = numero(j.current_pos);
        if (ap.canais.has(n) && pos !== undefined) this.atualizarCanal(c, ap, n, pos, retida);
        break;
      }
      case 'light':
        if (ap.canais.has(n) && typeof j.output === 'boolean') this.atualizarCanal(c, ap, n, j.output ? 1 : 0, retida);
        if (ap.canais.has(n) && numero(j.brightness) !== undefined) this.canalEstado(c, ap.id, n).brilho = numero(j.brightness);
        break;
      case 'devicepower': {
        const pct = numero(j.battery?.percent);
        const canal = [...ap.canais.values()].find((x) => x.funcao === 'bateria');
        if (pct !== undefined && canal) this.atualizarCanal(c, ap, canal.n, pct, retida);
        break;
      }
    }
  }

  canalEstado(c, idAparelho, n) {
    const e = this.estadoAparelho(c, idAparelho);
    let ce = e.canais.get(n);
    if (!ce) {
      ce = {};
      e.canais.set(n, ce);
    }
    return ce;
  }

  /** Valor conhecido de um canal (ou undefined). */
  valorCanal(c, idAparelho, n) {
    return c.estado.get(idAparelho)?.canais.get(n)?.valor;
  }

  /**
   * Novo valor de um canal. Só há "transição" (alarme, automações) quando o
   * valor muda e a mensagem não é retida — o primeiro valor retido recebido
   * no arranque serve apenas de referência.
   */
  atualizarCanal(c, ap, n, valor, retida) {
    const canal = ap.canais.get(n);
    if (!canal) return;
    const ce = this.canalEstado(c, ap.id, n);
    const anterior = ce.valor;
    ce.valor = valor;
    if (canal.funcao === 'bateria') {
      this.verificarBateria(c, ap, valor, retida);
      return;
    }
    // Gatilhos "há X s nesse valor" deixam de contar se o valor mudou (mesmo retido).
    this.cancelarDuracoes(c, ap, n, valor);
    if (retida) return;
    const doMotor = this.confirmarEspera(c, ap, n, valor);
    if (anterior === valor) {
      // Sensor de movimento que volta a dizer "1": ainda há gente — prolonga
      // as luzes ligadas por automações deste sensor (temporizador de ocupação).
      if (canal.funcao === 'movimento') this.prolongar(c, ap, canal, valor);
      return;
    }
    ce.ultimaMudanca = this.relogio.agora();
    if (canal.funcao === 'porta' || canal.funcao === 'movimento') c.saudeSuja = true;
    this.cancelarSeAlteradoPorOutro(c, ap, n, valor);
    // Mexido por alguém (botão físico, app) e não pelo motor → pausa manual.
    if (!doMotor && anterior !== undefined && ['interruptor', 'luz', 'estore'].includes(canal.funcao)) this.pausaManual(c, ap, canal);
    this.aoTransicao(c, ap, canal, valor);
  }

  /**
   * Um canal com reversão `durante_s` pendente mudou para um valor diferente
   * do que o motor lá pôs: alguém mexeu à mão (ou outra app). A reversão é
   * cancelada — o motor não desliga o que o utilizador decidiu.
   */
  cancelarSeAlteradoPorOutro(c, ap, n, valor) {
    const antes = this.reversoes.length;
    this.reversoes = this.reversoes.filter((r) => {
      if (r.cliente !== c.codigo || r.aparelho !== ap.id || r.canal !== n) return true;
      const posPeloMotor = r.ligar ? 0 : 1;
      return valor === posPeloMotor;
    });
    if (this.reversoes.length !== antes) {
      this.log.info(`[automações] ${c.codigo}: ${ap.id} canal ${n} alterado por outra via; reversão durante_s cancelada`);
      this.guardar();
    }
  }

  aoTransicao(c, ap, canal, valor) {
    const nome = canal.nome;
    if (canal.funcao === 'porta') {
      this.evento(c, { tipo: 'sensor', titulo: valor ? 'Porta aberta' : 'Porta fechada', mensagem: nome, aparelho: ap.id }, false);
    }
    this.alarmeTransicao(c, ap, canal, valor);
    this.gatilhosSensor(c, ap, canal, valor);
  }

  // ------------------------------------------------------------------ FCM

  aoFcm(codigo, payload) {
    const c = this.cliente(codigo);
    const v = lerJson(payload);
    if (!v || typeof v.token !== 'string' || v.token.length < 20 || v.token.length > 4096) {
      this.log.aviso(`[fcm] ${codigo}: registo inválido ignorado`);
      return;
    }
    c.tokensFcm = c.tokensFcm.filter((t) => t !== v.token);
    if (v.remover !== true) {
      c.tokensFcm.push(v.token);
      if (c.tokensFcm.length > MAX_TOKENS_FCM) c.tokensFcm = c.tokensFcm.slice(-MAX_TOKENS_FCM);
    }
    this.log.info(`[fcm] ${codigo}: ${v.remover === true ? 'token removido' : 'token registado'} (${c.tokensFcm.length} no total)`);
    this.guardar();
  }

  // --------------------------------------------------------------- eventos

  /**
   * Publica um evento em `_eventos`, guarda-o no histórico (retido) e, se
   * pedido, envia notificação (ntfy + FCM).
   * @param {Cliente} c
   * @param {Omit<Evento,'ts'>} ev
   * @param {boolean} [notificar]
   * @param {{prioridade?: PedidoNotificacao['prioridade'], ignorarSilencio?: boolean}} [opcoes]
   */
  evento(c, ev, notificar = false, opcoes = {}) {
    /** @type {Evento} */
    const evento = { ts: this.agoraIso(), ...ev };
    const base = `domus/${c.codigo}`;
    this.publicar(`${base}/_eventos`, evento);
    c.historico = [evento, ...(c.historico ?? [])].slice(0, MAX_HISTORICO);
    this.publicar(`${base}/_historico`, c.historico, true);
    this.guardar();
    if (notificar) this.enviarNotificacao(c, evento, opcoes);
  }

  /** Estamos nas horas de silêncio da casa? @param {Cliente} c */
  emSilencio(c) {
    const s = this.cfg(c).silencio;
    if (!s) return false;
    return dentroDoIntervalo(partesLocais(this.relogio.agora(), FUSO).minutos, s[0], s[1]);
  }

  /**
   * @param {Cliente} c
   * @param {{tipo: Evento['tipo'], titulo: string, mensagem: string}} ev
   * @param {{prioridade?: PedidoNotificacao['prioridade'], ignorarSilencio?: boolean}} [opcoes]
   */
  enviarNotificacao(c, ev, opcoes = {}) {
    // Notificações (ntfy/FCM) só nos planos que as incluem; o evento fica no histórico.
    if (!this.pode(c, 'notificacoes')) {
      this.log.info(`[notificações] ${c.codigo}: "${ev.titulo}" não enviada (fora do plano)`);
      return;
    }
    // Horas de silêncio: só os alarmes notificam (o evento fica no histórico na mesma).
    if (ev.tipo !== 'alarme' && !opcoes.ignorarSilencio && this.emSilencio(c)) {
      this.log.info(`[notificações] ${c.codigo}: "${ev.titulo}" não enviada (horas de silêncio)`);
      return;
    }
    // Limite por cliente: no máximo MAX_NOTIFICACOES_MINUTO notificações por minuto, exceto as do
    // alarme (disparo e aviso de entrada), que passam sempre. O evento fica no histórico na mesma.
    if (ev.tipo !== 'alarme' && !opcoes.ignorarSilencio) {
      const agora = this.relogio.agora();
      const recentes = (this.notificacoesRecentes.get(c.codigo) ?? []).filter((t) => agora - t < 60_000);
      if (recentes.length >= MAX_NOTIFICACOES_MINUTO) {
        this.notificacoesRecentes.set(c.codigo, recentes);
        this.log.aviso(`[notificações] ${c.codigo}: "${ev.titulo}" não enviada (mais de ${MAX_NOTIFICACOES_MINUTO} por minuto)`);
        return;
      }
      recentes.push(agora);
      this.notificacoesRecentes.set(c.codigo, recentes);
    }
    const prioridade = opcoes.prioridade ?? (ev.tipo === 'alarme' ? 'urgent' : ev.tipo === 'aviso' ? 'high' : 'default');
    const tags = ev.tipo === 'alarme' ? ['rotating_light'] : ev.tipo === 'aviso' ? ['warning'] : ['house'];
    if (!c.topicoNtfy && !c.avisouSemNtfy) {
      c.avisouSemNtfy = true;
      this.log.aviso(`[ntfy] ${c.codigo}: sem _ntfy retido (criado pelo domus.sh); notificações só por FCM`);
    }
    /** @type {PedidoNotificacao} */
    const pedido = {
      cliente: c.codigo,
      topicoNtfy: c.topicoNtfy,
      tokensFcm: [...c.tokensFcm],
      tipo: ev.tipo,
      titulo: ev.titulo,
      mensagem: ev.mensagem,
      prioridade,
      tags,
    };
    let resultado;
    try {
      resultado = this.notificador(pedido);
    } catch (e) {
      resultado = Promise.reject(e);
    }
    Promise.resolve(resultado)
      .then((r) => {
        const invalidos = r?.tokensInvalidos ?? [];
        if (invalidos.length) {
          c.tokensFcm = c.tokensFcm.filter((t) => !invalidos.includes(t));
          this.log.info(`[fcm] ${c.codigo}: ${invalidos.length} token(s) inválido(s) removido(s)`);
          this.guardar();
        }
      })
      .catch((e) => this.log.erro(`[notificações] ${c.codigo}: ${e.message}`));
  }

  // ------------------------------------------------------------------ tick

  /**
   * Chamado periodicamente (ex.: a cada segundo). Sincroniza o estado retido
   * após o arranque, trata dos temporizadores (reversões `durante_s`,
   * sequências com `esperar`, atrasos do alarme, gatilhos "há X s", respostas
   * dos aparelhos), potências e, uma vez por minuto, horas, sol, avisos,
   * energia, saúde, simulação de presença e relatório.
   */
  /**
   * Sinal de vida (`_motor`, retido, de minuto a minuto): a área de cliente sabe por ele que o alarme, as cenas e as
   * automações estão a ser servidos; sem ele durante uns minutos mostra "indisponíveis de momento".
   * @param {number} agora
   */
  darSinalDeVida(agora) {
    for (const c of this.clientes.values()) {
      if (this.sincronizados.has(c.codigo)) this.publicar(`domus/${c.codigo}/_motor`, { vivo: new Date(agora).toISOString() }, true);
    }
  }

  /** Paragem ordenada: o sinal de vida passa a "parado" (retido), para a área de cliente o saber logo, também quem entra depois. */
  despedir() {
    for (const c of this.clientes.values()) this.publicar(`domus/${c.codigo}/_motor`, { parado: true }, true);
  }

  tick() {
    try {
      const agora = this.relogio.agora();
      if (this.ligadoEm !== null && agora - this.ligadoEm >= this.esperaArranqueMs && this.porSincronizar.size) {
        const codigos = [...this.porSincronizar];
        this.porSincronizar.clear();
        for (const codigo of codigos) this.sincronizar(this.cliente(codigo));
      }
      this.executarReversoes();
      this.executarSequencias();
      for (const c of this.clientes.values()) {
        this.verificarTemporizadoresAlarme(c);
        this.verificarPotencia(c);
        this.verificarDuracoes(c);
        this.verificarEsperas(c);
      }

      const minuto = Math.floor(agora / 60_000);
      if (this.ultimoMinuto === null) this.ultimoMinuto = minuto - 1;
      if (minuto > this.ultimoMinuto) {
        // Recupera minutos perdidos (ex.: processo parado alguns segundos), até 10.
        const inicio = Math.max(this.ultimoMinuto + 1, minuto - 9);
        for (let m = inicio; m <= minuto; m++) this.minuto(m * 60_000);
        this.ultimoMinuto = minuto;
        this.darSinalDeVida(agora);
      }
      for (const c of this.clientes.values()) {
        if (!this.sincronizados.has(c.codigo)) continue;
        if (c.registoSujo) this.publicarRegisto(c);
        if (c.saudeSuja) this.publicarSaude(c, false);
      }
    } catch (e) {
      this.log.erro(`[tick] ${e.stack ?? e.message}`);
    }
  }

  /** Trabalho feito uma vez por minuto. @param {number} ms início do minuto (UTC) */
  minuto(ms) {
    const local = partesLocais(ms, FUSO);
    this.limparContadores();
    for (const c of this.clientes.values()) {
      const tarefas = [
        () => this.minutoAutomacoes(c, ms, local),
        () => this.verificarSilencio(c),
        () => this.minutoSaude(c, ms, local),
        () => this.minutoCasa(c, ms, local),
      ];
      for (const t of tarefas) {
        try {
          t();
        } catch (e) {
          this.log.erro(`[minuto] ${c.codigo}: ${e.stack ?? e.message}`);
        }
      }
    }
  }

  /** Esquece as execuções/notificações com mais de 1 min (limites anti-ciclo/anti-abuso). */
  limparContadores() {
    const agora = this.relogio.agora();
    for (const mapa of [this.execucoes, this.notificacoesRecentes]) {
      for (const [k, lista] of mapa) {
        const recentes = lista.filter((t) => agora - t < 60_000);
        if (recentes.length) mapa.set(k, recentes);
        else mapa.delete(k);
      }
    }
  }

  /** Aparelhos a pilhas sem notícias há mais de 24 h (aviso v2). */
  verificarSilencio(c) {
    if (!c.aparelhos) return;
    const agora = this.relogio.agora();
    for (const ap of c.aparelhos.values()) {
      if (!ap.bateria) continue;
      const e = c.estado.get(ap.id);
      if (!e?.ultimaNoticia || e.avisoSilencio || agora - e.ultimaNoticia <= SILENCIO_MS) continue;
      e.avisoSilencio = true;
      c.saudeSuja = true;
      const horas = Math.floor((agora - e.ultimaNoticia) / 3_600_000);
      this.evento(c, { tipo: 'aviso', titulo: 'Sem notícias', mensagem: `${ap.nome}: sem notícias há ${horas} h. Verifique as pilhas e o Wi-Fi.`, aparelho: ap.id }, true);
      this.dispararSistema(c, 'aparelho_offline', ap);
      this.gatilhoOffline(c, ap, e.ultimaNoticia);
    }
  }
}

Object.assign(Motor.prototype, metodosCasa, metodosAutomacoes, metodosSaude, metodosPlanos);
