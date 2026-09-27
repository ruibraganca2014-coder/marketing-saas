package pt.domusenergia.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import pt.domusenergia.app.data.Contactos
import pt.domusenergia.app.data.Planos
import pt.domusenergia.app.data.Subscricao
import pt.domusenergia.app.data.TextosPlano
import pt.domusenergia.app.ui.tema.FormaCartao
import pt.domusenergia.app.ui.tema.FormaPilula
import pt.domusenergia.app.ui.tema.LocalTerra
import pt.domusenergia.app.ui.tema.LocalVoltar
import pt.domusenergia.app.ui.tema.Terra

/**
 * Abre o ecrã "A minha subscrição" (fornecido pelo [Principal]); usado pelos cadeados
 * ("Disponível no plano Conforto — mudar de plano") de qualquer ecrã.
 */
val LocalAbrirSubscricao = staticCompositionLocalOf<() -> Unit> { {} }

private fun corEstado(t: Terra, estado: String): Color = when (estado) {
    Planos.ATIVO, Planos.TESTE -> t.musgo
    Planos.EM_ATRASO -> t.argila
    else -> t.alarme
}

// ------------------------------------------------------------------ cadeados

/** Linha com cadeado: "Disponível no plano Conforto — mudar de plano" (toque = abrir a subscrição). */
@Composable
fun Bloqueado(chave: String, modifier: Modifier = Modifier) {
    val t = LocalTerra.current
    val abrir = LocalAbrirSubscricao.current
    Row(
        modifier.clip(FormaPilula).clickable(role = Role.Button, onClick = abrir).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, tint = t.argila, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(Planos.textoBloqueado(chave), style = MaterialTheme.typography.bodySmall, color = t.argila)
    }
}

/** Ecrã inteiro de uma funcionalidade fora do plano (ex.: Saúde dos aparelhos no plano Base). */
@Composable
fun EcraBloqueado(chave: String, titulo: String, descricao: String) {
    val t = LocalTerra.current
    val abrir = LocalAbrirSubscricao.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Cartao {
            Surface(shape = FormaPilula, color = t.areia.copy(alpha = 0.22f)) {
                Icon(Icons.Filled.Lock, contentDescription = null, tint = t.argila, modifier = Modifier.padding(10.dp).size(22.dp))
            }
            Text(titulo, style = MaterialTheme.typography.titleLarge)
            Text(descricao, style = MaterialTheme.typography.bodyMedium, color = t.textoSuave)
            val plano = Planos.planoMinimo(chave) ?: Planos.CONFORTO
            Text("Disponível no plano ${Planos.nome(plano)} (${Planos.preco(plano)}).", style = MaterialTheme.typography.bodyMedium)
            BotaoPilula("Mudar de plano", onClick = abrir)
        }
    }
}

// ------------------------------------------------------------------ aviso de atraso (todos os ecrãs)

