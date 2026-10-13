# Eletricistas externos (fase 4)

Eletricistas que trabalham para a Domus Energia com as condições da Domus (desde 2026-10-13 o n.º de habilitação na DGEG é opcional: quem não o tem faz a obra, e um técnico responsável assina-a): o cliente continua a ser da Domus e o contacto com ele é sempre em nome da Domus. Esta página descreve as **rondas 1 a 3**: candidatura, aprovação no painel, atribuição e bolsa (com aviso por email), a área do eletricista com a ficha de obra (material, fotos antes e depois, ensaios, diagnóstico) até "Obra concluída", a confirmação e a avaliação do cliente, a aprovação do CEO, o pagamento ao eletricista (fatura-recibo, IBAN, "Pago") e apagar um eletricista (RGPD).

Código: `painel/src/eletricistas.js` (rotas `/api/eletricista/*` e a lógica), `painel/src/api.js` (rotas do painel), `painel/src/db.js` (migrações 27 a 31, 39, 45, 47 a 50 e 52), `painel/src/conta.js` (confirmação do cliente), `painel/src/pagamentos-pedido.js` (visita sem defeito), `web/trabalhe-connosco.*`, `web/eletricista.*`, `web/conta.js`, `painel/public/ecras/eletricistas.js`, `painel/public/ecras/atribuicao.js` e `painel/public/ecras/pagamentos.js`. Testes: `painel/test/eletricistas.test.js` (ronda 1 e interruptor), `painel/test/eletricistas-obra.test.js` (ronda 2), `painel/test/eletricistas-pagamentos.test.js` (ronda 3) e `painel/test/especialidades.test.js` (especialidades, prioridade, n.º da DGEG opcional e técnico responsável; decisões de 2026-10-13).

## Interruptor: o módulo liga-se com `ELETRICISTAS=1`

Publicado em 2026-10-04 (decisão do dono: "ligar já, e eu sou o primeiro eletricista"). O módulo continua atrás do interruptor `ELETRICISTAS` (o `servidor/docker-compose.yml` passa-o ao painel; `1` no `.env` do servidor liga; sem ele as rotas `/api/eletricista/*`, as do painel e o ecrã "Eletricistas" dão 404 e a página de candidaturas mostra só uma linha). Com a publicação entraram: a ligação "Trabalhe connosco" no rodapé da página inicial, a entrada no `sitemap.xml`, `index, follow` com `canonical` em `trabalhe-connosco.html` e a cláusula "Fim do trabalho" nos Termos.

**A tratar pelo dono, fora do código:** o CAE da empresa ainda não inclui obras elétricas e o IVA/art. 53.º das faturas-recibo dos eletricistas — contabilista, antes de haver eletricistas de fora a trabalhar a sério.

## Caminho simples do pedido (decisões do dono, 2026-10-04)

O dono pediu "a maneira mais simples: o pedido vai para a bolsa dos eletricistas". Decidido, pergunta a pergunta:

1. **Entrada na bolsa: com um clique do CEO** — "Pôr na bolsa" na ficha do pedido (nada entra sozinho).
2. **Visita:** o cliente paga-a antes (como estava). **Enquanto os pagamentos online estiverem desligados** (`config.pagamentoPedido` falso), um pedido por visitar (novo, contactado, visita marcada) atribui-se na mesma, como **visita sem custo**: o eletricista não recebe por ela (`recebeDe` devolve `gratis`, total 0) e a área dele diz "só recebe se o cliente aceitar a proposta e fizer a obra". Com a Stripe ligada volta sozinho a "visita paga".
3. **Proposta do eletricista** (`POST /api/eletricista/trabalhos/:id/proposta`, migração 39 `trabalhos_eletricista.proposta`): depois de marcar a visita, o eletricista indica as **horas de trabalho** (0,5 a 500) e o **material do catálogo** com quantidades (até 60 artigos; `GET /api/eletricista/catalogo` dá só artigo e categoria, nunca preços) e notas. **Nunca escreve euros.** Os CEO recebem um email. Pode enviar outra vez (substitui).
4. **O CEO revê e envia:** a ficha do pedido leva `proposta_eletricista` — as horas, o material (com o valor de cada linha) e a sugestão sem IVA: mão de obra = horas × `tarifa_hora_iva`, material = preços de venda do catálogo, deslocação = a do concelho. "Preencher pela proposta do eletricista" põe os três valores nas partes da proposta; o CEO acerta e grava como sempre (é ele que envia ao cliente).
5. Aceite a proposta e criada a obra, o CEO atribui a obra (ao mesmo eletricista ou à bolsa) como já acontecia.

## Propostas na bolsa (decisão do dono, 2026-10-10)

Interruptor `PROPOSTAS_BOLSA` (`config.propostasBolsa`): **ligado por omissão**; `PROPOSTAS_BOLSA=0` volta ao caminho de cima em tudo. Só muda os pedidos **com planta postos na bolsa** (trabalho `visita`, modo `bolsa`). As avarias e as atribuições diretas ("Atribuir a…") ficam como estavam.

1. **Vários propõem; não há "Aceitar".** `POST /api/eletricista/bolsa/:id/aceitar` numa visita dá 409 a dizer para enviar a proposta. Cada eletricista do concelho vê o que a bolsa já dava (concelho, título, planta e relatório técnico sem preços) **e as fotos que o cliente enviou** (`GET /api/eletricista/bolsa/:id/fotos/:foto`, com o mesmo critério da bolsa: 404 para quem não vê o trabalho; só o nome da divisão, nunca a legenda do cliente nem o n.º do pedido). Propõe com `POST /api/eletricista/bolsa/:id/proposta` `{horas, material: [{sku, qtd}], notas, disponibilidade}` — as regras da proposta depois da visita, mais **"Quando pode ir?"** (obrigatório). Pode corrigi-la enquanto o trabalho está na bolsa. Os CEO recebem um email na primeira (corrigir não volta a avisar). A resposta da bolsa leva `propostas_bolsa` e cada trabalho `por_proposta`, para a página não adivinhar.
2. **Tabela comparativa** (ficha do pedido, "Eletricista externo"; `GET /painel/api/orcamentos/:id/eletricista` → `propostas`): eletricista, horas, material, **preço para o cliente sem IVA** (mão de obra + material + deslocação: o cálculo de `proposta_eletricista`), **o que fica para a Domus** (preço menos o que o eletricista recebe: a percentagem dele × mão de obra + deslocação), avaliação média e n.º de trabalhos concluídos, disponibilidade e data. Não há prazo para escolher.
3. **Escolher** (`POST /painel/api/orcamentos/:id/eletricista` `{acao: 'escolher', eletricista_id}`, só CEO, com o trabalho na bolsa): o trabalho passa para esse eletricista (`aceite`, percentagem fixada, **sem `aceite_em`**) e a proposta dele é copiada para `trabalhos_eletricista.proposta` — "Preencher pela proposta do eletricista" funciona como sempre. Ele recebe um email; os outros que estavam à espera recebem outro e ficam de **reserva**.
4. **Reserva, por pedido** (tabela `propostas_bolsa`, migração 45; estados `enviada`, `escolhida`, `reserva`, `retirada`). Se o escolhido for retirado (pelo CEO, ou pelo "Não aceito" do cliente) a proposta dele volta a `reserva`; se **largar**, fica `retirada` e não volta a aparecer. Posto o pedido outra vez na bolsa, as de reserva estão na tabela e escolhe-se logo.
5. **Antes de o cliente aceitar** o escolhido não vê o cliente, não marca visita nem mexe na ficha, e as 48 h não contam (`espera_cliente`; na área dele: "Escolhido. À espera de o cliente aceitar a proposta."). O trabalho continua aberto com o pedido em `proposta_enviada`.
6. **O cliente aceita** (o pedido passa a `aceite` e a obra nasce — `api.js obraDoPedido`, em todos os caminhos): a visita dele fecha sem email (`retirado`, evento por `sistema`) e nasce o trabalho `obra`, modo `direto`, com a mesma percentagem e `aceite_em` = agora. Email: "O cliente aceitou a proposta: tem 48 h para marcar a visita. Pode fazer a obra nessa visita." Daí em diante é o fluxo de obra de sempre; a visita está incluída (não se paga à parte).
7. Se a obra caducar ou ele a largar vale a regra dos trabalhos diretos: volta ao CEO, por atribuir.

### Decisões do dono de 2026-10-11 (só com `PROPOSTAS_BOLSA` e o módulo ligados)

