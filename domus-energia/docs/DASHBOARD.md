# Dashboard do negócio (Início do painel)

Decisões do dono de 2026-10-03: o dashboard vive no **Início** do painel (sem entrada nova no menu), por baixo dos números de sempre e por cima dos blocos que já existiam ("Para hoje", propostas aceites online, obras da semana…). Código: `painel/src/negocio.js` (cálculo), a rota `GET resumo/negocio` em `painel/src/api.js`, `painel/public/ecras/negocio.js` (ecrã, chamado por `ecras/inicio.js`), estilos em `painel/public/painel.css` ("Início: dashboard do negócio"); testes `painel/test/negocio.test.js` e a matriz de `papeis.test.js`. Sem migrações: usa só o que já estava guardado.

## 1. Quem vê o quê
| | CEO | Comercial | Técnico |
|---|---|---|---|
| Pedidos recebidos, taxa de aceitação, origem dos contactos | sim | sim (só contagens e percentagens) | não |
| Receita, margem, por receber | sim | não | não |
| Stock abaixo do mínimo, obras por agendar, avaliação média | sim | não | não |

O corte é feito **no servidor**: a resposta ao comercial só tem `papel`, `periodo`, `periodos`, `pedidos`, `aceitacao` e `origens` (nenhum valor em euros); o técnico recebe `403` (o Início dele fica igual e nem pede a rota). O `GET resumo` não mudou.

## 2. Períodos
- Botões: **Esta semana · Este mês** (abre aqui) **· Mês passado · Este ano** (`?periodo=semana|mes|mes_passado|ano`; outro valor: 400).
- Hora de **Lisboa**; semanas de **segunda a domingo**. As datas guardadas são instantes em UTC: cada período é o intervalo [meia-noite de Lisboa do primeiro dia, meia-noite de Lisboa do dia a seguir ao último) (`util.js` `meiaNoiteLisboa`). Um pedido das 23:30 de dia 30 (Lisboa) é desse mês, mesmo que em UTC já seja dia 1 ou ainda seja dia 30.
- **Comparação com o período anterior equivalente** (`periodoNegocio`):
  - um período **a decorrer** compara-se com a **mesma parte** do anterior — este mês no dia 14 → dias 1 a 14 do mês anterior; esta semana à quarta → segunda a quarta da semana anterior; este ano a 14 de outubro → 1 de janeiro a 14 de outubro do ano anterior. (Comparar meio mês com um mês inteiro dava sempre "a descer" no início do mês.) Dia 31 num mês anterior mais curto: o mês anterior inteiro; 29 de fevereiro: até 28;
  - **mês passado** compara-se com o mês inteiro antes dele.
- O ecrã escreve as datas dos dois períodos por baixo dos botões ("Este mês: 01/10/2026 a 14/10/2026, comparado com 01/09/2026 a 14/09/2026.").
- A diferença aparece como ↑ / ↓ com a percentagem e o valor de antes ("↑ 25 % · antes: 4"); quando o anterior é 0 não há percentagem e mostra-se a diferença ("↑ 3 · antes: 0"); a taxa de aceitação compara-se em pontos percentuais.

## 3. Indicadores
Os números 1 a 4 e o 9 são do período; os 5 a 8 são de **agora** (não mudam com o período).

### 1. Pedidos recebidos
- **Fórmula:** n.º de pedidos (`orcamentos`) com a data de criação (`criado`) dentro do período.
- **Conta:** todos os pedidos que existem na base — do site, do simulador e os criados no painel pela equipa —, seja qual for o estado, incluindo os **arquivados pelo RGPD** (a data de criação fica).
- **Não conta:** os pedidos **apagados** pelo RGPD ou pela retenção (já não existem); a avaria rápida por pagar (só é pedido depois de paga, com a data do pagamento).
- **Por semana:** as últimas 8 semanas (segunda a domingo), com a atual, em barras; não depende do período escolhido.

### 2. Taxa de aceitação
- **Fórmula:** propostas aceites ÷ propostas enviadas × 100, arredondada às unidades. No ecrã: "Propostas enviadas no período que já foram aceites: 2 de 3".
- **Conjunto (coorte):** os pedidos cuja proposta foi **enviada no período** — a **primeira** vez que o pedido passou a "proposta enviada" (registo `orcamento_atualizado` com `estado: proposta_enviada` na auditoria; reenviar não conta outra vez). Desses, são "aceites" os que **hoje** estão no estado "aceite" (sinal pago, ou aceite à mão), tenham sido aceites dentro ou fora do período. Por isso nunca passa de 100 %, e a de um período recente sobe enquanto os clientes ainda estão a decidir.
- **Não conta:** uma proposta aceite online ainda sem o sinal pago ("Aceite — a aguardar sinal") ainda não é aceite; um pedido posto em "aceite" sem nunca ter estado em "proposta enviada" não entra (nem em cima nem em baixo); um pedido que deixou de estar aceite (sinal devolvido → perdido) conta como enviada e não aceite; os pedidos arquivados ou apagados pelo RGPD saem (o histórico deles sai da auditoria).
- **Limite conhecido:** a data do envio vem da auditoria, que guarda as últimas 50 000 entradas.
- Sem propostas enviadas no período: "—" (não se divide por zero).

