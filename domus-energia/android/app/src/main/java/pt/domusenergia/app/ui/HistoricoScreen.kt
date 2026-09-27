package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Evento
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.Terra

/** Histórico de eventos (`_historico` retido + `_eventos` em direto) e a ligação para o ntfy. */
@Composable
fun HistoricoScreen(state: UiState) {
    val agora = agoraAtual()
    val estado = state.estado
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        estado.ntfyUrl?.let { url -> item(key = "_ntfy") { CartaoNtfy(url) } }
        if (estado.historico.isEmpty()) {
            item(key = "_vazio") {
                Text("Ainda não há eventos.", color = LocalTerra.current.textoSuave, modifier = Modifier.padding(8.dp))
            }
        }
        items(estado.historico, key = { "${it.tsTexto}|${it.tipo}|${it.titulo}|${it.mensagem}" }) { e ->
            LinhaEvento(e, agora, estado.aparelhos.firstOrNull { it.id == e.aparelho }?.nome)
        }
    }
}

@Composable
private fun CartaoNtfy(url: String) {
    val t = LocalTerra.current
    val clipboard = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    var copiado by remember { mutableStateOf(false) }
    Cartao {
        Text("Avisos também no ntfy", style = MaterialTheme.typography.titleMedium)
        Text(
            "Instale a app ntfy e subscreva este endereço para receber os alarmes e avisos noutros telemóveis ou no computador.",
            style = MaterialTheme.typography.bodySmall,
            color = t.textoSuave,
        )
        Text(url, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotaoPilula(if (copiado) "Copiado" else "Copiar", onClick = {
                clipboard.setText(AnnotatedString(url))
                copiado = true
            })
            OutlinedButton(onClick = { runCatching { uri.openUri(url) } }, shape = FormaPilula) { Text("Abrir") }
        }
    }
}

/** "app" → "app", "web" → "site", "automacao:x" → "automação x", "cena:x" → "cena x". */
fun porTexto(por: String): String = when {
    por == "web" -> "site"
    por.startsWith("automacao:") -> "automação " + por.removePrefix("automacao:")
    por.startsWith("cena:") -> "cena " + por.removePrefix("cena:")
    else -> por
}

private fun corEvento(t: Terra, tipo: String): Color = when (tipo) {
    Evento.ALARME, Evento.ERRO -> t.alarme
    Evento.AVISO -> t.areia
    Evento.AUTOMACAO -> t.musgo
    else -> t.textoSuave // sensor e modo: neutros
}

private fun rotuloEvento(tipo: String): String = when (tipo) {
    Evento.ALARME -> "Alarme"
    Evento.SENSOR -> "Sensor"
    Evento.AUTOMACAO -> "Automação"
    Evento.ERRO -> "Erro"
    Evento.MODO -> "Modo"
    else -> "Aviso"
}

@Composable
private fun LinhaEvento(e: Evento, agora: java.time.Instant, nomeAparelho: String?) {
    val t = LocalTerra.current
    val cor = corEvento(t, e.tipo)
    Cartao(destaque = if (e.tipo == Evento.ALARME) t.alarme else null) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.padding(top = 6.dp)) {
                Surface(color = cor, shape = CircleShape, modifier = Modifier.size(10.dp)) {}
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        e.titulo.ifBlank { rotuloEvento(e.tipo) },
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.weight(1f),
                    )
                    e.ts?.let { Text(Textos.quando(it, agora), style = MaterialTheme.typography.bodySmall, color = t.textoSuave) }
                }
                if (e.mensagem.isNotBlank()) Text(e.mensagem, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Etiqueta(rotuloEvento(e.tipo), cor)
                    nomeAparelho?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = t.textoSuave) }
                    e.por?.let { Text("por ${porTexto(it)}", style = MaterialTheme.typography.bodySmall, color = t.textoSuave) }
                }
            }
        }
    }
}
