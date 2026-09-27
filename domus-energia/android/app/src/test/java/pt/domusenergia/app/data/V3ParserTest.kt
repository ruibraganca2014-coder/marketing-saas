package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Leitura dos tópicos da v3 (docs/PROTOCOLO-MQTT-v3.md). */
class V3ParserTest {

    private val agora = Instant.parse("2026-09-27T09:15:00Z")

    private fun aplica(vararg msgs: Pair<String, String>, inicial: Estado = Estado()): Estado =
        msgs.fold(inicial) { e, (t, p) -> EstadoParser.reduzir(e, "joao", "domus/joao/$t", p, agora) }

    @Test
    fun `modo retido`() {
        val e = aplica("_modo" to """{"modo":"fora","desde":"2026-09-27T08:00:00Z","por":"automacao:sair"}""")
        assertEquals(Modo("fora", Instant.parse("2026-09-27T08:00:00Z"), "automacao:sair"), e.modo)
        // Modo desconhecido ou JSON inválido: fica como estava; mensagem apagada: sem modo.
        assertSame(e, aplica("_modo" to """{"modo":"praia"}""", inicial = e))
        assertSame(e, aplica("_modo" to "{", inicial = e))
        assertNull(aplica("_modo" to "", inicial = e).modo)
        // O nosso próprio pedido não é estado.
        assertSame(e, aplica("_modo/set" to """{"modo":"casa","forcar":false,"por":"app"}""", inicial = e))
    }

    @Test
    fun `alarme v3 com estado, contagem e ignorados`() {
        val e = aplica(
            "_alarme" to """{"ativo":true,"estado":"a_armar","tipo":"total","desde":"2026-09-27T09:14:00Z",
              "ate":"2026-09-27T09:15:30Z","ignorados":[{"aparelho":"janela-wc","canal":1},{"x":1}],"por":"app"}""",
        )
        val a = e.alarme!!
        assertEquals(Alarme.A_ARMAR, a.estadoEfetivo)
        assertEquals(Alarme.TOTAL, a.tipo)
        assertEquals(listOf(Ignorado("janela-wc", 1)), a.ignorados)
        assertEquals("app", a.por)
        assertEquals(30L, a.segundosAte(agora))
        assertEquals(0L, a.segundosAte(agora.plusSeconds(100)))
        // Entrada: contagem para desarmar
        val entrada = aplica("_alarme" to """{"ativo":true,"estado":"entrada","ate":"2026-09-27T09:15:20Z"}""").alarme!!
        assertEquals(20L, entrada.segundosAte(agora))
        // Armado/disparado: sem contagem, mesmo com "ate"
        assertNull(aplica("_alarme" to """{"ativo":true,"estado":"disparado","ate":"2026-09-27T09:15:20Z"}""").alarme!!.segundosAte(agora))
        // v2 sem estado: armado/desarmado a partir de "ativo"
        assertEquals(Alarme.ARMADO, Alarme(true).estadoEfetivo)
        assertEquals(Alarme.DESARMADO, Alarme(false).estadoEfetivo)
        // Estado desconhecido é ignorado (fica o da v2)
        assertNull(aplica("_alarme" to """{"ativo":false,"estado":"marciano"}""").alarme!!.estado)
    }

    @Test
    fun `config - valores, omissoes e nulos`() {
        val e = aplica(
            "_config" to """{"atraso_saida_s":45,"atraso_entrada_s":20,"silencio":["23:00","07:00"],"limiar_espera_w":3.5,
              "offline_min":60,"pausa_manual_min":90,"local":{"lat":41.15,"lon":-8.61},"relatorio_diario":"08:00"}""",
        )
        assertEquals(
            ConfigCasa(45, 20, "23:00" to "07:00", 3.5, 60, 90, Local(41.15, -8.61), "08:00"),
            e.config,
        )
        assertEquals(1, e.recebidasConfig)
        // Campos em falta → valores por omissão do contrato; null = desligado
        val p = aplica("_config" to """{"silencio":null,"relatorio_diario":null}""").config!!
        assertEquals(ConfigCasa.PADRAO, p)
        assertNull(p.silencio)
        assertNull(p.local)
        assertEquals(ConfigCasa.PADRAO, Estado().configEfetiva)
        assertSame(e, aplica("_config" to "[1]", inicial = e))
    }

