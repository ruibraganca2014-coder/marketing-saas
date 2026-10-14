// Área do eletricista (docs/ELETRICISTAS.md): entrar com o email e um código (sessão própria, cookie domus_eletricista
// em /api/eletricista), Bolsa (trabalhos dos seus concelhos, sem dados do cliente nem preços: é o servidor que os
// tira), Aceitar, Os meus trabalhos (cliente, relatório técnico, material, 48 h para marcar a visita, Marcar visita,
// Largar trabalho). Ronda 2 — a ficha de obra: material levantado ou recebido, fotos antes e depois, ensaios medidos,
// diagnóstico da avaria, "Obra concluída" (fica a aguardar a confirmação do cliente) e a Ajuda técnica. Ronda 3 — os
// Pagamentos: o valor de cada trabalho (fixado quando a Domus aprova), o estado (a aguardar o cliente / a aprovação / o
// restante, fatura em falta, a pagar até, pago em), o envio da fatura-recibo e o IBAN (só se vê mascarado).
// Procedimentos (docs/PROCEDIMENTOS.md): os publicados leem-se na Ajuda técnica; numa obra, as checklists estão no
// passo "Trabalho" da ficha (começar a checklist de um procedimento e marcar os passos).
// Propostas na bolsa (decisão do dono, 2026-10-10; só quando o servidor diz `por_proposta` no trabalho): numa visita
// técnica da bolsa não há "Aceitar" — o eletricista vê o relatório e as fotos do cliente e envia a proposta (horas,
// material, notas e quando pode ir), que pode corrigir; a Domus escolhe. O escolhido fica "à espera de o cliente aceitar"
// (sem dados do cliente nem "Marcar visita"); quando o cliente aceita, a obra aparece nos trabalhos dele.
// Aspeto para a obra (decisão do dono, 2026-10-13): abre no Início — "o que tenho para fazer hoje", montado aqui com o
// que as rotas já devolvem (trabalhos, a ficha dos que estão em curso, bolsa e pagamentos) — e a ficha segue a ordem
// do trabalho em seis passos (cliente e visita, fotos de antes, trabalho, ensaios, fotos de depois, concluir), com um
// visto nos que já estão feitos e o passo seguinte em destaque. Só muda o aspeto: as regras continuam no servidor.
// Decisões do dono de 2026-10-13: na bolsa, o nome da especialidade do pedido e, para o parceiro que o vê primeiro, o
// selo "Da sua especialidade · só para si até <dia, hora>"; na ficha da obra, quem é o técnico responsável (sem ele não
// se dá por concluída); e "Obras que assino" — as obras de que é o técnico responsável sem ser quem as faz, só para
// leitura. Um servidor mais antigo não envia estes campos nem tem a rota: nada disto aparece e o resto fica igual.
// Tabela de preços da minha especialidade (decisão do dono, 2026-10-14): só para os parceiros, a partir do Início (#/precos).
// Rotas no endereço: #/inicio, #/precos, #/bolsa, #/bolsa/<id>, #/trabalhos, #/trabalhos/<id>, #/assino/<id>, #/pagamentos, #/ajuda, #/ajuda/<id> (um procedimento). Só textContent (nunca HTML com dados).
import { seccaoTecnica } from "./simulador/simbolos.js";
import { desenharQuadroCliente, normalizarEsquema, esquemaVazio, esquemaTemAlgo, AMPERES_GERAL, AMPERES_DISJUNTOR, PROTECOES_ESQUEMA } from "./simulador/quadro-desenho.js";
import { analiseDaCasa, diferencasQuadro } from "./simulador/relatorio-casa.js";
import { reduzirFoto } from "./simulador/fotos.js";
import { confirmarEmDoisToques } from "./confirmar.js";

const cfg = window.DOMUS ?? {};
const base = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
const API = `${base ? `${base}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "")}/eletricista/`;
const credenciais = base ? "include" : "same-origin";
/** Endereço de um caminho devolvido pelo servidor ("/api/eletricista/trabalhos/1/fotos/…"). */
const urlServidor = (caminho) => (base && String(caminho).startsWith("/") ? `${base}${caminho}` : caminho);
const PRAZO_DIAS = 7;

const $ = (id) => document.getElementById(id);
const el = (tag, classe, texto) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined && texto !== null) e.textContent = String(texto);
  return e;
};
const com = (pai, ...filhos) => { pai.append(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false)); return pai; };
const euro = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" }).format(v ?? 0);
const decimal = (v) => String(v).replace(".", ",");
// O que recebe por um trabalho: o da proposta mais a parte dele em cada trabalho a mais que o cliente aceitou.
const extrasAceites = (t) => (t.extras ?? []).filter((x) => x.estado === "aceite" && x.recebe).reduce((s, x) => s + (Number(x.recebe.total) || 0), 0);
// … e a deslocação de cada ida perdida que a Domus Energia confirmou (o cliente não estava à hora marcada).
const idasConfirmadas = (t) => (t.idas_perdidas ?? []).filter((x) => x.estado === "confirmada").reduce((s, x) => s + (Number(x.recebe) || 0), 0);
const recebeComExtras = (t) => Math.round(((Number(t.recebe?.total) || 0) + extrasAceites(t) + idasConfirmadas(t)) * 100) / 100;
const p2 = (n) => String(n).padStart(2, "0");
/** "AAAA-MM-DDTHH:MM" (hora de Lisboa, como o servidor a guarda) → "09/10 às 10:00". */
const visitaTxt = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)} às ${v.slice(11, 16)}` : "");
const NOME_TIPO = { obra: "Obra", visita: "Visita técnica", avaria: "Diagnóstico de avaria" };
const SETA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

class ErroPedido extends Error { constructor(estado, m) { super(m); this.estado = estado; } }
/** GET (sem corpo) ou POST: `corpo` em JSON ou, com `bruto`, um Blob tal e qual (a foto, com o seu tipo). */
async function pedir(caminho, corpo, bruto = false) {
  const opcoes = { method: corpo === undefined ? "GET" : "POST", credentials: credenciais, headers: { Accept: "application/json" } };
  if (bruto) { opcoes.headers["Content-Type"] = corpo.type || "image/jpeg"; opcoes.body = corpo; }
  else if (corpo !== undefined) { opcoes.headers["Content-Type"] = "application/json"; opcoes.body = JSON.stringify(corpo); }
  let r;
  try { r = await fetch(API + caminho, opcoes); } catch { throw new ErroPedido(0, "Sem ligação ao servidor. Verifique a internet e tente de novo."); }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (r.status === 401 && caminho !== "eu" && caminho !== "entrar") { mostrarEntrar("A sessão terminou. Entre de novo."); throw new ErroPedido(401, "A sessão terminou."); }
  if (!r.ok) throw new ErroPedido(r.status, typeof j?.erro === "string" ? j.erro : `Não foi possível (erro ${r.status}). Tente de novo.`);
  return j;
}

// O cookie da sessão é HttpOnly (não se vê daqui): para não pedir /eu sem sessão (um 401 na consola em cada visita)
// fica uma marca no localStorage, posta ao entrar e tirada ao sair ou com um 401 — como na conta de cliente.
const MARCA_SESSAO = "domus_eletricista_sessao";
const armazem = (() => { try { return window.localStorage; } catch { return null; } })();
function marcarSessao(tem) { try { if (tem) armazem?.setItem(MARCA_SESSAO, "1"); else armazem?.removeItem(MARCA_SESSAO); } catch { /* sem armazenamento */ } }
const temMarcaSessao = () => { try { return !armazem || armazem.getItem(MARCA_SESSAO) === "1"; } catch { return true; } };

let tAviso;
function aviso(t) {
  const a = $("aviso");
  a.textContent = t;
  a.classList.add("visivel");
  clearTimeout(tAviso);
  tAviso = setTimeout(() => a.classList.remove("visivel"), 4000);
}

// ---------------------------------------------------------------- entrar (email → código)
let eu = null;
let emailPedido = "";
function msgEntrar(t, tipo = "erro") {
  const m = $("el-entrar-msg");
  m.textContent = t ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !t;
}
function passoCodigo(sim) {
  $("el-campo-email").hidden = sim;
  $("el-pedir-codigo").hidden = sim;
  $("el-campo-codigo").hidden = !sim;
  $("el-confirmar").hidden = !sim;
  $("el-outro-email").hidden = !sim;
  (sim ? $("el-codigo") : $("el-email")).focus();
}
function mostrarEntrar(texto = "", tipo = "info") {
  eu = null;
  marcarSessao(false);
  pararContagem();
  $("el-vista").replaceChildren();
  $("el-fundo").hidden = true;
  $("el-sair").hidden = true;
  $("el-quem").textContent = "Área do eletricista";
  $("el-entrar").hidden = false;
  msgEntrar(texto || null, tipo);
  document.title = "Entrar | Área do eletricista | Domus Energia";
}
async function ocupado(b, fn) {
  if (b.disabled) return;
  const antes = b.textContent;
  b.disabled = true;
  b.textContent = "Um momento…";
  try { await fn(); } catch (e) { if (e?.estado !== 401 || !$("el-entrar").hidden) msgEntrar(e?.message || "Não foi possível. Tente de novo."); }
  finally { b.disabled = false; b.textContent = antes; }
}
$("el-pedir-codigo").addEventListener("click", (e) => ocupado(e.currentTarget, async () => {
  const email = $("el-email").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msgEntrar("O email não parece certo (ex.: nome@exemplo.pt)."); $("el-email").focus(); return; }
  const r = await pedir("codigo", { email });
  emailPedido = email;
  passoCodigo(true);
  msgEntrar(r?.mensagem ?? "Enviámos um código para o email.", "info");
}));
$("el-confirmar").addEventListener("click", (e) => ocupado(e.currentTarget, async () => {
  const codigo = $("el-codigo").value.replace(/\s/g, "");
  if (!/^\d{6}$/.test(codigo)) { msgEntrar("O código tem 6 algarismos."); $("el-codigo").focus(); return; }
  const r = await pedir("entrar", { email: emailPedido, codigo });
  $("el-codigo").value = "";
  passoCodigo(false);
  entrou(r.eletricista);
}));
$("el-outro-email").addEventListener("click", () => { passoCodigo(false); msgEntrar(null); });
for (const [campo, botao] of [["el-email", "el-pedir-codigo"], ["el-codigo", "el-confirmar"]]) {
  $(campo).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(botao).click(); } });
}
$("el-sair").addEventListener("click", async () => {
  try { await pedir("sair", {}); } catch { /* a sessão expira na mesma */ }
  history.replaceState(null, "", "#/inicio");
  mostrarEntrar("Saiu da área do eletricista.", "ok");
});

function entrou(e) {
  eu = e;
  marcarSessao(true);
  $("el-entrar").hidden = true;
  $("el-fundo").hidden = false;
  $("el-sair").hidden = false;
  $("el-quem").textContent = e.nome;
  document.title = "Área do eletricista | Domus Energia";
  msgEntrar(null);
  encaminhar();
}

