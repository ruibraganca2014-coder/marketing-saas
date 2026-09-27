package pt.domusenergia.app.presenca

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import pt.domusenergia.app.data.Comandos
import pt.domusenergia.app.data.DomusMqtt
import pt.domusenergia.app.data.MqttException
import pt.domusenergia.app.data.Publicacao
import pt.domusenergia.app.data.Sessao
import java.util.concurrent.TimeUnit

/**
 * Verifica a presença (zona + Wi-Fi) e, se o valor estiver estável há 10 min e for novo, publica
 * `_presenca/set` por uma ligação MQTT curta ([DomusMqtt.enviarUmaVez], nunca retida).
 * Com [REMOVER] publica `{"pessoa","remover":true}` (deteção desligada com a app sem ligação).
 */
class PresencaWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val sessao = Sessao(ctx)
        val codigo = sessao.codigo ?: return Result.success()
        val password = sessao.password ?: return Result.success()
        val p = PresencaPrefs(ctx)

        inputData.getString(REMOVER)?.let { pessoa ->
            return enviar(Comandos.presencaRemover(codigo, pessoa), codigo, password, p) ?: Result.success()
        }
        if (!p.ativa) return Result.success()
        // Uma zona perdida (localização desligada, dados apagados) volta a ser registada.
        if (tags.contains(TAG_PERIODICA)) PresencaControlador.registarZona(ctx)

        val v = Verificar.passo(p.debounce, p.zona, p.wifi, WifiCasa.ssidAtual(ctx), System.currentTimeMillis())
        p.debounce = v.estado
        val valor = v.publicar
        if (valor == null) {
            // Ainda a contar os 10 min: volta a verificar no fim (substitui a verificação pendente).
            v.esperaMs?.let { agendar(ctx, it) }
            return Result.success()
        }
        enviar(Comandos.presenca(codigo, p.pessoa, p.nome, valor), codigo, password, p)?.let { return it }
        p.debounce = Debounce.publicado(p.debounce, valor)
        return Result.success()
    }

    /** Publica; `null` = enviado, senão o resultado a devolver (tentar mais tarde, ou desistir). */
    private suspend fun enviar(msg: Publicacao, codigo: String, password: String, p: PresencaPrefs): Result? =
        try {
            DomusMqtt.enviarUmaVez(codigo, password, listOf(msg))
            if (p.erro != null) p.erro = null
            null
        } catch (e: MqttException) {
            if (e.autenticacao) {
                p.erro = "A palavra-passe mudou: entre outra vez na app para a presença voltar a funcionar."
                Result.failure()
            } else {
                Result.retry()
            }
        }

    companion object {
        const val REMOVER = "remover"
        private const val NOME_ADIADA = "presenca-verificar"
        private const val NOME_PERIODICA = "presenca-periodica"
        private const val NOME_REMOVER = "presenca-remover"
        private const val TAG_ADIADA = "presenca-adiada"
        private const val TAG_PERIODICA = "presenca-periodica"

        private val comRede = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Verificar daqui a [atrasoMs] (fim dos 10 min). Substitui a verificação pendente. */
        fun agendar(ctx: Context, atrasoMs: Long) {
            val pedido = OneTimeWorkRequestBuilder<PresencaWorker>()
                .setInitialDelay(atrasoMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
                .setConstraints(comRede)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG_ADIADA)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOME_ADIADA, ExistingWorkPolicy.REPLACE, pedido)
        }

        fun verificarJa(ctx: Context) = agendar(ctx, 0)

        /** Verificação a cada 15 min (o mínimo do WorkManager): apanha mudanças de Wi-Fi e zonas perdidas. */
        fun agendarPeriodica(ctx: Context) {
            val pedido = PeriodicWorkRequestBuilder<PresencaWorker>(15, TimeUnit.MINUTES)
                .addTag(TAG_PERIODICA)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NOME_PERIODICA, ExistingPeriodicWorkPolicy.KEEP, pedido)
        }

        fun cancelarRemover(ctx: Context) = WorkManager.getInstance(ctx).cancelUniqueWork(NOME_REMOVER)

        fun cancelar(ctx: Context) {
            val wm = WorkManager.getInstance(ctx)
            wm.cancelUniqueWork(NOME_ADIADA)
            wm.cancelUniqueWork(NOME_PERIODICA)
        }

        /** Publica `{"pessoa","remover":true}` quando houver rede (tenta até conseguir). */
        fun remover(ctx: Context, pessoa: String) {
            val pedido = OneTimeWorkRequestBuilder<PresencaWorker>()
                .setConstraints(comRede)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .setInputData(workDataOf(REMOVER to pessoa))
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOME_REMOVER, ExistingWorkPolicy.REPLACE, pedido)
        }
    }
}
