// Árvores de diagnóstico — falta de energia e luzes (ronda 1; manual de instalações BT, caps. 6, 8, 10, 16, 20 e 21).
// Formato em web/diagnostico/motor.js. Textos nossos, curtos, a partir do manual da empresa.
import { TENSAO_REDE, QUEDA_LUZ, REF } from "./limites.js";

const SEM_TENSAO = "Sem tensão: regras de ouro cumpridas no circuito em causa.";
const MEDIR = "Multímetro em tensão alternada, pontas CAT III; meça entre fase e neutro.";

export const SEM_CORRENTE = {
  id: "sem-corrente", versao: 1, grupo: "Falta de energia",
  titulo: "Sem corrente num ponto, circuito ou divisão",
  sintoma: "Uma tomada ou uma luz não funciona, ou falta a corrente num circuito ou numa divisão.",
  inicio: "onde",
  nos: {
    onde: {
      tipo: "escolha", texto: "Onde falta a corrente?", ref: REF.m20_2,
      opcoes: [
        { texto: "Numa tomada", seguinte: "tomada_tensao" },
        { texto: "Numa luz", seguinte: "lampada" },
        { texto: "Num circuito inteiro ou numa divisão", seguinte: "quadro" },
      ],
    },
    tomada_tensao: {
      tipo: "valor", texto: "Tensão na tomada (fase–neutro)", ref: [REF.m20_2, REF.b44], tensao: true, fazer: MEDIR,
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "fim_aparelho_cliente", fora: "quadro", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    lampada: {
      tipo: "simnao", texto: "Uma lâmpada que se sabe boa (e compatível) acende nesse ponto?", ref: REF.m20_2,
      fazer: "Troque primeiro a lâmpada: é a causa mais comum.",
      sim: "fim_lampada", nao: "luz_tensao",
    },
    luz_tensao: {
      tipo: "valor", texto: "Tensão no ponto de luz com o interruptor ligado (fase–neutro, no casquilho ou no ligador)", ref: REF.m20_2, tensao: true, fazer: MEDIR,
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "fim_casquilho", fora: "retorno", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    retorno: {
      tipo: "simnao", texto: "Há continuidade no interruptor fechado (e nos comutadores ou telerruptor) e no retorno até ao ponto de luz?", ref: REF.m20_2,
      fazer: `${SEM_TENSAO} Multímetro em continuidade (sinal sonoro), nunca com tensão.`,
      sim: "quadro", nao: "fim_retorno", ficha: { verificacao: "continuidade" },
    },
    quadro: {
      tipo: "escolha", texto: "No quadro, como estão as proteções desse circuito?", ref: [REF.m20_2, REF.m20_1], ficha: { verificacao: "visual" },
      opcoes: [
        { texto: "Tudo ligado", seguinte: "saida_disjuntor" },
        { texto: "O disjuntor do circuito está em baixo", seguinte: "rearma_disjuntor" },
        { texto: "O diferencial está em baixo", seguinte: "rearma_diferencial" },
      ],
    },
    rearma_disjuntor: {
      tipo: "simnao", texto: "Ao rearmar uma vez, o disjuntor fica ligado e a corrente volta?", ref: REF.m20_1,
      fazer: "Uma vez só. Se disparar outra vez, não insista.",
      sim: "fim_disparo_pontual", nao: "fim_seguir_disjuntor",
    },
    rearma_diferencial: {
      tipo: "simnao", texto: "Ao rearmar uma vez, o diferencial fica ligado e a corrente volta?", ref: REF.m20_1,
      fazer: "Uma vez só. Se disparar outra vez, não insista.",
      sim: "fim_disparo_pontual", nao: "fim_seguir_diferencial",
    },
    saida_disjuntor: {
      tipo: "valor", texto: "Tensão à saída do disjuntor desse circuito (fase–neutro)", ref: [REF.m20_2, REF.b44], tensao: true,
      fazer: `${MEDIR} Com a tampa do quadro aberta: cuidado com as partes vizinhas em tensão.`,
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "primeiro_ponto", fora: "fim_disjuntor_sem_saida", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    primeiro_ponto: {
      tipo: "simnao", texto: "No primeiro ponto do circuito (o mais perto do quadro) há tensão?", ref: REF.m20_2, tensao: true, fazer: MEDIR,
      sim: "seguir_pontos", nao: "fim_aberto_quadro",
    },
    seguir_pontos: {
      tipo: "simnao", texto: "Seguindo o circuito ponto a ponto, encontrou onde deixa de haver tensão?", ref: REF.m20_2, tensao: true,
      fazer: "A falha está entre o último ponto com tensão e o primeiro sem. Com tensão só se mede; para abrir caixas e tomadas, desligue primeiro.",
      sim: "borne_anterior", nao: "fim_sem_localizar",
    },
    borne_anterior: {
      tipo: "simnao", texto: "Na tomada ou caixa anterior ao ponto sem tensão, há um borne solto, um ligador mal fechado ou a repicagem interrompida?", ref: [REF.m20_2, REF.b53],
      fazer: `${SEM_TENSAO} Abra a tomada ou caixa anterior e puxe ligeiramente cada condutor.`,
      sim: "fim_borne_solto", nao: "continuidade_troco", ficha: { verificacao: "visual" },
    },
    continuidade_troco: {
      tipo: "simnao", texto: "Há continuidade da fase e do neutro no troço entre os dois pontos?", ref: [REF.m20_2, REF.m16_2],
      fazer: `${SEM_TENSAO} Ligue as pontas de um lado e meça do outro (sinal sonoro / resistência baixa).`,
      sim: "fim_aparelhagem", nao: "fim_condutor_partido", ficha: { verificacao: "continuidade" },
    },
    fim_aparelho_cliente: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "A tomada tem tensão normal: o problema está no aparelho, na ficha ou na extensão do cliente.",
      acao: "Experimentar um aparelho que se sabe bom na tomada e o aparelho suspeito noutra tomada; se a tomada estiver gasta (alvéolos largos), substituí-la.",
    },
    fim_lampada: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "Lâmpada ou driver avariado.",
      acao: "Substituir a lâmpada (ou o driver da luminária LED) por uma compatível com o casquilho e, se houver, com o variador.",
    },
    fim_casquilho: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m20_2,
      causa: "Chega tensão ao ponto de luz: casquilho, ligador ou luminária avariados.",
      acao: "Sem tensão, refazer as ligações do ponto de luz ou substituir o casquilho/luminária; ensaio funcional no fim.",
    },
    fim_retorno: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m20_2,
      causa: "Interruptor avariado ou retorno solto ou partido.",
      acao: "Substituir o interruptor (ou comutador/telerruptor) ou refazer a ligação do retorno; confirmar que o interruptor corta a fase.",
    },
    fim_disparo_pontual: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_1,
      causa: "A proteção tinha disparado e rearmou sem voltar a disparar (disparo pontual).",
      acao: "Perguntar o que estava ligado quando disparou; se voltar a acontecer, seguir a árvore do disjuntor ou do diferencial. Registar a ocorrência.",
    },
    fim_seguir_disjuntor: {
      tipo: "fim", tipoAvaria: "outro", seguir: "disjuntor", ref: REF.m20_1,
      causa: "O disjuntor volta a disparar: há um curto-circuito ou uma sobrecarga no circuito.",
      acao: "Não insistir. Continuar com a árvore «O disjuntor dispara».",
    },
    fim_seguir_diferencial: {
      tipo: "fim", tipoAvaria: "terra", seguir: "diferencial", ref: REF.m20_1,
      causa: "O diferencial volta a disparar: há uma fuga à terra.",
      acao: "Não insistir. Continuar com a árvore «O diferencial dispara».",
    },
    fim_disjuntor_sem_saida: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m20_2, REF.m10_3],
      causa: "O disjuntor está ligado mas não dá tensão à saída (disjuntor avariado ou pente/alimentação do disjuntor solta).",
      acao: "Sem tensão, verificar a alimentação do disjuntor (pente, ponte, aperto); se estiver bem, substituir o disjuntor por um igual.",
    },
    fim_aberto_quadro: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m20_2, REF.b53],
      causa: "Circuito aberto entre o quadro e o primeiro ponto (borne solto no quadro ou condutor partido nesse troço).",
      acao: "Sem tensão, reapertar as ligações do circuito no quadro; medir a continuidade do troço e substituir o condutor se estiver partido.",
    },
    fim_borne_solto: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m20_2, REF.b53],
      causa: "Borne solto, ligador mal fechado ou repicagem interrompida a montante do ponto sem corrente.",
      acao: "Refazer a ligação (ligador próprio; repicagem só onde a aparelhagem tem bornes duplos), reapertar e fazer o ensaio funcional.",
    },
    fim_aparelhagem: {
      tipo: "fim", tipoAvaria: "aberto", ref: REF.m20_2,
      causa: "Os condutores estão inteiros: a tomada ou o aparelho de comando do ponto está avariado.",
      acao: "Substituir a tomada ou o aparelho de comando e fazer o ensaio funcional.",
    },
    fim_condutor_partido: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m20_2, REF.b53],
      causa: "Condutor partido no troço entre os dois pontos.",
      acao: "Substituir o condutor do troço (enfiar novo no tubo); se não passar, propor cabo novo à vista ou abertura de roço.",
    },
    fim_sem_localizar: {
      tipo: "fim", tipoAvaria: "aberto", parar: true, ref: REF.m20_2,
      causa: "Circuito aberto em canalização embebida sem se conseguir localizar o ponto.",
      acao: "Deixar o circuito desligado e sinalizado; usar um localizador de cabos ou propor um circuito novo (orçamento à parte).",
    },
  },
};

