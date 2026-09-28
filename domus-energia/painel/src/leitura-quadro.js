// Leitura automática da foto do quadro elétrico com um modelo de visão Claude (API HTTP da Anthropic,
// com o fetch do Node: sem dependências novas). Só a imagem e as instruções vão ao modelo — nunca o
// nome, contactos ou morada do cliente. Resposta em JSON estruturado (output_config.format), validada
// aqui outra vez antes de ser guardada. Sem ANTHROPIC_API_KEY não há leitor (não se chama nada).
//
// Modelo: Claude Haiku 4.5 — o mais barato com visão e saídas estruturadas (US$ 1 / 1 M tokens de
// entrada, US$ 5 / 1 M de saída). Uma foto de ~1600 px conta ~1600–2500 tokens de imagem; com as
// instruções e ~400 tokens de resposta fica perto de US$ 0,005 por foto (o dobro se repetir).

export const MODELO_LEITURA = 'claude-haiku-4-5';
export const PRECO_USD_MTOK = { entrada: 1, saida: 5 };
const URL_API = 'https://api.anthropic.com/v1/messages';
const VERSAO_API = '2023-06-01';

const nulo = (tipo) => ({ anyOf: [{ type: tipo }, { type: 'null' }] });
const objeto = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

/** Esquema da resposta (structured outputs: sem mínimos/máximos, que são verificados em validarLeitura). */
export const ESQUEMA_LEITURA = objeto({
  e_quadro_eletrico: { type: 'boolean' },
  disjuntores_total: nulo('integer'),
  disjuntores: { type: 'array', items: objeto({ amperes: nulo('number'), quantidade: { type: 'integer' } }) },
  diferenciais: { type: 'array', items: objeto({ sensibilidade_ma: nulo('number'), amperes: nulo('number'), quantidade: { type: 'integer' } }) },
  disjuntor_geral: objeto({ visivel: { type: 'boolean' }, amperes: nulo('number'), tipo: nulo('string') }),
  modulos_livres_estimados: nulo('integer'),
  marcas: { type: 'array', items: { type: 'string' } },
  estado_aparente: { type: 'string', enum: ['bom', 'razoavel', 'antigo', 'mau', 'nao_se_ve'] },
  fusiveis: nulo('boolean'),
  sinais_aquecimento: nulo('boolean'),
  notas: { type: 'string' },
  confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
});

const INSTRUCOES = `És um eletricista experiente em Portugal a preparar uma visita técnica. Recebes UMA foto do quadro elétrico de uma casa, tirada pelo cliente com o telemóvel. Lê só o que se vê na foto e responde no esquema JSON pedido, em português de Portugal.

- e_quadro_eletrico: false se a foto não mostra um quadro elétrico (nesse caso deixa o resto vazio/null e explica em notas).
- disjuntores_total: n.º de disjuntores de circuito visíveis (sem contar o geral nem os diferenciais); null se não se consegue contar.
- disjuntores: agrupa por calibre (amperes lidos na etiqueta, ex. 10, 16, 20, 25, 32, 40; null se ilegível) com a quantidade de cada.
- diferenciais: interruptores/disjuntores diferenciais com a sensibilidade em mA (ex. 30, 300; null se ilegível), o calibre em A e a quantidade.
- disjuntor_geral: se há um geral/corte geral visível, o calibre e o tipo (ex. "disjuntor 2P", "interruptor de corte", "fusíveis").
- modulos_livres_estimados: módulos DIN livres (espaços vazios/tampas) que se veem; null se não se percebe.
- marcas: fabricantes legíveis (ex. Hager, Schneider, Legrand, ABB, Siemens); lista vazia se nenhuma.
- estado_aparente: bom, razoavel, antigo (ex. porcelana, fusíveis de rosca, sem diferencial), mau (danos, fios à vista) ou nao_se_ve.
- fusiveis: true se há fusíveis em vez de disjuntores; sinais_aquecimento: true se há marcas de queimado, plástico derretido ou escurecido.
- notas: o que o eletricista deve confirmar (ex. falta de diferencial, terra, espaço para ampliar, foto desfocada). Curto.
- confianca: alta só se a foto é nítida e as etiquetas se leem; baixa se é preciso adivinhar.

Não inventes: o que não se lê fica null. Não descrevas pessoas nem objetos pessoais que apareçam na foto.`;

