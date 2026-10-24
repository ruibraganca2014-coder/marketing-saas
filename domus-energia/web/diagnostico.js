// App de diagnóstico de avarias (decisões do dono, 2026-10-24; docs/ELETRICISTAS.md "App de diagnóstico"): para o
// eletricista em obra (sessão da área do eletricista) e para a equipa do painel (sessão do painel, qualquer papel) — não
// há conta nova: sem sessão, a página leva às entradas que já existem.
// - Instalável (diagnostico.json) e sem rede: diagnostico-sw.js guarda a página, os módulos e as árvores; os
//   diagnósticos ficam no IndexedDB do telemóvel e sincronizam quando há rede e sessão (o mesmo id = o mesmo registo).
//   Sem rede, se já se viu uma sessão válida neste telemóvel, continua a funcionar com quem estava.
// - Cada diagnóstico: escolher a anomalia → barreira de segurança (EPI e as cinco regras de ouro, todos marcados) → passo
//   a passo (o que fazer/medir, o valor esperado com a unidade, a referência ao manual) → causa provável e ação. Voltar,
//   recomeçar, "Não sei / não consigo medir" (→ parar e chamar apoio) e "Sinal de perigo" em qualquer passo (→ "Parar e
//   isolar"). Os passos feitos com tensão vão a vermelho, com o aviso.
// - No fim: nota, fotos (reduzidas no telemóvel, até 1 MB, até 6), ligar a um trabalho (eletricista) ou a um pedido (CEO
//   e comercial) e "Enviar para a ficha" (o diagnóstico da avaria, com a mesma validação da ficha).
// Rotas no endereço: #/ (início), #/nova/<árvore> (barreira de segurança), #/d/<id> (um diagnóstico). Só textContent.
import { ARVORES, GRUPOS, arvorePorId, VERSAO_ARVORES, procurar } from "./diagnostico/arvores.js";
import {
  EPI, REGRAS_OURO, REF_SEGURANCA, AVISO_TENSAO, SINAIS_PERIGO, PARAR_ISOLAR, NOME_AVALIACAO,
  atual, noDe, responder, fimDe, variaveis, textoLimite, lerNumero, paraFicha, novoId,
} from "./diagnostico/motor.js";
import { MANUAL_BT, ligacaoManual } from "./manual-bt.js";
import { reduzirFoto } from "./simulador/fotos.js";
import { confirmarEmDoisToques } from "./confirmar.js";

