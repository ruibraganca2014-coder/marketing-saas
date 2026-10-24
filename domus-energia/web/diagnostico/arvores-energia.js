// Árvores de diagnóstico — fotovoltaico, alimentação de socorro e qualidade da energia (ronda 2; manual de instalações
// BT, caps. 19 e 22). Formato em motor.js; atalhos em construir.js.
import { arvore, sn, esc, val, dado, fim, SEM_TENSAO } from "./construir.js";
import { REF, FATOR_POTENCIA } from "./limites.js";

const G = "Renováveis, socorro e qualidade da energia";
const CC = "Os módulos dão tensão sempre que há luz: abra o seccionador CC antes de mexer e nunca desligue conectores CC em carga.";

export const FV_CC = arvore("fotovoltaico-cc", G, "Fotovoltaico: lado CC (strings, fusíveis gPV, DST CC)", "Produção baixa ou nula, string sem tensão, fusível gPV fundido, conector queimado.", "seccionador", {
  seccionador: sn("Abriu o seccionador CC e confirmou com o multímetro em CC que não há tensão a jusante dele?", [REF.m19_1b, REF.b44], "conectores", "fim_parar", { fazer: CC }),
  conectores: sn("Os conectores CC são todos do mesmo fabricante, sem marcas de queimado, e o cabo é solar (H1Z2Z2-K) sem danos de UV?", REF.m19_1b, "vmax", "fim_conectores", { ficha: { verificacao: "visual" } }),
  vmax: dado("Tensão máxima de entrada do inversor (na placa)", REF.m19_2, "V", "Vmax", "string", { casas: 0, max: 2000 }),
  string: val("Tensão de circuito aberto da string em dia frio (n.º de módulos × Voc × 1,15)", REF.m19_2, "V", { max: { var: "Vmax" }, fonte: "Manual 19.2: n × Voc, mais 10–15 % em dias frios, abaixo da tensão máxima de entrada do inversor" }, "gpv", "fim_vmax", { casas: 0, max: 2000, fazer: "Calcule com o Voc da ficha do módulo (ex.: 7 × 39 V × 1,15 ≈ 314 V)." }),
  gpv: sn("Com várias strings em paralelo, os fusíveis gPV estão inteiros e com o calibre do fabricante?", [REF.m19_1b, REF.m10_2], "dst_cc", "fim_gpv"),
  dst_cc: sn("O quadro CC tem DST para corrente contínua com o indicador bom?", REF.m19_1b, "fim_seguir_inversor", "fim_dst_cc"),
  fim_parar: fim("outro", REF.m19_1b, "Lado CC com tensão: o disjuntor CA não a elimina e um arco em CC não se extingue sozinho.", "Parar; abrir o seccionador CC e, se não for possível, esperar pela noite ou chamar apoio.", { parar: true }),
  fim_conectores: fim("outro", REF.m19_1b, "Conectores misturados, queimados ou cabo danificado: risco de arco e incêndio.", "Substituir por conectores do mesmo fabricante e cabo solar; nunca misturar marcas."),
  fim_vmax: fim("sobrecarga", REF.m19_2, "String com tensão em dia frio acima da máxima do inversor.", "Reduzir o número de módulos por string (com projeto) para proteger o inversor."),
  fim_gpv: fim("curto", [REF.m19_1b, REF.m10_2], "Fusível gPV fundido ou de calibre errado.", "Procurar o defeito na string (isolamento CC, conector) antes de substituir pelo calibre do fabricante."),
  fim_dst_cc: fim("outro", REF.m19_1b, "DST CC em falta ou em fim de vida.", "Instalar ou substituir o DST para CC no quadro CC."),
  fim_seguir_inversor: fim("outro", REF.m19_1, "Lado CC conforme.", "Continuar com a árvore do inversor.", { seguir: "inversor-fv" }),
}, { palavras: "fotovoltaico solar painéis string gPV seccionador CC conectores H1Z2Z2" });

