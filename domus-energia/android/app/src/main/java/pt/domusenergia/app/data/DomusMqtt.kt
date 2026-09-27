package pt.domusenergia.app.data

import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.MqttGlobalPublishFilter
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.lifecycle.MqttClientDisconnectedContext
import com.hivemq.client.mqtt.mqtt3.Mqtt3AsyncClient
import com.hivemq.client.mqtt.mqtt3.exceptions.Mqtt3ConnAckException
import com.hivemq.client.mqtt.mqtt3.message.connect.connack.Mqtt3ConnAckReturnCode
import com.hivemq.client.mqtt.mqtt3.message.publish.Mqtt3Publish
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.future.await
import pt.domusenergia.app.BuildConfig
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class MqttException(message: String, val autenticacao: Boolean = false, cause: Throwable? = null) :
    Exception(message, cause)

/**
 * Estado da ligação ao servidor. [RECUSADO]: o servidor recusou o código/palavra-passe
 * (ex.: a palavra-passe foi mudada com a sessão aberta); a app volta ao ecrã de entrada.
 */
enum class Ligacao { DESLIGADO, A_LIGAR, LIGADO, A_RELIGAR, RECUSADO }

/**
 * Liga ao servidor MQTT da Domus Energia (MQTT 3.1.1 sobre WebSocket seguro, `wss://HOST:443/mqtt`)
 * com o código de cliente e a palavra-passe, e mantém o [estado] da casa desse cliente.
 * Contrato dos tópicos: docs/PROTOCOLO-MQTT.md e docs/PROTOCOLO-MQTT-v2.md.
 *
 * [porta], [tls] e [caminho] só existem para os testes com um servidor local; a app usa os valores por omissão.
 */
