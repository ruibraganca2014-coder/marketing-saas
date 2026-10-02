// "Eletricista externo" (CEO; docs/ELETRICISTAS.md): o bloco da ficha do pedido e da ficha da obra para atribuir o
// trabalho a um eletricista aprovado ("Atribuir a…"), pô-lo na bolsa ("Pôr na bolsa") ou retirá-lo. Carrega-se sozinho
// (GET orcamentos/:id/eletricista) e volta a desenhar-se depois de cada ação (POST orcamentos/:id/eletricista).
import { pedir } from "../api.js";
import { h, euros, data, selo, dados, avisar, botaoConfirmar } from "../ui.js";

const EVENTOS = {
  posto_na_bolsa: "Posto na bolsa", atribuido: "Atribuído", aceite: "Aceite na bolsa", visita_marcada: "Visita marcada",
  largou: "Largou o trabalho", expirou: "48 h sem visita marcada: voltou", retirado: "Retirado pelo CEO",
};
/** "AAAA-MM-DDTHH:MM" (hora de Lisboa) → "09/10/2026 10:00". */
const visitaTxt = (v) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11, 16)}` : "Por marcar");
const veem = (n) => `${n} ${n === 1 ? "eletricista vê" : "eletricistas veem"}`;

export function blocoEletricista(orcamentoId) {
  const corpo = h("div", { class: "form-grelha" }, h("p", { class: "ajuda", role: "status", text: "A carregar…" }));
  const sec = h("section", { class: "eletricista-externo", id: "eletricista-externo" }, h("h3", { text: "Eletricista externo" }), corpo);
  const caminho = `orcamentos/${encodeURIComponent(orcamentoId)}/eletricista`;

  async function acao(b, pedido, texto) {
    if (b) b.disabled = true;
    try {
      desenhar(await pedir(caminho, { corpo: pedido }));
      avisar(texto);
    } catch (e) {
      if (b) b.disabled = false;
      avisar(e.message, "erro");
    }
  }

  function desenhar(a) {
    const t = a.trabalho;
    const nomes = a.candidatos.map((c) => c.nome).join("; ") || "ninguém";
    const partes = [];
    if (!t && !a.pode) partes.push(h("p", { class: "ajuda", id: "eletricista-motivo", text: a.motivo ?? "Este pedido não se pode atribuir agora." }));
    else if (!t) {
      const sel = h("select", { name: "eletricista", id: "atribuir-a", "aria-label": "Atribuir a" },
        ...a.candidatos.map((c) => h("option", { value: String(c.id), text: `${c.nome} · recebe ${c.recebe == null ? "a combinar" : euros(c.recebe)} (${String(c.percentagem).replace(".", ",")} %)` })));
      partes.push(
        h("p", { class: "ajuda", text: `${a.tipo_nome} em ${a.concelho}. Só eletricistas aprovados com ${a.concelho} nos concelhos.` }),
        a.candidatos.length
          ? h("div", { class: "form-botoes" }, sel, h("button", { class: "btn pequeno", type: "button", id: "atribuir", text: "Atribuir",
            onclick: (e) => acao(e.currentTarget, { acao: "atribuir", eletricista_id: Number(sel.value) }, "Atribuído: o eletricista tem 48 h para marcar a visita.") }))
          : h("p", { class: "msg info", text: `Ainda não há eletricistas aprovados em ${a.concelho}.` }),
        h("div", { class: "form-botoes" }, h("button", { class: "btn sec pequeno", type: "button", id: "por-na-bolsa", text: `Pôr na bolsa · ${veem(a.candidatos.length)}`,
          onclick: (e) => acao(e.currentTarget, { acao: "bolsa" }, "Trabalho na bolsa.") })),
        h("p", { class: "ajuda", id: "bolsa-quem", text: `Na bolsa, veem o trabalho: ${nomes}. O primeiro a aceitar fica com ele e tem 48 h para marcar a visita.` }));
    } else if (t.estado === "na_bolsa") {
      partes.push(
        h("p", { class: "linha-selos" }, selo("Na bolsa", "aviso"), selo(a.concelho, "info")),
        h("p", { id: "bolsa-estado", text: `À espera de um eletricista. Visível para ${a.candidatos.length} em ${a.concelho}: ${nomes}.` }),
        h("div", { class: "form-botoes" }, botaoConfirmar("Retirar da bolsa", "Confirmar: retirar?", (b) => acao(b, { acao: "retirar" }, "Retirado da bolsa."))));
    } else {
      const r = t.recebe;
      partes.push(
        h("p", { class: "linha-selos" }, t.estado === "visita_marcada" ? selo("Visita marcada", "estado-ativo") : selo("Atribuído — marcar visita", "aviso"), t.aberto ? null : selo("Fechado", "info")),
        dados([
          ["Eletricista", t.eletricista ? h("a", { href: "#/eletricistas", text: t.eletricista.nome }) : "—"],
          ["Como", t.modo === "bolsa" ? "Aceitou na bolsa" : "Atribuição direta"],
          ["Recebe (estimativa, sem IVA)", r ? `${euros(r.total)} — ${String(r.percentagem).replace(".", ",")} % de ${euros(r.mao_obra)} + ${euros(r.deslocacao)} de deslocação${r.provisoria ? " (provisório: pela simulação)" : ""}` : "A combinar (proposta sem as três partes)"],
          ["Visita", t.visita ? visitaTxt(t.visita) : `Por marcar${t.prazo ? ` — até ${data(t.prazo)}; depois ${t.modo === "bolsa" ? "volta à bolsa" : "volta a ficar por atribuir"}` : ""}`],
        ]),
        h("div", { class: "form-botoes" }, botaoConfirmar("Retirar atribuição", "Confirmar: retirar?", (b) => acao(b, { acao: "retirar" }, "Atribuição retirada: o eletricista deixa de ver o cliente."))));
    }
    if (a.historico.length) {
      partes.push(h("details", { class: "eletricista-historico" }, h("summary", { text: `Histórico da atribuição (${a.historico.length})` }),
        h("ol", { class: "historico-p" }, ...a.historico.map((x) => h("li", {}, h("span", { class: "num ajuda", text: data(x.quando) }), " ",
          `${EVENTOS[x.evento] ?? x.evento}${x.eletricista ? ` — ${x.eletricista}` : ""}`)))));
    }
    corpo.replaceChildren(...partes);
  }

  pedir(caminho).then(desenhar).catch((e) => {
    // Quem não é CEO (403) não vê o bloco.
    if (e.estado === 403) sec.remove();
    else corpo.replaceChildren(h("p", { class: "msg erro", text: e.message }));
  });
  return sec;
}
