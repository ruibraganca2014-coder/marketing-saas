// Base de dados SQLite (node:sqlite, sem dependências nativas) e migrações.
// A versão do esquema fica em PRAGMA user_version; cada migração corre uma vez,
// dentro de uma transação, pela ordem da lista.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SKUS_MIGRACAO_6, SEMENTES_ACOES, SEMENTES_PONTOS, SEMENTES_PONTOS_20, HORAS_PONTOS, SEMENTES_DINHEIRO } from './catalogo-sementes.js';
import { SEMENTES_PROCEDIMENTOS } from './procedimentos-sementes.js';
import { iso } from './util.js';

export const ESTADOS_ORCAMENTO = ['novo', 'contactado', 'visita_marcada', 'proposta_enviada', 'aceite', 'perdido'];
/**
 * Pedido anonimizado pelo RGPD (conta apagada, com pagamentos pagos): sai do quadro, das listas e das contagens; só o
 * CEO o vê (filtro "Arquivados"), e continua nos pagamentos e no CSV. Não se escolhe no painel nem se sai dele.
 */
export const ESTADO_ARQUIVADO = 'arquivado';
export const ESTADOS_OBRA = ['agendada', 'em_curso', 'concluida', 'cancelada'];
export const PAPEIS = ['ceo', 'tecnico', 'comercial'];
/**
 * Fases dos pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md). `relatorio`: os 19 € do modelo antigo (relatório técnico
 * e visita; só as linhas que já existem). Fase 3: `relatorio_pormenorizado`, `visita`, `pormenorizado_visita` (os dois
 * de uma vez, no passo Enviar) e `avaria` (diagnóstico + deslocação, pagos ao enviar a avaria rápida).
 */
export const FASES_PAGAMENTO = ['relatorio', 'sinal', 'restante', 'relatorio_pormenorizado', 'visita', 'pormenorizado_visita', 'avaria'];
/** Estados de um pagamento do pedido; `devolvido` (migração 23): pago e depois devolvido por inteiro (visita cancelada). */
export const ESTADOS_PAGAMENTO = ['pendente', 'pago', 'falhado', 'cancelado', 'expirado', 'devolvido'];
/** Devolução manual por transferência (migração 26): à espera do IBAN do cliente → por fazer → devolvido. */
export const ESTADOS_DEVOLUCAO = ['pede_iban', 'por_fazer', 'devolvido'];
/** Motivos de um movimento de stock (migração 22). */
export const MOTIVOS_STOCK = ['entrada', 'reserva', 'libertacao', 'saida', 'acerto'];
/** Eletricistas externos (fase 4, migrações 27 e 28; docs/ELETRICISTAS.md). */
export const ESTADOS_ELETRICISTA = ['pendente', 'aprovado', 'recusado', 'suspenso'];
export const TIPOS_TRABALHO = ['obra', 'visita', 'avaria'];
export const ESTADOS_TRABALHO = ['na_bolsa', 'aceite', 'visita_marcada', 'concluida_eletricista', 'confirmada', 'aprovada', 'paga', 'retirado'];
export const EVENTOS_TRABALHO = ['posto_na_bolsa', 'atribuido', 'aceite', 'visita_marcada', 'largou', 'expirou', 'retirado', 'concluida',
  'confirmada', 'contestada', 'devolvida', 'aprovada', 'paga'];
/** Grupos das fotos que o eletricista tira na obra (migração 29): quadro e pontos, antes e depois. */
export const GRUPOS_FOTO_TRABALHO = ['quadro_antes', 'pontos_antes', 'quadro_depois', 'pontos_depois'];
/**
 * CRM e tarefas (migrações 32 e 33; docs/CRM-TAREFAS.md). Origem do contacto: as categorias do canal (calculadas no
 * navegador) e, desde a migração 33, as respostas a "Como nos conheceu?" (facebook_instagram, recomendacao,
 * eletricista_parceiro, carrinha_rua; google e outro são comuns).
 */
export const ORIGENS_CONTACTO = ['google', 'facebook', 'instagram', 'facebook_instagram', 'recomendacao', 'eletricista_parceiro', 'carrinha_rua', 'direto', 'outro'];
export const MOTIVOS_PERDA = ['preco', 'prazo', 'sem_resposta', 'outro'];
export const TIPOS_REGISTO = ['nota', 'chamada', 'email', 'whatsapp', 'visita'];
export const ESTADOS_TAREFA = ['a_fazer', 'em_curso', 'feito'];
/** Emails automáticos ao cliente (migração 34; docs/EMAILS-AUTOMATICOS.md): os tipos que ficam no registo dos envios. */
export const TIPOS_EMAIL_AUTO = ['boas_vindas', 'visita', 'pagamento_1', 'pagamento_2', 'obra'];
/**
 * Procedimentos (SOP) e checklists por obra (migração 36; docs/PROCEDIMENTOS.md): o tipo de trabalho de cada
 * procedimento e o estado (só o `publicado` é visto pela equipa e pelos eletricistas externos).
 */
