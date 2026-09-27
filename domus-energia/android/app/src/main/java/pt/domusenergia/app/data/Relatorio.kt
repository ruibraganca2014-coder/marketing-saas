package pt.domusenergia.app.data

import java.time.Duration
import java.time.Instant

/** Uma linha do ecrã "Saúde dos aparelhos". [problemas] não vazio = precisa de atenção (aparece primeiro). */
data class LinhaSaude(
    val aparelho: Aparelho,
    /** `null` para aparelhos a pilhas (dormem: nunca "offline"). */
    val online: Boolean?,
    val offlineDesde: Instant?,
    val ultimaNoticia: Instant?,
    val rssi: Int?,
    val barras: Int,
    val reinicios24h: Int?,
    val uptimeS: Long?,
    val bateria: Int?,
    val bateriaDias: Int?,
    val problemas: List<String>,
) {
    val atencao: Boolean get() = problemas.isNotEmpty()
}

/** Saúde dos aparelhos (v3 §5), a partir de `_saude` e, na falta, do que a app sabe. Código puro. */
object SaudeCasa {
    const val SINAL_FRACO_DBM = -80
    const val BATERIA_FRACA = 15
    const val BATERIA_DIAS_POUCOS = 21
    const val REINICIOS_MUITOS = 5

    /** Barras do sinal Wi-Fi (0 = desconhecido, 1–4). */
    fun barras(rssi: Int?): Int = when {
        rssi == null -> 0
        rssi >= -60 -> 4
        rssi >= -70 -> 3
        rssi >= -80 -> 2
        else -> 1
    }

    fun sinalFraco(rssi: Int?): Boolean = rssi != null && rssi < SINAL_FRACO_DBM

    /** Percentagem de bateria: a do `_saude` ou a do canal `bateria`. */
    fun bateria(a: Aparelho, s: SaudeAparelho?): Int? =
        s?.bateria ?: a.canais.firstOrNull { it.funcao == Funcao.BATERIA }?.bateria

    fun bateriaFraca(pct: Int?, dias: Int?): Boolean =
        (pct != null && pct < BATERIA_FRACA) || (dias != null && dias < BATERIA_DIAS_POUCOS)

    /** "≈ 120 dias", "≈ 3 semanas"? — mantemos dias, é o que o cliente percebe melhor. */
    fun textoDias(dias: Int): String = if (dias == 1) "≈ 1 dia" else "≈ $dias dias"

    fun linha(a: Aparelho, s: SaudeAparelho?, agora: Instant): LinhaSaude {
        val online = if (a.bateria) null else (s?.online ?: a.online)
        val ultima = listOfNotNull(s?.ultimaNoticia, a.ultimaNoticia).maxOrNull()
        val pct = bateria(a, s)
        val dias = s?.bateriaDias
        val problemas = buildList {
            if (online == false) {
                add(s?.offlineDesde?.let { "Offline desde ${Textos.quando(it, agora)}" } ?: "Offline")
            }
            if (a.bateria && ultima != null && Duration.between(ultima, agora) > Aparelho.SEM_NOTICIAS) {
                add(Textos.semNoticias(ultima, agora))
            }
            if (pct != null && pct < BATERIA_FRACA) add("Bateria fraca ($pct %)")
            else if (dias != null && dias < BATERIA_DIAS_POUCOS) add("Pilha para ${textoDias(dias)}")
            if (sinalFraco(s?.rssi)) add("Sinal Wi-Fi fraco (${s?.rssi} dBm)")
            val r = s?.reinicios24h
            if (r != null && r > REINICIOS_MUITOS) add("$r reinícios em 24 h")
        }
        return LinhaSaude(
            aparelho = a,
            online = online,
            offlineDesde = s?.offlineDesde,
            ultimaNoticia = ultima,
            rssi = s?.rssi,
            barras = barras(s?.rssi),
            reinicios24h = s?.reinicios24h,
            uptimeS = s?.uptimeS,
            bateria = pct,
            bateriaDias = dias,
            problemas = problemas,
        )
    }

    /** Todas as linhas: primeiro as que precisam de atenção, depois pela ordem da lista. */
    fun linhas(aparelhos: List<Aparelho>, saude: Map<String, SaudeAparelho>, agora: Instant): List<LinhaSaude> =
        aparelhos.map { linha(it, saude[it.id], agora) }.sortedBy { if (it.atencao) 0 else 1 }
}

/** Uma linha do relatório ("Teto: ligado"). */
data class ItemRelatorio(val nome: String, val estado: String, val atencao: Boolean = false)

data class SeccaoRelatorio(val divisao: String, val itens: List<ItemRelatorio>)

/**
 * Relatório da casa (v3 §9), agrupado por divisão. Construído só com o que a app já recebe
 * (`_aparelhos`, estados, `_saude`, `_energia`, `_modo`/`_alarme`).
 */
