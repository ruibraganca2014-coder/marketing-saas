package pt.domusenergia.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Alvo
import pt.domusenergia.app.data.Aparelho
import pt.domusenergia.app.data.Automacao
import pt.domusenergia.app.data.Automacoes
import pt.domusenergia.app.data.Canal
import pt.domusenergia.app.data.Categorias
import pt.domusenergia.app.data.Cena
import pt.domusenergia.app.data.Condicoes
import pt.domusenergia.app.data.ConfigCasa
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.data.Modelo
import pt.domusenergia.app.data.Modos
import pt.domusenergia.app.data.Quando
import pt.domusenergia.app.data.Rascunho
import pt.domusenergia.app.data.RascunhoAcao
import pt.domusenergia.app.data.RascunhoCondicoes
import pt.domusenergia.app.ui.tema.FormaCartao
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra

/** O que os editores de ações/condições precisam de saber da casa. */
class ContextoEditor(
    val aparelhos: List<Aparelho>,
    val cenas: List<Cena>,
    val config: ConfigCasa?,
) {
    val circuitos = alvos(aparelhos) { it.funcao == Funcao.INTERRUPTOR || it.funcao == Funcao.LUZ }
    val luzes = alvos(aparelhos) { it.funcao == Funcao.LUZ }
    val estores = alvos(aparelhos) { it.funcao == Funcao.ESTORE }

    /** Canais que podem disparar ou ser condição (porta, movimento, interruptor, luz). */
    val estados = alvos(aparelhos) { it.funcao in setOf(Funcao.PORTA, Funcao.MOVIMENTO, Funcao.INTERRUPTOR, Funcao.LUZ) }
    fun canal(a: Alvo?): Canal? = a?.let { x -> aparelhos.firstOrNull { it.id == x.aparelho }?.canal(x.canal) }
}

private val PASSOS = listOf("Objetivo", "Gatilho", "Ação", "Condições", "Vários aparelhos")
private val DIAS = listOf("seg", "ter", "qua", "qui", "sex", "sáb", "dom")

