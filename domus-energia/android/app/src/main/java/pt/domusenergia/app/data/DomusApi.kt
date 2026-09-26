package pt.domusenergia.app.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import pt.domusenergia.app.BuildConfig
import pt.domusenergia.app.tuya.Device

class ApiException(message: String, val sessionExpired: Boolean = false) : Exception(message)

/**
 * Fala com o Supabase da Domus Energia:
 * - login do cliente (Supabase Auth)
 * - função "tuya", que lista e controla os aparelhos desse cliente
 */
class DomusApi(context: Context) {

    private val http = OkHttpClient()
    private val prefs = context.getSharedPreferences("sessao", Context.MODE_PRIVATE)
    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    val isLoggedIn get() = prefs.getString("refresh_token", null) != null
    val email get() = prefs.getString("email", "") ?: ""

    suspend fun login(email: String, password: String) {
        val body = JSONObject().put("email", email.trim()).put("password", password)
        val json = post("$baseUrl/auth/v1/token?grant_type=password", body, bearer = null)
        saveSession(json)
    }

    fun logout() = prefs.edit().clear().apply()

    suspend fun listDevices(): List<Device> {
        val json = callFunction(JSONObject().put("action", "list"))
        val array = json.getJSONArray("devices")
        return (0 until array.length()).map { Device.fromJson(array.getJSONObject(it)) }
    }

    suspend fun setSwitch(deviceId: String, code: String, value: Boolean) {
        callFunction(
            JSONObject()
                .put("action", "command")
                .put("device_id", deviceId)
                .put("code", code)
                .put("value", value)
        )
    }

    private suspend fun callFunction(body: JSONObject): JSONObject {
        val url = "$baseUrl/functions/v1/tuya"
        return try {
            post(url, body, bearer = accessToken())
        } catch (e: ApiException) {
            if (!e.sessionExpired) throw e
            refreshSession()
            post(url, body, bearer = accessToken())
        }
    }

    private suspend fun accessToken(): String {
        val expiresAt = prefs.getLong("expires_at", 0)
        if (System.currentTimeMillis() > expiresAt) refreshSession()
        return prefs.getString("access_token", null) ?: throw ApiException("Sessão terminada.", sessionExpired = true)
    }

    private suspend fun refreshSession() {
        val refresh = prefs.getString("refresh_token", null)
            ?: throw ApiException("Sessão terminada.", sessionExpired = true)
        try {
            val json = post(
                "$baseUrl/auth/v1/token?grant_type=refresh_token",
                JSONObject().put("refresh_token", refresh),
                bearer = null,
            )
            saveSession(json)
        } catch (e: ApiException) {
            logout()
            throw ApiException("Sessão terminada. Entra outra vez.", sessionExpired = true)
        }
    }

    private fun saveSession(json: JSONObject) {
        prefs.edit()
            .putString("access_token", json.getString("access_token"))
            .putString("refresh_token", json.getString("refresh_token"))
            // Renova um minuto antes de expirar.
            .putLong("expires_at", System.currentTimeMillis() + (json.getLong("expires_in") - 60) * 1000)
            .putString("email", json.optJSONObject("user")?.optString("email") ?: email)
            .apply()
    }

    private suspend fun post(url: String, body: JSONObject, bearer: String?): JSONObject =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(url)
                .header("apikey", anonKey)
                .header("Authorization", "Bearer ${bearer ?: anonKey}")
                .post(body.toString().toRequestBody(JSON))
                .build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                if (!response.isSuccessful) {
                    val message = json.optString("error_description")
                        .ifBlank { json.optString("error") }
                        .ifBlank { json.optString("msg") }
                        .ifBlank { "Erro ${response.code}" }
                    throw ApiException(message, sessionExpired = response.code == 401)
                }
                json
            }
        }

    companion object {
        private val JSON = "application/json".toMediaType()
    }
}
