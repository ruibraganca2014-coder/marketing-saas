package pt.domusenergia.app.ui

import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Cidade
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.ConfigCasa
import pt.domusenergia.app.data.Estado
import pt.domusenergia.app.data.Ligacao
import pt.domusenergia.app.data.Local

/**
 * Deteção de presença DESTE telemóvel (opcional, desligada por omissão). Preenchido pelo
 * `presenca.PresencaControlador` (Android); nos testes/desenhos é só um valor.
 *
 * @property localizacao autorização de localização (precisa) concedida.
 * @property segundoPlano autorização de localização "sempre" (Android 10+) concedida.
 * @property casa centro da zona de casa (≥ 100 m de raio).
 * @property casaTexto "Lisboa" ou "Localização atual (± 20 m)".
 * @property wifi rede Wi-Fi de casa (SSID), `null` = só GPS.
 * @property wifiAtual rede a que o telemóvel está ligado agora (para "usar esta rede").
 * @property emCasa último valor enviado ao servidor.
 * @property pendente valor novo à espera de 10 min estáveis.
 */
data class PresencaUi(
    val disponivel: Boolean = true,
    val ativa: Boolean = false,
    val nome: String = "",
    val localizacao: Boolean = false,
    val segundoPlano: Boolean = false,
    val casa: Local? = null,
    val casaTexto: String? = null,
    val raioM: Int = 150,
    val wifi: String? = null,
    val wifiAtual: String? = null,
    val emCasa: Boolean? = null,
    val pendente: Boolean? = null,
    val erro: String? = null,
) {
    val pronta: Boolean get() = localizacao && segundoPlano && casa != null && nome.isNotBlank()
}

/**
 * Tudo o que os ecrãs mostram.
 *
 * @property erroLogin erro a mostrar no ecrã de entrada.
 * @property aviso mensagem curta (erro de comando, "Automações guardadas.") mostrada numa snackbar.
 * @property aGuardar à espera de o motor aceitar/recusar a lista de automações/cenas/configuração publicada.
 * @property modoPedido modo pedido pela app e ainda não confirmado (para oferecer "Armar mesmo assim").
 * @property pagamento pedido ao serviço de pagamentos em curso ([PedidoPagamento]); `null` = nenhum.
 * @property erroPagamento erro do último pedido de pagamento (mostrado no ecrã da subscrição).
 * @property abrirUrl página de pagamento/portal a abrir no navegador (a UI abre e chama [Acoes.urlAberta]).
 */
data class UiState(
    val loggedIn: Boolean,
    val codigo: String = "",
    val estado: Estado = Estado(),
    val ligacao: Ligacao = Ligacao.DESLIGADO,
    val loading: Boolean = false,
    val erroLogin: String? = null,
    val aviso: String? = null,
    val aGuardar: Boolean = false,
    val modoPedido: String? = null,
    val presenca: PresencaUi = PresencaUi(),
    val pagamento: String? = null,
    val erroPagamento: String? = null,
    val abrirUrl: String? = null,
) {
    val ligado: Boolean get() = ligacao == Ligacao.LIGADO
}

/** Operações em curso no serviço de pagamentos ([UiState.pagamento]). */
object PedidoPagamento {
    const val PORTAL = "portal"
    fun checkout(plano: String) = "checkout:$plano"
}

/** Ações que os ecrãs pedem (implementadas pelo [DevicesViewModel]). */
interface Acoes {
    fun login(codigo: String, password: String)
    fun logout()
    fun ligar(a: Aparelho, n: Int, ligado: Boolean)
    fun brilho(a: Aparelho, n: Int, brilho: Int)
    fun estore(a: Aparelho, n: Int, posicao: Int)
    fun moverEstore(a: Aparelho, n: Int, mov: Comandos.MovimentoEstore)
    fun alarme(ativo: Boolean)

    /** Publica a lista COMPLETA; [aoGuardar] corre quando o motor a aceitar. */
    fun guardarAutomacoes(lista: List<Automacao>, aoGuardar: () -> Unit)
    fun limparAviso()
    fun limparErroAutomacoes()

    // ---- v3
    /** Muda o modo da casa; com [forcar] arma mesmo com portas abertas ("Armar mesmo assim"). */
    fun modo(modo: String, forcar: Boolean = false) {}

    /** Esquece o pedido de modo recusado (botão "Cancelar" do aviso "Não armado"). */
    fun cancelarModo() {}
    fun executarCena(id: String) {}

    /** Publica a lista COMPLETA de cenas; [aoGuardar] corre quando o motor a aceitar. */
    fun guardarCenas(lista: List<Cena>, aoGuardar: () -> Unit) {}
    /** "Executar" de uma automação com gatilho manual. */
    fun executarAutomacao(id: String) {}
    fun testarAutomacao(id: String) {}
    fun avaliarAutomacao(id: String) {}

    /** Envia só o que mudou entre [antes] e [depois] para `_config/set`. */
    fun guardarConfig(antes: ConfigCasa, depois: ConfigCasa, aoGuardar: () -> Unit = {}) {}

    // ---- presença deste telemóvel (Android: pacote presenca/)
    fun presencaNome(nome: String) {}
    fun presencaCasaAtual() {}
    fun presencaCasaCidade(c: Cidade) {}
    fun presencaWifiAtual() {}
    fun presencaSemWifi() {}
    fun presencaAtivar() {}
    fun presencaDesativar() {}

    /** Voltar a ler as autorizações (depois de o utilizador responder aos pedidos do Android). */
    fun presencaAtualizar() {}

    // ---- subscrição (docs/PROTOCOLO-PLANOS.md §4, §6)
    /** "Mudar de plano"/"Reativar subscrição": pede a página de pagamento (Stripe Checkout) para [plano]. */
    fun mudarPlano(plano: String) {}

    /** "Gerir pagamentos e faturas"/"Atualizar pagamento": pede o portal de pagamentos. */
    fun gerirPagamentos() {}

    /** A UI já tentou abrir [UiState.abrirUrl] ([ok] = havia um navegador). */
    fun urlAberta(ok: Boolean) {}
}
