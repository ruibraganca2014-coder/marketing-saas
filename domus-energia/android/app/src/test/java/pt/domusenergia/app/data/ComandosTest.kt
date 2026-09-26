package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ComandosTest {

    private val c = "joao"
    private val cid = "app-joao-1234abcd"

    private val obk = Aparelho(
        "sala", "Sala", Aparelho.TIPO_OPENBEKEN,
        canais = listOf(
            Canal(1, Funcao.INTERRUPTOR, "Teto"),
            Canal(2, Funcao.LUZ, "LED", ligado = false),
            Canal(3, Funcao.ESTORE, "Estore"),
        ),
    )
    private val shelly = Aparelho(
        "sh", "Shelly", Aparelho.TIPO_SHELLY,
        canais = listOf(
            Canal(1, Funcao.INTERRUPTOR, "A"),
            Canal(2, Funcao.INTERRUPTOR, "B"),
            Canal(3, Funcao.LUZ, "Luz"),
            Canal(4, Funcao.ESTORE, "Estore"),
        ),
    )

    private fun rpc(p: Publicacao): JSONObject {
        assertEquals("domus/joao/sh/rpc", p.topico)
        val o = JSONObject(p.payload)
        assertEquals(cid, o.getString("src"))
        assertEquals(7, o.getInt("id"))
        return o
    }

    @Test
    fun `openbeken - ligar, brilho e estore`() {
        assertEquals(listOf(Publicacao("domus/joao/sala/1/set", "1")), Comandos.ligar(c, obk, 1, true, cid, 7))
        assertEquals(listOf(Publicacao("domus/joao/sala/2/set", "0")), Comandos.ligar(c, obk, 2, false, cid, 7))
        // Brilho com a luz apagada: dimmer + acender
        assertEquals(
            listOf(Publicacao("domus/joao/sala/led_dimmer/set", "80"), Publicacao("domus/joao/sala/2/set", "1")),
            Comandos.brilho(c, obk, 2, 80, cid, 7),
        )
        val acesa = obk.copy(canais = obk.canais.map { if (it.n == 2) it.copy(ligado = true) else it })
        assertEquals(listOf(Publicacao("domus/joao/sala/led_dimmer/set", "100")), Comandos.brilho(c, acesa, 2, 140, cid, 7))
        assertEquals(listOf(Publicacao("domus/joao/sala/3/set", "40")), Comandos.estorePosicao(c, obk, 3, 40, cid, 7))
        assertEquals(listOf(Publicacao("domus/joao/sala/3/set", "100")), Comandos.estore(c, obk, 3, Comandos.MovimentoEstore.ABRIR, cid, 7))
        assertEquals(listOf(Publicacao("domus/joao/sala/3/set", "0")), Comandos.estore(c, obk, 3, Comandos.MovimentoEstore.FECHAR, cid, 7))
        assertTrue(Comandos.estore(c, obk, 3, Comandos.MovimentoEstore.PARAR, cid, 7).isEmpty())
        assertFalse(Comandos.podeParar(obk))
        assertTrue(Comandos.pedirEstado(c, obk).isEmpty())
    }

    @Test
    fun `shelly - interruptores com command e status_update`() {
        assertEquals(
            listOf(Publicacao("domus/joao/sh/command/switch:0", "on"), Publicacao("domus/joao/sh/command", "status_update")),
            Comandos.ligar(c, shelly, 1, true, cid, 7),
        )
        assertEquals(
            listOf(Publicacao("domus/joao/sh/command/switch:1", "off"), Publicacao("domus/joao/sh/command", "status_update")),
            Comandos.ligar(c, shelly, 2, false, cid, 7),
        )
        assertEquals(listOf(Publicacao("domus/joao/sh/command", "status_update")), Comandos.pedirEstado(c, shelly))
        assertTrue(Comandos.podeParar(shelly))
    }

    @Test
    fun `shelly - luz por rpc Light Set`() {
        val on = rpc(Comandos.ligar(c, shelly, 3, true, cid, 7).single())
        assertEquals("Light.Set", on.getString("method"))
        assertEquals(2, on.getJSONObject("params").getInt("id"))
        assertEquals(true, on.getJSONObject("params").getBoolean("on"))
        val b = rpc(Comandos.brilho(c, shelly, 3, 80, cid, 7).single())
        assertEquals("Light.Set", b.getString("method"))
        val p = b.getJSONObject("params")
        assertEquals(2, p.getInt("id"))
        assertEquals(true, p.getBoolean("on"))
        assertEquals(80, p.getInt("brightness"))
    }

    @Test
    fun `shelly - estore por rpc Cover`() {
        val pos = rpc(Comandos.estorePosicao(c, shelly, 4, 50, cid, 7).single())
        assertEquals("Cover.GoToPosition", pos.getString("method"))
        assertEquals(3, pos.getJSONObject("params").getInt("id"))
        assertEquals(50, pos.getJSONObject("params").getInt("pos"))
        for ((mov, metodo) in listOf(
            Comandos.MovimentoEstore.ABRIR to "Cover.Open",
            Comandos.MovimentoEstore.PARAR to "Cover.Stop",
            Comandos.MovimentoEstore.FECHAR to "Cover.Close",
        )) {
            val o = rpc(Comandos.estore(c, shelly, 4, mov, cid, 7).single())
            assertEquals(metodo, o.getString("method"))
            assertEquals(3, o.getJSONObject("params").getInt("id"))
            assertFalse(o.getJSONObject("params").has("pos"))
        }
    }

    @Test
    fun `alarme, automacoes e fcm`() {
        val a = Comandos.alarme(c, true)
        assertEquals("domus/joao/_alarme/set", a.topico)
        assertEquals(true, JSONObject(a.payload).getBoolean("ativo"))
        assertEquals(false, JSONObject(Comandos.alarme(c, false).payload).getBoolean("ativo"))

        val lista = listOf(
            Automacao("x", "X", quando = Quando.Hora("08:00", listOf(1)), entao = listOf(Acao.Notificar("olá"))),
            Automacao("y", "Y", ativa = false, quando = Quando.Hora("09:00", listOf(2)), entao = listOf(Acao.Notificar("adeus"))),
        )
        val au = Comandos.automacoes(c, lista)
        assertEquals("domus/joao/_automacoes/set", au.topico)
        val arr = JSONArray(au.payload)
        assertEquals(2, arr.length())
        assertEquals(false, arr.getJSONObject(1).getBoolean("ativa"))

        val f = Comandos.fcm(c, "tok")
        assertEquals("domus/joao/_fcm/registar", f.topico)
        assertEquals("tok", JSONObject(f.payload).getString("token"))
        assertFalse(JSONObject(f.payload).has("remover"))
        val r = JSONObject(Comandos.fcm(c, "tok", remover = true).payload)
        assertEquals("tok", r.getString("token"))
        assertEquals(true, r.getBoolean("remover"))
    }
}
