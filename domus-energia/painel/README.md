# Painel da empresa Domus Energia

Serviço Node.js 22 (ESM) do painel interno da equipa em `https://HOST/painel/` e do endpoint público dos pedidos de orçamento. Contrato: [`../docs/PAINEL-EMPRESA.md`](../docs/PAINEL-EMPRESA.md) (§1–§3); simulador e catálogo: [`../docs/SIMULADOR-ORCAMENTO.md`](../docs/SIMULADOR-ORCAMENTO.md). Instalação no VPS: [`../servidor/README.md`](../servidor/README.md), secção **"Painel da empresa"**.

- **Sem dependências nativas.** Base de dados SQLite com o módulo do próprio Node, `node:sqlite` (`DatabaseSync`). Precisa de **Node ≥ 22.13** (a partir daí não é preciso `--experimental-sqlite`; verificado com o Node 22.22.2 e a imagem `node:22-alpine`). O Node ainda escreve um aviso "SQLite is an experimental feature" no arranque: os scripts e o `Dockerfile` usam `--disable-warning=ExperimentalWarning` só para o esconder.
- Única dependência npm: `mqtt` (ligação **só de leitura** para os alertas técnicos).
- Palavras-passe com `scrypt` (`node:crypto`, N=16384, r=8, p=1, sal de 16 bytes).
- Os ecrãs estão em `public/` (outro trabalho); este serviço serve-os em `/painel/`.

## O que o painel pode e não pode fazer

| Pasta (contentor) | Acesso | Para quê |
|---|---|---|
| `/dados/painel` | escrita | `painel.db` (utilizadores, sessões, auditoria, orçamentos, obras, fichas de cliente, pedidos-admin, catálogo) e `fotos/<pedido>/` (fotos do simulador) |
| `/dados/pedidos-admin` | escrita | fila de pedidos ao servidor e respetivos resultados |
| `/dados/planos` | **só leitura** | plano e estado de cada cliente (`<c>.json`) |
| `/dados/pagamentos` | **só leitura** | `pagamentos.csv` |
| `/dados/clientes` | **só leitura** | `<c>.tsv` (aparelhos) — formato no cabeçalho do `servidor/domus.sh` |

MQTT: utilizador `painel`, ACL `topic read domus/#` (não publica nada). O painel **não tem** a palavra-passe do admin nem as dos clientes: para criar clientes/aparelhos ou mudar planos escreve pedidos que o `./domus.sh processar-pedidos` (temporizador do VPS, como root) valida e executa.

## Variáveis de ambiente

