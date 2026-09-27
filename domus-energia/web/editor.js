// Peças de formulário partilhadas pelo assistente de automações e pelo editor de cenas:
// editor de condições (`se`) e editor de ações (`entao` / `acoes`), com SE/SENÃO aninhado.
// Tudo o que vem do servidor (nomes de aparelhos, cenas) entra com textContent.
import * as E from "./estado.js";

export const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};

export function botao(texto, cls = "btn sec pequeno", aoClicar) {
  const b = el("button", cls, texto);
  b.type = "button";
  if (aoClicar) b.addEventListener("click", aoClicar);
  return b;
}

// opcoes: [{ valor, texto, grupo? }]
export function select(nome, opcoes, valor) {
  const s = document.createElement("select");
  s.name = nome;
  const grupos = new Map();
  for (const o of opcoes) {
    const op = el("option", null, o.texto);
    op.value = o.valor;
    if (o.grupo) {
      if (!grupos.has(o.grupo)) { const g = document.createElement("optgroup"); g.label = o.grupo; grupos.set(o.grupo, g); s.append(g); }
      grupos.get(o.grupo).append(op);
    } else s.append(op);
  }
  if (valor != null && valor !== "" && !opcoes.some((o) => o.valor === valor)) {
    const op = el("option", null, `${valor} (desconhecido)`);
    op.value = valor;
    s.append(op);
  }
  if (valor != null) s.value = valor;
  return s;
}
export function campo(rotulo, controlo, ajuda) {
  const l = el("label", null, rotulo);
  l.append(controlo);
  if (ajuda) l.append(el("small", "ajuda", ajuda));
  return l;
}
export function input(nome, tipo, valor, extra = {}) {
  const i = document.createElement("input");
  i.name = nome;
  i.type = tipo;
  if (valor != null) i.value = String(valor);
  Object.entries(extra).forEach(([k, v]) => i.setAttribute(k, v));
  return i;
}
export function caixa(nome, texto, marcado) {
  const l = el("label", "caixa");
  const c = input(nome, "checkbox");
  c.checked = !!marcado;
  l.append(c, document.createTextNode(texto));
  return { label: l, input: c };
}
// Grupo de "pílulas" de escolha múltipla (checkboxes).
export function chips(nome, opcoes, marcados, rotulo) {
  const g = el("div", "dias");
  g.setAttribute("role", "group");
  if (rotulo) g.setAttribute("aria-label", rotulo);
  for (const [v, t] of opcoes) {
    const l = el("label");
    const c = input(nome, "checkbox", v);
    c.checked = marcados.includes(v);
    l.append(c, document.createTextNode(t));
    g.append(l);
  }
  return { raiz: g, lidos: () => [...g.querySelectorAll("input:checked")].map((c) => c.value) };
}

export const separar = (v) => { const [id, n] = String(v ?? "").split(":"); return { aparelho: id || null, canal: n ? parseInt(n, 10) : null }; };
export const hhmm = (v) => String(v ?? "").slice(0, 5);
const inteiro = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : NaN; };

export function opcoesCanais(aparelhos, funcoes, grupos = null) {
  const r = [];
  for (const a of aparelhos) for (const c of a.canais) {
    if (!funcoes.includes(c.funcao)) continue;
    const o = { valor: `${a.id}:${c.n}`, texto: E.nomeCanal(aparelhos, a.id, c.n) + (c.carga === "perigosa" ? " (carga perigosa)" : ""), funcao: c.funcao, carga: c.carga ?? null };
    if (grupos) o.grupo = grupos[c.funcao];
    r.push(o);
  }
  return r;
}
export const GRUPOS_SENSOR = { porta: "Portas e janelas", movimento: "Movimento", interruptor: "Interruptores e luzes", luz: "Interruptores e luzes" };
export function estadosDe(funcao) {
  if (funcao === "porta") return [["1", "Aberta"], ["0", "Fechada"]];
  if (funcao === "movimento") return [["1", "Com movimento"], ["0", "Sem movimento"]];
  return [["1", "Ligado"], ["0", "Desligado"]];
}

export const DIAS = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]];
export const OPCOES_MODO = E.MODOS.map((m) => [m, E.NOME_MODO[m]]);

