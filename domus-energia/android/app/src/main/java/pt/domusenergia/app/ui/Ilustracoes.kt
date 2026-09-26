package pt.domusenergia.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Canal
import pt.domusenergia.app.data.Funcao
import pt.domusenergia.app.ui.tema.LocalAnimacoes
import pt.domusenergia.app.ui.tema.LocalTerra
import java.time.Duration
import java.time.Instant
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/*
 * Pequenas ilustrações de cada função de canal (docs/TEMA.md, "Ilustrações animadas"):
 * traço de 2 dp com as cores do tema, 52 dp, animadas só quando o canal está ativo e só se a
 * escala de animações do sistema não for 0 (LocalAnimacoes). Sem animações mostra-se o estado final.
 */

private val TAMANHO = 52.dp
private const val MOVIMENTO_ANIMA_MS = 3000L

/** Ilustração do canal conforme a função. */
@Composable
fun IlustracaoCanal(canal: Canal, modifier: Modifier = Modifier) {
    when (canal.funcao) {
        Funcao.INTERRUPTOR -> Lampada(canal.ligado == true, modifier)
        Funcao.LUZ -> Candeeiro(canal.ligado == true, canal.brilho ?: 100, modifier)
        Funcao.ESTORE -> Estore(canal.posicao ?: 0, modifier)
        Funcao.PORTA -> Porta(canal.aberto == true, modifier)
        Funcao.MOVIMENTO -> Movimento(canal.movimento == true, canal.ultimaMudanca, modifier)
        Funcao.BATERIA -> Pilha(canal.bateria, modifier)
    }
}

/** Valor que pulsa entre [de] e [ate] enquanto [ativo] (e as animações estão ligadas); senão fica em [parado]. */
@Composable
private fun pulso(ativo: Boolean, duracaoMs: Int, de: Float, ate: Float, parado: Float): Float {
    if (!ativo || !LocalAnimacoes.current) return parado
    val t = rememberInfiniteTransition(label = "pulso")
    val v by t.animateFloat(
        initialValue = de,
        targetValue = ate,
        animationSpec = infiniteRepeatable(tween(duracaoMs, easing = LinearEasing), RepeatMode.Reverse),
        label = "pulso",
    )
    return v
}

@Composable
private fun Desenho(descricao: String, modifier: Modifier, tamanho: Dp = TAMANHO, desenho: DrawScope.() -> Unit) {
    Canvas(modifier.size(tamanho).semantics { contentDescription = descricao }, onDraw = desenho)
}

private fun DrawScope.traco() = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)

/** Interruptor: lâmpada de filamento; ligada, um brilho quente (areia) a pulsar muito devagar. */
@Composable
fun Lampada(ligada: Boolean, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val brilho = pulso(ligada, 2600, 0.35f, 0.7f, if (ligada) 0.55f else 0f)
    Desenho(if (ligada) "Lâmpada acesa" else "Lâmpada apagada", modifier) {
        val w = size.width
        val c = Offset(w / 2, w * 0.42f)
        val r = w * 0.22f
        if (brilho > 0f) {
            drawCircle(
                Brush.radialGradient(listOf(t.areia.copy(alpha = brilho), Color.Transparent), c, r * 2.1f),
                r * 2.1f, c,
            )
        }
        drawCircle(if (ligada) t.areia.copy(alpha = 0.35f) else t.musgoClaro, r, c)
        drawCircle(if (ligada) t.argila else t.textoSuave, r, c, style = traco())
        // Filamento
        val fil = Path().apply {
            moveTo(c.x - r * 0.45f, c.y + r * 0.2f)
            lineTo(c.x - r * 0.2f, c.y - r * 0.25f)
            lineTo(c.x, c.y + r * 0.1f)
            lineTo(c.x + r * 0.2f, c.y - r * 0.25f)
            lineTo(c.x + r * 0.45f, c.y + r * 0.2f)
        }
        drawPath(fil, if (ligada) t.argila else t.textoSuave, style = traco())
        // Casquilho
        val base = Offset(c.x - r * 0.5f, c.y + r * 1.05f)
        drawRoundRect(t.textoSuave, base, Size(r, r * 0.55f), CornerRadius(2.dp.toPx()), style = traco())
        drawLine(t.textoSuave, Offset(base.x + r * 0.25f, base.y + r * 0.85f), Offset(base.x + r * 0.75f, base.y + r * 0.85f), 2.dp.toPx(), StrokeCap.Round)
    }
}

