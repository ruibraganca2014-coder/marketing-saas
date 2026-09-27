// Planos e subscrições (docs/PROTOCOLO-PLANOS.md §2–§3): segue o `_plano`
// retido de cada cliente (publicado só pelo servidor) e aplica as mudanças de
// plano/estado: alarme para `casa` na descida de plano, `_saude`/`_energia`
// apagados quando deixam de estar incluídos, e no modo básico
// (`suspenso`/`cancelado`) cancela as execuções pendentes.
//
// As verificações "esta funcionalidade está incluída?" estão espalhadas pelos
// pontos de entrada (motor-casa, motor-automacoes, motor-saude, motor.js) e
// usam sempre `this.pode(c, chave)`, que consulta a tabela única de planos.js.
//
// Métodos misturados na classe Motor (Object.assign no fim de motor.js).

import { PLANO_PADRAO, permite, mensagemBloqueio, modoBasico, validarPlano } from './planos.js';
import { TIPO_DO_MODO } from './motor-casa.js';
import { percorrerAcoes } from './validacao.js';
import { NOMES_MODOS } from './relatorio.js';
import { lerJson, texto } from './util.js';

/** @typedef {import('./motor.js').Motor} Motor */
/** @typedef {import('./motor.js').Cliente} Cliente */
/** @typedef {{plano: string, estado: string, gerido: string, desde?: string|null, proximo_pagamento?: string|null, aviso_ate?: string|null}} PlanoCliente */

/** Primeiro modo armado (fora/noite/ferias) usado no gatilho ou nas ações, ou null. */
function modoArmado(quando, acoes) {
  if (quando?.tipo === 'modo' && TIPO_DO_MODO[quando.modo]) return quando.modo;
  let modo = null;
  percorrerAcoes(acoes, (x) => {
    if (!modo && x?.acao === 'modo' && TIPO_DO_MODO[x.modo]) modo = x.modo;
  });
  return modo;
}

/** Igual ignorando `ativa` (o cliente pode sempre ativar/desativar o que já tinha). */
function igualSemAtiva(a, b) {
  return JSON.stringify({ ...a, ativa: null }) === JSON.stringify({ ...b, ativa: null });
}

