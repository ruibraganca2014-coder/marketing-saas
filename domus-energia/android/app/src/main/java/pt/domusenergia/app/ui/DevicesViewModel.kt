package pt.domusenergia.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.DomusMqtt
import pt.domusenergia.app.data.Ligacao
import pt.domusenergia.app.data.MqttException
import pt.domusenergia.app.data.Sessao
import pt.domusenergia.app.notificacoes.Fcm

class DevicesViewModel(app: Application) : AndroidViewModel(app), Acoes {

    private val sessao = Sessao(app)
    private val mqtt = DomusMqtt()

    private val _state = MutableStateFlow(UiState(loggedIn = sessao.isLoggedIn, codigo = sessao.codigo.orEmpty()))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Saída em curso (retira o token FCM antes de desligar); uma nova entrada espera por ela. */
    private var saida: Job? = null

    init {
        // O MQTT é "push": o estado chega sozinho quando muda, não há atualização periódica.
        viewModelScope.launch { mqtt.estado.collect { e -> _state.update { it.copy(estado = e) } } }
        viewModelScope.launch {
            mqtt.ligacao.collect { l ->
                if (l == Ligacao.RECUSADO && _state.value.loggedIn) {
                    // A palavra-passe mudou com a sessão aberta: volta ao ecrã de entrada.
                    mqtt.desligar()
                    sessao.limpar()
                    _state.value = UiState(loggedIn = false, erroLogin = "Código ou palavra-passe errados.")
                } else {
                    _state.update { it.copy(ligacao = l) }
                }
            }
        }
        // Notificações: regista o token FCM deste telemóvel sempre que a ligação (re)abre.
        Fcm.carregar(app)
        viewModelScope.launch {
            combine(mqtt.ligacao, Fcm.token) { l, t -> if (l == Ligacao.LIGADO) t else null }.collect { token ->
                if (token != null) runCatching { mqtt.registarFcm(token) }
            }
        }

        val codigo = sessao.codigo
        val password = sessao.password
        if (codigo != null && password != null) {
            viewModelScope.launch {
                try {
                    // Sessão guardada: continua a tentar mesmo sem rede (o ecrã mostra "A religar…").
                    mqtt.ligar(codigo, password, insistir = true)
                } catch (e: MqttException) {
                    // Palavra-passe recusada: tratado acima (Ligacao.RECUSADO). Outros: a sessão foi terminada.
                }
            }
        }
    }

    override fun login(codigo: String, password: String) {
        val c = codigo.trim().lowercase()
        viewModelScope.launch {
            saida?.join()
            _state.update { it.copy(loading = true, erroLogin = null) }
            try {
                mqtt.ligar(c, password)
                sessao.guardar(c, password)
                _state.update { it.copy(loggedIn = true, codigo = c, loading = false) }
            } catch (e: MqttException) {
                mqtt.desligar()
                _state.update { it.copy(loading = false, erroLogin = e.message) }
            }
        }
    }

    override fun logout() {
        sessao.limpar()
        _state.value = UiState(loggedIn = false)
        val token = Fcm.token.value
        saida = viewModelScope.launch {
            // Deixa de receber notificações deste cliente neste telemóvel.
            if (token != null && mqtt.ligacao.value == Ligacao.LIGADO) {
                runCatching { withTimeout(3_000) { mqtt.registarFcm(token, remover = true) } }
            }
            mqtt.desligar()
        }
    }

    private fun comando(bloco: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                bloco()
            } catch (e: MqttException) {
                _state.update { it.copy(aviso = e.message) }
            }
        }
    }

    override fun ligar(a: Aparelho, n: Int, ligado: Boolean) = comando { mqtt.setLigado(a, n, ligado) }

    override fun brilho(a: Aparelho, n: Int, brilho: Int) = comando { mqtt.setBrilho(a, n, brilho) }

    override fun estore(a: Aparelho, n: Int, posicao: Int) = comando { mqtt.setEstore(a, n, posicao) }

    override fun moverEstore(a: Aparelho, n: Int, mov: Comandos.MovimentoEstore) = comando { mqtt.moverEstore(a, n, mov) }

    override fun alarme(ativo: Boolean) = comando { mqtt.setAlarme(ativo) }

    override fun guardarAutomacoes(lista: List<Automacao>, aoGuardar: () -> Unit) {
        val erros = Automacoes.validarLista(lista)
        if (erros.isNotEmpty()) {
            _state.update { it.copy(aviso = erros.first()) }
            return
        }
        if (_state.value.aGuardar) return
        _state.update { it.copy(aGuardar = true) }
        viewModelScope.launch {
            try {
                val antes = mqtt.estado.value.recebidasAutomacoes
                mqtt.guardarAutomacoes(lista)
                // O motor responde com a lista (retida) ou, se recusar, com um evento "erro" seguido da lista antiga.
                val resposta = withTimeoutOrNull(10_000) {
                    mqtt.estado.first { it.recebidasAutomacoes > antes || it.ultimoErro != null }
                }
                if (resposta != null && resposta.ultimoErro == null) delay(300) // o "erro" pode vir logo a seguir
                val erro = mqtt.estado.value.ultimoErro
                when {
                    resposta == null -> _state.update { it.copy(aviso = "O servidor não respondeu. Tente outra vez.") }
                    erro != null -> _state.update { it.copy(aviso = "Não guardado: ${erro.mensagem}") }
                    else -> {
                        _state.update { it.copy(aviso = "Automações guardadas.") }
                        aoGuardar()
                    }
                }
            } catch (e: MqttException) {
                _state.update { it.copy(aviso = e.message) }
            } finally {
                _state.update { it.copy(aGuardar = false) }
            }
        }
    }

    override fun limparAviso() = _state.update { it.copy(aviso = null) }

    override fun limparErroAutomacoes() = mqtt.limparErro()

    override fun onCleared() {
        mqtt.desligar()
    }
}
