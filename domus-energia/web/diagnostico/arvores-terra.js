// Árvores de diagnóstico — choques, terra e isolamento (ronda 1; manual de instalações BT, caps. 11, 16 e 20).
// Formato em web/diagnostico/motor.js. Textos nossos, curtos, a partir do manual da empresa.
import { ISOLAMENTO, TERRA, CONTINUIDADE_PE, REF } from "./limites.js";

const SEM_TENSAO = "Sem tensão: regras de ouro cumpridas no circuito em causa.";

export const CHOQUE = {
  id: "choque", versao: 1, grupo: "Terra e isolamento",
  titulo: "Choque ou formigueiro ao tocar numa massa",
  sintoma: "Formigueiro ou choque na carcaça de um aparelho, numa torneira ou em várias partes metálicas.",
  inicio: "pessoa",
  nos: {
    pessoa: {
      tipo: "simnao", texto: "A pessoa que sentiu o choque está bem (sem perda de sentidos, falta de ar, queimaduras, nem choque através do peito)?", ref: [REF.b5acidente, REF.m11_1],
      fazer: "Mesmo sem sintomas, quem levou um choque deve ser observado por um médico.",
      sim: "parar_uso", nao: "fim_socorro",
    },
    parar_uso: {
      tipo: "simnao", texto: "Já desligou o aparelho ou o circuito em causa e avisou o cliente para não lhe tocar até ao fim do diagnóstico?", ref: [REF.m20_2, REF.b44],
      sim: "onde", nao: "fim_isolar",
    },
    onde: {
      tipo: "escolha", texto: "Onde se sente o choque ou o formigueiro?", ref: [REF.m20_2, REF.m11_2],
      opcoes: [
        { texto: "Na carcaça de um aparelho (máquina de lavar, frigorífico, termoacumulador…)", seguinte: "aparelho_outra" },
        { texto: "Numa torneira, banheira, base de duche ou canalização", seguinte: "equipotencial" },
        { texto: "Em várias partes metálicas ou aparelhos da casa", seguinte: "condutor_terra" },
      ],
    },
    aparelho_outra: {
      tipo: "simnao", texto: "Ligado a outra tomada com a terra confirmada (testador de tomadas), o aparelho continua a dar formigueiro?", ref: [REF.m20_2, REF.m11_2],
      fazer: "Só com o diferencial dessa tomada testado no botão T.",
      sim: "fim_aparelho", nao: "pe_tomada",
    },
    pe_tomada: {
      tipo: "valor", texto: "Continuidade do condutor de proteção (PE): borne de terra da tomada → barramento de terra do quadro", ref: [REF.m16_2, REF.m20_2],
      fazer: `${SEM_TENSAO} Ohmímetro de baixa resistência (ou o verificador de instalações) com uma ponta no borne de terra da tomada e a outra no barramento de terra.`,
      unidade: "Ω", casas: 2, max: 1_000_000, limite: { ...CONTINUIDADE_PE },
      dentro: "diferencial", fora: "fim_pe_interrompido", ficha: { verificacao: "continuidade", valor: "continuidade" },
    },
    diferencial: {
      tipo: "simnao", texto: "O circuito tem diferencial de 30 mA e ele dispara no botão T e no testador (entre ½ IΔn e IΔn)?", ref: [REF.m11_3, REF.m16_2], tensao: true,
      sim: "terra_valor", nao: "fim_sem_diferencial", ficha: { verificacao: "rcd" },
    },
    terra_valor: {
      tipo: "valor", texto: "Resistência de terra (elétrodo)", ref: [REF.m11_4b, REF.m11_4c],
      fazer: "Terrómetro pelo método dos três elétrodos (ligador amovível aberto, instalação desligada) ou com pinça de terra.",
      unidade: "Ω", casas: 1, max: 100_000, limite: { ...TERRA },
      dentro: "equipotencial", fora: "fim_seguir_terra",
    },
    equipotencial: {
      tipo: "simnao", texto: "Na casa de banho, a ligação equipotencial suplementar existe e liga ao PE as canalizações metálicas e as massas dos volumes 0 a 3?", ref: [REF.m11_5, REF.m11_6],
      fazer: `${SEM_TENSAO} Meça a continuidade entre a torneira/banheira e o borne de terra mais próximo.`,
      sim: "fim_fuga_pequena", nao: "fim_equipotencial", ficha: { verificacao: "continuidade" },
    },
    condutor_terra: {
      tipo: "valor", texto: "Continuidade do condutor de terra: barramento de terra do quadro → ligador amovível / terminal principal de terra", ref: [REF.m11_4c, REF.m16_2],
      fazer: `${SEM_TENSAO} Veja também se o ligador amovível está fechado e apertado.`,
      unidade: "Ω", casas: 2, max: 1_000_000, limite: { ...CONTINUIDADE_PE },
      dentro: "diferencial", fora: "fim_condutor_terra", ficha: { verificacao: "continuidade", valor: "continuidade" },
    },
    fim_socorro: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.b5acidente,
      causa: "Acidente elétrico: a pessoa precisa de socorro.",
      acao: "Cortar a energia sem tocar na vítima enquanto estiver em contacto; ligar 112 e dizer que foi um choque elétrico; se não respirar e souber, iniciar suporte básico de vida. O diagnóstico fica para depois.",
    },
    fim_isolar: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: [REF.m20_2, REF.b44],
      causa: "Massa em tensão por defeito ainda ligada: risco de choque para quem lhe tocar.",
      acao: "Desligar já o aparelho e o circuito, bloquear e sinalizar, avisar o cliente; depois recomeçar o diagnóstico.",
    },
    fim_aparelho: {
      tipo: "fim", tipoAvaria: "terra", ref: REF.m20_2,
      causa: "Defeito de isolamento no próprio aparelho (a carcaça fica em tensão).",
      acao: "Não usar o aparelho: reparação ou substituição. Confirmar o PE e o diferencial da tomada onde estava ligado.",
    },
    fim_pe_interrompido: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.m16_2],
      causa: "Condutor de proteção (PE) interrompido ou com resistência alta entre a tomada e o quadro.",
      acao: "Não usar a tomada até corrigir; refazer o PE (bornes, caixas, condutor) e voltar a medir a continuidade em todas as tomadas do circuito.",
    },
    fim_sem_diferencial: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m11_3, REF.m11_2],
      causa: "Sem diferencial de 30 mA a funcionar no circuito (em falta, avariado ou a não disparar no ensaio).",
      acao: "Instalar ou substituir o diferencial de 30 mA tipo A (obrigatório nas tomadas, casas de banho e exteriores) e ensaiar: disparo entre ½ IΔn e IΔn.",
    },
    fim_seguir_terra: {
      tipo: "fim", tipoAvaria: "terra", seguir: "terra", ref: REF.m11_4b,
      causa: "Resistência de terra acima do valor do manual: a massa pode subir a uma tensão perigosa antes de o diferencial cortar.",
      acao: "Continuar com a árvore «Terra fora do valor».",
    },
    fim_equipotencial: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m11_5, REF.m11_6],
      causa: "Falta ou está interrompida a ligação equipotencial (principal ou suplementar da casa de banho).",
      acao: "Executar a ligação equipotencial: canalizações de água e gás no terminal principal de terra e, na casa de banho, todos os elementos condutores dos volumes 0 a 3 ligados ao PE.",
    },
    fim_fuga_pequena: {
      tipo: "fim", tipoAvaria: "terra", seguir: "isolamento", ref: [REF.m20_2, REF.m16_2],
      causa: "PE, terra e diferencial estão bem: há uma fuga pequena (abaixo do disparo do diferencial) num aparelho ou num circuito.",
      acao: "Medir o isolamento dos circuitos e dos aparelhos fixos (árvore «Isolamento baixo») e substituir o que tiver defeito.",
    },
    fim_condutor_terra: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m11_4c, REF.m11_5b],
      causa: "Condutor de terra ou ligador amovível solto, corroído ou interrompido: as massas da casa ficam sem terra.",
      acao: "Refazer a ligação (secção do quadro 54A: 16 mm² cobre, ou 25 mm² sem proteção contra a corrosão) e voltar a medir a continuidade e a resistência de terra.",
    },
  },
};

