# CRM e quadro de tarefas (painel da empresa)

Decisões do dono de 2026-10-03: o CRM fica **dentro do painel** (não é uma aplicação à parte) e há um **quadro de tarefas** com os lembretes do CRM. Código: `painel/src/crm.js`, `painel/src/tarefas.js`, ecrãs `painel/public/ecras/crm.js` e `ecras/tarefas.js`; migrações **32** e **33** (`painel/src/db.js`); testes `painel/test/crm-tarefas.test.js` e a matriz de `papeis.test.js`.

**Segunda ronda (mesmo dia, migração 33):** o ecrã antigo "Clientes" chama-se **"Casas e planos"** (§0); "Como nos conheceu?" e `utm_source` na origem (§3); lembrete do pedido novo em **dias úteis**, lembrete novo **depois da visita** e prazos editáveis pelo CEO (§6); **só o CEO** vê e atribui as tarefas de todos (§5); **email diário** das tarefas às 08:00 (§6); **Separar** um pedido da ficha (§1). Migração 33: `orcamentos.origem_contacto` trocada por uma coluna igual com a lista nova no `CHECK` (os valores guardados ficam), `orcamentos.crm_separado`, `utilizadores.resumo_tarefas_dia` e cinco linhas `lembrete_*` em `config_orcamento`.

## 0. Menu: "CRM" e "Casas e planos"
- **CRM** (`#/crm`): as **pessoas** — fichas de cliente derivadas dos pedidos, funil, notas e contactos (este documento).
- **Casas e planos** (`#/clientes`; antes chamava-se "Clientes"): as **casas com conta e plano** no servidor Domus (docs/PAINEL-EMPRESA.md). Só mudou o nome no menu, no título e no cabeçalho; a rota `#/clientes` e a API `clientes` são as mesmas. A ficha de cada casa tem o botão **"Abrir a ficha no CRM"** (`GET clientes/:c` → `crm_cliente_id`: a ficha do pedido que deu origem à casa; `null` se não houver ou se o utilizador não a puder abrir — técnico sem obra nessa casa, ficha anonimizada).

## 1. Ficha do cliente
- **Uma ficha por pessoa** (`crm_clientes`), derivada dos dados que já existem: cada pedido (`orcamentos`) é ligado à ficha da mesma pessoa — primeiro a **mesma conta de cliente**, depois o **mesmo email** (sem diferença de maiúsculas), depois o **mesmo telefone** (só algarismos, sem o +351). Os emails e telefones de todos os pedidos já ligados contam. Sem nenhum, nasce uma ficha nova com o nome e os contactos do pedido. A ligação faz-se ao ler (CRM, tarefas, orçamentos) e de 15 em 15 minutos; não mexe em `orcamentos.atualizado` (retenção).
- **Fundir** (só CEO, "Juntar outra ficha da mesma pessoa"): os pedidos, as notas/contactos e as tarefas da outra ficha passam para esta, os contactos em falta vêm da outra, e a outra sai. Auditoria `crm_clientes_fundidos`.
- **Separar** (só CEO; o inverso de "Juntar"; botão "Separar para outra ficha" no bloco do pedido, quando a ficha tem mais de um pedido): o pedido passa para uma **ficha nova, só dele**, com o nome e os contactos desse pedido; as notas/contactos e as tarefas ligados a **esse pedido** vão com ele (os gerais ficam). A conta de cliente fica na ficha de origem. O pedido fica marcado (`orcamentos.crm_separado`, a data): a ligação automática só mexe em pedidos sem ficha, e um pedido marcado **nunca** é junto por ela a uma ficha existente (se perdesse a ficha ganhava uma só dele). Um pedido **novo** com o mesmo email/telefone vai para a ficha mais antiga (a de origem). Juntar à mão continua possível. Auditoria `crm_pedido_separado` `{pedido, para}`. Uma ficha com um só pedido não se separa (400).
- A ficha mostra: contactos (editáveis por CEO e comercial), conta de cliente, responsável, casa(s) ligada(s); os **pedidos** com a fase, o responsável e a origem (editáveis ali); **pagamentos** e **relatórios técnicos** (CEO e comercial); **obras**; **trabalhos de eletricistas externos** (só CEO e só com `ELETRICISTAS=1`); **tarefas** ligadas; e o histórico de **notas e contactos** (nota, chamada, email, WhatsApp, visita: data/hora, quem, texto curto).
- Registar um contacto (não uma nota) passa os pedidos **novos** do cliente (ou só o pedido escolhido) a **contactado**.

