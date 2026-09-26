package pt.domusenergia.app

import android.Manifest
import android.animation.ValueAnimator
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
import pt.domusenergia.app.ui.tema.DomusTema
import pt.domusenergia.app.ui.tema.Fontes
import pt.domusenergia.app.ui.tema.LocalVoltar

class MainActivity : ComponentActivity() {
    private val vm: DevicesViewModel by viewModels()

    // Android 13+: pedir autorização para mostrar notificações (alarmes e avisos).
    private val pedirNotificacoes = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

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
                CompositionLocalProvider(LocalVoltar provides { ativo, aoVoltar -> BackHandler(ativo, aoVoltar) }) {
                    App(state, vm)
                }
            }
        }
    }

    private fun pedirPermissaoNotificacoes() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            pedirNotificacoes.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
