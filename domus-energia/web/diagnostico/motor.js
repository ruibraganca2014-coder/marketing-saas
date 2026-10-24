// Motor das árvores de diagnóstico da app /diagnostico.html (decisões do dono, 2026-10-24): só dados e funções puras,
// sem DOM — usado pela app (web/diagnostico.js) e pelos testes do painel (painel/test/diagnostico-app.test.js).
//
// Uma árvore é um objeto { id, versao, titulo, grupo, sintoma, inicio, nos } em que cada nó é:
//   - "simnao":  { texto, fazer?, ref, tensao?, sim, nao, naoSei?, ficha? }
//   - "escolha": { texto, fazer?, ref, tensao?, opcoes: [{ texto, seguinte, define? }], naoSei?, ficha? }
//   - "valor":   { texto, fazer?, ref, tensao?, unidade, casas, max, limite, dentro, fora, aviso?, abaixo?, acima?, naoSei?, ficha? }
//                limite: { min, aviso? } (≥ min; entre min e aviso = "aviso") · { max } (≤ max) · { abaixo } (< abaixo)
//                · { entre: [a, b] } (a ≤ v ≤ b; abaixo/acima vão para `abaixo`/`acima` se existirem) — o número pode
//                ser { var: "In", fator? } (um valor dado num passo anterior, ex. o calibre do disjuntor); `fonte` diz
//                de onde vem o limite (o manual, ou "referência prática" quando o manual não fixa número).
//   - "dado":    { texto, fazer?, ref, tensao?, unidade, casas, max, define, seguinte, naoSei? } — um valor sem limite
//                (ex. a corrente da chapa de um motor) que os passos seguintes comparam.
//   - "lista":   { texto, fazer?, ref, itens: [{ chave, texto }], sim, nao, ficha? } — uma lista de verificação (ex.:
//                manutenção preventiva, manual 20.3): todos os itens feitos → `sim`; algum por fazer → `nao`.
//   - "fim":     { causa, acao, tipoAvaria, ref, parar?, seguir? } — causa provável e o que fazer; `parar` = deixar
//                seguro e chamar apoio; `seguir` = o id de outra árvore que continua o diagnóstico.
// `ref` = { cap: "20.2", pagina: 116 } (ou uma lista): o capítulo/secção e a página IMPRESSA do manual de instalações BT
// da empresa (web/manual-bt.js; o PDF abre em #page=pagina+1). `tensao: true` = o passo faz-se com tensão (fica a
// vermelho, com o aviso). `ficha` = { verificacao, valor? }: o que o passo preenche no diagnóstico da ficha da avaria
// (as chaves e as unidades da lista de verificação do painel, painel/public/ecras/diagnostico-conteudo.js CHECKLIST).
// "Não sei / não consigo medir" vai para `naoSei` ou, sem ele, para FIM_APOIO (parar e chamar apoio).

export const VERSAO_FORMATO = 1;

/** Equipamento de proteção individual (manual B5.1, fig. B5.1; instrumento: B4.4). Todos marcados antes do passo 1. */
export const EPI = [
  { chave: "luvas", texto: "Luvas isolantes de classe adequada à tensão (EN 60903)" },
  { chave: "oculos", texto: "Óculos ou viseira contra arco elétrico e projeções" },
  { chave: "calcado", texto: "Calçado de segurança isolante" },
  { chave: "vestuario", texto: "Vestuário ignífugo, sem partes metálicas" },
  { chave: "ferramentas", texto: "Ferramentas isoladas 1 000 V (EN 60900)" },
  { chave: "instrumento", texto: "Multímetro e pontas de prova CAT III 300 V ou superior, na função e no borne certos" },
  { chave: "capacete", texto: "Capacete isolante (EN 50365) onde houver risco na cabeça: tetos, quadros altos" },
];

