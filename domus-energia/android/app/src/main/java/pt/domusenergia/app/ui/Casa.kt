package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import pt.domusenergia.app.data.Alarme
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Canal
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.data.Resumo
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.numeros
import java.time.Instant

/** "Agora", atualizado a cada 30 s (para os "há X min"). */
@Composable
fun agoraAtual(): Instant {
    val agora by produceState(Instant.now()) {
        while (true) {
            delay(30_000)
            value = Instant.now()
        }
    }
    return agora
}

@Composable
fun CasaScreen(state: UiState, resumo: Resumo, acoes: Acoes) {
    val agora = agoraAtual()
    val estado = state.estado
    when {
        !estado.listaRecebida -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(color = LocalTerra.current.musgo)
        }
        else -> LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "_alarme") { CartaoAlarme(estado.alarme, agora, state.ligado, acoes::alarme) }
            item(key = "_resumo") { CartaoResumo(resumo) }
            if (estado.aparelhos.isEmpty()) {
                item(key = "_vazio") {
                    Text(
                        "Ainda não tem aparelhos associados. Contacte a Domus Energia.",
                        color = LocalTerra.current.textoSuave,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
            items(estado.aparelhos, key = { it.id }) { a -> CartaoAparelho(a, agora, state.ligado, acoes) }
        }
    }
}

@Composable
fun CartaoAlarme(alarme: Alarme?, agora: Instant, ligado: Boolean, onAlarme: (Boolean) -> Unit) {
    val t = LocalTerra.current
    val ativo = alarme?.ativo == true
    Cartao(destaque = if (ativo) t.alarme else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (ativo) "Alarme ativo" else "Alarme desligado", style = MaterialTheme.typography.titleLarge,
                    color = if (ativo) t.alarme else t.texto)
                val sub = when {
                    alarme == null -> "A aguardar o estado do alarme…"
                    ativo && alarme.desde != null -> "Desde ${Textos.quando(alarme.desde, agora)}. Portas e movimento avisam-no."
                    ativo -> "Portas e movimento avisam-no."
                    else -> "Ative ao sair de casa para ser avisado de portas abertas ou movimento."
                }
                Text(sub, style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
            }
            Spacer(Modifier.width(12.dp))
            BotaoPilula(
                if (ativo) "Desativar" else "Ativar",
                onClick = { onAlarme(!ativo) },
                enabled = ligado && alarme != null,
                cor = if (ativo) t.alarme else t.musgo,
            )
        }
    }
}

@Composable
fun CartaoResumo(r: Resumo) {
    Cartao {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Numero(if (r.temMedidor) Textos.potencia(r.potenciaW) else "—", "Potência agora", Modifier.weight(1f))
            Numero("${r.ligados}/${r.circuitos}", "Ligados", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Numero(if (r.portas == 0) "—" else "${r.portasAbertas}/${r.portas}", "Portas abertas", Modifier.weight(1f))
            Numero(
                when (r.alarme) {
                    true -> "Ativo"
                    false -> "Desligado"
                    null -> "—"
                },
                "Alarme",
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun Numero(valor: String, rotulo: String, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    Column(modifier) {
        Text(valor, style = MaterialTheme.typography.headlineSmall.numeros, maxLines = 1)
        Text(rotulo, style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
    }
}

@Composable
fun CartaoAparelho(a: Aparelho, agora: Instant, ligado: Boolean, acoes: Acoes) {
    val t = LocalTerra.current
    val controlavel = ligado && a.disponivel
    Cartao {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(a.nome, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val estadoTexto = when {
                    a.bateria && a.semNoticias(agora) -> Textos.semNoticias(a.ultimaNoticia!!, agora)
                    a.bateria -> Textos.tempoRelativo(a.ultimaNoticia, agora)?.let { "Última notícia $it" } ?: "A pilhas"
                    a.online -> "Online"
                    else -> "Offline"
                }
                Text(estadoTexto, style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
            }
            when {
                a.bateria && a.semNoticias(agora) -> Etiqueta("Sem notícias", t.areia)
                !a.bateria && !a.online -> Etiqueta("Offline", t.textoSuave)
            }
        }
        if (a.medidor) LinhaMedidor(a)
        a.canais.forEachIndexed { i, c ->
            if (i > 0 || a.medidor) HorizontalDivider(color = t.borda)
            LinhaCanal(a, c, agora, controlavel, acoes)
        }
    }
}

@Composable
private fun LinhaMedidor(a: Aparelho) {
    val t = LocalTerra.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Medidor(a.potenciaW)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(a.potenciaW?.let { Textos.potencia(it) } ?: "— W", style = MaterialTheme.typography.titleMedium.numeros)
            val det = buildList {
                a.tensaoV?.let { add(Textos.numero(it, 0) + " V") }
                a.correnteA?.let { add(Textos.numero(it, 2) + " A") }
                a.energiaKWh?.let { add(Textos.numero(it, 1) + " kWh") }
            }
            if (det.isNotEmpty()) {
                Text(det.joinToString(" · "), style = MaterialTheme.typography.bodySmall.numeros, color = t.textoSuave)
            }
        }
    }
}

@Composable
private fun LinhaCanal(a: Aparelho, c: Canal, agora: Instant, controlavel: Boolean, acoes: Acoes) {
    val t = LocalTerra.current
    // Canal sem nome próprio: o nome do aparelho já está no cabeçalho do cartão, mostra-se a função.
    val nome = if (!c.temNome) Funcao.rotulo(c.funcao) else c.nome
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IlustracaoCanal(c)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(nome, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                subtitulo(c, agora)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall.numeros, color = t.textoSuave)
                }
            }
            when (c.funcao) {
                Funcao.INTERRUPTOR, Funcao.LUZ -> Switch(
                    checked = c.ligado == true,
                    onCheckedChange = { acoes.ligar(a, c.n, it) },
                    enabled = controlavel,
                    colors = coresInterruptor(),
                )
                Funcao.PORTA -> c.aberto?.let { Etiqueta(if (it) "Aberta" else "Fechada", if (it) t.argila else t.musgo) }
                Funcao.MOVIMENTO -> c.movimento?.let { Etiqueta(if (it) "Movimento" else "Sem movimento", if (it) t.argila else t.musgo) }
                Funcao.BATERIA -> c.bateria?.let {
                    Text("$it %", style = MaterialTheme.typography.titleMedium.numeros, color = if (it < 15) t.argila else t.texto)
                }
                Funcao.ESTORE -> c.posicao?.let { Text("$it %", style = MaterialTheme.typography.titleMedium.numeros) }
            }
        }
        if (c.funcao == Funcao.LUZ) {
            ControloDeslizante(
                valor = c.brilho ?: 100,
                ativo = controlavel,
                rotulo = "Brilho",
                aoMudar = { acoes.brilho(a, c.n, it) },
            )
        }
        if (c.funcao == Funcao.ESTORE) {
            ControloDeslizante(
                valor = c.posicao ?: 0,
                ativo = controlavel,
                rotulo = "Posição",
                aoMudar = { acoes.estore(a, c.n, it) },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                BotaoEstore("Abrir", controlavel, Modifier.weight(1f)) { acoes.moverEstore(a, c.n, Comandos.MovimentoEstore.ABRIR) }
                if (Comandos.podeParar(a)) {
                    BotaoEstore("Parar", controlavel, Modifier.weight(1f)) { acoes.moverEstore(a, c.n, Comandos.MovimentoEstore.PARAR) }
                }
                BotaoEstore("Fechar", controlavel, Modifier.weight(1f)) { acoes.moverEstore(a, c.n, Comandos.MovimentoEstore.FECHAR) }
            }
        }
    }
}

