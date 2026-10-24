// Árvores de diagnóstico — edifícios coletivos, equilíbrio de fases e iluminação de segurança (ronda 2; manual de
// instalações BT, caps. 8, 14 e 15). Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, fim, SEM_TENSAO } from "./construir.js";
import { REF, TENSAO_REDE, QUEDA_COLUNA, QUEDA_ENTRADA, DESEQUILIBRIO, EMERGENCIA_DISTANCIA, EMERGENCIA_AUTONOMIA } from "./limites.js";

const G = "Edifícios coletivos e segurança";
const OPERADOR = "Portinhola, ramal, fusíveis da portinhola e contadores são do operador de rede (E-REDES): não se abre a selagem.";

export const PORTINHOLA = arvore("portinhola", G, "Portinhola danificada ou sem tensão", "Portinhola partida, molhada, aquecida, ou sem tensão à saída.", "estado", {
  estado: sn("A portinhola está inteira (material isolante, classe II, IP44 e IK09), fechada e sem sinais de água ou aquecimento?", REF.m14_2, "tensao", "fim_danificada", { fazer: OPERADOR, ficha: { verificacao: "visual" } }),
  tensao: val("Tensão à saída da portinhola (no lado do cliente, fase–neutro)", [REF.m14_2, REF.m8_3], "V", { ...TENSAO_REDE }, "fim_jusante", "fim_sem_tensao", { casas: 1, max: 1000, tensao: true, acima: "fim_sobretensao", fazer: "Só no lado do cliente, com pontas CAT IV (origem da instalação)." }),
  fim_danificada: fim("outro", REF.m14_2, "Portinhola danificada, molhada ou aquecida.", "Isolar a zona e pedir ao cliente que contacte o operador de rede (E-REDES); o modelo homologado é definido por ele.", { parar: true }),
  fim_sem_tensao: fim("outro", [REF.m14_2, REF.m8_3], "Sem tensão à saída da portinhola: fusíveis do ramal ou ramal do operador.", "O cliente contacta o operador de rede (E-REDES). Não se trocam fusíveis da portinhola.", { parar: true }),
  fim_sobretensao: fim("outro", REF.m8_3b, "Tensão muito acima do normal à saída da portinhola (possível neutro interrompido).", "Desligar o geral e contactar de imediato o operador de rede.", { parar: true }),
  fim_jusante: fim("outro", REF.m8_3, "Portinhola em bom estado e com tensão: a falha está a jusante.", "Continuar com a árvore «A casa toda sem energia».", { seguir: "sem-energia" }),
}, { palavras: "portinhola ramal P25 P50 P100 P400 E-REDES" });

export const COLUNA = arvore("coluna-montante", G, "Coluna montante: tensão baixa, aquecimento ou fogos sem energia", "Fogos de um prédio com tensão baixa, caixa de coluna quente, coluna sem energia.", "aquece", {
  aquece: sn("Alguma caixa de coluna ou o quadro de colunas tem sinais de aquecimento, cheiro a queimado ou água?", [REF.m14_3, REF.m14_1], "fim_aquece", "queda_coluna", { ficha: { verificacao: "visual" } }),
  queda_coluna: val("Queda de tensão na coluna (do quadro de colunas à última caixa de coluna), com carga", [REF.m14_1, REF.m14_3], "%", { ...QUEDA_COLUNA }, "queda_entrada", "fim_coluna", { casas: 2, max: 100, tensao: true, fazer: "Meça fase–neutro no quadro de colunas e na última caixa ao mesmo tempo (ou logo a seguir) e calcule a percentagem." }),
  queda_entrada: val("Queda de tensão na entrada (da caixa de coluna ao quadro do fogo), com carga", REF.m14_1, "%", { ...QUEDA_ENTRADA }, "neutro", "fim_entrada", { casas: 2, max: 100, tensao: true }),
  neutro: sn("O neutro da coluna tem a mesma secção das fases (ou há medidas contra sobrecarga do neutro reduzido)?", [REF.m14_1, REF.m22_4], "fim_ok", "fim_neutro"),
  fim_aquece: fim("sobrecarga", REF.m14_3, "Aquecimento ou água numa caixa de coluna ou no quadro de colunas.", "Desligar a coluna (com o operador, se a proteção for dele), isolar a zona e refazer as ligações; a caixa fica com porta não metálica ligada a partes ativas e identificada.", { parar: true }),
  fim_coluna: fim("sobrecarga", [REF.m14_3, REF.m8_4b], "Queda de tensão na coluna acima de 1 %: coluna subdimensionada para o número de fogos.", "Recalcular a coluna com os fatores de simultaneidade (quadro 803A) e a queda; propor o reforço da secção."),
  fim_entrada: fim("sobrecarga", REF.m14_1, "Queda de tensão na entrada do fogo acima de 0,5 %.", "Rever a secção da entrada e os apertos na caixa de coluna e no contador."),
  fim_neutro: fim("sobrecarga", [REF.m14_1, REF.m22_4], "Neutro reduzido sem proteção contra sobrecarga (com muitas cargas eletrónicas pode aquecer).", "Medir a corrente no neutro com pinça true RMS; propor neutro com a secção das fases.", { seguir: "harmonicos" }),
  fim_ok: fim("outro", REF.m14_1, "Coluna e entrada dentro dos limites do manual.", "Procurar a causa dentro do fogo.", { seguir: "sem-energia" }),
}, { palavras: "coluna montante caixa de coluna prédio fogos entrada 803" });