    @Test
    fun `cenas`() {
        val e = aplica(
            "_cenas" to """[
              {"id":"cinema","nome":"Noite de cinema","icone":"filme","bloqueada":false,
               "acoes":[{"acao":"luz","aparelho":"led","canal":1,"brilho":20},{"acao":"estore","aparelho":"est","canal":1,"posicao":0},{"acao":"modo","modo":"noite","forcar":false}]},
              {"id":"empresa","nome":"Da empresa","icone":"estrela","bloqueada":true,"acoes":[{"acao":"voar"}]},
              {"id":"sem-icone","acoes":[]},
              {"nome":"sem id"}
            ]""",
        )
        val c = e.cenas!!
        assertEquals(listOf("cinema", "empresa", "sem-icone"), c.map { it.id })
        assertEquals(
            listOf(Acao.Luz("led", 1, 20), Acao.Estore("est", 1, 0), Acao.Modo("noite", false)),
            c[0].acoes,
        )
        assertTrue(c[0].editavel)
        assertFalse(c[1].editavel)
        assertEquals(1, c[1].acoesDesconhecidas)
        assertEquals("casa", c[2].icone)
        assertEquals("sem-icone", c[2].nome)
        assertEquals(1, e.recebidasCenas)
        assertEquals(emptyList<Cena>(), aplica("_cenas" to "").cenas)
    }

    @Test
    fun `saude, energia e presenca`() {
        val e = aplica(
            "_saude" to """{"quadro":{"online":true,"ultima_noticia":"2026-09-27T09:10:00Z","rssi":-61,"uptime_s":86400,
                 "reinicios_24h":0,"bateria":null,"bateria_dias":null,"offline_desde":null},
               "porta":{"online":false,"rssi":-84,"bateria":12,"bateria_dias":9,"offline_desde":"2026-09-27T08:02:00Z"}}""",
            "_energia" to """{"hoje_kwh":7.4,"ontem_kwh":9.1,"mes_kwh":180.2,"aparelhos":{"quadro":{"hoje_kwh":7.4,"ontem_kwh":9.1}}}""",
            "_presenca" to """{"pessoas":{"tel-1":{"nome":"Rui","em_casa":true,"desde":"2026-09-27T07:00:00Z"},"x":{"nome":"?"}},"alguem":true}""",
        )
        assertEquals(
            SaudeAparelho(true, Instant.parse("2026-09-27T09:10:00Z"), -61, 86400, 0, null, null, null),
            e.saude["quadro"],
        )
        assertEquals(SaudeAparelho(false, null, -84, null, null, 12, 9, Instant.parse("2026-09-27T08:02:00Z")), e.saude["porta"])
        assertEquals(Energia(7.4, 9.1, 180.2, mapOf("quadro" to (7.4 to 9.1))), e.energia)
        assertEquals(PresencaCasa(mapOf("tel-1" to Pessoa("Rui", true, Instant.parse("2026-09-27T07:00:00Z"))), true), e.presenca)
    }

    @Test
    fun `registo e avisos das automacoes`() {
        val e = aplica(
            "_automacoes/registo" to """{"luz-corredor":{"ultima":"2026-09-27T07:02:00Z","resultado":"condicao_falsa",
               "motivo":"Condição 'modo = noite' falsa (modo atual: casa)","semana":12,
               "ultimos":[{"ts":"2026-09-27T07:02:00Z","resultado":"condicao_falsa","motivo":"x"},{"ts":"2026-09-26T21:00:00Z","resultado":"executada"}]}}""",
            "_automacoes/avisos" to """[{"ids":["a","b"],"mensagem":"'a' liga e 'b' desliga Teto no mesmo gatilho"}]""",
        )
        val r = e.registo["luz-corredor"]!!
        assertEquals(Registo.CONDICAO_FALSA, r.resultado)
        assertEquals(12, r.semana)
        assertEquals("Condição 'modo = noite' falsa (modo atual: casa)", r.motivo)
        assertEquals(listOf(Registo.CONDICAO_FALSA, Registo.EXECUTADA), r.ultimos.map { it.resultado })
        assertEquals(listOf(AvisoConflito(listOf("a", "b"), "'a' liga e 'b' desliga Teto no mesmo gatilho")), e.avisos)
        assertEquals(emptyList<AvisoConflito>(), aplica("_automacoes/avisos" to "[]", inicial = e).avisos)
        // Pedidos (executar, set) não são estado
        assertSame(e, aplica("_automacoes/executar" to """{"id":"x","testar":true}""", inicial = e))
        assertEquals("Condição falsa", Registo.rotulo(Registo.CONDICAO_FALSA))
        assertEquals("Nunca executada", Registo.rotulo(null))
    }

