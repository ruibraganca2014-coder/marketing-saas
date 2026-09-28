# Conta de cliente

A conta do cliente serve para enviar o pedido do simulador, acompanhá-lo e, depois da instalação, entrar na área de cliente da casa. As rotas `/api/conta/*` são servidas pelo **painel** (`painel/src/conta.js`); as páginas são `web/conta.html`, o passo 7 do simulador e o "Entrar com email" de `web/cliente.html`.

## Decisões do dono

1. **A conta é obrigatória para enviar a simulação.** No passo 7 ("Enviar") aparece antes do contacto: "Criar conta" (email, palavra-passe e confirmação) ou "Já tenho conta — entrar". Com a sessão aberta mostra "Entrou como x@y · Sair". O email da conta preenche e fixa o email do contacto. Nome, telefone, morada e localidade (concelho, com as sugestões dos 308 concelhos) ficam no contacto e são guardados no perfil da conta quando o pedido é enviado.
2. **Email e palavra-passe**, com as regras do painel (`senhas.js`: scrypt, pelo menos 10 caracteres). O email é confirmado com um **código de 6 dígitos**, que vale 15 minutos e aceita 5 tentativas. Sem email confirmado não se pode enviar. O "Esqueci a palavra-passe" manda um código de uso único (15 min) e responde sempre o mesmo, exista ou não a conta.
3. **A conta** (`conta.html`) mostra:
   - o estado do pedido (recebido → visita → proposta → aceite → instalação), feito a partir dos estados reais do painel;
   - a simulação enviada, num resumo simples (sem a parte técnica);
   - as fotos. Pode acrescentar ou trocar fotos enquanto o pedido não estiver aceite nem convertido; usa as mesmas validações de `fotos.js`.
   - a **simulação por acabar**, que se retoma noutro aparelho (ver abaixo);
   - a **proposta** (valor + IVA e o texto do painel), com o botão "Aceito a proposta". Não há pagamento. A data, a hora e o IP ficam na auditoria e o estado passa a `aceite`. No histórico do painel aparece "Proposta aceite pelo cliente (online)" e o início do painel mostra a lista "Propostas aceites online". Se a proposta já estiver aceite ou convertida, o pedido dá 409.
4. **A mesma conta abre a área da casa.** Depois de o painel converter o pedido, o `cliente.html` entra por omissão com "Entrar com email"; "Entrar com o código de cliente" continua disponível.
5. **Vercel.** As páginas públicas podem estar no Vercel e o painel no VPS (ver "Site noutro endereço").

## Guardar e retomar a simulação

Com a sessão aberta, o simulador guarda o estado na conta sempre que se muda de passo e quando o cliente entra no passo 7 (`POST /api/conta/simulacao`, até 1,5 MB; se não couber, vai sem a imagem de fundo).

Ao abrir o simulador com sessão, se a conta tiver uma simulação mais recente do que a deste navegador, aparece "Continuar a simulação da sua conta?". **As fotos ainda por enviar ficam só no navegador onde foram tiradas** (IndexedDB), e o aviso diz isso.

A cópia da conta é apagada quando o pedido é enviado, em "Começar de novo" e ao fim de 12 meses.

## Área de cliente com o email (credenciais MQTT)

O desenho escolhido é o mais simples que não obriga a mudar o `domus.sh` nem os pedidos-admin:

1. Ao converter um pedido que tem conta, o painel cria o pedido-admin `cliente`, como já fazia.
2. O `domus.sh` escreve o resultado com a palavra-passe MQTT gerada (já o fazia, para a mostrar uma vez ao CEO).
3. Quando o painel lê esse resultado (`pedidos.js` → `conta.js aoResultadoPedido`), guarda na conta o código do cliente e a palavra-passe **cifrada com AES-256-GCM** usando a `CONTA_CHAVE` do `.env`. A palavra-passe nunca vai para a auditoria nem para o registo.
4. `GET /api/conta/casa` só responde à própria conta, com o email confirmado e uma sessão válida (limite de 30 pedidos por hora). Devolve `{codigo, password}`, e o `cliente.js` liga-se ao MQTT como se o cliente tivesse escrito o código.

Riscos e limites:

- Quem tiver a base do painel **e** a `CONTA_CHAVE` consegue ler as palavras-passe MQTT das casas. Guarde o `.env` fora das cópias da base, ou em separado. O painel já tinha acesso de leitura ao MQTT; esta é a única credencial de escrita que guarda.
- Se a `CONTA_CHAVE` mudar, as credenciais guardadas deixam de se ler e o cliente passa a entrar com o código.
- Se a palavra-passe MQTT for mudada no servidor (`./domus.sh cliente <c>` de novo), a conta fica com a antiga até haver outra conversão. Nesse caso o cliente entra com o código.
- Sem `CONTA_CHAVE` fica guardado só o código, e a conta diz ao cliente para entrar com o código.
- Um cliente que já existia antes da conta (conversão com `cliente_existia`) não fica ligado: entra com o código.

## Segurança

