// Estado da subscrição de cada cliente (docs/PROTOCOLO-PLANOS.md §2).
//
// Fonte de verdade: dados/planos/<cliente>.json — uma linha JSON "plana"
// (só texto, null e true/false), para que o domus.sh a consiga ler e escrever
// sem ferramentas extra:
//   {"plano":"conforto","estado":"ativo","desde":"...Z","proximo_pagamento":"...Z",
//    "aviso_ate":null,"gerido":"stripe","stripe_cliente":"cus_...",
//    "stripe_subscricao":"sub_...","teste_usado":true,"atualizado":"...Z"}
// Os seis primeiros campos são exatamente o `_plano` retido (§2).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { escreverAtomico, iso, somarDias } from './util.js';

export const PLANOS = ['base', 'conforto', 'premium'];
export const ESTADOS = ['ativo', 'teste', 'em_atraso', 'suspenso', 'cancelado'];
export const GERIDO = ['stripe', 'manual'];
/** Códigos de cliente: os mesmos do domus.sh (RE_ID). */
export const RE_CLIENTE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
/** Utilizadores MQTT internos: nunca são clientes. */
export const RESERVADOS = new Set(['admin', 'motor', 'pagamentos']);
export const CAMPOS_PLANO = ['plano', 'estado', 'desde', 'proximo_pagamento', 'aviso_ate', 'gerido'];
const CAMPOS_FICHEIRO = [...CAMPOS_PLANO, 'stripe_cliente', 'stripe_subscricao', 'teste_usado', 'atualizado'];
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RE_STRIPE_ID = /^[A-Za-z0-9_]{1,255}$/;

export function clienteValido(c) {
  return typeof c === 'string' && RE_CLIENTE.test(c) && !RESERVADOS.has(c);
}

/** Estados "modo básico" (§3). */
export function modoBasico(estado) {
  return estado === 'suspenso' || estado === 'cancelado';
}

/**
 * Valida um registo lido do disco. Devolve o registo normalizado (todos os
 * campos presentes) ou lança um Error com a razão.
 */
export function validarRegisto(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('não é um objeto JSON');
  for (const k of Object.keys(v)) if (!CAMPOS_FICHEIRO.includes(k)) throw new Error(`campo desconhecido "${k}"`);
  if (!PLANOS.includes(v.plano)) throw new Error(`plano inválido ${JSON.stringify(v.plano)}`);
  if (!ESTADOS.includes(v.estado)) throw new Error(`estado inválido ${JSON.stringify(v.estado)}`);
  if (!GERIDO.includes(v.gerido)) throw new Error(`"gerido" inválido ${JSON.stringify(v.gerido)}`);
  for (const k of ['desde', 'proximo_pagamento', 'aviso_ate', 'atualizado']) {
    const x = v[k];
    if (x !== undefined && x !== null && !(typeof x === 'string' && RE_ISO.test(x) && !Number.isNaN(Date.parse(x)))) {
      throw new Error(`"${k}" não é uma data ISO (AAAA-MM-DDTHH:MM:SSZ)`);
    }
  }
  if (typeof v.desde !== 'string') throw new Error('falta "desde"');
  for (const k of ['stripe_cliente', 'stripe_subscricao']) {
    const x = v[k];
    if (x !== undefined && x !== null && !(typeof x === 'string' && RE_STRIPE_ID.test(x))) throw new Error(`"${k}" inválido`);
  }
  if (v.teste_usado !== undefined && typeof v.teste_usado !== 'boolean') throw new Error('"teste_usado" não é true/false');
  return {
    plano: v.plano,
    estado: v.estado,
    desde: v.desde,
    proximo_pagamento: v.proximo_pagamento ?? null,
    aviso_ate: v.aviso_ate ?? null,
    gerido: v.gerido,
    stripe_cliente: v.stripe_cliente ?? null,
    stripe_subscricao: v.stripe_subscricao ?? null,
    teste_usado: v.teste_usado ?? false,
    atualizado: v.atualizado ?? null,
  };
}

/** Conteúdo exato de `domus/<c>/_plano` (§2), com a ordem dos campos fixa. */
export function payloadPlano(r) {
  return JSON.stringify({
    plano: r.plano,
    estado: r.estado,
    desde: r.desde,
    proximo_pagamento: r.proximo_pagamento,
    aviso_ate: r.aviso_ate,
    gerido: r.gerido,
  });
}

