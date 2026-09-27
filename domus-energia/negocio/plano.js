const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, LevelFormat, BorderStyle, PageBreak, Footer, PageNumber,
  TableOfContents, Header,
} = require("docx");

// ---------- Paleta (tema Terra) ----------
const MUSGO = "606C38", FLORESTA = "283618", AREIA_CLARA = "F4EFD2", MUSGO_CLARO = "EEF0D9";
const eur = (v, d = 0) => v.toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";

// ---------- Contas (todos os valores sem IVA) ----------
const IVA = 1.23;
const planos = [
  { nome: "Base", com: 4.99, inclui: "App e área de cliente, controlo à distância, automações e cenas, histórico" },
  { nome: "Conforto", com: 9.99, inclui: "Tudo do Base + modos e alarme, notificações, relatórios de energia, saúde dos aparelhos" },
  { nome: "Segurança Premium", com: 19.99, inclui: "Tudo do Conforto + Raspberry Pi em casa (funciona sem internet), sirene, suporte prioritário" },
];
planos.forEach(p => (p.sem = p.com / IVA));

const kits = [
  { nome: "Essencial", preco: 390, equip: 180, horas: 3, desc: "Quadro inteligente com 4 circuitos medidos, configuração da app" },
  { nome: "Conforto", preco: 890, equip: 420, horas: 7, desc: "Essencial + 4 interruptores de parede, 2 sensores (porta/movimento), 1 estore" },
  { nome: "Segurança Premium", preco: 1490, equip: 700, horas: 10, desc: "Conforto + Raspberry Pi com UPS, sirene, 4 sensores extra" },
];
// mistura de vendas no ano 1
const mix = { Essencial: 0.5, Conforto: 0.35, "Segurança Premium": 0.15 };
const ticket = kits.reduce((s, k) => s + mix[k.nome] * k.preco, 0);
const equipMedio = kits.reduce((s, k) => s + mix[k.nome] * k.equip, 0);
const custoEquip = 0.72; // custo de compra ≈ 72 % do preço de venda do equipamento
const pagaTecnicos = 0.6; // 60 % da mão de obra vai para os técnicos

const instalacoesMes = [2, 2, 2, 4, 4, 4, 6, 6, 6, 6, 6, 6];
const subscreve = 0.7;
const mensalidadeMedia = (0.45 * planos[0].sem + 0.4 * planos[1].sem + 0.15 * planos[2].sem);
let acumulados = 0;
const meses = instalacoesMes.map((n, i) => {
  acumulados += n;
  const vendas = n * ticket;
  const equipVendido = n * equipMedio;
  const maoObra = vendas - equipVendido;
  const margem = equipVendido * (1 - custoEquip) + maoObra * (1 - pagaTecnicos);
  const subs = Math.round(acumulados * subscreve) * mensalidadeMedia;
  return { mes: i + 1, n, acumulados, vendas, margem, subs };
});
const fixosMes = { "Servidor VPS (Hetzner) + domínio + email": 15, "Contabilista certificado": 100, "Seguro de responsabilidade civil": 35, "Combustível e telemóveis": 250, "Marketing (anúncios, Google, flyers)": 100, "Comissões Stripe e software": 10 };
const fixoTotal = Object.values(fixosMes).reduce((a, b) => a + b, 0);
const ano = meses.reduce((t, m) => ({ n: t.n + m.n, vendas: t.vendas + m.vendas, margem: t.margem + m.margem, subs: t.subs + m.subs }), { n: 0, vendas: 0, margem: 0, subs: 0 });
const resultadoAno = ano.margem + ano.subs - fixoTotal * 12;
const mrrFinal = meses[11].subs;

const arranque = [
  ["Constituição da empresa (Empresa na Hora)", 360],
  ["Ferramentas, multímetro/testador, EPI", 1200],
  ["Stock inicial (kit de demonstração + 2 kits Essencial)", 1300],
  ["Seguro de responsabilidade civil (1.º ano)", 420],
  ["Marketing de lançamento (logótipo, cartões, flyers, anúncios)", 600],
  ["Servidor VPS, domínio e email (1.º ano)", 180],
  ["Fundo de reserva (imprevistos, 1–2 meses de custos)", 940],
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

// Capa
c.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: "DOMUS ENERGIA", bold: true, size: 56, color: MUSGO })] }));
c.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: "Eletricidade e automação residencial", size: 30, color: FLORESTA })] }));
c.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "DDA15E", space: 4 } }, children: [] }));
c.push(new Paragraph({ spacing: { before: 400, after: 120 }, children: [new TextRun({ text: "Plano de Negócio", bold: true, size: 40, color: FLORESTA })] }));
c.push(p("Estruturado segundo o módulo 7855 – Plano de negócio, criação de pequenos e médios negócios (formador: Luís Santos): parte 1 (Planeamento, organização e conceito de negócio) e parte 2 (Plano de ação e plano de negócio).", { run: { size: 22 } }));
c.push(p("Zona inicial: Grande Lisboa · Ano 1 · Versão setembro de 2026", { spacing: { before: 400 }, run: { size: 20, color: "5C6446" } }));
c.push(p("Todos os valores financeiros são estimativas sem IVA, salvo indicação em contrário, e devem ser revistos com um contabilista certificado.", { run: { size: 18, italics: true, color: "5C6446" } }));
c.push(quebra());

