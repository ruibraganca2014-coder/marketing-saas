// Procedimentos (docs/PROCEDIMENTOS.md): a biblioteca de procedimentos da empresa, um por tipo de trabalho, com os
// passos por ordem (texto simples; "Segurança" e "Obrigatório"). Todos leem os publicados; só o CEO vê os rascunhos e
// os arquivados, cria, edita (numa cópia de trabalho), publica (a versão sobe) e arquiva. As checklists de cada obra
// estão na ficha da obra (ecras/obras.js). Rotas: #/procedimentos, #/procedimentos/<id>, #/procedimentos/<id>/editar,
// #/procedimentos/novo.
import { pedir, lista } from "../api.js";
import { h, selo, data, campoForm, escolha, mensagem, avisar, carregando, erroEcra, botaoConfirmar } from "../ui.js";

const ESTADOS = { publicado: "Publicado", rascunho: "Rascunho", arquivado: "Arquivado" };
const CLASSE_ESTADO = { publicado: "orc-aceite", rascunho: "aviso", arquivado: "" };
// Os mesmos limites do servidor (procedimentos.js); a lista do CEO traz os que estiverem em vigor.
const LIMITES = { passos: 40, titulo: 120, descricao: 600, passo: 200, nota: 1000 };

/** Os selos de um passo: "Segurança" e "Obrigatório". */
export const selosPasso = (x) => [x.seguranca ? selo("Segurança", "grav-critica") : null, x.obrigatorio ? selo("Obrigatório", "aviso") : null];

