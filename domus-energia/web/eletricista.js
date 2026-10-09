// Área do eletricista (docs/ELETRICISTAS.md): entrar com o email e um código (sessão própria, cookie domus_eletricista
// em /api/eletricista), Bolsa (trabalhos dos seus concelhos, sem dados do cliente nem preços: é o servidor que os
// tira), Aceitar, Os meus trabalhos (cliente, relatório técnico, material, 48 h para marcar a visita, Marcar visita,
// Largar trabalho). Ronda 2 — a ficha de obra: material levantado ou recebido, fotos antes e depois, ensaios medidos,
// diagnóstico da avaria, "Obra concluída" (fica a aguardar a confirmação do cliente) e a Ajuda técnica. Ronda 3 — os
// Pagamentos: o valor de cada trabalho (fixado quando a Domus aprova), o estado (a aguardar o cliente / a aprovação / o
// restante, fatura em falta, a pagar até, pago em), o envio da fatura-recibo e o IBAN (só se vê mascarado).
// Procedimentos (docs/PROCEDIMENTOS.md): os publicados leem-se na Ajuda técnica; numa obra, as checklists estão no
// separador "Trabalho" da ficha (começar a checklist de um procedimento e marcar os passos).
// Rotas no endereço: #/bolsa, #/bolsa/<id>, #/trabalhos, #/trabalhos/<id>, #/pagamentos, #/ajuda, #/ajuda/<id> (um procedimento). Só textContent (nunca HTML com dados).
import { seccaoTecnica } from "./simulador/simbolos.js";
import { desenharQuadroCliente, normalizarEsquema, esquemaVazio, esquemaTemAlgo, AMPERES_GERAL, AMPERES_DISJUNTOR, PROTECOES_ESQUEMA } from "./simulador/quadro-desenho.js";
import { analiseDaCasa, diferencasQuadro } from "./simulador/relatorio-casa.js";
import { reduzirFoto } from "./simulador/fotos.js";

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
  history.replaceState(null, "", "#/bolsa");
  mostrarEntrar("Saiu da área do eletricista.", "ok");
});

function entrou(e) {
  eu = e;
  marcarSessao(true);
  $("el-entrar").hidden = true;
  $("el-fundo").hidden = false;
  $("el-sair").hidden = false;
  $("el-quem").textContent = e.nome;
  msgEntrar(null);
  encaminhar();
}