/** Faixa "Pagamento em atraso" com a data-limite e "Atualizar pagamento" (§3). */
@Composable
fun AvisoAtraso(s: Subscricao, acoes: Acoes, onAbrir: () -> Unit) {
    val t = LocalTerra.current
    Surface(color = t.areia.copy(alpha = 0.22f), modifier = Modifier.fillMaxWidth().clickable(onClick = onAbrir)) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = t.argila, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                "Pagamento em atraso" + (s.avisoAte?.let { ". Atualize até ${TextosPlano.data(it)}." } ?: "."),
                style = MaterialTheme.typography.bodySmall,
                color = t.texto,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { if (s.manual) onAbrir() else acoes.gerirPagamentos() }) {
                Text("Atualizar pagamento", color = t.argila, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

// ------------------------------------------------------------------ "A minha subscrição"

/**
 * Plano, estado em palavras simples, próximo pagamento, "Mudar de plano" (→ Stripe Checkout) e
 * "Gerir pagamentos e faturas" (→ portal). Gerida à mão: "Fale connosco".
 *
 * @param escolherInicial abre logo a escolha de plano (só para os desenhos de teste).
 */
@Composable
fun SubscricaoScreen(state: UiState, acoes: Acoes, escolherInicial: Boolean = false) {
    var escolher by remember { mutableStateOf(escolherInicial) }
    if (escolher) {
        LocalVoltar.current(true) { escolher = false }
        EscolherPlano(state, acoes, onFechar = { escolher = false })
        return
    }
    val t = LocalTerra.current
    val s = state.estado.subscricao
    val ocupado = state.pagamento != null
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cartao {
            Text("Plano ${Planos.nome(s.plano)}", style = MaterialTheme.typography.headlineSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Planos.preco(s.plano), style = MaterialTheme.typography.bodyMedium, color = t.textoSuave, modifier = Modifier.weight(1f))
                Etiqueta(TextosPlano.rotuloEstado(s.estado), corEstado(t, s.estado))
            }
            Text(TextosPlano.explicacao(s), style = MaterialTheme.typography.bodyMedium, color = t.textoSuave)
            val proximo = TextosPlano.proximoPagamento(s)
            if (proximo != null || s.desde != null) HorizontalDivider(color = t.borda)
            proximo?.let { Linha(if (s.estado == Planos.TESTE) "Primeiro pagamento" else "Próximo pagamento", it) }
            s.desde?.let { Linha("Cliente desde", TextosPlano.data(it)) }
        }

        if (s.emAtraso) {
            Cartao(destaque = t.argila) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = t.argila, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Pagamento em atraso", style = MaterialTheme.typography.titleMedium, color = t.argila)
                }
                Text(TextosPlano.avisoAtraso(s), style = MaterialTheme.typography.bodyMedium)
                if (!s.manual) {
                    BotaoOcupado("Atualizar pagamento", state.pagamento == PedidoPagamento.PORTAL, !ocupado, t.argila) { acoes.gerirPagamentos() }
                }
            }
        }

        if (s.manual) {
            FaleConnosco(
                "A sua subscrição é gerida diretamente pela Domus Energia. Para mudar de plano ou de forma de pagamento, fale connosco.",
            )
        } else {
            Cartao {
                Titulo("Plano e pagamentos")
                BotaoOcupado("Mudar de plano", false, !ocupado) { escolher = true }
                OutlinedButton(onClick = acoes::gerirPagamentos, enabled = !ocupado, shape = FormaPilula) {
                    if (state.pagamento == PedidoPagamento.PORTAL && !s.emAtraso) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = t.musgo)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text("Gerir pagamentos e faturas")
                }
                Ajuda("Mudar o cartão, ver e descarregar faturas ou cancelar. Abre a página segura de pagamentos (Stripe).")
            }
        }
        ErroPagamento(state.erroPagamento)

        Cartao {
            Titulo("O seu plano inclui")
            Planos.inclui(s.plano).forEach { Inclui(it) }
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** Escolha do plano (3 cartões). "Escolher" → `POST /api/checkout` → página de pagamento no navegador. */
@Composable
fun EscolherPlano(state: UiState, acoes: Acoes, onFechar: () -> Unit) {
    val t = LocalTerra.current
    val s = state.estado.subscricao
    val ocupado = state.pagamento != null
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Mudar de plano", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = onFechar) { Text("Voltar", color = t.musgo) }
        }
        Text(
            "Sem fidelização. O pagamento é mensal e feito numa página segura (Stripe).",
            style = MaterialTheme.typography.bodyMedium,
            color = t.textoSuave,
        )
        for (p in Planos.TODOS) {
            val atual = p == s.plano && !s.bloqueada
            Cartao(destaque = if (atual) t.musgo else null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(Planos.nome(p), style = MaterialTheme.typography.titleLarge)
                        Text(Planos.preco(p), style = MaterialTheme.typography.bodyLarge, color = t.textoSuave)
                    }
                    if (atual) Etiqueta("Plano atual", t.musgo)
                }
                Planos.inclui(p).forEach { Inclui(it) }
                if (!atual) {
                    BotaoOcupado("Escolher ${Planos.nome(p)}", state.pagamento == PedidoPagamento.checkout(p), !ocupado) { acoes.mudarPlano(p) }
                }
            }
        }
        ErroPagamento(state.erroPagamento)
        Ajuda("Com IVA incluído. Pode mudar ou cancelar quando quiser em \"Gerir pagamentos e faturas\".")
        Spacer(Modifier.height(16.dp))
    }
}

