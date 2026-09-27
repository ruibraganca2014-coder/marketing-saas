// Modelo da casa a partir das mensagens MQTT — módulo puro (sem DOM, sem rede),
// para poder ser testado à parte. Protocolo: docs/PROTOCOLO-MQTT.md, PROTOCOLO-MQTT-v2.md e -v3.md.

export const FUNCOES = ["interruptor", "luz", "estore", "porta", "movimento", "bateria"];
export const CONTROLAVEIS = ["interruptor", "luz", "estore"];
export const CALOR_MAX_W = 3500;
export const SEM_NOTICIAS_MS = 24 * 3600 * 1000;
export const MOVIMENTO_ANIMA_MS = 3000;

const ID_RE = /^[a-z0-9-]+$/;
export const ID_AUTOMACAO_RE = /^[a-z0-9-]{1,40}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function numero(texto) {
  const n = parseFloat(texto);
  return Number.isFinite(n) ? n : null;
}
const inteiro0a100 = (v) => {
  const n = typeof v === "number" ? v : numero(v);
  return n == null ? null : Math.max(0, Math.min(100, Math.round(n)));
};
function json(texto) {
  try { return JSON.parse(texto); } catch { return undefined; }
}

// ---------- Lista de aparelhos ----------
// v1: sem `canais` → um único canal `interruptor` n.º 1 e medição sempre que chegue.
export function lerAparelhos(texto) {
  const bruto = typeof texto === "string" ? json(texto) : texto;
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set();
  const lista = [];
  for (const a of bruto) {
    if (!a || typeof a.id !== "string" || !ID_RE.test(a.id) || vistos.has(a.id)) continue;
    vistos.add(a.id);
    const nome = String(a.nome ?? a.id);
    const v1 = !Array.isArray(a.canais);
    let canais = [];
    if (v1) {
      canais = [{ n: 1, funcao: "interruptor", nome }];
    } else {
      const ns = new Set();
      for (const c of a.canais) {
        const n = Number(c?.n);
        if (!Number.isInteger(n) || n < 1 || n > 64 || ns.has(n) || !FUNCOES.includes(c?.funcao)) continue;
        ns.add(n);
        // v3 (§3): só se acrescentam os campos que vêm na mensagem.
        const extra = {};
        if (c.funcao === "porta" && c.entrada === true) extra.entrada = true;
        if ((c.funcao === "interruptor" || c.funcao === "luz") && c.simular === true) extra.simular = true;
        if (CONTROLAVEIS.includes(c.funcao) && c.carga === "perigosa") extra.carga = "perigosa";
        if (typeof c.divisao === "string" && c.divisao.trim()) extra.divisao = c.divisao.trim().slice(0, 40);
        canais.push({ n, funcao: c.funcao, nome: c.nome != null && String(c.nome).trim() ? String(c.nome) : nome, temNome: c.nome != null && String(c.nome).trim() !== "", ...extra });
      }
      canais.sort((x, y) => x.n - y.n);
    }
    const divisaoPropria = typeof a.divisao === "string" && a.divisao.trim() ? a.divisao.trim().slice(0, 40) : null;
    lista.push({
      id: a.id,
      nome,
      divisao: divisaoPropria ?? canais.find((c) => c.divisao)?.divisao ?? null,
      tipo: a.tipo === "shelly" ? "shelly" : "openbeken",
      medidor: a.medidor === true,
      // v3 §11: contador da casa inteira (só conta com `medidor`).
      geral: a.medidor === true && a.geral === true,
      bateria: a.bateria === true,
      v1,
      canais: canais.map((c) => ({ ...c, temNome: !!c.temNome })),
    });
  }
  return lista;
}

// ---------- Estado por aparelho ----------
// estados: id → { online, ultimaNoticia, potenciaW, tensaoV, correnteA, energiaKWh, canais: { n → {...} } }
function canalEstado(e, n) {
  e.canais ??= {};
  return (e.canais[n] ??= {});
}

// Aplica um valor a um canal; devolve true se o valor mudou.
function definir(ce, campo, valor, agora, vivo) {
  if (valor == null) return false;
  const antes = ce[campo];
  ce[campo] = valor;
  if (antes !== valor && vivo && antes !== undefined) ce.ultimaMudanca = agora;
  if (antes !== valor && vivo && campo === "movimento" && valor === true) ce.ultimoMovimento = agora;
  return antes !== valor;
}

function valorOpenBeken(ce, funcao, texto, agora, vivo) {
  const t = texto.trim();
  switch (funcao) {
    case "interruptor":
    case "luz": return definir(ce, "ligado", t === "1" || t.toLowerCase() === "on", agora, vivo);
    case "porta": return definir(ce, "aberto", t === "1", agora, vivo);
    case "movimento": return definir(ce, "movimento", t === "1", agora, vivo);
    case "bateria": return definir(ce, "bateria", inteiro0a100(t), agora, vivo);
    case "estore": return definir(ce, "posicao", inteiro0a100(t), agora, vivo);
  }
  return false;
}

/**
 * Aplica uma mensagem MQTT ao estado.
 * @param estados  objeto mutável id → estado
 * @param aparelho entrada de lerAparelhos (ou undefined se ainda não se conhece a lista)
 * @param resto    tópico a partir do prefixo do aparelho (ex. "2/get")
 * @param opts     { agora: ms, retido: bool }
 * @returns { canal: n | null, campo: string | null } se algo foi reconhecido, senão null
 */
export function aplicarMensagem(estados, id, aparelho, resto, texto, { agora = Date.now(), retido = false } = {}) {
  const e = (estados[id] ??= { canais: {} });
  const vivo = !retido;
  const funcaoDe = (n) => aparelho?.canais.find((c) => c.n === n)?.funcao ?? (n === 1 && (!aparelho || aparelho.v1) ? "interruptor" : null);
  let r = null;

  // Estado de ligação
  if (resto === "connected") { e.online = texto.trim() === "online"; r = { canal: null, campo: "online" }; }
  else if (resto === "online") { e.online = texto.trim() === "true"; r = { canal: null, campo: "online" }; }
  // OpenBeken: medição
  else if (resto === "power/get") { e.potenciaW = numero(texto); r = { canal: null, campo: "potenciaW" }; }
  else if (resto === "voltage/get") { e.tensaoV = numero(texto); r = { canal: null, campo: "tensaoV" }; }
  else if (resto === "current/get") { e.correnteA = numero(texto); r = { canal: null, campo: "correnteA" }; }
  else if (resto === "energycounter/get") { const wh = numero(texto); e.energiaKWh = wh == null ? null : wh / 1000; r = { canal: null, campo: "energiaKWh" }; }
  // OpenBeken: canais
  else if (/^\d+\/get$/.test(resto)) {
    const n = parseInt(resto, 10);
    const f = funcaoDe(n);
    if (!f) return null;
    valorOpenBeken(canalEstado(e, n), f, texto, agora, vivo);
    r = { canal: n, campo: f };
  } else if (resto === "led_dimmer/get") {
    const c = aparelho?.canais.find((x) => x.funcao === "luz");
    if (!c) return null;
    definir(canalEstado(e, c.n), "brilho", inteiro0a100(texto), agora, vivo);
    r = { canal: c.n, campo: "brilho" };
  }
  // Shelly
  else {
    const m = /^status\/(switch|light|cover|input|devicepower):(\d+)$/.exec(resto);
    if (!m) return null;
    const s = json(texto);
    if (!s || typeof s !== "object") return null;
    const comp = m[1];
    const idc = parseInt(m[2], 10);
    // Medição: switch:0 (v1 e aparelhos com medidor)
    if (comp === "switch" && idc === 0) {
      if (typeof s.apower === "number") e.potenciaW = s.apower;
      if (typeof s.voltage === "number") e.tensaoV = s.voltage;
      if (typeof s.current === "number") e.correnteA = s.current;
      if (typeof s.aenergy?.total === "number") e.energiaKWh = s.aenergy.total / 1000;
    }
    if (comp === "devicepower") {
      const c = aparelho?.canais.find((x) => x.funcao === "bateria");
      const p = s.battery?.percent;
      if (c && typeof p === "number") { definir(canalEstado(e, c.n), "bateria", inteiro0a100(p), agora, vivo); r = { canal: c.n, campo: "bateria" }; }
      else r = { canal: null, campo: null };
    } else {
      const n = idc + 1;
      const f = funcaoDe(n);
      const ce = canalEstado(e, n);
      if (comp === "switch" && (f === "interruptor" || f === "luz")) {
        if (typeof s.output === "boolean") definir(ce, "ligado", s.output, agora, vivo);
        r = { canal: n, campo: f };
      } else if (comp === "light" && (f === "luz" || f === "interruptor")) {
        if (typeof s.output === "boolean") definir(ce, "ligado", s.output, agora, vivo);
        if (typeof s.brightness === "number") definir(ce, "brilho", inteiro0a100(s.brightness), agora, vivo);
        r = { canal: n, campo: f };
      } else if (comp === "cover" && f === "estore") {
        if (typeof s.current_pos === "number") definir(ce, "posicao", inteiro0a100(s.current_pos), agora, vivo);
        if (typeof s.state === "string") ce.movimentoEstore = s.state;
        ce.alvo = typeof s.target_pos === "number" ? inteiro0a100(s.target_pos) : null;
        r = { canal: n, campo: f };
      } else if (comp === "input" && (f === "porta" || f === "movimento")) {
        if (typeof s.state === "boolean") definir(ce, f === "porta" ? "aberto" : "movimento", s.state, agora, vivo);
        r = { canal: n, campo: f };
      } else {
        r = comp === "switch" && idc === 0 ? { canal: null, campo: "potenciaW" } : null;
      }
    }
  }
  if (r && vivo) e.ultimaNoticia = agora;
  return r;
}

