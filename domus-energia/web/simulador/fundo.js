// Fundo da planta: foto (JPG/PNG) ou PDF (1.ª página com pdf.js do cdn.jsdelivr.net),
// reduzido a ≤ 1600 px e JPEG ≤ 700 KB (docs/SIMULADOR-ORCAMENTO.md §2).
// A CSP do site não deixa blob: em img-src: as imagens abrem com createImageBitmap
// (ou como data: URL), e o worker do pdf.js vem do CDN (worker-src blob: + jsdelivr).

export const PDFJS_VERSAO = "4.10.38";
export const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSAO}/legacy/build/pdf.min.mjs`;
export const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSAO}/legacy/build/pdf.worker.min.mjs`;
export const MAX_LADO_PX = 1600;
export const MAX_BYTES = 700 * 1024;      // tamanho do data: URL
export const MAX_FICHEIRO = 25 * 1024 * 1024;

export class ErroFundo extends Error {}

const ehPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const ehImagem = (f) => /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name || "");

/**
 * Lê um ficheiro e devolve {imagem: "data:image/jpeg;base64,...", largura, altura} (px).
 * @param {File} ficheiro
 */
export async function lerFundo(ficheiro) {
  if (!ficheiro) throw new ErroFundo("Escolha um ficheiro.");
  if (ficheiro.size > MAX_FICHEIRO) throw new ErroFundo("O ficheiro é demasiado grande (máx. 25 MB).");
  if (ehPdf(ficheiro)) return comprimir(await paginaPdf(ficheiro));
  if (ehImagem(ficheiro)) return comprimir(await abrirImagem(ficheiro));
  throw new ErroFundo("Use uma fotografia (JPG ou PNG) ou um PDF.");
}

export async function abrirImagem(ficheiro) {
  try {
    if (typeof createImageBitmap === "function") return await createImageBitmap(ficheiro);
  } catch { /* tenta como data: URL */ }
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new ErroFundo("Não foi possível ler a imagem."));
    r.readAsDataURL(ficheiro);
  });
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new ErroFundo("Não foi possível abrir a imagem. Experimente outra fotografia (JPG ou PNG).");
  }
  return img;
}

let pdfjs = null;
async function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  try {
    const m = await import(PDFJS_URL);
    m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    pdfjs = m;
    return m;
  } catch {
    throw new ErroFundo("Não foi possível abrir o leitor de PDF (sem ligação ao cdn.jsdelivr.net). Tire uma fotografia ou uma captura de ecrã da planta e carregue a imagem (JPG ou PNG).");
  }
}

async function paginaPdf(ficheiro) {
  const m = await carregarPdfjs();
  let doc = null;
  try {
    const dados = new Uint8Array(await ficheiro.arrayBuffer());
    doc = await m.getDocument({ data: dados, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false }).promise;
    const pagina = await doc.getPage(1);
    const v1 = pagina.getViewport({ scale: 1 });
    const escala = Math.min(4, MAX_LADO_PX / Math.max(v1.width, v1.height));
    const vista = pagina.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vista.width));
    canvas.height = Math.max(1, Math.round(vista.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
    return canvas;
  } catch (e) {
    if (e instanceof ErroFundo) throw e;
    throw new ErroFundo("Não foi possível ler este PDF. Tire uma fotografia ou uma captura de ecrã da planta e carregue a imagem (JPG ou PNG).");
  } finally {
    doc?.destroy?.();
  }
}

/** Reduz a ≤ 1600 px e procura a melhor qualidade JPEG que fique ≤ 700 KB. */
export function comprimir(origem) {
  const w0 = origem.width || origem.naturalWidth;
  const h0 = origem.height || origem.naturalHeight;
  if (!w0 || !h0) throw new ErroFundo("A imagem está vazia.");
  let escala = Math.min(1, MAX_LADO_PX / Math.max(w0, h0));
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const w = Math.max(1, Math.round(w0 * escala));
    const h = Math.max(1, Math.round(h0 * escala));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";          // PNG com transparência → fundo branco
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(origem, 0, 0, w, h);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= MAX_BYTES && url.startsWith("data:image/jpeg;base64,")) return { imagem: url, largura: w, altura: h };
    }
    escala *= 0.75;
  }
  throw new ErroFundo("Não foi possível reduzir a imagem o suficiente. Experimente outra.");
}