- **A visita técnica já não se paga à parte** nos pedidos que não são avaria (`pagamentos-pedido.js visitaIncluida`): com os pagamentos online ligados o pedido por visitar vai para a bolsa **sem pagamento nenhum** (`tipoAtribuivel`); a visita vem depois de o cliente aceitar e vai incluída no sinal. A avaria continua a exigir o diagnóstico pago. O resto (compra recusada pelo servidor, conta, simulador): docs/PAGAMENTOS-PEDIDO.md "Decisões de 2026-10-11".
- **O cliente paga o restante logo que confirma** a obra feita por um eletricista externo (trabalho `obra` em `confirmada`: o "Sim", os 7 dias sem resposta ou o "sem defeito" do CEO), **antes de o CEO aprovar** (`clienteConfirmou` → `pagamentos-pedido.js restanteDisponivel`). A aprovação continua a ser precisa para a obra ficar concluída no painel (stock, `obra_concluida`) e para pagar ao eletricista: as três condições de `estadoPagamento` não mudam, e a aprovação pode vir antes ou depois do pagamento. Com "Não" (ou se o CEO devolver o trabalho) não há pagamento.
- **O preço da proposta é definitivo, salvo surpresa no local** (só textos): a conta di-lo em "A nossa proposta" e ao confirmar a aceitação; a ficha da obra vinda de proposta (`de_proposta` em `GET trabalhos/:id`) avisa o eletricista para não avançar com trabalho a mais sem a Domus (o cliente tem de aceitar primeiro). O mecanismo é o "Trabalho a mais", abaixo (a nota fixa da ficha deu lugar ao bloco "Encontrou trabalho a mais?").
- `GET trabalhos` leva `propostas_bolsa: true` (o estado vazio diz "em que for escolhido (ou que aceitar)").

## Trabalho a mais (decisão do dono, 2026-10-11)

O preço da proposta aceite é definitivo. Se no local o eletricista encontrar o que não se via na planta nem nas fotos:

1. **O eletricista propõe** na ficha da obra ("Encontrou trabalho a mais?"): o que encontrou, as horas e o material do catálogo. Nunca escreve preços, não fala de preços com o cliente e não vê o preço ao cliente. Só numa obra sua ainda em curso (`aceite` ou `visita_marcada`), e só **um à espera de resposta de cada vez**. Enquanto está por rever pode retirá-lo.
2. **O CEO põe o preço** na ficha do pedido (cartão "Trabalho a mais"): mão de obra e material, em euros sem IVA, pré-preenchidos com a sugestão (horas × a tarifa/hora; material ao preço de venda). "Enviar ao cliente" manda o email "trabalho a mais por aceitar" com o total com IVA; "Não avançar" (com o motivo, que o eletricista vê) fecha-o. No Início do CEO aparece "trabalho a mais por rever". O comercial vê o cartão sem botões.
3. **O cliente responde na conta** ("Trabalho a mais" no cartão do pedido): "Aceito" ou "Não aceito" (com um texto opcional, que só a empresa vê). Sem resposta, esse trabalho não é feito. O eletricista recebe um email com a resposta.
4. **Dinheiro:** só o que o cliente aceitou conta. O valor soma à base e ao total com IVA do pedido, logo ao **restante** que o cliente paga no fim (`pagamentos-pedido.js valores`, campo `extras`); não há pagamento a meio, e o sinal e a regra da obra mínima não mudam. Ao aprovar o trabalho, o eletricista recebe a mais a percentagem dele × a mão de obra do trabalho a mais aceite (`valor_detalhe`: `extras` e `parte_extras`).
5. **Concluir fica bloqueado** enquanto houver um trabalho a mais à espera do CEO ou do cliente (`409 Há um trabalho a mais à espera de resposta.`; também em `falta`).

Estados (`trabalhos_extra.estado`, migração 47): `proposto` (à espera do CEO) → `enviado` (à espera do cliente) → `aceite` ou `recusado`; `retirado` = o eletricista retirou, o CEO não avançou, ou a obra saiu do eletricista (largou, caducou ou foi retirada) com o trabalho a mais ainda à espera. Com o restante já pago online não se propõe (`409`): trata-se por fora. Ao apagar a conta do cliente, o texto que ele escreveu ao não aceitar sai (`nota`).

Rotas: `POST /api/eletricista/trabalhos/:id/extra` `{descricao, horas, material: [{sku, qtd}]}` e `POST …/extra/:extra/retirar`; `POST /painel/api/orcamentos/:id/extras/:extra/enviar` `{mao_obra, material}` e `…/nao-avancar` `{motivo}` (só CEO); `POST /api/conta/pedidos/:id/extras/:extra/aceitar` e `…/recusar` `{texto?}`. A ficha do eletricista leva `extras` e `pode_extra`; a ficha do pedido no painel leva `extras` (com `sugestao`, `valores` e `recebe`); o pedido na conta leva `extras` (só os enviados, aceites e não aceites: `{id, descricao, valor, valor_iva, estado, quando}`) e `trabalho_a_mais` (`{valor, total}` do que aceitou, ou `null`). Tudo isto só existe com o módulo ligado (`ELETRICISTAS=1`). Testes: `painel/test/trabalho-a-mais.test.js`.

## Ida perdida (decisão do dono, 2026-10-11)

O cliente pode mudar a visita sem custo até 24 horas antes. Se o eletricista for à hora marcada e não puder entrar por motivo do cliente, sem aviso com 24 horas, o cliente paga **a deslocação dessa ida**, que soma ao restante; o eletricista recebe essa deslocação a mais; marca-se nova visita. **O eletricista assinala, o CEO confirma.**

1. **O eletricista assinala** na ficha da obra, na secção "Visita": botão "O cliente não estava" (dois toques), com uma nota opcional (até 300 caracteres). Só numa obra sua com a visita marcada e **só depois da hora dela** (pelo relógio do servidor; antes, `409`). Só **uma à espera de cada vez**, e cada visita marcada só se assinala uma vez. Os CEO recebem um email.
2. **Enquanto espera**, nada muda no trabalho (a mesma data, o mesmo estado). A obra não se dá por concluída sem a resposta (`409 Há uma ida perdida à espera da Domus Energia.`; também em `falta`).
3. **O CEO decide** na ficha do pedido (cartão "Visita perdida": a data da visita, a nota, a deslocação sem e com IVA e o que o eletricista recebe); no Início aparece "ida perdida por confirmar". O comercial vê o cartão sem botões.
   - **"Confirmar: cobrar a deslocação"**: a deslocação (a do concelho, no mínimo 25 € com IVA — `IDA_PERDIDA_MINIMO`, decisão do dono de 2026-10-12, para Lisboa não ficar a 0 €) fica guardada em cêntimos sem IVA (`idas_perdidas.deslocacao_cent`). O cliente recebe o email "não o encontrámos na visita" com o valor com IVA; o eletricista é avisado. O trabalho volta a "por marcar visita": fica `aceite`, sem data, com **48 h novas** para marcar (`aceite_em` passa a ser o momento da confirmação) e a obra volta a `por_agendar` — a não ser que o eletricista já tenha marcado outra data entretanto, que então fica.
   - **"Anular (o cliente tem razão)"**, com o motivo (obrigatório): nada muda no dinheiro nem no trabalho; o eletricista vê "Anulada" e o motivo; o cliente não recebe email.
4. **De onde vem o valor:** é a deslocação do concelho do pedido, uma ida e volta (`deslocacaoServidor`, a mesma conta da visita técnica e da deslocação sugerida na proposta), com o IVA do pedido tirado. Não é a deslocação escrita na proposta (essa pode levar vários dias de obra). Com 0 € (ou fora da área servida) não se confirma (`409`).
5. **Dinheiro:** cada ida confirmada soma à base e ao total com IVA do pedido, logo ao **restante** e ao que falta (`pagamentos-pedido.js valores`: `idas` sem IVA e `idas_iva`); o sinal e a obra mínima não mudam. Pode haver mais do que uma por pedido (cada uma soma). O eletricista recebe a deslocação **inteira** (sem IVA), como a da obra: entra na estimativa (`recebe_idas` no painel) e no valor fixado ao aprovar (`valor_detalhe.idas_perdidas`). Uma ida já confirmada fica, mesmo que o trabalho mude de mãos (o cliente continua a dever essa deslocação); quem larga o trabalho não recebe por ela, como no resto.
6. **Limites:** não se assinala depois de o trabalho ser dado por concluído; se o trabalho sai do eletricista (largou, caducou ou foi retirado), a que estava à espera fica anulada com o motivo "O trabalho saiu do eletricista."; com o restante já pago não se assinala nem se confirma (`409`).

Estados (`idas_perdidas.estado`, migração 50): `proposta` (à espera do CEO) → `confirmada` ou `anulada`. A `nota` é do eletricista e o `motivo` é do CEO (não são texto do cliente: ficam quando a conta do cliente é apagada; o registo sai com o pedido).

Rotas: `POST /api/eletricista/trabalhos/:id/ida-perdida` `{nota?}`; `POST /painel/api/orcamentos/:id/idas-perdidas/:ida/confirmar` e `…/anular` `{motivo}` (só CEO). A ficha do eletricista leva `idas_perdidas` (`{id, visita, nota, estado, quando, motivo, recebe}`) e `pode_ida_perdida`; a ficha do pedido no painel leva `idas_perdidas` (com `deslocacao`, `deslocacao_iva`, `recebe` e `pode_decidir`) e `valores_pagamento.idas_perdidas`; o pedido na conta leva `idas_perdidas` (só as confirmadas: `{visita, valor, valor_iva}`), que a conta mostra como "Ida perdida em <data>: X € (com IVA), soma ao que paga no fim."; o resumo do CEO leva `tratar.idas_perdidas` e `tratar.idas_perdidas_pedido`. Só com o módulo ligado. Testes: `painel/test/ida-perdida.test.js`.

