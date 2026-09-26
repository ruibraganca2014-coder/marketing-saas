// Área de cliente — liga-se diretamente ao servidor MQTT da Domus Energia.
// Protocolo: docs/PROTOCOLO-MQTT.md (v1) e docs/PROTOCOLO-MQTT-v2.md (canais, alarme, automações).
// Todos os nomes e textos que vêm dos aparelhos ou do servidor entram só com textContent.
import * as E from "./estado.js";
import { criarIlustracao, atualizarIlustracao } from "./ilustracoes.js";
import { criarAutomacoes } from "./automacoes.js";

const cfg = window.DOMUS;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};

const CHAVE_LEMBRAR = "domus.cliente";
const TEMPO_CONFIRMACAO = 5000; // ms à espera que o aparelho (ou o motor) confirme

let cliente = null;    // ligação MQTT atual
let clientId = null;
let codigo = null;     // código do cliente com sessão iniciada
let entrou = false;    // já houve uma ligação aceite nesta sessão
let aparelhos = [];    // lerAparelhos(_aparelhos)
let estados = {};      // id → estado bruto (estado.js)
let pendentes = {};    // "id:n" → { esperado, qualquer, timer }
let cartoes = {};      // id → { cartao, estado, detalhes, medidor, canais: { n → linha } }
let alarme = null;     // { ativo, desde } de _alarme
let alarmePendente = null; // { valor, timer }
let historico = [];    // de _historico
let vivos = [];        // de _eventos desde que entrou
let rpcId = 0;
const temporizadores = new Set();

const automacoes = criarAutomacoes({
  publicar: (sufixo, obj) => publicar(`domus/${codigo}/${sufixo}`, JSON.stringify(obj)),
  ligado: () => !!cliente?.connected,
  aparelhos: () => aparelhos,
});

// ---------- Sessão ----------
$("form-login").addEventListener("submit", (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  const cod = String(dados.codigo ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(cod)) {
    erroLogin("O código de cliente só tem letras, números e hífens.");
    return;
  }
  entrar(cod, dados.password, { lembrar: !!dados.lembrar });
});

$("sair").addEventListener("click", () => {
  apagarLembrar();
  terminar();
  $("form-login").reset();
});

$("atualizar").addEventListener("click", pedirEstadoShelly);

// Separadores Casa / Automações / Histórico
const separadores = [...document.querySelectorAll(".separador")];
for (const s of separadores) {
  s.addEventListener("click", () => mostrarSeccao(s.dataset.sec));
  s.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = separadores.indexOf(s) + (e.key === "ArrowRight" ? 1 : -1);
    const alvo = separadores[(i + separadores.length) % separadores.length];
    mostrarSeccao(alvo.dataset.sec);
    alvo.focus();
  });
}
function mostrarSeccao(nome) {
  for (const s of separadores) {
    const sel = s.dataset.sec === nome;
    s.setAttribute("aria-selected", String(sel));
    s.tabIndex = sel ? 0 : -1;
    $(`sec-${s.dataset.sec}`).hidden = !sel;
  }
}

// Tempos relativos ("há 3 min") atualizam-se sozinhos.
setInterval(() => {
  if (!entrou) return;
  for (const a of aparelhos) atualizar(a.id, false);
  desenharAlarme();
  desenharHistorico();
}, 20_000);

function mostrarVista(autenticado) {
  $("vista-login").hidden = autenticado;
  $("vista-painel").hidden = !autenticado;
  $("sair").hidden = !autenticado;
}

