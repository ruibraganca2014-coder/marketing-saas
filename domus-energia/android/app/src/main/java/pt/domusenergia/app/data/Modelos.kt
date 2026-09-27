package pt.domusenergia.app.data

import java.text.Normalizer

/**
 * Um modelo pronto de automação (docs/AUTOMACOES-v3.md, secção 4), preenchido com os aparelhos do cliente.
 *
 * @property falta o que falta na casa para o modelo funcionar (ex.: "um sensor de movimento"); `null` = nada.
 */
data class Modelo(
    val id: String,
    val titulo: String,
    val resumo: String,
    val categoria: String,
    val rascunho: Rascunho,
    val falta: String? = null,
)

/** Modelos do guia (iluminação por movimento, chegada/saída, entrada inesperada, férias, consumo, bom dia, boa noite). */
object Modelos {

    private fun normal(t: String) = Normalizer.normalize(t, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()

    /** Canais com uma destas [funcoes]; os que têm no nome/divisão uma das [preferir] vêm primeiro. */
    private fun canais(aparelhos: List<Aparelho>, funcoes: Set<String>, vararg preferir: String): List<Alvo> {
        val todos = aparelhos.flatMap { a ->
            a.canais.filter { it.funcao in funcoes && !it.perigosa }.map { c -> Triple(a, c, Alvo(a.id, c.n)) }
        }
        fun pontos(a: Aparelho, c: Canal): Int {
            val texto = normal("${a.nome} ${c.nome} ${a.divisaoDe(c).orEmpty()}")
            val i = preferir.indexOfFirst { texto.contains(normal(it)) }
            return if (i < 0) preferir.size else i
        }
        return todos.sortedBy { (a, c, _) -> pontos(a, c) }.map { it.third }
    }

    private val LUZES = setOf(Funcao.LUZ, Funcao.INTERRUPTOR)

    /** Todos os modelos, preenchidos com os aparelhos (e cenas) do cliente. */
    fun todos(aparelhos: List<Aparelho>, cenas: List<Cena> = emptyList()): List<Modelo> {
        val movimento = canais(aparelhos, setOf(Funcao.MOVIMENTO), "corredor", "entrada", "hall")
        val portas = canais(aparelhos, setOf(Funcao.PORTA), "entrada", "principal", "porta")
        val portaEntrada = aparelhos.flatMap { a -> a.canais.filter { it.funcao == Funcao.PORTA && it.entrada }.map { Alvo(a.id, it.n) } }
        val luzesCorredor = canais(aparelhos, LUZES, "corredor", "hall", "entrada")
        val luzesEntrada = canais(aparelhos, LUZES, "entrada", "hall", "exterior", "varanda", "corredor")
        val luzesSala = canais(aparelhos, LUZES, "sala", "candeeiro", "estar")
        val luzesQuarto = canais(aparelhos, LUZES, "quarto")
        val estores = canais(aparelhos, setOf(Funcao.ESTORE), "quarto", "sala")
        val medidores = aparelhos.filter { it.medidor }.sortedBy { if (normal(it.nome).contains("quadro") || normal(it.nome).contains("geral")) 0 else 1 }
        val todasLuzes = canais(aparelhos, LUZES)

        fun luzAcao(alvo: Alvo?, brilho: Int, duracaoMin: String = ""): RascunhoAcao {
            val funcao = alvo?.let { a -> aparelhos.firstOrNull { it.id == a.aparelho }?.canal(a.canal)?.funcao }
            return if (funcao == Funcao.LUZ && duracaoMin.isEmpty()) RascunhoAcao(RascunhoAcao.LUZ, alvo, brilho = brilho)
            else RascunhoAcao(RascunhoAcao.LIGAR, alvo, duracaoMin = duracaoMin)
        }

        val lista = mutableListOf<Modelo>()

        // 1. Iluminação por movimento: liga ao passar (só à noite) e apaga 10 min depois do último movimento
        //    (o temporizador de `durante_s` recomeça a cada movimento).
        lista += Modelo(
            id = "luz-movimento",
            titulo = "Luz com movimento",
            resumo = "Acende a luz quando alguém passa, só à noite; apaga 10 min depois do último movimento.",
            categoria = Categorias.CONVENIENCIA,
            falta = when {
                movimento.isEmpty() -> "um sensor de movimento"
                todasLuzes.isEmpty() -> "uma luz ou circuito"
                else -> null
            },
            rascunho = Rascunho(
                nome = "Luz com movimento",
                descricao = "Acender a luz do corredor quando alguém passa, só à noite.",
                categoria = Categorias.CONVENIENCIA,
                tipoQuando = Rascunho.SENSOR,
                sensor = movimento.firstOrNull(),
                valor = 1,
                condSol = Condicoes.NOITE,
                acoes = listOf(RascunhoAcao(RascunhoAcao.LIGAR, luzesCorredor.firstOrNull(), duracaoMin = "10")),
            ),
        )

        // 2. Chegada a casa: modo Casa e, se for de noite, luz da entrada 10 min.
        lista += Modelo(
            id = "chegada",
            titulo = "Chegar a casa",
            resumo = "Quando o primeiro chega: modo Casa e, se for de noite, acende a luz da entrada.",
            categoria = Categorias.CONFORTO,
            falta = if (todasLuzes.isEmpty()) "uma luz ou circuito" else null,
            rascunho = Rascunho(
                nome = "Chegar a casa",
                descricao = "Desarmar e acender a entrada quando chego, se for de noite.",
                categoria = Categorias.CONFORTO,
                tipoQuando = Rascunho.PRESENCA,
                presencaEvento = Quando.CHEGA_PRIMEIRO,
                acoes = listOf(
                    RascunhoAcao(RascunhoAcao.MODO, modo = Modos.CASA),
                    RascunhoAcao(
                        RascunhoAcao.SE,
                        condicao = RascunhoCondicoes(sol = Condicoes.NOITE),
                        entao = listOf(RascunhoAcao(RascunhoAcao.LIGAR, luzesEntrada.firstOrNull(), duracaoMin = "10")),
                    ),
                ),
            ),
        )

        // 3. Saída: o último a sair → apaga as luzes, modo Fora e aviso.
        lista += Modelo(
            id = "saida",
            titulo = "Sair de casa",
            resumo = "Quando o último sai: apaga as luzes e passa a modo Fora.",
            categoria = Categorias.SEGURANCA,
            rascunho = Rascunho(
                nome = "Sair de casa",
                descricao = "Apagar tudo e armar quando o último sai.",
                categoria = Categorias.SEGURANCA,
                tipoQuando = Rascunho.PRESENCA,
                presencaEvento = Quando.SAI_ULTIMO,
                acoes = todasLuzes.take(4).map { RascunhoAcao(RascunhoAcao.DESLIGAR, it) } +
                    RascunhoAcao(RascunhoAcao.MODO, modo = Modos.FORA) +
                    RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "Saíram todos: a casa ficou em modo Fora."),
            ),
        )

        // 4. Entrada inesperada: porta abre em modo Fora/Noite → luzes + aviso (o alarme dispara por si).
        lista += Modelo(
            id = "entrada-inesperada",
            titulo = "Entrada inesperada",
            resumo = "Porta abre com a casa em Fora ou Noite: acende as luzes e avisa.",
            categoria = Categorias.SEGURANCA,
            falta = if (portas.isEmpty()) "um sensor de porta" else null,
            rascunho = Rascunho(
                nome = "Entrada inesperada",
                descricao = "Assustar quem entra sem ser esperado e avisar-me.",
                categoria = Categorias.SEGURANCA,
                tipoQuando = Rascunho.SENSOR,
                sensor = portaEntrada.firstOrNull() ?: portas.firstOrNull(),
                valor = 1,
                condModos = setOf(Modos.FORA, Modos.NOITE),
                ignorarPausa = true,
                acoes = (luzesEntrada.take(2).map { RascunhoAcao(RascunhoAcao.LIGAR, it, duracaoMin = "5") }.ifEmpty { listOf(RascunhoAcao(RascunhoAcao.LIGAR, null, duracaoMin = "5")) }) +
                    RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "Porta aberta com a casa em modo Fora/Noite."),
            ),
        )

