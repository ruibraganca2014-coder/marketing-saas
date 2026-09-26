package pt.domusenergia.app.notificacoes

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import pt.domusenergia.app.data.Sessao

/**
 * Token do Firebase Cloud Messaging deste telemóvel. O ViewModel publica-o em
 * `domus/<cliente>/_fcm/registar` sempre que a ligação MQTT abre (docs/PROTOCOLO-MQTT-v2.md, secção 4).
 *
 * Sem `app/google-services.json` o Firebase não é inicializado: [disponivel] é `false` e a app
 * funciona na mesma, só sem notificações FCM (os avisos continuam no ntfy).
 */
object Fcm {
    private const val TAG = "DomusFcm"

    private val _token = MutableStateFlow<String?>(null)
    val token: StateFlow<String?> = _token.asStateFlow()

    fun disponivel(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    /** Lê o último token guardado e pede o atual ao Firebase. */
    fun carregar(context: Context) {
        val app = context.applicationContext
        Sessao(app).tokenFcm?.let { if (_token.value == null) _token.value = it }
        if (!disponivel(app)) {
            Log.i(TAG, "Firebase não configurado (falta app/google-services.json): sem notificações FCM.")
            return
        }
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { novo(app, it) }
                .addOnFailureListener { Log.w(TAG, "Não foi possível obter o token FCM", it) }
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Firebase indisponível", e)
        }
    }

    /** Token novo (arranque ou [DomusMessagingService.onNewToken]). */
    fun novo(context: Context, token: String) {
        Sessao(context.applicationContext).tokenFcm = token
        _token.value = token
    }
}