/** Luz: candeeiro com raios; a opacidade dos raios acompanha o brilho, com um leve cintilar. */
@Composable
fun Candeeiro(ligada: Boolean, brilho: Int, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val cintilar = pulso(ligada, 1400, 0.85f, 1f, 1f)
    val nivel = if (ligada) (brilho.coerceIn(0, 100) / 100f).coerceAtLeast(0.15f) * cintilar else 0f
    Desenho(if (ligada) "Luz acesa a $brilho %" else "Luz apagada", modifier) {
        val w = size.width
        val topo = w * 0.18f
        val baixo = w * 0.5f
        val abajur = Path().apply {
            moveTo(w * 0.36f, topo)
            lineTo(w * 0.64f, topo)
            lineTo(w * 0.78f, baixo)
            lineTo(w * 0.22f, baixo)
            close()
        }
        drawPath(abajur, if (ligada) t.areia.copy(alpha = 0.3f + 0.4f * nivel) else t.musgoClaro)
        drawPath(abajur, if (ligada) t.argila else t.textoSuave, style = traco())
        // Pé e base
        drawLine(t.textoSuave, Offset(w / 2, baixo), Offset(w / 2, w * 0.84f), 2.dp.toPx(), StrokeCap.Round)
        drawLine(t.textoSuave, Offset(w * 0.34f, w * 0.86f), Offset(w * 0.66f, w * 0.86f), 2.dp.toPx(), StrokeCap.Round)
        // Raios por baixo do abajur
        if (nivel > 0f) {
            for (i in -2..2) {
                val ang = (PI / 2 + i * 0.32).toFloat()
                val ini = Offset(w / 2 + cos(ang) * w * 0.3f, baixo + sin(ang) * w * 0.06f)
                val fim = Offset(w / 2 + cos(ang) * w * 0.46f, baixo + sin(ang) * w * 0.3f)
                drawLine(t.areia.copy(alpha = nivel), ini, fim, 2.dp.toPx(), StrokeCap.Round)
            }
        }
    }
}

/** Estore: janela com lâminas que deslizam até à posição atual (0 fechado – 100 aberto). */
@Composable
fun Estore(posicao: Int, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val alvo = 1f - posicao.coerceIn(0, 100) / 100f // fração da janela tapada
    val tapado by animateFloatAsState(
        alvo,
        if (LocalAnimacoes.current) tween(900) else snap(),
        label = "estore",
    )
    Desenho("Estore a $posicao %", modifier) {
        val w = size.width
        val x0 = w * 0.16f
        val y0 = w * 0.14f
        val lw = w * 0.68f
        val lh = w * 0.7f
        // Vidro (céu) atrás das lâminas
        drawRect(t.musgoClaro, Offset(x0, y0), Size(lw, lh))
        drawLine(t.borda, Offset(x0 + lw / 2, y0), Offset(x0 + lw / 2, y0 + lh), 1.dp.toPx())
        // Lâminas
        val h = lh * tapado
        if (h > 0f) {
            drawRect(t.areia.copy(alpha = 0.85f), Offset(x0, y0), Size(lw, h))
            val passo = 5.dp.toPx()
            var y = y0 + passo
            while (y < y0 + h) {
                drawLine(t.argila.copy(alpha = 0.6f), Offset(x0, y), Offset(x0 + lw, y), 1.dp.toPx())
                y += passo
            }
        }
        drawRect(t.textoSuave, Offset(x0, y0), Size(lw, lh), style = traco())
        // Caixa do estore
        drawLine(t.textoSuave, Offset(x0 - 2.dp.toPx(), y0), Offset(x0 + lw + 2.dp.toPx(), y0), 3.dp.toPx(), StrokeCap.Round)
    }
}

/** Porta de madeira (argila) que se abre em perspetiva quando aberta. */
@Composable
fun Porta(aberta: Boolean, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val abertura by animateFloatAsState(
        if (aberta) 1f else 0f,
        if (LocalAnimacoes.current) tween(700) else snap(),
        label = "porta",
    )
    Desenho(if (aberta) "Porta aberta" else "Porta fechada", modifier) {
        val w = size.width
        val x0 = w * 0.24f
        val y0 = w * 0.1f
        val lw = w * 0.52f
        val lh = w * 0.8f
        // Aro e interior escuro (visível com a porta aberta)
        drawRect(t.texto.copy(alpha = 0.18f * abertura), Offset(x0, y0), Size(lw, lh))
        drawRect(t.textoSuave, Offset(x0, y0), Size(lw, lh), style = traco())
        // Folha: roda na dobradiça da esquerda; a aresta livre encolhe e desce um pouco (perspetiva).
        val largura = lw * (1f - 0.7f * abertura)
        val inclina = lh * 0.08f * abertura
        val folha = Path().apply {
            moveTo(x0, y0)
            lineTo(x0 + largura, y0 + inclina)
            lineTo(x0 + largura, y0 + lh - inclina)
            lineTo(x0, y0 + lh)
            close()
        }
        drawPath(folha, t.argila.copy(alpha = 0.85f))
        drawPath(folha, t.argila, style = traco())
        // Puxador
        drawCircle(t.creme, 2.dp.toPx(), Offset(x0 + largura * 0.82f, y0 + lh * 0.55f))
    }
}

