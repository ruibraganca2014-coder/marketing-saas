// Ajuda técnica (docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): referência só de leitura para a equipa, feita a partir
// de ecras/diagnostico-conteudo.js — segurança, sinais, ferramentas, os três passos, as oito técnicas, os quatro tipos de
// avaria, os valores de referência (RTIEBT ou "referência prática") e quando parar. Rota #/ajuda (ou #/ajuda/diagnostico);
// imprimível (o @media print do painel esconde o topo e o menu). Em cima, o manual de instalações BT da empresa
// (2026-10-24; vendor/manual-bt.js): a nota da edição provisória, "Abrir o manual (PDF)" e o índice com as páginas — o PDF
// só sai com sessão (/painel/api/manual-instalacoes-bt.pdf; painel/src/manual.js).
import { h } from "../ui.js";
import { MANUAL_BT, ligacaoManual } from "../vendor/manual-bt.js";
import { SEGURANCA, SINAIS, FERRAMENTAS, PASSOS, TECNICAS, TIPOS_AVARIA, VALORES, PARAR, PROBLEMAS, NOME_TIPO } from "./diagnostico-conteudo.js";

const PERIGO = { alto: "Alto", "médio": "Médio", baixo: "Baixo" };
const classePerigo = (p) => `perigo-${p === "alto" ? "alto" : p === "médio" ? "medio" : "baixo"}`;

/** Tabela com cabeçalho; no telemóvel cada linha vira um cartão (classe tabela-cartoes, data-rotulo). */
function tabela(colunas, linhas, { id } = {}) {
  return h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id },
    h("thead", {}, h("tr", {}, ...colunas.map((c) => h("th", { scope: "col", text: c })))),
    h("tbody", {}, ...linhas.map((l) => h("tr", {}, ...l.map((celula, i) => h("td", { dataset: { rotulo: colunas[i] } }, celula)))))));
}

/** O manual de instalações BT: nota, ligação ao PDF e o índice (cada capítulo abre o PDF nessa página). */
export function manualInstalacoes() {
  const pdf = `/painel/api/${MANUAL_BT.ficheiro}`;
  const nova = { target: "_blank", rel: "noopener" };
  return [
    h("h2", { id: "ajuda-manual-titulo", text: "Manual de instalações elétricas" }),
    h("p", { class: "manual-nota" }, h("span", { class: "selo-p aviso", text: "Edição provisória" }), " ", MANUAL_BT.nota),
    h("p", { class: "ajuda", text: `${MANUAL_BT.titulo} (${MANUAL_BT.edicao}, ${MANUAL_BT.paginas} páginas). ${MANUAL_BT.resumo}` }),
    h("p", { class: "nao-imprimir" }, h("a", { class: "btn pequeno", id: "manual-abrir", href: pdf, ...nova, text: "Abrir o manual (PDF)" })),
    ...MANUAL_BT.partes.map((p) => h("section", { class: "manual-parte" },
      h("h3", { text: `${p.titulo} · p. ${p.pagina}` }),
      h("ul", { class: "indice-manual" }, ...p.capitulos.map((c) => h("li", {},
        h("a", { href: ligacaoManual(pdf, c.pagina), ...nova },
          h("span", { class: "n", text: c.n }),
          h("span", { class: "t" }, h("strong", { text: c.titulo }), c.resumo ? h("span", { class: "ajuda", text: c.resumo }) : null),
          h("span", { class: "p", text: `p. ${c.pagina}` }))))))),
  ];
}