        // 5. Ocupação simulada nas férias (além da simulação automática das luzes marcadas pela empresa).
        lista += Modelo(
            id = "ferias",
            titulo = "Parecer que há gente",
            resumo = "Em Férias, acende a sala ao pôr do sol e depois o quarto, como se houvesse gente.",
            categoria = Categorias.SEGURANCA,
            falta = if (todasLuzes.isEmpty()) "uma luz ou circuito" else null,
            rascunho = Rascunho(
                nome = "Parecer que há gente",
                descricao = "Simular presença ao fim do dia quando estamos de férias.",
                categoria = Categorias.SEGURANCA,
                tipoQuando = Rascunho.SOL,
                solEvento = Quando.SOL_POR,
                solDesvioMin = "15",
                condModos = setOf(Modos.FERIAS),
                acoes = listOf(
                    RascunhoAcao(RascunhoAcao.LIGAR, luzesSala.firstOrNull(), duracaoMin = "150"),
                    RascunhoAcao(RascunhoAcao.ESPERAR, esperaS = "3600"),
                    RascunhoAcao(RascunhoAcao.LIGAR, (luzesQuarto.firstOrNull { it != luzesSala.firstOrNull() } ?: luzesSala.firstOrNull()), duracaoMin = "60"),
                ),
            ),
        )