// ---------- Condições ----------
export function editorCondicoes(se = {}, { aparelhos, prefixo = "se", alarme = true } = {}) {
  se = se ?? {};
  const raiz = el("div", "condicoes");
  let alarmeSel = null;
  if (alarme) {
    alarmeSel = select(`${prefixo}-alarme`, [
      { valor: "", texto: "Tanto faz" },
      { valor: "true", texto: "Só com o alarme ativo" },
      { valor: "false", texto: "Só com o alarme desligado" },
    ], se.alarme === true ? "true" : se.alarme === false ? "false" : "");
    raiz.append(campo("Alarme", alarmeSel));
  }

  // Horário
  const entre = caixa(`${prefixo}-entre`, "Só num horário", Array.isArray(se.entre));
  const de = input(`${prefixo}-de`, "time", se.entre?.[0] ?? "19:00");
  const ate = input(`${prefixo}-ate`, "time", se.entre?.[1] ?? "07:00");
  const horario = el("div", "horario");
  horario.append(campo("Das", de), campo("Às", ate));
  const mostrarH = () => { horario.hidden = !entre.input.checked; };
  entre.input.addEventListener("change", mostrarH);
  mostrarH();
  raiz.append(entre.label, horario);

  // Dias
  const diasOn = caixa(`${prefixo}-dias-on`, "Só em certos dias", Array.isArray(se.dias));
  const dias = chips(`${prefixo}-dia`, DIAS.map(([n, t]) => [String(n), t]), (se.dias ?? [1, 2, 3, 4, 5]).map(String), "Dias da semana");
  const mostrarD = () => { dias.raiz.hidden = !diasOn.input.checked; };
  diasOn.input.addEventListener("change", mostrarD);
  mostrarD();
  raiz.append(diasOn.label, dias.raiz);

  // Sol, presença
  const sol = select(`${prefixo}-sol`, [{ valor: "", texto: "Tanto faz" }, { valor: "dia", texto: "Só de dia (entre o nascer e o pôr do sol)" }, { valor: "noite", texto: "Só de noite (entre o pôr e o nascer do sol)" }], se.sol ?? "");
  const presenca = select(`${prefixo}-presenca`, [{ valor: "", texto: "Tanto faz" }, { valor: "alguem", texto: "Só com alguém em casa" }, { valor: "ninguem", texto: "Só sem ninguém em casa" }], se.presenca ?? "");
  const duas = el("div", "duas");
  duas.append(campo("Sol", sol), campo("Presença", presenca));
  raiz.append(duas);

  // Modo
  const modoL = el("div", "grupo-campo");
  modoL.append(el("span", "rotulo-campo", "Modo da casa (nenhum = tanto faz)"));
  const modos = chips(`${prefixo}-modo`, OPCOES_MODO, se.modo ?? [], "Modo da casa");
  modoL.append(modos.raiz);
  raiz.append(modoL);

  // Estado de outros aparelhos
  const apL = el("div", "grupo-campo");
  apL.append(el("span", "rotulo-campo", "Estado de outros aparelhos"));
  const linhasAp = el("div", "linhas-condicao");
  const opcoes = opcoesCanais(aparelhos, ["interruptor", "luz", "porta", "movimento"], GRUPOS_SENSOR);
  const linhas = [];
  const novaLinha = (x = {}) => {
    const linha = el("div", "linha-condicao");
    const canal = select(`${prefixo}-ap-canal`, opcoes, x.aparelho ? `${x.aparelho}:${x.canal}` : opcoes[0]?.valor);
    canal.setAttribute("aria-label", "Aparelho");
    const valor = document.createElement("select");
    valor.name = `${prefixo}-ap-valor`;
    valor.setAttribute("aria-label", "Estado");
    const encher = () => {
      const atual = valor.value || (x.valor != null ? String(x.valor) : "1");
      valor.replaceChildren();
      for (const [v, t] of estadosDe(opcoes.find((o) => o.valor === canal.value)?.funcao)) { const o = el("option", null, t); o.value = v; valor.append(o); }
      valor.value = atual;
    };
    canal.addEventListener("change", encher);
    encher();
    const obj = { linha, ler: () => ({ ...separar(canal.value), valor: Number(valor.value) }) };
    const rem = botao("Remover", "btn sec pequeno", () => { linha.remove(); linhas.splice(linhas.indexOf(obj), 1); });
    linha.append(canal, valor, rem);
    linhas.push(obj);
    linhasAp.append(linha);
  };
  for (const x of se.aparelhos ?? []) novaLinha(x);
  const mais = botao("Acrescentar aparelho", "btn sec pequeno", () => novaLinha());
  mais.disabled = opcoes.length === 0;
  apL.append(linhasAp, mais);
  raiz.append(apL);

  function ler() {
    const r = {};
    if (alarmeSel?.value) r.alarme = alarmeSel.value === "true";
    if (entre.input.checked) r.entre = [hhmm(de.value), hhmm(ate.value)];
    if (diasOn.input.checked) r.dias = dias.lidos().map(Number);
    if (sol.value) r.sol = sol.value;
    const m = modos.lidos();
    if (m.length) r.modo = m;
    if (presenca.value) r.presenca = presenca.value;
    if (linhas.length) r.aparelhos = linhas.map((l) => l.ler());
    return r;
  }
  return { raiz, ler };
}

