package pt.domusenergia.app.tuya

import org.json.JSONObject

data class Device(
    val id: String,
    val name: String,
    val online: Boolean,
    val category: String,
    val status: Map<String, Any?>,
) {
    /** Código do interruptor principal ("switch", "switch_1", ...), se existir. */
    val switchCode: String? =
        status.keys.sorted().firstOrNull { it.startsWith("switch") && status[it] is Boolean }

    val isOn: Boolean get() = switchCode?.let { status[it] as? Boolean } ?: false

    // Disjuntores/tomadas com medição de energia (escalas padrão da Tuya).
    val powerW: Double? get() = (status["cur_power"] as? Number)?.toDouble()?.div(10)
    val voltageV: Double? get() = (status["cur_voltage"] as? Number)?.toDouble()?.div(10)
    val currentA: Double? get() = (status["cur_current"] as? Number)?.toDouble()?.div(1000)

    companion object {
        fun fromJson(json: JSONObject): Device {
            val statusArray = json.optJSONArray("status")
            val status = buildMap {
                if (statusArray != null) {
                    for (i in 0 until statusArray.length()) {
                        val item = statusArray.getJSONObject(i)
                        put(item.getString("code"), item.opt("value"))
                    }
                }
            }
            return Device(
                id = json.getString("id"),
                name = json.optString("name", "Sem nome"),
                online = json.optBoolean("online"),
                category = json.optString("category"),
                status = status,
            )
        }
    }
}