c.push(new Paragraph({ children: [new TextRun({ text: "Índice", bold: true, size: 32, color: MUSGO })], spacing: { after: 200 } }));
c.push(new TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-2" }));
c.push(p("(No Word: clique com o botão direito no índice → Atualizar campo, para mostrar os números de página.)", { run: { size: 18, italics: true, color: "5C6446" } }));
c.push(quebra());

// Parte I (estrutura do diapositivo 7 da parte 2 do módulo) e Parte II (plano de ação).
// Este bloco é inserido no plano.js pelo montar.py; usa as variáveis e ajudantes de lá.

const margemMedia = equipMedio * (1 - custoEquip) + (ticket - equipMedio) * (1 - pagaTecnicos);
const pontoEquilibrio = fixoTotal / margemMedia;
const mesEquilibrio = (meses.find(m => m.margem + m.subs - fixoTotal >= 0) || {}).mes;
const kitC = kits[1];
const custoC = {
  equip: kitC.equip * custoEquip,
  maoObra: (kitC.preco - kitC.equip) * pagaTecnicos,
  consumiveis: 15,
  indireto: fixoTotal / 4.5,
};
const custoCTotal = Object.values(custoC).reduce((a, b) => a + b, 0);

c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE I — PLANO DE NEGÓCIO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(p("Estrutura do diapositivo 7 do módulo (Plano de ação e plano de negócio): resumo, empresa, serviço, mercado, clientes, concorrência, marketing e vendas, plano operacional, recursos humanos, investimento, previsões financeiras, riscos e objetivos."));

// 1. Resumo
c.push(h1("1. Resumo do negócio"));
c.push(p("A Domus Energia é uma empresa de eletricidade e automação residencial na Grande Lisboa. Instala quadros elétricos inteligentes, interruptores, estores, sensores e alarme, e liga tudo a uma plataforma própria (app Android e área de cliente no site). O cliente paga a instalação uma vez e uma mensalidade pelo serviço."));
c.push(tabela(["Indicador", "Valor (ano 1)"], [
  ["Investimento inicial", eur(arranqueTotal)],
  ["Instalações previstas", String(ano.n)],
  ["Vendas de instalações", eur(ano.vendas)],
  ["Casas com mensalidade no mês 12", String(Math.round(meses[11].acumulados * subscreve))],
  ["Ponto de equilíbrio", `≈ ${Math.ceil(pontoEquilibrio)} instalações por mês (atingido no mês ${mesEquilibrio})`],
  ["Resultado do ano 1 (antes de impostos e salário do CEO)", eur(resultadoAno)],
], [6, 3], { alinharDireita: [1] }));

// 2. Empresa
c.push(h1("2. Descrição da empresa"));
c.push(p("Nome: Domus Energia. Atividade: instalações elétricas e automação residencial (CAE 43210, secundários 43290 e 62020). Sede e zona inicial: Grande Lisboa. Equipa: o CEO (em formação de eletricidade, futuro técnico responsável DGEG) e 4 colaboradores."));
c.push(h2("Da ideia ao negócio"));
c.push(tabela(["Fase", "O que significa", "Na Domus Energia"], [
  ["Ideia", "Ponto de partida: uma oportunidade que ainda precisa de ser estudada", "“Há casas que gastam demais e não têm segurança; com aparelhos Wi-Fi baratos e uma app própria posso resolver isso.”"],
  ["Projeto", "A ideia estruturada e planeada: mercado, clientes, concorrência, recursos, custos, investimento, riscos, objetivos", "Este documento; a plataforma (servidor, motor, app e site) já está construída e testada"],
  ["Negócio", "O projeto passa a atividade económica: empresa criada, clientes, receitas e resultados acompanhados", "Meses 1–3: criar a empresa, comprar stock, 3 instalações-piloto, primeiras mensalidades"],
], [1.3, 3.5, 4.2]));
c.push(h2("Sócios ou trabalhadores (decisão em aberto)"));
c.push(p("O diapositivo 21 pede que o plano esclareça quem investe, quem gere e como se dividem as responsabilidades. Ainda não está decidido; as duas hipóteses:"));
c.push(tabela(["Critério", "A — Só o CEO é dono (unipessoal Lda)", "B — Sócios, com o CEO maioritário (Lda)"], [
  ["Quem investe", `CEO: os ${eur(arranqueTotal)}`, "CEO ≥ 51 %; colegas entram com uma parte (ex.: 500–1 000 € cada)"],
  ["Quem gere", "CEO sozinho", "CEO como gerente; decisões grandes em assembleia de sócios"],
  ["Colaboradores", "Trabalhadores, pagos por obra no início", "Sócios-trabalhadores; recebem pela obra e parte dos lucros"],
  ["Vantagens", "Decisão rápida; simples de gerir", "Mais capital; equipa comprometida; risco partilhado"],
  ["Desvantagens", "Todo o risco e investimento no CEO", "Pacto social necessário; conflitos se as expectativas não estiverem escritas"],
], [1.8, 3.6, 3.6]));
c.push(nota("Recomendação: decidir antes de criar a empresa e, na hipótese B, escrever um acordo de sócios (quem investe quanto, quem faz o quê, como se saem da empresa)."));
c.push(h2("Quem vai usar este plano"));
c.push(tabela(["Quem", "Para quê"], [
  ["Empreendedor (CEO)", "Estruturar a ideia, avaliar a viabilidade e definir a estratégia"],
  ["Sócios (se houver)", "Alinhar expectativas: quem investe, quem gere, objetivos e responsabilidades"],
  ["Gestores / equipa", "Orientar decisões e acompanhar a evolução (revisão semanal)"],
  ["Bancos, IEFP e financiadores", "Perceber o investimento, como será usado e como será reembolsado"],
  ["Parceiros e fornecedores", "Apresentar a empresa a mediadoras imobiliárias, alojamentos locais, lares e distribuidores"],
], [3, 6]));

// 3. Serviço
c.push(h1("3. Produto ou serviço"));
c.push(p("Vendemos um serviço completo: instalação elétrica e de automação, e depois uma mensalidade que inclui a app, o servidor, as notificações e o suporte."));
c.push(tabela(["Kit de instalação", "Inclui", "Preço (s/ IVA)", "Horas de trabalho"],
  kits.map(k => [k.nome, k.desc, eur(k.preco), `${k.horas} h`]), [2, 5, 1.6, 1.4], { alinharDireita: [2, 3] }));
c.push(espaco());
c.push(tabela(["Plano mensal", "Inclui", "Preço c/ IVA", "Preço s/ IVA"],
  planos.map(pl => [pl.nome, pl.inclui, eur(pl.com, 2), eur(pl.sem, 2)]), [2, 5, 1.5, 1.5], { alinharDireita: [2, 3] }));
c.push(nota("Se o cliente deixar de pagar: 15 dias de aviso e depois modo básico. Os interruptores físicos continuam sempre a funcionar; perde a app, as automações e o alarme."));
c.push(h2("O que nos diferencia"));
[
  "Plataforma própria (sem depender da cloud Tuya): servidor, motor de automações, app e site da empresa.",
  "Quem instala percebe de eletricidade: instalação elétrica e automação feitas pela mesma equipa.",
  "Funciona quando algo falha: interruptores físicos sempre ativos; no plano Premium um Raspberry Pi em casa mantém o alarme sem internet.",
  "Poupança visível: consumo por circuito, alertas, aparelhos em espera e relatório da casa.",
  "Sem fidelização longa: mensalidades baixas e cancelamento simples.",
].forEach(t => c.push(bullet(t)));

// 4. Mercado
c.push(h1("4. Análise de mercado"));
[
  "A fatura da eletricidade pesa no orçamento das famílias; saber quanto gasta cada circuito é o primeiro passo para poupar.",
  "Os aparelhos Wi-Fi ficaram baratos: uma casa inteligente básica já não custa milhares de euros.",
  "A segurança é uma preocupação e o alarme com mensalidade está generalizado — mas com contratos caros e longos.",
  "Envelhecimento da população: filhos que querem acompanhar os pais à distância.",
  "Alojamento local na Grande Lisboa: senhorios querem controlar consumos e a casa entre estadias.",
].forEach(t => c.push(bullet(t)));
c.push(p("Preços de referência encontrados: instalação de domótica a partir de ≈ 750 €, e uma smart home entre ≈ 500 € e 3 000 €; sistemas KNX a partir de ≈ 1 500 € (Zaask). Alarme com monitorização a partir de 37 €/mês com fidelização de 24 meses (Verisure/Securitas Direct). Os kits da Domus Energia (390–1 490 €) e as mensalidades (4,99–19,99 €) ficam abaixo destas referências."));

// 5. Clientes
c.push(h1("5. Identificação de clientes"));
c.push(tabela(["Segmento", "Necessidade que resolvemos", "Kit e plano típicos"], [
  ["Famílias em moradias", "Segurança, conforto e poupança na fatura", "Conforto ou Segurança Premium + plano Conforto/Premium"],
  ["Apartamentos e alojamento local", "Controlo à distância, consumo por estadia, desligar tudo entre hóspedes", "Essencial ou Conforto + plano Base/Conforto"],
  ["Idosos e familiares", "Tranquilidade: aviso se não houver movimento de manhã ou se a porta abrir à noite", "Conforto + plano Conforto"],
], [2.2, 3.6, 3.2]));

// 6. Concorrência
c.push(h1("6. Análise da concorrência"));
c.push(tabela(["Concorrente", "O que oferece", "Pontos fortes", "Onde somos melhores"], [
  ["Empresas de alarme (Verisure / Securitas Direct)", "Alarme com central de monitorização", "Marca forte, resposta 24 h", "Mensalidade muito mais baixa, sem fidelização de 24 meses; também poupança e automação"],
  ["Integradores de domótica (KNX e similares)", "Automação completa por cabo", "Muito fiável, projetos grandes", "Preço de entrada muito menor; instalação sem obras em casas já construídas"],
  ["Eletricistas tradicionais e multisserviços", "Instalações elétricas, por vezes domótica", "Proximidade, preço da mão de obra", "Plataforma própria com app, alertas e mensalidade de suporte"],
  ["Faça você mesmo (apps Tuya / Smart Life, Shelly)", "Aparelhos baratos instalados pelo próprio", "Barato, imediato", "Instalação segura no quadro por quem é da área; tudo integrado numa só app; suporte"],
], [2.3, 2.2, 2, 2.5]));
c.push(p("Posicionamento: o meio-termo entre o \"faça você mesmo\" (barato mas arriscado no quadro elétrico) e o KNX ou a central de alarme (caros e com contratos longos)."));

// 7. Marketing
c.push(h1("7. Estratégia de marketing e vendas"));
c.push(tabela(["Área", "O que fazemos"], [
  ["Produto", "3 kits fixos e 3 planos simples; demonstração ao vivo com o quadro de bancada"],
  ["Preço", "Abaixo das centrais de alarme e do KNX; 1.º mês de mensalidade grátis; sem fidelização"],
  ["Distribuição", "Venda direta em visita; parcerias com mediadoras imobiliárias, gestores de AL e lares/cuidadores (comissão por cliente)"],
  ["Comunicação", "Google Business Profile, site com pedido de orçamento e WhatsApp, vídeos curtos de instalações, testemunhos das instalações-piloto, flyers nas zonas das obras"],
], [2, 7]));
c.push(h2("Do contacto ao cliente"));
["Contacto (site, WhatsApp, parceiro) → resposta em menos de 24 h.", "Visita gratuita com demonstração → orçamento em 48 h (skill de orçamento).", "Aceitação → marcação da obra e encomenda do material.", "Instalação e entrega → 1.º mês grátis.", "Acompanhamento aos 7 e 30 dias → pedido de recomendação."].forEach(t => c.push(num(t, "funil")));

// 8. Plano operacional
c.push(h1("8. Plano operacional"));
[
  "Horário: segunda a sexta 9:00–18:00; sábado de manhã para visitas; suporte por WhatsApp em dias úteis e alarmes 24 h pela plataforma.",
  "Fornecedores: aparelhos certificados na UE (ex.: Shelly) de 2 distribuidores diferentes, para não depender de um só; material elétrico no armazenista local.",
  "Oficina: garagem ou arrecadação do CEO para preparar e configurar os aparelhos antes das obras.",
  "Plataforma: servidor VPS (Mosquitto, motor, notificações), app Android e site — mantidos pelo técnico de sistemas.",
  "Qualidade: checklist de instalação, teste final com o cliente, documento de entrega (ver III.4 Sequência de uma instalação).",
].forEach(t => c.push(bullet(t)));

// 9. Recursos humanos e os 4 recursos
c.push(h1("9. Recursos humanos e recursos da empresa"));
c.push(p("Uma empresa reúne e coordena recursos (Chiavenato e Drucker). As pessoas são o recurso central: são elas que usam e coordenam todos os outros."));
c.push(tabela(["Recurso", "O que é", "Na Domus Energia"], [
  ["Humanos", "Pessoas e as suas competências, conhecimentos e atitudes", "CEO e técnico responsável; 2 técnicos instaladores; 1 técnico de sistemas e suporte; 1 comercial part-time (funções em III.1)"],
  ["Materiais", "Instalações, equipamentos, ferramentas e materiais", "Oficina, carros, ferramentas e EPI, kit de demonstração, stock de aparelhos, cabos e consumíveis"],
  ["Financeiros", "Capital próprio, financiamentos e receitas", `${eur(arranqueTotal)} de capital próprio; receitas das instalações e das mensalidades; apoios IEFP/microcrédito se necessário`],
  ["Tecnológicos", "Conhecimento técnico, sistemas, software e automatização", "Plataforma própria (servidor MQTT, motor de automações, app Android, site), Stripe, skills de orçamento e instalação, agente de suporte"],
], [1.6, 3, 4.4]));

// 10. Investimento
c.push(h1("10. Investimento necessário"));
c.push(tabela(["Item", "Valor"], [...arranque.map(([a, v]) => [a, eur(v)]), total(["Total", eur(arranqueTotal)])], [7, 2], { alinharDireita: [1] }));

// 11. Custos e previsões
c.push(h1("11. Custos e previsões financeiras"));
c.push(h2("Custo e despesa"));
c.push(p("Custo é o valor dos recursos consumidos para fazer o trabalho; despesa é a saída de dinheiro quando se paga. Exemplo: as ferramentas (1 200 €) são uma despesa no mês 1, mas o custo é o seu desgaste ao longo de ≈ 3 anos (≈ 33 € por mês), mesmo sem saída de dinheiro."));
c.push(h2("Classificação dos custos da Domus Energia"));
c.push(tabela(["Critério", "Tipo", "Exemplos na empresa"], [
  ["Relação com a obra", "Diretos", "Aparelhos e material de cada obra, mão de obra dos técnicos na obra, consumíveis (terminais, fita, etiquetas)"],
  ["", "Indiretos", "Servidor, seguro, contabilista, telemóveis, marketing, desgaste das ferramentas"],
  ["Variação", "Fixos", `Servidor, seguro, contabilista, marketing base (≈ ${eur(fixoTotal)} por mês)`],
  ["", "Variáveis", "Aparelhos, material, pagamento dos técnicos por obra, combustível extra, comissões Stripe"],
  ["Momento", "Estimados", "Os valores deste plano e de cada orçamento"],
  ["", "Históricos", "Os custos reais de cada obra, registados e comparados na revisão semanal"],
], [2, 1.6, 5.4]));
c.push(h2(`Custo estimado de uma instalação (kit ${kitC.nome}, ${eur(kitC.preco)})`));
c.push(tabela(["Componente", "Tipo", "Valor"], [
  ["Aparelhos e material", "Direto · variável", eur(custoC.equip)],
  ["Mão de obra dos técnicos", "Direto · variável", eur(custoC.maoObra)],
  ["Consumíveis", "Direto · variável", eur(custoC.consumiveis)],
  ["Parte dos custos fixos (÷ 4,5 obras/mês)", "Indireto · fixo", eur(custoC.indireto)],
  total(["Custo total estimado", "", eur(custoCTotal)]),
  total(["Resultado da obra", "", eur(kitC.preco - custoCTotal)]),
], [5, 2.2, 1.8], { alinharDireita: [2] }));
c.push(h2("Ponto de equilíbrio"));
c.push(p(`Cada instalação deixa, em média, ${eur(margemMedia)} para a empresa (depois de pagar aparelhos e técnicos). Os custos fixos são ${eur(fixoTotal)} por mês. Logo, a empresa precisa de ${fixoTotal.toFixed(0)} ÷ ${margemMedia.toFixed(0)} ≈ ${pontoEquilibrio.toFixed(1)} → ${Math.ceil(pontoEquilibrio)} instalações por mês para não perder dinheiro. Com as mensalidades a crescer, este número desce ao longo do ano. Na previsão, o equilíbrio é atingido no mês ${mesEquilibrio}.`));
c.push(h2("Pressupostos"));
[
  `Mistura de vendas: 50 % Essencial, 35 % Conforto, 15 % Segurança Premium → valor médio por instalação ${eur(ticket)}.`,
  "Equipamento comprado a ≈ 72 % do preço de venda; mão de obra: 60 % para os técnicos, 40 % para a empresa.",
  `Instalações por mês: ${instalacoesMes.join(", ")} (total ${ano.n}).`,
  `70 % dos clientes subscrevem; mensalidade média ${eur(mensalidadeMedia, 2)} sem IVA.`,
  "O CEO não recebe salário fixo no ano 1; o resultado serve para o pagar a partir do mês 7 e reinvestir.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Custos fixos mensais"));
