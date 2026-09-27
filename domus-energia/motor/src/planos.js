// Planos e subscrições (docs/PROTOCOLO-PLANOS.md §1–§3): tabela única de
// funcionalidades por plano, validação do `_plano` retido e mensagens pt-PT
// de funcionalidade bloqueada. Funções puras (sem estado nem rede).

import { eObjeto } from './util.js';

export const PLANOS = ['base', 'conforto', 'premium'];
export const ESTADOS_PLANO = ['ativo', 'teste', 'em_atraso', 'suspenso', 'cancelado'];
export const GERIDO = ['stripe', 'manual'];
export const NOMES_PLANOS = { base: 'Base', conforto: 'Conforto', premium: 'Premium' };

/** Sem `_plano` retido: clientes antigos não perdem nada (§2). */
export const PLANO_PADRAO = Object.freeze({ plano: 'conforto', estado: 'ativo', gerido: 'manual' });

/**
 * Funcionalidade (`chave`) → planos que a incluem (§1). Tabela única: o site e
 * a app usam a mesma.
 */
export const FUNCIONALIDADES = Object.freeze({
  controlo: ['base', 'conforto', 'premium'],
  automacoes: ['base', 'conforto', 'premium'],
  cenas: ['base', 'conforto', 'premium'],
  historico: ['base', 'conforto', 'premium'],
  relatorio: ['base', 'conforto', 'premium'],
  alarme: ['conforto', 'premium'], // modos fora/noite/ferias; `casa` é sempre permitido
  notificacoes: ['conforto', 'premium'],
  saude: ['conforto', 'premium'],
  energia: ['conforto', 'premium'],
  relatorio_diario: ['conforto', 'premium'],
  local: ['premium'],
  suporte_prioritario: ['premium'],
});

/** `suspenso`/`cancelado` = modo básico (§3): nenhuma funcionalidade do plano. */
export function modoBasico(estado) {
  return estado === 'suspenso' || estado === 'cancelado';
}

/**
 * A funcionalidade `chave` está disponível para este plano e estado?
 * `ativo`, `teste` e `em_atraso` têm as funcionalidades do plano; `suspenso` e
 * `cancelado` não têm nenhuma. Chave, plano ou estado desconhecidos → false.
 * @param {string} plano
 * @param {string} estado
 * @param {string} chave
 */
export function permite(plano, estado, chave) {
  if (!ESTADOS_PLANO.includes(estado) || modoBasico(estado)) return false;
  const planos = FUNCIONALIDADES[chave];
  return !!planos && planos.includes(plano);
}

/** Plano mais barato que inclui a funcionalidade (ou null). */
export function planoMinimo(chave) {
  return PLANOS.find((p) => FUNCIONALIDADES[chave]?.includes(p)) ?? null;
}

/**
 * Mensagem pt-PT para um pedido de uma funcionalidade que o cliente não tem.
 * Ex.: "Disponível a partir do plano Conforto."
 */
export function mensagemBloqueio(plano, estado, chave) {
  if (estado === 'suspenso') return 'Subscrição suspensa. Reative a subscrição para voltar a usar esta funcionalidade.';
  if (estado === 'cancelado') return 'Subscrição cancelada. Reative a subscrição para voltar a usar esta funcionalidade.';
  const minimo = planoMinimo(chave);
  return minimo ? `Disponível a partir do plano ${NOMES_PLANOS[minimo]}.` : 'Funcionalidade não disponível.';
}

const CAMPOS = ['plano', 'estado', 'desde', 'proximo_pagamento', 'aviso_ate', 'gerido'];
const DATA_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Valida (estritamente) o payload de `_plano` (§2). `plano` e `estado` são
 * obrigatórios; `desde`, `proximo_pagamento`, `aviso_ate` (data ISO ou null) e
 * `gerido` são opcionais; qualquer outro campo é erro.
 * @param {unknown} v
 * @returns {{ok: true, plano: {plano: string, estado: string, gerido: string, desde: string|null, proximo_pagamento: string|null, aviso_ate: string|null}} | {ok: false, erro: string}}
 */
export function validarPlano(v) {
  const erro = (e) => ({ ok: false, erro: e });
  if (!eObjeto(v)) return erro('não é um objeto JSON');
  for (const k of Object.keys(v)) if (!CAMPOS.includes(k)) return erro(`campo desconhecido "${k}"`);
  if (!PLANOS.includes(v.plano)) return erro(`plano desconhecido ${JSON.stringify(v.plano ?? null)}`);
  if (!ESTADOS_PLANO.includes(v.estado)) return erro(`estado desconhecido ${JSON.stringify(v.estado ?? null)}`);
  if (v.gerido !== undefined && !GERIDO.includes(v.gerido)) return erro(`"gerido" desconhecido ${JSON.stringify(v.gerido)}`);
  for (const k of ['desde', 'proximo_pagamento', 'aviso_ate']) {
    const x = v[k];
    if (x === undefined || x === null) continue;
    if (typeof x !== 'string' || !DATA_RE.test(x) || Number.isNaN(Date.parse(x))) return erro(`"${k}" não é uma data ISO 8601`);
  }
  return {
    ok: true,
    plano: {
      plano: v.plano,
      estado: v.estado,
      gerido: v.gerido ?? 'manual',
      desde: v.desde ?? null,
      proximo_pagamento: v.proximo_pagamento ?? null,
      aviso_ate: v.aviso_ate ?? null,
    },
  };
}
