// Simulação do cliente (docs/SIMULADOR-ORCAMENTO.md §6) na ficha do pedido de orçamento: resumo, artigos
// (nome do catálogo; os que já não existem ficam marcados), mão de obra, quadro elétrico, divisões e a planta
// só de leitura (§2.1, desenhada por vendor/planta-svg.js) com zoom e deslocamento.
// Também sugere os aparelhos a pedir ao servidor ("Converter em cliente e obra"): aparelhosDaSimulacao().
import { numero } from "../api.js";
import { h, euros, num, selo, dados, data } from "../ui.js";
// Importação em namespace: o módulo vem do simulador (web/simulador/planta-svg.js) e só se garante desenharPlanta.
import * as desenho from "../vendor/planta-svg.js";

export const PLANOS_SIM = { base: "Base", conforto: "Conforto", premium: "Premium" };
const TIPOS_CASA = {
  moradia: "Moradia", apartamento: "Apartamento", alojamento_local: "Alojamento local", outro: "Outro", servicos: "Serviços", industrial: "Industrial",
};
const FASES = { mono: "Monofásica", tri: "Trifásica" };
const TIPOS_CIRCUITO = { iluminacao: "Iluminação", tomadas: "Tomadas", maquina: "Máquina", misto: "Misto" };
// Quadro (web/simulador/quadro.js e regras.js RTIEBT): pacotes, proteções e respostas do cliente.
const RTIEBT = { C1: "iluminação", C2: "tomadas", C3: "placa/forno", C4: "máquinas de lavar/termoacumulador", C5: "tomadas zona húmida" };
const PACOTES = { essencial: "Essencial", recomendado: "Recomendado", completo: "Completo", personalizado: "Personalizado" };
const PROTECOES = {
  idr_wifi: "Diferenciais Wi-Fi com religação", descarregador: "Descarregador de sobretensões", rele_tensao: "Proteção de sobre/subtensão",
  afdd: "AFDD (detetor de arco)", medidor_geral: "Medidor geral Wi-Fi", geral_wifi: "Disjuntor geral Wi-Fi",
};
const SIM_NAO = { sim: "Sim", nao: "Não" };
const QUADRO_NOVO = { atual: "O atual serve", novo: "Quer quadro novo" };
const MODELOS = {
  termoacumulador: "Termoacumulador", ar_condicionado: "Ar condicionado", placa: "Placa", forno: "Forno", maquina_lavar: "Máquina de lavar",
  maquina_secar: "Máquina de secar", maquina_loica: "Máquina da loiça", frigorifico: "Frigorífico", televisao: "Televisão", bomba_calor: "Bomba de calor", carregador_ve: "Carregador VE",
  bomba: "Bomba (piscina/rega)",
  esquentador: "Esquentador elétrico instantâneo", radiador: "Aquecedor/radiador elétrico", hidromassagem: "Hidromassagem/jacuzzi",
  // Serviços e industrial (web/simulador/regras.js MODELOS).
  arca_frigorifica: "Arca/vitrine frigorífica", maquina_cafe: "Máquina de café", servidor: "Servidor/bastidor", compressor: "Compressor", soldadura: "Máquina de soldar",
  maquina_trifasica: "Máquina trifásica", portao_industrial: "Portão industrial", carregador_ve_22: "Carregador VE 22 kW",
  // Máquinas pequenas (circuito das tomadas).
  arca_congeladora: "Arca congeladora", micro_ondas: "Micro-ondas", exaustor: "Exaustor", cafeteira: "Cafeteira/chaleira", computador: "Computador", consola: "Consola",
  desumidificador: "Desumidificador", aquecedor_portatil: "Aquecedor portátil", box_router: "Box/router", repetidor_wifi: "Repetidor Wi-Fi", nas: "NAS",
  camara: "Câmara", portao: "Portão automático", rega: "Rega", iluminacao_jardim: "Iluminação exterior", aspirador_robo: "Aspirador robô", impressora: "Impressora",
  terminal_pagamento: "Terminal de pagamento", reclamo: "Reclamo luminoso", ferramentas: "Ferramentas elétricas", aspirador_industrial: "Aspirador industrial",
  carregador_baterias: "Carregador de baterias",
  air_fryer: "Air fryer", torradeira: "Torradeira", cafe_expresso: "Máquina de café expresso", campainha_video: "Campainha com vídeo",
  carregador_bicicleta: "Carregador de bicicleta/trotinete", toalheiro: "Aquecedor de toalhas",
  outro: "Outra máquina",
};
// Passo "A casa" e "Equipamentos" do simulador (web/simulador/regras.js EXTRAS_CASA, OBJETIVOS).
const EXTRAS_CASA = { jardim: "jardim", exterior: "exterior", garagem: "garagem", arrecadacao: "arrecadação", varanda: "varanda/terraço", kitnet: "kitnet", entrada: "entrada/hall", corredor: "corredor", escritorio: "escritório", lavandaria: "lavandaria", despensa: "despensa" };
const OBJETIVOS = {
  poupar: "Poupar energia", alarme: "Alarme e segurança", estores: "Estores automáticos", luzes: "Luzes pelo telemóvel",
  distancia: "Controlar à distância", clima: "Aquecimento / ar condicionado",
  horarios: "Horários de abertura", iluminacao_auto: "Iluminação automática", energia: "Controlo de energia", desligar: "Desligar tudo ao fechar",
};
// As telecomunicações (simulacao.telecom e os elementos telecom_* da planta) saíram do simulador: as
// simulações antigas que as trazem já não as mostram.
const ehTelecom = (e) => typeof e?.tipo === "string" && e.tipo.startsWith("telecom_");
// kVA (10,35) e horas (39,25) sempre com até 2 casas decimais (formatador próprio: não depende de ui.js num).
const fmt2 = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
const num2 = (v) => { const n = numero(v); return n === null ? "—" : fmt2.format(n); };

/**
 * Deslocação (simulacao.deslocacao, docs/SIMULADOR-ORCAMENTO.md §5.1): concelho reconhecido, distância
 * estimada por estrada e valor; null se a simulação não a traz (simulações antigas).
 */
function deslocacaoTxt(d) {
  if (!d || typeof d !== "object") return null;
  const t = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const km = numero(d.distancia_km), v = numero(d.valor_iva);
  const onde = t(d.concelho) ? `${t(d.concelho)}${t(d.distrito) ? ` (${t(d.distrito)})` : ""}` : null;
  if (d.estado === "estimada") return `${onde ?? "—"} · ${km !== null ? `${num(km)} km (estimativa)` : "distância —"} · ${euros(v)}`;
  if (d.estado === "fora_area") return `${onde ?? "—"}${km !== null ? ` · ${num(km)} km` : ""} — fora da área servida (contactar o cliente)`;
  const minimo = v !== null && v > 0 ? ` · mínimo ${euros(v)}` : "";
  if (d.estado === "visita") return `«${t(d.localidade) ?? ""}»: concelho não reconhecido — confirmar na visita${minimo}`;
  if (d.estado === "sem_localidade") return `Localidade não indicada — confirmar na visita${minimo}`;
  return null;
}

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
/**
 * Casas com 2 ou mais pisos (casa.pisos_detalhe): uma linha por piso, "Piso 1" → "3 quartos · 1 casa de banho ·
 * corredor · varanda/terraço" (vazio nas simulações antigas ou com um só piso).
 */