/** @type {ThisType<Motor> & Record<string, Function>} */
export const metodosPlanos = {
  /** Plano em vigor (sem `_plano` = conforto/ativo/manual). @param {Cliente} c @returns {PlanoCliente} */
  planoDe(c) {
    return c.plano ?? PLANO_PADRAO;
  },

  /** A funcionalidade `chave` está incluída no plano atual do cliente? @param {Cliente} c */
  pode(c, chave) {
    const p = this.planoDe(c);
    return permite(p.plano, p.estado, chave);
  },

  /** Mensagem pt-PT de funcionalidade bloqueada ("Disponível a partir do plano Conforto."). @param {Cliente} c */
  bloqueio(c, chave) {
    const p = this.planoDe(c);
    return mensagemBloqueio(p.plano, p.estado, chave);
  },

  /**
   * `_plano` (retido; publicado pelo serviço `pagamentos` ou pelo `domus.sh`,
   * nunca pelo cliente — ACL). Mensagem vazia = apagado → plano por omissão.
   * Inválido → ignorado (fica o plano anterior).
   */
  aoPlano(codigo, payload) {
    const c = this.cliente(codigo);
    let novo = null;
    if (texto(payload) !== '') {
      const r = validarPlano(lerJson(payload));
      if (!r.ok) {
        this.log.aviso(`[plano] ${codigo}: _plano inválido (${r.erro}); ignorado`);
        return;
      }
      novo = r.plano;
    }
    const antes = this.planoDe(c);
    c.plano = novo;
    const depois = this.planoDe(c);
    this.guardar();
    if (antes.plano === depois.plano && antes.estado === depois.estado) return;
    this.log.info(`[plano] ${codigo}: ${antes.plano}/${antes.estado} → ${depois.plano}/${depois.estado}`);
    if (modoBasico(depois.estado) && !modoBasico(antes.estado)) this.pararExecucoes(c);
    // Antes da primeira sincronização (arranque) ainda não se conhece o estado
    // retido do cliente: as restrições são aplicadas em `sincronizar`.
    if (this.sincronizados.has(codigo)) this.imporPlano(c, antes);
  },

  /**
   * Aplica o plano atual ao estado publicado:
   * - sem `alarme` (plano base ou modo básico) e alarme armado / modo ≠ casa →
   *   modo `casa`, evento `modo` com `por: "plano"`;
   * - `_saude`/`_energia` fora do plano → apagados (mensagem retida vazia);
   *   de volta ao plano → republicados logo.
   * Uma subida de plano não muda mais nada.
   * @param {Cliente} c
   * @param {PlanoCliente|null} antes plano anterior (null = sincronização: apaga sempre o que não é permitido)
   */
  imporPlano(c, antes) {
    if (!this.pode(c, 'alarme') && (c.alarme?.ativo || (c.modo && c.modo.modo !== 'casa'))) {
      this.log.info(`[plano] ${c.codigo}: alarme/modos fora do plano — modo casa`);
      this.mudarModo(c, 'casa', { por: 'plano' });
    }
    const tinha = (k) => (antes ? permite(antes.plano, antes.estado, k) : null);
    const topicos = { saude: '_saude', energia: '_energia' };
    for (const [k, t] of Object.entries(topicos)) {
      if (!this.pode(c, k)) {
        if (tinha(k) === false) continue;
        this.publicar(`domus/${c.codigo}/${t}`, '', true);
        if (k === 'saude') {
          c.saudeTexto = null;
          c.saudeAssinatura = null;
          c.saudeSuja = false;
        } else c.energiaTexto = null;
      } else if (tinha(k) === false && c.aparelhos) {
        if (k === 'saude') {
          c.saudeTexto = null;
          c.saudeAssinatura = null;
          this.publicarSaude(c, true);
        } else this.publicarEnergia(c, true);
      }
    }
  },

  /**
   * Entrada no modo básico: cancela tudo o que estava pendente (sequências com
   * `esperar`, reversões `durante_s`, contagens de potência e de "há X s",
   * confirmações). Por segurança, o que o motor ligou com `durante_s` é
   * desligado já (em vez de ficar ligado sem ninguém o desligar).
   * @param {Cliente} c
   */
  pararExecucoes(c) {
    const cod = c.codigo;
    const seq = this.sequencias.filter((s) => s.cliente === cod).length;
    this.sequencias = this.sequencias.filter((s) => s.cliente !== cod);
    const minhas = this.reversoes.filter((r) => r.cliente === cod);
    this.reversoes = this.reversoes.filter((r) => r.cliente !== cod);
    for (const r of minhas) {
      const ap = c.aparelhos?.get(r.aparelho);
      if (!r.ligar && ap?.canais.has(r.canal)) this.enviarLigar(c, ap, r.canal, false, null);
    }
    for (const chave of [...this.potencia.keys()]) if (chave.startsWith(`${cod}/`)) this.potencia.delete(chave);
    c.duracoes = {};
    c.esperas = [];
    this.log.info(`[plano] ${cod}: modo básico — ${seq} sequência(s) e ${minhas.length} temporizador(es) cancelados`);
    this.guardar();
  },

  /**
   * Automações novas ou alteradas que usam os modos fora/noite/férias (gatilho
   * `modo` ou ação `modo`) num plano sem alarme → mensagem de erro (pt-PT) ou
   * null. As que o cliente já tinha e não mudaram (exceto `ativa`) são
   * aceites, para uma descida de plano não bloquear a edição das outras; na
   * execução, a ação `modo` continua recusada.
   * @param {Cliente} c
   * @param {import('./validacao.js').Automacao[]} lista
   */
  erroPlanoAutomacoes(c, lista) {
    if (this.pode(c, 'alarme')) return null;
    const antigas = new Map((c.automacoes ?? []).map((a) => [a.id, a]));
    for (const a of lista) {
      const antiga = antigas.get(a.id);
      if (antiga && igualSemAtiva(antiga, a)) continue;
      const modo = modoArmado(a.quando, a.entao);
      if (modo) return `Automação "${a.id}": o modo ${NOMES_MODOS[modo]} não está incluído no seu plano. ${this.bloqueio(c, 'alarme')}`;
    }
    return null;
  },

  /** Como `erroPlanoAutomacoes`, para as cenas. @param {Cliente} c @param {import('./validacao.js').Cena[]} lista */
  erroPlanoCenas(c, lista) {
    if (this.pode(c, 'alarme')) return null;
    const antigas = new Map((c.cenas ?? []).map((x) => [x.id, x]));
    for (const x of lista) {
      const antiga = antigas.get(x.id);
      if (antiga && JSON.stringify(antiga) === JSON.stringify(x)) continue;
      const modo = modoArmado(null, x.acoes);
      if (modo) return `Cena "${x.id}": o modo ${NOMES_MODOS[modo]} não está incluído no seu plano. ${this.bloqueio(c, 'alarme')}`;
    }
    return null;
  },
};
