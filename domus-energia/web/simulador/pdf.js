// PDF mínimo escrito à mão, sem dependências (a CSP do site só deixa scripts do próprio site): uma imagem JPEG
// por página, a ocupar a página toda (DCTDecode: o JPEG vai tal como está). Usado por "Guardar PDF" da planta
// (imprimir.js). Só lógica, sem DOM.

/** A4 em pontos (1/72 pol.): [largura, altura] ao alto. */
export const A4_PT = [595.28, 841.89];

const texto = new TextEncoder();
const num = (v) => String(Math.round(v * 100) / 100);

/**
 * @param {{jpeg: Uint8Array, largura_px: number, altura_px: number, largura_pt: number, altura_pt: number}[]} paginas
 * @returns {Uint8Array} o ficheiro PDF
 */
export function pdfDeImagens(paginas) {
  if (!Array.isArray(paginas) || !paginas.length) throw new Error("PDF sem páginas");
  const partes = [];
  const inicio = [];   // inicio[n] = posição (bytes) do objeto n
  let pos = 0;
  const por = (x) => { const b = typeof x === "string" ? texto.encode(x) : x; partes.push(b); pos += b.length; };
  const objeto = (n, ...corpo) => { inicio[n] = pos; por(`${n} 0 obj\n`); for (const c of corpo) por(c); por("\nendobj\n"); };

  // Cabeçalho; a 2.ª linha (comentário com bytes > 127) diz aos programas que o ficheiro é binário.
  por("%PDF-1.4\n");
  por(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const n = paginas.length;
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, `<< /Type /Pages /Kids [${paginas.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${n} >>`);
  paginas.forEach((p, i) => {
    const pagina = 3 + i * 3, conteudo = pagina + 1, imagem = pagina + 2;
    const w = num(p.largura_pt), h = num(p.altura_pt);
    objeto(pagina, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imagem} 0 R >> >> /Contents ${conteudo} 0 R >>`);
    const s = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    objeto(conteudo, `<< /Length ${s.length} >>\nstream\n`, s, "\nendstream");
    objeto(imagem, `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.largura_px)} /Height ${Math.round(p.altura_px)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, "\nendstream");
  });
  // Tabela de referências: cada linha tem exatamente 20 bytes.
  const total = 3 + n * 3;
  const xref = pos;
  let t = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let k = 1; k < total; k++) t += `${String(inicio[k]).padStart(10, "0")} 00000 n \n`;
  por(`${t}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const r = new Uint8Array(pos);
  let o = 0;
  for (const b of partes) { r.set(b, o); o += b.length; }
  return r;
}
