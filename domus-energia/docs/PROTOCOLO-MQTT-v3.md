# Protocolo MQTT da Domus Energia — v3

Estende a v2 (`PROTOCOLO-MQTT-v2.md`), que continua válida. Base: `AUTOMACOES-v3.md` (guia Vesternet), `ANALISE-COMUNIDADE.md` e as decisões do dono:
- sem internet → **regras nos próprios aparelhos** (sem servidor em casa);
- sensores **só Wi-Fi**.

Regras gerais (mantêm-se): comandos **nunca retidos**; só estado/configuração é retido. Validação estrita no motor: um campo desconhecido é erro, por isso **todos os campos novos abaixo têm de ser aceites pelo validador**. Fuso Europe/Lisbon.

---

## 1. Configuração da casa — `_config`
`domus/<c>/_config` (retido, publicado pelo motor) e `domus/<c>/_config/set` (cliente envia objeto parcial; o motor funde, valida, persiste e republica).
```json
{
  "atraso_saida_s": 30,        // 0–300: tempo para sair depois de armar
  "atraso_entrada_s": 30,      // 0–300: tempo para desarmar depois de abrir uma porta de entrada
  "silencio": ["23:00", "07:00"], // horas de silêncio: só alarmes notificam (null = sem silêncio)
  "limiar_espera_w": 5,        // aparelho ligado abaixo disto = "em espera"
  "offline_min": 30,           // aviso de aparelho offline (aparelhos sem bateria)
  "pausa_manual_min": 60,      // 0–480: pausa das automações de um canal mexido à mão
  "local": {"lat": 38.72, "lon": -9.14}, // para nascer/pôr do sol (opcional)
  "relatorio_diario": "08:00"  // envia notificação com o relatório da casa (null = não)
}
```

## 2. Modos da casa e alarme
`domus/<c>/_modo` (retido): `{"modo":"casa"|"fora"|"noite"|"ferias","desde":"...Z","por":"app"|"web"|"automacao:<id>"|"cena:<id>"}`; pedido em `_modo/set` `{"modo":"fora","forcar":false,"por":"app"}`.

| Modo | Alarme | Notas |
|---|---|---|
| `casa` | desarmado | |
| `fora` | **total**: portas + movimento | |
| `noite` | **perímetro**: só portas | movimento não dispara |
| `ferias` | total | + **simulação de presença**: luzes marcadas `simular: true` ligam/desligam aleatoriamente entre o pôr do sol (ou 19:00) e as 23:30 |

`_alarme` (retido) passa a ter:
```json
{"ativo": true, "estado": "desarmado"|"a_armar"|"armado"|"entrada"|"disparado",
 "tipo": "total"|"perimetro", "desde": "...Z", "ate": "...Z", "ignorados": [{"aparelho":"janela-wc","canal":1}], "por": "app"}
```
- **Atraso de saída**: ao armar → `a_armar` durante `atraso_saida_s`, depois `armado`.
- **Atraso de entrada**: canais `porta` marcados `"entrada": true` em `_aparelhos` → `entrada` durante `atraso_entrada_s` (notificação normal "Desarme o alarme"); se não for desarmado → `disparado`. Outras portas e movimento (no modo total) → `disparado` imediato.
- `disparado` → evento `alarme` + notificação urgente; mantém-se até desarmar.
- **Recusa armar com portas abertas**: sem `forcar` → evento `erro` "Não armado: Janela WC está aberta." e o modo não muda. Com `forcar: true` → arma e põe as abertas em `ignorados`.
- **Sensor do alarme offline** (bateria sem notícias > 24 h, ou `connected`/`online` = offline) com alarme armado → evento `aviso`.
- `_alarme/set` da v2 continua: `{"ativo":true}` = modo `fora`, `{"ativo":false}` = modo `casa`.
- O estado persiste entre reinícios do motor (incluindo `a_armar`/`entrada` com `ate`).
- Registo de quem armou/desarmou nos eventos (`por`).

