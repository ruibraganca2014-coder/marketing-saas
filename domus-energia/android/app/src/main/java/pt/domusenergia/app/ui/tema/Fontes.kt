package pt.domusenergia.app.ui.tema

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import pt.domusenergia.app.R

/**
 * Alegreya Sans e Nunito Sans como Google Fonts descarregáveis (através dos Google Play Services).
 * Se não for possível descarregar (sem Play Services, sem rede), o Compose usa a letra sans do sistema.
 * Certificados do fornecedor: res/values/font_certs.xml.
 */
object Fontes {
    private val fornecedor = GoogleFont.Provider(
        providerAuthority = "com.google.android.gms.fonts",
        providerPackage = "com.google.android.gms",
        certificates = R.array.com_google_android_gms_fonts_certs,
    )

    private val alegreyaSans = GoogleFont("Alegreya Sans")
    private val nunitoSans = GoogleFont("Nunito Sans")

    val titulos = FontFamily(
        Font(googleFont = alegreyaSans, fontProvider = fornecedor, weight = FontWeight.Bold),
        Font(googleFont = alegreyaSans, fontProvider = fornecedor, weight = FontWeight.ExtraBold),
    )

    val texto = FontFamily(
        Font(googleFont = nunitoSans, fontProvider = fornecedor, weight = FontWeight.Normal),
        Font(googleFont = nunitoSans, fontProvider = fornecedor, weight = FontWeight.SemiBold),
        Font(googleFont = nunitoSans, fontProvider = fornecedor, weight = FontWeight.Bold),
    )
}
