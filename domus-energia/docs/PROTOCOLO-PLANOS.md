# Planos, subscrições e pagamentos — contrato (v4)

Base: `docs/MONETIZACAO.md` (decisões do dono). Estende o protocolo v3 sem o partir.

## 1. Planos
| Plano (`id`) | Preço c/ IVA | Inclui |
|---|---|---|
| `base` | 4,99 €/mês | App e área de cliente, controlo à distância, automações, cenas, histórico, relatório da casa |
| `conforto` | 9,99 €/mês | Base + **modos Fora/Noite/Férias e alarme**, **notificações** (ntfy/Firebase), **saúde dos aparelhos**, **energia** (hoje/ontem/mês), relatório diário |
| `premium` | 19,99 €/mês | Conforto + Raspberry Pi em casa (fase futura), suporte prioritário |

Funcionalidades por plano (tabela única usada por motor, site e app):
| Funcionalidade (`chave`) | base | conforto | premium |
|---|---|---|---|
| `controlo`, `automacoes`, `cenas`, `historico`, `relatorio` | ✓ | ✓ | ✓ |
| `alarme` (modos fora/noite/ferias; `casa` sempre permitido) | ✗ | ✓ | ✓ |
| `notificacoes` (push ntfy/FCM; eventos continuam no histórico) | ✗ | ✓ | ✓ |
| `saude`, `energia`, `relatorio_diario` | ✗ | ✓ | ✓ |
| `local` (Raspberry Pi), `suporte_prioritario` | ✗ | ✗ | ✓ |

## 2. Estado da subscrição — `domus/<c>/_plano` (retido)
Publicado pelo servidor (serviço `pagamentos` ou `domus.sh plano`), nunca pelo cliente:
```json
{"plano": "conforto", "estado": "ativo", "desde": "2026-10-01T10:00:00Z",
 "proximo_pagamento": "2026-11-01T10:00:00Z", "aviso_ate": null, "gerido": "stripe"}
```
- `estado`: `ativo` | `teste` (1.º mês grátis) | `em_atraso` (pagamento falhou; **15 dias** de aviso até `aviso_ate`) | `suspenso` (modo básico) | `cancelado`.
- `gerido`: `stripe` (cobrança automática) ou `manual` (empresa gere à mão).
- Sem `_plano` retido → tratar como `{"plano":"conforto","estado":"ativo","gerido":"manual"}` (clientes antigos não perdem nada).

## 3. Efeitos
- `ativo`, `teste`, `em_atraso`: funcionalidades do plano. Em `em_atraso` a app e o site mostram um aviso com a data `aviso_ate` e o botão "Atualizar pagamento".
- `suspenso` / `cancelado` = **modo básico**: os interruptores físicos continuam a funcionar (regra nos aparelhos); o motor **não executa** automações, cenas, alarme nem notificações para esse cliente (modo fica `casa`); o **servidor retira ao cliente as permissões de escrita** (ACL só de leitura do próprio `_plano`, para a app mostrar o ecrã "Subscrição suspensa"); a app/site mostram apenas esse ecrã com "Reativar subscrição".
- Funcionalidade fora do plano pedida por um cliente (ex.: `_modo/set` `fora` no plano base) → motor responde com `_eventos` tipo `erro`: "Disponível a partir do plano Conforto." e não muda nada. App e site mostram a funcionalidade bloqueada com um cadeado e "Disponível no plano Conforto — mudar de plano".
- Descida de plano com alarme armado → motor passa a `casa` e regista evento `modo` com `por: "plano"`.

## 4. Serviço `pagamentos` (servidor)
Node.js, atrás do Caddy em `https://HOST/api/`:
- `POST /api/sessao` `{codigo, password}` → verifica as credenciais **tentando uma ligação MQTT ao broker local com esse utilizador** (não há outra base de dados de utilizadores) → devolve um token de sessão curto (JWT HMAC, 15 min) só para o `/api`.
- `POST /api/checkout` (token) `{plano}` → cria uma Stripe Checkout Session (modo `subscription`, `price` do plano, `metadata.cliente`, cartão + MB WAY quando disponível para subscrições; se não, só cartão — documentar), devolve `{url}`.
- `POST /api/portal` (token) → Stripe Customer Portal `{url}` (mudar plano, cartão, cancelar, faturas).
- `POST /stripe/webhook` → valida a assinatura (`STRIPE_WEBHOOK_SECRET`), trata `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` → atualiza `dados/planos/<c>.json` e publica `_plano` (retido) como utilizador `pagamentos` (ACL: escreve só `domus/+/_plano`).
- Tarefa diária: `em_atraso` com `aviso_ate` ultrapassado → `suspenso`.
- Variáveis: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASE|CONFORTO|PREMIUM`, `PUBLIC_URL`, `SESSAO_SEGREDO`, credenciais MQTT `pagamentos`.
- **Permissões (ACL) de suspensos**: o `domus.sh sincronizar-planos` (corrido por um temporizador systemd/cron a cada minuto no VPS) lê `dados/planos/*.json`, regenera a ACL (suspenso → só leitura de `domus/<c>/_plano`) e recarrega o Mosquitto. `domus.sh plano <cliente> <base|conforto|premium> [--estado ativo|suspenso|…]` para gestão manual.

## 5. Faturação (obrigação legal em Portugal)
As faturas do Stripe **não são faturas certificadas pela AT**. Cada pagamento tem de gerar uma fatura-recibo num **programa de faturação certificado** (ex.: InvoiceXpress, Moloni, Vendus, TOConline). Nesta fase: o serviço regista cada `invoice.paid` em `servidor/dados/pagamentos/pagamentos.csv` (o contentor só monta `dados/planos` e `dados/pagamentos`, nunca a pasta com as palavras-passe) (data, cliente, plano, valor com e sem IVA, id Stripe) para o contabilista/emissão; integração automática com o programa certificado fica para a fase seguinte (depende do programa que o contabilista usar).

## 6. Site e app
- Site público: secção **"Planos e preços"** (3 cartões, o que inclui cada um, 1.º mês grátis, sem fidelização, "Pedir orçamento"); menu para telemóvel.
- Área de cliente e app: ecrã **"A minha subscrição"** (plano, estado, próximo pagamento, "Mudar de plano" → checkout, "Gerir pagamentos e faturas" → portal, aviso de atraso), funcionalidades bloqueadas com cadeado, ecrã de suspensão.
