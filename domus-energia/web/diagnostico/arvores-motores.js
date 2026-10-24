// Árvores de diagnóstico — força motriz e automatismos (ronda 2; manual de instalações BT, caps. 11.3, 17 e 21.4).
// Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, fim, SEM_TENSAO } from "./construir.js";
import { REF } from "./limites.js";

const G = "Motores e automatismos";

export const ESTRELA_TRIANGULO = arvore("estrela-triangulo", G, "Arranque estrela-triângulo não passa a triângulo ou dispara", "O motor arranca em estrela e não passa a triângulo, ou dispara na passagem.", "placa", {
  placa: sn("A tensão de triângulo da placa do motor é igual à da rede (ex.: placa 400/690 V em rede de 400 V)?", REF.m17_3, "tempo", "fim_placa", { fazer: "O estrela-triângulo só serve para motores cuja tensão de triângulo é a da rede." }),
  tempo: val("Tempo de passagem regulado", REF.m17_3, "ms", { entre: [5000, 10_000], fonte: "Manual 17.3: o temporizador abre KM2 e fecha KM3 ao fim de 5 a 10 s" }, "encravamento", "fim_tempo", { casas: 0, max: 120_000 }),
  encravamento: sn("KM2 (estrela) e KM3 (triângulo) estão encravados e nunca fecham ao mesmo tempo?", REF.m17_3, "fim_contactores", "fim_encravamento", { fazer: `${SEM_TENSAO} Verifique os contactos auxiliares de encravamento.` }),
  fim_placa: fim("outro", REF.m17_3, "Motor com tensão de triângulo diferente da rede: não pode arrancar em estrela-triângulo.", "Usar arranque direto (se permitido), arrancador suave ou variador."),
  fim_tempo: fim("sobrecarga", REF.m17_3, "Tempo de passagem fora de 5–10 s: o motor passa a triângulo cedo demais (pico de corrente) ou tarde demais.", "Regular o temporizador para 5–10 s, conforme a carga, e ensaiar."),
  fim_encravamento: fim("curto", REF.m17_3, "Sem encravamento entre estrela e triângulo: curto-circuito na passagem.", "Repor o encravamento elétrico (contactos NF cruzados) e, se existir, o mecânico; ensaiar.", { parar: true }),
  fim_contactores: fim("aberto", REF.m17_3, "Comando correto: contactor de triângulo (KM3) ou bobina avariados.", "Verificar a bobina e os contactos de KM3 e substituir o que falhar.", { seguir: "motor" }),
}, { palavras: "estrela triângulo KM2 KM3 temporizador arranque" });

export const INVERSAO = arvore("inversao-marcha", G, "Inversão de marcha não funciona ou dispara", "O motor não inverte, ou dispara ao inverter (portões, guinchos, máquinas).", "encravamento", {
  encravamento: sn("KM1 (frente) e KM2 (trás) têm encravamento elétrico e mecânico e nunca fecham ao mesmo tempo?", REF.m17_3b, "troca", "fim_encravamento", { fazer: SEM_TENSAO }),
  troca: sn("KM2 troca duas fases em relação a KM1?", REF.m17_3b, "fim_comando", "fim_troca"),
  fim_encravamento: fim("curto", REF.m17_3b, "Inversão sem encravamento: os dois contactores podem fechar juntos (curto-circuito entre fases).", "Repor o encravamento elétrico e mecânico antes de voltar a usar.", { parar: true }),
  fim_troca: fim("outro", REF.m17_3b, "Os dois contactores ligam as fases pela mesma ordem: o motor não inverte.", "Sem tensão, trocar duas fases na saída de KM2 e ensaiar os dois sentidos."),
  fim_comando: fim("aberto", REF.m17_3b, "Potência correta: a avaria está no comando (botões, fins de curso, autorretenção).", "Verificar o circuito de comando.", { seguir: "motor" }),
}, { palavras: "inversão marcha KM1 KM2 frente trás portão" });

