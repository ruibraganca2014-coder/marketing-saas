package pt.domusenergia.app.data

import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM com uma chave dada (no telemóvel, uma chave do Android Keystore que nunca sai do
 * hardware/TEE; nos testes, uma chave AES normal). Código puro (javax.crypto + java.util.Base64, API 26+).
 *
 * Formato guardado: `v1:<iv base64>:<cifrado+tag base64>`. O IV (12 bytes) é gerado pelo fornecedor a
 * cada cifra (o Android Keystore obriga: `randomizedEncryptionRequired`). [aad] liga o texto cifrado ao
 * sítio onde está guardado (não se pode copiar para outra preferência).
 */
object CifraGcm {
    private const val VERSAO = "v1"
    private const val TRANSFORMACAO = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
    private const val IV_BYTES = 12

    fun cifrar(chave: SecretKey, texto: String, aad: ByteArray): String {
        val c = Cipher.getInstance(TRANSFORMACAO)
        c.init(Cipher.ENCRYPT_MODE, chave)
        c.updateAAD(aad)
        val cifrado = c.doFinal(texto.toByteArray(StandardCharsets.UTF_8))
        val iv = c.iv
        check(iv != null && iv.size == IV_BYTES) { "IV inesperado" }
        val b64 = Base64.getEncoder()
        return "$VERSAO:${b64.encodeToString(iv)}:${b64.encodeToString(cifrado)}"
    }

    /**
     * @throws FormatoInvalido se [guardado] não tiver o formato certo.
     * @throws AEADBadTagException se tiver sido alterado, cifrado com outra chave ou com outro [aad].
     * @throws GeneralSecurityException outros erros do fornecedor (ex.: Keystore indisponível).
     */
    fun decifrar(chave: SecretKey, guardado: String, aad: ByteArray): String {
        val partes = guardado.split(':')
        if (partes.size != 3 || partes[0] != VERSAO) throw FormatoInvalido()
        val (iv, cifrado) = try {
            Base64.getDecoder().decode(partes[1]) to Base64.getDecoder().decode(partes[2])
        } catch (e: IllegalArgumentException) {
            throw FormatoInvalido()
        }
        if (iv.size != IV_BYTES || cifrado.size < TAG_BITS / 8) throw FormatoInvalido()
        val c = Cipher.getInstance(TRANSFORMACAO)
        c.init(Cipher.DECRYPT_MODE, chave, GCMParameterSpec(TAG_BITS, iv))
        c.updateAAD(aad)
        return String(c.doFinal(cifrado), StandardCharsets.UTF_8)
    }

    class FormatoInvalido : Exception("Formato do valor cifrado inválido")
}

/** Onde o [CofreSenha] guarda texto (no telemóvel, as SharedPreferences da sessão; nos testes, um mapa). */
interface ArmazemTexto {
    fun ler(chave: String): String?

    /** Grava tudo de uma vez (`null` = apagar a chave). `false` se não conseguiu escrever. */
    fun gravar(valores: Map<String, String?>): Boolean
}

/**
 * A palavra-passe da sessão, cifrada com [CifraGcm] e uma chave do Keystore ([chave]; `null` = Keystore
 * indisponível). Nunca fica em texto simples no disco:
 * - [migrar] cifra e **apaga** a palavra-passe em texto simples das versões antigas da app (uma só vez:
 *   depois disso a chave antiga já não existe). Se o Keystore falhar, apaga-a na mesma (o cliente volta a
 *   entrar) — melhor do que deixá-la em claro.
 * - Se não for possível cifrar ao [guardar], não se guarda a palavra-passe: a sessão continua aberta em
 *   memória, mas na próxima abertura da app pede-se outra vez.
 * - Se o valor guardado já não se decifrar (chave apagada/trocada, valor alterado), é esquecido.
 */
class CofreSenha(
    private val armazem: ArmazemTexto,
    private val chave: () -> SecretKey?,
    private val aad: ByteArray = AAD_PADRAO,
) {
    fun migrar() {
        val antiga = armazem.ler(CHAVE_ANTIGA) ?: return
        armazem.gravar(mapOf(CHAVE_CIFRADA to cifrar(antiga), CHAVE_ANTIGA to null))
    }

    /** A palavra-passe guardada, ou `null` (não há, Keystore indisponível agora, ou já não se decifra). */
    fun ler(): String? {
        val guardada = armazem.ler(CHAVE_CIFRADA) ?: return null
        val k = chave() ?: return null
        return try {
            CifraGcm.decifrar(k, guardada, aad)
        } catch (e: AEADBadTagException) {
            armazem.gravar(mapOf(CHAVE_CIFRADA to null))
            null
        } catch (e: CifraGcm.FormatoInvalido) {
            armazem.gravar(mapOf(CHAVE_CIFRADA to null))
            null
        } catch (e: GeneralSecurityException) {
            null // erro passageiro do Keystore: não se apaga nada
        } catch (e: RuntimeException) {
            null // alguns Keystores atiram ProviderException/IllegalStateException
        }
    }

    fun existe(): Boolean = armazem.ler(CHAVE_CIFRADA) != null

    /**
     * Guarda [senha] cifrada, junto com [outros] valores (ex.: o código de cliente), numa só escrita.
     * @return `true` se a palavra-passe ficou guardada (cifrada).
     */
    fun guardar(senha: String, outros: Map<String, String?> = emptyMap()): Boolean {
        val cifrada = cifrar(senha)
        val ok = armazem.gravar(outros + mapOf(CHAVE_CIFRADA to cifrada, CHAVE_ANTIGA to null))
        return ok && cifrada != null
    }

    fun limpar(outros: Map<String, String?> = emptyMap()) {
        armazem.gravar(outros + mapOf(CHAVE_CIFRADA to null, CHAVE_ANTIGA to null))
    }

    private fun cifrar(texto: String): String? {
        val k = chave() ?: return null
        return try {
            CifraGcm.cifrar(k, texto, aad)
        } catch (e: GeneralSecurityException) {
            null
        } catch (e: RuntimeException) {
            null
        }
    }

    companion object {
        /** Onde as versões antigas guardavam a palavra-passe em texto simples. */
        const val CHAVE_ANTIGA = "password"
        const val CHAVE_CIFRADA = "password_gcm"
        val AAD_PADRAO: ByteArray = "pt.domusenergia.app/sessao/password".toByteArray(StandardCharsets.UTF_8)
    }
}
