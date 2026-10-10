const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, LevelFormat, BorderStyle, PageBreak, Footer, PageNumber,
  TableOfContents, Header,
} = require("docx");

// ---------- Paleta (tema Terra) ----------
const MUSGO = "606C38", FLORESTA = "283618", AREIA_CLARA = "F4EFD2", MUSGO_CLARO = "EEF0D9";
const eur = (v, d = 0) => v.toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";

// ---------- Contas (todos os valores sem IVA, salvo indicação) ----------
const IVA = 1.23;
const planos = [
  { nome: "Base", com: 4.99, inclui: "App e área de cliente, controlo à distância, automações e cenas, histórico, relatório da casa" },
  { nome: "Conforto", com: 9.99, inclui: "Tudo do Base + modos Fora/Noite/Férias e alarme, notificações, energia, saúde dos aparelhos" },
  { nome: "Premium", com: 19.99, inclui: "Tudo do Conforto + central Raspberry Pi em casa (fase seguinte), suporte prioritário" },
];
planos.forEach(p => (p.sem = p.com / IVA));

// Preços do catálogo do site (opancas.pt, outubro de 2026), com IVA.
const TARIFA = 38;        // € por hora de mão de obra, com IVA
const OBRA_MINIMA = 100;  // € com IVA
// linha: [artigo, preço com IVA, horas, quantidade, fechado]  (fechado = o preço já inclui a mão de obra)
const obras = [
  { nome: "Casa inteligente (T3)", curto: "Casa inteligente", parte: 0.25, casa: true, area: "Casa inteligente", linhas: [
    ["Disjuntor inteligente Wi-Fi com medição", 39.9, 0.5, 6],
    ["Interruptor de parede tátil Wi-Fi 2 botões", 27.9, 0.5, 6],
    ["Módulo de estore Wi-Fi", 29.9, 0.75, 2],
    ["Sensor de porta/janela Wi-Fi", 19.9, 0.25, 2],
    ["Sensor de movimento Wi-Fi", 22.9, 0.25, 1],
  ] },
  { nome: "Quadro elétrico novo (24 módulos)", curto: "Quadro novo", parte: 0.15, casa: true, area: "Quadros e ensaios", linhas: [
    ["Caixa de quadro 24 módulos", 64.9, 4, 1],
    ["Disjuntor geral Wi-Fi com medição e corte", 69.9, 0.75, 1],
    ["Diferencial Wi-Fi com religação automática", 119, 0.75, 1],
    ["Descarregador de sobretensões tipo 2", 89.9, 0.5, 1],
    ["Disjuntor inteligente Wi-Fi com medição", 39.9, 0.5, 8],
  ] },
  { nome: "Carregador de carro elétrico", curto: "Carregador", parte: 0.10, casa: false, area: "Carregadores e obras novas", linhas: [
    ["Linha dedicada do carregador até 15 m", 390, 4, 1, true],
    ["Disjuntor inteligente Wi-Fi com medição", 39.9, 0.5, 1],
  ] },
  { nome: "Pequenas reparações", curto: "Reparações", parte: 0.30, casa: false, area: "Avarias e reparações", linhas: [
    ["Tomada nova", 40, 0.6, 2, true],
    ["Ponto de luz novo", 45, 0.75, 1, true],
    ["Interruptor novo", 35, 0.5, 1, true],
    ["Troca de tomada ou interruptor", 9.9, 0.5, 3],
  ] },
  { nome: "Avaria", curto: "Avaria", parte: 0.20, casa: false, area: "Avarias e reparações", linhas: [
    ["Diagnóstico de avaria", 25, 0.5, 1, true],
    ["Disjuntor 1P+N (peça)", 21.9, 0.25, 1],
    ["Reparação (mão de obra)", 0, 1.25, 1],
  ] },
];
const custoMaterial = 0.60;  // o material custa à empresa ≈ 60 % do preço de venda
const pagaParceiro = 0.70;   // 70 % da mão de obra (sem IVA) vai para o eletricista parceiro
obras.forEach(o => {
  let mat = 0, mao = 0, horas = 0;
  o.linhas.forEach(([, preco, h, q, fechado]) => {
    horas += h * q;
    if (fechado) { const m = Math.min(preco * q, h * q * TARIFA); mao += m; mat += preco * q - m; }
    else { mat += preco * q; mao += h * q * TARIFA; }
  });
  o.horas = horas;
  o.com = Math.max(mat + mao, OBRA_MINIMA);
  o.preco = o.com / IVA; o.mat = mat / IVA; o.mao = o.preco - o.mat;
  o.custoMat = o.mat * custoMaterial; o.custoMao = o.mao * pagaParceiro;
  o.margem = o.preco - o.custoMat - o.custoMao;
});
const media = campo => obras.reduce((s, o) => s + o.parte * o[campo], 0);
const ticket = media("preco"), margemMedia = media("margem"), horasMedias = media("horas");
const parteCasas = obras.filter(o => o.casa).reduce((s, o) => s + o.parte, 0);

const NOMES_MES = ["set 27", "out 27", "nov 27", "dez 27", "jan 28", "fev 28", "mar 28", "abr 28", "mai 28", "jun 28", "jul 28", "ago 28"];
const obrasMes = [4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12];
const subscreve = 0.7;
const mensalidadeMedia = (0.45 * planos[0].sem + 0.4 * planos[1].sem + 0.15 * planos[2].sem);
let acumuladas = 0;
const meses = obrasMes.map((n, i) => {
  acumuladas += n;
  const casas = Math.round(acumuladas * parteCasas);
  const subs = Math.round(casas * subscreve) * mensalidadeMedia;
  return { mes: i + 1, nome: NOMES_MES[i], n, casas, vendas: n * ticket, margem: n * margemMedia, subs };
});
const fixosMes = {
  "Servidor VPS, domínio e email": 15,
  "Contabilista certificado": 100,
  "Seguro de responsabilidade civil": 40,
  "Programa de faturação certificado e outro software": 20,
  "Telemóvel e internet": 25,
  "Marketing (Google, redes sociais, folhetos)": 150,
  "Deslocações do gerente": 50,
  "Garantias e aparelhos de substituição": 30,
};
const fixoTotal = Object.values(fixosMes).reduce((a, b) => a + b, 0);
const ano = meses.reduce((t, m) => ({ n: t.n + m.n, vendas: t.vendas + m.vendas, margem: t.margem + m.margem, subs: t.subs + m.subs }), { n: 0, vendas: 0, margem: 0, subs: 0 });
const resultadoAno = ano.margem + ano.subs - fixoTotal * 12;
const mrrFinal = meses[11].subs;
const casasFinal = meses[11].casas, subsFinal = Math.round(casasFinal * subscreve);
const pagoParceiros = ano.n * media("custoMao");

const arranque = [
  ["Bancada de preparação dos aparelhos (fonte, adaptador, multímetro, ferramenta)", 350],
  ["Quadro de demonstração para visitas e fotografias", 300],
  ["Stock inicial de aparelhos (≈ 3 casas inteligentes)", 900],
  ["Seguro de responsabilidade civil (1.º ano)", 480],
  ["Documentos legais com advogado (condições, contrato de parceiro, dados pessoais)", 600],
  ["Marketing de lançamento (Google, folhetos, fotografias das primeiras obras)", 800],
  ["Servidor, domínio, email e programa de faturação (1.º ano)", 420],
  ["Identificação dos parceiros (cartões, coletes)", 150],
  [`Fundo de reserva (3 meses de custos fixos)`, fixoTotal * 3],
];
const arranqueTotal = arranque.reduce((s, [, v]) => s + v, 0);

// ---------- Ajudantes ----------
const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: [new TextRun({ text, ...(opts.run || {}) })] });
const rich = (runs, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: runs.map(r => typeof r === "string" ? new TextRun(r) : new TextRun(r)) });
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const bullet = (t, nivel = 0) => new Paragraph({ numbering: { reference: "pontos", level: nivel }, spacing: { after: 60 }, children: typeof t === "string" ? [new TextRun(t)] : t.map(r => new TextRun(r)) });
const num = (t, ref = "numeros") => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const quebra = () => new Paragraph({ children: [new PageBreak()] });
const nota = t => new Paragraph({ spacing: { before: 60, after: 160 }, shading: { type: ShadingType.CLEAR, fill: AREIA_CLARA, color: "auto" }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "DDA15E", space: 6 } }, children: [new TextRun({ text: t, size: 20 })] });