## 3. Aparelhos — campos novos em `_aparelhos`
Por canal:
- `"entrada": true` (só `porta`): porta de entrada com atraso.
- `"simular": true` (só `interruptor`/`luz`): usado na simulação de férias.
- `"arranque": "desligado"|"ligado"|"ultimo"` (só controláveis): estado depois de um corte de luz. **Por omissão `desligado`**. `ultimo` só é aceite pelo script para `luz`/`interruptor` sem `"carga": "perigosa"`.
- `"carga": "normal"|"perigosa"` (aquecedor, termoacumulador, bomba, motor): nunca `ultimo`, e as automações não o ligam sem `durante_s` (máx. 4 h).
- `"divisao": "Sala"` (texto, opcional): agrupa no relatório e na app.

## 4. Regras nos aparelhos (funcionar sem internet)
Tudo o que é essencial fica configurado **no próprio aparelho** pelo script `domus.sh` (imprime os comandos a colar):
- Botão físico → relé **localmente** (OpenBeken: `setPinRole` Btn + `linkChannel`/`SetButtonEvents`; Shelly: `in_mode` "follow"/"flip"). Nunca depender do MQTT para o interruptor.
- Estado de arranque: OpenBeken `SetStartValue <canal> <0|1|-1>` no `autoexec.bat`; Shelly `Switch.SetConfig {initial_state: "off"|"on"|"restore_last"}`.
- Proteções: OpenBeken sem MQTT não faz nada perigoso; Shelly `auto_off` para cargas perigosas (limite de segurança local, ex. 4 h).
- O motor deteta `energia_reposta` (≥ 50 % dos aparelhos não-bateria voltaram a `online` em 2 min após estarem offline) → gatilho de sistema + evento `aviso`.
- **Limitação aceite**: sem internet, alarme, automações entre aparelhos e notificações não funcionam; a app mostra "Sem ligação ao servidor" e o motor gera `aviso` "A casa esteve sem internet de HH:MM a HH:MM" quando os aparelhos voltam.

## 5. Saúde dos aparelhos — `_saude`
O motor publica (retido, a cada 5 min ou quando muda) `domus/<c>/_saude`:
```json
{"<aparelho>": {"online": true, "ultima_noticia": "...Z", "rssi": -61, "uptime_s": 86400,
   "reinicios_24h": 0, "bateria": 84, "bateria_dias": 120, "offline_desde": null}}
```
Fontes: OpenBeken publica periodicamente `<p>/rssi` e `<p>/uptime` (verificar no aparelho; se não vier, `null`); Shelly `status/wifi` (`rssi`) e `status/sys` (`uptime`). `bateria_dias`: estimativa linear a partir da descida da percentagem nos últimos 14 dias (`null` sem dados suficientes). `reinicios_24h`: descidas do uptime.
Avisos (evento `aviso`, uma vez por ocorrência): aparelho sem bateria offline > `offline_min`; bateria < 15 % ou `bateria_dias` < 21; sinal fraco (rssi < -80 durante 1 h); > 5 reinícios em 24 h.

## 6. Energia — `_energia`
Retido, atualizado a cada 5 min: `{"hoje_kwh": 7.4, "ontem_kwh": 9.1, "mes_kwh": 180.2, "aparelhos": {"quadro": {"hoje_kwh": 7.4, "ontem_kwh": 9.1}}}` a partir do contador de energia (Wh) dos aparelhos `medidor` (diferença desde a meia-noite; tolera reinício do contador).
**Em espera**: canal ligado de aparelho `medidor` com potência < `limiar_espera_w` → estado "Em espera" na app/site e no relatório.

## 7. Cenas — `_cenas`
`domus/<c>/_cenas` (retido) / `_cenas/set` (lista completa, mesmas regras das automações: `bloqueada` da empresa preservada exceto nada editável; máx. 30) / `_cenas/executar` `{"id":"cinema","por":"app"}`.
```json
{"id": "cinema", "nome": "Noite de cinema", "icone": "filme", "bloqueada": false,
 "acoes": [ /* ações da §8, exceto "se" e "cena" (sem cenas dentro de cenas) */ ]}
```
`icone` ∈ `filme`, `sol`, `lua`, `porta`, `casa`, `energia`, `luz`, `estrela`.

