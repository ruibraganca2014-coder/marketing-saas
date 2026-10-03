// Guia de diagnóstico de avarias elétricas (docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): conteúdo estruturado,
// sem DOM, usado pela ficha do pedido (ecras/orcamentos.js), pelo ecrã "Ajuda técnica" (ecras/ajuda.js), pelo
// relatório técnico (ecras/simulacao.js) e pelo servidor (validar.js: as chaves da lista de verificação). A fase 4
// (/eletricista) reutiliza-o. Textos nossos, para um eletricista habilitado: as fontes (dois infográficos do dono e um
// artigo sobre os três passos e as oito técnicas) serviram só de referência — não se copiam frases nem figuras. Onde a
// RTIEBT (Portaria 949-A/2006, consolidada 2015; scratchpad verificacao/rtiebt-valores.md) dá valores, cita-se o
// artigo; os números das fontes que a RTIEBT não fixa vão marcados "referência prática".

/** Regras de segurança: antes de tudo, sempre. */
export const SEGURANCA = [
  { titulo: "Cortar no quadro", texto: "Desligar o circuito (ou o geral) no quadro antes de mexer em caixas, tomadas ou aparelhagem; sinalizar o disjuntor para ninguém o voltar a ligar." },
  { titulo: "Confirmar a ausência de tensão", texto: "Depois de cortar, medir no ponto de trabalho com o multímetro ou o detetor sem contacto — testar o aparelho antes num ponto com tensão conhecida." },
  { titulo: "Nunca trabalhar com tensão", texto: "As medições com tensão fazem-se com pontas e ferramentas isoladas, de pé seco e sem tocar em massas; tudo o resto faz-se sem tensão." },
  { titulo: "Fumo, faíscas ou cheiro a queimado", texto: "Parar, cortar o geral e não religar até encontrar a causa. Não se insiste num disjuntor que dispara logo." },
  { titulo: "Equipamento de proteção", texto: "Luvas isolantes e óculos nos ensaios com tensão e junto ao quadro; nunca medir resistências ou isolamento num circuito ainda ligado." },
];

/** Sinais de alarme que o cliente descreve (ou que se veem na visita) e o que costumam indicar. */
export const SINAIS = [
  { sinal: "Luzes a piscar ou a variar de intensidade", indica: "Ligação solta, neutro fraco, circuito perto do limite ou problema na alimentação." },
  { sinal: "Diferencial a disparar com frequência", indica: "Fuga à terra num aparelho ou numa canalização (humidade, isolamento gasto) ou diferencial a precisar de substituição." },
  { sinal: "Disjuntor que dispara sempre que se liga uma carga", indica: "Sobrecarga (demasiadas cargas no mesmo circuito) ou curto-circuito no aparelho ou na instalação." },
  { sinal: "Cheiro a queimado, tomadas ou aparelhagem escurecidas, plástico deformado", indica: "Aquecimento por ligação solta ou contacto mau: risco de incêndio, tratar logo." },
  { sinal: "Zumbido ou crepitar no quadro ou numa tomada", indica: "Arco elétrico num borne ou num aparelho de corte: cortar e inspecionar." },
  { sinal: "Choque ao tocar num aparelho ou numa torneira", indica: "Fuga à terra com proteção em falta (sem PE, sem diferencial ou terra deficiente)." },
];

/** Ferramentas e para que servem. */
export const FERRAMENTAS = [
  { nome: "Multímetro digital", uso: "Tensão c.a./c.c., continuidade (sinal sonoro) e resistência; com pontas isoladas e a escala certa antes de medir." },
  { nome: "Detetor de tensão sem contacto", uso: "Primeira verificação rápida de \"há ou não há tensão\" num cabo ou tomada; nunca substitui a medição no multímetro." },
  { nome: "Testador de tomadas", uso: "Fase, neutro e terra bem ligados, inversões e terra em falta numa tomada, sem a abrir; os melhores disparam o diferencial para o testar." },
  { nome: "Localizador de circuitos", uso: "Saber a que disjuntor pertence uma tomada ou um ponto de luz sem andar a desligar tudo." },
  { nome: "Pinça amperimétrica", uso: "Corrente real de cada circuito e de cada fase, com tensão, sem abrir o circuito; sobrecargas e desequilíbrios." },
  { nome: "Medidor de isolamento (megaohmímetro)", uso: "Resistência de isolamento entre condutores e à terra, a 500 V c.c., com os aparelhos desligados." },
  { nome: "Testador de diferenciais / verificador de instalações", uso: "Corrente e tempo de disparo do diferencial, impedância da malha e resistência de terra." },
  { nome: "Câmara termográfica (se houver)", uso: "Pontos quentes no quadro e nas ligações, com carga, sem tocar em nada." },
];