/**
 * Assistente de criação de automações em 5 passos (docs/AUTOMACOES-v3.md §4):
 * 1. Objetivo (categoria + frase) e modelos prontos; 2. Gatilho; 3. Ação básica + "Testar agora";
 * 4. Condições; 5. Vários aparelhos (esperas, cenas, modo, luz, alternar, SE/SENÃO).
 *
 * @param modelos modelos prontos (só numa automação nova).
 * @param podeTestar a automação já está guardada (o "Testar agora" executa a versão guardada).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Assistente(
    inicial: Rascunho,
    ctx: ContextoEditor,
    existentes: List<Automacao>,
    modelos: List<Modelo>,
    aGuardar: Boolean,
    podeGuardar: Boolean,
    podeTestar: Boolean,
    erroServidor: String?,
    onCancelar: () -> Unit,
    onGuardar: (Automacao) -> Unit,
    onTestar: (String) -> Unit,
    passoInicial: Int = 0,
) {
    val t = LocalTerra.current
    var r by remember(inicial) { mutableStateOf(inicial) }
    var passo by remember(inicial) { mutableIntStateOf(passoInicial) }
    var tentou by remember { mutableStateOf(false) }
    val nova = r.paraAutomacao(existentes.filterNot { it.id == r.idOriginal })
    val erros = Automacoes.validar(nova, ctx.aparelhos, ctx.cenas, ctx.config) +
        Automacoes.validarLista(Automacoes.guardar(existentes, nova, r.idOriginal))

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
        IndicadorPassos(passo) { passo = it }

        when (passo) {
            0 -> PassoObjetivo(r, { r = it }, modelos) { m -> r = m.rascunho.copy(idOriginal = r.idOriginal); passo = 1 }
            1 -> PassoGatilho(r, { r = it }, ctx)
            2 -> PassoAcao(r, { r = it }, ctx, podeTestar && podeGuardar) { r.idOriginal?.let(onTestar) }
            3 -> Cartao {
                Titulo("Só se… (opcional)")
                Ajuda("Todas as condições escolhidas têm de ser verdade. Sem nenhuma, corre sempre.")
                EditorCondicoes(r.condicoes, { r = r.comCondicoes(it) }, ctx)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Funciona mesmo depois de mexer à mão", style = MaterialTheme.typography.bodyLarge)
                        Ajuda("Por omissão, mexer num interruptor pausa as automações desse canal durante um bocado.")
                    }
                    Switch(checked = r.ignorarPausa, onCheckedChange = { r = r.copy(ignorarPausa = it) }, colors = coresInterruptor())
                }
            }
            else -> Cartao {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Titulo("Então, por esta ordem", Modifier.weight(1f))
                    Ajuda("${r.totalAcoes} de ${Automacoes.MAX_ACOES}")
                }
                Ajuda("Use \"Esperar\" entre ações e \"SE / SENÃO\" para decidir na hora (até 2 níveis).")
                ListaAcoes(
                    acoes = r.acoes,
                    onChange = { r = r.copy(acoes = it) },
                    tipos = RascunhoAcao.TODAS,
                    ctx = ctx,
                    nivel = 0,
                    podeMais = { n -> r.totalAcoes + n <= Automacoes.MAX_ACOES },
                )
            }
        }

        // ---- Erros e navegação
        if (tentou && erros.isNotEmpty()) {
            Cartao(destaque = t.alarme) {
                erros.forEach { Text("• $it", color = t.alarme, style = MaterialTheme.typography.bodyMedium) }
            }
        }
        erroServidor?.let { Cartao(destaque = t.alarme) { Text(it, color = t.alarme, style = MaterialTheme.typography.bodyMedium) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (passo > 0) TextButton(onClick = { passo-- }) { Text("Anterior") }
            Spacer(Modifier.weight(1f))
            if (aGuardar) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = t.musgo)
            if (passo >= 2) {
                val guardar = {
                    tentou = true
                    if (erros.isEmpty()) onGuardar(nova)
                }
                if (passo < PASSOS.lastIndex) {
                    OutlinedButton(onClick = guardar, enabled = podeGuardar && !aGuardar, shape = FormaPilula) { Text("Guardar") }
                } else {
                    BotaoPilula(if (aGuardar) "A guardar…" else "Guardar", onClick = guardar, enabled = podeGuardar && !aGuardar)
                }
            }
            if (passo < PASSOS.lastIndex) BotaoPilula("Seguinte", onClick = { passo++ })
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun IndicadorPassos(passo: Int, onIr: (Int) -> Unit) {
    val t = LocalTerra.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PASSOS.indices.forEach { i ->
                Surface(
                    shape = FormaPilula,
                    color = if (i <= passo) t.musgo else t.textoSuave.copy(alpha = 0.25f),
                    modifier = Modifier.weight(1f).height(6.dp).clip(FormaPilula).clickable { onIr(i) },
                ) {}
            }
        }
        Text("Passo ${passo + 1} de ${PASSOS.size} · ${PASSOS[passo]}", style = MaterialTheme.typography.labelLarge, color = t.textoSuave)
    }
}

// ------------------------------------------------------------------ passo 1: objetivo

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PassoObjetivo(r: Rascunho, onChange: (Rascunho) -> Unit, modelos: List<Modelo>, onModelo: (Modelo) -> Unit) {
    val t = LocalTerra.current
    Cartao {
        Titulo("O que quer que a casa faça?")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Categorias.TODAS.forEach { c ->
                Escolha(Categorias.rotulo(c), r.categoria == c) { onChange(r.copy(categoria = if (r.categoria == c) null else c)) }
            }
        }
        Campo(
            r.descricao, { onChange(r.copy(descricao = it.take(Automacoes.MAX_DESCRICAO))) },
            "Objetivo numa frase",
            apoio = "Ex.: \"Acender a luz do corredor quando alguém passa, só à noite\" (${r.descricao.length}/${Automacoes.MAX_DESCRICAO})",
            linhas = 2,
        )
        Campo(r.nome, { onChange(r.copy(nome = it)) }, "Nome curto")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Ativa", modifier = Modifier.weight(1f))
            Switch(checked = r.ativa, onCheckedChange = { onChange(r.copy(ativa = it)) }, colors = coresInterruptor())
        }
    }
    if (modelos.isNotEmpty()) {
        Text("Ou comece de um modelo", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp))
        modelos.forEach { m ->
            Surface(
                shape = FormaCartao,
                color = t.superficie,
                border = BorderStroke(1.dp, t.borda),
                modifier = Modifier.fillMaxWidth().clip(FormaCartao).clickable { onModelo(m) },
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m.titulo, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Etiqueta(Categorias.rotulo(m.categoria), t.musgo)
                    }
                    Ajuda(m.resumo)
                    m.falta?.let { Ajuda("Falta na sua casa: $it.", cor = t.argila) }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ passo 2: gatilho

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PassoGatilho(r: Rascunho, onChange: (Rascunho) -> Unit, ctx: ContextoEditor) {
    val t = LocalTerra.current
    Cartao {
        Titulo("Quando?")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Rascunho.GATILHOS.forEach { g -> Escolha(Rascunho.rotuloGatilho(g), r.tipoQuando == g) { onChange(r.copy(tipoQuando = g)) } }
        }
        when (r.tipoQuando) {
            Rascunho.SENSOR -> {
                Seletor("Aparelho", ctx.estados, r.sensor, { onChange(r.copy(sensor = it)) }, "Não tem sensores nem circuitos.")
                val f = ctx.canal(r.sensor)?.funcao
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Escolha(rotuloValor(f, 1), r.valor == 1) { onChange(r.copy(valor = 1)) }
                    Escolha(rotuloValor(f, 0), r.valor == 0) { onChange(r.copy(valor = 0)) }
                }
                Campo(
                    r.sensorDuranteMin, { onChange(r.copy(sensorDuranteMin = it)) },
                    "Há quanto tempo (min)",
                    teclado = KeyboardType.Decimal,
                    apoio = "Ex.: 10 = \"sem movimento há 10 min\". Vazio = assim que muda.",
                )
            }
            Rascunho.HORA -> {
                Campo(r.hora, { onChange(r.copy(hora = it)) }, "Hora (HH:MM)", teclado = KeyboardType.Number)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DIAS.forEachIndexed { i, d ->
                        val dia = i + 1
                        Escolha(d, dia in r.dias) { onChange(r.copy(dias = if (dia in r.dias) r.dias - dia else r.dias + dia)) }
                    }
                }
            }
            Rascunho.SOL -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Escolha("Nascer do sol", r.solEvento == Quando.SOL_NASCER) { onChange(r.copy(solEvento = Quando.SOL_NASCER)) }
                    Escolha("Pôr do sol", r.solEvento == Quando.SOL_POR) { onChange(r.copy(solEvento = Quando.SOL_POR)) }
                }
                Contador(
                    "Desvio", Rascunho.numero(r.solDesvioMin)?.toInt() ?: 0, { onChange(r.copy(solDesvioMin = it.toString())) },
                    -180, 180, 15, "min", ajuda = "Negativo = antes; positivo = depois.",
                )
                if (ctx.config != null && ctx.config.local == null) {
                    Ajuda("Precisa da localização da casa: escolha a cidade em Definições.", cor = t.argila)
                }
            }
            Rascunho.POTENCIA -> {
                Seletor(
                    "Medidor", ctx.aparelhos.filter { it.medidor }.map { it.id to it.nome }, r.medidor,
                    { onChange(r.copy(medidor = it)) }, "Não tem aparelhos que meçam o consumo.",
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Campo(r.acimaW, { onChange(r.copy(acimaW = it)) }, "Acima de (W)", Modifier.weight(1f), KeyboardType.Number)
                    Campo(r.duranteS, { onChange(r.copy(duranteS = it)) }, "Durante (s)", Modifier.weight(1f), KeyboardType.Number)
                }
                Campo(
                    r.rearmarW, { onChange(r.copy(rearmarW = it)) }, "Volta a avisar abaixo de (W, opcional)",
                    teclado = KeyboardType.Number, apoio = "Evita avisos repetidos perto do limite (por omissão 90 %).",
                )
            }
            Rascunho.PRESENCA -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Escolha("O primeiro chega", r.presencaEvento == Quando.CHEGA_PRIMEIRO) { onChange(r.copy(presencaEvento = Quando.CHEGA_PRIMEIRO)) }
                    Escolha("O último sai", r.presencaEvento == Quando.SAI_ULTIMO) { onChange(r.copy(presencaEvento = Quando.SAI_ULTIMO)) }
                }
                Ajuda("Precisa de alguém com \"Detetar quando chego e saio de casa\" ligado na app (Definições). Leva uns 10 min a confirmar.")
            }
            Rascunho.MODO -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Modos.TODOS.forEach { m -> Escolha(Modos.rotulo(m), r.modoGatilho == m) { onChange(r.copy(modoGatilho = m)) } }
            }
            Rascunho.MANUAL -> Ajuda("Só corre quando carregar em \"Executar\" ou \"Testar agora\" na lista de automações.")
            Rascunho.SISTEMA -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Escolha("Luz voltou", r.sistemaEvento == Quando.ENERGIA_REPOSTA) { onChange(r.copy(sistemaEvento = Quando.ENERGIA_REPOSTA)) }
                    Escolha("Aparelho offline", r.sistemaEvento == Quando.APARELHO_OFFLINE) { onChange(r.copy(sistemaEvento = Quando.APARELHO_OFFLINE)) }
                    Escolha("Aparelho online", r.sistemaEvento == Quando.APARELHO_ONLINE) { onChange(r.copy(sistemaEvento = Quando.APARELHO_ONLINE)) }
                }
                if (r.sistemaEvento != Quando.ENERGIA_REPOSTA) {
                    Seletor<String?>(
                        "Aparelho", listOf<Pair<String?, String>>(null to "Qualquer aparelho") + ctx.aparelhos.map { it.id to it.nome },
                        r.sistemaAparelho, { onChange(r.copy(sistemaAparelho = it)) }, "",
                    )
                }
            }
        }
        Text(Automacoes.descreverQuando(r.quando(), ctx.aparelhos), style = MaterialTheme.typography.bodyMedium, color = t.musgo)
    }
}

private fun rotuloValor(funcao: String?, valor: Int): String = when (funcao) {
    Funcao.PORTA -> if (valor == 1) "Abre" else "Fecha"
    Funcao.MOVIMENTO -> if (valor == 1) "Deteta movimento" else "Sem movimento"
    Funcao.INTERRUPTOR, Funcao.LUZ -> if (valor == 1) "É ligado" else "É desligado"
    else -> if (valor == 1) "Ativo" else "Inativo"
}

// ------------------------------------------------------------------ passo 3: ação básica

@Composable
private fun PassoAcao(r: Rascunho, onChange: (Rascunho) -> Unit, ctx: ContextoEditor, podeTestar: Boolean, onTestar: () -> Unit) {
    val t = LocalTerra.current
    val primeira = r.acoes.firstOrNull() ?: RascunhoAcao()
    Cartao {
        Titulo("Então…")
        EditorAcao(
            acao = primeira,
            onChange = { a -> onChange(if (r.acoes.isEmpty()) r.copy(acoes = listOf(a)) else r.comAcao(0) { a }) },
            tipos = if (primeira.tipo in RascunhoAcao.BASICAS) RascunhoAcao.BASICAS else RascunhoAcao.TODAS,
            ctx = ctx,
            nivel = 0,
        )
        if (r.acoes.size > 1) Ajuda("E mais ${r.acoes.size - 1} ${if (r.acoes.size == 2) "ação" else "ações"} no passo 5.")
    }
    Cartao {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Titulo("Testar agora")
                Ajuda(
                    if (podeTestar) "Executa as ações da versão guardada, sem esperar pelo gatilho nem ver as condições."
                    else "Guarde a automação para a poder testar.",
                )
            }
            OutlinedButton(onClick = onTestar, enabled = podeTestar, shape = FormaPilula) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp), tint = if (podeTestar) t.musgo else t.textoSuave)
                Spacer(Modifier.width(4.dp))
                Text("Testar")
            }
        }
    }
}

// ------------------------------------------------------------------ condições

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditorCondicoes(c: RascunhoCondicoes, onChange: (RascunhoCondicoes) -> Unit, ctx: ContextoEditor, compacto: Boolean = false) {
    val t = LocalTerra.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!compacto) {
            Rotulo("Alarme")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Escolha("Tanto faz", c.alarme == null) { onChange(c.copy(alarme = null)) }
                Escolha("Armado", c.alarme == true) { onChange(c.copy(alarme = true)) }
                Escolha("Desarmado", c.alarme == false) { onChange(c.copy(alarme = false)) }
            }
        }
        Rotulo("Modo da casa")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Modos.TODOS.forEach { m ->
                Escolha(Modos.rotulo(m), m in c.modos) { onChange(c.copy(modos = if (m in c.modos) c.modos - m else c.modos + m)) }
            }
        }
        Rotulo("Sol")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Escolha("Tanto faz", c.sol == null) { onChange(c.copy(sol = null)) }
            Escolha("De dia", c.sol == Condicoes.DIA) { onChange(c.copy(sol = Condicoes.DIA)) }
            Escolha("De noite", c.sol == Condicoes.NOITE) { onChange(c.copy(sol = Condicoes.NOITE)) }
        }
        Rotulo("Pessoas")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Escolha("Tanto faz", c.presenca == null) { onChange(c.copy(presenca = null)) }
            Escolha("Alguém em casa", c.presenca == Condicoes.ALGUEM) { onChange(c.copy(presenca = Condicoes.ALGUEM)) }
            Escolha("Ninguém em casa", c.presenca == Condicoes.NINGUEM) { onChange(c.copy(presenca = Condicoes.NINGUEM)) }
        }
        if (!compacto) {
            Rotulo("Dias (nenhum = todos)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                DIAS.forEachIndexed { i, d ->
                    val dia = i + 1
                    Escolha(d, dia in c.dias) { onChange(c.copy(dias = if (dia in c.dias) c.dias - dia else c.dias + dia)) }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = c.entreAtivo, onCheckedChange = { onChange(c.copy(entreAtivo = it)) },
                    colors = CheckboxDefaults.colors(checkedColor = t.musgo, checkmarkColor = t.creme),
                )
                Text("Só entre certas horas (pode passar a meia-noite)", style = MaterialTheme.typography.bodyMedium)
            }
            if (c.entreAtivo) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Campo(c.de, { onChange(c.copy(de = it)) }, "Das (HH:MM)", Modifier.weight(1f), KeyboardType.Number)
                    Campo(c.ate, { onChange(c.copy(ate = it)) }, "Às (HH:MM)", Modifier.weight(1f), KeyboardType.Number)
                }
            }
        }
        Rotulo("Estado de outros aparelhos")
        c.aparelhos.forEachIndexed { i, (alvo, valor) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Seletor(
                    "Aparelho", ctx.estados, alvo,
                    { a -> onChange(c.copy(aparelhos = c.aparelhos.mapIndexed { j, x -> if (j == i) a to x.second else x })) },
                    "Sem aparelhos.", Modifier.weight(1f),
                )
                val f = ctx.canal(alvo)?.funcao
                Escolha(Automacoes.valorTexto(f, valor).replaceFirstChar { it.uppercase() }, true) {
                    onChange(c.copy(aparelhos = c.aparelhos.mapIndexed { j, x -> if (j == i) x.first to (1 - x.second) else x }))
                }
                IconButton(onClick = { onChange(c.copy(aparelhos = c.aparelhos.filterIndexed { j, _ -> j != i })) }) {
                    Icon(Icons.Filled.Delete, contentDescription = "Tirar condição", tint = t.textoSuave)
                }
            }
        }
        TextButton(onClick = { onChange(c.copy(aparelhos = c.aparelhos + (null to 1))) }) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp), tint = t.musgo)
            Spacer(Modifier.width(4.dp))
            Text("Juntar estado de um aparelho", color = t.musgo)
        }
    }
}

@Composable
private fun Rotulo(texto: String) {
    Text(texto, style = MaterialTheme.typography.labelLarge, color = LocalTerra.current.textoSuave)
}

// ------------------------------------------------------------------ ações

/**
 * Lista de ações com mover/apagar/juntar. [nivel] 0 = lista principal; SE só até [Automacoes.MAX_NIVEIS_SE].
 * [podeMais] recebe quantas ações se querem juntar e diz se cabem no limite total.
 */
