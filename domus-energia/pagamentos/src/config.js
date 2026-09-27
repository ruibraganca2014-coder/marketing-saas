// Configuração a partir das variáveis de ambiente (ver README e servidor/.env.example).
//
// Dois níveis de erro, para o serviço nunca impedir o resto do servidor de arrancar:
//  - `erros`: falta o essencial (MQTT, segredo das sessões, URL pública) → o
//    serviço responde 503 a tudo e regista o que falta;
//  - `errosStripe`: falta a configuração do Stripe → /api/sessao e a
//    publicação de `_plano` funcionam; checkout, portal e webhook respondem 503.

import { join } from 'node:path';
import { PLANOS } from './planos.js';

/** Métodos de pagamento aceites em STRIPE_METODOS (compatíveis com subscrições no Checkout). */
export const METODOS_PERMITIDOS = ['card', 'sepa_debit', 'paypal', 'link', 'revolut_pay', 'mb_way'];

function inteiro(env, nome, omissao, min, max, erros) {
  const v = env[nome];
  if (v === undefined || v === '') return omissao;
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    erros.push(`${nome} tem de ser um número inteiro entre ${min} e ${max}`);
    return omissao;
  }
  return Number(v);
}

export function lerConfig(env = process.env) {
  const erros = [];
  const errosStripe = [];
  const dadosDir = env.DADOS_DIR || '/dados';

  let publicUrl = (env.PUBLIC_URL || (env.DOMUS_HOST ? `https://${env.DOMUS_HOST}` : '')).replace(/\/+$/, '');
  if (!publicUrl) erros.push('falta PUBLIC_URL (ex.: https://51-38-10-20.sslip.io)');
  else {
    let u;
    try { u = new URL(publicUrl); } catch { /* inválido */ }
    const local = u && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.search || u.hash || u.pathname !== '/') {
      erros.push('PUBLIC_URL tem de ser https://HOST (sem caminho)');
      publicUrl = '';
    }
  }

  const segredo = env.SESSAO_SEGREDO || '';
  if (segredo.length < 32) erros.push('SESSAO_SEGREDO tem de ter pelo menos 32 caracteres (openssl rand -hex 32)');

  const mqttSenha = env.MQTT_PASS || env.PAGAMENTOS_MQTT_PASS || '';
  if (!mqttSenha) erros.push('falta PAGAMENTOS_MQTT_PASS (utilizador MQTT "pagamentos")');

  const chave = env.STRIPE_SECRET_KEY || '';
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(chave)) errosStripe.push('STRIPE_SECRET_KEY em falta ou inválida (sk_test_... / sk_live_... / rk_...)');
  const webhook = env.STRIPE_WEBHOOK_SECRET || '';
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhook)) errosStripe.push('STRIPE_WEBHOOK_SECRET em falta ou inválido (whsec_...)');
  const precos = {};
  for (const p of PLANOS) {
    const nome = `STRIPE_PRICE_${p.toUpperCase()}`;
    const v = env[nome] || '';
    if (!/^price_[A-Za-z0-9]+$/.test(v)) errosStripe.push(`${nome} em falta ou inválido (price_...)`);
    precos[p] = v;
  }
  if (new Set(Object.values(precos)).size !== PLANOS.length && !errosStripe.length) {
    errosStripe.push('os três STRIPE_PRICE_* têm de ser diferentes');
  }

  let metodos = null; // null = automático (os métodos ativos no painel do Stripe)
  const m = (env.STRIPE_METODOS || 'card').trim();
  if (m !== 'automatico') {
    metodos = m.split(',').map((x) => x.trim()).filter(Boolean);
    const maus = metodos.filter((x) => !METODOS_PERMITIDOS.includes(x));
    if (!metodos.length || maus.length) {
      errosStripe.push(`STRIPE_METODOS inválido (use "automatico" ou uma lista de: ${METODOS_PERMITIDOS.join(', ')})`);
      metodos = ['card'];
    }
  }

  const caminho = env.CAMINHO_CLIENTE || '/cliente.html';
  if (!/^\/[A-Za-z0-9._\/-]*$/.test(caminho)) erros.push('CAMINHO_CLIENTE tem de ser um caminho (ex.: /cliente.html)');

  return {
    erros,
    errosStripe,
    porta: inteiro(env, 'PORTA', 8080, 1, 65535, erros),
    anfitriao: env.ANFITRIAO || '0.0.0.0',
    planosDir: env.PLANOS_DIR || join(dadosDir, 'planos'),
    csv: env.PAGAMENTOS_CSV || join(dadosDir, 'pagamentos.csv'),
    eventosFich: env.EVENTOS_FICH || join(dadosDir, 'eventos-stripe.json'),
    mqttUrl: env.MQTT_URL || 'mqtt://mosquitto:1883',
    mqttUtilizador: env.MQTT_USER || 'pagamentos',
    mqttSenha,
    publicUrl,
    caminhoCliente: caminho,
    segredo,
    sessaoMin: inteiro(env, 'SESSAO_MIN', 15, 1, 120, erros),
    limiteSessao: inteiro(env, 'LIMITE_SESSAO', 5, 1, 1000, erros),
    confiarProxy: env.CONFIAR_PROXY === '1',
    diasTeste: inteiro(env, 'DIAS_TESTE', 30, 0, 730, erros),
    diasAviso: inteiro(env, 'DIAS_AVISO', 15, 1, 90, erros),
    verificarMin: inteiro(env, 'VERIFICAR_MIN', 60, 1, 1440, erros),
    stripe: { chave, webhook, precos, metodos },
  };
}
