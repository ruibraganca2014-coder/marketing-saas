# Serviço de pagamentos da Domus Energia

Serviço Node.js 20 (ESM) que trata das **subscrições mensais** (Stripe) e publica o estado de cada cliente em `domus/<cliente>/_plano` (retido). Contrato: [`../docs/PROTOCOLO-PLANOS.md`](../docs/PROTOCOLO-PLANOS.md) §2–§5. Instalação e configuração do Stripe: [`../servidor/README.md`](../servidor/README.md), secção **"Planos e pagamentos"**.

Dependências: só o SDK oficial `stripe` e `mqtt`. O token de sessão (JWT HS256) é feito com `node:crypto`.

## Endpoints (atrás do Caddy, mesma origem do site)

Todos respondem JSON; os erros são `{"erro": "mensagem em pt-PT"}`. Pedidos do `/api` têm de ser `Content-Type: application/json`, com no máximo 4 KB, e um campo desconhecido é erro 400.

| Pedido | Corpo | Resposta |
|---|---|---|
| `POST /api/sessao` | `{"codigo","password"}` | `200 {"token","cliente","expira"}` — token válido 15 min, só para o `/api`. `401` código/palavra-passe errados (a mesma mensagem para aparelhos e utilizadores internos); `429` + `Retry-After` depois de 5 tentativas por minuto **por IP ou por código**; `503` broker indisponível |
| `POST /api/checkout` | `{"plano":"base"\|"conforto"\|"premium"}` + `Authorization: Bearer <token>` | `200 {"url"}` (Stripe Checkout) ou `200 {"url","portal":true}` (ver abaixo); `401` sem token válido; `400` plano inválido |
| `POST /api/portal` | `{}` + `Authorization: Bearer <token>` | `200 {"url"}` (Stripe Customer Portal); `409` se o cliente ainda não tem pagamentos no Stripe |
| `POST /stripe/webhook` | evento do Stripe (corpo tal como chega) | `200` tratado/repetido/ignorado; `400` assinatura inválida; `500` erro temporário (o Stripe repete) |

**Verificação das credenciais** (`/api/sessao`): não há outra base de dados de utilizadores — o serviço liga-se ao Mosquitto **com o código e a palavra-passe do cliente** e confirma que esse utilizador lê `domus/<c>/_aparelhos` ou `domus/<c>/_plano` (só um cliente os lê; um aparelho como `joao-sala` não). `admin`, `motor` e `pagamentos` são sempre recusados. As palavras-passe nunca são registadas.

**Checkout sem subscrições duplicadas**: se o cliente já tem uma subscrição no Stripe que não terminou (`active`, `trialing`, `past_due`, `unpaid`, `paused`, `incomplete`), o `/api/checkout` **não** cria outra: devolve `{"url", "portal": true}` de uma sessão do Customer Portal —
- subscrição ativa/em teste e outro plano → fluxo `subscription_update_confirm` já com o preço escolhido; se o portal não tiver a mudança de plano ligada, `subscription_update` e, por fim, a página inicial do portal;
- em atraso, suspensa, com cancelamento marcado, ou o mesmo plano → página inicial do portal (pagar a fatura em atraso, trocar o cartão, renovar).

Só um cliente sem subscrição viva (nenhuma, `canceled`, `incomplete_expired` ou apagada) recebe uma nova Checkout Session, sempre com o **mesmo cliente Stripe** (`customer`) guardado em `dados/planos/<c>.json`. O **1.º mês grátis** (`trial_period_days`, `DIAS_TESTE`, 30 por omissão) só é dado a quem nunca teve período de teste.

URLs de regresso: `PUBLIC_URL/cliente.html?subscricao=ok` (sucesso), `?subscricao=cancelada` (desistiu) e `PUBLIC_URL/cliente.html` (portal).

## Eventos do Stripe → `_plano`

A assinatura (`Stripe-Signature`, `STRIPE_WEBHOOK_SECRET`) é verificada sobre o corpo em bruto. Cada evento é tratado **uma só vez** (ids guardados em `eventos-stripe.json`), um de cada vez, e o estado da subscrição é **sempre pedido ao Stripe** (`subscriptions.retrieve`), por isso eventos fora de ordem ou repetidos não estragam nada.

| Evento | Efeito |
|---|---|
| `checkout.session.completed` | guarda o cliente e a subscrição Stripe; `teste` (em período grátis) ou `ativo` |
| `customer.subscription.created` / `updated` | estado conforme a subscrição: `trialing`→`teste`, `active`→`ativo`, `past_due`/`unpaid`→`em_atraso`, `paused`→`suspenso`, `canceled`→`cancelado`; muda o plano se o preço mudou |
| `invoice.payment_failed` | `em_atraso` com `aviso_ate` = agora + **15 dias** (falhas seguintes não prolongam o aviso) |
| `invoice.paid` (valor > 0) | `ativo` e uma linha em `pagamentos.csv` |
| `customer.subscription.deleted` | `cancelado` |

