// Simulador de orçamento — estado, gravação no navegador e corpo do pedido
// (docs/SIMULADOR-ORCAMENTO.md §1, §2.1, §6). Só lógica, sem DOM.

import {
  ESCALA_CM, MAX_DIVISOES, MAX_ELEMENTOS, MAX_LADO_CM, AMPERES, TIPOS_CIRCUITO, TIPOS_CASA, ELEMENTOS, MODELOS, POTENCIAS_KVA, FASES,
  TIPOLOGIAS, LIMITES_CASA, EXTRAS_CASA, MAQUINAS_QUER, PEQUENAS_QUER, OBJETIVOS, NOME_FORA,
  plantaVazia, plantaTemConteudo, atualizarDivisoes, avisosQuadro, divisaoVazia, circuitoVazio, validarPontos, definirPontos,
  perfilCasa, maquinasGrandesDe, maquinasPequenasDe, objetivosDe, sugerirFases, codigoCircuito, seccaoCabo,
  TIPOS_COM_PISOS, MAX_PISO, ALTURA_MAX_CM, pisoDe, alturaTipica, temPergunta, porResponderAntigo, FIM_AVISO, FIM_AVISO_FORA,
  comandoDe, caixasDe,
} from "./regras.js";
import { SKU_SY1, SKU_SY2, quadroNoPedido } from "./preco.js";
import { ACOES, MAX_AVARIA, normalizarServico, temAcao, acaoDe, contarAcoes, pedidosDoElemento, perguntaInteligente } from "./acoes.js";
import { divisoesDaCasa, quartosDe, casasBanhoOmissao, salasOmissao, AREA_OMISSAO, ESPACOS_OMISSAO, nomeEscadas, pisoTipicoMaquina, assinaturaCasa, acertarPisos, tipoDivisao, LIMITES_OUTRAS } from "./casa.js";
import { quadroOmissao, normalizarProtecoes, resumoQuadro, avisosProtecoes, levaQuadroNovo, TAMANHO_PARCIAL } from "./quadro.js";
import { melhoriasNovas, normalizarMelhorias, instaladoDe, normalizarInstalado } from "./melhorias.js";

export const VERSAO = 1;
export const CHAVE = "domus.simulador";
export const CHAVE_CODIGO = "domus.simulador.codigo";   // sessionStorage: código do cliente vindo da área de cliente
export const MAX_SIMULACAO = 1024 * 1024;                // bytes (painel/src/validar.js)
export const MAX_IMAGEM = 700 * 1024;                    // data URL da imagem de fundo
/**
 * Os passos (lote 6: a planta está ao lado de todos os passos; lote 7: o passo "Serviço" entra antes de "A casa";
 * lote 8: "Planta" depois de "Equipamentos", o "Quadro elétrico" antes das "Divisões" e "Trocar e reparar" entre as
 * divisões e o resumo). Funis (fase 1): o passo 1 passa a "Início" (o caso do cliente e, na primeira vez, o serviço),
 * "Resumo e preço" passa a "Orçamento" e entra o passo "Avaria" (índice 9, só no funil da avaria rápida). Cada funil
 * usa só alguns passos, por esta ordem (FUNIS). Fase 2: o passo "Melhorias" (índice 10, no fim da lista para os índices
 * de antes não mudarem) fica entre "Trocar e reparar" e o Orçamento (ORDEM_PASSOS). Ronda A: entram o "Relatório básico"
 * (11, grátis, depois da Planta) e o "Relatório completo" (12, depois das Melhorias); a Planta passa para depois das
 * Divisões.
 */
export const PASSOS = ["Início", "A casa", "Equipamentos", "Planta", "Quadro elétrico", "Divisões", "Trocar e reparar", "Orçamento", "Enviar", "Avaria", "Melhorias", "Relatório básico", "Relatório completo"];
/** Índices dos passos (os mesmos ids `passo-N` da página). */
export const PASSO = { inicio: 0, casa: 1, quer: 2, planta: 3, quadro: 4, divisoes: 5, trocar: 6, preco: 7, enviar: 8, avaria: 9, melhorias: 10, relatorio: 11, completo: 12 };
/**
 * Os passos pela ordem em que se fazem (a Avaria, só do seu funil, no fim): o "mais adiantado" (`visitado`) e "já lá
 * chegou" comparam-se por esta ordem, não pelo índice.
 */
export const ORDEM_PASSOS = [0, 1, 2, 5, 3, 4, 11, 6, 10, 12, 7, 8, 9];
export const ordemPasso = (i) => ORDEM_PASSOS.indexOf(i);
/** O mais adiantado de vários passos (por ORDEM_PASSOS). */
export const maisAdiantado = (...l) => l.reduce((a, b) => (ordemPasso(b) > ordemPasso(a) ? b : a));
/**
 * Funis (fase 1, decisões do dono): o caso escolhido no Início. `passos` pela ordem da barra; `minutos` de cada passo
 * (só para o cliente saber quanto falta). Primeira vez ~14 min (o Quadro é só a foto: ~1 min); já tenho planta ~6 min; avaria ~2 min. Fase 2: as
 * Melhorias (~1 min) antes do Orçamento na primeira vez e no "Já tenho a planta". Ronda A: os dois relatórios.
 */
export const FUNIS = {
  primeira: { nome: "Obras ou automatizar a casa", passos: [0, 1, 2, 5, 3, 4, 11, 6, 10, 12, 7, 8], minutos: { 0: 1, 1: 1, 2: 2, 5: 1, 3: 2, 4: 1, 11: 0.5, 6: 2, 10: 1, 12: 0.5, 7: 1, 8: 1 } },
  planta: { nome: "Já tenho a planta", passos: [0, 6, 10, 12, 7, 8], minutos: { 0: 0.5, 6: 2, 10: 1, 12: 0.5, 7: 0.5, 8: 1 } },
  avaria: { nome: "Tenho uma avaria", passos: [0, 9, 8], minutos: { 0: 0.5, 9: 1, 8: 0.5 } },
};
export const CHAVES_FUNIL = Object.keys(FUNIS);
/** Os passos do funil (sem funil escolhido, os da primeira vez). */
export const passosDoFunil = (funil) => (FUNIS[funil] ?? FUNIS.primeira).passos;
/**
 * Divisão a divisão (decisão do dono): nos passos com um separador por divisão (Divisões e Trocar e reparar) o
 * "Seguinte" passa primeiro por cada divisão ainda por ver. `vistas[passo]`: as divisões (da planta) cujo separador
 * já se abriu nesse passo, pela chave id + nome (uma divisão nova, ou outra divisão com esse id numa planta
 * redesenhada, fica por ver). `vistasLivres`: passos que um estado de antes desta regra já tinha passado (não prendem).
 */
export const PASSOS_POR_DIVISAO = ["divisoes", "trocar"];
export const chaveVista = (d) => `${d.id}:${String(d.nome ?? "").slice(0, 60)}`;
/** A divisão `d` já foi vista no passo `passo` ("divisoes" | "trocar")? */
export const divisaoVista = (e, passo, d) => !!e.vistas?.[passo]?.includes(chaveVista(d));
/** As divisões de `divisoes` (pela ordem dada) ainda por ver no passo; nenhuma num passo livre. */
export const divisoesPorVer = (e, passo, divisoes) => (e.vistasLivres?.includes(passo) ? [] : divisoes.filter((d) => !divisaoVista(e, passo, d)));
/** Marca `d` como vista no passo (fica só o das divisões que ainda existem, `divisoes`). Devolve true se mudou. */
export function marcarVista(e, passo, d, divisoes) {
  const antes = e.vistas?.[passo] ?? [];
  const existem = new Set(divisoes.map(chaveVista));
  const depois = [...new Set([...antes.filter((k) => existem.has(k)), chaveVista(d)])];
  if (depois.length === antes.length && depois.every((k, i) => k === antes[i])) return false;
  e.vistas = { ...e.vistas, [passo]: depois };
  return true;
}
/** Serviços do funil "Já tenho a planta": automatizar e reparar (a omissão dos aparelhos é Manter). */
export const SERVICO_PLANTA = ["automatizar", "reparar"];
/**
 * Ronda A: "Já tenho a planta" → "O que precisa?" (`estado.caminho`): automatizar ou reparações (funil "planta", com a
 * casa guardada e esse serviço), obras (a casa guardada no funil da primeira vez, a passar pela casa e pela planta) ou
 * carregar a planta (PDF ou foto como fundo, no funil da primeira vez). null = ainda não escolheu (ou outro caso).
 */
export const CAMINHOS = ["automatizar", "reparar", "obras", "carregar"];
/** Ronda A: os passos novos (Relatório básico e Relatório completo): um estado de antes deles não os viu (`relatoriosPorVer`). */
export const PASSOS_NOVOS = [11, 12];
/**
 * Avaria rápida (funil 3): onde, o que se passa, descrição (≤ 200) e foto obrigatória (chave FOTO_AVARIA). Vai no
 * pedido em `simulacao.avaria` = {onde, problema, descricao} (§6).
 */
export const AVARIA_ONDE = { sala: "Sala", cozinha: "Cozinha", quarto: "Quarto", casa_banho: "Casa de banho", exterior: "Exterior", quadro: "Quadro elétrico", outro: "Outro" };
export const AVARIA_PROBLEMA = { sem_corrente: "Tomada sem corrente", luz: "Luz não acende", disjuntor: "Disjuntor dispara", queimado: "Cheiro a queimado", faiscas: "Faz faíscas", choque: "Dá choque", outro: "Outro" };
/** Ronda A: problemas perigosos — o Início mostra logo "Desligue o disjuntor geral e contacte-nos já." */
export const AVARIA_PERIGO = ["queimado", "faiscas", "choque"];
/**
 * Desenhos de linha dos 7 problemas (caminhos SVG numa caixa 48×48, o mesmo traço dos cartões do Início; app.js
 * iconeDe): partilhados pelo Início, pelo passo Avaria e pelo "Quadro elétrico — Com problemas" em Trocar e reparar.
 */
export const ICONES_PROBLEMA = {
  sem_corrente: ["M10 10h28v28H10z", "M19 20v5M29 20v5", "M20 32h8"],
  luz: ["M24 6a11 11 0 0 0-6.5 19.9V31h13v-5.1A11 11 0 0 0 24 6z", "M19 36h10M21 41h6"],
  disjuntor: ["M14 6h20v36H14z", "M20 13h8v12h-8z", "M24 31v5"],
  queimado: ["M24 42c-7 0-11-5-11-11 0-7 6-10 6-17 4 3 7 7 7 11 2-2 3-4 3-6 4 4 6 8 6 12 0 6-4 11-11 11z"],
  faiscas: ["M24 6v8M24 34v8M6 24h8M34 24h8M11 11l6 6M31 31l6 6M37 11l-6 6M17 31l-6 6"],
  choque: ["M26 6 12 27h10l-3 15 16-22H24z"],
  outro: ["M18 18a6 6 0 1 1 9 5c-2 1-3 2-3 4v2", "M24 35v.5"],
};
export const FOTO_AVARIA = "avaria:foto";
/** Fotos da avaria (até 5; a 1.ª é obrigatória): "avaria:foto", "avaria:foto_2"… "avaria:foto_5". */
export const FOTOS_AVARIA = [FOTO_AVARIA, "avaria:foto_2", "avaria:foto_3", "avaria:foto_4", "avaria:foto_5"];
/**
 * Ordem dos passos gravada no estado (`ordem`: 9 = a de PASSOS, com o Início e a Avaria).
 * Os estados antigos são migrados ao carregar; cada lista dá, para o passo antigo, o passo novo (quem estava no
 * passo "Planta" passa às Divisões — a planta está por cima delas):
 * - sem `passos` (6 passos, antes de "O que quer"): casa, planta, quadro, divisões, preço, enviar;
 * - `passos: 7` sem `ordem`: casa, o que quer, planta, quadro, divisões, preço, enviar;
 * - `ordem: 2` (versão de testes, nunca publicada): casa, o que quer, divisões, planta, quadro, preço, enviar;
 * - `ordem: 3` (7 passos): casa, equipamentos, planta, divisões, quadro, preço, enviar;
 * - `ordem: 4` (6 passos, antes do "Serviço"): casa, equipamentos, divisões, quadro, preço, enviar — tudo +1;
 * - `ordem: 5` (7 passos, antes de "Trocar e reparar"): serviço, casa, equipamentos, divisões, quadro, preço, enviar;
 * - `ordem: 6` (8 passos, antes do passo "Planta"): serviço, casa, equipamentos, divisões, quadro, trocar e reparar,
 *   preço, enviar;
 * - `ordem: 7` (9 passos com as divisões antes do quadro; só existiu em testes);
 * - `ordem: 8` (9 passos, antes dos funis): os mesmos índices (o "Serviço" passa a "Início").
 * Lote 8: cada passo vai para o seu equivalente (quem estava no Quadro ou nas Divisões fica nele; o resumo e o enviar
 * avançam); o antigo passo "Planta" (6 e 7 passos; ordem 2 e 3) volta a ser o passo Planta. As ações já escolhidas
 * nas Divisões ficam nos aparelhos. Os estados sem `servico` ficam com "Instalação nova" (tudo Novo: o mesmo preço).
 * Funis: os estados antigos ficam no funil da primeira vez (quem estava no Serviço sem nada escolhido fica no Início
 * sem funil).
 * - `ordem: 9` (10 passos, antes das Melhorias): os mesmos índices (as Melhorias acrescentaram o 10) — carrega-se como os
 *   de agora; quem estava no Orçamento pode voltar às Melhorias pela barra (ORDEM_PASSOS).
 * - `ordem: 10` (11 passos, antes dos relatórios; a Planta a seguir aos Equipamentos): os mesmos índices, mas a ordem
 *   mudou — reordenar() (os relatórios ficam por ver; quem estava para lá do primeiro passo por ver volta a ele).
 */
