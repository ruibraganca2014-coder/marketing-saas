package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.text.Normalizer

/** Modos da casa (docs/PROTOCOLO-MQTT-v3.md, secção 2). */
object Modos {
    const val CASA = "casa"
    const val FORA = "fora"
    const val NOITE = "noite"
    const val FERIAS = "ferias"
    val TODOS = listOf(CASA, FORA, NOITE, FERIAS)

    fun rotulo(m: String?): String = when (m) {
        CASA -> "Casa"
        FORA -> "Fora"
        NOITE -> "Noite"
        FERIAS -> "Férias"
        null -> "—"
        else -> m
    }
}

/** O que faz disparar uma automação (`quando`). */
sealed interface Quando {
    /**
     * Um canal passa a [valor] (1/0). Na v3 serve para porta, movimento, interruptor e luz; com [duranteS]
     * dispara quando o canal está nesse valor há X s (ex.: sem movimento há 10 min).
     */
    data class Sensor(val aparelho: String, val canal: Int, val valor: Int, val duranteS: Int? = null) : Quando

    /** A uma hora ("HH:MM"), nos [dias] indicados (1 = segunda … 7 = domingo). */
    data class Hora(val hora: String, val dias: List<Int>) : Quando

    /** Consumo de [aparelho] acima de [acimaW] durante [duranteS] s; rearma abaixo de [rearmarW] (histerese). */
    data class Potencia(val aparelho: String, val acimaW: Double, val duranteS: Int, val rearmarW: Double? = null) : Quando

    /** v3: nascer (`nascer`) ou pôr (`por`) do sol, com [desvioMin] (−180…180). */
    data class Sol(val evento: String, val desvioMin: Int = 0) : Quando

    /** v3: `chega_primeiro` ou `sai_ultimo`. */
    data class Presenca(val evento: String) : Quando

    /** v3: quando a casa entra no [modo]. */
    data class Modo(val modo: String) : Quando

    /** v3: só pelo botão "Executar"/"Testar agora". */
    data object Manual : Quando

    /** v3: `aparelho_offline`/`aparelho_online` (de [aparelho] ou de qualquer um) ou `energia_reposta`. */
    data class Sistema(val evento: String, val aparelho: String? = null) : Quando

    companion object {
        const val SOL_NASCER = "nascer"
        const val SOL_POR = "por"
        const val CHEGA_PRIMEIRO = "chega_primeiro"
        const val SAI_ULTIMO = "sai_ultimo"
        const val APARELHO_OFFLINE = "aparelho_offline"
        const val APARELHO_ONLINE = "aparelho_online"
        const val ENERGIA_REPOSTA = "energia_reposta"
        val SISTEMA = listOf(APARELHO_OFFLINE, APARELHO_ONLINE, ENERGIA_REPOSTA)
    }
}

/** Estado de um canal numa condição (`se.aparelhos`). */
data class EstadoCanal(val aparelho: String, val canal: Int, val valor: Int)

/** Condições opcionais (`se`): todas têm de ser verdade. */
data class Condicoes(
    val alarme: Boolean? = null,
    val entre: Pair<String, String>? = null,
    /** v3: dias da semana (1 = segunda … 7 = domingo). */
    val dias: List<Int>? = null,
    /** v3: `dia` ou `noite` (pelo sol). */
    val sol: String? = null,
    /** v3: a casa está num destes modos. */
    val modo: List<String>? = null,
    /** v3: `alguem` ou `ninguem` em casa. */
    val presenca: String? = null,
    /** v3: estado de outros canais. */
    val aparelhos: List<EstadoCanal>? = null,
) {
    val vazia: Boolean
        get() = alarme == null && entre == null && dias == null && sol == null && modo == null &&
            presenca == null && aparelhos == null

    companion object {
        const val DIA = "dia"
        const val NOITE = "noite"
        const val ALGUEM = "alguem"
        const val NINGUEM = "ninguem"
    }
}

/** Uma ação (`entao`, `senao` ou `acoes` de uma cena). */
sealed interface Acao {
    /** `ligar`/`desligar` um canal; com [duranteS] volta ao estado oposto depois desse tempo. */
    data class Ligar(val ligar: Boolean, val aparelho: String, val canal: Int, val duranteS: Int? = null) : Acao
    data class Estore(val aparelho: String, val canal: Int, val posicao: Int) : Acao
    data class Notificar(val mensagem: String) : Acao

    /** v3: luz com brilho 0–100. */
    data class Luz(val aparelho: String, val canal: Int, val brilho: Int) : Acao

    /** v3: troca o estado do canal. */
    data class Alternar(val aparelho: String, val canal: Int) : Acao

    /** v3: executa a cena [cena] (id). */
    data class Cena(val cena: String) : Acao

    /** v3: muda o modo da casa. */
    data class Modo(val modo: String, val forcar: Boolean = false) : Acao

    /** v3: as ações seguintes esperam [s] segundos (1–3600). */
    data class Esperar(val s: Int) : Acao

    /** v3: SE [condicao] ENTÃO [entao] SENÃO [senao] (máx. 2 níveis). */
    data class Se(val condicao: Condicoes, val entao: List<Acao>, val senao: List<Acao> = emptyList()) : Acao
}

/** Categorias da frase-objetivo (passo 1 do assistente). */
object Categorias {
    const val CONVENIENCIA = "conveniencia"
    const val ENERGIA = "energia"
    const val SEGURANCA = "seguranca"
    const val CONFORTO = "conforto"
    const val ROTINA = "rotina"
    val TODAS = listOf(CONVENIENCIA, ENERGIA, SEGURANCA, CONFORTO, ROTINA)