export const INVERSOR = arvore("inversor-fv", G, "Fotovoltaico: inversor não injeta ou desliga", "O inversor não liga à rede, desliga com frequência, ou o diferencial do circuito dispara.", "rede", {
  rede: sn("Há tensão da rede no circuito CA do inversor (o inversor desliga-se, bem, quando a rede falha — anti-ilhamento)?", REF.m19_1b, "circuito", "fim_seguir_rede", { tensao: true }),
  circuito: sn("O inversor tem circuito dedicado com disjuntor e diferencial do tipo indicado pelo fabricante (ex.: 3 kW → 13 A, 2,5 mm², 16 A)?", [REF.m19_1b, REF.m19_2], "registo", "fim_circuito", { ficha: { verificacao: "rcd" } }),
  registo: sn("A UPAC tem o registo exigido pela potência (≤ 700 W isenta; até 30 kW comunicação prévia à DGEG; acima, registo ou licença)?", REF.m19_3, "fim_fabricante", "fim_registo"),
  fim_seguir_rede: fim("outro", REF.m19_1b, "Sem rede no circuito do inversor: é por isso que não injeta.", "Seguir a árvore «Sem corrente» para o circuito do inversor.", { seguir: "sem-corrente" }),
  fim_circuito: fim("outro", REF.m19_1b, "Circuito do inversor partilhado ou com proteções de tipo errado.", "Instalar circuito dedicado com o disjuntor e o diferencial do tipo do fabricante."),
  fim_registo: fim("outro", REF.m19_3, "UPAC sem o procedimento do DL 15/2022 para a potência.", "Tratar do registo no portal da DGEG antes de pôr a injetar; avisar o cliente.", { parar: true }),
  fim_fabricante: fim("outro", REF.m19_1, "Instalação do inversor conforme: erro do próprio inversor.", "Ler o código de erro do fabricante (tensão de rede fora dos limites, isolamento CC, temperatura)."),
}, { palavras: "inversor UPAC autoconsumo injeção anti-ilhamento DGEG DL 15/2022" });

export const GERADOR = arvore("gerador", G, "Grupo gerador: comutação, potência ou ligação perigosa", "Gerador que não alimenta a casa, comutador sem encravamento, gerador ligado a uma tomada.", "ficha", {
  ficha: sn("O gerador está ligado à casa por uma tomada com ficha «macho-macho»?", REF.m22_1b, "fim_macho", "comutador"),
  comutador: sn("A comutação é por comutador I-0-II (ou inversor automático) com encravamento, cortando fases E neutro?", REF.m22_1, "diferenciais", "fim_comutador", { fazer: SEM_TENSAO }),
  diferenciais: sn("Os diferenciais estão a jusante do comutador (protegem com qualquer das fontes)?", REF.m22_1b, "motor_maior", "fim_diferenciais", { ficha: { verificacao: "rcd" } }),
  motor_maior: dado("Potência do maior motor a socorrer", REF.m22_1b, "kVA", "Pm", "potencia", { casas: 1, max: 10_000 }),
  potencia: val("Potência do gerador", REF.m22_1b, "kVA", { min: { var: "Pm", fator: 2 }, fonte: "Manual 22.1: na prática o gerador fica com 2 a 3 vezes a potência do maior motor" }, "fim_ok", "fim_potencia", { casas: 1, max: 10_000 }),
  fim_macho: fim("outro", REF.m22_1b, "Gerador ligado por ficha macho-macho: tensão nos pinos e risco de injetar na rede (risco de morte para quem trabalha nas linhas).", "Desligar já; instalar comutador I-0-II com encravamento.", { parar: true }),
  fim_comutador: fim("outro", REF.m22_1, "Comutação sem encravamento ou sem cortar o neutro: o gerador pode ficar em paralelo com a rede.", "Instalar comutador de três posições (ou ATS) com encravamento mecânico e elétrico, de 2 ou 4 polos.", { parar: true }),
  fim_diferenciais: fim("terra", REF.m22_1b, "Diferenciais a montante do comutador: com o gerador a instalação fica sem proteção.", "Passar os diferenciais para jusante do comutador; a ligação à terra do gerador segue o projeto."),
  fim_potencia: fim("sobrecarga", REF.m22_1b, "Gerador pequeno para o arranque dos motores (6 a 8 × In).", "Escolher um gerador com 2 a 3 vezes a potência do maior motor, ou arrancadores suaves."),
  fim_ok: fim("outro", REF.m22_1, "Gerador ligado com segurança e com potência adequada.", "Registar; instalação de tipo A acima de 3,45 kVA de socorro exige projeto."),
}, { palavras: "gerador grupo gerador socorro comutador I-0-II ATS macho-macho" });

