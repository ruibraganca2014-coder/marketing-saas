# Servidor Domus Energia — guia passo a passo

Este guia instala, num servidor na internet (VPS), tudo o que a plataforma Domus Energia precisa:

| Serviço | Para que serve | Endereço |
|---|---|---|
| **Mosquitto** | servidor MQTT: os aparelhos, a app e o site ligam-se aqui | `HOST:1883` (aparelhos) e `wss://HOST/mqtt` (app e site) |
| **Caddy** | HTTPS automático (certificados grátis) e site | `https://HOST/` |
| **ntfy** | notificações no telemóvel (app ntfy) | `https://ntfy.HOST/` |
| **motor** | alarme, automações, histórico, notificações (ntfy e Firebase) | interno |
| **pagamentos** | subscrições mensais (Stripe) e estado do plano de cada cliente | `https://HOST/api/` e `https://HOST/stripe/webhook` |
| **painel** | painel interno da empresa (clientes, alertas, orçamentos, obras, equipa) e formulário público de orçamento | `https://HOST/painel/`, `https://HOST/api/orcamento` e `https://HOST/api/catalogo` |

Contratos: [`../docs/PROTOCOLO-MQTT.md`](../docs/PROTOCOLO-MQTT.md) (v1), [`../docs/PROTOCOLO-MQTT-v2.md`](../docs/PROTOCOLO-MQTT-v2.md) (v2) e [`../docs/PROTOCOLO-MQTT-v3.md`](../docs/PROTOCOLO-MQTT-v3.md) (v3); planos e pagamentos: [`../docs/PROTOCOLO-PLANOS.md`](../docs/PROTOCOLO-PLANOS.md); painel da empresa: [`../docs/PAINEL-EMPRESA.md`](../docs/PAINEL-EMPRESA.md).

Não é preciso saber Docker: basta copiar e colar os comandos pela ordem.

---

## 1. Arranjar um VPS

Qualquer VPS com Linux (Ubuntu 22.04/24.04 ou Debian 12), 1 GB de RAM e um IP público serve. Duas opções:

- **Oracle Cloud "Always Free"** (grátis): cria conta em cloud.oracle.com → *Compute → Instances → Create instance* → imagem **Ubuntu 24.04**, forma **VM.Standard.A1.Flex** (ARM, 1 OCPU / 6 GB chega) ou VM.Standard.E2.1.Micro. Guarda a chave SSH que te dão.
- **Hetzner Cloud CX22** (cerca de 4 €/mês, mais simples): console.hetzner.cloud → *Add Server* → localização Falkenstein/Nuremberg/Helsínquia → **Ubuntu 24.04** → **CX22** → adiciona a tua chave SSH.

Aponta o **IP público** do VPS (ex.: `51.38.10.20`) e entra nele:

```bash
ssh ubuntu@51.38.10.20      # Oracle (utilizador "ubuntu")
ssh root@51.38.10.20        # Hetzner (utilizador "root")
```

## 2. Abrir as portas (firewall)

Portas necessárias: **80** e **443** (HTTPS, TCP; 443 também UDP para HTTP/3) e **1883** (MQTT dos aparelhos, TCP). A porta **22** (SSH) tem de continuar aberta.

**No painel do fornecedor:**
- Oracle: *Networking → Virtual Cloud Networks → (a tua VCN) → Security Lists → Default → Add Ingress Rules*: origem `0.0.0.0/0`, TCP, portas `80,443,1883`.
- Hetzner: *Firewalls → Create Firewall*: regras de entrada TCP 22, 80, 443, 1883 (e UDP 443) → aplicar ao servidor.

**No próprio servidor.** A imagem Ubuntu da Oracle traz regras `iptables` que bloqueiam tudo; abre as portas assim:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 1883 -j ACCEPT
sudo netfilter-persistent save
```

Na Hetzner (Ubuntu sem firewall ativa) não é preciso fazer nada aqui. Se usares o `ufw`: `sudo ufw allow 22,80,443,1883/tcp && sudo ufw allow 443/udp`.

## 3. Instalar o Docker e o git

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y git
sudo usermod -aG docker "$USER"    # para usar o docker sem sudo
exit                               # sai e volta a entrar por ssh
```

Confirma: `docker compose version` deve mostrar uma versão.

## 4. Copiar o projeto

```bash
git clone <endereço-do-repositório> domus-energia
cd domus-energia/servidor
```

A pasta `servidor/` tem de ficar ao lado de `web/`, `motor/` e `pagamentos/` (o Caddy serve `../web`; o motor e o serviço de pagamentos são construídos a partir de `../motor` e `../pagamentos`).

## 5. Configurar o `.env`

```bash
cp .env.example .env
nano .env
```

