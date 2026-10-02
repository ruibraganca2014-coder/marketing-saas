# Eletricistas externos (fase 4)

Eletricistas habilitados que trabalham para a Domus Energia com as condições da Domus: o cliente continua a ser da Domus e o contacto com ele é sempre em nome da Domus. Esta página descreve a **ronda 1**: candidatura, aprovação no painel, atribuição e bolsa, e a área do eletricista até "Marcar visita". As rondas 2 e 3 (fotos, ensaios, obra concluída, confirmação e avaliação do cliente, pagamento ao eletricista, fatura-recibo) estão no fim.

Código: `painel/src/eletricistas.js` (rotas `/api/eletricista/*` e a lógica), `painel/src/api.js` (rotas do painel), `painel/src/db.js` (migrações 27 e 28), `web/trabalhe-connosco.*`, `web/eletricista.*`, `painel/public/ecras/eletricistas.js` e `painel/public/ecras/atribuicao.js`. Testes: `painel/test/eletricistas.test.js`.

## Decisões do dono

1. **Atribuição:** o CEO atribui o pedido a um eletricista ou põe-no na **bolsa**. Na bolsa só veem o trabalho os eletricistas aprovados que declararam o concelho do pedido; o primeiro a aceitar fica com ele.
2. **48 horas** depois de aceitar (ou de ser atribuído) para marcar a visita com o cliente; sem visita marcada, o trabalho volta sozinho.
3. **Pagamento:** 70 % da mão de obra **sem IVA** + a deslocação paga pelo cliente. A percentagem é configurável (painel → Eletricistas, "por omissão") e por eletricista. O material é da Domus.
4. **Visita técnica e diagnóstico de avaria** seguem a mesma regra: percentagem × a meia hora de mão de obra sem IVA + deslocação. Na avaria, a taxa de diagnóstico (25 €) fica na Domus.
5. **Quem larga um trabalho** (ou o deixa caducar) **nunca recebe** por ele, mesmo que já tenha feito a visita. A ronda 1 só regista quem largou; o pagamento é da ronda 3.
6. **Dados do cliente:** antes de aceitar, só o concelho, o tipo de trabalho, as horas e os dias estimados e o relatório técnico sem preços. Depois de atribuído, o nome, a morada e o telefone, enquanto o trabalho está aberto.

## Fluxo

1. **Candidatura** em `trabalhe-connosco.html`: nome, email, telemóvel, NIF, n.º de habilitação na DGEG, concelhos onde trabalha, experiência (opcional), o documento do seguro de responsabilidade civil (PDF, JPG ou PNG, até 5 MB) e a caixa de consentimento com a ligação para a Política de Privacidade. O candidato recebe um email de confirmação e os CEO do painel recebem um aviso (sem os dados do candidato).
2. **Painel → Eletricistas** (só CEO): candidaturas por decidir, com a ficha e o documento; **Aprovar** (envia o email com a ligação para `eletricista.html`) ou **Recusar**; depois **Suspender** e **Reativar**; os concelhos e a percentagem editam-se a qualquer altura. A coluna "Média" (avaliação dos clientes) fica "—" até à ronda 3.
3. **Atribuição** na ficha do pedido (Orçamentos) ou da obra (Obras), bloco "Eletricista externo", só para o CEO: "Atribuir a…" (um eletricista aprovado com o concelho do pedido), "Pôr na bolsa" ou "Retirar" (em qualquer altura).
4. **Área do eletricista** (`eletricista.html`, pensada para o telemóvel): entra com o email e um código de 6 algarismos. **Bolsa** → ficha do trabalho sem dados do cliente → **Aceitar trabalho**. **Trabalhos** → ficha com o cliente, o relatório técnico e o material → **Marcar visita** (o cliente recebe um email da Domus Energia) ou **Largar trabalho**.

### O que se pode atribuir

Um trabalho por pedido e por tipo:

| Tipo | Quando | Fecha quando |
|---|---|---|
| `obra` | pedido "aceite" com a obra criada (nasce com o sinal pago) e ainda por fazer | a obra fica concluída ou cancelada, ou o pedido deixa de estar aceite |
| `visita` | pedido "novo", "contactado" ou "visita marcada" com a visita técnica **paga** | a proposta é enviada, o pedido fica perdido, ou o cliente falta |
| `avaria` | o mesmo, num pedido de avaria com o diagnóstico **pago** | o mesmo |

O concelho é o da localidade do pedido. Se a localidade não for um dos 308 concelhos, o painel pede para a corrigir antes de atribuir. Com os pagamentos online desligados não há visita nem diagnóstico pagos, por isso só se atribuem obras.

Fechado o trabalho, o eletricista continua a vê-lo na lista como "Fechado", mas sem nome, morada, telefone, relatório ou material.

## Estados do trabalho