function pisosDetalhe(casa) {
  return arr(casa.pisos_detalhe).filter((f) => f && typeof f === "object").slice(0, 4).map((f, i) => {
    const p = numero(f.piso) ?? i;
    const q = numero(f.quartos), b = numero(f.casas_banho), s = numero(f.salas);
    const partes = [
      s ? plural(s, "sala", "salas") : null,
      q ? plural(q, "quarto", "quartos") : null,
      b ? plural(b, "casa de banho", "casas de banho") : null,
      ...Object.keys(EXTRAS_CASA).filter((k) => obj(f.extras)[k] === true).map((k) => EXTRAS_CASA[k]),
    ].filter(Boolean);
    return [nomePiso(p), partes.join(" · ") || "—"];
  });
}
/** Serviços e industrial: "120 m² · 5 espaços" (vazio nas casas). */
function areaTxt(casa) {
  const a = numero(casa.area_m2), e = numero(casa.espacos);
  return [a !== null ? `${num(a)} m²` : null, e !== null ? plural(e, "espaço", "espaços") : null].filter(Boolean).join(" · ");
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
// Pisos (0 = r/c; sem `piso` = 0): as mesmas regras do simulador (vendor/planta-svg.js pisoDe, nomePiso).
const pisoDe = (x) => (typeof desenho.pisoDe === "function" ? desenho.pisoDe(x) : 0);
const nomePiso = (p) => (p > 0 ? `Piso ${p}` : "Piso 0 (r/c)");

/** Planta pronta a desenhar: só as chaves de §2.1; fundo só data:image/jpeg|png (aceita o texto de §6 ou o objeto de §2.1). */
export function limparPlanta(p) {
  const pl = obj(p);
  const out = {
    escala_cm: numero(pl.escala_cm) ?? 50, largura_cm: numero(pl.largura_cm), altura_cm: numero(pl.altura_cm), fundo: null,
    divisoes: arr(pl.divisoes).slice(0, 40).filter((d) => d && typeof d === "object"),
    elementos: arr(pl.elementos).slice(0, 400).filter((e) => e && typeof e === "object" && !ehTelecom(e)),
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
 * Divisão de um elemento da planta (a mesma regra do simulador, web/simulador/regras.js divisaoDoElemento),
 * só entre as divisões do piso dele: a que contém o centro (a última desenhada ganha); portas, janelas e
 * sensores de porta/janela fora de todas contam na mais próxima a ≤ 30 cm (paredes exteriores). Usada
 * quando o elemento não traz `divisao`.
 */
export const TOLERANCIA_PORTA_CM = 30;
export function divisaoDoElemento(planta, e) {
  const x = n0(e?.x_cm), y = n0(e?.y_cm);
  const piso = pisoDe(e);
  const divs = arr(planta?.divisoes).filter((d) => d && typeof d === "object" && pisoDe(d) === piso);
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
  const instalacaoTxt = `${kva !== null ? `${num2(kva)} kVA` : "potência: não sabe"} · ${FASES[casa.fases] ?? "ligação: não sabe"}`;
  const quer = obj(sim.quer);
  // "Ar condicionado ×3 · Piso 0 (r/c): 1, Piso 1: 2": quantidade (se > 1) e, nas casas com pisos, onde fica.
  // `quer.pisos[m]` é {piso: n} (quantas em cada piso); nas simulações antigas, só o n.º do piso.
  const qtds = obj(quer.quantidades), pisosQ = obj(quer.pisos);
  const comPisos = (numero(casa.pisos) ?? 1) > 1;
  const maquinaTxt = (m) => {
    const q = numero(qtds[m]);
    const ps = pisosQ[m];
    let onde = "";
    if (comPisos && ps && typeof ps === "object") {
      const l = Object.keys(ps).map(Number).filter((p) => Number.isInteger(p) && numero(ps[p]) > 0).sort((a, b) => a - b);
      onde = l.length === 1 ? nomePiso(l[0]) : l.map((p) => `${nomePiso(p)}: ${num(numero(ps[p]))}`).join(", ");
    } else if (comPisos && numero(ps) !== null) onde = nomePiso(numero(ps));
    return `${MODELOS[m] ?? m}${q !== null && q > 1 ? ` ×${num(q)}` : ""}${onde ? ` · ${onde}` : ""}`;
  };
  const maquinasTxt = arr(quer.maquinas).filter((m) => typeof m === "string").map(maquinaTxt).join(", ");
  const pequenasTxt = arr(quer.pequenas).filter((m) => typeof m === "string").map(maquinaTxt).join(", ");
  const objetivosTxt = arr(quer.objetivos).filter((o) => typeof o === "string").map((o) => OBJETIVOS[o] ?? o).join(", ");
  const deslTxt = deslocacaoTxt(sim.deslocacao);

  const partes = [
    h("h3", { text: "Simulação do cliente" }),
    dados([
      ["Casa", casaTxt || "—"],
      ...(deslTxt ? [["Deslocação", deslTxt]] : []),
      ...(tipologiaTxt(casa) ? [["Tipologia", tipologiaTxt(casa)]] : []),
      ...pisosDetalhe(casa),
      ...(areaTxt(casa) ? [["Área e espaços", areaTxt(casa)]] : []),
      ...(sim.quer !== undefined ? [["Máquinas grandes", maquinasTxt || "Nenhuma"]] : []),
      ...(quer.pequenas !== undefined ? [["Máquinas pequenas", pequenasTxt || "Nenhuma"]] : []),
      ...(sim.quer !== undefined ? [["Objetivos", objetivosTxt || "Nenhum"]] : []),
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
  if (itens.length) partes.push(tabelaItens(itens, mo, catalogo, numero(obj(sim.deslocacao).valor_iva)));
  const circuitos = arr(obj(sim.quadro).circuitos).filter((c) => c && typeof c === "object");
  const planta = sim.planta && typeof sim.planta === "object" ? limparPlanta(sim.planta) : null;
  if (circuitos.length) partes.push(tabelaCircuitos(circuitos, planta));
  const blocoQ = blocoQuadro(obj(sim.quadro), numero(casa.potencia_contratada_kva));
  if (blocoQ) partes.push(blocoQ);
  // "Fora das divisões" (elementos fora de todas, nas simulações antigas) não é uma divisão: não aparece.
  const divs = arr(sim.divisoes).filter((d) => d && typeof d === "object" && d.nome !== FORA);
  if (divs.length) partes.push(tabelaDivisoes(divs));
  if (planta && (planta.divisoes.length || planta.elementos.length || planta.fundo)) partes.push(vistaPlanta(planta));
  partes.push(h("p", { class: "ajuda", text: "Estimativa feita pelo cliente no site (preços com IVA). O valor final é confirmado na visita técnica." }));
  return h("section", { class: "simulacao", id: "simulacao-cliente" }, ...partes);
}

/** Artigos, mão de obra e deslocação. `horas`: mais uma coluna com as horas de instalação do catálogo (relatório técnico). */
function tabelaItens(itens, mo, catalogo, desl = null, { horas = false } = {}) {
  let soma = 0, somaHoras = 0;
  const cols = horas ? 4 : 3;
  const linhas = itens.slice(0, 300).map((i) => {
    const sku = typeof i.sku === "string" ? i.sku : "";
    const art = catalogo && typeof catalogo === "object" ? catalogo[sku] : null;
    const qtd = numero(i.qtd ?? i.quantidade) ?? 1;
    const preco = numero(i.preco_iva ?? i.preco);
    const sub = preco === null ? null : Math.round(preco * qtd * 100) / 100;
    soma += sub ?? 0;
    const marca = !art ? selo("Já não está no catálogo", "grav-critica") : art.ativo === false ? selo("Inativo no catálogo", "aviso") : null;
    const hArt = numero(art?.horas_instalacao);
    const hLinha = hArt === null ? null : Math.round(hArt * qtd * 100) / 100;
    somaHoras += hLinha ?? 0;
    return h("tr", { dataset: { sku }, class: art ? "" : "fora-catalogo" },
      h("td", { "data-rotulo": "Artigo" }, h("div", {}, h("span", { class: "sim-artigo", text: art?.nome ?? (sku || "—") }), h("span", { class: "ajuda bloco-ajuda", text: sku }), marca)),
      h("td", { class: "num", "data-rotulo": "Qtd.", text: num(qtd) }),
      horas ? h("td", { class: "num", "data-rotulo": "Horas", text: hLinha === null ? "—" : `${num2(hLinha)} h` }) : null,
      h("td", { class: "num", "data-rotulo": "Preço", text: euros(preco) }),
      h("td", { class: "num", "data-rotulo": "Subtotal", text: euros(sub) }));
  });
  const moValor = numero(mo.valor_iva);
  const pe = [h("tr", {}, h("th", { scope: "row", colspan: String(cols), text: horas && somaHoras ? `Artigos (${num2(somaHoras)} h de instalação no catálogo)` : "Artigos" }), h("td", { class: "num", text: euros(soma) }))];
  if (moValor !== null || numero(mo.horas) !== null) {
    pe.push(h("tr", { class: "mao-obra" }, h("th", { scope: "row", colspan: String(cols), text: `Mão de obra${numero(mo.horas) !== null ? ` (${num2(mo.horas)} h)` : ""}` }), h("td", { class: "num", text: euros(moValor) })));
    if (desl !== null) pe.push(h("tr", { class: "deslocacao" }, h("th", { scope: "row", colspan: String(cols), text: "Deslocação" }), h("td", { class: "num", text: euros(desl) })));
    pe.push(h("tr", {}, h("th", { scope: "row", colspan: String(cols), text: "Total (sem intervalo)" }), h("td", { class: "num", text: euros(soma + (moValor ?? 0) + (desl ?? 0)) })));
  }
  const fora = linhas.filter((l) => l.classList.contains("fora-catalogo")).length;
  return h("div", { class: "sim-bloco" }, h("h4", { text: "Artigos" }),
    fora ? h("p", { class: "msg info", text: `${plural(fora, "artigo já não está", "artigos já não estão")} no catálogo: confirme o material antes da obra.` }) : null,
    h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "sim-itens" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Artigo" }), h("th", { scope: "col", class: "num", text: "Qtd." }), horas ? h("th", { scope: "col", class: "num", text: "Horas" }) : null, h("th", { scope: "col", class: "num", text: "Preço" }), h("th", { scope: "col", class: "num", text: "Subtotal" }))),
      h("tbody", {}, ...linhas), h("tfoot", {}, ...pe))));
}

/** Tabela dos circuitos. `divisoesSim`: com ela (relatório técnico), junta o piso de cada circuito nas casas com pisos. */
function tabelaCircuitos(circuitos, planta, divisoesSim = null) {
  const comPisos = divisoesSim !== null && [...arr(planta?.divisoes), ...divisoesSim].some((d) => pisoDe(d) > 0);
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
      h("td", { "data-rotulo": "Circuito" }, h("div", {}, h("span", { text: String(c.nome ?? TIPOS_CIRCUITO[c.tipo] ?? "—") }), h("span", { class: "ajuda bloco-ajuda", text: [
        RTIEBT[c.codigo] ? `${c.codigo} ${RTIEBT[c.codigo]}` : TIPOS_CIRCUITO[c.tipo] ?? c.tipo, divs,
        comPisos ? pisosDoCircuito(c, planta, divisoesSim).map(nomePiso).join(" + ") || null : null,
        numero(c.diferencial) !== null ? `diferencial ${num(numero(c.diferencial))}` : null, c.afdd === true ? "AFDD" : null,
      ].filter(Boolean).join(" · ") }))),
      h("td", { class: "num", "data-rotulo": "Disjuntor", text: amp ? `${amp} A${numero(c.seccao_mm2) !== null ? ` · ${num(numero(c.seccao_mm2))} mm²` : ""}` : "—" }),
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

/**
 * Proteções e tamanho do quadro (simulacao.quadro: pacote, protecoes, para_raios, quadro_novo, diferenciais,
 * modulos, potencia_sugerida_kva). Null numa simulação antiga sem estes campos.
 */
function blocoQuadro(q, contratada) {
  if (q.pacote === undefined && q.modulos === undefined && q.potencia_sugerida_kva === undefined) return null;
  const p = obj(q.protecoes);
  const ligadas = Object.keys(PROTECOES).filter((k) => p[k] === true).map((k) => PROTECOES[k]);
  const m = obj(q.modulos);
  const difs = arr(q.diferenciais).filter((d) => d && typeof d === "object");
  const kva = numero(q.potencia_sugerida_kva);
  const carga = numero(q.potencia_carga_w);
  const curta = kva !== null && contratada !== null && kva > contratada;
  const linhas = [
    ["Pacote", PACOTES[q.pacote] ?? (typeof q.pacote === "string" ? q.pacote : "—")],
    ["Proteções", ["Diferenciais 30 mA", ...ligadas].join(", ")],
    ["Pára-raios / linha aérea", SIM_NAO[q.para_raios] ?? "Não sabe"],
    ["Quadro", `${QUADRO_NOVO[q.quadro_novo] ?? "Não sabe"}${q.quadro_novo_no_preco === true ? " (quadro novo no preço)" : ""}`],
  ];
  if (numero(m.tamanho) !== null) {
    linhas.push(["Tamanho do quadro", `${(numero(m.quadros) ?? 1) > 1 ? `${num(numero(m.quadros))} × ` : ""}${num(numero(m.tamanho))} módulos (${num(numero(m.ocupados) ?? 0)} ocupados, ${num(numero(m.livres) ?? 0)} livres)${m.cabe === false && !((numero(m.quadros) ?? 1) > 1) ? " — não chega com 25 % livres" : ""}${q.quadro_novo === "atual" && numero(m.novos) !== null ? ` · ${num(numero(m.novos))} módulos novos no quadro atual` : ""}`]);
  }
  // Casas com pisos: quadro geral no r/c + um parcial por piso de cima (web/simulador/quadro.js numeroQuadros).
  if ((numero(m.parciais) ?? 0) > 0) linhas.push(["Quadros parciais", `Quadro geral (piso 0) + ${plural(numero(m.parciais), "quadro parcial", "quadros parciais")}${numero(m.tamanho_parcial) !== null ? ` de ${num(numero(m.tamanho_parcial))} módulos` : ""}`]);
  if (difs.length) linhas.push(["Grupos diferenciais", difs.slice(0, 20).map((d) => `${num(numero(d.n) ?? 0)}: ${arr(d.circuitos).filter((x) => numero(x) !== null).join(", ") || "—"}${d.carregador ? " (carregador)" : ""}`).join(" · ")]);
  if (kva !== null || carga !== null) {
    linhas.push(["Potência sugerida", h("span", {}, `${kva !== null ? `${num2(kva)} kVA` : "acima de 41,4 kVA"}${carga !== null ? ` (cargas ≈ ${num(carga)} W)` : ""} `, curta ? selo("Contratada curta", "aviso") : null)]);
  }
  const ml = arr(m.linhas).filter((l) => l && typeof l === "object").slice(0, 30);
  return h("div", { class: "sim-bloco", id: "sim-quadro" }, h("h4", { text: "Proteções e tamanho do quadro" }), dados(linhas),
    ml.length ? h("ul", { class: "ajuda" }, ...ml.map((l) => h("li", { text: `${num(numero(l.qtd) ?? 0)} × ${String(l.nome ?? "")} — ${num(numero(l.modulos) ?? 0)} módulos` }))) : null);
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
  // Com pisos: o piso junto ao nome ("Quarto 1 · Piso 1"), por ordem de piso.
  const comPisos = divs.some((d) => pisoDe(d) > 0);
  const lista = comPisos ? divs.map((d, i) => [d, i]).sort((a, b) => pisoDe(a[0]) - pisoDe(b[0]) || a[1] - b[1]).map(([d]) => d) : divs;
  return h("div", { class: "sim-bloco" }, h("h4", { text: `Divisões (${divs.length})` }),
    h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes", id: "sim-divisoes" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Divisão" }), ...colunas.map(([t]) => h("th", { scope: "col", class: "num", text: t })))),
      h("tbody", {}, ...lista.slice(0, 60).map((d) => h("tr", { dataset: { piso: String(pisoDe(d)) } }, h("th", { scope: "row", "data-rotulo": "Divisão", text: `${String(d.nome ?? "—")}${comPisos ? ` · ${nomePiso(pisoDe(d))}` : ""}` }),
        ...colunas.map(([t, f]) => h("td", { class: "num", "data-rotulo": t, text: String(f(d)) }))))))));
}

