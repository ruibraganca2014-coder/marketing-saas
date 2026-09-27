// Simulação do cliente (docs/SIMULADOR-ORCAMENTO.md §6) na ficha do pedido de orçamento: resumo, artigos
// (nome do catálogo; os que já não existem ficam marcados), mão de obra, quadro elétrico, divisões e a planta
// só de leitura (§2.1, desenhada por vendor/planta-svg.js) com zoom e deslocamento.
// Também sugere os aparelhos a pedir ao servidor ("Converter em cliente e obra"): aparelhosDaSimulacao().
import { numero } from "../api.js";
import { h, euros, num, selo, dados } from "../ui.js";
// Importação em namespace: o módulo vem do simulador (web/simulador/planta-svg.js) e só se garante desenharPlanta.
import * as desenho from "../vendor/planta-svg.js";

export const PLANOS_SIM = { base: "Base", conforto: "Conforto", premium: "Premium" };
const TIPOS_CASA = { moradia: "Moradia", apartamento: "Apartamento", alojamento_local: "Alojamento local", outro: "Outro" };
const FASES = { mono: "Monofásica", tri: "Trifásica" };
const TIPOS_CIRCUITO = { iluminacao: "Iluminação", tomadas: "Tomadas", maquina: "Máquina", misto: "Misto" };
const MODELOS = {
  termoacumulador: "Termoacumulador", ar_condicionado: "Ar condicionado", placa: "Placa", forno: "Forno", maquina_lavar: "Máquina de lavar",
  maquina_secar: "Máquina de secar", maquina_loica: "Máquina da loiça", frigorifico: "Frigorífico", televisao: "Televisão", bomba_calor: "Bomba de calor", carregador_ve: "Carregador VE",
  bomba: "Bomba (piscina/rega)", outro: "Outra máquina",
};
// Passo "A casa" e "O que quer" do simulador (web/simulador/regras.js EXTRAS_CASA, OBJETIVOS).
const EXTRAS_CASA = { jardim: "jardim/exterior", garagem: "garagem/arrecadação", varanda: "varanda/terraço", kitnet: "kitnet (cozinha aberta)" };
const OBJETIVOS = {
  poupar: "Poupar energia", alarme: "Alarme e segurança", estores: "Estores automáticos", luzes: "Luzes pelo telemóvel",
  distancia: "Controlar à distância", clima: "Aquecimento / ar condicionado",
};

/** "T3 · 2 casas de banho · 2 salas · 2 pisos · jardim/exterior" (campos novos de `casa`; vazio se não houver tipologia). */
function tipologiaTxt(casa) {
  if (typeof casa.tipologia !== "string") return "";
  const q = numero(casa.quartos);
  const partes = [casa.tipologia === "T5+" && q !== null ? `T${num(q)} (T5+)` : casa.tipologia];
  if (numero(casa.casas_banho) !== null) partes.push(plural(numero(casa.casas_banho), "casa de banho", "casas de banho"));
  if (numero(casa.salas) !== null) partes.push(plural(numero(casa.salas), "sala", "salas"));
  if (numero(casa.pisos) !== null) partes.push(plural(numero(casa.pisos), "piso", "pisos"));
  const x = obj(casa.extras);
  partes.push(...Object.keys(EXTRAS_CASA).filter((k) => x[k] === true).map((k) => EXTRAS_CASA[k]));
  return partes.join(" · ");
}
const NOMES_ELEMENTOS = {
  porta: "Portas", janela: "Janelas", quadro: "Quadro elétrico", tomada: "Tomadas", luz: "Pontos de luz", interruptor: "Interruptores",
  maquina: "Máquinas", sensor_porta: "Sensores de porta/janela", sensor_movimento: "Sensores de movimento",
};
const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
export const CARGA_PERIGOSA_W = 2000;

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const n0 = (v) => numero(v) ?? 0;
const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;

/** Planta pronta a desenhar: só as chaves de §2.1; fundo só data:image/jpeg|png (aceita o texto de §6 ou o objeto de §2.1). */
export function limparPlanta(p) {
  const pl = obj(p);
  const out = {
    escala_cm: numero(pl.escala_cm) ?? 50, largura_cm: numero(pl.largura_cm), altura_cm: numero(pl.altura_cm), fundo: null,
    divisoes: arr(pl.divisoes).slice(0, 40).filter((d) => d && typeof d === "object"),
    elementos: arr(pl.elementos).slice(0, 400).filter((e) => e && typeof e === "object"),
  };
  const f = typeof pl.fundo === "string" ? { imagem: pl.fundo } : obj(pl.fundo);
  if (typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem)) {
    out.fundo = { imagem: f.imagem, x_cm: numero(f.x_cm) ?? 0, y_cm: numero(f.y_cm) ?? 0, largura_cm: numero(f.largura_cm) ?? out.largura_cm ?? 1000, opacidade: numero(f.opacidade) ?? 0.5 };
  }
  return out;
}

