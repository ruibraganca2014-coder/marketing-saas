// Desenho da planta do simulador de orçamento (docs/SIMULADOR-ORCAMENTO.md §2.1).
// Módulo ÚNICO, sem dependências: o simulador (web/) usa-o para editar e o painel
// da empresa copia-o para painel/public/vendor/planta-svg.js (visualizador só leitura).
//
//   desenharPlanta(svg, planta, { soLeitura })
//
// - `planta` no formato do §2.1 (centímetros a partir do canto superior esquerdo). Uma divisão com
//   `pontos` ([[x, y], ...], 3–24 cantos) é um polígono; sem eles, o retângulo x/y/largura/altura.
// - Nenhum texto entra como HTML: nomes só com textContent (em <text> e <title>).
// - Cores com as variáveis do tema "Terra" (docs/TEMA.md) e valores de recurso,
//   aplicadas pelo CSSOM (funciona com CSP sem 'unsafe-inline').
// - A imagem de fundo só é usada se for data:image/jpeg|png;base64.
//
// Opções (todas opcionais):
//   soLeitura   true → sem pegas nem destaque de seleção (visualizador)
//   selecionado id da divisão ou do elemento selecionado (editor): anel grosso cor de argila à volta, com um
//               halo que pulsa devagar (classe `selecao-halo`, animada no CSS do simulador; parada com
//               movimento reduzido); o resto fica esbatido (opacidade 0,35), menos os aparelhos da
//               divisão selecionada
//   vista       {x, y, w, h} em cm para o viewBox (por omissão, a planta toda)
//   raio        raio dos ícones em cm (por omissão, proporcional ao tamanho da planta)
//   raioToque   raio da zona de toque dos elementos em cm (≥ raio)
//   letra       tamanho da letra dos nomes das divisões em cm
//   pega        lado das pegas dos cantos em cm
//   grelha      false → sem quadriculado
//   piso        n.º do piso (0 = r/c) → só as divisões e os elementos desse piso (`piso` em falta = 0);
//               todos os pisos partilham a mesma folha e a mesma escala
//   acoes       {omissao} (lote 7) → cada aparelho com ação (`acao`: manter, reparar, substituir, novo) diferente da
//               omissão do serviço leva um selo pequeno com a letra (M, R, S, N) no canto de cima à direita;
//               sem `acoes`, nenhum selo (LEGENDA_ACOES: o texto da legenda). Lote 8 (passo "Trocar e reparar"):
//               `todas: true` → selo em todos os aparelhos com ação (também os da omissão); com `escolher: true`
//               só nos que têm a ação escolhida (sem "Instalação nova" a omissão não conta como resposta)
//   pegas       false → sem as pegas dos cantos da divisão selecionada (lote 8: divisões presas fora dos passos
//               "A casa" e "Planta")
//
// Cada máquina tem o seu ícone (`maquina_<modelo>`; sem ícone próprio, o genérico); os botões de divisão do
// editor têm um desenho por tipo (`desenharIcone(svg, "divisao", {tipo})`: sofá, cama, fogão, banheira…). Os nomes das divisões
// ficam por cima dos ícones (com contorno da cor do papel) e encolhem para caber na divisão.
// Os tipos antigos de telecomunicações (telecom_*) já não existem: desenham-se com o ícone genérico.

const NS = "http://www.w3.org/2000/svg";
const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const COR = {
  fundo: "var(--superficie, #fffdf0)",
  texto: "var(--texto, #283618)",
  suave: "var(--texto-suave, #5c6446)",
  borda: "var(--borda, #e6e0bf)",
  musgo: "var(--musgo, #606c38)",
  musgoClaro: "var(--musgo-claro, #eef0d9)",
  areia: "var(--areia, #dda15e)",
  argila: "var(--argila, #bc6c25)",
};

const NOMES = {
  porta: "Porta", janela: "Janela", quadro: "Quadro elétrico", tomada: "Tomada", luz: "Ponto de luz",
  interruptor: "Interruptor", maquina: "Máquina", sensor_porta: "Sensor de porta/janela", sensor_movimento: "Sensor de movimento",
};
const MODELOS = {
  termoacumulador: "Termoacumulador", ar_condicionado: "Ar condicionado", placa: "Placa de cozinha", forno: "Forno",
  maquina_lavar: "Máquina de lavar roupa", maquina_secar: "Máquina de secar roupa", maquina_loica: "Máquina de lavar loiça",
  frigorifico: "Frigorífico", televisao: "Televisão", bomba_calor: "Bomba de calor", carregador_ve: "Carregador de carro elétrico", bomba: "Bomba (piscina/rega)",
  esquentador: "Esquentador elétrico instantâneo", radiador: "Aquecedor / radiador elétrico", hidromassagem: "Hidromassagem / jacuzzi",
  air_fryer: "Air fryer", torradeira: "Torradeira", cafe_expresso: "Máquina de café expresso", campainha_video: "Campainha com vídeo",
  carregador_bicicleta: "Carregador de bicicleta / trotinete", toalheiro: "Aquecedor de toalhas",
  arca_frigorifica: "Arca / vitrine frigorífica", maquina_cafe: "Máquina de café profissional", servidor: "Servidor / bastidor", compressor: "Compressor",
  soldadura: "Máquina de soldar", maquina_trifasica: "Máquina trifásica", portao_industrial: "Portão industrial", carregador_ve_22: "Carregador de carro elétrico 22 kW",
  arca_congeladora: "Arca congeladora", micro_ondas: "Micro-ondas", exaustor: "Exaustor", cafeteira: "Cafeteira / chaleira", computador: "Computador",
  consola: "Consola de jogos", desumidificador: "Desumidificador", aquecedor_portatil: "Aquecedor portátil", box_router: "Box / router do operador",
  repetidor_wifi: "Repetidor Wi-Fi", nas: "NAS (discos em rede)", camara: "Câmara de vigilância", portao: "Portão automático", rega: "Rega automática",
  iluminacao_jardim: "Iluminação exterior", aspirador_robo: "Aspirador robô", impressora: "Impressora", terminal_pagamento: "Caixa / terminal de pagamento",
  reclamo: "Reclamo luminoso", ferramentas: "Ferramentas elétricas portáteis", aspirador_industrial: "Aspirador industrial", carregador_baterias: "Carregador de baterias",
  outro: "Outra máquina",
};

