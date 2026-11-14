# Caixa em casa com Home Assistant

Decisões do dono (2026-11-14):
- a casa ganha uma **caixa** (Raspberry Pi com Home Assistant) para ter **dashboards e controlo sem internet**;
- os aparelhos **OpenBeken ligam-se à caixa**, e a caixa reencaminha tudo para o servidor (opancas.pt), por isso a app Domus continua igual;
- os **Shelly ficam ligados ao servidor**: o Home Assistant fala com eles diretamente pela rede de casa (integração Shelly nativa, sem cloud).

Decisões do dono, mais tarde no mesmo dia (uma pergunta de cada vez; **mudam** o papel do Home Assistant descrito acima):
- **o dashboard da Domus é a app Domus**, dentro e fora de casa; o cliente não usa o painel do Home Assistant, que fica escondido na caixa a trabalhar por trás (o painel "Casa Domus" da demonstração serve para nós);
- **sem internet, a app Android liga-se à caixa** no Wi-Fi de casa; a app web continua a precisar de internet (vem do opancas.pt). Feito em 2026-11-14, ver "App Android sem internet".
- **as automações e cenas continuam no servidor (motor)**: sem internet param, com o alarme e os avisos. O Home Assistant da caixa não leva automações do cliente, para não se contrariarem com as do motor.

Isto **muda** a decisão de outubro em `PROTOCOLO-MQTT-v3.md` §4 ("sem servidor em casa") e muda a "central Raspberry Pi" do plano Premium (`MONETIZACAO.md`, `PROTOCOLO-PLANOS.md`): a caixa é para qualquer cliente (decisão de 2026-11-14). Esses documentos ainda não foram atualizados.

## Como fica

```
 aparelhos OpenBeken ──MQTT──► caixa (Home Assistant + Mosquitto) ──ponte──► servidor opancas.pt ◄── app Domus, motor
 aparelhos Shelly ─────MQTT────────────────────────────────────────────────► servidor
         ▲                         │
         └── rede de casa ─────────┘  (Home Assistant fala com os Shelly diretamente)
```

A ponte é o Mosquitto da caixa ligado ao servidor com o utilizador `ponte-<cliente>`. Passa `domus/<cliente>/#` nos dois sentidos: o estado dos aparelhos sobe, os comandos da app descem. O ACL do servidor decide o que entra lá (ver abaixo).

## Sem internet

| Funciona | Não funciona |
|---|---|
| botões da parede (como hoje) | app Domus fora de casa e app web |
| app Android no Wi-Fi de casa, ligada à caixa: só os aparelhos OpenBeken | alarme, modos, cenas e automações do motor Domus |
| Home Assistant na rede de casa (só para nós, sem automações do cliente) | notificações |

Quando a internet volta, a ponte liga-se sozinha (5 a 30 s).

## Montar a caixa

1. Raspberry Pi 4/5 com **Home Assistant OS** (cartão ou SSD), ligado por cabo ao router.
2. Add-on **Mosquitto broker**:
   - `logins`: um para o HA, um por aparelho OpenBeken (palavras-passe novas, só para a casa) e o `app-<cliente>` que o `./domus.sh caixa --ip` imprime;
   - porta **1884** (WebSocket) aberta na rede de casa: é por ela que a app Android fala com a caixa;
   - `customize`: `{active: true, folder: mosquitto}`;
   - no servidor, `./domus.sh caixa <cliente>` imprime o [`caixa/ponte.conf`](../caixa/ponte.conf) já preenchido; copiá-lo para `/share/mosquitto/ponte.conf`.
3. Integração **MQTT** no HA, apontada para o add-on.
4. Cada OpenBeken: `MqttHost` = IP fixo da caixa, `MqttUser`/`MqttPassword` = o login local. O Client Topic fica `domus/<cliente>/<aparelho>`, como hoje. Depois, no OpenBeken, Config → Home Assistant → descoberta, para os aparelhos aparecerem no HA.
5. Cada Shelly: integração **Shelly** do HA (descobre pela rede). O MQTT do Shelly continua apontado ao servidor.
6. Reservar o IP da caixa no router (os aparelhos dependem dele).