const LARGURA = 9026; // A4 com margens de 2,54 cm
function tabela(cabecalho, linhas, larguras, { alinharDireita = [] } = {}) {
  const soma = larguras.reduce((a, b) => a + b, 0);
  const cols = larguras.map(w => Math.round(w / soma * LARGURA));
  cols[cols.length - 1] += LARGURA - cols.reduce((a, b) => a + b, 0);
  const borda = { style: BorderStyle.SINGLE, size: 4, color: "D9D3B0" };
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  const celula = (txt, i, cab, ultima) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA }, borders: bordas,
    shading: cab ? { type: ShadingType.CLEAR, fill: MUSGO, color: "auto" } : ultima ? { type: ShadingType.CLEAR, fill: MUSGO_CLARO, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: alinharDireita.includes(i) && !cab ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(txt), bold: cab || ultima, color: cab ? "FEFAE0" : FLORESTA, size: 19 })] })],
  });
  return new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: cabecalho.map((c, i) => celula(c, i, true)) }),
      ...linhas.map((l, j) => new TableRow({ children: l.map((c, i) => celula(c, i, false, l.total)) })),
    ],
  });
}
const total = arr => Object.assign(arr, { total: true });
const espaco = () => new Paragraph({ spacing: { after: 80 }, children: [] });

// ---------- Conteúdo ----------
const c = [];
const parteTitulo = t => new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: t, bold: true, size: 36, color: "BC6C25" })] });
const pontoEquilibrio = fixoTotal / margemMedia;
const AREAS = ["Quadros e ensaios", "Casa inteligente", "Avarias e reparações", "Carregadores e obras novas"];
const horasArea = a => obras.filter(o => o.area === a).reduce((s, o) => s + o.parte * ano.n * o.horas, 0);
const obrasArea = a => obras.filter(o => o.area === a).reduce((s, o) => s + o.parte * ano.n, 0);
const pct = v => Math.round(v * 100) + " %";

// Capa
c.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: "DOMUS ENERGIA", bold: true, size: 56, color: MUSGO })] }));
c.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: "Eletricidade e casa inteligente", size: 30, color: FLORESTA })] }));
c.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "DDA15E", space: 4 } }, children: [] }));
c.push(new Paragraph({ spacing: { before: 400, after: 120 }, children: [new TextRun({ text: "Plano de Negócio", bold: true, size: 40, color: FLORESTA })] }));
c.push(p("Estruturado segundo o módulo 7855, Plano de negócio, criação de pequenos e médios negócios (formador: Luís Santos): parte 1 (Planeamento, organização e conceito de negócio) e parte 2 (Plano de ação e plano de negócio).", { run: { size: 22 } }));
c.push(p("Autor: Rui Bragança · Estação Nómada, Unipessoal Lda. (marca Domus Energia) · opancas.pt", { spacing: { before: 400 }, run: { size: 20, color: "5C6446" } }));
c.push(p("Preparação: outubro de 2026 a agosto de 2027 · Ano 1: setembro de 2027 a agosto de 2028 · Versão de outubro de 2026", { run: { size: 20, color: "5C6446" } }));
c.push(p("Os valores financeiros são estimativas sem IVA, salvo indicação em contrário, feitas com os preços do catálogo do site em outubro de 2026. Devem ser revistos com o contabilista certificado.", { run: { size: 18, italics: true, color: "5C6446" } }));
c.push(quebra());

c.push(new Paragraph({ children: [new TextRun({ text: "Índice", bold: true, size: 32, color: MUSGO })], spacing: { after: 200 } }));
c.push(new TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-2" }));
c.push(p("(No Word: clique com o botão direito no índice e escolha Atualizar campo, para mostrar os números de página.)", { run: { size: 18, italics: true, color: "5C6446" } }));
c.push(quebra());

// ================= PARTE I =================
c.push(parteTitulo("PARTE I: PLANO DE NEGÓCIO"));
c.push(p("Segue a estrutura do diapositivo 7 do módulo (Plano de ação e plano de negócio): resumo, empresa, serviço, mercado, clientes, concorrência, marketing e vendas, plano operacional, recursos humanos, investimento, previsões financeiras, riscos e objetivos."));

// 1. Resumo
c.push(h1("1. Resumo do negócio"));
c.push(p("A Domus Energia faz trabalhos de eletricidade em casas e torna-as inteligentes: quadros elétricos, disjuntores com medição de consumo, interruptores, estores, sensores, carregadores de carro elétrico, reparações e avarias. O cliente descreve a casa no site, recebe um orçamento na hora e acompanha tudo numa aplicação própria. Paga a obra uma vez e, se tiver aparelhos inteligentes, uma mensalidade pelo serviço."));
c.push(p("A empresa já existe (Estação Nómada, Unipessoal Lda.) e a plataforma está publicada em opancas.pt. As obras começam em setembro de 2027, quando o gerente e os quatro eletricistas parceiros terminarem o curso e tiverem a habilitação profissional."));
c.push(tabela(["Indicador", "Valor (ano 1: set. 2027 a ago. 2028)"], [
  ["Investimento inicial", eur(arranqueTotal)],
  ["Obras previstas", `${ano.n} (de ${obrasMes[0]} para ${obrasMes[11]} por mês)`],
  ["Valor médio de uma obra", eur(ticket)],
  ["Vendas de obras", eur(ano.vendas)],
  ["Pago aos eletricistas parceiros", eur(pagoParceiros)],
  ["Casas com mensalidade no mês 12", String(subsFinal)],
  ["Ponto de equilíbrio", `${Math.ceil(pontoEquilibrio)} obras por mês`],
  ["Resultado do ano 1 (antes de impostos e do ordenado do gerente)", eur(resultadoAno)],
], [6, 3], { alinharDireita: [1] }));

// 2. Empresa
c.push(h1("2. Descrição da empresa"));
c.push(tabela(["", ""], [
  ["Empresa", "Estação Nómada, Unipessoal Lda. · NIF 519 588 533"],
  ["Marca", "Domus Energia"],
  ["Sede", "Rua 1.º de Maio, n.º 2, 2730-144 Barcarena (Oeiras)"],
  ["Sócio e gerente", "Rui Bragança (único sócio)"],
  ["Atividade", "Instalações elétricas e automação em habitações. Falta acrescentar o CAE 43210 (instalação elétrica) à empresa antes da primeira obra"],
  ["Zona", "Lisboa e até 100 km. Deslocação grátis até 20 km; depois 0,40 € por km"],
  ["Contactos", "opancas.pt · 968 728 723 (telefone e WhatsApp)"],
], [2.2, 6.8]));
c.push(h2("Da ideia ao negócio"));
c.push(tabela(["Fase", "O que significa", "Na Domus Energia"], [
  ["Ideia", "Ponto de partida: uma oportunidade que ainda precisa de ser estudada", "“Pedir um eletricista é lento e o preço é uma surpresa. Com um site que dá o orçamento na hora e aparelhos Wi-Fi baratos, posso fazer melhor.”"],
  ["Projeto", "A ideia estruturada e planeada: mercado, clientes, concorrência, recursos, custos, investimento, riscos, objetivos", "Este plano. A empresa está criada e a plataforma está publicada: simulador de orçamento, painel de gestão, área do eletricista e aplicação do cliente"],
  ["Negócio", "O projeto passa a atividade económica: clientes, receitas e resultados acompanhados", "A partir de setembro de 2027: primeiras obras pagas, parceiros a trabalhar, primeiras mensalidades"],
], [1.3, 3.5, 4.2]));
c.push(h2("Quem investe, quem gere, quem faz"));
c.push(p("O diapositivo 21 pede que o plano esclareça quem investe, quem gere e como se dividem as responsabilidades. Está decidido:"));
c.push(tabela(["Pergunta", "Resposta"], [
  ["Quem investe", `O sócio único, com capital próprio (${eur(arranqueTotal)})`],
  ["Quem gere", "O sócio único, como gerente"],
  ["Quem faz as obras", "Quatro eletricistas parceiros (colegas do curso), independentes, pagos por obra"],
  ["Como evolui", "Os melhores parceiros passam a contrato quando o volume de obras o permitir (ver secção 9)"],
], [2.5, 6.5]));
c.push(h2("Quem vai usar este plano"));
c.push(tabela(["Quem", "Para quê"], [
  ["Empreendedor (gerente)", "Estruturar a ideia, avaliar a viabilidade e definir a estratégia"],
  ["Eletricistas parceiros", "Saber o que se espera de cada um, como são pagos e para onde vai a empresa"],
  ["Bancos, IEFP e financiadores", "Perceber o investimento, como é usado e como seria reembolsado"],
  ["Parceiros comerciais e fornecedores", "Apresentar a empresa a mediadoras, gestores de alojamento local e armazenistas"],
  ["Contabilista e advogado", "Conhecer o modelo (obra + mensalidade, parceiros pagos por obra) para o enquadrar bem"],
], [3, 6]));

// 3. Serviço
c.push(h1("3. Produto ou serviço"));
c.push(p("O site tem duas entradas. Em “Descrever a casa” o cliente indica as divisões e o que quer em cada uma, e recebe o orçamento da casa inteligente. Em “Pedir um serviço” escolhe um trabalho concreto: avaria, quadro novo, carregador de carro, tomadas e pontos de luz."));
c.push(h2("Como se faz o preço"));
[
  `Cada artigo do catálogo tem um preço e um tempo de instalação. A mão de obra custa ${TARIFA} € por hora (com IVA).`,
  "O orçamento aparece logo no site, com um intervalo de 10 % para baixo e 20 % para cima. O valor final confirma-se na visita.",
  `Obra mínima de ${OBRA_MINIMA} €. Deslocação grátis até 20 km de Lisboa; depois 0,40 € por km, até 100 km.`,
  "O cliente paga 30 % de sinal quando aceita e 70 % no fim, depois de confirmar que está tudo a funcionar.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Cinco obras-tipo (exemplos feitos com o catálogo)"));
