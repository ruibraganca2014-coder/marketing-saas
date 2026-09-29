# Pagamentos do pedido de orçamento

Pagamentos do fluxo simulador → proposta → obra. As subscrições mensais continuam no serviço `pagamentos/` (docs/PROTOCOLO-PLANOS.md).

## Decisões do dono

- **Enviar o pedido custa 19 €.** Paga o relatório técnico e a visita técnica, e os 19 € são descontados na obra. Fora da área servida paga-se 19 € só pelo relatório, sem visita, e o simulador avisa antes de pagar.
- **O intervalo de preço do Resumo continua grátis.** O detalhe fica no relatório pago.
- **O dono revê o relatório técnico antes de o libertar** (até 24 h). No painel há o botão "Libertar relatório ao cliente" (só o CEO). Até lá a conta mostra "Relatório em revisão (até 24 h)". Depois o cliente vê e descarrega (imprimir ou PDF) a versão para o cliente: a **lista de trabalho por divisão e ação** ("Reparar: 1 tomada («queimada»; ver foto)", "Substituir: 2 interruptores por inteligentes", "Novo: 3 tomadas"; de `simulacao.trabalho`, lote 7; os aparelhos a manter só se contam; pedidos antigos sem ações: tudo Novo pelas linhas das divisões), o material e o preço por divisão, quadro e geral, mão de obra e deslocação. **Os preços são os do catálogo do servidor** (`preco_venda_iva`), as horas as do catálogo (ao substituir, as de troca) × a tarifa da configuração, e a deslocação a da configuração pela localidade — nunca os `preco_iva`/`valor_iva` que o browser mandou. Antes de libertar, o CEO tem **"Pré-visualizar versão do cliente"** (`GET orcamentos/:id/relatorio-cliente`, o mesmo JSON que a conta recebe). Nunca leva preço de compra, fornecedor, ligações, notas internas nem circuitos.
- **Os pagamentos online incluem IVA** (decisão do dono). A proposta do painel é **sem IVA**; o sinal e o restante são calculados sobre o total **com IVA** (taxa `iva_pct` da configuração, no painel em Catálogo → Configuração → "IVA dos pagamentos"; o valor inicial vem de `IVA_TAXA`, por omissão 23). Os 19 € já são com IVA. Cada pagamento guarda a taxa usada (`pagamentos_pedido.iva_pct`, migração 11): o recibo, o email, a conta, o painel e o CSV mostram a base, o IVA e o total. Com o sinal pago, o restante usa a taxa do sinal.
- **Aceitar a proposta = pagar um sinal de 30 % (da proposta com IVA) menos os 19 € já pagos.** Ao aceitar escolhe-se o plano mensal (Base 4,99 €, Conforto 9,99 € ou Premium 19,99 €). Antes do sinal pago o painel mostra "Aceite — a aguardar sinal"; só depois o pedido passa a "Aceite".
- **O restante paga-se no fim da obra.** O painel marca "Obra concluída" e a conta mostra "Pagar o restante".
- **A subscrição começa quando a casa fica ligada** (conversão no painel):
  - no modo simulado, a conversão cria o pedido-admin `plano` (`ativo`) com o plano escolhido, a seguir ao do cliente;
  - no modo stripe, o cliente ativa-a na área de cliente, pelo serviço `pagamentos/`, como hoje.
- **"Visita técnica gratuita" saiu do site.** No simulador, na conta e nos emails passou a "visita técnica incluída nos 19 €, descontados na obra".

Exemplo com uma proposta de 1000 € (+ IVA 23 % = 1230 €):

| Fase | Valor (com IVA) | Base + IVA |
|---|---|---|
| Relatório e visita | 19 € | 15,45 € + 3,55 € |
| Sinal | 30 % × 1230 − 19 = 350 € | 284,55 € + 65,45 € |
| Restante | 1230 − 19 − 350 = 861 € | 700 € + 161 € |

O cálculo está em `valores()` (`painel/src/pagamentos-pedido.js`): total = `comIva(valor_proposta, iva_pct)`; sinal = `calcularSinal(total, 19 €)`; restante = total − tudo o que já foi pago − o sinal por pagar.

## Onde vive: no painel

O pagamento vive no **painel** (`painel/src/pagamentos-pedido.js`). As rotas ficam em `/api/conta/…`, que o Caddy já encaminha para o painel, por isso não há rotas novas no Caddy nem no lançador local.

