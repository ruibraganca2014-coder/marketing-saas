// Eletricistas externos (CEO; docs/ELETRICISTAS.md): candidaturas por decidir (ficha, documento do seguro, Aprovar /
// Recusar) e eletricistas (Suspender / Reativar, concelhos e percentagem da mão de obra — por omissão a da
// configuração, 70 %). A média das avaliações dos clientes chega numa ronda seguinte ("—" por agora).
// Ronda 2: ao suspender um eletricista com trabalhos em curso aparece a lista deles (o CEO pode retirar cada um), e a
// ficha tem "Apagar (RGPD)": tira a identidade, o documento do seguro e as sessões; fica só o histórico dos trabalhos.
import { pedir, campo, lista, numero } from "../api.js";
import { h, data, selo, dados, campoForm, janela, mensagem, avisar, carregando, erroEcra, botaoConfirmar } from "../ui.js";
import { CONCELHOS } from "../vendor/concelhos.js";

const ESTADOS = { pendente: ["Pendente", "aviso"], aprovado: ["Aprovado", "estado-ativo"], suspenso: ["Suspenso", "estado-suspenso"], recusado: ["Recusado", "estado-suspenso"] };
const NOMES = CONCELHOS.map((c) => c[0]);
const semAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pctTxt = (v) => String(v).replace(".", ",");
const mb = (b) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const ESTADOS_TRABALHO = { aceite: "por marcar a visita", visita_marcada: "com visita marcada", concluida_eletricista: "concluído, a aguardar o cliente" };

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
  /** "Ativa sem aprovação": o chip que este eletricista regista num trabalho vale logo (o CEO pode anular em Ativações). */
  function campoAtiva(e) {
    const i = h("input", { type: "checkbox", checked: e.ativa_sem_aprovacao === true, dataset: { ativa: String(e.id) } });
    i.addEventListener("change", () => alterar(e, { ativa_sem_aprovacao: i.checked }, i.checked
      ? `${e.nome}: ativa aparelhos sem esperar pela sua aprovação.` : `${e.nome}: as ativações passam a esperar pela sua aprovação.`));
    return h("label", { class: "caixa" }, i, "Ativa aparelhos sem aprovação");
  }
  const documento = (e) => (e.seguro
    ? h("a", { class: "btn sec pequeno", href: e.seguro.url, target: "_blank", rel: "noopener", id: `seguro-${e.id}`,
      text: `${e.seguro.tipo === "application/pdf" ? "Descarregar o seguro (PDF" : "Ver o seguro (imagem"}, ${mb(e.seguro.bytes)})` })
    : h("span", { class: "ajuda", text: "Sem documento do seguro." }));
  const fichaDados = (e) => dados([
    ["Telefone", e.telefone], ["Email", e.email], ["NIF", e.nif], ["Habilitação DGEG", e.dgeg], ["Concelhos", e.concelhos.join(", ") || "—"],
    ["Experiência", [e.experiencia, e.notas].filter(Boolean).join(" · ") || "—"], ["Candidatura", data(e.criado)],
    ...(e.estado === "pendente" ? [] : [["IBAN", e.iban ?? "Por indicar"]]),
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
      h("div", { class: "form-botoes" }, campoAtiva(e)),
      h("div", { class: "form-botoes" },
        h("button", { class: "btn", type: "button", id: `aprovar-${e.id}`, text: "Aprovar", onclick: (ev) => alterar(e, { acao: "aprovar" }, `${e.nome} aprovado: recebeu o email com a ligação para a área do eletricista.`, ev.currentTarget) }),
        botaoConfirmar("Recusar", "Confirmar: recusar?", (b) => alterar(e, { acao: "recusar" }, `Candidatura de ${e.nome} recusada.`, b), { classe: "btn perigo pequeno" })))))
      : h("p", { class: "vazio", id: "sem-candidaturas", text: "Sem candidaturas por decidir." }));
    partes.push(h("div", { class: "seccao-topo" }, h("h2", { text: "Eletricistas externos" })));
    partes.push(resto.length ? h("ul", { class: "linhas contas", id: "lista-eletricistas" }, ...resto.map((e) => {
      const [nomeEstado, tipo] = e.anonimizado ? ["Apagado (RGPD)", "info"] : ESTADOS[e.estado] ?? [e.estado, "info"];
      // Apagado (RGPD): fica só a linha do histórico, sem ações.
      if (e.anonimizado) {
        return h("li", { class: "linha conta inativa", dataset: { id: String(e.id) } },
          h("span", { class: "linha-principal" }, h("strong", { text: e.nome }), h("span", { class: "ajuda", text: `Apagado em ${data(e.anonimizado)}: fica o histórico dos trabalhos, sem a identidade.` })),
          h("span", { class: "linha-selos" }, selo(nomeEstado, tipo), e.trabalhos_largados ? selo(`${e.trabalhos_largados} ${e.trabalhos_largados === 1 ? "largado" : "largados"}`, "aviso") : null));
      }
      return h("li", { class: `linha conta ${e.estado === "aprovado" ? "" : "inativa"}`.trim(), dataset: { id: String(e.id) } },
        h("span", { class: "linha-principal" }, h("strong", { text: e.nome }), h("span", { class: "ajuda", text: e.concelhos.join(", ") || "Sem concelhos" }),
          h("span", { class: "ajuda", text: `${e.email} · ${e.telefone}` })),
        h("span", { class: "linha-selos" }, selo(nomeEstado, tipo),
          selo(e.avaliacao?.n ? `Média ${String(e.avaliacao.media).replace(".", ",")} ★ (${e.avaliacao.n})` : "Sem avaliações", "valor"),
          selo(`${e.trabalhos_em_curso} ${e.trabalhos_em_curso === 1 ? "trabalho em curso" : "trabalhos em curso"}`, "info"),
          e.trabalhos_largados ? selo(`${e.trabalhos_largados} ${e.trabalhos_largados === 1 ? "largado" : "largados"}`, "aviso") : null),
        h("span", { class: "conta-acoes" },
          h("span", { class: "ajuda", text: "% mão de obra" }), campoPct(e), campoAtiva(e),
          h("button", { class: "btn sec pequeno", type: "button", text: "Ver ficha", "aria-label": `Ver ficha de ${e.nome}`, onclick: () => abrirFicha(e) }),
          e.estado === "aprovado" ? (e.trabalhos?.length
            ? h("button", { class: "btn sec pequeno", type: "button", text: "Suspender", "aria-haspopup": "dialog", onclick: () => avisoSuspender(e) })
            : botaoConfirmar("Suspender", "Confirmar: suspender?", (b) => alterar(e, { acao: "suspender" }, `${e.nome} suspenso: deixa de entrar e de ver a bolsa.`, b)))
            : e.estado === "suspenso" ? h("button", { class: "btn sec pequeno", type: "button", text: "Reativar", onclick: (ev) => alterar(e, { acao: "reativar" }, `${e.nome} pode entrar de novo.`, ev.currentTarget) })
              : h("button", { class: "btn sec pequeno", type: "button", text: "Aprovar", onclick: (ev) => alterar(e, { acao: "aprovar" }, `${e.nome} aprovado.`, ev.currentTarget) })));
    })) : h("p", { class: "vazio", text: "Ainda não há eletricistas aprovados." }));
    partes.push(h("p", { class: "ajuda", text: `A percentagem aplica-se aos trabalhos aceites a partir de agora (por omissão, ${pctTxt(omissao)} % da mão de obra sem IVA). Um eletricista suspenso deixa de entrar e de ver a bolsa.` }));
    zona.replaceChildren(...partes);
  }

  /**
   * Suspender quem tem trabalhos em curso: a lista deles, com "Retirar" em cada um (o trabalho volta a ficar por
   * atribuir) e a ligação para o pedido; "Suspender" continua possível com trabalhos por retirar (o aviso diz o que acontece).
   */
  function avisoSuspender(e) {
    const j = janela(`Suspender ${e.nome}`);
    const desenharAviso = (atual) => {
      const ts = atual.trabalhos ?? [];
      j.corpo.replaceChildren(
        h("p", { class: "msg info", id: "suspender-aviso", text: ts.length
          ? `${atual.nome} tem ${ts.length} ${ts.length === 1 ? "trabalho em curso" : "trabalhos em curso"}. Suspenso, deixa de entrar na área do eletricista e não consegue marcar visitas nem fechar as obras: retire os trabalhos para os atribuir a outra pessoa.`
          : `${atual.nome} já não tem trabalhos em curso.` }),
        ts.length ? h("ul", { class: "linhas", id: "suspender-trabalhos" }, ...ts.map((t) => h("li", { class: "linha", dataset: { trabalho: String(t.id) } },
          h("span", { class: "linha-principal" }, h("strong", { text: `${t.tipo_nome} em ${t.concelho}` }),
            h("span", { class: "ajuda", text: `Pedido n.º ${t.orcamento_id} · ${ESTADOS_TRABALHO[t.estado] ?? t.estado}` })),
          h("span", { class: "conta-acoes" },
            h("a", { class: "btn sec pequeno", href: `#/orcamentos/${encodeURIComponent(t.orcamento_id)}`, text: "Ver pedido" }),
            botaoConfirmar("Retirar", "Confirmar: retirar?", async (b) => {
              b.disabled = true;
              try {
                await pedir(`orcamentos/${encodeURIComponent(t.orcamento_id)}/eletricista`, { corpo: { acao: "retirar" } });
                avisar(`Trabalho do pedido n.º ${t.orcamento_id} retirado.`);
                await carregar();
                desenharAviso(todos.find((x) => x.id === e.id) ?? { ...atual, trabalhos: [] });
              } catch (erro) { b.disabled = false; avisar(erro.message, "erro"); }
            }))))) : null,
        h("div", { class: "form-botoes" },
          h("button", { class: "btn perigo", type: "button", id: "suspender-confirmar", text: ts.length ? "Suspender mesmo assim" : "Suspender",
            onclick: async (ev) => { if (await alterar(e, { acao: "suspender" }, `${e.nome} suspenso: deixa de entrar e de ver a bolsa.`, ev.currentTarget)) j.fechar(); } }),
          h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => j.fechar() })));
    };
    desenharAviso(e);
  }

  /** Apagar (RGPD) é irreversível: o CEO escreve o email do eletricista para confirmar (o servidor volta a verificar). */
  function confirmarApagar(e, fichaJ) {
    const j = janela("Apagar eletricista (RGPD)");
    const msg = h("div", { class: "msg", role: "alert", hidden: true });
    const inp = h("input", { name: "email", type: "email", autocomplete: "off", spellcheck: "false", maxlength: "254", required: true, id: "apagar-eletricista-email" });
    const f = h("form", { class: "form-grelha", id: "form-apagar-eletricista", novalidate: true },
      h("p", { text: `Apaga os dados pessoais de ${e.nome}: nome, contactos, NIF, IBAN, habilitação, concelhos, o documento do seguro e as sessões. Se já teve trabalhos, fica só o histórico deles (sem a identidade) e as faturas-recibo, para a contabilidade. Não se pode desfazer.` }),
      e.trabalhos?.length ? h("p", { class: "msg info", text: "Tem trabalhos em curso ou por pagar: retire-os (na ficha do pedido, ou em Suspender) ou pague-os primeiro." }) : null,
      campoForm("Para confirmar, escreva o email do eletricista", inp, e.email),
      h("div", { class: "form-botoes" },
        h("button", { class: "btn perigo", type: "submit", text: "Apagar definitivamente" }),
        h("button", { class: "btn sec", type: "button", text: "Cancelar", onclick: () => j.fechar() })),
      msg);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (inp.value.trim().toLowerCase() !== e.email.toLowerCase()) { mensagem(msg, "O email escrito não é o deste eletricista."); inp.focus(); return; }
      const b = f.querySelector("button[type=submit]");
      b.disabled = true;
      mensagem(msg, null);
      try {
        const r = await pedir(`eletricistas/${encodeURIComponent(e.id)}/apagar`, { corpo: { email: inp.value.trim() } });
        receber(r);
        j.fechar();
        fichaJ?.fechar();
        avisar(campo(r, "modo") === "anonimizado" ? "Eletricista apagado: ficou só o histórico dos trabalhos, sem a identidade." : "Eletricista apagado.");
      } catch (erro) { b.disabled = false; mensagem(msg, erro.message); }
    });
    j.corpo.append(f);
    inp.focus();
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
    // Avaliações dos clientes (ronda 3): as estrelas e os comentários; os que o cliente deixou usar ficam marcados
    // "Pode ir para o site" (publicar é à mão, fora do painel).
    const coms = e.comentarios ?? [];
    const avaliacoes = coms.length ? h("details", { class: "eletricista-avaliacoes", id: "eletricista-avaliacoes" },
      h("summary", { text: `Avaliações dos clientes: média ${String(e.avaliacao.media).replace(".", ",")} ★ em ${e.avaliacao.n}` }),
      h("ul", { class: "linhas-simples" }, ...coms.map((c) => h("li", {}, h("strong", { text: `${"★".repeat(c.estrelas)}${"☆".repeat(5 - c.estrelas)}` }), " ",
        h("a", { href: `#/orcamentos/${encodeURIComponent(c.orcamento_id)}`, text: `pedido n.º ${c.orcamento_id}` }), ` · ${data(c.quando)}`,
        c.comentario ? h("span", { class: "bloco-ajuda", text: `«${c.comentario}»` }) : null, c.pode_site ? selo("Pode ir para o site", "estado-ativo") : null))))
      : h("p", { class: "ajuda", text: "Ainda sem avaliações de clientes." });
    j.corpo.append(h("p", { class: "linha-selos" }, selo(nomeEstado, tipo), selo(`${pctTxt(e.percentagem_efetiva)} % da mão de obra`, "valor")),
      fichaDados(e), avaliacoes, h("div", { class: "form-botoes" }, documento(e)),
      h("fieldset", { class: "grupo" }, h("legend", { text: "Concelhos onde trabalha" }), campoForm("Procurar", procurar), caixas),
      h("div", { class: "form-botoes" }, guardar,
        h("button", { class: "btn perigo pequeno", type: "button", id: "apagar-eletricista", text: "Apagar (RGPD)", "aria-haspopup": "dialog", onclick: () => confirmarApagar(e, j) })),
      msg);
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
