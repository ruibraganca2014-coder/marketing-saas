package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

// Modelos e leitura dos tópicos novos da v3 (docs/PROTOCOLO-MQTT-v3.md). Código puro (só org.json).

/** Modo da casa (`_modo`, retido). [por]: `app`, `web`, `automacao:<id>`, `cena:<id>`. */
data class Modo(val modo: String, val desde: Instant? = null, val por: String? = null)

/** Localização da casa (para o nascer/pôr do sol). */
data class Local(val lat: Double, val lon: Double)

/**
 * Configuração da casa (`_config`, retido). Campos ausentes ficam com os valores por omissão do contrato.
 * [silencio] e [relatorioDiario] `null` = desligado.
 */
data class ConfigCasa(
    val atrasoSaidaS: Int = 30,
    val atrasoEntradaS: Int = 30,
    val silencio: Pair<String, String>? = null,
    val limiarEsperaW: Double = 5.0,
    val offlineMin: Int = 30,
    val pausaManualMin: Int = 60,
    val local: Local? = null,
    val relatorioDiario: String? = null,
) {
    companion object {
        val PADRAO = ConfigCasa()

        /**
         * Objeto parcial para `_config/set`: só os campos que mudaram entre [antes] e [depois]
         * (o motor funde com o que tem). Vazio se nada mudou.
         */
        fun parcial(antes: ConfigCasa, depois: ConfigCasa): JSONObject {
            val o = JSONObject()
            if (antes.atrasoSaidaS != depois.atrasoSaidaS) o.put("atraso_saida_s", depois.atrasoSaidaS)
            if (antes.atrasoEntradaS != depois.atrasoEntradaS) o.put("atraso_entrada_s", depois.atrasoEntradaS)
            if (antes.silencio != depois.silencio) {
                o.put("silencio", depois.silencio?.let { JSONArray().put(it.first).put(it.second) } ?: JSONObject.NULL)
            }
            if (antes.limiarEsperaW != depois.limiarEsperaW) o.put("limiar_espera_w", Automacoes.numeroJson(depois.limiarEsperaW))
            if (antes.offlineMin != depois.offlineMin) o.put("offline_min", depois.offlineMin)
            if (antes.pausaManualMin != depois.pausaManualMin) o.put("pausa_manual_min", depois.pausaManualMin)
            if (antes.local != depois.local && depois.local != null) {
                o.put("local", JSONObject().put("lat", depois.local.lat).put("lon", depois.local.lon))
            }
            if (antes.relatorioDiario != depois.relatorioDiario) o.put("relatorio_diario", depois.relatorioDiario ?: JSONObject.NULL)
            return o
        }

        /** Erros (pt-PT) antes de enviar. */
        fun validar(c: ConfigCasa): List<String> {
            val erros = mutableListOf<String>()
            if (c.atrasoSaidaS !in 0..300) erros += "Tempo para sair: de 0 a 300 s."
            if (c.atrasoEntradaS !in 0..300) erros += "Tempo para desarmar: de 0 a 300 s."
            c.silencio?.let { (a, b) ->
                if (!Automacoes.HORA_RE.matches(a) || !Automacoes.HORA_RE.matches(b)) erros += "Horas de silêncio inválidas (HH:MM)."
                else if (a == b) erros += "As horas de silêncio não podem ser iguais."
            }
            if (!(c.limiarEsperaW >= 0 && c.limiarEsperaW <= 100)) erros += "Limiar de \"em espera\": de 0 a 100 W."
            if (c.offlineMin !in 1..1440) erros += "Aviso de offline: de 1 a 1440 min."
            if (c.pausaManualMin !in 0..480) erros += "Pausa manual: de 0 a 480 min."
            c.local?.let { if (it.lat !in -90.0..90.0 || it.lon !in -180.0..180.0) erros += "Localização inválida." }
            c.relatorioDiario?.let { if (!Automacoes.HORA_RE.matches(it)) erros += "Hora do relatório inválida (HH:MM)." }
            return erros
        }
    }
}

