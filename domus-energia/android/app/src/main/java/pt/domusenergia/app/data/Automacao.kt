package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.text.Normalizer

/** O que faz disparar uma automação (`quando`). */
sealed interface Quando {
    /** Um canal `porta`/`movimento` passa a [valor] (1 aberta/movimento, 0 fechada/sem movimento). */
    data class Sensor(val aparelho: String, val canal: Int, val valor: Int) : Quando

    /** A uma hora ("HH:MM"), nos [dias] indicados (1 = segunda … 7 = domingo). */
    data class Hora(val hora: String, val dias: List<Int>) : Quando

    /** Consumo de [aparelho] acima de [acimaW] durante [duranteS] segundos. */
    data class Potencia(val aparelho: String, val acimaW: Double, val duranteS: Int) : Quando
}

/** Condições opcionais (`se`): todas têm de ser verdade. */
data class Condicoes(val alarme: Boolean? = null, val entre: Pair<String, String>? = null) {
    val vazia: Boolean get() = alarme == null && entre == null
}

/** Uma ação (`entao`). */
sealed interface Acao {
    /** `ligar`/`desligar` um canal; com [duranteS] volta ao estado oposto depois desse tempo. */
    data class Ligar(val ligar: Boolean, val aparelho: String, val canal: Int, val duranteS: Int? = null) : Acao
    data class Estore(val aparelho: String, val canal: Int, val posicao: Int) : Acao
    data class Notificar(val mensagem: String) : Acao
}

/**
 * Uma automação (docs/PROTOCOLO-MQTT-v2.md, secção 3).
 *
 * @property quando `null` se o motor publicou algo que a app não conhece (a automação mostra-se, mas não se edita).
 * @property original JSON tal como veio do motor, para não perder campos que a app não conhece ao voltar a publicar.
 * @property acoesDesconhecidas ações do motor que a app não sabe ler (a automação fica só de leitura).
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
) {
    /** O cliente pode editar (as bloqueadas foram criadas pela empresa: só se ativam/desativam). */
    val editavel: Boolean get() = !bloqueada && quando != null && acoesDesconhecidas == 0
}

/**
 * Leitura, escrita, edição e validação da lista de automações. Código puro (só org.json).
 */
object Automacoes {

