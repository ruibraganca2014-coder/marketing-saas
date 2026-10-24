// Árvores de diagnóstico — proteções (fusíveis, seletividade, AFDD, mínima tensão) e terra, casas de banho, DST e
// ligações equipotenciais (ronda 2; manual de instalações BT, caps. 10 e 11). Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, dado, fim, SEM_TENSAO } from "./construir.js";
import { REF, SELETIVIDADE, MINIMA_TENSAO, DST_LIGACOES, DST_UC, CONTINUIDADE_PE } from "./limites.js";

const P = "Proteções que disparam";
const T = "Terra e isolamento";

export const FUSIVEL = arvore("fusivel", P, "Fusível que funde", "Um fusível funde (quadro de colunas, alimentação de um quadro, motor, sinalização).", "classe", {
  classe: esc("Que fusível é?", REF.m10_2, [
    ["gG (uso geral: cabos, portinholas, quadros de colunas)", "quando"],
    ["aM (só curto-circuito: motores, com relé térmico)", "am_termico"],
    ["gPV (corrente contínua: strings fotovoltaicas)", "fim_seguir_fv"],
  ], { fazer: "Veja a marcação no corpo do fusível. Nunca substitua por um de calibre maior ou de outra classe." }),
  quando: sn("Fundiu de imediato ao ligar (e não ao fim de algum tempo com carga)?", [REF.m10_1, REF.m10_2], "iso", "fim_sobrecarga"),
  iso: val("Isolamento do troço protegido (entre condutores e à terra)", [REF.m16_2, REF.m20_2], "MΩ", { min: 0.5, aviso: 1, fonte: "Manual 16.2: ≥ 0,5 MΩ a 500 V CC (objetivo Domus ≥ 1 MΩ, anexo A)" }, "fim_fusivel_errado", "fim_curto", { fazer: `${SEM_TENSAO} Sem cargas, megaohmímetro a 500 V CC.`, aviso: "fim_fusivel_errado", ficha: { verificacao: "isolamento", valor: "isolamento" } }),
  am_termico: sn("O motor tem relé térmico a acompanhar o fusível aM (o aM não protege contra sobrecarga)?", [REF.m10_2, REF.m17_1], "fim_seguir_motor", "fim_sem_termico"),
  fim_seguir_fv: fim("outro", REF.m10_2, "Fusível gPV de uma string fotovoltaica.", "Continuar com a árvore do lado CC do fotovoltaico (abrir primeiro o seccionador CC).", { seguir: "fotovoltaico-cc" }),
  fim_sobrecarga: fim("sobrecarga", [REF.m10_1, REF.m10_2], "Sobrecarga no troço protegido pelo fusível.", "Medir a corrente com a pinça e repartir as cargas; substituir o fusível pelo mesmo calibre e classe."),
  fim_curto: fim("curto", REF.m10_2, "Curto-circuito ou defeito de isolamento no troço protegido.", "Localizar e reparar antes de substituir o fusível (mesmo calibre e classe); nunca «reforçar» o fusível.", { seguir: "isolamento" }),
  fim_fusivel_errado: fim("outro", REF.m10_2, "Troço sem defeito: fusível de calibre ou classe errados, ou base fusível com mau contacto.", "Confirmar o calibre e a classe do projeto, reapertar ou substituir a base e pôr o fusível certo."),
  fim_sem_termico: fim("sobrecarga", [REF.m10_2, REF.m17_1], "Fusível aM sem relé térmico: o motor não está protegido contra sobrecarga.", "Instalar relé térmico (ou disjuntor-motor) regulado para a corrente da chapa."),
  fim_seguir_motor: fim("sobrecarga", REF.m17_1, "Fusível aM com relé térmico: funde por curto-circuito ou arranque difícil do motor.", "Continuar com a árvore «Aparelho ou motor não arranca».", { seguir: "motor" }),
}, { palavras: "fusível gG aM gPV funde" });

