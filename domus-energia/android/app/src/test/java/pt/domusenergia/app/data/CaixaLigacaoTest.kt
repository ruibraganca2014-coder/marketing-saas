package pt.domusenergia.app.data

import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.datatypes.MqttQos
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.future.await
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * A app sem servidor liga-se à caixa de casa (docs/HOME-ASSISTANT.md). Precisa de um Mosquitto a fazer de caixa
 * (WebSocket em 127.0.0.1:18841, anónimo, com a casa "joao" retida): corre com `bash caixa/testar-app-caixa.sh`,
 * que o arranca e define DOMUS_CAIXA_TESTE=1. Sem isso, o teste fica saltado.
 */
class CaixaLigacaoTest {

    @Test
    fun `sem servidor a app liga-se a caixa, comanda os aparelhos e recusa o resto`() = runBlocking {
        assumeTrue(System.getenv("DOMUS_CAIXA_TESTE") == "1")
        val m = DomusMqtt(
            host = "127.0.0.1", porta = 1, tls = false, // servidor inalcançável (internet em baixo)
            caixaGuardada = { AcessoCaixa("127.0.0.1", 18841, "app-joao", "qualquer") },
        )
        val fundo = CoroutineScope(Dispatchers.IO)
        fundo.launch { runCatching { m.ligar("joao", "senha", insistir = true) } }
        try {
            // As retidas chegam uma a uma: espera pelo `connected` da sala (o `_ponte` 0 vem depois, de propósito).
            withTimeout(30_000) { m.estado.first { it.naCaixa && it.aparelhos.any { a -> a.id == "sala" && a.online } } }
            kotlinx.coroutines.delay(1_000)
            val e = m.estado.value
            assertTrue(e.semServidor)
            val sala = e.aparelhos.single { it.id == "sala" }
            assertTrue("o _ponte 0 retido na caixa não conta", sala.online)

            // Um comando de aparelho chega à caixa.
            val obs = MqttClient.builder().useMqttVersion3().serverHost("127.0.0.1").serverPort(18841)
                .webSocketConfig().serverPath("mqtt").applyWebSocketConfig().buildAsync()
            obs.connect().await()
            val chegou = CompletableFuture<String>()
            obs.subscribeWith().topicFilter("domus/joao/sala/1/set").qos(MqttQos.AT_LEAST_ONCE)
                .callback { chegou.complete(String(it.payloadAsBytes)) }.send().await()
            m.setLigado(sala, 1, true)
            assertEquals("1", chegou.get(5, TimeUnit.SECONDS))
            obs.disconnect()

            // O alarme e os modos são do servidor: sem ele, a app diz porquê.
            val erro = runCatching { m.setModo("fora") }.exceptionOrNull()
            assertTrue("$erro", erro is MqttException && erro.message!!.startsWith("Sem internet"))
        } finally {
            m.desligar()
            fundo.cancel()
        }
    }

    private fun docker(vararg args: String) {
        val p = ProcessBuilder(listOf("docker") + args).redirectErrorStream(true).start()
        p.inputStream.readBytes()
        assertEquals("docker ${args.joinToString(" ")}", 0, p.waitFor())
    }

    private fun cliente(porta: Int) = MqttClient.builder().useMqttVersion3().serverHost("127.0.0.1").serverPort(porta)
        .webSocketConfig().serverPath("mqtt").applyWebSocketConfig().buildAsync()

    @Test
    fun `com dados moveis segue o _ponte, manda os Shelly ao servidor e troca quando o servidor cai e volta`(): Unit = runBlocking {
        assumeTrue(System.getenv("DOMUS_CAIXA_TESTE") == "1")
        val m = DomusMqtt(
            host = "127.0.0.1", porta = 18842, tls = false,
            caixaGuardada = { AcessoCaixa("127.0.0.1", 18841, "app-joao", "qualquer") },
        )
        val srv = cliente(18842)
        try {
            m.ligar("joao", "senha")
            srv.connect().await()
            withTimeout(10_000) { m.estado.first { it.aparelhos.size == 2 } }
            assertTrue("servidor ligado e _ponte sem 0: não usa a caixa", !m.estado.value.naCaixa)

            // A caixa perde a internet (o servidor publica _ponte 0); o telemóvel continua com dados móveis.
            srv.publishWith().topic("domus/joao/_ponte").payload("0".toByteArray()).retain(true).qos(MqttQos.AT_LEAST_ONCE).send().await()
            val comCaixa = withTimeout(30_000) { m.estado.first { it.naCaixa } }
            assertTrue(!comCaixa.semServidor)
            withTimeout(10_000) { m.estado.first { e -> e.aparelhos.single { it.id == "sala" }.online } }

            // O Shelly está ligado ao servidor: o comando vai para lá, não para a caixa.
            val noServidor = CompletableFuture<String>()
            srv.subscribeWith().topicFilter("domus/joao/estore/#").qos(MqttQos.AT_LEAST_ONCE)
                .callback { if (!it.topic.toString().endsWith("/online")) noServidor.complete(it.topic.toString()) }.send().await()
            m.setLigado(m.estado.value.aparelhos.single { it.id == "estore" }, 1, true)
            assertTrue(noServidor.get(5, TimeUnit.SECONDS).startsWith("domus/joao/estore/"))

            // A caixa volta a ter internet: a app larga a caixa.
            srv.publishWith().topic("domus/joao/_ponte").payload("1".toByteArray()).retain(true).qos(MqttQos.AT_LEAST_ONCE).send().await()
            withTimeout(10_000) { m.estado.first { !it.naCaixa } }
            srv.disconnect().await()

            // O servidor cai (internet de casa e dados móveis em baixo): a app vai para a caixa; quando volta, larga-a.
            docker("stop", "domus-teste-servidor")
            val semServidor = withTimeout(40_000) { m.estado.first { it.naCaixa && it.semServidor } }
            assertTrue("sem servidor, o Shelly fica offline", !semServidor.aparelhos.single { it.id == "estore" }.online)
            docker("start", "domus-teste-servidor")
            withTimeout(60_000) { m.estado.first { !it.naCaixa && !it.semServidor } }
        } finally {
            m.desligar()
            runCatching { srv.disconnect() }
        }
    }
}