const cfg = window.DOMUS ?? {};
const base = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
const API_ELETRICISTA = `${base ? `${base}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "")}/eletricista/`;
const API_PAINEL = "/painel/api/";
const credenciais = base ? "include" : "same-origin";
const FOTOS_MAX = 6;

const $ = (id) => document.getElementById(id);
const el = (tag, classe, texto) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined && texto !== null) e.textContent = String(texto);
  return e;
};
const com = (pai, ...filhos) => { pai.append(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false)); return pai; };
const botao = (texto, classe = "btn", fn = null) => { const b = el("button", classe, texto); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; };
const selo = (t, tipo = "") => el("span", `selo ${tipo}`.trim(), t);
const dataTxt = (iso) => (iso ? new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const agoraIso = () => new Date().toISOString();

let tAviso;
function aviso(t) {
  const a = $("aviso");
  a.textContent = t;
  a.classList.add("visivel");
  clearTimeout(tAviso);
  tAviso = setTimeout(() => a.classList.remove("visivel"), 4000);
}

// ---------------------------------------------------------------- IndexedDB (no telemóvel)
const BD = "domus-diagnostico";
let bdAberta = null;
function abrirBd() {
  bdAberta ??= new Promise((ok, falhou) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("diagnosticos", { keyPath: "id" }).createIndex("autor", "autor");
      db.createObjectStore("fotos", { keyPath: "id" }).createIndex("diagnostico", "diagnostico_id");
      db.createObjectStore("estado", { keyPath: "chave" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falhou(r.error);
  });
  return bdAberta;
}
async function bd(loja, modo, fn) {
  const db = await abrirBd();
  return new Promise((ok, falhou) => {
    const tx = db.transaction(loja, modo);
    let resultado;
    const pedido = fn(tx.objectStore(loja));
    if (pedido) pedido.onsuccess = () => { resultado = pedido.result; };
    tx.oncomplete = () => ok(resultado);
    tx.onerror = () => falhou(tx.error);
    tx.onabort = () => falhou(tx.error);
  });
}
const ler = (loja, chave) => bd(loja, "readonly", (s) => s.get(chave));
const gravar = (loja, valor) => bd(loja, "readwrite", (s) => s.put(valor));
const apagar = (loja, chave) => bd(loja, "readwrite", (s) => s.delete(chave));
const todosDe = (loja, indice, valor) => bd(loja, "readonly", (s) => s.index(indice).getAll(valor));

// ---------------------------------------------------------------- quem está (sessões que já existem)
// sessao = { tipo: "eletricista" | "painel", nome, email, papel?, visto } — guardada no telemóvel para trabalhar sem rede.
let sessao = null;
let semRede = !navigator.onLine;
const chaveAutor = (s) => (s ? `${s.tipo}:${s.email}` : "");
const apiDe = (s) => (s?.tipo === "painel" ? `${API_PAINEL}diagnosticos` : `${API_ELETRICISTA}diagnosticos`);
const manualDe = (s) => (s?.tipo === "painel" ? `${API_PAINEL}${MANUAL_BT.ficheiro}` : `${API_ELETRICISTA}${MANUAL_BT.ficheiro}`);
const podeLigarPedido = (s) => s?.tipo === "painel" && ["ceo", "comercial"].includes(s.papel);

class ErroPedido extends Error { constructor(estado, m) { super(m); this.estado = estado; } }
async function pedir(url, { corpo, bruto = false, metodo } = {}) {
  const opcoes = { method: metodo ?? (corpo === undefined ? "GET" : "POST"), credentials: url.startsWith(API_PAINEL) ? "same-origin" : credenciais, headers: { Accept: "application/json" }, cache: "no-store" };
  if (bruto) { opcoes.headers["Content-Type"] = corpo.type || "image/jpeg"; opcoes.body = corpo; }
  else if (corpo !== undefined) { opcoes.headers["Content-Type"] = "application/json"; opcoes.body = JSON.stringify(corpo); }
  let r;
  try { r = await fetch(url, opcoes); } catch { throw new ErroPedido(0, "Sem ligação ao servidor."); }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw new ErroPedido(r.status, typeof j?.erro === "string" ? j.erro : `Não foi possível (erro ${r.status}).`);
  return j;
}

/** Pergunta às duas áreas quem está (a última que funcionou primeiro). Sem rede, fica a sessão guardada. */
async function verSessao() {
  const guardada = await ler("estado", "sessao").catch(() => null);
  const ordem = guardada?.tipo === "painel" ? ["painel", "eletricista"] : ["eletricista", "painel"];
  let falhouRede = false;
  for (const tipo of ordem) {
    try {
      if (tipo === "eletricista") {
        const r = await pedir(`${API_ELETRICISTA}eu`);
        return guardarSessao({ tipo, nome: r.eletricista?.nome ?? "", email: r.eletricista?.email ?? "", papel: null });
      }
      const r = await pedir(`${API_PAINEL}eu`);
      return guardarSessao({ tipo, nome: r.utilizador?.nome ?? "", email: r.utilizador?.email ?? "", papel: r.utilizador?.papel ?? null });
    } catch (e) {
      if (e.estado === 0) falhouRede = true;
    }
  }
  if (falhouRede) { semRede = true; return guardada ? { ...guardada.valor, guardada: true } : null; }
  // Com rede e sem sessão em nenhuma das áreas: a sessão guardada já não vale.
  await apagar("estado", "sessao").catch(() => {});
  return null;
}
async function guardarSessao(s) {
  const valor = { ...s, visto: agoraIso() };
  await gravar("estado", { chave: "sessao", tipo: s.tipo, valor }).catch(() => {});
  return valor;
}

function mostrarQuem() {
  $("dg-quem").textContent = sessao ? `${sessao.nome || sessao.email}${sessao.tipo === "painel" ? " · Painel" : " · Eletricista"}` : "Domus Energia";
  $("dg-rede").hidden = !semRede;
}

// ---------------------------------------------------------------- referências ao manual
function refs(no) {
  const lista = Array.isArray(no?.ref) ? no.ref : no?.ref ? [no.ref] : [];
  if (!lista.length) return null;
  const p = el("p", "dg-ref pequeno");
  p.append("Manual: ");
  lista.forEach((r, i) => {
    if (i) p.append(" · ");
    const texto = `${r.cap}, p. ${r.pagina}`;
    if (semRede) p.append(el("span", null, texto));
    else {
      const a = el("a", null, texto);
      a.href = ligacaoManual(manualDe(sessao), r.pagina);
      a.target = "_blank";
      a.rel = "noopener";
      p.append(a);
    }
  });
  if (semRede) p.append(el("span", "suave", " (o PDF abre com rede)"));
  return p;
}

// ---------------------------------------------------------------- guardar e sincronizar
async function guardarDiag(d) {
  d.alterado = agoraIso();
  d.sincronizado = false;
  delete d.erro_sinc;
  await gravar("diagnosticos", d);
  sincronizar();
}
/** O registo como o servidor o recebe (sem os campos só do telemóvel). */
function paraServidor(d) {
  const r = {
    id: d.id, arvore: d.arvore, arvore_versao: d.arvore_versao, titulo: d.titulo, estado: d.estado, seguranca: d.seguranca, passos: d.passos,
    causa: d.causa ?? null, acao: d.acao ?? null, tipo: d.tipo ?? null, perigo: d.perigo ?? null, nota: d.nota || null, iniciado: d.iniciado, terminado: d.terminado ?? null,
  };
  if (sessao?.tipo === "painel") r.orcamento_id = d.orcamento_id ?? null;
  else r.trabalho_id = d.trabalho_id ?? null;
  return r;
}

let aSincronizar = null;
/** Envia o que falta (diagnósticos e depois fotos). Sem rede ou sem sessão válida, fica para depois. */
function sincronizar() {
  aSincronizar ??= (async () => {
    try {
      if (!sessao) return;
      if (sessao.guardada) {
        // Sessão guardada (a app abriu sem rede): confirma-a primeiro; ainda sem rede (ou já sem sessão), fica para depois.
        const s = await verSessao().catch(() => null);
        if (!s || s.guardada) return;
        sessao = s;
        semRede = false;
        mostrarQuem();
      }
      const meus = await todosDe("diagnosticos", "autor", chaveAutor(sessao));
      for (const d of meus.filter((x) => !x.sincronizado && !x.erro_sinc)) {
        try {
          await pedir(apiDe(sessao), { corpo: paraServidor(d) });
          await marcar(d.id, { sincronizado: true });
        } catch (e) {
          if (e.estado === 0) { semRede = true; mostrarQuem(); return; }
          if (e.estado === 409) await marcar(d.id, { sincronizado: true });   // o servidor já tem o final
          else if ((e.estado === 404 || e.estado === 401) && !(await sessaoAinda())) return;
          else await marcar(d.id, { erro_sinc: e.message });
        }
      }
      for (const d of meus) {
        const atual2 = await ler("diagnosticos", d.id);
        if (!atual2?.sincronizado) continue;
        for (const f of (await todosDe("fotos", "diagnostico", d.id)).filter((x) => !x.enviada && !x.recusada)) {
          try {
            await pedir(`${apiDe(sessao)}/${d.id}/fotos/${f.id}`, { corpo: f.blob, bruto: true });
            await gravar("fotos", { ...f, enviada: true });
          } catch (e) {
            if (e.estado === 0) { semRede = true; mostrarQuem(); return; }
            if ((e.estado === 401 || e.estado === 404) && !(await sessaoAinda())) return;
            await gravar("fotos", { ...f, recusada: e.message });
          }
        }
      }
    } finally {
      aSincronizar = null;
      desenharEstadoSinc();
    }
  })();
  return aSincronizar;
}
async function marcar(id, campos) {
  const d = await ler("diagnosticos", id);
  if (!d) return;
  if (campos.sincronizado) delete d.erro_sinc;
  await gravar("diagnosticos", { ...d, ...campos });
}
/**
 * Depois de um 401/404: a sessão ainda vale? (Confirma-se com o "eu": um 404 também pode ser um diagnóstico recusado.)
 * Se já não vale, o telemóvel fica sem sessão — os diagnósticos ficam guardados e sincronizam quando voltar a entrar.
 */
async function sessaoAinda() {
  const s = await verSessao().catch(() => null);
  if (s && !s.guardada && chaveAutor(s) === chaveAutor(sessao)) return true;
  sessao = s;
  mostrarQuem();
  if (!s) aviso("A sessão terminou: entre de novo para sincronizar. Os diagnósticos ficam guardados neste telemóvel.");
  return false;
}

async function porSincronizar() {
  if (!sessao) return { diagnosticos: 0, fotos: 0 };
  const meus = await todosDe("diagnosticos", "autor", chaveAutor(sessao));
  let fotos = 0;
  for (const d of meus) fotos += (await todosDe("fotos", "diagnostico", d.id)).filter((f) => !f.enviada && !f.recusada).length;
  return { diagnosticos: meus.filter((d) => !d.sincronizado).length, fotos };
}
async function desenharEstadoSinc() {
  const caixa = $("dg-sinc");
  if (!caixa) return;
  const n = await porSincronizar();
  const total = n.diagnosticos + n.fotos;
  caixa.replaceChildren();
  if (!total) { com(caixa, el("p", "pequeno suave", sessao?.guardada ? "Sem rede: o que fizer fica guardado neste telemóvel." : "Tudo sincronizado com o servidor.")); return; }
  const partes = [n.diagnosticos ? `${n.diagnosticos} ${n.diagnosticos === 1 ? "diagnóstico" : "diagnósticos"}` : null, n.fotos ? `${n.fotos} ${n.fotos === 1 ? "foto" : "fotos"}` : null].filter(Boolean).join(" e ");
  com(caixa, el("p", "nota", `Por enviar: ${partes}. ${semRede || sessao?.guardada ? "Envia-se sozinho quando houver rede." : ""}`.trim()),
    semRede || sessao?.guardada ? null : botao("Sincronizar agora", "btn sec mini", () => sincronizar()));
}

// ---------------------------------------------------------------- ecrãs
function vista(...filhos) {
  $("dg-a-carregar").hidden = true;
  const v = $("dg-vista");
  v.replaceChildren(...filhos.flat().filter(Boolean));
  window.scrollTo(0, 0);
  $("conteudo").focus({ preventScroll: true });
}

function ecraEntrar() {
  document.title = "Entrar | Diagnóstico | Domus Energia";
  const el1 = el("a", "btn cheio", "Entrar na área do eletricista");
  el1.href = "eletricista.html";
  const el2 = el("a", "btn sec cheio", "Entrar no painel da empresa");
  el2.href = "painel/";
  vista(com(el("section", "cartao pilha"), el("h1", "dg-titulo", "Diagnóstico de avarias"),
    el("p", null, "Para os eletricistas parceiros aprovados e para a equipa da Domus Energia, com a conta que já têm."),
    el("p", "suave", "Entre na sua área e volte a esta página: a partir daí funciona também sem rede, neste telemóvel."),
    el1, el2, semRede ? el("p", "msg info", "Sem rede: para entrar a primeira vez é preciso internet.") : null));
}

let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalar = e; const b = $("dg-instalar"); if (b) b.hidden = false; });

async function ecraInicio() {
  document.title = "Diagnóstico de avarias | Domus Energia";
  const meus = (await todosDe("diagnosticos", "autor", chaveAutor(sessao))).sort((a, b) => (b.iniciado ?? "").localeCompare(a.iniciado ?? ""));
  const emCurso = meus.filter((d) => d.estado === "em_curso");
  const feitos = meus.filter((d) => d.estado !== "em_curso").slice(0, 30);
  const instalar = botao("Instalar no telemóvel", "btn sec mini", async () => {
    if (!pedidoInstalar) return;
    pedidoInstalar.prompt();
    await pedidoInstalar.userChoice.catch(() => null);
    pedidoInstalar = null;
    instalar.hidden = true;
  });
  instalar.id = "dg-instalar";
  instalar.hidden = !pedidoInstalar;
  const sinc = el("div", "pilha");
  sinc.id = "dg-sinc";
  // Mais de 60 anomalias (ronda 2): procura por palavras (sem acentos) e as áreas em blocos que abrem e fecham.
  const cartao = (a) => {
    const b = com(el("button", "cartao dg-arvore"), el("b", null, a.titulo), el("span", "pequeno suave", a.sintoma));
    b.type = "button";
    b.dataset.arvore = a.id;
    b.addEventListener("click", () => { location.hash = `#/nova/${a.id}`; });
    return b;
  };
  const busca = el("input");
  busca.type = "search";
  busca.id = "dg-procurar";
  busca.placeholder = "Procurar: diferencial, piscina, KNX…";
  busca.setAttribute("aria-label", "Procurar anomalia");
  busca.autocomplete = "off";
  const resultados = el("div", "pilha");
  resultados.id = "dg-resultados";
  resultados.setAttribute("aria-live", "polite");
  const areas = el("div", "pilha");
  areas.id = "dg-areas";
  for (const g of GRUPOS) {
    const desta = ARVORES.filter((a) => a.grupo === g);
    if (!desta.length) continue;
    const d = com(el("details", "sec dg-grupo"), com(el("summary"), el("span", null, g), selo(String(desta.length))), com(el("div", "corpo"), ...desta.map(cartao)));
    d.dataset.grupo = g;
    areas.append(d);
  }
  const filtrar = () => {
    const t = busca.value.trim();
    areas.hidden = Boolean(t);
    if (!t) { resultados.replaceChildren(); return; }
    const achadas = procurar(t);
    resultados.replaceChildren(...[el("p", "pequeno suave", `${achadas.length} ${achadas.length === 1 ? "anomalia" : "anomalias"}`), ...achadas.map(cartao),
      achadas.length ? null : el("p", "vazio", "Nada com estas palavras. Experimente outra (ex.: «terra», «motor»).")].filter(Boolean));
  };
  busca.addEventListener("input", filtrar);
  const grupos = [com(el("label", "campo"), el("span", null, "Procurar"), busca), resultados, areas];
  const linha = (d) => {
    const b = com(el("button", "cartao dg-linha"), com(el("span", "selos"), estadoSelo(d), d.sincronizado ? null : selo("Por enviar", "aviso"), d.ficha_enviada ? selo("Na ficha", "bom") : null),
      el("b", null, d.titulo), el("span", "pequeno suave", `${dataTxt(d.iniciado)}${d.causa ? ` · ${d.causa}` : ""}`));
    b.type = "button";
    b.addEventListener("click", () => { location.hash = `#/d/${d.id}`; });
    return b;
  };
  vista(
    com(el("section", "pilha"), el("h1", "dg-titulo", "Diagnóstico de avarias"),
      el("p", "suave", `Escolha a anomalia. Cada diagnóstico começa pela segurança e segue o manual de instalações (${MANUAL_BT.edicao}).`),
      sinc, instalar),
    emCurso.length ? com(el("section", "pilha"), el("h2", null, "Em curso"), ...emCurso.map(linha)) : null,
    com(el("section", "pilha"), el("h2", null, "Novo diagnóstico"), el("p", "pequeno suave", `${ARVORES.length} anomalias em ${GRUPOS.length} áreas.`), ...grupos),
    feitos.length ? com(el("section", "pilha"), el("h2", null, "Histórico neste telemóvel"), ...feitos.map(linha)) : null,
    el("p", "pequeno suave", `Árvores: versão ${VERSAO_ARVORES} · ${ARVORES.length} anomalias.`),
  );
  desenharEstadoSinc();
}
const estadoSelo = (d) => (d.estado === "em_curso" ? selo("Em curso") : d.estado === "parado" ? selo(d.perigo ? "Parado: perigo" : "Parar e chamar apoio", "mau") : selo("Concluído", "bom"));

