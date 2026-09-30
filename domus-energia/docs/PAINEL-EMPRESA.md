# Painel da empresa — contrato (v1)

Painel web interno da Domus Energia em `https://HOST/painel/`, para a equipa. Decisões do dono: 4 áreas (clientes e planos, alertas técnicos, pedidos de orçamento, obras e equipa), **acesso por papéis**, pedidos de orçamento guardados **no nosso servidor**.

## 1. Papéis
| Papel | Vê | Faz |
|---|---|---|
| `ceo` | tudo, incluindo receitas e pagamentos | tudo, incluindo gerir utilizadores do painel |
| `tecnico` | as suas obras, alertas técnicos de todas as casas, lista de clientes (sem dados financeiros) | atualizar as suas obras (estado, horas reais, material, notas) |
| `comercial` | pedidos de orçamento, clientes (plano e estado, sem receitas totais), agenda de obras (só leitura) | gerir pedidos de orçamento, marcar visitas, pedir criação de cliente |

Toda a autorização é verificada **no servidor** em cada pedido (o ecrã só esconde o que não se pode usar).

## 2. Serviço `painel/` (Node 22, sem dependências nativas)
- Base de dados **SQLite** com `node:sqlite` (ficheiro `servidor/dados/painel/painel.db`; o contentor monta só `dados/painel`, `dados/planos` (só leitura), `dados/pagamentos` (só leitura), `dados/clientes` (só leitura) e `dados/pedidos-admin` (escrita)).
- Serve os ficheiros do painel em `/painel/` e a API em `/painel/api/`; o endpoint público do formulário em `/api/orcamento` (o Caddy encaminha este caminho para o painel **antes** da regra `/api/*` dos pagamentos).
- Liga-se ao MQTT como utilizador `painel`: **só leitura** de `domus/#` (ACL), para os alertas técnicos (`_aparelhos`, `_saude`, `_alarme`, `_modo`, `_eventos`, `_plano`, `connected`/`online`).

### Autenticação
- Utilizadores do painel na SQLite (`nome`, `email`, `papel`, `hash` scrypt com sal, `ativo`). O primeiro CEO é criado no VPS com `./domus.sh painel-utilizador <email> ceo` (pede a palavra-passe; escreve um pedido que o painel aplica) — ou variável `PAINEL_CEO_EMAIL` + `PAINEL_CEO_PASS` só no primeiro arranque.
- `POST /painel/api/entrar {email, password}` → cookie de sessão `domus_painel` (aleatório 32 bytes, **HttpOnly, Secure, SameSite=Strict, Path=/painel**), sessão 12 h com renovação, guardada na SQLite; `POST /painel/api/sair`.
- Limite: 5 tentativas/min por IP e por email; bloqueio de 15 min após 10 falhas seguidas.
- Pedidos que alteram dados exigem cabeçalho `Origin`/`Sec-Fetch-Site` do próprio site (proteção CSRF) e `Content-Type: application/json`.
- Registo de auditoria (quem, o quê, quando) para todas as alterações; visível ao CEO.

### Alterações ao servidor (clientes, aparelhos, planos)
O painel **não** tem as palavras-passe do servidor. Para criar clientes, adicionar aparelhos ou mudar planos à mão, escreve um pedido em `dados/pedidos-admin/<id>.json` (`{id, tipo, dados, por, criado}`); o temporizador do VPS (o mesmo do `sincronizar-planos`) corre `./domus.sh processar-pedidos`, que executa o comando equivalente do `domus.sh`, escreve o resultado em `dados/pedidos-admin/<id>.resultado.json` (incluindo a palavra-passe gerada para um cliente novo, que o painel mostra **uma vez** ao CEO/comercial e depois apaga) e move o pedido para `feitos/`. Tipos: `cliente`, `aparelho`, `remover-aparelho`, `plano`, `painel-utilizador`.

