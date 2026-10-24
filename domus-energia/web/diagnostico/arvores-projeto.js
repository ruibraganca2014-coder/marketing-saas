// Árvores de diagnóstico — projeto, circuitos e cabos (ronda 2; manual de instalações BT, caps. 1 a 7).
// Formato em web/diagnostico/motor.js; atalhos em construir.js. Textos nossos, curtos, a partir do manual da empresa.
import { arvore, sn, esc, val, fim, SEM_TENSAO } from "./construir.js";
import { REF, TERRA, QUEDA_LUZ, QUEDA_OUTROS, OCUPACAO_TUBO, PONTOS_CIRCUITO, CLIMA_CIRCUITO, RESERVA_QUADRO } from "./limites.js";

const G = "Projeto, circuitos e cabos";

export const ESQUEMA_TERRA = arvore("esquema-terra", G, "Esquema de ligação à terra (TT, TN, IT)", "Não se sabe o esquema, ou a proteção contra contactos indiretos não é a do esquema.", "qual", {
  qual: esc("Como é alimentada a instalação?", REF.m1_5, [
    ["Pela rede pública em BT (contador da E-REDES)", "tt_diferencial"],
    ["Por posto de transformação próprio (TN-S / TN-C-S)", "tn_pe"],
    ["Neutro isolado ou por impedância (IT: blocos operatórios, processos contínuos)", "fim_it"],
  ], { fazer: "Veja a entrada de energia: portinhola e contador do operador = esquema TT, quase sempre." }),
  tt_diferencial: sn("Todas as massas estão protegidas por diferencial (em TT o disjuntor sozinho não corta um defeito à terra)?", [REF.m1_5b, REF.m11_4], "tt_terra", "fim_tt_sem_dif", { ficha: { verificacao: "rcd" } }),
  tt_terra: val("Resistência do elétrodo de terra", [REF.m11_4c, REF.m1_5], "Ω", { ...TERRA }, "fim_tt_ok", "fim_tt_terra", { casas: 1, fazer: "Terrómetro (três elétrodos, ligador amovível aberto) ou pinça de terra." }),
  tn_pe: sn("O condutor de proteção (PE) acompanha a instalação desde a fonte e está ligado a todas as massas?", REF.m1_5, "fim_tn_ok", "fim_tn_pe", { fazer: `${SEM_TENSAO} Meça a continuidade do PE das massas ao terminal principal de terra.`, ficha: { verificacao: "continuidade" } }),
  fim_it: fim("outro", REF.m1_5, "Esquema IT: um primeiro defeito não corta a alimentação (a continuidade de serviço é a prioridade).", "Só com projeto e técnico responsável: verificar o controlador permanente de isolamento e procurar logo o primeiro defeito. Chamar apoio.", { parar: true }),
  fim_tt_sem_dif: fim("terra", [REF.m1_5b, REF.m11_3], "Esquema TT sem diferencial em parte das massas: uma fuga à terra pode não ser cortada.", "Instalar diferenciais (30 mA nas tomadas, casas de banho e exterior) em todos os circuitos e ensaiar."),
  fim_tt_terra: fim("terra", [REF.m11_4b, REF.m11_4c], "Esquema TT com resistência de terra acima do valor do manual.", "Melhorar o elétrodo (varetas em paralelo) até < 100 Ω ou garantir RA × IΔn ≤ 50 V com diferenciais adequados.", { seguir: "terra" }),
  fim_tt_ok: fim("outro", REF.m1_5, "Esquema TT com diferenciais e terra dentro do valor.", "Registar o esquema e a resistência de terra no relatório."),
  fim_tn_pe: fim("terra", REF.m1_5, "Esquema TN com PE interrompido ou em falta numa massa.", "Repor o condutor de proteção até à massa e voltar a medir a continuidade; com projeto, verificar a impedância da malha de defeito."),
  fim_tn_ok: fim("outro", REF.m1_5, "Esquema TN com o PE contínuo até às massas.", "Registar; a verificação da impedância da malha de defeito segue o projeto do posto de transformação."),
}, { palavras: "TT TN IT neutro massas posto de transformação" });

