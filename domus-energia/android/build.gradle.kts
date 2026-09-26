plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    // Firebase: só é aplicado no módulo app se existir app/google-services.json (ver app/build.gradle.kts).
    id("com.google.gms.google-services") version "4.4.2" apply false
}