// Ícones em traço (caixa 48 × 48, centro 24,24), no estilo das ilustrações "Terra".
// Cada entrada: lista de [tag, atributos, papel] — papel "t" = traço, "c" = cheio (areia), "a" = cheio (argila).
const ICONES = {
  porta: [["path", { d: "M16 38V11.5c5.4-.4 10.7-.4 16 0V38" }, "t"], ["path", { d: "M12 38.5h24" }, "t"], ["circle", { cx: 28.2, cy: 25.5, r: 1.6 }, "c"]],
  janela: [["path", { d: "M12.5 13c7.7-.4 15.3-.4 23 0 .4 7.3.4 14.7 0 22-7.7.4-15.3.4-23 0-.4-7.3-.4-14.7 0-22z" }, "t"], ["path", { d: "M24 13v22M12.8 24h22.4" }, "t"]],
  janela_estore: [["path", { d: "M12.5 13c7.7-.4 15.3-.4 23 0 .4 7.3.4 14.7 0 22-7.7.4-15.3.4-23 0-.4-7.3-.4-14.7 0-22z" }, "t"], ["path", { d: "M13 17.5h22M13 21.5h22M13 25.5h22" }, "t"]],
  quadro: [["rect", { x: 13, y: 11, width: 22, height: 26, rx: 3 }, "t"], ["path", { d: "M18 17v6M22.5 17v6M27 17v6M31 17v6M17 30h14" }, "t"]],
  tomada: [["circle", { cx: 24, cy: 24, r: 11.5 }, "t"], ["circle", { cx: 19.8, cy: 24, r: 1.7 }, "c"], ["circle", { cx: 28.2, cy: 24, r: 1.7 }, "c"]],
  tomada_dupla: [["rect", { x: 9.5, y: 16, width: 29, height: 16, rx: 7 }, "t"], ["circle", { cx: 16, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 20.5, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 27.5, cy: 24, r: 1.5 }, "c"], ["circle", { cx: 32, cy: 24, r: 1.5 }, "c"]],
  luz: [["path", { d: "M18.3 27.8c-2.1-1.8-3.3-4.3-3.3-7C15 15.9 19 12 24 12s9 3.9 9 8.8c0 2.7-1.2 5.2-3.3 7-1 .9-1.6 2-1.6 3.3v.9h-8.2v-.9c0-1.3-.6-2.4-1.6-3.3z" }, "t"], ["path", { d: "M20.6 35.5h6.8" }, "t"]],
  interruptor: [["rect", { x: 14, y: 12, width: 20, height: 24, rx: 4 }, "t"], ["rect", { x: 20, y: 17.5, width: 8, height: 13, rx: 2 }, "t"]],
  maquina: [["rect", { x: 13, y: 11, width: 22, height: 26, rx: 3 }, "t"], ["circle", { cx: 24, cy: 26, r: 6.5 }, "t"], ["path", { d: "M17 15.5h5" }, "t"]],
  maquina_televisao: [["rect", { x: 9.5, y: 12, width: 29, height: 19, rx: 2.5 }, "t"], ["path", { d: "M19 36.5h10M24 31v5.5" }, "t"]],
  sensor_porta: [["rect", { x: 13, y: 14, width: 8, height: 20, rx: 2 }, "t"], ["rect", { x: 25, y: 16, width: 6, height: 16, rx: 2 }, "t"], ["path", { d: "M35 19.5c1.8 2.9 1.8 6.1 0 9" }, "t"]],
  sensor_movimento: [["circle", { cx: 18, cy: 24, r: 5.5 }, "t"], ["path", { d: "M27 18.5c2.6 3.4 2.6 7.6 0 11M31.5 15c4.3 5.5 4.3 12.5 0 18" }, "t"]],
  // Máquinas: um desenho por modelo (web/simulador/regras.js MODELOS; "outro" usa o genérico `maquina`).
  maquina_termoacumulador: [["rect", { x: 15, y: 9, width: 18, height: 28, rx: 8 }, "t"], ["path", { d: "M20 37v3.5M28 37v3.5" }, "t"], ["circle", { cx: 24, cy: 18, r: 3 }, "t"]],
  maquina_ar_condicionado: [["rect", { x: 8, y: 13, width: 32, height: 13, rx: 3 }, "t"], ["path", { d: "M12 21.5h24" }, "t"], ["path", { d: "M16 30.5c1.4 1.8 1.4 3.9 0 5.7M24 30.5c1.4 1.8 1.4 3.9 0 5.7M32 30.5c1.4 1.8 1.4 3.9 0 5.7" }, "t"]],
  maquina_placa: [["rect", { x: 10, y: 10, width: 28, height: 28, rx: 3 }, "t"], ["circle", { cx: 18, cy: 18, r: 4 }, "t"], ["circle", { cx: 30, cy: 18, r: 4 }, "t"], ["circle", { cx: 18, cy: 30, r: 4 }, "t"], ["circle", { cx: 30, cy: 30, r: 4 }, "t"]],
  maquina_forno: [["rect", { x: 11, y: 10, width: 26, height: 28, rx: 3 }, "t"], ["rect", { x: 15, y: 20, width: 18, height: 13, rx: 2 }, "t"], ["circle", { cx: 17, cy: 15, r: 1.5 }, "c"], ["circle", { cx: 24, cy: 15, r: 1.5 }, "c"], ["circle", { cx: 31, cy: 15, r: 1.5 }, "c"]],
  maquina_maquina_lavar: [["rect", { x: 12, y: 9, width: 24, height: 30, rx: 3 }, "t"], ["circle", { cx: 24, cy: 26, r: 7.5 }, "t"], ["path", { d: "M17 14.5h5" }, "t"], ["circle", { cx: 31, cy: 14.5, r: 1.4 }, "c"]],
  maquina_maquina_secar: [["rect", { x: 12, y: 9, width: 24, height: 30, rx: 3 }, "t"], ["circle", { cx: 24, cy: 26, r: 7.5 }, "t"], ["path", { d: "M19.5 26.5c1.5-2 3-2 4.5 0s3 2 4.5 0M17 14.5h5" }, "t"]],
  maquina_maquina_loica: [["rect", { x: 12, y: 9, width: 24, height: 30, rx: 3 }, "t"], ["path", { d: "M12 16h24M18.5 22v11M24 22v11M29.5 22v11" }, "t"]],
  maquina_frigorifico: [["rect", { x: 14, y: 8, width: 20, height: 32, rx: 3 }, "t"], ["path", { d: "M14 19h20M18.5 12.5v3.5M18.5 23v6" }, "t"]],
  maquina_bomba_calor: [["rect", { x: 8, y: 13, width: 32, height: 22, rx: 3 }, "t"], ["circle", { cx: 19, cy: 24, r: 6.5 }, "t"], ["path", { d: "M19 19.5v9M14.5 24h9M31 18v12M35 18v12" }, "t"]],
  maquina_carregador_ve: [["rect", { x: 13, y: 9, width: 15, height: 29, rx: 3 }, "t"], ["path", { d: "M28 21c6 0 7.5 3.5 7.5 8.5v5" }, "t"], ["path", { d: "M22 14l-4.5 7.5h4l-1.5 6 5-8.5h-4z" }, "c"]],
  maquina_carregador_ve_22: [["rect", { x: 11, y: 9, width: 15, height: 29, rx: 3 }, "t"], ["path", { d: "M26 21c6 0 7.5 3.5 7.5 8.5v5M32 10.5v5M35.5 10.5v5M39 10.5v5" }, "t"], ["path", { d: "M20 14l-4.5 7.5h4l-1.5 6 5-8.5h-4z" }, "c"]],
  maquina_bomba: [["circle", { cx: 20, cy: 27, r: 8.5 }, "t"], ["path", { d: "M28.5 27H39M20 18.5V11h9" }, "t"], ["circle", { cx: 20, cy: 27, r: 2.2 }, "c"]],
  maquina_arca_frigorifica: [["rect", { x: 9, y: 11, width: 30, height: 26, rx: 3 }, "t"], ["rect", { x: 13, y: 15, width: 22, height: 11, rx: 1.5 }, "t"], ["path", { d: "M24 29v6M21 32h6" }, "t"]],
  maquina_maquina_cafe: [["rect", { x: 11, y: 9, width: 26, height: 9, rx: 2 }, "t"], ["path", { d: "M14 18v20h20V18M24 18v4" }, "t"], ["rect", { x: 19.5, y: 26, width: 9, height: 7, rx: 1.5 }, "t"]],
  maquina_servidor: [["rect", { x: 13, y: 8, width: 22, height: 32, rx: 2 }, "t"], ["path", { d: "M13 16h22M13 24h22M13 32h22M22 12h9M22 20h9M22 28h9" }, "t"], ["circle", { cx: 17, cy: 12, r: 1.3 }, "c"], ["circle", { cx: 17, cy: 20, r: 1.3 }, "c"], ["circle", { cx: 17, cy: 28, r: 1.3 }, "c"]],
  maquina_compressor: [["rect", { x: 8, y: 20, width: 26, height: 14, rx: 7 }, "t"], ["circle", { cx: 34, cy: 13, r: 4.5 }, "t"], ["path", { d: "M34 17.5V21" }, "t"], ["circle", { cx: 14, cy: 37.5, r: 1.8 }, "c"], ["circle", { cx: 28, cy: 37.5, r: 1.8 }, "c"]],
  maquina_soldadura: [["path", { d: "M11 37l13-13M24 24l4.5-4.5" }, "t"], ["path", { d: "M33 12.5l2-4M35.5 17l4.5-1M29.5 10l-1-3.5M37 11.5l3-3" }, "t"], ["circle", { cx: 30.5, cy: 17.5, r: 2.2 }, "a"]],
  maquina_maquina_trifasica: [["circle", { cx: 24, cy: 24, r: 7.5 }, "t"], ["path", { d: "M24 10.5v4.5M24 33v4.5M10.5 24h4.5M33 24h4.5M14.5 14.5l3.2 3.2M30.3 30.3l3.2 3.2M14.5 33.5l3.2-3.2M30.3 17.7l3.2-3.2" }, "t"], ["circle", { cx: 24, cy: 24, r: 2.2 }, "c"]],
  maquina_portao_industrial: [["rect", { x: 9, y: 10, width: 30, height: 28, rx: 2 }, "t"], ["path", { d: "M9 16h30M9 22h30M9 28h30M9 34h30" }, "t"]],
  maquina_arca_congeladora: [["rect", { x: 9, y: 17, width: 30, height: 19, rx: 3 }, "t"], ["path", { d: "M9 23h30M21 20h6M24 26.5v7M20.5 30h7M21.5 27.5l5 5M26.5 27.5l-5 5" }, "t"]],
  maquina_micro_ondas: [["rect", { x: 8, y: 13, width: 32, height: 22, rx: 3 }, "t"], ["rect", { x: 12, y: 17, width: 17, height: 14, rx: 2 }, "t"], ["circle", { cx: 34.5, cy: 19, r: 1.4 }, "c"], ["circle", { cx: 34.5, cy: 24, r: 1.4 }, "c"], ["path", { d: "M34.5 28.5v2" }, "t"]],
  maquina_exaustor: [["path", { d: "M10 29h28l-7-9H17z" }, "t"], ["path", { d: "M19.5 20V9h9v11M16 33.5v3.5M24 33.5v3.5M32 33.5v3.5" }, "t"]],
  maquina_cafeteira: [["path", { d: "M14 37h18l-2.5-16h-13z" }, "t"], ["path", { d: "M31 24c4.5 0 5.5 5.5 1 8.5M18.5 21c0-3.5 9-3.5 9 0M16.5 25l-5.5-4" }, "t"]],
  maquina_computador: [["rect", { x: 12, y: 12, width: 24, height: 16, rx: 2 }, "t"], ["path", { d: "M8 32h32l-3 4.5H11z" }, "t"]],
  maquina_consola: [["path", { d: "M16 18h16c5.5 0 8.6 5.2 7.6 11.3-.5 3.1-3.9 4.3-6.1 2.1L30.5 28h-13l-3 3.4c-2.2 2.2-5.6 1-6.1-2.1C7.4 23.2 10.5 18 16 18z" }, "t"], ["path", { d: "M16.5 21.5v6M13.5 24.5h6" }, "t"], ["circle", { cx: 30.5, cy: 23, r: 1.5 }, "c"], ["circle", { cx: 34, cy: 26, r: 1.5 }, "c"]],
  maquina_desumidificador: [["rect", { x: 13, y: 9, width: 22, height: 30, rx: 4 }, "t"], ["path", { d: "M24 15.5c3.2 4.2 4.3 6.3 4.3 8.4a4.3 4.3 0 0 1-8.6 0c0-2.1 1.1-4.2 4.3-8.4z" }, "t"], ["path", { d: "M17.5 34h13" }, "t"]],
  maquina_aquecedor_portatil: [["rect", { x: 10, y: 12, width: 28, height: 23, rx: 3 }, "t"], ["path", { d: "M16 16v15M21.3 16v15M26.7 16v15M32 16v15M13.5 35v3.5M34.5 35v3.5" }, "t"]],
  maquina_box_router: [["rect", { x: 9, y: 24, width: 30, height: 11, rx: 3 }, "t"], ["path", { d: "M15 24l-3-10M33 24l3-10" }, "t"], ["circle", { cx: 16, cy: 29.5, r: 1.3 }, "c"], ["circle", { cx: 21, cy: 29.5, r: 1.3 }, "c"], ["circle", { cx: 26, cy: 29.5, r: 1.3 }, "c"]],
  maquina_repetidor_wifi: [["rect", { x: 16, y: 20, width: 16, height: 18, rx: 3 }, "t"], ["path", { d: "M15.5 15c5-4 12-4 17 0M19.5 11c2.8-1.8 6.2-1.8 9 0" }, "t"], ["circle", { cx: 24, cy: 29, r: 1.6 }, "c"]],
  maquina_nas: [["rect", { x: 12, y: 9, width: 24, height: 30, rx: 3 }, "t"], ["path", { d: "M12 19h24M12 29h24" }, "t"], ["circle", { cx: 30.5, cy: 14, r: 1.3 }, "c"], ["circle", { cx: 30.5, cy: 24, r: 1.3 }, "c"], ["circle", { cx: 30.5, cy: 34, r: 1.3 }, "c"]],
  maquina_camara: [["rect", { x: 8, y: 15, width: 23, height: 13, rx: 3 }, "t"], ["path", { d: "M31 19.5l8-3.5v11.5l-8-3.5M16 28v8M11 36h10" }, "t"], ["circle", { cx: 14, cy: 21.5, r: 1.6 }, "c"]],
  maquina_portao: [["path", { d: "M9 38V16h30v22M15 16v22M21 16v22M27 16v22M33 16v22M7 38h34" }, "t"]],
  maquina_rega: [["path", { d: "M24 38V26M20 22h8v4h-8zM24 21c-5-7-9.5-8.5-13.5-7.5M24 21c5-7 9.5-8.5 13.5-7.5" }, "t"], ["circle", { cx: 11, cy: 19.5, r: 1.4 }, "c"], ["circle", { cx: 37, cy: 19.5, r: 1.4 }, "c"]],
  maquina_iluminacao_jardim: [["path", { d: "M24 38V21M19 38h10M18 21h12l-2.5-9h-7z" }, "t"], ["circle", { cx: 24, cy: 16.5, r: 1.6 }, "c"]],
  maquina_aspirador_robo: [["circle", { cx: 24, cy: 24, r: 13 }, "t"], ["path", { d: "M14.5 17.5c5.5-5 13.5-5 19 0" }, "t"], ["circle", { cx: 24, cy: 26, r: 2.2 }, "c"]],
  maquina_impressora: [["rect", { x: 9, y: 18, width: 30, height: 13, rx: 2 }, "t"], ["path", { d: "M15 18v-8h18v8M15 31v7h18v-7" }, "t"], ["circle", { cx: 34, cy: 22.5, r: 1.3 }, "c"]],
  maquina_terminal_pagamento: [["rect", { x: 14, y: 8, width: 20, height: 32, rx: 3 }, "t"], ["rect", { x: 17.5, y: 11.5, width: 13, height: 8, rx: 1 }, "t"], ["path", { d: "M18.5 25h2M23 25h2M27.5 25h2M18.5 30h2M23 30h2M27.5 30h2M18.5 35h2M23 35h2M27.5 35h2" }, "t"]],
  maquina_reclamo: [["rect", { x: 8, y: 12, width: 32, height: 16, rx: 3 }, "t"], ["path", { d: "M14 28v10M34 28v10M14 18h20M17 22.5h14" }, "t"]],
  maquina_ferramentas: [["rect", { x: 10, y: 15, width: 19, height: 10, rx: 2 }, "t"], ["path", { d: "M29 20h9M16 25l-3 12h7.5l2-12" }, "t"]],
  maquina_aspirador_industrial: [["rect", { x: 11, y: 16, width: 20, height: 20, rx: 4 }, "t"], ["path", { d: "M11 21.5h20M31 23c6 0 7.5-6 5.5-12" }, "t"], ["circle", { cx: 15.5, cy: 38, r: 1.8 }, "c"], ["circle", { cx: 26.5, cy: 38, r: 1.8 }, "c"]],
  maquina_esquentador: [["rect", { x: 15, y: 8, width: 18, height: 27, rx: 4 }, "t"], ["path", { d: "M24 14c3 3.6 4 5.7 4 7.7a4 4 0 0 1-8 0c0-2 1-4.1 4-7.7z" }, "a"], ["path", { d: "M20 35v4.5M28 35v4.5" }, "t"]],
  maquina_radiador: [["path", { d: "M12 13v21M18 13v21M24 13v21M30 13v21M36 13v21M10 17h28M10 30h28M13 34v4M35 34v4" }, "t"]],
  maquina_hidromassagem: [["path", { d: "M8 25h32v3a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z" }, "t"], ["circle", { cx: 17, cy: 18, r: 2.2 }, "t"], ["circle", { cx: 24.5, cy: 13, r: 2.6 }, "t"], ["circle", { cx: 31.5, cy: 18.5, r: 2 }, "t"], ["path", { d: "M15 36l-1.5 3M33 36l1.5 3" }, "t"]],
  maquina_air_fryer: [["rect", { x: 12, y: 9, width: 24, height: 30, rx: 8 }, "t"], ["path", { d: "M12 25h24M20 31h8" }, "t"], ["circle", { cx: 24, cy: 17, r: 3 }, "t"]],
  maquina_torradeira: [["rect", { x: 9, y: 19, width: 30, height: 18, rx: 6 }, "t"], ["path", { d: "M15 19v-6.5h7V19M26 19v-6.5h7V19" }, "t"], ["circle", { cx: 33, cy: 29, r: 1.6 }, "c"]],
  maquina_cafe_expresso: [["path", { d: "M14 23h17v6a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7z" }, "t"], ["path", { d: "M31 25.5c4.5 0 4.5 6 0 6M10 39.5h25M19 11c-1.6 2.2 1.6 4.3 0 6.5M26 11c-1.6 2.2 1.6 4.3 0 6.5" }, "t"]],
  maquina_campainha_video: [["rect", { x: 16, y: 7, width: 16, height: 34, rx: 5 }, "t"], ["circle", { cx: 24, cy: 15, r: 3 }, "t"], ["circle", { cx: 24, cy: 30, r: 4.5 }, "t"], ["circle", { cx: 24, cy: 30, r: 1.6 }, "c"]],
  maquina_carregador_bicicleta: [["circle", { cx: 13, cy: 31, r: 6 }, "t"], ["circle", { cx: 35, cy: 31, r: 6 }, "t"], ["path", { d: "M13 31l6-10h11l5 10M19 21l5 10h-11M28 17h4.5" }, "t"], ["path", { d: "M24 6l-4 6.5h3.5l-1.5 5 5.5-7h-3.5z" }, "c"]],
  maquina_toalheiro: [["path", { d: "M13 8v32M35 8v32M13 13h22M13 20h22M13 27h22M13 34h22" }, "t"], ["rect", { x: 19, y: 13, width: 10, height: 12, rx: 1.5 }, "c"]],
  maquina_carregador_baterias: [["rect", { x: 9, y: 15, width: 25, height: 18, rx: 2 }, "t"], ["path", { d: "M34 20.5v7M14 24h6M17 21v6M25 24h5" }, "t"]],
  // Divisões (botões do editor, desenharIcone(svg, "divisao", {tipo})): um desenho por tipo de divisão
  // (web/simulador/casa.js tipoDivisao); sem desenho próprio, o quadrado tracejado de "Outra".
  divisao_sala: [["path", { d: "M11 24v-6a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v6" }, "t"], ["path", { d: "M8 33v-8a3 3 0 0 1 6 0v3h20v-3a3 3 0 0 1 6 0v8zM12 33v3.5M36 33v3.5" }, "t"]],
  divisao_quarto: [["path", { d: "M8 12v25M8 24h32v13M8 31h32" }, "t"], ["rect", { x: 11.5, y: 18, width: 9, height: 6, rx: 2 }, "t"]],
  divisao_cozinha: [["rect", { x: 11, y: 14, width: 26, height: 24, rx: 2.5 }, "t"], ["rect", { x: 15, y: 24, width: 18, height: 10, rx: 1.5 }, "t"], ["path", { d: "M15 10h7M26 10h7" }, "t"], ["circle", { cx: 17, cy: 19, r: 1.4 }, "c"], ["circle", { cx: 24, cy: 19, r: 1.4 }, "c"], ["circle", { cx: 31, cy: 19, r: 1.4 }, "c"]],
  divisao_wc: [["path", { d: "M8 24h32v3a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z" }, "t"], ["path", { d: "M12 24V14.5a3.5 3.5 0 0 1 7 0M15 35l-1.5 3.5M33 35l1.5 3.5" }, "t"]],
  divisao_corredor: [["path", { d: "M8 9l12 11v8L8 39M40 9L28 20v8l12 11M20 20h8M20 28h8" }, "t"]],
  divisao_entrada: [["path", { d: "M16 34V10h16v24" }, "t"], ["rect", { x: 11, y: 34.5, width: 26, height: 4.5, rx: 1.5 }, "t"], ["circle", { cx: 28, cy: 23, r: 1.6 }, "c"]],
  divisao_escritorio: [["path", { d: "M7 27h34M10 27v11M38 27v11M28 27v6h10" }, "t"], ["rect", { x: 13, y: 11, width: 15, height: 11, rx: 1.5 }, "t"], ["path", { d: "M20.5 22v5" }, "t"]],
  divisao_lavandaria: [["path", { d: "M10 20h28l-3.5 17h-21z" }, "t"], ["path", { d: "M16 20c0-6 16-6 16 0M19 25v7M24 25v7M29 25v7" }, "t"]],
  divisao_despensa: [["rect", { x: 10, y: 8, width: 28, height: 32, rx: 2 }, "t"], ["path", { d: "M10 18.5h28M10 29h28" }, "t"], ["rect", { x: 14, y: 12, width: 5, height: 6.5, rx: 1 }, "t"], ["rect", { x: 22, y: 21.5, width: 9, height: 7.5, rx: 1 }, "t"], ["circle", { cx: 17, cy: 35, r: 3 }, "t"]],
  divisao_garagem: [["path", { d: "M8 32v-6l5-8h22l5 8v6zM15 25l2.5-4h13l2.5 4" }, "t"], ["circle", { cx: 15, cy: 33, r: 3 }, "t"], ["circle", { cx: 33, cy: 33, r: 3 }, "t"]],
  divisao_varanda: [["path", { d: "M8 16h32M8 37h32M12 16v21M18 16v21M24 16v21M30 16v21M36 16v21" }, "t"]],
  divisao_jardim: [["circle", { cx: 24, cy: 19, r: 10 }, "t"], ["path", { d: "M24 29v9M17 38h14" }, "t"]],
  divisao_escadas: [["path", { d: "M9 38h7v-7h7v-7h7v-7h7v-7h2" }, "t"]],
  divisao_sala_cozinha: [["path", { d: "M8 24v-4a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v4M6 32v-6a2.5 2.5 0 0 1 5 0v2h10v-2a2.5 2.5 0 0 1 5 0v6zM28 38V20h14v18M28 26h14" }, "t"], ["circle", { cx: 32, cy: 23, r: 1.2 }, "c"], ["circle", { cx: 38, cy: 23, r: 1.2 }, "c"]],
  divisao_loja: [["path", { d: "M8 11h32l2 8H6zM6 19c0 3 5.3 3 5.3 0 0 3 5.3 3 5.3 0 0 3 5.3 3 5.3 0 0 3 5.3 3 5.3 0 0 3 5.3 3 5.3 0 0 3 5.3 3 5.3 0M10 22v16h28V22M20 38V29h8v9" }, "t"]],
  divisao_rececao: [["path", { d: "M7 29h34v9H7z" }, "t"], ["path", { d: "M17 25a7 7 0 0 1 14 0zM24 15v3M14 25h20" }, "t"]],
  divisao_montra: [["rect", { x: 8, y: 10, width: 32, height: 24, rx: 2 }, "t"], ["path", { d: "M8 16h32M6 38h36" }, "t"], ["circle", { cx: 17, cy: 26, r: 3.5 }, "t"], ["rect", { x: 26, y: 21, width: 7, height: 9, rx: 1 }, "t"]],
  divisao_nave: [["path", { d: "M8 38V22l8-6v6l8-6v6l8-6v22M32 16V9h5v29M5 38h38M13 38v-8h6v8" }, "t"]],
  divisao_armazem: [["rect", { x: 9, y: 25, width: 14, height: 13, rx: 1 }, "t"], ["rect", { x: 25, y: 25, width: 14, height: 13, rx: 1 }, "t"], ["rect", { x: 17, y: 11, width: 14, height: 13, rx: 1 }, "t"], ["path", { d: "M16 25v4M32 25v4M24 11v4" }, "t"]],
  divisao_cais: [["path", { d: "M5 15h23v18H5zM28 22h8l6 6v5H28" }, "t"], ["circle", { cx: 12, cy: 35, r: 3 }, "t"], ["circle", { cx: 35, cy: 35, r: 3 }, "t"]],
  divisao_outra: [["rect", { x: 9, y: 11, width: 30, height: 26, rx: 3, "stroke-dasharray": "5 3" }, "t"]],
};
const ICONE_RAIO = [["path", { d: "M26 13 18 26h6l-2 9 8-13h-6z" }, "c"]];

