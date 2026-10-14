// Service worker da app do cliente — SÓ para os avisos (web push). Decisão do dono, 2026-10-14 (docs/APP-CLIENTE.md).
//
// De propósito NÃO guarda nada em cache e NÃO tem "fetch": as páginas vêm sempre do servidor, como antes (decisão
// de 2026-10-09: sem páginas velhas depois de uma publicação; a casa mostra sempre o estado verdadeiro). Não
// acrescentar aqui um "fetch" nem a Cache API.
//
// É registado pela web/cliente.js só quando o cliente toca em "Ativar avisos neste telemóvel" (ou se o telemóvel já
// tinha os avisos ativos). O conteúdo chega cifrado do motor (motor/src/webpush.js):
//   {"titulo": "...", "mensagem": "...", "tipo": "alarme"|"aviso"|"automacao"|..., "prioridade": "urgent"|"high"|"default"}

const ICONE = "icones/icone-192.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { mensagem: e.data ? e.data.text() : "" }; }
  const alarme = d.tipo === "alarme" || d.prioridade === "urgent";
  const titulo = typeof d.titulo === "string" && d.titulo ? d.titulo : "Domus Energia";
  const opcoes = {
    body: typeof d.mensagem === "string" ? d.mensagem : "",
    icon: ICONE,
    badge: ICONE,
    lang: "pt-PT",
    data: { seccao: "historico" },
    timestamp: Date.now(),
  };
  // Alarme: vibra com força e fica no ecrã até o cliente lhe tocar (como a prioridade máxima do ntfy).
  if (alarme) {
    opcoes.requireInteraction = true;
    opcoes.vibrate = [400, 150, 400, 150, 400, 150, 800];
    opcoes.tag = "domus-alarme";
    opcoes.renotify = true;
  }
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

// Toque no aviso: volta à app (se já estiver aberta) ou abre-a, no separador Histórico.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL("cliente.html#historico", self.registration.scope).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = janelas.find((j) => new URL(j.url).pathname.endsWith("/cliente.html"));
    if (app) {
      app.postMessage({ domus: "abrir", seccao: "historico" });
      return app.focus();
    }
    return self.clients.openWindow(destino);
  })());
});
