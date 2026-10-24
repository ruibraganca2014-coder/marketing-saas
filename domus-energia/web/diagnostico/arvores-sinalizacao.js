// Árvores de diagnóstico — sinalização, telecomunicações e para-raios (ronda 2; manual de instalações BT, cap. 18).
// Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, fim, SEM_TENSAO } from "./construir.js";
import { REF, CAMPAINHA } from "./limites.js";

const G = "Sinalização, telecomunicações e para-raios";

export const CAMPAINHA_ARV = arvore("campainha", G, "Campainha ou quadro de chamadas não toca", "A campainha não toca, toca sempre, ou o quadro de alvos não indica o local.", "secundario", {
  secundario: val("Tensão no secundário do transformador da campainha", REF.m18_1, "V", { ...CAMPAINHA }, "botao", "primario", { casas: 1, max: 400, tensao: true, fazer: "Multímetro em tensão alternada aos bornes de saída do transformador." }),
  primario: sn("Chega 230 V ao primário do transformador (o disjuntor da sinalização está ligado)?", REF.m18_1, "fim_transformador", "fim_seguir_sem_corrente", { tensao: true }),
  botao: sn("Com o botão premido, há continuidade no botão e no cabo de sinalização (0,5–0,75 mm²) até à campainha?", REF.m18_1, "fim_campainha", "fim_botao", { fazer: SEM_TENSAO }),
  fim_transformador: fim("aberto", REF.m18_1, "Transformador da campainha avariado (sem tensão no secundário com 230 V no primário).", "Substituir por transformador de segurança com a tensão da campainha (3, 5, 8, 12 ou 24 V CA)."),
  fim_seguir_sem_corrente: fim("aberto", REF.m18_1, "O transformador não recebe 230 V.", "Seguir a árvore «Sem corrente».", { seguir: "sem-corrente" }),
  fim_botao: fim("aberto", REF.m18_1, "Botão avariado ou cabo de sinalização interrompido.", "Substituir o botão ou o troço de cabo; nunca usar condutores de energia para a sinalização."),
  fim_campainha: fim("aberto", REF.m18_1, "Alimentação e botão bons: a campainha (ou o alvo do quadro de chamadas) está avariada.", "Substituir a campainha; no quadro de chamadas, verificar o alvo e o botão de rearme."),
}, { palavras: "campainha besouro quadro de chamadas alvos transformador 8 V" });

export const PORTEIRO = arvore("videoporteiro", G, "Porteiro ou videoporteiro não funciona", "Não se ouve, não há imagem, o trinco não abre.", "o_que", {
  o_que: esc("O que falha?", REF.m18_2, [
    ["Nada funciona (nem chamada, nem som, nem imagem)", "fonte"],
    ["O trinco não abre", "trinco"],
    ["Só um posto interior falha", "bus"],
  ]),
  fonte: sn("A fonte de alimentação do sistema tem 230 V à entrada e a tensão do fabricante à saída?", REF.m18_2, "bus", "fim_fonte", { tensao: true }),
  bus: sn("O bus (2 fios) e os cabos estão em tubagem própria, separada da energia, com a secção e o comprimento máximo do fabricante?", REF.m18_2, "fim_posto", "fim_cabo"),
  trinco: sn("Ao abrir, chega tensão ao trinco elétrico (normalmente 12 V CA da fonte do sistema)?", REF.m18_2, "fim_trinco", "fim_comando_trinco", { tensao: true }),
  fim_fonte: fim("aberto", REF.m18_2, "Fonte do porteiro sem alimentação ou avariada.", "Verificar o circuito que alimenta a fonte e substituí-la se a saída estiver fora do indicado."),
  fim_cabo: fim("outro", REF.m18_2, "Cabo do porteiro fora das regras do fabricante ou junto de cabos de energia (interferências).", "Passar o cabo em tubagem própria, separada da energia, respeitando secção e comprimento."),
  fim_posto: fim("aberto", REF.m18_2, "Alimentação e bus bons: o posto interior (ou exterior) está avariado ou mal endereçado.", "Verificar o endereçamento e substituir o posto avariado."),
  fim_trinco: fim("aberto", REF.m18_2, "Chega tensão ao trinco mas não abre: trinco avariado ou preso mecanicamente.", "Substituir o trinco ou corrigir a fechadura."),
  fim_comando_trinco: fim("aberto", REF.m18_2, "Não chega tensão ao trinco: saída da fonte ou cabo do trinco.", "Verificar a saída do trinco na fonte e o cabo; substituir o que falhar."),
}, { palavras: "porteiro videoporteiro intercomunicador trinco bus 2 fios" });

