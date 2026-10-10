// Área de cliente — pré-visualização (decisão do dono, 2026-10-03): o ecrã de uma conta com sessão e ainda sem casa
// ligada. Só de leitura: a planta que o cliente desenhou (o desenho do simulador, simulador/planta-svg.js, como no
// painel), as divisões com o que disse que a casa tem, o andamento do pedido (os passos que "A minha conta" mostra) e os
// botões que levam ao sítio certo. Sem aparelhos nem MQTT. A lógica (que planta, que botões) está em previsao.js.
// Dados: GET /api/conta/pedidos, GET /api/conta/simulacao e GET /api/conta/pedidos/:id/planta (só os da própria conta).

import { pedirConta } from "./conta-comum.js";
import { fontesDePlanta, pedidoDoAndamento, divisoesDaPrevisao, botoesDaPrevisao, temPlanta } from "./previsao.js";

const SVG = "http://www.w3.org/2000/svg";
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const dataTxt = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }); };
const nomePiso = (p) => (p > 0 ? `Piso ${p}` : "Piso 0 (r/c)");

/** A simulação por enviar guardada na conta, lida como o simulador a lê (estados antigos migrados): {planta, inventario, atualizado} ou null. */
async function lerRascunho() {
  const r = await pedirConta("simulacao").catch(() => null);
  if (!r?.estado) return null;
  try {
    const { normalizarEstado, inventarioParaEnvio, temProgresso } = await import("./simulador/estado.js");
    const { MODELOS } = await import("./simulador/regras.js");
    const e = normalizarEstado(r.estado);
    if (!e || e.soCasa || !temProgresso(e)) return null;
    // Os equipamentos pelo nome na lista de cada divisão (nos pedidos enviados é o servidor que o manda).
    const planta = { ...e.planta, elementos: e.planta.elementos.map((x) => (x.tipo === "maquina" && MODELOS[x.props?.modelo] ? { ...x, nome: MODELOS[x.props.modelo].nome } : x)) };
    return { planta, inventario: inventarioParaEnvio(e, e.planta), atualizado: r.atualizado ?? null };
  } catch {
    return null;
  }
}

/**
 * Desenha a pré-visualização em `caixa` (substitui o conteúdo) para a conta com sessão `eu`. Devolve quando os dados
 * chegaram (uma falha de rede fica escrita no ecrã, com "Tentar de novo").
 */
