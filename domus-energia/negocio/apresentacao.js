// Apresentação da atividade de grupo (diapositivo 52 da parte 2 do módulo 7855).
const pptxgen = require("pptxgenjs");

// Mesmos pressupostos do plano (plano.js). Obras-tipo: [nome, material c/ IVA, mão de obra c/ IVA, parte das obras, fica com aparelhos ligados]
const obras = [["Casa inteligente (T3)", 529.3, 313.5, 0.25, true], ["Quadro elétrico novo", 662.9, 380, 0.15, true], ["Carregador de carro elétrico", 277.9, 171, 0.10, false], ["Pequenas reparações", 96.6, 150.1, 0.30, false], ["Avaria", 27.9, 76, 0.20, false]];
const ticket = obras.reduce((s, o) => s + o[3] * (o[1] + o[2]) / 1.23, 0);
const margemMedia = obras.reduce((s, o) => s + o[3] * (o[1] * 0.4 + o[2] * 0.3) / 1.23, 0);
const parteCasas = obras.filter(o => o[4]).reduce((s, o) => s + o[3], 0);
const fixo = 430;
const inst = [4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12];
const MESES = ["set", "out", "nov", "dez", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago"];
const mens = (0.45 * 4.99 + 0.4 * 9.99 + 0.15 * 19.99) / 1.23;
let acc = 0, subsFinal = 0;
const resultados = inst.map(n => { acc += n; subsFinal = Math.round(Math.round(acc * parteCasas) * 0.7); return Math.round(n * margemMedia + subsFinal * mens - fixo); });
const investimento = [["Fundo de reserva (3 meses)", 1290], ["Stock de aparelhos", 900], ["Marketing de lançamento", 800], ["Documentos legais", 600], ["Seguro (1.º ano)", 480], ["Servidor e faturação", 420], ["Bancada", 350], ["Quadro de demonstração", 300], ["Identificação", 150]];
const investimentoTotal = investimento.reduce((s, i) => s + i[1], 0);
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
  s.addText("Atividade de grupo: ideia de negócio · Módulo 7855, Plano de negócio · Formador: Luís Santos · Rui Bragança", { x: 0.6, y: 4.6, w: 8.8, h: 0.4, fontFace: CORPO, fontSize: 12, color: "C9C7A8", margin: 0, isTextBox: true });
  s.addNotes("Apresentar a empresa numa frase: eletricidade e casa inteligente com orçamento na hora no site, feitas por eletricistas parceiros. As obras começam em setembro de 2027, depois do curso.");
}

