package pt.domusenergia.app.data

/** Um canal escolhido num formulário (aparelho + n.º do canal). */
data class Alvo(val aparelho: String, val canal: Int)

/**
 * Condições no formulário (passo 4 do assistente, e a condição de um SE).
 * [dias] vazio = qualquer dia; [modos] vazio = qualquer modo.
 */
data class RascunhoCondicoes(
    val alarme: Boolean? = null,
    val entreAtivo: Boolean = false,
    val de: String = "",
    val ate: String = "",
    val dias: Set<Int> = emptySet(),
    val sol: String? = null,
    val modos: Set<String> = emptySet(),
    val presenca: String? = null,
    val aparelhos: List<Pair<Alvo?, Int>> = emptyList(),
) {
    fun paraCondicoes(): Condicoes? = Condicoes(
        alarme = alarme,
        entre = if (entreAtivo) Rascunho.normalizaHora(de) to Rascunho.normalizaHora(ate) else null,
        dias = dias.takeIf { it.isNotEmpty() }?.sorted(),
        sol = sol,
        // Ordem fixa (casa, fora, noite, férias) para o JSON não depender da ordem dos toques.
        modo = modos.takeIf { it.isNotEmpty() }?.let { m -> Modos.TODOS.filter { it in m } + m.filter { it !in Modos.TODOS } },
        presenca = presenca,
        aparelhos = aparelhos.takeIf { it.isNotEmpty() }?.map { (a, v) -> EstadoCanal(a?.aparelho.orEmpty(), a?.canal ?: 0, v) },
    ).takeUnless { it.vazia }

    val quantas: Int
        get() = listOf(alarme != null, entreAtivo, dias.isNotEmpty(), sol != null, modos.isNotEmpty(), presenca != null)
            .count { it } + aparelhos.size

    companion object {
        fun de(c: Condicoes?): RascunhoCondicoes {
            if (c == null) return RascunhoCondicoes()
            return RascunhoCondicoes(
                alarme = c.alarme,
                entreAtivo = c.entre != null,
                de = c.entre?.first.orEmpty(),
                ate = c.entre?.second.orEmpty(),
                dias = c.dias.orEmpty().toSet(),
                sol = c.sol,
                modos = c.modo.orEmpty().toSet(),
                presenca = c.presenca,
                aparelhos = c.aparelhos.orEmpty().map { Alvo(it.aparelho, it.canal) to it.valor },
            )
        }
    }
}

