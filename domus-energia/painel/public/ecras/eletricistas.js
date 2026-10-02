// Eletricistas externos (CEO; docs/ELETRICISTAS.md): candidaturas por decidir (ficha, documento do seguro, Aprovar /
// Recusar) e eletricistas (Suspender / Reativar, concelhos e percentagem da mão de obra — por omissão a da
// configuração, 70 %). A média das avaliações dos clientes chega numa ronda seguinte ("—" por agora).
import { pedir, campo, lista, numero } from "../api.js";
import { h, data, selo, dados, campoForm, janela, mensagem, avisar, carregando, erroEcra, botaoConfirmar } from "../ui.js";
import { CONCELHOS } from "../vendor/concelhos.js";

const ESTADOS = { pendente: ["Pendente", "aviso"], aprovado: ["Aprovado", "estado-ativo"], suspenso: ["Suspenso", "estado-suspenso"], recusado: ["Recusado", "estado-suspenso"] };
const NOMES = CONCELHOS.map((c) => c[0]);
const semAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pctTxt = (v) => String(v).replace(".", ",");
const mb = (b) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

export default function eletricistas(el) {
  const ctrl = new AbortController();
  let todos = [];
  let omissao = 70;
  const zona = h("div", {}, carregando());
  const entradaOmissao = h("input", { name: "eletricista_pct", type: "text", inputmode: "decimal", maxlength: "5", id: "pct-omissao", "aria-label": "Percentagem da mão de obra por omissão" });
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Eletricistas" })),
    h("p", { class: "ajuda", text: "Eletricistas externos: candidatam-se no site (Trabalhe connosco) e, depois de aprovados, entram na área do eletricista. Não têm acesso a este painel. Atribui-se um trabalho na ficha do pedido ou da obra." }),
    h("div", { class: "form-botoes pct-omissao" }, h("label", { for: "pct-omissao", text: "Percentagem da mão de obra por omissão" }),
      h("span", { class: "pct" }, entradaOmissao, " %"),
      h("button", { class: "btn sec pequeno", type: "button", id: "guardar-pct-omissao", text: "Guardar", onclick: guardarOmissao })),
    zona);

  function receber(r) {
    todos = lista(r, "eletricistas");
    omissao = numero(campo(r, "percentagem_omissao")) ?? omissao;
    entradaOmissao.value = pctTxt(omissao);
    desenhar();
  }
  async function carregar() {
    try { receber(await pedir("eletricistas", { sinal: ctrl.signal })); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); }
  }
  async function guardarOmissao() {
    const v = numero(entradaOmissao.value);
    if (v === null || v < 0 || v > 100) { avisar("A percentagem tem de ser um número entre 0 e 100.", "erro"); entradaOmissao.focus(); return; }
    try {
      await pedir("config-orcamento", { corpo: { eletricista_pct: v } });
      avisar(`Percentagem por omissão: ${pctTxt(v)} %. Vale para os trabalhos aceites a partir de agora.`);
      await carregar();
    } catch (e) { avisar(e.message, "erro"); }
  }
  async function alterar(e, corpo, texto, botao) {
    if (botao) botao.disabled = true;
    try {
      receber(await pedir(`eletricistas/${encodeURIComponent(e.id)}`, { corpo }));
      avisar(texto);
      return true;
    } catch (erro) {
      if (botao) botao.disabled = false;
      avisar(erro.message, "erro");
      return false;
    }
  }

  /** Campo "% mão de obra" do eletricista: vazio = a percentagem por omissão. */
  function campoPct(e) {
    const i = h("input", { type: "text", inputmode: "decimal", maxlength: "5", value: e.percentagem == null ? "" : pctTxt(e.percentagem), placeholder: pctTxt(omissao),
      "aria-label": `Percentagem da mão de obra de ${e.nome}`, dataset: { pct: String(e.id) } });
    i.addEventListener("change", () => {
      const txt = i.value.trim();
      const v = txt === "" ? null : numero(txt);
      if (txt !== "" && (v === null || v < 0 || v > 100)) { avisar("A percentagem tem de ser um número entre 0 e 100.", "erro"); i.focus(); return; }
      alterar(e, { percentagem: v }, v === null ? `${e.nome}: percentagem por omissão (${pctTxt(omissao)} %).` : `${e.nome}: ${pctTxt(v)} % da mão de obra, nos trabalhos aceites a partir de agora.`);
    });
    return h("span", { class: "pct" }, i, " %");
  }
  const documento = (e) => (e.seguro
    ? h("a", { class: "btn sec pequeno", href: e.seguro.url, target: "_blank", rel: "noopener", id: `seguro-${e.id}`,
      text: `${e.seguro.tipo === "application/pdf" ? "Descarregar o seguro (PDF" : "Ver o seguro (imagem"}, ${mb(e.seguro.bytes)})` })
    : h("span", { class: "ajuda", text: "Sem documento do seguro." }));
  const fichaDados = (e) => dados([
    ["Telefone", e.telefone], ["Email", e.email], ["NIF", e.nif], ["Habilitação DGEG", e.dgeg], ["Concelhos", e.concelhos.join(", ") || "—"],
    ["Experiência", [e.experiencia, e.notas].filter(Boolean).join(" · ") || "—"], ["Candidatura", data(e.criado)],
    e.decidido ? ["Decisão", data(e.decidido)] : null, e.ultimo_acesso ? ["Último acesso", data(e.ultimo_acesso)] : null,
  ]);

  function desenhar() {
    const pend = todos.filter((e) => e.estado === "pendente"), resto = todos.filter((e) => e.estado !== "pendente");
    const partes = [h("div", { class: "seccao-topo" }, h("h2", { text: `Candidaturas por decidir${pend.length ? ` · ${pend.length}` : ""}` }))];
    partes.push(pend.length ? h("div", { class: "candidaturas", id: "candidaturas" }, ...pend.map((e) => h("details", { class: "cartao candidatura", id: `cand-${e.id}`, dataset: { id: String(e.id) } },
      h("summary", {}, h("span", { class: "linha-principal" }, h("strong", { text: e.nome }), h("span", { class: "ajuda", text: `${e.concelhos.join(", ")} · DGEG ${e.dgeg}` })), selo("Pendente", "aviso")),
      fichaDados(e),
      h("div", { class: "form-botoes" }, documento(e)),
      h("div", { class: "form-botoes" }, h("span", { class: "ajuda", text: "% da mão de obra" }), campoPct(e)),
      h("div", { class: "form-botoes" },
        h("button", { class: "btn", type: "button", id: `aprovar-${e.id}`, text: "Aprovar", onclick: (ev) => alterar(e, { acao: "aprovar" }, `${e.nome} aprovado: recebeu o email com a ligação para a área do eletricista.`, ev.currentTarget) }),
        botaoConfirmar("Recusar", "Confirmar: recusar?", (b) => alterar(e, { acao: "recusar" }, `Candidatura de ${e.nome} recusada.`, b), { classe: "btn perigo pequeno" })))))
      : h("p", { class: "vazio", id: "sem-candidaturas", text: "Sem candidaturas por decidir." }));
    partes.push(h("div", { class: "seccao-topo" }, h("h2", { text: "Eletricistas externos" })));
    partes.push(resto.length ? h("ul", { class: "linhas contas", id: "lista-eletricistas" }, ...resto.map((e) => {
      const [nomeEstado, tipo] = ESTADOS[e.estado] ?? [e.estado, "info"];
      return h("li", { class: `linha conta ${e.estado === "aprovado" ? "" : "inativa"}`.trim(), dataset: { id: String(e.id) } },
        h("span", { class: "linha-principal" }, h("strong", { text: e.nome }), h("span", { class: "ajuda", text: e.concelhos.join(", ") || "Sem concelhos" }),
          h("span", { class: "ajuda", text: `${e.email} · ${e.telefone}` })),
        h("span", { class: "linha-selos" }, selo(nomeEstado, tipo), selo("Média —", "valor"),
          selo(`${e.trabalhos_em_curso} ${e.trabalhos_em_curso === 1 ? "trabalho em curso" : "trabalhos em curso"}`, "info"),
          e.trabalhos_largados ? selo(`${e.trabalhos_largados} ${e.trabalhos_largados === 1 ? "largado" : "largados"}`, "aviso") : null),
        h("span", { class: "conta-acoes" },
          h("span", { class: "ajuda", text: "% mão de obra" }), campoPct(e),
          h("button", { class: "btn sec pequeno", type: "button", text: "Ver ficha", "aria-label": `Ver ficha de ${e.nome}`, onclick: () => abrirFicha(e) }),
          e.estado === "aprovado" ? botaoConfirmar("Suspender", "Confirmar: suspender?", (b) => alterar(e, { acao: "suspender" }, `${e.nome} suspenso: deixa de entrar e de ver a bolsa.`, b))
            : e.estado === "suspenso" ? h("button", { class: "btn sec pequeno", type: "button", text: "Reativar", onclick: (ev) => alterar(e, { acao: "reativar" }, `${e.nome} pode entrar de novo.`, ev.currentTarget) })
              : h("button", { class: "btn sec pequeno", type: "button", text: "Aprovar", onclick: (ev) => alterar(e, { acao: "aprovar" }, `${e.nome} aprovado.`, ev.currentTarget) })));
    })) : h("p", { class: "vazio", text: "Ainda não há eletricistas aprovados." }));
    partes.push(h("p", { class: "ajuda", text: `A percentagem aplica-se aos trabalhos aceites a partir de agora (por omissão, ${pctTxt(omissao)} % da mão de obra sem IVA). Um eletricista suspenso deixa de entrar e de ver a bolsa.` }));
    zona.replaceChildren(...partes);
  }

  /** Ficha: dados, documento do seguro e os concelhos (editáveis). */
  function abrirFicha(e) {
    const j = janela(`Eletricista: ${e.nome}`, { larga: true });
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const escolhidos = new Set(e.concelhos);
    const procurar = h("input", { type: "search", placeholder: "Procurar concelho", "aria-label": "Procurar concelho", maxlength: "40" });
    const caixas = h("div", { class: "caixas concelhos-eletricista" });
    const desenharCaixas = () => {
      const k = semAcentos(procurar.value.trim());
      const vis = NOMES.filter((n) => escolhidos.has(n) || (k && semAcentos(n).includes(k))).slice(0, 60);
      caixas.replaceChildren(...(vis.length ? vis.map((n) => h("label", { class: "caixa" },
        h("input", { type: "checkbox", name: "concelho", value: n, checked: escolhidos.has(n), onchange: (ev) => { if (ev.target.checked) escolhidos.add(n); else escolhidos.delete(n); } }), n))
        : [h("p", { class: "vazio", text: "Escreva para procurar um concelho." })]));
    };
    procurar.addEventListener("input", desenharCaixas);
    desenharCaixas();
    const guardar = h("button", { class: "btn", type: "button", text: "Guardar concelhos", onclick: async () => {
      if (!escolhidos.size) { mensagem(msg, "Escolha pelo menos um concelho."); return; }
      mensagem(msg, null);
      if (await alterar(e, { concelhos: [...escolhidos] }, `Concelhos de ${e.nome} guardados.`, guardar)) j.fechar();
    } });
    const [nomeEstado, tipo] = ESTADOS[e.estado] ?? [e.estado, "info"];
    j.corpo.append(h("p", { class: "linha-selos" }, selo(nomeEstado, tipo), selo(`${pctTxt(e.percentagem_efetiva)} % da mão de obra`, "valor")),
      fichaDados(e), h("div", { class: "form-botoes" }, documento(e)),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Concelhos onde trabalha" }), campoForm("Procurar", procurar), caixas),
      h("div", { class: "form-botoes" }, guardar), msg);
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
