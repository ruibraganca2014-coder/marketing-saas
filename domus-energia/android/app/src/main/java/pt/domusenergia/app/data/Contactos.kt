package pt.domusenergia.app.data

import pt.domusenergia.app.BuildConfig

/**
 * Contactos da Domus Energia para "Fale connosco" (clientes com a subscrição gerida à mão).
 * Vêm do `app/build.gradle.kts` (`CONTACTO_WHATSAPP`, `CONTACTO_TELEFONE`); enquanto tiverem os valores de
 * exemplo (só zeros) o botão respetivo não aparece.
 */
object Contactos {
    /** Número em formato internacional só com algarismos (ex.: "351912345678"). */
    val whatsapp: String? get() = numero(BuildConfig.CONTACTO_WHATSAPP)

    /** Telefone a mostrar e a marcar (ex.: "+351 210 000 000"). */
    val telefone: String? get() = BuildConfig.CONTACTO_TELEFONE.takeIf { numero(it) != null }

    fun whatsappUrl(numero: String, texto: String = "Olá, sou cliente da Domus Energia e queria falar sobre a minha subscrição."): String =
        "https://wa.me/$numero?text=" + java.net.URLEncoder.encode(texto, "UTF-8").replace("+", "%20")

    fun telefoneUrl(telefone: String): String = "tel:" + telefone.filter { it.isDigit() || it == '+' }

    /** Algarismos do número, ou `null` se estiver vazio ou for o valor de exemplo (só zeros depois do indicativo). */
    fun numero(texto: String): String? {
        val d = texto.filter { it.isDigit() }
        if (d.length < 9 || d.removePrefix("351").all { it == '0' }) return null
        return d
    }
}