/**
 * Os três passos do diagnóstico, com os sub-passos. A ordem é esta; voltar atrás se o passo seguinte não confirmar
 * o anterior.
 */
export const PASSOS = [
  {
    titulo: "Recolher informação e tornar seguro",
    passos: [
      "Ouvir o cliente: o que falha, desde quando, se é constante ou intermitente, o que mudou (aparelho novo, obra, chuva, trovoada).",
      "Olhar para o quadro: calibres e posições dos disjuntores e diferenciais, o que está disparado, sinais de aquecimento; carregar no botão de teste do diferencial.",
      "Cortar o circuito em causa, confirmar a ausência de tensão no ponto de trabalho e sinalizar o disjuntor.",
      "Confirmar a avaria: experimentar um aparelho que se sabe bom na tomada suspeita (e o aparelho suspeito numa tomada boa); anotar se o problema é constante ou intermitente.",
    ],
  },
  {
    titulo: "Localizar e isolar a avaria",
    passos: [
      "Dividir a instalação: com todos os disjuntores de saída desligados, religar um a um até o defeito aparecer; depois desligar os aparelhos desse circuito um a um.",
      "Sobrecarga: somar a potência do que está ligado no circuito e comparar com o calibre; um disjuntor que dispara só ao fim de minutos aponta para sobrecarga, um que dispara logo para curto-circuito.",
      "Medir: tensão nos pontos certos (com tensão), continuidade e resistência dos condutores e do PE (sem tensão), isolamento à terra (sem tensão, aparelhos desligados).",
      "Inspeção visual dos pontos suspeitos: bornes soltos, condutores escurecidos, humidade, roedores, cabos esmagados ou furados.",
    ],
  },
  {
    titulo: "Reparar, substituir e verificar",
    passos: [
      "Corrigir a causa, não o sintoma: apertar ou refazer a ligação, substituir o troço de cabo ou o aparelho, redistribuir cargas ou criar um circuito.",
      "Repetir os ensaios depois da reparação (continuidade do PE, isolamento, diferencial) e os anteriores que ela possa ter afetado (RTIEBT 612.1).",
      "Ensaio funcional com carga real e, se possível, nas condições em que a avaria aparecia (aparelho ligado, hora do dia, chuva).",
      "Registar o que se encontrou, o que se fez e os valores medidos (a ficha do pedido tem o lugar para isto).",
    ],
  },
];

