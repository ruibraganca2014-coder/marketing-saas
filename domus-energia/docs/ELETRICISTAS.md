# Eletricistas externos (fase 4)

Eletricistas habilitados que trabalham para a Domus Energia com as condições da Domus: o cliente continua a ser da Domus e o contacto com ele é sempre em nome da Domus. Esta página descreve as **rondas 1 e 2**: candidatura, aprovação no painel, atribuição e bolsa (com aviso por email), a área do eletricista com a ficha de obra (material, fotos antes e depois, ensaios, diagnóstico) até "Obra concluída", e apagar um eletricista (RGPD). A ronda 3 (confirmação e avaliação do cliente, aprovação do CEO, pagamento ao eletricista, fatura-recibo) está no fim.

Código: `painel/src/eletricistas.js` (rotas `/api/eletricista/*` e a lógica), `painel/src/api.js` (rotas do painel), `painel/src/db.js` (migrações 27, 28 e 29), `web/trabalhe-connosco.*`, `web/eletricista.*`, `painel/public/ecras/eletricistas.js` e `painel/public/ecras/atribuicao.js`. Testes: `painel/test/eletricistas.test.js` (ronda 1 e interruptor) e `painel/test/eletricistas-obra.test.js` (ronda 2).

## Interruptor: o módulo ainda não está publicado

Decisão do dono (2026-10-02): o módulo fica no código mas **desligado em produção** até ser publicado. O interruptor é a variável `ELETRICISTAS` do painel (`config.eletricistas`):

- **Só `ELETRICISTAS=1` liga.** Por omissão está desligado. Só o lançador local (`local/iniciar.js`) a põe; o `servidor/docker-compose.yml`, o `.env.example` e o `instalar.sh` não (há um teste que o verifica). `ELETRICISTAS=0 npm start` desliga-o também no local.
- **Desligado:** todas as rotas `/api/eletricista/*` (incluindo a do acesso rápido) e as do painel (`eletricistas*`, `orcamentos/:id/eletricista`) respondem `404 Endereço desconhecido.`, pelo mesmo caminho de qualquer endereço que não existe, com ou sem sessão. O temporizador das 48 h não arranca. As migrações 27 e 28 correm na mesma (tabelas vazias) e `eletricista_pct` continua fora do `/api/catalogo`.
- **Painel:** o `GET eu` e o `POST entrar` levam `eletricistas: true | false`; com `false` o ecrã "Eletricistas" não aparece no menu nem abre pelo endereço, e o bloco "Eletricista externo" não aparece nas fichas do pedido e da obra.
- **Site:** `trabalhe-connosco.html` e `eletricista.html` continuam no repositório. Ao abrir perguntam `GET /api/eletricista/candidatura` (`200 {aberta: true}` com o módulo ligado); com 404 mostram só "Candidaturas ainda não estão abertas." e "Área ainda não disponível.", sem formulário. As duas páginas têm `noindex`.

**Para publicar:** pôr `ELETRICISTAS=1` no `.env` do servidor (e passá-la ao painel no `docker-compose.yml`), repor a ligação "Trabalhe connosco" no rodapé de `web/index.html` e a entrada no `web/sitemap.xml` (há um comentário em cada sítio), e trocar o `noindex` de `trabalhe-connosco.html` por `index, follow` com o `canonical`.

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

Fechado o trabalho, o eletricista continua a vê-lo na lista como "Fechado", mas sem nome, morada, telefone, relatório, material ou fotos.

### Aviso da bolsa

Quando um trabalho entra na bolsa, cada eletricista **aprovado** com o concelho do trabalho recebe um email: "Novo trabalho em <concelho>", o tipo de trabalho e a ligação para a área. O email não leva nada do cliente, nem valores, nem o número do pedido. Sai **um email por trabalho e por eletricista** (tabela `trabalhos_eletricista_avisos`): se o trabalho voltar à bolsa (alguém o largou ou deixou caducar), só recebe o aviso quem ainda não o tinha recebido — por exemplo, um eletricista aprovado entretanto. Quem o largou não recebe (também já não o vê). Uma atribuição direta não gera aviso da bolsa (o eletricista escolhido recebe o email "Tem um trabalho novo").

### Ficha de obra (ronda 2)

Na área do eletricista, a ficha de um trabalho tem quatro separadores:

- **Cliente:** nome, morada e telefone, e a visita (contagem das 48 h, marcar, alterar).
- **Trabalho:** o relatório técnico sem preços (lista de trabalho, planta técnica, esquemas, esquema do quadro — os mesmos desenhos do relatório do cliente) e a **lista do material** com uma caixa por artigo, "levantado ou recebido" (`trabalhos_eletricista.material_recebido`, por trabalho; não mexe na lista de material da obra do painel).
- **Ensaios:** continuidade do PE, isolamento, terra e disparo do diferencial. Ficam em `orcamentos.ensaios` (migração 16), os mesmos que o painel regista e que o relatório completo do cliente mostra. Os limites são os da configuração: isolamento ≥ `ensaio_isolamento_mohm` (0,5 MΩ), diferencial ≤ `ensaio_diferencial_ms` (300 ms), terra ≤ `ensaio_terra_ohm` (100 Ω). Um valor **fora do limite não é recusado**, mas só se guarda com uma **nota** a explicar; fica assinalado na ficha e no painel. Nos trabalhos de avaria aparece também o **diagnóstico** (a lista de verificação de `diagnostico-conteudo.js`, o tipo de avaria e a conclusão; fica em `orcamentos.diagnostico`, com a mesma validação do painel).
- **Fotos:** quatro grupos — quadro antes, pontos antes, quadro depois, pontos depois — até 4 fotos por grupo. O telemóvel reduz a foto (como no simulador) e envia os bytes; o servidor aceita só JPEG ou PNG verdadeiros (pelos primeiros bytes), até 1 MB.

**"Obra concluída"** (nas visitas e avarias, "Trabalho concluído") só fica ligado quando não falta nada (`falta` na ficha):

| Tipo | Condições |
|---|---|
| `obra` | visita marcada, uma foto de antes, uma foto de depois, e os três ensaios (isolamento, diferencial, terra) |
| `avaria` | visita marcada, uma foto de antes e a conclusão do diagnóstico |
| `visita` | visita marcada e uma foto de antes |

Ao concluir, o trabalho passa a `concluida_eletricista` com a data (`concluida`), os CEO recebem um email e o cliente recebe outro, em nome da Domus Energia, a pedir que confirme na conta. A partir daí a ficha fica **só de leitura** (não se mexe em fotos, ensaios, material nem visita, e já não se pode largar) e mostra "A aguardar confirmação do cliente". O pedido e a obra do painel ficam como estavam: a confirmação e a avaliação do cliente, a aprovação do CEO e o pagamento são da ronda 3. O CEO continua a poder retirar o trabalho.

### No painel

- **Ficha do pedido e da obra**, bloco "Eletricista externo": o estado (incluindo "Concluída pelo eletricista — a aguardar confirmação do cliente"), o que ainda falta ao eletricista, o material recebido, os ensaios (os que estão fora do limite a vermelho, com a nota) e as fotos antes e depois.
- **Suspender** um eletricista com trabalhos em curso abre um aviso com a lista deles; o CEO pode retirar cada um (volta a ficar por atribuir) ou suspender mesmo assim.
- **Apagar (RGPD)** na ficha do eletricista, com confirmação (escrever o email): ver "Privacidade".

## Estados do trabalho

Tabela `trabalhos_eletricista` (migração 28), coluna `estado`:

```
                 Pôr na bolsa                 Aceitar (atómico)              Marcar visita
(por atribuir) ───────────────▶ na_bolsa ───────────────────────▶ aceite ───────────────────▶ visita_marcada
       │                           ▲                                │  ▲                          │ Obra concluída
       │        Atribuir a…        │      48 h sem visita, ou       │  │      Alterar data        ├──────────────▶ concluida_eletricista
       └───────────────────────────┼──────── Largar trabalho ◀──────┘  └──────────────────────────┘   (a aguardar o cliente: ronda 3)
          (entra logo em "aceite") │      (modo bolsa: volta à bolsa; atribuição direta: fica "retirado")
                                   └─── Largar trabalho (com a visita marcada) também volta
Retirar (CEO), em qualquer estado ──▶ retirado
```

