package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Modelos prontos, relatório da casa e saúde dos aparelhos. */
class ModelosRelatorioTest {

    private val agora = Instant.parse("2026-09-27T09:15:00Z")

    private val lista = """[
      {"id":"quadro","nome":"Quadro geral","tipo":"openbeken","medidor":true,"divisao":"Garagem",
       "canais":[{"n":1,"funcao":"interruptor","nome":"Geral"},{"n":2,"funcao":"interruptor","nome":"Termoacumulador","carga":"perigosa"}]},
      {"id":"sala-4g","nome":"Interruptor sala","tipo":"openbeken","divisao":"Sala",
       "canais":[{"n":1,"funcao":"interruptor","nome":"Teto"},{"n":2,"funcao":"interruptor","nome":"Candeeiro"},
                 {"n":3,"funcao":"interruptor","nome":"Corredor","divisao":"Corredor"}]},
      {"id":"led-quarto","nome":"Luz quarto","tipo":"shelly","divisao":"Quarto","canais":[{"n":1,"funcao":"luz"}]},
      {"id":"estore-quarto","nome":"Estore quarto","tipo":"shelly","divisao":"Quarto","canais":[{"n":1,"funcao":"estore"}]},
      {"id":"porta-entrada","nome":"Porta de entrada","tipo":"openbeken","bateria":true,"divisao":"Entrada",
       "canais":[{"n":1,"funcao":"porta","entrada":true},{"n":2,"funcao":"bateria"}]},
      {"id":"pir-corredor","nome":"Movimento corredor","tipo":"openbeken","bateria":true,"divisao":"Corredor",
       "canais":[{"n":1,"funcao":"movimento"},{"n":2,"funcao":"bateria"}]},
      {"id":"tomada","nome":"Tomada TV","tipo":"openbeken","medidor":true,"canais":[{"n":1,"funcao":"interruptor"}]}
    ]"""

    private fun estado(): Estado = listOf(
        "_aparelhos" to lista,
        "_modo" to """{"modo":"fora","desde":"2026-09-27T08:00:00Z","por":"app"}""",
        "_alarme" to """{"ativo":true,"estado":"armado","tipo":"total","desde":"2026-09-27T08:00:00Z","ignorados":[]}""",
        "_energia" to """{"hoje_kwh":7.4,"ontem_kwh":9.1,"mes_kwh":180.2}""",
        "_config" to """{"limiar_espera_w":5}""",
        "_saude" to """{"quadro":{"online":true,"rssi":-58},"sala-4g":{"online":false,"rssi":-84,"offline_desde":"2026-09-27T08:02:00Z"},
                        "pir-corredor":{"bateria":11,"bateria_dias":9,"rssi":-70},"tomada":{"online":true,"rssi":-72,"reinicios_24h":7}}""",
        "quadro/connected" to "online",
        "quadro/1/get" to "1",
        "quadro/2/get" to "0",
        "quadro/power/get" to "1234",
        "sala-4g/1/get" to "1",
        "sala-4g/2/get" to "0",
        "led-quarto/online" to "true",
        "led-quarto/status/light:0" to """{"output":true,"brightness":65}""",
        "estore-quarto/online" to "true",
        "estore-quarto/status/cover:0" to """{"state":"stopped","current_pos":40}""",
        "porta-entrada/1/get" to "1",
        "porta-entrada/2/get" to "84",
        "pir-corredor/1/get" to "0",
        "pir-corredor/2/get" to "11",
        "tomada/connected" to "online",
        "tomada/1/get" to "1",
        "tomada/power/get" to "2.1",
    ).fold(Estado()) { e, (t, p) -> EstadoParser.reduzir(e, "joao", "domus/joao/$t", p, agora.minusSeconds(60)) }

