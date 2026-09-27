package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Cidades
import pt.domusenergia.app.data.ConfigCasa
import pt.domusenergia.app.data.Local
import pt.domusenergia.app.data.Rascunho
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.LocalVoltar

/**
 * Definições da casa (`_config`, v3 §1) — envia só o que mudou para `_config/set` — e, no fim, a deteção
 * de presença deste telemóvel (opcional, desligada por omissão).
 *
 * @param explicacaoInicial abre logo o ecrã de explicação da presença (só para os desenhos de teste).
 */
@Composable
fun DefinicoesScreen(state: UiState, acoes: Acoes, explicacaoInicial: Boolean = false) {
    val t = LocalTerra.current
    val estado = state.estado
    val atual = estado.config
    var explicar by remember { mutableStateOf(explicacaoInicial) }

    if (explicar) {
        LocalVoltar.current(true) { explicar = false }
        PresencaExplicacao(state.presenca, acoes, onFechar = { explicar = false })
        return
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (atual == null) {
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = t.musgo)
                    Spacer(Modifier.width(10.dp))
                    Text("A aguardar as definições do servidor…", style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            FormularioConfig(atual, state, acoes)
        }
        CartaoPresenca(state.presenca, acoes) { explicar = true }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun FormularioConfig(atual: ConfigCasa, state: UiState, acoes: Acoes) {
    val t = LocalTerra.current
    var c by remember(atual) { mutableStateOf(atual) }
    // Textos das horas (normalizados ao guardar)
    var silDe by remember(atual) { mutableStateOf(atual.silencio?.first ?: "23:00") }
    var silAte by remember(atual) { mutableStateOf(atual.silencio?.second ?: "07:00") }
    var silencio by remember(atual) { mutableStateOf(atual.silencio != null) }
    var relatorio by remember(atual) { mutableStateOf(atual.relatorioDiario != null) }
    var relHora by remember(atual) { mutableStateOf(atual.relatorioDiario ?: "08:00") }
    val depois = c.copy(
        silencio = if (silencio) Rascunho.normalizaHora(silDe) to Rascunho.normalizaHora(silAte) else null,
        relatorioDiario = if (relatorio) Rascunho.normalizaHora(relHora) else null,
    )
    val erros = ConfigCasa.validar(depois)
    val mudou = ConfigCasa.parcial(atual, depois).length() > 0

    Cartao {
        Titulo("Alarme")
        Contador("Tempo para sair", c.atrasoSaidaS, { c = c.copy(atrasoSaidaS = it) }, 0, 300, 15, "s",
            ajuda = "Depois de armar, antes de as portas contarem.")
        Contador("Tempo para desarmar", c.atrasoEntradaS, { c = c.copy(atrasoEntradaS = it) }, 0, 300, 15, "s",
            ajuda = "Ao abrir uma porta de entrada.")
    }
    Cartao {
        Titulo("Avisos")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Horas de silêncio", style = MaterialTheme.typography.bodyLarge)
                Ajuda("Só os alarmes tocam nestas horas.")
            }
            Switch(checked = silencio, onCheckedChange = { silencio = it }, colors = coresInterruptor())
        }
        if (silencio) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Campo(silDe, { silDe = it }, "Das", Modifier.weight(1f), KeyboardType.Number)
                Campo(silAte, { silAte = it }, "Às", Modifier.weight(1f), KeyboardType.Number)
            }
        }
        HorizontalDivider(color = t.borda)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Relatório diário", style = MaterialTheme.typography.bodyLarge)
                Ajuda("Recebe o relatório da casa numa notificação.")
            }
            Switch(checked = relatorio, onCheckedChange = { relatorio = it }, colors = coresInterruptor())
        }
        if (relatorio) Campo(relHora, { relHora = it }, "Hora (HH:MM)", teclado = KeyboardType.Number)
        HorizontalDivider(color = t.borda)
        Contador("Aviso de aparelho offline", c.offlineMin, { c = c.copy(offlineMin = it) }, 5, 1440, 5, "min",
            ajuda = "Aparelhos ligados à corrente sem ligação há mais de…")
    }
    Cartao {
        Titulo("Automações e consumo")
        Contador("Pausa depois de mexer à mão", c.pausaManualMin, { c = c.copy(pausaManualMin = it) }, 0, 480, 15, "min",
            ajuda = "As automações desse canal esperam. 0 = sem pausa.")
        Contador("Limiar de \"em espera\"", Math.round(c.limiarEsperaW).toInt(), { c = c.copy(limiarEsperaW = it.toDouble()) }, 0, 100, 1, "W",
            ajuda = "Ligado mas a gastar menos do que isto.")
    }
    Cartao {
        Titulo("Localização da casa")
        Ajuda("Para as automações ao nascer e ao pôr do sol. Basta a cidade mais perto.")
        val cidade = Cidades.perto(c.local)
        Seletor(
            "Cidade", Cidades.TODAS.map { it to it.nome }, cidade, { c = c.copy(local = it.local) }, "",
        )
        c.local?.let { l ->
            Ajuda(if (cidade != null) "Perto de ${cidade.nome} (${coord(l)})" else "Coordenadas: ${coord(l)}")
        } ?: Ajuda("Ainda sem localização: as automações do sol não funcionam.", cor = t.argila)
    }
    if (erros.isNotEmpty()) {
        Cartao(destaque = t.alarme) { erros.forEach { Text("• $it", color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BotaoPilula(
            if (state.aGuardar) "A guardar…" else "Guardar definições",
            onClick = { acoes.guardarConfig(atual, depois) },
            enabled = state.ligado && mudou && erros.isEmpty() && !state.aGuardar,
        )
        if (mudou) TextButton(onClick = {
            c = atual; silencio = atual.silencio != null; relatorio = atual.relatorioDiario != null
            silDe = atual.silencio?.first ?: "23:00"; silAte = atual.silencio?.second ?: "07:00"; relHora = atual.relatorioDiario ?: "08:00"
        }) { Text("Desfazer") }
    }
}

private fun coord(l: Local) = "${Textos.numero(l.lat, 2)}, ${Textos.numero(l.lon, 2)}"

// ------------------------------------------------------------------ presença

@Composable
private fun CartaoPresenca(p: PresencaUi, acoes: Acoes, onExplicar: () -> Unit) {
    val t = LocalTerra.current
    Cartao {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Detetar quando chego e saio de casa", style = MaterialTheme.typography.titleMedium)
                Ajuda("Neste telemóvel. Serve para as automações \"chegar/sair\" e \"alguém em casa\".")
            }
            Switch(
                checked = p.ativa,
                onCheckedChange = { if (it) onExplicar() else acoes.presencaDesativar() },
                enabled = p.disponivel,
                colors = coresInterruptor(),
            )
        }
        if (!p.disponivel) Ajuda("Este telemóvel não tem os serviços de localização da Google.", cor = t.argila)
        if (p.ativa) {
            HorizontalDivider(color = t.borda)
            Text(
                when {
                    p.pendente != null -> "A confirmar ${if (p.pendente) "chegada" else "saída"} (10 min)…"
                    p.emCasa == true -> "${p.nome}: em casa"
                    p.emCasa == false -> "${p.nome}: fora de casa"
                    else -> "${p.nome}: à espera do primeiro sinal"
                },
                style = MaterialTheme.typography.bodyLarge,
            )
            Ajuda("Casa: ${p.casaTexto ?: "—"} · raio ${p.raioM} m" + (p.wifi?.let { " · Wi-Fi \"$it\"" } ?: ""))
            if (!p.segundoPlano) Ajuda("Falta a autorização \"Permitir sempre\": sem ela só funciona com a app aberta.", cor = t.argila)
            p.erro?.let { Ajuda(it, cor = t.alarme) }
            TextButton(onClick = onExplicar) { Text("Alterar", color = t.musgo) }
        }
    }
}

