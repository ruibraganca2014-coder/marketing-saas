package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.AvisoConflito
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Modelos
import pt.domusenergia.app.data.Quando
import pt.domusenergia.app.data.Rascunho
import pt.domusenergia.app.data.Registo
import pt.domusenergia.app.data.Textos
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.LocalVoltar
import pt.domusenergia.app.ui.tema.Terra
import java.time.Instant

/**
 * Lista de automações (retida em `_automacoes`), com o registo de cada uma (`_automacoes/registo`),
 * os avisos de conflito (`_automacoes/avisos`), "Testar agora"/"Avaliar agora" e o assistente de criação.
 * Cada alteração publica a lista COMPLETA em `_automacoes/set`; o motor aceita (republica `_automacoes`)
 * ou recusa com um evento `erro`, que aparece aqui.
 *
 * @param editarInicial abre logo o assistente (só para os desenhos de teste).
 */
@Composable
fun AutomacoesScreen(state: UiState, acoes: Acoes, editarInicial: Rascunho? = null, passoInicial: Int = 0) {
    val estado = state.estado
    val lista = estado.automacoes
    val aparelhos = estado.aparelhos
    val cenas = estado.cenas.orEmpty()
    // null = lista; Rascunho = assistente aberto
    var editar by remember { mutableStateOf(editarInicial) }
    var apagar by remember { mutableStateOf<Automacao?>(null) }
    val agora = agoraAtual()

    val r = editar
    if (r != null && lista != null) {
        LocalVoltar.current(true) { editar = null }
        val ctx = remember(aparelhos, cenas, estado.config) { ContextoEditor(aparelhos, cenas, estado.config) }
        Assistente(
            inicial = r,
            ctx = ctx,
            existentes = lista,
            modelos = if (r.idOriginal == null) Modelos.todos(aparelhos, cenas) else emptyList(),
            aGuardar = state.aGuardar,
            podeGuardar = state.ligado,
            podeTestar = r.idOriginal != null && lista.any { it.id == r.idOriginal },
            erroServidor = estado.ultimoErro?.let { "${it.titulo}: ${it.mensagem}" },
            onCancelar = { editar = null; acoes.limparErroAutomacoes() },
            onGuardar = { nova -> acoes.guardarAutomacoes(Automacoes.guardar(lista, nova, r.idOriginal)) { editar = null } },
            onTestar = acoes::testarAutomacao,
            passoInicial = passoInicial,
        )
        return
    }

    Box(Modifier.fillMaxSize()) {
        when {
            lista == null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator(color = LocalTerra.current.musgo)
            }
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                estado.ultimoErro?.let { e ->
                    item(key = "_erro") { AvisoErro("${e.titulo}: ${e.mensagem}", acoes::limparErroAutomacoes) }
                }
                if (estado.avisos.isNotEmpty()) {
                    item(key = "_conflitos") { AvisosConflito(estado.avisos, lista) }
                }
                if (lista.isEmpty()) {
                    item(key = "_vazio") {
                        Text(
                            "Ainda não tem automações. Crie uma a partir de um modelo, por exemplo: acender a luz do corredor quando houver movimento à noite.",
                            color = LocalTerra.current.textoSuave,
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                }
                items(lista, key = { it.id }) { a ->
                    CartaoAutomacao(
                        a = a,
                        aparelhos = aparelhos,
                        cenas = cenas,
                        registo = estado.registo[a.id],
                        conflito = estado.avisos.any { a.id in it.ids },
                        agora = agora,
                        ativo = state.ligado && !state.aGuardar,
                        onAtiva = { v -> acoes.guardarAutomacoes(Automacoes.comAtiva(lista, a.id, v)) {} },
                        onEditar = { editar = Rascunho.de(a) },
                        onApagar = { apagar = a },
                        onExecutar = { acoes.executarAutomacao(a.id) },
                        onTestar = { acoes.testarAutomacao(a.id) },
                        onAvaliar = { acoes.avaliarAutomacao(a.id) },
                    )
                }
            }
        }
        if (lista != null && lista.size < Automacoes.MAX_AUTOMACOES) {
            BotaoPilula(
                "Nova automação",
                onClick = { acoes.limparErroAutomacoes(); editar = Rascunho() },
                enabled = state.ligado && !state.aGuardar,
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            )
        }
    }

    apagar?.let { a ->
        AlertDialog(
            onDismissRequest = { apagar = null },
            title = { Text("Apagar automação?") },
            text = { Text("\"${a.nome}\" deixa de funcionar.") },
            confirmButton = {
                TextButton(onClick = {
                    apagar = null
                    lista?.let { acoes.guardarAutomacoes(Automacoes.remover(it, a.id)) {} }
                }) { Text("Apagar", color = LocalTerra.current.alarme) }
            },
            dismissButton = { TextButton(onClick = { apagar = null }) { Text("Cancelar") } },
        )
    }
}

@Composable
fun AvisoErro(texto: String, onFechar: () -> Unit) {
    val t = LocalTerra.current
    Cartao(destaque = t.alarme) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(texto, color = t.alarme, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onFechar) { Icon(Icons.Filled.Close, contentDescription = "Fechar") }
        }
    }
}