export const VARIADOR = arvore("variador", G, "Variador de frequência: diferencial dispara ou avaria", "Diferencial dispara com o variador (bomba de calor, máquina inverter, bomba), ou o variador dá erro.", "tipo_rede", {
  tipo_rede: esc("O variador é…", [REF.m17_3b, REF.m11_3b], [
    ["Monofásico (bombas de calor, máquinas inverter)", "dif_f"],
    ["Trifásico", "dif_b"],
  ]),
  dif_f: sn("O diferencial do circuito é do tipo F (ou B)?", [REF.m11_3b, REF.m17_3b], "cabo", "fim_dif_f", { ficha: { verificacao: "rcd" } }),
  dif_b: sn("O diferencial do circuito é do tipo B?", [REF.m11_3b, REF.m17_3b], "cabo", "fim_dif_b", { ficha: { verificacao: "rcd" } }),
  cabo: sn("O cabo do variador ao motor é blindado, com a blindagem ligada à terra nas duas pontas?", REF.m17_3b, "fim_fabricante", "fim_cabo"),
  fim_dif_f: fim("terra", REF.m11_3b, "Diferencial inadequado para variador monofásico (tipo A/AC dispara intempestivamente ou fica cego).", "Instalar diferencial tipo F (ou B) e ensaiar."),
  fim_dif_b: fim("terra", REF.m11_3b, "Variador trifásico sem diferencial tipo B: uma fuga em CC lisa não é detetada.", "Instalar diferencial tipo B e ensaiar.", { parar: true }),
  fim_cabo: fim("outro", REF.m17_3b, "Cabo ao motor sem blindagem (ou mal ligada): fugas e interferências.", "Substituir por cabo blindado com a blindagem à terra nas duas pontas."),
  fim_fabricante: fim("outro", REF.m17_3b, "Instalação do variador conforme: erro do próprio variador.", "Ler o código de erro no manual do fabricante; não medir o isolamento do motor com o variador ligado."),
}, { palavras: "variador frequência inverter tipo F tipo B blindado bomba de calor" });

export const ARRANCADOR = arvore("arrancador-suave", G, "Arrancador suave (soft-starter) dispara ou não arranca", "O arrancador suave dá erro, o motor não arranca ou dispara no arranque.", "rampa", {
  rampa: sn("A rampa de arranque e a corrente limite estão reguladas para a carga (bomba, tapete)?", REF.m17_3b, "bypass", "fim_rampa"),
  bypass: sn("O contactor de bypass (se houver) fecha no fim do arranque?", REF.m17_3b, "fim_motor", "fim_bypass", { tensao: true }),
  fim_rampa: fim("sobrecarga", REF.m17_3b, "Rampa ou corrente limite mal reguladas: o arranque não chega ao fim ou dispara.", "Regular segundo o fabricante e a carga e ensaiar o arranque."),
  fim_bypass: fim("aberto", REF.m17_3b, "Bypass do arrancador não fecha: o arrancador aquece e dispara.", "Verificar a bobina e o comando do contactor de bypass."),
  fim_motor: fim("outro", REF.m17_3b, "Arrancador bem regulado: verificar o motor e a alimentação.", "Seguir a árvore do motor.", { seguir: "motor" }),
}, { palavras: "arrancador suave soft-starter rampa bypass" });

export const RELE_PROGRAMAVEL = arvore("rele-programavel", G, "Relé programável ou autómato (PLC): saída não atua", "Um automatismo com relé programável não faz o que devia (rega, iluminação, bomba, portão).", "entrada", {
  entrada: sn("Ao atuar o botão ou o sensor, a entrada (I) correspondente acende no relé (ou no ecrã de diagnóstico)?", REF.m21_4, "saida", "fim_entrada", { tensao: true }),
  saida: sn("A saída (Q) acende quando o programa a devia ligar?", REF.m21_4, "carga", "fim_programa"),
  carga: sn("A corrente da carga está dentro do limite da saída (senão, a saída comanda um contactor)?", REF.m21_4, "seguranca", "fim_carga"),
  seguranca: sn("As paragens de emergência, os térmicos e os encravamentos de segurança atuam por fio, diretamente no circuito (não só no programa)?", REF.m21_4b, "fim_cablagem", "fim_seguranca"),
  fim_entrada: fim("aberto", REF.m21_4, "A entrada não recebe o sinal: botão, sensor ou cablagem da entrada.", "Verificar o botão/sensor e a continuidade até ao borne da entrada; ver a tensão das entradas do fabricante."),
  fim_programa: fim("outro", REF.m21_4, "A entrada chega mas o programa não liga a saída.", "Rever o programa (ladder ou blocos de funções) com quem o fez; guardar uma cópia antes de alterar."),
  fim_carga: fim("sobrecarga", REF.m21_4, "Carga acima do limite da saída do relé.", "Comandar a carga por um contactor; substituir a saída se estiver queimada."),
  fim_seguranca: fim("outro", REF.m21_4b, "Funções de segurança dependentes só do programa.", "Cablar a paragem de emergência, os térmicos e os encravamentos diretamente no circuito.", { parar: true }),
  fim_cablagem: fim("aberto", REF.m21_4, "Programa e saída corretos: a falha está a jusante (contactor, carga, cablagem).", "Verificar o contactor e a carga.", { seguir: "motor" }),
}, { palavras: "relé programável autómato PLC ladder entradas saídas automatismo" });

export const ARVORES_MOTORES = [ESTRELA_TRIANGULO, INVERSAO, VARIADOR, ARRANCADOR, RELE_PROGRAMAVEL];