c.push(tabela(["Custo", "Por mês"], [...Object.entries(fixosMes).map(([a, v]) => [a, eur(v)]), total(["Total", eur(fixoTotal)])], [7, 2], { alinharDireita: [1] }));
c.push(h2("Previsão mensal"));
c.push(tabela(["Mês", "Instalações", "Casas", "Vendas", "Margem obras", "Mensalidades", "Custos fixos", "Resultado"],
  [...meses.map(m => [m.mes, m.n, m.acumulados, eur(m.vendas), eur(m.margem), eur(m.subs), eur(fixoTotal), eur(m.margem + m.subs - fixoTotal)]),
   total(["Ano", ano.n, meses[11].acumulados, eur(ano.vendas), eur(ano.margem), eur(ano.subs), eur(fixoTotal * 12), eur(resultadoAno)])],
  [0.7, 1.1, 0.9, 1.3, 1.4, 1.4, 1.3, 1.3], { alinharDireita: [1, 2, 3, 4, 5, 6, 7] }));
c.push(nota(`No ano 1 as instalações pagam a empresa; as mensalidades são ainda pequenas (${eur(mrrFinal)} por mês no mês 12) mas repetem-se todos os meses. Objetivo do ano 2: 150 casas com mensalidade (≈ ${eur(150 * mensalidadeMedia)} por mês).`));