@Composable
private fun AvisosConflito(avisos: List<AvisoConflito>, lista: List<Automacao>) {
    val t = LocalTerra.current
    Cartao(destaque = t.areia) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = t.argila, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Titulo("Automações em conflito")
        }
        avisos.forEach { a ->
            val nomes = a.ids.map { id -> lista.firstOrNull { it.id == id }?.nome ?: id }
            Text("• ${a.mensagem}", style = MaterialTheme.typography.bodyMedium)
            if (nomes.isNotEmpty()) Ajuda("  " + nomes.joinToString(" e "))
        }
        Ajuda("Continuam guardadas, mas podem desfazer-se uma à outra.")
    }
}

/** Cor de cada resultado do registo. */
private fun corResultado(t: Terra, r: String?, ok: Boolean? = null): Color = when (r) {
    Registo.AVALIACAO -> if (ok == false) t.argila else t.musgo
    Registo.EXECUTADA, Registo.TESTE -> t.musgo
    Registo.FALHOU -> t.alarme
    Registo.PAUSADA, Registo.CONDICAO_FALSA -> t.argila
    else -> t.textoSuave
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CartaoAutomacao(
    a: Automacao,
    aparelhos: List<Aparelho>,
    cenas: List<Cena>,
    registo: Registo?,
    conflito: Boolean,
    agora: Instant,
    ativo: Boolean,
    onAtiva: (Boolean) -> Unit,
    onEditar: () -> Unit,
    onApagar: () -> Unit,
    onExecutar: () -> Unit,
    onTestar: () -> Unit,
    onAvaliar: () -> Unit,
) {
    val t = LocalTerra.current
    var verRegisto by remember { mutableStateOf(false) }
    Cartao(destaque = if (conflito) t.areia else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(a.nome, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (a.bloqueada) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Lock, contentDescription = null, tint = t.textoSuave, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Ajuda("Criada pela Domus Energia")
                    }
                }
            }
            Switch(checked = a.ativa, onCheckedChange = onAtiva, enabled = ativo, colors = coresInterruptor())
        }
        a.descricao?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium, color = t.texto) }
        Text(Automacoes.descrever(a, aparelhos, cenas), style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (conflito) Etiqueta("Conflito", t.argila)
            if (registo?.resultado == Registo.PAUSADA) Etiqueta("Em pausa", t.argila)
            if (!a.ativa) Etiqueta("Desativada", t.textoSuave)
        }

        // ---- Registo: última execução, resultado, motivo
        HorizontalDivider(color = t.borda)
        if (registo == null || registo.ultima == null) {
            Ajuda("Nunca executada." + if (a.quando == Quando.Manual) " Carregue em \"Executar\"." else "")
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Última: ${Textos.quando(registo.ultima, agora)} · ",
                    style = MaterialTheme.typography.bodySmall,
                    color = t.textoSuave,
                )
                Text(
                    Registo.rotulo(registo.resultado, registo.ok),
                    style = MaterialTheme.typography.labelMedium,
                    color = corResultado(t, registo.resultado, registo.ok),
                )
                registo.semana?.let { Ajuda(" · $it esta semana") }
            }
            registo.motivo?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = corResultado(t, registo.resultado, registo.ok)) }
            if (registo.ultimos.isNotEmpty()) {
                TextButton(onClick = { verRegisto = !verRegisto }, contentPadding = PaddingValues(0.dp)) {
                    Text(if (verRegisto) "Esconder registo" else "Ver registo (${registo.ultimos.size})", color = t.musgo)
                }
                if (verRegisto) {
                    registo.ultimos.forEach { e ->
                        Row {
                            Text(
                                (e.ts?.let { Textos.quando(it, agora) } ?: "—") + "  ",
                                style = MaterialTheme.typography.bodySmall,
                                color = t.textoSuave,
                            )
                            Text(
                                Registo.rotulo(e.resultado, e.ok) + (e.motivo?.let { " — $it" } ?: ""),
                                style = MaterialTheme.typography.bodySmall,
                                color = corResultado(t, e.resultado, e.ok),
                            )
                        }
                    }
                }
            }
        }

        // ---- Botões
        FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (a.quando == Quando.Manual) {
                TextButton(onClick = onExecutar, enabled = ativo && a.ativa) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Executar")
                }
            }
            // "Testar agora": executa as ações já, sem esperar pelo gatilho nem ver as condições.
            TextButton(onClick = onTestar, enabled = ativo) {
                if (a.quando != Quando.Manual) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text("Testar agora")
            }
            // "Avaliar agora": diz se as condições são verdadeiras neste momento, sem executar.
            TextButton(onClick = onAvaliar, enabled = ativo) {
                Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Avaliar agora")
            }
            if (a.editavel) {
                TextButton(onClick = onEditar, enabled = ativo) {
                    Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Editar")
                }
            }
            if (!a.bloqueada) {
                TextButton(onClick = onApagar, enabled = ativo) {
                    Icon(Icons.Filled.Delete, contentDescription = null, modifier = Modifier.size(18.dp), tint = t.alarme)
                    Spacer(Modifier.width(4.dp))
                    Text("Apagar", color = t.alarme)
                }
            }
        }
    }
}