Porquê no painel:

- é o painel que tem as contas, a sessão do cliente, os pedidos (`orcamentos`), a auditoria, os emails e o CSRF;
- o serviço `pagamentos/` só conhece clientes MQTT (a sessão é o código e a palavra-passe da casa) e o `_plano`, e ainda não há casa quando se paga o pedido;
- pôr os pagamentos em `pagamentos/` obrigava a partilhar a base e as sessões entre os dois serviços.

O Stripe é chamado pela **API REST** (`fetch`, form-encoded, com `Idempotency-Key`), sem juntar o SDK ao painel. O serviço `pagamentos/` continua com o SDK para as subscrições. A chave `STRIPE_SECRET_KEY` é a mesma. O webhook é outro, com o seu próprio segredo.

## Estados

`pagamentos_pedido` (migração 9), uma linha por pagamento:

| Campo | Significado |
|---|---|
| `ref` | referência aleatória `pp_…` (22 caracteres base64url): URL, recibo e `client_reference_id` do Stripe |
| `fase` | `relatorio` · `sinal` · `restante` |
| `estado` | `pendente` → `pago`, ou `pendente` → `falhado` / `cancelado` / `expirado` |
| `modo` | `simulado` · `stripe` |
| `retorno` | para onde se volta: `simulador` ou `conta` |
| `com_visita` | 19 €: 1 com visita, 0 fora da área |
| `plano` | sinal: o plano mensal escolhido |
| `pedido` | 19 € por pagar: o pedido (JSON) que passa a orçamento quando é pago; apagado depois |

`pagamentos_eventos` guarda os ids dos eventos já tratados. Nos `orcamentos` há três colunas novas: `relatorio_libertado`, `plano_escolhido` e `obra_concluida`.

Pedido com simulação:

1. **Passo Enviar:** conta → contacto → **"Pagar 19 € e enviar"**. O `POST /api/orcamento` responde `202 {pagamento}`:
   - o pedido fica guardado no pagamento, **a aguardar pagamento**;
   - não é um `orcamento`: não aparece no painel nem conta como "novo";
   - um segundo clique reaproveita o mesmo pagamento por pagar.
2. O browser vai para `pagamento.url`: `pagamento-simulado.html?ref=…` ou o Stripe Checkout. Antes grava a simulação no navegador.
3. **Volta a `simulador.html?pagamento=<ref>`.** O simulador repõe a simulação no passo Enviar e pede `GET /api/conta/pagamentos/<ref>?fotos=1`. No Stripe esse pedido também lê a sessão lá.
   - **Pago:** o orçamento já existe (estado `novo`, "recebido" na conta). O simulador envia as fotos com o `fotos_token` da resposta (só nas 2 h a seguir ao pagamento) e mostra "Pedido enviado!".
   - **Falhou ou cancelou:** fica no passo Enviar com a mensagem e a simulação intacta. O cliente pode pagar de novo.
4. **24 h sem pagar:** `expirado`, e o pedido guardado sai. Sai também dos pagamentos falhados ou cancelados. A limpeza corre de 15 em 15 min e em cada pedido.

Proposta:

1. O painel põe o estado "Proposta enviada" com o valor.
2. Na conta, "Aceito a proposta e pago o sinal (X €)" com o plano (`POST /api/conta/pedidos/:id/aceitar {valor, plano}`):
   - fica `proposta_aceite` com o estado ainda `proposta_enviada` ("Aceite — a aguardar sinal");
   - a resposta traz o pagamento do sinal;
   - se o sinal der 0, fica logo `aceite`.
3. Sinal pago → `aceite`, com a auditoria "Proposta aceite pelo cliente (online)" e a lista "Propostas aceites online" no Início. Se o painel mudar o valor ou o estado antes de o sinal estar pago, o sinal por pagar é cancelado e o cliente aceita de novo.
4. "Marcar obra concluída" no painel (`POST orcamentos/:id/obra-concluida`, CEO ou comercial, só com o pedido `aceite`). Marca também a obra ligada como `concluida`. Uma obra dada por concluída no ecrã Obras também conta.
5. Na conta, "Pagar o restante (X €)" (`POST /api/conta/pedidos/:id/pagar {fase:"restante"}`). Depois do pagamento aparece "A obra está paga".

