package pt.domusenergia.app.data

/** Um canal escolhido num formulário (aparelho + n.º do canal). */
data class Alvo(val aparelho: String, val canal: Int)

/** Uma ação no formulário de automação, com os campos como texto (tal como o utilizador os escreve). */
data class RascunhoAcao(
    val tipo: String = LIGAR,
    val alvo: Alvo? = null,
    /** Minutos (aceita "1,5"); vazio = sem duração. Só para ligar/desligar. */
    val duracaoMin: String = "",
    val posicao: Int = 100,
    val mensagem: String = "",
) {
    companion object {
        const val LIGAR = "ligar"
        const val DESLIGAR = "desligar"
        const val ESTORE = "estore"
        const val NOTIFICAR = "notificar"
        val TIPOS = listOf(LIGAR, DESLIGAR, ESTORE, NOTIFICAR)
    }
}

/**
 * Estado do formulário de criar/editar automação. Código puro: converte de/para [Automacao];
 * a validação é a de [Automacoes.validar].
 *
 * @property idOriginal id da automação em edição (`null` = nova).
 */
data class Rascunho(
    val idOriginal: String? = null,
    val nome: String = "",
    val ativa: Boolean = true,
    val tipoQuando: String = SENSOR,
    val sensor: Alvo? = null,
    val valor: Int = 1,
    val hora: String = "",
    val dias: Set<Int> = (1..7).toSet(),
    val medidor: String? = null,
    val acimaW: String = "",
    val duranteS: String = "60",
    val alarme: Boolean? = null,
    val entreAtivo: Boolean = false,
    val de: String = "",
    val ate: String = "",
    val acoes: List<RascunhoAcao> = listOf(RascunhoAcao()),
) {
    /** Converte para [Automacao]. O id de uma nova automação vem do nome (único entre [existentes]). */
    fun paraAutomacao(existentes: List<Automacao>): Automacao {
        val id = idOriginal ?: Automacoes.slug(nome, existentes.map { it.id })
        val quando: Quando = when (tipoQuando) {
            HORA -> Quando.Hora(normalizaHora(hora), dias.sorted())
            POTENCIA -> Quando.Potencia(medidor.orEmpty(), numero(acimaW) ?: 0.0, numero(duranteS)?.toInt() ?: -1)
            else -> Quando.Sensor(sensor?.aparelho.orEmpty(), sensor?.canal ?: 0, valor)
        }
        val se = Condicoes(
            alarme = alarme,
            entre = if (entreAtivo) normalizaHora(de) to normalizaHora(ate) else null,
        ).takeUnless { it.vazia }
        val entao = acoes.map { a ->
            when (a.tipo) {
                RascunhoAcao.ESTORE -> Acao.Estore(a.alvo?.aparelho.orEmpty(), a.alvo?.canal ?: 0, a.posicao)
                RascunhoAcao.NOTIFICAR -> Acao.Notificar(a.mensagem.trim())
                else -> Acao.Ligar(
                    ligar = a.tipo != RascunhoAcao.DESLIGAR,
                    aparelho = a.alvo?.aparelho.orEmpty(),
                    canal = a.alvo?.canal ?: 0,
                    duranteS = if (a.duracaoMin.isBlank()) null else numero(a.duracaoMin)?.let { Math.round(it * 60).toInt() } ?: -1,
                )
            }
        }
        return Automacao(id = id, nome = nome.trim(), ativa = ativa, bloqueada = false, quando = quando, se = se, entao = entao)
    }

    fun comAcao(i: Int, f: (RascunhoAcao) -> RascunhoAcao): Rascunho =
        copy(acoes = acoes.mapIndexed { j, a -> if (j == i) f(a) else a })

    fun semAcao(i: Int): Rascunho = copy(acoes = acoes.filterIndexed { j, _ -> j != i })

    fun maisAcao(): Rascunho =
        if (acoes.size >= Automacoes.MAX_ACOES) this else copy(acoes = acoes + RascunhoAcao())

    companion object {
        const val SENSOR = "sensor"
        const val HORA = "hora"
        const val POTENCIA = "potencia"

        /** Formulário preenchido com uma automação existente (para editar). */
        fun de(a: Automacao): Rascunho {
            var r = Rascunho(idOriginal = a.id, nome = a.nome, ativa = a.ativa)
            when (val q = a.quando) {
                is Quando.Sensor -> r = r.copy(tipoQuando = SENSOR, sensor = Alvo(q.aparelho, q.canal), valor = q.valor)
                is Quando.Hora -> r = r.copy(tipoQuando = HORA, hora = q.hora, dias = q.dias.toSet())
                is Quando.Potencia -> r = r.copy(
                    tipoQuando = POTENCIA, medidor = q.aparelho,
                    acimaW = texto(q.acimaW), duranteS = q.duranteS.toString(),
                )
                null -> {}
            }
            a.se?.let { s ->
                r = r.copy(alarme = s.alarme)
                s.entre?.let { (de, ate) -> r = r.copy(entreAtivo = true, de = de, ate = ate) }
            }
            r = r.copy(acoes = a.entao.map { x ->
                when (x) {
                    is Acao.Ligar -> RascunhoAcao(
                        tipo = if (x.ligar) RascunhoAcao.LIGAR else RascunhoAcao.DESLIGAR,
                        alvo = Alvo(x.aparelho, x.canal),
                        duracaoMin = x.duranteS?.let { texto(it / 60.0) }.orEmpty(),
                    )
                    is Acao.Estore -> RascunhoAcao(tipo = RascunhoAcao.ESTORE, alvo = Alvo(x.aparelho, x.canal), posicao = x.posicao)
                    is Acao.Notificar -> RascunhoAcao(tipo = RascunhoAcao.NOTIFICAR, mensagem = x.mensagem)
                }
            }.ifEmpty { listOf(RascunhoAcao()) })
            return r
        }

        /** "3 500" → 3500.0; "1,5" → 1.5; inválido → null. */
        fun numero(t: String): Double? =
            t.replace(" ", "").replace(' ', ' ').replace(" ", "").replace(',', '.').toDoubleOrNull()
                ?.takeUnless { it.isNaN() || it.isInfinite() }

        /** 1.5 → "1,5"; 2.0 → "2". */
        fun texto(d: Double): String =
            if (d == Math.floor(d)) d.toLong().toString() else d.toString().replace('.', ',')

        /** "7:05" → "07:05"; "7h" fica como está (a validação avisa). */
        fun normalizaHora(t: String): String {
            val s = t.trim().replace('h', ':').replace('.', ':')
            val m = Regex("^(\\d{1,2}):(\\d{2})$").find(s) ?: return t.trim()
            return m.groupValues[1].padStart(2, '0') + ":" + m.groupValues[2]
        }
    }
}