function entrar(cod, password, { lembrar, automatico = false }) {
  terminar();
  codigo = cod;
  erroLogin(null);
  const botao = $("form-login").querySelector("button");
  botao.disabled = true;
  botao.textContent = "A entrar…";

  if (!window.mqtt) {
    erroLogin("Não foi possível carregar a ligação ao servidor. Verifique a internet e recarregue a página.");
    repor();
    return;
  }

  clientId = `web-${cod}-${Math.random().toString(16).slice(2, 10)}`;
  const c = window.mqtt.connect(cfg.mqttUrl, {
    username: cod,
    password,
    clientId,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 3000,
    connectTimeout: 10_000,
    protocolVersion: 4,
  });
  cliente = c;

  c.on("connect", () => {
    if (c !== cliente) return;
    if (!entrou) {
      entrou = true;
      if (lembrar) guardarLembrar(cod, password);
      else if (!automatico) apagarLembrar();
      $("utilizador").textContent = `Cliente: ${cod}`;
      mostrarVista(true);
      repor();
      desenhar();
      desenharAlarme();
      desenharHistorico();
      automacoes.desenhar();
    }
    estadoLigacao(true);
    c.subscribe(`domus/${cod}/#`, { qos: 1 }, (err) => {
      if (err) mostrarErro("Não foi possível ler os seus aparelhos. Tente sair e entrar de novo.");
    });
    pedirEstadoShelly();
  });

  c.on("error", (err) => {
    if (c !== cliente) return;
    // CONNACK 4 (utilizador/palavra-passe errados) ou 5 (não autorizado): não insistir.
    if (err?.code === 4 || err?.code === 5 || /not authori[sz]ed|bad user/i.test(err?.message ?? "")) {
      apagarLembrar();
      terminar();
      erroLogin("Código ou palavra-passe errados.");
      return;
    }
    if (!entrou) erroLogin("Não foi possível ligar ao servidor. A tentar de novo…");
  });

  c.on("reconnect", () => c === cliente && estadoLigacao(false));
  c.on("offline", () => c === cliente && estadoLigacao(false));
  c.on("close", () => c === cliente && entrou && estadoLigacao(false));
  c.on("message", (topico, payload, packet) => c === cliente && receber(topico, payload.toString(), !!packet?.retain));
}

// Fecha a ligação e limpa tudo o que era do cliente anterior.
function terminar() {
  if (cliente) {
    const c = cliente;
    cliente = null;
    c.removeAllListeners("message");
    c.end(true);
  }
  for (const p of Object.values(pendentes)) clearTimeout(p.timer);
  for (const t of temporizadores) clearTimeout(t);
  temporizadores.clear();
  clearTimeout(alarmePendente?.timer);
  codigo = null;
  entrou = false;
  aparelhos = [];
  estados = {};
  pendentes = {};
  cartoes = {};
  alarme = null;
  alarmePendente = null;
  historico = [];
  vivos = [];
  automacoes.limpar();
  $("lista").replaceChildren();
  $("lista-historico").replaceChildren();
  $("ntfy").hidden = true;
  $("painel").style.removeProperty("--luzes");
  $("painel").style.removeProperty("--calor");
  $("painel").style.removeProperty("--alarme-on");
  mostrarErro(null);
  mostrarSeccao("casa");
  mostrarVista(false);
  repor();
}

function repor() {
  const botao = $("form-login").querySelector("button");
  botao.disabled = false;
  botao.textContent = "Entrar";
}

function erroLogin(texto) {
  $("login-erro").hidden = !texto;
  $("login-erro").textContent = texto ?? "";
}

function estadoLigacao(ligado) {
  const e = $("ligacao");
  e.textContent = ligado ? "Ligado ao servidor" : "A religar…";
  e.classList.toggle("ok", ligado);
}

// "Lembrar-me": guarda código e palavra-passe só neste navegador.
function lerLembrar() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_LEMBRAR));
    if (v && typeof v.codigo === "string" && typeof v.password === "string") {
      $("form-login").elements.codigo.value = v.codigo;
      $("form-login").elements.lembrar.checked = true;
      return v;
    }
  } catch {}
  return null;
}
function guardarLembrar(cod, password) {
  try { localStorage.setItem(CHAVE_LEMBRAR, JSON.stringify({ codigo: cod, password })); } catch {}
}
function apagarLembrar() {
  try { localStorage.removeItem(CHAVE_LEMBRAR); } catch {}
}