// Ação por aparelho (lote 7; web/simulador/acoes.js): a letra do selo e o nome. Porta e quadro não têm ação; a janela
// só com estore.
const ACOES = { manter: ["M", "Manter"], reparar: ["R", "Reparar"], substituir: ["S", "Substituir"], novo: ["N", "Novo"] };
const comAcao = (e) => ["luz", "interruptor", "tomada", "sensor_movimento", "sensor_porta", "maquina"].includes(e.tipo) || (e.tipo === "janela" && !!e.props?.estore);
/** Legenda dos selos (menu "⋯", impressão e relatório): "Marcas: R Reparar · S Substituir · N Novo · M Manter; sem marca: Novo". */
export function legendaAcoes(omissao, todas = false, nomes = null) {
  // Lote 8: `nomes` = os nomes que o cliente vê (simulador: "Trocar", "Avariado (reparar)"…); sem eles, os técnicos.
  if (todas) return `Marcas: ${Object.entries(ACOES).map(([k, [l, n]]) => `${l} ${nomes?.[k] ?? n}`).join(" · ")}.`;
  const outras = Object.entries(ACOES).filter(([k]) => k !== omissao).map(([, [l, n]]) => `${l} ${n}`);
  return `Marcas: ${outras.join(" · ")}; sem marca: ${ACOES[omissao]?.[1] ?? "Novo"}.`;
}