    @Test
    fun `aparelhos v3 - divisao, entrada, simular, arranque, carga e em espera`() {
        val e = aplica(
            "_aparelhos" to """[
              {"id":"quadro","nome":"Quadro","tipo":"openbeken","medidor":true,"divisao":"Garagem",
               "canais":[{"n":1,"funcao":"interruptor","nome":"Termo","carga":"perigosa","arranque":"desligado"},
                         {"n":2,"funcao":"interruptor","nome":"TV","divisao":"Sala"}]},
              {"id":"porta","nome":"Porta","tipo":"openbeken","bateria":true,"canais":[{"n":1,"funcao":"porta","entrada":true}]},
              {"id":"led","nome":"LED","tipo":"shelly","canais":[{"n":1,"funcao":"luz","simular":true,"arranque":"ultimo","divisao":" "}]}
            ]""",
            "quadro/connected" to "online",
            "quadro/1/get" to "0",
            "quadro/2/get" to "1",
            "quadro/power/get" to "3.2",
        )
        val q = e.aparelhos[0]
        assertEquals("Garagem", q.divisao)
        assertTrue(q.canal(1)!!.perigosa)
        assertEquals("desligado", q.canal(1)!!.arranque)
        assertEquals("Sala", q.divisaoDe(q.canal(2)!!))
        assertEquals("Garagem", q.divisaoDe(q.canal(1)!!))
        assertTrue(e.aparelhos[1].canal(1)!!.entrada)
        assertTrue(e.aparelhos[2].canal(1)!!.simular)
        assertNull(e.aparelhos[2].canal(1)!!.divisao)
        assertEquals("Garagem", q.divisaoMostrada)
        // Em espera: TV ligada, quadro a 3,2 W < 5 W
        assertTrue(EmEspera.canal(q, q.canal(2)!!, 5.0))
        assertFalse(EmEspera.canal(q, q.canal(1)!!, 5.0)) // desligado
        assertFalse(EmEspera.canal(q, q.canal(2)!!, 3.0)) // limiar mais baixo
        val r = Resumo.de(e.aparelhos, null, Energia(7.4), Modo("noite"), 5.0)
        assertEquals(1, r.emEspera)
        assertEquals(7.4, r.hojeKWh!!, 1e-9)
        assertEquals("noite", r.modo)
    }

    @Test
    fun `textos novos`() {
        assertEquals("7,4 kWh", Textos.kwh(7.44))
        assertEquals("12 kWh", Textos.kwh(12.0))
        assertEquals("180 kWh", Textos.kwh(180.2))
        assertEquals("1:15", Textos.contagem(75))
        assertEquals("0:05", Textos.contagem(5))
        assertEquals("0:00", Textos.contagem(-3))
        assertEquals("27 set., 10:15", Textos.diaHora(agora))
        assertEquals("Férias", Modos.rotulo("ferias"))
    }