/** As oito técnicas: o que é, quando se usa, com que ferramenta. */
export const TECNICAS = [
  { nome: "Inspeção visual", oQue: "Olhar e cheirar antes de medir: quadro, caixas, tomadas, cabos à vista.", quando: "Sempre, no início e depois da reparação.", ferramenta: "Lanterna, chave de parafusos isolada." },
  { nome: "Isolamento por partes", oQue: "Desligar tudo e religar por secções (disjuntores, depois aparelhos) até o defeito surgir.", quando: "Disjuntor ou diferencial que dispara sem causa óbvia.", ferramenta: "O próprio quadro; etiquetas." },
  { nome: "Medição de tensão", oQue: "Confirmar se a alimentação chega e com que valor, ponto a ponto, a partir do quadro.", quando: "Sem corrente numa tomada ou num circuito; luz fraca ou a piscar.", ferramenta: "Multímetro em c.a.; detetor sem contacto como primeira triagem." },
  { nome: "Continuidade", oQue: "Verificar se um condutor está inteiro de uma ponta à outra (sinal sonoro, resistência muito baixa).", quando: "Suspeita de condutor partido, fusível fundido, interruptor ou relé que não fecha; PE das tomadas.", ferramenta: "Multímetro em continuidade, sempre sem tensão." },
  { nome: "Termografia", oQue: "Ver pontos quentes nas ligações e nos aparelhos de corte com a instalação em carga.", quando: "Cheiro a queimado sem marca visível; quadros com muitos circuitos; manutenção.", ferramenta: "Câmara termográfica (ou termómetro de infravermelhos)." },
  { nome: "Seguir o sinal", oQue: "Seguir a alimentação ao longo do percurso (quadro → caixas → ponto) até ao sítio onde deixa de chegar.", quando: "Cabos embebidos sem planta; troço partido numa canalização comprida.", ferramenta: "Localizador de circuitos/cabos, multímetro." },
  { nome: "Resistência de isolamento", oQue: "Medir, a 500 V c.c., a resistência entre cada condutor ativo e a terra (e entre condutores), com os aparelhos desligados.", quando: "Diferencial a disparar, humidade, cabos velhos ou danificados; antes de dar uma reparação por concluída.", ferramenta: "Medidor de isolamento." },
  { nome: "Ensaio funcional", oQue: "Pôr tudo a funcionar com carga real e observar: tensão em carga, aquecimento, disparo do diferencial pelo botão e pelo testador.", quando: "No fim, sempre; e para reproduzir avarias intermitentes.", ferramenta: "Cargas reais, pinça amperimétrica, testador de diferenciais." },
];

/**
 * Os quatro tipos de avaria: causas, sintomas, como se testa, a proteção que atua e o perigo. `chave` é o que a ficha
 * guarda em `diagnostico.tipo`.
 */
export const TIPOS_AVARIA = [
  {
    chave: "aberto", nome: "Circuito aberto", perigo: "baixo",
    causas: "Condutor partido, borne solto, fusível fundido, interruptor ou relé que não fecha.",
    sintomas: "Não há corrente no ponto; nada aquece nem dispara.",
    teste: "Continuidade sem tensão (troço a troço) ou tensão com tensão a partir do quadro até ao ponto em que deixa de haver.",
    protecao: "Nenhuma atua: o circuito simplesmente não funciona.",
  },
  {
    chave: "curto", nome: "Curto-circuito", perigo: "alto",
    causas: "Isolamento danificado, cabo esmagado ou furado, humidade numa caixa, aparelho avariado.",
    sintomas: "O disjuntor dispara de imediato ao ligar; marcas de arco, estalo.",
    teste: "Sem tensão e com as cargas desligadas, resistência entre fase e neutro (e à terra) perto de 0 Ω aponta para o curto; isolar por partes para o localizar.",
    protecao: "Disjuntor (magnético) ou fusível. Risco de arco: não religar sem encontrar a causa.",
  },
  {
    chave: "terra", nome: "Fuga à terra (defeito de isolamento)", perigo: "alto",
    causas: "Corrente a escapar de um condutor ativo para a terra ou para a carcaça: humidade, isolamento gasto, cabo a tocar numa massa.",
    sintomas: "Diferencial a disparar (às vezes só com chuva ou com um aparelho); choque ao tocar numa massa.",
    teste: "Resistência de isolamento a 500 V c.c., circuito a circuito e aparelho a aparelho; medir a corrente de fuga com pinça adequada.",
    protecao: "Diferencial (30 mA nas tomadas e locais húmidos). Risco de eletrocussão quando a proteção falha ou não existe.",
  },
  {
    chave: "sobrecarga", nome: "Sobrecarga", perigo: "médio",
    causas: "Demasiada corrente para o condutor ou para a proteção: cargas a mais no circuito, secção curta, motor preso, desequilíbrio entre fases.",
    sintomas: "O disjuntor dispara ao fim de algum tempo com carga; cabos e tomadas quentes; luz a baixar quando se liga uma máquina.",
    teste: "Pinça amperimétrica com a carga ligada, por circuito e por fase; somar as potências e comparar com o calibre e a secção.",
    protecao: "Disjuntor (térmico), fusível ou relé térmico num motor. Risco de incêndio por aquecimento.",
  },
];

