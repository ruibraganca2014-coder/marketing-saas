package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Publicações novas da v3: tópico e JSON EXATOS (o motor recusa campos desconhecidos, por isso compara-se
 * o objeto inteiro, com as chaves e os tipos, e não só os campos que interessam).
 */
class ComandosV3Test {

    private val c = "joao"

    private fun exato(esperado: String, p: Publicacao, topico: String) {
        assertEquals(topico, p.topico)
        assertEquals(JSONObject(esperado).toMap(), JSONObject(p.payload).toMap())
    }

    @Test
    fun `modo e forcar`() {
        exato("""{"modo":"fora","forcar":false,"por":"app"}""", Comandos.modo(c, Modos.FORA), "domus/joao/_modo/set")
        exato("""{"modo":"noite","forcar":true,"por":"app"}""", Comandos.modo(c, Modos.NOITE, forcar = true), "domus/joao/_modo/set")
        exato("""{"modo":"casa","forcar":false,"por":"app"}""", Comandos.modo(c, Modos.CASA), "domus/joao/_modo/set")
        exato("""{"modo":"ferias","forcar":false,"por":"app"}""", Comandos.modo(c, Modos.FERIAS), "domus/joao/_modo/set")
    }

    @Test
    fun `cenas - executar e guardar a lista completa`() {
        exato("""{"id":"cinema","por":"app"}""", Comandos.executarCena(c, "cinema"), "domus/joao/_cenas/executar")

        val lista = Cenas.ler(
            """[{"id":"empresa","nome":"Da empresa","icone":"estrela","bloqueada":true,"acoes":[{"acao":"desligar","aparelho":"q","canal":1}]}]""",
        )!!
        val nova = Cena("cinema", "Noite de cinema", "filme", acoes = listOf(Acao.Luz("led", 1, 20), Acao.Esperar(5), Acao.Estore("est", 1, 0)))
        val p = Comandos.cenas(c, Cenas.guardar(lista, nova))
        assertEquals("domus/joao/_cenas/set", p.topico)
        val arr = JSONArray(p.payload)
        // A da empresa segue exatamente como veio
        assertEquals(JSONObject(lista[0].original!!).toMap(), arr.getJSONObject(0).toMap())
        assertEquals(
            JSONObject(
                """{"id":"cinema","nome":"Noite de cinema","icone":"filme","bloqueada":false,
                   "acoes":[{"acao":"luz","aparelho":"led","canal":1,"brilho":20},{"acao":"esperar","s":5},
                            {"acao":"estore","aparelho":"est","canal":1,"posicao":0}]}"""
            ).toMap(),
            arr.getJSONObject(1).toMap(),
        )
        // Bloqueadas: não se editam nem apagam
        assertEquals(lista, Cenas.guardar(lista, lista[0].copy(nome = "hack"), "empresa"))
        assertEquals(lista, Cenas.remover(lista, "empresa"))
    }

    @Test
    fun `executar automacao - testar e avaliar`() {
        exato("""{"id":"luz-corredor","testar":true,"por":"app"}""", Comandos.testarAutomacao(c, "luz-corredor"), "domus/joao/_automacoes/executar")
        exato("""{"id":"luz-corredor","por":"app"}""", Comandos.executarAutomacao(c, "luz-corredor"), "domus/joao/_automacoes/executar")
        exato("""{"id":"luz-corredor","avaliar":true,"por":"app"}""", Comandos.avaliarAutomacao(c, "luz-corredor"), "domus/joao/_automacoes/executar")
    }

