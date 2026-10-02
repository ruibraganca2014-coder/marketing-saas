# QA + revisão de segurança — painel/servidor (HEAD 9e3383a, branch claude/kind-babbage-gdmaij)

Revisão independente, só leitura e testes (nada foi alterado no código). Ambiente: Windows 11, Node 24.21, painel de teste da própria suíte (`painelComEquipa`, base temporária, CEO/comercial/técnico de teste `*@domus.teste`), navegador em 1280×900 e 375×812, tema escuro. Nunca foi usada a conta do dono nem a stack local `dados/`.

## 1. Testes automáticos

| Suíte | Resultado |
|---|---|
| `painel` `npm test` | 267 testes, **254 ok / 13 falhas — exatamente as 13 conhecidas do ambiente Windows**: 4× «o Mosquitto não arrancou» (alertas.test.js), 1× `EPERM symlink` (estáticos, crud.test.js), 8× `spawn EFTYPE` do `domus.sh` (pedidos.test.js). Nenhuma falha nova. |
| `motor` `npm test` | **136/136 ok**. |

## 2. Painel — ficha do pedido (navegador, harness)

Tudo verificado com o CEO de teste, salvo indicação; 1280 e 375, escuro; sem overflow horizontal a 375.

| Área | Resultado |
|---|---|
| Esquema do quadro — editor | Calha posicional desenhada pela `ordem` gravada (`geral, 30 mA, 16 A, livre, 10 A, livre`). Tocar num módulo livre → «Pôr disjuntor aqui (no lugar do módulo livre 1)»; o novo 16 A ficou **no lugar do livre**, o outro livre manteve a posição; «Módulos livres» passou a 1. Guardar → «Guardado … por ceo@domus.teste»; **F5 recarrega a mesma ordem**. Notas com `<script>` aparecem como texto (sem XSS). Arquivado (RGPD): só desenho de leitura, sem editor (API 409). |
| Ensaios medidos | Formulário visível (continuidade, isolamento, terra, diferencial, notas); valores guardados pela API (1,5 MΩ, 20 Ω, notas `ok <b>`) aparecem no formulário e na «Lista de ensaios» da pré-visualização. Técnico 403, comercial 200. |
| Diagnóstico (pedido de avaria) | Secção presente só nos pedidos avaria/reparar: «O que o cliente descreveu» → sugestões (Tomada sem corrente → Circuito aberto…; Disjuntor dispara → Sobrecarga/Curto), lista de verificação com medições, tipo e conclusão. Guardado pela UI (continuidade 0,3) → «Registado … por ceo@domus.teste»; reload mantém; **auditoria** `diagnostico_atualizado {verificacoes:3, tipo:"aberto", conclusao:true}` (sem o texto, bem). Conclusão com `<img onerror>` aparece como texto. Observação UX (baixo): aceita um valor medido sem a verificação assinalada (o cliente não o vê, `diagnosticoCliente` filtra pelas verificações). |
| Marcar visita | Botão «Marcar visita» no pedido de avaria (visita paga) e «Mudar a visita» no pedido com visita marcada; escondido quando a visita não está paga (pedido 2). API: técnico 403, comercial 200, arquivado 409. |
| Libertar relatório | Pedido sem relatório comprado: botão não aparece; API → **409 «O cliente ainda não comprou o relatório pormenorizado»**; comercial 403; depois de comprado → 200 e email. |
| Pré-visualizar versão do cliente | Abre o mesmo relatório da conta: divisões/material/totais, **planta técnica (simbologia normalizada)**, esquemas por luz, nota de terra, **lista de ensaios com os medidos**, **esquema do quadro elétrico** (SVG só leitura + resumo); «Diagnóstico da avaria» aparece só quando existe (não no pedido 1). |
| Ajuda técnica | `#/ajuda`: «Diagnóstico de avarias» com as 9 secções (segurança, sinais, ferramentas, 3 passos, 8 técnicas, 4 tipos, valores de referência, o que o cliente descreve, quando parar) + «Imprimir / guardar PDF». |
| Catálogo → Configuração | Campos presentes: intervalo para baixo/para cima, relatório pormenorizado (€), margem dos pacotes, IVA, isolamento mínimo, terra máxima, disparo do diferencial. Guardar (+25 %, 31 €) → «Configuração do simulador guardada», `GET config-orcamento` devolve 25/31. |
| Artigos das migrações 15/20 | No catálogo: PONTO-LUZ-NOVO, TOMADA-NOVA, TOMADA-DUPLA-NOVA, **TOMADA-TRIPLA-NOVA**, INTERRUPTOR-NOVO, COMUTADOR…, INVERSOR…, BOTAO-PRESSAO, **CAMPAINHA**, **IDR-2P-40A-30MA-A** — todos presentes. |
| Papéis | Técnico: `GET orcamentos/1` 403, ficha não abre; POST esquema/diagnóstico/ensaios/marcar-visita **403**. Comercial: editor do esquema, ensaios, diagnóstico, «Mudar a visita» e pré-visualização; sem «Libertar» (só CEO). |

