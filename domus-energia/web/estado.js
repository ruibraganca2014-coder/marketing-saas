// Modelo da casa a partir das mensagens MQTT — módulo puro (sem DOM, sem rede),
// para poder ser testado à parte. Protocolo: docs/PROTOCOLO-MQTT.md e PROTOCOLO-MQTT-v2.md.

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
        if (!Number.isInteger(n) || n < 1 || n > 32 || ns.has(n) || !FUNCOES.includes(c?.funcao)) continue;
        ns.add(n);
        canais.push({ n, funcao: c.funcao, nome: c.nome != null && String(c.nome).trim() ? String(c.nome) : nome, temNome: c.nome != null && String(c.nome).trim() !== "" });
      }
      canais.sort((x, y) => x.n - y.n);
    }
    lista.push({
      id: a.id,
      nome,
      tipo: a.tipo === "shelly" ? "shelly" : "openbeken",
      medidor: a.medidor === true,
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
export function notarHistorico(estados, eventos) {
  for (const ev of eventos) {
    if (typeof ev.aparelho !== "string") continue;
    const t = typeof ev.ts === "number" ? ev.ts : Date.parse(ev.ts);
    if (!Number.isFinite(t)) continue;
    const e = (estados[ev.aparelho] ??= { canais: {} });
    if (!(e.ultimaNoticiaHistorico >= t)) e.ultimaNoticiaHistorico = t;
  }
}

// ---------- Modelo normalizado ----------
export function modelo(a, e = {}, agora = Date.now()) {
  const ultima = Math.max(e.ultimaNoticia ?? 0, e.ultimaNoticiaHistorico ?? 0) || null;
  const temMedicao = a.medidor || (a.v1 && [e.potenciaW, e.tensaoV, e.correnteA, e.energiaKWh].some((v) => v != null));
  return {
    id: a.id,
    nome: a.nome,
    tipo: a.tipo,
    medidor: a.medidor,
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
      return m;
    }),
  };
}

// Pode ser controlado agora? Aparelhos a pilhas não se consideram offline.
export const disponivel = (m) => m.bateria || m.online;

