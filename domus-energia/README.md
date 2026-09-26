# ⚡ Domus Energia

Eletricidade e automação em todo o país. Este repositório tem três partes:

| Pasta | O que é |
|---|---|
| `web/` | Site público (serviços, contactos, WhatsApp, pedido de orçamento) e **área de cliente** (`cliente.html`) para controlar os circuitos no browser |
| `android/` | App Android (Kotlin + Jetpack Compose) com login de cliente para ligar e desligar circuitos e ver o consumo |
| `supabase/` | Base de dados, logins e a função `tuya`, que fala com os disjuntores |

```
App Android ─┐                         ┌─> Tuya Cloud ─> disjuntor Wi-Fi
             ├─> Supabase (login + função "tuya") ─┤
Site/cliente ┘                         └─ a chave secreta da Tuya só existe aqui
```

## Como funciona a Smart Life
O disjuntor liga-se por Wi-Fi à **cloud da Tuya** e a app Smart Life envia-lhe os comandos através dessa cloud.
O nosso sistema usa a **API oficial da Tuya** e fala com a mesma cloud. Os aparelhos continuam emparelhados na Smart Life, e é a partir dessa conta que a Domus Energia os gere.

---

## 1. Tuya IoT Platform (uma vez)
1. Emparelha os disjuntores na app **Smart Life**, usando uma conta da empresa.
2. Cria uma conta em https://platform.tuya.com, abre **Cloud → Development → Create Cloud Project** e escolhe o Data Center **Central Europe**. Ativa as APIs *IoT Core* e *Authorization*.
3. No projeto, abre **Devices → Link App Account** e lê o QR code com a Smart Life (em "Eu", no ícone de leitura).
4. Aponta os seguintes dados:
   - **Access ID** e **Access Secret**, que estão em *Overview*
   - o **Device ID** de cada disjuntor, que aparece em *Devices*

## 2. Supabase
1. Cria um projeto em https://supabase.com, na região **Europa**.
2. Abre **SQL Editor**, cola o conteúdo de `supabase/migrations/20260926000000_init.sql` e carrega em *Run*.
3. Instala a CLI do Supabase e publica a função:
   ```bash
   supabase login
   supabase link --project-ref <ref-do-projeto>
   supabase secrets set TUYA_ACCESS_ID=... TUYA_ACCESS_SECRET=... TUYA_ENDPOINT=https://openapi.tuyaeu.com
   supabase functions deploy tuya
   ```
4. Em **Authentication → Providers → Email**, desliga *Allow new users to sign up*. Assim só a empresa cria as contas dos clientes.

### Adicionar um cliente
1. Abre **Authentication → Users → Add user**, com o email e a palavra-passe do cliente.
2. Em **Table editor → aparelhos**, cria uma linha por disjuntor com os campos:
   - `user_id` (o id do cliente)
   - `device_id` (o Device ID da Tuya)
   - `nome` (por exemplo "Cozinha" ou "Ar condicionado")

### Ver pedidos de orçamento
Os pedidos ficam em **Table editor → pedidos_orcamento**.

## 3. Site (`web/`)
1. Edita `web/config.js` e preenche:
   - o URL do Supabase e a *anon key*
   - o número de WhatsApp, o telefone e o email
2. Publica a pasta `web/` gratuitamente no **Netlify**, na **Vercel** ou no **Cloudflare Pages** (basta arrastar a pasta).
3. Para testar no computador: `cd web && python3 -m http.server 8000` e abre http://localhost:8000.

## 4. App Android (`android/`)
1. Em `android/app/build.gradle.kts`, preenche `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
2. Abre a pasta `android/` no **Android Studio**, espera pela sincronização do Gradle e carrega em ▶ com o telemóvel ligado por USB.
3. Entra com a conta de um cliente criada no Supabase.

## Segurança
- A chave secreta da Tuya **nunca** vai para o telemóvel nem para o browser.
- Cada cliente só vê e controla os aparelhos que lhe atribuíste (*Row Level Security* e validação na função `tuya`).
- A função só aceita comandos de ligar e desligar (`switch*`).

## Próximos passos
- Horários e cenas ("Sair de casa", "Noite")
- Alertas de consumo anormal e de disjuntor disparado
- Histórico de consumo (kWh por dia e por mês)
- Painel da empresa para gerir clientes sem entrar no Supabase
