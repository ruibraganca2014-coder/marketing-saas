package pt.domusenergia.app.data

import org.json.JSONObject

/**
 * Login da caixa de casa (Home Assistant + Mosquitto) para a app usar **sem internet**, no Wi-Fi de casa.
 * Vem em `domus/<cliente>/_caixa` (retido, só o cliente o lê), publicado pelo `./domus.sh caixa <c> --ip <IP>`;
 * a app guarda-o cifrado ([Sessao.caixa]) para o ter quando a internet cai. docs/HOME-ASSISTANT.md.
 */
data class AcessoCaixa(val endereco: String, val porta: Int, val utilizador: String, val senha: String) {
    fun json(): String =
        JSONObject().put("endereco", endereco).put("porta", porta).put("utilizador", utilizador).put("senha", senha).toString()
}

object Caixa {
    const val TOPICO = "_caixa"

    /** Sem ligação ao servidor durante isto, a app tenta a caixa. */
    const val ESPERA_MS = 8_000L

    /** `null` se vazio (casa sem caixa) ou inválido. Só endereços privados: a app liga-se ao que aqui vier. */
    fun ler(payload: String): AcessoCaixa? {
        val o = try { JSONObject(payload) } catch (e: Exception) { return null }
        val endereco = o.optString("endereco")
        val porta = o.optInt("porta", 0)
        val utilizador = o.optString("utilizador")
        val senha = o.optString("senha")
        if (!ipPrivado(endereco) || porta !in 1..65535 || utilizador.isBlank() || senha.isBlank()) return null
        return AcessoCaixa(endereco, porta, utilizador, senha)
    }

    fun ipPrivado(ip: String): Boolean {
        val p = ip.split('.')
        if (p.size != 4 || p.any { it.isEmpty() || it.length > 3 || !it.all(Char::isDigit) }) return false
        val n = p.map { it.toInt() }
        if (n.any { it > 255 }) return false
        return n[0] == 10 || (n[0] == 172 && n[1] in 16..31) || (n[0] == 192 && n[1] == 168)
    }

    /**
     * A app liga-se à caixa quando o servidor não responde (internet de casa e dados móveis em baixo) ou quando
     * o servidor diz que a caixa perdeu a ligação (`_ponte` = 0: os aparelhos OpenBeken só se alcançam em casa).
     */
    fun precisa(servidorLigado: Boolean, ponteCaiu: Boolean): Boolean = !servidorLigado || ponteCaiu

    /**
     * Pela caixa só passam comandos para aparelhos (`domus/<c>/<aparelho>/...`) que não sejam Shelly ([shelly]:
     * os ids dos Shelly da lista, ligados ao servidor e não à caixa). O alarme, os modos, as cenas, as automações
     * e as definições são do motor, no servidor (decisão do dono, 2026-11-14).
     */
    fun passaPelaCaixa(topico: String, codigo: String, shelly: Set<String>): Boolean {
        val prefixo = "domus/$codigo/"
        if (!topico.startsWith(prefixo)) return false
        val resto = topico.removePrefix(prefixo)
        return !resto.startsWith("_") && resto.contains('/') && resto.substringBefore('/') !in shelly
    }

    /** O que vem da caixa e não se aplica: o `_ponte` dela não diz nada sobre a ligação da app. */
    fun ignorarDaCaixa(topico: String, codigo: String): Boolean =
        topico == "domus/$codigo/${EstadoParser.PONTE}" || topico == "domus/$codigo/$TOPICO"
}