Tabela `trabalhos_eletricista` (migração 28), coluna `estado`:

```
                 Pôr na bolsa                 Aceitar (atómico)              Marcar visita
(por atribuir) ───────────────▶ na_bolsa ───────────────────────▶ aceite ───────────────────▶ visita_marcada
       │                           ▲                                │  ▲                          │
       │        Atribuir a…        │      48 h sem visita, ou       │  │      Alterar data        │
       └───────────────────────────┼──────── Largar trabalho ◀──────┘  └──────────────────────────┘
          (entra logo em "aceite") │      (modo bolsa: volta à bolsa; atribuição direta: fica "retirado")
                                   └─── Largar trabalho (com a visita marcada) também volta
Retirar (CEO), em qualquer estado ──▶ retirado
```

- `modo`: `bolsa` (foi posto na bolsa) ou `direto` (o CEO atribuiu). Um trabalho da bolsa que é largado ou caduca **volta à bolsa**; um atribuído diretamente **volta ao CEO** (fica `retirado` e o pedido volta a poder ser atribuído).
- **Aceitar é atómico:** `UPDATE … WHERE id = ? AND estado = 'na_bolsa'`. O segundo a chegar não muda nenhuma linha e recebe `409 Outro eletricista aceitou este trabalho primeiro.`
- **48 horas:** contam de `aceite_em`. A verificação corre em cada leitura (bolsa, trabalhos, bloco do painel) e de 15 em 15 minutos no temporizador do módulo (`iniciar()`, como os outros módulos). Com a visita marcada o prazo deixa de contar.
- **Percentagem:** fica gravada no trabalho quando é aceite ou atribuído; mudar depois a percentagem do eletricista não mexe nos trabalhos que já tem.
- **Quem largou:** `trabalhos_eletricista_eventos` guarda cada passo (`posto_na_bolsa`, `atribuido`, `aceite`, `visita_marcada`, `largou`, `expirou`, `retirado`) com o eletricista, a data e quem o fez. Quem largou um trabalho ou o deixou caducar não o volta a ver na bolsa. O painel mostra a contagem ("N largados") em cada eletricista.
- **Marcar visita:** na `visita` e na `avaria` a data fica em `orcamentos.data_visita` (o pedido passa a "visita marcada" e o cliente vê-a na conta); na `obra` fica em `obras.data` e `obras.hora` e a obra deixa de estar "por agendar". Se o eletricista largar o trabalho depois de marcar, a data sai, o cliente recebe um email a dizer que a visita vai ter nova data e os CEO são avisados.

## O que o eletricista recebe (estimativa)

Sempre calculado no servidor, em euros **sem IVA**: `percentagem × mão de obra + deslocação`.

| Tipo | Mão de obra | Deslocação |
|---|---|---|
| `obra` | a parte "mão de obra" da proposta em três partes | a parte "deslocação" da proposta |
| `visita` | 0,5 h × `tarifa_hora_iva`, sem IVA | a deslocação até à localidade (1 dia), sem IVA |
| `avaria` | as horas do artigo `DIAG-AVARIA` (0,5 h) × `tarifa_hora_iva`, sem IVA | o mesmo |

Exemplos: obra com 1 240 € de mão de obra e 35 € de deslocação a 70 % → 868 € + 35 € = **903 €**. Avaria em Sintra (tarifa 38 €/h, deslocação 7,20 € com IVA): 70 % × 15,45 € + 5,85 € = **16,67 €**; os 25 € do diagnóstico ficam na Domus.

Numa obra cuja proposta não tem as três partes, usa-se o que a simulação sugere e a resposta leva `provisoria: true`; sem simulação, não há estimativa ("a combinar").

## Privacidade