class DomusMqtt(
    private val host: String = BuildConfig.MQTT_HOST,
    private val porta: Int = 443,
    private val tls: Boolean = true,
    private val caminho: String = "mqtt",
) {
    private val lock = Any()
    private var atual = Estado()

    private val _estado = MutableStateFlow(Estado())
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    private val _ligacao = MutableStateFlow(Ligacao.DESLIGADO)
    val ligacao: StateFlow<Ligacao> = _ligacao.asStateFlow()

    @Volatile private var client: Mqtt3AsyncClient? = null
    @Volatile private var codigo: String = ""

    /** Código do cliente da ligação atual (para montar publicações fora desta classe). */
    val codigoAtual: String get() = codigo
    @Volatile private var clientId: String = ""
    @Volatile private var parado = true
    @Volatile private var jaLigou = false
    @Volatile private var insistir = false
    private val rpcIds = AtomicInteger(0)

    /** Código do cliente com sessão iniciada ("" se nenhuma). */
    val cliente: String get() = codigo

    /**
     * Liga com o [codigo] de cliente e a [password]. Lança [MqttException] se falhar
     * (com `autenticacao = true` se o código ou a palavra-passe estiverem errados).
     *
     * Depois de ligar, as quebras de rede são recuperadas automaticamente (1 s a 30 s entre tentativas).
     * Com [insistir] = true (arranque da app com sessão guardada) também a primeira ligação é repetida
     * até conseguir: a função só volta quando ligar, quando o servidor recusar a palavra-passe ou
     * quando se chamar [desligar].
     */
    suspend fun ligar(codigo: String, password: String, insistir: Boolean = false) {
        desligar()
        this.codigo = codigo
        this.insistir = insistir
        parado = false
        jaLigou = false
        _ligacao.value = Ligacao.A_LIGAR

        // Os listeners recebem o próprio cliente, para ignorar eventos de um cliente antigo (depois de sair/entrar).
        val ref = AtomicReference<Mqtt3AsyncClient>()
        val id = "app-$codigo-" + UUID.randomUUID().toString().take(8)
        clientId = id
        val base = MqttClient.builder()
            .useMqttVersion3()
            .identifier(id)
            .serverHost(host)
            .serverPort(porta)
        val novo = (if (tls) base.sslWithDefaultConfig() else base)
            .webSocketConfig().serverPath(caminho).applyWebSocketConfig()
            .simpleAuth().username(codigo).password(password.toByteArray()).applySimpleAuth()
            .automaticReconnect()
            .initialDelay(1, TimeUnit.SECONDS)
            .maxDelay(30, TimeUnit.SECONDS)
            .applyAutomaticReconnect()
            .addConnectedListener { aoLigar(ref.get()) }
            .addDisconnectedListener { aoDesligar(ref.get(), it) }
            .buildAsync()
        ref.set(novo)
        client = novo

        // Todas as mensagens das subscrições vêm por aqui (registado antes de ligar para não perder nenhuma).
        novo.publishes(MqttGlobalPublishFilter.SUBSCRIBED) { recebida(novo, it) }

        try {
            novo.connect().await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            throw traduz(e)
        }
    }

    /** Termina a sessão, esquece o estado e deixa de tentar religar. */
    fun desligar() {
        parado = true
        synchronized(lock) { publicaEstado(Estado()) }
        val c = client
        client = null
        if (c != null && c.state.isConnectedOrReconnect) c.disconnect()
        _ligacao.value = Ligacao.DESLIGADO
    }

    /**
     * Publica as mensagens (QoS 1, **nunca retidas**). Lança [MqttException] se não houver ligação ao servidor.
     * Todas as publicações da app passam por aqui ou por [pedirEstado].
     */
    suspend fun enviar(mensagens: List<Publicacao>) {
        if (mensagens.isEmpty()) return
        val c = client?.takeIf { it.state.isConnected }
            ?: throw MqttException("Sem ligação ao servidor. A religar…")
        try {
            for (m in mensagens) {
                // Nunca retido: um comando retido voltava a ser executado quando o aparelho reiniciasse.
                c.publishWith().topic(m.topico).payload(m.payload.toByteArray()).qos(MqttQos.AT_LEAST_ONCE).retain(false)
                    .send().await()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            throw MqttException("Não foi possível enviar o pedido. Verifique a ligação à Internet.", cause = e)
        }
    }

    private fun rpcId() = rpcIds.updateAndGet { (it % 1_000_000) + 1 }

    /** Liga ou desliga o canal [n] (`interruptor`/`luz`). */
    suspend fun setLigado(a: Aparelho, n: Int, ligado: Boolean) {
        enviar(Comandos.ligar(codigo, a, n, ligado, clientId, rpcId()))
        // Mostra logo o novo estado; o aparelho confirma (ou corrige) a seguir.
        altera { EstadoParser.comLigado(it, a.id, n, ligado) }
    }

    suspend fun setBrilho(a: Aparelho, n: Int, brilho: Int) {
        enviar(Comandos.brilho(codigo, a, n, brilho, clientId, rpcId()))
        altera { EstadoParser.comBrilho(it, a.id, n, brilho) }
    }

    suspend fun setEstore(a: Aparelho, n: Int, posicao: Int) =
        enviar(Comandos.estorePosicao(codigo, a, n, posicao, clientId, rpcId()))

    suspend fun moverEstore(a: Aparelho, n: Int, mov: Comandos.MovimentoEstore) =
        enviar(Comandos.estore(codigo, a, n, mov, clientId, rpcId()))

    suspend fun setAlarme(ativo: Boolean) = enviar(listOf(Comandos.alarme(codigo, ativo)))

    /** Publica a lista COMPLETA de automações; o motor responde com `_automacoes` ou com um evento `erro`. */
    suspend fun guardarAutomacoes(lista: List<Automacao>) {
        altera { it.copy(ultimoErro = null) }
        enviar(listOf(Comandos.automacoes(codigo, lista)))
    }

    // ---------- v3 ----------

    /** Pede a mudança de modo; o motor responde com `_modo`/`_alarme` ou com um evento `erro` ("Não armado: …"). */
    suspend fun setModo(modo: String, forcar: Boolean = false) {
        altera { it.copy(ultimoErro = null) }
        enviar(listOf(Comandos.modo(codigo, modo, forcar)))
    }

    suspend fun executarCena(id: String) = enviar(listOf(Comandos.executarCena(codigo, id)))

    /** Publica a lista COMPLETA de cenas; o motor responde com `_cenas` ou com um evento `erro`. */
    suspend fun guardarCenas(lista: List<Cena>) {
        altera { it.copy(ultimoErro = null) }
        enviar(listOf(Comandos.cenas(codigo, lista)))
    }

    suspend fun executarAutomacao(id: String) = enviar(listOf(Comandos.executarAutomacao(codigo, id)))

    suspend fun testarAutomacao(id: String) = enviar(listOf(Comandos.testarAutomacao(codigo, id)))

    suspend fun avaliarAutomacao(id: String) = enviar(listOf(Comandos.avaliarAutomacao(codigo, id)))

    /** Envia só os campos que mudaram (objeto parcial); o motor responde com `_config` ou com um `erro`. */
    suspend fun guardarConfig(parcial: org.json.JSONObject) {
        altera { it.copy(ultimoErro = null) }
        enviar(listOf(Comandos.config(codigo, parcial)))
    }

    suspend fun registarFcm(token: String, remover: Boolean = false) =
        enviar(listOf(Comandos.fcm(codigo, token, remover)))

    fun limparErro() = altera { it.copy(ultimoErro = null) }

    /** Pede aos Shelly que republiquem o estado (os OpenBeken publicam sozinhos). */
    fun pedirEstado() {
        val c = client?.takeIf { it.state.isConnected } ?: return
        val aparelhos = synchronized(lock) { atual.aparelhos }
        for (m in aparelhos.flatMap { Comandos.pedirEstado(codigo, it) }) {
            c.publishWith().topic(m.topico).payload(m.payload.toByteArray()).qos(MqttQos.AT_MOST_ONCE).retain(false).send()
        }
    }

    private inline fun altera(f: (Estado) -> Estado) {
        synchronized(lock) { publicaEstado(f(atual)) }
    }

    private fun aoLigar(c: Mqtt3AsyncClient) {
        if (c !== client) {
            // Religou um cliente que entretanto foi descartado (ex.: saiu da conta durante a espera).
            c.disconnect()
            return
        }
        jaLigou = true
        _ligacao.value = Ligacao.LIGADO
        // Sessão limpa (clean session): subscreve outra vez em cada ligação. As mensagens retidas
        // (_aparelhos, _alarme, _automacoes, _historico, _ntfy, online, ...) chegam logo a seguir;
        // ao chegar a lista pedimos o estado aos Shelly.
        c.subscribeWith().topicFilter("domus/$codigo/#").qos(MqttQos.AT_LEAST_ONCE).send()
    }

    private fun aoDesligar(c: Mqtt3AsyncClient, ctx: MqttClientDisconnectedContext) {
        val eAtual = c === client
        val recusado = eAutenticacao(ctx.cause)
        // O listener do religar automático corre antes deste (HiveMQ põe-no primeiro): aqui podemos cancelar.
        val naoReligar = !eAtual || parado || recusado || (!jaLigou && !insistir)
        if (naoReligar) ctx.reconnector.reconnect(false)
        if (eAtual) {
            _ligacao.value = when {
                recusado -> Ligacao.RECUSADO
                naoReligar -> Ligacao.DESLIGADO
                else -> Ligacao.A_RELIGAR
            }
        }
    }

    private fun recebida(c: Mqtt3AsyncClient, publish: Mqtt3Publish) {
        if (c !== client) return
        val topico = publish.topic.toString()
        val payload = String(publish.payloadAsBytes, Charsets.UTF_8)
        altera { EstadoParser.reduzir(it, codigo, topico, payload, retida = publish.isRetain) }
        if (topico == "domus/$codigo/${EstadoParser.LISTA}") pedirEstado()
    }

    // Chamar sempre dentro de synchronized(lock).
    private fun publicaEstado(novo: Estado) {
        atual = novo
        _estado.value = novo
    }

    companion object {
        /**
         * Ligação curta: liga, publica [mensagens] (QoS 1, **nunca retidas**) e desliga. Usada com a app
         * fechada (ex.: presença publicada pelo WorkManager). Sem religar automático: se falhar, lança
         * [MqttException] e quem chamou tenta mais tarde.
         */
        suspend fun enviarUmaVez(
            codigo: String,
            password: String,
            mensagens: List<Publicacao>,
            host: String = BuildConfig.MQTT_HOST,
            porta: Int = 443,
            tls: Boolean = true,
            caminho: String = "mqtt",
        ) {
            val base = MqttClient.builder()
                .useMqttVersion3()
                .identifier("app-$codigo-" + UUID.randomUUID().toString().take(8))
                .serverHost(host)
                .serverPort(porta)
            val c = (if (tls) base.sslWithDefaultConfig() else base)
                .webSocketConfig().serverPath(caminho).applyWebSocketConfig()
                .simpleAuth().username(codigo).password(password.toByteArray()).applySimpleAuth()
                .buildAsync()
            try {
                c.connect().await()
                for (m in mensagens) {
                    c.publishWith().topic(m.topico).payload(m.payload.toByteArray()).qos(MqttQos.AT_LEAST_ONCE).retain(false)
                        .send().await()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                throw traduz(e)
            } finally {
                if (c.state.isConnected) runCatching { c.disconnect().await() }
            }
        }

        private fun eAutenticacao(e: Throwable?): Boolean {
            var t = e
            while (t != null) {
                if (t is Mqtt3ConnAckException) {
                    val rc = t.mqttMessage.returnCode
                    return rc == Mqtt3ConnAckReturnCode.NOT_AUTHORIZED || rc == Mqtt3ConnAckReturnCode.BAD_USER_NAME_OR_PASSWORD
                }
                t = t.cause
            }
            return false
        }

        private fun traduz(e: Throwable): MqttException = when {
            e is MqttException -> e
            eAutenticacao(e) -> MqttException("Código ou palavra-passe errados.", autenticacao = true, cause = e)
            else -> MqttException("Não foi possível ligar ao servidor. Verifique a ligação à Internet.", cause = e)
        }
    }
}
