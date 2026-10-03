# Conta de cliente

A conta do cliente serve para enviar o pedido do simulador, acompanhá-lo e, depois da instalação, entrar na área de cliente da casa. As rotas `/api/conta/*` são servidas pelo **painel** (`painel/src/conta.js`); as páginas são `web/conta.html`, o passo 7 do simulador e o "Entrar com email" de `web/cliente.html`.

## Decisões do dono

1. **A conta é obrigatória para enviar a simulação.** No passo "Enviar" aparece antes do contacto: "Criar conta" (só o email; o código de 6 dígitos confirma e abre a sessão) ou "Já tenho conta — entrar". Com a sessão aberta mostra "Entrou como x@y · Sair". O email do pedido é o da conta (desde 2026-10-03 o bloco "Contacto" já não tem campo de email; nome, telefone, localidade e morada da obra são obrigatórios). Nome, telefone, morada e localidade (concelho, com as sugestões dos 308 concelhos) ficam no contacto e são guardados no perfil da conta quando o pedido é enviado.
2. **Só o email + código; a palavra-passe é opcional** (fase 3 da auditoria, decisão do dono, 2026-10-02). "Criar conta" pede só o email e manda um **código de 6 dígitos** (vale 15 minutos, 5 tentativas); confirmar o código cria a conta (confirma o email) e abre a sessão. Quem tem o email tem a conta: se o email já tem conta, "Criar conta" manda um código **para entrar** (a resposta ao browser é sempre a mesma, "Enviámos um código para o email"). Entrar tem dois caminhos: **"Entrar com código"** (email → `POST codigo` → código → sessão; também serve de "Esqueci-me da palavra-passe") e **"Entrar com palavra-passe"** (quem a definiu). A palavra-passe define-se ou muda-se na conta ("Definir palavra-passe" / "Mudar a palavra-passe", `POST palavra-passe`, com as regras do painel: `senhas.js`, scrypt, pelo menos 10 caracteres; `contas.hash` aceita NULL, migração 21). "Esqueci" e "repor" (código + palavra-passe nova) continuam a existir no servidor. `GET eu` e as respostas com `conta` trazem `tem_password`. Apagar a conta confirma-se com a palavra-passe ou, sem ela, com um código para entrar (`POST codigo` com o email da conta; `POST apagar {codigo}`).
3. **A conta** (`conta.html`) mostra:
   - o estado do pedido (recebido → visita → proposta → aceite → instalação), feito a partir dos estados reais do painel;
   - a simulação enviada, num resumo simples (sem a parte técnica);
   - as fotos. Pode acrescentar ou trocar fotos enquanto o pedido não estiver aceite nem convertido; usa as mesmas validações de `fotos.js`.
   - a **simulação por acabar**, que se retoma noutro aparelho (ver abaixo);
   - a **proposta** (valor + IVA e o texto do painel), com a escolha do **plano mensal** e o botão "Aceito a proposta e pago o sinal (X €)". O sinal é 30 % da proposta com IVA menos o que já pagou (relatório, visita, avaria) ([PAGAMENTOS-PEDIDO.md](PAGAMENTOS-PEDIDO.md)). Até o sinal estar pago, o painel mostra "Aceite — a aguardar sinal" e a conta mostra "Pagar o sinal". Com o sinal pago, o estado passa a `aceite` (data, hora e IP na auditoria): no histórico do painel aparece "Proposta aceite pelo cliente (online)" e o Início mostra a lista "Propostas aceites online". Se a proposta já estiver aceite ou convertida, o pedido dá 409;
   - os **pagamentos** de cada fase (relatório completo, visita, avaria, sinal, restante), com o estado e um recibo simples (data, valor, descrição e referência). Com a obra concluída no painel aparece "Pagar o restante";
   - o **relatório básico** (grátis, logo ao enviar): o intervalo de preço e a lista de trabalho por divisão, sem material nem preços;
   - o **relatório completo**: "Comprar relatório completo (29 €)"; pago, "Relatório em revisão (até 24 h)" até o CEO o libertar no painel; depois "Ver o relatório completo" e "Descarregar (imprimir / PDF)", com o trabalho, as divisões, o material e o preço por divisão, sem dados internos;
   - a **visita técnica**: "Marcar visita técnica (X €)" (deslocação + 30 min; fora da área não há); paga, "Vamos marcar a data"; marcada, o dia e a hora.
