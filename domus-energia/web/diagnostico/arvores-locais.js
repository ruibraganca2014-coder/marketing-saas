// Árvores de diagnóstico — influências externas e locais especiais (ronda 2; manual de instalações BT, caps. 12 e 13).
// Formato em motor.js; atalhos em construir.js. Textos nossos, curtos, a partir do manual da empresa.
import { arvore, sn, esc, val, fim, SEM_TENSAO } from "./construir.js";
import { REF, CONTINUIDADE_PE, QUEDA_CAMPISMO } from "./limites.js";

const G = "Locais especiais e influências externas";
const UL25 = "Manual 13.4 e 13.8: tensão limite convencional UL = 25 V → RA ≤ 25 V ÷ IΔn (ex.: 300 mA → 83 Ω)";

export const IP_IK = arvore("ip-ik", G, "Grau IP ou IK desadequado ao local", "Aparelhagem molhada, com pó, partida por pancadas, ou com partes ativas acessíveis.", "local", {
  local: esc("Que local é?", REF.m12_3, [
    ["Sala, quarto, escritório (IP20)", "ip", { IPmin: 20 }],
    ["Cozinha junto ao lava-loiça (IPX4)", "ip", { IPmin: 4 }],
    ["Garagem (IPX3; IPX5 se for lavada a jato)", "ip", { IPmin: 3 }],
    ["Exterior abrigado ou varanda (IP44)", "ip", { IPmin: 44 }],
    ["Exterior exposto ou jardim (IP55)", "ip", { IPmin: 55 }],
  ], { fazer: "O local define o IP, não o preço do aparelho. Casas de banho e piscinas têm árvore própria." }),
  ip: sn("O código IP marcado no aparelho cumpre o do local (1.º algarismo sólidos, 2.º água; X = não especificado)?", [REF.m12_2, REF.m12_3], "ip2x", "fim_ip", { ficha: { verificacao: "visual" } }),
  ip2x: sn("Os invólucros garantem pelo menos IP2X (não se toca numa parte ativa com o dedo) e IP4X nas superfícies de cima acessíveis?", REF.m12_2, "ik", "fim_ip2x"),
  ik: sn("Em zona de pancadas (garagens, escolas, pavilhões, passagem pública), a aparelhagem é IK08 ou superior e os tubos à vista têm proteção mecânica?", [REF.m12_2, REF.m12_3], "fim_ok", "fim_ik"),
  fim_ip: fim("outro", [REF.m12_2, REF.m12_3], "Aparelhagem com IP abaixo do exigido pelo local.", "Substituir pela aparelhagem com o IP do local (ou proteger com invólucro adequado); depois medir o isolamento se entrou água.", { seguir: "isolamento" }),
  fim_ip2x: fim("terra", REF.m12_2, "Partes ativas acessíveis (invólucro abaixo de IP2X).", "Desligar e fechar: tampas, obturadores, barreiras; substituir o invólucro partido.", { parar: true }),
  fim_ik: fim("outro", REF.m12_2, "Aparelhagem ou tubos sem resistência ao choque mecânico do local.", "Usar IK08 ou superior à altura de impacto e tubos de IK elevado ou com proteção mecânica."),
  fim_ok: fim("outro", REF.m12_3, "IP e IK adequados ao local.", "Registar no relatório da intervenção."),
}, { palavras: "IP IK poeiras água pancadas invólucro IP2X IP44 IP55" });

