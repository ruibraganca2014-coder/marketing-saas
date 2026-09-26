package pt.domusenergia.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import pt.domusenergia.app.tuya.Device

@Composable
fun App(vm: DevicesViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()

    if (!state.loggedIn) {
        LoginScreen(loading = state.loading, error = state.error, onLogin = vm::login)
    } else {
        DevicesScreen(
            state = state,
            onRefresh = { vm.refresh() },
            onPoll = { vm.refresh(silent = true) },
            onToggle = vm::toggle,
            onLogout = vm::logout,
        )
    }
}

@Composable
fun LoginScreen(loading: Boolean, error: String?, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Text("⚡ Domus Energia", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Entre com o email e a palavra-passe que recebeu da Domus Energia.")
        OutlinedTextField(
            email, { email = it },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            password, { password = it },
            label = { Text("Palavra-passe") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = { onLogin(email, password) },
            enabled = !loading && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (loading) "A entrar…" else "Entrar") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(
    state: UiState,
    onRefresh: () -> Unit,
    onPoll: () -> Unit,
    onToggle: (Device) -> Unit,
    onLogout: () -> Unit,
) {
    // Carrega ao abrir e atualiza o estado/consumo a cada 10 segundos.
    LaunchedEffect(Unit) {
        onRefresh()
        while (true) {
            delay(10_000)
            onPoll()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Os meus circuitos") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                actions = {
                    IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, "Atualizar") }
                    IconButton(onClick = onLogout) { Icon(Icons.Filled.ExitToApp, "Sair") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
            }
            when {
                state.loading && state.devices.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator()
                }
                state.devices.isEmpty() -> Text(
                    "Ainda não tem aparelhos associados. Contacte a Domus Energia.",
                    modifier = Modifier.padding(16.dp),
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item { Summary(state.devices) }
                    items(state.devices, key = { it.id }) { device ->
                        DeviceCard(device, onToggle = { onToggle(device) })
                    }
                }
            }
        }
    }
}

@Composable
fun Summary(devices: List<Device>) {
    val totalW = devices.sumOf { it.powerW ?: 0.0 }
    val on = devices.count { it.isOn }
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text("%.0f W".format(totalW), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Potência agora", style = MaterialTheme.typography.bodySmall)
            }
            Column(Modifier.weight(1f)) {
                Text("$on / ${devices.size}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Circuitos ligados", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
fun DeviceCard(device: Device, onToggle: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(10.dp).clip(CircleShape)
                    .background(if (device.online) MaterialTheme.colorScheme.primary else Color.Gray)
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(device.name, style = MaterialTheme.typography.titleMedium)
                val details = buildList {
                    add(if (device.online) "Online" else "Offline")
                    device.powerW?.let { add("%.1f W".format(it)) }
                    device.voltageV?.let { add("%.0f V".format(it)) }
                    device.currentA?.let { add("%.2f A".format(it)) }
                }
                Text(details.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            }
            if (device.switchCode != null) {
                Switch(checked = device.isOn, onCheckedChange = { onToggle() }, enabled = device.online)
            }
        }
    }
}
