// Árvores de diagnóstico — verificação, ensaios e manutenção (ronda 2; manual de instalações BT, caps. 16, 20.3 e anexo A).
// As verificações periódicas e a manutenção preventiva usam o nó "lista" (lista de verificação). Formato em motor.js.
import { arvore, sn, esc, val, lista, fim, SEM_TENSAO } from "./construir.js";
import { REF, ISOLAMENTO, ISOLAMENTO_TRS, TERRA, DIFERENCIAL_MS } from "./limites.js";

const G = "Verificação e manutenção";

export const POLARIDADE = arvore("polaridade", G, "Polaridade ou ordem de fases trocadas", "Interruptor que corta o neutro, tomada com fase e neutro trocados, motor trifásico a rodar ao contrário.", "o_que", {
  o_que: esc("O que se verifica?", [REF.m16_2, REF.anexoA], [
    ["Polaridade (monofásico)", "corte_fase"],
    ["Ordem de fases (trifásico)", "ordem"],
  ]),
  corte_fase: sn("Todos os aparelhos de corte unipolares (interruptores, disjuntores 1P) cortam a fase e não o neutro?", REF.m16_2, "tomadas", "fim_corte_neutro", { tensao: true, fazer: "Com o aparelho aberto, meça entre o borne de saída e a terra: não pode haver tensão." }),
  tomadas: sn("Nas tomadas, a fase e o neutro estão nos bornes certos e o PE ligado (testador de tomadas)?", REF.m16_2, "fim_ok", "fim_tomada", { tensao: true }),
  ordem: sn("O sentido de rotação das fases (L1–L2–L3) é o mesmo em todas as tomadas e saídas trifásicas (indicador de ordem de fases)?", REF.anexoA, "fim_ok", "fim_ordem", { tensao: true }),
  fim_corte_neutro: fim("outro", REF.m16_2, "Aparelho de corte unipolar no neutro: o circuito fica com tensão mesmo desligado.", "Sem tensão, passar o aparelho de corte para a fase e rever os outros do circuito."),
  fim_tomada: fim("outro", REF.m16_2, "Tomada com polaridade trocada ou sem PE.", "Sem tensão, refazer as ligações da tomada (e verificar o PE até ao quadro)."),
  fim_ordem: fim("outro", REF.anexoA, "Ordem de fases diferente entre saídas trifásicas: motores rodam ao contrário.", "Sem tensão, trocar duas fases na saída errada e confirmar com o indicador; identificar as fases."),
  fim_ok: fim("outro", [REF.m16_2, REF.anexoA], "Polaridade e ordem de fases corretas.", "Registar no relatório de ensaios."),
}, { palavras: "polaridade ordem de fases sentido rotação interruptor corta neutro" });

export const ISOLAMENTO_TRS_ARV = arvore("isolamento-trs", G, "Isolamento de circuitos TRS / TRP baixo", "Circuito de tensão reduzida (TRS/TRP) com isolamento baixo ou separação dos circuitos em dúvida.", "tensao", {
  tensao: sn("Mediu os circuitos TRS/TRP a 250 V CC (e não a 500 V)?", REF.m16_2, "medir", "fim_tensao_ensaio", { fazer: "Desligue a fonte TRS e os aparelhos ligados ao circuito." }),
  medir: val("Resistência de isolamento do circuito TRS/TRP", REF.m16_2, "MΩ", { ...ISOLAMENTO_TRS }, "separacao", "fim_baixo", { fazer: `${SEM_TENSAO} Megaohmímetro a 250 V CC.`, ficha: { verificacao: "isolamento", valor: "isolamento" } }),
  separacao: sn("A separação entre o circuito TRS/TRP e os circuitos de outras tensões está garantida (cabos, caixas e fonte de segurança próprios)?", REF.m16_2, "fim_ok", "fim_separacao"),
  fim_tensao_ensaio: fim("outro", REF.m16_2, "Ensaio feito com a tensão errada (TRS/TRP ensaiam-se a 250 V CC).", "Repetir a medição a 250 V CC."),
  fim_baixo: fim("terra", REF.m16_2, "Isolamento do circuito TRS/TRP abaixo de 0,25 MΩ.", "Localizar o troço com defeito (humidade, cabo ferido) e substituir; voltar a medir.", { seguir: "isolamento" }),
  fim_separacao: fim("outro", REF.m16_2, "Separação insuficiente entre o circuito TRS/TRP e outros circuitos.", "Separar canalizações e caixas e usar fonte de segurança; voltar a ensaiar."),
  fim_ok: fim("outro", REF.m16_2, "Circuito TRS/TRP com isolamento e separação conformes.", "Registar no relatório da intervenção."),
}, { palavras: "TRS TRP tensão reduzida segurança 250 V separação" });

