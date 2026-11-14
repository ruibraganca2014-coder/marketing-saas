package pt.domusenergia.app.data

import org.json.JSONObject

/** O que o cliente muda num canal (um mosaico): o nome e se fica escondido. */
data class PersCanal(val nome: String? = null, val escondido: Boolean = false)

/** O que o cliente muda num aparelho: a divisão e os seus canais. */
data class Personalizacao(val divisao: String? = null, val canais: Map<Int, PersCanal> = emptyMap())

/**
 * Organizar os aparelhos (decisões do dono, 2026-11-10; docs/APP-CLIENTE.md), igual a `web/estado.js`:
 * `_config.personalizar` = {"<aparelho>": {"divisao": "Cozinha", "canais": {"1": {"nome": "Cafeteira", "escondido": true}}}}.
 * O nome e a divisão do painel (`_aparelhos`, [Estado.lista]) não mudam; o motor valida.
 */
object Organizar {
    const val MAX_NOME = 80
    const val MAX_DIVISAO = 40

    private fun texto(v: Any?, max: Int): String? = (v as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(max)

    fun ler(o: JSONObject?): Map<String, Personalizacao> {
        if (o == null) return emptyMap()
        val r = LinkedHashMap<String, Personalizacao>()
        for (id in o.keys()) {
            val p = o.optJSONObject(id) ?: continue
            val canais = LinkedHashMap<Int, PersCanal>()
            p.optJSONObject("canais")?.let { cs ->
                for (k in cs.keys()) {
                    val n = k.toIntOrNull() ?: continue
                    val c = cs.optJSONObject(k) ?: continue
                    canais[n] = PersCanal(texto(c.opt("nome"), MAX_NOME), c.opt("escondido") == true)
                }
            }
            r[id] = Personalizacao(texto(p.opt("divisao"), MAX_DIVISAO), canais)
        }
        return r
    }

    fun json(m: Map<String, Personalizacao>): JSONObject {
        val o = JSONObject()
        for ((id, p) in m) {
            val x = JSONObject()
            p.divisao?.let { x.put("divisao", it) }
            if (p.canais.isNotEmpty()) {
                val cs = JSONObject()
                for ((n, c) in p.canais) {
                    val y = JSONObject()
                    c.nome?.let { y.put("nome", it) }
                    if (c.escondido) y.put("escondido", true)
                    cs.put(n.toString(), y)
                }
                x.put("canais", cs)
            }
            o.put(id, x)
        }
        return o
    }

    /** O aparelho do painel com o que o cliente mudou (um só canal: o nome do canal passa a ser o do aparelho). */
    fun aplicar(a: ConfigAparelho, p: Personalizacao?): ConfigAparelho {
        if (p == null) return a
        val canais = a.canais.map { c ->
            val q = p.canais[c.n]
            c.copy(
                nome = q?.nome ?: c.nome,
                temNome = c.temNome || q?.nome != null,
                divisao = p.divisao ?: c.divisao,
                escondido = q?.escondido == true,
            )
        }
        val nomeUnico = if (a.canais.size == 1) p.canais[a.canais[0].n]?.nome else null
        return a.copy(nome = nomeUnico ?: a.nome, divisao = p.divisao ?: a.divisao, canais = canais)
    }

    /**
     * O novo `personalizar` depois de guardar o aparelho [a] (o do painel). O que fica igual ao do painel, ou vazio,
     * não se guarda; tudo vazio = repor o original.
     */
    fun mudar(atual: Map<String, Personalizacao>, a: ConfigAparelho, divisao: String, canais: Map<Int, PersCanal>): Map<String, Personalizacao> {
        val d = texto(divisao, MAX_DIVISAO)?.takeIf { it != (a.divisao ?: "") }
        val cs = LinkedHashMap<Int, PersCanal>()
        for (c in a.canais) {
            val q = canais[c.n] ?: continue
            val nome = texto(q.nome, MAX_NOME)?.takeIf { it != c.nome }
            if (nome != null || q.escondido) cs[c.n] = PersCanal(nome, q.escondido)
        }
        val r = LinkedHashMap(atual)
        if (d == null && cs.isEmpty()) r.remove(a.id) else r[a.id] = Personalizacao(d, cs)
        return r
    }
}
