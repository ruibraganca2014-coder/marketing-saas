// Base de dados SQLite (node:sqlite, sem dependências nativas) e migrações.
// A versão do esquema fica em PRAGMA user_version; cada migração corre uma vez,
// dentro de uma transação, pela ordem da lista.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEMENTES_CATALOGO, SEMENTES_QUADRO, SKUS_MIGRACAO_6, SEMENTES_ACOES, SEMENTES_PONTOS, SEMENTES_PONTOS_20 } from './catalogo-sementes.js';
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
  // ≤ 300 ms a IΔn, referência EN 61008/61009; `ensaio_terra_ohm` < 100 Ω, 801.5.6.1) e a coluna `orcamentos.ensaios`
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
