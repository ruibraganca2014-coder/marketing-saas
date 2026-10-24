// Diagnósticos (decisões do dono, 2026-10-24): os diagnósticos feitos na app /diagnostico.html (eletricistas e equipa),
// sincronizados do telemóvel (painel/src/diagnosticos.js). O CEO vê todos, com filtros (quem, anomalia, estado, datas,
// ligados a um trabalho/pedido); o técnico e o comercial só os seus. A ficha (#/diagnosticos/<id>) mostra a barreira de
// segurança, o percurso com as respostas e os valores medidos (fora do limite a vermelho), a causa, a ação, a nota e as
// fotos. Só leitura: faz-se tudo na app.
import { pedir, campo, lista } from "../api.js";
import { h, data, carregando, erroEcra, selo, dados, PAPEIS } from "../ui.js";

const ESTADOS = { em_curso: "Em curso", concluido: "Concluído", parado: "Parado" };
const AVALIACAO = { dentro: "Dentro do limite", aviso: "Abaixo do objetivo", fora: "Fora do limite", abaixo: "Abaixo do limite", acima: "Acima do limite" };
const TIPOS = { aberto: "Circuito aberto", curto: "Curto-circuito", terra: "Fuga à terra", sobrecarga: "Sobrecarga", outro: "Outra causa" };
const PERIGOS = { queimado: "Cheiro a queimado ou fumo", agua: "Água ou humidade no quadro", aquecimento: "Aquecimento anormal", faiscas: "Faíscas ou arco", cabo: "Cabo danificado" };
const seloEstado = (d) => (d.estado === "concluido" ? selo("Concluído", "orc-aceite") : d.estado === "parado" ? selo(d.perigo ? "Parado: perigo" : "Parado: apoio", "orc-perdido") : selo("Em curso", "aviso"));
const autorTxt = (a) => (a ? `${a.nome}${a.origem === "eletricista" ? " (eletricista)" : a.papel ? ` (${PAPEIS[a.papel] ?? a.papel})` : ""}` : "—");