/** Uma cena (`_cenas`, retido): ações da §8 sem SE nem cenas. */
data class Cena(
    val id: String,
    val nome: String,
    val icone: String = Cenas.ICONE_CASA,
    val bloqueada: Boolean = false,
    val acoes: List<Acao> = emptyList(),
    val original: String? = null,
    val acoesDesconhecidas: Int = 0,
) {
    val editavel: Boolean get() = !bloqueada && acoesDesconhecidas == 0
}

/** Leitura, escrita e validação das cenas. */
object Cenas {
    const val MAX_CENAS = 30
    const val ICONE_CASA = "casa"
    val ICONES = listOf("filme", "sol", "lua", "porta", "casa", "energia", "luz", "estrela")

    fun ler(payload: String): List<Cena>? {
        if (payload.isBlank()) return emptyList()
        val array = V3.array(payload) ?: return null
        return (0 until array.length()).mapNotNull { i ->
            val o = array.optJSONObject(i) ?: return@mapNotNull null
            val id = o.opt("id") as? String ?: return@mapNotNull null
            val (acoes, d) = Automacoes.lerAcoes(o.optJSONArray("acoes"))
            Cena(
                id = id,
                nome = (o.opt("nome") as? String)?.takeIf { it.isNotBlank() } ?: id,
                icone = (o.opt("icone") as? String)?.takeIf { it in ICONES } ?: ICONE_CASA,
                bloqueada = o.opt("bloqueada") as? Boolean ?: false,
                acoes = acoes,
                original = o.toString(),
                acoesDesconhecidas = d,
            )
        }
    }

    fun paraJson(c: Cena): JSONObject {
        val o = c.original?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        if (c.bloqueada || !c.editavel) return o.put("id", c.id) // da empresa: segue exatamente como veio
        return o.put("id", c.id).put("nome", c.nome).put("icone", c.icone).put("bloqueada", false)
            .put("acoes", Automacoes.acoesJson(c.acoes))
    }

    /** Lista completa para `_cenas/set`. */
    fun paraJson(lista: List<Cena>): String = JSONArray().apply { lista.forEach { put(paraJson(it)) } }.toString()

    fun guardar(lista: List<Cena>, nova: Cena, idAnterior: String? = null): List<Cena> {
        val i = if (idAnterior == null) -1 else lista.indexOfFirst { it.id == idAnterior }
        if (i < 0) return lista + nova
        if (lista[i].bloqueada) return lista
        return lista.toMutableList().also { it[i] = nova.copy(original = lista[i].original, acoesDesconhecidas = 0) }
    }

    fun remover(lista: List<Cena>, id: String): List<Cena> = lista.filterNot { it.id == id && !it.bloqueada }

    fun validar(c: Cena, aparelhos: List<Aparelho> = emptyList()): List<String> {
        val erros = mutableListOf<String>()
        if (!Automacoes.ID_RE.matches(c.id)) erros += "Identificador inválido."
        if (c.nome.isBlank()) erros += "Dê um nome à cena."
        if (c.icone !in ICONES) erros += "Escolha um ícone."
        if (c.acoes.isEmpty() || c.acoes.size > Automacoes.MAX_ACOES) erros += "Tem de ter entre 1 e ${Automacoes.MAX_ACOES} ações."
        erros += Automacoes.validarAcoes(c.acoes, aparelhos, null, "", permiteSe = false)
        return erros
    }

    fun validarLista(lista: List<Cena>): List<String> {
        val erros = mutableListOf<String>()
        if (lista.size > MAX_CENAS) erros += "No máximo $MAX_CENAS cenas."
        val repetidos = lista.groupingBy { it.id }.eachCount().filterValues { it > 1 }.keys
        if (repetidos.isNotEmpty()) erros += "Identificador repetido: ${repetidos.joinToString()}."
        return erros
    }
}

