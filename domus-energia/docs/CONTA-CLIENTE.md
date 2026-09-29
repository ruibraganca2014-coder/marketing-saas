# Conta de cliente

A conta do cliente serve para enviar o pedido do simulador, acompanhá-lo e, depois da instalação, entrar na área de cliente da casa. As rotas `/api/conta/*` são servidas pelo **painel** (`painel/src/conta.js`); as páginas são `web/conta.html`, o passo 7 do simulador e o "Entrar com email" de `web/cliente.html`.

## Decisões do dono

1. **A conta é obrigatória para enviar a simulação.** No passo 7 ("Enviar") aparece antes do contacto: "Criar conta" (email, palavra-passe e confirmação) ou "Já tenho conta — entrar". Com a sessão aberta mostra "Entrou como x@y · Sair". O email da conta preenche e fixa o email do contacto. Nome, telefone, morada e localidade (concelho, com as sugestões dos 308 concelhos) ficam no contacto e são guardados no perfil da conta quando o pedido é enviado.
2. **Email e palavra-passe**, com as regras do painel (`senhas.js`: scrypt, pelo menos 10 caracteres). O email é confirmado com um **código de 6 dígitos**, que vale 15 minutos e aceita 5 tentativas. Sem email confirmado não se pode enviar. O "Esqueci a palavra-passe" manda um código de uso único (15 min) e responde sempre o mesmo, exista ou não a conta. **"Criar conta" também responde sempre o mesmo** ("Enviámos um código para o email"): se o email já tem conta, em vez do código vai para esse email um aviso ("Alguém tentou criar conta com este email; se foi você, entre ou use Esqueci a palavra-passe"), e o ecrã do código explica isso. A sessão abre ao confirmar o código (com o email e a palavra-passe da conta); quem volta mais tarde sem ter confirmado cria a conta outra vez com a mesma palavra-passe e recebe um código novo.
3. **A conta** (`conta.html`) mostra:
   - o estado do pedido (recebido → visita → proposta → aceite → instalação), feito a partir dos estados reais do painel;
   - a simulação enviada, num resumo simples (sem a parte técnica);
   - as fotos. Pode acrescentar ou trocar fotos enquanto o pedido não estiver aceite nem convertido; usa as mesmas validações de `fotos.js`.
   - a **simulação por acabar**, que se retoma noutro aparelho (ver abaixo);
   - a **proposta** (valor + IVA e o texto do painel), com a escolha do **plano mensal** e o botão "Aceito a proposta e pago o sinal (X €)". O sinal é 30 % da proposta menos os 19 € já pagos ([PAGAMENTOS-PEDIDO.md](PAGAMENTOS-PEDIDO.md)). Até o sinal estar pago, o painel mostra "Aceite — a aguardar sinal" e a conta mostra "Pagar o sinal". Com o sinal pago, o estado passa a `aceite` (data, hora e IP na auditoria): no histórico do painel aparece "Proposta aceite pelo cliente (online)" e o Início mostra a lista "Propostas aceites online". Se a proposta já estiver aceite ou convertida, o pedido dá 409;
   - os **pagamentos** de cada fase (19 €, sinal, restante), com o estado e um recibo simples (data, valor, descrição e referência). Com a obra concluída no painel aparece "Pagar o restante";
   - o **relatório técnico**: "Relatório em revisão (até 24 h)" até o CEO o libertar no painel; depois "Ver o relatório técnico" e "Descarregar (imprimir / PDF)", com o trabalho, as divisões, o material e o preço por divisão, sem dados internos.
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
3. Quando o painel lê esse resultado (`pedidos.js` → `conta.js aoResultadoPedido`), guarda na conta o código do cliente e a palavra-passe **cifrada com AES-256-GCM** usando a `CONTA_CHAVE` do `.env`, com o id da conta como dados associados (AAD: a cifra copiada para outra conta não se lê) e etiqueta de 16 bytes. As cifras antigas, sem AAD, ainda se leem e são cifradas de novo na primeira leitura. A palavra-passe nunca vai para a auditoria nem para o registo.
4. `GET /api/conta/casa` só responde à própria conta, com o email confirmado e uma sessão válida (limite de 30 pedidos por hora). Devolve `{codigo, password}`, e o `cliente.js` liga-se ao MQTT como se o cliente tivesse escrito o código.

Riscos e limites:

- Quem tiver a base do painel **e** a `CONTA_CHAVE` consegue ler as palavras-passe MQTT das casas. Guarde o `.env` fora das cópias da base, ou em separado. O painel já tinha acesso de leitura ao MQTT; esta é a única credencial de escrita que guarda.
- Se a `CONTA_CHAVE` mudar, as credenciais guardadas deixam de se ler e o cliente passa a entrar com o código.
- Se a palavra-passe MQTT for mudada no servidor (`./domus.sh cliente <c>` de novo), a conta fica com a antiga até haver outra conversão. Nesse caso o cliente entra com o código.
- Sem `CONTA_CHAVE` fica guardado só o código, e a conta diz ao cliente para entrar com o código.
- Um cliente que já existia antes da conta (conversão com `cliente_existia`) não fica ligado: entra com o código.

