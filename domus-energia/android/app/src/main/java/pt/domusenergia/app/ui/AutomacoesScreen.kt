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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Alvo
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.data.Rascunho
import pt.domusenergia.app.data.RascunhoAcao
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.LocalVoltar

/**
 * Lista de automações (retida em `_automacoes`) e formulário para criar/editar.
 * Cada alteração publica a lista COMPLETA em `_automacoes/set`; o motor aceita (republica `_automacoes`)
 * ou recusa com um evento `erro`, que aparece aqui.
 */
@Composable
fun AutomacoesScreen(state: UiState, acoes: Acoes) {
    val estado = state.estado
    val lista = estado.automacoes
    val aparelhos = estado.aparelhos
    // null = lista; Rascunho = formulário aberto
    var editar by remember { mutableStateOf<Rascunho?>(null) }
    var apagar by remember { mutableStateOf<Automacao?>(null) }

    val r = editar
    if (r != null && lista != null) {
        LocalVoltar.current(true) { editar = null }
        EditorAutomacao(
            inicial = r,
            aparelhos = aparelhos,
            aGuardar = state.aGuardar,
            podeGuardar = state.ligado,
            erroServidor = estado.ultimoErro?.let { "${it.titulo}: ${it.mensagem}" },
            existentes = lista,
            onCancelar = { editar = null; acoes.limparErroAutomacoes() },
            onGuardar = { nova ->
                acoes.guardarAutomacoes(Automacoes.guardar(lista, nova, r.idOriginal)) { editar = null }
            },
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
                if (lista.isEmpty()) {
                    item(key = "_vazio") {
                        Text(
                            "Ainda não tem automações. Crie uma, por exemplo: acender a luz do corredor quando houver movimento à noite.",
                            color = LocalTerra.current.textoSuave,
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                }
                items(lista, key = { it.id }) { a ->
                    CartaoAutomacao(
                        a = a,
                        aparelhos = aparelhos,
                        ativo = state.ligado && !state.aGuardar,
                        onAtiva = { v -> acoes.guardarAutomacoes(Automacoes.comAtiva(lista, a.id, v)) {} },
                        onEditar = { editar = Rascunho.de(a) },
                        onApagar = { apagar = a },
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
private fun AvisoErro(texto: String, onFechar: () -> Unit) {
    val t = LocalTerra.current
    Cartao(destaque = t.alarme) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(texto, color = t.alarme, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onFechar) { Icon(Icons.Filled.Close, contentDescription = "Fechar") }
        }
    }
}

@Composable
private fun CartaoAutomacao(
    a: Automacao,
    aparelhos: List<Aparelho>,
    ativo: Boolean,
    onAtiva: (Boolean) -> Unit,
    onEditar: () -> Unit,
    onApagar: () -> Unit,
) {
    val t = LocalTerra.current
    Cartao {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(a.nome, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (a.bloqueada) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Lock, contentDescription = null, tint = t.textoSuave, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Criada pela Domus Energia", style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                    }
                }
            }
            Switch(checked = a.ativa, onCheckedChange = onAtiva, enabled = ativo, colors = coresInterruptor())
        }
        Text(Automacoes.descrever(a, aparelhos), style = MaterialTheme.typography.bodyMedium, color = t.textoSuave)
        if (!a.bloqueada) {
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                if (a.editavel) {
                    TextButton(onClick = onEditar, enabled = ativo) {
                        Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Editar")
                    }
                }
                TextButton(onClick = onApagar, enabled = ativo) {
                    Icon(Icons.Filled.Delete, contentDescription = null, modifier = Modifier.size(18.dp), tint = t.alarme)
                    Spacer(Modifier.width(6.dp))
                    Text("Apagar", color = t.alarme)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ formulário

private val DIAS = listOf("seg", "ter", "qua", "qui", "sex", "sáb", "dom")

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EditorAutomacao(
    inicial: Rascunho,
    aparelhos: List<Aparelho>,
    aGuardar: Boolean,
    podeGuardar: Boolean,
    erroServidor: String?,
    existentes: List<Automacao>,
    onCancelar: () -> Unit,
    onGuardar: (Automacao) -> Unit,
) {
    val t = LocalTerra.current
    var r by remember(inicial) { mutableStateOf(inicial) }
    var tentou by remember { mutableStateOf(false) }
    val nova = r.paraAutomacao(existentes.filterNot { it.id == r.idOriginal })
    val erros = Automacoes.validar(nova, aparelhos) +
        Automacoes.validarLista(Automacoes.guardar(existentes, nova, r.idOriginal))

    // Canais disponíveis para cada escolha
    val sensores = alvos(aparelhos) { it.funcao in Funcao.SENSORES }
    val circuitos = alvos(aparelhos) { it.funcao == Funcao.INTERRUPTOR || it.funcao == Funcao.LUZ }
    val estores = alvos(aparelhos) { it.funcao == Funcao.ESTORE }
    val medidores = aparelhos.filter { it.medidor }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (r.idOriginal == null) "Nova automação" else "Editar automação",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onCancelar) { Icon(Icons.Filled.Close, contentDescription = "Cancelar") }
        }

        Cartao {
            OutlinedTextField(
                r.nome, { r = r.copy(nome = it) },
                label = { Text("Nome") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Ativa", modifier = Modifier.weight(1f))
                Switch(checked = r.ativa, onCheckedChange = { r = r.copy(ativa = it) }, colors = coresInterruptor())
            }
        }

        // ---- Quando
        Cartao {
            Titulo("Quando")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Escolha("Sensor", r.tipoQuando == Rascunho.SENSOR) { r = r.copy(tipoQuando = Rascunho.SENSOR) }
                Escolha("Hora", r.tipoQuando == Rascunho.HORA) { r = r.copy(tipoQuando = Rascunho.HORA) }
                Escolha("Consumo", r.tipoQuando == Rascunho.POTENCIA) { r = r.copy(tipoQuando = Rascunho.POTENCIA) }
            }
            when (r.tipoQuando) {
                Rascunho.SENSOR -> {
                    Seletor("Sensor", sensores, r.sensor, { r = r.copy(sensor = it) }, "Não tem sensores de porta ou movimento.")
                    val funcao = r.sensor?.let { s -> aparelhos.firstOrNull { it.id == s.aparelho }?.canal(s.canal)?.funcao }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Escolha(if (funcao == Funcao.PORTA) "Abre" else "Deteta movimento", r.valor == 1) { r = r.copy(valor = 1) }
                        Escolha(if (funcao == Funcao.PORTA) "Fecha" else "Sem movimento", r.valor == 0) { r = r.copy(valor = 0) }
                    }
                }
                Rascunho.HORA -> {
                    OutlinedTextField(
                        r.hora, { r = r.copy(hora = it) },
                        label = { Text("Hora (HH:MM)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        DIAS.forEachIndexed { i, d ->
                            val dia = i + 1
                            Escolha(d, dia in r.dias) {
                                r = r.copy(dias = if (dia in r.dias) r.dias - dia else r.dias + dia)
                            }
                        }
                    }
                }
                Rascunho.POTENCIA -> {
                    Seletor(
                        "Medidor",
                        medidores.map { Alvo(it.id, 1) to it.nome },
                        r.medidor?.let { Alvo(it, 1) },
                        { r = r.copy(medidor = it.aparelho) },
                        "Não tem aparelhos que meçam o consumo.",
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            r.acimaW, { r = r.copy(acimaW = it) },
                            label = { Text("Acima de (W)") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            r.duranteS, { r = r.copy(duranteS = it) },
                            label = { Text("Durante (s)") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        // ---- Se (condições)
        Cartao {
            Titulo("Só se (opcional)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Escolha("Sempre", r.alarme == null) { r = r.copy(alarme = null) }
                Escolha("Alarme ativo", r.alarme == true) { r = r.copy(alarme = true) }
                Escolha("Alarme desligado", r.alarme == false) { r = r.copy(alarme = false) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = r.entreAtivo, onCheckedChange = { r = r.copy(entreAtivo = it) })
                Text("Só entre certas horas (pode passar a meia-noite)")
            }
            if (r.entreAtivo) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        r.de, { r = r.copy(de = it) }, label = { Text("Das (HH:MM)") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        r.ate, { r = r.copy(ate = it) }, label = { Text("Às (HH:MM)") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // ---- Então (ações)
        r.acoes.forEachIndexed { i, acao ->
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Titulo(if (i == 0) "Então" else "E depois", Modifier.weight(1f))
                    if (r.acoes.size > 1) {
                        IconButton(onClick = { r = r.semAcao(i) }) { Icon(Icons.Filled.Delete, contentDescription = "Remover ação") }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Escolha("Ligar", acao.tipo == RascunhoAcao.LIGAR) { r = r.comAcao(i) { it.copy(tipo = RascunhoAcao.LIGAR, alvo = it.alvo.takeIf { a -> a in circuitos.map { c -> c.first } }) } }
                    Escolha("Desligar", acao.tipo == RascunhoAcao.DESLIGAR) { r = r.comAcao(i) { it.copy(tipo = RascunhoAcao.DESLIGAR, alvo = it.alvo.takeIf { a -> a in circuitos.map { c -> c.first } }) } }
                    Escolha("Estore", acao.tipo == RascunhoAcao.ESTORE) { r = r.comAcao(i) { it.copy(tipo = RascunhoAcao.ESTORE, alvo = it.alvo.takeIf { a -> a in estores.map { c -> c.first } }) } }
                    Escolha("Avisar", acao.tipo == RascunhoAcao.NOTIFICAR) { r = r.comAcao(i) { it.copy(tipo = RascunhoAcao.NOTIFICAR) } }
                }
                when (acao.tipo) {
                    RascunhoAcao.LIGAR, RascunhoAcao.DESLIGAR -> {
                        Seletor("Circuito ou luz", circuitos, acao.alvo, { a -> r = r.comAcao(i) { it.copy(alvo = a) } }, "Não tem circuitos.")
                        OutlinedTextField(
                            acao.duracaoMin, { v -> r = r.comAcao(i) { it.copy(duracaoMin = v) } },
                            label = { Text("Durante (minutos, opcional)") },
                            supportingText = { Text("Depois volta ao estado oposto.") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    RascunhoAcao.ESTORE -> {
                        Seletor("Estore", estores, acao.alvo, { a -> r = r.comAcao(i) { it.copy(alvo = a) } }, "Não tem estores.")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Posição", modifier = Modifier.width(64.dp), style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
                            Slider(
                                value = acao.posicao.toFloat(),
                                onValueChange = { v -> r = r.comAcao(i) { it.copy(posicao = Math.round(v)) } },
                                valueRange = 0f..100f,
                                colors = SliderDefaults.colors(thumbColor = t.musgo, activeTrackColor = t.musgo, inactiveTrackColor = t.borda),
                                modifier = Modifier.weight(1f),
                            )
                            Text("${acao.posicao} %", modifier = Modifier.width(44.dp).padding(start = 6.dp), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    RascunhoAcao.NOTIFICAR -> OutlinedTextField(
                        acao.mensagem, { v -> r = r.comAcao(i) { it.copy(mensagem = v) } },
                        label = { Text("Mensagem do aviso") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        if (r.acoes.size < Automacoes.MAX_ACOES) {
            OutlinedButton(onClick = { r = r.maisAcao() }, shape = FormaPilula) {
                Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Adicionar ação")
            }
        }

        // ---- Erros e guardar
        if (tentou && erros.isNotEmpty()) {
            Cartao(destaque = t.alarme) {
                erros.forEach { Text("• $it", color = t.alarme, style = MaterialTheme.typography.bodyMedium) }
            }
        }
        erroServidor?.let { Cartao(destaque = t.alarme) { Text(it, color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BotaoPilula(
                if (aGuardar) "A guardar…" else "Guardar",
                onClick = {
                    tentou = true
                    if (erros.isEmpty()) onGuardar(nova)
                },
                enabled = podeGuardar && !aGuardar,
            )
            TextButton(onClick = onCancelar) { Text("Cancelar") }
            if (aGuardar) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = t.musgo)
        }
        Spacer(Modifier.height(24.dp))
    }
}

/** Canais (aparelho, n) que cumprem [filtro], com o nome a mostrar. */
private fun alvos(aparelhos: List<Aparelho>, filtro: (pt.domusenergia.app.data.Canal) -> Boolean): List<Pair<Alvo, String>> =
    aparelhos.flatMap { a ->
        a.canais.filter(filtro).map { c -> Alvo(a.id, c.n) to Automacoes.nomeCanal(aparelhos, a.id, c.n) }
    }

@Composable
private fun Titulo(texto: String, modifier: Modifier = Modifier) {
    Text(texto, style = MaterialTheme.typography.titleMedium, modifier = modifier)
}

@Composable
private fun Escolha(texto: String, selecionado: Boolean, onClick: () -> Unit) {
    val t = LocalTerra.current
    FilterChip(
        selected = selecionado,
        onClick = onClick,
        label = { Text(texto) },
        shape = FormaPilula,
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = t.musgo,
            selectedLabelColor = t.creme,
        ),
    )
}

/** Botão que abre um menu com as opções [opcoes] (valor → texto). */
@Composable
private fun Seletor(
    rotulo: String,
    opcoes: List<Pair<Alvo, String>>,
    atual: Alvo?,
    onEscolher: (Alvo) -> Unit,
    vazio: String,
) {
    val t = LocalTerra.current
    var aberto by remember { mutableStateOf(false) }
    if (opcoes.isEmpty()) {
        Text(vazio, color = t.textoSuave, style = MaterialTheme.typography.bodyMedium)
        return
    }
    Box {
        OutlinedButton(onClick = { aberto = true }, shape = FormaPilula, modifier = Modifier.fillMaxWidth()) {
            Text(
                opcoes.firstOrNull { it.first == atual }?.second ?: "Escolher ${rotulo.lowercase()}…",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(expanded = aberto, onDismissRequest = { aberto = false }) {
            opcoes.forEach { (alvo, nome) ->
                DropdownMenuItem(text = { Text(nome) }, onClick = { onEscolher(alvo); aberto = false })
            }
        }
    }
}