export const ITED = arvore("ited", G, "Televisão ou rede de dados (ITED) sem sinal", "Tomada de TV ou de rede (RJ45) sem sinal, ATI sem energia.", "ati", {
  ati: sn("O ATI (armário de telecomunicações da fração) tem tomada de energia própria e o equipamento ligado está alimentado?", REF.m18_3b, "separacao", "fim_ati"),
  separacao: sn("As tubagens e caixas de telecomunicações estão separadas das de energia (distâncias do manual ITED nos cruzamentos e percursos paralelos)?", [REF.m18_3, REF.m18_3b], "terra", "fim_separacao"),
  terra: sn("O sistema de terras de telecomunicações está ligado ao terminal principal de terra do edifício?", REF.m18_3b, "fim_habilitado", "fim_terra"),
  fim_ati: fim("aberto", REF.m18_3b, "ATI sem tomada de energia própria ou sem alimentação.", "Instalar ou repor a tomada de energia junto ao ATI (circuito com diferencial)."),
  fim_separacao: fim("outro", REF.m18_3, "Telecomunicações a partilhar tubagens ou caixas com a energia.", "Separar segundo o Manual ITED; trabalho de instalador habilitado ITED."),
  fim_terra: fim("terra", REF.m18_3b, "Terras de telecomunicações sem ligação ao terminal principal de terra.", "Ligar ao terminal principal de terra do edifício."),
  fim_habilitado: fim("outro", REF.m18_3, "A parte elétrica do ITED está conforme: a avaria é da rede de telecomunicações (cabo, tomada, operador).", "Diagnóstico e reparação por instalador habilitado ITED (Manual ITED da ANACOM); a Domus Energia encaminha.", { parar: true }),
}, { palavras: "ITED ATI ATE televisão TV antena RJ45 fibra coaxial rede dados ANACOM" });

export const PARA_RAIOS = arvore("para-raios", G, "Para-raios (SPDA): verificação ou estragos depois de uma descarga", "Descarga atmosférica no edifício, aparelhos estragados, verificação do para-raios.", "dst1", {
  dst1: sn("O quadro de entrada tem DST de tipo 1 (obrigatório com SPDA) e equipotencialização entre o SPDA, o terminal principal de terra e as massas metálicas?", [REF.m18_4, REF.m11_7], "descidas", "fim_dst1", { ficha: { verificacao: "visual" } }),
  descidas: sn("Há pelo menos duas descidas, com percursos retos e sem curvas apertadas, e cada uma com o seu ligador de medição acessível acima do solo?", REF.m18_4, "terra_descida", "fim_descidas"),
  terra_descida: sn("A resistência de terra medida em cada descida (ligador aberto) está dentro do valor do projeto do SPDA?", REF.m18_4, "fim_ok", "fim_terra"),
  fim_dst1: fim("outro", [REF.m18_4, REF.m11_7], "SPDA sem DST de tipo 1 na instalação ou sem equipotencialização.", "Instalar DST tipo 1 (ou 1+2) no quadro de entrada e ligar o SPDA ao terminal principal de terra."),
  fim_descidas: fim("outro", REF.m18_4, "Descidas do SPDA insuficientes ou mal executadas.", "Corrigir segundo o projeto (EN 62305): o SPDA exige projeto e análise de risco.", { parar: true }),
  fim_terra: fim("terra", REF.m18_4, "Terra de uma descida acima do valor do projeto.", "Reforçar o elétrodo da descida (anel ou elétrodos ligados ao anel de fundação) e voltar a medir."),
  fim_ok: fim("outro", REF.m18_4, "SPDA com DST tipo 1, descidas e terras conformes.", "Registar; aparelhos estragados: verificar o DST e os aparelhos.", { seguir: "dst" }),
}, { palavras: "para-raios SPDA descarga atmosférica raio captor descida EN 62305" });

export const ARVORES_SINALIZACAO = [CAMPAINHA_ARV, PORTEIRO, ITED, PARA_RAIOS];
