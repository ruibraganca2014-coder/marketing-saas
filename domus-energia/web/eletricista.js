// Área do eletricista (docs/ELETRICISTAS.md): entrar com o email e um código (sessão própria, cookie domus_eletricista
// em /api/eletricista), Bolsa (trabalhos dos seus concelhos, sem dados do cliente nem preços: é o servidor que os
// tira), Aceitar, Os meus trabalhos (cliente, relatório técnico, material, 48 h para marcar a visita, Marcar visita,
// Largar trabalho). Pagamentos, fotos, ensaios, obra concluída e ajuda técnica: rondas seguintes ("em breve").
// Rotas no endereço: #/bolsa, #/bolsa/<id>, #/trabalhos, #/trabalhos/<id>. Só textContent (nunca HTML com dados).
import { seccaoTecnica } from "./simulador/simbolos.js";
import { desenharQuadroCliente } from "./simulador/quadro-desenho.js";

const cfg = window.DOMUS ?? {};
const base = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
const API = `${base ? `${base}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "")}/eletricista/`;
const credenciais = base ? "include" : "same-origin";
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
async function pedir(caminho, corpo) {
  const opcoes = { method: corpo === undefined ? "GET" : "POST", credentials: credenciais, headers: { Accept: "application/json" } };
  if (corpo !== undefined) { opcoes.headers["Content-Type"] = "application/json"; opcoes.body = JSON.stringify(corpo); }
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
  document.title = "Entrar — Área do eletricista — Domus Energia";
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
  return { aba: aba === "trabalhos" ? "trabalhos" : "bolsa", id: /^\d{1,10}$/.test(id ?? "") ? id : null };
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
    const partes = aba === "bolsa" ? (id ? await bolsaDetalhe(id) : await bolsaLista()) : (id ? await ficha(id) : await trabalhosLista());
    if (minha !== geracao) return;
    vista.replaceChildren(...partes);
    $("conteudo").scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    iniciarContagem();
  } catch (e) {
    if (minha !== geracao || e?.estado === 401) return;
    const voltar = id ? botaoVoltar(aba === "bolsa" ? "Bolsa" : "Os meus trabalhos", aba) : null;
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
  const partes = `${decimal(r.percentagem)} % da mão de obra (${euro(r.parte_mao_obra)}) + deslocação (${euro(r.deslocacao)}), sem IVA.`;
  const extra = tipo === "avaria" ? " A taxa de diagnóstico fica na Domus Energia." : tipo === "obra" ? " Material fornecido pela Domus." : "";
  return partes + extra;
}
function cartaoRecebe(t) {
  const c = com(el("div", "cartao pilha"), el("p", "rotulo", "Valor que recebe"),
    el("p", "valor-grande", t.recebe ? euro(t.recebe.total) : "A combinar"),
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
const seloEstado = (t) => (!t.aberto ? selo("Fechado") : t.estado === "aceite" ? selo("Marcar visita", "aviso") : selo(`Visita ${visitaTxt(t.visita)}`, "bom"));

let abaFicha = "cliente";
async function ficha(id) {
  const r = await pedir(`trabalhos/${id}`);
  const t = r.trabalho;
  const out = [botaoVoltar("Os meus trabalhos", "trabalhos"), com(el("div", "selos"), selo(t.concelho), selo(NOME_TIPO[t.tipo] ?? t.tipo), seloEstado(t)), el("h2", null, t.titulo),
    com(el("p", "pequeno"), "Recebe ", el("b", "num", t.recebe ? euro(t.recebe.total) : "a combinar"), t.recebe ? ` · ${decimal(t.recebe.percentagem)} % da mão de obra + deslocação` : "")];
  if (!t.aberto) {
    out.push(el("p", "nota calma", "Trabalho fechado: os dados do cliente já não estão disponíveis."));
    return out;
  }
  const abas = el("div", "ficha-abas");
  abas.setAttribute("role", "tablist");
  abas.setAttribute("aria-label", "Partes da ficha do trabalho");
  const painel = el("div", "pilha");
  painel.id = "ficha-painel";
  painel.setAttribute("role", "tabpanel");
  const ABAS = [["cliente", "Cliente"], ["trabalho", "Trabalho"], ["ensaios", "Ensaios", true], ["fotos", "Fotos", true]];
  if (!["cliente", "trabalho"].includes(abaFicha)) abaFicha = "cliente";
  const desenhar = () => {
    for (const b of abas.children) b.setAttribute("aria-selected", String(b.dataset.aba === abaFicha));
    painel.setAttribute("aria-labelledby", `ficha-aba-${abaFicha}`);
    painel.replaceChildren(...(abaFicha === "cliente" ? parteCliente(t) : parteTrabalho(t)));
  };
  for (const [k, nome, breve] of ABAS) {
    const b = com(el("button"), el("span", null, nome), breve ? el("span", "breve", "em breve") : null);
    b.type = "button";
    b.id = `ficha-aba-${k}`;
    b.dataset.aba = k;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "ficha-painel");
    if (breve) b.disabled = true;
    else b.addEventListener("click", () => { abaFicha = k; desenhar(); });
    abas.append(b);
  }
  desenhar();
  out.push(abas, painel, parteFim(t));
  return out;
}

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

function seccaoVisita(t) {
  const marcada = t.estado === "visita_marcada" && t.visita;
  const corpo = [];
  const form = formVisita(t);
  if (!marcada) {
    if (t.prazo) corpo.push(contagem(t.prazo, "para marcar a visita. Depois disso, o trabalho deixa de ser seu."));
    corpo.push(el("p", "pequeno suave", "Combine o dia com o cliente por telefone e registe aqui. O cliente recebe a confirmação por email, em nome da Domus Energia."), ...form);
  } else {
    const alterar = el("button", "btn sec mini", "Alterar data");
    alterar.type = "button";
    alterar.id = "alterar-visita";
    const zona = el("div", "pilha");
    zona.hidden = true;
    zona.append(...form);
    alterar.addEventListener("click", () => { zona.hidden = false; alterar.hidden = true; zona.querySelector("input")?.focus(); });
    corpo.push(com(el("p"), el("b", null, visitaTxt(t.visita))), el("p", "pequeno suave", "O cliente recebeu a confirmação em nome da Domus Energia."), com(el("div"), alterar), zona);
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
  b.addEventListener("click", async () => {
    msg.hidden = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.value) || !/^\d{2}:\d{2}$/.test(hora.value)) { msg.textContent = "Escolha o dia e a hora."; msg.hidden = false; return; }
    b.disabled = true;
    try {
      await pedir(`trabalhos/${t.id}/visita`, { data_visita: `${dia.value}T${hora.value}` });
      aviso("Visita marcada. O cliente foi avisado em nome da Domus Energia.");
      encaminhar();
    } catch (e) {
      if (e.estado === 401) return;
      msg.textContent = e.message;
      msg.hidden = false;
      b.disabled = false;
    }
  });
  const campo = (rotulo, input) => com(el("label", "campo"), el("span", null, rotulo), input);
  return [com(el("div", "grelha-2"), campo("Dia", dia), campo("Hora", hora)), msg, b];
}

function parteTrabalho(t) {
  const mat = t.material ?? [];
  return [
    blocoRelatorio(t.relatorio, "Lista de trabalho e planta"),
    seccao("Material", selo(String(mat.length)),
      el("p", "nota calma", "Material fornecido pela Domus Energia: combinamos consigo onde o levanta ou se segue para a obra."),
      mat.length ? listaMaterial(mat, "nome") : el("p", "suave", "Sem lista de material.")),
  ];
}

function parteFim(t) {
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
  const concluir = el("button", "btn cheio", "Obra concluída — em breve");
  concluir.type = "button";
  concluir.disabled = true;
  return com(el("div", "pilha"),
    el("p", "pequeno suave", "Largar o trabalho devolve-o à Domus Energia (ou à bolsa) e fica registado: quem larga um trabalho não é pago por ele."),
    largar, concluir);
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
  if (!temMarcaSessao()) { mostrarEntrar(); return; }
  try {
    const r = await pedir("eu");
    entrou(r.eletricista);
  } catch (e) {
    mostrarEntrar(e?.estado === 401 ? "" : e?.message ?? "");
  }
})();
