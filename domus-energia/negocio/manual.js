// Tradução para português (PT) do manual Tongou dos disjuntores inteligentes TO-Q-SY1/SY2.
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber } = require("docx");

const MUSGO = "606C38", FLORESTA = "283618", ARGILA = "BC6C25", AREIA_CLARA = "F4EFD2";
const LARG = 9026;
const p = (t, o = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, ...o })] });
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const b = t => new Paragraph({ numbering: { reference: "pontos", level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const n = (t, ref) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60 }, children: [new TextRun(t)] });
const nota = t => new Paragraph({ spacing: { before: 80, after: 160 }, shading: { type: ShadingType.CLEAR, fill: AREIA_CLARA, color: "auto" }, children: [new TextRun({ text: t, size: 20, italics: true })] });
function tabela(cab, linhas, pesos) {
  const s = pesos.reduce((a, c) => a + c, 0); const cols = pesos.map(w => Math.round(w / s * LARG)); cols[cols.length - 1] += LARG - cols.reduce((a, c) => a + c, 0);
  const bd = { style: BorderStyle.SINGLE, size: 4, color: "D9D3B0" }; const bords = { top: bd, bottom: bd, left: bd, right: bd };
  const cel = (t, i, c) => new TableCell({ width: { size: cols[i], type: WidthType.DXA }, borders: bords, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: c ? { type: ShadingType.CLEAR, fill: MUSGO, color: "auto" } : undefined,
    children: [new Paragraph({ alignment: i > 0 && t.length <= 3 ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: t, bold: c, color: c ? "FEFAE0" : FLORESTA, size: 18 })] })] });
  return new Table({ width: { size: LARG, type: WidthType.DXA }, columnWidths: cols, rows: [new TableRow({ tableHeader: true, children: cab.map((t, i) => cel(t, i, true)) }), ...linhas.map(l => new TableRow({ children: l.map((t, i) => cel(t, i, false)) }))] });
}
const S = "✓", X = "✗";
const c = [];

c.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Manual de utilização", bold: true, size: 44, color: MUSGO })] }));
c.push(p("Interruptor inteligente para calha DIN — Tongou TO-Q-SY1 / TO-Q-SY2", { bold: true, size: 26 }));
c.push(p("Tradução para português (Portugal) do manual multilíngue do fabricante Changyou Technology (Zhejiang) Co., Ltd. (marca Tongou). O disjuntor Chayo TO-Q-SY1-JWT comprado na Temu é este mesmo aparelho com outra marca.", { size: 20, color: "5C6446" }));
c.push(h2("Descarregar a aplicação"));
c.push(p("Procure \"Smart Life\" na loja de aplicações ou leia o código QR da caixa e instale a aplicação Smart Life."));

// 1
c.push(h1("1. Aspeto do produto"));
c.push(tabela(["Letra", "Significado"], [
  ["A", "Polo N (neutro)"], ["B", "Polo L (fase)"], ["C", "Corrente nominal"], ["D", "Número do modelo"], ["E", "Indicador LED (luz de sinal)"],
  ["F", "Botão interruptor"], ["G", "Esquema do circuito"], ["H", "Capacidade de ligação (cabos)"], ["I", "Corrente máxima ajustável (modelos SY2)"],
], [1, 8]));
c.push(p(""));
[
  "Terminais superiores: entrada de energia — N à esquerda, L à direita (marcados \"Power\" e \"kWh / W V A\" nos modelos com medição).",
  "Terminais inferiores: saída para a carga (\"Load\").",
  "Versões: Wi-Fi, Zigbee e 4G.",
  "Dimensões: 18 mm de largura (1 módulo), 82 mm de altura; montagem em calha DIN de 35 mm.",
  "Entrada: 90–240 V~, 50/60 Hz, 63 A máx. · Saída: 90–240 V~, 50/60 Hz, 63 A máx. · Carga máxima: 15 120 W.",
].forEach(t => c.push(b(t)));