## Parar a obra por segurança (decisão do dono, 2026-10-11)

Se o cliente não aceita um trabalho a mais e o que se encontrou impede uma instalação segura, a obra não avança e devolve-se o sinal **menos o material já encomendado à medida e o trabalho já feito**. **O CEO indica o que fica retido.**

1. **Na ficha do pedido** (só CEO), "Parar a obra por segurança": num pedido `aceite`, com o sinal pago, a obra ainda por concluir e o restante por pagar. O formulário pede o motivo (10 a 600 caracteres; o cliente lê-o), o "Material já encomendado" e o "Trabalho já feito" (€ com IVA, ≥ 0; a soma não passa o sinal pago) e mostra em direto "Sinal pago X € − retido Y € = a devolver Z €". Dois toques. Com o módulo dos eletricistas pede ainda "A pagar ao eletricista pelo que fez" (€ sem IVA, por omissão 0).
2. **O que faz**, pela ordem do "Cancelar obra e devolver sinal" e com as mesmas funções: devolve `sinal − retido` (`devolverSinal`: automático por cartão ou MB Way; por transferência, com o IBAN pedido na conta, se o cliente pagou por Multibanco; com 0 a devolver não há devolução); depois, numa só transação, regista a paragem (`obras_paradas`), o pedido fica `perdido` (com `motivo_perda` "Obra parada por segurança: …"), o material reservado é libertado, a obra fica `cancelada`, os trabalhos a mais à espera de resposta ficam `retirado` e as idas perdidas por decidir `anulada` (as duas com "A obra foi parada por segurança.").
3. **O trabalho do eletricista** fecha de forma que ele receba só o trabalho já feito: com um valor acima de 0, o trabalho fica `aprovada` com esse `valor_cent` e `valor_detalhe` `{…, total, obra_parada: true}`, e segue o caminho de sempre em "Pagamentos a eletricistas" (fatura-recibo e "Pago") — sem esperar pela confirmação do cliente nem pelo restante, que já não existem; com 0 (ou com a obra ainda na bolsa) o trabalho é retirado, como no "Retirar". Com o trabalho já dado por concluído pelo eletricista não se para aqui (`409`: devolve-se-lhe primeiro o trabalho).
4. **O cliente** recebe o email "a obra do seu pedido n.º X não pode avançar em segurança" com o motivo, a conta feita (sinal pago, material já encomendado, trabalho já feito e o que se devolve) e por onde vai a devolução; na conta, o pedido mostra um bloco com o mesmo texto e os mesmos valores (`obra_parada`: `{motivo, sinal, material, trabalho, devolver, manual, simulado, quando}`) e deixa de ter restante, proposta e trabalho a mais por aceitar.
5. **Auditoria:** `obra_parada_seguranca`, com todos os valores e o motivo. A ficha do pedido no painel leva `obra_parada` (com `eletricista` e `por`).

Rota: `POST /painel/api/orcamentos/:id/parar-obra` `{motivo, material, trabalho, eletricista?}` (só CEO). Existe também com o módulo dos eletricistas desligado (a obra é da equipa; aí `eletricista` acima de 0 dá `409`). O "Cancelar obra e devolver sinal" continua a servir para os outros casos. Testes: `painel/test/parar-obra.test.js`.

## Especialidades e prioridade (decisão do dono, 2026-10-13)

Lista fixa de quatro (`eletricistas.js ESPECIALIDADES`): `geral` "Instalação geral e quadros", `domotica` "Domótica e automação", `solar` "Solar e carregadores de carro", `redes` "Redes, telecomunicações e segurança".

1. **Parceiro ou de fora.** Um eletricista é **parceiro** de uma ou mais especialidades (`eletricistas.especialidades`, JSON com as chaves) ou é **de fora** (sem nenhuma: comporta-se como sempre). Só o CEO as marca, em Eletricistas → ficha → "Parceiro" (`POST /painel/api/eletricistas/:id {especialidades: [...]}`; fica na auditoria). Marcar ou desmarcar não mexe nos trabalhos que já estão na bolsa.
2. **Cada pedido tem uma especialidade** (`orcamentos.especialidade`; `NULL` = por confirmar). O programa **sugere** (`especialidadeSugerida(simulacao)`, função pura) e o CEO **confirma ao validar**: a lista de verificação tem "Especialidade" com a sugerida já escolhida (`POST …/validar {pontos, bolsa, especialidade?}`; sem ela, fica a sugerida). Muda-se depois em `POST /painel/api/orcamentos/:id/especialidade {especialidade}` (só CEO), enquanto o pedido não tiver proposta aceite. A ficha e a lista levam `especialidade`, `especialidade_sugerida` e `pode_mudar_especialidade`.
3. **A sugestão.** Num pedido misto ganha a mais específica, por esta ordem:

   | Especialidade | O que a simulação tem |
   |---|---|
   | `solar` | a linha do carregador nos artigos (`itens[].sku` = `LINHA-DEDICADA-VE`), ou uma máquina da planta `carregador_ve` / `carregador_ve_22` com ação novo, substituir ou reparar |
   | `redes` | o objetivo `alarme`, a melhoria `seguranca`, ou uma máquina da planta `camara`, `campainha_video`, `box_router`, `repetidor_wifi`, `nas` ou `servidor` com ação que não seja manter |
   | `domotica` | `caminho` "automatizar", `servico` com "automatizar", as melhorias `casa-inteligente` ou `poupar-energia`, um objetivo de automação (`poupar`, `estores`, `luzes`, `distancia`, `clima`, `horarios`, `iluminacao_auto`, `energia`, `desligar`), ou uma divisão com `estores`, `sensores_porta`, `sensores_movimento`, `luzes_regulaveis` ou `tomadas_inteligentes` acima de zero |
   | `geral` | tudo o resto: quadro, tomadas, pontos de luz, obras, avaria (`funil` "avaria") e pedido sem simulação |

   O simulador não tem painéis solares nem ITED: um pedido desses chega como `geral` e o CEO muda-o ao validar.
4. **Prioridade de 24 horas.** Quando um trabalho entra na bolsa ("Validar e pôr na bolsa", "Pôr na bolsa", ou volta à bolsa porque alguém o largou ou deixou caducar), fica com a especialidade do pedido (`trabalhos_eletricista.especialidade`; por confirmar, a sugerida). Se houver **pelo menos um parceiro aprovado dessa especialidade que trabalhe nesse concelho**, só esses parceiros o veem durante 24 horas (`prioridade_ate`, em ms; `PRIORIDADE_MS`): os outros não o veem na lista, e o detalhe, a proposta e o "Aceitar" dão 404. Só eles recebem o aviso, com a linha "É da sua especialidade (…): tem 24 horas antes de abrir aos outros eletricistas." Passadas as 24 horas — pelo relógio do servidor, verificado em cada leitura e no temporizador (`expirar`) — abre a todos os aprovados do concelho, que recebem o aviso de sempre; os parceiros não voltam a ser avisados. Abre também antes disso se deixar de haver um parceiro que o veja (suspenso, ou largou-o). **Sem parceiro da especialidade no concelho, abre logo a todos, como antes.**
5. **A prioridade só controla quem vê.** Propor, aceitar e escolher seguem as regras de sempre. "Pedir proposta só a um eletricista" (`so_para`) manda por cima: só ele vê, com ou sem parceiros.
6. **No painel**, o bloco "Eletricista externo" diz "Só os parceiros de <especialidade> veem este pedido até <dia e hora>: <nomes>." e tem "Abrir já a todos" (dois toques; `POST …/eletricista {acao: "abrir_todos"}`, só CEO). Mudar a especialidade com o pedido na bolsa calcula a prioridade de novo (24 horas a contar da mudança, ou aberto a todos se não houver parceiros). `GET …/eletricista` leva `prioridade`: `{ate, especialidade, especialidade_nome, parceiros: [{id, nome}]}` ou `null`.
7. **Na área do eletricista**, cada trabalho da bolsa leva `especialidade`, `especialidade_nome` e `prioridade_ate` (só para o parceiro, enquanto dura): o cartão mostra a especialidade e o selo "Da sua especialidade · só para si até <dia, hora>"; o Início repete-o no cartão da bolsa.

Compatibilidade: sem parceiros registados nada muda; um pedido antigo, ou validado sem especialidade, usa a sugerida. Testes: `painel/test/especialidades.test.js`.

## Avarias fora de horas (decisão do dono, 2026-10-13)

Regras do cliente e do dinheiro: docs/PAGAMENTOS-PEDIDO.md "Avarias fora de horas". Do lado dos eletricistas (migração 54, `eletricistas.fora_horas`, por omissão NÃO; testes em `painel/test/fora-de-horas.test.js`):

