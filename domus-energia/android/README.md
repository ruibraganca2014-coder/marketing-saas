# App Android da Domus Energia

App em Kotlin + Jetpack Compose (Material 3, tema "Terra") para os clientes controlarem a casa.
Liga-se diretamente ao servidor MQTT da Domus Energia (sem clouds de terceiros):
MQTT 3.1.1 sobre WebSocket seguro, `wss://SERVIDOR/mqtt` (porta 443). Contratos:
`docs/PROTOCOLO-MQTT.md` (v1), `docs/PROTOCOLO-MQTT-v2.md` (canais, alarme, automações, notificações) e
`docs/PROTOCOLO-MQTT-v3.md` (modos, cenas, automações v3, saúde, energia, configuração, presença).

## O que faz
- **Entrar** com o código de cliente e a palavra-passe (as mesmas da área de cliente no site).
  A sessão fica guardada; "Sair" (menu ⋮) termina-a.
- **Casa** (v3, `docs/PROTOCOLO-MQTT-v3.md`):
  - **Modo da casa**: Casa / Fora / Noite / Férias (`_modo/set`). O cartão mostra o estado do alarme
    (`_alarme`): "A armar… saia de casa" com contagem decrescente, "Desarme o alarme" (atraso de
    entrada) com contagem e botão "Desarmar agora", "Alarme disparado!", e as portas ignoradas.
    Se o servidor recusar armar ("Não armado: Janela WC está aberta."), aparece **Armar mesmo assim**
    (`"forcar": true`) ou Cancelar. Com um motor v2 (sem `_modo`) fica só Casa/Fora pelo `_alarme/set`.
  - **Cenas**: fila com as cenas (toque = executar); "Gerir" abre a lista para criar/editar/apagar.
    As da Domus Energia (cadeado) só se executam.
  - Aviso "N aparelhos precisam de atenção" (offline, pilha fraca, sinal fraco) → **Saúde**.
  - Resumo: potência agora (só os contadores `"geral": true`, se houver), **Hoje X kWh** (`_energia`), ligados (com "em espera"), portas abertas.
  - Aparelhos **agrupados por divisão**; canais ligados de aparelhos com medidor a gastar menos do que o
    limiar aparecem **Em espera**.
- **Automações**: assistente em 5 passos (objetivo e categoria → gatilho → primeira ação → condições →
  várias ações com Esperar e SE/SENÃO até 2 níveis), com todos os gatilhos, condições e ações da v3, e
  **modelos** já preenchidos com os aparelhos do cliente (luz com movimento, chegar/sair de casa, entrada
  inesperada, simular presença, consumo alto, bom dia, boa noite). Validação antes de enviar (≤ 20 ações,
  carga perigosa só com "durante" ≤ 4 h, sol só com a localização definida, …). Cada automação mostra o
  **registo** (última execução, resultado, motivo, vezes esta semana, últimas 20), **Testar agora**,
  **Avaliar agora**, **Executar** (gatilho manual), "Em pausa" e os **avisos de conflito**.
- **Histórico**: últimos eventos (alarmes, sensores, automações, avisos, modo) e o endereço ntfy.
- **Saúde dos aparelhos** (`_saude`): online/offline desde, última notícia, sinal Wi-Fi em barras,
  ligado há, reinícios em 24 h, pilha e dias estimados; os que precisam de atenção primeiro.
- **Relatório da casa** (§9): modo e alarme, consumo agora/hoje/ontem e, por divisão, o estado de cada
  canal (ligado/desligado/em espera, aberta/fechada, offline, pilha fraca, sinal fraco).
  **Copiar** e **Partilhar** (folha de partilha do Android) em texto simples.
- **Definições** (`_config/set`, só os campos alterados): atrasos de saída/entrada, horas de silêncio,
  relatório diário, aviso de offline, pausa manual, limiar de "em espera", localização da casa (cidade).
- **Presença** (opcional, desligada por omissão) — ver abaixo.
- **Notificações** (Firebase Cloud Messaging), se configurado — ver abaixo.
- **A minha subscrição** (menu ⋮) e planos — ver abaixo.

## Compilar
1. Em `app/build.gradle.kts`, troca `SEU-SERVIDOR` pelo domínio do servidor
   (ex.: `mqtt.domusenergia.pt` ou `51-38-10-20.sslip.io`):
   ```kotlin
   buildConfigField("String", "MQTT_HOST", "\"mqtt.domusenergia.pt\"")
   ```
