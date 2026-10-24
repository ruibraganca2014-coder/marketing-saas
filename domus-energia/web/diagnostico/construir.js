// Atalhos para escrever as árvores de diagnóstico (ronda 2 em diante): só montam os objetos do formato descrito em
// web/diagnostico/motor.js — a validação continua a ser a de validarArvore. Sem DOM.

/** Uma árvore. `palavras` (opcional): termos extra para a procura da app. */
export const arvore = (id, grupo, titulo, sintoma, inicio, nos, { versao = 1, palavras } = {}) => ({ id, versao, grupo, titulo, sintoma, ...(palavras ? { palavras } : {}), inicio, nos });
export const sn = (texto, ref, sim, nao, o = {}) => ({ tipo: "simnao", texto, ref, sim, nao, ...o });
/** Escolha: opcoes = [[texto, seguinte, define?], …]. */
export const esc = (texto, ref, opcoes, o = {}) => ({ tipo: "escolha", texto, ref, opcoes: opcoes.map(([t, seguinte, define]) => ({ texto: t, seguinte, ...(define ? { define } : {}) })), ...o });
/** Valor medido com limite: o = { casas, max, aviso, abaixo, acima, fazer, tensao, ficha, naoSei }. */
export const val = (texto, ref, unidade, limite, dentro, fora, o = {}) => ({ tipo: "valor", texto, ref, unidade, casas: 2, max: 100_000, limite, dentro, fora, ...o });
export const dado = (texto, ref, unidade, define, seguinte, o = {}) => ({ tipo: "dado", texto, ref, unidade, casas: 2, max: 100_000, define, seguinte, ...o });
/** Lista de verificação: itens = [[chave, texto], …]; todos feitos → sim, algum em falta → nao. */
export const lista = (texto, ref, itens, sim, nao, o = {}) => ({ tipo: "lista", texto, ref, itens: itens.map(([chave, t]) => ({ chave, texto: t })), sim, nao, ...o });
export const fim = (tipoAvaria, ref, causa, acao, o = {}) => ({ tipo: "fim", tipoAvaria, ref, causa, acao, ...o });
export const SEM_TENSAO = "Sem tensão: regras de ouro cumpridas no circuito em causa.";