let contador = 0;

function no(tag, atrs, estilo) {
  const e = document.createElementNS(NS, tag);
  if (atrs) for (const [k, v] of Object.entries(atrs)) e.setAttribute(k, String(v));
  if (estilo) for (const [k, v] of Object.entries(estilo)) e.style.setProperty(k, v);
  return e;
}

const numero = (v, omissao = 0) => (Number.isFinite(Number(v)) ? Number(v) : omissao);

// Forma das divisões (a mesma regra de web/simulador/regras.js; este módulo não tem dependências).
const MAX_CANTOS = 24;
/** Cantos da divisão: `pontos` válidos (3–24 pares de números) ou os 4 cantos do retângulo. */
function cantos(d) {
  const p = d?.pontos;
  if (Array.isArray(p) && p.length >= 3 && p.length <= MAX_CANTOS && p.every((q) => Array.isArray(q) && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1])))) {
    return p.map((q) => [Number(q[0]), Number(q[1])]);
  }
  const x = numero(d?.x_cm), y = numero(d?.y_cm), w = Math.max(1, numero(d?.largura_cm)), h = Math.max(1, numero(d?.altura_cm));
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  return s / 2;
}
/** 4 cantos com paredes só horizontais/verticais. */
function retangular(pts) {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const h1 = a[1] === b[1] && a[0] !== b[0], v1 = a[0] === b[0] && a[1] !== b[1];
    const h2 = b[1] === c[1] && b[0] !== c[0], v2 = b[0] === c[0] && b[1] !== c[1];
    if (!((h1 && v2) || (v1 && h2))) return false;
  }
  return true;
}
function dentro(x, y, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}
/** Ponto para o nome: o centróide, ou (forma em L/U) o meio da faixa horizontal mais larga. */
function interior(pts) {
  const a = area(pts);
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (a && dentro(cx / (6 * a), cy / (6 * a), pts)) return [cx / (6 * a), cy / (6 * a)];
  const ys = pts.map((p) => p[1]), y0 = Math.min(...ys), h = Math.max(...ys) - y0;
  let melhor = [pts[0][0], pts[0][1]], larg = -1;
  for (const f of [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]) {
    const y = y0 + h * f;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > larg) { larg = xs[i + 1] - xs[i]; melhor = [(xs[i] + xs[i + 1]) / 2, y]; }
  }
  return melhor;
}