- **Só recebe avarias fora de horas quem disser que as faz.** Na área do eletricista, em "Bolsa", o interruptor "Faço serviço de noite e ao fim de semana" (`POST /api/eletricista/fora-horas {ligado}`; `GET eu` traz `fora_horas`). O CEO vê-o na lista e na ficha do eletricista (selo "Faz fora de horas") e pode mudá-lo (`POST eletricistas/:id {fora_horas}`; só CEO).
- **Uma avaria que continua fora de horas** (pedida assim e sem a diferença devolvida ao cliente) só é visível na bolsa, avisada por email e atribuível a quem tem isso ligado — além das regras de sempre (concelho, prioridade da especialidade, `so_para`). Na prioridade de 24 horas só contam os parceiros que fazem fora de horas.
- **Recebe a mesma percentagem sobre a mão de obra mais alta** (`estimativa`: mão de obra × (1 + `fora_horas_pct`); o cartão e a ficha dizem "Fora de horas: recebe mais 50 %"; `recebe.fora_horas` e `fora_horas` no trabalho). A deslocação não muda. É este o valor fixado quando o CEO aprova.
- **Se marcar a visita em horário normal** (dia útil, das 8h às 20h), o cliente recebe a diferença de volta e o trabalho passa ao valor normal; a partir daí (como numa avaria pedida em horário normal) a visita já não se marca fora do horário normal: o servidor responde 409 e a ficha avisa (`so_horario_normal`).
- Exemplo em Sintra, a 70 %: horário normal 10,82 € + 5,85 € de deslocação = 16,67 €; fora de horas 16,23 € + 5,85 € = 22,08 € (sem IVA).

## Técnico responsável (decisão do dono, 2026-10-13)

Cada trabalho do tipo `obra` tem um técnico responsável, que a assina. **Sem técnico indicado, a obra não pode ser dada por concluída.** Não se aplica às visitas técnicas nem aos diagnósticos de avaria.

1. **Quem pode ser:** um eletricista **aprovado com n.º da DGEG**, parceiro ou de fora (`trabalhos_eletricista.tecnico_id`, com `tecnico_por` e `tecnico_em`).
2. **Automático:** se quem fica com a obra tem n.º da DGEG, é ele (ao atribuir, ao aceitar na bolsa, ou quando a obra nasce para o escolhido; `tecnico_por` = "sistema"). Se não tem, fica por indicar. Se ele largar a obra, deixa de ser o técnico dela; um técnico indicado pelo CEO fica.
3. **O CEO indica** na ficha do pedido, no bloco "Eletricista externo": a lista dos aprovados com DGEG (`POST /painel/api/orcamentos/:id/tecnico {eletricista_id}`, só CEO; auditoria `tecnico_responsavel_indicado`). Pode mudá-lo até a obra ser aprovada. `GET …/eletricista` leva `pode_tecnico`, `tecnicos` e, no trabalho, `precisa_tecnico` e `tecnico` (`{id, nome, valido, automatico, por, em}` ou `null`).
4. **O técnico indicado**, se não for quem faz a obra, recebe o email "é o técnico responsável de uma obra em <concelho>", sem nada do cliente, e passa a ver a obra em **"Obras que assino"** (em "Os meus trabalhos"), só para leitura: quem a faz, a visita, o relatório técnico sem preços (com a planta e o esquema do quadro), o material, as fotos e os ensaios. Vê o nome e a morada do cliente nas condições do executante (a obra só existe depois de o cliente aceitar a proposta, e só enquanto está aberta); o telefone e o email nunca. **Não vê valores** (o que o executante recebe, percentagens, propostas), não mexe em nada e **não recebe pelo sistema**. Rotas: `GET /api/eletricista/obras-assino`, `…/obras-assino/:id` e `…/obras-assino/:id/fotos/:foto` (404 para quem não é o técnico dessa obra).
5. **Bloqueio:** sem técnico que possa assinar (por indicar, ou entretanto suspenso), `falta` leva "o técnico responsável" e `POST trabalhos/:id/concluir` responde `409 Esta obra ainda não tem técnico responsável: a Domus Energia tem de o indicar antes de a dar por concluída.` A ficha do executante leva `tecnico`: `{indicado, proprio, nome}`. No Início do CEO aparece "obra sem técnico responsável" (`tratar.sem_tecnico` e `tratar.sem_tecnico_pedido`), com ligação ao pedido.

Testes: `painel/test/especialidades.test.js`.

## Decisões do dono

1. **Atribuição:** o CEO atribui o pedido a um eletricista ou põe-no na **bolsa**. Na bolsa só veem o trabalho os eletricistas aprovados que declararam o concelho do pedido; o primeiro a aceitar fica com ele.
2. **48 horas** depois de aceitar (ou de ser atribuído) para marcar a visita com o cliente; sem visita marcada, o trabalho volta sozinho.
3. **Pagamento:** 70 % da mão de obra **sem IVA** + a deslocação paga pelo cliente. A percentagem é configurável (painel → Eletricistas, "por omissão") e por eletricista. O material é da Domus.
4. **Visita técnica e diagnóstico de avaria** seguem a mesma regra: percentagem × a meia hora de mão de obra sem IVA + deslocação. Na avaria, a taxa de diagnóstico (25 €) fica na Domus.
5. **Quem larga um trabalho** (ou o deixa caducar) **nunca recebe** por ele, mesmo que já tenha feito a visita (o servidor recusa "Pago"; ver "Pagamento ao eletricista").
6. **Dados do cliente:** antes de aceitar, só o concelho, o tipo de trabalho, as horas e os dias estimados e o relatório técnico sem preços. Depois de atribuído, o nome, a morada e o telefone, enquanto o trabalho está aberto.
7. **Confirmação do cliente (decisão 8):** "Sim" (1 a 5 estrelas) ou "Não" (o que falta). Com "Não", o trabalho volta ao eletricista e o CEO decide: **defeito** → o eletricista volta sem receber mais; **sem defeito** → o cliente paga uma visita. Sem resposta em **7 dias**, o trabalho fica aceite.
8. **Pagamento:** até **7 dias** depois de: o cliente confirmar, o cliente pagar o restante (obras) e o CEO aprovar; por transferência, contra **fatura-recibo** carregada na área do eletricista ("Fatura em falta" até lá).
9. **Ida sem defeito:** com "sem defeito", o eletricista recebe essa ida (percentagem × a meia hora sem IVA + deslocação sem IVA) numa linha própria, depois de o cliente pagar essa visita e de o CEO aprovar o trabalho (a mesma regra dos 7 dias). Com "defeito" nunca.

## Fluxo

1. **Candidatura** em `trabalhe-connosco.html`: nome, email, telemóvel, NIF, n.º de habilitação na DGEG (**opcional** desde 2026-10-13: "se tiver"; quem não o tem fica com o campo vazio, pode trabalhar na mesma, mas não assina obras — ver "Técnico responsável"), concelhos onde trabalha, experiência (opcional), o documento do seguro de responsabilidade civil (PDF, JPG ou PNG, até 5 MB) e a caixa de consentimento com a ligação para a Política de Privacidade. O candidato recebe um email de confirmação e os CEO do painel recebem um aviso (sem os dados do candidato).
2. **Painel → Eletricistas** (só CEO): candidaturas por decidir, com a ficha e o documento; **Aprovar** (envia o email com a ligação para `eletricista.html`) ou **Recusar**; depois **Suspender** e **Reativar**; os concelhos e a percentagem editam-se a qualquer altura. Cada eletricista mostra a **média das avaliações** e quantas são ("Média 4,3 ★ (3)"); na ficha, os comentários dos clientes (os que podem ir para o site vão marcados "Pode ir para o site": publicar é à mão) e o IBAN mascarado.
3. **Atribuição** na ficha do pedido (Orçamentos) ou da obra (Obras), bloco "Eletricista externo", só para o CEO: "Atribuir a…" (um eletricista aprovado com o concelho do pedido), "Pôr na bolsa" ou "Retirar" (em qualquer altura).
4. **Área do eletricista** (`eletricista.html`, pensada para o telemóvel): entra com o email e um código de 6 algarismos. **Bolsa** → ficha do trabalho sem dados do cliente → **Aceitar trabalho**. **Trabalhos** → ficha com o cliente, o relatório técnico e o material → **Marcar visita** (o cliente recebe um email da Domus Energia) ou **Largar trabalho**.

### O que se pode atribuir

Um trabalho por pedido e por tipo:

| Tipo | Quando | Fecha quando |
|---|---|---|
| `obra` | pedido "aceite" com a obra criada (nasce com o sinal pago) e ainda por fazer | a obra fica concluída ou cancelada, ou o pedido deixa de estar aceite |
| `visita` | pedido "novo", "contactado" ou "visita marcada" com a visita técnica **paga** (com as propostas na bolsa: sem pagamento nenhum, decisão de 2026-10-11) | a proposta é enviada, o pedido fica perdido, ou o cliente falta |
| `avaria` | o mesmo, num pedido de avaria com o diagnóstico **pago** | o mesmo |