export const POTENCIA = arvore("potencia-contratada", G, "Potência contratada insuficiente ou errada", "O DCP corta com frequência, ou a potência não condiz com a casa.", "compartimentos", {
  compartimentos: esc("Quantos compartimentos tem a habitação (quartos, salas e cozinha)?", REF.m2_5b, [
    ["1 compartimento", "contratada", { Pmin: 3.45 }],
    ["2 a 6 compartimentos", "contratada", { Pmin: 6.9 }],
    ["Mais de 6 compartimentos", "contratada", { Pmin: 10.35 }],
  ]),
  contratada: val("Potência contratada (a da fatura ou do DCP)", [REF.m2_5b, REF.m2_escaloes], "kVA", { min: { var: "Pmin" }, fonte: "Manual 2.5: potências mínimas de dimensionamento em habitação (RTIEBT 801.5.2.2)" }, "simultaneos", "fim_abaixo_minimo", { casas: 2, max: 1000 }),
  simultaneos: sn("O DCP corta quando trabalham ao mesmo tempo os aparelhos de maior potência (placa, forno, máquinas, termoacumulador, ar condicionado, carregador)?", [REF.m2_4, REF.m2_escaloes], "gestao", "trifasico"),
  gestao: sn("O cliente aceita gerir as cargas (placa com limitação, máquinas a horas diferentes)?", REF.m2_5b, "fim_gestao", "fim_subir"),
  trifasico: sn("Acima de 10,35 kVA, a instalação é trifásica (ou monofásica com acordo do distribuidor) e as cargas estão repartidas pelas fases?", REF.m2_5b, "fim_ok", "fim_fases"),
  fim_abaixo_minimo: fim("sobrecarga", REF.m2_5b, "Potência contratada abaixo do mínimo regulamentar para o número de compartimentos.", "Propor o escalão mínimo (3,45 / 6,90 / 10,35 kVA) e confirmar que o geral e os diferenciais acompanham a potência."),
  fim_gestao: fim("sobrecarga", REF.m2_5b, "Potência suficiente para o uso normal, com picos de cargas simultâneas.", "Combinar com o cliente a gestão de cargas (placa com limitação, máquinas programadas); registar a decisão."),
  fim_subir: fim("sobrecarga", [REF.m2_escaloes, REF.m10_6], "Potência contratada insuficiente para as cargas simultâneas.", "Propor o escalão seguinte (ex.: 6,9 → 10,35 kVA); acima de 10,35 kVA, instalação trifásica. Atualizar o geral e os diferenciais (ex.: 63 A com 10,35 kVA)."),
  fim_fases: fim("sobrecarga", [REF.m2_5b, REF.m8_2], "Instalação acima de 10,35 kVA sem as cargas repartidas pelas fases.", "Repartir os circuitos pelas fases (quadro de cargas) e confirmar com o distribuidor a alimentação trifásica.", { seguir: "desequilibrio-fases" }),
  fim_ok: fim("outro", REF.m2_5b, "A potência contratada cumpre o mínimo e os cortes não vêm dos consumos simultâneos.", "Procurar a causa na instalação: seguir a árvore «A casa toda sem energia».", { seguir: "sem-energia" }),
}, { palavras: "DCP kVA escalão potência contratar" });

