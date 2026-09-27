// Apresentação da atividade de grupo (diapositivo 52 da parte 2 do módulo 7855).
const pptxgen = require("pptxgenjs");

// Mesmos pressupostos do plano (plano.js)
const kits = [["Essencial", 390, 180], ["Conforto", 890, 420], ["Segurança Premium", 1490, 700]];
const mix = [0.5, 0.35, 0.15];
const ticket = kits.reduce((s, k, i) => s + k[1] * mix[i], 0);
const equipMedio = kits.reduce((s, k, i) => s + k[2] * mix[i], 0);
const margemMedia = equipMedio * 0.28 + (ticket - equipMedio) * 0.4;
const fixo = 510;
const inst = [2, 2, 2, 4, 4, 4, 6, 6, 6, 6, 6, 6];
const mens = (0.45 * 4.99 + 0.4 * 9.99 + 0.15 * 19.99) / 1.23;
let acc = 0;
const resultados = inst.map(n => { acc += n; return Math.round(n * margemMedia + Math.round(acc * 0.7) * mens - fixo); });
const eur = v => v.toLocaleString("pt-PT", { maximumFractionDigits: 0 }) + " €";

const FLORESTA = "283618", MUSGO = "606C38", CREME = "FEFAE0", AREIA = "DDA15E", ARGILA = "BC6C25", MUSGO_CLARO = "EEF0D9", TEXTO_SUAVE = "5C6446";
const TIT = "Cambria", CORPO = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625
pres.title = "Domus Energia — Ideia de negócio";