@Composable
fun ListaAcoes(
    acoes: List<RascunhoAcao>,
    onChange: (List<RascunhoAcao>) -> Unit,
    tipos: List<String>,
    ctx: ContextoEditor,
    nivel: Int,
    podeMais: (Int) -> Boolean,
    minimo: Int = 1,
) {
    val t = LocalTerra.current
    val permitidos = if (nivel >= Automacoes.MAX_NIVEIS_SE) tipos - RascunhoAcao.SE else tipos
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        acoes.forEachIndexed { i, a ->
            Surface(
                shape = FormaCartao,
                color = if (nivel == 0) t.fundo.copy(alpha = 0.6f) else t.superficie,
                border = BorderStroke(1.dp, t.borda),
            ) {
                Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${i + 1}. ${RascunhoAcao.rotulo(a.tipo)}",
                            style = MaterialTheme.typography.labelLarge,
                            color = t.textoSuave,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { onChange(mover(acoes, i, -1)) }, enabled = i > 0) {
                            Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "Subir")
                        }
                        IconButton(onClick = { onChange(mover(acoes, i, 1)) }, enabled = i < acoes.lastIndex) {
                            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Descer")
                        }
                        IconButton(onClick = { onChange(acoes.filterIndexed { j, _ -> j != i }) }, enabled = acoes.size > minimo) {
                            Icon(Icons.Filled.Delete, contentDescription = "Tirar ação")
                        }
                    }
                    EditorAcao(
                        acao = a,
                        onChange = { novo -> onChange(acoes.mapIndexed { j, x -> if (j == i) novo else x }) },
                        tipos = permitidos,
                        ctx = ctx,
                        nivel = nivel,
                        podeMais = podeMais,
                    )
                }
            }
        }
        val cabe = podeMais(1)
        TextButton(onClick = { onChange(acoes + RascunhoAcao()) }, enabled = cabe) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp), tint = if (cabe) t.musgo else t.textoSuave)
            Spacer(Modifier.width(4.dp))
            Text(if (cabe) "Juntar ação" else "Máximo de ${Automacoes.MAX_ACOES} ações", color = if (cabe) t.musgo else t.textoSuave)
        }
    }
}

