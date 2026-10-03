# Eletricistas externos (fase 4)

Eletricistas habilitados que trabalham para a Domus Energia com as condições da Domus: o cliente continua a ser da Domus e o contacto com ele é sempre em nome da Domus. Esta página descreve as **rondas 1 a 3**: candidatura, aprovação no painel, atribuição e bolsa (com aviso por email), a área do eletricista com a ficha de obra (material, fotos antes e depois, ensaios, diagnóstico) até "Obra concluída", a confirmação e a avaliação do cliente, a aprovação do CEO, o pagamento ao eletricista (fatura-recibo, IBAN, "Pago") e apagar um eletricista (RGPD).

Código: `painel/src/eletricistas.js` (rotas `/api/eletricista/*` e a lógica), `painel/src/api.js` (rotas do painel), `painel/src/db.js` (migrações 27 a 31), `painel/src/conta.js` (confirmação do cliente), `painel/src/pagamentos-pedido.js` (visita sem defeito), `web/trabalhe-connosco.*`, `web/eletricista.*`, `web/conta.js`, `painel/public/ecras/eletricistas.js`, `painel/public/ecras/atribuicao.js` e `painel/public/ecras/pagamentos.js`. Testes: `painel/test/eletricistas.test.js` (ronda 1 e interruptor), `painel/test/eletricistas-obra.test.js` (ronda 2) e `painel/test/eletricistas-pagamentos.test.js` (ronda 3).

## Interruptor: o módulo ainda não está publicado

Decisão do dono (2026-10-02): o módulo fica no código mas **desligado em produção** até ser publicado. O interruptor é a variável `ELETRICISTAS` do painel (`config.eletricistas`):

- **Só `ELETRICISTAS=1` liga.** Por omissão está desligado. Só o lançador local (`local/iniciar.js`) a põe; o `servidor/docker-compose.yml`, o `.env.example` e o `instalar.sh` não (há um teste que o verifica). `ELETRICISTAS=0 npm start` desliga-o também no local.
- **Desligado:** todas as rotas `/api/eletricista/*` (incluindo a do acesso rápido), as do painel (`eletricistas*`, `orcamentos/:id/eletricista`, `trabalhos-eletricista/*`, `pagamentos-eletricistas`) e a da conta `POST /api/conta/pedidos/:id/confirmar-trabalho` respondem `404 Endereço desconhecido.`, pelo mesmo caminho de qualquer endereço que não existe, com ou sem sessão. O temporizador das 48 h não arranca. A fase `visita_sem_defeito` do `POST /api/conta/pedidos/:id/pagar` não é aceite (400), a conta não leva `confirmacao` nem `visita_sem_defeito`, e o resumo dos pagamentos leva `eletricistas: null` (o CSV fica sem as linhas dos eletricistas). As migrações 27 a 30 correm na mesma (tabelas vazias) e `eletricista_pct` continua fora do `/api/catalogo`.
- **Painel:** o `GET eu` e o `POST entrar` levam `eletricistas: true | false`; com `false` o ecrã "Eletricistas" não aparece no menu nem abre pelo endereço, e o bloco "Eletricista externo" não aparece nas fichas do pedido e da obra.
- **Site:** `trabalhe-connosco.html` e `eletricista.html` continuam no repositório. Ao abrir perguntam `GET /api/eletricista/candidatura` (`200 {aberta: true, percentagem}` com o módulo ligado: "Trabalhe connosco" mostra a percentagem da configuração; sem resposta fica o 70 escrito na página); com 404 mostram só "Candidaturas ainda não estão abertas." e "Área ainda não disponível.", sem formulário. As duas páginas têm `noindex`.

**Para publicar** (só quando o dono disser):

1. Pôr `ELETRICISTAS=1` no `.env` do servidor e passá-la ao painel no `docker-compose.yml`.
2. Repor a ligação "Trabalhe connosco" no rodapé das páginas do site (o comentário em `web/index.html` diz onde) e a entrada `trabalhe-connosco.html` no `web/sitemap.xml` (há um comentário no sítio).
3. Trocar o `noindex` de `trabalhe-connosco.html` por `index, follow` com o `canonical`.
4. Pôr em `web/termos.html`, na lista "Pagamentos e reembolsos", logo antes do item "Sinal:", esta cláusula (decisão do dono: fica de fora até à publicação), e atualizar a data no topo:

   ```html
   <li><strong>Fim do trabalho:</strong> quando o técnico dá o trabalho (a obra, a visita técnica ou o diagnóstico) por concluído, pedimos-lhe que o confirme na sua conta e o avalie de 1 a 5 estrelas. Se nos disser que falta alguma coisa, voltamos para ver: havendo defeito, corrigimos sem custo; se não encontrarmos defeito, essa visita é paga, ao preço da visita técnica do seu concelho, e não é descontada na obra. Sem resposta em 7 dias, o trabalho considera-se aceite. Nada disto afeta a garantia legal.</li>
   ```
5. `web/privacidade.html` já descreve o módulo (eletricistas, IBAN e fatura-recibo, avaliação do cliente): rever a data no topo.

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

1. **Candidatura** em `trabalhe-connosco.html`: nome, email, telemóvel, NIF, n.º de habilitação na DGEG, concelhos onde trabalha, experiência (opcional), o documento do seguro de responsabilidade civil (PDF, JPG ou PNG, até 5 MB) e a caixa de consentimento com a ligação para a Política de Privacidade. O candidato recebe um email de confirmação e os CEO do painel recebem um aviso (sem os dados do candidato).
2. **Painel → Eletricistas** (só CEO): candidaturas por decidir, com a ficha e o documento; **Aprovar** (envia o email com a ligação para `eletricista.html`) ou **Recusar**; depois **Suspender** e **Reativar**; os concelhos e a percentagem editam-se a qualquer altura. Cada eletricista mostra a **média das avaliações** e quantas são ("Média 4,3 ★ (3)"); na ficha, os comentários dos clientes (os que podem ir para o site vão marcados "Pode ir para o site": publicar é à mão) e o IBAN mascarado.
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

