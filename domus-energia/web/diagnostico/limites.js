// Limites e referências comuns às árvores de diagnóstico (web/diagnostico/arvores-*.js). Os números são os do manual de
// instalações BT da empresa (decisão do dono: o programa segue o manual); onde o manual não fixa número, o limite vai
// marcado "Referência prática" e está na lista do relatório para o dono confirmar. As páginas são as impressas.

export const ISOLAMENTO = { min: 0.5, aviso: 1, fonte: "Manual 16.2: ≥ 0,5 MΩ a 500 V CC por circuito (quadro 61A); objetivo Domus Energia ≥ 1 MΩ (anexo A)" };
export const TERRA = { abaixo: 100, fonte: "Manual 11.4: habitação com disjuntor de entrada diferencial, < 100 Ω (RTIEBT 801.5.6.1)" };
export const TENSAO_REDE = { entre: [207, 253], fonte: "Referência prática: 230 V ± 10 % (o manual não fixa a tolerância da rede; 253 V = 1,1 × U0, manual 11.7)" };
export const DIFERENCIAL_MS = { max: 300, fonte: "Referência prática: 300 ms a IΔn (manual 16.2: «tempo dentro do especificado»; normas EN 61008/61009)" };
export const CONTINUIDADE_PE = { max: 0.5, fonte: "Referência prática: 0,5 Ω tomada → quadro (manual 16.2: «resistência baixa», sem número)" };
export const QUEDA_LUZ = { max: 3, fonte: "Manual 6.1: queda máxima de 3 % na iluminação (quadro 52O)" };
// Ronda 2 (resto do manual).
export const QUEDA_OUTROS = { max: 5, fonte: "Manual 6.1: queda máxima de 5 % nos outros usos (quadro 52O)" };
export const QUEDA_COLUNA = { max: 1, fonte: "Manual 14.1: 1,0 % na coluna (1,5 % com a entrada), cos φ = 1 (RTIEBT 803.2.4.4)" };
export const QUEDA_ENTRADA = { max: 0.5, fonte: "Manual 14.1: 0,5 % na entrada (1,5 % com a coluna)" };
export const QUEDA_CAMPISMO = { max: 5, fonte: "Manual 13.7: queda de tensão admissível de 5 % nos parques de campismo" };
export const OCUPACAO_TUBO = { max: 40, fonte: "Manual 7.3: soma das secções exteriores ≤ 40 % da secção interior do tubo (3 ou mais condutores)" };
export const PONTOS_CIRCUITO = { max: 8, fonte: "Manual 2.3 e 3.2: no máximo 8 pontos de utilização por circuito (RTIEBT 801.5.3)" };
export const CLIMA_CIRCUITO = { max: 5, fonte: "Manual 3.2: climatização com um máximo de 5 aparelhos por circuito (RTIEBT 801.5.3)" };
export const RESERVA_QUADRO = { min: 20, fonte: "Manual 1 e 3.3: deixar pelo menos 20 % de módulos livres no quadro" };
export const DESEQUILIBRIO = { max: 20, fonte: "Manual 8.2: diferença entre a fase mais e a menos carregada pequena (prática: < 15–20 %)" };
export const ISOLAMENTO_TRS = { min: 0.25, fonte: "Manual 16.2: TRS/TRP ≥ 0,25 MΩ a 250 V CC (quadro 61A)" };
export const DST_LIGACOES = { max: 0.5, fonte: "Manual 11.7: ligações do DST à terra o mais curtas possível (soma < 0,5 m)" };
export const DST_UC = { min: 253, fonte: "Manual 11.7: Uc ≥ 1,1 × U0 = 253 V (na prática 275 V entre fase e neutro)" };
export const EMERGENCIA_DISTANCIA = { max: 15, fonte: "Manual 15.2: aparelhos de circulação a não mais de 15 m entre si" };
export const EMERGENCIA_AUTONOMIA = { min: 1, fonte: "Manual 15.3: blocos autónomos com autonomia superior a 1 h" };
export const KNX_LINHA = { max: 64, fonte: "Manual 21.2: até 64 aparelhos por linha com uma fonte normal" };
export const DALI_LINHA = { max: 64, fonte: "Manual 21.3: até 64 drivers por linha DALI" };
export const KNX_TENSAO = { entre: [21, 30], fonte: "Referência prática: 21–30 V CC nos aparelhos (norma KNX; o manual 21.2 diz «fonte de cerca de 29 V CC»)" };
export const MINIMA_TENSAO = { min: 85, fonte: "Manual 10.7: o motor só pode voltar a arrancar a partir de 85 % da tensão nominal (a proteção atua abaixo de cerca de 80 %)" };
export const FATOR_POTENCIA = { min: 95, fonte: "Manual 22.3: cos φ pretendido 0,95 a 0,98 (aqui em %: 95 a 98)" };
export const CAMPAINHA = { entre: [3, 24], fonte: "Manual 18.1: sinalização a tensão reduzida (3, 5, 8, 12 ou 24 V CA)" };
export const SELETIVIDADE = { min: 2, fonte: "Manual 10.6: razão de calibres montante/jusante ≥ 2 (fusíveis gG: ≥ 1,6)" };

