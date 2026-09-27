package pt.domusenergia.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Automações v3 (docs/PROTOCOLO-MQTT-v3.md §8): leitura, escrita, assistente (Rascunho) e validação. */
class AutomacoesV3Test {

    private val aparelhos = listOf(
        Aparelho("quadro", "Quadro geral", "openbeken", medidor = true, canais = listOf(
            Canal(1, Funcao.INTERRUPTOR, "Geral", temNome = true),
            Canal(2, Funcao.INTERRUPTOR, "Termoacumulador", temNome = true, carga = Canal.CARGA_PERIGOSA),
        )),
        Aparelho("sala-4g", "Interruptor sala", "openbeken", canais = (1..4).map {
            Canal(it, Funcao.INTERRUPTOR, listOf("Teto", "Candeeiro", "Varanda", "Corredor")[it - 1], temNome = true)
        }),
        Aparelho("led", "LED cozinha", "shelly", canais = listOf(Canal(1, Funcao.LUZ, "LED cozinha"))),
        Aparelho("pir", "Movimento corredor", "openbeken", bateria = true, canais = listOf(Canal(1, Funcao.MOVIMENTO, "Movimento corredor"), Canal(2, Funcao.BATERIA, "Movimento corredor"))),
        Aparelho("porta", "Porta de entrada", "openbeken", bateria = true, canais = listOf(Canal(1, Funcao.PORTA, "Porta de entrada", entrada = true))),
        Aparelho("estore", "Estore quarto", "shelly", canais = listOf(Canal(1, Funcao.ESTORE, "Estore quarto"))),
    )
    private val cenas = listOf(Cena("cinema", "Noite de cinema", "filme", acoes = listOf(Acao.Luz("led", 1, 20))))
    private val comLocal = ConfigCasa(local = Local(38.72, -9.14))

    // Uma automação por cada gatilho, com todas as condições e todas as ações da v3.
    private val gatilhos = listOf(
        """{"tipo":"sensor","aparelho":"pir","canal":1,"valor":0,"durante_s":600}""",
        """{"tipo":"sensor","aparelho":"sala-4g","canal":1,"valor":1}""",
        """{"tipo":"hora","hora":"07:30","dias":[1,2,3,4,5]}""",
        """{"tipo":"potencia","aparelho":"quadro","acima_w":3500,"durante_s":60,"rearmar_w":3200}""",
        """{"tipo":"potencia","aparelho":"quadro","acima_w":2500.5,"durante_s":30}""",
        """{"tipo":"sol","evento":"por","desvio_min":-30}""",
        """{"tipo":"sol","evento":"nascer","desvio_min":45}""",
        """{"tipo":"presenca","evento":"chega_primeiro"}""",
        """{"tipo":"presenca","evento":"sai_ultimo"}""",
        """{"tipo":"modo","modo":"noite"}""",
        """{"tipo":"manual"}""",
        """{"tipo":"sistema","evento":"aparelho_offline","aparelho":"quadro"}""",
        """{"tipo":"sistema","evento":"aparelho_online"}""",
        """{"tipo":"sistema","evento":"energia_reposta"}""",
    )
    private val condicoesTodas =
        """{"alarme":false,"entre":["19:00","07:00"],"dias":[1,5,6],"sol":"noite","modo":["casa","noite"],"presenca":"alguem",
           "aparelhos":[{"aparelho":"porta","canal":1,"valor":0},{"aparelho":"sala-4g","canal":2,"valor":1}]}"""
    private val acoesTodas = """[
        {"acao":"ligar","aparelho":"sala-4g","canal":4,"durante_s":120},
        {"acao":"desligar","aparelho":"sala-4g","canal":1},
        {"acao":"ligar","aparelho":"quadro","canal":2,"durante_s":3600},
        {"acao":"estore","aparelho":"estore","canal":1,"posicao":30},
        {"acao":"notificar","mensagem":"Olá"},
        {"acao":"luz","aparelho":"led","canal":1,"brilho":40},
        {"acao":"alternar","aparelho":"sala-4g","canal":2},
        {"acao":"cena","cena":"cinema"},
        {"acao":"modo","modo":"fora","forcar":false},
        {"acao":"modo","modo":"noite","forcar":true},
        {"acao":"esperar","s":300},
        {"acao":"se","condicao":{"sol":"noite","presenca":"ninguem"},
         "entao":[{"acao":"luz","aparelho":"led","canal":1,"brilho":10},
                  {"acao":"se","condicao":{"modo":["ferias"]},"entao":[{"acao":"esperar","s":60}],"senao":[]}],
         "senao":[{"acao":"notificar","mensagem":"Dia"}]}
    ]"""

