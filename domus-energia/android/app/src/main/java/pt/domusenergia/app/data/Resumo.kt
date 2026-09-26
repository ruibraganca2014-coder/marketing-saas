package pt.domusenergia.app.data

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Resumo da casa (cartão do topo do ecrã "Casa" e "fundo vivo"). Código puro. */
data class Resumo(
    val potenciaW: Double = 0.0,
    val temMedidor: Boolean = false,
    val ligados: Int = 0,
    val circuitos: Int = 0,
    val portasAbertas: Int = 0,
    val portas: Int = 0,
    val alarme: Boolean? = null,
) {
    /** 0–1: potência total / 3500 W (docs/TEMA.md, "Fundo vivo"). */
    val calor: Float get() = (potenciaW / CALOR_MAX_W).toFloat().coerceIn(0f, 1f)

    /** 0–1: fração de interruptores/luzes ligados. */
    val luzes: Float get() = if (circuitos == 0) 0f else (ligados.toFloat() / circuitos).coerceIn(0f, 1f)

    companion object {
        const val CALOR_MAX_W = 3500.0

        fun de(aparelhos: List<Aparelho>, alarme: Alarme?): Resumo {
            var potencia = 0.0
            var temMedidor = false
            var ligados = 0
            var circuitos = 0
            var portasAbertas = 0
            var portas = 0
            for (a in aparelhos) {
                if (a.medidor) {
                    temMedidor = true
                    potencia += a.potenciaW ?: 0.0
                }
                for (c in a.canais) when (c.funcao) {
                    Funcao.INTERRUPTOR, Funcao.LUZ -> {
                        circuitos++
                        if (c.ligado == true) ligados++
                    }
                    Funcao.PORTA -> {
                        portas++
                        if (c.aberto == true) portasAbertas++
                    }
                }
            }
            return Resumo(potencia, temMedidor, ligados, circuitos, portasAbertas, portas, alarme?.ativo)
        }
    }
}

/** Textos com números e tempos, em pt-PT. */
object Textos {
    private val PT: Locale = Locale.forLanguageTag("pt-PT")
    val LISBOA: ZoneId = ZoneId.of("Europe/Lisbon")
    private val HORA = DateTimeFormatter.ofPattern("HH:mm", PT)
    private val DIA_HORA = DateTimeFormatter.ofPattern("d MMM, HH:mm", PT)

    /** "agora mesmo", "há 5 min", "há 3 h", "há 2 dias". */
    fun tempoRelativo(t: Instant?, agora: Instant): String? {
        if (t == null) return null
        val s = Duration.between(t, agora).seconds.coerceAtLeast(0)
        if (s < 45) return "agora mesmo"
        val min = Math.round(s / 60.0)
        if (min < 60) return "há $min min"
        val h = s / 3600
        if (h < 48) return "há $h h"
        return "há ${h / 24} dias"
    }

    /** "Sem notícias há 26 h". */
    fun semNoticias(t: Instant, agora: Instant): String = "Sem notícias há ${Duration.between(t, agora).toHours()} h"

    /** Hora local de Lisboa: "22:10" se for hoje, senão "26 set, 22:10". */
    fun quando(t: Instant, agora: Instant): String {
        val local = t.atZone(LISBOA)
        return if (local.toLocalDate() == agora.atZone(LISBOA).toLocalDate()) HORA.format(local) else DIA_HORA.format(local)
    }

    /** 1234.5 → "1 235 W"; 12.34 → "12,3 W" (números com vírgula decimal, como em Portugal). */
    fun potencia(w: Double): String =
        if (w >= 100) String.format(PT, "%,.0f W", w) else String.format(PT, "%.1f W", w)

    fun numero(v: Double, casas: Int): String = String.format(PT, "%.${casas}f", v)
}
