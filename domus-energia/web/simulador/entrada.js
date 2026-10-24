// Simulador de orçamento — entrada pelas páginas de anúncio (web/carregador-carro.html, web/quadro-eletrico.html):
// `?servico=carregador|quadro-antigo` deixa o Início e o pedido já escolhidos. Só lógica, sem DOM.
// As páginas "Casa inteligente" e "Poupar energia" usam o `?pacote=` que já existe (app.js preEscolherPacote).
// Os parâmetros `utm_*` não são lidos nem mexidos aqui.

import { QUADRO_SEGURO, acertarMelhorias } from "./melhorias.js";

const ENTRADAS = {
  /**
   * Carregador de carro (decisão do dono, 2026-10-24): o carregador é NOVO — não entra em "Equipamentos" (o que a casa
   * já tem). Segue para "Pedir um serviço" → "Obras ou instalação nova" (`servicoDepois`; sem casa descrita, descreve-a
   * primeiro e volta lá), onde o carregador aparece na planta como Novo (casa.js porMaquinaNova; app.js
   * escolherCaminho) e a linha dedicada (LINHA-DEDICADA-VE) conta no preço.
   */
  carregador(estado) {
    estado.funil = "primeira";
    estado.servicoDepois = "obras";
    estado.maquinasNovas = ["carregador_ve"];
  },
  /** Quadro antigo: "Automatizar o que já tenho", "Melhorar o quadro? Sim" e o pacote "Quadro seguro". */
  "quadro-antigo"(estado) {
    estado.funil = "primeira";
    estado.servico = ["automatizar"];
    estado.mexerQuadro = true;
    if (!estado.melhorias.aceites.length) {
      estado.melhorias.aceites = [QUADRO_SEGURO];
      acertarMelhorias(estado);
    }
  },
};

/**
 * Aplica `?servico=` a um estado sem simulação em curso (quem chama garante isso). Valores desconhecidos são
 * ignorados. Devolve true se mudou o estado.
 */
export function aplicarEntrada(estado, params) {
  const k = params.get("servico");
  if (!k || !Object.hasOwn(ENTRADAS, k) || estado.funil) return false;
  ENTRADAS[k](estado);
  return true;
}
