// Árvores de diagnóstico — domótica e sistemas de segurança (ronda 2; manual de instalações BT, cap. 21).
// Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, fim } from "./construir.js";
import { REF, KNX_LINHA, KNX_TENSAO, DALI_LINHA } from "./limites.js";

const G = "Domótica e sistemas de segurança";

export const KNX = arvore("knx", G, "KNX: botões ou atuadores não respondem", "Uma linha KNX inteira não funciona, ou só alguns aparelhos.", "tensao", {
  tensao: val("Tensão do bus KNX num aparelho (par vermelho + / preto −)", REF.m21_2, "V", { ...KNX_TENSAO }, "aparelhos", "fim_tensao", { casas: 1, max: 100, fazer: "Multímetro em CC. Bus SELV: não o ligue à terra nem o junte a condutores de 230 V." }),
  aparelhos: val("Aparelhos na linha", REF.m21_2, "un.", { ...KNX_LINHA }, "programacao", "fim_aparelhos", { casas: 0, max: 1000 }),
  programacao: sn("Os aparelhos que falham respondem ao ETS (endereço físico programado) e os endereços de grupo estão certos?", REF.m21_2, "fim_atuador", "fim_ets"),
  fim_tensao: fim("aberto", [REF.m21_2, REF.m21_3a], "Tensão do bus fora do normal: fonte KNX avariada, curto-circuito ou polaridade trocada no bus.", "Verificar a fonte (cerca de 29 V CC com bobina) e procurar o curto ou a polaridade trocada (bloqueia a linha toda); identificar o bus nas caixas."),
  fim_aparelhos: fim("sobrecarga", REF.m21_2, "Linha com mais de 64 aparelhos para uma fonte normal.", "Dividir em linhas com acopladores (ou fonte reforçada segundo o fabricante)."),
  fim_ets: fim("outro", REF.m21_2, "Aparelho sem programação ou endereços de grupo errados.", "Reprogramar com o ETS (com o projeto KNX do cliente)."),
  fim_atuador: fim("aberto", REF.m21_2, "Bus e programação bons: atuador avariado ou carga a jusante.", "Verificar a saída do atuador no quadro e o circuito de 230 V da carga.", { seguir: "sem-corrente" }),
}, { palavras: "KNX bus ETS atuador sensor botoneira domótica" });

export const DALI = arvore("dali", G, "DALI: luminárias não regulam ou não respondem", "Luminárias DALI apagadas, a piscar, ou fora do grupo/cena.", "drivers", {
  drivers: val("Drivers na linha DALI", REF.m21_3a, "un.", { ...DALI_LINHA }, "barramento", "fim_drivers", { casas: 0, max: 1000 }),
  barramento: sn("Há tensão no barramento DALI (DA+ / DA−) e os dois condutores de comando estão inteiros até às luminárias?", REF.m21_3a, "grupos", "fim_barramento", { tensao: true, fazer: "O bus DALI não é SELV: pode seguir no cabo da alimentação (L, N, PE, DA+, DA−) — trate-o como 230 V." }),
  grupos: sn("A luminária responde ao endereçamento (até 16 grupos e 16 cenas) e não indica avaria?", REF.m21_3a, "fim_ok", "fim_driver"),
  fim_drivers: fim("sobrecarga", REF.m21_3a, "Mais de 64 drivers numa linha DALI.", "Dividir em mais linhas (outro controlador ou gateway)."),
  fim_barramento: fim("aberto", REF.m21_3a, "Barramento DALI sem tensão ou interrompido.", "Verificar a fonte do bus e a continuidade de DA+ e DA− (sem tensão)."),
  fim_driver: fim("outro", REF.m21_3a, "Driver da luminária avariado ou sem endereço.", "Substituir o driver e reendereçar na ferramenta do sistema."),
  fim_ok: fim("outro", REF.m21_3a, "Linha DALI conforme.", "Rever as cenas com o cliente; registar."),
}, { palavras: "DALI driver luminária regulação grupos cenas" });

