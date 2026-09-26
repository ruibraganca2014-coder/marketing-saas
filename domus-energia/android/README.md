# App Android da Domus Energia

App em Kotlin + Jetpack Compose (Material 3, tema "Terra") para os clientes controlarem a casa.
Liga-se diretamente ao servidor MQTT da Domus Energia (sem Tuya, sem cloud de terceiros):
MQTT 3.1.1 sobre WebSocket seguro, `wss://SERVIDOR/mqtt` (porta 443). Contratos:
`docs/PROTOCOLO-MQTT.md` (v1) e `docs/PROTOCOLO-MQTT-v2.md` (canais, alarme, automações, notificações).

## O que faz
- **Entrar** com o código de cliente e a palavra-passe (as mesmas da área de cliente no site).
  A sessão fica guardada; "Sair" (ícone no canto) termina-a.
- **Casa**: alarme (ativar/desativar), resumo (potência agora, ligados, portas abertas, alarme) e um
  cartão por aparelho com os canais: circuitos, luzes com brilho, estores (posição + Abrir/Parar/Fechar),
  portas, movimento e bateria, com pequenas ilustrações animadas. O fundo muda devagar com o consumo,
  as luzes ligadas e o alarme.
- **Automações**: ativar/desativar, criar, editar e apagar. As criadas pela empresa (cadeado) só se
  ativam/desativam. Se o servidor recusar uma alteração, aparece a explicação.
- **Histórico**: últimos eventos (alarmes, sensores, automações, avisos) e o endereço para subscrever
  os avisos na app **ntfy** (botão "Copiar").
- **Notificações** (Firebase Cloud Messaging), se configurado — ver abaixo.

## Compilar
1. Em `app/build.gradle.kts`, troca `SEU-SERVIDOR` pelo domínio do servidor
   (ex.: `mqtt.domusenergia.pt` ou `51-38-10-20.sslip.io`):
   ```kotlin
   buildConfigField("String", "MQTT_HOST", "\"mqtt.domusenergia.pt\"")
   ```
2. Abre a pasta `android/` no **Android Studio** (Ladybug ou mais recente), espera pela sincronização do
   Gradle e carrega em ▶ com o telemóvel ligado por USB. Android 8.0 (API 26) ou mais recente.
3. Testes unitários (parser, comandos, automações): `./gradlew test`.

## Notificações com Firebase (opcional)
Sem Firebase a app funciona na mesma; os avisos chegam só pelo ntfy. Para ativar as notificações:

1. Vai a <https://console.firebase.google.com>, **Adicionar projeto** (ex.: "Domus Energia"; o Google
   Analytics não é preciso).
2. No projeto: **Adicionar app → Android**, com o nome do pacote **`pt.domusenergia.app`**. Os outros
   campos são opcionais.
3. Descarrega o **`google-services.json`** e copia-o para **`android/app/google-services.json`**
   (ao lado de `app/build.gradle.kts`). Não o ponhas no git se o repositório for público.
4. Compila outra vez. O `app/build.gradle.kts` só aplica o plugin `com.google.gms.google-services`
   quando esse ficheiro existe (sem ele aparece no registo do Gradle
   "compilado sem Firebase" e a app compila na mesma).
5. Para o servidor poder enviar: na consola, **Definições do projeto → Contas de serviço → Gerar nova
   chave privada**, e guarda o ficheiro no servidor em `servidor/dados/firebase-service-account.json`
   (o motor usa a API FCM HTTP v1; se o ficheiro não existir, o FCM fica desligado sem erro).

Como funciona: ao entrar (e sempre que a ligação volta) a app publica `{"token":"..."}` em
`domus/<cliente>/_fcm/registar`; ao sair publica `{"token":"...","remover":true}`. No Android 13 ou
mais recente a app pede autorização para mostrar notificações depois de entrar. Há dois canais,
que o utilizador pode ajustar nas definições do Android: **Alarmes** (importância alta) e **Avisos**
(normal). Com a app fechada o Android mostra a notificação sozinho no canal indicado pelo servidor
(`android.notification.channel_id` = `alarmes`/`avisos`) ou, se não vier nenhum, em "Avisos".

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `data/` | Modelo (`Aparelho`, `Canal`, `Automacao`), leitura das mensagens MQTT (`EstadoParser`), comandos (`Comandos`), automações (`Automacoes`, `Rascunho`), resumo e textos. Kotlin puro, testado em JVM. `DomusMqtt` (cliente HiveMQ, religa sozinho) e `Sessao` (SharedPreferences). |
| `ui/` | Ecrãs Compose: `Screens.kt` (entrada, navegação), `Casa.kt`, `AutomacoesScreen.kt`, `HistoricoScreen.kt`, `Ilustracoes.kt`, `FundoVivo.kt`, `DevicesViewModel.kt`. |
| `ui/tema/` | Tema "Terra" (cores claro/escuro, letra Alegreya Sans + Nunito Sans por Google Fonts descarregáveis). |
| `notificacoes/` | FCM: token, serviço de mensagens e canais de notificação. |

## Segurança (protótipo)
A palavra-passe fica em `SharedPreferences` privadas da app (com `allowBackup="false"`).
Próximo passo: `EncryptedSharedPreferences` / Android Keystore. A app nunca publica mensagens retidas
(um comando retido voltaria a ser executado quando o aparelho reiniciasse).
