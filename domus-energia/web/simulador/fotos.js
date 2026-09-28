// Fotos do simulador (docs/SIMULADOR-ORCAMENTO.md §1 passos 4 e 5, §6): opcionais, uma por tipo de aparelho e
// divisão e uma do quadro elétrico. Reduzidas no navegador (≤ 1600 px, JPEG ~0,8, alvo ≤ 400 KB, nunca mais de
// 1 MB) e guardadas no IndexedDB (não no localStorage: não cabem) até ao envio, ligadas à simulação pelo
// `fotosId` do estado. Sem IndexedDB (modo privado, bloqueado) ficam só em memória enquanto a página está aberta.
// A CSP do site não deixa blob: em img-src: as miniaturas são data: URLs pequenas.

import { abrirImagem } from "./fundo.js";

export const MAX_FOTOS = 40;                  // por pedido (o servidor também limita: fotos_max)
export const MAX_LADO_FOTO = 1600;            // px no lado maior
export const ALVO_BYTES = 400 * 1024;
export const MAX_BYTES_FOTO = 1024 * 1024;    // limite do servidor por foto
export const MAX_FICHEIRO_FOTO = 40 * 1024 * 1024;
const LADO_MINIATURA = 240;

export class ErroFoto extends Error {}

async function abrir(ficheiro) {
  try {
    // Com a orientação da câmara (EXIF): uma foto tirada ao alto fica ao alto.
    if (typeof createImageBitmap === "function") return await createImageBitmap(ficheiro, { imageOrientation: "from-image" });
  } catch { /* tenta de outra maneira */ }
  try {
    return await abrirImagem(ficheiro);
  } catch {
    throw new ErroFoto("Não foi possível abrir esta foto. Experimente tirar outra (JPG ou PNG).");
  }
}

function tela(origem, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";   // PNG com transparência → fundo branco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(origem, 0, 0, w, h);
  return c;
}

function paraBlob(c, q) {
  return new Promise((ok) => {
    if (c.toBlob) { c.toBlob((b) => ok(b), "image/jpeg", q); return; }
    const url = c.toDataURL("image/jpeg", q);
    const bin = atob(url.split(",")[1] ?? "");
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    ok(new Blob([a], { type: "image/jpeg" }));
  });
}

/**
 * Reduz uma foto: ≤ 1600 px no lado maior, JPEG 0,8 (depois 0,7 e 0,6; e mais pequena) até ≤ 400 KB; se não
 * chegar lá, a primeira que fique ≤ 1 MB. Devolve {blob, largura, altura, miniatura (data: URL ≤ 240 px)}.
 * @param {File|Blob} ficheiro
 */
export async function reduzirFoto(ficheiro) {
  if (!ficheiro) throw new ErroFoto("Escolha uma foto.");
  if (ficheiro.size > MAX_FICHEIRO_FOTO) throw new ErroFoto("A foto é demasiado grande (máx. 40 MB).");
  if (ficheiro.type && !ficheiro.type.startsWith("image/")) throw new ErroFoto("Isto não é uma foto. Escolha uma imagem (JPG ou PNG).");
  const img = await abrir(ficheiro);
  try {
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    if (!w0 || !h0) throw new ErroFoto("A foto está vazia.");
    const em = Math.min(1, LADO_MINIATURA / Math.max(w0, h0));
    const miniatura = tela(img, Math.max(1, Math.round(w0 * em)), Math.max(1, Math.round(h0 * em))).toDataURL("image/jpeg", 0.7);
    let escala = Math.min(1, MAX_LADO_FOTO / Math.max(w0, h0));
    let reserva = null;
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const w = Math.max(1, Math.round(w0 * escala)), h = Math.max(1, Math.round(h0 * escala));
      const c = tela(img, w, h);
      for (const q of [0.8, 0.7, 0.6]) {
        const b = await paraBlob(c, q);
        if (!b?.size) continue;
        if (b.size <= ALVO_BYTES) return { blob: b, largura: w, altura: h, miniatura };
        if (!reserva && b.size <= MAX_BYTES_FOTO) reserva = { blob: b, largura: w, altura: h, miniatura };
      }
      escala *= 0.8;
    }
    if (reserva) return reserva;
    throw new ErroFoto("Não foi possível reduzir esta foto. Experimente outra.");
  } finally {
    img.close?.();
  }
}

