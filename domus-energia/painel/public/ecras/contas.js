// Contas de cliente (CEO; docs/CONTA-CLIENTE.md): quem criou conta no simulador — email, confirmado, pedidos,
// casa ligada. Desativar/reativar (fecha as sessões) e apagar a conta com os dados pessoais (RGPD): a conta, a
// simulação guardada, as credenciais da casa e os pedidos que não chegaram a obra (com as fotos).
import { pedir, campo, lista } from "../api.js";
import { h, data, selo, avisar, carregando, erroEcra, txt, botaoConfirmar, janela, campoForm, mensagem } from "../ui.js";

export default function contas(el) {
  const ctrl = new AbortController();
  let todos = [];
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar email ou nome", "aria-label": "Procurar conta", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", {}, carregando());
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Contas de clientes" })),
    h("p", { class: "ajuda", text: "Contas criadas no simulador (site). Não dão acesso a este painel. Apagar tira a conta e os dados pessoais; os pedidos com pagamentos ficam anonimizados e os que chegaram a obra ficam (sem a conta)." }),
    h("div", { class: "filtros" }, fTexto), contagem, zona);
  fTexto.addEventListener("input", desenhar);

  async function carregar() {
    try { todos = lista(await pedir("contas", { sinal: ctrl.signal }), "contas"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  async function acao(c, caminho, corpo, texto) {
    try {
      const r = await pedir(caminho, { corpo });
      todos = lista(r, "contas");
      avisar(texto);
      desenhar();
    } catch (e) { avisar(e.message, "erro"); }
  }

  function desenhar() {
    const t = fTexto.value.trim().toLowerCase();
    const vis = todos.filter((c) => !t || [campo(c, "email"), campo(c, "nome")].some((v) => String(v ?? "").toLowerCase().includes(t)));
    contagem.textContent = `${vis.length} ${vis.length === 1 ? "conta" : "contas"}`;
    if (!vis.length) { zona.replaceChildren(h("p", { class: "vazio", text: todos.length ? "Nada com esta procura." : "Ainda não há contas de clientes." })); return; }
    zona.replaceChildren(h("ul", { class: "linhas contas", id: "lista-contas-clientes" }, ...vis.map((c) => {
      const id = String(campo(c, "id"));
      const ativo = campo(c, "ativo") !== false;
      const email = txt(c, "email");
      return h("li", { class: `linha conta ${ativo ? "" : "inativa"}`.trim(), dataset: { id } },
        h("span", { class: "linha-principal" },
          h("strong", { text: email }),
          campo(c, "nome") ? h("span", { class: "ajuda", text: txt(c, "nome") }) : null,
          h("span", { class: "ajuda", text: `Criada em ${data(campo(c, "criado"), { hora: false })}${campo(c, "ultimo_acesso") ? ` · último acesso ${data(campo(c, "ultimo_acesso"))}` : ""}` })),
        h("span", { class: "linha-selos" },
          campo(c, "confirmado") ? selo("Email confirmado", "estado-ativo") : selo("Email por confirmar", "info"),
          selo(`${campo(c, "n_pedidos") ?? 0} ${campo(c, "n_pedidos") === 1 ? "pedido" : "pedidos"}`, "info"),
          campo(c, "casa") ? selo(`Casa: ${txt(c, "casa")}`, "valor") : null,
          ativo ? null : selo("Desativada", "estado-suspenso")),
        h("span", { class: "conta-acoes" },
          ativo
            ? botaoConfirmar("Desativar", "Confirmar: desativar?", () => acao(c, `contas/${encodeURIComponent(id)}`, { ativo: false }, `${email} já não consegue entrar.`), { classe: "btn sec pequeno" })
            : h("button", { class: "btn sec pequeno", type: "button", text: "Reativar", onclick: () => acao(c, `contas/${encodeURIComponent(id)}`, { ativo: true }, `${email} pode entrar de novo.`) }),
          h("button", { class: "btn perigo pequeno", type: "button", text: "Apagar (RGPD)", "aria-label": `Apagar (RGPD): ${email}`, onclick: () => confirmarApagar(id, email) })));
    })));
  }

  /** Apagar (RGPD) é irreversível: o CEO escreve o email da conta para confirmar (o servidor volta a verificar). */
  function confirmarApagar(id, email) {
    const j = janela("Apagar conta (RGPD)");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const inp = h("input", { name: "email", type: "email", autocomplete: "off", spellcheck: "false", maxlength: "254", required: true, id: "apagar-email" });
    const f = h("form", { class: "form-grelha", id: "form-apagar-conta", novalidate: true },
      h("p", { text: `Apaga a conta ${email} e os dados pessoais (simulação guardada, credenciais da casa, fotos e os pedidos que não chegaram a obra). Os pedidos com pagamentos pagos ficam ANONIMIZADOS, com os pagamentos, para a contabilidade (10 anos); os que chegaram a obra ficam sem a conta. Não se pode desfazer.` }),
      campoForm("Para confirmar, escreva o email da conta", inp, email),
      h("div", { class: "form-botoes" },
        h("button", { class: "btn perigo", type: "submit", text: "Apagar definitivamente" }),
        h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => j.fechar() })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (inp.value.trim().toLowerCase() !== email.toLowerCase()) { mensagem(msg, "O email escrito não é o desta conta."); inp.focus(); return; }
      const b = f.querySelector("button[type=submit]");
      b.disabled = true;
      mensagem(msg, null);
      try {
        const r = await pedir(`contas/${encodeURIComponent(id)}/apagar`, { corpo: { email: inp.value.trim() } });
        todos = lista(r, "contas");
        j.fechar();
        const n = Number(campo(r, "pedidos_anonimizados")) || 0;
        avisar(`Conta ${email} apagada.${n ? ` ${n} ${n === 1 ? "pedido ficou anonimizado" : "pedidos ficaram anonimizados"} (com os pagamentos).` : ""}`);
        desenhar();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    j.corpo.append(f);
    inp.focus();
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
