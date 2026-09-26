package pt.domusenergia.app.notificacoes

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Recebe as mensagens FCM enviadas pelo motor (`notification` {title, body} + `data` {cliente, tipo}).
 *
 * Com a app em segundo plano, o Android mostra a parte `notification` sozinho, no canal indicado pelo
 * motor (`android.notification.channel_id`) ou, se não vier nenhum, no canal por omissão do
 * AndroidManifest ("avisos"). Com a app aberta (ou mensagens só com `data`), mostramos nós aqui.
 */
class DomusMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // O ViewModel (se a app estiver aberta e ligada) publica-o logo em _fcm/registar;
        // senão fica guardado e é publicado na próxima ligação.
        Fcm.novo(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val tipo = message.data["tipo"]
        val titulo = message.notification?.title ?: message.data["titulo"].orEmpty()
        val texto = message.notification?.body ?: message.data["mensagem"].orEmpty()
        if (titulo.isBlank() && texto.isBlank()) return
        Notificacoes.mostrar(this, titulo, texto, tipo)
    }
}