export const ORDEM = 12;
/** Até à ordem 10: a ordem dos passos e os passos de cada funil (antes dos relatórios; a Planta depois dos Equipamentos). */
const ORDEM_10 = [0, 1, 2, 3, 4, 5, 6, 10, 7, 8, 9];
const FUNIS_10 = { primeira: [0, 1, 2, 3, 4, 5, 6, 10, 7, 8], planta: [0, 6, 10, 7, 8], avaria: [0, 9, 8] };
/** Ordem 11 (ronda A): o Quadro antes das Divisões e da Planta. */
const ORDEM_11 = [0, 1, 2, 4, 5, 3, 11, 6, 10, 12, 7, 8, 9];
const FUNIS_11 = { primeira: [0, 1, 2, 4, 5, 3, 11, 6, 10, 12, 7, 8], planta: [0, 6, 10, 12, 7, 8], avaria: [0, 9, 8] };
/**
 * Ronda A: um estado de antes (ordem ≤ 10; `e.passo` e `e.visitado` com os índices de agora, pela ordem de então) passa
 * à ordem de agora. Vistos: os passos até ao mais adiantado de então. O mais adiantado passa a ser o último da
 * sequência nova até onde está tudo visto (os relatórios, novos, não prendem, mas ficam por ver: relatoriosPorVer);
 * quem estava para lá do primeiro passo por ver (ex.: na Planta, que agora vem depois do Quadro e das Divisões) volta
 * a ele. Muda `e`.
 */
function reordenar(e, ordemAntes = ORDEM_10, funisAntes = FUNIS_10) {
  if (e.funil === "avaria" || !e.funil) return;
  const lim = ordemAntes.indexOf(e.visitado);
  const vistos = new Set(funisAntes[e.funil].filter((i) => ordemAntes.indexOf(i) <= lim));
  const seq = passosDoFunil(e.funil);
  let k = 0;
  while (k + 1 < seq.length && (vistos.has(seq[k + 1]) || PASSOS_NOVOS.includes(seq[k + 1]))) k++;
  while (k > 0 && PASSOS_NOVOS.includes(seq[k])) k--;
  if (ordemPasso(e.passo) > ordemPasso(seq[k])) e.passo = seq[Math.min(k + 1, seq.length - 1)];
  e.visitado = maisAdiantado(seq[k], e.passo);
  e.relatoriosPorVer = PASSOS_NOVOS.filter((i) => seq.includes(i) && ordemPasso(i) < ordemPasso(e.visitado));
}
const MIGRAR = {
  6: [1, 3, 4, 5, 7, 8], 7: [1, 2, 3, 4, 5, 7, 8], ordem2: [1, 2, 5, 3, 4, 7, 8], ordem3: [1, 2, 3, 5, 4, 7, 8],
  ordem4: [1, 2, 5, 4, 7, 8], ordem5: [0, 1, 2, 5, 4, 7, 8], ordem6: [0, 1, 2, 5, 4, 6, 7, 8], ordem7: [0, 1, 2, 3, 5, 4, 6, 7, 8],
  ordem8: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};
/** Disponibilidade para a visita e urgência (passo Enviar, lote 8; §6 `visita`, `urgencia`). */
export const DIAS_VISITA = { seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta", sab: "Sábado" };
export const PERIODOS_VISITA = { manha: "Manhã", tarde: "Tarde", qualquer: "Qualquer" };
export const URGENCIAS = { normal: "Normal", semana: "Esta semana", urgente: "Urgente — avaria sem luz" };
export const SERVICO = "Simulador de orçamento";
export const SERVICO_CLIENTE = "Ampliar a instalação (simulador)";

// Os mesmos formatos que o painel aceita (painel/src/validar.js, pedidos.js, dados.js).
export const RE_TELEFONE = /^\+?[0-9 ()-]{6,30}$/;
export const RE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
export const RE_ID = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
export const RE_IMAGEM = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROLO_LINHA = /[\u0000-\u001f\u007f]/g;
const RE_ID_PLANTA = /^[A-Za-z0-9_-]{1,40}$/;
const CONTROLO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Potência contratada por omissão (kVA): a mais comum (não há "Não sei"). */
export const POTENCIA_OMISSAO_KVA = 6.9;

/**
 * Casa por omissão: tipo de imóvel e tipologia por escolher (decisão do dono: também no site, onde o "Seguinte"
 * do passo "A casa" pede para os escolher); 6,9 kVA e a ligação sugerida (monofásica). `area_m2` e `espacos` só contam em serviços e industrial. `localidade` já não
 * se pede no passo 1 (fica sempre ""): o local da obra é a localidade do contacto (passo "Enviar").
 */
/**
 * O que a planta que desenhámos a partir da casa mostra (decisão do dono: vai aparecendo): nada (passo "Serviço"),
 * só as divisões (passo "A casa") ou tudo — portas, interruptores, luzes, tomadas e máquinas (de "Equipamentos" em diante).
 */
export const FASES_PLANTA = ["vazia", "divisoes", "tudo"];

export function casaNova() {
  return {
    tipo: null, tipologia: null, quartos: null, casas_banho: 1, salas: 1, pisos: 1,
    // Nada marcado em "A casa tem…" (decisão do dono: nem o corredor; só o que o cliente escolher).
    extras: { jardim: false, exterior: false, garagem: false, arrecadacao: false, varanda: false, kitnet: false, entrada: false, corredor: false, escritorio: false, lavandaria: false, despensa: false },
    area_m2: null, espacos: null,
    porPiso: null,             // casas com 2 ou mais pisos: [{quartos, casas_banho, salas, extras}] por piso (casa.js acertarPisos)
    outras: [],                // "Outra divisão" de "A casa tem…": [{nome, qtd}] (ginásio, sótão…; casa.js nomesOutras)
    divisoes: null, localidade: "", potencia_contratada_kva: POTENCIA_OMISSAO_KVA, fases: "mono",
  };
}

/**
 * Estado inicial (o mesmo no site e na área de cliente: a casa por escolher; na área de cliente o passo
 * "A casa" é saltado e os dados da casa são opcionais).
 */
export function estadoNovo() {
  return {
    versao: VERSAO,
    passos: PASSOS.length,
    ordem: ORDEM,
    passo: 0,
    visitado: 0,               // passo mais adiantado a que o cliente já chegou
    funil: null,               // fase 1: primeira | planta | avaria (FUNIS); null = ainda no Início sem caso escolhido
    caminho: null,             // ronda A: "Já tenho a planta" → o que precisa (CAMINHOS); null = por escolher (ou outro caso)
    soCasa: false,             // só a casa guardada (sem simulação em curso): a da conta depois de enviar um pedido
    servico: [],               // Início, funil "primeira" (lote 7): nova, automatizar, reparar (acoes.js SERVICOS); pelo menos um
    mexerQuadro: false,        // sem "Instalação nova": o cliente quer melhorar o quadro (proteções / quadro novo)?
    quadroAvaria: null,        // lote 8 ("Trocar e reparar"): quadro com problemas → a descrição (ronda B: opcional, ""); null = sem problemas
    quadroProblemas: [],       // ronda B: o que se passa no quadro com problemas — chaves de AVARIA_PROBLEMA (os mesmos 7 cartões da avaria)
    guardado: null,
    pisosDesde0: true,         // pisos numerados a partir do r/c (0); os estados sem isto são migrados
    casa: casaNova(),
    fasesEditadas: false,      // o cliente escolheu a ligação: já não a sugerimos
    quer: { maquinas: [], pequenas: [], objetivos: [], quantidades: {}, porPiso: {} },
    planta: plantaVazia(),
    plantaSaltada: false,
    plantaAuto: false,         // a planta é a que desenhámos a partir das divisões e o cliente ainda não lhe mexeu
    plantaBase: null,          // assinaturaCasa() da casa e das máquinas com que a planta foi desenhada
    plantaFase: "vazia",       // o que a planta que desenhámos mostra (FASES_PLANTA; app.js fasePlanta)
    plantaSinc: null,          // o que a planta já tem da casa e das máquinas ({divisoes, maquinas, fase}; app.js sincAtual)
    // + pacote, proteções, para-raios, quadro novo (quadro.js). Ronda B: o esquema do quadro já não se faz no simulador
    // (`leitura`/`sugestoes` dos estados antigos caem em normalizarEstado); fica só a foto.
    quadro: { circuitos: [], disjuntor: SKU_SY2, ...quadroOmissao() },
    quadroEditado: false,     // o cliente mexeu no quadro: não recalcular sozinho
    divisoes: [],
    divisoesEditadas: false,  // o cliente mexeu na lista de divisões: não a refazemos sozinhos
    verificadas: [],           // ids das divisões (da planta) que o cliente marcou "Divisão verificada" (lote 5)
    vistas: { divisoes: [], trocar: [] },   // divisão a divisão: as divisões já vistas em cada passo (chaveVista)
    vistasLivres: [],          // passos que um estado de antes da regra "divisão a divisão" já tinha passado
    fotosId: null,             // liga as fotos guardadas no IndexedDB (fotos.js) a esta simulação
    extras: { central: false, termostatos: 0 },
    termostatosEditados: false, // o cliente mudou os termóstatos: o objetivo "aquecimento" já não os muda
    contacto: { nome: "", telefone: "", email: "", localidade: "", morada: "", mensagem: "" },
    visita: { dias: [], periodo: "qualquer" },   // lote 8 (passo Enviar): dias da semana e período; sem dias = qualquer dia
    urgencia: "normal",                           // lote 8: normal | semana | urgente (avaria sem luz)
    avaria: { onde: [], problema: [], descricao: "" },       // funil "avaria": listas de chaves (AVARIA_ONDE, AVARIA_PROBLEMA)
    melhorias: melhoriasNovas(),                             // fase 2 (melhorias.js): pacotes aceites; proteções do quadro de antes do "Quadro seguro"
    melhoriasPorVer: false,                                  // fase 2: estado de antes das Melhorias já para lá delas — a barra não as dá como feitas até lá ir
    relatoriosPorVer: [],                                    // ronda A: o mesmo para os relatórios (PASSOS_NOVOS) num estado de antes deles
    instalado: null,                                         // fase 2: o que o pedido da casa guardada já instala (melhorias.js instaladoDe)
    // Fase 3 (monetização): o que o cliente compra ao enviar — relatório pormenorizado e/ou visita técnica (nada: só o
    // relatório básico, grátis). Um só sítio: outro passo pode escolhê-lo antes; o passo Enviar mostra-o e muda-o.
    compras: { relatorio: false, visita: false },
  };
}

// ------------------------------------------------------------ normalização

const num = (v, min, max, omissao = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : omissao;
};
const int = (v, min, max, omissao = 0) => Math.round(num(v, min, max, omissao));
const txt = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v) => v === true;
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
/** "Outra divisão" de "A casa tem…" ([{nome, qtd}]; casa.js LIMITES_OUTRAS): nomes limpos (≤ 30 letras), qtd 1–10. */
const outrasDaCasa = (v) => lista(v, LIMITES_OUTRAS.linhas)
  .filter((o) => o && typeof o === "object")
  .map((o) => ({ nome: textoSeguro(o.nome, LIMITES_OUTRAS.nome), qtd: int(o.qtd, ...LIMITES_OUTRAS.qtd, 1) }));