// ---------------------------------------------------------------- planta (zoom e deslocamento)

/**
 * Planta só de leitura. Com vários pisos (divisões/elementos com `piso`): separadores "Piso 0 (r/c)",
 * "Piso 1"… por cima; cada um mostra só esse piso, na mesma folha e escala (o zoom mantém-se).
 */
function vistaPlanta(planta) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "sim-planta");
  svg.setAttribute("role", "img");
  const pisos = typeof desenho.pisosDaPlanta === "function" ? desenho.pisosDaPlanta(planta) : [0];
  const variosPisos = pisos.length > 1;
  let pisoAtual = pisos[0];
  const rotular = () => {
    const doPiso = (l) => (variosPisos ? l.filter((x) => pisoDe(x) === pisoAtual) : l);
    svg.setAttribute("aria-label", `Planta da casa${variosPisos ? `, ${nomePiso(pisoAtual)}` : ""}: ${plural(doPiso(planta.divisoes).length, "divisão", "divisões")}, ${plural(doPiso(planta.elementos).length, "elemento", "elementos")}`);
  };
  const desenhar = () => desenho.desenharPlanta(svg, planta, { soLeitura: true, ...(variosPisos ? { piso: pisoAtual } : {}) });
  let base;
  try { base = desenhar(); } catch { return h("p", { class: "msg erro", text: "Não foi possível desenhar a planta." }); }
  rotular();
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
  // Separadores por piso (role tablist; as setas mudam de piso).
  let separadores = null;
  if (variosPisos) {
    const mostrarPiso = (p) => {
      pisoAtual = p;
      botoes.forEach((b, i) => { b.setAttribute("aria-selected", String(pisos[i] === p)); b.tabIndex = pisos[i] === p ? 0 : -1; });
      try { desenhar(); } catch { /* fica o desenho anterior */ }
      aplicar();
      rotular();
    };
    const botoes = pisos.map((p) => {
      const nd = planta.divisoes.filter((d) => pisoDe(d) === p).length;
      const b = h("button", { class: "btn sec pequeno planta-piso", type: "button", role: "tab", id: `planta-piso-${p}`, "aria-selected": String(p === pisoAtual), tabindex: p === pisoAtual ? "0" : "-1", text: `${nomePiso(p)} · ${plural(nd, "divisão", "divisões")}` });
      b.addEventListener("click", () => mostrarPiso(p));
      b.addEventListener("keydown", (ev) => {
        const i = pisos.indexOf(p);
        const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: pisos.length - 1 }[ev.key];
        if (j === undefined) return;
        ev.preventDefault();
        const q = pisos[(j + pisos.length) % pisos.length];
        mostrarPiso(q);
        botoes[pisos.indexOf(q)].focus();
      });
      return b;
    });
    separadores = h("div", { class: "planta-pisos", role: "tablist", "aria-label": "Pisos da planta" }, ...botoes);
  }
  return h("div", { class: "sim-bloco" },
    h("div", { class: "planta-topo" }, h("h4", { text: "Planta" }),
      h("div", { class: "planta-botoes", role: "group", "aria-label": "Zoom da planta" },
        botao("−", "Afastar", () => zoom(1 / 1.3), "planta-menos"), botao("+", "Aproximar", () => zoom(1.3), "planta-mais"),
        h("button", { class: "btn sec pequeno", type: "button", id: "planta-ajustar", text: "Ajustar", onclick: () => { vb = [...vb0]; aplicar(); } }))),
    separadores,
    h("div", { class: "planta-vista" }, svg),
    h("p", { class: "ajuda", text: "Arraste para deslocar; roda do rato ou dois dedos para o zoom. Passe por cima de um elemento para ver o que é." }),
    porTipo.size ? h("ul", { class: "planta-legenda" }, ...[...porTipo].map(([t, n]) => h("li", { text: `${t}: ${n}` }))) : null);
}

