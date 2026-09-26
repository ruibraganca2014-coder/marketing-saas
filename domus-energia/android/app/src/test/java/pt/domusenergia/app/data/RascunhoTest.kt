package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class RascunhoTest {

    private val aparelhos = listOf(
        Aparelho("pir", "Movimento", "openbeken", bateria = true, canais = listOf(Canal(1, Funcao.MOVIMENTO, "Movimento"))),
        Aparelho("sala", "Sala", "openbeken", canais = listOf(Canal(1, Funcao.INTERRUPTOR, "Sala"))),
        Aparelho("quadro", "Quadro", "openbeken", medidor = true, canais = listOf(Canal(1, Funcao.INTERRUPTOR, "Quadro"))),
    )

    @Test
    fun `formulario novo por omissao tem erros e nao valida`() {
        val a = Rascunho().paraAutomacao(emptyList())
        assertEquals("automacao", a.id)
        val erros = Automacoes.validar(a, aparelhos)
        assertTrue(erros.contains("Dê um nome à automação."))
        assertTrue(erros.contains("Escolha o sensor."))
        assertTrue(erros.contains("Ação 1: escolha o circuito."))
    }

    @Test
    fun `formulario completo da uma automacao valida com id unico`() {
        val r = Rascunho(
            nome = "Luz com movimento",
            sensor = Alvo("pir", 1),
            valor = 1,
            alarme = false,
            entreAtivo = true,
            de = "19:00",
            ate = "7:00",
            acoes = listOf(RascunhoAcao(RascunhoAcao.LIGAR, Alvo("sala", 1), duracaoMin = "1,5")),
        )
        val existentes = listOf(Automacao("luz-com-movimento", "Outra"))
        val a = r.paraAutomacao(existentes)
        assertEquals("luz-com-movimento-2", a.id)
        assertEquals(Quando.Sensor("pir", 1, 1), a.quando)
        assertEquals(Condicoes(false, "19:00" to "07:00"), a.se)
        assertEquals(listOf(Acao.Ligar(true, "sala", 1, 90)), a.entao)
        assertEquals(emptyList<String>(), Automacoes.validar(a, aparelhos))
    }

    @Test
    fun `hora e potencia`() {
        val h = Rascunho(nome = "H", tipoQuando = Rascunho.HORA, hora = "7:05", dias = setOf(5, 1),
            acoes = listOf(RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = " Olá "))).paraAutomacao(emptyList())
        assertEquals(Quando.Hora("07:05", listOf(1, 5)), h.quando)
        assertEquals(listOf(Acao.Notificar("Olá")), h.entao)
        assertNull(h.se)

        val p = Rascunho(nome = "P", tipoQuando = Rascunho.POTENCIA, medidor = "quadro", acimaW = "3 500", duranteS = "60",
            acoes = listOf(RascunhoAcao(RascunhoAcao.DESLIGAR, Alvo("quadro", 1)))).paraAutomacao(emptyList())
        assertEquals(Quando.Potencia("quadro", 3500.0, 60), p.quando)
        assertEquals(listOf(Acao.Ligar(false, "quadro", 1, null)), p.entao)
        assertEquals(emptyList<String>(), Automacoes.validar(p, aparelhos))

        val mau = Rascunho(nome = "P", tipoQuando = Rascunho.POTENCIA, medidor = "quadro", acimaW = "muito", duranteS = "x",
            acoes = listOf(RascunhoAcao(RascunhoAcao.LIGAR, Alvo("sala", 1), duracaoMin = "abc"))).paraAutomacao(emptyList())
        assertEquals(
            listOf("Indique a potência (W).", "Indique durante quantos segundos.", "Ação 1: duração inválida."),
            Automacoes.validar(mau, aparelhos),
        )
    }

    @Test
    fun `editar - de e para automacao mantem o id e os valores`() {
        val original = Automacao(
            id = "luz-corredor", nome = "Luz", ativa = false,
            quando = Quando.Sensor("pir", 1, 0),
            se = Condicoes(true, "22:00" to "06:30"),
            entao = listOf(Acao.Ligar(true, "sala", 1, 120), Acao.Estore("e", 1, 30), Acao.Notificar("m")),
        )
        val r = Rascunho.de(original)
        assertEquals("luz-corredor", r.idOriginal)
        assertEquals("2", r.acoes[0].duracaoMin)
        assertEquals(original, r.paraAutomacao(listOf(original)))
        assertEquals(Quando.Hora("08:00", listOf(6, 7)), Rascunho.de(original.copy(quando = Quando.Hora("08:00", listOf(6, 7)))).paraAutomacao(emptyList()).quando)
        assertEquals("1,5", Rascunho.de(original.copy(entao = listOf(Acao.Ligar(true, "sala", 1, 90)))).acoes[0].duracaoMin)
    }

    @Test
    fun `acoes - acrescentar, alterar e remover, maximo 10`() {
        var r = Rascunho()
        repeat(15) { r = r.maisAcao() }
        assertEquals(Automacoes.MAX_ACOES, r.acoes.size)
        r = r.comAcao(3) { it.copy(tipo = RascunhoAcao.NOTIFICAR, mensagem = "x") }
        assertEquals("x", r.acoes[3].mensagem)
        r = r.semAcao(3)
        assertEquals(9, r.acoes.size)
        assertTrue(r.acoes.none { it.mensagem == "x" })
    }

    @Test
    fun `textos e resumo`() {
        val agora = Instant.parse("2026-09-26T20:00:00Z")
        assertEquals("agora mesmo", Textos.tempoRelativo(agora.minusSeconds(10), agora))
        assertEquals("há 5 min", Textos.tempoRelativo(agora.minusSeconds(300), agora))
        assertEquals("há 3 h", Textos.tempoRelativo(agora.minusSeconds(3 * 3600 + 100), agora))
        assertEquals("há 2 dias", Textos.tempoRelativo(agora.minusSeconds(50 * 3600), agora))
        assertNull(Textos.tempoRelativo(null, agora))
        assertEquals("Sem notícias há 26 h", Textos.semNoticias(agora.minusSeconds(26 * 3600), agora))
        assertEquals("21:00", Textos.quando(agora, agora)) // Lisboa, hora de verão
        assertEquals("12,3 W", Textos.potencia(12.34))

        val casa = listOf(
            Aparelho("q", "Q", "openbeken", medidor = true, potenciaW = 3000.0,
                canais = listOf(Canal(1, Funcao.INTERRUPTOR, "Q", ligado = true))),
            Aparelho("x", "X", "openbeken", potenciaW = 999.0, // sem medidor: não conta
                canais = listOf(Canal(1, Funcao.LUZ, "L", ligado = false), Canal(2, Funcao.PORTA, "P", aberto = true), Canal(3, Funcao.PORTA, "P2"))),
        )
        val r = Resumo.de(casa, Alarme(true))
        assertEquals(Resumo(3000.0, true, 1, 2, 1, 2, true), r)
        assertEquals(3000f / 3500f, r.calor, 1e-6f)
        assertEquals(0.5f, r.luzes, 1e-6f)
        assertEquals(1f, Resumo(10_000.0).calor, 0f)
        assertEquals(0f, Resumo().luzes, 0f)
    }
}