data class Relatorio(
    val quando: Instant,
    val modo: String?,
    val alarme: String?,
    val potenciaW: Double?,
    val hojeKWh: Double?,
    val ontemKWh: Double?,
    val ligados: Int,
    val desligados: Int,
    val emEspera: Int,
    val abertas: Int,
    val offline: Int,
    val bateriaFraca: Int,
    val sinalFraco: Int,
    val seccoes: List<SeccaoRelatorio>,
) {
    companion object {
        const val SEM_DIVISAO = "Outros"

        fun textoAlarme(a: Alarme?): String? {
            a ?: return null
            val tipo = when (a.tipo) {
                Alarme.TOTAL -> " (total)"
                Alarme.PERIMETRO -> " (só portas)"
                else -> ""
            }
            return when (a.estadoEfetivo) {
                Alarme.DESARMADO -> "desarmado"
                Alarme.A_ARMAR -> "a armar$tipo"
                Alarme.ARMADO -> "armado$tipo"
                Alarme.ENTRADA -> "entrada detetada, à espera de desarmar"
                Alarme.DISPARADO -> "DISPARADO"
                else -> a.estadoEfetivo
            }
        }

        private fun estadoCanal(a: Aparelho, c: Canal, limiar: Double): Pair<String, Boolean>? = when (c.funcao) {
            Funcao.INTERRUPTOR, Funcao.LUZ -> when {
                EmEspera.canal(a, c, limiar) -> "em espera" to false
                c.ligado == true -> (if (c.funcao == Funcao.LUZ && c.brilho != null) "ligado (${c.brilho} %)" else "ligado") to false
                c.ligado == false -> "desligado" to false
                else -> "desconhecido" to false
            }
            Funcao.ESTORE -> when (c.posicao) {
                null -> "desconhecido" to false
                0 -> "fechado" to false
                100 -> "aberto" to false
                else -> "a ${c.posicao} %" to false
            }
            Funcao.PORTA -> when (c.aberto) {
                true -> "aberta" to true
                false -> "fechada" to false
                null -> "desconhecido" to false
            }
            Funcao.MOVIMENTO -> when (c.movimento) {
                true -> "com movimento" to false
                false -> "sem movimento" to false
                null -> "desconhecido" to false
            }
            Funcao.BATERIA -> null // a bateria aparece na linha do aparelho, se estiver fraca
            else -> null
        }

        fun construir(estado: Estado, agora: Instant): Relatorio {
            val aparelhos = estado.aparelhos
            val limiar = estado.configEfetiva.limiarEsperaW
            val grupos = LinkedHashMap<String, MutableList<ItemRelatorio>>()
            var ligados = 0
            var desligados = 0
            var espera = 0
            var abertas = 0
            var offline = 0
            var bateriaFraca = 0
            var sinalFraco = 0
            // Potência total: só os contadores gerais, se houver (como o `_energia` do motor).
            val potencia = Consumo.potenciaTotal(aparelhos)
            for (a in aparelhos) {
                val s = estado.saude[a.id]
                val sl = SaudeCasa.linha(a, s, agora)
                for (c in a.canais) {
                    val (texto, atencao) = estadoCanal(a, c, limiar) ?: continue
                    when (c.funcao) {
                        Funcao.INTERRUPTOR, Funcao.LUZ -> when {
                            EmEspera.canal(a, c, limiar) -> espera++
                            c.ligado == true -> ligados++
                            c.ligado == false -> desligados++
                        }
                        Funcao.PORTA -> if (c.aberto == true) abertas++
                    }
                    val nome = if (a.canais.size > 1 && c.temNome) "${a.nome} · ${c.nome}" else if (c.temNome) c.nome else a.nome
                    grupos.getOrPut(a.divisaoDe(c) ?: SEM_DIVISAO) { mutableListOf() } += ItemRelatorio(nome, texto, atencao)
                }
                val problemas = buildList {
                    if (sl.online == false) { offline++; add(sl.problemas.first()) }
                    if (SaudeCasa.bateriaFraca(sl.bateria, sl.bateriaDias)) {
                        bateriaFraca++
                        add("bateria fraca" + (sl.bateria?.let { " ($it %)" } ?: ""))
                    }
                    if (SaudeCasa.sinalFraco(sl.rssi)) { sinalFraco++; add("sinal fraco (${sl.rssi} dBm)") }
                }
                if (a.medidor && a.potenciaW != null) {
                    grupos.getOrPut(a.divisaoMostrada ?: SEM_DIVISAO) { mutableListOf() } +=
                        ItemRelatorio("${a.nome} · consumo", Textos.potencia(a.potenciaW))
                }
                if (problemas.isNotEmpty()) {
                    grupos.getOrPut(a.divisaoMostrada ?: SEM_DIVISAO) { mutableListOf() } +=
                        ItemRelatorio(a.nome, problemas.joinToString(", ") { it.replaceFirstChar { ch -> ch.lowercase() } }, true)
                }
            }
            // Divisões por ordem alfabética, "Outros" no fim.
            val seccoes = grupos.entries
                .sortedWith(compareBy({ it.key == SEM_DIVISAO }, { it.key.lowercase() }))
                .map { SeccaoRelatorio(it.key, it.value) }
            return Relatorio(
                quando = agora,
                modo = estado.modo?.modo,
                alarme = textoAlarme(estado.alarme),
                potenciaW = potencia,
                hojeKWh = estado.energia?.hojeKWh,
                ontemKWh = estado.energia?.ontemKWh,
                ligados = ligados,
                desligados = desligados,
                emEspera = espera,
                abertas = abertas,
                offline = offline,
                bateriaFraca = bateriaFraca,
                sinalFraco = sinalFraco,
                seccoes = seccoes,
            )
        }

        /** Texto simples (pt-PT) para Copiar/Partilhar. */
        fun texto(r: Relatorio): String = buildString {
            appendLine("Relatório da casa · ${Textos.diaHora(r.quando)}")
            val estado = listOfNotNull(
                r.modo?.let { "Modo ${Modos.rotulo(it)}" },
                r.alarme?.let { "alarme $it" },
            )
            if (estado.isNotEmpty()) appendLine(estado.joinToString(" · ").replaceFirstChar { it.uppercase() })
            val consumo = listOfNotNull(
                r.potenciaW?.let { "agora ${Textos.potencia(it)}" },
                r.hojeKWh?.let { "hoje ${Textos.kwh(it)}" },
                r.ontemKWh?.let { "ontem ${Textos.kwh(it)}" },
            )
            if (consumo.isNotEmpty()) appendLine("Consumo: " + consumo.joinToString(" · "))
            appendLine(resumo(r))
            for (s in r.seccoes) {
                appendLine()
                appendLine(s.divisao)
                for (i in s.itens) appendLine("- ${i.nome}: ${i.estado}" + if (i.atencao) " (!)" else "")
            }
        }.trimEnd()

        /** "3 ligados · 1 em espera · 1 aberta · 1 offline". */
        fun resumo(r: Relatorio): String = listOfNotNull(
            "${r.ligados} ${if (r.ligados == 1) "ligado" else "ligados"}",
            r.emEspera.takeIf { it > 0 }?.let { "$it em espera" },
            "${r.desligados} ${if (r.desligados == 1) "desligado" else "desligados"}",
            r.abertas.takeIf { it > 0 }?.let { "$it ${if (it == 1) "aberta" else "abertas"}" },
            r.offline.takeIf { it > 0 }?.let { "$it offline" },
            r.bateriaFraca.takeIf { it > 0 }?.let { "$it com bateria fraca" },
            r.sinalFraco.takeIf { it > 0 }?.let { "$it com sinal fraco" },
        ).joinToString(" · ")
    }
}

