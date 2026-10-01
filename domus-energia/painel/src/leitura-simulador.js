// Leitura da foto do quadro NO SIMULADOR (docs/SIMULADOR-ORCAMENTO.md, passo "Quadro elétrico"): POST
// /api/simulador/ler-quadro com a foto (bytes, como em POST /api/orcamento/fotos) e o id da simulação no cabeçalho
// X-Simulacao-Id. Público (ainda não há pedido): origem verificada como em /api/orcamento; limites por simulação (3),
// por IP e no total por dia (o id da simulação é do navegador — o limite por IP é o que conta de verdade). Só a imagem
// vai ao modelo (leitura-quadro.js), nunca dados do cliente; a foto não fica guardada no servidor.
// Sem ANTHROPIC_API_KEY → 503 (o simulador passa a descrever o quadro à mão).

import { ErroApi, lerCorpo, responder, verificarOrigemPublica } from './http.js';
import { bytesDeImagem, FOTO_MAX_BYTES } from './fotos.js';
import { LimiteTaxa } from './limite.js';

export const LEITURAS_POR_SIMULACAO = 3;
const DIA_MS = 24 * 3600_000;
const RE_SIMULACAO = /^[A-Za-z0-9_-]{8,64}$/;
const TIPOS = ['image/jpeg', 'image/png'];

/** @param {{config: object, registo: object, relogio: () => number, leitor: object|null}} ctx */
export function criarLeituraSimulador({ config, registo, relogio, leitor }) {
  const porSimulacao = new LimiteTaxa(LEITURAS_POR_SIMULACAO, DIA_MS, relogio);
  const porIp = new LimiteTaxa(config.limiteLeituraIpDia, DIA_MS, relogio);
  const global = new LimiteTaxa(config.limiteLeituraDia, DIA_MS, relogio);

  return async function lerQuadro(req, res, ip) {
    if (!verificarOrigemPublica(req, config.origens, config.siteOrigens)) throw new ErroApi(403, 'Pedido recusado (origem desconhecida).');
    if (!leitor) throw new ErroApi(503, 'Leitura indisponível. Descreva o quadro à mão.');
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.includes(tipo)) throw new ErroApi(415, 'A foto tem de ser JPEG ou PNG (Content-Type: image/jpeg ou image/png).');
    const sim = String(req.headers['x-simulacao-id'] ?? '');
    if (!RE_SIMULACAO.test(sim)) throw new ErroApi(400, 'Identificação da simulação inválida (X-Simulacao-Id).');
    const limite = (espera, msg) => {
      if (!espera) return;
      registo.aviso(`leitura do quadro (simulador): limite atingido (ip ${ip})`);
      throw new ErroApi(429, msg, { 'Retry-After': String(espera) });
    };
    limite(porSimulacao.espera(sim), `Já leu ${LEITURAS_POR_SIMULACAO} fotos nesta simulação. Descreva o quadro à mão.`);
    limite(porIp.espera(ip), 'Já leu várias fotos hoje. Descreva o quadro à mão.');
    limite(global.espera('*'), 'Leitura indisponível hoje. Descreva o quadro à mão.');
    const corpo = await lerCorpo(req, FOTO_MAX_BYTES).catch((e) => {
      if (e instanceof ErroApi && e.estado === 413) throw new ErroApi(413, 'A foto é demasiado grande (máx. 1 MB).');
      throw e;
    });
    if (!corpo.length) throw new ErroApi(400, 'A foto está vazia.');
    if (!bytesDeImagem(corpo, tipo)) throw new ErroApi(415, 'O ficheiro não é uma imagem JPEG ou PNG válida.');
    // Conta antes de chamar o modelo: uma leitura que falha também custa.
    porSimulacao.registar(sim);
    porIp.registar(ip);
    global.registar('*');
    let r;
    try {
      r = await leitor.ler(corpo, tipo, ' (simulador)');
    } catch {
      throw new ErroApi(502, 'Não foi possível ler a foto. Descreva o quadro à mão.');
    }
    responder(res, 200, { ok: true, leitura: r.leitura });
  };
}