// ---- barreira de segurança
function ecraSeguranca(arvore) {
  document.title = `${arvore.titulo} | Diagnóstico | Domus Energia`;
  const caixas = [];
  const lista = (itens, nome) => com(el("ul", "dg-marcar"), ...itens.map((x) => {
    const c = el("input");
    c.type = "checkbox";
    c.name = nome;
    c.value = x.chave;
    c.id = `seg-${nome}-${x.chave}`;
    caixas.push(c);
    const l = com(el("label", "caixa"), c, el("span", null, x.texto));
    l.htmlFor = c.id;
    return com(el("li"), l);
  }));
  const listaEpi = lista(EPI, "epi");
  const listaRegras = lista(REGRAS_OURO, "regras");
  const comecar = botao("Começar o diagnóstico", "btn cheio");
  comecar.id = "dg-comecar";
  comecar.disabled = true;
  const falta = el("p", "pequeno suave", "Marque tudo para começar.");
  const atualizar = () => {
    const n = caixas.filter((c) => !c.checked).length;
    comecar.disabled = n > 0;
    falta.textContent = n ? `Falta${n === 1 ? "" : "m"} ${n} para começar.` : "Tudo confirmado.";
  };
  caixas.forEach((c) => c.addEventListener("change", atualizar));
  comecar.addEventListener("click", async () => {
    const quando = agoraIso();
    const d = {
      id: novoId(), autor: chaveAutor(sessao), arvore: arvore.id, arvore_versao: arvore.versao, titulo: arvore.titulo, estado: "em_curso",
      seguranca: { epi: EPI.map((x) => x.chave), regras: REGRAS_OURO.map((x) => x.chave), quando }, passos: [], iniciado: quando, nota: "",
    };
    await guardarDiag(d);
    location.replace(`#/d/${d.id}`);
  });
  vista(
    voltarInicio(),
    com(el("section", "cartao pilha dg-seguranca"), el("p", "rotulo", "Antes do passo 1"), el("h1", "dg-titulo", "Segurança primeiro"),
      el("p", null, `${arvore.titulo}: confirme o equipamento e as cinco regras de ouro.`),
      el("h2", null, "Equipamento de proteção individual"), listaEpi,
      el("h2", null, "As cinco regras de ouro"), listaRegras,
      el("p", "nota alarme", "Em qualquer passo: cheiro a queimado, água no quadro, aquecimento, faíscas ou cabo danificado → toque em «Sinal de perigo»."),
      refs({ ref: REF_SEGURANCA }), falta, comecar),
  );
}
function voltarInicio() {
  const b = el("button", "voltar");
  b.type = "button";
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  b.append("Início");
  b.addEventListener("click", () => { location.hash = "#/"; });
  return b;
}