## Segurança

- A sessão usa o cookie `domus_conta`, diferente do cookie do painel: `HttpOnly; SameSite=Lax; Path=/api`, com `Secure` fora de localhost. O caminho é `/api` (e não `/api/conta`) porque o `POST /api/orcamento` com simulação também usa esta sessão. O cookie chega por isso aos pagamentos (`/api/*` no Caddy), que o ignoram: autenticam com `Authorization: Bearer` e nunca registam cabeçalhos. Na base de dados só fica o SHA-256 do cookie. A sessão dura 7 dias sem uso e no máximo 30 dias. Mudar a palavra-passe fecha todas as sessões.
- **Uma conta de cliente não abre nenhuma rota `/painel/api/`** (as sessões são separadas), e cada conta só vê os seus pedidos: os pedidos de outras contas dão 404.
- As origens são verificadas (CSRF) como no resto do painel: `Origin`/`Sec-Fetch-Site` em todos os POST.
- Há limites por IP e por email em criar, código, reenviar, esqueci e repor. **Emails enviados**, por email e com quotas separadas (acima delas, em silêncio): códigos de confirmar (criar e reenviar) 3 por hora; avisos "já tem conta" 1 por hora; códigos de repor ("Esqueci") 3 por hora — um terceiro que chame "criar" com o email de outra pessoa não bloqueia o "Esqueci" dela. **Entrar**: 10 por minuto por IP e 5 por minuto por par email+IP, com um atraso progressivo curto a partir da 3.ª falha seguida do mesmo IP (1 s, 2 s, 4 s… até 60 s); por email só um travão alto (50 por hora), para que um terceiro não consiga bloquear a conta de alguém. Uma conta por confirmar não entra (a mesma resposta de erro): entra ao confirmar o código.
- **Nenhuma resposta diz se um email tem conta**: criar, entrar, confirmar sem sessão, esqueci e repor respondem igual. No repor, o código deixa de valer ao fim de 5 tentativas erradas, mas a resposta continua a ser "código errado ou expirado"; há limite por email (10/hora, exista ou não a conta) e por IP (20/hora). No confirmar sem sessão, as tentativas só contam com a palavra-passe certa (um terceiro não gasta o código).
- Os códigos só vão no corpo do email (nunca no assunto). Com SMTP, o registo do painel não guarda o assunto nem o corpo; sem SMTP / no modo local o email vai todo para o registo (é assim que se lê o código).
- Também há limites de tamanho (JSON com 16 KB, simulação com 1,5 MB, fotos com 1 MB).
- `POST /api/orcamento` **com simulação** exige a sessão com o email confirmado. O pedido fica com o `conta_id` e o email do pedido passa a ser o da conta. **Com os pagamentos ligados** (por omissão), a resposta é `202 {pagamento}`: o pedido só passa a orçamento depois de pagos os 19 €, e as fotos vão com o token dado no regresso do pagamento ([PAGAMENTOS-PEDIDO.md](PAGAMENTOS-PEDIDO.md)). Com `PAGAMENTO_PEDIDO=0` continua como antes: 201 e o token das fotos na resposta.
- **O formulário simples do site (`index.html`) não precisa de conta.** Envia `POST /api/orcamento` sem simulação e fica um "pedido de contacto" (`conta_id` nulo). Os pedidos antigos, feitos antes da conta, também ficam sem conta e iguais no painel.
- **RGPD**: o CEO vê as contas em "Contas de clientes" e pode desativá-las ou apagá-las. Apagar remove a conta, as sessões, os códigos, a simulação guardada, as credenciais da casa e os pedidos que não chegaram a obra, com as fotos e os detalhes do histórico. Os pedidos convertidos ficam, sem a ligação à conta. Na auditoria a conta aparece como `conta:<id>`, sem o email. Ao apagar, sai a auditoria da conta e dos pedidos apagados (com os IPs e os detalhes); de cada pedido fica só uma linha `orcamento_apagado_rgpd` sem dados pessoais, e da conta a linha `conta_apagada` do CEO. Nas linhas que ficam (pedidos convertidos) sai o IP da conta. **Os ids de pedidos e de contas nunca são reutilizados** (`AUTOINCREMENT`, migração 8), por isso um pedido novo nunca herda o histórico de um apagado.
- **Retenção**: contas por confirmar há 30 dias são apagadas; contas sem acesso nem seguimento há 12 meses (o mesmo critério das fotos), também.

## Emails (SMTP)

O cliente SMTP é mínimo (`painel/src/email.js`, sem dependências):

- STARTTLS obrigatório na porta 587, ou TLS direto na 465;
- autenticação AUTH PLAIN ou LOGIN, com tempo limite;
- a palavra-passe SMTP nunca aparece no registo.

Configura-se no `.env` com `SMTP_HOST`, `SMTP_PORTA`, `SMTP_UTILIZADOR`, `SMTP_PASSWORD` e `EMAIL_REMETENTE` (opcionais: `SMTP_SEGURANCA` = `tls`/`starttls`, e `SMTP_TIMEOUT_MS`). A opção gratuita recomendada é o Brevo, com 300 emails por dia (`servidor/.env.example`).

