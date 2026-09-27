package pt.domusenergia.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
import kotlin.math.cos
import kotlin.math.sin

/**
 * Ícones das cenas (`filme`, `sol`, `lua`, `porta`, `casa`, `energia`, `luz`, `estrela`), desenhados à mão
 * em traço de 2 dp como as ilustrações (docs/TEMA.md); o conjunto "core" do Material não os tem.
 */
@Composable
fun IconeCena(icone: String, cor: Color, modifier: Modifier = Modifier, tamanho: Dp = 24.dp) {
    Canvas(modifier.size(tamanho).semantics { contentDescription = icone }) {
        val w = size.width
        val s = Stroke(width = (w / 12f).coerceAtLeast(1.5f), cap = StrokeCap.Round, join = StrokeJoin.Round)
        when (icone) {
            "filme" -> {
                drawRoundRect(cor, Offset(w * .12f, w * .34f), Size(w * .76f, w * .52f), CornerRadius(w * .06f), style = s)
                // claquete inclinada
                val p = Path().apply {
                    moveTo(w * .12f, w * .30f); lineTo(w * .82f, w * .12f)
                }
                drawPath(p, cor, style = s)
                drawLine(cor, Offset(w * .36f, w * .24f), Offset(w * .30f, w * .33f), s.width, StrokeCap.Round)
                drawLine(cor, Offset(w * .60f, w * .18f), Offset(w * .54f, w * .27f), s.width, StrokeCap.Round)
            }
            "sol" -> {
                drawCircle(cor, w * .18f, center, style = s)
                for (i in 0 until 8) {
                    val a = Math.toRadians(i * 45.0)
                    val c = center
                    drawLine(
                        cor,
                        Offset(c.x + (w * .30f) * cos(a).toFloat(), c.y + (w * .30f) * sin(a).toFloat()),
                        Offset(c.x + (w * .42f) * cos(a).toFloat(), c.y + (w * .42f) * sin(a).toFloat()),
                        s.width, StrokeCap.Round,
                    )
                }
            }
            "lua" -> {
                val p = Path().apply {
                    moveTo(w * .62f, w * .12f)
                    cubicTo(w * .20f, w * .14f, w * .12f, w * .72f, w * .52f, w * .86f)
                    cubicTo(w * .70f, w * .92f, w * .84f, w * .82f, w * .90f, w * .70f)
                    cubicTo(w * .52f, w * .74f, w * .38f, w * .34f, w * .62f, w * .12f)
                    close()
                }
                drawPath(p, cor, style = s)
            }
            "porta" -> {
                drawRoundRect(cor, Offset(w * .24f, w * .10f), Size(w * .52f, w * .80f), CornerRadius(w * .04f), style = s)
                drawCircle(cor, w * .04f, Offset(w * .64f, w * .52f))
                drawLine(cor, Offset(w * .12f, w * .90f), Offset(w * .88f, w * .90f), s.width, StrokeCap.Round)
            }
            "energia" -> {
                val p = Path().apply {
                    moveTo(w * .58f, w * .08f); lineTo(w * .26f, w * .54f); lineTo(w * .48f, w * .54f)
                    lineTo(w * .40f, w * .92f); lineTo(w * .74f, w * .42f); lineTo(w * .52f, w * .42f); close()
                }
                drawPath(p, cor, style = s)
            }
            "luz" -> {
                drawCircle(cor, w * .24f, Offset(w * .5f, w * .40f), style = s)
                drawLine(cor, Offset(w * .40f, w * .70f), Offset(w * .60f, w * .70f), s.width, StrokeCap.Round)
                drawLine(cor, Offset(w * .42f, w * .82f), Offset(w * .58f, w * .82f), s.width, StrokeCap.Round)
            }
            "estrela" -> {
                val p = Path()
                for (i in 0 until 10) {
                    val r = if (i % 2 == 0) w * .42f else w * .18f
                    val a = Math.toRadians(-90.0 + i * 36.0)
                    val x = w * .5f + r * cos(a).toFloat()
                    val y = w * .54f + r * sin(a).toFloat()
                    if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
                }
                p.close()
                drawPath(p, cor, style = s)
            }
            else -> casa(cor, s)
        }
    }
}

private fun DrawScope.casa(cor: Color, s: Stroke) {
    val w = size.width
    val p = Path().apply {
        moveTo(w * .12f, w * .48f); lineTo(w * .5f, w * .14f); lineTo(w * .88f, w * .48f)
        moveTo(w * .22f, w * .40f); lineTo(w * .22f, w * .86f); lineTo(w * .78f, w * .86f); lineTo(w * .78f, w * .40f)
        moveTo(w * .42f, w * .86f); lineTo(w * .42f, w * .62f); lineTo(w * .58f, w * .62f); lineTo(w * .58f, w * .86f)
    }
    drawPath(p, cor, style = s)
}

/** Barras do sinal Wi-Fi (0–4; 0 = desconhecido, só contornos). */
@Composable
fun BarrasSinal(barras: Int, cor: Color, vazio: Color, modifier: Modifier = Modifier) {
    Row(modifier.semantics { contentDescription = "Sinal: $barras de 4" }) {
        Canvas(Modifier.size(width = 22.dp, height = 16.dp)) {
            val larg = size.width / 4f
            for (i in 0 until 4) {
                val alt = size.height * (i + 1) / 4f
                val x = i * larg + larg * .15f
                drawRoundRect(
                    if (i < barras) cor else vazio,
                    Offset(x, size.height - alt),
                    Size(larg * .7f, alt),
                    CornerRadius(larg * .2f),
                )
            }
        }
    }
}

/** Espaço fixo para alinhar ícones em listas. */
@Composable
fun EspacoIcone() = androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp))