O concelho é o da localidade do pedido. Se a localidade não for um dos 308 concelhos, o painel pede para a corrigir antes de atribuir. Com os pagamentos online desligados não há visita nem diagnóstico pagos, por isso só se atribuem obras.

Fechado o trabalho, o eletricista continua a vê-lo na lista como "Fechado", mas sem nome, morada, telefone, relatório, material ou fotos.

### Aviso da bolsa

Quando um trabalho entra na bolsa, cada eletricista **aprovado** com o concelho do trabalho recebe um email: "Novo trabalho em <concelho>", o tipo de trabalho e a ligação para a área. O email não leva nada do cliente, nem valores, nem o número do pedido. Sai **um email "novo trabalho" por trabalho e por eletricista** (tabela `trabalhos_eletricista_avisos`). Quando o trabalho **volta à bolsa** (alguém o largou ou deixou caducar), quem já tinha recebido o aviso recebe "Um trabalho voltou à bolsa em <concelho>" e quem ainda não o tinha recebido (ex.: aprovado entretanto) recebe o "novo trabalho". **Quem o largou ou o deixou caducar nunca mais é avisado** desse trabalho (também já não o vê). Uma atribuição direta não gera aviso da bolsa (o eletricista escolhido recebe o email "Tem um trabalho novo").

### Ficha de obra (ronda 2)

Na área do eletricista, a ficha de um trabalho tem quatro separadores:

- **Cliente:** nome, morada e telefone, e a visita (contagem das 48 h, marcar, alterar).
- **Trabalho:** o relatório técnico sem preços (lista de trabalho, planta técnica, esquemas, esquema do quadro — os mesmos desenhos do relatório do cliente) e a **lista do material** com uma caixa por artigo, "levantado ou recebido" (`trabalhos_eletricista.material_recebido`, por trabalho; não mexe na lista de material da obra do painel).
- **Ensaios:** continuidade do PE, isolamento, terra e disparo do diferencial. Ficam em `orcamentos.ensaios` (migração 16), os mesmos que o painel regista e que o relatório completo do cliente mostra. Os limites são os da configuração: isolamento ≥ `ensaio_isolamento_mohm` (0,5 MΩ), diferencial ≤ `ensaio_diferencial_ms` (300 ms), terra ≤ `ensaio_terra_ohm` (100 Ω). Um valor **fora do limite não é recusado**, mas só se guarda com uma **nota** a explicar; fica assinalado na ficha e no painel. Nos trabalhos de avaria aparece também o **diagnóstico** (a lista de verificação de `diagnostico-conteudo.js`, o tipo de avaria e a conclusão; fica em `orcamentos.diagnostico`, com a mesma validação do painel).
- **Procedimentos** ([PROCEDIMENTOS.md](PROCEDIMENTOS.md)): nos trabalhos do tipo `obra`, o separador "Trabalho" tem também "Procedimentos da obra" — as checklists dos procedimentos publicados (começar uma, marcar os passos; fica quem e quando), as mesmas que o painel vê na ficha da obra. Não contam para "Obra concluída". Os procedimentos publicados leem-se na "Ajuda técnica".
- **Fotos:** quatro grupos — quadro antes, pontos antes, quadro depois, pontos depois — até 4 fotos por grupo. O telemóvel reduz a foto (como no simulador) e envia os bytes; o servidor aceita só JPEG ou PNG verdadeiros (pelos primeiros bytes), até 1 MB.

**"Obra concluída"** (nas visitas e avarias, "Trabalho concluído") só fica ligado quando não falta nada (`falta` na ficha):

| Tipo | Condições (decisão do dono, ronda 3: as mesmas para todos) |
|---|---|
| `obra`, `visita` | visita marcada, uma foto de antes, uma foto de depois, e os três ensaios (isolamento, diferencial, terra) |
| `avaria` | o mesmo, e a conclusão do diagnóstico |

Ao concluir, o trabalho passa a `concluida_eletricista` com a data (`concluida`), os CEO recebem um email e o cliente recebe outro, em nome da Domus Energia, a pedir que confirme na conta (sem resposta em 7 dias, fica aceite). A partir daí a ficha fica **só de leitura** (não se mexe em fotos, ensaios, material nem visita, e já não se pode largar) e mostra "A aguardar confirmação do cliente". O pedido e a obra do painel só mudam quando o CEO aprova. O CEO continua a poder retirar o trabalho até o aprovar.

### Confirmação do cliente (ronda 3)

Na conta (`web/conta.js`), o pedido com um trabalho `concluida_eletricista` mostra **"O trabalho ficou concluído?"** — nunca quem o fez:

- **Sim:** 1 a 5 estrelas (obrigatórias), comentário opcional (até 1000 caracteres) e a caixa "Podem usar o meu comentário no site". O trabalho passa a `confirmada`.
- **Não:** o que falta (obrigatório, 5 a 1000 caracteres). O trabalho volta a `visita_marcada` com o texto do cliente (`reclamacao`, `reclamacao_de = 'cliente'`); o eletricista vê-o na ficha e recebe um email; os CEO também. O CEO decide no painel: **"Defeito: volta sem receber"** (fica `reclamacao_decisao = 'defeito'`; o eletricista corrige e volta a concluir, e o cliente confirma outra vez) ou **"Sem defeito: cobrar visita ao cliente"** (o trabalho fica `confirmada`, sem avaliação, e o cliente passa a ver "Visita sem defeito" com o botão de pagar: ver `docs/PAGAMENTOS-PEDIDO.md`).
- **Sem resposta em 7 dias** depois de `concluida`: o trabalho fica `confirmada` sozinho (`confirmada_auto = 1`, sem avaliação), com a data do fim dos 7 dias. Verifica-se em cada leitura (conta, área do eletricista, painel), como as 48 h, e no temporizador.

Depois de confirmado, a conta mostra o que o cliente respondeu (estrelas e comentário) e o "Não" já não se pode dar na conta (fala-se connosco).

### Aprovação do CEO (ronda 3)

Na ficha do pedido (bloco "Eletricista externo"), com o trabalho `confirmada`:

- **"Aprovar trabalho"**: numa obra, marca a obra concluída no painel **com a mesma função do botão "Obra concluída"** (`concluirObra` em `api.js`: `obra_concluida`, obra "concluída", saída do material do stock, auditoria e o email ao cliente com o restante) — se ainda não estava; o cliente passa a poder pagar o restante. O **valor a pagar fica fixado** (`valor_cent` e `valor_detalhe`), com a percentagem gravada no trabalho. O trabalho passa a `aprovada`, fecha para o eletricista (sem dados do cliente) e deixa de ocupar o pedido; não se atribui outro trabalho do mesmo tipo no mesmo pedido.
- **"Devolver ao eletricista"** (com o motivo, obrigatório), de `concluida_eletricista` ou `confirmada`: volta a `visita_marcada` com o motivo (`reclamacao_de = 'ceo'`); a confirmação e a avaliação do cliente saem, e o cliente volta a confirmar quando o eletricista concluir outra vez.
- Antes de o cliente confirmar (ou dos 7 dias) não se aprova (`409`). Depois de aprovado não se devolve nem se retira.

### No painel

- **Eletricistas → ficha:** "Habilitação na DGEG: <n.º>" ou "Sem habilitação: não pode assinar obras", e as caixas "Parceiro" com as quatro especialidades.
- **Ficha do pedido e da obra**, bloco "Eletricista externo": a prioridade dos parceiros e "Abrir já a todos", o técnico responsável (e a lista para o indicar), o estado (incluindo "Concluída pelo eletricista — a aguardar confirmação do cliente" e "Confirmado — falta aprovar"), até quando o cliente pode responder, a confirmação com as estrelas e o comentário, a reclamação e os botões de decisão, "Aprovar trabalho" e "Devolver ao eletricista", o que ainda falta ao eletricista, o material recebido, os ensaios (os que estão fora do limite a vermelho, com a nota) e as fotos antes e depois. Depois de aprovado: o valor fixado, o estado do pagamento e a fatura-recibo.
- **Pagamentos → "Pagamentos a eletricistas"**: ver "Pagamento ao eletricista".
- **Suspender** um eletricista com trabalhos em curso abre um aviso com a lista deles; o CEO pode retirar cada um (volta a ficar por atribuir) ou suspender mesmo assim.
- **Apagar (RGPD)** na ficha do eletricista, com confirmação (escrever o email): ver "Privacidade".

## Estados do trabalho

Tabela `trabalhos_eletricista` (migração 28), coluna `estado`:

```
                 Pôr na bolsa                 Aceitar (atómico)              Marcar visita
(por atribuir) ───────────────▶ na_bolsa ───────────────────────▶ aceite ───────────────────▶ visita_marcada
       │                           ▲                                │  ▲                          │ Obra concluída
       │        Atribuir a…        │      48 h sem visita, ou       │  │      Alterar data        ├──────────────▶ concluida_eletricista
       └───────────────────────────┼──────── Largar trabalho ◀──────┘  └──────────────────────────┘      │ cliente "Sim", 7 dias sem resposta,
          (entra logo em "aceite") │      (modo bolsa: volta à bolsa; atribuição direta: fica "retirado")  │ ou CEO "sem defeito"
                                   └─── Largar trabalho (com a visita marcada) também volta               ▼
                                         cliente "Não" ou CEO "Devolver" ──▶ visita_marcada ◀──────── confirmada
                                                                                                         │ Aprovar (CEO)
                                                                                                         ▼
                                                                                   aprovada ──"Pago" (CEO)──▶ paga
Retirar (CEO), em qualquer estado até aprovar ──▶ retirado
```