function publicar(topico, texto) {
  if (!cliente?.connected) return false;
  // Comandos NUNCA retidos: um comando retido volta a ser aplicado quando o aparelho reinicia.
  cliente.publish(topico, texto, { qos: 1, retain: false });
  return true;
}

// ---------- Mensagens MQTT ----------
function receber(topico, texto, retido) {
  const partes = topico.split("/");
  if (partes[0] !== "domus" || partes[1] !== codigo || partes.length < 3) return;
  const id = partes[2];
  const resto = partes.slice(3).join("/");

  if (id.startsWith("_")) {
    if (resto !== "") return; // ex.: _alarme/set, _automacoes/set, _fcm/registar
    switch (id) {
      case "_aparelhos":
        aparelhos = E.lerAparelhos(texto);
        desenhar();
        automacoes.desenhar();
        pedirEstadoShelly();
        break;
      case "_alarme": {
        alarme = E.lerAlarme(texto);
        if (alarmePendente && alarme?.ativo === alarmePendente.valor) {
          clearTimeout(alarmePendente.timer);
          alarmePendente = null;
        }
        desenharAlarme();
        resumo();
        break;
      }
      case "_automacoes":
        automacoes.receberLista(E.lerAutomacoes(texto), texto);
        break;
      case "_historico":
        historico = E.lerHistorico(texto);
        E.notarHistorico(estados, historico);
        desenharHistorico();
        for (const a of aparelhos) if (a.bateria) atualizar(a.id, false);
        break;
      case "_eventos": {
        const ev = E.lerEvento(texto);
        if (!ev) return;
        vivos.unshift(ev);
        vivos = vivos.slice(0, 100);
        E.notarHistorico(estados, [ev]);
        desenharHistorico();
        if (ev.tipo === "erro") automacoes.receberErro(ev);
        if (ev.aparelho) atualizar(ev.aparelho);
        break;
      }
      case "_ntfy": {
        const n = E.lerNtfy(texto);
        $("ntfy").hidden = !n;
        $("ntfy-url").textContent = n?.url ?? "";
        $("ntfy-msg").textContent = "";
        break;
      }
    }
    return;
  }

  const a = aparelhos.find((x) => x.id === id);
  const r = E.aplicarMensagem(estados, id, a, resto, texto, { agora: Date.now(), retido });
  if (!r) return;

  // Confirmação de um pedido nosso
  if (a && r.canal != null) {
    const chave = `${id}:${r.canal}`;
    const p = pendentes[chave];
    if (p) {
      const m = E.modelo(a, estados[id]).canais.find((c) => c.n === r.canal);
      if (p.qualquer || Object.entries(p.esperado).every(([k, v]) => m?.[k] === v)) {
        clearTimeout(p.timer);
        delete pendentes[chave];
      }
    }
    // Ondas do sensor de movimento durante 3 s
    if (r.campo === "movimento" && !retido) {
      const t = setTimeout(() => { temporizadores.delete(t); atualizar(id, false); }, E.MOVIMENTO_ANIMA_MS + 50);
      temporizadores.add(t);
    }
  }
  atualizar(id);
}

function pedirEstadoShelly() {
  if (!cliente?.connected) return;
  for (const a of aparelhos) {
    if (a.tipo === "shelly") publicar(`domus/${codigo}/${a.id}/command`, "status_update");
  }
}