// Última notícia conhecida a partir do histórico do motor (para mensagens retidas antigas).
// Só eventos que vêm de uma mensagem do próprio aparelho (sensor, alarme) são sinal de vida:
// os avisos do motor ("Sem notícias", "Pilhas a acabar", "Aparelho offline"…) também trazem
// `aparelho` mas dizem precisamente o contrário.
const EVENTOS_DE_VIDA = ["sensor", "alarme"];
export function notarHistorico(estados, eventos) {
  for (const ev of eventos) {
    if (typeof ev.aparelho !== "string" || !EVENTOS_DE_VIDA.includes(ev.tipo)) continue;
    const t = typeof ev.ts === "number" ? ev.ts : Date.parse(ev.ts);
    if (!Number.isFinite(t)) continue;
    const e = (estados[ev.aparelho] ??= { canais: {} });
    if (!(e.ultimaNoticiaHistorico >= t)) e.ultimaNoticiaHistorico = t;
  }
}

// `_saude` (v3 §5) é a fonte de verdade da última notícia quando existe (o motor vê todas as
// mensagens, incluindo as que não geram eventos no histórico). Substitui o valor anterior.
export function notarSaude(estados, saude) {
  for (const [id, x] of Object.entries(saude ?? {})) {
    const e = (estados[id] ??= { canais: {} });
    e.ultimaNoticiaSaude = typeof x?.ultimaNoticia === "number" ? x.ultimaNoticia : null;
  }
}

// ---------- Modelo normalizado ----------
export function modelo(a, e = {}, agora = Date.now(), limiarEsperaW = LIMIAR_ESPERA_W) {
  // Com `_saude`, o histórico deixa de contar (só as mensagens ao vivo, que podem ser mais recentes).
  const ultima = (e.ultimaNoticiaSaude != null
    ? Math.max(e.ultimaNoticia ?? 0, e.ultimaNoticiaSaude)
    : Math.max(e.ultimaNoticia ?? 0, e.ultimaNoticiaHistorico ?? 0)) || null;
  const temMedicao = a.medidor || (a.v1 && [e.potenciaW, e.tensaoV, e.correnteA, e.energiaKWh].some((v) => v != null));
  const m = {
    id: a.id,
    nome: a.nome,
    tipo: a.tipo,
    divisao: a.divisao ?? null,
    medidor: a.medidor,
    geral: !!a.geral,
    temMedicao,
    bateria: a.bateria,
    online: !!e.online,
    ultimaNoticia: ultima,
    semNoticias: a.bateria && (ultima == null ? false : agora - ultima > SEM_NOTICIAS_MS),
    potenciaW: temMedicao ? e.potenciaW ?? null : null,
    tensaoV: temMedicao ? e.tensaoV ?? null : null,
    correnteA: temMedicao ? e.correnteA ?? null : null,
    energiaKWh: temMedicao ? e.energiaKWh ?? null : null,
    canais: a.canais.map((c) => {
      const ce = e.canais?.[c.n] ?? {};
      const m = { n: c.n, funcao: c.funcao, nome: c.nome, temNome: c.temNome, ultimaMudanca: ce.ultimaMudanca ?? null };
      if (c.funcao === "interruptor" || c.funcao === "luz") m.ligado = ce.ligado ?? null;
      if (c.funcao === "luz") m.brilho = ce.brilho ?? null;
      if (c.funcao === "estore") { m.posicao = ce.posicao ?? null; m.movimentoEstore = ce.movimentoEstore ?? null; m.alvo = ce.alvo ?? null; }
      if (c.funcao === "porta") m.aberto = ce.aberto ?? null;
      if (c.funcao === "movimento") {
        m.movimento = ce.movimento ?? null;
        m.animar = !!ce.ultimoMovimento && agora - ce.ultimoMovimento < MOVIMENTO_ANIMA_MS;
      }
      if (c.funcao === "bateria") m.bateria = ce.bateria ?? null;
      m.divisao = c.divisao ?? a.divisao ?? null;
      if (c.carga) m.carga = c.carga;
      return m;
    }),
  };
  for (const c of m.canais) if (c.funcao === "interruptor" || c.funcao === "luz") c.emEspera = emEspera(m, c, limiarEsperaW);
  return m;
}

// v3 §6: canal ligado de um aparelho com medição mas a gastar menos do que o limiar → "em espera".
export const LIMIAR_ESPERA_W = 5;
export function emEspera(m, c, limiarW = LIMIAR_ESPERA_W) {
  return !!(m?.temMedicao && c?.ligado === true && typeof m.potenciaW === "number" && m.potenciaW < (limiarW ?? LIMIAR_ESPERA_W));
}

// Pode ser controlado agora? Aparelhos a pilhas não se consideram offline.
export const disponivel = (m) => m.bateria || m.online;

// ---------- Resumo e fundo vivo ----------
// v3 §11: se houver contadores gerais, o consumo da casa é só a soma deles (como o motor);
// senão, a soma de todos os medidores.
export function contaParaTotal(m, modelos) {
  return modelos.some((x) => x.geral) ? !!m.geral : true;
}
export function resumo(modelos, alarme) {
  let potenciaW = 0, ligados = 0, circuitos = 0, portasAbertas = 0, portas = 0, online = 0, comLigacao = 0;
  const haGeral = modelos.some((x) => x.geral);
  for (const m of modelos) {
    if (m.temMedicao && m.potenciaW != null && (!haGeral || m.geral)) potenciaW += m.potenciaW;
    if (!m.bateria) { comLigacao++; if (m.online) online++; }
    for (const c of m.canais) {
      if (c.funcao === "interruptor" || c.funcao === "luz") { circuitos++; if (c.ligado) ligados++; }
      if (c.funcao === "porta") { portas++; if (c.aberto) portasAbertas++; }
    }
  }
  return { potenciaW, ligados, circuitos, portasAbertas, portas, online, comLigacao, alarme: alarme?.ativo ?? null };
}

export function fundoVivo(r) {
  const limitar = (v) => Math.max(0, Math.min(1, v));
  return {
    calor: limitar(r.potenciaW / CALOR_MAX_W),
    luzes: r.circuitos ? limitar(r.ligados / r.circuitos) : 0,
    alarme: r.alarme ? 1 : 0,
  };
}

