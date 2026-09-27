// Cenas (PROTOCOLO-MQTT-v3.md §7): fila de botões no separador Casa → `_cenas/executar`,
// e gestão (criar, editar, apagar) → lista completa em `_cenas/set`. As cenas `bloqueada`
// (criadas pela Domus Energia) só se veem e executam.
import * as E from "./estado.js";
import { el, botao, input, campo, criarContexto, listaAcoes } from "./editor.js";
import { criarIcone } from "./ilustracoes.js";
import { ICONE_CADEADO } from "./automacoes.js";

const $ = (id) => document.getElementById(id);
const TEMPO_MOTOR = 10_000;
const MAX_CENAS = 30;
const NOME_ICONE = { filme: "Filme", sol: "Sol", lua: "Lua", porta: "Porta", casa: "Casa", energia: "Energia", luz: "Luz", estrela: "Estrela" };

export function criarCenas({ publicar, ligado, aparelhos }) {
  let lista = null;
  let textoAtual = null;
  let guardando = null;   // { anterior, timer, aoTerminar }
  let aEditar = null;     // { original } | null
  let aApagar = null;
  let aberto = false;     // painel "Gerir cenas"
  let msgTimer = null;

  function estado(texto, tipo = "info") {
    clearTimeout(msgTimer);
    const m = $("cenas-estado");
    m.hidden = !texto;
    m.textContent = texto ?? "";
    m.className = `msg ${tipo}`;
    if (tipo === "ok") msgTimer = setTimeout(() => { m.hidden = true; }, 4000);
  }

  function executar(c) {
    if (!ligado()) { estado("Sem ligação ao servidor. Tente de novo daqui a pouco.", "erro"); return; }
    publicar("_cenas/executar", { id: c.id, por: "web" });
    estado(`Cena "${c.nome ?? c.id}" pedida.`, "ok");
  }

  function guardar(nova, aoTerminar) {
    if (guardando) return;
    if (!ligado()) { estado("Sem ligação ao servidor. Tente de novo daqui a pouco.", "erro"); return; }
    if (JSON.stringify(nova) === JSON.stringify(lista ?? [])) { estado("Sem alterações.", "ok"); aoTerminar?.(); return; }
    guardando = {
      anterior: textoAtual,
      aoTerminar,
      timer: setTimeout(() => { guardando = null; estado("O servidor não respondeu. As cenas não foram guardadas; tente de novo.", "erro"); desenhar(); }, TEMPO_MOTOR),
    };
    publicar("_cenas/set", nova);
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
    if (!guardando) return false;
    clearTimeout(guardando.timer);
    guardando = null;
    estado(ev.mensagem || ev.titulo || "O servidor recusou a cena.", "erro");
    desenhar();
    return true;
  }
  function limpar() {
    clearTimeout(guardando?.timer);
    clearTimeout(msgTimer);
    lista = null; textoAtual = null; guardando = null; aEditar = null; aApagar = null; aberto = false;
    $("cenas-linha")?.replaceChildren();
    $("cenas-lista")?.replaceChildren();
    $("form-cena-caixa")?.replaceChildren();
    if ($("cenas-estado")) $("cenas-estado").hidden = true;
    if ($("cenas-gerir")) $("cenas-gerir").hidden = true;
  }

  $("cenas-gerir-botao").addEventListener("click", () => {
    aberto = !aberto;
    if (!aberto) { aEditar = null; aApagar = null; $("form-cena-caixa").replaceChildren(); }
    desenhar();
  });
  $("nova-cena").addEventListener("click", () => abrirForm(null));

  function desenhar() {
    const linha = $("cenas-linha");
    linha.replaceChildren();
    $("cenas").hidden = lista == null;
    const g = $("cenas-gerir-botao");
    g.setAttribute("aria-expanded", String(aberto));
    g.textContent = aberto ? "Fechar" : "Gerir";
    $("cenas-gerir").hidden = !aberto;
    if (lista == null) return;
    if (lista.length === 0) linha.append(el("p", "vazio", "Ainda não tem cenas. Crie uma em \"Gerir\"."));
    for (const c of lista) {
      const b = botao(null, "cena-botao", () => executar(c));
      b.dataset.id = c.id;
      const ic = el("span", "cena-icone");
      ic.append(criarIcone(E.ICONES_CENA.includes(c.icone) ? c.icone : "estrela"));
      b.append(ic, el("span", "cena-nome", String(c.nome ?? c.id)));
      b.setAttribute("aria-label", `Executar a cena ${c.nome ?? c.id}`);
      linha.append(b);
    }

    // Painel de gestão
    $("nova-cena").disabled = !!guardando || !!aEditar || lista.length >= MAX_CENAS;
    const formBotao = document.querySelector("#form-cena button[type=submit]");
    if (formBotao) { formBotao.disabled = !!guardando; formBotao.textContent = guardando ? "A guardar…" : "Guardar cena"; }
    const l = $("cenas-lista");
    l.replaceChildren();
    for (const c of lista) {
      const art = el("article", `cena-item${c.bloqueada ? " bloqueada" : ""}`);
      art.dataset.id = c.id;
      const topo = el("div", "cena-item-topo");
      const ic = el("span", "cena-icone");
      ic.append(criarIcone(E.ICONES_CENA.includes(c.icone) ? c.icone : "estrela"));
      topo.append(ic, el("b", null, String(c.nome ?? c.id)));
      art.append(topo);
      art.append(el("p", "descricao", E.descreverAcoes(c.acoes, aparelhos()).join("; ")));
      if (c.bloqueada) {
        const k = el("span", "cadeado");
        k.append(ICONE_CADEADO(), document.createTextNode("Criada pela Domus Energia — só leitura"));
        art.append(k);
      } else if (aApagar === c.id) {
        const conf = el("div", "confirmar");
        conf.append(el("p", null, `Apagar a cena "${c.nome ?? c.id}"?`));
        const b = el("div", "botoes");
        const sim = botao("Sim, apagar", "btn perigo pequeno", () => { aApagar = null; guardar(lista.filter((x) => x.id !== c.id)); });
        sim.disabled = !!guardando;
        b.append(sim, botao("Cancelar", "btn sec pequeno", () => { aApagar = null; desenhar(); }));
        conf.append(b);
        art.append(conf);
      } else {
        const b = el("div", "botoes");
        const ed = botao("Editar", "btn sec pequeno", () => abrirForm(c));
        const ap = botao("Apagar", "btn sec pequeno", () => { aApagar = c.id; desenhar(); });
        ed.disabled = ap.disabled = !!guardando || !!aEditar;
        b.append(ed, ap);
        art.append(b);
      }
      l.append(art);
    }
  }

  function abrirForm(original) {
    aEditar = { original };
    aApagar = null;
    estado(null);
    const caixaF = $("form-cena-caixa");
    caixaF.replaceChildren();
    const c = original ?? { icone: "estrela", acoes: [{ acao: "desligar" }] };
    const form = el("form", "form-cena");
    form.id = "form-cena";
    form.noValidate = true;
    form.append(el("h3", null, original ? "Editar cena" : "Nova cena"));
    form.append(campo("Nome", input("cena-nome", "text", c.nome ?? "", { maxlength: "40", autocomplete: "off" })));
    const g = el("div", "grupo-campo");
    g.append(el("span", "rotulo-campo", "Ícone"));
    const icones = el("div", "icones-cena");
    icones.setAttribute("role", "radiogroup");
    icones.setAttribute("aria-label", "Ícone");
    for (const nome of E.ICONES_CENA) {
      const l = el("label", "icone-opcao");
      const r = input("cena-icone", "radio", nome);
      r.checked = (c.icone ?? "estrela") === nome;
      r.setAttribute("aria-label", NOME_ICONE[nome]);
      l.append(r, criarIcone(nome));
      l.title = NOME_ICONE[nome];
      icones.append(l);
    }
    g.append(icones);
    form.append(g);
    const fs = el("fieldset");
    fs.append(el("legend", null, "Ações"));
    fs.append(el("p", "ajuda", "Tudo o que a cena faz, por ordem. Pode usar esperas e mudar o modo; uma cena não tem SE/SENÃO nem outras cenas."));
    const ctx = criarContexto({ aparelhos: aparelhos(), cena: true });
    const acoes = listaAcoes(c.acoes ?? [], ctx, { minimo: 1 });
    ctx.raizes.push(acoes);
    ctx.atualizar();
    fs.append(acoes.raiz);
    form.append(fs);
    const erro = el("div", "msg erro");
    erro.id = "cena-form-erro";
    erro.setAttribute("role", "alert");
    erro.hidden = true;
    form.append(erro);
    const botoes = el("div", "form-botoes");
    const ok = el("button", "btn", "Guardar cena");
    ok.type = "submit";
    botoes.append(ok, botao("Cancelar", "btn sec", fechar));
    form.append(botoes);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardando) return;
      const nome = form.elements["cena-nome"].value.trim();
      const cena = {
        id: original ? original.id : E.slug(nome, (lista ?? []).map((x) => x.id)).replace(/^automacao$/, "cena"),
        nome,
        icone: form.querySelector("input[name=cena-icone]:checked")?.value ?? "estrela",
        bloqueada: false,
        acoes: acoes.ler(),
      };
      const erros = E.validarCena(cena, aparelhos());
      if (!original && (lista?.length ?? 0) >= MAX_CENAS) erros.push(`Máximo de ${MAX_CENAS} cenas.`);
      erro.hidden = !erros.length;
      erro.replaceChildren(...erros.map((t) => el("div", null, t)));
      if (erros.length) return;
      const atual = lista ?? [];
      guardar(original ? atual.map((x) => (x.id === original.id ? cena : x)) : [...atual, cena], fechar);
    });
    caixaF.append(form);
    desenhar();
    form.elements["cena-nome"].focus();
  }
  function fechar() {
    aEditar = null;
    $("form-cena-caixa").replaceChildren();
    desenhar();
  }

  return { desenhar, receberLista, receberErro, limpar, lista: () => lista ?? [] };
}
