package pt.domusenergia.app.presenca

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Máquina de "debounce" da presença com um relógio falso (minutos → ms). */
class PresencaLogicaTest {

    private var agora = 0L
    private fun min(m: Int) = m * 60_000L
    private fun passa(m: Int) { agora += min(m) }

    @Test
    fun `so publica depois de 10 minutos estaveis`() {
        var e = DebounceEstado()
        assertNull(Debounce.aPublicar(e, agora))
        assertNull(Debounce.esperaMs(e, agora))

        e = Debounce.observar(e, true, agora) // chega
        assertNull(Debounce.aPublicar(e, agora))
        assertEquals(min(10), Debounce.esperaMs(e, agora))
        passa(9)
        assertNull(Debounce.aPublicar(e, agora))
        assertEquals(min(1), Debounce.esperaMs(e, agora))
        // A mesma observação não reinicia a contagem
        e = Debounce.observar(e, true, agora)
        passa(1)
        assertEquals(true, Debounce.aPublicar(e, agora))
        e = Debounce.publicado(e, true)
        assertNull(Debounce.aPublicar(e, agora))
        assertNull(Debounce.esperaMs(e, agora))
        // Repetir "em casa" não volta a publicar
        passa(30)
        e = Debounce.observar(e, true, agora)
        assertNull(Debounce.aPublicar(e, agora))
    }

    @Test
    fun `ida e volta rapida nao publica nada (sair a porta para o lixo)`() {
        var e = Debounce.publicado(Debounce.observar(DebounceEstado(), true, agora), true)
        passa(60)
        e = Debounce.observar(e, false, agora) // sai
        passa(4)
        e = Debounce.observar(e, true, agora) // volta ao fim de 4 min
        passa(20)
        assertNull(Debounce.aPublicar(e, agora))
        assertNull(Debounce.esperaMs(e, agora))
    }

    @Test
    fun `saida confirmada e oscilacao do gps recomeca a contagem`() {
        var e = Debounce.publicado(Debounce.observar(DebounceEstado(), true, agora), true)
        passa(5)
        e = Debounce.observar(e, false, agora)
        passa(8)
        e = Debounce.observar(e, true, agora) // GPS salta para dentro
        passa(1)
        e = Debounce.observar(e, false, agora) // e para fora outra vez: recomeça
        passa(9)
        assertNull(Debounce.aPublicar(e, agora))
        passa(1)
        assertEquals(false, Debounce.aPublicar(e, agora))
        e = Debounce.publicado(e, false)
        assertEquals(DebounceEstado(false, false, e.desdeMs), e)
    }

    @Test
    fun `sinal desconhecido nao muda nada`() {
        val e = Debounce.observar(DebounceEstado(), true, agora)
        passa(3)
        assertSame(e, Debounce.observar(e, null, agora))
    }

    @Test
    fun `falha ao publicar - volta a tentar com o mesmo valor`() {
        var e = Debounce.observar(DebounceEstado(), false, agora)
        passa(11)
        assertEquals(false, Debounce.aPublicar(e, agora))
        // (a publicação falhou: o estado não é marcado como publicado)
        passa(5)
        assertEquals(false, Debounce.aPublicar(e, agora))
        assertEquals(0L, Debounce.esperaMs(e, agora))
        e = Debounce.publicado(e, false)
        assertNull(Debounce.aPublicar(e, agora))
    }

    @Test
    fun `combinar zona e wifi`() {
        assertEquals(true, Sinais.combinar(dentroDaZona = false, wifiDeCasa = true)) // GPS falha dentro de casa
        assertEquals(true, Sinais.combinar(dentroDaZona = true, wifiDeCasa = false)) // Wi-Fi desligado no telemóvel
        assertEquals(true, Sinais.combinar(dentroDaZona = true, wifiDeCasa = null))
        assertEquals(false, Sinais.combinar(dentroDaZona = false, wifiDeCasa = false))
        assertEquals(false, Sinais.combinar(dentroDaZona = false, wifiDeCasa = null))
        assertNull(Sinais.combinar(dentroDaZona = null, wifiDeCasa = false))
        assertNull(Sinais.combinar(dentroDaZona = null, wifiDeCasa = null))
        assertEquals(true, Sinais.combinar(dentroDaZona = null, wifiDeCasa = true))
    }

    @Test
    fun `raio minimo, ssid e id`() {
        assertEquals(100f, Sinais.raio(50f))
        assertEquals(150f, Sinais.raio(null))
        assertEquals(250f, Sinais.raio(250f))
        assertEquals("Casa Silva", Sinais.ssid("\"Casa Silva\""))
        assertEquals("MEO-1234", Sinais.ssid("MEO-1234"))
        assertNull(Sinais.ssid("<unknown ssid>"))
        assertNull(Sinais.ssid("\"\""))
        assertNull(Sinais.ssid(null))
        assertEquals("tel-0a1b2c3d4e5f", Sinais.novoId("0A1B2C3D-4E5F-6789-abcd-ef0123456789"))
        assertEquals("tel-abc000000000", Sinais.novoId("xyzabc"))
    }

    @Test
    fun `passo completo - chegar pelo wifi, sair pela zona, com relogio falso`() {
        var e = DebounceEstado()
        // Ainda sem evento da zona, mas no Wi-Fi de casa: conta como em casa, espera 10 min.
        var v = Verificar.passo(e, zona = null, wifiCasa = "Casa Silva", wifiAtual = "\"Casa Silva\"", agoraMs = agora)
        assertNull(v.publicar)
        assertEquals(min(10), v.esperaMs)
        e = v.estado
        passa(10)
        v = Verificar.passo(e, zona = null, wifiCasa = "Casa Silva", wifiAtual = "\"Casa Silva\"", agoraMs = agora)
        assertEquals(true, v.publicar)
        assertNull(v.esperaMs)
        e = Debounce.publicado(v.estado, true)
        // Sai: a zona diz fora e o Wi-Fi já não é o de casa.
        passa(60)
        v = Verificar.passo(e, zona = false, wifiCasa = "Casa Silva", wifiAtual = "MEO-WiFi", agoraMs = agora)
        assertNull(v.publicar)
        assertEquals(min(10), v.esperaMs)
        e = v.estado
        passa(4)
        v = Verificar.passo(e, zona = false, wifiCasa = "Casa Silva", wifiAtual = null, agoraMs = agora)
        assertEquals(min(6), v.esperaMs) // a mesma observação não recomeça a contagem
        e = v.estado
        passa(6)
        v = Verificar.passo(e, zona = false, wifiCasa = "Casa Silva", wifiAtual = null, agoraMs = agora)
        assertEquals(false, v.publicar)
    }

    @Test
    fun `passo - sem wifi escolhido e sem zona nao decide nada`() {
        val v = Verificar.passo(DebounceEstado(), zona = null, wifiCasa = null, wifiAtual = "Casa Silva", agoraMs = agora)
        assertEquals(Verificacao(DebounceEstado(), null, null), v)
    }
}
