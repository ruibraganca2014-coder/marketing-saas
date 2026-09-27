package pt.domusenergia.app.data

import java.time.Duration
import java.time.Instant

/** Funções possíveis de um canal (docs/PROTOCOLO-MQTT-v2.md, secção 1). */
object Funcao {
    const val INTERRUPTOR = "interruptor"
    const val LUZ = "luz"
    const val ESTORE = "estore"
    const val PORTA = "porta"
    const val MOVIMENTO = "movimento"
    const val BATERIA = "bateria"

    val TODAS = setOf(INTERRUPTOR, LUZ, ESTORE, PORTA, MOVIMENTO, BATERIA)

    /** Funções que o cliente (e as automações) podem comandar. */
    val CONTROLAVEIS = setOf(INTERRUPTOR, LUZ, ESTORE)

    /** Sensores que podem disparar uma automação `quando.tipo = "sensor"`. */
    val SENSORES = setOf(PORTA, MOVIMENTO)

    fun rotulo(funcao: String): String = when (funcao) {
        INTERRUPTOR -> "Circuito"
        LUZ -> "Luz"
        ESTORE -> "Estore"
        PORTA -> "Porta"
        MOVIMENTO -> "Movimento"
        BATERIA -> "Bateria"
        else -> funcao
    }
}

/**
 * Um canal de um aparelho, com o último valor conhecido. Só os campos da [funcao] são preenchidos;
 * `null` = valor ainda desconhecido.
 *
 * @property temNome o canal tem nome próprio na lista (senão [nome] é o nome do aparelho).
 * @property estadoEstore Shelly: `open`/`closed`/`opening`/`closing`/`stopped`.
 * @property ultimaMudanca quando o valor mudou pela última vez (só mudanças vistas pela app).
 */
data class Canal(
    val n: Int,
    val funcao: String,
    val nome: String,
    val temNome: Boolean = false,
    val ligado: Boolean? = null,
    val brilho: Int? = null,
    val posicao: Int? = null,
    val estadoEstore: String? = null,
    val aberto: Boolean? = null,
    val movimento: Boolean? = null,
    val bateria: Int? = null,
    val ultimaMudanca: Instant? = null,
    /** v3: porta de entrada (com atraso de entrada no alarme). */
    val entrada: Boolean = false,
    /** v3: luz/circuito usado na simulação de presença (modo Férias). */
    val simular: Boolean = false,
    /** v3: `desligado`/`ligado`/`ultimo` depois de um corte de luz (por omissão `desligado`). */
    val arranque: String? = null,
    /** v3: `normal`/`perigosa` (aquecedor, termoacumulador, bomba, motor). */
    val carga: String? = null,
    /** v3: divisão do canal (ex.: "Sala"); `null` = a do aparelho. */
    val divisao: String? = null,
) {
    val controlavel: Boolean get() = funcao in Funcao.CONTROLAVEIS

    /** Carga perigosa: as automações só a ligam com `durante_s` (máx. 4 h). */
    val perigosa: Boolean get() = carga == CARGA_PERIGOSA

    companion object {
        const val CARGA_PERIGOSA = "perigosa"
    }
}

/**
 * Modelo normalizado de um aparelho (igual ao do site), seja OpenBeken ou Shelly.
 * Ver docs/PROTOCOLO-MQTT.md (v1) e docs/PROTOCOLO-MQTT-v2.md (secção 6).
 *
 * @property medidor publica potência/tensão/corrente/energia (na v1 todos os aparelhos mediam).
 * @property bateria aparelho a pilhas que dorme: nunca se mostra "Offline".
 * @property ultimaNoticia última mensagem recebida em direto (as retidas não contam, não sabemos a idade).
 */