c.push(tabela(["Obra", "O que inclui", "Horas", "Preço c/ IVA", "Preço s/ IVA"],
  obras.map(o => [o.nome, o.linhas.map(([n, , , q]) => (q > 1 ? q + " × " : "") + n).join("; "), o.horas.toLocaleString("pt-PT") + " h", eur(o.com), eur(o.preco)]),
  [2, 4.4, 0.8, 1.2, 1.2], { alinharDireita: [2, 3, 4] }));
c.push(nota("São exemplos para as contas deste plano. Cada casa é diferente e o orçamento verdadeiro sai sempre do simulador."));
c.push(h2("Mensalidade (casas com aparelhos inteligentes)"));
c.push(tabela(["Plano mensal", "Inclui", "Preço c/ IVA", "Preço s/ IVA"],
  planos.map(pl => [pl.nome, pl.inclui, eur(pl.com, 2), eur(pl.sem, 2)]), [1.6, 5.4, 1.5, 1.5], { alinharDireita: [2, 3] }));
c.push(nota("Se o cliente deixar de pagar: 15 dias de aviso e depois modo básico. Os botões dos aparelhos continuam sempre a funcionar e a empresa nunca corta um circuito à distância. O cliente perde a aplicação, as automações e o alarme."));
c.push(h2("O que nos diferencia"));
[
  "Orçamento na hora, no site, sem esperar por uma visita para saber quanto custa.",
  "Plataforma própria: os aparelhos falam com o servidor da empresa e não com a nuvem do fabricante.",
  "Quem instala é eletricista: o quadro e os aparelhos inteligentes são feitos pela mesma equipa.",
  "Cada obra fica documentada: fotografias, valores dos ensaios e confirmação do cliente.",
  "O consumo vê-se por circuito, com alertas e um relatório da casa.",
  "Mensalidade baixa e sem fidelização.",
].forEach(t => c.push(bullet(t)));

// 4. Mercado
c.push(h1("4. Análise de mercado"));
[
  "A fatura da eletricidade pesa no orçamento das famílias. Saber quanto gasta cada circuito é o primeiro passo para poupar.",
  "Muitas casas têm quadros antigos, sem diferencial adequado nem proteção contra sobretensões. O site pergunta a idade do quadro e mostra ao cliente se é seguro.",
  "Os carros elétricos estão a crescer e quem compra um precisa de uma linha dedicada para o carregador.",
  "Os aparelhos Wi-Fi ficaram baratos: uma casa inteligente simples já não custa milhares de euros.",
  "Filhos que querem acompanhar os pais à distância e senhorios de alojamento local que querem controlar consumos entre estadias.",
].forEach(t => c.push(bullet(t)));
c.push(p("Preços de referência recolhidos em setembro de 2026: instalação de domótica a partir de cerca de 750 € e sistemas KNX a partir de cerca de 1 500 € (Zaask); alarme com central desde 37 € por mês com fidelização de 24 meses (Verisure). A casa inteligente tipo deste plano custa " + eur(obras[0].com) + " com IVA e a mensalidade vai de 4,99 € a 19,99 €."));
c.push(nota("Falta fazer antes do arranque: confirmar estes preços e contar quantos pedidos chegam pelo site durante a fase de preparação. É a melhor medida da procura real."));

// 5. Clientes
c.push(h1("5. Identificação de clientes"));
c.push(tabela(["Segmento", "Necessidade que resolvemos", "Obra típica"], [
  ["Famílias em casa própria", "Segurança do quadro, conforto e poupança na fatura", "Casa inteligente; quadro novo"],
  ["Donos de carro elétrico", "Carregar em casa com segurança e saber quanto gasta", "Carregador de carro"],
  ["Quem tem uma avaria ou precisa de um pequeno trabalho", "Resposta rápida e preço conhecido antes da visita", "Avaria; pequenas reparações"],
  ["Senhorios e alojamento local", "Controlar a casa à distância e o consumo por estadia", "Casa inteligente simples + mensalidade"],
  ["Idosos e familiares", "Aviso se não houver movimento de manhã ou se a porta abrir à noite", "Sensores + mensalidade Conforto"],
], [2.4, 3.8, 2.8]));
c.push(p("A empresa só contacta quem pediu um orçamento ou um serviço. Quem apenas registou a casa no site para ver o relatório não é contactado."));

// 6. Concorrência
c.push(h1("6. Análise da concorrência"));
c.push(tabela(["Concorrente", "O que oferece", "Pontos fortes", "Onde somos melhores"], [
  ["Eletricistas independentes e multisserviços", "Reparações e instalações", "Proximidade, preço da mão de obra", "Preço antes da visita, obra documentada, aplicação e mensalidade de apoio"],
  ["Plataformas de serviços (Zaask, Fixando)", "Ligam o cliente a vários profissionais", "Muita procura, várias propostas", "Preço imediato e uma só empresa responsável pelo trabalho"],
  ["Empresas de alarme (Verisure, Securitas Direct)", "Alarme com central de vigilância", "Marca forte, resposta 24 h", "Mensalidade muito mais baixa, sem 24 meses de fidelização; também eletricidade e poupança"],
  ["Integradores de domótica (KNX)", "Automação completa por cabo", "Muito fiável, projetos grandes", "Preço de entrada muito menor; instala-se sem obras em casas já feitas"],
  ["Montagem pelo próprio cliente (Tuya / Smart Life)", "Aparelhos baratos comprados e montados pelo cliente", "Barato e imediato", "Montagem segura no quadro por um eletricista; tudo numa só aplicação; apoio"],
], [2.3, 2.1, 2, 2.6]));
c.push(p("Posicionamento: entre a montagem pelo próprio cliente, barata mas arriscada no quadro elétrico, e o KNX ou a central de alarme, caros e com contratos longos."));

// 7. Marketing
c.push(h1("7. Estratégia de marketing e vendas"));
c.push(tabela(["Área", "O que fazemos"], [
  ["Produto", "Obras orçamentadas pelo simulador e 3 planos mensais simples. Relatório grátis da casa (“O seu quadro é seguro?”) como primeiro contacto"],
  ["Preço", `Tarifa conhecida (${TARIFA} € por hora com IVA) e preço por artigo no site. 1.º mês de mensalidade grátis; sem fidelização`],
  ["Distribuição", "Venda direta pelo site, telefone e WhatsApp. Parcerias com mediadoras, gestores de alojamento local e stands de carros elétricos"],
  ["Comunicação", "Ficha da empresa no Google com avaliações, fotografias das obras (antes e depois), vídeos curtos, folhetos nas zonas das obras, recomendação de clientes"],
], [2, 7]));
c.push(h2("Do contacto ao cliente"));
[
  "O cliente faz o orçamento no site ou liga. Resposta em menos de 24 horas.",
  "Visita de confirmação pelo eletricista da especialidade, se a obra o pedir.",
  "O cliente aceita e paga 30 % de sinal. Marca-se a obra e encomenda-se o material.",
  "Obra, ensaios, fotografias e confirmação do cliente. Paga os 70 % restantes.",
  "Contacto aos 7 e aos 30 dias; pedido de avaliação no Google e de recomendação.",
].forEach(t => c.push(num(t, "funil")));