// ---------- Resumo e fundo vivo ----------
export function resumo(modelos, alarme) {
  let potenciaW = 0, ligados = 0, circuitos = 0, portasAbertas = 0, portas = 0, online = 0, comLigacao = 0;
  for (const m of modelos) {
    if (m.temMedicao && m.potenciaW != null) potenciaW += m.potenciaW;
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
export function lerAlarme(texto) {
  const v = json(texto);
  if (!v || typeof v.ativo !== "boolean") return null;
  const desde = Date.parse(v.desde);
  return { ativo: v.ativo, desde: Number.isFinite(desde) ? desde : null };
}

export function lerNtfy(texto) {
  const v = json(texto);
  if (!v || typeof v.url !== "string" || !/^https?:\/\/\S+$/i.test(v.url)) return null;
  return { url: v.url };
}

const TIPOS_EVENTO = ["alarme", "sensor", "automacao", "aviso", "erro"];
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

// Validação no navegador (o motor volta a validar). Devolve lista de erros em pt-PT.
export function validarAutomacao(a) {
  const erros = [];
  if (!ID_AUTOMACAO_RE.test(a.id ?? "")) erros.push("Identificador inválido.");
  if (!String(a.nome ?? "").trim()) erros.push("Dê um nome à automação.");
  const q = a.quando ?? {};
  if (q.tipo === "sensor") {
    if (!q.aparelho || !Number.isInteger(q.canal)) erros.push("Escolha o sensor.");
    if (q.valor !== 0 && q.valor !== 1) erros.push("Escolha o estado do sensor.");
  } else if (q.tipo === "hora") {
    if (!HORA_RE.test(q.hora ?? "")) erros.push("Indique a hora (HH:MM).");
    if (!Array.isArray(q.dias) || q.dias.length === 0 || q.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) erros.push("Escolha pelo menos um dia.");
  } else if (q.tipo === "potencia") {
    if (!q.aparelho) erros.push("Escolha o medidor.");
    if (!(q.acima_w > 0)) erros.push("Indique a potência (W).");
    if (!(Number.isInteger(q.durante_s) && q.durante_s >= 0)) erros.push("Indique durante quantos segundos.");
  } else erros.push("Escolha quando a automação dispara.");
  if (a.se?.entre && (!Array.isArray(a.se.entre) || a.se.entre.length !== 2 || !a.se.entre.every((h) => HORA_RE.test(h)))) erros.push("Horário inválido (HH:MM).");
  if (!Array.isArray(a.entao) || a.entao.length < 1 || a.entao.length > 10) erros.push("Tem de ter entre 1 e 10 ações.");
  for (const [i, x] of (a.entao ?? []).entries()) {
    const n = i + 1;
    if (x.acao === "ligar" || x.acao === "desligar") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha o circuito.`);
      if (x.durante_s != null && !(Number.isInteger(x.durante_s) && x.durante_s > 0)) erros.push(`Ação ${n}: duração inválida.`);
    } else if (x.acao === "estore") {
      if (!x.aparelho || !Number.isInteger(x.canal)) erros.push(`Ação ${n}: escolha o estore.`);
      if (!(Number.isInteger(x.posicao) && x.posicao >= 0 && x.posicao <= 100)) erros.push(`Ação ${n}: posição de 0 a 100.`);
    } else if (x.acao === "notificar") {
      if (!String(x.mensagem ?? "").trim()) erros.push(`Ação ${n}: escreva a mensagem.`);
    } else erros.push(`Ação ${n}: escolha o que fazer.`);
  }
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

// Frase curta que descreve uma automação (texto simples, para textContent).
export function descreverAutomacao(a, aparelhos = []) {
  const nomeCanal = (id, n) => {
    const ap = aparelhos.find((x) => x.id === id);
    if (!ap) return id ?? "?";
    const c = ap.canais.find((x) => x.n === n);
    return c && c.temNome && ap.canais.length > 1 ? `${ap.nome} · ${c.nome}` : c?.temNome ? c.nome : ap.nome;
  };
  const q = a.quando ?? {};
  let quando = "";
  if (q.tipo === "sensor") {
    const ap = aparelhos.find((x) => x.id === q.aparelho);
    const f = ap?.canais.find((c) => c.n === q.canal)?.funcao;
    const verbo = f === "porta" ? (q.valor ? "abre" : "fecha") : f === "movimento" ? (q.valor ? "deteta movimento" : "deixa de detetar movimento") : `fica ${q.valor ? "ativo" : "inativo"}`;
    quando = `Quando ${nomeCanal(q.aparelho, q.canal)} ${verbo}`;
  } else if (q.tipo === "hora") quando = `Às ${q.hora}, ${descreverDias(q.dias ?? [])}`;
  else if (q.tipo === "potencia") quando = `Quando ${nomeCanal(q.aparelho, 1)} passa ${q.acima_w} W durante ${q.durante_s} s`;
  const se = [];
  if (a.se?.alarme === true) se.push("com alarme ativo");
  if (a.se?.alarme === false) se.push("com alarme desligado");
  if (a.se?.entre) se.push(`entre ${a.se.entre[0]} e ${a.se.entre[1]}`);
  const acoes = (a.entao ?? []).map((x) => {
    if (x.acao === "ligar" || x.acao === "desligar") {
      const dur = x.durante_s ? ` durante ${x.durante_s % 60 === 0 ? `${x.durante_s / 60} min` : `${x.durante_s} s`}` : "";
      return `${x.acao === "ligar" ? "liga" : "desliga"} ${nomeCanal(x.aparelho, x.canal)}${dur}`;
    }
    if (x.acao === "estore") return `põe ${nomeCanal(x.aparelho, x.canal)} a ${x.posicao} %`;
    if (x.acao === "notificar") return `avisa: "${x.mensagem}"`;
    return "?";
  });
  return [quando, ...se].filter(Boolean).join(", ") + (acoes.length ? ` → ${acoes.join("; ")}` : "");
}

export const ROTULO_FUNCAO = {
  interruptor: "Circuito",
  luz: "Luz",
  estore: "Estore",
  porta: "Porta",
  movimento: "Movimento",
  bateria: "Bateria",
};