/**
 * Calcula o novo registo a partir do atual e do alvo pedido.
 * Regras:
 *  - `em_atraso`: `aviso_ate` = agora + diasAviso na primeira vez; mantém-se
 *    enquanto o cliente continuar em atraso. Se `aviso_ate` já passou → `suspenso`.
 *    Um cliente `suspenso` que continue sem pagar fica `suspenso`.
 *  - `suspenso` mantém `aviso_ate` (data em que acabou o aviso); os outros estados limpam-no.
 *  - `desde` = quando mudou o plano ou o estado (mantém-se se nada mudou).
 * @param {object|null} atual
 * @param {{plano:string, estado:string, proximo_pagamento?:string|null, gerido:string,
 *          stripe_cliente?:string|null, stripe_subscricao?:string|null, teste_usado?:boolean}} alvo
 * @param {Date} agora
 * @param {number} diasAviso
 */
export function transicionar(atual, alvo, agora, diasAviso) {
  let estado = alvo.estado;
  let avisoAte = null;
  if (estado === 'em_atraso') {
    const continua = atual && (atual.estado === 'em_atraso' || atual.estado === 'suspenso') && atual.aviso_ate;
    avisoAte = continua ? atual.aviso_ate : iso(somarDias(agora, diasAviso));
    if (atual?.estado === 'suspenso' || Date.parse(avisoAte) <= agora.getTime()) estado = 'suspenso';
  } else if (estado === 'suspenso') {
    avisoAte = atual?.aviso_ate ?? null;
  }
  const mudou = !atual || atual.plano !== alvo.plano || atual.estado !== estado;
  return {
    plano: alvo.plano,
    estado,
    desde: mudou ? iso(agora) : atual.desde,
    proximo_pagamento: modoBasico(estado) ? null : (alvo.proximo_pagamento ?? null),
    aviso_ate: avisoAte,
    gerido: alvo.gerido,
    stripe_cliente: alvo.stripe_cliente !== undefined ? alvo.stripe_cliente : (atual?.stripe_cliente ?? null),
    stripe_subscricao: alvo.stripe_subscricao !== undefined ? alvo.stripe_subscricao : (atual?.stripe_subscricao ?? null),
    teste_usado: Boolean(alvo.teste_usado || atual?.teste_usado),
    atualizado: iso(agora),
  };
}

/** Os seis campos de `_plano` mudaram? (para não republicar sem necessidade) */
export function planoMudou(a, b) {
  if (!a || !b) return true;
  return CAMPOS_PLANO.some((k) => a[k] !== b[k]);
}

/** Leitura e escrita de dados/planos/<c>.json. */
export class ArmazemPlanos {
  constructor(pasta) {
    this.pasta = pasta;
  }

  caminho(c) {
    if (!RE_CLIENTE.test(c)) throw new Error(`código de cliente inválido: ${c}`);
    return join(this.pasta, `${c}.json`);
  }

  /** Registo do cliente, ou null se não existir. Lança se o ficheiro for inválido. */
  async ler(c) {
    let texto;
    try {
      texto = await readFile(this.caminho(c), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    try {
      return validarRegisto(JSON.parse(texto));
    } catch (e) {
      throw new Error(`dados/planos/${c}.json inválido: ${e.message}`);
    }
  }

  async gravar(c, registo) {
    const r = validarRegisto(registo);
    await escreverAtomico(this.caminho(c), `${JSON.stringify(r)}\n`);
  }

  /** Códigos de cliente com ficheiro, por ordem. */
  async clientes() {
    let nomes;
    try {
      nomes = await readdir(this.pasta);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return nomes
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -5))
      .filter((c) => RE_CLIENTE.test(c))
      .sort();
  }

  /** Procura o cliente com este cliente Stripe (cus_...). */
  async porClienteStripe(idCliente) {
    if (!idCliente) return null;
    for (const c of await this.clientes()) {
      try {
        if ((await this.ler(c))?.stripe_cliente === idCliente) return c;
      } catch { /* ficheiro inválido: ignora na procura */ }
    }
    return null;
  }
}
