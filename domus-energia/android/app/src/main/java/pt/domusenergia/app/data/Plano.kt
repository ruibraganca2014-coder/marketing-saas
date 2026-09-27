package pt.domusenergia.app.data

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Planos e subscrição (docs/PROTOCOLO-PLANOS.md §1–§3). Código puro (só org.json), testado em JVM.
 *
 * A tabela de funcionalidades é a mesma do motor e do site: [Planos.permite] decide o que a app mostra
 * desbloqueado. É só apresentação — quem manda é o motor (recusa com "Disponível a partir do plano
 * Conforto.") e o servidor (ACL só de leitura para os suspensos).
 */
object Planos {
    const val BASE = "base"
    const val CONFORTO = "conforto"
    const val PREMIUM = "premium"
    val TODOS = listOf(BASE, CONFORTO, PREMIUM)

    // Estados (`estado` em `_plano`)
    const val ATIVO = "ativo"
    const val TESTE = "teste"
    const val EM_ATRASO = "em_atraso"
    const val SUSPENSO = "suspenso"
    const val CANCELADO = "cancelado"
    val ESTADOS = listOf(ATIVO, TESTE, EM_ATRASO, SUSPENSO, CANCELADO)

    // Quem cobra (`gerido`)
    const val STRIPE = "stripe"
    const val MANUAL = "manual"

    // Funcionalidades (`chave`, §1)
    const val CONTROLO = "controlo"
    const val AUTOMACOES = "automacoes"
    const val CENAS = "cenas"
    const val HISTORICO = "historico"
    const val RELATORIO = "relatorio"
    const val ALARME = "alarme"
    const val NOTIFICACOES = "notificacoes"
    const val SAUDE = "saude"
    const val ENERGIA = "energia"
    const val RELATORIO_DIARIO = "relatorio_diario"
    const val LOCAL = "local"
    const val SUPORTE_PRIORITARIO = "suporte_prioritario"

    /** Tabela única (§1): funcionalidade → plano mínimo. Chave desconhecida = não permitida. */
    private val MINIMO: Map<String, String> = mapOf(
        CONTROLO to BASE, AUTOMACOES to BASE, CENAS to BASE, HISTORICO to BASE, RELATORIO to BASE,
        ALARME to CONFORTO, NOTIFICACOES to CONFORTO, SAUDE to CONFORTO, ENERGIA to CONFORTO, RELATORIO_DIARIO to CONFORTO,
        LOCAL to PREMIUM, SUPORTE_PRIORITARIO to PREMIUM,
    )
    val FUNCIONALIDADES: Set<String> get() = MINIMO.keys

    /** `suspenso`/`cancelado` = modo básico: a app só mostra o ecrã "Subscrição suspensa". */
    fun bloqueada(estado: String): Boolean = estado == SUSPENSO || estado == CANCELADO

    /**
     * Pode usar a funcionalidade [chave] com o [plano] no [estado]? `ativo`, `teste` e `em_atraso` dão as
     * funcionalidades do plano; `suspenso`/`cancelado` nenhuma. Plano, estado ou chave desconhecidos: não.
     */
    fun permite(plano: String, estado: String, chave: String): Boolean {
        if (estado !in ESTADOS || bloqueada(estado)) return false
        val nivel = TODOS.indexOf(plano)
        val minimo = MINIMO[chave]?.let(TODOS::indexOf) ?: return false
        return nivel >= 0 && nivel >= minimo
    }

    /** Plano mais barato que tem [chave] (para "Disponível no plano Conforto"); `null` se a chave não existir. */
    fun planoMinimo(chave: String): String? = MINIMO[chave]

    fun nome(plano: String): String = when (plano) {
        BASE -> "Base"
        CONFORTO -> "Conforto"
        PREMIUM -> "Premium"
        else -> plano
    }

    /** Preço mensal com IVA (§1). */
    fun preco(plano: String): String = when (plano) {
        BASE -> "4,99 €/mês"
        CONFORTO -> "9,99 €/mês"
        PREMIUM -> "19,99 €/mês"
        else -> ""
    }

    /** O que inclui cada plano (texto dos cartões do "Mudar de plano"; igual ao site). */
    fun inclui(plano: String): List<String> = when (plano) {
        BASE -> listOf("App e área de cliente", "Controlo à distância", "Automações e cenas", "Histórico e relatório da casa")
        CONFORTO -> listOf(
            "Tudo o do plano Base",
            "Modos Fora, Noite e Férias, com alarme",
            "Notificações no telemóvel",
            "Saúde dos aparelhos",
            "Energia: hoje, ontem e mês",
            "Relatório diário",
        )
        PREMIUM -> listOf("Tudo o do plano Conforto", "Raspberry Pi em casa (brevemente)", "Suporte prioritário")
        else -> emptyList()
    }

    /** "Disponível no plano Conforto — mudar de plano" (texto do cadeado). */
    fun textoBloqueado(chave: String): String = "Disponível no plano ${nome(planoMinimo(chave) ?: CONFORTO)} — mudar de plano"

    /** Início da mensagem com que o motor recusa uma funcionalidade fora do plano (§3). */
    const val ERRO_MOTOR = "Disponível a partir do plano"

    fun eErroDePlano(mensagem: String?): Boolean = mensagem?.startsWith(ERRO_MOTOR) == true
}

/**
 * Estado da subscrição (`domus/<c>/_plano`, retido, publicado só pelo servidor).
 * @property aviso `aviso_ate`: data-limite do aviso de pagamento em atraso (15 dias).
 */
data class Subscricao(
    val plano: String,
    val estado: String,
    val desde: Instant? = null,
    val proximoPagamento: Instant? = null,
    val avisoAte: Instant? = null,
    val gerido: String = Planos.MANUAL,
) {
    fun permite(chave: String): Boolean = Planos.permite(plano, estado, chave)

    val bloqueada: Boolean get() = Planos.bloqueada(estado)
    val emAtraso: Boolean get() = estado == Planos.EM_ATRASO
    val manual: Boolean get() = gerido != Planos.STRIPE

    companion object {
        /** Sem `_plano` retido (§2): clientes antigos não perdem nada. */
        val PADRAO = Subscricao(Planos.CONFORTO, Planos.ATIVO, gerido = Planos.MANUAL)

        const val TOPICO = "_plano"

        /**
         * Lê `_plano`. `null` se não for um objeto JSON com `plano` e `estado` conhecidos (quem chama
         * mantém o que tinha). Datas inválidas ou `null` ficam `null`; `gerido` diferente de `stripe` = manual.
         */
        fun ler(payload: String): Subscricao? {
            val o = V3.objeto(payload) ?: return null
            val plano = (o.opt("plano") as? String)?.trim()?.lowercase()
            val estado = (o.opt("estado") as? String)?.trim()?.lowercase()
            if (plano !in Planos.TODOS || estado !in Planos.ESTADOS) return null
            return Subscricao(
                plano = plano!!,
                estado = estado!!,
                desde = V3.instante(o.opt("desde")),
                proximoPagamento = V3.instante(o.opt("proximo_pagamento")),
                avisoAte = V3.instante(o.opt("aviso_ate")),
                gerido = if (o.opt("gerido") == Planos.STRIPE) Planos.STRIPE else Planos.MANUAL,
            )
        }
    }
}

/** Textos da subscrição em palavras simples (pt-PT). */
object TextosPlano {
    private val PT: Locale = Locale.forLanguageTag("pt-PT")
    private val DATA = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", PT)

    /** "1 de novembro de 2026" (hora de Lisboa). */
    fun data(t: Instant): String = DATA.format(t.atZone(Textos.LISBOA))

    /** Etiqueta curta do estado. */
    fun rotuloEstado(estado: String): String = when (estado) {
        Planos.ATIVO -> "Ativa"
        Planos.TESTE -> "Mês grátis"
        Planos.EM_ATRASO -> "Pagamento em atraso"
        Planos.SUSPENSO -> "Suspensa"
        Planos.CANCELADO -> "Cancelada"
        else -> estado
    }

    /** Frase que explica o estado. */
    fun explicacao(s: Subscricao): String = when (s.estado) {
        Planos.ATIVO -> if (s.manual) "A sua subscrição está em dia. É gerida diretamente pela Domus Energia."
        else "A sua subscrição está em dia. O pagamento é feito automaticamente todos os meses."
        Planos.TESTE -> "Está no primeiro mês grátis." +
            (s.proximoPagamento?.let { " O primeiro pagamento é a ${data(it)}." } ?: "")
        Planos.EM_ATRASO -> "O último pagamento falhou." + (s.avisoAte?.let { " Tem até ${data(it)} para o atualizar." } ?: "")
        Planos.SUSPENSO -> "A subscrição está suspensa por falta de pagamento. Os interruptores da casa continuam a funcionar, " +
            "mas a app, as automações, as cenas e o alarme estão parados."
        Planos.CANCELADO -> "A subscrição foi cancelada. Os interruptores da casa continuam a funcionar, " +
            "mas a app, as automações, as cenas e o alarme estão parados."
        else -> ""
    }

    /** Aviso de pagamento em atraso, com a data-limite (`aviso_ate`). */
    fun avisoAtraso(s: Subscricao): String {
        val ate = s.avisoAte?.let { " até ${data(it)}" } ?: ""
        return "O último pagamento falhou. Atualize o pagamento$ate para não perder o acesso à app, às automações e ao alarme."
    }

    /** "Próximo pagamento: 1 de novembro de 2026" (ou `null` se não houver/não se aplicar). */
    fun proximoPagamento(s: Subscricao): String? {
        if (s.bloqueada || s.emAtraso) return null // em atraso: a data já passou; vale o aviso_ate
        val p = s.proximoPagamento ?: return null
        return data(p)
    }
}