export const UPS = arvore("ups", G, "UPS: autonomia curta ou não segura a carga", "A UPS não aguenta o tempo esperado ou corta quando falha a rede.", "tipo", {
  tipo: esc("Que UPS é?", REF.m22_2, [
    ["Off-line (stand-by)", "pedida"],
    ["Line-interactive", "pedida"],
    ["Online (dupla conversão)", "pedida"],
  ]),
  pedida: dado("Autonomia pedida pelo cliente", REF.m22_2, "h", "Tp", "medida", { casas: 2, max: 100 }),
  medida: val("Autonomia medida com a carga real (corte da rede)", REF.m22_2, "h", { min: { var: "Tp" }, fonte: "Manual 22.2: capacidade = P × t ÷ (U × rendimento) + cerca de 25 % de margem" }, "fim_ok", "fim_baterias", { casas: 2, max: 100 }),
  fim_baterias: fim("outro", REF.m22_2, "Baterias insuficientes ou envelhecidas para a autonomia pedida.", "Calcular Ah = P × t ÷ (U × rendimento) × 1,25 e substituir ou acrescentar baterias; confirmar com as curvas do fabricante."),
  fim_ok: fim("outro", REF.m22_2, "Autonomia dentro do pedido.", "Se a carga não tolera o corte de milissegundos de uma off-line, propor UPS online."),
}, { palavras: "UPS baterias autonomia online off-line servidor" });

export const FATOR_POTENCIA_ARV = arvore("fator-potencia", G, "Fator de potência baixo (energia reativa)", "Fatura com energia reativa, cabos quentes com motores, corrente alta para a potência.", "bte", {
  bte: sn("O cliente é BTE, MT ou AT (paga energia reativa acima de tg φ = 0,3 fora das horas de vazio)?", REF.m22_3, "cos", "fim_btn"),
  cos: val("Fator de potência medido (cos φ × 100)", REF.m22_3, "%", { ...FATOR_POTENCIA }, "sobre", "fim_compensar", { casas: 0, max: 100, tensao: true, fazer: "Analisador de energia ou pinça com medição de potência, com a carga habitual." }),
  sobre: sn("Com a carga baixa, a instalação fica capacitiva (condensadores fixos a mais)?", REF.m22_3, "fim_sobre", "fim_ok"),
  fim_btn: fim("outro", REF.m22_3, "Cliente doméstico em BTN: não paga energia reativa.", "Só compensar se houver motores que aqueçam cabos ou corrente excessiva; explicar ao cliente."),
  fim_compensar: fim("sobrecarga", REF.m22_3, "Fator de potência abaixo de 0,95.", "Calcular Qc = P × (tg φ − tg φ') e instalar bateria de condensadores (automática se a carga variar). Aguardar a descarga dos condensadores antes de tocar nos bornes."),
  fim_sobre: fim("outro", REF.m22_3, "Sobrecompensação: instalação capacitiva com carga baixa.", "Passar a bateria automática por escalões ou retirar escalões fixos."),
  fim_ok: fim("outro", REF.m22_3, "Fator de potência dentro do pretendido.", "Registar no relatório da intervenção."),
}, { palavras: "fator de potência cos φ reativa condensadores kvar" });

export const HARMONICOS = arvore("harmonicos", G, "Harmónicos: neutro quente ou disparos intempestivos", "Neutro que aquece, disparos sem causa, ruído em condensadores, equipamentos que falham.", "eletronica", {
  eletronica: sn("Há muita carga eletrónica (drivers LED, computadores, variadores, carregadores)?", REF.m22_4, "fase", "fim_outra"),
  fase: dado("Corrente na fase mais carregada (pinça true RMS)", REF.m22_4, "A", "If", "neutro", { casas: 1, max: 5000, tensao: true }),
  neutro: val("Corrente no neutro (pinça true RMS)", REF.m22_4, "A", { max: { var: "If" }, fonte: "Manual 22.4: os harmónicos de ordem 3 somam-se no neutro, que pode levar mais corrente do que as fases" }, "fim_ok", "fim_neutro", { casas: 1, max: 5000, tensao: true }),
  fim_outra: fim("outro", REF.m22_4, "Pouca carga eletrónica: os harmónicos não são a causa provável.", "Procurar outra causa (desequilíbrio, apertos).", { seguir: "desequilibrio-fases" }),
  fim_neutro: fim("sobrecarga", REF.m22_4, "Neutro com mais corrente do que a fase: harmónicos de ordem 3.", "Não reduzir a secção do neutro (sobredimensioná-lo); filtros passivos ou ativos; condensadores com reatâncias de bloqueio."),
  fim_ok: fim("outro", REF.m22_4, "Corrente no neutro abaixo da da fase.", "Registar; vigiar se a carga eletrónica aumentar."),
}, { palavras: "harmónicos neutro true RMS LED variadores 150 Hz" });

export const ARVORES_ENERGIA = [FV_CC, INVERSOR, GERADOR, UPS, FATOR_POTENCIA_ARV, HARMONICOS];
