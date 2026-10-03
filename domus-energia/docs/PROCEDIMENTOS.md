# Procedimentos (SOP) e checklists por obra (painel da empresa)

Decisões do dono de 2026-10-03: o painel tem um menu **"Procedimentos"** — a biblioteca de como se faz cada tipo de trabalho — e cada obra pode ter as **checklists** desses procedimentos. Código: `painel/src/procedimentos.js` (lógica e rotas do painel), `painel/src/procedimentos-sementes.js` (os seis rascunhos de arranque), `painel/src/eletricistas.js` (rotas da área do eletricista), `painel/src/tarefas.js` (o aviso na tarefa do CEO), ecrãs `painel/public/ecras/procedimentos.js` e `ecras/obras.js`, `web/eletricista.js`; migração **36** (`painel/src/db.js`); testes `painel/test/procedimentos.test.js` e a matriz de `papeis.test.js`.

## 1. Procedimento
- **Um por tipo de trabalho**: título, tipo de trabalho (`visita` Visita técnica · `diagnostico` Diagnóstico de avaria · `quadro` Quadro elétrico · `aparelhos` Aparelhos inteligentes · `carregador` Carregador de veículo elétrico · `entrega` Entrega ao cliente · `outro`), uma descrição curta (para que serve) e os **passos por ordem**. Cada passo: texto curto, nota opcional mais longa, **"Obrigatório"** e **"Segurança"**. **Só texto simples** (sem formatação; o ecrã escreve-o com `textContent`).
- **Estado**: `rascunho` → `publicado` → `arquivado`. Só os **publicados** existem para os técnicos, o comercial e os eletricistas externos.
- **Versões**: o CEO edita uma **cópia de trabalho** (`procedimentos`); cada publicação fica numa **versão imutável** (`procedimentos_versoes`: número, data e quem publicou), que é o que a equipa lê. Editar um procedimento publicado não muda nada para a equipa até o CEO carregar em **"Publicar a versão N+1"**; publicar sem alterações é recusado (409). Um arquivado repõe-se como rascunho ("Repor como rascunho"); publicá-lo outra vez sem alterações não sobe a versão.
- **Não há sugestões** de espécie nenhuma: quem não é CEO só lê.
- **Limites** (validados no servidor, `procedimentos.js`): título até 120 caracteres, descrição até 600, até **40 passos**, texto do passo até 200, nota até 1000; campos desconhecidos são recusados; um procedimento sem passos não se publica.

### Rascunhos de arranque
A migração 36 cria (só com a tabela vazia, uma única vez) **seis rascunhos**: Visita técnica · Diagnóstico de avaria · Substituição de quadro elétrico · Instalação de aparelhos inteligentes (relés e medidores no quadro) · Instalação de carregador de veículo elétrico · Entrega ao cliente (app, conta, explicação). Ficam `rascunho` e `por_rever`: ninguém os vê além do CEO, e cada um mostra no cimo **"Rascunho por rever: os passos de segurança têm de ser validados pelo responsável técnico antes de publicar."** até ser publicado (publicar apaga a marca). Os textos são nossos, pela ordem em que se trabalha (preparar, cortar e bloquear a alimentação, verificar a ausência de tensão, EPI, o trabalho, ensaios finais, fotos, limpeza, explicar ao cliente, registar no painel); os termos são os de `diagnostico-conteudo.js` e os limites dos ensaios são os que o painel já usa (isolamento ≥ 0,5 MΩ, terra ≤ 100 Ω, diferencial ≤ 300 ms) — sem artigos de regulamento. Os passos de segurança vão marcados "Segurança" e "Obrigatório".