/** Nome das escadas numeradas a partir de 1 (estados antigos) → a partir do r/c: "Escadas (piso 1)" → "Escadas (r/c)". */
const RE_ESCADAS_ANTIGAS = /^Escadas \(piso (\d+)\)$/;
export const renomearEscadas = (nome) => {
  const m = RE_ESCADAS_ANTIGAS.exec(String(nome ?? ""));
  return m ? nomeEscadas(Math.max(0, Number(m[1]) - 1)) : nome;
};

/**
 * Plantas guardadas antes dos pisos (`pisosAntigos`: sem `piso`, numerados a partir de 1): a planta desenhada
 * pela casa com vários pisos tinha cada piso num bloco abaixo do anterior (1 m entre eles) e "Escadas (piso
 * N)" em cada um. Cada bloco passa a um piso (0 = r/c), todos a começar no mesmo sítio da folha (como os
 * desenha agora plantaDaCasa), com os elementos de cada divisão; as escadas passam a "Escadas (r/c)",
 * "Escadas (piso 1)"… Se os blocos não baterem com as escadas (o cliente mexeu muito), fica tudo no r/c.
 * Muda `r` (já normalizada, com `divisao` calculada).
 */
function migrarPisos(r) {
  const escadas = r.divisoes.filter((d) => RE_ESCADAS_ANTIGAS.test(d.nome));
  for (const d of r.divisoes) d.nome = renomearEscadas(d.nome);
  if (escadas.length < 2) return;
  // Blocos: divisões que se tocam na vertical (as linhas de um piso encostam; entre pisos há um intervalo).
  const blocos = [];
  for (const d of [...r.divisoes].sort((a, b) => a.y_cm - b.y_cm)) {
    const b = blocos[blocos.length - 1];
    if (b && d.y_cm <= b.fim) { b.divs.push(d); b.fim = Math.max(b.fim, d.y_cm + d.altura_cm); } else blocos.push({ divs: [d], ini: d.y_cm, fim: d.y_cm + d.altura_cm });
  }
  if (blocos.length !== escadas.length || blocos.length > MAX_PISO + 1) return;
  const blocoDe = new Map();
  blocos.forEach((b, piso) => {
    const dy = blocos[0].ini - b.ini;
    for (const d of b.divs) {
      blocoDe.set(d.id, { piso, dy });
      d.piso = piso;
      d.y_cm += dy;
      if (d.pontos) d.pontos = d.pontos.map(([x, y]) => [x, y + dy]);
    }
  });
  for (const e of r.elementos) {
    // Elemento de uma divisão: vai com ela; solto: o bloco onde está (ou o mais próximo na vertical).
    let b = e.divisao ? blocoDe.get(e.divisao) : null;
    if (!b) {
      let k = 0, melhor = Infinity;
      blocos.forEach((x, i) => { const dist = e.y_cm < x.ini ? x.ini - e.y_cm : e.y_cm > x.fim ? e.y_cm - x.fim : 0; if (dist < melhor) { melhor = dist; k = i; } });
      b = { piso: k, dy: blocos[0].ini - blocos[k].ini };
    }
    e.piso = b.piso;
    e.y_cm = Math.max(0, e.y_cm + b.dy);
  }
  if (!r.fundo) {
    const fundo = Math.max(...r.divisoes.map((d) => d.y_cm + d.altura_cm), ...r.elementos.map((e) => e.y_cm));
    r.altura_cm = Math.max(100, Math.min(r.altura_cm, Math.ceil((fundo + ESCALA_CM) / ESCALA_CM) * ESCALA_CM));
  }
}

/** `pisosAntigos`: estado guardado antes dos pisos a partir do r/c (migrarPisos). */
export function normalizarPlanta(p, { pisosAntigos = false } = {}) {
  const r = plantaVazia();
  if (!p || typeof p !== "object") return r;
  r.largura_cm = int(p.largura_cm, 100, MAX_LADO_CM, 2000);
  r.altura_cm = int(p.altura_cm, 100, MAX_LADO_CM, 1500);
  if (p.tamanho_fixo === true) r.tamanho_fixo = true;   // o cliente escolheu o tamanho da folha
  const f = p.fundo;
  if (f && typeof f === "object" && typeof f.imagem === "string" && RE_IMAGEM.test(f.imagem) && f.imagem.length <= MAX_IMAGEM) {
    r.fundo = { imagem: f.imagem, x_cm: int(f.x_cm, -MAX_LADO_CM, MAX_LADO_CM), y_cm: int(f.y_cm, -MAX_LADO_CM, MAX_LADO_CM), largura_cm: int(f.largura_cm, 10, 2 * MAX_LADO_CM, r.largura_cm), opacidade: Math.round(num(f.opacidade, 0.1, 1, 0.5) * 100) / 100 };
  }
  // Detalhes do passo "Divisões": sem `respostas` (estado antigo) conta como respondido o que o cliente já mudou.
  const antigo = p.respostas !== true;
  const ids = new Set();
  const idOk = (id, pre) => typeof id === "string" && new RegExp(`^${pre}\\d{1,6}$`).test(id) && !ids.has(id);
  for (const d of lista(p.divisoes, MAX_DIVISOES)) {
    if (!d || typeof d !== "object" || !idOk(d.id, "d")) continue;
    ids.add(d.id);
    const n = { id: d.id, nome: txt(d.nome, 60), piso: pisoDe(d), x_cm: int(d.x_cm, 0, MAX_LADO_CM), y_cm: int(d.y_cm, 0, MAX_LADO_CM), largura_cm: int(d.largura_cm, 50, MAX_LADO_CM, 400), altura_cm: int(d.altura_cm, 50, MAX_LADO_CM, 300) };
    // Polígono (paredes oblíquas): 3–24 cantos dentro da planta, sem paredes cruzadas; senão fica o retângulo.
    // Com cantos válidos, a caixa envolvente passa a ser a deles (um retângulo "normal" fica sem `pontos`).
    const pts = d.pontos === undefined ? null : validarPontos(d.pontos, r.largura_cm, r.altura_cm);
    if (/^outra:\d{1,2}$/.test(d.origem)) n.origem = d.origem;   // "Outra divisão" de A casa tem… (casa.js outrasDaCasa)
    r.divisoes.push(pts ? definirPontos(n, pts) : n);
  }
  for (const e of lista(p.elementos, MAX_ELEMENTOS)) {
    if (!e || typeof e !== "object" || !idOk(e.id, "e") || !ELEMENTOS[e.tipo]) continue;
    ids.add(e.id);
    const n = { id: e.id, tipo: e.tipo, x_cm: int(e.x_cm, 0, MAX_LADO_CM), y_cm: int(e.y_cm, 0, MAX_LADO_CM), rot: [0, 90, 180, 270].includes(e.rot) ? e.rot : 0, piso: pisoDe(e), divisao: typeof e.divisao === "string" ? e.divisao.slice(0, 10) : null, props: normalizarProps(e.tipo, e.props) };
    // Opcionais (janela de edição): nome dado pelo cliente e altura ao chão (cm).
    const nome = txt(e.nome, 60).trim();
    if (nome) n.nome = nome;
    if (e.altura_cm !== undefined && e.altura_cm !== null && Number.isFinite(Number(e.altura_cm))) n.altura_cm = int(e.altura_cm, 0, ALTURA_MAX_CM);
    if (temPergunta(n.tipo, n.props) && (antigo ? porResponderAntigo(n.tipo, n.props) : e.por_responder === true)) n.por_responder = true;
    // Ação por aparelho (lote 7, acoes.js): a escolhida, a descrição da avaria e "por um inteligente?".
    if (temAcao(n.tipo, n.props)) {
      if (ACOES[e.acao]) n.acao = e.acao;
      const av = txt(e.avaria, MAX_AVARIA).replace(CONTROLO_LINHA, " ");
      if (av.trim()) n.avaria = av;
      if (typeof e.inteligente === "boolean" && perguntaInteligente(n.tipo)) n.inteligente = e.inteligente;
    }
    r.elementos.push(n);
  }
  // A divisão gravada fica enquanto o elemento ainda lá estiver (numa planta antiga com divisões sobrepostas a de
  // cima não lhe tira os aparelhos); senão, a que o contém (regras.js atualizarDivisoes).
  atualizarDivisoes(r, { manter: true });
  if (pisosAntigos) migrarPisos(r);
  return atualizarDivisoes(r, { manter: true });
}

/** Só as propriedades da tabela do §2 para cada tipo, com tipos certos. */
export function normalizarProps(tipo, p) {
  const o = ELEMENTOS[tipo]?.props ?? {};
  const v = p && typeof p === "object" ? p : {};
  const r = {};
  for (const k of Object.keys(o)) {
    if (k === "botoes") r.botoes = int(v.botoes, 1, 4, 1);
    else if (k === "comando") r.comando = comandoDe(v);   // ronda regras: estados antigos sem `comando` ficam "simples"
    else if (k === "modelo") r.modelo = MODELOS[v.modelo] ? v.modelo : o.modelo;
    else if (k === "potencia_w") r.potencia_w = int(v.potencia_w, 0, 100_000, MODELOS[r.modelo]?.w ?? o.potencia_w);
    else if (k === "caixas") r.caixas = caixasDe(v);   // ronda sinalizar: estados antigos só com `dupla` → 2
    else r[k] = bool(v[k]);
  }
  if (tipo === "tomada") r.dupla = r.caixas === 2;   // `dupla` segue `caixas` (compatibilidade)
  if (tipo === "janela" && !r.estore) r.motorizado = false;
  return r;
}

export function normalizarCircuito(c, i) {
  const b = circuitoVazio(i + 1);
  if (!c || typeof c !== "object") return b;
  const it = c.itens && typeof c.itens === "object" ? c.itens : {};
  return {
    n: i + 1,
    amperes: AMPERES.includes(c.amperes) ? c.amperes : 16,
    tipo: TIPOS_CIRCUITO[c.tipo] ? c.tipo : "misto",
    nome: txt(c.nome, 60),
    // "Fora das divisões" não é uma divisão (circuitos de estados antigos podiam trazê-la).
    divisoes: lista(c.divisoes, MAX_DIVISOES).filter((x) => typeof x === "string" && x !== NOME_FORA).map((x) => x.slice(0, 60)),
    itens: {
      luzes: int(it.luzes, 0, 99),
      tomadas: int(it.tomadas, 0, 99),
      maquinas: lista(it.maquinas, 20).filter((m) => m && typeof m === "object").map((m) => {
        const modelo = MODELOS[m.modelo] ? m.modelo : "outro";
        return { modelo, potencia_w: int(m.potencia_w, 0, 100_000, MODELOS[modelo].w) };
      }),
    },
    inteligente: bool(c.inteligente),
    medir: bool(c.medir),
    zona_humida: bool(c.zona_humida),   // tomadas de cozinha/casa de banho (RTIEBT C5)
    // Com quadros parciais: o piso do quadro onde fica o circuito (0 = r/c; quadro.js resumoQuadro).
    ...(c.piso !== undefined && c.piso !== null && Number.isFinite(Number(c.piso)) ? { piso: int(c.piso, 0, MAX_PISO) } : {}),
  };
}

export function normalizarDivisao(d) {
  const b = divisaoVazia();
  if (!d || typeof d !== "object") return b;
  return {
    nome: txt(d.nome, 60),
    planta_id: typeof d.planta_id === "string" ? d.planta_id.slice(0, 10) : null,
    piso: pisoDe(d),
    interruptores: lista(d.interruptores, 30).map((x) => int(x, 1, 4, 1)),
    estores: int(d.estores, 0, 99),
    estores_sem_motor: int(d.estores_sem_motor, 0, 99),
    sensores_porta: int(d.sensores_porta, 0, 99),
    sensores_movimento: int(d.sensores_movimento, 0, 99),
    luzes_regulaveis: 0,   // luzes sempre não reguláveis (decisão do dono); o campo fica no pedido (painel)
    tomadas_inteligentes: int(d.tomadas_inteligentes, 0, 99),
  };
}