const fundoClaro = s => { s.background = { color: CREME }; };
const titulo = (s, t, fase) => {
  if (fase) s.addText(fase.toUpperCase(), { x: 0.5, y: 0.3, w: 6, h: 0.3, fontFace: CORPO, fontSize: 11, bold: true, color: ARGILA, charSpacing: 3, margin: 0, isTextBox: true });
  s.addText(t, { x: 0.5, y: 0.55, w: 9, h: 0.7, fontFace: TIT, fontSize: 30, bold: true, color: FLORESTA, margin: 0, isTextBox: true });
};
const circulo = (s, x, y, d, cor, txt, corTxt = CREME) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: cor }, line: { color: cor } });
  if (txt) s.addText(txt, { x, y, w: d, h: d, align: "center", valign: "middle", fontFace: TIT, fontSize: d * 22, bold: true, color: corTxt, margin: 0, isTextBox: true });
};
const cartao = (s, x, y, w, h, fill = "FFFFFF") => s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: "E6E0BF", width: 0.75 },
  shadow: { type: "outer", color: "283618", opacity: 0.08, blur: 6, offset: 2, angle: 90 },
});
const perguntaTag = (s, n, texto, x = 0.5, y = 1.3) => {
  circulo(s, x, y, 0.36, ARGILA, String(n));
  s.addText(texto, { x: x + 0.48, y, w: 8, h: 0.36, valign: "middle", fontFace: CORPO, fontSize: 14, italic: true, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
};

// 1. Capa
{
  const s = pres.addSlide(); s.background = { color: FLORESTA };
  circulo(s, 0.6, 0.7, 0.9, MUSGO, "⚡");
  s.addText("Domus Energia", { x: 0.6, y: 1.8, w: 8.8, h: 1.0, fontFace: TIT, fontSize: 48, bold: true, color: CREME, margin: 0, isTextBox: true });
  s.addText("A eletricidade da sua casa, na palma da mão.", { x: 0.6, y: 2.8, w: 8.8, h: 0.5, fontFace: CORPO, fontSize: 20, italic: true, color: AREIA, margin: 0, isTextBox: true });
  s.addText("Atividade de grupo: ideia de negócio · Módulo 7855 – Plano de negócio · Formador: Luís Santos", { x: 0.6, y: 4.6, w: 8.8, h: 0.4, fontFace: CORPO, fontSize: 12, color: "C9C7A8", margin: 0, isTextBox: true });
  s.addNotes("Apresentar a empresa numa frase: eletricidade e automação residencial na Grande Lisboa, com plataforma própria e mensalidade baixa.");
}

// 2. Ideia → Projeto → Negócio
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Da ideia ao negócio");
  const fases = [
    ["Ideia", "Casas gastam demais e não têm segurança. Com aparelhos Wi-Fi e uma app própria, um eletricista pode resolver isso.", MUSGO],
    ["Projeto", "Mercado, clientes, concorrência, recursos, custos e riscos estudados. Plataforma (servidor, app e site) já construída e testada.", ARGILA],
    ["Negócio", "Criar a empresa, 3 instalações-piloto, primeiros clientes e mensalidades, resultados acompanhados todas as semanas.", FLORESTA],
  ];
  fases.forEach(([n, t, cor], i) => {
    const x = 0.5 + i * 3.1;
    cartao(s, x, 1.55, 2.8, 3.4);
    circulo(s, x + 0.3, 1.8, 0.6, cor, String(i + 1));
    s.addText(n, { x: x + 0.3, y: 2.55, w: 2.2, h: 0.5, fontFace: TIT, fontSize: 22, bold: true, color: cor, margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.3, y: 3.1, w: 2.25, h: 1.7, fontFace: CORPO, fontSize: 13, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
    if (i < 2) s.addText("→", { x: x + 2.8, y: 3.0, w: 0.3, h: 0.5, align: "center", fontFace: CORPO, fontSize: 22, bold: true, color: ARGILA, margin: 0, isTextBox: true });
  });
}

// 3. Ideia + necessidade
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "A ideia e a necessidade que resolve", "Fase 1 · Ideia");
  cartao(s, 0.5, 1.4, 4.35, 3.7, FLORESTA);
  s.addText([
    { text: "1  Qual é a ideia?", options: { fontSize: 13, bold: true, color: AREIA, breakLine: true } },
    { text: "Casas inteligentes instaladas por eletricistas, ligadas a uma plataforma própria (app Android e site), com mensalidade baixa.", options: { fontSize: 17, color: CREME } },
  ], { x: 0.8, y: 1.7, w: 3.8, h: 3.2, fontFace: CORPO, valign: "top", margin: 0, isTextBox: true });
  const nec = [["€", "Gastar menos eletricidade", "consumo por circuito e alertas"], ["🔒", "Ter segurança", "alarme sem contratos de 24 meses"], ["📱", "Controlar à distância", "luzes, estores e aparelhos"], ["♥", "Acompanhar os pais", "aviso se algo não está normal"]];
  s.addText("2  Que necessidade resolve?", { x: 5.2, y: 1.4, w: 4.3, h: 0.35, fontFace: CORPO, fontSize: 13, bold: true, color: ARGILA, margin: 0, isTextBox: true });
  nec.forEach(([ic, t, d], i) => {
    const y = 1.85 + i * 0.82;
    circulo(s, 5.2, y, 0.55, MUSGO_CLARO, ic, MUSGO);
    s.addText([{ text: t, options: { bold: true, fontSize: 15, color: FLORESTA, breakLine: true } }, { text: d, options: { fontSize: 12, color: TEXTO_SUAVE } }],
      { x: 5.9, y, w: 3.6, h: 0.6, fontFace: CORPO, valign: "middle", margin: 0, isTextBox: true });
  });
}

// 4. Clientes
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quem são os clientes?", "Fase 1 · Ideia");
  perguntaTag(s, 3, "Grande Lisboa, no primeiro ano");
  const segs = [["Famílias em moradias", "Segurança, conforto e poupança na fatura", "Kit Conforto ou Premium"], ["Apartamentos e alojamento local", "Controlo à distância e consumo por estadia", "Kit Essencial ou Conforto"], ["Idosos e familiares", "Aviso se não houver movimento de manhã", "Kit Conforto"]];
  segs.forEach(([n, d, k], i) => {
    const x = 0.5 + i * 3.1;
    cartao(s, x, 1.95, 2.8, 2.95);
    s.addText(n, { x: x + 0.25, y: 2.15, w: 2.3, h: 0.8, fontFace: TIT, fontSize: 18, bold: true, color: MUSGO, valign: "top", margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.25, y: 3.0, w: 2.3, h: 1.0, fontFace: CORPO, fontSize: 13, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.25, y: 4.2, w: 2.3, h: 0.45, rectRadius: 0.2, fill: { color: MUSGO_CLARO }, line: { color: MUSGO_CLARO } });
    s.addText(k, { x: x + 0.25, y: 4.2, w: 2.3, h: 0.45, align: "center", valign: "middle", fontFace: CORPO, fontSize: 12, bold: true, color: MUSGO, margin: 0, isTextBox: true });
  });
}

