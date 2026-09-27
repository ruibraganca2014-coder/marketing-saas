package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.LinhaSaude
import pt.domusenergia.app.data.Modos
import pt.domusenergia.app.data.Planos
import pt.domusenergia.app.data.Relatorio
import pt.domusenergia.app.data.SaudeCasa
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.numeros
import java.time.Duration
import java.time.Instant

// ------------------------------------------------------------------ Saúde dos aparelhos (v3 §5)

/** Estado de cada aparelho (`_saude`): online/offline desde, última notícia, sinal, reinícios, bateria. */
@Composable
fun SaudeScreen(state: UiState) {
    val t = LocalTerra.current
    val agora = agoraAtual()
    val estado = state.estado
    val linhas = remember(estado.aparelhos, estado.saude, agora) { SaudeCasa.linhas(estado.aparelhos, estado.saude, agora) }
    val atencao = linhas.count { it.atencao }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(key = "_topo") {
            Cartao(destaque = if (atencao > 0) t.areia else null) {
                Text(
                    when (atencao) {
                        0 -> "Está tudo bem"
                        1 -> "1 aparelho precisa de atenção"
                        else -> "$atencao aparelhos precisam de atenção"
                    },
                    style = MaterialTheme.typography.titleLarge,
                )
                Ajuda(
                    if (estado.saude.isEmpty()) "O servidor ainda não enviou a saúde dos aparelhos; mostramos o que a app sabe."
                    else "Sinal Wi-Fi, reinícios e pilhas medidos pelo servidor a cada 5 min.",
                )
            }
        }
        items(linhas, key = { it.aparelho.id }) { l -> CartaoSaude(l, agora) }
    }
}

@Composable
private fun CartaoSaude(l: LinhaSaude, agora: Instant) {
    val t = LocalTerra.current
    Cartao(destaque = if (l.atencao) t.areia else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(l.aparelho.nome, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                l.aparelho.divisaoMostrada?.let { Ajuda(it) }
            }
            when (l.online) {
                true -> Etiqueta("Online", t.musgo)
                false -> Etiqueta("Offline", t.alarme)
                null -> Etiqueta("A pilhas", t.textoSuave)
            }
        }
        l.problemas.forEach { p ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, contentDescription = null, tint = t.argila, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(p, style = MaterialTheme.typography.bodyMedium, color = t.argila)
            }
        }
        HorizontalDivider(color = t.borda)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Dado("Última notícia", Textos.tempoRelativo(l.ultimaNoticia, agora) ?: "—", Modifier.weight(1f))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BarrasSinal(l.barras, if (SaudeCasa.sinalFraco(l.rssi)) t.argila else t.musgo, t.borda)
                    Spacer(Modifier.width(6.dp))
                    Text(l.rssi?.let { "$it dBm" } ?: "—", style = MaterialTheme.typography.titleSmall.numeros)
                }
                Ajuda("Sinal Wi-Fi")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (l.aparelho.bateria || l.bateria != null) {
                Dado(
                    "Pilha",
                    (l.bateria?.let { "$it %" } ?: "—") + (l.bateriaDias?.let { " · ${SaudeCasa.textoDias(it)}" } ?: ""),
                    Modifier.weight(1f),
                )
            } else {
                Dado("Ligado há", l.uptimeS?.let { textoUptime(it) } ?: "—", Modifier.weight(1f))
            }
            Dado("Reinícios (24 h)", l.reinicios24h?.toString() ?: "—", Modifier.weight(1f))
        }
        if (l.online == false && l.offlineDesde != null) {
            Ajuda("Sem ligação há ${Textos.tempoRelativo(l.offlineDesde, agora)?.removePrefix("há ") ?: "—"}. Verifique a tomada/disjuntor e o Wi-Fi.")
        }
    }
}

private fun textoUptime(s: Long): String {
    val d = Duration.ofSeconds(s)
    return when {
        d.toDays() >= 1 -> "${d.toDays()} d"
        d.toHours() >= 1 -> "${d.toHours()} h"
        else -> "${d.toMinutes()} min"
    }
}

@Composable
private fun Dado(rotulo: String, valor: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(valor, style = MaterialTheme.typography.titleSmall.numeros, maxLines = 1)
        Ajuda(rotulo)
    }
}

// ------------------------------------------------------------------ Relatório da casa (v3 §9)

/** Relatório agrupado por divisão, com Copiar (área de transferência) e Partilhar (Android). */
@Composable
fun RelatorioScreen(state: UiState, agoraFixo: Instant? = null) {
    val t = LocalTerra.current
    val agora = agoraFixo ?: agoraAtual()
    // Sem a energia no plano, o relatório (e o texto partilhado) não leva o consumo de hoje/ontem.
    val comEnergia = state.estado.permite(Planos.ENERGIA)
    val r = remember(state.estado, agora, comEnergia) {
        Relatorio.construir(if (comEnergia) state.estado else state.estado.copy(energia = null), agora)
    }
    val texto = remember(r) { Relatorio.texto(r) }
    val clipboard = LocalClipboardManager.current
    val partilhar = LocalPlataforma.current.partilhar
    var copiado by remember { mutableStateOf(false) }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(key = "_topo") {
            Cartao {
                Text("Relatório · ${Textos.diaHora(r.quando)}", style = MaterialTheme.typography.titleLarge)
                val estado = listOfNotNull(r.modo?.let { "Modo ${Modos.rotulo(it)}" }, r.alarme?.let { "alarme $it" })
                if (estado.isNotEmpty()) {
                    Text(estado.joinToString(" · ").replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyLarge,
                        color = if (r.alarme == "DISPARADO") t.alarme else t.texto)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Dado("Agora", r.potenciaW?.let { Textos.potencia(it) } ?: "—", Modifier.weight(1f))
                    if (comEnergia) {
                        Dado("Hoje", r.hojeKWh?.let { Textos.kwh(it) } ?: "—", Modifier.weight(1f))
                        Dado("Ontem", r.ontemKWh?.let { Textos.kwh(it) } ?: "—", Modifier.weight(1f))
                    }
                }
                if (!comEnergia) Bloqueado(Planos.ENERGIA)
                Text(Relatorio.resumo(r), style = MaterialTheme.typography.bodyMedium, color = t.textoSuave)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    BotaoPilula(if (copiado) "Copiado" else "Copiar", onClick = {
                        clipboard.setText(AnnotatedString(texto))
                        copiado = true
                    })
                    if (partilhar != null) {
                        OutlinedButton(onClick = { partilhar("Relatório da casa", texto) }, shape = FormaPilula) {
                            Icon(Icons.Filled.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Partilhar")
                        }
                    }
                }
            }
        }
        items(r.seccoes, key = { "div_" + it.divisao }) { s ->
            Cartao {
                Titulo(s.divisao)
                s.itens.forEach { i ->
                    val cor = when {
                        i.atencao -> t.argila
                        i.estado == "em espera" -> t.argila
                        i.estado.startsWith("ligado") -> t.musgo
                        else -> t.textoSuave
                    }
                    if (i.estado.length > 18) {
                        // Estado comprido (problemas): por baixo do nome, para o nome não ficar esmagado.
                        Column(Modifier.fillMaxWidth()) {
                            Text(i.nome, style = MaterialTheme.typography.bodyMedium)
                            Text(i.estado, style = MaterialTheme.typography.bodySmall.numeros, color = cor)
                        }
                    } else {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(i.nome, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.width(8.dp))
                            Text(i.estado, style = MaterialTheme.typography.bodyMedium.numeros, color = cor, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