/** O guia inteiro (elementos). */
export function guiaDiagnostico() {
  return [
    h("h2", { id: "ajuda-diag-titulo", text: "Diagnóstico de avarias" }),
    h("p", { class: "ajuda", text: "Guia curto para o eletricista habilitado: o que fazer antes de tocar em alguma coisa, como localizar a avaria e como a dar por reparada. Os valores com artigo da RTIEBT são os da regulamentação; os marcados \"referência prática\" são os habituais no ofício e ficam a confirmar pelo técnico." }),

    h("h3", { id: "ajuda-seguranca", text: "1. Segurança primeiro" }),
    h("ul", {}, ...SEGURANCA.map((r) => h("li", {}, h("strong", { text: `${r.titulo}. ` }), r.texto))),

    h("h3", { id: "ajuda-sinais", text: "2. Sinais de alarme" }),
    tabela(["Sinal", "O que costuma indicar"], SINAIS.map((s) => [s.sinal, s.indica]), { id: "tabela-sinais" }),

    h("h3", { id: "ajuda-ferramentas", text: "3. Ferramentas" }),
    tabela(["Ferramenta", "Para quê"], FERRAMENTAS.map((f) => [h("strong", { text: f.nome }), f.uso]), { id: "tabela-ferramentas" }),

    h("h3", { id: "ajuda-passos", text: "4. Os três passos" }),
    h("ol", { class: "diag-passos" }, ...PASSOS.map((p) => h("li", {}, h("strong", { text: p.titulo }), h("ul", {}, ...p.passos.map((x) => h("li", { text: x })))))),

    h("h3", { id: "ajuda-tecnicas", text: "5. As oito técnicas" }),
    tabela(["Técnica", "O que é", "Quando", "Ferramenta"], TECNICAS.map((t) => [h("strong", { text: t.nome }), t.oQue, t.quando, t.ferramenta]), { id: "tabela-tecnicas" }),

    h("h3", { id: "ajuda-tipos", text: "6. Os quatro tipos de avaria" }),
    tabela(["Tipo", "Causas", "Sintomas", "Como se testa", "Proteção", "Perigo"], TIPOS_AVARIA.map((t) => [
      h("strong", { text: t.nome }), t.causas, t.sintomas, t.teste, t.protecao, h("span", { class: classePerigo(t.perigo), text: PERIGO[t.perigo] ?? t.perigo }),
    ]), { id: "tabela-tipos" }),

    h("h3", { id: "ajuda-valores", text: "7. Valores de referência" }),
    tabela(["Medição", "Valor", "Fonte", "Nota"], VALORES.map((v) => [v.medicao, h("strong", { text: v.valor }),
      h("span", { class: `selo-p ${v.fonte.startsWith("RTIEBT") ? "orc-aceite" : "info"}`, text: v.fonte }), v.nota]), { id: "tabela-valores" }),

    h("h3", { id: "ajuda-problemas", text: "8. O que o cliente descreve → por onde começar" }),
    h("p", { class: "ajuda", text: "As sete escolhas do passo \"Avaria\" do simulador, com os tipos prováveis e as primeiras verificações. A ficha do pedido mostra estas linhas para os problemas que o cliente escolheu." }),
    h("ul", { class: "diag-sugestoes" }, ...Object.values(PROBLEMAS).map((p) => h("li", {},
      h("strong", { text: `${p.nome} → ${p.tipos.map((t) => NOME_TIPO[t]).join(" ou ") || "a apurar"}: ` }), p.verificar))),

    h("h3", { id: "ajuda-parar", text: "9. Quando parar e pedir ajuda" }),
    h("ul", {}, ...PARAR.map((x) => h("li", { text: x }))),

    h("p", { class: "ajuda fontes", text: "Fontes usadas só como referência (dois infográficos sobre diagnóstico e tipos de avaria e um artigo sobre os passos e as técnicas), com textos nossos, conferidos com o manual de instalações BT da empresa (2026); valores regulamentares da RTIEBT (Portaria n.º 949-A/2006, consolidada em 2015): 611.1, 612.1, 612.2, 612.3 e Quadro 61A, Anexo B, 413.1.4.2, 801.5.6.1. Não substitui a regulamentação nem a formação do técnico." }),
  ];
}

export default function ajuda(el) {
  const imprimir = h("button", { class: "btn sec pequeno", type: "button", id: "imprimir-ajuda", text: "Imprimir / guardar PDF", onclick: () => window.print() });
  el.append(
    h("div", { class: "ecra-topo nao-imprimir" }, h("h1", { text: "Ajuda técnica" }), h("div", { class: "form-botoes" }, imprimir)),
    h("article", { class: "cartao ajuda-tecnica", id: "ajuda-manual", "aria-labelledby": "ajuda-manual-titulo" }, ...manualInstalacoes()),
    h("article", { class: "cartao ajuda-tecnica", id: "ajuda-diagnostico", "aria-labelledby": "ajuda-diag-titulo" }, ...guiaDiagnostico()));
  return { rota() {} };
}
