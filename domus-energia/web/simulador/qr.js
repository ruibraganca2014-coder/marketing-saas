// QR code sem dependências (docs/SIMULADOR-ORCAMENTO.md, passo 4 "Continue no telemóvel"): QR modelo 2, modo
// byte (UTF-8), correção de erros M, versões 1 a 10 (até 213 bytes: chega para o endereço do simulador com o
// token), máscara escolhida pela penalização da norma (ISO/IEC 18004 §7.8.3). Desenha em SVG (sem canvas: a CSP
// do site não deixa blob: nas imagens e o SVG escala sem perder nitidez).
// Segue o algoritmo de referência de Project Nayuki (MIT) reduzido ao que usamos.

const VERSAO_MAX = 10;
// Por versão (índice = versão), nível M: codewords de correção por bloco e n.º de blocos.
const EC_POR_BLOCO = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
// Centros dos padrões de alinhamento.
const ALINHAMENTO = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const NIVEL_M = 0b00;   // bits do nível de correção no formato (L=01, M=00, Q=11, H=10)

// ------------------------------------------------------------ Reed-Solomon em GF(256), polinómio 0x11D
export function gfMultiplicar(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Gerador de grau `grau` (coeficientes do maior para o menor, sem o 1 do topo). */
export function divisorRS(grau) {
  const r = new Array(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMultiplicar(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = gfMultiplicar(raiz, 0x02);
  }
  return r;
}

/** Codewords de correção de `dados` (resto da divisão pelo gerador). */
export function restoRS(dados, divisor) {
  const r = divisor.map(() => 0);
  for (const b of dados) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMultiplicar(c, f); });
  }
  return r;
}

// ------------------------------------------------------------ BCH do formato e da versão
/** 15 bits do formato (nível M e a máscara), já com a máscara 0x5412. */
export function bitsFormato(mascara, nivel = NIVEL_M) {
  const d = (nivel << 3) | mascara;
  let r = d;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((d << 10) | r) ^ 0x5412;
}

/** 18 bits da informação de versão (versões 7 e acima). */
export function bitsVersao(v) {
  let r = v;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (v << 12) | r;
}

// ------------------------------------------------------------ tamanhos
export const lado = (v) => v * 4 + 17;

/** Módulos de dados (sem os padrões fixos) de uma versão. */
export function modulosDados(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

/** Codewords de dados (sem correção) da versão no nível M. */
export const codewordsDados = (v) => Math.floor(modulosDados(v) / 8) - EC_POR_BLOCO[v] * BLOCOS[v];

/** Bytes que cabem em modo byte (4 bits de modo + 8 ou 16 de contagem). */
export const capacidade = (v) => Math.floor((codewordsDados(v) * 8 - 4 - (v <= 9 ? 8 : 16)) / 8);

// ------------------------------------------------------------ codificação
function codewords(bytes, v) {
  const bits = [];
  const por = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  por(0b0100, 4);
  por(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) por(b, 8);
  const total = codewordsDados(v) * 8;
  por(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const r = [];
  for (let i = 0; i < bits.length; i += 8) r.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0xec; r.length < codewordsDados(v); p ^= 0xec ^ 0x11) r.push(p);
  return r;
}

/** Os dados divididos em blocos, cada um com a sua correção, intercalados (§7.6). */
export function intercalar(dados, v) {
  const nBlocos = BLOCOS[v];
  const ec = EC_POR_BLOCO[v];
  const brutos = Math.floor(modulosDados(v) / 8);
  const curtos = nBlocos - (brutos % nBlocos);
  const curto = Math.floor(brutos / nBlocos);
  const div = divisorRS(ec);
  const blocos = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const d = dados.slice(k, k + curto - ec + (i < curtos ? 0 : 1));
    k += d.length;
    const e = restoRS(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(e));
  }
  const r = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((b, j) => { if (i !== curto - ec || j >= curtos) r.push(b[i]); });
  }
  return r;
}

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
export const mascara = (m, x, y) => MASCARAS[m](x, y);

function matrizBase(v) {
  const n = lado(v);
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixo = Array.from({ length: n }, () => new Array(n).fill(false));
  const por = (x, y, escuro) => { mod[y][x] = escuro; fixo[y][x] = true; };
  for (let i = 0; i < n; i++) { por(6, i, i % 2 === 0); por(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) por(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const al = ALINHAMENTO[v];
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) por(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  desenharFormato(por, n, 0);
  if (v >= 7) {
    const b = bitsVersao(v);
    for (let i = 0; i < 18; i++) {
      const escuro = ((b >>> i) & 1) === 1;
      const a = n - 11 + (i % 3), c = Math.floor(i / 3);
      por(a, c, escuro);
      por(c, a, escuro);
    }
  }
  return { n, mod, fixo, por };
}

function desenharFormato(por, n, m) {
  const b = bitsFormato(m);
  const bit = (i) => ((b >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) por(8, i, bit(i));
  por(8, 7, bit(6));
  por(8, 8, bit(7));
  por(7, 8, bit(8));
  for (let i = 9; i < 15; i++) por(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) por(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) por(8, n - 15 + i, bit(i));
  por(8, n - 8, true);   // sempre escuro
}

/** Percurso em zigue-zague dos módulos de dados (de baixo para cima, colunas de 2, saltando a coluna 6). */
export function percurso(n, fixo) {
  const r = [];
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const sobe = ((dir + 1) & 2) === 0;
        const y = sobe ? n - 1 - vert : vert;
        if (!fixo[y][x]) r.push([x, y]);
      }
    }
  }
  return r;
}

