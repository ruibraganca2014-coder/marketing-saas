plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Firebase Cloud Messaging: o plugin google-services só é aplicado se existir app/google-services.json
// (criado na consola do Firebase — ver android/README.md). Sem ele a app compila e funciona na mesma,
// só sem notificações FCM.
val temFirebase = file("google-services.json").exists()
if (temFirebase) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle("Domus Energia: app/google-services.json não existe — compilado sem Firebase (sem notificações FCM).")
}

android {
    namespace = "pt.domusenergia.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "pt.domusenergia.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // Servidor MQTT da Domus Energia (ex.: "mqtt.domusenergia.pt" ou "51-38-10-20.sslip.io").
        // A app liga sempre por WebSocket seguro: wss://MQTT_HOST:443/mqtt (ver docs/PROTOCOLO-MQTT.md).
        buildConfigField("String", "MQTT_HOST", "\"SEU-SERVIDOR\"")
        // "Fale connosco" (subscrição gerida à mão / suspensa): WhatsApp (só algarismos, com o indicativo 351)
        // e telefone. Com os valores de exemplo (zeros) os botões não aparecem.
        buildConfigField("String", "CONTACTO_WHATSAPP", "\"351000000000\"")
        buildConfigField("String", "CONTACTO_TELEFONE", "\"+351 000 000 000\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            // Ficheiros duplicados do Netty (usado pelo cliente MQTT da HiveMQ).
            excludes += listOf(
                "META-INF/INDEX.LIST",
                "META-INF/io.netty.versions.properties",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
            )
        }
    }
}

dependencies {
    // Compose BOM 2024.12.01 → ui/foundation/animation 1.7.6, material3 1.3.1, material-icons-core 1.7.6,
    // ui-text-google-fonts 1.7.6.
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-text-google-fonts")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    // Cliente MQTT (MQTT 3.1.1) + módulo de WebSocket (traz o netty-codec-http).
    implementation("com.hivemq:hivemq-mqtt-client:1.3.17")
    implementation(platform("com.hivemq:hivemq-mqtt-client-websocket:1.3.17"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // HTTP para o serviço de pagamentos (/api/sessao, /api/checkout, /api/portal). Traz o okio 3.6.0.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Presença (opcional): zona de casa com o Geofencing dos Google Play services, verificação e
    // publicação com a app fechada pelo WorkManager; await() nas Task do Play services.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    // Firebase Cloud Messaging (BOM 33.7.0 → firebase-messaging 24.1.0). Compila sempre; só é
    // inicializado em tempo de execução se o plugin google-services tiver sido aplicado.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")
    // org.json real para os testes em JVM (no android.jar de testes só existem stubs).
    testImplementation("org.json:json:20260814")
    // Servidor HTTP falso para testar o cliente do serviço de pagamentos.
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