export class ErroLeitura extends Error {
  constructor(mensagem, repetir = false) {
    super(mensagem);
    this.repetir = repetir;
  }
}

const eInteiro = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const eNumero = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const limpo = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valida e normaliza a resposta do modelo; lança ErroLeitura se não cumprir o esquema e os limites. */
export function validarLeitura(v) {
  const erro = (m) => { throw new ErroLeitura(`resposta do modelo inválida: ${m}`, true); };
  if (!v || typeof v !== 'object' || Array.isArray(v)) erro('não é um objeto');
  const extra = Object.keys(v).filter((k) => !(k in ESQUEMA_LEITURA.properties));
  if (extra.length) erro(`campos a mais (${extra.join(', ')})`);
  if (typeof v.e_quadro_eletrico !== 'boolean') erro('e_quadro_eletrico');
  const intNulo = (x, max, k) => { if (x !== null && !eInteiro(x, max)) erro(k); return x; };
  const numNulo = (x, max, k) => { if (x !== null && !eNumero(x, max)) erro(k); return x; };
  const lista = (x, k) => { if (!Array.isArray(x) || x.length > 60) erro(k); return x; };
  const soCampos = (x, campos, k) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) erro(k);
    for (const c of Object.keys(x)) if (!campos.includes(c)) erro(`${k}.${c}`);
    for (const c of campos) if (!(c in x)) erro(`${k}.${c} em falta`);
  };
  const disjuntores = lista(v.disjuntores, 'disjuntores').map((d, i) => {
    soCampos(d, ['amperes', 'quantidade'], `disjuntores[${i}]`);
    return { amperes: numNulo(d.amperes, 1000, 'disjuntores.amperes'), quantidade: intNulo(d.quantidade, 200, 'disjuntores.quantidade') ?? erro('disjuntores.quantidade') };
  });
  const diferenciais = lista(v.diferenciais, 'diferenciais').map((d, i) => {
    soCampos(d, ['sensibilidade_ma', 'amperes', 'quantidade'], `diferenciais[${i}]`);
    return {
      sensibilidade_ma: numNulo(d.sensibilidade_ma, 3000, 'diferenciais.sensibilidade_ma'),
      amperes: numNulo(d.amperes, 1000, 'diferenciais.amperes'),
      quantidade: intNulo(d.quantidade, 200, 'diferenciais.quantidade') ?? erro('diferenciais.quantidade'),
    };
  });
  soCampos(v.disjuntor_geral, ['visivel', 'amperes', 'tipo'], 'disjuntor_geral');
  const g = v.disjuntor_geral;
  if (typeof g.visivel !== 'boolean') erro('disjuntor_geral.visivel');
  if (g.tipo !== null && typeof g.tipo !== 'string') erro('disjuntor_geral.tipo');
  const marcas = lista(v.marcas, 'marcas').map((m) => (typeof m === 'string' ? limpo(m, 40) : erro('marcas'))).filter(Boolean).slice(0, 20);
  if (!ESQUEMA_LEITURA.properties.estado_aparente.enum.includes(v.estado_aparente)) erro('estado_aparente');
  if (!ESQUEMA_LEITURA.properties.confianca.enum.includes(v.confianca)) erro('confianca');
  for (const k of ['fusiveis', 'sinais_aquecimento']) if (v[k] !== null && typeof v[k] !== 'boolean') erro(k);
  if (typeof v.notas !== 'string') erro('notas');
  return {
    e_quadro_eletrico: v.e_quadro_eletrico,
    disjuntores_total: intNulo(v.disjuntores_total, 500, 'disjuntores_total'),
    disjuntores,
    diferenciais,
    disjuntor_geral: { visivel: g.visivel, amperes: numNulo(g.amperes, 1000, 'disjuntor_geral.amperes'), tipo: g.tipo === null ? null : limpo(g.tipo, 60) || null },
    modulos_livres_estimados: intNulo(v.modulos_livres_estimados, 500, 'modulos_livres_estimados'),
    marcas,
    estado_aparente: v.estado_aparente,
    fusiveis: v.fusiveis,
    sinais_aquecimento: v.sinais_aquecimento,
    notas: limpo(v.notas, 1000),
    confianca: v.confianca,
  };
}

const custoUsd = (entrada, saida) => (entrada * PRECO_USD_MTOK.entrada + saida * PRECO_USD_MTOK.saida) / 1_000_000;

