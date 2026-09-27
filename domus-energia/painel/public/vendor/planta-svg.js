// Desenho da planta do simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md §2.1).
// Módulo ÚNICO, sem dependências: o simulador (web/) usa-o para editar e o painel
// da empresa copia-o para painel/public/vendor/planta-svg.js (visualizador só leitura).
//
//   desenharPlanta(svg, planta, { soLeitura })
//
// - `planta` no formato do §2.1 (centímetros a partir do canto superior esquerdo).
// - Nenhum texto entra como HTML: nomes só com textContent (em <text> e <title>).
// - Cores com as variáveis do tema "Terra" (docs/TEMA.md) e valores de recurso,
//   aplicadas pelo CSSOM (funciona com CSP sem 'unsafe-inline').
// - A imagem de fundo só é usada se for data:image/jpeg|png;base64.
//
// Opções (todas opcionais):
//   soLeitura   true → sem pegas nem destaque de seleção (visualizador)
//   selecionado id da divisão ou do elemento selecionado (editor)
//   vista       {x, y, w, h} em cm para o viewBox (por omissão, a planta toda)
//   raio        raio dos ícones em cm (por omissão, proporcional ao tamanho da planta)
//   raioToque   raio da zona de toque dos elementos em cm (≥ raio)
//   letra       tamanho da letra dos nomes das divisões em cm
//   pega        lado das pegas de redimensionar em cm
//   grelha      false → sem quadriculado

const NS = "http://www.w3.org/2000/svg";
const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const COR = {
  fundo: "var(--superficie, #fffdf0)",
  texto: "var(--texto, #283618)",
  suave: "var(--texto-suave, #5c6446)",
  borda: "var(--borda, #e6e0bf)",
  musgo: "var(--musgo, #606c38)",
  musgoClaro: "var(--musgo-claro, #eef0d9)",
  areia: "var(--areia, #dda15e)",
  argila: "var(--argila, #bc6c25)",
};

const NOMES = {
  porta: "Porta", janela: "Janela", quadro: "Quadro elétrico", tomada: "Tomada", luz: "Ponto de luz",
  interruptor: "Interruptor", maquina: "Máquina", sensor_porta: "Sensor de porta/janela", sensor_movimento: "Sensor de movimento",
};
const MODELOS = {
  termoacumulador: "Termoacumulador", ar_condicionado: "Ar condicionado", placa: "Placa de cozinha", forno: "Forno",
  maquina_lavar: "Máquina de lavar roupa", maquina_secar: "Máquina de secar roupa", maquina_loica: "Máquina de lavar loiça",
  frigorifico: "Frigorífico", bomba_calor: "Bomba de calor", carregador_ve: "Carregador de carro elétrico", outro: "Outra máquina",
};

// Ícones em traço (caixa 48 × 48, centro 24,24), no estilo das ilustrações "Terra".
// Cada entrada: lista de [tag, atributos, papel] — papel "t" = traço, "c" = cheio (areia), "a" = cheio (argila).
const ICONES = {
  porta: [["path", { d: "M16 38V11.5c5.4-.4 10.7-.4 16 0V38" }, "t"], ["path", { d: "M12 38.5h24" }, "t"], ["circle", { cx: 28.2, cy: 25.5, r: 1.6 }, "c"]],
  janela: [["path", { d: "M12.5 13c7.7-.4 15.3-.4 23 0 .4 7.3.4 14.7 0 22-7.7.4-15.3.4-23 0-.4-7.3-.4-14.7 0-22z" }, "t"], ["path", { d: "M24 13v22M12.8 24h22.4" }, "t"]],
  janela_estore: [["path", { d: "M12.5 13c7.7-.4 15.3-.4 23 0 .4 7.3.4 14.7 0 22-7.7.4-15.3.4-23 0-.4-7.3-.4-14.7 0-22z" }, "t"], ["path", { d: "M13 17.5h22M13 21.5h22M13 25.5h22" }, "t"]],
  quadro: [["rect", { x: 13, y: 11, width: 22, height: 26, rx: 3 }, "t"], ["path", { d: "M18 17v6M22.5 17v6M27 17v6M31 17v6M17 30h14" }, "t"]],
  tomada: [["circle", { cx: 24, cy: 24, r: 11.5 }, "t"], ["circle", { cx: 19.8, cy: 24, r: 1.7 }, "c"], ["circle", { cx: 28.2, cy: 24, r: 1.7 }, "c"]],
  tomada_dupla: [["rect", { x: 9.5, y: 16, width: 29, height: 16, rx: 7 }, "t"], ["circle", { cx: 16, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 20.5, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 27.5, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 32, cy: 24, r: 1.5 }, "c"]],
  luz: [["path", { d: "M18.3 27.8c-2.1-1.8-3.3-4.3-3.3-7C15 15.9 19 12 24 12s9 3.9 9 8.8c0 2.7-1.2 5.2-3.3 7-1 .9-1.6 2-1.6 3.3v.9h-8.2v-.9c0-1.3-.6-2.4-1.6-3.3z" }, "t"], ["path", { d: "M20.6 35.5h6.8" }, "t"]],
  interruptor: [["rect", { x: 14, y: 12, width: 20, height: 24, rx: 4 }, "t"], ["rect", { x: 20, y: 17.5, width: 8, height: 13, rx: 2 }, "t"]],
  maquina: [["rect", { x: 13, y: 11, width: 22, height: 26, rx: 3 }, "t"], ["circle", { cx: 24, cy: 26, r: 6.5 }, "t"], ["path", { d: "M17 15.5h5" }, "t"]],
  sensor_porta: [["rect", { x: 13, y: 14, width: 8, height: 20, rx: 2 }, "t"], ["rect", { x: 25, y: 16, width: 6, height: 16, rx: 2 }, "t"], ["path", { d: "M35 19.5c1.8 2.9 1.8 6.1 0 9" }, "t"]],
  sensor_movimento: [["circle", { cx: 18, cy: 24, r: 5.5 }, "t"], ["path", { d: "M27 18.5c2.6 3.4 2.6 7.6 0 11M31.5 15c4.3 5.5 4.3 12.5 0 18" }, "t"]],
};
const ICONE_RAIO = [["path", { d: "M26 13 18 26h6l-2 9 8-13h-6z" }, "c"]];