/**
 * O que a planta mexida pelo cliente já tem da casa e das máquinas (app.js sincAtual; casa.js acertarPlantaMexida):
 * {divisoes: [{nome, piso}], maquinas: [{modelo, qtd, piso}], fase}; null se faltar ou vier estragado (estado antigo).
 */
function normalizarSinc(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.divisoes) || !Array.isArray(v.maquinas) || !FASES_PLANTA.includes(v.fase)) return null;
  return {
    divisoes: lista(v.divisoes, MAX_DIVISOES).filter((d) => d && typeof d.nome === "string").map((d) => ({ nome: d.nome.slice(0, 60), piso: int(d.piso, 0, MAX_PISO, 0) })),
    maquinas: lista(v.maquinas, 200).filter((m) => m && typeof m.modelo === "string").map((m) => ({ modelo: m.modelo.slice(0, 40), qtd: int(m.qtd, 0, 100, 1), piso: m.piso === null || m.piso === undefined ? null : int(m.piso, 0, MAX_PISO, 0) })),
    fase: v.fase,
  };
}

/** Estado lido do navegador (pode vir estragado ou de outra versão): sempre um estado válido. */
export function normalizarEstado(v) {
  const e = estadoNovo();
  if (!v || typeof v !== "object" || v.versao !== VERSAO) return null;
  // Estados antigos (6 passos; 7 passos com outra ordem): o passo antigo passa ao novo (MIGRAR);
  // o cliente pode voltar pela barra a qualquer passo que já tinha visto.
  // `ordem: 9` (antes das Melhorias) e `ordem: 10` (antes dos relatórios) têm os mesmos índices: carregam-se como um
  // estado de agora, pela ordem de então, e depois passam à de agora (reordenar).
  const deAgora = v.ordem === ORDEM && v.passos === PASSOS.length;
  const de11 = v.ordem === 11 && v.passos === PASSOS.length;   // ronda A: o Quadro ainda antes das Divisões e da Planta
  const atual = deAgora || de11 || (v.ordem === 10 && v.passos === 11) || (v.ordem === 9 && v.passos === 10);
  const migrar = atual ? null : v.ordem === 8 ? MIGRAR.ordem8 : v.ordem === 7 ? MIGRAR.ordem7 : v.ordem === 6 ? MIGRAR.ordem6 : v.ordem === 5 ? MIGRAR.ordem5 : v.ordem === 4 ? MIGRAR.ordem4 : v.passos !== 7 ? MIGRAR[6]
    : v.ordem === 2 ? MIGRAR.ordem2 : v.ordem === 3 ? MIGRAR.ordem3 : MIGRAR[7];
  // Serviço (lote 7): um estado de antes do passo "Serviço" fica com "Instalação nova" (tudo Novo: o mesmo preço).
  e.servico = normalizarServico(v.servico) ?? ["nova"];
  // Funis (fase 1): os estados antigos são todos da primeira vez; quem ficou no "Serviço" sem nada escolhido fica no
  // Início sem funil (escolhe o caso).
  if (migrar) {
    const passo = int(v.passo, 0, migrar.length - 2);   // nunca volta direto ao "Enviar"
    e.passo = migrar[passo];
    e.funil = e.passo > 0 || e.servico.length ? "primeira" : null;
    // Os 7 passos de antes (ordem 3 e 5), os 6 (ordem 4), os 8 (ordem 6) e os 9 (ordem 7 e 8) já guardavam o mais
    // adiantado; os outros contam o que estava antes do passo.
    const guardavaVisitado = [MIGRAR.ordem3, MIGRAR.ordem4, MIGRAR.ordem5, MIGRAR.ordem6, MIGRAR.ordem7, MIGRAR.ordem8].includes(migrar);
    e.visitado = guardavaVisitado ? Math.max(e.passo, migrar[int(v.visitado, 0, migrar.length - 2)]) : Math.max(...migrar.slice(0, passo + 1));
  } else {
    e.funil = FUNIS[v.funil] ? v.funil : null;
    let passo = int(v.passo, 0, PASSOS.length - 1);
    if (passo > 0 && !e.funil) e.funil = "primeira";
    const seq = deAgora ? passosDoFunil(e.funil) : (de11 ? FUNIS_11 : FUNIS_10)[e.funil ?? "primeira"];
    // Nunca volta direto ao "Enviar" (volta ao Orçamento; na avaria, ao passo Avaria); um passo fora do funil volta ao Início.
    if (passo === PASSO.enviar) passo = e.funil === "avaria" ? PASSO.avaria : PASSO.preco;
    if (!seq.includes(passo)) passo = 0;
    e.passo = passo;
    const vis = int(v.visitado, 0, PASSOS.length - 1);
    e.visitado = seq.includes(vis) && vis !== PASSO.enviar && seq.indexOf(vis) > seq.indexOf(passo) ? vis : passo;
  }
  e.caminho = CAMINHOS.includes(v.caminho) ? v.caminho : null;
  // Ordem 11 já guardava os relatórios por ver: mantêm-se esses (só os que ficaram para trás).
  if (de11) { reordenar(e, ORDEM_11, FUNIS_11); e.relatoriosPorVer = PASSOS_NOVOS.filter((i) => lista(v.relatoriosPorVer, 2).includes(i) && ordemPasso(i) < ordemPasso(e.visitado)); }
  else if (!deAgora) reordenar(e);
  else e.relatoriosPorVer = PASSOS_NOVOS.filter((i) => lista(v.relatoriosPorVer, 2).includes(i) && ordemPasso(i) < ordemPasso(e.visitado));
  // O caminho segue o funil: automatizar/reparar só no "Já tenho a planta"; obras/carregar só na primeira vez. Um
  // estado de antes, já para lá do Início no "Já tenho a planta", fica com o do serviço.
  if (e.funil === "planta" && !e.caminho && e.passo !== 0) e.caminho = e.servico.includes("automatizar") ? "automatizar" : "reparar";
  if (e.funil === "planta" ? !["automatizar", "reparar", null].includes(e.caminho) : e.funil === "primeira" ? !["obras", "carregar", null].includes(e.caminho) : true) e.caminho = null;
  const guardavaVisitado = !migrar || [MIGRAR.ordem3, MIGRAR.ordem4, MIGRAR.ordem5, MIGRAR.ordem6, MIGRAR.ordem7, MIGRAR.ordem8].includes(migrar);
  e.soCasa = bool(v.soCasa) && e.funil === null && e.passo === 0;
  e.avaria = normalizarAvaria(v.avaria);
  e.melhorias = normalizarMelhorias(v.melhorias);
  // Estados de antes das Melhorias (ordem ≤ 9) já para lá delas nunca as viram: a barra não as dá como feitas.
  const antesMelhorias = !deAgora && !(v.ordem === 10 && v.passos === 11);
  e.melhoriasPorVer = e.funil !== "avaria" && ordemPasso(e.visitado) > ordemPasso(PASSO.melhorias) && (antesMelhorias || bool(v.melhoriasPorVer));
  e.instalado = normalizarInstalado(v.instalado);
  e.mexerQuadro = bool(v.mexerQuadro);
  e.quadroAvaria = typeof v.quadroAvaria === "string" ? v.quadroAvaria.slice(0, MAX_AVARIA).replace(CONTROLO_LINHA, " ") : null;
  e.quadroProblemas = e.quadroAvaria === null ? [] : chavesAvaria(v.quadroProblemas, AVARIA_PROBLEMA);
  e.guardado = typeof v.guardado === "string" ? v.guardado.slice(0, 40) : null;
  // Antes dos pisos a partir do r/c (0): a planta, as escadas e as divisões são migradas (migrarPisos).
  const pisosAntigos = v.pisosDesde0 !== true;
  const c = v.casa && typeof v.casa === "object" ? v.casa : {};
  const x = c.extras && typeof c.extras === "object" ? c.extras : {};
  const tipologia = TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;   // estado antigo: sem tipologia
  const tipo = TIPOS_CASA[c.tipo] ? c.tipo : c.tipo === null ? null : "moradia";
  const perfil = perfilCasa(tipo);
  e.casa = {
    tipo,
    tipologia,
    quartos: tipologia === "T5+" ? int(c.quartos, 5, LIMITES_CASA.quartos[1], 5) : quartosDe({ tipologia }),
    casas_banho: int(c.casas_banho, ...LIMITES_CASA.casas_banho, casasBanhoOmissao(tipologia)),
    salas: int(c.salas, ...LIMITES_CASA.salas, salasOmissao(tipologia)),
    // Só as moradias têm mais de um piso.
    pisos: TIPOS_COM_PISOS.includes(tipo) ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1,
    // Estados guardados antes do botão "Corredor": o corredor seguia a tipologia (T2 e mais).
    extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, k === "corredor" && x[k] === undefined ? (quartosDe({ tipologia, quartos: c.quartos }) ?? 0) >= 2 : bool(x[k])])),
    area_m2: perfil === "habitacao" ? null : int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[perfil]),
    espacos: perfil === "habitacao" ? null : int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[perfil]),
    divisoes: c.divisoes == null || c.divisoes === "" ? null : int(c.divisoes, 1, 40, 1),
    localidade: "",   // estado antigo com localidade no passo 1: passa para o contacto (em baixo)
    // Estado antigo com "Não sei" (null): 6,9 kVA; a ligação fica a sugerida (em baixo).
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva) ?? POTENCIA_OMISSAO_KVA,
    fases: FASES[c.fases] ? c.fases : null,
    porPiso: Array.isArray(c.porPiso) ? c.porPiso : null,
    outras: outrasDaCasa(c.outras),   // estado antigo sem o campo: nenhuma
  };
  // Valores por piso (2 ou mais pisos); um estado sem eles fica com os da casa toda repartidos como antes
  // (casa.js repartirPisos com o escritório no r/c: a planta desenhada é a mesma).
  const semPorPiso = !Array.isArray(c.porPiso);
  acertarPisos(e.casa, { antigo: semPorPiso });
  // Estado antigo: uma ligação já escolhida conta como escolhida pelo cliente; "Não sei" continua sugerível.
  e.fasesEditadas = v.fasesEditadas === undefined ? e.casa.fases !== null : bool(v.fasesEditadas);
  // "O que quer" por piso (`porPiso`); um estado antigo ({quantidades, pisos} por máquina) passa a ter a
  // quantidade no piso escolhido, ou no típico (casa.js pisoTipicoMaquina).
  const vq = v.quer && typeof v.quer === "object" ? v.quer : {};
  const antigas = [...lista(vq.maquinas, 60), ...lista(vq.pequenas, 60)].filter((k) => typeof k === "string");
  e.quer = normalizarQuer(vq, tipo, { pisos: pisosDaCasa(e.casa), pisoTipico: (k) => pisoTipicoMaquina(e.casa, k, antigas) });
  if (e.casa.fases === null) { e.casa.fases = fasesSugeridas(e); e.fasesEditadas = false; }
  e.planta = normalizarPlanta(v.planta, { pisosAntigos });
  // Já não se salta a planta (está no topo de todos os passos): uma planta saltada num estado antigo volta a contar
  // (vazia, é desenhada a partir da casa).
  e.plantaSaltada = false;
  e.plantaAuto = bool(v.plantaAuto);
  // Planta que vai aparecendo (vazia → divisões → aparelhos); um estado de antes disto tinha-a sempre completa.
  e.plantaFase = FASES_PLANTA.includes(v.plantaFase) ? v.plantaFase : "tudo";
  e.plantaSinc = normalizarSinc(v.plantaSinc);
  // A assinatura de um estado antigo não se compara com a de agora (tem outros campos): fica sem base.
  // (Os 7 passos de antes, ordem 3, e os 6 da ordem 4 têm a assinatura de agora: só mudou a ordem dos passos.)
  e.plantaBase = guardavaVisitado && typeof v.plantaBase === "string" ? v.plantaBase.slice(0, 1000) : null;
  // "O que quer" ainda sem pisos, ou a casa ainda sem valores por piso: a assinatura guardada foi feita à maneira
  // antiga; se era a da casa e das máquinas de então, passa a ser a de agora (a planta não fica "desatualizada"
  // só pela migração).
  const querAntigo = !vq.porPiso || typeof vq.porPiso !== "object";
  if (e.plantaBase && (querAntigo || semPorPiso)) {
    const comPisos = pisosDaCasa(e.casa) > 1;
    const ps = vq.pisos && typeof vq.pisos === "object" ? vq.pisos : {};
    const qt = vq.quantidades && typeof vq.quantidades === "object" ? vq.quantidades : {};
    const velhas = querAntigo
      ? maquinasEscolhidas(normalizarQuer({ maquinas: vq.maquinas, pequenas: vq.pequenas }, tipo)).map((k) => ({ modelo: k, qtd: int(qt[k], 1, MAX_QUANTIDADE, 1), piso: comPisos && Number.isInteger(ps[k]) ? ps[k] : null }))
      : maquinasParaPlanta(e);
    const casaAntes = semPorPiso ? { ...e.casa, porPiso: null } : e.casa;
    if (e.plantaBase === assinaturaCasa(casaAntes, velhas)) e.plantaBase = assinaturaCasa(e.casa, maquinasParaPlanta(e));
  }
  const q = v.quadro && typeof v.quadro === "object" ? v.quadro : {};
  e.quadro = { circuitos: lista(q.circuitos, 60).map(normalizarCircuito), disjuntor: q.disjuntor === SKU_SY1 ? SKU_SY1 : SKU_SY2, ...normalizarProtecoes(q) };
  e.quadroEditado = bool(v.quadroEditado);
  // "Fora das divisões" (elementos fora de todas) não é uma divisão: estados antigos traziam-na na lista.
  e.divisoes = lista(v.divisoes, MAX_DIVISOES + 1).map(normalizarDivisao).filter((d) => !ehFora(d));
  if (pisosAntigos) {
    // As divisões e os circuitos seguem a planta: escadas renomeadas; o piso vem da divisão da planta
    // (ou, sem planta, do nome das escadas — as outras ficam no r/c).
    for (const c of e.quadro.circuitos) c.divisoes = c.divisoes.map(renomearEscadas);
    for (const d of e.divisoes) {
      const m = RE_ESCADAS_ANTIGAS.exec(d.nome);
      d.nome = renomearEscadas(d.nome);
      const daPlanta = d.planta_id ? e.planta.divisoes.find((x) => x.id === d.planta_id) : null;
      d.piso = daPlanta ? daPlanta.piso : m ? Math.min(MAX_PISO, Math.max(0, Number(m[1]) - 1)) : 0;
    }
  }
  e.divisoesEditadas = bool(v.divisoesEditadas);
  // Lote 5 (estados antigos: sem nenhuma verificada e sem fotos).
  e.verificadas = [...new Set(lista(v.verificadas, MAX_DIVISOES + 1).filter((x) => typeof x === "string" && RE_ID_PLANTA.test(x)))];
  // Divisão a divisão: estados de antes da regra ficam sem nenhuma vista, mas não prendem quem já passou do passo.
  const vs = v.vistas && typeof v.vistas === "object" ? v.vistas : null;
  for (const k of PASSOS_POR_DIVISAO) e.vistas[k] = [...new Set(lista(vs?.[k], MAX_DIVISOES + 1).filter((x) => typeof x === "string" && x.length <= 110))];
  e.vistasLivres = vs ? PASSOS_POR_DIVISAO.filter((k) => lista(v.vistasLivres, 2).includes(k))
    : PASSOS_POR_DIVISAO.filter((k) => ordemPasso(e.visitado) > ordemPasso(PASSO[k]));
  e.fotosId = typeof v.fotosId === "string" && /^[a-f0-9]{8,40}$/.test(v.fotosId) ? v.fotosId : null;
  const ex = v.extras && typeof v.extras === "object" ? v.extras : {};
  e.extras = { central: bool(ex.central), termostatos: int(ex.termostatos, 0, 20) };
  // Estado antigo: termóstatos já escolhidos contam como mexidos (o objetivo "aquecimento" não os apaga).
  e.termostatosEditados = v.termostatosEditados === undefined ? e.extras.termostatos > 0 : bool(v.termostatosEditados);
  const k = v.contacto && typeof v.contacto === "object" ? v.contacto : {};
  e.contacto = { nome: txt(k.nome, 120), telefone: txt(k.telefone, 30), email: txt(k.email, 254), localidade: txt(k.localidade, 80), morada: txt(k.morada, 200), mensagem: txt(k.mensagem, 2000) };
  if (!e.contacto.localidade.trim()) e.contacto.localidade = txt(c.localidade, 80);   // a antiga localidade do passo 1
  e.visita = normalizarVisita(v.visita);
  e.urgencia = URGENCIAS[v.urgencia] ? v.urgencia : "normal";
  const cp = v.compras && typeof v.compras === "object" ? v.compras : {};
  e.compras = { relatorio: bool(cp.relatorio), visita: bool(cp.visita) };
  return e;
}

