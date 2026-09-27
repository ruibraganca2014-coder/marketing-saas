# Servidor Domus Energia — guia passo a passo

Este guia instala, num servidor na internet (VPS), tudo o que a plataforma Domus Energia precisa:

| Serviço | Para que serve | Endereço |
|---|---|---|
| **Mosquitto** | servidor MQTT: os aparelhos, a app e o site ligam-se aqui | `HOST:1883` (aparelhos) e `wss://HOST/mqtt` (app e site) |
| **Caddy** | HTTPS automático (certificados grátis) e site | `https://HOST/` |
| **ntfy** | notificações no telemóvel (app ntfy) | `https://ntfy.HOST/` |
| **motor** | alarme, automações, histórico, notificações (ntfy e Firebase) | interno |

Contratos: [`../docs/PROTOCOLO-MQTT.md`](../docs/PROTOCOLO-MQTT.md) (v1), [`../docs/PROTOCOLO-MQTT-v2.md`](../docs/PROTOCOLO-MQTT-v2.md) (v2) e [`../docs/PROTOCOLO-MQTT-v3.md`](../docs/PROTOCOLO-MQTT-v3.md) (v3).

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

A pasta `servidor/` tem de ficar ao lado de `web/` e `motor/` (o Caddy serve `../web` e o motor é construído a partir de `../motor`).

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
docker compose ps          # os 4 serviços devem estar "running"/"Up"
docker compose logs -f caddy   # (Ctrl+C para sair) deve aparecer "certificate obtained successfully"
```

Abre `https://<DOMUS_HOST>/` no browser: deve aparecer o site com cadeado.

> Enquanto não criares o utilizador `motor` (passo 7) o motor vai tentar ligar-se e falhar: é normal.

## 7. Criar o administrador e o motor

```bash
./domus.sh admin          # pede a palavra-passe (duas vezes, sem a mostrar)
```

A palavra-passe também pode vir do stdin (`printf '%s\n' "$SENHA" | ./domus.sh admin`) ou, como antes, no argumento (`./domus.sh admin 'UmaSenhaDeAdminLonga'`) — mas assim fica no histórico da shell (`~/.bash_history`), por isso prefere a pergunta.

Na primeira vez isto também cria o utilizador **`motor`** no Mosquitto e no ntfy com as senhas do `.env`. Se mudares essas senhas no `.env`, corre `./domus.sh motor` e depois `docker compose up -d motor`.

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
- `./testes/simulacao.sh` — opções dos aparelhos, JSON de `_aparelhos`, comandos impressos e ACL gerada, em modo simulação (`DOMUS_DRY_RUN=1`; só precisa de `python3`).

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

Tudo o que importa está em `servidor/dados/` (clientes, aparelhos, palavra-passe do admin, estado do motor, conta Firebase, utilizadores do ntfy, mensagens retidas do Mosquitto), `servidor/mosquitto/seguranca/` (palavras-passe MQTT) e `servidor/.env`.

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
  - `motor` e `admin`: lê e escreve `domus/#`.
- Removendo um aparelho, a ligação dele é cortada e a palavra-passe deixa de funcionar.
- O site e a área de cliente são servidos com `X-Frame-Options: DENY` e uma `Content-Security-Policy` (scripts só do próprio site e do `cdn.jsdelivr.net`; ligações só ao próprio site, ao `wss://HOST/mqtt` e ao Supabase; nenhuma página pode ser posta num `<iframe>`). Se mudar de CDN, de fontes ou de projeto Supabase, atualize a linha `Content-Security-Policy` em `caddy/Caddyfile`.
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

## Resolução de problemas

| Problema | O que ver |
|---|---|
| O site não abre / sem certificado | `docker compose logs caddy`; portas 80/443 abertas no painel **e** no servidor; `DOMUS_HOST` correto |
| Aparelho não liga | `docker compose logs -f mosquitto` mostra `not authorised` (utilizador/palavra-passe) ou nada (porta 1883 fechada/host errado) |
| App/site não liga | `wss://HOST/mqtt`, utilizador = código do cliente |
| Sem notificações ntfy | `docker compose logs motor`; correu `./domus.sh motor`? tópico certo na app? |
| "outra execução do domus.sh está em curso" | espera que o outro comando termine |
