// Simulador de orçamento — entrada pelas páginas de anúncio (web/carregador-carro.html, web/quadro-eletrico.html):
// `?servico=carregador|quadro-antigo` deixa o Início e o pedido já escolhidos. Só lógica, sem DOM.
// As páginas "Casa inteligente" e "Poupar energia" usam o `?pacote=` que já existe (app.js preEscolherPacote).
// Os parâmetros `utm_*` não são lidos nem mexidos aqui.

import { normalizarQuer, fasesSugeridas, pisosDaCasa } from "./estado.js";
import { QUADRO_SEGURO, acertarMelhorias } from "./melhorias.js";

const ENTRADAS = {
  /** Carregador de carro: obras ou automatizar, "Automatizar o que já tenho", com o carregador (7,4 kW) em Equipamentos, como Novo. */
  carregador(estado) {
    estado.funil = "primeira";
    estado.servico = ["automatizar"];
    // Como o passo Equipamentos ao marcar a máquina: 1 no r/c; o circuito dela (disjuntor de 40 A) sai do pedido.
    const porPiso = { ...estado.quer.porPiso, carregador_ve: { 0: 1 } };
    estado.quer = normalizarQuer({ ...estado.quer, porPiso }, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) });
    if (!estado.fasesEditadas) estado.casa.fases = fasesSugeridas(estado);
    // Ronda dinheiro: quem vem do anúncio quer um carregador NOVO — nasce "Novo" na planta (app.js marcarNovas) e a
    // linha dedicada (LINHA-DEDICADA-VE) conta no preço desde a primeira estimativa.
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
