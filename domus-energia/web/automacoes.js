// Separador "Automações": lista retida `_automacoes`, ativar/desativar, criar, editar e apagar.
// Guardar publica a LISTA COMPLETA em `_automacoes/set`; o motor valida e volta a publicar
// `_automacoes` (sucesso) ou um evento `erro` em `_eventos` (a lista não muda).
import * as E from "./estado.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const TEMPO_MOTOR = 10_000;
const MAX_AUTOMACOES = 50;
const MAX_ACOES = 10;
const DIAS = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]];

const ICONE_CADEADO = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const r = document.createElementNS(ns, "rect");
  Object.entries({ x: "3", y: "7", width: "10", height: "7", rx: "2" }).forEach(([k, v]) => r.setAttribute(k, v));
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", "M5.5 7V5a2.5 2.5 0 0 1 5 0v2");
  svg.append(r, p);
  return svg;
};

export function criarAutomacoes({ publicar, ligado, aparelhos }) {
  let lista = null;          // última lista retida (null = ainda não chegou)
  let textoAtual = null;     // JSON dessa lista, para detetar mudanças
  let guardando = null;      // { anterior, timer, aoTerminar }
  let aEditar = null;        // null | { original: automação | null }
  let aApagar = null;        // id com confirmação aberta
  let msgTimer = null;

  // ---------- estado / mensagens ----------
  function estado(texto, tipo = "info") {
    clearTimeout(msgTimer);
    const m = $("auto-estado");
    m.hidden = !texto;
    m.textContent = texto ?? "";
    m.className = `msg ${tipo}`;
    if (tipo === "ok") msgTimer = setTimeout(() => { m.hidden = true; }, 4000);
  }

  function guardar(nova, aoTerminar) {
    if (guardando) return;
    if (!ligado()) { estado("Sem ligação ao servidor. Tente de novo daqui a pouco.", "erro"); return; }
    if (JSON.stringify(nova) === JSON.stringify(lista ?? [])) { estado("Sem alterações.", "ok"); aoTerminar?.(); return; }
    guardando = {
      anterior: textoAtual,
      aoTerminar,
      timer: setTimeout(() => {
        guardando = null;
        estado("O servidor não respondeu. As alterações não foram guardadas; tente de novo.", "erro");
        desenhar();
      }, TEMPO_MOTOR),
    };
    publicar("_automacoes/set", nova);
    estado("A guardar…", "info");
    desenhar();
  }

  function receberLista(nova, texto) {
    lista = nova ?? [];
    const mudou = texto !== textoAtual;
    textoAtual = texto;
    if (guardando && (mudou || texto !== guardando.anterior)) {
      clearTimeout(guardando.timer);
      const cb = guardando.aoTerminar;
      guardando = null;
      estado("Guardado.", "ok");
      cb?.();
    }
    desenhar();
  }

  function receberErro(ev) {
    if (!guardando) return;
    clearTimeout(guardando.timer);
    guardando = null;
    estado(ev.mensagem || ev.titulo || "O servidor recusou a automação.", "erro");
    desenhar();
  }

  function limpar() {
    clearTimeout(guardando?.timer);
    clearTimeout(msgTimer);
    lista = null;
    textoAtual = null;
    guardando = null;
    aEditar = null;
    aApagar = null;
    const caixa = $("form-automacao-caixa");
    if (caixa) caixa.replaceChildren();
    const l = $("lista-automacoes");
    if (l) l.replaceChildren();
    const m = $("auto-estado");
    if (m) m.hidden = true;
  }

  // ---------- lista ----------
  function desenhar() {
    const l = $("lista-automacoes");
    l.replaceChildren();
    $("nova-automacao").disabled = !!guardando || !!aEditar || lista == null || lista.length >= MAX_AUTOMACOES;
    const formBotao = document.querySelector("#form-automacao button[type=submit]");
    if (formBotao) { formBotao.disabled = !!guardando; formBotao.textContent = guardando ? "A guardar…" : "Guardar"; }

    if (lista == null) { l.append(el("p", "vazio", "A carregar automações…")); return; }
    if (lista.length === 0) { l.append(el("p", "vazio", "Ainda não tem automações. Crie a primeira com \"Nova automação\".")); return; }
    for (const a of lista) {
      const cartao = el("article", `cartao automacao${a.ativa === false ? " inativa" : ""}${a.bloqueada ? " bloqueada" : ""}`);
      cartao.dataset.id = a.id;
      const topo = el("div", "automacao-topo");
      topo.append(el("b", null, String(a.nome ?? a.id)));
      const sw = el("label", "interruptor");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = a.ativa !== false;
      input.disabled = !!guardando;
      input.setAttribute("aria-label", `Automação ${a.nome ?? a.id} ativa`);
      input.addEventListener("change", () => {
        const nova = lista.map((x) => (x.id === a.id ? { ...x, ativa: input.checked } : x));
        guardar(nova);
      });
      sw.append(input, document.createElement("span"));
      topo.append(sw);
      cartao.append(topo);
      cartao.append(el("p", "descricao", E.descreverAutomacao(a, aparelhos())));
      if (a.bloqueada) {
        const c = el("span", "cadeado");
        c.append(ICONE_CADEADO(), document.createTextNode("Criada pela Domus Energia"));
        cartao.append(c);
      } else if (aApagar === a.id) {
        const conf = el("div", "confirmar");
        conf.append(el("p", null, `Apagar a automação "${a.nome ?? a.id}"?`));
        const b = el("div", "botoes");
        const sim = el("button", "btn perigo pequeno", "Sim, apagar");
        sim.type = "button";
        sim.disabled = !!guardando;
        sim.addEventListener("click", () => { aApagar = null; guardar(lista.filter((x) => x.id !== a.id)); });
        const nao = el("button", "btn sec pequeno", "Cancelar");
        nao.type = "button";
        nao.addEventListener("click", () => { aApagar = null; desenhar(); });
        b.append(sim, nao);
        conf.append(b);
        cartao.append(conf);
      } else {
        const b = el("div", "botoes");
        const editar = el("button", "btn sec pequeno", "Editar");
        editar.type = "button";
        editar.disabled = !!guardando || !!aEditar;
        editar.addEventListener("click", () => abrirForm(a));
        const apagar = el("button", "btn sec pequeno", "Apagar");
        apagar.type = "button";
        apagar.disabled = !!guardando || !!aEditar;
        apagar.addEventListener("click", () => { aApagar = a.id; desenhar(); });
        b.append(editar, apagar);
        cartao.append(b);
      }
      l.append(cartao);
    }
  }

  $("nova-automacao").addEventListener("click", () => abrirForm(null));

  // ---------- formulário ----------
  const opcoesCanais = (funcoes) => {
    const r = [];
    for (const a of aparelhos()) for (const c of a.canais) {
      if (!funcoes.includes(c.funcao)) continue;
      const nome = c.temNome && a.canais.length > 1 ? `${a.nome} · ${c.nome}` : c.temNome ? c.nome : a.nome;
      r.push({ valor: `${a.id}:${c.n}`, texto: nome, funcao: c.funcao });
    }
    return r;
  };
  const opcoesMedidores = () => aparelhos().filter((a) => a.medidor || a.v1).map((a) => ({ valor: a.id, texto: a.nome }));

  function select(nome, opcoes, valor) {
    const s = document.createElement("select");
    s.name = nome;
    for (const o of opcoes) {
      const op = el("option", null, o.texto);
      op.value = o.valor;
      s.append(op);
    }
    if (valor != null && !opcoes.some((o) => o.valor === valor)) {
      const op = el("option", null, `${valor} (desconhecido)`);
      op.value = valor;
      s.append(op);
    }
    if (valor != null) s.value = valor;
    return s;
  }
  function campo(rotulo, controlo) {
    const l = el("label", null, rotulo);
    l.append(controlo);
    return l;
  }
  function input(nome, tipo, valor, extra = {}) {
    const i = document.createElement("input");
    i.name = nome;
    i.type = tipo;
    if (valor != null) i.value = String(valor);
    Object.entries(extra).forEach(([k, v]) => i.setAttribute(k, v));
    return i;
  }

  function abrirForm(original) {
    aEditar = { original };
    aApagar = null;
    estado(null);
    const caixa = $("form-automacao-caixa");
    caixa.replaceChildren();
    const a = original ?? { ativa: true, quando: { tipo: "sensor" }, entao: [{ acao: "ligar" }] };

    const form = el("form", "cartao form-automacao");
    form.id = "form-automacao";
    form.noValidate = true;
    form.append(el("h3", null, original ? "Editar automação" : "Nova automação"));
    form.append(campo("Nome", input("nome", "text", a.nome ?? "", { maxlength: "60", required: "", autocomplete: "off" })));
    const ativa = el("label", "caixa");
    const ativaI = input("ativa", "checkbox");
    ativaI.checked = a.ativa !== false;
    ativa.append(ativaI, document.createTextNode("Ativa"));
    form.append(ativa);

    // Quando
    const fsQuando = el("fieldset");
    fsQuando.append(el("legend", null, "Quando"));
    const q = a.quando ?? {};
    const tipo = select("quando-tipo", [
      { valor: "sensor", texto: "Um sensor muda" },
      { valor: "hora", texto: "A uma hora certa" },
      { valor: "potencia", texto: "O consumo passa um limite" },
    ], q.tipo ?? "sensor");
    fsQuando.append(campo("Dispara quando", tipo));

    const sensores = opcoesCanais(["porta", "movimento"]);
    const pSensor = el("div");
    const sensorSel = select("quando-sensor", sensores, q.tipo === "sensor" && q.aparelho ? `${q.aparelho}:${q.canal}` : sensores[0]?.valor);
    const valorSel = document.createElement("select");
    valorSel.name = "quando-valor";
    const atualizarValores = () => {
      const f = sensores.find((s) => s.valor === sensorSel.value)?.funcao;
      const atual = valorSel.value || (q.tipo === "sensor" && q.valor != null ? String(q.valor) : "1");
      valorSel.replaceChildren();
      const ops = f === "porta" ? [["1", "Abre"], ["0", "Fecha"]] : f === "movimento" ? [["1", "Deteta movimento"], ["0", "Deixa de detetar movimento"]] : [["1", "Fica ativo"], ["0", "Fica inativo"]];
      for (const [v, t] of ops) { const o = el("option", null, t); o.value = v; valorSel.append(o); }
      valorSel.value = atual;
    };
    sensorSel.addEventListener("change", atualizarValores);
    atualizarValores();
    pSensor.className = "duas";
    pSensor.append(campo("Sensor", sensorSel), campo("E", valorSel));

    const pHora = el("div");
    pHora.style.display = "grid";
    pHora.style.gap = "12px";
    pHora.append(campo("Hora", input("quando-hora", "time", q.tipo === "hora" ? q.hora : "08:00")));
    const dias = el("div", "dias");
    dias.setAttribute("role", "group");
    dias.setAttribute("aria-label", "Dias da semana");
    const diasAtivos = q.tipo === "hora" && Array.isArray(q.dias) ? q.dias : [1, 2, 3, 4, 5, 6, 7];
    for (const [n, t] of DIAS) {
      const l = el("label");
      const c = input("quando-dia", "checkbox", n);
      c.checked = diasAtivos.includes(n);
      l.append(c, document.createTextNode(t));
      dias.append(l);
    }
    pHora.append(dias);

    const pPot = el("div");
    pPot.style.display = "grid";
    pPot.style.gap = "12px";
    const medidores = opcoesMedidores();
    pPot.append(campo("Medidor", select("quando-medidor", medidores, q.tipo === "potencia" ? q.aparelho : medidores[0]?.valor)));
    const duasPot = el("div", "duas");
    duasPot.append(
      campo("Acima de (W)", input("quando-acima", "number", q.tipo === "potencia" ? q.acima_w : 3500, { min: "1", step: "1", inputmode: "numeric" })),
      campo("Durante (segundos)", input("quando-durante", "number", q.tipo === "potencia" ? q.durante_s : 60, { min: "0", step: "1", inputmode: "numeric" })),
    );
    pPot.append(duasPot);
    fsQuando.append(pSensor, pHora, pPot);
    const mostrarQuando = () => {
      pSensor.hidden = tipo.value !== "sensor";
      pHora.hidden = tipo.value !== "hora";
      pPot.hidden = tipo.value !== "potencia";
    };
    tipo.addEventListener("change", mostrarQuando);
    mostrarQuando();
    form.append(fsQuando);

    // Se
    const fsSe = el("fieldset");
    fsSe.append(el("legend", null, "Só se (opcional)"));
    const se = a.se ?? {};
    fsSe.append(campo("Alarme", select("se-alarme", [
      { valor: "", texto: "Tanto faz" },
      { valor: "true", texto: "Só com o alarme ativo" },
      { valor: "false", texto: "Só com o alarme desligado" },
    ], se.alarme === true ? "true" : se.alarme === false ? "false" : "")));
    const entreL = el("label", "caixa");
    const entreC = input("se-entre", "checkbox");
    entreC.checked = Array.isArray(se.entre);
    entreL.append(entreC, document.createTextNode("Só num horário"));
    const horario = el("div", "horario");
    horario.append(
      campo("Das", input("se-de", "time", se.entre?.[0] ?? "19:00")),
      campo("Às", input("se-ate", "time", se.entre?.[1] ?? "07:00")),
    );
    const mostrarHorario = () => { horario.hidden = !entreC.checked; };
    entreC.addEventListener("change", mostrarHorario);
    mostrarHorario();
    fsSe.append(entreL, horario);
    form.append(fsSe);

    // Então
    const fsEntao = el("fieldset");
    fsEntao.append(el("legend", null, "Então"));
    const acoes = el("div");
    acoes.style.display = "grid";
    acoes.style.gap = "10px";
    const mais = el("button", "btn sec pequeno", "Acrescentar ação");
    mais.type = "button";
    const renumerar = () => {
      const linhas = [...acoes.children];
      linhas.forEach((l, i) => {
        l.querySelector(".acao-n").textContent = `Ação ${i + 1}`;
        l.querySelector(".remover").disabled = linhas.length <= 1;
      });
      mais.disabled = linhas.length >= MAX_ACOES;
    };
    const novaAcao = (x) => {
      const linha = el("div", "acao");
      const topo = el("div", "acao-topo");
      topo.append(el("span", "acao-n"));
      const remover = el("button", "btn sec pequeno remover", "Remover");
      remover.type = "button";
      remover.addEventListener("click", () => { linha.remove(); renumerar(); });
      topo.append(remover);
      linha.append(topo);
      const acao = select("acao", [
        { valor: "ligar", texto: "Ligar" },
        { valor: "desligar", texto: "Desligar" },
        { valor: "estore", texto: "Mover estore" },
        { valor: "notificar", texto: "Enviar notificação" },
      ], x.acao ?? "ligar");
      linha.append(campo("O que fazer", acao));
      const circuitos = opcoesCanais(["interruptor", "luz"]);
      const estores = opcoesCanais(["estore"]);
      const alvo = (x.aparelho != null ? `${x.aparelho}:${x.canal}` : null);
      const pCirc = el("div", "duas");
      pCirc.append(
        campo("Circuito", select("acao-circuito", circuitos, (x.acao === "ligar" || x.acao === "desligar") && alvo ? alvo : circuitos[0]?.valor)),
        campo("Durante (minutos, opcional)", input("acao-durante", "number", x.durante_s ? +(x.durante_s / 60).toFixed(2) : "", { min: "0", step: "any", inputmode: "decimal", placeholder: "sempre" })),
      );
      const pEst = el("div", "duas");
      pEst.append(
        campo("Estore", select("acao-estore", estores, x.acao === "estore" && alvo ? alvo : estores[0]?.valor)),
        campo("Posição (0 fechado – 100 aberto)", input("acao-posicao", "number", x.posicao ?? 100, { min: "0", max: "100", step: "1", inputmode: "numeric" })),
      );
      const pNot = el("div");
      pNot.append(campo("Mensagem", input("acao-mensagem", "text", x.mensagem ?? "", { maxlength: "200" })));
      linha.append(pCirc, pEst, pNot);
      const mostrar = () => {
        pCirc.hidden = acao.value !== "ligar" && acao.value !== "desligar";
        pEst.hidden = acao.value !== "estore";
        pNot.hidden = acao.value !== "notificar";
      };
      acao.addEventListener("change", mostrar);
      mostrar();
      acoes.append(linha);
      renumerar();
    };
    for (const x of (a.entao?.length ? a.entao : [{ acao: "ligar" }]).slice(0, MAX_ACOES)) novaAcao(x);
    mais.addEventListener("click", () => { if (acoes.children.length < MAX_ACOES) novaAcao({ acao: "ligar" }); });
    fsEntao.append(acoes, mais);
    form.append(fsEntao);

    const erro = el("div", "msg erro");
    erro.id = "auto-form-erro";
    erro.setAttribute("role", "alert");
    erro.hidden = true;
    form.append(erro);
    const botoes = el("div", "form-botoes");
    const ok = el("button", "btn", "Guardar");
    ok.type = "submit";
    const cancelar = el("button", "btn sec", "Cancelar");
    cancelar.type = "button";
    cancelar.addEventListener("click", fecharForm);
    botoes.append(ok, cancelar);
    form.append(botoes);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardando) return;
      const auto = lerForm(form, original);
      const erros = E.validarAutomacao(auto);
      if (!original && lista && lista.length >= MAX_AUTOMACOES) erros.push(`Máximo de ${MAX_AUTOMACOES} automações.`);
      erro.hidden = erros.length === 0;
      erro.replaceChildren();
      for (const t of erros) erro.append(el("div", null, t));
      if (erros.length) return;
      const atual = lista ?? [];
      const nova = original ? atual.map((x) => (x.id === original.id ? auto : x)) : [...atual, auto];
      guardar(nova, fecharForm);
    });

    caixa.append(form);
    desenhar();
    form.elements.nome.focus();
  }

  function fecharForm() {
    aEditar = null;
    $("form-automacao-caixa").replaceChildren();
    desenhar();
  }

  const separar = (v) => { const [id, n] = String(v ?? "").split(":"); return { aparelho: id || null, canal: n ? parseInt(n, 10) : null }; };
  const hhmm = (v) => String(v ?? "").slice(0, 5);

  function lerForm(form, original) {
    const f = form.elements;
    const nome = f.nome.value.trim();
    const ids = (lista ?? []).map((x) => x.id);
    const id = original ? original.id : E.slug(nome, ids);
    const tipo = f["quando-tipo"].value;
    let quando;
    if (tipo === "sensor") {
      const s = separar(f["quando-sensor"]?.value);
      quando = { tipo: "sensor", aparelho: s.aparelho, canal: s.canal, valor: Number(f["quando-valor"].value) };
    } else if (tipo === "hora") {
      const dias = [...form.querySelectorAll("input[name=quando-dia]:checked")].map((c) => Number(c.value));
      quando = { tipo: "hora", hora: hhmm(f["quando-hora"].value), dias };
    } else {
      quando = { tipo: "potencia", aparelho: f["quando-medidor"]?.value || null, acima_w: Number(f["quando-acima"].value), durante_s: Math.round(Number(f["quando-durante"].value)) };
    }
    const se = {};
    if (f["se-alarme"].value) se.alarme = f["se-alarme"].value === "true";
    if (f["se-entre"].checked) se.entre = [hhmm(f["se-de"].value), hhmm(f["se-ate"].value)];
    const entao = [...form.querySelectorAll(".acao")].map((linha) => {
      const v = (n) => linha.querySelector(`[name=${n}]`)?.value;
      const acao = v("acao");
      if (acao === "ligar" || acao === "desligar") {
        const s = separar(v("acao-circuito"));
        const x = { acao, aparelho: s.aparelho, canal: s.canal };
        const min = parseFloat(String(v("acao-durante") ?? "").replace(",", "."));
        if (Number.isFinite(min) && min > 0) x.durante_s = Math.round(min * 60);
        return x;
      }
      if (acao === "estore") {
        const s = separar(v("acao-estore"));
        return { acao, aparelho: s.aparelho, canal: s.canal, posicao: Math.round(Number(v("acao-posicao"))) };
      }
      return { acao: "notificar", mensagem: String(v("acao-mensagem") ?? "").trim() };
    });
    const auto = { id, nome, ativa: f.ativa.checked, bloqueada: false, quando };
    if (Object.keys(se).length) auto.se = se;
    auto.entao = entao;
    return auto;
  }

  return { desenhar, receberLista, receberErro, limpar };
}