// ---- o diagnóstico
async function ecraDiagnostico(id) {
  const d = await ler("diagnosticos", id);
  if (!d || d.autor !== chaveAutor(sessao)) { vista(voltarInicio(), el("p", "cartao", "Diagnóstico não encontrado neste telemóvel.")); return; }
  const arvore = arvorePorId(d.arvore);
  document.title = `${d.titulo} | Diagnóstico | Domus Energia`;
  if (d.estado === "parado" && d.perigo) return ecraParar(d);
  if (!arvore) return ecraResumo(d, null, null);
  const idAtual = atual(arvore, d.passos);
  const no = idAtual ? noDe(arvore, idAtual) : null;
  if (!no) return ecraResumo(d, arvore, null);
  if (no.tipo === "fim" || d.estado !== "em_curso") return ecraResumo(d, arvore, no.tipo === "fim" ? no : fimDe(arvore, d.passos));
  return ecraPasso(d, arvore, no);
}

function ecraPasso(d, arvore, no) {
  const vars = variaveis(arvore, d.passos);
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const responderCom = async (resp) => {
    let r;
    try { r = responder(arvore, d.passos, resp, agoraIso()); } catch (e) { msg.textContent = e.message; msg.hidden = false; return; }
    d.passos.push(r.passo);
    await guardarDiag(d);
    if (r.passo.avaliacao && r.passo.avaliacao !== "dentro") aviso(`${r.passo.resposta}: ${NOME_AVALIACAO[r.passo.avaliacao].toLowerCase()} (${r.passo.limite}).`);
    ecraDiagnostico(d.id);
  };
  const respostas = el("div", "dg-respostas");
  if (no.tipo === "simnao") {
    respostas.append(botao("Sim", "btn", () => responderCom({ chave: "sim" })), botao("Não", "btn", () => responderCom({ chave: "nao" })));
    respostas.classList.add("dois");
  } else if (no.tipo === "escolha") {
    no.opcoes.forEach((o, i) => respostas.append(botao(o.texto, "btn sec dg-opcao", () => responderCom({ chave: `o${i}` }))));
  } else if (no.tipo === "lista") {
    // Lista de verificação: marca-se o que está feito / conforme; "Seguinte" segue com o que ficou por marcar.
    const caixas = no.itens.map((x) => {
      const c = el("input");
      c.type = "checkbox";
      c.value = x.chave;
      c.id = `dg-item-${x.chave}`;
      const l = com(el("label", "caixa"), c, el("span", null, x.texto));
      l.htmlFor = c.id;
      respostas.append(l);
      return c;
    });
    const ok = botao("Seguinte", "btn", () => responderCom({ chave: "l", feitos: caixas.filter((c) => c.checked).map((c) => c.value) }));
    ok.id = "dg-seguinte";
    respostas.append(ok);
  } else {
    const campo = el("input");
    campo.id = "dg-valor";
    campo.type = "text";
    campo.inputMode = "decimal";
    campo.autocomplete = "off";
    campo.setAttribute("aria-label", `${no.texto} (${no.unidade})`);
    const ok = botao("Seguinte", "btn", () => {
      const n = lerNumero(campo.value);
      if (n === null || Number.isNaN(n) || n < 0 || n > no.max) { msg.textContent = `Escreva o valor medido em ${no.unidade} (um número, 0 ou mais).`; msg.hidden = false; campo.setAttribute("aria-invalid", "true"); campo.focus(); return; }
      responderCom({ chave: "v", valor: n });
    });
    ok.id = "dg-seguinte";
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); });
    respostas.append(com(el("label", "campo"), el("span", null, no.tipo === "dado" ? "Valor" : "Valor medido"), com(el("div", "com-un"), campo, el("span", null, no.unidade))));
    if (no.tipo === "valor") respostas.append(com(el("p", "dg-esperado"), el("b", null, "Esperado: "), textoLimite(no, vars), el("span", "pequeno suave", ` — ${no.limite.fonte}`)));
    respostas.append(ok);
  }
  const naoSei = botao(no.tipo === "valor" || no.tipo === "dado" ? "Não consigo medir" : no.tipo === "lista" ? "Não consigo verificar" : "Não sei", "link-botao", () => responderCom({ chave: "nao_sei" }));
  naoSei.id = "dg-nao-sei";
  const voltar = botao("Voltar", "btn sec mini", async () => { d.passos.pop(); await guardarDiag(d); ecraDiagnostico(d.id); });
  voltar.disabled = !d.passos.length;
  voltar.id = "dg-voltar";
  const recomecar = botao("Recomeçar", "btn sec mini");
  recomecar.id = "dg-recomecar";
  confirmarEmDoisToques(recomecar, "Apagar as respostas?", async () => { d.passos = []; await guardarDiag(d); ecraDiagnostico(d.id); });
  const perigo = botao("Sinal de perigo", "btn perigo cheio", () => escolherPerigo(d));
  perigo.id = "dg-perigo";
  const ultimo = d.passos.at(-1);
  vista(
    voltarInicio(),
    com(el("p", "rotulo"), `${d.titulo} · passo ${d.passos.length + 1}`),
    ultimo?.avaliacao ? com(el("p", `nota ${ultimo.avaliacao === "dentro" ? "calma" : "alarme"} dg-ultimo`), `Último valor: ${ultimo.resposta} — ${NOME_AVALIACAO[ultimo.avaliacao].toLowerCase()} (${ultimo.limite}).`) : null,
    com(el("section", `cartao pilha dg-passo${no.tensao ? " tensao" : ""}`),
      no.tensao ? com(el("p", "dg-tensao", "Com tensão"), el("span", null, AVISO_TENSAO)) : null,
      el("h1", "dg-pergunta", no.texto),
      no.fazer ? com(el("p", "dg-fazer"), el("b", null, "O que fazer: "), no.fazer) : null,
      refs(no), respostas, msg, naoSei),
    com(el("div", "fila dg-nav"), voltar, recomecar),
    perigo,
    percurso(d),
  );
}

