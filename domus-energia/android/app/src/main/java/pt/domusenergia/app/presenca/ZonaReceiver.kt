package pt.domusenergia.app.presenca

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Recebe as entradas/saídas da zona de casa (também com a app fechada). Regista já a observação (com a
 * hora certa, para contar os 10 min) e deixa ao [PresencaWorker] o Wi-Fi e a publicação.
 */
class ZonaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ev = GeofencingEvent.fromIntent(intent) ?: return
        if (ev.hasError()) return
        val dentro = when (ev.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER, Geofence.GEOFENCE_TRANSITION_DWELL -> true
            Geofence.GEOFENCE_TRANSITION_EXIT -> false
            else -> return
        }
        val p = PresencaPrefs(context)
        if (!p.ativa) return
        p.zona = dentro
        val v = Verificar.passo(p.debounce, dentro, p.wifi, WifiCasa.ssidAtual(context), System.currentTimeMillis())
        p.debounce = v.estado
        PresencaWorker.agendar(context, if (v.publicar != null) 0 else v.esperaMs ?: return)
    }
}

/** Depois de reiniciar o telemóvel (ou de atualizar a app) as zonas desaparecem: regista outra vez. */
class ArranqueReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                if (!PresencaPrefs(context).ativa) return
                PresencaControlador.registarZona(context)
                PresencaWorker.agendarPeriodica(context)
            }
        }
    }
}