export const SELETIVIDADE_ARV = arvore("seletividade", P, "Dispara a proteção de montante em vez da do circuito", "Um defeito num circuito faz disparar o geral ou o quadro inteiro (falta de seletividade).", "tipo", {
  tipo: esc("Que proteções disparam juntas?", REF.m10_6a, [
    ["Dois disjuntores (ou fusíveis) em série", "montante"],
    ["Dois diferenciais em série (ex.: geral de 300 mA e 30 mA nos circuitos)", "dif_s"],
    ["O geral do quadro e o DCP do operador", "fim_dcp"],
  ]),
  montante: dado("Calibre da proteção a montante", REF.m10_6a, "A", "Imont", "jusante", { casas: 0, max: 5000 }),
  jusante: dado("Calibre da proteção a jusante (a do circuito)", REF.m10_6a, "A", "Ijus", "razao", { casas: 0, max: 5000 }),
  razao: val("Razão entre os calibres (montante ÷ jusante)", REF.m10_6a, "un.", { ...SELETIVIDADE }, "tabelas", "fim_razao", { casas: 2, max: 1000, fazer: "Divida o calibre de montante pelo de jusante (ex.: 32 A ÷ 16 A = 2)." }),
  tabelas: sn("Com curto-circuito franco, as tabelas do fabricante garantem seletividade entre estes dois aparelhos?", REF.m10_6a, "fim_ok", "fim_tabelas"),
  dif_s: sn("O diferencial de montante é do tipo S (seletivo, com atraso) e com IΔn pelo menos 3 vezes a de jusante?", [REF.m11_3b, REF.m10_6a], "fim_ok_dif", "fim_dif_s"),
  fim_dcp: fim("outro", REF.m10_6, "O geral do quadro é um disjuntor de calibre igual ou superior ao DCP, que dispara primeiro.", "No quadro de entrada, preferir um interruptor geral (sem disparo) ou um calibre abaixo do DCP; explicar ao cliente."),
  fim_razao: fim("outro", REF.m10_6a, "Calibres mal escalonados: sem seletividade amperimétrica.", "Escalonar as proteções (razão ≥ 2; fusíveis gG ≥ 1,6) ou usar combinações garantidas nas tabelas do fabricante."),
  fim_tabelas: fim("outro", REF.m10_6a, "Seletividade não garantida para correntes de curto-circuito elevadas.", "Escolher aparelhos com seletividade garantida nas tabelas do fabricante (ou cronométrica, com atraso a montante)."),
  fim_ok: fim("outro", REF.m10_6a, "A seletividade está garantida: o disparo de montante tem outra causa.", "Procurar um defeito no troço entre as duas proteções (barramento, pente, alimentador)."),
  fim_dif_s: fim("terra", [REF.m11_3b, REF.m10_6a], "Diferenciais em série sem seletividade (o de montante não é tipo S ou a razão de IΔn é menor que 3).", "Usar a montante um diferencial tipo S com IΔn ≥ 3 × a de jusante (ex.: 300 mA S sobre 30 mA)."),
  fim_ok_dif: fim("terra", REF.m11_3b, "Diferenciais com seletividade: o de montante dispara por uma fuga fora dos de jusante.", "Procurar a fuga no troço protegido só pelo de montante.", { seguir: "diferencial" }),
}, { palavras: "seletividade geral dispara montante jusante tipo S" });