/** As cinco regras de ouro antes de trabalhar (manual B4.4). */
export const REGRAS_OURO = [
  { chave: "desligar", texto: "Desligar: cortar todas as fontes de alimentação do que vai ser intervencionado." },
  { chave: "bloquear", texto: "Bloquear: impedir a religação (cadeado ou etiqueta no aparelho de corte)." },
  { chave: "verificar", texto: "Verificar a ausência de tensão com um detetor bipolar testado antes e depois (o busca-polos não prova a ausência de tensão)." },
  { chave: "terra", texto: "Ligar à terra e em curto-circuito, quando aplicável." },
  { chave: "sinalizar", texto: "Proteger contra peças vizinhas em tensão e sinalizar/delimitar a zona de trabalho." },
];
export const REF_SEGURANCA = [{ cap: "B4.4", pagina: 17 }, { cap: "B5.1", pagina: 18 }, { cap: "B5.2", pagina: 19 }];

/** Aviso dos passos feitos com tensão (manual B4.4 "Em obra" e B5.1). */
export const AVISO_TENSAO = "Passo com tensão: só para medir. Instrumento e pontas CAT III, luvas isolantes e óculos, de pé seco e sem tocar em massas. Antes de mexer em bornes, volte a desligar, bloquear e verificar a ausência de tensão.";

/** Sinais de perigo que se podem assinalar em qualquer passo: levam ao ecrã "Parar e isolar". */
export const SINAIS_PERIGO = [
  { chave: "queimado", texto: "Cheiro a queimado ou fumo" },
  { chave: "agua", texto: "Água ou humidade no quadro" },
  { chave: "aquecimento", texto: "Aquecimento anormal (quadro, tomada, cabo)" },
  { chave: "faiscas", texto: "Faíscas, estalos ou arco elétrico" },
  { chave: "cabo", texto: "Cabo danificado ou condutores à vista" },
];

/** O ecrã "Parar e isolar" (manual 20.1, 20.2 "Atenção", B5 "Acidente elétrico"). */
export const PARAR_ISOLAR = {
  titulo: "Parar e isolar",
  passos: [
    "Pare o que está a fazer e afaste as pessoas do local.",
    "Corte a alimentação: o disjuntor do circuito ou, na dúvida, o geral do quadro — sem tocar em água nem em partes danificadas.",
    "Bloqueie e sinalize: o circuito fica desligado até a causa ser encontrada e corrigida.",
    "Fumo ou chama: corte o geral, não use água e ligue 112.",
    "Se alguém levou um choque: não lhe toque enquanto estiver em contacto com a parte em tensão; corte a energia e ligue 112.",
    "Avise a Domus Energia e registe o que viu (uma foto, só se for seguro).",
    "Nunca religue repetidamente, nunca aumente o calibre do disjuntor nem faça ponte ao diferencial.",
  ],
  ref: [{ cap: "20.1", pagina: 115 }, { cap: "B5.1", pagina: 19 }],
};

/** Fim por omissão do "Não sei / não consigo medir". */
export const FIM_APOIO = {
  tipo: "fim", parar: true, tipoAvaria: "outro",
  causa: "Não foi possível concluir este passo no local (não se sabe ou não se consegue medir).",
  acao: "Deixar o circuito desligado, bloqueado e sinalizado e chamar apoio (Domus Energia) antes de continuar. Não religar nem trocar material ao acaso.",
  ref: { cap: "20.1", pagina: 115 },
};
export const ID_APOIO = "__apoio";

/** O que o diagnóstico da ficha da avaria aceita (painel/public/ecras/diagnostico-conteudo.js CHECKLIST e NOME_TIPO). */
export const FICHA_VERIFICACOES = ["isolado", "visual", "rcd", "tensao", "continuidade", "isolamento", "funcional"];
export const FICHA_VALORES = { rcd: "ms", tensao: "V", continuidade: "Ω", isolamento: "MΩ" };
export const TIPOS_AVARIA = ["aberto", "curto", "terra", "sobrecarga", "outro"];
export const MAX_CONCLUSAO = 2000;

const TIPOS_NO = ["simnao", "escolha", "valor", "dado", "lista", "fim"];
const RE_ID = /^[a-z][a-z0-9_-]{0,39}$/;
const RE_VAR = /^[A-Za-z][A-Za-z0-9_]{0,19}$/;
// As unidades aceites (também em painel/src/diagnosticos.js UNIDADES; o teste compara-as). "un." = uma contagem.
export const UNIDADES = ["V", "kV", "A", "kA", "mA", "Ω", "MΩ", "ms", "%", "m", "h", "kVA", "lx", "un."];

