# Protocolo MQTT da Domus Energia — v2 (vários tipos de aparelho, alarme, automações, notificações)

Estende `PROTOCOLO-MQTT.md` (v1). Tudo o que está na v1 continua válido; um aparelho da v1 sem `canais` equivale a um aparelho com um único canal `interruptor` n.º 1.

Fuso horário de todas as horas: **Europe/Lisbon**.

## 1. Canais

Cada aparelho tem um ou mais **canais**. A lista `domus/<cliente>/_aparelhos` passa a ser:

```json
[
  {"id": "quadro", "nome": "Quadro geral", "tipo": "openbeken", "medidor": true,
   "canais": [{"n": 1, "funcao": "interruptor", "nome": "Geral"}]},
  {"id": "sala-4g", "nome": "Interruptor sala", "tipo": "openbeken",
   "canais": [{"n": 1, "funcao": "interruptor", "nome": "Teto"},
              {"n": 2, "funcao": "interruptor", "nome": "Candeeiro"},
              {"n": 3, "funcao": "interruptor", "nome": "Varanda"},
              {"n": 4, "funcao": "interruptor", "nome": "Corredor"}]},
  {"id": "porta-entrada", "nome": "Porta de entrada", "tipo": "openbeken", "bateria": true,
   "canais": [{"n": 1, "funcao": "porta"}, {"n": 2, "funcao": "bateria"}]},
  {"id": "pir-corredor", "nome": "Movimento corredor", "tipo": "openbeken", "bateria": true,
   "canais": [{"n": 1, "funcao": "movimento"}, {"n": 2, "funcao": "bateria"}]},
  {"id": "estore-quarto", "nome": "Estore quarto", "tipo": "shelly",
   "canais": [{"n": 1, "funcao": "estore"}]},
  {"id": "led-cozinha", "nome": "LED cozinha", "tipo": "shelly",
   "canais": [{"n": 1, "funcao": "luz"}]}
]
```

| `funcao` | Valor | Controlável pelo cliente |
|---|---|---|
| `interruptor` | ligado/desligado | sim |
| `luz` | ligada/desligada + brilho 0–100 | sim |
| `estore` | posição 0 (fechado) – 100 (aberto) + parar | sim |
| `porta` | aberta/fechada | não (sensor) |
| `movimento` | movimento/sem movimento | não (sensor) |
| `bateria` | percentagem 0–100 | não (sensor) |

- `medidor: true` → o aparelho publica potência/tensão/corrente/energia (tópicos da v1).
- `bateria: true` → aparelho a pilhas que **dorme**: liga-se ao Wi-Fi só quando há um evento. Não se mostra "Offline" por estar a dormir; mostra-se o último valor e **há quanto tempo** chegou. Se não houver notícias há mais de 24 h, mostrar aviso "Sem notícias há X h".
- Canal `n` sem `nome` → usa o nome do aparelho.

### OpenBeken (Wi-Fi BK7231, Chayo/Tongou, interruptores de parede, sensores Tuya reprogramados)
Canal `n` ⇄ canal `n` do OpenBeken:
| Tópico (a partir do prefixo) | Sentido | Conteúdo |
|---|---|---|
| `<n>/get` | aparelho → | `interruptor`/`luz`: `1`/`0`; `porta`: `1` aberta / `0` fechada; `movimento`: `1` / `0`; `bateria`: `0`–`100`; `estore`: `0`–`100` |
| `<n>/set` | → aparelho | `interruptor`: `1`/`0`; `estore`: `0`–`100` |
| `led_dimmer/get`, `led_dimmer/set` | ⇄ | `luz`: brilho 0–100 (apenas se OpenBeken controla LED) |

Os sensores a pilhas Tuya Wi-Fi (TuyaMCU de baixo consumo) são configurados no OpenBeken com `linkTuyaMCUOutputToChannel` para que o dpID do estado vá para o canal 1 e o da bateria para o canal 2. O script de administração imprime estas instruções.

### Shelly (Gen2/Gen3)
Canal `n` ⇄ componente `id = n-1`:
| funcao | Estado (aparelho →) | Comando (→ aparelho) |
|---|---|---|
| `interruptor` | `status/switch:<id>` JSON `output` | `command/switch:<id>` `on`/`off` |
| `luz` | `status/light:<id>` JSON `output`, `brightness` | `rpc` JSON `{"id":1,"src":"<clientId>","method":"Light.Set","params":{"id":<id>,"on":true,"brightness":80}}` |
| `estore` | `status/cover:<id>` JSON `current_pos`, `state` (`open`/`closed`/`opening`/`closing`/`stopped`) | `rpc` com `Cover.GoToPosition` `{"id":<id>,"pos":50}`, `Cover.Open`, `Cover.Close`, `Cover.Stop` |
| `porta`/`movimento` | `status/input:<id>` JSON `state` (true = aberta/movimento) | — |
Medição (`medidor: true`): `status/switch:0` → `apower`, `voltage`, `current`, `aenergy.total` (Wh), como na v1.