private fun subtitulo(c: Canal, agora: Instant): String? {
    val ha = Textos.tempoRelativo(c.ultimaMudanca, agora)
    return when (c.funcao) {
        Funcao.INTERRUPTOR -> when (c.ligado) {
            true -> "Ligado"
            false -> "Desligado"
            null -> "Estado desconhecido"
        }
        Funcao.LUZ -> when (c.ligado) {
            true -> "Acesa" + (c.brilho?.let { " · $it %" } ?: "")
            false -> "Apagada"
            null -> "Estado desconhecido"
        }
        Funcao.ESTORE -> when (c.estadoEstore) {
            "opening" -> "A abrir…"
            "closing" -> "A fechar…"
            else -> when (c.posicao) {
                null -> "Posição desconhecida"
                0 -> "Fechado"
                100 -> "Aberto"
                else -> "Entreaberto"
            }
        }
        Funcao.PORTA -> when (c.aberto) {
            null -> "Estado desconhecido"
            else -> (if (c.aberto) "Aberta" else "Fechada") + (ha?.let { " $it" } ?: "")
        }
        Funcao.MOVIMENTO -> when (c.movimento) {
            null -> "Estado desconhecido"
            else -> (if (c.movimento) "Movimento" else "Sem movimento") + (ha?.let { " $it" } ?: "")
        }
        Funcao.BATERIA -> when {
            c.bateria == null -> "Bateria desconhecida"
            c.bateria < 15 -> "Bateria fraca: troque a pilha"
            else -> "Bateria"
        }
        else -> null
    }
}

@Composable
fun coresInterruptor() = LocalTerra.current.let { t ->
    SwitchDefaults.colors(
        checkedThumbColor = t.creme,
        checkedTrackColor = t.musgo,
        checkedBorderColor = t.musgo,
        uncheckedThumbColor = t.creme,
        uncheckedTrackColor = t.borda,
        uncheckedBorderColor = t.borda,
    )
}

/**
 * Deslizador 0–100 que só envia o comando quando o dedo larga (não a cada movimento).
 * Enquanto não chega a confirmação do aparelho, mostra o valor escolhido.
 */
@Composable
private fun ControloDeslizante(valor: Int, ativo: Boolean, rotulo: String, aoMudar: (Int) -> Unit) {
    val t = LocalTerra.current
    var aArrastar by remember { mutableStateOf<Float?>(null) }
    // Valor pedido, mostrado até o aparelho responder (ou 8 s, se não responder).
    var pedido by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(valor) { pedido = null }
    LaunchedEffect(pedido) {
        if (pedido != null) {
            delay(8_000)
            pedido = null
        }
    }
    val mostrado = aArrastar ?: (pedido ?: valor).toFloat()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(rotulo, style = MaterialTheme.typography.bodySmall, color = t.textoSuave, modifier = Modifier.width(64.dp))
        Slider(
            value = mostrado,
            onValueChange = { aArrastar = it },
            onValueChangeFinished = {
                aArrastar?.let {
                    pedido = Math.round(it)
                    aoMudar(Math.round(it))
                }
                aArrastar = null
            },
            valueRange = 0f..100f,
            enabled = ativo,
            colors = SliderDefaults.colors(
                thumbColor = t.musgo,
                activeTrackColor = t.musgo,
                inactiveTrackColor = t.borda,
            ),
            modifier = Modifier.weight(1f),
        )
        Text("${Math.round(mostrado)} %", style = MaterialTheme.typography.bodySmall.numeros,
            modifier = Modifier.width(44.dp).padding(start = 6.dp))
    }
}

@Composable
private fun BotaoEstore(texto: String, ativo: Boolean, modifier: Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = ativo, shape = FormaPilula, modifier = modifier) { Text(texto, maxLines = 1) }
}