4. **A mesma conta abre a área da casa.** Depois de o painel converter o pedido, o `cliente.html` entra por omissão com "Entrar com email"; "Entrar com o código de cliente" continua disponível. Com o email entra-se de duas maneiras (decisão do dono, 2026-10-03): com a **palavra-passe** ou com **"Entrar com código (sem palavra-passe)"** — o cliente escreve o email, recebe o código de 6 algarismos (15 minutos) e escreve-o; são as mesmas rotas de "A minha conta" (`POST codigo` e `POST confirmar`, com os mesmos limites, bloqueios e respostas que não dizem se o email tem conta; `web/cliente.js`, com o `pedirConta` de `web/conta-comum.js`) e a sessão é a mesma. A casa abre igual nos dois casos: a palavra-passe MQTT está cifrada com a `CONTA_CHAVE` do servidor (não com a palavra-passe da conta) e `GET casa` só pede a sessão com o email confirmado.
5. **Vercel.** As páginas públicas podem estar no Vercel e o painel no VPS (ver "Site noutro endereço").

## Guardar e retomar a simulação

Com a sessão aberta, o simulador guarda o estado na conta sempre que se muda de passo e quando o cliente entra no passo "Enviar" (`POST /api/conta/simulacao`, até 1,5 MB; se não couber, vai sem a imagem de fundo).

Ao abrir o simulador com sessão fica, sem perguntar, a simulação mais recente entre a deste navegador e a da conta (lote 8, docs/SIMULADOR-ORCAMENTO.md §0): se a da conta for mais recente, continua-se nela no passo onde ficou; senão a deste navegador vai para a conta. **As fotos ainda por enviar ficam só no navegador onde foram tiradas** (IndexedDB).

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