## 3. Segurança — achados por gravidade

### Bloqueante
Nenhum.

### Alto
**A1 — Deploy: o Caddyfile novo não é recarregado pelo `instalar.sh --atualizar`.** `servidor/caddy/Caddyfile` é montado só de leitura (`docker-compose.yml:359`); `docker compose up -d --build` (`instalar.sh:565`) não recria o contentor do Caddy quando só o ficheiro montado mudou, e o script não faz `caddy reload` nem `restart caddy`. Sem recarga, `/api/fotos-remotas*` cai na regra `@pagamentos /api/*` e o serviço `pagamentos` responde 404: **as fotos pelo telemóvel (QR) não funcionam em produção** (e o antigo `/api/simulador/ler-quadro` continua encaminhado ao painel, inofensivo). Ver §5 para o comando.

### Médio
**M1 — Email do eletricista vai para o cliente em `esquema_quadro.por`.** `api.js:936` guarda `{…esquema, data, por: u.email}`; `pagamentos-pedido.js:616-621` (`esquemaQuadroDe`) devolve o objeto tal e qual e `relatorioCliente` (`pagamentos-pedido.js:886`) passa-o ao cliente. Reproduzido: `GET /api/conta/pedidos/1/relatorio` → `esquema_quadro.por = "comercial@domus.teste"` (o diagnóstico já é limpo por `diagnosticoCliente`, `por` ausente — bem). A conta não o desenha, mas o JSON expõe emails internos. O mesmo JSON leva `esquema_quadro.notas` («marca, o que confirmar na visita…»), que o editor apresenta como notas de trabalho e a conta não mostra. Correção: em `relatorioCliente` enviar `{disjuntor_geral, diferenciais, disjuntores, modulos_livres, ordem, estado, fusiveis, sinais_aquecimento, data}` (sem `por` nem `notas`), p. ex. uma `esquemaQuadroCliente(o)` ao lado de `diagnosticoCliente`.

**M2 — Anonimização RGPD não limpa as colunas novas.** `conta.js:749-751` põe a NULL nome/contactos/morada/mensagem/notas/simulação/leitura_quadro, mas **mantém `esquema_quadro` (com `por` e `notas` livres), `diagnostico` (conclusão livre + `por`) e `ensaios` (notas livres)**. Reproduzido: depois de apagar a conta, o pedido 5 ficou `arquivado` com `esquema_quadro`, `diagnostico` e `ensaios` intactos («Casa do Bruno, portão azul», «Conclusão com dados do Bruno», «Ensaios na casa do Bruno»). Só o CEO vê o arquivado (comercial 404, conta 404, prévia 409: verificado), mas são texto livre sobre a casa de uma pessoa que pediu o apagamento. Correção: acrescentar `esquema_quadro = NULL, diagnostico = NULL, ensaios = NULL` ao UPDATE de `conta.js:749` (e a `docs/CONTA-CLIENTE.md`).

**M3 — Tokens das fotos nos access logs do Caddy.** O cabeçalho `X-Foto-Token` (24 h) e `X-Fotos-Token` (30 min) chegam ao Caddy, cujo `log { format console }` (`Caddyfile:111`) regista todos os cabeçalhos do pedido (o Caddy só redige Cookie/Authorization). O painel não os regista (verificado em `fotos-remotas.js:120,190`), mas ficam nos logs do contentor `caddy` (json-file, 3×10 MB, só root). Mitigação: no bloco `log` usar `format filter { wrap console  request>headers>X-Foto-Token delete  request>headers>X-Fotos-Token delete }`.