// 2
c.push(h1("2. Descrição do produto"));
c.push(p("Modelos com \"J\" (JWT, JZT, JLT) = com monitorização de energia. Modelos WT e ZT = sem monitorização de energia."));
c.push(tabela(["Modelo", "Controlo remoto", "Voz", "P/I/U em tempo real", "Consumo", "Temporizações", "Registo", "Proteção do circuito", "Proteção de temperatura", "Wi-Fi", "Zigbee", "4G"], [
  ["TO-Q-SY1-WT", S, S, X, X, S, S, X, X, S, X, X],
  ["TO-Q-SY1-ZT", S, S, X, X, S, S, X, X, X, S, X],
  ["TO-Q-SY1-JWT", S, S, S, S, S, S, X, X, S, X, X],
  ["TO-Q-SY1-JZT", S, S, S, S, S, S, X, X, X, S, X],
  ["TO-Q-SY2-JWT", S, S, S, S, S, S, S, S, S, X, X],
  ["TO-Q-SY2-JZT", S, S, S, S, S, S, S, S, X, S, X],
  ["TO-Q-SY2-JLT-C", S, S, S, S, S, S, S, S, X, X, S],
  ["TO-Q-SY2-JLT-E", S, S, S, S, S, S, S, S, X, X, S],
], [2.2, 0.9, 0.7, 1, 0.9, 1, 0.8, 1, 1, 0.6, 0.7, 0.6]));
c.push(p("Todos os modelos: precisão de medição classe 2.0 · 90–240 V · 1P+N (polo N direto)."));
c.push(h2("Legenda e características"));
[
  "Controlo remoto: pela aplicação no telemóvel.",
  "Controlo por voz: através de assistentes de voz compatíveis.",
  "Potência / corrente / tensão em tempo real.",
  "Consumo de eletricidade (estatísticas de energia).",
  "Temporizações múltiplas (horários).",
  "Registo de operações.",
  "Proteção do circuito: sobrecorrente 1–63 A; subtensão 90–240 V; sobretensão 220–265 V.",
  "Proteção de temperatura.",
  "Wi-Fi: 2,412–2,484 GHz, canais 1–14, IEEE 802.11 b/g/n.",
  "Zigbee: 2,400–2,483 GHz, canais 11–26, IEEE 802.15.4 MAC/PHY.",
  "4G LTE Cat.1: TO-Q-SY2-JLT-C = LTE FDD B1/3/5/8 e LTE TDD B34/38/39/40/41 (banda completa); TO-Q-SY2-JLT-E = LTE FDD B1/2/3/4/5/7/8/28/66.",
  "Corrente: SY1 = 6 A / 10 A / 16 A / 20 A / 25 A / 32 A / 40 A / 50 A / 63 A (fixa, conforme o modelo); SY2 = 1–63 A, corrente ajustável.",
].forEach(t => c.push(b(t)));

// 3
c.push(h1("3. Passos de configuração"));
c.push(h2("3.1 Preparar"));
["Instale a aplicação Smart Life (código QR).", "No telemóvel, ligue o Bluetooth e o Wi-Fi na rede de 2,4 GHz.", "Mantenha o botão do aparelho premido durante 5 segundos para entrar no modo de emparelhamento (o LED azul começa a piscar)."].forEach(t => c.push(n(t, "passos1")));
c.push(h2("3.2 Tipos de ligação"));
c.push(b("Wi-Fi: telemóvel → router Wi-Fi → disjuntor → carga."));
c.push(b("Zigbee: telemóvel → router → gateway Zigbee → disjuntor → carga. Adicione primeiro o gateway e só depois os aparelhos."));
c.push(h2("3.3 Na aplicação"));
c.push(p("Toque em \"+\" no canto superior direito e escolha:"));
c.push(tabela(["Opção", "Para quê"], [["Adicionar dispositivo", "Emparelhar o disjuntor"], ["Criar cena", "Criar cenas e automações"], ["Digitalizar", "Ler um código QR (modelos 4G)"]], [3, 6]));
c.push(h2("3.4 Modelos 4G (LTE Cat.1)"));
c.push(p("Toque em \"Digitalizar\" e leia o código QR que está na lateral do aparelho."));
c.push(h2("3.5 Modelos Wi-Fi / Zigbee"));
c.push(p("A aplicação encontra o aparelho automaticamente; toque na seta para o adicionar e siga as instruções."));