// ---------------------------------------------------------------- relatório técnico (eletricista)

/** Pisos (ordenados) das divisões de um circuito: pelo id/nome na planta ou, sem planta, no passo "Divisões". */
function pisosDoCircuito(c, planta, divisoesSim = []) {
  const s = new Set();
  const todas = [...arr(planta?.divisoes), ...arr(divisoesSim)].filter((d) => d && typeof d === "object");
  for (const ref of arr(c?.divisoes)) {
    const d = todas.find((x) => (x.id != null && x.id === ref) || x.nome === ref);
    if (d) s.add(pisoDe(d));
  }
  return [...s].sort((a, b) => a - b);
}

/** Área (m²) de uma divisão da planta (polígono ou retângulo). */
function areaDivisao(d) {
  const p = cantosDivisao(d);
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a) / 2 / 10000;
}
/** Divisão com paredes oblíquas (forma livre): `pontos` válidos que não são só os 4 cantos. */
const formaLivre = (d) => Array.isArray(d?.pontos) && d.pontos.length >= 3 && cantosDivisao(d).length !== 4;
const semNota = (t) => String(t).replace(/\s*\(orientativo — confirmamos na visita\)\s*$/i, "").trim();
const metros = (cm) => `${fmt2.format(Math.round(n0(cm)) / 100)} m`;
const m2 = (a) => `${fmt2.format(Math.round(a * 10) / 10)} m²`;

/** Máquinas da simulação com a potência: as dos circuitos (com o circuito) ou, sem quadro, as da planta. */
function maquinasDaSimulacao(sim, planta) {
  const out = [];
  for (const c of arr(obj(sim.quadro).circuitos).filter((x) => x && typeof x === "object")) {
    for (const m of maquinasDe(c).lista) out.push({ modelo: m.modelo, w: n0(m.potencia_w), circuito: c });
  }
  if (!out.length && planta) {
    for (const e of planta.elementos.filter((x) => x.tipo === "maquina")) out.push({ modelo: obj(e.props).modelo, w: n0(obj(e.props).potencia_w), elemento: e });
  }
  return out;
}
const ehCarregador = (m) => typeof m === "string" && m.startsWith("carregador_ve");

/**
 * "A VERIFICAR NA VISITA": o que o eletricista tem de confirmar, a partir das respostas "Não sei", dos avisos e
 * dos dados calculados (docs/SIMULADOR-ORCAMENTO.md §4, §4.1, §5.1, §6). [{tema, texto}], pela ordem da visita.
 * Simulações antigas (sem os campos novos) continuam a funcionar: o que não vem não se inventa.
 */