- A sessão usa o cookie `domus_conta`, diferente do cookie do painel: `HttpOnly; SameSite=Lax; Path=/api`, com `Secure` fora de localhost. O caminho é `/api` (e não `/api/conta`) porque o `POST /api/orcamento` com simulação também usa esta sessão. O cookie chega por isso aos pagamentos (`/api/*` no Caddy), que o ignoram: autenticam com `Authorization: Bearer` e nunca registam cabeçalhos. Na base de dados só fica o SHA-256 do cookie. A sessão dura 7 dias sem uso e no máximo 30 dias. Repor a palavra-passe ("Esqueci") fecha todas as sessões; definir ou mudar a palavra-passe na conta não (quem lá está já provou o email).
- **Uma conta de cliente não abre nenhuma rota `/painel/api/`** (as sessões são separadas), e cada conta só vê os seus pedidos: os pedidos de outras contas dão 404.
- As origens são verificadas (CSRF) como no resto do painel: `Origin`/`Sec-Fetch-Site` em todos os POST.
- Há limites por IP e por email em criar, codigo, confirmar, reenviar, esqueci e repor. **Emails enviados**, por email e com quotas separadas (acima delas, em silêncio): códigos de confirmar/entrar (criar, codigo e reenviar) 3 por hora; códigos de repor ("Esqueci") 3 por hora — um terceiro que chame "criar" ou "codigo" com o email de outra pessoa não bloqueia o "Esqueci" dela. "criar" 5/hora por IP e 3/hora por email; "codigo" 10/hora por IP; "confirmar" 20/hora por IP. **Entrar** (palavra-passe): 10 por minuto por IP e 5 por minuto por par email+IP, com um atraso progressivo curto a partir da 3.ª falha seguida do mesmo IP (1 s, 2 s, 4 s… até 60 s); por email só um travão alto (50 por hora), para que um terceiro não consiga bloquear a conta de alguém. Uma conta por confirmar (ou sem palavra-passe) não entra assim (a mesma resposta de erro): entra com o código.
- **Nenhuma resposta diz se um email tem conta**: criar, codigo, entrar, confirmar sem sessão, esqueci e repor respondem igual. No repor, o código deixa de valer ao fim de 5 tentativas erradas, mas a resposta continua a ser "código errado ou expirado"; há limite por email (10/hora, exista ou não a conta) e por IP (20/hora). No confirmar sem sessão o código também deixa de valer ao fim de 5 tentativas erradas (um terceiro consegue gastá-lo; o dono pede outro — 3 por hora).
- Os códigos só vão no corpo do email (nunca no assunto). Com SMTP, o registo do painel não guarda o assunto nem o corpo; sem SMTP / no modo local o email vai todo para o registo (é assim que se lê o código).
- Também há limites de tamanho (JSON com 16 KB, simulação com 1,5 MB, fotos com 1 MB).
- `POST /api/orcamento` **com simulação** exige a sessão com o email confirmado. O pedido fica com o `conta_id` e o email do pedido passa a ser o da conta. Enviar é grátis (fase 3): `201` com o pedido e o token das fotos, e o pagamento da compra escolhida no passo Enviar, se houver ([PAGAMENTOS-PEDIDO.md](PAGAMENTOS-PEDIDO.md)). Só a avaria rápida, com os pagamentos ligados, responde `202 {pagamento}`: passa a orçamento depois de paga, e as fotos vão com o token dado no regresso do pagamento.
- **O formulário simples do site (`index.html`) não precisa de conta.** Envia `POST /api/orcamento` sem simulação e fica um "pedido de contacto" (`conta_id` nulo). Os pedidos antigos, feitos antes da conta, também ficam sem conta e iguais no painel.
- **RGPD**: o CEO vê as contas em "Contas de clientes" e pode desativá-las ou apagá-las. Apagar remove a conta, as sessões, os códigos, a simulação guardada, as credenciais da casa e os pedidos que não chegaram a obra, com as fotos e os detalhes do histórico. Os pedidos convertidos ficam, sem a ligação à conta. **Pedidos com pagamentos pagos (19 €, sinal, restante) não se apagam: são ANONIMIZADOS** (`orcamentos.anonimizado`, migração 11) — saem o nome (passa a "Anonimizado (RGPD)"), o telefone, o email, a localidade, a morada, a mensagem, as notas, o motivo da perda, o código de cliente, a simulação, a leitura do quadro, os ensaios medidos, o esquema do quadro e o diagnóstico da avaria (texto livre do eletricista sobre a casa; migrações 16–18) e as fotos; ficam o id, as datas, o estado, o serviço, o valor e o texto da proposta (a descrição), o plano e os pagamentos, que continuam ligados ao pedido (sem a conta) para a contabilidade — **retenção de 10 anos** depois do último pagamento (a limpeza diária apaga-os depois, com os pagamentos; `orcamento_apagado_retencao`). Não há campo de NIF no pedido: quando houver, fica. A lista de todos os pagamentos (painel → Pagamentos → "Pagamentos dos pedidos", só CEO) e o CSV (`data;referencia;descricao;base;iva;total;estado;pedido`) incluem os dos pedidos anonimizados. **Apagar pede confirmação**: o CEO escreve o email da conta (o servidor verifica: `POST contas/:id/apagar {email}`, 400 sem ele ou com outro). Na auditoria a conta aparece como `conta:<id>`, sem o email. Ao apagar, sai a auditoria da conta e dos pedidos apagados (com os IPs e os detalhes); de cada pedido fica só uma linha `orcamento_apagado_rgpd` (ou `orcamento_anonimizado_rgpd`) sem dados pessoais, e da conta a linha `conta_apagada` do CEO. Nas linhas que ficam (pedidos convertidos) sai o IP da conta. **Os ids de pedidos e de contas nunca são reutilizados** (`AUTOINCREMENT`, migração 8), por isso um pedido novo nunca herda o histórico de um apagado.
- **Retenção**: contas por confirmar há 30 dias são apagadas; contas sem acesso nem seguimento há 12 meses (o mesmo critério das fotos), também.

## Emails (SMTP)

O cliente SMTP é mínimo (`painel/src/email.js`, sem dependências):

- STARTTLS obrigatório na porta 587, ou TLS direto na 465;
- autenticação AUTH PLAIN ou LOGIN, com tempo limite;
- a palavra-passe SMTP nunca aparece no registo.

Configura-se no `.env` com `SMTP_HOST`, `SMTP_PORTA`, `SMTP_UTILIZADOR`, `SMTP_PASSWORD` e `EMAIL_REMETENTE` (opcionais: `SMTP_SEGURANCA` = `tls`/`starttls`, e `SMTP_TIMEOUT_MS`). A opção gratuita recomendada é o Brevo, com 300 emails por dia (`servidor/.env.example`).