/** Nome legível de um tipo de avaria (ou "Outro"). */
export const NOME_TIPO = Object.fromEntries(TIPOS_AVARIA.map((t) => [t.chave, t.nome]));
NOME_TIPO.outro = "Outra causa";

/**
 * Valores de referência das medições. `fonte` "RTIEBT" cita o artigo; "referência prática" é o valor habitual que as
 * fontes dão e que a RTIEBT não fixa — a confirmar pelo técnico.
 */
export const VALORES = [
  { medicao: "Tensão de alimentação (c.a.)", valor: "230 V ± 10 % (207 a 253 V)", fonte: "referência prática", nota: "Valor nominal da rede BT; a RTIEBT não fixa a tolerância na verificação." },
  { medicao: "Continuidade de um condutor", valor: "sinal sonoro; menos de cerca de 50 Ω", fonte: "referência prática", nota: "Depende do comprimento e da secção; serve para \"está inteiro / está partido\"." },
  { medicao: "Continuidade do condutor de proteção (PE) e das ligações equipotenciais", valor: "valor medido, sem limite fixado; fonte de 4 a 24 V, ≥ 0,2 A", fonte: "RTIEBT 612.2", nota: "Na prática, tomada → quadro abaixo de 0,5 Ω (referência prática)." },
  { medicao: "Resistência de isolamento (cada condutor ativo à terra)", valor: "≥ 0,5 MΩ a 500 V c.c., aparelhos desligados", fonte: "RTIEBT 612.3 (Quadro 61A)", nota: "Circuitos até 500 V; TRS/TRP ≥ 0,25 MΩ a 250 V. Valores do DR original." },
  { medicao: "Disparo do diferencial", valor: "dispara a uma corrente ≤ IΔn", fonte: "RTIEBT Anexo B", nota: "A RTIEBT não fixa tempo; os ≤ 300 ms a IΔn (tipo geral) são das normas de produto EN 61008/61009 (referência prática)." },
  { medicao: "Resistência de terra das massas (habitação com disjuntor de entrada diferencial)", valor: "≤ 100 Ω; e RA × IΔn ≤ 50 V", fonte: "RTIEBT 801.5.6.1 e 413.1.4.2", nota: "Com 30 mA o limite da fórmula é 1667 Ω; os 100 Ω são a exigência explícita para habitações." },
  { medicao: "Ordem dos ensaios", valor: "inspeção visual; depois continuidade do PE → isolamento → separação de circuitos → corte automático (terra, malha, diferencial) → polaridade → funcionais", fonte: "RTIEBT 611.1 e 612.1", nota: "Um ensaio que falha repete-se depois da correção, com os anteriores que possa ter afetado." },
];

/** Quando parar e pedir ajuda ou outra equipa. */
export const PARAR = [
  "Fumo, fogo, arco ou cheiro forte a queimado no quadro: cortar o geral, afastar as pessoas e não religar.",
  "Avaria a montante do contador ou da portinhola (sem tensão à entrada, neutro da rede em falta, tensão muito fora dos 230 V): é do distribuidor de energia.",
  "Quadro antigo com fusíveis, sem diferencial ou com sinais de aquecimento generalizado: não se repara um ponto; propõe-se a substituição do quadro.",
  "Fuga à terra que não se localiza em canalizações embebidas: planear a abertura de roços ou a passagem de cabo novo em vez de insistir.",
  "Trifásico, cargas industriais, geradores ou fotovoltaico com baterias sem a formação específica: pedir apoio.",
];

/**
 * O que o cliente escolheu no simulador (estado.js AVARIA_PROBLEMA: sem_corrente, luz, disjuntor, queimado, faiscas,
 * choque, outro) → os tipos de avaria prováveis (chaves de TIPOS_AVARIA) e as primeiras verificações.
 */