### Baixo
**B1 — Criação de tokens de fotos remotas sem limite próprio.** `POST /api/fotos-remotas` sem cabeçalho cria sempre um token (`fotos-remotas.js:62-66`), contando só no `limiteConsultas` (3000/h/IP, `config.js:199`): até 3000 linhas/h/IP em `fotos_remotas_tokens`, limpas ao fim de 24 h (reproduzido: 50 pedidos → 51 tokens). Disco: envios limitados pelo `LIMITE_FOTOS_HORA` (120/h/IP × 1 MB) e apagados em 24 h — aceitável, mas sem teto global. Sugestão: limite separado para criação de token (ex. 60/h/IP) ou reutilizar o token de `sim` se já existir e não expirou.

**B2 — `LIMITE_FOTOS_CONSULTAS_HORA` não passa pelo `docker-compose.yml`.** A omissão 3000/h/IP chega (sondagem de 3 s = 1200/h por simulação; dois computadores atrás do mesmo NAT já ficam perto), mas não é afinável pelo `.env` sem editar o compose. Acrescentar `LIMITE_FOTOS_CONSULTAS_HORA: ${LIMITE_FOTOS_CONSULTAS_HORA:-3000}` (e `LIMITE_FOTOS_HORA`) ao serviço `painel`.

**B3 — Diagnóstico: valor medido sem verificação assinalada** (UX; ver tabela). Sugestão: ao preencher o valor assinalar a verificação, ou avisar.

### Verificado e OK (sem achado)
- `/api/fotos-remotas*`: token 32 bytes aleatórios base64url (43 chars), só SHA-256 na base (confirmado na tabela); expiração 24 h e limpeza de 15 em 15 min com `rm` da pasta; chave validada por `RE_CHAVE_FOTO` (`../../x` → 400, URL-decode antes); ficheiro = id aleatório + extensão da lista branca; MIME só JPEG/PNG com bytes mágicos (SVG como PNG → 415); 1 MB com `Content-Length` e contagem; POST exige origem (`verificarOrigemPublica`: sem Origin → 403, cross-site → 403); GET só com token (401); 405 nos outros métodos; CORS só para `SITE_ORIGENS` com `X-Foto-Token` em `Access-Control-Allow-Headers`; o token vai no fragmento do URL (`#t=`) — nunca no servidor; `foto.js`/`fotos-remotas.js` sem `console.log` do token; o telemóvel só recebe rótulos/chaves, nada da simulação.
- `/api/orcamento`: enviar grátis → 201 com `pedido`; `compra` validada por `opcao` (valores sempre do servidor); avaria com pagamentos ligados → **202** com pagamento; Funchal → **409**; honeypot `website`; limites por IP/global e retentativa por conta (20/h). Rate limits iguais aos de antes.
- `/api/conta/*` compras: visita sem concelho → 409 (`comprar`, `pagamentos-pedido.js:342`; no envio fica em `pagamento_erro` e o pedido existe), relatório repetido → **409 «Já comprou…»**, índice único de fase paga, pendente igual reaproveitado; sinal = `max(0, 30 % × total c/ IVA − pago antes)` (`calcularSinal`, testado).
- Rotas novas do painel: matriz de papéis em `ROTAS` (`api.js:86-92`), CSRF por `verificarOrigem` + JSON obrigatório em todos os POST (`api.js:1491-1492`); corpos limitados (esquema 64 KB → 70 KB dá 413; diagnóstico/ensaios 16 KB → 413); validação em `validar.js` (limites 30/80/150, estados, chaves conhecidas, controlo de caracteres); `naoArquivado` em todas (409).
- XSS: `painel/public/ui.js` só `textContent`; único `innerHTML` é o modelo estático da janela do QR (`web/simulador/fotos-remotas.js:56`, sem dados); `web/conta.js` desenha diagnóstico/esquema/ensaios com `el()` (texto). Payloads guardados aparecem como texto no painel e na pré-visualização.
- Relatório do cliente: sem `preco_compra`, `fornecedor`, `link`, `nota` interna (`artigosDaSimulacao`, `catalogoPublico`); `diagnosticoCliente` sem `por`; `GET /api/conta/pedidos` sem emails de staff; pedido arquivado invisível à conta e ao comercial.
- CSP: `foto.html` é servida com a CSP do site (scripts só `self`/jsdelivr; `style-src 'unsafe-inline'` cobre os `style=""` da página; `img-src data:` cobre a miniatura); a janela do QR vive no simulador (mesma CSP, SVG gerado por DOM, sem `eval`/inline). O painel mantém a CSP própria (`estatico.js:30`).
- Migrações 15–20 (ver §4).