export const QUADRO_COLUNAS = arvore("quadro-colunas", G, "Quadro de colunas: proteção de uma coluna ou dos serviços comuns disparou", "Uma coluna ou os serviços comuns (escadas, elevador, garagem) sem energia.", "qual", {
  qual: esc("O que está sem energia?", REF.m14_1, [
    ["Uma coluna inteira (vários fogos)", "protecao_coluna"],
    ["Os serviços comuns (escadas, elevador, garagem, bombas)", "comuns"],
  ]),
  protecao_coluna: sn("A proteção dessa coluna no quadro de colunas (fusíveis ou disjuntor) atuou?", REF.m14_1, "iso_coluna", "fim_operador", { fazer: OPERADOR }),
  iso_coluna: val("Isolamento da coluna (entre condutores e à terra), com os fogos desligados", REF.m16_2, "MΩ", { min: 0.5, aviso: 1, fonte: "Manual 16.2: ≥ 0,5 MΩ a 500 V CC (objetivo Domus ≥ 1 MΩ)" }, "fim_sobrecarga_coluna", "fim_defeito_coluna", { fazer: `${SEM_TENSAO} Com todas as entradas dos fogos desligadas.`, aviso: "fim_sobrecarga_coluna", ficha: { verificacao: "isolamento", valor: "isolamento" } }),
  comuns: sn("A proteção dos serviços comuns atuou por um defeito num circuito (escadas, elevador, garagem)?", REF.m14_1, "fim_comuns", "fim_operador"),
  fim_operador: fim("outro", REF.m14_2, "Sem atuação de proteção no quadro de colunas: falta de energia a montante.", "O condomínio contacta o operador de rede.", { parar: true }),
  fim_defeito_coluna: fim("curto", REF.m14_3, "Defeito de isolamento ou curto-circuito na coluna montante.", "Localizar caixa a caixa; reparar antes de repor a proteção. Trabalho com o condomínio e, se a coluna for do operador, com ele.", { parar: true }),
  fim_sobrecarga_coluna: fim("sobrecarga", [REF.m14_3, REF.m8_4b], "Coluna sem defeito: sobrecarga (potência dos fogos acima do previsto).", "Medir a corrente por fase em horas de ponta e rever o dimensionamento com o quadro 803A."),
  fim_comuns: fim("outro", REF.m14_1, "Defeito num circuito dos serviços comuns.", "Separar os circuitos comuns e seguir a árvore do disjuntor ou do diferencial.", { seguir: "disjuntor" }),
}, { palavras: "quadro de colunas serviços comuns escadas elevador condomínio" });

export const DESEQUILIBRIO_ARV = arvore("desequilibrio-fases", G, "Desequilíbrio de fases (trifásico)", "Uma fase sobrecarregada, o geral dispara numa fase, neutro quente.", "fase_max", {
  fase_max: val("Desequilíbrio entre a fase mais e a menos carregada: (I máx − I mín) ÷ I máx × 100", [REF.m8_2], "%", { ...DESEQUILIBRIO }, "neutro", "fim_desequilibrio", { casas: 0, max: 100, tensao: true, fazer: "Pinça amperimétrica em cada fase com a carga habitual (ou use o quadro de cargas)." }),
  neutro: sn("O neutro aquece ou leva mais corrente do que as fases?", [REF.m22_4, REF.m8_2], "fim_harmonicos", "fim_ok", { tensao: true }),
  fim_desequilibrio: fim("sobrecarga", REF.m8_2, "Cargas mal repartidas pelas fases.", "Refazer o quadro de cargas e trocar circuitos de fase até a diferença ficar abaixo de 15–20 %; voltar a medir."),
  fim_harmonicos: fim("sobrecarga", REF.m22_4, "Corrente elevada no neutro com fases equilibradas: harmónicos de ordem 3.", "Continuar com a árvore dos harmónicos.", { seguir: "harmonicos" }),
  fim_ok: fim("outro", REF.m8_2, "Fases equilibradas e neutro normal.", "Registar a corrente por fase."),
}, { palavras: "trifásico fases desequilíbrio L1 L2 L3 quadro de cargas" });

