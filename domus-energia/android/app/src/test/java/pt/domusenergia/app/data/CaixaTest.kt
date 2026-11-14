package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaixaTest {

    private val valido = """{"endereco":"192.168.1.50","porta":1884,"utilizador":"app-joao","senha":"s3gr3d0"}"""

    @Test
    fun `le o _caixa publicado pelo domus sh e volta a escreve-lo igual`() {
        val a = Caixa.ler(valido)
        assertEquals(AcessoCaixa("192.168.1.50", 1884, "app-joao", "s3gr3d0"), a)
        assertEquals(a, Caixa.ler(a!!.json()))
    }

    @Test
    fun `recusa enderecos que nao sao da rede de casa e campos em falta`() {
        for (ip in listOf("8.8.8.8", "172.32.0.1", "192.169.1.1", "192.168.1.256", "192.168.1", "caixa.local", "", "192.168.1.5;x")) {
            assertNull(ip, Caixa.ler(valido.replace("192.168.1.50", ip)))
        }
        for (ip in listOf("10.0.0.2", "172.16.0.1", "172.31.255.254", "192.168.0.1")) assertTrue(ip, Caixa.ipPrivado(ip))
        assertNull(Caixa.ler(valido.replace("\"senha\":\"s3gr3d0\"", "\"senha\":\"\"")))
        assertNull(Caixa.ler(valido.replace("1884", "0")))
        assertNull(Caixa.ler(""))
        assertNull(Caixa.ler("nao e json"))
    }

    @Test
    fun `liga a caixa sem servidor ou com o _ponte a 0`() {
        assertTrue(Caixa.precisa(servidorLigado = false, ponteCaiu = false))
        assertTrue(Caixa.precisa(servidorLigado = true, ponteCaiu = true))
        assertFalse(Caixa.precisa(servidorLigado = true, ponteCaiu = false))
    }

    @Test
    fun `pela caixa so passam comandos dos aparelhos que nao sao Shelly`() {
        val shelly = setOf("estore")
        assertTrue(Caixa.passaPelaCaixa("domus/joao/sala/1/set", "joao", shelly))
        assertTrue(Caixa.passaPelaCaixa("domus/joao/led/led_dimmer/set", "joao", shelly))
        assertFalse("o Shelly está ligado ao servidor", Caixa.passaPelaCaixa("domus/joao/estore/rpc", "joao", shelly))
        assertFalse(Caixa.passaPelaCaixa("domus/joao/_modo/set", "joao", shelly))
        assertFalse(Caixa.passaPelaCaixa("domus/joao/_cenas/executar", "joao", shelly))
        assertFalse(Caixa.passaPelaCaixa("domus/joao/_alarme/set", "joao", shelly))
        assertFalse(Caixa.passaPelaCaixa("domus/maria/sala/1/set", "joao", shelly))
        assertFalse(Caixa.passaPelaCaixa("domus/joao/sala", "joao", shelly))
    }

    @Test
    fun `o _ponte e o _caixa vindos da caixa nao se aplicam`() {
        assertTrue(Caixa.ignorarDaCaixa("domus/joao/_ponte", "joao"))
        assertTrue(Caixa.ignorarDaCaixa("domus/joao/_caixa", "joao"))
        assertFalse(Caixa.ignorarDaCaixa("domus/joao/_aparelhos", "joao"))
        assertFalse(Caixa.ignorarDaCaixa("domus/joao/sala/1/get", "joao"))
    }
}
