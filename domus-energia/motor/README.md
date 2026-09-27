# Motor de regras — Domus Energia

Serviço interno do servidor que trata do **alarme e modos da casa**, das
**automações e cenas**, da **saúde e energia** dos aparelhos, dos
**eventos/histórico** e das **notificações** (ntfy e Firebase). Fala apenas
MQTT com o Mosquitto, com o utilizador `motor` (lê e escreve `domus/#`).

Contrato: [`docs/PROTOCOLO-MQTT.md`](../docs/PROTOCOLO-MQTT.md) (v1),
[`docs/PROTOCOLO-MQTT-v2.md`](../docs/PROTOCOLO-MQTT-v2.md) (secções 2–5) e
[`docs/PROTOCOLO-MQTT-v3.md`](../docs/PROTOCOLO-MQTT-v3.md) (tudo exceto §4
configuração nos aparelhos e §9 interface). Tudo o que era válido na v2
continua válido. Planos e subscrições:
[`docs/PROTOCOLO-PLANOS.md`](../docs/PROTOCOLO-PLANOS.md) §1–§3 (ver
[Planos](#planos-e-subscrições) abaixo).

## O que faz

| Tópico (`domus/<cliente>/…`) | Sentido | O motor… |
|---|---|---|
| `_aparelhos` (retido) | admin → | lê a lista de aparelhos/canais (v1 sem `canais` = um `interruptor` no canal 1), incluindo os campos v3 `entrada`, `simular`, `arranque`, `carga`, `divisao` |
| `<aparelho>/…` | aparelhos → | segue o estado de cada canal (OpenBeken `<n>/get`, `connected`, `led_dimmer/get`, `power/get`, `energycounter/get`, `rssi`, `uptime`…; Shelly `status/switch:<id>`, `status/input:<id>`, `status/cover:<id>`, `status/light:<id>`, `status/devicepower:0`, `status/wifi`, `status/sys`, `online`) |
| `_config/set` | cliente → | funde o objeto parcial com a configuração, valida e publica `_config` **retido** |
| `_modo/set` | cliente → | `{"modo","forcar"?,"por"?}` muda o modo e arma/desarma o alarme; publica `_modo` e `_alarme` **retidos** |
| `_alarme/set` | cliente → | v2: `{"ativo":true}` = modo `fora`, `{"ativo":false}` = modo `casa` |
| `_presenca/set` | app → | `{"pessoa","nome","em_casa"}` / `{"pessoa","remover":true}`; publica `_presenca` **retido** |
| `_automacoes/set` | cliente → | valida a lista completa; guarda e publica `_automacoes` e `_automacoes/avisos` **retidos**; se não, evento `erro` e a lista não muda |
| `_automacoes/executar` | cliente → | `{"id"}` executa (manual, com condições), `{"id","testar":true}` executa ignorando gatilho/condições/pausa, `{"id","avaliar":true}` só avalia as condições |
| `_automacoes/admin` | admin/motor → | administração das automações **bloqueadas** (ver abaixo) |
| `_cenas/set` | cliente → | valida a lista completa de cenas; publica `_cenas` **retido** |
| `_cenas/executar` | cliente → | `{"id","por"?}` executa a cena |
| `_cenas/admin` | admin/motor → | administração das cenas **bloqueadas** |
| `_fcm/registar` | app → | `{"token"}` regista, `{"token","remover":true}` apaga (máx. 10 por cliente) |
| `_ntfy` (retido) | domus.sh → | lê o tópico ntfy secreto do cliente (o motor nunca o gera nem publica) |
| `_plano` (retido) | pagamentos/domus.sh → | plano e estado da subscrição (validação estrita; o motor nunca o publica); sem `_plano` = `conforto`/`ativo` |
| `_eventos` | → todos | eventos (não retidos) |
| `_historico` (retido) | → todos | últimos 100 eventos, mais recente primeiro |
| `_automacoes/registo` (retido) | → todos | registo das últimas 20 execuções de cada automação, com o motivo |
| `_saude` (retido) | → todos | saúde dos aparelhos (a cada 5 min ou quando muda) — só planos com `saude` |
| `_energia` (retido) | → todos | consumo de hoje/ontem/mês (a cada 5 min e à meia-noite) — só planos com `energia` |

Os comandos (`…/set`, `…/executar`, `_fcm/registar`) **retidos** são sempre
ignorados; os estados retidos (`_config`, `_modo`, `_alarme`, `_automacoes`,
`_cenas`, `_presenca`, `_automacoes/registo`, `_historico`) só são adotados se
o motor tiver perdido o seu estado local.

### Payloads publicados pelo motor

```jsonc
// _config (retido) — valores por omissão
{"atraso_saida_s":30,"atraso_entrada_s":30,"silencio":["23:00","07:00"],"limiar_espera_w":5,
 "offline_min":30,"pausa_manual_min":60,"local":{"lat":38.72,"lon":-9.14},"relatorio_diario":"08:00"}
// _modo (retido)
{"modo":"casa"|"fora"|"noite"|"ferias","desde":"…Z"|null,"por":"app"|"web"|"automacao:<id>"|"cena:<id>"|null}
// _alarme (retido) — "tipo" é null quando desarmado; "ate" só em a_armar/entrada;
// "desde" = início do estado atual
{"ativo":true,"estado":"desarmado"|"a_armar"|"armado"|"entrada"|"disparado","tipo":"total"|"perimetro"|null,
 "desde":"…Z"|null,"ate":"…Z"|null,"ignorados":[{"aparelho":"janela-wc","canal":1}],"por":"app"|null}
// _presenca (retido)
{"pessoas":{"<id>":{"nome":"Rui","em_casa":true,"desde":"…Z"}},"alguem":true}
// _automacoes/avisos (retido)
[{"ids":["a","b"],"mensagem":"'a' liga e 'b' desliga Teto no mesmo gatilho"}]
// _automacoes/registo (retido) — "ultimos" do mais recente para o mais antigo.
// "Avaliar agora" só entra em "ultimos" (resultado "avaliacao", com "ok"): "ultima",
// "resultado" e "motivo" são sempre os da última execução real (null se nunca executou).
// Se a mensagem passar de 200 KB, "ultimos" é encurtado (10, 5, 2, 1, 0 por automação).
{"<id>":{"ultima":"…Z","resultado":"executada"|"condicao_falsa"|"falhou"|"pausada"|"teste"|"avaliacao",
  "motivo":"…","semana":12,"teste"?:true,"ok"?:false,
  "ultimos":[{"ts":"…Z","resultado":"…","motivo":"…","teste"?:true,"ok"?:false}]}}
// _saude (retido)
{"<aparelho>":{"online":true,"ultima_noticia":"…Z"|null,"rssi":-61|null,"uptime_s":86400|null,
  "reinicios_24h":0,"bateria":84|null,"bateria_dias":120|null,"offline_desde":"…Z"|null}}
// _energia (retido)
{"hoje_kwh":7.4,"ontem_kwh":9.1,"mes_kwh":180.2,"aparelhos":{"quadro":{"hoje_kwh":7.4,"ontem_kwh":9.1}}}
// _eventos: v2 + tipo "modo" (mudança de modo/armar/desarmar, com "por")
{"ts":"…Z","tipo":"alarme"|"sensor"|"automacao"|"aviso"|"erro"|"modo","titulo":"…","mensagem":"…","aparelho"?:"…","por"?:"…"}
```

## Regras principais

- **Transições**: um sensor só “dispara” quando o valor **muda**. Os valores
  retidos recebidos ao arrancar servem só de referência (não disparam nada).
- **Modos e alarme** (máquina de estados, persistida com os prazos):
  - `casa` = desarmado; `fora` e `ferias` = alarme **total** (portas e
    movimento); `noite` = **perímetro** (só portas);
  - armar → `a_armar` durante `atraso_saida_s` → `armado` (sensores ignorados
    durante o atraso de saída);
  - porta com `"entrada": true` → `entrada` durante `atraso_entrada_s`
    (notificação normal “Desarme o alarme”, mesmo nas horas de silêncio;
    movimento e a própria porta de entrada não disparam nesse tempo) → sem
    desarme, `disparado`; outras portas e movimento (total) → `disparado`
    logo; `disparado` = evento `alarme` + notificação urgente e mantém-se até
    desarmar (novos sensores voltam a notificar);
  - **recusa armar** com portas abertas (evento `erro` “Não armado: Janela WC
    está aberta.”, o modo não muda); com `forcar` arma e põe-nas em
    `ignorados` — uma porta ignorada que feche volta a estar protegida;
  - mudar entre modos armados (ex.: `noite` → `fora`) não repete o atraso de
    saída, só muda o tipo;
  - sensor do alarme offline (pilhas sem notícias > 24 h, ou `connected`/
    `online` offline nos aparelhos sem pilhas) com o alarme armado → `aviso`
    (uma vez por ocorrência);
  - quem armou/desarmou fica em `_modo.por`, `_alarme.por` e no evento `modo`.
- **Férias**: as luzes/interruptores com `"simular": true` (nunca
  `"carga": "perigosa"`) ligam e desligam em momentos aleatórios (acesas
  15–60 min, apagadas 10–60 min) entre o pôr do sol (ou 19:00 sem
  `local`) e as 23:30; às 23:30 e ao sair de férias fica tudo apagado.
- **Automações** (`quando` sensor [+`durante_s`] / hora / potência
  [+`rearmar_w`] / sol / presença / modo / manual / sistema; condições `se`
  alarme, entre, dias, sol, modo, presença, aparelhos; ações ligar, desligar,
  alternar, luz, estore, notificar, cena, modo, esperar, se/senão):
  - `hora` e `sol` avaliadas uma vez por minuto na hora de Lisboa (mudanças de
    hora tratadas pelo `Intl`; uma hora repetida em outubro só dispara uma
    vez; as horas que não existem no último domingo de março, 01:00–01:59,
    disparam uma vez às 02:00); nascer/pôr do sol pelo algoritmo da NOAA para `_config.local`;
  - `sensor` com `durante_s`: dispara quando o canal está nesse valor há X s
    (a contagem é cancelada se o valor mudar e sobrevive a reinícios);
  - `potencia`: dispara quando fica acima de `acima_w` durante `durante_s`; só
    volta a poder disparar depois de descer abaixo de `rearmar_w` (por
    omissão 90 % de `acima_w`);
  - `esperar`: as ações seguintes ficam guardadas e continuam depois do
    tempo, mesmo que o motor reinicie (se o motor estiver parado mais de 1 h
    para lá do prazo, a sequência é abandonada); um novo disparo da mesma
    automação substitui a sequência pendente;
  - `se`/`senao`: o ramo é escolhido quando é alcançado; máx. 2 níveis e 20
    ações no total;
  - `durante_s` (ligar/desligar): volta ao estado oposto no fim, também depois
    de reinícios; funciona como temporizador de ocupação (um novo disparo ou o
    sensor de movimento a repetir “1” **recomeça** a contagem);
  - **pausa manual**: quando alguém (botão físico, app) muda um canal
    controlável — e não é o eco de um comando do motor — as automações que
    agem nesse canal ficam em pausa `pausa_manual_min` para esse canal
    (exceto `ignorar_pausa`); aparece no registo com a hora de fim;
  - **cargas perigosas**: ligar sem `durante_s` (ou com mais de 4 h), `alternar`
    ou `luz` com brilho é erro de validação (automações e cenas), e é também
    recusado na execução;
  - **registo**: executada, condição falsa (qual e valor atual), pausada (até
    HH:MM), falhou (aparelho do gatilho offline; aparelho que não confirmou o
    comando em 5 s), teste e avaliação; `semana` = execuções nos últimos 7
    dias;
  - **conflitos**: duas automações ativas com o mesmo gatilho que mexem no
    mesmo canal em sentidos opostos → `_automacoes/avisos` (não bloqueia);
  - proteção contra ciclos: no máximo 20 execuções por automação (e por cena)
    por minuto e 8 execuções encadeadas (automação → modo → automação…).
- **Cenas**: máx. 30, ações da v3 exceto `se` e `cena`; as bloqueadas (da
  empresa) não são editáveis nem apagáveis pelo cliente; uma cena usada por
  uma automação não pode ser apagada; `_cenas/executar` publica um evento
  `automacao` “Cena: …” (sem notificação). As cenas não respeitam a pausa
  manual (são um pedido explícito).
- **Comandos** para aparelhos: OpenBeken `<n>/set` (`1`/`0` ou posição) e
  `led_dimmer/set`; Shelly `command/switch:<id>` `on`/`off` (+ `command`
  `status_update`), `rpc` com `Light.Set` (com `brightness`) /
  `Cover.GoToPosition` e `"src":"motor"`. **Nunca retidos**.
- **Saúde** (`_saude`): `online`, última notícia, `rssi`/`uptime_s` (OpenBeken
  `<p>/rssi` e `<p>/uptime` se o aparelho os publicar; Shelly `status/wifi` e
  `status/sys`; sem dados = `null`), `reinicios_24h` (descidas do uptime),
  `bateria`, `bateria_dias` (regressão linear sobre amostras de 6 em 6 h dos
  últimos 14 dias; `null` com menos de 3 amostras / 2 dias ou sem descida;
  pilhas novas recomeçam a estimativa). Avisos, uma vez por ocorrência:
  aparelho sem pilhas offline > `offline_min` (se metade ou mais da casa cair
  ao mesmo tempo, um só aviso “Casa sem ligação”), bateria < 15 % (um por
  dia, como na v2), `bateria_dias` < 21, sinal < -80 dBm durante 1 h, mais de
  5 reinícios em 24 h.
- **Energia reposta**: pelo menos metade dos aparelhos sem pilhas (e no mínimo
  2) voltam a online em 2 min depois de estarem offline → `aviso` “A casa
  esteve sem internet de HH:MM a HH:MM.” e gatilho `sistema`
  `energia_reposta`. O servidor não consegue distinguir falta de internet de
  falta de energia (os dois aparecem como aparelhos offline).
- **Energia** (`_energia`): diferenças do contador (Wh) dos aparelhos
  `medidor`; um contador que desce (reinício) conta como recomeço do zero;
  muda de dia à meia-noite de Lisboa. O total da casa é a soma dos medidores
  com `"geral": true` em `_aparelhos` (extensão opcional) ou, se não houver
  nenhum, de todos os medidores.
- **Horas de silêncio** (`_config.silencio`): só os alarmes (e o aviso de
  entrada do alarme) notificam; os outros eventos ficam no histórico na mesma.
- **Relatório diário** às `relatorio_diario`: notificação (tipo `aviso`,
  prioridade normal, respeita o silêncio; não vai para o histórico) com o
  modo/alarme, ligados, em espera (canal ligado de um medidor abaixo de
  `limiar_espera_w`), abertas, offline, bateria fraca, sinal fraco e consumo
  de hoje/ontem.
- **Limite de notificações**: no máximo 10 notificações por cliente por minuto
  (exceto as do alarme — disparo e aviso de entrada —, que passam sempre); as
  que passam do limite ficam no histórico mas não são enviadas.
- **Eventos** que geram notificação: `alarme` (prioridade `urgent`), `aviso`
  (`high`, exceto o aviso de entrada e o relatório, `default`) e a ação
  `notificar` (evento `automacao`, `default`). O evento `sensor` é publicado
  para portas (aberta/fechada) e o evento `modo` para mudanças de modo, sem
  notificação.
- **ntfy**: `POST NTFY_URL/<tópico>` com `Title`, `Priority`, `Tags` e
  autenticação `motor`. O tópico vem do `_ntfy` retido criado pelo `domus.sh`;
  se um cliente não o tiver, não recebe ntfy (fica registado uma vez) mas o FCM
  continua.
- **FCM** (opcional): API HTTP v1 com a conta de serviço; tokens que o FCM diz
  não existirem (`UNREGISTERED`/404) são apagados.
- **Robustez**: nenhuma mensagem maior do que `MQTT_MAX_PAYLOAD` é publicada;
  os contadores dos limites por minuto são limpos a cada minuto e o estado de um
  aparelho removido de `_aparelhos` é esquecido; mensagens inválidas nunca derrubam o serviço; gravação do
  estado adiada (1 s) e atómica; religação automática ao broker; `SIGTERM`
  grava o estado e fecha a ligação.

## Planos e subscrições

Tabela única de funcionalidades em `src/planos.js` (`permite(plano, estado,
chave)`, `FUNCIONALIDADES`, `mensagemBloqueio`, `validarPlano`), igual à §1 do
contrato. `ativo`, `teste` e `em_atraso` têm tudo o que o plano inclui;
`suspenso`/`cancelado` (modo básico) não têm nada. Sem `_plano` retido (ou com
`_plano` apagado) o cliente fica `conforto`/`ativo`/`manual`: nada muda para
os clientes antigos. Um `_plano` inválido (campo desconhecido, plano/estado
desconhecido, data que não é ISO) é ignorado e fica o plano anterior. O plano
é guardado no `estado.json`, para valer logo no arranque.

**Plano base** (sem `alarme`, `notificacoes`, `saude`, `energia`,
`relatorio_diario`):
- `_modo/set` `fora`/`noite`/`ferias` e `_alarme/set` `{"ativo":true}` →
  evento `erro` "Disponível a partir do plano Conforto." e nada muda (`casa`
  é sempre permitido);
- `_automacoes/set`/`_cenas/set` com uma ação `modo` para fora/noite/férias
  (também dentro de `se`) ou com gatilho `{"tipo":"modo"}` desses modos →
  erro de validação `Automação "<id>": o modo Fora não está incluído no seu
  plano. Disponível a partir do plano Conforto.` As condições `se.modo` são
  aceites (só leem o modo). Automações/cenas que o cliente já tinha antes da
  descida e que vêm **sem alterações** (exceto `ativa`) são aceites, para não
  bloquear a edição da lista; na execução, a ação `modo` armada é recusada e
  fica no registo como `falhou` ("Modo Fora não ativado: Disponível a partir
  do plano Conforto.");
- notificações ntfy/FCM não são enviadas (os eventos continuam no
  histórico); sem relatório diário; sem os avisos de saúde da v3 (offline,
  pilhas a acabar, sinal fraco, reinícios) — os avisos da v2 (bateria < 15 %,
  24 h sem notícias) continuam no histórico;
- `_saude` e `_energia` não são publicados e os retidos são apagados
  (mensagem retida vazia) quando o plano muda e a cada sincronização; o
  motor continua a calcular tudo, e numa subida de plano são republicados
  logo.

**Descida de plano com o alarme armado** (ou modo ≠ `casa`) → modo `casa`,
alarme desarmado e evento `modo` com `"por":"plano"`. Uma subida de plano
não faz mais nada.

**Modo básico** (`suspenso`/`cancelado`): modo `casa` forçado (evento `modo`
com `por: "plano"`, termina a simulação de férias); não corre automações
(nenhum gatilho), cenas, alarme, simulação nem notificações; as sequências
`esperar`, as reversões `durante_s`, as contagens de potência/"há X s" e as
confirmações pendentes são canceladas — por segurança, o que o motor tinha
ligado com `durante_s` é desligado logo em vez de ficar ligado. Pedidos do
cliente (que a ACL já não deixa passar) recebem o erro "Subscrição suspensa.
Reative a subscrição para voltar a usar esta funcionalidade." (ou
"cancelada"). O estado dos aparelhos continua a ser lido (canais, energia,
online, eventos de porta no histórico), para a reativação ser imediata.

### Limitações conhecidas

- Sem internet em casa, o alarme, as automações entre aparelhos e as
  notificações não funcionam (limitação aceite na v3 §4); o motor avisa
  quando os aparelhos voltam.
- Um gatilho `sensor` com `durante_s` só começa a contar numa **mudança** vista
  ao vivo (ou continua uma contagem guardada); um valor retido no arranque não
  inicia contagens.
- Aparelhos a pilhas dormem: o seu LWT “offline” é ignorado; contam como
  offline só ao fim de 24 h sem notícias.
- A confirmação “respondeu em 5 s” exige que o aparelho publique o estado
  depois do comando (OpenBeken `<n>/get`, Shelly `status/…`); um estore conta
  como confirmado com qualquer posição recebida.

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
| `MQTT_MAX_PAYLOAD` | `921600` (900 KB) | tamanho máximo de uma mensagem publicada; maiores são registadas como erro e **não** são publicadas (uma mensagem acima do `max_packet_size` do Mosquitto, 1 MB, faria o broker cortar a ligação e o motor ficaria num ciclo de religações) |

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
- `estado.json` — plano (`_plano`), configuração, modo e alarme (com prazos), automações,
  cenas, presença, registo, histórico, tokens FCM, reversões `durante_s` e
  sequências `esperar` pendentes, pausas manuais, contagens de energia,
  amostras de bateria, reinícios e avisos já enviados;
- `firebase-service-account.json` — opcional.

## Administração: automações e cenas bloqueadas

As automações criadas pela empresa (`"bloqueada": true`) não podem ser criadas
nem apagadas pelo cliente, que só pode mudar o campo `ativa`. As cenas
bloqueadas não podem ser alteradas nem apagadas. Geram-se com a CLI, que fala
com o motor em funcionamento pelo MQTT (as cenas usam `_cenas/admin` e
`_cenas/admin/resultado`, com `"cena"`/`"cenas"` em vez de
`"automacao"`/`"automacoes"`):

- pedido: `domus/<cliente>/_automacoes/admin` (não retido)
  - `{"op":"guardar","automacoes":[…],"pedido":"<id>"}` — cria/substitui por `id`
    (`bloqueada` fica `true` se não for indicado);
  - `{"op":"apagar","id":"…","pedido":"<id>"}`;
  - `{"op":"substituir","automacoes":[…],"pedido":"<id>"}` — lista completa.
- resposta: `domus/<cliente>/_automacoes/admin/resultado`
  `{"pedido":"<id>","ok":true}` ou `{"pedido":"<id>","ok":false,"erro":"…"}`.

Só `admin` e `motor` podem publicar nos tópicos de pedido (ACL: têm
`readwrite domus/#`; nenhum padrão de escrita do cliente os apanha).

```sh
cd servidor
# Dentro do contentor (usa MQTT_USER/MQTT_PASS do motor); ficheiro pelo stdin:
docker compose exec -T motor node src/admin.js automacao joao - < noite.json
docker compose exec -T motor node src/admin.js apagar-automacao joao empresa-noite
docker compose exec -T motor node src/admin.js listar-automacoes joao
docker compose exec -T motor node src/admin.js cena joao - < sair.json
docker compose exec -T motor node src/admin.js apagar-cena joao sair
docker compose exec -T motor node src/admin.js listar-cenas joao
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
  `notificar`, relógio, armazenamento e gerador aleatório injetados);
- `src/motor-casa.js` — `_config`, modos, alarme, presença, simulação de férias;
- `src/motor-automacoes.js` — automações, cenas, registo, pausa manual, `esperar`;
- `src/motor-saude.js` — online/offline, energia reposta, `_saude`, `_energia`, relatório;
- `src/planos.js` — tabela de funcionalidades por plano, validação do `_plano`;
- `src/motor-planos.js` — `_plano`, mudanças de plano, modo básico;
- `src/validacao.js` — validação estrita das automações e cenas, conflitos;
- `src/aparelhos.js` — lista de aparelhos e comandos por tipo;
- `src/casa.js` — configuração da casa (omissões, fusão, validação);
- `src/sol.js` — nascer/pôr do sol (NOAA);
- `src/saude.js`, `src/energia.js`, `src/relatorio.js` — cálculos puros;
- `src/tempo.js` — horas de Lisboa (Intl);
- `src/notificacoes.js` — ntfy e FCM (o `google-auth-library` só é carregado
  se houver conta de serviço);
- `src/armazenamento.js` — ficheiro de estado (gravação adiada e atómica);
- `src/index.js` — ligações (MQTT, ntfy/FCM, disco, sinais);
- `src/admin.js` — CLI de administração.
