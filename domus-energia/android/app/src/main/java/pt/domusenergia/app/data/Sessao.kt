package pt.domusenergia.app.data

import android.content.Context

/**
 * Guarda o código de cliente e a palavra-passe para a app continuar com a sessão iniciada,
 * e o último token FCM (para o registar/retirar no servidor).
 *
 * Protótipo: a palavra-passe fica em SharedPreferences em texto simples (privadas da app, e
 * android:allowBackup="false"). Próximo passo: EncryptedSharedPreferences / Android Keystore.
 */
class Sessao(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(NOME, Context.MODE_PRIVATE)

    val codigo: String? get() = prefs.getString("codigo", null)
    val password: String? get() = prefs.getString("password", null)
    val isLoggedIn: Boolean get() = codigo != null && password != null

    /** Último token FCM conhecido (fica guardado mesmo depois de sair: é do telemóvel, não do cliente). */
    var tokenFcm: String?
        get() = prefs.getString("token_fcm", null)
        set(v) = prefs.edit().putString("token_fcm", v).apply()

    fun guardar(codigo: String, password: String) {
        prefs.edit().putString("codigo", codigo).putString("password", password).apply()
    }

    fun limpar() = prefs.edit().remove("codigo").remove("password").apply()

    companion object {
        const val NOME = "sessao"
    }
}