/** Piso de uma divisão ou elemento (0 = r/c; sem `piso` = 0). */
export function pisoDe(x) {
  const n = Math.round(Number(x?.piso));
  return Number.isFinite(n) && n > 0 ? Math.min(3, n) : 0;
}
/** "Piso 0 (r/c)", "Piso 1"… */
export const nomePiso = (p) => (p > 0 ? `Piso ${p}` : "Piso 0 (r/c)");
/** Pisos com divisões ou elementos, por ordem ([0] numa planta sem pisos). */
export function pisosDaPlanta(planta) {
  const s = new Set([0]);
  for (const x of [...(Array.isArray(planta?.divisoes) ? planta.divisoes : []), ...(Array.isArray(planta?.elementos) ? planta.elementos : [])]) s.add(pisoDe(x));
  return [...s].sort((a, b) => a - b);
}

function descrever(e, nomesDivisao) {
  const p = e.props || {};
  let t = NOMES[e.tipo] || "Elemento";
  if (e.tipo === "porta" && p.entrada) t = "Porta da rua";
  if (e.tipo === "janela" && p.estore) t = p.motorizado ? "Janela com estore motorizado" : "Janela com estore";
  if (e.tipo === "tomada" && p.dupla) t = "Tomada dupla";
  if (e.tipo === "luz" && p.brilho) t = "Ponto de luz regulável";
  if (e.tipo === "interruptor") t = `Interruptor de ${Math.min(4, Math.max(1, Math.round(numero(p.botoes, 1))))} ${numero(p.botoes, 1) > 1 ? "botões" : "botão"}`;
  if (e.tipo === "maquina") t = `${MODELOS[p.modelo] || MODELOS.outro} (${Math.round(numero(p.potencia_w))} W)`;
  // Nome dado pelo cliente (opcional): "Interruptor da entrada — Interruptor de 1 botão".
  if (typeof e.nome === "string" && e.nome.trim()) t = `${e.nome.trim()} — ${t}`;
  if (Number.isFinite(Number(e.altura_cm)) && e.altura_cm !== null && e.altura_cm !== "") t += `, a ${fmtM(Number(e.altura_cm))} m do chão`;
  const d = e.divisao && nomesDivisao.get(e.divisao);
  return d ? `${t} — ${d}` : t;
}

