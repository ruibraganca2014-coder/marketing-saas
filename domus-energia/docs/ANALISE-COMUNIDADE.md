# Análise da comunidade de automação residencial

> **Limite da pesquisa:** o Reddit (reddit.com e old.reddit.com) está bloqueado na rede onde a análise foi feita. As provas vêm do fórum Home Assistant, GitHub, documentação Tasmota/OpenBeken/Shelly/Firebase e imprensa técnica, que repetem os mesmos temas do Reddit, mas não são citações diretas de lá. Inferências estão assinaladas.

## 1. Os 12 principais problemas e o que significam para a Domus Energia

| # | Problema | Impacto no nosso desenho | Fontes |
|---|---|---|---|
| 1 | **Dependência da cloud/servidor central** (Tuya em baixo, Insteon fechou em 2022) | **Falha mais grave:** motor e broker estão só na VPS; sem internet não há alarme nem automações | [HA](https://community.home-assistant.io/t/tuya-devices-stopped-working/684336) · [The Register](https://www.theregister.com/2022/04/19/insteon_cloud_shutdown/) · [Stacey on IoT](https://staceyoniot.com/the-end-of-insteon-and-why-the-smart-home-keeps-faltering/) |
| 2 | **Interruptores físicos têm de funcionar sempre** (família abandona o sistema) | Interruptores e Shelly têm de atuar o relé localmente, nunca via MQTT | [NCSU](https://freeh.wordpress.ncsu.edu/2015/02/14/why-is-my-smart-home-so-dumb/) · [WAF](https://en.wikipedia.org/wiki/Wife_acceptance_factor) |
| 3 | **"Ghost switching"** por comandos MQTT retidos | Disjuntores e estores podem ligar/mexer sozinhos após reinício | [Tasmota #2053](https://github.com/arendst/Tasmota/issues/2053) · [Tasmota MQTT](https://tasmota.github.io/docs/MQTT/) · [FAQ](https://tasmota.github.io/docs/FAQ/) |
| 4 | **Estado do relé após falha de energia** | Definir por aparelho (`SetStartValue` no OpenBeken); "último estado" é perigoso em aquecedores/motores; relé biestável do TO-Q-SY1 precisa de validação após flash/OTA | [OpenBeken](https://github.com/openshwprojects/OpenBK7231T_App/blob/main/docs/commands.md) · [Shelly forum](https://shelly-forum.com/thread/21529-output-state-after-power-loss/) · [Elektroda](https://www.elektroda.com/rtvforum/topic4027207.html) |
| 5 | **Luz de movimento apaga com pessoas na divisão** | O nosso "ligar durante X s" tem este defeito se não recomeçar a contar a cada movimento | [HA 1](https://community.home-assistant.io/t/if-no-motion-for-4-minutes-turn-off-but-if-motion-reset-the-4min-timer/646024) · [HA 2](https://community.home-assistant.io/t/motion-sensor-keeps-turning-off-my-lights/359697) |
| 6 | **Sensores Wi-Fi a pilhas:** atraso de segundos e pilhas que duram pouco | O alarme depende deles: atraso e pilhas gastas sem aviso são críticos (medir em bancada) | [HA](https://community.home-assistant.io/t/door-window-ble-sensors-vs-zwave-wifi-zigbee/732132) · [Zigbee Guru](https://zigbeeguru.com/best-zigbee-door-window-sensors/) · [Whizz](https://whizz-experts.com/support/smart-devices/tuya-battery-draining-fast/) |
| 7 | **Falhas silenciosas** (aparelho offline sem aviso) | Alarme ativo com sensor offline = falsa segurança | [HA 1](https://community.home-assistant.io/t/notify-when-any-sensor-is-unavailable-offline/73730) · [HA 2](https://community.home-assistant.io/t/solved-detect-when-sensors-go-offline/756649) · [Watchdog](https://xeazy.com/sensor-watchdog-blueprint/) |
| 8 | **Falsos alarmes e armar difícil** | Faltam atrasos de entrada/saída e recusa de armar com janela aberta | [Alarmo](https://github.com/nielsfaber/alarmo) · [HA](https://community.home-assistant.io/t/trigger-delay-on-binary-sensors-and-alarmo-false-alarms-urgent-request/703300) · [Alarmo #145](https://github.com/nielsfaber/alarmo/issues/145) |
| 9 | **Fadiga de notificações** + FCM de alta prioridade gasto em coisas não urgentes atrasa os alarmes verdadeiros | Prioridade alta só para o alarme | [vCloudInfo](https://www.vcloudinfo.com/2026/06/home-assistant-notification-snooze-buttons.html) · [Firebase prioridade](https://firebase.google.com/docs/cloud-messaging/android-message-priority) · [Firebase blog](https://firebase.blog/posts/2025/04/fcm-on-android/) |
| 10 | **Wi-Fi e routers dos operadores** com dezenas de aparelhos em 2,4 GHz | Exigir/recomendar router ou AP decente; testar routers MEO/NOS/Vodafone (provas fracas) | [BusinessWire](https://www.businesswire.com/news/home/20220606005384/en/RouteThis-Device-Overload-Overwhelming-Bandwidth-in-UK-and-Ireland) · [Zuper](https://www.zuper.co/blog/smart-home-installation-service-challenges-and-solutions) |
| 11 | **Segurança MQTT** (brokers expostos, 1883 sem TLS) | Broker público na VPS: um erro de ACL expõe a casa de outro cliente (já temos 79 testes de ACL) | [Avast](https://blog.avast.com/mqtt-vulnerabilities-hacking-smart-homes) · [How-To Geek](https://www.howtogeek.com/your-mqtt-broker-might-be-public/) · [NDSS](https://www.ndss-symposium.org/wp-content/uploads/sdiotsec25-10.pdf) |
| 12 | **Presença pouco fiável** (GPS, poupança de bateria) | Não usar um só sinal para desligar/armar | [Smart-Wired](https://smart-wired.com/home-assistant/home-assistant-presence-detection/) · [HA docs](https://www.home-assistant.io/getting-started/presence-detection/) |

**TO-Q-SY1-JWT:** no firmware v1.0.18 o CloudCutter não funciona; é preciso abrir (furar rebites), fazer flash por UART e calibrar o BL0942 ([ESPHome](https://devices.esphome.io/devices/tongou-to-q-sy1-jwt/) · [Elektroda](https://www.elektroda.com/rtvforum/topic4067261.html)). *Inferência não confirmada:* reflashar anula a garantia, pode afetar a conformidade CE e não se sabe se as proteções de sobretensão/sobrecorrente do firmware original se mantêm. Verificar antes de vender.

## 2. Recomendações (por impacto/esforço)

**Alto impacto, pouco esforço**
- Estado de arranque por aparelho: **desligado por defeito**; "último estado" só para iluminação; testar após corte de energia e após OTA.
- **Nunca publicar comandos com retain** (só estados); limpar retidos; LWT em todos os aparelhos.
- Temporizador de ocupação que **recomeça a cada movimento**; opção "não apagar se foi ligado à mão".
- Alarme: **atraso de entrada/saída**, recusa de armar com sensor aberto (dizendo qual), estado persistente, registo de quem armou/desarmou.
- Notificações: intervalo mínimo por regra, agrupamento, horas de silêncio (exceto alarme), FCM de alta prioridade só no alarme, ntfy como canal de reserva.

**Alto impacto, esforço médio**
- **Painel de saúde:** último contacto, sinal Wi-Fi (RSSI), bateria, reinícios; alerta de aparelho offline há mais de X min; alerta "sensor do alarme offline".
- Em cada automação: última execução, resultado, botão "Testar", histórico de falhas.
- Segurança: TLS em 8883, credenciais por aparelho, ACL por cliente (feito), fail2ban, testes automáticos de isolamento (feitos).
- Estimativa de bateria e contagem de acordares nos sensores; aviso de pilha fraca com semanas de antecedência.

**Alto impacto, muito esforço**
- **Funcionamento local sem internet** (o mais importante): regras críticas no próprio aparelho (scripts OpenBeken, cenas/scripts Shelly) ou uma pequena **ponte local** (Raspberry Pi ou router com Mosquitto em ponte para a VPS), para o alarme e interruptor→luz funcionarem sem internet.
- Avaliar **sensores Zigbee** com gateway local para o alarme, em vez de Wi-Fi a pilhas.

**Impacto médio:** cenas; presença combinada (geofence + Wi-Fi do telemóvel, raio ≥ 100 m, ~10 min de margem); OTA gerido com reversão; backup/restauro; instalação guiada com teste de sinal; Alexa/Google (provas fracas).

**Energia:** o entusiasmo com gráficos passa em 2–3 meses; o valor que fica são **alertas de anomalia por circuito** (consumo base a subir, aparelho avariado) e **limites de custo mensal** ([Clever Home Club](https://cleverhomeclub.com/smart-home-energy-monitoring/)).

**Negócio de instalação:** documentação de entrega, plano de suporte pago, um único contacto, router/AP decente como pré-requisito ([DoItForMe](https://doitforme.solutions/blog/smart-home-support/) · [Zuper](https://www.zuper.co/blog/smart-home-installation-service-challenges-and-solutions)).

## 3. O que NÃO fazer
- Pôr interruptores ou alarme dependentes da cloud/VPS.
- Usar retain em comandos MQTT.
- "Repor último estado" em aquecedores, motores, bombas.
- Expor 1883 sem autenticação e sem TLS.
- Confiar num só sinal de presença para desligar/armar.
- Enviar notificação por tudo; FCM de alta prioridade só no urgente.
- Prender o cliente ao nosso servidor: planear saída se a empresa fechar (exportar configuração; firmware aberto e reconfigurável para broker local ou Home Assistant).
- Sensores de alarme a pilhas a reportar demasiado.
- Mudar hábitos da família: o interruptor continua a ser um interruptor.

## 4. Decisões do dono (fase 3)
- **Sem internet:** regras essenciais **nos próprios aparelhos** (interruptor físico → relé local; estado após corte de energia definido por aparelho — desligado por defeito, "último estado" só em iluminação; scripts OpenBeken / cenas locais Shelly). Sem mini-servidor em casa por agora. O alarme continua a precisar de internet (limitação aceite; o sistema avisa quando a ligação cai).
- **Sensores:** **só Wi-Fi** (sem Zigbee nem gateway). Mitigações obrigatórias: aviso de pilha fraca com antecedência, alerta "sensor do alarme offline", atraso de entrada/saída no alarme para absorver os segundos de acordar do sensor, sensores configurados para reportar o mínimo.