// 12. Riscos
c.push(h1("12. Riscos e medidas de prevenção"));
c.push(tabela(["Risco", "Medida preventiva", "Alternativa se acontecer"], [
  ["Falta de clientes", "Pilotos com testemunhos, parcerias com AL, mediadoras e lares", "Oferecer só o kit Essencial com desconto; serviços elétricos gerais"],
  ["Aumento dos custos (aparelhos, combustível)", "Orçamentos válidos 30 dias; obras agrupadas por zona", "Rever preços dos kits a cada trimestre"],
  ["Entrada de novos concorrentes", "Diferenciar pela plataforma própria, suporte e preço sem fidelização", "Focar em nichos (AL, idosos) e em parcerias"],
  ["Dependência de um único fornecedor", "2 distribuidores de aparelhos certificados; protocolo aberto (MQTT)", "Trocar de marca sem mudar a app"],
  ["Certificação DGEG ainda não obtida", "Só trabalhos sem assinatura até ao fim do curso", "Subcontratar um eletricista certificado"],
  ["Falha do servidor ou da internet do cliente", "Regras nos próprios aparelhos; backups diários", "Raspberry Pi em casa no plano Premium"],
  ["Clientes cancelam a mensalidade", "Valor visível: relatórios de poupança e alertas", "Plano Base barato; questionário para perceber porquê"],
], [2.4, 3.4, 3.2]));
c.push(h2("Apoios a considerar"));
c.push(p("Se o capital próprio não chegar: apoio à criação do próprio emprego do IEFP, microcrédito e avisos do Portugal 2030. Confirmar as condições atuais no IEFP e com o contabilista."));

// 13. Objetivos
c.push(h1("13. Objetivos e resultados esperados"));
c.push(tabela(["Objetivo (ano 1)", "Meta"], [
  ["Número de clientes", `${ano.n} instalações; ${Math.round(meses[11].acumulados * subscreve)} casas com mensalidade no mês 12`],
  ["Volume de vendas", eur(ano.vendas) + " em instalações"],
  ["Prazo para o ponto de equilíbrio", `Mês ${mesEquilibrio}`],
  ["Número de colaboradores", "5 pessoas (CEO + 4); técnicos com contrato a partir do mês 10"],
  ["Satisfação dos clientes", "≥ 90 % no questionário de 30 dias"],
], [4, 5]));
c.push(p("Os objetivos estão escritos na forma SMART, com o exercício de objetivos vagos para SMART e a relação atividade → resultado, na Parte III (III.5 e III.6)."));

