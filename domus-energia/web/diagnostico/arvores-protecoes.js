// Árvores de diagnóstico — proteções que disparam (ronda 1; manual de instalações BT, caps. 10, 11, 16 e 20).
// Formato em web/diagnostico/motor.js. Textos nossos, curtos, a partir do manual da empresa.
import { ISOLAMENTO, DIFERENCIAL_MS, REF } from "./limites.js";

const SEM_TENSAO = "Sem tensão: regras de ouro cumpridas no circuito em causa.";

export const DIFERENCIAL = {
  id: "diferencial", versao: 1, grupo: "Proteções que disparam",
  titulo: "O diferencial dispara",
  sintoma: "Sempre, com um aparelho, com chuva, com trovoada ou ao acaso.",
  inicio: "quando",
  nos: {
    quando: {
      tipo: "escolha", texto: "Quando é que o diferencial dispara?", ref: REF.m20_2, ficha: { verificacao: "visual" },
      fazer: "Pergunte ao cliente desde quando e o que mudou; veja no quadro que diferencial está em baixo e que circuitos protege.",
      opcoes: [
        { texto: "Sempre, logo ao rearmar", seguinte: "isolar_grupo" },
        { texto: "Quando se liga um aparelho", seguinte: "aparelho_outra" },
        { texto: "Com chuva ou humidade", seguinte: "chuva_exterior" },
        { texto: "Com trovoada", seguinte: "trovoada_dst" },
        { texto: "Ao acaso, sem padrão", seguinte: "acaso_aparelho" },
      ],
    },
    isolar_grupo: {
      tipo: "simnao", texto: "Com todos os disjuntores desse diferencial desligados, o diferencial rearma e fica ligado?", ref: REF.m20_2,
      fazer: "Desligue todos os disjuntores a jusante do diferencial e rearme-o uma vez. Não insista se disparar.",
      sim: "um_a_um", nao: "neutro_partilhado",
    },
    um_a_um: {
      tipo: "escolha", texto: "Volte a ligar os disjuntores um a um. O que acontece?", ref: REF.m20_2,
      fazer: "Espere alguns segundos entre cada disjuntor e anote qual estava a ligar quando disparou.",
      opcoes: [
        { texto: "Dispara ao ligar um circuito em particular", seguinte: "circuito_aparelhos" },
        { texto: "Só dispara com vários ligados (ou passado algum tempo)", seguinte: "iso_pior" },
        { texto: "Já não dispara", seguinte: "fim_intermitente" },
      ],
    },
    circuito_aparelhos: {
      tipo: "simnao", texto: "Com esse circuito ligado mas os aparelhos dele desligados, o diferencial ainda dispara?", ref: REF.m20_2,
      fazer: "Tire as fichas das tomadas e desligue os aparelhos fixos desse circuito (termoacumulador, placa, estores) no interruptor ou no borne.",
      sim: "iso_circuito", nao: "aparelho_um_a_um",
    },
    aparelho_um_a_um: {
      tipo: "simnao", texto: "Ligando os aparelhos um a um, há um que faz disparar?", ref: REF.m20_2,
      sim: "aparelho_outra", nao: "fim_intermitente",
    },
    aparelho_outra: {
      tipo: "simnao", texto: "Ligado a uma tomada de outro circuito (com outro diferencial), esse aparelho também faz disparar?", ref: REF.m20_2,
      fazer: "É a forma mais rápida de separar a avaria do aparelho da avaria da instalação.",
      sim: "fim_aparelho", nao: "iso_circuito",
    },
    iso_circuito: {
      tipo: "valor", texto: "Resistência de isolamento do circuito (fase e neutro unidos contra a terra)", ref: [REF.m16_2, REF.anexoA],
      fazer: `${SEM_TENSAO} Aparelhos e eletrónica desligados (variadores, detetores, drivers LED, DST). Megaohmímetro a 500 V CC entre L+N unidos e o PE.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "neutro_partilhado", aviso: "fim_iso_marginal", fora: "localizar_troco", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    localizar_troco: {
      tipo: "simnao", texto: "Separando o circuito nas caixas de derivação, encontrou o troço ou a caixa com o defeito?", ref: [REF.m20_2, REF.b53],
      fazer: `${SEM_TENSAO} Abra as caixas, separe os troços e meça cada um: procure humidade, cabo ferido, borne a tocar na caixa.`,
      sim: "fim_iso_troco", nao: "fim_iso_embebido", ficha: { verificacao: "visual" },
    },
    neutro_partilhado: {
      tipo: "simnao", texto: "Os neutros dos circuitos deste diferencial vão só ao barramento (ou borne) dele, sem neutros partilhados com outro diferencial?", ref: REF.m20_2,
      fazer: `${SEM_TENSAO} Siga no quadro o neutro de cada circuito até ao diferencial que o protege.`,
      sim: "iso_quadro", nao: "fim_neutro_partilhado", ficha: { verificacao: "visual" },
    },
    iso_quadro: {
      tipo: "valor", texto: "Isolamento da cablagem do quadro entre o diferencial e os disjuntores (L e N à terra)", ref: REF.m16_2,
      fazer: `${SEM_TENSAO} Com os disjuntores de saída desligados, meça a 500 V CC a partir da saída do diferencial.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "teste_rcd", aviso: "teste_rcd", fora: "fim_cablagem_quadro", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    teste_rcd: {
      tipo: "valor", texto: "Tempo de disparo do diferencial à corrente estipulada (IΔn), medido com o testador", ref: [REF.m16_2, REF.m11_3b], tensao: true,
      fazer: "Teste primeiro o botão T. Depois o testador de diferenciais numa tomada a jusante (ou nos bornes), a IΔn.",
      unidade: "ms", casas: 0, max: 10_000, limite: { ...DIFERENCIAL_MS },
      dentro: "meia_corrente", fora: "fim_dif_lento", ficha: { verificacao: "rcd", valor: "rcd" },
    },
    meia_corrente: {
      tipo: "simnao", texto: "No ensaio a metade da sensibilidade (½ IΔn), o diferencial NÃO dispara?", ref: REF.m16_2, tensao: true,
      fazer: "O diferencial tem de disparar entre ½ IΔn e IΔn: abaixo de ½ IΔn não deve disparar.",
      sim: "fim_soma_fugas", nao: "fim_dif_sensivel", ficha: { verificacao: "rcd" },
    },
    iso_pior: {
      tipo: "valor", texto: "Isolamento mais baixo entre os circuitos deste diferencial (L+N contra a terra)", ref: [REF.m16_2, REF.anexoA],
      fazer: `${SEM_TENSAO} Meça circuito a circuito a 500 V CC, com os aparelhos e a eletrónica desligados, e escreva o pior valor.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "teste_rcd", aviso: "fim_iso_marginal", fora: "localizar_troco", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    chuva_exterior: {
      tipo: "simnao", texto: "Há circuitos exteriores ou em zonas húmidas neste diferencial (jardim, varanda, garagem, fachada, bomba)?", ref: REF.m20_2,
      sim: "chuva_inspecao", nao: "iso_pior",
    },
    chuva_inspecao: {
      tipo: "simnao", texto: "Nas caixas, tomadas e luminárias exteriores desses circuitos há água, condensação ou oxidação?", ref: [REF.m20_2, REF.m12_3],
      fazer: `${SEM_TENSAO} Abra e veja também se o grau IP é o do local (exterior abrigado IP44, exterior exposto IP55).`,
      sim: "fim_humidade", nao: "iso_pior", ficha: { verificacao: "visual" },
    },
    trovoada_dst: {
      tipo: "simnao", texto: "O quadro tem descarregador de sobretensões (DST) e o indicador dele está bom (sem fim de vida)?", ref: [REF.m20_2, REF.m11_7],
      fazer: "Veja o indicador do DST no quadro de entrada; o manual pede esta verificação todos os anos e depois de trovoadas.",
      sim: "fim_transitorios", nao: "fim_sem_dst", ficha: { verificacao: "visual" },
    },
    acaso_aparelho: {
      tipo: "simnao", texto: "O disparo coincide com algum aparelho que arranca sozinho (termoacumulador, frigorífico, bomba, ar condicionado, máquina a meio do programa)?", ref: REF.m20_2,
      sim: "aparelho_outra", nao: "iso_pior",
    },
    fim_aparelho: {
      tipo: "fim", tipoAvaria: "terra", ref: REF.m20_2,
      causa: "Fuga à terra no próprio aparelho (faz disparar em qualquer tomada).",
      acao: "Não voltar a ligar o aparelho: o cliente manda-o reparar ou substitui-o. Testar o diferencial no botão T e registar que a instalação não tem defeito.",
    },
    fim_iso_troco: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.b53],
      causa: "Defeito de isolamento num troço ou numa caixa (humidade, cabo ferido, borne a tocar na caixa).",
      acao: "Secar ou substituir o troço; refazer as ligações só dentro de caixas, com ligadores. Voltar a medir o isolamento (≥ 0,5 MΩ; objetivo ≥ 1 MΩ) e ensaiar o diferencial.",
    },
    fim_iso_embebido: {
      tipo: "fim", tipoAvaria: "terra", parar: true, ref: REF.m20_2,
      causa: "Defeito de isolamento numa canalização embebida que não se consegue localizar.",
      acao: "Deixar o circuito desligado e sinalizado. Propor a passagem de cabo novo ou a abertura de roços (orçamento à parte); não insistir nem ligar o circuito a outro diferencial.",
    },
    fim_iso_marginal: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.anexoA, REF.m16_2],
      causa: "Isolamento acima do mínimo do manual (0,5 MΩ) mas abaixo do objetivo da Domus Energia (1 MΩ): fuga pequena (humidade, aparelhagem envelhecida).",
      acao: "Localizar o circuito ou o troço mais fraco, secar ou substituir e voltar a medir. Registar o valor medido.",
    },
    fim_neutro_partilhado: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "Neutro partilhado entre diferenciais (o neutro de um circuito ligado ao diferencial de outro).",
      acao: "Sem tensão, ligar cada neutro ao diferencial do seu circuito e identificar os circuitos. Voltar a medir o isolamento e ensaiar os diferenciais.",
    },
    fim_cablagem_quadro: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m16_2, REF.b54],
      causa: "Defeito de isolamento dentro do quadro, entre o diferencial e os disjuntores (pente, condutor apertado contra a caixa, borne a tocar).",
      acao: "Sem tensão, localizar e substituir o que estiver danificado; voltar a medir (≥ 0,5 MΩ) e ensaiar o diferencial.",
    },
    fim_dif_lento: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m16_2, REF.m11_3b],
      causa: "Diferencial lento: o tempo de disparo passa o especificado.",
      acao: "Substituir o diferencial por um igual (calibre, sensibilidade, tipo A — padrão Domus) e ensaiar de novo o tempo e a corrente de disparo.",
    },
    fim_dif_sensivel: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m16_2,
      causa: "Diferencial avariado: dispara abaixo de metade da sensibilidade (½ IΔn).",
      acao: "Substituir o diferencial por um igual e ensaiar de novo (disparo entre ½ IΔn e IΔn).",
    },
    fim_soma_fugas: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.m11_3b],
      causa: "Soma das pequenas fugas normais de vários circuitos e aparelhos (eletrónica, filtros) no mesmo diferencial: o diferencial está bom.",
      acao: "Dividir os circuitos por mais diferenciais de 30 mA (tipo A); se houver trovoadas, considerar um diferencial imunizado (tipo «SI»). Nunca trocar por um de 300 mA nas tomadas.",
    },
    fim_humidade: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.m12_3],
      causa: "Entrada de água ou condensação em caixas, tomadas ou luminárias exteriores.",
      acao: "Sem tensão, secar e substituir o material oxidado; pôr aparelhagem e caixas com o IP do local (IP44 abrigado, IP55 exposto) e vedar as entradas de cabo. Voltar a medir o isolamento.",
    },
    fim_transitorios: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m20_2, REF.m11_7],
      causa: "Diferencial sensível a sobretensões transitórias (trovoada, manobras na rede).",
      acao: "Considerar um diferencial imunizado (tipo «SI»); verificar as ligações do DST à terra (o mais curtas possível, soma < 0,5 m).",
    },
    fim_sem_dst: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m11_7,
      causa: "Sem proteção contra sobretensões (ou DST em fim de vida).",
      acao: "Instalar ou substituir o DST tipo 2 no quadro de entrada (padrão Domus; tipo 1+2 se houver para-raios), com a proteção a montante indicada pelo fabricante.",
    },
    fim_intermitente: {
      tipo: "fim", tipoAvaria: "terra", ref: [REF.m20_2, REF.m20_3],
      causa: "Fuga intermitente que não se reproduziu agora (aparelho que só falha em certas condições, humidade passageira).",
      acao: "Medir o isolamento de cada circuito e registar os valores; pedir ao cliente que anote quando dispara e que aparelhos estavam a trabalhar; voltar com essa informação.",
    },
  },
};

export const DISJUNTOR = {
  id: "disjuntor", versao: 1, grupo: "Proteções que disparam",
  titulo: "O disjuntor dispara",
  sintoma: "Logo ao ligar, ou ao fim de algum tempo com aparelhos a trabalhar.",
  inicio: "quando",
  nos: {
    quando: {
      tipo: "escolha", texto: "Quando é que o disjuntor dispara?", ref: [REF.m20_2, REF.m10_1], ficha: { verificacao: "visual" },
      fazer: "Disparo imediato aponta para curto-circuito; disparo ao fim de minutos, com carga, aponta para sobrecarga.",
      opcoes: [
        { texto: "Logo ao ligar (de imediato)", seguinte: "sem_aparelhos" },
        { texto: "Ao fim de algum tempo, com aparelhos a trabalhar", seguinte: "calibre" },
        { texto: "Só no arranque de um motor (bomba, compressor, máquina)", seguinte: "motor_curva" },
      ],
    },
    sem_aparelhos: {
      tipo: "simnao", texto: "Com todos os aparelhos do circuito desligados, o disjuntor ainda dispara ao ligar?", ref: REF.m20_2,
      fazer: "Tire as fichas e desligue os aparelhos fixos. Rearme uma vez só: não insista num disjuntor que dispara logo.",
      sim: "iso_curto", nao: "aparelho_um",
    },
    aparelho_um: {
      tipo: "simnao", texto: "Ligando os aparelhos um a um, há um que faz disparar logo?", ref: REF.m20_2,
      sim: "fim_aparelho_curto", nao: "fim_curto_intermitente",
    },
    iso_curto: {
      tipo: "valor", texto: "Isolamento mais baixo do circuito (entre fase e neutro e de cada um à terra)", ref: [REF.m20_2, REF.m16_2],
      fazer: `${SEM_TENSAO} Sem cargas, megaohmímetro a 500 V CC entre L–N, L–PE e N–PE. Perto de zero = curto-circuito.`,
      unidade: "MΩ", casas: 2, max: 100_000, limite: { ...ISOLAMENTO },
      dentro: "saida_solta", aviso: "saida_solta", fora: "localizar_curto", ficha: { verificacao: "isolamento", valor: "isolamento" },
    },
    localizar_curto: {
      tipo: "simnao", texto: "Separando o circuito nas caixas, encontrou o troço ou a caixa em curto-circuito?", ref: [REF.m20_2, REF.b53],
      fazer: `${SEM_TENSAO} Procure cabo esmagado ou furado (pregos, parafusos), caixas com água, bornes a tocar.`,
      sim: "fim_curto_troco", nao: "fim_curto_embebido", ficha: { verificacao: "visual" },
    },
    saida_solta: {
      tipo: "simnao", texto: "Com o condutor de saída desligado do disjuntor, o disjuntor ainda dispara ao ligar?", ref: [REF.m10_3, REF.m10_4],
      fazer: `${SEM_TENSAO} Solte a fase de saída do disjuntor, isole a ponta e rearme.`,
      sim: "fim_disjuntor_avariado", nao: "fim_carga_fixa",
    },
    calibre: {
      tipo: "escolha", texto: "Qual é o calibre do disjuntor que dispara?", ref: [REF.m10_3, REF.m3_tipo],
      fazer: "Veja na frente do disjuntor (ex.: C16 = curva C, 16 A).",
      opcoes: [
        { texto: "6 A", seguinte: "corrente", define: { In: 6 } },
        { texto: "10 A", seguinte: "corrente", define: { In: 10 } },
        { texto: "16 A", seguinte: "corrente", define: { In: 16 } },
        { texto: "20 A", seguinte: "corrente", define: { In: 20 } },
        { texto: "25 A", seguinte: "corrente", define: { In: 25 } },
        { texto: "32 A", seguinte: "corrente", define: { In: 32 } },
        { texto: "40 A", seguinte: "corrente", define: { In: 40 } },
      ],
    },
    corrente: {
      tipo: "valor", texto: "Corrente do circuito com a carga habitual ligada", ref: [REF.m20_2, REF.m10_1], tensao: true,
      fazer: "Pinça amperimétrica a abraçar só a fase do circuito (fase e neutro juntos dão 0 A), com os aparelhos que costumam estar ligados quando dispara.",
      unidade: "A", casas: 1, max: 1000, limite: { max: { var: "In" }, fonte: "Manual 10.1: sobrecarga = corrente acima da nominal da proteção (1,1 a cerca de 5 × In)" },
      dentro: "bornes_quentes", fora: "fim_sobrecarga",
    },
    bornes_quentes: {
      tipo: "simnao", texto: "Os bornes do disjuntor ou do circuito estão quentes, escurecidos ou mal apertados?", ref: [REF.m20_2, REF.b54],
      fazer: `${SEM_TENSAO} Veja e reaperte ao binário do fabricante; com carga, termografia se houver.`,
      sim: "fim_mau_aperto", nao: "seccao", ficha: { verificacao: "visual" },
    },
    seccao: {
      tipo: "simnao", texto: "A secção do cabo e o calibre do disjuntor estão de acordo (luz 1,5 mm² com 10 A, tomadas 2,5 mm² com 16 A, ou pelo cálculo do projeto)?", ref: REF.m3_tipo,
      sim: "fim_disjuntor_fraco", nao: "fim_seccao",
    },
    motor_curva: {
      tipo: "simnao", texto: "O motor está protegido por um disjuntor de curva D ou por um disjuntor-motor regulado para a corrente da chapa?", ref: [REF.m17_1, REF.m10_3],
      fazer: "A corrente de arranque direto de um motor é de 5 a 8 vezes a nominal: uma curva B ou C pode disparar no arranque.",
      sim: "sem_aparelhos", nao: "fim_curva",
    },
    fim_aparelho_curto: {
      tipo: "fim", tipoAvaria: "curto", ref: REF.m20_2,
      causa: "Curto-circuito no aparelho.",
      acao: "Não voltar a ligar o aparelho: reparação ou substituição. Ver se a tomada e a ficha ficaram marcadas pelo arco e substituí-las se for o caso.",
    },
    fim_curto_intermitente: {
      tipo: "fim", tipoAvaria: "curto", ref: [REF.m20_2, REF.m10_7b],
      causa: "Curto-circuito intermitente (cabo esmagado ou borne solto que só toca às vezes) ou aparelho que falha só em certas condições.",
      acao: "Inspecionar caixas, tomadas e o percurso do cabo; medir o isolamento do circuito e registar. Se os sintomas forem de arco (estalos, marcas), propor um detetor de arco (AFDD).",
    },
    fim_curto_troco: {
      tipo: "fim", tipoAvaria: "curto", ref: [REF.m20_2, REF.b53],
      causa: "Curto-circuito num troço ou numa caixa da instalação.",
      acao: "Substituir o troço danificado e refazer as ligações em caixa, com ligadores. Voltar a medir o isolamento e fazer o ensaio funcional.",
    },
    fim_curto_embebido: {
      tipo: "fim", tipoAvaria: "curto", parar: true, ref: REF.m20_2,
      causa: "Curto-circuito numa canalização embebida que não se consegue localizar.",
      acao: "Deixar o circuito desligado e sinalizado; propor a passagem de cabo novo (orçamento à parte). Nunca religar repetidamente.",
    },
    fim_disjuntor_avariado: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m10_3, REF.m10_4],
      causa: "Disjuntor avariado: dispara sem nada ligado à saída.",
      acao: "Substituir por um igual — mesmo calibre e curva, poder de corte de 6 kA (padrão Domus) — e fazer o ensaio funcional.",
    },
    fim_carga_fixa: {
      tipo: "fim", tipoAvaria: "curto", ref: REF.m20_2,
      causa: "Curto-circuito num aparelho de ligação fixa do circuito (termoacumulador, placa, estore, luminária), que continuava ligado.",
      acao: "Desligar os aparelhos fixos nos bornes um a um até encontrar o que tem o defeito; reparar ou substituir esse aparelho.",
    },
    fim_sobrecarga: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m20_2, REF.m3_criterios],
      causa: "Sobrecarga: aparelhos a mais no mesmo circuito (a corrente passa o calibre do disjuntor).",
      acao: "Redistribuir as cargas ou criar um circuito próprio para o aparelho de maior potência. Nunca aumentar o calibre do disjuntor.",
    },
    fim_mau_aperto: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m20_2, REF.b53],
      causa: "Mau aperto: a ligação aquece e faz disparar o térmico do disjuntor antes do tempo.",
      acao: "Sem tensão, refazer a ligação (ponteira em cabo flexível, binário do fabricante); substituir o disjuntor ou o condutor que aqueceu.",
    },
    fim_disjuntor_fraco: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m10_3,
      causa: "Disjuntor com o térmico envelhecido (dispara abaixo do calibre) ou quadro muito quente.",
      acao: "Substituir o disjuntor por um igual (mesmo calibre e curva) e ver se o quadro tem espaço e ventilação.",
    },
    fim_seccao: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: REF.m3_tipo,
      causa: "Secção do cabo e calibre do disjuntor que não condizem (circuito mal dimensionado).",
      acao: "Repor a proteção certa para o cabo (ex.: 10 A em 1,5 mm²) ou passar cabo de secção adequada; nunca deixar um calibre maior do que o cabo aguenta.",
    },
    fim_curva: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m17_1, REF.m10_3],
      causa: "Proteção de curva errada para o arranque do motor.",
      acao: "Proteger o motor com disjuntor-motor ou disjuntor de curva D, confirmando a secção do cabo; nunca subir o calibre para «aguentar» o arranque.",
    },
  },
};