    fun rotulo(c: String?): String = when (c) {
        CONVENIENCIA -> "Conveniência"
        ENERGIA -> "Poupança de energia"
        SEGURANCA -> "Segurança"
        CONFORTO -> "Conforto"
        ROTINA -> "Rotina"
        else -> "—"
    }
}

/**
 * Uma automação (docs/PROTOCOLO-MQTT-v2.md, secção 3, e PROTOCOLO-MQTT-v3.md, secção 8).
 *
 * @property quando `null` se o motor publicou algo que a app não conhece (a automação mostra-se, mas não se edita).
 * @property original JSON tal como veio do motor, para não perder campos que a app não conhece ao voltar a publicar.
 * @property acoesDesconhecidas ações do motor que a app não sabe ler (a automação fica só de leitura).
 * @property desconhecida o gatilho ou as condições têm campos que a app não conhece (só de leitura).
 */
data class Automacao(
    val id: String,
    val nome: String,
    val ativa: Boolean = true,
    val bloqueada: Boolean = false,
    val quando: Quando? = null,
    val se: Condicoes? = null,
    val entao: List<Acao> = emptyList(),
    val original: String? = null,
    val acoesDesconhecidas: Int = 0,
    val descricao: String? = null,
    val categoria: String? = null,
    val ignorarPausa: Boolean = false,
    val desconhecida: Boolean = false,
) {
    /** O cliente pode editar (as bloqueadas foram criadas pela empresa: só se ativam/desativam). */
    val editavel: Boolean get() = !bloqueada && quando != null && acoesDesconhecidas == 0 && !desconhecida
}

/**
 * Leitura, escrita, edição e validação da lista de automações. Código puro (só org.json).
 */
object Automacoes {

    const val MAX_AUTOMACOES = 50

    /** v3: total de ações, contando as que estão dentro de SE/SENÃO. */
    const val MAX_ACOES = 20
    const val MAX_NIVEIS_SE = 2
    const val MAX_DESCRICAO = 200

    // Limites do motor (motor/src/validacao.js), repetidos aqui com mensagens simples.
    /** Nome de uma automação ou cena. */
    const val MAX_NOME = 80
    /** Texto de uma ação "notificar". */
    const val MAX_MENSAGEM = 200
    /** `durante_s` (gatilhos sensor/potência e ações ligar/desligar): 24 h. */
    const val MAX_DURACAO_S = 86_400
    /** Condições `se.aparelhos` por objeto de condições. */
    const val MAX_CONDICOES_APARELHOS = 10
    /** Canais: números de 1 a 64 (v3). */
    val CANAIS = 1..64
    /** `acima_w` do gatilho de potência. */
    const val MAX_ACIMA_W = 100_000.0

    /** Duração máxima de uma carga perigosa ligada por automação (4 h). */
    const val MAX_PERIGOSA_S = 4 * 3600
    val ID_RE = Regex("^[a-z0-9-]{1,40}$")
    val HORA_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    // Campos conhecidos (o motor recusa campos desconhecidos; o que a app não conhece fica só de leitura).
    private val CAMPOS_QUANDO = mapOf(
        "sensor" to setOf("tipo", "aparelho", "canal", "valor", "durante_s"),
        "hora" to setOf("tipo", "hora", "dias"),
        "potencia" to setOf("tipo", "aparelho", "acima_w", "durante_s", "rearmar_w"),
        "sol" to setOf("tipo", "evento", "desvio_min"),
        "presenca" to setOf("tipo", "evento"),
        "modo" to setOf("tipo", "modo"),
        "manual" to setOf("tipo"),
        "sistema" to setOf("tipo", "evento", "aparelho"),
    )
    private val CAMPOS_SE = setOf("alarme", "entre", "dias", "sol", "modo", "presenca", "aparelhos")

    // ---------- Ler ----------