Quando um trabalho entra na bolsa, cada eletricista **aprovado** com o concelho do trabalho recebe um email: "Novo trabalho em <concelho>", o tipo de trabalho e a ligação para a área. O email não leva nada do cliente, nem valores, nem o número do pedido. Sai **um email "novo trabalho" por trabalho e por eletricista** (tabela `trabalhos_eletricista_avisos`). Quando o trabalho **volta à bolsa** (alguém o largou ou deixou caducar), quem já tinha recebido o aviso recebe "Um trabalho voltou à bolsa em <concelho>" e quem ainda não o tinha recebido (ex.: aprovado entretanto) recebe o "novo trabalho". **Quem o largou ou o deixou caducar nunca mais é avisado** desse trabalho (também já não o vê). Uma atribuição direta não gera aviso da bolsa (o eletricista escolhido recebe o email "Tem um trabalho novo").

### Ficha de obra (ronda 2)

Na área do eletricista, a ficha de um trabalho tem quatro separadores:

- **Cliente:** nome, morada e telefone, e a visita (contagem das 48 h, marcar, alterar).
- **Trabalho:** o relatório técnico sem preços (lista de trabalho, planta técnica, esquemas, esquema do quadro — os mesmos desenhos do relatório do cliente) e a **lista do material** com uma caixa por artigo, "levantado ou recebido" (`trabalhos_eletricista.material_recebido`, por trabalho; não mexe na lista de material da obra do painel).
- **Ensaios:** continuidade do PE, isolamento, terra e disparo do diferencial. Ficam em `orcamentos.ensaios` (migração 16), os mesmos que o painel regista e que o relatório completo do cliente mostra. Os limites são os da configuração: isolamento ≥ `ensaio_isolamento_mohm` (0,5 MΩ), diferencial ≤ `ensaio_diferencial_ms` (300 ms), terra ≤ `ensaio_terra_ohm` (100 Ω). Um valor **fora do limite não é recusado**, mas só se guarda com uma **nota** a explicar; fica assinalado na ficha e no painel. Nos trabalhos de avaria aparece também o **diagnóstico** (a lista de verificação de `diagnostico-conteudo.js`, o tipo de avaria e a conclusão; fica em `orcamentos.diagnostico`, com a mesma validação do painel).
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

- **Ficha do pedido e da obra**, bloco "Eletricista externo": o estado (incluindo "Concluída pelo eletricista — a aguardar confirmação do cliente" e "Confirmado — falta aprovar"), até quando o cliente pode responder, a confirmação com as estrelas e o comentário, a reclamação e os botões de decisão, "Aprovar trabalho" e "Devolver ao eletricista", o que ainda falta ao eletricista, o material recebido, os ensaios (os que estão fora do limite a vermelho, com a nota) e as fotos antes e depois. Depois de aprovado: o valor fixado, o estado do pagamento e a fatura-recibo.
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
| `POST candidatura` | — | `{nome, email, telefone, nif, dgeg, concelhos[], experiencia?, notas?, seguro: {tipo, dados (base64)}, consentimento: true, website}` → `201 {ok, mensagem}`. 5 por hora por IP, 100 por hora no total. `website` é o campo-armadilha. Email repetido: a mesma resposta, nada muda. |
| `POST codigo` | — | `{email}` → sempre `200` com a mesma mensagem; o código só sai para um eletricista aprovado (3 por hora por email, 10 por hora por IP). |
| `POST entrar` | — | `{email, codigo}` → `200 {eletricista}` + cookie; `400` se o código está errado, expirou (15 min) ou gastou as 5 tentativas, ou se não está aprovado. |
| `POST sair` | — | fecha a sessão. |
| `GET eu` | sim | `{eletricista: {nome, email, concelhos, percentagem, iban (mascarado)}, sessao_expira, prazo_visita_horas}` |
| `GET bolsa` | sim | `{concelhos, trabalhos: [{id, concelho, tipo, titulo, horas, dias, recebe}]}` |
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

A ficha (`GET trabalhos/:id`) leva também `editavel`, `material[].recebido`, `fotos`, `grupos_fotos`, `fotos_max`, `ensaios` (com `limites` e `fora`), `diagnostico` (`{modelo, atual}`, só na avaria), `falta`, `concluida` e `reclamacao` (`{texto, de, quando, decisao}` quando o trabalho voltou). Depois de concluído, as rotas que alteram respondem `409`.

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
| `POST eletricistas/:id` | `{acao?: aprovar \| recusar \| suspender \| reativar, concelhos?, percentagem?}` (`percentagem: null` = a por omissão) |
| `GET eletricistas/:id/seguro` | o documento do seguro |
| `GET orcamentos/:id/eletricista` | `{pode, tipo, concelho, motivo, trabalho, candidatos, historico}` |
| `POST orcamentos/:id/eletricista` | `{acao: atribuir \| bolsa \| retirar \| aprovar \| devolver \| defeito \| sem_defeito, eletricista_id?, motivo?}` (`motivo` obrigatório em `devolver`) |
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

## Rondas seguintes

Publicar o módulo (ver "Para publicar"), quando o dono decidir.
