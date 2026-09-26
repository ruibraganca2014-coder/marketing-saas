package pt.domusenergia.app

import android.app.Application
import pt.domusenergia.app.notificacoes.Notificacoes

class DomusApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Os canais têm de existir antes de chegar a primeira notificação (também com a app fechada).
        Notificacoes.criarCanais(this)
    }
}