export const PISO = arvore("piso-sem-energia", G, "Um piso ou vários fogos sem energia", "Num prédio, um piso ou alguns fogos ficam sem energia e os outros não.", "quantos", {
  quantos: esc("O que está sem energia?", REF.m14_1, [
    ["Todos os fogos de uma coluna", "fim_seguir_quadro"],
    ["Os fogos de um piso (a mesma caixa de coluna)", "caixa"],
    ["Só um fogo", "fim_um_fogo"],
  ]),
  caixa: val("Tensão à saída da caixa de coluna desse piso (fase–neutro)", [REF.m14_1, REF.m14_3], "V", { ...TENSAO_REDE }, "fim_entradas", "fim_caixa", { casas: 1, max: 1000, tensao: true }),
  fim_seguir_quadro: fim("outro", REF.m14_1, "Toda a coluna sem energia.", "Continuar com a árvore do quadro de colunas.", { seguir: "quadro-colunas" }),
  fim_um_fogo: fim("outro", REF.m14_1, "Só um fogo sem energia.", "Continuar com a árvore «A casa toda sem energia».", { seguir: "sem-energia" }),
  fim_caixa: fim("aberto", REF.m14_3, "Sem tensão à saída da caixa de coluna: proteção da derivação atuada ou ligação interrompida na caixa.", "Com o condomínio (e o operador, se for o caso), verificar os fusíveis/ligações da caixa de coluna e refazer; nunca abrir selagens.", { parar: true }),
  fim_entradas: fim("aberto", REF.m14_1, "Há tensão na caixa de coluna: a falha está nas entradas ou nos contadores dos fogos.", "Verificar as entradas e os contadores (estes com o operador) e depois cada quadro de fogo.", { seguir: "sem-energia" }),
}, { palavras: "piso prédio fogos caixa de coluna sem luz" });

export const ILUMINACAO_SEGURANCA = arvore("iluminacao-seguranca", G, "Iluminação de segurança (emergência)", "Blocos de emergência que não acendem, autonomia curta, saídas sem sinalização.", "lotacao", {
  lotacao: sn("O local recebe público ou tem mais de 50 pessoas (iluminação de circulação obrigatória)?", [REF.m15_1, REF.m15_2], "distancia", "fim_nao_obrigatoria"),
  distancia: val("Maior distância entre dois aparelhos de circulação seguidos", REF.m15_2, "m", { ...EMERGENCIA_DISTANCIA }, "autonomia", "fim_distancia", { casas: 1, max: 1000, fazer: "Meça ao longo do caminho de evacuação; as saídas e as mudanças de direção têm de estar sinalizadas." }),
  autonomia: val("Autonomia medida dos blocos autónomos (corte da alimentação normal)", REF.m15_3, "h", { ...EMERGENCIA_AUTONOMIA }, "diferencial", "fim_autonomia", { casas: 2, max: 48, fazer: "Corte a alimentação normal e cronometre até o bloco apagar (ou use o teste do fabricante)." }),
  diferencial: sn("Os circuitos de iluminação não estão todos num único diferencial (a falha de um circuito não deixa o local às escuras)?", REF.m15_1, "fim_ok", "fim_diferencial"),
  fim_nao_obrigatoria: fim("outro", REF.m15_2, "Local onde a iluminação de circulação não é obrigatória.", "Reparar o bloco como um aparelho comum; registar."),
  fim_distancia: fim("outro", REF.m15_2, "Aparelhos de circulação afastados mais de 15 m.", "Acrescentar aparelhos até ficarem a ≤ 15 m e sinalizar saídas e mudanças de direção (confirmar com o projeto SCIE)."),
  fim_autonomia: fim("outro", REF.m15_3, "Autonomia abaixo de 1 h (bateria gasta ou bloco avariado).", "Substituir a bateria ou o bloco e repetir o ensaio de autonomia."),
  fim_diferencial: fim("outro", REF.m15_1, "Um único diferencial para toda a iluminação (proibido nos locais de 1.ª a 4.ª categoria).", "Repartir a iluminação por mais diferenciais."),
  fim_ok: fim("outro", [REF.m15_2, REF.m15_3], "Iluminação de segurança conforme.", "Registar os ensaios de autonomia."),
}, { palavras: "emergência bloco autónomo saída evacuação autonomia SCIE" });

export const ARVORES_EDIFICIOS = [PORTINHOLA, COLUNA, QUADRO_COLUNAS, DESEQUILIBRIO_ARV, PISO, ILUMINACAO_SEGURANCA];