export function aVerificarNaVisita(sim, catalogo = {}, leitura = null) {
  if (!sim || typeof sim !== "object") return [];
  const s = obj(sim), casa = obj(s.casa), q = obj(s.quadro), m = obj(q.modulos);
  const planta = s.planta && typeof s.planta === "object" ? limparPlanta(s.planta) : null;
  const divisoesSim = arr(s.divisoes).filter((d) => d && typeof d === "object" && d.nome !== FORA);
  const out = [];
  const por = (tema, texto) => out.push({ tema, texto });
  const quadroNovo = q.pacote !== undefined || q.modulos !== undefined || q.potencia_sugerida_kva !== undefined;

  // Localidade e deslocação.
  const d = obj(s.deslocacao);
  if (d.estado === "visita") por("Localidade", `«${String(d.localidade ?? "")}» não foi reconhecida como concelho: confirmar a morada e o valor da deslocação (só está o mínimo).`);
  else if (d.estado === "sem_localidade") por("Localidade", "O cliente não indicou a localidade: confirmar a morada e o valor da deslocação.");
  else if (d.estado === "fora_area") por("Localidade", `${d.concelho ?? d.localidade ?? "A localidade"}${numero(d.distancia_km) !== null ? ` (${num(numero(d.distancia_km))} km estimados)` : ""} fica fora da área servida: decidir se se faz a obra e o preço da deslocação (não está no total).`);

  // Pára-raios / linha aérea (descarregador tipo 2).
  const desc = obj(q.protecoes).descarregador === true;
  if (q.para_raios === "sim") por("Pára-raios / linha aérea", `O cliente diz que SIM: o descarregador de sobretensões tipo 2 é obrigatório${desc ? " (está incluído)" : " (NÃO está incluído — acrescentar)"}; verificar a terra e a ligação equipotencial.`);
  else if (quadroNovo && q.para_raios !== "nao") por("Pára-raios / linha aérea", `O cliente NÃO SABE: verificar se há pára-raios ou alimentação por linha aérea; havendo, o descarregador tipo 2 é obrigatório${desc ? " (já está incluído)" : " (não está incluído)"}.`);

  // Quadro antigo / atual / novo.
  const antigo = q.quadro_antigo;
  const novos = numero(m.novos);
  if (antigo === "sim") por("Quadro elétrico", "O cliente diz que o quadro é ANTIGO (orçamentado quadro novo): confirmar o estado (isolamento, barramentos, terra), o local e se se aproveita alguma coisa.");
  else if (q.quadro_novo === "novo") por("Quadro elétrico", "Quadro novo no orçamento: confirmar o local, o espaço e a passagem dos circuitos para o quadro novo.");
  else if (q.quadro_novo === "atual") por("Quadro elétrico", `O cliente diz que o quadro atual serve: confirmar o estado e se há espaço para ${novos !== null ? `${num(novos)} módulos novos` : "os módulos novos"}${novos !== null && novos > 12 ? " (acima de 12: ampliação incluída)" : ""}.`);
  else if (quadroNovo) por("Quadro elétrico", `O cliente NÃO SABE se o quadro ${antigo === undefined ? "atual serve" : "é antigo"}: verificar o estado; ${q.quadro_novo_no_preco === false ? "o quadro novo não está no preço" : "o preço inclui quadro novo por precaução — sai se o atual servir"}${novos !== null ? ` (no atual seriam ${num(novos)} módulos novos)` : ""}.`);
  if ((numero(m.quadros) ?? 1) > 1 || m.cabe === false) por("Quadro elétrico", `Nem um quadro de 48 módulos deixa 25 % livres (${num(numero(m.ocupados) ?? 0)} módulos ocupados): ${plural(numero(m.quadros) ?? 1, "quadro", "quadros")} — confirmar o espaço e a organização.`);
  if (!quadroNovo && arr(q.circuitos).length) por("Quadro elétrico", "Simulação antiga, sem as perguntas do quadro (pára-raios, quadro atual, proteções): verificar tudo na visita.");

  // Potência contratada e ligação.
  const kva = numero(casa.potencia_contratada_kva), sug = numero(q.potencia_sugerida_kva), carga = numero(q.potencia_carga_w);
  const cargaTxt = carga !== null ? ` (cargas ≈ ${num(carga)} W)` : "";
  const temCasa = Object.keys(casa).length > 0;
  if (temCasa && kva === null) por("Potência contratada", `O cliente NÃO SABE: ver no contador ou na fatura${sug !== null ? `; sugerida ${num2(sug)} kVA${cargaTxt}` : ""}.`);
  else if (sug !== null && sug > kva) por("Potência contratada", `${num2(kva)} kVA pode ser CURTA: sugerida ${num2(sug)} kVA${cargaTxt} — falar com o cliente sobre o aumento de potência.`);
  if (quadroNovo && sug === null && carga !== null) por("Potência contratada", `Cargas ≈ ${num(carga)} W: acima de 41,4 kVA (contrato especial).`);
  if (temCasa && casa.fases == null) por("Ligação", "O cliente NÃO SABE se a ligação é monofásica ou trifásica: verificar no contador ou no quadro (muda os módulos e as máquinas trifásicas).");
  else if (casa.fases === "tri") por("Ligação", `Trifásica: confirmar o equilíbrio das fases; geral, diferenciais, descarregador, relé e medidor são tetrapolares (o dobro dos módulos); ${q.quadro_novo_no_preco === true ? "as máquinas trifásicas levam um disjuntor tetrapolar (4P) no quadro novo" : "as máquinas trifásicas ficam na proteção trifásica que já existe"}, sem disjuntor inteligente.`);
  if (casa.fases !== "tri" && sug !== null && sug > 13.8) por("Ligação", `A potência sugerida (${num2(sug)} kVA) pede ligação trifásica.`);

  // Máquinas ≥ 2000 W e carregador do carro.
  const maqs = maquinasDaSimulacao(s, planta);
  for (const x of maqs.filter((y) => y.w >= CARGA_PERIGOSA_W && !ehCarregador(y.modelo))) {
    const c = x.circuito;
    const onde = c
      ? `circuito ${c.n ?? "?"}${c.codigo ? ` (${c.codigo})` : ""}: ${numero(c.amperes) !== null ? `${num(numero(c.amperes))} A` : "disjuntor —"}${numero(c.seccao_mm2) !== null ? `, cabo ${num(numero(c.seccao_mm2))} mm²` : ""}${numero(c.diferencial) !== null ? `, diferencial ${num(numero(c.diferencial))}` : ""}${c.inteligente ? ", inteligente (carga perigosa na app)" : ""}`
      : "sem circuito na simulação";
    const partilhado = c && (maquinasDe(c).lista.length > 1 || n0(obj(c.itens).luzes) + n0(obj(c.itens).tomadas) > 0);
    por("Máquina ≥ 2000 W", `${MODELOS[x.modelo] ?? x.modelo ?? "Máquina"} ${num(x.w)} W — ${onde}. Confirmar circuito próprio, secção do cabo e disjuntor${partilhado ? " (NÃO está sozinha no circuito)" : ""}.`);
  }
  const carregadores = maqs.filter((y) => ehCarregador(y.modelo));
  if (carregadores.length || arr(obj(s.quer).maquinas).some(ehCarregador)) {
    const x = carregadores[0], c = x?.circuito;
    const difProprio = arr(q.diferenciais).some((g) => g && g.carregador);
    por("Carregador do carro", `${x ? `${MODELOS[x.modelo] ?? "Carregador"} ${num(x.w)} W` : "Pedido pelo cliente"}${c ? ` — circuito ${c.n ?? "?"}${numero(c.amperes) !== null ? ` de ${num(numero(c.amperes))} A` : ""}${numero(c.seccao_mm2) !== null ? `, ${num(numero(c.seccao_mm2))} mm²` : ""}` : ""}: circuito próprio (40 A) e diferencial próprio tipo A ou B (RTIEBT secção 722)${difProprio ? " — previsto" : " — NÃO previsto"}; ver se o carregador já o traz, a distância ao quadro e o local.`);
  }

  // Pisos com quadro parcial e circuitos que atravessam pisos.
  const parciais = numero(m.parciais) ?? 0;
  if (parciais > 0) {
    const pisos = planta && typeof desenho.pisosDaPlanta === "function" ? desenho.pisosDaPlanta(planta) : [...new Set(divisoesSim.map(pisoDe))].sort((a, b) => a - b);
    const cima = pisos.filter((p) => p > 0);
    por("Quadros parciais", `${plural(parciais, "quadro parcial", "quadros parciais")}${numero(m.tamanho_parcial) !== null ? ` de ${num(numero(m.tamanho_parcial))} módulos` : ""}${cima.length ? ` (${cima.map(nomePiso).join(", ")})` : ""}: confirmar o local em cada piso, o cabo de alimentação desde o quadro geral e o corte do piso.`);
    for (const c of arr(q.circuitos).filter((x) => x && typeof x === "object")) {
      const ps = pisosDoCircuito(c, planta, divisoesSim);
      if (ps.length > 1) por("Quadros parciais", `Circuito ${c.n ?? "?"} (${String(c.nome ?? TIPOS_CIRCUITO[c.tipo] ?? "—")}) serve ${ps.map(nomePiso).join(" e ")}: decidir em que quadro fica (ou dividi-lo).`);
    }
  }

  // Planta: forma livre, divisões sem aparelhos, elementos fora.
  if (planta && planta.divisoes.length) {
    const comPisos = planta.divisoes.some((x) => pisoDe(x) > 0);
    const livres = planta.divisoes.filter(formaLivre);
    if (livres.length) por("Planta", `Divisões de forma livre (paredes oblíquas): ${livres.map((x) => `${String(x.nome ?? x.id)} (${m2(areaDivisao(x))}${comPisos ? `, ${nomePiso(pisoDe(x))}` : ""})`).join(", ")} — medir no local e confirmar a posição dos aparelhos.`);
    const divDe = (e) => (e.divisao != null && e.divisao !== "" ? e.divisao : divisaoDoElemento(planta, e));
    const vazias = planta.divisoes.filter((x) => !planta.elementos.some((e) => divDe(e) === x.id));
    if (vazias.length) por("Planta", `Sem nenhum aparelho desenhado: ${vazias.map((x) => String(x.nome ?? x.id)).join(", ")} — confirmar com o cliente.`);
    const fora = planta.elementos.filter((e) => e.tipo !== "quadro" && divDe(e) == null);
    if (fora.length) por("Planta", `${plural(fora.length, "elemento fora das divisões", "elementos fora das divisões")} (${[...new Set(fora.map((e) => NOMES_ELEMENTOS[e.tipo] ?? String(e.tipo)))].join(", ")}): confirmar onde ficam.`);
  } else if (!planta && divisoesSim.length) por("Planta", "O cliente não desenhou a planta: a posição dos aparelhos define-se na visita.");

  // Material que já não está no catálogo.
  const cat = obj(catalogo);
  if (Object.keys(cat).length) {
    const semCat = [...new Set(arr(s.itens).filter((i) => i && typeof i.sku === "string" && !cat[i.sku]).map((i) => i.sku))];
    if (semCat.length) por("Material", `${semCat.join(", ")} já não ${semCat.length === 1 ? "está" : "estão"} no catálogo: confirmar o material.`);
  }

  // Leitura automática da foto do quadro (modelo de visão; só uma pista — confirmar tudo na visita).
  for (const texto of verificarLeitura(leitura, numero(m.novos))) por("Foto do quadro", texto);

  // Avisos elétricos da simulação (os que o cliente viu), sem o "(orientativo — confirmamos na visita)".
  for (const a of arr(s.avisos).filter((x) => typeof x === "string" && x.trim()).slice(0, 50)) por("Aviso da simulação", semNota(a));
  return out;
}

// ---------------------------------------------------------------- fotos e leitura automática do quadro

const ESTADOS_QUADRO_FOTO = { bom: "bom", razoavel: "razoável", antigo: "antigo", mau: "mau", nao_se_ve: "não se vê" };
const CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" };

/** O que a leitura automática da foto do quadro manda confirmar na visita (textos). */
function verificarLeitura(leitura, novos = null) {
  const l = obj(leitura);
  if (l.estado === "erro") return ["A leitura automática da foto do quadro falhou: ver a foto antes da visita."];
  if (l.estado === "desligada") return ["Ver a foto do quadro enviada pelo cliente (leitura automática desligada)."];
  if (l.estado !== "feita" || !l.leitura || typeof l.leitura !== "object") return [];
  const x = obj(l.leitura);
  if (x.e_quadro_eletrico === false) return ["A foto enviada não parece ser do quadro elétrico (leitura automática): pedir outra ao cliente ou ver na visita."];
  const out = [];
  const pre = "Leitura automática";
  if (x.estado_aparente === "antigo" || x.estado_aparente === "mau") out.push(`${pre}: quadro com ar ${ESTADOS_QUADRO_FOTO[x.estado_aparente]} — confirmar o estado (isolamento, barramentos, terra) e se é para substituir.`);
  if (x.fusiveis === true) out.push(`${pre}: tem FUSÍVEIS em vez de disjuntores — confirmar e prever a substituição.`);
  if (x.sinais_aquecimento === true) out.push(`${pre}: possíveis SINAIS DE AQUECIMENTO (queimado/derretido) — verificar ligações e cabos com cuidado.`);
  if (Array.isArray(x.diferenciais) && !x.diferenciais.length) out.push(`${pre}: não se vê nenhum diferencial — confirmar a proteção diferencial (obrigatória).`);
  const livres = numero(x.modulos_livres_estimados);
  if (livres !== null && novos !== null && livres < novos) out.push(`${pre}: ~${num(livres)} módulos livres para ${num(novos)} módulos novos — confirmar o espaço (ampliação ou quadro novo).`);
  if (x.confianca === "baixa") out.push(`${pre} com confiança BAIXA (foto pouco nítida?): não confiar nos números.`);
  const g = obj(x.disjuntor_geral);
  const resumo = [
    numero(x.disjuntores_total) !== null ? plural(numero(x.disjuntores_total), "disjuntor", "disjuntores") : null,
    Array.isArray(x.diferenciais) ? plural(x.diferenciais.reduce((t, d) => t + n0(obj(d).quantidade), 0), "diferencial", "diferenciais") : null,
    g.visivel ? `geral${numero(g.amperes) !== null ? ` ${num(numero(g.amperes))} A` : ""}` : "geral não visível",
  ].filter(Boolean).join(", ");
  out.push(`Confirmar a leitura automática da foto do quadro (${resumo}).`);
  return out;
}