        // 6. Consumo alto: acima de 3500 W durante 1 min, rearma abaixo de 3200 W.
        lista += Modelo(
            id = "consumo-alto",
            titulo = "Consumo alto",
            resumo = "Avisa quando a casa passa 3500 W durante 1 min (só volta a avisar abaixo de 3200 W).",
            categoria = Categorias.ENERGIA,
            falta = if (medidores.isEmpty()) "um aparelho que meça o consumo" else null,
            rascunho = Rascunho(
                nome = "Consumo alto",
                descricao = "Saber quando estou perto de ir abaixo o disjuntor.",
                categoria = Categorias.ENERGIA,
                tipoQuando = Rascunho.POTENCIA,
                medidor = medidores.firstOrNull()?.id,
                acimaW = "3500",
                duranteS = "60",
                rearmarW = "3200",
                acoes = listOf(RascunhoAcao(RascunhoAcao.NOTIFICAR, mensagem = "Consumo acima de 3500 W: desligue um aparelho.")),
            ),
        )

        // 7. Bom dia: dias úteis às 07:30 → estores sobem, luz do quarto fraca e depois mais forte.
        val luzQuarto = luzesQuarto.firstOrNull()
        lista += Modelo(
            id = "bom-dia",
            titulo = "Bom dia",
            resumo = "Dias úteis às 07:30: sobe os estores e acende o quarto aos poucos.",
            categoria = Categorias.ROTINA,
            falta = if (estores.isEmpty() && todasLuzes.isEmpty()) "estores ou luzes" else null,
            rascunho = Rascunho(
                nome = "Bom dia",
                descricao = "Acordar com luz, sem sustos.",
                categoria = Categorias.ROTINA,
                tipoQuando = Rascunho.HORA,
                hora = "07:30",
                dias = setOf(1, 2, 3, 4, 5),
                condModos = setOf(Modos.CASA, Modos.NOITE),
                acoes = buildList {
                    estores.take(2).forEach { add(RascunhoAcao(RascunhoAcao.ESTORE, it, posicao = 100)) }
                    if (luzQuarto != null) {
                        add(luzAcao(luzQuarto, 30))
                        add(RascunhoAcao(RascunhoAcao.ESPERAR, esperaS = "300"))
                        add(luzAcao(luzQuarto, 80))
                    }
                    if (isEmpty()) add(RascunhoAcao(RascunhoAcao.ESTORE, null, posicao = 100))
                },
            ),
        )

        // 8. Boa noite: todos os dias às 23:30 → estores descem, apaga as luzes menos a do quarto, modo Noite.
        val quarto = luzQuarto
        lista += Modelo(
            id = "boa-noite",
            titulo = "Boa noite",
            resumo = "Às 23:30: desce os estores, apaga tudo menos o quarto e passa a modo Noite.",
            categoria = Categorias.ROTINA,
            rascunho = Rascunho(
                nome = "Boa noite",
                descricao = "Deitar sem ter de dar a volta à casa.",
                categoria = Categorias.ROTINA,
                tipoQuando = Rascunho.HORA,
                hora = "23:30",
                dias = (1..7).toSet(),
                condModos = setOf(Modos.CASA),
                acoes = estores.take(3).map { RascunhoAcao(RascunhoAcao.ESTORE, it, posicao = 0) } +
                    todasLuzes.filter { it != quarto }.take(5).map { RascunhoAcao(RascunhoAcao.DESLIGAR, it) } +
                    RascunhoAcao(RascunhoAcao.MODO, modo = Modos.NOITE),
            ),
        )

        // Se já houver uma cena "boa noite"/"sair", o modelo usa-a em vez da lista de ações.
        return lista.map { m ->
            val cena = cenas.firstOrNull { c ->
                val n = normal(c.nome)
                (m.id == "boa-noite" && n.contains("boa noite")) || (m.id == "saida" && (n.contains("sair") || n.contains("saida")))
            }
            if (cena == null) m else m.copy(
                rascunho = m.rascunho.copy(acoes = listOf(RascunhoAcao(RascunhoAcao.CENA, cena = cena.id)) +
                    m.rascunho.acoes.filter { it.tipo == RascunhoAcao.MODO || it.tipo == RascunhoAcao.NOTIFICAR }),
            )
        }
    }
}