// ---------- Desenho dos aparelhos ----------
function desenhar() {
  const lista = $("lista");
  lista.replaceChildren();
  cartoes = {};

  if (aparelhos.length === 0) {
    lista.appendChild(el("div", "cartao vazio", "Ainda não tem aparelhos associados. Contacte a Domus Energia."));
  }

  for (const a of aparelhos) {
    const cartao = el("article", "cartao aparelho");
    cartao.dataset.id = a.id;
    const topo = el("div", "aparelho-topo");
    const estado = el("span", "estado");
    const info = el("div", "info");
    const nome = el("b", null, a.nome);
    const detalhes = el("small", "detalhes");
    info.append(nome, detalhes);
    topo.append(estado, info);
    let medidor = null;
    if (a.medidor || a.v1) {
      medidor = criarIlustracao("medidor");
      medidor.hidden = true;
      topo.append(medidor);
    }
    cartao.append(topo);
    const canais = {};
    for (const c of a.canais) {
      const linha = criarLinha(a, c);
      canais[c.n] = linha;
      cartao.append(linha.raiz);
    }
    lista.appendChild(cartao);
    cartoes[a.id] = { cartao, estado, detalhes, medidor, canais };
    atualizar(a.id, false);
  }
  resumo();
}

function rotuloCanal(a, c) {
  // Canal sem nome próprio num aparelho de um só canal: mostra a função (o nome do aparelho já está no topo).
  return c.temNome ? c.nome : E.ROTULO_FUNCAO[c.funcao];
}

function interruptor(rotulo, aoMudar) {
  const label = el("label", "interruptor");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", rotulo);
  input.addEventListener("change", () => aoMudar(input.checked));
  label.append(input, document.createElement("span"));
  return { label, input };
}

function deslizador(rotulo, texto, aoLargar) {
  const caixa = el("label", "deslizador");
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "1";
  input.setAttribute("aria-label", rotulo);
  const saida = el("output", "num");
  // Enquanto se arrasta só muda o número; envia ao largar (evento change).
  input.addEventListener("input", () => { input.dataset.arrastar = "1"; saida.textContent = `${input.value} %`; });
  input.addEventListener("change", () => { delete input.dataset.arrastar; aoLargar(Number(input.value)); });
  caixa.append(el("span", null, texto), input, saida);
  return { caixa, input, saida };
}

function criarLinha(a, c) {
  const raiz = el("div", `canal canal-${c.funcao}`);
  raiz.dataset.canal = String(c.n);
  raiz.dataset.funcao = c.funcao;
  const caixaIlus = el("div", "canal-ilus");
  const ilus = criarIlustracao(c.funcao);
  caixaIlus.append(ilus);
  const info = el("div", "canal-info");
  const nome = el("span", "canal-nome", rotuloCanal(a, c));
  const estado = el("small", "canal-estado");
  info.append(nome, estado);
  raiz.append(caixaIlus, info);
  const nomeCompleto = c.temNome && a.canais.length > 1 ? `${a.nome} — ${c.nome}` : c.nome;
  const linha = { raiz, ilus, estado };

  if (c.funcao === "interruptor" || c.funcao === "luz") {
    const s = interruptor(`Ligar ou desligar ${nomeCompleto}`, (v) => pedir(a, c, { ligado: v }));
    raiz.append(s.label);
    linha.sw = s;
  }
  if (c.funcao === "luz") {
    const extra = el("div", "canal-extra");
    const d = deslizador(`Brilho de ${nomeCompleto}`, "Brilho", (v) => pedir(a, c, { brilho: Math.max(1, v) }));
    d.input.min = "1";
    extra.append(d.caixa);
    raiz.append(extra);
    linha.brilho = d;
  }
  if (c.funcao === "estore") {
    const extra = el("div", "canal-extra");
    const d = deslizador(`Posição de ${nomeCompleto} (0 fechado, 100 aberto)`, "Posição", (v) => pedir(a, c, { posicao: v }));
    const botoes = el("div", "linha");
    const abrir = el("button", "btn sec pequeno", "Abrir");
    abrir.type = "button";
    abrir.addEventListener("click", () => pedir(a, c, { estore: "abrir" }));
    const fechar = el("button", "btn sec pequeno", "Fechar");
    fechar.type = "button";
    fechar.addEventListener("click", () => pedir(a, c, { estore: "fechar" }));
    botoes.append(abrir);
    let parar = null;
    if (a.tipo === "shelly") {
      parar = el("button", "btn sec pequeno", "Parar");
      parar.type = "button";
      parar.addEventListener("click", () => pedir(a, c, { estore: "parar" }));
      botoes.append(parar);
    }
    botoes.append(fechar);
    extra.append(d.caixa, botoes);
    raiz.append(extra);
    linha.posicao = d;
    linha.botoes = [abrir, parar, fechar].filter(Boolean);
  }
  if (c.funcao === "porta" || c.funcao === "movimento" || c.funcao === "bateria") {
    const selo = el("span", "selo-estado");
    raiz.append(selo);
    linha.selo = selo;
  }
  return linha;
}

