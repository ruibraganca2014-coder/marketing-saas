# App do cliente

A "app" do cliente é a área de cliente do site (`web/cliente.html`), instalável no telemóvel. Não há app nativa nas lojas. Os ficheiros são `web/cliente.html`, `web/cliente.js`, `web/estado.js` (lógica sem DOM), `web/cenas.js`, `web/styles.css` (regras `.app-cliente`) e `web/manifest.json`.

## Decisões do dono

1. **Web instalável, sem service worker de páginas (2026-10-09).** A área de cliente ganha um ícone no ecrã do telemóvel e abre sem a barra do navegador (`manifest.json`, `display: standalone`). Não há service worker, de propósito: com ele o telemóvel podia ficar a mostrar páginas velhas guardadas em cache depois de uma publicação, e a casa (alarme, luzes) tem de mostrar sempre o estado verdadeiro. O preço é não funcionar sem internet (sem ligação não há estado para mostrar de qualquer maneira). O único service worker é o dos avisos (decisão 3), que não guarda nada.
2. **Notificações pela app ntfy (2026-10-12).** Continua, agora como alternativa (decisão 3).
3. **Avisos da própria app por web push, como canal principal (2026-10-14).** O ntfy fica como alternativa e continua a receber tudo o que recebia. Os mesmos avisos que o ntfy (alarme disparado com prioridade máxima, porta aberta com o alarme ligado, aparelho sem ligação, pilhas a acabar, ações "Enviar notificação" das automações) e a mesma regra do plano. No iPhone só funciona com a app instalada no ecrã principal (iOS 16.4 ou mais recente), e a app explica-o.

## Entrar

A mesma conta dos pedidos ([CONTA-CLIENTE.md](CONTA-CLIENTE.md)): email com palavra-passe, ou email com um código de 6 algarismos. Com a casa ligada à conta abre a casa; sem casa ligada abre a pré-visualização (a planta e o andamento do pedido). "Entrar com o código de cliente" fica de reserva em `cliente.html?codigo`.

## Instalar

- **Android (Chrome):** o botão "Instalar" do cabeçalho aparece quando o navegador o permite (`beforeinstallprompt`) e abre o pedido de instalação do próprio Chrome.
- **iPhone (Safari):** o Safari não tem pedido automático. O botão "Instalar" abre uma janela na página com os passos: abrir no Safari, "Partilhar", "Adicionar ao ecrã principal", "Adicionar".
- Com a app já a correr instalada (`display-mode: standalone` ou `navigator.standalone`) o botão não aparece.

## No telemóvel

- **Separadores** Casa, Automações, Aparelhos e Histórico. Até 620 px de largura ficam presos em baixo, com 48 px de altura; em ecrãs largos ficam no cimo, como antes. A Subscrição, as Definições e o Relatório da casa não têm separador (abrem-se pelos botões do cabeçalho da casa e do separador Casa); a barra continua à vista para voltar.
- **Entalhe e barra inferior do iPhone:** `viewport-fit=cover` e `env(safe-area-inset-*)` no cabeçalho, nos separadores e no aviso (toast). Num ecrã sem entalhe nada muda.
- **Religar:** o sistema suspende a página em segundo plano e a ligação cai. Ao voltar (`visibilitychange`, `online`, e `pageshow` quando a página volta da memória do navegador no iPhone) liga-se logo, no máximo uma vez em cada 3 segundos.

## Notificações

Dois caminhos, com o mesmo texto e a mesma prioridade, só nos planos com notificações ([PROTOCOLO-PLANOS.md](PROTOCOLO-PLANOS.md)); nos outros o cartão aparece com o cadeado. O motor envia para os dois ao mesmo tempo, e uma falha num nunca impede o outro (`motor/src/notificacoes.js` `criarNotificador`).

O cartão **"Receber avisos no telemóvel"** está no separador Casa, por baixo das cenas (fechado ocupa uma linha). O Histórico tem uma ligação para ele. Primeiro os avisos da app; por baixo, "Alternativa (iPhone sem a app instalada, ou se preferir a app ntfy)".

### Avisos da app (web push, o caminho principal)

Caminho: **motor → serviço de push do navegador (Google, Apple, Mozilla, Microsoft) → `web/sw.js` → aviso no telemóvel**, mesmo com a app fechada.

- **Botão "Ativar avisos neste telemóvel"** ("neste computador" num computador). O telemóvel pergunta se autoriza; com "Permitir" a app regista o service worker, subscreve e envia a subscrição ao motor. Depois aparece "Desativar avisos neste telemóvel". Sair da conta também desativa os avisos nesse telemóvel (telemóvel partilhado).
- **O que o cartão diz** (`web/estado.js` `estadoAvisos`): pronto a ativar; ativo; bloqueado pelo telemóvel (como voltar a permitir nas definições); **iPhone sem a app instalada** ("os avisos só chegam com a app Domus instalada no ecrã principal, iOS 16.4 ou mais recente", com o botão "Como instalar no iPhone" que abre a janela de instalação); iPhone com iOS antigo; navegador sem suporte (ex.: a página aberta por `http://` na rede local); indisponível (o servidor ainda não tem chaves).
- **Toque no aviso:** abre a app (ou volta a ela) no separador **Histórico** (`cliente.html#historico`).
- **Alarme disparado:** vibra com força e fica no ecrã até lhe tocarem (`requireInteraction`); urgência "high" no serviço de push e validade de 1 hora. Os outros avisos têm urgência normal e validade de 1 dia.
- **`web/sw.js` só serve para isto:** sem `fetch` e sem cache (decisão 1 mantida; um teste do painel confirma). Só é registado quando o cliente ativa os avisos, ou já estava registado.