## No servidor

1. **`./domus.sh caixa <cliente> --ip <IP da caixa>`** cria o utilizador `ponte-<cliente>` e imprime o `ponte.conf` já preenchido para copiar para a caixa. Com `--ip` (o IP fixo reservado no router; só endereços privados), cria também o login `app-<cliente>` da caixa, publica-o em `domus/<c>/_caixa` (retido) e imprime as linhas a juntar aos `logins` do add-on. `./domus.sh remover-caixa <cliente>` desfaz (e apaga o `_ponte` e o `_caixa` retidos). O ACL da ponte só deixa mexer nos aparelhos OpenBeken da casa e no `_ponte`, e ler a lista e a config (para a app ler a casa na caixa sem internet); nunca `_modo/set`, `_alarme/set`, `_plano`, nem ler `_ntfy`/`_historico`/`_caixa`:
   ```
   user ponte-<c>
   topic write domus/<c>/_ponte
   topic read domus/<c>/_aparelhos
   topic read domus/<c>/_config
   topic readwrite domus/<c>/<aparelho>/#     (um por OpenBeken)
   ```
   Fica fora do bloqueio dos clientes suspensos, como os aparelhos.

   **A ponte só liga por TLS, na porta 8883** (2026-11-14): o `ponte.conf` traz `address <servidor>:8883` e `bridge_capath /etc/ssl/certs`, por isso a caixa verifica o certificado do servidor (o nome e a autoridade). O `./domus.sh caixa` recusa-se a correr enquanto o servidor não tiver o TLS ativo. Ativar no servidor:
   - **`./domus.sh mqtt-tls`** copia o certificado que o Caddy já tem para o site (Let's Encrypt) para `mosquitto/certs/`, confere que a chave bate certo e que não expira dentro de uma hora, ativa `mosquitto/conf.d/tls.conf` e reinicia o Mosquitto. Se o Mosquitto não arrancar, volta ao que estava e diz porquê. Sem mudanças, não faz nada (nem reinicia);
   - o `domus-tls.timer` corre-o todas as noites (04:20), para apanhar os certificados que o Caddy renova; o `instalar.sh` (também com `--atualizar`) instala o temporizador e corre o comando depois de o site responder em HTTPS;
   - o `docker-compose.yml` publica a 8883; a firewall do fornecedor tem de a abrir (TCP 8883).
   **A confirmar na caixa:** que o add-on Mosquitto do HA tem as autoridades do sistema (com a da Let's Encrypt) em `/etc/ssl/certs`; no `eclipse-mosquitto:2` do teste tem.
2. **Motor**: sabe que um aparelho caiu pelo testamento (`connected`/`online`) de cada aparelho. Com a caixa, se a internet da casa cair, esses testamentos ficam na caixa. Por isso a ponte publica `domus/<c>/_ponte` = `1`/`0` (retido; `0` chega ~30 s depois da queda) e o motor, com `0`, põe todos os OpenBeken da casa offline (os Shelly não, estão ligados ao servidor). Com `1` não faz nada: cada aparelho volta a online na próxima mensagem dele, e daí vem o aviso "A casa esteve sem internet". Vazio = casa sem caixa.

**A verificar na bancada (Chayo):** depois de a internet voltar, quanto tempo demora o OpenBeken a mandar uma mensagem (até lá aparece offline).

3. **App e painel** (2026-11-14): com `_ponte` = `0`, a área de cliente (`web/estado.js`) e a app Android (`EstadoParser.kt`) mostram todos os OpenBeken da casa offline, diga o `connected` retido o que disser (os Shelly não mudam); não se podem tocar e a potência deles não conta. O painel dá **um** alerta da casa, "Caixa sem ligação" (alta), em vez de um por aparelho. Com `1` ou vazio volta tudo ao normal logo. Diferença curta: depois de `0`→`1` a app mostra os OpenBeken online logo (lê o `connected` que a ponte volta a mandar), mas o `_saude` do motor só os põe online na próxima mensagem de cada um.

4. **App Android sem internet** (2026-11-14, decisões do dono): a app guarda o `_caixa` cifrado (como a palavra-passe da sessão). Liga-se à caixa por WebSocket (`ws://<IP>:1884/mqtt`, login `app-<c>`) quando o servidor não responde há 8 s, ou quando o servidor diz `_ponte` = `0` (internet de casa em baixo, telemóvel com dados móveis). Com a caixa:
   - os OpenBeken mostram o estado que vem da caixa e comandam-se por ela; o `_ponte` e o `_caixa` que a caixa tenha não contam;
   - sem servidor, os Shelly aparecem offline (estão ligados ao servidor, não à caixa);
   - só os comandos dos aparelhos passam pela caixa; alarme, modos, cenas, automações e definições dão "Sem internet: em casa só dá para ligar e desligar os aparelhos…";
   - aparece a barra "Sem internet: ligado à caixa de casa…"; quando o servidor volta (e o `_ponte` não é `0`), a app larga a caixa.

   A app web não faz isto (vem do opancas.pt). Só os comandos dos OpenBeken vão pela caixa: os dos Shelly vão sempre ao servidor. Se a caixa recusar o login (cada `./domus.sh caixa --ip` gera uma palavra-passe nova: pôr logo a nova nos `logins` do add-on), a app desiste da caixa até voltar a ser aberta.

   `CaixaTest`, `EstadoParserTest` e `CaixaLigacaoTest` passam. Este último corre com `bash caixa/testar-app-caixa.sh` (dois Mosquitto em Docker, servidor e caixa): sem servidor desde o início; servidor ligado com `_ponte` `0` e depois `1`; e servidor parado e outra vez arrancado. **Nunca experimentado num telemóvel nem numa caixa a sério**:
   - num telemóvel com Wi-Fi de casa sem internet e dados móveis ligados, o Android pode mandar a ligação para os dados móveis em vez do Wi-Fi, e a caixa não se alcança;
   - que o add-on Mosquitto do HA aceita o login `app-<c>` e o WebSocket na 1884 como o Mosquitto do teste;
   - se o OpenBeken deixa o estado retido na caixa: se não, ao ligar à caixa os aparelhos só mostram o estado na mensagem seguinte deles.

**Caixa avariada com a internet a funcionar:** o `_ponte` passa a `0` na mesma, mas só os OpenBeken ficam offline. Se forem menos de metade dos aparelhos, não há o aviso único "Casa sem ligação", só um aviso por aparelho depois de `offline_min`.

## Riscos

- **Caixa avariada = casa sem app Domus** (os OpenBeken só têm um servidor). Os botões da parede continuam.
- A ponte caixa → servidor vai por TLS (8883). Os aparelhos que se ligam diretamente ao servidor (Shelly, OpenBeken sem caixa) continuam na 1883 sem cifra, como antes.
- Automações no HA e no motor sobre o mesmo aparelho podem contrariar-se. **Decidido (2026-11-14):** as do cliente ficam só no motor; o HA da caixa não leva automações do cliente.
- **Decidido (2026-11-14): fica assim.** Um cliente suspenso perde a app Domus pelo servidor, mas continua com controlo total pelo Home Assistant em casa, e a app Android dele, que já tinha guardado o login da caixa, continua a comandar os aparelhos pela caixa no Wi-Fi de casa (a caixa não conhece o `_plano`). Como os aparelhos dele, que também continuam a funcionar.
- O login `app-<c>` vai em `_caixa`, que o cliente lê, mas o painel e o motor também (leem `domus/#`). Só abre a caixa na rede de casa.
- A app tenta o IP da caixa em qualquer rede onde esteja (ex.: o Wi-Fi de outra casa com a mesma gama de endereços), e o login vai sem cifra (WebSocket simples). Só acontece quando o servidor não responde ou diz `_ponte` = `0`.
- Um telemóvel que esteja sem internet quando se faz `remover-caixa` não recebe o `_caixa` vazio e guarda o login antigo até voltar a ligar ao servidor.
- Lista para a fábrica (2026-11-08): sem mudanças. Que a descoberta do HA do OpenBeken funciona com os tópicos `domus/<c>/<aparelho>` está **a confirmar na bancada** (só há relatos de fóruns).
- **Decidido (2026-11-14):** a caixa é para qualquer cliente, não só para o plano Premium; o `./domus.sh caixa` não verifica o plano.

## Testar a ponte

```bash
bash caixa/testar-ponte.sh
```
Arranca dois Mosquitto em Docker (servidor com ACL como o `domus.sh` gera e TLS na 8883 com um certificado de uma autoridade de teste, e a caixa com o `ponte.conf` verdadeiro, a confiar nessa autoridade) e verifica: uma caixa que não confia na autoridade não liga (o certificado é mesmo verificado), estado sobe, comandos descem, sem mensagens repetidas, o histórico não desce, a caixa não consegue mudar o modo no servidor, e `_ponte` passa a `0` quando a casa fica sem internet.

Também verifica que a lista e a config ficam retidas na caixa (mesmo sem internet), que o `_caixa` não desce e que se lê a caixa por WebSocket: 12/12 em 2026-11-14 (antes, só com os 7 primeiros, 7/7). Passou 7/7 em 2026-11-14 (Mosquitto 2.1.2), incluindo "comando da app chega à caixa": a ponte não tem `read domus/<c>/#` no servidor, mas o Mosquitto aceita a subscrição `domus/<c>/#` e filtra mensagem a mensagem. O `servidor/testes/acl.sh` (com os casos do utilizador `ponte-joao`) e o `testes/simulacao.sh` passaram também num Debian em Docker (216/216 cada; depois do login da app, 218 e 223, sem falhas). O `testar-ponte.sh` precisa também do Node e dos módulos do `painel/` (o teste do WebSocket). Com TLS (2026-11-14): `testar-ponte.sh` 14/14, `acl.sh` 218 e `simulacao.sh` 228, sem falhas, e `servidor/testes/mqtt-tls.sh` 6/6 (Mosquitto do `docker-compose.yml` e um Caddy com certificado interno: volta atrás quando o TLS não arranca, ativa e a 8883 responde com o certificado certo, a segunda vez não reinicia). Este último correu no Docker Desktop do Windows, não num Linux como o servidor. Não testa o Home Assistant em si (dashboards, descoberta do OpenBeken, integração Shelly): isso só num Pi, ou num Home Assistant em Docker contra a casa `demo` do `local/`.

## Demonstração no PC

Para ver um dashboard sem Raspberry Pi: com o lançador local a correr (`cd local && npm start`) e o Docker aberto,
```bash
bash caixa/demo-ha.sh
```
Abre http://localhost:8123/casa-domus/casa e carrega em **Trusted Networks** (entra sem palavra-passe a partir deste PC; o login normal está em `local/dados/home-assistant-login.txt`, fora do git). O painel "Casa Domus" ([`caixa/demo-ha/casa.yaml`](../caixa/demo-ha/casa.yaml)) mostra a casa `casa-t1` por divisão: consumo, quadro, quarto, casa de banho, kitchenette e jardim. `bash caixa/demo-ha.sh parar` pára o contentor; `docker volume rm domus-ha-demo` apaga tudo.

**A casa `casa-t1` é a casa do dono** (2026-11-14): as divisões vêm da planta da conta dele no opancas.pt (T1: quarto, casa de banho, kitchenette, jardim; 6,9 kVA) e os aparelhos são os Tuya que ele está a instalar, já como ficarão depois de passarem a OpenBeken (respostas dele, uma a uma):

| Aparelho | Divisão | Comanda |
|---|---|---|
| disjuntor que mede (quadro, no quarto) | Quadro | casa toda + consumo, tensão, corrente, energia |
| interruptor 1 tecla | Quarto | teto (a 2.ª luz fica fora do programa) |
| interruptor 1 tecla | Casa de banho | teto (o espelho fica fora do programa) |
| interruptor 2 teclas | Kitchenette | teto, 2.ª luz |
| interruptor 1 tecla | Jardim | iluminação do jardim |
| 5 tomadas com medição | Quarto, Kitchenette, Jardim | televisão do quarto, televisão da kitchenette, máquina de lavar, frigorífico, termoacumulador (carga perigosa) |

Os aparelhos a fingir estão em `local/aparelhos-simulados.js` (`CASA_T1`) e arrancam com o lançador; na área de cliente entra-se em `cliente.html?codigo` com o código `casa-t1`. Ainda **não** é a casa a sério: os Tuya continuam na app Tuya até serem trocados para OpenBeken, e a conta dele no opancas.pt ainda não tem casa ligada.

Visto a funcionar em 2026-11-14 (Home Assistant em pt), primeiro com a casa `demo` e depois com a `casa-t1`: ligar no HA muda a app Domus e o contrário; na `demo`, brilho do LED e posição do estore chegam ao aparelho. **O que não mostra:**
- não passa pela caixa nem pela ponte: o HA fala diretamente com o broker local;
- os aparelhos estão escritos à mão em [`caixa/demo-ha/configuration.yaml`](../caixa/demo-ha/configuration.yaml); a descoberta automática do OpenBeken continua **a confirmar na bancada**;
- a integração Shelly não aparece (as casas de teste só têm aparelhos OpenBeken a fingir);
- as proteções das cenas e automações da app para o quadro geral e as cargas perigosas (confirmação, máximo 4 h ligada) não existem no HA: lá, uma automação pode deixar o termoacumulador ligado sem limite. Entra na regra "HA e motor" por decidir.

## Aparelhos da casa do dono (2026-11-14)

O dono tem hubs Tuya / Smart Life. Primeiro ficou que os aparelhos eram todos Bluetooth (e iam ligar à caixa por
Bluetooth); depois o dono corrigiu: **só a fechadura é Bluetooth, o resto é Wi-Fi**. Decisões (uma pergunta de cada vez):

- **Aparelhos Wi-Fi** (interruptores de parede, tomadas, o disjuntor que mede no quadro): **trocar para OpenBeken**,
  como no Chayo, e ligá-los à caixa. Volta a decisão de antes; a de "Bluetooth direto da caixa" deixa de valer para eles.
  Perde-se a garantia; alguns modelos só se trocam abrindo o aparelho (ver na bancada, um a um).
- **Fechadura Bluetooth**: **só mostrar o estado** (trancada/aberta e bateria) na app Domus, com avisos. Abrir e
  trancar continua na app Tuya ou na chave: o programa nunca abre a porta.

Ainda por fazer e por saber:
- Os modelos Wi-Fi: que chip têm (decide se a troca para OpenBeken se faz pelo Wi-Fi ou abrindo o aparelho).
- O modelo da fechadura: se o Home Assistant da caixa a consegue ler por Bluetooth sem a nuvem Tuya (com as chaves
  tiradas uma vez da conta), e o alcance do Bluetooth do Pi até à porta.
- Como o estado da fechadura chega a `domus/<c>/<aparelho>/...` para a app Domus e o motor (hoje só os OpenBeken e
  os Shelly falam MQTT); só leitura, sem tópico de comando.
- A casa a fingir `casa-t1` continua a servir para ver as divisões e o dashboard; os ids dos aparelhos ficam os mesmos
  quando houver os verdadeiros.