export const REF = {
  b44: { cap: "B4.4", pagina: 17 }, b51: { cap: "B5.1", pagina: 18 }, b5acidente: { cap: "B5.1", pagina: 19 },
  b53: { cap: "B5.3", pagina: 20 }, b54: { cap: "B5.4", pagina: 20 },
  m2_escaloes: { cap: "2.5", pagina: 31 }, m3_criterios: { cap: "3.2", pagina: 33 }, m3_tipo: { cap: "3.2", pagina: 34 },
  m6_1: { cap: "6.1", pagina: 52 }, m6_regra: { cap: "6.1", pagina: 53 },
  m8_3: { cap: "8.3", pagina: 61 }, m8_3b: { cap: "8.3", pagina: 62 },
  m10_1: { cap: "10.1", pagina: 72 }, m10_3: { cap: "10.3", pagina: 73 }, m10_4: { cap: "10.4", pagina: 73 },
  m10_6: { cap: "10.6", pagina: 75 }, m10_7: { cap: "10.7", pagina: 75 }, m10_7b: { cap: "10.7", pagina: 76 },
  m11_1: { cap: "11.1", pagina: 77 }, m11_2: { cap: "11.2", pagina: 78 }, m11_3: { cap: "11.3", pagina: 78 }, m11_3b: { cap: "11.3", pagina: 79 },
  m11_4: { cap: "11.4", pagina: 79 }, m11_4b: { cap: "11.4", pagina: 80 }, m11_4c: { cap: "11.4", pagina: 81 },
  m11_5: { cap: "11.5", pagina: 81 }, m11_5b: { cap: "11.5", pagina: 82 }, m11_6: { cap: "11.6", pagina: 82 }, m11_7: { cap: "11.7", pagina: 83 },
  m12_3: { cap: "12.3", pagina: 88 },
  m16_1: { cap: "16.1", pagina: 101 }, m16_2: { cap: "16.2", pagina: 102 },
  m17_1: { cap: "17.1", pagina: 105 }, m17_2: { cap: "17.2", pagina: 106 },
  m20_1: { cap: "20.1", pagina: 115 }, m20_2: { cap: "20.2", pagina: 116 }, m20_3: { cap: "20.3", pagina: 117 },
  m21_3: { cap: "21.3", pagina: 120 }, anexoA: { cap: "A.1", pagina: 126 },
  // Ronda 2
  m1_5: { cap: "1.5", pagina: 24 }, m1_5b: { cap: "1.5", pagina: 25 }, m2_3: { cap: "2.3", pagina: 29 }, m2_4: { cap: "2.4", pagina: 30 },
  m2_5b: { cap: "2.5", pagina: 32 }, m3_minimos: { cap: "3.2", pagina: 35 }, m3_3: { cap: "3.3", pagina: 35 }, m4_4: { cap: "4.4", pagina: 44 },
  m5_3: { cap: "5.3", pagina: 48 }, m7_3: { cap: "7.3", pagina: 58 }, m8_2: { cap: "8.2", pagina: 61 }, m8_4: { cap: "8.4", pagina: 62 },
  m8_4b: { cap: "8.4", pagina: 63 }, m10_2: { cap: "10.2", pagina: 72 }, m10_6a: { cap: "10.6", pagina: 74 }, m11_7b: { cap: "11.7", pagina: 84 },
  m12_2: { cap: "12.2", pagina: 87 }, m13_1: { cap: "13.1", pagina: 89 }, m13_1b: { cap: "13.1", pagina: 90 }, m13_2: { cap: "13.2", pagina: 90 },
  m13_3: { cap: "13.3", pagina: 91 }, m13_4: { cap: "13.4", pagina: 91 }, m13_5: { cap: "13.5", pagina: 91 }, m13_5b: { cap: "13.5", pagina: 92 },
  m13_6: { cap: "13.6", pagina: 92 }, m13_7: { cap: "13.7", pagina: 92 }, m13_7b: { cap: "13.7", pagina: 93 }, m13_8: { cap: "13.8", pagina: 93 },
  m13_8b: { cap: "13.8", pagina: 94 }, m13_9: { cap: "13.9", pagina: 94 }, m14_1: { cap: "14.1", pagina: 95 }, m14_2: { cap: "14.2", pagina: 95 },
  m14_3: { cap: "14.3", pagina: 96 }, m14_4: { cap: "14.4", pagina: 96 }, m14_4b: { cap: "14.4", pagina: 97 }, m15_1: { cap: "15.1", pagina: 98 },
  m15_2: { cap: "15.2", pagina: 99 }, m15_3: { cap: "15.3", pagina: 99 }, m16_3: { cap: "16.3", pagina: 102 }, m17_3: { cap: "17.3", pagina: 106 },
  m17_3b: { cap: "17.3", pagina: 107 }, m18_1: { cap: "18.1", pagina: 108 }, m18_2: { cap: "18.2", pagina: 109 }, m18_3: { cap: "18.3", pagina: 109 },
  m18_3b: { cap: "18.3", pagina: 110 }, m18_4: { cap: "18.4", pagina: 110 }, m19_1: { cap: "19.1", pagina: 112 }, m19_1b: { cap: "19.1", pagina: 113 },
  m19_2: { cap: "19.2", pagina: 113 }, m19_3: { cap: "19.3", pagina: 114 }, m21_1: { cap: "21.1", pagina: 118 }, m21_2: { cap: "21.2", pagina: 119 },
  m21_3a: { cap: "21.3", pagina: 119 }, m21_4: { cap: "21.4", pagina: 120 }, m21_4b: { cap: "21.4", pagina: 121 }, m21_5: { cap: "21.5", pagina: 121 },
  m22_1: { cap: "22.1", pagina: 122 }, m22_1b: { cap: "22.1", pagina: 123 }, m22_2: { cap: "22.2", pagina: 123 }, m22_3: { cap: "22.3", pagina: 124 },
  m22_4: { cap: "22.4", pagina: 125 }, m9_3: { cap: "9.3", pagina: 69 }, m9_4: { cap: "9.4", pagina: 69 },
};