// ---------- Alarme, automações, eventos, ntfy ----------
// v2: {ativo, desde}; v3 (§2): + estado, tipo, ate, ignorados, por.
export const ESTADOS_ALARME = ["desarmado", "a_armar", "armado", "entrada", "disparado"];
export function lerAlarme(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object") return null;
  const v3 = ESTADOS_ALARME.includes(v.estado);
  if (!v3 && typeof v.ativo !== "boolean") return null;
  const ms = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : null; };
  const estado = v3 ? v.estado : v.ativo ? "armado" : "desarmado";
  return {
    ativo: typeof v.ativo === "boolean" ? v.ativo : estado !== "desarmado",
    desde: ms(v.desde),
    v3,
    estado,
    tipo: v.tipo === "perimetro" ? "perimetro" : v.tipo === "total" ? "total" : null,
    ate: ms(v.ate),
    ignorados: Array.isArray(v.ignorados) ? v.ignorados.filter((x) => x && typeof x.aparelho === "string").map((x) => ({ aparelho: x.aparelho, canal: Number.isInteger(x.canal) ? x.canal : null })) : [],
    por: typeof v.por === "string" ? v.por : null,
  };
}

// ---------- v3: modo, configuração, energia, saúde, cenas, registo, avisos ----------
export const MODOS = ["casa", "fora", "noite", "ferias"];
export const NOME_MODO = { casa: "Casa", fora: "Fora", noite: "Noite", ferias: "Férias" };
export function lerModo(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || !MODOS.includes(v.modo)) return null;
  const desde = Date.parse(v.desde);
  return { modo: v.modo, desde: Number.isFinite(desde) ? desde : null, por: typeof v.por === "string" ? v.por : null };
}

export const CONFIG_OMISSAO = {
  atraso_saida_s: 30, atraso_entrada_s: 30, silencio: null, limiar_espera_w: 5,
  offline_min: 30, pausa_manual_min: 60, local: null, relatorio_diario: null,
};
export function lerConfig(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const c = { ...CONFIG_OMISSAO };
  const num = (k) => { if (typeof v[k] === "number" && Number.isFinite(v[k])) c[k] = v[k]; };
  ["atraso_saida_s", "atraso_entrada_s", "limiar_espera_w", "offline_min", "pausa_manual_min"].forEach(num);
  if (Array.isArray(v.silencio) && v.silencio.length === 2 && v.silencio.every((h) => HORA_RE.test(h))) c.silencio = [...v.silencio];
  if (v.local && typeof v.local.lat === "number" && typeof v.local.lon === "number") c.local = { lat: v.local.lat, lon: v.local.lon };
  if (typeof v.relatorio_diario === "string" && HORA_RE.test(v.relatorio_diario)) c.relatorio_diario = v.relatorio_diario;
  return c;
}

// Diferença entre a configuração atual e a pedida → objeto parcial para `_config/set` (§1).
export function configParcial(atual, pedida) {
  const base = atual ?? CONFIG_OMISSAO;
  const r = {};
  for (const k of Object.keys(CONFIG_OMISSAO)) {
    if (!(k in pedida)) continue;
    if (JSON.stringify(pedida[k]) !== JSON.stringify(base[k] ?? null)) r[k] = pedida[k];
  }
  return r;
}

export function validarConfig(c) {
  const erros = [];
  const inteiro = (k, min, max, rot) => {
    if (!(k in c)) return;
    if (!Number.isInteger(c[k]) || c[k] < min || c[k] > max) erros.push(`${rot}: de ${min} a ${max}.`);
  };
  inteiro("atraso_saida_s", 0, 300, "Tempo para sair");
  inteiro("atraso_entrada_s", 0, 300, "Tempo para desarmar ao entrar");
  inteiro("limiar_espera_w", 0, 100, "Limiar de \"em espera\" (W)");
  inteiro("offline_min", 1, 1440, "Aviso de aparelho offline (min)");
  inteiro("pausa_manual_min", 0, 480, "Pausa depois de mexer à mão (min)");
  if ("silencio" in c && c.silencio !== null && !(Array.isArray(c.silencio) && c.silencio.length === 2 && c.silencio.every((h) => HORA_RE.test(h)))) erros.push("Horas de silêncio inválidas (HH:MM).");
  if ("relatorio_diario" in c && c.relatorio_diario !== null && !HORA_RE.test(c.relatorio_diario ?? "")) erros.push("Hora do relatório inválida (HH:MM).");
  if ("local" in c && c.local !== null) {
    const { lat, lon } = c.local ?? {};
    if (!(typeof lat === "number" && lat >= -90 && lat <= 90) || !(typeof lon === "number" && lon >= -180 && lon <= 180)) erros.push("Localização inválida (latitude −90 a 90, longitude −180 a 180).");
  }
  return erros;
}

// Cidades para "usar a localização desta cidade" (a geolocalização do navegador nem sempre existe).
export const CIDADES = [
  { nome: "Lisboa", lat: 38.72, lon: -9.14 },
  { nome: "Porto", lat: 41.15, lon: -8.61 },
  { nome: "Braga", lat: 41.55, lon: -8.42 },
  { nome: "Coimbra", lat: 40.21, lon: -8.43 },
  { nome: "Faro", lat: 37.02, lon: -7.93 },
  { nome: "Funchal", lat: 32.65, lon: -16.91 },
  { nome: "Ponta Delgada", lat: 37.74, lon: -25.67 },
];

export function lerEnergia(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object") return null;
  const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const aparelhos = {};
  if (v.aparelhos && typeof v.aparelhos === "object") {
    for (const [id, x] of Object.entries(v.aparelhos)) if (x && typeof x === "object") aparelhos[id] = { hojeKWh: n(x.hoje_kwh), ontemKWh: n(x.ontem_kwh) };
  }
  return { hojeKWh: n(v.hoje_kwh), ontemKWh: n(v.ontem_kwh), mesKWh: n(v.mes_kwh), aparelhos };
}

export function lerSaude(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const ms = (x) => { const t = typeof x === "string" ? Date.parse(x) : NaN; return Number.isFinite(t) ? t : null; };
  const r = {};
  for (const [id, x] of Object.entries(v)) {
    if (!x || typeof x !== "object") continue;
    r[id] = {
      online: typeof x.online === "boolean" ? x.online : null,
      ultimaNoticia: ms(x.ultima_noticia),
      rssi: n(x.rssi),
      uptimeS: n(x.uptime_s),
      reinicios24h: n(x.reinicios_24h),
      bateria: n(x.bateria),
      bateriaDias: n(x.bateria_dias),
      offlineDesde: ms(x.offline_desde),
    };
  }
  return r;
}

// Barras de sinal Wi-Fi a partir do RSSI (dBm).
export function sinal(rssi) {
  if (typeof rssi !== "number" || !Number.isFinite(rssi)) return null;
  if (rssi >= -60) return { barras: 4, texto: "Excelente", nivel: "excelente" };
  if (rssi >= -70) return { barras: 3, texto: "Bom", nivel: "bom" };
  if (rssi >= -80) return { barras: 2, texto: "Fraco", nivel: "fraco" };
  return { barras: 1, texto: "Muito fraco", nivel: "muito-fraco" };
}

export const ICONES_CENA = ["filme", "sol", "lua", "porta", "casa", "energia", "luz", "estrela"];
export function lerCenas(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  return Array.isArray(v) ? v.filter((c) => c && typeof c === "object" && typeof c.id === "string" && Array.isArray(c.acoes)) : null;
}

