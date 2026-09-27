// Área de cliente — liga-se diretamente ao servidor MQTT da Domus Energia.
// Protocolo: docs/PROTOCOLO-MQTT.md (v1), -v2.md (canais, alarme, automações) e -v3.md (modos,
// cenas, registo das automações, saúde, energia, definições, relatório).
// Todos os nomes e textos que vêm dos aparelhos ou do servidor entram só com textContent.
import * as E from "./estado.js";
import { criarIlustracao, atualizarIlustracao, criarIcone } from "./ilustracoes.js";
import { criarAutomacoes } from "./automacoes.js";
import { criarCenas } from "./cenas.js";
import { desenharSaude, desenharRelatorio, copiarRelatorio, criarDefinicoes } from "./paineis.js";
import * as PL from "./planos.js";
import { criarSubscricao, criarBloqueio, iconeCadeado } from "./subscricao.js";

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
let alarme = null;     // lerAlarme(_alarme): v2 { ativo, desde } ou v3 { estado, tipo, ate, ignorados, … }
let modo = null;       // lerModo(_modo) — só com o motor v3
let modoPendente = null; // { modo, forcar, timer }
let recusa = null;     // { modo, texto } — "Não armado: …" à espera de "Armar mesmo assim"
let energia = null;    // lerEnergia(_energia)
let saude = {};        // lerSaude(_saude)
let secao = "casa";    // secção visível
let plano = { ...PL.PLANO_OMISSAO }; // lerPlano(_plano) — sem `_plano` retido: conforto/ativo/manual (§2)
let ntfy = null;       // lerNtfy(_ntfy)
let erroPlanoModo = null; // "Disponível a partir do plano Conforto." do motor, ao mudar de modo
let credenciais = null; // { codigo, password } só em memória, para o /api (a mesma conta do MQTT)
let autenticado = false;
let historico = [];    // de _historico
let vivos = [];        // de _eventos desde que entrou
let rpcId = 0;
let listaRecebida = false; // já chegou `_aparelhos`?
let adiadas = [];      // mensagens de aparelhos que chegaram antes de `_aparelhos` (aplicadas depois)
const MAX_ADIADAS = 2000;
const temporizadores = new Set();

const publicarJson = (sufixo, obj) => publicar(`domus/${codigo}/${sufixo}`, JSON.stringify(obj));
const ligadoServidor = () => !!cliente?.connected;
const permite = (chave) => PL.permite(plano, chave);

// ---------- Plano e subscrição (docs/PROTOCOLO-PLANOS.md) ----------
const api = PL.criarApi({ fetch: (...a) => window.fetch(...a), base: cfg.apiUrl ?? "/api", credenciais: () => credenciais });
const subscricao = criarSubscricao({ api, codigo: () => codigo });
function abrirSubscricao({ escolher = false } = {}) {
  if (escolher) subscricao.abrirEscolha();
  mostrarSeccao("subscricao");
  subscricao.desenhar();
  ((escolher && $("escolher-titulo")) || $("titulo-subscricao")).focus();
}
const bloqueio = (chave, texto) => criarBloqueio(chave, () => abrirSubscricao({ escolher: true }), texto);