2. Abre a pasta `android/` no **Android Studio** (Ladybug ou mais recente), espera pela sincronização do
   Gradle e carrega em ▶ com o telemóvel ligado por USB. Android 8.0 (API 26) ou mais recente.
3. Testes unitários (parser, comandos, automações, assistente, modelos, relatório, presença, planos e cliente do
   serviço de pagamentos): `./gradlew test`.

## Planos e subscrição (`docs/PROTOCOLO-PLANOS.md`)
- A app lê o `domus/<cliente>/_plano` retido (`data/Plano.kt`). Sem ele: **Conforto, ativo, gerido à mão**
  (clientes antigos não perdem nada). `Planos.permite(plano, estado, chave)` é a mesma tabela do motor e do site.
- **A minha subscrição**: plano, estado em palavras simples, próximo pagamento, "Mudar de plano" (escolha entre
  Base/Conforto/Premium → `POST /api/sessao` com o código e a palavra-passe guardados → `POST /api/checkout`
  → página do Stripe no navegador) e "Gerir pagamentos e faturas" (`POST /api/portal`). Pagamento em atraso:
  aviso com a data-limite e "Atualizar pagamento" (também numa faixa no topo de todos os ecrãs). Subscrição
  gerida à mão: "Fale connosco" (WhatsApp/telefone).
- Fora do plano (Base): modos Fora/Noite/Férias, notificações (o token FCM não é registado e não se pede a
  autorização do Android), Saúde, energia e relatório diário aparecem com um cadeado e "Disponível no plano
  Conforto — mudar de plano". A recusa do motor ("Disponível a partir do plano Conforto.") aparece no cartão dos modos.
- **Suspensa/cancelada**: só o ecrã "A sua subscrição está suspensa" com "Reativar subscrição" (checkout do
  mesmo plano), "Fale connosco" e "Sair". O servidor deixa estes clientes ler apenas o `_plano`.
- Configurar em `app/build.gradle.kts`: `CONTACTO_WHATSAPP` (só algarismos, com 351) e `CONTACTO_TELEFONE`; com
  os valores de exemplo (zeros) os botões não aparecem. O `/api` é `https://MQTT_HOST/api/`.
- Cliente HTTP em `data/PagamentosApi.kt` (OkHttp; token de 15 min guardado só em memória, renovado aos 13 min
  ou num 401). As páginas abrem com `Intent.ACTION_VIEW` (sem Custom Tabs, para não juntar dependências);
  só se abrem endereços `https://` devolvidos pelo servidor.

## Presença (opcional)
Em **Definições → Detetar quando chego e saio de casa**. Serve para os gatilhos "chega o primeiro /
sai o último" e a condição "alguém/ninguém em casa". Código só em `presenca/`.

Como funciona:
1. Um ecrã explica **antes** de pedir as autorizações (regra do Google Play para localização em segundo
   plano): localização precisa → "Permitir sempre" (Android 10+; no 11+ o Android abre a página de
   autorizações da app) → onde é a casa (posição atual, ou a cidade — menos preciso) → nome → Wi-Fi de casa.
2. Regista uma **zona** (Geofencing dos Google Play services, raio ≥ 100 m; 1,5 km se escolher só a
   cidade) e, se escolhido, compara o **SSID** do Wi-Fi atual com o de casa. Ligado ao Wi-Fi de casa conta
   como "em casa" mesmo que o GPS diga o contrário; sem evento da zona e sem Wi-Fi de casa não se decide nada.
3. Só publica depois de o valor estar **estável 10 min** (`presenca/PresencaLogica.kt`, testado com
   relógio falso). A publicação é feita pelo **WorkManager** (`PresencaWorker`), com a app fechada, por uma
   ligação MQTT curta: `_presenca/set` `{"pessoa":"tel-…","nome":"Rui","em_casa":true}` (nunca retida).
   Há também uma verificação a cada 15 min (mínimo do WorkManager) que apanha mudanças de Wi-Fi e volta a
   registar a zona; depois de reiniciar o telemóvel, `ArranqueReceiver` regista-a outra vez.
4. Desligar (ou sair da conta) publica `{"pessoa":"tel-…","remover":true}`.

Para o servidor só vai "em casa"/"fora" e o nome; a posição nunca sai do telemóvel.