    private fun automacaoJson(quando: String, id: String = "a") = """{"id":"$id","nome":"Automação $id","ativa":true,"bloqueada":false,
        "descricao":"Acender a luz do corredor quando alguém passa, só à noite","categoria":"conveniencia","ignorar_pausa":true,
        "quando":$quando,"se":$condicoesTodas,"entao":$acoesTodas}"""

    @Test
    fun `json - le e escreve igual para todos os gatilhos, condicoes e acoes`() {
        for ((i, g) in gatilhos.withIndex()) {
            val json = automacaoJson(g, "a$i")
            val a = Automacoes.lerUma(JSONObject(json))!!
            assertTrue("editável: $g", a.editavel)
            assertNotNullQuando(a, g)
            // Escrever a partir do modelo (sem o original) dá exatamente o mesmo JSON
            val escrito = Automacoes.paraJson(a.copy(original = null))
            assertEquals(g, JSONObject(json).toMap(), JSONObject(escrito.toString()).toMap())
        }
    }

    private fun assertNotNullQuando(a: Automacao, g: String) {
        assertTrue("quando lido: $g", a.quando != null)
        assertEquals(12, a.entao.size)
        assertEquals(16, Automacoes.contarAcoes(a.entao))
        assertEquals(2, Automacoes.niveisSe(a.entao))
    }

    @Test
    fun `assistente - rascunho de e para automacao da o mesmo para tudo`() {
        for ((i, g) in gatilhos.withIndex()) {
            val a = Automacoes.lerUma(JSONObject(automacaoJson(g, "a$i")))!!.copy(original = null)
            val r = Rascunho.de(a)
            val volta = r.paraAutomacao(listOf(a))
            assertEquals(g, a, volta)
            assertEquals(g, Automacoes.paraJson(a).toString(), Automacoes.paraJson(volta).toString())
        }
    }