/** Uma ação no formulário de automação/cena, com os campos como texto (tal como o utilizador os escreve). */
data class RascunhoAcao(
    val tipo: String = LIGAR,
    val alvo: Alvo? = null,
    /** Minutos (aceita "1,5"); vazio = sem duração. Só para ligar/desligar. */
    val duracaoMin: String = "",
    val posicao: Int = 100,
    val mensagem: String = "",
    val brilho: Int = 100,
    val cena: String? = null,
    val modo: String = Modos.FORA,
    val forcar: Boolean = false,
    /** Segundos a esperar (1–3600). */
    val esperaS: String = "60",
    val condicao: RascunhoCondicoes = RascunhoCondicoes(),
    val entao: List<RascunhoAcao> = emptyList(),
    val senao: List<RascunhoAcao> = emptyList(),
) {
    fun paraAcao(): Acao = when (tipo) {
        ESTORE -> Acao.Estore(alvo?.aparelho.orEmpty(), alvo?.canal ?: 0, posicao)
        NOTIFICAR -> Acao.Notificar(mensagem.trim())
        LUZ -> Acao.Luz(alvo?.aparelho.orEmpty(), alvo?.canal ?: 0, brilho)
        ALTERNAR -> Acao.Alternar(alvo?.aparelho.orEmpty(), alvo?.canal ?: 0)
        CENA -> Acao.Cena(cena.orEmpty())
        MODO -> Acao.Modo(modo, forcar)
        ESPERAR -> Acao.Esperar(Rascunho.numero(esperaS)?.let { Math.round(it).toInt() } ?: -1)
        SE -> Acao.Se(condicao.paraCondicoes() ?: Condicoes(), entao.map { it.paraAcao() }, senao.map { it.paraAcao() })
        else -> Acao.Ligar(
            ligar = tipo != DESLIGAR,
            aparelho = alvo?.aparelho.orEmpty(),
            canal = alvo?.canal ?: 0,
            duranteS = if (duracaoMin.isBlank()) null else Rascunho.numero(duracaoMin)?.let { Math.round(it * 60).toInt() } ?: -1,
        )
    }

    companion object {
        const val LIGAR = "ligar"
        const val DESLIGAR = "desligar"
        const val ESTORE = "estore"
        const val NOTIFICAR = "notificar"
        const val LUZ = "luz"
        const val ALTERNAR = "alternar"
        const val CENA = "cena"
        const val MODO = "modo"
        const val ESPERAR = "esperar"
        const val SE = "se"
        val TIPOS = listOf(LIGAR, DESLIGAR, ESTORE, NOTIFICAR)

        /** Ações básicas (passo 3 do assistente). */
        val BASICAS = listOf(LIGAR, DESLIGAR, LUZ, ESTORE, NOTIFICAR)

        /** Todas as ações (passo 5); as cenas não podem ter [SE] nem [CENA]. */
        val TODAS = listOf(LIGAR, DESLIGAR, LUZ, ALTERNAR, ESTORE, NOTIFICAR, ESPERAR, CENA, MODO, SE)
        val DE_CENA = TODAS - SE - CENA

        fun rotulo(tipo: String): String = when (tipo) {
            LIGAR -> "Ligar"
            DESLIGAR -> "Desligar"
            ESTORE -> "Estore"
            NOTIFICAR -> "Avisar"
            LUZ -> "Luz"
            ALTERNAR -> "Alternar"
            CENA -> "Cena"
            MODO -> "Modo"
            ESPERAR -> "Esperar"
            SE -> "SE / SENÃO"
            else -> tipo
        }

        fun de(x: Acao): RascunhoAcao = when (x) {
            is Acao.Ligar -> RascunhoAcao(
                tipo = if (x.ligar) LIGAR else DESLIGAR,
                alvo = Alvo(x.aparelho, x.canal),
                duracaoMin = x.duranteS?.let { Rascunho.texto(it / 60.0) }.orEmpty(),
            )
            is Acao.Estore -> RascunhoAcao(tipo = ESTORE, alvo = Alvo(x.aparelho, x.canal), posicao = x.posicao)
            is Acao.Notificar -> RascunhoAcao(tipo = NOTIFICAR, mensagem = x.mensagem)
            is Acao.Luz -> RascunhoAcao(tipo = LUZ, alvo = Alvo(x.aparelho, x.canal), brilho = x.brilho)
            is Acao.Alternar -> RascunhoAcao(tipo = ALTERNAR, alvo = Alvo(x.aparelho, x.canal))
            is Acao.Cena -> RascunhoAcao(tipo = CENA, cena = x.cena)
            is Acao.Modo -> RascunhoAcao(tipo = MODO, modo = x.modo, forcar = x.forcar)
            is Acao.Esperar -> RascunhoAcao(tipo = ESPERAR, esperaS = x.s.toString())
            is Acao.Se -> RascunhoAcao(
                tipo = SE,
                condicao = RascunhoCondicoes.de(x.condicao),
                entao = x.entao.map { de(it) },
                senao = x.senao.map { de(it) },
            )
        }
    }
}