export async function mostrarPrevisao(caixa, eu) {
  caixa.replaceChildren();
  const topo = el("div", "cartao previsao-topo");
  const titulo = el("h1", null, "Área de cliente");
  titulo.id = "previsao-titulo";
  titulo.tabIndex = -1;
  topo.append(titulo, el("p", "selo-estado previsao-selo", "Pré-visualização — a sua casa antes da instalação"),
    el("p", "msg info previsao-aviso", "Os aparelhos da sua casa aparecem aqui depois da instalação. Por agora pode ver a planta que desenhou e o andamento do seu pedido."));
  if (eu?.conta?.email) topo.append(el("p", "ajuda", `Conta: ${eu.conta.email}`));
  const corpo = el("div", "previsao-corpo");
  corpo.setAttribute("aria-live", "polite");
  corpo.append(el("p", "ajuda", "A carregar…"));
  caixa.append(topo, corpo);

  let pedidos = [];
  let rascunho = null;
  try {
    const [rp, rr] = await Promise.all([pedirConta("pedidos"), lerRascunho()]);
    pedidos = Array.isArray(rp?.pedidos) ? rp.pedidos : [];
    rascunho = rr;
  } catch (e) {
    const de_novo = el("button", "btn sec", "Tentar de novo");
    de_novo.type = "button";
    de_novo.addEventListener("click", () => mostrarPrevisao(caixa, eu));
    corpo.replaceChildren(el("p", "msg info", e?.message || "Não foi possível ler os seus dados."), de_novo);
    return;
  }

  const fontes = fontesDePlanta(pedidos, rascunho, dataTxt);
  const plantas = new Map();   // chave da fonte → {planta, inventario}
  if (rascunho && temPlanta(rascunho.planta)) plantas.set("rascunho", { planta: rascunho.planta, inventario: rascunho.inventario });
  async function plantaDe(fonte) {
    if (!plantas.has(fonte.chave)) {
      const r = await pedirConta(`pedidos/${fonte.pedido}/planta`).catch(() => null);
      plantas.set(fonte.chave, { planta: temPlanta(r?.planta) ? r.planta : null, inventario: r?.inventario ?? null });
    }
    return plantas.get(fonte.chave);
  }

  const botoes = (lista) => {
    const g = el("div", "form-botoes previsao-botoes");
    for (const b of lista) {
      const a = el("a", b.principal ? "btn" : "btn sec", b.texto);
      a.href = b.href;
      a.id = `previsao-${b.chave}`;
      g.append(a);
    }
    return g;
  };
  /** O andamento do pedido (os mesmos passos e textos de "A minha conta"). */
  const cartaoPedido = (p) => {
    const c = el("section", "cartao previsao-pedido");
    c.setAttribute("aria-labelledby", "previsao-pedido-titulo");
    const t = el("h2", null, `Pedido n.º ${p.id} · ${dataTxt(p.criado)}`);
    t.id = "previsao-pedido-titulo";
    const passos = el("ol", "conta-passos");
    passos.setAttribute("aria-label", "Andamento do pedido");
    for (const s of p.passos ?? []) passos.append(el("li", s.feito ? "feito" : null, s.texto));
    c.append(t, el("p", "conta-estado", p.estado_texto ?? ""), passos);
    return c;
  };

  // Sem planta nenhuma (nem rascunho com planta, nem pedido com planta).
  if (!fontes.length) {
    const p = pedidoDoAndamento(pedidos, null);
    const c = el("section", "cartao previsao-vazia");
    c.append(el("h2", null, "Ainda não temos a planta da sua casa"),
      el("p", null, rascunho ? "Tem uma simulação começada: continue-a para desenhar a casa e ver aqui a planta." : "Faça a simulação do orçamento: desenha a casa em poucos minutos e fica a ver aqui a planta."),
      botoes(botoesDaPrevisao({ temPlanta: false, temRascunho: Boolean(rascunho), pedido: p })));
    corpo.replaceChildren(c, ...(p ? [cartaoPedido(p)] : []));
    return;
  }

  let atual = fontes[0];
  let piso = null;
  async function desenhar(focoNoSeletor = false) {
    const dados = await plantaDe(atual);
    const pedido = pedidoDoAndamento(pedidos, atual);
    const c = el("section", "cartao previsao-planta");
    c.setAttribute("aria-labelledby", "previsao-planta-titulo");
    const t = el("h2", null, "A planta que desenhou");
    t.id = "previsao-planta-titulo";
    c.append(t);
    if (fontes.length > 1) {
      const rot = el("label", "previsao-fonte", "Planta de ");
      const sel = el("select");
      sel.id = "previsao-fonte";
      for (const f of fontes) { const o = el("option", null, f.texto); o.value = f.chave; o.selected = f === atual; sel.append(o); }
      sel.addEventListener("change", () => { atual = fontes.find((f) => f.chave === sel.value) ?? fontes[0]; piso = null; desenhar(true); });
      rot.append(sel);
      c.append(rot);
    } else c.append(el("p", "ajuda", atual.texto));
    if (!dados.planta) c.append(el("p", "msg info", "Não foi possível mostrar esta planta agora."));
    else {
      const { desenharPlanta, pisosDaPlanta } = await import("./simulador/planta-svg.js");
      const pisos = pisosDaPlanta(dados.planta);
      if (piso === null || !pisos.includes(piso)) piso = pisos[0];
      const svg = document.createElementNS(SVG, "svg");
      svg.classList.add("previsao-svg");
      const L = Math.max(1, Number(dados.planta.largura_cm) || 2000), A = Math.max(1, Number(dados.planta.altura_cm) || 1500);
      svg.style.aspectRatio = `${L} / ${A}`;
      const pintar = () => desenharPlanta(svg, dados.planta, { soLeitura: true, grelha: false, ...(pisos.length > 1 ? { piso } : {}) });
      if (pisos.length > 1) {
        const g = el("div", "previsao-pisos");
        g.setAttribute("role", "group");
        g.setAttribute("aria-label", "Piso da planta");
        for (const p of pisos) {
          const b = el("button", "btn sec pequeno", nomePiso(p));
          b.type = "button";
          b.setAttribute("aria-pressed", String(p === piso));
          b.addEventListener("click", () => {
            piso = p;
            for (const x of g.children) x.setAttribute("aria-pressed", String(x === b));
            pintar();
          });
          g.append(b);
        }
        c.append(g);
      }
      pintar();
      c.append(svg);
      // As divisões com o que o cliente disse que a casa tem (o inventário do passo "Divisões", quando há).
      const lista = divisoesDaPrevisao(dados.planta, dados.inventario);
      const h = el("h3", null, "As divisões e o que a casa tem hoje");
      const ul = el("ul", "previsao-divisoes");
      for (const d of lista) {
        const li = el("li");
        li.append(el("strong", null, pisos.length > 1 ? `${d.nome} · ${nomePiso(d.piso)}` : d.nome), el("span", null, d.texto));
        ul.append(li);
      }
      c.append(h, ul);
    }
    c.append(botoes(botoesDaPrevisao({ temPlanta: true, temRascunho: Boolean(rascunho), pedido })));
    corpo.replaceChildren(c, ...(pedido ? [cartaoPedido(pedido)] : []));
    if (focoNoSeletor) document.getElementById("previsao-fonte")?.focus();
  }
  await desenhar();
}
