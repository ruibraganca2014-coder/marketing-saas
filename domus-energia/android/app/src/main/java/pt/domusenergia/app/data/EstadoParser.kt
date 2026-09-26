package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/** Configuração de um canal, tal como vem em `_aparelhos`. */
data class ConfigCanal(val n: Int, val funcao: String, val nome: String, val temNome: Boolean)

/** Configuração de um aparelho, tal como vem em `_aparelhos` (v1 sem `canais` → um canal `interruptor` n.º 1). */
data class ConfigAparelho(
    val id: String,
    val nome: String,
    val tipo: String,
    val medidor: Boolean,
    val bateria: Boolean,
    val v1: Boolean,
    val canais: List<ConfigCanal>,
)

/**
 * Última mensagem recebida num tópico de um aparelho.
 * @property recebido quando chegou em direto; `null` se veio retida (não sabemos a idade).
 * @property mudanca quando o valor mudou (visto pela app em direto); `null` se não se sabe.
 */
data class Bruto(val payload: String, val recebido: Instant?, val mudanca: Instant?)

/**
 * Tudo o que a app sabe de um cliente, construído a partir das mensagens MQTT.
 *
 * Os valores dos aparelhos guardam-se "em bruto" por tópico ([brutos]) e só se interpretam com a lista
 * ([lista]) na mão: assim não se perde nada se as mensagens dos aparelhos chegarem antes da lista,
 * nem quando a lista muda a função de um canal.
 *
 * @property lista `null` enquanto a mensagem retida `_aparelhos` ainda não chegou.
 * @property automacoes `null` enquanto `_automacoes` ainda não chegou.
 * @property recebidasAutomacoes conta as vezes que `_automacoes` chegou (para saber que o motor aceitou uma lista).
 * @property ultimoErro último evento `erro` recebido em direto (ex.: automação recusada pelo motor).
 */
data class Estado(
    val lista: List<ConfigAparelho>? = null,
    val brutos: Map<String, Map<String, Bruto>> = emptyMap(),
    val alarme: Alarme? = null,
    val automacoes: List<Automacao>? = null,
    val recebidasAutomacoes: Int = 0,
    val historico: List<Evento> = emptyList(),
    val ntfyUrl: String? = null,
    val ultimoErro: Evento? = null,
) {
    val listaRecebida: Boolean get() = lista != null

    /** Aparelhos a mostrar: os da lista, pela ordem da lista. */
    val aparelhos: List<Aparelho> by lazy {
        val noticias = EstadoParser.noticiasDoHistorico(historico)
        lista.orEmpty().map { EstadoParser.construir(it, brutos[it.id].orEmpty(), noticias[it.id]) }
    }
}

/**
 * Traduz os tópicos MQTT (docs/PROTOCOLO-MQTT.md e PROTOCOLO-MQTT-v2.md) para o modelo normalizado.
 * Código puro (só usa org.json), sem Android nem cliente MQTT, para poder ser testado em JVM.
 */
object EstadoParser {

    const val LISTA = "_aparelhos"
    const val ALARME = "_alarme"
    const val AUTOMACOES = "_automacoes"
    const val EVENTOS = "_eventos"
    const val HISTORICO = "_historico"
    const val NTFY = "_ntfy"
    const val MAX_EVENTOS = 100

    private val ID_RE = Regex("^[a-z0-9-]+$")
    private val OBK_CANAL = Regex("^\\d+/get$")
    private val SHELLY_STATUS = Regex("^status/(switch|light|cover|input|devicepower):\\d+$")
    private val OBK_SIMPLES = setOf("connected", "led_dimmer/get", "power/get", "voltage/get", "current/get", "energycounter/get")