    /** Lê a lista retida `_automacoes`. `null` se não for uma lista JSON. */
    fun ler(payload: String): List<Automacao>? {
        if (payload.isBlank()) return emptyList()
        val array = try {
            JSONTokener(payload).nextValue() as? JSONArray
        } catch (e: JSONException) {
            null
        } ?: return null
        val lista = mutableListOf<Automacao>()
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            lerUma(o)?.let { lista += it }
        }
        return lista
    }

    fun lerUma(o: JSONObject): Automacao? {
        val id = o.opt("id") as? String ?: return null
        val (acoes, desconhecidas) = lerAcoes(o.optJSONArray("entao"))
        val q = o.optJSONObject("quando")
        val s = o.optJSONObject("se")
        val quando = q?.let(::lerQuando)
        val se = s?.let(::lerSe)
        val qDesconhecido = q != null && quando != null && q.keys().asSequence().any { it !in CAMPOS_QUANDO[q.opt("tipo")].orEmpty() }
        val sDesconhecido = s != null && (se == null && s.length() > 0 || s.keys().asSequence().any { it !in CAMPOS_SE })
        return Automacao(
            id = id,
            nome = (o.opt("nome") as? String)?.takeIf { it.isNotBlank() } ?: id,
            ativa = o.opt("ativa") as? Boolean ?: true,
            bloqueada = o.opt("bloqueada") as? Boolean ?: false,
            quando = quando,
            se = se,
            entao = acoes,
            original = o.toString(),
            acoesDesconhecidas = desconhecidas,
            descricao = (o.opt("descricao") as? String)?.takeIf { it.isNotBlank() },
            categoria = o.opt("categoria") as? String,
            ignorarPausa = o.opt("ignorar_pausa") as? Boolean ?: false,
            desconhecida = qDesconhecido || sDesconhecido,
        )
    }

    /** Lê uma lista de ações; devolve as conhecidas e quantas não se perceberam. */
    fun lerAcoes(array: JSONArray?): Pair<List<Acao>, Int> {
        if (array == null) return emptyList<Acao>() to 0
        var desconhecidas = 0
        val acoes = mutableListOf<Acao>()
        for (i in 0 until array.length()) {
            val a = array.optJSONObject(i)?.let(::lerAcao)
            if (a != null) acoes += a else desconhecidas++
        }
        return acoes to desconhecidas
    }

    private fun lerQuando(q: JSONObject): Quando? = when (q.opt("tipo")) {
        "sensor" -> {
            val ap = q.opt("aparelho") as? String
            val canal = inteiro(q.opt("canal"))
            val valor = inteiro(q.opt("valor"))
            if (ap != null && canal != null && valor != null) Quando.Sensor(ap, canal, valor, inteiro(q.opt("durante_s"))) else null
        }
        "hora" -> {
            val hora = q.opt("hora") as? String
            val dias = q.optJSONArray("dias")?.let { d -> (0 until d.length()).mapNotNull { inteiro(d.opt(it)) } }
            if (hora != null) Quando.Hora(hora, dias ?: (1..7).toList()) else null
        }
        "potencia" -> {
            val ap = q.opt("aparelho") as? String
            val w = (q.opt("acima_w") as? Number)?.toDouble()
            val s = inteiro(q.opt("durante_s")) ?: 0
            val r = (q.opt("rearmar_w") as? Number)?.toDouble()
            if (ap != null && w != null) Quando.Potencia(ap, w, s, r) else null
        }
        "sol" -> (q.opt("evento") as? String)?.let { Quando.Sol(it, inteiro(q.opt("desvio_min")) ?: 0) }
        "presenca" -> (q.opt("evento") as? String)?.let { Quando.Presenca(it) }
        "modo" -> (q.opt("modo") as? String)?.let { Quando.Modo(it) }
        "manual" -> Quando.Manual
        "sistema" -> (q.opt("evento") as? String)?.let { Quando.Sistema(it, q.opt("aparelho") as? String) }
        else -> null
    }

    /** Lê um objeto de condições (`se` ou `condicao` de um SE). `null` se estiver vazio ou não se perceber. */
    fun lerSe(s: JSONObject): Condicoes? {
        val alarme = s.opt("alarme") as? Boolean
        val entre = s.optJSONArray("entre")?.let { e ->
            val a = e.opt(0) as? String
            val b = e.opt(1) as? String
            if (e.length() == 2 && a != null && b != null) a to b else null
        }
        val dias = s.optJSONArray("dias")?.let { d -> (0 until d.length()).mapNotNull { inteiro(d.opt(it)) } }
        val modo = s.optJSONArray("modo")?.let { m -> (0 until m.length()).mapNotNull { m.opt(it) as? String } }
        val aparelhos = s.optJSONArray("aparelhos")?.let { arr ->
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val ap = o.opt("aparelho") as? String
                val c = inteiro(o.opt("canal"))
                val v = inteiro(o.opt("valor"))
                if (ap != null && c != null && v != null) EstadoCanal(ap, c, v) else null
            }
        }
        return Condicoes(
            alarme = alarme,
            entre = entre,
            dias = dias,
            sol = s.opt("sol") as? String,
            modo = modo,
            presenca = s.opt("presenca") as? String,
            aparelhos = aparelhos,
        ).takeUnless { it.vazia }
    }

    fun lerAcao(a: JSONObject): Acao? {
        val ap = a.opt("aparelho") as? String
        val canal = inteiro(a.opt("canal"))
        return when (val acao = a.opt("acao")) {
            "ligar", "desligar" ->
                if (ap != null && canal != null) Acao.Ligar(acao == "ligar", ap, canal, inteiro(a.opt("durante_s"))) else null
            "estore" -> {
                val pos = inteiro(a.opt("posicao"))
                if (ap != null && canal != null && pos != null) Acao.Estore(ap, canal, pos) else null
            }
            "notificar" -> (a.opt("mensagem") as? String)?.let { Acao.Notificar(it) }
            "luz" -> {
                val b = inteiro(a.opt("brilho"))
                if (ap != null && canal != null && b != null) Acao.Luz(ap, canal, b) else null
            }
            "alternar" -> if (ap != null && canal != null) Acao.Alternar(ap, canal) else null
            "cena" -> (a.opt("cena") as? String)?.let { Acao.Cena(it) }
            "modo" -> (a.opt("modo") as? String)?.let { Acao.Modo(it, a.opt("forcar") as? Boolean ?: false) }
            "esperar" -> inteiro(a.opt("s"))?.let { Acao.Esperar(it) }
            "se" -> {
                val c = a.optJSONObject("condicao") ?: return null
                if (c.keys().asSequence().any { it !in CAMPOS_SE }) return null
                val cond = lerSe(c) ?: return null
                val (entao, d1) = lerAcoes(a.optJSONArray("entao"))
                val (senao, d2) = lerAcoes(a.optJSONArray("senao"))
                if (d1 + d2 > 0) null else Acao.Se(cond, entao, senao)
            }
            else -> null
        }
    }

    internal fun inteiro(v: Any?): Int? = when (v) {
        is Int -> v
        is Long -> v.toInt()
        is Number -> v.toDouble().takeIf { it == Math.floor(it) && !it.isInfinite() }?.toInt()
        else -> null
    }

    // ---------- Escrever ----------

    /** JSON de uma automação. Parte do [Automacao.original] para manter campos que a app não conhece. */
    fun paraJson(a: Automacao): JSONObject {
        val o = a.original?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        o.put("id", a.id)
        o.put("nome", a.nome)
        o.put("ativa", a.ativa)
        o.put("bloqueada", a.bloqueada)
        // Automações que a app não percebe completamente seguem como vieram (só muda `ativa`).
        if (!a.bloqueada && a.editavel) {
            o.put("quando", quandoJson(a.quando!!))
            if (a.se == null || a.se.vazia) o.remove("se") else o.put("se", seJson(a.se))
            o.put("entao", acoesJson(a.entao))
            if (a.descricao.isNullOrBlank()) o.remove("descricao") else o.put("descricao", a.descricao)
            if (a.categoria == null) o.remove("categoria") else o.put("categoria", a.categoria)
            if (a.ignorarPausa) o.put("ignorar_pausa", true) else o.remove("ignorar_pausa")
        }
        return o
    }

    /** Lista completa para `_automacoes/set`. */
    fun paraJson(lista: List<Automacao>): String = JSONArray().apply { lista.forEach { put(paraJson(it)) } }.toString()

    fun quandoJson(q: Quando): JSONObject = when (q) {
        is Quando.Sensor -> JSONObject().put("tipo", "sensor").put("aparelho", q.aparelho).put("canal", q.canal).put("valor", q.valor)
            .apply { q.duranteS?.let { put("durante_s", it) } }
        is Quando.Hora -> JSONObject().put("tipo", "hora").put("hora", q.hora).put("dias", JSONArray(q.dias.distinct().sorted()))
        is Quando.Potencia -> JSONObject().put("tipo", "potencia").put("aparelho", q.aparelho)
            .put("acima_w", numeroJson(q.acimaW)).put("durante_s", q.duranteS)
            .apply { q.rearmarW?.let { put("rearmar_w", numeroJson(it)) } }
        is Quando.Sol -> JSONObject().put("tipo", "sol").put("evento", q.evento).put("desvio_min", q.desvioMin)
        is Quando.Presenca -> JSONObject().put("tipo", "presenca").put("evento", q.evento)
        is Quando.Modo -> JSONObject().put("tipo", "modo").put("modo", q.modo)
        Quando.Manual -> JSONObject().put("tipo", "manual")
        is Quando.Sistema -> JSONObject().put("tipo", "sistema").put("evento", q.evento)
            .apply { q.aparelho?.let { put("aparelho", it) } }
    }

    fun seJson(s: Condicoes): JSONObject = JSONObject().apply {
        s.alarme?.let { put("alarme", it) }
        s.entre?.let { put("entre", JSONArray().put(it.first).put(it.second)) }
        s.dias?.let { put("dias", JSONArray(it.distinct().sorted())) }
        s.sol?.let { put("sol", it) }
        s.modo?.let { put("modo", JSONArray(it.distinct())) }
        s.presenca?.let { put("presenca", it) }
        s.aparelhos?.let { l ->
            put("aparelhos", JSONArray().apply {
                l.forEach { put(JSONObject().put("aparelho", it.aparelho).put("canal", it.canal).put("valor", it.valor)) }
            })
        }
    }

    fun acoesJson(l: List<Acao>): JSONArray = JSONArray().apply { l.forEach { put(acaoJson(it)) } }

    fun acaoJson(a: Acao): JSONObject = when (a) {
        is Acao.Ligar -> JSONObject().put("acao", if (a.ligar) "ligar" else "desligar").put("aparelho", a.aparelho)
            .put("canal", a.canal).apply { a.duranteS?.let { put("durante_s", it) } }
        is Acao.Estore -> JSONObject().put("acao", "estore").put("aparelho", a.aparelho).put("canal", a.canal).put("posicao", a.posicao)
        is Acao.Notificar -> JSONObject().put("acao", "notificar").put("mensagem", a.mensagem)
        is Acao.Luz -> JSONObject().put("acao", "luz").put("aparelho", a.aparelho).put("canal", a.canal).put("brilho", a.brilho)
        is Acao.Alternar -> JSONObject().put("acao", "alternar").put("aparelho", a.aparelho).put("canal", a.canal)
        is Acao.Cena -> JSONObject().put("acao", "cena").put("cena", a.cena)
        is Acao.Modo -> JSONObject().put("acao", "modo").put("modo", a.modo).put("forcar", a.forcar)
        is Acao.Esperar -> JSONObject().put("acao", "esperar").put("s", a.s)
        is Acao.Se -> JSONObject().put("acao", "se").put("condicao", seJson(a.condicao))
            .put("entao", acoesJson(a.entao)).put("senao", acoesJson(a.senao))
    }

    // Inteiros sem ".0" (3500 e não 3500.0), iguais em org.json da JVM e do Android.
    internal fun numeroJson(d: Double): Any = if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong() else d

    // ---------- Editar a lista ----------

    /**
     * Guarda [nova] na lista: substitui a automação com id [idAnterior] (edição) ou acrescenta no fim (nova).
     * Automações bloqueadas não são substituídas (devolve a lista igual).
     */
    fun guardar(lista: List<Automacao>, nova: Automacao, idAnterior: String? = null): List<Automacao> {
        val i = if (idAnterior == null) -1 else lista.indexOfFirst { it.id == idAnterior }
        if (i < 0) return lista + nova
        if (lista[i].bloqueada) return lista
        return lista.toMutableList().also { it[i] = nova.copy(original = lista[i].original, acoesDesconhecidas = 0, desconhecida = false) }
    }

    /** Apaga a automação [id]; as bloqueadas não se apagam. */
    fun remover(lista: List<Automacao>, id: String): List<Automacao> =
        lista.filterNot { it.id == id && !it.bloqueada }

    /** Ativa/desativa (permitido também nas bloqueadas). */
    fun comAtiva(lista: List<Automacao>, id: String, ativa: Boolean): List<Automacao> =
        lista.map { if (it.id == id) it.copy(ativa = ativa) else it }

    /** "Luz do corredor" → "luz-do-corredor", único entre [existentes]. */
    fun slug(nome: String, existentes: Collection<String> = emptyList()): String {
        var base = Normalizer.normalize(nome, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
            .lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
            .take(34).trimEnd('-')
        if (base.isEmpty()) base = "automacao"
        if (base !in existentes) return base
        var i = 2
        while ("$base-$i" in existentes) i++
        return "$base-$i"
    }

    // ---------- Validar ----------

    /** Número total de ações, contando as que estão dentro de SE/SENÃO (o próprio SE conta uma). */
    fun contarAcoes(l: List<Acao>): Int = l.sumOf { if (it is Acao.Se) 1 + contarAcoes(it.entao) + contarAcoes(it.senao) else 1 }

    /** Níveis de SE encaixados (0 = nenhum SE). */
    fun niveisSe(l: List<Acao>): Int = l.maxOfOrNull { if (it is Acao.Se) 1 + maxOf(niveisSe(it.entao), niveisSe(it.senao)) else 0 } ?: 0

    /**
     * Erros (pt-PT) de uma automação criada/editada pelo cliente. O motor volta a validar; isto só evita
     * mandar listas que ele recusaria. Com [aparelhos] vazio não se verificam aparelhos/canais; com
     * [cenas] `null` não se verificam as cenas; com [config] `null` não se verifica a localização.
     */
    fun validar(
        a: Automacao,
        aparelhos: List<Aparelho> = emptyList(),
        cenas: List<Cena>? = null,
        config: ConfigCasa? = null,
    ): List<String> {
        val erros = mutableListOf<String>()
        val conhecidos = aparelhos.isNotEmpty()
        fun canal(ap: String, n: Int): Canal? = aparelhos.firstOrNull { it.id == ap }?.canal(n)
        val semLocal = config != null && config.local == null

        if (!ID_RE.matches(a.id)) erros += "Identificador inválido."
        if (a.nome.isBlank()) erros += "Dê um nome à automação."
        else if (a.nome.length > MAX_NOME) erros += "O nome tem no máximo $MAX_NOME caracteres."
        if ((a.descricao?.length ?: 0) > MAX_DESCRICAO) erros += "O objetivo tem no máximo $MAX_DESCRICAO caracteres."
        if (a.categoria != null && a.categoria !in Categorias.TODAS) erros += "Categoria inválida."
        when (val q = a.quando) {
            is Quando.Sensor -> {
                if (q.aparelho.isBlank()) erros += "Escolha o sensor."
                else if (q.canal !in CANAIS) erros += "Canal inválido (de 1 a 64)."
                else if (conhecidos && canal(q.aparelho, q.canal)?.funcao !in FUNCOES_GATILHO) erros += "Escolha um sensor, circuito ou luz."
                if (q.valor != 0 && q.valor != 1) erros += "Escolha o estado do sensor."
                if (q.duranteS != null && q.duranteS !in 1..MAX_DURACAO_S) erros += "Indique há quanto tempo (até 24 h)."
            }
            is Quando.Hora -> {
                if (!HORA_RE.matches(q.hora)) erros += "Indique a hora (HH:MM)."
                if (q.dias.isEmpty() || q.dias.any { it !in 1..7 }) erros += "Escolha pelo menos um dia."
            }
            is Quando.Potencia -> {
                if (q.aparelho.isBlank()) erros += "Escolha o medidor."
                else if (conhecidos && aparelhos.firstOrNull { it.id == q.aparelho }?.medidor != true) erros += "Esse aparelho não mede consumo."
                if (!(q.acimaW > 0)) erros += "Indique a potência (W)."
                else if (q.acimaW > MAX_ACIMA_W) erros += "A potência vai até 100 000 W."
                if (q.duranteS < 0) erros += "Indique durante quantos segundos."
                else if (q.duranteS > MAX_DURACAO_S) erros += "O tempo acima do limite vai até 24 h (86 400 s)."
                if (q.rearmarW != null && q.acimaW > 0 && !(q.rearmarW > 0 && q.rearmarW < q.acimaW)) erros += "O rearme tem de ficar abaixo do limite."
            }
            is Quando.Sol -> {
                if (q.evento != Quando.SOL_NASCER && q.evento != Quando.SOL_POR) erros += "Escolha nascer ou pôr do sol."
                if (q.desvioMin !in -180..180) erros += "O desvio do sol vai de -180 a 180 min."
            }
            is Quando.Presenca -> if (q.evento != Quando.CHEGA_PRIMEIRO && q.evento != Quando.SAI_ULTIMO) erros += "Escolha chegar ou sair."
            is Quando.Modo -> if (q.modo !in Modos.TODOS) erros += "Escolha o modo."
            Quando.Manual -> {}
            is Quando.Sistema -> {
                if (q.evento !in Quando.SISTEMA) erros += "Escolha o evento do sistema."
                if (q.aparelho != null && conhecidos && aparelhos.none { it.id == q.aparelho }) erros += "Esse aparelho não existe."
            }
            null -> erros += "Escolha quando a automação dispara."
        }
        if (semLocal && (a.quando is Quando.Sol || a.se?.sol != null)) {
            erros += "Defina a localização da casa em Definições (nascer e pôr do sol)."
        }
        a.se?.let { erros += validarCondicoes(it, aparelhos, "") }

        val total = contarAcoes(a.entao)
        if (a.entao.isEmpty() || total > MAX_ACOES) erros += "Tem de ter entre 1 e $MAX_ACOES ações."
        if (niveisSe(a.entao) > MAX_NIVEIS_SE) erros += "No máximo $MAX_NIVEIS_SE níveis de SE/SENÃO."
        erros += validarAcoes(a.entao, aparelhos, cenas, "", permiteSe = true, config = config)
        return erros
    }

    private val FUNCOES_GATILHO = setOf(Funcao.PORTA, Funcao.MOVIMENTO, Funcao.INTERRUPTOR, Funcao.LUZ)

    private fun validarCondicoes(s: Condicoes, aparelhos: List<Aparelho>, prefixo: String): List<String> {
        val erros = mutableListOf<String>()
        val conhecidos = aparelhos.isNotEmpty()
        s.entre?.let { (de, ate) ->
            if (!HORA_RE.matches(de) || !HORA_RE.matches(ate)) erros += "${prefixo}Horário inválido (HH:MM)."
            else if (de == ate) erros += "${prefixo}O horário tem de começar e acabar a horas diferentes."
        }
        s.dias?.let { if (it.isEmpty() || it.any { d -> d !in 1..7 }) erros += "${prefixo}Escolha pelo menos um dia na condição." }
        s.sol?.let { if (it != Condicoes.DIA && it != Condicoes.NOITE) erros += "${prefixo}Condição do sol inválida." }
        s.modo?.let { if (it.isEmpty() || it.any { m -> m !in Modos.TODOS }) erros += "${prefixo}Escolha pelo menos um modo." }
        s.presenca?.let { if (it != Condicoes.ALGUEM && it != Condicoes.NINGUEM) erros += "${prefixo}Condição de presença inválida." }
        s.aparelhos?.let { if (it.size > MAX_CONDICOES_APARELHOS) erros += "${prefixo}No máximo $MAX_CONDICOES_APARELHOS condições de aparelhos." }
        s.aparelhos?.forEach { e ->
            val c = aparelhos.firstOrNull { it.id == e.aparelho }?.canal(e.canal)
            if (e.aparelho.isBlank() || e.canal !in CANAIS || (conhecidos && c == null)) erros += "${prefixo}Escolha o aparelho da condição."
            if (e.valor != 0 && e.valor != 1) erros += "${prefixo}Estado do aparelho inválido."
        }
        return erros
    }

    /**
     * Erros das ações (também usado nas cenas, com [permiteSe] = false: sem SE nem cenas dentro de cenas).
     * [prefixo] numera as ações encaixadas ("Ação 3.1").
     */
    fun validarAcoes(
        l: List<Acao>,
        aparelhos: List<Aparelho>,
        cenas: List<Cena>?,
        prefixo: String,
        permiteSe: Boolean,
        config: ConfigCasa? = null,
    ): List<String> {
        val erros = mutableListOf<String>()
        val conhecidos = aparelhos.isNotEmpty()
        fun canal(ap: String, n: Int): Canal? = aparelhos.firstOrNull { it.id == ap }?.canal(n)
        l.forEachIndexed { i, x ->
            val n = "$prefixo${i + 1}"
            val alvo = when (x) {
                is Acao.Ligar -> x.aparelho to x.canal
                is Acao.Estore -> x.aparelho to x.canal
                is Acao.Luz -> x.aparelho to x.canal
                is Acao.Alternar -> x.aparelho to x.canal
                else -> null
            }
            if (alvo != null && alvo.first.isNotBlank() && alvo.second !in CANAIS) erros += "Ação $n: canal inválido (de 1 a 64)."
            when (x) {
                is Acao.Ligar -> {
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha o circuito."
                    else if (conhecidos && canal(x.aparelho, x.canal)?.funcao.let { it != Funcao.INTERRUPTOR && it != Funcao.LUZ }) erros += "Ação $n: escolha um circuito ou uma luz."
                    if (x.duranteS != null && x.duranteS <= 0) erros += "Ação $n: duração inválida."
                    else if (x.duranteS != null && x.duranteS > MAX_DURACAO_S) erros += "Ação $n: a duração vai até 24 h (1440 min)."
                    val c = canal(x.aparelho, x.canal)
                    if (x.ligar && c?.perigosa == true) {
                        if (x.duranteS == null) erros += "Ação $n: ${c.nome} é uma carga perigosa; indique durante quanto tempo (máx. 4 h)."
                        else if (x.duranteS > MAX_PERIGOSA_S) erros += "Ação $n: ${c.nome} é uma carga perigosa; no máximo 4 h."
                    }
                }
                is Acao.Estore -> {
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha o estore."
                    else if (conhecidos && canal(x.aparelho, x.canal)?.funcao != Funcao.ESTORE) erros += "Ação $n: escolha um estore."
                    if (x.posicao !in 0..100) erros += "Ação $n: posição de 0 a 100."
                }
                is Acao.Notificar -> when {
                    x.mensagem.isBlank() -> erros += "Ação $n: escreva a mensagem."
                    x.mensagem.length > MAX_MENSAGEM -> erros += "Ação $n: a mensagem tem no máximo $MAX_MENSAGEM caracteres (tem ${x.mensagem.length})."
                }
                is Acao.Luz -> {
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha a luz."
                    else if (conhecidos && canal(x.aparelho, x.canal)?.funcao != Funcao.LUZ) erros += "Ação $n: escolha uma luz com brilho."
                    if (x.brilho !in 0..100) erros += "Ação $n: brilho de 0 a 100."
                }
                is Acao.Alternar -> {
                    val c = canal(x.aparelho, x.canal)
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha o circuito."
                    else if (conhecidos && c?.funcao.let { it != Funcao.INTERRUPTOR && it != Funcao.LUZ }) erros += "Ação $n: escolha um circuito ou uma luz."
                    if (c?.perigosa == true) erros += "Ação $n: ${c.nome} é uma carga perigosa; use \"Ligar\" com duração."
                }
                is Acao.Cena -> when {
                    !permiteSe -> erros += "Ação $n: uma cena não pode executar outra cena."
                    x.cena.isBlank() -> erros += "Ação $n: escolha a cena."
                    cenas != null && cenas.none { it.id == x.cena } -> erros += "Ação $n: essa cena não existe."
                }
                is Acao.Modo -> if (x.modo !in Modos.TODOS) erros += "Ação $n: escolha o modo."
                is Acao.Esperar -> if (x.s !in 1..3600) erros += "Ação $n: esperar de 1 s a 1 h."
                is Acao.Se -> if (!permiteSe) {
                    erros += "Ação $n: uma cena não pode ter SE/SENÃO."
                } else {
                    if (x.condicao.vazia) erros += "Ação $n: escolha a condição do SE."
                    erros += validarCondicoes(x.condicao, aparelhos, "Ação $n: ")
                    if (config != null && config.local == null && x.condicao.sol != null) {
                        erros += "Ação $n: defina a localização da casa em Definições (nascer e pôr do sol)."
                    }
                    if (x.entao.isEmpty()) erros += "Ação $n: o SE precisa de pelo menos uma ação."
                    erros += validarAcoes(x.entao, aparelhos, cenas, "$n.", true, config)
                    // Numeração: "Ação 3.1" (ENTÃO) e "Ação 3.s1" (SENÃO).
                    erros += validarAcoes(x.senao, aparelhos, cenas, "$n.s", true, config)
                }
            }
        }
        return erros
    }

    /** Erros da lista completa (máximo de automações, ids repetidos). */
    fun validarLista(lista: List<Automacao>): List<String> {
        val erros = mutableListOf<String>()
        if (lista.size > MAX_AUTOMACOES) erros += "No máximo $MAX_AUTOMACOES automações."
        val repetidos = lista.groupingBy { it.id }.eachCount().filterValues { it > 1 }.keys
        if (repetidos.isNotEmpty()) erros += "Identificador repetido: ${repetidos.joinToString()}."
        return erros
    }

    // ---------- Texto ----------

    private val DIAS = listOf("seg", "ter", "qua", "qui", "sex", "sáb", "dom")

    fun descreverDias(dias: List<Int>): String {
        val d = dias.distinct().sorted()
        return when {
            d.size == 7 -> "todos os dias"
            d == listOf(1, 2, 3, 4, 5) -> "dias úteis"
            d == listOf(6, 7) -> "fins de semana"
            else -> d.filter { it in 1..7 }.joinToString(", ") { DIAS[it - 1] }
        }
    }

    fun nomeCanal(aparelhos: List<Aparelho>, id: String, n: Int): String {
        val ap = aparelhos.firstOrNull { it.id == id } ?: return id
        val c = ap.canal(n)
        return when {
            c == null || !c.temNome -> ap.nome
            ap.canais.size > 1 -> "${ap.nome} · ${c.nome}"
            else -> c.nome
        }
    }

    internal fun duracao(s: Int): String = when {
        s >= 3600 && s % 3600 == 0 -> "${s / 3600} h"
        s % 60 == 0 -> "${s / 60} min"
        else -> "$s s"
    }

    private fun nomeAparelho(aparelhos: List<Aparelho>, id: String) = aparelhos.firstOrNull { it.id == id }?.nome ?: id

    fun descreverQuando(q: Quando?, aparelhos: List<Aparelho>): String = when (q) {
        is Quando.Sensor -> {
            val f = aparelhos.firstOrNull { it.id == q.aparelho }?.canal(q.canal)?.funcao
            val durante = q.duranteS != null
            val verbo = when (f) {
                Funcao.PORTA -> if (durante) (if (q.valor == 1) "está aberta" else "está fechada") else if (q.valor == 1) "abre" else "fecha"
                Funcao.MOVIMENTO -> if (durante) (if (q.valor == 1) "tem movimento" else "está sem movimento")
                else if (q.valor == 1) "deteta movimento" else "deixa de detetar movimento"
                Funcao.INTERRUPTOR, Funcao.LUZ -> if (durante) (if (q.valor == 1) "está ligado" else "está desligado")
                else if (q.valor == 1) "é ligado" else "é desligado"
                else -> if (q.valor == 1) "fica ativo" else "fica inativo"
            }
            "Quando ${nomeCanal(aparelhos, q.aparelho, q.canal)} $verbo" + (q.duranteS?.let { " há ${duracao(it)}" } ?: "")
        }
        is Quando.Hora -> "Às ${q.hora}, ${descreverDias(q.dias)}"
        is Quando.Potencia -> "Quando ${nomeAparelho(aparelhos, q.aparelho)} passa " +
            "${numeroJson(q.acimaW)} W durante ${duracao(q.duranteS)}"
        is Quando.Sol -> {
            val ev = if (q.evento == Quando.SOL_NASCER) "nascer do sol" else "pôr do sol"
            when {
                q.desvioMin == 0 -> "Ao $ev"
                q.desvioMin < 0 -> "${duracao(-q.desvioMin * 60)} antes do $ev"
                else -> "${duracao(q.desvioMin * 60)} depois do $ev"
            }
        }
        is Quando.Presenca -> if (q.evento == Quando.CHEGA_PRIMEIRO) "Quando o primeiro chega a casa" else "Quando o último sai de casa"
        is Quando.Modo -> "Quando a casa passa a ${Modos.rotulo(q.modo)}"
        Quando.Manual -> "Quando carregar em Executar"
        is Quando.Sistema -> when (q.evento) {
            Quando.ENERGIA_REPOSTA -> "Quando a luz volta depois de um corte"
            Quando.APARELHO_OFFLINE -> "Quando ${q.aparelho?.let { nomeAparelho(aparelhos, it) } ?: "um aparelho"} fica offline"
            Quando.APARELHO_ONLINE -> "Quando ${q.aparelho?.let { nomeAparelho(aparelhos, it) } ?: "um aparelho"} volta a ficar online"
            else -> "Evento do sistema"
        }
        null -> "Regra definida pela Domus Energia"
    }

    fun descreverCondicoes(s: Condicoes?, aparelhos: List<Aparelho>): List<String> = buildList {
        when (s?.alarme) {
            true -> add("com alarme ativo")
            false -> add("com alarme desligado")
            null -> {}
        }
        s?.entre?.let { add("entre ${it.first} e ${it.second}") }
        s?.dias?.let { add(descreverDias(it)) }
        s?.sol?.let { add(if (it == Condicoes.NOITE) "de noite" else "de dia") }
        s?.modo?.let { m -> add("em modo " + m.joinToString(" ou ") { Modos.rotulo(it) }) }
        s?.presenca?.let { add(if (it == Condicoes.ALGUEM) "com alguém em casa" else "sem ninguém em casa") }
        s?.aparelhos?.forEach { e ->
            val f = aparelhos.firstOrNull { it.id == e.aparelho }?.canal(e.canal)?.funcao
            add("${nomeCanal(aparelhos, e.aparelho, e.canal)} ${valorTexto(f, e.valor)}")
        }
    }

    /** "aberta", "ligado", ... para condições de estado de canais. */
    fun valorTexto(funcao: String?, valor: Int): String = when (funcao) {
        Funcao.PORTA -> if (valor == 1) "aberta" else "fechada"
        Funcao.MOVIMENTO -> if (valor == 1) "com movimento" else "sem movimento"
        else -> if (valor == 1) "ligado" else "desligado"
    }

    fun descreverAcao(it: Acao, aparelhos: List<Aparelho>, cenas: List<Cena> = emptyList()): String = when (it) {
        is Acao.Ligar -> (if (it.ligar) "liga " else "desliga ") + nomeCanal(aparelhos, it.aparelho, it.canal) +
            (it.duranteS?.let { s -> " durante ${duracao(s)}" } ?: "")
        is Acao.Estore -> "põe ${nomeCanal(aparelhos, it.aparelho, it.canal)} a ${it.posicao} %"
        is Acao.Notificar -> "avisa: \"${it.mensagem}\""
        is Acao.Luz -> "põe ${nomeCanal(aparelhos, it.aparelho, it.canal)} a ${it.brilho} %"
        is Acao.Alternar -> "alterna ${nomeCanal(aparelhos, it.aparelho, it.canal)}"
        is Acao.Cena -> "executa a cena ${cenas.firstOrNull { c -> c.id == it.cena }?.nome ?: it.cena}"
        is Acao.Modo -> "muda para ${Modos.rotulo(it.modo)}" + if (it.forcar) " (mesmo com portas abertas)" else ""
        is Acao.Esperar -> "espera ${duracao(it.s)}"
        is Acao.Se -> "se " + descreverCondicoes(it.condicao, aparelhos).joinToString(" e ") +
            " então " + it.entao.joinToString(", ") { a -> descreverAcao(a, aparelhos, cenas) } +
            (if (it.senao.isEmpty()) "" else " senão " + it.senao.joinToString(", ") { a -> descreverAcao(a, aparelhos, cenas) })
    }

    /** Frase curta que descreve a automação, ex.: "Quando Movimento corredor deteta movimento, entre 19:00 e 07:00 → liga …". */
    fun descrever(a: Automacao, aparelhos: List<Aparelho>, cenas: List<Cena> = emptyList()): String {
        val quando = descreverQuando(a.quando, aparelhos)
        val se = descreverCondicoes(a.se, aparelhos)
        val acoes = a.entao.map { descreverAcao(it, aparelhos, cenas) }
        return (listOf(quando) + se).joinToString(", ") + if (acoes.isEmpty()) "" else " → " + acoes.joinToString("; ")
    }
}