/** Saúde de um aparelho (`_saude`, retido). Todos os campos podem faltar (`null`). */
data class SaudeAparelho(
    val online: Boolean? = null,
    val ultimaNoticia: Instant? = null,
    val rssi: Int? = null,
    val uptimeS: Long? = null,
    val reinicios24h: Int? = null,
    val bateria: Int? = null,
    val bateriaDias: Int? = null,
    val offlineDesde: Instant? = null,
)

/** Consumo de energia (`_energia`, retido). */
data class Energia(
    val hojeKWh: Double? = null,
    val ontemKWh: Double? = null,
    val mesKWh: Double? = null,
    val aparelhos: Map<String, Pair<Double?, Double?>> = emptyMap(),
)

/** Uma pessoa em `_presenca`. */
data class Pessoa(val nome: String, val emCasa: Boolean, val desde: Instant? = null)

/** Presença (`_presenca`, retido, mantido pelo motor). */
data class PresencaCasa(val pessoas: Map<String, Pessoa> = emptyMap(), val alguem: Boolean? = null)

/**
 * Uma execução no registo de uma automação. [teste] = veio de "Testar agora";
 * [ok] = resultado de "Avaliar agora" (as condições seriam verdadeiras?).
 */
data class Execucao(
    val ts: Instant?,
    val resultado: String,
    val motivo: String? = null,
    val teste: Boolean? = null,
    val ok: Boolean? = null,
)

/** Registo de uma automação (`_automacoes/registo`, retido). */
data class Registo(
    val ultima: Instant? = null,
    val resultado: String? = null,
    val motivo: String? = null,
    val semana: Int? = null,
    val ultimos: List<Execucao> = emptyList(),
    val teste: Boolean? = null,
    val ok: Boolean? = null,
) {
    companion object {
        const val EXECUTADA = "executada"
        const val CONDICAO_FALSA = "condicao_falsa"
        const val FALHOU = "falhou"
        const val PAUSADA = "pausada"
        const val TESTE = "teste"
        const val AVALIACAO = "avaliacao"

        /** Rótulo com o resultado da avaliação ("Avaliação: verdadeira"). */
        fun rotulo(r: String?, ok: Boolean?): String =
            if (r == AVALIACAO && ok != null) "Avaliação: " + (if (ok) "condições verdadeiras" else "condições falsas") else rotulo(r)

        /**
         * Texto a mostrar quando chega a resposta a um pedido "Executar" / "Testar agora" / "Avaliar agora"
         * ([tipo] = [PEDIDO_EXECUTAR], [PEDIDO_TESTAR] ou [PEDIDO_AVALIAR]); [r] = registo novo da automação.
         */
        fun textoPedido(tipo: String, r: Registo?): String {
            if (tipo == PEDIDO_AVALIAR) {
                return when {
                    r?.resultado != AVALIACAO -> r?.motivo ?: "Avaliação recebida."
                    r.ok == true -> "Neste momento a automação executaria: as condições são verdadeiras."
                    r.ok == false -> "Neste momento não executaria: ${r.motivo ?: "uma condição é falsa."}"
                    else -> r.motivo ?: "Avaliação recebida."
                }
            }
            val inicio = if (tipo == PEDIDO_TESTAR) "Teste feito" else "Executada"
            val res = rotulo(r?.resultado).takeIf { r?.resultado != null } ?: ""
            return "$inicio: $res" + (r?.motivo?.let { " — $it" } ?: "")
        }

        const val PEDIDO_EXECUTAR = "executar"
        const val PEDIDO_TESTAR = "testar"
        const val PEDIDO_AVALIAR = "avaliar"

        fun rotulo(r: String?): String = when (r) {
            EXECUTADA -> "Executada"
            CONDICAO_FALSA -> "Condição falsa"
            FALHOU -> "Falhou"
            PAUSADA -> "Em pausa"
            TESTE -> "Teste"
            AVALIACAO -> "Avaliação"
            null -> "Nunca executada"
            else -> r
        }
    }
}