## 2. Checklists por obra
- Na **ficha da obra** (ecrã Obras, bloco "Procedimentos") começa-se a checklist de um procedimento **publicado**: várias por obra, **cada procedimento uma vez** (409 à segunda). A checklist fica **presa à versão** com que começou (`obra_checklists.versao_id`): se o CEO publicar uma versão nova, a checklist continua com a sua (a ficha diz "o procedimento já vai na versão N"); uma obra nova começa já na versão nova. Um procedimento arquivado já não se começa, mas as checklists que existem continuam a marcar-se.
- Cada passo é uma caixa. **Marcam e desmarcam**: o CEO, o técnico **atribuído à obra** e o eletricista externo **desse trabalho** (§4). Cada marca guarda **quem e quando** (`obra_checklist_passos`); marcar outra vez um passo já marcado não muda quem o marcou; desmarcar apaga a marca.
- **Progresso**: a ficha e a lista de obras (`GET obras` → `checklists: {n, feitos, total, obrigatorios_falta}`, `null` sem checklists) mostram "Checklists 7/9" e "N obrigatórios em falta".
- **A obra conclui-se na mesma** com passos por marcar. A tarefa automática **"Confirmar obra concluída — &lt;cliente&gt;"** do CEO ([CRM-TAREFAS.md](CRM-TAREFAS.md) §6) leva `aviso`: "Checklists da obra: faltam N passos obrigatórios por marcar." — calculado **ao ler** (acompanha as marcas feitas depois; o texto guardado da tarefa não muda) e mostrado no cartão e na ficha da tarefa, com a ligação para a obra. Sem obrigatórios em falta, `aviso` é `null`.
- **Nomes**: quem marcou aparece com o nome de agora. Um utilizador **desativado** e um eletricista **suspenso ou retirado do trabalho** continuam com o seu nome; um eletricista **apagado pelo RGPD** aparece como ficou na sua linha ("Eletricista apagado (RGPD)"). O nome do eletricista externo só o CEO o vê ("Nome (eletricista externo)"); o técnico e o comercial veem "Eletricista externo".
- **Auditoria**: `procedimento_criado` / `_atualizado` / `_publicado` / `_arquivado` / `_reposto` (alvo `procedimento:<id>`), `obra_checklist_iniciada` e `obra_checklist_passo` (alvo `obra:<id>`; o eletricista fica como `eletricista:<id>`). Os detalhes levam **só números e nomes de campos** (procedimento, versão, checklist, número do passo, feito): os textos dos passos **nunca** vão para a auditoria nem para o registo do servidor.

## 3. Papéis
| | CEO | Técnico | Comercial | Eletricista externo |
|---|---|---|---|---|
| Ver procedimentos | todos (rascunhos e arquivados incluídos) | só os publicados (os outros: 404) | só os publicados | só os publicados, na sua área, com o módulo ligado |
| Criar, editar, publicar, arquivar, repor | sim | não (403) | não (403) | não (as rotas não existem) |
| Ver as checklists de uma obra | todas | as das suas obras (as outras: 403) | todas, só leitura | as da obra do seu trabalho, enquanto está aberto |
| Começar uma checklist e marcar passos | sim | só nas obras que lhe estão atribuídas | não (403) | só na obra do seu trabalho, até o dar por concluído |

Tudo verificado no servidor em cada pedido; o ecrã só esconde o que não se pode usar.

## 4. Eletricistas externos
- **Só com o módulo ligado** (`ELETRICISTAS=1`; [ELETRICISTAS.md](ELETRICISTAS.md)): desligado, `GET /api/eletricista/procedimentos*` e `POST /api/eletricista/trabalhos/:id/checklists*` respondem `404 Endereço desconhecido.`, como o resto do módulo. No painel os procedimentos funcionam na mesma.
- **Ajuda técnica** (`eletricista.html#/ajuda`): a secção "Procedimentos da Domus Energia" lista os publicados; cada um abre em `#/ajuda/<id>` (só leitura, sem o nome de quem publicou).
- **Ficha do trabalho → "Trabalho" → "Procedimentos da obra"** (só nos trabalhos do tipo `obra`, que têm obra): as checklists da obra, "Começar checklist" e as caixas dos passos. A ficha (`GET trabalhos/:id`) leva `checklists: {checklists, disponiveis}` (ou `null` nas visitas técnicas e avarias, e depois de o trabalho fechar). Só se mexe enquanto a ficha é editável (`aceite` ou `visita_marcada`): depois de "Obra concluída" as rotas respondem 409 e as caixas ficam só de leitura. Outro eletricista recebe 404; com o seu trabalho ninguém chega às checklists de outra obra.
- O eletricista vê o seu nome nas suas marcas e **"Domus Energia"** nas da equipa (nunca os nomes dos utilizadores do painel).