export const TIPOS_PROCEDIMENTO = ['visita', 'diagnostico', 'quadro', 'aparelhos', 'carregador', 'entrega', 'outro'];
export const ESTADOS_PROCEDIMENTO = ['rascunho', 'publicado', 'arquivado'];
export const CATEGORIAS = ['disjuntor','interruptor', 'sensor', 'estore', 'tomada', 'luz', 'termostato', 'central', 'acessorio', 'outro'];

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
        ('tarifa_hora_iva', 38), ('margem_intervalo_pct', 15), ('deslocacao_iva', 0);
    `);
    semear(db, SEMENTES_CATALOGO);
  },
  // 3 — artigos do quadro elétrico (proteções, extras, caixas): bases novas e já existentes recebem-nos;
  // INSERT OR IGNORE pelo SKU → sem duplicar e sem mexer num artigo que o CEO já tenha (preço editado ou SKU igual).
  (db) => semear(db, SEMENTES_QUADRO, true),
  // 4 — deslocação por distância (docs/SIMULADOR-ORCAMENTO.md §5.1): base (concelho), km grátis, preço por km
  // (c/ IVA) e distância máxima servida. O `deslocacao_iva` que já existe fica igual e passa a ser o valor
  // fixo (mínimo) de cada deslocação. INSERT OR IGNORE: nunca mexe num valor que o CEO já tenha editado.
  // A base é texto (nome do concelho): a coluna `valor` tem afinidade REAL, e o SQLite guarda como TEXT
  // um valor que não é número (tabela não STRICT).
  (db) => db.exec(`
    INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES
      ('deslocacao_base', 'Lisboa'), ('deslocacao_km_gratis', 20), ('deslocacao_preco_km_iva', 0.4), ('deslocacao_max_km', 100);
  `),
  // 5 — fotos do simulador (POST /api/orcamento/fotos) e leitura automática da foto do quadro.
  // Só acrescenta tabelas e uma coluna: os pedidos que já existem ficam iguais (sem fotos).
  (db) => db.exec(`
    CREATE TABLE fotos_tokens (
      hash TEXT PRIMARY KEY,                    -- SHA-256 do token (o token só vai para o browser)
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      expira INTEGER NOT NULL                   -- ms desde 1970
    );
    CREATE INDEX fotos_tokens_expira ON fotos_tokens(expira);
    CREATE TABLE fotos (
      id TEXT PRIMARY KEY,                      -- 24 hex aleatórios (também o nome do ficheiro)
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,                      -- "quadro" ou "<id da divisão>:<tipo>"
      tipo_mime TEXT NOT NULL CHECK (tipo_mime IN ('image/jpeg', 'image/png')),
      bytes INTEGER NOT NULL,
      legenda TEXT,
      criado TEXT NOT NULL,
      UNIQUE (orcamento_id, chave)
    );
    ALTER TABLE orcamentos ADD COLUMN leitura_quadro TEXT;   -- JSON da leitura automática (ou do erro)
  `),
  // 6 — disjuntor tetrapolar 4P (máquina trifásica com quadro novo; docs/SIMULADOR-ORCAMENTO.md §3 e §4.1).
  // Só os SKUs novos (uma base nova já os recebeu na migração 3); INSERT OR IGNORE: nunca mexe num artigo do CEO
  // nem volta a pôr um artigo do quadro que ele tenha apagado.
  (db) => semear(db, SEMENTES_QUADRO.filter((s) => SKUS_MIGRACAO_6.includes(s.sku)), true),
  // 7 — conta de cliente (docs/CONTA-CLIENTE.md): contas (email + palavra-passe), sessões próprias (separadas das
  // do painel), códigos de 6 dígitos (confirmar o email, repor a palavra-passe), simulação em curso guardada na
  // conta e credenciais MQTT da casa cifradas. Nos orçamentos: a conta, a morada, o texto da proposta e quando o
  // cliente a aceitou online. Os pedidos que já existem ficam sem conta (conta_id NULL) e iguais a antes.
  (db) => db.exec(`
    CREATE TABLE contas (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      hash TEXT NOT NULL,
      confirmado TEXT,                          -- quando o email foi confirmado (ISO) ou NULL
      ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      nome TEXT, telefone TEXT, morada TEXT, localidade TEXT,
      simulacao TEXT,                           -- estado do simulador em curso (JSON), para retomar noutro aparelho
      simulacao_atualizada TEXT,
      casa_codigo TEXT,                         -- código do cliente (MQTT) da casa desta conta
      casa_cifra TEXT,                          -- palavra-passe MQTT da casa, AES-256-GCM com CONTA_CHAVE (iv.tag.cifra, base64)
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL,
      ultimo_acesso TEXT
    );
    CREATE TABLE contas_sessoes (
      id TEXT PRIMARY KEY,                      -- SHA-256 do token (o token só existe no cookie domus_conta)
      conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      criada INTEGER NOT NULL,
      expira INTEGER NOT NULL,
      renovada INTEGER NOT NULL
    );
    CREATE INDEX contas_sessoes_conta ON contas_sessoes(conta_id);
    CREATE TABLE contas_codigos (
      conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('confirmar', 'repor')),
      hash TEXT NOT NULL,                       -- SHA-256 (com a conta e o tipo) do código de 6 dígitos
      expira INTEGER NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conta_id, tipo)
    );
    ALTER TABLE orcamentos ADD COLUMN conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL;
    ALTER TABLE orcamentos ADD COLUMN morada TEXT;
    ALTER TABLE orcamentos ADD COLUMN proposta_texto TEXT;
    ALTER TABLE orcamentos ADD COLUMN proposta_aceite TEXT;   -- quando o cliente carregou em "Aceito a proposta" (ISO)
    CREATE INDEX orcamentos_conta ON orcamentos(conta_id);
  `),
  // 8 — ids de pedidos e de contas nunca reutilizados (AUTOINCREMENT): sem ele, depois de apagar o último (RGPD)
  // o registo seguinte ficava com o mesmo id e herdava a auditoria ("orcamento:<id>", "conta:<id>") de outra pessoa.
  // Recria as duas tabelas pelo procedimento do SQLite (chaves estrangeiras desligadas, ver migrar): mesmas
  // colunas (a partir do CREATE guardado), mesmos dados e índices. A sequência começa no maior id já visto,
  // também na auditoria (um pedido apagado antes desta migração também não volta a ser usado).
  semChaves((db) => {
    for (const [tabela, alvo] of [['orcamentos', 'orcamento'], ['contas', 'conta']]) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela).sql;
      const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, `CREATE TABLE ${tabela}_novo`)
        .replace(/\bid INTEGER PRIMARY KEY\b(?! AUTOINCREMENT)/i, 'id INTEGER PRIMARY KEY AUTOINCREMENT');
      if (!/AUTOINCREMENT/.test(novo)) throw new Error(`migração 8: não foi possível ler o esquema de ${tabela}`);
      const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(tabela).map((x) => x.sql);
      db.exec(novo);
      db.exec(`INSERT INTO ${tabela}_novo SELECT * FROM ${tabela}`);
      db.exec(`DROP TABLE ${tabela}`);
      db.exec(`ALTER TABLE ${tabela}_novo RENAME TO ${tabela}`);
      for (const i of indices) db.exec(i);
      const maxAud = db.prepare(`SELECT MAX(CAST(substr(alvo, ?) AS INTEGER)) AS m FROM auditoria WHERE alvo GLOB ?`)
        .get(alvo.length + 2, `${alvo}:[0-9]*`).m ?? 0;
      const maxId = db.prepare(`SELECT MAX(id) AS m FROM ${tabela}`).get().m ?? 0;
      const seq = Math.max(maxAud, maxId);
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(tabela);
      if (seq) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(tabela, seq);
    }
  }),
  // 9 — pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md): 19 € ao enviar (relatório técnico + visita), sinal de 30 %
  // ao aceitar a proposta e o restante no fim da obra; eventos tratados (idempotência); nos orçamentos, quando o
  // relatório foi libertado ao cliente, o plano mensal escolhido ao aceitar e quando a obra foi dada por concluída.
  // O pedido por pagar fica em `pedido` (JSON) e só passa a orçamento depois de pago; sai ao fim de 24 h.
  (db) => db.exec(`
    CREATE TABLE pagamentos_pedido (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL UNIQUE,                 -- referência aleatória (pp_…): URLs, recibo, Stripe client_reference_id
      conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL,
      orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
      fase TEXT NOT NULL CHECK (fase IN ('relatorio', 'sinal', 'restante')),
      valor_cent INTEGER NOT NULL CHECK (valor_cent > 0),
      descricao TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'pago', 'falhado', 'cancelado', 'expirado')),
      modo TEXT NOT NULL CHECK (modo IN ('simulado', 'stripe')),
      retorno TEXT NOT NULL CHECK (retorno IN ('simulador', 'conta')),
      com_visita INTEGER,                       -- 19 €: 1 com visita técnica, 0 fora da área (só o relatório)
      plano TEXT,                               -- sinal: plano mensal escolhido
      pedido TEXT,                              -- 19 € por pagar: o pedido (JSON) que passa a orçamento ao ser pago
      stripe_sessao TEXT,
      stripe_url TEXT,
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL,
      pago TEXT,
      expira INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX pagamentos_pedido_fase_paga ON pagamentos_pedido(orcamento_id, fase) WHERE estado = 'pago' AND orcamento_id IS NOT NULL;
    CREATE INDEX pagamentos_pedido_conta ON pagamentos_pedido(conta_id);
    CREATE INDEX pagamentos_pedido_orcamento ON pagamentos_pedido(orcamento_id);
    CREATE TABLE pagamentos_eventos (
      id TEXT PRIMARY KEY,                      -- id do evento (Stripe evt_…, simulado evt_sim_…, regresso ret_…)
      recebido TEXT NOT NULL
    );
    ALTER TABLE orcamentos ADD COLUMN relatorio_libertado TEXT;   -- quando o CEO libertou o relatório ao cliente
    ALTER TABLE orcamentos ADD COLUMN plano_escolhido TEXT;       -- base | conforto | premium (ao aceitar a proposta)
    ALTER TABLE orcamentos ADD COLUMN obra_concluida TEXT;        -- quando o painel deu a obra por concluída
  `),
  // 10 — ações por aparelho no simulador (lote 7, docs/SIMULADOR-ORCAMENTO.md §0 e §3): `horas_troca` por artigo (as
  // horas ao substituir; NULL = 50 % das de instalação) e os artigos das ações (diagnóstico de avaria, aparelho normal,
  // troca da ligação de uma máquina). INSERT OR IGNORE: nunca mexe num artigo que o CEO já tenha.
  (db) => {
    db.exec('ALTER TABLE catalogo ADD COLUMN horas_troca REAL');
    semear(db, SEMENTES_ACOES, true);
    const troca = db.prepare('UPDATE catalogo SET horas_troca = ? WHERE sku = ? AND horas_troca IS NULL');
    for (const s of SEMENTES_ACOES) if (s.horas_troca != null) troca.run(s.horas_troca, s.sku);
  },
  // 11 — IVA nos pagamentos online (docs/PAGAMENTOS-PEDIDO.md): a taxa usada em cada pagamento (base e IVA no recibo e
  // no CSV; os antigos, sem ela, eram os 19 € com IVA a 23 %), e pedidos ANONIMIZADOS pelo RGPD (com pagamentos pagos:
  // ficam para a contabilidade sem os dados pessoais, docs/CONTA-CLIENTE.md).
  (db) => db.exec(`
    ALTER TABLE pagamentos_pedido ADD COLUMN iva_pct REAL;
    ALTER TABLE orcamentos ADD COLUMN anonimizado TEXT;       -- quando os dados pessoais saíram (RGPD); o resto fica
  `),
  // 12 — estado "arquivado" dos pedidos anonimizados pelo RGPD (ESTADO_ARQUIVADO): recria `orcamentos` com o CHECK
  // novo (procedimento da migração 8: mesmas colunas, dados, índices e sequência) e arquiva os já anonimizados.
  semChaves((db) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orcamentos'").get().sql;
    const estados = `estado TEXT NOT NULL DEFAULT 'novo' CHECK (estado IN (${lista([...ESTADOS_ORCAMENTO, ESTADO_ARQUIVADO])}))`;
    const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, 'CREATE TABLE orcamentos_novo')
      .replace(/estado TEXT NOT NULL DEFAULT 'novo' CHECK \(estado IN \([^)]*\)\)/i, estados);
    if (!novo.includes(estados)) throw new Error('migração 12: não foi possível ler o esquema de orcamentos');
    const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orcamentos' AND sql IS NOT NULL").all().map((x) => x.sql);
    const seq = Math.max(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orcamentos'").get()?.seq ?? 0,
      db.prepare('SELECT MAX(id) AS m FROM orcamentos').get().m ?? 0);
    db.exec(novo);
    db.exec('INSERT INTO orcamentos_novo SELECT * FROM orcamentos');
    db.exec('DROP TABLE orcamentos');
    db.exec('ALTER TABLE orcamentos_novo RENAME TO orcamentos');
    for (const i of indices) db.exec(i);
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('orcamentos', 'orcamentos_novo')").run();
    if (seq) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('orcamentos', ?)").run(seq);
    db.prepare(`UPDATE orcamentos SET estado = ? WHERE anonimizado IS NOT NULL OR nome = 'Anonimizado (RGPD)'`).run(ESTADO_ARQUIVADO);
  }),
  // 13 — margem dos pacotes do passo "Melhorias" do simulador (fase 2; 20 %). INSERT OR IGNORE: nunca mexe num valor
  // que o CEO já tenha editado.
  (db) => db.exec(`INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('margem_pacotes_pct', 20);`),
  // 14 — fase 3 (monetização, docs/PAGAMENTOS-PEDIDO.md): enviar o pedido é grátis (relatório básico); compram-se à
  // parte o relatório pormenorizado (`preco_relatorio_iva`, 29 €), a visita técnica (deslocação + 0,5 h × tarifa) ou os
  // dois juntos; a avaria rápida paga o diagnóstico e a deslocação ao enviar. Recria `pagamentos_pedido` com as fases
  // novas no CHECK (procedimento da migração 12: mesmas colunas, dados, índices e sequência); as linhas antigas
  // (`relatorio`, os 19 €) ficam como estão. O intervalo da estimativa passa a −10 % / +20 % (`intervalo_menos_pct`,
  // `intervalo_mais_pct`); `margem_intervalo_pct` fica na base (já não é usada). INSERT OR IGNORE: nunca mexe num valor
  // que o CEO já tenha editado.
  semChaves((db) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pagamentos_pedido'").get().sql;
    const fases = `fase TEXT NOT NULL CHECK (fase IN (${lista(FASES_PAGAMENTO)}))`;
    const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, 'CREATE TABLE pagamentos_pedido_novo')
      .replace(/fase TEXT NOT NULL CHECK \(fase IN \([^)]*\)\)/i, fases);
    if (!novo.includes(fases)) throw new Error('migração 14: não foi possível ler o esquema de pagamentos_pedido');
    const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pagamentos_pedido' AND sql IS NOT NULL").all().map((x) => x.sql);
    const seq = Math.max(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'pagamentos_pedido'").get()?.seq ?? 0,
      db.prepare('SELECT MAX(id) AS m FROM pagamentos_pedido').get().m ?? 0);
    db.exec(novo);
    db.exec('INSERT INTO pagamentos_pedido_novo SELECT * FROM pagamentos_pedido');
    db.exec('DROP TABLE pagamentos_pedido');
    db.exec('ALTER TABLE pagamentos_pedido_novo RENAME TO pagamentos_pedido');
    for (const i of indices) db.exec(i);
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('pagamentos_pedido', 'pagamentos_pedido_novo')").run();
    if (seq) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('pagamentos_pedido', ?)").run(seq);
    db.exec(`INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES
      ('intervalo_menos_pct', 10), ('intervalo_mais_pct', 20), ('preco_relatorio_iva', 29);`);
  }),
  // 15 — ronda regras (docs/SIMULADOR-ORCAMENTO.md §0 "Ronda regras"): pontos novos com preço fechado (luz, tomada,
  // tomada dupla, interruptor), aparelhagem dos tipos de comando (comutador de escada, inversor, botão de pressão),
  // campainha e o diferencial tipo A do carregador VE. INSERT OR IGNORE: nunca mexe num artigo que o CEO já tenha.
  (db) => semear(db, SEMENTES_PONTOS, true),
  // 16 — relatório pormenorizado, conteúdo técnico (docs/PAGAMENTOS-PEDIDO.md): a lista de ensaios com os valores de
  // referência editáveis no painel (`ensaio_isolamento_mohm` ≥ 0,5 MΩ a 500 V DC, RTIEBT 612.3; `ensaio_diferencial_ms`
  // ≤ 300 ms a IΔn, referência EN 61008/61009; `ensaio_terra_ohm` ≤ 100 Ω, 801.5.6.1) e a coluna `orcamentos.ensaios`
  // (JSON com os valores medidos na visita/obra, registados no painel). INSERT OR IGNORE: nunca mexe num valor editado.
  (db) => {
    db.exec('ALTER TABLE orcamentos ADD COLUMN ensaios TEXT');
    db.exec(`INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES
      ('ensaio_isolamento_mohm', 0.5), ('ensaio_diferencial_ms', 300), ('ensaio_terra_ohm', 100);`);
  },
  // 17 — ronda B (decisão do dono; docs/PAINEL-EMPRESA.md "Esquema do quadro"): o esquema do quadro elétrico feito pelo
  // eletricista no painel a partir da foto do cliente (`orcamentos.esquema_quadro`, JSON: geral, diferenciais,
  // disjuntores, módulos livres pela ordem da calha, estado, fusíveis, notas; validar.js esquemaQuadro). Só no
  // relatório pormenorizado do cliente.
  (db) => { db.exec('ALTER TABLE orcamentos ADD COLUMN esquema_quadro TEXT'); },
  // 18 — diagnóstico de avarias (docs/PAINEL-EMPRESA.md "Diagnóstico de avarias"): a lista de verificação que o
  // eletricista preenche na ficha dos pedidos de avaria/reparação (`orcamentos.diagnostico`, JSON: verificacoes,
  // valores, tipo, conclusao, data, por; validar.js diagnostico). Só no relatório pormenorizado do cliente.
  (db) => { db.exec('ALTER TABLE orcamentos ADD COLUMN diagnostico TEXT'); },
  // 19 — fotos pelo telemóvel (QR; docs/SIMULADOR-ORCAMENTO.md §6.2, fotos-remotas.js): um token por simulação
  // (24 h; na base só o SHA-256) e as chaves pedidas pelo computador, com a foto recebida do telemóvel (os bytes
  // ficam em FOTOS_DIR/remotas/). Só tabelas novas: nada muda nos pedidos nem nas fotos dos pedidos.
  (db) => db.exec(`
    CREATE TABLE fotos_remotas_tokens (
      hash TEXT PRIMARY KEY,                    -- SHA-256 do token (o token só vai para os dois navegadores)
      sim TEXT NOT NULL,                        -- fotosId da simulação (estado.js)
      expira INTEGER NOT NULL,                  -- ms desde 1970
      seq INTEGER NOT NULL DEFAULT 0,           -- n.º da última foto recebida (o computador pede "desde")
      criado TEXT NOT NULL
    );
    CREATE INDEX fotos_remotas_tokens_expira ON fotos_remotas_tokens(expira);
    CREATE TABLE fotos_remotas (
      token_hash TEXT NOT NULL REFERENCES fotos_remotas_tokens(hash) ON DELETE CASCADE,
      chave TEXT NOT NULL,                      -- "quadro", "avaria:foto_2" ou "<id da divisão>:<tipo>"
      rotulo TEXT,                              -- o que o telemóvel mostra ("Foto do quadro elétrico")
      pedida TEXT NOT NULL,
      id TEXT,                                  -- 24 hex (nome do ficheiro); NULL por receber ou já entregue
      tipo_mime TEXT CHECK (tipo_mime IS NULL OR tipo_mime IN ('image/jpeg', 'image/png')),
      bytes INTEGER,
      seq INTEGER,                              -- n.º de ordem da receção
      recebida TEXT,
      PRIMARY KEY (token_hash, chave)
    );
  `),
  // 20 — ronda sinalizar (docs/SIMULADOR-ORCAMENTO.md §0): a tomada tripla nova (TOMADA-TRIPLA-NOVA, 65 €; `props.caixas`
  // = 3 na planta). INSERT OR IGNORE: nunca mexe num artigo que o CEO já tenha.
  (db) => semear(db, SEMENTES_PONTOS_20, true),
  // 21 — fase 3 da auditoria (docs/CONTA-CLIENTE.md): a conta cria-se só com o email e um código (a palavra-passe é
  // opcional, definida depois na conta): `contas.hash` passa a aceitar NULL e os códigos ganham o tipo 'entrar'
  // (entrar com código). Recria as duas tabelas pelo procedimento da migração 8 (mesmas colunas, dados, índices e
  // sequência); as contas que já existem ficam com a sua palavra-passe.
  semChaves((db) => {
    const recriar = (tabela, de, para) => {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela).sql;
      const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, `CREATE TABLE ${tabela}_novo`).replace(de, para);
      if (!novo.includes(para)) throw new Error(`migração 21: não foi possível ler o esquema de ${tabela}`);
      const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(tabela).map((x) => x.sql);
      const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(tabela)?.seq ?? null;
      db.exec(novo);
      db.exec(`INSERT INTO ${tabela}_novo SELECT * FROM ${tabela}`);
      db.exec(`DROP TABLE ${tabela}`);
      db.exec(`ALTER TABLE ${tabela}_novo RENAME TO ${tabela}`);
      for (const i of indices) db.exec(i);
      db.prepare('DELETE FROM sqlite_sequence WHERE name IN (?, ?)').run(tabela, `${tabela}_novo`);
      if (seq !== null) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(tabela, seq);
    };
    recriar('contas', /hash TEXT NOT NULL,/i, 'hash TEXT,');
    recriar('contas_codigos', /tipo TEXT NOT NULL CHECK \(tipo IN \([^)]*\)\)/i, "tipo TEXT NOT NULL CHECK (tipo IN ('confirmar', 'repor', 'entrar'))");
  }),
  // 22 — stock simples (decisão 13 do dono, docs/PAINEL-EMPRESA.md "Stock"): por artigo, a quantidade em armazém
  // (`stock_qtd`), a reservada para obras aceites (`stock_reservado`) e o mínimo (`stock_minimo`); `stock_movimentos`
  // guarda cada entrada, reserva, libertação, saída e acerto (artigo, quantidade com sinal, pedido, quem, quando). O
  // custo real de compra é o `preco_compra_cent` que já existe. Nada disto sai no /api/catalogo (público).
  (db) => db.exec(`
    ALTER TABLE catalogo ADD COLUMN stock_qtd INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE catalogo ADD COLUMN stock_reservado INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE catalogo ADD COLUMN stock_minimo INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE stock_movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artigo_id INTEGER NOT NULL REFERENCES catalogo(id),
      qtd INTEGER NOT NULL,                     -- com sinal: entrada +, saída −, reserva +, libertação −, acerto ±
      motivo TEXT NOT NULL CHECK (motivo IN (${lista(MOTIVOS_STOCK)})),
      orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
      por TEXT,                                 -- email de quem fez (ou "sistema")
      nota TEXT,
      quando TEXT NOT NULL
    );
    CREATE INDEX stock_movimentos_artigo ON stock_movimentos(artigo_id);
    CREATE INDEX stock_movimentos_orcamento ON stock_movimentos(orcamento_id);
  `),
  // 23 — decisões do dono sobre o dinheiro (docs/PAGAMENTOS-PEDIDO.md "Decisões de 2026-10-02"): a proposta em três
  // partes sem IVA (mão de obra, material, deslocação; NULL nas propostas de um só valor, que continuam a valer);
  // `inicio_imediato` (o cliente pediu para começar já, prescindindo da livre resolução sobre o já executado) e
  // `visita_faltou` (o painel marcou "Cliente faltou"); nos pagamentos, o estado `devolvido` (recria a tabela pelo
  // procedimento da migração 14) e o valor devolvido (`devolvido_cent`: uma devolução parcial deixa o pagamento `pago`);
  // na configuração, a obra mínima (100 € c/ IVA) e o limite do cartão (500 € c/ IVA). INSERT OR IGNORE: nunca mexe
  // num valor que o CEO já tenha editado.
  semChaves((db) => {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pagamentos_pedido'").get().sql;
    const estados = `estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN (${lista(ESTADOS_PAGAMENTO)}))`;
    const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, 'CREATE TABLE pagamentos_pedido_novo')
      .replace(/estado TEXT NOT NULL DEFAULT 'pendente' CHECK \(estado IN \([^)]*\)\)/i, estados);
    if (!novo.includes(estados)) throw new Error('migração 23: não foi possível ler o esquema de pagamentos_pedido');
    const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pagamentos_pedido' AND sql IS NOT NULL").all().map((x) => x.sql);
    const seq = Math.max(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'pagamentos_pedido'").get()?.seq ?? 0,
      db.prepare('SELECT MAX(id) AS m FROM pagamentos_pedido').get().m ?? 0);
    db.exec(novo);
    db.exec('INSERT INTO pagamentos_pedido_novo SELECT * FROM pagamentos_pedido');
    db.exec('DROP TABLE pagamentos_pedido');
    db.exec('ALTER TABLE pagamentos_pedido_novo RENAME TO pagamentos_pedido');
    for (const i of indices) db.exec(i);
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('pagamentos_pedido', 'pagamentos_pedido_novo')").run();
    if (seq) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('pagamentos_pedido', ?)").run(seq);
    db.exec(`
      ALTER TABLE pagamentos_pedido ADD COLUMN devolvido TEXT;          -- quando foi devolvido (ISO)
      ALTER TABLE pagamentos_pedido ADD COLUMN devolvido_cent INTEGER;  -- quanto (parcial: o pagamento continua 'pago')
      ALTER TABLE orcamentos ADD COLUMN proposta_mao_obra_cent INTEGER;
      ALTER TABLE orcamentos ADD COLUMN proposta_material_cent INTEGER;
      ALTER TABLE orcamentos ADD COLUMN proposta_deslocacao_cent INTEGER;
      ALTER TABLE orcamentos ADD COLUMN inicio_imediato TEXT;           -- quando o cliente pediu para começar já (ISO)
      ALTER TABLE orcamentos ADD COLUMN visita_faltou TEXT;             -- quando o painel marcou "Cliente faltou" (ISO)
      INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('obra_minima_iva', 100), ('cartao_max_iva', 500);
    `);
  }),
  // 24 — ronda dinheiro, lado do simulador (docs/SIMULADOR-ORCAMENTO.md §0 "Ronda dinheiro"; decisões 3, 4 e 5 do dono):
  // os pontos novos passam a artigos de PREÇO FECHADO — o preço ao cliente fica o que está (também o que o CEO editou) e
  // ganham as horas de mão de obra que vão lá dentro (HORAS_PONTOS) e a marca `especificacoes.preco_fechado`; só nos que
  // ainda têm 0 horas (um ponto a que o CEO já deu horas fica como ele o deixou). Entram as três linhas dedicadas até
  // 15 m (carregador 390 €, máquina numa casa que já existe 140 €, máquina em instalação nova 70 €; INSERT OR IGNORE) e as horas por dia de obra (`horas_por_dia`, 8: a deslocação é por dia de obra).
  (db) => {
    const fechar = db.prepare(`UPDATE catalogo SET horas_instalacao = ?, especificacoes = json_set(especificacoes, '$.preco_fechado', json('true')), atualizado = ?
      WHERE sku = ? AND horas_instalacao = 0 AND json_valid(especificacoes)`);
    const agora = iso();
    for (const [sku, horas] of Object.entries(HORAS_PONTOS)) fechar.run(horas, agora, sku);
    semear(db, SEMENTES_DINHEIRO, true);
    db.exec(`INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('horas_por_dia', 8);`);
  },
  // 25 — teto da deslocação (decisão do dono, 2026-10-02): a deslocação é ida e volta por dia de obra, no máximo
  // `deslocacao_max_dias` (5) dias por obra. INSERT OR IGNORE: nunca mexe num valor que o CEO já tenha editado.
  (db) => db.exec(`INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('deslocacao_max_dias', 5);`),  // 26 — obra separada da casa e visita a que o cliente faltou (decisões do dono, 2026-10-02; docs/PAGAMENTOS-PEDIDO.md):
  // a obra nasce com o sinal pago, ainda sem data escolhida (`obras.por_agendar` = 1; a casa liga-se depois, com o
  // restante pago: até lá `obras.cliente` fica vazio); um pagamento de visita ou diagnóstico a que o cliente faltou fica
  // `pago` mas marcado (`faltou`, e `faltou_cent` = a parte que não se desconta no sinal) e sai do índice único, para o
  // cliente poder pagar uma visita nova. Devoluções manuais (pagamento por referência Multibanco: transferência
  // bancária feita pelo CEO): `devolucoes_pedido` guarda o valor, o IBAN e o titular dados pelo cliente na conta e quem e
  // quando a marcou como feita; o pagamento fica com `a_devolver` até lá (só conta como devolvido depois de marcada).
  (db) => db.exec(`
    ALTER TABLE obras ADD COLUMN por_agendar INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pagamentos_pedido ADD COLUMN faltou TEXT;
    ALTER TABLE pagamentos_pedido ADD COLUMN faltou_cent INTEGER;
    ALTER TABLE pagamentos_pedido ADD COLUMN metodo TEXT;             -- card | mb_way | multibanco, quando se sabe
    ALTER TABLE pagamentos_pedido ADD COLUMN a_devolver INTEGER;      -- cêntimos de uma devolução manual ainda por fazer
    DROP INDEX pagamentos_pedido_fase_paga;
    CREATE UNIQUE INDEX pagamentos_pedido_fase_paga ON pagamentos_pedido(orcamento_id, fase)
      WHERE estado = 'pago' AND orcamento_id IS NOT NULL AND faltou IS NULL AND a_devolver IS NULL;
    CREATE TABLE devolucoes_pedido (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pagamento_id INTEGER NOT NULL REFERENCES pagamentos_pedido(id),
      conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL,
      orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
      valor_cent INTEGER NOT NULL CHECK (valor_cent > 0),
      motivo TEXT NOT NULL CHECK (motivo IN ('visita', 'diagnostico', 'sinal')),
      estado TEXT NOT NULL CHECK (estado IN (${lista(ESTADOS_DEVOLUCAO)})),
      iban TEXT,                                -- só enquanto a transferência está por fazer; depois fica só o fim
      titular TEXT,
      criado TEXT NOT NULL,
      devolvido TEXT,                           -- quando o CEO marcou "Devolvido"
      devolvido_por TEXT
    );
    CREATE INDEX devolucoes_pedido_estado ON devolucoes_pedido(estado);
  `),
  // 27 — fase 4, ronda 1 (docs/ELETRICISTAS.md): eletricistas externos. A candidatura pública cria a linha `pendente`
  // (nome, contactos, NIF, n.º DGEG, concelhos onde trabalha em JSON, o documento do seguro de responsabilidade civil —
  // os bytes ficam em ELETRICISTAS_DIR, fora da pasta pública — e quando deu o consentimento); o CEO aprova, recusa,
  // suspende ou reativa. Sessões e códigos de 6 dígitos PRÓPRIOS (cookie `domus_eletricista`), separados dos do painel
  // e dos da conta de cliente. `percentagem` NULL = a da configuração (`eletricista_pct`, 70 % da mão de obra sem IVA).
  (db) => db.exec(`
    CREATE TABLE eletricistas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      nif TEXT NOT NULL,
      dgeg TEXT NOT NULL,
      concelhos TEXT NOT NULL DEFAULT '[]',     -- JSON: nomes dos concelhos (painel/public/vendor/concelhos.js)
      experiencia TEXT,
      notas TEXT,                               -- "Que trabalhos faz mais?" (opcional)
      estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN (${lista(ESTADOS_ELETRICISTA)})),
      percentagem REAL,                         -- % da mão de obra (NULL = a da configuração)
      seguro_id TEXT,                           -- 24 hex (nome do ficheiro); NULL sem documento
      seguro_tipo TEXT CHECK (seguro_tipo IS NULL OR seguro_tipo IN ('application/pdf', 'image/jpeg', 'image/png')),
      seguro_bytes INTEGER,
      consentimento TEXT NOT NULL,              -- quando aceitou a Política de Privacidade (ISO)
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL,
      decidido TEXT,                            -- quando o CEO aprovou ou recusou (ISO)
      ultimo_acesso TEXT
    );
    CREATE TABLE eletricistas_sessoes (
      id TEXT PRIMARY KEY,                      -- SHA-256 do token (o token só existe no cookie domus_eletricista)
      eletricista_id INTEGER NOT NULL REFERENCES eletricistas(id) ON DELETE CASCADE,
      criada INTEGER NOT NULL,
      expira INTEGER NOT NULL,
      renovada INTEGER NOT NULL
    );
    CREATE INDEX eletricistas_sessoes_eletricista ON eletricistas_sessoes(eletricista_id);
    CREATE TABLE eletricistas_codigos (
      eletricista_id INTEGER PRIMARY KEY REFERENCES eletricistas(id) ON DELETE CASCADE,
      hash TEXT NOT NULL,                       -- SHA-256 (com o eletricista) do código de 6 dígitos
      expira INTEGER NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('eletricista_pct', 70);
  `),
  // 28 — fase 4, ronda 1: atribuição e bolsa (docs/ELETRICISTAS.md). Um trabalho por pedido e tipo (obra, visita paga ou
  // diagnóstico de avaria): `na_bolsa` → `aceite` (quem e quando) → `visita_marcada`; `retirado` fecha a linha (o CEO
  // retirou-o, ou uma atribuição direta caducou ou foi largada). 48 h depois de aceite sem visita marcada volta à bolsa.
  // `trabalhos_eletricista_eventos` guarda cada passo com o eletricista: quem LARGOU ou deixou CADUCAR um trabalho fica
  // registado (ronda 3: quem larga nunca recebe).
  (db) => db.exec(`
    CREATE TABLE trabalhos_eletricista (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN (${lista(TIPOS_TRABALHO)})),
      estado TEXT NOT NULL CHECK (estado IN (${lista(ESTADOS_TRABALHO)})),
      modo TEXT NOT NULL CHECK (modo IN ('bolsa', 'direto')),
      concelho TEXT NOT NULL,                   -- o concelho do pedido quando o trabalho foi criado
      eletricista_id INTEGER REFERENCES eletricistas(id),
      percentagem REAL,                         -- fixada ao aceitar ou ao atribuir
      aceite_em INTEGER,                        -- ms desde 1970 (o prazo de 48 h conta daqui)
      visita TEXT,                              -- "AAAA-MM-DDTHH:MM", hora de Lisboa
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL
    );
    CREATE UNIQUE INDEX trabalhos_eletricista_ativo ON trabalhos_eletricista(orcamento_id, tipo) WHERE estado != 'retirado';
    CREATE INDEX trabalhos_eletricista_estado ON trabalhos_eletricista(estado);
    CREATE INDEX trabalhos_eletricista_eletricista ON trabalhos_eletricista(eletricista_id);
    CREATE TABLE trabalhos_eletricista_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trabalho_id INTEGER NOT NULL REFERENCES trabalhos_eletricista(id) ON DELETE CASCADE,
      eletricista_id INTEGER REFERENCES eletricistas(id),
      evento TEXT NOT NULL CHECK (evento IN (${lista(EVENTOS_TRABALHO)})),
      quando TEXT NOT NULL,
      por TEXT                                  -- email do CEO, "eletricista:<id>" ou "sistema"
    );
    CREATE INDEX trabalhos_eletricista_eventos_trabalho ON trabalhos_eletricista_eventos(trabalho_id);
    CREATE INDEX trabalhos_eletricista_eventos_eletricista ON trabalhos_eletricista_eventos(eletricista_id, evento);
  `),
  // 29 — fase 4, ronda 2 (docs/ELETRICISTAS.md): a ficha de obra do eletricista. O trabalho ganha o estado
  // `concluida_eletricista` ("Obra concluída": fica à espera da confirmação do cliente, ronda 3) e o evento `concluida`
  // (recria as duas tabelas pelo procedimento da migração 21: mesmas colunas, dados, índices e sequência), a lista do
  // material já recebido (`material_recebido`, JSON) e quando foi concluído (`concluida`). Tabelas novas: as fotos antes
  // e depois (os bytes ficam em ELETRICISTAS_DIR/trabalhos/<trabalho>/) e os avisos por email da bolsa (um por trabalho
  // e eletricista). `eletricistas.anonimizado`: quando o CEO apagou o eletricista (RGPD) e ficou só o histórico.
  semChaves((db) => {
    const recriar = (tabela, de, para) => {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela).sql;
      const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, `CREATE TABLE ${tabela}_novo`).replace(de, para);
      if (!novo.includes(para)) throw new Error(`migração 29: não foi possível ler o esquema de ${tabela}`);
      const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(tabela).map((x) => x.sql);
      const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(tabela)?.seq ?? null;
      db.exec(novo);
      db.exec(`INSERT INTO ${tabela}_novo SELECT * FROM ${tabela}`);
      db.exec(`DROP TABLE ${tabela}`);
      db.exec(`ALTER TABLE ${tabela}_novo RENAME TO ${tabela}`);
      for (const i of indices) db.exec(i);
      db.prepare('DELETE FROM sqlite_sequence WHERE name IN (?, ?)').run(tabela, `${tabela}_novo`);
      if (seq !== null) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(tabela, seq);
    };
    recriar('trabalhos_eletricista', /estado TEXT NOT NULL CHECK \(estado IN \([^)]*\)\)/i, `estado TEXT NOT NULL CHECK (estado IN (${lista(ESTADOS_TRABALHO)}))`);
    recriar('trabalhos_eletricista_eventos', /evento TEXT NOT NULL CHECK \(evento IN \([^)]*\)\)/i, `evento TEXT NOT NULL CHECK (evento IN (${lista(EVENTOS_TRABALHO)}))`);
    db.exec(`
      ALTER TABLE trabalhos_eletricista ADD COLUMN material_recebido TEXT NOT NULL DEFAULT '[]';   -- JSON: nomes do material já levantado ou recebido
      ALTER TABLE trabalhos_eletricista ADD COLUMN concluida TEXT;                                  -- quando o eletricista deu a obra por concluída (ISO)
      ALTER TABLE eletricistas ADD COLUMN anonimizado TEXT;                                         -- quando foi apagado (RGPD) e ficou só o histórico
      CREATE TABLE trabalhos_eletricista_fotos (
        id TEXT PRIMARY KEY,                      -- 24 hex aleatórios (também o nome do ficheiro)
        trabalho_id INTEGER NOT NULL REFERENCES trabalhos_eletricista(id) ON DELETE CASCADE,
        grupo TEXT NOT NULL CHECK (grupo IN (${lista(GRUPOS_FOTO_TRABALHO)})),
        tipo_mime TEXT NOT NULL CHECK (tipo_mime IN ('image/jpeg', 'image/png')),
        bytes INTEGER NOT NULL,
        eletricista_id INTEGER REFERENCES eletricistas(id),
        criado TEXT NOT NULL
      );
      CREATE INDEX trabalhos_eletricista_fotos_trabalho ON trabalhos_eletricista_fotos(trabalho_id);
      CREATE TABLE trabalhos_eletricista_avisos (
        trabalho_id INTEGER NOT NULL REFERENCES trabalhos_eletricista(id) ON DELETE CASCADE,
        eletricista_id INTEGER NOT NULL REFERENCES eletricistas(id) ON DELETE CASCADE,
        quando TEXT NOT NULL,
        PRIMARY KEY (trabalho_id, eletricista_id)
      );
    `);
  }),
  // 30 — fase 4, ronda 3 (docs/ELETRICISTAS.md): confirmação do cliente, aprovação do CEO e pagamento ao eletricista. O
  // trabalho ganha os estados `confirmada` (o cliente disse "Sim", ou passaram 7 dias), `aprovada` (CEO) e `paga`, e os
  // eventos correspondentes (recria as duas tabelas pelo procedimento da migração 29). Colunas novas: a confirmação e a
  // avaliação do cliente (estrelas, comentário, se pode ir para o site), a reclamação ("Não" do cliente ou devolução do
  // CEO) e a decisão do CEO sobre ela (defeito / sem defeito), a aprovação, o valor a pagar FIXADO ao aprovar (com o
  // detalhe), a fatura-recibo do eletricista (os bytes ficam em ELETRICISTAS_DIR/faturas/) e o pagamento. No
  // eletricista, o IBAN para a transferência.
  semChaves((db) => {
    const recriar = (tabela, de, para) => {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela).sql;
      const novo = sql.replace(/^CREATE TABLE "?\w+"?/i, `CREATE TABLE ${tabela}_novo`).replace(de, para);
      if (!novo.includes(para)) throw new Error(`migração 30: não foi possível ler o esquema de ${tabela}`);
      const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(tabela).map((x) => x.sql);
      const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(tabela)?.seq ?? null;
      db.exec(novo);
      db.exec(`INSERT INTO ${tabela}_novo SELECT * FROM ${tabela}`);
      db.exec(`DROP TABLE ${tabela}`);
      db.exec(`ALTER TABLE ${tabela}_novo RENAME TO ${tabela}`);
      for (const i of indices) db.exec(i);
      db.prepare('DELETE FROM sqlite_sequence WHERE name IN (?, ?)').run(tabela, `${tabela}_novo`);
      if (seq !== null) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(tabela, seq);
    };
    recriar('trabalhos_eletricista', /estado TEXT NOT NULL CHECK \(estado IN \([^)]*\)\)/i, `estado TEXT NOT NULL CHECK (estado IN (${lista(ESTADOS_TRABALHO)}))`);
    recriar('trabalhos_eletricista_eventos', /evento TEXT NOT NULL CHECK \(evento IN \([^)]*\)\)/i, `evento TEXT NOT NULL CHECK (evento IN (${lista(EVENTOS_TRABALHO)}))`);
    db.exec(`
      ALTER TABLE trabalhos_eletricista ADD COLUMN confirmada TEXT;             -- quando o cliente confirmou (ou foi aceite ao fim de 7 dias)
      ALTER TABLE trabalhos_eletricista ADD COLUMN confirmada_auto INTEGER;     -- 1 = aceite automaticamente (sem resposta do cliente)
      ALTER TABLE trabalhos_eletricista ADD COLUMN estrelas INTEGER CHECK (estrelas IS NULL OR estrelas BETWEEN 1 AND 5);
      ALTER TABLE trabalhos_eletricista ADD COLUMN comentario TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN comentario_site INTEGER;     -- 1 = o cliente deixa usar o comentário no site
      ALTER TABLE trabalhos_eletricista ADD COLUMN reclamacao TEXT;             -- o que falta (cliente) ou o motivo da devolução (CEO)
      ALTER TABLE trabalhos_eletricista ADD COLUMN reclamacao_de TEXT CHECK (reclamacao_de IS NULL OR reclamacao_de IN ('cliente', 'ceo'));
      ALTER TABLE trabalhos_eletricista ADD COLUMN reclamacao_quando TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN reclamacao_decisao TEXT CHECK (reclamacao_decisao IS NULL OR reclamacao_decisao IN ('defeito', 'sem_defeito'));
      ALTER TABLE trabalhos_eletricista ADD COLUMN reclamacao_decidida TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN aprovada TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN aprovada_por TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN valor_cent INTEGER;          -- a pagar ao eletricista (sem IVA), fixado ao aprovar
      ALTER TABLE trabalhos_eletricista ADD COLUMN valor_detalhe TEXT;          -- JSON: percentagem, mão de obra, parte, deslocação, total
      ALTER TABLE trabalhos_eletricista ADD COLUMN fatura_id TEXT;              -- 24 hex (nome do ficheiro da fatura-recibo)
      ALTER TABLE trabalhos_eletricista ADD COLUMN fatura_tipo TEXT CHECK (fatura_tipo IS NULL OR fatura_tipo IN ('application/pdf', 'image/jpeg', 'image/png'));
      ALTER TABLE trabalhos_eletricista ADD COLUMN fatura_bytes INTEGER;
      ALTER TABLE trabalhos_eletricista ADD COLUMN fatura_quando TEXT;
      ALTER TABLE trabalhos_eletricista ADD COLUMN paga TEXT;                   -- quando o CEO marcou "Pago"
      ALTER TABLE trabalhos_eletricista ADD COLUMN paga_por TEXT;
      ALTER TABLE eletricistas ADD COLUMN iban TEXT;                            -- para a transferência (PT50…, validado)
    `);
  }),
  // 31 — fase 4, ronda 3 (decisão do dono, docs/ELETRICISTAS.md "Ida sem defeito"): depois de um "Não" do cliente em que
  // o CEO decide "sem defeito", o eletricista recebe essa ida (percentagem × a meia hora sem IVA + deslocação sem IVA)
  // numa linha própria: valor fixado na decisão, com a sua fatura-recibo e o seu "Pago". `regresso_desde` é a data da
  // decisão (o pagamento da visita pelo cliente conta a partir dela).
  (db) => db.exec(`
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_desde TEXT;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_cent INTEGER;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_detalhe TEXT;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_fatura_id TEXT;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_fatura_tipo TEXT CHECK (regresso_fatura_tipo IS NULL OR regresso_fatura_tipo IN ('application/pdf', 'image/jpeg', 'image/png'));
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_fatura_bytes INTEGER;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_fatura_quando TEXT;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_paga TEXT;
    ALTER TABLE trabalhos_eletricista ADD COLUMN regresso_paga_por TEXT;
  `),
  // 32 — CRM e quadro de tarefas (decisões do dono de 2026-10-03; docs/CRM-TAREFAS.md). A ficha do cliente
  // (`crm_clientes`: uma por pessoa, derivada dos pedidos — mesma conta, email ou telefone — e fundível à mão pelo CEO),
  // as notas e os contactos da equipa (`crm_registos`), e nos pedidos o responsável, a origem do contacto (categoria do
  // canal e a página de anúncio de entrada, nunca o endereço de onde veio) e o tipo do motivo de perda. As fases do
  // negócio são os estados que o pedido já tem (novo → contactado → visita → proposta → aceite → perdido). Tarefas com
  // checklist (JSON), prazo e responsável (NULL = os CEO); os lembretes automáticos têm uma chave única (`lembrete`:
  // pedido, tipo e o início da fase), por isso nunca se repetem.
  (db) => db.exec(`
    CREATE TABLE crm_clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      email TEXT COLLATE NOCASE,
      telefone TEXT,
      conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL,
      responsavel_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
      anonimizado TEXT,                         -- quando os dados pessoais saíram (RGPD: conta apagada)
      criado TEXT NOT NULL,
      atualizado TEXT NOT NULL
    );
    ALTER TABLE orcamentos ADD COLUMN crm_cliente_id INTEGER REFERENCES crm_clientes(id) ON DELETE SET NULL;
    ALTER TABLE orcamentos ADD COLUMN responsavel_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL;
    ALTER TABLE orcamentos ADD COLUMN origem_contacto TEXT CHECK (origem_contacto IS NULL OR origem_contacto IN ('google','facebook','instagram','direto','outro'));
    ALTER TABLE orcamentos ADD COLUMN origem_entrada TEXT;    -- ?servico= da página de anúncio (carregador, quadro-antigo)
    ALTER TABLE orcamentos ADD COLUMN motivo_perda_tipo TEXT CHECK (motivo_perda_tipo IS NULL OR motivo_perda_tipo IN (${lista(MOTIVOS_PERDA)}));
    CREATE INDEX orcamentos_crm_cliente ON orcamentos(crm_cliente_id);
    CREATE TABLE crm_registos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES crm_clientes(id) ON DELETE CASCADE,
      orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL CHECK (tipo IN (${lista(TIPOS_REGISTO)})),
      quando TEXT NOT NULL,                     -- quando foi o contacto ("AAAA-MM-DDTHH:MM", hora de Lisboa)
      texto TEXT NOT NULL,
      por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
      por_email TEXT,
      criado TEXT NOT NULL
    );
    CREATE INDEX crm_registos_cliente ON crm_registos(cliente_id);
    CREATE TABLE tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descricao TEXT,
      cliente_id INTEGER REFERENCES crm_clientes(id) ON DELETE SET NULL,
      orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
      obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
      responsavel_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,   -- NULL = os CEO
      prazo TEXT,                               -- "AAAA-MM-DD" (dia de Lisboa)
      prazo_hora TEXT,                          -- "HH:MM" (opcional)
      estado TEXT NOT NULL DEFAULT 'a_fazer' CHECK (estado IN (${lista(ESTADOS_TAREFA)})),
      checklist TEXT NOT NULL DEFAULT '[]',     -- JSON: [{texto, feito}]
      lembrete TEXT UNIQUE,                     -- lembrete automático: "<pedido>:<tipo>:<início da fase>"; NULL nas feitas à mão
      cancelada TEXT,                           -- lembrete cancelado sozinho (a fase avançou); sai do quadro
      criado TEXT NOT NULL,
      criado_por TEXT NOT NULL,                 -- email de quem criou, ou "sistema"
      criado_por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
      feito TEXT,
      feito_por TEXT,
      atualizado TEXT NOT NULL
    );
    CREATE INDEX tarefas_responsavel ON tarefas(responsavel_id, estado);
    CREATE INDEX tarefas_prazo ON tarefas(prazo);
    CREATE INDEX tarefas_orcamento ON tarefas(orcamento_id);
  `),
  // 33 — CRM e tarefas, segunda ronda (decisões do dono de 2026-10-03; docs/CRM-TAREFAS.md). Origem do contacto com as
  // respostas a "Como nos conheceu?": a coluna é trocada por outra com a lista nova no CHECK (os valores guardados
  // continuam válidos). `orcamentos.crm_separado`: quando o CEO separou o pedido da ficha onde estava (a ligação
  // automática não o volta a juntar). `utilizadores.resumo_tarefas_dia`: o último dia (Lisboa) em que o email diário
  // das tarefas foi tratado para esse utilizador (nunca dois no mesmo dia, mesmo com o painel reiniciado). Prazos dos
  // lembretes automáticos, editáveis pelo CEO (Tarefas): pedido novo em dias úteis, proposta por enviar depois da
  // visita e as três etapas da proposta sem resposta, em dias.
  (db) => db.exec(`
    ALTER TABLE orcamentos ADD COLUMN origem_contacto_33 TEXT CHECK (origem_contacto_33 IS NULL OR origem_contacto_33 IN (${lista(ORIGENS_CONTACTO)}));
    UPDATE orcamentos SET origem_contacto_33 = origem_contacto;
    ALTER TABLE orcamentos DROP COLUMN origem_contacto;
    ALTER TABLE orcamentos RENAME COLUMN origem_contacto_33 TO origem_contacto;
    ALTER TABLE orcamentos ADD COLUMN crm_separado TEXT;
    ALTER TABLE utilizadores ADD COLUMN resumo_tarefas_dia TEXT;
    INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('lembrete_novo_dias_uteis', 1), ('lembrete_visita_dias', 2),
      ('lembrete_proposta_1_dias', 3), ('lembrete_proposta_2_dias', 7), ('lembrete_proposta_3_dias', 14);
  `),
  // 34 — emails automáticos ao cliente (decisões do dono de 2026-10-03; docs/EMAILS-AUTOMATICOS.md). `emails_automaticos`:
  // o registo dos envios — uma linha por email, com uma chave única (nunca sai duas vezes, também depois de reiniciar),
  // sem o endereço nem o corpo; sai com o pedido. `emails_recusados`: quem carregou em "Não quero receber" (por email,
  // em minúsculas). `emails_chave`: o segredo (uma linha) que assina a ligação "Não quero receber". A avaliação do
  // trabalho na conta (1 a 5 estrelas) quando a obra não passou por um eletricista externo. Os prazos, editáveis pelo
  // CEO (Tarefas): 1.º e 2.º lembrete do pagamento em falta, o email depois da obra (dias) e a hora do lembrete da visita.
  (db) => {
    db.exec(`
      CREATE TABLE emails_automaticos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT NOT NULL UNIQUE,               -- "<pedido>:<tipo>[:<fase>][:<data da visita ou do pedido de pagamento>]"
        orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN (${lista(TIPOS_EMAIL_AUTO)})),
        quando TEXT NOT NULL
      );
      CREATE INDEX emails_automaticos_orcamento ON emails_automaticos(orcamento_id);
      CREATE TABLE emails_recusados (
        email TEXT PRIMARY KEY,                   -- em minúsculas
        quando TEXT NOT NULL
      );
      CREATE TABLE emails_chave (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chave TEXT NOT NULL
      );
      ALTER TABLE orcamentos ADD COLUMN avaliacao_estrelas INTEGER CHECK (avaliacao_estrelas IS NULL OR avaliacao_estrelas BETWEEN 1 AND 5);
      ALTER TABLE orcamentos ADD COLUMN avaliacao_quando TEXT;
      INSERT OR IGNORE INTO config_orcamento (chave, valor) VALUES ('email_pagamento_1_dias', 3), ('email_pagamento_2_dias', 7),
        ('email_obra_dias', 2), ('email_visita_hora', 10);
    `);
    db.prepare('INSERT INTO emails_chave (id, chave) VALUES (1, ?)').run(randomBytes(32).toString('hex'));
  },
  // 35 — os emails automáticos só contam a partir da publicação (decisão do dono; docs/EMAILS-AUTOMATICOS.md §2):
  // `emails_chave.inicio` guarda o instante em que esta migração correu. O que aconteceu antes (pedido recebido,
  // proposta aceite, obra concluída) nunca recebe um email automático nem a tarefa do pagamento em falta.
  (db) => {
    db.exec('ALTER TABLE emails_chave ADD COLUMN inicio TEXT');
    db.prepare('UPDATE emails_chave SET inicio = ? WHERE id = 1').run(iso());
  },
  // 36 — procedimentos (SOP / base de conhecimento) e checklists por obra (decisões do dono de 2026-10-03;
  // docs/PROCEDIMENTOS.md). `procedimentos`: a cópia de trabalho do CEO (título, tipo de trabalho, descrição e os passos
  // em JSON), o estado e o número da última versão publicada (0 = nunca). `procedimentos_versoes`: cada publicação,
  // imutável — é o que a equipa e os eletricistas leem, e o que uma checklist já começada continua a usar.
  // `obra_checklists`: a checklist de um procedimento numa obra (cada procedimento uma vez por obra), presa à versão com
  // que começou. `obra_checklist_passos`: os passos marcados (o índice do passo nessa versão), com quem e quando — um
  // utilizador do painel ou um eletricista externo. As sementes (um rascunho por tipo de trabalho, `por_rever`) só
  // entram com a tabela vazia.
  (db) => {
    db.exec(`
      CREATE TABLE procedimentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN (${lista(TIPOS_PROCEDIMENTO)})),
        descricao TEXT,
        passos TEXT NOT NULL DEFAULT '[]',        -- JSON: [{texto, nota, obrigatorio, seguranca}]
        estado TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN (${lista(ESTADOS_PROCEDIMENTO)})),
        versao INTEGER NOT NULL DEFAULT 0,        -- a última versão publicada (0 = nunca publicado)
        por_rever INTEGER NOT NULL DEFAULT 0 CHECK (por_rever IN (0, 1)),   -- rascunho de arranque ainda não revisto
        criado TEXT NOT NULL,
        criado_por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
        atualizado TEXT NOT NULL
      );
      CREATE TABLE procedimentos_versoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedimento_id INTEGER NOT NULL REFERENCES procedimentos(id) ON DELETE CASCADE,
        versao INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        tipo TEXT NOT NULL,
        descricao TEXT,
        passos TEXT NOT NULL,
        publicado TEXT NOT NULL,
        publicado_por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
        UNIQUE (procedimento_id, versao)
      );
      CREATE TABLE obra_checklists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        obra_id INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
        procedimento_id INTEGER NOT NULL REFERENCES procedimentos(id),
        versao_id INTEGER NOT NULL REFERENCES procedimentos_versoes(id),
        iniciada TEXT NOT NULL,
        iniciada_por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
        iniciada_por_eletricista_id INTEGER REFERENCES eletricistas(id) ON DELETE SET NULL,
        UNIQUE (obra_id, procedimento_id)
      );
      CREATE TABLE obra_checklist_passos (
        checklist_id INTEGER NOT NULL REFERENCES obra_checklists(id) ON DELETE CASCADE,
        passo INTEGER NOT NULL,                   -- índice do passo na versão da checklist (0, 1, 2…)
        quando TEXT NOT NULL,
        por_id INTEGER REFERENCES utilizadores(id) ON DELETE SET NULL,
        por_eletricista_id INTEGER REFERENCES eletricistas(id) ON DELETE SET NULL,
        PRIMARY KEY (checklist_id, passo)
      );
    `);
    if (db.prepare('SELECT COUNT(*) AS n FROM procedimentos').get().n) return;
    const ins = db.prepare("INSERT INTO procedimentos (titulo, tipo, descricao, passos, estado, versao, por_rever, criado, atualizado) VALUES (?, ?, ?, ?, 'rascunho', 0, 1, ?, ?)");
    const agora = iso();
    for (const p of SEMENTES_PROCEDIMENTOS) ins.run(p.titulo, p.tipo, p.descricao, JSON.stringify(p.passos), agora, agora);
  },
  // 37: assistente (IA) do pedido (docs/ASSISTENTE-IA.md). `ia` = JSON {resumo, diagnostico}: o último resultado de cada
  // botão, com a data, quem pediu, o modelo e o custo estimado. Só para a equipa; sai com a anonimização do pedido.
  (db) => db.exec('ALTER TABLE orcamentos ADD COLUMN ia TEXT;'),
  // 38: conversa do pedido (docs/ASSISTENTE-IA.md §9): os emails que a equipa envia por "Escrever ao cliente" e as
  // respostas que o cliente escreve na conta. `por_email`: quem da equipa enviou (o cliente nunca o vê). Sai com o
  // pedido (cascata) e com a anonimização.
  (db) => db.exec(`
    CREATE TABLE mensagens_pedido (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      de TEXT NOT NULL CHECK (de IN ('equipa', 'cliente')),
      assunto TEXT,
      texto TEXT NOT NULL,
      por_email TEXT,
      criado TEXT NOT NULL
    );
    CREATE INDEX mensagens_pedido_orcamento ON mensagens_pedido(orcamento_id, id);
  `),
  // 39: proposta do eletricista depois da visita (decisão do dono, 2026-10-04; docs/ELETRICISTAS.md "Proposta do
  // eletricista"): JSON {horas, material: [{sku, qtd}], notas, quando} — nunca valores em euros (o painel calcula-os).
  (db) => db.exec('ALTER TABLE trabalhos_eletricista ADD COLUMN proposta TEXT;'),
  // 40: "Casa registada" (decisão do dono, 2026-10-04; docs/SIMULADOR-ORCAMENTO.md "Duas partes"): quando o cliente
  // acabou de descrever a casa no simulador (com conta), antes de pedir qualquer serviço. A casa é a `simulacao` da conta.
  (db) => db.exec('ALTER TABLE contas ADD COLUMN casa_registada TEXT;'),
];

/** Migração que recria tabelas: corre com as chaves estrangeiras desligadas (senão o DROP apagava em cascata). */
function semChaves(fn) {
  fn.semChavesEstrangeiras = true;
  return fn;
}

/** Insere sementes do catálogo; `seExistir`: salta os SKUs que já existem (nunca altera um artigo). */
function semear(db, sementes, seExistir = false) {
  const ins = db.prepare(`INSERT ${seExistir ? 'OR IGNORE ' : ''}INTO catalogo (sku, nome, categoria, fornecedor, link, preco_compra_cent,
    preco_venda_iva_cent, horas_instalacao, especificacoes, ativo, visivel_cliente, atualizado)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`);
  const agora = iso();
  for (const s of sementes) {
    ins.run(s.sku, s.nome, s.categoria, s.fornecedor ?? null,
      s.preco_compra == null ? null : Math.round(s.preco_compra * 100),
      Math.round(s.preco_venda_iva * 100), s.horas_instalacao, JSON.stringify(s.especificacoes ?? {}),
      s.ativo === false ? 0 : 1, s.visivel_cliente === false ? 0 : 1, agora);
  }
}

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
    const migracao = MIGRACOES[v];
    // PRAGMA foreign_keys não muda dentro de uma transação: desliga antes e verifica tudo antes do COMMIT.
    // Só falha se a migração criar referências inválidas (as que já existissem antes não contam).
    const fk = migracao.semChavesEstrangeiras ? db.prepare('PRAGMA foreign_keys').get().foreign_keys : null;
    if (fk) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      const invalidas = migracao.semChavesEstrangeiras ? db.prepare('PRAGMA foreign_key_check').all().length : 0;
      migracao(db);
      if (migracao.semChavesEstrangeiras && db.prepare('PRAGMA foreign_key_check').all().length > invalidas) {
        throw new Error(`migração ${v + 1}: chaves estrangeiras inválidas`);
      }
      v += 1;
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      if (fk) db.exec('PRAGMA foreign_keys = ON');
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