export const VERIFICACAO = arvore("verificacao-periodica", G, "Verificação periódica da instalação", "Verificação inicial ou periódica: inspeção visual e ensaios pela ordem do manual.", "inspecao", {
  inspecao: lista("Inspeção visual (manual 16.1 e anexo A): marque o que está conforme.", [REF.m16_1, REF.anexoA], [
    ["protecoes", "Medidas de proteção contra choques e efeitos térmicos"],
    ["condutores", "Condutores com a secção e as cores certas; verde/amarelo só em PE"],
    ["apertos", "Ligações apertadas; ponteiras em cabo flexível"],
    ["involucros", "Invólucros fechados, sem partes ativas acessíveis (IP2X)"],
    ["identificacao", "Circuitos identificados e esquema na porta do quadro"],
    ["influencias", "Equipamento adequado às influências externas (IP/IK, casas de banho)"],
  ], "continuidade", "fim_visual", { ficha: { verificacao: "visual" } }),
  continuidade: sn("Continuidade dos condutores de proteção e equipotenciais em todas as massas e tomadas?", REF.m16_2, "isolamento", "fim_seguir_choque", { fazer: SEM_TENSAO, ficha: { verificacao: "continuidade" } }),
  isolamento: val("Isolamento mais baixo (cada circuito, L+N contra a terra, 500 V CC)", REF.m16_2, "MΩ", { ...ISOLAMENTO }, "polaridade", "fim_seguir_isolamento", { aviso: "polaridade", fazer: `${SEM_TENSAO} Aparelhos e eletrónica desligados.`, ficha: { verificacao: "isolamento", valor: "isolamento" } }),
  polaridade: sn("Polaridade correta (aparelhos de corte unipolares na fase)?", REF.m16_2, "terra", "fim_seguir_polaridade", { tensao: true }),
  terra: val("Resistência de terra", REF.m16_2, "Ω", { ...TERRA }, "diferencial", "fim_seguir_terra", { casas: 1 }),
  diferencial: val("Tempo de disparo do diferencial a IΔn", REF.m16_2, "ms", { ...DIFERENCIAL_MS }, "funcional", "fim_seguir_diferencial", { casas: 0, max: 10_000, tensao: true, ficha: { verificacao: "rcd", valor: "rcd" } }),
  funcional: sn("Ensaios funcionais (quadros, comandos, encravamentos) e quedas de tensão nos pontos mais afastados conformes?", REF.m16_2, "fim_ok", "fim_funcional", { tensao: true, ficha: { verificacao: "funcional" } }),
  fim_visual: fim("outro", [REF.m16_1, REF.anexoA], "Inspeção visual com pontos não conformes.", "Corrigir os pontos em falta (o percurso tem a lista) antes dos ensaios; registar."),
  fim_seguir_choque: fim("terra", REF.m16_2, "Continuidade do PE em falta numa massa ou tomada.", "Corrigir o PE e repetir o ensaio.", { seguir: "choque" }),
  fim_seguir_isolamento: fim("terra", REF.m16_2, "Isolamento abaixo de 0,5 MΩ.", "Seguir a árvore «Isolamento baixo»; repetir os ensaios anteriores que a correção possa ter afetado.", { seguir: "isolamento" }),
  fim_seguir_polaridade: fim("outro", REF.m16_2, "Polaridade errada.", "Seguir a árvore da polaridade.", { seguir: "polaridade" }),
  fim_seguir_terra: fim("terra", REF.m16_2, "Terra fora do valor.", "Seguir a árvore «Terra fora do valor».", { seguir: "terra" }),
  fim_seguir_diferencial: fim("outro", REF.m16_2, "Diferencial lento (tempo de disparo acima do especificado).", "Substituir o diferencial e voltar a ensaiar.", { seguir: "diferencial" }),
  fim_funcional: fim("outro", REF.m16_2, "Ensaio funcional ou queda de tensão não conformes.", "Corrigir e repetir; quedas de tensão: seguir a árvore da queda de tensão.", { seguir: "queda-tensao" }),
  fim_ok: fim("outro", [REF.m16_2, REF.m16_3], "Verificação conforme: inspeção visual e ensaios pela ordem do manual.", "Entregar o relatório de ensaios (valores de isolamento, terra e diferenciais, data, equipamento e técnico)."),
}, { palavras: "verificação periódica ensaios inspeção relatório 16.2 ordem" });

export const MANUTENCAO = arvore("manutencao-preventiva", G, "Manutenção preventiva", "Plano de manutenção da instalação (periodicidades de referência da Domus Energia).", "utilizador", {
  utilizador: lista("Feito pelo utilizador (instruído): marque o que está em dia.", REF.m20_3, [
    ["botao_t", "Teste dos diferenciais pelo botão T (mensal / trimestral)"],
    ["visual", "Inspeção visual de tomadas, fichas, extensões e quadro (anual)"],
  ], "eletricista", "fim_utilizador"),
  eletricista: lista("Feito pelo eletricista: marque o que está em dia.", REF.m20_3, [
    ["reaperto", "Reaperto dos bornes do quadro, sem tensão (1 a 5 anos) e termografia em quadros maiores"],
    ["medicoes", "Medição de isolamento e de terra e ensaio dos diferenciais (5 anos em habitação)"],
    ["dst", "Verificação do DST — indicador de fim de vida (anual e depois de trovoadas)"],
    ["etiquetas", "Etiquetas e esquema do quadro atualizados (sempre que houver alterações)"],
  ], "fim_ok", "fim_eletricista"),
  fim_utilizador: fim("outro", REF.m20_3, "O utilizador não faz as verificações simples (botão T, inspeção visual).", "Explicar ao cliente o teste mensal/trimestral pelo botão T e a inspeção anual; um diferencial que nunca dispara pode colar."),
  fim_eletricista: fim("outro", REF.m20_3, "Há operações de manutenção do eletricista em atraso.", "Agendar o que falta (ver o percurso) e registar cada intervenção: data, sintoma, causa, correção, medições e técnico."),
  fim_ok: fim("outro", REF.m20_3, "Manutenção preventiva em dia.", "Registar e marcar a próxima data."),
}, { palavras: "manutenção preventiva plano periodicidade botão T reaperto termografia" });

export const ARVORES_MANUTENCAO = [POLARIDADE, ISOLAMENTO_TRS_ARV, VERIFICACAO, MANUTENCAO];
