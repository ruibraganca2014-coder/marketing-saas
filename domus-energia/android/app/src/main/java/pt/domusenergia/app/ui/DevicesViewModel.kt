package pt.domusenergia.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Cenas
import pt.domusenergia.app.data.Cidade
import pt.domusenergia.app.data.ConfigCasa
import pt.domusenergia.app.data.Estado
import pt.domusenergia.app.data.Registo
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.DomusMqtt
import pt.domusenergia.app.data.Ligacao
import pt.domusenergia.app.data.MqttException
import pt.domusenergia.app.data.PagamentosApi
import pt.domusenergia.app.data.PagamentosCliente
import pt.domusenergia.app.data.PagamentosException
import pt.domusenergia.app.data.Planos
import pt.domusenergia.app.data.Sessao
import pt.domusenergia.app.notificacoes.Fcm
import pt.domusenergia.app.presenca.PresencaControlador
import pt.domusenergia.app.presenca.PresencaWorker

class DevicesViewModel(app: Application) : AndroidViewModel(app), Acoes {

    private val sessao = Sessao(app)
    private val mqtt = DomusMqtt()
    private val presenca = PresencaControlador(app)

    /** Serviço de pagamentos: token pedido com o código e a palavra-passe da sessão (decifrada pelo Keystore). */
    private val pagamentos = PagamentosCliente(PagamentosApi(), {
        val c = sessao.codigo
        val p = sessao.password
        if (c != null && p != null) c to p else null
    })

    private val _state = MutableStateFlow(UiState(loggedIn = sessao.isLoggedIn, codigo = sessao.codigo.orEmpty()))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Saída em curso (retira o token FCM antes de desligar); uma nova entrada espera por ela. */
    private var saida: Job? = null