const definicoes = criarDefinicoes({ publicar: publicarJson, ligado: ligadoServidor, permite, bloqueio });
const cenas = criarCenas({ publicar: publicarJson, ligado: ligadoServidor, aparelhos: () => aparelhos });
const automacoes = criarAutomacoes({
  publicar: publicarJson,
  ligado: ligadoServidor,
  aparelhos: () => aparelhos,
  cenas: () => cenas.lista(),
  config: () => definicoes.config(),
});
const limiarEspera = () => definicoes.config()?.limiar_espera_w ?? E.LIMIAR_ESPERA_W;
const modeloDe = (a, agora = Date.now()) => E.modelo(a, estados[a.id], agora, limiarEspera());

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
  credenciais = null;
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
const SECCOES = ["casa", "automacoes", "aparelhos", "historico", "relatorio", "definicoes", "subscricao"];
function mostrarSeccao(nome) {
  secao = nome;
  // O relatório pertence à Casa; as Definições e a Subscrição não têm separador.
  const tab = nome === "relatorio" ? "casa" : nome;
  const semSeparador = nome === "definicoes" || nome === "subscricao";
  for (const s of separadores) {
    const sel = s.dataset.sec === tab;
    s.setAttribute("aria-selected", String(sel));
    s.tabIndex = sel || (semSeparador && s.dataset.sec === "casa") ? 0 : -1;
  }
  for (const k of SECCOES) $(`sec-${k}`).hidden = k !== nome;
  for (const [id, sec] of [["abrir-definicoes", "definicoes"], ["abrir-subscricao", "subscricao"]]) {
    $(id).classList.toggle("ativo", nome === sec);
    if (nome === sec) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
  }
  if (nome === "subscricao") subscricao.desenhar();
  if (nome === "aparelhos") redesenharSaude();
  if (nome === "relatorio") redesenharRelatorio();
}
$("abrir-definicoes").addEventListener("click", () => mostrarSeccao(secao === "definicoes" ? "casa" : "definicoes"));
$("abrir-subscricao").addEventListener("click", () => { if (secao === "subscricao") mostrarSeccao("casa"); else abrirSubscricao(); });
$("definicoes-subscricao").addEventListener("click", () => abrirSubscricao());
$("abrir-relatorio").addEventListener("click", () => { mostrarSeccao("relatorio"); $("relatorio-voltar").focus(); });
$("relatorio-voltar").addEventListener("click", () => { mostrarSeccao("casa"); $("abrir-relatorio").focus(); });
$("relatorio-copiar").addEventListener("click", copiarRelatorio);
// "Ampliar a instalação" → simulador de orçamento. Passa só o código de cliente (nunca a
// palavra-passe) pelo sessionStorage deste separador, para associar o pedido à conta.
$("ampliar").addEventListener("click", () => {
  try { if (codigo) sessionStorage.setItem("domus.simulador.codigo", codigo); } catch {}
});

// Tempos relativos ("há 3 min") atualizam-se sozinhos.
setInterval(() => {
  if (!entrou) return;
  for (const a of aparelhos) atualizar(a.id, false);
  desenharAlarme();
  desenharHistorico();
  if (secao === "aparelhos") redesenharSaude();
}, 20_000);
// Contagem decrescente do alarme (a armar / entrada), uma vez por segundo.
setInterval(() => {
  if (entrou && (alarme?.estado === "a_armar" || alarme?.estado === "entrada")) desenharAlarme();
}, 1000);

// Com a subscrição suspensa ou cancelada (§3) só se mostra o ecrã de suspensão.
function mostrarVista(sim = autenticado) {
  autenticado = sim;
  const basico = sim && PL.modoBasico(plano);
  $("vista-login").hidden = sim;
  $("vista-painel").hidden = !sim || basico;
  $("vista-suspensa").hidden = !basico;
  $("sair").hidden = !sim;
  if (basico) subscricao.desenharSuspensa();
}