// ---------------------------------------------------------------- rotas
function rota() {
  const [aba, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { aba: ["bolsa", "trabalhos", "assino", "pagamentos", "ajuda", "precos"].includes(aba) ? aba : "inicio", id: /^\d{1,10}$/.test(id ?? "") ? id : null };
}
const ir = (c) => { if (location.hash === `#/${c}`) encaminhar(); else location.hash = `#/${c}`; };
window.addEventListener("hashchange", () => { if (eu) encaminhar(); });
for (const b of document.querySelectorAll(".app-abas [data-aba]")) b.addEventListener("click", () => ir(b.dataset.aba));

let geracao = 0;
async function encaminhar() {
  const { aba, id } = rota();
  const minha = ++geracao;
  pararContagem();
  // "Obras que assino" vive dentro de "Os meus trabalhos" (não tem separador próprio).
  for (const b of document.querySelectorAll(".app-abas [data-aba]")) b.setAttribute("aria-selected", String(b.dataset.aba === (aba === "assino" ? "trabalhos" : aba === "precos" ? "inicio" : aba)));
  const vista = $("el-vista");
  vista.replaceChildren(el("p", "vazio", "A carregar…"));
  try {
    const partes = aba === "inicio" ? await inicio() : aba === "precos" ? await precos() : aba === "ajuda" ? (id ? await procedimento(id) : await ajuda()) : aba === "pagamentos" ? desenharPagamentos(await pedir("pagamentos")) : aba === "bolsa" ? (id ? await bolsaDetalhe(id) : await bolsaLista()) : aba === "assino" && id ? await obraAssino(id) : (id ? await ficha(id) : await trabalhosLista());
    if (minha !== geracao) return;
    vista.replaceChildren(...partes);
    $("conteudo").scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    // Vindo do Início ("Fatura-recibo em falta"): a página dos pagamentos abre no cartão desse trabalho.
    if (aba === "pagamentos" && focoPagamento) $(`pagamento-${focoPagamento}`)?.scrollIntoView();
    focoPagamento = null;
    iniciarContagem();
  } catch (e) {
    if (minha !== geracao || e?.estado === 401) return;
    const voltar = id ? botaoVoltar(aba === "bolsa" ? "Bolsa" : aba === "ajuda" ? "Ajuda técnica" : "Os meus trabalhos", aba) : null;
    vista.replaceChildren(...[voltar, com(el("div", "msg erro"), el("p", null, e.message))].filter(Boolean));
  }
}
function botaoVoltar(texto, destino) {
  const b = el("button", "voltar");
  b.type = "button";
  b.innerHTML = SETA;   // ícone fixo (sem dados)
  b.append(texto);
  b.addEventListener("click", () => ir(destino));
  return b;
}
const selo = (t, tipo = "") => el("span", `selo ${tipo}`.trim(), t);
/** "terça-feira, 14/10, 10:30" (hora de Lisboa) a partir de uma data ISO; "" se não for uma data. */
const diaHoraTxt = (isoTxt) => { const d = new Date(isoTxt); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };   // dia curto ("qua."): com "quarta-feira" o selo partia a meio da palavra
// Especialidade do pedido e prioridade do parceiro (decisão do dono, 2026-10-13). Um servidor antigo não envia
// `especialidade_nome` nem `prioridade_ate`: não aparece selo nenhum.
const seloEspecialidade = (t) => (t.especialidade_nome ? selo(t.especialidade_nome) : null);
const textoPrioridade = (ate) => (ate && diaHoraTxt(ate) ? `Da sua especialidade · só para si até ${diaHoraTxt(ate)}` : null);
// Avaria fora de horas (decisão do dono, 2026-10-13): `fora_horas` é a percentagem a mais da mão de obra. Sem o campo (trabalho normal, ou servidor antigo) não há selo.
const seloForaHoras = (t) => (Number(t.fora_horas) > 0 ? selo(`Fora de horas: recebe mais ${decimal(t.fora_horas)} %`, "bom") : null);
const seloPrioridade = (t) => (textoPrioridade(t.prioridade_ate) ? selo(textoPrioridade(t.prioridade_ate), "bom") : null);
const duracaoTxt = (t) => [t.horas ? `cerca de ${decimal(Math.round(t.horas * 10) / 10)} h` : null, t.dias ? `${t.dias} ${t.dias === 1 ? "dia" : "dias"}` : null].filter(Boolean).join(" · ");
function contadores(nBolsa, nTrab) {
  const mostrar = (id, n) => { const c = $(id); c.hidden = !n; c.textContent = n ? String(n) : ""; };
  if (nBolsa !== null) mostrar("el-conta-bolsa", nBolsa);
  if (nTrab !== null) mostrar("el-conta-trabalhos", nTrab);
}

// ---------------------------------------------------------------- Início: o que tenho para fazer hoje
// A visita vem do servidor na hora de Lisboa, sem fuso ("AAAA-MM-DDTHH:MM"): "hoje" e "agora" contam-se também em Lisboa.
const diaLisboa = (dias = 0) => new Date(Date.now() + dias * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
const agoraLisboa = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Lisbon" }).slice(0, 16).replace(" ", "T");
// O que o servidor diz que falta para concluir (`falta`, as frases dele) → o passo da ficha onde se resolve e o nome
// curto que aparece no Início ("Falta: fotos de depois, ensaios").
const FALTA = [
  ["marcar a visita", "cliente", "marcar a visita"], ["a visita ainda não aconteceu", "cliente", null],
  ["uma foto de antes", "antes", "fotos de antes"], ["uma foto de depois", "depois", "fotos de depois"], ["ensaio:", "ensaios", "ensaios"],
  ["a conclusão do diagnóstico", "trabalho", "diagnóstico"], ["a resposta ao trabalho a mais", "trabalho", "resposta ao trabalho a mais"],
  ["a resposta à ida perdida", "trabalho", "resposta à visita perdida"],
  ["o técnico responsável", null, "técnico responsável (a Domus Energia indica)"],
];
const faltaDe = (frase) => FALTA.find(([comeco]) => frase.startsWith(comeco)) ?? null;
const faltaCurta = (falta) => [...new Set(falta.map((f) => { const x = faltaDe(f); return x ? x[2] : f; }).filter(Boolean))].join(", ");
const pendenteExtra = (t) => (t.extras ?? []).some((x) => x.estado === "proposto" || x.estado === "enviado");
const pendenteIda = (t) => (t.idas_perdidas ?? []).some((x) => x.estado === "proposta");
const PRAZO_A_ACABAR_MS = 12 * 3600_000;   // menos do que isto para marcar a visita: o cartão fica em destaque
let focoPagamento = null;

/**
 * Um cartão do Início: um só alvo de toque, grande, que leva ao sítio certo. `tipo`: "hoje" (botão cheio), "aviso",
 * "alarme" ou "discreta" (só informativo, sem botão). `grande` e `linhas` aceitam texto ou nós (os números vão em <strong>).
 */
function tarefa({ id, tipo = "", rotulo, grande, linhas = [], botao, ir: destino }) {
  const b = com(el("button", `cartao tarefa ${tipo}`.trim()), rotulo ? el("span", "rotulo", rotulo) : null, com(el("span", "grande"), grande),
    linhas.filter(Boolean).map((l) => com(el("span", "linha"), l)), botao ? el("span", "ir", botao) : null);
  b.type = "button";
  b.id = id;
  b.addEventListener("click", typeof destino === "function" ? destino : () => ir(destino));
  return b;
}
const forte = (t) => el("strong", "num", t);

async function inicio() {
  const [rt, rb, rp, assino] = await Promise.all([pedir("trabalhos"), pedir("bolsa"), pedir("pagamentos"), obrasQueAssino()]);
  contadores(rb.trabalhos.length, rt.trabalhos.filter((t) => t.estado === "aceite" && t.aberto && !t.espera_cliente).length);
  // A lista dos trabalhos não traz a morada, o que falta nem o que está à espera de resposta: vêm da ficha de cada
  // trabalho em curso (são poucos). Se uma ficha falhar, o cartão aparece na mesma, só com o que a lista diz.
  const emCurso = rt.trabalhos.filter((t) => t.aberto && !t.espera_cliente && (t.estado === "aceite" || t.estado === "visita_marcada")).slice(0, 12);
  const fichas = new Map(await Promise.all(emCurso.map(async (t) => {
    try { return [t.id, (await pedir(`trabalhos/${t.id}`)).trabalho]; } catch (e) { if (e?.estado === 401) throw e; return [t.id, null]; }
  })));
  const hoje = diaLisboa(), amanha = diaLisboa(1), agora = agoraLisboa();
  const grupos = { hoje: [], amanha: [], concluir: [], marcar: [], devolvido: [], espera: [] };
  const abrir = (t) => `trabalhos/${t.id}`;
  const espera = (t, texto, sufixo = "") => grupos.espera.push(tarefa({ id: `inicio-espera-${t.id}${sufixo}`, tipo: "discreta", grande: texto, linhas: [`${t.titulo} · ${t.concelho}`], ir: abrir(t) }));
  for (const lista of rt.trabalhos) {
    if (!lista.aberto) continue;
    const t = fichas.get(lista.id) ?? lista;
    const c = t.cliente ?? {};
    const onde = [c.morada, c.localidade].filter(Boolean).join(", ") || t.concelho;
    const quem = [c.nome, t.titulo].filter(Boolean).join(" · ");
    const nomeTrabalho = t.tipo === "obra" ? "Obra" : "Trabalho";
    if (t.espera_cliente) espera(t, "À espera de o cliente aceitar a proposta");
    else if (t.estado === "concluida_eletricista") espera(t, "A aguardar confirmação do cliente");
    else if (t.estado === "confirmada") espera(t, "A aguardar aprovação da Domus Energia");
    else if (t.estado === "aceite" || (t.estado === "visita_marcada" && !t.visita)) {
      const prazo = t.prazo ? el("strong", "num") : null;
      if (prazo) { prazo.dataset.prazo = t.prazo; prazo.dataset.curto = "1"; }
      grupos.marcar.push([t.prazo ?? "9", tarefa({ id: `inicio-marcar-${t.id}`, tipo: "aviso", rotulo: "Visita por marcar", grande: prazo ? ["Faltam ", prazo] : "Marque a visita",
        linhas: [prazo ? "para marcar a visita. Depois disso, o trabalho deixa de ser seu." : null, `${quem} · ${onde}`], botao: "Marcar visita", ir: abrir(t) })]);
    } else if (t.estado === "visita_marcada") {
      if (pendenteExtra(t)) espera(t, "Trabalho a mais por responder", "-extra");
      const dia = t.visita.slice(0, 10), hora = t.visita.slice(11, 16);
      // Visita de orçamento sem custo: não se "conclui" (fecha quando a Domus envia a proposta) — o que falta é a proposta.
      const gratis = t.recebe?.gratis === true;
      const falta = gratis ? "" : faltaCurta(t.falta ?? []);
      if (pendenteIda(t)) espera(t, "Visita perdida por confirmar", "-ida");
      else if (t.reclamacao) {
        grupos.devolvido.push(tarefa({ id: `inicio-devolvido-${t.id}`, tipo: "alarme", rotulo: "Devolvido para corrigir",
          grande: t.reclamacao.de === "cliente" ? "O cliente diz que falta alguma coisa" : "A Domus Energia devolveu o trabalho",
          linhas: [el("span", "citacao", `«${t.reclamacao.texto}»`), `${quem} · ${onde}`], botao: "Abrir a ficha", ir: abrir(t) }));
      } else if (dia === hoje) {
        grupos.hoje.push([hora, tarefa({ id: `inicio-hoje-${t.id}`, tipo: "hoje", rotulo: "Visita de hoje", grande: [forte(hora), ` · ${onde}`],
          linhas: [quem, t.visita <= agora && falta ? `Falta: ${falta}` : null], botao: "Abrir a ficha", ir: abrir(t) })]);
      } else if (dia === amanha) {
        grupos.amanha.push([hora, tarefa({ id: `inicio-amanha-${t.id}`, tipo: "calma", rotulo: "Visita de amanhã", grande: [forte(hora), ` · ${onde}`], linhas: [quem], botao: "Abrir a ficha", ir: abrir(t) })]);
      } else if (dia < hoje && gratis) {
        if (t.proposta) espera(t, "Proposta enviada: à espera da Domus Energia");
        else grupos.concluir.push(tarefa({ id: `inicio-concluir-${t.id}`, tipo: "aviso", rotulo: "Proposta por enviar", grande: "Diga o que a obra precisa",
          linhas: [com(el("span"), "Visita de ", forte(visitaTxt(t.visita)), ` · ${onde}`), quem], botao: "Fazer a proposta", ir: abrir(t) }));
      } else if (dia < hoje) {
        grupos.concluir.push(tarefa({ id: `inicio-concluir-${t.id}`, tipo: "aviso", rotulo: `${nomeTrabalho} por concluir`, grande: falta ? `Falta: ${falta}` : "Falta dar por concluído",
          linhas: [com(el("span"), "Visita de ", forte(visitaTxt(t.visita)), ` · ${onde}`), quem], botao: `Continuar ${t.tipo === "obra" ? "a obra" : "o trabalho"}`, ir: abrir(t) }));
      } else espera(t, com(el("span"), "Visita marcada: ", forte(visitaTxt(t.visita))));
    }
  }
  const porOrdem = (lista) => lista.sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1]);
  const faturas = rp.trabalhos.filter((x) => x.pode_fatura && !x.fatura).map((x) => tarefa({ id: `inicio-fatura-${sufixo(x)}`, tipo: "aviso", rotulo: "Fatura-recibo em falta",
    grande: forte(x.valor ? euro(x.valor.total) : "—"), linhas: [`${x.titulo} · ${x.concelho}`], botao: "Enviar a fatura-recibo", ir: () => { focoPagamento = sufixo(x); ir("pagamentos"); } }));
  // Na bolsa conta o que ainda pede uma resposta dele: os pedidos em que já enviou proposta ficam de fora.
  const novos = rb.trabalhos.filter((t) => !t.proposta_enviada).length;
  // Parceiro: os pedidos da sua especialidade que só ele vê, para já (o prazo que acaba primeiro).
  const primeiro = rb.trabalhos.filter((t) => !t.proposta_enviada && t.prioridade_ate).map((t) => t.prioridade_ate).sort()[0];
  const soParaSi = textoPrioridade(primeiro);
  const bolsa = novos ? [tarefa({ id: "inicio-bolsa", rotulo: "Bolsa", grande: [forte(String(novos)), novos === 1 ? " pedido novo na bolsa" : " pedidos novos na bolsa"],
    linhas: [`Em ${rb.concelhos.join(", ")}.`, soParaSi ? com(el("span"), selo(soParaSi, "bom")) : null], botao: "Ver a bolsa", ir: "bolsa" })] : [];
  // As obras de que é o técnico responsável sem ser quem as faz (só para leitura): um cartão discreto por cada uma em curso.
  for (const o of assino.filter((x) => x.aberto)) {
    grupos.espera.push(tarefa({ id: `inicio-assino-${o.id}`, tipo: "discreta", grande: "É o técnico responsável desta obra", linhas: [`${o.titulo} · ${o.concelho}`], ir: `assino/${o.id}` }));
  }
  // Parceiro (decisão do dono, 2026-10-14): a tabela de preços da sua especialidade, sempre no fim.
  const tabela = eParceiro() ? [tarefa({ id: "inicio-precos", tipo: "discreta", rotulo: "Tabela de preços", grande: "Tabela de preços da minha especialidade",
    linhas: [`${eu.parceiro_de.map((x) => x.nome).join(" · ")}: as horas de cada artigo e o que recebe. Proponha outros valores.`], botao: "Ver a tabela", ir: "precos" })] : [];
  const cartoes = [...porOrdem(grupos.hoje), ...porOrdem(grupos.amanha), ...grupos.concluir, ...porOrdem(grupos.marcar), ...grupos.devolvido, ...grupos.espera, ...faturas, ...bolsa];
  const data = new Date().toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long" });
  const out = [el("h2", null, "O que tenho para fazer hoje"), el("p", "suave", `${data[0].toUpperCase()}${data.slice(1)}`)];
  if (!cartoes.length) {
    const vazio = com(el("div", "cartao pilha"), el("p", null, "Nada à sua espera."), el("p", "suave", "Quando houver um pedido novo no seu concelho, aparece aqui."));
    vazio.id = "inicio-vazio";
    out.push(vazio);
  }
  return [...out, ...cartoes, ...tabela];
}

// ---------------------------------------------------------------- Tabela de preços da minha especialidade
// Decisão do dono (2026-10-14): só para os PARCEIROS de uma especialidade (`eu.parceiro_de`; o servidor responde 403 a
// quem não é). De cada artigo vê só as horas de mão de obra de hoje e o que receberia — nunca o preço ao cliente nem o
// custo de compra da Domus (o servidor nem os envia). Propõe horas, material (texto), o custo do material na estimativa
// dele (opcional) e uma nota, ou um artigo novo. Nada muda até a Domus Energia aprovar.
const ESTADO_PRECO = { pendente: ["À espera da Domus Energia", "aviso"], aprovada: ["Aprovada", "bom"], recusada: ["Não aprovada", "mau"] };
const eParceiro = () => Array.isArray(eu?.parceiro_de) && eu.parceiro_de.length > 0;
const horasTxt = (v) => `${decimal(Math.round(Number(v) * 100) / 100)} h`;

function campoTexto(rotulo, input, dica) {
  return com(el("label", "campo"), el("span", null, rotulo), input, dica ? el("span", "dica", dica) : null);
}
/** O formulário da proposta: `artigo` (um que já existe) ou null (artigo novo). Envia e volta a desenhar a tabela. */
function formPreco(r, artigo) {
  const sufixo = artigo ? String(artigo.id) : "novo";
  const entrada = (nome, attrs = {}) => { const i = el("input"); i.id = `preco-${nome}-${sufixo}`; Object.assign(i, attrs); return i; };
  const nome = artigo ? null : entrada("nome", { maxLength: 160, autocomplete: "off" });
  let esp = null;
  if (!artigo && r.especialidades.length > 1) {
    esp = el("select");
    esp.id = `preco-especialidade-${sufixo}`;
    for (const x of r.especialidades) { const o = el("option", null, x.nome); o.value = x.chave; esp.append(o); }
  }
  const horas = entrada("horas", { type: "text", inputMode: "decimal", autocomplete: "off", placeholder: artigo ? horasTxt(artigo.horas).replace(" h", "") : "ex.: 0,5" });
  const material = entrada("material", { maxLength: 300, autocomplete: "off" });
  const custo = entrada("custo", { type: "text", inputMode: "decimal", autocomplete: "off" });
  const nota = el("textarea");
  nota.id = `preco-nota-${sufixo}`;
  nota.maxLength = 600;
  nota.rows = 3;
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const b = el("button", "btn cheio", artigo ? "Enviar a proposta" : "Propor o artigo novo");
  b.type = "button";
  b.id = `preco-enviar-${sufixo}`;
  const erro = (t, foco) => { msg.textContent = t; msg.hidden = false; foco?.focus(); };
  b.addEventListener("click", async () => {
    msg.hidden = true;
    const h = numeroDe(horas.value);
    if (h === null || Number.isNaN(h) || h <= 0 || h > (r.max_horas ?? 100)) return erro(`Horas: um número maior que 0 e até ${r.max_horas ?? 100}.`, horas);
    const c = numeroDe(custo.value);
    if (Number.isNaN(c) || (c !== null && c < 0)) return erro("O custo do material tem de ser um número (ou vazio).", custo);
    if (nome && nome.value.trim().length < 3) return erro("Escreva o nome do artigo novo.", nome);
    const corpo = { horas: h, material: material.value.trim() || null, custo: c, nota: nota.value.trim() || null };
    if (artigo) corpo.artigo_id = artigo.id;
    else { corpo.nome = nome.value.trim(); if (esp) corpo.especialidade = esp.value; }
    b.disabled = true;
    try {
      await pedir("precos", corpo);
      aviso("Proposta enviada. A Domus Energia vai rever.");
      encaminhar();
    } catch (e) { if (e.estado !== 401) erro(e.message); }
    finally { b.disabled = false; }
  });
  return [
    nome ? campoTexto("Nome do artigo", nome, "O que é, como aparece numa proposta.") : null,
    esp ? campoTexto("Especialidade", esp) : null,
    campoTexto("Horas de mão de obra", horas, artigo ? `Hoje: ${horasTxt(artigo.horas)}.` : null),
    campoTexto("Material", material, "O que leva (texto)."),
    campoTexto("Custo do material, na sua estimativa (€, opcional)", custo),
    campoTexto("Nota (opcional)", nota),
    el("p", "pequeno suave", "Só propõe horas e material: o preço ao cliente é da Domus Energia."),
    msg, b,
  ];
}
function linhaProposta(x) {
  const [txt, tipo] = ESTADO_PRECO[x.estado] ?? [x.estado, ""];
  const p = com(el("div", "nota pilha"), com(el("div", "selos"), selo(`A sua proposta: ${txt}`, tipo)),
    el("p", "pequeno", [`${horasTxt(x.horas)} · recebe ${euro(x.recebe)}`, x.material ? `Material: ${x.material}` : null, x.custo !== null && x.custo !== undefined ? `Custo do material: ${euro(x.custo)}` : null].filter(Boolean).join(" · ")),
    x.estado === "recusada" && x.motivo ? el("p", "pequeno", `Motivo: ${x.motivo}`) : null);
  p.id = `preco-proposta-${x.id}`;
  return p;
}
async function precos() {
  const r = await pedir("precos");
  const ultima = new Map();
  for (const x of r.propostas) if (x.artigo_id && !x.novo && !ultima.has(x.artigo_id)) ultima.set(x.artigo_id, x);   // vêm da mais recente para a mais antiga
  const nomes = r.especialidades.map((x) => x.nome).join(" · ");
  const out = [botaoVoltar("Início", "inicio"), el("h2", null, "Tabela de preços da minha especialidade"),
    el("p", "suave pequeno", `${nomes}. As horas de mão de obra que a Domus Energia usa hoje em cada artigo e o que recebe por elas: ${decimal(r.percentagem)} % da mão de obra, sem IVA. Se acha que um artigo leva mais (ou menos) tempo ou outro material, proponha: nada muda até a Domus Energia aprovar.`)];
  const procurar = el("input");
  procurar.type = "search";
  procurar.id = "precos-procurar";
  procurar.placeholder = "Procurar artigo";
  procurar.maxLength = 80;
  const cartoes = r.artigos.map((a) => {
    const p = ultima.get(a.id);
    const d = seccao(a.nome, p ? selo(ESTADO_PRECO[p.estado]?.[0] ?? p.estado, ESTADO_PRECO[p.estado]?.[1] ?? "") : null,
      com(el("div", "grelha-2"),
        com(el("div", "pilha"), el("p", "rotulo", "Mão de obra hoje"), el("p", "valor-grande", horasTxt(a.horas))),
        com(el("div", "pilha"), el("p", "rotulo", "Recebe"), el("p", "valor-grande", euro(a.recebe)))),
      p ? linhaProposta(p) : null,
      ...formPreco(r, a));
    d.open = false;
    d.id = `preco-artigo-${a.id}`;
    d.dataset.procura = `${a.nome} ${a.sku}`.toLowerCase();
    return d;
  });
  procurar.addEventListener("input", () => { const t = procurar.value.trim().toLowerCase(); for (const c of cartoes) c.hidden = Boolean(t) && !c.dataset.procura.includes(t); });
  out.push(campoTexto("Procurar", procurar));
  if (!cartoes.length) out.push(com(el("div", "cartao"), el("p", null, "Ainda não há artigos da sua especialidade no catálogo."), el("p", "suave pequeno", "Pode propor um artigo novo aqui em baixo.")));
  out.push(...cartoes);
  const novo = seccao("Propor um artigo novo", null, ...formPreco(r, null));
  novo.open = false;
  novo.id = "preco-artigo-novo";
  out.push(novo);
  const novos = r.propostas.filter((x) => x.novo);
  if (novos.length) {
    out.push(el("h2", null, "Artigos novos que propôs"));
    for (const x of novos) out.push(com(el("div", "cartao pilha"), el("p", null, x.nome), linhaProposta(x)));
  }
  return out;
}

