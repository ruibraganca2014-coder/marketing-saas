// Alertas técnicos calculados em direto a partir do MQTT (docs/PAINEL-EMPRESA.md §2–§3).
// O painel liga-se como utilizador "painel", que a ACL só deixa LER domus/#:
// este módulo nunca publica nada.
//
// Fontes (retidas, exceto _eventos): _aparelhos, _saude (PROTOCOLO-MQTT-v3 §5),
// _alarme, _modo, _plano, _eventos, <aparelho>/connected (OpenBeken) e
// <aparelho>/online (Shelly).

import mqtt from 'mqtt';
import { randomBytes } from 'node:crypto';
import { RE_ID } from './dados.js';
import { iso } from './util.js';

export const GRAVIDADES = { critica: 4, alta: 3, media: 2, baixa: 1 };
const TOPICOS = ['_aparelhos', '_saude', '_alarme', '_modo', '_plano', '_eventos'].map((t) => `domus/+/${t}`)
  .concat(['domus/+/+/connected', 'domus/+/+/online']);
const MAX_PAYLOAD = 256 * 1024;
const MAX_CLIENTES = 5000;
const MAX_APARELHOS = 300;
const MAX_EVENTOS = 20;
const SEM_NOTICIAS_BATERIA_MS = 24 * 3600_000;
const ARMADO = new Set(['a_armar', 'armado', 'entrada', 'disparado']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null);

function horas(ms) {
  const h = Math.floor(ms / 3600_000);
  return h >= 48 ? `${Math.floor(h / 24)} dias` : `${h} h`;
}

export class Alertas {
  constructor({ config, registo, relogio = () => Date.now() }) {
    this.config = config;
    this.registo = registo;
    this.relogio = relogio;
    this.casas = new Map();
    this.cli = null;
    this.ligadoDesde = null;
  }

  get ligado() {
    return Boolean(this.cli?.connected);
  }