export const nomeTipoFoto = (t) => (t === "quadro" ? "Quadro elétrico" : NOMES_ELEMENTOS[t] ?? (typeof t === "string" && t ? t.replace(/_/g, " ") : "Foto"));
/** Endereço da foto no painel (reconstruído a partir dos ids, nunca copiado da resposta). */
export const urlFoto = (orcamentoId, fotoId) => `/painel/api/orcamentos/${encodeURIComponent(String(orcamentoId))}/fotos/${encodeURIComponent(String(fotoId))}`;

/** Uma miniatura (abre a foto inteira noutro separador). `extra`: nó a juntar à legenda (ex. botão Apagar). */
function figuraFoto(orcamentoId, f, titulo, extra = null) {
  const url = urlFoto(orcamentoId, f.id);
  const legenda = typeof f.legenda === "string" && f.legenda.trim() ? f.legenda.trim() : null;
  return h("figure", { class: "foto-cliente", dataset: { chave: String(f.chave ?? "") } },
    h("a", { href: url, target: "_blank", rel: "noopener", title: "Abrir a foto inteira" },
      h("img", { src: url, alt: [titulo, legenda].filter(Boolean).join(" — "), loading: "lazy", decoding: "async" })),
    h("figcaption", {}, h("strong", { text: titulo }), legenda ? h("span", { class: "ajuda bloco-ajuda", text: legenda }) : null, extra));
}

/**
 * Galeria das fotos do pedido: "Quadro elétrico" primeiro e depois por piso e divisão (tipo na legenda).
 * `aoApagar(foto, botao)`: mostra "Apagar" (ficha do pedido); no relatório não.
 */
export function galeriaFotos(orcamentoId, fotos, { aoApagar } = {}) {
  const lista = arr(fotos).filter((f) => f && typeof f === "object" && typeof f.id === "string");
  const botao = (f) => (aoApagar ? botaoApagarFoto(f, aoApagar) : null);
  const quadro = lista.filter((f) => f.chave === "quadro");
  const outras = lista.filter((f) => f.chave !== "quadro");
  const grupos = new Map();
  for (const f of outras) {
    const piso = Number.isInteger(f.piso) ? f.piso : null;
    const div = String(f.divisao_nome ?? f.divisao ?? "Sem divisão");
    const k = `${piso ?? ""}|${div}`;
    if (!grupos.has(k)) grupos.set(k, { piso, div, fotos: [] });
    grupos.get(k).fotos.push(f);
  }
  const variosPisos = new Set([...grupos.values()].map((g) => g.piso ?? 0)).size > 1;
  const ordenados = [...grupos.values()].sort((a, b) => (a.piso ?? 0) - (b.piso ?? 0) || a.div.localeCompare(b.div, "pt"));
  return h("div", { class: "galeria-fotos" },
    quadro.length ? h("div", { class: "fotos-grupo" }, h("h4", { text: "Quadro elétrico" }),
      h("div", { class: "fotos-grelha" }, ...quadro.map((f) => figuraFoto(orcamentoId, f, "Quadro elétrico", botao(f))))) : null,
    ...ordenados.map((g) => h("div", { class: "fotos-grupo" },
      h("h4", { text: `${g.div}${variosPisos || (g.piso ?? 0) > 0 ? ` · ${nomePiso(g.piso ?? 0)}` : ""}` }),
      h("div", { class: "fotos-grelha" }, ...g.fotos.map((f) => figuraFoto(orcamentoId, f, nomeTipoFoto(f.tipo), botao(f)))))));
}

/** "Apagar" em dois toques (como o botaoConfirmar do painel). */
function botaoApagarFoto(f, aoApagar) {
  const b = h("button", { class: "btn sec pequeno foto-apagar nao-imprimir", type: "button", text: "Apagar" });
  let armado = false, t;
  b.addEventListener("click", async () => {
    if (!armado) {
      armado = true; b.textContent = "Apagar esta foto?"; b.classList.add("armado");
      t = setTimeout(() => { armado = false; b.textContent = "Apagar"; b.classList.remove("armado"); }, 5000);
      return;
    }
    clearTimeout(t); armado = false; b.disabled = true;
    await aoApagar(f, b);
  });
  return b;
}

/** Estado da leitura automática da foto do quadro e, se feita, o que se leu (relatório técnico). */
export function blocoLeituraQuadro(leitura, orcamentoId = null, fotoQuadro = null) {
  const l = obj(leitura);
  const aviso = (texto) => h("p", { class: "ajuda leitura-estado", text: texto });
  const foto = fotoQuadro && orcamentoId != null ? figuraFoto(orcamentoId, fotoQuadro, "Foto do quadro") : null;
  const com = (...filhos) => h("div", { class: "leitura-quadro" }, foto, h("div", {}, ...filhos));
  if (l.estado === "desligada") return com(aviso("Leitura automática desligada (o servidor não tem a chave ANTHROPIC_API_KEY). Ver a foto do quadro."));
  if (l.estado === "pendente") return com(aviso("A ler a foto do quadro… Atualize a página dentro de alguns segundos."));
  if (l.estado === "erro") return com(aviso(`A leitura automática falhou${l.erro ? ` (${String(l.erro)})` : ""}. Ver a foto do quadro.`));
  if (l.estado !== "feita") return foto ? com() : null;
  const x = obj(l.leitura);
  const grupos = (lista, fmt) => (arr(lista).length ? arr(lista).map((d) => `${num(n0(obj(d).quantidade))} × ${fmt(obj(d))}`).join(", ") : "nenhum visível");
  const ou = (v, suf) => (numero(v) !== null ? `${num(numero(v))}${suf}` : "?");
  const g = obj(x.disjuntor_geral);
  const lin = x.e_quadro_eletrico === false
    ? [["Foto", "Não parece ser um quadro elétrico."], ["Notas", String(x.notas || "—")]]
    : [
      ["Disjuntores", `${numero(x.disjuntores_total) !== null ? num(numero(x.disjuntores_total)) : "?"}${arr(x.disjuntores).length ? ` (${grupos(x.disjuntores, (d) => ou(d.amperes, " A"))})` : ""}`],
      ["Diferenciais", grupos(x.diferenciais, (d) => `${ou(d.sensibilidade_ma, " mA")} / ${ou(d.amperes, " A")}`)],
      ["Geral", g.visivel ? [typeof g.tipo === "string" ? g.tipo : null, numero(g.amperes) !== null ? `${num(numero(g.amperes))} A` : null].filter(Boolean).join(", ") || "visível" : "não visível"],
      ["Módulos livres (estimativa)", numero(x.modulos_livres_estimados) !== null ? num(numero(x.modulos_livres_estimados)) : "?"],
      ["Marcas", arr(x.marcas).filter((m) => typeof m === "string").join(", ") || "—"],
      ["Estado aparente", [ESTADOS_QUADRO_FOTO[x.estado_aparente] ?? "—", x.fusiveis === true ? "com fusíveis" : null, x.sinais_aquecimento === true ? "sinais de aquecimento" : null].filter(Boolean).join(" · ")],
      ["Notas", String(x.notas || "—")],
    ];
  lin.push(["Confiança", `${CONFIANCA[x.confianca] ?? "—"}${l.modelo ? ` · ${String(l.modelo)}` : ""}${l.quando ? `, ${data(l.quando)}` : ""}`]);
  return com(dados(lin), l.foto_apagada ? aviso("A foto do quadro foi apagada depois desta leitura.") : null);
}

/** "3 luzes (1 regulável) · 2 interruptores (1 + 2 bot.) · …" dos elementos da planta de uma divisão. */
function aparelhosTxt(els) {
  const de = (t) => els.filter((e) => e.tipo === t);
  const p = (e) => obj(e.props);
  const partes = [];
  const luzes = de("luz");
  if (luzes.length) { const r = luzes.filter((e) => p(e).brilho).length; partes.push(`${plural(luzes.length, "luz", "luzes")}${r ? ` (${num(r)} ${r === 1 ? "regulável" : "reguláveis"})` : ""}`); }
  const ints = de("interruptor");
  if (ints.length) partes.push(`${plural(ints.length, "interruptor", "interruptores")} (${ints.map((e) => Math.min(4, Math.max(1, numero(p(e).botoes) ?? 1))).join(" + ")} bot.)`);
  const toms = de("tomada");
  if (toms.length) { const d = toms.filter((e) => p(e).dupla).length; partes.push(`${plural(toms.length, "tomada", "tomadas")}${d ? ` (${num(d)} ${d === 1 ? "dupla" : "duplas"})` : ""}`); }
  const jan = de("janela");
  if (jan.length) {
    const mot = jan.filter((e) => p(e).estore && p(e).motorizado).length, man = jan.filter((e) => p(e).estore && !p(e).motorizado).length;
    const est = [mot ? `${num(mot)} com estore motorizado` : null, man ? `${num(man)} com estore manual` : null].filter(Boolean).join(", ");
    partes.push(`${plural(jan.length, "janela", "janelas")}${est ? ` (${est})` : ""}`);
  }
  const portas = de("porta");
  if (portas.length) partes.push(`${plural(portas.length, "porta", "portas")}${portas.some((e) => p(e).entrada) ? " (da rua)" : ""}`);
  const sp = de("sensor_porta").length, sm = de("sensor_movimento").length;
  if (sp) partes.push(plural(sp, "sensor de porta/janela", "sensores de porta/janela"));
  if (sm) partes.push(plural(sm, "sensor de movimento", "sensores de movimento"));
  if (de("quadro").length) partes.push("quadro elétrico");
  for (const e of de("maquina")) partes.push(`${MODELOS[p(e).modelo] ?? "Máquina"} ${num(n0(p(e).potencia_w))} W`);
  const alturas = els.filter((e) => e.altura_cm !== null && e.altura_cm !== "" && numero(e.altura_cm) !== null)
    .map((e) => `${typeof e.nome === "string" && e.nome.trim() ? e.nome.trim() : (NOMES_ELEMENTOS[e.tipo] ?? String(e.tipo))} a ${metros(e.altura_cm)}`);
  if (alturas.length) partes.push(`alturas dadas pelo cliente: ${alturas.join(", ")}`);
  return partes.join(" · ") || "—";
}