/** Aviso de conflito entre automações (`_automacoes/avisos`, retido). */
data class AvisoConflito(val ids: List<String>, val mensagem: String)

/** Leitura dos tópicos da v3. `null` = mensagem que não se percebe (o estado fica como estava). */
object V3 {
    const val MODO = "_modo"
    const val CONFIG = "_config"
    const val CENAS = "_cenas"
    const val SAUDE = "_saude"
    const val ENERGIA = "_energia"
    const val PRESENCA = "_presenca"
    const val REGISTO = "registo"
    const val AVISOS = "avisos"

    fun objeto(texto: String): JSONObject? = try {
        JSONTokener(texto).nextValue() as? JSONObject
    } catch (e: JSONException) {
        null
    }

    fun array(texto: String): JSONArray? = try {
        JSONTokener(texto).nextValue() as? JSONArray
    } catch (e: JSONException) {
        null
    }

    fun instante(v: Any?): Instant? {
        val texto = v as? String
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

    private fun double(v: Any?): Double? = (v as? Number)?.toDouble()?.takeUnless { it.isNaN() || it.isInfinite() }
    private fun long(v: Any?): Long? = (v as? Number)?.toDouble()?.takeIf { it == Math.floor(it) && !it.isInfinite() }?.toLong()

    fun lerModo(payload: String): Modo? {
        val o = objeto(payload) ?: return null
        val m = o.opt("modo") as? String ?: return null
        if (m !in Modos.TODOS) return null
        return Modo(m, instante(o.opt("desde")), o.opt("por") as? String)
    }

    fun lerAlarme(payload: String): Alarme? {
        val o = objeto(payload) ?: return null
        val ativo = o.opt("ativo") as? Boolean ?: return null
        val ign = o.optJSONArray("ignorados")?.let { arr ->
            (0 until arr.length()).mapNotNull { i ->
                val x = arr.optJSONObject(i) ?: return@mapNotNull null
                val ap = x.opt("aparelho") as? String ?: return@mapNotNull null
                val c = Automacoes.inteiro(x.opt("canal")) ?: return@mapNotNull null
                Ignorado(ap, c)
            }
        }.orEmpty()
        return Alarme(
            ativo = ativo,
            desde = instante(o.opt("desde")),
            estado = (o.opt("estado") as? String)?.takeIf { it in Alarme.ESTADOS },
            tipo = o.opt("tipo") as? String,
            ate = instante(o.opt("ate")),
            ignorados = ign,
            por = o.opt("por") as? String,
        )
    }

    fun lerConfig(payload: String): ConfigCasa? {
        val o = objeto(payload) ?: return null
        val p = ConfigCasa.PADRAO
        val silencio = when (val s = o.opt("silencio")) {
            is JSONArray -> {
                val a = s.opt(0) as? String
                val b = s.opt(1) as? String
                if (s.length() == 2 && a != null && b != null) a to b else null
            }
            else -> null
        }
        val local = o.optJSONObject("local")?.let { l ->
            val lat = double(l.opt("lat"))
            val lon = double(l.opt("lon"))
            if (lat != null && lon != null) Local(lat, lon) else null
        }
        return ConfigCasa(
            atrasoSaidaS = long(o.opt("atraso_saida_s"))?.toInt() ?: p.atrasoSaidaS,
            atrasoEntradaS = long(o.opt("atraso_entrada_s"))?.toInt() ?: p.atrasoEntradaS,
            silencio = silencio,
            limiarEsperaW = double(o.opt("limiar_espera_w")) ?: p.limiarEsperaW,
            offlineMin = long(o.opt("offline_min"))?.toInt() ?: p.offlineMin,
            pausaManualMin = long(o.opt("pausa_manual_min"))?.toInt() ?: p.pausaManualMin,
            local = local,
            relatorioDiario = o.opt("relatorio_diario") as? String,
        )
    }

    fun lerSaude(payload: String): Map<String, SaudeAparelho>? {
        val o = objeto(payload) ?: return null
        val r = LinkedHashMap<String, SaudeAparelho>()
        for (id in o.keys()) {
            val s = o.optJSONObject(id) ?: continue
            r[id] = SaudeAparelho(
                online = s.opt("online") as? Boolean,
                ultimaNoticia = instante(s.opt("ultima_noticia")),
                rssi = long(s.opt("rssi"))?.toInt(),
                uptimeS = long(s.opt("uptime_s")),
                reinicios24h = long(s.opt("reinicios_24h"))?.toInt(),
                bateria = long(s.opt("bateria"))?.toInt()?.coerceIn(0, 100),
                bateriaDias = long(s.opt("bateria_dias"))?.toInt(),
                offlineDesde = instante(s.opt("offline_desde")),
            )
        }
        return r
    }

    fun lerEnergia(payload: String): Energia? {
        val o = objeto(payload) ?: return null
        val ap = LinkedHashMap<String, Pair<Double?, Double?>>()
        o.optJSONObject("aparelhos")?.let { a ->
            for (id in a.keys()) {
                val x = a.optJSONObject(id) ?: continue
                ap[id] = double(x.opt("hoje_kwh")) to double(x.opt("ontem_kwh"))
            }
        }
        return Energia(double(o.opt("hoje_kwh")), double(o.opt("ontem_kwh")), double(o.opt("mes_kwh")), ap)
    }

    fun lerPresenca(payload: String): PresencaCasa? {
        val o = objeto(payload) ?: return null
        val pessoas = LinkedHashMap<String, Pessoa>()
        o.optJSONObject("pessoas")?.let { p ->
            for (id in p.keys()) {
                val x = p.optJSONObject(id) ?: continue
                val emCasa = x.opt("em_casa") as? Boolean ?: continue
                pessoas[id] = Pessoa((x.opt("nome") as? String).orEmpty().ifBlank { id }, emCasa, instante(x.opt("desde")))
            }
        }
        return PresencaCasa(pessoas, o.opt("alguem") as? Boolean)
    }

    fun lerRegisto(payload: String): Map<String, Registo>? {
        val o = objeto(payload) ?: return null
        val r = LinkedHashMap<String, Registo>()
        for (id in o.keys()) {
            val x = o.optJSONObject(id) ?: continue
            val ultimos = x.optJSONArray("ultimos")?.let { arr ->
                (0 until arr.length()).mapNotNull { i ->
                    val e = arr.optJSONObject(i) ?: return@mapNotNull null
                    val res = e.opt("resultado") as? String ?: return@mapNotNull null
                    Execucao(instante(e.opt("ts")), res, (e.opt("motivo") as? String)?.takeIf { it.isNotBlank() }, e.opt("teste") as? Boolean, e.opt("ok") as? Boolean)
                }
            }.orEmpty()
            r[id] = Registo(
                ultima = instante(x.opt("ultima")),
                resultado = x.opt("resultado") as? String,
                motivo = (x.opt("motivo") as? String)?.takeIf { it.isNotBlank() },
                semana = long(x.opt("semana"))?.toInt(),
                ultimos = ultimos,
                teste = x.opt("teste") as? Boolean,
                ok = x.opt("ok") as? Boolean,
            )
        }
        return r
    }

    fun lerAvisos(payload: String): List<AvisoConflito>? {
        if (payload.isBlank()) return emptyList()
        val arr = array(payload) ?: return null
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val m = o.opt("mensagem") as? String ?: return@mapNotNull null
            val ids = o.optJSONArray("ids")?.let { a -> (0 until a.length()).mapNotNull { a.opt(it) as? String } }.orEmpty()
            AvisoConflito(ids, m)
        }
    }
}
