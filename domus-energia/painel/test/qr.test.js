// QR code do simulador (web/simulador/qr.js, passo 4 "Continue no telemóvel"): Reed-Solomon (vetores da norma
// ISO/IEC 18004 e síndromes nulas), BCH do formato e da versão (tabelas da norma), capacidades e tamanhos, e um
// descodificador de teste independente (lê o formato, tira a máscara, junta os blocos, confere a correção e lê o
// texto) sobre QR gerados para vários textos, versões e máscaras.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gfMultiplicar, divisorRS, restoRS, bitsFormato, bitsVersao, lado, capacidade, codewordsDados, gerarQR,
} from '../../web/simulador/qr.js';

// ------------------------------------------------------------ Reed-Solomon
test('Reed-Solomon: vetores conhecidos (versão 1-M: "01234567" da norma e "HELLO WORLD")', () => {
  const div = divisorRS(10);
  // ISO/IEC 18004 anexo I: "01234567" em modo numérico, 1-M.
  const d1 = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(restoRS(d1, div), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  // "HELLO WORLD" em modo alfanumérico, 1-M.
  const d2 = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(restoRS(d2, div), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

/** Valor do polinómio (codewords, do maior grau para o menor) em x, em GF(256). */
const avaliar = (cw, x) => cw.reduce((a, c) => gfMultiplicar(a, x) ^ c, 0);
const potencia = (i) => { let r = 1; for (let k = 0; k < i; k++) r = gfMultiplicar(r, 2); return r; };

test('Reed-Solomon: gerador com raízes α^0…α^(n-1) e síndromes nulas nos blocos com a correção', () => {
  for (const grau of [10, 16, 18, 22, 24, 26]) {
    const div = divisorRS(grau);
    assert.equal(div.length, grau);
    const g = [1, ...div];
    for (let i = 0; i < grau; i++) assert.equal(avaliar(g, potencia(i)), 0, `grau ${grau}: raiz α^${i}`);
    const dados = Array.from({ length: 40 }, (_, i) => (i * 37 + grau) & 0xff);
    const cw = [...dados, ...restoRS(dados, div)];
    for (let i = 0; i < grau; i++) assert.equal(avaliar(cw, potencia(i)), 0, `síndrome ${i}`);
  }
  assert.equal(gfMultiplicar(0x80, 2), 0x1d, 'redução por 0x11D');
  assert.equal(gfMultiplicar(0, 0x53), 0);
});

// ------------------------------------------------------------ BCH
test('BCH: formato (nível M, máscaras 0–7) e versão (7–10) iguais às tabelas da norma', () => {
  const formatoM = ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  for (let m = 0; m < 8; m++) assert.equal(bitsFormato(m).toString(2).padStart(15, '0'), formatoM[m], `máscara ${m}`);
  assert.equal(bitsFormato(4, 0b01).toString(2).padStart(15, '0'), '110011000101111', 'L, máscara 4');
  assert.equal(bitsVersao(7), 0x07c94);
  assert.equal(bitsVersao(8), 0x085bc);
  assert.equal(bitsVersao(9), 0x09a99);
  assert.equal(bitsVersao(10), 0x0a4d3);
});

test('tamanhos e capacidades (modo byte, nível M) das versões 1 a 10', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(lado), [21, 25, 29, 33, 37, 41, 45, 49, 53, 57]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(codewordsDados), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacidade), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  assert.equal(gerarQR('x'.repeat(14)).versao, 1);
  assert.equal(gerarQR('x'.repeat(15)).versao, 2);
  assert.equal(gerarQR('x'.repeat(213)).versao, 10);
  assert.throws(() => gerarQR('x'.repeat(214)), RangeError);
  // Um endereço típico do simulador com o token (43 caracteres) fica numa versão pequena.
  const url = `https://domusenergia.pt/simulador.html#ligar=${'A'.repeat(43)}`;
  assert.ok(gerarQR(url).versao <= 6);
});

// ------------------------------------------------------------ descodificador de teste (independente do gerador)
const EC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NB = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const AL = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MASC = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function descodificar(mod) {
  const n = mod.length;
  const v = (n - 17) / 4;
  assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, `lado ${n}`);
  // Padrões de deteção: 7×7 escuro/claro/escuro nos 3 cantos.
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(mod[oy + y][ox + x], d !== 2, `deteção em ${ox},${oy}`);
    }
  }
  for (let i = 8; i < n - 8; i++) { assert.equal(mod[6][i], i % 2 === 0, 'relógio'); assert.equal(mod[i][6], i % 2 === 0, 'relógio'); }
  // Formato (1.ª cópia: coluna 8 de cima e linha 8 da esquerda) e 2.ª cópia.
  const c1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const c2 = [...Array.from({ length: 8 }, (_, i) => [n - 1 - i, 8]), ...Array.from({ length: 7 }, (_, i) => [8, n - 7 + i])];
  const ler = (pos) => pos.reduce((a, [x, y], i) => a | ((mod[y][x] ? 1 : 0) << i), 0);
  const f = ler(c1);
  assert.equal(ler(c2), f, 'as duas cópias do formato');
  const dadosFormato = (f ^ 0x5412) >>> 10;
  assert.equal(dadosFormato >>> 3, 0b00, 'nível M');
  const m = dadosFormato & 7;
  assert.equal(mod[n - 8][8], true, 'módulo sempre escuro');
  if (v >= 7) {
    let bits = 0;
    for (let i = 0; i < 18; i++) bits |= (mod[Math.floor(i / 3)][n - 11 + (i % 3)] ? 1 : 0) << i;
    assert.equal(bits >>> 12, v, 'informação de versão');
  }
  // Módulos reservados.
  const res = Array.from({ length: n }, () => new Array(n).fill(false));
  const reservar = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) res[y][x] = true; };
  reservar(0, 0, 9, 9); reservar(n - 8, 0, 8, 9); reservar(0, n - 8, 9, 8);
  reservar(6, 0, 1, n); reservar(0, 6, n, 1);
  const ult = AL[v].at(-1);
  for (const a of AL[v]) for (const b of AL[v]) if (!((a === 6 && b === 6) || (a === 6 && b === ult) || (a === ult && b === 6))) reservar(a - 2, b - 2, 5, 5);
  if (v >= 7) { reservar(n - 11, 0, 3, 6); reservar(0, n - 11, 6, 3); }
  // Leitura em zigue-zague e sem máscara.
  const bits = [];
  let subir = true;
  for (let x = n - 1; x > 0; x -= 2) {
    if (x === 6) x = 5;
    for (let k = 0; k < n; k++) {
      const y = subir ? n - 1 - k : k;
      for (const xx of [x, x - 1]) if (!res[y][xx]) bits.push(mod[y][xx] !== MASC[m](xx, y) ? 1 : 0);
    }
    subir = !subir;
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length && cw.length < TOTAL[v]; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  assert.equal(cw.length, TOTAL[v]);
  // Desintercalar: blocos curtos primeiro; a correção de cada bloco confere (síndromes nulas).
  const nb = NB[v], ec = EC[v];
  const dadosTotal = TOTAL[v] - nb * ec;
  const curto = Math.floor(dadosTotal / nb);
  const longos = dadosTotal % nb;
  const blocos = Array.from({ length: nb }, (_, i) => ({ d: [], e: [], tam: curto + (i >= nb - longos ? 1 : 0) }));
  let k = 0;
  for (let i = 0; i < curto + 1; i++) for (const b of blocos) if (i < b.tam) b.d.push(cw[k++]);
  for (let i = 0; i < ec; i++) for (const b of blocos) b.e.push(cw[k++]);
  for (const b of blocos) for (let i = 0; i < ec; i++) assert.equal(avaliar([...b.d, ...b.e], potencia(i)), 0, 'correção do bloco');
  const dados = blocos.flatMap((b) => b.d);
  // Modo byte: 0100, contagem (8 bits até à versão 9, 16 na 10), bytes.
  const db = dados.flatMap((x) => Array.from({ length: 8 }, (_, i) => (x >>> (7 - i)) & 1));
  let p = 0;
  const tirar = (nb2) => { let r = 0; for (let i = 0; i < nb2; i++) r = (r << 1) | db[p++]; return r; };
  assert.equal(tirar(4), 0b0100, 'modo byte');
  const len = tirar(v <= 9 ? 8 : 16);
  const bytes = Array.from({ length: len }, () => tirar(8));
  return { versao: v, mascara: m, texto: new TextDecoder().decode(new Uint8Array(bytes)) };
}

