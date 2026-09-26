package pt.domusenergia.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class EstadoParserTest {

    private val cliente = "joao"
    private val t0 = Instant.parse("2026-09-26T20:00:00Z")

    // ---- v1 ----
    private val listaV1 = """[
        {"id": "cozinha", "nome": "Cozinha", "tipo": "openbeken"},
        {"id": "ac-sala", "nome": "Ar condicionado sala", "tipo": "shelly"}
    ]"""

    // ---- v2 (exemplo do contrato + estore/luz OpenBeken e sensores Shelly) ----
    private val listaV2 = """[
      {"id": "quadro", "nome": "Quadro geral", "tipo": "openbeken", "medidor": true,
       "canais": [{"n": 1, "funcao": "interruptor", "nome": "Geral"}]},
      {"id": "sala-4g", "nome": "Interruptor sala", "tipo": "openbeken",
       "canais": [{"n": 1, "funcao": "interruptor", "nome": "Teto"},
                  {"n": 2, "funcao": "interruptor", "nome": "Candeeiro"},
                  {"n": 3, "funcao": "interruptor", "nome": "Varanda"},
                  {"n": 4, "funcao": "interruptor", "nome": "Corredor"}]},
      {"id": "porta-entrada", "nome": "Porta de entrada", "tipo": "openbeken", "bateria": true,
       "canais": [{"n": 1, "funcao": "porta"}, {"n": 2, "funcao": "bateria"}]},
      {"id": "pir-corredor", "nome": "Movimento corredor", "tipo": "openbeken", "bateria": true,
       "canais": [{"n": 1, "funcao": "movimento"}, {"n": 2, "funcao": "bateria"}]},
      {"id": "estore-quarto", "nome": "Estore quarto", "tipo": "shelly",
       "canais": [{"n": 1, "funcao": "estore"}]},
      {"id": "led-cozinha", "nome": "LED cozinha", "tipo": "shelly",
       "canais": [{"n": 1, "funcao": "luz"}]},
      {"id": "obk-luz", "nome": "Luz OBK", "tipo": "openbeken",
       "canais": [{"n": 1, "funcao": "luz"}, {"n": 2, "funcao": "estore", "nome": "Estore sala"}]},
      {"id": "sh-sensores", "nome": "Sensores Shelly", "tipo": "shelly", "bateria": true,
       "canais": [{"n": 1, "funcao": "porta", "nome": "Janela"}, {"n": 2, "funcao": "movimento", "nome": "Hall"},
                  {"n": 3, "funcao": "bateria"}]},
      {"id": "sh-2", "nome": "Shelly 2 canais", "tipo": "shelly", "medidor": true,
       "canais": [{"n": 1, "funcao": "interruptor"}, {"n": 2, "funcao": "interruptor", "nome": "B"}]}
    ]"""

    private fun aplica(
        vararg mensagens: Pair<String, String>,
        inicial: Estado = Estado(),
        agora: Instant = t0,
        retida: Boolean = false,
    ): Estado = mensagens.fold(inicial) { e, (t, p) -> EstadoParser.reduzir(e, cliente, "domus/$cliente/$t", p, agora, retida) }

    private fun Estado.aparelho(id: String) = aparelhos.first { it.id == id }
    private fun Estado.canal(id: String, n: Int) = aparelho(id).canal(n)!!

    // ================================================================= lista

    @Test
    fun `v1 - lista sem canais da um canal interruptor 1 e medidor`() {
        val e = aplica("_aparelhos" to listaV1)
        assertTrue(e.listaRecebida)
        assertEquals(listOf("cozinha", "ac-sala"), e.aparelhos.map { it.id })
        val c = e.aparelho("cozinha")
        assertEquals("Cozinha", c.nome)
        assertEquals("openbeken", c.tipo)
        assertTrue(c.medidor)
        assertFalse(c.bateria)
        assertEquals(listOf(Canal(1, Funcao.INTERRUPTOR, "Cozinha")), c.canais)
        assertEquals("shelly", e.aparelho("ac-sala").tipo)
        assertEquals("Ar condicionado sala", e.aparelho("ac-sala").canal(1)!!.nome)
    }

    @Test
    fun `v2 - canais, nomes, medidor e bateria`() {
        val e = aplica("_aparelhos" to listaV2)
        assertEquals(9, e.aparelhos.size)
        assertTrue(e.aparelho("quadro").medidor)
        assertFalse(e.aparelho("sala-4g").medidor) // v2 sem "medidor" → false
        assertEquals(listOf("Teto", "Candeeiro", "Varanda", "Corredor"), e.aparelho("sala-4g").canais.map { it.nome })
        val porta = e.aparelho("porta-entrada")
        assertTrue(porta.bateria)
        assertEquals(listOf(Funcao.PORTA, Funcao.BATERIA), porta.canais.map { it.funcao })
        // Canal sem nome usa o nome do aparelho
        assertEquals("Porta de entrada", porta.canal(1)!!.nome)
        assertFalse(porta.canal(1)!!.temNome)
        assertTrue(e.aparelho("obk-luz").canal(2)!!.temNome)
    }

    @Test
    fun `lista - entradas invalidas ignoradas, canais ordenados, tipo desconhecido vira openbeken`() {
        val e = aplica(
            "_aparelhos" to """[
              {"id":"a"}, {"nome":"sem id"}, 42, {"id":"a","nome":"repetido"}, {"id":"Maiusculas"},
              {"id":"b","tipo":"tuya","canais":[{"n":3,"funcao":"luz"},{"n":1,"funcao":"porta"},{"n":1,"funcao":"luz"},
                {"n":0,"funcao":"luz"},{"n":2,"funcao":"torradeira"},{"n":1.5,"funcao":"luz"},{"funcao":"luz"}]}
            ]""",
        )
        assertEquals(listOf("a", "b"), e.aparelhos.map { it.id })
        assertEquals(Aparelho("a", "a", "openbeken", medidor = true, canais = listOf(Canal(1, Funcao.INTERRUPTOR, "a"))), e.aparelho("a"))
        val b = e.aparelho("b")
        assertEquals("openbeken", b.tipo)
        assertEquals(listOf(1 to Funcao.PORTA, 3 to Funcao.LUZ), b.canais.map { it.n to it.funcao })
    }

    @Test
    fun `lista apagada fica vazia e lista invalida e ignorada`() {
        val e = aplica("_aparelhos" to listaV1)
        assertTrue(aplica("_aparelhos" to "", inicial = e).aparelhos.isEmpty())
        assertSame(e, aplica("_aparelhos" to "isto não é json", inicial = e))
        assertSame(e, aplica("_aparelhos" to """{"id":"x"}""", inicial = e))
    }

    @Test
    fun `sem lista nao ha aparelhos visiveis`() {
        val e = aplica("cozinha/connected" to "online")
        assertFalse(e.listaRecebida)
        assertTrue(e.aparelhos.isEmpty())
    }

    // ================================================================= OpenBeken

    @Test
    fun `v1 openbeken - todos os topicos`() {
        val e = aplica(
            "_aparelhos" to listaV1,
            "cozinha/connected" to "online",
            "cozinha/1/get" to "1",
            "cozinha/power/get" to "123.4",
            "cozinha/voltage/get" to "230.1",
            "cozinha/current/get" to "0.54",
            "cozinha/energycounter/get" to "1500",
        )
        val c = e.aparelho("cozinha")
        assertTrue(c.online)
        assertEquals(true, c.canal(1)!!.ligado)
        assertEquals(123.4, c.potenciaW!!, 1e-9)
        assertEquals(230.1, c.tensaoV!!, 1e-9)
        assertEquals(0.54, c.correnteA!!, 1e-9)
        assertEquals(1.5, c.energiaKWh!!, 1e-9)
        assertEquals(t0, c.ultimaNoticia)
        val d = aplica("cozinha/1/get" to "0", "cozinha/connected" to "offline", inicial = e)
        assertEquals(false, d.canal("cozinha", 1).ligado)
        assertFalse(d.aparelho("cozinha").online)
    }

    @Test
    fun `openbeken - varios interruptores`() {
        val e = aplica("_aparelhos" to listaV2, "sala-4g/connected" to "online", "sala-4g/2/get" to "1", "sala-4g/4/get" to "0")
        val a = e.aparelho("sala-4g")
        assertEquals(listOf(null, true, null, false), a.canais.map { it.ligado })
        // Sem medidor: potência ignorada
        assertNull(aplica("sala-4g/power/get" to "50", inicial = e).aparelho("sala-4g").potenciaW)
    }

    @Test
    fun `openbeken - porta, movimento e bateria`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "porta-entrada/1/get" to "1",
            "porta-entrada/2/get" to "87",
            "pir-corredor/1/get" to "0",
            "pir-corredor/2/get" to "12.6",
        )
        assertEquals(true, e.canal("porta-entrada", 1).aberto)
        assertEquals(87, e.canal("porta-entrada", 2).bateria)
        assertEquals(false, e.canal("pir-corredor", 1).movimento)
        assertEquals(13, e.canal("pir-corredor", 2).bateria)
        // Aparelhos a pilhas: disponíveis sem "connected" (dormem)
        assertTrue(e.aparelho("porta-entrada").disponivel)
        assertFalse(e.aparelho("porta-entrada").online)
    }

    @Test
    fun `openbeken - luz com led_dimmer e estore`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "obk-luz/1/get" to "1",
            "obk-luz/led_dimmer/get" to "40",
            "obk-luz/2/get" to "150",
        )
        val luz = e.canal("obk-luz", 1)
        assertEquals(true, luz.ligado)
        assertEquals(40, luz.brilho)
        assertEquals(100, e.canal("obk-luz", 2).posicao) // limitado a 0–100
        assertNull(e.canal("obk-luz", 2).brilho)
    }

    // ================================================================= Shelly

    @Test
    fun `v1 shelly - online e status json`() {
        val e = aplica(
            "_aparelhos" to listaV1,
            "ac-sala/online" to "true",
            "ac-sala/status/switch:0" to
                """{"id":0,"source":"init","output":true,"apower":12.3,"voltage":230.1,"current":0.05,"aenergy":{"total":1234.5,"by_minute":[0,0,0]},"temperature":{"tC":40.1}}""",
        )
        val a = e.aparelho("ac-sala")
        assertTrue(a.online)
        assertEquals(true, a.canal(1)!!.ligado)
        assertEquals(12.3, a.potenciaW!!, 1e-9)
        assertEquals(230.1, a.tensaoV!!, 1e-9)
        assertEquals(0.05, a.correnteA!!, 1e-9)
        assertEquals(1.2345, a.energiaKWh!!, 1e-9)
        assertFalse(aplica("ac-sala/online" to "false", inicial = e).aparelho("ac-sala").online)
    }

    @Test
    fun `shelly - status parcial junta ao que ja se sabia`() {
        val e = aplica(
            "_aparelhos" to listaV1,
            "ac-sala/status/switch:0" to """{"output":true,"apower":100,"voltage":230}""",
            "ac-sala/status/switch:0" to """{"output":false}""",
        )
        val a = e.aparelho("ac-sala")
        assertEquals(false, a.canal(1)!!.ligado)
        assertEquals(100.0, a.potenciaW!!, 1e-9)
        assertEquals(230.0, a.tensaoV!!, 1e-9)
        assertNull(a.correnteA)
    }

    @Test
    fun `shelly - dois interruptores e medidor do switch 0`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "sh-2/status/switch:0" to """{"output":false,"apower":0.0}""",
            "sh-2/status/switch:1" to """{"output":true,"apower":55}""",
        )
        assertEquals(listOf(false, true), e.aparelho("sh-2").canais.map { it.ligado })
        assertEquals(0.0, e.aparelho("sh-2").potenciaW!!, 1e-9) // medição só do switch:0 (contrato)
    }

    @Test
    fun `shelly - luz, estore, porta, movimento e bateria`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "led-cozinha/status/light:0" to """{"id":0,"output":true,"brightness":80}""",
            "estore-quarto/status/cover:0" to """{"id":0,"state":"opening","current_pos":35}""",
            "sh-sensores/status/input:0" to """{"id":0,"state":true}""",
            "sh-sensores/status/input:1" to """{"id":1,"state":false}""",
            "sh-sensores/status/devicepower:0" to """{"id":0,"battery":{"V":2.9,"percent":9},"external":{"present":false}}""",
        )
        assertEquals(true, e.canal("led-cozinha", 1).ligado)
        assertEquals(80, e.canal("led-cozinha", 1).brilho)
        assertEquals(35, e.canal("estore-quarto", 1).posicao)
        assertEquals("opening", e.canal("estore-quarto", 1).estadoEstore)
        assertEquals(true, e.canal("sh-sensores", 1).aberto)
        assertEquals(false, e.canal("sh-sensores", 2).movimento)
        assertEquals(9, e.canal("sh-sensores", 3).bateria)
    }

    // ================================================================= ordem, tempos, retidas

    @Test
    fun `mensagens que chegam antes da lista nao se perdem (tambem canais n maior que 1)`() {
        val e = aplica(
            "cozinha/1/get" to "1",
            "cozinha/power/get" to "50",
            "ac-sala/online" to "true",
            "sala-4g/3/get" to "1",
            "_aparelhos" to listaV1,
        )
        assertEquals(true, e.canal("cozinha", 1).ligado)
        assertEquals(50.0, e.aparelho("cozinha").potenciaW!!, 1e-9)
        assertTrue(e.aparelho("ac-sala").online)
        val d = aplica("_aparelhos" to listaV2, inicial = e)
        assertEquals(true, d.canal("sala-4g", 3).ligado)
    }

    @Test
    fun `nova lista mantem os valores e tira aparelhos removidos`() {
        val e = aplica("_aparelhos" to listaV1, "cozinha/power/get" to "10")
        val d = aplica("_aparelhos" to """[{"id":"cozinha","nome":"Cozinha nova","tipo":"openbeken"}]""", inicial = e)
        assertEquals(listOf("cozinha"), d.aparelhos.map { it.id })
        assertEquals("Cozinha nova", d.aparelho("cozinha").nome)
        assertEquals(10.0, d.aparelho("cozinha").potenciaW!!, 1e-9)
    }

    @Test
    fun `ultima noticia e ultima mudanca - retidas nao contam`() {
        val t1 = t0.plusSeconds(60)
        val t2 = t0.plusSeconds(120)
        val retidas = aplica("_aparelhos" to listaV2, "porta-entrada/1/get" to "0", retida = true)
        assertNull(retidas.aparelho("porta-entrada").ultimaNoticia)
        assertNull(retidas.canal("porta-entrada", 1).ultimaMudanca)

        val aberta = aplica("porta-entrada/1/get" to "1", inicial = retidas, agora = t1)
        assertEquals(t1, aberta.aparelho("porta-entrada").ultimaNoticia)
        assertEquals(t1, aberta.canal("porta-entrada", 1).ultimaMudanca)

        // Mesmo valor outra vez: notícia nova, mas não é mudança
        val igual = aplica("porta-entrada/1/get" to "1", inicial = aberta, agora = t2)
        assertEquals(t2, igual.aparelho("porta-entrada").ultimaNoticia)
        assertEquals(t1, igual.canal("porta-entrada", 1).ultimaMudanca)

        // Retida igual ao que já se sabia (religar) mantém os tempos
        val religou = aplica("porta-entrada/1/get" to "1", inicial = igual, agora = t2.plusSeconds(600), retida = true)
        assertEquals(t2, religou.aparelho("porta-entrada").ultimaNoticia)
        assertEquals(t1, religou.canal("porta-entrada", 1).ultimaMudanca)
    }

    @Test
    fun `shelly - energia a mudar nao conta como mudanca do canal`() {
        val t1 = t0.plusSeconds(60)
        val e = aplica("_aparelhos" to listaV1, "ac-sala/status/switch:0" to """{"output":true,"aenergy":{"total":1}}""")
        val d = aplica("ac-sala/status/switch:0" to """{"aenergy":{"total":2}}""", inicial = e, agora = t1)
        assertNull(d.canal("ac-sala", 1).ultimaMudanca)
        val f = aplica("ac-sala/status/switch:0" to """{"output":false}""", inicial = d, agora = t1)
        assertEquals(t1, f.canal("ac-sala", 1).ultimaMudanca)
    }

    @Test
    fun `sem noticias ha mais de 24 h so para aparelhos a pilhas`() {
        val e = aplica("_aparelhos" to listaV2, "porta-entrada/2/get" to "50", "quadro/connected" to "online")
        val depois = t0.plusSeconds(25 * 3600)
        assertTrue(e.aparelho("porta-entrada").semNoticias(depois))
        assertFalse(e.aparelho("porta-entrada").semNoticias(t0.plusSeconds(3600)))
        assertFalse(e.aparelho("quadro").semNoticias(depois))
    }

    @Test
    fun `historico da a ultima noticia de aparelhos com valores retidos`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "porta-entrada/1/get" to "0",
            "_historico" to """[{"ts":"2026-09-26T18:00:00Z","tipo":"sensor","titulo":"Porta","mensagem":"fechada","aparelho":"porta-entrada"},
                               {"ts":"2026-09-26T17:00:00Z","tipo":"sensor","titulo":"Porta","mensagem":"aberta","aparelho":"porta-entrada"}]""",
            retida = true,
        )
        assertEquals(Instant.parse("2026-09-26T18:00:00Z"), e.aparelho("porta-entrada").ultimaNoticia)
    }

    @Test
    fun `valores invalidos ficam desconhecidos`() {
        val e = aplica(
            "_aparelhos" to listaV1,
            "cozinha/power/get" to "abc",
            "cozinha/1/get" to "talvez",
            "ac-sala/status/switch:0" to "nao e json",
        )
        assertNull(e.aparelho("cozinha").potenciaW)
        assertNull(e.canal("cozinha", 1).ligado)
        assertNull(e.canal("ac-sala", 1).ligado)
    }

    @Test
    fun `ignora outros clientes, os nossos comandos e topicos desconhecidos`() {
        val e = aplica("_aparelhos" to listaV2)
        assertSame(e, EstadoParser.reduzir(e, cliente, "domus/maria/quadro/1/get", "1"))
        assertSame(e, EstadoParser.reduzir(e, cliente, "domus/joaozinho/quadro/1/get", "1"))
        for (t in listOf(
            "quadro/1/set", "obk-luz/led_dimmer/set", "sh-2/command/switch:0", "sh-2/command", "sh-2/rpc",
            "sh-2/events/rpc", "quadro", "_alarme/set", "_automacoes/set", "_fcm/registar", "_desconhecido",
            "sh-2/status/sys", "quadro/1/get/extra",
        )) {
            assertSame(t, e, aplica(t to """{"x":1}""", inicial = e))
        }
    }

    // ================================================================= alarme, automações, eventos, ntfy

    @Test
    fun `alarme retido`() {
        val e = aplica("_alarme" to """{"ativo": true, "desde": "2026-09-26T22:10:00Z"}""")
        assertEquals(Alarme(true, Instant.parse("2026-09-26T22:10:00Z")), e.alarme)
        assertEquals(Alarme(false, null), aplica("_alarme" to """{"ativo": false}""", inicial = e).alarme)
        assertEquals(Alarme(true, Instant.parse("2026-09-26T22:10:00Z")), aplica("_alarme" to """{"ativo":true,"desde":"2026-09-26T23:10:00+01:00"}""").alarme)
        assertSame(e, aplica("_alarme" to """{"ativo": "sim"}""", inicial = e))
        assertNull(aplica("_alarme" to "", inicial = e).alarme)
    }

    @Test
    fun `automacoes retidas contam as chegadas`() {
        val e = aplica("_automacoes" to "[]")
        assertEquals(emptyList<Automacao>(), e.automacoes)
        assertEquals(1, e.recebidasAutomacoes)
        val d = aplica("_automacoes" to """[{"id":"a","nome":"A","ativa":false,"quando":{"tipo":"hora","hora":"23:00","dias":[1]},"entao":[{"acao":"notificar","mensagem":"x"}]}]""", inicial = e)
        assertEquals(2, d.recebidasAutomacoes)
        assertEquals(listOf("a"), d.automacoes!!.map { it.id })
        assertSame(d, aplica("_automacoes" to "nao json", inicial = d))
    }

    @Test
    fun `eventos em direto entram no historico sem repetir e erro fica guardado`() {
        val hist = """[{"ts":"2026-09-26T18:00:00Z","tipo":"alarme","titulo":"Alarme","mensagem":"Porta aberta","aparelho":"porta-entrada"}]"""
        val e = aplica("_historico" to hist, retida = true)
        assertEquals(1, e.historico.size)
        val ev = """{"ts":"2026-09-26T19:00:00.123Z","tipo":"erro","titulo":"Automações não guardadas","mensagem":"id inválido"}"""
        val d = aplica("_eventos" to ev, inicial = e)
        assertEquals(listOf("erro", "alarme"), d.historico.map { it.tipo })
        assertEquals("id inválido", d.ultimoErro!!.mensagem)
        // O motor republica o histórico com o mesmo evento: sem repetidos
        val novoHist = "[" + ev + "," + hist.trim().removePrefix("[")
        val f = aplica("_historico" to novoHist, inicial = d, retida = true)
        assertEquals(2, f.historico.size)
        assertNotNull(f.ultimoErro)
        // Tipo desconhecido → aviso
        assertEquals("aviso", aplica("_eventos" to """{"ts":"x","tipo":"???","titulo":"t"}""").historico[0].tipo)
        assertSame(f, aplica("_eventos" to "lixo", inicial = f))
    }

    @Test
    fun `juntar eventos limita a 100 e ordena do mais recente`() {
        val muitos = (1..120).map { i ->
            Evento(Instant.ofEpochSecond(i.toLong()), "t$i", "sensor", "e$i", "")
        }
        val r = EstadoParser.juntarEventos(muitos.shuffled(), emptyList())
        assertEquals(100, r.size)
        assertEquals("e120", r.first().titulo)
        assertEquals("e21", r.last().titulo)
    }

    @Test
    fun `ntfy`() {
        assertEquals("https://h/ntfy/domus-joao-9f3k2", aplica("_ntfy" to """{"url":"https://h/ntfy/domus-joao-9f3k2"}""").ntfyUrl)
        assertNull(aplica("_ntfy" to """{"url":"javascript:alert(1)"}""").ntfyUrl)
        assertNull(aplica("_ntfy" to "").ntfyUrl)
    }

    // ================================================================= otimista

    @Test
    fun `atualizacoes otimistas`() {
        val e = aplica(
            "_aparelhos" to listaV2,
            "sala-4g/2/get" to "0",
            "sh-2/status/switch:1" to """{"output":false,"apower":0}""",
        )
        assertEquals(true, EstadoParser.comLigado(e, "sala-4g", 2, true).canal("sala-4g", 2).ligado)
        val s = EstadoParser.comLigado(e, "sh-2", 2, true)
        assertEquals(true, s.canal("sh-2", 2).ligado)
        assertEquals(true, EstadoParser.comLigado(e, "led-cozinha", 1, true).canal("led-cozinha", 1).ligado)
        val b = EstadoParser.comBrilho(e, "led-cozinha", 1, 30).canal("led-cozinha", 1)
        assertEquals(30, b.brilho)
        assertEquals(true, b.ligado)
        val ob = EstadoParser.comBrilho(e, "obk-luz", 1, 55).canal("obk-luz", 1)
        assertEquals(55, ob.brilho)
        assertEquals(true, ob.ligado)
        assertSame(e, EstadoParser.comLigado(e, "nao-existe", 1, true))
        assertSame(e, EstadoParser.comLigado(e, "sala-4g", 9, true))
        // Não inventa notícias
        assertNull(EstadoParser.comLigado(e, "sala-4g", 1, true).canal("sala-4g", 1).ultimaMudanca)
    }
}