function atualizar(id, comResumo = true) {
  const k = cartoes[id];
  const a = aparelhos.find((x) => x.id === id);
  if (k && a) {
    const agora = Date.now();
    const m = E.modelo(a, estados[id], agora);
    const disponivel = E.disponivel(m);

    // Estado do aparelho + medição
    k.estado.className = `estado${m.bateria ? " dorme" : m.online ? " online" : ""}`;
    k.cartao.classList.toggle("offline", !disponivel);
    let ligacao;
    k.detalhes.classList.remove("aviso");
    if (m.bateria) {
      if (m.ultimaNoticia == null) ligacao = "À espera de notícias";
      else if (m.semNoticias) {
        ligacao = `Sem notícias há ${Math.floor((agora - m.ultimaNoticia) / 3600_000)} h`;
        k.detalhes.classList.add("aviso");
      } else ligacao = `Última notícia ${E.tempoRelativo(m.ultimaNoticia, agora)}`;
    } else ligacao = m.online ? "Online" : "Offline";
    k.detalhes.textContent = [
      ligacao,
      m.potenciaW != null && `${m.potenciaW.toFixed(1)} W`,
      m.tensaoV != null && `${m.tensaoV.toFixed(0)} V`,
      m.correnteA != null && `${m.correnteA.toFixed(2)} A`,
      m.energiaKWh != null && `${m.energiaKWh.toFixed(2)} kWh`,
    ].filter(Boolean).join(" · ");
    if (k.medidor) {
      k.medidor.hidden = !m.temMedicao;
      atualizarIlustracao(k.medidor, "medidor", { potenciaW: m.potenciaW });
    }

    for (const c of m.canais) {
      const linha = k.canais[c.n];
      if (linha) atualizarLinha(a, c, linha, disponivel, agora);
    }
  }
  if (comResumo) resumo();
}

