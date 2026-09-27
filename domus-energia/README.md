# ⚡ Domus Energia

Eletricidade e automação para casas em todo o país. A Domus Energia instala disjuntores, interruptores e sensores Wi-Fi e o cliente controla a casa na **app Android** e na **área de cliente** do site: circuitos, consumo, alarme, cenas, automações e notificações. Cada cliente paga um plano mensal (Base, Conforto ou Premium), e a equipa trabalha num **painel da empresa**.

Tudo corre num **servidor próprio**, sem clouds de terceiros. Os aparelhos (Chayo/Tongou e outros Tuya reprogramados com **OpenBeken**, e **Shelly**) falam MQTT diretamente com o nosso servidor.

## Arquitetura

```
                                        VPS (docker compose)
                                   +-------------------------------+
Aparelhos (OpenBeken, Shelly) ---->| Mosquitto   MQTT + ACL        |
   MQTT, porta 1883                |   ^                           |
                                   |   | wss://HOST/mqtt           |
App Android ----+                  | Caddy       HTTPS automático  |
Site / cliente -+-- HTTPS 443 ---->|   |-> motor       alarme,     |
Painel ---------+                  |   |             automações    |
Stripe (webhook) ----------------->|   |-> pagamentos  planos      |
                                   |   |-> painel      equipa      |
Telemóvel (app ntfy) <-------------|   '-> ntfy        avisos      |
                                   | domus.sh + temporizadores     |
                                   +-------------------------------+
```

- **Mosquitto**: cada cliente e cada aparelho tem utilizador próprio; a ACL só deixa cada um ver a sua casa.
- **motor**: alarme, automações, cenas, histórico, energia e notificações (ntfy e, opcionalmente, Firebase).
- **pagamentos**: subscrições no Stripe; publica o estado do plano de cada cliente.
- **painel**: painel interno (`/painel/`) e formulário público de orçamento. Não tem as palavras-passe do servidor: pede alterações por ficheiros que o `domus.sh` valida e executa (temporizador a cada 5 s).
- **Caddy**: HTTPS automático, site, `wss://HOST/mqtt` e encaminhamento para os serviços.

## Pastas

| Pasta | O que é |
|---|---|
| `servidor/` | `docker-compose.yml`, Caddy, Mosquitto, `domus.sh` (gestão de clientes e aparelhos), `instalar.sh` e temporizadores systemd |
| `motor/` | serviço de alarme, automações e notificações (Node) |
| `pagamentos/` | serviço de subscrições com Stripe (Node) |
| `painel/` | painel da empresa e API de orçamentos (Node + SQLite) |
| `web/` | site público, área de cliente e simulador de orçamento |
| `android/` | app Android (Kotlin + Jetpack Compose) |
| `local/` | arranque de tudo no computador, sem Docker, para desenvolver |
| `docs/` | protocolos MQTT, planos, painel, segurança e funcionalidades |
| `negocio/` | plano de negócio, apresentação e fornecedores |

## Como começar

### 1. No computador (desenvolvimento)
```bash
cd domus-energia/local
npm run instalar   # só da primeira vez
npm start          # http://localhost:8080/
```
Detalhes: [`local/README.md`](local/README.md).

### 2. No servidor (VPS), com um comando
Num VPS com Ubuntu 22.04/24.04 ou Debian 12:
```bash
curl -fsSL https://raw.githubusercontent.com/ruibraganca2014-coder/marketing-saas/claude/kind-babbage-gdmaij/domus-energia/servidor/instalar.sh \
  | sudo bash -s -- --email o-seu-email@exemplo.pt
```
Instala o Docker, gera as palavras-passe, arranca tudo com HTTPS em `<ip-com-hífenes>.sslip.io` e mostra no fim os endereços e a palavra-passe do CEO do painel. Para atualizar: `sudo bash /opt/domus/domus-energia/servidor/instalar.sh --atualizar`. Guia completo (e instalação manual): [`servidor/README.md`](servidor/README.md).

### 3. App Android
Em `android/app/build.gradle.kts` põe `MQTT_HOST` igual ao `DOMUS_HOST` do servidor, abre `android/` no Android Studio e carrega em ▶. O cliente entra com o código e a palavra-passe criados no painel (ou com `./domus.sh cliente`). Detalhes: [`android/README.md`](android/README.md).