export const CIRCUITOS = arvore("circuitos", G, "Circuitos mal divididos ou com pontos a mais", "Um disparo apaga meia casa, pontos a mais num circuito, quadro sem espaço.", "pontos", {
  pontos: val("Pontos de utilização no circuito em causa (tomadas e pontos de luz; tomadas agrupadas no mesmo aparelho contam como um)", [REF.m2_3, REF.m3_criterios], "un.", { ...PONTOS_CIRCUITO }, "dedicados", "fim_pontos", { casas: 0, max: 200 }),
  dedicados: sn("Os aparelhos de potência elevada (placa, forno, máquinas, termoacumulador, ar condicionado, carregador) têm circuito próprio?", [REF.m2_4, REF.m3_criterios], "luz_tomadas", "fim_dedicados"),
  luz_tomadas: sn("A iluminação está separada das tomadas e há pelo menos dois circuitos de iluminação (um disparo nas tomadas não apaga a luz)?", REF.m3_criterios, "clima", "fim_luz"),
  clima: val("Aparelhos de climatização no mesmo circuito", REF.m3_criterios, "un.", { ...CLIMA_CIRCUITO }, "seccoes", "fim_clima", { casas: 0, max: 50 }),
  seccoes: sn("As secções mínimas estão cumpridas (luz 1,5 mm², tomadas e máquinas 2,5 mm², fogões 4 mm²) e todos os circuitos têm PE?", REF.m3_minimos, "reserva", "fim_seccoes", { ficha: { verificacao: "visual" } }),
  reserva: val("Módulos livres no quadro (em % do total)", [REF.m3_3], "%", { ...RESERVA_QUADRO }, "fim_ok", "fim_quadro", { casas: 0, max: 100 }),
  fim_pontos: fim("sobrecarga", REF.m2_3, "Circuito com mais de 8 pontos de utilização.", "Dividir o circuito em dois (nova proteção no quadro) e registar a alteração no esquema."),
  fim_dedicados: fim("sobrecarga", REF.m2_4, "Aparelho de potência elevada sem circuito próprio.", "Criar circuito dedicado com a secção e a proteção do quadro-tipo (ex.: placa 6 mm²/32 A, forno e máquinas 2,5 mm²/16 A)."),
  fim_luz: fim("outro", REF.m3_criterios, "Iluminação e tomadas no mesmo circuito (um defeito apaga a luz).", "Separar a iluminação das tomadas; pelo menos dois circuitos de iluminação em habitações com mais de uma zona."),
  fim_clima: fim("sobrecarga", REF.m3_criterios, "Mais de 5 aparelhos de climatização no mesmo circuito.", "Repartir a climatização por mais circuitos."),
  fim_seccoes: fim("sobrecarga", REF.m3_minimos, "Secção abaixo do mínimo ou circuito sem condutor de proteção.", "Substituir o cabo pela secção mínima e passar o PE; ajustar a proteção ao cabo."),
  fim_quadro: fim("outro", REF.m3_3, "Quadro sem a reserva de 20 % de módulos livres.", "Propor um quadro maior (fila completa seguinte) quando houver alterações; registar."),
  fim_ok: fim("outro", REF.m3_criterios, "A divisão em circuitos segue os critérios do manual.", "Registar o quadro de circuitos e as etiquetas."),
}, { palavras: "pontos tomadas circuito dedicado quadro módulos reserva" });

export const CORES = arvore("cores-condutores", G, "Cores ou identificação dos condutores erradas", "Cores fora da norma, verde/amarelo usado como fase ou neutro, circuitos sem identificação.", "verde_amarelo", {
  verde_amarelo: sn("O condutor verde/amarelo é usado só como condutor de proteção (PE)?", REF.m4_4, "azul", "fim_verde_amarelo", { fazer: "Meça antes de tocar: em instalações antigas as cores podem não ser as da norma.", ficha: { verificacao: "visual" } }),
  azul: sn("O azul claro é usado só como neutro?", REF.m4_4, "antigas", "fim_azul"),
  antigas: sn("Há condutores com cores fora da norma (vermelho, branco, amarelo)?", REF.m4_4, "fim_reidentificar", "etiquetas", { tensao: true, fazer: "Identifique-os medindo: fase–neutro, fase–terra, com o multímetro." }),
  etiquetas: sn("Os circuitos estão identificados no quadro e o esquema unifilar está na porta?", [REF.anexoA, REF.m16_2], "fim_ok", "fim_etiquetas"),
  fim_verde_amarelo: fim("terra", REF.m4_4, "Verde/amarelo usado como fase ou neutro: risco grave de choque.", "Desligar e substituir o condutor; o verde/amarelo só pode ser PE (nunca «provisoriamente»). Rever todo o circuito.", { parar: true }),
  fim_azul: fim("outro", REF.m4_4, "Azul claro usado como fase.", "Substituir o condutor ou reidentificá-lo com manga de cor ao longo do percurso, segundo a norma (HD 308)."),
  fim_reidentificar: fim("outro", REF.m4_4, "Condutores com cores fora da norma.", "Reidentificar cada condutor com mangas ou fita (castanho/preto/cinzento fases, azul neutro) depois de medir."),
  fim_etiquetas: fim("outro", REF.anexoA, "Quadro sem identificação dos circuitos ou sem esquema.", "Etiquetar os circuitos e colar o esquema unifilar na porta do quadro."),
  fim_ok: fim("outro", REF.m4_4, "Cores e identificação conformes.", "Registar no relatório da intervenção."),
}, { palavras: "castanho preto cinzento azul verde amarelo HD 308 etiquetas" });