function atualizarLinha(a, c, linha, disponivel, agora) {
  const p = pendentes[`${a.id}:${c.n}`];
  const v = { ...c, ...(p?.esperado ?? {}) };
  const quando = (t) => (t ? ` · ${E.tempoRelativo(t, agora)}` : "");
  switch (c.funcao) {
    case "interruptor":
      linha.estado.textContent = v.ligado == null ? "Sem informação" : v.ligado ? "Ligado" : "Desligado";
      break;
    case "luz":
      linha.estado.textContent = v.ligado == null ? "Sem informação"
        : v.ligado ? `Ligada${v.brilho != null ? ` · ${v.brilho} %` : ""}` : "Desligada";
      if (!linha.brilho.input.dataset.arrastar) {
        linha.brilho.input.value = String(v.brilho ?? 100);
        linha.brilho.saida.textContent = v.brilho != null ? `${v.brilho} %` : "—";
      }
      linha.brilho.input.disabled = !disponivel;
      break;
    case "estore": {
      const aMexer = c.movimentoEstore === "opening" || c.movimentoEstore === "closing";
      const pos = p?.esperado.posicao ?? (aMexer && c.alvo != null ? c.alvo : c.posicao);
      linha.estado.textContent = c.movimentoEstore === "opening" ? "A abrir…"
        : c.movimentoEstore === "closing" ? "A fechar…"
        : c.posicao == null ? "Sem informação"
        : c.posicao === 0 ? "Fechado" : c.posicao === 100 ? "Aberto" : `Aberto ${c.posicao} %`;
      if (!linha.posicao.input.dataset.arrastar) {
        linha.posicao.input.value = String(pos ?? 0);
        linha.posicao.saida.textContent = pos != null ? `${pos} %` : "—";
      }
      linha.posicao.input.disabled = !disponivel;
      for (const b of linha.botoes) b.disabled = !disponivel;
      atualizarIlustracao(linha.ilus, "estore", { posicao: c.posicao ?? 0, aMexer });
      break;
    }
    case "porta":
      linha.estado.textContent = c.aberto == null ? "Sem informação" : `${c.aberto ? "Aberta" : "Fechada"}${quando(c.ultimaMudanca ?? estados[a.id]?.ultimaNoticia)}`;
      linha.selo.textContent = c.aberto == null ? "—" : c.aberto ? "Aberta" : "Fechada";
      linha.selo.className = `selo-estado${c.aberto ? " quente" : ""}`;
      atualizarIlustracao(linha.ilus, "porta", { aberto: !!c.aberto });
      break;
    case "movimento":
      linha.estado.textContent = c.movimento == null ? "Sem informação" : `${c.movimento ? "Movimento detetado" : "Sem movimento"}${quando(c.ultimaMudanca)}`;
      linha.selo.textContent = c.movimento == null ? "—" : c.movimento ? "Movimento" : "Calmo";
      linha.selo.className = `selo-estado${c.movimento ? " quente" : ""}`;
      atualizarIlustracao(linha.ilus, "movimento", { ativo: c.animar, movimento: !!c.movimento });
      break;
    case "bateria": {
      const fraca = c.bateria != null && c.bateria < 15;
      linha.estado.textContent = c.bateria == null ? "Sem informação" : fraca ? "Bateria fraca — trocar pilhas" : "Pilhas em bom estado";
      linha.selo.textContent = c.bateria == null ? "—" : `${c.bateria} %`;
      linha.selo.className = `selo-estado num${fraca ? " quente" : ""}`;
      atualizarIlustracao(linha.ilus, "bateria", { nivel: c.bateria });
      break;
    }
  }
  if (linha.sw) {
    linha.sw.input.checked = !!v.ligado;
    linha.sw.input.disabled = !disponivel || (!!p && "ligado" in p.esperado);
    linha.sw.label.classList.toggle("pendente", !!p);
  }
  if (c.funcao === "interruptor") atualizarIlustracao(linha.ilus, "interruptor", { ativo: !!v.ligado });
  if (c.funcao === "luz") atualizarIlustracao(linha.ilus, "luz", { ativo: !!v.ligado, brilho: v.brilho ?? 100 });
}

// ---------- Resumo e fundo vivo ----------
function resumo() {
  const agora = Date.now();
  const ms = aparelhos.map((a) => E.modelo(a, estados[a.id], agora));
  const r = E.resumo(ms, alarme);
  $("total-potencia").textContent = `${r.potenciaW.toFixed(0)} W`;
  $("total-ligados").textContent = `${r.ligados} / ${r.circuitos}`;
  $("total-online").textContent = `${r.online} / ${r.comLigacao}`;
  $("total-portas").textContent = r.portas ? String(r.portasAbertas) : "—";
  $("resumo-portas").classList.toggle("alerta", r.portasAbertas > 0 && !!alarme?.ativo);
  $("total-alarme").textContent = alarme == null ? "—" : alarme.ativo ? "Ativo" : "Desligado";
  $("resumo-alarme").classList.toggle("alerta", !!alarme?.ativo);

  const f = E.fundoVivo(r);
  const painel = $("painel");
  painel.style.setProperty("--luzes", f.luzes.toFixed(3));
  painel.style.setProperty("--calor", f.calor.toFixed(3));
  painel.style.setProperty("--alarme-on", String(f.alarme));
  painel.dataset.calor = f.calor.toFixed(2);
  painel.dataset.luzes = f.luzes.toFixed(2);
}