private fun mover(l: List<RascunhoAcao>, i: Int, d: Int): List<RascunhoAcao> {
    val j = i + d
    if (j !in l.indices) return l
    return l.toMutableList().also { val x = it[i]; it[i] = it[j]; it[j] = x }
}

/** Editor de uma ação (recursivo no SE/SENÃO). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditorAcao(
    acao: RascunhoAcao,
    onChange: (RascunhoAcao) -> Unit,
    tipos: List<String>,
    ctx: ContextoEditor,
    nivel: Int,
    podeMais: (Int) -> Boolean = { true },
) {
    val t = LocalTerra.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // Ao mudar de tipo mantém o alvo só se servir para o tipo novo.
        fun mudar(tp: String) {
            val alvos = when (tp) {
                RascunhoAcao.LUZ -> ctx.luzes
                RascunhoAcao.ESTORE -> ctx.estores
                else -> ctx.circuitos
            }.map { it.first }
            onChange(acao.copy(tipo = tp, alvo = acao.alvo.takeIf { it in alvos }))
        }
        if (tipos.size <= 5) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                tipos.forEach { tp -> Escolha(RascunhoAcao.rotulo(tp), acao.tipo == tp) { mudar(tp) } }
            }
        } else {
            // Muitas opções (passo 5, cenas): um menu, para a lista de ações não ficar enorme.
            Seletor("Tipo de ação", tipos.map { it to "Fazer: " + RascunhoAcao.rotulo(it) }, acao.tipo, ::mudar, "")
        }
        when (acao.tipo) {
            RascunhoAcao.LIGAR, RascunhoAcao.DESLIGAR -> {
                Seletor("Circuito ou luz", ctx.circuitos, acao.alvo, { onChange(acao.copy(alvo = it)) }, "Não tem circuitos.")
                val perigosa = ctx.canal(acao.alvo)?.perigosa == true && acao.tipo == RascunhoAcao.LIGAR
                Campo(
                    acao.duracaoMin, { onChange(acao.copy(duracaoMin = it)) },
                    if (perigosa) "Durante (minutos, obrigatório)" else "Durante (minutos, opcional)",
                    teclado = KeyboardType.Decimal,
                    apoio = if (perigosa) "Carga perigosa: no máximo 240 min (4 h)." else "Depois volta ao estado oposto.",
                )
            }
            RascunhoAcao.LUZ -> {
                Seletor("Luz", ctx.luzes, acao.alvo, { onChange(acao.copy(alvo = it)) }, "Não tem luzes com brilho.")
                Deslizador("Brilho", acao.brilho) { onChange(acao.copy(brilho = it)) }
            }
            RascunhoAcao.ALTERNAR ->
                Seletor("Circuito ou luz", ctx.circuitos.filter { ctx.canal(it.first)?.perigosa != true }, acao.alvo, { onChange(acao.copy(alvo = it)) }, "Não tem circuitos.")
            RascunhoAcao.ESTORE -> {
                Seletor("Estore", ctx.estores, acao.alvo, { onChange(acao.copy(alvo = it)) }, "Não tem estores.")
                Deslizador("Posição", acao.posicao) { onChange(acao.copy(posicao = it)) }
            }
            RascunhoAcao.NOTIFICAR -> Campo(acao.mensagem, { onChange(acao.copy(mensagem = it)) }, "Mensagem do aviso")
            RascunhoAcao.ESPERAR -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(30 to "30 s", 60 to "1 min", 300 to "5 min", 600 to "10 min", 1800 to "30 min").forEach { (s, txt) ->
                        Escolha(txt, acao.esperaS == s.toString()) { onChange(acao.copy(esperaS = s.toString())) }
                    }
                }
                Campo(acao.esperaS, { onChange(acao.copy(esperaS = it)) }, "Esperar (segundos, até 3600)", teclado = KeyboardType.Number)
            }
            RascunhoAcao.CENA -> Seletor("Cena", ctx.cenas.map { it.id to it.nome }, acao.cena, { onChange(acao.copy(cena = it)) }, "Ainda não tem cenas.")
            RascunhoAcao.MODO -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Modos.TODOS.forEach { m -> Escolha(Modos.rotulo(m), acao.modo == m) { onChange(acao.copy(modo = m)) } }
                }
                if (acao.modo != Modos.CASA) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = acao.forcar, onCheckedChange = { onChange(acao.copy(forcar = it)) },
                            colors = CheckboxDefaults.colors(checkedColor = t.musgo, checkmarkColor = t.creme),
                        )
                        Text("Armar mesmo com portas abertas", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            RascunhoAcao.SE -> {
                Surface(shape = FormaCartao, color = t.musgoClaro.copy(alpha = 0.5f)) {
                    Column(Modifier.padding(10.dp)) {
                        Text("SE…", style = MaterialTheme.typography.titleSmall, color = t.musgo)
                        EditorCondicoes(acao.condicao, { onChange(acao.copy(condicao = it)) }, ctx, compacto = true)
                    }
                }
                Text("ENTÃO", style = MaterialTheme.typography.titleSmall, color = t.musgo)
                // A lista de dentro tira o SE sozinha quando já está no 2.º nível.
                ListaAcoes(acao.entao, { onChange(acao.copy(entao = it)) }, (tipos + RascunhoAcao.SE).distinct(), ctx, nivel + 1, podeMais, minimo = 0)
                Text("SENÃO (opcional)", style = MaterialTheme.typography.titleSmall, color = t.argila)
                ListaAcoes(acao.senao, { onChange(acao.copy(senao = it)) }, (tipos + RascunhoAcao.SE).distinct(), ctx, nivel + 1, podeMais, minimo = 0)
            }
        }
        if (acao.tipo != RascunhoAcao.SE) {
            val texto = runCatching { Automacoes.descreverAcao(acao.paraAcao(), ctx.aparelhos, ctx.cenas) }.getOrNull()
            texto?.let { Text("→ $it", style = MaterialTheme.typography.bodySmall, color = t.musgo, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun Deslizador(rotulo: String, valor: Int, onChange: (Int) -> Unit) {
    val t = LocalTerra.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(rotulo, modifier = Modifier.width(64.dp), style = MaterialTheme.typography.bodySmall, color = t.textoSuave)
        Slider(
            value = valor.toFloat(),
            onValueChange = { onChange(Math.round(it)) },
            valueRange = 0f..100f,
            colors = SliderDefaults.colors(thumbColor = t.musgo, activeTrackColor = t.musgo, inactiveTrackColor = t.borda),
            modifier = Modifier.weight(1f),
        )
        Box(Modifier.width(48.dp).padding(start = 6.dp)) { Text("$valor %", style = MaterialTheme.typography.bodySmall) }
    }
}
