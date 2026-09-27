package pt.domusenergia.app.data

import java.text.Normalizer

/**
 * Ações que merecem uma confirmação antes de guardar/executar: mexer no **disjuntor geral** (a casa inteira
 * fica sem luz) ou numa **carga perigosa** (aquecedor, termoacumulador, bomba…). Código puro.
 *
 * Disjuntor geral: os canais de um aparelho marcado `"geral": true` (medidor da casa inteira) ou, se nenhum
 * estiver marcado, os de um aparelho `medidor` cujo nome ou divisão tenha "geral"/"quadro" (sem ligar a
 * maiúsculas nem acentos). Num aparelho com vários circuitos, se algum tiver "geral"/"quadro" no nome só
 * esses contam (ex.: "Quadro geral" → canal "Geral", e não o "Termoacumulador"). As cargas perigosas
 * aparecem como tal e nunca como disjuntor.
 */
object Riscos {

    private val PALAVRAS = listOf("geral", "quadro")

    private fun normal(t: String) = Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
    private fun temPalavra(t: String?) = t != null && normal(t).let { n -> PALAVRAS.any { n.contains(it) } }

    private fun circuito(c: Canal) = c.funcao == Funcao.INTERRUPTOR || c.funcao == Funcao.LUZ

    /** Aparelhos que são o quadro/contador geral da casa. */
    fun aparelhosGerais(aparelhos: List<Aparelho>): List<Aparelho> {
        val marcados = aparelhos.filter { it.geral }
        if (marcados.isNotEmpty()) return marcados
        return aparelhos.filter { a -> a.medidor && (temPalavra(a.nome) || temPalavra(a.divisaoMostrada)) }
    }

    /** O canal [n] de [a] é o disjuntor geral (desligá-lo deixa a casa sem luz)? */
    fun ehDisjuntorGeral(aparelhos: List<Aparelho>, a: Aparelho, n: Int): Boolean {
        if (aparelhosGerais(aparelhos).none { it.id == a.id }) return false
        val c = a.canal(n) ?: return false
        if (!circuito(c) || c.perigosa) return false
        val candidatos = a.canais.filter { circuito(it) && !it.perigosa }
        val comNome = candidatos.filter { it.temNome && temPalavra(it.nome) }
        return if (candidatos.size > 1 && comNome.isNotEmpty()) c in comNome else true
    }

    /** "2 h", "30 min", "1 h 30 min", "45 s". */
    fun duracao(s: Int): String {
        if (s < 60) return "$s s"
        val h = s / 3600
        val m = (s % 3600) / 60
        return listOfNotNull(h.takeIf { it > 0 }?.let { "$it h" }, m.takeIf { it > 0 }?.let { "$it min" }).joinToString(" ")
            .ifEmpty { "$s s" }
    }

    /**
     * Frases (pt-PT) com as ações arriscadas de [acoes], incluindo as de dentro de SE/SENÃO, sem repetidas:
     * "Desligar o Quadro geral — a casa inteira fica sem luz.", "Ligar o Termoacumulador (carga perigosa) durante 2 h".
     */
    fun descrever(acoes: List<Acao>, aparelhos: List<Aparelho>): List<String> {
        val r = LinkedHashSet<String>()
        fun visitar(l: List<Acao>) {
            for (x in l) {
                val (id, n, verbo) = when (x) {
                    is Acao.Ligar -> Triple(x.aparelho, x.canal, if (x.ligar) LIGAR else DESLIGAR)
                    is Acao.Alternar -> Triple(x.aparelho, x.canal, ALTERNAR)
                    is Acao.Luz -> Triple(x.aparelho, x.canal, if (x.brilho > 0) LIGAR else DESLIGAR)
                    is Acao.Se -> { visitar(x.entao); visitar(x.senao); continue }
                    else -> continue
                }
                val a = aparelhos.firstOrNull { it.id == id } ?: continue
                val c = a.canal(n) ?: continue
                val durante = (x as? Acao.Ligar)?.duranteS?.takeIf { it > 0 }
                if (c.perigosa) {
                    val nome = if (c.temNome) c.nome else a.nome
                    r += when (verbo) {
                        LIGAR -> "Ligar o $nome (carga perigosa)" + (durante?.let { " durante ${duracao(it)}" } ?: "")
                        DESLIGAR -> "Desligar o $nome (carga perigosa)"
                        else -> "Alternar o $nome (carga perigosa)"
                    }
                } else if (ehDisjuntorGeral(aparelhos, a, n)) {
                    r += when (verbo) {
                        DESLIGAR -> "Desligar o ${a.nome} — a casa inteira fica sem luz." +
                            (durante?.let { " Volta a ligar ao fim de ${duracao(it)}." } ?: "")
                        LIGAR -> "Ligar o ${a.nome} (disjuntor geral da casa)" +
                            (durante?.let { " e desligá-lo ao fim de ${duracao(it)} — a casa inteira fica sem luz." } ?: "")
                        else -> "Alternar o ${a.nome} — se estiver ligado, a casa inteira fica sem luz."
                    }
                }
            }
        }
        visitar(acoes)
        return r.toList()
    }

    /**
     * Riscos de executar já a automação [a] ("Executar" / "Testar agora"): as ações arriscadas das suas ações,
     * incluindo as das cenas que ela executa (e das cenas dentro dessas, sem ciclos). Lista vazia = executar
     * sem perguntar. "Avaliar agora" não executa nada, por isso nunca usa isto.
     */
    fun daAutomacao(a: Automacao, aparelhos: List<Aparelho>, cenas: List<Cena> = emptyList()): List<String> =
        descrever(expandirCenas(a.entao, cenas), aparelhos)

    /** [acoes] com cada ação "executar cena" substituída pelas ações dessa cena (também dentro de SE/SENÃO). */
    fun expandirCenas(acoes: List<Acao>, cenas: List<Cena>, vistas: Set<String> = emptySet()): List<Acao> =
        acoes.flatMap { x ->
            when (x) {
                is Acao.Cena -> if (x.cena in vistas) emptyList()
                    else cenas.firstOrNull { it.id == x.cena }?.let { expandirCenas(it.acoes, cenas, vistas + x.cena) }.orEmpty()
                is Acao.Se -> listOf(x.copy(entao = expandirCenas(x.entao, cenas, vistas), senao = expandirCenas(x.senao, cenas, vistas)))
                else -> listOf(x)
            }
        }

    private const val LIGAR = 1
    private const val DESLIGAR = 2
    private const val ALTERNAR = 3
}