// ---------- Ações ----------
const TIPOS_ACAO = [
  { valor: "ligar", texto: "Ligar" },
  { valor: "desligar", texto: "Desligar" },
  { valor: "estore", texto: "Mover estore" },
  { valor: "notificar", texto: "Enviar notificação" },
  { valor: "luz", texto: "Luz com brilho", grupo: "Mais" },
  { valor: "alternar", texto: "Alternar (liga ↔ desliga)", grupo: "Mais" },
  { valor: "modo", texto: "Mudar o modo da casa", grupo: "Mais" },
  { valor: "cena", texto: "Executar uma cena", grupo: "Mais" },
  { valor: "esperar", texto: "Esperar", grupo: "Mais" },
  { valor: "se", texto: "SE… ENTÃO… SENÃO…", grupo: "Mais" },
];

/**
 * Contexto partilhado por todas as linhas de um formulário:
 * { aparelhos, cenas, cena: bool (editor de cenas: sem se/cena), max, total(): n, atualizar() }
 */
export function criarContexto({ aparelhos, cenas = [], cena = false, max = E.MAX_ACOES }) {
  // botoesMais: todos os "Acrescentar…" deste formulário (o contexto morre com o formulário).
  const ctx = { aparelhos, cenas, cena, max, botoesMais: new Set(), raizes: [] };
  ctx.total = () => ctx.raizes.reduce((n, r) => n + r.contar(), 0);
  ctx.atualizar = () => {
    const cheio = ctx.total() >= ctx.max;
    for (const b of ctx.botoesMais) b.disabled = cheio;
  };
  return ctx;
}

