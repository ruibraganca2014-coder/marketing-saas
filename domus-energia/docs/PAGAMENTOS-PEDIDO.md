# Pagamentos do pedido de orçamento

Pagamentos do fluxo simulador → proposta → obra. As subscrições mensais continuam no serviço `pagamentos/` (docs/PROTOCOLO-PLANOS.md).

## Decisões do dono (fase 3 — monetização)

- **Enviar o pedido é grátis.** O pedido passa logo a orçamento (estado `novo`) e o cliente tem na conta, sem revisão, o **relatório básico**: o intervalo de preço (de–até) e a lista de trabalho por divisão e ação, com os pacotes das Melhorias aceites. Sem material, sem preços por linha e sem plano técnico (`relatorioBasico`, `GET /api/conta/pedidos/:id/relatorio-basico`).
- **Relatório pormenorizado = 29 €** (`preco_relatorio_iva`, no painel em Catálogo → Configuração). É o relatório do cliente de antes (lista de trabalho, material e preço por divisão, quadro, mão de obra, deslocação). Continua revisto: o CEO só o liberta depois de o cliente o comprar ("Libertar relatório ao cliente", até 24 h). Com os pagamentos desligados não se compra; o CEO pode libertá-lo na mesma.
- **Visita técnica = deslocação até à localidade + 0,5 h × `tarifa_hora_iva`**, calculada no servidor (`valorVisitaCent`) e mostrada antes de pagar. Fora da área servida (`deslocacao_max_km`, outra ilha) não há visita (409, e o simulador e a conta dizem-no). Paga a visita, o CEO ou o comercial marca o dia e a hora no painel ("Marcar visita", `POST orcamentos/:id/marcar-visita`, ao lado da disponibilidade que o cliente deu no simulador); a conta mostra a data e o cliente recebe um email.
- **Onde se compra:** no passo Enviar, "O que quer receber?" — "Só o relatório básico — grátis", "Relatório pormenorizado — 29 €", "Relatório pormenorizado e visita — 29 € + X €" e "Só a visita técnica — X €" (`estado.compras = {relatorio, visita}`). O pedido é enviado primeiro (grátis) e a compra vai a seguir para o pagamento (página simulada ou Stripe Checkout) sobre o orçamento que já existe, com regresso à conta: **falhar ou cancelar nunca perde o pedido**. O que não se comprou compra-se depois na conta ("Comprar relatório pormenorizado (29 €)", "Marcar visita técnica (X €)"), até a proposta ser aceite.
- **Avaria rápida: paga-se ao enviar** o diagnóstico (o artigo `DIAG-AVARIA` do catálogo + as suas horas × tarifa, como o simulador) e a deslocação. É a visita pedida (o CEO marca a data como acima). Não há relatório pormenorizado à parte. Fora da área não se envia: 409 "fale connosco por telefone ou WhatsApp". Como os 19 € de antes, o pedido fica guardado no pagamento e só passa a orçamento quando é pago.
- **Desconto na obra:** tudo o que foi pago antes (relatório, visita, avaria, e os 19 € antigos) sai do sinal. **Sinal = 30 % × proposta com IVA − tudo o que já foi pago (nunca abaixo de 0).**
- **Intervalo da estimativa −10 % / +20 %** (`intervalo_menos_pct`, `intervalo_mais_pct`, migração 14, editáveis no painel), no simulador, no PDF, na ficha do painel, na conta e no relatório básico. O `margem_intervalo_pct` (15) fica na base mas já não se usa; um servidor antigo que só o tenha continua simétrico no simulador (`preco.js`).
- **Os pagamentos online incluem IVA.** A proposta do painel é **sem IVA**; o sinal e o restante são calculados sobre o total **com IVA** (taxa `iva_pct`, no painel em Catálogo → Configuração → "IVA dos pagamentos"; o valor inicial vem de `IVA_TAXA`, por omissão 23). O relatório, a visita e a avaria já são com IVA. Cada pagamento guarda a taxa usada (`iva_pct`, migração 11): o recibo, o email, a conta, o painel e o CSV mostram a base, o IVA e o total. Com o sinal pago, o restante usa a taxa do sinal.
- **Aceitar a proposta = pagar o sinal**, com o plano mensal (Base 4,99 €, Conforto 9,99 € ou Premium 19,99 €). Antes do sinal pago o painel mostra "Aceite — a aguardar sinal"; só depois o pedido passa a "Aceite". Aceite a proposta, já não se compra o relatório nem a visita.
- **O restante paga-se no fim da obra.** O painel marca "Obra concluída" e a conta mostra "Pagar o restante".
- **A subscrição começa quando a casa fica ligada** (conversão no painel): no modo simulado, a conversão cria o pedido-admin `plano` (`ativo`); no modo stripe, o cliente ativa-a na área de cliente, pelo serviço `pagamentos/`.
- **Pedidos antigos (19 €, fase `relatorio`)** continuam a ler-se: contam como relatório pormenorizado comprado e (com `com_visita = 1`) visita paga, e descontam no sinal como antes.