export const RESULTADOS = { executada: "Executada", condicao_falsa: "Condição falsa", falhou: "Falhou", pausada: "Em pausa", teste: "Teste", avaliacao: "Avaliação" };
// Registo do motor: {"<id>": {ultima, resultado, motivo, semana, teste?, ok?, ultimos:[{ts, resultado, motivo, teste?, ok?}]}}.
// "Avaliar agora" chega como resultado "avaliacao" com ok true/false; separamo-lo da última execução real.
export function lerRegisto(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const ms = (x) => { const t = typeof x === "string" ? Date.parse(x) : NaN; return Number.isFinite(t) ? t : null; };
  const entrada = (u) => ({ ts: ms(u.ts ?? u.ultima), resultado: typeof u.resultado === "string" ? u.resultado : "", motivo: typeof u.motivo === "string" ? u.motivo : "", teste: u.teste === true, ok: typeof u.ok === "boolean" ? u.ok : null });
  const r = {};
  for (const [id, x] of Object.entries(v)) {
    if (!x || typeof x !== "object") continue;
    const ultimos = Array.isArray(x.ultimos) ? x.ultimos.filter((u) => u && typeof u === "object").slice(0, 20).map(entrada) : [];
    const topo = entrada(x);
    const todos = topo.ts != null ? [topo, ...ultimos.filter((u) => !(u.ts === topo.ts && u.resultado === topo.resultado))] : ultimos;
    const exec = todos.find((u) => u.resultado && u.resultado !== "avaliacao") ?? null;
    let av = todos.find((u) => u.resultado === "avaliacao") ?? null;
    let avaliacao = av ? { ts: av.ts, verdadeira: av.ok, motivo: av.motivo } : null;
    // Forma alternativa aceite: {"avaliacao": {ts, verdadeira|ok, motivo}}
    if (x.avaliacao && typeof x.avaliacao === "object") {
      const o = x.avaliacao;
      avaliacao = { ts: ms(o.ts), verdadeira: typeof o.verdadeira === "boolean" ? o.verdadeira : typeof o.ok === "boolean" ? o.ok : null, motivo: typeof o.motivo === "string" ? o.motivo : "" };
    }
    r[id] = {
      ultima: exec?.ts ?? null,
      resultado: exec?.resultado || null,
      motivo: exec?.motivo ?? "",
      teste: exec?.teste === true || exec?.resultado === "teste",
      semana: typeof x.semana === "number" ? x.semana : null,
      ultimos,
      avaliacao,
    };
  }
  return r;
}

export function lerAvisos(texto) {
  const v = typeof texto === "string" ? json(texto) : texto;
  return Array.isArray(v) ? v.filter((x) => x && Array.isArray(x.ids) && typeof x.mensagem === "string").map((x) => ({ ids: x.ids.map(String), mensagem: x.mensagem })) : [];
}

export function lerNtfy(texto) {
  const v = json(texto);
  if (!v || typeof v.url !== "string" || !/^https?:\/\/\S+$/i.test(v.url)) return null;
  return { url: v.url };
}

const TIPOS_EVENTO = ["alarme", "sensor", "automacao", "aviso", "erro", "modo"];
export function lerEvento(v) {
  if (typeof v === "string") v = json(v);
  if (!v || typeof v !== "object") return null;
  const ts = Date.parse(v.ts);
  return {
    ts: Number.isFinite(ts) ? ts : null,
    tsTexto: typeof v.ts === "string" ? v.ts : "",
    tipo: TIPOS_EVENTO.includes(v.tipo) ? v.tipo : "aviso",
    titulo: String(v.titulo ?? ""),
    mensagem: String(v.mensagem ?? ""),
    aparelho: typeof v.aparelho === "string" ? v.aparelho : undefined,
  };
}
export function lerHistorico(texto) {
  const v = json(texto);
  return Array.isArray(v) ? v.map(lerEvento).filter(Boolean) : [];
}
// Junta eventos ao vivo com o histórico retido, sem repetidos, mais recente primeiro.
export function juntarEventos(historico, vivos, max = 100) {
  const chave = (e) => `${e.tsTexto}|${e.tipo}|${e.titulo}|${e.mensagem}`;
  const vistos = new Set();
  const todos = [];
  for (const e of [...vivos, ...historico]) {
    const k = chave(e);
    if (vistos.has(k)) continue;
    vistos.add(k);
    todos.push(e);
  }
  todos.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return todos.slice(0, max);
}

export function lerAutomacoes(texto) {
  const v = json(texto);
  return Array.isArray(v) ? v.filter((a) => a && typeof a === "object" && typeof a.id === "string") : null;
}

// "Luz do corredor" → "luz-do-corredor", único entre `existentes`.
export function slug(nome, existentes = []) {
  let base = String(nome ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 34).replace(/-+$/, "");
  if (!base) base = "automacao";
  const usados = new Set(existentes);
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) {
    const s = `${base}-${i}`;
    if (!usados.has(s)) return s;
  }
}

// JSON com as chaves ordenadas — para comparar listas independentemente da ordem dos campos
// (o motor normaliza e pode reordenar).
export function jsonCanonico(v) {
  const ord = (x) => (Array.isArray(x) ? x.map(ord) : x && typeof x === "object"
    ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, ord(x[k])])) : x);
  return JSON.stringify(ord(v));
}

// ---------- Validação (o motor volta a validar; aqui só se evita publicar o que ele recusaria) ----------
export const CATEGORIAS = ["conveniencia", "energia", "seguranca", "conforto", "rotina"];
export const NOME_CATEGORIA = { conveniencia: "Conveniência", energia: "Poupança de energia", seguranca: "Segurança", conforto: "Conforto", rotina: "Rotina" };
export const EVENTOS_SISTEMA = ["aparelho_offline", "aparelho_online", "energia_reposta"];
export const MAX_ACOES = 20;
export const MAX_NIVEIS_SE = 2;
export const MAX_PERIGOSA_S = 4 * 3600;
// Limites do motor (motor/src/validacao.js), repetidos aqui para dar a mensagem antes de publicar.
export const MAX_DURACAO_S = 24 * 3600;
export const MAX_NOME = 80;
export const MAX_MENSAGEM = 200;
export const MAX_CONDICOES_APARELHOS = 10;

// Total de ações, contando as que estão dentro de SE/SENÃO.
export function contarAcoes(lista) {
  let n = 0;
  for (const x of Array.isArray(lista) ? lista : []) {
    n++;
    if (x?.acao === "se") n += contarAcoes(x.entao) + contarAcoes(x.senao);
  }
  return n;
}

function acharCanal(aparelhos, id, n) {
  const a = aparelhos.find((x) => x.id === id);
  return { a, c: a?.canais.find((x) => x.n === n) };
}
export function nomeCanal(aparelhos, id, n) {
  const { a, c } = acharCanal(aparelhos, id, n);
  if (!a) return id ?? "?";
  // Canal com o mesmo nome do aparelho: não repetir ("Porta de entrada · Porta de entrada").
  if (c?.temNome && c.nome === a.nome) return a.nome;
  return c && c.temNome && a.canais.length > 1 ? `${a.nome} · ${c.nome}` : c?.temNome ? c.nome : a.nome;
}

// ---------- Ações arriscadas (confirmação antes de guardar / executar) ----------
const semAcentos = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O canal é o disjuntor geral da casa? Se algum aparelho estiver marcado `geral` (v3 §11), só
 * esses contam; senão, qualquer canal de um aparelho com medição cujo nome ou divisão (do
 * aparelho ou do canal) fale em "geral" ou "quadro" (sem distinguir maiúsculas nem acentos).
 */
export function ehGeral(aparelhos, id, n) {
  const { a, c } = acharCanal(aparelhos, id, n);
  if (!a) return false;
  if (aparelhos.some((x) => x.geral)) return !!a.geral;
  if (!a.medidor) return false;
  return /geral|quadro/.test(semAcentos([a.nome, a.divisao, c?.nome, c?.divisao].filter(Boolean).join(" ")));
}