/**
 * Leitor da foto do quadro, ou null sem chave (leitura desligada: não se chama nada).
 * @param {{chave: string, fetch?: typeof fetch, registo: object, timeoutMs?: number, tentativas?: number}} o
 */
export function criarLeitor({ chave, fetch: fetchFn = globalThis.fetch, registo, timeoutMs = 60_000, tentativas = 2 }) {
  if (!chave) return null;

  async function umaVez(imagem, mime, uso) {
    const corpo = JSON.stringify({
      model: MODELO_LEITURA,
      max_tokens: 2048,
      system: INSTRUCOES,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: imagem.toString('base64') } },
          { type: 'text', text: 'Lê este quadro elétrico e responde no esquema JSON.' },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA_LEITURA } },
    });
    let r;
    let texto;
    try {
      r = await fetchFn(URL_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO_API },
        body: corpo,
        signal: AbortSignal.timeout(timeoutMs),
      });
      texto = await r.text();
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ErroLeitura(`tempo esgotado (${Math.round(timeoutMs / 1000)} s)`, true);
      throw new ErroLeitura(`sem ligação à API (${e?.message || e})`, true);
    }
    let resp = null;
    try { resp = JSON.parse(texto); } catch { /* tratado abaixo */ }
    if (!r.ok) {
      const tipo = resp?.error?.type ? ` ${resp.error.type}` : '';
      // 429 (limite), 5xx e 529 (sobrecarga) podem passar à 2.ª; 400/401/403 não (pedido ou chave errados).
      throw new ErroLeitura(`a API respondeu ${r.status}${tipo}`, r.status === 408 || r.status === 429 || r.status >= 500);
    }
    if (!resp || typeof resp !== 'object') throw new ErroLeitura('resposta da API sem JSON', true);
    uso.entrada += Number(resp.usage?.input_tokens) || 0;
    uso.saida += Number(resp.usage?.output_tokens) || 0;
    if (resp.stop_reason === 'refusal') throw new ErroLeitura('o modelo recusou ler a imagem', false);
    if (resp.stop_reason === 'max_tokens') throw new ErroLeitura('resposta cortada (max_tokens)', true);
    const bloco = Array.isArray(resp.content) ? resp.content.find((b) => b?.type === 'text') : null;
    if (!bloco || typeof bloco.text !== 'string') throw new ErroLeitura('resposta sem texto', true);
    let json;
    try { json = JSON.parse(bloco.text); } catch { throw new ErroLeitura('o modelo não devolveu JSON válido', true); }
    return validarLeitura(json);
  }

  return {
    modelo: MODELO_LEITURA,
    /**
     * Lê a foto (Buffer JPEG/PNG). Devolve {leitura, modelo, uso, custo_usd, tentativas};
     * lança ErroLeitura (com .uso e .custo_usd) ao fim de `tentativas`.
     */
    async ler(imagem, mime, etiqueta = '') {
      const uso = { entrada: 0, saida: 0 };
      let ultimo;
      let n = 0;
      for (n = 1; n <= tentativas; n++) {
        try {
          const leitura = await umaVez(imagem, mime, uso);
          const custo = custoUsd(uso.entrada, uso.saida);
          registo.info(`leitura do quadro${etiqueta}: ${MODELO_LEITURA}, ${uso.entrada} tokens de entrada + ${uso.saida} de saída ≈ US$ ${custo.toFixed(4)} (${n} ${n === 1 ? 'tentativa' : 'tentativas'})`);
          return { leitura, modelo: MODELO_LEITURA, uso, custo_usd: Math.round(custo * 1e6) / 1e6, tentativas: n };
        } catch (e) {
          ultimo = e instanceof ErroLeitura ? e : new ErroLeitura(String(e?.message || e), false);
          registo.aviso(`leitura do quadro${etiqueta}: tentativa ${n} falhou: ${ultimo.message}`);
          if (!ultimo.repetir) break;
        }
      }
      const custo = custoUsd(uso.entrada, uso.saida);
      registo.aviso(`leitura do quadro${etiqueta}: desistiu; ${uso.entrada} + ${uso.saida} tokens ≈ US$ ${custo.toFixed(4)}`);
      ultimo.uso = uso;
      ultimo.custo_usd = Math.round(custo * 1e6) / 1e6;
      ultimo.tentativas = Math.min(n, tentativas);
      throw ultimo;
    },
  };
}
