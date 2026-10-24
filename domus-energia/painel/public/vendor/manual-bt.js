// Índice do manual de instalações elétricas de baixa tensão da empresa (decisões do dono, 2026-10-24): as partes e os
// capítulos com a página impressa, para a "Ajuda técnica" da área do eletricista (web/eletricista.js) e a "Ajuda" do
// painel (painel/public/vendor/manual-bt.js, cópia igual; painel/test/manual.test.js compara-as). O PDF não é público:
// só sai com sessão (painel/src/manual.js). A capa não tem número: a página do PDF é a impressa + 1 (#page=N).
// Só dados e funções puras, sem DOM.

export const MANUAL_BT = {
  titulo: "Manual do instalador — Instalações elétricas de baixa tensão",
  edicao: "Edição 2026",
  resumo: "Das bases da eletricidade ao projeto, à execução e à verificação, segundo as RTIEBT: circuitos, cabos, quadros, proteções, locais especiais, motores e telecomunicações.",
  nota: "Edição provisória: o nome Adomus vai passar a Domus Energia.",
  ficheiro: "manual-instalacoes-bt.pdf",
  paginas: 133,
  partes: [
    { titulo: "Apresentação", pagina: 3, capitulos: [{ n: "—", titulo: "Apresentação e como usar este manual", pagina: 3 }] },
    {
      titulo: "Parte 0 · Bases de eletricidade e medidas", pagina: 4, capitulos: [
        { n: "B1", titulo: "Grandezas elétricas e circuitos de corrente contínua", resumo: "Ohm, Joule, potência, energia, série/paralelo, Kirchhoff", pagina: 5 },
        { n: "B2", titulo: "Corrente alternada e sistemas trifásicos", resumo: "Sinusoide, impedância, fator de potência, estrela e triângulo", pagina: 9 },
        { n: "B3", titulo: "Magnetismo, transformadores e motores", resumo: "Eletromagnetismo, relação de transformação, chapa do motor", pagina: 12 },
        { n: "B4", titulo: "Medidas elétricas e segurança na medição", resumo: "Instrumentos, erros, classes de exatidão, categorias, regras de ouro", pagina: 14 },
        { n: "B5", titulo: "Segurança no trabalho, ferramentas e materiais", resumo: "Riscos, EPI, acidente elétrico, ferramentas, preparação de condutores", pagina: 18 },
      ],
    },
    {
      titulo: "Parte 1 · Fundamentos do projeto", pagina: 21, capitulos: [
        { n: "01", titulo: "Elementos do projeto", resumo: "Documentos, enquadramento legal, critérios e esquemas de ligação à terra", pagina: 22 },
        { n: "02", titulo: "Previsão de cargas", resumo: "Pontos de luz, tomadas, aparelhos fixos e potência a contratar", pagina: 28 },
        { n: "03", titulo: "Divisão da instalação em circuitos", resumo: "Critérios, circuitos dedicados, quadro e simbologia", pagina: 33 },
        { n: "04", titulo: "Condutores e cabos", resumo: "Constituição, isolamentos, designações e cores", pagina: 42 },
      ],
    },
    {
      titulo: "Parte 2 · Dimensionamento", pagina: 46, capitulos: [
        { n: "05", titulo: "Dimensionamento de condutores I", resumo: "Corrente de serviço, secções mínimas, corrente admissível e fatores de correção", pagina: 47 },
        { n: "06", titulo: "Dimensionamento de condutores II", resumo: "Queda de tensão, sobrecarga e curto-circuito", pagina: 52 },
        { n: "07", titulo: "Tubos, calhas e caminhos de cabos", resumo: "Tipos de condutas, taxa de ocupação e escolha do diâmetro", pagina: 56 },
        { n: "08", titulo: "Quadros, esquemas e entrada de energia", resumo: "Esquema unifilar, quadro de cargas, equilíbrio de fases e edifícios coletivos", pagina: 60 },
      ],
    },
    {
      titulo: "Parte 3 · Iluminação e segurança", pagina: 67, capitulos: [
        { n: "09", titulo: "Iluminação", resumo: "Grandezas, fontes LED e método dos lúmens", pagina: 68 },
        { n: "10", titulo: "Proteção contra sobreintensidades", resumo: "Fusíveis, disjuntores, curvas, poder de corte e seletividade", pagina: 72 },
        { n: "11", titulo: "Choques elétricos, terras e sobretensões", resumo: "Diferenciais, elétrodo de terra, casas de banho e descarregadores", pagina: 77 },
      ],
    },
    {
      titulo: "Parte 4 · Locais especiais, edifícios e verificação", pagina: 85, capitulos: [
        { n: "12", titulo: "Influências externas e códigos IP/IK", resumo: "Classificação dos locais, graus de proteção por local", pagina: 86 },
        { n: "13", titulo: "Locais e instalações especiais", resumo: "Piscinas, saunas, estaleiros, garagens, VE, campismo e marinas, agrícolas, ATEX", pagina: 89 },
        { n: "14", titulo: "Edifícios coletivos", resumo: "Portinholas, colunas, entradas e condomínios fechados", pagina: 95 },
        { n: "15", titulo: "Iluminação de segurança", resumo: "Categorias por lotação, tipos A–D, quadro de segurança", pagina: 98 },
        { n: "16", titulo: "Verificação, ensaios e entrega", resumo: "Inspeção visual, ensaios, verificações periódicas", pagina: 101 },
      ],
    },
    {
      titulo: "Parte 5 · Força motriz, comunicações, renováveis e manutenção", pagina: 104, capitulos: [
        { n: "17", titulo: "Força motriz e automatismos", resumo: "Proteção de motores, arranque direto, estrela-triângulo, inversão", pagina: 105 },
        { n: "18", titulo: "Sinalização, telecomunicações e para-raios", resumo: "Campainhas, videoporteiros, ITED, SPDA", pagina: 108 },
        { n: "19", titulo: "Autoconsumo fotovoltaico", resumo: "Componentes, proteção CC/CA, dimensionamento, DL 15/2022", pagina: 112 },
        { n: "20", titulo: "Diagnóstico de avarias e manutenção", resumo: "Método, sintoma → causa → ação, manutenção preventiva", pagina: 115 },
        { n: "21", titulo: "Domótica, automação e sistemas de segurança", resumo: "KNX, DALI, relés programáveis, intrusão e incêndio", pagina: 118 },
        { n: "22", titulo: "Alimentação de socorro e qualidade da energia", resumo: "Grupos geradores, UPS, compensação do fator de potência, harmónicos", pagina: 122 },
      ],
    },
    {
      titulo: "Anexos", pagina: 126, capitulos: [
        { n: "A", titulo: "Consulta rápida", resumo: "Checklist de entrega da obra · Mapa de quantidades", pagina: 126 },
        { n: "B", titulo: "Simbologia", resumo: "Símbolos unifilares de iluminação, comando, tomadas, quadros, automatismos e aparelhos", pagina: 128 },
        { n: "C", titulo: "Índice remissivo", resumo: "Termos técnicos e páginas onde são tratados", pagina: 130 },
      ],
    },
  ],
};

/** Página do PDF de uma página impressa (a capa não tem número). */
export const paginaPdf = (impressa) => impressa + 1;

/** Endereço do PDF (`base`: o endereço do manual na API) aberto na página impressa `pagina`, ou no início. */
export const ligacaoManual = (base, pagina = null) => (Number.isInteger(pagina) ? `${base}#page=${paginaPdf(pagina)}` : base);