export const QUEDA = arvore("queda-tensao", G, "Cabo subdimensionado ou queda de tensão", "Tensão baixa no fim de um circuito, aparelhos fracos, cabo que aquece.", "tipo", {
  tipo: esc("Que circuito é?", REF.m6_1, [
    ["Iluminação", "queda_luz"],
    ["Tomadas ou outros usos", "queda_outros"],
  ]),
  queda_luz: val("Queda de tensão no ponto mais afastado, com carga (em % da tensão na origem)", [REF.m6_1, REF.m6_regra], "%", { ...QUEDA_LUZ }, "aquece", "comprimento", { casas: 1, max: 100, tensao: true, fazer: "Meça na origem e no ponto mais afastado com a carga habitual; queda % = (U origem − U ponto) ÷ U origem × 100." }),
  queda_outros: val("Queda de tensão no ponto mais afastado, com carga (em % da tensão na origem)", [REF.m6_1, REF.m6_regra], "%", { ...QUEDA_OUTROS }, "aquece", "comprimento", { casas: 1, max: 100, tensao: true, fazer: "Meça na origem e no ponto mais afastado com a carga habitual." }),
  comprimento: sn("O circuito passa a regra rápida do manual (2,5 mm² a 16 A até cerca de 40 m; 1,5 mm² a 10 A até cerca de 23 m)?", REF.m6_regra, "fim_cabo_longo", "apertos"),
  apertos: sn("As ligações do circuito (quadro, caixas, tomadas) estão apertadas e sem marcas de aquecimento?", [REF.b53, REF.m20_2], "fim_alimentador", "fim_aperto", { fazer: SEM_TENSAO, ficha: { verificacao: "visual" } }),
  aquece: sn("Com a carga habitual, o cabo ou a proteção aquecem (ou a corrente passa a corrente admissível do cabo)?", [REF.m5_3, REF.m20_2], "fim_seccao", "fim_ok", { tensao: true }),
  fim_cabo_longo: fim("sobrecarga", [REF.m6_1, REF.m6_regra], "Circuito demasiado comprido para a secção (queda de tensão acima do limite).", "Calcular a secção pelo critério da queda de tensão (cap. 6) e substituir o cabo, ou dividir o circuito / aproximar um quadro parcial."),
  fim_alimentador: fim("sobrecarga", REF.m6_1, "Queda de tensão acima do limite sem causa no circuito: o alimentador ou a rede já gastam a margem.", "Medir também à entrada do quadro; o limite conta desde a origem (se o alimentador gasta 1 %, ao circuito restam 2 % ou 4 %). Rever o alimentador."),
  fim_aperto: fim("outro", [REF.b53, REF.m20_2], "Ligação solta ou oxidada a provocar queda de tensão.", "Refazer as ligações e voltar a medir a queda com carga."),
  fim_seccao: fim("sobrecarga", REF.m5_3, "Secção insuficiente para a corrente (o cabo aquece).", "Substituir o cabo pela secção calculada pelos seis critérios (cap. 5 e 6); nunca aumentar o calibre da proteção."),
  fim_ok: fim("outro", REF.m6_1, "Queda de tensão dentro do limite e cabo sem aquecimento.", "Registar a medição."),
}, { palavras: "secção mm² comprido cabo fino tensão baixa" });