// "o Quadro geral", "a Bomba de calor", "as Tomadas" — artigo pela primeira palavra (heurística).
export function comArtigo(nome) {
  const t = String(nome ?? "");
  const p = semAcentos(t).split(/\s+/)[0] ?? "";
  let art = "";
  if (/^(luzes|tvs)$/.test(p) || /as$/.test(p)) art = "as";
  else if (/^(luz|tv|televisao)$/.test(p) || /(a|cao|dade|gem)$/.test(p)) art = "a";
  else if (/(os|es)$/.test(p)) art = "os";
  else if (/^[a-z]/.test(p)) art = "o";
  return art ? `${art} ${t}` : t;
}

const LIGA_DESLIGA = ["ligar", "desligar", "alternar", "luz"];
/**
 * Ações que mexem no disjuntor geral (qualquer ligar/desligar/alternar/luz) ou que ligam uma carga
 * perigosa (desligar uma carga perigosa não é arriscado), incluindo as de dentro de SE/SENÃO e as
 * das cenas chamadas com {acao:"cena"} (expandidas com a lista retida `_cenas`, também cenas dentro
 * de cenas, com proteção contra ciclos). Linhas com o mesmo texto aparecem uma só vez.
 * @param {object[]} lista ações
 * @param {object[]} aparelhos lerAparelhos
 * @param {{cenas?: object[]}} [opcoes] cenas: lista retida `_cenas` (para expandir as ações "cena")
 * @returns {{acao: object, tipo: "geral"|"perigosa", texto: string, caminho: string}[]}
 *   caminho: posição da ação no formulário ("2", "3.então.1"); para as que vêm de uma cena, a da ação "cena".
 */
export function acoesArriscadas(lista, aparelhos = [], { cenas = [] } = {}) {
  const r = [];
  const vistos = new Set();
  const percorrer = (acoes, { caminho = "", ramo = null, via = [], fixo = null, visitadas = new Set() }) => {
    for (const [i, x] of (Array.isArray(acoes) ? acoes : []).entries()) {
      const aqui = caminho ? `${caminho}.${i + 1}` : `${i + 1}`;
      const pos = fixo ?? aqui;
      if (x?.acao === "se") {
        percorrer(x.entao, { caminho: `${aqui}.então`, ramo: "então", via, fixo, visitadas });
        percorrer(x.senao, { caminho: `${aqui}.senão`, ramo: "senão", via, fixo, visitadas });
        continue;
      }
      if (x?.acao === "cena") {
        const c = (Array.isArray(cenas) ? cenas : []).find((k) => k?.id === x.cena);
        if (!c || visitadas.has(c.id)) continue; // cena desconhecida, ou ciclo
        percorrer(c.acoes, { caminho: aqui, ramo, via: [...via, String(c.nome ?? c.id)], fixo: pos, visitadas: new Set([...visitadas, c.id]) });
        continue;
      }
      if (!LIGA_DESLIGA.includes(x?.acao) || !x.aparelho || !Number.isInteger(x.canal)) continue;
      const { a, c } = acharCanal(aparelhos, x.aparelho, x.canal);
      if (!a) continue;
      // Apagar = desligar, ou luz a 0 %.
      const apaga = x.acao === "desligar" || (x.acao === "luz" && x.brilho === 0);
      const dur = x.durante_s ? ` durante ${duracao(x.durante_s)}` : "";
      // De onde vem: ramo do SE mais interior e a cena (a mais exterior, que é a que se escolheu).
      const partes = [];
      if (ramo) partes.push(`no ${ramo === "senão" ? "SENÃO" : "ENTÃO"} de um SE`);
      if (via.length) partes.push(`pela cena "${via[0]}"`);
      const onde = partes.length ? ` (${partes.join(", ")})` : "";
      let tipo = null, texto = "";
      if (ehGeral(aparelhos, x.aparelho, x.canal)) {
        tipo = "geral";
        const quem = comArtigo(a.canais.length === 1 ? a.nome : nomeCanal(aparelhos, x.aparelho, x.canal));
        if (apaga) texto = `Desligar ${quem}${dur}${onde} — a casa inteira fica sem luz.`;
        else if (x.acao === "alternar") texto = `Alternar ${quem}${onde} — se estiver ligado, a casa inteira fica sem luz.`;
        else if (x.durante_s) texto = `Ligar ${quem}${dur}${onde} — no fim desliga-se e a casa inteira fica sem luz.`;
        else texto = `Ligar ${quem}${onde} — dá corrente à casa inteira.`;
      } else if (c?.carga === "perigosa" && !apaga) {
        tipo = "perigosa";
        const quem = comArtigo(nomeCanal(aparelhos, x.aparelho, x.canal));
        const verbo = x.acao === "alternar" ? "Alternar" : "Ligar";
        texto = `${verbo} ${quem} (carga perigosa)${dur}${onde}.`;
      }
      if (tipo && !vistos.has(texto)) { vistos.add(texto); r.push({ acao: x, tipo, texto, caminho: pos }); }
    }
  };
  percorrer(lista, {});
  return r;
}

function validarCondicoes(se, erros, aparelhos, rot = "Condições") {
  const p = `${rot}: `;
  if (se == null) return;
  if (typeof se !== "object" || Array.isArray(se)) { erros.push(`${p}condições inválidas.`); return; }
  if ("alarme" in se && typeof se.alarme !== "boolean") erros.push(`${p}condição de alarme inválida.`);
  if (se.entre && (!Array.isArray(se.entre) || se.entre.length !== 2 || !se.entre.every((h) => HORA_RE.test(h)))) erros.push(`${p}horário inválido (HH:MM).`);
  else if (se.entre && se.entre[0] === se.entre[1]) erros.push(`${p}o horário tem de começar e acabar a horas diferentes.`);
  if ("dias" in se && (!Array.isArray(se.dias) || se.dias.length === 0 || se.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) erros.push(`${p}escolha pelo menos um dia.`);
  if ("sol" in se && se.sol !== "dia" && se.sol !== "noite") erros.push(`${p}condição de sol inválida.`);
  if ("modo" in se && (!Array.isArray(se.modo) || se.modo.length === 0 || se.modo.some((m) => !MODOS.includes(m)))) erros.push(`${p}escolha pelo menos um modo.`);
  if ("presenca" in se && se.presenca !== "alguem" && se.presenca !== "ninguem") erros.push(`${p}condição de presença inválida.`);
  if ("aparelhos" in se) {
    if (!Array.isArray(se.aparelhos) || se.aparelhos.length === 0) erros.push(`${p}estado de aparelhos inválido.`);
    else if (se.aparelhos.length > MAX_CONDICOES_APARELHOS) erros.push(`${p}no máximo ${MAX_CONDICOES_APARELHOS} aparelhos nas condições.`);
    else for (const x of se.aparelhos) {
      if (!x?.aparelho || !Number.isInteger(x.canal) || (x.valor !== 0 && x.valor !== 1)) { erros.push(`${p}escolha o aparelho e o estado.`); break; }
    }
  }
}

function validarAcoes(lista, erros, ctx, nivel = 0, prefixo = "") {
  for (const [i, x] of (lista ?? []).entries()) {
    const n = prefixo ? `${prefixo}.${i + 1}` : `${i + 1}`;
    const { c } = x?.aparelho ? acharCanal(ctx.aparelhos, x.aparelho, x.canal) : {};
    const perigosa = c?.carga === "perigosa";
    const nome = () => nomeCanal(ctx.aparelhos, x.aparelho, x.canal);
    if (x?.acao === "ligar" || x?.acao === "desligar") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha o circuito.`);
      if (x.durante_s != null && !(Number.isInteger(x.durante_s) && x.durante_s > 0)) erros.push(`Ação ${n}: duração inválida.`);
      else if (x.durante_s != null && x.durante_s > MAX_DURACAO_S) erros.push(`Ação ${n}: no máximo 24 h (1440 minutos).`);
      else if (x.acao === "ligar" && perigosa && x.durante_s == null) erros.push(`Ação ${n}: ${nome()} é uma carga perigosa — indique durante quanto tempo fica ligada (máx. 4 h).`);
      else if (x.acao === "ligar" && perigosa && x.durante_s > MAX_PERIGOSA_S) erros.push(`Ação ${n}: ${nome()} é uma carga perigosa — no máximo 4 h ligada.`);
    } else if (x?.acao === "luz") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha a luz.`);
      if (!(Number.isInteger(x.brilho) && x.brilho >= 0 && x.brilho <= 100)) erros.push(`Ação ${n}: brilho de 0 a 100.`);
      if (perigosa) erros.push(`Ação ${n}: ${nome()} é uma carga perigosa — use "Ligar" com duração.`);
    } else if (x?.acao === "alternar") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha o circuito.`);
      if (perigosa) erros.push(`Ação ${n}: ${nome()} é uma carga perigosa — use "Ligar" com duração.`);
    } else if (x?.acao === "estore") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha o estore.`);
      if (!(Number.isInteger(x.posicao) && x.posicao >= 0 && x.posicao <= 100)) erros.push(`Ação ${n}: posição de 0 a 100.`);
    } else if (x?.acao === "notificar") {
      if (!String(x.mensagem ?? "").trim()) erros.push(`Ação ${n}: escreva a mensagem.`);
      else if (String(x.mensagem).length > MAX_MENSAGEM) erros.push(`Ação ${n}: a mensagem tem no máximo ${MAX_MENSAGEM} caracteres.`);
    } else if (x?.acao === "esperar") {
      if (!(Number.isInteger(x.s) && x.s >= 1 && x.s <= 3600)) erros.push(`Ação ${n}: esperar de 1 a 3600 segundos.`);
    } else if (x?.acao === "modo") {
      if (!MODOS.includes(x.modo)) erros.push(`Ação ${n}: escolha o modo.`);
    } else if (x?.acao === "cena") {
      if (ctx.cena) erros.push(`Ação ${n}: uma cena não pode executar outra cena.`);
      else if (!x.cena) erros.push(`Ação ${n}: escolha a cena.`);
    } else if (x?.acao === "se") {
      if (ctx.cena) erros.push(`Ação ${n}: as cenas não têm SE/SENÃO.`);
      else if (nivel >= MAX_NIVEIS_SE) erros.push(`Ação ${n}: no máximo ${MAX_NIVEIS_SE} níveis de SE/SENÃO.`);
      else {
        if (!x.condicao || typeof x.condicao !== "object" || Object.keys(x.condicao).length === 0) erros.push(`Ação ${n}: escolha pelo menos uma condição para o SE.`);
        else validarCondicoes(x.condicao, erros, ctx.aparelhos, `Ação ${n}`);
        // O motor exige pelo menos uma ação no ENTÃO (o SENÃO é opcional).
        if (contarAcoes(x.entao) === 0) erros.push(`Ação ${n}: ponha pelo menos uma ação no ENTÃO (o SENÃO é opcional).`);
        validarAcoes(x.entao, erros, ctx, nivel + 1, `${n}.então`);
        validarAcoes(x.senao, erros, ctx, nivel + 1, `${n}.senão`);
      }
    } else erros.push(`Ação ${n}: escolha o que fazer.`);
  }
}

