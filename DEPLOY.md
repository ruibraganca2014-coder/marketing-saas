# Deploy - MarketingSaaS

## Opcao 1: Railway (Recomendado)

### Via GitHub:
1. Criar repo no GitHub e fazer push:
   ```bash
   gh repo create marketing-saas --public --source=. --push
   ```

2. Ir a https://railway.app/new
3. Clicar "GitHub Repository" e selecionar o repo
4. Railway deteta automaticamente Next.js e configura o build
5. Adicionar variaveis de ambiente em Settings > Variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://cgrlmqqvdynghrpapbbm.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-key>
   WEBHOOK_SECRET=<generate-random-secret>
   ```
6. Clicar "Deploy"
7. Gerar dominio em Settings > Domains

### Via Railway CLI:
```bash
railway login
railway init
railway up
```

## Opcao 2: Docker (Qualquer VPS)

```bash
docker build -t marketing-saas .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://cgrlmqqvdynghrpapbbm.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> \
  marketing-saas
```

## Opcao 3: Vercel

```bash
npx vercel
# Seguir o wizard interativo
# Adicionar env vars no dashboard Vercel
```

## Opcao 4: Render

1. Criar conta em https://render.com
2. New > Web Service > Connect GitHub repo
3. Build Command: `npm run build`
4. Start Command: `npm run start`
5. Adicionar env vars
6. Deploy

## Variaveis de Ambiente Necessarias

| Variavel | Obrigatoria | Descricao |
|----------|-------------|-----------|
| NEXT_PUBLIC_SUPABASE_URL | Sim | URL do projeto Supabase |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Sim | Chave anon do Supabase |
| SUPABASE_SERVICE_ROLE_KEY | Opcional | Para webhooks com acesso admin |
| OPENAI_API_KEY | Opcional | Para AI Copilot real (sem ela usa fallback) |
| WEBHOOK_SECRET | Opcional | Secret para autenticar webhooks |