**No servidor** (`motor/src/webpush.js`, biblioteca `web-push` para a cifra e a assinatura):
- **Subscrições:** a app envia-as ao motor por MQTT em `domus/<c>/_webpush/registar` (como o `_fcm/registar`), pela mesma ligação autenticada da casa; a ACL só deixa cada cliente escrever na sua casa. O motor guarda-as no seu estado (`dados/motor/estado.json`), uma por telemóvel (o endpoint), no máximo 10 por casa (sai a mais antiga). A cada ligação a app volta a registar a sua (idempotente). Quando o serviço de push responde 404/410 (app desinstalada, autorização retirada) a subscrição é apagada.
- **Contra SSRF:** o servidor faz um pedido para o endereço que vem do navegador, por isso só aceita `https://` sem porta nem utilizador, até 1024 caracteres, em serviços de push conhecidos (`HOSTS_PUSH`: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.push.apple.com`, `*.notify.windows.com`). O endpoint nunca vai para o registo nem para tópicos retidos.
- **Chaves VAPID:** criadas pelo motor no primeiro arranque em `dados/motor/vapid.json` (modo 600), nunca no registo, no git nem no `.env`; entram nas cópias de segurança com o resto de `dados`. Se o ficheiro se estragar, o web push fica desligado (sem trocar a chave em silêncio) e o erro fica no registo. A chave pública chega à app em `domus/<c>/_webpush` (retido): `{"chave": "...", "total": 2}`. Se as chaves mudarem, a app renova a subscrição sozinha.
- **Contacto VAPID:** `WEBPUSH_CONTACTO=https://<DOMUS_HOST>` (docker-compose.yml).
- **Publicar:** nada a fazer à mão. O `instalar.sh --atualizar` reconstrói o motor (instala a `web-push`), o motor cria as chaves e a ACL nova (`_webpush/registar`) entra sozinha no minuto seguinte (`domus.sh sincronizar-planos`).

### App ntfy (a alternativa)

Caminho: **motor → ntfy → app ntfy no telemóvel**. O motor publica cada aviso no tópico ntfy da casa; o endereço do tópico chega à área de cliente em `domus/<cliente>/_ntfy` (retido, criado pelo `domus.sh`). Três passos:

1. Instalar a app ntfy (Google Play ou App Store).
2. Juntar a casa à app:
   - **Android:** botão "Abrir na app ntfy", com a ligação `ntfy://<servidor>/<tópico>` (`web/estado.js` `ligacaoNtfy`). A documentação do ntfy só garante esta ligação na app Android.
   - **iPhone:** não há ligação direta garantida. Fica o endereço com o botão "Copiar" e a explicação de como o pôr na app à mão.
   - **Computador:** um código QR com a mesma ligação `ntfy://`, para apontar um telemóvel Android (o gerador é o das fotos pelo telemóvel, `web/simulador/qr.js`).
3. Experimentar: uma automação com a ação "Enviar notificação".

O endereço do tópico é um **segredo da casa** (quem o tiver recebe os avisos): a ligação e o código QR são feitos no navegador; o endereço não vai em endereços de páginas nossas, em parâmetros nem em registos.

**Não há "Enviar um aviso de teste".** O motor e o protocolo MQTT não têm um pedido para isso; fazê-lo pede uma alteração ao protocolo, que fica para decidir.

## Por testar num telemóvel real

- **Xiaomi (problema em aberto):** a instalação ficou parada em "A instalar a app Domus…" e desistiu. Causa por isolar (Chrome ou navegador da Xiaomi, WebAPK, ícones do manifesto, poupança de bateria da MIUI).
- iPhone com entalhe: cabeçalho, separadores em baixo e aviso sem ficarem tapados, de pé e deitado; a janela "Instalar no iPhone"; a app aberta pelo ícone.
- Separadores em baixo com o teclado aberto (ao escrever numa automação ou numa cena).
- Android: o botão "Abrir na app ntfy" com a app instalada e sem ela; o código QR lido pela câmara (nem todas as câmaras abrem ligações `ntfy://`).
- iPhone: juntar a casa à app ntfy à mão, com o servidor e o tópico do endereço.
- Voltar à app depois de muito tempo em segundo plano: religa sozinha e o estado fica certo.
- Avisos da app no Android (Chrome) e no iPhone instalado (iOS 16.4+): ativar, receber com a app fechada, o alarme a vibrar e a ficar no ecrã, o toque a abrir o Histórico, desativar. No computador (Chrome) foi verificado de ponta a ponta pelo serviço da Google em 2026-10-14; num telemóvel ainda não.
- iPhone no Safari sem a app instalada: aparece a explicação e o botão "Como instalar no iPhone".