## 2. Fases do negócio
As fases **são os estados que o pedido já tinha** (nada duplicado): novo → contactado → **visita** (`visita_marcada`) → **proposta** (`proposta_enviada`) → aceite → perdido. Automáticas pelos eventos de sempre: pedido criado = novo; contacto registado = contactado; "Marcar visita" = visita; proposta enviada = proposta; sinal pago (ou aceite à mão) = aceite. Um pedido novo/contactado com a **visita técnica paga** aparece na fase "visita" (a data marca-se depois). À mão: na ficha do cliente ou na ficha do pedido, pelo `POST orcamentos/:id` de sempre (com as mesmas regras e efeitos: stock, obra). **Perdido** pede o motivo: `motivo_perda_tipo` = preço · prazo · sem resposta · outro (com "outro" é preciso o texto); o texto `motivo_perda` continua como pormenor (os pedidos antigos com só o texto continuam válidos).

**Funil** (ecrã CRM → Funil): colunas por fase com a contagem e o valor total das propostas; **Pedidos**: lista com filtros (fase, origem, concelho, responsável, datas de receção). O concelho é a localidade do pedido quando é um dos 308 concelhos.

## 3. Origem do contacto
- Vai com o pedido só **uma categoria** (`origem_contacto`) e a página de anúncio de entrada (`?servico=carregador|quadro-antigo`). A categoria escolhe-se **no navegador**, por esta ordem:
  1. a **resposta da pessoa** a "Como nos conheceu?" (escolha opcional no formulário "Pedir contacto" do site e no passo "Enviar" do simulador): Google (`google`) · Facebook / Instagram (`facebook_instagram`) · Recomendação de um amigo (`recomendacao`) · Eletricista parceiro (`eletricista_parceiro`) · Vi a carrinha / passei na rua (`carrinha_rua`) · Outro (`outro`);
  2. senão, o **`utm_source`** do endereço de entrada, reduzido a uma categoria (`google`/`googleads`/`adwords` → `google`; `facebook`/`fb`/`meta` → `facebook`; `instagram`/`ig` → `instagram`; qualquer outro → `outro`);
  3. senão, o **`document.referrer`** (`google`, `facebook`, `instagram`, `outro`; o próprio site ou nenhum = `direto`).
- **Privacidade:** do navegador sai só a categoria — **nunca** o endereço de onde veio nem o valor do `utm_source` (nem os outros `utm_*`), sem cookies e sem scripts de terceiros. Para a categoria da chegada valer nas páginas seguintes (a página de anúncio leva ao simulador), fica **só a categoria** (`google`, `facebook`, `instagram` ou `outro`) no `sessionStorage` do separador, chave `domus.origem`, até o separador fechar; sem `sessionStorage` funciona na mesma (vale só na própria página). Está na linha da origem em `web/privacidade.html` e na tabela de `web/cookies.html`. Código: `web/origem.js` (usado por `web/site.js` em todas as páginas e por **uma linha** em `web/simulador/app.js` ao enviar).
- Lista do servidor (`ORIGENS_CONTACTO`, `painel/src/db.js`) e do painel (filtro do funil, selo e edição na ficha): `google`, `facebook`, `instagram`, `facebook_instagram`, `recomendacao`, `eletricista_parceiro`, `carrinha_rua`, `direto`, `outro`. Os valores já guardados continuam válidos.
- O servidor aceita `origem_contacto` e `origem_entrada` em `POST /api/orcamento` e **ignora** valores desconhecidos (o pedido nunca falha por isto); ficam em `orcamentos.origem_contacto` / `origem_entrada` (também no pedido da avaria, que só passa a orçamento depois de pago). Edição à mão na ficha do cliente (`POST crm/pedidos/:id`). Usa-se só em totais (filtro do funil). Linha em `web/privacidade.html`.
- **Publicar primeiro o painel**, depois o site: um painel antigo recusa campos desconhecidos (400).

## 4. Responsável
`orcamentos.responsavel_id` (por pedido) e `crm_clientes.responsavel_id` (por cliente): utilizador ativo do painel ou nenhum.

