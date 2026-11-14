package pt.domusenergia.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Organizar os aparelhos (decisões do dono, 2026-11-10): o mesmo que painel/test/app-cliente.test.js testa no site. */
class OrganizarTest {
    private val tomada = ConfigAparelho("tomada-3", "tomada-3", "openbeken", true, false, false,
        listOf(ConfigCanal(1, "interruptor", "tomada-3", false, divisao = "Sala")), divisao = "Sala")
    private val duplo = ConfigAparelho("int-sala", "Interruptor sala", "openbeken", false, false, false,
        listOf(ConfigCanal(1, "luz", "Teto", true, divisao = "Sala"), ConfigCanal(2, "luz", "Interruptor sala", false, divisao = "Sala")))

    @Test
    fun `ler, aplicar e voltar a escrever o personalizar do _config`() {
        val cfg = V3.lerConfig("""{"offline_min":30,"personalizar":{"tomada-3":{"divisao":"Cozinha","canais":{"1":{"nome":"Cafeteira"}}},"int-sala":{"canais":{"2":{"escondido":true}}}}}""")!!
        val t = Organizar.aplicar(tomada, cfg.personalizar["tomada-3"])
        assertEquals("Cafeteira", t.nome)
        assertEquals("Cozinha", t.divisao)
        assertEquals("Cozinha", t.canais[0].divisao)
        val d = Organizar.aplicar(duplo, cfg.personalizar["int-sala"])
        assertEquals("Interruptor sala", d.nome)
        assertTrue(d.canais[1].escondido)
        assertFalse(d.canais[0].escondido)
        assertTrue(Organizar.aplicar(tomada, null) === tomada)
        val json = Organizar.json(cfg.personalizar)
        assertEquals(cfg.personalizar, Organizar.ler(JSONObject(json.toString())))
        assertTrue(V3.lerConfig("""{"offline_min":30}""")!!.personalizar.isEmpty())
    }

    @Test
    fun `mudar so guarda o que difere do painel e repor apaga`() {
        assertTrue(Organizar.mudar(emptyMap(), tomada, "Sala", mapOf(1 to PersCanal(" tomada-3 ", false))).isEmpty())
        val r = Organizar.mudar(emptyMap(), tomada, " Despensa ", mapOf(1 to PersCanal("Arca", true)))
        assertEquals(Personalizacao("Despensa", mapOf(1 to PersCanal("Arca", true))), r["tomada-3"])
        assertNull(Organizar.mudar(r, tomada, "", emptyMap())["tomada-3"])
        // Só o que mudou vai para `_config/set`.
        val antes = ConfigCasa.PADRAO
        val parcial = ConfigCasa.parcial(antes, antes.copy(personalizar = r))
        assertEquals(setOf("personalizar"), parcial.keys().asSequence().toSet())
        assertEquals("Arca", parcial.getJSONObject("personalizar").getJSONObject("tomada-3").getJSONObject("canais").getJSONObject("1").getString("nome"))
    }

    @Test
    fun `os escondidos chegam ao modelo do aparelho`() {
        val e = Estado(lista = listOf(duplo), config = ConfigCasa(personalizar = mapOf("int-sala" to Personalizacao(canais = mapOf(2 to PersCanal(escondido = true))))))
        assertEquals(listOf(false, true), e.aparelhos[0].canais.map { it.escondido })
    }
}