## 8. Automações v3
Campos novos da automação: `descricao` (≤ 200, a frase-objetivo), `categoria` (`conveniencia`|`energia`|`seguranca`|`conforto`|`rotina`), `ignorar_pausa` (bool).

**Gatilhos (`quando`)** — v2 + :
- `{"tipo":"sensor", ..., "durante_s": 600}` — o canal está nesse valor há X s (ex.: sem movimento há 10 min). Serve também para `interruptor`/`luz` (valor 1/0).
- `{"tipo":"sol","evento":"nascer"|"por","desvio_min": -30}` (−180…180; precisa de `_config.local`).
- `{"tipo":"presenca","evento":"chega_primeiro"|"sai_ultimo"}`.
- `{"tipo":"modo","modo":"noite"}` — quando a casa entra nesse modo.
- `{"tipo":"manual"}` — só por botão/`executar`.
- `{"tipo":"sistema","evento":"aparelho_offline"|"aparelho_online"|"energia_reposta","aparelho"?: "..."}`.
- `potencia` ganha `"rearmar_w"` (histerese; por omissão 90 % de `acima_w`).

**Condições (`se`)** — v2 + : `dias` [1–7], `sol` `"dia"|"noite"`, `modo` [lista], `presenca` `"alguem"|"ninguem"`, `aparelhos` `[{"aparelho","canal","valor"}]`.

**Ações (`entao`)** — v2 + :
- `{"acao":"luz","aparelho","canal","brilho":0-100}`; `{"acao":"alternar","aparelho","canal"}`
- `{"acao":"cena","cena":"cinema"}`; `{"acao":"modo","modo":"fora","forcar":false}`
- `{"acao":"esperar","s":1-3600}` — as ações seguintes esperam.
- `{"acao":"se","condicao":{/* como "se" */},"entao":[...],"senao":[...]}` — máx. 2 níveis; total ≤ 20 ações contando as aninhadas.
- `ligar` com `durante_s`: temporizador que **recomeça** a cada novo disparo (já na v2).

**Pausa manual**: quando um canal controlável muda por alguém que não o motor (botão físico, app), as automações que agem nesse canal ficam em pausa `pausa_manual_min` para esse canal (exceto `ignorar_pausa`). A pausa aparece no registo. Executar à mão (`_automacoes/executar` sem `testar`/`avaliar`) é um pedido explícito do cliente e ignora a pausa; "avaliar" diz se os canais estão em pausa (`ok: false` se todos os canais onde age estiverem em pausa). Mudar `pausa_manual_min` para 0 levanta as pausas em curso.

**Presença**: a app publica `domus/<c>/_presenca/set` `{"pessoa":"<id-do-telemóvel>","nome":"Rui","em_casa":true}` (geofence ≥ 100 m + Wi-Fi de casa; a app só publica depois de 10 min estáveis). O motor mantém `_presenca` (retido) `{"pessoas":{"<id>":{"nome","em_casa","desde"}},"alguem":true}`.

**Testar agora / executar**: `domus/<c>/_automacoes/executar` `{"id":"...","testar":true}` → executa as ações ignorando gatilho e condições; resultado no registo com `"teste": true`. `{"id","avaliar":true}` → não executa, só diz se as condições seriam verdadeiras agora: o resultado fica só em `ultimos` (resultado `"avaliacao"`, com `ok`) e **não** altera `ultima`/`resultado`/`motivo`, que são sempre os da última execução real.

**Registo** — `domus/<c>/_automacoes/registo` (retido):
```json
{"<id>": {"ultima": "...Z", "resultado": "executada"|"condicao_falsa"|"falhou"|"pausada"|"teste",
  "motivo": "Condição 'modo = noite' falsa (modo atual: casa)", "semana": 12,
  "ultimos": [{"ts","resultado","motivo"}] /* até 20 */}}
```
Motivos: gatilho de aparelho offline, condição falsa (qual e valor atual), ação sem resposta em 5 s ("Interruptor sala não respondeu"), pausa manual até HH:MM.