- A sessão usa o cookie `domus_conta`, diferente do cookie do painel: `HttpOnly; SameSite=Lax; Path=/api`, com `Secure` fora de localhost. Na base de dados só fica o SHA-256 do cookie. A sessão dura 7 dias sem uso e no máximo 30 dias. Mudar a palavra-passe fecha todas as sessões.
- **Uma conta de cliente não abre nenhuma rota `/painel/api/`** (as sessões são separadas), e cada conta só vê os seus pedidos: os pedidos de outras contas dão 404.
- As origens são verificadas (CSRF) como no resto do painel: `Origin`/`Sec-Fetch-Site` em todos os POST.
- Há limites por IP e por email em criar, entrar, código, reenviar e esqueci. Ao fim de 10 falhas seguidas a entrar, a conta fica bloqueada 15 minutos.
- Também há limites de tamanho (JSON com 16 KB, simulação com 1,5 MB, fotos com 1 MB).
- `POST /api/orcamento` **com simulação** exige a sessão com o email confirmado. O pedido fica com o `conta_id` e o email do pedido passa a ser o da conta. As fotos continuam a ir com o token devolvido no 201.
- **O formulário simples do site (`index.html`) não precisa de conta.** Envia `POST /api/orcamento` sem simulação e fica um "pedido de contacto" (`conta_id` nulo). Os pedidos antigos, feitos antes da conta, também ficam sem conta e iguais no painel.
- **RGPD**: o CEO vê as contas em "Contas de clientes" e pode desativá-las ou apagá-las. Apagar remove a conta, as sessões, os códigos, a simulação guardada, as credenciais da casa e os pedidos que não chegaram a obra, com as fotos e os detalhes do histórico. Os pedidos convertidos ficam, sem a ligação à conta. Na auditoria a conta aparece como `conta:<id>`, sem o email.
- **Retenção**: contas por confirmar há 30 dias são apagadas; contas sem acesso nem seguimento há 12 meses (o mesmo critério das fotos), também.

## Emails (SMTP)

O cliente SMTP é mínimo (`painel/src/email.js`, sem dependências):

- STARTTLS obrigatório na porta 587, ou TLS direto na 465;
- autenticação AUTH PLAIN ou LOGIN, com tempo limite;
- a palavra-passe SMTP nunca aparece no registo.

Configura-se no `.env` com `SMTP_HOST`, `SMTP_PORTA`, `SMTP_UTILIZADOR`, `SMTP_PASSWORD` e `EMAIL_REMETENTE`. A opção gratuita recomendada é o Brevo, com 300 emails por dia (`servidor/.env.example`).

**Sem SMTP, e sempre no modo local**, o email é escrito no registo do painel: `[email] para x@y: código 123456 (confirmar o email)`.

## Site noutro endereço (Vercel)

Exemplo: o site em `https://domusenergia.pt` (Vercel) e o painel, a API, o MQTT e os pagamentos em `https://api.domusenergia.pt` (VPS). Para funcionar:

- **`web/config.js`**: `apiBase: "https://api.domusenergia.pt"`. O simulador, a conta, o `cliente.js` e o formulário do site chamam `<apiBase>/api/orcamento*`, `/api/catalogo` e `/api/conta/*`, com `credentials: "include"`. Vazio quer dizer a mesma origem, como está hoje com o Caddy.
- **`.env` do VPS**: `SITE_ORIGENS=https://domusenergia.pt,https://www.domusenergia.pt`. O painel responde com CORS e credenciais **só** a estas origens e só nas rotas públicas. Inclui o preflight `OPTIONS` com `Content-Type` e os cabeçalhos `X-Fotos-Token`, `X-Foto-Chave` e `X-Foto-Legenda`, nunca `*`. A verificação de origem aceita estas origens quando o pedido vem `same-site`; `cross-site` é sempre recusado.
- **O cookie `SameSite=Lax` funciona porque o site e a API partilham o domínio registável** (`domusenergia.pt`): para o browser os pedidos são *same-site*. Com domínios diferentes (ex. `*.vercel.app` → `api.domusenergia.pt`) o cookie não seguiria. Use o domínio próprio no Vercel.
- **CSP do site no Vercel** (`vercel.json`, cabeçalhos): acrescente a origem da API em `connect-src` e `img-src` (as fotos da conta vêm de lá) e o `wss://…/mqtt` em `connect-src`.
- O Stripe (`/api/*` dos pagamentos) continua no VPS. Os pedidos de pagamento da área de cliente usam `apiUrl`, que tem de passar a apontar para o VPS.

**O deploy no Vercel não está feito**: fica só preparado.

## Rotas `/api/conta/*`

| Método | Caminho | Sessão | O quê |
|---|---|---|---|
| POST | `criar` | — | `{email, password}` → 201, cookie e código por email; 409 se já existe |
| POST | `entrar` | — | `{email, password}` → 200 e cookie; 401 com a mesma mensagem para tudo |
| POST | `sair` | — | apaga a sessão |
| POST | `esqueci` | — | `{email}` → 200, sempre com a mesma resposta |
| POST | `repor` | — | `{email, codigo, password}` → nova palavra-passe (e confirma o email) |
| GET | `eu` | sim | conta, `simulacao_atualizada`, `tem_casa` |
| POST | `confirmar` / `reenviar` | sim | código de 6 dígitos (400 errado, 410 expirado, 429 esgotado) |
| GET/POST | `simulacao` | sim | `{estado}` do simulador (ou `null` para apagar) |
| GET | `pedidos` | confirmada | pedidos da conta, com passos, resumo, fotos e proposta |
| GET | `pedidos/:id/fotos/:foto` | confirmada | a foto (só do próprio pedido) |
| POST | `pedidos/:id/fotos` | confirmada | foto (bytes, `X-Foto-Chave`, `X-Foto-Legenda`); 409 depois de aceite |
| POST | `pedidos/:id/aceitar` | confirmada | `{valor?}` → aceite; 409 se já aceite, convertida ou se o valor mudou |
| GET | `casa` | confirmada | `{codigo, password}` MQTT da casa desta conta (404 sem casa) |

Painel (só CEO): `GET contas`, `POST contas/:id {ativo}`, `POST contas/:id/apagar`. No pedido: `conta` (email e se está confirmado), `morada`, `proposta_texto` e `proposta_aceite`.

Testes: `painel/test/conta.test.js` e `painel/test/email.test.js`.