export const AFDD = arvore("afdd", P, "Detetor de arco (AFDD) dispara", "O detetor de defeitos de arco abre o circuito (ou o cliente pergunta se precisa de um).", "dispara", {
  dispara: sn("O AFDD dispara (o circuito tem detetor de arco)?", REF.m10_7b, "aperto", "propor", { fazer: "O AFDD vê arcos em série (mau aperto, cabo esmagado) que o disjuntor e o diferencial não veem." }),
  aperto: sn("Nas ligações do circuito (quadro, caixas, tomadas, fichas) há algum borne solto, condutor escurecido ou cabo esmagado?", [REF.m10_7b, REF.b53], "fim_arco", "aparelho", { fazer: SEM_TENSAO, ficha: { verificacao: "visual" } }),
  aparelho: sn("Dispara só com um aparelho ligado (motor com escovas, aparelho com ficha gasta)?", REF.m10_7b, "fim_aparelho", "fim_sem_causa"),
  propor: sn("O circuito alimenta quartos de dormir, edifício de madeira ou locais com materiais combustíveis?", REF.m10_7b, "fim_propor", "fim_nao_obrigatorio"),
  fim_arco: fim("outro", REF.m10_7b, "Arco em série numa ligação solta ou cabo danificado: risco de incêndio.", "Refazer a ligação ou substituir o troço; voltar a ligar e confirmar que o AFDD já não dispara."),
  fim_aparelho: fim("outro", REF.m10_7b, "O aparelho produz arcos (escovas, ficha ou cabo gasto).", "Mandar reparar ou substituir o aparelho; não retirar o AFDD."),
  fim_sem_causa: fim("outro", REF.m10_7b, "Disparo do AFDD sem causa encontrada.", "Registar quando dispara, testar o AFDD pelo botão e, se se repetir, substituí-lo pelo modelo indicado pelo fabricante do disjuntor."),
  fim_propor: fim("outro", REF.m10_7b, "Local onde a IEC 60364 atual recomenda AFDD.", "Propor AFDD (EN 62606) associado ao disjuntor do circuito (1–2 módulos). As RTIEBT de 2006 não o exigem."),
  fim_nao_obrigatorio: fim("outro", REF.m10_7b, "AFDD não exigido nem recomendado para este circuito.", "Nada a fazer; registar."),
}, { palavras: "AFDD arco incêndio EN 62606" });

export const MINIMA = arvore("minima-tensao", P, "Máquina não rearranca depois de falhar a tensão", "Relé ou bobina de mínima tensão dispara, ou uma máquina arranca sozinha quando a tensão volta.", "sozinha", {
  sozinha: sn("A máquina arranca sozinha quando a tensão volta (serra, tapete, bomba)?", REF.m10_7, "fim_sem_minima", "tensao", { fazer: "É perigoso: o arranque tem de exigir uma ação de quem opera." }),
  tensao: val("Tensão de alimentação da máquina em % da nominal (no momento em que tenta arrancar)", REF.m10_7, "%", { ...MINIMA_TENSAO }, "autorretencao", "fim_tensao_baixa", { casas: 0, max: 200, tensao: true, fazer: "Meça a tensão aos bornes e divida pela nominal (230 V ou 400 V) × 100." }),
  autorretencao: sn("O comando é por contactor com autorretenção (botão de arranque NA e paragem NF) e a bobina de mínima tensão está bem ligada?", [REF.m10_7, REF.m17_2], "fim_temporizacao", "fim_comando", { fazer: `${SEM_TENSAO} Verifique a continuidade do circuito de comando.` }),
  fim_sem_minima: fim("outro", REF.m10_7, "Máquina sem proteção contra abaixamentos e faltas de tensão.", "Instalar relé ou bobina de mínima tensão que dispare o disjuntor, ou comando por contactor em autorretenção (cap. 17)."),
  fim_tensao_baixa: fim("outro", [REF.m10_7, REF.m6_1], "Tensão abaixo de 85 % da nominal: a proteção impede, bem, o arranque.", "Encontrar a causa da tensão baixa (queda no cabo, rede); não desligar a proteção.", { seguir: "queda-tensao" }),
  fim_comando: fim("aberto", REF.m17_2, "Circuito de comando ou bobina de mínima tensão com defeito.", "Reparar o circuito de comando (contactos NA/NF, bobina) e ensaiar: paragem, falta de tensão e rearranque manual."),
  fim_temporizacao: fim("outro", REF.m10_7, "Proteção a atuar em quedas breves de tensão.", "Se as quedas breves não prejudicam o equipamento, usar uma proteção temporizada (o manual admite-o)."),
}, { palavras: "mínima tensão abaixamento falta de tensão rearranque" });