/** Divisões e aparelhos por piso (da planta): uma tabela por piso, com o equipamento inteligente do passo "Divisões". */
function divisoesPorPiso(planta, divisoesSim) {
  const pisos = typeof desenho.pisosDaPlanta === "function" ? desenho.pisosDaPlanta(planta) : [0];
  const divDe = (e) => (e.divisao != null && e.divisao !== "" ? e.divisao : divisaoDoElemento(planta, e));
  const inteligente = (d) => {
    const x = divisoesSim.find((y) => y.nome === d.nome && pisoDe(y) === pisoDe(d));
    if (!x) return "—";
    const est = contar(x.estores), sem = contar(x.estores_sem_motor), lr = contar(x.luzes_regulaveis ?? x.luzes_brilho), sp = contar(x.sensores_porta), sm = contar(x.sensores_movimento), ti = contar(x.tomadas_inteligentes);
    const ints = arr(x.interruptores);
    return [
      ints.length ? `${plural(ints.length, "interruptor", "interruptores")} (${ints.map((i) => numero(obj(i).botoes ?? i) ?? 1).join(" + ")} bot.)` : null,
      est ? plural(est, "estore motorizado", "estores motorizados") : null, sem ? `${num(sem)} sem motor` : null,
      lr ? plural(lr, "luz regulável", "luzes reguláveis") : null, sp ? plural(sp, "sensor de porta", "sensores de porta") : null,
      sm ? plural(sm, "sensor de movimento", "sensores de movimento") : null, ti ? plural(ti, "tomada inteligente", "tomadas inteligentes") : null,
    ].filter(Boolean).join(" · ") || "—";
  };
  return pisos.map((p) => {
    const linhas = planta.divisoes.filter((d) => pisoDe(d) === p).map((d) => h("tr", {},
      h("th", { scope: "row", "data-rotulo": "Divisão", text: String(d.nome ?? d.id ?? "—") }),
      h("td", { class: "num", "data-rotulo": "Área" }, h("div", {}, m2(areaDivisao(d)), h("span", { class: "ajuda bloco-ajuda", text: formaLivre(d) ? "forma livre" : `${metros(d.largura_cm)} × ${metros(d.altura_cm)}` }))),
      h("td", { "data-rotulo": "Na planta", text: aparelhosTxt(planta.elementos.filter((e) => divDe(e) === d.id)) }),
      h("td", { "data-rotulo": "Inteligente", text: inteligente(d) })));
    return h("div", { class: "sim-bloco rel-piso", dataset: { piso: String(p) } }, h("h4", { text: pisos.length > 1 ? nomePiso(p) : "Divisões" }),
      linhas.length
        ? h("div", { class: "tabela-rolar" }, h("table", { class: "tabela tabela-cartoes rel-divisoes" },
          h("thead", {}, h("tr", {}, ...["Divisão", "Área", "Na planta", "Inteligente (passo Divisões)"].map((t, i) => h("th", { scope: "col", class: i === 1 ? "num" : "", text: t })))),
          h("tbody", {}, ...linhas)))
        : h("p", { class: "ajuda", text: "Sem divisões desenhadas neste piso." }));
  });
}

/** Máquinas por piso: as da planta (com potência e divisão) ou, sem planta, as do passo "O que quer" (quer.pisos). */
function maquinasPorPiso(sim, planta) {
  const quer = obj(sim.quer), qtds = obj(quer.quantidades), pisosQ = obj(quer.pisos);
  const porPiso = new Map();
  const juntar = (p, t) => { if (!porPiso.has(p)) porPiso.set(p, []); porPiso.get(p).push(t); };
  const naPlanta = planta ? planta.elementos.filter((e) => e.tipo === "maquina") : [];
  if (naPlanta.length) {
    for (const e of naPlanta) {
      const div = nomeDivisao(planta, e.divisao != null && e.divisao !== "" ? e.divisao : divisaoDoElemento(planta, e));
      juntar(pisoDe(e), `${MODELOS[obj(e.props).modelo] ?? "Máquina"} ${num(n0(obj(e.props).potencia_w))} W${div ? ` (${div})` : ""}`);
    }
  } else {
    for (const m of [...arr(quer.maquinas), ...arr(quer.pequenas)].filter((x) => typeof x === "string")) {
      const ps = pisosQ[m];
      const q = numero(qtds[m]) ?? 1;
      if (ps && typeof ps === "object") {
        for (const k of Object.keys(ps)) { const n = numero(ps[k]); if (n > 0) juntar(pisoDe({ piso: k }), `${MODELOS[m] ?? m}${n > 1 ? ` ×${num(n)}` : ""}`); }
      } else juntar(pisoDe({ piso: ps }), `${MODELOS[m] ?? m}${q > 1 ? ` ×${num(q)}` : ""}`);
    }
  }
  const pisos = [...porPiso.keys()].sort((a, b) => a - b);
  if (!pisos.length) return null;
  const variosPisos = pisos.length > 1 || pisos[0] > 0;
  return h("div", { class: "sim-bloco" },
    dados(pisos.map((p) => [variosPisos ? nomePiso(p) : "Casa", porPiso.get(p).join(", ")])),
    naPlanta.length ? null : h("p", { class: "ajuda", text: "Do passo \"Equipamentos\" (a planta não tem máquinas desenhadas)." }));
}

/** Planta no relatório: no ecrã a vista com zoom e separadores; na impressão, um desenho por piso. */
function plantaRelatorio(planta) {
  const pisos = typeof desenho.pisosDaPlanta === "function" ? desenho.pisosDaPlanta(planta) : [0];
  const impressao = pisos.map((p) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    try { desenho.desenharPlanta(svg, planta, { soLeitura: true, ...(pisos.length > 1 ? { piso: p } : {}) }); } catch { return null; }
    svg.setAttribute("aria-label", `Planta${pisos.length > 1 ? `, ${nomePiso(p)}` : ""}`);
    return h("figure", { class: "rel-planta-piso" }, pisos.length > 1 ? h("figcaption", { text: nomePiso(p) }) : null, svg);
  });
  return [h("div", { class: "planta-interativa" }, vistaPlanta(planta)), h("div", { class: "so-impressao" }, ...impressao)];
}

/**
 * Relatório técnico para o eletricista (vista para imprimir / guardar PDF pelo browser): cabeçalho com o cliente,
 * "A VERIFICAR NA VISITA" e tudo o que a simulação calculou (o cliente só viu o preço e o plano).
 * `pedido`: {id, nome, telefone, email, localidade, criado, data_visita}.
 */
