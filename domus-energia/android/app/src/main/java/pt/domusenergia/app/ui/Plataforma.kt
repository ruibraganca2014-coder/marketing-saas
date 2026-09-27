package pt.domusenergia.app.ui

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Coisas que só o Android faz (folha de partilha, pedidos de autorização). A MainActivity fornece-as;
 * os ecrãs ficam sem dependências do Android (e nos desenhos de teste os botões simplesmente não fazem nada).
 */
data class Plataforma(
    /** Abre a folha de partilha do Android com [texto]. `null` = não há (o botão "Partilhar" não aparece). */
    val partilhar: ((titulo: String, texto: String) -> Unit)? = null,
    /** Pede ACCESS_FINE_LOCATION (+ COARSE). */
    val pedirLocalizacao: () -> Unit = {},
    /** Pede ACCESS_BACKGROUND_LOCATION (Android 10+; no 11+ abre as definições da app). */
    val pedirSegundoPlano: () -> Unit = {},
    /** Abre as definições da app (autorizações recusadas "para sempre", poupança de bateria). */
    val abrirDefinicoesApp: () -> Unit = {},
    /** Abre um endereço (página de pagamento, WhatsApp, `tel:`) noutra app. `false` se nenhuma o abrir. */
    val abrirLink: (url: String) -> Boolean = { false },
)

val LocalPlataforma = staticCompositionLocalOf { Plataforma() }