    /**
     * Aplica uma mensagem recebida em [topico] ao [estado]. Mensagens que não conhecemos (incluindo os
     * nossos próprios comandos `.../set`, `command...`, `rpc`) são ignoradas e devolvem o mesmo [estado].
     *
     * @param retida a mensagem veio retida do servidor (valor antigo, de idade desconhecida).
     */
    fun reduzir(
        estado: Estado,
        cliente: String,
        topico: String,
        payload: String,
        agora: Instant = Instant.now(),
        retida: Boolean = false,
    ): Estado {
        val prefixo = "domus/$cliente/"
        if (!topico.startsWith(prefixo)) return estado
        val resto = topico.removePrefix(prefixo)
        val id = resto.substringBefore('/')
        val sub = resto.substringAfter('/', missingDelimiterValue = "")

        if (id.startsWith("_")) {
            if (sub.isNotEmpty()) return estado // _alarme/set, _automacoes/set, _fcm/registar: pedidos, não estado
            return when (id) {
                LISTA -> lerAparelhos(payload)?.let { estado.copy(lista = it) } ?: estado
                ALARME -> if (payload.isBlank()) estado.copy(alarme = null) else lerAlarme(payload)?.let { estado.copy(alarme = it) } ?: estado
                AUTOMACOES -> Automacoes.ler(payload)?.let {
                    estado.copy(automacoes = it, recebidasAutomacoes = estado.recebidasAutomacoes + 1)
                } ?: estado
                HISTORICO -> if (payload.isBlank()) estado.copy(historico = emptyList()) else lerHistorico(payload)?.let {
                    estado.copy(historico = juntarEventos(it, emptyList()))
                } ?: estado
                EVENTOS -> lerEvento(objeto(payload) ?: return estado).let { ev ->
                    estado.copy(
                        historico = juntarEventos(estado.historico, listOf(ev)),
                        ultimoErro = if (ev.tipo == Evento.ERRO && !retida) ev else estado.ultimoErro,
                    )
                }
                NTFY -> estado.copy(ntfyUrl = lerNtfy(payload))
                else -> estado
            }
        }
        if (!ID_RE.matches(id) || sub.isEmpty()) return estado
        if (sub !in OBK_SIMPLES && !OBK_CANAL.matches(sub) && sub != "online" && !SHELLY_STATUS.matches(sub)) return estado

        val doAparelho = estado.brutos[id].orEmpty()
        val anterior = doAparelho[sub]
        var texto = payload.trim()
        if (sub.startsWith("status/")) {
            val novo = objeto(texto) ?: return estado
            // O Shelly pode mandar só parte do estado: junta ao que já se sabia.
            val junto = anterior?.let { objeto(it.payload) } ?: JSONObject()
            for (k in novo.keys()) junto.put(k, novo.get(k))
            texto = junto.toString()
        }
        val mudou = anterior == null || chave(sub, anterior.payload) != chave(sub, texto)
        val bruto = Bruto(
            payload = texto,
            recebido = if (!retida) agora else anterior?.takeIf { !mudou }?.recebido,
            mudanca = when {
                !mudou -> anterior?.mudanca
                !retida && anterior != null -> agora
                else -> null
            },
        )
        return estado.copy(brutos = estado.brutos + (id to doAparelho + (sub to bruto)))
    }

    /** O que conta como "mudança" num tópico (nos JSON do Shelly só os campos de estado, não a energia). */
    private fun chave(sub: String, payload: String): String {
        if (!sub.startsWith("status/")) return payload
        val o = objeto(payload) ?: return payload
        return listOf("output", "brightness", "current_pos", "state").joinToString("|") { o.opt(it)?.toString() ?: "" } +
            "|" + (o.optJSONObject("battery")?.opt("percent") ?: "")
    }

    // ---------- Atualizações otimistas (o aparelho confirma ou corrige a seguir) ----------

    fun comLigado(estado: Estado, id: String, n: Int, ligado: Boolean): Estado {
        val cfg = estado.lista?.firstOrNull { it.id == id } ?: return estado
        val funcao = cfg.canais.firstOrNull { it.n == n }?.funcao ?: return estado
        return if (cfg.tipo == Aparelho.TIPO_SHELLY) {
            val comp = if (funcao == Funcao.LUZ) "light" else "switch"
            otimistaJson(estado, id, "status/$comp:${n - 1}", JSONObject().put("output", ligado))
        } else {
            otimista(estado, id, "$n/get", if (ligado) "1" else "0")
        }
    }