// 14. Decisão
c.push(h1("14. O plano como instrumento de decisão"));
c.push(p("O plano não elimina a incerteza, mas reduz as decisões tomadas só por intuição. Exemplo, no formato do diapositivo 26:"));
c.push(tabela(["Critério", "Plataforma só online (VPS)", "Online + Raspberry Pi em casa"], [
  ["Investimento inicial por casa", "Nenhum extra", "≈ 90–130 € (Pi, SSD, UPS)"],
  ["Custos fixos", "≈ 5 €/mês de servidor para todos", "Servidor + manutenção de cada Pi"],
  ["Funciona sem internet", "Só os interruptores físicos", "Alarme, sirene e automações continuam"],
  ["Rapidez", "Meio segundo ou mais", "Milissegundos"],
  ["Esforço de suporte", "Baixo", "Mais alto (um equipamento por casa)"],
  ["Decisão", "Planos Base e Conforto", "Só no plano Segurança Premium"],
], [2.4, 3.3, 3.3]));
c.push(quebra());

// PARTE II — Plano de ação
c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE II — PLANO DE AÇÃO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(h1("15. Plano de ação do arranque"));
c.push(p("O plano de ação transforma os objetivos em tarefas concretas. Cada ação responde a: O quê? Porquê? Quem? Quando? Como? Quanto? Como sabemos se resultou?"));
c.push(tabela(["O quê", "Porquê", "Quem", "Quando", "Como", "Quanto", "Como sabemos se resultou"], [
  ["Decidir sócios e criar a empresa", "Faturar legalmente", "CEO", "Mês 1", "Empresa na Hora", "360 €", "Certidão e NIF da empresa"],
  ["Seguro de RC e contabilista", "Proteger e cumprir", "CEO", "Mês 1", "3 propostas", "420 €/ano + 100 €/mês", "Apólice ativa antes da 1.ª obra"],
  ["Servidor no VPS e app compilada", "Plataforma pronta", "Téc. sistemas", "Mês 1–2", "Guias do projeto", "≈ 15 €/mês + 25 € Google Play", "App instalada num telemóvel real, testes a passar"],
  ["Kit de demonstração", "Vender ao vivo", "Técnicos", "Mês 1", "Quadro de bancada", "Parte do stock (≈ 300 €)", "Usado em 100 % das visitas"],
  ["Pagamentos Stripe", "Cobrar mensalidades", "Téc. sistemas", "Mês 2", "Stripe + página de planos", "1,5 % + 0,25 € por pagamento", "1.ª mensalidade cobrada automaticamente"],
  ["Lançamento (Google, site, flyers)", "Primeiros pedidos", "Comercial + CEO", "Mês 2", "Campanha local", "600 €", "≥ 10 pedidos de orçamento no mês 2"],
  ["3 instalações-piloto", "Provar e ter testemunhos", "Equipa", "Mês 2–3", "Amigos/família a 50 %", "Custo do material", "3 testemunhos com fotos; satisfação ≥ 90 %"],
  ["Contactar parceiros (AL, mediadoras, lares)", "Canal de vendas", "Comercial", "Semanal", "20 contactos/semana", "Tempo + comissão por cliente", "5 novos clientes por mês a partir do mês 4"],
], [1.7, 1.3, 1, 0.8, 1.3, 1.4, 1.9]));
c.push(quebra());
c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE III — ORGANIZAÇÃO DO TRABALHO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(p("Tópicos da parte 1 do módulo (Planeamento, organização e conceito de negócio), aplicados à empresa."));

// 2. Planeamento e organização do trabalho
c.push(h1("III.1 Planeamento e organização do trabalho"));
c.push(p("Planear e organizar é saber o que fazer, quando, como e por que ordem. Numa empresa de instalações, isto evita deslocações perdidas, material esquecido e clientes à espera."));
c.push(h2("Equipa e funções"));
c.push(p("O CEO lidera a empresa; a equipa inicial tem 4 pessoas além dele. Como o capital inicial é até 5 000 €, no primeiro ano os técnicos trabalham em prestação de serviços e são pagos por instalação (60 % da mão de obra de cada obra), sem salários fixos. Passam a contrato quando a faturação o permitir (objetivo: mês 10)."));
c.push(tabela(["Função", "Quem", "Responsabilidades"], [
  ["CEO (diretor-geral e técnico responsável)", "Tu", "Estratégia, orçamentos, compras, qualidade e segurança das instalações, relação com clientes-chave, finanças com o contabilista"],
  ["Técnico instalador 1", "Colega do curso", "Instalação elétrica, quadros, disjuntores e interruptores"],
  ["Técnico instalador 2", "Colega do curso", "Sensores, estores, configuração dos aparelhos (domus.sh) e testes com o cliente"],
  ["Técnico de sistemas e suporte", "Colega com gosto por informática", "Servidor, app, site, atualizações, suporte à distância, saúde dos aparelhos"],
  ["Comercial e atendimento (part-time)", "A definir", "Pedidos de orçamento, WhatsApp, marcações, redes sociais, questionários de satisfação"],
], [2.6, 2, 4.4]));
c.push(h2("Organização pessoal do CEO — semana tipo"));
c.push(tabela(["Dia", "Manhã", "Tarde"], [
  ["Segunda", "Reunião de equipa (30 min): obras da semana, material, prioridades", "Orçamentos e compras"],
  ["Terça a quinta", "Obras / acompanhamento de instalações", "Obras; fim do dia: registar horas e material gasto"],
  ["Sexta", "Visitas comerciais e orçamentos", "Revisão semanal (secção 3) e planeamento da semana seguinte"],
  ["Diário", "Consultar o plano do dia antes do email e WhatsApp", "Responder a pedidos em blocos (12:30 e 18:00)"],
], [1.6, 4, 3.4]));
c.push(h2("Uma pessoa organizada — aplicado à equipa"));
c.push(tabela(["O módulo diz", "Na Domus Energia"], [
  ["Mantém as tarefas identificadas e registadas", "Cada obra tem a sua lista de tarefas; nada fica só \"na cabeça\""],
  ["Organiza documentos e informação", "Pasta por cliente com orçamento, fotos, esquema e entrega"],
  ["Define o que precisa de ser feito", "Plano do dia consultado antes do email e do WhatsApp"],
  ["Evita acumular tarefas desnecessariamente", "Pedidos simples delegados ao comercial; revisão semanal limpa o que ficou pendente"],
  ["Mantém o espaço e os instrumentos organizados", "Carrinha com caixas etiquetadas e kit Essencial sempre pronto; ferramentas verificadas à sexta"],
], [4, 5]));
c.push(h2("Ferramentas de organização"));
[
  "Agenda partilhada da equipa (Google Calendar) com cada obra marcada.",
  "Lista de tarefas por obra (Trello ou Google Tasks) com o checklist de instalação.",
  "Pasta por cliente: orçamento, fotos do quadro antes/depois, esquema de circuitos, configuração dos aparelhos e declaração de entrega.",
  "Carrinha/carro com caixas etiquetadas: kit Essencial pronto a sair, ferramentas e EPI.",
].forEach(t => c.push(bullet(t)));