## 5. Base de dados (migração 36)
| Tabela | Colunas |
|---|---|
| `procedimentos` | `id`, `titulo`, `tipo` (CHECK), `descricao`, `passos` (JSON `[{texto, nota, obrigatorio, seguranca}]`: a cópia de trabalho), `estado` (CHECK `rascunho`/`publicado`/`arquivado`), `versao` (a última publicada; 0 = nunca), `por_rever` (rascunho de arranque ainda não publicado), `criado`, `criado_por_id`, `atualizado` |
| `procedimentos_versoes` | `id`, `procedimento_id`, `versao` (UNIQUE com o procedimento), `titulo`, `tipo`, `descricao`, `passos`, `publicado`, `publicado_por_id` |
| `obra_checklists` | `id`, `obra_id` (CASCADE), `procedimento_id`, `versao_id`, `iniciada`, `iniciada_por_id` ou `iniciada_por_eletricista_id`; UNIQUE (`obra_id`, `procedimento_id`) |
| `obra_checklist_passos` | `checklist_id` (CASCADE), `passo` (índice na versão), `quando`, `por_id` ou `por_eletricista_id`; chave (`checklist_id`, `passo`) |

Os procedimentos nunca se apagam (arquivam-se). As referências a utilizadores e eletricistas são `ON DELETE SET NULL`.

## 6. API
### Painel (`/painel/api/`)
| Método e caminho | Papéis | O quê |
|---|---|---|
| `GET procedimentos` | todos | CEO: todos, com `estado`, `versao`, `por_rever`, `aviso`, `por_publicar`, e `limites`; os outros: só os publicados (a versão publicada). `{procedimentos, tipos}` |
| `GET procedimentos/:id` | todos | CEO: a cópia de trabalho com `passos` e `em_obras`; os outros: a versão publicada (404 se não está publicado) |
| `POST procedimentos` | ceo | `{titulo, tipo, descricao?, passos?: [{texto, nota?, obrigatorio?, seguranca?}]}` → 201, nasce `rascunho` |
| `POST procedimentos/:id` | ceo | os mesmos campos (parcial); 409 num arquivado |
| `POST procedimentos/:id/estado` | ceo | `{acao: publicar \| arquivar \| repor}`; publicar: 400 sem passos, 409 sem alterações ou arquivado |
| `GET obras/:id/checklists` | todos (técnico: as suas obras) | `{checklists: [{id, procedimento_id, titulo, versao, versao_recente, iniciada, iniciada_por, passos: [{texto, nota, obrigatorio, seguranca, feito, por, quando}], feitos, total, obrigatorios_falta}], disponiveis, pode, resumo}` |
| `POST obras/:id/checklists` | ceo, tecnico (da obra) | `{procedimento_id}` → 201; 404 se não está publicado (CEO: 409), 409 se a obra já a tem |
| `POST obras/:id/checklists/:lista` | ceo, tecnico (da obra) | `{passo: índice a partir de 0, feito: true \| false}` |
| `GET obras` / `GET obras/:id` | (já existiam) | também `checklists` (o resumo) |
| `GET tarefas` | (já existia) | cada tarefa leva `aviso` (só a "Confirmar obra concluída") |

### Área do eletricista (`/api/eletricista/`, com sessão)
| Rota | O que faz |
|---|---|
| `GET procedimentos` | `{procedimentos}`: os publicados |
| `GET procedimentos/:id` | `{procedimento}` com `passos`; 404 se não está publicado |
| `POST trabalhos/:id/checklists` | `{procedimento_id}` → 201 com a ficha (`{trabalho}`); 409 num trabalho que não é de obra ou já concluído |
| `POST trabalhos/:id/checklists/:lista` | `{passo, feito}` → a ficha |

## 7. Ecrãs
- **Procedimentos** (`#/procedimentos`; todos os papéis): a lista (o CEO vê-a por estado, com os selos "Por rever" e "Alterações por publicar"); um procedimento (`#/procedimentos/<id>`) com os passos numerados e os selos "Segurança" e "Obrigatório"; para o CEO, "Editar" (`#/procedimentos/<id>/editar`), "Publicar", "Arquivar", "Repor como rascunho" e "Novo procedimento" (`#/procedimentos/novo`). No editor os passos **mudam de ordem com os botões "Subir" e "Descer"** (sem arrastar; o foco fica no passo movido) e marcar "Segurança" marca também "Obrigatório".
- **Obras**: o cartão da lista mostra "Checklists 7/9" e "N obrigatórios em falta"; a ficha tem o bloco "Procedimentos" (caixas com etiqueta, quem e quando por baixo de cada passo feito).
- **Tarefas**: o aviso dos obrigatórios em falta no cartão e na ficha da tarefa "Confirmar obra concluída".