// 2. Ideia → Projeto → Negócio
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Da ideia ao negócio");
  const fases = [
    ["Ideia", "Pedir um eletricista é lento e o preço é uma surpresa. Com um site que dá o orçamento na hora e aparelhos Wi-Fi baratos, dá para fazer melhor.", MUSGO],
    ["Projeto", "Mercado, clientes, concorrência, recursos, custos e riscos estudados. Empresa criada e plataforma publicada em opancas.pt.", ARGILA],
    ["Negócio", "Setembro de 2027: fim do curso, primeiras obras pagas, parceiros a trabalhar, primeiras mensalidades.", FLORESTA],
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
    { text: "Eletricidade e casa inteligente com orçamento na hora no site, feitas por eletricistas e ligadas a uma plataforma própria.", options: { fontSize: 17, color: CREME } },
  ], { x: 0.8, y: 1.7, w: 3.8, h: 3.2, fontFace: CORPO, valign: "top", margin: 0, isTextBox: true });
  const nec = [["€", "Saber o preço antes da visita", "orçamento na hora, no site"], ["🔒", "Ter um quadro seguro", "proteções certas e ensaios feitos"], ["⚡", "Gastar menos eletricidade", "consumo por circuito e alertas"], ["📱", "Controlar a casa à distância", "luzes, estores e aparelhos"]];
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
  perguntaTag(s, 3, "Lisboa e até 100 km");
  const segs = [["Famílias em casa própria", "Quadro seguro, conforto e poupança na fatura. Também senhorios e quem cuida dos pais", "Casa inteligente · Quadro novo"], ["Donos de carro elétrico", "Carregar em casa com segurança e saber quanto gasta", "Carregador de carro"], ["Quem tem uma avaria", "Resposta rápida e preço conhecido antes da visita", "Avaria · Reparações"]];
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
  perguntaTag(s, 4, "A obra paga-se uma vez; a mensalidade, todos os meses");
  const cab = o => ({ text: o, options: { bold: true, color: CREME, fill: { color: MUSGO } } });
  const opt = { x: 0.5, w: 4.35, fontFace: CORPO, fontSize: 12, color: FLORESTA, border: { type: "solid", pt: 0.5, color: "D9D3B0" }, fill: { color: "FFFFFF" }, margin: 0.06 };
  s.addTable([[cab("Obra-tipo (exemplo)"), cab("c/ IVA")], ...obras.map(o => [o[0], eur(o[1] + o[2])])], { ...opt, y: 1.95, colW: [2.95, 1.4], rowH: 0.36 });
  s.addTable([[cab("Plano mensal"), cab("c/ IVA")], ["Base", "4,99 €"], ["Conforto (+ alarme)", "9,99 €"], ["Premium (+ central em casa)", "19,99 €"]], { ...opt, x: 5.15, y: 1.95, colW: [3.0, 1.35], rowH: 0.42 });
  s.addText("Mão de obra a 38 € por hora com IVA; preço de cada artigo no site. Sem fidelização: se o cliente deixar de pagar, os botões continuam sempre a funcionar.", { x: 0.5, y: 4.35, w: 9, h: 0.6, fontFace: CORPO, fontSize: 13, italic: true, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
}

// 6. Concorrentes
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quem são os concorrentes?", "Fase 2 · Projeto");
  perguntaTag(s, 5, "E onde somos melhores");
  const conc = [["Eletricistas e plataformas de serviços", "Preço só depois da visita ou de várias propostas", "Orçamento na hora e obra documentada"], ["Alarmes com central", "Verisure: desde 37 € por mês, 24 meses", "Mensalidade de 4,99 a 19,99 €, sem fidelização"], ["Domótica KNX", "Desde cerca de 1 500 €, com obras", "Casa inteligente tipo por " + eur(obras[0][1] + obras[0][2]) + ", sem obras"], ["Montagem pelo próprio (Tuya)", "Barato, mas mexe no quadro sozinho", "Feito por eletricista, tudo numa aplicação"]];
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
  const rec = [["Humanos", "1 gerente e 4 eletricistas parceiros, um por especialidade; contabilista e advogado externos", MUSGO], ["Materiais", "Bancada de preparação, quadro de demonstração, stock de aparelhos; os parceiros usam a sua ferramenta", ARGILA], ["Financeiros", eur(investimentoTotal) + " de capital próprio; receitas das obras e das mensalidades", AREIA], ["Tecnológicos", "Plataforma própria: simulador de orçamento, painel de gestão, área do eletricista e aplicação do cliente", FLORESTA]];
  rec.forEach(([n, d, cor], i) => {
    const x = 0.5 + (i % 2) * 4.6, y = 1.9 + Math.floor(i / 2) * 1.6;
    cartao(s, x, y, 4.4, 1.42);
    circulo(s, x + 0.25, y + 0.25, 0.5, cor, n[0]);
    s.addText(n, { x: x + 0.9, y: y + 0.2, w: 3.3, h: 0.4, fontFace: TIT, fontSize: 17, bold: true, color: FLORESTA, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.9, y: y + 0.6, w: 3.35, h: 0.75, fontFace: CORPO, fontSize: 12, color: TEXTO_SUAVE, valign: "top", margin: 0, isTextBox: true });
  });
}