test('descodificador de teste lê o que o gerador escreveu (vários textos, versões 1–10, todas as máscaras)', () => {
  const textos = ['A', 'Olá, Domus!', 'https://domusenergia.pt/simulador.html#ligar=abcDEF_123-xyz',
    `http://qr1.localhost:8080/simulador.html#ligar=${'Zq9_-'.repeat(8)}abc`, 'x'.repeat(100), 'ç'.repeat(90), 'y'.repeat(213)];
  const versoes = new Set();
  for (const t of textos) {
    const q = gerarQR(t);
    const r = descodificar(q.modulos);
    assert.equal(r.texto, t);
    assert.equal(r.versao, q.versao);
    assert.equal(r.mascara, q.mascara);
    versoes.add(q.versao);
  }
  assert.ok(versoes.has(1) && versoes.has(10) && versoes.size >= 5, [...versoes].join());
  for (let m = 0; m < 8; m++) {
    const q = gerarQR('https://exemplo.pt/simulador.html#ligar=0123456789', { mascara: m });
    assert.equal(q.mascara, m);
    assert.equal(descodificar(q.modulos).texto, 'https://exemplo.pt/simulador.html#ligar=0123456789');
  }
  // Máscara escolhida por penalização: sempre a mesma para o mesmo texto.
  assert.equal(gerarQR('abc').mascara, gerarQR('abc').mascara);
});