/** Movimento: figura com ondas concêntricas que se expandem durante 3 s depois de haver movimento. */
@Composable
fun Movimento(movimento: Boolean, ultimaMudanca: Instant?, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val animacoes = LocalAnimacoes.current
    val onda = remember { Animatable(0f) }
    LaunchedEffect(movimento, ultimaMudanca, animacoes) {
        onda.snapTo(0f)
        if (!movimento || !animacoes) return@LaunchedEffect
        // Só anima se o movimento é recente (não ao abrir a app com um valor antigo).
        val idade = ultimaMudanca?.let { Duration.between(it, Instant.now()).toMillis() } ?: MOVIMENTO_ANIMA_MS
        var resta = MOVIMENTO_ANIMA_MS - idade
        while (resta > 0) {
            onda.snapTo(0f)
            onda.animateTo(1f, tween(1000, easing = LinearEasing))
            resta -= 1000
        }
        onda.snapTo(0f)
    }
    val fase = onda.value
    Desenho(if (movimento) "Movimento detetado" else "Sem movimento", modifier) {
        val w = size.width
        val c = Offset(w * 0.5f, w * 0.5f)
        if (fase > 0f) {
            for (k in 0..1) {
                val f = (fase + k * 0.5f) % 1f
                drawCircle(t.musgo.copy(alpha = (1f - f) * 0.7f), w * (0.2f + 0.3f * f), c, style = traco())
            }
        }
        val cor = if (movimento) t.musgo else t.textoSuave
        // Cabeça, corpo, braços e pernas
        drawCircle(cor, w * 0.07f, Offset(c.x, w * 0.27f))
        drawLine(cor, Offset(c.x, w * 0.36f), Offset(c.x, w * 0.58f), 2.dp.toPx(), StrokeCap.Round)
        drawLine(cor, Offset(c.x - w * 0.12f, w * 0.46f), Offset(c.x + w * 0.12f, w * 0.42f), 2.dp.toPx(), StrokeCap.Round)
        drawLine(cor, Offset(c.x, w * 0.58f), Offset(c.x - w * 0.1f, w * 0.76f), 2.dp.toPx(), StrokeCap.Round)
        drawLine(cor, Offset(c.x, w * 0.58f), Offset(c.x + w * 0.12f, w * 0.74f), 2.dp.toPx(), StrokeCap.Round)
    }
}

/** Bateria: pilha cujo nível preenche; pisca em areia abaixo de 15 %. */
@Composable
fun Pilha(percentagem: Int?, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val p = percentagem?.coerceIn(0, 100)
    val fraca = p != null && p < 15
    val alfa = pulso(fraca, 700, 0.3f, 1f, 1f)
    val nivel by animateFloatAsState(
        (p ?: 0) / 100f,
        if (LocalAnimacoes.current) tween(600) else snap(),
        label = "pilha",
    )
    Desenho(if (p == null) "Bateria desconhecida" else "Bateria a $p %", modifier) {
        val w = size.width
        val x0 = w * 0.14f
        val y0 = w * 0.32f
        val lw = w * 0.64f
        val lh = w * 0.36f
        val m = 3.dp.toPx()
        val cor = if (fraca) t.areia.copy(alpha = alfa) else t.musgo
        if (nivel > 0f) {
            drawRoundRect(cor, Offset(x0 + m, y0 + m), Size((lw - 2 * m) * nivel, lh - 2 * m), CornerRadius(2.dp.toPx()))
        }
        drawRoundRect(t.textoSuave, Offset(x0, y0), Size(lw, lh), CornerRadius(4.dp.toPx()), style = traco())
        drawRoundRect(t.textoSuave, Offset(x0 + lw + 1.dp.toPx(), y0 + lh * 0.3f), Size(w * 0.06f, lh * 0.4f), CornerRadius(1.dp.toPx()))
    }
}

/** Medidor: raio num círculo, com um pulso cuja velocidade acompanha a potência. */
@Composable
fun Medidor(potenciaW: Double?, modifier: Modifier = Modifier, tamanho: Dp = 40.dp) {
    val t = LocalTerra.current
    val w = potenciaW ?: 0.0
    val ativo = w > 1.0
    // 2,4 s parado/baixo consumo → 0,6 s a 3500 W; em degraus para não reiniciar a animação a cada leitura.
    val calor = (w / 3500.0).coerceIn(0.0, 1.0)
    val duracao = (2400 - (calor * 1800).toInt()) / 200 * 200
    val pulsar = pulso(ativo, duracao, 0f, 1f, 0f)
    Desenho(if (ativo) "A consumir" else "Sem consumo", modifier, tamanho) {
        val s = size.width
        val c = Offset(s / 2, s / 2)
        val cor = if (calor > 0.8) t.argila else t.musgo
        if (ativo) drawCircle(cor.copy(alpha = 0.25f * (1f - pulsar)), s * (0.36f + 0.14f * pulsar), c)
        drawCircle(t.musgoClaro, s * 0.36f, c)
        drawCircle(cor, s * 0.36f, c, style = traco())
        val raio = Path().apply {
            moveTo(s * 0.54f, s * 0.2f)
            lineTo(s * 0.38f, s * 0.52f)
            lineTo(s * 0.5f, s * 0.52f)
            lineTo(s * 0.44f, s * 0.8f)
            lineTo(s * 0.64f, s * 0.44f)
            lineTo(s * 0.52f, s * 0.44f)
            close()
        }
        drawPath(raio, if (ativo) t.areia else t.textoSuave)
    }
}