    @Test
    fun `modelos preenchidos com os aparelhos da casa sao validos`() {
        val e = estado()
        val cfg = ConfigCasa(local = Local(38.72, -9.14))
        val modelos = Modelos.todos(e.aparelhos)
        assertEquals(
            listOf("luz-movimento", "chegada", "saida", "entrada-inesperada", "ferias", "consumo-alto", "bom-dia", "boa-noite"),
            modelos.map { it.id },
        )
        for (m in modelos) {
            assertNull(m.id, m.falta)
            val a = m.rascunho.paraAutomacao(emptyList())
            assertEquals(m.id, emptyList<String>(), Automacoes.validar(a, e.aparelhos, emptyList(), cfg))
            assertEquals(m.categoria, a.categoria)
            assertTrue(m.id, !a.descricao.isNullOrBlank())
        }
        val porId = modelos.associateBy { it.id }
        // Luz com movimento: o sensor do corredor e a luz do corredor (preferida pelo nome/divisão), 10 min, só à noite.
        val mov = porId.getValue("luz-movimento").rascunho
        assertEquals(Alvo("pir-corredor", 1), mov.sensor)
        assertEquals(listOf(RascunhoAcao(RascunhoAcao.LIGAR, Alvo("sala-4g", 3), duracaoMin = "10")), mov.acoes)
        assertEquals(Condicoes.NOITE, mov.condSol)
        // Entrada inesperada: a porta marcada "entrada", só em Fora/Noite, ignora a pausa manual
        val ent = porId.getValue("entrada-inesperada").rascunho
        assertEquals(Alvo("porta-entrada", 1), ent.sensor)
        assertEquals(setOf(Modos.FORA, Modos.NOITE), ent.condModos)
        assertTrue(ent.ignorarPausa)
        // Consumo alto: o quadro geral, com histerese
        val con = porId.getValue("consumo-alto").rascunho.paraAutomacao(emptyList())
        assertEquals(Quando.Potencia("quadro", 3500.0, 60, 3200.0), con.quando)
        // Nunca propõe ligar uma carga perigosa
        assertTrue(modelos.all { m -> m.rascunho.acoes.none { it.alvo == Alvo("quadro", 2) } })
        // Bom dia: luz do quarto com brilho aos poucos
        val bd = porId.getValue("bom-dia").rascunho.paraAutomacao(emptyList()).entao
        assertEquals(
            listOf(Acao.Estore("estore-quarto", 1, 100), Acao.Luz("led-quarto", 1, 30), Acao.Esperar(300), Acao.Luz("led-quarto", 1, 80)),
            bd,
        )
        // Boa noite: não apaga a luz do quarto, passa a modo Noite
        val bn = porId.getValue("boa-noite").rascunho.paraAutomacao(emptyList()).entao
        assertTrue(bn.none { it is Acao.Ligar && it.aparelho == "led-quarto" })
        assertEquals(Acao.Modo("noite"), bn.last())
    }

    @Test
    fun `modelos sem aparelhos dizem o que falta e usam cenas existentes`() {
        val m = Modelos.todos(emptyList(), listOf(Cena("boa-noite", "Boa noite", "lua")))
        val porId = m.associateBy { it.id }
        assertEquals("um sensor de movimento", porId.getValue("luz-movimento").falta)
        assertEquals("um sensor de porta", porId.getValue("entrada-inesperada").falta)
        assertEquals("um aparelho que meça o consumo", porId.getValue("consumo-alto").falta)
        assertNull(porId.getValue("saida").falta)
        assertEquals(
            listOf(Acao.Cena("boa-noite"), Acao.Modo("noite")),
            porId.getValue("boa-noite").rascunho.paraAutomacao(emptyList()).entao,
        )
    }