| Variável | Por omissão | |
|---|---|---|
| `PORTA` | `8080` | |
| `DADOS_DIR` | `/dados` | base das pastas abaixo |
| `PAINEL_DB`, `PLANOS_DIR`, `CLIENTES_DIR`, `PAGAMENTOS_CSV`, `PEDIDOS_DIR` | `$DADOS_DIR/painel/painel.db`, `…/planos`, `…/clientes`, `…/pagamentos/pagamentos.csv`, `…/pedidos-admin` | |
| `PUBLIC_DIR` | `painel/public` | ecrãs servidos em `/painel/` |
| `MQTT_URL`, `MQTT_USER`, `PAINEL_MQTT_PASS` | `mqtt://mosquitto:1883`, `painel`, — | sem palavra-passe os alertas ficam desligados (`ligado: false`) |
| `DOMUS_HOST`, `PUBLIC_URL`, `PAINEL_ORIGENS` | — | origens aceites nos pedidos que alteram dados (`https://DOMUS_HOST`, a origem de `PUBLIC_URL` e a lista separada por vírgulas). Sem nenhuma, **todos** os POST são recusados |
| `CONFIAR_PROXY` | — | `1` atrás do Caddy: o IP do visitante é o último valor do `X-Forwarded-For` |
| `PAINEL_CEO_EMAIL`, `PAINEL_CEO_PASS` | — | cria o primeiro CEO **só se ainda não houver utilizadores** (apague-as depois) |
| `LIMITE_ORCAMENTO_HORA`, `LIMITE_ORCAMENTO_GLOBAL` | `5`, `200` | pedidos de orçamento por hora, por IP e no total |
| `PEDIDOS_POLL_MS` | `3000` | de quanto em quanto tempo o painel olha para a fila (resultados e pedidos `painel-utilizador`) |
| `FOTOS_DIR` | `$DADOS_DIR/painel/fotos` | fotos dos pedidos (uma pasta por pedido; nunca dentro de `PUBLIC_DIR`) |
| `LIMITE_FOTOS_HORA` | `120` | fotos por hora, por IP (`POST /api/orcamento/fotos`) |
| `ANTHROPIC_API_KEY` | — | leitura automática da foto do quadro (Claude Haiku 4.5). Sem ela a leitura fica **desligada** (não se chama nada) |
| `LEITURA_QUADRO_TIMEOUT_MS` | `60000` | tempo máximo de cada tentativa da leitura (há 1 tentativa extra) |
| `SITE_ORIGENS` | — | conta de cliente / Vercel: origens do site público noutro endereço (ex. `https://domusenergia.pt`). CORS com cookies **só** para estas, só em `/api/orcamento*`, `/api/catalogo` e `/api/conta/*` (docs/CONTA-CLIENTE.md) |
| `CONTA_CHAVE` | — | 32 bytes (64 hex ou base64): cifra (AES-256-GCM) as credenciais MQTT da casa guardadas na conta. Sem ela a área de cliente só entra com o código |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_UTILIZADOR`, `SMTP_PASSWORD`, `EMAIL_REMETENTE` | —, `587` | emails das contas (códigos). 587 = STARTTLS obrigatório, 465 = TLS direto (`SMTP_SEGURANCA` força `tls`/`starttls`). Sem `SMTP_HOST` o email vai para o registo: `[email] para x: código 123456`. Exemplo gratuito: **Brevo** (300/dia): `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORTA=587`, o login e a "SMTP key" de brevo.com → SMTP & API |
| `EMAIL_LOCAL` | — | `1` = os emails vão sempre para o registo (modo local, `local/iniciar.js`) |
| `SITE_URL` | 1.ª de `SITE_ORIGENS`, `PUBLIC_URL` ou `https://DOMUS_HOST` | ligação para `conta.html` nos emails |

## API

JSON em tudo; erros sempre `{"erro": "mensagem em pt-PT"}`. Valores em euros como números (`9.99`); datas `AAAA-MM-DD`, horas `HH:MM`, instantes ISO 8601 UTC.

**Regras comuns a `/painel/api/*`**
- Sessão: cookie `domus_painel` (32 bytes aleatórios; `HttpOnly; Secure; SameSite=Strict; Path=/painel`), guardado na SQLite como SHA-256. Expira ao fim de **12 h sem uso** (renovada a cada pedido, o cookie é reenviado) e, em qualquer caso, 7 dias depois de entrar. Mudar o papel, desativar ou repor a palavra-passe de alguém termina as sessões dessa pessoa.
- Autorização **no servidor em todas as rotas**: sem sessão → `401`; papel sem acesso → `403 {"erro":"Não tem acesso a esta área."}` (antes de ler o corpo; sem efeitos).
- **CSRF**: todos os `POST` exigem `Content-Type: application/json` (senão `415`) e um pedido do próprio site: `Sec-Fetch-Site`, se vier, tem de ser `same-origin`; `Origin`, se vier, tem de estar na lista de origens; sem nenhum dos dois → `403`. O `fetch` do navegador envia ambos sozinho.
- Corpo: objeto JSON com campos conhecidos (campo desconhecido → `400`), até 16 KB (64 KB nas obras).
- Todas as alterações ficam na **auditoria** (quem, o quê, quando, IP; nunca palavras-passe nem hashes).