function icone(e) {
  const p = e.props || {};
  if (e.tipo === "janela" && p.estore) return ICONES.janela_estore;
  if (e.tipo === "tomada" && p.dupla) return ICONES.tomada_dupla;
  if (e.tipo === "maquina" && ICONES[`maquina_${p.modelo}`]) return ICONES[`maquina_${p.modelo}`];
  if (e.tipo === "divisao") return ICONES[`divisao_${p.tipo}`] || ICONES.divisao_outra;
  return ICONES[e.tipo] || ICONES.maquina;
}

/**
 * Desenha a planta no <svg> dado (substitui o conteúdo).
 * @param {SVGSVGElement} svg
 * @param {object} planta formato do §2.1
 * @param {object} [opcoes]
 */
export function desenharPlanta(svg, planta, opcoes = {}) {
  const { soLeitura = false, selecionado = null, grelha = true } = opcoes;
  const omissaoAcao = opcoes.acoes && ACOES[opcoes.acoes.omissao] ? opcoes.acoes.omissao : null;
  const todasAcoes = !!omissaoAcao && opcoes.acoes.todas === true;
  const soEscolhidas = todasAcoes && opcoes.acoes.escolher === true;
  const L = Math.max(1, numero(planta?.largura_cm, 2000));
  const A = Math.max(1, numero(planta?.altura_cm, 1500));
  const esc = Math.max(1, numero(planta?.escala_cm, 50));
  const raio = numero(opcoes.raio, Math.min(60, Math.max(18, Math.max(L, A) / 60)));
  const raioToque = Math.max(raio, numero(opcoes.raioToque, raio));
  const letra = numero(opcoes.letra, Math.max(24, raio * 0.9));
  const pega = numero(opcoes.pega, raio);
  const v = opcoes.vista || { x: 0, y: 0, w: L, h: A };
  const soPiso = Number.isInteger(opcoes.piso) ? (x) => pisoDe(x) === opcoes.piso : () => true;
  const divisoes = (Array.isArray(planta?.divisoes) ? planta.divisoes : []).filter(soPiso);
  const elementos = (Array.isArray(planta?.elementos) ? planta.elementos : []).filter(soPiso);
  const nomesDivisao = new Map(divisoes.map((d) => [d.id, String(d.nome ?? "")]));
  const uid = `planta-${++contador}`;
  // Seleção (editor): o resto fica esbatido; os aparelhos da divisão selecionada continuam nítidos.
  const selDiv = !soLeitura && selecionado != null ? divisoes.find((d) => d.id === selecionado) ?? null : null;
  const selEl = !soLeitura && selecionado != null ? elementos.find((e) => e.id === selecionado) ?? null : null;
  const haSel = !!(selDiv || selEl);
  const ESBATIDO = "0.35";
  // O halo é redesenhado a cada mudança: o atraso negativo mantém o pulsar no mesmo ponto do ciclo (2 s).
  const faseHalo = `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % 2000)}ms`;
  const halo = { fill: "none", stroke: COR.argila, opacity: "0.35", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none", "animation-delay": faseHalo };

  svg.replaceChildren();
  svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (soLeitura) {
    svg.setAttribute("role", "img");
    const t = no("title");
    t.textContent = `Planta: ${divisoes.length} ${divisoes.length === 1 ? "divisão" : "divisões"} e ${elementos.length} ${elementos.length === 1 ? "elemento" : "elementos"}`;
    svg.append(t);
  }

  // Papel da planta (área útil) e fundo opcional.
  svg.append(no("rect", { x: 0, y: 0, width: L, height: A, "data-papel": "1" }, { fill: COR.fundo, stroke: COR.borda, "stroke-width": "1px", "vector-effect": "non-scaling-stroke" }));
  const f = planta?.fundo;
  if (f && typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem)) {
    const lf = Math.max(1, numero(f.largura_cm, L));
    const img = no("image", {
      x: numero(f.x_cm), y: numero(f.y_cm), width: lf, height: lf * 20, preserveAspectRatio: "xMinYMin meet", "data-fundo": "1",
    }, { opacity: String(Math.min(1, Math.max(0, numero(f.opacidade, 0.5)))), "pointer-events": "none" });
    img.setAttribute("href", f.imagem);
    const clip = no("clipPath", { id: `${uid}-recorte` });
    clip.append(no("rect", { x: 0, y: 0, width: L, height: A }));
    const defs = no("defs");
    defs.append(clip);
    svg.append(defs);
    img.setAttribute("clip-path", `url(#${uid}-recorte)`);
    svg.append(img);
  }

  // Quadriculado de 50 cm (um só <path>); cada metro um pouco mais marcado. Sem grelha se
  // uma planta fora dos limites de §2.1 pedisse milhares de linhas (bloquearia o navegador).
  if (grelha && L / esc + A / esc <= 2000) {
    let d = "";
    let dm = "";
    for (let x = esc; x < L; x += esc) (x % 100 === 0 ? (dm += `M${x} 0V${A}`) : (d += `M${x} 0V${A}`));
    for (let y = esc; y < A; y += esc) (y % 100 === 0 ? (dm += `M0 ${y}H${L}`) : (d += `M0 ${y}H${L}`));
    const g = no("g", { "aria-hidden": "true" }, { "pointer-events": "none" });
    if (d) g.append(no("path", { d }, { fill: "none", stroke: COR.borda, "stroke-width": "0.75px", "vector-effect": "non-scaling-stroke", opacity: "0.8" }));
    if (dm) g.append(no("path", { d: dm }, { fill: "none", stroke: COR.borda, "stroke-width": "1.25px", "vector-effect": "non-scaling-stroke" }));
    svg.append(g);
  }

  // Divisões: polígonos (um retângulo são 4 cantos). Retângulo: nome no canto e L × A; forma livre:
  // nome e área num ponto de dentro. Os nomes vão numa camada por cima dos elementos (os ícones não os
  // tapam), com contorno da cor do papel, e encolhem para caber na largura da divisão (não invadem a vizinha).
  const gd = no("g", { "data-camada": "divisoes" });
  const gn = no("g", { "data-camada": "nomes", "aria-hidden": "true" }, { "pointer-events": "none" });
  // Divisões sobrepostas: a de cima é a desenhada depois; a selecionada vai sempre por cima (e é a que o toque
  // apanha). Os contornos de todas vão numa camada à parte, por cima dos fundos: a de baixo continua a ver-se.
  const ordem = selDiv ? [...divisoes.filter((d) => d !== selDiv), selDiv] : divisoes;
  const gc = no("g", { "data-camada": "contornos", "aria-hidden": "true" }, { "pointer-events": "none" });
  for (const d of ordem) {
    const pts = cantos(d);
    const ret = retangular(pts);
    const m2 = fmtM2(Math.abs(area(pts)));
    const x = Math.min(...pts.map((p) => p[0])), y = Math.min(...pts.map((p) => p[1]));
    const w = Math.max(...pts.map((p) => p[0])) - x, h = Math.max(...pts.map((p) => p[1])) - y;
    const sel = !soLeitura && selecionado === d.id;
    const g = no("g", { "data-divisao": d.id }, haSel && !sel ? { opacity: ESBATIDO } : null);
    const t = no("title");
    t.textContent = ret ? `${d.nome || "Divisão"} (${fmtM(w)} × ${fmtM(h)} m, ${m2} m²)` : `${d.nome || "Divisão"} (${m2} m², ${pts.length} cantos)`;
    g.append(t);
    g.append(no("polygon", { points: pts.map((p) => `${p[0]},${p[1]}`).join(" ") }, {
      fill: sel ? COR.musgoClaro : `color-mix(in srgb, ${COR.musgoClaro} 55%, transparent)`,
      stroke: COR.musgo, "stroke-width": "2px", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke",
    }));
    gc.append(no("polygon", { points: pts.map((p) => `${p[0]},${p[1]}`).join(" ") }, {
      fill: "none", stroke: COR.musgo, "stroke-width": "1.5px", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke",
      ...(haSel && !sel ? { opacity: ESBATIDO } : {}),
    }));
    const [ix, iy] = ret ? [x + letra * 0.4, y] : interior(pts);
    // Largura para o texto: a da divisão menos uma margem (retângulo); numa forma livre, 80 % da caixa.
    const largura = Math.max(letra, ret ? w - letra * 0.8 : w * 0.8);
    // Divisão baixa: o nome encolhe para caber na altura; a medida só aparece se couber por baixo dele.
    const tamNome = Math.min(letra, h / 1.35);
    const nome = texto(String(d.nome ?? ""), tamNome, largura, 0.6, { fill: COR.texto, "font-weight": "700", ...(haSel && !sel ? { opacity: ESBATIDO } : {}) },
      ret ? { x: ix, y: iy + tamNome * 1.15 } : { x: ix, y: iy - letra * 0.1, "text-anchor": "middle" });
    gn.append(nome);
    if (ret ? h >= letra * 2.5 : true) {
      const medida = texto(ret ? `${fmtM(w)} × ${fmtM(h)} m · ${m2} m²` : `${m2} m²`, letra * 0.72, largura, 0.55, { fill: COR.suave, ...(haSel && !sel ? { opacity: ESBATIDO } : {}) },
        ret ? { x: ix, y: iy + letra * 2.2 } : { x: ix, y: iy + letra * 0.85, "text-anchor": "middle" });
      gn.append(medida);
    }
    gd.append(g);
  }
  svg.append(gd, gc);
  // Divisão selecionada: halo largo que pulsa e, por cima, o anel grosso cheio (por cima das outras divisões,
  // por baixo dos aparelhos).
  if (selDiv) {
    const pts = cantos(selDiv).map((p) => `${p[0]},${p[1]}`).join(" ");
    const gs = no("g", { "data-camada": "selecao", "aria-hidden": "true" }, { "pointer-events": "none" });
    gs.append(no("polygon", { points: pts, class: "selecao-halo" }, { ...halo, "stroke-width": "16px" }));
    gs.append(no("polygon", { points: pts }, { fill: "none", stroke: COR.argila, "stroke-width": "5px", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    svg.append(gs);
  }

  // Elementos: ícone num disco, rodado quando faz sentido.
  const ge = no("g", { "data-camada": "elementos" });
  for (const e of elementos) {
    const x = numero(e.x_cm), y = numero(e.y_cm);
    const rot = [0, 90, 180, 270].includes(e.rot) ? e.rot : 0;
    const sel = !soLeitura && selecionado === e.id;
    const nitido = !haSel || sel || (selDiv && e.divisao === selDiv.id);
    const g = no("g", { "data-elemento": e.id, "data-tipo": String(e.tipo), transform: `translate(${x} ${y})` }, nitido ? null : { opacity: ESBATIDO });
    const t = no("title");
    const acao = omissaoAcao && comAcao(e) ? (ACOES[e.acao] ? e.acao : soEscolhidas ? null : omissaoAcao) : null;
    t.textContent = `${descrever(e, nomesDivisao)}${acao ? ` — ${ACOES[acao][1]}` : ""}`;
    g.append(t);
    if (!soLeitura && raioToque > raio) g.append(no("circle", { r: raioToque, cx: 0, cy: 0 }, { fill: "transparent" }));
    if (sel) {
      g.append(no("circle", { r: raio * 1.45, cx: 0, cy: 0, class: "selecao-halo" }, { ...halo, "stroke-width": "14px" }));
      g.append(no("circle", { r: raio * 1.22, cx: 0, cy: 0 }, { fill: "none", stroke: COR.argila, "stroke-width": "5px", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }));
    }
    const destaque = (e.tipo === "porta" && e.props?.entrada) || e.tipo === "maquina";
    g.append(no("circle", { r: raio, cx: 0, cy: 0 }, {
      fill: destaque ? `color-mix(in srgb, ${COR.areia} 30%, ${COR.fundo})` : COR.fundo,
      stroke: e.tipo === "porta" && e.props?.entrada ? COR.argila : COR.musgo, "stroke-width": "2px", "vector-effect": "non-scaling-stroke",
    }));
    const s = (raio * 1.5) / 48;
    const gi = no("g", { transform: `rotate(${rot}) scale(${s}) translate(-24 -24)` }, { "pointer-events": "none" });
    const partes = e.tipo === "maquina" && numero(e.props?.potencia_w) >= 2000 ? [...icone(e), ...ICONE_RAIO.map(([tg, a]) => [tg, { ...a, transform: "translate(12 -8) scale(.5)" }, "a"])] : icone(e);
    for (const [tag, a, papel] of partes) {
      gi.append(no(tag, a, papel === "t"
        ? { fill: "none", stroke: COR.texto, "stroke-width": "1.6px", "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }
        : { fill: papel === "a" ? COR.argila : COR.areia, stroke: "none" }));
    }
    // Sentido (porta: para onde abre; janela/tomada/interruptor: a parede) — um traço na borda.
    if (e.tipo === "porta" || e.tipo === "janela" || e.tipo === "tomada" || e.tipo === "interruptor") {
      g.append(no("path", { d: `M${-raio * 0.7} ${-raio}H${raio * 0.7}`, transform: `rotate(${rot})` }, {
        fill: "none", stroke: COR.argila, "stroke-width": "4px", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none",
      }));
    }
    g.append(gi);
    // Selo da ação (só as que não são a do serviço): disco pequeno com a letra, por cima à direita.
    if (acao && (todasAcoes || acao !== omissaoAcao)) {
      const r = raio * 0.52, cx = raio * 0.78, cy = -raio * 0.78;
      const cor = acao === "reparar" ? COR.argila : acao === "manter" ? COR.suave : COR.musgo;
      const gs = no("g", { "data-acao": acao, "aria-hidden": "true" }, { "pointer-events": "none" });
      gs.append(no("circle", { r, cx, cy }, { fill: cor, stroke: COR.fundo, "stroke-width": "1.5px", "vector-effect": "non-scaling-stroke" }));
      const l = no("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": r * 1.25 }, { fill: COR.fundo, "font-weight": "800", "font-family": "system-ui, sans-serif" });
      l.textContent = ACOES[acao][0];
      gs.append(l);
      g.append(gs);
    }
    ge.append(g);
  }
  svg.append(ge, gn);

  // Pegas dos cantos da divisão selecionada (editor): data-pega = n.º do canto (0, 1, …).
  if (!soLeitura && selecionado && opcoes.pegas !== false) {
    const d = divisoes.find((x) => x.id === selecionado);
    if (d) {
      const gp = no("g", { "data-camada": "pegas" });
      cantos(d).forEach(([cx, cy], i) => {
        // Zona de toque grande (transparente) e, por cima, uma pega visível mais pequena
        // (não tapa o nome da divisão).
        const v = pega * 0.5;
        gp.append(no("rect", { x: cx - pega / 2, y: cy - pega / 2, width: pega, height: pega, "data-pega": String(i), "data-id": d.id }, {
          fill: "transparent", cursor: "move",
        }));
        gp.append(no("rect", { x: cx - v / 2, y: cy - v / 2, width: v, height: v, rx: v / 4 }, {
          fill: COR.fundo, stroke: COR.argila, "stroke-width": "3px", "vector-effect": "non-scaling-stroke", "pointer-events": "none",
        }));
      });
      svg.append(gp);
    }
  }
  return svg;
}

/**
 * Só o ícone de um tipo de elemento, num <svg> com viewBox 0 0 48 48 (paleta,
 * listas, legendas). Usa as mesmas cores do desenho da planta. `tipo` "divisao" com `props.tipo` (sala,
 * quarto, cozinha…; casa.js tipoDivisao): o desenho dessa divisão (botões do editor).
 */
export function desenharIcone(svg, tipo, props = {}) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, a, papel] of icone({ tipo, props })) {
    svg.append(no(tag, a, papel === "t"
      ? { fill: "none", stroke: "currentColor", "stroke-width": "2.4px", "stroke-linecap": "round", "stroke-linejoin": "round" }
      : { fill: papel === "a" ? COR.argila : COR.areia, stroke: "none" }));
  }
  return svg;
}