    @Test
    fun `payloads exatos do motor v3 - nulos, avaliacao com ok e eventos de modo`() {
        val e = aplica(
            "_modo" to """{"modo":"casa","desde":null,"por":null}""",
            "_alarme" to """{"ativo":false,"estado":"desarmado","tipo":null,"desde":"2026-09-27T09:00:00Z","ate":null,"ignorados":[],"por":"app"}""",
            "_config" to """{"atraso_saida_s":30,"atraso_entrada_s":30,"silencio":null,"limiar_espera_w":5,"offline_min":30,
                "pausa_manual_min":60,"local":{"lat":38.72,"lon":-9.14},"relatorio_diario":null}""",
            "_cenas" to """[{"id":"x","nome":"X","bloqueada":false,"acoes":[{"acao":"esperar","s":1}]}]""",
            "_saude" to """{"q":{"online":null,"ultima_noticia":null,"rssi":null,"uptime_s":null,"reinicios_24h":null,"bateria":null,"bateria_dias":null,"offline_desde":null}}""",
            "_automacoes/registo" to """{"a":{"ultima":"2026-09-27T09:10:00Z","resultado":"avaliacao","motivo":"Condição 'modo = noite' falsa (modo atual: casa)",
                "semana":3,"ok":false,"ultimos":[{"ts":"2026-09-27T09:10:00Z","resultado":"avaliacao","motivo":"","ok":false},
                {"ts":"2026-09-27T09:05:00Z","resultado":"teste","motivo":"","teste":true}]}}""",
            "_eventos" to """{"ts":"2026-09-27T09:00:00Z","tipo":"modo","titulo":"Modo Fora","mensagem":"A armar (30 s).","por":"app"}""",
        )
        assertEquals(Modo("casa", null, null), e.modo)
        assertEquals(Alarme(false, Instant.parse("2026-09-27T09:00:00Z"), "desarmado", null, null, emptyList(), "app"), e.alarme)
        assertEquals(ConfigCasa(local = Local(38.72, -9.14)), e.config)
        assertEquals("casa", e.cenas!![0].icone)
        assertEquals(SaudeAparelho(), e.saude["q"])
        val r = e.registo["a"]!!
        assertEquals(false, r.ok)
        assertEquals("Avaliação: condições falsas", Registo.rotulo(r.resultado, r.ok))
        assertEquals("Avaliação: condições verdadeiras", Registo.rotulo(Registo.AVALIACAO, true))
        assertEquals("Teste", Registo.rotulo(Registo.TESTE, null))
        assertEquals(listOf(Execucao(Instant.parse("2026-09-27T09:10:00Z"), "avaliacao", null, null, false),
            Execucao(Instant.parse("2026-09-27T09:05:00Z"), "teste", null, true, null)), r.ultimos)
        // Evento "modo" (novo): fica no histórico com o seu tipo e "por"; não é um erro
        val ev = e.historico.first()
        assertEquals(Evento.MODO, ev.tipo)
        assertEquals("app", ev.por)
        assertNull(e.ultimoErro)
    }

    @Test
    fun `texto da resposta a executar, testar e avaliar`() {
        val av = { ok: Boolean?, m: String? -> Registo(resultado = Registo.AVALIACAO, ok = ok, motivo = m) }
        assertEquals("Neste momento a automação executaria: as condições são verdadeiras.", Registo.textoPedido(Registo.PEDIDO_AVALIAR, av(true, "x")))
        assertEquals(
            "Neste momento não executaria: Condição 'sol = noite' falsa (é de dia)",
            Registo.textoPedido(Registo.PEDIDO_AVALIAR, av(false, "Condição 'sol = noite' falsa (é de dia)")),
        )
        assertEquals("Neste momento não executaria: uma condição é falsa.", Registo.textoPedido(Registo.PEDIDO_AVALIAR, av(false, null)))
        assertEquals("Teste feito: Teste", Registo.textoPedido(Registo.PEDIDO_TESTAR, Registo(resultado = Registo.TESTE)))
        assertEquals(
            "Executada: Falhou — Interruptor sala não respondeu em 5 s",
            Registo.textoPedido(Registo.PEDIDO_EXECUTAR, Registo(resultado = Registo.FALHOU, motivo = "Interruptor sala não respondeu em 5 s")),
        )
    }

    @Test
    fun `config - horas de silencio iguais sao recusadas como no motor`() {
        assertEquals(listOf("As horas de silêncio não podem ser iguais."), ConfigCasa.validar(ConfigCasa(silencio = "23:00" to "23:00")))
    }
}