export const TERRA_ARVORE = {
  id: "terra", versao: 1, grupo: "Terra e isolamento",
  titulo: "Terra fora do valor",
  sintoma: "A resistência de terra medida está acima do valor do manual.",
  inicio: "medir",
  nos: {
    medir: {
      tipo: "valor", texto: "Resistência do elétrodo de terra", ref: [REF.m11_4c, REF.m16_2],
      fazer: "Terrómetro pelo método dos três elétrodos (elétrodo, sonda e auxiliar alinhados), com o ligador amovível aberto e a instalação desligada; ou pinça de terra.",
      unidade: "Ω", casas: 1, max: 100_000, limite: { ...TERRA },
      dentro: "fim_terra_ok", fora: "ligacoes",
    },
    ligacoes: {
      tipo: "simnao", texto: "O ligador amovível, o condutor de terra e a ligação ao elétrodo estão apertados, sem corrosão e com a secção certa?", ref: [REF.m11_4c, REF.m11_5b],
      fazer: "Quadro 54A: 16 mm² de cobre (ou aço galvanizado) com proteção contra a corrosão; 25 mm² de cobre sem ela.",
      sim: "eletrodo", nao: "fim_ligacoes", ficha: { verificacao: "visual" },
    },
    eletrodo: {
      tipo: "escolha", texto: "Que elétrodo de terra tem a casa?", ref: REF.m11_4b,
      opcoes: [
        { texto: "Varetas (piquetes)", seguinte: "varetas" },
        { texto: "Anel de fundação", seguinte: "fim_anel" },
        { texto: "Não se sabe ou não se encontra", seguinte: "fim_desconhecido" },
      ],
    },
    varetas: {
      tipo: "simnao", texto: "Há pelo menos duas varetas em paralelo, afastadas pelo menos o dobro do comprimento, com o topo a 0,8 m?", ref: REF.m11_4b,
      sim: "diferenciais", nao: "fim_reforcar",
    },
    diferenciais: {
      tipo: "simnao", texto: "Todos os circuitos têm diferencial e o maior IΔn a montante cumpre RA × IΔn ≤ 50 V (ex.: 300 mA → RA ≤ 166 Ω; 30 mA → RA ≤ 1 666 Ω)?", ref: [REF.m11_4, REF.m11_4b],
      fazer: "Com a resistência medida, multiplique pelo IΔn do diferencial de maior sensibilidade nominal a montante.",
      sim: "fim_aceite", nao: "fim_reforcar", ficha: { verificacao: "rcd" },
    },
    fim_terra_ok: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m11_4b, REF.m16_2],
      causa: "A resistência de terra está dentro do valor do manual (< 100 Ω).",
      acao: "Registar o valor no relatório de ensaios e no quadro. Se a medição anterior estava fora, confirmar o método (três elétrodos ou pinça) e a época do ano.",
    },
    fim_ligacoes: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m11_4c, REF.m11_5b],
      causa: "Ligações de terra soltas, corroídas ou de secção insuficiente aumentam a resistência medida.",
      acao: "Limpar e reapertar ou substituir o condutor de terra e o ligador amovível (acessível, só desmontável com ferramenta); voltar a medir.",
    },
    fim_anel: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.m11_4b,
      causa: "Anel de fundação com resistência alta (ligação ao anel interrompida ou corroída).",
      acao: "Verificar a ligação do anel ao terminal principal de terra; se não se resolver, complementar com varetas cravadas e voltar a medir. Chamar apoio se a ligação ao anel não for acessível.",
    },
    fim_desconhecido: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.m11_4b,
      causa: "Elétrodo de terra desconhecido ou inexistente.",
      acao: "Propor a execução de um elétrodo novo (varetas de aço cobreado de 1,5–2 m, várias em paralelo) com ligador amovível; até lá, garantir diferenciais de 30 mA em todos os circuitos.",
    },
    fim_reforcar: {
      tipo: "fim", tipoAvaria: "terra", ref: REF.m11_4b,
      causa: "Elétrodo insuficiente para o solo (varetas a menos, juntas demais ou pouco profundas).",
      acao: "Acrescentar varetas em paralelo, afastadas pelo menos o dobro do comprimento, com o topo a 0,8 m; voltar a medir até ficar abaixo de 100 Ω.",
    },
    fim_aceite: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m11_4, REF.m11_4b],
      causa: "Terra acima de 100 Ω, mas a condição RA × IΔn ≤ 50 V cumpre-se com os diferenciais instalados.",
      acao: "O manual admite-o quando não é possível baixar dos 100 Ω: registar o valor e a época do ano, manter diferenciais adequados em todos os circuitos e voltar a medir na época seca.",
    },
  },
};