    init {
        // O MQTT é "push": o estado chega sozinho quando muda, não há atualização periódica.
        viewModelScope.launch { mqtt.estado.collect { e -> _state.update { it.copy(estado = e) } } }
        viewModelScope.launch { presenca.ui.collect { p -> _state.update { it.copy(presenca = p) } } }
        viewModelScope.launch {
            mqtt.ligacao.collect { l ->
                if (l == Ligacao.RECUSADO && _state.value.loggedIn) {
                    // A palavra-passe mudou com a sessão aberta: volta ao ecrã de entrada.
                    mqtt.desligar()
                    sessao.limpar()
                    _state.value = UiState(loggedIn = false, erroLogin = "Código ou palavra-passe errados.", presenca = presenca.ui.value)
                } else {
                    _state.update { it.copy(ligacao = l) }
                }
            }
        }
        // Notificações: regista o token FCM deste telemóvel sempre que a ligação (re)abre — só se o plano
        // as incluir (docs/PROTOCOLO-PLANOS.md §1). O `_plano` retido chega logo depois de ligar: espera-se
        // que o valor fique estável 2 s antes de decidir (collectLatest cancela se mudar entretanto).
        Fcm.carregar(app)
        viewModelScope.launch {
            var registado: String? = null
            combine(
                mqtt.ligacao,
                Fcm.token,
                mqtt.estado.map { it.permite(Planos.NOTIFICACOES) }.distinctUntilChanged(),
            ) { l, t, pode -> Triple(l == Ligacao.LIGADO, t, pode) }.collectLatest { (ligado, token, pode) ->
                if (!ligado) {
                    registado = null
                    return@collectLatest
                }
                if (token == null) return@collectLatest
                delay(2_000)
                if (pode && registado != token) {
                    if (runCatching { mqtt.registarFcm(token) }.isSuccess) registado = token
                } else if (!pode && registado == token) {
                    // O plano deixou de ter notificações com a sessão aberta: retira este telemóvel.
                    if (runCatching { mqtt.registarFcm(token, remover = true) }.isSuccess) registado = null
                }
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
        pagamentos.esquecer()
        sessao.limpar()
        _state.value = UiState(loggedIn = false, presenca = presenca.ui.value)
        val token = Fcm.token.value
        // A presença é deste cliente: ao sair desliga-se (e sai do `_presenca` da casa, se houver ligação).
        val pessoa = if (presenca.ativa) presenca.pessoa else null
        if (pessoa != null) presenca.desativar()
        saida = viewModelScope.launch {
            if (mqtt.ligacao.value == Ligacao.LIGADO) {
                // Deixa de receber notificações deste cliente neste telemóvel.
                if (token != null) runCatching { withTimeout(3_000) { mqtt.registarFcm(token, remover = true) } }
                if (pessoa != null) runCatching { withTimeout(3_000) { mqtt.enviar(listOf(Comandos.presencaRemover(mqtt.codigoAtual, pessoa))) } }
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
        // O motor responde com a lista (retida) ou, se recusar, com um evento "erro" seguido da lista antiga.
        guardarEsperando({ it.recebidasAutomacoes }, "Automações guardadas.", aoGuardar) { mqtt.guardarAutomacoes(lista) }
    }

    /**
     * Publica uma lista/configuração e espera pela resposta do motor: o tópico retido outra vez
     * ([contagem] aumenta) ou um evento `erro`. [ok] é a mensagem de sucesso.
     */
    private fun guardarEsperando(contagem: (Estado) -> Int, ok: String, aoGuardar: () -> Unit, publicar: suspend () -> Unit) {
        if (_state.value.aGuardar) return
        _state.update { it.copy(aGuardar = true) }
        viewModelScope.launch {
            try {
                val antes = contagem(mqtt.estado.value)
                publicar()
                val resposta = withTimeoutOrNull(10_000) {
                    mqtt.estado.first { contagem(it) > antes || it.ultimoErro != null }
                }
                if (resposta != null && resposta.ultimoErro == null) delay(300) // o "erro" pode vir logo a seguir
                val erro = mqtt.estado.value.ultimoErro
                when {
                    resposta == null -> _state.update { it.copy(aviso = "O servidor não respondeu. Tente outra vez.") }
                    erro != null -> _state.update { it.copy(aviso = "Não guardado: ${erro.mensagem}") }
                    else -> {
                        _state.update { it.copy(aviso = ok) }
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

    // ---------------------------------------------------------------- v3

    override fun modo(modo: String, forcar: Boolean) {
        _state.update { it.copy(modoPedido = modo) }
        viewModelScope.launch {
            try {
                mqtt.setModo(modo, forcar)
                // Resposta: `_modo` novo, ou um evento `erro` ("Não armado: Janela WC está aberta.").
                val r = withTimeoutOrNull(10_000) { mqtt.estado.first { it.modo?.modo == modo || it.ultimoErro != null } }
                val erro = r?.ultimoErro
                when {
                    r == null -> _state.update { it.copy(modoPedido = null, aviso = "O servidor não respondeu. Tente outra vez.") }
                    // Portas abertas: o cartão mostra a mensagem com "Armar mesmo assim" (fica o pedido).
                    // Idem para "Disponível a partir do plano Conforto." (com "Mudar de plano").
                    erro != null && (erro.mensagem.startsWith("Não armado") || Planos.eErroDePlano(erro.mensagem)) -> Unit
                    erro != null -> _state.update { it.copy(modoPedido = null, aviso = erro.mensagem) }
                    else -> _state.update { it.copy(modoPedido = null) }
                }
            } catch (e: MqttException) {
                _state.update { it.copy(modoPedido = null, aviso = e.message) }
            }
        }
    }

    override fun cancelarModo() {
        _state.update { it.copy(modoPedido = null) }
        mqtt.limparErro()
    }

    override fun executarCena(id: String) = comando {
        mqtt.limparErro()
        mqtt.executarCena(id)
        val nome = mqtt.estado.value.cenas?.firstOrNull { it.id == id }?.nome ?: id
        // O motor só responde se recusar (evento `erro`).
        val erro = withTimeoutOrNull(2_000) { mqtt.estado.first { it.ultimoErro != null } }?.ultimoErro
        _state.update { it.copy(aviso = erro?.let { e -> "Não executada: ${e.mensagem}" } ?: "Cena \"$nome\" executada.") }
    }

    override fun guardarCenas(lista: List<Cena>, aoGuardar: () -> Unit) {
        val erros = Cenas.validarLista(lista)
        if (erros.isNotEmpty()) {
            _state.update { it.copy(aviso = erros.first()) }
            return
        }
        guardarEsperando({ it.recebidasCenas }, "Cenas guardadas.", aoGuardar) { mqtt.guardarCenas(lista) }
    }

    override fun executarAutomacao(id: String) = pedidoAutomacao(id, Registo.PEDIDO_EXECUTAR) { mqtt.executarAutomacao(id) }

    override fun testarAutomacao(id: String) = pedidoAutomacao(id, Registo.PEDIDO_TESTAR) { mqtt.testarAutomacao(id) }

    override fun avaliarAutomacao(id: String) = pedidoAutomacao(id, Registo.PEDIDO_AVALIAR) { mqtt.avaliarAutomacao(id) }

    /** Envia o pedido e mostra o resultado quando o registo da automação mudar (como no site). */
    private fun pedidoAutomacao(id: String, tipo: String, enviar: suspend () -> Unit) = comando {
        mqtt.limparErro()
        val antes = mqtt.estado.value.registo[id]
        _state.update {
            it.copy(aviso = when (tipo) { Registo.PEDIDO_AVALIAR -> "A avaliar…"; Registo.PEDIDO_TESTAR -> "A testar…"; else -> "A executar…" })
        }
        enviar()
        val r = withTimeoutOrNull(10_000) { mqtt.estado.first { Registo.respondeu(tipo, antes, it.registo[id]) || it.ultimoErro != null } }
        val texto = when {
            r == null -> "O servidor não respondeu. Tente de novo."
            r.ultimoErro != null -> r.ultimoErro.mensagem
            else -> Registo.textoPedido(tipo, r.registo[id])
        }
        _state.update { it.copy(aviso = texto) }
    }

    override fun guardarConfig(antes: ConfigCasa, depois: ConfigCasa, aoGuardar: () -> Unit) {
        val erros = ConfigCasa.validar(depois)
        if (erros.isNotEmpty()) {
            _state.update { it.copy(aviso = erros.first()) }
            return
        }
        val parcial = ConfigCasa.parcial(antes, depois)
        if (parcial.length() == 0) return
        guardarEsperando({ it.recebidasConfig }, "Definições guardadas.", aoGuardar) { mqtt.guardarConfig(parcial) }
    }

    // ---------------------------------------------------------------- presença deste telemóvel

    override fun presencaNome(nome: String) = presenca.nome(nome)

    override fun presencaCasaAtual() {
        viewModelScope.launch { presenca.casaAtual() }
    }

    override fun presencaCasaCidade(c: Cidade) = presenca.casaCidade(c)

    override fun presencaWifiAtual() = presenca.wifiAtual()

    override fun presencaSemWifi() = presenca.semWifi()

    override fun presencaAtivar() = presenca.ativar()

    override fun presencaDesativar() {
        val pessoa = presenca.pessoa
        presenca.desativar()
        viewModelScope.launch {
            // Pela ligação aberta; sem ligação, o WorkManager envia quando houver rede.
            val ok = mqtt.ligacao.value == Ligacao.LIGADO &&
                runCatching { withTimeout(3_000) { mqtt.enviar(listOf(Comandos.presencaRemover(mqtt.codigoAtual, pessoa))) } }.isSuccess
            if (!ok) PresencaWorker.remover(getApplication(), pessoa)
        }
    }

    override fun presencaAtualizar() = presenca.atualizar()

    // ---------------------------------------------------------------- subscrição (docs/PROTOCOLO-PLANOS.md §4)

    override fun mudarPlano(plano: String) = pedirPagamento(PedidoPagamento.checkout(plano)) { pagamentos.checkout(plano) }

    override fun gerirPagamentos() = pedirPagamento(PedidoPagamento.PORTAL) { pagamentos.portal() }

    /** Pede o endereço ao serviço (fora da thread principal) e deixa-o em [UiState.abrirUrl] para a UI abrir. */
    private fun pedirPagamento(tipo: String, pedido: () -> String) {
        if (_state.value.pagamento != null) return
        _state.update { it.copy(pagamento = tipo, erroPagamento = null) }
        viewModelScope.launch {
            try {
                val url = withContext(Dispatchers.IO) { pedido() }
                _state.update { it.copy(pagamento = null, abrirUrl = url) }
            } catch (e: PagamentosException) {
                _state.update { it.copy(pagamento = null, erroPagamento = e.message) }
            }
        }
    }

    override fun urlAberta(ok: Boolean) = _state.update {
        it.copy(abrirUrl = null, erroPagamento = if (ok) it.erroPagamento else "Não foi encontrado um navegador para abrir a página.")
    }

    override fun limparAviso() = _state.update { it.copy(aviso = null) }

    override fun limparErroAutomacoes() = mqtt.limparErro()

    override fun onCleared() {
        presenca.fechar()
        mqtt.desligar()
    }
}