export const SEM_ENERGIA = {
  id: "sem-energia", versao: 1, grupo: "Falta de energia",
  titulo: "A casa toda sem energia",
  sintoma: "Nada funciona na casa: quadro, contador (DCP) ou rede do fornecedor.",
  inicio: "quadro",
  nos: {
    quadro: {
      tipo: "escolha", texto: "Como está o quadro de entrada?", ref: [REF.m8_3, REF.m10_6], ficha: { verificacao: "visual" },
      opcoes: [
        { texto: "O interruptor geral ou o disjuntor geral está em baixo", seguinte: "geral_rearma" },
        { texto: "Um diferencial geral está em baixo", seguinte: "fim_seguir_diferencial" },
        { texto: "Tudo ligado no quadro, mas não há energia", seguinte: "tensao_entrada" },
      ],
    },
    geral_rearma: {
      tipo: "simnao", texto: "Com todos os disjuntores de saída desligados, o geral rearma e fica ligado?", ref: [REF.m10_6, REF.m20_2],
      sim: "um_a_um", nao: "fim_geral_avariado",
    },
    um_a_um: {
      tipo: "simnao", texto: "Ligando os circuitos um a um, um deles faz disparar o geral?", ref: [REF.m10_6, REF.m20_2],
      sim: "fim_seletividade", nao: "fim_sobrecarga_geral",
    },
    tensao_entrada: {
      tipo: "valor", texto: "Tensão à entrada do quadro (bornes de entrada do geral, fase–neutro)", ref: [REF.m8_3, REF.b44], tensao: true,
      fazer: "Multímetro em tensão alternada, pontas CAT III (perto da origem a energia de um defeito é maior).",
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "fim_geral_sem_saida", fora: "dcp", acima: "fim_sobretensao", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    dcp: {
      tipo: "escolha", texto: "No contador, como está o DCP (o disjuntor de controlo de potência do operador)?", ref: [REF.m8_3b, REF.m10_6],
      fazer: "O contador, o DCP e os fusíveis da portinhola são do operador de rede: não se abre a selagem.",
      opcoes: [
        { texto: "Disparado (em baixo)", seguinte: "dcp_rearma" },
        { texto: "Ligado", seguinte: "vizinhos" },
        { texto: "Não há acesso ao contador", seguinte: "vizinhos" },
      ],
    },
    dcp_rearma: {
      tipo: "simnao", texto: "Com o geral do quadro desligado, o DCP rearma e fica ligado?", ref: [REF.m8_3b, REF.m10_6],
      fazer: "O cliente rearma o DCP (é dele o contrato). Depois volte a ligar o geral e os circuitos um a um.",
      sim: "potencia", nao: "fim_operador",
    },
    potencia: {
      tipo: "simnao", texto: "O DCP volta a disparar quando funcionam vários aparelhos ao mesmo tempo?", ref: [REF.m2_escaloes, REF.m10_6],
      sim: "fim_potencia", nao: "fim_dcp_pontual",
    },
    vizinhos: {
      tipo: "simnao", texto: "Os vizinhos (ou a iluminação pública) também estão sem energia?", ref: REF.m8_3,
      sim: "fim_falha_rede", nao: "fim_operador",
    },
    fim_seguir_diferencial: {
      tipo: "fim", tipoAvaria: "terra", seguir: "diferencial", ref: REF.m20_1,
      causa: "Disparou o diferencial geral: há uma fuga à terra num dos circuitos.",
      acao: "Não insistir. Continuar com a árvore «O diferencial dispara».",
    },
    fim_geral_avariado: {
      tipo: "fim", tipoAvaria: "outro", parar: true, ref: [REF.m10_6, REF.m20_1],
      causa: "O geral dispara sem nenhum circuito ligado: defeito no próprio quadro (barramento, pente, cablagem) ou geral avariado.",
      acao: "Deixar o quadro desligado a montante (DCP) e sinalizado; inspecionar o quadro sem tensão e substituir o que estiver danificado. Se houver marcas de arco ou queimado, parar e chamar apoio.",
    },
    fim_seletividade: {
      tipo: "fim", tipoAvaria: "curto", seguir: "disjuntor", ref: REF.m10_6,
      causa: "Um circuito faz disparar o geral antes do seu disjuntor (curto-circuito ou sobrecarga sem seletividade).",
      acao: "Deixar esse circuito desligado e continuar com a árvore «O disjuntor dispara»; rever a seletividade (razão de calibres ≥ 2 entre montante e jusante).",
    },
    fim_sobrecarga_geral: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m10_6, REF.m2_escaloes],
      causa: "A soma das cargas passa o calibre do geral (sobrecarga geral) ou o geral é de calibre igual ou superior ao DCP.",
      acao: "Medir a corrente total com a pinça nas horas de maior consumo; distribuir os consumos ou propor o aumento da potência contratada. No quadro de entrada, preferir interruptor geral (sem disparo).",
    },
    fim_geral_sem_saida: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m8_3, REF.m10_6],
      causa: "Chega tensão ao quadro, mas o interruptor/disjuntor geral não a deixa passar (contactos ou ligações avariados).",
      acao: "Sem tensão a montante (DCP desligado pelo cliente), verificar os apertos de entrada e de saída do geral e substituí-lo se for o caso.",
    },
    fim_sobretensao: {
      tipo: "fim", tipoAvaria: "outro", parar: true, ref: [REF.m8_3b, REF.m11_7],
      causa: "Tensão muito acima do normal à entrada: possível neutro da rede interrompido ou avaria do operador.",
      acao: "Desligar o geral e pedir ao cliente que desligue os aparelhos; contactar de imediato o operador de rede (E-REDES). Não religar até a tensão voltar ao normal; depois verificar o DST e os aparelhos.",
    },
    fim_operador: {
      tipo: "fim", tipoAvaria: "outro", parar: true, ref: REF.m8_3b,
      causa: "Sem tensão à saída do contador só nesta casa: fusíveis da portinhola, ramal ou contador — do operador de rede.",
      acao: "O cliente contacta o operador de rede (E-REDES) ou o comercializador; não se mexe no contador nem na portinhola. Deixar o geral desligado até a energia voltar.",
    },
    fim_falha_rede: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m8_3,
      causa: "Falha da rede pública: não é avaria da instalação.",
      acao: "Explicar ao cliente que é uma falha do operador de rede (E-REDES); deixar os aparelhos sensíveis desligados até a energia voltar.",
    },
    fim_potencia: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m2_escaloes, REF.m10_6],
      causa: "Potência contratada insuficiente para os consumos simultâneos (o DCP corta).",
      acao: "Ver os consumos que trabalham ao mesmo tempo e propor o escalão de potência seguinte (ex.: 6,9 → 10,35 kVA) ou a gestão de cargas; o geral e os diferenciais têm de acompanhar a nova potência.",
    },
    fim_dcp_pontual: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: REF.m10_6,
      causa: "Disparo pontual do DCP por um pico de consumo.",
      acao: "Explicar ao cliente que aparelhos de grande potência ao mesmo tempo fazem disparar o DCP; se se repetir, rever a potência contratada.",
    },
  },
};