// ---------------------------------------------------------------- números
const fmt = (n, casas = 2) => new Intl.NumberFormat("pt-PT", { maximumFractionDigits: casas, useGrouping: true }).format(n);
/** "0,5 MΩ", "230 V". */
export const comUnidade = (n, unidade, casas = 2) => `${fmt(n, casas)} ${unidade}`;

/** Lê um número escrito no telemóvel ("0,35", " 230 ") — null se vazio, NaN se não for número. */
export function lerNumero(texto) {
  const s = String(texto ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const valorDe = (x, vars) => (typeof x === "number" ? x : x && typeof x === "object" && typeof x.var === "string" && Number.isFinite(vars?.[x.var]) ? vars[x.var] * (x.fator ?? 1) : NaN);

/** O limite de um passo de valor, por extenso ("≥ 0,5 MΩ (objetivo ≥ 1 MΩ)"), com as variáveis já dadas. */
export function textoLimite(no, vars = {}) {
  const l = no.limite ?? {};
  const u = no.unidade, c = no.casas ?? 2;
  const n = (x) => { const v = valorDe(x, vars); return Number.isFinite(v) ? comUnidade(v, u, c) : `${x?.var ?? "?"}${x?.fator && x.fator !== 1 ? ` × ${fmt(x.fator)}` : ""}`; };
  if (l.entre) return `entre ${n(l.entre[0])} e ${n(l.entre[1])}`;
  if (l.min !== undefined) return `≥ ${n(l.min)}${l.aviso !== undefined ? ` (objetivo ≥ ${n(l.aviso)})` : ""}`;
  if (l.max !== undefined) return `≤ ${n(l.max)}`;
  if (l.abaixo !== undefined) return `< ${n(l.abaixo)}`;
  return "";
}

/** Compara um valor medido com o limite do passo: "dentro" | "aviso" | "fora" | "abaixo" | "acima". */
export function avaliar(no, valor, vars = {}) {
  const l = no.limite ?? {};
  if (l.entre) {
    const a = valorDe(l.entre[0], vars), b = valorDe(l.entre[1], vars);
    if (valor < a) return no.abaixo ? "abaixo" : "fora";
    if (valor > b) return no.acima ? "acima" : "fora";
    return "dentro";
  }
  if (l.min !== undefined) {
    if (valor < valorDe(l.min, vars)) return "fora";
    return l.aviso !== undefined && valor < valorDe(l.aviso, vars) ? "aviso" : "dentro";
  }
  if (l.max !== undefined) return valor <= valorDe(l.max, vars) ? "dentro" : "fora";
  if (l.abaixo !== undefined) return valor < valorDe(l.abaixo, vars) ? "dentro" : "fora";
  return "dentro";
}
export const NOME_AVALIACAO = { dentro: "Dentro do limite", aviso: "Abaixo do objetivo", fora: "Fora do limite", abaixo: "Abaixo do limite", acima: "Acima do limite" };

/** O id do nó seguinte a uma resposta ({ chave: "sim"|"nao"|"nao_sei"|"o<i>"|"v", valor? }); null se a resposta não serve. */
export function seguinte(no, resposta, vars = {}) {
  if (resposta.chave === "nao_sei") return no.naoSei ?? ID_APOIO;
  if (no.tipo === "simnao") return resposta.chave === "sim" ? no.sim : resposta.chave === "nao" ? no.nao : null;
  if (no.tipo === "lista") return resposta.chave === "lt" ? no.sim : resposta.chave === "lf" ? no.nao : null;
  if (no.tipo === "escolha") {
    const i = /^o(\d+)$/.exec(resposta.chave)?.[1];
    return i !== undefined && no.opcoes[Number(i)] ? no.opcoes[Number(i)].seguinte : null;
  }
  if (no.tipo === "dado") return Number.isFinite(resposta.valor) && resposta.valor >= 0 ? no.seguinte : null;
  if (no.tipo === "valor") {
    if (!Number.isFinite(resposta.valor) || resposta.valor < 0) return null;
    const a = avaliar(no, resposta.valor, vars);
    return no[a] ?? (a === "aviso" ? no.dentro : no.fora);
  }
  return null;
}

/** O nó (ou o fim "chamar apoio"). */
export const noDe = (arvore, id) => (id === ID_APOIO ? FIM_APOIO : arvore.nos[id] ?? null);

/** As variáveis dadas até agora (as opções com `define` e os passos "dado"). */
export function variaveis(arvore, passos) {
  const vars = {};
  for (const p of passos) {
    const no = arvore.nos[p.no];
    if (!no) continue;
    if (no.tipo === "dado" && Number.isFinite(p.valor)) vars[no.define] = p.valor;
    if (no.tipo === "escolha") {
      const i = /^o(\d+)$/.exec(p.chave)?.[1];
      Object.assign(vars, i !== undefined ? no.opcoes[Number(i)]?.define ?? {} : {});
    }
  }
  return vars;
}

// ---------------------------------------------------------------- o percurso
/** O nó atual de um percurso (o início, ou o seguinte do último passo). */
export function atual(arvore, passos) {
  let id = arvore.inicio;
  for (let i = 0; i < passos.length; i++) {
    const no = noDe(arvore, id);
    if (!no || no.tipo === "fim" || passos[i].no !== id) return null;
    id = seguinte(no, passos[i], variaveis(arvore, passos.slice(0, i)));
    if (!id) return null;
  }
  return id;
}

/**
 * Regista a resposta ao nó atual. Devolve o passo (para guardar no diagnóstico) e o id seguinte; lança Error se a
 * resposta não serve. O passo leva os textos (pergunta e resposta), para o histórico se ler sem a árvore.
 */
export function responder(arvore, passos, resposta, quando = new Date().toISOString()) {
  const id = atual(arvore, passos);
  const no = noDe(arvore, id);
  if (!no || no.tipo === "fim") throw new Error("O diagnóstico já chegou ao fim.");
  const vars = variaveis(arvore, passos);
  // Lista de verificação: a resposta são os itens feitos (`feitos`); fica a chave "lt" (todos) ou "lf" (falta algum).
  let feitos = null;
  if (no.tipo === "lista" && resposta.chave !== "nao_sei") {
    feitos = no.itens.filter((x) => (resposta.feitos ?? []).includes(x.chave));
    resposta = { chave: feitos.length === no.itens.length ? "lt" : "lf" };
  }
  const prox = seguinte(no, resposta, vars);
  if (!prox) throw new Error(no.tipo === "valor" || no.tipo === "dado" ? "Escreva um número (0 ou mais)." : "Escolha uma resposta.");
  const passo = { no: id, pergunta: no.texto, chave: resposta.chave, tensao: Boolean(no.tensao), quando };
  if (resposta.chave === "nao_sei") passo.resposta = no.tipo === "valor" || no.tipo === "dado" ? "Não consigo medir" : "Não sei";
  else if (no.tipo === "simnao") passo.resposta = resposta.chave === "sim" ? "Sim" : "Não";
  else if (no.tipo === "escolha") passo.resposta = no.opcoes[Number(resposta.chave.slice(1))].texto;
  else if (no.tipo === "lista") {
    const falta = no.itens.filter((x) => !feitos.includes(x));
    const t = `${feitos.length} de ${no.itens.length} feitos${falta.length ? `; em falta: ${falta.map((x) => x.texto).join("; ")}` : ""}`;
    passo.resposta = t.length > 160 ? `${t.slice(0, 159)}…` : t;
  }
  else {
    passo.valor = resposta.valor;
    passo.unidade = no.unidade;
    passo.resposta = comUnidade(resposta.valor, no.unidade, no.casas ?? 2);
    if (no.tipo === "valor") { passo.avaliacao = avaliar(no, resposta.valor, vars); passo.limite = textoLimite(no, vars); }
  }
  return { passo, seguinte: prox };
}

/** O fim a que o percurso chegou (ou null). */
export function fimDe(arvore, passos) {
  const no = noDe(arvore, atual(arvore, passos));
  return no?.tipo === "fim" ? no : null;
}

// ---------------------------------------------------------------- a ficha da avaria
/**
 * O diagnóstico para a ficha da avaria (o formato de POST trabalhos/:id/diagnostico, validado no servidor pelo mesmo
 * validar.js diagnostico): verificações e valores dos passos com `ficha`, "isolado" pela barreira de segurança, o tipo
 * de avaria do fim e a conclusão (causa, ação, os outros valores medidos e a nota).
 */
export function paraFicha(arvore, diag) {
  const verificacoes = new Set();
  const valores = {};
  if (diag.seguranca?.regras?.length === REGRAS_OURO.length) verificacoes.add("isolado");
  const outros = [];
  for (const p of diag.passos ?? []) {
    const no = arvore?.nos?.[p.no];
    if (p.chave === "nao_sei") continue;
    if (no?.ficha?.verificacao && p.chave !== "lf") verificacoes.add(no.ficha.verificacao);   // lista com algo em falta: não conta como verificada
    if (no?.ficha?.valor && Number.isFinite(p.valor)) { valores[no.ficha.valor] = p.valor; verificacoes.add(no.ficha.valor); }
    else if (Number.isFinite(p.valor)) outros.push(`${p.pergunta.replace(/[?:.]\s*$/, "")}: ${p.resposta}${p.avaliacao && p.avaliacao !== "dentro" ? ` (${NOME_AVALIACAO[p.avaliacao].toLowerCase()})` : ""}`);
  }
  const partes = [diag.causa ? `Causa provável: ${diag.causa}` : null, diag.acao ? `Ação: ${diag.acao}` : null,
    outros.length ? `Outras medições: ${outros.join("; ")}.` : null, diag.nota ? `Nota: ${diag.nota}` : null].filter(Boolean);
  let conclusao = partes.join("\n");
  if (conclusao.length > MAX_CONCLUSAO) conclusao = `${conclusao.slice(0, MAX_CONCLUSAO - 1)}…`;
  return {
    verificacoes: FICHA_VERIFICACOES.filter((k) => verificacoes.has(k)),
    valores,
    tipo: TIPOS_AVARIA.includes(diag.tipo) ? diag.tipo : null,
    conclusao: conclusao || null,
  };
}

// ---------------------------------------------------------------- validação (testes e arranque da app)
/** Os capítulos do índice do manual com o intervalo de páginas de cada um (a página seguinte ao fim é a do próximo). */
export function capitulosDoManual(manual) {
  const caps = manual.partes.flatMap((p) => p.capitulos).filter((c) => c.n !== "—");
  return caps.map((c, i) => ({ n: c.n, de: c.pagina, ate: (caps[i + 1]?.pagina ?? manual.paginas) - (caps[i + 1] ? 1 : 0) }));
}

function erroRef(ref, caps) {
  const lista = Array.isArray(ref) ? ref : [ref];
  if (!lista.length || lista.some((r) => !r || typeof r.cap !== "string" || !Number.isInteger(r.pagina))) return "sem referência ao manual (cap e página)";
  for (const r of lista) {
    const n = r.cap.split(".")[0];
    const cap = caps.find((c) => c.n === (/^\d$/.test(n) ? `0${n}` : n));   // "6.1" é do capítulo "06" do índice
    if (!cap) return `capítulo desconhecido (${r.cap})`;
    if (r.pagina < cap.de || r.pagina > cap.ate) return `página ${r.pagina} fora do capítulo ${cap.n} (${cap.de}–${cap.ate})`;
  }
  return null;
}

/**
 * Os erros de uma árvore (lista vazia = válida): ids, nós e ligações, referências ao manual, fins com causa e ação,
 * passos de valor com unidade e limite, nada inalcançável, sem ciclos (todo o caminho acaba num fim) e as variáveis
 * comparadas dadas antes em todos os caminhos. `manual` = MANUAL_BT (web/manual-bt.js); `arvores` = os ids que existem
 * (para os fins com `seguir`).
 */
export function validarArvore(a, { manual, arvores = [] } = {}) {
  const erros = [];
  const e = (m) => erros.push(`${a?.id ?? "?"}: ${m}`);
  if (!a || typeof a !== "object") return ["árvore inválida"];
  if (!RE_ID.test(a.id ?? "")) e("id inválido");
  if (!Number.isInteger(a.versao) || a.versao < 1) e("versão inválida");
  for (const k of ["titulo", "grupo", "sintoma"]) if (typeof a[k] !== "string" || !a[k].trim()) e(`falta ${k}`);
  if (a.palavras !== undefined && typeof a.palavras !== "string") e("palavras (para a procura) têm de ser texto");
  if (!a.nos || typeof a.nos !== "object") return [...erros, `${a.id}: sem nós`];
  if (!a.nos[a.inicio]) e("o início não existe");
  if (a.nos[a.inicio]?.tipo === "fim") e("começa num fim");
  const caps = manual ? capitulosDoManual(manual) : null;
  const ligacoes = (no) => {
    if (no.tipo === "simnao" || no.tipo === "lista") return [no.sim, no.nao];
    if (no.tipo === "escolha") return (no.opcoes ?? []).map((o) => o.seguinte);
    if (no.tipo === "valor") return [no.dentro, no.fora, no.aviso, no.abaixo, no.acima].filter((x) => x !== undefined);
    if (no.tipo === "dado") return [no.seguinte];
    return [];
  };
  for (const [id, no] of Object.entries(a.nos)) {
    const m = (t) => e(`${id}: ${t}`);
    if (!RE_ID.test(id)) m("id do nó inválido");
    if (!TIPOS_NO.includes(no?.tipo)) { m("tipo desconhecido"); continue; }
    if (caps) { const r = erroRef(no.ref, caps); if (r) m(r); } else if (!no.ref) m("sem referência ao manual");
    if (no.tipo === "fim") {
      if (typeof no.causa !== "string" || no.causa.trim().length < 10) m("fim sem causa");
      if (typeof no.acao !== "string" || no.acao.trim().length < 10) m("fim sem ação");
      if (!TIPOS_AVARIA.includes(no.tipoAvaria)) m("fim sem tipo de avaria válido");
      if (no.seguir !== undefined && !arvores.includes(no.seguir)) m(`segue para uma árvore que não existe (${no.seguir})`);
      continue;
    }
    if (typeof no.texto !== "string" || no.texto.trim().length < 5) m("sem texto");
    for (const s of [...ligacoes(no), ...(no.naoSei !== undefined ? [no.naoSei] : [])]) if (!a.nos[s]) m(`liga a um nó que não existe (${s})`);
    if (no.tipo === "lista") {
      if (!Array.isArray(no.itens) || no.itens.length < 2) m("lista com menos de 2 itens");
      const ks = (no.itens ?? []).map((x) => x?.chave);
      if (ks.some((k) => !RE_ID.test(k ?? "")) || new Set(ks).size !== ks.length) m("lista com chaves inválidas ou repetidas");
      for (const x of no.itens ?? []) if (typeof x?.texto !== "string" || x.texto.trim().length < 3) m("item da lista sem texto");
    }
    if (no.tipo === "escolha") {
      if (!Array.isArray(no.opcoes) || no.opcoes.length < 2) m("escolha com menos de 2 opções");
      for (const o of no.opcoes ?? []) if (typeof o.texto !== "string" || !o.texto.trim()) m("opção sem texto");
    }
    if (no.tipo === "valor" || no.tipo === "dado") {
      if (!UNIDADES.includes(no.unidade)) m(`unidade inválida (${no.unidade})`);
      if (!Number.isInteger(no.casas) || no.casas < 0 || no.casas > 3) m("casas decimais inválidas");
      if (!(no.max > 0)) m("sem máximo aceite");
    }
    if (no.tipo === "dado" && !RE_VAR.test(no.define ?? "")) m("dado sem nome de variável (define)");
    if (no.tipo === "valor") {
      const l = no.limite;
      const num = (x) => typeof x === "number" ? Number.isFinite(x) && x >= 0 : x && typeof x.var === "string";
      const formas = l ? ["min", "max", "abaixo", "entre"].filter((k) => l[k] !== undefined) : [];
      if (formas.length !== 1) m("limite inválido (um de min, max, abaixo, entre)");
      else if (formas[0] === "entre" ? !(Array.isArray(l.entre) && l.entre.length === 2 && l.entre.every(num)) : !num(l[formas[0]])) m("limite sem número");
      if (l?.aviso !== undefined && (formas[0] !== "min" || !num(l.aviso))) m("aviso só com limite mínimo");
      if (typeof l?.fonte !== "string" || !l.fonte.trim()) m("limite sem fonte");
      if (!no.dentro || !no.fora) m("valor sem os dois caminhos (dentro e fora)");
      if ((no.abaixo || no.acima) && formas[0] !== "entre") m("abaixo/acima só com limite entre");
    }
    if (no.ficha) {
      if (!FICHA_VERIFICACOES.includes(no.ficha.verificacao)) m(`ficha: verificação desconhecida (${no.ficha.verificacao})`);
      if (no.ficha.valor !== undefined) {
        if (no.tipo !== "valor") m("ficha: só os passos de valor dão um valor");
        else if (FICHA_VALORES[no.ficha.valor] !== no.unidade) m(`ficha: o valor ${no.ficha.valor} é em ${FICHA_VALORES[no.ficha.valor]}, não em ${no.unidade}`);
      }
    }
  }
  if (erros.length) return erros;
  // Alcance e ciclos: percurso em profundidade a partir do início (cinzento = no caminho atual).
  const cor = {};
  const ciclo = [];
  const visitar = (id) => {
    cor[id] = 1;
    const no = a.nos[id];
    for (const s of [...ligacoes(no), ...(no.naoSei ? [no.naoSei] : [])]) {
      if (cor[s] === 1) ciclo.push(`${id} → ${s}`);
      else if (!cor[s]) visitar(s);
    }
    cor[id] = 2;
  };
  visitar(a.inicio);
  if (ciclo.length) e(`ciclo (${ciclo.join(", ")})`);
  for (const id of Object.keys(a.nos)) if (!cor[id]) e(`${id}: inalcançável a partir do início`);
  // Variáveis: em todos os caminhos até um passo que compara com { var }, a variável já foi dada.
  const usa = (no) => (no.tipo === "valor" ? [no.limite.min, no.limite.max, no.limite.abaixo, no.limite.aviso, ...(no.limite.entre ?? [])].filter((x) => x && typeof x === "object").map((x) => x.var) : []);
  const dadas = {};   // id → conjunto das variáveis garantidas ao chegar (interseção dos caminhos)
  const ordem = [];
  const vistos = new Set();
  const topo = (id) => { if (vistos.has(id)) return; vistos.add(id); for (const s of ligacoes(a.nos[id])) topo(s); ordem.unshift(id); };
  topo(a.inicio);
  dadas[a.inicio] = new Set();
  for (const id of ordem) {
    const no = a.nos[id];
    const aqui = dadas[id] ?? new Set();
    for (const v of usa(no)) if (!aqui.has(v)) e(`${id}: compara com "${v}" sem o ter pedido antes em todos os caminhos`);
    const passa = (s, extra = []) => {
      const novo = new Set([...aqui, ...extra]);
      dadas[s] = dadas[s] ? new Set([...dadas[s]].filter((x) => novo.has(x))) : novo;
    };
    if (no.tipo === "escolha") for (const o of no.opcoes) passa(o.seguinte, Object.keys(o.define ?? {}));
    else if (no.tipo === "dado") passa(no.seguinte, [no.define]);
    else for (const s of ligacoes(no)) passa(s);
  }
  return erros;
}

// ---------------------------------------------------------------- o registo do diagnóstico
/** Id novo de um diagnóstico (32 hex): gerado no telemóvel, é a chave da sincronização (o mesmo id = o mesmo registo). */
export function novoId(aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...aleatorio(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const RE_ID_DIAGNOSTICO = /^[a-f0-9]{32}$/;
