// Saúde e energia (docs/PROTOCOLO-MQTT-v3.md §4–§6 e §9): aparelhos
// online/offline, energia reposta, `_saude`, avisos de saúde, `_energia` e
// o relatório diário enviado por notificação.
//
// Métodos misturados na classe Motor (Object.assign no fim de motor.js).

import { juntarAmostra, estimarDiasBateria, houveReinicio } from './saude.js';
import { novaConta, rolarDia, juntarLeitura, kwh } from './energia.js';
import { textoRelatorio } from './relatorio.js';
import { partesLocais, horaLocal, FUSO } from './tempo.js';

/** @typedef {import('./motor.js').Motor} Motor */
/** @typedef {import('./motor.js').Cliente} Cliente */
/** @typedef {import('./aparelhos.js').Aparelho} Aparelho */

export const BATERIA_FRACA = 15;
export const BATERIA_DIAS_AVISO = 21;
export const RSSI_FRACO = -80;
export const RSSI_FRACO_MS = 3_600_000;
export const MAX_REINICIOS_24H = 5;
/** Janela da deteção de energia reposta. */
export const JANELA_REPOSTA_MS = 2 * 60_000;
const DIA_MS = 86_400_000;

/** @type {ThisType<Motor> & Record<string, Function>} */
export const metodosSaude = {
  // ------------------------------------------------------- online/offline

  /**
   * Novo estado de ligação de um aparelho (LWT `connected`/`online`, ou
   * qualquer mensagem ao vivo). Os aparelhos a pilhas dormem: o seu LWT
   * "offline" não conta (usa-se o aviso de 24 h sem notícias).
   * @param {Cliente} c
   * @param {Aparelho} ap
   * @param {boolean} online
   * @param {boolean} retida
   */
  definirOnline(c, ap, online, retida) {
    const e = this.estadoAparelho(c, ap.id);
    const antes = e.online;
    e.online = online;
    if (ap.bateria) return;
    const agora = this.relogio.agora();
    if (!online) {
      if (antes === false && e.offlineDesde) return;
      if (!retida || !e.offlineDesde) e.offlineDesde = agora;
      c.saudeSuja = true;
      this.guardar();
      if (!retida && antes !== false) {
        this.log.info(`[saúde] ${c.codigo}: ${ap.id} offline`);
        this.dispararSistema(c, 'aparelho_offline', ap);
        this.gatilhoOffline(c, ap, agora);
      }
      return;
    }
    if (antes !== false && !e.offlineDesde) return;
    const inicio = e.offlineDesde ?? null;
    e.offlineDesde = null;
    if (e.avisos?.offline) e.avisos.offline = false;
    c.saudeSuja = true;
    this.guardar();
    if (retida) return;
    this.log.info(`[saúde] ${c.codigo}: ${ap.id} voltou a estar online`);
    e.voltouEm = agora;
    e.offlineAntes = inicio;
    this.dispararSistema(c, 'aparelho_online', ap);
    this.verificarEnergiaReposta(c);
  },

  /**
   * Energia (ou internet) reposta: pelo menos metade dos aparelhos sem pilhas
   * (e no mínimo 2, se houver) voltaram a online nos últimos 2 min depois de
   * estarem offline → aviso "A casa esteve sem internet de HH:MM a HH:MM" e
   * gatilho de sistema `energia_reposta`.
   * @param {Cliente} c
   */
  verificarEnergiaReposta(c) {
    const agora = this.relogio.agora();
    const semBateria = [...(c.aparelhos?.values() ?? [])].filter((ap) => !ap.bateria);
    const voltaram = semBateria.filter((ap) => {
      const e = c.estado.get(ap.id);
      return e?.voltouEm && agora - e.voltouEm <= JANELA_REPOSTA_MS && e.offlineAntes;
    });
    if (voltaram.length === 0 || voltaram.length * 2 < semBateria.length || voltaram.length < Math.min(2, semBateria.length)) return;
    const inicio = Math.min(...voltaram.map((ap) => c.estado.get(ap.id).offlineAntes));
    for (const ap of voltaram) {
      const e = c.estado.get(ap.id);
      e.voltouEm = null;
      e.offlineAntes = null;
    }
    c.avisoCasaOffline = false;
    this.log.info(`[saúde] ${c.codigo}: energia/internet reposta (${voltaram.length} de ${semBateria.length} aparelhos)`);
    this.evento(
      c,
      { tipo: 'aviso', titulo: 'Ligação reposta', mensagem: `A casa esteve sem internet de ${horaLocal(inicio)} a ${horaLocal(agora)}. Os aparelhos voltaram a ligar-se.` },
      true,
    );
    this.dispararSistema(c, 'energia_reposta');
  },

  // ---------------------------------------------------------- medições

  /** @param {Cliente} c @param {Aparelho} ap @param {number} rssi */
  atualizarRssi(c, ap, rssi) {
    const e = this.estadoAparelho(c, ap.id);
    e.rssi = rssi;
    if (rssi < RSSI_FRACO) {
      e.rssiFracoDesde ??= this.relogio.agora();
    } else if (e.rssiFracoDesde) {
      e.rssiFracoDesde = null;
      if (e.avisos?.rssi) e.avisos.rssi = false;
    }
  },

  /** @param {Cliente} c @param {Aparelho} ap @param {number} uptime segundos */
  atualizarUptime(c, ap, uptime, retida) {
    const e = this.estadoAparelho(c, ap.id);
    if (!retida && houveReinicio(e.uptimeS, uptime)) {
      const agora = this.relogio.agora();
      e.reinicios = [...(e.reinicios ?? []).filter((t) => agora - t < DIA_MS), agora];
      c.saudeSuja = true;
      this.log.info(`[saúde] ${c.codigo}: ${ap.id} reiniciou (${e.reinicios.length} em 24 h)`);
      this.guardar();
    }
    e.uptimeS = uptime;
  },

  /** Bateria: aviso < 15 % (um por dia, como na v2) e amostras para a estimativa. */
  verificarBateria(c, ap, pct, retida) {
    const e = this.estadoAparelho(c, ap.id);
    if (!retida) {
      e.amostras = juntarAmostra(e.amostras ?? [], this.relogio.agora(), pct);
      c.saudeSuja = true;
    }
    if (pct >= BATERIA_FRACA) return;
    const hoje = partesLocais(this.relogio.agora(), FUSO).data;
    if (e.avisoBateriaDia === hoje) return;
    e.avisoBateriaDia = hoje;
    this.evento(c, { tipo: 'aviso', titulo: 'Bateria fraca', mensagem: `${ap.nome}: bateria a ${Math.round(pct)} %. Substitua as pilhas.`, aparelho: ap.id }, true);
  },

  /** Contador de energia (Wh) de um aparelho medidor. @param {Cliente} c */
  atualizarEnergia(c, ap, wh) {
    const e = this.estadoAparelho(c, ap.id);
    e.energiaWh = wh;
    if (!ap.medidor) return;
    const hoje = partesLocais(this.relogio.agora(), FUSO).data;
    e.energia ??= novaConta(hoje);
    juntarLeitura(e.energia, wh, hoje);
  },

  // ------------------------------------------------------------- minuto

  /** @param {Cliente} c @param {number} ms */
  minutoSaude(c, ms, local) {
    if (!c.aparelhos) return;
    const cinco = Math.floor(ms / 60_000) % 5 === 0;
    let rolou = false;
    for (const e of c.estado.values()) if (e.energia && rolarDia(e.energia, local.data)) rolou = true;
    if (this.sincronizados.has(c.codigo) && (rolou || cinco)) this.publicarEnergia(c, false);
    if (rolou || cinco) this.guardar();
    // Avisos de saúde da v3 (offline, pilhas a acabar, sinal, reinícios) só com `saude` no plano.
    if (this.pode(c, 'saude')) this.avisosSaude(c);
    if (this.sincronizados.has(c.codigo) && cinco) this.publicarSaude(c, true);
    const hora = this.cfg(c).relatorio_diario;
    if (hora && hora === local.hora && c.relatorioDia !== local.data && this.pode(c, 'relatorio_diario')) {
      c.relatorioDia = local.data;
      this.guardar();
      this.enviarRelatorio(c);
    }
  },

  /** Avisos de saúde, uma vez por ocorrência. @param {Cliente} c */
  avisosSaude(c) {
    const agora = this.relogio.agora();
    const cfg = this.cfg(c);
    const aparelhos = [...c.aparelhos.values()];
    const semBateria = aparelhos.filter((ap) => !ap.bateria);
    const offline = semBateria.filter((ap) => {
      const e = c.estado.get(ap.id);
      return e?.online === false && e.offlineDesde && agora - e.offlineDesde > cfg.offline_min * 60_000;
    });
    if (offline.length >= 2 && offline.length * 2 >= semBateria.length) {
      // A casa inteira caiu (internet ou energia): um só aviso.
      if (!c.avisoCasaOffline) {
        c.avisoCasaOffline = true;
        const inicio = Math.min(...offline.map((ap) => c.estado.get(ap.id).offlineDesde));
        this.evento(
          c,
          { tipo: 'aviso', titulo: 'Casa sem ligação', mensagem: `A casa está sem ligação ao servidor desde ${horaLocal(inicio)} (${offline.length} aparelhos offline). Falta de internet ou de energia?` },
          true,
        );
      }
      for (const ap of offline) (this.estadoAparelho(c, ap.id).avisos ??= {}).offline = true;
    } else {
      for (const ap of offline) {
        const e = this.estadoAparelho(c, ap.id);
        e.avisos ??= {};
        if (e.avisos.offline) continue;
        e.avisos.offline = true;
        this.evento(c, { tipo: 'aviso', titulo: 'Aparelho offline', mensagem: `${ap.nome} está offline desde ${horaLocal(e.offlineDesde)}.`, aparelho: ap.id }, true);
      }
    }
    for (const ap of aparelhos) {
      const e = c.estado.get(ap.id);
      if (!e) continue;
      e.avisos ??= {};
      const canalBat = [...ap.canais.values()].find((x) => x.funcao === 'bateria');
      const pct = canalBat ? e.canais.get(canalBat.n)?.valor : undefined;
      if (typeof pct === 'number') {
        const dias = estimarDiasBateria(e.amostras ?? [], pct);
        if (dias === null || dias >= BATERIA_DIAS_AVISO) e.avisos.bateriaDias = false;
        else if (pct >= BATERIA_FRACA && !e.avisos.bateriaDias) {
          e.avisos.bateriaDias = true;
          this.evento(
            c,
            { tipo: 'aviso', titulo: 'Pilhas a acabar', mensagem: `${ap.nome}: as pilhas devem durar mais cerca de ${dias} dias (${Math.round(pct)} %). Substitua-as em breve.`, aparelho: ap.id },
            true,
          );
        }
      }
      if (e.rssiFracoDesde && agora - e.rssiFracoDesde >= RSSI_FRACO_MS && !e.avisos.rssi) {
        e.avisos.rssi = true;
        this.evento(c, { tipo: 'aviso', titulo: 'Sinal Wi-Fi fraco', mensagem: `${ap.nome}: sinal Wi-Fi fraco (${e.rssi} dBm) há mais de 1 h.`, aparelho: ap.id }, true);
      }
      const reinicios = (e.reinicios ?? []).filter((t) => agora - t < DIA_MS);
      if (reinicios.length !== (e.reinicios ?? []).length) e.reinicios = reinicios;
      if (reinicios.length <= MAX_REINICIOS_24H) e.avisos.reinicios = false;
      else if (!e.avisos.reinicios) {
        e.avisos.reinicios = true;
        this.evento(
          c,
          { tipo: 'aviso', titulo: 'Reinícios frequentes', mensagem: `${ap.nome} reiniciou ${reinicios.length} vezes nas últimas 24 h (alimentação ou Wi-Fi instável?).`, aparelho: ap.id },
          true,
        );
      }
    }
  },

  // ------------------------------------------------------------- _saude

  /**
   * `_saude`: {"<aparelho>": {online, ultima_noticia, rssi, uptime_s,
   * reinicios_24h, bateria, bateria_dias, offline_desde}}.
   * @param {Cliente} c
   */
  calcularSaude(c) {
    const agora = this.relogio.agora();
    const r = {};
    for (const ap of c.aparelhos?.values() ?? []) {
      const e = c.estado.get(ap.id);
      const canalBat = [...ap.canais.values()].find((x) => x.funcao === 'bateria');
      const pct = canalBat ? e?.canais.get(canalBat.n)?.valor : undefined;
      const online = ap.bateria ? !!e?.ultimaNoticia && agora - e.ultimaNoticia <= DIA_MS : e?.online === true;
      let offlineDesde = null;
      if (ap.bateria) {
        if (e?.ultimaNoticia && !online) offlineDesde = new Date(e.ultimaNoticia).toISOString();
      } else if (e?.offlineDesde) offlineDesde = new Date(e.offlineDesde).toISOString();
      r[ap.id] = {
        online,
        ultima_noticia: e?.ultimaNoticia ? new Date(e.ultimaNoticia).toISOString() : null,
        rssi: typeof e?.rssi === 'number' ? e.rssi : null,
        uptime_s: typeof e?.uptimeS === 'number' ? e.uptimeS : null,
        reinicios_24h: (e?.reinicios ?? []).filter((t) => agora - t < DIA_MS).length,
        bateria: typeof pct === 'number' ? Math.round(pct) : null,
        bateria_dias: typeof pct === 'number' ? estimarDiasBateria(e?.amostras ?? [], pct) : null,
        offline_desde: offlineDesde,
      };
    }
    return r;
  },

  /**
   * Publica `_saude` (retido) quando muda algo importante (online, bateria,
   * reinícios…) ou, a cada 5 min (`periodico`), se mudou qualquer coisa.
   * @param {Cliente} c
   * @param {boolean} periodico
   */
  publicarSaude(c, periodico) {
    c.saudeSuja = false;
    if (!this.pode(c, 'saude')) return; // fora do plano: não publicado (apagado em imporPlano)
    const saude = this.calcularSaude(c);
    const texto = JSON.stringify(saude);
    const assinatura = JSON.stringify(
      Object.fromEntries(Object.entries(saude).map(([id, s]) => [id, { ...s, ultima_noticia: null, uptime_s: null, rssi: null }])),
    );
    if (periodico ? texto === c.saudeTexto : assinatura === c.saudeAssinatura) return;
    c.saudeTexto = texto;
    c.saudeAssinatura = assinatura;
    this.publicar(`domus/${c.codigo}/_saude`, texto, true);
  },

  // ------------------------------------------------------------ _energia

  /**
   * `_energia`: {"hoje_kwh","ontem_kwh","mes_kwh","aparelhos":{"<id>":{"hoje_kwh","ontem_kwh"}}}.
   * O total da casa é a soma dos medidores marcados `geral: true` ou, se não
   * houver nenhum, de todos os medidores.
   * @param {Cliente} c
   */
  calcularEnergia(c) {
    const hoje = partesLocais(this.relogio.agora(), FUSO).data;
    const aparelhos = {};
    const medidores = [...(c.aparelhos?.values() ?? [])].filter((ap) => ap.medidor);
    const gerais = medidores.filter((ap) => ap.geral);
    const paraTotal = new Set((gerais.length ? gerais : medidores).map((ap) => ap.id));
    let hojeWh = 0;
    let ontemWh = 0;
    let mesWh = 0;
    for (const ap of medidores) {
      const conta = c.estado.get(ap.id)?.energia;
      if (!conta) continue;
      rolarDia(conta, hoje);
      aparelhos[ap.id] = { hoje_kwh: kwh(conta.hojeWh), ontem_kwh: kwh(conta.ontemWh) };
      if (paraTotal.has(ap.id)) {
        hojeWh += conta.hojeWh;
        ontemWh += conta.ontemWh;
        mesWh += conta.mesWh;
      }
    }
    return { hoje_kwh: kwh(hojeWh), ontem_kwh: kwh(ontemWh), mes_kwh: kwh(mesWh), aparelhos };
  },

  /** @param {Cliente} c @param {boolean} forcar publica mesmo sem mudanças */
  publicarEnergia(c, forcar) {
    if (!this.pode(c, 'energia')) return; // fora do plano: não publicado (apagado em imporPlano)
    const texto = JSON.stringify(this.calcularEnergia(c));
    if (!forcar && texto === c.energiaTexto) return;
    c.energiaTexto = texto;
    this.publicar(`domus/${c.codigo}/_energia`, texto, true);
  },

  // ----------------------------------------------------------- relatório

  /** Texto do relatório da casa (o mesmo resumo da app/site). @param {Cliente} c */
  relatorio(c) {
    const agora = this.relogio.agora();
    const limiar = this.cfg(c).limiar_espera_w;
    const d = { modo: c.modo?.modo ?? 'casa', estadoAlarme: c.alarme?.estado ?? 'desarmado', ligados: [], espera: [], abertas: [], offline: [], bateriaFraca: [], sinalFraco: [], hojeKwh: null, ontemKwh: null };
    for (const ap of c.aparelhos?.values() ?? []) {
      const e = c.estado.get(ap.id);
      for (const canal of ap.canais.values()) {
        const v = e?.canais.get(canal.n)?.valor;
        const nome = canal.divisao ? `${canal.nome} (${canal.divisao})` : canal.nome;
        if ((canal.funcao === 'interruptor' || canal.funcao === 'luz') && v === 1) {
          if (ap.medidor && typeof e?.potenciaW === 'number' && e.potenciaW < limiar) d.espera.push(nome);
          else d.ligados.push(nome);
        } else if (canal.funcao === 'porta' && v === 1) d.abertas.push(nome);
        else if (canal.funcao === 'bateria' && typeof v === 'number') {
          const dias = estimarDiasBateria(e?.amostras ?? [], v);
          if (v < BATERIA_FRACA || (dias !== null && dias < BATERIA_DIAS_AVISO)) d.bateriaFraca.push(`${ap.nome} (${Math.round(v)} %)`);
        }
      }
      const offline = ap.bateria ? !!e?.ultimaNoticia && agora - e.ultimaNoticia > DIA_MS : e?.online === false;
      if (offline) d.offline.push(ap.nome);
      if (typeof e?.rssi === 'number' && e.rssi < RSSI_FRACO) d.sinalFraco.push(`${ap.nome} (${e.rssi} dBm)`);
    }
    if ([...(c.aparelhos?.values() ?? [])].some((ap) => ap.medidor)) {
      const en = this.calcularEnergia(c);
      d.hojeKwh = en.hoje_kwh;
      d.ontemKwh = en.ontem_kwh;
    }
    return textoRelatorio(d);
  },

  /** Relatório diário: notificação normal (tipo `aviso`, respeita o silêncio; não vai para o histórico). */
  enviarRelatorio(c) {
    const mensagem = this.relatorio(c);
    this.log.info(`[relatório] ${c.codigo}: enviado`);
    this.enviarNotificacao(c, { tipo: 'aviso', titulo: 'Relatório da casa', mensagem }, { prioridade: 'default' });
  },
};