export const PROBLEMAS = {
  sem_corrente: { nome: "Tomada sem corrente", tipos: ["aberto"], verificar: "Ver se o disjuntor ou o diferencial estão disparados; tensão na tomada (fase-neutro, fase-terra); testador de tomadas; continuidade da fase e do neutro desde a caixa anterior; borne solto na própria tomada ou numa tomada em série." },
  luz: { nome: "Luz não acende", tipos: ["aberto"], verificar: "Lâmpada e casquilho primeiro; tensão no casquilho com o interruptor ligado; continuidade do interruptor (ou comutadores/telerruptor); ligação no casquilho e na caixa de derivação." },
  disjuntor: { nome: "Disjuntor dispara", tipos: ["sobrecarga", "curto"], verificar: "Dispara logo ao ligar → curto-circuito (isolar por partes, resistência fase-neutro sem tensão). Dispara ao fim de um tempo com carga → sobrecarga (pinça amperimétrica, somar potências, calibre e secção). Se for o diferencial que dispara → fuga à terra (isolamento)." },
  queimado: { nome: "Cheiro a queimado", tipos: ["sobrecarga", "curto"], verificar: "Cortar o geral. Procurar tomadas, interruptores e bornes escurecidos ou deformados; apertos no quadro; termografia se houver. Não religar antes de substituir o que aqueceu." },
  faiscas: { nome: "Faz faíscas", tipos: ["curto", "aberto"], verificar: "Cortar o circuito. Faísca numa tomada ao ligar um aparelho → contacto gasto ou aparelho em curto; faísca num interruptor ou no quadro → borne solto com arco (circuito a abrir e fechar). Substituir o aparelho e refazer a ligação." },
  choque: { nome: "Dá choque", tipos: ["terra"], verificar: "Cortar o circuito. Confirmar o PE na tomada (testador, continuidade tomada → quadro) e a existência e o funcionamento do diferencial (botão e testador); isolamento do aparelho e do circuito à terra; ligação equipotencial nas casas de banho." },
  outro: { nome: "Outro", tipos: [], verificar: "Seguir os três passos: ouvir o cliente e reproduzir a avaria; isolar por partes; medir tensão, continuidade e isolamento antes de concluir." },
};

/** Tipos prováveis e primeiras verificações para uma lista de chaves de problema (sem repetir). */
export function sugestoesPara(problemas) {
  const chaves = (Array.isArray(problemas) ? problemas : [problemas]).filter((k) => typeof k === "string" && PROBLEMAS[k]);
  return [...new Set(chaves)].map((k) => ({ chave: k, ...PROBLEMAS[k], tiposNome: PROBLEMAS[k].tipos.map((t) => NOME_TIPO[t]) }));
}

/**
 * Lista de verificação do diagnóstico (ficha do pedido). `valor` = a medição opcional que acompanha o passo
 * (unidade e limites aceites pelo servidor); `referencia` = o valor de referência curto.
 */
export const CHECKLIST = [
  { chave: "isolado", nome: "Circuito isolado no quadro e ausência de tensão confirmada no ponto de trabalho" },
  { chave: "visual", nome: "Inspeção visual do quadro, das caixas e da aparelhagem em causa" },
  { chave: "rcd", nome: "Teste do diferencial (botão e testador)", valor: { unidade: "ms", max: 10_000, casas: 0 }, referencia: "dispara a ≤ IΔn (RTIEBT Anexo B); ≤ 300 ms é referência prática" },
  { chave: "tensao", nome: "Tensão medida no ponto da avaria", valor: { unidade: "V", max: 1000, casas: 1 }, referencia: "230 V ± 10 % (referência prática)" },
  { chave: "continuidade", nome: "Continuidade dos condutores e do PE", valor: { unidade: "Ω", max: 1_000_000, casas: 3 }, referencia: "PE: valor medido (RTIEBT 612.2); condutor inteiro: sinal sonoro" },
  { chave: "isolamento", nome: "Resistência de isolamento (500 V c.c., aparelhos desligados)", valor: { unidade: "MΩ", max: 100_000, casas: 3 }, referencia: "≥ 0,5 MΩ (RTIEBT 612.3)" },
  { chave: "funcional", nome: "Ensaio funcional com carga depois da reparação" },
];
export const CHAVES_CHECKLIST = CHECKLIST.map((c) => c.chave);
export const CHAVES_VALOR = CHECKLIST.filter((c) => c.valor).map((c) => c.chave);
export const MAX_CONCLUSAO = 2000;