  iniciar() {
    const { url, utilizador, senha } = this.config.mqtt;
    if (!senha) return;
    this.cli = mqtt.connect(url, {
      username: utilizador,
      password: senha,
      clientId: `domus-painel-${randomBytes(4).toString('hex')}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      protocolVersion: 4,
    });
    let avisado = false;
    this.cli.on('connect', () => {
      avisado = false;
      this.ligadoDesde = this.relogio();
      this.registo.info(`MQTT: ligado como ${utilizador} (só leitura)`);
      this.cli.subscribe(TOPICOS, { qos: 0 }, (e) => { if (e) this.registo.erro(`MQTT: subscrição: ${e.message}`); });
    });
    this.cli.on('error', (e) => {
      if (!avisado) this.registo.erro(`MQTT: ${e.message}`);
      avisado = true;
    });
    this.cli.on('message', (topico, msg, pacote) => {
      try {
        this.receber(topico, msg, pacote?.retain);
      } catch (e) {
        this.registo.aviso(`MQTT: mensagem ignorada em ${topico}: ${e.message}`);
      }
    });
  }

  fechar() {
    return this.cli ? this.cli.endAsync(true).catch(() => {}) : Promise.resolve();
  }

  #casa(c) {
    let casa = this.casas.get(c);
    if (!casa) {
      if (this.casas.size >= MAX_CLIENTES) return null;
      casa = { aparelhos: new Map(), saude: {}, alarme: null, modo: null, plano: null, ligacao: new Map(), eventos: [] };
      this.casas.set(c, casa);
    }
    return casa;
  }

  /** Trata uma mensagem (exposto para testes). */
  receber(topico, msg, retida = false) {
    if (msg.length > MAX_PAYLOAD) return;
    const p = topico.split('/');
    if (p[0] !== 'domus' || !RE_ID.test(p[1] || '')) return;
    const texto = msg.toString('utf8');
    const agora = this.relogio();
    if (p.length === 4 && (p[3] === 'connected' || p[3] === 'online')) {
      if (!RE_ID.test(p[2])) return;
      const casa = this.#casa(p[1]);
      if (!casa) return;
      if (!texto) { casa.ligacao.delete(p[2]); return; }
      const v = texto.trim().toLowerCase();
      const online = v === 'online' || v === 'true' || v === '1';
      const antes = casa.ligacao.get(p[2]);
      if (casa.ligacao.size >= MAX_APARELHOS && !antes) return;
      casa.ligacao.set(p[2], { online, desde: antes && antes.online === online ? antes.desde : agora });
      return;
    }
    if (p.length !== 3) return;
    const casa = this.#casa(p[1]);
    if (!casa) return;
    if (!texto) { // retida apagada
      if (p[2] === '_aparelhos') casa.aparelhos.clear();
      else if (p[2] === '_saude') casa.saude = {};
      else if (['_alarme', '_modo', '_plano'].includes(p[2])) casa[p[2].slice(1)] = null;
      return;
    }
    const v = JSON.parse(texto);
    switch (p[2]) {
      case '_aparelhos': {
        if (!Array.isArray(v)) return;
        casa.aparelhos = new Map();
        for (const a of v.slice(0, MAX_APARELHOS)) {
          if (!a || !RE_ID.test(a.id || '')) continue;
          const canais = Array.isArray(a.canais) ? a.canais : [];
          casa.aparelhos.set(a.id, {
            nome: txt(a.nome, 120) || a.id,
            bateria: a.bateria === true,
            alarme: canais.some((k) => k && (k.funcao === 'porta' || k.funcao === 'movimento')),
          });
        }
        return;
      }
      case '_saude': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return;
        const s = {};
        for (const [id, d] of Object.entries(v).slice(0, MAX_APARELHOS)) {
          if (!RE_ID.test(id) || !d || typeof d !== 'object') continue;
          s[id] = {
            online: typeof d.online === 'boolean' ? d.online : null,
            ultima_noticia: txt(d.ultima_noticia, 40),
            rssi: num(d.rssi),
            reinicios_24h: num(d.reinicios_24h),
            bateria: num(d.bateria),
            bateria_dias: num(d.bateria_dias),
            offline_desde: txt(d.offline_desde, 40),
          };
        }
        casa.saude = s;
        return;
      }
      case '_alarme':
        if (v && typeof v === 'object') casa.alarme = { estado: txt(v.estado, 20), tipo: txt(v.tipo, 20), desde: txt(v.desde, 40), ativo: v.ativo === true };
        return;
      case '_modo':
        if (v && typeof v === 'object') casa.modo = { modo: txt(v.modo, 20), desde: txt(v.desde, 40) };
        return;
      case '_plano':
        if (v && typeof v === 'object') casa.plano = { plano: txt(v.plano, 20), estado: txt(v.estado, 20) };
        return;
      case '_eventos': {
        if (retida || !v || typeof v !== 'object') return;
        casa.eventos.unshift({
          quando: txt(v.quando, 40) || txt(v.ts, 40) || iso(agora),
          tipo: txt(v.tipo, 32),
          texto: txt(v.texto, 300) || txt(v.mensagem, 300) || txt(v.titulo, 300),
          aparelho: RE_ID.test(v.aparelho || '') ? v.aparelho : null,
        });
        casa.eventos.length = Math.min(casa.eventos.length, MAX_EVENTOS);
        if (v.tipo === 'alarme' && (!casa.alarme || casa.alarme.estado !== 'disparado')) {
          casa.alarme = { ...(casa.alarme || {}), estado: 'disparado', desde: iso(agora) };
        }
        return;
      }
      default:
    }
  }

  /** Alertas de uma casa. */
  #daCasa(c, casa, agora) {
    const out = [];
    const add = (aparelho, tipo, gravidade, mensagem, extra = {}) => out.push({
      id: `${c}:${aparelho ?? '_'}:${tipo}`, cliente: c, aparelho,
      aparelho_nome: aparelho ? (casa.aparelhos.get(aparelho)?.nome ?? aparelho) : null,
      tipo, gravidade, mensagem, ...extra,
    });
    const armado = casa.alarme && ARMADO.has(casa.alarme.estado);
    if (casa.alarme?.estado === 'disparado') add(null, 'alarme_disparado', 'critica', 'Alarme disparado.', { desde: casa.alarme.desde });
    else if (casa.alarme?.estado === 'entrada') add(null, 'alarme_entrada', 'alta', 'Alarme em tempo de entrada (a aguardar desarme).', { desde: casa.alarme.desde });

    const ids = new Set([...casa.aparelhos.keys(), ...Object.keys(casa.saude), ...casa.ligacao.keys()]);
    for (const id of ids) {
      const ap = casa.aparelhos.get(id) || {};
      const s = casa.saude[id] || {};
      const lig = casa.ligacao.get(id);
      const bateria = ap.bateria === true || (s.bateria !== null && s.bateria !== undefined && !lig);
      const subir = (g) => (armado && ap.alarme ? ({ baixa: 'media', media: 'alta', alta: 'critica' }[g] || g) : g);
      const nota = armado && ap.alarme ? ' (sensor do alarme, alarme armado)' : '';
      if (!bateria) {
        const offline = lig ? !lig.online : s.online === false;
        if (offline) {
          const desde = s.offline_desde || (lig && !lig.online ? iso(lig.desde) : null);
          add(id, 'offline', subir('alta'), `Aparelho offline${nota}.`, { desde });
        }
      } else if (s.ultima_noticia) {
        const t = Date.parse(s.ultima_noticia);
        if (Number.isFinite(t) && agora - t > SEM_NOTICIAS_BATERIA_MS) {
          add(id, 'sem_noticias', subir('media'), `Sem notícias há ${horas(agora - t)}${nota}.`, { desde: s.ultima_noticia });
        }
      }
      if (s.bateria !== null && s.bateria !== undefined && s.bateria < 15) {
        add(id, 'bateria_fraca', subir('alta'), `Bateria fraca (${Math.round(s.bateria)} %).`, { valor: s.bateria });
      } else if (s.bateria_dias !== null && s.bateria_dias !== undefined && s.bateria_dias < 21) {
        add(id, 'bateria_dias', 'media', `Bateria acaba dentro de ~${Math.max(0, Math.round(s.bateria_dias))} dias.`, { valor: s.bateria_dias });
      }
      if (s.rssi !== null && s.rssi !== undefined && s.rssi < -80) {
        add(id, 'sinal_fraco', 'baixa', `Sinal Wi-Fi fraco (${Math.round(s.rssi)} dBm).`, { valor: s.rssi });
      }
      if (s.reinicios_24h !== null && s.reinicios_24h !== undefined && s.reinicios_24h > 5) {
        add(id, 'reinicios', 'media', `${Math.round(s.reinicios_24h)} reinícios nas últimas 24 h.`, { valor: s.reinicios_24h });
      }
    }
    return out;
  }

  /** Lista ordenada por gravidade (e cliente, aparelho). `cliente` filtra. */
  lista({ cliente } = {}) {
    const agora = this.relogio();
    let out = [];
    for (const [c, casa] of this.casas) {
      if (cliente && c !== cliente) continue;
      out = out.concat(this.#daCasa(c, casa, agora));
    }
    out.sort((a, b) => GRAVIDADES[b.gravidade] - GRAVIDADES[a.gravidade]
      || a.cliente.localeCompare(b.cliente) || String(a.aparelho ?? '').localeCompare(String(b.aparelho ?? '')));
    const contagem = { critica: 0, alta: 0, media: 0, baixa: 0 };
    for (const a of out) contagem[a.gravidade] += 1;
    return { ligado: this.ligado, atualizado: iso(agora), contagem, alertas: out };
  }

  /** Estado vivo de uma casa (ficha do cliente / ?cliente=). */
  casa(c) {
    const casa = this.casas.get(c);
    if (!casa) return null;
    return { alarme: casa.alarme, modo: casa.modo, plano: casa.plano, eventos: casa.eventos };
  }
}