// ---------------------------------------------------------------- rotas
function rota() {
  const [aba, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { aba: ["trabalhos", "pagamentos", "ajuda"].includes(aba) ? aba : "bolsa", id: /^\d{1,10}$/.test(id ?? "") ? id : null };
}
const ir = (c) => { if (location.hash === `#/${c}`) encaminhar(); else location.hash = `#/${c}`; };
window.addEventListener("hashchange", () => { if (eu) encaminhar(); });
for (const b of document.querySelectorAll(".app-abas [data-aba]")) b.addEventListener("click", () => ir(b.dataset.aba));

let geracao = 0;
async function encaminhar() {
  const { aba, id } = rota();
  const minha = ++geracao;
  pararContagem();
  for (const b of document.querySelectorAll(".app-abas [data-aba]")) b.setAttribute("aria-selected", String(b.dataset.aba === aba));
  const vista = $("el-vista");
  vista.replaceChildren(el("p", "vazio", "A carregar…"));
  try {
    const partes = aba === "ajuda" ? (id ? await procedimento(id) : await ajuda()) : aba === "pagamentos" ? desenharPagamentos(await pedir("pagamentos")) : aba === "bolsa" ? (id ? await bolsaDetalhe(id) : await bolsaLista()) : (id ? await ficha(id) : await trabalhosLista());
    if (minha !== geracao) return;
    vista.replaceChildren(...partes);
    $("conteudo").scrollTo?.(0, 0);
    window.scrollTo(0, 0);
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
const duracaoTxt = (t) => [t.horas ? `cerca de ${decimal(Math.round(t.horas * 10) / 10)} h` : null, t.dias ? `${t.dias} ${t.dias === 1 ? "dia" : "dias"}` : null].filter(Boolean).join(" · ");
function contadores(nBolsa, nTrab) {
  const mostrar = (id, n) => { const c = $(id); c.hidden = !n; c.textContent = n ? String(n) : ""; };
  if (nBolsa !== null) mostrar("el-conta-bolsa", nBolsa);
  if (nTrab !== null) mostrar("el-conta-trabalhos", nTrab);
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
  c.append(el("p", "pequeno suave", `Por transferência até ${PRAZO_DIAS} dias depois de a obra estar confirmada, paga pelo cliente e aprovada; contra fatura-recibo.`));
  return c;
}

// ---------------------------------------------------------------- Bolsa
async function bolsaLista() {
  const r = await pedir("bolsa");
  contadores(r.trabalhos.length, null);
  const out = [el("h2", null, "Bolsa"), el("p", "suave pequeno", `Trabalhos em ${r.concelhos.join(", ")}. O primeiro a aceitar fica com o trabalho.`)];
  if (!r.trabalhos.length) {
    out.push(com(el("div", "cartao"), el("p", null, "Sem trabalhos na bolsa."), el("p", "suave pequeno", "Os trabalhos novos dos seus concelhos aparecem aqui.")));
    return out;
  }
  for (const t of r.trabalhos) {
    const b = com(el("button", "cartao trab"), com(el("span", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo, "aviso")),
      el("h3", null, t.titulo),
      com(el("span"), "Recebe ", el("b", "num", t.recebe ? euro(t.recebe.total) : "a combinar")),
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
    com(el("div", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo)),
    el("h2", null, t.titulo),
    duracaoTxt(t) ? el("p", "pequeno", `Duração estimada: ${duracaoTxt(t)}.`) : null,
    cartaoRecebe(t),
    blocoRelatorio(t.relatorio, "Relatório técnico (sem preços)"),
    el("p", "nota", `Nome, morada e telefone do cliente só aparecem depois de aceitar. Tem ${r.prazo_visita_horas ?? 48} h para marcar a visita; sem visita, o trabalho volta à bolsa.`),
    msg, aceitar,
  ].filter(Boolean);
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
  const r = await pedir("trabalhos");
  contadores(null, r.trabalhos.filter((t) => t.estado === "aceite" && t.aberto).length);
  const out = [el("h2", null, "Os meus trabalhos")];
  if (!r.trabalhos.length) {
    out.push(com(el("div", "cartao"), el("p", null, "Sem trabalhos em curso."), el("p", "suave pequeno", "Os trabalhos que aceitar na Bolsa aparecem aqui.")));
    return out;
  }
  for (const t of r.trabalhos) {
    const b = com(el("button", "cartao trab"), com(el("span", "selos"), selo(t.concelho), seloEstado(t)), el("h3", null, t.titulo));
    if (t.aberto && t.estado === "aceite" && t.prazo) b.append(contagem(t.prazo, "para marcar a visita"));
    else if (t.visita) b.append(el("span", "pequeno", `Visita: ${visitaTxt(t.visita)}`));
    b.type = "button";
    b.id = `meu-trabalho-${t.id}`;
    b.addEventListener("click", () => ir(`trabalhos/${t.id}`));
    out.push(b);
  }
  return out;
}
const seloEstado = (t) => (t.estado === "paga" ? selo("Pago", "bom") : t.estado === "aprovada" ? selo("Aprovado", "bom") : !t.aberto ? selo("Fechado")
  : t.estado === "concluida_eletricista" ? selo("A aguardar o cliente", "aviso") : t.estado === "confirmada" ? selo("A aguardar aprovação", "aviso")
  : t.estado === "aceite" ? selo("Marcar visita", "aviso") : selo(`Visita ${visitaTxt(t.visita)}`, "bom"));

let abaFicha = "cliente";
const ABAS_FICHA = [["cliente", "Cliente"], ["trabalho", "Trabalho"], ["ensaios", "Ensaios"], ["fotos", "Fotos"]];
async function ficha(id) {
  const r = await pedir(`trabalhos/${id}`);
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
  const out = [botaoVoltar("Os meus trabalhos", "trabalhos"), com(el("div", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo), seloEstado(t)), el("h2", null, t.titulo),
    t.recebe?.gratis ? el("p", "pequeno", "Visita de orçamento: não é paga. Recebe se o cliente aceitar a proposta e fizer a obra.")
      : com(el("p", "pequeno"), "Recebe ", el("b", "num", t.recebe ? euro(t.recebe.total) : "a combinar"), t.recebe ? ` · ${decimal(t.recebe.percentagem)} % da mão de obra + deslocação` : "")];
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
  if (t.estado === "concluida_eletricista" || t.estado === "confirmada") {
    const n = el("p", "nota calma");
    n.id = "obra-estado";
    com(n, el("b", null, `Deu o trabalho por concluído em ${dataCurta(t.concluida)}.`),
      t.estado === "confirmada" ? " O cliente confirmou: falta a aprovação da Domus Energia." : " A aguardar confirmação do cliente.");
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
  const abas = el("div", "ficha-abas");
  abas.setAttribute("role", "tablist");
  abas.setAttribute("aria-label", "Partes da ficha do trabalho");
  const painel = el("div", "pilha");
  painel.id = "ficha-painel";
  painel.setAttribute("role", "tabpanel");
  if (!ABAS_FICHA.some(([k]) => k === abaFicha)) abaFicha = "cliente";
  const PARTES = { cliente: parteCliente, trabalho: parteTrabalho, ensaios: parteEnsaios, fotos: parteFotos };
  const feito = partesFeitas(t);
  const desenhar = () => {
    for (const b of abas.children) b.setAttribute("aria-selected", String(b.dataset.aba === abaFicha));
    painel.setAttribute("aria-labelledby", `ficha-aba-${abaFicha}`);
    painel.replaceChildren(...PARTES[abaFicha](t));
  };
  for (const [k, nome] of ABAS_FICHA) {
    const b = com(el("button"), el("span", null, feito[k] ? `${nome} ✓` : nome), feito[k] ? el("span", "so-leitor", " (completo)") : null);
    b.type = "button";
    b.id = `ficha-aba-${k}`;
    b.dataset.aba = k;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "ficha-painel");
    b.addEventListener("click", () => { abaFicha = k; desenhar(); });
    abas.append(b);
  }
  desenhar();
  out.push(abas, painel, parteFim(t));
  return out;
}
/** O que já está feito em cada separador (o visto ao lado do nome). */
function partesFeitas(t) {
  const fotos = t.fotos ?? [];
  const tem = (...grupos) => fotos.some((f) => grupos.includes(f.grupo));
  const e = t.ensaios ?? {};
  return {
    cliente: Boolean(t.visita),
    trabalho: (t.material ?? []).length > 0 && t.material.every((m) => m.recebido),
    // O mesmo para a obra, a visita técnica e a avaria: os três ensaios (e, na avaria, a conclusão do diagnóstico).
    ensaios: ["isolamento", "diferencial", "terra"].every((k) => e[k] !== null && e[k] !== undefined) && (t.tipo !== "avaria" || Boolean(t.diagnostico?.atual?.conclusao)),
    fotos: tem("quadro_antes", "pontos_antes") && tem("quadro_depois", "pontos_depois"),
  };
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
  return [cliente, seccaoVisita(t), seccaoQuadro(t), seccaoAparelhos(t), ...(t.pode_proposta || t.proposta ? [seccaoProposta(t)] : [])].filter(Boolean);
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
  const CHIP = { por_registar: "por registar", por_ver: "registado", confere: "registado e a responder", diferente: "o aparelho responde com outro chip" };
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
            desenhar(await pedir(`trabalhos/${t.id}/chip`, { aparelho: a.id, mac: mac.value.trim() }));
            aviso(r.sem_aprovacao ? "Chip registado." : "Chip registado. Fica à espera da aprovação da Domus.");
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
  const corpo = [el("p", "pequeno suave", "O quadro ideal é calculado pelo que o cliente descreveu da casa. O trabalho é adaptar o quadro que lá está ao ideal."), lado, cxFalta];

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
    const guardar = el("button", "btn", "Guardar quadro existente");
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
function seccaoProposta(t) {
  const p = t.proposta;
  const corpo = [];
  if (p) {
    corpo.push(com(el("p"), el("b", null, `Enviada em ${dataCurta(p.quando)}: ${decimal(p.horas)} h de trabalho`), p.material.length ? ` e ${p.material.length} ${p.material.length === 1 ? "artigo" : "artigos"}.` : "."),
      p.material.length ? com(el("ul", "pequeno"), ...p.material.map((m) => el("li", null, `${m.qtd} × ${m.nome}`))) : null,
      p.notas ? el("p", "pequeno suave", `«${p.notas}»`) : null,
      el("p", "pequeno suave", "A Domus Energia calcula o preço e envia a proposta ao cliente."));
  }
  if (!t.pode_proposta) return seccao("Proposta para o cliente", p ? selo("Enviada") : null, ...corpo.filter(Boolean));
  const msg = el("p", "erro");
  msg.hidden = true;
  msg.setAttribute("role", "alert");
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
      if (a.categoria !== cat) { cat = a.categoria; grupo = document.createElement("optgroup"); grupo.label = cat; s.append(grupo); }
      grupo.append(new Option(a.nome, a.sku, false, a.sku === sku));
    }
    const q = el("input");
    q.type = "number"; q.min = "1"; q.max = "999"; q.step = "1"; q.inputMode = "numeric"; q.value = String(qtd);
    q.setAttribute("aria-label", "Quantidade");
    const x = el("button", "btn sec mini", "Tirar");
    x.type = "button";
    x.addEventListener("click", () => f.remove());
    f.append(s, q, x);
    linhas.append(f);
    return s;
  };
  const mais = el("button", "btn sec mini", "+ Artigo");
  mais.type = "button";
  mais.id = "proposta-mais";
  mais.addEventListener("click", () => novaLinha().focus());
  const enviar = el("button", "btn", p ? "Enviar outra vez" : "Enviar proposta à Domus");
  enviar.type = "button";
  enviar.id = "proposta-enviar";
  enviar.addEventListener("click", () => {
    msg.hidden = true;
    const h0 = Number(String(horas.value).replace(",", "."));
    if (!(h0 >= 0.5)) { msg.textContent = "Indique as horas de trabalho (pelo menos meia hora)."; msg.hidden = false; horas.focus(); return; }
    const material = [];
    for (const f of linhas.querySelectorAll(".proposta-linha")) {
      const sku = f.querySelector("select").value, qtd = Math.round(Number(f.querySelector("input").value));
      if (!sku) continue;
      if (!(qtd >= 1 && qtd <= 999)) { msg.textContent = "Cada artigo precisa de uma quantidade entre 1 e 999."; msg.hidden = false; f.querySelector("input").focus(); return; }
      material.push({ sku, qtd });
    }
    acaoFicha(t, "proposta", { horas: h0, material, notas: notas.value.trim() || null }, { botao: enviar, msg, texto: "Proposta enviada à Domus Energia." });
  });
  const carregar = async () => {
    if (!catalogoProposta) {
      try { catalogoProposta = (await pedir("catalogo")).artigos ?? []; } catch (e) { msg.textContent = e.message; msg.hidden = false; return; }
    }
    linhas.replaceChildren();
    for (const m of p?.material ?? []) novaLinha(m.sku, m.qtd);
  };
  carregar();
  const campo = (rotulo, input) => com(el("label", "campo"), el("span", null, rotulo), input);
  corpo.push(el("p", "pequeno suave", "Depois de ver a casa, diga o que a obra precisa. Não escreva preços: a Domus Energia calcula-os e envia a proposta ao cliente."),
    campo("Horas de trabalho", horas),
    el("p", "rotulo", "Material (do catálogo da Domus)"), linhas, com(el("div"), mais),
    campo("Notas para a Domus (opcional)", notas), msg, com(el("div", "fila"), enviar));
  return seccao("Proposta para o cliente", p ? selo("Enviada") : null, ...corpo.filter(Boolean));
}

function seccaoVisita(t) {
  const marcada = Boolean(t.visita);
  const corpo = [];
  if (!marcada) {
    if (t.prazo) corpo.push(contagem(t.prazo, "para marcar a visita. Depois disso, o trabalho deixa de ser seu."));
    corpo.push(el("p", "pequeno suave", "Combine o dia com o cliente por telefone e registe aqui. O cliente recebe a confirmação por email, em nome da Domus Energia."), ...formVisita(t));
  } else {
    corpo.push(com(el("p"), el("b", null, visitaTxt(t.visita))), el("p", "pequeno suave", "O cliente recebeu a confirmação em nome da Domus Energia."));
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
    acaoFicha(t, "visita", { data_visita: `${dia.value}T${hora.value}` }, { botao: b, msg, texto: "Visita marcada. O cliente foi avisado em nome da Domus Energia." });
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
  return [
    blocoRelatorio(t.relatorio, "Lista de trabalho e planta"),
    seccao("Material a levantar", selo(`${nRec}/${mat.length}`, mat.length && nRec === mat.length ? "bom" : ""),
      el("p", "nota calma", "Material fornecido pela Domus Energia: combinamos consigo onde o levanta ou se segue para a obra. Marque o que já levantou ou recebeu."),
      mat.length ? acoes : null, mat.length ? lista : el("p", "suave", "Sem lista de material.")),
    seccaoChecklists(t),
  ].filter(Boolean);
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
  if (!c.checklists.length) corpo.push(el("p", "suave", "Esta obra ainda não tem checklists."));
  if (t.editavel && c.disponiveis.length) {
    const escolha = el("select");
    escolha.id = "checklist-procedimento";
    escolha.setAttribute("aria-label", "Procedimento");
    for (const p of c.disponiveis) { const o = el("option", null, `${p.titulo} (${p.n_passos} passos)`); o.value = String(p.id); escolha.append(o); }
    const b = el("button", "btn sec mini", "Começar checklist");
    b.type = "button";
    b.id = "comecar-checklist";
    b.addEventListener("click", () => acaoFicha(t, "checklists", { procedimento_id: Number(escolha.value) }, { botao: b, texto: "Checklist começada." }));
    corpo.push(com(el("label", "campo"), el("span", null, "Começar a checklist de um procedimento"), escolha), com(el("div", "fila"), b));
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
  const out = [seccao("Ensaios", (e.fora ?? []).length ? selo("Fora do limite", "mau") : selo(`${nFeitos}/3`, nFeitos === 3 ? "bom" : "aviso"),
    ...linhas, com(el("label", "campo"), el("span", null, (e.fora ?? []).length ? "Nota (obrigatória: há valores fora do limite)" : "Nota (opcional)"), notas),
    msg, t.editavel ? guardar : null, e.data ? el("p", "pequeno suave", `Guardados em ${dataCurta(e.data)}.`) : null)];
  if (t.diagnostico) out.push(seccaoDiagnostico(t));
  return out;
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

// ---- Fotos antes e depois (quadro e pontos): reduzidas no telemóvel (até 1 MB) antes de enviar
function parteFotos(t) {
  const fotos = t.fotos ?? [];
  const max = t.fotos_max ?? 4;
  const grelha = el("div", "fotos-grelha");
  grelha.id = "fotos-obra";
  const obrigatoria = (grupo) => !fotos.some((f) => f.grupo.endsWith(grupo.endsWith("_antes") ? "_antes" : "_depois"));
  for (const g of t.grupos_fotos ?? []) {
    const doGrupo = fotos.filter((f) => f.grupo === g.grupo);
    const [onde, quando] = g.nome.split(" — ");
    const peca = el("div", "foto-peca");
    peca.id = `peca-${g.grupo}`;
    peca.append(com(el("p"), el("b", null, onde), " ", el("span", "suave", quando)));
    if (!doGrupo.length) peca.append(com(el("div", "mini-foto vazia"), obrigatoria(g.grupo) ? selo("Falta uma foto", "aviso") : el("span", "pequeno suave", "Sem fotos")));
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
      const b = el("button", "btn sec mini cheio", "Adicionar foto");
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
  return [grelha, el("p", "pequeno suave", `Para fechar ${t.tipo === "obra" ? "a obra" : "o trabalho"}: pelo menos uma foto de antes e uma de depois; até ${max} por grupo.`)];
}

// ---- Fecho: o que falta, "Obra concluída" e "Largar trabalho"
function parteFim(t) {
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
  concluir.addEventListener("click", () => acaoFicha(t, "concluir", {}, { botao: concluir, texto: `${nomeFim}. Pedimos a confirmação ao cliente.` }));
  const estado = falta.length
    ? com(el("div", "nota"), el("b", null, "Falta: "), falta.join("; "), ".")
    : el("p", "nota calma", "Tudo preenchido. A seguir, o cliente confirma na conta dele.");
  estado.id = "falta-fechar";
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
  // Visita de orçamento sem custo (pagamentos online desligados): não se "conclui" — fecha quando a Domus envia a proposta.
  const gratis = t.recebe?.gratis === true;
  return com(el("div", "pilha fecho"),
    gratis ? el("p", "nota calma", "Visita de orçamento: fecha sozinha quando a Domus Energia enviar a proposta ao cliente. Não precisa de fotos nem de ensaios.") : estado,
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
  if (v) {
    const dl = el("dl", "dados");
    for (const [k, val] of [["Mão de obra (sem IVA)", euro(v.mao_obra)], [`${decimal(v.percentagem)} % da mão de obra`, euro(v.parte_mao_obra)], ["Deslocação (sem IVA)", euro(v.deslocacao)], ["Total", euro(v.total)]]) dl.append(el("dt", null, k), el("dd", "num", val));
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
    el("p", "pequeno suave", "Numa obra, a checklist deste procedimento começa-se na ficha do trabalho, em \"Trabalho\".")].filter(Boolean);
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
  s.textContent = `${Math.floor(t / 3600)} h ${p2(Math.floor(t / 60) % 60)} min ${p2(t % 60)} s`;
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