function percurso(d) {
  if (!d.passos.length) return null;
  const ol = com(el("ol", "dg-percurso"), ...d.passos.map((p) => com(el("li", p.tensao ? "tensao" : null), el("span", null, p.pergunta), " ",
    el("b", null, p.resposta), p.avaliacao ? selo(NOME_AVALIACAO[p.avaliacao], p.avaliacao === "dentro" ? "bom" : p.avaliacao === "aviso" ? "aviso" : "mau") : null)));
  return com(el("details", "sec"), com(el("summary"), el("span", null, `Percurso (${d.passos.length} ${d.passos.length === 1 ? "passo" : "passos"})`)), com(el("div", "corpo"), ol));
}

function escolherPerigo(d) {
  const lista = com(el("div", "pilha"), ...SINAIS_PERIGO.map((s) => {
    const b = botao(s.texto, "btn perigo cheio", async () => {
      Object.assign(d, { estado: "parado", perigo: s.chave, causa: `Sinal de perigo: ${s.texto.toLowerCase()}.`, acao: PARAR_ISOLAR.passos.slice(0, 3).join(" "), tipo: null, terminado: agoraIso() });
      await guardarDiag(d);
      ecraDiagnostico(d.id);
    });
    b.dataset.perigo = s.chave;
    return b;
  }));
  vista(com(el("section", "cartao pilha dg-perigo"), el("h1", "dg-titulo", "Que sinal de perigo?"), el("p", null, "O diagnóstico para aqui e passa a «Parar e isolar»."), lista,
    botao("Afinal não: voltar ao passo", "btn sec cheio", () => ecraDiagnostico(d.id))));
}