function entrar(cod, password, { lembrar, automatico = false }) {
  terminar();
  codigo = cod;
  credenciais = { codigo: cod, password: String(password ?? "") };
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
      definicoes.desenhar();
      aplicarPlano(plano);
      if (abrirSubscricaoAoEntrar) { abrirSubscricaoAoEntrar = false; abrirSubscricao(); }
    }
    estadoLigacao(true);
    // O aviso de falta de ligação deixa de fazer sentido (os outros erros ficam).
    if ($("painel-erro").textContent === SEM_LIGACAO) mostrarErro(null);
    // `_plano` à parte: com a subscrição suspensa o servidor só deixa ler esse tópico (§3) e recusa o `#`.
    c.subscribe(`domus/${cod}/_plano`, { qos: 1 });
    c.subscribe(`domus/${cod}/#`, { qos: 1 }, (err, granted) => {
      if (err || granted?.some((g) => g.qos === 128)) mostrarErro("Não foi possível ler os seus aparelhos. Tente sair e entrar de novo.");
    });
    pedirEstadoShelly();
  });

  c.on("error", (err) => {
    if (c !== cliente) return;
    // CONNACK 4 (utilizador/palavra-passe errados) ou 5 (não autorizado): não insistir.
    if (err?.code === 4 || err?.code === 5 || /not authori[sz]ed|bad user/i.test(err?.message ?? "")) {
      apagarLembrar();
      terminar();
      credenciais = null;
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
  clearTimeout(modoPendente?.timer);
  codigo = null;
  credenciais = null;
  api.esquecer();
  plano = { ...PL.PLANO_OMISSAO };
  ntfy = null;
  erroPlanoModo = null;
  subscricao.limpar();
  entrou = false;
  aparelhos = [];
  estados = {};
  pendentes = {};
  cartoes = {};
  alarme = null;
  modo = null;
  modoPendente = null;
  recusa = null;
  energia = null;
  saude = {};
  historico = [];
  vivos = [];
  listaRecebida = false;
  adiadas = [];
  automacoes.limpar();
  cenas.limpar();
  definicoes.limpar();
  $("lista-saude").replaceChildren();
  $("relatorio-conteudo").replaceChildren();
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

// "Lembrar-me": guarda código e palavra-passe só neste navegador. A palavra-passe fica cifrada
// (AES-GCM) com uma chave NÃO exportável guardada no IndexedDB: quem ler ou copiar o
// localStorage não fica com ela. Não protege de código a correr na própria página.
const BD_CHAVES = "domus-chaves";
let versaoLembrar = 0; // "Sair" durante uma gravação em curso ganha sempre

function chaveLembrar(criar) {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BD_CHAVES, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("chaves");
    r.onerror = () => falha(r.error);
    r.onsuccess = async () => {
      const bd = r.result;
      const pedido = (modo, f) => new Promise((ok2, falha2) => {
        const p = f(bd.transaction("chaves", modo).objectStore("chaves"));
        p.onsuccess = () => ok2(p.result);
        p.onerror = () => falha2(p.error);
      });
      try {
        let chave = await pedido("readonly", (s) => s.get("lembrar"));
        if (!chave && criar) {
          chave = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
          await pedido("readwrite", (s) => s.put(chave, "lembrar"));
        }
        ok(chave ?? null);
      } catch (e) {
        falha(e);
      } finally {
        bd.close();
      }
    };
  });
}
const paraB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function lerLembrar() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_LEMBRAR));
    if (!v || typeof v.codigo !== "string") return null;
    $("form-login").elements.codigo.value = v.codigo;
    let password = null;
    if (typeof v.cifra === "string" && typeof v.iv === "string") {
      const chave = await chaveLembrar(false);
      if (chave) {
        const texto = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(v.iv) }, chave, deB64(v.cifra));
        password = new TextDecoder().decode(texto);
      }
    } else if (typeof v.password === "string") {
      password = v.password; // formato antigo, em texto simples: fica cifrado ao entrar
    }
    if (password === null) return null;
    $("form-login").elements.lembrar.checked = true;
    return { codigo: v.codigo, password };
  } catch {
    return null;
  }
}
async function guardarLembrar(cod, password) {
  const versao = versaoLembrar;
  try {
    const chave = await chaveLembrar(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifra = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(password));
    if (versao !== versaoLembrar) return;
    localStorage.setItem(CHAVE_LEMBRAR, JSON.stringify({ codigo: cod, iv: paraB64(iv), cifra: paraB64(cifra) }));
  } catch {
    // Sem IndexedDB ou WebCrypto (ex.: navegação privada): não guarda nada.
    apagarLembrar();
  }
}
function apagarLembrar() {
  versaoLembrar++;
  try { localStorage.removeItem(CHAVE_LEMBRAR); } catch {}
}

