package pt.domusenergia.app.data

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Correções da revisão cruzada (docs/PROTOCOLO-MQTT-v3.md, "Correções após a revisão cruzada"):
 * última notícia, contador geral, limites do motor, registo sem avaliações, canais 1–64,
 * palavra-passe cifrada.
 */
class RevisaoCruzadaTest {

    private val t0 = Instant.parse("2026-09-27T10:00:00Z")

    private fun aplica(e0: Estado = Estado(), vararg msgs: Pair<String, String>, agora: Instant = t0, retida: Boolean = true): Estado =
        msgs.fold(e0) { e, (t, p) -> EstadoParser.reduzir(e, "joao", "domus/joao/$t", p, agora, retida) }

    private fun Estado.aparelho(id: String) = aparelhos.first { it.id == id }

    private val listaPilhas = """[{"id":"porta","nome":"Porta","tipo":"openbeken","bateria":true,
        "canais":[{"n":1,"funcao":"porta","entrada":true},{"n":2,"funcao":"bateria"}]}]"""

    // ------------------------------------------------------------------ 1. última notícia

    /** Os avisos do motor sobre um aparelho (prova9: "Sem notícias" 24,5 h depois) não são sinal de vida. */
    @Test
    fun `avisos do motor no historico nao contam como noticia`() {
        val depois = Instant.parse("2026-09-28T10:31:00Z")
        val historico = """[
          {"ts":"2026-09-28T10:30:00Z","tipo":"aviso","titulo":"Sem notícias","mensagem":"Porta: sem notícias há 24 h.","aparelho":"porta"},
          {"ts":"2026-09-28T09:00:00Z","tipo":"aviso","titulo":"Sensor do alarme offline","mensagem":"Porta está offline","aparelho":"porta"},
          {"ts":"2026-09-28T08:00:00Z","tipo":"aviso","titulo":"Pilhas a acabar","mensagem":"Porta: …","aparelho":"porta"},
          {"ts":"2026-09-28T07:00:00Z","tipo":"automacao","titulo":"Luz","mensagem":"…","aparelho":"porta"},
          {"ts":"2026-09-27T10:00:00Z","tipo":"sensor","titulo":"Porta fechada","mensagem":"Porta","aparelho":"porta"}]"""
        val e = aplica(Estado(), "_aparelhos" to listaPilhas, "porta/1/get" to "0", "_historico" to historico)
        assertEquals(t0, e.aparelho("porta").ultimaNoticia)
        assertTrue("uma porta a pilhas morta tem de aparecer 'Sem notícias'", e.aparelho("porta").semNoticias(depois))
        assertEquals(mapOf("porta" to t0), EstadoParser.noticiasDoHistorico(e.historico))
        // Saúde: precisa de atenção
        val linha = SaudeCasa.linha(e.aparelho("porta"), e.saude["porta"], depois)
        assertTrue(linha.problemas.any { it.startsWith("Sem notícias há 24 h") })
    }

    @Test
    fun `alarme disparado por um sensor conta como noticia`() {
        val e = aplica(
            Estado(), "_aparelhos" to listaPilhas,
            "_historico" to """[{"ts":"2026-09-27T12:00:00Z","tipo":"alarme","titulo":"Alarme disparado","mensagem":"Porta","aparelho":"porta"}]""",
        )
        assertEquals(Instant.parse("2026-09-27T12:00:00Z"), e.aparelho("porta").ultimaNoticia)
    }

    @Test
    fun `_saude ultima_noticia e a fonte de verdade quando existe`() {
        val historico = """[{"ts":"2026-09-27T12:00:00Z","tipo":"sensor","titulo":"Porta aberta","mensagem":"Porta","aparelho":"porta"}]"""
        // Saúde mais antiga que o histórico (o histórico nunca devia ser mais novo; manda a saúde)
        val e = aplica(
            Estado(), "_aparelhos" to listaPilhas, "_historico" to historico,
            "_saude" to """{"porta":{"online":true,"ultima_noticia":"2026-09-27T11:00:00Z","bateria":80}}""",
        )
        assertEquals(Instant.parse("2026-09-27T11:00:00Z"), e.aparelho("porta").ultimaNoticia)
        // Sem ultima_noticia (null) na saúde: usa o histórico
        val semData = aplica(
            Estado(), "_aparelhos" to listaPilhas, "_historico" to historico,
            "_saude" to """{"porta":{"online":null,"ultima_noticia":null}}""",
        )
        assertEquals(Instant.parse("2026-09-27T12:00:00Z"), semData.aparelho("porta").ultimaNoticia)
        // Uma mensagem recebida em direto, mais recente, junta-se
        val vivo = Instant.parse("2026-09-27T13:00:00Z")
        val direto = aplica(e, "porta/1/get" to "1", agora = vivo, retida = false)
        assertEquals(vivo, direto.aparelho("porta").ultimaNoticia)
    }

