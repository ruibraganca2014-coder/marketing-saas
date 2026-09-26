package pt.domusenergia.app.ui.tema

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Tema "Terra" da Domus Energia (docs/TEMA.md): tokens de cor para o modo claro e escuro.
 * Os nomes seguem os tokens CSS do site (`--fundo`, `--musgo`, ...).
 */
@Immutable
data class Terra(
    val escuro: Boolean,
    val fundo: Color,
    val superficie: Color,
    val texto: Color,
    val textoSuave: Color,
    val borda: Color,
    val musgo: Color,
    val musgoClaro: Color,
    val areia: Color,
    val argila: Color,
    val alarme: Color,
) {
    /** Texto sobre `--musgo` (e botão dos interruptores). */
    val creme: Color get() = Creme

    /** Sombra muito leve e quente dos cartões: rgba(40,54,24,.08). */
    val sombra: Color get() = Color(0x14283618)

    companion object {
        val Creme = Color(0xFFFEFAE0)

        val Claro = Terra(
            escuro = false,
            fundo = Color(0xFFFEFAE0),
            superficie = Color(0xFFFFFDF0),
            texto = Color(0xFF283618),
            textoSuave = Color(0xFF5C6446),
            borda = Color(0xFFE6E0BF),
            musgo = Color(0xFF606C38),
            musgoClaro = Color(0xFFEEF0D9),
            areia = Color(0xFFDDA15E),
            argila = Color(0xFFBC6C25),
            alarme = Color(0xFFA4372A),
        )

        val Escuro = Terra(
            escuro = true,
            fundo = Color(0xFF1A2310),
            superficie = Color(0xFF283618),
            texto = Color(0xFFFEFAE0),
            textoSuave = Color(0xFFC9C7A8),
            borda = Color(0xFF3A4A26),
            musgo = Color(0xFF8A9A5B),
            musgoClaro = Color(0xFF34441F),
            areia = Color(0xFFDDA15E),
            argila = Color(0xFFD9853B),
            alarme = Color(0xFFE0705F),
        )
    }
}

val LocalTerra = staticCompositionLocalOf { Terra.Claro }

/** `false` quando a escala de animações do sistema é 0: as ilustrações mostram só o estado final. */
val LocalAnimacoes = staticCompositionLocalOf { true }

/**
 * Tratamento do botão "voltar" do sistema. Na app é o `BackHandler` da androidx.activity
 * (fornecido pela MainActivity); fica aqui como função para os ecrãs não dependerem do Android.
 */
val LocalVoltar = staticCompositionLocalOf<@Composable (ativo: Boolean, aoVoltar: () -> Unit) -> Unit> { { _, _ -> } }

fun esquemaDeCores(t: Terra): ColorScheme {
    val base = if (t.escuro) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = t.musgo,
        onPrimary = t.creme,
        primaryContainer = t.musgoClaro,
        onPrimaryContainer = t.texto,
        inversePrimary = t.musgoClaro,
        secondary = t.argila,
        onSecondary = t.creme,
        secondaryContainer = t.musgoClaro,
        onSecondaryContainer = t.texto,
        tertiary = t.areia,
        onTertiary = Color(0xFF283618),
        tertiaryContainer = t.musgoClaro,
        onTertiaryContainer = t.texto,
        background = t.fundo,
        onBackground = t.texto,
        surface = t.superficie,
        onSurface = t.texto,
        surfaceVariant = t.musgoClaro,
        onSurfaceVariant = t.textoSuave,
        surfaceTint = t.musgo,
        inverseSurface = t.texto,
        inverseOnSurface = t.fundo,
        error = t.alarme,
        onError = t.creme,
        errorContainer = t.alarme.copy(alpha = 0.12f),
        onErrorContainer = t.alarme,
        outline = t.textoSuave,
        outlineVariant = t.borda,
        scrim = Color.Black,
        surfaceBright = t.superficie,
        surfaceDim = t.fundo,
        surfaceContainerLowest = t.superficie,
        surfaceContainerLow = t.superficie,
        surfaceContainer = t.superficie,
        surfaceContainerHigh = t.superficie,
        surfaceContainerHighest = t.borda,
    )
}

/**
 * Letra: títulos em Alegreya Sans (700/800), texto em Nunito Sans (400/600/700).
 * As famílias chegam de fora (Google Fonts descarregáveis na app; na falta, a sans do sistema).
 */
fun tipografia(titulos: FontFamily, texto: FontFamily): Typography {
    val b = Typography()
    fun TextStyle.titulo(peso: FontWeight = FontWeight.Bold) = copy(fontFamily = titulos, fontWeight = peso)
    fun TextStyle.corpo(peso: FontWeight = FontWeight.Normal) = copy(fontFamily = texto, fontWeight = peso)
    return Typography(
        displayLarge = b.displayLarge.titulo(FontWeight.ExtraBold),
        displayMedium = b.displayMedium.titulo(FontWeight.ExtraBold),
        displaySmall = b.displaySmall.titulo(FontWeight.ExtraBold),
        headlineLarge = b.headlineLarge.titulo(FontWeight.ExtraBold),
        headlineMedium = b.headlineMedium.titulo(FontWeight.ExtraBold),
        headlineSmall = b.headlineSmall.titulo(),
        titleLarge = b.titleLarge.titulo(),
        titleMedium = b.titleMedium.titulo(),
        titleSmall = b.titleSmall.titulo(),
        bodyLarge = b.bodyLarge.corpo(),
        bodyMedium = b.bodyMedium.corpo(),
        bodySmall = b.bodySmall.corpo(),
        labelLarge = b.labelLarge.corpo(FontWeight.SemiBold),
        labelMedium = b.labelMedium.corpo(FontWeight.SemiBold),
        labelSmall = b.labelSmall.corpo(FontWeight.SemiBold),
    )
}

/** Números (W, V, A, kWh, %) com algarismos de largura fixa (`tabular-nums`). */
val TextStyle.numeros: TextStyle get() = copy(fontFeatureSettings = "tnum")

/** Formas: 18 dp nos cartões, "pílula" (999 px) nos botões e interruptores. */
val FormaCartao = RoundedCornerShape(18.dp)
val FormaPilula = RoundedCornerShape(50)

@Composable
fun DomusTema(
    escuro: Boolean,
    titulos: FontFamily = FontFamily.SansSerif,
    texto: FontFamily = FontFamily.SansSerif,
    animacoes: Boolean = true,
    content: @Composable () -> Unit,
) {
    val terra = if (escuro) Terra.Escuro else Terra.Claro
    CompositionLocalProvider(LocalTerra provides terra, LocalAnimacoes provides animacoes) {
        MaterialTheme(
            colorScheme = esquemaDeCores(terra),
            typography = tipografia(titulos, texto),
            shapes = Shapes(
                extraSmall = RoundedCornerShape(8.dp),
                small = RoundedCornerShape(12.dp),
                medium = FormaCartao,
                large = FormaCartao,
                extraLarge = RoundedCornerShape(28.dp),
            ),
        ) {
            // Texto por omissão no tom do tema (os ecrãs usam fundos transparentes sobre o "fundo vivo",
            // e contentColorFor(Transparent) cairia no preto por omissão).
            CompositionLocalProvider(LocalContentColor provides terra.texto, content = content)
        }
    }
}