Exemplo com uma proposta de 1000 € (+ IVA 23 % = 1230 €), relatório pormenorizado (29 €) e visita (25 €: deslocação 6 € + 0,5 h × 38 €) comprados:

| Fase | Valor (com IVA) | Base + IVA |
|---|---|---|
| Relatório pormenorizado | 29 € | 23,58 € + 5,42 € |
| Visita técnica | 25 € | 20,33 € + 4,67 € |
| Sinal | 30 % × 1230 − 29 − 25 = 315 € | 256,10 € + 58,90 € |
| Restante | 1230 − 54 − 315 = 861 € | 700 € + 161 € |

Sem compras antes, o sinal é 369 € (e o restante 861 € na mesma). O cálculo está em `valores()` (`painel/src/pagamentos-pedido.js`): total = `comIva(valor_proposta, iva_pct)`; `pago_antes` = soma dos pagos nas fases `relatorio`, `relatorio_pormenorizado`, `visita`, `pormenorizado_visita` e `avaria`; sinal = `calcularSinal(total, pago_antes)`; restante = total − tudo o que já foi pago − o sinal por pagar.

## Relatório pormenorizado — conteúdo técnico

Só o **relatório pormenorizado** (pago, revisto e libertado) leva a parte técnica; o relatório básico (grátis) nunca a tem (`relatorioBasico` escolhe os campos à mão). Decisões do dono 4, 5, 7, 8 e 12 (verificação dos manuais e da RTIEBT, 2026-10-01). **Os textos e os desenhos são nossos**, feitos de raiz: não se copiam figuras, páginas nem passagens dos manuais de formação nem da RTIEBT; a forma dos símbolos segue só a ideia geral dos esquemas arquiteturais e fica a confirmar pelo técnico.

O módulo é **`web/simulador/simbolos.js`** (só depende de `planta-svg.js` para os pisos), copiado para `painel/public/vendor/simbolos.js` como o `planta-svg.js` (`cmp` tem de dar igual): o servidor do painel usa dele `esquemasDaPlanta` (puro, sem DOM) e o browser (conta e pré-visualização do painel) `seccaoTecnica`, que devolve os elementos DOM da secção. `relatorioCliente` (`painel/src/pagamentos-pedido.js`) junta ao relatório:

| Campo | O que é |
|---|---|
| `planta` | A planta (§2.1) só com o que se desenha: divisões (com `pontos`), elementos com `tipo`, posição, `rot`, `piso`, `divisao`, `props` (`dupla`, `comando`, `modelo`, `entrada`, `estore`) e `nome` (nas máquinas sem nome, o do modelo). **Sem a imagem de fundo.** `null` na avaria rápida. |
| `esquemas` | **Esquema por luz**, por divisão: `[{divisao, nome, piso, interruptores, luzes: [{nome, comando, texto}]}]`. O tipo de comando de cada ponto de luz é o da divisão, deduzido dos interruptores que lá estão (`props.comando`: simples, lustre, escada, inversor, botao; sem fios desenhados): inversor com um inversor ou 3+ comutadores de escada/inversor; escada com 2 (ou um de escada); senão lustre, botão de pressão ou simples. Sem interruptor na divisão: "simples (1 interruptor) — sem interruptor na planta, a confirmar na visita". `texto` = "Comando: escada (2 comutadores)", "Comando: inversor (4 sítios: 2 comutadores + 2 inversores)", "Comando: botão de pressão (3 botões + telerruptor)"… |
| `terra_nota` | "Verificar terra (PE) nas tomadas na visita." (decisão 4: só no relatório completo, sem pergunta no simulador). |
| `ensaios` | **Lista de ensaios** pela ordem da RTIEBT 612.1: `{introducao, lista: [{chave, nome, referencia, unidade, norma, medido}], notas, nota}`. Linhas: continuidade do PE e das equipotenciais (612.2, valor medido, sem limite); isolamento ≥ `ensaio_isolamento_mohm` MΩ a 500 V DC (612.3, Quadro 61A); terra < `ensaio_terra_ohm` Ω em habitação com disjuntor de entrada diferencial e RA × IΔn ≤ 50 V (801.5.6.1, 413.1.4.2); diferencial de 30 mA — dispara a uma corrente ≤ IΔn (Anexo B); o tempo ≤ `ensaio_diferencial_ms` ms vai marcado "referência EN 61008/61009; a RTIEBT só exige disparo ≤ IΔn". `nota` = "Valores de referência a confirmar pelo técnico." `medido` = `null` ("a medir na visita/obra") até o painel registar o valor. |
| `esquema_quadro` | O "Esquema do quadro elétrico" desenhado pelo eletricista no painel (`orcamentos.esquema_quadro`, JSON no formato da leitura do quadro: `disjuntor_geral`, `diferenciais`, `disjuntores`, `modulos_livres`, `ordem`…), tal e qual, ou `null`. A conta desenha-o com `web/simulador/quadro-desenho.js` (`desenharQuadroCliente`, só leitura) e um resumo em texto; o painel com `vendor/quadro-desenho.js` quando existir. Não há leitura automática da foto do quadro no simulador: o cliente só envia a foto. |

**Valores de referência dos ensaios** (migração 16, `INSERT OR IGNORE`; editáveis no painel em Catálogo → Configuração → "Ensaios (relatório pormenorizado)"; chaves em `CONFIG_ORCAMENTO`, **não públicas** — não saem no `GET /api/catalogo`): `ensaio_isolamento_mohm` 0,5 · `ensaio_diferencial_ms` 300 · `ensaio_terra_ohm` 100.

**Ensaios medidos** (migração 16, coluna `orcamentos.ensaios`, JSON `{continuidade_pe, isolamento, terra, diferencial, notas, data}`): na ficha do pedido, o formulário "Ensaios medidos" (CEO e comercial; `POST /painel/api/orcamentos/:id/ensaios`, campos opcionais, em branco = apaga a medição, auditoria `ensaios_registados`). `GET orcamentos/:id` traz `ensaios`; o relatório pormenorizado (conta e pré-visualização) mostra o valor medido na coluna "Medido" em vez do espaço em branco.

O que a conta (`web/conta.js` `desenharRelatorio` → `seccaoTecnica`) e a pré-visualização do painel ("Pré-visualizar versão do cliente") mostram, por esta ordem, depois do total:

1. **Planta técnica (simbologia normalizada)**, um desenho por piso (`desenharPlantaTecnica`): paredes em contorno, nome e área de cada divisão, símbolos de traço nos aparelhos (rodados como na planta): ponto de luz (círculo com cruz), tomada com terra (semicírculo com haste e o traço do PE; a dupla com um traço a mais), interruptor simples / comutador de lustre / comutador de escada / inversor (círculo com alavanca; os traços na ponta dizem o tipo), botão de pressão (círculo com ponto), campainha (meio círculo com base), quadro (retângulo com o canto cheio), aparelho de utilização (retângulo **numerado**; a lista "1 — Termoacumulador (Cozinha)" por baixo), detetor, porta e janela. Com a **legenda** dos símbolos usados nesse piso (`legendaPlanta`, `desenharSimbolo`). Tudo em `currentColor`: funciona no tema escuro e a impressão força preto sobre branco (`@media print`).
2. **Esquema por luz**: por divisão, uma linha por ponto de luz ("Ponto de luz 1 — Comando: escada (2 comutadores)") e, por tipo de comando usado, um **esquema funcional** fixo (`desenharEsquemaComando`, 5 desenhos: simples, lustre, escada, inversor, botão de pressão com telerruptor): a fase vai ao comando e volta ao recetor (retorno), o neutro vai direto ao recetor, o PE (tracejado) vai a todos os recetores.
3. A **nota de terra**.
4. A **lista de ensaios**: ensaio (com a referência da RTIEBT), valor de referência, "Medido (a medir na visita/obra)" com espaço em branco ou o valor registado; as notas do técnico; e o aviso "Valores de referência a confirmar pelo técnico".
5. O **esquema do quadro elétrico**, quando o eletricista o desenhou.