    // ------------------------------------------------------------------ 2. contador geral

    private val listaGeral = """[
      {"id":"quadro","nome":"Quadro geral","tipo":"openbeken","medidor":true,"geral":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"tomada","nome":"Tomada TV","tipo":"openbeken","medidor":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"ac","nome":"Ar condicionado","tipo":"shelly","medidor":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"falso","nome":"Geral sem medidor","tipo":"openbeken","geral":true,"canais":[{"n":1,"funcao":"interruptor"}]}
    ]"""

    private fun estadoGeral(lista: String) = aplica(
        Estado(),
        "_aparelhos" to lista,
        "quadro/connected" to "online", "quadro/power/get" to "2500",
        "tomada/connected" to "online", "tomada/power/get" to "120",
        "ac/online" to "true", "ac/status/switch:0" to """{"output":true,"apower":900}""",
    )

    @Test
    fun `contador geral - potencia agora soma so os gerais`() {
        val e = estadoGeral(listaGeral)
        assertTrue(e.aparelho("quadro").geral)
        assertFalse(e.aparelho("tomada").geral)
        assertFalse("geral sem medidor não conta", e.aparelho("falso").geral)
        assertEquals(2500.0, Resumo.de(e.aparelhos, null).potenciaW, 0.001)
        assertEquals(2500.0, Relatorio.construir(e, t0).potenciaW!!, 0.001)
        assertEquals(listOf("quadro"), Consumo.medidoresDoTotal(e.aparelhos).map { it.id })
    }

