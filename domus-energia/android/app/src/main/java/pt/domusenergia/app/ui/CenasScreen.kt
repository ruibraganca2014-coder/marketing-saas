package pt.domusenergia.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Riscos
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Cenas
import pt.domusenergia.app.data.RascunhoAcao
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.LocalVoltar

/**
 * Cenas (`_cenas`, retido): executar, criar, editar e apagar. As da empresa (cadeado) só se executam.
 * Guardar publica a lista COMPLETA em `_cenas/set`.
 */
@Composable
fun CenasScreen(state: UiState, acoes: Acoes, editarInicial: Cena? = null) {
    val t = LocalTerra.current
    val estado = state.estado
    val lista = estado.cenas
    var editar by remember { mutableStateOf(editarInicial) }
    var novaId by remember { mutableStateOf<String?>(null) } // id original da cena em edição (null = nova)
    var apagar by remember { mutableStateOf<Cena?>(null) }
    val executar = executarComConfirmacao(estado.aparelhos, acoes)

    val e = editar
    if (e != null && lista != null) {
        LocalVoltar.current(true) { editar = null }
        EditorCena(
            inicial = e,
            nova = novaId == null,
            ctx = remember(estado.aparelhos, estado.config) { ContextoEditor(estado.aparelhos, emptyList(), estado.config) },
            aGuardar = state.aGuardar,
            podeGuardar = state.ligado,
            erroServidor = estado.ultimoErro?.let { "${it.titulo}: ${it.mensagem}" },
            existentes = lista,
            onCancelar = { editar = null; acoes.limparErroAutomacoes() },
            onGuardar = { c -> acoes.guardarCenas(Cenas.guardar(lista, c, novaId)) { editar = null } },
        )
        return
    }

    Box(Modifier.fillMaxSize()) {
        if (lista == null) {
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = t.musgo)
                Spacer(Modifier.height(12.dp))
                Ajuda("A aguardar as cenas do servidor…")
            }
            return@Box
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            estado.ultimoErro?.let { er -> item(key = "_erro") { AvisoErro("${er.titulo}: ${er.mensagem}", acoes::limparErroAutomacoes) } }
            if (lista.isEmpty()) {
                item(key = "_vazio") {
                    Ajuda("Ainda não tem cenas. Uma cena faz várias coisas de uma vez: por exemplo \"Noite de cinema\" (sala a 20 %, estores em baixo).",
                        Modifier.padding(8.dp))
                }
            }
            items(lista, key = { it.id }) { c ->
                Cartao {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = FormaPilula, color = t.musgoClaro) { IconeCena(c.icone, t.musgo, Modifier.padding(8.dp), 24.dp) }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.nome, style = MaterialTheme.typography.titleMedium)
                            if (c.bloqueada) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.Lock, contentDescription = null, tint = t.textoSuave, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Ajuda("Criada pela Domus Energia")
                                }
                            }
                        }
                        BotaoPilula("Executar", onClick = { executar(c) }, enabled = state.ligado)
                    }
                    Ajuda(c.acoes.joinToString("; ") { Automacoes.descreverAcao(it, estado.aparelhos) }.ifEmpty { "Sem ações." })
                    if (!c.bloqueada) {
                        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.padding(top = 0.dp)) {
                            Spacer(Modifier.weight(1f))
                            if (c.editavel) {
                                TextButton(onClick = { novaId = c.id; editar = c }, enabled = state.ligado && !state.aGuardar) {
                                    Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Editar")
                                }
                            }
                            TextButton(onClick = { apagar = c }, enabled = state.ligado && !state.aGuardar) {
                                Icon(Icons.Filled.Delete, contentDescription = null, modifier = Modifier.size(18.dp), tint = t.alarme)
                                Spacer(Modifier.width(6.dp))
                                Text("Apagar", color = t.alarme)
                            }
                        }
                    }
                }
            }
        }
        if (lista.size < Cenas.MAX_CENAS) {
            BotaoPilula(
                "Nova cena",
                onClick = { acoes.limparErroAutomacoes(); novaId = null; editar = Cena("", "", acoes = listOf()) },
                enabled = state.ligado && !state.aGuardar,
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            )
        }
    }

    apagar?.let { c ->
        AlertDialog(
            onDismissRequest = { apagar = null },
            title = { Text("Apagar cena?") },
            text = { Text("\"${c.nome}\" deixa de existir. As automações que a usam passam a dar erro.") },
            confirmButton = {
                TextButton(onClick = { apagar = null; lista?.let { acoes.guardarCenas(Cenas.remover(it, c.id)) {} } }) {
                    Text("Apagar", color = t.alarme)
                }
            },
            dismissButton = { TextButton(onClick = { apagar = null }) { Text("Cancelar") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EditorCena(
    inicial: Cena,
    nova: Boolean,
    ctx: ContextoEditor,
    aGuardar: Boolean,
    podeGuardar: Boolean,
    erroServidor: String?,
    existentes: List<Cena>,
    onCancelar: () -> Unit,
    onGuardar: (Cena) -> Unit,
) {
    val t = LocalTerra.current
    var nome by remember(inicial) { mutableStateOf(inicial.nome) }
    var icone by remember(inicial) { mutableStateOf(inicial.icone) }
    var acoesR by remember(inicial) {
        mutableStateOf(inicial.acoes.map { RascunhoAcao.de(it) }.ifEmpty { listOf(RascunhoAcao()) })
    }
    var tentou by remember { mutableStateOf(false) }
    var confirmar by remember { mutableStateOf<List<String>?>(null) }
    val id = if (nova) Automacoes.slug(nome, existentes.map { it.id }) else inicial.id
    val cena = Cena(id, nome.trim(), icone, false, acoesR.map { it.paraAcao() })
    val erros = Cenas.validar(cena, ctx.aparelhos) + Cenas.validarLista(Cenas.guardar(existentes, cena, if (nova) null else inicial.id))

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (nova) "Nova cena" else "Editar cena", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            IconButton(onClick = onCancelar) { Icon(Icons.Filled.Close, contentDescription = "Cancelar") }
        }
        Cartao {
            Campo(nome, { nome = it.take(Automacoes.MAX_NOME) }, "Nome da cena", apoio = "${nome.length}/${Automacoes.MAX_NOME}")
            Titulo("Ícone")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Cenas.ICONES.forEach { i ->
                    val sel = i == icone
                    Surface(
                        shape = FormaPilula,
                        color = if (sel) t.musgo else t.musgoClaro,
                        border = if (sel) null else BorderStroke(1.dp, t.borda),
                        modifier = Modifier.clip(FormaPilula).clickable { icone = i }.semantics { contentDescription = "Ícone $i" },
                    ) { IconeCena(i, if (sel) t.creme else t.musgo, Modifier.padding(10.dp), 24.dp) }
                }
            }
        }
        Cartao {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Titulo("Faz, por esta ordem", Modifier.weight(1f))
                Ajuda("${acoesR.size} de ${Automacoes.MAX_ACOES}")
            }
            Ajuda("Uma cena não pode ter SE/SENÃO nem executar outras cenas.")
            ListaAcoes(acoesR, { acoesR = it }, RascunhoAcao.DE_CENA, ctx, nivel = 0, podeMais = { acoesR.size + it <= Automacoes.MAX_ACOES })
        }
        if (tentou && erros.isNotEmpty()) {
            Cartao(destaque = t.alarme) { erros.forEach { Text("• $it", color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
        }
        erroServidor?.let { Cartao(destaque = t.alarme) { Text(it, color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BotaoPilula(if (aGuardar) "A guardar…" else "Guardar", onClick = {
                tentou = true
                if (erros.isEmpty()) {
                    val riscos = Riscos.descrever(cena.acoes, ctx.aparelhos)
                    if (riscos.isEmpty()) onGuardar(cena) else confirmar = riscos
                }
            }, enabled = podeGuardar && !aGuardar)
            TextButton(onClick = onCancelar) { Text("Cancelar") }
            if (aGuardar) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = t.musgo)
        }
        Spacer(Modifier.height(24.dp))
    }
    confirmar?.let { linhas ->
        ConfirmarRisco(
            titulo = "Guardar esta cena?",
            explicacao = "Esta cena vai mexer em circuitos importantes:",
            linhas = linhas,
            sim = "Sim, guardar assim",
            nao = "Voltar e alterar",
            onSim = { confirmar = null; onGuardar(cena) },
            onNao = { confirmar = null },
        )
    }
}

/**
 * Executar uma cena, pedindo confirmação se ela mexer no disjuntor geral ou numa carga perigosa.
 * Devolve a função a chamar com a cena (o diálogo fica na composição de quem a chama).
 */
@Composable
fun executarComConfirmacao(aparelhos: List<Aparelho>, acoes: Acoes): (Cena) -> Unit {
    var pendente by remember { mutableStateOf<Pair<Cena, List<String>>?>(null) }
    pendente?.let { (c, linhas) ->
        ConfirmarRisco(
            titulo = "Executar \"${c.nome}\"?",
            explicacao = "Esta cena vai:",
            linhas = linhas,
            sim = "Sim, executar",
            nao = "Cancelar",
            onSim = { pendente = null; acoes.executarCena(c.id) },
            onNao = { pendente = null },
        )
    }
    return { c ->
        val riscos = Riscos.descrever(c.acoes, aparelhos)
        if (riscos.isEmpty()) acoes.executarCena(c.id) else pendente = c to riscos
    }
}