// ---------- Comandos ----------
function rpc(prefixo, method, params) {
  rpcId = (rpcId % 1_000_000) + 1;
  publicar(`${prefixo}/rpc`, JSON.stringify({ id: rpcId, src: clientId, method, params }));
}

// pedido: { ligado } | { brilho } | { posicao } | { estore: "abrir"|"fechar"|"parar" }
function pedir(a, c, pedido) {
  if (!cliente?.connected) {
    mostrarErro("Sem ligação ao servidor. Tente de novo daqui a pouco.");
    atualizar(a.id);
    return;
  }
  mostrarErro(null);
  const prefixo = `domus/${codigo}/${a.id}`;
  const idc = c.n - 1; // componente Shelly
  let esperado = {};
  let qualquer = false;

  if ("ligado" in pedido) {
    esperado = { ligado: pedido.ligado };
    if (a.tipo === "shelly") {
      if (c.funcao === "luz") rpc(prefixo, "Light.Set", { id: idc, on: pedido.ligado });
      else publicar(`${prefixo}/command/switch:${idc}`, pedido.ligado ? "on" : "off");
    } else publicar(`${prefixo}/${c.n}/set`, pedido.ligado ? "1" : "0");
  } else if ("brilho" in pedido) {
    esperado = { ligado: true, brilho: pedido.brilho };
    if (a.tipo === "shelly") rpc(prefixo, "Light.Set", { id: idc, on: true, brightness: pedido.brilho });
    else { esperado = { brilho: pedido.brilho }; publicar(`${prefixo}/led_dimmer/set`, String(pedido.brilho)); }
  } else if ("posicao" in pedido || "estore" in pedido) {
    const alvo = "posicao" in pedido ? pedido.posicao : pedido.estore === "abrir" ? 100 : pedido.estore === "fechar" ? 0 : null;
    qualquer = true;
    if (alvo != null) esperado = { posicao: alvo };
    if (a.tipo === "shelly") {
      if ("posicao" in pedido) rpc(prefixo, "Cover.GoToPosition", { id: idc, pos: alvo });
      else rpc(prefixo, pedido.estore === "abrir" ? "Cover.Open" : pedido.estore === "fechar" ? "Cover.Close" : "Cover.Stop", { id: idc });
    } else if (alvo != null) publicar(`${prefixo}/${c.n}/set`, String(alvo));
  }
  if (a.tipo === "shelly") publicar(`${prefixo}/command`, "status_update");

  const chave = `${a.id}:${c.n}`;
  clearTimeout(pendentes[chave]?.timer);
  pendentes[chave] = {
    esperado,
    qualquer,
    timer: setTimeout(() => {
      delete pendentes[chave];
      const nome = c.temNome && a.canais.length > 1 ? `${a.nome} (${c.nome})` : a.nome;
      mostrarErro(`${nome} não respondeu. Verifique se está ligado à internet e tente de novo.`);
      atualizar(a.id);
    }, TEMPO_CONFIRMACAO),
  };
  atualizar(a.id);
}

function mostrarErro(texto) {
  $("painel-erro").hidden = !texto;
  $("painel-erro").textContent = texto ?? "";
}

// ---------- Alarme ----------
const ilusAlarme = criarIlustracao("alarme");
$("alarme-ilus").append(ilusAlarme);

function desenharAlarme() {
  const ativo = alarmePendente ? alarmePendente.valor : !!alarme?.ativo;
  $("alarme").classList.toggle("ativo", !!alarme?.ativo);
  atualizarIlustracao(ilusAlarme, "alarme", { ativo: !!alarme?.ativo });
  const estado = $("alarme-estado");
  if (alarmePendente) estado.textContent = alarmePendente.valor ? "A ativar…" : "A desativar…";
  else if (alarme == null) estado.textContent = "Estado desconhecido";
  else if (alarme.ativo) {
    const desde = alarme.desde ? new Date(alarme.desde).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }) : null;
    estado.textContent = desde ? `Ativo desde as ${desde}` : "Ativo";
  } else estado.textContent = "Desligado";
  const botao = $("alarme-botao");
  botao.textContent = ativo ? "Desativar" : "Ativar";
  botao.className = ativo ? "btn sec" : "btn";
  botao.disabled = !!alarmePendente || !$("alarme-confirmar").hidden;
}