### 3. Receita
- **Fórmula:** dinheiro **recebido** no período = pagamentos dos pedidos pagos (pela data em que foram pagos, `pagamentos_pedido.pago`) − devoluções (pela data em que foram feitas, `devolvido`) + mensalidades dos planos (linhas do `pagamentos.csv`, pelo dia da linha).
- **Sem IVA** é o valor principal; **com IVA** vai por baixo. Cada pagamento de pedido é partido pela sua taxa (`iva_pct`; os antigos sem taxa: 23 %), com o mesmo arredondamento do ecrã Pagamentos; as mensalidades trazem os dois valores no CSV.
- **Conta:** todas as fases (relatório, visita, avaria, sinal, restante), também a visita a que o cliente faltou e a visita sem defeito; os pagamentos de pedidos **arquivados ou apagados pelo RGPD** (o dinheiro recebido fica na contabilidade); os pagamentos **simulados** do modo de demonstração (como no ecrã Pagamentos), com o aviso "Inclui N pagamentos simulados".
- **Não conta:** pagamentos por pagar, falhados, cancelados ou expirados; uma devolução por transferência **ainda por fazer** (só desconta quando o CEO a marca "Devolvido").
- Uma devolução desconta no período em que foi feita, não no do pagamento (um mês pode ficar negativo).
- O ecrã separa "Pedidos" de "planos" e mostra o total devolvido.

### 4. Margem
- **Fórmula:** receita sem IVA (a do n.º 3) − custo de compra do material das obras − eletricistas externos. Sem custos fixos e sem mão de obra própria.
- **Material — quando conta:** no período em que a obra foi **dada por concluída no pedido** (`orcamentos.obra_concluida`: o botão "Obra concluída" ou a aprovação do trabalho de um eletricista externo — é quando o material sai do stock). Uma obra marcada concluída só no ecrã Obras ainda não conta (falta o CEO confirmar).
- **Material — quanto:** os artigos da simulação do pedido (`itens`: SKU e quantidade, os mesmos do stock) × o **custo de compra de hoje** no catálogo (`preco_compra_cent`; não se guarda o custo da altura).
- **Custo em falta:** um artigo com preço de venda e sem custo de compra conta 0 — a margem fica **acima do real**. O ecrã avisa "A margem está acima do real: N artigos usados nas obras deste período não têm custo de compra (…)" com a ligação "Preencher o custo no Catálogo" (`sem_custo.artigos`, e os 10 primeiros em `sem_custo.lista`). Um artigo sem custo e com venda 0 (ex.: troca de uma máquina) não é material e não conta como em falta — a regra de `stock.js` `custoMaterial`.
- **Obras sem lista de material:** pedidos sem simulação (formulário do site, criados no painel, ou arquivados pelo RGPD, que perdem a simulação) — o material não se conhece e não entra; o ecrã diz quantas são (`obras_sem_lista`).
- **Eletricistas externos — quando conta:** o valor fixado ao **aprovar** o trabalho (`trabalhos_eletricista.valor_cent`, sem IVA), no período da **aprovação** (`aprovada`) — esteja já pago ou ainda por pagar; a "ida sem defeito" (`regresso_cent`) no período da decisão (`regresso_desde`), nos trabalhos aprovados ou pagos. É a data em que a obra fica concluída (aprovar conclui a obra), a mesma do material. Trabalhos por aprovar ainda não contam.
- **Módulo desligado** (`ELETRICISTAS` ≠ 1): eletricistas = 0, sem erros.
- **Atenção:** a receita é por data de recebimento e os custos por data de conclusão da obra; o sinal de uma obra pode cair num mês e os custos dela noutro.

### 5. Por receber (agora)
- **Fórmula:** soma do que os clientes já foram chamados a pagar e ainda não pagaram: o **sinal** de uma proposta que o cliente aceitou online (desde `proposta_aceite`) e o **restante** de uma obra dada por concluída (desde `obra_concluida`). É a regra dos lembretes de pagamento em falta (`pagamentos-pedido.js` `emFalta`). Valores **com IVA** (o que o cliente paga).
- **Lista:** os 5 mais antigos (pedido, nome, sinal ou restante, valor, desde quando), com ligação ao pedido.
- **Não conta:** pedidos sem conta de cliente (não pagam online) e tudo, se os pagamentos online estiverem desligados (o ecrã diz "Pagamentos online desligados"); compras opcionais (relatório, visita); pedidos arquivados (deixam de estar "aceite").

### 6. Stock abaixo do mínimo (agora)
- N.º de artigos de **stock gerido** (com mínimo ou com movimentos) com o disponível (em armazém − reservado) abaixo do mínimo ou negativo — os mesmos que o ecrã Stock marca "Abaixo do mínimo" (`stock.js` `abaixoDoMinimo`). Ligação ao Stock.

