# Motor de regras — Domus Energia

Serviço interno do servidor que trata do **alarme**, das **automações**, dos
**eventos/histórico** e das **notificações** (ntfy e Firebase). Fala apenas MQTT
com o Mosquitto, com o utilizador `motor` (lê e escreve `domus/#`).

Contrato: [`docs/PROTOCOLO-MQTT.md`](../docs/PROTOCOLO-MQTT.md) (v1) e
[`docs/PROTOCOLO-MQTT-v2.md`](../docs/PROTOCOLO-MQTT-v2.md) (secções 2–5).

## O que faz

| Tópico (`domus/<cliente>/…`) | Sentido | O motor… |
|---|---|---|
| `_aparelhos` (retido) | admin → | lê a lista de aparelhos/canais (v1 sem `canais` = um `interruptor` no canal 1) |
| `<aparelho>/…` | aparelhos → | segue o estado de cada canal (OpenBeken `<n>/get`, `connected`, `led_dimmer/get`, `power/get`…; Shelly `status/switch:<id>`, `status/input:<id>`, `status/cover:<id>`, `status/light:<id>`, `status/devicepower:0`, `online`) e a hora da última notícia |
| `_alarme/set` | cliente → | valida `{"ativo": bool}`, guarda e publica `_alarme` **retido** `{"ativo", "desde"}` |
| `_automacoes/set` | cliente → | valida a lista completa; se estiver bem, guarda e publica `_automacoes` **retido**; se não, publica um evento `erro` com a explicação e a lista não muda |
| `_automacoes/admin` | admin/motor → | administração das automações **bloqueadas** (ver abaixo) |
| `_fcm/registar` | app → | `{"token"}` regista, `{"token","remover":true}` apaga (máx. 10 por cliente) |
| `_ntfy` (retido) | domus.sh → | lê o tópico ntfy secreto do cliente (o motor nunca o gera nem publica) |
| `_eventos` | → todos | eventos (não retidos) |
| `_historico` (retido) | → todos | últimos 100 eventos, mais recente primeiro |

Regras principais:

- **Transições**: um sensor só “dispara” quando o valor **muda**. Os valores
  retidos recebidos ao arrancar servem só de referência (não disparam nada).
  Comandos retidos (`_alarme/set`, `_automacoes/set`, …) são ignorados.
- **Alarme ativo** + porta a abrir ou movimento → evento `alarme` e notificação
  urgente.
- **Automações** (`quando` sensor / hora / potência, condições `se`, ações
  `ligar`/`desligar`/`estore`/`notificar`):
  - `hora`: avaliada uma vez por minuto na hora de Lisboa (mudanças de hora
    tratadas pelo `Intl`; na mudança de outubro, uma hora que acontece duas
    vezes só dispara uma vez; na de março, as horas que não existem —
    01:00–01:59 — não disparam);
  - `potencia`: dispara uma vez quando fica acima de `acima_w` durante
    `durante_s`; volta a poder disparar depois de descer;
  - `durante_s`: volta ao estado oposto ao fim desse tempo, mesmo que o motor
    reinicie entretanto (fica gravado). Funciona como temporizador de
    ocupação: um novo disparo (ou o sensor de movimento a repetir “1”)
    **recomeça** a contagem. Se alguém mudar o canal à mão entretanto, a
    reversão é cancelada; se o canal já estava ligado por outra pessoa, não se
    agenda reversão;
  - proteção contra ciclos: no máximo 20 execuções por automação por minuto.
- **Comandos** para aparelhos: OpenBeken `<n>/set` (`1`/`0` ou posição); Shelly
  `command/switch:<id>` `on`/`off` (+ `command` `status_update`), `rpc` com
  `Light.Set` / `Cover.GoToPosition` e `"src":"motor"`. **Nunca retidos**.
- **Avisos** (`aviso`): bateria < 15 % (uma vez por dia por aparelho) e aparelho
  a pilhas sem notícias há mais de 24 h (uma vez, até voltar a dar notícias).
- **Eventos** que geram notificação: `alarme` (prioridade `urgent`), `aviso`
  (`high`) e a ação `notificar` (evento `automacao`, `default`). O evento
  `sensor` é publicado para portas (aberta/fechada), sem notificação.
- **ntfy**: `POST NTFY_URL/<tópico>` com `Title`, `Priority`, `Tags` e
  autenticação `motor`. O tópico vem do `_ntfy` retido criado pelo `domus.sh`;
  se um cliente não o tiver, não recebe ntfy (fica registado uma vez) mas o FCM
  continua.
- **FCM** (opcional): API HTTP v1 com a conta de serviço; tokens que o FCM diz
  não existirem (`UNREGISTERED`/404) são apagados.
- **Robustez**: mensagens inválidas nunca derrubam o serviço; gravação do
  estado adiada (1 s) e atómica; religação automática ao broker; `SIGTERM`
  grava o estado e fecha a ligação.

## Variáveis de ambiente

