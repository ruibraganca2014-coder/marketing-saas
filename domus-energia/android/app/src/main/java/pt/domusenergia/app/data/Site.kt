package pt.domusenergia.app.data

import pt.domusenergia.app.BuildConfig

/**
 * Páginas do site da Domus Energia, servidas pelo mesmo servidor da app (`MQTT_HOST`, como o `/api/`).
 * Abrem no navegador do sistema (Plataforma.abrirLink → Intent.ACTION_VIEW).
 */
object Site {
    /**
     * Simulador de orçamento. [cliente] = "Ampliar a instalação" (`?cliente=1`, como o link da área de cliente).
     * O site só associa o pedido à conta se encontrar o código de cliente no sessionStorage do separador;
     * a app não o passa (nunca pelo endereço), por isso o simulador abre com os passos todos e o cliente
     * identifica-se no contacto.
     */
    fun simulador(cliente: Boolean = false, host: String = BuildConfig.MQTT_HOST): String =
        "https://$host/simulador.html" + if (cliente) "?cliente=1" else ""
}