export const PISCINA = arvore("piscina", G, "Piscina, lago ou fonte ornamental", "Choques perto da água, projetores avariados, aparelhagem junto à piscina.", "volume", {
  volume: esc("Onde está o equipamento?", [REF.m13_1, REF.m13_2], [
    ["Volume 0 / zona 0 (dentro da bacia, zonas das quedas e repuxos)", "v0"],
    ["Volume 1 (até 2 m dos bordos e 2,5 m de altura) / zona 1 de um lago", "v1"],
    ["Volume 2 (mais 1,5 m depois do volume 1)", "v2"],
  ]),
  v0: sn("Só há equipamentos fixos próprios para piscinas (ex.: projetores TRS 12 V, classe III), IPX8, e o transformador TRS está fora dos volumes, em local não inundável?", [REF.m13_1b, REF.m13_2], "equipotencial", "fim_proibido"),
  v1: sn("Há só canalizações de classe II sem revestimento metálico, para aparelhos deste volume, IPX5, e nenhuma aparelhagem (a não ser tomadas de pequenas piscinas a ≥ 1,25 m do bordo e 0,30 m do chão, com 30 mA ou separação)?", REF.m13_1b, "equipotencial", "fim_proibido"),
  v2: sn("A aparelhagem é de classe II, ou classe I com diferencial 30 mA, ou com separação; IPX2 interior / IPX4 exterior (IPX5 se lavado a jato)?", REF.m13_1b, "equipotencial", "fim_proibido"),
  equipotencial: val("Continuidade da ligação equipotencial suplementar (elementos condutores dos volumes 0–2 → PE)", REF.m13_1b, "Ω", { ...CONTINUIDADE_PE }, "fim_ok", "fim_equipotencial", { fazer: `${SEM_TENSAO} Inclui pavimentos não isolantes, condutas, estruturas e grelhas metálicas de água e ar.`, ficha: { verificacao: "continuidade", valor: "continuidade" } }),
  fim_proibido: fim("terra", [REF.m13_1b, REF.m13_2], "Equipamento ou canalização não admitidos no volume da piscina (ou sem o IP / a proteção exigidos).", "Desligar e retirar, ou substituir pelo admitido (TRS 12 V, classe II, 30 mA, IP do volume). Instalação de piscina: com projeto.", { parar: true }),
  fim_equipotencial: fim("terra", REF.m13_1b, "Falta ou está interrompida a ligação equipotencial suplementar da piscina (RTIEBT 702.413.1.6).", "Executar a ligação equipotencial de todos os elementos condutores dos volumes 0, 1 e 2 ao PE e voltar a medir; não usar a piscina até lá.", { parar: true }),
  fim_ok: fim("outro", REF.m13_1, "Equipamentos admitidos nos volumes e ligação equipotencial contínua.", "Registar; ensaiar os diferenciais de 30 mA."),
}, { palavras: "piscina lago fonte projetor TRS 12 V volumes 702" });

export const SAUNA = arvore("sauna", G, "Sauna", "Avaria no radiador da sauna, aparelhagem dentro da cabina, cabos que aquecem.", "tomadas", {
  tomadas: sn("Não há tomadas na cabina e a aparelhagem está fora dela (exceto a do radiador)?", REF.m13_3, "zonas", "fim_aparelhagem", { ficha: { verificacao: "visual" } }),
  zonas: sn("Na zona 1 só está o radiador e acessórios, e na zona 3 só equipamento para 125 °C?", REF.m13_3, "ip", "fim_zonas"),
  ip: sn("O equipamento é IP24 no mínimo e as canalizações de classe II sem revestimento metálico?", REF.m13_3, "fim_ok", "fim_ip"),
  fim_aparelhagem: fim("outro", REF.m13_3, "Tomadas ou aparelhagem dentro da cabina da sauna.", "Retirar as tomadas e deslocar a aparelhagem para fora da cabina."),
  fim_zonas: fim("sobrecarga", REF.m13_3, "Equipamento numa zona da sauna que não suporta a temperatura.", "Substituir por equipamento para 125 °C na zona 3 e deixar na zona 1 só o radiador."),
  fim_ip: fim("outro", REF.m13_3, "Equipamento abaixo de IP24 ou canalização não admitida na sauna.", "Substituir por IP24 e canalização de classe II sem revestimento metálico."),
  fim_ok: fim("outro", REF.m13_3, "Sauna conforme as regras do manual.", "Registar; a avaria do radiador segue as instruções do fabricante.", { seguir: "aquecimento" }),
}, { palavras: "sauna radiador 125 °C IP24 703" });