- **Antes de aceitar** (`GET /api/eletricista/bolsa` e `bolsa/:id`) a resposta é montada campo a campo em `paraBolsa()`: `id` do trabalho (não o do pedido), `concelho`, `tipo`, `titulo` (feito de dados estruturados, ex.: "Obra — Apartamento T2"; nunca o texto livre do pedido), `horas`, `dias`, `recebe` e, na ficha, `relatorio` — lista de trabalho por divisão, material (só artigo e quantidade), planta técnica, esquemas e esquema do quadro. Sem preços, totais, valor da proposta, nome, contactos, morada, mensagem ou notas. Um teste procura esses dados e qualquer chave de preço nas duas respostas.
- **Depois de atribuído** (`GET /api/eletricista/trabalhos/:id`): `cliente` com o nome, a morada, a localidade e o telefone — nunca o email — só enquanto o trabalho está aberto; mais o relatório com a lista de ensaios e o diagnóstico registados no painel, e a lista de material.
- **O relatório técnico leva os nomes das divisões e a descrição da avaria escritos pelo cliente**, porque são necessários para decidir aceitar o trabalho.
- **Emails ao cliente** saem em nome da Domus Energia, sem o nome do eletricista.
- **Documento do seguro:** guardado em `ELETRICISTAS_DIR` (por omissão `DADOS/painel/eletricistas/<id>/<24 hex>.pdf|jpg|png`), fora da pasta pública. Só o CEO o vê, por `GET /painel/api/eletricistas/:id/seguro`, com `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e, no PDF, `Content-Disposition: attachment`.
- **Retenção:** uma candidatura recusada é apagada, com o documento, 12 meses depois da decisão (`limpar()`). Uma candidatura por decidir fica até ser decidida. Um eletricista aprovado ou suspenso fica enquanto existir.
- **Auditoria:** as ações do eletricista ficam como `eletricista:<id>` (sem o email); as do CEO com o utilizador do painel.

## Endpoints

### Públicos e área do eletricista — `/api/eletricista/*`

Os POST exigem a `Origin` do site (CSRF) e `Content-Type: application/json`.

| Rota | Sessão | O que faz |
|---|---|---|
| `POST candidatura` | — | `{nome, email, telefone, nif, dgeg, concelhos[], experiencia?, notas?, seguro: {tipo, dados (base64)}, consentimento: true, website}` → `201 {ok, mensagem}`. 5 por hora por IP, 100 por hora no total. `website` é o campo-armadilha. Email repetido: a mesma resposta, nada muda. |
| `POST codigo` | — | `{email}` → sempre `200` com a mesma mensagem; o código só sai para um eletricista aprovado (3 por hora por email, 10 por hora por IP). |
| `POST entrar` | — | `{email, codigo}` → `200 {eletricista}` + cookie; `400` se o código está errado, expirou (15 min) ou gastou as 5 tentativas, ou se não está aprovado. |
| `POST sair` | — | fecha a sessão. |
| `GET eu` | sim | `{eletricista: {nome, email, concelhos, percentagem}, sessao_expira, prazo_visita_horas}` |
| `GET bolsa` | sim | `{concelhos, trabalhos: [{id, concelho, tipo, titulo, horas, dias, recebe}]}` |
| `GET bolsa/:id` | sim | o mesmo com `relatorio`; `404` fora dos concelhos dele; `409` se outro já aceitou. |
| `POST bolsa/:id/aceitar` | sim | `200 {trabalho}` ou `409`. |
| `GET trabalhos` | sim | os trabalhos dele em curso (sem os dados do cliente). |
| `GET trabalhos/:id` | sim | a ficha: `cliente`, `relatorio`, `material`, `prazo`, `visita`, `recebe`; `404` se não é dele. |
| `POST trabalhos/:id/visita` | sim | `{data_visita: "AAAA-MM-DDTHH:MM"}` (hora de Lisboa, no futuro). |
| `POST trabalhos/:id/largar` | sim | devolve o trabalho; fica registado. |

`recebe`: `{percentagem, mao_obra, parte_mao_obra, deslocacao, total, provisoria}` ou `null`.

### Painel — `/painel/api/*` (só CEO)

| Rota | O que faz |
|---|---|
| `GET eletricistas` | `{eletricistas: [...], percentagem_omissao}` |
| `GET eletricistas/:id` | a ficha |
| `POST eletricistas/:id` | `{acao?: aprovar \| recusar \| suspender \| reativar, concelhos?, percentagem?}` (`percentagem: null` = a por omissão) |
| `GET eletricistas/:id/seguro` | o documento do seguro |
| `GET orcamentos/:id/eletricista` | `{pode, tipo, concelho, motivo, trabalho, candidatos, historico}` |
| `POST orcamentos/:id/eletricista` | `{acao: atribuir \| bolsa \| retirar, eletricista_id?}` |
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
- **`robots.txt`:** `eletricista.html` não é indexada; `trabalhe-connosco.html` está no `sitemap.xml`.

## Acesso rápido (só no lançador local)

O botão "Eletricista de teste" (`POST /api/eletricista/dev/entrar {n: 1}`) cria um eletricista de teste já aprovado, com dados fictícios e sem documento, e abre a sessão. Tem as mesmas proteções dos outros botões (docs/SEGURANCA.md "Acesso rápido"): no servidor a rota não existe.

## Rondas seguintes

- **Ronda 2:** fotos antes e depois, ensaios medidos e diagnóstico preenchidos pelo eletricista, "Obra concluída", ajuda técnica, levantamento do material.
- **Ronda 3:** confirmação e avaliação do cliente na conta (1 a 5 estrelas, comentário), aprovação pelo CEO, pagamento até 7 dias contra fatura-recibo carregada na área do eletricista, média por eletricista no painel, e a regra "quem larga não recebe".

Na área do eletricista estas partes aparecem desligadas, com "em breve".