## 5. Papéis
| | CEO | Comercial | Técnico |
|---|---|---|---|
| Funil e lista de pedidos (`crm/pedidos`) | sim | sim | não (403) |
| Fichas de cliente | todas (também as anonimizadas) | todas | só as dos pedidos/casas das obras que lhe estão atribuídas (as outras: 404) |
| Editar ficha, fase, responsável, origem | sim | sim | não |
| Notas e contactos | todos os tipos | todos os tipos | lê; regista só **visitas** |
| Fundir fichas e separar um pedido | sim | não | não |
| Tarefas | vê e edita todas; atribui a qualquer pessoa (ou aos CEO) | só as suas (responsável ou criadas por si; as outras: 404); atribui só a si; liga a clientes, pedidos e obras | só as suas (responsável ou criadas por si; as outras: 404); atribui só a si; liga só às suas obras |
| Apagar tarefa | sim | só as que criou | só as que criou |
| Prazos dos lembretes automáticos | edita | não | não |
| Email diário das tarefas | as suas e as sem responsável | as suas | as suas |

**Só o CEO vê e atribui as tarefas de todos** (decisão do dono, segunda ronda). Para o comercial e o técnico vale a mesma regra em todo o lado, verificada no servidor: a lista e os filtros de `GET tarefas`, a semana, a contagem do menu (já contava só as próprias), o bloco "As minhas tarefas deste cliente" da ficha do CRM (`GET tarefas?cliente=`) e uma tarefa pelo número (404). Os lembretes automáticos sem responsável (dos CEO) não aparecem ao comercial; os que lhe estão atribuídos (é o responsável do pedido ou do cliente) aparecem. Uma tarefa criada por alguém e que o CEO passou a outra pessoa continua visível para quem a criou, que a pode guardar sem mudar o responsável (ou trazê-la para si), nunca passá-la a terceiros. `GET tarefas` → `equipa` só vai inteira para o CEO.

## 6. Quadro de tarefas
- Tarefa: título, descrição, ligação opcional a cliente / pedido / obra (ligada a um pedido fica também ligada à ficha do cliente), responsável (`NULL` = **os CEO**), prazo (dia e hora opcional), estado **A fazer / Em curso / Feito**, checklist (até 50 itens), criada por/quando, feita por/quando.
- Ecrã **Tarefas**: **Quadro** (3 colunas; arrastar com o rato, ou "Mover para" em cada cartão — teclado; o do CEO tem as de todos e o filtro por responsável, o dos outros só as suas), **As minhas** (de que sou responsável; o CEO também vê as sem responsável) e **Semana** (tarefas com prazo e as obras agendadas, estas só para consulta). As feitas há mais de 30 dias saem do quadro (ficam na base).
- **Selo no menu** "Tarefas": as minhas tarefas por fazer atrasadas ou para hoje (`GET tarefas/contagem`; atualiza ao mudar de ecrã e quando se mexe numa tarefa; sem temporizador, para não manter a sessão aberta para sempre).
- **Início → "Para hoje"**: as mesmas tarefas (as minhas, atrasadas ou para hoje), até 8, com ligação a cada uma e ao quadro; o bloco não aparece quando não há nenhuma (`ecras/inicio.js`, `GET tarefas?vista=minhas`).

### Lembretes automáticos (decisão do dono)
| Quando | Tarefa | Tipo | Prazo (`config_orcamento`) |
|---|---|---|---|
| pedido na fase **novo** há **1 dia útil** (sem contacto registado) | "Ligar a &lt;cliente&gt; — pedido novo" | `novo_24h` | `lembrete_novo_dias_uteis` = 1 (1–10) |
| visita marcada cuja data passou há **2 dias** e ainda sem proposta | "Enviar proposta — &lt;cliente&gt;" | `visita_2d` | `lembrete_visita_dias` = 2 (1–30) |
| proposta enviada e não aceite há **3 dias** | "Seguir proposta — &lt;cliente&gt;" | `proposta_3d` | `lembrete_proposta_1_dias` = 3 (1–30) |
| … há **7 dias** | "Seguir proposta — &lt;cliente&gt; (7 dias)" | `proposta_7d` | `lembrete_proposta_2_dias` = 7 (2–60) |
| … há **14 dias** | "Perdido? — &lt;cliente&gt;" (a fase fica até a pessoa decidir) | `proposta_14d` | `lembrete_proposta_3_dias` = 14 (3–90) |