export const ESTALEIRO = arvore("estaleiro", G, "Estaleiro de obra", "Diferencial do quadro de estaleiro a disparar, choques em máquinas, terra do estaleiro.", "quadro", {
  quadro: sn("O quadro de estaleiro é conforme a EN 61439-4, com o corte geral e as proteções principais, e o IP que ela especifica?", REF.m13_4, "tomadas", "fim_quadro", { ficha: { verificacao: "visual" } }),
  tomadas: sn("Todas as tomadas estão protegidas por diferencial ≤ 30 mA, por TRS ou por transformador de separação individual?", REF.m13_4, "geral", "fim_tomadas", { ficha: { verificacao: "rcd" } }),
  geral: esc("Qual é o diferencial geral do quadro de estaleiro?", REF.m13_4, [
    ["300 mA", "terra", { RAmax: 83 }],
    ["100 mA", "terra", { RAmax: 250 }],
    ["30 mA", "terra", { RAmax: 833 }],
  ]),
  terra: val("Resistência de terra do estaleiro", REF.m13_4, "Ω", { max: { var: "RAmax" }, fonte: UL25 }, "fim_ok", "fim_terra", { casas: 1, fazer: "Terrómetro. Em estaleiro a terra tem de ser duas vezes melhor do que num edifício (UL = 25 V)." }),
  fim_quadro: fim("outro", REF.m13_4, "Quadro de estaleiro não conforme.", "Substituir por quadro conforme a EN 61439-4; tudo a jusante é tratado como instalação móvel."),
  fim_tomadas: fim("terra", REF.m13_4, "Tomadas do estaleiro sem diferencial de 30 mA (ou TRS / separação).", "Proteger todas as tomadas com diferencial ≤ 30 mA antes de voltar a usar.", { parar: true }),
  fim_terra: fim("terra", REF.m13_4, "Terra do estaleiro acima do limite para UL = 25 V.", "Reforçar o elétrodo até RA ≤ 25 V ÷ IΔn (ex.: 83 Ω com 300 mA); em IT, controlador permanente de isolamento.", { seguir: "terra" }),
  fim_ok: fim("outro", REF.m13_4, "Estaleiro com quadro, diferenciais e terra conformes.", "Registar; o disparo de um diferencial segue a árvore do diferencial.", { seguir: "diferencial" }),
}, { palavras: "estaleiro obra quadro provisório EN 61439-4 704 UL 25 V" });

export const GARAGEM = arvore("garagem", G, "Garagem, parque ou arrecadação", "Aparelhagem molhada, cabos danificados por viaturas, arrecadação mal alimentada.", "canalizacoes", {
  canalizacoes: sn("As canalizações são de classe II (cabos em braçadeiras ou caminho de cabos, ou condutores em tubo equivalente)?", REF.m13_5, "ip", "fim_canalizacoes", { ficha: { verificacao: "visual" } }),
  ip: sn("A aparelhagem de comando é IPX3 no mínimo (IPX5 onde se lava a jato) e as tomadas de acesso público têm obturadores?", REF.m13_5, "arrecadacao", "fim_ip"),
  arrecadacao: sn("A arrecadação (ou garagem individual) é alimentada por circuito do quadro da habitação, só pela fração e zonas comuns, com corte de todos os condutores ativos junto ao acesso?", [REF.m13_5b, REF.m3_tipo], "fim_ok", "fim_arrecadacao"),
  fim_canalizacoes: fim("outro", REF.m13_5, "Canalizações não protegidas na garagem.", "Refazer em classe II (cabo em braçadeiras ou caminho de cabos, ou tubo) e com proteção mecânica nas zonas de manobra."),
  fim_ip: fim("outro", REF.m13_5, "Aparelhagem abaixo de IPX3 (ou IPX5 onde se lava) ou tomadas públicas sem obturadores.", "Substituir pela aparelhagem com o IP e os obturadores exigidos.", { seguir: "ip-ik" }),
  fim_arrecadacao: fim("outro", REF.m13_5b, "Arrecadação alimentada de forma não admitida.", "Alimentar por circuito próprio do quadro da habitação, com dispositivo de corte junto ao acesso (arrecadações < 5 m² podem ficar na iluminação comum, sem tomadas)."),
  fim_ok: fim("outro", REF.m13_5, "Garagem ou arrecadação conforme.", "Registar no relatório da intervenção."),
}, { palavras: "garagem parque estacionamento arrecadação IPX3 IPX5" });