export const ISOLAMENTO_ARVORE = {
  id: "isolamento", versao: 1, grupo: "Terra e isolamento",
  titulo: "Isolamento baixo",
  sintoma: "A resistência de isolamento de um ou mais circuitos está abaixo do valor do manual.",
  inicio: "preparar",
  nos: {
    preparar: {
      tipo: "simnao", texto: "Desligou os aparelhos de utilização e a eletrónica (variadores, detetores, drivers LED, DST) antes de medir?", ref: REF.m16_2,
      fazer: "Com eletrónica que não se possa desligar, meça só entre os condutores ativos unidos e a terra.",
      sim: "medir", nao: "fim_medicao_invalida",
    },
    medir: {
      tipo: "valor", texto: "Resistência de isolamento mais baixa (cada circuito: L+N unidos contra a terra)", ref: [REF.m16_1, REF.m16_2, REF.anexoA],
      fazer: `${SEM_TENSAO} Megaohmímetro a 500 V CC, circuito a circuito; escreva o pior valor.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "fim_iso_ok", aviso: "fim_iso_marginal", fora: "onde", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    onde: {
      tipo: "escolha", texto: "Isolando por partes (circuito a circuito), onde está o defeito?", ref: REF.m20_2,
      opcoes: [
        { texto: "Num só circuito", seguinte: "aparelhos_fixos" },
        { texto: "Em vários circuitos", seguinte: "humidade" },
      ],
    },
    aparelhos_fixos: {
      tipo: "simnao", texto: "Com os aparelhos fixos desse circuito desligados nos bornes (termoacumulador, placa, estores, luminárias), o isolamento continua baixo?", ref: REF.m20_2,
      sim: "troco", nao: "fim_aparelho_fixo",
    },
    troco: {
      tipo: "simnao", texto: "Separando o circuito nas caixas de derivação, encontrou o troço ou a caixa com o defeito?", ref: [REF.m20_2, REF.b53],
      fazer: "Meça cada troço separado; procure humidade, cabo ferido, borne a tocar na caixa.",
      sim: "fim_troco", nao: "fim_embebido", ficha: { verificacao: "visual" },
    },
    humidade: {
      tipo: "simnao", texto: "Há humidade generalizada (casa desabitada, infiltrações, caixas no chão ou no exterior) ou condutores antigos com o isolamento ressequido?", ref: [REF.m20_2, REF.b54],
      sim: "fim_humidade", nao: "quadro",
    },
    quadro: {
      tipo: "simnao", texto: "No quadro, há algum neutro a tocar na terra ou condutores com o isolamento danificado?", ref: [REF.m16_2, REF.b54],
      fazer: "Sem tensão a montante (geral desligado e ausência de tensão verificada).",
      sim: "fim_quadro", nao: "fim_varios", ficha: { verificacao: "visual" },
    },
    fim_medicao_invalida: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m16_2,
      causa: "Medição de isolamento feita com aparelhos ou eletrónica ligados: o valor não é válido (e a eletrónica pode estragar-se).",
      acao: "Desligar os aparelhos e a eletrónica (variadores, detetores, drivers LED, DST) e repetir a medição; recomeçar este diagnóstico.",
    },
    fim_iso_ok: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m16_2, REF.anexoA],
      causa: "O isolamento está dentro do valor do manual e do objetivo da Domus Energia (≥ 1 MΩ).",
      acao: "Registar os valores de cada circuito no relatório de ensaios.",
    },
    fim_iso_marginal: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.anexoA, REF.m16_2],
      causa: "Isolamento acima do mínimo do manual (0,5 MΩ) mas abaixo do objetivo da Domus Energia (1 MΩ).",
      acao: "Localizar o circuito ou o troço mais fraco, secar ou substituir e voltar a medir. Registar o valor.",
    },
    fim_aparelho_fixo: {
      tipo: "fim", tipoAvaria: "terra", ref: REF.m20_2,
      causa: "O defeito de isolamento está num aparelho de ligação fixa do circuito.",
      acao: "Ligar os aparelhos um a um e medir para encontrar o que tem defeito; reparar ou substituir esse aparelho e voltar a medir o circuito.",
    },
    fim_troco: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.b53],
      causa: "Defeito de isolamento num troço ou numa caixa do circuito.",
      acao: "Secar ou substituir o troço; refazer as ligações dentro de caixas, com ligadores. Voltar a medir (≥ 0,5 MΩ; objetivo ≥ 1 MΩ).",
    },
    fim_embebido: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.m20_2,
      causa: "Defeito de isolamento em canalização embebida que não se localiza.",
      acao: "Deixar o circuito desligado e sinalizado; propor cabo novo ou abertura de roços (orçamento à parte).",
    },
    fim_humidade: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.b54],
      causa: "Humidade generalizada ou condutores envelhecidos baixam o isolamento de vários circuitos.",
      acao: "Tratar a humidade (caixas vedadas, IP do local) e substituir os condutores ressequidos; com instalação muito antiga, propor a remodelação. Voltar a medir.",
    },
    fim_quadro: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m16_2, REF.b54],
      causa: "Defeito de isolamento no quadro (neutro a tocar na terra ou condutor danificado).",
      acao: "Sem tensão, separar o neutro da terra, substituir os condutores danificados e voltar a medir todos os circuitos.",
    },
    fim_varios: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.m20_2,
      causa: "Vários circuitos com isolamento baixo sem causa comum à vista.",
      acao: "Medir e registar circuito a circuito; deixar desligados os que estão abaixo de 0,5 MΩ e chamar apoio para planear a reparação.",
    },
  },
};