"Descarregar (imprimir / PDF)" na conta imprime o cartão com os SVG (CSS `imprimir-relatorio`; os desenhos a preto sobre branco, sem cortar um esquema a meio da página).

## Onde vive: no painel

O pagamento vive no **painel** (`painel/src/pagamentos-pedido.js`). As rotas ficam em `/api/conta/…`, que o Caddy já encaminha para o painel, por isso não há rotas novas no Caddy nem no lançador local.

Porquê no painel:

- é o painel que tem as contas, a sessão do cliente, os pedidos (`orcamentos`), a auditoria, os emails e o CSRF;
- o serviço `pagamentos/` só conhece clientes MQTT (a sessão é o código e a palavra-passe da casa) e o `_plano`, e ainda não há casa quando se paga o pedido;
- pôr os pagamentos em `pagamentos/` obrigava a partilhar a base e as sessões entre os dois serviços.

O Stripe é chamado pela **API REST** (`fetch`, form-encoded, com `Idempotency-Key`), sem juntar o SDK ao painel. O serviço `pagamentos/` continua com o SDK para as subscrições. A chave `STRIPE_SECRET_KEY` é a mesma. O webhook é outro, com o seu próprio segredo.

## Estados

`pagamentos_pedido` (migração 9; fases novas na migração 14), uma linha por pagamento:

| Campo | Significado |
|---|---|
| `ref` | referência aleatória `pp_…` (22 caracteres base64url): URL, recibo e `client_reference_id` do Stripe |
| `fase` | `relatorio_pormenorizado` (29 €) · `visita` · `pormenorizado_visita` (os dois, do passo Enviar) · `avaria` (diagnóstico + deslocação) · `sinal` · `restante` · `relatorio` (os 19 € do modelo antigo; só as linhas que já existem) |
| `estado` | `pendente` → `pago`, ou `pendente` → `falhado` / `cancelado` / `expirado` |
| `modo` | `simulado` · `stripe` |
| `retorno` | para onde se volta: `simulador` ou `conta` |
| `com_visita` | 1 quando o pagamento inclui a visita (visita, relatório + visita, avaria; nos 19 € antigos, 0 fora da área) |
| `plano` | sinal: o plano mensal escolhido |
| `pedido` | avaria por pagar: o pedido (JSON) que passa a orçamento quando é pago; apagado depois |

`pagamentos_eventos` guarda os ids dos eventos já tratados. Nos `orcamentos` há três colunas novas: `relatorio_libertado`, `plano_escolhido` e `obra_concluida`.

Pedido com simulação (grátis):

1. **Passo Enviar:** conta → contacto → "O que quer receber?" → "Enviar pedido" (ou "Enviar e pagar X €"). O `POST /api/orcamento` (com `compra`: `pormenorizado` · `visita` · `pormenorizado_visita`, ou nada) responde `201 {ok, pedido, fotos_token, fotos_max, pagamento?, pagamento_erro?}`: o orçamento já existe (`novo`) e a conta tem o relatório básico.
2. O simulador envia as fotos e mostra "Pedido enviado!". Com uma compra vai a seguir para `pagamento.url` (página simulada ou Stripe Checkout), com regresso a `conta.html?pagamento=<ref>`, que diz se foi pago. Sem `pagamento` (ex. fora da área com visita, ou pagamentos desligados) vem `pagamento_erro` e o "Pedido enviado!" diz que se compra na conta.
3. **Na conta:** "Comprar relatório pormenorizado (29 €)" e "Marcar visita técnica (X €)" (`POST /api/conta/pedidos/:id/pagar {fase}`). Um pagamento por pagar igual é reaproveitado; um que se sobrepõe (os dois juntos e depois só um) é cancelado.
4. Relatório pago → "em revisão" até o CEO o libertar → "disponível". Visita paga → o CEO marca a data → a conta mostra-a.