- `modo`: `bolsa` (foi posto na bolsa) ou `direto` (o CEO atribuiu). Um trabalho da bolsa que é largado ou caduca **volta à bolsa**; um atribuído diretamente **volta ao CEO** (fica `retirado` e o pedido volta a poder ser atribuído).
- **Aceitar é atómico:** `UPDATE … WHERE id = ? AND estado = 'na_bolsa'`. O segundo a chegar não muda nenhuma linha e recebe `409 Outro eletricista aceitou este trabalho primeiro.`
- **48 horas:** contam de `aceite_em`. A verificação corre em cada leitura (bolsa, trabalhos, bloco do painel) e de 15 em 15 minutos no temporizador do módulo (`iniciar()`, como os outros módulos). Com a visita marcada o prazo deixa de contar.
- **Percentagem:** fica gravada no trabalho quando é aceite ou atribuído; mudar depois a percentagem do eletricista não mexe nos trabalhos que já tem.
- **Concluído pelo eletricista** (`concluida_eletricista`, migração 29) e **confirmada** (migração 30): continuam a ser o trabalho ativo do pedido (não se atribui a outro sem o retirar), não caducam e não se podem largar. **Aprovada** e **paga** já não ocupam o pedido, mas o índice único (pedido, tipo) não deixa criar outro trabalho do mesmo tipo (pagava-se duas vezes); a seguir a uma visita técnica feita pode vir a obra.
- **Quem largou:** `trabalhos_eletricista_eventos` guarda cada passo (`posto_na_bolsa`, `atribuido`, `aceite`, `visita_marcada`, `largou`, `expirou`, `retirado`, `concluida`, `confirmada`, `contestada`, `devolvida`, `aprovada`, `paga`) com o eletricista, a data e quem o fez. Quem largou um trabalho ou o deixou caducar não o volta a ver na bolsa. O painel mostra a contagem ("N largados") em cada eletricista.
- **Marcar visita:** na `visita` e na `avaria` a data fica em `orcamentos.data_visita` (o pedido passa a "visita marcada" e o cliente vê-a na conta); na `obra` fica em `obras.data` e `obras.hora` e a obra deixa de estar "por agendar". Se o eletricista largar o trabalho depois de marcar, a data sai, o cliente recebe um email a dizer que a visita vai ter nova data e os CEO são avisados.

## O que o eletricista recebe

Sempre calculado no servidor, em euros **sem IVA**: `percentagem × mão de obra + deslocação`. Até à aprovação é uma estimativa; **ao aprovar fica fixado** no trabalho (`valor_cent`, `valor_detalhe`) e já não muda com a percentagem, a proposta ou o IVA.

| Tipo | Mão de obra | Deslocação |
|---|---|---|
| `obra` | a parte "mão de obra" da proposta em três partes | a parte "deslocação" da proposta |
| `visita` | 0,5 h × `tarifa_hora_iva`, sem IVA | a deslocação até à localidade (1 dia), sem IVA |
| `avaria` | as horas do artigo `DIAG-AVARIA` (0,5 h) × `tarifa_hora_iva`, sem IVA | o mesmo |

Exemplos: obra com 1 240 € de mão de obra e 35 € de deslocação a 70 % → 868 € + 35 € = **903 €**. Avaria em Sintra (tarifa 38 €/h, deslocação 7,20 € com IVA): 70 % × 15,45 € + 5,85 € = **16,67 €**; os 25 € do diagnóstico ficam na Domus. Com 65 % e IVA a 6 %, a mesma avaria (ou a visita técnica) dá 65 % × 17,92 € + 6,79 € = **18,44 €** (os testes cobrem os três tipos com outra percentagem e outro IVA).

## Pagamento ao eletricista (ronda 3)

O estado do pagamento é calculado no servidor (`estadoPagamento` em `eletricistas.js`, testado em todas as combinações):

| Estado | Quando |
|---|---|
| `a_aguardar_cliente` | o cliente ainda não confirmou (nem passaram os 7 dias) |
| `a_aguardar_aprovacao` | confirmado, o CEO ainda não aprovou |
| `a_aguardar_restante` | aprovado, mas a obra ainda não está toda paga pelo cliente (`ligacaoCasa(o).pode`; na visita e na avaria o cliente já pagou) |
| `fatura_em_falta` | as três condições cumpridas, sem a fatura-recibo |
| `a_pagar` | as três condições e a fatura; **prazo = 7 dias depois da última** das três datas (confirmação, aprovação, restante pago) |
| `pago` | o CEO marcou "Pago" (fica a data e quem) |
| `sem_pagamento` | quem está no trabalho largou-o ou deixou-o caducar antes (eventos `largou` / `expirou`): nunca recebe |

- **"Pago"** (`POST /painel/api/trabalhos-eletricista/:id/pago`, só CEO) só é aceite em `a_pagar`; nos outros estados responde `409` com o motivo ("Ainda não se pode pagar este trabalho: …", "Este eletricista largou o trabalho ou deixou-o caducar: não recebe por ele.", "Este trabalho já está pago."). O eletricista recebe um email com o valor (sem o IBAN).
- **Fatura-recibo:** o eletricista carrega-a na área ("Pagamentos"), depois de aprovado e até estar pago; enviar outra substitui a anterior. As mesmas regras do documento do seguro: PDF, JPG ou PNG, até 5 MB, o tipo verificado pelos bytes. Fica em `ELETRICISTAS_DIR/faturas/<trabalho>/<24 hex>.pdf|jpg|png`, fora da pasta pública; só a descarregam o eletricista do trabalho e o CEO, com `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e, no PDF, `attachment`.
- **IBAN:** no perfil do eletricista (`POST /api/eletricista/iban`), português e validado (módulo 97, como nas devoluções); vazio apaga. Sai **mascarado** ("PT50 •••• 0154") para o próprio e nas listas e na ficha do painel; **inteiro só em "Pagamentos a eletricistas"** (CEO), para a transferência. Nunca vai para o registo, a auditoria nem os emails.
- **Painel → Pagamentos → "Pagamentos a eletricistas":** cada trabalho concluído com o valor em partes, o estado e o prazo, a fatura, o IBAN e o NIF, e o botão "Pago" (com confirmação). O resumo dos pagamentos dos pedidos leva `eletricistas: {a_pagar, pago}` numa linha à parte, e o CSV leva uma linha por trabalho (`eletricista_a_pagar` com a data da aprovação, `eletricista_pago` com a data do pagamento), a negativo e sem IVA — **nunca somadas à receita dos clientes** (o filtro de estado do CSV deixa-as de fora).

### Ida sem defeito (linha própria)

Quando o CEO decide **"Sem defeito"**, fica fixado no trabalho o valor da ida do eletricista, como numa visita técnica: `percentagem × 0,5 h × tarifa (sem IVA) + deslocação (sem IVA)` (`regresso_cent`, `regresso_detalhe`, migração 31; a data da decisão em `regresso_desde`). É uma **linha à parte** nos Pagamentos do eletricista, em "Pagamentos a eletricistas" e no CSV (`eletricista-<trabalho>-ida`), com a sua **fatura-recibo** e o seu **"Pago"** (`parte: "regresso"`). Estados (`estadoRegresso`): `a_aguardar_visita` (o cliente ainda não pagou a visita sem defeito) → `a_aguardar_aprovacao` → `fatura_em_falta` → `a_pagar` (prazo: 7 dias depois da última de: visita paga, aprovação) → `pago`; quem largou o trabalho: `sem_pagamento`. Com **"Defeito"** nunca há ida a pagar. Se o cliente voltar a dizer "Não" (depois de o CEO devolver o trabalho), a decisão "sem defeito" deixa de valer: com a visita ainda por pagar, a cobrança e a ida desaparecem; já paga, a ida fica.

### Na área do eletricista: "Pagamentos"

O separador lista os trabalhos dados por concluídos com o valor em partes (mão de obra sem IVA, a percentagem, a deslocação, o total; "Estimativa" até aprovar), o estado ("A aguardar o cliente", "A aguardar aprovação", "A aguardar o restante do cliente", "Fatura em falta", "A pagar até <data>", "Pago em <data>"), o envio da fatura-recibo e o campo do IBAN.

Numa obra cuja proposta não tem as três partes, usa-se o que a simulação sugere e a resposta leva `provisoria: true`; sem simulação, não há estimativa ("a combinar").

## Privacidade

- **Antes de aceitar** (`GET /api/eletricista/bolsa` e `bolsa/:id`) a resposta é montada campo a campo em `paraBolsa()`: `id` do trabalho (não o do pedido), `concelho`, `tipo`, `titulo` (feito de dados estruturados, ex.: "Obra — Apartamento T2"; nunca o texto livre do pedido), `horas`, `dias`, `recebe` e, na ficha, `relatorio` — lista de trabalho por divisão, material (só artigo e quantidade), planta técnica, esquemas e esquema do quadro. Sem preços, totais, valor da proposta, nome, contactos, morada, mensagem ou notas. Um teste procura esses dados e qualquer chave de preço nas duas respostas.
- **Depois de atribuído** (`GET /api/eletricista/trabalhos/:id`): `cliente` com o nome, a morada, a localidade e o telefone — nunca o email — só enquanto o trabalho está aberto; mais o relatório com a lista de ensaios e o diagnóstico registados no painel, e a lista de material.
- **O relatório técnico leva os nomes das divisões e a descrição da avaria escritos pelo cliente**, porque são necessários para decidir aceitar o trabalho.
- **Emails ao cliente** saem em nome da Domus Energia, sem o nome do eletricista. A confirmação na conta também não diz quem fez o trabalho.
- **Avaliação do cliente:** as estrelas e o comentário ficam no trabalho; o CEO vê-os no painel (o eletricista não vê o comentário). Com a caixa "Podem usar o meu comentário no site" o comentário fica só marcado "Pode ir para o site": publicá-lo é à mão. Quando a conta do cliente é apagada (RGPD), o comentário e o texto do "Não" saem; as estrelas ficam (contam para a média, sem nada que identifique o cliente).
- **NIF e IBAN do eletricista:** guardados na base de dados como os outros dados pessoais; o IBAN mascarado nas listas; nenhum dos dois vai para o registo, a auditoria ou os emails. O NIF aparece ao CEO na ficha e em "Pagamentos a eletricistas" (para a fatura).
- **Documento do seguro:** guardado em `ELETRICISTAS_DIR` (por omissão `DADOS/painel/eletricistas/<id>/<24 hex>.pdf|jpg|png`), fora da pasta pública. Só o CEO o vê, por `GET /painel/api/eletricistas/:id/seguro`, com `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e, no PDF, `Content-Disposition: attachment`.
- **Fotos da obra:** em `ELETRICISTAS_DIR/trabalhos/<trabalho>/<24 hex>.jpg|png`, fora da pasta pública. Só as veem o eletricista do trabalho (enquanto o trabalho está aberto) e o CEO (`GET /painel/api/trabalhos-eletricista/:id/fotos/:foto`), sempre com `nosniff` e `Content-Security-Policy: default-src 'none'; sandbox`. Saem com o pedido quando a conta do cliente é apagada (RGPD), como as fotos do pedido.
- **Retenção:** uma candidatura recusada é apagada, com o documento, 12 meses depois da decisão (`limpar()`). Uma candidatura por decidir fica até ser decidida. Um eletricista aprovado ou suspenso fica enquanto existir.
- **Apagar um eletricista (RGPD):** `POST /painel/api/eletricistas/:id/apagar` (só CEO; confirma-se com o email). Saem as sessões, os códigos, os avisos da bolsa, o documento do seguro e o histórico dele na auditoria. Sem trabalhos nenhuns, a linha é apagada. Com histórico de trabalhos (necessário para a contabilidade e para a regra "quem larga não recebe"), a linha fica **anonimizada**: nome "Eletricista apagado (RGPD)", sem email, telefone, NIF, IBAN, habilitação, concelhos, experiência nem notas, e nunca mais entra; as faturas-recibo ficam (documentos de contabilidade). Com trabalhos em curso ou aprovados por pagar o pedido é recusado: o CEO retira-os ou paga-os primeiro. O email fica livre para uma candidatura nova.
- **Auditoria:** as ações do eletricista ficam como `eletricista:<id>` (sem o email); as do CEO com o utilizador do painel.