// ---------------------------------------------------------------- o que recebe
function recebeTexto(r, tipo) {
  if (!r) return "O valor fica definido com a proposta ao cliente.";
  // Visita de orçamento sem custo para o cliente (pagamentos online desligados): só se ganha com a obra.
  if (r.gratis) return "Visita de orçamento sem custo para o cliente: não é paga. Se o cliente aceitar a proposta, a obra é sua e recebe a percentagem da mão de obra + deslocação.";
  const partes = `${decimal(r.percentagem)} % da mão de obra (${euro(r.parte_mao_obra)}) + deslocação (${euro(r.deslocacao)}), sem IVA.`;
  const extra = tipo === "avaria" ? " A taxa de diagnóstico fica na Domus Energia." : tipo === "obra" ? " Material fornecido pela Domus." : "";
  return partes + extra;
}
function cartaoRecebe(t) {
  const c = com(el("div", "cartao pilha"), el("p", "rotulo", "Valor que recebe"),
    el("p", "valor-grande", t.recebe?.gratis ? "Só com a obra" : t.recebe ? euro(t.recebe.total) : "A combinar"),
    el("p", "pequeno suave", recebeTexto(t.recebe, t.tipo)));
  if (t.recebe?.provisoria) c.append(el("p", "pequeno suave", "Estimativa: a proposta final ao cliente pode mudar este valor."));
  c.append(el("p", "pequeno suave", `Por transferência até ${PRAZO_DIAS} dias depois de: o cliente confirmar o trabalho, a Domus Energia o aprovar e, nas obras, o cliente pagar o restante. Contra fatura-recibo.`));
  return c;
}

// ---------------------------------------------------------------- Bolsa
/**
 * "Faço serviço de noite e ao fim de semana" (decisão do dono, 2026-10-13): o próprio eletricista liga e desliga; só
 * assim vê e é avisado das avarias pedidas fora de horas. Num servidor sem o campo (`eu.fora_horas`) o cartão não aparece.
 */
function cartaoForaHoras() {
  if (typeof eu?.fora_horas !== "boolean") return null;
  const c = el("input");
  c.type = "checkbox";
  c.id = "fora-horas";
  c.checked = eu.fora_horas;
  const msg = el("p", "erro");
  msg.hidden = true;
  c.addEventListener("change", async () => {
    c.disabled = true;
    msg.hidden = true;
    try {
      eu.fora_horas = (await pedir("fora-horas", { ligado: c.checked })).fora_horas === true;
      encaminhar();   // a bolsa passa a mostrar (ou deixa de mostrar) as avarias fora de horas
    } catch (e) {
      c.checked = eu.fora_horas;
      c.disabled = false;
      if (e.estado === 401) return;
      msg.textContent = e.message;
      msg.hidden = false;
    }
  });
  const l = com(el("label"), c, el("span", null, "Faço serviço de noite e ao fim de semana"));
  l.htmlFor = c.id;
  return com(el("div", "cartao pilha"), com(el("ul", "lista-mat marcar"), com(el("li"), l)),
    el("p", "pequeno suave", "Só assim recebe avarias fora do horário normal, pagas a mais 50 %."), msg);
}
async function bolsaLista() {
  const r = await pedir("bolsa");
  contadores(r.trabalhos.length, null);
  const out = [el("h2", null, "Bolsa"), el("p", "suave pequeno", r.propostas_bolsa
    ? `Trabalhos em ${r.concelhos.join(", ")}. Nos pedidos com planta envia a sua proposta e a Domus Energia escolhe; nos outros, o primeiro a aceitar fica com o trabalho.`
    : `Trabalhos em ${r.concelhos.join(", ")}. O primeiro a aceitar fica com o trabalho.`), cartaoForaHoras()];
  if (!r.trabalhos.length) {
    out.push(com(el("div", "cartao"), el("p", null, "Sem trabalhos na bolsa."), el("p", "suave pequeno", "Os trabalhos novos dos seus concelhos aparecem aqui.")));
    return out;
  }
  for (const t of r.trabalhos) {
    // Por proposta: não há valor nem "aceitar" — diz-se se a proposta já foi enviada.
    const b = t.por_proposta
      ? com(el("button", "cartao trab"), com(el("span", "selos"), selo(t.concelho), selo("Pedido com planta", "aviso"), seloEspecialidade(t), seloPrioridade(t), t.proposta_enviada ? selo("Proposta enviada", "bom") : null),
        el("h3", null, t.titulo),
        el("span", null, t.proposta_enviada ? "A Domus Energia escolhe o eletricista e avisa por email." : "Veja o relatório e as fotos e envie a sua proposta."),
        el("span", "pequeno suave", "Nome e morada do cliente só depois de o cliente aceitar a proposta."))
      : com(el("button", "cartao trab"), com(el("span", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo, "aviso"), seloForaHoras(t), seloEspecialidade(t), seloPrioridade(t)),
        el("h3", null, t.titulo),
        com(el("span"), "Recebe ", el("b", "num", t.recebe ? euro(recebeComExtras(t)) : "a combinar")),
        duracaoTxt(t) ? el("span", "pequeno suave", `Duração: ${duracaoTxt(t)}`) : null,
        el("span", "pequeno suave", "Nome e morada do cliente só depois de aceitar."));
    b.type = "button";
    b.id = `bolsa-trabalho-${t.id}`;
    b.addEventListener("click", () => ir(`bolsa/${t.id}`));
    out.push(b);
  }
  return out;
}