export const VARIADOR_LED = arvore("variador-led", G, "Variador (regulador) de luz LED: tremulação, zumbido ou brilho residual", "Luzes LED que tremem, zumbem ou não apagam com variador sem bus.", "corte", {
  corte: sn("O tipo de corte do variador (início de fase / fim de fase) é o pedido pela lâmpada LED?", [REF.m21_3, REF.m20_2], "potencia", "fim_corte"),
  potencia: sn("A potência das lâmpadas está entre a mínima e a máxima do variador?", REF.m21_3, "fim_seguir_luzes", "fim_potencia"),
  fim_corte: fim("outro", REF.m21_3, "Variador com tipo de corte incompatível com a lâmpada LED.", "Trocar por variador (ou lâmpadas) compatível: leading edge / trailing edge."),
  fim_potencia: fim("outro", REF.m21_3, "Carga LED abaixo da mínima (ou acima da máxima) do variador.", "Ajustar a carga ou trocar o variador por um com a gama certa."),
  fim_seguir_luzes: fim("outro", REF.m20_2, "Variador compatível: a causa está na instalação (neutro solto, retorno induzido).", "Continuar com a árvore «Luzes a piscar ou fracas».", { seguir: "luzes" }),
}, { palavras: "variador regulador dimmer LED leading trailing edge" });

export const ALARMES = arvore("alarmes", G, "Alarme de intrusão ou deteção de incêndio (SADI)", "Central de alarme sem alimentação, avaria de bateria, deteção de incêndio em falha.", "sistema", {
  sistema: esc("Que sistema é?", REF.m21_5, [
    ["Intrusão (alarme)", "intrusao"],
    ["Deteção de incêndio (SADI)", "fim_sadi"],
    ["Videovigilância (CCTV)", "fim_cctv"],
  ]),
  intrusao: sn("A central está alimentada por circuito próprio, sem interruptor acessível, e a bateria está boa?", REF.m21_5, "central_receptora", "fim_alimentacao", { tensao: true }),
  central_receptora: sn("O sistema está ligado a uma central de receção de alarmes?", REF.m21_5, "fim_entidade", "fim_instalador"),
  fim_sadi: fim("outro", REF.m21_5, "Sistema de deteção de incêndio: instalação e manutenção por entidade registada na ANEPC, segundo o projeto SCIE.", "O eletricista só prepara a alimentação e as tubagens conforme o projeto; encaminhar.", { parar: true }),
  fim_cctv: fim("outro", REF.m21_5, "Videovigilância: cablagem estruturada (ITED) e regras de proteção de dados.", "Verificar a alimentação (PoE) e a cablagem.", { seguir: "ited" }),
  fim_alimentacao: fim("aberto", REF.m21_5, "Central sem circuito próprio, com interruptor acessível ou com bateria gasta.", "Alimentar a central por circuito próprio sem interruptor acessível e substituir a bateria."),
  fim_entidade: fim("outro", REF.m21_5, "Sistema ligado a central de receção: instalado por entidade autorizada para a segurança privada.", "Para além da alimentação, encaminhar para a entidade responsável.", { parar: true }),
  fim_instalador: fim("outro", REF.m21_5, "Alimentação conforme: a avaria é do sistema de alarme.", "Seguir as instruções do fabricante da central (detetores, sirenes, comunicador)."),
}, { palavras: "alarme intrusão incêndio SADI CCTV videovigilância central ANEPC" });

export const DOMOTICA_SEM_FIOS = arvore("domotica-sem-fios", G, "Domótica sem fios (rádio): aparelhos que não respondem", "Interruptores ou tomadas inteligentes (Zigbee, Wi-Fi…) que deixam de responder.", "alimentacao", {
  alimentacao: sn("O aparelho tem alimentação (fase e neutro no módulo, ou bateria carregada)?", REF.m21_1, "alcance", "fim_alimentacao", { tensao: true }),
  alcance: sn("O aparelho está ao alcance do sinal (perto de outros aparelhos da rede ou do repetidor) e a internet do cliente funciona?", REF.m21_1, "fim_app", "fim_alcance"),
  fim_alimentacao: fim("aberto", REF.m21_1, "Módulo sem alimentação (falta o neutro na caixa ou bateria gasta).", "Ligar o neutro ao módulo (se o modelo o exige) ou substituir a bateria.", { seguir: "sem-corrente" }),
  fim_alcance: fim("outro", REF.m21_1, "Sinal fraco ou rede do cliente em baixo.", "Aproximar um repetidor ou outro aparelho da rede; confirmar a internet."),
  fim_app: fim("outro", REF.m21_1, "Alimentação e sinal bons: configuração do aparelho na aplicação.", "Voltar a emparelhar o aparelho na aplicação da casa."),
}, { palavras: "domótica sem fios Zigbee Wi-Fi rádio interruptor inteligente" });

export const ARVORES_DOMOTICA = [KNX, DALI, VARIADOR_LED, ALARMES, DOMOTICA_SEM_FIOS];