    @Test
    fun `assistente - campos do rascunho dao o json do contrato`() {
        val r = Rascunho(
            nome = "Luz do corredor",
            descricao = "  Acender a luz quando passo à noite ",
            categoria = Categorias.CONVENIENCIA,
            tipoQuando = Rascunho.SENSOR,
            sensor = Alvo("pir", 1),
            valor = 0,
            sensorDuranteMin = "10",
            condSol = Condicoes.NOITE,
            condModos = setOf(Modos.NOITE, Modos.CASA),
            condDias = setOf(7, 6),
            condPresenca = Condicoes.ALGUEM,
            condAparelhos = listOf(Alvo("porta", 1) to 0),
            acoes = listOf(
                RascunhoAcao(RascunhoAcao.DESLIGAR, Alvo("sala-4g", 4)),
                RascunhoAcao(RascunhoAcao.ESPERAR, esperaS = "30"),
                RascunhoAcao(RascunhoAcao.LUZ, Alvo("led", 1), brilho = 25),
                RascunhoAcao(
                    RascunhoAcao.SE,
                    condicao = RascunhoCondicoes(modos = setOf(Modos.FERIAS)),
                    entao = listOf(RascunhoAcao(RascunhoAcao.CENA, cena = "cinema")),
                    senao = listOf(RascunhoAcao(RascunhoAcao.MODO, modo = Modos.NOITE, forcar = true)),
                ),
            ),
        )
        val a = r.paraAutomacao(emptyList())
        assertEquals(emptyList<String>(), Automacoes.validar(a, aparelhos, cenas, comLocal))
        assertEquals(
            JSONObject(
                """{"id":"luz-do-corredor","nome":"Luz do corredor","ativa":true,"bloqueada":false,
                   "descricao":"Acender a luz quando passo à noite","categoria":"conveniencia",
                   "quando":{"tipo":"sensor","aparelho":"pir","canal":1,"valor":0,"durante_s":600},
                   "se":{"dias":[6,7],"sol":"noite","modo":["casa","noite"],"presenca":"alguem",
                         "aparelhos":[{"aparelho":"porta","canal":1,"valor":0}]},
                   "entao":[{"acao":"desligar","aparelho":"sala-4g","canal":4},{"acao":"esperar","s":30},
                            {"acao":"luz","aparelho":"led","canal":1,"brilho":25},
                            {"acao":"se","condicao":{"modo":["ferias"]},"entao":[{"acao":"cena","cena":"cinema"}],
                             "senao":[{"acao":"modo","modo":"noite","forcar":true}]}]}"""
            ).toMap(),
            JSONObject(Automacoes.paraJson(a).toString()).toMap(),
        )
        // Sem descrição, categoria nem ignorar_pausa: os campos não vão no JSON
        val simples = Automacoes.paraJson(r.copy(descricao = " ", categoria = null).paraAutomacao(emptyList()))
        assertFalse(simples.has("descricao"))
        assertFalse(simples.has("categoria"))
        assertFalse(simples.has("ignorar_pausa"))
    }

    @Test
    fun `assistente - gatilhos novos a partir dos campos`() {
        val base = Rascunho(nome = "x")
        assertEquals(Quando.Sol("nascer", -30), base.copy(tipoQuando = Rascunho.SOL, solEvento = "nascer", solDesvioMin = "-30").quando())
        assertEquals(Quando.Presenca("sai_ultimo"), base.copy(tipoQuando = Rascunho.PRESENCA, presencaEvento = "sai_ultimo").quando())
        assertEquals(Quando.Modo("fora"), base.copy(tipoQuando = Rascunho.MODO, modoGatilho = "fora").quando())
        assertEquals(Quando.Manual, base.copy(tipoQuando = Rascunho.MANUAL).quando())
        assertEquals(Quando.Sistema("energia_reposta"), base.copy(tipoQuando = Rascunho.SISTEMA, sistemaAparelho = "quadro").quando())
        assertEquals(
            Quando.Sistema("aparelho_offline", "quadro"),
            base.copy(tipoQuando = Rascunho.SISTEMA, sistemaEvento = "aparelho_offline", sistemaAparelho = "quadro").quando(),
        )
        assertEquals(
            Quando.Potencia("quadro", 3500.0, 60, 3200.0),
            base.copy(tipoQuando = Rascunho.POTENCIA, medidor = "quadro", acimaW = "3 500", duranteS = "60", rearmarW = "3200").quando(),
        )
        assertEquals(Quando.Sensor("pir", 1, 0, 90), base.copy(sensor = Alvo("pir", 1), valor = 0, sensorDuranteMin = "1,5").quando())
        assertEquals(Quando.Sensor("pir", 1, 1, null), base.copy(sensor = Alvo("pir", 1)).quando())
    }

