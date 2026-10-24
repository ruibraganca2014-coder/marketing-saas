// Árvores de diagnóstico — aquecimento e aparelhos/motores (ronda 1; manual de instalações BT, caps. 3, 10, 17 e 20).
// Formato em web/diagnostico/motor.js. Textos nossos, curtos, a partir do manual da empresa.
import { ISOLAMENTO, TENSAO_REDE, REF } from "./limites.js";

const SEM_TENSAO = "Sem tensão: regras de ouro cumpridas no circuito em causa.";

export const AQUECIMENTO = {
  id: "aquecimento", versao: 1, grupo: "Aquecimento e aparelhos",
  titulo: "Tomada, cabo ou aparelho quente, ou cheiro a queimado",
  sintoma: "Tomada, ficha, quadro, cabo ou aparelho quente, escurecido ou com cheiro a queimado.",
  inicio: "cortar",
  nos: {
    cortar: {
      tipo: "simnao", texto: "Já cortou a alimentação do que está quente (o disjuntor do circuito ou o geral) e não há fumo nem chama?", ref: [REF.m20_2, REF.m20_1],
      fazer: "Cortar primeiro, investigar depois. Fumo ou chama: cortar o geral, afastar as pessoas, ligar 112.",
      sim: "onde", nao: "fim_parar",
    },
    onde: {
      tipo: "escolha", texto: "Onde está o aquecimento ou o cheiro?", ref: REF.m20_2, ficha: { verificacao: "visual" },
      opcoes: [
        { texto: "Numa tomada ou ficha", seguinte: "ficha" },
        { texto: "No quadro", seguinte: "quadro" },
        { texto: "Num cabo ou extensão", seguinte: "extensao" },
        { texto: "Num aparelho", seguinte: "so_aparelho" },
        { texto: "Não se encontra (só o cheiro)", seguinte: "procurar" },
      ],
    },
    ficha: {
      tipo: "simnao", texto: "A ficha do aparelho está danificada, escurecida ou mal encaixada (folga nos alvéolos)?", ref: [REF.m20_2, REF.b54],
      sim: "fim_ficha", nao: "tomada_bornes",
    },
    tomada_bornes: {
      tipo: "simnao", texto: "Na tomada há bornes soltos, plástico deformado ou escurecido?", ref: [REF.m20_2, REF.b54],
      fazer: `${SEM_TENSAO} Abra a tomada e veja os bornes e o isolamento dos condutores.`,
      sim: "fim_tomada", nao: "calibre", ficha: { verificacao: "visual" },
    },
    quadro: {
      tipo: "simnao", texto: "No quadro há bornes escurecidos, isolamento derretido ou um aparelho com cheiro?", ref: [REF.m20_2, REF.b54],
      fazer: "Sem tensão a montante (geral desligado e ausência de tensão verificada).",
      sim: "fim_quadro", nao: "termografia", ficha: { verificacao: "visual" },
    },
    termografia: {
      tipo: "simnao", texto: "Com carga, a termografia (ou um termómetro de infravermelhos) mostra algum ponto quente no quadro?", ref: [REF.m20_3, REF.m20_2], tensao: true,
      fazer: "Com a instalação em carga, sem tocar em nada; com a tampa aberta, atenção às partes em tensão.",
      sim: "fim_quadro", nao: "fim_sem_ponto",
    },
    extensao: {
      tipo: "simnao", texto: "É uma extensão ou tripla com vários aparelhos ligados?", ref: REF.m20_2,
      sim: "fim_extensao", nao: "cabo_dano",
    },
    cabo_dano: {
      tipo: "simnao", texto: "O cabo fixo tem o isolamento danificado, está esmagado ou tapado por isolamento térmico, móveis ou outros cabos?", ref: [REF.m20_2, REF.b54],
      sim: "fim_cabo", nao: "calibre", ficha: { verificacao: "visual" },
    },
    so_aparelho: {
      tipo: "simnao", texto: "O aquecimento é só no aparelho (a tomada e a ficha estão frias)?", ref: REF.m20_2,
      sim: "fim_aparelho", nao: "ficha",
    },
    procurar: {
      tipo: "simnao", texto: "A inspeção visual de tomadas, interruptores, caixas e quadro mostra marcas de aquecimento?", ref: [REF.m20_1, REF.b54],
      fazer: "Cheire e veja de perto cada tomada, interruptor e caixa, com a instalação desligada.",
      sim: "tomada_bornes", nao: "termografia", ficha: { verificacao: "visual" },
    },
    calibre: {
      tipo: "escolha", texto: "Qual é o calibre do disjuntor desse circuito?", ref: [REF.m10_3, REF.m3_tipo],
      opcoes: [
        { texto: "10 A", seguinte: "corrente", define: { In: 10 } },
        { texto: "16 A", seguinte: "corrente", define: { In: 16 } },
        { texto: "20 A", seguinte: "corrente", define: { In: 20 } },
        { texto: "25 A", seguinte: "corrente", define: { In: 25 } },
        { texto: "32 A", seguinte: "corrente", define: { In: 32 } },
      ],
    },
    corrente: {
      tipo: "valor", texto: "Corrente do circuito com a carga habitual ligada", ref: [REF.m20_2, REF.m10_1], tensao: true,
      fazer: "Depois de reparado o que estava danificado: pinça amperimétrica a abraçar só a fase, com os aparelhos que estavam ligados quando aqueceu.",
      unidade: "A", casas: 1, max: 1000, limite: { max: { var: "In" }, fonte: "Manual 10.1: sobrecarga = corrente acima da nominal da proteção" },
      dentro: "seccao", fora: "fim_sobrecarga",
    },
    seccao: {
      tipo: "simnao", texto: "A secção do cabo é a adequada ao calibre (luz 1,5 mm² com 10 A, tomadas 2,5 mm² com 16 A, ou pelo cálculo do projeto)?", ref: REF.m3_tipo,
      sim: "fim_ligacao_montante", nao: "fim_seccao",
    },
    fim_parar: {
      tipo: "fim", tipoAvaria: "outro", parar: true, ref: [REF.m20_1, REF.b5acidente],
      causa: "Aquecimento ou cheiro a queimado com a alimentação ainda ligada (ou com fumo): risco de incêndio.",
      acao: "Cortar já o circuito ou o geral; com fumo ou chama, afastar as pessoas e ligar 112. Recomeçar o diagnóstico só com tudo seguro.",
    },
    fim_ficha: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.b54],
      causa: "Ficha danificada ou mal encaixada: mau contacto que aquece.",
      acao: "Não usar a ficha: o cliente substitui-a (ou o cabo do aparelho). Ver se a tomada também ficou marcada e substituí-la se for o caso.",
    },
    fim_tomada: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.b53],
      causa: "Mau aperto ou tomada gasta: a ligação aquece.",
      acao: "Substituir a tomada, cortar os condutores até ao cobre são e refazer a ligação ao binário; verificar a secção e a proteção do circuito.",
    },
    fim_quadro: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.m20_3],
      causa: "Mau aperto ou aparelho do quadro a aquecer.",
      acao: "Sem tensão, reapertar os bornes ao binário do fabricante e substituir os aparelhos e condutores que aqueceram; depois termografia em carga.",
    },
    fim_sem_ponto: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_3,
      causa: "Não se encontrou ponto quente com a carga atual.",
      acao: "Repetir em carga máxima (hora de maior consumo); registar a inspeção e pedir ao cliente que avise se o cheiro voltar, desligando o geral.",
    },
    fim_extensao: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: REF.m20_2,
      causa: "Extensão ou tripla sobrecarregada.",
      acao: "Retirar a extensão; propor tomadas fixas suficientes e circuito próprio para os aparelhos de maior potência.",
    },
    fim_cabo: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.b54],
      causa: "Cabo danificado ou sem dissipar o calor (tapado, esmagado).",
      acao: "Substituir o troço danificado e libertá-lo do que o tapa; confirmar que a secção condiz com o calibre do disjuntor.",
    },
    fim_aparelho: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "O aparelho aquece por avaria interna.",
      acao: "Não usar o aparelho: reparação ou substituição. A instalação não tem defeito neste ponto.",
    },
    fim_sobrecarga: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.m3_criterios],
      causa: "Sobrecarga: a corrente passa o calibre do circuito.",
      acao: "Redistribuir as cargas ou criar circuito próprio; nunca aumentar o calibre do disjuntor.",
    },
    fim_seccao: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: REF.m3_tipo,
      causa: "Cabo de secção insuficiente para o calibre do disjuntor.",
      acao: "Repor a proteção certa para o cabo ou passar cabo de secção adequada (luz 1,5 mm²/10 A, tomadas 2,5 mm²/16 A).",
    },
    fim_ligacao_montante: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.b53],
      causa: "Corrente e secção certas: o aquecimento vem de uma ligação solta a montante (caixa de derivação ou tomada anterior).",
      acao: "Sem tensão, abrir as caixas e a tomada anterior e refazer as ligações; fazer o ensaio funcional com carga.",
    },
  },
};

