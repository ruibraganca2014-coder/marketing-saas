package pt.domusenergia.app.data

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import pt.domusenergia.app.BuildConfig
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Erro do serviço de pagamentos, com a mensagem a mostrar ao cliente (pt-PT).
 * @property tipo para quem chama decidir (ex.: [Tipo.SESSAO_EXPIRADA] → pedir outro token e repetir).
 */
class PagamentosException(message: String, val tipo: Tipo, cause: Throwable? = null) : Exception(message, cause) {
    enum class Tipo { CREDENCIAIS, SESSAO_EXPIRADA, LIMITE, REDE, SERVIDOR, PEDIDO, RESPOSTA }
}

/**
 * Cliente HTTP do serviço `pagamentos` (docs/PROTOCOLO-PLANOS.md §4), atrás do Caddy em `https://HOST/api/`.
 * Kotlin puro + OkHttp (sem Android): os testes usam um servidor HTTP local ([base] injetável).
 *
 * Chamadas **bloqueantes**: no Android correm em `Dispatchers.IO`.
 */
class PagamentosApi(
    base: String = "https://${BuildConfig.MQTT_HOST}/api/",
    private val http: OkHttpClient = CLIENTE,
) {
    private val base: HttpUrl = (if (base.endsWith("/")) base else "$base/").toHttpUrl()

    /**
     * `POST /api/sessao` `{codigo, password}` → token de sessão curto (15 min) só para o `/api`.
     * O servidor verifica as credenciais com uma ligação MQTT (as mesmas da app).
     */
    fun sessao(codigo: String, password: String): String {
        val corpo = "{\"codigo\":${jsonTexto(codigo)},\"password\":${jsonTexto(password)}}"
        val o = pedir("sessao", corpo, token = null)
        return (o.opt("token") as? String)?.takeIf { it.isNotBlank() } ?: throw respostaInvalida()
    }

    /** `POST /api/checkout` `{plano}` (Bearer) → endereço da página de pagamento (Stripe Checkout). */
    fun checkout(token: String, plano: String): String {
        require(plano in Planos.TODOS) { "Plano desconhecido: $plano" }
        return url(pedir("checkout", "{\"plano\":${jsonTexto(plano)}}", token))
    }

    /** `POST /api/portal` (Bearer) → endereço do portal de pagamentos e faturas (Stripe Customer Portal). */
    fun portal(token: String): String = url(pedir("portal", "{}", token))

    private fun url(o: JSONObject): String {
        val u = (o.opt("url") as? String)?.trim().orEmpty()
        // Só se abrem páginas https (nunca outro esquema vindo da rede).
        if (!u.startsWith("https://", ignoreCase = true) || u.any { it.isWhitespace() }) throw respostaInvalida()
        return u
    }

    private fun pedir(caminho: String, corpoJson: String, token: String?): JSONObject {
        val req = Request.Builder()
            .url(base.resolve(caminho)!!)
            .header("Accept", "application/json")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .post(corpoJson.toRequestBody(JSON))
            .build()
        val resposta: Response = try {
            http.newCall(req).execute()
        } catch (e: IOException) {
            throw PagamentosException(SEM_REDE, PagamentosException.Tipo.REDE, e)
        }
        resposta.use { r ->
            val texto = try {
                r.body?.string().orEmpty()
            } catch (e: IOException) {
                throw PagamentosException(SEM_REDE, PagamentosException.Tipo.REDE, e)
            }
            val o = V3.objeto(texto)
            if (r.isSuccessful) return o ?: throw respostaInvalida()
            val doServidor = (o?.opt("erro") as? String)?.trim()?.takeIf { it.isNotEmpty() && it.length <= 200 }
            throw when (r.code) {
                401 -> if (token == null) {
                    PagamentosException("Código ou palavra-passe errados.", PagamentosException.Tipo.CREDENCIAIS)
                } else {
                    PagamentosException("A sessão expirou. Tente outra vez.", PagamentosException.Tipo.SESSAO_EXPIRADA)
                }
                429 -> PagamentosException(textoLimite(r.header("Retry-After")), PagamentosException.Tipo.LIMITE)
                in 500..599 -> PagamentosException(
                    "O serviço de pagamentos não está disponível agora. Tente mais tarde.", PagamentosException.Tipo.SERVIDOR,
                )
                else -> PagamentosException(doServidor ?: "Não foi possível tratar o pedido. Tente mais tarde.", PagamentosException.Tipo.PEDIDO)
            }
        }
    }

    private fun respostaInvalida() =
        PagamentosException("Resposta inesperada do servidor. Tente mais tarde.", PagamentosException.Tipo.RESPOSTA)

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        const val SEM_REDE = "Sem ligação ao servidor. Verifique a Internet e tente outra vez."

        val CLIENTE: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .callTimeout(30, TimeUnit.SECONDS)
                .build()
        }

        /**
         * Texto JSON entre aspas. Feito à mão para o corpo ser igual no Android e na JVM (o `JSONObject.quote`
         * do Android escapa sempre a `/`, o da JVM não).
         */
        fun jsonTexto(s: String): String = buildString {
            append('"')
            for (c in s) {
                when {
                    c == '"' -> append("\\\"")
                    c == '\\' -> append("\\\\")
                    c == '\n' -> append("\\n")
                    c == '\r' -> append("\\r")
                    c == '\t' -> append("\\t")
                    c < ' ' || c == '\u2028' || c == '\u2029' -> append("\\u").append(String.format("%04x", c.code))
                    else -> append(c)
                }
            }
            append('"')
        }

        /** 429: "Demasiadas tentativas…", com os segundos do `Retry-After` quando vierem (e forem poucos). */
        fun textoLimite(retryAfter: String?): String {
            val s = retryAfter?.trim()?.toLongOrNull()
            return when {
                s == null || s <= 0 || s > 3600 -> "Demasiadas tentativas. Aguarde um pouco e tente outra vez."
                s < 90 -> "Demasiadas tentativas. Aguarde $s s e tente outra vez."
                else -> "Demasiadas tentativas. Aguarde ${(s + 59) / 60} min e tente outra vez."
            }
        }
    }
}