    @Test
    fun `config - so os campos que mudaram`() {
        val antes = ConfigCasa(30, 30, "23:00" to "07:00", 5.0, 30, 60, null, "08:00")
        // Nada mudou → objeto vazio
        assertEquals(0, ConfigCasa.parcial(antes, antes).length())
        exato("""{"atraso_saida_s":45}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(atrasoSaidaS = 45))), "domus/joao/_config/set")
        exato("""{"atraso_entrada_s":0}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(atrasoEntradaS = 0))), "domus/joao/_config/set")
        exato("""{"silencio":null}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(silencio = null))), "domus/joao/_config/set")
        exato("""{"silencio":["22:30","06:45"]}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(silencio = "22:30" to "06:45"))), "domus/joao/_config/set")
        exato("""{"limiar_espera_w":8}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(limiarEsperaW = 8.0))), "domus/joao/_config/set")
        exato("""{"limiar_espera_w":2.5}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(limiarEsperaW = 2.5))), "domus/joao/_config/set")
        exato("""{"offline_min":120}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(offlineMin = 120))), "domus/joao/_config/set")
        exato("""{"pausa_manual_min":0}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(pausaManualMin = 0))), "domus/joao/_config/set")
        exato("""{"local":{"lat":41.15,"lon":-8.61}}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(local = Local(41.15, -8.61)))), "domus/joao/_config/set")
        exato("""{"relatorio_diario":null}""", Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(relatorioDiario = null))), "domus/joao/_config/set")
        exato(
            """{"relatorio_diario":"21:00","offline_min":45}""",
            Comandos.config(c, ConfigCasa.parcial(antes, antes.copy(relatorioDiario = "21:00", offlineMin = 45))),
            "domus/joao/_config/set",
        )
        // Não se apaga a localização (o contrato não diz que aceita null)
        assertEquals(0, ConfigCasa.parcial(antes.copy(local = Local(1.0, 2.0)), antes).length())
    }

    @Test
    fun `config - validacao`() {
        assertEquals(emptyList<String>(), ConfigCasa.validar(ConfigCasa.PADRAO))
        assertEquals(
            listOf(
                "Tempo para sair: de 0 a 300 s.",
                "Tempo para desarmar: de 0 a 300 s.",
                "Horas de silêncio inválidas (HH:MM).",
                "Limiar de \"em espera\": de 0 a 100 W.",
                "Aviso de offline: de 1 a 1440 min.",
                "Pausa manual: de 0 a 480 min.",
                "Localização inválida.",
                "Hora do relatório inválida (HH:MM).",
            ),
            ConfigCasa.validar(ConfigCasa(301, -1, "7h" to "08:00", 101.0, 0, 481, Local(91.0, 0.0), "25:00")),
        )
    }

    @Test
    fun `presenca`() {
        exato(
            """{"pessoa":"tel-0a1b2c3d4e5f","nome":"Rui","em_casa":true}""",
            Comandos.presenca(c, "tel-0a1b2c3d4e5f", "Rui", true),
            "domus/joao/_presenca/set",
        )
        exato(
            """{"pessoa":"tel-0a1b2c3d4e5f","nome":"Rui","em_casa":false}""",
            Comandos.presenca(c, "tel-0a1b2c3d4e5f", "Rui", false),
            "domus/joao/_presenca/set",
        )
    }

    @Test
    fun `presenca - remover ao desligar a detecao`() {
        exato("""{"pessoa":"tel-0a1b2c3d4e5f","remover":true}""", Comandos.presencaRemover(c, "tel-0a1b2c3d4e5f"), "domus/joao/_presenca/set")
    }

    @Test
    fun `nenhum comando novo publica em topicos de estado`() {
        val todos = listOf(
            Comandos.presencaRemover(c, "p"),
            Comandos.modo(c, "fora"), Comandos.executarCena(c, "x"), Comandos.cenas(c, emptyList()),
            Comandos.testarAutomacao(c, "x"), Comandos.avaliarAutomacao(c, "x"), Comandos.executarAutomacao(c, "x"),
            Comandos.config(c, JSONObject()), Comandos.presenca(c, "p", "n", true),
        )
        // Só os tópicos da secção 10 do contrato (ACL do cliente).
        val permitidos = setOf("_config/set", "_modo/set", "_cenas/set", "_cenas/executar", "_automacoes/executar", "_presenca/set")
        assertTrue(todos.all { it.topico.removePrefix("domus/joao/") in permitidos })
    }
}