### 7. Obras por agendar (agora)
- N.º de obras com `por_agendar` (nasceram com o sinal pago e ainda ninguém escolheu a data), agendadas ou em curso; as canceladas e as concluídas não contam. Ligação às Obras.

### 8. Avaliação média dos clientes (agora)
- Média (1 casa decimal) e n.º de avaliações de **todas as que existem** (não depende do período).
- **Uma por pedido:** a da confirmação do trabalho de um eletricista externo (`trabalhos_eletricista.estrelas`; a mais recente do pedido) e, só quando o pedido não tem nenhuma dessas, a que o cliente deu na conta (`orcamentos.avaliacao_estrelas`). A mesma obra nunca conta duas vezes.
- As dos pedidos arquivados contam (são só estrelas); as dos apagados saem com eles. Sem avaliações: "—".

### 9. Origem dos contactos
- Os pedidos **recebidos no período** (como no n.º 1) agrupados por `origem_contacto` ("Sem origem" quando não há), e quantos de cada estão **hoje** "aceite". Ordenados pelo n.º de pedidos.
- Os arquivados pelo RGPD contam como recebidos, não como aceites (o estado passou a "arquivado").

## 4. API
`GET /painel/api/resumo/negocio?periodo=mes` (ceo, comercial). Valores em euros (números com 2 casas, calculados em cêntimos no servidor).

```
{
  papel, periodos: ["semana", "mes", "mes_passado", "ano"],
  periodo: { chave, inicio, fim, hoje, completo, anterior: { inicio, fim } },        // dias de Lisboa, extremos incluídos
  pedidos: { n, anterior, variacao: { dif, pct }, semanas: [{ inicio, fim, n } × 8] },
  aceitacao: { enviadas, aceites, taxa, anterior: { enviadas, aceites, taxa }, variacao_pontos },
  origens: [{ origem, pedidos, aceites }],
  // só CEO:
  receita: { sem_iva, com_iva, pagamentos, devolvido, pedidos_sem_iva, planos_sem_iva, simulados, anterior: { sem_iva, com_iva }, variacao: { dif, pct } },
  margem: { valor, material, eletricistas, obras, obras_sem_lista, sem_custo: { artigos, lista: [{ id, sku, nome }] }, anterior: { valor }, variacao: { dif, pct } },
  por_receber: { online, total, n, lista: [{ id, nome, fase, valor, desde }] },
  stock_abaixo_minimo, obras_por_agendar, avaliacao: { n, media }
}
```
`pct` é inteiro e `null` quando o anterior é 0; `taxa` e `media` são `null` sem dados; `variacao_pontos` é `null` quando um dos períodos não tem propostas enviadas.

## 5. Desempenho
Contagens e somas em SQL; por pedido só se lê o que o período pede: as linhas de pagamento do período (para partir o IVA com o arredondamento de sempre), a simulação das obras concluídas no período (material) e os pedidos com um pagamento em falta (por receber). A taxa de aceitação percorre a auditoria (no máximo 50 000 entradas) uma vez por pedido à API.

## 6. Ecrã
- Bloco "O negócio" no Início, com os quatro botões do período (botões verdadeiros com `aria-pressed`; a 375 px ficam em duas linhas) e a linha das datas com `role="status"` (é ela que anuncia a mudança de período). Mudar de período volta a pedir só este bloco.
- Cartões com o valor, a diferença para o período anterior (seta e texto: "Subiu" / "Desceu" para leitores de ecrã) e uma linha de ajuda com a definição curta; as barras das 8 semanas têm o texto alternativo com os números.
- Base vazia: zeros e "—", sem percentagens; "Sem pedidos neste período." na origem.

## Início simples do CEO e ecrã "Números" (decisão do dono, 2026-10-05)

O Início do CEO deixou de mostrar os indicadores e o bloco "O negócio": tem três blocos — **Para tratar** (uma linha por coisa à espera dele, só as que têm alguma coisa: alertas críticos, pedidos novos, propostas de eletricistas por rever, propostas aceites por marcar, mensagens de clientes por responder, candidaturas de eletricistas, trabalhos concluídos por aprovar, pagamentos a eletricistas, tarefas para hoje ou atrasadas), **Esta semana** (visitas marcadas e obras, até 8) e **Por receber** (os 5 mais antigos, do `resumo/negocio`). As contagens vêm em `GET resumo` → `tratar` e `visitas_semana` (só para o CEO; `painel/src/api.js h.resumo`; teste `painel/test/inicio-ceo.test.js`). Tudo o que o Início tinha antes (indicadores, "O negócio", distribuições de clientes por plano e por estado) está no ecrã **Números** (`#/numeros`, só CEO, botão "Ver números" no fim do Início; fora do menu curto). O Início do comercial e do técnico não mudou.