| Variável | Por omissão | Descrição |
|---|---|---|
| `MQTT_URL` | `mqtt://mosquitto:1883` | broker |
| `MQTT_USER` | `motor` | utilizador MQTT (ACL: `readwrite domus/#`) |
| `MQTT_PASS` | — | palavra-passe MQTT |
| `DADOS_DIR` | `/dados` | pasta do estado (`estado.json`) |
| `NTFY_URL` | `http://ntfy` | ntfy interno (rede do Docker) |
| `NTFY_USER` / `NTFY_PASS` | — | autenticação básica para publicar (utilizador `motor`, só escrita em `domus-*`) |
| `NTFY_TOKEN` | — | alternativa: token de acesso (`Authorization: Bearer`) |
| `NTFY_PUBLIC_URL` | — | não é usado pelo motor (o URL público vem do `_ntfy`) |
| `FCM_SERVICE_ACCOUNT` | `$DADOS_DIR/firebase-service-account.json` | conta de serviço Firebase; se não existir, o FCM fica desligado (registado uma vez no arranque) |
| `TZ` | `Europe/Lisbon` | só para os registos; as automações usam sempre Europe/Lisbon |
| `MOTOR_TICK_MS` | `1000` | intervalo do relógio interno (testes) |
| `MOTOR_ESPERA_ARRANQUE_MS` | `3000` | espera pelas mensagens retidas antes de publicar o estado |

## Como corre no servidor

O `servidor/docker-compose.yml` constrói esta pasta (`build: ../motor`) como
serviço `motor`:

```yaml
  motor:
    build: ../motor
    restart: unless-stopped
    depends_on: [mosquitto, ntfy]
    environment:
      TZ: Europe/Lisbon
      MQTT_URL: mqtt://mosquitto:1883
      MQTT_USER: motor
      MQTT_PASS: ${MOTOR_MQTT_PASS}
      DADOS_DIR: /dados
      NTFY_URL: http://ntfy
      NTFY_USER: motor
      NTFY_PASS: ${NTFY_MOTOR_PASS}
      FCM_SERVICE_ACCOUNT: /dados/firebase-service-account.json
    volumes:
      - ./dados/motor:/dados
```

O contentor corre como o utilizador **`node` (uid 1000)**, sem privilégios.
A pasta `servidor/dados/motor` tem de lhe pertencer (se o Docker a criar,
fica de `root` e o motor avisa nos registos que não consegue gravar):

```sh
cd servidor
sudo mkdir -p dados/motor
sudo chown -R 1000:1000 dados/motor
# Firebase (opcional): copiar a conta de serviço para lá
sudo cp firebase-service-account.json dados/motor/
sudo chown 1000:1000 dados/motor/firebase-service-account.json
sudo chmod 600 dados/motor/firebase-service-account.json
docker compose up -d --build motor
docker compose logs -f motor
```

Ficheiros em `servidor/dados/motor/`:
- `estado.json` — alarme, automações, histórico, tokens FCM, reversões
  `durante_s` pendentes, avisos já enviados;
- `firebase-service-account.json` — opcional.

## Administração: automações bloqueadas

As automações criadas pela empresa (`"bloqueada": true`) não podem ser criadas
nem apagadas pelo cliente, que só pode mudar o campo `ativa`. Geram-se com a
CLI, que fala com o motor em funcionamento pelo MQTT:

- pedido: `domus/<cliente>/_automacoes/admin` (não retido)
  - `{"op":"guardar","automacoes":[…],"pedido":"<id>"}` — cria/substitui por `id`
    (`bloqueada` fica `true` se não for indicado);
  - `{"op":"apagar","id":"…","pedido":"<id>"}`;
  - `{"op":"substituir","automacoes":[…],"pedido":"<id>"}` — lista completa.
- resposta: `domus/<cliente>/_automacoes/admin/resultado`
  `{"pedido":"<id>","ok":true}` ou `{"pedido":"<id>","ok":false,"erro":"…"}`.

Só `admin` e `motor` podem publicar no tópico de pedido (ACL: têm
`readwrite domus/#`; nenhum padrão de escrita do cliente o apanha).

```sh
cd servidor
# Dentro do contentor (usa MQTT_USER/MQTT_PASS do motor); ficheiro pelo stdin:
docker compose exec -T motor node src/admin.js automacao joao - < noite.json
docker compose exec -T motor node src/admin.js apagar-automacao joao empresa-noite
docker compose exec -T motor node src/admin.js listar-automacoes joao
```

`noite.json` (um objeto ou uma lista):

```json
{
  "id": "empresa-noite",
  "nome": "Desligar a varanda à noite",
  "quando": {"tipo": "hora", "hora": "01:00", "dias": [1,2,3,4,5,6,7]},
  "entao": [{"acao": "desligar", "aparelho": "sala-4g", "canal": 3}]
}
```

Fora do contentor: `MQTT_URL=mqtt://HOST:1883 ADMIN_MQTT_USER=admin
ADMIN_MQTT_PASS=… node src/admin.js …` (a CLI usa `ADMIN_MQTT_USER`/
`ADMIN_MQTT_PASS` e, se não estiverem definidas, `MQTT_USER`/`MQTT_PASS`).

## Desenvolvimento

```sh
cd motor
npm ci
npm test          # testes unitários + integração (broker aedes em processo)
MQTT_URL=mqtt://localhost:1883 MQTT_PASS=… DADOS_DIR=./dados npm start
```

Estrutura:
- `src/motor.js` — núcleo (classe `Motor`, sem rede nem disco: `publicar`,
  `notificar`, relógio e armazenamento injetados);
- `src/validacao.js` — validação estrita das automações;
- `src/aparelhos.js` — lista de aparelhos e comandos por tipo;
- `src/tempo.js` — horas de Lisboa (Intl);
- `src/notificacoes.js` — ntfy e FCM (o `google-auth-library` só é carregado
  se houver conta de serviço);
- `src/armazenamento.js` — ficheiro de estado (gravação adiada e atómica);
- `src/index.js` — ligações (MQTT, ntfy/FCM, disco, sinais);
- `src/admin.js` — CLI de administração.