- `modo`: `bolsa` (foi posto na bolsa) ou `direto` (o CEO atribuiu). Um trabalho da bolsa que é largado ou caduca **volta à bolsa**; um atribuído diretamente **volta ao CEO** (fica `retirado` e o pedido volta a poder ser atribuído).
- **Aceitar é atómico:** `UPDATE … WHERE id = ? AND estado = 'na_bolsa'`. O segundo a chegar não muda nenhuma linha e recebe `409 Outro eletricista aceitou este trabalho primeiro.`
- **48 horas:** contam de `aceite_em`. A verificação corre em cada leitura (bolsa, trabalhos, bloco do painel) e de 15 em 15 minutos no temporizador do módulo (`iniciar()`, como os outros módulos). Com a visita marcada o prazo deixa de contar.
- **Percentagem:** fica gravada no trabalho quando é aceite ou atribuído; mudar depois a percentagem do eletricista não mexe nos trabalhos que já tem.
- **Concluído pelo eletricista** (`concluida_eletricista`, migração 29): continua a ser o trabalho ativo do pedido (não se atribui a outro sem o retirar), não caduca e não se pode largar.
- **Quem largou:** `trabalhos_eletricista_eventos` guarda cada passo (`posto_na_bolsa`, `atribuido`, `aceite`, `visita_marcada`, `largou`, `expirou`, `retirado`, `concluida`) com o eletricista, a data e quem o fez. Quem largou um trabalho ou o deixou caducar não o volta a ver na bolsa. O painel mostra a contagem ("N largados") em cada eletricista.
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
- **Fotos da obra:** em `ELETRICISTAS_DIR/trabalhos/<trabalho>/<24 hex>.jpg|png`, fora da pasta pública. Só as veem o eletricista do trabalho (enquanto o trabalho está aberto) e o CEO (`GET /painel/api/trabalhos-eletricista/:id/fotos/:foto`), sempre com `nosniff` e `Content-Security-Policy: default-src 'none'; sandbox`. Saem com o pedido quando a conta do cliente é apagada (RGPD), como as fotos do pedido.
- **Retenção:** uma candidatura recusada é apagada, com o documento, 12 meses depois da decisão (`limpar()`). Uma candidatura por decidir fica até ser decidida. Um eletricista aprovado ou suspenso fica enquanto existir.
- **Apagar um eletricista (RGPD):** `POST /painel/api/eletricistas/:id/apagar` (só CEO; confirma-se com o email). Saem as sessões, os códigos, os avisos da bolsa, o documento do seguro e o histórico dele na auditoria. Sem trabalhos nenhuns, a linha é apagada. Com histórico de trabalhos (necessário para a contabilidade e para a regra "quem larga não recebe"), a linha fica **anonimizada**: nome "Eletricista apagado (RGPD)", sem email, telefone, NIF, habilitação, concelhos, experiência nem notas, e nunca mais entra. Com trabalhos em curso o pedido é recusado: o CEO retira-os primeiro. O email fica livre para uma candidatura nova.
- **Auditoria:** as ações do eletricista ficam como `eletricista:<id>` (sem o email); as do CEO com o utilizador do painel.

## Endpoints

### Públicos e área do eletricista — `/api/eletricista/*`

Os POST exigem a `Origin` do site (CSRF) e `Content-Type: application/json`.

| Rota | Sessão | O que faz |
|---|---|---|
| `GET candidatura` | — | `200 {aberta: true}`: as páginas perguntam se o módulo está ligado (desligado: 404). |
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
| `POST trabalhos/:id/material` | sim | `{recebido: ["nome do artigo", …]}`: a lista toda do que já foi levantado ou recebido. |
| `POST trabalhos/:id/ensaios` | sim | `{continuidade_pe, isolamento, terra, diferencial, notas}`; fora do limite sem `notas` → `400`. |
| `POST trabalhos/:id/diagnostico` | sim | `{diagnostico: {verificacoes, valores, tipo, conclusao} \| null}`; só nos trabalhos de avaria (`409` nos outros). |
| `POST trabalhos/:id/fotos/:grupo` | sim | o corpo são os bytes (`Content-Type: image/jpeg` ou `image/png`, até 1 MB); `grupo`: `quadro_antes`, `pontos_antes`, `quadro_depois`, `pontos_depois`; `409` com 4 no grupo. |
| `GET trabalhos/:id/fotos/:foto` | sim | a foto; `404` para quem não é o eletricista do trabalho. |
| `POST trabalhos/:id/fotos/:foto/apagar` | sim | apaga a foto. |
| `POST trabalhos/:id/concluir` | sim | "Obra concluída"; `409 Ainda falta: …` enquanto faltar alguma coisa. |

A ficha (`GET trabalhos/:id`) leva também `editavel`, `material[].recebido`, `fotos`, `grupos_fotos`, `fotos_max`, `ensaios` (com `limites` e `fora`), `diagnostico` (`{modelo, atual}`, só na avaria), `falta` e `concluida`. Depois de concluído, as rotas que alteram respondem `409`.

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
| `POST eletricistas/:id/apagar` | `{email}`: apagar (RGPD) → `{modo: "apagado" \| "anonimizado", …}` |
| `GET trabalhos-eletricista/:id/fotos/:foto` | uma foto da obra (`:id` é o trabalho) |

`GET orcamentos/:id/eletricista` → `trabalho` leva também `concluida`, `material`, `fotos`, `ensaios`, `diagnostico` (avaria) e `falta`. `GET eletricistas` → cada eletricista leva `trabalhos` (os que tem em curso) e `anonimizado`.
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

## Rondas seguintes

- **Ronda 3:** confirmação e avaliação do cliente na conta (1 a 5 estrelas, comentário; "Não" devolve a obra ao eletricista), aprovação pelo CEO ("Devolver ao eletricista" ou aprovar), pagamento até 7 dias contra fatura-recibo carregada na área do eletricista, média por eletricista no painel, e a regra "quem larga não recebe".

Na área do eletricista o separador "Pagamentos" aparece desligado, com "em breve". O email ao cliente de "trabalho concluído" já pede a confirmação na conta, mas o botão de confirmar só chega com a ronda 3 (o módulo está desligado em produção até lá).
