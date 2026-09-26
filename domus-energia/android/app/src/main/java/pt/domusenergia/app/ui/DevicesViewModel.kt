package pt.domusenergia.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import pt.domusenergia.app.data.ApiException
import pt.domusenergia.app.data.DomusApi
import pt.domusenergia.app.tuya.Device

data class UiState(
    val loggedIn: Boolean,
    val email: String = "",
    val devices: List<Device> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

class DevicesViewModel(app: Application) : AndroidViewModel(app) {

    private val api = DomusApi(app)

    private val _state = MutableStateFlow(UiState(loggedIn = api.isLoggedIn, email = api.email))
    val state: StateFlow<UiState> = _state

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                api.login(email, password)
                _state.update { it.copy(loggedIn = true, email = api.email, loading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "Email ou palavra-passe errados.") }
            }
        }
    }

    fun logout() {
        api.logout()
        _state.value = UiState(loggedIn = false)
    }

    fun refresh(silent: Boolean = false) {
        if (!_state.value.loggedIn) return
        viewModelScope.launch {
            if (!silent) _state.update { it.copy(loading = true) }
            try {
                val devices = api.listDevices()
                _state.update { it.copy(devices = devices, loading = false, error = null) }
            } catch (e: Exception) {
                handleError(e)
            }
        }
    }

    fun toggle(device: Device) {
        val code = device.switchCode ?: return
        val newValue = !device.isOn
        // Atualiza logo o ecrã; se o comando falhar, volta a ler o estado real.
        setLocalSwitch(device.id, code, newValue)
        viewModelScope.launch {
            try {
                api.setSwitch(device.id, code, newValue)
            } catch (e: Exception) {
                handleError(e)
                refresh(silent = true)
            }
        }
    }

    private fun handleError(e: Exception) {
        if (e is ApiException && e.sessionExpired) {
            _state.value = UiState(loggedIn = false, error = e.message)
        } else {
            _state.update { it.copy(loading = false, error = e.message ?: e.toString()) }
        }
    }

    private fun setLocalSwitch(deviceId: String, code: String, value: Boolean) {
        _state.update { s ->
            s.copy(devices = s.devices.map { d ->
                if (d.id == deviceId) d.copy(status = d.status + (code to value)) else d
            })
        }
    }
}
