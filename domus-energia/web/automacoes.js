// Separador "Automações": lista retida `_automacoes`, ativar/desativar, assistente de criação
// em 5 passos (guia da Vesternet, docs/AUTOMACOES-v3.md §4), modelos prontos, registo,
// "Testar agora" / "Avaliar agora" / "Executar" e avisos de conflito (PROTOCOLO-MQTT-v3.md §8).
// Guardar publica a LISTA COMPLETA em `_automacoes/set`; o motor valida e volta a publicar
// `_automacoes` (sucesso) ou um evento `erro` em `_eventos` (a lista não muda).
import * as E from "./estado.js";
import { el, botao, select, campo, input, caixa, chips, separar, hhmm, opcoesCanais, GRUPOS_SENSOR, DIAS, OPCOES_MODO, editorCondicoes, criarContexto, linhaAcao, listaAcoes, marcarVazios, painelRisco } from "./editor.js";
import { MODELOS, aplicarModelo } from "./modelos.js";

const $ = (id) => document.getElementById(id);
const TEMPO_MOTOR = 10_000;
const MAX_AUTOMACOES = 50;

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
export { ICONE_CADEADO };

const PASSOS = ["Objetivo", "Gatilho", "Ação", "Condições", "Vários aparelhos"];

export function criarAutomacoes({ publicar, ligado, aparelhos, cenas = () => [], config = () => null }) {
  let lista = null;          // última lista retida (null = ainda não chegou)
  let textoAtual = null;     // JSON dessa lista, para detetar mudanças
  let guardando = null;      // { anterior, timer, aoTerminar }
  let aEditar = null;        // null | { original: automação | null }
  let aApagar = null;        // id com confirmação aberta
  let aConfirmar = null;     // { id, tipo } — Executar/Testar à espera de "Sim" (ações arriscadas)
  let msgTimer = null;
  let registo = {};          // lerRegisto(_automacoes/registo)
  let avisos = [];           // lerAvisos(_automacoes/avisos)
  const pedidos = {};        // id → { tipo, antes, timer, texto, classe }

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
    if (E.jsonCanonico(nova) === E.jsonCanonico(lista ?? [])) { estado("Sem alterações.", "ok"); aoTerminar?.(); return; }
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
    textoAtual = texto;
    // Qualquer `_automacoes` que chegue depois de publicarmos é a resposta do motor — mesmo que o
    // texto seja igual ao anterior (ex.: guardar sem mudanças reais depois de o motor normalizar).
    if (guardando) {
      clearTimeout(guardando.timer);
      const cb = guardando.aoTerminar;
      guardando = null;
      estado("Guardado.", "ok");
      cb?.();
    }
    desenhar();
  }

  // Devolve true se o erro era para nós.
  function receberErro(ev) {
    // Erros de executar / testar / avaliar (motor: "Automação não executada") vão para o cartão
    // do pedido mais recente em curso, em vez de esperar 10 s por um "não respondeu".
    if (/^Automação não executada/i.test(ev.titulo ?? "")) {
      const emCurso = Object.values(pedidos).filter((p) => p.timer).sort((x, y) => y.desde - x.desde)[0];
      if (emCurso) {
        clearTimeout(emCurso.timer);
        emCurso.timer = null;
        emCurso.texto = ev.mensagem || "O servidor não executou o pedido.";
        emCurso.classe = "erro";
        desenharSeLivre();
        return true;
      }
    }
    if (!guardando) return false;
    clearTimeout(guardando.timer);
    guardando = null;
    estado(ev.mensagem || ev.titulo || "O servidor recusou a automação.", "erro");
    desenhar();
    return true;
  }

  function receberRegisto(r) {
    registo = r ?? {};
    for (const [id, p] of Object.entries(pedidos)) {
      if (!p.timer) continue;
      const agora = registo[id];
      if (JSON.stringify(agora ?? null) === p.antes) continue;
      clearTimeout(p.timer);
      p.timer = null;
      if (p.tipo === "avaliar") {
        const av = agora?.avaliacao;
        if (av?.verdadeira === true) { p.texto = `Neste momento a automação executaria. ${av.motivo || "As condições são verdadeiras."}`; p.classe = "ok"; }
        else if (av?.verdadeira === false) { p.texto = `Neste momento não executaria: ${av.motivo || "uma condição é falsa."}`; p.classe = "info"; }
        else { p.texto = av?.motivo || "Avaliação recebida."; p.classe = "info"; }
      } else {
        const res = E.RESULTADOS[agora?.resultado] ?? agora?.resultado ?? "";
        // "Teste feito: Teste — …" repetia a palavra; quando o resultado é o próprio teste basta o motivo.
        const mostrarRes = !((p.tipo === "testar" && agora?.resultado === "teste") || (p.tipo === "executar" && agora?.resultado === "executada"));
        p.texto = `${p.tipo === "testar" ? "Teste feito" : "Executada"}${mostrarRes ? `: ${res}` : ""}${agora?.motivo ? ` — ${agora.motivo}` : ""}`;
        p.classe = agora?.resultado === "falhou" ? "erro" : "ok";
      }
    }
    desenharSeLivre();
  }
  function receberAvisos(a) { avisos = a ?? []; desenharSeLivre(); }
  // Não redesenhar a lista enquanto há uma confirmação de apagar aberta? Pode — é estado nosso.
  function desenharSeLivre() { if (lista != null) desenhar(); }

  function pedirExecutar(id, tipo) {
    if (!ligado()) { estado("Sem ligação ao servidor. Tente de novo daqui a pouco.", "erro"); return false; }
    clearTimeout(pedidos[id]?.timer);
    const p = { tipo, desde: Date.now(), antes: JSON.stringify(registo[id] ?? null), texto: tipo === "avaliar" ? "A avaliar…" : tipo === "testar" ? "A testar…" : "A executar…", classe: "info" };
    p.timer = setTimeout(() => { p.timer = null; p.texto = "O servidor não respondeu. Tente de novo."; p.classe = "erro"; desenharSeLivre(); }, TEMPO_MOTOR);
    pedidos[id] = p;
    const corpo = tipo === "testar" ? { id, testar: true, por: "web" } : tipo === "avaliar" ? { id, avaliar: true, por: "web" } : { id, por: "web" };
    publicar("_automacoes/executar", corpo);
    desenharSeLivre();
    return true;
  }

  // Executar e Testar agora mexem nos aparelhos: se a automação desliga o quadro geral ou liga
  // uma carga perigosa, pede-se confirmação no cartão. Avaliar agora não age — nunca pergunta.
  function executarComConfirmacao(id, tipo) {
    const a = (lista ?? []).find((x) => x.id === id);
    if (tipo !== "avaliar" && a && E.acoesArriscadas(a.entao, aparelhos(), { cenas: cenas() }).length) {
      aConfirmar = { id, tipo };
      aApagar = null;
      desenhar();
      document.querySelector(`.automacao[data-id="${CSS.escape(id)}"] .confirmar-risco .confirmar-titulo`)?.focus();
      return false;
    }
    return pedirExecutar(id, tipo);
  }

  function limpar() {
    aConfirmar = null;
    clearTimeout(guardando?.timer);
    clearTimeout(msgTimer);
    for (const p of Object.values(pedidos)) clearTimeout(p.timer);
    for (const k of Object.keys(pedidos)) delete pedidos[k];
    lista = null;
    textoAtual = null;
    guardando = null;
    aEditar = null;
    aApagar = null;
    registo = {};
    avisos = [];
    const caixaF = $("form-automacao-caixa");
    if (caixaF) caixaF.replaceChildren();
    const l = $("lista-automacoes");
    if (l) l.replaceChildren();
    const m = $("auto-estado");
    if (m) m.hidden = true;
    const av = $("auto-avisos");
    if (av) av.replaceChildren();
  }

  // ---------- lista ----------
  function linhaRegisto(a) {
    const r = registo[a.id];
    const caixaR = el("div", "registo");
    const agora = Date.now();
    if (!r || r.ultima == null) {
      caixaR.append(el("span", "registo-linha", "Nunca disparou."));
    } else {
      const res = E.RESULTADOS[r.resultado] ?? r.resultado ?? "";
      const linha = el("span", `registo-linha resultado-${r.resultado ?? "x"}`);
      linha.textContent = `Última execução ${E.tempoRelativo(r.ultima, agora)} (${E.horaLisboa(r.ultima)}) · ${res}${r.teste && r.resultado !== "teste" ? " (teste)" : ""}`;
      caixaR.append(linha);
      // Em pausa, o motivo já aparece na caixa "Em pausa" logo abaixo.
      if (r.motivo && r.resultado !== "pausada") caixaR.append(el("span", "registo-motivo", r.motivo));
    }
    if (r?.semana != null) caixaR.append(el("span", "registo-semana", `${r.semana} ${r.semana === 1 ? "execução" : "execuções"} esta semana`));
    if (r?.resultado === "pausada") {
      const p = el("div", "pausa");
      p.textContent = `Em pausa: ${r.motivo || "alguém mexeu num aparelho à mão."}${a.ignorar_pausa ? "" : " A automação volta sozinha quando a pausa acabar."}`;
      caixaR.append(p);
    }
    if (r?.ultimos?.length) {
      const d = el("details", "ultimos");
      d.append(el("summary", null, r.ultimos.length === 1 ? "Última execução" : `Últimas ${r.ultimos.length} execuções`));
      const ul = el("ul");
      for (const u of r.ultimos) {
        ul.append(el("li", null, `${u.ts ? new Date(u.ts).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"} · ${E.RESULTADOS[u.resultado] ?? u.resultado}${u.motivo ? ` — ${u.motivo}` : ""}`));
      }
      d.append(ul);
      caixaR.append(d);
    }
    return caixaR;
  }

  // O motor escreve os avisos com os identificadores ('luz-corredor'); mostramos os nomes.
  function textoAviso(x) {
    let t = String(x.mensagem ?? "");
    for (const id of x.ids ?? []) {
      const a = (lista ?? []).find((k) => k.id === id);
      if (a?.nome) t = t.split(`'${id}'`).join(`"${a.nome}"`);
    }
    return t;
  }

  function desenhar() {
    const l = $("lista-automacoes");
    l.replaceChildren();
    $("nova-automacao").disabled = !!guardando || !!aEditar || lista == null || lista.length >= MAX_AUTOMACOES;
    const formBotao = document.querySelector("#form-automacao button[type=submit]");
    if (formBotao) { formBotao.disabled = !!guardando; formBotao.textContent = guardando ? "A guardar…" : "Guardar"; }

    // Avisos de conflito (não bloqueiam)
    const av = $("auto-avisos");
    av.replaceChildren();
    for (const x of avisos) {
      const d = el("div", "msg info aviso-conflito");
      d.textContent = `Atenção: ${textoAviso(x)}`;
      av.append(d);
    }

    if (lista == null) { l.append(el("p", "vazio", "A carregar automações…")); return; }
    if (lista.length === 0) { l.append(el("p", "vazio", "Ainda não tem automações. Crie a primeira com \"Nova automação\".")); return; }
    for (const a of lista) {
      const cartao = el("article", `cartao automacao${a.ativa === false ? " inativa" : ""}${a.bloqueada ? " bloqueada" : ""}`);
      cartao.dataset.id = a.id;
      const topo = el("div", "automacao-topo");
      topo.append(el("b", null, String(a.nome ?? a.id)));
      const sw = el("label", "interruptor");
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = a.ativa !== false;
      inp.disabled = !!guardando;
      inp.setAttribute("aria-label", `Automação ${a.nome ?? a.id} ativa`);
      inp.addEventListener("change", () => {
        const nova = lista.map((x) => (x.id === a.id ? { ...x, ativa: inp.checked } : x));
        guardar(nova);
      });
      sw.append(inp, document.createElement("span"));
      topo.append(sw);
      cartao.append(topo);
      if (E.CATEGORIAS.includes(a.categoria)) cartao.append(el("span", `categoria categoria-${a.categoria}`, E.NOME_CATEGORIA[a.categoria]));
      if (a.descricao) cartao.append(el("p", "objetivo", String(a.descricao)));
      cartao.append(el("p", "descricao", E.descreverAutomacao(a, aparelhos(), cenas())));
      for (const x of avisos.filter((x) => x.ids.includes(a.id))) cartao.append(el("p", "aviso-conflito-cartao", `Conflito: ${textoAviso(x)}`));
      cartao.append(linhaRegisto(a));
      const p = pedidos[a.id];
      if (p) {
        const m = el("div", `msg ${p.classe} resultado-pedido`, p.texto);
        m.setAttribute("role", "status");
        cartao.append(m);
      }
      if (a.bloqueada) {
        const c = el("span", "cadeado");
        c.append(ICONE_CADEADO(), document.createTextNode("Criada pela Domus Energia"));
        cartao.append(c);
      }
      const riscosExec = aConfirmar?.id === a.id ? E.acoesArriscadas(a.entao, aparelhos(), { cenas: cenas() }) : [];
      if (riscosExec.length) {
        const tipoExec = aConfirmar.tipo;
        const conf = painelRisco(riscosExec, {
          titulo: `${tipoExec === "testar" ? "Testar agora" : "Executar"} a automação "${a.nome ?? a.id}"? Vai fazer já:`,
          textoSim: "Sim, executar",
          textoNao: "Não executar",
          aoSim: () => { aConfirmar = null; pedirExecutar(a.id, tipoExec); },
          aoNao: () => {
            aConfirmar = null;
            desenhar();
            document.querySelector(`.automacao[data-id="${CSS.escape(a.id)}"] .botoes button`)?.focus();
          },
        });
        conf.classList.add("confirmar-execucao");
        cartao.append(conf);
      } else if (aApagar === a.id && !a.bloqueada) {
        const conf = el("div", "confirmar");
        conf.append(el("p", null, `Apagar a automação "${a.nome ?? a.id}"?`));
        const b = el("div", "botoes");
        const sim = botao("Sim, apagar", "btn perigo pequeno", () => { aApagar = null; guardar(lista.filter((x) => x.id !== a.id)); });
        sim.disabled = !!guardando;
        b.append(sim, botao("Cancelar", "btn sec pequeno", () => { aApagar = null; desenhar(); }));
        conf.append(b);
        cartao.append(conf);
      } else {
        const b = el("div", "botoes");
        const ocupado = !!p?.timer;
        if (a.quando?.tipo === "manual") {
          const ex = botao("Executar", "btn pequeno", () => executarComConfirmacao(a.id, "executar"));
          ex.disabled = ocupado || a.ativa === false;
          b.append(ex);
        }
        const testar = botao("Testar agora", "btn sec pequeno", () => executarComConfirmacao(a.id, "testar"));
        testar.disabled = ocupado;
        testar.title = "Executa as ações já, sem esperar pelo gatilho nem ver as condições";
        const avaliar = botao("Avaliar agora", "btn sec pequeno", () => pedirExecutar(a.id, "avaliar"));
        avaliar.disabled = ocupado;
        avaliar.title = "Diz se as condições são verdadeiras neste momento, sem executar";
        b.append(testar, avaliar);
        if (!a.bloqueada) {
          const editar = botao("Editar", "btn sec pequeno", () => abrirForm(a));
          editar.disabled = !!guardando || !!aEditar;
          const apagar = botao("Apagar", "btn sec pequeno", () => { aApagar = a.id; aConfirmar = null; desenhar(); });
          apagar.disabled = !!guardando || !!aEditar;
          b.append(editar, apagar);
        }
        cartao.append(b);
      }
      l.append(cartao);
    }
  }

  $("nova-automacao").addEventListener("click", () => abrirForm(null));

  // ---------- assistente ----------
  function abrirForm(original, preenchida = null, avisoModelo = null) {
    aEditar = { original };
    aApagar = null;
    estado(null);
    const caixaF = $("form-automacao-caixa");
    caixaF.replaceChildren();
    const a = original ?? preenchida ?? { ativa: true, quando: { tipo: "sensor" }, entao: [{ acao: "ligar" }] };
    const aps = aparelhos();
    const cfg = config();

    const form = el("form", "cartao form-automacao assistente");
    form.id = "form-automacao";
    form.noValidate = true;
    form.append(el("h3", null, original ? "Editar automação" : "Nova automação"));

    // Indicador de passos (clicável: pode saltar para qualquer passo)
    const nav = el("ol", "passos-assistente");
    nav.setAttribute("aria-label", "Passos do assistente");
    const botoesPasso = PASSOS.map((t, i) => {
      const li = el("li");
      const b = botao(null, "passo", () => irPara(i));
      b.dataset.passo = String(i + 1);
      b.append(el("span", "passo-n", String(i + 1)), el("span", "passo-t", t));
      li.append(b);
      nav.append(li);
      return b;
    });
    form.append(nav);
    const paineis = PASSOS.map((t, i) => {
      const f = el("fieldset", "passo-painel");
      f.dataset.passo = String(i + 1);
      f.append(el("legend", null, `${i + 1}. ${t}`));
      return f;
    });

    // ----- Passo 1: Objetivo -----
    const p1 = paineis[0];
    if (!original) {
      const mod = el("div", "modelos");
      mod.append(el("span", "rotulo-campo", "Começar de um modelo pronto (opcional)"));
      const grelha = el("div", "modelos-grelha");
      for (const m of MODELOS) {
        const b = botao(null, "modelo", () => {
          const r = aplicarModelo(m.id, { aparelhos: aparelhos(), config: config() });
          if (r.automacao) { abrirForm(null, r.automacao, `Modelo "${m.titulo}" aplicado com os seus aparelhos. Reveja os passos e carregue em Guardar.`); return; }
          modeloMsg.hidden = false;
          modeloMsg.className = r.info ? "msg info" : "msg erro";
          modeloMsg.textContent = r.info ?? r.falta;
        });
        b.dataset.modelo = m.id;
        b.append(el("b", null, m.titulo), el("small", null, m.resumo));
        grelha.append(b);
      }
      const modeloMsg = el("div", "msg info");
      modeloMsg.id = "modelo-msg";
      modeloMsg.setAttribute("role", "status");
      modeloMsg.hidden = !avisoModelo;
      if (avisoModelo) { modeloMsg.textContent = avisoModelo; modeloMsg.className = "msg ok"; }
      mod.append(grelha, modeloMsg);
      p1.append(mod);
    }
    p1.append(campo("Nome", input("nome", "text", a.nome ?? "", { maxlength: "60", required: "", autocomplete: "off" })));
    const catG = el("div", "grupo-campo");
    catG.append(el("span", "rotulo-campo", "Categoria"));
    const catChips = el("div", "dias categorias");
    catChips.setAttribute("role", "radiogroup");
    catChips.setAttribute("aria-label", "Categoria");
    for (const [v, t] of [["", "Sem categoria"], ...E.CATEGORIAS.map((c) => [c, E.NOME_CATEGORIA[c]])]) {
      const l = el("label");
      const r = input("categoria", "radio", v);
      r.checked = (a.categoria ?? "") === v;
      l.append(r, document.createTextNode(t));
      catChips.append(l);
    }
    catG.append(catChips);
    p1.append(catG);
    const desc = document.createElement("textarea");
    desc.name = "descricao";
    desc.maxLength = 200;
    desc.rows = 2;
    desc.placeholder = "Ex.: Acender a luz do corredor quando alguém passa, só à noite.";
    desc.value = a.descricao ?? "";
    p1.append(campo("Frase-objetivo (o que quer que aconteça)", desc, "Ajuda a lembrar mais tarde para que serve. Até 200 caracteres."));
    const ativa = caixa("ativa", "Ativa", a.ativa !== false);
    p1.append(ativa.label);

    // ----- Passo 2: Gatilho -----
    const p2 = paineis[1];
    const q = a.quando ?? {};
    const tipo = select("quando-tipo", [
      { valor: "sensor", texto: "Um aparelho muda de estado (sensor, interruptor)" },
      { valor: "hora", texto: "A uma hora certa" },
      { valor: "sol", texto: "Ao nascer ou pôr do sol" },
      { valor: "presenca", texto: "Quando alguém chega ou sai" },
      { valor: "modo", texto: "Quando a casa muda de modo" },
      { valor: "potencia", texto: "O consumo passa um limite" },
      { valor: "sistema", texto: "Um evento do sistema (offline, energia reposta)" },
      { valor: "manual", texto: "Só quando eu carregar em Executar" },
    ], q.tipo ?? "sensor");
    p2.append(campo("Dispara quando", tipo));

    // sensor
    const ordem = { porta: 0, movimento: 1, interruptor: 2, luz: 2 };
    const sensores = opcoesCanais(aps, ["porta", "movimento", "interruptor", "luz"], GRUPOS_SENSOR).sort((x, y) => ordem[x.funcao] - ordem[y.funcao]);
    const pSensor = el("div", "sub-painel");
    const sensorSel = select("quando-sensor", sensores, q.tipo === "sensor" && q.aparelho ? `${q.aparelho}:${q.canal}` : null, "Escolha o aparelho…");
    const valorSel = document.createElement("select");
    valorSel.name = "quando-valor";
    const atualizarValores = () => {
      const f = sensores.find((s) => s.valor === sensorSel.value)?.funcao;
      const atual = valorSel.value || (q.tipo === "sensor" && q.valor != null ? String(q.valor) : "1");
      valorSel.replaceChildren();
      const ops = f === "porta" ? [["1", "Abre"], ["0", "Fecha"]] : f === "movimento" ? [["1", "Deteta movimento"], ["0", "Deixa de detetar movimento"]]
        : f === "interruptor" || f === "luz" ? [["1", "É ligado"], ["0", "É desligado"]] : [["1", "Fica ativo"], ["0", "Fica inativo"]];
      for (const [v, t] of ops) { const o = el("option", null, t); o.value = v; valorSel.append(o); }
      valorSel.value = atual;
    };
    sensorSel.addEventListener("change", atualizarValores);
    atualizarValores();
    const duasS = el("div", "duas");
    duasS.append(campo("Aparelho", sensorSel), campo("E", valorSel));
    const sensorDurante = input("quando-sensor-durante", "number", q.tipo === "sensor" && q.durante_s ? +(q.durante_s / 60).toFixed(2) : "", { min: "0", step: "any", inputmode: "decimal", placeholder: "logo" });
    pSensor.append(duasS, campo("E fica assim durante (minutos, opcional)", sensorDurante, "Ex.: \"deixa de detetar movimento\" durante 10 min = sem movimento há 10 min."));

    // hora
    const pHora = el("div", "sub-painel");
    pHora.append(campo("Hora", input("quando-hora", "time", q.tipo === "hora" ? q.hora : "08:00")));
    const diasQ = chips("quando-dia", DIAS.map(([n, t]) => [String(n), t]), (q.tipo === "hora" && Array.isArray(q.dias) ? q.dias : [1, 2, 3, 4, 5, 6, 7]).map(String), "Dias da semana");
    pHora.append(diasQ.raiz);

    // sol
    const pSol = el("div", "sub-painel");
    const solEv = select("quando-sol", [{ valor: "por", texto: "Pôr do sol" }, { valor: "nascer", texto: "Nascer do sol" }], q.tipo === "sol" ? q.evento : "por");
    const desvio = input("quando-desvio", "number", q.tipo === "sol" ? q.desvio_min ?? 0 : 0, { min: "-180", max: "180", step: "1", inputmode: "numeric" });
    const duasSol = el("div", "duas");
    duasSol.append(campo("Quando", solEv), campo("Desvio (minutos; negativo = antes)", desvio));
    pSol.append(duasSol);
    if (!cfg?.local) pSol.append(el("p", "msg info", "Para saber a hora do sol, defina a localização da casa em Definições."));

    // presença
    const pPres = el("div", "sub-painel");
    pPres.append(campo("Quando", select("quando-presenca", [{ valor: "chega_primeiro", texto: "Chega a primeira pessoa" }, { valor: "sai_ultimo", texto: "Sai a última pessoa" }], q.tipo === "presenca" ? q.evento : "chega_primeiro")));
    pPres.append(el("p", "ajuda", "A presença vem da app Domus Energia nos telemóveis da casa (localização e Wi-Fi de casa)."));

    // modo
    const pModo = el("div", "sub-painel");
    pModo.append(campo("A casa entra no modo", select("quando-modo", OPCOES_MODO.map(([v, t]) => ({ valor: v, texto: t })), q.tipo === "modo" ? q.modo : "noite")));

    // potência
    const pPot = el("div", "sub-painel");
    const medidores = aps.filter((x) => x.medidor || x.v1).map((x) => ({ valor: x.id, texto: x.nome }));
    pPot.append(campo("Medidor", select("quando-medidor", medidores, q.tipo === "potencia" && q.aparelho ? q.aparelho : null, "Escolha o medidor…")));
    const duasPot = el("div", "duas");
    duasPot.append(
      campo("Acima de (W)", input("quando-acima", "number", q.tipo === "potencia" ? q.acima_w : 3500, { min: "1", step: "1", inputmode: "numeric" })),
      campo("Durante (segundos)", input("quando-durante", "number", q.tipo === "potencia" ? q.durante_s : 60, { min: "0", step: "1", inputmode: "numeric" })),
    );
    pPot.append(duasPot);
    pPot.append(campo("Só volta a avisar abaixo de (W, opcional)", input("quando-rearmar", "number", q.tipo === "potencia" && q.rearmar_w != null ? q.rearmar_w : "", { min: "1", step: "1", inputmode: "numeric", placeholder: "90 % do limite" }), "Zona de proteção para não disparar repetidamente perto do limite."));

    // sistema
    const pSis = el("div", "sub-painel");
    const sisEv = select("quando-sistema", [
      { valor: "aparelho_offline", texto: "Um aparelho fica offline" },
      { valor: "aparelho_online", texto: "Um aparelho volta a ficar online" },
      { valor: "energia_reposta", texto: "A energia é reposta (depois de um corte)" },
    ], q.tipo === "sistema" ? q.evento : "aparelho_offline");
    const sisAp = select("quando-sistema-aparelho", [{ valor: "", texto: "Qualquer aparelho" }, ...aps.filter((x) => !x.bateria).map((x) => ({ valor: x.id, texto: x.nome }))], q.tipo === "sistema" ? q.aparelho ?? "" : "");
    const sisApL = campo("Aparelho", sisAp);
    pSis.append(campo("Evento", sisEv), sisApL);
    const verSis = () => { sisApL.hidden = sisEv.value === "energia_reposta"; };
    sisEv.addEventListener("change", verSis);
    verSis();

    // manual
    const pMan = el("div", "sub-painel");
    pMan.append(el("p", "ajuda", "A automação só corre quando carregar em \"Executar\" no cartão dela (as condições do passo 4 continuam a contar)."));

    const subs = { sensor: pSensor, hora: pHora, sol: pSol, presenca: pPres, modo: pModo, potencia: pPot, sistema: pSis, manual: pMan };
    p2.append(...Object.values(subs));
    const mostrarQuando = () => { for (const [k, p] of Object.entries(subs)) p.hidden = tipo.value !== k; };
    tipo.addEventListener("change", mostrarQuando);
    mostrarQuando();

    // ----- Passo 3: Ação básica + Testar agora -----
    const ctx = criarContexto({ aparelhos: aps, cenas: cenas() });
    const entao = a.entao?.length ? a.entao : [{ acao: "ligar" }];
    const p3 = paineis[2];
    p3.append(el("p", "ajuda", "O que acontece quando a automação dispara. Mais aparelhos, esperas e SE/SENÃO no passo 5."));
    const primeira = linhaAcao(entao[0], ctx, { rotulo: "Ação 1" });
    p3.append(primeira.raiz);
    const testarMsg = el("div", "msg info");
    testarMsg.id = "testar-msg";
    testarMsg.setAttribute("role", "status");
    testarMsg.hidden = true;
    const testar = botao("Testar agora", "btn sec pequeno", () => {
      testarMsg.hidden = false;
      if (!original) {
        testarMsg.className = "msg info";
        testarMsg.textContent = "Guarde primeiro a automação para a poder testar: o teste é feito pelo servidor com a versão guardada.";
        return;
      }
      const pedirTeste = () => {
        if (!pedirExecutar(original.id, "testar")) return;
        testarMsg.hidden = false;
        testarMsg.className = "msg info";
        testarMsg.textContent = "Teste pedido: o servidor executa já as ações da versão guardada (sem gatilho nem condições). Veja o resultado no cartão da automação.";
      };
      // O teste corre a versão guardada: se ela mexe no quadro geral ou numa carga perigosa, confirmar.
      const guardada = (lista ?? []).find((x) => x.id === original.id);
      const riscos = guardada ? E.acoesArriscadas(guardada.entao, aparelhos(), { cenas: cenas() }) : [];
      if (!riscos.length) { pedirTeste(); return; }
      testarMsg.hidden = true;
      p3.querySelector("#testar-risco")?.remove();
      const conf = painelRisco(riscos, {
        titulo: `Testar agora a automação "${guardada.nome ?? guardada.id}"? Vai fazer já:`,
        textoSim: "Sim, executar",
        textoNao: "Não executar",
        aoSim: () => { conf.remove(); pedirTeste(); },
        aoNao: () => { conf.remove(); testar.focus(); },
      });
      conf.id = "testar-risco";
      testar.after(conf);
      conf.querySelector(".confirmar-titulo").focus();
    });
    testar.id = "testar-agora";
    p3.append(testar, testarMsg);

    // ----- Passo 4: Condições -----
    const p4 = paineis[3];
    p4.append(el("p", "ajuda", "Opcional: a automação só executa se todas estas condições forem verdadeiras."));
    const cond = editorCondicoes(a.se, { aparelhos: aps, prefixo: "se" });
    p4.append(cond.raiz);
    const maisP4 = el("details", "mais");
    maisP4.append(el("summary", null, "Mais"));
    const ignorar = caixa("ignorar-pausa", "Não pausar quando alguém mexe num aparelho à mão", a.ignorar_pausa === true);
    maisP4.append(ignorar.label, el("small", "ajuda", `Por omissão, mexer à mão num aparelho pausa as automações desse aparelho durante ${cfg?.pausa_manual_min ?? 60} min.`));
    if (a.ignorar_pausa) maisP4.open = true;
    p4.append(maisP4);

    // ----- Passo 5: Vários aparelhos -----
    const p5 = paineis[4];
    p5.append(el("p", "ajuda", `Acrescente mais passos depois da ação 1: outros aparelhos, esperas, cenas, mudar o modo, luz com brilho, alternar e SE/SENÃO (até ${E.MAX_NIVEIS_SE} níveis). Máximo ${E.MAX_ACOES} ações ao todo.`));
    const resto = listaAcoes(entao.slice(1), ctx, { inicio: 2, minimo: 0 });
    p5.append(resto.raiz);
    ctx.raizes.push(primeira, resto);
    ctx.atualizar();

    form.append(...paineis);

    const erro = el("div", "msg erro");
    erro.id = "auto-form-erro";
    erro.setAttribute("role", "alert");
    erro.hidden = true;
    form.append(erro);
    const botoes = el("div", "form-botoes");
    const anterior = botao("Anterior", "btn sec", () => irPara(atual - 1));
    const seguinte = botao("Seguinte", "btn sec", () => irPara(atual + 1));
    const ok = el("button", "btn", "Guardar");
    ok.type = "submit";
    botoes.append(anterior, seguinte, ok, botao("Cancelar", "btn sec", fecharForm));
    form.append(botoes);

    let atual = 0;
    function irPara(i) {
      atual = Math.max(0, Math.min(PASSOS.length - 1, i));
      paineis.forEach((p, k) => { p.hidden = k !== atual; });
      botoesPasso.forEach((b, k) => { if (k === atual) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
      anterior.disabled = atual === 0;
      seguinte.disabled = atual === PASSOS.length - 1;
    }
    irPara(0);

    // Confirmação de ações arriscadas (disjuntor geral, carga perigosa): mostra-se por cima dos
    // botões; qualquer mudança no formulário a anula (a lista mostrada deixaria de ser verdade).
    let risco = null;
    const fecharRisco = () => { risco?.remove(); risco = null; botoes.hidden = false; };
    form.addEventListener("input", fecharRisco);
    form.addEventListener("change", fecharRisco);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardando || risco) return;
      const auto = lerForm();
      const erros = E.validarAutomacao(auto, aparelhos());
      if (!original && lista && lista.length >= MAX_AUTOMACOES) erros.push(`Máximo de ${MAX_AUTOMACOES} automações.`);
      erro.hidden = erros.length === 0;
      erro.replaceChildren();
      for (const t of erros) erro.append(el("div", null, t));
      if (erros.length) {
        const t = erros[0];
        irPara(/^(Dê um nome|A frase-objetivo|Categoria)/.test(t) ? 0 : /^Ação 1[:.]/.test(t) ? 2 : /^(Ação|Tem de ter)/.test(t) ? 4 : /^Condições/.test(t) ? 3 : 1);
        // Aponta o campo vazio no passo aberto (e marca os dos outros passos).
        const vazios = marcarVazios(form);
        const aqui = vazios.find((s) => !s.closest("[hidden]"));
        if (aqui) aqui.focus();
        return;
      }
      const atualL = lista ?? [];
      const nova = original ? atualL.map((x) => (x.id === original.id ? auto : x)) : [...atualL, auto];
      const riscos = E.acoesArriscadas(auto.entao, aparelhos(), { cenas: cenas() });
      if (!riscos.length || E.jsonCanonico(nova) === E.jsonCanonico(atualL)) { guardar(nova, fecharForm); return; }
      risco = painelRisco(riscos, {
        titulo: riscos.length === 1 ? "Atenção: esta automação faz uma coisa arriscada. Quer mesmo guardá-la assim?" : `Atenção: esta automação faz ${riscos.length} coisas arriscadas. Quer mesmo guardá-la assim?`,
        textoSim: "Sim, guardar assim",
        textoNao: "Voltar e alterar",
        aoSim: () => { fecharRisco(); guardar(nova, fecharForm); },
        aoNao: () => {
          fecharRisco();
          // Leva à ação arriscada: a 1.ª está no passo 3, as outras no passo 5.
          const i = parseInt(riscos[0].caminho, 10);
          irPara(i === 1 ? 2 : 4);
          (i === 1 ? primeira : resto.linhas[i - 2])?.raiz.querySelector("select[name=acao]")?.focus();
        },
      });
      risco.id = "auto-risco";
      botoes.hidden = true;
      botoes.before(risco);
      risco.querySelector(".confirmar-titulo").focus();
    });

    function lerForm() {
      const f = form.elements;
      const nome = f.nome.value.trim();
      const ids = (lista ?? []).map((x) => x.id);
      const id = original ? original.id : E.slug(nome, ids);
      let quando;
      const t = tipo.value;
      if (t === "sensor") {
        const s = separar(sensorSel.value);
        quando = { tipo: "sensor", aparelho: s.aparelho, canal: s.canal, valor: Number(valorSel.value) };
        const min = parseFloat(String(sensorDurante.value ?? "").replace(",", "."));
        if (Number.isFinite(min) && min > 0) quando.durante_s = Math.round(min * 60);
      } else if (t === "hora") {
        quando = { tipo: "hora", hora: hhmm(f["quando-hora"].value), dias: diasQ.lidos().map(Number) };
      } else if (t === "sol") {
        quando = { tipo: "sol", evento: solEv.value, desvio_min: Math.round(Number(desvio.value || 0)) };
      } else if (t === "presenca") {
        quando = { tipo: "presenca", evento: f["quando-presenca"].value };
      } else if (t === "modo") {
        quando = { tipo: "modo", modo: f["quando-modo"].value };
      } else if (t === "manual") {
        quando = { tipo: "manual" };
      } else if (t === "sistema") {
        quando = { tipo: "sistema", evento: sisEv.value };
        if (sisEv.value !== "energia_reposta" && sisAp.value) quando.aparelho = sisAp.value;
      } else {
        quando = { tipo: "potencia", aparelho: f["quando-medidor"]?.value || null, acima_w: Number(f["quando-acima"].value), durante_s: Math.round(Number(f["quando-durante"].value)) };
        const r = String(f["quando-rearmar"].value ?? "").trim();
        if (r !== "") quando.rearmar_w = Number(r);
      }
      const auto = { id, nome };
      const d = desc.value.trim();
      if (d) auto.descricao = d;
      const cat = form.querySelector("input[name=categoria]:checked")?.value;
      if (cat) auto.categoria = cat;
      auto.ativa = ativa.input.checked;
      auto.bloqueada = false;
      if (ignorar.input.checked) auto.ignorar_pausa = true;
      auto.quando = quando;
      const se = cond.ler();
      if (Object.keys(se).length) auto.se = se;
      auto.entao = [primeira.ler(), ...resto.ler()];
      return auto;
    }

    caixaF.append(form);
    desenhar();
    form.elements.nome.focus();
  }

  function fecharForm() {
    aEditar = null;
    $("form-automacao-caixa").replaceChildren();
    desenhar();
  }

  return { desenhar, receberLista, receberErro, receberRegisto, receberAvisos, limpar, lista: () => lista ?? [] };
}