async function bolsaDetalhe(id) {
  const r = await pedir(`bolsa/${id}`);
  const t = r.trabalho;
  if (t.por_proposta) return detalhePorProposta(t);
  const aceitar = el("button", "btn cheio", "Aceitar trabalho");
  aceitar.type = "button";
  aceitar.id = "aceitar-trabalho";
  const msg = el("div", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  aceitar.addEventListener("click", async () => {
    aceitar.disabled = true;
    try {
      const a = await pedir(`bolsa/${t.id}/aceitar`, {});
      aviso(`Trabalho aceite. Tem ${r.prazo_visita_horas ?? 48} h para marcar a visita.`);
      ir(`trabalhos/${a.trabalho.id}`);
    } catch (e) {
      if (e.estado === 401) return;
      msg.textContent = e.message;
      msg.hidden = false;
      if (e.estado !== 409 && e.estado !== 404) aceitar.disabled = false;
    }
  });
  return [
    botaoVoltar("Bolsa", "bolsa"),
    com(el("div", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo), seloForaHoras(t), seloEspecialidade(t), seloPrioridade(t)),
    el("h2", null, t.titulo),
    duracaoTxt(t) ? el("p", "pequeno", `Duração estimada: ${duracaoTxt(t)}.`) : null,
    cartaoRecebe(t),
    blocoRelatorio(t.relatorio, "Relatório técnico (sem preços)"),
    el("p", "nota", `Nome, morada e telefone do cliente só aparecem depois de aceitar. Tem ${r.prazo_visita_horas ?? 48} h para marcar a visita; sem visita, o trabalho volta à bolsa.`),
    msg, aceitar,
  ].filter(Boolean);
}

/**
 * Trabalho por proposta (decisão do dono, 2026-10-10): em vez de "Aceitar", o relatório técnico, as fotos que o cliente
 * enviou e o formulário da proposta. Nada do cliente aqui: nome, morada e telefone só depois de o cliente aceitar.
 */
function detalhePorProposta(t) {
  const pct = t.recebe?.percentagem ?? eu?.percentagem;
  return [
    botaoVoltar("Bolsa", "bolsa"),
    com(el("div", "selos"), selo(t.concelho), selo("Pedido com planta"), seloEspecialidade(t), seloPrioridade(t), t.proposta_enviada ? selo("Proposta enviada", "bom") : null),
    el("h2", null, t.titulo),
    com(el("div", "cartao pilha"), el("p", "rotulo", "Como funciona"),
      el("p", null, "Envie a sua proposta: as horas de trabalho, o material e quando pode ir. A Domus Energia compara as propostas e escolhe o eletricista."),
      el("p", "pequeno suave", `Se for escolhido e o cliente aceitar a proposta, a obra é sua: recebe ${pct === undefined || pct === null ? "a sua percentagem" : `${decimal(pct)} %`} da mão de obra + a deslocação, sem IVA. A visita está incluída e o material é fornecido pela Domus.`)),
    blocoRelatorio(t.relatorio, "Relatório técnico (sem preços)"),
    fotosDoCliente(t),
    formPropostaBolsa(t),
    el("p", "nota", "Nome, morada e telefone do cliente só aparecem depois de o cliente aceitar a proposta. Aí tem 48 h para marcar a visita."),
  ].filter(Boolean);
}
/** As fotos que o cliente enviou com o pedido (a do quadro e as das divisões): só a imagem e de onde é. */
function fotosDoCliente(t) {
  const fotos = t.fotos ?? [];
  const c = com(el("div", "cartao pilha"), el("h3", null, "Fotos enviadas pelo cliente"));
  c.id = "fotos-cliente";
  if (!fotos.length) { c.append(el("p", "suave", "O cliente não enviou fotos.")); return c; }
  const grelha = el("div", "fotos-grelha");
  for (const f of fotos) {
    const img = el("img");
    img.src = urlServidor(f.url);
    img.alt = f.nome;
    img.loading = "lazy";
    if (base) img.crossOrigin = "use-credentials";
    const a = com(el("a"), img);
    a.href = urlServidor(f.url);
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Abrir a foto inteira";
    grelha.append(com(el("figure", "mini-foto"), a, el("figcaption", "pequeno suave", f.nome)));
  }
  c.append(grelha);
  return c;
}
/** O formulário da proposta na bolsa: o da proposta depois da visita (horas, material, notas) mais "Quando pode ir?". Depois de enviada, pode corrigir-se. */
function formPropostaBolsa(t) {
  const p = t.minha_proposta;
  const c = com(el("div", "cartao pilha"), el("h3", null, p ? "A sua proposta" : "Fazer proposta"));
  c.id = "proposta-bolsa";
  const msg = el("p", "erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const f = camposProposta(p, msg);
  const quando = el("input");
  quando.type = "text"; quando.maxLength = 200; quando.id = "proposta-disponibilidade";
  quando.placeholder = "ex.: a partir de 20 de outubro, manhãs";
  quando.value = p?.disponibilidade ?? "";
  const enviar = el("button", "btn cheio", p ? "Enviar proposta corrigida" : "Enviar proposta");
  enviar.type = "button";
  enviar.id = "proposta-enviar";
  enviar.addEventListener("click", async () => {
    msg.hidden = true;
    const v = f.ler();
    if (!v) return;
    const disponibilidade = quando.value.trim();
    if (disponibilidade.length < 3) { msg.textContent = "Diga quando pode ir (ex.: a partir de 20 de outubro, manhãs)."; msg.hidden = false; quando.focus(); return; }
    enviar.disabled = true;
    try {
      const r = await pedir(`bolsa/${t.id}/proposta`, { ...v, disponibilidade });
      aviso(r.mensagem ?? "Proposta enviada. A Domus Energia escolhe o eletricista e avisa por email.");
      $("el-vista").replaceChildren(...detalhePorProposta(r.trabalho));
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.estado === 401) return;
      msg.textContent = e.message;
      msg.hidden = false;
      if (e.estado !== 409 && e.estado !== 404) enviar.disabled = false;
    }
  });
  const zona = com(el("div", "pilha"), el("p", "pequeno suave", "Diga o que a obra precisa pelo relatório e pelas fotos. Não escreva preços: a Domus Energia calcula-os."),
    f.horas, ...f.material, f.campo("Quando pode ir?", quando), f.notas, msg, enviar);
  if (p) {
    const nota = el("div", "nota calma");
    nota.id = "proposta-enviada";
    com(nota, el("p", null, "Proposta enviada. A Domus Energia escolhe o eletricista e avisa por email."),
      el("p", "pequeno", `${dataCurta(p.quando)}: ${decimal(p.horas)} h de trabalho${p.material.length ? `, ${p.material.length} ${p.material.length === 1 ? "artigo" : "artigos"}` : ""} · ${p.disponibilidade}`));
    const corrigir = el("button", "btn sec", "Corrigir proposta");
    corrigir.type = "button";
    corrigir.id = "proposta-corrigir";
    zona.hidden = true;
    corrigir.addEventListener("click", () => { zona.hidden = false; corrigir.hidden = true; zona.querySelector("input")?.focus(); });
    c.append(nota, el("p", "pequeno suave", "Pode corrigi-la enquanto o trabalho estiver na bolsa."), com(el("div"), corrigir));
  }
  c.append(zona);
  return c;
}

// ---------------------------------------------------------------- relatório técnico (sem preços)
function listaMaterial(linhas, chaveNome = "artigo") {
  return com(el("ul", "lista-mat"), linhas.map((l) => com(el("li"), el("span", null, l[chaveNome]), el("span", "qt", `${decimal(l.quantidade)} un.`))));
}
function blocoRelatorio(rel, titulo, extra = []) {
  const c = com(el("div", "cartao pilha relatorio-tecnico"), el("h3", null, titulo));
  if (!rel) {
    c.append(el("p", "suave", "Este pedido não tem relatório técnico: a Domus Energia explica o trabalho quando falar consigo."));
    return c;
  }
  const a = rel.acoes ?? {};
  const resumo = [["reparar", "a reparar"], ["substituir", "a substituir"], ["novo", "novos"], ["manter", "ficam como estão"]]
    .filter(([k]) => a[k] > 0).map(([k, t]) => `${a[k]} ${a[k] === 1 ? "aparelho" : "aparelhos"} ${t}`);
  if (resumo.length) c.append(el("p", "pequeno", `Lista de trabalho: ${resumo.join(" · ")}.`));
  const divs = el("ul", "divisoes");
  for (const d of rel.divisoes ?? []) {
    const li = com(el("li"), el("b", null, d.nome));
    if (d.trabalho?.length) li.append(com(el("ul"), d.trabalho.map((x) => el("li", null, x))));
    if (d.material?.length) li.append(listaMaterial(d.material));
    divs.append(li);
  }
  if (divs.children.length) c.append(divs);
  if (rel.geral?.material?.length) c.append(el("h4", null, rel.geral.titulo), listaMaterial(rel.geral.material));
  for (const p of rel.melhorias ?? []) if (p.material?.length) c.append(el("h4", null, p.nome), listaMaterial(p.material));
  c.append(...seccaoTecnica(rel, { titulo: "h4", subtitulo: "h5" }));
  if (rel.esquema_quadro && typeof rel.esquema_quadro === "object") {
    let svg = null;
    try { svg = desenharQuadroCliente(rel.esquema_quadro, { resumo: "esquema do quadro elétrico" }); } catch { svg = null; }
    if (svg) {
      svg.removeAttribute("id");
      svg.setAttribute("role", "img");
      for (const g of svg.querySelectorAll(".qd-item")) { g.removeAttribute("tabindex"); g.removeAttribute("role"); }
      c.append(el("h4", null, "Esquema do quadro elétrico"), com(el("div", "rel-quadro"), svg));
    }
  }
  const dg = rel.diagnostico;
  if (dg && typeof dg === "object") {
    c.append(el("h4", null, "Diagnóstico registado"));
    if (dg.tipo_nome) c.append(el("p", null, `Tipo de avaria: ${dg.tipo_nome}.`));
    if (dg.conclusao) c.append(el("p", null, dg.conclusao));
  }
  c.append(...extra);
  return c;
}

// ---------------------------------------------------------------- Os meus trabalhos
async function trabalhosLista() {
  const [r, assino] = await Promise.all([pedir("trabalhos"), obrasQueAssino()]);
  contadores(null, r.trabalhos.filter((t) => t.estado === "aceite" && t.aberto && !t.espera_cliente).length);
  const out = [el("h2", null, "Os meus trabalhos")];
  if (!r.trabalhos.length) {
    out.push(com(el("div", "cartao"), el("p", null, "Sem trabalhos em curso."), el("p", "suave pequeno", r.propostas_bolsa ? "Os trabalhos em que for escolhido (ou que aceitar) aparecem aqui." : "Os trabalhos que aceitar na Bolsa aparecem aqui.")));
    return [...out, ...cartoesAssino(assino)];
  }
  for (const t of r.trabalhos) {
    const b = com(el("button", "cartao trab"), com(el("span", "selos"), selo(t.concelho), seloEstado(t)), el("h3", null, t.titulo));
    if (t.espera_cliente) b.append(el("span", "pequeno", "Escolhido. À espera de o cliente aceitar a proposta."));
    else if (t.aberto && t.estado === "aceite" && t.prazo) b.append(contagem(t.prazo, "para marcar a visita"));
    else if (t.visita) b.append(el("span", "pequeno", `Visita: ${visitaTxt(t.visita)}`));
    b.type = "button";
    b.id = `meu-trabalho-${t.id}`;
    b.addEventListener("click", () => ir(`trabalhos/${t.id}`));
    out.push(b);
  }
  return [...out, ...cartoesAssino(assino)];
}

// ---------------------------------------------------------------- Obras que assino (técnico responsável; decisão do dono, 2026-10-13)
// As obras de que este eletricista é o técnico responsável sem ser quem as faz: só para leitura (planta, relatório
// técnico, fotos e ensaios). Não tem valores nem pagamentos: quem recebe pela obra é quem a faz.
/** A lista do servidor; vazia se o servidor ainda não a tiver (não diz `obras_assino` ao entrar) ou se falhar — nunca estraga o resto do ecrã. */
async function obrasQueAssino() {
  if (eu?.obras_assino !== true) return [];
  try { const r = await pedir("obras-assino"); return Array.isArray(r?.obras) ? r.obras : []; } catch (e) { if (e?.estado === 401) throw e; return []; }
}
const ESTADO_ASSINO = { aceite: "Visita por marcar", visita_marcada: "Em curso", concluida_eletricista: "Concluída: a aguardar o cliente", confirmada: "Confirmada pelo cliente", aprovada: "Aprovada", paga: "Aprovada" };
const seloAssino = (o) => (!o.aberto ? selo("Fechada") : selo(ESTADO_ASSINO[o.estado] ?? o.estado, o.estado === "visita_marcada" || o.estado === "aceite" ? "aviso" : "bom"));
function cartoesAssino(obras) {
  if (!obras.length) return [];
  const out = [el("h2", null, "Obras que assino"), el("p", "suave pequeno", "É o técnico responsável destas obras: quem as faz é outro eletricista. Aqui só se vê; não se altera nada.")];
  for (const o of obras) {
    const b = com(el("button", "cartao trab"), com(el("span", "selos"), selo(o.concelho), seloAssino(o)), el("h3", null, o.titulo),
      o.executante?.nome ? el("span", "pequeno", `Quem faz a obra: ${o.executante.nome}`) : null,
      o.visita ? el("span", "pequeno", `Visita: ${visitaTxt(o.visita)}`) : null);
    b.type = "button";
    b.id = `obra-assino-${o.id}`;
    b.addEventListener("click", () => ir(`assino/${o.id}`));
    out.push(b);
  }
  return out;
}
const NOME_ENSAIO_ASSINO = [["continuidade_pe", "Continuidade do PE", "Ω"], ["isolamento", "Resistência de isolamento", "MΩ"], ["terra", "Resistência de terra", "Ω"], ["diferencial", "Disparo do diferencial", "ms"]];
async function obraAssino(id) {
  const o = (await pedir(`obras-assino/${id}`)).obra;
  const out = [botaoVoltar("Os meus trabalhos", "trabalhos"), com(el("div", "selos"), selo(o.concelho), selo("Obra"), seloEspecialidade(o), seloAssino(o)), el("h2", null, o.titulo),
    el("p", "nota calma", "É o técnico responsável desta obra: é quem a assina. Aqui só se vê; quem a faz e a dá por concluída é o eletricista da obra.")];
  const quem = com(el("div", "cartao pilha"), el("h3", null, "A obra"));
  quem.id = "assino-obra";
  if (o.executante?.nome) quem.append(com(el("p"), "Quem faz a obra: ", el("b", null, o.executante.nome)));
  if (o.cliente) quem.append(com(el("p"), "Cliente: ", el("b", null, o.cliente.nome ?? "—")), el("p", "pequeno", [o.cliente.morada, o.cliente.localidade].filter(Boolean).join(", ") || o.concelho));
  quem.append(el("p", "pequeno", o.visita ? `Visita: ${visitaTxt(o.visita)}` : "Visita ainda por marcar."));
  if (o.concluida) quem.append(el("p", "pequeno", `Dada por concluída em ${dataLonga(o.concluida)}.`));
  out.push(quem);
  if (!o.aberto) { out.push(el("p", "nota", "Esta obra já está fechada: o relatório, as fotos e os dados do cliente deixaram de estar disponíveis.")); return out; }
  // Ensaios medidos por quem fez a obra (os que estão fora do limite vêm assinalados, com a nota).
  const e = o.ensaios ?? {};
  const medidos = NOME_ENSAIO_ASSINO.filter(([k]) => e[k] !== null && e[k] !== undefined);
  const ens = com(el("div", "cartao pilha"), el("h3", null, "Ensaios"));
  ens.id = "assino-ensaios";
  if (!medidos.length) ens.append(el("p", "suave", "Ainda sem ensaios registados."));
  else ens.append(com(el("ul", "lista-mat"), medidos.map(([k, nome, un]) => com(el("li"), el("span", null, nome), com(el("span", "qt"), `${decimal(e[k])} ${un} `, (e.fora ?? []).includes(k) ? selo("Fora do limite", "mau") : null)))));
  if (e.notas) ens.append(el("p", "pequeno", `Nota: ${e.notas}`));
  out.push(ens);
  // Fotos de antes e de depois.
  const fotos = o.fotos ?? [];
  const cf = com(el("div", "cartao pilha"), el("h3", null, "Fotos da obra"));
  cf.id = "assino-fotos";
  if (!fotos.length) cf.append(el("p", "suave", "Ainda sem fotos."));
  else {
    const grelha = el("div", "fotos-grelha");
    for (const f of fotos) {
      const img = el("img");
      img.src = urlServidor(f.url);
      img.alt = f.grupo_nome ?? "Foto da obra";
      img.loading = "lazy";
      if (base) img.crossOrigin = "use-credentials";
      const a = com(el("a"), img);
      a.href = urlServidor(f.url);
      a.target = "_blank";
      a.rel = "noopener";
      a.title = "Abrir a foto inteira";
      grelha.append(com(el("figure", "mini-foto"), a, el("figcaption", "pequeno suave", f.grupo_nome ?? "")));
    }
    cf.append(grelha);
  }
  out.push(cf);
  const mat = o.material ?? [];
  out.push(blocoRelatorio(o.relatorio, "Relatório técnico (sem preços)", mat.length ? [el("h4", null, "Material da obra"), listaMaterial(mat, "nome")] : []));
  return out;
}
const seloEstado = (t) => (t.estado === "paga" ? selo("Pago", "bom") : t.estado === "aprovada" ? selo("Aprovado", "bom") : !t.aberto ? selo("Fechado")
  : t.espera_cliente ? selo("Escolhido", "bom")
  : t.estado === "concluida_eletricista" ? selo("A aguardar o cliente", "aviso") : t.estado === "confirmada" ? selo("A aguardar aprovação", "aviso")
  : t.estado === "aceite" ? selo("Marcar visita", "aviso") : selo(`Visita ${visitaTxt(t.visita)}`, "bom"));

let abaFicha = "cliente";
let fichaAberta = null;   // o trabalho cuja ficha está desenhada: ao abrir uma ficha, começa no primeiro passo por fazer
async function ficha(id) {
  const r = await pedir(`trabalhos/${id}`);
  fichaAberta = null;
  return desenharFicha(r.trabalho);
}
/** Depois de uma ação na ficha: redesenha-a com o trabalho que o servidor devolveu, sem mexer na posição da página. */
function refrescar(t) {
  const y = window.scrollY;
  pararContagem();
  $("el-vista").replaceChildren(...desenharFicha(t));
  window.scrollTo(0, y);
  iniciarContagem();
}
/** Faz o pedido de uma ação da ficha e redesenha; o erro aparece no aviso (e em `msg`, se houver). */
async function acaoFicha(t, caminho, corpo, { botao = null, msg = null, texto = null, bruto = false } = {}) {
  if (botao) botao.disabled = true;
  if (msg) msg.hidden = true;
  try {
    const r = await pedir(`trabalhos/${t.id}/${caminho}`, corpo, bruto);
    if (texto) aviso(texto);
    refrescar(r.trabalho);
    return true;
  } catch (e) {
    if (e.estado === 401) return false;
    if (msg) { msg.textContent = e.message; msg.hidden = false; } else aviso(e.message);
    if (botao) botao.disabled = false;
    return false;
  }
}

function desenharFicha(t) {
  const out = [botaoVoltar("Os meus trabalhos", "trabalhos"), com(el("div", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo), seloForaHoras(t), seloEstado(t)), el("h2", null, t.titulo),
    t.espera_cliente ? el("p", "pequeno", "Recebe a sua percentagem da mão de obra + a deslocação quando fizer a obra (a visita está incluída).")
    // Obra parada por segurança: já não vale a estimativa; recebe o trabalho já feito, pelo valor que a Domus Energia indicou.
    : t.obra_parada ? com(el("p", "pequeno"), "A obra foi parada por segurança. Pelo trabalho já feito recebe ", el("b", "num", euro(t.recebe?.total)), " (sem IVA).")
    : t.recebe?.gratis ? el("p", "pequeno", "Visita de orçamento: não é paga. Recebe se o cliente aceitar a proposta e fizer a obra.")
      : com(el("p", "pequeno"), "Recebe ", el("b", "num", t.recebe ? euro(recebeComExtras(t)) : "a combinar"), t.recebe ? ` · ${decimal(t.recebe.percentagem)} % da mão de obra + deslocação${extrasAceites(t) ? " + trabalho a mais" : ""}${idasConfirmadas(t) ? " + ida perdida" : ""}` : "")];
  if (!t.aberto) {
    out.push(el("p", "nota calma", "Trabalho fechado: os dados do cliente já não estão disponíveis."));
    if (["aprovada", "paga"].includes(t.estado)) {
      const b = el("button", "btn sec", "Ver em Pagamentos");
      b.type = "button";
      b.addEventListener("click", () => ir("pagamentos"));
      out.push(b);
    }
    return out;
  }
  // Escolhido entre as propostas da bolsa, com o cliente ainda por aceitar (decisão do dono, 2026-10-10): sem dados do
  // cliente, sem "Marcar visita" e sem prazo. Fica o relatório, a proposta que enviou e "Largar trabalho".
  if (t.espera_cliente) {
    const n = el("div", "nota calma");
    n.id = "espera-cliente";
    com(n, el("p", null, "Escolhido. À espera de o cliente aceitar a proposta."),
      el("p", "pequeno", "Quando o cliente aceitar, avisamos por email: passa a ver o nome, a morada e o telefone e tem 48 h para marcar a visita. Pode fazer a obra nessa visita."));
    const pr = t.proposta;
    out.push(n, pr ? com(el("div", "cartao pilha"), el("h3", null, "A sua proposta"),
      el("p", null, `${decimal(pr.horas)} h de trabalho${pr.material.length ? ` e ${pr.material.length} ${pr.material.length === 1 ? "artigo" : "artigos"}` : ""}.`),
      pr.material.length ? com(el("ul", "pequeno"), ...pr.material.map((m) => el("li", null, `${m.qtd} × ${m.nome}`))) : null,
      pr.notas ? el("p", "pequeno suave", `«${pr.notas}»`) : null) : null,
      blocoRelatorio(t.relatorio, "Relatório técnico (sem preços)"),
      com(el("div", "pilha fecho"), el("p", "pequeno suave", "Se já não puder fazer este trabalho, largue-o: volta à bolsa e fica registado."), botaoLargar(t)));
    return out.filter(Boolean);
  }
  if (t.estado === "concluida_eletricista" || t.estado === "confirmada") {
    const n = el("p", "nota calma");
    n.id = "obra-estado";
    com(n, el("b", null, `Deu o trabalho por concluído em ${dataCurta(t.concluida)}.`),
      t.estado !== "confirmada" ? " A aguardar confirmação do cliente." : t.sem_defeito ? " A Domus Energia viu que não havia defeito: o trabalho fica concluído e falta só a aprovação." : " O cliente confirmou: falta a aprovação da Domus Energia.");
    out.push(n);
  }
  // O trabalho voltou: o que o cliente disse que falta, ou o motivo da Domus Energia.
  if (t.reclamacao) {
    const n = el("div", "nota alarme");
    n.id = "trabalho-voltou";
    com(n, el("p", null, t.reclamacao.de === "cliente" ? "O cliente diz que o trabalho não ficou concluído:" : "A Domus Energia devolveu-lhe o trabalho:"),
      el("p", null, `«${t.reclamacao.texto}»`),
      t.reclamacao.decisao === "defeito" ? el("p", "pequeno", "Ficou decidido que é para corrigir: a ida não é paga à parte.") : null,
      el("p", "pequeno", "Combine a ida com o cliente e volte a dar o trabalho por concluído."));
    out.push(n);
  }
  const passos = passosDaFicha(t);
  // O passo seguinte por fazer (em destaque, e onde a ficha abre). Na visita de orçamento sem custo não há fotos nem
  // ensaios a pedir: marca-se a visita e, depois dela, o que falta é a proposta (no último passo).
  const porFazer = t.recebe?.gratis ? (t.visita ? "concluir" : "cliente") : (passos.find((p) => !p.feito)?.k ?? "concluir");
  const seguinte = t.editavel ? porFazer : null;
  if (fichaAberta !== t.id || !passos.some((p) => p.k === abaFicha)) { fichaAberta = t.id; abaFicha = porFazer; }
  const abas = el("div", "ficha-passos");
  abas.setAttribute("role", "tablist");
  abas.setAttribute("aria-label", "Passos da ficha, pela ordem do trabalho");
  const painel = el("div", "pilha");
  painel.id = "ficha-painel";
  painel.setAttribute("role", "tabpanel");
  /** Muda de passo; vindo de "Seguinte", "Anterior" ou do resumo do que falta, sobe até aos passos e põe lá o foco. */
  const mudar = (k, subir = true) => {
    abaFicha = k;
    desenhar();
    if (!subir) return;
    abas.scrollIntoView({ block: "start" });
    $(`ficha-aba-${k}`)?.focus({ preventScroll: true });
  };
  const desenhar = () => {
    const i = passos.findIndex((p) => p.k === abaFicha), p = passos[i];
    for (const b of abas.children) b.setAttribute("aria-selected", String(b.dataset.aba === abaFicha));
    painel.setAttribute("aria-labelledby", `ficha-aba-${abaFicha}`);
    // Em baixo, a toda a largura: o passo seguinte (cheio quando este já está feito) e, mais discreto, o anterior.
    const nav = el("div", "ficha-nav");
    if (i > 0) {
      const antes = el("button", "btn sec", "Anterior");
      antes.type = "button";
      antes.id = "ficha-anterior";
      antes.setAttribute("aria-label", `Passo anterior: ${passos[i - 1].nome}`);
      antes.addEventListener("click", () => mudar(passos[i - 1].k));
      nav.append(antes);
    }
    if (i < passos.length - 1) {
      const depois = el("button", p.feito ? "btn" : "btn sec", `Seguinte: ${passos[i + 1].nome}`);
      depois.type = "button";
      depois.id = "ficha-seguinte";
      depois.addEventListener("click", () => mudar(passos[i + 1].k));
      nav.append(depois);
    }
    painel.replaceChildren(el("p", "rotulo passo-onde", `Passo ${i + 1} de ${passos.length} · ${p.nome}`), ...p.partes(t, mudar), nav);
  };
  passos.forEach((p, i) => {
    const n = el("span", "n", p.feito ? "✓" : String(i + 1));
    n.setAttribute("aria-hidden", "true");
    const b = com(el("button", `${p.feito ? "feito" : ""} ${p.k === seguinte ? "seguinte" : ""}`.trim()), n, el("span", null, p.nome),
      el("span", "so-leitor", ` (passo ${i + 1} de ${passos.length}${p.feito ? ", feito" : p.k === seguinte ? ", a seguir" : ""})`));
    b.type = "button";
    b.id = `ficha-aba-${p.k}`;
    b.dataset.aba = p.k;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "ficha-painel");
    b.addEventListener("click", () => mudar(p.k, false));
    abas.append(b);
  });
  desenhar();
  out.push(abas, painel);
  return out;
}
/**
 * Os passos da ficha, pela ordem real do trabalho (decisão do dono, 2026-10-13), cada um com o que já está feito (o
 * visto) e o que mostra. As fotos de antes e de depois são os mesmos grupos do servidor, em passos separados. No
 * diagnóstico de avaria o passo 3 é o próprio diagnóstico; a proposta depois da visita fica no último passo.
 * "Trabalho" não tem um "feito" no servidor: conta o que lá se marca (material e listas de verificação, sem nada à
 * espera de resposta) e, sem nada para marcar, só fica feito quando já há ensaios ou fotos de depois.
 */
function passosDaFicha(t) {
  const tem = (fim) => (t.fotos ?? []).some((f) => f.grupo.endsWith(fim));
  const e = t.ensaios ?? {};
  const ensaios = ["isolamento", "diferencial", "terra"].every((k) => e[k] !== null && e[k] !== undefined);
  const avaria = t.tipo === "avaria";
  const mat = t.material ?? [], listas = t.checklists?.checklists ?? [];
  const marcado = mat.every((m) => m.recebido) && listas.every((l) => l.feitos > 0 && !l.obrigatorios_falta) && !pendenteExtra(t) && !pendenteIda(t);
  const trabalho = marcado && (avaria ? Boolean(t.diagnostico?.atual?.conclusao) : mat.length > 0 || listas.length > 0 || ensaios || tem("_depois"));
  return [
    { k: "cliente", nome: "Cliente e visita", feito: Boolean(t.visita), partes: parteCliente },
    { k: "antes", nome: "Fotos de antes", feito: tem("_antes"), partes: (x) => parteFotos(x, "_antes") },
    { k: "trabalho", nome: avaria ? "Diagnóstico" : "Trabalho", feito: trabalho, partes: parteTrabalho },
    { k: "ensaios", nome: "Ensaios", feito: ensaios, partes: parteEnsaios },
    { k: "depois", nome: "Fotos de depois", feito: tem("_depois"), partes: (x) => parteFotos(x, "_depois") },
    { k: "concluir", nome: "Concluir", feito: ["concluida_eletricista", "confirmada"].includes(t.estado), partes: (x, mudar) => [...(x.pode_proposta || x.proposta ? [seccaoProposta(x)] : []), parteFim(x, mudar)] },
  ];
}
const dataCurta = (isoTxt) => { const d = new Date(isoTxt); return Number.isNaN(d.getTime()) ? "" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };

function seccao(titulo, seloEl, ...corpo) {
  const d = el("details", "sec");
  d.open = true;
  const s = com(el("summary"), el("span", null, titulo), seloEl);
  d.append(s, com(el("div", "corpo"), ...corpo));
  return d;
}

function parteCliente(t) {
  const c = t.cliente ?? {};
  const dl = el("dl", "dados");
  for (const [k, v] of [["Nome", c.nome], ["Morada", [c.morada, c.localidade].filter(Boolean).join(", ")], ["Telefone", c.telefone]]) dl.append(el("dt", null, k), el("dd", null, v || "—"));
  const ligar = c.telefone ? (() => { const a = el("a", "btn sec mini", "Ligar"); a.href = `tel:${String(c.telefone).replace(/[^\d+]/g, "")}`; return a; })() : null;
  const cliente = seccao("Cliente", null, dl, el("p", "nota calma", "Ligue ou escreva sempre em nome da Domus Energia. Estes dados ficam visíveis até o trabalho fechar."),
    ligar ? com(el("div", "fila"), ligar) : el("p", "pequeno suave", "Sem telefone: peça o contacto à Domus Energia."));
  return [cliente, seccaoVisita(t)];
}

/**
 * Aparelhos da casa (ativação; decisões do dono, 2026-10-09): o eletricista regista o chip (o MAC que o aparelho mostra
 * na sua página) de cada aparelho que montou. Fica à espera da Domus, ou vale logo se for eletricista de confiança.
 * Só aparece quando a casa do pedido já existe no programa; a secção carrega à parte (GET trabalhos/:id/aparelhos).
 */
function seccaoAparelhos(t) {
  const corpo = el("div");
  corpo.id = "aparelhos-corpo";
  const sec = seccao("Aparelhos da casa", null, corpo);
  sec.hidden = true;
  const CHIP = { por_registar: "por registar", por_ver: "registado", confere: "registado e a responder", diferente: "diferente do que o aparelho anuncia" };
  const PEDIDO = { pendente: "à espera da Domus", aprovada: "aprovado", recusada: "recusado", anulada: "anulado" };
  const desenhar = (r) => {
    if (!r.casa_criada || !r.aparelhos.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const msg = el("p", "erro");
    msg.hidden = true;
    msg.setAttribute("role", "alert");
    const linhas = r.aparelhos.map((a) => {
      const ultimo = r.pedidos.find((p) => p.aparelho === a.id);
      const li = com(el("li"), el("strong", null, a.nome), el("span", "pequeno suave", ` ${a.divisao ?? ""} · chip ${CHIP[a.chip] ?? a.chip}${ultimo ? ` · o seu registo: ${PEDIDO[ultimo.estado] ?? ultimo.estado}` : ""}`));
      if (r.pode_registar) {
        const mac = el("input");
        mac.type = "text"; mac.maxLength = 17; mac.placeholder = "38:1F:8D:12:AB:CD"; mac.id = `chip-mac-${a.id}`;
        mac.setAttribute("aria-label", `Código do chip (MAC) de ${a.nome}`);
        mac.autocapitalize = "characters";
        const b = el("button", "btn sec pequeno", "Registar chip");
        b.type = "button";
        b.id = `chip-registar-${a.id}`;
        b.addEventListener("click", async () => {
          if (mac.value.replace(/[^0-9a-f]/gi, "").length !== 12) { msg.textContent = "O código do chip tem 12 algarismos e letras de A a F (aparece na página do aparelho)."; msg.hidden = false; mac.focus(); return; }
          b.disabled = true; msg.hidden = true;
          try {
            const novo = await pedir(`trabalhos/${t.id}/chip`, { aparelho: a.id, mac: mac.value.trim() });
            desenhar(novo);
            aviso(novo.sem_aprovacao ? "Chip registado." : "Chip registado. Fica à espera da aprovação da Domus.");
          } catch (e) {
            b.disabled = false;
            if (e.estado !== 401) { msg.textContent = e.message; msg.hidden = false; }
          }
        });
        li.append(com(el("div", "fila"), mac, b));
      }
      return li;
    });
    corpo.replaceChildren(
      el("p", "pequeno suave", r.sem_aprovacao
        ? "Registe o chip de cada aparelho que montou: o código que o aparelho mostra na página dele. O seu registo vale logo."
        : "Registe o chip de cada aparelho que montou: o código que o aparelho mostra na página dele. A Domus aprova o registo."),
      com(el("ul", "lista-aparelhos"), ...linhas), msg);
  };
  pedir(`trabalhos/${t.id}/aparelhos`).then(desenhar).catch(() => { sec.hidden = true; });
  return sec;
}

/**
 * Quadro elétrico (decisão do dono, 2026-10-05): lado a lado o quadro existente, que o eletricista regista aqui (pela
 * foto ou na visita), e o quadro ideal, calculado da casa do pedido (relatorio-casa.js); por baixo, o que falta ao
 * existente para chegar ao ideal. O registo é por contagens (geral, diferenciais, disjuntores por amperes, módulos
 * livres): a ordem na calha fica a do desenhador. O ideal traz a proteção completa, por isso o registo tem também as
 * proteções (descarregador, relé de tensão, medidor, geral Wi-Fi) e quantos disjuntores têm AFDD (os primeiros da lista).
 */
function seccaoQuadro(t) {
  const q = t.quadro;
  if (!q) return null;
  const casa = q.casa;
  let ideal = null;
  try { ideal = casa ? analiseDaCasa(casa.planta, casa, casa.potencia_sugerida_kva ?? undefined).esquema : null; } catch { ideal = null; }
  let l = normalizarEsquema(q.existente) ?? esquemaVazio();
  // O registo é por contagens: só serve se o que está guardado se consegue escrever assim (amperes das listas,
  // diferenciais de 30 ou 300 mA). Um quadro desenhado ao pormenor no painel fica só para ver, para não se perder.
  const l0 = l;
  const cabeNoRegisto = (!l0.disjuntor_geral || l0.disjuntor_geral.amperes === null || AMPERES_GERAL.includes(l0.disjuntor_geral.amperes))
    && l0.diferenciais.every((d) => d.sensibilidade_ma === 30 || d.sensibilidade_ma === 300)
    && l0.disjuntores.every((d) => AMPERES_DISJUNTOR.includes(d.amperes));
  const desenho = (esq, resumo) => {
    let svg = null;
    try { svg = desenharQuadroCliente(esq, { soLeitura: true, resumo }); } catch { svg = null; }
    if (!svg) return el("p", "pequeno suave", "Não foi possível desenhar.");
    svg.removeAttribute("id");
    svg.setAttribute("role", "img");
    for (const g of svg.querySelectorAll(".qd-item")) { g.removeAttribute("tabindex"); g.removeAttribute("role"); }
    return com(el("div", "rel-quadro"), svg);
  };
  const cxExistente = el("div"), cxFalta = el("div");
  const desenhar = () => {
    cxExistente.replaceChildren(esquemaTemAlgo(l) ? desenho(l, "quadro existente") : el("p", "pequeno suave", "Ainda por registar."));
    const d = esquemaTemAlgo(l) ? diferencasQuadro(l, ideal) : null;
    cxFalta.replaceChildren(el("h4", null, "O que falta ao quadro existente"),
      !ideal ? el("p", "pequeno suave", "Sem a descrição da casa neste pedido, não há quadro ideal para comparar.")
        : !d ? el("p", "pequeno suave", "Registe o quadro existente para ver o que falta.")
          : d.falta.length ? com(el("ul"), ...d.falta.map((x) => el("li", null, x))) : el("p", null, "Nada: o quadro existente já chega ao ideal."));
  };
  const lado = com(el("div", "quadros-lado"),
    com(el("div"), el("h4", null, "Quadro existente"), cxExistente),
    com(el("div"), el("h4", null, "Quadro ideal"), ideal ? desenho(ideal, "quadro ideal") : el("p", "pequeno suave", "Sem dados da casa."), ideal ? el("p", "pequeno suave", ideal.resumo) : null));
  // Obra com proposta aceite (decisão do dono, 2026-10-11): o eletricista vê só o que o cliente comprou — sem o quadro
  // ideal da simulação nem "o que falta" (o servidor já não manda a casa). Fica o registo do quadro que lá está.
  const corpo = t.de_proposta
    ? [el("p", "pequeno suave", "Registe aqui o quadro que lá está. O trabalho é o da proposta que o cliente aceitou."), com(el("div"), el("h4", null, "Quadro existente"), cxExistente)]
    : [el("p", "pequeno suave", "O quadro ideal é calculado pelo que o cliente descreveu da casa. O trabalho é adaptar o quadro que lá está ao ideal."), lado, cxFalta];

  if (q.pode_desenhar && !cabeNoRegisto) corpo.push(el("p", "pequeno suave", "Este quadro foi desenhado ao pormenor no painel. Para o mudar, fale com a Domus."));
  if (q.pode_desenhar && cabeNoRegisto) {
    const numero = (id, valor, max) => { const i = el("input"); i.type = "number"; i.min = "0"; i.max = String(max); i.step = "1"; i.inputMode = "numeric"; i.id = id; i.value = String(valor); return i; };
    const campo = (rotulo, input) => com(el("label", "campo"), el("span", null, rotulo), input);
    const geral = el("select");
    geral.id = "quadro-geral";
    geral.append(new Option("Não tem ou não se vê", ""), ...AMPERES_GERAL.map((a) => new Option(`${a} A`, String(a), false, l.disjuntor_geral?.amperes === a)));
    const n30 = numero("quadro-dif-30", l.diferenciais.filter((d) => d.sensibilidade_ma === 30).length, 10);
    const n300 = numero("quadro-dif-300", l.diferenciais.filter((d) => d.sensibilidade_ma === 300).length, 10);
    const porA = AMPERES_DISJUNTOR.map((a) => [a, numero(`quadro-disj-${a}`, l.disjuntores.filter((d) => d.amperes === a).length, 30)]);
    const livres = numero("quadro-livres", l.modulos_livres ?? "", 60);   // vazio = por saber (não é o mesmo que 0)
    const caixa = (id, marcada) => { const i = el("input"); i.type = "checkbox"; i.id = id; i.checked = marcada; return i; };
    const fus = caixa("quadro-fusiveis", l.fusiveis === true);
    const wifi = caixa("quadro-geral-wifi", l.disjuntor_geral?.wifi === true);
    const prot = Object.entries(PROTECOES_ESQUEMA).map(([k, p]) => [k, p.nome, caixa(`quadro-prot-${k}`, l.protecoes.includes(k))]);
    const nAfdd = numero("quadro-afdd", l.disjuntores.filter((d) => d.afdd).length, 30);
    const int = (i, max) => Math.max(0, Math.min(max, Math.round(Number(i.value)) || 0));
    const ler = () => {
      let afdd = int(nAfdd, 30);
      // Os diferenciais guardam os amperes que já tinham (o registo só conta por sensibilidade; os novos ficam a 40 A).
      const difs = (ma, n) => { const antes = l0.diferenciais.filter((d) => d.sensibilidade_ma === ma); return Array.from({ length: n }, (_, k) => ({ sensibilidade_ma: ma, amperes: antes[k]?.amperes ?? 40 })); };
      const novo = {
        disjuntor_geral: geral.value ? { amperes: Number(geral.value), wifi: wifi.checked } : null,
        diferenciais: [...difs(30, int(n30, 10)), ...difs(300, int(n300, 10))],
        disjuntores: porA.flatMap(([a, i]) => Array.from({ length: int(i, 30) }, () => ({ amperes: a }))).map((d) => (afdd-- > 0 ? { ...d, afdd: true } : d)),
        protecoes: prot.filter(([, , i]) => i.checked).map(([k]) => k),
        modulos_livres: livres.value.trim() === "" ? null : int(livres, 60), fusiveis: fus.checked,
        // O que o registo não pergunta fica como estava: estado, sinais de aquecimento e notas.
        estado: l0.estado, sinais_aquecimento: l0.sinais_aquecimento, notas: l0.notas,
      };
      // A ordem na calha só se mantém se as peças são as mesmas (senão os lugares já não dizem respeito às mesmas).
      const iguais = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      if (iguais(novo.disjuntores, l0.disjuntores) && iguais(novo.diferenciais, l0.diferenciais)) novo.ordem = l0.ordem;
      return normalizarEsquema(novo);
    };
    const msg = el("p", "erro");
    msg.hidden = true;
    msg.setAttribute("role", "alert");
    const guardar = el("button", "btn cheio", "Guardar quadro existente");
    guardar.type = "button";
    guardar.id = "quadro-guardar";
    const form = com(el("div", "quadro-registo"),
      el("p", "rotulo", "Registar o quadro existente"),
      campo("Disjuntor geral", geral),
      com(el("div", "quadro-contagens"), campo("Diferenciais de 30 mA", n30), campo("Diferenciais de 300 mA", n300)),
      el("p", "rotulo", "Disjuntores, por amperes"),
      com(el("div", "quadro-contagens"), ...porA.map(([a, i]) => campo(`${a} A`, i))),
      com(el("div", "quadro-contagens"), campo("Com AFDD", nAfdd), campo("Módulos livres", livres)),
      el("p", "rotulo", "Proteções que já tem"),
      com(el("label", "caixa"), wifi, el("span", null, "Disjuntor geral Wi-Fi")),
      ...prot.map(([, nome, i]) => com(el("label", "caixa"), i, el("span", null, nome))),
      com(el("label", "caixa"), fus, el("span", null, "Tem fusíveis (de rosca ou cartucho)")),
      msg, com(el("div", "fila"), guardar));
    form.addEventListener("input", () => { l = ler(); desenhar(); });
    form.addEventListener("change", () => { l = ler(); desenhar(); });
    guardar.addEventListener("click", () => acaoFicha(t, "esquema-quadro", { esquema: ler() }, { botao: guardar, msg, texto: "Quadro existente guardado." }));
    corpo.push(form);
  }
  desenhar();
  return seccao("Quadro elétrico", null, ...corpo.filter(Boolean));
}

/**
 * Proposta depois da visita (decisão do dono, 2026-10-04): as horas de trabalho e o material do catálogo da Domus, com
 * quantidades. Sem valores em euros: a Domus Energia calcula o preço, revê e envia a proposta ao cliente.
 */
let catalogoProposta = null;
// Os nomes das categorias do catálogo, como no painel (painel/public/ecras/catalogo.js CATEGORIAS): os grupos do seletor
// de artigos apareciam com a chave crua ("acessorio", "disjuntor", "outro").
const CATEGORIAS = {
  disjuntor: "Disjuntor", interruptor: "Interruptor", sensor: "Sensor", estore: "Estore", tomada: "Tomada", luz: "Luz",
  termostato: "Termóstato", central: "Central", acessorio: "Acessório", outro: "Outro",
};
const nomeCategoria = (k) => CATEGORIAS[k] ?? (k ? `${String(k)[0].toUpperCase()}${String(k).slice(1)}` : "Outro");
function seccaoProposta(t) {
  const p = t.proposta;
  const corpo = [];
  if (p) {
    corpo.push(com(el("p"), el("b", null, `Enviada em ${dataCurta(p.quando)}: ${decimal(p.horas)} h de trabalho`), p.material.length ? ` e ${p.material.length} ${p.material.length === 1 ? "artigo" : "artigos"}.` : "."),
      p.material.length ? com(el("ul", "pequeno"), ...p.material.map((m) => el("li", null, `${m.qtd} × ${m.nome}`))) : null,
      p.notas ? el("p", "pequeno suave", `«${p.notas}»`) : null,
      // Só enquanto o trabalho está na bolsa: depois de escolhida e aceite, a frase já não é verdade.
      t.estado === "na_bolsa" ? el("p", "pequeno suave", "A Domus Energia calcula o preço e envia a proposta ao cliente.") : null);
  }
  if (!t.pode_proposta) return seccao("Proposta para o cliente", p ? selo("Enviada") : null, ...corpo.filter(Boolean));
  const msg = el("p", "erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const f = camposProposta(p, msg);
  const enviar = el("button", "btn cheio", p ? "Enviar outra vez" : "Enviar proposta à Domus");
  enviar.type = "button";
  enviar.id = "proposta-enviar";
  enviar.addEventListener("click", () => {
    msg.hidden = true;
    const v = f.ler();
    if (v) acaoFicha(t, "proposta", v, { botao: enviar, msg, texto: "Proposta enviada à Domus Energia." });
  });
  corpo.push(el("p", "pequeno suave", "Depois de ver a casa, diga o que a obra precisa. Não escreva preços: a Domus Energia calcula-os e envia a proposta ao cliente."),
    f.horas, ...f.material, f.notas, msg, com(el("div", "fila"), enviar));
  return seccao("Proposta para o cliente", p ? selo("Enviada") : null, ...corpo.filter(Boolean));
}
/**
 * Os campos de uma proposta (horas, artigos do catálogo com quantidade e notas), preenchidos com `p` se já houver uma:
 * os mesmos na proposta depois da visita e na proposta da bolsa. `ler()` valida e devolve {horas, material, notas}, ou
 * null com o erro escrito em `msg`.
 */
function camposProposta(p, msg) {
  const horas = el("input");
  horas.type = "number"; horas.min = "0.5"; horas.max = "500"; horas.step = "0.5"; horas.inputMode = "decimal"; horas.id = "proposta-horas";
  horas.value = p ? String(p.horas) : "";
  const linhas = el("div", "pilha");
  linhas.id = "proposta-material";
  const notas = el("textarea");
  notas.rows = 3; notas.maxLength = 1000; notas.id = "proposta-notas";
  notas.value = p?.notas ?? "";
  const novaLinha = (sku = "", qtd = 1) => {
    const f = el("div", "proposta-linha");
    const s = el("select");
    s.setAttribute("aria-label", "Artigo");
    s.append(new Option("Escolha o artigo…", ""));
    let grupo = null, cat = null;
    for (const a of catalogoProposta ?? []) {
      if (a.categoria !== cat) { cat = a.categoria; grupo = document.createElement("optgroup"); grupo.label = nomeCategoria(cat); s.append(grupo); }
      grupo.append(new Option(a.nome, a.sku, false, a.sku === sku));
    }
    const q = el("input");
    q.type = "number"; q.min = "1"; q.max = "999"; q.step = "1"; q.inputMode = "numeric"; q.value = String(qtd);
    q.setAttribute("aria-label", "Quantidade");
    const x = el("button", "btn sec mini", "Tirar");
    x.type = "button";
    x.addEventListener("click", () => f.remove());
    // O nome inteiro do artigo por baixo: na lista do telemóvel fica cortado ("Tomada inteligente Wi-Fi com me…").
    const nome = el("span", "proposta-nome pequeno suave");
    const dizer = () => { nome.textContent = s.value ? s.selectedOptions[0]?.textContent ?? "" : ""; nome.hidden = !s.value; };
    s.addEventListener("change", dizer);
    dizer();
    f.append(s, q, x, nome);
    linhas.append(f);
    return s;
  };
  const mais = el("button", "btn sec mini", "+ Artigo");
  mais.type = "button";
  mais.id = "proposta-mais";
  mais.addEventListener("click", () => novaLinha().focus());
  const ler = () => {
    const h0 = Number(String(horas.value).replace(",", "."));
    if (!(h0 >= 0.5)) { msg.textContent = "Indique as horas de trabalho (pelo menos meia hora)."; msg.hidden = false; horas.focus(); return null; }
    const material = [];
    for (const f of linhas.querySelectorAll(".proposta-linha")) {
      const sku = f.querySelector("select").value, qtd = Math.round(Number(f.querySelector("input").value));
      if (!sku) continue;
      if (!(qtd >= 1 && qtd <= 999)) { msg.textContent = "Cada artigo precisa de uma quantidade entre 1 e 999."; msg.hidden = false; f.querySelector("input").focus(); return null; }
      material.push({ sku, qtd });
    }
    return { horas: h0, material, notas: notas.value.trim() || null };
  };
  const carregar = async () => {
    if (!catalogoProposta) {
      try { catalogoProposta = (await pedir("catalogo")).artigos ?? []; } catch (e) { msg.textContent = e.message; msg.hidden = false; return; }
    }
    linhas.replaceChildren();
    for (const m of p?.material ?? []) novaLinha(m.sku, m.qtd);
  };
  carregar();
  const campo = (rotulo, input) => com(el("label", "campo"), el("span", null, rotulo), input);
  return { campo, ler, horas: campo("Horas de trabalho", horas), material: [el("p", "rotulo", "Material (do catálogo da Domus)"), linhas, com(el("div"), mais)],
    notas: campo("Notas para a Domus (opcional)", notas) };
}

function seccaoVisita(t) {
  const marcada = Boolean(t.visita);
  const corpo = [];
  // Avaria (decisão do dono, 2026-10-13): o servidor recusa uma data fora do horário normal quando o cliente o pediu (ou já recebeu a diferença de volta).
  if (t.so_horario_normal && t.editavel) corpo.push(el("p", "nota calma", "Horário normal: marque num dia útil entre as 8h e as 20h."));
  if (Number(t.fora_horas) > 0 && t.editavel) corpo.push(el("p", "nota calma", "O cliente pagou o preço de fora de horas. Se marcar num dia útil entre as 8h e as 20h, devolvemos-lhe a diferença e o trabalho passa ao valor normal."));
  if (!marcada) {
    if (t.prazo) corpo.push(contagem(t.prazo, "para marcar a visita. Depois disso, o trabalho deixa de ser seu."));
    corpo.push(el("p", "pequeno suave", "Combine o dia com o cliente por telefone e registe aqui. O cliente recebe a confirmação por email, em nome da Domus Energia."), ...formVisita(t));
  } else {
    corpo.push(com(el("p"), el("b", null, visitaTxt(t.visita))), el("p", "pequeno suave", new Date(t.visita) > new Date() ? "O cliente recebeu a confirmação em nome da Domus Energia." : "Data da visita registada."));
    if (t.editavel) {
      const alterar = el("button", "btn sec mini", "Alterar data");
      alterar.type = "button";
      alterar.id = "alterar-visita";
      const zona = el("div", "pilha");
      zona.hidden = true;
      zona.append(...formVisita(t));
      alterar.addEventListener("click", () => { zona.hidden = false; alterar.hidden = true; zona.querySelector("input")?.focus(); });
      corpo.push(com(el("div"), alterar), zona);
    }
  }
  return seccao("Visita", marcada ? selo(visitaTxt(t.visita).slice(0, 5), "bom") : selo("Por marcar", "aviso"), ...corpo);
}

/**
 * Ida perdida (decisão do dono, 2026-10-11): foi à hora marcada e não pôde entrar por motivo do cliente. Assinala-o aqui
 * ("O cliente não estava", em dois toques, com uma nota opcional), só depois da hora da visita; a Domus Energia confirma
 * ou anula. Se confirmar, recebe a deslocação dessa ida a mais e marca nova visita. Só numa obra.
 */
const ESTADO_IDA = { proposta: ["À espera da Domus Energia", "aviso"], confirmada: ["Ida perdida confirmada", "bom"], anulada: ["Ida perdida anulada", ""] };
function parteIdaPerdida(t) {
  if (t.tipo !== "obra") return [];
  const out = [];
  for (const x of t.idas_perdidas ?? []) {
    const [txt, tipo] = ESTADO_IDA[x.estado] ?? [x.estado, ""];
    const c = com(el("div", "cartao pilha"), com(el("div", "selos"), selo(txt, tipo)),
      el("p", null, `Visita de ${visitaTxt(x.visita)}: o cliente não estava.`),
      x.nota ? el("p", "pequeno suave", `«${x.nota}»`) : null,
      x.estado === "proposta" ? el("p", "pequeno suave", "A Domus Energia vai confirmar. Até lá, a obra não se dá por concluída.") : null,
      x.estado === "confirmada" ? com(el("p", "pequeno"), "Por esta ida recebe mais ", el("b", "num", euro(x.recebe)), t.visita ? " · a deslocação, sem IVA." : " · a deslocação, sem IVA. Combine nova data com o cliente e marque a visita.") : null,
      x.estado === "anulada" ? el("p", "pequeno suave", x.motivo ? `Anulada: «${x.motivo}»` : "Anulada.") : null);
    c.id = `ida-${x.id}`;
    out.push(c);
  }
  if (t.pode_ida_perdida) {
    const nota = el("textarea");
    nota.rows = 2; nota.maxLength = 300; nota.id = "ida-nota";
    const msg = el("p", "msg erro");
    msg.hidden = true;
    msg.setAttribute("role", "alert");
    const b = el("button", "btn sec", "O cliente não estava");
    b.type = "button";
    b.id = "ida-perdida";
    confirmarEmDoisToques(b, "Confirmar: o cliente não estava?", () => acaoFicha(t, "ida-perdida", { nota: nota.value.trim() }, { botao: b, msg, texto: "Registado. A Domus Energia vai confirmar." }));
    out.push(el("p", "pequeno suave", "Foi à hora marcada e não pôde entrar? Diga-o aqui. Se a Domus Energia confirmar, recebe a deslocação desta ida e marca nova visita."),
      com(el("label", "campo"), el("span", null, "O que aconteceu (opcional)"), nota), msg, com(el("div"), b));
  }
  return out;
}
/** A ida perdida no passo "Trabalho" (decisão do dono, 2026-10-13): fechada enquanto não houver nenhuma assinalada. */
function seccaoIdaPerdida(t) {
  const corpo = parteIdaPerdida(t);
  if (!corpo.length) return null;
  const s = seccao("O cliente não estava?", pendenteIda(t) ? selo("À espera", "aviso") : null, ...corpo);
  s.open = (t.idas_perdidas ?? []).length > 0;
  return s;
}

function formVisita(t) {
  const amanha = new Date(Date.now() + 86400000);
  const atual = t.visita ?? "";
  const dia = el("input");
  dia.type = "date";
  dia.id = "visita-data";
  dia.value = atual ? atual.slice(0, 10) : `${amanha.getFullYear()}-${p2(amanha.getMonth() + 1)}-${p2(amanha.getDate())}`;
  const hora = el("input");
  hora.type = "time";
  hora.id = "visita-hora";
  hora.value = atual ? atual.slice(11, 16) : "09:30";
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const b = el("button", "btn cheio", atual ? "Guardar nova data" : "Marcar visita");
  b.type = "button";
  b.id = "marcar-visita";
  b.addEventListener("click", () => {
    msg.hidden = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.value) || !/^\d{2}:\d{2}$/.test(hora.value)) { msg.textContent = "Escolha o dia e a hora."; msg.hidden = false; return; }
    // Uma data já passada (quem foi mais cedo regista a data verdadeira) não manda email ao cliente.
    const passada = new Date(`${dia.value}T${hora.value}`).getTime() <= Date.now();
    acaoFicha(t, "visita", { data_visita: `${dia.value}T${hora.value}` }, { botao: b, msg, texto: passada ? "Data da visita guardada." : "Visita marcada. O cliente foi avisado em nome da Domus Energia." });
  });
  const campo = (rotulo, input) => com(el("label", "campo"), el("span", null, rotulo), input);
  return [com(el("div", "grelha-2"), campo("Dia", dia), campo("Hora", hora)), msg, b];
}