## Endpoints

### Públicos e área do eletricista — `/api/eletricista/*`

Os POST exigem a `Origin` do site (CSRF) e `Content-Type: application/json`.

| Rota | Sessão | O que faz |
|---|---|---|
| `GET candidatura` | — | `200 {aberta: true, percentagem}`: as páginas perguntam se o módulo está ligado (desligado: 404); `percentagem` é a da configuração. |
| `POST candidatura` | — | `{nome, email, telefone, nif, dgeg? (opcional; preenchido: 2 a 40 caracteres), concelhos[], experiencia?, notas?, seguro: {tipo, dados (base64)}, consentimento: true, website}` → `201 {ok, mensagem}`. 5 por hora por IP, 100 por hora no total. `website` é o campo-armadilha. Email repetido: a mesma resposta, nada muda. |
| `POST codigo` | — | `{email}` → sempre `200` com a mesma mensagem; o código só sai para um eletricista aprovado (3 por hora por email, 10 por hora por IP). |
| `POST entrar` | — | `{email, codigo}` → `200 {eletricista}` + cookie; `400` se o código está errado, expirou (15 min) ou gastou as 5 tentativas, ou se não está aprovado. |
| `POST sair` | — | fecha a sessão. |
| `GET eu` | sim | `{eletricista: {nome, email, concelhos, percentagem, iban (mascarado)}, sessao_expira, prazo_visita_horas}` |
| `GET bolsa` | sim | `{concelhos, trabalhos: [{id, concelho, tipo, titulo, horas, dias, recebe, especialidade, especialidade_nome, prioridade_ate}]}` |
| `GET bolsa/:id` | sim | o mesmo com `relatorio`; `404` fora dos concelhos dele; `409` se outro já aceitou. |
| `POST bolsa/:id/aceitar` | sim | `200 {trabalho}` ou `409`. |
| `GET trabalhos` | sim | os trabalhos dele (em curso, concluídos, aprovados e pagos; sem os dados do cliente). |
| `GET trabalhos/:id` | sim | a ficha: `cliente`, `relatorio`, `material`, `prazo`, `visita`, `recebe`; `404` se não é dele. |
| `POST trabalhos/:id/visita` | sim | `{data_visita: "AAAA-MM-DDTHH:MM"}` (hora de Lisboa, no futuro). |
| `POST trabalhos/:id/largar` | sim | devolve o trabalho; fica registado. |
| `POST trabalhos/:id/material` | sim | `{recebido: ["nome do artigo", …]}`: a lista toda do que já foi levantado ou recebido. |
| `POST trabalhos/:id/ensaios` | sim | `{continuidade_pe, isolamento, terra, diferencial, notas}`; fora do limite sem `notas` → `400`. |
| `POST trabalhos/:id/diagnostico` | sim | `{diagnostico: {verificacoes, valores, tipo, conclusao} \| null}`; só nos trabalhos de avaria (`409` nos outros). |
| `POST trabalhos/:id/fotos/:grupo` | sim | o corpo são os bytes (`Content-Type: image/jpeg` ou `image/png`, até 1 MB); `grupo`: `quadro_antes`, `pontos_antes`, `quadro_depois`, `pontos_depois`; `409` com 4 no grupo. |
| `GET trabalhos/:id/fotos/:foto` | sim | a foto; `404` para quem não é o eletricista do trabalho. |
| `POST trabalhos/:id/fotos/:foto/apagar` | sim | apaga a foto. |
| `POST trabalhos/:id/concluir` | sim | "Obra concluída"; `409 Ainda falta: …` enquanto faltar alguma coisa. |
| `GET pagamentos` | sim | `{iban (mascarado), prazo_dias, trabalhos: [{id, parte (trabalho \| regresso), titulo, tipo, concelho, concluida, pagamento, pagamento_texto, valor, valor_fixado, prazo, pago_em, fatura, pode_fatura}]}` |
| `POST iban` | sim | `{iban}` (vazio apaga) → `{iban}` mascarado; `400` se não for um IBAN português válido. |
| `POST trabalhos/:id/fatura` | sim | `{tipo, dados (base64), parte?: trabalho \| regresso}` → `201` com os pagamentos; `409` antes de aprovado ou depois de pago; `413`/`415` como o seguro. |
| `GET trabalhos/:id/fatura[?parte=regresso]` | sim | a fatura-recibo dele (do trabalho ou da ida sem defeito). |
| `GET obras-assino`, `obras-assino/:id`, `obras-assino/:id/fotos/:foto` | sim | as obras de que é o técnico responsável sem ser o executante, só para leitura (ver "Técnico responsável"); `404` para os outros. |
| `GET procedimentos` / `GET procedimentos/:id` | sim | os procedimentos publicados, só leitura ([PROCEDIMENTOS.md](PROCEDIMENTOS.md)); os rascunhos não existem aqui (404). |
| `POST trabalhos/:id/checklists` | sim | `{procedimento_id}`: começa a checklist de um procedimento publicado na obra do trabalho (só trabalhos de obra; `409` nos outros). |
| `POST trabalhos/:id/checklists/:lista` | sim | `{passo, feito}`: marca ou desmarca um passo (fica quem e quando); `404` se a checklist não é da obra deste trabalho. |