**Avisos de conflito** — ao guardar, o motor publica `domus/<c>/_automacoes/avisos` (retido) `[{"ids":["a","b"],"mensagem":"'a' liga e 'b' desliga Teto no mesmo gatilho"}]` (não bloqueia a gravação).

**Limite de segurança**: automação que tenta ligar canal `carga: "perigosa"` sem `durante_s` → erro de validação.

## 9. Relatório da casa
Construído na app/site a partir de `_aparelhos`, estados, `_saude`, `_energia`, `_modo`/`_alarme` (nenhum tópico novo). Agrupado por `divisao`:
- ligado / desligado / **em espera**, abertas/fechadas, offline, bateria fraca, sinal fraco;
- consumo agora, hoje, ontem; modo e alarme;
- botão **Copiar** (texto simples pt-PT). O motor envia o mesmo resumo em texto por notificação às `relatorio_diario` (tipo `aviso`, prioridade normal, respeita o silêncio).

## 10. Permissões (ACL) — acrescenta à v2
Cliente `C` pode também **escrever**: `domus/C/_config/set`, `domus/C/_modo/set`, `domus/C/_cenas/set`, `domus/C/_cenas/executar`, `domus/C/_automacoes/executar`, `domus/C/_presenca/set`.
Continua a **não** poder escrever: `_config`, `_modo`, `_cenas`, `_saude`, `_energia`, `_presenca`, `_automacoes/registo`, `_automacoes/avisos`, `_automacoes/admin`.

## Notas de implementação (servidor)
- **ACL por aparelho**: em vez de `domus/C/+/+/set`, o ficheiro gerado dá a cada cliente `domus/C/<id>/+/set`, `/rpc`, `/command`, `/command/+` para cada aparelho seu, mais a lista fixa de pedidos ao motor. Assim `+` nunca apanha caminhos dentro das áreas reservadas (ex. `_automacoes/admin/set`), e remover um aparelho retira também a permissão de o comandar (131 testes num Mosquitto real).
- **§4 corrigido**: no OpenBeken não existem `linkChannel`/`SetButtonEvents`; o botão físico → relé local faz-se com os papéis de pino **Relay** e **Button** no mesmo canal. `divisao` é emitida por canal (herdada de `--divisao`), não ao nível do aparelho.

## Correções após a revisão cruzada (27/09/2026)
- **Contador geral**: aparelho com `"geral": true` (ao nível do aparelho, só com `medidor`; `domus.sh … --medidor --geral`). Se existir algum, o consumo total da casa (app, site e `_energia`) soma **só** os contadores gerais; se não, soma todos os medidores.
- **Canais**: números de 1 a 64 em todos os componentes.
- **Limites comuns** (validados no motor e repetidos na app e no site com mensagens simples): nome ≤ 80, mensagem ≤ 200, durações ≤ 24 h (`durante_s` ≤ 86 400), `entre` com horas diferentes, `se.aparelhos` ≤ 10, SE com pelo menos uma ação em ENTÃO, ≤ 20 ações e 2 níveis de SE.
- **Última notícia de um aparelho**: a fonte é `_saude[id].ultima_noticia`; no histórico só contam eventos `sensor`/`alarme` (os avisos do motor sobre um aparelho **não** são sinal de vida).
- **Registo**: "Avaliar agora" fica só em `ultimos` (resultado `avaliacao`) e não altera `ultima`/`resultado`.
- **Tamanho das mensagens**: `max_packet_size` 1 MB no Mosquitto; o motor nunca publica mensagens acima do limite (o `registo` é encurtado).
- **Mudança de hora (março)**: gatilhos de hora dentro da hora que não existe disparam uma vez no primeiro minuto depois do salto.