export default function diagnosticos(el, ctx) {
  const ctrl = new AbortController();
  const ceo = ctx.eu?.papel === "ceo";
  let todos = [];
  let autores = [];
  const fAutor = h("select", { name: "autor", "aria-label": "Quem fez" });
  const fArvore = h("select", { name: "arvore", "aria-label": "Anomalia" });
  const fEstado = h("select", { name: "estado", "aria-label": "Estado" }, h("option", { value: "", text: "Todos os estados" }), ...Object.entries(ESTADOS).map(([v, t]) => h("option", { value: v, text: t })));
  const fDesde = h("input", { type: "date", name: "desde", "aria-label": "Desde" });
  const fAte = h("input", { type: "date", name: "ate", "aria-label": "Até" });
  const fLigado = h("input", { type: "checkbox", name: "ligado", id: "diag-ligado" });
  const contagem = h("p", { class: "ajuda", role: "status" });
  const zona = h("div", { class: "tabela-rolar" }, carregando());
  const fichaZona = h("div", {});
  const app = h("a", { class: "btn sec pequeno", href: "/diagnostico.html", target: "_blank", rel: "noopener", id: "abrir-app-diagnostico", text: "Abrir a app de diagnóstico" });
  const listaZona = h("div", {},
    h("p", { class: "ajuda", text: ceo ? "Os diagnósticos feitos na app, por todos (eletricistas e equipa), sincronizados dos telemóveis." : "Os diagnósticos que fez na app, sincronizados do telemóvel." }),
    h("div", { class: "filtros" }, ceo ? fAutor : null, fArvore, fEstado, fDesde, fAte,
      h("label", { class: "caixa-linha", for: "diag-ligado" }, fLigado, " Só os ligados a um trabalho ou pedido")),
    contagem, zona);
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Diagnósticos" }), app), listaZona, fichaZona);
  for (const f of [fAutor, fArvore, fEstado, fDesde, fAte, fLigado]) f.addEventListener("change", carregar);

  async function carregar() {
    const q = new URLSearchParams();
    if (ceo && fAutor.value) q.set("autor", fAutor.value);
    if (fArvore.value) q.set("arvore", fArvore.value);
    if (fEstado.value) q.set("estado", fEstado.value);
    if (fDesde.value) q.set("desde", fDesde.value);
    if (fAte.value) q.set("ate", fAte.value);
    if (fLigado.checked) q.set("ligado", "1");
    try {
      const r = await pedir(`diagnosticos${q.size ? `?${q}` : ""}`, { sinal: ctrl.signal });
      todos = lista(r, "diagnosticos");
      if (campo(r, "autores")) autores = r.autores;
    } catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    opcoesFiltros();
    desenhar();
  }
  function opcoesFiltros() {
    if (ceo && fAutor.options.length <= 1) {
      const v = fAutor.value;
      fAutor.replaceChildren(h("option", { value: "", text: "Todas as pessoas" }), ...autores.map((a) => h("option", { value: a.chave, text: `${a.nome}${a.origem === "eletricista" ? " (eletricista)" : ""}` })));
      fAutor.value = v;
    }
    const conhecidas = new Map([...fArvore.options].filter((o) => o.value).map((o) => [o.value, o.textContent]));
    for (const d of todos) conhecidas.set(d.arvore, d.titulo);
    const v = fArvore.value;
    fArvore.replaceChildren(h("option", { value: "", text: "Todas as anomalias" }), ...[...conhecidas].sort((a, b) => a[1].localeCompare(b[1], "pt")).map(([k, t]) => h("option", { value: k, text: t })));
    fArvore.value = v;
  }

  function desenhar() {
    contagem.textContent = `${todos.length} ${todos.length === 1 ? "diagnóstico" : "diagnósticos"}`;
    if (!todos.length) { zona.replaceChildren(h("p", { class: "vazio", text: "Ainda não há diagnósticos com estes filtros." })); return; }
    const colunas = ["Quando", ...(ceo ? ["Quem"] : []), "Anomalia", "Estado", "Causa provável", "Ligação", ""];
    zona.replaceChildren(h("table", { class: "tabela tabela-cartoes", id: "tabela-diagnosticos" },
      h("thead", {}, h("tr", {}, ...colunas.map((c) => h("th", { scope: "col", text: c })))),
      h("tbody", {}, ...todos.map((d) => h("tr", {},
        h("td", { class: "num", "data-rotulo": "Quando", text: data(d.iniciado) }),
        ceo ? h("td", { "data-rotulo": "Quem", text: autorTxt(d.autor) }) : null,
        h("td", { "data-rotulo": "Anomalia", text: d.titulo }),
        h("td", { "data-rotulo": "Estado" }, h("span", { class: "linha-selos" }, seloEstado(d), d.valores_fora ? selo(`${d.valores_fora} fora do limite`, "orc-perdido") : null, d.ficha_enviada ? selo("Na ficha", "orc-aceite") : null)),
        h("td", { "data-rotulo": "Causa provável", text: d.perigo ? PERIGOS[d.perigo] ?? d.perigo : d.causa ?? "—" }),
        h("td", { "data-rotulo": "Ligação" }, ligacao(d)),
        h("td", { class: "acoes" }, h("a", { class: "btn sec pequeno", href: `#/diagnosticos/${d.id}`, text: "Abrir" })))))));
  }
  const ligacao = (d) => (d.orcamento_id && ["ceo", "comercial"].includes(ctx.eu?.papel) ? h("a", { href: `#/orcamentos/${d.orcamento_id}`, text: `Pedido n.º ${d.orcamento_id}` })
    : d.orcamento_id ? `Pedido n.º ${d.orcamento_id}` : "—");

  async function abrir(id) {
    listaZona.hidden = true;
    fichaZona.replaceChildren(carregando());
    let d;
    try { d = (await pedir(`diagnosticos/${encodeURIComponent(id)}`, { sinal: ctrl.signal })).diagnostico; }
    catch (e) { if (e.name !== "AbortError") fichaZona.replaceChildren(h("a", { class: "btn sec pequeno", href: "#/diagnosticos", text: "Voltar à lista" }), erroEcra(e)); return; }
    const seg = d.seguranca ?? {};
    fichaZona.replaceChildren(
      h("a", { class: "btn sec pequeno", href: "#/diagnosticos", text: "Voltar à lista" }),
      h("article", { class: "cartao", id: "ficha-diagnostico" },
        h("h2", { text: d.titulo }),
        h("p", { class: "linha-selos" }, seloEstado(d), d.tipo ? selo(TIPOS[d.tipo] ?? d.tipo) : null, d.ficha_enviada ? selo(`Na ficha (${data(d.ficha_enviada)})`, "orc-aceite") : null),
        dados([
          ["Quem", autorTxt(d.autor)],
          ["Início", data(d.iniciado)],
          ["Fim", d.terminado ? data(d.terminado) : "—"],
          ["Trabalho do eletricista", d.trabalho_id ? `N.º ${d.trabalho_id}` : "—"],
          ["Pedido", ligacao(d)],
          ["Segurança", seg.regras ? `EPI (${seg.epi?.length ?? 0}) e as ${seg.regras.length} regras de ouro confirmados às ${data(seg.quando)}` : "—"],
        ]),
        d.perigo ? h("p", { class: "msg erro", text: `Parado por um sinal de perigo: ${PERIGOS[d.perigo] ?? d.perigo}.` }) : null,
        h("h3", { text: "Causa provável" }), h("p", { text: d.causa ?? "—" }),
        h("h3", { text: "Ação" }), h("p", { text: d.acao ?? "—" }),
        d.nota ? [h("h3", { text: "Nota" }), h("p", { class: "pre", text: d.nota })] : null,
        h("h3", { text: `Percurso (${d.passos.length} ${d.passos.length === 1 ? "passo" : "passos"})` }),
        h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "tabela-percurso" },
          h("thead", {}, h("tr", {}, ...["#", "Passo", "Resposta", "Limite", "Avaliação"].map((c) => h("th", { scope: "col", text: c })))),
          h("tbody", {}, ...d.passos.map((p, i) => h("tr", { class: p.tensao ? "passo-tensao" : null },
            h("td", { class: "num", "data-rotulo": "#", text: String(i + 1) }),
            h("td", { "data-rotulo": "Passo" }, p.pergunta, p.tensao ? h("span", { class: "selo-p orc-perdido", text: "com tensão" }) : null),
            h("td", { "data-rotulo": "Resposta" }, h("strong", { text: p.resposta })),
            h("td", { "data-rotulo": "Limite", text: p.limite ?? "—" }),
            h("td", { "data-rotulo": "Avaliação" }, p.avaliacao ? selo(AVALIACAO[p.avaliacao] ?? p.avaliacao, p.avaliacao === "dentro" ? "orc-aceite" : p.avaliacao === "aviso" ? "aviso" : "orc-perdido") : "—")))))),
        d.fotos.length ? [h("h3", { text: "Fotos" }), h("div", { class: "fotos-diagnostico" }, ...d.fotos.map((f) => h("a", { href: f.url, target: "_blank", rel: "noopener" },
          h("img", { src: f.url, alt: `Foto do diagnóstico (${data(f.criado)})`, loading: "lazy" }))))] : null));
  }

  function rota(resto) {
    if (resto[0]) { abrir(resto[0]); return; }
    fichaZona.replaceChildren();
    listaZona.hidden = false;
    carregar();
  }
  rota(ctx.resto ?? []);
  return { rota, desmontar: () => ctrl.abort() };
}