A ficha (`GET trabalhos/:id`) leva também `checklists` (`{checklists, disponiveis}` nas obras; `null` nos outros tipos), `editavel`, `material[].recebido`, `fotos`, `grupos_fotos`, `fotos_max`, `ensaios` (com `limites` e `fora`), `diagnostico` (`{modelo, atual}`, só na avaria), `falta`, `concluida` e `reclamacao` (`{texto, de, quando, decisao}` quando o trabalho voltou). Depois de concluído, as rotas que alteram respondem `409`.

### Conta do cliente — `/api/conta/*`

| Rota | O que faz |
|---|---|
| `POST pedidos/:id/confirmar-trabalho` | `{concluido: true, estrelas: 1–5, comentario?, site?}` ou `{concluido: false, descricao}` → `200 {pedido}`; `409` sem trabalho à espera de confirmação; `404` para um pedido de outra conta. |

O pedido (`GET pedidos`) leva `confirmacao`: `{estado: por_confirmar, tipo, concluida, prazo}`, `{estado: confirmada, tipo, quando, automatica, sem_defeito, estrelas, comentario, site}` ou `{estado: contestada, tipo, quando, descricao, decisao}`, ou `null`.

`recebe`: `{percentagem, mao_obra, parte_mao_obra, deslocacao, total, provisoria}` ou `null`.

### Painel — `/painel/api/*` (só CEO)

| Rota | O que faz |
|---|---|
| `GET eletricistas` | `{eletricistas: [...], percentagem_omissao}` |
| `GET eletricistas/:id` | a ficha |
| `POST eletricistas/:id` | `{acao?: aprovar \| recusar \| suspender \| reativar, concelhos?, percentagem?, especialidades?}` (`percentagem: null` = a por omissão; `especialidades: []` = eletricista de fora) |
| `GET eletricistas/:id/seguro` | o documento do seguro |
| `GET orcamentos/:id/eletricista` | `{pode, tipo, concelho, motivo, trabalho, candidatos, historico}` |
| `POST orcamentos/:id/eletricista` | `{acao: atribuir \| bolsa \| retirar \| aprovar \| devolver \| defeito \| sem_defeito \| abrir_todos, eletricista_id?, motivo?}` (`motivo` obrigatório em `devolver`; `abrir_todos` acaba a prioridade dos parceiros) |
| `POST orcamentos/:id/especialidade` | `{especialidade}`: muda a especialidade do pedido (até haver proposta aceite) |
| `POST orcamentos/:id/tecnico` | `{eletricista_id}`: indica o técnico responsável da obra |
| `POST eletricistas/:id/apagar` | `{email}`: apagar (RGPD) → `{modo: "apagado" \| "anonimizado", …}` |
| `GET trabalhos-eletricista/:id/fotos/:foto` | uma foto da obra (`:id` é o trabalho) |
| `GET pagamentos-eletricistas` | `{trabalhos: [{…, eletricista: {id, nome, nif}, iban (inteiro), pagamento, valor, prazo, fatura, pago_em, pago_por}], a_pagar, pago, prazo_dias}` |
| `POST trabalhos-eletricista/:id/pago` | `{parte?: trabalho \| regresso}`: "Pago" (só em `a_pagar`) |
| `GET trabalhos-eletricista/:id/fatura[?parte=regresso]` | a fatura-recibo (do trabalho ou da ida) |

`GET orcamentos/:id/eletricista` → `trabalho` leva também `ativo`, `concluida`, `material`, `fotos`, `ensaios`, `diagnostico` (avaria), `falta`, `confirmada`, `confirmada_auto`, `prazo_confirmacao`, `estrelas`, `comentario`, `comentario_site`, `reclamacao`, `aprovada`, `pagamento`, `regresso` (a ida sem defeito), `visita_sem_defeito`, `pode_aprovar`, `pode_devolver` e `pode_decidir`; sem trabalho ativo, `trabalho` é o último aprovado ou pago (`ativo: false`). `GET eletricistas` → cada eletricista leva `trabalhos` (em curso ou por pagar), `anonimizado`, `iban` (mascarado), `avaliacao` (`{n, media}`) e `comentarios`.
| `POST config-orcamento` | `{eletricista_pct}`: a percentagem por omissão (não sai no `/api/catalogo` público) |

Transições: aprovar (de pendente ou recusado), recusar (só de pendente), suspender (de aprovado), reativar (de suspenso). Suspender fecha logo as sessões do eletricista.

## Sessões

Três tipos de sessão, cada um com o seu cookie e a sua tabela; em todos a base de dados guarda só o SHA-256 do token.

| Quem | Cookie | Path | Tabela | Rotas |
|---|---|---|---|---|
| Equipa | `domus_painel` | `/painel` | `sessoes` | `/painel/api/*` |
| Cliente | `domus_conta` | `/api` | `contas_sessoes` | `/api/conta/*`, `/api/orcamento` |
| Eletricista | `domus_eletricista` | `/api/eletricista` | `eletricistas_sessoes` | `/api/eletricista/*` |

Uma sessão de eletricista não abre rotas do painel nem da conta, e vice-versa, mesmo que o token seja posto no cookie de outro tipo (há um teste para as nove combinações). O estado `aprovado` é verificado em cada pedido.

## Servidor

- **Caddy** (`servidor/caddy/Caddyfile`): `/api/eletricista/*` vai para o painel, com o corpo até 8 MB (o documento de 5 MB em base64 dá cerca de 6,7 MB). O bloco tem de ficar antes do `/api/*` dos pagamentos.
- **Variável nova, opcional:** `ELETRICISTAS_DIR`. Por omissão fica dentro de `dados/painel`, que já é um volume do painel.
- **Emails:** pelo SMTP do painel, como os da conta. Os avisos à empresa vão para os utilizadores do painel com o papel CEO.
- **`robots.txt`:** `eletricista.html` não é indexada. Enquanto o módulo não for publicado, `trabalhe-connosco.html` tem `noindex` e está fora do `sitemap.xml` e do rodapé do site.

## Acesso rápido (só no lançador local)

O botão "Eletricista de teste" (`POST /api/eletricista/dev/entrar {n: 1}`) cria um eletricista de teste já aprovado, com dados fictícios e sem documento, e abre a sessão. Tem as mesmas proteções dos outros botões (docs/SEGURANCA.md "Acesso rápido"): no servidor a rota não existe.

## Base de dados

Migração 30 (recria `trabalhos_eletricista` e `trabalhos_eletricista_eventos` pelo procedimento da 29, para os estados e eventos novos): colunas `confirmada`, `confirmada_auto`, `estrelas` (1 a 5), `comentario`, `comentario_site`, `reclamacao`, `reclamacao_de` (`cliente` / `ceo`), `reclamacao_quando`, `reclamacao_decisao` (`defeito` / `sem_defeito`), `reclamacao_decidida`, `aprovada`, `aprovada_por`, `valor_cent`, `valor_detalhe`, `fatura_id`, `fatura_tipo`, `fatura_bytes`, `fatura_quando`, `paga`, `paga_por`; e `eletricistas.iban`. Migração 31: a ida sem defeito — `regresso_desde`, `regresso_cent`, `regresso_detalhe`, `regresso_fatura_id`, `regresso_fatura_tipo`, `regresso_fatura_bytes`, `regresso_fatura_quando`, `regresso_paga`, `regresso_paga_por`.

Migração 47: `trabalhos_extra` (trabalho a mais; ver "Trabalho a mais").

Migração 50: `idas_perdidas` (ver "Ida perdida") e `obras_paradas` (ver "Parar a obra por segurança").

Migração 52 (só colunas novas, todas a aceitar `NULL`; nenhuma tabela é recriada): `eletricistas.especialidades` (JSON com as chaves de parceiro); `orcamentos.especialidade` (`geral`, `domotica`, `solar`, `redes` ou `NULL`); `trabalhos_eletricista.especialidade`, `prioridade_ate` (ms), `tecnico_id`, `tecnico_por` e `tecnico_em`. As obras que já existiam com um eletricista com n.º da DGEG ficam com ele como técnico responsável. O n.º da DGEG opcional não precisou de mudar a tabela: a coluna `eletricistas.dgeg` continua `NOT NULL` e quem não tem habilitação fica com o texto vazio (é o que a linha anonimizada já guardava).

## Rondas seguintes

Publicar o módulo (ver "Para publicar"), quando o dono decidir.

## Pedir proposta só a um eletricista

Num pedido com planta ainda sem proposta aceite (com `PROPOSTAS_BOLSA` ligado), "atribuir" a um eletricista já não lhe entrega os dados do cliente nem pede visita (decisão do dono, 2026-10-11): pede-lhe a proposta. O trabalho vai para a bolsa com `so_para` = esse eletricista (migração 48), e só ele o vê; propõe horas e material pela planta, o CEO escolhe e envia a proposta, e só depois de o cliente aceitar é que ele vê o nome e a morada. Para abrir o pedido a todos, retira-se e põe-se na bolsa. Nas avarias e nas obras já aceites a atribuição direta continua como era.
