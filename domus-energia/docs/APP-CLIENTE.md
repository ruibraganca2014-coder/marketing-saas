# App do cliente

A "app" do cliente é a área de cliente do site (`web/cliente.html`), instalável no telemóvel. Não há app nativa nas lojas. Os ficheiros são `web/cliente.html`, `web/cliente.js`, `web/estado.js` (lógica sem DOM), `web/cenas.js`, `web/styles.css` (regras `.app-cliente`) e `web/manifest.json`.

## Decisões do dono

1. **Web instalável, sem service worker (2026-10-09).** A área de cliente ganha um ícone no ecrã do telemóvel e abre sem a barra do navegador (`manifest.json`, `display: standalone`). Não há service worker, de propósito: com ele o telemóvel podia ficar a mostrar páginas velhas guardadas em cache depois de uma publicação, e a casa (alarme, luzes) tem de mostrar sempre o estado verdadeiro. O preço é não funcionar sem internet (sem ligação não há estado para mostrar de qualquer maneira) e não ter notificações próprias (ver "Notificações").
2. **Notificações pela app ntfy, sem web push (2026-10-12).** Ver "Notificações".

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

Caminho: **motor → ntfy → app ntfy no telemóvel**. O motor publica cada aviso no tópico ntfy da casa (`motor/src/notificacoes.js`); o endereço do tópico chega à área de cliente em `domus/<cliente>/_ntfy` (retido, criado pelo `domus.sh`). Só nos planos com notificações ([PROTOCOLO-PLANOS.md](PROTOCOLO-PLANOS.md)); nos outros o cartão aparece com o cadeado.

O cartão **"Receber avisos no telemóvel"** está no separador Casa, por baixo das cenas (fechado ocupa uma linha). O Histórico tem uma ligação para ele. Tem três passos:

1. Instalar a app ntfy (Google Play ou App Store).
2. Juntar a casa à app:
   - **Android:** botão "Abrir na app ntfy", com a ligação `ntfy://<servidor>/<tópico>` (`web/estado.js` `ligacaoNtfy`). A documentação do ntfy só garante esta ligação na app Android.
   - **iPhone:** não há ligação direta garantida. Fica o endereço com o botão "Copiar" e a explicação de como o pôr na app à mão.
   - **Computador:** um código QR com a mesma ligação `ntfy://`, para apontar um telemóvel Android (o gerador é o das fotos pelo telemóvel, `web/simulador/qr.js`).
3. Experimentar: uma automação com a ação "Enviar notificação".

O endereço do tópico é um **segredo da casa** (quem o tiver recebe os avisos): a ligação e o código QR são feitos no navegador; o endereço não vai em endereços de páginas nossas, em parâmetros nem em registos.

**Não há "Enviar um aviso de teste".** O motor e o protocolo MQTT não têm um pedido para isso; fazê-lo pede uma alteração ao protocolo, que fica para decidir.

### Para depois: web push próprio

Notificações da própria app (sem a app ntfy) exigem um **service worker**, o que contraria a decisão 1; teria de ser um service worker só para o push, sem guardar páginas. No **iPhone** o web push só funciona com a app instalada no ecrã principal (iOS 16.4 ou mais recente). Pede também chaves VAPID e o envio no servidor.

## Por testar num telemóvel real

- **Xiaomi (problema em aberto):** a instalação ficou parada em "A instalar a app Domus…" e desistiu. Causa por isolar (Chrome ou navegador da Xiaomi, WebAPK, ícones do manifesto, poupança de bateria da MIUI).
- iPhone com entalhe: cabeçalho, separadores em baixo e aviso sem ficarem tapados, de pé e deitado; a janela "Instalar no iPhone"; a app aberta pelo ícone.
- Separadores em baixo com o teclado aberto (ao escrever numa automação ou numa cena).
- Android: o botão "Abrir na app ntfy" com a app instalada e sem ela; o código QR lido pela câmara (nem todas as câmaras abrem ligações `ntfy://`).
- iPhone: juntar a casa à app ntfy à mão, com o servidor e o tópico do endereço.
- Voltar à app depois de muito tempo em segundo plano: religa sozinha e o estado fica certo.