// ---- Trabalho: relatório técnico e lista do material (levantado / recebido)
function parteTrabalho(t) {
  const mat = t.material ?? [];
  const nRec = mat.filter((m) => m.recebido).length;
  const guardar = (nomes, botao) => acaoFicha(t, "material", { recebido: nomes }, { botao });
  const lista = el("ul", "lista-mat marcar");
  lista.id = "lista-material";
  mat.forEach((m, i) => {
    const c = el("input");
    c.type = "checkbox";
    c.id = `mat-${i}`;
    c.checked = m.recebido;
    c.disabled = !t.editavel;
    c.addEventListener("change", () => guardar([...lista.querySelectorAll("input:checked")].map((x) => mat[Number(x.id.slice(4))].nome), null));
    const l = com(el("label"), c, el("span", null, m.nome), el("span", "qt", `${decimal(m.quantidade)} un.`));
    l.htmlFor = c.id;
    lista.append(com(el("li"), l));
  });
  const acoes = el("div", "fila");
  const conta = el("span", "pequeno", `${nRec} de ${mat.length} recebido`);
  conta.id = "mat-conta";
  acoes.append(conta);
  if (t.editavel && mat.length) {
    const tudo = el("button", "btn sec mini", "Marcar tudo");
    tudo.type = "button";
    tudo.id = "mat-tudo";
    tudo.disabled = nRec === mat.length;
    tudo.addEventListener("click", () => guardar(mat.map((m) => m.nome), tudo));
    const nada = el("button", "btn sec mini", "Desmarcar");
    nada.type = "button";
    nada.id = "mat-nada";
    nada.disabled = !nRec;
    nada.addEventListener("click", () => guardar([], nada));
    acoes.append(tudo, nada);
  }
  // Pela ordem em que se usa na obra: (na avaria, o diagnóstico) o que há a fazer, o material, as listas de verificação,
  // o quadro e os aparelhos; no fim, fechados até serem precisos, o trabalho a mais e "o cliente não estava".
  return [
    t.diagnostico ? seccaoDiagnostico(t) : null,
    blocoRelatorio(t.relatorio, "Lista de trabalho e planta"),
    seccao("Material a levantar", selo(`${nRec}/${mat.length}`, mat.length && nRec === mat.length ? "bom" : ""),
      el("p", "nota calma", "Material fornecido pela Domus Energia: combinamos consigo onde o levanta ou se segue para a obra. Marque o que já levantou ou recebeu."),
      mat.length ? acoes : null, mat.length ? lista : el("p", "suave", "Sem lista de material.")),
    seccaoChecklists(t),
    seccaoQuadro(t),
    seccaoAparelhos(t),
    seccaoExtras(t),
    seccaoIdaPerdida(t),
  ].filter(Boolean);
}

/**
 * Trabalho a mais (decisão do dono, 2026-10-11): o preço que o cliente aceitou é definitivo. Se no local aparecer o que
 * não se via na planta nem nas fotos, o eletricista diz aqui o que é, as horas e o material (sem preços: a Domus
 * Energia põe o preço e pergunta ao cliente). Só com o cliente a aceitar é que esse trabalho se faz. Só numa obra.
 */
const ESTADO_EXTRA = {
  proposto: ["À espera da Domus Energia", "aviso"], enviado: ["À espera do cliente", "aviso"],
  aceite: ["Aceite pelo cliente: pode fazer este trabalho", "bom"], recusado: ["O cliente não aceitou: não faça este trabalho", "mau"], retirado: ["Retirado", ""],
};
function seccaoExtras(t) {
  if (t.tipo !== "obra") return null;
  const extras = t.extras ?? [];
  const corpo = [el("p", "nota calma", "Não avance com trabalho a mais sem o cliente aceitar.")];
  for (const x of extras) {
    const [txt, tipo] = ESTADO_EXTRA[x.estado] ?? [x.estado, ""];
    const c = com(el("div", "cartao pilha"), com(el("div", "selos"), selo(txt, tipo)),
      el("p", null, x.descricao),
      el("p", "pequeno", `${decimal(x.horas)} h de trabalho${x.material.length ? ` e ${x.material.length} ${x.material.length === 1 ? "artigo" : "artigos"}` : ""}.`),
      x.material.length ? com(el("ul", "pequeno"), ...x.material.map((m) => el("li", null, `${m.qtd} × ${m.nome}`))) : null,
      x.estado === "retirado" && x.nota ? el("p", "pequeno suave", `A Domus Energia não avançou: «${x.nota}»`) : null,
      x.recebe ? com(el("p", "pequeno"), "Por este trabalho recebe mais ", el("b", "num", euro(x.recebe.total)), ` · ${decimal(x.recebe.percentagem)} % da mão de obra, sem IVA`) : null);
    c.id = `extra-${x.id}`;
    if (x.pode_retirar) {
      const retirar = el("button", "btn sec mini", "Retirar");
      retirar.type = "button";
      confirmarEmDoisToques(retirar, "Confirmar: retirar?", () => acaoFicha(t, `extra/${x.id}/retirar`, {}, { botao: retirar, texto: "Trabalho a mais retirado." }));
      c.append(com(el("div", "fila"), retirar));
    }
    corpo.push(c);
  }
  const pendente = extras.some((x) => x.estado === "proposto" || x.estado === "enviado");
  if (t.pode_extra) {
    const abrir = el("button", "btn sec", "Propor trabalho a mais");
    abrir.type = "button";
    abrir.id = "extra-abrir";
    const zona = el("div", "pilha");
    zona.hidden = true;
    abrir.addEventListener("click", () => {
      abrir.hidden = true;
      zona.hidden = false;
      const msg = el("p", "erro");
      msg.hidden = true;
      msg.setAttribute("role", "alert");
      // Os mesmos campos da proposta (horas e material do catálogo); em vez das notas, o que encontrou.
      const f = camposProposta(null, msg);
      const descricao = el("textarea");
      descricao.rows = 4; descricao.maxLength = 600; descricao.id = "extra-descricao";
      const enviar = el("button", "btn cheio", "Enviar à Domus Energia");
      enviar.type = "button";
      enviar.id = "extra-enviar";
      enviar.addEventListener("click", () => {
        msg.hidden = true;
        const d = descricao.value.trim();
        if (d.length < 5) { msg.textContent = "Diga o que encontrou e o que é preciso fazer."; msg.hidden = false; descricao.focus(); return; }
        const v = f.ler();
        if (v) acaoFicha(t, "extra", { descricao: d, horas: v.horas, material: v.material }, { botao: enviar, msg, texto: "Trabalho a mais enviado à Domus Energia." });
      });
      zona.replaceChildren(el("p", "pequeno suave", "Diga o que é, as horas e o material. Não escreva preços nem fale de preços com o cliente: a Domus Energia põe o preço e pergunta ao cliente."),
        f.campo("O que encontrou e o que é preciso fazer", descricao), f.horas, ...f.material, msg, com(el("div", "fila"), enviar));
      descricao.focus();
    });
    corpo.push(com(el("div"), abrir), zona);
  } else if (pendente) corpo.push(el("p", "pequeno suave", "Só pode propor outro depois de este ter resposta. Até lá, a obra não se dá por concluída."));
  const s = seccao("Encontrou trabalho a mais?", pendente ? selo("À espera", "aviso") : null, ...corpo.filter(Boolean));
  s.open = extras.length > 0;   // fechada até haver algum: o passo "Trabalho" fica mais curto
  return s;
}

