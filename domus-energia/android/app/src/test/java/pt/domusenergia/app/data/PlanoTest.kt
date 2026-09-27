package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** `_plano`, tabela de funcionalidades e textos da subscrição (docs/PROTOCOLO-PLANOS.md §1–§3). */
class PlanoTest {

    private fun aplica(vararg msgs: Pair<String, String>, inicial: Estado = Estado()): Estado =
        msgs.fold(inicial) { e, (t, p) -> EstadoParser.reduzir(e, "joao", "domus/joao/$t", p, retida = true) }

    @Test
    fun `sem _plano retido fica Conforto ativo gerido a mao`() {
        val e = Estado()
        assertNull(e.plano)
        assertEquals(Subscricao(Planos.CONFORTO, Planos.ATIVO, gerido = Planos.MANUAL), e.subscricao)
        assertTrue(e.permite(Planos.ALARME))
        assertTrue(e.permite(Planos.NOTIFICACOES))
        assertFalse(e.permite(Planos.LOCAL))
        assertFalse(e.subscricao.bloqueada)
        assertTrue(e.subscricao.manual)
    }

    @Test
    fun `_plano completo do contrato`() {
        val e = aplica(
            "_plano" to """{"plano": "conforto", "estado": "ativo", "desde": "2026-10-01T10:00:00Z",
              "proximo_pagamento": "2026-11-01T10:00:00Z", "aviso_ate": null, "gerido": "stripe"}""",
        )
        assertEquals(
            Subscricao(
                Planos.CONFORTO, Planos.ATIVO,
                desde = Instant.parse("2026-10-01T10:00:00Z"),
                proximoPagamento = Instant.parse("2026-11-01T10:00:00Z"),
                avisoAte = null,
                gerido = Planos.STRIPE,
            ),
            e.plano,
        )
        assertFalse(e.subscricao.manual)
    }

    @Test
    fun `_plano base em atraso com aviso_ate e datas com desvio`() {
        val e = aplica("_plano" to """{"plano":"BASE","estado":"em_atraso","aviso_ate":"2026-10-16T11:00:00+01:00","gerido":"stripe"}""")
        val s = e.subscricao
        assertEquals(Planos.BASE, s.plano)
        assertTrue(s.emAtraso)
        assertEquals(Instant.parse("2026-10-16T10:00:00Z"), s.avisoAte)
        // Em atraso mantém as funcionalidades do plano (Base).
        assertTrue(e.permite(Planos.AUTOMACOES))
        assertFalse(e.permite(Planos.ALARME))
    }

    @Test
    fun `_plano invalido fica como estava, apagado volta ao padrao, set nao e estado`() {
        val e = aplica("_plano" to """{"plano":"premium","estado":"teste","gerido":"stripe"}""")
        assertEquals(Planos.PREMIUM, e.plano!!.plano)
        assertSame(e, aplica("_plano" to "{", inicial = e))
        assertSame(e, aplica("_plano" to "[]", inicial = e))
        assertSame(e, aplica("_plano" to """{"plano":"ouro","estado":"ativo"}""", inicial = e))
        assertSame(e, aplica("_plano" to """{"plano":"base","estado":"pausado"}""", inicial = e))
        assertSame(e, aplica("_plano" to """{"estado":"ativo"}""", inicial = e))
        assertSame(e, aplica("_plano" to """{"plano":1,"estado":"ativo"}""", inicial = e))
        assertSame(e, aplica("_plano/set" to """{"plano":"base","estado":"suspenso"}""", inicial = e))
        // Mensagem retida apagada (payload vazio): volta ao padrão.
        val apagado = aplica("_plano" to "", inicial = e)
        assertNull(apagado.plano)
        assertEquals(Subscricao.PADRAO, apagado.subscricao)
        // Tópico de outro cliente: ignorado.
        assertSame(e, e.let { EstadoParser.reduzir(it, "joao", "domus/maria/_plano", """{"plano":"base","estado":"suspenso"}""") })
    }

    @Test
    fun `gerido desconhecido ou em falta e manual, datas invalidas ficam nulas`() {
        val s = Subscricao.ler("""{"plano":"base","estado":"ativo","gerido":"paypal","desde":"ontem","proximo_pagamento":42}""")!!
        assertEquals(Planos.MANUAL, s.gerido)
        assertNull(s.desde)
        assertNull(s.proximoPagamento)
        assertEquals(Planos.MANUAL, Subscricao.ler("""{"plano":"base","estado":"ativo"}""")!!.gerido)
    }

    @Test
    fun `suspenso e cancelado bloqueiam tudo`() {
        for (estado in listOf(Planos.SUSPENSO, Planos.CANCELADO)) {
            val e = aplica("_plano" to """{"plano":"premium","estado":"$estado","gerido":"stripe"}""")
            assertTrue(e.subscricao.bloqueada)
            for (chave in Planos.FUNCIONALIDADES) assertFalse("$estado/$chave", e.permite(chave))
        }
    }

    @Test
    fun `tabela de funcionalidades por plano`() {
        val base = setOf("controlo", "automacoes", "cenas", "historico", "relatorio")
        val conforto = base + setOf("alarme", "notificacoes", "saude", "energia", "relatorio_diario")
        val premium = conforto + setOf("local", "suporte_prioritario")
        assertEquals(premium, Planos.FUNCIONALIDADES)
        val esperado = mapOf(Planos.BASE to base, Planos.CONFORTO to conforto, Planos.PREMIUM to premium)
        for (estado in listOf(Planos.ATIVO, Planos.TESTE, Planos.EM_ATRASO)) {
            for ((plano, tem) in esperado) {
                for (chave in Planos.FUNCIONALIDADES) {
                    assertEquals("$plano/$estado/$chave", chave in tem, Planos.permite(plano, estado, chave))
                }
            }
        }
        // Desconhecidos: nunca.
        assertFalse(Planos.permite(Planos.PREMIUM, Planos.ATIVO, "teletransporte"))
        assertFalse(Planos.permite("ouro", Planos.ATIVO, Planos.CONTROLO))
        assertFalse(Planos.permite(Planos.PREMIUM, "pausado", Planos.CONTROLO))
    }