function publicar(topico, texto) {
  if (!cliente?.connected) return false;
  // Modo básico (§3): o servidor já não aceita escritas; a app não tenta.
  if (PL.modoBasico(plano)) return false;
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
    // Pedidos (…/set, …/executar, _fcm/registar) são nossos ou de outras apps: ignorar.
    if (resto !== "" && !(id === "_automacoes" && (resto === "registo" || resto === "avisos"))) return;
    switch (resto ? `${id}/${resto}` : id) {
      case "_aparelhos":
        aparelhos = E.lerAparelhos(texto);
        if (!listaRecebida) {
          // As mensagens retidas dos aparelhos podem chegar antes da lista: aplicá-las agora,
          // pela ordem de chegada, já com a função de cada canal.
          listaRecebida = true;
          const pendentesLista = adiadas;
          adiadas = [];
          for (const [idA, restoA, textoA, retidoA] of pendentesLista) {
            E.aplicarMensagem(estados, idA, aparelhos.find((x) => x.id === idA), restoA, textoA, { agora: Date.now(), retido: retidoA });
          }
        }
        desenhar();
        automacoes.desenhar();
        cenas.desenhar();
        pedirEstadoShelly();
        desenharAlarme();
        break;
      case "_alarme": {
        alarme = E.lerAlarme(texto);
        // v2 (sem `_modo`): o pedido confirma-se pelo próprio `_alarme`.
        if (modoPendente && !temV3() && alarme && alarme.ativo === (modoPendente.modo !== "casa")) resolverModo();
        desenharAlarme();
        resumo();
        break;
      }
      case "_modo": {
        modo = E.lerModo(texto);
        if (modoPendente && modo?.modo === modoPendente.modo) resolverModo();
        desenharAlarme();
        break;
      }
      case "_config":
        definicoes.receber(E.lerConfig(texto));
        for (const a of aparelhos) atualizar(a.id, false);
        resumo();
        break;
      case "_energia":
        energia = E.lerEnergia(texto);
        resumo();
        break;
      case "_saude":
        saude = E.lerSaude(texto);
        E.notarSaude(estados, saude);
        for (const a of aparelhos) if (a.bateria) atualizar(a.id, false);
        if (secao === "aparelhos") redesenharSaude();
        if (secao === "relatorio") redesenharRelatorio();
        break;
      case "_cenas":
        cenas.receberLista(E.lerCenas(texto), texto);
        automacoes.desenhar();
        break;
      case "_automacoes":
        automacoes.receberLista(E.lerAutomacoes(texto), texto);
        break;
      case "_automacoes/registo":
        automacoes.receberRegisto(E.lerRegisto(texto));
        break;
      case "_automacoes/avisos":
        automacoes.receberAvisos(E.lerAvisos(texto));
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
        if (ev.tipo === "erro") receberErro(ev);
        if (ev.aparelho) atualizar(ev.aparelho);
        break;
      }
      case "_ntfy":
        ntfy = E.lerNtfy(texto);
        $("ntfy-msg").textContent = "";
        desenharNtfy();
        break;
      case "_plano": {
        const p = PL.lerPlano(texto);
        if (p) aplicarPlano(p); // inválido: fica o que estava (como o motor)
        break;
      }
    }
    return;
  }

  if (!listaRecebida) {
    if (adiadas.length < MAX_ADIADAS) adiadas.push([id, resto, texto, retido]);
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
      const m = modeloDe(a).canais.find((c) => c.n === r.canal);
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

  for (const g of E.agruparPorDivisao(aparelhos)) {
    if (g.nome) lista.appendChild(el("h3", "divisao-titulo", g.nome));
    for (const a of g.itens) desenharAparelho(lista, a);
  }
  resumo();
}