/** Disponibilidade para a visita (lote 8): só dias conhecidos, sem repetidos, pela ordem da semana; período conhecido. */
export function normalizarVisita(v) {
  const o = v && typeof v === "object" ? v : {};
  const dias = Array.isArray(o.dias) ? Object.keys(DIAS_VISITA).filter((k) => o.dias.includes(k)) : [];
  return { dias, periodo: PERIODOS_VISITA[o.periodo] ? o.periodo : "qualquer" };
}

/** Chaves conhecidas de `mapa`, sem repetidas e pela ordem dele; os estados antigos traziam uma só (string). */
const chavesAvaria = (v, mapa) => { const l = Array.isArray(v) ? v : typeof v === "string" ? [v] : []; return Object.keys(mapa).filter((k) => l.includes(k)); };
/**
 * Avaria rápida (funil 3): "Onde?" e "O que se passa?" com várias escolhas (listas de chaves conhecidas; ronda B); a
 * descrição sem caracteres de controlo (≤ 200).
 */
export function normalizarAvaria(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    onde: chavesAvaria(o.onde, AVARIA_ONDE),
    problema: chavesAvaria(o.problema, AVARIA_PROBLEMA),
    descricao: txt(o.descricao, MAX_AVARIA).replace(CONTROLO_LINHA, " "),
  };
}

/** Linha "Fora das divisões" (elementos fora de todas; regras.js contarPlanta): não é uma divisão. */
const ehFora = (d) => d?.nome === NOME_FORA && !d?.planta_id;

/**
 * Máquinas grandes, pequenas e objetivos do passo "O que quer": só as chaves conhecidas (as do perfil
 * do imóvel, quando `tipo` é dado), sem repetidos, pela ordem das listas. As máquinas escolhem-se por piso:
 * `porPiso[chave]` = {piso: n} (0 = r/c; 1–10 em cada piso) é o que conta; `maquinas`/`pequenas` (as chaves
 * com alguma quantidade) e `quantidades` (o total da casa) saem daí.
 * Estados antigos: {maquinas, pequenas, quantidades, pisos} (uma quantidade e, se o cliente escolheu, um piso
 * por máquina) → essa quantidade no piso escolhido ou, sem escolha, no típico (`pisoTipico(chave)`; 0 sem ela).
 * `pisos`: n.º de pisos da casa — o que estiver num piso acima do último passa para o último.
 */
export const MAX_QUANTIDADE = 10;
export function normalizarQuer(q, tipo = undefined, { pisos = MAX_PISO + 1, pisoTipico = null } = {}) {
  const o = q && typeof q === "object" ? q : {};
  const so = (v, chaves) => (Array.isArray(v) ? chaves.filter((k) => v.includes(k)) : []);
  const porTipo = tipo !== undefined;
  const grandes = porTipo ? maquinasGrandesDe(tipo) : MAQUINAS_QUER;
  const peq = porTipo ? maquinasPequenasDe(tipo) : PEQUENAS_QUER;
  const ultimo = int(pisos, 1, MAX_PISO + 1, 1) - 1;
  const porPiso = {};
  const somar = (k, p, n) => {
    const m = (porPiso[k] ??= {});
    const pp = Math.min(ultimo, p);
    m[pp] = Math.min(MAX_QUANTIDADE, (m[pp] ?? 0) + n);
  };
  if (o.porPiso && typeof o.porPiso === "object") {
    for (const k of new Set([...grandes, ...peq])) {
      const m = o.porPiso[k];
      if (!m || typeof m !== "object") continue;
      for (const [p, n] of Object.entries(m)) {
        const pi = Number(p), ni = Math.round(Number(n));
        if (Number.isInteger(pi) && pi >= 0 && pi <= MAX_PISO && ni >= 1) somar(k, pi, Math.min(MAX_QUANTIDADE, ni));
      }
    }
  } else {
    const qt = o.quantidades && typeof o.quantidades === "object" ? o.quantidades : {};
    const ps = o.pisos && typeof o.pisos === "object" ? o.pisos : {};
    for (const k of new Set([...so(o.maquinas, grandes), ...so(o.pequenas, peq)])) {
      const escolhido = ps[k] !== undefined && ps[k] !== null && Number.isFinite(Number(ps[k])) ? int(ps[k], 0, MAX_PISO) : null;
      somar(k, escolhido ?? (pisoTipico ? int(pisoTipico(k), 0, MAX_PISO) : 0), int(qt[k], 1, MAX_QUANTIDADE, 1));
    }
  }
  const maquinas = grandes.filter((k) => porPiso[k]);
  const pequenas = peq.filter((k) => porPiso[k] && !maquinas.includes(k));
  const quantidades = Object.fromEntries([...maquinas, ...pequenas].map((k) => [k, Object.values(porPiso[k]).reduce((s, n) => s + n, 0)]));
  return { maquinas, pequenas, objetivos: so(o.objetivos, porTipo ? objetivosDe(tipo) : Object.keys(OBJETIVOS)), quantidades, porPiso };
}

/** Quantas máquinas `k` estão escolhidas no piso `p` (0 se nenhuma). */
export const quantidadeNoPiso = (quer, k, p) => Number(quer?.porPiso?.[k]?.[p]) || 0;

/** Todas as máquinas escolhidas (grandes e pequenas; só as chaves): ligação sugerida, "Exterior", assinatura. */
export const maquinasEscolhidas = (quer) => [...(quer?.maquinas ?? []), ...(quer?.pequenas ?? [])];

/** N.º de pisos da casa (1 nos tipos sem pisos). */
export const pisosDaCasa = (casa) => (TIPOS_COM_PISOS.includes(casa?.tipo) ? int(casa?.pisos, 1, MAX_PISO + 1, 1) : 1);

/**
 * Máquinas para desenhar a planta (casa.js plantaDaCasa): {modelo, qtd, piso}, uma por piso onde o cliente as
 * pôs (só nos tipos com mais de um piso; sem pisos, piso null).
 */
export function maquinasParaPlanta(estado) {
  const q = estado.quer ?? {};
  const comPisos = pisosDaCasa(estado.casa) > 1;
  return maquinasEscolhidas(q).flatMap((k) => {
    const m = q.porPiso?.[k] ?? { 0: q.quantidades?.[k] ?? 1 };
    const pisos = Object.keys(m).map(Number).filter((p) => Number(m[p]) > 0).sort((a, b) => a - b);
    if (!comPisos) return [{ modelo: k, qtd: pisos.reduce((s, p) => s + Number(m[p]), 0), piso: null }];
    return pisos.map((p) => ({ modelo: k, qtd: Number(m[p]), piso: p }));
  });
}

/** Ligação sugerida pelo tipo e pelas máquinas (regras.js sugerirFases). */
export const fasesSugeridas = (estado) => sugerirFases(estado.casa?.tipo ?? null, maquinasEscolhidas(estado.quer));

/** Potência contratada (kVA) de um dos escalões, ou null (valor inválido; quem chama usa POTENCIA_OMISSAO_KVA). */
export function potenciaContratada(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return POTENCIAS_KVA.includes(n) ? n : null;
}

/** Opções dos avisos do quadro: disjuntor escolhido e a instalação da casa (§4). */
export const opcoesAvisos = (estado) => ({
  disjuntor: estado.quadro?.disjuntor,
  fases: estado.casa?.fases ?? null,
  potencia_contratada_kva: estado.casa?.potencia_contratada_kva ?? null,
  quadro_novo: estado.quadro?.quadro_novo ?? null,
});

