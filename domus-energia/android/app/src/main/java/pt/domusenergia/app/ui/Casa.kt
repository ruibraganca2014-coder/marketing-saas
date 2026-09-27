package pt.domusenergia.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import pt.domusenergia.app.data.Alarme
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Canal
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.ConfigCasa
import pt.domusenergia.app.data.EmEspera
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.data.Modos
import pt.domusenergia.app.data.Relatorio
import pt.domusenergia.app.data.SaudeCasa
import pt.domusenergia.app.data.Resumo
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.FormaCartao
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
fun CasaScreen(state: UiState, resumo: Resumo, acoes: Acoes, onAbrir: (Secundario) -> Unit = {}) {
    val agora = agoraAtual()
    val estado = state.estado
    val limiar = estado.configEfetiva.limiarEsperaW
    val atencao = remember(estado.aparelhos, estado.saude, agora) {
        SaudeCasa.linhas(estado.aparelhos, estado.saude, agora).count { it.atencao }
    }
    val grupos = remember(estado.aparelhos) { porDivisao(estado.aparelhos) }
    when {
        !estado.listaRecebida -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(color = LocalTerra.current.musgo)
        }
        else -> LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "_modos") { CartaoModos(state, acoes) }
            estado.cenas?.let { cenas ->
                item(key = "_cenas") { LinhaCenas(cenas, state.ligado, acoes::executarCena) { onAbrir(Secundario.CENAS) } }
            }
            if (atencao > 0) item(key = "_saude") { AvisoSaude(atencao) { onAbrir(Secundario.SAUDE) } }
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
            // Agrupados por divisão (só se alguma tiver divisão; "Outros" no fim).
            for ((divisao, lista) in grupos) {
                if (divisao != null) {
                    item(key = "_div_$divisao") {
                        Text(
                            divisao,
                            style = MaterialTheme.typography.titleMedium,
                            color = LocalTerra.current.textoSuave,
                            modifier = Modifier.padding(start = 4.dp, top = 6.dp),
                        )
                    }
                }
                items(lista, key = { it.id }) { a -> CartaoAparelho(a, agora, state.ligado, acoes, limiar) }
            }
        }
    }
}

/** Aparelhos agrupados por divisão, por ordem alfabética; sem divisões → um só grupo sem título. */
fun porDivisao(aparelhos: List<Aparelho>): List<Pair<String?, List<Aparelho>>> {
    if (aparelhos.none { it.divisaoMostrada != null }) return listOf(null to aparelhos)
    return aparelhos.groupBy { it.divisaoMostrada ?: Relatorio.SEM_DIVISAO }
        .entries.sortedWith(compareBy({ it.key == Relatorio.SEM_DIVISAO }, { it.key.lowercase() }))
        .map { it.key to it.value }
}

/** "Agora" a cada segundo (só enquanto [ativo]), para as contagens do alarme. */
@Composable
private fun agoraAoSegundo(ativo: Boolean): Instant {
    val agora by produceState(Instant.now(), ativo) {
        value = Instant.now()
        while (ativo) {
            delay(1_000)
            value = Instant.now()
        }
    }
    return agora
}

/**
 * Modos da casa (Casa/Fora/Noite/Férias) em vez do cartão do alarme, com o estado do alarme por baixo:
 * contagem de saída, "Desarme o alarme" (entrada), disparado, ignorados e o "Não armado: …" com
 * "Armar mesmo assim". Com um motor v2 (sem `_modo`) só há Casa/Fora (= `_alarme/set`).
 */