export const LUZES = {
  id: "luzes", versao: 1, grupo: "Falta de energia",
  titulo: "Luzes a piscar ou fracas",
  sintoma: "LED que tremem ou ficam acesos com o interruptor desligado, luzes que baixam ou piscam.",
  inicio: "o_que",
  nos: {
    o_que: {
      tipo: "escolha", texto: "O que se nota?", ref: [REF.m20_2, REF.m21_3],
      opcoes: [
        { texto: "LED tremem, ou ficam com brilho com o interruptor desligado", seguinte: "variador" },
        { texto: "As luzes baixam quando arranca uma máquina", seguinte: "queda" },
        { texto: "Luzes a piscar em toda a casa", seguinte: "entrada" },
        { texto: "Uma só luz pisca", seguinte: "lampada_nova" },
      ],
    },
    variador: {
      tipo: "simnao", texto: "Há variador (regulador de luz) nesse circuito?", ref: REF.m21_3,
      sim: "compativel", nao: "interruptor_fase",
    },
    compativel: {
      tipo: "simnao", texto: "O variador e as lâmpadas LED são compatíveis (corte no início ou no fim de fase, potência mínima e máxima)?", ref: REF.m21_3,
      fazer: "Veja a marcação do variador e da lâmpada (dimável, leading/trailing edge, W mínimos).",
      sim: "interruptor_fase", nao: "fim_variador",
    },
    interruptor_fase: {
      tipo: "simnao", texto: "O interruptor corta a fase (e não o neutro)?", ref: [REF.m20_2, REF.m16_2], tensao: true,
      fazer: "Com o interruptor desligado, meça entre o ligador do ponto de luz e a terra: não deve haver tensão.",
      sim: "fim_induzida", nao: "fim_interruptor_neutro",
    },
    queda: {
      tipo: "valor", texto: "Queda de tensão no ponto de luz quando a máquina arranca (em % da tensão sem carga)", ref: [REF.m6_1, REF.m20_2], tensao: true,
      fazer: "Meça a tensão no ponto de luz sem a máquina e com ela a trabalhar; queda % = (U sem carga − U com carga) ÷ U sem carga × 100.",
      unidade: "%", casas: 1, max: 100, limite: { ...QUEDA_LUZ },
      dentro: "fim_arranque_normal", fora: "apertos",
    },
    entrada: {
      tipo: "valor", texto: "Tensão à entrada do quadro enquanto as luzes piscam (fase–neutro)", ref: [REF.m8_3, REF.b44], tensao: true,
      fazer: "Multímetro em tensão alternada, pontas CAT III; se tiver registo de mínimo e máximo, use-o.",
      unidade: "V", casas: 1, max: 1000, limite: { ...TENSAO_REDE },
      dentro: "apertos", fora: "fim_rede", acima: "fim_sobretensao", ficha: { verificacao: "tensao", valor: "tensao" },
    },
    apertos: {
      tipo: "simnao", texto: "No quadro, os bornes do geral, dos diferenciais e do neutro estão bem apertados e sem marcas de aquecimento?", ref: [REF.m20_2, REF.b53],
      fazer: "Sem tensão a montante (geral desligado e ausência de tensão verificada). Um neutro solto faz variar a luz em toda a casa.",
      sim: "fim_queda_cabo", nao: "fim_aperto_quadro", ficha: { verificacao: "visual" },
    },
    lampada_nova: {
      tipo: "simnao", texto: "Com uma lâmpada nova e compatível, a luz continua a piscar?", ref: REF.m20_2,
      sim: "ligacoes_ponto", nao: "fim_lampada_driver",
    },
    ligacoes_ponto: {
      tipo: "simnao", texto: "As ligações do ponto de luz e do interruptor estão firmes (sem condutor solto nem ligador frouxo)?", ref: [REF.m20_2, REF.b53],
      fazer: "Sem tensão: abra o ponto de luz e o interruptor e puxe ligeiramente cada condutor.",
      sim: "variador", nao: "fim_ligacao_solta", ficha: { verificacao: "visual" },
    },
    fim_variador: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m21_3,
      causa: "Variador incompatível com as lâmpadas LED.",
      acao: "Trocar o variador ou as lâmpadas por um par compatível (tipo de corte e potência mínima/máxima) e fazer o ensaio funcional.",
    },
    fim_induzida: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "Corrente induzida no retorno (cabo longo junto de outros condutores) mantém o LED com brilho residual.",
      acao: "Usar lâmpadas/drivers adequados ou o acessório recomendado pelo fabricante (carga base); em obra nova, separar o retorno dos outros circuitos.",
    },
    fim_interruptor_neutro: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m20_2, REF.m16_2],
      causa: "O interruptor corta o neutro em vez da fase (polaridade trocada): o ponto de luz fica com tensão mesmo apagado.",
      acao: "Sem tensão, ligar o interruptor à fase; verificar a polaridade dos outros aparelhos de corte unipolares do circuito.",
    },
    fim_arranque_normal: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m6_1,
      causa: "Queda de tensão dentro do limite do manual: é o arranque normal da máquina.",
      acao: "Se incomodar o cliente, propor um circuito próprio para a máquina (ou um arrancador suave, em motores). Registar a medição.",
    },
    fim_queda_cabo: {
      tipo: "fim", tipoAvaria: "sobrecarga", ref: [REF.m6_1, REF.m6_regra],
      causa: "Queda de tensão acima do limite: cabo demasiado comprido ou fino para a carga (alimentador ou circuito).",
      acao: "Calcular a queda (cap. 6) e propor secção maior ou circuito próprio para a carga; medir também à entrada para separar o que é da rede.",
    },
    fim_aperto_quadro: {
      tipo: "fim", tipoAvaria: "outro", ref: [REF.m20_2, REF.b53],
      causa: "Ligação solta no quadro (neutro ou geral): a tensão varia com a carga.",
      acao: "Sem tensão, reapertar ao binário do fabricante; substituir os bornes ou aparelhos que aqueceram. Repetir a medição com carga.",
    },
    fim_rede: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m8_3,
      causa: "A tensão da rede chega baixa ou instável ao quadro.",
      acao: "Registar os valores e pedir ao cliente que contacte o operador de rede (E-REDES); verificar também as ligações da portinhola ao quadro (do lado do cliente).",
    },
    fim_sobretensao: {
      tipo: "fim", tipoAvaria: "outro", parar: true, ref: [REF.m8_3b, REF.m11_7],
      causa: "Tensão muito acima do normal: possível neutro da rede interrompido.",
      acao: "Desligar o geral, pedir ao cliente que desligue os aparelhos e contactar de imediato o operador de rede (E-REDES). Não religar até a tensão voltar ao normal.",
    },
    fim_lampada_driver: {
      tipo: "fim", tipoAvaria: "outro", ref: REF.m20_2,
      causa: "Lâmpada ou driver LED avariado.",
      acao: "Substituir a lâmpada ou o driver por um compatível; se houver variador, confirmar a compatibilidade.",
    },
    fim_ligacao_solta: {
      tipo: "fim", tipoAvaria: "aberto", ref: [REF.m20_2, REF.b53],
      causa: "Ligação solta no ponto de luz ou no interruptor (o contacto abre e fecha).",
      acao: "Sem tensão, refazer as ligações com ligadores próprios e fazer o ensaio funcional.",
    },
  },
};
