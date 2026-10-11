// Teste rápido do site depois de uma publicação (decisão do dono, 2026-10-11): abre as páginas principais e todos os
// ficheiros que elas pedem (scripts, estilos e os módulos que estes importam) e diz se algum falhou. Só faz pedidos GET:
// não entra em contas, não envia formulários, não altera nada.
//
//   node src/verificar-site.js https://opancas.pt
//
// Sai com 0 e "SITE OK: ..." ou com 1 e "SITE COM PROBLEMAS: ..." (uma linha por problema). O instalar.sh corre-o no fim
// de cada atualização; também se pode correr de qualquer computador com Node 20 ou mais recente.

const PAGINAS = ['/', '/simulador.html', '/conta.html', '/cliente.html', '/eletricista.html', '/trabalhe-connosco.html',
  '/quadro-eletrico.html', '/casa-inteligente.html', '/carregador-carro.html', '/poupar-energia.html',
  '/termos.html', '/privacidade.html', '/cookies.html', '/painel/'];
const TEMPO_MS = 15_000;
const EM_PARALELO = 8;
const MAX_FICHEIROS = 400;

const base = (() => {
  try { const u = new URL(process.argv[2] ?? ''); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
})();
if (!base) { console.error('Uso: node src/verificar-site.js https://o-seu-site'); process.exit(2); }
const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);

const problemas = [];
const pedir = async (url) => {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TEMPO_MS), headers: { Accept: '*/*' } });
    return { estado: r.status, tipo: String(r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), texto: await r.text() };
  } catch (e) {
    return { estado: 0, tipo: '', texto: '', erro: e?.name === 'TimeoutError' ? 'sem resposta em 15 s' : (e?.cause?.code || e?.message || 'erro de ligação') };
  }
};
const curto = (u) => u.pathname + u.search;
const doSite = (ref, de) => {
  try { const u = new URL(ref, de); u.hash = ''; return u.origin === base.origin ? u : null; } catch { return null; }
};

const vistos = new Set();
const fila = [];
const juntar = (u, de) => { if (u && !vistos.has(u.href) && vistos.size < MAX_FICHEIROS) { vistos.add(u.href); fila.push({ u, de }); } };

/** Os ficheiros que uma página pede: <script src>, e <link href> de estilos e de módulos carregados antes. */
function daPagina(html, pagina) {
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) juntar(doSite(m[1], pagina), pagina);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(m[0])) continue;
    const h = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (h) juntar(doSite(h[1], pagina), pagina);
  }
}
/** Os módulos que um script importa com caminho fixo (./x.js, ../x.js, /x.js). */
function doScript(js, script) {
  const re = /(?:^|[\s;}])(?:import|export)\b[^'"`;()]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"'`$]+)["']\s*\)/g;
  for (const m of js.matchAll(re)) {
    const ref = m[1] ?? m[2] ?? m[3];
    if (/^(?:\.{1,2}\/|\/)/.test(ref)) juntar(doSite(ref, script), script);
  }
}

async function paginas() {
  let n = 0;
  await Promise.all(PAGINAS.map(async (c) => {
    const u = new URL(c, base);
    const r = await pedir(u);
    if (r.estado !== 200) { problemas.push(`${c}: ${r.erro ?? `respondeu ${r.estado}`}`); return; }
    if (r.tipo !== 'text/html' || !/<\/html>/i.test(r.texto)) { problemas.push(`${c}: não veio uma página completa`); return; }
    n += 1;
    daPagina(r.texto, u);
  }));
  return n;
}

async function ficheiros() {
  let n = 0;
  const um = async ({ u, de }) => {
    const r = await pedir(u);
    const onde = `${curto(u)} (pedido por ${curto(de)})`;
    if (r.estado !== 200) { problemas.push(`${onde}: ${r.erro ?? `respondeu ${r.estado}`}`); return; }
    if (!r.texto.trim()) { problemas.push(`${onde}: veio vazio`); return; }
    const js = /\.m?js$/.test(u.pathname);
    if (js && !/javascript/.test(r.tipo)) { problemas.push(`${onde}: devia ser JavaScript e veio "${r.tipo}"`); return; }
    if (/\.css$/.test(u.pathname) && r.tipo !== 'text/css') { problemas.push(`${onde}: devia ser CSS e veio "${r.tipo}"`); return; }
    n += 1;
    if (js) doScript(r.texto, u);
  };
  while (fila.length) await Promise.all(fila.splice(0, EM_PARALELO).map(um));
  return n;
}

/** O servidor por trás do site: o catálogo responde, o painel pede sessão e a rota de testes não existe em produção. */
async function servicos() {
  const cat = await pedir(new URL('/api/catalogo', base));
  let itens = null;
  try { itens = JSON.parse(cat.texto).itens; } catch { /* não é JSON */ }
  if (cat.estado !== 200 || !Array.isArray(itens) || !itens.length) problemas.push(`/api/catalogo: ${cat.erro ?? (cat.estado !== 200 ? `respondeu ${cat.estado}` : 'veio sem artigos')}`);
  const resumo = await pedir(new URL('/painel/api/resumo', base));
  if (resumo.estado !== 401) problemas.push(`/painel/api/resumo sem sessão: devia responder 401 e ${resumo.erro ?? `respondeu ${resumo.estado}`}`);
  if (!local) {
    const dev = await pedir(new URL('/api/dev/acesso-rapido', base));
    if (dev.estado !== 404) problemas.push(`/api/dev/acesso-rapido: a rota de testes devia responder 404 e ${dev.erro ?? `respondeu ${dev.estado}`}`);
  }
}

const nPaginas = await paginas();
const nFicheiros = await ficheiros();
await servicos();
if (problemas.length) {
  console.log(`SITE COM PROBLEMAS (${problemas.length}) em ${base.origin}:`);
  for (const p of problemas.slice(0, 40)) console.log(`  - ${p}`);
  if (problemas.length > 40) console.log(`  - e mais ${problemas.length - 40}`);
  process.exit(1);
}
console.log(`SITE OK: ${nPaginas} páginas e ${nFicheiros} ficheiros responderam bem em ${base.origin}.`);
