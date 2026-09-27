package pt.domusenergia.app

import android.Manifest
import android.animation.ValueAnimator
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.domusenergia.app.ui.App
import pt.domusenergia.app.ui.DevicesViewModel
import pt.domusenergia.app.ui.LocalPlataforma
import pt.domusenergia.app.ui.Plataforma
import pt.domusenergia.app.ui.tema.DomusTema
import pt.domusenergia.app.ui.tema.Fontes
import pt.domusenergia.app.ui.tema.LocalVoltar

class MainActivity : ComponentActivity() {
    private val vm: DevicesViewModel by viewModels()

    // Android 13+: pedir autorização para mostrar notificações (alarmes e avisos).
    private val pedirNotificacoes = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Presença (opcional): primeiro a localização precisa, depois "Permitir sempre" (Android 10+).
    // O ecrã explica antes de cada pedido (DefinicoesScreen → PresencaExplicacao).
    private val pedirLocalizacao = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        vm.presencaAtualizar()
    }
    private val pedirSegundoPlano = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        vm.presencaAtualizar()
    }

    private val plataforma by lazy {
        Plataforma(
            partilhar = { titulo, texto ->
                val envio = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, titulo)
                    .putExtra(Intent.EXTRA_TEXT, texto)
                startActivity(Intent.createChooser(envio, titulo))
            },
            pedirLocalizacao = {
                pedirLocalizacao.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            },
            pedirSegundoPlano = {
                // Android 11+: o sistema abre a página de autorizações da app ("Permitir sempre").
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    pedirSegundoPlano.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                } else {
                    vm.presencaAtualizar()
                }
            },
            abrirDefinicoesApp = {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            },
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Escala de animações do sistema a 0 (acessibilidade / opções de programador): sem ilustrações animadas.
        val animacoes = ValueAnimator.areAnimatorsEnabled()
        setContent {
            val state by vm.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.loggedIn) { if (state.loggedIn) pedirPermissaoNotificacoes() }
            DomusTema(
                escuro = isSystemInDarkTheme(),
                titulos = Fontes.titulos,
                texto = Fontes.texto,
                animacoes = animacoes,
            ) {
                CompositionLocalProvider(
                    LocalVoltar provides { ativo, aoVoltar -> BackHandler(ativo, aoVoltar) },
                    LocalPlataforma provides plataforma,
                ) {
                    App(state, vm)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Ao voltar das definições do Android (autorizações, Wi-Fi), relê o estado da presença.
        vm.presencaAtualizar()
    }

    private fun pedirPermissaoNotificacoes() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            pedirNotificacoes.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