function ecraParar(d) {
  const sinal = SINAIS_PERIGO.find((s) => s.chave === d.perigo);
  vista(
    voltarInicio(),
    com(el("section", "cartao pilha dg-parar"), el("p", "rotulo", sinal?.texto ?? "Sinal de perigo"), el("h1", "dg-titulo", PARAR_ISOLAR.titulo),
      com(el("ol", "dg-passos-parar"), ...PARAR_ISOLAR.passos.map((p) => el("li", null, p))), refs(PARAR_ISOLAR)),
    blocoFim(d, null, null),
    percurso(d),
  );
}

/** O fim do diagnóstico: causa e ação, e depois a nota, as fotos, a ligação e "Enviar para a ficha". */
function ecraResumo(d, arvore, fim) {
  const concluido = d.estado !== "em_curso";
  const msg = el("p", "msg erro");
  msg.hidden = true;
  const partes = [voltarInicio()];
  if (fim) {
    partes.push(com(el("section", `cartao pilha dg-fim${fim.parar ? " parar" : ""}`),
      el("p", "rotulo", fim.parar ? "Parar e chamar apoio" : "Resultado"),
      el("h1", "dg-titulo", "Causa provável"), el("p", "dg-causa", fim.causa),
      el("h2", null, "O que fazer"), el("p", "dg-acao", fim.acao), refs(fim),
      fim.seguir && arvorePorId(fim.seguir) ? botao(`Continuar: ${arvorePorId(fim.seguir).titulo}`, "btn sec cheio", () => { location.hash = `#/nova/${fim.seguir}`; }) : null));
  } else if (d.causa) {
    partes.push(com(el("section", "cartao pilha dg-fim"), el("p", "rotulo", "Resultado"), el("h1", "dg-titulo", "Causa provável"), el("p", null, d.causa), d.acao ? el("p", null, d.acao) : null));
  }
  if (!concluido && fim) {
    const concluir = botao("Concluir o diagnóstico", "btn cheio", async () => {
      Object.assign(d, { estado: fim.parar ? "parado" : "concluido", causa: fim.causa, acao: fim.acao, tipo: fim.tipoAvaria, terminado: agoraIso() });
      await guardarDiag(d);
      aviso(semRede ? "Diagnóstico guardado neste telemóvel: envia-se quando houver rede." : "Diagnóstico concluído.");
      ecraDiagnostico(d.id);
    });
    concluir.id = "dg-concluir";
    const voltar = botao("Voltar", "btn sec mini", async () => { d.passos.pop(); await guardarDiag(d); ecraDiagnostico(d.id); });
    voltar.id = "dg-voltar";
    partes.push(blocoFim(d, arvore, fim), concluir, com(el("div", "fila"), voltar));
  } else {
    partes.push(blocoFim(d, arvore, fim));
  }
  partes.push(percurso(d), msg);
  vista(...partes);
}

