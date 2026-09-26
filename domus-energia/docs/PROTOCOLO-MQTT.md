# Protocolo MQTT da Domus Energia

Sistema 100% próprio, sem a cloud da Tuya. Um servidor MQTT (Mosquitto) num VPS; os aparelhos, a app Android e o site ligam-se todos a ele.

```
Disjuntor Chayo/Tongou (OpenBeken) ─┐  MQTT 1883
Shelly (Gen2/Gen3)                  ─┤
                                     ├── Mosquitto (VPS) ── WSS 443 (Caddy) ── App Android + área de cliente web
```

## Ligações
| Quem | Como | Endereço |
|---|---|---|
| Aparelhos (OpenBeken, Shelly) | MQTT simples, porta **1883**, utilizador/palavra-passe próprios do aparelho | `HOST:1883` |
| App e site | MQTT sobre **WebSocket seguro**, porta **443**, caminho `/mqtt` | `wss://HOST/mqtt` |

`HOST` é o domínio do servidor (ex.: `mqtt.domusenergia.pt`) ou, sem domínio, `<ip-com-hifens>.sslip.io` (ex.: `51-38-10-20.sslip.io`).

## Contas
- **Cliente**: utilizador MQTT = código do cliente (ex.: `joao`), só letras minúsculas, dígitos e `-`. É o login da app e do site.
- **Aparelho**: utilizador MQTT = `<cliente>-<aparelho>` (ex.: `joao-cozinha`).

## Tópicos
Tudo fica debaixo de `domus/<cliente>/`. Cada aparelho tem um id (`[a-z0-9-]+`) e o seu prefixo é `domus/<cliente>/<aparelho>`.

### Lista de aparelhos (retida)
`domus/<cliente>/_aparelhos` — mensagem **retida**, publicada pelo script de administração:
```json
[
  {"id": "cozinha", "nome": "Cozinha", "tipo": "openbeken"},
  {"id": "ac-sala", "nome": "Ar condicionado sala", "tipo": "shelly"}
]
```

### Aparelho `tipo: "openbeken"` (Chayo/Tongou TO-Q-SY1-JWT reprogramado)
No OpenBeken: *Config → MQTT*: Host, Port 1883, Client Topic = `domus/<cliente>/<aparelho>`, Group Topic vazio, utilizador/palavra-passe do aparelho.

| Tópico (a partir do prefixo) | Sentido | Conteúdo |
|---|---|---|
| `connected` | aparelho → | `online` / `offline` (LWT, retido) |
| `1/get` | aparelho → | `1` ligado / `0` desligado |
| `1/set` | → aparelho | `1` ligar / `0` desligar |
| `power/get` | aparelho → | potência em W (texto numérico, ex. `123.4`) |
| `voltage/get` | aparelho → | tensão em V |
| `current/get` | aparelho → | corrente em A |
| `energycounter/get` | aparelho → | energia acumulada em Wh |

### Aparelho `tipo: "shelly"` (Gen2/Gen3, ex. Shelly 1PM Gen3, Pro 1PM)
Na app/UI web do Shelly: *Settings → MQTT*: ativar, Server `HOST:1883`, Client ID = `<cliente>-<aparelho>`, Username/Password do aparelho, **MQTT prefix** = `domus/<cliente>/<aparelho>`, ativar *Generic status update over MQTT*.

| Tópico (a partir do prefixo) | Sentido | Conteúdo |
|---|---|---|
| `online` | aparelho → | `true` / `false` (retido) |
| `status/switch:0` | aparelho → | JSON: `{"output": true, "apower": 12.3, "voltage": 230.1, "current": 0.05, "aenergy": {"total": 1234.5}}` (energia em Wh) |
| `command/switch:0` | → aparelho | `on` / `off` / `toggle` |
| `command` | → aparelho | `status_update` pede ao Shelly que republique o estado |

## Permissões (ACL do Mosquitto)
- Cliente `C`: **ler** `domus/C/#`; **escrever** só `domus/C/+/1/set`, `domus/C/+/command/switch:0` e `domus/C/+/command`.
- Aparelho `C-A`: **ler e escrever** `domus/C/A/#`.
- Administrador `admin`: tudo (usado pelo script para publicar `_aparelhos`).
- Ninguém anónimo.

## Modelo normalizado usado pela app e pelo site
```
Aparelho { id, nome, tipo, online: bool, ligado: bool?, potenciaW: double?, tensaoV: double?, correnteA: double?, energiaKWh: double? }
```
Ligar/desligar: openbeken → publicar `1`/`0` em `<prefixo>/1/set`; shelly → publicar `on`/`off` em `<prefixo>/command/switch:0`.
Depois de ligar, pedir estado aos Shelly publicando `status_update` em `<prefixo>/command`.