/** Nome de uma divisão da planta pelo id (ou o próprio texto). */
// Linha que o simulador junta às divisões para os elementos fora de todas: não é uma divisão.
const FORA = "Fora das divisões";

function nomeDivisao(planta, id) {
  if (id == null || id === "" || id === FORA) return null;
  const d = arr(planta?.divisoes).find((x) => x && x.id === id);
  return d ? String(d.nome ?? id) : String(id);
}

/**
 * Divisão de um elemento da planta (a mesma regra do simulador, web/simulador/regras.js divisaoDoElemento):
 * a que contém o centro (a última desenhada ganha); portas, janelas e sensores de porta/janela fora de
 * todas contam na mais próxima a ≤ 30 cm (paredes exteriores). Usada quando o elemento não traz `divisao`.
 */
export const TOLERANCIA_PORTA_CM = 30;
export function divisaoDoElemento(planta, e) {
  const x = n0(e?.x_cm), y = n0(e?.y_cm);
  const divs = arr(planta?.divisoes).filter((d) => d && typeof d === "object");
  let r = null;
  for (const d of divs) if (distanciaDivisao(d, x, y) === 0) r = d.id;
  if (r != null || !["porta", "janela", "sensor_porta"].includes(e?.tipo)) return r;
  let melhor = TOLERANCIA_PORTA_CM;
  for (const d of divs) {
    const dist = distanciaDivisao(d, x, y);
    if (dist <= melhor) { melhor = dist; r = d.id; }
  }
  return r;
}

/**
 * Cantos da divisão: `pontos` ([[x, y], ...], 3–24, paredes oblíquas) ou os 4 cantos do retângulo
 * (a mesma regra de web/simulador/regras.js pontosDivisao).
 */
function cantosDivisao(d) {
  const p = d.pontos;
  if (Array.isArray(p) && p.length >= 3 && p.length <= 24 && p.every((q) => Array.isArray(q) && numero(q[0]) !== null && numero(q[1]) !== null)) return p.map((q) => [numero(q[0]), numero(q[1])]);
  const x = n0(d.x_cm), y = n0(d.y_cm), w = n0(d.largura_cm), h = n0(d.altura_cm);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** 0 se o ponto está dentro da divisão (ou na parede); senão a distância à parede mais próxima (cm). */
function distanciaDivisao(d, x, y) {
  const pts = cantosDivisao(d);
  let dentro = false, m = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    const dx = xi - xj, dy = yi - yj, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((x - xj) * dx + (y - yj) * dy) / l2)) : 0;
    m = Math.min(m, Math.hypot(x - (xj + t * dx), y - (yj + t * dy)));
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro || m < 0.5 ? 0 : m;
}

/**
 * Potência (W) das máquinas de um circuito e se tem carga perigosa (≥ 2000 W). `sobrecarga`: a soma para a
 * conta dos 80 %, sem a placa (simultaneidade) nem o carregador VE (limita a corrente) — como no simulador.
 */
function maquinasDe(c) {
  const m = arr(obj(c.itens).maquinas).filter((x) => x && typeof x === "object");
  const semConta = (x) => x.modelo === "placa" || x.modelo === "carregador_ve";
  return {
    lista: m, total: m.reduce((s, x) => s + n0(x.potencia_w), 0), perigosa: m.some((x) => n0(x.potencia_w) >= CARGA_PERIGOSA_W),
    sobrecarga: m.filter((x) => !semConta(x)).reduce((s, x) => s + n0(x.potencia_w), 0),
  };
}

// ---------------------------------------------------------------- visualizador

/**
 * Secção "Simulação do cliente". `catalogo`: {SKU: {nome, categoria, ativo, …}} (GET orcamentos/:id → catalogo).
 */
