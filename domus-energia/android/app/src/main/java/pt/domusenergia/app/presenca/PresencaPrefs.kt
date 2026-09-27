package pt.domusenergia.app.presenca

import android.content.Context
import android.content.SharedPreferences
import pt.domusenergia.app.data.Local
import java.util.UUID

/**
 * O que a deteção de presença guarda neste telemóvel (SharedPreferences privadas "presenca").
 * Nunca guarda posições além do centro da zona de casa, e nunca as envia.
 */
class PresencaPrefs(context: Context) {
    val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(NOME, Context.MODE_PRIVATE)

    var ativa: Boolean
        get() = prefs.getBoolean("ativa", false)
        set(v) = prefs.edit().putBoolean("ativa", v).apply()

    var nome: String
        get() = prefs.getString("nome", "").orEmpty()
        set(v) = prefs.edit().putString("nome", v.trim().take(40)).apply()

    /** Identificador deste telemóvel no `_presenca` ("tel-" + 12 hex), gerado uma vez. */
    val pessoa: String
        get() = prefs.getString("pessoa", null) ?: Sinais.novoId(UUID.randomUUID().toString()).also {
            prefs.edit().putString("pessoa", it).apply()
        }

    var casa: Local?
        get() = if (!prefs.contains("lat")) null else Local(
            java.lang.Double.longBitsToDouble(prefs.getLong("lat", 0)),
            java.lang.Double.longBitsToDouble(prefs.getLong("lon", 0)),
        )
        set(v) {
            val e = prefs.edit()
            if (v == null) e.remove("lat").remove("lon") else {
                e.putLong("lat", java.lang.Double.doubleToRawLongBits(v.lat)).putLong("lon", java.lang.Double.doubleToRawLongBits(v.lon))
            }
            e.apply()
        }

    var casaTexto: String?
        get() = prefs.getString("casa_texto", null)
        set(v) = prefs.edit().putString("casa_texto", v).apply()

    var raioM: Float
        get() = Sinais.raio(prefs.getFloat("raio", Sinais.RAIO_PADRAO_M))
        set(v) = prefs.edit().putFloat("raio", Sinais.raio(v)).apply()

    /** SSID do Wi-Fi de casa (`null` = só a zona). */
    var wifi: String?
        get() = prefs.getString("wifi", null)
        set(v) = prefs.edit().putString("wifi", v).apply()

    /** Último evento da zona: `true` entrou, `false` saiu, `null` ainda nenhum. */
    var zona: Boolean?
        get() = when (prefs.getInt("zona", -1)) { 1 -> true; 0 -> false; else -> null }
        set(v) = prefs.edit().putInt("zona", when (v) { true -> 1; false -> 0; null -> -1 }).apply()

    var erro: String?
        get() = prefs.getString("erro", null)
        set(v) = prefs.edit().putString("erro", v).apply()

    var debounce: DebounceEstado
        get() = DebounceEstado(
            publicado = triplo(prefs.getInt("publicado", -1)),
            candidato = triplo(prefs.getInt("candidato", -1)),
            desdeMs = prefs.getLong("desde", -1).takeIf { it >= 0 },
        )
        set(v) {
            // commit(): o receptor da geofence e o worker podem terminar logo a seguir.
            prefs.edit()
                .putInt("publicado", int(v.publicado))
                .putInt("candidato", int(v.candidato))
                .putLong("desde", v.desdeMs ?: -1)
                .commit()
        }

    /** Ao desligar: esquece o estado (a zona e o Wi-Fi escolhidos ficam para a próxima vez). */
    fun limparEstado() {
        prefs.edit().remove("zona").remove("publicado").remove("candidato").remove("desde").remove("erro").commit()
    }

    private fun triplo(i: Int): Boolean? = when (i) { 1 -> true; 0 -> false; else -> null }
    private fun int(b: Boolean?): Int = when (b) { true -> 1; false -> 0; null -> -1 }

    companion object {
        const val NOME = "presenca"
    }
}
