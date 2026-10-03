# Emails automáticos ao cliente (onboarding automático)

Decisões do dono de 2026-10-03: o cliente recebe **sozinho** quatro emails ao longo do pedido — **só email** (sem SMS nem WhatsApp). Código: `painel/src/emails-auto.js` (e `emFalta` em `pagamentos-pedido.js`, as tarefas automáticas em `tarefas.js`, a avaliação em `conta.js`); migração **34** (`painel/src/db.js`); ecrãs `painel/public/ecras/tarefas.js` (configuração) e `ecras/crm.js` (lista na ficha), `web/conta.js` (avaliação e convite do Google); testes `painel/test/emails-auto.test.js`.

## 1. O que sai e quando
| Email | Quando | A quem | Chave (`emails_automaticos.chave`) |
|---|---|---|---|
| **Boas-vindas** — "recebemos o seu pedido" e o que acontece a seguir (passos do formulário de contacto ou do simulador) | logo ao receber um pedido do site (`origem = site`) | o email da conta; sem conta, o email escrito no formulário (sem email não sai) | `<pedido>:boas_vindas` |
| **Lembrete da visita** — "a visita é amanhã" | na véspera, a partir da hora `email_visita_hora` (10:00) | idem | `<pedido>:visita:<data da visita>` |
| **Pagamento em falta** — 1.º lembrete | 3 dias (`email_pagamento_1_dias`) depois de pedido o pagamento | o email da conta | `<pedido>:pagamento_1:<fase>:<data do pedido de pagamento>` |
| **Pagamento em falta** — 2.º lembrete, com a tarefa para os CEO | 7 dias (`email_pagamento_2_dias`) | idem | `<pedido>:pagamento_2:<fase>:<data>` |
| **Depois da obra** — guia da conta e da área de cliente e pedido de avaliação (1 a 5 estrelas) | 2 dias (`email_obra_dias`) depois de a obra ser dada por concluída no painel | idem | `<pedido>:obra` |

Os três primeiros são **emails de serviço**: saem sempre. Só o último leva **"Não quero receber"** (§5).

### Boas-vindas
- Antes disto o cliente não recebia nada ao enviar o pedido (só os códigos da conta e, mais tarde, os avisos de pagamento, visita e relatório). **Não há duplicados:** a **avaria paga ao enviar** não as recebe — o email "pagamento recebido" já diz "O seu pedido foi recebido. Vamos marcar a visita técnica…".
- Não leva o nome nem o serviço escritos no formulário (o endereço de um pedido sem conta não está confirmado: nada do que a pessoa escreveu vai no email).
- Um pedido criado no painel pela equipa não recebe boas-vindas. Um pedido já "perdido" quando chega a vez, ou com mais de 24 h (painel parado), também não.

### Lembrete da visita
- Visitas com data: `orcamentos.data_visita` (as marcadas no painel e as que os eletricistas externos marcam para a visita técnica e o diagnóstico) e a ida à obra marcada por um eletricista externo (`trabalhos_eletricista.visita`, com `ELETRICISTAS=1`).
- **Remarcar** dá um lembrete novo (a data faz parte da chave).
- **Sem lembrete:** visita marcada (ou remarcada) na própria véspera **depois** da hora do envio, ou para o próprio dia — o cliente acabou de receber o email "visita marcada" (a hora da marcação lê-se da auditoria); painel parado toda a véspera entre a hora do envio e as 21:00 (no dia da visita já não se lembra); pedido perdido, aceite, convertido ou sem visita (desmarcada, cliente faltou).
- As obras da equipa própria (ecrã Obras) não têm lembrete.