## 2. Alarme

- `domus/<cliente>/_alarme` (**retido**, publicado pelo motor): `{"ativo": true, "desde": "2026-09-26T22:10:00Z"}`
- Cliente pede alteração em `domus/<cliente>/_alarme/set`: `{"ativo": true}` ou `{"ativo": false}`.
- Com o alarme ativo, um canal `porta` a passar para aberta ou `movimento` a passar para 1 → evento `alarme` + notificação 🚨.

## 3. Automações

- `domus/<cliente>/_automacoes` (**retido**, publicado pelo motor): lista completa.
- Cliente substitui a lista publicando a lista completa em `domus/<cliente>/_automacoes/set`. O motor valida; automações com `"bloqueada": true` (criadas pela empresa) mantêm-se como estavam, exceto o campo `ativa`, que o cliente pode mudar. Automação com erro → evento `erro` com a explicação e a lista não muda.

```json
{
  "id": "luz-corredor",
  "nome": "Luz do corredor com movimento",
  "ativa": true,
  "bloqueada": false,
  "quando": {"tipo": "sensor", "aparelho": "pir-corredor", "canal": 1, "valor": 1},
  "se": {"alarme": false, "entre": ["19:00", "07:00"]},
  "entao": [
    {"acao": "ligar", "aparelho": "sala-4g", "canal": 4, "durante_s": 120}
  ]
}
```
- `quando`:
  - `{"tipo":"sensor","aparelho","canal","valor"}` — dispara quando o canal passa a esse valor (`1`/`0`).
  - `{"tipo":"hora","hora":"23:00","dias":[1,2,3,4,5,6,7]}` — 1 = segunda … 7 = domingo.
  - `{"tipo":"potencia","aparelho","acima_w":3500,"durante_s":60}` — consumo acima de X W durante Y s.
- `se` (opcional, todas as condições têm de ser verdade): `alarme` (bool), `entre` (["HH:MM","HH:MM"], pode passar a meia-noite).
- `entao` (1 a 10 ações):
  - `{"acao":"ligar"|"desligar","aparelho","canal","durante_s"?}` — `durante_s` volta ao estado oposto depois desse tempo.
  - `{"acao":"estore","aparelho","canal","posicao":0-100}`
  - `{"acao":"notificar","mensagem":"texto"}`
- Máximo 50 automações por cliente. `id`: `[a-z0-9-]{1,40}`.

## 4. Eventos e notificações

- `domus/<cliente>/_eventos` (não retido, publicado pelo motor):
  `{"ts":"...Z","tipo":"alarme"|"sensor"|"automacao"|"aviso"|"erro","titulo":"...","mensagem":"...","aparelho"?:..}`
- O motor guarda os últimos 100 eventos por cliente e publica-os **retidos** em `domus/<cliente>/_historico` (lista, mais recente primeiro).
- Notificações enviadas pelo motor para eventos `alarme`, `aviso` (ex.: bateria < 15 %, sensor sem notícias há 24 h) e ações `notificar`:
  - **ntfy** (no próprio servidor, em `https://ntfy.HOST` — o ntfy não funciona num sub-caminho): tópico secreto `domus-<cliente>-<segredo>`. O segredo é gerado pelo script `domus.sh` ao criar o cliente e publicado **retido** em `domus/<cliente>/_ntfy`: `{"url":"https://ntfy.HOST/domus-joao-9f3k2...","servidor":"https://ntfy.HOST","topico":"domus-joao-9f3k2..."}`. O motor **lê** o tópico desta mensagem retida (não gera outro) e publica no ntfy com o utilizador `motor` (só escrita em `domus-*`).
  - **Firebase (FCM)**: a app publica `{"token":"..."}` em `domus/<cliente>/_fcm/registar` (e `{"token":"...","remover":true}` ao sair). O motor guarda os tokens por cliente e envia pela API FCM HTTP v1 usando a conta de serviço em `servidor/dados/motor/firebase-service-account.json` (no contentor do motor: `/dados/firebase-service-account.json`) (se não existir, FCM fica desligado sem erro).

## 5. Permissões (ACL) — acrescenta à v1
Cliente `C` pode **escrever** também:
`domus/C/+/+/set` (canais OpenBeken), `domus/C/+/led_dimmer/set`, `domus/C/+/rpc`, `domus/C/_alarme/set`, `domus/C/_automacoes/set`, `domus/C/_fcm/registar`.
Utilizador `motor`: lê `domus/#` e escreve `domus/#` (serviço interno do servidor).

## 6. Modelo normalizado (app e site)
```
Aparelho { id, nome, tipo, medidor, bateria, online: bool, ultimaNoticia: Instant?, potenciaW?, tensaoV?, correnteA?, energiaKWh?, canais: [Canal] }
Canal    { n, funcao, nome, ligado?: bool, brilho?: int, posicao?: int, aberto?: bool, movimento?: bool, bateria?: int, ultimaMudanca?: Instant }
```
