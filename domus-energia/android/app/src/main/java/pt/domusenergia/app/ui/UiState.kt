package pt.domusenergia.app.ui

import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.Estado
import pt.domusenergia.app.data.Ligacao

/**
 * Tudo o que os ecrãs mostram.
 *
 * @property erroLogin erro a mostrar no ecrã de entrada.
 * @property aviso mensagem curta (erro de comando, "Automações guardadas.") mostrada numa snackbar.
 * @property aGuardar à espera de o motor aceitar/recusar a lista de automações publicada.
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
) {
    val ligado: Boolean get() = ligacao == Ligacao.LIGADO
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
}