/**
 * Texto de uma divisão que cabe em `largura` (cm): encolhe a letra até 60 % e, se ainda não couber, aperta-o
 * (textLength). A largura é estimada (`media`: largura média de uma letra em relação ao tamanho) — o SVG pode
 * ainda não estar na página (visualizador do painel), por isso não se mede. Contorno da cor do papel por trás.
 */
function texto(t, tamanho, largura, media, estilo, atrs) {
  let tam = tamanho;
  const estimada = (s) => t.length * media * s;
  if (estimada(tam) > largura) tam = Math.max(tamanho * 0.6, (tam * largura) / estimada(tam));
  const n = no("text", atrs, {
    ...estilo, "font-size": `${tam}px`, "font-family": "var(--letra, system-ui, sans-serif)",
    stroke: COR.fundo, "stroke-width": `${tam * 0.22}px`, "stroke-linejoin": "round", "paint-order": "stroke",
  });
  if (estimada(tam) > largura) { n.setAttribute("textLength", String(Math.round(largura))); n.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
  n.textContent = t;
  return n;
}

function fmtM(cm) {
  return (Math.round(cm) / 100).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
}

/** Área em m² (de cm²), com uma casa decimal no máximo. */
function fmtM2(cm2) {
  return (Math.round(cm2 / 1000) / 10).toLocaleString("pt-PT", { maximumFractionDigits: 1 });
}

export default desenharPlanta;