data class Aparelho(
    val id: String,
    val nome: String,
    val tipo: String,
    val medidor: Boolean = false,
    val bateria: Boolean = false,
    val online: Boolean = false,
    val ultimaNoticia: Instant? = null,
    val potenciaW: Double? = null,
    val tensaoV: Double? = null,
    val correnteA: Double? = null,
    val energiaKWh: Double? = null,
    val canais: List<Canal> = emptyList(),
    /** v3: divisão do aparelho (ex.: "Sala"). */
    val divisao: String? = null,
) {
    /** Pode receber comandos / mostrar valores como atuais. Aparelhos a pilhas não ficam "offline". */
    val disponivel: Boolean get() = bateria || online

    fun canal(n: Int): Canal? = canais.firstOrNull { it.n == n }

    /** Divisão onde se mostra o aparelho: a sua ou, se não tiver, a do primeiro canal que tenha. */
    val divisaoMostrada: String? get() = divisao ?: canais.firstNotNullOfOrNull { it.divisao }

    /** Divisão de um canal: a do canal ou, se não tiver, a do aparelho. */
    fun divisaoDe(c: Canal): String? = c.divisao ?: divisao

    /** Aparelho a pilhas sem notícias há mais de 24 h. */
    fun semNoticias(agora: Instant): Boolean =
        bateria && ultimaNoticia != null && Duration.between(ultimaNoticia, agora) > SEM_NOTICIAS

    companion object {
        const val TIPO_OPENBEKEN = "openbeken"
        const val TIPO_SHELLY = "shelly"
        val SEM_NOTICIAS: Duration = Duration.ofHours(24)
    }
}

/** Um canal que ficou de fora do alarme por estar aberto ao armar com "forcar". */
data class Ignorado(val aparelho: String, val canal: Int)

/**
 * Estado do alarme (`domus/<cliente>/_alarme`, retido). Na v2 só `ativo`/`desde`; na v3 também
 * [estado] (`desarmado`/`a_armar`/`armado`/`entrada`/`disparado`), [tipo] (`total`/`perimetro`),
 * [ate] (fim da contagem de `a_armar`/`entrada`), [ignorados] e [por] (quem armou/desarmou).
 */
data class Alarme(
    val ativo: Boolean,
    val desde: Instant? = null,
    val estado: String? = null,
    val tipo: String? = null,
    val ate: Instant? = null,
    val ignorados: List<Ignorado> = emptyList(),
    val por: String? = null,
) {
    /** Estado v3 (um alarme v2 sem `estado` é `armado` ou `desarmado`). */
    val estadoEfetivo: String get() = estado ?: if (ativo) ARMADO else DESARMADO

    /** Segundos até [ate] (contagem de saída/entrada), `null` sem contagem. */
    fun segundosAte(agora: Instant): Long? {
        val fim = ate ?: return null
        if (estadoEfetivo != A_ARMAR && estadoEfetivo != ENTRADA) return null
        return Duration.between(agora, fim).seconds.coerceAtLeast(0)
    }

    companion object {
        const val DESARMADO = "desarmado"
        const val A_ARMAR = "a_armar"
        const val ARMADO = "armado"
        const val ENTRADA = "entrada"
        const val DISPARADO = "disparado"
        val ESTADOS = setOf(DESARMADO, A_ARMAR, ARMADO, ENTRADA, DISPARADO)
        const val TOTAL = "total"
        const val PERIMETRO = "perimetro"
    }
}

/** Um evento do motor (`_eventos` em direto ou `_historico`). */
data class Evento(
    val ts: Instant?,
    val tsTexto: String,
    val tipo: String,
    val titulo: String,
    val mensagem: String,
    val aparelho: String? = null,
    /** v3: quem fez (`app`, `web`, `automacao:<id>`, `cena:<id>`), quando o motor o diz. */
    val por: String? = null,
) {
    companion object {
        const val ALARME = "alarme"
        const val SENSOR = "sensor"
        const val AUTOMACAO = "automacao"
        const val AVISO = "aviso"
        const val ERRO = "erro"

        /** v3: mudança de modo / armar / desarmar (sem notificação). */
        const val MODO = "modo"
        val TIPOS = setOf(ALARME, SENSOR, AUTOMACAO, AVISO, ERRO, MODO)
    }
}
