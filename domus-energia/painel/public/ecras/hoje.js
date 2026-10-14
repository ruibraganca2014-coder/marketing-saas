// "Hoje" (decisão do dono, 2026-10-14): o painel abre aqui para todos. "O que tenho de fazer hoje": uma linha por coisa
// — o quê, quem/onde e há quanto tempo — e um só botão, "Abrir", que leva onde se trata; a mais antiga primeiro. As de
// mais de dois dias ficam a barro. O servidor (GET hoje) já só manda o que é do papel de quem entra.
import { pedir, lista } from "../api.js";
import { h, num, carregando, erroEcra, avisar } from "../ui.js";

const DIA = 24 * 3600_000;
const saudacao = () => { const hr = new Date().getHours(); return hr < 13 ? "Bom dia" : hr < 20 ? "Boa tarde" : "Boa noite"; };

/** "há 5 minutos", "há 3 horas", "há 2 dias"; nas visitas e obras de hoje, "hoje às 14:30". */
function haQuanto(x, agora = Date.now()) {
  if (x.hora) return `hoje às ${x.hora}`;
  const t = x.desde ? Date.parse(x.desde) : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((agora - t) / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
/** À espera há mais de dois dias (as marcações de hoje nunca). */
const antigo = (x, agora = Date.now()) => !x.hora && Boolean(x.desde) && agora - Date.parse(x.desde) > 2 * DIA;

export default function hoje(el, ctx) {
  const zona = h("div", { class: "hoje" }, carregando());
  const primeiro = ctx.eu.nome.split(" ")[0] || "";
  el.append(h("div", { class: "ecra-topo" }, h("h1", { text: "Hoje" })),
    h("p", { class: "hoje-ola", text: `${saudacao()}${primeiro ? `, ${primeiro}` : ""}. Isto é o que está à sua espera, o mais antigo primeiro.` }), zona);
  const ctrl = new AbortController();

  async function carregar() {
    zona.replaceChildren(carregando());
    let r;
    try { r = await pedir("hoje", { sinal: ctrl.signal }); }
    catch (e) { if (e.name !== "AbortError") zona.replaceChildren(erroEcra(e, carregar)); return; }
    const itens = lista(r, "itens");
    const agora = Date.now();
    const linhas = itens.map((x) => {
      const meta = [x.localidade, haQuanto(x, agora)].filter(Boolean).join(" · ");
      return h("li", { class: `hoje-item${antigo(x, agora) ? " antigo" : ""}`, dataset: { tipo: x.tipo } },
        h("p", { class: "hoje-texto" }, h("span", { text: x.texto }), meta ? h("span", { class: "hoje-meta", text: ` · ${meta}` }) : null),
        x.ligacao ? h("a", { class: "btn sec", href: x.ligacao, text: "Abrir", "aria-label": `Abrir: ${x.texto}` }) : null);
    });
    const out = [linhas.length
      ? h("ul", { class: "hoje-lista", id: "hoje-lista", "aria-label": `${num(linhas.length)} ${linhas.length === 1 ? "coisa" : "coisas"} à sua espera` }, ...linhas)
      : h("p", { class: "hoje-vazio", id: "hoje-vazio", text: "Nada à sua espera. Bom trabalho." })];
    // Emails que não chegaram ao cliente: ficam na lista até "Marcar como vistos" (só o CEO os recebe).
    if (itens.some((x) => x.tipo === "email_falhado")) {
      const visto = h("button", { class: "btn sec", type: "button", id: "emails-falhados-vistos", text: "Marcar os emails que falharam como vistos" });
      visto.addEventListener("click", async () => {
        visto.disabled = true;
        try { await pedir("emails-falhados/vistos", { corpo: {} }); carregar(); } catch (e) { visto.disabled = false; avisar(e.message, "erro"); }
      });
      out.push(h("div", { class: "form-botoes hoje-botoes" }, visto));
    }
    if (ctx.pode("ceo")) out.push(h("p", { class: "hoje-botoes" }, h("a", { class: "btn sec", href: "#/numeros", text: "Ver números" })));
    zona.replaceChildren(...out);
  }

  carregar();
  return { desmontar: () => ctrl.abort() };
}
