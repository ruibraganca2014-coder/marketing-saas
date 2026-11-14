package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.ConfigAparelho
import pt.domusenergia.app.data.ConfigCanal
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.data.Organizar
import pt.domusenergia.app.data.PersCanal
import pt.domusenergia.app.data.Personalizacao
import pt.domusenergia.app.ui.tema.LocalTerra

/**
 * "Os meus aparelhos" (decisões do dono, 2026-11-10; docs/APP-CLIENTE.md), igual a `web/organizar.js`: o cliente muda o
 * nome de cada mosaico, a divisão de cada aparelho e esconde mosaicos da Casa. Vale em todos os planos.
 */
@Composable
fun OrganizarScreen(state: UiState, acoes: Acoes) {
    val e = state.estado
    val cfg = e.configEfetiva
    val lista = e.lista.orEmpty()
    var aberto by rememberSaveable { mutableStateOf<String?>(null) }
    val divisoes = remember(lista, cfg.personalizar) {
        (lista.mapNotNull { it.divisao } + lista.flatMap { a -> a.canais.mapNotNull { it.divisao } } + cfg.personalizar.values.mapNotNull { it.divisao })
            .distinct().sortedBy { it.lowercase() }
    }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(key = "_topo") {
            Ajuda("Mude o nome de cada mosaico e a divisão de cada aparelho, ou esconda o que não usa no dia a dia. Os nomes do quadro elétrico não mudam.")
        }
        if (lista.isEmpty()) item(key = "_vazio") { Ajuda("Os seus aparelhos aparecem aqui depois da instalação.") }
        items(lista, key = { it.id }) { a ->
            val p = cfg.personalizar[a.id]
            val v = Organizar.aplicar(a, p)
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        v.canais.forEach { c ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(rotulo(v, c), style = MaterialTheme.typography.bodyLarge)
                                if (c.escondido) Etiqueta("Escondido", LocalTerra.current.areia)
                            }
                        }
                        val sub = listOfNotNull(v.divisao ?: "Sem divisão", if (p != null) "No quadro: ${a.nome}${a.divisao?.let { ", $it" } ?: ""}" else null)
                        Ajuda(sub.joinToString(" · "))
                    }
                    TextButton(onClick = { aberto = if (aberto == a.id) null else a.id }) { Text(if (aberto == a.id) "Fechar" else "Alterar") }
                }
                if (aberto == a.id) {
                    Editor(a, p, divisoes, state.ligado && !state.aGuardar, state.aGuardar,
                        onGuardar = { div, canais ->
                            acoes.guardarConfig(cfg, cfg.copy(personalizar = Organizar.mudar(cfg.personalizar, a, div, canais))) { aberto = null }
                        },
                    )
                }
            }
        }
    }
}

/** Como no mosaico da Casa: um só canal → o nome do aparelho; vários → o do canal ou a função. */
private fun rotulo(a: ConfigAparelho, c: ConfigCanal): String =
    if (a.canais.size == 1) a.nome else if (c.temNome) c.nome else "${a.nome} · ${Funcao.rotulo(c.funcao)}"

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Editor(
    a: ConfigAparelho,
    p: Personalizacao?,
    divisoes: List<String>,
    pode: Boolean,
    aGuardar: Boolean,
    onGuardar: (String, Map<Int, PersCanal>) -> Unit,
) {
    var divisao by rememberSaveable(a.id) { mutableStateOf(p?.divisao ?: a.divisao ?: "") }
    val nomes = remember(a.id) { mutableStateMapOf<Int, String>().apply { a.canais.forEach { put(it.n, p?.canais?.get(it.n)?.nome ?: "") } } }
    val escondidos = remember(a.id) { mutableStateMapOf<Int, Boolean>().apply { a.canais.forEach { put(it.n, p?.canais?.get(it.n)?.escondido == true) } } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Campo(divisao, { divisao = it.take(Organizar.MAX_DIVISAO) }, "Divisão", apoio = "Escolha abaixo ou escreva uma divisão nova.")
        if (divisoes.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            divisoes.forEach { d -> Escolha(d, divisao.trim() == d) { divisao = d } }
        }
        a.canais.forEach { c ->
            val tecnico = rotulo(a, c)
            if (a.canais.size > 1) Titulo("Canal ${c.n}: $tecnico")
            Campo(nomes[c.n].orEmpty(), { nomes[c.n] = it.take(Organizar.MAX_NOME) }, "Nome", apoio = "Vazio fica o nome do quadro: $tecnico.")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Esconder da Casa", Modifier.weight(1f))
                Switch(escondidos[c.n] == true, { escondidos[c.n] = it })
            }
        }
        Ajuda("Um aparelho escondido continua a funcionar, nas automações, nos avisos e aqui.")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BotaoPilula(if (aGuardar) "A guardar…" else "Guardar", onClick = {
                onGuardar(divisao, a.canais.associate { it.n to PersCanal(nomes[it.n], escondidos[it.n] == true) })
            }, enabled = pode)
            if (p != null) TextButton(onClick = { onGuardar("", emptyMap()) }, enabled = pode) { Text("Repor o original") }
        }
    }
}