export function vistaSimulacao(sim, catalogo = {}) {
  const casa = obj(sim.casa);
  const total = sim.total;
  const itens = arr(sim.itens).filter((i) => i && typeof i === "object");
  const mo = obj(sim.mao_obra);
  const plano = typeof sim.plano_sugerido === "string" ? sim.plano_sugerido : null;
  const avisos = arr(sim.avisos).filter((a) => typeof a === "string" && a.trim());
  const nItens = itens.reduce((s, i) => s + (numero(i.qtd ?? i.quantidade) ?? 1), 0);
  let estimativa = "—";
  if (total && typeof total === "object") estimativa = `${euros(total.min)} – ${euros(total.max)}`;
  else if (numero(total) !== null) estimativa = euros(total);
  const casaTxt = [TIPOS_CASA[casa.tipo] ?? casa.tipo, numero(casa.divisoes) !== null ? plural(numero(casa.divisoes), "divisão", "divisões") : null, casa.localidade].filter(Boolean).join(" · ");
  const kva = numero(casa.potencia_contratada_kva);
  const instalacaoTxt = `${kva !== null ? `${num(kva)} kVA` : "potência: não sabe"} · ${FASES[casa.fases] ?? "ligação: não sabe"}`;
  const quer = obj(sim.quer);
  const maquinasTxt = arr(quer.maquinas).filter((m) => typeof m === "string").map((m) => MODELOS[m] ?? m).join(", ");
  const objetivosTxt = arr(quer.objetivos).filter((o) => typeof o === "string").map((o) => OBJETIVOS[o] ?? o).join(", ");

  const partes = [
    h("h3", { text: "Simulação do cliente" }),
    dados([
      ["Casa", casaTxt || "—"],
      ...(tipologiaTxt(casa) ? [["Tipologia", tipologiaTxt(casa)]] : []),
      ...(sim.quer !== undefined ? [["Máquinas grandes", maquinasTxt || "Nenhuma"], ["Objetivos", objetivosTxt || "Nenhum"]] : []),
      ["Potência contratada e ligação", instalacaoTxt],
      ["Estimativa (c/ IVA)", estimativa],
      ["Plano sugerido", plano ? selo(PLANOS_SIM[plano] ?? plano, "plano-sugerido") : "—"],
      ["Equipamentos", String(nItens)],
    ]),
  ];
  if (avisos.length) {
    partes.push(h("div", { class: "avisos-sim", role: "note" }, h("h4", { text: `Avisos (${avisos.length})` }),
      h("ul", {}, ...avisos.slice(0, 50).map((a) => h("li", { text: a })))));
  }
  if (itens.length) partes.push(tabelaItens(itens, mo, catalogo));
  const circuitos = arr(obj(sim.quadro).circuitos).filter((c) => c && typeof c === "object");
  const planta = sim.planta && typeof sim.planta === "object" ? limparPlanta(sim.planta) : null;
  if (circuitos.length) partes.push(tabelaCircuitos(circuitos, planta));
  const divs = arr(sim.divisoes).filter((d) => d && typeof d === "object"
    && !(d.nome === FORA && !["luzes_regulaveis", "estores", "estores_sem_motor", "sensores_porta", "sensores_movimento", "tomadas_inteligentes"].some((k) => contar(d[k])) && !arr(d.interruptores).length));
  if (divs.length) partes.push(tabelaDivisoes(divs));
  if (planta && (planta.divisoes.length || planta.elementos.length || planta.fundo)) partes.push(vistaPlanta(planta));
  partes.push(h("p", { class: "ajuda", text: "Estimativa feita pelo cliente no site (preços com IVA). O valor final é confirmado na visita técnica." }));
  return h("section", { class: "simulacao", id: "simulacao-cliente" }, ...partes);
}

function tabelaItens(itens, mo, catalogo) {
  let soma = 0;
  const linhas = itens.slice(0, 300).map((i) => {
    const sku = typeof i.sku === "string" ? i.sku : "";
    const art = catalogo && typeof catalogo === "object" ? catalogo[sku] : null;
    const qtd = numero(i.qtd ?? i.quantidade) ?? 1;
    const preco = numero(i.preco_iva ?? i.preco);
    const sub = preco === null ? null : Math.round(preco * qtd * 100) / 100;
    soma += sub ?? 0;
    const marca = !art ? selo("Já não está no catálogo", "grav-critica") : art.ativo === false ? selo("Inativo no catálogo", "aviso") : null;
    return h("tr", { dataset: { sku }, class: art ? "" : "fora-catalogo" },
      h("td", { "data-rotulo": "Artigo" }, h("div", {}, h("span", { class: "sim-artigo", text: art?.nome ?? (sku || "—") }), h("span", { class: "ajuda bloco-ajuda", text: sku }), marca)),
      h("td", { class: "num", "data-rotulo": "Qtd.", text: num(qtd) }),
      h("td", { class: "num", "data-rotulo": "Preço", text: euros(preco) }),
      h("td", { class: "num", "data-rotulo": "Subtotal", text: euros(sub) }));
  });
  const moValor = numero(mo.valor_iva);
  const pe = [h("tr", {}, h("th", { scope: "row", colspan: "3", text: "Artigos" }), h("td", { class: "num", text: euros(soma) }))];
  if (moValor !== null || numero(mo.horas) !== null) {
    pe.push(h("tr", { class: "mao-obra" }, h("th", { scope: "row", colspan: "3", text: `Mão de obra${numero(mo.horas) !== null ? ` (${num(mo.horas)} h)` : ""}` }), h("td", { class: "num", text: euros(moValor) })));
    pe.push(h("tr", {}, h("th", { scope: "row", colspan: "3", text: "Total (sem intervalo)" }), h("td", { class: "num", text: euros(soma + (moValor ?? 0)) })));
  }
  const fora = linhas.filter((l) => l.classList.contains("fora-catalogo")).length;
  return h("div", { class: "sim-bloco" }, h("h4", { text: "Artigos" }),
    fora ? h("p", { class: "msg info", text: `${plural(fora, "artigo já não está", "artigos já não estão")} no catálogo: confirme o material antes da obra.` }) : null,
    h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "sim-itens" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Artigo" }), h("th", { scope: "col", class: "num", text: "Qtd." }), h("th", { scope: "col", class: "num", text: "Preço" }), h("th", { scope: "col", class: "num", text: "Subtotal" }))),
      h("tbody", {}, ...linhas), h("tfoot", {}, ...pe))));
}