// ---- Procedimentos da obra: as checklists (cada passo é uma caixa; fica quem marcou e quando) e "Começar checklist"
const quandoTxt = (isoTxt) => { const d = new Date(isoTxt); return Number.isNaN(d.getTime()) ? "" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} às ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const selosPasso = (x) => [x.seguranca ? selo("Segurança", "mau") : null, x.obrigatorio ? selo("Obrigatório", "aviso") : null];
const faltaTxt = (n) => `${n} ${n === 1 ? "obrigatório" : "obrigatórios"} em falta`;
function seccaoChecklists(t) {
  const c = t.checklists;
  if (!c) return null;   // só as obras têm checklists
  const corpo = [];
  let feitos = 0, total = 0;
  for (const l of c.checklists) {
    feitos += l.feitos; total += l.total;
    const ul = el("ul", "lista-passos");
    ul.id = `checklist-${l.id}`;
    l.passos.forEach((x, i) => {
      const caixa = el("input");
      caixa.type = "checkbox";
      caixa.id = `passo-${l.id}-${i}`;
      caixa.checked = x.feito;
      caixa.disabled = !t.editavel;
      caixa.addEventListener("change", async () => {
        const ok = await acaoFicha(t, `checklists/${l.id}`, { passo: i, feito: caixa.checked });
        if (ok) $(caixa.id)?.focus(); else caixa.checked = !caixa.checked;
      });
      const rotulo = com(el("label"), caixa, com(el("span"), el("span", "passo-texto", x.texto), " ", selosPasso(x)));
      rotulo.htmlFor = caixa.id;
      ul.append(com(el("li"), rotulo, x.nota ? el("p", "pequeno suave passo-nota", x.nota) : null,
        x.feito ? el("p", "pequeno suave passo-nota", `Feito${x.por ? ` por ${x.por}` : ""}${x.quando ? `, ${quandoTxt(x.quando)}` : ""}`) : null));
    });
    corpo.push(com(el("div", "pilha"), el("h4", null, `${l.titulo} (versão ${l.versao})`),
      com(el("div", "selos"), selo(`${l.feitos}/${l.total}`, l.feitos === l.total ? "bom" : ""), l.obrigatorios_falta ? selo(faltaTxt(l.obrigatorios_falta), "mau") : null), ul));
  }
  if (!c.checklists.length) corpo.push(el("p", "suave", "Esta obra ainda não tem listas de verificação."));
  if (t.editavel && c.disponiveis.length) {
    const escolha = el("select");
    escolha.id = "checklist-procedimento";
    escolha.setAttribute("aria-label", "Procedimento");
    for (const p of c.disponiveis) { const o = el("option", null, `${p.titulo} (${p.n_passos} passos)`); o.value = String(p.id); escolha.append(o); }
    const b = el("button", "btn sec cheio", "Começar lista");
    b.type = "button";
    b.id = "comecar-checklist";
    b.addEventListener("click", () => acaoFicha(t, "checklists", { procedimento_id: Number(escolha.value) }, { botao: b, texto: "Lista de verificação começada." }));
    corpo.push(com(el("label", "campo"), el("span", null, "Começar a lista de verificação de um procedimento"), escolha), com(el("div", "fila"), b));
  }
  return seccao("Procedimentos da obra", total ? selo(`${feitos}/${total}`, feitos === total ? "bom" : "") : null,
    el("p", "nota calma", "Siga os passos pela ordem e marque cada um quando o fizer. Os de segurança fazem-se sempre antes de tocar na instalação."), ...corpo);
}

// ---- Ensaios medidos (fora do limite: assinalado, com nota obrigatória) e diagnóstico da avaria
const ENSAIOS = [
  { k: "continuidade_pe", nome: "Continuidade do PE", un: "Ω", dica: () => "Valor medido, da tomada ao quadro.", fora: () => false },
  { k: "isolamento", nome: "Resistência de isolamento", un: "MΩ", dica: (l) => `Mínimo ${decimal(l.isolamento_min)} MΩ (500 V c.c.).`, fora: (n, l) => n < l.isolamento_min },
  { k: "terra", nome: "Resistência de terra", un: "Ω", dica: (l) => `Até ${decimal(l.terra_max)} Ω.`, fora: (n, l) => n > l.terra_max },
  { k: "diferencial", nome: "Disparo do diferencial", un: "ms", dica: (l) => `Tempo medido a IΔn: até ${decimal(l.diferencial_max)} ms.`, fora: (n, l) => n > l.diferencial_max },
];
const numeroDe = (txt) => { const s = String(txt).trim().replace(",", "."); return s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : NaN; };
function parteEnsaios(t) {
  const e = t.ensaios ?? {};
  const lim = e.limites ?? { isolamento_min: 0.5, diferencial_max: 300, terra_max: 100 };
  const campos = {};
  const linhas = ENSAIOS.map((x) => {
    const i = el("input");
    i.type = "text";
    i.inputMode = "decimal";
    i.id = `ens-${x.k}`;
    i.autocomplete = "off";
    i.value = e[x.k] === null || e[x.k] === undefined ? "" : decimal(e[x.k]);
    i.disabled = !t.editavel;
    const dica = el("span", "dica", x.dica(lim));
    const c = com(el("label", "campo"), el("span", null, x.nome), com(el("div", "com-un"), i, el("span", null, x.un)), dica);
    const avaliar = () => {
      const n = numeroDe(i.value);
      const mau = Number.isNaN(n) || (n !== null && n < 0);
      const fora = !mau && n !== null && x.fora(n, lim);
      c.classList.toggle("erro", mau || fora);
      dica.textContent = mau ? "Escreva um número." : fora ? `Fora do limite. ${x.dica(lim)} Escreva uma nota a explicar.` : x.dica(lim);
      return { n, mau, fora };
    };
    i.addEventListener("input", avaliar);
    avaliar();
    campos[x.k] = { i, avaliar };
    return c;
  });
  const notas = el("textarea");
  notas.id = "ens-notas";
  notas.maxLength = 1000;
  notas.rows = 3;
  notas.value = e.notas ?? "";
  notas.disabled = !t.editavel;
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const guardar = el("button", "btn cheio", "Guardar ensaios");
  guardar.type = "button";
  guardar.id = "guardar-ensaios";
  guardar.addEventListener("click", () => {
    const corpo = { notas: notas.value.trim() || null };
    let fora = false;
    for (const x of ENSAIOS) {
      const r = campos[x.k].avaliar();
      if (r.mau) { msg.textContent = `${x.nome}: escreva um número igual ou maior que 0 (ou deixe em branco).`; msg.hidden = false; campos[x.k].i.focus(); return; }
      corpo[x.k] = r.n;
      fora = fora || r.fora;
    }
    if (fora && !corpo.notas) { msg.textContent = "Há valores fora do limite: escreva uma nota a explicar."; msg.hidden = false; notas.focus(); return; }
    acaoFicha(t, "ensaios", corpo, { botao: guardar, msg, texto: "Ensaios guardados." });
  });
  const nFeitos = ["isolamento", "diferencial", "terra"].filter((k) => e[k] !== null && e[k] !== undefined).length;
  return [seccao("Ensaios", (e.fora ?? []).length ? selo("Fora do limite", "mau") : selo(`${nFeitos}/3`, nFeitos === 3 ? "bom" : "aviso"),
    ...linhas, com(el("label", "campo"), el("span", null, (e.fora ?? []).length ? "Nota (obrigatória: há valores fora do limite)" : "Nota (opcional)"), notas),
    msg, t.editavel ? guardar : null, e.data ? el("p", "pequeno suave", `Guardados em ${dataCurta(e.data)}.`) : null)];
}

function seccaoDiagnostico(t) {
  const m = t.diagnostico.modelo, a = t.diagnostico.atual ?? { verificacoes: [], valores: {}, tipo: null, conclusao: null };
  const itens = m.checklist.map((c) => {
    const caixa = el("input");
    caixa.type = "checkbox";
    caixa.id = `diag-${c.chave}`;
    caixa.checked = a.verificacoes.includes(c.chave);
    caixa.disabled = !t.editavel;
    const linha = com(el("label", "caixa"), caixa, el("span", null, c.nome));
    linha.htmlFor = caixa.id;
    let valor = null;
    if (c.unidade) {
      valor = el("input");
      valor.type = "text";
      valor.inputMode = "decimal";
      valor.id = `diag-valor-${c.chave}`;
      valor.setAttribute("aria-label", `${c.nome}: valor medido (${c.unidade})`);
      valor.value = a.valores?.[c.chave] === undefined ? "" : decimal(a.valores[c.chave]);
      valor.disabled = !t.editavel;
    }
    return { c, caixa, valor, no: com(el("li"), linha, valor ? com(el("div", "com-un"), valor, el("span", null, c.unidade)) : null, c.referencia ? el("span", "dica", c.referencia) : null) };
  });
  const tipo = el("select");
  tipo.id = "diag-tipo";
  tipo.disabled = !t.editavel;
  for (const [k, nome] of [["", "Por determinar"], ...Object.entries(m.tipos)]) {
    const o = el("option", null, nome);
    o.value = k;
    o.selected = (a.tipo ?? "") === k;
    tipo.append(o);
  }
  const conclusao = el("textarea");
  conclusao.id = "diag-conclusao";
  conclusao.rows = 4;
  conclusao.maxLength = m.max_conclusao;
  conclusao.value = a.conclusao ?? "";
  conclusao.disabled = !t.editavel;
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const guardar = el("button", "btn cheio", "Guardar diagnóstico");
  guardar.type = "button";
  guardar.id = "guardar-diagnostico";
  guardar.addEventListener("click", () => {
    const valores = {};
    for (const x of itens) {
      if (!x.valor) continue;
      const n = numeroDe(x.valor.value);
      if (Number.isNaN(n) || (n !== null && n < 0)) { msg.textContent = `${x.c.nome}: escreva um número.`; msg.hidden = false; x.valor.focus(); return; }
      if (n !== null) valores[x.c.chave] = n;
    }
    acaoFicha(t, "diagnostico", { diagnostico: { verificacoes: itens.filter((x) => x.caixa.checked).map((x) => x.c.chave), valores, tipo: tipo.value || null, conclusao: conclusao.value.trim() || null } },
      { botao: guardar, msg, texto: "Diagnóstico guardado." });
  });
  return seccao("Diagnóstico da avaria", a.conclusao ? selo("Feito", "bom") : selo("Por fazer", "aviso"),
    el("p", "pequeno suave", "O que verificou, o que mediu e a causa encontrada. Fica no relatório do cliente."),
    com(el("ul", "lista-diag"), itens.map((x) => x.no)),
    com(el("label", "campo"), el("span", null, "Tipo de avaria"), tipo),
    com(el("label", "campo"), el("span", null, "Causa encontrada e o que fez"), conclusao),
    msg, t.editavel ? guardar : null);
}

// ---- Fotos antes e depois (quadro e pontos): reduzidas no telemóvel (até 1 MB) antes de enviar. Cada passo da ficha
// mostra só os seus grupos: `fim` é "_antes" (passo 2) ou "_depois" (passo 5); os grupos são os do servidor.
function parteFotos(t, fim) {
  const fotos = t.fotos ?? [];
  const max = t.fotos_max ?? 4;
  const grelha = el("div", "fotos-grelha");
  grelha.id = "fotos-obra";
  const obrigatoria = !fotos.some((f) => f.grupo.endsWith(fim));
  for (const g of (t.grupos_fotos ?? []).filter((x) => x.grupo.endsWith(fim))) {
    const doGrupo = fotos.filter((f) => f.grupo === g.grupo);
    const [onde, quando] = g.nome.split(" — ");
    const peca = el("div", "foto-peca");
    peca.id = `peca-${g.grupo}`;
    peca.append(com(el("p"), el("b", null, onde), " ", el("span", "suave", quando)));
    if (!doGrupo.length) peca.append(com(el("div", "mini-foto vazia"), obrigatoria ? selo("Falta uma foto", "aviso") : el("span", "pequeno suave", "Sem fotos")));
    for (const f of doGrupo) {
      const img = el("img");
      img.src = urlServidor(f.url);
      img.alt = `${g.nome}`;
      img.loading = "lazy";
      if (base) img.crossOrigin = "use-credentials";
      const fig = com(el("figure", "mini-foto"), img);
      if (t.editavel) {
        const ap = el("button", "btn sec mini", "Apagar");
        ap.type = "button";
        ap.setAttribute("aria-label", `Apagar foto: ${g.nome}`);
        ap.addEventListener("click", () => acaoFicha(t, `fotos/${f.id}/apagar`, {}, { botao: ap, texto: "Foto apagada." }));
        fig.append(ap);
      }
      peca.append(fig);
    }
    if (t.editavel) {
      const ficheiro = el("input");
      ficheiro.type = "file";
      ficheiro.accept = "image/*";
      ficheiro.setAttribute("capture", "environment");
      ficheiro.hidden = true;
      ficheiro.id = `ficheiro-${g.grupo}`;
      const b = el("button", "btn sec cheio", "Adicionar foto");
      b.type = "button";
      b.id = `foto-${g.grupo}`;
      b.disabled = doGrupo.length >= max;
      b.addEventListener("click", () => ficheiro.click());
      ficheiro.addEventListener("change", async () => {
        const f = ficheiro.files[0];
        if (!f) return;
        b.disabled = true;
        b.textContent = "A enviar…";
        try {
          const { blob } = await reduzirFoto(f);
          if (!(await acaoFicha(t, `fotos/${g.grupo}`, blob, { bruto: true, texto: "Foto guardada." }))) { b.disabled = false; b.textContent = "Adicionar foto"; }
        } catch (e) {
          aviso(e?.message || "Não foi possível usar esta foto.");
          b.disabled = false;
          b.textContent = "Adicionar foto";
        }
      });
      peca.append(ficheiro, b);
    }
    grelha.append(peca);
  }
  return [grelha, el("p", "pequeno suave", `Para fechar ${t.tipo === "obra" ? "a obra" : "o trabalho"}: pelo menos uma foto de ${fim === "_antes" ? "antes" : "depois"}; até ${max} por grupo.`)];
}

/** "Largar trabalho", com confirmação em dois toques. */
function botaoLargar(t) {
  const largar = el("button", "btn perigo cheio", "Largar trabalho");
  largar.type = "button";
  largar.id = "largar-trabalho";
  let armado = false, tm;
  largar.addEventListener("click", async () => {
    if (!armado) {
      armado = true;
      largar.classList.add("armado");
      largar.textContent = "Confirmar: largar este trabalho";
      tm = setTimeout(() => { armado = false; largar.classList.remove("armado"); largar.textContent = "Largar trabalho"; }, 5000);
      return;
    }
    clearTimeout(tm);
    largar.disabled = true;
    try {
      await pedir(`trabalhos/${t.id}/largar`, {});
      aviso("Largou o trabalho. Fica registado e deixa de ver os dados do cliente.");
      ir("trabalhos");
    } catch (e) { if (e.estado !== 401) { aviso(e.message); largar.disabled = false; } }
  });
  return largar;
}

// ---- Fecho (o último passo): o que falta, "Obra concluída" e "Largar trabalho". `irPasso(k)` abre o passo onde se
// resolve cada coisa que falta.
function parteFim(t, irPasso) {
  if (t.estado === "concluida_eletricista") {
    return com(el("div", "pilha"), el("p", "pequeno suave", "Quando o cliente confirmar (ou ao fim de 7 dias sem resposta), a Domus Energia aprova o trabalho e o pagamento. Se for preciso corrigir alguma coisa, avisamos."));
  }
  if (t.estado === "confirmada") {
    return com(el("div", "pilha"), el("p", "pequeno suave", "Depois da aprovação, envie a fatura-recibo em Pagamentos."));
  }
  const falta = t.falta ?? [];
  const nomeFim = t.tipo === "obra" ? "Obra concluída" : "Trabalho concluído";
  const concluir = el("button", "btn cheio", nomeFim);
  concluir.type = "button";
  concluir.id = "obra-concluida";
  concluir.disabled = falta.length > 0;
  // Em dois toques (decisão do dono, 2026-10-11): a seguir o cliente é avisado e a ficha fica só de leitura.
  confirmarEmDoisToques(concluir, "Confirmar: está concluída?", () => acaoFicha(t, "concluir", {}, { botao: concluir, texto: `${nomeFim}. Pedimos a confirmação ao cliente.` }));
  // Só se conclui a partir da hora da visita: quem foi mais cedo muda primeiro a data (em "Visita").
  const visitaPorVir = falta.some((x) => x.startsWith("a visita ainda não aconteceu"));
  const linhaFalta = (frase) => {
    const passo = faltaDe(frase)?.[1];
    if (!passo) return el("li", null, frase);
    const b = el("button", "link-falta", frase);
    b.type = "button";
    b.addEventListener("click", () => irPasso(passo));
    return com(el("li"), b);
  };
  const estado = falta.length
    ? com(el("div", "nota pilha"), el("b", null, "Falta:"), com(el("ul", "lista-falta"), falta.map(linhaFalta)), visitaPorVir ? el("p", "pequeno", "Se já fez o trabalho, mude primeiro a data da visita.") : null)
    : el("p", "nota calma", "Tudo preenchido. A seguir, o cliente confirma na conta dele.");
  estado.id = "falta-fechar";
  // Técnico responsável (decisão do dono, 2026-10-13; só nas obras, e só se o servidor o disser): quem assina a obra.
  // Sem ele não se conclui, e não é coisa que o eletricista resolva: é a Domus Energia que o indica.
  const tec = t.tecnico ?? null;
  const tecnico = !tec ? null : tec.indicado
    ? el("p", "pequeno", tec.proprio ? "Técnico responsável: é você (tem n.º de habilitação na DGEG)." : `Técnico responsável: ${tec.nome ?? "indicado pela Domus Energia"}.`)
    : el("p", "nota", "Esta obra ainda não tem técnico responsável: a Domus Energia tem de o indicar antes de a dar por concluída.");
  if (tecnico) tecnico.id = "tecnico-responsavel";
  const largar = botaoLargar(t);
  // Visita de orçamento sem custo (pagamentos online desligados): não se "conclui" — fecha quando a Domus envia a proposta.
  const gratis = t.recebe?.gratis === true;
  return com(el("div", "pilha fecho"),
    gratis ? el("p", "nota calma", "Visita de orçamento: fecha sozinha quando a Domus Energia enviar a proposta ao cliente. Não precisa de fotos nem de ensaios.") : estado,
    gratis ? null : tecnico,
    gratis ? null : concluir,
    el("p", "pequeno suave", "Largar o trabalho devolve-o à Domus Energia (ou à bolsa) e fica registado: quem larga um trabalho não é pago por ele."),
    largar);
}