    @Test
    fun `desconhecidos ficam so de leitura e seguem como vieram`() {
        val l = Automacoes.ler(
            """[
              {"id":"amb","nome":"Ambiente","quando":{"tipo":"hora","hora":"08:00","dias":[1]},
               "se":{"ambiente":{"aparelho":"t","canal":1,"acima":25}},"entao":[{"acao":"notificar","mensagem":"x"}]},
              {"id":"extra","nome":"Extra","quando":{"tipo":"sensor","aparelho":"pir","canal":1,"valor":1,"futuro":1},
               "entao":[{"acao":"notificar","mensagem":"x"}]},
              {"id":"se-mau","nome":"SE mau","quando":{"tipo":"manual"},
               "entao":[{"acao":"se","condicao":{"alarme":true},"entao":[{"acao":"voar"}]}]}
            ]""",
        )!!
        assertTrue(l.none { it.editavel })
        assertEquals(1, l[2].acoesDesconhecidas)
        // Ao guardar (ex.: desativar), seguem como vieram (só com "ativa" e "bloqueada", do contrato, explícitos)
        val arr = JSONArray(Automacoes.paraJson(Automacoes.comAtiva(l, "amb", false)))
        assertEquals(JSONObject(l[0].original!!).put("ativa", false).put("bloqueada", false).toMap(), arr.getJSONObject(0).toMap())
        assertEquals(JSONObject(l[1].original!!).put("ativa", true).put("bloqueada", false).toMap(), arr.getJSONObject(1).toMap())
        assertEquals(JSONObject(l[2].original!!).put("ativa", true).put("bloqueada", false).toMap(), arr.getJSONObject(2).toMap())
    }