// 5. Produto
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "O que vendemos", "Fase 2 · Projeto");
  perguntaTag(s, 4, "Instalação uma vez + mensalidade");
  const cab = o => ({ text: o, options: { bold: true, color: CREME, fill: { color: MUSGO } } });
  const opt = { x: 0.5, w: 4.35, fontFace: CORPO, fontSize: 12, color: FLORESTA, border: { type: "solid", pt: 0.5, color: "D9D3B0" }, fill: { color: "FFFFFF" }, margin: 0.06 };
  s.addTable([[cab("Kit de instalação"), cab("Preço s/ IVA")], ...kits.map(k => [k[0], eur(k[1])])], { ...opt, y: 1.95, colW: [2.95, 1.4], rowH: 0.42 });
  s.addTable([[cab("Plano mensal"), cab("c/ IVA")], ["Base", "4,99 €"], ["Conforto (+ alarme)", "9,99 €"], ["Segurança Premium (+ Raspberry Pi)", "19,99 €"]], { ...opt, x: 5.15, y: 1.95, colW: [3.0, 1.35], rowH: 0.42 });
  s.addText("Sem fidelização longa. Se o cliente deixar de pagar, os interruptores físicos continuam sempre a funcionar.", { x: 0.5, y: 4.2, w: 9, h: 0.6, fontFace: CORPO, fontSize: 13, italic: true, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
}

// 6. Concorrentes
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quem são os concorrentes?", "Fase 2 · Projeto");
  perguntaTag(s, 5, "E onde somos melhores");
  const conc = [["Alarmes com central", "Verisure: desde 37 €/mês, 24 meses", "Mensalidade 4,99–19,99 €, sem fidelização longa"], ["Domótica KNX", "Desde ≈ 1 500 €, obras", "Kits desde 390 €, sem obras"], ["Eletricistas tradicionais", "Só a instalação", "App própria, alertas e suporte"], ["Faça você mesmo (Tuya)", "Barato, mas mexe no quadro sozinho", "Instalação segura e tudo numa app"]];
  conc.forEach(([n, e, n2], i) => {
    const y = 1.9 + i * 0.8;
    cartao(s, 0.5, y, 9, 0.68);
    s.addText(n, { x: 0.7, y, w: 2.6, h: 0.68, valign: "middle", fontFace: CORPO, fontSize: 14, bold: true, color: FLORESTA, margin: 0, isTextBox: true });
    s.addText(e, { x: 3.3, y, w: 2.8, h: 0.68, valign: "middle", fontFace: CORPO, fontSize: 12, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
    s.addText("✓ " + n2, { x: 6.1, y, w: 3.3, h: 0.68, valign: "middle", fontFace: CORPO, fontSize: 12, bold: true, color: MUSGO, margin: 0, isTextBox: true });
  });
  s.addText("Fontes: verisure.pt/preco-alarme · zaask.pt (domótica, smart home)", { x: 0.5, y: 5.15, w: 9, h: 0.3, fontFace: CORPO, fontSize: 9, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
}

// 7. Recursos
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Que recursos são necessários?", "Fase 2 · Projeto");
  perguntaTag(s, 6, "Os 4 recursos da empresa");
  const rec = [["Humanos", "CEO e técnico responsável, 2 técnicos instaladores, 1 técnico de sistemas, 1 comercial part-time", MUSGO], ["Materiais", "Oficina, carros, ferramentas e EPI, kit de demonstração, stock de aparelhos", ARGILA], ["Financeiros", "5 000 € de capital próprio; receitas das obras e das mensalidades", AREIA], ["Tecnológicos", "Plataforma própria: servidor, motor de automações, app Android e site", FLORESTA]];
  rec.forEach(([n, d, cor], i) => {
    const x = 0.5 + (i % 2) * 4.6, y = 1.9 + Math.floor(i / 2) * 1.6;
    cartao(s, x, y, 4.4, 1.42);
    circulo(s, x + 0.25, y + 0.25, 0.5, cor, n[0]);
    s.addText(n, { x: x + 0.9, y: y + 0.2, w: 3.3, h: 0.4, fontFace: TIT, fontSize: 17, bold: true, color: FLORESTA, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.9, y: y + 0.6, w: 3.35, h: 0.75, fontFace: CORPO, fontSize: 12, color: TEXTO_SUAVE, valign: "top", margin: 0, isTextBox: true });
  });
}

// 8. Investimento
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Qual o investimento inicial?", "Fase 2 · Projeto");
  perguntaTag(s, 7, "Arranque com capital próprio");
  s.addText("5 000 €", { x: 0.5, y: 2.0, w: 3.6, h: 1.1, fontFace: TIT, fontSize: 60, bold: true, color: ARGILA, margin: 0, isTextBox: true });
  s.addText("sem empréstimos no arranque; apoios IEFP e microcrédito como reserva", { x: 0.5, y: 3.1, w: 3.4, h: 0.8, fontFace: CORPO, fontSize: 13, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
  const itens = [["Stock inicial", 1300], ["Ferramentas e EPI", 1200], ["Fundo de reserva", 940], ["Marketing", 600], ["Seguro RC", 420], ["Criar a empresa", 360], ["Servidor e domínio", 180]];
  s.addChart(pres.charts.BAR, [{ name: "Investimento", labels: itens.map(i => i[0]), values: itens.map(i => i[1]) }], {
    x: 4.3, y: 1.8, w: 5.3, h: 3.4, barDir: "bar", chartColors: [MUSGO], showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 10, dataLabelColor: FLORESTA,
    catAxisLabelColor: FLORESTA, catAxisLabelFontSize: 11, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false, catAxisOrientation: "maxMin",
  });
}

// 9. Receitas
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Como serão obtidas receitas?", "Fase 2 · Projeto");
  perguntaTag(s, 8, "Instalações pagam o arranque; mensalidades repetem-se todos os meses");
  const stats = [[eur(ticket), "valor médio por instalação"], [`${Math.ceil(fixo / margemMedia)} / mês`, "instalações para o ponto de equilíbrio"], ["≈ 38", "casas com mensalidade no mês 12"]];
  stats.forEach(([v, l], i) => {
    const y = 1.95 + i * 1.08;
    s.addText(v, { x: 0.5, y, w: 3.4, h: 0.6, fontFace: TIT, fontSize: 32, bold: true, color: MUSGO, margin: 0, isTextBox: true });
    s.addText(l, { x: 0.5, y: y + 0.58, w: 3.4, h: 0.35, fontFace: CORPO, fontSize: 12, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
  });
  s.addChart(pres.charts.BAR, [{ name: "Resultado mensal", labels: inst.map((_, i) => `M${i + 1}`), values: resultados }], {
    x: 4.2, y: 1.8, w: 5.4, h: 3.4, barDir: "col", chartColors: [ARGILA], showTitle: true, title: "Resultado mensal previsto (€, ano 1)", titleFontSize: 12, titleColor: FLORESTA,
    showValue: false, catAxisLabelColor: FLORESTA, valAxisLabelColor: TEXTO_SUAVE, valAxisLabelFontSize: 9, catAxisLabelFontSize: 9, valGridLine: { color: "E6E0BF", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false,
  });
}

// 10. Riscos
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quais os principais riscos?", "Fase 2 · Projeto");
  perguntaTag(s, 9, "E a medida preventiva de cada um");
  const r = [["Falta de clientes", "Pilotos com testemunhos; parcerias com AL, mediadoras e lares"], ["Aumento dos custos", "Orçamentos válidos 30 dias; obras agrupadas por zona"], ["Novos concorrentes", "Plataforma própria, suporte e preço sem fidelização"], ["Um só fornecedor", "2 distribuidores; protocolo aberto (MQTT)"], ["Certificação DGEG", "Até ao fim do curso: subcontratar eletricista certificado"], ["Falha de internet", "Regras nos aparelhos; Raspberry Pi no plano Premium"]];
  r.forEach(([n, m], i) => {
    const x = 0.5 + (i % 3) * 3.07, y = 1.9 + Math.floor(i / 3) * 1.6;
    cartao(s, x, y, 2.87, 1.42);
    s.addText(n, { x: x + 0.2, y: y + 0.15, w: 2.5, h: 0.4, fontFace: CORPO, fontSize: 14, bold: true, color: ARGILA, margin: 0, isTextBox: true });
    s.addText(m, { x: x + 0.2, y: y + 0.55, w: 2.5, h: 0.8, fontFace: CORPO, fontSize: 12, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
  });
}

// 11. Primeira ação
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Qual a primeira ação a realizar?", "Fase 3 · Negócio");
  perguntaTag(s, 10, "Plano de ação dos primeiros 3 meses");
  const passos = [["Mês 1", "Decidir sócios e criar a empresa; seguro e contabilista"], ["Mês 1–2", "Servidor, app e kit de demonstração prontos"], ["Mês 2", "Lançamento: Google, site, flyers; pagamentos Stripe"], ["Mês 2–3", "3 instalações-piloto com testemunhos"]];
  s.addShape(pres.shapes.LINE, { x: 0.9, y: 2.55, w: 8.2, h: 0, line: { color: AREIA, width: 2 } });
  passos.forEach(([q, t], i) => {
    const x = 0.5 + i * 2.3;
    circulo(s, x + 0.2, 2.35, 0.4, i === 0 ? ARGILA : MUSGO, String(i + 1));
    s.addText(q, { x, y: 2.9, w: 2.1, h: 0.35, fontFace: CORPO, fontSize: 13, bold: true, color: ARGILA, margin: 0, isTextBox: true });
    s.addText(t, { x, y: 3.25, w: 2.1, h: 1.3, fontFace: CORPO, fontSize: 13, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
  });
  s.addText("Primeira ação: decidir os sócios e criar a empresa (Empresa na Hora).", { x: 0.5, y: 4.7, w: 9, h: 0.45, fontFace: CORPO, fontSize: 15, bold: true, color: MUSGO, margin: 0, isTextBox: true });
}

// 12. Fecho
{
  const s = pres.addSlide(); s.background = { color: FLORESTA };
  s.addText("Uma ideia é o ponto de partida. Um projeto transforma-a num plano. Um negócio transforma o projeto em realidade.", { x: 0.8, y: 1.3, w: 8.4, h: 1.8, fontFace: TIT, fontSize: 26, italic: true, color: CREME, margin: 0, isTextBox: true });
  s.addText("Domus Energia · Grande Lisboa", { x: 0.8, y: 3.6, w: 8.4, h: 0.5, fontFace: CORPO, fontSize: 18, bold: true, color: AREIA, margin: 0, isTextBox: true });
  s.addText("Obrigado · Perguntas?", { x: 0.8, y: 4.2, w: 8.4, h: 0.5, fontFace: CORPO, fontSize: 16, color: "C9C7A8", margin: 0, isTextBox: true });
}

pres.writeFile({ fileName: "Domus_Energia_Ideia_de_Negocio.pptx" }).then(f => console.log("ok", f, Math.round(ticket), Math.round(margemMedia), resultados));