/**
 * Todos os avisos do quadro: os dos circuitos (regras.js) e os das proteções, tamanho e potência (quadro.js) — estes só
 * com o quadro no pedido (lote 7: sem "Instalação nova" o cliente pode não querer mexer no quadro). Com aparelhos a
 * manter, reparar ou substituir, o aviso de que ficam nos circuitos que já existem (só os Novos têm circuitos novos).
 * `foraArea`: fora da área servida não há visita técnica — "(orientativo — a confirmar)" em vez de "confirmamos na visita".
 */
export const avisosEstado = (estado, circuitos = estado.quadro.circuitos, foraArea = false) => {
  const servico = Array.isArray(estado.servico) && estado.servico.length ? estado.servico : ["nova"];
  const n = contarAcoes(estado.plantaSaltada ? null : estado.planta, servico);
  const existentes = n.manter + n.reparar + n.substituir;
  const r = [
    ...avisosQuadro(circuitos, opcoesAvisos(estado)),
    // O estado todo (serviço, mexerQuadro, planta, divisões): o mesmo resumoQuadro que dá os artigos do preço
    // (preco.js pedidosQuadro) — os disjuntores dos circuitos que já existem e o tamanho da caixa.
    ...(quadroNoPedido({ ...estado, servico }) ? avisosProtecoes({ ...estado, servico, quadro: { ...estado.quadro, circuitos } }) : []),
    ...(existentes ? [`${existentes} ${existentes === 1 ? "aparelho fica" : "aparelhos ficam"} nos circuitos que já existem (manter, reparar ou substituir): só os novos têm circuitos novos. Confirmar o estado desses circuitos e a proteção diferencial${FIM_AVISO}`] : []),
  ];
  if (!foraArea) return r;
  return r.map((t) => (t.endsWith(FIM_AVISO) ? t.slice(0, -FIM_AVISO.length) + FIM_AVISO_FORA : t)
    .replace(" — confirmamos na visita.", ".").replace(" a confirmar na visita", " a confirmar").replace(" confirmado na visita", " confirmado depois"));
};

/**
 * `simulacao.quadro` (§6): circuitos (com o código RTIEBT, a secção do cabo, o grupo diferencial e o AFDD),
 * pacote e proteções, respostas (para-raios, quadro novo), grupos diferenciais, módulos e potência sugerida.
 */
export function quadroParaEnvio(estado, circuitos) {
  const q = { ...estado.quadro, circuitos };
  const r = resumoQuadro({ ...estado, quadro: q });
  const grupoDe = (n) => r.grupos.find((g) => g.circuitos.includes(n))?.n ?? null;
  return {
    circuitos: circuitos.map((c) => ({ ...c, codigo: codigoCircuito(c), seccao_mm2: seccaoCabo(c.amperes), diferencial: grupoDe(c.n), afdd: r.afdd.includes(c.n) })),
    disjuntor: q.disjuntor,
    pacote: r.pacote,
    protecoes: { ...r.protecoes },
    para_raios: r.para_raios,
    quadro_novo: r.quadro_novo,
    // Lote 5, "O seu quadro elétrico": Quero um quadro novo → true, Já tenho quadro (o atual serve) → false, Não sei →
    // null (o mesmo valor que dava "O quadro elétrico é antigo?" do lote 4: Sim / Não / Não sei).
    quadro_antigo: r.quadro_novo === "novo" ? true : r.quadro_novo === "atual" ? false : null,
    quadro_novo_no_preco: levaQuadroNovo(q),
    // Automatizar/reparar com quadro novo: disjuntores dos circuitos que a casa já tem (estimativa; §0 lote 7).
    circuitos_existentes: r.circuitos_existentes,
    diferenciais: r.grupos.map((g) => ({ n: g.n, circuitos: [...g.circuitos], carregador: g.carregador, wifi: !!r.protecoes.idr_wifi, quadro: g.quadro })),
    modulos: { tamanho: r.tamanho, quadros: r.quadros, parciais: r.parciais, tamanho_parcial: r.parciais ? TAMANHO_PARCIAL : null, pisos_quadros: [...r.pisos_quadros], ocupados: r.ocupados, livres: r.livres, cabe: r.cabe, novos: r.novos, linhas: r.linhas.map((l) => ({ nome: l.nome, qtd: l.qtd, modulos: l.modulos })) },
    potencia_sugerida_kva: r.potencia.kva,
    potencia_carga_w: r.potencia.carga_w,
    // Ronda regras: o mínimo de dimensionamento da RTIEBT 801.5.2.2 (pelos compartimentos; null fora da habitação) e se
    // foi ele que valeu na sugerida.
    potencia_minima_kva: r.potencia.minimo_kva,
    potencia_minima_rtiebt: r.potencia.minimo_rtiebt,
  };
}

/**
 * Houve progresso que valha a pena retomar? (`passoInicial`: o Início.) Um estado só com a casa guardada (`soCasa`)
 * não é uma simulação em curso: dá só o cartão "Já tenho a planta". O contacto não conta (com sessão vem do perfil
 * da conta; senão um estado vazio iria para a conta por cima da casa/simulação guardada lá).
 */
export function temProgresso(e, passoInicial = 0) {
  return !!e && !e.soCasa && (e.passo > passoInicial || e.funil !== null || e.servico.length > 0 || e.quadroAvaria !== null
    || !!e.avaria?.onde?.length || !!e.avaria?.problema?.length || !!e.avaria?.descricao?.trim()
    || e.casa.potencia_contratada_kva !== POTENCIA_OMISSAO_KVA || e.fasesEditadas || (plantaTemConteudo(e.planta) && !e.plantaAuto) || e.quadro.circuitos.length > 0 || e.divisoes.length > 0);
}

// ------------------------------------------------------------ a casa guardada (funil "Já tenho a planta")
/**
 * A casa do cliente fica guardada à parte da simulação (CHAVE_CASA, neste navegador; na conta, como um estado
 * `soCasa`): o tipo, a casa, as máquinas, a planta (sem as ações de um pedido), o quadro e as divisões. Dá o cartão
 * "Já tenho a planta" no Início, mesmo depois de enviar o pedido ou de "Começar de novo".
 */
export const CHAVE_CASA = "domus.simulador.casa";
const CAMPOS_CASA = ["pisosDesde0", "casa", "fasesEditadas", "quer", "planta", "plantaAuto", "plantaBase", "plantaFase", "plantaSinc",
  "quadro", "quadroEditado", "divisoes", "divisoesEditadas", "extras", "termostatosEditados", "instalado"];
/** O estado tem uma casa que se possa guardar? (o tipo de imóvel e uma planta com divisões) */
export const temCasa = (e) => !!e && !!e.casa?.tipo && Array.isArray(e.planta?.divisoes) && e.planta.divisoes.length > 0;
/** Estado só com a casa (`soCasa`), sem o que era do pedido (ações, avarias, fotos, contacto, visita). */
export function soCasaDe(e, agora = new Date()) {
  const n = estadoNovo();
  for (const k of CAMPOS_CASA) if (e[k] !== undefined) n[k] = structuredClone(e[k]);
  n.planta = { ...n.planta, elementos: (n.planta.elementos ?? []).map(({ acao, avaria, inteligente, ...x }) => x) };
  // O "Quadro seguro" é do pedido (melhorias.js): a casa guarda as proteções que o cliente escolheu antes dele.
  if (e.melhorias?.quadroAnterior && n.quadro) n.quadro = { ...n.quadro, ...normalizarProtecoes({ ...n.quadro, protecoes: e.melhorias.quadroAnterior }) };
  // Fase 2: o que este pedido já instala (proteções do quadro, máquinas com disjuntor inteligente) conta como feito no
  // "Já tenho a planta" (as Melhorias não o cobram outra vez).
  n.instalado = instaladoDe(e);
  n.plantaSaltada = false;
  n.soCasa = true;
  n.guardado = agora.toISOString();
  return n;
}
/** "Apartamento T2, 5 divisões" (cartão "Já tenho a planta" e faixa de "Trocar e reparar"). */
export function resumoCasa(e) {
  if (!temCasa(e)) return "";
  const c = e.casa;
  const n = e.planta.divisoes.length;
  const tipo = [TIPOS_CASA[c.tipo] ?? "Casa", perfilCasa(c.tipo) === "habitacao" && TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null].filter(Boolean).join(" ");
  return `${tipo}, ${n} ${n === 1 ? "divisão" : "divisões"}`;
}
/** Guarda a casa (sem a imagem de fundo se não couber). Devolve true se ficou guardada. */
export function guardarCasa(storage, e, agora = new Date()) {
  if (!temCasa(e)) return false;
  const c = soCasaDe(e, agora);
  try { storage.setItem(CHAVE_CASA, JSON.stringify(c)); return true; } catch { /* quota: sem o fundo */ }
  try { storage.setItem(CHAVE_CASA, JSON.stringify({ ...c, planta: { ...c.planta, fundo: null } })); return true; } catch { return false; }
}
/** A casa guardada neste navegador (estado `soCasa`), ou null. */
export function carregarCasa(storage) {
  try {
    const bruto = storage.getItem(CHAVE_CASA);
    if (!bruto) return null;
    const e = normalizarEstado({ ...JSON.parse(bruto), passo: 0, funil: null, soCasa: true });
    return temCasa(e) ? e : null;
  } catch {
    return null;
  }
}
/**
 * Funil "Já tenho a planta": a simulação passa a usar a casa `c` (a guardada; ou a do próprio estado) — os aparelhos
 * sem ação ficam "Manter" (o cliente escolhe só o que troca, repara ou acrescenta) e o serviço é automatizar + reparar.
 */
export function usarCasa(e, c = e) {
  if (c !== e) for (const k of CAMPOS_CASA) if (c[k] !== undefined) e[k] = structuredClone(c[k]);
  e.plantaSaltada = false;
  e.soCasa = false;
  e.funil = "planta";
  e.servico = [...SERVICO_PLANTA];
  e.planta = { ...e.planta, elementos: e.planta.elementos.map((x) => (temAcao(x.tipo, x.props) && !ACOES[x.acao] ? { ...x, acao: "manter" } : x)) };
  return e;
}

// ------------------------------------------------------------ navegador (localStorage)

/**
 * Guarda o estado. Se não couber (quota), tenta sem a imagem de fundo.
 * @returns {"ok"|"sem_imagem"|"falhou"}
 */
export function guardarEstado(storage, estado, agora = new Date()) {
  const e = { ...estado, guardado: agora.toISOString() };
  try {
    storage.setItem(CHAVE, JSON.stringify(e));
    return "ok";
  } catch {
    if (!estado.planta?.fundo) return "falhou";
    try {
      storage.setItem(CHAVE, JSON.stringify({ ...e, planta: { ...e.planta, fundo: null } }));
      return "sem_imagem";
    } catch {
      return "falhou";
    }
  }
}

export function carregarEstado(storage) {
  try {
    const bruto = storage.getItem(CHAVE);
    if (!bruto) return null;
    return normalizarEstado(JSON.parse(bruto));
  } catch {
    return null;
  }
}

export function apagarEstado(storage) {
  try { storage.removeItem(CHAVE); } catch { /* navegador sem armazenamento */ }
}

