// Leitura (só leitura) do estado do servidor partilhado com o domus.sh e o
// serviço pagamentos:
//   dados/clientes/<c>.tsv   aparelhos do cliente (formato no cabeçalho do domus.sh)
//   dados/planos/<c>.json    subscrição (docs/PROTOCOLO-PLANOS.md §2)
//   dados/pagamentos/pagamentos.csv   data;cliente;plano;valor_com_iva;valor_sem_iva;id_stripe
// Nada aqui escreve nestas pastas (o contentor monta-as só de leitura).

import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const RE_ID = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
export const RESERVADOS = new Set(['admin', 'motor', 'pagamentos', 'painel']);
export const PLANOS = ['base', 'conforto', 'premium'];
export const ESTADOS_PLANO = ['ativo', 'teste', 'em_atraso', 'suspenso', 'cancelado'];
/** Preço mensal com IVA (PROTOCOLO-PLANOS §1). */
export const PRECO_IVA = { base: 4.99, conforto: 9.99, premium: 19.99 };
/** Sem IVA (23 %), arredondado ao cêntimo — igual ao pagamentos.csv. */
export const semIva = (v) => Math.round((v / 1.23) * 100) / 100;
const MAX_FICH = 1024 * 1024;

async function lerPequeno(caminho) {
  const st = await lstat(caminho);
  if (!st.isFile() || st.size > MAX_FICH) return null;
  return readFile(caminho, 'utf8');
}

async function listar(pasta, ext) {
  try {
    return (await readdir(pasta))
      .filter((f) => f.endsWith(ext) && RE_ID.test(f.slice(0, -ext.length)))
      .map((f) => f.slice(0, -ext.length))
      .sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** Canais normalizados do domus.sh: "n:funcao:nome:entrada:simular:arranque:carga:divisao,...". */
function lerCanais(txt) {
  const out = [];
  for (const item of String(txt || '').split(',')) {
    if (!item) continue;
    const [n, funcao, nome, entrada, simular, arranque, carga, divisao] = item.split(':');
    if (!/^\d{1,2}$/.test(n || '') || !funcao) continue;
    out.push({
      n: Number(n), funcao,
      ...(nome ? { nome } : {}),
      ...(entrada === '1' ? { entrada: true } : {}),
      ...(simular === '1' ? { simular: true } : {}),
      ...(arranque ? { arranque } : {}),
      ...(carga === 'perigosa' ? { carga } : {}),
      ...(divisao ? { divisao } : {}),
    });
  }
  return out;
}

/** Aparelhos de um cliente a partir do .tsv (aceita as linhas antigas v1 e v2). */
export function lerTsv(txt) {
  const out = [];
  for (const linha of String(txt).split('\n')) {
    if (!linha.trim()) continue;
    const c = linha.split('\t');
    if (!RE_ID.test(c[0] || '')) continue;
    if (c.length <= 3) {
      out.push({ id: c[0], tipo: c[1] || '', nome: c[2] || '', medidor: false, geral: false, bateria: false,
        divisao: null, canais: [{ n: 1, funcao: 'interruptor', arranque: 'desligado' }] });
      continue;
    }
    out.push({
      id: c[0], tipo: c[1], nome: c[5] || '', medidor: Number(c[2]) >= 1, geral: c[2] === '2',
      bateria: c[3] === '1', divisao: c[6] || null, canais: lerCanais(c[4]),
    });
  }
  return out;
}

export class Dados {
  constructor(config) {
    this.config = config;
  }

  async codigosClientes() {
    return listar(this.config.clientesDir, '.tsv');
  }

  async clienteExiste(c) {
    if (!RE_ID.test(c)) return false;
    try {
      return (await lstat(join(this.config.clientesDir, `${c}.tsv`))).isFile();
    } catch {
      return false;
    }
  }

  /** Lista de aparelhos, ou null se o cliente não existe. */
  async aparelhos(c) {
    if (!RE_ID.test(c)) return null;
    try {
      const txt = await lerPequeno(join(this.config.clientesDir, `${c}.tsv`));
      return txt === null ? null : lerTsv(txt);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES') return null;
      throw e;
    }
  }

  /** Subscrição do cliente. Sem ficheiro = conforto ativo manual (PROTOCOLO-PLANOS §2). */
  async plano(c) {
    const omissao = { plano: 'conforto', estado: 'ativo', desde: null, proximo_pagamento: null, aviso_ate: null, gerido: 'manual', sem_ficheiro: true };
    if (!RE_ID.test(c)) return omissao;
    let v;
    try {
      const txt = await lerPequeno(join(this.config.planosDir, `${c}.json`));
      if (txt === null) return omissao;
      v = JSON.parse(txt);
    } catch {
      return omissao;
    }
    if (!v || typeof v !== 'object') return omissao;
    const texto = (x) => (typeof x === 'string' && x.length <= 64 ? x : null);
    return {
      plano: PLANOS.includes(v.plano) ? v.plano : 'conforto',
      estado: ESTADOS_PLANO.includes(v.estado) ? v.estado : 'ativo',
      desde: texto(v.desde),
      proximo_pagamento: texto(v.proximo_pagamento),
      aviso_ate: texto(v.aviso_ate),
      gerido: v.gerido === 'stripe' ? 'stripe' : 'manual',
      sem_ficheiro: false,
    };
  }

  /** Linhas do pagamentos.csv (as inválidas são ignoradas). */
  async pagamentos() {
    let txt;
    try {
      const st = await lstat(this.config.pagamentosCsv);
      if (!st.isFile() || st.size > 32 * 1024 * 1024) return [];
      txt = await readFile(this.config.pagamentosCsv, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EACCES') return [];
      throw e;
    }
    const num = (s) => {
      const n = Number(String(s || '').trim().replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    const out = [];
    for (const linha of txt.split(/\r?\n/)) {
      const [data, cliente, plano, cIva, sIva, idStripe] = linha.split(';');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) continue; // cabeçalho ou linha estragada
      const com = num(cIva);
      if (com === null) continue;
      out.push({
        data, cliente: String(cliente || '').slice(0, 64), plano: String(plano || '').slice(0, 32),
        valor_com_iva: com, valor_sem_iva: num(sIva) ?? semIva(com), id_stripe: String(idStripe || '').slice(0, 128),
      });
    }
    return out;
  }
}