let contador = 0;

function no(tag, atrs, estilo) {
  const e = document.createElementNS(NS, tag);
  if (atrs) for (const [k, v] of Object.entries(atrs)) e.setAttribute(k, String(v));
  if (estilo) for (const [k, v] of Object.entries(estilo)) e.style.setProperty(k, v);
  return e;
}

const numero = (v, omissao = 0) => (Number.isFinite(Number(v)) ? Number(v) : omissao);

function descrever(e, nomesDivisao) {
  const p = e.props || {};
  let t = NOMES[e.tipo] || "Elemento";
  if (e.tipo === "porta" && p.entrada) t = "Porta da rua";
  if (e.tipo === "janela" && p.estore) t = p.motorizado ? "Janela com estore motorizado" : "Janela com estore";
  if (e.tipo === "tomada" && p.dupla) t = "Tomada dupla";
  if (e.tipo === "luz" && p.brilho) t = "Ponto de luz regulável";
  if (e.tipo === "interruptor") t = `Interruptor de ${Math.min(4, Math.max(1, Math.round(numero(p.botoes, 1))))} ${numero(p.botoes, 1) > 1 ? "botões" : "botão"}`;
  if (e.tipo === "maquina") t = `${MODELOS[p.modelo] || MODELOS.outro} (${Math.round(numero(p.potencia_w))} W)`;
  const d = e.divisao && nomesDivisao.get(e.divisao);
  return d ? `${t} — ${d}` : t;
}

function icone(e) {
  const p = e.props || {};
  if (e.tipo === "janela" && p.estore) return ICONES.janela_estore;
  if (e.tipo === "tomada" && p.dupla) return ICONES.tomada_dupla;
  return ICONES[e.tipo] || ICONES.maquina;
}

/**
 * Desenha a planta no <svg> dado (substitui o conteúdo).
 * @param {SVGSVGElement} svg
 * @param {object} planta formato do §2.1
 * @param {object} [opcoes]
 */