export const CASA_BANHO = arvore("casa-banho", T, "Casa de banho: aparelhagem nos volumes errados ou IP baixo", "Tomada ou interruptor perto da banheira, luminária sem IP, aquecedor de água sem diferencial.", "volume", {
  volume: esc("Em que volume está o aparelho em causa?", REF.m11_6, [
    ["Volume 0 (dentro da banheira ou base de duche)", "fim_v0"],
    ["Volume 1 (por cima, até 2,25 m)", "v1"],
    ["Volume 2 (faixa de 0,60 m à volta)", "v2"],
    ["Volume 3 (até 2,40 m depois do volume 2)", "v3"],
  ], { fazer: "Meça a partir da borda da banheira ou base; numa cabina pré-fabricada, aparelhagem a mais de 0,60 m da porta." }),
  v1: sn("No volume 1 só há aquecimento de água com diferencial ≤ 30 mA e interruptores de circuitos TRS ≤ 12 V, com IPX5?", REF.m11_6, "equipotencial", "fim_proibido"),
  v2: sn("No volume 2 a iluminação e a climatização são de classe II ou com diferencial ≤ 30 mA, as tomadas só TRS ou para máquina de barbear com transformador de separação, e IPX4?", REF.m11_6, "equipotencial", "fim_proibido"),
  v3: sn("No volume 3 as tomadas e a aparelhagem têm diferencial ≤ 30 mA (ou TRS / transformador de separação individual) e IPX1?", REF.m11_6, "equipotencial", "fim_proibido"),
  equipotencial: val("Continuidade da ligação equipotencial suplementar (canalização metálica → PE)", [REF.m11_5, REF.m11_6], "Ω", { ...CONTINUIDADE_PE }, "fim_ok", "fim_equipotencial", { fazer: SEM_TENSAO, ficha: { verificacao: "continuidade", valor: "continuidade" } }),
  fim_v0: fim("terra", REF.m11_6, "Aparelhagem ou canalização no volume 0: proibido (só TRS ≤ 12 V CA com a fonte fora dos volumes 0, 1 e 2).", "Desligar e retirar; propor a alternativa permitida.", { parar: true }),
  fim_proibido: fim("terra", REF.m11_6, "Aparelho não admitido no volume (ou sem o diferencial / IP exigidos).", "Deslocar o aparelho para fora do volume ou substituí-lo pelo admitido (IP, classe II, TRS, 30 mA); canalizações de classe II."),
  fim_equipotencial: fim("terra", [REF.m11_5, REF.m11_6], "Ligação equipotencial suplementar em falta ou interrompida.", "Ligar todos os elementos condutores dos volumes 0 a 3 ao PE dos equipamentos (RTIEBT 701.413.1.6) e voltar a medir."),
  fim_ok: fim("outro", REF.m11_6, "Aparelhagem admitida no volume e ligação equipotencial contínua.", "Registar no relatório da intervenção."),
}, { palavras: "casa de banho banheira duche volumes IPX4 IPX5 701" });

