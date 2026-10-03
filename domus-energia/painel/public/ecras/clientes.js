// Casas e planos (o antigo ecrã "Clientes": as casas com conta e plano; a rota #/clientes e a API `clientes` não
// mudaram): lista com filtros (plano, estado, texto) e ficha, com a ligação à ficha da pessoa no CRM. "Novo cliente"
// (CEO, comercial) pede a criação ao servidor (pedido-admin); a palavra-passe gerada aparece uma vez quando o pedido for feito.
import { pedir, campo, lista, numero, idPedido, palavraPasse } from "../api.js";
import { h, PLANOS, ESTADOS_CLIENTE, ESTADOS_OBRA, KITS, GRAVIDADES, gravidadeDe, nomeDe, euros, num, data, selo, campoForm, escolha, dados,
  janela, mensagem, avisar, carregando, erroEcra, txt, mostrarPalavraPasse } from "../ui.js";

export const RE_CODIGO = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export default function clientes(el, ctx) {
  const ctrl = new AbortController();
  let todos = [];
  let ficha = null;

  const fPlano = escolha("plano", { "": "Todos os planos", ...PLANOS }, "", { "aria-label": "Filtrar por plano" });
  const fEstado = escolha("estado", { "": "Todos os estados", ...ESTADOS_CLIENTE }, "", { "aria-label": "Filtrar por estado" });
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar nome, código ou localidade", "aria-label": "Procurar cliente", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "zona-lista" }, carregando());
  const novo = ctx.pode("ceo", "comercial") ? h("button", { class: "btn", type: "button", id: "novo-cliente", text: "Novo cliente", onclick: abrirNovo }) : null;

  el.append(
    h("div", { class: "ecra-topo" }, h("h1", { text: "Casas e planos" }), novo),
    h("div", { class: "filtros" }, fTexto, fPlano, fEstado),
    contagem, zona);
  for (const f of [fPlano, fEstado]) f.addEventListener("change", desenhar);
  fTexto.addEventListener("input", desenhar);

  async function carregar() {
    zona.replaceChildren(carregando());
    try { todos = lista(await pedir("clientes", { sinal: ctrl.signal }), "clientes"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  function desenhar() {
    const t = fTexto.value.trim().toLowerCase();
    const vis = todos.filter((c) =>
      (!fPlano.value || campo(c, "plano") === fPlano.value)
      && (!fEstado.value || campo(c, "estado") === fEstado.value)
      && (!t || [campo(c, "nome"), campo(c, "codigo"), campo(c, "localidade")].some((v) => String(v ?? "").toLowerCase().includes(t))));
    contagem.textContent = vis.length === todos.length ? `${todos.length} ${todos.length === 1 ? "cliente" : "clientes"}` : `${vis.length} de ${todos.length} clientes`;
    if (!vis.length) { zona.replaceChildren(h("p", { class: "vazio", text: todos.length ? "Nenhum cliente com estes filtros." : "Ainda não há clientes." })); return; }
    zona.replaceChildren(h("ul", { class: "linhas", id: "lista-clientes" }, ...vis.map(linha)));
  }

  function linha(c) {
    const codigo = String(campo(c, "codigo") ?? "");
    const alertas = numero(campo(c, "alertas"));
    const estado = campo(c, "pendente") === true ? "pendente" : campo(c, "estado");
    const mensal = campo(c, "valor_mensal_iva", "valor_mensal");
    return h("li", {}, h("a", { class: "linha", href: `#/clientes/${encodeURIComponent(codigo)}`, dataset: { codigo } },
      h("span", { class: "linha-principal" }, h("strong", { text: txt(c, "nome", "codigo") }), h("span", { class: "ajuda", text: `${codigo} · ${txt(c, "localidade")}` })),
      h("span", { class: "linha-selos" },
        selo(nomeDe(PLANOS, campo(c, "plano")), "plano"),
        selo(nomeDe(ESTADOS_CLIENTE, estado), `estado-${estado ?? ""}`),
        alertas ? selo(`${alertas} ${alertas === 1 ? "alerta" : "alertas"}`, "aviso") : null),
      h("span", { class: "linha-extra ajuda" },
        campo(c, "proximo_pagamento") ? `Próximo pagamento: ${data(campo(c, "proximo_pagamento"), { hora: false })}` : "",
        mensal !== undefined ? ` · ${euros(mensal)}/mês` : "")));
  }

  // ---------- Ficha ----------
  async function abrirFicha(codigo) {
    if (ficha?.codigo === codigo) return;
    ficha?.j.fechar();
    const j = janela("Cliente", { larga: true, aoFechar: () => { if (ficha?.j === j) ficha = null; if (location.hash === `#/clientes/${encodeURIComponent(codigo)}`) ctx.navegar("clientes"); } });
    ficha = { codigo, j };
    j.corpo.append(carregando());
    let c;
    try { c = await pedir(`clientes/${encodeURIComponent(codigo)}`); }
    catch (e) { j.corpo.replaceChildren(erroEcra(e)); return; }
    c = campo(c, "cliente") ?? c;
    j.titulo.textContent = txt(c, "nome", "codigo");
    desenharFicha(j, c, codigo);
  }

  function desenharFicha(j, c, codigo) {
    const aparelhos = campo(c, "aparelhos");
    const nAparelhos = Array.isArray(aparelhos) ? aparelhos.length : campo(c, "n_aparelhos") ?? aparelhos;
    const alertasV = campo(c, "alertas_lista") ?? campo(c, "alertas");
    const alertas = Array.isArray(alertasV) ? alertasV : [];
    const obras = lista(campo(c, "obras") ?? [], "obras");
    const origem = campo(c, "orcamento_origem", "orcamento", "pedido_orcamento");
    const estado = campo(c, "pendente") === true ? "pendente" : campo(c, "estado");
    const mensal = campo(c, "valor_mensal_iva", "valor_mensal");
    const pagos = Array.isArray(campo(c, "pagamentos")) ? campo(c, "pagamentos") : [];
    const partes = [
      h("div", { class: "linha-selos" }, selo(nomeDe(PLANOS, campo(c, "plano")), "plano"), selo(nomeDe(ESTADOS_CLIENTE, estado), `estado-${estado ?? ""}`)),
      dados([
        ["Código", codigo],
        ["Contacto", txt(c, "contacto", "telefone", "email")],
        ["Localidade", txt(c, "localidade")],
        ["Próximo pagamento", data(campo(c, "proximo_pagamento"), { hora: false })],
        mensal !== undefined ? ["Valor mensal", `${euros(mensal)}${campo(c, "valor_mensal_sem_iva") !== undefined ? ` (${euros(campo(c, "valor_mensal_sem_iva"))} sem IVA)` : ""}`] : null,
        campo(c, "total_pago", "total_recebido", "receita_total") !== undefined ? ["Total recebido", euros(campo(c, "total_pago", "total_recebido", "receita_total"))] : null,
        ["Aparelhos", num(nAparelhos)],
      ]),
    ];
    // A ficha da mesma pessoa no CRM (contactos, pedidos, notas), quando há uma ligada a esta casa.
    const crmId = campo(c, "crm_cliente_id");
    if (crmId) partes.push(h("div", { class: "form-botoes" }, h("a", { class: "btn sec pequeno", id: "abrir-ficha-crm", href: `#/crm/${encodeURIComponent(crmId)}`, text: "Abrir a ficha no CRM" })));
    if (estado === "pendente") partes.push(h("p", { class: "msg info", text: "A conta ainda está a ser criada no servidor." }));
    if (Array.isArray(aparelhos) && aparelhos.length) {
      partes.push(h("h3", { text: "Aparelhos" }), h("ul", { class: "lista-simples" }, ...aparelhos.map((a) =>
        h("li", {}, typeof a === "object" ? `${txt(a, "nome", "id")} (${txt(a, "id")}) · ${txt(a, "divisao")}` : String(a)))));
    }
    partes.push(h("h3", { text: "Alertas" }), alertas.length
      ? h("ul", { class: "lista-simples" }, ...alertas.map((a) => h("li", {}, selo(GRAVIDADES[gravidadeDe(campo(a, "gravidade"))], `grav-${gravidadeDe(campo(a, "gravidade"))}`), " ", txt(a, "mensagem", "texto", "tipo"))))
      : h("p", { class: "vazio", text: "Sem alertas." }));
    partes.push(h("h3", { text: "Obras" }), obras.length
      ? h("ul", { class: "lista-simples" }, ...obras.map((o) => h("li", {},
          h("a", { href: `#/obras/${encodeURIComponent(campo(o, "id") ?? "")}`, text: `${data(campo(o, "data"), { hora: false })} · ${nomeDe(KITS, campo(o, "kit"))}` }),
          " ", selo(nomeDe(ESTADOS_OBRA, campo(o, "estado")), `obra-${campo(o, "estado") ?? ""}`))))
      : h("p", { class: "vazio", text: "Sem obras." }));
    if (pagos.length) {
      partes.push(h("h3", { text: "Últimos pagamentos" }), h("ul", { class: "lista-simples" }, ...pagos.slice(0, 6).map((p) =>
        h("li", { text: `${data(campo(p, "data"), { hora: false })} · ${nomeDe(PLANOS, campo(p, "plano"))} · ${euros(campo(p, "valor_com_iva", "valor"))}` }))));
    }
    if (origem) {
      const oid = typeof origem === "object" ? campo(origem, "id") : origem;
      partes.push(h("h3", { text: "Pedido de orçamento de origem" }),
        ctx.pode("ceo", "comercial")
          ? h("a", { href: `#/orcamentos/${encodeURIComponent(oid)}`, text: typeof origem === "object" ? `${txt(origem, "servico")} · ${data(campo(origem, "criado"), { hora: false })}` : `Pedido ${oid}` })
          : h("p", { text: typeof origem === "object" ? txt(origem, "servico") : `Pedido ${oid}` }));
    }
    const acoes = h("div", { class: "form-botoes" });
    if (ctx.pode("ceo", "tecnico")) acoes.append(h("button", { class: "btn sec pequeno", type: "button", id: "pedir-aparelho", text: "Adicionar aparelho", onclick: () => formAparelho(j, codigo) }));
    if (ctx.pode("ceo")) acoes.append(h("button", { class: "btn sec pequeno", type: "button", id: "mudar-plano", text: "Mudar plano", onclick: () => formPlano(j, codigo, campo(c, "plano")) }));
    if (acoes.childElementCount) partes.push(acoes);
    partes.push(h("div", { class: "sub-form", id: "ficha-form" }));
    j.corpo.replaceChildren(...partes);
  }

  function formAparelho(j, codigo) {
    const zonaF = j.corpo.querySelector("#ficha-form");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const f = h("form", { class: "form-grelha", novalidate: true },
      h("h3", { text: "Pedir aparelho novo" }),
      h("div", { class: "duas" },
        campoForm("Id do aparelho", h("input", { name: "id", required: true, maxlength: "32", placeholder: "ex.: sala-4g", autocapitalize: "none" }), "Letras minúsculas, números e -"),
        campoForm("Tipo", escolha("tipo", { shelly: "Shelly", openbeken: "OpenBeken" }, "shelly"))),
      h("div", { class: "duas" },
        campoForm("Nome", h("input", { name: "nome", required: true, maxlength: "60" })),
        campoForm("Divisão", h("input", { name: "divisao", maxlength: "40" }))),
      campoForm("Canais (opcional)", h("input", { name: "canais", maxlength: "300", placeholder: "1:interruptor:Teto,2:interruptor:Candeeiro" }), "Como no domus.sh: n.º:função:nome"),
      h("div", { class: "caixas" },
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "medidor" }), "Tem medidor de energia"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "geral" }), "É o medidor geral da casa"),
        h("label", { class: "caixa" }, h("input", { type: "checkbox", name: "bateria" }), "A pilhas")),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Pedir aparelho" }), h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => zonaF.replaceChildren() })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const id = el.id.value.trim(), nome = el.nome.value.trim();
      if (!RE_CODIGO.test(id)) { mensagem(msg, "Id inválido: 1 a 32 letras minúsculas, números e '-' (sem '-' no início ou no fim)."); el.id.focus(); return; }
      if (!nome) { mensagem(msg, "Escreva o nome do aparelho."); el.nome.focus(); return; }
      if (el.geral.checked && !el.medidor.checked) { mensagem(msg, "O medidor geral tem de ter medidor de energia."); return; }
      const corpo = { id, tipo: el.tipo.value, nome, medidor: el.medidor.checked, geral: el.geral.checked, bateria: el.bateria.checked };
      if (el.divisao.value.trim()) corpo.divisao = el.divisao.value.trim();
      if (el.canais.value.trim()) corpo.canais = el.canais.value.trim();
      await enviarPedido(f, msg, `clientes/${encodeURIComponent(codigo)}/aparelhos`, corpo, `Aparelho ${id} de ${codigo}`, `${codigo}-${id}`, () => zonaF.replaceChildren(h("p", { class: "msg ok", text: "Pedido enviado. O servidor aplica-o em poucos segundos (~5 s)." })));
    });
    zonaF.replaceChildren(f);
    f.elements.id.focus();
  }

  function formPlano(j, codigo, atual) {
    const zonaF = j.corpo.querySelector("#ficha-form");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const f = h("form", { class: "form-grelha" },
      h("h3", { text: "Mudar plano à mão" }),
      campoForm("Plano", escolha("plano", PLANOS, atual ?? "base")),
      h("p", { class: "ajuda", text: "Use só quando o cliente não paga pelo site (ex.: pagamento por transferência)." }),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Pedir mudança" }), h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => zonaF.replaceChildren() })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      await enviarPedido(f, msg, `clientes/${encodeURIComponent(codigo)}/plano`, { plano: f.elements.plano.value }, `Plano de ${codigo}`, null, () => zonaF.replaceChildren(h("p", { class: "msg ok", text: "Pedido enviado. O plano muda quando o servidor o aplicar." })));
    });
    zonaF.replaceChildren(f);
  }

  /** POST de um pedido-admin; segue o resultado (palavra-passe uma vez). */
  async function enviarPedido(f, msg, caminho, corpo, descricao, utilizador, depois) {
    const b = f.querySelector("button[type=submit]");
    b.disabled = true; mensagem(msg, null);
    try {
      const r = await pedir(caminho, { corpo });
      const senha = palavraPasse(r);
      if (senha) mostrarPalavraPasse(`${descricao}: feito`, senha, { utilizador });
      else ctx.acompanharPedido(idPedido(r), { descricao, utilizador });
      depois?.(r);
      return r;
    } catch (e) {
      b.disabled = false;
      mensagem(msg, e.message);
      return null;
    }
  }

  // ---------- Novo cliente ----------
  function abrirNovo() {
    const j = janela("Novo cliente");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const f = h("form", { class: "form-grelha", novalidate: true, id: "form-novo-cliente" },
      campoForm("Nome", h("input", { name: "nome", required: true, maxlength: "120", autocomplete: "off" })),
      campoForm("Código do cliente", h("input", { name: "codigo", required: true, maxlength: "32", autocapitalize: "none", spellcheck: "false" }), "É o utilizador na app. Letras minúsculas, números e -, ex.: silva-braga"),
      campoForm("Contacto", h("input", { name: "contacto", maxlength: "200", placeholder: "Telefone ou email" })),
      campoForm("Localidade", h("input", { name: "localidade", maxlength: "120" })),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Pedir criação" })),
      msg);
    // Sugere o código a partir do nome (até a pessoa o escrever à mão).
    let codigoMexido = false;
    f.elements.codigo.addEventListener("input", () => { codigoMexido = true; });
    f.elements.nome.addEventListener("input", () => { if (!codigoMexido) f.elements.codigo.value = sugerirCodigo(f.elements.nome.value); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const corpo = { codigo: el.codigo.value.trim(), nome: el.nome.value.trim(), contacto: el.contacto.value.trim(), localidade: el.localidade.value.trim() };
      if (!corpo.nome) { mensagem(msg, "Escreva o nome do cliente."); el.nome.focus(); return; }
      if (!RE_CODIGO.test(corpo.codigo)) { mensagem(msg, "Código inválido: 1 a 32 letras minúsculas, números e '-' (sem '-' no início ou no fim)."); el.codigo.focus(); return; }
      const r = await enviarPedido(f, msg, "clientes", corpo, `Cliente ${corpo.codigo}`, corpo.codigo, () => {
        j.corpo.replaceChildren(
          h("p", { class: "msg ok", text: `Pedido enviado. O servidor cria a conta de ${corpo.nome} em poucos segundos (~5 s).` }),
          h("p", { text: "Quando estiver pronta, aparece aqui uma janela com a palavra-passe, só uma vez. Pode continuar a trabalhar." }),
          h("button", { class: "btn sec", type: "button", text: "Fechar", onclick: j.fechar }));
      });
      if (r) carregar();
    });
    j.corpo.append(f);
    f.elements.nome.focus();
  }

  carregar();
  const api = {
    rota(resto) { if (resto[0]) abrirFicha(resto[0]); else { ficha?.j.fechar(); ficha = null; } },
    desmontar: () => ctrl.abort(),
  };
  api.rota(ctx.resto);
  return api;
}

export function sugerirCodigo(nome) {
  return String(nome).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}