export default function procedimentos(el, ctx) {
  const ctrl = new AbortController();
  const ceo = ctx.pode("ceo");
  let tipos = {};
  let limites = LIMITES;
  let geracao = 0;
  const zona = h("div", {});
  el.append(zona);

  const voltar = (texto = "Procedimentos", destino = "#/procedimentos") => h("a", { class: "btn sec pequeno", href: destino, text: `‹ ${texto}` });

  // ---------- Lista ----------
  async function desenharLista() {
    const minha = ++geracao;
    zona.replaceChildren(carregando());
    let r;
    try { r = await pedir("procedimentos", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError" && minha === geracao) zona.replaceChildren(erroEcra(e, desenharLista)); return; }
    if (minha !== geracao) return;
    tipos = r?.tipos ?? {};
    limites = { ...LIMITES, ...(r?.limites ?? {}) };
    const todos = lista(r, "procedimentos");
    const cartao = (p) => h("li", {}, h("a", { class: "cartao-proc", href: `#/procedimentos/${encodeURIComponent(p.id)}`, dataset: { id: String(p.id) } },
      h("strong", { text: p.titulo }),
      h("span", { class: "linha-selos" }, selo(p.tipo_nome ?? p.tipo),
        ceo ? selo(ESTADOS[p.estado] ?? p.estado, CLASSE_ESTADO[p.estado]) : null,
        ceo && p.por_rever ? selo("Por rever", "grav-critica") : null,
        ceo && p.estado === "publicado" && p.por_publicar ? selo("Alterações por publicar", "aviso") : null),
      h("span", { class: "ajuda", text: [`${p.n_passos} ${p.n_passos === 1 ? "passo" : "passos"}`, p.versao ? `versão ${p.versao}` : null,
        p.publicado ? `publicado em ${data(p.publicado, { hora: false })}` : null].filter(Boolean).join(" · ") })));
    const grupo = (titulo, itens) => (itens.length ? [h("h2", { text: titulo }), h("ul", { class: "lista-proc" }, ...itens.map(cartao))] : []);
    const partes = ceo
      ? [...grupo("Publicados", todos.filter((p) => p.estado === "publicado")), ...grupo("Rascunhos", todos.filter((p) => p.estado === "rascunho")),
        ...grupo("Arquivados", todos.filter((p) => p.estado === "arquivado"))]
      : todos.length ? [h("ul", { class: "lista-proc", id: "lista-procedimentos" }, ...todos.map(cartao))] : [];
    zona.replaceChildren(
      h("div", { class: "ecra-topo" }, h("h1", { text: "Procedimentos" }),
        ceo ? h("a", { class: "btn", href: "#/procedimentos/novo", id: "novo-procedimento", text: "Novo procedimento" }) : null),
      h("p", { class: "ajuda", text: ceo ? "Como se faz cada tipo de trabalho. A equipa e os eletricistas externos só veem os publicados; os rascunhos e os arquivados só o CEO."
        : "Como se faz cada tipo de trabalho na Domus Energia. A checklist de cada obra começa-se na ficha da obra." }),
      ...(partes.length ? partes : [h("p", { class: "vazio", text: ceo ? "Sem procedimentos." : "Ainda não há procedimentos publicados." })]));
  }

  // ---------- Ver ----------
  async function desenharVer(id) {
    const minha = ++geracao;
    zona.replaceChildren(carregando());
    let p;
    try { p = await pedir(`procedimentos/${encodeURIComponent(id)}`, { sinal: ctrl.signal }); }
    catch (e) {
      if (e.name === "AbortError" || minha !== geracao) return;
      zona.replaceChildren(h("div", { class: "ecra-topo" }, voltar()), e.estado === 404 ? h("p", { class: "vazio", text: "Procedimento não encontrado." }) : erroEcra(e, () => desenharVer(id)));
      return;
    }
    if (minha !== geracao) return;
    mostrar(p);
  }

  function mostrar(p) {
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const estado = async (acao, texto, botao) => {
      botao.disabled = true; mensagem(msg, null);
      try { const novo = await pedir(`procedimentos/${encodeURIComponent(p.id)}/estado`, { corpo: { acao } }); avisar(texto); mostrar(novo); }
      catch (e) { botao.disabled = false; mensagem(msg, e.message); }
    };
    const botoes = [];
    if (ceo && p.estado !== "arquivado") {
      botoes.push(h("a", { class: "btn sec pequeno", href: `#/procedimentos/${encodeURIComponent(p.id)}/editar`, id: "editar-procedimento", text: "Editar" }));
      if (p.estado === "rascunho" || p.por_publicar) {
        const nome = p.estado === "publicado" ? `Publicar a versão ${p.versao + 1}` : "Publicar";
        botoes.push(botaoConfirmar(nome, "Confirmar: publicar para a equipa?", (b) => estado("publicar", "Procedimento publicado.", b), { classe: "btn pequeno" }));
      }
      botoes.push(botaoConfirmar("Arquivar", "Confirmar: arquivar?", (b) => estado("arquivar", "Procedimento arquivado.", b)));
    }
    if (ceo && p.estado === "arquivado") botoes.push(botaoConfirmar("Repor como rascunho", "Confirmar: repor?", (b) => estado("repor", "Procedimento reposto como rascunho.", b)));
    const passos = p.passos ?? [];
    zona.replaceChildren(
      h("div", { class: "ecra-topo" }, voltar(), botoes.length ? h("div", { class: "form-botoes" }, ...botoes) : null),
      h("article", { class: "cartao procedimento", id: "procedimento" },
        h("h1", { text: p.titulo }),
        h("p", { class: "linha-selos" }, selo(p.tipo_nome ?? p.tipo), ceo ? selo(ESTADOS[p.estado] ?? p.estado, CLASSE_ESTADO[p.estado]) : null, p.versao ? selo(`Versão ${p.versao}`, "valor") : null),
        p.aviso ? h("p", { class: "msg erro", id: "aviso-rascunho", role: "note", text: p.aviso }) : null,
        ceo && p.estado === "publicado" && p.por_publicar ? h("p", { class: "msg info", role: "note", text: `Há alterações por publicar: a equipa continua a ver a versão ${p.versao} até publicar.` }) : null,
        p.publicado ? h("p", { class: "ajuda", text: `Versão ${p.versao}, publicada em ${data(p.publicado)}${p.publicado_por ? ` por ${p.publicado_por}` : ""}.` }) : null,
        ceo && p.em_obras ? h("p", { class: "ajuda", text: `Em uso em ${p.em_obras} ${p.em_obras === 1 ? "obra" : "obras"}: cada checklist fica com a versão com que começou.` }) : null,
        p.descricao ? h("p", { class: "proc-descricao", text: p.descricao }) : null,
        h("h2", { text: "Passos" }),
        passos.length ? h("ol", { class: "proc-passos" }, ...passos.map((x) => h("li", {},
          h("span", { class: "proc-texto", text: x.texto }), " ", ...selosPasso(x),
          x.nota ? h("p", { class: "ajuda proc-nota", text: x.nota }) : null))) : h("p", { class: "vazio", text: "Sem passos." }),
        msg));
  }

  // ---------- Editar (CEO) ----------
  async function desenharEditor(id) {
    const minha = ++geracao;
    if (!ceo) { zona.replaceChildren(h("div", { class: "ecra-topo" }, voltar()), h("p", { class: "vazio", text: "Só o CEO edita os procedimentos." })); return; }
    zona.replaceChildren(carregando());
    let p = { titulo: "", tipo: "outro", descricao: "", passos: [] };
    try {
      if (!Object.keys(tipos).length) { const r = await pedir("procedimentos", { sinal: ctrl.signal }); tipos = r?.tipos ?? {}; limites = { ...LIMITES, ...(r?.limites ?? {}) }; }
      if (id) p = await pedir(`procedimentos/${encodeURIComponent(id)}`, { sinal: ctrl.signal });
    } catch (e) { if (e.name !== "AbortError" && minha === geracao) zona.replaceChildren(h("div", { class: "ecra-topo" }, voltar()), erroEcra(e, () => desenharEditor(id))); return; }
    if (minha !== geracao) return;

    const passos = (p.passos ?? []).map((x) => ({ texto: x.texto ?? "", nota: x.nota ?? "", obrigatorio: !!x.obrigatorio, seguranca: !!x.seguranca }));
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const zonaPassos = h("ol", { class: "proc-editor", id: "passos-editor" });
    const conta = h("span", { class: "ajuda", role: "status" });
    /** Passa para `passos` o que está escrito nos campos (antes de mexer na ordem ou de guardar). */
    const ler = () => zonaPassos.querySelectorAll("li[data-i]").forEach((li) => {
      const x = passos[Number(li.dataset.i)];
      x.texto = li.querySelector("[name=texto]").value; x.nota = li.querySelector("[name=nota]").value;
      x.obrigatorio = li.querySelector("[name=obrigatorio]").checked; x.seguranca = li.querySelector("[name=seguranca]").checked;
    });
    /** Redesenha os passos; `foco`: [índice, nome do controlo] a focar depois (teclado: o passo movido continua em foco). */
    function desenharPassos(foco = null) {
      zonaPassos.replaceChildren(...passos.map((x, i) => {
        const n = i + 1;
        const mover = (para, nome) => { ler(); [passos[i], passos[para]] = [passos[para], passos[i]]; desenharPassos([para, nome]); };
        const obrigatorio = h("input", { type: "checkbox", name: "obrigatorio", checked: x.obrigatorio });
        // Um passo de segurança é sempre obrigatório.
        const seguranca = h("input", { type: "checkbox", name: "seguranca", checked: x.seguranca, onchange: (e) => { if (e.target.checked) obrigatorio.checked = true; } });
        return h("li", { class: "proc-passo", dataset: { i: String(i) } },
          h("div", { class: "proc-passo-topo" }, h("strong", { text: `Passo ${n}` }),
            h("div", { class: "proc-ordem" },
              h("button", { class: "botao-icone pequeno", type: "button", name: "subir", "aria-label": `Subir o passo ${n}`, title: "Subir", text: "↑", disabled: i === 0, onclick: () => mover(i - 1, "subir") }),
              h("button", { class: "botao-icone pequeno", type: "button", name: "descer", "aria-label": `Descer o passo ${n}`, title: "Descer", text: "↓", disabled: i === passos.length - 1, onclick: () => mover(i + 1, "descer") }),
              h("button", { class: "botao-icone pequeno", type: "button", name: "tirar", "aria-label": `Tirar o passo ${n}`, title: "Tirar", text: "×", onclick: () => { ler(); passos.splice(i, 1); desenharPassos(passos.length ? [Math.min(i, passos.length - 1), "texto"] : null); } }))),
          campoForm("O que fazer", h("textarea", { name: "texto", rows: "2", maxlength: String(limites.passo), required: true }, x.texto)),
          campoForm("Nota (opcional)", h("textarea", { name: "nota", rows: "2", maxlength: String(limites.nota) }, x.nota)),
          h("div", { class: "caixas" }, h("label", { class: "caixa" }, seguranca, "Segurança"), h("label", { class: "caixa" }, obrigatorio, "Obrigatório")));
      }));
      conta.textContent = `${passos.length} de ${limites.passos} passos`;
      juntar.disabled = passos.length >= limites.passos;
      if (foco) {
        const alvo = zonaPassos.querySelector(`li[data-i="${foco[0]}"] [name=${foco[1]}]`);
        // O botão ficou desligado (o passo chegou ao cimo ou ao fim): o foco passa para o outro sentido.
        (alvo && !alvo.disabled ? alvo : zonaPassos.querySelector(`li[data-i="${foco[0]}"] [name=${foco[1] === "subir" ? "descer" : "subir"}]`))?.focus();
      }
    }
    const juntar = h("button", { class: "btn sec pequeno", type: "button", id: "juntar-passo", text: "Acrescentar passo", onclick: () => { ler(); passos.push({ texto: "", nota: "", obrigatorio: false, seguranca: false }); desenharPassos([passos.length - 1, "texto"]); } });
    desenharPassos();

    const destino = id ? `#/procedimentos/${encodeURIComponent(id)}` : "#/procedimentos";
    const f = h("form", { class: "form-grelha cartao", id: "form-procedimento", novalidate: true },
      p.aviso ? h("p", { class: "msg erro", role: "note", text: p.aviso }) : null,
      id && p.estado === "publicado" ? h("p", { class: "msg info", role: "note", text: `Publicado (versão ${p.versao}): o que guardar aqui só chega à equipa quando publicar a versão ${p.versao + 1}.` }) : null,
      campoForm("Título", h("input", { name: "titulo", maxlength: String(limites.titulo), required: true, value: p.titulo ?? "" })),
      campoForm("Tipo de trabalho", escolha("tipo", tipos, p.tipo)),
      campoForm("Para que serve (opcional)", h("textarea", { name: "descricao", rows: "3", maxlength: String(limites.descricao) }, p.descricao ?? "")),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Passos, pela ordem em que se fazem" }), zonaPassos,
        h("div", { class: "form-botoes" }, juntar, conta)),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Guardar" }), h("a", { class: "btn sec", href: destino, text: "Cancelar" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      ler();
      const titulo = f.elements.titulo.value.trim();
      if (!titulo) { mensagem(msg, "Escreva o título."); f.elements.titulo.focus(); return; }
      const vazio = passos.findIndex((x) => !x.texto.trim());
      if (vazio >= 0) { mensagem(msg, `Escreva o que fazer no passo ${vazio + 1} (ou tire-o).`); zonaPassos.querySelector(`li[data-i="${vazio}"] [name=texto]`)?.focus(); return; }
      const corpo = { titulo, tipo: f.elements.tipo.value, descricao: f.elements.descricao.value.trim() || null,
        passos: passos.map((x) => ({ texto: x.texto.trim().replace(/\s+/g, " "), nota: x.nota.trim() || null, obrigatorio: x.obrigatorio, seguranca: x.seguranca })) };
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir(id ? `procedimentos/${encodeURIComponent(id)}` : "procedimentos", { corpo });
        avisar(r.estado === "publicado" ? "Guardado. Falta publicar para a equipa ver." : "Procedimento guardado.");
        ctx.navegar(`procedimentos/${encodeURIComponent(r.id)}`);
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    zona.replaceChildren(h("div", { class: "ecra-topo" }, h("h1", { text: id ? "Editar procedimento" : "Novo procedimento" }), voltar(id ? "Voltar" : "Procedimentos", destino)), f);
    if (!id) f.elements.titulo.focus();
  }

  const api = {
    rota(resto) {
      if (!resto[0]) desenharLista();
      else if (resto[0] === "novo") desenharEditor(null);
      else if (resto[1] === "editar") desenharEditor(resto[0]);
      else desenharVer(resto[0]);
    },
    desmontar: () => ctrl.abort(),
  };
  api.rota(ctx.resto);
  return api;
}