export function linhaAcao(x, ctx, { nivel = 0, rotulo = "Ação", aoRemover = null } = {}) {
  x = x ?? { acao: "ligar" };
  const raiz = el("div", "acao");
  raiz.dataset.nivel = String(nivel);
  const topo = el("div", "acao-topo");
  const n = el("span", "acao-n", rotulo);
  topo.append(n);
  const remover = botao("Remover", "btn sec pequeno remover", () => aoRemover?.());
  remover.disabled = !aoRemover;
  topo.append(remover);
  raiz.append(topo);

  const tipos = TIPOS_ACAO.filter((t) => !(ctx.cena && (t.valor === "se" || t.valor === "cena")) && !(t.valor === "se" && nivel >= E.MAX_NIVEIS_SE));
  const acao = select("acao", tipos, x.acao ?? "ligar");
  raiz.append(campo("O que fazer", acao));

  const circuitos = opcoesCanais(ctx.aparelhos, ["interruptor", "luz"]);
  const luzes = opcoesCanais(ctx.aparelhos, ["luz"]);
  const estores = opcoesCanais(ctx.aparelhos, ["estore"]);
  const alvo = x.aparelho != null ? `${x.aparelho}:${x.canal}` : null;
  const paineis = {};

  // ligar / desligar
  const circ = select("acao-circuito", circuitos, (x.acao === "ligar" || x.acao === "desligar") && alvo ? alvo : circuitos[0]?.valor);
  const durante = input("acao-durante", "number", x.durante_s ? +(x.durante_s / 60).toFixed(2) : "", { min: "0", step: "any", inputmode: "decimal", placeholder: "sempre" });
  const aviso = el("small", "ajuda aviso-perigosa", "Carga perigosa: indique a duração (máximo 4 h = 240 min).");
  paineis.circ = el("div");
  const duasC = el("div", "duas");
  duasC.append(campo("Circuito", circ), campo("Durante (minutos, opcional)", durante));
  paineis.circ.append(duasC, aviso);
  const verPerigosa = () => { aviso.hidden = !(acao.value === "ligar" && circuitos.find((o) => o.valor === circ.value)?.carga === "perigosa"); };
  circ.addEventListener("change", verPerigosa);

  // luz com brilho
  paineis.luz = el("div", "duas");
  const luzSel = select("acao-luz", luzes, x.acao === "luz" && alvo ? alvo : luzes[0]?.valor);
  const brilho = input("acao-brilho", "number", x.brilho ?? 50, { min: "0", max: "100", step: "1", inputmode: "numeric" });
  paineis.luz.append(campo("Luz", luzSel), campo("Brilho (%)", brilho));
  if (!luzes.length) paineis.luz.append(el("small", "ajuda", "Não tem luzes com brilho."));

  // alternar
  paineis.alternar = el("div");
  const altSel = select("acao-alternar", circuitos, x.acao === "alternar" && alvo ? alvo : circuitos[0]?.valor);
  paineis.alternar.append(campo("Circuito", altSel));

  // estore
  paineis.estore = el("div", "duas");
  const estSel = select("acao-estore", estores, x.acao === "estore" && alvo ? alvo : estores[0]?.valor);
  const posicao = input("acao-posicao", "number", x.posicao ?? 100, { min: "0", max: "100", step: "1", inputmode: "numeric" });
  paineis.estore.append(campo("Estore", estSel), campo("Posição (0 fechado – 100 aberto)", posicao));

  // notificar
  paineis.notificar = el("div");
  const mensagem = input("acao-mensagem", "text", x.mensagem ?? "", { maxlength: "200" });
  paineis.notificar.append(campo("Mensagem", mensagem));

  // esperar
  paineis.esperar = el("div");
  const espera = input("acao-esperar", "number", x.s ?? 60, { min: "1", max: "3600", step: "1", inputmode: "numeric" });
  paineis.esperar.append(campo("Esperar (segundos, 1 a 3600)", espera, "As ações seguintes só acontecem depois desta espera."));

  // modo
  paineis.modo = el("div");
  const modoSel = select("acao-modo", OPCOES_MODO.map(([v, t]) => ({ valor: v, texto: t })), x.modo ?? "casa");
  const forcar = caixa("acao-forcar", "Armar mesmo com portas ou janelas abertas", x.forcar === true);
  paineis.modo.append(campo("Modo", modoSel), forcar.label);
  const verForcar = () => { forcar.label.hidden = modoSel.value === "casa"; };
  modoSel.addEventListener("change", verForcar);
  verForcar();

  // cena
  paineis.cena = el("div");
  const cenaSel = select("acao-cena", ctx.cenas.map((c) => ({ valor: c.id, texto: String(c.nome ?? c.id) })), x.cena ?? ctx.cenas[0]?.id);
  paineis.cena.append(campo("Cena", cenaSel));
  if (!ctx.cenas.length) paineis.cena.append(el("small", "ajuda", "Ainda não tem cenas. Crie-as no separador Casa."));

  // se … então … senão
  let se = null;
  if (tipos.some((t) => t.valor === "se")) {
    paineis.se = el("div", "acao-se");
    const cond = editorCondicoes(x.acao === "se" ? x.condicao : {}, { aparelhos: ctx.aparelhos, prefixo: "cond", alarme: true });
    const blocoCond = el("div", "bloco-se");
    blocoCond.append(el("b", "rotulo-se", "SE"), cond.raiz);
    const entao = listaAcoes(x.acao === "se" ? x.entao ?? [] : [], ctx, { nivel: nivel + 1, rotulo: "Então", minimo: 0, textoMais: "Acrescentar ao ENTÃO" });
    const senao = listaAcoes(x.acao === "se" ? x.senao ?? [] : [], ctx, { nivel: nivel + 1, rotulo: "Senão", minimo: 0, textoMais: "Acrescentar ao SENÃO" });
    const blocoE = el("div", "bloco-se");
    blocoE.append(el("b", "rotulo-se", "ENTÃO"), entao.raiz);
    const blocoS = el("div", "bloco-se");
    blocoS.append(el("b", "rotulo-se", "SENÃO (opcional)"), senao.raiz);
    paineis.se.append(blocoCond, blocoE, blocoS);
    se = { cond, entao, senao };
  }

  for (const p of Object.values(paineis)) raiz.append(p);
  const mostrar = () => {
    const v = acao.value;
    paineis.circ.hidden = v !== "ligar" && v !== "desligar";
    for (const k of ["luz", "alternar", "estore", "notificar", "esperar", "modo", "cena", "se"]) if (paineis[k]) paineis[k].hidden = v !== k;
    verPerigosa();
    ctx.atualizar();
  };
  acao.addEventListener("change", mostrar);
  mostrar();

  function ler() {
    const v = acao.value;
    if (v === "ligar" || v === "desligar") {
      const r = { acao: v, ...separar(circ.value) };
      const min = parseFloat(String(durante.value ?? "").replace(",", "."));
      if (Number.isFinite(min) && min > 0) r.durante_s = Math.round(min * 60);
      return r;
    }
    if (v === "luz") return { acao: v, ...separar(luzSel.value), brilho: inteiro(brilho.value) };
    if (v === "alternar") return { acao: v, ...separar(altSel.value) };
    if (v === "estore") return { acao: v, ...separar(estSel.value), posicao: Math.round(Number(posicao.value)) };
    if (v === "esperar") return { acao: v, s: inteiro(espera.value) };
    if (v === "modo") return modoSel.value === "casa" ? { acao: v, modo: "casa" } : { acao: v, modo: modoSel.value, forcar: forcar.input.checked };
    if (v === "cena") return { acao: v, cena: cenaSel.value || null };
    if (v === "se") {
      const r = { acao: "se", condicao: se.cond.ler(), entao: se.entao.ler() };
      const s = se.senao.ler();
      if (s.length) r.senao = s;
      return r;
    }
    return { acao: "notificar", mensagem: String(mensagem.value ?? "").trim() };
  }
  const contar = () => 1 + (acao.value === "se" && se ? se.entao.contar() + se.senao.contar() : 0);
  return { raiz, ler, contar, n, remover };
}

