package pt.domusenergia.app.notificacoes

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import pt.domusenergia.app.MainActivity
import pt.domusenergia.app.R

/**
 * Canais de notificação e apresentação das notificações.
 * - "Alarmes" (importância alta): eventos `alarme`.
 * - "Avisos" (importância normal): `aviso` (bateria fraca, sensor sem notícias) e ações `notificar`.
 */
object Notificacoes {
    const val CANAL_ALARMES = "alarmes"
    const val CANAL_AVISOS = "avisos"

    /** Cria os canais (Android 8+ — minSdk é 26). Pode ser chamado várias vezes. */
    fun criarCanais(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CANAL_ALARMES, "Alarmes", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Portas abertas ou movimento com o alarme ativo."
                    enableVibration(true)
                },
                NotificationChannel(CANAL_AVISOS, "Avisos", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Bateria fraca, sensores sem notícias e avisos das automações."
                },
            )
        )
    }

    fun canalPara(tipo: String?): String = if (tipo == "alarme") CANAL_ALARMES else CANAL_AVISOS

    /** Mostra uma notificação; sem a permissão POST_NOTIFICATIONS (Android 13+) não faz nada. */
    fun mostrar(context: Context, titulo: String, mensagem: String, tipo: String?) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        criarCanais(context)
        val abrir = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarme = tipo == "alarme"
        val n = NotificationCompat.Builder(context, canalPara(tipo))
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(ContextCompat.getColor(context, if (alarme) R.color.alarme else R.color.musgo))
            .setContentTitle(titulo.ifBlank { if (alarme) "Alarme" else "Domus Energia" })
            .setContentText(mensagem)
            .setStyle(NotificationCompat.BigTextStyle().bigText(mensagem))
            .setPriority(if (alarme) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(if (alarme) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(abrir)
            .build()
        try {
            NotificationManagerCompat.from(context).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n)
        } catch (e: SecurityException) {
            // Permissão retirada entretanto.
        }
    }
}