// ------------------------------------------------------------------ suspensa / cancelada

/** Ecrã único enquanto a subscrição está suspensa ou cancelada (modo básico, §3). */
@Composable
fun SuspensaScreen(state: UiState, acoes: Acoes) {
    val t = LocalTerra.current
    val s = state.estado.subscricao
    val ocupado = state.pagamento != null
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Surface(shape = FormaPilula, color = t.alarme.copy(alpha = 0.14f)) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = t.alarme, modifier = Modifier.padding(14.dp).size(28.dp))
        }
        Text(
            if (s.estado == Planos.CANCELADO) "A sua subscrição foi cancelada" else "A sua subscrição está suspensa",
            style = MaterialTheme.typography.headlineMedium,
        )
        Text(TextosPlano.explicacao(s), style = MaterialTheme.typography.bodyLarge, color = t.textoSuave)
        Text(
            "Reative a subscrição para voltar a controlar a casa pela app. As suas automações, cenas e definições estão guardadas.",
            style = MaterialTheme.typography.bodyMedium,
        )
        BotaoOcupado(
            "Reativar subscrição",
            state.pagamento == PedidoPagamento.checkout(s.plano),
            !ocupado,
            modifier = Modifier.fillMaxWidth(),
        ) { acoes.mudarPlano(s.plano) }
        Text("Plano ${Planos.nome(s.plano)} · ${Planos.preco(s.plano)}", style = MaterialTheme.typography.bodySmall,
            color = t.textoSuave, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        if (!s.manual) {
            TextButton(onClick = acoes::gerirPagamentos, enabled = !ocupado, modifier = Modifier.fillMaxWidth()) {
                Text("Gerir pagamentos e faturas", color = t.musgo)
            }
        }
        ErroPagamento(state.erroPagamento)
        FaleConnosco("Precisa de ajuda? Fale connosco.")
        TextButton(onClick = acoes::logout, modifier = Modifier.fillMaxWidth()) { Text("Sair", color = t.textoSuave) }
    }
}

// ------------------------------------------------------------------ peças

/** "Fale connosco": WhatsApp e telefone (de `BuildConfig`; sem eles, só o texto). */
@Composable
fun FaleConnosco(texto: String) {
    val t = LocalTerra.current
    val abrir = LocalPlataforma.current.abrirLink
    val whats = Contactos.whatsapp
    val tel = Contactos.telefone
    Cartao {
        Titulo("Fale connosco")
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = t.textoSuave)
        tel?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
        if (whats != null || tel != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (whats != null) BotaoPilula("WhatsApp", onClick = { abrir(Contactos.whatsappUrl(whats)) })
                if (tel != null) OutlinedButton(onClick = { abrir(Contactos.telefoneUrl(tel)) }, shape = FormaPilula) { Text("Ligar") }
            }
        } else {
            Text("Contacte a Domus Energia pelos contactos que recebeu na instalação.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun BotaoOcupado(
    texto: String,
    aCorrer: Boolean,
    enabled: Boolean,
    cor: Color? = null,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val t = LocalTerra.current
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        shape = FormaPilula,
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = cor ?: t.musgo, contentColor = t.creme),
        modifier = modifier,
    ) {
        if (aCorrer) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = t.creme)
            Spacer(Modifier.width(8.dp))
            Text("A abrir…")
        } else {
            Text(texto)
        }
    }
}

@Composable
private fun ErroPagamento(erro: String?) {
    if (erro == null) return
    val t = LocalTerra.current
    Surface(shape = FormaCartao, color = t.alarme.copy(alpha = 0.10f), modifier = Modifier.fillMaxWidth()) {
        Text(erro, color = t.alarme, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
    }
}

@Composable
private fun Linha(rotulo: String, valor: String) {
    val t = LocalTerra.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(rotulo, style = MaterialTheme.typography.bodyMedium, color = t.textoSuave, modifier = Modifier.weight(1f))
        Text(valor, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun Inclui(texto: String) {
    val t = LocalTerra.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = t.musgo, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(8.dp))
        Text(texto, style = MaterialTheme.typography.bodyMedium)
    }
}