export const VE = arvore("carregador-ve", G, "Carregador de veículo elétrico", "O carregador não carrega, o diferencial dispara a carregar, carregamento em tomada doméstica.", "dedicado", {
  dedicado: sn("O ponto de carregamento tem circuito dedicado (não é uma tomada doméstica partilhada)?", [REF.m13_6, REF.m2_4], "diferencial", "fim_dedicado", { ficha: { verificacao: "visual" } }),
  diferencial: esc("Que diferencial protege o carregador?", REF.m13_6, [
    ["30 mA tipo B", "calibre"],
    ["30 mA tipo A, com deteção de 6 mA CC integrada na wallbox", "calibre"],
    ["30 mA tipo A sem deteção de CC, ou tipo AC", "fim_diferencial"],
    ["Sem diferencial próprio", "fim_diferencial"],
  ], { ficha: { verificacao: "rcd" } }),
  calibre: sn("Disjuntor e cabo estão de acordo com a potência (ex.: wallbox 7,4 kW = 32 A → disjuntor 40 A curva C e 3G6 mm²)?", REF.m13_6, "potencia", "fim_calibre"),
  potencia: sn("A potência contratada aguenta o carregamento com as outras cargas (ou há gestão dinâmica de carga)?", [REF.m13_6, REF.m2_escaloes], "fim_ok", "fim_potencia"),
  fim_dedicado: fim("sobrecarga", REF.m13_6, "Carregamento prolongado em tomada doméstica ou circuito partilhado.", "Instalar circuito dedicado e wallbox em modo 3 (7,4 kW mono / 11 kW tri); não usar a tomada doméstica para carregamentos longos."),
  fim_diferencial: fim("terra", REF.m13_6, "Diferencial inadequado: uma fuga em corrente contínua pode cegar um diferencial tipo A/AC.", "Instalar diferencial de 30 mA tipo B, ou tipo A com deteção de 6 mA CC na wallbox; ensaiar.", { parar: true }),
  fim_calibre: fim("sobrecarga", REF.m13_6, "Proteção ou cabo do carregador mal dimensionados.", "Dimensionar pela corrente do carregador (IB), corrente admissível e queda de tensão (ex.: 3G6 mm², 40 A, ≤ 2,1 % em 20 m)."),
  fim_potencia: fim("sobrecarga", [REF.m13_6, REF.m2_escaloes], "Potência contratada insuficiente para carregar com as outras cargas.", "Instalar gestão dinâmica de carga ou propor o aumento da potência contratada.", { seguir: "potencia-contratada" }),
  fim_ok: fim("outro", REF.m13_6, "Carregador com circuito, diferencial e potência adequados.", "A avaria do carregador segue as instruções do fabricante; registar os ensaios."),
}, { palavras: "carregador VE wallbox veículo elétrico tipo B 6 mA CC modo 3" });

export const CAMPISMO = arvore("campismo-marina", G, "Parque de campismo ou marina", "Tomadas dos lugares sem corrente, diferencial do armário a disparar, cabos danificados.", "projeto", {
  projeto: sn("A instalação tem projeto e técnico responsável pela exploração (obrigatório qualquer que seja a potência)?", REF.m13_7, "armario", "fim_projeto"),
  armario: sn("Os armários são IP44 / IK08 com fechadura, cada tomada (ou grupo de 2–3) tem diferencial de 30 mA e disjuntor de 16 A, e as tomadas são EN 60309 16 A 2P+T IP44?", [REF.m13_7, REF.m13_7b], "queda", "fim_armario", { ficha: { verificacao: "rcd" } }),
  queda: val("Queda de tensão na tomada mais afastada, com carga", REF.m13_7b, "%", { ...QUEDA_CAMPISMO }, "cabos", "fim_queda", { casas: 1, max: 100, tensao: true }),
  cabos: sn("Os cabos estão enterrados a mais de 0,8 m com proteção mecânica (ou aéreos só em torçada); nas marinas, flexíveis de bainha dupla protegidos das marés?", REF.m13_7b, "fim_ok", "fim_cabos"),
  fim_projeto: fim("outro", REF.m13_7, "Instalação de parque de campismo ou marina sem projeto ou sem técnico responsável.", "Não intervir além da segurança imediata; chamar apoio (exige projeto e técnico responsável).", { parar: true }),
  fim_armario: fim("terra", [REF.m13_7, REF.m13_7b], "Armário ou tomadas dos lugares sem as proteções e o IP exigidos.", "Repor diferencial de 30 mA e disjuntor de 16 A por tomada (ou grupo), armário IP44/IK08 com fechadura e tomadas EN 60309."),
  fim_queda: fim("sobrecarga", REF.m13_7b, "Queda de tensão acima de 5 % nas tomadas dos lugares.", "Rever a secção (mínimo 6 mm² Cu direto a um armário; 10 mm² para vários) e o comprimento da rede.", { seguir: "queda-tensao" }),
  fim_cabos: fim("outro", REF.m13_7b, "Cabos expostos a danos mecânicos ou à água.", "Enterrar a maior profundidade com proteção, ou usar torçada / cabos de bainha dupla nas marinas."),
  fim_ok: fim("outro", REF.m13_7, "Instalação dos lugares conforme.", "Registar; uma tomada sem corrente segue a árvore «Sem corrente».", { seguir: "sem-corrente" }),
}, { palavras: "campismo caravanas marina embarcações armário EN 60309 CEE azul" });

