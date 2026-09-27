// Ficheiros do painel (painel/public) em /painel/: tipos corretos, sem listagem
// de pastas, sem ficheiros escondidos, nunca fora da pasta (nem por symlinks).
// Caminhos sem extensão (ex. /painel/clientes) devolvem o index.html (ecrãs da
// aplicação); se a pasta não tiver index.html mostra uma página provisória.

import { stat, realpath, readFile } from 'node:fs/promises';
import { join, sep, extname } from 'node:path';
import { CABECALHOS_SEGURANCA } from './http.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Mesma política do Caddy, mais apertada: o painel não usa CDNs nem MQTT no navegador.
export const CSP_PAINEL = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
  + "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
  + "base-uri 'none'; form-action 'self'; object-src 'none'";

const PROVISORIA = `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel Domus Energia</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f1ea;color:#2b2118}
@media (prefers-color-scheme:dark){body{background:#1d1814;color:#efe6db}}main{max-width:32rem;padding:1.5rem}</style></head>
<body><main><h1>Painel Domus Energia</h1><p>O serviço do painel está a funcionar, mas os ecrãs ainda não foram instalados (pasta <code>painel/public</code>).</p></main></body></html>
`;

const RE_SEGURO = /^[A-Za-z0-9._\-/]*$/;

export function criarEstatico(pasta) {
  let raiz = null;
  const obterRaiz = async () => (raiz ??= await realpath(pasta).catch(() => null));

  function enviar(req, res, estado, tipo, corpo, cache) {
    res.writeHead(estado, {
      ...CABECALHOS_SEGURANCA,
      'Content-Type': tipo,
      'Content-Length': corpo.length,
      'Cache-Control': cache,
      'Content-Security-Policy': CSP_PAINEL,
    });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  }
  const naoEncontrado = (req, res) => enviar(req, res, 404, 'text/plain; charset=utf-8', Buffer.from('Não encontrado.\n'), 'no-store');

  /** Ficheiro regular dentro da raiz, ou null. */
  async function resolver(r, rel) {
    try {
      const real = await realpath(join(r, rel));
      if (real !== r && !real.startsWith(r + sep)) return null;
      const st = await stat(real);
      return st.isFile() ? real : null;
    } catch {
      return null;
    }
  }

  return async function servir(req, res, caminho) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...CABECALHOS_SEGURANCA, Allow: 'GET, HEAD', 'Content-Length': 0 });
      return res.end();
    }
    let rel;
    try {
      rel = decodeURIComponent(caminho.slice('/painel/'.length));
    } catch {
      return naoEncontrado(req, res);
    }
    const segs = rel.split('/');
    if (!RE_SEGURO.test(rel) || segs.some((s) => s.startsWith('.'))) return naoEncontrado(req, res);
    const r = await obterRaiz();
    const index = r ? await resolver(r, 'index.html') : null;
    let ficheiro;
    if (rel === '' || rel.endsWith('/')) {
      ficheiro = rel === '' ? index : null;           // nunca lista pastas
      if (rel === '' && !index) return enviar(req, res, 200, TIPOS['.html'], Buffer.from(PROVISORIA), 'no-cache');
    } else {
      ficheiro = r ? await resolver(r, rel) : null;
      if (!ficheiro && !extname(rel)) {
        if (!index) return enviar(req, res, 200, TIPOS['.html'], Buffer.from(PROVISORIA), 'no-cache');
        ficheiro = index;                              // ecrãs da aplicação (/painel/clientes)
      }
    }
    if (!ficheiro) return naoEncontrado(req, res);
    const tipo = TIPOS[extname(ficheiro).toLowerCase()];
    if (!tipo) return naoEncontrado(req, res);         // só tipos conhecidos
    const corpo = await readFile(ficheiro);
    return enviar(req, res, 200, tipo, corpo, tipo.startsWith('text/html') ? 'no-cache' : 'public, max-age=300');
  };
}