export const DST = arvore("dst", T, "Descarregador de sobretensões (DST)", "DST em falta, com indicador de fim de vida, ou aparelhos estragados depois de uma trovoada.", "existe", {
  existe: sn("O quadro de entrada tem DST?", [REF.m11_7, REF.m20_3], "indicador", "spda", { ficha: { verificacao: "visual" } }),
  spda: sn("O edifício tem para-raios (SPDA) ou alimentação aérea exposta?", REF.m11_7, "fim_tipo1", "fim_tipo2"),
  indicador: sn("O indicador do DST está bom (sem fim de vida)?", [REF.m20_3, REF.m11_7], "uc", "fim_fim_vida"),
  uc: val("Tensão máxima em regime permanente do DST (Uc, na placa)", REF.m11_7, "V", { ...DST_UC }, "ligacoes", "fim_uc", { casas: 0, max: 2000 }),
  ligacoes: val("Comprimento total das ligações do DST (fase/neutro + terra)", [REF.m11_7, REF.m11_7b], "m", { ...DST_LIGACOES }, "protecao", "fim_ligacoes", { casas: 2, max: 20, fazer: "Some o condutor de ligação ao barramento e o de terra, com a tampa aberta e sem tensão." }),
  protecao: sn("Tem a proteção a montante indicada pelo fabricante (fusível ou disjuntor) e a ligação em TT é 1+1 (monofásico) ou 3+1 (trifásico)?", [REF.m11_7, REF.m11_7b], "fim_ok", "fim_protecao"),
  fim_tipo1: fim("outro", [REF.m11_7, REF.m18_4], "Edifício com para-raios ou rede aérea sem DST.", "Instalar DST tipo 1 (ou 1+2) na origem, com equipotencialização ao SPDA."),
  fim_tipo2: fim("outro", REF.m11_7, "Quadro de entrada sem DST.", "Instalar DST tipo 2 (padrão Domus): Uc ≥ 275 V, Up ≤ 2,5 kV (≤ 1,5 kV para eletrónica), In ≥ 5 kA (usual 20 kA)."),
  fim_fim_vida: fim("outro", REF.m20_3, "DST em fim de vida (já absorveu sobretensões).", "Substituir o cartucho ou o DST; verificar os aparelhos sensíveis da casa."),
  fim_uc: fim("outro", REF.m11_7, "DST com Uc abaixo de 253 V: pode atuar com a tensão normal da rede.", "Substituir por um DST com Uc ≥ 275 V."),
  fim_ligacoes: fim("outro", [REF.m11_7, REF.m11_7b], "Ligações do DST demasiado compridas: a proteção perde eficácia.", "Refazer as ligações o mais curtas e retas possível (soma < 0,5 m)."),
  fim_protecao: fim("outro", REF.m11_7b, "DST sem a proteção a montante do fabricante ou com a ligação errada em TT.", "Montar a proteção indicada e a configuração 1+1 / 3+1 (centelhador entre neutro e PE)."),
  fim_ok: fim("outro", REF.m11_7, "DST adequado, em bom estado e bem ligado.", "Registar; verificar o indicador todos os anos e depois de trovoadas."),
}, { palavras: "DST descarregador sobretensões trovoada para-raios Uc Up" });

export const EQUIPOTENCIAL = arvore("equipotencial", T, "Ligação equipotencial em falta ou interrompida", "Canalizações de água ou gás sem ligação à terra, terminal principal de terra em falta.", "terminal", {
  terminal: sn("Existe o terminal principal de terra junto ao quadro de entrada, com o condutor de terra, os PE e as ligações equipotenciais?", REF.m11_5, "principal", "fim_terminal", { ficha: { verificacao: "visual" } }),
  principal: val("Continuidade da ligação equipotencial principal (canalização de água ou gás à entrada → terminal principal de terra)", REF.m11_5, "Ω", { ...CONTINUIDADE_PE }, "estrutura", "fim_principal", { fazer: SEM_TENSAO, ficha: { verificacao: "continuidade", valor: "continuidade" } }),
  estrutura: sn("A estrutura metálica e as armaduras acessíveis também estão ligadas ao terminal principal de terra?", REF.m11_5, "fim_ok", "fim_estrutura"),
  fim_terminal: fim("terra", REF.m11_5, "Falta o terminal principal de terra (obrigatório em todas as instalações).", "Instalar o terminal principal de terra (RTIEBT 542.4.1) e ligar-lhe o condutor de terra, os PE e as ligações equipotenciais."),
  fim_principal: fim("terra", REF.m11_5, "Ligação equipotencial principal em falta ou interrompida.", "Ligar as canalizações metálicas de água e gás à entrada do edifício ao terminal principal de terra e voltar a medir."),
  fim_estrutura: fim("terra", REF.m11_5, "Estrutura metálica ou armaduras acessíveis sem ligação equipotencial.", "Ligá-las ao terminal principal de terra."),
  fim_ok: fim("outro", REF.m11_5, "Ligações equipotenciais completas e contínuas.", "Registar no relatório da intervenção."),
}, { palavras: "equipotencial terminal principal de terra LEP água gás" });

export const ARVORES_PROTECOES2 = [FUSIVEL, SELETIVIDADE_ARV, AFDD, MINIMA, CASA_BANHO, DST, EQUIPOTENCIAL];