/**
 * Estado do formulário/assistente de criar/editar automação. Código puro: converte de/para [Automacao];
 * a validação é a de [Automacoes.validar].
 *
 * Os campos da v2 ([alarme], [entreAtivo], [de], [ate]) mantêm-se; as condições da v3 ficam em
 * [condDias], [condSol], [condModos], [condPresenca], [condAparelhos] (ver [condicoes]).
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
    // ---- v3
    val descricao: String = "",
    val categoria: String? = null,
    val ignorarPausa: Boolean = false,
    /** Sensor: "há quanto tempo" em minutos (vazio = assim que muda). */
    val sensorDuranteMin: String = "",
    /** Potência: rearmar abaixo de (W); vazio = por omissão (90 %). */
    val rearmarW: String = "",
    val solEvento: String = Quando.SOL_POR,
    val solDesvioMin: String = "0",
    val presencaEvento: String = Quando.CHEGA_PRIMEIRO,
    val modoGatilho: String = Modos.NOITE,
    val sistemaEvento: String = Quando.ENERGIA_REPOSTA,
    val sistemaAparelho: String? = null,
    val condDias: Set<Int> = emptySet(),
    val condSol: String? = null,
    val condModos: Set<String> = emptySet(),
    val condPresenca: String? = null,
    val condAparelhos: List<Pair<Alvo?, Int>> = emptyList(),
) {
    /** Todas as condições (v2 + v3) juntas. */
    val condicoes: RascunhoCondicoes
        get() = RascunhoCondicoes(alarme, entreAtivo, de, ate, condDias, condSol, condModos, condPresenca, condAparelhos)

    fun comCondicoes(c: RascunhoCondicoes): Rascunho = copy(
        alarme = c.alarme, entreAtivo = c.entreAtivo, de = c.de, ate = c.ate,
        condDias = c.dias, condSol = c.sol, condModos = c.modos, condPresenca = c.presenca, condAparelhos = c.aparelhos,
    )

    fun quando(): Quando = when (tipoQuando) {
        HORA -> Quando.Hora(normalizaHora(hora), dias.sorted())
        POTENCIA -> Quando.Potencia(
            medidor.orEmpty(), numero(acimaW) ?: 0.0, numero(duranteS)?.toInt() ?: -1,
            if (rearmarW.isBlank()) null else numero(rearmarW) ?: -1.0,
        )
        SOL -> Quando.Sol(solEvento, numero(solDesvioMin)?.let { Math.round(it).toInt() } ?: 999)
        PRESENCA -> Quando.Presenca(presencaEvento)
        MODO -> Quando.Modo(modoGatilho)
        MANUAL -> Quando.Manual
        SISTEMA -> Quando.Sistema(
            sistemaEvento,
            if (sistemaEvento == Quando.ENERGIA_REPOSTA) null else sistemaAparelho,
        )
        else -> Quando.Sensor(
            sensor?.aparelho.orEmpty(), sensor?.canal ?: 0, valor,
            if (sensorDuranteMin.isBlank()) null else numero(sensorDuranteMin)?.let { Math.round(it * 60).toInt() } ?: -1,
        )
    }

    /** Converte para [Automacao]. O id de uma nova automação vem do nome (único entre [existentes]). */
    fun paraAutomacao(existentes: List<Automacao>): Automacao {
        val id = idOriginal ?: Automacoes.slug(nome, existentes.map { it.id })
        return Automacao(
            id = id,
            nome = nome.trim(),
            ativa = ativa,
            bloqueada = false,
            quando = quando(),
            se = condicoes.paraCondicoes(),
            entao = acoes.map { it.paraAcao() },
            descricao = descricao.trim().ifEmpty { null },
            categoria = categoria,
            ignorarPausa = ignorarPausa,
        )
    }

    fun comAcao(i: Int, f: (RascunhoAcao) -> RascunhoAcao): Rascunho =
        copy(acoes = acoes.mapIndexed { j, a -> if (j == i) f(a) else a })

    fun semAcao(i: Int): Rascunho = copy(acoes = acoes.filterIndexed { j, _ -> j != i })

    /** Total de ações, contando as de dentro dos SE. */
    val totalAcoes: Int get() = contar(acoes)

    fun maisAcao(nova: RascunhoAcao = RascunhoAcao()): Rascunho =
        if (totalAcoes + contar(listOf(nova)) > Automacoes.MAX_ACOES) this else copy(acoes = acoes + nova)

    /** Passa a ação [i] uma posição para cima (-1) ou para baixo (+1). */
    fun moverAcao(i: Int, delta: Int): Rascunho {
        val j = i + delta
        if (i !in acoes.indices || j !in acoes.indices) return this
        return copy(acoes = acoes.toMutableList().also { val x = it[i]; it[i] = it[j]; it[j] = x })
    }

    companion object {
        const val SENSOR = "sensor"
        const val HORA = "hora"
        const val POTENCIA = "potencia"
        const val SOL = "sol"
        const val PRESENCA = "presenca"
        const val MODO = "modo"
        const val MANUAL = "manual"
        const val SISTEMA = "sistema"
        val GATILHOS = listOf(SENSOR, HORA, SOL, POTENCIA, PRESENCA, MODO, MANUAL, SISTEMA)

        fun rotuloGatilho(t: String): String = when (t) {
            SENSOR -> "Aparelho"
            HORA -> "Hora"
            SOL -> "Sol"
            POTENCIA -> "Consumo"
            PRESENCA -> "Chegar/sair"
            MODO -> "Modo"
            MANUAL -> "Botão"
            SISTEMA -> "Sistema"
            else -> t
        }

        fun contar(l: List<RascunhoAcao>): Int = l.sumOf { if (it.tipo == RascunhoAcao.SE) 1 + contar(it.entao) + contar(it.senao) else 1 }

        /** Formulário preenchido com uma automação existente (para editar). */
        fun de(a: Automacao): Rascunho {
            var r = Rascunho(
                idOriginal = a.id, nome = a.nome, ativa = a.ativa,
                descricao = a.descricao.orEmpty(), categoria = a.categoria, ignorarPausa = a.ignorarPausa,
            )
            when (val q = a.quando) {
                is Quando.Sensor -> r = r.copy(
                    tipoQuando = SENSOR, sensor = Alvo(q.aparelho, q.canal), valor = q.valor,
                    sensorDuranteMin = q.duranteS?.let { texto(it / 60.0) }.orEmpty(),
                )
                is Quando.Hora -> r = r.copy(tipoQuando = HORA, hora = q.hora, dias = q.dias.toSet())
                is Quando.Potencia -> r = r.copy(
                    tipoQuando = POTENCIA, medidor = q.aparelho,
                    acimaW = texto(q.acimaW), duranteS = q.duranteS.toString(),
                    rearmarW = q.rearmarW?.let { texto(it) }.orEmpty(),
                )
                is Quando.Sol -> r = r.copy(tipoQuando = SOL, solEvento = q.evento, solDesvioMin = q.desvioMin.toString())
                is Quando.Presenca -> r = r.copy(tipoQuando = PRESENCA, presencaEvento = q.evento)
                is Quando.Modo -> r = r.copy(tipoQuando = MODO, modoGatilho = q.modo)
                Quando.Manual -> r = r.copy(tipoQuando = MANUAL)
                is Quando.Sistema -> r = r.copy(tipoQuando = SISTEMA, sistemaEvento = q.evento, sistemaAparelho = q.aparelho)
                null -> {}
            }
            r = r.comCondicoes(RascunhoCondicoes.de(a.se))
            r = r.copy(acoes = a.entao.map { RascunhoAcao.de(it) }.ifEmpty { listOf(RascunhoAcao()) })
            return r
        }

        /** "3 500" → 3500.0; "1,5" → 1.5; inválido → null. */
        fun numero(t: String): Double? =
            t.replace(" ", "").replace(' ', ' ').replace(" ", "").replace(',', '.').toDoubleOrNull()
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