// ---------------------------------------------------------------- Pagamentos (ronda 3)
const dataLonga = (isoTxt) => { const d = new Date(isoTxt); return Number.isNaN(d.getTime()) ? "" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const TIPOS_FATURA = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" };
const FATURA_MAX = 5 * 1024 * 1024;
/** IBAN português: "PT50" + 21 algarismos, resto 1 na divisão por 97 (ISO 13616). O servidor valida outra vez. */
function ibanValido(iban) {
  if (!/^PT50\d{21}$/.test(iban)) return false;
  let resto = 0;
  for (const d of `${iban.slice(4)}2529${iban.slice(2, 4)}`) resto = (resto * 10 + Number(d)) % 97;
  return resto === 1;
}
function estadoPagamentoTxt(x) {
  if (x.pagamento === "a_pagar") return x.prazo ? `A pagar até ${dataLonga(x.prazo)}` : "A pagar";
  if (x.pagamento === "pago") return x.pago_em ? `Pago em ${dataLonga(x.pago_em)}` : "Pago";
  return x.pagamento_texto;
}
const SELO_PAGAMENTO = { pago: "bom", a_pagar: "bom", fatura_em_falta: "mau", sem_pagamento: "mau" };

function desenharPagamentos(r) {
  const out = [el("h2", null, "Pagamentos"),
    el("p", "suave pequeno", `Pagamos por transferência até ${r.prazo_dias ?? PRAZO_DIAS} dias depois de: o cliente confirmar o trabalho, a Domus Energia o aprovar e, nas obras, o cliente pagar o restante. Contra fatura-recibo, sem IVA incluído nos valores.`),
    cartaoIban(r.iban)];
  if (!r.trabalhos.length) {
    out.push(com(el("div", "cartao"), el("p", null, "Ainda sem pagamentos."), el("p", "suave pequeno", "Os trabalhos que der por concluídos aparecem aqui.")));
    return out;
  }
  for (const x of r.trabalhos) out.push(cartaoPagamento(x));
  return out;
}

function cartaoIban(iban) {
  const c = com(el("div", "cartao pilha"), el("p", "rotulo", "IBAN para a transferência"));
  c.id = "cartao-iban";
  const atual = el("p", null, iban ?? "Ainda não indicou o IBAN.");
  atual.id = "iban-atual";
  const i = el("input");
  i.id = "iban";
  i.autocomplete = "off";
  i.inputMode = "text";
  i.maxLength = 34;
  i.placeholder = "PT50 0000 0000 0000 0000 0000 0";
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const b = el("button", "btn cheio", iban ? "Mudar IBAN" : "Guardar IBAN");
  b.type = "button";
  b.id = "guardar-iban";
  b.addEventListener("click", async () => {
    const v = i.value.replace(/\s+/g, "").toUpperCase();
    msg.hidden = true;
    if (!ibanValido(v)) { msg.textContent = "O IBAN não parece certo: PT50 seguido de 21 algarismos."; msg.hidden = false; i.focus(); return; }
    b.disabled = true;
    try {
      const j = await pedir("iban", { iban: v });
      i.value = "";
      atual.textContent = j.iban;
      b.textContent = "Mudar IBAN";
      aviso("IBAN guardado.");
    } catch (e) { if (e.estado !== 401) { msg.textContent = e.message; msg.hidden = false; } }
    finally { b.disabled = false; }
  });
  return com(c, atual, com(el("label", "campo"), el("span", null, iban ? "Novo IBAN" : "IBAN (conta em seu nome)"), i), msg, b,
    el("p", "pequeno suave", "Só aparece mascarado. Usamos o IBAN apenas para lhe pagar."));
}

const sufixo = (x) => (x.parte === "regresso" ? `${x.id}-regresso` : String(x.id));
function cartaoPagamento(x) {
  const v = x.valor;
  const c = com(el("div", "cartao pilha pagamento"), com(el("div", "selos"), selo(x.concelho), selo(NOME_TIPO[x.tipo] ?? x.tipo), selo(estadoPagamentoTxt(x), SELO_PAGAMENTO[x.pagamento] ?? "aviso")),
    el("h3", null, x.titulo), el("p", "valor-grande", v ? euro(v.total) : "—"));
  c.id = `pagamento-${sufixo(x)}`;
  // A ida sem defeito (o cliente disse "Não" e não havia defeito): uma linha própria, com a sua fatura-recibo.
  if (x.parte === "regresso") c.append(el("p", "pequeno suave", "Voltou ao cliente e não havia defeito: esta ida paga-se à parte, depois de o cliente pagar a visita."));
  // Obra parada por segurança: não há contas da proposta — recebe o trabalho já feito, pelo valor que a Domus Energia indicou.
  if (v?.obra_parada) c.append(el("p", "pequeno suave", "A obra foi parada por segurança: recebe o trabalho já feito, pelo valor que a Domus Energia indicou (sem IVA)."));
  else if (v) {
    const dl = el("dl", "dados");
    for (const [k, val] of [["Mão de obra (sem IVA)", euro(v.mao_obra)], [`${decimal(v.percentagem)} % da mão de obra`, euro(v.parte_mao_obra)], ["Deslocação (sem IVA)", euro(v.deslocacao)],
      ...(v.parte_extras ? [[`Trabalho a mais: ${decimal(v.percentagem)} % de ${euro(v.extras)}`, euro(v.parte_extras)]] : []),
      ...(v.idas_perdidas ? [["Ida perdida: a deslocação (sem IVA)", euro(v.idas_perdidas)]] : []), ["Total", euro(v.total)]]) dl.append(el("dt", null, k), el("dd", "num", val));
    c.append(dl);
    if (!x.valor_fixado) c.append(el("p", "pequeno suave", "Estimativa: o valor fica fixado quando a Domus Energia aprovar o trabalho."));
    if (x.tipo === "avaria" && x.parte !== "regresso") c.append(el("p", "pequeno suave", "A taxa de diagnóstico fica na Domus Energia."));
  }
  if (x.fatura) {
    const a = el("a", null, `Ver a fatura-recibo (${TIPOS_FATURA[x.fatura.tipo] ?? "ficheiro"})`);
    a.href = urlServidor(x.fatura.url);
    a.target = "_blank";
    a.rel = "noopener";
    c.append(com(el("p", "pequeno"), `Fatura-recibo enviada em ${dataLonga(x.fatura.quando)}. `, a));
  } else if (x.pode_fatura) c.append(el("p", "nota", `Fatura em falta: envie a fatura-recibo ${x.parte === "regresso" ? "desta ida" : "deste trabalho"}, com o valor acima.`));
  if (x.pode_fatura) c.append(...envioFatura(x));
  return c;
}

/** Enviar a fatura-recibo: PDF, JPG ou PNG até 5 MB (o servidor confirma o tipo pelos bytes). */
function envioFatura(x) {
  const ficheiro = el("input");
  ficheiro.type = "file";
  ficheiro.accept = "application/pdf,image/jpeg,image/png";
  ficheiro.hidden = true;
  ficheiro.id = `fatura-ficheiro-${sufixo(x)}`;
  const msg = el("p", "msg erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
  const texto = x.fatura ? "Substituir a fatura-recibo" : "Enviar a fatura-recibo";
  const b = el("button", x.fatura ? "btn sec" : "btn cheio", texto);
  b.type = "button";
  b.id = `enviar-fatura-${sufixo(x)}`;
  b.addEventListener("click", () => ficheiro.click());
  ficheiro.addEventListener("change", async () => {
    const f = ficheiro.files[0];
    ficheiro.value = "";
    if (!f) return;
    msg.hidden = true;
    if (!TIPOS_FATURA[f.type]) { msg.textContent = "A fatura-recibo tem de ser PDF, JPG ou PNG."; msg.hidden = false; return; }
    if (f.size > FATURA_MAX) { msg.textContent = "A fatura-recibo é demasiado grande (máx. 5 MB)."; msg.hidden = false; return; }
    b.disabled = true;
    b.textContent = "A enviar…";
    try {
      const dados = await new Promise((ok, falha) => {
        const leitor = new FileReader();
        leitor.onload = () => ok(String(leitor.result).replace(/^data:[^,]*,/, ""));
        leitor.onerror = () => falha(new Error("Não foi possível ler o ficheiro."));
        leitor.readAsDataURL(f);
      });
      const r = await pedir(`trabalhos/${x.id}/fatura`, { tipo: f.type, dados, ...(x.parte === "regresso" ? { parte: "regresso" } : {}) });
      aviso("Fatura-recibo enviada.");
      const y = window.scrollY;
      $("el-vista").replaceChildren(...desenharPagamentos(r));
      window.scrollTo(0, y);
    } catch (e) {
      if (e?.estado === 401) return;
      msg.textContent = e?.message || "Não foi possível enviar.";
      msg.hidden = false;
      b.disabled = false;
      b.textContent = texto;
    }
  });
  return [ficheiro, msg, b];
}

// ---------------------------------------------------------------- Procedimentos publicados (só leitura; docs/PROCEDIMENTOS.md)
async function procedimento(id) {
  const p = (await pedir(`procedimentos/${id}`)).procedimento;
  const ol = el("ol", "passos-ler");
  for (const x of p.passos) ol.append(com(el("li"), el("span", "passo-texto", x.texto), " ", selosPasso(x), x.nota ? el("p", "pequeno suave passo-nota", x.nota) : null));
  return [botaoVoltar("Ajuda técnica", "ajuda"), com(el("div", "selos"), selo(p.tipo_nome), selo(`Versão ${p.versao}`)), el("h2", null, p.titulo),
    p.descricao ? el("p", null, p.descricao) : null,
    com(el("div", "cartao pilha"), el("h3", null, "Passos"), ol),
    el("p", "pequeno suave", "Numa obra, a lista de verificação deste procedimento começa-se na ficha do trabalho, em \"Trabalho\".")].filter(Boolean);
}
/** A lista dos procedimentos publicados, para o cimo da Ajuda técnica (sem ela, a ajuda aparece na mesma). */
async function listaProcedimentos() {
  let lista = [];
  try { lista = (await pedir("procedimentos")).procedimentos ?? []; } catch (e) { if (e?.estado === 401) throw e; }
  if (!lista.length) return null;
  const ul = el("ul", "lista-proc");
  for (const p of lista) {
    const b = com(el("button", "link-proc"), el("b", null, p.titulo), el("span", "pequeno suave", `${p.tipo_nome} · ${p.n_passos} passos · versão ${p.versao}`));
    b.type = "button";
    b.id = `procedimento-${p.id}`;
    b.addEventListener("click", () => ir(`ajuda/${p.id}`));
    ul.append(com(el("li"), b));
  }
  const s = seccao("Procedimentos da Domus Energia", selo(String(lista.length)), el("p", "pequeno suave", "Como se faz cada tipo de trabalho, passo a passo."), ul);
  s.id = "aj-procedimentos";
  return s;
}

// ---------------------------------------------------------------- Ajuda técnica (guia rápido; textos nossos)
async function ajuda() {
  const procedimentos = await listaProcedimentos();
  const li = (itens) => com(el("ul", "simples"), itens.map((x) => (Array.isArray(x) ? com(el("li"), el("b", null, x[0]), ` ${x[1]}`) : el("li", null, x))));
  const dl = el("dl", "dados");
  for (const [k, v] of [["Isolamento", "≥ 0,5 MΩ a 500 V c.c., aparelhos desligados"], ["Terra", "≤ 100 Ω em habitação"], ["Diferencial", "dispara a ≤ IΔn; referência de tempo ≤ 300 ms"],
    ["PE", "registar o valor medido, tomada → quadro"], ["Tensão", "230 V ± 10 %"]]) dl.append(el("dt", null, k), el("dd", null, v));
  const fechada = (...a) => { const s = seccao(...a); s.open = false; return s; };
  const primeira = seccao("Segurança, antes de tudo", null, li(["Cortar o circuito no quadro e sinalizar o disjuntor.", "Confirmar a ausência de tensão no ponto de trabalho.",
    "Nunca trabalhar com tensão; medir só com pontas isoladas.", "Fumo, faíscas ou cheiro a queimado: cortar o geral e não religar."]));
  primeira.id = "aj-seguranca";
  return [el("h2", null, "Ajuda técnica"), el("p", "suave pequeno", "Guia rápido para a obra. Em caso de dúvida, ligue à Domus Energia."),
    procedimentos,
    primeira,
    fechada("Valores de referência", null, dl),
    fechada("Ordem dos ensaios", null, li(["Inspeção visual.", "Continuidade do PE.", "Resistência de isolamento.", "Terra e diferencial.", "Polaridade e ensaio funcional com carga."])),
    fechada("Tipos de avaria", null, li([["Circuito aberto:", "não há corrente no ponto. Testar a continuidade, sem tensão."],
      ["Curto-circuito:", "o disjuntor dispara logo. Isolar por partes; não religar sem a causa."],
      ["Fuga à terra:", "o diferencial dispara. Medir o isolamento circuito a circuito."],
      ["Sobrecarga:", "o disjuntor dispara com carga. Pinça amperimétrica e somar potências."]])),
    fechada("Quando parar e ligar à Domus", null, li(["Avaria antes do contador: é do distribuidor.", "Quadro com sinais de aquecimento generalizado.",
      "Fuga à terra que não se localiza em canalização embebida.", "Trabalho diferente do que está no relatório."]))].filter(Boolean);
}

// ---------------------------------------------------------------- contagem das 48 h
let tContagem = null;
function contagem(prazo, texto) {
  const c = el("div", "contagem");
  const s = el("strong");
  s.dataset.prazo = prazo;
  c.append(s, el("span", null, texto));
  atualizarUma(s);
  return c;
}
function atualizarUma(s) {
  const ms = Date.parse(s.dataset.prazo) - Date.now();
  const t = Math.max(0, Math.floor(ms / 1000));
  // No Início (data-curto) sem segundos — "6 h 12 min" —, e o cartão fica em destaque quando o prazo está a acabar.
  if (s.dataset.curto) {
    s.textContent = t >= 3600 ? `${Math.floor(t / 3600)} h ${p2(Math.floor(t / 60) % 60)} min` : `${Math.floor(t / 60)} min`;
    s.closest(".tarefa")?.classList.toggle("alarme", ms < PRAZO_A_ACABAR_MS);
  } else s.textContent = `${Math.floor(t / 3600)} h ${p2(Math.floor(t / 60) % 60)} min ${p2(t % 60)} s`;
  return ms;
}
function iniciarContagem() {
  pararContagem();
  if (!document.querySelector("[data-prazo]")) return;
  tContagem = setInterval(() => {
    let acabou = false;
    for (const s of document.querySelectorAll("[data-prazo]")) if (atualizarUma(s) <= 0) acabou = true;
    if (acabou) { pararContagem(); encaminhar(); }
  }, 1000);
}
function pararContagem() { clearInterval(tContagem); tContagem = null; }

// ---------------------------------------------------------------- arranque
(async () => {
  // O módulo pode estar desligado no servidor (ELETRICISTAS; docs/ELETRICISTAS.md): a API responde 404 e fica só a
  // linha "Área ainda não disponível.", sem o formulário de entrada.
  let estado = 0;
  try { estado = (await fetch(`${API}candidatura`, { headers: { Accept: "application/json" } })).status; } catch { estado = 0; }
  if (estado === 404) { marcarSessao(false); $("el-indisponivel").hidden = false; return; }
  if (!temMarcaSessao()) { mostrarEntrar(); return; }
  try {
    const r = await pedir("eu");
    entrou(r.eletricista);
  } catch (e) {
    mostrarEntrar(e?.estado === 401 ? "" : e?.message ?? "");
  }
})();
