// "Eletricista externo" (CEO; docs/ELETRICISTAS.md): o bloco da ficha do pedido e da ficha da obra para atribuir o
// trabalho a um eletricista aprovado ("Atribuir a…"), pô-lo na bolsa ("Pôr na bolsa") ou retirá-lo. Carrega-se sozinho
// (GET orcamentos/:id/eletricista) e volta a desenhar-se depois de cada ação (POST orcamentos/:id/eletricista).
// Ronda 2: com o trabalho atribuído mostra a ficha de obra do eletricista — estado ("Concluída pelo eletricista"), o que
// falta, o material já recebido, os ensaios (fora do limite assinalados) e as fotos antes e depois.
// Ronda 3: a confirmação e a avaliação do cliente, o "Não" do cliente (defeito / sem defeito), "Aprovar trabalho" e
// "Devolver ao eletricista"; depois de aprovado, o valor fixado, o estado do pagamento e a fatura-recibo.
import { pedir } from "../api.js";
import { h, euros, data, selo, dados, avisar, botaoConfirmar } from "../ui.js";

const EVENTOS = {
  posto_na_bolsa: "Posto na bolsa", atribuido: "Atribuído", aceite: "Aceite na bolsa", visita_marcada: "Visita marcada",
  largou: "Largou o trabalho", expirou: "48 h sem visita marcada: voltou", retirado: "Retirado pelo CEO",
  concluida: "Dado por concluído pelo eletricista", confirmada: "Confirmado (cliente, 7 dias ou sem defeito)", contestada: "O cliente disse que não ficou concluído",
  devolvida: "Devolvido ao eletricista", aprovada: "Aprovado", paga: "Pago ao eletricista",
};
const NOME_ENSAIO = { continuidade_pe: ["Continuidade do PE", "Ω"], isolamento: ["Isolamento", "MΩ"], terra: ["Terra", "Ω"], diferencial: ["Diferencial", "ms"] };
const numTxt = (v) => String(v).replace(".", ",");