@Composable
fun CartaoModos(state: UiState, acoes: Acoes) {
    val t = LocalTerra.current
    val estado = state.estado
    val alarme = estado.alarme
    val v3 = estado.modo != null
    val modoAtual = estado.modo?.modo ?: when (alarme?.ativo) {
        true -> Modos.FORA
        false -> Modos.CASA
        null -> null
    }
    val est = alarme?.estadoEfetivo
    val contar = est == Alarme.A_ARMAR || est == Alarme.ENTRADA
    val agora = agoraAoSegundo(contar)
    val restante = alarme?.segundosAte(agora)
    val recusa = estado.ultimoErro?.takeIf { state.modoPedido != null && it.mensagem.startsWith("Não armado") }
    val urgente = est == Alarme.DISPARADO || est == Alarme.ENTRADA
    val pode = state.ligado && alarme != null

    fun escolher(m: String) {
        if (v3) acoes.modo(m) else acoes.alarme(m != Modos.CASA)
    }

    Cartao(destaque = if (urgente) t.alarme else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Modo da casa", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            estado.modo?.desde?.let {
                Text("desde ${Textos.quando(it, agora)}", style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
            }
        }
        Segmentado(
            opcoes = if (v3 || alarme == null) Modos.TODOS else listOf(Modos.CASA, Modos.FORA),
            atual = modoAtual,
            pedido = state.modoPedido,
            ativo = pode,
            onEscolher = ::escolher,
        )
        when {
            recusa != null -> {
                Text(recusa.mensagem, color = t.alarme, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    BotaoPilula("Armar mesmo assim", onClick = { acoes.modo(state.modoPedido!!, forcar = true) }, enabled = pode, cor = t.argila)
                    TextButton(onClick = acoes::cancelarModo) { Text("Cancelar", color = t.textoSuave) }
                }
            }
            alarme == null -> Text("A aguardar o estado do alarme…", style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
            est == Alarme.DISPARADO -> {
                Text("Alarme disparado!", style = MaterialTheme.typography.headlineSmall, color = t.alarme)
                Text("Desde ${alarme.desde?.let { Textos.quando(it, agora) } ?: "agora"}. Veja o Histórico para saber o que o disparou.",
                    style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                BotaoPilula("Desarmar", onClick = { escolher(Modos.CASA) }, enabled = pode, cor = t.alarme)
            }
            est == Alarme.ENTRADA -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Desarme o alarme", style = MaterialTheme.typography.headlineSmall, color = t.alarme, modifier = Modifier.weight(1f))
                    restante?.let { Text(Textos.contagem(it), style = MaterialTheme.typography.headlineSmall.numeros, color = t.alarme) }
                }
                Text("Abriram uma porta de entrada. Se não desarmar a tempo, o alarme dispara.",
                    style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                BotaoPilula("Desarmar agora", onClick = { escolher(Modos.CASA) }, enabled = pode, cor = t.alarme)
            }
            est == Alarme.A_ARMAR -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("A armar… saia de casa", style = MaterialTheme.typography.titleMedium, color = t.argila, modifier = Modifier.weight(1f))
                    restante?.let { Text(Textos.contagem(it), style = MaterialTheme.typography.titleLarge.numeros, color = t.argila) }
                }
                Text(descricaoTipo(alarme.tipo), style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                Ignorados(alarme, estado.aparelhos)
            }
            est == Alarme.ARMADO -> {
                Text("Alarme armado", style = MaterialTheme.typography.titleMedium, color = t.musgo)
                Text(descricaoTipo(alarme.tipo), style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                Ignorados(alarme, estado.aparelhos)
            }
            else -> Text(
                if (modoAtual == Modos.CASA || modoAtual == null) "Alarme desarmado. Escolha Fora ao sair ou Noite ao deitar."
                else "Alarme desarmado.",
                style = MaterialTheme.typography.bodySmall,
                color = t.textoSuave,
            )
        }
    }
}

private fun descricaoTipo(tipo: String?): String = when (tipo) {
    Alarme.PERIMETRO -> "Só portas e janelas (o movimento não dispara)."
    Alarme.TOTAL -> "Portas, janelas e movimento."
    else -> "Portas e movimento avisam-no."
}

@Composable
private fun Ignorados(alarme: Alarme, aparelhos: List<Aparelho>) {
    if (alarme.ignorados.isEmpty()) return
    val t = LocalTerra.current
    Text(
        "Ignorados (estavam abertos): " + alarme.ignorados.joinToString(", ") { Automacoes.nomeCanal(aparelhos, it.aparelho, it.canal) },
        style = MaterialTheme.typography.bodySmall,
        color = t.argila,
    )
}