// 8. Plano operacional
c.push(h1("8. Plano operacional"));
[
  "Atendimento: dias úteis das 9:00 às 18:00, por telefone, WhatsApp e site. Os alertas das casas chegam pela plataforma a qualquer hora.",
  "Distribuição das obras: cada pedido vai para a bolsa de trabalhos, primeiro para o eletricista da especialidade. Se não puder, passa ao suplente.",
  "Aparelhos: Wi-Fi, com marcação CE, preparados na bancada do gerente com programa próprio antes de irem para a obra. Material elétrico comum comprado no armazenista local.",
  "Qualidade: nenhuma obra fecha sem fotografias, valores dos ensaios, confirmação do cliente e aprovação do gerente no painel.",
  "Pagamentos: o cliente paga 30 % + 70 %. O eletricista recebe até 7 dias depois da aprovação, contra fatura-recibo.",
  "Segurança: o botão de cada aparelho funciona sempre, com ou sem internet. Trabalha-se sempre com a energia cortada e a ausência de tensão verificada.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Fase de preparação (outubro de 2026 a agosto de 2027)"));
c.push(p("Até ao fim do curso a empresa não faz obras em casa de clientes. Este tempo serve para chegar a setembro de 2027 com tudo pronto: plataforma testada, aparelhos escolhidos e experimentados na bancada, documentos legais, seguro, pagamentos pelo site e os quatro parceiros registados e a conhecer o sistema."));

// 9. Recursos humanos
c.push(h1("9. Recursos humanos e recursos da empresa"));
c.push(p("Uma empresa reúne e coordena recursos (Chiavenato e Drucker). As pessoas são o recurso central: são elas que usam e coordenam todos os outros."));
c.push(tabela(["Recurso", "O que é", "Na Domus Energia"], [
  ["Humanos", "Pessoas e as suas competências, conhecimentos e atitudes", "1 gerente e 4 eletricistas parceiros, cada um com a sua especialidade; contabilista e advogado externos"],
  ["Materiais", "Instalações, equipamentos, ferramentas e materiais", "Bancada de preparação, quadro de demonstração, stock de aparelhos. Os parceiros usam a sua ferramenta e viatura"],
  ["Financeiros", "Capital próprio, financiamentos e receitas", `${eur(arranqueTotal)} de capital próprio; receitas das obras e das mensalidades`],
  ["Tecnológicos", "Conhecimento técnico, sistemas, software e automatização", "Plataforma própria: site com simulador, painel de gestão (clientes, tarefas, emails, procedimentos, assistente), área do eletricista, aplicação do cliente e servidor"],
], [1.6, 3, 4.4]));
c.push(h2("Organização proposta"));
c.push(p("A empresa tem uma só pessoa nos quadros: o gerente. O trabalho divide-se em três áreas internas, que ficam com ele, e quatro especialidades técnicas, uma por parceiro."));
c.push(tabela(["Função", "Quem", "O que faz", "Quem substitui"], [
  ["Direção", "Gerente", "Estratégia, preços, compras, contas com o contabilista, aprovação final de cada obra", "Não tem: é o maior risco (secção 12)"],
  ["Sistemas e aparelhos", "Gerente", "Preparar e ativar os aparelhos na bancada, servidor, aplicação, apoio à distância", "Parceiro de casa inteligente (apoio no local)"],
  ["Atendimento e marcações", "Gerente", "Telefone, WhatsApp, pedidos do site, marcações, cobranças", "Assistente do painel e respostas preparadas"],
  ["Quadros e ensaios", "Parceiro 1", "Quadros novos e ampliações. Responsável pela revisão técnica: vê as fotografias e os ensaios das obras dos colegas", "Parceiro 4"],
  ["Casa inteligente", "Parceiro 2", "Disjuntores inteligentes, interruptores, estores, sensores; liga à aplicação e explica ao cliente", "Parceiro 3"],
  ["Avarias e reparações", "Parceiro 3", "Diagnóstico, avarias, tomadas, pontos de luz; resposta rápida", "Parceiro 2"],
  ["Carregadores e obras novas", "Parceiro 4", "Linhas dedicadas para carregadores e máquinas; segundo elemento nas obras de quadro. Revê as obras do parceiro 1", "Parceiro 1"],
], [2, 1.2, 4, 1.8]));
c.push(h2("Regras de funcionamento"));
[
  "Cada especialidade tem um responsável e um suplente. Nenhum trabalho fica parado por faltar uma pessoa.",
  "Quem faz a obra não é quem a revê. O parceiro 1 revê as obras dos colegas; o parceiro 4 revê as do parceiro 1. O gerente dá a aprovação final.",
  "O parceiro é independente: tem atividade aberta, seguro e ferramenta próprios, e é livre de aceitar ou recusar cada trabalho da bolsa.",
  "Pagamento: 70 % da mão de obra (sem IVA) e a deslocação, até 7 dias depois da aprovação. Os 30 % da empresa pagam o atendimento, a plataforma, o seguro e a garantia.",
  "Cada obra é avaliada (ensaios, fotografias, opinião do cliente). A classificação decide quem recebe primeiro os trabalhos seguintes.",
  "Reunião de 30 minutos à segunda-feira, por videochamada: obras da semana, material e problemas.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Carga de trabalho prevista no ano 1"));
c.push(tabela(["Especialidade", "Obras no ano", "Horas no ano", "Valor para o parceiro"],
  [...AREAS.map(a => [a, Math.round(obrasArea(a)), Math.round(horasArea(a)) + " h", eur(obras.filter(o => o.area === a).reduce((s, o) => s + o.parte * ano.n * o.custoMao, 0))]),
   total(["Total", ano.n, Math.round(horasMedias * ano.n) + " h", eur(pagoParceiros)])],
  [3.6, 1.6, 1.6, 2.2], { alinharDireita: [1, 2, 3] }));
c.push(nota("No ano 1 este trabalho é um complemento de rendimento para os parceiros, não um ordenado. As especialidades com menos obras (carregadores) ganham como segundo elemento nas obras de quadro e como suplentes."));
c.push(h2("De parceiro a contrato"));
c.push(p("Um parceiro passa a contrato quando, durante três meses seguidos, a empresa lhe der pelo menos 80 horas de trabalho por mês e a sua classificação for boa. Com 12 obras por mês isso ainda não acontece; é um objetivo do ano 2."));
c.push(h2("Quando o gerente deixa de chegar"));
c.push(p("O gerente acumula três áreas. Acima de 12 obras por mês, o atendimento e as marcações passam para uma pessoa a meio tempo, e a preparação dos aparelhos passa a ser feita também pelo parceiro de casa inteligente."));

// 10. Investimento
c.push(h1("10. Investimento necessário"));
c.push(p("A empresa já está criada e a plataforma já está feita, por isso não entram nesta conta. Os parceiros trabalham com ferramenta e viatura próprias."));
c.push(tabela(["Item", "Valor"], [...arranque.map(([a, v]) => [a, eur(v)]), total(["Total", eur(arranqueTotal)])], [7, 2], { alinharDireita: [1] }));
c.push(p("Financiamento: capital próprio do sócio. O sinal de 30 % de cada obra paga o material dessa obra, o que reduz a necessidade de dinheiro em caixa."));

// 11. Custos e previsões
c.push(h1("11. Custos e previsões financeiras"));
c.push(h2("Custo e despesa"));
c.push(p("Custo é o valor dos recursos consumidos para fazer o trabalho; despesa é a saída de dinheiro quando se paga. Exemplo: o stock inicial de aparelhos (900 €) é uma despesa no dia em que se compra, mas só passa a custo quando cada aparelho é montado numa obra. A bancada (350 €) é uma despesa única; o seu custo é o desgaste ao longo de cerca de 3 anos (perto de 10 € por mês)."));
c.push(h2("Classificação dos custos da Domus Energia"));
c.push(tabela(["Critério", "Tipo", "Exemplos na empresa"], [
  ["Relação com a obra", "Diretos", "Aparelhos e material de cada obra; pagamento ao eletricista parceiro por essa obra"],
  ["", "Indiretos", "Servidor, seguro, contabilista, telemóvel, marketing, desgaste da bancada"],
  ["Variação", "Fixos", `Servidor, seguro, contabilista, marketing de base (${eur(fixoTotal)} por mês, com ou sem obras)`],
  ["", "Variáveis", "Material, pagamento aos parceiros, deslocações, comissões dos pagamentos por cartão"],
  ["Momento", "Estimados", "Os valores deste plano e de cada orçamento do simulador"],
  ["", "Históricos", "Os custos reais de cada obra, registados no painel e comparados com o orçamento"],
], [2, 1.6, 5.4]));
const oC = obras[0], indireto = fixoTotal / (ano.n / 12);
c.push(h2(`Custo estimado de uma obra (${oC.nome}, ${eur(oC.preco)} sem IVA)`));
c.push(tabela(["Componente", "Tipo", "Valor"], [
  ["Aparelhos e material", "Direto · variável", eur(oC.custoMat)],
  ["Eletricista parceiro (70 % da mão de obra)", "Direto · variável", eur(oC.custoMao)],
  [`Parte dos custos fixos (÷ ${(ano.n / 12).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} obras por mês)`, "Indireto · fixo", eur(indireto)],
  total(["Custo total estimado", "", eur(oC.custoMat + oC.custoMao + indireto)]),
  total(["Resultado da obra", "", eur(oC.margem - indireto)]),
], [5, 2.2, 1.8], { alinharDireita: [2] }));
c.push(h2("Margem por tipo de obra"));
c.push(tabela(["Obra", "Parte das obras", "Preço s/ IVA", "Material", "Parceiro", "Fica na empresa"],
  [...obras.map(o => [o.curto, pct(o.parte), eur(o.preco), eur(o.custoMat), eur(o.custoMao), eur(o.margem)]),
   total(["Média", "100 %", eur(ticket), eur(media("custoMat")), eur(media("custoMao")), eur(margemMedia)])],
  [2.4, 1.4, 1.4, 1.2, 1.2, 1.4], { alinharDireita: [1, 2, 3, 4, 5] }));