// 3. Gestão do tempo
c.push(h1("III.2 Gestão do tempo"));
c.push(p("Gerir o tempo é usar bem o tempo que temos. Aplicamos o ciclo Planeamento – Execução – Verificação – Ajuste a cada semana e a cada obra."));
c.push(tabela(["Fase", "Na Domus Energia"], [
  ["Planeamento", "Segunda: obras da semana, tempo estimado por kit (3 h, 7 h, 10 h) + 30 % de margem para imprevistos"],
  ["Execução", "Checklist de instalação; sem interrupções comerciais durante a obra (o comercial atende o telefone)"],
  ["Verificação", "No fim da obra: testar todos os circuitos na app com o cliente; registar horas reais"],
  ["Ajuste", "Sexta: comparar horas reais com as estimadas e corrigir os tempos dos próximos orçamentos"],
], [2, 7]));
c.push(h2("Revisão semanal (sexta-feira, 20 minutos)"));
["O que consegui realizar?", "O que ficou pendente e porquê?", "O que me fez perder tempo (deslocações, material em falta, esperas)?", "O que vou fazer de forma diferente na próxima semana?"].forEach(t => c.push(bullet(t)));
c.push(quebra());

// 4. Prioridades
c.push(h1("III.3 Definição de prioridades"));
c.push(p("Nem todas as tarefas têm a mesma importância ou urgência. Usamos a matriz de quatro categorias. Estar ocupado não significa estar a ser produtivo."));
c.push(tabela(["", "Urgente", "Não urgente"], [
  ["Importante", "FAZER PRIMEIRO — alarme de cliente disparado ou sistema em baixo; avaria elétrica numa casa instalada; obra com prazo hoje", "PLANEAR — obter a certificação DGEG; seguro; preparar a campanha de lançamento; formação da equipa; melhorias da app"],
  ["Pouco importante", "DELEGAR — marcar visitas, responder a pedidos simples de informação (comercial); encomendas de material de rotina", "FAZER DEPOIS — redesenhar o logótipo; testar aparelhos novos só por curiosidade; redes sociais sem plano"],
], [1.6, 3.7, 3.7]));

// 5. Planeamento de tarefas
c.push(h1("III.4 Planeamento de tarefas"));
c.push(p("Planear é definir antecipadamente as ações, métodos, tempos e recursos para atingir um objetivo. Cada tarefa responde a O quê? Quem? Quando? Como? Porquê?"));
c.push(h2("Plano de arranque (primeiros 6 meses)"));
c.push(tabela(["O quê", "Quem", "Quando", "Como / recursos", "Porquê"], [
  ["Constituir a empresa e abrir conta bancária", "CEO", "Mês 1", "Empresa na Hora (≈ 360 €)", "Faturar legalmente"],
  ["Seguro de RC e contabilista", "CEO", "Mês 1", "3 propostas de seguro; contabilista ≈ 100 €/mês", "Proteger a empresa e cumprir obrigações"],
  ["Instalar o servidor (VPS) e testar tudo", "Técnico de sistemas", "Mês 1", "Guia servidor/README.md; Hetzner ≈ 5 €/mês", "Ter a plataforma pronta"],
  ["Compilar e publicar a app Android", "Técnico de sistemas", "Mês 1–2", "Android Studio; conta Google Play (25 € uma vez)", "Os clientes instalam a app"],
  ["Montar o kit de demonstração", "Técnicos", "Mês 1", "Quadro de bancada com 4 disjuntores, interruptor, sensores", "Mostrar ao vivo nas visitas"],
  ["Pagamentos Stripe (cartão + MB WAY)", "Técnico de sistemas", "Mês 2", "Conta Stripe, página de planos no site", "Cobrar mensalidades automaticamente"],
  ["Lançamento: Google Business, site, flyers", "Comercial + CEO", "Mês 2", "600 € de marketing inicial", "Primeiros pedidos de orçamento"],
  ["3 instalações-piloto com desconto", "Equipa", "Mês 2–3", "Amigos/família a 50 % em troca de testemunho e fotos", "Provar o serviço e ter referências"],
  ["Parcerias: mediadoras, AL, lares", "CEO + comercial", "Mês 3–6", "Visitas e proposta de comissão por cliente", "Canal de vendas estável"],
], [2.6, 1.5, 1, 2.6, 1.9]));
c.push(h2("Funções do planeamento na empresa"));
c.push(tabela(["Função", "Exemplo na Domus Energia"], [
  ["Organização — estruturar as atividades de forma lógica", "Obras agrupadas por zona (Lisboa, Oeiras, Sintra…) para reduzir deslocações"],
  ["Previsão — antecipar necessidades e dificuldades", "Material encomendado com o orçamento aceite; margem de 30 % no tempo"],
  ["Coordenação — articular tarefas e pessoas", "Técnico 1 faz o quadro, técnico 2 prepara os sensores ao mesmo tempo; sistemas configura a app"],
  ["Controlo — comparar o previsto com o realizado", "Horas e material reais registados em cada obra e comparados à sexta"],
], [4, 5]));
c.push(tabela(["Com planeamento", "Sem planeamento"], [
  ["Melhor uso das ferramentas, da carrinha e do stock", "Execução desorganizada: voltar à loja a meio da obra"],
  ["Prazos cumpridos com o cliente", "Interrupções frequentes e clientes à espera"],
  ["Menos custos (combustível, horas)", "Conflitos entre obras marcadas à mesma hora"],
  ["Instalações com mais qualidade e segurança", "Atrasos e orçamentos que derrapam"],
], [4.5, 4.5]));
c.push(h2("Exemplo do módulo: preparar a reunião semanal de equipa"));
[
  "Definir o objetivo: obras e prioridades da semana.",
  "Identificar os participantes: CEO, técnicos, sistemas e comercial.",
  "Preparar a agenda: obras, material, problemas de clientes, objetivos SMART.",
  "Reunir a informação: agenda, orçamentos aceites, alertas do painel de saúde.",
  "Enviar a convocatória: fixa, segunda às 9:00, 30 minutos.",
  "Preparar os materiais: lista de obras e de material por obra.",
  "Realizar a reunião, a cumprir o horário.",
  "Registar decisões e tarefas (quem faz o quê e até quando).",
  "Acompanhar as ações na reunião seguinte.",
].forEach(t => c.push(num(t, "reuniao")));
c.push(h2("Sequência de uma instalação"));
c.push(p("Uma sequência mal definida origina retrabalho, perda de tempo e riscos de segurança. A ordem da equipa é sempre:"));
[
  "Visita e levantamento do quadro e dos circuitos; orçamento enviado em 48 h.",
  "Preparar o material e configurar os aparelhos na oficina (domus.sh gera as configurações).",
  "No local: cortar a energia, verificar ausência de tensão, instalar.",
  "Religar, testar cada circuito e o estado depois de um corte de luz.",
  "Ligar os aparelhos ao Wi-Fi e ao servidor; verificar o sinal (saúde dos aparelhos).",
  "Configurar modos, cenas e automações com o cliente; instalar a app no telemóvel dele.",
  "Entrega: documento com esquema, credenciais e contactos de suporte; ativar a subscrição.",
  "Acompanhamento: chamada ao fim de 7 dias e questionário de satisfação ao fim de 30 dias.",
].forEach(t => c.push(num(t)));
c.push(quebra());

