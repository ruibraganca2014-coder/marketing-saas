# Monetização — decisões do dono

| Tema | Decisão |
|---|---|
| Modelo | Instalação + aparelhos (pagamento único) **+ mensalidade** |
| Planos (c/ IVA) | **Base 4,99 €** (app, controlo, automações, cenas, histórico) · **Conforto 9,99 €** (+ modos e alarme, notificações, relatórios de energia, saúde) · **Segurança Premium 19,99 €** (+ Raspberry Pi 4/5 em casa: funciona sem internet, sirene, suporte prioritário) |
| Kits de instalação (s/ IVA, proposta) | Essencial 390 € · Conforto 890 € · Segurança Premium 1 490 € |
| Cobrança | **Stripe** (cartão + MB WAY), cobrança mensal automática, área "A minha subscrição" |
| Sem pagamento | Aviso durante 15 dias → **modo básico**: interruptores físicos continuam; perde app, automações e alarme |

## Impacto no sistema (a implementar depois da fase 3)
- Retido por cliente, publicado pelo servidor/admin: `domus/<c>/_plano` = `{"plano":"base"|"conforto"|"premium","estado":"ativo"|"em_atraso"|"suspenso","ate":"...Z"}`.
- Motor: funcionalidades por plano (alarme/modos/notificações só Conforto+; relatório diário Conforto+); `suspenso` → não executa automações nem alarme, deixa só os estados.
- Servidor: pequeno serviço de webhooks Stripe (checkout, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`) que atualiza `_plano`; `domus.sh plano <cliente> <plano>` para gestão manual.
- Site: página pública **Planos e preços** + botão "Subscrever" (Stripe Checkout); área de cliente "A minha subscrição" (Stripe Customer Portal).
- App/site: mostrar funcionalidades bloqueadas com "Disponível no plano Conforto" e aviso de pagamento em atraso.
- Plano Premium: imagem para Raspberry Pi com Mosquitto + motor locais em ponte com o VPS (a desenhar).