export function relatorioTecnico(pedido, sim, catalogo = {}, { fotos = [], leitura = null } = {}) {
  const o = obj(pedido), s = obj(sim), casa = obj(s.casa), q = obj(s.quadro), mo = obj(s.mao_obra);
  const planta = s.planta && typeof s.planta === "object" ? limparPlanta(s.planta) : null;
  const temPlanta = !!planta && !!(planta.divisoes.length || planta.elementos.length || planta.fundo);
  const divisoesSim = arr(s.divisoes).filter((d) => d && typeof d === "object" && d.nome !== FORA);
  const circuitos = arr(q.circuitos).filter((c) => c && typeof c === "object");
  const itens = arr(s.itens).filter((i) => i && typeof i === "object");
  const t = (v) => (v == null || v === "" ? "—" : String(v));
  const seccao = (titulo, ...filhos) => h("section", { class: "rel-seccao" }, h("h3", { text: titulo }), ...filhos);

  const verificar = aVerificarNaVisita(s, catalogo, leitura);
  const listaFotos = arr(fotos).filter((f) => f && typeof f === "object" && typeof f.id === "string");
  const fotoQuadro = listaFotos.find((f) => f.chave === "quadro") ?? null;
  const blocoVerificar = h("section", { class: "rel-verificar", id: "rel-verificar", "aria-labelledby": "rel-verificar-titulo" },
    h("h3", { id: "rel-verificar-titulo", text: `A VERIFICAR NA VISITA (${verificar.length})` }),
    verificar.length
      ? h("ul", {}, ...verificar.map((v) => h("li", {}, h("strong", { text: `${v.tema}: ` }), v.texto)))
      : h("p", { text: "Nada assinalado pela simulação. Confirmar na mesma o quadro, a terra e a potência contratada." }));

  const kva = numero(casa.potencia_contratada_kva), sug = numero(q.potencia_sugerida_kva), carga = numero(q.potencia_carga_w);
  let estimativa = "—";
  if (s.total && typeof s.total === "object") estimativa = `${euros(s.total.min)} – ${euros(s.total.max)}`;
  else if (numero(s.total) !== null) estimativa = euros(s.total);
  const objetivos = arr(obj(s.quer).objetivos).filter((x) => typeof x === "string").map((x) => OBJETIVOS[x] ?? x).join(", ");

  const partes = [
    h("header", { class: "rel-cabecalho" },
      h("p", { class: "rel-marca", text: "Domus Energia · Relatório técnico para a visita" }),
      h("h2", { id: "rel-titulo", text: `${t(o.nome)} — pedido n.º ${t(o.id)}` }),
      dados([
        ["Cliente", t(o.nome)],
        ["Contacto", [o.telefone, o.email].filter(Boolean).join(" · ") || "—"],
        ["Localidade", t(o.localidade ?? casa.localidade)],
        ["Pedido recebido", data(o.criado)],
        ...(o.data_visita ? [["Visita", data(o.data_visita)]] : []),
        ["Relatório de", data(new Date().toISOString())],
      ])),
    blocoVerificar,
    seccao("Casa e pisos", dados([
      ["Imóvel", [TIPOS_CASA[casa.tipo] ?? casa.tipo, numero(casa.divisoes) !== null ? plural(numero(casa.divisoes), "divisão", "divisões") : null].filter(Boolean).join(" · ") || "—"],
      ...(tipologiaTxt(casa) ? [["Tipologia", tipologiaTxt(casa)]] : []),
      ...pisosDetalhe(casa),
      ...(areaTxt(casa) ? [["Área e espaços", areaTxt(casa)]] : []),
      ["Potência contratada", kva !== null ? `${num2(kva)} kVA` : "NÃO SABE"],
      ["Ligação", FASES[casa.fases] ?? "NÃO SABE"],
      ["Potência sugerida", h("span", {}, `${sug !== null ? `${num2(sug)} kVA` : q.pacote !== undefined ? "acima de 41,4 kVA" : "—"}${carga !== null ? ` (cargas ≈ ${num(carga)} W, com simultaneidade)` : ""} `, sug !== null && kva !== null && sug > kva ? selo("Contratada curta", "aviso") : null)],
      ...(objetivos ? [["Objetivos do cliente", objetivos]] : []),
      ["Deslocação", deslocacaoTxt(s.deslocacao) ?? "—"],
    ])),
  ];
  const maqs = maquinasPorPiso(s, planta);
  if (maqs) partes.push(seccao("Máquinas por piso", maqs));
  const divs = temPlanta && planta.divisoes.length ? divisoesPorPiso(planta, divisoesSim) : divisoesSim.length ? [tabelaDivisoes(divisoesSim)] : [];
  if (divs.length) partes.push(seccao("Divisões e aparelhos por piso", ...divs));
  if (temPlanta) partes.push(seccao("Planta", ...plantaRelatorio(planta)));
  const quadro = [];
  if (circuitos.length) quadro.push(tabelaCircuitos(circuitos, planta, divisoesSim));
  const blocoQ = blocoQuadro(q, kva);
  if (blocoQ) quadro.push(blocoQ);
  if (typeof q.disjuntor === "string") quadro.push(h("p", { class: "ajuda", text: `Disjuntor inteligente escolhido: ${q.disjuntor}.` }));
  if (quadro.length) partes.push(seccao("Quadro elétrico: circuitos, proteções e módulos", ...quadro));
  const estadoLeitura = obj(leitura).estado;
  const blocoLeitura = fotoQuadro || estadoLeitura === "feita" || estadoLeitura === "erro" ? blocoLeituraQuadro(leitura, o.id, fotoQuadro) : null;
  if (blocoLeitura) partes.push(h("section", { class: "rel-seccao", id: "rel-leitura-quadro" }, h("h3", { text: "Leitura automática da foto do quadro (confirmar na visita)" }), blocoLeitura));
  const outrasFotos = listaFotos.filter((f) => f.chave !== "quadro");
  if (outrasFotos.length) partes.push(h("section", { class: "rel-seccao", id: "rel-fotos" }, h("h3", { text: `Fotos do cliente por divisão (${outrasFotos.length})` }), galeriaFotos(o.id, outrasFotos)));
  if (itens.length) {
    partes.push(seccao("Artigos e horas", tabelaItens(itens, mo, catalogo, numero(obj(s.deslocacao).valor_iva), { horas: true }),
      dados([["Estimativa dada ao cliente (c/ IVA)", estimativa], ["Plano sugerido", PLANOS_SIM[s.plano_sugerido] ?? t(s.plano_sugerido)]])));
  }
  partes.push(h("p", { class: "ajuda rel-rodape", text: "Valores orientativos calculados pelo simulador a partir das respostas do cliente (preços com IVA). Tudo é confirmado na visita técnica." }));
  return h("article", { class: "relatorio-tecnico simulacao", id: "relatorio-tecnico", "aria-labelledby": "rel-titulo" }, ...partes);
}

// ---------------------------------------------------------------- aparelhos sugeridos

const RE_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** Texto para "id" (letras minúsculas, dígitos e "-"). */
export function slug(s, max = 24) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}
// Nomes escritos pelo cliente (divisões, circuitos) vão para os pedidos do domus.sh: sem aspas, "\\", "<" nem ">".
const nomeLimpo = (s, max = 60) => String(s ?? "").replace(/["\\<>]/g, "").replace(/^[-\s]+/, "").trim().slice(0, max).trim();
// Nome do canal: até 30 caracteres (limite do painel; nem o converter nem o domus.sh impõem outro), cortado na última palavra inteira.
function canalLimpo(s) {
  const t = String(s ?? "").replace(/[:,="\\<>]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= 30) return t;
  const c = t.slice(0, 31), i = c.lastIndexOf(" ");
  return (i > 0 ? c.slice(0, i) : c.slice(0, 30)).trim();
}
function divisaoLimpa(s) {
  let t = String(s ?? "").replace(/["\\:,<>]/g, " ").replace(/\s+/g, " ").replace(/^[-\s]+/, "").trim();
  while (new TextEncoder().encode(t).length > 40) t = t.slice(0, -1).trim();
  return t;
}

/** Categoria e pormenores de um SKU (catálogo do pedido; sem ele, pelo próprio SKU). */
function tipoArtigo(sku, art) {
  // Artigos do quadro (especificacoes.funcao): o medidor geral e o geral Wi-Fi são aparelhos; o resto é só material.
  const funcao = obj(art?.especificacoes).funcao ?? (/^MEDIDOR-DIN/.test(sku) ? "medidor_geral" : /^GERAL-WIFI/.test(sku) ? "geral_wifi" : null);
  if (funcao === "medidor_geral" || funcao === "geral_wifi") return { cat: funcao };
  if (typeof funcao === "string") return { cat: "quadro" };
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
 * Os elementos telecom_* das simulações antigas (telecomunicações, que saíram do simulador) são ignorados.
 * - quadro: medidor geral Wi-Fi → openbeken medidor geral (sem canais); disjuntor geral Wi-Fi → openbeken com
 *   medidor e canal "Geral" carga=perigosa (geral só sem medidor geral); os outros artigos do quadro são só material.
 * Devolve [{id, tipo, nome, canais, divisao, medidor, geral, bateria, origem}].
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
    out.push({ id, tipo: a.tipo, nome: nomeLimpo(a.nome) || id, canais: a.canais, divisao: divisaoLimpa(a.divisao ?? ""), medidor: !!a.medidor, geral: !!a.geral && !!a.medidor, bateria: !!a.bateria, origem: a.origem });
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

  // Quadro: o medidor geral (é o "geral" da casa: o consumo total soma só este) e o disjuntor geral Wi-Fi
  // (corte remoto da casa toda → carga perigosa; mede, mas só é "geral" se não houver medidor geral).
  if (quant.medidor_geral) {
    juntar("medidor-geral", { tipo: "openbeken", nome: "Medidor geral", medidor: true, geral: true, canais: "", divisao: "", origem: `${skus.medidor_geral?.[0]} · consumo da casa toda` });
  }
  if (quant.geral_wifi) {
    juntar("geral", {
      tipo: "openbeken", nome: "Disjuntor geral", medidor: true, geral: !quant.medidor_geral, canais: "1:interruptor:Geral:carga=perigosa", divisao: "",
      origem: `${skus.geral_wifi?.[0]} · corte remoto da casa toda (pede sempre confirmação)`,
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