    @Test
    fun `saude - barras, atencao primeiro e motivos`() {
        assertEquals(0, SaudeCasa.barras(null))
        assertEquals(4, SaudeCasa.barras(-50))
        assertEquals(4, SaudeCasa.barras(-60))
        assertEquals(3, SaudeCasa.barras(-61))
        assertEquals(3, SaudeCasa.barras(-70))
        assertEquals(2, SaudeCasa.barras(-80))
        assertEquals(1, SaudeCasa.barras(-81))
        assertFalse(SaudeCasa.sinalFraco(-80))
        assertTrue(SaudeCasa.sinalFraco(-81))

        val e = estado()
        val l = SaudeCasa.linhas(e.aparelhos, e.saude, agora)
        assertEquals(listOf("sala-4g", "pir-corredor", "tomada"), l.filter { it.atencao }.map { it.aparelho.id })
        assertEquals(listOf("sala-4g", "pir-corredor", "tomada", "quadro", "led-quarto", "estore-quarto", "porta-entrada"), l.map { it.aparelho.id })
        assertEquals(listOf("Offline desde 09:02", "Sinal Wi-Fi fraco (-84 dBm)"), l[0].problemas)
        assertEquals(listOf("Bateria fraca (11 %)"), l[1].problemas)
        assertNull(l[1].online) // a pilhas: nunca "offline"
        assertEquals(listOf("7 reinícios em 24 h"), l[2].problemas)
        assertEquals(4, l[3].barras)
        // Sem _saude: bateria do canal
        assertEquals(84, l.first { it.aparelho.id == "porta-entrada" }.bateria)
        // Pilha para poucos dias (sem estar abaixo de 15 %)
        val p = SaudeCasa.linha(e.aparelhos[4], SaudeAparelho(bateria = 40, bateriaDias = 10), agora)
        assertEquals(listOf("Pilha para ≈ 10 dias"), p.problemas)
        // Sem notícias há mais de 24 h
        val pilhas = Aparelho("x", "X", "openbeken", bateria = true)
        val velho = SaudeCasa.linha(pilhas, SaudeAparelho(ultimaNoticia = agora.minusSeconds(26 * 3600)), agora)
        assertEquals(listOf("Sem notícias há 26 h"), velho.problemas)
    }

    @Test
    fun `relatorio agrupado por divisao e texto para copiar`() {
        val r = Relatorio.construir(estado(), agora)
        assertEquals(listOf("Corredor", "Entrada", "Garagem", "Quarto", "Sala", "Outros"), r.seccoes.map { it.divisao })
        assertEquals(3, r.ligados) // Geral, Teto, Luz quarto (a tomada está em espera)
        assertEquals(1, r.emEspera)
        assertEquals(2, r.desligados) // Termoacumulador, Candeeiro (o Corredor está desconhecido: não conta)
        assertEquals(1, r.abertas)
        assertEquals(1, r.offline)
        assertEquals(1, r.bateriaFraca)
        assertEquals(1, r.sinalFraco)
        assertEquals(1236.1, r.potenciaW!!, 1e-9)
        assertEquals(
            """
            Relatório da casa · 27 set., 10:15
            Modo Fora · alarme armado (total)
            Consumo: agora 1 236 W · hoje 7,4 kWh · ontem 9,1 kWh
            3 ligados · 1 em espera · 2 desligados · 1 aberta · 1 offline · 1 com bateria fraca · 1 com sinal fraco

            Corredor
            - Interruptor sala · Corredor: desconhecido
            - Movimento corredor: sem movimento
            - Movimento corredor: bateria fraca (11 %) (!)

            Entrada
            - Porta de entrada: aberta (!)

            Garagem
            - Quadro geral · Geral: ligado
            - Quadro geral · Termoacumulador: desligado
            - Quadro geral · consumo: 1 234 W

            Quarto
            - Luz quarto: ligado (65 %)
            - Estore quarto: a 40 %

            Sala
            - Interruptor sala · Teto: ligado
            - Interruptor sala · Candeeiro: desligado
            - Interruptor sala: offline desde 09:02, sinal fraco (-84 dBm) (!)

            Outros
            - Tomada TV: em espera
            - Tomada TV · consumo: 2,1 W
            """.trimIndent(),
            // Os números em pt-PT agrupam os milhares com um espaço não separável.
            Relatorio.texto(r).replace('\u00A0', ' ').replace('\u202F', ' '),
        )
    }
}