- **Dias úteis** (pedido novo): segunda a sexta, hora de Lisboa, **saltando os feriados nacionais** (os de data fixa, Sexta-feira Santa, Páscoa e Corpo de Deus; os municipais não contam). Conta a mesma hora N dias úteis depois: um pedido de sexta às 15:00 pede a chamada na segunda às 15:00; um pedido de sábado, domingo ou feriado conta a partir das 00:00 do dia útil seguinte (sábado → lembrete na terça às 00:00). Funções `aposDiasUteis` e `feriadoNacional` (`tarefas.js`).
- **Visita:** pedido no estado "visita marcada" com `data_visita` passada há N dias (dias seguidos; uma visita só com o dia, sem hora, conta do fim desse dia). A chave leva a data da visita: remarcar dá um lembrete novo. Some quando a proposta é enviada (ou a fase muda, ou a visita é remarcada para depois).
- **Prazos editáveis pelo CEO** no ecrã Tarefas ("Lembretes automáticos: prazos (CEO)"), guardados em `config_orcamento` pelo `POST config-orcamento` de sempre (só CEO, auditado). Validados no servidor: números inteiros dentro dos limites da tabela, e os três da proposta **crescentes**. Não saem no `/api/catalogo` público. Os nomes dos tipos (`novo_24h`, `proposta_3d`…) são só identificadores: ficaram dos prazos de origem.
- O início da fase é a última mudança para esse estado na auditoria (ou a criação do pedido). Uma proposta já aceite online (à espera do sinal) não gera lembretes.
- **Idempotentes:** cada lembrete tem uma chave única `<pedido>:<tipo>:<início da fase ou data da visita>` (`tarefas.lembrete`, UNIQUE): nunca se repete, mesmo feito; uma proposta reenviada tem chaves novas. Só existe o da etapa mais recente: aos 7 dias o de 3 é cancelado, aos 14 o de 7.
- **Cancelados sozinhos** (`tarefas.cancelada`, saem do quadro, ficam na base, auditoria `tarefa_cancelada`) quando a fase avança. Não se apagam (marcam-se como feitos). Se o CEO mudar os prazos e um lembrete cancelado (não feito) voltar a ser devido, **reabre-se o mesmo** (auditoria `tarefa_reaberta`), sem duplicar.
- Atribuídos ao responsável do pedido, senão ao do cliente, senão aos CEO (`NULL`). Prazo: o dia em que nascem.
- Verificados **ao ler** (tarefas, contagem, semana, CRM) e **de 15 em 15 minutos** (o mesmo padrão dos pagamentos e dos eletricistas; `tarefas.iniciar`).
- **Volta poupada:** se nada foi escrito na base desde a última volta (`total_changes()` da ligação) e o minuto de Lisboa é o mesmo, a volta não se repete (o resultado seria igual). Com 5000 pedidos, a contagem do selo do menu passou de ~700 ms para ~40 ms e a lista do CRM de ~900 ms para ~190 ms; as listas leem os pedidos sem a coluna `simulacao`.
- **Obra concluída pelo técnico → o CEO confirma** (decisão do dono): quando uma obra passa a **concluída no ecrã Obras** (`POST obras/:id`, técnico ou CEO) e o pedido dela (aceite) ainda não tem "Obra concluída" confirmada (`orcamentos.obra_concluida`), nasce a tarefa **"Confirmar obra concluída — &lt;cliente&gt;"** (`obra_confirmar`; para os CEO, prazo de hoje, ligada ao pedido, à ficha e à obra; chave `<pedido>:obra_confirmar:<obra>`, uma por obra). **O ecrã Obras não avisa o cliente nem mexe no pedido:** o cliente só é avisado, o restante pedido e os emails automáticos começados quando o CEO carrega em "Obra concluída" na ficha do pedido. A tarefa **sai sozinha** (cancelada, verificada ao ler e de 15 em 15 minutos) quando o CEO confirma ou a obra deixa de estar concluída; se a obra voltar a concluída reabre-se a mesma; marcada como feita não volta a nascer. Obras sem pedido ligado (ou de um pedido que não está aceite, ou anonimizado) não criam tarefa. Só nasce no momento em que a obra é marcada: as obras concluídas antes disto não geram tarefas. Se as checklists da obra tiverem **passos obrigatórios por marcar**, a tarefa diz quantos (`aviso`, calculado ao ler; a obra conclui-se na mesma — [PROCEDIMENTOS.md](PROCEDIMENTOS.md) §2).
- **Outras tarefas automáticas** ([EMAILS-AUTOMATICOS.md](EMAILS-AUTOMATICOS.md)): "Ligar a &lt;cliente&gt; — pagamento em falta" (`pagamento_falta`, com o 2.º lembrete por email ao cliente) e "Avaliação baixa — ligar a &lt;cliente&gt;" (`avaliacao_baixa`, 1 a 3 estrelas). Usam a mesma chave única (`tarefas.lembrete`), são para os CEO e não dependem da fase do pedido (os lembretes do CRM não as cancelam). Os emails automáticos ao cliente correm na mesma volta de 15 minutos (`tarefas.aCadaVolta`).

