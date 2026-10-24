// Service worker da app de diagnóstico (decisões do dono, 2026-10-24): registado por web/diagnostico.js com o âmbito
// "/diagnostico" — só controla /diagnostico.html (e o que essa página pede). O web/sw.js do resto do site (avisos da app
// do cliente, sem cache) não muda e as outras páginas continuam a vir sempre do servidor.
//
// Para a obra sem rede: a página, o CSS, os módulos e as árvores ficam guardados no telemóvel. Com rede vai-se sempre
// primeiro ao servidor (as páginas "sempre frescas" do site: depois de uma publicação ninguém fica com um módulo antigo)
// e a cópia guardada é atualizada; sem rede usa-se a cópia. A API (/api/…, /painel/api/…) nunca é guardada: os dados
// do diagnóstico ficam no IndexedDB do telemóvel (diagnostico.js) e sincronizam quando há rede e sessão.

const VERSAO = "domus-diagnostico-v2";   // sobe sempre que se acrescentam ficheiros (ronda 2: as árvores do resto do manual)
const CASCA = [
  "diagnostico.html", "diagnostico.css", "diagnostico.js", "diagnostico.json", "eletricista.css", "tema.js", "config.js", "favicon.svg",
  "manual-bt.js", "confirmar.js", "simulador/fotos.js", "simulador/fundo.js",
  "diagnostico/motor.js", "diagnostico/limites.js", "diagnostico/arvores.js",
  "diagnostico/arvores-protecoes.js", "diagnostico/arvores-alimentacao.js", "diagnostico/arvores-terra.js", "diagnostico/arvores-aparelhos.js",
  "diagnostico/construir.js", "diagnostico/arvores-projeto.js", "diagnostico/arvores-protecoes2.js", "diagnostico/arvores-locais.js",
  "diagnostico/arvores-edificios.js", "diagnostico/arvores-manutencao.js", "diagnostico/arvores-motores.js", "diagnostico/arvores-sinalizacao.js",
  "diagnostico/arvores-energia.js", "diagnostico/arvores-domotica.js",
  "icones/icone-192.png", "icones/icone-512.png", "icones/icone-mascara-512.png", "icones/icone-apple-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    // Um a um: um ficheiro que falte não impede os outros (a página funciona na mesma com o que houver).
    await Promise.all(CASCA.map((f) => c.add(new Request(f, { cache: "no-cache" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("domus-diagnostico-") && k !== VERSAO) await caches.delete(k);
    await self.clients.claim();
  })());
});

const daApi = (u) => u.pathname.startsWith("/api/") || u.pathname.startsWith("/painel/");

self.addEventListener("fetch", (e) => {
  const pedido = e.request;
  if (pedido.method !== "GET") return;
  const u = new URL(pedido.url);
  if (u.origin !== self.location.origin || daApi(u)) return;   // a API e as fontes de fora seguem pela rede, sem cache
  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    try {
      const r = await fetch(pedido, { cache: "no-cache" });
      if (r.ok && r.type === "basic") await c.put(pedido, r.clone());
      return r;
    } catch {
      const guardado = await c.match(pedido, { ignoreSearch: true });
      if (guardado) return guardado;
      if (pedido.mode === "navigate") return (await c.match("diagnostico.html")) ?? Response.error();
      return Response.error();
    }
  })());
});