## Modos (`PAGAMENTOS_MODO`)

| Modo | Quando | O que faz |
|---|---|---|
| (desligados) | sem `PAGAMENTOS_MODO` e sem `STRIPE_SECRET_KEY` (o `.env.example` já não põe `simulado`) | o pedido com simulação é enviado **sem pagar**, como antes (`PAGAMENTO_PEDIDO` fica desligado); o simulador diz "Enviar pedido"; o painel mostra a faixa "**Pagamentos desligados**" e avisa no arranque |
| `simulado` | **só com `PAGAMENTOS_MODO=simulado` escrito**; sempre no local (`local/iniciar.js`) | faixa "**Modo de demonstração — pagamentos simulados**" no simulador, na conta e no painel; página própria `web/pagamento-simulado.html`, marcada "**SIMULAÇÃO — não é cobrado nada**", com o valor, a descrição e a referência vindos do servidor e três botões: "Pagar (simular sucesso)", "Simular falha" e "Cancelar". Cada botão chama `POST /api/conta/pagamentos/:ref/simular {resultado}` |
| `stripe` | por omissão com `STRIPE_SECRET_KEY` | Stripe Checkout (`mode=payment`, EUR, cartão, MB WAY e Multibanco); confirmação pelo webhook e pelo regresso do cliente |

Trocar de modo é só configuração. A página simulada gera um evento **no formato de um webhook do Stripe** (`checkout.session.completed` com `payment_status=paid`, `checkout.session.async_payment_failed` ou `checkout.session.expired`, com `data.object` = uma `checkout.session` com `client_reference_id`, `amount_total` e `currency`). O webhook usa a mesma função `tratarEvento`.

No modo stripe, `…/simular` responde **404**. No modo simulado, o webhook responde 404. O painel avisa no arranque quando está em modo simulado.

## Segurança

- **Os valores são sempre do servidor.** São 19 €; o sinal é 30 % do `valor_proposta` menos o que já foi pago pelo relatório; o restante é o valor menos tudo o que já foi pago. O browser nunca manda o valor: um campo desconhecido dá 400. Um evento com outro valor, outra moeda ou outra sessão Stripe é ignorado.
- **Idempotência.**
  - Cada evento só é tratado uma vez.
  - Um pagamento pago não volta a ser pago: `UPDATE … WHERE estado != 'pago'` e um índice único (orçamento, fase) para os pagos.
  - Um segundo "pagar" devolve o pagamento por pagar que já existe.
  - No Stripe há `Idempotency-Key: domus-<ref>`.
  - Um pagamento que o Stripe confirma depois de expirado (Multibanco pago tarde) conta: o dinheiro entrou.
- **Só a conta dona.** Os pagamentos, o relatório e os pedidos de outra conta dão 404; sem sessão dá 401; é preciso o email confirmado.
- **CSRF e Origin** como no resto de `/api/conta/*`. O webhook não tem sessão nem Origin: vale a assinatura `Stripe-Signature` (HMAC-SHA256, 5 min de tolerância).
- **Redirecionamentos.** O simulador e a conta só navegam para `pagamento-simulado.html?ref=pp_…` ou `https://checkout.stripe.com/…`. A página simulada só volta para `simulador.html?pagamento=…` ou `conta.html?pagamento=…`, que vêm do que ficou guardado no servidor.
- **Dados de cartão:** nenhum. O cartão fica sempre no Stripe.
- **Auditoria.** Cada passo fica registado: `pagamento_criado`, `pagamento_simulado`, `pagamento_confirmado`, `pagamento_falhado`, `pagamento_cancelado`, `pagamento_expirado`, `proposta_aceite_aguarda_sinal`, `proposta_aceite_cliente`, `relatorio_libertado` e `obra_concluida`.
- **Emails** (no modo local vão para o registo):
  - pagamento recebido (com a descrição, o valor, a data e a referência) e pagamento não concluído;
  - relatório pronto;
  - obra concluída (com o restante).