/**
 * Explica ANTES de pedir as autorizações (política do Google Play para localização em segundo plano):
 * porquê, o que sai do telemóvel, e depois pede-as por ordem (localização → "Permitir sempre").
 */
@Composable
fun PresencaExplicacao(p: PresencaUi, acoes: Acoes, onFechar: () -> Unit) {
    val t = LocalTerra.current
    val plataforma = LocalPlataforma.current
    // Ao voltar das janelas do Android, relê as autorizações.
    LaunchedEffect(Unit) { acoes.presencaAtualizar() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cartao {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.LocationOn, contentDescription = null, tint = t.musgo)
                Spacer(Modifier.width(8.dp))
                Text("Saber quando chega e sai de casa", style = MaterialTheme.typography.titleLarge)
            }
            Text(
                "A app usa a localização deste telemóvel, mesmo fechada, só para perceber se está dentro de uma zona " +
                    "de pelo menos 100 m à volta de casa (e, se quiser, se está ligado ao Wi-Fi de casa).",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "Para o servidor da Domus Energia só vai \"em casa\" ou \"fora\", com o seu nome, e só depois de " +
                    "10 minutos sem mudar. Nunca enviamos a sua posição nem o percurso.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Ajuda("Pode desligar a qualquer momento em Definições. Nunca é usada sozinha para desarmar o alarme.")
        }

        Passo(1, "Localização", p.localizacao, "Escolha \"Durante a utilização da app\" ou \"Precisa\".") {
            BotaoPilula("Permitir localização", onClick = plataforma.pedirLocalizacao)
        }
        Passo(2, "Permitir sempre", p.segundoPlano, "O Android abre uma janela: escolha \"Permitir sempre\". Sem isto só funciona com a app aberta.") {
            BotaoPilula("Permitir sempre", onClick = plataforma.pedirSegundoPlano, enabled = p.localizacao)
        }
        Passo(3, "Onde é a casa", p.casa != null, p.casaTexto?.let { "Casa: $it" } ?: "Esteja em casa e use a localização atual, ou escolha a cidade (menos preciso).") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = acoes::presencaCasaAtual, enabled = p.localizacao, shape = FormaPilula) {
                    Text("Usar a localização atual")
                }
                Seletor("Cidade", Cidades.TODAS.map { it to it.nome }, null, acoes::presencaCasaCidade, "")
            }
        }
        Passo(4, "O seu nome", p.nome.isNotBlank(), "Aparece no histórico: \"Rui chegou a casa\".") {
            var nome by remember(p.nome) { mutableStateOf(p.nome) }
            Campo(nome, { nome = it.take(40); acoes.presencaNome(nome) }, "Nome")
        }
        Cartao {
            Titulo("Wi-Fi de casa (opcional, recomendado)")
            Ajuda("Ligado ao Wi-Fi de casa conta como \"em casa\" mesmo quando o GPS falha dentro de casa.")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(p.wifi?.let { "Rede: $it" } ?: "Sem rede escolhida", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                if (p.wifi != null) TextButton(onClick = acoes::presencaSemWifi) { Text("Tirar", color = t.textoSuave) }
            }
            OutlinedButton(onClick = acoes::presencaWifiAtual, enabled = p.wifiAtual != null && p.wifiAtual != p.wifi, shape = FormaPilula) {
                Text(p.wifiAtual?.let { "Usar a rede atual (\"$it\")" } ?: "Não está ligado a um Wi-Fi")
            }
        }
        Cartao {
            Titulo("Limitações")
            Ajuda(
                "• Com a poupança de bateria ligada, ou em marcas que fecham apps em segundo plano (Xiaomi, Huawei, " +
                    "Samsung, Oppo…), os avisos podem atrasar ou falhar. Deixe a app \"sem restrições\" de bateria.",
            )
            Ajuda("• O Android pode demorar alguns minutos a detetar a saída; somamos 10 min para confirmar.")
            Ajuda("• Depois de reiniciar o telemóvel a zona volta a ser registada sozinha.")
            TextButton(onClick = plataforma.abrirDefinicoesApp) { Text("Abrir as definições da app", color = t.musgo) }
        }
        p.erro?.let { Cartao(destaque = t.alarme) { Text(it, color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotaoPilula(
                if (p.ativa) "Guardar" else "Ativar deteção",
                onClick = { acoes.presencaAtivar(); onFechar() },
                enabled = p.pronta,
            )
            TextButton(onClick = onFechar) { Text("Agora não") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Passo(n: Int, titulo: String, feito: Boolean, ajuda: String, acao: @Composable () -> Unit) {
    val t = LocalTerra.current
    Cartao(destaque = if (feito) t.musgo.copy(alpha = 0.5f) else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = FormaPilula, color = if (feito) t.musgo else t.musgoClaro, contentColor = if (feito) t.creme else t.texto) {
                if (feito) {
                    Icon(Icons.Filled.Check, contentDescription = "Feito", modifier = Modifier.padding(4.dp).size(18.dp))
                } else {
                    Text("$n", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp))
                }
            }
            Spacer(Modifier.width(10.dp))
            Text(titulo, style = MaterialTheme.typography.titleMedium)
        }
        Ajuda(ajuda)
        if (!feito || n >= 3) acao()
    }
}
