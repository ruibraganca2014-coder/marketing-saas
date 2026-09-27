// Base de dados SQLite (node:sqlite, sem dependências nativas) e migrações.
// A versão do esquema fica em PRAGMA user_version; cada migração corre uma vez,
// dentro de uma transação, pela ordem da lista.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEMENTES_CATALOGO } from './catalogo-sementes.js';
import { iso } from './util.js';

export const ESTADOS_ORCAMENTO = ['novo', 'contactado', 'visita_marcada', 'proposta_enviada', 'aceite', 'perdido'];
export const ESTADOS_OBRA = ['agendada', 'em_curso', 'concluida', 'cancelada'];
export const PAPEIS = ['ceo', 'tecnico', 'comercial'];
export const CATEGORIAS = ['disjuntor', 'interruptor', 'sensor', 'estore', 'tomada', 'luz', 'termostato', 'central', 'acessorio', 'outro'];

const lista = (v) => v.map((x) => `'${x}'`).join(',');

export const MIGRACOES = [
  // 1 — utilizadores, sessões, auditoria, orçamentos, obras, fichas de cliente, pedidos-admin
  (db) => db.exec(`
    CREATE TABLE utilizadores (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      papel TEXT NOT NULL CHECK (papel IN (${lista(PAPEIS)})),
      hash TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL
    );
    CREATE TABLE sessoes (
      id TEXT PRIMARY KEY,                      -- SHA-256 do token (o token só existe no cookie)
      utilizador_id INTEGER NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
      criada INTEGER NOT NULL,
      expira INTEGER NOT NULL,
      renovada INTEGER NOT NULL
    );
    CREATE INDEX sessoes_utilizador ON sessoes(utilizador_id);
    CREATE TABLE falhas_login (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      falhas INTEGER NOT NULL,
      bloqueado_ate INTEGER
    );
    CREATE TABLE auditoria (
      id INTEGER PRIMARY KEY,
      quando TEXT NOT NULL,
      utilizador_id INTEGER,
      email TEXT,
      acao TEXT NOT NULL,
      alvo TEXT,
      detalhes TEXT,
      ip TEXT
    );
    CREATE INDEX auditoria_alvo ON auditoria(alvo);
    CREATE TABLE orcamentos (
      id INTEGER PRIMARY KEY,
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'site',
      nome TEXT NOT NULL,
      telefone TEXT,
      email TEXT,
      localidade TEXT,
      servico TEXT NOT NULL,
      mensagem TEXT,
      codigo_cliente TEXT,
      simulacao TEXT,                           -- JSON tal como chegou (≤ 1 MB)
      estado TEXT NOT NULL DEFAULT 'novo' CHECK (estado IN (${lista(ESTADOS_ORCAMENTO)})),
      notas TEXT,
      data_visita TEXT,
      valor_proposta_cent INTEGER,
      motivo_perda TEXT,
      cliente TEXT,
      obra_id INTEGER,
      pedido_id TEXT
    );
    CREATE INDEX orcamentos_estado ON orcamentos(estado);
    CREATE TABLE obras (
      id INTEGER PRIMARY KEY,
      cliente TEXT NOT NULL,
      orcamento_id INTEGER REFERENCES orcamentos(id),
      data TEXT NOT NULL,
      hora TEXT,
      kit TEXT,
      estado TEXT NOT NULL DEFAULT 'agendada' CHECK (estado IN (${lista(ESTADOS_OBRA)})),
      material TEXT NOT NULL DEFAULT '[]',
      horas_estimadas REAL,
      horas_reais REAL,
      notas TEXT,
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL
    );
    CREATE INDEX obras_data ON obras(data);
    CREATE TABLE obra_tecnicos (
      obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      utilizador_id INTEGER NOT NULL REFERENCES utilizadores(id),
      PRIMARY KEY (obra_id, utilizador_id)
    );
    CREATE TABLE fichas_cliente (
      codigo TEXT PRIMARY KEY,
      nome TEXT,
      contacto TEXT,
      localidade TEXT,
      orcamento_id INTEGER,
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL
    );
    CREATE TABLE pedidos_admin (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      cliente TEXT,
      dados TEXT NOT NULL,
      por_id INTEGER,
      por_email TEXT NOT NULL,
      criado TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'concluido', 'erro')),
      concluido TEXT,
      erro TEXT,
      mostrado TEXT,                            -- quando o resultado (com a palavra-passe) foi mostrado
      orcamento_id INTEGER
    );
    CREATE INDEX pedidos_estado ON pedidos_admin(estado);
  `),
  // 2 — catálogo de equipamento e configuração do simulador (docs/SIMULADOR-ORCAMENTO.md §3)
  (db) => {
    db.exec(`
      CREATE TABLE catalogo (
        id INTEGER PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        nome TEXT NOT NULL,
        categoria TEXT NOT NULL CHECK (categoria IN (${lista(CATEGORIAS)})),
        fornecedor TEXT,
        link TEXT,
        preco_compra_cent INTEGER,
        preco_venda_iva_cent INTEGER NOT NULL,
        horas_instalacao REAL NOT NULL DEFAULT 0,
        especificacoes TEXT NOT NULL DEFAULT '{}',
        ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
        visivel_cliente INTEGER NOT NULL DEFAULT 1 CHECK (visivel_cliente IN (0, 1)),
        atualizado TEXT NOT NULL
      );
      CREATE TABLE config_orcamento (
        chave TEXT PRIMARY KEY,
        valor REAL NOT NULL
      );
      INSERT INTO config_orcamento (chave, valor) VALUES
        ('tarifa_hora_iva', 35), ('margem_intervalo_pct', 15), ('deslocacao_iva', 0);
    `);
    const ins = db.prepare(`INSERT INTO catalogo (sku, nome, categoria, fornecedor, link, preco_compra_cent,
      preco_venda_iva_cent, horas_instalacao, especificacoes, ativo, visivel_cliente, atualizado)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`);
    const agora = iso();
    for (const s of SEMENTES_CATALOGO) {
      ins.run(s.sku, s.nome, s.categoria, s.fornecedor ?? null,
        s.preco_compra == null ? null : Math.round(s.preco_compra * 100),
        Math.round(s.preco_venda_iva * 100), s.horas_instalacao, JSON.stringify(s.especificacoes ?? {}),
        s.ativo === false ? 0 : 1, s.visivel_cliente === false ? 0 : 1, agora);
    }
  },
];

export function abrirDb(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;');
  migrar(db);
  return db;
}

export function versaoEsquema(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export function migrar(db) {
  let v = versaoEsquema(db);
  if (v > MIGRACOES.length) throw new Error(`a base de dados é de uma versão mais recente (${v}) do que este programa (${MIGRACOES.length})`);
  while (v < MIGRACOES.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      MIGRACOES[v](db);
      v += 1;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Corre `fn` numa transação (síncrona). */
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