/** Controlo segmentado em pílula (tema Terra). [pedido] mostra-se a meio tom enquanto o motor não confirma. */
@Composable
fun Segmentado(opcoes: List<String>, atual: String?, pedido: String?, ativo: Boolean, onEscolher: (String) -> Unit) {
    val t = LocalTerra.current
    Surface(shape = FormaPilula, color = t.musgoClaro, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (m in opcoes) {
                val sel = m == atual
                val espera = m == pedido && !sel
                Surface(
                    shape = FormaPilula,
                    color = when {
                        sel -> t.musgo
                        espera -> t.musgo.copy(alpha = 0.35f)
                        else -> Color.Transparent
                    },
                    contentColor = if (sel) t.creme else t.texto,
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp)
                        .clip(FormaPilula)
                        .clickable(enabled = ativo && !sel) { onEscolher(m) }
                        .semantics { contentDescription = "Modo ${Modos.rotulo(m)}" + if (sel) ", atual" else "" },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(Modos.rotulo(m), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Fila de cenas (toque = executar) e acesso à gestão. */
@Composable
fun LinhaCenas(cenas: List<Cena>, ativo: Boolean, onExecutar: (String) -> Unit, onGerir: () -> Unit) {
    val t = LocalTerra.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cenas", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).padding(start = 4.dp))
            TextButton(onClick = onGerir) { Text(if (cenas.isEmpty()) "Criar" else "Gerir", color = t.musgo) }
        }
        if (cenas.isEmpty()) {
            Text("Uma cena faz várias coisas de uma vez (ex.: \"Noite de cinema\").", style = MaterialTheme.typography.bodySmall,
                color = t.textoSuave, modifier = Modifier.padding(start = 4.dp))
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(cenas, key = { it.id }) { c ->
                    Surface(
                        shape = FormaCartao,
                        color = t.superficie,
                        border = BorderStroke(1.dp, t.borda),
                        modifier = Modifier.width(112.dp).clip(FormaCartao).clickable(enabled = ativo) { onExecutar(c.id) }
                            .semantics { contentDescription = "Executar cena ${c.nome}" },
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Surface(shape = FormaPilula, color = t.musgoClaro) {
                                IconeCena(c.icone, t.musgo, Modifier.padding(6.dp), 22.dp)
                            }
                            Text(c.nome, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AvisoSaude(n: Int, onAbrir: () -> Unit) {
    val t = LocalTerra.current
    Surface(
        shape = FormaCartao,
        color = t.areia.copy(alpha = 0.18f),
        modifier = Modifier.fillMaxWidth().clip(FormaCartao).clickable(onClick = onAbrir),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = t.argila, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                if (n == 1) "1 aparelho precisa de atenção" else "$n aparelhos precisam de atenção",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Text("Ver", color = t.musgo, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun CartaoResumo(r: Resumo) {
    Cartao {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Numero(if (r.temMedidor) Textos.potencia(r.potenciaW) else "—", "Potência agora", Modifier.weight(1f))
            Numero(r.hojeKWh?.let { Textos.kwh(it) } ?: "—", "Gasto hoje", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Numero(
                "${r.ligados}/${r.circuitos}",
                if (r.emEspera > 0) "Ligados · ${r.emEspera} em espera" else "Ligados",
                Modifier.weight(1f),
            )
            Numero(if (r.portas == 0) "—" else "${r.portasAbertas}/${r.portas}", "Portas abertas", Modifier.weight(1f))
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
fun CartaoAparelho(a: Aparelho, agora: Instant, ligado: Boolean, acoes: Acoes, limiarEsperaW: Double = ConfigCasa.PADRAO.limiarEsperaW) {
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
            LinhaCanal(a, c, agora, controlavel, acoes, EmEspera.canal(a, c, limiarEsperaW))
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
private fun LinhaCanal(a: Aparelho, c: Canal, agora: Instant, controlavel: Boolean, acoes: Acoes, emEspera: Boolean = false) {
    val t = LocalTerra.current
    // Canal sem nome próprio: o nome do aparelho já está no cabeçalho do cartão, mostra-se a função.
    val nome = if (!c.temNome) Funcao.rotulo(c.funcao) else c.nome
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IlustracaoCanal(c)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(nome, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = if (emEspera) "Em espera" + (a.potenciaW?.let { " · ${Textos.potencia(it)}" } ?: "") else subtitulo(c, agora)
                sub?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall.numeros, color = if (emEspera) t.argila else t.textoSuave)
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