    @Test
    fun `sem contador geral soma todos os medidores`() {
        val e = estadoGeral(listaGeral.replace(""","geral":true,"canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"tomada"""", ""","canais":[{"n":1,"funcao":"interruptor"}]},
      {"id":"tomada""""))
        assertFalse(e.aparelhos.any { it.geral })
        assertEquals(3520.0, Resumo.de(e.aparelhos, null).potenciaW, 0.001)
        assertEquals(3520.0, Relatorio.construir(e, t0).potenciaW!!, 0.001)
    }

    @Test
    fun `contador geral sem valor - potencia desconhecida no relatorio`() {
        val e = aplica(Estado(), "_aparelhos" to listaGeral, "tomada/power/get" to "120")
        assertNull(Relatorio.construir(e, t0).potenciaW)
        assertEquals(0.0, Resumo.de(e.aparelhos, null).potenciaW, 0.001)
        assertTrue(Resumo.de(e.aparelhos, null).temMedidor)
    }

    // ------------------------------------------------------------------ 3 e 6. limites do motor, canais 1–64

    private val aparelhos = aplica(
        Estado(),
        "_aparelhos" to """[
          {"id":"quadro","nome":"Quadro","tipo":"openbeken","medidor":true,
           "canais":[{"n":1,"funcao":"interruptor","nome":"Geral"},{"n":64,"funcao":"interruptor","nome":"Último"},{"n":65,"funcao":"interruptor"}]},
          {"id":"porta","nome":"Porta","tipo":"openbeken","bateria":true,"canais":[{"n":1,"funcao":"porta"}]}]""",
    ).aparelhos

    private fun a(vararg acoes: Acao, nome: String = "X", quando: Quando = Quando.Manual, se: Condicoes? = null) =
        Automacao("x", nome, quando = quando, se = se, entao = acoes.toList())

    private fun erros(x: Automacao, com: List<Aparelho> = aparelhos) = Automacoes.validar(x, com, emptyList(), null)

    private val ok = Acao.Notificar("ok")

    @Test
    fun `canais - o parser aceita 1 a 64`() {
        assertEquals(listOf(1, 64), aparelhos.first { it.id == "quadro" }.canais.map { it.n })
        assertEquals(emptyList<String>(), erros(a(Acao.Ligar(true, "quadro", 64))))
        // Sem a lista de aparelhos também se verifica o número do canal
        assertEquals(listOf("Ação 1: canal inválido (de 1 a 64)."), erros(a(Acao.Ligar(true, "quadro", 65)), emptyList()))
        assertEquals(listOf("Ação 1: canal inválido (de 1 a 64)."), erros(a(Acao.Estore("e", 0, 10)), emptyList()))
        assertEquals(listOf("Canal inválido (de 1 a 64)."), erros(a(ok, quando = Quando.Sensor("porta", 65, 1)), emptyList()))
        assertEquals(
            listOf("Escolha o aparelho da condição."),
            erros(a(ok, se = Condicoes(aparelhos = listOf(EstadoCanal("porta", 65, 1)))), emptyList()),
        )
    }

    @Test
    fun `entre com horas iguais e recusado`() {
        assertEquals(
            listOf("O horário tem de começar e acabar a horas diferentes."),
            erros(a(ok, se = Condicoes(entre = "08:00" to "08:00"))),
        )
        assertEquals(emptyList<String>(), erros(a(ok, se = Condicoes(entre = "19:00" to "07:00"))))
        // Também dentro de um SE
        assertEquals(
            listOf("Ação 1: O horário tem de começar e acabar a horas diferentes."),
            erros(a(Acao.Se(Condicoes(entre = "22:00" to "22:00"), listOf(ok)))),
        )
        // No assistente, "8:00" e "08:00" são a mesma hora
        val r = Rascunho(nome = "X", tipoQuando = Rascunho.MANUAL, entreAtivo = true, de = "8:00", ate = "08:00",
            acoes = listOf(RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "x")))
        assertTrue(erros(r.paraAutomacao(emptyList())).contains("O horário tem de começar e acabar a horas diferentes."))
    }

    @Test
    fun `duracoes ate 24 h`() {
        assertEquals(emptyList<String>(), erros(a(Acao.Ligar(true, "quadro", 1, 86_400))))
        assertEquals(listOf("Ação 1: a duração vai até 24 h (1440 min)."), erros(a(Acao.Ligar(true, "quadro", 1, 86_401))))
        assertEquals(listOf("Ação 1: a duração vai até 24 h (1440 min)."), erros(a(Acao.Ligar(false, "quadro", 1, 2880 * 60))))
        assertEquals(emptyList<String>(), erros(a(ok, quando = Quando.Potencia("quadro", 3500.0, 86_400))))
        assertEquals(
            listOf("O tempo acima do limite vai até 24 h (86 400 s)."),
            erros(a(ok, quando = Quando.Potencia("quadro", 3500.0, 100_000))),
        )
        assertEquals(listOf("A potência vai até 100 000 W."), erros(a(ok, quando = Quando.Potencia("quadro", 100_001.0, 60))))
        assertEquals(listOf("Indique há quanto tempo (até 24 h)."), erros(a(ok, quando = Quando.Sensor("porta", 1, 1, 86_401))))
    }

    @Test
    fun `nome ate 80 e mensagem ate 200`() {
        assertEquals(emptyList<String>(), erros(a(Acao.Notificar("m".repeat(200)), nome = "N".repeat(80))))
        assertEquals(listOf("O nome tem no máximo 80 caracteres."), erros(a(ok, nome = "N".repeat(81))))
        assertEquals(
            listOf("Ação 1: a mensagem tem no máximo 200 caracteres (tem 201)."),
            erros(a(Acao.Notificar("a".repeat(201)))),
        )
        // Também dentro de SE/SENÃO e nas cenas
        assertEquals(
            listOf("Ação 1.s1: a mensagem tem no máximo 200 caracteres (tem 250)."),
            erros(a(Acao.Se(Condicoes(alarme = true), listOf(ok), listOf(Acao.Notificar("a".repeat(250)))))),
        )
        assertEquals(listOf("O nome tem no máximo 80 caracteres."), Cenas.validar(Cena("c", "C".repeat(81), acoes = listOf(Acao.Modo("casa")))))
        assertEquals(emptyList<String>(), Cenas.validar(Cena("c", "C".repeat(80), acoes = listOf(Acao.Modo("casa")))))
        assertEquals(
            listOf("Ação 1: a mensagem tem no máximo 200 caracteres (tem 201)."),
            Cenas.validar(Cena("c", "C", acoes = listOf(Acao.Notificar("a".repeat(201))))),
        )
    }

    @Test
    fun `no maximo 10 condicoes de aparelhos`() {
        val dez = List(10) { EstadoCanal("porta", 1, 1) }
        assertEquals(emptyList<String>(), erros(a(ok, se = Condicoes(aparelhos = dez))))
        assertEquals(
            listOf("No máximo 10 condições de aparelhos."),
            erros(a(ok, se = Condicoes(aparelhos = dez + EstadoCanal("porta", 1, 0)))),
        )
    }

    /**
     * Grava os casos-limite em JSON (só com -Ddomus.casos=<ficheiro>) para os validar também com o motor
     * real (motor/src/validacao.js): o que a app aceita o motor aceita, e vice-versa.
     */
    @Test
    fun `casos limite para comparar com o motor`() {
        val destino = System.getProperty("domus.casos") ?: return
        val casos = listOf(
            "ok-limites" to a(Acao.Ligar(true, "quadro", 64, 86_400), Acao.Notificar("m".repeat(200)), nome = "N".repeat(80),
                quando = Quando.Potencia("quadro", 100_000.0, 86_400), se = Condicoes(entre = "19:00" to "07:00", aparelhos = List(10) { EstadoCanal("porta", 1, 1) })),
            "nome-81" to a(ok, nome = "N".repeat(81)),
            "msg-201" to a(Acao.Notificar("a".repeat(201))),
            "entre-iguais" to a(ok, se = Condicoes(entre = "08:00" to "08:00")),
            "durante-86401" to a(Acao.Ligar(true, "quadro", 1, 86_401)),
            "potencia-100000s" to a(ok, quando = Quando.Potencia("quadro", 3500.0, 100_000)),
            "sensor-86401" to a(ok, quando = Quando.Sensor("porta", 1, 1, 86_401)),
            "11-condicoes" to a(ok, se = Condicoes(aparelhos = List(11) { EstadoCanal("porta", 1, 1) })),
            "canal-65" to a(Acao.Ligar(true, "quadro", 65)),
        )
        val arr = JSONArray()
        for ((id, x) in casos) {
            val o = JSONArray(Automacoes.paraJson(listOf(x.copy(id = id)))).getJSONObject(0)
            o.put("_android_erros", JSONArray(Automacoes.validar(x, emptyList(), null, null)))
            arr.put(o)
        }
        File(destino).writeText(arr.toString(2))
    }

    // ------------------------------------------------------------------ 4. registo: avaliações não são execuções

    private val ts1 = Instant.parse("2026-09-27T09:00:00Z")
    private val ts2 = Instant.parse("2026-09-27T09:10:00Z")

    @Test
    fun `registo - forma antiga, avaliacao no topo nao aparece como ultima execucao`() {
        val r = V3.lerRegisto(
            """{"a":{"ultima":"2026-09-27T09:10:00Z","resultado":"avaliacao","motivo":"Condição 'modo = noite' falsa","ok":false,"semana":3,
               "ultimos":[{"ts":"2026-09-27T09:10:00Z","resultado":"avaliacao","motivo":"Condição 'modo = noite' falsa","ok":false},
                          {"ts":"2026-09-27T09:00:00Z","resultado":"executada","motivo":null}]}}""",
        )!!.getValue("a")
        assertEquals(Execucao(ts1, Registo.EXECUTADA, null, null, null), r.ultimaExecucao)
        assertEquals(Execucao(ts2, Registo.AVALIACAO, "Condição 'modo = noite' falsa", null, false), r.ultimaAvaliacao)
        assertEquals(listOf(Registo.EXECUTADA), r.execucoes.map { it.resultado })
        assertEquals("Neste momento não executaria: Condição 'modo = noite' falsa", Registo.textoPedido(Registo.PEDIDO_AVALIAR, r))
    }

    @Test
    fun `registo - forma nova, avaliacao so em ultimos`() {
        val r = V3.lerRegisto(
            """{"a":{"ultima":"2026-09-27T09:00:00Z","resultado":"falhou","motivo":"Teto não respondeu","semana":3,
               "ultimos":[{"ts":"2026-09-27T09:10:00Z","resultado":"avaliacao","motivo":"As condições são verdadeiras agora.","ok":true},
                          {"ts":"2026-09-27T09:00:00Z","resultado":"falhou","motivo":"Teto não respondeu"}]}}""",
        )!!.getValue("a")
        assertEquals(Execucao(ts1, Registo.FALHOU, "Teto não respondeu", null, null), r.ultimaExecucao)
        assertEquals(true, r.ultimaAvaliacao?.ok)
        assertEquals("Neste momento a automação executaria: as condições são verdadeiras.", Registo.textoPedido(Registo.PEDIDO_AVALIAR, r))
        assertEquals("Executada: Falhou — Teto não respondeu", Registo.textoPedido(Registo.PEDIDO_EXECUTAR, r))
    }

    @Test
    fun `registo - so avaliacoes = nunca executada`() {
        val r = Registo(ultima = ts2, resultado = Registo.AVALIACAO, ok = true,
            ultimos = listOf(Execucao(ts2, Registo.AVALIACAO, null, null, true)))
        assertNull(r.ultimaExecucao)
        assertEquals(emptyList<Execucao>(), r.execucoes)
        assertNull(Registo().ultimaExecucao)
    }

    @Test
    fun `registo - a resposta ao pedido e a entrada nova do tipo certo`() {
        val antes = Registo(ultima = ts1, resultado = Registo.EXECUTADA, ultimos = listOf(Execucao(ts1, Registo.EXECUTADA)))
        val avNova = Execucao(ts2, Registo.AVALIACAO, "x", null, false)
        // Motor novo: a avaliação só entra em "ultimos"
        val depoisNovo = antes.copy(ultimos = listOf(avNova) + antes.ultimos)
        assertTrue(Registo.respondeu(Registo.PEDIDO_AVALIAR, antes, depoisNovo))
        assertFalse("uma avaliação não responde a 'Executar'", Registo.respondeu(Registo.PEDIDO_EXECUTAR, antes, depoisNovo))
        // Motor antigo: também no topo
        val depoisAntigo = depoisNovo.copy(ultima = ts2, resultado = Registo.AVALIACAO, motivo = "x", ok = false)
        assertTrue(Registo.respondeu(Registo.PEDIDO_AVALIAR, antes, depoisAntigo))
        assertFalse(Registo.respondeu(Registo.PEDIDO_TESTAR, antes, depoisAntigo))
        // Uma execução nova responde a "Testar"/"Executar", não a "Avaliar"
        val teste = Execucao(ts2, Registo.TESTE, null, true, null)
        val depoisTeste = antes.copy(ultima = ts2, resultado = Registo.TESTE, ultimos = listOf(teste) + antes.ultimos)
        assertTrue(Registo.respondeu(Registo.PEDIDO_TESTAR, antes, depoisTeste))
        assertFalse(Registo.respondeu(Registo.PEDIDO_AVALIAR, antes, depoisTeste))
        // Primeira vez (sem registo antes)
        assertTrue(Registo.respondeu(Registo.PEDIDO_AVALIAR, null, Registo(ultimos = listOf(avNova))))
        assertFalse(Registo.respondeu(Registo.PEDIDO_AVALIAR, antes, antes))
    }

    // ------------------------------------------------------------------ Bom dia

    @Test
    fun `bom dia - sem acao de modo e so com a casa em casa ou noite`() {
        val e = aplica(
            Estado(),
            "_aparelhos" to """[{"id":"estore","nome":"Estore quarto","tipo":"shelly","divisao":"Quarto","canais":[{"n":1,"funcao":"estore"}]},
                {"id":"led","nome":"Luz quarto","tipo":"shelly","divisao":"Quarto","canais":[{"n":1,"funcao":"luz"}]}]""",
        )
        val m = Modelos.todos(e.aparelhos).first { it.id == "bom-dia" }
        val auto = m.rascunho.paraAutomacao(emptyList())
        assertEquals(listOf(Modos.CASA, Modos.NOITE), auto.se?.modo?.sorted())
        fun semModo(l: List<Acao>): Boolean = l.all { it !is Acao.Modo && (it !is Acao.Se || (semModo(it.entao) && semModo(it.senao))) }
        assertTrue(semModo(auto.entao))
        assertEquals(emptyList<String>(), Automacoes.validar(auto, e.aparelhos, emptyList(), ConfigCasa.PADRAO))
    }

    // ------------------------------------------------------------------ 5. palavra-passe cifrada

    private class Mapa(val m: MutableMap<String, String> = mutableMapOf()) : ArmazemTexto {
        var escritas = 0
        override fun ler(chave: String): String? = m[chave]
        override fun gravar(valores: Map<String, String?>): Boolean {
            escritas++
            for ((k, v) in valores) if (v == null) m.remove(k) else m[k] = v
            return true
        }
    }

    private fun chaveAes(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test
    fun `cofre - migra a palavra-passe em texto simples uma vez e apaga-a`() {
        val k = chaveAes()
        val prefs = Mapa(mutableMapOf("codigo" to "joao", CofreSenha.CHAVE_ANTIGA to "segredo-123"))
        val cofre = CofreSenha(prefs, { k })
        cofre.migrar()
        assertNull(prefs.m[CofreSenha.CHAVE_ANTIGA])
        val guardado = prefs.m.getValue(CofreSenha.CHAVE_CIFRADA)
        assertFalse(guardado.contains("segredo"))
        assertTrue(guardado.startsWith("v1:"))
        assertEquals("segredo-123", cofre.ler())
        assertEquals("joao", prefs.m["codigo"])
        // Segunda vez: nada a fazer
        val n = prefs.escritas
        cofre.migrar()
        assertEquals(n, prefs.escritas)
        assertEquals("segredo-123", CofreSenha(prefs, { k }).ler())
    }

    @Test
    fun `cofre - guardar, ler, limpar e IV diferente em cada cifra`() {
        val k = chaveAes()
        val prefs = Mapa()
        val cofre = CofreSenha(prefs, { k })
        assertNull(cofre.ler())
        assertTrue(cofre.guardar("pálavra ✓", mapOf("codigo" to "joao")))
        assertEquals("pálavra ✓", cofre.ler())
        assertEquals("joao", prefs.m["codigo"])
        val a1 = prefs.m.getValue(CofreSenha.CHAVE_CIFRADA)
        cofre.guardar("pálavra ✓")
        assertTrue("o IV tem de mudar", a1 != prefs.m.getValue(CofreSenha.CHAVE_CIFRADA))
        cofre.limpar(mapOf("codigo" to null))
        assertNull(cofre.ler())
        assertEquals(emptyMap<String, String>(), prefs.m)
    }

    @Test
    fun `cofre - valor alterado, outra chave ou outro sitio nao se decifram e sao esquecidos`() {
        val k = chaveAes()
        val prefs = Mapa()
        CofreSenha(prefs, { k }).guardar("segredo")
        val bom = prefs.m.getValue(CofreSenha.CHAVE_CIFRADA)
        // Outra chave (ex.: a do Keystore foi apagada e criada de novo)
        assertNull(CofreSenha(prefs, { chaveAes() }).ler())
        assertNull("esquecido", prefs.m[CofreSenha.CHAVE_CIFRADA])
        // Valor alterado
        val partes = bom.split(':')
        val cifrado = java.util.Base64.getDecoder().decode(partes[2]).also { it[0] = (it[0].toInt() xor 1).toByte() }
        prefs.m[CofreSenha.CHAVE_CIFRADA] = partes[0] + ":" + partes[1] + ":" + java.util.Base64.getEncoder().encodeToString(cifrado)
        assertNull(CofreSenha(prefs, { k }).ler())
        // Lixo
        prefs.m[CofreSenha.CHAVE_CIFRADA] = "abc"
        assertNull(CofreSenha(prefs, { k }).ler())
        assertNull(prefs.m[CofreSenha.CHAVE_CIFRADA])
        // Outro AAD (copiado para outra preferência/app)
        prefs.m[CofreSenha.CHAVE_CIFRADA] = bom
        assertNull(CofreSenha(prefs, { k }, "outro".toByteArray()).ler())
        prefs.m[CofreSenha.CHAVE_CIFRADA] = bom
        assertEquals("segredo", CofreSenha(prefs, { k }).ler())
    }

    @Test
    fun `cofre - sem Keystore nunca guarda em texto simples`() {
        val prefs = Mapa(mutableMapOf(CofreSenha.CHAVE_ANTIGA to "segredo"))
        val cofre = CofreSenha(prefs, { null })
        cofre.migrar()
        assertEquals("a palavra-passe em claro é apagada mesmo sem Keystore", emptyMap<String, String>(), prefs.m)
        assertFalse(cofre.guardar("segredo", mapOf("codigo" to "joao")))
        assertEquals(mapOf("codigo" to "joao"), prefs.m)
        assertNull(cofre.ler())
        // Keystore indisponível só agora: o valor cifrado fica (não se apaga por um erro passageiro)
        val k = chaveAes()
        CofreSenha(prefs, { k }).guardar("segredo")
        assertNull(CofreSenha(prefs, { null }).ler())
        assertNotNull(prefs.m[CofreSenha.CHAVE_CIFRADA])
        assertEquals("segredo", CofreSenha(prefs, { k }).ler())
    }
}