// Esquema
c.push(h1("Esquema de ligação"));
c.push(p("Fase (L) e neutro (N) da alimentação ligam-se aos terminais superiores; a carga (LOAD) liga-se aos terminais inferiores."));
c.push(p("Consulte o esquema de ligação para configurar o equipamento correspondente e o método de ligação, de modo a garantir o funcionamento seguro do equipamento."));

// 4
c.push(h1("4. Descrição do indicador LED"));
c.push(h2("Modelos TO-Q-SY1-WT e TO-Q-SY1-ZT"));
c.push(tabela(["Indicador", "Significado"], [["LED azul a piscar", "Modo de emparelhamento de rede"], ["LED azul fixo", "Interruptor ligado"], ["LED apagado", "Interruptor desligado"]], [3, 6]));
c.push(h2("Modelos TO-Q-SY2-JWT, TO-Q-SY2-JZT, TO-Q-SY2-JLT-C e TO-Q-SY2-JLT-E"));
c.push(tabela(["Indicador", "Significado"], [
  ["LED azul a piscar", "Modo de emparelhamento de rede"],
  ["LED apagado", "Rede perdida ou rede não configurada"],
  ["LED azul fixo", "Rede ligada"],
  ["Botão vermelho fixo", "Interruptor ligado"],
  ["Botão apagado", "Interruptor desligado"],
], [3, 6]));
c.push(nota("Nota do tradutor: o manual não indica em que grupo estão os modelos TO-Q-SY1-JWT e TO-Q-SY1-JZT. Pela fotografia do teu aparelho (luz de sinal separada do botão), deve comportar-se como o segundo grupo — confirma no aparelho."));

// Avisos
c.push(h1("Aviso"));
[
  "Os aparelhos inteligentes devem ser instalados e mantidos sob a orientação de profissionais com as competências e os conhecimentos relacionados com o fabrico e o funcionamento de equipamentos elétricos e com a sua instalação. Estas pessoas devem ter formação em segurança para identificar e evitar potenciais riscos.",
  "Se encontrar algum dano nos aparelhos inteligentes ao abrir a embalagem, não instale o aparelho.",
  "Os aparelhos inteligentes devem ser instalados num quadro elétrico (armário de distribuição) ou no seu interior, isolados por portas ou divisórias, para evitar acesso não autorizado ou acidental.",
  "A instalação e a utilização dos aparelhos inteligentes devem cumprir todos os regulamentos locais, regionais e nacionais aplicáveis.",
  "Ao instalar os aparelhos inteligentes, um técnico instalador profissional deve verificar se a resistência mecânica e a condutividade elétrica são satisfatórias.",
  "O fabricante não se responsabiliza por quaisquer consequências resultantes do não cumprimento deste documento e de outros documentos relacionados.",
].forEach(t => c.push(b(t)));

c.push(h1("Declaração UE de conformidade"));
c.push(p("A Changyou Technology (Zhejiang) Co., Ltd. declara que este produto está em conformidade com os requisitos essenciais e outras disposições relevantes da Diretiva 2014/53/UE. O texto completo da declaração UE de conformidade está disponível em: http://www.tongou.com/usermanuals"));

c.push(h1("Aviso REEE (resíduos de equipamentos elétricos e eletrónicos)"));
c.push(p("Informação sobre eliminação e reciclagem: todos os produtos com este símbolo (contentor de lixo riscado) são resíduos de equipamentos elétricos e eletrónicos (REEE, Diretiva 2012/19/UE) e não devem ser misturados com o lixo doméstico indiferenciado. Para proteger a saúde humana e o ambiente, entregue o equipamento usado num ponto de recolha designado para a reciclagem de REEE, indicado pelo Estado ou pelas autoridades locais. A eliminação e a reciclagem corretas ajudam a evitar potenciais consequências negativas para o ambiente e para a saúde humana. Contacte o instalador ou as autoridades locais para saber a localização e as condições desses pontos de recolha."));