/** A ficha de obra do eletricista (só leitura): o que falta, material, ensaios e fotos. */
function fichaDeObra(t) {
  const partes = [];
  const mat = t.material ?? [];
  if (t.falta?.length) partes.push(h("p", { class: "ajuda", id: "eletricista-falta", text: `Falta ao eletricista: ${t.falta.join("; ")}.` }));
  if (mat.length) partes.push(h("p", { id: "eletricista-material", text: `Material: ${mat.filter((m) => m.recebido).length} de ${mat.length} recebido${mat.some((m) => !m.recebido) ? ` (falta: ${mat.filter((m) => !m.recebido).map((m) => m.nome).join("; ")})` : ""}.` }));
  const e = t.ensaios;
  if (e && Object.keys(NOME_ENSAIO).some((k) => e[k] != null)) {
    partes.push(h("div", { class: "linha-selos", id: "eletricista-ensaios" }, h("strong", { text: "Ensaios:" }),
      ...Object.entries(NOME_ENSAIO).filter(([k]) => e[k] != null).map(([k, [nome, un]]) => selo(`${nome} ${numTxt(e[k])} ${un}${e.fora?.includes(k) ? " — fora do limite" : ""}`, e.fora?.includes(k) ? "estado-suspenso" : "info"))));
    if (e.notas) partes.push(h("p", { class: "ajuda", text: `Nota dos ensaios: ${e.notas}` }));
  }
  if (t.diagnostico !== null && t.diagnostico !== undefined) partes.push(h("p", { class: "ajuda", text: t.diagnostico ? "Diagnóstico da avaria preenchido (ver a secção Diagnóstico)." : "Diagnóstico da avaria por preencher." }));
  const fotos = t.fotos ?? [];
  if (fotos.length) {
    partes.push(h("div", { class: "fotos-grelha", id: "eletricista-fotos" }, ...fotos.map((f) => h("figure", { class: "foto-cliente" },
      h("a", { href: f.url, target: "_blank", rel: "noopener", title: "Abrir a foto inteira" }, h("img", { src: f.url, alt: f.grupo_nome, loading: "lazy", decoding: "async" })),
      h("figcaption", {}, h("strong", { text: f.grupo_nome }))))));
  } else partes.push(h("p", { class: "ajuda", text: "Ainda sem fotos da obra." }));
  return partes;
}
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

  /** Confirmação e avaliação do cliente, reclamação e o que o CEO decide (ronda 3). */
  function confirmacao(t) {
    const partes = [];
    if (t.prazo_confirmacao) partes.push(h("p", { class: "ajuda", id: "eletricista-prazo-cliente", text: `O cliente confirma na conta até ${data(t.prazo_confirmacao)}; sem resposta, fica aceite.` }));
    if (t.confirmada) {
      const quem = t.reclamacao?.decisao === "sem_defeito" ? "Sem defeito (decisão do CEO)" : t.confirmada_auto ? "Aceite sem resposta do cliente (7 dias)" : "Confirmado pelo cliente";
      partes.push(h("p", { id: "eletricista-confirmacao" }, h("strong", { text: `${quem}: ` }), data(t.confirmada),
        t.estrelas ? ` · ${"★".repeat(t.estrelas)}${"☆".repeat(5 - t.estrelas)} (${t.estrelas}/5)` : ""));
      if (t.comentario) partes.push(h("p", { class: "linha-selos" }, h("span", { text: `«${t.comentario}»` }), t.comentario_site ? selo("Pode ir para o site", "estado-ativo") : null));
    }
    const rc = t.reclamacao;
    if (rc?.texto && ["aceite", "visita_marcada", "concluida_eletricista"].includes(t.estado)) {
      partes.push(h("div", { class: "msg info", id: "eletricista-reclamacao" },
        h("p", { text: `${rc.de === "cliente" ? "O cliente respondeu que não ficou concluído" : "Devolvido ao eletricista"} (${data(rc.quando)}): «${rc.texto}»` }),
        rc.decisao === "defeito" ? h("p", { text: "Decisão: defeito — o eletricista volta sem receber mais." }) : null));
    }
    if (t.pode_decidir) {
      partes.push(h("div", { class: "form-botoes", id: "eletricista-decidir" },
        botaoConfirmar("Defeito: volta sem receber", "Confirmar: é defeito?", (b) => acao(b, { acao: "defeito" }, "Registado: o eletricista volta para corrigir, sem receber mais.")),
        botaoConfirmar("Sem defeito: cobrar visita ao cliente", "Confirmar: cobrar a visita?", (b) => acao(b, { acao: "sem_defeito" }, "Sem defeito: o trabalho fica aceite e o cliente paga uma visita na conta."))));
    }
    if (t.visita_sem_defeito) partes.push(h("p", { class: "ajuda", text: `Visita sem defeito cobrada ao cliente: ${euros(t.visita_sem_defeito.valor)} — ${t.visita_sem_defeito.paga ? "paga" : "por pagar"}.` }));
    const ida = t.regresso;
    if (ida) partes.push(h("p", { class: "ajuda", id: "eletricista-ida", text: `Ida sem defeito a pagar ao eletricista: ${ida.valor ? euros(ida.valor.total) : "—"} — ${ida.pagamento_texto}${ida.prazo && ida.pagamento === "a_pagar" ? ` até ${data(ida.prazo)}` : ""}${ida.pago_em ? ` em ${data(ida.pago_em)}` : ""}.` }));
    const botoes = [];
    if (t.pode_aprovar) {
      botoes.push(botaoConfirmar(t.tipo === "obra" ? "Aprovar trabalho (e obra concluída)" : "Aprovar trabalho", "Confirmar: aprovar?",
        (b) => acao(b, { acao: "aprovar" }, t.tipo === "obra" ? "Trabalho aprovado: a obra ficou concluída e o cliente já pode pagar o restante." : "Trabalho aprovado.")));
    }
    if (t.pode_devolver) {
      const motivo = h("textarea", { id: "devolver-motivo", rows: "2", maxlength: "1000", "aria-label": "Motivo da devolução" });
      const zona = h("div", { class: "form-grelha", hidden: true }, h("label", { class: "campo" }, h("span", { text: "O que falta (o eletricista vê este texto)" }), motivo),
        h("div", { class: "form-botoes" }, h("button", { class: "btn pequeno", type: "button", id: "devolver-confirmar", text: "Devolver",
          onclick: (e) => { if (motivo.value.trim().length < 5) { avisar("Escreva o motivo da devolução.", "erro"); motivo.focus(); return; } acao(e.currentTarget, { acao: "devolver", motivo: motivo.value.trim() }, "Devolvido ao eletricista."); } })));
      botoes.push(h("button", { class: "btn sec pequeno", type: "button", id: "devolver-eletricista", text: "Devolver ao eletricista",
        onclick: (e) => { zona.hidden = false; e.currentTarget.hidden = true; motivo.focus(); } }));
      partes.push(h("div", { class: "form-botoes" }, ...botoes), zona);
    } else if (botoes.length) partes.push(h("div", { class: "form-botoes" }, ...botoes));
    return partes;
  }

  /** O pagamento ao eletricista: valor (fixado ao aprovar), estado, prazo e fatura-recibo. */
  function pagamento(t) {
    const p = t.pagamento;
    if (!p) return [];
    const v = p.valor;
    return [dados([
      [p.valor_fixado ? "A pagar ao eletricista (sem IVA)" : "Recebe (estimativa, sem IVA)", v ? `${euros(v.total)} — ${String(v.percentagem).replace(".", ",")} % de ${euros(v.mao_obra)} + ${euros(v.deslocacao)} de deslocação` : "—"],
      ["Pagamento", `${p.pagamento_texto}${p.prazo && p.pagamento === "a_pagar" ? ` até ${data(p.prazo)}` : ""}${p.pago_em ? ` em ${data(p.pago_em)}${t.pago_por ? ` (${t.pago_por})` : ""}` : ""}`],
      ...(p.fatura ? [["Fatura-recibo", h("a", { href: p.fatura.url, target: "_blank", rel: "noopener", text: `Abrir (${data(p.fatura.quando)})` })]] : []),
      ...(t.aprovada ? [["Aprovado", `${data(t.aprovada)}${t.aprovada_por ? ` (${t.aprovada_por})` : ""}`]] : []),
    ]), h("p", { class: "ajuda" }, "Pagamentos aos eletricistas: ", h("a", { href: "#/pagamentos", text: "Pagamentos" }), ".")];
  }

  const SELO_ESTADO = {
    concluida_eletricista: ["Concluída pelo eletricista — a aguardar confirmação do cliente", "estado-ativo"], confirmada: ["Confirmado — falta aprovar", "aviso"],
    visita_marcada: ["Visita marcada", "estado-ativo"], aceite: ["Atribuído — marcar visita", "aviso"], aprovada: ["Aprovado", "estado-ativo"], paga: ["Pago ao eletricista", "estado-ativo"],
  };

  function desenhar(a) {
    const t0 = a.trabalho;
    // Sem trabalho ativo, `trabalho` é o último já aprovado ou pago (e pode haver outro trabalho por atribuir).
    const feito = t0 && t0.ativo === false ? t0 : null;
    const t = feito ? null : t0;
    const nomes = a.candidatos.map((c) => c.nome).join("; ") || "ninguém";
    const partes = [];
    if (feito) {
      partes.push(h("p", { class: "linha-selos" }, selo(SELO_ESTADO[feito.estado]?.[0] ?? feito.estado, SELO_ESTADO[feito.estado]?.[1] ?? "info"), selo(feito.tipo === "obra" ? "Obra" : feito.tipo === "visita" ? "Visita técnica" : "Diagnóstico de avaria", "info")),
        dados([["Eletricista", feito.eletricista ? h("a", { href: "#/eletricistas", text: feito.eletricista.nome }) : "—"]]), ...confirmacao(feito), ...pagamento(feito));
      if (a.pode) partes.push(h("h4", { text: `Novo trabalho: ${a.tipo_nome}` }));
    }
    if (!t && !a.pode) { if (!feito) partes.push(h("p", { class: "ajuda", id: "eletricista-motivo", text: a.motivo ?? "Este pedido não se pode atribuir agora." })); }
    else if (!t) {
      const sel = h("select", { name: "eletricista", id: "atribuir-a", "aria-label": "Atribuir a" },
        ...a.candidatos.map((c) => h("option", { value: String(c.id), text: c.recebe === 0 ? `${c.nome} · visita sem custo (só recebe com a obra)` : `${c.nome} · recebe ${c.recebe == null ? "a combinar" : euros(c.recebe)} (${String(c.percentagem).replace(".", ",")} %)` })));
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
      const [seloTxt, seloTipo] = SELO_ESTADO[t.estado] ?? SELO_ESTADO.aceite;
      partes.push(
        h("p", { class: "linha-selos" }, selo(seloTxt, seloTipo), t.aberto ? null : selo("Fechado", "info")),
        dados([
          ["Eletricista", t.eletricista ? h("a", { href: "#/eletricistas", text: t.eletricista.nome }) : "—"],
          ["Como", t.modo === "bolsa" ? "Aceitou na bolsa" : "Atribuição direta"],
          ["Recebe (estimativa, sem IVA)", r ? `${euros(r.total)} — ${String(r.percentagem).replace(".", ",")} % de ${euros(r.mao_obra)} + ${euros(r.deslocacao)} de deslocação${r.provisoria ? " (provisório: pela simulação)" : ""}` : "A combinar (proposta sem as três partes)"],
          ...(t.concluida ? [["Concluída pelo eletricista", data(t.concluida)]] : []),
          ["Visita", t.visita ? visitaTxt(t.visita) : `Por marcar${t.prazo ? ` — até ${data(t.prazo)}; depois ${t.modo === "bolsa" ? "volta à bolsa" : "volta a ficar por atribuir"}` : ""}`],
        ]),
        ...confirmacao(t),
        ...fichaDeObra(t),
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
