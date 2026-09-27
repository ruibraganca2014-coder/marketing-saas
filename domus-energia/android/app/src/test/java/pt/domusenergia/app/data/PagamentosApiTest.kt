package pt.domusenergia.app.data

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Cliente do serviço `pagamentos` (§4) contra um servidor HTTP local (MockWebServer). */
class PagamentosApiTest {
    private lateinit var srv: MockWebServer
    private lateinit var api: PagamentosApi
    private val http = OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).callTimeout(3, TimeUnit.SECONDS).build()

    @Before
    fun setUp() {
        srv = MockWebServer()
        srv.start()
        api = PagamentosApi(srv.url("/api/").toString(), http)
    }

    @After
    fun tearDown() = srv.shutdown()

    private fun json(code: Int, corpo: String, vararg cab: Pair<String, String>) = MockResponse().setResponseCode(code)
        .setHeader("Content-Type", "application/json").setBody(corpo).apply { cab.forEach { (k, v) -> setHeader(k, v) } }

    private fun pedido(): RecordedRequest = srv.takeRequest(1, TimeUnit.SECONDS)!!

    private fun erro(f: () -> Unit): PagamentosException {
        try {
            f()
        } catch (e: PagamentosException) {
            return e
        }
        fail("esperava PagamentosException")
        throw AssertionError()
    }

    @Test
    fun `sessao envia codigo e password em JSON e devolve o token`() {
        srv.enqueue(json(200, """{"token":"eyJ.abc.def","expira":"2026-10-01T10:15:00Z"}"""))
        assertEquals("eyJ.abc.def", api.sessao("joao", "pa\"ss/\\wörd\n"))
        val r = pedido()
        assertEquals("POST", r.method)
        assertEquals("/api/sessao", r.path)
        assertEquals("""{"codigo":"joao","password":"pa\"ss/\\wörd\n"}""", r.body.readUtf8())
        assertEquals("application/json; charset=utf-8", r.getHeader("Content-Type"))
        assertEquals("application/json", r.getHeader("Accept"))
        assertNull(r.getHeader("Authorization"))
    }

    @Test
    fun `base sem barra final tambem serve`() {
        val a = PagamentosApi(srv.url("/api").toString(), http)
        srv.enqueue(json(200, """{"token":"t"}"""))
        a.sessao("joao", "x")
        assertEquals("/api/sessao", pedido().path)
    }

    @Test
    fun `checkout com Bearer e plano, devolve url https`() {
        srv.enqueue(json(200, """{"url":"https://checkout.stripe.com/c/pay/cs_test_123"}"""))
        assertEquals("https://checkout.stripe.com/c/pay/cs_test_123", api.checkout("tok-1", "premium"))
        val r = pedido()
        assertEquals("POST", r.method)
        assertEquals("/api/checkout", r.path)
        assertEquals("Bearer tok-1", r.getHeader("Authorization"))
        assertEquals("""{"plano":"premium"}""", r.body.readUtf8())
        assertEquals("application/json; charset=utf-8", r.getHeader("Content-Type"))
    }

    @Test
    fun `checkout recusa plano desconhecido sem pedir nada`() {
        try {
            api.checkout("t", "ouro")
            fail()
        } catch (e: IllegalArgumentException) {
            // ok
        }
        assertEquals(0, srv.requestCount)
    }

    @Test
    fun `portal com Bearer e corpo vazio`() {
        srv.enqueue(json(200, """{"url":"https://billing.stripe.com/p/session/abc"}"""))
        assertEquals("https://billing.stripe.com/p/session/abc", api.portal("tok-2"))
        val r = pedido()
        assertEquals("/api/portal", r.path)
        assertEquals("Bearer tok-2", r.getHeader("Authorization"))
        assertEquals("{}", r.body.readUtf8())
    }

    @Test
    fun `url que nao seja https e recusada`() {
        for (u in listOf("http://checkout.stripe.com/x", "javascript:alert(1)", "intent://x#Intent;end", "", "https://a b")) {
            srv.enqueue(json(200, """{"url":${PagamentosApi.jsonTexto(u)}}"""))
            val e = erro { api.checkout("t", "base") }
            assertEquals(u, PagamentosException.Tipo.RESPOSTA, e.tipo)
            assertEquals("Resposta inesperada do servidor. Tente mais tarde.", e.message)
        }
        srv.enqueue(json(200, "<html>ok</html>"))
        assertEquals(PagamentosException.Tipo.RESPOSTA, erro { api.portal("t") }.tipo)
        srv.enqueue(json(200, """{"token":""}"""))
        assertEquals(PagamentosException.Tipo.RESPOSTA, erro { api.sessao("a", "b") }.tipo)
    }

    @Test
    fun `401 na sessao = credenciais erradas, 401 com token = sessao expirada`() {
        srv.enqueue(json(401, """{"erro":"Credenciais inválidas"}"""))
        val e1 = erro { api.sessao("joao", "errada") }
        assertEquals(PagamentosException.Tipo.CREDENCIAIS, e1.tipo)
        assertEquals("Código ou palavra-passe errados.", e1.message)
        srv.enqueue(json(401, """{"erro":"token expirado"}"""))
        val e2 = erro { api.checkout("velho", "base") }
        assertEquals(PagamentosException.Tipo.SESSAO_EXPIRADA, e2.tipo)
    }

    @Test
    fun `429 com e sem Retry-After`() {
        srv.enqueue(json(429, """{"erro":"limite"}""", "Retry-After" to "30"))
        val e = erro { api.sessao("joao", "x") }
        assertEquals(PagamentosException.Tipo.LIMITE, e.tipo)
        assertEquals("Demasiadas tentativas. Aguarde 30 s e tente outra vez.", e.message)
        srv.enqueue(json(429, "{}"))
        assertEquals("Demasiadas tentativas. Aguarde um pouco e tente outra vez.", erro { api.portal("t") }.message)
        assertEquals("Demasiadas tentativas. Aguarde 3 min e tente outra vez.", PagamentosApi.textoLimite("150"))
        assertEquals("Demasiadas tentativas. Aguarde um pouco e tente outra vez.", PagamentosApi.textoLimite("Wed, 21 Oct 2026 07:28:00 GMT"))
    }

    @Test
    fun `5xx e outros erros`() {
        srv.enqueue(MockResponse().setResponseCode(502).setBody("Bad Gateway"))
        val e = erro { api.checkout("t", "conforto") }
        assertEquals(PagamentosException.Tipo.SERVIDOR, e.tipo)
        assertEquals("O serviço de pagamentos não está disponível agora. Tente mais tarde.", e.message)
        // 4xx com mensagem do servidor: mostra-a; sem mensagem: genérica.
        srv.enqueue(json(409, """{"erro":"Este cliente não tem pagamentos no Stripe."}"""))
        assertEquals("Este cliente não tem pagamentos no Stripe.", erro { api.portal("t") }.message)
        srv.enqueue(json(400, "nada"))
        val e2 = erro { api.checkout("t", "base") }
        assertEquals(PagamentosException.Tipo.PEDIDO, e2.tipo)
        assertEquals("Não foi possível tratar o pedido. Tente mais tarde.", e2.message)
    }

    @Test
    fun `sem rede, ligacao cortada e servidor desligado`() {
        srv.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val e = erro { api.sessao("joao", "x") }
        assertEquals(PagamentosException.Tipo.REDE, e.tipo)
        assertEquals("Sem ligação ao servidor. Verifique a Internet e tente outra vez.", e.message)
        srv.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        assertEquals(PagamentosException.Tipo.REDE, erro { api.portal("t") }.tipo) // tempo esgotado
        val url = srv.url("/api/").toString()
        srv.shutdown()
        assertEquals(PagamentosException.Tipo.REDE, erro { PagamentosApi(url, http).sessao("a", "b") }.tipo)
        srv = MockWebServer().also { it.start() } // para o tearDown
    }

    // ---------------------------------------------------------------- PagamentosCliente (token em cache, 401 → novo token)

    @Test
    fun `cliente pede o token uma vez, reutiliza-o e renova-o depois de 13 min`() {
        var agora = Instant.parse("2026-10-01T10:00:00Z")
        val c = PagamentosCliente(api, { "joao" to "segredo" }, { agora })
        srv.enqueue(json(200, """{"token":"T1"}"""))
        srv.enqueue(json(200, """{"url":"https://checkout.stripe.com/1"}"""))
        srv.enqueue(json(200, """{"url":"https://billing.stripe.com/2"}"""))
        assertEquals("https://checkout.stripe.com/1", c.checkout("conforto"))
        agora = agora.plus(Duration.ofMinutes(12))
        assertEquals("https://billing.stripe.com/2", c.portal())
        assertEquals(listOf("/api/sessao", "/api/checkout", "/api/portal"), List(3) { pedido().path })
        assertEquals(3, srv.requestCount)

        agora = agora.plus(Duration.ofMinutes(2)) // 14 min: pede outro
        srv.enqueue(json(200, """{"token":"T2"}"""))
        srv.enqueue(json(200, """{"url":"https://billing.stripe.com/3"}"""))
        assertEquals("https://billing.stripe.com/3", c.portal())
        assertEquals("""{"codigo":"joao","password":"segredo"}""", pedido().body.readUtf8())
        assertEquals("Bearer T2", pedido().getHeader("Authorization"))
    }

    @Test
    fun `cliente repete uma vez com token novo se o servidor responder 401`() {
        val c = PagamentosCliente(api, { "joao" to "segredo" })
        srv.enqueue(json(200, """{"token":"T1"}"""))
        srv.enqueue(json(200, """{"url":"https://checkout.stripe.com/1"}"""))
        c.checkout("base")
        srv.enqueue(json(401, "{}")) // T1 revogado
        srv.enqueue(json(200, """{"token":"T2"}"""))
        srv.enqueue(json(200, """{"url":"https://checkout.stripe.com/2"}"""))
        assertEquals("https://checkout.stripe.com/2", c.checkout("premium"))
        val caminhos = List(5) { pedido().let { "${it.path} ${it.getHeader("Authorization") ?: "-"}" } }
        assertEquals(
            listOf("/api/sessao -", "/api/checkout Bearer T1", "/api/checkout Bearer T1", "/api/sessao -", "/api/checkout Bearer T2"),
            caminhos,
        )
        // Só uma repetição: 401 outra vez → erro.
        srv.enqueue(json(401, "{}"))
        srv.enqueue(json(200, """{"token":"T3"}"""))
        srv.enqueue(json(401, "{}"))
        assertEquals(PagamentosException.Tipo.SESSAO_EXPIRADA, erro { c.portal() }.tipo)
    }

    @Test
    fun `cliente sem palavra-passe guardada nao pede nada`() {
        val c = PagamentosCliente(api, { null })
        val e = erro { c.checkout("base") }
        assertEquals(PagamentosException.Tipo.CREDENCIAIS, e.tipo)
        assertEquals("Por segurança, saia e volte a entrar na app para gerir a subscrição.", e.message)
        assertEquals(0, srv.requestCount)
    }

    @Test
    fun `cliente com palavra-passe mudada mostra credenciais erradas, e troca de cliente pede token novo`() {
        var cred = "joao" to "segredo"
        val c = PagamentosCliente(api, { cred })
        srv.enqueue(json(200, """{"token":"TJ"}"""))
        srv.enqueue(json(200, """{"url":"https://checkout.stripe.com/j"}"""))
        c.checkout("base")
        cred = "maria" to "outra"
        srv.enqueue(json(401, "{}"))
        assertEquals("Código ou palavra-passe errados.", erro { c.portal() }.message)
        assertEquals(3, srv.requestCount)
        assertEquals("/api/sessao", List(3) { pedido() }.last().path)
    }
}