c.push(h1("Declaração FCC (Estados Unidos)"));
c.push(p("Este aparelho cumpre a parte 15 das regras da FCC. O funcionamento está sujeito a duas condições: (1) este aparelho não pode causar interferências prejudiciais e (2) tem de aceitar qualquer interferência recebida, incluindo interferências que possam causar funcionamento indesejado. Alterações ou modificações não aprovadas expressamente pela entidade responsável pela conformidade podem anular a autorização do utilizador para operar o equipamento."));
c.push(p("Nota: este equipamento foi testado e cumpre os limites de um aparelho digital de Classe B, segundo a parte 15 das regras da FCC. Estes limites destinam-se a dar uma proteção razoável contra interferências prejudiciais numa instalação residencial. Este equipamento gera, usa e pode emitir energia de radiofrequência e, se não for instalado e usado de acordo com as instruções, pode causar interferências prejudiciais nas comunicações de rádio. Não há garantia de que não ocorram interferências numa determinada instalação. Se o equipamento causar interferências na receção de rádio ou televisão (o que se verifica desligando-o e ligando-o), o utilizador pode tentar corrigi-las: reorientar ou mudar de sítio a antena recetora; aumentar a distância entre o equipamento e o recetor; ligar o equipamento a uma tomada de um circuito diferente do recetor; pedir ajuda ao vendedor ou a um técnico de rádio/TV com experiência."));
c.push(p("Este equipamento cumpre os limites de exposição à radiação da FCC para um ambiente não controlado. Deve ser instalado e utilizado com uma distância mínima de 20 cm entre o radiador (antena) e o corpo. Os utilizadores devem seguir as instruções de funcionamento para cumprir a exposição a radiofrequência."));

c.push(h1("Instruções de montagem — disjuntores diferenciais e magnetotérmicos Tongou"));
c.push(p("(Página só com desenhos, para os modelos TOMD6, TORD4(B) e TOMP65. Os pontos marcados com * são a interpretação dos desenhos, não texto do fabricante.)"));
[
  "⚠ Perigo de morte — risco elétrico.",
  "Montagem exclusivamente por eletricistas qualificados.",
  "Altitude de funcionamento: até 2000 m.",
  "Temperatura ambiente de funcionamento: TORD4(B) −5 a 40 °C; TOMP65 e TOMD6 −30 a 70 °C.",
  "Classes de montagem: II e III.",
  "Montagem em calha DIN de 35 mm (perfil 35 × 7,5 mm).",
  "* Alimentação indiferente por cima ou por baixo (N e L1, ou N, L1, L2, L3 nos tetrapolares).",
  "Aperto dos terminais: 2–2,4 N·m. Cabo 1,5–35 mm²; cabo flexível 2,5–35 mm² sem ponteira. Barramento/pente: ver cotas no desenho (5 mm; 0,8–2 mm; Ø 1–25 mm²; 12 mm).",
  "* Rearme (RESET) depois de um disparo: 1 — alavanca para baixo (OFF); 2 — alavanca para cima (ON).",
  "* Teste do diferencial: com o aparelho ligado, carregue no botão de teste (T); ouve-se o clique e o aparelho dispara. Se não disparar, há perigo elétrico: não o utilize e chame um eletricista.",
].forEach(t => c.push(b(t)));

c.push(h1("Contacto do fabricante"));
c.push(p("Changyou Technology (Zhejiang) Co., Ltd. · Apoio: support@tongou.com · www.tongou.com"));
c.push(p("Tongou é uma marca registada e propriedade da Changyou Technology, das suas subsidiárias e empresas associadas."));

const num = ref => ({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] });
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: FLORESTA } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: MUSGO }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: ARGILA }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: "pontos", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    num("passos1"),
  ] },
  sections: [{
    properties: { page: { margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], size: 16, color: "5C6446" })] })] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync("Manual_Disjuntor_Tongou_PT.docx", buf); console.log("ok"); });