**Sem SMTP, e sempre no modo local**, o email é escrito no registo do painel: `[email] para x@y: código 123456 (confirmar o email)`.

## Site noutro endereço (Vercel)

Exemplo: o site em `https://domusenergia.pt` (Vercel) e o painel, a API, o MQTT e os pagamentos em `https://api.domusenergia.pt` (VPS). Para funcionar:

- **`web/config.js`**: `apiBase: "https://api.domusenergia.pt"`. O simulador, a conta, o `cliente.js` e o formulário do site chamam `<apiBase>/api/orcamento*`, `/api/catalogo` e `/api/conta/*`, com `credentials: "include"`. Vazio quer dizer a mesma origem, como está hoje com o Caddy.
- **`.env` do VPS**: `SITE_ORIGENS=https://domusenergia.pt,https://www.domusenergia.pt`. Só `https://` (`http://` só para `localhost`/`*.localhost`); uma origem `http://` de outro sítio é ignorada com aviso no arranque. O painel responde com CORS e credenciais **só** a estas origens e só nas rotas públicas. Inclui o preflight `OPTIONS` com `Content-Type` e os cabeçalhos `X-Fotos-Token`, `X-Foto-Chave` e `X-Foto-Legenda`, nunca `*`. A verificação de origem aceita estas origens quando o pedido vem `same-site`; `cross-site` é sempre recusado.
- **O cookie `SameSite=Lax` funciona porque o site e a API partilham o domínio registável** (`domusenergia.pt`): para o browser os pedidos são *same-site*. Com domínios diferentes (ex. `*.vercel.app` → `api.domusenergia.pt`) o cookie não seguiria. Use o domínio próprio no Vercel.
- **CSP do site no Vercel** (`vercel.json`, cabeçalhos): acrescente a origem da API em `connect-src` e `img-src` (as fotos da conta vêm de lá) e o `wss://…/mqtt` em `connect-src`.
- O Stripe (`/api/*` dos pagamentos) continua no VPS. Os pedidos de pagamento da área de cliente usam `apiUrl`, que tem de passar a apontar para o VPS.

**O deploy no Vercel não está feito**: fica só preparado.

## Rotas `/api/conta/*`

| Método | Caminho | Sessão | O quê |
|---|---|---|---|
| POST | `criar` | — | `{email, password}` → 201 `{ok, email, mensagem}`, sempre igual e sem cookie; código por email (ou, se o email já tem conta, um aviso) |
| POST | `entrar` | — | `{email, password}` → 200 e cookie (só contas confirmadas); 401 com a mesma mensagem para tudo; 429 com `Retry-After` |
| POST | `sair` | — | apaga a sessão |
| POST | `esqueci` | — | `{email}` → 200, sempre com a mesma resposta |
| POST | `repor` | — | `{email, codigo, password}` → nova palavra-passe (e confirma o email); 400 igual para tudo o que falha |
| POST | `confirmar` | — | `{email, password, codigo}` → 200, cookie (abre a sessão); 400 igual para tudo o que falha |
| GET | `eu` | sim | conta, `simulacao_atualizada`, `tem_casa` |
| POST | `confirmar` / `reenviar` | sim | contas por confirmar com sessão aberta antes desta versão: `{codigo}` (400 errado, 410 expirado, 429 esgotado) |
| GET/POST | `simulacao` | sim | `{estado}` do simulador (ou `null` para apagar) |
| GET | `pedidos` | confirmada | pedidos da conta, com passos, resumo, fotos e proposta |
| GET | `pedidos/:id/fotos/:foto` | confirmada | a foto (só do próprio pedido) |
| POST | `pedidos/:id/fotos` | confirmada | foto (bytes, `X-Foto-Chave`, `X-Foto-Legenda`); 409 depois de aceite |
| POST | `pedidos/:id/aceitar` | confirmada | `{valor?, plano}` → `{pedido, pagamento}` (sinal por pagar; "aceite" depois de pago); 409 se já aceite, convertida ou se o valor mudou |
| POST | `pedidos/:id/pagar` | confirmada | `{fase: sinal\|restante}` → `{pagamento}` (PAGAMENTOS-PEDIDO.md) |
| GET | `pedidos/:id/relatorio` | confirmada | relatório técnico do cliente; 409 em revisão |
| GET / POST | `pagamentos/:ref`, `pagamentos/:ref/simular` | confirmada (conta dona) | estado e recibo de um pagamento; pagamento simulado (só no modo simulado) |
| POST | `pagamentos/stripe-webhook` | — (assinatura do Stripe) | só no modo stripe |
| GET | `casa` | confirmada | `{codigo, password}` MQTT da casa desta conta (404 sem casa) |

Painel (só CEO): `GET contas`, `POST contas/:id {ativo}`, `POST contas/:id/apagar`. No pedido: `conta` (email e se está confirmado), `morada`, `proposta_texto` e `proposta_aceite`.

Testes: `painel/test/conta.test.js` e `painel/test/email.test.js`.