function tabelaCircuitos(circuitos, planta) {
  const linhas = circuitos.slice(0, 80).map((c) => {
    const it = obj(c.itens);
    const m = maquinasDe(c);
    const amp = numero(c.amperes);
    const conteudo = [
      n0(it.luzes) ? plural(n0(it.luzes), "luz", "luzes") : null,
      n0(it.tomadas) ? plural(n0(it.tomadas), "tomada", "tomadas") : null,
      ...m.lista.map((x) => `${MODELOS[x.modelo] ?? x.modelo ?? "Máquina"} ${num(x.potencia_w)} W`),
    ].filter(Boolean).join(", ") || "—";
    const excesso = amp && m.sobrecarga > Math.round(amp * 230 * 0.8);
    const divs = arr(c.divisoes).map((d) => nomeDivisao(planta, d)).filter(Boolean).join(", ");
    return h("tr", { dataset: { n: String(c.n ?? "") } },
      h("td", { class: "num", "data-rotulo": "N.º", text: String(c.n ?? "—") }),
      h("td", { "data-rotulo": "Circuito" }, h("div", {}, h("span", { text: String(c.nome ?? TIPOS_CIRCUITO[c.tipo] ?? "—") }), h("span", { class: "ajuda bloco-ajuda", text: [TIPOS_CIRCUITO[c.tipo] ?? c.tipo, divs].filter(Boolean).join(" · ") }))),
      h("td", { class: "num", "data-rotulo": "Disjuntor", text: amp ? `${amp} A` : "—" }),
      h("td", { "data-rotulo": "Liga" }, h("div", {}, conteudo, excesso ? h("span", { class: "aviso-texto bloco-ajuda", text: `${num(m.sobrecarga)} W para ${amp} A` }) : null)),
      h("td", { "data-rotulo": "Inteligente" }, h("span", { class: "linha-selos" },
        c.inteligente ? selo("Inteligente", "orc-aceite") : h("span", { class: "ajuda", text: "Não" }),
        c.medir ? selo("Mede consumo", "info") : null,
        m.perigosa ? selo("Carga perigosa", "grav-critica") : null)));
  });
  return h("div", { class: "sim-bloco" }, h("h4", { text: `Quadro elétrico (${plural(circuitos.length, "circuito", "circuitos")})` }),
    h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "sim-circuitos" },
      h("thead", {}, h("tr", {}, ...["N.º", "Circuito", "Disjuntor", "Liga", "Inteligente"].map((t, i) => h("th", { scope: "col", class: i === 0 || i === 2 ? "num" : "", text: t })))),
      h("tbody", {}, ...linhas))));
}

/** Contagem de um campo de divisão: número, lista (tamanho) ou booleano. */
function contar(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "boolean") return v ? 1 : 0;
  return numero(v) ?? 0;
}
function tabelaDivisoes(divs) {
  const colunas = [
    ["Luzes regul.", (d) => contar(d.luzes_regulaveis ?? d.luzes_brilho ?? d.brilho) || "—"],
    ["Interruptores", (d) => {
      const l = arr(d.interruptores);
      if (l.length) return l.map((i) => `${numero(obj(i).botoes ?? i) ?? 1} bot.`).join(", ");
      return contar(d.interruptores) || "—";
    }],
    ["Estores", (d) => { const m = contar(d.estores), s = contar(d.estores_sem_motor); return m + s ? `${m + s}${s ? ` (${s} sem motor)` : ""}` : "—"; }],
    ["Sensores porta", (d) => contar(d.sensores_porta) || "—"],
    ["Sensores movimento", (d) => contar(d.sensores_movimento) || "—"],
    ["Tomadas intelig.", (d) => contar(d.tomadas_inteligentes) || "—"],
  ];
  return h("div", { class: "sim-bloco" }, h("h4", { text: `Divisões (${divs.length})` }),
    h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "sim-divisoes" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Divisão" }), ...colunas.map(([t]) => h("th", { scope: "col", class: "num", text: t })))),
      h("tbody", {}, ...divs.slice(0, 60).map((d) => h("tr", {}, h("th", { scope: "row", "data-rotulo": "Divisão", text: String(d.nome ?? "—") }),
        ...colunas.map(([t, f]) => h("td", { class: "num", "data-rotulo": t, text: String(f(d)) }))))))));
}

