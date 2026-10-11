// As fotos ficam sem os dados escondidos (GPS, data, modelo do telemóvel, comentários) antes de serem guardadas:
// são mostradas a eletricistas que não podem saber a morada do cliente (src/fotos.js semMetadados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { semMetadados } from '../src/fotos.js';

const seg = (m, dados) => { const d = Buffer.from(dados); const c = Buffer.alloc(4); c[0] = 0xff; c[1] = m; c.writeUInt16BE(d.length + 2, 2); return Buffer.concat([c, d]); };
const SOI = Buffer.from([0xff, 0xd8]);
const JFIF = seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0');
const DQT = seg(0xdb, Buffer.alloc(65, 1));
const IMAGEM = Buffer.concat([seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])]);

/** Um bloco Exif (ordem II) com a orientação e um texto "secreto" a fazer de GPS. */
function exif(orientacao) {
  const t = Buffer.alloc(8 + 2 + 12 + 4);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8);
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(orientacao, 18);
  return seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t, Buffer.from('GPS 38.7369N 9.1427W Rua Secreta')]));
}

test('JPEG: saem o Exif (GPS), o XMP, o IPTC e os comentários; a imagem fica byte a byte igual', () => {
  const sujo = Buffer.concat([SOI, JFIF, exif(1), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x>Rua Secreta</x>'), seg(0xed, 'Photoshop 3.0 Rua Secreta'), seg(0xfe, 'tirada na Rua Secreta'), DQT, IMAGEM]);
  const limpo = semMetadados(sujo, 'image/jpeg');
  assert.deepEqual(limpo, Buffer.concat([SOI, JFIF, DQT, IMAGEM]));
  assert.equal(limpo.includes('Secreta'), false);
  assert.equal(limpo.includes('GPS'), false);
});

test('JPEG: a foto tirada ao alto continua ao alto (fica só a orientação)', () => {
  const limpo = semMetadados(Buffer.concat([SOI, JFIF, exif(6), DQT, IMAGEM]), 'image/jpeg');
  assert.equal(limpo.includes('Secreta'), false);
  assert.equal(limpo.subarray(2, 2 + JFIF.length).equals(JFIF), true, 'o JFIF continua primeiro');
  const app1 = limpo.subarray(2 + JFIF.length);
  assert.equal(app1[1], 0xe1);
  assert.equal(app1.readUInt16BE(2), 34);
  assert.equal(app1.toString('latin1', 4, 10), 'Exif\0\0');
  assert.equal(app1.readUInt16BE(4 + 6 + 8 + 2), 0x0112);
  assert.equal(app1.readUInt16BE(4 + 6 + 8 + 2 + 8), 6);
  assert.deepEqual(limpo.subarray(2 + JFIF.length + 36), Buffer.concat([DQT, IMAGEM]));
  // Limpar outra vez não muda mais nada além de repor o mesmo bloco.
  assert.deepEqual(semMetadados(limpo, 'image/jpeg'), limpo);
});

test('JPEG: perfil de cor (APP2) e Adobe (APP14) ficam; sem nada para tirar devolve o mesmo', () => {
  const icc = seg(0xe2, 'ICC_PROFILE\0\x01\x01perfil');
  const adobe = seg(0xee, 'Adobe\0d\0\0\0\0\x01');
  const limpo = semMetadados(Buffer.concat([SOI, JFIF, icc, exif(1), adobe, DQT, IMAGEM]), 'image/jpeg');
  assert.deepEqual(limpo, Buffer.concat([SOI, JFIF, icc, adobe, DQT, IMAGEM]));
  const jaLimpo = Buffer.concat([SOI, JFIF, DQT, IMAGEM]);
  assert.equal(semMetadados(jaLimpo, 'image/jpeg'), jaLimpo);
});

test('ficheiro que não se consegue percorrer fica como veio (não rebenta)', () => {
  for (const b of [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]), Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03, 0x04]),
    Buffer.concat([SOI, seg(0xe1, 'Exif\0\0II')]), Buffer.concat([SOI, seg(0xe1, 'Exif\0\0MM\0*\xff\xff\xff\xff'), IMAGEM])]) {
    assert.doesNotThrow(() => semMetadados(b, 'image/jpeg'));
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(semMetadados(png, 'image/png'), png);
});

test('PNG: saem eXIf, tEXt, iTXt, zTXt e tIME; os blocos da imagem ficam', () => {
  const bloco = (tipo, dados) => { const d = Buffer.from(dados); const t = Buffer.from(tipo, 'latin1'); const n = Buffer.alloc(4); n.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, d]))); return Buffer.concat([n, t, d, c]); };
  const ASS = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = bloco('IHDR', Buffer.alloc(13, 1)), idat = bloco('IDAT', Buffer.alloc(20, 7)), iend = bloco('IEND', '');
  const sujo = Buffer.concat([ASS, ihdr, bloco('eXIf', 'GPS Rua Secreta'), bloco('tEXt', 'Comment\0Rua Secreta'), bloco('iTXt', 'XML Rua Secreta'), bloco('zTXt', 'x'), bloco('tIME', Buffer.alloc(7)), idat, iend]);
  assert.deepEqual(semMetadados(sujo, 'image/png'), Buffer.concat([ASS, ihdr, idat, iend]));
});