    @Test
    fun `plano minimo e texto do cadeado`() {
        assertEquals(Planos.CONFORTO, Planos.planoMinimo(Planos.ALARME))
        assertEquals(Planos.BASE, Planos.planoMinimo(Planos.CENAS))
        assertEquals(Planos.PREMIUM, Planos.planoMinimo(Planos.LOCAL))
        assertNull(Planos.planoMinimo("x"))
        assertEquals("Disponível no plano Conforto — mudar de plano", Planos.textoBloqueado(Planos.ALARME))
        assertEquals("Disponível no plano Conforto — mudar de plano", Planos.textoBloqueado(Planos.RELATORIO_DIARIO))
        assertEquals("Disponível no plano Premium — mudar de plano", Planos.textoBloqueado(Planos.SUPORTE_PRIORITARIO))
        assertTrue(Planos.eErroDePlano("Disponível a partir do plano Conforto."))
        assertFalse(Planos.eErroDePlano("Não armado: Janela WC está aberta."))
        assertFalse(Planos.eErroDePlano(null))
    }

    @Test
    fun `nomes e precos`() {
        assertEquals(listOf("Base", "Conforto", "Premium"), Planos.TODOS.map(Planos::nome))
        assertEquals(listOf("4,99 €/mês", "9,99 €/mês", "19,99 €/mês"), Planos.TODOS.map(Planos::preco))
        assertTrue(Planos.TODOS.all { Planos.inclui(it).isNotEmpty() })
    }

    @Test
    fun `textos do estado em palavras simples`() {
        assertEquals(
            listOf("Ativa", "Mês grátis", "Pagamento em atraso", "Suspensa", "Cancelada"),
            Planos.ESTADOS.map(TextosPlano::rotuloEstado),
        )
        // Datas em pt-PT, hora de Lisboa (23:30 UTC de 31/10 = 31/10 em Lisboa; 23:30 UTC de 31/3 = 1/4, hora de verão).
        assertEquals("1 de novembro de 2026", TextosPlano.data(Instant.parse("2026-11-01T10:00:00Z")))
        assertEquals("1 de abril de 2027", TextosPlano.data(Instant.parse("2027-03-31T23:30:00Z")))

        val ativa = Subscricao(Planos.CONFORTO, Planos.ATIVO, proximoPagamento = Instant.parse("2026-11-01T10:00:00Z"), gerido = Planos.STRIPE)
        assertEquals("A sua subscrição está em dia. O pagamento é feito automaticamente todos os meses.", TextosPlano.explicacao(ativa))
        assertEquals("1 de novembro de 2026", TextosPlano.proximoPagamento(ativa))
        assertEquals(
            "A sua subscrição está em dia. É gerida diretamente pela Domus Energia.",
            TextosPlano.explicacao(ativa.copy(gerido = Planos.MANUAL)),
        )
        assertEquals(
            "Está no primeiro mês grátis. O primeiro pagamento é a 1 de novembro de 2026.",
            TextosPlano.explicacao(ativa.copy(estado = Planos.TESTE)),
        )
        val atraso = ativa.copy(estado = Planos.EM_ATRASO, avisoAte = Instant.parse("2026-10-16T10:00:00Z"))
        assertEquals("O último pagamento falhou. Tem até 16 de outubro de 2026 para o atualizar.", TextosPlano.explicacao(atraso))
        assertEquals(
            "O último pagamento falhou. Atualize o pagamento até 16 de outubro de 2026 para não perder o acesso à app, às automações e ao alarme.",
            TextosPlano.avisoAtraso(atraso),
        )
        assertNull(TextosPlano.proximoPagamento(atraso))
        assertEquals(
            "O último pagamento falhou. Atualize o pagamento para não perder o acesso à app, às automações e ao alarme.",
            TextosPlano.avisoAtraso(atraso.copy(avisoAte = null)),
        )
        val suspensa = ativa.copy(estado = Planos.SUSPENSO)
        assertTrue(TextosPlano.explicacao(suspensa).startsWith("A subscrição está suspensa por falta de pagamento. Os interruptores"))
        assertTrue(TextosPlano.explicacao(suspensa.copy(estado = Planos.CANCELADO)).startsWith("A subscrição foi cancelada."))
        // Suspensa/cancelada: sem "próximo pagamento".
        assertNull(TextosPlano.proximoPagamento(suspensa))
        assertNull(TextosPlano.proximoPagamento(ativa.copy(proximoPagamento = null)))
    }

    @Test
    fun `contactos de exemplo nao aparecem`() {
        assertNull(Contactos.numero("351000000000"))
        assertNull(Contactos.numero("+351 000 000 000"))
        assertNull(Contactos.numero(""))
        assertEquals("351912345678", Contactos.numero("+351 912 345 678"))
        assertEquals("tel:+351210123456", Contactos.telefoneUrl("+351 210 123 456"))
        assertEquals(
            "https://wa.me/351912345678?text=Ol%C3%A1%2C%20sou%20cliente",
            Contactos.whatsappUrl("351912345678", "Olá, sou cliente"),
        )
    }
}
