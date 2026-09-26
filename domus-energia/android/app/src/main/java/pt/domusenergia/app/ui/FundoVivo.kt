package pt.domusenergia.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import pt.domusenergia.app.data.Resumo
import pt.domusenergia.app.ui.tema.LocalAnimacoes
import pt.domusenergia.app.ui.tema.LocalTerra

private const val TRANSICAO_MS = 4000

/**
 * "Fundo vivo" (docs/TEMA.md): gradiente suave que muda devagar (4 s) com o estado da casa.
 * - topo: mistura de `--fundo` com `--musgo-claro` pela fração de luzes/circuitos ligados;
 * - baixo: mistura de `--fundo` com `--areia` por `calor * .35` (calor = potência / 3500 W);
 * - calor > .8: um toque de `--argila` no canto inferior; alarme ativo: halo leve de `--alarme` no topo.
 * As cores ficam sempre muito perto do fundo, para o texto manter o contraste.
 */
@Composable
fun FundoVivo(resumo: Resumo?, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val t = LocalTerra.current
    val calor = resumo?.calor ?: 0f
    val luzes = resumo?.luzes ?: 0f
    val alarme = resumo?.alarme == true
    val animar = LocalAnimacoes.current
    val specCor = if (animar) tween<Color>(TRANSICAO_MS) else snap()
    val specNum = if (animar) tween<Float>(TRANSICAO_MS) else snap()

    val topo by animateColorAsState(lerp(t.fundo, t.musgoClaro, luzes), specCor, label = "fundo-topo")
    val baixo by animateColorAsState(lerp(t.fundo, t.areia, calor * 0.35f), specCor, label = "fundo-baixo")
    val argila by animateFloatAsState(if (calor > 0.8f) (calor - 0.8f) / 0.2f else 0f, specNum, label = "fundo-argila")
    val halo by animateFloatAsState(if (alarme) 1f else 0f, specNum, label = "fundo-alarme")

    Box(
        modifier.drawBehind {
            drawRect(Brush.verticalGradient(listOf(topo, baixo)))
            if (argila > 0f) {
                drawRect(
                    Brush.radialGradient(
                        listOf(t.argila.copy(alpha = 0.18f * argila), Color.Transparent),
                        center = Offset(size.width, size.height),
                        radius = size.width * 0.9f,
                    )
                )
            }
            if (halo > 0f) {
                drawRect(
                    Brush.radialGradient(
                        listOf(t.alarme.copy(alpha = 0.14f * halo), Color.Transparent),
                        center = Offset(size.width / 2, 0f),
                        radius = size.width * 0.8f,
                    )
                )
            }
        },
        content = content,
    )
}