/** Nota, fotos, ligação e "Enviar para a ficha" (no fim e no "Parar e isolar"). */
function blocoFim(d, arvore, fim) {
  const s = com(el("section", "cartao pilha dg-registo"), el("h2", null, "Registo"),
    com(el("div", "selos"), estadoSelo(d), d.sincronizado ? selo("Enviado ao servidor", "bom") : selo("Por enviar", "aviso"), d.ficha_enviada ? selo("Na ficha", "bom") : null),
    d.erro_sinc ? el("p", "msg erro", `O servidor recusou: ${d.erro_sinc}`) : null);
  // Nota
  const nota = el("textarea");
  nota.id = "dg-nota";
  nota.rows = 3;
  nota.maxLength = 2000;
  nota.value = d.nota ?? "";
  nota.addEventListener("change", async () => { d.nota = nota.value.trim(); await guardarDiag(d); aviso("Nota guardada."); });
  s.append(com(el("label", "campo"), el("span", null, "Nota (o que viu, o que fez)"), nota));
  // Fotos
  s.append(blocoFotos(d));
  // Ligação
  s.append(blocoLigacao(d));
  // Enviar para a ficha
  const ligado = sessao?.tipo === "painel" ? d.orcamento_id : d.trabalho_id;
  if (d.estado !== "em_curso" && ligado && arvore && (sessao?.tipo !== "painel" || podeLigarPedido(sessao))) {
    const enviar = botao(d.ficha_enviada ? "Enviar outra vez para a ficha" : "Enviar para a ficha", "btn cheio");
    enviar.id = "dg-ficha";
    const m = el("p", "msg");
    m.hidden = true;
    enviar.disabled = semRede || sessao?.guardada;
    enviar.addEventListener("click", async () => {
      enviar.disabled = true;
      try {
        await sincronizar();
        const atualD = await ler("diagnosticos", d.id);
        if (!atualD.sincronizado) throw new Error(atualD.erro_sinc ?? "Ainda não foi possível enviar o diagnóstico ao servidor.");
        await pedir(`${apiDe(sessao)}/${d.id}/ficha`, { corpo: { diagnostico: paraFicha(arvore, atualD) } });
        await marcar(d.id, { ficha_enviada: agoraIso() });
        aviso(sessao.tipo === "painel" ? `Enviado para a ficha do pedido n.º ${d.orcamento_id}.` : `Enviado para a ficha do trabalho n.º ${d.trabalho_id}.`);
        ecraDiagnostico(d.id);
      } catch (e) {
        m.className = "msg erro";
        m.textContent = e.message;
        m.hidden = false;
        enviar.disabled = false;
      }
    });
    com(s, enviar, m, semRede ? el("p", "pequeno suave", "«Enviar para a ficha» precisa de rede.") : null);
  }
  return s;
}

function blocoFotos(d) {
  const caixa = com(el("div", "pilha dg-fotos"), el("p", "campo-titulo", "Fotos (só se for seguro tirá-las)"));
  const grelha = el("div", "fotos-grelha");
  caixa.append(grelha);
  (async () => {
    const fotos = await todosDe("fotos", "diagnostico", d.id);
    for (const f of fotos) {
      const img = el("img");
      img.src = URL.createObjectURL(f.blob);
      img.alt = "Foto do diagnóstico";
      grelha.append(com(el("figure", "mini-foto"), img, f.enviada ? null : selo(f.recusada ? "Recusada" : "Por enviar", f.recusada ? "mau" : "aviso")));
    }
    if (fotos.length < FOTOS_MAX) {
      const entrada = el("input");
      entrada.type = "file";
      entrada.accept = "image/*";
      entrada.setAttribute("capture", "environment");
      entrada.id = "dg-foto";
      entrada.className = "so-leitor";
      const rot = com(el("label", "btn sec mini"), "Tirar ou escolher foto", entrada);
      entrada.addEventListener("change", async () => {
        const ficheiro = entrada.files?.[0];
        if (!ficheiro) return;
        try {
          const r = await reduzirFoto(ficheiro);
          await gravar("fotos", { id: novoId().slice(0, 24), diagnostico_id: d.id, blob: r.blob, tipo: r.blob.type || "image/jpeg", enviada: false, criado: agoraIso() });
          aviso("Foto guardada.");
          sincronizar();
          ecraDiagnostico(d.id);
        } catch (e) { aviso(e.message || "Não foi possível guardar a foto."); }
      });
      caixa.append(rot);
    } else caixa.append(el("p", "pequeno suave", `Máximo de ${FOTOS_MAX} fotos por diagnóstico.`));
  })();
  return caixa;
}