## 4. Prontidão para produção

- **Migrações 15–20**: numa base de teste com dados «de produção» (20 pedidos incl. arquivados, conta, pagamento pago, preço de artigo editado pelo CEO, `CAMPAINHA` criada à mão, `preco_relatorio_iva`/`ensaio_terra_ohm` editados) a partir de `user_version` **14** e de **17**: migram para 20 em < 20 ms, `integrity_check` ok, `foreign_key_check` vazio, sequência mantida, os valores editados pelo CEO **não são tocados** (INSERT OR IGNORE), as colunas `ensaios/esquema_quadro/diagnostico` e as tabelas `fotos_remotas*` criadas; **segunda execução é no-op** (estado idêntico). Base mais recente que o programa (99) → erro claro.
- **Caddyfile**: matcher `@orcamento` inclui `/api/fotos-remotas` e `/api/fotos-remotas/*` antes de `@pagamentos`; `max_size 2MB` chega (foto ≤ 1 MB). Falta a recarga (A1).
- **docker-compose**: nenhuma variável nova obrigatória; `LIMITE_FOTOS_CONSULTAS_HORA` usa a omissão 3000 (B2). `FOTOS_DIR/remotas` fica em `dados/painel/fotos` (volume já montado, uid 1000, `read_only` do contentor respeitado via volume).
- **instalar.sh --atualizar**: faz `git fetch/merge --ff-only`, pastas, `config-site`, utilizadores, `docker compose pull` + `up -d --build --remove-orphans`, temporizadores. **Não recarrega o Caddy** (A1).

## 5. Passos exatos de deploy

```bash
ssh <vps>
cd /opt/domus/domus-energia/servidor            # ou a pasta do clone
sudo cp -a dados/painel/painel.db /root/painel.db.antes-9e3383a   # cópia de segurança (as migrações 15–20 só acrescentam, mas é barato)
sudo bash instalar.sh --atualizar                # git ff-only → 9e3383a, docker compose pull/up -d --build (o painel migra a base ao arrancar: 17 → 20)
# OBRIGATÓRIO (A1): aplicar o Caddyfile novo (/api/fotos-remotas*)
sudo docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
#   (alternativa equivalente: sudo docker compose restart caddy — corta as ligações WSS do MQTT por uns segundos)
# Verificar
sudo docker compose logs --tail 30 painel | grep -Ei "migra|erro|painel à escuta"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://$DOMUS_HOST/api/fotos-remotas \
  -H 'Content-Type: application/json' -H "Origin: https://$DOMUS_HOST" -H 'Sec-Fetch-Site: same-origin' \
  -d '{"sim":"deadbeef0001","chave":"quadro"}'        # esperado 201 (painel); 404 = Caddy ainda com a regra antiga
curl -sS https://$DOMUS_HOST/api/catalogo | grep -o 'TOMADA-TRIPLA-NOVA'   # migração 20 aplicada
```

Depois do deploy: no painel, Catálogo → Configuração confirmar os preços dos artigos novos (PONTO-LUZ-NOVO, TOMADA-*-NOVA, CAMPAINHA, IDR-2P-40A-30MA-A, marcados «preço provisório»). Recomendado antes de libertar relatórios a clientes reais: corrigir M1 (email do staff em `esquema_quadro.por`) — é uma linha em `relatorioCliente`.

## 6. Ficheiros de apoio (scratchpad da sessão)
- `qa/harness.mjs` — painel de teste com UI, pedidos semeados e sondas de API (saída em `qa/harness.log`).
- `qa/migracoes.mjs` — idempotência das migrações a partir de 14 e 17.