- **RGPD.** Apagar uma conta (o CEO escreve o email da conta para confirmar) tira os pagamentos por pagar e o pedido guardado. Um pedido com pagamentos pagos **não se apaga: é anonimizado** (docs/CONTA-CLIENTE.md) e os pagamentos continuam ligados a ele, sem a conta — retenção contabilística de 10 anos. O pedido anonimizado passa ao estado **"arquivado"** ("Arquivado (RGPD)", migração 12, que arquiva também os já anonimizados): sai do quadro, das listas e das contagens ("Pedidos de orçamento novos", por estado, visitas); só o CEO o vê, com o filtro "Arquivados" (`GET orcamentos?estado=arquivado`); continua em Pagamentos e no CSV; não muda de estado nem de dados (409), e nenhum pedido passa a arquivado à mão.
- **Retentativas.** Tentar pagar outra vez os 19 € (falhou, cancelou, ou ainda está por pagar) não gasta o limite de 5 pedidos/h por IP de `/api/orcamento`: a conta tem uma tentativa nas últimas 24 h (limite próprio de 20/h por conta). Um pagamento por pagar da mesma conta é reaproveitado; um que falhou ou foi cancelado perde logo o pedido guardado.

## Rotas

| Método | Caminho | Quem | O quê |
|---|---|---|---|
| POST | `/api/orcamento` (com simulação) | conta confirmada | `202 {ok, pagamento}` (`PAGAMENTO_PEDIDO=0` → `201` como antes) |
| GET | `/api/conta/pagamentos/:ref[?fotos=1][&cancelado=1]` | conta dona | `{pagamento}`: `ref`, `fase`, `valor`, `descricao`, `estado`, `modo`, `url` se por pagar, `recibo` se pago; mais `fotos_token`/`fotos_max` para o 19 € pago há menos de 2 h. Com `cancelado=1` (regresso do Stripe) cancela a sessão por pagar |
| POST | `/api/conta/pagamentos/:ref/simular` | conta dona, **só no modo simulado** | `{resultado: sucesso\|falha\|cancelar}` → `{pagamento, voltar}` |
| POST | `/api/conta/pagamentos/stripe-webhook` | Stripe (assinado), **só no modo stripe** | `200 {resultado}` · `400` com assinatura inválida · `500` temporário (o Stripe repete) |
| POST | `/api/conta/pedidos/:id/aceitar` | conta dona | `{valor, plano}` → `{pedido, pagamento}` |
| POST | `/api/conta/pedidos/:id/pagar` | conta dona | `{fase: sinal\|restante}` → `{pagamento}`; `409` se já estiver pago ou ainda não se puder pagar |
| GET | `/api/conta/pedidos/:id/relatorio` | conta dona | relatório do cliente; `409` "em revisão" até ser libertado |
| GET | `/painel/api/orcamentos/:id/relatorio-cliente` | CEO | pré-visualização do relatório do cliente |
| POST | `/painel/api/orcamentos/:id/libertar-relatorio` | CEO | liberta o relatório e avisa o cliente por email |
| GET | `/painel/api/pagamentos-pedido[?estado=][&mes=][&formato=csv]` | CEO | todos os pagamentos dos pedidos (também dos anonimizados), com base, IVA e total; CSV `data;referencia;descricao;base;iva;total;estado;pedido` |
| POST | `/painel/api/orcamentos/:id/obra-concluida` | CEO, comercial | obra concluída: o restante fica disponível |

`GET /api/conta/pedidos` traz, em cada pedido:

- `pagamentos` (por fase: o pago ou o mais recente, com o recibo);
- `relatorio` (`em_revisao` ou `disponivel`) e `plano`;
- `sinal` (`{valor, pct, desconto, pago}`), `aguarda_sinal` e `pode_pagar_sinal`;
- `restante` e `pode_pagar_restante`;
- `plano_sugerido` e `modo`.

`GET /painel/api/orcamentos/:id` traz `pagamentos` (com `base`, `iva`, `iva_pct`), `valores_pagamento` (proposta, IVA, total, sinal, restante), `aguarda_sinal`, `relatorio_libertado`, `plano_escolhido`, `obra_concluida` e `anonimizado`. Cada pagamento para a conta (e o recibo) traz `base`, `iva` e `iva_pct`; cada pedido traz `proposta_iva` (`{base, iva_pct, iva, total}`). `GET /painel/api/eu`, `GET /api/conta/eu` e `GET /api/catalogo` trazem `pagamentos` (`{ativo, modo, demonstracao…}`) para as faixas.

## Configuração (`servidor/.env`, serviço painel)