export function desenharPlanta(svg, planta, opcoes = {}) {
  const { soLeitura = false, selecionado = null, grelha = true } = opcoes;
  const L = Math.max(1, numero(planta?.largura_cm, 2000));
  const A = Math.max(1, numero(planta?.altura_cm, 1500));
  const esc = Math.max(1, numero(planta?.escala_cm, 50));
  const raio = numero(opcoes.raio, Math.min(60, Math.max(18, Math.max(L, A) / 60)));
  const raioToque = Math.max(raio, numero(opcoes.raioToque, raio));
  const letra = numero(opcoes.letra, Math.max(24, raio * 0.9));
  const pega = numero(opcoes.pega, raio);
  const v = opcoes.vista || { x: 0, y: 0, w: L, h: A };
  const divisoes = Array.isArray(planta?.divisoes) ? planta.divisoes : [];
  const elementos = Array.isArray(planta?.elementos) ? planta.elementos : [];
  const nomesDivisao = new Map(divisoes.map((d) => [d.id, String(d.nome ?? "")]));
  const uid = `planta-${++contador}`;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (soLeitura) {
    svg.setAttribute("role", "img");
    const t = no("title");
    t.textContent = `Planta: ${divisoes.length} ${divisoes.length === 1 ? "divisão" : "divisões"} e ${elementos.length} ${elementos.length === 1 ? "elemento" : "elementos"}`;
    svg.append(t);
  }

  // Papel da planta (área útil) e fundo opcional.
  svg.append(no("rect", { x: 0, y: 0, width: L, height: A, "data-papel": "1" }, { fill: COR.fundo, stroke: COR.borda, "stroke-width": "1px", "vector-effect": "non-scaling-stroke" }));
  const f = planta?.fundo;
  if (f && typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem)) {
    const lf = Math.max(1, numero(f.largura_cm, L));
    const img = no("image", {
      x: numero(f.x_cm), y: numero(f.y_cm), width: lf, height: lf * 20, preserveAspectRatio: "xMinYMin meet", "data-fundo": "1",
    }, { opacity: String(Math.min(1, Math.max(0, numero(f.opacidade, 0.5)))), "pointer-events": "none" });
    img.setAttribute("href", f.imagem);
    const clip = no("clipPath", { id: `${uid}-recorte` });
    clip.append(no("rect", { x: 0, y: 0, width: L, height: A }));
    const defs = no("defs");
    defs.append(clip);
    svg.append(defs);
    img.setAttribute("clip-path", `url(#${uid}-recorte)`);
    svg.append(img);
  }

  // Quadriculado de 50 cm (um só <path>); cada metro um pouco mais marcado.
  if (grelha) {
    let d = "";
    let dm = "";
    for (let x = esc; x < L; x += esc) (x % 100 === 0 ? (dm += `M${x} 0V${A}`) : (d += `M${x} 0V${A}`));
    for (let y = esc; y < A; y += esc) (y % 100 === 0 ? (dm += `M0 ${y}H${L}`) : (d += `M0 ${y}H${L}`));
    const g = no("g", { "aria-hidden": "true" }, { "pointer-events": "none" });
    if (d) g.append(no("path", { d }, { fill: "none", stroke: COR.borda, "stroke-width": "0.75px", "vector-effect": "non-scaling-stroke", opacity: "0.8" }));
    if (dm) g.append(no("path", { d: dm }, { fill: "none", stroke: COR.borda, "stroke-width": "1.25px", "vector-effect": "non-scaling-stroke" }));
    svg.append(g);
  }

  // Divisões: retângulos com o nome no canto.
  const gd = no("g", { "data-camada": "divisoes" });
  for (const d of divisoes) {
    const x = numero(d.x_cm), y = numero(d.y_cm), w = Math.max(1, numero(d.largura_cm)), h = Math.max(1, numero(d.altura_cm));
    const sel = !soLeitura && selecionado === d.id;
    const g = no("g", { "data-divisao": d.id });
    const t = no("title");
    t.textContent = `${d.nome || "Divisão"} (${fmtM(w)} × ${fmtM(h)} m)`;
    g.append(t);
    g.append(no("rect", { x, y, width: w, height: h }, {
      fill: sel ? COR.musgoClaro : `color-mix(in srgb, ${COR.musgoClaro} 55%, transparent)`,
      stroke: sel ? COR.argila : COR.musgo, "stroke-width": sel ? "3px" : "2px", "vector-effect": "non-scaling-stroke",
    }));
    const nome = no("text", { x: x + letra * 0.4, y: y + letra * 1.15 }, {
      fill: COR.texto, "font-size": `${letra}px`, "font-weight": "700", "font-family": "var(--letra, system-ui, sans-serif)", "pointer-events": "none",
    });
    nome.textContent = String(d.nome ?? "");
    g.append(nome);
    const medida = no("text", { x: x + letra * 0.4, y: y + letra * 2.2 }, {
      fill: COR.suave, "font-size": `${letra * 0.72}px`, "font-family": "var(--letra, system-ui, sans-serif)", "pointer-events": "none",
    });
    medida.textContent = `${fmtM(w)} × ${fmtM(h)} m`;
    g.append(medida);
    gd.append(g);
  }
  svg.append(gd);

  // Elementos: ícone num disco, rodado quando faz sentido.
  const ge = no("g", { "data-camada": "elementos" });
  for (const e of elementos) {
    const x = numero(e.x_cm), y = numero(e.y_cm);
    const rot = [0, 90, 180, 270].includes(e.rot) ? e.rot : 0;
    const sel = !soLeitura && selecionado === e.id;
    const g = no("g", { "data-elemento": e.id, "data-tipo": String(e.tipo), transform: `translate(${x} ${y})` });
    const t = no("title");
    t.textContent = descrever(e, nomesDivisao);
    g.append(t);
    if (!soLeitura && raioToque > raio) g.append(no("circle", { r: raioToque, cx: 0, cy: 0 }, { fill: "transparent" }));
    if (sel) g.append(no("circle", { r: raio * 1.35, cx: 0, cy: 0 }, { fill: "none", stroke: COR.argila, "stroke-width": "3px", "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke" }));
    const destaque = (e.tipo === "porta" && e.props?.entrada) || e.tipo === "maquina";
    g.append(no("circle", { r: raio, cx: 0, cy: 0 }, {
      fill: destaque ? `color-mix(in srgb, ${COR.areia} 30%, ${COR.fundo})` : COR.fundo,
      stroke: e.tipo === "porta" && e.props?.entrada ? COR.argila : COR.musgo, "stroke-width": "2px", "vector-effect": "non-scaling-stroke",
    }));
    const s = (raio * 1.5) / 48;
    const gi = no("g", { transform: `rotate(${rot}) scale(${s}) translate(-24 -24)` }, { "pointer-events": "none" });
    const partes = e.tipo === "maquina" && numero(e.props?.potencia_w) >= 2000 ? [...icone(e), ...ICONE_RAIO.map(([tg, a]) => [tg, { ...a, transform: "translate(12 -8) scale(.5)" }, "a"])] : icone(e);
    for (const [tag, a, papel] of partes) {
      gi.append(no(tag, a, papel === "t"
        ? { fill: "none", stroke: COR.texto, "stroke-width": "1.6px", "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }
        : { fill: papel === "a" ? COR.argila : COR.areia, stroke: "none" }));
    }
    // Sentido (porta: para onde abre; janela/tomada/interruptor: a parede) — um traço na borda.
    if (e.tipo === "porta" || e.tipo === "janela" || e.tipo === "tomada" || e.tipo === "interruptor") {
      g.append(no("path", { d: `M${-raio * 0.7} ${-raio}H${raio * 0.7}`, transform: `rotate(${rot})` }, {
        fill: "none", stroke: COR.argila, "stroke-width": "4px", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none",
      }));
    }
    g.append(gi);
    ge.append(g);
  }
  svg.append(ge);

  // Pegas de redimensionar a divisão selecionada (editor).
  if (!soLeitura && selecionado) {
    const d = divisoes.find((x) => x.id === selecionado);
    if (d) {
      const gp = no("g", { "data-camada": "pegas" });
      const x = numero(d.x_cm), y = numero(d.y_cm), w = numero(d.largura_cm), h = numero(d.altura_cm);
      for (const [canto, cx, cy] of [["nw", x, y], ["ne", x + w, y], ["sw", x, y + h], ["se", x + w, y + h]]) {
        // Zona de toque grande (transparente) e, por cima, uma pega visível mais pequena
        // (não tapa o nome da divisão).
        const v = pega * 0.5;
        gp.append(no("rect", { x: cx - pega / 2, y: cy - pega / 2, width: pega, height: pega, "data-pega": canto, "data-id": d.id }, {
          fill: "transparent", cursor: canto === "nw" || canto === "se" ? "nwse-resize" : "nesw-resize",
        }));
        gp.append(no("rect", { x: cx - v / 2, y: cy - v / 2, width: v, height: v, rx: v / 4 }, {
          fill: COR.fundo, stroke: COR.argila, "stroke-width": "3px", "vector-effect": "non-scaling-stroke", "pointer-events": "none",
        }));
      }
      svg.append(gp);
    }
  }
  return svg;
}

/**
 * Só o ícone de um tipo de elemento, num <svg> com viewBox 0 0 48 48 (paleta,
 * listas, legendas). Usa as mesmas cores do desenho da planta.
 */
export function desenharIcone(svg, tipo, props = {}) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, a, papel] of icone({ tipo, props })) {
    svg.append(no(tag, a, papel === "t"
      ? { fill: "none", stroke: "currentColor", "stroke-width": "2.4px", "stroke-linecap": "round", "stroke-linejoin": "round" }
      : { fill: papel === "a" ? COR.argila : COR.areia, stroke: "none" }));
  }
  return svg;
}

function fmtM(cm) {
  return (Math.round(cm) / 100).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
}

export default desenharPlanta;