function blocoLigacao(d) {
  const caixa = el("div", "pilha dg-ligacao");
  if (sessao?.tipo === "painel") {
    if (!podeLigarPedido(sessao)) return caixa;
    const n = el("input");
    n.id = "dg-pedido";
    n.type = "text";
    n.inputMode = "numeric";
    n.value = d.orcamento_id ?? "";
    const guardarLig = botao("Ligar", "btn sec mini", async () => {
      const v = n.value.trim();
      d.orcamento_id = v ? Number(v) : null;
      if (v && !/^[1-9]\d{0,9}$/.test(v)) { aviso("Escreva o número do pedido."); return; }
      await guardarDiag(d);
      aviso(v ? `Ligado ao pedido n.º ${v}.` : "Sem ligação a um pedido.");
      ecraDiagnostico(d.id);
    });
    caixa.append(com(el("label", "campo"), el("span", null, "Ligar a um pedido (n.º, opcional)"), com(el("div", "fila"), n, guardarLig)));
    return caixa;
  }
  const sel = el("select");
  sel.id = "dg-trabalho";
  const opcao = (v, t) => { const o = el("option", null, t); o.value = v; return o; };
  sel.append(opcao("", "Sem trabalho"));
  (async () => {
    let lista = (await ler("estado", "trabalhos").catch(() => null))?.valor ?? [];
    if (!semRede && !sessao?.guardada) {
      try {
        lista = (await pedir(`${API_ELETRICISTA}trabalhos`)).trabalhos ?? [];
        await gravar("estado", { chave: "trabalhos", valor: lista.map((t) => ({ id: t.id, tipo: t.tipo, titulo: t.titulo, aberto: t.aberto })) });
      } catch { /* fica a lista guardada */ }
    }
    const nomes = { avaria: "Avaria", obra: "Obra", visita: "Visita" };
    for (const t of [...lista].filter((x) => x.aberto || x.id === d.trabalho_id).sort((a, b) => (a.tipo === "avaria" ? -1 : 0) - (b.tipo === "avaria" ? -1 : 0))) {
      sel.append(opcao(String(t.id), `N.º ${t.id} · ${nomes[t.tipo] ?? t.tipo} · ${t.titulo ?? ""}`.trim()));
    }
    sel.value = d.trabalho_id ? String(d.trabalho_id) : "";
  })();
  sel.addEventListener("change", async () => {
    d.trabalho_id = sel.value ? Number(sel.value) : null;
    await guardarDiag(d);
    aviso(d.trabalho_id ? `Ligado ao trabalho n.º ${d.trabalho_id}.` : "Sem ligação a um trabalho.");
    ecraDiagnostico(d.id);
  });
  caixa.append(com(el("label", "campo"), el("span", null, "Ligar a um trabalho (opcional)"), sel,
    el("span", "dica", "Ligado a uma avaria sua, «Enviar para a ficha» preenche o diagnóstico da ficha.")));
  return caixa;
}

// ---------------------------------------------------------------- arranque e navegação
async function encaminhar() {
  if (!sessao) return ecraEntrar();
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (partes[0] === "nova" && arvorePorId(partes[1])) return ecraSeguranca(arvorePorId(partes[1]));
  if (partes[0] === "d" && partes[1]) return ecraDiagnostico(partes[1]);
  return ecraInicio();
}
window.addEventListener("hashchange", () => { encaminhar(); });
window.addEventListener("online", async () => {
  semRede = false;
  if (!sessao || sessao.guardada) sessao = await verSessao().catch(() => sessao);
  mostrarQuem();
  await sincronizar();
  encaminhar();
});
window.addEventListener("offline", () => { semRede = true; mostrarQuem(); desenharEstadoSinc(); });
// O evento "online" nem sempre chega (ou chega antes de a rede responder): de 20 em 20 s tenta-se outra vez o que falta.
setInterval(async () => {
  if (!sessao) return;
  const n = await porSincronizar().catch(() => ({ diagnosticos: 0, fotos: 0 }));
  if (!n.diagnosticos && !n.fotos && !semRede) return;
  const antes = semRede;
  semRede = false;
  await sincronizar();
  if (antes && !semRede) { mostrarQuem(); encaminharSeInicio(); }
}, 20_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sincronizar(); });
function encaminharSeInicio() { if (!location.hash || location.hash === "#/") encaminhar(); }

async function arrancar() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("diagnostico-sw.js", { scope: "diagnostico" }).catch(() => {});
  try { await abrirBd(); } catch {
    vista(el("p", "msg erro", "Este navegador não deixa guardar dados (modo privado?). A app de diagnóstico precisa de guardar no telemóvel."));
    return;
  }
  sessao = await verSessao().catch(() => null);
  mostrarQuem();
  await encaminhar();
  sincronizar();
}
arrancar();