Os **emails automáticos** ao cliente (pedido recebido, lembrete da visita, pagamento em falta, depois da obra com o pedido de avaliação e "Não quero receber") estão em [EMAILS-AUTOMATICOS.md](EMAILS-AUTOMATICOS.md). A conta mostra "Como correu?" (1 a 5 estrelas) depois da obra e, depois de avaliar, o convite para a avaliação no Google (a todos, só com a ligação configurada no painel).

**Sem SMTP, e sempre no modo local**, o email é escrito no registo do painel: `[email] para x@y: código 123456 (confirmar o email)` (ou `(entrar)`, `(mudar a palavra-passe)`).

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
| POST | `criar` | — | `{email}` → 201 `{ok, email, mensagem}`, sempre igual e sem cookie; conta nova (sem palavra-passe) e código de confirmar por email (ou, se o email já tem conta, o código para entrar) |
| POST | `codigo` | — | `{email}` → 200, sempre com a mesma resposta; código para entrar (conta confirmada) ou de confirmar; 10/hora por IP, 3 emails/hora por email |
| POST | `entrar` | — | `{email, password}` → 200 e cookie (só contas confirmadas e com palavra-passe); 401 com a mesma mensagem para tudo; 429 com `Retry-After` |
| POST | `sair` | — | apaga a sessão |
| POST | `esqueci` | — | `{email}` → 200, sempre com a mesma resposta |
| POST | `repor` | — | `{email, codigo, password}` → nova palavra-passe (e confirma o email); 400 igual para tudo o que falha |
| POST | `confirmar` | — | `{email, codigo}` → 200, cookie (abre a sessão; confirma o email se ainda não estava); 400 igual para tudo o que falha |
| GET | `eu` | sim | conta (com `tem_password`), `simulacao_atualizada`, `tem_casa` |
| POST | `confirmar` / `reenviar` | sim | contas por confirmar com sessão aberta antes desta versão: `{codigo}` (400 errado, 410 expirado, 429 esgotado) |
| POST | `palavra-passe` | confirmada | `{password}` → define ou muda a palavra-passe (regras do painel); não fecha as outras sessões |
| GET/POST | `simulacao` | sim | `{estado}` do simulador (ou `null` para apagar) |
| GET | `pedidos` | confirmada | pedidos da conta, com passos, resumo, fotos e proposta |
| GET | `pedidos/:id/fotos/:foto` | confirmada | a foto (só do próprio pedido) |
| POST | `pedidos/:id/fotos` | confirmada | foto (bytes, `X-Foto-Chave`, `X-Foto-Legenda`); 409 depois de aceite |
| POST | `pedidos/:id/aceitar` | confirmada | `{valor?, plano}` → `{pedido, pagamento}` (sinal por pagar; "aceite" depois de pago); 409 se já aceite, convertida ou se o valor mudou |
| POST | `pedidos/:id/avaliar` | confirmada | `{estrelas}` (1 a 5) → `{pedido}`: "Como correu?" num pedido com a obra concluída, uma vez ([EMAILS-AUTOMATICOS.md](EMAILS-AUTOMATICOS.md)); 409 sem avaliação por fazer |
| GET / POST | `emails/nao-receber?t=` | — (token assinado) | "Não quero receber" do email depois da obra: página de confirmação / guarda a recusa (HTML) |
| POST | `pedidos/:id/pagar` | confirmada | `{fase: sinal\|restante}` → `{pagamento}` (PAGAMENTOS-PEDIDO.md) |
| GET | `pedidos/:id/relatorio` | confirmada | relatório técnico do cliente; 409 em revisão |
| GET / POST | `pagamentos/:ref`, `pagamentos/:ref/simular` | confirmada (conta dona) | estado e recibo de um pagamento; pagamento simulado (só no modo simulado) |
| POST | `pagamentos/stripe-webhook` | — (assinatura do Stripe) | só no modo stripe |
| GET | `casa` | confirmada | `{codigo, password}` MQTT da casa desta conta (404 sem casa) |

Painel (só CEO): `GET contas`, `POST contas/:id {ativo}`, `POST contas/:id/apagar {email}` (o email da conta, para confirmar). No pedido: `conta` (email e se está confirmado), `morada`, `proposta_texto` e `proposta_aceite`.

Testes: `painel/test/conta.test.js` e `painel/test/email.test.js`.