/** Código do cliente passado pela área de cliente (sessionStorage); null se não houver ou for inválido. */
export function lerCodigoCliente(storage) {
  try {
    const c = String(storage.getItem(CHAVE_CODIGO) ?? "").trim().toLowerCase();
    return RE_ID.test(c) ? c : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ corpo do pedido (§6)

/**
 * Texto do cliente seguro para a simulação: sem caracteres de controlo e sem
 * começar por "data:" (o painel só aceita data: de imagens JPEG/PNG).
 */
export function textoSeguro(v, max = 120, multilinha = false) {
  let s = String(v ?? "").replace(multilinha ? CONTROLO : CONTROLO_LINHA, " ").trim().normalize("NFC").slice(0, max);
  if (/^\s*data:/i.test(s)) s = `«${s}»`.slice(0, max);
  return s;
}

/**
 * Planta no formato exato do §2.1 (ou null quando não há nada desenhado). Com `servicos` (lote 7), cada aparelho com
 * ação leva `acao` (a que vale: a escolhida ou a do serviço) e, quando se aplica, `avaria` e `inteligente`.
 */
export function plantaParaEnvio(planta, servicos = null) {
  if (!plantaTemConteudo(planta)) return null;
  const p = normalizarPlanta(planta);
  return {
    escala_cm: ESCALA_CM,
    largura_cm: p.largura_cm,
    altura_cm: p.altura_cm,
    fundo: p.fundo ? { imagem: p.fundo.imagem, x_cm: p.fundo.x_cm, y_cm: p.fundo.y_cm, largura_cm: p.fundo.largura_cm, opacidade: p.fundo.opacidade } : null,
    divisoes: p.divisoes.map((d) => ({
      id: d.id, nome: textoSeguro(d.nome, 60) || "Divisão", piso: d.piso, x_cm: d.x_cm, y_cm: d.y_cm, largura_cm: d.largura_cm, altura_cm: d.altura_cm,
      ...(d.pontos ? { pontos: d.pontos.map((q) => [q[0], q[1]]) } : {}),
    })),
    elementos: p.elementos.map((e) => {
      // Altura ao chão típica (para o relatório técnico: o cliente já não a vê nem a escreve).
      const div = e.divisao ? p.divisoes.find((d) => d.id === e.divisao) : null;
      return {
        id: e.id, tipo: e.tipo, x_cm: e.x_cm, y_cm: e.y_cm, rot: e.rot, piso: e.piso, divisao: e.divisao, props: { ...e.props },
        ...(e.nome ? { nome: textoSeguro(e.nome, 60) } : {}), ...(e.altura_cm !== undefined ? { altura_cm: e.altura_cm } : {}),
        altura_tipica_cm: alturaTipica(e.tipo, e.props, div ? tipoDivisao(div.nome) : null),
        ...(servicos && temAcao(e.tipo, e.props) ? acaoParaEnvio(e, servicos) : {}),
      };
    }),
  };
}

/** `acao` do aparelho (a que vale) e, se for o caso, `avaria` (Reparar) e `inteligente` (Substituir tomada/interruptor). */
function acaoParaEnvio(e, servicos) {
  const acao = acaoDe(e, servicos);
  const r = { acao };
  if (acao === "reparar") r.avaria = textoSeguro(e.avaria, MAX_AVARIA);
  if (acao === "substituir" && perguntaInteligente(e.tipo)) r.inteligente = e.inteligente === true;
  return r;
}

const ORDEM_ACOES = Object.keys(ACOES);
const FOTO_ACOES = ["reparar", "substituir"];   // as ações que pedem a foto da linha (app.js pedeFoto)
/**
 * Lista de trabalho (lote 7, `simulacao.trabalho`; relatório técnico): por divisão, os aparelhos agrupados por ação e
 * tipo (máquinas por modelo), com o material (SKU) e as horas de cada grupo. `linhaArtigo(chave, acao)` →
 * {sku, horas} por unidade (app.js, a partir do catálogo); `fotos`: chaves das fotos tiradas ("d1:tomada"), só nos
 * grupos que as pedem (Reparar, Substituir); `objetivos`: para os Novos inteligentes, como no preço (acoes.js inteligenteDe).
 */
export function trabalhoParaEnvio(planta, servicos, linhaArtigo, fotos = [], objetivos = []) {
  if (!planta || !plantaTemConteudo(planta)) return [];
  const p = normalizarPlanta(planta);
  const tem = new Set(fotos);
  const out = [];
  const porDiv = new Map();
  for (const e of p.elementos) {
    if (!temAcao(e.tipo, e.props)) continue;
    const acao = acaoDe(e, servicos);
    const div = e.divisao ? p.divisoes.find((d) => d.id === e.divisao) : null;
    const id = div?.id ?? null;
    if (!porDiv.has(id)) {
      const x = { divisao: id, nome: div ? textoSeguro(div.nome, 60) || "Divisão" : NOME_FORA, piso: div ? div.piso : pisoDe(e), acoes: [] };
      porDiv.set(id, x);
      out.push(x);
    }
    const g = porDiv.get(id);
    const modelo = e.tipo === "maquina" ? e.props.modelo : null;
    const k = modelo ?? e.tipo;
    let item = g.acoes.find((a) => a.acao === acao && a.k === k);
    if (!item) {
      item = { acao, k, tipo: e.tipo, modelo, qtd: 0, material: [], horas: 0, foto: id && FOTO_ACOES.includes(acao) && tem.has(`${id}:${k}`) ? `${id}:${k}` : null };
      if (acao === "reparar") item.avarias = [];
      if (acao === "substituir" && perguntaInteligente(e.tipo)) item.inteligentes = 0;
      g.acoes.push(item);
    }
    item.qtd++;
    if (acao === "reparar") item.avarias.push(textoSeguro(e.avaria, MAX_AVARIA));
    if (acao === "substituir" && perguntaInteligente(e.tipo) && e.inteligente === true) item.inteligentes++;
    // Ronda regras: no Novo, os pontos com preço fechado e a aparelhagem do comando (acoes.js pontosDoElemento) e o inteligente.
    for (const chave of pedidosDoElemento(e, acao, objetivos)) {
      const a = linhaArtigo(chave, acao);
      const m = item.material.find((x) => x.sku === a.sku);
      if (m) m.qtd++; else item.material.push({ sku: a.sku, qtd: 1 });
      item.horas = Math.round((item.horas + (Number(a.horas) || 0)) * 100) / 100;
    }
    if (e.tipo === "interruptor" && acao === "novo") (item.comandos ??= {})[comandoDe(e.props)] = ((item.comandos ??= {})[comandoDe(e.props)] ?? 0) + 1;
  }
  for (const g of out) {
    g.acoes.sort((a, b) => ORDEM_ACOES.indexOf(a.acao) - ORDEM_ACOES.indexOf(b.acao));
    for (const a of g.acoes) delete a.k;
  }
  return out.slice(0, MAX_DIVISOES + 1);
}

/**
 * Totais por ação (lote 7, `simulacao.totais_acao`): aparelhos de cada ação e, das linhas do preço, os artigos (€) e as
 * horas de Reparar, Substituir, Novo (aparelhos e circuitos) e do quadro.
 */
export function totaisAcao(planta, servicos, preco) {
  const n = contarAcoes(planta, servicos);
  const r = {};
  for (const k of ["manter", "reparar", "substituir", "novo", "quadro"]) {
    const ls = preco.linhas.filter((l) => (l.grupo ?? "novo") === k);
    r[k] = k === "manter" ? { aparelhos: n.manter } : {
      ...(k !== "quadro" ? { aparelhos: n[k] } : {}),
      artigos_iva: ls.some((l) => l.total === null) ? null : Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100,
      horas: ls.some((l) => l.horas === null) ? null : Math.round(ls.reduce((s, l) => s + l.horas, 0) * 100) / 100,
    };
  }
  return r;
}

/**
 * `simulacao.casa` (§6). Com tipologia (ou em serviços/industrial), `divisoes` é o total das divisões
 * que a casa gera, incluindo o "Exterior" que as máquinas acrescentam (compatível com o antigo "Quantas
 * divisões tem?"); sem tipologia os campos novos vão a null. Serviços e industrial: `area_m2` e
 * `espacos` (sem tipologia).
 */
export function casaParaEnvio(estado) {
  const c = estado.casa;
  const negocio = perfilCasa(c.tipo) !== "habitacao";
  const tipologia = !negocio && TIPOLOGIAS.includes(c.tipologia) ? c.tipologia : null;
  return {
    tipo: TIPOS_CASA[c.tipo] ? c.tipo : null,
    divisoes: tipologia || negocio ? divisoesDaCasa(c, maquinasEscolhidas(estado.quer)).length : c.divisoes ?? (estado.divisoes.length || null),
    localidade: textoSeguro(estado.contacto.localidade, 80) || null,   // o local da obra: a localidade do contacto (passo "Enviar")
    potencia_contratada_kva: potenciaContratada(c.potencia_contratada_kva),
    fases: FASES[c.fases] ? c.fases : null,
    tipologia,
    quartos: tipologia ? quartosDe(c) : null,
    casas_banho: tipologia ? int(c.casas_banho, ...LIMITES_CASA.casas_banho, 1) : null,
    salas: tipologia && tipologia !== "T0" ? int(c.salas, ...LIMITES_CASA.salas, 1) : null,
    pisos: tipologia ? (TIPOS_COM_PISOS.includes(c.tipo) ? int(c.pisos, ...LIMITES_CASA.pisos, 1) : 1) : null,
    extras: tipologia ? Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(c.extras?.[k])])) : null,
    // "Outra divisão" de "A casa tem…" ([{nome, qtd}]; [] sem nenhuma); null sem tipologia.
    outras: tipologia ? outrasDaCasa(c.outras) : null,
    area_m2: negocio ? int(c.area_m2, ...LIMITES_CASA.area_m2, AREA_OMISSAO[c.tipo]) : null,
    espacos: negocio ? int(c.espacos, ...LIMITES_CASA.espacos, ESPACOS_OMISSAO[c.tipo]) : null,
    // Com 2 ou mais pisos, o que tem cada piso (os totais acima são a soma); null com um só piso.
    pisos_detalhe: tipologia && Array.isArray(c.porPiso) && c.porPiso.length > 1
      ? c.porPiso.map((f, p) => ({
        piso: p, quartos: int(f.quartos, 0, 12), casas_banho: int(f.casas_banho, 0, 6), salas: tipologia === "T0" ? null : int(f.salas, 0, 4),
        extras: Object.fromEntries(Object.keys(EXTRAS_CASA).map((k) => [k, bool(f.extras?.[k])])),
      }))
      : null,
  };
}

export const ESTADOS_DESLOCACAO = ["estimada", "visita", "sem_localidade", "fora_area"];

/**
 * `simulacao.deslocacao` (§5.1, §6) a partir de calcularDeslocacao() (./deslocacao.js): localidade escrita,
 * concelho reconhecido e distrito (null se não reconhecido), distância estimada por estrada (km) e valor
 * (€ c/ IVA; em "visita"/"sem_localidade" só o mínimo fixo; null quando fora da área). null sem cálculo.
 */
export function deslocacaoParaEnvio(d) {
  if (!d || typeof d !== "object" || !ESTADOS_DESLOCACAO.includes(d.estado)) return null;
  const n = (x, max) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  return {
    estado: d.estado,
    localidade: textoSeguro(d.localidade, 80) || null,
    concelho: textoSeguro(d.concelho, 60) || null,
    distrito: textoSeguro(d.distrito, 60) || null,
    distancia_km: n(d.distancia_km, 5000),
    valor_iva: n(d.valor_iva, 100_000),
  };
}

/**
 * `simulacao` do POST /api/orcamento (§6).
 * @param {object} estado
 * @param {ReturnType<import("./preco.js").calcularPreco>} preco
 * @param {string} plano  base | conforto | premium
 */
/**
 * `simulacao` do POST /api/orcamento (§6). `fotos` (lote 5): as fotos tiradas, sem as imagens —
 * [{chave, tipo, divisao, divisao_nome, piso, legenda}] (as imagens vão depois, uma a uma, com o token).
 * `melhorias` (fase 2): os pacotes aceites [{id, nome, itens: [{sku, qtd}], preco}] (app.js melhoriasParaEnvio).
 */
