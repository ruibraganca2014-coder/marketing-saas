package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Deteção das ações arriscadas (disjuntor geral, carga perigosa) e modelos que nunca as propõem. */
class RiscosTest {

    private fun aparelhos(lista: String): List<Aparelho> =
        EstadoParser.reduzir(Estado(), "joao", "domus/joao/_aparelhos", lista).aparelhos

    /** Quadro marcado "geral" com o circuito geral e um termoacumulador; outro medidor com "quadro" no nome. */
    private val comGeral = aparelhos(
        """[
      {"id":"quadro","nome":"Quadro geral","tipo":"openbeken","medidor":true,"geral":true,
       "canais":[{"n":1,"funcao":"interruptor","nome":"Geral"},{"n":2,"funcao":"interruptor","nome":"Termoacumulador","carga":"perigosa"},
                 {"n":3,"funcao":"interruptor","nome":"Cozinha"}]},
      {"id":"quadro2","nome":"Quadro da garagem","tipo":"openbeken","medidor":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"sala","nome":"Interruptor sala","tipo":"openbeken","divisao":"Sala","canais":[{"n":1,"funcao":"interruptor","nome":"Teto"}]},
      {"id":"luz","nome":"Luz quarto","tipo":"shelly","divisao":"Quarto","canais":[{"n":1,"funcao":"luz"}]}]""",
    )

    /** Sem "geral": o medidor com "Quadro" no nome/divisão é o disjuntor (sem ligar a acentos/maiúsculas). */
    private val semGeral = aparelhos(
        """[
      {"id":"principal","nome":"Contador","tipo":"shelly","medidor":true,"divisao":"QUADRO ELÉTRICO","canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"tomada","nome":"Tomada TV","tipo":"shelly","medidor":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"gerall","nome":"Luz Geral da sala","tipo":"openbeken","canais":[{"n":1,"funcao":"interruptor"}]}]""",
    )

    private fun ap(l: List<Aparelho>, id: String) = l.first { it.id == id }

    @Test
    fun `disjuntor geral - flag geral, canal com nome e cargas perigosas de fora`() {
        assertEquals(listOf("quadro"), Riscos.aparelhosGerais(comGeral).map { it.id })
        assertTrue(Riscos.ehDisjuntorGeral(comGeral, ap(comGeral, "quadro"), 1))
        assertFalse("carga perigosa não é o disjuntor", Riscos.ehDisjuntorGeral(comGeral, ap(comGeral, "quadro"), 2))
        assertFalse("há um canal chamado Geral: os outros não contam", Riscos.ehDisjuntorGeral(comGeral, ap(comGeral, "quadro"), 3))
        assertFalse("com um geral marcado, o nome dos outros não conta", Riscos.ehDisjuntorGeral(comGeral, ap(comGeral, "quadro2"), 1))
        assertFalse(Riscos.ehDisjuntorGeral(comGeral, ap(comGeral, "sala"), 1))
    }

    @Test
    fun `disjuntor geral - sem flag, medidor com geral ou quadro no nome ou divisao`() {
        assertEquals(listOf("principal"), Riscos.aparelhosGerais(semGeral).map { it.id })
        assertTrue(Riscos.ehDisjuntorGeral(semGeral, ap(semGeral, "principal"), 1))
        assertFalse(Riscos.ehDisjuntorGeral(semGeral, ap(semGeral, "tomada"), 1))
        assertFalse("não é medidor", Riscos.ehDisjuntorGeral(semGeral, ap(semGeral, "gerall"), 1))
    }

    @Test
    fun `frases das acoes arriscadas, tambem dentro de SE e SENAO, sem repetidas`() {
        val acoes = listOf(
            Acao.Ligar(false, "quadro", 1),
            Acao.Ligar(true, "quadro", 2, 7200),
            Acao.Ligar(true, "sala", 1),
            Acao.Se(
                Condicoes(alarme = true),
                listOf(Acao.Alternar("quadro", 1), Acao.Ligar(false, "quadro", 1)),
                listOf(Acao.Se(Condicoes(alarme = false), listOf(Acao.Ligar(false, "quadro", 2)))),
            ),
            Acao.Notificar("x"),
            Acao.Luz("luz", 1, 50),
        )
        assertEquals(
            listOf(
                "Desligar o Quadro geral — a casa inteira fica sem luz.",
                "Ligar o Termoacumulador (carga perigosa) durante 2 h",
                "Alternar o Quadro geral — se estiver ligado, a casa inteira fica sem luz.",
                "Desligar o Termoacumulador (carga perigosa)",
            ),
            Riscos.descrever(acoes, comGeral),
        )
        assertEquals(
            listOf("Ligar o Quadro geral (disjuntor geral da casa)", "Desligar o Contador — a casa inteira fica sem luz. Volta a ligar ao fim de 1 h 30 min."),
            Riscos.descrever(listOf(Acao.Ligar(true, "quadro", 1)), comGeral) +
                Riscos.descrever(listOf(Acao.Ligar(false, "principal", 1, 5400)), semGeral),
        )
        assertEquals(emptyList<String>(), Riscos.descrever(listOf(Acao.Ligar(false, "sala", 1), Acao.Ligar(false, "inexistente", 1)), comGeral))
        assertEquals("45 s", Riscos.duracao(45))
        assertEquals("30 min", Riscos.duracao(1800))
    }

