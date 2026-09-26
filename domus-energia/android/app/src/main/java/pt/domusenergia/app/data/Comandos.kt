package pt.domusenergia.app.data

import org.json.JSONObject

/** Uma mensagem a publicar no servidor MQTT. */
data class Publicacao(val topico: String, val payload: String)

/**
 * Tradução das ações do cliente em mensagens MQTT, para cada tipo de aparelho
 * (docs/PROTOCOLO-MQTT.md e PROTOCOLO-MQTT-v2.md). Código puro, testável em JVM.
 *
 * Shelly: canal `n` ⇄ componente `id = n - 1`. Os pedidos `rpc` levam `src` = [clientId] da ligação MQTT.
 */
object Comandos {

    private fun prefixo(cliente: String, a: Aparelho) = "domus/$cliente/${a.id}"

    private fun rpc(cliente: String, a: Aparelho, clientId: String, rpcId: Int, metodo: String, params: JSONObject) =
        Publicacao(
            "${prefixo(cliente, a)}/rpc",
            JSONObject().put("id", rpcId).put("src", clientId).put("method", metodo).put("params", params).toString(),
        )

    /** Ligar/desligar um canal `interruptor` ou `luz`. */
    fun ligar(cliente: String, a: Aparelho, n: Int, ligado: Boolean, clientId: String, rpcId: Int): List<Publicacao> {
        val p = prefixo(cliente, a)
        if (a.tipo != Aparelho.TIPO_SHELLY) return listOf(Publicacao("$p/$n/set", if (ligado) "1" else "0"))
        val id = n - 1
        if (a.canal(n)?.funcao == Funcao.LUZ) {
            return listOf(rpc(cliente, a, clientId, rpcId, "Light.Set", JSONObject().put("id", id).put("on", ligado)))
        }
        return listOf(
            Publicacao("$p/command/switch:$id", if (ligado) "on" else "off"),
            Publicacao("$p/command", "status_update"),
        )
    }

    /** Brilho (0–100) de um canal `luz`; acende a luz se estiver apagada. */
    fun brilho(cliente: String, a: Aparelho, n: Int, brilho: Int, clientId: String, rpcId: Int): List<Publicacao> {
        val b = brilho.coerceIn(0, 100)
        if (a.tipo == Aparelho.TIPO_SHELLY) {
            return listOf(
                rpc(cliente, a, clientId, rpcId, "Light.Set", JSONObject().put("id", n - 1).put("on", true).put("brightness", b)),
            )
        }
        val p = prefixo(cliente, a)
        val acender = if (a.canal(n)?.ligado != true) listOf(Publicacao("$p/$n/set", "1")) else emptyList()
        return listOf(Publicacao("$p/led_dimmer/set", b.toString())) + acender
    }

    /** Estore para a posição 0 (fechado) – 100 (aberto). */
    fun estorePosicao(cliente: String, a: Aparelho, n: Int, posicao: Int, clientId: String, rpcId: Int): List<Publicacao> {
        val pos = posicao.coerceIn(0, 100)
        if (a.tipo != Aparelho.TIPO_SHELLY) return listOf(Publicacao("${prefixo(cliente, a)}/$n/set", pos.toString()))
        return listOf(rpc(cliente, a, clientId, rpcId, "Cover.GoToPosition", JSONObject().put("id", n - 1).put("pos", pos)))
    }

    enum class MovimentoEstore { ABRIR, PARAR, FECHAR }

    /**
     * Abrir/Parar/Fechar. OpenBeken não tem "parar" no contrato (devolve lista vazia; ver [podeParar]):
     * abrir = posição 100, fechar = posição 0.
     */
    fun estore(cliente: String, a: Aparelho, n: Int, mov: MovimentoEstore, clientId: String, rpcId: Int): List<Publicacao> {
        if (a.tipo != Aparelho.TIPO_SHELLY) {
            return when (mov) {
                MovimentoEstore.ABRIR -> estorePosicao(cliente, a, n, 100, clientId, rpcId)
                MovimentoEstore.FECHAR -> estorePosicao(cliente, a, n, 0, clientId, rpcId)
                MovimentoEstore.PARAR -> emptyList()
            }
        }
        val metodo = when (mov) {
            MovimentoEstore.ABRIR -> "Cover.Open"
            MovimentoEstore.PARAR -> "Cover.Stop"
            MovimentoEstore.FECHAR -> "Cover.Close"
        }
        return listOf(rpc(cliente, a, clientId, rpcId, metodo, JSONObject().put("id", n - 1)))
    }

    fun podeParar(a: Aparelho): Boolean = a.tipo == Aparelho.TIPO_SHELLY

    /** Pede ao Shelly que republique o estado (os OpenBeken publicam sozinhos). */
    fun pedirEstado(cliente: String, a: Aparelho): List<Publicacao> =
        if (a.tipo == Aparelho.TIPO_SHELLY) listOf(Publicacao("${prefixo(cliente, a)}/command", "status_update")) else emptyList()

    fun alarme(cliente: String, ativo: Boolean) =
        Publicacao("domus/$cliente/${EstadoParser.ALARME}/set", JSONObject().put("ativo", ativo).toString())

    /** Substitui a lista de automações: publica sempre a lista COMPLETA. */
    fun automacoes(cliente: String, lista: List<Automacao>) =
        Publicacao("domus/$cliente/${EstadoParser.AUTOMACOES}/set", Automacoes.paraJson(lista))

    /** Regista (ou, com [remover], retira) o token FCM deste telemóvel. */
    fun fcm(cliente: String, token: String, remover: Boolean = false) = Publicacao(
        "domus/$cliente/_fcm/registar",
        JSONObject().put("token", token).apply { if (remover) put("remover", true) }.toString(),
    )
}