/** Uma cidade para a localização da casa (nascer/pôr do sol), sem pedir o GPS. */
data class Cidade(val nome: String, val lat: Double, val lon: Double) {
    val local: Local get() = Local(lat, lon)
}

/** Capitais de distrito e das regiões autónomas (coordenadas arredondadas a 2 casas: chega para o sol). */
object Cidades {
    val TODAS = listOf(
        Cidade("Angra do Heroísmo", 38.65, -27.22),
        Cidade("Aveiro", 40.64, -8.65),
        Cidade("Beja", 38.02, -7.86),
        Cidade("Braga", 41.55, -8.42),
        Cidade("Bragança", 41.81, -6.76),
        Cidade("Castelo Branco", 39.82, -7.49),
        Cidade("Coimbra", 40.21, -8.43),
        Cidade("Évora", 38.57, -7.91),
        Cidade("Faro", 37.02, -7.93),
        Cidade("Funchal", 32.65, -16.91),
        Cidade("Guarda", 40.54, -7.27),
        Cidade("Leiria", 39.74, -8.81),
        Cidade("Lisboa", 38.72, -9.14),
        Cidade("Ponta Delgada", 37.74, -25.67),
        Cidade("Portalegre", 39.29, -7.43),
        Cidade("Porto", 41.15, -8.61),
        Cidade("Santarém", 39.24, -8.69),
        Cidade("Setúbal", 38.52, -8.89),
        Cidade("Viana do Castelo", 41.69, -8.83),
        Cidade("Vila Real", 41.30, -7.74),
        Cidade("Viseu", 40.66, -7.91),
    )

    /** A cidade com estas coordenadas (ou a mais próxima a menos de ~15 km), para mostrar o nome. */
    fun perto(l: Local?): Cidade? {
        l ?: return null
        return TODAS.minByOrNull { (it.lat - l.lat) * (it.lat - l.lat) + (it.lon - l.lon) * (it.lon - l.lon) }
            ?.takeIf { Math.abs(it.lat - l.lat) < 0.15 && Math.abs(it.lon - l.lon) < 0.15 }
    }
}
