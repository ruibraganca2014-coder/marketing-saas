// Configuração a partir das variáveis de ambiente (ver README).

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

export function lerConfig(env = process.env) {
  const dados = env.DADOS_DIR || '/dados';
  const origens = String(env.PAINEL_ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.DOMUS_HOST) origens.push(`https://${env.DOMUS_HOST}`);
  if (env.PUBLIC_URL) {
    try { origens.push(new URL(env.PUBLIC_URL).origin); } catch { /* ignorado */ }
  }
  const avisos = [];
  const origensValidas = [];
  for (const o of origens) {
    try {
      const u = new URL(o);
      if (u.origin !== o.replace(/\/$/, '')) throw new Error();
      origensValidas.push(u.origin);
    } catch {
      avisos.push(`origem inválida ignorada: ${o}`);
    }
  }
  if (!origensValidas.length) avisos.push('sem DOMUS_HOST/PAINEL_ORIGENS: todos os pedidos que alteram dados serão recusados');
  // Site público servido noutra origem do mesmo domínio (ex.: https://domusenergia.pt → API em https://api.domusenergia.pt):
  // CORS com credenciais só para estas origens, e só nas rotas públicas (/api/orcamento*, /api/catalogo, /api/conta/*).
  // Só https:// (o cookie da conta vai com credenciais); http:// só para localhost, *.localhost e 127.0.0.1/[::1].
  const siteOrigens = [];
  for (const o of String(env.SITE_ORIGENS || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    try {
      const u = new URL(o);
      if (u.origin !== o.replace(/\/$/, '') || !/^https?:$/.test(u.protocol)) throw new Error();
      const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
      if (u.protocol === 'http:' && !local) {
        avisos.push(`SITE_ORIGENS: origem sem https ignorada: ${o} (http:// só para localhost)`);
        continue;
      }
      siteOrigens.push(u.origin);
    } catch {
      avisos.push(`SITE_ORIGENS: origem inválida ignorada: ${o}`);
    }
  }
  // Conta de cliente: chave (32 bytes, hex ou base64) para guardar cifradas as credenciais MQTT da casa.
  let contaChave = null;
  const ch = String(env.CONTA_CHAVE || '').trim();
  if (ch) {
    const b = /^[0-9a-fA-F]{64}$/.test(ch) ? Buffer.from(ch, 'hex') : Buffer.from(ch, 'base64');
    if (b.length === 32) contaChave = b;
    else avisos.push('CONTA_CHAVE inválida (32 bytes: 64 caracteres hex, ou base64): a área de cliente não abre com o email');
  } else {
    avisos.push('sem CONTA_CHAVE: a conta de cliente não guarda as credenciais da casa (a área de cliente só entra com o código)');
  }
  const smtpHost = String(env.SMTP_HOST || '').trim();
  const smtpPorta = Number(env.SMTP_PORTA || 587);
  if (!smtpHost && env.EMAIL_LOCAL !== '1') avisos.push('sem SMTP_HOST: os emails das contas de cliente (códigos) ficam só no registo do painel');
  const mqttSenha = env.PAINEL_MQTT_PASS || env.MQTT_PASS || '';
  if (!mqttSenha) avisos.push('sem PAINEL_MQTT_PASS: os alertas técnicos ficam desligados');
  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) avisos.push('sem ANTHROPIC_API_KEY: a leitura automática da foto do quadro fica desligada');
  // Pagamentos do pedido (docs/PAGAMENTOS-PEDIDO.md): "simulado" (por omissão sem STRIPE_SECRET_KEY) ou "stripe".
  const stripeChave = String(env.STRIPE_SECRET_KEY || '').trim();
  const modoPedido = String(env.PAGAMENTOS_MODO || '').trim().toLowerCase();
  if (modoPedido && !['simulado', 'stripe'].includes(modoPedido)) avisos.push(`PAGAMENTOS_MODO inválido ("${modoPedido}"): usa-se ${stripeChave ? 'stripe' : 'simulado'}`);
  const pagamentosModo = ['simulado', 'stripe'].includes(modoPedido) ? modoPedido : (stripeChave ? 'stripe' : 'simulado');
  const pagamentoPedido = env.PAGAMENTO_PEDIDO !== '0';
  if (pagamentoPedido && pagamentosModo === 'simulado') avisos.push('PAGAMENTOS_MODO=simulado: os pagamentos dos pedidos são SIMULADOS (não é cobrado nada; qualquer pessoa pode "pagar")');
  if (pagamentoPedido && pagamentosModo === 'stripe' && !stripeChave) avisos.push('PAGAMENTOS_MODO=stripe sem STRIPE_SECRET_KEY: o envio de pedidos com simulação responde 503');
  if (pagamentoPedido && pagamentosModo === 'stripe' && !env.STRIPE_PEDIDO_WEBHOOK_SECRET) avisos.push('sem STRIPE_PEDIDO_WEBHOOK_SECRET: o webhook dos pagamentos do pedido está desligado (a confirmação fica só no regresso do cliente)');
  return {
    porta: Number(env.PORTA || 8080),
    anfitriao: env.ANFITRIAO || undefined,   // sem ele: todas as interfaces (como antes); o lançador local usa 127.0.0.1
    db: env.PAINEL_DB || join(dados, 'painel', 'painel.db'),
    planosDir: env.PLANOS_DIR || join(dados, 'planos'),
    clientesDir: env.CLIENTES_DIR || join(dados, 'clientes'),
    pagamentosCsv: env.PAGAMENTOS_CSV || join(dados, 'pagamentos', 'pagamentos.csv'),
    pedidosDir: env.PEDIDOS_DIR || join(dados, 'pedidos-admin'),
    publicDir: env.PUBLIC_DIR || join(AQUI, '..', 'public'),
    mqtt: {
      url: env.MQTT_URL || 'mqtt://mosquitto:1883',
      utilizador: env.MQTT_USER || 'painel',
      senha: mqttSenha,
    },
    origens: [...new Set(origensValidas)],
    confiarProxy: env.CONFIAR_PROXY === '1',
    ceoEmail: env.PAINEL_CEO_EMAIL || '',
    ceoPass: env.PAINEL_CEO_PASS || '',
    sessaoMs: 12 * 3600_000,                 // inatividade máxima (renovada a cada pedido)
    sessaoMaxMs: 7 * 24 * 3600_000,          // duração máxima absoluta
    limiteLogin: 5,                          // tentativas por minuto, por IP e por email
    falhasBloqueio: 10,                      // falhas seguidas → bloqueio
    bloqueioMs: 15 * 60_000,
    limiteOrcamentoHora: Number(env.LIMITE_ORCAMENTO_HORA || 5),     // por IP
    limiteOrcamentoGlobal: Number(env.LIMITE_ORCAMENTO_GLOBAL || 200), // todos os IPs, por hora
    pedidosPollMs: Number(env.PEDIDOS_POLL_MS || 3000),
    // Fotos do simulador (POST /api/orcamento/fotos): fora da pasta pública, uma pasta por pedido.
    fotosDir: env.FOTOS_DIR || join(dados, 'painel', 'fotos'),
    limiteFotosHora: Number(env.LIMITE_FOTOS_HORA || 120),         // fotos por hora, por IP
    // Leitura automática da foto do quadro (modelo de visão Claude). Sem chave → desligada.
    anthropicKey,
    leituraTimeoutMs: Number(env.LEITURA_QUADRO_TIMEOUT_MS || 60_000),  // por tentativa (há 1 tentativa extra)
    resultadoRetencaoMs: 7 * 24 * 3600_000,  // resultados nunca vistos são apagados ao fim de 7 dias
    // Conta de cliente (docs/CONTA-CLIENTE.md)
    siteOrigens: [...new Set(siteOrigens)],
    contaChave,
    contaSessaoMs: 7 * 24 * 3600_000,        // inatividade máxima da sessão da conta (renovada a cada pedido)
    contaSessaoMaxMs: 30 * 24 * 3600_000,    // duração máxima absoluta
    smtp: smtpHost ? {
      host: smtpHost,
      porta: smtpPorta,
      utilizador: String(env.SMTP_UTILIZADOR || ''),
      password: String(env.SMTP_PASSWORD || ''),
      // 465 = TLS direto; as outras portas STARTTLS obrigatório. "nenhuma" só para testes/servidores locais.
      seguranca: ['tls', 'starttls', 'nenhuma'].includes(env.SMTP_SEGURANCA) ? env.SMTP_SEGURANCA : (smtpPorta === 465 ? 'tls' : 'starttls'),
      timeoutMs: Number(env.SMTP_TIMEOUT_MS || 20_000),
    } : null,
    emailRemetente: String(env.EMAIL_REMETENTE || '').trim(),
    emailLocal: env.EMAIL_LOCAL === '1',     // modo local: os emails vão sempre para o registo (nunca SMTP)
    // Pagamentos do pedido (19 €, sinal, restante): docs/PAGAMENTOS-PEDIDO.md
    pagamentoPedido,                         // PAGAMENTO_PEDIDO=0: o pedido com simulação é enviado sem pagar (como antes)
    pagamentosModo,
    stripeChave: stripeChave || null,
    stripeWebhookSegredo: String(env.STRIPE_PEDIDO_WEBHOOK_SECRET || '').trim() || null,
    stripeApi: String(env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/+$/, ''),
    stripeMetodos: String(env.STRIPE_PEDIDO_METODOS || 'card,mb_way,multibanco').split(',').map((x) => x.trim()).filter((x) => /^[a-z_]{2,40}$/.test(x)),
    // Endereço do site nos emails (ligação para a conta).
    siteUrl: String(env.SITE_URL || siteOrigens[0] || env.PUBLIC_URL || (env.DOMUS_HOST ? `https://${env.DOMUS_HOST}` : '')).replace(/\/+$/, ''),
    avisos,
  };
}
