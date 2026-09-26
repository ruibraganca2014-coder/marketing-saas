# Servidor Domus Energia — guia passo a passo

Este guia instala, num servidor na internet (VPS), tudo o que a plataforma Domus Energia precisa:

| Serviço | Para que serve | Endereço |
|---|---|---|
| **Mosquitto** | servidor MQTT: os aparelhos, a app e o site ligam-se aqui | `HOST:1883` (aparelhos) e `wss://HOST/mqtt` (app e site) |
| **Caddy** | HTTPS automático (certificados grátis) e site | `https://HOST/` |
| **ntfy** | notificações no telemóvel (app ntfy) | `https://ntfy.HOST/` |
| **motor** | alarme, automações, histórico, notificações (ntfy e Firebase) | interno |

Contratos: [`../docs/PROTOCOLO-MQTT.md`](../docs/PROTOCOLO-MQTT.md) (v1) e [`../docs/PROTOCOLO-MQTT-v2.md`](../docs/PROTOCOLO-MQTT-v2.md) (v2).

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
./domus.sh admin 'UmaSenhaDeAdminLonga'
```

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
# Disjuntor com medição (Chayo/Tongou com OpenBeken), um canal
./domus.sh aparelho joao quadro openbeken "Quadro geral" --medidor

# Interruptor de parede de 4 teclas
./domus.sh aparelho joao sala-4g openbeken "Interruptor sala" \
  --canais "1:interruptor:Teto,2:interruptor:Candeeiro,3:interruptor:Varanda,4:interruptor:Corredor"

# Sensor de porta a pilhas (Tuya reprogramado com OpenBeken)
./domus.sh aparelho joao porta-entrada openbeken "Porta de entrada" --canais "1:porta,2:bateria" --bateria

# Sensor de movimento a pilhas
./domus.sh aparelho joao pir-corredor openbeken "Movimento corredor" --canais "1:movimento,2:bateria" --bateria

# Shelly: estore, luz regulável, relé com medição
./domus.sh aparelho joao estore-quarto shelly "Estore quarto" --canais "1:estore"
./domus.sh aparelho joao led-cozinha shelly "LED cozinha" --canais "1:luz"
./domus.sh aparelho joao ac-sala shelly "Ar condicionado sala" --medidor
```

- Funções de canal: `interruptor`, `luz`, `estore`, `porta`, `movimento`, `bateria`. Sem `--canais` o aparelho tem um canal `interruptor` n.º 1.
- Ids e códigos: letras minúsculas, dígitos e `-` (máx. 32).
- O script **imprime as instruções exatas** para configurar o aparelho (OpenBeken ou Shelly), incluindo servidor, porta, tópico, utilizador e palavra-passe. Guarda-as: a palavra-passe não volta a ser mostrada (correr de novo o mesmo comando gera outra e **substitui** a configuração do aparelho).

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

Para testar as permissões sem Docker (no PC de desenvolvimento, precisa de `mosquitto` e `mosquitto-clients`): `./testes/acl.sh`.

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

- **A porta 1883 não é cifrada.** Os disjuntores e interruptores com chip BK7231 (OpenBeken) não têm TLS fiável, por isso os aparelhos usam MQTT simples. Mitigações: cada aparelho tem **utilizador e palavra-passe próprios** e só pode ler/escrever no seu prefixo `domus/<cliente>/<aparelho>/#` (ACL); ninguém anónimo entra.
- A app e o site usam sempre **HTTPS/WSS** (porta 443, certificado automático).
- Permissões (geradas pelo `domus.sh`, nunca editar à mão):
  - cliente `C`: lê `domus/C/#`; escreve apenas `domus/C/+/+/set`, `domus/C/+/led_dimmer/set`, `domus/C/+/rpc`, `domus/C/+/command`, `domus/C/+/command/+`, `domus/C/_alarme/set`, `domus/C/_automacoes/set`, `domus/C/_fcm/registar`. Não consegue escrever `_aparelhos`, `_alarme`, `_automacoes`, `_historico`, `_eventos` nem `_ntfy`, nem nada de outro cliente (verificado em `testes/acl.sh`);
  - aparelho `C-A`: lê e escreve `domus/C/A/#`;
  - `motor` e `admin`: lê e escreve `domus/#`.
- Removendo um aparelho, a ligação dele é cortada e a palavra-passe deixa de funcionar.
- **Próximo passo recomendado:** ativar MQTT com TLS na porta **8883** para os Shelly (que suportam TLS), deixando a 1883 só para os OpenBeken; e, a prazo, restringir a 1883 por firewall aos IPs das casas dos clientes quando forem fixos.
- Mantém o sistema atualizado (`sudo apt-get update && sudo apt-get upgrade`) e usa só login SSH por chave.

## Resolução de problemas

| Problema | O que ver |
|---|---|
| O site não abre / sem certificado | `docker compose logs caddy`; portas 80/443 abertas no painel **e** no servidor; `DOMUS_HOST` correto |
| Aparelho não liga | `docker compose logs -f mosquitto` mostra `not authorised` (utilizador/palavra-passe) ou nada (porta 1883 fechada/host errado) |
| App/site não liga | `wss://HOST/mqtt`, utilizador = código do cliente |
| Sem notificações ntfy | `docker compose logs motor`; correu `./domus.sh motor`? tópico certo na app? |
| "outra execução do domus.sh está em curso" | espera que o outro comando termine |