| Método e caminho (`/painel/api/…`) | Papéis | Corpo → resposta |
|---|---|---|
| `POST entrar` | público | `{email, password}` → `200 {utilizador}` + cookie. `401` errado (mesma mensagem para email inexistente/conta desativada); `429` + `Retry-After` com mais de **5 tentativas/min por IP ou por email**, ou conta **bloqueada 15 min depois de 10 falhas seguidas** (mesmo com a palavra-passe certa) |
| `POST sair` | público | `{}` → `200 {ok:true}`, apaga a sessão e o cookie |
| `GET eu` | todos | `{utilizador:{id,nome,email,papel}, sessao_expira}` |
| `POST eu/senha` | todos | `{atual, nova}` → `200 {ok:true}`: a própria pessoa muda a palavra-passe (menu "Mudar palavra-passe"). `400` se a atual está errada ou a nova não cumpre as regras (≥ 10 caracteres, diferente da atual); tentativas erradas contam para o limite por email. As outras sessões terminam, esta continua |
| `GET resumo` | todos | por papel — **CEO**: `clientes {total, por_plano, por_estado}`, `receita_recorrente_mensal` (soma s/ IVA dos planos com estado `ativo`; cliente sem ficheiro de plano = conforto ativo), `recebido_mes {mes, pagamentos, com_iva, sem_iva}` (CSV, mês civil de Lisboa), `pedidos_novos`, `obras_semana` (segunda a domingo, sem canceladas), `alertas {ligado, contagem, criticos}`, `pedidos_admin_pendentes`; **técnico**: `obras_hoje`, `obras_semana` (só as suas), `alertas {ligado, contagem, principais}`; **comercial**: `orcamentos_por_estado`, `pedidos_novos`, `visitas_semana`. Todos: `papel`, `hoje`, `semana {inicio, fim}` |
| `GET clientes` | todos | `?plano=&estado=&q=` → `{clientes:[{codigo, nome, contacto, localidade, pendente, plano, estado, n_aparelhos, alertas*}]}`. **Só CEO**: `proximo_pagamento, aviso_ate, gerido, sem_ficheiro_plano, valor_mensal_iva, valor_mensal_sem_iva`. `alertas` (contagem) só CEO/técnico. `pendente: true` = cliente pedido mas ainda não criado no servidor |
| `GET clientes/:c` | todos | ficha: o anterior + `aparelhos` (do `.tsv`), `obras` (técnico: só as suas), `pedidos`; CEO/técnico: `alertas_lista`, `casa {alarme, modo, plano, eventos}`; CEO/comercial: `orcamento_origem`; **só CEO**: `pagamentos` (linhas do CSV), `total_pago` |
| `POST clientes` | ceo, comercial | `{codigo, nome, contacto?, localidade?}` → `202 {pedido}` (pedido-admin `cliente`). `409` se já existe ou já há pedido; código `[a-z0-9-]`, 1–32, não reservado (`admin`, `motor`, `pagamentos`, `painel`) |
| `POST clientes/:c/aparelhos` | ceo, tecnico | `{id, tipo: "openbeken"\|"shelly", nome, canais?, divisao?, medidor?, geral?, bateria?, substituir?}` (mesmas opções do `domus.sh aparelho`; `canais` no formato `"1:interruptor:Teto:arranque=ultimo,2:porta:Porta:entrada"`) → `202 {pedido}`. `409` se o aparelho existe e `substituir` não é `true` |
| `POST clientes/:c/aparelhos/:a/remover` | ceo, tecnico | `{}` → `202 {pedido}` (`remover-aparelho`) |
| `POST clientes/:c/plano` | ceo | `{plano: "base"\|"conforto"\|"premium", estado?: "ativo"\|"teste"\|"em_atraso"\|"suspenso"\|"cancelado"}` → `202 {pedido}` (gestão manual) |
| `GET alertas` | ceo, tecnico | `?cliente=` → `{ligado, atualizado, contagem {critica, alta, media, baixa}, alertas:[{id, cliente, aparelho, aparelho_nome, tipo, gravidade, mensagem, desde?, valor?}], casa?}` — ver "Alertas" |
| `GET orcamentos` | ceo, comercial | `?estado=` → `{orcamentos:[…]}` (sem a simulação; `tem_simulacao`, `simulacao_bytes`, `n_fotos`) |
| `POST orcamentos` | ceo, comercial | pedido registado à mão (telefone, loja): `{nome, servico, telefone?, email?, localidade?, mensagem?, notas?}` → `201` |
| `GET orcamentos/:id` | ceo, comercial | pedido completo com **`fotos`** `[{id, chave, tipo, divisao, divisao_nome, piso, legenda, tipo_mime, bytes, criado, url}]` (quadro primeiro; metadados de `simulacao.fotos` pela chave), **`leitura_quadro`** `{estado: "sem_foto"\|"desligada"\|"pendente"\|"feita"\|"erro", foto_id?, modelo?, quando?, leitura?, tokens?, custo_usd?, erro?}` (ver "Fotos"), **`simulacao`** (o objeto tal como chegou), **`catalogo`** `{SKU: {nome, categoria, especificacoes, preco_venda_iva, horas_instalacao, ativo}}` (só os artigos da simulação que existem no catálogo; nunca preço de compra, fornecedor nem link — o visualizador marca os que faltam) e **`historico`** `[{quando, por, acao, detalhes}]` |
| `POST orcamentos/:id` | ceo, comercial | `{estado?, notas?, data_visita?, valor_proposta?, motivo_perda?, nome?, telefone?, email?, localidade?, servico?, mensagem?}`; estados `novo`, `contactado`, `visita_marcada` (exige `data_visita`, `AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM`), `proposta_enviada`, `aceite`, `perdido` (exige `motivo_perda`) → `200` pedido completo |
| `GET orcamentos/:id/fotos/:foto` | ceo, comercial | a foto (bytes) com `Content-Type` `image/jpeg`/`image/png`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. `404` se a foto não é desse pedido. Não há listagem |
| `POST orcamentos/:id/fotos/:foto/apagar` | ceo, comercial | `{}` → `200` pedido completo; apaga o registo e o ficheiro (fica na auditoria/histórico) |
| `POST orcamentos/:id/converter` | ceo, comercial | só com estado `aceite`, uma vez: `{codigo, data?, hora?, kit?, horas_estimadas?, notas?, tecnicos?, aparelhos?}` (`tecnicos` só o CEO; `data` por omissão a da visita; corpo até 64 KB) → `201 {cliente, cliente_existia, pedido, aparelhos, obra}`: ficha do cliente com os contactos do pedido, pedido-admin `cliente` (se ainda não existe), um pedido-admin `aparelho` por cada item de **`aparelhos`** (lista até 60, cada um validado **exatamente** como `POST clientes/:c/aparelhos`; ids repetidos → `400`; cliente existente com o mesmo aparelho sem `substituir` → `409`; nada é escrito se algum falhar) e obra `agendada` com o **material pré-preenchido** a partir de `simulacao.itens` (nomes do catálogo). Os ids dos pedidos-admin crescem sempre (mesmo no mesmo segundo), e o `processar-pedidos` trata-os pela ordem dos nomes: primeiro o cliente, depois os aparelhos pela ordem da lista. O painel pré-preenche a lista a partir da simulação (disjuntor → openbeken com medidor e `carga=perigosa` se o circuito tem máquinas ≥ 2000 W; interruptor de N botões → N canais; estore → shelly `estore`; sensor de porta → `porta[:entrada],bateria`; movimento → `movimento,bateria`; medidor geral Wi-Fi do quadro → openbeken `medidor` + `geral` sem canais; disjuntor geral Wi-Fi → openbeken com medidor e `1:interruptor:Geral:carga=perigosa` (é `geral` só sem medidor geral); os outros artigos do quadro — diferenciais, descarregador, relé de tensão, AFDD, disjuntores 1P+N, caixas — ficam só como material) e deixa editar antes de confirmar (com a caixa "Medidor geral da casa") |
| `GET obras` | todos (técnico: só as suas) | `?de=&ate=&estado=&cliente=` → `{obras:[{id, cliente, cliente_nome, orcamento_id, data, hora, kit, estado, material:[{nome, quantidade, feito, sku?}], horas_estimadas, horas_reais, notas, tecnicos:[{id, nome}]}]}` |
| `GET obras/:id` | todos (técnico: só as suas, senão `403`) | uma obra |
| `POST obras` | ceo | `{cliente, data, hora?, kit?, estado?, material?, horas_estimadas?, horas_reais?, notas?, tecnicos?, orcamento_id?}` → `201`. `kit`: `essencial` (3 h), `conforto` (7 h), `premium` (10 h), `outro`; `horas_estimadas` por omissão vêm do kit |
| `POST obras/:id` | ceo (tudo), tecnico (as suas: só `estado`, `horas_reais`, `material`, `notas`; não cancela) | → `200` obra. Comercial: `403` (agenda só de leitura) |
| `GET pagamentos` | ceo | `?mes=AAAA-MM` → `{linhas, totais_mes:[{mes, pagamentos, com_iva, sem_iva}], total}`; `?formato=csv` → descarga `text/csv` (`;`, vírgula decimal, BOM, fórmulas neutralizadas) |
| `GET utilizadores` | ceo | `{utilizadores:[{id, nome, email, papel, ativo, criado, atualizado}]}` |
| `POST utilizadores` | ceo | `{nome, email, papel, password?}` → `201 {utilizador, password?}` (sem `password` o servidor gera uma de 16 caracteres, devolvida **só nesta resposta**) |
| `POST utilizadores/:id` | ceo | `{nome?, papel?, ativo?, repor_password?: true, password?}` → `200 {utilizador, password?}` (`repor_password` gera e devolve uma nova, uma vez). Nunca deixa ficar sem CEO ativo (`409`) |
| `GET auditoria` | ceo | `?alvo=` (ex. `obra:12`) → `{auditoria:[{id, quando, utilizador_id, email, acao, alvo, detalhes, ip}]}` — últimas 500, mais recentes primeiro |
| `GET pedidos` | todos | `{pedidos:[…]}` — os seus (CEO: todos), últimos 200 |
| **`GET pedidos/:id`** | quem fez o pedido, ou ceo | **resultado de um pedido-admin**: `{pedido:{id, tipo, cliente, dados, por, criado, estado: "pendente"\|"concluido"\|"erro", concluido, erro, resultado_disponivel, mostrado}, resultado}`. Enquanto `pendente`, `resultado` é `null` (voltar a perguntar ao fim de alguns segundos; o temporizador corre a cada ~5 s). Quando o `domus.sh` acaba, a **primeira** chamada devolve `resultado {id, tipo, ok, erro?, cliente, aparelho, password, saida, concluido}` — `password` é a palavra-passe gerada para o cliente/aparelho e `saida` o texto do `domus.sh` (cartão de login do cliente ou instruções de configuração do aparelho) — e **apaga o ficheiro**: as chamadas seguintes dão `resultado: null` e `mostrado`. Outro utilizador (não CEO) → `403`. Resultados nunca vistos são apagados ao fim de 7 dias |
| `GET catalogo` | ceo | `{itens:[{id, sku, nome, categoria, fornecedor, link, preco_compra, preco_venda_iva, horas_instalacao, especificacoes, ativo, visivel_cliente, atualizado}], config}` |
| `POST catalogo` | ceo | `{sku, nome, categoria, preco_venda_iva, fornecedor?, link?, preco_compra?, horas_instalacao?, especificacoes?, ativo?, visivel_cliente?}` → `201`. `sku` `[A-Z0-9._-]`; categorias `disjuntor`, `interruptor`, `sensor`, `estore`, `tomada`, `luz`, `termostato`, `central`, `acessorio`, `outro`; `link` só `https://`; `especificacoes` objeto ≤ 8 KB |
| `POST catalogo/:id` | ceo | os mesmos campos, parciais → `200` |
| `GET config-orcamento` | ceo | `{tarifa_hora_iva, margem_intervalo_pct, deslocacao_iva, deslocacao_base, deslocacao_km_gratis, deslocacao_preco_km_iva, deslocacao_max_km}` (35, 15, 0, "Lisboa", 20, 0,40, 100 por omissão). `deslocacao_iva` = valor fixo (mínimo) de cada deslocação; o simulador soma-lhe (km − km grátis) × preço por km, com km = linha reta entre as sedes dos concelhos × 1,3 (docs/SIMULADOR-ORCAMENTO.md §5.1) |
| `POST config-orcamento` | ceo | parcial → `200`. Limites: tarifa 0–1000, margem 0–100, fixo 0–10 000, km grátis 0–1000, €/km 0–100, máx. 0–2000 km; `deslocacao_base` = nome exato de um dos 308 concelhos (`public/vendor/concelhos.js`, cópia de `web/simulador/concelhos.js`) |