// 7b. Organização
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quem faz o quê", "Fase 2 · Projeto");
  perguntaTag(s, 6, "Um gerente e quatro especialidades, cada uma com suplente");
  cartao(s, 0.5, 1.85, 9, 1.05, FLORESTA);
  s.addText([{ text: "Gerente (Rui Bragança)", options: { bold: true, fontSize: 16, color: AREIA, breakLine: true } }, { text: "Direção e aprovação de cada obra · Sistemas e aparelhos (bancada, servidor, aplicação) · Atendimento e marcações", options: { fontSize: 12, color: CREME } }],
    { x: 0.75, y: 1.9, w: 8.5, h: 0.95, fontFace: CORPO, valign: "middle", margin: 0, isTextBox: true });
  const esp = [["Quadros e ensaios", "Parceiro 1", "Quadros novos; revê as obras dos colegas"], ["Casa inteligente", "Parceiro 2", "Aparelhos, aplicação, explicar ao cliente"], ["Avarias e reparações", "Parceiro 3", "Diagnóstico e resposta rápida"], ["Carregadores e obras novas", "Parceiro 4", "Linhas dedicadas; ajuda nos quadros"]];
  esp.forEach(([n, q, d], i) => {
    const x = 0.5 + i * 2.3;
    cartao(s, x, 3.1, 2.1, 1.75);
    s.addText(q.toUpperCase(), { x: x + 0.15, y: 3.2, w: 1.8, h: 0.25, fontFace: CORPO, fontSize: 9, bold: true, color: ARGILA, charSpacing: 2, margin: 0, isTextBox: true });
    s.addText(n, { x: x + 0.15, y: 3.45, w: 1.8, h: 0.6, fontFace: TIT, fontSize: 14, bold: true, color: MUSGO, valign: "top", margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.15, y: 4.05, w: 1.8, h: 0.75, fontFace: CORPO, fontSize: 11, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
  });
  s.addText("Parceiros independentes, pagos por obra: 70 % da mão de obra. Quem faz a obra não é quem a revê. Os melhores passam a contrato quando houver volume.", { x: 0.5, y: 4.95, w: 9, h: 0.5, fontFace: CORPO, fontSize: 11, italic: true, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
}

// 8. Investimento
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Qual o investimento inicial?", "Fase 2 · Projeto");
  perguntaTag(s, 7, "Capital próprio; a empresa e a plataforma já existem");
  s.addText(eur(investimentoTotal), { x: 0.5, y: 2.0, w: 3.6, h: 1.1, fontFace: TIT, fontSize: 60, bold: true, color: ARGILA, margin: 0, isTextBox: true });
  s.addText("sem empréstimos; o sinal de 30 % de cada obra paga o material dessa obra", { x: 0.5, y: 3.1, w: 3.4, h: 0.8, fontFace: CORPO, fontSize: 13, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
  const itens = investimento;
  s.addChart(pres.charts.BAR, [{ name: "Investimento", labels: itens.map(i => i[0]), values: itens.map(i => i[1]) }], {
    x: 4.3, y: 1.8, w: 5.3, h: 3.4, barDir: "bar", chartColors: [MUSGO], showValue: true, dataLabelFormatCode: "0", dataLabelPosition: "outEnd", dataLabelFontSize: 10, dataLabelColor: FLORESTA,
    catAxisLabelColor: FLORESTA, catAxisLabelFontSize: 11, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false, catAxisOrientation: "maxMin",
  });
}

// 9. Receitas
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Como serão obtidas receitas?", "Fase 2 · Projeto");
  perguntaTag(s, 8, "As obras pagam a empresa; as mensalidades repetem-se todos os meses");
  const stats = [[eur(ticket), "valor médio de uma obra (sem IVA)"], [`${Math.ceil(fixo / margemMedia)} por mês`, "obras para o ponto de equilíbrio"], [String(subsFinal), "casas com mensalidade em agosto de 2028"]];
  stats.forEach(([v, l], i) => {
    const y = 1.95 + i * 1.08;
    s.addText(v, { x: 0.5, y, w: 3.4, h: 0.6, fontFace: TIT, fontSize: 32, bold: true, color: MUSGO, margin: 0, isTextBox: true });
    s.addText(l, { x: 0.5, y: y + 0.58, w: 3.4, h: 0.35, fontFace: CORPO, fontSize: 12, color: TEXTO_SUAVE, margin: 0, isTextBox: true });
  });
  s.addChart(pres.charts.BAR, [{ name: "Resultado mensal", labels: MESES, values: resultados }], {
    x: 4.2, y: 1.8, w: 5.4, h: 3.4, barDir: "col", chartColors: [ARGILA], showTitle: true, title: "Resultado mensal previsto (€, set. 2027 a ago. 2028)", titleFontSize: 12, titleColor: FLORESTA,
    showValue: false, catAxisLabelColor: FLORESTA, valAxisLabelColor: TEXTO_SUAVE, valAxisLabelFontSize: 9, catAxisLabelFontSize: 9, valGridLine: { color: "E6E0BF", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false,
  });
}

// 10. Riscos
{
  const s = pres.addSlide(); fundoClaro(s);
  titulo(s, "Quais os principais riscos?", "Fase 2 · Projeto");
  perguntaTag(s, 9, "E a medida preventiva de cada um");
  const r = [["Falta de clientes", "Avaliações no Google, relatório grátis da casa, parcerias"], ["Habilitação atrasada", "Não marcar obras antes do fim do curso"], ["Tudo depende do gerente", "Procedimentos escritos; atendimento a meio tempo acima de 12 obras por mês"], ["Parceiros sem disponibilidade", "Suplente em cada especialidade; bolsa de trabalhos"], ["Aparelho avaria", "Testado na bancada; stock de substituição; garantia da empresa"], ["Obra mal feita", "Ensaios, fotografias, revisão por outro eletricista, seguro"]];
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
  perguntaTag(s, 10, "Da preparação à primeira obra");
  const passos = [["Até dez. 2026", "Montar a bancada e testar os aparelhos"], ["Até mar. 2027", "Documentos legais, contrato de parceiro, CAE 43210"], ["Mai. a ago. 2027", "Treinar os 4 parceiros; seguro; fim do curso"], ["Set. 2027", "Lançamento e primeiras 4 obras, uma por especialidade"]];
  s.addShape(pres.shapes.LINE, { x: 0.9, y: 2.55, w: 8.2, h: 0, line: { color: AREIA, width: 2 } });
  passos.forEach(([q, t], i) => {
    const x = 0.5 + i * 2.3;
    circulo(s, x + 0.2, 2.35, 0.4, i === 0 ? ARGILA : MUSGO, String(i + 1));
    s.addText(q, { x, y: 2.9, w: 2.1, h: 0.35, fontFace: CORPO, fontSize: 13, bold: true, color: ARGILA, margin: 0, isTextBox: true });
    s.addText(t, { x, y: 3.25, w: 2.1, h: 1.3, fontFace: CORPO, fontSize: 13, color: FLORESTA, valign: "top", margin: 0, isTextBox: true });
  });
  s.addText("Primeira ação: montar a bancada e testar os aparelhos que vão para casa dos clientes.", { x: 0.5, y: 4.7, w: 9, h: 0.45, fontFace: CORPO, fontSize: 15, bold: true, color: MUSGO, margin: 0, isTextBox: true });
}

// 12. Fecho
{
  const s = pres.addSlide(); s.background = { color: FLORESTA };
  s.addText("Uma ideia é o ponto de partida. Um projeto transforma-a num plano. Um negócio transforma o projeto em realidade.", { x: 0.8, y: 1.3, w: 8.4, h: 1.8, fontFace: TIT, fontSize: 26, italic: true, color: CREME, margin: 0, isTextBox: true });
  s.addText("Domus Energia · opancas.pt · 968 728 723", { x: 0.8, y: 3.6, w: 8.4, h: 0.5, fontFace: CORPO, fontSize: 18, bold: true, color: AREIA, margin: 0, isTextBox: true });
  s.addText("Obrigado · Perguntas?", { x: 0.8, y: 4.2, w: 8.4, h: 0.5, fontFace: CORPO, fontSize: 16, color: "C9C7A8", margin: 0, isTextBox: true });
}

pres.writeFile({ fileName: "Domus_Energia_Ideia_de_Negocio.pptx" }).then(f => console.log("ok", f, Math.round(ticket), Math.round(margemMedia), resultados));