// 6. Objetivos SMART
c.push(h1("III.5 Objetivos e resultados (SMART)"));
c.push(p("Um objetivo tem de ser específico, mensurável, atingível, relevante e com prazo. “Quero ter muitos clientes” é um desejo; os objetivos da Domus Energia são:"));
c.push(tabela(["Objetivo SMART", "S", "M", "A", "R", "T"], [
  ["Concluir 54 instalações na Grande Lisboa até ao fim do ano 1, subindo de 2 para 6 por mês", "Instalações na Grande Lisboa", "54 no ano", "Com 2 técnicos e agenda planeada", "É a principal fonte de receita", "12 meses"],
  [`Ter ${Math.round(meses[11].acumulados * subscreve)} casas com mensalidade ativa no mês 12`, "Subscrições ativas", `${Math.round(meses[11].acumulados * subscreve)} casas (70 %)`, "Oferecer 1 mês grátis na instalação", "Receita recorrente", "Mês 12"],
  ["Obter a habilitação de técnico responsável na DGEG", "Certificação do CEO", "Inscrição aprovada", "Fim do curso de eletricidade", "Assinar instalações", "Fim do curso"],
  ["Satisfação dos clientes ≥ 90 % no questionário de 30 dias", "Questionário de satisfação", "≥ 90 % satisfeitos", "Checklist e acompanhamento", "Referências e recomendações", "Todos os trimestres"],
  ["Responder a pedidos de orçamento em menos de 24 h", "Tempo de resposta", "< 24 h em 95 % dos casos", "Comercial part-time + WhatsApp", "Não perder clientes", "A partir do mês 2"],
], [3.4, 1.4, 1.4, 1.4, 1.4, 1]));

// 7. Orientação para resultados
c.push(h2("Exercício do módulo: de objetivo vago a SMART"));
c.push(tabela(["Objetivo vago", "Objetivo SMART na Domus Energia"], [
  ["Conseguir mais clientes", "Conquistar 5 novos clientes por mês a partir do mês 4, através de parcerias com 3 mediadoras e 5 alojamentos locais na Grande Lisboa"],
  ["Melhorar a presença nas redes sociais", "Publicar 2 vídeos de instalações por semana e chegar a 500 seguidores no Instagram até ao mês 6"],
  ["Melhorar o atendimento ao cliente", "Responder a 95 % dos pedidos em menos de 24 h a partir do mês 2, com o comercial part-time e respostas rápidas no WhatsApp"],
  ["Reduzir os custos da empresa", "Reduzir o combustível em 15 % até ao mês 6, agrupando as obras por zona"],
  ["Aumentar a produtividade", "Baixar o tempo médio do kit Conforto de 7 h para 6 h até ao mês 9, com a checklist e a preparação na oficina"],
  ["Fazer reuniões mais eficazes", "Reunião semanal de 30 min com agenda fixa; 100 % das decisões registadas com responsável e prazo a partir do mês 1"],
], [3, 6]));
c.push(h1("III.6 Trabalho e orientação para resultados"));
c.push(p("Atividade é o que fazemos; resultado é o que conseguimos. O número de tarefas feitas não garante produtividade — medimos o resultado de cada atividade."));
c.push(p("Na equipa, quem está orientado para resultados:"));
["Compreende o objetivo de cada obra (o que o cliente quer resolver).", "Encontra soluções em vez de só apontar problemas.", "Cumpre os compromissos de hora e de prazo.", "Assume a responsabilidade pelo seu trabalho.", "Avalia o trabalho feito (teste final com o cliente).", "Procura melhorar continuamente (revisão semanal)."].forEach(t => c.push(bullet(t)));
c.push(tabela(["Atividade", "Resultado esperado"], [
  ["Contactar 20 potenciais clientes por semana (mediadoras, AL, lares)", "Conquistar 5 novos clientes por mês"],
  ["Campanha no Google Business e redes sociais com vídeos de instalações", "Aumentar os pedidos de orçamento em 10 % por mês"],
  ["Reunião de equipa de 30 min às segundas", "Reduzir atrasos nas obras em 20 %"],
  ["Checklist de instalação e teste final com o cliente", "Menos de 5 % de visitas de correção"],
  ["Formação interna (aparelhos novos, segurança)", "Reduzir o tempo médio do kit Conforto de 7 h para 6 h"],
  ["Questionário de satisfação aos 30 dias", "Satisfação ≥ 90 % e 1 recomendação por cada 3 clientes"],
  ["Painel de saúde dos aparelhos e alertas", "Resolver 80 % dos problemas à distância, sem deslocação"],
], [5, 4]));
c.push(quebra());

// 8. Proatividade
c.push(h1("III.7 Proatividade"));
c.push(p("Ser proativo é antecipar, tomar a iniciativa e procurar soluções antes de o problema aparecer. O próprio sistema Domus foi desenhado para isto: avisa antes de a pilha acabar, quando um aparelho fica offline e quando o consumo sobe."));
c.push(tabela(["Situação", "Atitude reativa", "Atitude proativa (Domus Energia)"], [
  ["Pilha de um sensor a acabar", "Esperar que o cliente reclame que o alarme não funcionou", "O sistema avisa com semanas de antecedência; o técnico leva a pilha na próxima visita ou envia pelo correio"],
  ["Aparelho offline", "“O cliente ainda não ligou”", "O painel de saúde mostra-o; ligamos ao cliente no mesmo dia"],
  ["Consumo anormal num circuito", "Nada — ninguém olha para os gráficos", "Alerta de consumo; sugerimos verificar o aparelho (poupança para o cliente)"],
  ["Material em falta numa obra", "“Ninguém disse que era preciso”", "Checklist preparado na véspera com o orçamento"],
  ["Mensalidade em atraso", "Suspender sem aviso", "Aviso amigável aos 3 dias, alternativa de plano mais barato, suspensão só aos 15 dias"],
], [2.4, 3, 3.6]));

