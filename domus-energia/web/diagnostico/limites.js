// Limites e referências comuns às árvores de diagnóstico (web/diagnostico/arvores-*.js). Os números são os do manual de
// instalações BT da empresa (decisão do dono: o programa segue o manual); onde o manual não fixa número, o limite vai
// marcado "Referência prática" e está na lista do relatório para o dono confirmar. As páginas são as impressas.

export const ISOLAMENTO = { min: 0.5, aviso: 1, fonte: "Manual 16.2: ≥ 0,5 MΩ a 500 V CC por circuito (quadro 61A); objetivo Domus Energia ≥ 1 MΩ (anexo A)" };
export const TERRA = { abaixo: 100, fonte: "Manual 11.4: habitação com disjuntor de entrada diferencial, < 100 Ω (RTIEBT 801.5.6.1)" };
export const TENSAO_REDE = { entre: [207, 253], fonte: "Referência prática: 230 V ± 10 % (o manual não fixa a tolerância da rede; 253 V = 1,1 × U0, manual 11.7)" };
export const DIFERENCIAL_MS = { max: 300, fonte: "Referência prática: 300 ms a IΔn (manual 16.2: «tempo dentro do especificado»; normas EN 61008/61009)" };
export const CONTINUIDADE_PE = { max: 0.5, fonte: "Referência prática: 0,5 Ω tomada → quadro (manual 16.2: «resistência baixa», sem número)" };
export const QUEDA_LUZ = { max: 3, fonte: "Manual 6.1: queda máxima de 3 % na iluminação (quadro 52O)" };

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
};
