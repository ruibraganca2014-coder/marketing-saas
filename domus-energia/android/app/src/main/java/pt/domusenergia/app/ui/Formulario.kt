package pt.domusenergia.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Alvo
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Canal
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.numeros

// Peças de formulário comuns (assistente de automações, cenas, definições).

@Composable
fun Titulo(texto: String, modifier: Modifier = Modifier) {
    Text(texto, style = MaterialTheme.typography.titleMedium, modifier = modifier)
}

/** Texto de ajuda pequeno, em tom suave. */
@Composable
fun Ajuda(texto: String, modifier: Modifier = Modifier, cor: androidx.compose.ui.graphics.Color? = null) {
    Text(texto, style = MaterialTheme.typography.bodySmall, color = cor ?: LocalTerra.current.textoSuave, modifier = modifier)
}

/** Opção em pílula (musgo quando escolhida). */
@Composable
fun Escolha(texto: String, selecionado: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val t = LocalTerra.current
    FilterChip(
        selected = selecionado,
        onClick = onClick,
        enabled = enabled,
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
fun <T> Seletor(
    rotulo: String,
    opcoes: List<Pair<T, String>>,
    atual: T?,
    onEscolher: (T) -> Unit,
    vazio: String,
    modifier: Modifier = Modifier,
    /** Texto enquanto nada está escolhido (nada vem pré-escolhido). */
    escolha: String = "Escolher ${rotulo.lowercase()}…",
) {
    val t = LocalTerra.current
    var aberto by remember { mutableStateOf(false) }
    if (opcoes.isEmpty()) {
        Text(vazio, color = t.textoSuave, style = MaterialTheme.typography.bodyMedium, modifier = modifier)
        return
    }
    Box(modifier) {
        OutlinedButton(onClick = { aberto = true }, shape = FormaPilula, modifier = Modifier.fillMaxWidth()) {
            Text(
                opcoes.firstOrNull { it.first == atual }?.second ?: escolha,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(expanded = aberto, onDismissRequest = { aberto = false }) {
            opcoes.forEach { (valor, nome) ->
                DropdownMenuItem(text = { Text(nome) }, onClick = { onEscolher(valor); aberto = false })
            }
        }
    }
}

/** Campo de texto de uma linha (numérico com [teclado]). */
@Composable
fun Campo(
    valor: String,
    onChange: (String) -> Unit,
    rotulo: String,
    modifier: Modifier = Modifier,
    teclado: KeyboardType = KeyboardType.Text,
    apoio: String? = null,
    linhas: Int = 1,
) {
    OutlinedTextField(
        valor, onChange,
        label = { Text(rotulo) },
        singleLine = linhas == 1,
        minLines = linhas,
        supportingText = apoio?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = teclado),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Valor inteiro com botões − e + (sem teclado: mais fácil no telemóvel). */
@Composable
fun Contador(
    rotulo: String,
    valor: Int,
    onChange: (Int) -> Unit,
    min: Int,
    max: Int,
    passo: Int,
    sufixo: String,
    ajuda: String? = null,
) {
    val t = LocalTerra.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(rotulo, style = MaterialTheme.typography.bodyLarge)
            ajuda?.let { Ajuda(it) }
        }
        val cores = IconButtonDefaults.filledTonalIconButtonColors(containerColor = t.musgoClaro, contentColor = t.texto)
        FilledTonalIconButton(
            onClick = { onChange((valor - passo).coerceAtLeast(min)) },
            enabled = valor > min,
            colors = cores,
            modifier = Modifier.size(36.dp),
        ) { Text("−", style = MaterialTheme.typography.titleMedium) }
        Text(
            "$valor $sufixo",
            style = MaterialTheme.typography.titleMedium.numeros,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.width(76.dp),
        )
        FilledTonalIconButton(
            onClick = { onChange((valor + passo).coerceAtMost(max)) },
            enabled = valor < max,
            colors = cores,
            modifier = Modifier.size(36.dp),
        ) { Icon(Icons.Filled.Add, contentDescription = "Mais", modifier = Modifier.size(18.dp)) }
    }
}

/** Canais (aparelho, n) que cumprem [filtro], com o nome a mostrar. */
fun alvos(aparelhos: List<Aparelho>, filtro: (Canal) -> Boolean): List<Pair<Alvo, String>> =
    aparelhos.flatMap { a ->
        a.canais.filter(filtro).map { c -> Alvo(a.id, c.n) to Automacoes.nomeCanal(aparelhos, a.id, c.n) }
    }

/** Espaço vertical padrão entre blocos de um formulário. */
val EspacoFormulario = 12.dp

/** Moldura de uma sub-secção (ex.: uma ação dentro da lista). */
@Composable
fun Recuo(content: @Composable () -> Unit) {
    Box(Modifier.padding(start = 8.dp)) { content() }
}

/**
 * Confirmação antes de uma ação arriscada (disjuntor geral, carga perigosa): [linhas] em texto simples
 * (ver [pt.domusenergia.app.data.Riscos]). "Voltar e alterar" / "Cancelar" = [onNao].
 */
@Composable
fun ConfirmarRisco(
    titulo: String,
    linhas: List<String>,
    sim: String,
    nao: String,
    onSim: () -> Unit,
    onNao: () -> Unit,
    explicacao: String? = null,
) {
    val t = LocalTerra.current
    AlertDialog(
        onDismissRequest = onNao,
        title = { Text(titulo) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                explicacao?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                linhas.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = t.texto) }
            }
        },
        confirmButton = { TextButton(onClick = onSim) { Text(sim, color = t.alarme) } },
        dismissButton = { TextButton(onClick = onNao) { Text(nao) } },
    )
}