export const MOTOR = {
  id: "motor", versao: 1, grupo: "Aquecimento e aparelhos",
  titulo: "Aparelho ou motor não arranca",
  sintoma: "Um eletrodoméstico, bomba, portão, compressor ou máquina não arranca.",
  inicio: "tipo",
  nos: {
    tipo: {
      tipo: "escolha", texto: "Que aparelho é?", ref: [REF.m17_1, REF.m20_2],
      opcoes: [
        { texto: "Aparelho de ficha (eletrodoméstico)", seguinte: "tomada" },
        { texto: "Motor com proteções próprias (bomba, portão, compressor, máquina)", seguinte: "protecoes" },
      ],
    },
    tomada: {
      tipo: "valor", texto: "Tensão na tomada do aparelho (fase–neutro)", ref: [REF.m20_2, REF.b44], tensao: true,
      fazer: "Multímetro em tensão alternada, pontas CAT III.",
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "fim_aparelho", fora: "fim_seguir_sem_corrente", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    protecoes: {
      tipo: "escolha", texto: "Como estão as proteções do motor?", ref: REF.m17_1, ficha: { verificacao: "visual" },
      opcoes: [
        { texto: "O disjuntor-motor (ou o disjuntor) disparou", seguinte: "dispara_quando" },
        { texto: "O relé térmico disparou", seguinte: "chapa" },
        { texto: "Tudo ligado, mas o contactor não fecha", seguinte: "bobina" },
        { texto: "O contactor fecha, mas o motor não roda (ou zumbe)", seguinte: "fases" },
      ],
    },
    dispara_quando: {
      tipo: "escolha", texto: "Quando dispara?", ref: [REF.m17_1, REF.m10_1],
      opcoes: [
        { texto: "No arranque, de imediato", seguinte: "curva" },
        { texto: "Ao fim de algum tempo a trabalhar", seguinte: "chapa" },
      ],
    },
    curva: {
      tipo: "simnao", texto: "A proteção é um disjuntor-motor (ou disjuntor de curva D) regulado para a corrente da chapa?", ref: [REF.m17_1, REF.m10_3],
      fazer: "No arranque direto a corrente é de 5 a 8 vezes a nominal.",
      sim: "iso_motor", nao: "fim_curva",
    },
    iso_motor: {
      tipo: "valor", texto: "Isolamento dos enrolamentos do motor e do cabo contra a massa (PE)", ref: [REF.m16_2, REF.m20_2],
      fazer: `${SEM_TENSAO} Motor desligado da rede (variador ou arrancador eletrónico também desligado), megaohmímetro a 500 V CC.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "fim_bloqueado", aviso: "fim_bloqueado", fora: "fim_isolamento_motor", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    chapa: {
      tipo: "dado", texto: "Corrente nominal do motor (na chapa de características)", ref: REF.m17_1,
      fazer: "Veja a chapa do motor (In, à tensão da rede: 230 V ou 400 V).",
      unidade: "A", casas: 1, max: 1000, define: "In", seguinte: "corrente",
    },
    corrente: {
      tipo: "valor", texto: "Corrente do motor a trabalhar (a fase com mais corrente)", ref: [REF.m17_1, REF.m10_1], tensao: true,
      fazer: "Pinça amperimétrica em cada fase, com o motor na carga normal.",
      unidade: "A", casas: 1, max: 1000, limite: { max: { var: "In" }, fonte: "Manual 17.1: relé térmico regulado para a corrente da chapa" },
      dentro: "regulacao", fora: "fim_sobrecarga_motor",
    },
    regulacao: {
      tipo: "simnao", texto: "O relé térmico (ou o disjuntor-motor) está regulado para a corrente da chapa?", ref: REF.m17_1,
      sim: "fases", nao: "fim_regulacao",
    },
    bobina: {
      tipo: "simnao", texto: "Ao carregar no arranque, chega tensão à bobina do contactor (A1–A2)?", ref: REF.m17_2, tensao: true,
      fazer: "Multímetro em tensão alternada aos bornes A1–A2 da bobina, com o circuito de comando ligado.",
      sim: "fim_contactor", nao: "comando",
    },
    comando: {
      tipo: "simnao", texto: "O botão de paragem (NF), o contacto do relé térmico (NF) e o botão de arranque (NA) têm continuidade quando devem?", ref: REF.m17_2,
      fazer: `${SEM_TENSAO} Multímetro em continuidade em cada contacto do circuito de comando.`,
      sim: "fim_comando_alimentacao", nao: "fim_botoneira", ficha: { verificacao: "continuidade" },
    },
    fases: {
      tipo: "simnao", texto: "Com o arranque comandado, chegam aos bornes do motor as três fases (ou fase e neutro, no monofásico) com valores iguais entre si e perto do nominal?", ref: [REF.m17_1, REF.m10_7], tensao: true,
      fazer: "Meça entre fases (400 V) ou fase–neutro (230 V). Os motores não devem arrancar abaixo de cerca de 85 % da tensão nominal.",
      sim: "monofasico", nao: "fim_falta_fase", ficha: { verificacao: "tensao" },
    },
    monofasico: {
      tipo: "simnao", texto: "É um motor monofásico com condensador de arranque ou de serviço?", ref: REF.m17_1,
      sim: "fim_condensador", nao: "fim_bloqueado",
    },
    fim_aparelho: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "A tomada tem tensão normal: a avaria é do aparelho.",
      acao: "Experimentar o aparelho noutra tomada para confirmar; reparação ou substituição do aparelho (não é avaria da instalação).",
    },
    fim_seguir_sem_corrente: {
      tipo: "fim", tipoAvaria: "aberto", seguir: "sem-corrente", ref: REF.m20_2,
      causa: "A tomada não tem a tensão normal.",
      acao: "Continuar com a árvore «Sem corrente num ponto, circuito ou divisão».",
    },
    fim_curva: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m17_1, REF.m10_3],
      causa: "Proteção desadequada ao arranque do motor (curva B/C ou disjuntor-motor mal regulado).",
      acao: "Instalar disjuntor-motor regulado para a corrente da chapa (ou disjuntor de curva D), confirmando a secção do cabo; nunca subir o calibre.",
    },
    fim_bloqueado: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m17_1, REF.m10_1],
      causa: "Isolamento e alimentação bons: motor bloqueado mecanicamente (rolamentos, bomba presa, carga encravada).",
      acao: "Com o motor desligado e bloqueado, verificar se o veio roda à mão e a carga acionada; reparação mecânica antes de voltar a ligar.",
    },
    fim_isolamento_motor: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m16_2, REF.m20_2],
      causa: "Enrolamento do motor (ou o cabo) com defeito de isolamento à massa.",
      acao: "Separar o cabo do motor e medir cada um para saber qual tem o defeito; substituir o cabo ou mandar rebobinar/substituir o motor.",
    },
    fim_sobrecarga_motor: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m17_1, REF.m10_7],
      causa: "O motor consome acima da chapa: excesso de carga mecânica, rolamentos gastos ou tensão baixa.",
      acao: "Medir a tensão nos bornes em carga; verificar a parte mecânica (rolamentos, carga acionada). Nunca regular o térmico acima da corrente da chapa.",
    },
    fim_regulacao: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m17_1,
      causa: "Relé térmico (ou disjuntor-motor) regulado abaixo da corrente da chapa.",
      acao: "Regular para a corrente da chapa do motor e fazer o ensaio funcional com carga.",
    },
    fim_contactor: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m17_2,
      causa: "A bobina recebe tensão mas o contactor não fecha: bobina ou contactor avariado.",
      acao: "Substituir o contactor (categoria AC-3, corrente ≥ In do motor, bobina com a tensão do comando).",
    },
    fim_comando_alimentacao: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m17_2,
      causa: "Os contactos do comando estão bons: falta alimentação ao circuito de comando (proteção do comando, transformador, ligação).",
      acao: "Verificar a proteção e a alimentação do circuito de comando e o contacto de autorretenção (13-14); refazer o que estiver solto ou avariado.",
    },
    fim_botoneira: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m17_2,
      causa: "Botão de paragem, de arranque ou contacto do relé térmico avariado.",
      acao: "Substituir o botão ou o contacto avariado e fazer o ensaio funcional (arranque, autorretenção e paragem).",
    },
    fim_falta_fase: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m17_1, REF.m10_7],
      causa: "Falta de uma fase (ou tensão muito baixa) nos bornes do motor: fusível, contacto do contactor ou borne.",
      acao: "Sem tensão, verificar fusíveis, contactos do contactor e bornes; nunca deixar um motor trifásico a tentar arrancar em duas fases.",
    },
    fim_condensador: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m17_1,
      causa: "Condensador de arranque ou de serviço avariado (o motor zumbe e não arranca).",
      acao: "Descarregar e medir o condensador; substituir por um com a mesma capacidade e tensão.",
    },
  },
};