### Endpoints públicos (sem sessão)

| Pedido | |
|---|---|
| `POST /api/orcamento` | `{nome, telefone?, email?, localidade?, servico, mensagem?, website?, codigo_cliente?, simulacao?}` → `201 {"ok":true,"fotos_token":"…","fotos_max":40}` (token para as fotos, ver abaixo; a armadilha recebe um token falso sem efeito, para não se denunciar). `simulacao.fotos` (opcional): até 40 `{chave, tipo, divisao, divisao_nome, piso, legenda}` (textos ≤ 120). `nome` 1–120, pelo menos `telefone` ou `email`, `servico` 1–80, `localidade` ≤ 80, `mensagem` ≤ 2000, `codigo_cliente` como os códigos de cliente. **`website` é o campo-armadilha**: preenchido → `201` mas descartado. **`simulacao`**: objeto JSON (senão `400`), até **1 MB** (`413`), no máximo 32 níveis; as imagens (ex. a planta) só como `data:image/jpeg;base64,…` ou `data:image/png;base64,…` (qualquer outro `data:` — SVG, HTML, GIF — é `400`); é guardada tal como chegou e devolvida em `GET orcamentos/:id`. Corpo até 1,25 MB. Limite **5 pedidos por hora por IP** (contam todos, incluindo os recusados e a armadilha) e 200 por hora no total → `429` + `Retry-After`. Mesmas regras de origem e JSON (CSRF) do painel. Fica com estado `novo` (conta em `pedidos_novos` no resumo) |
| `POST /api/orcamento/fotos` | uma foto por pedido HTTP: corpo = bytes da imagem (≤ **1 MB**, senão `413`), `Content-Type: image/jpeg` ou `image/png` e bytes mágicos a condizer (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`; senão `415`), cabeçalhos `X-Fotos-Token` (o do `POST /api/orcamento`: válido **30 min**, só para as fotos desse pedido; na base só o SHA-256; errado/expirado → `401`), `X-Foto-Chave` (`quadro` ou `<id da divisão>:<tipo>`, `[A-Za-z0-9_-]{1,64}:[a-z0-9_]{1,32}`; senão `400`) e `X-Foto-Legenda` opcional (`encodeURIComponent`, ≤ 120). → `201 {"ok":true,"id":"<24 hex>"}`. Máx. **40 fotos por pedido** (`400`); a mesma chave **substitui** a anterior (registo e ficheiro). Limite `LIMITE_FOTOS_HORA` por IP (contam todas as tentativas) → `429` + `Retry-After`. Mesmas regras de origem (CSRF) do `/api/orcamento` (`403`). Guardadas em `FOTOS_DIR/<pedido>/<id>.jpg\|png` (modo 600) com registo na tabela `fotos` (migração 5) |
| `/api/conta/*` | **conta de cliente** (docs/CONTA-CLIENTE.md, `src/conta.js`): criar/entrar/sair, código de 6 dígitos (confirmar, reenviar), esqueci/repor, simulação guardada, pedidos da conta (estado, resumo, fotos, aceitar a proposta) e credenciais da casa. Cookie próprio `domus_conta` (HttpOnly, SameSite=Lax, Path=/api); nunca abre `/painel/api/`. **`POST /api/orcamento` com `simulacao` exige esta sessão com o email confirmado** (401/403) e fica com `conta_id`; sem simulação (formulário do site) continua sem conta. Campo novo no pedido: `morada` (≤ 200) |
| `GET /api/catalogo` | `{itens:[{sku, nome, categoria, preco_venda_iva, horas_instalacao, especificacoes}], config:{tarifa_hora_iva, margem_intervalo_pct, deslocacao_iva, deslocacao_base, deslocacao_km_gratis, deslocacao_preco_km_iva, deslocacao_max_km}}` — a configuração só com estas chaves (lista fixa em `api.js` `CONFIG_PUBLICA`); só artigos `ativo` e `visivel_cliente`; **nunca** `preco_compra`, `fornecedor` nem `link`. `Cache-Control: public, max-age=60` (um preço novo chega aos navegadores em ≤ 1 min) |

### Alertas

Calculados em direto a partir dos tópicos retidos `_aparelhos`, `_saude` (PROTOCOLO-MQTT-v3 §5), `_alarme`, `_modo`, `_plano`, `<aparelho>/connected` (OpenBeken) e `<aparelho>/online` (Shelly), e de `_eventos`. Ordenados por gravidade (depois cliente e aparelho):

| `tipo` | Quando | Gravidade |
|---|---|---|
| `alarme_disparado` | `_alarme.estado = "disparado"` (ou evento `alarme`) | crítica |
| `alarme_entrada` | tempo de entrada a correr | alta |
| `offline` | aparelho sem pilhas com `connected`/`online` a offline (ou `_saude.online = false`) | alta |
| `sem_noticias` | aparelho a pilhas sem notícias há mais de 24 h | média |
| `bateria_fraca` | bateria < 15 % | alta |
| `bateria_dias` | `bateria_dias` < 21 | média |
| `sinal_fraco` | rssi < −80 dBm | baixa |
| `reinicios` | mais de 5 reinícios em 24 h | média |

Com o alarme armado, os problemas (offline, sem notícias, bateria) de um sensor de porta/movimento sobem um nível. A lista vive na memória: ao arrancar, as mensagens retidas repõem tudo em segundos.

### Fotos, retenção e leitura automática do quadro

- **Acesso**: só CEO e comercial (os papéis que veem os orçamentos), com sessão; o técnico não. As fotos aparecem na ficha do pedido (galeria; "Apagar" em dois toques) e no Relatório técnico ("Leitura automática da foto do quadro (confirmar na visita)" e "Fotos do cliente por divisão", com miniaturas na impressão).
- **Retenção** (tarefa do painel, 1 min depois de arrancar e depois 1 vez por dia): apaga as fotos (ficheiros, pasta e registos) dos pedidos **perdidos ou sem resposta** = estado diferente de `aceite`, **nunca convertidos** em cliente/obra e **sem nenhuma alteração** (`atualizado`) **há mais de 12 meses**. Os aceites/convertidos ficam com as fotos (o CEO/comercial pode apagá-las à mão). Fica na auditoria (`fotos_apagadas_retencao`). A leitura do quadro (texto, sem dados pessoais) fica com o pedido.
- **Leitura automática da foto do quadro** (`src/leitura-quadro.js`): quando chega a foto `quadro`, o painel responde logo ao browser e, em segundo plano, envia **só a imagem e as instruções** (nunca nome, contactos ou morada) a `POST https://api.anthropic.com/v1/messages` (`fetch` do Node, sem dependências) com o modelo **`claude-haiku-4-5`** — o mais barato com visão e saídas estruturadas (US$ 1 / 1 M tokens de entrada, US$ 5 / 1 M de saída; uma foto de ~1600 px ≈ 2000–2500 tokens + ~400 de resposta ≈ **US$ 0,005**) — e `output_config.format` (JSON Schema). A resposta é validada outra vez (tipos, limites, campos a mais) e guardada em `orcamentos.leitura_quadro`: n.º de disjuntores e calibres, diferenciais e sensibilidade, disjuntor geral, módulos livres estimados, marcas, estado aparente (fusíveis, sinais de aquecimento), notas e confiança. Tempo máximo por tentativa `LEITURA_QUADRO_TIMEOUT_MS`; **1 tentativa extra** em tempo esgotado, falha de rede, 408/429/5xx ou JSON inválido (não em 400/401/403 nem recusa); tokens e custo estimado no registo (`leitura do quadro (orçamento N): …`). Uma foto do quadro nova substitui a leitura. Alimenta "A verificar na visita" (quadro antigo, fusíveis, aquecimento, sem diferencial, pouco espaço, confiança baixa). **Sem `ANTHROPIC_API_KEY` não se chama nada** e o relatório diz "leitura automática desligada".

## Pedidos-admin (`dados/pedidos-admin/`)

Uma linha JSON por pedido, `<id>.json` (modo 600), com as chaves **sempre por esta ordem**:

```json
{"id":"p-20261001100000-1a2b3c4d","tipo":"aparelho","dados":{"cliente":"joao","id":"cozinha","tipo":"shelly","nome":"Luz da cozinha","canais":"1:interruptor:Teto:arranque=ultimo","divisao":"Cozinha","medidor":true,"geral":false,"bateria":false,"substituir":false},"por":"tecnico@empresa.pt","criado":"2026-10-01T10:00:00Z"}
```

| `tipo` | `dados` |
|---|---|
| `cliente` | `{"codigo"}` (o nome e os contactos ficam só na base de dados do painel) |
| `aparelho` | `{"cliente","id","tipo","nome","canais","divisao","medidor","geral","bateria","substituir"}` (todas, sempre) |
| `remover-aparelho` | `{"cliente","id"}` |
| `plano` | `{"cliente","plano","estado"}` |
| `painel-utilizador` | `{"email","papel","nome","password"}` — escrito **pelo** `./domus.sh painel-utilizador` (ids `u-…`, `"por":"domus.sh"`) e aplicado por **este** serviço, que apaga o pedido (tem a palavra-passe) e responde em `<id>.resultado.json` sem ela |

O `./domus.sh processar-pedidos` responde em `<id>.resultado.json` (modo 600, dono uid 1000): `{"id","tipo","ok":true,"cliente","aparelho","password","saida","avisos","concluido"}` ou `{"id","tipo","ok":false,"erro","concluido"}`, e move o pedido para `feitos/`. O painel atualiza o estado do pedido sozinho (a cada `PEDIDOS_POLL_MS`) mas só apaga o resultado quando o mostra (`GET pedidos/:id`).

## Correr e testar

```bash
cd painel
npm ci
DADOS_DIR=/tmp/domus-dados PAINEL_ORIGENS=http://localhost:8080 PAINEL_CEO_EMAIL=ceo@exemplo.pt PAINEL_CEO_PASS=uma-senha-longa npm start
npm test
```

Os testes (`node:test`, `test/*.test.js`) não precisam de Docker nem de internet:
- `auth` — scrypt, entrar/errado, cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/painel`), sair, expiração e renovação, limites por IP e por email, bloqueio de 15 min, contas desativadas, CSRF, primeiro CEO;
- `papeis` — matriz de papéis de **todas** as rotas (anónimo/ceo/técnico/comercial; o teste falha se aparecer uma rota que a matriz não cobre), financeiro só para o CEO, ficheiros estáticos (tipos, sem listagem, sem fugas por `..`/symlink);
- `orcamento` — formulário público (válido, armadilha, validação, limite por hora, simulação guardada e devolvida, tamanho, só JPEG/PNG), catálogo público sem custos/fornecedores, gestão do catálogo;
- `fotos` — token (válido, expirado, errado, de outro pedido, armadilha), limites (tamanho, n.º, bytes mágicos, chave, legenda, origem, por IP), substituição pela mesma chave, acesso por papel e apagar, retenção de 12 meses, migração 5, pedidos sem fotos iguais a antes, leitura automática com a API simulada (sucesso sem dados pessoais, JSON inválido, fora do esquema, 500 + 2.ª tentativa, 401, tempo esgotado sem atrasar a resposta, sem chave);
- `crud` — orçamentos (estados, histórico, converter), obras (técnico só as suas e só alguns campos, comercial só lê), clientes, pagamentos/CSV, utilizadores, migrações (incl. a 3: uma base já existente recebe os artigos do quadro sem duplicar nem alterar preços editados; e a 4: a configuração da deslocação por distância sem perder valores editados), auditoria;
- `pedidos` — JSON exato de cada tipo, execução real pelo `servidor/domus.sh processar-pedidos` (modo simulação), resultado com a palavra-passe mostrado uma vez, erros, `./domus.sh painel-utilizador`;
- `alertas` — Mosquitto 2 real com a ACL gerada pelo `domus.sh` (precisa de `mosquitto`: `sudo apt-get install -y mosquitto mosquitto-clients`), lista viva e o utilizador `painel` sem permissão de escrita;
- `resumo` — números de cada papel.
- `deslocacao` — tabela dos 308 concelhos do simulador (`web/simulador/concelhos.js`, igual à cópia em `public/vendor/`), sugestões sem acentos, distância (haversine × 1,3), km grátis/€ por km/mínimo, fora da área e ilhas.

Os testes do servidor (`servidor/testes/simulacao.sh` e `servidor/testes/acl.sh`) cobrem o `processar-pedidos` com pedidos válidos e maliciosos.