c.push(nota("As avarias e as pequenas reparações deixam pouco dinheiro, mas trazem clientes novos e avaliações. As casas inteligentes e os quadros é que pagam a empresa."));
c.push(h2("Ponto de equilíbrio"));
c.push(p(`Cada obra deixa, em média, ${eur(margemMedia)} na empresa, depois de pagos o material e o parceiro. Os custos fixos são ${eur(fixoTotal)} por mês. A empresa precisa de ${fixoTotal} ÷ ${margemMedia.toFixed(0)} = ${pontoEquilibrio.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}, ou seja, ${Math.ceil(pontoEquilibrio)} obras por mês para não perder dinheiro. As mensalidades fazem este número descer ao longo do ano.`));
c.push(h2("Pressupostos"));
[
  `Tipos de obra: ${obras.map(o => pct(o.parte) + " " + o.curto.toLowerCase()).join(", ")}.`,
  "O material custa à empresa cerca de 60 % do preço de venda; da mão de obra, 70 % vão para o parceiro e 30 % ficam na empresa.",
  `Obras por mês: ${obrasMes.join(", ")} (total ${ano.n}).`,
  `Só as casas inteligentes e os quadros novos (${pct(parteCasas)} das obras) ficam com aparelhos ligados. Destas, 70 % subscrevem; mensalidade média de ${eur(mensalidadeMedia, 2)} sem IVA.`,
  "O gerente não tem ordenado fixo no ano 1. O resultado serve para o pagar e para reinvestir.",
  "A deslocação paga pelo cliente é entregue ao parceiro; não entra nas contas.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Custos fixos mensais"));
c.push(tabela(["Custo", "Por mês"], [...Object.entries(fixosMes).map(([a, v]) => [a, eur(v)]), total(["Total", eur(fixoTotal)])], [7, 2], { alinharDireita: [1] }));
c.push(h2("Previsão mensal"));
c.push(tabela(["Mês", "Obras", "Casas ligadas", "Vendas", "Margem das obras", "Mensalidades", "Custos fixos", "Resultado"],
  [...meses.map(m => [m.nome, m.n, m.casas, eur(m.vendas), eur(m.margem), eur(m.subs), eur(fixoTotal), eur(m.margem + m.subs - fixoTotal)]),
   total(["Ano 1", ano.n, casasFinal, eur(ano.vendas), eur(ano.margem), eur(ano.subs), eur(fixoTotal * 12), eur(resultadoAno)])],
  [1, 0.8, 1, 1.3, 1.4, 1.4, 1.2, 1.3], { alinharDireita: [1, 2, 3, 4, 5, 6, 7] }));
c.push(nota(`O resultado do ano 1 (${eur(resultadoAno)}) não chega para um ordenado completo do gerente. O negócio só o paga com mais obras por mês ou com mais casas a pagar mensalidade (${eur(mrrFinal)} por mês no mês 12). É esse o trabalho do ano 2.`));

// 12. Riscos
c.push(h1("12. Riscos e medidas de prevenção"));
c.push(tabela(["Risco", "Medida preventiva", "Alternativa se acontecer"], [
  ["Falta de clientes", "Ficha no Google com avaliações, relatório grátis da casa, parcerias com mediadoras e alojamento local", "Concentrar em avarias e reparações, que têm procura todo o ano"],
  ["Habilitação profissional atrasada", "Não marcar obras antes do fim do curso; confirmar na DGEG o que cada um pode assinar", "Adiar o mês 1; subcontratar um técnico responsável já habilitado"],
  ["Tudo depende do gerente", "Procedimentos escritos no painel, assistente, simulador que faz o orçamento sozinho", "Atendimento a meio tempo; parceiro de casa inteligente prepara aparelhos"],
  ["Parceiros sem disponibilidade", "Quatro parceiros com suplente em cada especialidade; trabalho pela bolsa", "Registar mais eletricistas na bolsa"],
  ["Parceiro tratado como trabalhador (falso recibo verde)", "Contrato de parceiro feito pelo advogado; liberdade de aceitar ou recusar; ferramenta e seguro próprios", "Passar a contrato de trabalho quando o volume o justificar"],
  ["Aparelho avaria ou perde a garantia do fabricante", "Só aparelhos com marcação CE, testados na bancada; stock de substituição; garantia dada pela empresa", "Trocar de modelo sem mudar a aplicação"],
  ["Obra mal feita", "Ensaios, fotografias, revisão por outro eletricista, aprovação do gerente; seguro de responsabilidade civil", "Correção gratuita; o parceiro desce na classificação"],
  ["Falha do servidor ou da internet do cliente", "Os botões funcionam sempre; cópias de segurança diárias", "Central em casa do cliente (plano Premium, fase seguinte)"],
  ["Aumento dos custos do material", "Orçamentos válidos 30 dias; preços do catálogo revistos todos os trimestres", "Ajustar a margem do material"],
  ["Clientes cancelam a mensalidade", "Valor à vista: consumo, alertas, relatório", "Plano Base barato; perguntar porquê"],
], [2.4, 3.6, 3]));
c.push(h2("Apoios a considerar"));
c.push(p("Se o capital próprio não chegar: apoios do IEFP à criação de emprego, microcrédito e avisos do Portugal 2030. As condições mudam; confirmar no IEFP e com o contabilista."));

// 13. Objetivos
c.push(h1("13. Objetivos e resultados esperados"));
c.push(tabela(["Objetivo (ano 1)", "Meta"], [
  ["Número de clientes", `${ano.n} obras; ${subsFinal} casas com mensalidade em agosto de 2028`],
  ["Volume de vendas", eur(ano.vendas) + " em obras"],
  ["Prazo para o ponto de equilíbrio", `Desde o 1.º mês, com pelo menos ${Math.ceil(pontoEquilibrio)} obras por mês`],
  ["Equipa", "1 gerente e 4 parceiros ativos, todos com pelo menos 1 obra por mês a partir de janeiro de 2028"],
  ["Satisfação dos clientes", "Pelo menos 90 % satisfeitos no contacto dos 30 dias; média de 4,5 em 5 no Google"],
], [4, 5]));
c.push(p("Os objetivos estão escritos na forma SMART na Parte III (III.5), com o exercício de objetivo vago para SMART e a relação entre atividade e resultado (III.6)."));

// 14. Decisão
c.push(h1("14. O plano como instrumento de decisão"));
c.push(p("O plano não elimina a incerteza, mas reduz as decisões tomadas só por intuição. Exemplo, no formato do diapositivo 26: como ter eletricistas no primeiro ano."));
c.push(tabela(["Critério", "Eletricistas com contrato", "Parceiros pagos por obra"], [
  ["Investimento inicial", "Viatura, ferramenta e fardamento para cada um", "Nenhum: usam os seus"],
  ["Custos fixos", "Quatro ordenados e encargos todos os meses, com ou sem obras", "Nenhum: 70 % da mão de obra, só quando há obra"],
  ["Capacidade", "Fixa: sobra ou falta", "Ajusta-se ao número de obras"],
  ["Controlo da qualidade", "Direto, no dia a dia", "Por registo: fotografias, ensaios, revisão e aprovação"],
  ["Risco", "Alto se faltarem obras", "Baixo para a empresa; o parceiro pode não estar disponível"],
  ["Decisão", "A partir do ano 2, para os melhores", "Ano 1"],
], [2.4, 3.3, 3.3]));
c.push(quebra());

