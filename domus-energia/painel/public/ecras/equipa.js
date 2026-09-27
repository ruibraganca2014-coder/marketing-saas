// Equipa (CEO): contas do painel — criar, mudar papel, desativar/reativar, repor palavra-passe.
// A palavra-passe nova (conta criada ou reposta) aparece uma vez.
import { pedir, campo, lista, idPedido, palavraPasse } from "../api.js";
import { h, PAPEIS, data, selo, campoForm, escolha, janela, mensagem, avisar, carregando, erroEcra, txt, botaoConfirmar, mostrarPalavraPasse } from "../ui.js";

export default function equipa(el, ctx) {
  const ctrl = new AbortController();
  let todos = [];
  const zona = h("div", {}, carregando());
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Equipa" }), h("button", { class: "btn", type: "button", id: "novo-utilizador", text: "Nova conta", onclick: abrirNova })),
    h("p", { class: "ajuda", text: "Contas do painel da empresa. O papel decide o que cada pessoa vê e pode fazer." }), zona);

  async function carregar() {
    try { todos = lista(await pedir("utilizadores", { sinal: ctrl.signal }), "utilizadores"); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    desenhar();
  }

  const resultado = (r, quem) => {
    const senha = palavraPasse(r);
    if (senha) mostrarPalavraPasse(`Palavra-passe de ${quem}`, senha, { utilizador: quem, texto: "Entregue-a pessoalmente. A pessoa deve mudá-la no primeiro acesso." });
    else if (idPedido(r, { solto: false })) ctx.acompanharPedido(idPedido(r, { solto: false }), { descricao: `Conta ${quem}`, utilizador: quem });
  };

  async function alterar(u, corpo, texto) {
    const id = campo(u, "id");
    try {
      const r = await pedir(`utilizadores/${encodeURIComponent(id)}`, { corpo });
      resultado(r, campo(u, "email") ?? campo(u, "nome"));
      avisar(texto);
      await carregar();
    } catch (e) { avisar(e.message, "erro"); }
  }

  function desenhar() {
    if (!todos.length) { zona.replaceChildren(h("p", { class: "vazio", text: "Ainda não há contas." })); return; }
    zona.replaceChildren(h("ul", { class: "linhas contas", id: "lista-utilizadores" }, ...todos.map((u) => {
      const id = String(campo(u, "id"));
      const ativo = campo(u, "ativo") !== false && campo(u, "ativo") !== 0;
      const eu = id === String(ctx.eu.id);
      const papel = escolha("papel", PAPEIS, campo(u, "papel"), { "aria-label": `Papel de ${txt(u, "nome")}`, disabled: eu || !ativo });
      papel.addEventListener("change", () => alterar(u, { papel: papel.value }, `Papel de ${txt(u, "nome")} mudado para ${PAPEIS[papel.value]}.`));
      return h("li", { class: `linha conta ${ativo ? "" : "inativa"}`.trim(), dataset: { id } },
        h("span", { class: "linha-principal" },
          h("strong", { text: `${txt(u, "nome")}${eu ? " (a sua conta)" : ""}` }),
          h("span", { class: "ajuda", text: txt(u, "email") }),
          h("span", { class: "ajuda", text: campo(u, "ultimo_acesso", "ultimo_login") ? `Último acesso: ${data(campo(u, "ultimo_acesso", "ultimo_login"))}`
            : "ultimo_acesso" in u ? "Ainda não entrou" : campo(u, "criado") ? `Conta criada em ${data(campo(u, "criado"), { hora: false })}` : "" })),
        h("span", { class: "linha-selos" }, ativo ? selo("Ativa", "estado-ativo") : selo("Desativada", "estado-suspenso")),
        h("span", { class: "conta-acoes" },
          h("label", { class: "campo compacto" }, h("span", { class: "so-leitor", text: "Papel" }), papel),
          botaoConfirmar("Repor palavra-passe", "Confirmar reposição?", () => alterar(u, { repor_password: true }, "Palavra-passe reposta."), { disabled: !ativo }),
          eu ? null : ativo
            ? botaoConfirmar("Desativar", "Confirmar: desativar?", () => alterar(u, { ativo: false }, `${txt(u, "nome")} já não consegue entrar.`), { classe: "btn perigo pequeno" })
            : h("button", { class: "btn sec pequeno", type: "button", text: "Reativar", onclick: () => alterar(u, { ativo: true }, `${txt(u, "nome")} pode entrar de novo.`) })));
    })));
  }

  function abrirNova() {
    const j = janela("Nova conta do painel");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const f = h("form", { class: "form-grelha", id: "form-novo-utilizador", novalidate: true },
      campoForm("Nome", h("input", { name: "nome", required: true, maxlength: "120", autocomplete: "off" })),
      campoForm("Email", h("input", { name: "email", type: "email", required: true, maxlength: "200", autocomplete: "off" })),
      campoForm("Papel", escolha("papel", PAPEIS, "tecnico")),
      h("p", { class: "ajuda", text: "A palavra-passe é gerada pelo servidor e aparece a seguir, uma só vez." }),
      h("div", { class: "form-botoes" }, h("button", { class: "btn", type: "submit", text: "Criar conta" })),
      msg);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const el = f.elements;
      const corpo = { nome: el.nome.value.trim(), email: el.email.value.trim().toLowerCase(), papel: el.papel.value };
      if (!corpo.nome) { mensagem(msg, "Escreva o nome."); el.nome.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corpo.email)) { mensagem(msg, "Escreva um email válido."); el.email.focus(); return; }
      const b = f.querySelector("button[type=submit]"); b.disabled = true; mensagem(msg, null);
      try {
        const r = await pedir("utilizadores", { corpo });
        j.fechar();
        resultado(r, corpo.email);
        avisar(`Conta de ${corpo.nome} criada.`);
        carregar();
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    j.corpo.append(f);
    f.elements.nome.focus();
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