Avaria rápida (paga ao enviar):

1. **Passo Enviar:** "Pagar X € e enviar". `POST /api/orcamento` responde `202 {pagamento}` (fase `avaria`): o pedido fica guardado no pagamento, **a aguardar pagamento** (não aparece no painel); um segundo clique reaproveita o mesmo pagamento. Fora da área: 409.
2. **Volta a `simulador.html?pagamento=<ref>`**, que pede `GET /api/conta/pagamentos/<ref>?fotos=1`. Pago: o orçamento já existe, o simulador envia as fotos e mostra "Pedido enviado!". Falhou ou cancelou: fica no passo Enviar com a simulação intacta.
3. **24 h sem pagar:** `expirado`, e o pedido guardado sai (também dos falhados ou cancelados). A limpeza corre de 15 em 15 min e em cada pedido.

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
| (desligados) | sem `PAGAMENTOS_MODO` e sem `STRIPE_SECRET_KEY` (o `.env.example` já não põe `simulado`) | enviar é grátis na mesma; **não se compra nada** (o passo Enviar não mostra as compras, a conta diz "Pagamentos online desligados: fale connosco", `…/pagar` 404, uma `compra` no envio volta em `pagamento_erro`) e a avaria vai sem pagar; o CEO pode libertar o relatório sem compra; o painel mostra a faixa "**Pagamentos desligados**" e avisa no arranque |
| `simulado` | **só com `PAGAMENTOS_MODO=simulado` escrito**; sempre no local (`local/iniciar.js`) | faixa "**Modo de demonstração — pagamentos simulados**" no simulador, na conta e no painel; página própria `web/pagamento-simulado.html`, marcada "**SIMULAÇÃO — não é cobrado nada**", com o valor, a descrição e a referência vindos do servidor e três botões: "Pagar (simular sucesso)", "Simular falha" e "Cancelar". Cada botão chama `POST /api/conta/pagamentos/:ref/simular {resultado}` |
| `stripe` | por omissão com `STRIPE_SECRET_KEY` | Stripe Checkout (`mode=payment`, EUR, cartão, MB WAY e Multibanco); confirmação pelo webhook e pelo regresso do cliente |

Trocar de modo é só configuração. A página simulada gera um evento **no formato de um webhook do Stripe** (`checkout.session.completed` com `payment_status=paid`, `checkout.session.async_payment_failed` ou `checkout.session.expired`, com `data.object` = uma `checkout.session` com `client_reference_id`, `amount_total` e `currency`). O webhook usa a mesma função `tratarEvento`.

No modo stripe, `…/simular` responde **404**. No modo simulado, o webhook responde 404. O painel avisa no arranque quando está em modo simulado.

## Segurança

- **Os valores são sempre do servidor.** O relatório pela configuração; a visita pela localidade do pedido e pela configuração; a avaria pelo catálogo, pela tarifa e pela localidade; o sinal é 30 % do `valor_proposta` com IVA menos tudo o que já foi pago antes; o restante é o valor menos tudo o que já foi pago. O browser nunca manda o valor: um campo desconhecido dá 400. Um evento com outro valor, outra moeda ou outra sessão Stripe é ignorado.
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
- **Auditoria.** Cada passo fica registado: `pagamento_criado`, `pagamento_simulado`, `pagamento_confirmado`, `pagamento_falhado`, `pagamento_cancelado`, `pagamento_expirado`, `proposta_aceite_aguarda_sinal`, `proposta_aceite_cliente`, `relatorio_libertado`, `visita_marcada` e `obra_concluida`.
- **Emails** (no modo local vão para o registo):
  - pagamento recebido (com a descrição, o valor, a data e a referência) e pagamento não concluído;
  - relatório pronto;
  - visita técnica marcada (dia e hora);
  - obra concluída (com o restante).