### Pagamento em falta
- **O que conta como pagamento pedido** (`pagamentos.emFalta`): o **sinal** de uma proposta que o cliente aceitou online (conta desde `proposta_aceite`) e o **restante** de uma obra dada por concluída no painel (conta desde `obra_concluida`, quando sai o email "obra concluída"). As compras opcionais (relatório, visita) e a visita sem defeito não têm lembretes.
- **Multibanco e validade:** um pagamento aberto vale 24 h (`VALIDADE_MS`) e depois fica `expirado`; não existiam lembretes. O lembrete conta do pedido de pagamento, não da referência. **Enquanto houver um pagamento aberto ainda válido** (o cliente acabou de gerar uma referência Multibanco) não se lembra nem se cria a tarefa: espera-se que expire. O email avisa que, se já pagou por referência, a confirmação pode demorar.
- **3 → 7 → tarefa e mais nada:** com o 2.º lembrete nasce a tarefa **"Ligar a &lt;cliente&gt; — pagamento em falta"** (para os CEO, prazo de hoje, ligada ao pedido e à ficha; chave `<pedido>:pagamento_falta:<fase>:<data>` em `tarefas.lembrete`, única). Depois não sai mais nenhum email. Se o 1.º não saiu a tempo (painel parado), aos 7 dias sai só o 2.º.
- **Deixa de estar em falta** — pago, proposta mudada (o cliente aceita de novo: contagem nova), pedido perdido, sinal devolvido, pagamentos desligados: não sai nada e a tarefa ainda aberta é **cancelada** (como os lembretes do CRM).
- Mais de 7 dias depois do 2.º prazo (ex.: dívidas antigas no dia em que isto é publicado) já não sai nada nem nasce tarefa.

### Depois da obra
- O guia: "A minha conta" (pedido, pagamentos, recibos, relatório) e, se o pedido tem plano mensal ou casa ligada, a "Área de cliente". O pedido de avaliação só vai se o cliente ainda não avaliou.
- **Conta "obra concluída"** = `orcamentos.obra_concluida` (o botão "Obra concluída" do pedido, ou a aprovação do trabalho de um eletricista externo).
- O convite do Google **não** vai no email: aparece na conta depois de avaliar (§4).

## 2. Regras comuns
- **Uma vez só, também depois de reiniciar:** cada envio é uma linha em `emails_automaticos` com a chave única, gravada **antes** de enviar (como o email diário das tarefas): um envio que falhe não se repete.
- **Quando corre:** na volta dos lembretes do CRM (`tarefas.iniciar`, de 15 em 15 minutos, `tarefas.aCadaVolta`) e, as boas-vindas, logo ao receber o pedido.
- **Horas de silêncio:** entre as **21:00 e as 08:00 de Lisboa** não sai nada; o que for devido sai na primeira volta depois das 08:00.
- **Quem nunca recebe:** pedidos anonimizados ou arquivados; pedidos de contas apagadas (um pedido com simulação teve sempre conta: sem ela não se envia para o email antigo do pedido).
- **Sem dados nos registos:** a tabela guarda o pedido, o tipo e a data — nem o endereço nem o texto. No registo do servidor fica "email automático (&lt;tipo&gt;) do pedido N" (sem SMTP, o texto do email é escrito no registo, como todos os outros). Nada disto vai para a auditoria, a não ser a recusa (`emails_recusados`, sem o email) e a avaliação (`avaliacao_cliente`, só as estrelas).

## 3. Configuração (CEO)
Ecrã **Tarefas → "Emails automáticos ao cliente (CEO)"**, guardado em `config_orcamento` pelo `POST config-orcamento` de sempre (só CEO, auditado), validado no servidor:

| Chave | Omissão | Limites |
|---|---|---|
| `email_pagamento_1_dias` | 3 | 1–30, inteiro, menor do que o seguinte |
| `email_pagamento_2_dias` | 7 | 2–60, inteiro |
| `email_obra_dias` | 2 | 1–30, inteiro |
| `email_visita_hora` | 10 | 8–20, inteiro (hora de Lisboa, na véspera) |
| `google_avaliacao_url` | (vazia) | endereço `https` do Google (`g.page`, `goo.gl`, `google.com`, `google.pt`), até 300 caracteres; vazia ou `null` tira-a |

Não saem no `/api/catalogo` público.