## 3. API (`/painel/api/`, JSON, erros `{"erro": "pt-PT"}`)
| Método e caminho | Papéis | O quê |
|---|---|---|
| `GET eu` | todos | utilizador atual e papel |
| `POST eu/senha` | todos | mudar a própria palavra-passe (pede a atual; termina as outras sessões) |
| `GET resumo` | todos (conteúdo por papel) | CEO: clientes por plano/estado, receita recorrente mensal (soma dos planos ativos s/ IVA), recebido este mês (CSV), pedidos novos, obras da semana, alertas críticos; técnico: as suas obras de hoje/semana + alertas; comercial: pedidos por estado + visitas da semana |
| `GET clientes` / `GET clientes/:c` | todos (financeiro só CEO) | lista e ficha: plano, estado, próximo pagamento, n.º aparelhos, alertas, obras, pedido de orçamento de origem |
| `POST clientes` | ceo, comercial | pede criação (`{codigo, nome, contacto, localidade}`) → pedido-admin |
| `POST clientes/:c/aparelhos` | ceo, tecnico | pede aparelho (mesmas opções do `domus.sh aparelho`) |
| `POST clientes/:c/plano` | ceo | pede plano manual |
| `GET alertas` | ceo, tecnico | lista viva de todas as casas: alarme disparado, aparelho offline, bateria fraca/`bateria_dias` < 21, sinal < −80, reinícios > 5/24 h, sem notícias; ordenada por gravidade; `?cliente=` |
| `GET orcamentos` / `POST orcamentos/:id` | ceo, comercial | lista e atualização: estado `novo`/`contactado`/`visita_marcada`/`proposta_enviada`/`aceite`/`perdido`, notas, data da visita, valor da proposta, motivo de perda. A lista traz `urgencia` (`normal`/`semana`/`urgente`, da simulação; `null` sem ela): selo "Urgente" (ou "Esta semana") no quadro de pedidos e na ficha; a ficha e o Relatório técnico mostram a urgência e a disponibilidade para a visita (simulador, lote 8: docs/SIMULADOR-ORCAMENTO.md §0 e §6) |
| `POST orcamentos/:id/converter` | ceo, comercial | cria pedido de cliente + obra a partir do orçamento aceite (no modo de pagamentos simulado, com o plano escolhido pelo cliente, também o pedido-admin `plano`) |
| `POST orcamentos/:id/libertar-relatorio` | ceo | liberta ao cliente o relatório técnico revisto (a conta deixa de mostrar "em revisão"; email ao cliente) |
| `POST orcamentos/:id/obra-concluida` | ceo, comercial | obra concluída (só pedidos `aceite`): o cliente passa a ver "Pagar o restante" na conta |
| `GET orcamentos/:id/fotos/:foto` / `POST orcamentos/:id/fotos/:foto/apagar` | ceo, comercial | fotos do cliente (simulador): ver e apagar (retenção automática: 12 meses sem seguimento; `painel/README.md`) |
| `GET obras` / `POST obras` / `POST obras/:id` | ceo (tudo), comercial (ler), tecnico (as suas) | obra: cliente, data, técnico(s), kit, estado `agendada`/`em_curso`/`concluida`/`cancelada`, material (lista), horas estimadas (do kit: 3/7/10) e reais, notas |
| `GET pagamentos` | ceo | linhas do CSV, totais por mês, exportar CSV |
| `GET utilizadores` / `POST utilizadores` / `POST utilizadores/:id` | ceo | gerir contas do painel (criar, papel, desativar, repor palavra-passe) |
| `GET auditoria` | ceo | últimas 500 ações |
| `GET contas` / `POST contas/:id` / `POST contas/:id/apagar` | ceo | contas de cliente (docs/CONTA-CLIENTE.md): ver, desativar/reativar, apagar com os dados pessoais (RGPD) |

### Endpoint público do formulário
`POST /api/orcamento` `{nome, telefone?, email?, localidade?, morada?, servico, mensagem?, website?, simulacao?}` → 201 `{ok:true}`. **Com `simulacao` (simulador) exige a sessão da conta de cliente com o email confirmado** (docs/CONTA-CLIENTE.md); o formulário simples do site (sem simulação) não. No pedido o painel mostra a conta (email, confirmado sim/não), o texto da proposta que o cliente vê (`proposta_texto`, com o valor, no estado "proposta enviada") e a aceitação online ("Proposta aceite pelo cliente (online)", data/hora/IP na auditoria; lista no Início). Validação (nome 1–120, pelo menos telefone ou email, textos com limites), `website` é campo-armadilha (se preenchido → 201 mas descartado), limite 5 pedidos/hora por IP. Fica na SQLite com estado `novo`; o painel mostra um alerta de pedido novo. **Com simulação há pagamentos** ([PAGAMENTOS-PEDIDO.md](PAGAMENTOS-PEDIDO.md)):
- o pedido entra logo (como `novo`; enviar é grátis); a avaria rápida só depois de paga (diagnóstico + deslocação);
- a ficha mostra os pagamentos do pedido (relatório pormenorizado, visita, avaria, sinal, restante) com o estado e "Simulado" no modo de teste, e "Marcar visita" (dia e hora) com a disponibilidade do cliente;
- o CEO tem "Libertar relatório ao cliente";
- a aceitação online só conta como "Aceite" depois do sinal pago (antes aparece "Aceite — a aguardar sinal");
- "Marcar obra concluída" abre o pagamento do restante na conta.

## 4. Ecrãs (`painel/public/`, tema Terra, pt-PT, telemóvel e computador)
Início (resumo por papel) · Clientes (lista com filtros por plano/estado, ficha) · Alertas (lista viva, atualiza sozinha) · Orçamentos (quadro por estado ou lista, ficha com histórico) · Obras (agenda semanal + lista, ficha com checklist de material e horas) · Pagamentos (CEO) · Equipa (CEO: utilizadores e papéis) · Contas de clientes (CEO: contas do simulador, desativar, apagar — RGPD) · Auditoria (CEO). Mesmas regras do site: sem HTML com dados de clientes (só `textContent`), alvos de 44 px, contraste AA, modo escuro, sem scripts inline (CSP).
