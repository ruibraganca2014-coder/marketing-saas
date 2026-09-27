package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomacoesTest {

    private val exemplo = """{
      "id": "luz-corredor",
      "nome": "Luz do corredor com movimento",
      "ativa": true,
      "bloqueada": false,
      "quando": {"tipo": "sensor", "aparelho": "pir-corredor", "canal": 1, "valor": 1},
      "se": {"alarme": false, "entre": ["19:00", "07:00"]},
      "entao": [
        {"acao": "ligar", "aparelho": "sala-4g", "canal": 4, "durante_s": 120}
      ]
    }"""

    private val listaJson = """[
      $exemplo,
      {"id":"empresa","nome":"Regra da empresa","ativa":true,"bloqueada":true,
       "quando":{"tipo":"potencia","aparelho":"quadro","acima_w":3500,"durante_s":60},
       "entao":[{"acao":"desligar","aparelho":"quadro","canal":1},{"acao":"notificar","mensagem":"Consumo alto"}],
       "extra":"mantido"},
      {"id":"noite","nome":"Noite","ativa":false,"quando":{"tipo":"hora","hora":"23:00","dias":[1,2,3,4,5]},
       "entao":[{"acao":"estore","aparelho":"estore-quarto","canal":1,"posicao":0}]},
      {"id":"estranha","nome":"Estranha","quando":{"tipo":"futuro"},"entao":[{"acao":"voar"}]},
      {"sem":"id"}
    ]"""

    private val aparelhos = listOf(
        Aparelho("quadro", "Quadro geral", "openbeken", medidor = true, canais = listOf(Canal(1, Funcao.INTERRUPTOR, "Geral", temNome = true))),
        Aparelho("sala-4g", "Interruptor sala", "openbeken", canais = (1..4).map { Canal(it, Funcao.INTERRUPTOR, listOf("Teto", "Candeeiro", "Varanda", "Corredor")[it - 1], temNome = true) }),
        Aparelho("pir-corredor", "Movimento corredor", "openbeken", bateria = true, canais = listOf(Canal(1, Funcao.MOVIMENTO, "Movimento corredor"), Canal(2, Funcao.BATERIA, "Movimento corredor"))),
        Aparelho("porta", "Porta de entrada", "openbeken", bateria = true, canais = listOf(Canal(1, Funcao.PORTA, "Porta de entrada"))),
        Aparelho("estore-quarto", "Estore quarto", "shelly", canais = listOf(Canal(1, Funcao.ESTORE, "Estore quarto"))),
    )

    private fun lista() = Automacoes.ler(listaJson)!!

    @Test
    fun `ler todos os tipos`() {
        val l = lista()
        assertEquals(listOf("luz-corredor", "empresa", "noite", "estranha"), l.map { it.id })
        val a = l[0]
        assertEquals(Quando.Sensor("pir-corredor", 1, 1), a.quando)
        assertEquals(Condicoes(false, "19:00" to "07:00"), a.se)
        assertEquals(listOf(Acao.Ligar(true, "sala-4g", 4, 120)), a.entao)
        assertTrue(a.editavel)
        val e = l[1]
        assertTrue(e.bloqueada)
        assertFalse(e.editavel)
        assertEquals(Quando.Potencia("quadro", 3500.0, 60), e.quando)
        assertEquals(listOf(Acao.Ligar(false, "quadro", 1, null), Acao.Notificar("Consumo alto")), e.entao)
        assertEquals(Quando.Hora("23:00", listOf(1, 2, 3, 4, 5)), l[2].quando)
        assertEquals(listOf(Acao.Estore("estore-quarto", 1, 0)), l[2].entao)
        assertFalse(l[2].ativa)
        // Desconhecida: mostra-se, não se edita
        assertNull(l[3].quando)
        assertEquals(1, l[3].acoesDesconhecidas)
        assertFalse(l[3].editavel)
        assertNull(Automacoes.ler("{}"))
        assertEquals(emptyList<Automacao>(), Automacoes.ler(""))
    }

    @Test
    fun `escrever e voltar a ler da o mesmo`() {
        val l = lista()
        val json = Automacoes.paraJson(l)
        val relida = Automacoes.ler(json)!!
        assertEquals(l.map { it.copy(original = null) }, relida.map { it.copy(original = null) })
        val arr = JSONArray(json)
        // Campos desconhecidos mantêm-se; números inteiros sem ".0"
        assertEquals("mantido", arr.getJSONObject(1).getString("extra"))
        assertTrue(json.contains("\"acima_w\":3500"))
        assertFalse(json.contains("3500.0"))
        // A desconhecida segue como veio
        assertEquals("futuro", arr.getJSONObject(3).getJSONObject("quando").getString("tipo"))
        assertEquals("voar", arr.getJSONObject(3).getJSONArray("entao").getJSONObject(0).getString("acao"))
    }

    @Test
    fun `json de uma automacao nova segue o contrato`() {
        val a = Automacao(
            id = "x", nome = "X",
            quando = Quando.Hora("07:30", listOf(3, 1, 1)),
            se = Condicoes(alarme = true),
            entao = listOf(Acao.Ligar(true, "sala-4g", 2), Acao.Estore("estore-quarto", 1, 50), Acao.Notificar("Bom dia")),
        )
        val o = Automacoes.paraJson(a)
        assertEquals(
            JSONObject(
                """{"id":"x","nome":"X","ativa":true,"bloqueada":false,
                "quando":{"tipo":"hora","hora":"07:30","dias":[1,3]},
                "se":{"alarme":true},
                "entao":[{"acao":"ligar","aparelho":"sala-4g","canal":2},
                         {"acao":"estore","aparelho":"estore-quarto","canal":1,"posicao":50},
                         {"acao":"notificar","mensagem":"Bom dia"}]}"""
            ).toMap(),
            o.toMap(),
        )
        // Sem condições: sem "se"
        assertFalse(Automacoes.paraJson(a.copy(se = null)).has("se"))
    }

    @Test
    fun `editar a lista - guardar, remover, ativar e bloqueadas`() {
        val l = lista()
        val nova = Automacao("nova", "Nova", quando = Quando.Hora("08:00", listOf(1)), entao = listOf(Acao.Notificar("x")))
        assertEquals(listOf("luz-corredor", "empresa", "noite", "estranha", "nova"), Automacoes.guardar(l, nova).map { it.id })

        // Editar mantém a posição e o JSON original (campos desconhecidos)
        val editada = l[2].copy(nome = "Noite editada", original = null)
        val g = Automacoes.guardar(l, editada, "noite")
        assertEquals("Noite editada", g[2].nome)
        assertEquals(l[2].original, g[2].original)

        // Bloqueadas não se substituem nem apagam, mas ativam/desativam
        assertSame(l, Automacoes.guardar(l, l[1].copy(nome = "hack"), "empresa"))
        assertEquals(l, Automacoes.remover(l, "empresa"))
        val sem = Automacoes.remover(l, "noite")
        assertEquals(listOf("luz-corredor", "empresa", "estranha"), sem.map { it.id })
        val desligada = Automacoes.comAtiva(l, "empresa", false)
        assertFalse(desligada[1].ativa)
        assertTrue(desligada[1].bloqueada)
        // Ao publicar, a bloqueada segue exatamente como veio, só com "ativa" mudado
        val o = JSONArray(Automacoes.paraJson(desligada)).getJSONObject(1)
        assertEquals(false, o.getBoolean("ativa"))
        assertEquals(JSONObject(l[1].original!!).put("ativa", false).toMap(), o.toMap())
    }

    @Test
    fun `slug`() {
        assertEquals("luz-do-corredor", Automacoes.slug("Luz do corredor"))
        assertEquals("acao-a-noite", Automacoes.slug("  Ação à noite!! "))
        assertEquals("automacao", Automacoes.slug("???"))
        assertEquals("a-2", Automacoes.slug("A", listOf("a")))
        assertEquals("a-3", Automacoes.slug("a", listOf("a", "a-2")))
        assertTrue(Automacoes.slug("x".repeat(80), listOf("x".repeat(34))).length <= 40)
        assertTrue(Automacoes.ID_RE.matches(Automacoes.slug("É muito longo " + "palavra ".repeat(10))))
    }

    @Test
    fun `validar - valida o exemplo do contrato`() {
        assertEquals(emptyList<String>(), Automacoes.validar(lista()[0], aparelhos))
        assertEquals(emptyList<String>(), Automacoes.validar(lista()[1], aparelhos))
        assertEquals(emptyList<String>(), Automacoes.validar(lista()[2], aparelhos))
    }

    @Test
    fun `validar - erros`() {
        val base = lista()[0]
        fun erros(a: Automacao) = Automacoes.validar(a, aparelhos)
        assertEquals(listOf("Identificador inválido."), erros(base.copy(id = "Com Espaços")))
        assertEquals(listOf("Dê um nome à automação."), erros(base.copy(nome = " ")))
        assertEquals(listOf("Escolha quando a automação dispara."), erros(base.copy(quando = null)))
        assertEquals(listOf("Escolha o sensor."), erros(base.copy(quando = Quando.Sensor("", 0, 1))))
        // v3: o gatilho "sensor" serve também para interruptor/luz; estore e bateria não.
        assertEquals(emptyList<String>(), erros(base.copy(quando = Quando.Sensor("quadro", 1, 1))))
        assertEquals(listOf("Escolha um sensor, circuito ou luz."), erros(base.copy(quando = Quando.Sensor("estore-quarto", 1, 1))))
        assertEquals(listOf("Escolha o estado do sensor."), erros(base.copy(quando = Quando.Sensor("porta", 1, 2))))
        assertEquals(
            listOf("Indique a hora (HH:MM).", "Escolha pelo menos um dia."),
            erros(base.copy(quando = Quando.Hora("24:00", emptyList()))),
        )
        assertEquals(listOf("Escolha pelo menos um dia."), erros(base.copy(quando = Quando.Hora("23:59", listOf(0)))))
        assertEquals(
            listOf("Esse aparelho não mede consumo.", "Indique a potência (W).", "Indique durante quantos segundos."),
            erros(base.copy(quando = Quando.Potencia("sala-4g", 0.0, -1))),
        )
        assertEquals(listOf("Horário inválido (HH:MM)."), erros(base.copy(se = Condicoes(entre = "7h" to "08:00"))))
        // v3: até 20 ações (contando as de dentro de SE/SENÃO).
        assertEquals(listOf("Tem de ter entre 1 e 20 ações."), erros(base.copy(entao = emptyList())))
        assertEquals(
            listOf("Tem de ter entre 1 e 20 ações."),
            erros(base.copy(entao = List(21) { Acao.Notificar("x") })),
        )
        assertEquals(
            listOf(
                "Ação 1: escolha o circuito.",
                "Ação 2: escolha um circuito ou uma luz.",
                "Ação 3: duração inválida.",
                "Ação 4: escolha um estore.",
                "Ação 5: posição de 0 a 100.",
                "Ação 6: escreva a mensagem.",
                "Ação 7: escolha o estore.",
            ),
            erros(
                base.copy(
                    entao = listOf(
                        Acao.Ligar(true, "", 0),
                        Acao.Ligar(false, "porta", 1),
                        Acao.Ligar(true, "sala-4g", 1, 0),
                        Acao.Estore("sala-4g", 1, 50),
                        Acao.Estore("estore-quarto", 1, 101),
                        Acao.Notificar("  "),
                        Acao.Estore("", 0, 10),
                    )
                )
            ),
        )
        // Sem lista de aparelhos não se verificam referências
        assertEquals(emptyList<String>(), Automacoes.validar(base.copy(quando = Quando.Sensor("qualquer", 3, 1))))
    }

    @Test
    fun `validar lista`() {
        val a = lista()[0]
        assertEquals(emptyList<String>(), Automacoes.validarLista(listOf(a)))
        assertEquals(listOf("Identificador repetido: luz-corredor."), Automacoes.validarLista(listOf(a, a)))
        val muitas = (1..51).map { a.copy(id = "a$it") }
        assertEquals(listOf("No máximo 50 automações."), Automacoes.validarLista(muitas))
    }

    @Test
    fun `descrever`() {
        val l = lista()
        assertEquals(
            "Quando Movimento corredor deteta movimento, com alarme desligado, entre 19:00 e 07:00 → liga Interruptor sala · Corredor durante 2 min",
            Automacoes.descrever(l[0], aparelhos),
        )
        assertEquals(
            "Quando Quadro geral passa 3500 W durante 1 min → desliga Geral; avisa: \"Consumo alto\"",
            Automacoes.descrever(l[1], aparelhos),
        )
        assertEquals("Às 23:00, dias úteis → põe Estore quarto a 0 %", Automacoes.descrever(l[2], aparelhos))
        assertEquals("Regra definida pela Domus Energia", Automacoes.descrever(l[3], aparelhos))
        assertEquals("todos os dias", Automacoes.descreverDias((1..7).toList()))
        assertEquals("fins de semana", Automacoes.descreverDias(listOf(7, 6)))
        assertEquals("seg, qua", Automacoes.descreverDias(listOf(3, 1)))
    }
}
