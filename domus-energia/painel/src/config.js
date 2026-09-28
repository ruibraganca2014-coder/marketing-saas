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
  const mqttSenha = env.PAINEL_MQTT_PASS || env.MQTT_PASS || '';
  if (!mqttSenha) avisos.push('sem PAINEL_MQTT_PASS: os alertas técnicos ficam desligados');
  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) avisos.push('sem ANTHROPIC_API_KEY: a leitura automática da foto do quadro fica desligada');
  return {
    porta: Number(env.PORTA || 8080),
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
    avisos,
  };
}
