package pt.domusenergia.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Ligacao
import pt.domusenergia.app.data.Resumo
import pt.domusenergia.app.ui.tema.FormaCartao
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra

/** Separadores da barra de navegação inferior. */
enum class Separador(val titulo: String) { CASA("Casa"), AUTOMACOES("Automações"), HISTORICO("Histórico") }

@Composable
fun App(state: UiState, acoes: Acoes) {
    if (!state.loggedIn) {
        FundoVivo(null, Modifier.fillMaxSize()) {
            LoginScreen(loading = state.loading, error = state.erroLogin, onLogin = acoes::login)
        }
    } else {
        Principal(state, acoes)
    }
}

@Composable
fun LoginScreen(loading: Boolean, error: String?, onLogin: (String, String) -> Unit) {
    var codigo by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val pode = !loading && codigo.isNotBlank() && password.isNotBlank()

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Medidor(potenciaW = null, tamanho = 56.dp)
        Text("Domus Energia", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Entre com o código de cliente e a palavra-passe que recebeu da Domus Energia.",
            style = MaterialTheme.typography.bodyLarge,
            color = LocalTerra.current.textoSuave,
        )
        OutlinedTextField(
            codigo, { codigo = it },
            label = { Text("Código de cliente") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Ascii,
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            password, { password = it },
            label = { Text("Palavra-passe") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { if (pode) onLogin(codigo, password) }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Button(
            onClick = { onLogin(codigo, password) },
            enabled = pode,
            shape = FormaPilula,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = LocalTerra.current.creme)
                Spacer(Modifier.width(8.dp))
            }
            Text(if (loading) "A entrar…" else "Entrar")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Principal(state: UiState, acoes: Acoes) {
    val t = LocalTerra.current
    var separador by rememberSaveable { mutableStateOf(Separador.CASA) }
    val snackbar = remember { SnackbarHostState() }
    val aparelhos = state.estado.aparelhos
    val resumo = remember(aparelhos, state.estado.alarme) { Resumo.de(aparelhos, state.estado.alarme) }

    LaunchedEffect(state.aviso) {
        val m = state.aviso ?: return@LaunchedEffect
        snackbar.showSnackbar(m)
        acoes.limparAviso()
    }

    FundoVivo(resumo, Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = Color.Transparent,
            contentColor = t.texto,
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = {
                TopAppBar(
                    title = { Text(if (separador == Separador.CASA) "A minha casa" else separador.titulo) },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color.Transparent,
                        titleContentColor = t.texto,
                        actionIconContentColor = t.textoSuave,
                    ),
                    actions = {
                        IconButton(onClick = acoes::logout) {
                            Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sair")
                        }
                    },
                )
            },
            bottomBar = {
                NavigationBar(containerColor = t.superficie) {
                    Separador.entries.forEach { s ->
                        NavigationBarItem(
                            selected = separador == s,
                            onClick = { separador = s },
                            icon = {
                                Icon(
                                    when (s) {
                                        Separador.CASA -> Icons.Filled.Home
                                        Separador.AUTOMACOES -> Icons.Filled.Settings
                                        Separador.HISTORICO -> Icons.Filled.Notifications
                                    },
                                    contentDescription = null,
                                )
                            },
                            label = { Text(s.titulo) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = t.musgo,
                                selectedTextColor = t.texto,
                                indicatorColor = t.musgoClaro,
                                unselectedIconColor = t.textoSuave,
                                unselectedTextColor = t.textoSuave,
                            ),
                        )
                    }
                }
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                if (state.ligacao != Ligacao.LIGADO) EstadoLigacao(state.ligacao)
                when (separador) {
                    Separador.CASA -> CasaScreen(state, resumo, acoes)
                    Separador.AUTOMACOES -> AutomacoesScreen(state, acoes)
                    Separador.HISTORICO -> HistoricoScreen(state)
                }
            }
        }
    }
}

/** Barra discreta enquanto não há ligação ao servidor (o cliente MQTT religa sozinho). */
@Composable
fun EstadoLigacao(ligacao: Ligacao) {
    val t = LocalTerra.current
    Surface(color = t.areia.copy(alpha = 0.25f), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ligacao == Ligacao.A_LIGAR || ligacao == Ligacao.A_RELIGAR) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp, color = t.argila)
                Spacer(Modifier.width(8.dp))
            }
            Text(
                when (ligacao) {
                    Ligacao.A_LIGAR -> "A ligar…"
                    Ligacao.A_RELIGAR -> "A religar…"
                    else -> "Sem ligação ao servidor."
                },
                style = MaterialTheme.typography.bodySmall,
                color = t.texto,
            )
        }
    }
}

/** Cartão do tema Terra: superfície, raio 18 dp, borda fina e sombra muito leve. */
@Composable
fun Cartao(modifier: Modifier = Modifier, destaque: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val t = LocalTerra.current
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = FormaCartao,
        colors = CardDefaults.cardColors(containerColor = t.superficie, contentColor = t.texto),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        border = BorderStroke(1.dp, destaque ?: t.borda),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

/** Etiqueta pequena ("Aberta", "Offline", "Bloqueada"). */
@Composable
fun Etiqueta(texto: String, cor: Color, modifier: Modifier = Modifier) {
    Surface(color = cor.copy(alpha = 0.16f), contentColor = cor, shape = FormaPilula, modifier = modifier) {
        Text(texto, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
    }
}

/** Botão principal em pílula (`--musgo`, texto creme). */
@Composable
fun BotaoPilula(texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, cor: Color? = null) {
    val t = LocalTerra.current
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = FormaPilula,
        colors = ButtonDefaults.buttonColors(containerColor = cor ?: t.musgo, contentColor = t.creme),
        modifier = modifier,
    ) { Text(texto) }
}
