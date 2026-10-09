// Repõe o catálogo a partir de uma cópia da base (decisão do dono, 2026-10-09: o catálogo tinha sido apagado a pedido
// dele em 2026-10-05 e sem ele o simulador não dá preços nem deixa enviar avarias).
//   node scripts/repor-catalogo.mjs <base-de-origem.db> <base-de-destino.db>
// Só acrescenta: copia da origem os artigos cujo SKU não existe no destino, com todas as colunas, e põe o stock
// reservado a zero (as reservas eram de pedidos que já não existem). Não apaga nem altera nada do que lá esteja.
import { DatabaseSync } from 'node:sqlite';

const [origem, destino] = process.argv.slice(2);
if (!origem || !destino) { console.error('uso: node scripts/repor-catalogo.mjs <origem.db> <destino.db>'); process.exit(2); }

const de = new DatabaseSync(origem, { readOnly: true });
const para = new DatabaseSync(destino);
para.exec('PRAGMA busy_timeout = 5000');

const colunas = (db) => db.prepare('PRAGMA table_info(catalogo)').all().map((c) => c.name);
const comuns = colunas(de).filter((c) => colunas(para).includes(c));
if (!comuns.includes('sku')) { console.error('a tabela catalogo não tem a coluna sku'); process.exit(1); }

const existentes = new Set(para.prepare('SELECT sku FROM catalogo').all().map((r) => r.sku));
const vazio = existentes.size === 0;
// Com o destino vazio mantêm-se os ids de origem; senão o destino dá ids novos.
const cols = vazio ? comuns : comuns.filter((c) => c !== 'id');
const inserir = para.prepare(`INSERT INTO catalogo (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);

let n = 0;
para.exec('BEGIN');
try {
  for (const linha of de.prepare('SELECT * FROM catalogo ORDER BY id').all()) {
    if (existentes.has(linha.sku)) continue;
    if ('stock_reservado' in linha) linha.stock_reservado = 0;
    inserir.run(...cols.map((c) => linha[c]));
    n++;
  }
  para.exec('COMMIT');
} catch (e) {
  para.exec('ROLLBACK');
  console.error(`falhou, nada foi alterado: ${e.message}`);
  process.exit(1);
}
const total = para.prepare('SELECT COUNT(*) AS n FROM catalogo').get().n;
console.log(`catálogo: ${n} artigos repostos, ${existentes.size} já existiam, ${total} no total`);