export const TUBOS = arvore("tubos-cheios", G, "Tubo ou calha cheios demais", "O cabo não passa, o isolamento fica ferido ao enfiar, calha a abarrotar.", "ocupacao", {
  ocupacao: val("Ocupação do tubo (soma das áreas exteriores dos cabos ÷ área interior do tubo)", REF.m7_3, "%", { ...OCUPACAO_TUBO }, "circuitos", "fim_cheio", { casas: 0, max: 200, fazer: "Áreas aproximadas (H07V): 1,5 mm² = 7,1 mm²; 2,5 mm² = 10,2 mm²; 4 mm² = 13,9 mm²; 6 mm² = 18,1 mm²." }),
  circuitos: sn("Os circuitos que partilham o tubo vêm do mesmo quadro e têm a mesma tensão de isolamento?", REF.m7_3, "isolamento", "fim_misturados"),
  isolamento: sn("Ao enfiar ou puxar, algum cabo ficou com o isolamento ferido?", [REF.m7_3, REF.b53], "fim_ferido", "fim_ok"),
  fim_cheio: fim("outro", REF.m7_3, "Tubo acima da taxa de ocupação de 40 %.", "Passar um tubo adicional ou de diâmetro maior; não forçar a enfiação (danifica o isolamento)."),
  fim_misturados: fim("outro", REF.m7_3, "Circuitos de quadros diferentes ou de tensões de isolamento diferentes no mesmo tubo.", "Separar os circuitos em tubos próprios (energia, sinalização e telecomunicações separados)."),
  fim_ferido: fim("terra", [REF.m7_3, REF.m16_2], "Cabo com o isolamento ferido na enfiação.", "Substituir o troço e medir o isolamento do circuito.", { seguir: "isolamento" }),
  fim_ok: fim("outro", REF.m7_3, "Ocupação dentro do limite.", "Registar no relatório da intervenção."),
}, { palavras: "tubo calha enfiar ocupação 40 %" });

export const ILUMINACAO = arvore("iluminacao-insuficiente", G, "Iluminação insuficiente num local de trabalho", "Pouca luz num escritório, sala de aula, armazém ou corredor (iluminância abaixo do recomendado).", "local", {
  local: esc("Que espaço é?", REF.m9_3, [
    ["Corredores e circulação (100 lux)", "medir", { Em: 100 }],
    ["Instalações sanitárias (200 lux)", "medir", { Em: 200 }],
    ["Receção, sala de aula, produção média (300 lux)", "medir", { Em: 300 }],
    ["Escritório: escrita, leitura, ecrã (500 lux)", "medir", { Em: 500 }],
    ["Laboratório ou oficina de precisão (500–750 lux)", "medir", { Em: 500 }],
  ], { fazer: "Valores de referência da EN 12464-1 que o manual resume (confirmar a versão em vigor para cada tarefa)." }),
  medir: val("Iluminância medida no plano de trabalho (luxímetro)", REF.m9_3, "lx", { min: { var: "Em" }, fonte: "Manual 9.3: níveis de iluminação recomendados (EN 12464-1)" }, "fim_ok", "lampadas", { casas: 0, max: 100_000 }),
  lampadas: sn("Há lâmpadas fundidas, luminárias sujas ou fontes de cor/potência diferentes das do projeto?", REF.m9_4, "fim_manutencao", "fim_calculo", { ficha: { verificacao: "visual" } }),
  fim_manutencao: fim("outro", REF.m9_4, "Iluminação abaixo do recomendado por lâmpadas fundidas, sujidade ou lâmpadas trocadas.", "Substituir e limpar (o fator de manutenção do cálculo pressupõe limpeza) e voltar a medir."),
  fim_calculo: fim("outro", REF.m9_4, "Luminárias insuficientes para o espaço.", "Refazer o cálculo pelo método dos lúmens (N = E·A / (Φ·Fu·Fm)) e propor luminárias LED adicionais."),
  fim_ok: fim("outro", REF.m9_3, "Iluminância dentro do recomendado.", "Registar o valor medido; ver também o encandeamento (UGR) e a restituição de cor (Ra)."),
}, { palavras: "lux luxímetro iluminância escritório luz fraca EN 12464" });

export const ARVORES_PROJETO = [ESQUEMA_TERRA, POTENCIA, CIRCUITOS, CORES, QUEDA, TUBOS, ILUMINACAO];