    fun comBrilho(estado: Estado, id: String, n: Int, brilho: Int): Estado {
        val cfg = estado.lista?.firstOrNull { it.id == id } ?: return estado
        return if (cfg.tipo == Aparelho.TIPO_SHELLY) {
            otimistaJson(estado, id, "status/light:${n - 1}", JSONObject().put("output", true).put("brightness", brilho))
        } else {
            otimista(otimista(estado, id, "led_dimmer/get", brilho.toString()), id, "$n/get", "1")
        }
    }

    private fun otimista(estado: Estado, id: String, sub: String, payload: String): Estado {
        val doAparelho = estado.brutos[id].orEmpty()
        val anterior = doAparelho[sub]
        val b = Bruto(payload, anterior?.recebido, anterior?.mudanca)
        return estado.copy(brutos = estado.brutos + (id to doAparelho + (sub to b)))
    }

    private fun otimistaJson(estado: Estado, id: String, sub: String, campos: JSONObject): Estado {
        val junto = estado.brutos[id]?.get(sub)?.let { objeto(it.payload) } ?: JSONObject()
        for (k in campos.keys()) junto.put(k, campos.get(k))
        return otimista(estado, id, sub, junto.toString())
    }

    // ---------- Lista de aparelhos ----------

    /** Lê `_aparelhos`. Lista vazia se a mensagem retida foi apagada; `null` se não for uma lista JSON. */
    fun lerAparelhos(payload: String): List<ConfigAparelho>? {
        if (payload.isBlank()) return emptyList()
        val array = try {
            JSONTokener(payload).nextValue() as? JSONArray
        } catch (e: JSONException) {
            null
        } ?: return null

        val lista = mutableListOf<ConfigAparelho>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val id = (item.opt("id") as? String)?.trim().orEmpty()
            if (!ID_RE.matches(id) || lista.any { it.id == id }) continue
            val nome = (item.opt("nome") as? String)?.trim().orEmpty().ifEmpty { id }
            val tipo = if (item.opt("tipo") == Aparelho.TIPO_SHELLY) Aparelho.TIPO_SHELLY else Aparelho.TIPO_OPENBEKEN
            val canaisJson = item.opt("canais") as? JSONArray
            val v1 = canaisJson == null
            val canais = if (canaisJson == null) {
                listOf(ConfigCanal(1, Funcao.INTERRUPTOR, nome, temNome = false))
            } else {
                val cs = mutableListOf<ConfigCanal>()
                for (j in 0 until canaisJson.length()) {
                    val c = canaisJson.optJSONObject(j) ?: continue
                    val n = (c.opt("n") as? Number)?.toDouble()?.takeIf { it == Math.floor(it) }?.toInt() ?: continue
                    val funcao = c.opt("funcao") as? String
                    if (n !in 1..64 || funcao !in Funcao.TODAS || cs.any { it.n == n }) continue
                    val nomeCanal = (c.opt("nome") as? String)?.trim().orEmpty()
                    cs += ConfigCanal(n, funcao!!, nomeCanal.ifEmpty { nome }, temNome = nomeCanal.isNotEmpty())
                }
                cs.sortedBy { it.n }
            }
            lista += ConfigAparelho(
                id = id,
                nome = nome,
                tipo = tipo,
                // Na v1 todos os aparelhos mediam o consumo.
                medidor = item.opt("medidor") as? Boolean ?: v1,
                bateria = item.opt("bateria") as? Boolean ?: false,
                v1 = v1,
                canais = canais,
            )
        }
        return lista
    }

    // ---------- Modelo normalizado ----------

    /** Constrói o [Aparelho] a partir da configuração e das últimas mensagens de cada tópico. */
    fun construir(cfg: ConfigAparelho, brutos: Map<String, Bruto>, noticiaHistorico: Instant? = null): Aparelho {
        val shelly = cfg.tipo == Aparelho.TIPO_SHELLY
        fun texto(sub: String) = brutos[sub]?.payload
        fun json(sub: String) = texto(sub)?.let(::objeto)

        val online = if (shelly) texto("online").equals("true", ignoreCase = true)
        else texto("connected").equals("online", ignoreCase = true)

        var potencia: Double? = null
        var tensao: Double? = null
        var corrente: Double? = null
        var energia: Double? = null
        if (cfg.medidor) {
            if (shelly) {
                json("status/switch:0")?.let { s ->
                    potencia = double(s, "apower")
                    tensao = double(s, "voltage")
                    corrente = double(s, "current")
                    energia = s.optJSONObject("aenergy")?.let { double(it, "total") }?.div(1000)
                }
            } else {
                potencia = texto("power/get")?.let(::numero)
                tensao = texto("voltage/get")?.let(::numero)
                corrente = texto("current/get")?.let(::numero)
                energia = texto("energycounter/get")?.let(::numero)?.div(1000)
            }
        }

        val primeiraLuz = cfg.canais.firstOrNull { it.funcao == Funcao.LUZ }?.n
        val canais = cfg.canais.map { c ->
            var r = Canal(n = c.n, funcao = c.funcao, nome = c.nome, temNome = c.temNome)
            if (shelly) {
                val id = c.n - 1
                when (c.funcao) {
                    Funcao.INTERRUPTOR, Funcao.LUZ -> {
                        // Luz: componente light; interruptor: switch. Aceita o outro se só houver esse.
                        val subs = if (c.funcao == Funcao.LUZ) listOf("status/light:$id", "status/switch:$id")
                        else listOf("status/switch:$id", "status/light:$id")
                        val sub = subs.firstOrNull { brutos[it] != null }
                        val s = sub?.let(::json)
                        if (s != null) {
                            r = r.copy(ligado = s.opt("output") as? Boolean, ultimaMudanca = brutos[sub]?.mudanca)
                            if (c.funcao == Funcao.LUZ) r = r.copy(brilho = inteiro0a100(s.opt("brightness")))
                        }
                    }
                    Funcao.ESTORE -> json("status/cover:$id")?.let { s ->
                        r = r.copy(
                            posicao = inteiro0a100(s.opt("current_pos")),
                            estadoEstore = s.opt("state") as? String,
                            ultimaMudanca = brutos["status/cover:$id"]?.mudanca,
                        )
                    }
                    Funcao.PORTA, Funcao.MOVIMENTO -> json("status/input:$id")?.let { s ->
                        val v = s.opt("state") as? Boolean
                        r = if (c.funcao == Funcao.PORTA) r.copy(aberto = v) else r.copy(movimento = v)
                        r = r.copy(ultimaMudanca = brutos["status/input:$id"]?.mudanca)
                    }
                    // Shelly a pilhas (Gen2/Gen3): status/devicepower:0 → battery.percent
                    Funcao.BATERIA -> json("status/devicepower:0")?.let { s ->
                        r = r.copy(
                            bateria = inteiro0a100(s.optJSONObject("battery")?.opt("percent")),
                            ultimaMudanca = brutos["status/devicepower:0"]?.mudanca,
                        )
                    }
                }
            } else {
                val b = brutos["${c.n}/get"]
                val t = b?.payload
                r = r.copy(ultimaMudanca = b?.mudanca)
                when (c.funcao) {
                    Funcao.INTERRUPTOR -> r = r.copy(ligado = t?.let(::booleano))
                    Funcao.LUZ -> {
                        r = r.copy(ligado = t?.let(::booleano))
                        if (c.n == primeiraLuz) {
                            val d = brutos["led_dimmer/get"]
                            r = r.copy(brilho = d?.payload?.let(::inteiro0a100), ultimaMudanca = maisRecente(b?.mudanca, d?.mudanca))
                        }
                    }
                    Funcao.ESTORE -> r = r.copy(posicao = t?.let(::inteiro0a100))
                    Funcao.PORTA -> r = r.copy(aberto = t?.let(::booleano))
                    Funcao.MOVIMENTO -> r = r.copy(movimento = t?.let(::booleano))
                    Funcao.BATERIA -> r = r.copy(bateria = t?.let(::inteiro0a100))
                }
            }
            r
        }

        val ultima = brutos.values.mapNotNull { it.recebido }.fold(noticiaHistorico) { a, b -> maisRecente(a, b) }
        return Aparelho(
            id = cfg.id,
            nome = cfg.nome,
            tipo = cfg.tipo,
            medidor = cfg.medidor,
            bateria = cfg.bateria,
            online = online,
            ultimaNoticia = ultima,
            potenciaW = potencia,
            tensaoV = tensao,
            correnteA = corrente,
            energiaKWh = energia,
            canais = canais,
        )
    }

    // ---------- Alarme, eventos, ntfy ----------

    fun lerAlarme(payload: String): Alarme? {
        val o = objeto(payload) ?: return null
        val ativo = o.opt("ativo") as? Boolean ?: return null
        return Alarme(ativo, instante(o.opt("desde") as? String))
    }

    fun lerEvento(o: JSONObject): Evento {
        val ts = o.opt("ts") as? String
        val tipo = o.opt("tipo") as? String
        return Evento(
            ts = instante(ts),
            tsTexto = ts.orEmpty(),
            tipo = if (tipo in Evento.TIPOS) tipo!! else Evento.AVISO,
            titulo = o.opt("titulo")?.takeUnless { it == JSONObject.NULL }?.toString().orEmpty(),
            mensagem = o.opt("mensagem")?.takeUnless { it == JSONObject.NULL }?.toString().orEmpty(),
            aparelho = o.opt("aparelho") as? String,
        )
    }

    fun lerHistorico(payload: String): List<Evento>? {
        val array = try {
            JSONTokener(payload).nextValue() as? JSONArray
        } catch (e: JSONException) {
            null
        } ?: return null
        return (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let(::lerEvento) }
    }

    /** Junta eventos em direto ao histórico, sem repetidos, mais recente primeiro, no máximo [max]. */
    fun juntarEventos(historico: List<Evento>, vivos: List<Evento>, max: Int = MAX_EVENTOS): List<Evento> {
        val vistos = HashSet<String>()
        return (vivos + historico)
            .filter { vistos.add("${it.tsTexto}|${it.tipo}|${it.titulo}|${it.mensagem}") }
            .sortedByDescending { it.ts ?: Instant.EPOCH }
            .take(max)
    }

    /** Último evento conhecido de cada aparelho (para aparelhos a pilhas cujos valores chegaram retidos). */
    fun noticiasDoHistorico(historico: List<Evento>): Map<String, Instant> {
        val r = HashMap<String, Instant>()
        for (e in historico) {
            val ap = e.aparelho ?: continue
            val ts = e.ts ?: continue
            if (r[ap]?.isAfter(ts) != true) r[ap] = ts
        }
        return r
    }

    fun lerNtfy(payload: String): String? {
        val url = objeto(payload)?.opt("url") as? String ?: return null
        return url.takeIf { Regex("^https?://\\S+$", RegexOption.IGNORE_CASE).matches(it) }
    }

    // ---------- Auxiliares ----------

    private fun objeto(texto: String): JSONObject? = try {
        JSONTokener(texto).nextValue() as? JSONObject
    } catch (e: JSONException) {
        null
    }

    // "2026-09-26T22:10:00Z" (ou com fração/desvio: "…T23:10:00+01:00", que o Instant.parse do Android 8 não aceita).
    private fun instante(texto: String?): Instant? {
        if (texto.isNullOrBlank()) return null
        return try {
            Instant.parse(texto)
        } catch (e: DateTimeParseException) {
            try {
                OffsetDateTime.parse(texto).toInstant()
            } catch (e2: DateTimeParseException) {
                null
            }
        }
    }

    private fun maisRecente(a: Instant?, b: Instant?): Instant? = when {
        a == null -> b
        b == null -> a
        else -> if (a.isAfter(b)) a else b
    }

    private fun double(json: JSONObject, chave: String): Double? =
        (json.opt(chave) as? Number)?.toDouble()?.takeUnless { it.isNaN() }

    private fun numero(texto: String): Double? = texto.trim().toDoubleOrNull()?.takeUnless { it.isNaN() || it.isInfinite() }

    private fun inteiro0a100(v: Any?): Int? {
        val d = when (v) {
            is Number -> v.toDouble()
            is String -> numero(v)
            else -> null
        } ?: return null
        if (d.isNaN()) return null
        return Math.round(d).toInt().coerceIn(0, 100)
    }

    private fun booleano(texto: String): Boolean? = when (texto.trim().lowercase()) {
        "1", "on", "true" -> true
        "0", "off", "false" -> false
        else -> null
    }
}