// Validação no navegador (o motor volta a validar). Devolve lista de erros em pt-PT.
export function validarAutomacao(a, aparelhos = []) {
  const erros = [];
  if (!ID_AUTOMACAO_RE.test(a.id ?? "")) erros.push("Identificador inválido.");
  if (!String(a.nome ?? "").trim()) erros.push("Dê um nome à automação.");
  else if (String(a.nome).length > MAX_NOME) erros.push(`Dê um nome à automação com até ${MAX_NOME} caracteres.`);
  if (a.descricao != null && String(a.descricao).length > 200) erros.push("A frase-objetivo tem no máximo 200 caracteres.");
  if (a.categoria != null && !CATEGORIAS.includes(a.categoria)) erros.push("Categoria inválida.");
  const q = a.quando ?? {};
  if (q.tipo === "sensor") {
    if (!q.aparelho || !Number.isInteger(q.canal)) erros.push("Escolha o sensor.");
    if (q.valor !== 0 && q.valor !== 1) erros.push("Escolha o estado do sensor.");
    if (q.durante_s != null && !(Number.isInteger(q.durante_s) && q.durante_s >= 1 && q.durante_s <= MAX_DURACAO_S)) erros.push("Indique há quanto tempo (1 s a 24 h).");
  } else if (q.tipo === "hora") {
    if (!HORA_RE.test(q.hora ?? "")) erros.push("Indique a hora (HH:MM).");
    if (!Array.isArray(q.dias) || q.dias.length === 0 || q.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) erros.push("Escolha pelo menos um dia.");
  } else if (q.tipo === "potencia") {
    if (!q.aparelho) erros.push("Escolha o medidor.");
    if (!(q.acima_w > 0)) erros.push("Indique a potência (W).");
    if (!(Number.isInteger(q.durante_s) && q.durante_s >= 0)) erros.push("Indique durante quantos segundos.");
    else if (q.durante_s > MAX_DURACAO_S) erros.push("Durante no máximo 24 h (86400 segundos).");
    if (q.rearmar_w != null && !(q.rearmar_w > 0 && q.rearmar_w < q.acima_w)) erros.push("O rearme tem de ficar abaixo do limite (W).");
  } else if (q.tipo === "sol") {
    if (q.evento !== "nascer" && q.evento !== "por") erros.push("Escolha nascer ou pôr do sol.");
    if (q.desvio_min != null && !(Number.isInteger(q.desvio_min) && q.desvio_min >= -180 && q.desvio_min <= 180)) erros.push("Desvio de −180 a 180 minutos.");
  } else if (q.tipo === "presenca") {
    if (q.evento !== "chega_primeiro" && q.evento !== "sai_ultimo") erros.push("Escolha chegada ou saída.");
  } else if (q.tipo === "modo") {
    if (!MODOS.includes(q.modo)) erros.push("Escolha o modo.");
  } else if (q.tipo === "sistema") {
    if (!EVENTOS_SISTEMA.includes(q.evento)) erros.push("Escolha o evento do sistema.");
  } else if (q.tipo !== "manual") erros.push("Escolha quando a automação dispara.");
  validarCondicoes(a.se, erros, aparelhos);
  if (!Array.isArray(a.entao) || a.entao.length < 1 || contarAcoes(a.entao) > MAX_ACOES) erros.push(`Tem de ter entre 1 e ${MAX_ACOES} ações.`);
  validarAcoes(a.entao, erros, { aparelhos, cena: false });
  return erros;
}

export function validarCena(c, aparelhos = []) {
  const erros = [];
  if (!ID_AUTOMACAO_RE.test(c.id ?? "")) erros.push("Identificador inválido.");
  if (!String(c.nome ?? "").trim()) erros.push("Dê um nome à cena.");
  else if (String(c.nome).length > MAX_NOME) erros.push(`Dê um nome à cena com até ${MAX_NOME} caracteres.`);
  if (c.icone != null && !ICONES_CENA.includes(c.icone)) erros.push("Ícone inválido.");
  if (!Array.isArray(c.acoes) || c.acoes.length < 1 || contarAcoes(c.acoes) > MAX_ACOES) erros.push(`Tem de ter entre 1 e ${MAX_ACOES} ações.`);
  validarAcoes(c.acoes, erros, { aparelhos, cena: true });
  return erros;
}