// ---------------------------------------------------------------- planta (zoom e deslocamento)

function vistaPlanta(planta) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "sim-planta");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Planta da casa: ${plural(planta.divisoes.length, "divisão", "divisões")}, ${plural(planta.elementos.length, "elemento", "elementos")}`);
  let base;
  try { base = desenho.desenharPlanta(svg, planta, { soLeitura: true }); } catch { return h("p", { class: "msg erro", text: "Não foi possível desenhar a planta." }); }
  const vb0 = (svg.getAttribute("viewBox") || `0 0 ${base?.largura ?? 1000} ${base?.altura ?? 800}`).split(/[\s,]+/).map(Number);
  let vb = [...vb0];
  const aplicar = () => svg.setAttribute("viewBox", vb.map((x) => Math.round(x * 10) / 10).join(" "));
  const zoom = (f, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => {
    const w = Math.min(vb0[2] * 4, Math.max(vb0[2] / 12, vb[2] / f));
    const k = w / vb[2];
    vb = [cx - (cx - vb[0]) * k, cy - (cy - vb[1]) * k, w, vb[3] * k];
    aplicar();
  };
  const ponto = (ev) => {
    const r = svg.getBoundingClientRect();
    // preserveAspectRatio meet: a escala é a menor das duas.
    const s = Math.max(vb[2] / r.width, vb[3] / r.height);
    const ox = (r.width * s - vb[2]) / 2, oy = (r.height * s - vb[3]) / 2;
    return { x: vb[0] - ox + (ev.clientX - r.left) * s, y: vb[1] - oy + (ev.clientY - r.top) * s, s };
  };
  svg.addEventListener("wheel", (ev) => { ev.preventDefault(); const p = ponto(ev); zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
  const toques = new Map();
  let arrasto = null, pinca = null;
  svg.addEventListener("pointerdown", (ev) => {
    svg.setPointerCapture?.(ev.pointerId);
    toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (toques.size === 1) arrasto = { x: ev.clientX, y: ev.clientY, vb: [...vb], s: ponto(ev).s };
    else if (toques.size === 2) { const [a, b] = [...toques.values()]; pinca = Math.hypot(a.x - b.x, a.y - b.y); arrasto = null; }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!toques.has(ev.pointerId)) return;
    toques.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (toques.size === 2 && pinca) {
      const [a, b] = [...toques.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const p = ponto({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoom(d / pinca, p.x, p.y); pinca = d;
    } else if (arrasto) {
      vb[0] = arrasto.vb[0] - (ev.clientX - arrasto.x) * arrasto.s;
      vb[1] = arrasto.vb[1] - (ev.clientY - arrasto.y) * arrasto.s;
      aplicar();
    }
  });
  const fim = (ev) => { toques.delete(ev.pointerId); if (toques.size < 2) pinca = null; if (!toques.size) arrasto = null; };
  svg.addEventListener("pointerup", fim);
  svg.addEventListener("pointercancel", fim);
  const botao = (texto, rotulo, acao, id) => h("button", { class: "botao-icone", type: "button", "aria-label": rotulo, title: rotulo, id, text: texto, onclick: acao });
  // Legenda: contagem por tipo de elemento.
  const porTipo = new Map();
  for (const e of planta.elementos) { const t = NOMES_ELEMENTOS[e.tipo] ?? String(e.tipo ?? "?"); porTipo.set(t, (porTipo.get(t) ?? 0) + 1); }
  return h("div", { class: "sim-bloco" },
    h("div", { class: "planta-topo" }, h("h4", { text: "Planta" }),
      h("div", { class: "planta-botoes", role: "group", "aria-label": "Zoom da planta" },
        botao("−", "Afastar", () => zoom(1 / 1.3), "planta-menos"), botao("+", "Aproximar", () => zoom(1.3), "planta-mais"),
        h("button", { class: "btn sec pequeno", type: "button", id: "planta-ajustar", text: "Ajustar", onclick: () => { vb = [...vb0]; aplicar(); } }))),
    h("div", { class: "planta-vista" }, svg),
    h("p", { class: "ajuda", text: "Arraste para deslocar; roda do rato ou dois dedos para o zoom. Passe por cima de um elemento para ver o que é." }),
    porTipo.size ? h("ul", { class: "planta-legenda" }, ...[...porTipo].map(([t, n]) => h("li", { text: `${t}: ${n}` }))) : null);
}

// ---------------------------------------------------------------- aparelhos sugeridos

const RE_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** Texto para "id" (letras minúsculas, dígitos e "-"). */
export function slug(s, max = 24) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}
// Nomes escritos pelo cliente (divisões, circuitos) vão para os pedidos do domus.sh: sem aspas, "\\", "<" nem ">".
const nomeLimpo = (s, max = 60) => String(s ?? "").replace(/["\\<>]/g, "").replace(/^[-\s]+/, "").trim().slice(0, max).trim();
const canalLimpo = (s) => String(s ?? "").replace(/[:,"\\<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30).trim();
function divisaoLimpa(s) {
  let t = String(s ?? "").replace(/["\\:,<>]/g, " ").replace(/\s+/g, " ").replace(/^[-\s]+/, "").trim();
  while (new TextEncoder().encode(t).length > 40) t = t.slice(0, -1).trim();
  return t;
}

/** Categoria e pormenores de um SKU (catálogo do pedido; sem ele, pelo próprio SKU). */
function tipoArtigo(sku, art) {
  const cat = art?.categoria ?? (/^TONGOU|DISJ/.test(sku) ? "disjuntor" : /^INT-|-\dCH$|MOD-/.test(sku) ? "interruptor" : /CURTAIN|ESTORE/.test(sku) ? "estore"
    : /SENS|PIR|PORTA/.test(sku) ? "sensor" : /TOMADA|PLUG/.test(sku) ? "tomada" : /DIMMER/.test(sku) ? "luz" : "outro");
  const esp = obj(art?.especificacoes);
  if (cat === "sensor") return { cat: /movimento|pir|mov/i.test(`${sku} ${art?.nome ?? ""}`) ? "sensor_movimento" : "sensor_porta" };
  if (cat === "interruptor") {
    const m = /-(\d)(?:CH)?$/.exec(sku);
    return { cat, botoes: Math.min(4, Math.max(1, numero(esp.botoes) ?? numero(esp.canais) ?? (m ? Number(m[1]) : 1))) };
  }
  if (cat === "tomada") return { cat, medidor: esp.medicao !== false };
  return { cat };
}

/**
 * Aparelhos do servidor (opções do "domus.sh aparelho") sugeridos a partir da simulação:
 * - disjuntor (por circuito inteligente) → openbeken com medidor; circuito com máquina ≥ 2000 W → carga=perigosa;
 * - interruptor com N botões → N canais "interruptor";  estore → shelly com canal "estore";
 * - sensor de porta → openbeken porta + bateria ("entrada" se o elemento/porta da planta for de entrada);
 * - sensor de movimento → openbeken movimento + bateria;  tomada → openbeken com medidor;  regulador → canal "luz".
 * A quantidade de cada tipo vem dos artigos (itens); a planta e o quadro dão nomes, divisões e opções.
 * Devolve [{id, tipo, nome, canais, divisao, medidor, bateria, origem}].
 */
export function aparelhosDaSimulacao(sim, catalogo = {}) {
  const planta = sim?.planta && typeof sim.planta === "object" ? limparPlanta(sim.planta) : { divisoes: [], elementos: [] };
  const els = planta.elementos;
  // Sem `divisao` (ou planta antiga): a mesma regra do simulador (portas/janelas até 30 cm fora contam).
  const divDe = (e) => (e ? nomeDivisao(planta, e.divisao != null && e.divisao !== "" ? e.divisao : divisaoDoElemento(planta, e)) : null);
  // Aparelhos que não estão desenhados na planta (planta saltada, ou postos pelos objetivos): a divisão vem
  // do passo "Divisões" (sim.divisoes), descontando as que já foram dadas por elementos da planta.
  const filas = {};
  const filaDe = (campo) => (filas[campo] ??= arr(sim?.divisoes).flatMap((d) => {
    const nome = divisaoLimpa(obj(d).nome);
    if (!nome || nome === FORA) return [];
    const n = campo === "interruptores" ? arr(d.interruptores).length : contar(d[campo]);
    return Array(Math.min(60, n)).fill(nome);
  }));
  const gastar = (campo, div) => { const f = filaDe(campo); const i = f.indexOf(div); if (i >= 0) f.splice(i, 1); };
  const proxima = (campo) => filaDe(campo).shift() ?? null;
  /** Divisões pela ordem: primeiro as dos elementos da planta; o resto, da fila do passo "Divisões". */
  const divisoesPara = (campo, elementos, n) => {
    const planta = elementos.slice(0, n).map((e) => divDe(e));
    for (const d of planta) if (d) gastar(campo, d);
    return Array.from({ length: n }, (_, k) => planta[k] ?? proxima(campo));
  };
  const quant = {}; const skus = {};
  const botoesLista = [];
  for (const i of arr(sim?.itens)) {
    if (!i || typeof i.sku !== "string") continue;
    const q = Math.min(60, Math.max(0, Math.round(numero(i.qtd ?? i.quantidade) ?? 1)));
    const t = tipoArtigo(i.sku, obj(catalogo)[i.sku]);
    quant[t.cat] = (quant[t.cat] ?? 0) + q;
    (skus[t.cat] ??= []).push(i.sku);
    if (t.cat === "interruptor") for (let k = 0; k < q; k++) botoesLista.push({ botoes: t.botoes, sku: i.sku });
    if (t.cat === "tomada") skus.tomadaMedidor = t.medidor;
  }
  const out = [];
  const usados = new Set();
  const juntar = (base, a) => {
    let id = slug(base, 28) || "aparelho";
    if (usados.has(id)) { let k = 2; while (usados.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
    if (!RE_ID.test(id)) id = `aparelho-${out.length + 1}`;
    usados.add(id);
    out.push({ id, tipo: a.tipo, nome: nomeLimpo(a.nome) || id, canais: a.canais, divisao: divisaoLimpa(a.divisao ?? ""), medidor: !!a.medidor, bateria: !!a.bateria, origem: a.origem });
  };

  // Disjuntores: um por circuito inteligente (pela ordem do quadro).
  const circuitos = arr(obj(sim?.quadro).circuitos).filter((c) => c && typeof c === "object");
  const cand = circuitos.filter((c) => c.inteligente);
  const lista = cand.length ? cand : circuitos;
  for (let k = 0; k < (quant.disjuntor ?? 0); k++) {
    const c = lista[k];
    const m = c ? maquinasDe(c) : { perigosa: false, lista: [] };
    const nomeC = c ? String(c.nome || TIPOS_CIRCUITO[c.tipo] || `Circuito ${c.n}`) : `Disjuntor ${k + 1}`;
    const divs = c ? arr(c.divisoes).map((d) => nomeDivisao(planta, d)).filter(Boolean) : [];
    const pesada = m.lista.filter((x) => n0(x.potencia_w) >= CARGA_PERIGOSA_W).map((x) => `${MODELOS[x.modelo] ?? "máquina"} ${num(x.potencia_w)} W`);
    juntar(c ? `circuito-${c.n ?? k + 1}` : `disjuntor-${k + 1}`, {
      tipo: "openbeken", nome: c ? `Circuito ${c.n ?? k + 1} ${nomeC}` : nomeC, medidor: true,
      canais: `1:interruptor:${canalLimpo(nomeC) || "Circuito"}${m.perigosa ? ":carga=perigosa" : ""}`,
      divisao: divs.length === 1 ? divs[0] : "",
      origem: [skus.disjuntor?.[0], c ? `circuito ${c.n}${c.amperes ? ` (${c.amperes} A)` : ""}` : null, m.perigosa ? `carga perigosa: ${pesada.join(", ")}` : null].filter(Boolean).join(" · "),
    });
  }

  // Interruptores: pelos botões; a planta dá a divisão.
  const intPlanta = els.filter((e) => e.tipo === "interruptor");
  const intUsados = new Set();
  const intEls = botoesLista.map((b) => {
    const e = intPlanta.find((x) => !intUsados.has(x) && numero(obj(x.props).botoes) === b.botoes) ?? intPlanta.find((x) => !intUsados.has(x));
    if (e) intUsados.add(e);
    return e;
  });
  const intDivs = divisoesPara("interruptores", intEls, intEls.length);
  botoesLista.forEach((b, k) => {
    const div = intDivs[k];
    const canais = Array.from({ length: b.botoes }, (_, i) => `${i + 1}:interruptor:${b.botoes === 1 ? "Luz" : `Luz ${i + 1}`}`).join(",");
    juntar(div ? `interruptor-${slug(div, 16)}` : `interruptor-${k + 1}`, {
      tipo: "openbeken", nome: div ? `Interruptor ${div}` : `Interruptor ${k + 1}`, canais, divisao: div,
      origem: `${b.sku} · ${b.botoes} ${b.botoes === 1 ? "botão" : "botões"}${div ? ` · ${div}` : ""}`,
    });
  });

  // Estores: janelas com estore (motorizado primeiro).
  const janelas = els.filter((e) => e.tipo === "janela" && obj(e.props).estore).sort((a, b) => Number(!!obj(b.props).motorizado) - Number(!!obj(a.props).motorizado));
  const estDivs = divisoesPara("estores", janelas, quant.estore ?? 0);
  for (let k = 0; k < (quant.estore ?? 0); k++) {
    const div = estDivs[k];
    juntar(div ? `estore-${slug(div, 18)}` : `estore-${k + 1}`, {
      tipo: "shelly", nome: div ? `Estore ${div}` : `Estore ${k + 1}`, canais: "1:estore:Estore", divisao: div,
      origem: [skus.estore?.[0], div ? `janela: ${div}` : null].filter(Boolean).join(" · "),
    });
  }

  // Sensores de porta/janela: os da planta; "entrada" se o elemento o diz ou a porta mais próxima (≤ 1,5 m) é de entrada.
  const portas = els.filter((e) => e.tipo === "porta" || e.tipo === "janela");
  const perto = (s) => {
    let melhor = null, dist = 150;
    for (const p of portas) { const d = Math.hypot(n0(p.x_cm) - n0(s.x_cm), n0(p.y_cm) - n0(s.y_cm)); if (d <= dist) { dist = d; melhor = p; } }
    return melhor;
  };
  const sensP = els.filter((e) => e.tipo === "sensor_porta").map((s) => {
    const p = perto(s);
    return { div: divDe(s) ?? divDe(p), entrada: !!obj(s.props).entrada || (p?.tipo === "porta" && !!obj(p.props).entrada), janela: p?.tipo === "janela", porta: p };
  });
  // Portas de entrada sem sensor desenhado (o simulador sugere um sensor para cada).
  for (const p of els.filter((e) => e.tipo === "porta" && obj(e.props).entrada)) {
    if (!sensP.some((s) => s.porta === p)) sensP.push({ div: divDe(p), entrada: true, janela: false, porta: p });
  }
  sensP.sort((a, b) => Number(b.entrada) - Number(a.entrada));
  for (const s of sensP.slice(0, quant.sensor_porta ?? 0)) if (s.div) gastar("sensores_porta", s.div);
  for (let k = 0; k < (quant.sensor_porta ?? 0); k++) {
    const s = sensP[k] ?? { div: proxima("sensores_porta"), entrada: false, janela: false };
    const coisa = s.janela ? "Janela" : s.entrada ? "Porta de entrada" : "Porta";
    const nome = s.entrada ? "Sensor da porta de entrada" : `Sensor da ${coisa.toLowerCase()}${s.div ? ` (${s.div})` : ""}`;
    juntar(s.entrada ? "porta-entrada" : `${s.janela ? "janela" : "porta"}-${slug(s.div ?? String(k + 1), 18)}`, {
      tipo: "openbeken", nome, bateria: true, divisao: s.div ?? "",
      canais: `1:porta:${coisa}${s.entrada ? ":entrada" : ""},2:bateria`,
      origem: [skus.sensor_porta?.[0], s.entrada ? "porta de entrada na planta" : s.div ? s.div : null].filter(Boolean).join(" · "),
    });
  }

  // Sensores de movimento.
  const pir = els.filter((e) => e.tipo === "sensor_movimento");
  const pirDivs = divisoesPara("sensores_movimento", pir, quant.sensor_movimento ?? 0);
  for (let k = 0; k < (quant.sensor_movimento ?? 0); k++) {
    const div = pirDivs[k];
    juntar(div ? `movimento-${slug(div, 16)}` : `movimento-${k + 1}`, {
      tipo: "openbeken", nome: div ? `Movimento ${div}` : `Sensor de movimento ${k + 1}`, bateria: true, divisao: div,
      canais: "1:movimento:Movimento,2:bateria", origem: [skus.sensor_movimento?.[0], div].filter(Boolean).join(" · "),
    });
  }

  // Tomadas inteligentes e reguladores de luz.
  for (let k = 0; k < (quant.tomada ?? 0); k++) {
    juntar(`tomada-${k + 1}`, { tipo: "openbeken", nome: `Tomada ${k + 1}`, medidor: skus.tomadaMedidor !== false, canais: "1:interruptor:Tomada", origem: skus.tomada?.[0] });
  }
  const luzes = els.filter((e) => e.tipo === "luz" && obj(e.props).brilho);
  const luzDivs = divisoesPara("luzes_regulaveis", luzes, quant.luz ?? 0);
  for (let k = 0; k < (quant.luz ?? 0); k++) {
    const div = luzDivs[k];
    juntar(div ? `luz-${slug(div, 18)}` : `luz-${k + 1}`, {
      tipo: "openbeken", nome: div ? `Luz ${div}` : `Luz regulável ${k + 1}`, canais: "1:luz:Luz", divisao: div,
      origem: [skus.luz?.[0], div ? `luz regulável: ${div}` : null].filter(Boolean).join(" · "),
    });
  }
  return out;
}
