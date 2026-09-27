package pt.domusenergia.app.presenca

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import pt.domusenergia.app.data.Cidade
import pt.domusenergia.app.data.Local
import pt.domusenergia.app.ui.PresencaUi
import kotlin.math.roundToInt

/**
 * Deteção de presença deste telemóvel (opcional, desligada por omissão): zona de casa (Geofencing dos
 * Google Play services) + Wi-Fi de casa, com 10 min de "debounce" ([Verificar.passo]) e publicação por
 * WorkManager ([PresencaWorker]), mesmo com a app fechada. Tudo o que é Android está neste pacote.
 */
class PresencaControlador(context: Context) {
    private val ctx = context.applicationContext
    private val p = PresencaPrefs(ctx)

    private val _ui = MutableStateFlow(ler())
    val ui: StateFlow<PresencaUi> = _ui.asStateFlow()

    // O worker e o receptor da zona mudam as preferências; o ecrã acompanha. (Referência forte: o
    // SharedPreferences só guarda referências fracas aos listeners.)
    private val ouvinte = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> atualizar() }

    init {
        p.prefs.registerOnSharedPreferenceChangeListener(ouvinte)
    }

    fun fechar() = p.prefs.unregisterOnSharedPreferenceChangeListener(ouvinte)

    val ativa: Boolean get() = p.ativa
    val pessoa: String get() = p.pessoa

    /** Relê autorizações e rede atual (ao voltar das janelas de autorização do Android). */
    fun atualizar() {
        _ui.value = ler()
    }

    private fun ler(): PresencaUi {
        val d = p.debounce
        return PresencaUi(
            disponivel = servicosGoogle(ctx),
            ativa = p.ativa,
            nome = p.nome,
            localizacao = localizacao(ctx),
            segundoPlano = segundoPlano(ctx),
            casa = p.casa,
            casaTexto = p.casaTexto,
            raioM = p.raioM.roundToInt(),
            wifi = p.wifi,
            wifiAtual = WifiCasa.ssidAtual(ctx),
            emCasa = d.publicado,
            pendente = d.candidato?.takeIf { it != d.publicado },
            erro = p.erro,
        )
    }

    fun nome(n: String) {
        p.nome = n
    }

    /** Centro da zona = posição atual (a pessoa está em casa). */
    @SuppressLint("MissingPermission")
    suspend fun casaAtual() {
        if (!localizacao(ctx)) return
        try {
            val cliente = LocationServices.getFusedLocationProviderClient(ctx)
            val l = cliente.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token).await()
            if (l == null) {
                p.erro = "Não foi possível obter a localização. Ligue a localização do telemóvel e tente outra vez."
                return
            }
            p.casa = Local(l.latitude, l.longitude)
            p.casaTexto = "Localização atual (± ${l.accuracy.roundToInt()} m)"
            // Zona um pouco maior quando o GPS está impreciso.
            p.raioM = Sinais.raio(maxOf(Sinais.RAIO_PADRAO_M, l.accuracy * 2))
            p.erro = null
        } catch (e: Exception) {
            p.erro = "Não foi possível obter a localização (${e.message ?: "erro"})."
        }
        if (p.ativa) registarZona()
    }

    fun casaCidade(c: Cidade) {
        p.casa = Local(c.lat, c.lon)
        p.casaTexto = c.nome
        // Centro da cidade: zona grande (menos preciso; ver o aviso no ecrã).
        p.raioM = 1500f
        if (p.ativa) registarZona()
    }

    fun wifiAtual() {
        WifiCasa.ssidAtual(ctx)?.let { p.wifi = it }
    }

    fun semWifi() {
        p.wifi = null
    }

    /** Liga (ou atualiza) a deteção: regista a zona e agenda as verificações. */
    fun ativar() {
        if (!(localizacao(ctx) && segundoPlano(ctx) && p.casa != null && p.nome.isNotBlank())) return
        PresencaWorker.cancelarRemover(ctx)
        p.ativa = true
        registarZona()
        PresencaWorker.agendarPeriodica(ctx)
        PresencaWorker.verificarJa(ctx)
    }

    /**
     * Desliga neste telemóvel: retira a zona, cancela o trabalho pendente e esquece o estado.
     * Quem chama publica `{"pessoa","remover":true}` ([PresencaWorker.remover] ou pela ligação aberta).
     */
    fun desativar() {
        p.ativa = false
        runCatching { LocationServices.getGeofencingClient(ctx).removeGeofences(intencao(ctx)) }
        PresencaWorker.cancelar(ctx)
        p.limparEstado()
    }

    /** (Re)regista a zona de casa. Idempotente: o mesmo id substitui a zona anterior. */
    @SuppressLint("MissingPermission")
    fun registarZona() = registarZona(ctx)

    companion object {
        const val ZONA_ID = "casa"

        fun servicosGoogle(ctx: Context): Boolean =
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS

        fun localizacao(ctx: Context): Boolean =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        /** "Permitir sempre" (só existe a partir do Android 10; antes, a localização já inclui o segundo plano). */
        fun segundoPlano(ctx: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

        /** PendingIntent para o [ZonaReceiver]. Tem de ser MUTABLE: o Android acrescenta o evento da zona. */
        fun intencao(ctx: Context): PendingIntent {
            val i = Intent(ctx, ZonaReceiver::class.java)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            return PendingIntent.getBroadcast(ctx, 0, i, flags)
        }

        @SuppressLint("MissingPermission")
        fun registarZona(ctx: Context) {
            val p = PresencaPrefs(ctx)
            val casa = p.casa ?: return
            if (!p.ativa || !localizacao(ctx) || !segundoPlano(ctx) || !servicosGoogle(ctx)) return
            val zona = Geofence.Builder()
                .setRequestId(ZONA_ID)
                .setCircularRegion(casa.lat, casa.lon, p.raioM)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                // Poupa bateria: o Android pode juntar eventos até 5 min (somamos 10 min de confirmação).
                .setNotificationResponsiveness(5 * 60 * 1000)
                .build()
            val pedido = GeofencingRequest.Builder()
                // Ao registar, diz logo se está dentro ou fora.
                .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT)
                .addGeofence(zona)
                .build()
            LocationServices.getGeofencingClient(ctx).addGeofences(pedido, intencao(ctx))
                .addOnSuccessListener { if (p.erro != null) p.erro = null }
                .addOnFailureListener { e ->
                    p.erro = "Não foi possível registar a zona de casa. Confirme que a localização do telemóvel está ligada. (${e.message ?: "erro"})"
                }
        }
    }
}