function desenharAparelho(lista, a) {
  {
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
    const s = interruptor(`Ligar ou desligar ${nomeCompleto}`, (v) => {
      // Desligar o disjuntor geral deixa a casa às escuras: confirmar na página primeiro.
      if (!v && E.ehGeral(aparelhos, a.id, c.n)) { confirmarGeral(a, c, linha); return; }
      linha.confirmar?.remove();
      pedir(a, c, { ligado: v });
    });
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

function confirmarGeral(a, c, linha) {
  linha.sw.input.checked = true; // ainda não mudou nada
  if (linha.confirmar?.isConnected) { linha.confirmar.querySelector("p").focus(); return; }
  const quem = E.comArtigo(a.canais.length === 1 ? a.nome : E.nomeCanal(aparelhos, a.id, c.n));
  const conf = el("div", "confirmar confirmar-risco confirmar-geral");
  conf.setAttribute("role", "group");
  const p = el("p", null, `Desligar ${quem}? A casa inteira fica sem luz.`);
  p.tabIndex = -1;
  p.id = `geral-${a.id}-${c.n}`;
  conf.setAttribute("aria-labelledby", p.id);
  const botoes = el("div", "botoes");
  const sim = el("button", "btn perigo pequeno", "Sim, desligar");
  sim.type = "button";
  sim.addEventListener("click", () => { conf.remove(); linha.confirmar = null; pedir(a, c, { ligado: false }); });
  const nao = el("button", "btn sec pequeno", "Cancelar");
  nao.type = "button";
  nao.addEventListener("click", () => { conf.remove(); linha.confirmar = null; linha.sw.input.focus(); });
  botoes.append(sim, nao);
  conf.append(p, botoes);
  linha.raiz.append(conf);
  linha.confirmar = conf;
  p.focus();
}

function atualizar(id, comResumo = true) {
  const k = cartoes[id];
  const a = aparelhos.find((x) => x.id === id);
  if (k && a) {
    const agora = Date.now();
    const m = modeloDe(a, agora);
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
      m.potenciaW != null && `${E.decimal(m.potenciaW, 1)} W`,
      m.tensaoV != null && `${m.tensaoV.toFixed(0)} V`,
      m.correnteA != null && `${E.decimal(m.correnteA, 2)} A`,
      m.energiaKWh != null && E.kwhTexto(m.energiaKWh, 2),
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
      linha.estado.textContent = v.ligado == null ? "Sem informação" : v.ligado ? (c.emEspera && !p ? "Em espera" : "Ligado") : "Desligado";
      break;
    case "luz":
      linha.estado.textContent = v.ligado == null ? "Sem informação"
        : v.ligado ? `${c.emEspera && !p ? "Em espera" : "Ligada"}${v.brilho != null ? ` · ${v.brilho} %` : ""}` : "Desligada";
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
  linha.raiz.classList.toggle("em-espera", !!c.emEspera && !p);
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
  const ms = aparelhos.map((a) => modeloDe(a, agora));
  const r = E.resumo(ms, alarme);
  $("total-potencia").textContent = `${r.potenciaW.toFixed(0)} W`;
  $("total-ligados").textContent = `${r.ligados} / ${r.circuitos}`;
  $("total-online").textContent = `${r.online} / ${r.comLigacao}`;
  $("total-portas").textContent = r.portas ? String(r.portasAbertas) : "—";
  $("resumo-portas").classList.toggle("alerta", r.portasAbertas > 0 && !!alarme?.ativo);
  const comEnergia = permite("energia");
  $("resumo-energia").classList.toggle("bloqueado", !comEnergia);
  $("energia-bloqueio").hidden = comEnergia;
  if (comEnergia) {
    $("total-hoje").textContent = energia?.hojeKWh != null ? E.kwhTexto(energia.hojeKWh) : "—";
    $("hoje-rotulo").textContent = energia?.ontemKWh != null ? `Energia hoje · ontem ${E.kwhTexto(energia.ontemKWh)}` : "Energia hoje";
  } else {
    $("total-hoje").replaceChildren(iconeCadeado());
    $("hoje-rotulo").textContent = "Energia hoje e ontem";
  }

  const f = E.fundoVivo(r);
  const painel = $("painel");
  painel.style.setProperty("--luzes", f.luzes.toFixed(3));
  painel.style.setProperty("--calor", f.calor.toFixed(3));
  painel.style.setProperty("--alarme-on", String(f.alarme));
  painel.dataset.calor = f.calor.toFixed(2);
  painel.dataset.luzes = f.luzes.toFixed(2);
  if (secao === "relatorio") redesenharRelatorio();
}

function redesenharSaude() {
  const bloq = !permite("saude");
  $("saude-bloqueada").hidden = !bloq;
  $("saude-sub").hidden = bloq;
  $("lista-saude").hidden = bloq;
  if (bloq) { $("lista-saude").replaceChildren(); return; }
  const agora = Date.now();
  desenharSaude(E.listaSaude(aparelhos.map((a) => modeloDe(a, agora)), saude, agora), agora);
}
function redesenharRelatorio() {
  const agora = Date.now();
  const comEnergia = permite("energia");
  desenharRelatorio(E.construirRelatorio({ aparelhos, modelos: aparelhos.map((a) => modeloDe(a, agora)), saude, energia: comEnergia ? energia : null, modo, alarme, agora }),
    { energia: comEnergia, bloqueio });
}

// ---------- Comandos ----------
function rpc(prefixo, method, params) {
  rpcId = (rpcId % 1_000_000) + 1;
  publicar(`${prefixo}/rpc`, JSON.stringify({ id: rpcId, src: clientId, method, params }));
}

// pedido: { ligado } | { brilho } | { posicao } | { estore: "abrir"|"fechar"|"parar" }
function pedir(a, c, pedido) {
  if (!cliente?.connected) {
    mostrarErro(SEM_LIGACAO);
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
    else {
      // Como o motor: acender o canal e depois o brilho (o led_dimmer sozinho não liga uma luz apagada).
      publicar(`${prefixo}/${c.n}/set`, "1");
      publicar(`${prefixo}/led_dimmer/set`, String(pedido.brilho));
    }
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

const SEM_LIGACAO = "Sem ligação ao servidor. Tente de novo daqui a pouco.";
function mostrarErro(texto) {
  $("painel-erro").hidden = !texto;
  $("painel-erro").textContent = texto ?? "";
}

// ---------- Modo da casa e alarme (v3 §2; com o motor v2: só Casa/Fora via _alarme/set) ----------
const ilusAlarme = criarIlustracao("alarme");
$("alarme-ilus").append(ilusAlarme);
const TEMPO_MODO = 10_000;
const DESC_MODO = { casa: "Desarmado", fora: "Alarme total", noite: "Portas e janelas", ferias: "Alarme + simulação" };
const botoesModo = {};
for (const m of E.MODOS) {
  const b = el("button", "modo-opcao");
  b.type = "button";
  b.dataset.modo = m;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", "false");
  const ic = el("span", "modo-icone");
  ic.append(criarIcone(m));
  const cad = el("span", "modo-cadeado");
  cad.hidden = true;
  cad.append(iconeCadeado());
  b.append(ic, el("span", "modo-nome", E.NOME_MODO[m]), el("span", "modo-desc", DESC_MODO[m]), cad);
  b.addEventListener("click", () => pedirModo(m, false));
  b.addEventListener("keydown", (e) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const lista = E.MODOS.filter((x) => !botoesModo[x].disabled);
    const i = lista.indexOf(m) + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
    botoesModo[lista[(i + lista.length) % lista.length]]?.focus();
  });
  botoesModo[m] = b;
  $("modo-seletor").append(b);
}

// v3 quando o motor publica `_modo` (ou um `_alarme` com `estado`).
const temV3 = () => modo != null || !!alarme?.v3;
function modoAtual() {
  if (modo) return modo.modo;
  if (alarme) return alarme.ativo ? "fora" : "casa";
  return null;
}

function pedirModo(m, forcar) {
  if (m !== "casa" && !permite("alarme")) {
    // Fora do plano: não se pede nada ao motor; realça o cadeado.
    const caixa = $("modo-plano");
    caixa.classList.remove("realce");
    void caixa.offsetWidth;
    caixa.classList.add("realce");
    return;
  }
  if (!cliente?.connected) { mostrarErro(SEM_LIGACAO); return; }
  if (!forcar && m === modoAtual() && !modoPendente) return;
  mostrarErro(null);
  recusa = null;
  erroPlanoModo = null;
  let ok;
  if (temV3()) ok = publicarJson("_modo/set", { modo: m, forcar: !!forcar, por: "web" });
  else {
    if (m !== "casa" && m !== "fora") return;
    ok = publicarJson("_alarme/set", { ativo: m === "fora" });
  }
  if (!ok) return;
  clearTimeout(modoPendente?.timer);
  modoPendente = {
    modo: m,
    forcar: !!forcar,
    timer: setTimeout(() => {
      modoPendente = null;
      mostrarErro("O servidor não respondeu à mudança de modo. Tente de novo daqui a pouco.");
      desenharAlarme();
    }, TEMPO_MODO),
  };
  desenharAlarme();
}
function resolverModo() {
  clearTimeout(modoPendente?.timer);
  modoPendente = null;
}

// Eventos `erro` do motor: "Não armado: …" é da mudança de modo; o resto vai para quem estiver à espera.
function receberErro(ev) {
  const texto = ev.mensagem || ev.titulo || "";
  // "Disponível a partir do plano Conforto." ao mudar de modo: mostrar no cartão do modo, com o cadeado.
  if (PL.eErroDePlano(texto) && modoPendente) {
    resolverModo();
    erroPlanoModo = texto;
    desenharAlarme();
    $("modo-plano").querySelector("button")?.focus();
    return;
  }
  if (modoPendente && /^N[ãa]o armado/i.test(texto)) {
    recusa = { modo: modoPendente.modo, texto };
    resolverModo();
    desenharAlarme();
    $("modo-forcar").focus();
    return;
  }
  if (automacoes.receberErro(ev) || cenas.receberErro(ev) || definicoes.receberErro(ev)) return;
  if (modoPendente) { resolverModo(); mostrarErro(texto || "O servidor recusou a mudança de modo."); desenharAlarme(); }
}
$("modo-forcar").addEventListener("click", () => { if (recusa) pedirModo(recusa.modo, true); });
$("modo-recusa-cancelar").addEventListener("click", () => { recusa = null; desenharAlarme(); });
$("alarme-desarmar").addEventListener("click", () => pedirModo("casa", false));

function desenharAlarme() {
  const v3 = temV3();
  const atual = modoAtual();
  const est = alarme?.estado ?? null;
  const cartao = $("modos");
  cartao.classList.toggle("ativo", !!alarme?.ativo);
  cartao.classList.toggle("disparado", est === "disparado");
  cartao.classList.toggle("entrada", est === "entrada");
  cartao.dataset.estado = est ?? "";
  atualizarIlustracao(ilusAlarme, "alarme", { ativo: !!alarme?.ativo });

  const alvo = modoPendente ? modoPendente.modo : atual;
  const semAlarme = !permite("alarme");
  for (const m of E.MODOS) {
    const b = botoesModo[m];
    const sel = alvo === m;
    const bloq = semAlarme && m !== "casa";
    b.classList.toggle("bloqueado", bloq);
    if (bloq) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    b.querySelector(".modo-cadeado").hidden = !bloq;
    b.setAttribute("aria-checked", String(sel));
    b.tabIndex = sel || (!alvo && m === "casa") ? 0 : -1;
    b.classList.toggle("pendente", !!modoPendente && modoPendente.modo === m);
    // Com o motor v2 só há Casa (desarmado) e Fora (alarme ativo).
    const soV3 = !v3 && (m === "noite" || m === "ferias");
    b.disabled = !!modoPendente || atual == null || soV3;
    b.title = soV3 ? "Disponível quando o servidor for atualizado" : bloq ? PL.textoDisponivel("alarme") : "";
  }
  // Cadeado dos modos (plano sem alarme) ou recusa do motor por causa do plano.
  const caixaPlano = $("modo-plano");
  const textoPlano = erroPlanoModo ?? (semAlarme ? PL.textoDisponivel("alarme") : null);
  caixaPlano.hidden = !textoPlano;
  if (textoPlano && caixaPlano.dataset.texto !== textoPlano) {
    caixaPlano.dataset.texto = textoPlano;
    caixaPlano.replaceChildren(bloqueio("alarme", textoPlano));
  } else if (!textoPlano) { caixaPlano.dataset.texto = ""; caixaPlano.replaceChildren(); }

  const agora = Date.now();
  const hora = (t) => (t ? E.horaLisboa(t) : null);
  const estado = $("alarme-estado");
  // Só muda o texto quando muda mesmo: é uma região "status" e os leitores de ecrã repetiriam
  // a mesma frase a cada segundo durante a contagem.
  let frase;
  if (modoPendente) frase = `A mudar para ${E.NOME_MODO[modoPendente.modo]}${modoPendente.forcar ? " (ignorando o que está aberto)" : ""}…`;
  else if (!alarme && !modo) frase = "Estado desconhecido";
  else if (!v3) frase = alarme.ativo ? (alarme.desde ? `Alarme ativo desde as ${hora(alarme.desde)}` : "Alarme ativo") : "Alarme desligado";
  else {
    const t = {
      desarmado: "Alarme desarmado",
      a_armar: `A armar — saia até às ${hora(alarme?.ate) ?? "…"}`,
      armado: `Alarme armado (${alarme?.tipo === "perimetro" ? "portas e janelas" : "total"})${alarme?.desde ? ` desde as ${hora(alarme.desde)}` : ""}`,
      entrada: "Porta aberta — desarme o alarme",
      disparado: `ALARME DISPARADO${alarme?.desde ? ` às ${hora(alarme.desde)}` : ""}`,
    }[est] ?? "";
    frase = t || (modo ? `Modo ${E.NOME_MODO[modo.modo]}` : "");
  }
  if (estado.textContent !== frase) estado.textContent = frase;

  // Contagem decrescente (a armar / entrada) e disparado
  const cont = $("alarme-contagem");
  if (v3 && (est === "a_armar" || est === "entrada" || est === "disparado")) {
    cont.hidden = false;
    cont.className = `alarme-contagem ${est}`;
    $("contagem-titulo").textContent = est === "a_armar" ? "Tempo para sair" : est === "entrada" ? "Desarme o alarme" : "Alarme disparado!";
    $("contagem-valor").textContent = est === "disparado" ? "" : E.contagem(alarme.ate, agora) ?? "";
    $("contagem-valor").hidden = est === "disparado";
    $("alarme-desarmar").hidden = est === "a_armar";
    $("alarme-desarmar").disabled = !!modoPendente;
  } else cont.hidden = true;

  // Aberturas ignoradas ao armar com "forcar"
  const ign = $("alarme-ignorados");
  const nomes = (alarme?.ignorados ?? []).map((x) => (x.canal != null ? E.nomeCanal(aparelhos, x.aparelho, x.canal) : aparelhos.find((a) => a.id === x.aparelho)?.nome ?? x.aparelho));
  ign.hidden = !(v3 && alarme?.ativo && nomes.length);
  ign.textContent = nomes.length ? `Ignorado pelo alarme (estava aberto ao armar): ${nomes.join(", ")}` : "";

  // Recusa "Não armado: …"
  $("modo-recusa").hidden = !recusa;
  if (recusa) $("modo-recusa-texto").textContent = `${recusa.texto} Feche e tente de novo, ou arme o modo ${E.NOME_MODO[recusa.modo]} ignorando o que está aberto.`;
}

// ---------- Histórico ----------
const ROTULO_EVENTO = { alarme: "Alarme", sensor: "Sensor", automacao: "Automação", aviso: "Aviso", erro: "Erro", modo: "Modo" };
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

// ---------- ntfy (notificações: plano Conforto) ----------
const ntfyBloqueio = bloqueio("notificacoes");
$("ntfy-bloqueio").append(ntfyBloqueio);
function desenharNtfy() {
  const bloq = !permite("notificacoes");
  // Sem o plano: a caixa aparece na mesma, com o cadeado (para se saber que existe).
  $("ntfy").hidden = !bloq && !ntfy;
  $("ntfy").classList.toggle("bloqueado", bloq);
  $("ntfy-bloqueio").hidden = !bloq;
  $("ntfy-texto").textContent = bloq ? "Receba no telemóvel os alertas da sua casa: alarme, portas abertas, aparelhos sem ligação e pilhas a acabar." : "Instale a app gratuita ntfy e subscreva este endereço para receber os alertas da sua casa.";
  document.querySelector("#ntfy .ntfy-linha").hidden = bloq;
  $("ntfy-url").textContent = bloq ? "" : ntfy?.url ?? "";
}

// ---------- Plano ----------
$("energia-bloqueio").append(bloqueio("energia"));
$("saude-bloqueada").append(bloqueio("saude"));
function aplicarPlano(p) {
  const antes = PL.decisoes(plano);
  plano = p;
  subscricao.receber(p);
  const depois = PL.decisoes(p);
  if (!entrou) return;
  mostrarVista(true);
  subscricao.desenharAviso(() => abrirSubscricao());
  if (secao === "subscricao") subscricao.desenhar();
  erroPlanoModo = null; // com o plano conhecido, o cadeado diz o resto
  desenharAlarme();
  resumo();
  desenharNtfy();
  if (secao === "aparelhos") redesenharSaude();
  if (antes.notificacoes !== depois.notificacoes || antes.relatorio_diario !== depois.relatorio_diario) definicoes.replano();
}

// Regresso do Stripe (?subscricao=ok|cancelada): aviso e limpa o endereço.
let abrirSubscricaoAoEntrar = false;
let toastTimer = null;
function mostrarToast(texto, tipo = "ok") {
  const t = $("toast");
  $("toast-texto").textContent = texto;
  t.className = `toast ${tipo}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 12_000);
}
$("toast-fechar").addEventListener("click", () => { clearTimeout(toastTimer); $("toast").hidden = true; });
{
  const r = PL.regressoStripe(window.location.search);
  if (r) {
    mostrarToast(r.texto, r.tipo);
    abrirSubscricaoAoEntrar = true;
    try { history.replaceState(null, "", window.location.pathname + window.location.hash); } catch {}
  }
}

// ---------- ntfy: copiar ----------
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
lerLembrar().then((guardado) => {
  if (guardado && !cliente) entrar(guardado.codigo, guardado.password, { lembrar: true, automatico: true });
});
