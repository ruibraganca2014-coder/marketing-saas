// Contas de cliente (CEO; docs/CONTA-CLIENTE.md): quem criou conta no simulador — email, confirmado, pedidos,
// casa ligada. Desativar/reativar (fecha as sessões) e apagar a conta com os dados pessoais (RGPD): a conta, a
// simulação guardada, as credenciais da casa e os pedidos que não chegaram a obra (com as fotos).
import { pedir, campo, lista } from "../api.js";
import { h, data, selo, avisar, carregando, erroEcra, txt, botaoConfirmar } from "../ui.js";

export default function contas(el) {
  const ctrl = new AbortController();
  let todos = [];
  const fTexto = h("input", { type: "search", name: "procurar", placeholder: "Procurar email ou nome", "aria-label": "Procurar conta", maxlength: "80" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", {}, carregando());
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Contas de clientes" })),
    h("p", { class: "ajuda", text: "Contas criadas no simulador (site). Não dão acesso a este painel. Apagar tira a conta e os dados pessoais; os pedidos que chegaram a obra ficam (sem a conta)." }),
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
          botaoConfirmar("Apagar (RGPD)", "Confirmar: apagar tudo?", () => acao(c, `contas/${encodeURIComponent(id)}/apagar`, {}, `Conta ${email} apagada.`), { classe: "btn perigo pequeno" })));
    })));
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