// Lista de ações com "Acrescentar ação". `inicio` = número da primeira (o passo 5 começa no 2).
export function listaAcoes(acoes, ctx, { nivel = 0, rotulo = "Ação", inicio = 1, minimo = 1, textoMais = "Acrescentar ação" } = {}) {
  const raiz = el("div", "lista-acoes");
  const caixaLinhas = el("div", "linhas-acoes");
  const linhas = [];
  const renumerar = () => {
    linhas.forEach((l, i) => {
      l.n.textContent = `${rotulo} ${i + inicio}`;
      l.remover.disabled = linhas.length <= minimo;
    });
    ctx.atualizar();
  };
  const nova = (x) => {
    const obj = linhaAcao(x, ctx, { nivel, rotulo, aoRemover: () => { obj.raiz.remove(); linhas.splice(linhas.indexOf(obj), 1); renumerar(); } });
    linhas.push(obj);
    caixaLinhas.append(obj.raiz);
    renumerar();
    return obj;
  };
  for (const x of acoes) nova(x);
  while (linhas.length < minimo) nova({ acao: "ligar" });
  const mais = botao(textoMais, "btn sec pequeno mais-acoes", () => { if (ctx.total() < ctx.max) nova({ acao: "ligar" }); });
  ctx.botoesMais.add(mais);
  raiz.append(caixaLinhas, mais);
  const api = { raiz, ler: () => linhas.map((l) => l.ler()), contar: () => linhas.reduce((n, l) => n + l.contar(), 0), linhas, mais };
  ctx.atualizar();
  return api;
}
