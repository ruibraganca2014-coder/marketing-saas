package pt.domusenergia.app.presenca

/**
 * Lógica pura (sem Android) da deteção de presença — docs/PROTOCOLO-MQTT-v3.md §8 e
 * docs/ANALISE-COMUNIDADE.md (#12: nunca confiar num só sinal; ~10 min de margem).
 *
 * Tempos em milissegundos desde a época (o relógio é passado de fora, para os testes).
 */

/**
 * Estado da máquina de "debounce", guardado entre execuções (a app pode estar fechada).
 *
 * @property publicado último valor enviado ao servidor (`null` = nunca enviado).
 * @property candidato último valor observado (`null` = ainda nenhum).
 * @property desdeMs quando o [candidato] começou a ser observado sem interrupção.
 */
data class DebounceEstado(
    val publicado: Boolean? = null,
    val candidato: Boolean? = null,
    val desdeMs: Long? = null,
)

object Debounce {
    /** O estado tem de se manter 10 min antes de se publicar. */
    const val ESTAVEL_MS = 10 * 60 * 1000L

    /**
     * Regista uma observação. Uma observação igual ao candidato não reinicia a contagem;
     * uma diferente recomeça a contar a partir de [agoraMs]. `null` (sinal desconhecido) não muda nada.
     */
    fun observar(e: DebounceEstado, emCasa: Boolean?, agoraMs: Long): DebounceEstado {
        if (emCasa == null) return e
        if (e.candidato == emCasa && e.desdeMs != null) return e
        return e.copy(candidato = emCasa, desdeMs = agoraMs)
    }

    /** Valor a publicar agora (estável há ≥ 10 min e diferente do publicado), ou `null`. */
    fun aPublicar(e: DebounceEstado, agoraMs: Long): Boolean? {
        val c = e.candidato ?: return null
        val desde = e.desdeMs ?: return null
        if (c == e.publicado) return null
        return if (agoraMs - desde >= ESTAVEL_MS) c else null
    }

    /** Depois de o servidor aceitar a publicação. */
    fun publicado(e: DebounceEstado, valor: Boolean): DebounceEstado = e.copy(publicado = valor)

    /** Quanto falta (ms) para voltar a verificar, ou `null` se não há nada pendente. */
    fun esperaMs(e: DebounceEstado, agoraMs: Long): Long? {
        val c = e.candidato ?: return null
        val desde = e.desdeMs ?: return null
        if (c == e.publicado) return null
        return (desde + ESTAVEL_MS - agoraMs).coerceAtLeast(0)
    }
}

/** Junta os dois sinais disponíveis num só "em casa?". */
object Sinais {
    /**
     * - Ligado ao Wi-Fi de casa → em casa (mesmo que o GPS diga o contrário: o GPS falha dentro de casa).
     * - Dentro da zona (geofence) → em casa.
     * - Fora da zona → fora (desde que não esteja no Wi-Fi de casa).
     * - Sem dados da zona e sem Wi-Fi de casa → desconhecido (não se muda nada: o Wi-Fi pode estar desligado).
     */
    fun combinar(dentroDaZona: Boolean?, wifiDeCasa: Boolean?): Boolean? = when {
        wifiDeCasa == true -> true
        dentroDaZona == true -> true
        dentroDaZona == false -> false
        else -> null
    }

    /** O raio da zona nunca fica abaixo de 100 m (o GPS do telemóvel erra dezenas de metros). */
    const val RAIO_MINIMO_M = 100f
    const val RAIO_PADRAO_M = 150f

    fun raio(pedido: Float?): Float = maxOf(RAIO_MINIMO_M, pedido ?: RAIO_PADRAO_M)

    /** Normaliza o SSID que o Android devolve (`"MinhaRede"` com aspas, ou `<unknown ssid>`). */
    fun ssid(bruto: String?): String? {
        val s = bruto?.trim()?.removeSurrounding("\"") ?: return null
        if (s.isEmpty() || s == "<unknown ssid>" || s == "0x") return null
        return s
    }

    /** Identificador estável deste telemóvel (gerado uma vez por instalação): "tel-" + 12 hex. */
    fun novoId(aleatorio: String): String =
        "tel-" + aleatorio.lowercase().filter { it in '0'..'9' || it in 'a'..'f' }.take(12).padEnd(12, '0')
}

/**
 * Resultado de uma verificação: o novo estado a guardar, o valor a publicar já (ou `null`) e
 * daqui a quanto tempo voltar a verificar (ou `null` se não há nada pendente).
 */
data class Verificacao(val estado: DebounceEstado, val publicar: Boolean?, val esperaMs: Long?)

object Verificar {
    /**
     * Um passo completo, usado pelo `PresencaWorker` (Android) a cada sinal (entrada/saída da zona,
     * verificação periódica, fim da espera de 10 min):
     * junta a zona e o Wi-Fi, regista a observação e decide se publica.
     *
     * @param zona último evento da geofence (`true` dentro, `false` fora, `null` ainda nenhum).
     * @param wifiCasa SSID de casa escolhido (`null` = só GPS).
     * @param wifiAtual SSID a que o telemóvel está ligado agora (`null` = nenhum/desconhecido).
     */
    fun passo(e: DebounceEstado, zona: Boolean?, wifiCasa: String?, wifiAtual: String?, agoraMs: Long): Verificacao {
        val noWifi = if (wifiCasa == null) null else Sinais.ssid(wifiAtual) == wifiCasa
        val novo = Debounce.observar(e, Sinais.combinar(zona, noWifi), agoraMs)
        val publicar = Debounce.aPublicar(novo, agoraMs)
        return Verificacao(novo, publicar, if (publicar != null) null else Debounce.esperaMs(novo, agoraMs))
    }
}