- **Tarefa diária** (corre no arranque e de hora a hora): `em_atraso` com `aviso_ate` ultrapassado → `suspenso`. Um cliente suspenso que continue sem pagar fica suspenso; ao pagar volta a `ativo`.
- `desde` = quando mudou o plano ou o estado. `proximo_pagamento` = fim do período (ou do teste); `null` se o cancelamento está marcado ou em modo básico.
- Clientes com `"gerido": "manual"` (`./domus.sh plano`) não são alterados pelos eventos do Stripe, exceto por um novo checkout concluído. Os pagamentos continuam a ir para o CSV.
- O `_plano` é publicado (retido, QoS 1, utilizador MQTT `pagamentos`) em cada mudança e **republicado para todos** no arranque e sempre que a ligação ao Mosquitto volta.

### Ficheiros

- `dados/planos/<c>.json` — uma linha JSON (escrita atómica), partilhada com o `domus.sh`:
  `{"plano","estado","desde","proximo_pagamento","aviso_ate","gerido","stripe_cliente","stripe_subscricao","teste_usado","atualizado"}`. Os seis primeiros são exatamente o `_plano`.
- `pagamentos.csv` — separador `;`, decimais com vírgula (abre diretamente no Excel em português):
  `data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe` → `2026-11-01;joao;conforto;9,99;8,12;in_…`. Data em Lisboa; sem IVA = com IVA / 1,23 (arredondado ao cêntimo). **Não é uma fatura**: serve ao contabilista para emitir a fatura-recibo num programa certificado (ver `PROTOCOLO-PLANOS.md` §5). Reembolsos e notas de crédito não são registados aqui.
- `eventos-stripe.json` — ids dos últimos 10 000 eventos tratados.

No Docker (ver `servidor/docker-compose.yml`) montam-se só `servidor/dados/planos` e `servidor/dados/pagamentos` (nunca a pasta `dados/` inteira, que tem a palavra-passe do admin): o CSV fica em **`servidor/dados/pagamentos/pagamentos.csv`**.

## Variáveis de ambiente

| Variável | Por omissão | |
|---|---|---|
| `PAGAMENTOS_MQTT_PASS` (ou `MQTT_PASS`) | — | palavra-passe do utilizador MQTT `pagamentos` |
| `MQTT_URL`, `MQTT_USER` | `mqtt://mosquitto:1883`, `pagamentos` | |
| `SESSAO_SEGREDO` | — | ≥ 32 caracteres (`openssl rand -hex 32`) |
| `PUBLIC_URL` | `https://$DOMUS_HOST` | endereço do site |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | — | `sk_…`/`rk_…`, `whsec_…` |
| `STRIPE_PRICE_BASE`, `_CONFORTO`, `_PREMIUM` | — | `price_…` mensais, com IVA incluído |
| `STRIPE_METODOS` | `card` | lista (`card,sepa_debit`) ou `automatico` (os métodos ativos no painel) |
| `DIAS_TESTE` | `30` | 0 = sem período grátis |
| `DIAS_AVISO` | `15` | dias de `em_atraso` antes de suspender |
| `SESSAO_MIN`, `LIMITE_SESSAO` | `15`, `5` | duração do token; tentativas de sessão por minuto |
| `CONFIAR_PROXY` | — | `1` atrás do Caddy (usa o `X-Forwarded-For`) |
| `CAMINHO_CLIENTE` | `/cliente.html` | página de regresso |
| `DADOS_DIR`, `PLANOS_DIR`, `PAGAMENTOS_CSV`, `EVENTOS_FICH` | `/dados`, `$DADOS_DIR/planos`, `$DADOS_DIR/pagamentos.csv`, `$DADOS_DIR/eventos-stripe.json` | |
| `PORTA`, `VERIFICAR_MIN` | `8080`, `60` | |

Sem MQTT/segredo/URL o serviço responde `503` a tudo; sem a configuração do Stripe, a sessão e o `_plano` funcionam e checkout/portal/webhook respondem `503 "Os pagamentos ainda não estão configurados neste servidor."` — nunca impede o resto do servidor de arrancar.

## Testes

```bash
cd pagamentos
npm ci
npm test
```

Precisam do **Mosquitto 2** instalado (`sudo apt-get install -y mosquitto`; usa `/usr/sbin/mosquitto` ou a variável `MOSQUITTO`). Os testes de integração arrancam um Mosquitto temporário com o `passwd` e a `acl` gerados pelo próprio `../servidor/domus.sh` e um **Stripe falso ao nível HTTP** (o SDK oficial aponta para ele com `host`/`port`/`protocol`); as assinaturas dos webhooks são geradas com `stripe.webhooks.generateTestHeaderString`. Não se fazem chamadas reais ao Stripe.