/**
 * Sessão do `/api` para a app: pede o token com as credenciais guardadas ([credenciais], no Android a
 * `Sessao` com a palavra-passe decifrada pelo Keystore), guarda-o em memória até perto de expirar e,
 * se o servidor responder 401 com um token (expirado/revogado), pede outro **uma** vez e repete.
 */
class PagamentosCliente(
    private val api: PagamentosApi,
    private val credenciais: () -> Pair<String, String>?,
    private val relogio: () -> Instant = Instant::now,
    private val validade: Duration = Duration.ofMinutes(13), // o token dura 15 min
) {
    private var token: String? = null
    private var obtido: Instant = Instant.EPOCH
    private var dono: String? = null

    @Synchronized
    fun checkout(plano: String): String = comToken { api.checkout(it, plano) }

    @Synchronized
    fun portal(): String = comToken { api.portal(it) }

    @Synchronized
    fun esquecer() {
        token = null
        dono = null
    }

    private fun comToken(f: (String) -> String): String {
        val t = tokenValido(false)
        return try {
            f(t)
        } catch (e: PagamentosException) {
            if (e.tipo != PagamentosException.Tipo.SESSAO_EXPIRADA) throw e
            f(tokenValido(true))
        }
    }

    private fun tokenValido(novo: Boolean): String {
        val (codigo, password) = credenciais() ?: run {
            esquecer()
            throw PagamentosException(
                "Por segurança, saia e volte a entrar na app para gerir a subscrição.", PagamentosException.Tipo.CREDENCIAIS,
            )
        }
        val agora = relogio()
        val t = token
        if (!novo && t != null && dono == codigo && Duration.between(obtido, agora) < validade) return t
        val n = api.sessao(codigo, password)
        token = n
        dono = codigo
        obtido = agora
        return n
    }
}
