package pt.domusenergia.app.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Guarda o código de cliente e a palavra-passe para a app continuar com a sessão iniciada,
 * e o último token FCM (para o registar/retirar no servidor).
 *
 * A palavra-passe fica cifrada (AES-256-GCM, [CofreSenha]) com uma chave do **Android Keystore**
 * ([ChaveKeystore]) que não sai do telemóvel; nas SharedPreferences só fica o texto cifrado. A palavra-passe
 * em texto simples das versões antigas é cifrada e apagada ao abrir ([CofreSenha.migrar]).
 * O código de cliente e o token FCM não são segredos e ficam como estavam. `android:allowBackup="false"`
 * continua (a chave do Keystore também não iria na cópia, e o valor cifrado seria inútil noutro telemóvel).
 *
 * Porquê o Keystore diretamente e não `androidx.security:security-crypto` (EncryptedSharedPreferences):
 * a biblioteca foi descontinuada pela Google (as APIs passaram a obsoletas na linha 1.1.x, a única que ainda
 * recebia correções; a 1.0.0 estável é de 2021), puxa o Tink (~1 MB) e tem problemas conhecidos de conjuntos
 * de chaves corrompidos que fazem a app falhar ao abrir. Para um só valor, o Keystore direto chega e não
 * junta dependências.
 */
class Sessao(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(NOME, Context.MODE_PRIVATE)
    private val cofre = CofreSenha(Preferencias(prefs), ChaveKeystore::obter)

    init {
        cofre.migrar()
    }

    val codigo: String? get() = prefs.getString("codigo", null)
    val password: String? get() = cofre.ler()
    val isLoggedIn: Boolean get() = codigo != null && password != null

    /** Último token FCM conhecido (fica guardado mesmo depois de sair: é do telemóvel, não do cliente). */
    var tokenFcm: String?
        get() = prefs.getString("token_fcm", null)
        set(v) = prefs.edit().putString("token_fcm", v).apply()

    /**
     * Guarda a sessão. Se o Keystore falhar, a palavra-passe não é guardada (nunca em texto simples):
     * a sessão aberta continua, mas da próxima vez a app pede para entrar.
     */
    fun guardar(codigo: String, password: String) {
        cofre.guardar(password, mapOf("codigo" to codigo))
    }

    fun limpar() = cofre.limpar(mapOf("codigo" to null))

    /** As SharedPreferences como [ArmazemTexto] (escrita síncrona: a migração tem de apagar mesmo o valor antigo). */
    private class Preferencias(private val p: SharedPreferences) : ArmazemTexto {
        override fun ler(chave: String): String? = p.getString(chave, null)

        override fun gravar(valores: Map<String, String?>): Boolean {
            val e = p.edit()
            for ((k, v) in valores) if (v == null) e.remove(k) else e.putString(k, v)
            return e.commit()
        }
    }

    companion object {
        const val NOME = "sessao"
    }
}

/**
 * Chave AES-256 (GCM, sem padding) no Android Keystore, criada na primeira vez. Sem autenticação do
 * utilizador nem "só desbloqueado": o WorkManager (presença) tem de a usar com o ecrã bloqueado.
 */
internal object ChaveKeystore {
    private const val FORNECEDOR = "AndroidKeyStore"
    private const val ALIAS = "domus_sessao_aes_gcm_v1"

    @Volatile
    private var cache: SecretKey? = null

    /** A chave, ou `null` se o Keystore não estiver disponível (a app continua, sem guardar a palavra-passe). */
    @Synchronized
    fun obter(): SecretKey? {
        cache?.let { return it }
        return try {
            val ks = KeyStore.getInstance(FORNECEDOR).apply { load(null) }
            val k = (ks.getKey(ALIAS, null) as? SecretKey) ?: gerar()
            cache = k
            k
        } catch (e: Exception) {
            // KeyStoreException, ProviderException, … (Keystores de alguns fabricantes falham de formas várias)
            null
        }
    }

    private fun gerar(): SecretKey {
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, FORNECEDOR)
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return g.generateKey()
    }
}