### Email diário das tarefas (decisão do dono)
- **Um email por utilizador ativo do painel**, na primeira passagem depois das **08:00 de Lisboa** (verifica-se de minuto a minuto; `tarefas.resumoDiario`), com as suas tarefas por fazer **atrasadas** e **para hoje** (os CEO: também as sem responsável). **Sem tarefas não sai nada.**
- **Nunca dois no mesmo dia**, também depois de reiniciar o painel: o dia (Lisboa) fica em `utilizadores.resumo_tarefas_dia` **antes** de enviar (um envio que falhe não se repete nesse dia). Se o painel estiver parado às 08:00, o email sai quando voltar, nesse dia.
- **O email não leva os títulos nem as descrições** (podem ter o nome do cliente; e sem SMTP os emails são escritos no registo do servidor): cada linha tem o número da tarefa, o prazo e, nos lembretes automáticos, o tipo e o número do pedido; os títulos leem-se no painel (ligação no fim). Pelo `email.js` de sempre (SMTP do `.env`; com SMTP não se regista o assunto nem o corpo). Nada disto vai para a auditoria.

## 7. RGPD
Apagar a conta de cliente (pelo cliente, pelo CEO ou pela retenção; `conta.js apagar`, na mesma transação): saem **todas as notas e contactos** das fichas dessa conta; as **tarefas** ligadas ao cliente ou aos pedidos dela ficam só com um **título neutro** ("Tarefa (cliente apagado — RGPD)" ou "Lembrete automático (cliente apagado — RGPD)"), sem descrição, checklist nem ligação; a ficha é **anonimizada** ("Anonimizado (RGPD)", sem email, telefone nem conta, e o seu histórico na auditoria sai) — a não ser que ainda tenha pedidos com dados (os convertidos em casa e obra ficam pelo contrato), e aí só perde a ligação à conta. Os textos das notas, os títulos e as descrições das tarefas **nunca** vão para a auditoria nem para o registo do servidor.

## 8. API (`/painel/api/`)
| Método e caminho | Papéis | O quê |
|---|---|---|
| `GET crm/pedidos` | ceo, comercial | `?fase=&origem=&concelho=&responsavel=(id\|sem)&de=&ate=` → `{pedidos, funil: {fase: {n, valor}}, fases, concelhos, equipa}` |
| `POST crm/pedidos/:id` | ceo, comercial | `{responsavel_id?, origem_contacto?, origem_entrada?}` |
| `POST crm/pedidos/:id/separar` | ceo | `{}` → a ficha de origem + `nova_ficha` (id); 400 se a ficha só tem esse pedido |
| `GET crm/clientes` | todos (técnico: os seus) | `?q=` → `{clientes}` |
| `GET crm/clientes/:id` | todos (técnico: os seus) | a ficha |
| `POST crm/clientes/:id` | ceo, comercial | `{nome?, email?, telefone?, responsavel_id?}` |
| `POST crm/clientes/:id/fundir` | ceo | `{outro}` |
| `POST crm/clientes/:id/registos` | todos (técnico: só `visita`) | `{tipo, quando?, texto?, orcamento_id?}` |
| `GET tarefas` | todos (comercial e técnico: só as suas) | `?vista=minhas\|todas&estado=&responsavel=&cliente=&orcamento=&obra=` → `{tarefas, equipa}` |
| `POST tarefas` / `POST tarefas/:id` | todos (regras acima) | `{titulo, descricao?, cliente_id?, orcamento_id?, obra_id?, responsavel_id?, prazo?, prazo_hora?, estado?, checklist?}` |
| `POST tarefas/:id/apagar` | todos (CEO ou quem criou; nunca os automáticos) | |
| `GET tarefas/calendario` | todos | `?de=AAAA-MM-DD` → `{inicio, fim, hoje, dias, tarefas, obras}` |
| `GET tarefas/contagem` | todos | `{atrasadas, hoje, total}` |
| `POST orcamentos/:id` | ceo, comercial | (já existia) aceita também `motivo_perda_tipo` |
| `GET config-orcamento` / `POST config-orcamento` | ceo | (já existiam) também os prazos `lembrete_*` |
| `GET clientes/:c` | todos | (já existia) traz também `crm_cliente_id` |