export const AGRICOLA = arvore("agricola", G, "Estabelecimento agrícola ou pecuário", "Animais com choques, diferencial a disparar no estábulo, pó e palha junto à aparelhagem.", "equipotencial", {
  equipotencial: val("Continuidade da ligação equipotencial suplementar (grelhas, bebedouros, manjedouras metálicas → PE)", REF.m13_8b, "Ω", { ...CONTINUIDADE_PE }, "tomadas", "fim_equipotencial", { fazer: `${SEM_TENSAO} Os animais são muito mais sensíveis à tensão de passo do que as pessoas.`, ficha: { verificacao: "continuidade", valor: "continuidade" } }),
  tomadas: sn("As tomadas têm diferencial de 30 mA e há diferencial com IΔn ≤ 0,5 A contra incêndio?", REF.m13_8b, "ip4x", "fim_diferencial", { ficha: { verificacao: "rcd" } }),
  ip4x: sn("A aparelhagem e as luminárias são IP4X no mínimo (ou estão fora destes locais) e sem pó ou palha acumulados?", REF.m13_8b, "terra", "fim_incendio"),
  terra: esc("Qual é o maior IΔn a montante?", REF.m13_8b, [
    ["300 mA", "ra", { RAmax: 83 }],
    ["30 mA", "ra", { RAmax: 833 }],
  ]),
  ra: val("Resistência de terra", REF.m13_8b, "Ω", { max: { var: "RAmax" }, fonte: UL25 }, "fim_ok", "fim_terra", { casas: 1 }),
  fim_equipotencial: fim("terra", REF.m13_8b, "Ligação equipotencial suplementar em falta: os animais ficam sujeitos a tensões perigosas.", "Interligar todas as massas e elementos condutores que os animais possam tocar ao PE."),
  fim_diferencial: fim("terra", REF.m13_8b, "Falta o diferencial de 30 mA nas tomadas ou o de 0,5 A contra incêndio.", "Instalar os diferenciais e ensaiar."),
  fim_incendio: fim("outro", REF.m13_8b, "Risco de incêndio: aparelhagem sem IP4X ou com pó e palha acumulados.", "Substituir por IP4X (ou mudar para fora do local) e limpar; evitar equipamentos que aqueçam."),
  fim_terra: fim("terra", REF.m13_8b, "Resistência de terra acima do limite para UL = 25 V.", "Reforçar o elétrodo de terra.", { seguir: "terra" }),
  fim_ok: fim("outro", REF.m13_8, "Instalação agrícola conforme.", "Registar no relatório da intervenção."),
}, { palavras: "agrícola pecuária estábulo animais palha 705 UL 25 V" });

export const ATEX = arvore("atex", G, "Atmosfera explosiva (ATEX)", "Avaria num posto de combustível, cabina de pintura, armazém de solventes, silo ou carpintaria.", "projeto", {
  projeto: sn("Há projeto e documento de classificação de zonas (0/1/2 gases; 20/21/22 poeiras)?", REF.m13_9, "material", "fim_sem_projeto", { fazer: "Não abra invólucros nem meça dentro das zonas sem autorização e material próprio." }),
  material: sn("O material instalado na zona tem marcação Ex com a categoria da zona?", REF.m13_9, "fim_apoio", "fim_material"),
  fim_sem_projeto: fim("outro", REF.m13_9, "Instalação em atmosfera explosiva sem projeto nem classificação de zonas.", "Não intervir: a Domus Energia só trabalha em ATEX com projeto e documento de classificação de zonas (DL 96/2017). Chamar apoio.", { parar: true }),
  fim_material: fim("outro", REF.m13_9, "Material sem marcação Ex adequada à zona: risco de explosão.", "Desligar e sinalizar; substituição só com projeto e material certificado. Chamar apoio.", { parar: true }),
  fim_apoio: fim("outro", REF.m13_9, "Instalação ATEX com projeto e material certificado.", "O diagnóstico faz-se segundo o projeto e com o responsável do local; chamar apoio antes de mexer.", { parar: true }),
}, { palavras: "ATEX explosiva combustível pintura solventes silo poeiras Ex" });

export const ARVORES_LOCAIS = [IP_IK, PISCINA, SAUNA, ESTALEIRO, GARAGEM, VE, CAMPISMO, AGRICOLA, ATEX];