// ================= PARTE II =================
c.push(parteTitulo("PARTE II: PLANO DE AÇÃO"));
c.push(h1("15. Plano de ação"));
c.push(p("O plano de ação transforma os objetivos em tarefas concretas. Cada ação responde a: O quê? Porquê? Quem? Quando? Como? Quanto? Como sabemos se resultou?"));
c.push(h2("Preparação (outubro de 2026 a agosto de 2027)"));
c.push(tabela(["O quê", "Porquê", "Quem", "Quando", "Como", "Quanto", "Como sabemos se resultou"], [
  ["Testar os aparelhos na bancada", "Só instalar o que foi experimentado", "Gerente", "Até dez. 2026", "Preparar e medir cada modelo", "350 € de bancada", "Lista de modelos aprovados, com guia de preparação"],
  ["Documentos legais", "Vender e contratar com segurança", "Gerente + advogado", "Até mar. 2027", "Condições, contrato de parceiro, dados pessoais", "600 €", "Documentos publicados no site e assinados pelos 4 parceiros"],
  ["Acrescentar o CAE 43210", "Poder faturar instalações elétricas", "Gerente + contabilista", "Até mar. 2027", "Alteração de atividade nas Finanças", "Sem custo", "CAE na certidão da empresa"],
  ["Seguro de responsabilidade civil", "Proteger clientes e empresa", "Gerente", "Jul. 2027", "3 propostas", "480 € por ano", "Apólice ativa antes da 1.ª obra"],
  ["Pagamentos pelo site", "Cobrar sinal e mensalidades", "Gerente", "Até jun. 2027", "Conta de pagamentos + programa de faturação certificado", "Comissão por pagamento", "Um pagamento de teste com fatura emitida"],
  ["Registar e treinar os 4 parceiros", "Saberem usar a área do eletricista", "Gerente", "Mai. a jul. 2027", "Uma obra simulada por especialidade", "Tempo", "4 obras simuladas aprovadas no painel"],
  ["Habilitação profissional", "Poder assinar instalações", "Os 5", "Ago. 2027", "Fim do curso e inscrição na DGEG", "Taxas de inscrição", "Os 5 habilitados"],
], [1.6, 1.4, 1, 0.9, 1.5, 1, 1.8]));
c.push(h2("Arranque (setembro a novembro de 2027)"));
c.push(tabela(["O quê", "Porquê", "Quem", "Quando", "Como", "Quanto", "Como sabemos se resultou"], [
  ["Lançamento", "Primeiros pedidos", "Gerente", "Set. 2027", "Ficha no Google, anúncios locais, folhetos", "800 €", "Pelo menos 15 pedidos de orçamento em setembro"],
  ["Primeiras 4 obras, uma por especialidade", "Provar o serviço e ter fotografias", "Cada parceiro", "Set. 2027", "Bolsa de trabalhos", "Material pago pelo sinal", "4 obras aprovadas e 4 avaliações no Google"],
  ["Contactar parcerias", "Canal de vendas estável", "Gerente", "Todas as semanas", "10 contactos por semana", "Tempo", "2 obras por mês vindas de parceiros a partir de dez. 2027"],
  ["Revisão mensal das contas", "Comparar o previsto com o real", "Gerente + contabilista", "Dia 5 de cada mês", "Quadro da secção 11 com valores reais", "Incluído", "Desvio conhecido e explicado todos os meses"],
], [1.6, 1.4, 1, 0.9, 1.5, 1, 1.8]));
c.push(quebra());

// ================= PARTE III =================
c.push(parteTitulo("PARTE III: ORGANIZAÇÃO DO TRABALHO"));
c.push(p("Tópicos da parte 1 do módulo (Planeamento, organização e conceito de negócio), aplicados à empresa."));

c.push(h1("III.1 Planeamento e organização do trabalho"));
c.push(p("Planear e organizar é saber o que fazer, quando, como e por que ordem. Numa empresa de obras, isto evita deslocações perdidas, material esquecido e clientes à espera. As funções de cada pessoa estão na secção 9."));
c.push(h2("Semana tipo do gerente"));
c.push(tabela(["Dia", "Manhã", "Tarde"], [
  ["Segunda", "Reunião com os parceiros (30 min): obras da semana, material, problemas", "Compras e encomendas de material"],
  ["Terça e quinta", "Bancada: preparar e ativar os aparelhos das obras da semana", "Aprovar obras concluídas; pagamentos aos parceiros"],
  ["Quarta", "Parcerias e marketing (10 contactos)", "Sistema: atualizações, cópias de segurança, saúde dos aparelhos"],
  ["Sexta", "Contas da semana: obras, cobranças, custos reais", "Revisão semanal (III.2) e plano da semana seguinte"],
  ["Todos os dias", "Ver o plano do dia antes do email e do WhatsApp", "Atendimento em três blocos: 9:30, 13:00 e 17:30"],
], [1.6, 4, 3.4]));
c.push(h2("Uma pessoa organizada, aplicado à empresa"));
c.push(tabela(["O módulo diz", "Na Domus Energia"], [
  ["Mantém as tarefas identificadas e registadas", "Cada pedido e cada obra têm tarefas no painel; nada fica só na cabeça"],
  ["Organiza documentos e informação", "Ficha por cliente com orçamento, fotografias, ensaios e conversa"],
  ["Define o que precisa de ser feito", "Plano do dia visto antes do email e do WhatsApp"],
  ["Evita acumular tarefas desnecessariamente", "Respostas preparadas para as perguntas de sempre; revisão semanal limpa o que ficou pendente"],
  ["Mantém o espaço e os instrumentos organizados", "Bancada arrumada por obra: uma caixa etiquetada com os aparelhos já preparados de cada cliente"],
], [4, 5]));
c.push(h2("Ferramentas de organização"));
[
  "Painel de gestão: clientes, pedidos, tarefas, emails automáticos e procedimentos escritos.",
  "Bolsa de trabalhos e área do eletricista: cada parceiro vê as suas obras, o material e o que tem de fotografar e medir.",
  "Agenda partilhada com as obras marcadas.",
  "Uma caixa por obra na bancada, com os aparelhos preparados e a lista de material.",
].forEach(t => c.push(bullet(t)));

c.push(h1("III.2 Gestão do tempo"));
c.push(p("Gerir o tempo é usar bem o tempo que temos. Aplicamos o ciclo Planeamento, Execução, Verificação e Ajuste a cada semana e a cada obra."));
c.push(tabela(["Fase", "Na Domus Energia"], [
  ["Planeamento", "Segunda: obras da semana. O tempo de cada obra vem do catálogo (horas por artigo), com 30 % de folga para imprevistos"],
  ["Execução", "O parceiro segue a lista da obra na área do eletricista; o gerente trata do telefone, para o parceiro não ser interrompido"],
  ["Verificação", "No fim: ensaios, fotografias e teste de cada circuito com o cliente; horas reais registadas"],
  ["Ajuste", "Sexta: comparar as horas reais com as do catálogo e corrigir os tempos dos artigos que falharam"],
], [2, 7]));
c.push(h2("Revisão semanal (sexta-feira, 20 minutos)"));
["O que consegui realizar?", "O que ficou pendente e porquê?", "O que me fez perder tempo (deslocações, material em falta, esperas)?", "O que vou fazer de forma diferente na próxima semana?"].forEach(t => c.push(bullet(t)));

c.push(h1("III.3 Definição de prioridades"));
c.push(p("Nem todas as tarefas têm a mesma importância ou urgência. Usamos a matriz de quatro categorias. Estar ocupado não significa estar a ser produtivo."));
c.push(tabela(["", "Urgente", "Não urgente"], [
  ["Importante", "FAZER PRIMEIRO: cliente sem luz; avaria numa casa onde trabalhámos; sistema em baixo; obra marcada para hoje", "PLANEAR: habilitação profissional; documentos legais; seguro; treino dos parceiros; parcerias"],
  ["Pouco importante", "DELEGAR: perguntas de sempre (respostas preparadas e assistente); encomendas de rotina", "FAZER DEPOIS: mudar o aspeto do site; experimentar aparelhos novos por curiosidade; redes sociais sem plano"],
], [1.6, 3.7, 3.7]));