    @Test
    fun `executar ou testar uma automacao - pergunta so se mexer no disjuntor ou numa carga perigosa`() {
        // Normal: sem riscos, executa logo
        val normal = Automacao("n", "Luz da sala", quando = Quando.Manual, entao = listOf(Acao.Ligar(true, "sala", 1), Acao.Luz("luz", 1, 80)))
        assertEquals(emptyList<String>(), Riscos.daAutomacao(normal, comGeral))
        // Disjuntor geral (também dentro de SE) e carga perigosa
        val arriscada = Automacao(
            "r", "Sair de casa", quando = Quando.Manual,
            entao = listOf(
                Acao.Notificar("Adeus"),
                Acao.Se(Condicoes(alarme = true), listOf(Acao.Ligar(false, "quadro", 1)), listOf(Acao.Ligar(true, "quadro", 2, 3600))),
            ),
        )
        assertEquals(
            listOf("Desligar o Quadro geral — a casa inteira fica sem luz.", "Ligar o Termoacumulador (carga perigosa) durante 1 h"),
            Riscos.daAutomacao(arriscada, comGeral),
        )
        // Através de uma cena (e de uma cena dentro de outra, com ciclo), sem repetidas
        val cenas = listOf(
            Cena("fora", "Fora", acoes = listOf(Acao.Ligar(false, "sala", 1), Acao.Cena("banho"))),
            Cena("banho", "Banho", acoes = listOf(Acao.Ligar(true, "quadro", 2), Acao.Cena("fora"))),
            Cena("luzes", "Luzes", acoes = listOf(Acao.Luz("luz", 1, 30))),
        )
        val comCena = Automacao("c", "Cena", entao = listOf(Acao.Cena("fora"), Acao.Se(Condicoes(alarme = false), listOf(Acao.Cena("banho")))))
        assertEquals(listOf("Ligar o Termoacumulador (carga perigosa)"), Riscos.daAutomacao(comCena, comGeral, cenas))
        assertEquals(emptyList<String>(), Riscos.daAutomacao(Automacao("l", "L", entao = listOf(Acao.Cena("luzes"), Acao.Cena("inexistente"))), comGeral, cenas))
        // Sem a lista de cenas não se sabe o que a cena faz: não inventa riscos
        assertEquals(emptyList<String>(), Riscos.daAutomacao(comCena, comGeral))
    }

    @Test
    fun `modelos nunca propoem o disjuntor geral nem cargas perigosas`() {
        for (lista in listOf(comGeral, semGeral)) {
            val gerais = lista.flatMap { a -> a.canais.filter { Riscos.ehDisjuntorGeral(lista, a, it.n) || it.perigosa }.map { Alvo(a.id, it.n) } }.toSet()
            assertTrue(gerais.isNotEmpty())
            for (m in Modelos.todos(lista)) {
                fun alvos(l: List<RascunhoAcao>): List<Alvo> = l.flatMap { listOfNotNull(it.alvo) + alvos(it.entao) + alvos(it.senao) }
                val usados = alvos(m.rascunho.acoes) + listOfNotNull(m.rascunho.sensor)
                assertTrue("${m.id} usa $usados", usados.none { it in gerais })
                assertTrue(Riscos.descrever(m.rascunho.paraAutomacao(emptyList()).entao, lista).isEmpty())
            }
        }
        // "Consumo alto" é sobre o contador geral: esse sim, é o escolhido
        assertEquals("quadro", Modelos.todos(comGeral).first { it.id == "consumo-alto" }.rascunho.medidor)
    }

    @Test
    fun `automacao nova comeca sem aparelho escolhido e nao se guarda assim`() {
        val nova = Rascunho(nome = "X")
        assertEquals(null, nova.sensor)
        assertTrue(nova.acoes.all { it.alvo == null })
        val erros = Automacoes.validar(nova.paraAutomacao(emptyList()), comGeral, emptyList(), null)
        assertTrue(erros.toString(), erros.containsAll(listOf("Escolha o sensor.", "Ação 1: escolha o circuito.")))
        assertEquals(listOf("Ação 1: escolha o circuito."), Cenas.validar(Cena("c", "C", acoes = listOf(RascunhoAcao().paraAcao())), comGeral))
    }
}
