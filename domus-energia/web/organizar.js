// Organizar os aparelhos (decisões do dono, 2026-11-10; docs/APP-CLIENTE.md): no separador Aparelhos o cliente muda o
// nome de cada mosaico, a divisão de cada aparelho e esconde mosaicos da Casa, da planta e das Divisões. Guarda-se em
// `_config.personalizar` (`_config/set`); o motor valida. O nome técnico do painel nunca muda e fica à vista aqui.
import * as E from "./estado.js";
import { el, botao, input, campo, caixa } from "./editor.js";

const $ = (id) => document.getElementById(id);
const TEMPO_MOTOR = 10_000;

export function criarOrganizar({ publicar, ligado, divisoes }) {
  let pers = {};
  let base = [];          // aparelhos como o painel os criou
  let vistos = [];        // os mesmos com o que o cliente mudou
  let aberto = null;      // id do aparelho com o formulário aberto
  let guardando = null;   // { timer, esperado }
  let msgTimer = null;

  function estado(texto, tipo = "info") {
    clearTimeout(msgTimer);
    const m = $("organizar-estado");
    m.hidden = !texto;
    m.textContent = texto ?? "";
    m.className = `msg ${tipo}`;
    if (tipo === "ok") msgTimer = setTimeout(() => { m.hidden = true; }, 4000);
  }

  function receber(p) {
    pers = p;
    if (guardando && JSON.stringify(p) === guardando.esperado) {
      clearTimeout(guardando.timer);
      guardando = null;
      aberto = null;
      estado("Guardado.", "ok");
    }
  }
  function receberErro(ev) {
    if (!guardando) return false;
    clearTimeout(guardando.timer);
    guardando = null;
    estado(ev.mensagem || ev.titulo || "O servidor recusou a alteração.", "erro");
    desenharLista();
    return true;
  }
  function limpar() {
    clearTimeout(guardando?.timer);
    clearTimeout(msgTimer);
    pers = {}; base = []; vistos = []; aberto = null; guardando = null;
    $("lista-organizar")?.replaceChildren();
    if ($("organizar-estado")) $("organizar-estado").hidden = true;
  }

  function guardar(a, pedido) {
    if (!ligado()) { estado(E.SEM_LIGACAO, "erro"); return; }
    const novo = E.mudarPersonalizar(pers, a, pedido);
    const esperado = JSON.stringify(novo);
    if (esperado === JSON.stringify(pers)) { aberto = null; estado("Sem alterações.", "ok"); desenharLista(); return; }
    guardando = {
      esperado,
      timer: setTimeout(() => { guardando = null; estado("O servidor não respondeu. Não ficou guardado; tente de novo.", "erro"); desenharLista(); }, TEMPO_MOTOR),
    };
    // shortcut: vai o `personalizar` inteiro (dois telemóveis ao mesmo tempo: fica o último); por aparelho se isso incomodar.
    publicar("_config/set", { personalizar: novo });
    estado("A guardar…", "info");
    desenharLista();
  }

  function rotulo(v, c) {
    if (v.canais.length === 1) return v.nome;
    return c.temNome ? c.nome : `${v.nome} · ${E.ROTULO_FUNCAO[c.funcao]}`;
  }

  function linha(a, v) {
    const item = el("div", "cartao organizar-item");
    const topo = el("div", "organizar-topo");
    const texto = el("div", "organizar-texto");
    for (const c of v.canais) {
      const t = el("div", "organizar-nome", rotulo(v, c));
      if (c.escondido) t.append(" ", el("span", "etiqueta", "Escondido"));
      texto.append(t);
    }
    const sub = [v.divisao ?? "Sem divisão"];
    if (pers[a.id]) sub.push(`No quadro: ${a.nome}${a.divisao ? `, ${a.divisao}` : ""}`);
    texto.append(el("small", "ajuda", sub.join(" · ")));
    const b = botao(aberto === a.id ? "Fechar" : "Alterar", "btn sec pequeno", () => { aberto = aberto === a.id ? null : a.id; desenharLista(); });
    b.setAttribute("aria-expanded", String(aberto === a.id));
    b.disabled = !!guardando;
    topo.append(texto, b);
    item.append(topo);
    if (aberto === a.id) item.append(formulario(a, v));
    return item;
  }

  function formulario(a, v) {
    const form = el("form", "organizar-form");
    form.noValidate = true;
    const div = input("org-divisao", "text", v.divisao ?? "", { maxlength: String(E.MAX_DIVISAO), list: "organizar-divisoes", autocomplete: "off", placeholder: a.divisao ?? "Ex.: Cozinha" });
    form.append(campo("Divisão", div, "Escolha da lista ou escreva uma divisão nova."));
    const canais = [];
    for (const c of v.canais) {
      // Vazio = o nome do quadro (o do painel).
      const tecnico = rotulo(a, a.canais.find((x) => x.n === c.n));
      const nome = input(`org-nome-${c.n}`, "text", pers[a.id]?.canais?.[c.n]?.nome ?? "", { maxlength: String(E.MAX_NOME_MOSAICO), placeholder: tecnico, autocomplete: "off" });
      const esc = caixa(`org-esconder-${c.n}`, "Esconder da Casa e das Divisões", !!c.escondido);
      const fs = el("fieldset", "organizar-canal");
      fs.append(el("legend", null, a.canais.length === 1 ? "Mosaico" : `Canal ${c.n}: ${tecnico}`));
      fs.append(campo("Nome", nome, `Vazio fica o nome do quadro: ${tecnico}.`), esc.label);
      canais.push({ n: c.n, nome, esc: esc.input });
      form.append(fs);
    }
    form.append(el("small", "ajuda", "Um aparelho escondido continua a funcionar, nas automações, nos avisos e aqui."));
    const acoes = el("div", "acoes");
    const ok = el("button", "btn", guardando ? "A guardar…" : "Guardar");
    ok.type = "submit";
    ok.disabled = !!guardando;
    const repor = botao("Repor o original", "btn sec", () => guardar(a, {}));
    repor.disabled = !!guardando || !pers[a.id];
    acoes.append(ok, repor);
    form.append(acoes);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pedido = { divisao: div.value, canais: {} };
      for (const k of canais) pedido.canais[k.n] = { nome: k.nome.value, escondido: k.esc.checked };
      guardar(a, pedido);
    });
    return form;
  }

  function desenharLista() {
    const lista = $("lista-organizar");
    if (!lista) return;
    // Manter o foco no botão do aparelho depois de redesenhar.
    const foco = document.activeElement?.closest?.("[data-aparelho]")?.dataset.aparelho;
    lista.replaceChildren();
    const nomes = [...new Set(divisoes().filter(Boolean))].sort((x, y) => x.localeCompare(y, "pt"));
    const dl = el("datalist");
    dl.id = "organizar-divisoes";
    for (const n of nomes) { const o = document.createElement("option"); o.value = n; dl.append(o); }
    lista.append(dl);
    if (!base.length) { lista.append(el("p", "ajuda", "Os seus aparelhos aparecem aqui depois da instalação.")); return; }
    for (const a of base) {
      const v = vistos.find((x) => x.id === a.id) ?? a;
      const item = linha(a, v);
      item.dataset.aparelho = a.id;
      lista.append(item);
    }
    if (foco) lista.querySelector(`[data-aparelho="${foco}"] button`)?.focus({ preventScroll: true });
  }

  /** `b` = lerAparelhos(_aparelhos); `v` = os mesmos com aplicarPersonalizar. */
  function desenhar(b, v) {
    base = b;
    vistos = v;
    if (aberto && !base.some((a) => a.id === aberto)) aberto = null;
    // Não apagar o que a pessoa está a escrever: só redesenha com o formulário fechado ou ao fim de guardar.
    if (aberto && !guardando && document.activeElement?.closest?.(".organizar-form")) return;
    desenharLista();
  }

  return { receber, receberErro, limpar, desenhar };
}