- **RGPD.** Apagar uma conta (o CEO escreve o email da conta para confirmar) tira os pagamentos por pagar e o pedido guardado. Um pedido com pagamentos pagos **não se apaga: é anonimizado** (docs/CONTA-CLIENTE.md) e os pagamentos continuam ligados a ele, sem a conta — retenção contabilística de 10 anos. O pedido anonimizado passa ao estado **"arquivado"** ("Arquivado (RGPD)", migração 12, que arquiva também os já anonimizados): sai do quadro, das listas e das contagens ("Pedidos de orçamento novos", por estado, visitas); só o CEO o vê, com o filtro "Arquivados" (`GET orcamentos?estado=arquivado`); continua em Pagamentos e no CSV; não muda de estado nem de dados (409), e nenhum pedido passa a arquivado à mão.
- **Retentativas.** Tentar pagar outra vez a avaria (falhou, cancelou, ou ainda está por pagar) não gasta o limite de 5 pedidos/h por IP de `/api/orcamento`: a conta tem uma tentativa nas últimas 24 h (limite próprio de 20/h por conta). Um pagamento por pagar da mesma conta é reaproveitado; um que falhou ou foi cancelado perde logo o pedido guardado.

## Rotas

| Método | Caminho | Quem | O quê |
|---|---|---|---|
| POST | `/api/orcamento` (com simulação) | conta confirmada | `201 {ok, pedido, fotos_token, pagamento?, pagamento_erro?}` (`compra` opcional); avaria com os pagamentos ligados: `202 {ok, pagamento}` ou `409` fora da área |
| GET | `/api/conta/pagamentos/:ref[?fotos=1][&cancelado=1]` | conta dona | `{pagamento}`: `ref`, `fase`, `valor`, `descricao`, `estado`, `modo`, `url` se por pagar, `recibo` se pago; mais `fotos_token`/`fotos_max` para a avaria paga há menos de 2 h. Com `cancelado=1` (regresso do Stripe) cancela a sessão por pagar |
| POST | `/api/conta/pagamentos/:ref/simular` | conta dona, **só no modo simulado** | `{resultado: sucesso\|falha\|cancelar}` → `{pagamento, voltar}` |
| POST | `/api/conta/pagamentos/stripe-webhook` | Stripe (assinado), **só no modo stripe** | `200 {resultado}` · `400` com assinatura inválida · `500` temporário (o Stripe repete) |
| POST | `/api/conta/pedidos/:id/aceitar` | conta dona | `{valor, plano}` → `{pedido, pagamento}` |
| POST | `/api/conta/pedidos/:id/pagar` | conta dona | `{fase: sinal\|restante\|relatorio_pormenorizado\|visita\|pormenorizado_visita}` → `{pagamento}`; `409` se já estiver pago, fora da área (visita) ou ainda não se puder pagar |
| GET | `/api/conta/pedidos/:id/relatorio-basico` | conta dona | relatório básico (grátis): `{intervalo, com_deslocacao, acoes, divisoes: [{nome, trabalho}], melhorias, nota}` |
| GET | `/api/conta/pedidos/:id/relatorio` | conta dona | relatório pormenorizado; `409` por comprar ou "em revisão" até ser libertado |
| GET | `/painel/api/orcamentos/:id/relatorio-cliente` | CEO | pré-visualização do relatório do cliente |
| POST | `/painel/api/orcamentos/:id/libertar-relatorio` | CEO | liberta o relatório e avisa o cliente por email; `409` se o cliente ainda não o comprou (com os pagamentos ligados) |
| POST | `/painel/api/orcamentos/:id/marcar-visita` | CEO, comercial | `{data_visita: "AAAA-MM-DDTHH:MM"}` → estado "Visita marcada" (se estava antes), email ao cliente, data na conta |
| GET | `/painel/api/pagamentos-pedido[?estado=][&mes=][&formato=csv]` | CEO | todos os pagamentos dos pedidos (também dos anonimizados), com base, IVA e total; CSV `data;referencia;descricao;base;iva;total;estado;pedido` |
| POST | `/painel/api/orcamentos/:id/obra-concluida` | CEO, comercial | obra concluída: o restante fica disponível |