c.push(p("Os 4 passos da proatividade na empresa: Observar (painel de saúde e questionários) → Antecipar (“se nada for feito, o que acontece?”) → Agir (contactar, corrigir, melhorar o processo) → Avaliar (funcionou? registar na revisão semanal)."));
c.push(tabela(["O que NÃO é proatividade", "O que É proatividade"], [
  ["Mexer num quadro sem avaliar as consequências", "Antecipar: verificar o quadro na visita, antes da obra"],
  ["Resolver sozinho um problema que devia ser comunicado ao CEO", "Comunicar: avisar logo e propor uma solução"],
  ["Trabalhar mais horas só para mostrar empenho", "Tomar iniciativa com método: preparar o material na véspera"],
  ["Interferir no trabalho dos colegas", "Procurar soluções e assumir a responsabilidade da sua parte"],
  ["Decidir o que ultrapassa a sua função (ex.: dar descontos)", "Agir de forma consciente e adequada à sua função"],
], [4.5, 4.5]));
c.push(p("Proatividade não é fazer tudo sozinho: o técnico resolve o que é da sua função e comunica ao CEO o que ultrapassa a sua responsabilidade (por exemplo alterações ao quadro que exigem assinatura)."));

// 9. Decisão
c.push(h1("III.8 Capacidade de decisão"));
c.push(p("Usamos o processo de 7 passos: identificar o problema, reunir informação, identificar alternativas, avaliar consequências e riscos, escolher, agir e avaliar o resultado. Exemplos de decisões já tomadas:"));
c.push(tabela(["Passo", "Decisão A: plataforma", "Decisão B: aparelhos para clientes"], [
  ["1. Problema", "Depender da cloud Tuya é arriscado e caro a prazo", "Aparelhos baratos podem não ser seguros nem certificados"],
  ["2. Informação", "Custos Tuya; falhas de cloud relatadas pela comunidade", "Análise do TO-Q-SY1-JWT; garantia e CE; preço Shelly"],
  ["3. Alternativas", "Tuya; sistema próprio online; sistema próprio + Raspberry Pi", "Temu reprogramado; Shelly certificado; mistura"],
  ["4. Riscos", "Próprio: mais trabalho técnico. Pi: mais custo", "Temu: garantia e CE. Shelly: preço mais alto"],
  ["5. Escolha", "Sistema próprio online; Raspberry Pi no plano Premium", "Shelly (ou equivalente certificado) para clientes; Temu só para testes"],
  ["6. Agir", "Servidor, motor, app e site já construídos", "Lista de compras e fornecedores UE"],
  ["7. Avaliar", "Rever aos 6 meses: falhas, custos, satisfação", "Rever avarias e devoluções por marca"],
], [1.6, 3.7, 3.7]));
c.push(h2("Da decisão à ação (passo 6) e avaliação (passo 7)"));
c.push(p("Uma decisão constantemente adiada deixa de cumprir a sua função. Para a decisão B (aparelhos certificados para clientes):"));
c.push(tabela(["Pergunta", "Resposta"], [
  ["O que vai ser feito?", "Escolher o fornecedor de Shelly (ou equivalente certificado) e criar a lista de compras por kit"],
  ["Quem é responsável?", "CEO (compras), com o técnico de sistemas a validar a compatibilidade"],
  ["Quando?", "Até ao fim do mês 1, antes das instalações-piloto"],
  ["Que recursos?", "Parte dos 1 300 € de stock inicial; 2 a 3 orçamentos de fornecedores da UE"],
  ["Como é acompanhado?", "Avarias e devoluções registadas por marca e revistas todos os meses"],
], [3, 6]));
c.push(p("Ao fim de 6 meses fazemos as perguntas de avaliação do módulo: a decisão resolveu o problema? O resultado foi o esperado? O que correu bem? O que poderia ter sido diferente?"));
c.push(quebra());


// Próximos passos e anexos
c.push(quebra());
c.push(h1("Próximos passos (próximos 30 dias)"));
[
  "Decidir entre as hipóteses A e B (sócios) e criar a empresa.",
  "Confirmar com a DGEG o que a empresa pode fazer antes da certificação do CEO.",
  "Pedir 3 propostas de seguro de responsabilidade civil.",
  "Instalar o servidor no VPS e compilar a app (guias no projeto).",
  "Montar o kit de demonstração e fazer as 3 instalações-piloto.",
  "Ativar a página de planos e os pagamentos Stripe no site.",
].forEach(t => c.push(num(t, "passos")));

c.push(h1("Anexo A — Atividade de grupo: ideia de negócio"));
c.push(tabela(["Pergunta", "Resposta", "Fase"], [
  ["Qual é a ideia?", "Casas inteligentes instaladas por eletricistas, com plataforma própria e mensalidade baixa", "Ideia"],
  ["Que necessidade resolve?", "Gastar menos eletricidade, ter segurança e controlar a casa à distância sem contratos caros", "Ideia"],
  ["Quem são os clientes?", "Famílias em moradias, apartamentos e alojamento local, idosos e os seus familiares (Grande Lisboa)", "Ideia"],
  ["Que produto ou serviço será vendido?", "Kits de instalação (390–1 490 €) e planos mensais (4,99–19,99 €)", "Projeto"],
  ["Quem são os concorrentes?", "Centrais de alarme (Verisure), integradores KNX, eletricistas tradicionais, faça você mesmo (Tuya/Shelly)", "Projeto"],
  ["Que recursos são necessários?", "Humanos (5 pessoas), materiais (ferramentas, stock, oficina), financeiros (5 000 €), tecnológicos (plataforma própria)", "Projeto"],
  ["Qual o investimento inicial?", eur(arranqueTotal), "Projeto"],
  ["Como serão obtidas receitas?", "Instalações (pagamento único) + mensalidades (receita recorrente)", "Projeto"],
  ["Quais os principais riscos?", "Falta de clientes, aumento de custos, novos concorrentes, dependência de fornecedor, certificação (secção 12)", "Projeto"],
  ["Qual a primeira ação a realizar?", "Decidir os sócios e criar a empresa; depois as 3 instalações-piloto", "Negócio"],
], [2.4, 5.4, 1.2]));

c.push(h1("Anexo B — Correspondência com o módulo 7855"));
c.push(tabela(["Tópico do módulo", "Onde está no plano"], [
  ["P2 · O que é e para que serve um plano de ação (O quê, Porquê, Quem, Quando, Como, Quanto, Indicador)", "Parte II — 15"],
  ["P2 · Plano de negócio: resumo, empresa, serviço, mercado, clientes, concorrência, marketing, operações, RH, investimento, previsões, riscos, objetivos", "Parte I — 1 a 13"],
  ["P2 · Para que serve: estruturar, avaliar a viabilidade, definir objetivos, planear recursos, antecipar riscos", "1, 11, 13, 9, 12"],
  ["P2 · Recursos humanos, materiais, financeiros, tecnológicos", "9"],
  ["P2 · Quem utiliza um plano de negócio", "2 — Quem vai usar este plano; sócios"],
  ["P2 · Plano de negócio como instrumento de decisão", "14"],
  ["P2 · Custos: custo vs. despesa; diretos/indiretos; fixos/variáveis; históricos/estimados", "11"],
  ["P2 · Diferença entre ideia, projeto e negócio; atividade de grupo", "2 — Da ideia ao negócio; Anexo A"],
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