c.push(h1("III.4 Planeamento de tarefas"));
c.push(p("Planear é definir antecipadamente as ações, métodos, tempos e recursos para atingir um objetivo. Cada tarefa responde a O quê? Quem? Quando? Como? Porquê? O plano completo está na Parte II; aqui fica uma tarefa em detalhe."));
c.push(tabela(["Pergunta", "Tarefa: treinar os 4 parceiros na área do eletricista"], [
  ["O quê?", "Cada parceiro faz uma obra simulada da sua especialidade, do pedido à aprovação"],
  ["Quem?", "Gerente (prepara e aprova); cada parceiro (executa)"],
  ["Quando?", "Maio a julho de 2027, um parceiro de 3 em 3 semanas"],
  ["Como?", "Quadro de demonstração, telemóvel do parceiro, lista da obra, fotografias e ensaios"],
  ["Porquê?", "Em setembro ninguém aprende o sistema em casa do cliente"],
], [2, 7]));
c.push(h2("Funções do planeamento na empresa"));
c.push(tabela(["Função", "Exemplo na Domus Energia"], [
  ["Organização: estruturar as atividades de forma lógica", "Obras agrupadas por zona e por especialidade, para reduzir deslocações"],
  ["Previsão: antecipar necessidades e dificuldades", "Material encomendado quando o cliente paga o sinal; 30 % de folga no tempo"],
  ["Coordenação: articular tarefas e pessoas", "O gerente prepara os aparelhos na véspera; no quadro novo, o parceiro 1 monta e o parceiro 4 ajuda"],
  ["Controlo: comparar o previsto com o realizado", "Horas e material reais de cada obra comparados com o orçamento, à sexta"],
], [4, 5]));
c.push(tabela(["Com planeamento", "Sem planeamento"], [
  ["Aparelhos preparados e testados antes da obra", "Aparelho que não liga em casa do cliente"],
  ["Prazos cumpridos", "Clientes à espera e obras remarcadas"],
  ["Menos custos (deslocações, horas)", "Voltar ao armazenista a meio da obra"],
  ["Obras com mais qualidade e segurança", "Atrasos e orçamentos que derrapam"],
], [4.5, 4.5]));
c.push(h2("Exemplo do módulo: preparar a reunião semanal"));
[
  "Definir o objetivo: obras e prioridades da semana.",
  "Identificar os participantes: gerente e os 4 parceiros.",
  "Preparar a agenda: obras, material, problemas de clientes, objetivos.",
  "Reunir a informação: pedidos aceites, obras por aprovar, alertas das casas.",
  "Enviar a convocatória: fixa, segunda às 8:30, 30 minutos, por videochamada.",
  "Preparar os materiais: lista de obras e de material por obra.",
  "Realizar a reunião, a cumprir o horário.",
  "Registar decisões e tarefas (quem faz o quê e até quando).",
  "Acompanhar as ações na reunião seguinte.",
].forEach(t => c.push(num(t, "reuniao")));
c.push(h2("Sequência de uma obra"));
c.push(p("Uma sequência mal definida origina retrabalho, perda de tempo e riscos de segurança. A ordem é sempre:"));
[
  "Pedido no site ou por telefone; orçamento do simulador; resposta em 24 horas.",
  "Visita de confirmação, se for precisa; o cliente aceita e paga o sinal.",
  "O gerente encomenda o material e prepara os aparelhos na bancada.",
  "No local: cortar a energia, verificar a ausência de tensão, instalar.",
  "Religar, fazer os ensaios, testar cada circuito e o que acontece depois de um corte de luz.",
  "Ligar os aparelhos ao Wi-Fi e ao servidor; instalar a aplicação no telemóvel do cliente e explicar.",
  "Fotografias e valores na área do eletricista; o cliente confirma; revisão por outro eletricista.",
  "O gerente aprova; o cliente paga o resto; o parceiro recebe em 7 dias.",
  "Contacto aos 7 e aos 30 dias.",
].forEach(t => c.push(num(t)));
c.push(quebra());

c.push(h1("III.5 Objetivos e resultados (SMART)"));
c.push(p("Um objetivo tem de ser específico, mensurável, atingível, relevante e com prazo. “Quero ter muitos clientes” é um desejo. Os objetivos da Domus Energia são:"));
c.push(tabela(["Objetivo SMART", "S", "M", "A", "R", "T"], [
  [`Concluir ${ano.n} obras até 31 de agosto de 2028, subindo de ${obrasMes[0]} para ${obrasMes[11]} por mês`, "Obras aprovadas no painel", `${ano.n} no ano`, "4 parceiros com suplentes", "É a principal receita", "31 ago. 2028"],
  [`Ter ${subsFinal} casas com mensalidade ativa em agosto de 2028`, "Subscrições ativas", `${subsFinal} casas`, "1.º mês grátis em cada casa ligada", "Receita que se repete", "Ago. 2028"],
  ["Os 5 com habilitação profissional até 31 de agosto de 2027", "Habilitação de cada um", "5 em 5", "Fim do curso", "Sem ela não há obras", "31 ago. 2027"],
  ["Pelo menos 90 % de clientes satisfeitos no contacto dos 30 dias", "Resposta do cliente", "≥ 90 %", "Ensaios, revisão e acompanhamento", "Avaliações e recomendações", "Todos os trimestres"],
  ["Responder a 95 % dos pedidos em menos de 24 horas", "Tempo de resposta", "< 24 h em 95 %", "Simulador e respostas preparadas", "Não perder clientes", "Desde set. 2027"],
], [3.4, 1.4, 1.4, 1.4, 1.4, 1]));
c.push(h2("Exercício do módulo: de objetivo vago a SMART"));
c.push(tabela(["Objetivo vago", "Objetivo SMART na Domus Energia"], [
  ["Conseguir mais clientes", "Receber 2 obras por mês vindas de parcerias a partir de dezembro de 2027, com 3 mediadoras e 5 gestores de alojamento local"],
  ["Melhorar a presença nas redes sociais", "Publicar as fotografias de antes e depois de 1 obra por semana e chegar a 20 avaliações no Google até fevereiro de 2028"],
  ["Melhorar o atendimento ao cliente", "Responder a 95 % dos pedidos em menos de 24 horas a partir de setembro de 2027"],
  ["Reduzir os custos da empresa", "Baixar o custo do material de 60 % para 55 % do preço de venda até junho de 2028, comprando em quantidade os 5 artigos mais usados"],
  ["Aumentar a produtividade", `Baixar o tempo da casa inteligente tipo de ${obras[0].horas.toLocaleString("pt-PT")} h para 7 h até maio de 2028, com os aparelhos preparados na bancada`],
  ["Fazer reuniões mais eficazes", "Reunião semanal de 30 minutos com agenda fixa; todas as decisões registadas com responsável e prazo"],
], [3, 6]));

c.push(h1("III.6 Trabalho e orientação para resultados"));
c.push(p("Atividade é o que fazemos; resultado é o que conseguimos. O número de tarefas feitas não garante produtividade: medimos o resultado de cada atividade."));
c.push(p("Quem está orientado para resultados:"));
["Compreende o objetivo de cada obra (o que o cliente quer resolver).", "Encontra soluções em vez de só apontar problemas.", "Cumpre os compromissos de hora e de prazo.", "Assume a responsabilidade pelo seu trabalho.", "Avalia o trabalho feito (teste final com o cliente).", "Procura melhorar continuamente (revisão semanal)."].forEach(t => c.push(bullet(t)));
c.push(tabela(["Atividade", "Resultado esperado"], [
  ["Contactar 10 mediadoras ou gestores de alojamento local por semana", "2 obras por mês vindas de parcerias"],
  ["Pedir avaliação no Google no contacto dos 7 dias", "20 avaliações até fevereiro de 2028"],
  ["Reunião de 30 minutos à segunda", "Nenhuma obra remarcada por falta de material"],
  ["Ensaios, fotografias e revisão por outro eletricista", "Menos de 5 % de visitas de correção"],
  ["Preparar os aparelhos na bancada na véspera", "Casa inteligente tipo em 7 horas"],
  ["Contacto aos 30 dias", "90 % de satisfeitos e 1 recomendação em cada 3 clientes"],
  ["Ver todos os dias a saúde dos aparelhos", "80 % dos problemas resolvidos à distância"],
], [5, 4]));
c.push(quebra());