`GET /api/conta/pedidos` traz, em cada pedido:

- `pagamentos` (por fase: o pago ou o mais recente, com o recibo);
- `relatorio_basico` (true com simulação), `relatorio` (`por_comprar`, `em_revisao` ou `disponivel`; null na avaria) e `plano`;
- `compras` (`{ativas, pode, avaria, relatorio: {valor, comprado, pendente}, visita: {valor, paga, fora_area, pendente}}`);
- `sinal` (`{valor, pct, desconto, pago}`), `aguarda_sinal` e `pode_pagar_sinal`;
- `restante` e `pode_pagar_restante`;
- `plano_sugerido` e `modo`.

`GET /painel/api/orcamentos/:id` traz `pagamentos` (com `base`, `iva`, `iva_pct`), `compras` (como na conta), `valores_pagamento` (proposta, IVA, total, `pago_antes`, sinal, restante), `aguarda_sinal`, `relatorio_libertado`, `plano_escolhido`, `obra_concluida` e `anonimizado`. Cada pagamento para a conta (e o recibo) traz `base`, `iva` e `iva_pct`; cada pedido traz `proposta_iva` (`{base, iva_pct, iva, total}`). `GET /painel/api/eu`, `GET /api/conta/eu` e `GET /api/catalogo` trazem `pagamentos` (`{ativo, modo, demonstracao…}`) para as faixas.

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

- valores: sinal = 30 % com IVA − tudo o que foi pago antes (1000 € + 23 %, relatório 29 € + visita 25 € → 315 €, restante 861 €), intervalo −10/+20 (e a chave antiga simétrica, também no `preco.js`), visita = deslocação + 0,5 h × tarifa (fora da área: null), relatório pela configuração, área servida;
- enviar grátis: pedido `novo` logo, relatório básico (intervalo do total do servidor, lista de trabalho, sem material nem preços), fotos; intervalo configurável no painel;
- relatório pormenorizado 29 €: falhar não mexe no pedido; pago → em revisão; o CEO só liberta depois de comprado; recibo com base e IVA;
- visita: preço do servidor, fora da área recusada, "Marcar visita" (CEO/comercial, não técnico; sem hora 400), estado "Visita marcada", email com a data, conta com a data, disponibilidade na ficha;
- passo Enviar: "relatório e visita" = um só pagamento; comprar um deles na conta cancela o combinado por pagar; fora da área o pedido fica e vem `pagamento_erro`;
- avaria: paga ao enviar (diagnóstico + deslocação), invisível até paga, visita paga, fotos, nada de relatório à parte, fora da área 409; descontada no sinal;
- idempotência (evento repetido, sucesso repetido, duplo clique) e evento com o valor errado;
- acesso cruzado (404), sem sessão (401) e origem estranha (403);
- proposta com relatório e visita pagos: sinal, restante 861 €, no fim pagou exatamente a proposta com IVA; proposta mudada com o sinal por pagar; pedidos antigos de 19 € (contam como relatório e visita, sinal 350 €);
- relatório do cliente: preços do catálogo, lista de trabalho por ação, Melhorias;
- expiração da avaria em 24 h; retentativas sem gastar o limite por IP;
- RGPD: pedido pago anonimizado, pagamentos ligados, CSV com as fases novas; "arquivado" (fora das listas, não muda, nem a visita);
- IVA e preço do relatório configuráveis no painel;
- modo: desligados (envia grátis, compras desligadas com aviso, CEO liberta, avaria sem pagar); `simulado` só explícito; só a chave → stripe;
- modo stripe: Checkout da compra (volta à conta) com os três métodos, `…/simular` 404 e webhook assinado (válido, inválido, repetido, sessão errada); webhook 404 no modo simulado.

`crud.test.js`: a migração 14 (fases novas no CHECK, a linha dos 19 € igual, sequência e índice único refeitos, intervalo e relatório na configuração sem mexer no editado). A matriz de papéis (`papeis.test.js`) inclui `marcar-visita`.
