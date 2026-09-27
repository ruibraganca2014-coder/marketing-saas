package pt.domusenergia.app.presenca

import android.content.Context
import android.net.wifi.WifiManager

/**
 * SSID da rede Wi-Fi atual. Precisa de ACCESS_WIFI_STATE, da localização (precisa) autorizada e da
 * localização do telemóvel ligada; em segundo plano (Android 10+) também de "Permitir sempre".
 * Sem isso o Android devolve `<unknown ssid>` e aqui fica `null` (o Wi-Fi simplesmente não conta).
 *
 * `WifiManager.connectionInfo` está obsoleto desde o Android 12, mas continua a devolver o SSID a apps
 * com autorização de localização; a alternativa (NetworkCallback com FLAG_INCLUDE_LOCATION_INFO) só
 * serve para escutar mudanças com a app viva, que não é o caso de um worker.
 */
object WifiCasa {
    @Suppress("DEPRECATION")
    fun ssidAtual(context: Context): String? = try {
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        Sinais.ssid(wm?.connectionInfo?.ssid)
    } catch (e: SecurityException) {
        null
    }
}