- **`DOMUS_HOST`** — sem domínio, usa o IP com hífenes + `.sslip.io`: IP `51.38.10.20` → `DOMUS_HOST=51-38-10-20.sslip.io`. O [sslip.io](https://sslip.io) é gratuito e não precisa de registo; o nome das notificações `ntfy.51-38-10-20.sslip.io` também funciona sozinho.
  Com domínio próprio (ex.: `mqtt.domusenergia.pt`) cria **dois** registos DNS do tipo **A** para o IP do VPS: `mqtt.domusenergia.pt` e `ntfy.mqtt.domusenergia.pt`.
- **`MOTOR_MQTT_PASS`** e **`NTFY_MOTOR_PASS`** — duas palavras-passe longas e diferentes. Gera-as com `openssl rand -hex 16`.

Grava com `Ctrl+O`, `Enter`, `Ctrl+X`.

## 6. Arrancar

```bash
mkdir -p dados             # cria a pasta de estado com o teu utilizador (antes do Docker)
docker compose up -d --build
docker compose ps          # os 5 serviços devem estar "running"/"Up"
docker compose logs -f caddy   # (Ctrl+C para sair) deve aparecer "certificate obtained successfully"
```

Abre `https://<DOMUS_HOST>/` no browser: deve aparecer o site com cadeado.

> Enquanto não criares o utilizador `motor` (passo 7) o motor vai tentar ligar-se e falhar: é normal.

## 7. Criar o administrador e o motor

```bash
./domus.sh admin          # pede a palavra-passe (duas vezes, sem a mostrar)
```

A palavra-passe também pode vir do stdin (`printf '%s\n' "$SENHA" | ./domus.sh admin`) ou, como antes, no argumento (`./domus.sh admin 'UmaSenhaDeAdminLonga'`) — mas assim fica no histórico da shell (`~/.bash_history`), por isso prefere a pergunta.

Na primeira vez isto também cria o utilizador **`motor`** no Mosquitto e no ntfy com as senhas do `.env` e, se houver `PAGAMENTOS_MQTT_PASS` no `.env`, o utilizador **`pagamentos`** (ver [Planos e pagamentos](#16-planos-e-pagamentos)). Se mudares essas senhas no `.env`, corre `./domus.sh motor` (ou `./domus.sh pagamentos`) e depois `docker compose up -d motor pagamentos`.

```bash
docker compose restart motor
docker compose logs -f motor     # deve ligar-se ao MQTT
```

## 8. Criar clientes e aparelhos

```bash
./domus.sh cliente joao                 # gera a palavra-passe e mostra-a
./domus.sh cliente joao 'SenhaDoJoao'   # ou escolhe-a tu (também serve para a mudar)
```

O resultado mostra o login da app/site e o **tópico ntfy** do cliente.

Aparelhos (`<cliente> <id> <tipo> "<Nome>" [opções] [palavra-passe]`):

```bash
# Disjuntor com medição (Chayo/Tongou com OpenBeken), um canal. --geral: é o
# medidor geral da casa — o consumo total (app, relatório, _energia) passa a
# ser a soma dos medidores gerais, e não de todos os medidores (que contaria
# duas vezes os circuitos que também têm medição própria, ex. o termoacumulador)
./domus.sh aparelho joao quadro openbeken "Quadro geral" --medidor --geral

# Interruptor de parede de 4 teclas na Sala: o Teto entra na simulação de
# férias e volta ao último estado depois de um corte; a Varanda fica noutra divisão
./domus.sh aparelho joao sala-4g openbeken "Interruptor sala" --divisao Sala \
  --canais "1:interruptor:Teto:simular:arranque=ultimo,2:interruptor:Candeeiro,3:interruptor:Varanda:divisao=Varanda,4:interruptor:Corredor"

# Sensor da porta de entrada a pilhas (alarme com atraso de entrada)
./domus.sh aparelho joao porta-entrada openbeken "Porta de entrada" --bateria --divisao Hall \
  --canais "1:porta:Porta entrada:entrada,2:bateria"

# Sensor de movimento (PIR) a pilhas
./domus.sh aparelho joao pir-corredor openbeken "Movimento corredor" --bateria --divisao Corredor \
  --canais "1:movimento,2:bateria"

# Termoacumulador num Shelly com medição: carga perigosa (fica desligado
# depois de um corte e o próprio Shelly desliga-o ao fim de 4 h)
./domus.sh aparelho joao termo shelly "Termoacumulador" --medidor --divisao Cozinha \
  --canais "1:interruptor:Termo:carga=perigosa"

# Luz do jardim com simulação de presença nas férias
./domus.sh aparelho joao jardim shelly "Luz do jardim" --divisao Jardim \
  --canais "1:interruptor:Jardim:simular:arranque=ultimo"

# Shelly: estore, luz regulável
./domus.sh aparelho joao estore-quarto shelly "Estore quarto" --canais "1:estore" --divisao Quarto
./domus.sh aparelho joao led-cozinha shelly "LED cozinha" --canais "1:luz"
```

**Como se escreve `--canais`:** um canal por vírgula; dentro de cada canal os campos separam-se por `:` — primeiro o número, depois a função, depois (opcional) o nome e as opções, por qualquer ordem:

| Opção | Onde | O que faz |
|---|---|---|
| `entrada` | só `porta` | porta de entrada: ao abrir com o alarme ligado há tempo para desarmar |
| `simular` | só `interruptor` e `luz` | liga/desliga ao acaso à noite no modo **férias** |
| `arranque=desligado` / `ligado` / `ultimo` | `interruptor`, `luz`, `estore` | como fica depois de um corte de luz. **Por omissão `desligado`.** `ultimo` só em `interruptor`/`luz` sem carga perigosa; os estores ficam sempre parados (`desligado`) |
| `carga=perigosa` | `interruptor`, `luz`, `estore` | aquecedor, termoacumulador, bomba, motor: nunca `ultimo`; as automações só o ligam com tempo limite (máx. 4 h); nos Shelly o próprio aparelho desliga-o ao fim de 4 h |
| `divisao=Texto` | todos | divisão da casa desse canal (substitui `--divisao`) |

- `--divisao "Sala"` dá a divisão a todos os canais do aparelho (os que não tenham `divisao=`). A divisão agrupa os aparelhos no relatório e na app.
- Funções de canal: `interruptor`, `luz`, `estore`, `porta`, `movimento`, `bateria`. Sem `--canais` o aparelho tem um canal `interruptor` n.º 1 (desligado depois de um corte). Números de canal: 1 a 64 (o mesmo limite do motor e das apps).
- `--medidor` = o aparelho mede potência/energia; `--geral` (só com `--medidor`) marca-o como medidor geral da casa (`"geral": true` em `_aparelhos`).
- Nomes e divisões não podem ter `:` nem `,`. Se precisar de um canal sem nome mas com opções, escreva só as opções (`1:porta:entrada`) ou deixe o nome vazio (`1:porta::entrada`).
- Combinações proibidas (ex.: `entrada` num interruptor, `arranque=ultimo` com `carga=perigosa`) são recusadas com uma explicação e nada é gravado.
- Ids e códigos: letras minúsculas, dígitos e `-` (máx. 32).
- O script **imprime as instruções exatas** para configurar o aparelho, incluindo servidor, porta, tópico, utilizador e palavra-passe, **e as regras que ficam no próprio aparelho** (ver [Funcionar sem internet](#15-funcionar-sem-internet)): no OpenBeken, as linhas `SetStartValue` para o `autoexec.bat` e como ligar o botão ao relé; no Shelly, os endereços `http://<ip>/rpc/...` para colar no browser. Guarda-as: a palavra-passe não volta a ser mostrada (correr de novo o mesmo comando gera outra e **substitui** a configuração do aparelho).

Outros comandos:

```bash
./domus.sh listar                        # clientes e aparelhos
./domus.sh remover-aparelho joao quadro  # apaga o aparelho e as mensagens retidas dele
./domus.sh acl                           # regenera as permissões (raramente preciso)
./domus.sh ajuda
```

## 9. Testar

Instala os clientes MQTT (no VPS ou no teu PC): `sudo apt-get install -y mosquitto-clients`.

```bash
# Ver tudo o que o cliente joao vê (Ctrl+C para sair)
mosquitto_sub -h <DOMUS_HOST> -p 1883 -u joao -P 'SenhaDoJoao' -t 'domus/joao/#' -v

# Ligar o canal 1 do aparelho "quadro" (OpenBeken)
mosquitto_pub -h <DOMUS_HOST> -p 1883 -u joao -P 'SenhaDoJoao' -t 'domus/joao/quadro/1/set' -m 1

# Ligar o alarme
mosquitto_pub -h <DOMUS_HOST> -p 1883 -u joao -P 'SenhaDoJoao' -t 'domus/joao/_alarme/set' -m '{"ativo":true}'
```

Deves ver `domus/joao/_aparelhos` (lista), `domus/joao/_ntfy` e, com os aparelhos ligados, `.../connected online` ou `.../online true`. Sem utilizador/palavra-passe a ligação é recusada.

Testes sem Docker (no PC de desenvolvimento):
- `./testes/acl.sh` — permissões num Mosquitto verdadeiro (precisa de `mosquitto` e `mosquitto-clients`);
- `./testes/simulacao.sh` — opções dos aparelhos, JSON de `_aparelhos`, comandos impressos, ACL gerada e os comandos `plano`/`sincronizar-planos`/`pagamentos`, em modo simulação (`DOMUS_DRY_RUN=1`; só precisa de `python3`);
- `cd ../pagamentos && npm ci && npm test` — serviço de pagamentos (Mosquitto real + Stripe falso; precisa de Node 20+ e `mosquitto`).

## 10. Notificações no telemóvel (ntfy)

1. Instala a app **ntfy** (Google Play / F-Droid / App Store).
2. **+** → *Subscribe to topic* → ativa **Use another server** → servidor `https://ntfy.<DOMUS_HOST>`.
3. Tópico: o que o `./domus.sh cliente` mostrou (ex.: `domus-joao-9f3k2...`). A app e o site Domus também mostram este endereço (vem de `domus/<cliente>/_ntfy`).

Segurança do ntfy: qualquer pessoa pode **subscrever** um tópico se souber o nome — por isso cada nome tem um segredo aleatório de 20 caracteres. Só o utilizador **`motor`** pode **publicar** (permissão *write-only* em `domus-*`). Não partilhes o tópico.

O ntfy vive no subdomínio `ntfy.HOST` porque **não suporta** ser servido num sub-caminho como `/ntfy`. Endereços antigos `https://HOST/ntfy/<tópico>` são redirecionados para `https://ntfy.HOST/<tópico>`.

## 11. Notificações Firebase (FCM) para a app Android — opcional

O motor envia também notificações push pela Firebase se encontrar a conta de serviço. Sem ela, o FCM fica desligado sem erro.

1. Vai a [console.firebase.google.com](https://console.firebase.google.com) → **Adicionar projeto** (ex.: `domus-energia`); o Google Analytics pode ficar desligado.
2. No projeto: **Adicionar app → Android**, com o *package name* da app Domus; descarrega o `google-services.json` e entrega-o a quem compila a app Android.
3. ⚙️ **Definições do projeto → Contas de serviço → Firebase Admin SDK → Gerar nova chave privada** → descarrega o ficheiro `.json`.
4. Copia-o para o servidor, com este nome exato:

   ```bash
   # no teu PC
   scp ~/Downloads/domus-energia-firebase-adminsdk-xxxx.json ubuntu@51.38.10.20:~/domus-energia/servidor/dados/motor/firebase-service-account.json
   # no servidor
   chmod 600 dados/motor/firebase-service-account.json
   docker compose restart motor
   ```

   (No contentor do motor, este ficheiro aparece como `/dados/firebase-service-account.json`.)
5. Este ficheiro é uma chave secreta: nunca o ponhas no git nem o envies por email.

## 12. Cópias de segurança

Tudo o que importa está em `servidor/dados/` (clientes, aparelhos, palavra-passe do admin, estado do motor, conta Firebase, utilizadores do ntfy, mensagens retidas do Mosquitto, planos dos clientes em `dados/planos/`, o registo dos pagamentos `dados/pagamentos/pagamentos.csv` e a base de dados do painel da empresa `dados/painel/`), `servidor/mosquitto/seguranca/` (palavras-passe MQTT) e `servidor/.env`.

```bash
cd ~/domus-energia/servidor
sudo tar czf ~/domus-backup-$(date +%F).tar.gz dados mosquitto/seguranca .env
```

Copia o ficheiro para fora do VPS (ex.: `scp ubuntu@51.38.10.20:domus-backup-*.tar.gz .`). Para uma cópia diária automática: `sudo crontab -e` e acrescenta
`15 3 * * * cd /home/ubuntu/domus-energia/servidor && tar czf /root/domus-backup-$(date +\%u).tar.gz dados mosquitto/seguranca .env`
(guarda os últimos 7 dias). Para repor: parar (`docker compose down`), extrair o `.tar.gz` na pasta `servidor/` e `docker compose up -d`.

## 13. Atualizar

```bash
cd ~/domus-energia && git pull
cd servidor && docker compose pull && docker compose up -d --build
```

## 14. Segurança — o que saber

- **A porta 1883 não é cifrada: o utilizador e a palavra-passe de cada aparelho passam em texto simples** (e também os estados e comandos). Quem conseguir escutar a rede entre a casa e o VPS (Wi-Fi da casa, operador) pode ler essas credenciais e fazer-se passar por esse aparelho. Os disjuntores e interruptores com chip BK7231 (OpenBeken) não têm TLS fiável, por isso usam MQTT simples. Mitigações:
  - cada aparelho tem **utilizador e palavra-passe próprios** e só pode ler/escrever no seu prefixo `domus/<cliente>/<aparelho>/#` (ACL): uma credencial roubada só dá acesso a esse aparelho, nunca à casa nem ao alarme; ninguém anónimo entra;
  - se suspeitar de uma credencial, corra de novo `./domus.sh aparelho …` (gera outra e corta a antiga);
  - **Shelly: use a porta 8883 com TLS** (ver [MQTT com TLS](#mqtt-com-tls-porta-8883-opcional));
  - quando as casas tiverem IP fixo, restrinja a 1883 na firewall a esses IPs (ex. `sudo ufw allow from 85.240.1.2 to any port 1883 proto tcp` em vez de aberta a todos).
- A app e o site usam sempre **HTTPS/WSS** (porta 443, certificado automático).
- Permissões (geradas pelo `domus.sh`, nunca editar à mão):
  - cliente `C`: lê `domus/C/#`; escreve apenas
    - comandos para os **seus** aparelhos `A`: `domus/C/A/+/set` (inclui `led_dimmer/set`), `domus/C/A/rpc`, `domus/C/A/command`, `domus/C/A/command/+` — uma linha por aparelho, sem `+` no lugar do aparelho, para que nada como `domus/C/_automacoes/admin/set` fique aberto;
    - pedidos ao motor: `_alarme/set`, `_automacoes/set`, `_fcm/registar`, `_config/set`, `_modo/set`, `_cenas/set`, `_cenas/executar`, `_automacoes/executar`, `_presenca/set`.

    Não consegue escrever `_aparelhos`, `_alarme`, `_automacoes`, `_historico`, `_eventos`, `_ntfy`, `_config`, `_modo`, `_cenas`, `_saude`, `_energia`, `_presenca`, `_automacoes/registo`, `_automacoes/avisos`, `_automacoes/admin`, nem nada de outro cliente (verificado em `testes/acl.sh`);
  - aparelho `C-A`: lê e escreve `domus/C/A/#`;
  - `motor` e `admin`: lê e escreve `domus/#`;
  - `pagamentos`: só escreve `domus/+/_plano` (não lê nada). Nenhum cliente nem aparelho escreve `_plano`;
  - cliente **suspenso ou cancelado** (`dados/planos/<c>.json`): só lê `domus/<c>/_plano` — não comanda nada nem vê a casa; os utilizadores dos aparelhos dele não mudam (ver [Planos e pagamentos](#16-planos-e-pagamentos)).
- Removendo um aparelho, a ligação dele é cortada e a palavra-passe deixa de funcionar.
- O site e a área de cliente são servidos com `X-Frame-Options: DENY` e uma `Content-Security-Policy` (scripts só do próprio site e do `cdn.jsdelivr.net`; ligações só ao próprio site — incluindo `/api/orcamento` — e ao `wss://HOST/mqtt`; nenhuma página pode ser posta num `<iframe>`). O painel (`/painel/`) envia ainda uma CSP própria mais apertada (sem CDN). Se mudar de CDN ou de fontes, atualize a linha `Content-Security-Policy` em `caddy/Caddyfile`.
- O painel da empresa (§17) não tem as palavras-passe do servidor: só lê o MQTT (utilizador `painel`) e pede alterações por ficheiros que o `./domus.sh processar-pedidos` valida à risca antes de executar.
- Limites do Mosquitto (`mosquitto/mosquitto.conf`): `max_connections 2000` (ligações simultâneas de aparelhos + app + site; subir se a empresa passar de ~1500 aparelhos) e `max_packet_size` de 1 MB (o motor nunca publica mais de 900 KB, `MQTT_MAX_PAYLOAD`).

### MQTT com TLS (porta 8883, opcional)

Para os aparelhos que suportam TLS (Shelly Gen2/Gen3). Os OpenBeken continuam na 1883. Sem este passo o servidor funciona como antes.

1. Certificado: o mais simples é reutilizar o do Caddy (o mesmo `HOST`). Copie-o para `mosquitto/certs/` (a pasta não vai para o git):
   ```bash
   cd ~/domus-energia/servidor
   sudo mkdir -p mosquitto/certs
   D=/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMUS_HOST
   docker compose cp caddy:$D/$DOMUS_HOST.crt mosquitto/certs/fullchain.pem
   docker compose cp caddy:$D/$DOMUS_HOST.key mosquitto/certs/privkey.pem
   ```
   (se o Caddy usou a ZeroSSL, a pasta é `acme.zerossl.com-v2-dv90`: veja com `docker compose exec caddy ls /data/caddy/certificates`). O Caddy renova o certificado a cada ~60 dias: repita a cópia uma vez por mês no `crontab` do root, seguida de `docker compose restart mosquitto`.
2. Ative a porta: `cp mosquitto/conf.d/tls.conf.exemplo mosquitto/conf.d/tls.conf` e, no `docker-compose.yml`, tire o `#` da linha `- "8883:8883"`.
3. Abra a porta **8883/TCP** na firewall (painel do fornecedor e `ufw`/`iptables`, como no passo 2) e reinicie: `docker compose up -d mosquitto`.
4. No Shelly: *Settings → MQTT*: Server `HOST:8883`, ativar **Use SSL** (com verificação do certificado, "Default CA"). O resto (utilizador, palavra-passe, prefixo) fica igual.
5. Teste: `mosquitto_sub -h <DOMUS_HOST> -p 8883 --capath /etc/ssl/certs -u joao -P 'SenhaDoJoao' -t 'domus/joao/#' -v`.
- Mantém o sistema atualizado (`sudo apt-get update && sudo apt-get upgrade`) e usa só login SSH por chave.

## 15. Funcionar sem internet

O servidor está na internet. Se a casa ficar sem internet (ou o servidor em baixo), a casa **continua a funcionar como uma casa normal**, porque o essencial fica guardado **no próprio aparelho** quando o instalamos (o `./domus.sh aparelho` imprime o que é preciso configurar).

**O que continua a funcionar sem internet**
- **Interruptores de parede e botões dos aparelhos.** A tecla liga e desliga a luz diretamente, dentro do próprio aparelho — não passa pelo servidor. No OpenBeken isto consegue-se pondo o botão e o relé no mesmo canal; no Shelly com a entrada em modo `follow`/`flip`. É assim que funcionam o disjuntor Tongou e os interruptores de parede.
- **O estado depois de um corte de luz.** Cada saída tem a sua regra, guardada no aparelho: fica **desligada** (por omissão), **ligada**, ou volta ao **último estado** (só para iluminação). Aquecedores, termoacumuladores, bombas e motores ficam sempre desligados quando a luz volta.
- **O limite de segurança das cargas perigosas nos Shelly.** O próprio Shelly desliga o termoacumulador (ou outra carga perigosa) ao fim de 4 horas, mesmo sem internet.
- Os aparelhos voltam a ligar-se sozinhos ao servidor quando a internet regressa.

**O que NÃO funciona sem internet**
- **O alarme** (armar, desarmar, disparar e avisar).
- **As automações e cenas que envolvem mais do que um aparelho** (ex.: "movimento no corredor acende a luz da sala"), horários e simulação de férias.
- **As notificações** no telemóvel e o controlo pela app ou pelo site fora de casa. A app mostra "Sem ligação ao servidor".

Quando a internet volta, o sistema envia um aviso do tipo "A casa esteve sem internet de HH:MM a HH:MM".

**Na instalação, teste sempre:** desligar o router e usar os interruptores (têm de funcionar); cortar a corrente 10 segundos no quadro e ver se cada saída arranca como combinado; repetir depois de cada atualização do firmware.

## 16. Planos e pagamentos

Contrato: [`../docs/PROTOCOLO-PLANOS.md`](../docs/PROTOCOLO-PLANOS.md). Detalhes do serviço: [`../pagamentos/README.md`](../pagamentos/README.md).

| Plano | Preço (c/ IVA) |
|---|---|
| Base | 4,99 €/mês |
| Conforto | 9,99 €/mês |
| Premium | 19,99 €/mês |

Cada cliente tem um estado de subscrição, publicado pelo servidor em `domus/<cliente>/_plano` (retido): `ativo`, `teste` (1.º mês grátis), `em_atraso` (pagamento falhou; **15 dias** de aviso), `suspenso` ou `cancelado` (**modo básico**: os interruptores e os aparelhos continuam a funcionar, mas a app e o site só mostram o ecrã da subscrição e o motor não corre automações, cenas, alarme nem notificações). Um cliente sem `_plano` (clientes antigos) é tratado como Conforto ativo.

Há duas maneiras de gerir:
- **Automática (Stripe)**: o cliente escolhe o plano na app/site → paga no Stripe Checkout → o Stripe avisa o serviço `pagamentos` (webhook) → `_plano` atualizado. Mudar de plano, trocar o cartão, cancelar e ver faturas: Stripe Customer Portal.
- **Manual** (clientes que pagam por transferência, ofertas, testes): `./domus.sh plano`.

### 16.1 Conta Stripe (comece em modo de teste)

1. Crie a conta em [dashboard.stripe.com](https://dashboard.stripe.com/register) com os dados da empresa (Portugal, EUR). Enquanto a conta não estiver ativada, e para ensaiar, use o **modo de teste** (interruptor "Test mode"/"Sandbox" no painel): as chaves começam por `sk_test_` e nenhum cartão é cobrado.
2. **Produtos e preços** — *Product catalog → Add product*, três vezes:
   - "Domus Base": preço **recorrente mensal** de **4,99 EUR**; em *Tax behavior* escolha **Inclusive** (o preço já tem IVA);
   - "Domus Conforto": 9,99 EUR/mês (inclusive); "Domus Premium": 19,99 EUR/mês (inclusive).
   Copie o id de cada preço (`price_…`) para `STRIPE_PRICE_BASE`, `STRIPE_PRICE_CONFORTO` e `STRIPE_PRICE_PREMIUM` no `.env`. Não ponha o período grátis no preço: é o serviço que o pede (`DIAS_TESTE`, 30 dias, só na primeira subscrição de cada cliente).
3. **Chave secreta** — *Developers → API keys → Secret key* (`sk_test_…`) → `STRIPE_SECRET_KEY`. Melhor ainda: uma *restricted key* (`rk_…`) com escrita em *Checkout Sessions* e *Customer portal* e leitura em *Subscriptions*.
4. **Webhook** — *Developers → Webhooks → Add endpoint*:
   - URL: **`https://<DOMUS_HOST>/stripe/webhook`**
   - versão da API: a mais recente (o serviço aceita também as anteriores a 2025-03);
   - eventos: **`checkout.session.completed`**, **`customer.subscription.created`**, **`customer.subscription.updated`**, **`customer.subscription.deleted`**, **`invoice.paid`**, **`invoice.payment_failed`**.
   Depois de criar, *Reveal signing secret* (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
5. **Customer Portal** — *Settings → Billing → Customer portal*:
   - ligar **Invoices** (histórico de faturas), **Payment methods** (atualizar o cartão), **Cancel subscriptions** (recomendado: *At end of billing period*);
   - ligar **Customers can switch plans** e acrescentar os **três produtos/preços** (sem isto o botão "Mudar de plano" abre só a página inicial do portal); proration à escolha (ex.: *Prorate charges and credits*);
   - *Business information*: nome, termos e política de privacidade; *Save*.
6. **Pagamentos falhados** — *Settings → Billing → Subscriptions and emails → Manage failed payments*: ligar os **Smart Retries** (até 2–3 semanas) e, no fim, *cancel the subscription*; ligar os emails ao cliente para cartões recusados/expirados. Independentemente das tentativas do Stripe, o serviço suspende o cliente 15 dias depois da primeira falha (`em_atraso` → `suspenso`); quando o pagamento entra volta a `ativo`.
7. **Branding** — *Settings → Branding*: logótipo e cores (aparecem no Checkout e no portal).
8. Quando estiver tudo testado: ative a conta, repita os passos 2–5 no **modo real** (os ids mudam: `sk_live_…`, novos `price_…` e `whsec_…`), atualize o `.env` e `docker compose up -d pagamentos`.

**Métodos de pagamento — MB WAY:** segundo a documentação do Stripe, o **MB WAY só serve para pagamentos únicos**: não permite guardar o método nem cobranças recorrentes, por isso **não pode ser usado nas subscrições mensais** (Checkout em modo `subscription`). Por omissão o serviço pede só **cartão** (`STRIPE_METODOS=card`). Alternativas com cobrança automática: **Débito Direto SEPA** (IBAN português; `STRIPE_METODOS=card,sepa_debit`, ativar em *Settings → Payment methods*; a confirmação demora alguns dias) ou `STRIPE_METODOS=automatico` (o Stripe mostra os métodos ativos no painel que servem para subscrições). O MB WAY pode ser usado para o pagamento único da instalação (ex.: um *Payment Link*), fora deste serviço. Confirme em [docs.stripe.com/payments/mb-way](https://docs.stripe.com/payments/mb-way) se isto mudou antes de o prometer a clientes; se o Stripe passar a aceitar MB WAY em subscrições, basta `STRIPE_METODOS=card,mb_way`.

### 16.2 Configurar o servidor

No `.env` (ver `.env.example`):

```bash
PAGAMENTOS_MQTT_PASS=...        # openssl rand -hex 16
SESSAO_SEGREDO=...              # openssl rand -hex 32
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASE=price_...
STRIPE_PRICE_CONFORTO=price_...
STRIPE_PRICE_PREMIUM=price_...
# PUBLIC_URL=https://...        (por omissão https://DOMUS_HOST)
```

```bash
./domus.sh pagamentos                  # cria o utilizador MQTT "pagamentos" (se o admin já existia)
mkdir -p dados/planos dados/pagamentos             # antes do Docker (senão ficam do root)
sudo chown 1000:1000 dados/planos dados/pagamentos # o serviço corre como uid 1000 (o domus.sh faz isto quando corre como root)
docker compose up -d --build pagamentos caddy
docker compose logs -f pagamentos      # "MQTT: ligado como pagamentos" e "_plano republicado ..."
```

Sem as variáveis `STRIPE_*` o serviço arranca na mesma (a sessão e o `_plano` funcionam; checkout, portal e webhook respondem "ainda não configurados"). O Caddy encaminha `https://HOST/api/*` e `https://HOST/stripe/webhook` para o serviço (mesma origem do site: a CSP e o CORS não mudam).

**Permissões dos suspensos (a cada minuto).** O serviço de pagamentos grava `dados/planos/<cliente>.json`; quem tira ou devolve as permissões MQTT é o `./domus.sh sincronizar-planos`, que regenera a ACL e recarrega o Mosquitto **só quando alguma coisa mudou** (sem alterações não escreve nada). Instale **um** destes:

```bash
# systemd (recomendado)
sed -i "s#/home/ubuntu/domus-energia/servidor#$PWD#g" systemd/domus-planos.service
sudo cp systemd/domus-planos.service systemd/domus-planos.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now domus-planos.timer
systemctl list-timers domus-planos.timer         # próxima execução
journalctl -u domus-planos.service -n 20         # o que fez

# ou cron (alternativa)
sed "s#/home/ubuntu/domus-energia/servidor#$PWD#g" systemd/domus-planos.cron | sudo tee /etc/cron.d/domus-planos >/dev/null
sudo chmod 644 /etc/cron.d/domus-planos           # registo em /var/log/domus-planos.log
```

Um cliente suspenso fica com a ACL `topic read domus/<c>/_plano` (a app/site continuam a entrar e mostram "Subscrição suspensa" com "Reativar subscrição"); os utilizadores dos aparelhos **não mudam**, por isso os interruptores, os estados e os comandos do motor/admin continuam. Qualquer outro comando do `domus.sh` que regenere a ACL (`acl`, `aparelho`, …) respeita também os planos.

### 16.3 Gestão manual

```bash
./domus.sh plano joao conforto                     # ativo (por omissão), gerido "manual"
./domus.sh plano joao base --estado teste
./domus.sh plano joao conforto --estado em_atraso  # aviso de 15 dias (aviso_ate)
./domus.sh plano joao conforto --estado suspenso   # modo básico (permissões tiradas logo)
./domus.sh plano joao conforto --estado cancelado
./domus.sh plano joao conforto --gerido stripe     # devolve a gestão ao Stripe
./domus.sh listar                                  # mostra o plano de cada cliente
```

O comando grava `dados/planos/<cliente>.json` com `"gerido": "manual"`, publica `domus/<cliente>/_plano` (retido) e ajusta a ACL na hora. Um cliente "manual" não é alterado pelos eventos do Stripe (exceto se ele próprio fizer um novo checkout); se tiver uma subscrição no Stripe, a cobrança continua até a cancelar no painel do Stripe (o script avisa). Um `em_atraso` manual também passa a `suspenso` ao fim de 15 dias (serviço pagamentos).

### 16.4 Testar em modo de teste

1. Na área de cliente: *A minha subscrição → Mudar de plano* → Checkout com o cartão de teste **4242 4242 4242 4242** (data futura, CVC qualquer). O `_plano` passa a `teste` (30 dias grátis).
2. Pagamento falhado: cartão **4000 0000 0000 0341** (aceita guardar, recusa cobrar) numa subscrição sem teste, ou no portal trocar para esse cartão e usar um **Test clock** (*Billing → Test clocks*) para avançar para o fim do teste/período → `em_atraso` com aviso de 15 dias.
3. Com a [Stripe CLI](https://docs.stripe.com/stripe-cli): `stripe events resend <evt_…>` volta a enviar um evento (o serviço reconhece os repetidos) e `stripe listen --forward-to https://<DOMUS_HOST>/stripe/webhook` mostra os eventos em direto (usa um `whsec_` próprio: ponha-o temporariamente no `.env`).
4. Em *Developers → Webhooks → (endpoint)* veja as respostas: 200 = tratado; 400 = assinatura errada (`STRIPE_WEBHOOK_SECRET`); 500 = erro (ver `docker compose logs pagamentos`; o Stripe repete durante 3 dias).

### 16.5 Faturação (obrigatória em Portugal)

**As faturas e recibos do Stripe não são faturas certificadas pela AT.** Cada pagamento tem de ter uma **fatura-recibo emitida num programa de faturação certificado** (ex.: InvoiceXpress, Moloni, Vendus, TOConline), com o NIF do cliente quando ele o pedir. Nesta fase o serviço regista cada pagamento (`invoice.paid`) em **`dados/pagamentos/pagamentos.csv`** (`data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe`, IVA 23 %) para o contabilista emitir as faturas; a ligação automática ao programa certificado fica para a fase seguinte (depende do programa que o contabilista usar). Reembolsos (notas de crédito) não entram no CSV: trate-os à mão. Guarde o CSV nas cópias de segurança (§12).

## 17. Painel da empresa

Contrato: [`../docs/PAINEL-EMPRESA.md`](../docs/PAINEL-EMPRESA.md). Detalhes do serviço e da API: [`../painel/README.md`](../painel/README.md).

Painel web interno em **`https://HOST/painel/`** para a equipa, com três papéis: **`ceo`** (tudo, incluindo receitas, pagamentos, equipa e catálogo), **`tecnico`** (as suas obras, alertas técnicos, clientes sem dados financeiros) e **`comercial`** (pedidos de orçamento, clientes com plano e estado, agenda de obras só de leitura). Toda a autorização é verificada no servidor. Os pedidos de orçamento do site (`POST https://HOST/api/orcamento`) e o catálogo público do simulador (`GET https://HOST/api/catalogo`) também são deste serviço (o Supabase deixou de ser usado).

**O painel não tem as palavras-passe do servidor** (nem do admin, nem dos clientes). Monta só `dados/painel` (a base de dados SQLite `painel.db`) e `dados/pedidos-admin` com escrita, e `dados/planos`, `dados/pagamentos` e `dados/clientes` **só de leitura**. Liga-se ao Mosquitto como `painel`, que a ACL **só deixa ler** `domus/#` (alertas técnicos). Para criar clientes, aparelhos ou mudar planos escreve um pedido em `dados/pedidos-admin/`, que o temporizador do VPS executa com `./domus.sh processar-pedidos` (ver 17.2).

### 17.1 Instalar

No `.env` (ver `.env.example`):

```bash
PAINEL_MQTT_PASS=...            # openssl rand -hex 16
# Só no primeiro arranque (ou use ./domus.sh painel-utilizador, abaixo):
# PAINEL_CEO_EMAIL=ceo@exemplo.pt
# PAINEL_CEO_PASS=...           # mín. 10 caracteres; APAGUE as duas linhas depois
# PAINEL_ORIGENS=https://www.domusenergia.pt   # só se o site também abrir noutro endereço
```

```bash
sudo ./domus.sh painel-mqtt            # utilizador MQTT "painel" (só leitura); o "admin" da 1.ª vez já o cria
sudo ./domus.sh listar                 # como root: prepara dados/painel, dados/pedidos-admin e as permissões
docker compose up -d --build painel caddy
docker compose logs -f painel          # "MQTT: ligado como painel (só leitura)" e "painel à escuta"
sudo ./domus.sh painel-utilizador ceo@exemplo.pt ceo "Nome da CEO"   # pede a palavra-passe (2 vezes)
```

O `painel-utilizador` escreve um pedido que o serviço painel aplica em poucos segundos (cria o utilizador ou, se o email já existe, muda-lhe o papel e a palavra-passe e fecha as sessões dele). Os outros utilizadores criam-se no próprio painel (CEO → Equipa). Entre em `https://HOST/painel/`.

**Donos e permissões** (o `domus.sh` trata disto quando corre como root — use `sudo`): o serviço corre como uid 1000; `dados/painel` é do uid 1000 (modo 700); `dados/pedidos-admin` é `root:1000` com modo **1770** (o painel cria e apaga os seus ficheiros, mas não mexe em `feitos/`, que é do root); `dados/clientes` fica com o grupo 1000 e os `.tsv` com modo 640 (o painel lê os aparelhos; os segredos `.ntfy` continuam 600, só do root).

### 17.2 Pedidos ao servidor (temporizador)

O mesmo temporizador do `sincronizar-planos` (§16.2) corre também, a cada minuto, `./domus.sh processar-pedidos` (os ficheiros `systemd/domus-planos.service` e `systemd/domus-planos.cron` já têm os dois passos; se instalou a versão anterior, volte a copiá-los e faça `sudo systemctl daemon-reload`).

| Tipo (`dados/pedidos-admin/<id>.json`) | Pedido no painel | Comando executado |
|---|---|---|
| `cliente` | CEO/comercial: novo cliente, ou "Converter" um orçamento aceite | `./domus.sh cliente <codigo> <palavra-passe gerada>` (recusado se o cliente já existe: o painel nunca muda palavras-passe de clientes) |
| `aparelho` | CEO/técnico, na ficha do cliente | `./domus.sh aparelho <cliente> <id> <tipo> "<nome>" [--canais …] [--divisao …] [--medidor] [--geral] [--bateria] <palavra-passe gerada>` |
| `remover-aparelho` | CEO/técnico | `./domus.sh remover-aparelho <cliente> <id>` |
| `plano` | CEO | `./domus.sh plano <cliente> <plano> --estado <estado>` |
| `painel-utilizador` | — (escrito pelo `./domus.sh painel-utilizador`, aplicado pelo painel) | — |

O resultado vai para `dados/pedidos-admin/<id>.resultado.json` (**modo 600**, com a palavra-passe gerada e as instruções de configuração do aparelho) e o pedido para `dados/pedidos-admin/feitos/`. O painel mostra o resultado **uma única vez** a quem fez o pedido (ou ao CEO) e apaga o ficheiro logo a seguir; resultados nunca vistos são apagados ao fim de 7 dias. Os pedidos vêm de um serviço exposto à internet, por isso o `processar-pedidos` é desconfiado: só aceita exatamente o JSON que o painel escreve (chaves por ordem, textos sem aspas, `\` nem caracteres de controlo, nomes que não começam por `-`), move cada pedido para uma pasta só do root (`dados/.pedidos-em-curso/`) antes de o ler (symlinks, hard links, pastas e ficheiros com mais de 16 KB são recusados), passa os valores como argumentos separados (nunca `eval`/`sh -c`) e escreve os resultados por `rename` (um symlink pré-criado é substituído, nunca seguido). Um pedido cuja execução foi interrompida (ex.: o VPS reiniciou) não é repetido: fica com um resultado de erro para confirmar à mão. Recusas e resultados ficam no registo do temporizador (`journalctl -u domus-planos.service` ou `/var/log/domus-planos.log`).

### 17.3 Cópias de segurança e manutenção

- Copie `dados/painel/` (base de dados: utilizadores, orçamentos, obras, catálogo, auditoria) com as outras pastas de `dados/` (§12). Para uma cópia consistente com o serviço a correr: `docker compose exec painel node -e "new (require('node:sqlite').DatabaseSync)('/dados/painel/painel.db').exec(\"VACUUM INTO '/dados/painel/copia.db'\")"` e copie `copia.db`.
- `dados/pedidos-admin/feitos/` só tem os pedidos (sem palavras-passe); pode apagar os antigos.
- Atualizar: `git pull && docker compose up -d --build painel` (as migrações da base de dados correm sozinhas no arranque).

## Resolução de problemas

| Problema | O que ver |
|---|---|
| O site não abre / sem certificado | `docker compose logs caddy`; portas 80/443 abertas no painel **e** no servidor; `DOMUS_HOST` correto |
| Aparelho não liga | `docker compose logs -f mosquitto` mostra `not authorised` (utilizador/palavra-passe) ou nada (porta 1883 fechada/host errado) |
| App/site não liga | `wss://HOST/mqtt`, utilizador = código do cliente |
| Sem notificações ntfy | `docker compose logs motor`; correu `./domus.sh motor`? tópico certo na app? |
| "outra execução do domus.sh está em curso" | espera que o outro comando termine |
| Checkout/portal dizem "ainda não configurados" | faltam variáveis `STRIPE_*` no `.env` (ver `docker compose logs pagamentos`); depois `docker compose up -d pagamentos` |
| O Stripe mostra erros 400 no webhook | `STRIPE_WEBHOOK_SECRET` não é o do endpoint (teste e real têm segredos diferentes) |
| O plano não muda depois de pagar | `docker compose logs pagamentos`; eventos selecionados no webhook (§16.1); utilizador MQTT `pagamentos` criado (`./domus.sh pagamentos`) |
| Cliente suspenso continua a comandar | o temporizador `domus-planos.timer` (ou o cron) está instalado? `sudo ./domus.sh sincronizar-planos` |
| "Mudar de plano" abre só a página inicial do portal | ligar "Customers can switch plans" com os três preços no Customer Portal (§16.1) |