// Penalização (§7.8.3): N1 = 3, N2 = 3, N3 = 40, N4 = 10.
function penalizacao(mod) {
  const n = mod.length;
  let r = 0;
  const linha = (get) => {
    let cor = false, corrida = 0;
    const hist = [0, 0, 0, 0, 0, 0, 0];
    const junta = (c) => { if (hist[0] === 0) c += n; hist.pop(); hist.unshift(c); };
    const padroes = () => {
      const k = hist[1];
      const nucleo = k > 0 && hist[2] === k && hist[3] === k * 3 && hist[4] === k && hist[5] === k;
      return (nucleo && hist[0] >= k * 4 && hist[6] >= k ? 1 : 0) + (nucleo && hist[6] >= k * 4 && hist[0] >= k ? 1 : 0);
    };
    for (let i = 0; i < n; i++) {
      if (get(i) === cor) {
        corrida++;
        if (corrida === 5) r += 3; else if (corrida > 5) r++;
      } else {
        junta(corrida);
        if (!cor) r += padroes() * 40;
        cor = get(i);
        corrida = 1;
      }
    }
    if (cor) { junta(corrida); corrida = 0; }
    junta(corrida + n);
    r += padroes() * 40;
  };
  for (let y = 0; y < n; y++) linha((x) => mod[y][x]);
  for (let x = 0; x < n; x++) linha((y) => mod[y][x]);
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) r += 3;
    }
  }
  let escuros = 0;
  for (const l of mod) for (const c of l) if (c) escuros++;
  const total = n * n;
  r += (Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1) * 10;
  return r;
}

/**
 * Matriz do QR para `texto` (UTF-8): {versao, mascara, lado, modulos: boolean[linha][coluna]} (true = escuro).
 * `mascara` fixa a máscara (testes); sem ela escolhe a de menor penalização.
 */
export function gerarQR(texto, { mascara: fixa = null } = {}) {
  const bytes = [...new TextEncoder().encode(String(texto))];
  let v = 1;
  while (v <= VERSAO_MAX && bytes.length > capacidade(v)) v++;
  if (v > VERSAO_MAX) throw new RangeError(`Texto demasiado longo para o QR (máx. ${capacidade(VERSAO_MAX)} bytes).`);
  const { n, mod, fixo, por } = matrizBase(v);
  const dados = intercalar(codewords(bytes, v), v);
  const caminho = percurso(n, fixo);
  caminho.forEach(([x, y], i) => { mod[y][x] = i < dados.length * 8 ? ((dados[i >>> 3] >>> (7 - (i & 7))) & 1) === 1 : false; });
  const aplicar = (m) => { for (const [x, y] of caminho) if (mascara(m, x, y)) mod[y][x] = !mod[y][x]; };
  let melhor = fixa;
  if (melhor === null) {
    let menor = Infinity;
    for (let m = 0; m < 8; m++) {
      aplicar(m);
      desenharFormato(por, n, m);
      const p = penalizacao(mod);
      if (p < menor) { menor = p; melhor = m; }
      aplicar(m);   // XOR: desfaz
    }
  }
  aplicar(melhor);
  desenharFormato(por, n, melhor);
  return { versao: v, mascara: melhor, lado: n, modulos: mod };
}

/**
 * SVG do QR (um só <path>, com 4 módulos de margem branca). Sempre escuro sobre branco (também no tema escuro:
 * as câmaras leem mal o QR invertido). `rotulo` vai para o nome acessível.
 */
export function svgQR(texto, { rotulo = "Código QR", tamanho = 176 } = {}) {
  const { lado: n, modulos } = gerarQR(texto);
  const m = 4;
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", `0 0 ${n + 2 * m} ${n + 2 * m}`);
  s.setAttribute("width", String(tamanho));
  s.setAttribute("height", String(tamanho));
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", rotulo);
  s.setAttribute("shape-rendering", "crispEdges");
  const fundo = document.createElementNS(ns, "rect");
  fundo.setAttribute("width", "100%");
  fundo.setAttribute("height", "100%");
  fundo.setAttribute("fill", "#ffffff");
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modulos[y][x]) d += `M${x + m} ${y + m}h1v1h-1z`;
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "#000000");
  s.append(fundo, p);
  return s;
}