**Limitações (honestas):**
- Precisa dos Google Play services (telemóveis sem eles: a opção aparece desativada).
- O Geofencing do Android pode demorar vários minutos a notar uma saída (mais com a poupança de
  bateria), e marcas como Xiaomi, Huawei, Samsung ou Oppo podem matar o trabalho em segundo plano:
  convém pôr a app "sem restrições" de bateria. Somando os 10 min de confirmação, uma chegada/saída pode
  chegar ao servidor 10–20 min depois (ou mais). Não serve para desarmar o alarme e a app nunca o faz.
- O SSID só é legível com a localização autorizada e ligada; lê-se com `WifiManager.connectionInfo`
  (obsoleto desde o Android 12, mas ainda funcional para apps com autorização de localização).
- Ao sair da conta **sem** ligação ao servidor, o pedido de remoção perde-se (a pessoa continua em
  `_presenca` com o último estado até se voltar a ativar ou até a empresa a remover).
- O telemóvel só conta como uma pessoa; várias pessoas = vários telemóveis com a opção ligada.

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
| `data/` | Modelo (`Aparelho`, `Canal`, `Automacao`, `Cena`, `ConfigCasa`, …), leitura das mensagens MQTT (`EstadoParser`, `CasaV3`), comandos (`Comandos`), automações (`Automacoes`, `Rascunho` = rascunho do assistente ⇄ JSON), modelos de automação (`Modelos`), saúde e relatório (`Relatorio`), resumo e textos. Kotlin puro, testado em JVM. `DomusMqtt` (cliente HiveMQ, religa sozinho; `enviarUmaVez` para o WorkManager) e `Sessao` (SharedPreferences). |
| `ui/` | Ecrãs Compose: `Screens.kt` (entrada, navegação, menu ⋮), `Casa.kt` (modos, cenas, aparelhos por divisão), `AutomacoesScreen.kt` + `Assistente.kt` + `Formulario.kt`, `CenasScreen.kt`, `SaudeRelatorio.kt`, `DefinicoesScreen.kt` (inclui os ecrãs de explicação da presença), `HistoricoScreen.kt`, `Ilustracoes.kt`, `Icones.kt`, `FundoVivo.kt`, `Plataforma.kt` (partilhar/autorizações, fornecido pela `MainActivity`), `DevicesViewModel.kt`. |
| `ui/tema/` | Tema "Terra" (cores claro/escuro, letra Alegreya Sans + Nunito Sans por Google Fonts descarregáveis). |
| `presenca/` | Presença: lógica pura (`PresencaLogica`: debounce 10 min, junção zona + Wi-Fi), `PresencaControlador` (Geofencing, posição atual), `ZonaReceiver`/`ArranqueReceiver`, `PresencaWorker` (WorkManager), `WifiCasa`, `PresencaPrefs`. |
| `notificacoes/` | FCM: token, serviço de mensagens e canais de notificação. |

Versões: AGP 8.7.3, Kotlin 2.0.21, Gradle 8.14.3, compileSdk/targetSdk 35, minSdk 26, Compose BOM
2024.12.01 (material3 1.3.1), activity-compose 1.9.3, lifecycle 2.8.7, core-ktx 1.15.0, HiveMQ MQTT client
1.3.17, coroutines 1.9.0 (+ `kotlinx-coroutines-play-services` 1.9.0), Firebase BOM 33.7.0,
**play-services-location 21.3.0**, **work-runtime-ktx 2.10.0**, **OkHttp 4.12.0** (testes: MockWebServer 4.12.0).

## Segurança (protótipo)
A palavra-passe fica **cifrada** (AES-256-GCM) com uma chave do **Android Keystore** (`data/CofreSenha.kt` +
`data/Sessao.kt`); nas `SharedPreferences` só fica o texto cifrado, e a palavra-passe em texto simples das versões
anteriores é cifrada e apagada na primeira abertura. Sem dependências novas: não se usa
`androidx.security:security-crypto` (EncryptedSharedPreferences), que a Google descontinuou. Se o Keystore
falhar, a palavra-passe não é guardada (pede-se outra vez ao abrir). `allowBackup="false"` mantém-se.
Ações arriscadas pedem confirmação: desligar o disjuntor geral na Casa, executar uma cena e guardar uma cena/
automação que mexa no quadro geral ou numa carga perigosa (`data/Riscos.kt`). A app nunca publica mensagens retidas
(um comando retido voltaria a ser executado quando o aparelho reiniciasse).