| Variável | Por omissão | |
|---|---|---|
| `PAGAMENTOS_MODO` | `stripe` com `STRIPE_SECRET_KEY`, senão **desligados** | `simulado` só escrito (demonstração); o `.env.example` deixa-o comentado e o `instalar.sh` avisa num `.env` com `simulado` |
| `IVA_TAXA` | `23` | valor inicial de `iva_pct` (depois muda-se no painel) |
| `STRIPE_SECRET_KEY` | — | a mesma das subscrições |
| `STRIPE_PEDIDO_WEBHOOK_SECRET` | — | segredo do **endpoint próprio** (ver abaixo) |
| `STRIPE_PEDIDO_METODOS` | `card,mb_way,multibanco` | |
| `SITE_URL` | primeira de `SITE_ORIGENS`, `PUBLIC_URL` ou `https://DOMUS_HOST` | para os `success_url`/`cancel_url` do Stripe (obrigatório no modo stripe) |
| `PAGAMENTO_PEDIDO` | `1` | `0` = enviar sem pagar (como antes). Os testes antigos do painel usam `0` |

## Como ligar o Stripe (o que falta para os pagamentos reais)

1. No painel do Stripe (primeiro em **modo de teste**), ativar os métodos: **Cartões**, **MB WAY** e **Multibanco** (Settings → Payment methods). MB WAY e Multibanco só existem para contas em euros.
2. **Developers → Webhooks → Add endpoint** `https://HOST/api/conta/pagamentos/stripe-webhook`, com os eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

   Copiar o *Signing secret* para `STRIPE_PEDIDO_WEBHOOK_SECRET`.
3. No `.env`, preencher `PAGAMENTOS_MODO=stripe`, `STRIPE_SECRET_KEY=sk_test_…` e `SITE_URL=https://…`, e fazer `docker compose up -d painel`.
4. **Testar:**
   - cartão `4242 4242 4242 4242` → pago;
   - `4000 0000 0000 0002` → recusado (fica por pagar; o cliente volta com `cancelado=1` ou tenta de novo);
   - Multibanco em teste → `completed` com `unpaid` e depois `async_payment_succeeded`.

   Confirmar no painel: o pedido aparece depois de pago, os pagamentos têm o estado certo e a auditoria está completa.
5. Passar a `sk_live_…` e a um webhook live. **Faturação:** falta emitir a fatura-recibo de cada pagamento num programa certificado. Estes pagamentos não vão para o `pagamentos.csv` das subscrições; estão na tabela `pagamentos_pedido`, na ficha de cada pedido e em painel → Pagamentos → "Pagamentos dos pedidos" (com "Exportar CSV": data, referência, descrição, base, IVA, total, estado, pedido).

Ainda não feito:

- a devolução (reembolso) de um pagamento: faz-se no painel do Stripe e não é refletida aqui;
- o teste ponta a ponta contra o Stripe real (só um Stripe falso ao nível do `fetch`, nos testes).

## Testes

`painel/test/pagamentos-pedido.test.js`:

- valores e área servida;
- 19 € calculados no servidor e pedido invisível até pago;
- falha, sucesso e cancelar simulados, com as fotos depois de pago;
- idempotência (evento repetido, sucesso repetido, duplo clique) e evento com o valor errado;
- acesso cruzado (404), sem sessão (401) e origem estranha (403);
- IVA: 1000 € + 23 % → sinal 350 € e restante 861 € (base e IVA no recibo, no email e no painel), a proposta mudada com o sinal por pagar, e a taxa mudada no painel (6 % → 299 €);
- relatório em revisão, pré-visualizado pelo CEO e libertado, sem dados internos, com os preços do catálogo (não os do browser) e a lista de trabalho por ação;
- expiração em 24 h e fora da área; retentativas sem gastar o limite por IP;
- RGPD: pedido pago anonimizado, pagamentos ligados, lista global e CSV; pedido anonimizado = "arquivado" (fora das listas e dos novos, só o CEO, não muda) e a migração 12 (`crud.test.js`);
- modo: sem modo nem chave → desligados; `simulado` só explícito (faixa); só a chave → stripe;
- modo stripe: Checkout com os três métodos, `…/simular` 404 e webhook assinado (válido, inválido, repetido, sessão errada);
- webhook 404 no modo simulado.

A matriz de papéis (`papeis.test.js`) inclui as duas rotas novas do painel.
