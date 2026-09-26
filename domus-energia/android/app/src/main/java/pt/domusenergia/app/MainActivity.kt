package pt.domusenergia.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import pt.domusenergia.app.ui.App
import pt.domusenergia.app.ui.DevicesViewModel

// Cores da marca Domus Energia (verde e branco), iguais às do site.
private val DomusColors = lightColorScheme(
    primary = Color(0xFF1B7F4B),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE8F5EE),
    onPrimaryContainer = Color(0xFF125C36),
    background = Color.White,
    surface = Color.White,
)

class MainActivity : ComponentActivity() {
    private val vm: DevicesViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = DomusColors) {
                Surface { App(vm) }
            }
        }
    }
}