c.push(h1("III.7 Proatividade"));
c.push(p("Ser proativo é antecipar, tomar a iniciativa e procurar soluções antes de o problema aparecer. O sistema foi desenhado para isto: avisa quando um aparelho deixa de responder e quando o consumo sobe."));
c.push(tabela(["Situação", "Atitude reativa", "Atitude proativa (Domus Energia)"], [
  ["Aparelho deixa de responder", "“O cliente ainda não ligou”", "O painel mostra-o; ligamos ao cliente no mesmo dia"],
  ["Consumo anormal num circuito", "Ninguém olha para os gráficos", "Alerta de consumo; sugerimos verificar o aparelho"],
  ["Quadro antigo numa visita de avaria", "Reparar e sair", "Mostrar ao cliente o que não é seguro e deixar o orçamento do quadro"],
  ["Material em falta numa obra", "“Ninguém disse que era preciso”", "Caixa da obra preparada na véspera, com a lista do orçamento"],
  ["Mensalidade em atraso", "Suspender sem aviso", "Aviso simpático, plano mais barato como alternativa, modo básico só aos 15 dias"],
], [2.4, 3, 3.6]));
c.push(p("Os 4 passos da proatividade na empresa: Observar (painel e contactos com clientes), Antecipar (“se nada for feito, o que acontece?”), Agir (contactar, corrigir, melhorar o procedimento) e Avaliar (funcionou? regista-se na revisão semanal)."));
c.push(tabela(["O que NÃO é proatividade", "O que É proatividade"], [
  ["Mexer num quadro sem avaliar as consequências", "Antecipar: ver o quadro na visita, antes da obra"],
  ["Resolver sozinho um problema que devia ser comunicado", "Comunicar: avisar logo o gerente e propor uma solução"],
  ["Trabalhar mais horas só para mostrar empenho", "Tomar iniciativa com método: preparar o material na véspera"],
  ["Interferir no trabalho dos colegas", "Procurar soluções e assumir a responsabilidade da sua parte"],
  ["Decidir o que ultrapassa a sua função (por exemplo, dar descontos)", "Agir de forma consciente e adequada à sua função"],
], [4.5, 4.5]));

c.push(h1("III.8 Capacidade de decisão"));
c.push(p("Usamos o processo de 7 passos: identificar o problema, reunir informação, identificar alternativas, avaliar consequências e riscos, escolher, agir e avaliar o resultado. Duas decisões já tomadas:"));
c.push(tabela(["Passo", "Decisão A: aparelhos", "Decisão B: quem faz as obras"], [
  ["1. Problema", "Que aparelhos instalar em casa dos clientes", "A empresa não pode pagar quatro ordenados no arranque"],
  ["2. Informação", "Preços, marcação CE, ensaios na bancada, dependência da nuvem do fabricante", "Custos de um contrato; modelo das plataformas de serviços; opinião do contabilista"],
  ["3. Alternativas", "Marca europeia cara; aparelhos Wi-Fi económicos com programa próprio; sistemas por cabo", "Contratar; subcontratar a outra empresa; parceiros pagos por obra"],
  ["4. Riscos", "Cara: orçamentos altos. Económica: perde-se a garantia do fabricante", "Contrato: custo fixo. Parceiros: disponibilidade e enquadramento legal"],
  ["5. Escolha", "Aparelhos Wi-Fi económicos, com marcação CE, preparados e testados na bancada; garantia dada pela empresa", "Parceiros pagos por obra no ano 1; contrato para os melhores depois"],
  ["6. Agir", "Bancada montada; lista de modelos aprovados", "Bolsa de trabalhos e área do eletricista já feitas; contrato de parceiro com o advogado"],
  ["7. Avaliar", "Avarias e trocas por modelo, todos os meses", "Aos 6 meses: obras recusadas, classificações, custo por obra"],
], [1.6, 3.7, 3.7]));
c.push(h2("Da decisão à ação (passo 6) e avaliação (passo 7)"));
c.push(p("Uma decisão constantemente adiada deixa de cumprir a sua função. Para a decisão B:"));
c.push(tabela(["Pergunta", "Resposta"], [
  ["O que vai ser feito?", "Contrato de parceiro escrito e assinado pelos 4 eletricistas"],
  ["Quem é responsável?", "Gerente, com o advogado"],
  ["Quando?", "Até março de 2027"],
  ["Que recursos?", "Parte dos 600 € de documentos legais"],
  ["Como é acompanhado?", "Classificação e número de obras por parceiro, vistos todos os meses"],
], [3, 6]));
c.push(p("Ao fim de 6 meses fazemos as perguntas de avaliação do módulo: a decisão resolveu o problema? O resultado foi o esperado? O que correu bem? O que poderia ter sido diferente?"));
c.push(quebra());

// Próximos passos e anexos
c.push(h1("Próximos passos (próximos 90 dias)"));
[
  "Montar a bancada e testar os primeiros aparelhos.",
  "Marcar a reunião com o advogado (condições, contrato de parceiro, dados pessoais).",
  "Pedir ao contabilista para acrescentar o CAE 43210.",
  "Apresentar este plano aos quatro colegas e confirmar a especialidade de cada um.",
  "Confirmar na DGEG o que cada um pode assinar depois do curso.",
].forEach(t => c.push(num(t, "passos")));

c.push(h1("Anexo A: Atividade de grupo, ideia de negócio"));
c.push(tabela(["Pergunta", "Resposta", "Fase"], [
  ["Qual é a ideia?", "Eletricidade e casa inteligente com orçamento na hora, feitas por eletricistas e ligadas a uma plataforma própria", "Ideia"],
  ["Que necessidade resolve?", "Saber o preço antes da visita, ter um quadro seguro, gastar menos eletricidade e controlar a casa à distância", "Ideia"],
  ["Quem são os clientes?", "Famílias em casa própria, donos de carro elétrico, quem tem uma avaria, senhorios e alojamento local, idosos e familiares", "Ideia"],
  ["Que produto ou serviço será vendido?", `Obras (de ${eur(obras[4].com)} a ${eur(obras[1].com)} com IVA nas obras-tipo) e mensalidades (4,99 € a 19,99 €)`, "Projeto"],
  ["Quem são os concorrentes?", "Eletricistas independentes, plataformas de serviços, empresas de alarme, integradores KNX, montagem pelo próprio cliente", "Projeto"],
  ["Que recursos são necessários?", `Humanos (gerente + 4 parceiros), materiais (bancada, stock), financeiros (${eur(arranqueTotal)}), tecnológicos (plataforma própria)`, "Projeto"],
  ["Qual o investimento inicial?", eur(arranqueTotal), "Projeto"],
  ["Como serão obtidas receitas?", "Obras (pagamento único, 30 % + 70 %) e mensalidades (todos os meses)", "Projeto"],
  ["Quais os principais riscos?", "Falta de clientes, habilitação atrasada, tudo depender do gerente, disponibilidade dos parceiros (secção 12)", "Projeto"],
  ["Qual a primeira ação a realizar?", "Montar a bancada e testar os aparelhos; depois os documentos legais", "Negócio"],
], [2.4, 5.4, 1.2]));

c.push(h1("Anexo B: Correspondência com o módulo 7855"));
c.push(tabela(["Tópico do módulo", "Onde está no plano"], [
  ["P2 · O que é e para que serve um plano de ação (O quê, Porquê, Quem, Quando, Como, Quanto, Indicador)", "Parte II, secção 15"],
  ["P2 · Plano de negócio: resumo, empresa, serviço, mercado, clientes, concorrência, marketing, operações, RH, investimento, previsões, riscos, objetivos", "Parte I, secções 1 a 13"],
  ["P2 · Para que serve: estruturar, avaliar a viabilidade, definir objetivos, planear recursos, antecipar riscos", "1, 11, 13, 9, 12"],
  ["P2 · Recursos humanos, materiais, financeiros, tecnológicos", "9"],
  ["P2 · Quem utiliza um plano de negócio", "2"],
  ["P2 · Plano de negócio como instrumento de decisão", "14"],
  ["P2 · Custos: custo e despesa; diretos e indiretos; fixos e variáveis; históricos e estimados", "11"],
  ["P2 · Diferença entre ideia, projeto e negócio; atividade de grupo", "2; Anexo A"],
  ["P1 · Organização pessoal do trabalho", "III.1"],
  ["P1 · Gestão do tempo", "III.2"],
  ["P1 · Definição de prioridades", "III.3"],
  ["P1 · Planeamento de tarefas", "III.4"],
  ["P1 · Objetivos e resultados (SMART)", "III.5"],
  ["P1 · Trabalho e orientação para resultados", "III.6"],
  ["P1 · Proatividade", "III.7"],
  ["P1 · Capacidade de decisão", "III.8"],
], [6, 3]));

// ---------- Documento ----------
const doc = new Document({
  creator: "Domus Energia",
  title: "Plano de Negócio — Domus Energia",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: FLORESTA } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: MUSGO }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: "BC6C25" }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: "pontos", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      { reference: "numeros", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "reuniao", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "funil", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "passos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Domus Energia · Plano de Negócio", size: 16, color: "5C6446" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], size: 16, color: "5C6446" })] })] }) },
    children: c,
  }],
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync("Plano_de_Negocio_Domus_Energia.docx", b);
  console.log("ok", { ticket, mensalidadeMedia: mensalidadeMedia.toFixed(2), ano, resultadoAno, mrrFinal, arranqueTotal });
});