export function montarSimulacao(estado, preco, plano, fotos = [], linhaArtigo = null, melhorias = []) {
  if (estado.funil === "avaria") return montarSimulacaoAvaria(estado, preco, fotos);
  const circuitos = estado.quadro.circuitos.map((c, i) => {
    const n = normalizarCircuito(c, i);
    return { ...n, nome: textoSeguro(n.nome, 60), divisoes: n.divisoes.map((d) => textoSeguro(d, 60)).filter(Boolean) };
  });
  const servico = Array.isArray(estado.servico) && estado.servico.length ? [...estado.servico] : ["nova"];
  const semArtigo = () => ({ sku: null, horas: null });
  const planta = estado.plantaSaltada ? null : estado.planta;
  // Ronda B: "Faz faíscas, Dá choque — a tampa está solta" (os cartões escolhidos e, se houver, a descrição).
  const quadroAvaria = typeof estado.quadroAvaria === "string" ? textoSeguro(textoQuadroAvaria(estado), 320) : null;
  const totais = totaisAcao(planta, servico, preco);
  const foraArea = preco.deslocacao?.estado === "fora_area";
  if (quadroAvaria !== null) totais.reparar.aparelhos++;   // o quadro com problemas conta como um aparelho a reparar
  return {
    versao: VERSAO,
    // Fase 1 (funis): o caso escolhido no Início — "primeira" (obras ou automatizar) ou "planta" (já tinha a planta).
    funil: estado.funil === "planta" ? "planta" : "primeira",
    // Lote 7: o serviço pedido (passo 1) e, por aparelho, a ação (planta.elementos[].acao); a lista de trabalho por
    // divisão e os totais por ação são para o relatório técnico.
    servico,
    casa: casaParaEnvio(estado),
    quer: querParaEnvio(estado),
    planta: planta ? plantaParaEnvio(planta, servico) : null,
    // Lote 8: `avaria` = o que o cliente disse do quadro com problemas ("Trocar e reparar"); null sem problemas.
    quadro: { ...quadroParaEnvio(estado, circuitos), foto: fotos.some((f) => f.chave === "quadro") ? "quadro" : null, no_preco: quadroNoPedido({ ...estado, servico }), avaria: quadroAvaria },
    trabalho: trabalhoParaEnvio(planta, servico, linhaArtigo ?? semArtigo, fotos.map((f) => f.chave), estado.quer?.objetivos ?? []),
    totais_acao: totais,
    // Lote 8 (passo Enviar): disponibilidade para a visita e urgência; null fora da área servida (não há visita).
    visita: foraArea ? null : normalizarVisita(estado.visita),
    urgencia: foraArea ? null : URGENCIAS[estado.urgencia] ? estado.urgencia : "normal",
    divisoes: estado.divisoes.filter((d) => !ehFora(d)).map((d) => {
      const n = normalizarDivisao(d);
      return {
        nome: textoSeguro(n.nome, 60) || "Divisão", piso: n.piso, interruptores: n.interruptores, estores: n.estores, estores_sem_motor: n.estores_sem_motor,
        sensores_porta: n.sensores_porta, sensores_movimento: n.sensores_movimento, luzes_regulaveis: n.luzes_regulaveis, tomadas_inteligentes: n.tomadas_inteligentes,
      };
    }),
    // `grupo` (lote 7): reparar, substituir, novo ou quadro; `horas` = as desta linha (as de troca ao substituir).
    itens: preco.linhas.map((l) => ({ sku: l.sku, qtd: l.qtd, preco_iva: l.preco_iva, grupo: l.grupo ?? "novo", horas: l.horas == null ? null : Math.round(l.horas * 100) / 100 })),
    mao_obra: { horas: preco.horas, valor_iva: preco.mao_obra_iva },
    deslocacao: deslocacaoParaEnvio(preco.deslocacao),
    total: { min: preco.min, max: preco.max },
    // Fase 2: a margem dos pacotes aceites (já no `total`; o painel soma-a ao "Total (sem intervalo)").
    melhorias_margem_iva: preco.melhorias_margem_iva ?? 0,
    // Fase 2: pacotes do passo "Melhorias" — os artigos também vão em `itens` (grupo "melhoria"; os do "Quadro seguro",
    // com o quadro no pedido, nas linhas do quadro); `preco` = o "a partir de" dado ao cliente (com a margem dos pacotes).
    melhorias: (Array.isArray(melhorias) ? melhorias : []).slice(0, 4).map((m) => ({
      id: m.id, nome: textoSeguro(m.nome, 80), itens: (m.itens ?? []).slice(0, 20).map((i) => ({ sku: i.sku, qtd: i.qtd })), preco: m.preco ?? null,
      // "Quadro seguro" com o quadro no pedido: a diferença do quadro (com sinal), para o servidor contar a margem.
      ...(Array.isArray(m.quadro_delta) ? { quadro_delta: m.quadro_delta.slice(0, 30).map((i) => ({ sku: i.sku, qtd: i.qtd })) } : {}),
    })),
    plano_sugerido: plano,
    avisos: avisosEstado(estado, circuitos, foraArea),
    fotos: fotos.slice(0, 40).map((f) => ({
      chave: String(f.chave).slice(0, 80), tipo: f.tipo, divisao: f.divisao ?? null,
      divisao_nome: f.divisao_nome == null ? null : textoSeguro(f.divisao_nome, 60) || "Divisão",
      piso: f.piso ?? null, legenda: textoSeguro(f.legenda, 120),
    })),
  };
}

/**
 * `simulacao` do funil "avaria" (avaria rápida, sem planta; §6): `funil: "avaria"`, `servico: ["reparar"]`,
 * `avaria` = {onde, problema, descricao} e a foto (obrigatória); o preço é o diagnóstico (DIAG-AVARIA + horas ×
 * tarifa), um valor fixo (`total` min = max, sem a deslocação, que vai em `deslocacao`). Sem planta, quadro, máquinas nem divisões; a casa só com a localidade.
 */
export function montarSimulacaoAvaria(estado, preco, fotos = []) {
  const a = normalizarAvaria(estado.avaria);
  const foraArea = preco.deslocacao?.estado === "fora_area";
  const totais = totaisAcao(null, ["reparar"], preco);
  totais.reparar.aparelhos = 1;
  const diagnostico = preco.total === null ? null : Math.round((preco.artigos_iva + preco.mao_obra_iva) * 100) / 100;
  return {
    versao: VERSAO,
    funil: "avaria",
    servico: ["reparar"],
    casa: { tipo: null, divisoes: null, localidade: textoSeguro(estado.contacto.localidade, 80) || null, potencia_contratada_kva: null, fases: null },
    quer: null,
    planta: null,
    quadro: null,
    avaria: { onde: a.onde, problema: a.problema, descricao: textoSeguro(a.descricao, MAX_AVARIA) },
    trabalho: [],
    totais_acao: totais,
    visita: foraArea ? null : normalizarVisita(estado.visita),
    urgencia: foraArea ? null : URGENCIAS[estado.urgencia] ? estado.urgencia : "normal",
    divisoes: [],
    itens: preco.linhas.map((l) => ({ sku: l.sku, qtd: l.qtd, preco_iva: l.preco_iva, grupo: l.grupo ?? "reparar", horas: l.horas == null ? null : Math.round(l.horas * 100) / 100 })),
    mao_obra: { horas: preco.horas, valor_iva: preco.mao_obra_iva },
    deslocacao: deslocacaoParaEnvio(preco.deslocacao),
    total: { min: diagnostico, max: diagnostico },   // o diagnóstico, fixo (sem intervalo nem a deslocação, que vai à parte)
    plano_sugerido: null,
    avisos: [],
    fotos: fotos.filter((f) => FOTOS_AVARIA.includes(f.chave)).slice(0, FOTOS_AVARIA.length).map((f) => ({
      chave: f.chave, tipo: "avaria", divisao: null, divisao_nome: a.onde.length ? textoSeguro(a.onde.map((k) => AVARIA_ONDE[k]).join(", "), 120) : null, piso: null, legenda: textoSeguro(f.legenda, 120),
    })),
  };
}
/** "Sala, Cozinha — Luz não acende, Disjuntor dispara" (onde e o que se passa, com várias escolhas). */
export function textoAvaria(a) {
  const n = normalizarAvaria(a);
  return [n.onde.map((k) => AVARIA_ONDE[k]).join(", "), n.problema.map((k) => AVARIA_PROBLEMA[k]).join(", ")].filter(Boolean).join(" — ");
}
/** "Quadro elétrico — Com problemas" (Trocar e reparar): os cartões escolhidos e a descrição, "Faz faíscas, Dá choque — «…»" sem as aspas. */
export function textoQuadroAvaria(e) {
  const nomes = chavesAvaria(e.quadroProblemas, AVARIA_PROBLEMA).map((k) => AVARIA_PROBLEMA[k]).join(", ");
  const desc = typeof e.quadroAvaria === "string" ? e.quadroAvaria.trim().slice(0, MAX_AVARIA) : "";
  return [nomes, desc].filter(Boolean).join(" — ");
}
/** Algum dos problemas é perigoso (queimado, faíscas, choque)? → "Desligue o disjuntor geral e contacte-nos já." */
export const avariaPerigosa = (a) => normalizarAvaria(a).problema.some((k) => AVARIA_PERIGO.includes(k));
/** Legenda da foto da avaria: "Avaria — Tomada sem corrente, Luz não acende · Cozinha". */
export function legendaAvaria(a) {
  const n = normalizarAvaria(a);
  return ["Avaria", [n.problema.map((k) => AVARIA_PROBLEMA[k]).join(", "), n.onde.map((k) => AVARIA_ONDE[k]).join(", ")].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
}

/**
 * `simulacao.quer` (§6): as listas de chaves (como antes), `quantidades` (o total de cada máquina marcada) e,
 * nos tipos com pisos, `pisos` = quantas em cada piso ({"ar_condicionado": {"0": 1, "1": 2}}; null nos outros).
 */
export function querParaEnvio(estado) {
  const q = normalizarQuer(estado.quer, estado.casa.tipo, { pisos: pisosDaCasa(estado.casa) });
  const chaves = [...q.maquinas, ...q.pequenas];
  return {
    maquinas: q.maquinas, pequenas: q.pequenas, objetivos: q.objetivos,
    quantidades: Object.fromEntries(chaves.map((k) => [k, q.quantidades[k]])),
    pisos: TIPOS_COM_PISOS.includes(estado.casa.tipo) ? Object.fromEntries(chaves.map((k) => [k, { ...q.porPiso[k] }])) : null,
  };
}

export const bytes = (s) => new TextEncoder().encode(s).length;

/** Problema no contacto (as mesmas regras do painel) ou null. */
export function problemaContacto(k) {
  const t = (v) => String(v ?? "").trim();
  if (!t(k.nome)) return { campo: "nome", texto: "Escreva o seu nome." };
  if (t(k.nome).length > 120) return { campo: "nome", texto: "O nome é demasiado longo (máx. 120 caracteres)." };
  if (!t(k.telefone) && !t(k.email)) return { campo: "telefone", texto: "Indique um telefone ou um email para o podermos contactar." };
  if (t(k.telefone) && !RE_TELEFONE.test(t(k.telefone))) return { campo: "telefone", texto: "O telefone não parece certo: escreva o número completo (ex.: 912 345 678)." };
  if (t(k.email) && (t(k.email).length > 254 || !RE_EMAIL.test(t(k.email)))) return { campo: "email", texto: "O email não parece certo (ex.: nome@exemplo.pt)." };
  if (t(k.localidade).length > 80) return { campo: "localidade", texto: "A localidade é demasiado longa (máx. 80 caracteres)." };
  if (t(k.morada).length > 200) return { campo: "morada", texto: "A morada é demasiado longa (máx. 200 caracteres)." };
  if (t(k.mensagem).length > 2000) return { campo: "mensagem", texto: "A mensagem é demasiado longa (máx. 2000 caracteres)." };
  return null;
}

/**
 * Corpo do POST /api/orcamento: textos aparados, campos opcionais vazios de fora.
 * `website` é o campo-armadilha (só vai se estiver preenchido).
 */
export function montarPedido(estado, simulacao, { codigo = null, website = "" } = {}) {
  const k = estado.contacto;
  const corpo = { nome: textoSeguro(k.nome, 120), servico: codigo ? SERVICO_CLIENTE : SERVICO };
  const tel = String(k.telefone ?? "").trim();
  const email = String(k.email ?? "").trim();
  const loc = textoSeguro(k.localidade || estado.casa.localidade, 80);
  const msg = String(k.mensagem ?? "").replace(CONTROLO, " ").trim().slice(0, 2000);
  if (tel) corpo.telefone = tel;
  if (email) corpo.email = email;
  if (loc) corpo.localidade = loc;
  const morada = textoSeguro(k.morada, 200);
  if (morada) corpo.morada = morada;
  if (msg) corpo.mensagem = msg;
  if (String(website ?? "").trim()) corpo.website = String(website).trim();
  if (codigo && RE_ID.test(codigo)) corpo.codigo_cliente = codigo;
  corpo.simulacao = simulacao;
  return corpo;
}

/** A simulação cabe no limite do painel (1 MB)? */
export const tamanhoSimulacao = (sim) => bytes(JSON.stringify(sim));