$("alarme-botao").addEventListener("click", () => {
  const querAtivar = !alarme?.ativo;
  $("alarme-pergunta").textContent = querAtivar
    ? "Ativar o alarme? Portas a abrir e movimento passam a enviar alertas para o telemóvel."
    : "Desativar o alarme? Deixa de receber alertas de portas e movimento.";
  $("alarme-sim").textContent = querAtivar ? "Sim, ativar" : "Sim, desativar";
  $("alarme-sim").className = querAtivar ? "btn" : "btn perigo";
  $("alarme-sim").dataset.valor = querAtivar ? "1" : "0";
  $("alarme-confirmar").hidden = false;
  desenharAlarme();
  $("alarme-sim").focus();
});
$("alarme-nao").addEventListener("click", () => {
  $("alarme-confirmar").hidden = true;
  desenharAlarme();
  $("alarme-botao").focus();
});
$("alarme-sim").addEventListener("click", () => {
  $("alarme-confirmar").hidden = true;
  const valor = $("alarme-sim").dataset.valor === "1";
  if (!publicar(`domus/${codigo}/_alarme/set`, JSON.stringify({ ativo: valor }))) {
    mostrarErro("Sem ligação ao servidor. Tente de novo daqui a pouco.");
    desenharAlarme();
    return;
  }
  mostrarErro(null);
  clearTimeout(alarmePendente?.timer);
  alarmePendente = {
    valor,
    timer: setTimeout(() => {
      alarmePendente = null;
      mostrarErro("O alarme não respondeu. Tente de novo daqui a pouco.");
      desenharAlarme();
    }, TEMPO_CONFIRMACAO),
  };
  desenharAlarme();
});

// ---------- Histórico ----------
const ROTULO_EVENTO = { alarme: "Alarme", sensor: "Sensor", automacao: "Automação", aviso: "Aviso", erro: "Erro" };
function desenharHistorico() {
  const ul = $("lista-historico");
  const eventos = E.juntarEventos(historico, vivos);
  ul.replaceChildren();
  if (eventos.length === 0) {
    ul.append(el("li", "vazio", "Ainda não há eventos."));
    return;
  }
  const agora = Date.now();
  for (const ev of eventos) {
    const li = el("li", `evento evento-${ev.tipo}`);
    li.dataset.tipo = ev.tipo;
    li.append(el("b", null, ev.titulo || ROTULO_EVENTO[ev.tipo]));
    if (ev.mensagem) li.append(el("p", null, ev.mensagem));
    const t = el("time", null, [ROTULO_EVENTO[ev.tipo], ev.ts ? E.tempoRelativo(ev.ts, agora) : null].filter(Boolean).join(" · "));
    if (ev.ts) {
      t.dateTime = new Date(ev.ts).toISOString();
      t.title = new Date(ev.ts).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });
    }
    li.append(t);
    ul.append(li);
  }
}

// ---------- ntfy ----------
$("ntfy-copiar").addEventListener("click", async () => {
  const url = $("ntfy-url").textContent;
  const msg = $("ntfy-msg");
  try {
    await navigator.clipboard.writeText(url);
    msg.textContent = "Endereço copiado.";
  } catch {
    const r = document.createRange();
    r.selectNodeContents($("ntfy-url"));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    msg.textContent = "Endereço selecionado — use Copiar do seu telemóvel ou Ctrl+C.";
  }
});

// ---------- Arranque (no fim, depois de tudo estar definido) ----------
mostrarVista(false);
const guardado = lerLembrar();
if (guardado) entrar(guardado.codigo, guardado.password, { lembrar: true, automatico: true });