    @Test
    fun `validar - limites de acoes, niveis, carga perigosa, esperar, sol, cenas`() {
        fun a(vararg acoes: Acao, quando: Quando = Quando.Manual, se: Condicoes? = null) =
            Automacao("x", "X", quando = quando, se = se, entao = acoes.toList())
        fun erros(x: Automacao, config: ConfigCasa? = comLocal) = Automacoes.validar(x, aparelhos, cenas, config)

        // 20 no total (contando as de dentro do SE) é o máximo
        val dezanove = List(18) { Acao.Notificar("x") }
        assertEquals(emptyList<String>(), erros(a(*dezanove.toTypedArray(), Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("y"))))))
        assertEquals(
            listOf("Tem de ter entre 1 e 20 ações."),
            erros(a(*dezanove.toTypedArray(), Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("y"), Acao.Notificar("z"))))),
        )
        // Máximo 2 níveis de SE
        val nivel3 = Acao.Se(Condicoes(alarme = true), listOf(Acao.Se(Condicoes(alarme = true), listOf(Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("x")))))))
        assertEquals(listOf("No máximo 2 níveis de SE/SENÃO."), erros(a(nivel3)))

        // Carga perigosa: ligar só com duração até 4 h; alternar não
        assertEquals(
            listOf("Ação 1: Termoacumulador é uma carga perigosa; indique durante quanto tempo (máx. 4 h)."),
            erros(a(Acao.Ligar(true, "quadro", 2))),
        )
        assertEquals(listOf("Ação 1: Termoacumulador é uma carga perigosa; no máximo 4 h."), erros(a(Acao.Ligar(true, "quadro", 2, 4 * 3600 + 1))))
        assertEquals(emptyList<String>(), erros(a(Acao.Ligar(true, "quadro", 2, 4 * 3600))))
        assertEquals(emptyList<String>(), erros(a(Acao.Ligar(false, "quadro", 2)))) // desligar pode sempre
        assertEquals(listOf("Ação 1: Termoacumulador é uma carga perigosa; use \"Ligar\" com duração."), erros(a(Acao.Alternar("quadro", 2))))
        // ... também dentro de um SENÃO (numeração "3.s1")
        assertEquals(
            listOf("Ação 1.s1: Termoacumulador é uma carga perigosa; indique durante quanto tempo (máx. 4 h)."),
            erros(a(Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("x")), listOf(Acao.Ligar(true, "quadro", 2))))),
        )

        // Esperar, luz, estore, alternar, cena, modo
        assertEquals(
            listOf(
                "Ação 1: esperar de 1 s a 1 h.",
                "Ação 2: esperar de 1 s a 1 h.",
                "Ação 3: escolha uma luz com brilho.",
                "Ação 4: brilho de 0 a 100.",
                "Ação 5: escolha um circuito ou uma luz.",
                "Ação 6: essa cena não existe.",
                "Ação 7: escolha a cena.",
                "Ação 8: escolha o modo.",
            ),
            erros(a(
                Acao.Esperar(0), Acao.Esperar(3601), Acao.Luz("sala-4g", 1, 50), Acao.Luz("led", 1, 101),
                Acao.Alternar("estore", 1), Acao.Cena("nao-existe"), Acao.Cena(""), Acao.Modo("praia"),
            )),
        )
        // SE: condição vazia e sem ações
        assertEquals(
            listOf("Ação 1: escolha a condição do SE.", "Ação 1: o SE precisa de pelo menos uma ação."),
            erros(a(Acao.Se(Condicoes(), emptyList()))),
        )

        // Sol precisa da localização da casa (gatilho ou condição)
        val sol = a(Acao.Notificar("x"), quando = Quando.Sol("por", -30))
        assertEquals(emptyList<String>(), erros(sol))
        assertEquals(listOf("Defina a localização da casa em Definições (nascer e pôr do sol)."), erros(sol, ConfigCasa()))
        assertEquals(emptyList<String>(), erros(sol, null)) // config desconhecida: não se verifica
        assertEquals(
            listOf("Defina a localização da casa em Definições (nascer e pôr do sol)."),
            erros(a(Acao.Notificar("x"), se = Condicoes(sol = "noite")), ConfigCasa()),
        )
        assertEquals(listOf("O desvio do sol vai de -180 a 180 min."), erros(a(Acao.Notificar("x"), quando = Quando.Sol("por", 181))))

        // Gatilhos e condições inválidos
        assertEquals(
            listOf(
                "Escolha chegar ou sair.",
                "Escolha pelo menos um dia na condição.",
                "Escolha pelo menos um modo.",
                "Condição de presença inválida.",
                "Escolha o aparelho da condição.",
            ),
            erros(a(
                Acao.Notificar("x"),
                quando = Quando.Presenca("talvez"),
                se = Condicoes(dias = emptyList(), modo = listOf("praia"), presenca = "todos", aparelhos = listOf(EstadoCanal("nada", 1, 1))),
            )),
        )
        assertEquals(listOf("Escolha o modo."), erros(a(Acao.Notificar("x"), quando = Quando.Modo("praia"))))
        assertEquals(listOf("Escolha o evento do sistema."), erros(a(Acao.Notificar("x"), quando = Quando.Sistema("explodiu"))))
        assertEquals(listOf("Esse aparelho não existe."), erros(a(Acao.Notificar("x"), quando = Quando.Sistema("aparelho_offline", "fantasma"))))
        assertEquals(
            listOf("O rearme tem de ficar abaixo do limite."),
            erros(a(Acao.Notificar("x"), quando = Quando.Potencia("quadro", 3000.0, 60, 3500.0))),
        )
        assertEquals(listOf("Indique há quanto tempo (até 24 h)."), erros(a(Acao.Notificar("x"), quando = Quando.Sensor("pir", 1, 0, 0))))
        assertEquals(
            listOf("O objetivo tem no máximo 200 caracteres.", "Categoria inválida."),
            erros(a(Acao.Notificar("x")).copy(descricao = "x".repeat(201), categoria = "diversao")),
        )
    }

    @Test
    fun `cenas - validacao sem SE nem cenas dentro de cenas`() {
        val c = Cena("sair", "Sair de casa", "porta", acoes = listOf(Acao.Ligar(false, "sala-4g", 1), Acao.Modo("fora")))
        assertEquals(emptyList<String>(), Cenas.validar(c, aparelhos))
        assertEquals(
            listOf("Ação 1: uma cena não pode executar outra cena.", "Ação 2: uma cena não pode ter SE/SENÃO."),
            Cenas.validar(c.copy(acoes = listOf(Acao.Cena("cinema"), Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("x"))))), aparelhos),
        )
        assertEquals(
            listOf("Dê um nome à cena.", "Escolha um ícone.", "Tem de ter entre 1 e 20 ações."),
            Cenas.validar(c.copy(nome = " ", icone = "gato", acoes = emptyList()), aparelhos),
        )
        assertEquals(
            listOf("Ação 1: Termoacumulador é uma carga perigosa; indique durante quanto tempo (máx. 4 h)."),
            Cenas.validar(c.copy(acoes = listOf(Acao.Ligar(true, "quadro", 2))), aparelhos),
        )
        assertEquals(listOf("No máximo 30 cenas."), Cenas.validarLista(List(31) { c.copy(id = "c$it") }))
        assertEquals(listOf("Identificador repetido: sair."), Cenas.validarLista(listOf(c, c)))
    }

    @Test
    fun `descrever v3`() {
        fun d(q: Quando?, se: Condicoes? = null, vararg acoes: Acao) =
            Automacoes.descrever(Automacao("x", "X", quando = q, se = se, entao = acoes.toList()), aparelhos, cenas)
        assertEquals("Quando Movimento corredor está sem movimento há 10 min", d(Quando.Sensor("pir", 1, 0, 600)))
        assertEquals("Quando Interruptor sala · Teto é ligado", d(Quando.Sensor("sala-4g", 1, 1)))
        assertEquals("30 min antes do pôr do sol", d(Quando.Sol("por", -30)))
        assertEquals("Ao nascer do sol", d(Quando.Sol("nascer")))
        assertEquals("1 h depois do nascer do sol", d(Quando.Sol("nascer", 60)))
        assertEquals("Quando o primeiro chega a casa", d(Quando.Presenca("chega_primeiro")))
        assertEquals("Quando o último sai de casa", d(Quando.Presenca("sai_ultimo")))
        assertEquals("Quando a casa passa a Noite", d(Quando.Modo("noite")))
        assertEquals("Quando carregar em Executar", d(Quando.Manual))
        assertEquals("Quando Quadro geral fica offline", d(Quando.Sistema("aparelho_offline", "quadro")))
        assertEquals("Quando a luz volta depois de um corte", d(Quando.Sistema("energia_reposta")))
        assertEquals(
            "Quando carregar em Executar, dias úteis, de noite, em modo Casa ou Noite, sem ninguém em casa, Porta de entrada fechada → " +
                "põe LED cozinha a 30 %; espera 5 min; executa a cena Noite de cinema; muda para Fora (mesmo com portas abertas); " +
                "alterna Interruptor sala · Candeeiro; se com alarme ativo então avisa: \"a\" senão avisa: \"b\"",
            d(
                Quando.Manual,
                Condicoes(dias = listOf(1, 2, 3, 4, 5), sol = "noite", modo = listOf("casa", "noite"), presenca = "ninguem", aparelhos = listOf(EstadoCanal("porta", 1, 0))),
                Acao.Luz("led", 1, 30), Acao.Esperar(300), Acao.Cena("cinema"), Acao.Modo("fora", true), Acao.Alternar("sala-4g", 2),
                Acao.Se(Condicoes(alarme = true), listOf(Acao.Notificar("a")), listOf(Acao.Notificar("b"))),
            ),
        )
    }

    @Test
    fun `rascunho - mover acoes e limite de 20 com SE`() {
        var r = Rascunho(acoes = listOf(RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "1"), RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "2")))
        r = r.moverAcao(1, -1)
        assertEquals(listOf("2", "1"), r.acoes.map { it.mensagem })
        assertEquals(r, r.moverAcao(0, -1))
        val se = RascunhoAcao(RascunhoAcao.SE, entao = List(3) { RascunhoAcao(RascunhoAcao.NOTIFICAR) })
        r = Rascunho(acoes = List(16) { RascunhoAcao() })
        assertEquals(20, r.maisAcao(se).totalAcoes)
        assertEquals(r.maisAcao(se), r.maisAcao(se).maisAcao()) // 21 não entra
        assertNull(RascunhoCondicoes().paraCondicoes())
        assertEquals(3, RascunhoCondicoes(alarme = true, dias = setOf(1), aparelhos = listOf(null to 1)).quantas)
    }
}