// ------------------------------------------------------------ IndexedDB (com memória de recurso)
const BD = "domus-simulador-fotos";
const LOJA = "fotos";
const memoria = new Map();   // k → registo (sempre: é daqui que a página lê enquanto está aberta)
let bdPromessa = null;

function bd() {
  if (!bdPromessa) {
    bdPromessa = new Promise((ok) => {
      try {
        const r = indexedDB.open(BD, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(LOJA, { keyPath: "k" });
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
        r.onblocked = () => ok(null);
      } catch {
        ok(null);
      }
    });
  }
  return bdPromessa;
}

/** Uma transação na loja das fotos; devolve o `result` do pedido (ou null sem IndexedDB). */
async function naLoja(modo, fazer) {
  const b = await bd();
  if (!b) return null;
  return new Promise((ok, falha) => {
    try {
      const t = b.transaction(LOJA, modo);
      const r = fazer(t.objectStore(LOJA));
      t.oncomplete = () => ok(r?.result ?? true);
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error);
    } catch (e) {
      falha(e);
    }
  });
}

const chaveDe = (sim, chave) => `${sim}|${chave}`;

/**
 * Guarda a foto `chave` da simulação `sim` ({blob, miniatura, largura, altura}). Devolve true se ficou no
 * navegador (IndexedDB), false se só ficou em memória.
 */
export async function guardarFoto(sim, chave, foto) {
  // `servidor`: id da foto no servidor quando há ligação ao telemóvel (ligacao.js); null = só neste navegador.
  const r = { k: chaveDe(sim, chave), sim, chave, blob: foto.blob, miniatura: foto.miniatura, largura: foto.largura, altura: foto.altura, servidor: foto.servidor ?? null, quando: new Date().toISOString() };
  memoria.set(r.k, r);
  try {
    return (await naLoja("readwrite", (s) => s.put(r))) !== null;
  } catch {
    return false;
  }
}

export async function apagarFoto(sim, chave) {
  memoria.delete(chaveDe(sim, chave));
  try { await naLoja("readwrite", (s) => s.delete(chaveDe(sim, chave))); } catch { /* fica só a memória */ }
}

/** As fotos da simulação `sim`: [{chave, blob, miniatura, largura, altura}]. */
export async function lerFotos(sim) {
  if (!sim) return [];
  try {
    const todas = await naLoja("readonly", (s) => s.getAll());
    if (Array.isArray(todas)) for (const r of todas) if (r?.sim === sim && r.blob) memoria.set(r.k, r);
  } catch { /* só a memória */ }
  return [...memoria.values()].filter((r) => r.sim === sim);
}

/** Apaga as fotos guardadas no navegador, menos as da simulação `manter` (null = todas). */
export async function limparFotos(manter = null) {
  for (const [k, r] of memoria) if (r.sim !== manter) memoria.delete(k);
  try {
    if (!manter) { await naLoja("readwrite", (s) => s.clear()); return; }
    const todas = await naLoja("readonly", (s) => s.getAll());
    const fora = (Array.isArray(todas) ? todas : []).filter((r) => r?.sim !== manter).map((r) => r.k);
    if (fora.length) await naLoja("readwrite", (s) => { for (const k of fora) s.delete(k); });
  } catch { /* nada a fazer */ }
}

/** Identificador novo para ligar as fotos a uma simulação. */
export function novoIdFotos() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Legenda para o cabeçalho X-Foto-Legenda: encodeURIComponent e ≤ 120 caracteres (encurta o texto até o
 * codificado caber, sem partir um carácter a meio).
 */
export function legendaCabecalho(texto) {
  const cs = Array.from(String(texto ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, 120);
  while (cs.length && encodeURIComponent(cs.join("")).length > 120) cs.pop();
  return encodeURIComponent(cs.join(""));
}
