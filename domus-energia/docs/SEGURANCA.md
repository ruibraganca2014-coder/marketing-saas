# Avaliação de segurança (27/09/2026)

Revisão autorizada, feita localmente (Mosquitto 2.0.18 real, motor real, site com Playwright). Sem contacto com servidores externos.

## Verificado como seguro
- **Isolamento entre clientes (MQTT):** 131 testes de permissões passam. Um cliente só lê a sua casa; `#` só devolve a sua árvore; tópicos reservados (`_aparelhos`, `_alarme`, `_modo`, `_config`, `_cenas`, `_saude`, `_energia`, `_presenca`, `_historico`, `_eventos`, registo, avisos, admin) são só de leitura para clientes; cada aparelho só escreve no seu prefixo; remover um aparelho corta a sessão.
- **Automações/cenas não chegam a outra casa:** tópicos construídos a partir do próprio cliente e de ids `[a-z0-9-]`.
- **Motor:** rejeita `__proto__`/`constructor`, JSON aninhado 5000 níveis, textos de 5 MB, listas de 100 000 elementos; nunca cai com mensagens malformadas; limites de crescimento (presença 20, FCM 10, histórico 100, registo 20, automações 50, cenas 30).
- **Site:** sem XSS — dados dos clientes sempre com `textContent`.
- **Android:** ligação `wss` com TLS; só a atividade principal é exportada; sem segredos nos registos.
- **Dependências do motor:** `npm audit` 0 vulnerabilidades; contentor sem root.
- **domus.sh:** palavras-passe de 20 caracteres de `/dev/urandom`, passadas por stdin; ids e nomes validados; `dados/` com permissões 700/600.

## A corrigir
| Nível | Problema | Estado |
|---|---|---|
| Alto | Porta 1883 sem cifra na internet: credenciais e comandos dos aparelhos em claro | Risco aceite (OpenBeken/BK7231 sem TLS fiável); porta TLS 8883 opcional documentada (`mosquitto/conf.d/tls.conf.exemplo`, README "MQTT com TLS") |
| Médio | Site sem proteção contra *clickjacking* nem CSP (pode ser posto numa moldura para enganar o cliente a desarmar o alarme) | Feito: `X-Frame-Options: DENY` e `Content-Security-Policy` no Caddy (`servidor/README.md` §14) |
| Médio | Executar cenas sem limite → excesso de notificações e carga no motor partilhado | Limite como nas automações + limite de notificações por cliente — em curso |
| Médio | App Android guarda a palavra-passe sem cifra (SharedPreferences) | EncryptedSharedPreferences / Keystore — próxima ronda da app |
| Médio | Mosquitto sem `max_connections` | Feito: `max_connections 2000` (`mosquitto/mosquitto.conf`) |
| Baixo | Cliente pode publicar comandos retidos na própria casa | Só afeta a própria casa; app e site nunca usam retain |
| Baixo | Palavra-passe do admin como argumento do `domus.sh` | Feito: sem argumento, o `domus.sh` pede-a no terminal ou lê-a do stdin |
| Baixo | Notificações ntfy protegidas só pelo segredo do tópico (~103 bits) | Informativo |

## IBAN das devoluções por transferência (2026-10-02)

Um pagamento por referência Multibanco não se devolve pelo Stripe: o CEO faz uma transferência bancária e o cliente indica o IBAN na conta (docs/PAGAMENTOS-PEDIDO.md "Devoluções").

- **Onde fica:** só na linha dessa devolução (`devolucoes_pedido.iban` e `titular`, migração 26). Não vai para o pedido, para a conta nem para o pagamento.
- **Validação:** no servidor (`ibanPt`): "PT50" + 21 algarismos e módulo 97 (ISO 13616); a conta valida antes de enviar, mas o servidor não confia nela.
- **Quem o vê inteiro:** só o CEO, e só enquanto a devolução está "por fazer" (`GET /painel/api/pagamentos-pedido` → `devolucoes_por_fazer`). Na conta do cliente, na ficha do pedido (que o comercial vê) e depois de devolvido aparece mascarado ("PT50 •••• 0154").
- **Depois da transferência:** ao marcar "Devolvido" o IBAN guardado é trocado pela versão mascarada (ficam os 4 últimos algarismos, a data e quem marcou). Ao apagar a conta (RGPD) sai também o titular das devoluções já feitas; uma ainda por fazer guarda o IBAN até ser feita.
- **Nunca nos registos:** o IBAN não vai para a auditoria (`devolucao_iban` e `devolucao_feita` levam só o número da devolução e o valor), nem para o registo do servidor, nem para o email (o email de "devolução feita" leva o IBAN mascarado).
- **Só a conta dona** dá ou corrige o IBAN (`POST /api/conta/devolucoes/:id/iban`: 404 para as outras; CSRF e Origin como no resto de `/api/conta/*`).

## Eletricistas externos (2026-10-02, fase 4 ronda 1)

Módulo novo com uma terceira população de utilizadores (docs/ELETRICISTAS.md). O que foi verificado e como:

- **Sessão própria, isolada das outras duas.** Cookie `domus_eletricista` (HttpOnly, Secure fora de localhost, SameSite=Lax, `Path=/api/eletricista`), tabela `eletricistas_sessoes`, só o SHA-256 do token na base. Cada área procura o token só na sua tabela: uma sessão de eletricista dá 401 em `/api/conta/*` e em `/painel/api/*`, e as do painel e da conta dão 401 em `/api/eletricista/*`, mesmo com o token copiado para o cookie de outro tipo (teste com as nove combinações).
- **Só entra quem está aprovado**, e isso é verificado em cada pedido: suspender ou recusar apaga as sessões e os códigos. O pedido de código responde sempre o mesmo (não diz se o email é de um eletricista); o código (6 dígitos, 15 minutos, 5 tentativas, uso único) vai só no corpo do email e na base fica só o seu SHA-256.
- **Autorização no servidor em todas as rotas.** As do painel (`eletricistas*`, `orcamentos/:id/eletricista`) são só do CEO e entram na matriz de papéis (`painel/test/papeis.test.js`). Na área do eletricista, um trabalho que não é dele ou que não é dos seus concelhos dá 404.
- **Dados do cliente:** antes de aceitar não sai nada que o identifique nem nenhum preço; a resposta é montada campo a campo (nunca a linha do pedido), e um teste procura o nome, o telefone, a morada, o email, a mensagem, as notas e qualquer chave de preço nas respostas da bolsa. Depois de atribuído saem o nome, a morada e o telefone (nunca o email), só enquanto o trabalho está aberto.
- **Aceitar é atómico** (`UPDATE … WHERE estado = 'na_bolsa'`): dois pedidos ao mesmo tempo, um 200 e um 409.
- **Documento do seguro (upload):** só PDF, JPEG ou PNG; o tipo declarado tem de bater com os primeiros bytes (`%PDF-`, `FF D8 FF`, assinatura PNG); até 5 MB, verificado depois de descodificar. O nome do ficheiro do candidato nunca é usado (o nome em disco são 24 hex aleatórios). Fica em `ELETRICISTAS_DIR`, fora da pasta pública, e só sai por `GET /painel/api/eletricistas/:id/seguro` (CEO), com `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store` e, no PDF, `Content-Disposition: attachment` — nunca com um tipo que o navegador execute.
- **Candidatura pública:** limite de 5 por hora por IP e 100 por hora no total (contado antes de ler o corpo), campo-armadilha, `Origin` do site, validação no servidor de todos os campos (NIF com dígito de controlo, concelhos da lista), campos desconhecidos recusados (o candidato não consegue pôr `estado` nem `percentagem`). Um email repetido recebe a mesma resposta e não altera a candidatura que já existe.
- **Nada disto nos registos:** não se registam códigos, documentos nem dados dos candidatos; o aviso à empresa leva só o número da candidatura e os concelhos. No modo local (sem SMTP) os emails aparecem no terminal, como os da conta de cliente.
- **Por fazer:** apagar um eletricista a pedido (RGPD) ainda é manual; o NIF fica em claro na base, como os outros dados pessoais.

## Acesso rápido (só para testes, no computador do dono)

Na fase de testes, o lançador local (`local/iniciar.js`) deixa entrar sem palavra-passe com utilizadores de teste (CEO, Comercial, Técnico, Cliente de teste 1 e 2, Eletricista de teste): `POST /painel/api/dev/entrar`, `POST /api/conta/dev/entrar` e `POST /api/eletricista/dev/entrar` (`painel/src/acesso-rapido.js`) abrem uma sessão normal, com as permissões de sempre do papel. No servidor a sério isto não existe, por camadas: (1) as rotas só são ligadas com `ACESSO_RAPIDO=1`, que só o lançador local põe — o `servidor/docker-compose.yml` e o `.env.example` nunca (há um teste que o verifica); (2) mesmo com a variável, o painel recusa no arranque (erro no registo, fica desligado) se vir um sinal de servidor a sério: `NODE_ENV=production` (o `painel/Dockerfile` põe-no), `DOMUS_HOST`, falta de `EMAIL_LOCAL=1`, o painel a ouvir fora de `127.0.0.1` (`ANFITRIAO`) ou qualquer origem (`PAINEL_ORIGENS`, `SITE_ORIGENS`, `PUBLIC_URL`, `SITE_URL`) que não seja `http://` de `localhost` ou de um IP privado — uma origem `https://` chega para desligar; (3) desligado, as rotas dão 404 como qualquer endereço desconhecido; (4) ligado, só funciona no próprio computador: cada pedido tem de chegar ao painel por `127.0.0.1`, vir de `127.0.0.1`/`::1` e ter o `Host` e a `Origin` de `localhost`, `*.localhost`, `127.0.0.1` ou `[::1]` (senão 404), com a `Origin` do próprio site e em JSON, como os outros `POST`; (5) os botões são o `local/acesso-rapido.js`, que o lançador junta às páginas ao servi-las (só a pedidos de `localhost`): não está em `web/` nem em `painel/public/`, por isso o site publicado não tem o código nem faz pedido nenhum (em `web/` há só um ouvinte genérico em `conta-comum.js`, que relê a sessão da conta quando recebe o evento `domus:conta-sessao`). Os utilizadores de teste da equipa têm uma palavra-passe aleatória que não fica guardada (só o hash), e cada entrada fica na auditoria com `origem: acesso_rapido`. Não funciona pela rede: no endereço da rede local (`http://192.168.x.x:8090`, telemóvel no mesmo Wi-Fi) o lançador não junta a barra nem serve o `acesso-rapido.js`, e as duas rotas dão 404. Testes: `painel/test/acesso-rapido.test.js`.
