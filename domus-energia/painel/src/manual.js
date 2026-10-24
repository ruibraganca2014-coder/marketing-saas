// Manual de instalações elétricas de baixa tensão da empresa (decisões do dono, 2026-10-24): o PDF interno da equipa,
// só para quem tem sessão — utilizadores do painel (qualquer papel: /painel/api/manual-instalacoes-bt.pdf) e eletricistas
// aprovados (/api/eletricista/manual-instalacoes-bt.pdf, com o módulo ELETRICISTAS ligado). Fica fora de web/ e de
// public/ (painel/recursos/), não é servido como ficheiro estático e quem não tem sessão recebe 404, como num endereço
// que não existe. O índice das partes e dos capítulos está em web/manual-bt.js (cópia em painel/public/vendor/).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CABECALHOS_SEGURANCA, responder } from './http.js';

export const MANUAL_NOME = 'manual-instalacoes-bt.pdf';
export const MANUAL_FICHEIRO = fileURLToPath(new URL(`../recursos/${MANUAL_NOME}`, import.meta.url));

/** 404 igual ao de um endereço desconhecido (sem sessão, ou sem o ficheiro no servidor). */
export const naoExiste = (res) => responder(res, 404, { erro: 'Endereço desconhecido.' });

/**
 * Envia o PDF (GET ou HEAD; quem chama já confirmou a sessão): application/pdf, nosniff, privado e sem cache partilhada,
 * aberto no navegador (inline) com um nome limpo — o leitor de PDF abre no capítulo com "#page=N".
 */
export async function servirManual(req, res, ficheiro = MANUAL_FICHEIRO) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
  let tamanho;
  try { tamanho = (await stat(ficheiro)).size; } catch { return naoExiste(res); }
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/pdf',
    'Content-Length': tamanho,
    'Content-Disposition': `inline; filename="${MANUAL_NOME}"`,
    'Cache-Control': 'private, no-store',
  });
  if (req.method === 'HEAD') return res.end();
  await new Promise((resolve) => {
    const s = createReadStream(ficheiro);
    s.on('error', () => { res.destroy(); resolve(); });
    s.on('end', resolve);
    s.pipe(res);
  });
  return undefined;
}