## 4. Avaliação e convite do Google
- **Avaliar:** as estrelas (1 a 5) que já existiam são as da confirmação do trabalho de um eletricista externo (docs/ELETRICISTAS.md). Para as obras da equipa própria (e as aceites sozinhas ao fim de 7 dias), a conta mostra **"Como correu?"** no pedido com a obra concluída: `POST /api/conta/pedidos/:id/avaliar {estrelas}`, uma vez (`orcamentos.avaliacao_estrelas`, `avaliacao_quando`; sem comentário).
- **Convite do Google:** depois de avaliar, a conta mostra "Avaliar no Google" a **todos**, com qualquer número de estrelas (decisão do dono: **não se filtra** por 4–5 estrelas — as regras do Google proíbem escolher quem é convidado). Com `google_avaliacao_url` vazia não há convite em lado nenhum.
- **Avaliação baixa (1 a 3 estrelas):** tarefa urgente **"Avaliação baixa — ligar a &lt;cliente&gt;"** (para os CEO, prazo de hoje; chave `<pedido>:avaliacao_baixa:pedido`, uma por pedido), venha a avaliação da conta ou da confirmação do trabalho.
- `GET /api/conta/pedidos` → `avaliacao`: `{pode, estrelas, do_pedido, google}` ou `null`.

## 5. "Não quero receber"
- Só no email depois da obra. A ligação é `<painel>/api/conta/emails/nao-receber?t=<pedido>.<HMAC-SHA256>`: token **assinado** com um segredo que só existe na base (`emails_chave`, criado na migração), sem sessão e **sem o email no endereço**.
- `GET` mostra a página de confirmação (com o botão) e não muda nada; `POST` guarda a recusa — o botão da página ou o "um clique" do programa de email (cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, RFC 8058; `email.js` aceita cabeçalhos a mais, só ASCII e sem quebras de linha). Token forjado: 404, nada muda.
- A recusa fica **por email** (`emails_recusados`, em minúsculas) e vale para todos os pedidos desse email, daí em diante. Os emails de serviço continuam.
- Na ficha do CRM (CEO e comercial), só para ler: "O cliente não quer receber o email depois da obra desde …".

## 6. Painel
A **ficha do CRM** tem a secção "Emails automáticos": a lista dos emails enviados aos pedidos da ficha (data, tipo, pedido), sem os textos (`GET crm/clientes/:id` → `emails_automaticos`, `cliente.emails_recusados`; CEO e comercial). As tarefas automáticas aparecem no quadro com o selo "Automática: Pagamento em falta / Avaliação baixa" e não se apagam (marcam-se como feitas).

## 7. RGPD
- Apagar a conta (pelo cliente, pelo CEO ou pela retenção; `conta.js apagar`, na mesma transação): sai o **registo dos envios** de todos os pedidos da conta (apagados, anonimizados ou mantidos) e a **recusa** desse email; o histórico do pedido na auditoria (com `emails_recusados` e `avaliacao_cliente`) sai com o resto. Um pedido apagado leva as suas linhas (`ON DELETE CASCADE`). As tarefas automáticas ficam com o título neutro, como as outras (docs/CRM-TAREFAS.md §7).
- A avaliação da conta são só as estrelas (sem texto): fica no pedido anonimizado, sem nada que identifique a pessoa.
- `web/privacidade.html` não foi alterada: a frase "Só lhe escrevemos sobre o seu pedido, a sua conta ou a sua casa" continua verdadeira. Por decidir com o dono: uma linha sobre o email depois da obra (e como o recusar), a recusa guardada por email e a avaliação por estrelas das obras da equipa própria.

## 8. API
| Método e caminho | Quem | O quê |
|---|---|---|
| `GET` / `POST /api/conta/emails/nao-receber?t=` | público (token assinado) | página de confirmação / guarda a recusa (HTML; 404 com token inválido) |
| `POST /api/conta/pedidos/:id/avaliar` | conta dona, email confirmado | `{estrelas}` → `{pedido}`; 409 sem obra concluída ou já avaliado |
| `GET /api/conta/pedidos` | conta | (já existia) traz também `avaliacao` |
| `GET` / `POST /painel/api/config-orcamento` | ceo | (já existiam) também `email_*` e `google_avaliacao_url` |
| `GET /painel/api/crm/clientes/:id` | ceo, comercial | (já existia) traz também `emails_automaticos` e `cliente.emails_recusados` |