    const val MAX_AUTOMACOES = 50
    const val MAX_ACOES = 10
    val ID_RE = Regex("^[a-z0-9-]{1,40}$")
    val HORA_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

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
        var desconhecidas = 0
        val acoes = mutableListOf<Acao>()
        val entao = o.optJSONArray("entao")
        if (entao != null) {
            for (i in 0 until entao.length()) {
                val a = entao.optJSONObject(i)?.let(::lerAcao)
                if (a != null) acoes += a else desconhecidas++
            }
        }
        return Automacao(
            id = id,
            nome = (o.opt("nome") as? String)?.takeIf { it.isNotBlank() } ?: id,
            ativa = o.opt("ativa") as? Boolean ?: true,
            bloqueada = o.opt("bloqueada") as? Boolean ?: false,
            quando = o.optJSONObject("quando")?.let(::lerQuando),
            se = o.optJSONObject("se")?.let(::lerSe),
            entao = acoes,
            original = o.toString(),
            acoesDesconhecidas = desconhecidas,
        )
    }

    private fun lerQuando(q: JSONObject): Quando? = when (q.opt("tipo")) {
        "sensor" -> {
            val ap = q.opt("aparelho") as? String
            val canal = inteiro(q.opt("canal"))
            val valor = inteiro(q.opt("valor"))
            if (ap != null && canal != null && valor != null) Quando.Sensor(ap, canal, valor) else null
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
            if (ap != null && w != null) Quando.Potencia(ap, w, s) else null
        }
        else -> null
    }

    private fun lerSe(s: JSONObject): Condicoes? {
        val alarme = s.opt("alarme") as? Boolean
        val entre = s.optJSONArray("entre")?.let { e ->
            val a = e.opt(0) as? String
            val b = e.opt(1) as? String
            if (e.length() == 2 && a != null && b != null) a to b else null
        }
        return Condicoes(alarme, entre).takeUnless { it.vazia }
    }

    private fun lerAcao(a: JSONObject): Acao? {
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
            else -> null
        }
    }

    private fun inteiro(v: Any?): Int? = when (v) {
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
            o.put("entao", JSONArray().apply { a.entao.forEach { put(acaoJson(it)) } })
        }
        return o
    }

    /** Lista completa para `_automacoes/set`. */
    fun paraJson(lista: List<Automacao>): String = JSONArray().apply { lista.forEach { put(paraJson(it)) } }.toString()

    private fun quandoJson(q: Quando): JSONObject = when (q) {
        is Quando.Sensor -> JSONObject().put("tipo", "sensor").put("aparelho", q.aparelho).put("canal", q.canal).put("valor", q.valor)
        is Quando.Hora -> JSONObject().put("tipo", "hora").put("hora", q.hora).put("dias", JSONArray(q.dias.distinct().sorted()))
        is Quando.Potencia -> JSONObject().put("tipo", "potencia").put("aparelho", q.aparelho)
            .put("acima_w", numeroJson(q.acimaW)).put("durante_s", q.duranteS)
    }

    private fun seJson(s: Condicoes): JSONObject = JSONObject().apply {
        s.alarme?.let { put("alarme", it) }
        s.entre?.let { put("entre", JSONArray().put(it.first).put(it.second)) }
    }

    private fun acaoJson(a: Acao): JSONObject = when (a) {
        is Acao.Ligar -> JSONObject().put("acao", if (a.ligar) "ligar" else "desligar").put("aparelho", a.aparelho)
            .put("canal", a.canal).apply { a.duranteS?.let { put("durante_s", it) } }
        is Acao.Estore -> JSONObject().put("acao", "estore").put("aparelho", a.aparelho).put("canal", a.canal).put("posicao", a.posicao)
        is Acao.Notificar -> JSONObject().put("acao", "notificar").put("mensagem", a.mensagem)
    }

    // Inteiros sem ".0" (3500 e não 3500.0), iguais em org.json da JVM e do Android.
    private fun numeroJson(d: Double): Any = if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong() else d

    // ---------- Editar a lista ----------

    /**
     * Guarda [nova] na lista: substitui a automação com id [idAnterior] (edição) ou acrescenta no fim (nova).
     * Automações bloqueadas não são substituídas (devolve a lista igual).
     */
    fun guardar(lista: List<Automacao>, nova: Automacao, idAnterior: String? = null): List<Automacao> {
        val i = if (idAnterior == null) -1 else lista.indexOfFirst { it.id == idAnterior }
        if (i < 0) return lista + nova
        if (lista[i].bloqueada) return lista
        return lista.toMutableList().also { it[i] = nova.copy(original = lista[i].original, acoesDesconhecidas = 0) }
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

    /**
     * Erros (pt-PT) de uma automação criada/editada pelo cliente. O motor volta a validar; isto só evita
     * mandar listas que ele recusaria. Com [aparelhos] vazio não se verificam aparelhos/canais.
     */
    fun validar(a: Automacao, aparelhos: List<Aparelho> = emptyList()): List<String> {
        val erros = mutableListOf<String>()
        val conhecidos = aparelhos.isNotEmpty()
        fun canal(ap: String, n: Int): Canal? = aparelhos.firstOrNull { it.id == ap }?.canal(n)

        if (!ID_RE.matches(a.id)) erros += "Identificador inválido."
        if (a.nome.isBlank()) erros += "Dê um nome à automação."
        when (val q = a.quando) {
            is Quando.Sensor -> {
                if (q.aparelho.isBlank()) erros += "Escolha o sensor."
                else if (conhecidos && canal(q.aparelho, q.canal)?.funcao !in Funcao.SENSORES) erros += "Escolha um sensor de porta ou de movimento."
                if (q.valor != 0 && q.valor != 1) erros += "Escolha o estado do sensor."
            }
            is Quando.Hora -> {
                if (!HORA_RE.matches(q.hora)) erros += "Indique a hora (HH:MM)."
                if (q.dias.isEmpty() || q.dias.any { it !in 1..7 }) erros += "Escolha pelo menos um dia."
            }
            is Quando.Potencia -> {
                if (q.aparelho.isBlank()) erros += "Escolha o medidor."
                else if (conhecidos && aparelhos.firstOrNull { it.id == q.aparelho }?.medidor != true) erros += "Esse aparelho não mede consumo."
                if (!(q.acimaW > 0)) erros += "Indique a potência (W)."
                if (q.duranteS < 0) erros += "Indique durante quantos segundos."
            }
            null -> erros += "Escolha quando a automação dispara."
        }
        a.se?.entre?.let { (de, ate) ->
            if (!HORA_RE.matches(de) || !HORA_RE.matches(ate)) erros += "Horário inválido (HH:MM)."
        }
        if (a.entao.isEmpty() || a.entao.size > MAX_ACOES) erros += "Tem de ter entre 1 e $MAX_ACOES ações."
        a.entao.forEachIndexed { i, x ->
            val n = i + 1
            when (x) {
                is Acao.Ligar -> {
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha o circuito."
                    else if (conhecidos && canal(x.aparelho, x.canal)?.funcao.let { it != Funcao.INTERRUPTOR && it != Funcao.LUZ }) erros += "Ação $n: escolha um circuito ou uma luz."
                    if (x.duranteS != null && x.duranteS <= 0) erros += "Ação $n: duração inválida."
                }
                is Acao.Estore -> {
                    if (x.aparelho.isBlank()) erros += "Ação $n: escolha o estore."
                    else if (conhecidos && canal(x.aparelho, x.canal)?.funcao != Funcao.ESTORE) erros += "Ação $n: escolha um estore."
                    if (x.posicao !in 0..100) erros += "Ação $n: posição de 0 a 100."
                }
                is Acao.Notificar -> if (x.mensagem.isBlank()) erros += "Ação $n: escreva a mensagem."
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

    private fun duracao(s: Int): String = if (s % 60 == 0) "${s / 60} min" else "$s s"

    /** Frase curta que descreve a automação, ex.: "Quando Movimento corredor deteta movimento, entre 19:00 e 07:00 → liga …". */
    fun descrever(a: Automacao, aparelhos: List<Aparelho>): String {
        val quando = when (val q = a.quando) {
            is Quando.Sensor -> {
                val f = aparelhos.firstOrNull { it.id == q.aparelho }?.canal(q.canal)?.funcao
                val verbo = when (f) {
                    Funcao.PORTA -> if (q.valor == 1) "abre" else "fecha"
                    Funcao.MOVIMENTO -> if (q.valor == 1) "deteta movimento" else "deixa de detetar movimento"
                    else -> if (q.valor == 1) "fica ativo" else "fica inativo"
                }
                "Quando ${nomeCanal(aparelhos, q.aparelho, q.canal)} $verbo"
            }
            is Quando.Hora -> "Às ${q.hora}, ${descreverDias(q.dias)}"
            is Quando.Potencia -> "Quando ${aparelhos.firstOrNull { it.id == q.aparelho }?.nome ?: q.aparelho} passa " +
                "${numeroJson(q.acimaW)} W durante ${duracao(q.duranteS)}"
            null -> "Regra definida pela Domus Energia"
        }
        val se = buildList {
            when (a.se?.alarme) {
                true -> add("com alarme ativo")
                false -> add("com alarme desligado")
                null -> {}
            }
            a.se?.entre?.let { add("entre ${it.first} e ${it.second}") }
        }
        val acoes = a.entao.map {
            when (it) {
                is Acao.Ligar -> (if (it.ligar) "liga " else "desliga ") + nomeCanal(aparelhos, it.aparelho, it.canal) +
                    (it.duranteS?.let { s -> " durante ${duracao(s)}" } ?: "")
                is Acao.Estore -> "põe ${nomeCanal(aparelhos, it.aparelho, it.canal)} a ${it.posicao} %"
                is Acao.Notificar -> "avisa: \"${it.mensagem}\""
            }
        }
        return (listOf(quando) + se).joinToString(", ") + if (acoes.isEmpty()) "" else " → " + acoes.joinToString("; ")
    }
}