// ---------- Texto ----------
export function tempoRelativo(ms, agora = Date.now()) {
  if (ms == null) return null;
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  if (s < 45) return "agora mesmo";
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
export function descreverDias(dias) {
  const d = [...new Set(dias)].sort();
  if (d.length === 7) return "todos os dias";
  if (d.join() === "1,2,3,4,5") return "dias úteis";
  if (d.join() === "6,7") return "fins de semana";
  return d.map((x) => DIAS[x - 1]).join(", ");
}

export function duracao(s) {
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

// Frase curta que descreve uma automação (texto simples, para textContent).
export function descreverAutomacao(a, aparelhos = [], cenas = []) {
  const nc = (id, n) => nomeCanal(aparelhos, id, n);
  const funcao = (id, n) => aparelhos.find((x) => x.id === id)?.canais.find((c) => c.n === n)?.funcao;
  const q = a.quando ?? {};
  let quando = "";
  if (q.tipo === "sensor") {
    const f = funcao(q.aparelho, q.canal);
    if (q.durante_s) {
      const est = f === "porta" ? (q.valor ? "aberta" : "fechada") : f === "movimento" ? (q.valor ? "com movimento" : "sem movimento")
        : f === "interruptor" || f === "luz" ? (q.valor ? "ligado" : "desligado") : q.valor ? "ativo" : "inativo";
      quando = `Quando ${nc(q.aparelho, q.canal)} está ${est} há ${duracao(q.durante_s)}`;
    } else {
      const verbo = f === "porta" ? (q.valor ? "abre" : "fecha") : f === "movimento" ? (q.valor ? "deteta movimento" : "deixa de detetar movimento")
        : f === "interruptor" || f === "luz" ? (q.valor ? "é ligado" : "é desligado") : `fica ${q.valor ? "ativo" : "inativo"}`;
      quando = `Quando ${nc(q.aparelho, q.canal)} ${verbo}`;
    }
  } else if (q.tipo === "hora") quando = `Às ${q.hora}, ${descreverDias(q.dias ?? [])}`;
  else if (q.tipo === "potencia") quando = `Quando ${nc(q.aparelho, 1)} passa ${q.acima_w} W durante ${q.durante_s} s${q.rearmar_w ? ` (rearma abaixo de ${q.rearmar_w} W)` : ""}`;
  else if (q.tipo === "sol") {
    const ev = q.evento === "nascer" ? "nascer do sol" : "pôr do sol";
    const d = q.desvio_min ?? 0;
    quando = d === 0 ? `Ao ${ev}` : `${Math.abs(d)} min ${d < 0 ? "antes" : "depois"} do ${ev}`;
  } else if (q.tipo === "presenca") quando = q.evento === "chega_primeiro" ? "Quando chega a primeira pessoa" : "Quando sai a última pessoa";
  else if (q.tipo === "modo") quando = `Quando a casa passa a modo ${NOME_MODO[q.modo] ?? q.modo}`;
  else if (q.tipo === "manual") quando = "Quando carregar em Executar";
  else if (q.tipo === "sistema") {
    const quem = q.aparelho ? aparelhos.find((x) => x.id === q.aparelho)?.nome ?? q.aparelho : "um aparelho";
    quando = q.evento === "energia_reposta" ? "Quando a energia é reposta" : `Quando ${quem} fica ${q.evento === "aparelho_offline" ? "offline" : "online"}`;
  }
  const se = descreverCondicoes(a.se, aparelhos);
  const acoes = descreverAcoes(a.entao, aparelhos, cenas);
  return [quando, ...se].filter(Boolean).join(", ") + (acoes.length ? ` → ${acoes.join("; ")}` : "");
}

export function descreverCondicoes(se, aparelhos = []) {
  const r = [];
  if (!se) return r;
  if (se.alarme === true) r.push("com alarme ativo");
  if (se.alarme === false) r.push("com alarme desligado");
  if (se.entre) r.push(`entre ${se.entre[0]} e ${se.entre[1]}`);
  if (Array.isArray(se.dias)) r.push(descreverDias(se.dias));
  if (se.sol === "dia") r.push("de dia");
  if (se.sol === "noite") r.push("de noite");
  if (Array.isArray(se.modo)) r.push(`em modo ${se.modo.map((m) => NOME_MODO[m] ?? m).join(" ou ")}`);
  if (se.presenca === "alguem") r.push("com alguém em casa");
  if (se.presenca === "ninguem") r.push("sem ninguém em casa");
  for (const x of Array.isArray(se.aparelhos) ? se.aparelhos : []) {
    const f = aparelhos.find((a) => a.id === x.aparelho)?.canais.find((c) => c.n === x.canal)?.funcao;
    const est = f === "porta" ? (x.valor ? "aberta" : "fechada") : f === "movimento" ? (x.valor ? "com movimento" : "sem movimento") : x.valor ? "ligado" : "desligado";
    r.push(`com ${nomeCanal(aparelhos, x.aparelho, x.canal)} ${est}`);
  }
  return r;
}

export function descreverAcoes(lista, aparelhos = [], cenas = []) {
  const nc = (id, n) => nomeCanal(aparelhos, id, n);
  return (Array.isArray(lista) ? lista : []).map((x) => {
    if (x.acao === "ligar" || x.acao === "desligar") {
      const dur = x.durante_s ? ` durante ${x.durante_s % 60 === 0 ? `${x.durante_s / 60} min` : `${x.durante_s} s`}` : "";
      return `${x.acao === "ligar" ? "liga" : "desliga"} ${nc(x.aparelho, x.canal)}${dur}`;
    }
    if (x.acao === "estore") return `põe ${nc(x.aparelho, x.canal)} a ${x.posicao} %`;
    if (x.acao === "notificar") return `avisa: "${x.mensagem}"`;
    if (x.acao === "luz") return `põe ${nc(x.aparelho, x.canal)} a ${x.brilho} % de brilho`;
    if (x.acao === "alternar") return `alterna ${nc(x.aparelho, x.canal)}`;
    if (x.acao === "esperar") return `espera ${duracao(x.s)}`;
    if (x.acao === "cena") return `executa a cena ${cenas.find((c) => c.id === x.cena)?.nome ?? x.cena}`;
    if (x.acao === "modo") return `muda para modo ${NOME_MODO[x.modo] ?? x.modo}${x.forcar ? " (mesmo com portas abertas)" : ""}`;
    if (x.acao === "se") {
      const cond = descreverCondicoes(x.condicao, aparelhos).join(" e ") || "?";
      const entao = descreverAcoes(x.entao, aparelhos, cenas).join(", ");
      const senao = descreverAcoes(x.senao, aparelhos, cenas).join(", ");
      return `se ${cond}: ${entao || "nada"}${senao ? `, senão: ${senao}` : ""}`;
    }
    return "?";
  });
}

export const ROTULO_FUNCAO = {
  interruptor: "Circuito",
  luz: "Luz",
  estore: "Estore",
  porta: "Porta",
  movimento: "Movimento",
  bateria: "Bateria",
};

// ---------- v3: alarme em texto, contagem decrescente ----------
export const NOME_ESTADO_ALARME = { desarmado: "desarmado", a_armar: "a armar", armado: "armado", entrada: "entrada — desarme o alarme", disparado: "DISPARADO" };
export function contagem(ateMs, agora = Date.now()) {
  if (ateMs == null) return null;
  const s = Math.max(0, Math.ceil((ateMs - agora) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function horaLisboa(ms) {
  return new Date(ms).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
}

// ---------- v3: agrupar por divisão ----------
export const SEM_DIVISAO = "Outros";
// Agrupa itens pela divisão (ordem de aparecimento; os sem divisão no fim).
// Se nenhum tiver divisão devolve um só grupo com nome null.
export function agruparPorDivisao(itens, divisaoDe = (x) => x.divisao) {
  const grupos = new Map();
  let algum = false;
  for (const x of itens) {
    const d = divisaoDe(x) || null;
    if (d) algum = true;
    const k = d ?? "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(x);
  }
  if (!algum) return itens.length ? [{ nome: null, itens: [...itens] }] : [];
  const r = [...grupos.entries()].filter(([k]) => k !== "").map(([nome, l]) => ({ nome, itens: l }));
  if (grupos.has("")) r.push({ nome: SEM_DIVISAO, itens: grupos.get("") });
  return r;
}

// ---------- v3: saúde dos aparelhos (§5) ----------
export const BATERIA_FRACA = 15;
export const BATERIA_DIAS_POUCOS = 21;
function bateriaDe(m) {
  const c = m?.canais?.find((x) => x.funcao === "bateria");
  return typeof c?.bateria === "number" ? c.bateria : null;
}
/**
 * Lista para o separador "Aparelhos": uma entrada por aparelho, os que precisam de atenção primeiro.
 * @param modelos saída de modelo() para cada aparelho (mesma ordem de `_aparelhos`)
 * @param saude   saída de lerSaude()
 */
export function listaSaude(modelos, saude = {}, agora = Date.now()) {
  const r = modelos.map((m, ordem) => {
    const s = saude[m.id] ?? {};
    const online = m.bateria ? null : (s.online ?? m.online);
    const ultimaNoticia = Math.max(s.ultimaNoticia ?? 0, m.ultimaNoticia ?? 0) || null;
    const bateria = s.bateria ?? bateriaDe(m);
    const bateriaDias = s.bateriaDias ?? null;
    const sn = sinal(s.rssi);
    const atencao = [];
    let gravidade = 0;
    if (!m.bateria && online === false) {
      atencao.push(s.offlineDesde ? `Offline desde ${horaLisboa(s.offlineDesde)} (${tempoRelativo(s.offlineDesde, agora)})` : "Offline");
      gravidade = Math.max(gravidade, 3);
    }
    if (m.bateria && ultimaNoticia != null && agora - ultimaNoticia > SEM_NOTICIAS_MS) {
      atencao.push(`Sem notícias há ${Math.floor((agora - ultimaNoticia) / 3600_000)} h`);
      gravidade = Math.max(gravidade, 3);
    }
    if (bateria != null && bateria < BATERIA_FRACA) { atencao.push(`Bateria fraca (${bateria} %) — trocar pilhas`); gravidade = Math.max(gravidade, 2); }
    else if (bateriaDias != null && bateriaDias < BATERIA_DIAS_POUCOS) { atencao.push(`Pilhas para ≈ ${Math.round(bateriaDias)} dias`); gravidade = Math.max(gravidade, 2); }
    if (sn && sn.barras === 1) { atencao.push("Sinal Wi-Fi muito fraco"); gravidade = Math.max(gravidade, 1); }
    if ((s.reinicios24h ?? 0) > 5) { atencao.push(`Reiniciou ${s.reinicios24h} vezes em 24 h`); gravidade = Math.max(gravidade, 1); }
    return {
      id: m.id, nome: m.nome, divisao: m.divisao ?? null, aPilhas: !!m.bateria, online, offlineDesde: s.offlineDesde ?? null,
      ultimaNoticia, rssi: s.rssi ?? null, sinal: sn, reinicios24h: s.reinicios24h ?? null, uptimeS: s.uptimeS ?? null,
      bateria, bateriaDias, atencao, gravidade, ordem,
    };
  });
  return r.sort((a, b) => b.gravidade - a.gravidade || a.ordem - b.ordem);
}

// ---------- v3: relatório da casa (§9) ----------
// Como o motor (aviso "Sinal Wi-Fi fraco"): abaixo de −80 dBm.
export const SINAL_FRACO_DBM = -80;
// kWh com vírgula decimal (pt-PT).
export const decimal = (v, casas = 1) => v.toFixed(casas).replace(".", ",");
export const kwhTexto = (v, casas = 1) => `${decimal(v, casas)} kWh`;
const ROTULOS_RELATORIO = [
  ["ligado", "Ligado"], ["espera", "Em espera"], ["desligado", "Desligado"], ["aberto", "Aberto"], ["fechado", "Fechado"],
  ["estores", "Estores"], ["offline", "Offline"], ["bateria", "Bateria fraca"], ["sinal", "Sinal fraco"],
];
export function construirRelatorio({ aparelhos = [], modelos = [], saude = {}, energia = null, modo = null, alarme = null, agora = Date.now() }) {
  const porId = Object.fromEntries(aparelhos.map((a) => [a.id, a]));
  const grupos = new Map(); // divisão → { chave → [texto] }
  const grupo = (d) => {
    const k = d || "";
    if (!grupos.has(k)) grupos.set(k, Object.fromEntries(ROTULOS_RELATORIO.map(([c]) => [c, []])));
    return grupos.get(k);
  };
  let potenciaW = 0, temPotencia = false;
  const haGeral = modelos.some((x) => x.geral);
  for (const m of modelos) {
    const a = porId[m.id];
    if (!a) continue;
    if (m.temMedicao && typeof m.potenciaW === "number" && (!haGeral || m.geral)) { potenciaW += m.potenciaW; temPotencia = true; }
    for (const c of m.canais) {
      const g = grupo(c.divisao ?? m.divisao);
      const nome = nomeCanal(aparelhos, m.id, c.n);
      if (c.funcao === "interruptor" || c.funcao === "luz") {
        if (c.ligado == null) continue;
        if (c.emEspera) g.espera.push(nome);
        else if (c.ligado) g.ligado.push(c.funcao === "luz" && c.brilho != null ? `${nome} (${c.brilho} %)` : nome);
        else g.desligado.push(nome);
      } else if (c.funcao === "porta" && c.aberto != null) (c.aberto ? g.aberto : g.fechado).push(nome);
      else if (c.funcao === "estore" && c.posicao != null) g.estores.push(`${nome} ${c.posicao === 0 ? "fechado" : c.posicao === 100 ? "aberto" : `${c.posicao} %`}`);
    }
    const g = grupo(m.divisao);
    const s = saude[m.id] ?? {};
    const online = m.bateria ? null : (s.online ?? m.online);
    if (online === false) g.offline.push(m.nome);
    const bat = s.bateria ?? bateriaDe(m);
    if (bat != null && bat < BATERIA_FRACA) g.bateria.push(`${m.nome} (${bat} %)`);
    else if (s.bateriaDias != null && s.bateriaDias < BATERIA_DIAS_POUCOS) g.bateria.push(`${m.nome} (≈ ${Math.round(s.bateriaDias)} dias)`);
    if (typeof s.rssi === "number" && s.rssi < SINAL_FRACO_DBM) g.sinal.push(`${m.nome} (${s.rssi} dBm)`);
  }
  const algum = [...grupos.keys()].some((k) => k !== "");
  const divisoes = [...grupos.entries()]
    .sort(([a], [b]) => (a === "") - (b === ""))
    .map(([k, v]) => ({
      nome: k || (algum ? SEM_DIVISAO : "Casa"),
      linhas: ROTULOS_RELATORIO.filter(([c]) => v[c].length).map(([c, rotulo]) => ({ chave: c, rotulo, itens: v[c] })),
    }))
    .filter((d) => d.linhas.length);
  return {
    geradoEm: agora,
    modo: modo?.modo ?? null,
    alarme: alarme ? { estado: alarme.estado, tipo: alarme.tipo } : null,
    consumo: { agoraW: temPotencia ? potenciaW : null, hojeKWh: energia?.hojeKWh ?? null, ontemKWh: energia?.ontemKWh ?? null },
    divisoes,
  };
}

export function textoAlarme(al) {
  if (!al) return "sem informação";
  if (al.estado === "armado" && al.tipo) return `armado (${al.tipo === "perimetro" ? "perímetro" : "total"})`;
  return NOME_ESTADO_ALARME[al.estado] ?? al.estado;
}

// Texto simples pt-PT para "Copiar".
export function relatorioTexto(r) {
  const data = new Date(r.geradoEm).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const kwh = (v) => (v == null ? "—" : kwhTexto(v));
  const linhas = [
    `Relatório da casa — ${data}`,
    `Modo: ${r.modo ? NOME_MODO[r.modo] : "—"} · Alarme: ${textoAlarme(r.alarme)}`,
    `Consumo: agora ${r.consumo.agoraW == null ? "—" : `${Math.round(r.consumo.agoraW)} W`} · hoje ${kwh(r.consumo.hojeKWh)} · ontem ${kwh(r.consumo.ontemKWh)}`,
  ];
  for (const d of r.divisoes) {
    linhas.push("", d.nome);
    for (const l of d.linhas) linhas.push(`- ${l.rotulo}: ${l.itens.join(", ")}`);
  }
  return linhas.join("\n");
}
