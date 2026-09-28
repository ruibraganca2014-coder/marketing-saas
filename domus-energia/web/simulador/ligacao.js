// "Continue no telemóvel" (docs/SIMULADOR-ORCAMENTO.md, passo 4): ligação temporária sem conta entre o computador e
// o telemóvel (painel/src/ligacao.js, /api/ligacao/*).
// - No computador, o passo 4 mostra um QR com o endereço do simulador e o token no fragmento (#ligar=…: nunca vai
//   para os registos do servidor). O telemóvel abre-o, recebe a mesma simulação e entra no passo 4.
// - Sincronização (os dois aparelhos, em todos os passos): poll a cada 4 s com ETag (304 sem mudanças); cada aparelho
//   envia o seu estado ~0,8 s depois de mudar, dizendo em que versão se baseou. Se o outro escreveu entretanto (409),
//   junta os dois (fundirEstados: junção a três com a última versão comum) e envia o resultado. Regra da junção: cada
//   campo e cada divisão/aparelho da planta (pelo id) fica com o lado que o mudou; se os dois mudaram o mesmo, ganha
//   quem escreve (o último); listas simples (divisões verificadas) juntam o que cada lado pôs e tirou. Assim uma
//   mudança feita num aparelho nunca apaga outra feita noutra divisão ou noutro aparelho da mesma divisão.
//   Enquanto um aparelho está no passo Planta (ou com a janela de um aparelho aberta) não aplica nem envia: o editor
//   tem o seu anular/refazer; ao sair, sincroniza.
// - Fotos: as tiradas num aparelho vão para o servidor (ligadas ao token) e aparecem no outro (miniatura); apagar
//   num apaga no outro. Ao enviar o pedido, as que já estão no servidor passam para o orçamento sem voltar a ir.
// - "Começar de novo" e o envio do pedido terminam a ligação; sem servidor, o QR não aparece e tudo funciona como antes.

import { svgQR } from "./qr.js";
import { reduzirFoto, guardarFoto, apagarFoto } from "./fotos.js";

export const CHAVE_LIGACAO = "domus.simulador.ligacao";   // localStorage: {token, papel, expira}
export const POLL_MS = 4000;
export const POLL_ESCONDIDA_MS = 15_000;
export const ENVIO_MS = 800;
/** Só nos ecrãs largos (computador) o passo 4 mostra o QR. */
export const ECRA_QR = "(min-width: 900px)";
/** Campos de cada aparelho (não sincronizados): o passo à vista, as fotos no IndexedDB e o contacto (dados pessoais). */
export const CAMPOS_LOCAIS = ["passo", "visitado", "guardado", "fotosId", "contacto"];
const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Token do fragmento "#ligar=<token>" (ou null). */
export function lerTokenLigacao(hash) {
  const m = /^#?ligar=([A-Za-z0-9_-]{43})$/.exec(String(hash ?? ""));
  return m ? m[1] : null;
}

/** O que se sincroniza: o estado sem os campos locais (cópia). */
export function paraLigacao(estado) {
  const r = {};
  for (const [k, v] of Object.entries(estado ?? {})) if (!CAMPOS_LOCAIS.includes(k)) r[k] = v;
  return JSON.parse(JSON.stringify(r));
}

// ------------------------------------------------------------ junção a três
const igual = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const objeto = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const temId = (x) => objeto(x) && typeof x.id === "string";
const simples = (x) => x === null || typeof x !== "object";

/**
 * Junção a três de dois valores JSON que partiram de `base`: o lado que mudou ganha; os dois mudaram → objetos campo a
 * campo, listas de objetos com `id` elemento a elemento, listas simples como conjuntos; o resto fica com `local` (quem
 * está a escrever). `undefined` = campo apagado.
 */
export function fundir(base, local, remoto) {
  if (igual(local, base)) return remoto;
  if (igual(remoto, base) || igual(local, remoto)) return local;
  if (objeto(local) && objeto(remoto)) {
    const b = objeto(base) ? base : {};
    const r = {};
    for (const k of new Set([...Object.keys(remoto), ...Object.keys(local)])) {
      const v = fundir(b[k], local[k], remoto[k]);
      if (v !== undefined) r[k] = v;
    }
    return r;
  }
  if (Array.isArray(local) && Array.isArray(remoto)) {
    const b = Array.isArray(base) ? base : [];
    if ([b, local, remoto].every((a) => a.every(temId))) return fundirPorId(b, local, remoto);
    if ([b, local, remoto].every((a) => a.every(simples))) {
      const tirados = b.filter((x) => !local.includes(x));
      const postos = local.filter((x) => !b.includes(x));
      return [...new Set([...remoto.filter((x) => !tirados.includes(x)), ...postos])];
    }
  }
  return local;
}

function fundirPorId(base, local, remoto) {
  const mb = new Map(base.map((x) => [x.id, x]));
  const ml = new Map(local.map((x) => [x.id, x]));
  const mr = new Map(remoto.map((x) => [x.id, x]));
  const r = [];
  for (const x of remoto) {
    if (ml.has(x.id)) r.push(fundir(mb.get(x.id), ml.get(x.id), x));
    else if (!mb.has(x.id)) r.push(x);                    // novo do outro lado
    // tirado deste lado: sai (se o outro lado o mudou entretanto, ganha quem escreve — este)
  }
  for (const y of local) {
    if (mr.has(y.id)) continue;
    if (mb.has(y.id) && igual(y, mb.get(y.id))) continue;  // tirado do outro lado e não mexido aqui: sai
    r.push(y);                                            // novo deste lado (ou mexido aqui depois de tirado lá)
  }
  return r;
}

/**
 * Divisões ou aparelhos novos dos dois lados com o mesmo id (o editor numera "d7", "e12"… a partir do maior):
 * os deste lado passam a um id livre (e as referências da planta e das verificadas acompanham).
 */
function renumerarColisoes(base, local, remoto) {
  const pl = local?.planta, pr = remoto?.planta, pb = base?.planta ?? {};
  if (!objeto(pl) || !objeto(pr)) return local;
  const r = JSON.parse(JSON.stringify(local));
  for (const [lista, pre] of [["divisoes", "d"], ["elementos", "e"]]) {
    const doBase = new Set((pb[lista] ?? []).map((x) => x.id));
    const remotos = new Map((pr[lista] ?? []).map((x) => [x.id, x]));
    const usados = new Set([...(pr[lista] ?? []), ...(r.planta[lista] ?? [])].map((x) => x.id));
    let maior = Math.max(0, ...[...usados].map((id) => Number(String(id).slice(1)) || 0));
    for (const x of r.planta[lista] ?? []) {
      if (doBase.has(x.id) || !remotos.has(x.id) || igual(remotos.get(x.id), x)) continue;
      const antigo = x.id;
      x.id = `${pre}${++maior}`;
      if (lista === "divisoes") {
        for (const e of r.planta.elementos ?? []) if (e.divisao === antigo) e.divisao = x.id;
        if (Array.isArray(r.verificadas)) r.verificadas = r.verificadas.map((v) => (v === antigo ? x.id : v));
      }
    }
  }
  return r;
}

/** Junta o estado deste aparelho (`local`) com o do outro (`remoto`), a partir da última versão comum (`base`). */
export function fundirEstados(base, local, remoto) {
  if (!base) return remoto;
  return fundir(base, renumerarColisoes(base, local, remoto), remoto);
}

// ------------------------------------------------------------ ligação (browser)
/**
 * @param {object} o
 * @param {string} o.urlApi base das rotas do painel ("/api" ou "<apiBase>/api")
 * @param {RequestCredentials} o.credenciais
 * @param {Storage|null} o.armazem localStorage (token deste aparelho)
 * @param {HTMLElement} o.caixa cartão do QR (passo 4)
 * @param {() => object} o.obterEstado
 * @param {(sinc: object, info: {fundido: boolean}) => void} o.aplicar põe no estado o que veio do outro aparelho
 * @param {() => boolean} o.podeSincronizar false no passo Planta, com uma janela aberta ou a enviar o pedido
 * @param {Map} o.fotos as fotos da página (chave → {blob, miniatura, …, servidor})
 * @param {() => string} o.idFotos id das fotos desta simulação no IndexedDB (cria se preciso)
 * @param {() => void} o.aoFotos as fotos mudaram (redesenhar)
 * @param {(texto: string) => void} o.avisar mensagem curta para o cliente
 */
export function criarLigacao(o) {
  let token = null;
  let papel = null;           // "computador" (mostra o QR) | "telemovel" (entrou pelo QR)
  let expira = null;
  let base = null;            // texto JSON do último estado comum com o servidor
  let versao = 0;             // ETag das leituras (estado e fotos)
  let versaoEstado = 0;       // base das escritas
  let temporizadorPoll = null;
  let temporizadorEnvio = null;
  let aEnviar = false;
  let pendente = false;
  let aCriar = null;
  let semServidor = 0;         // quando falhou a criação (volta a tentar ao fim de 1 min)
  let qrDe = null;            // token do QR desenhado
  const emCurso = new Set();  // fotos a subir ou a descer
  const porApagar = new Set();

  const url = (c) => `${o.urlApi}/ligacao${c}`;
  const cab = (extra = {}) => ({ Accept: "application/json", "X-Ligacao-Token": token, ...extra });

  function gravar() {
    try {
      if (token) o.armazem?.setItem(CHAVE_LIGACAO, JSON.stringify({ token, papel, expira }));
      else o.armazem?.removeItem(CHAVE_LIGACAO);
    } catch { /* sem armazenamento: a ligação dura enquanto a página estiver aberta */ }
  }
  function lerGuardada() {
    try {
      const g = JSON.parse(o.armazem?.getItem(CHAVE_LIGACAO) ?? "null");
      if (g && RE_TOKEN.test(g.token) && (!g.expira || Date.parse(g.expira) > Date.now())) return g;
    } catch { /* nada guardado */ }
    return null;
  }

  function comecar(t, p, exp) {
    token = t;
    papel = p;
    expira = exp ?? null;
    gravar();
    agendarPoll(0);
  }

  /** A ligação terminou (pedido enviado, "Começar de novo" noutro aparelho, 24 h): fica tudo só neste aparelho. */
  function terminada(texto) {
    const tinha = !!token;
    parar();
    for (const f of o.fotos.values()) f.servidor = null;
    if (tinha && texto) o.avisar(texto);
    desenharCartao();
  }
  function parar() {
    token = null;
    papel = null;
    base = null;
    versao = versaoEstado = 0;
    clearTimeout(temporizadorPoll);
    clearTimeout(temporizadorEnvio);
    pendente = false;
    porApagar.clear();
    gravar();
  }

  // ---------------------------------------------------------------- estado
  function agendarPoll(ms = document.hidden ? POLL_ESCONDIDA_MS : POLL_MS) {
    clearTimeout(temporizadorPoll);
    if (token) temporizadorPoll = setTimeout(poll, ms);
  }
  document.addEventListener("visibilitychange", () => { if (token && !document.hidden) agendarPoll(0); });

  async function poll() {
    if (!token) return;
    const t = token;
    try {
      const r = await fetch(`${url("/estado")}?estado=${versaoEstado}`, {
        credentials: o.credenciais, cache: "no-store", headers: cab(versao ? { "If-None-Match": `"${versao}"` } : {}),
      });
      if (t !== token) return;
      if (r.status === 404) { terminada("A ligação ao outro aparelho terminou (pedido enviado, simulação recomeçada ou mais de 24 h). Pode continuar aqui."); return; }
      if (r.status === 200) {
        const j = await r.json();
        if (t !== token) return;
        let aplicado = true;
        if (j.estado !== undefined && j.versao_estado !== versaoEstado) aplicado = receber(j.estado, j.versao_estado);
        if (aplicado) {
          versao = j.versao;
          if (j.expira) expira = j.expira;
          await acertarFotos(Array.isArray(j.fotos) ? j.fotos : []);
        }
      }
    } catch { /* sem rede: tenta no próximo */ }
    agendarPoll();
  }

  /** Estado novo do outro aparelho. Devolve false se agora não se pode aplicar (fica para o próximo poll). */
  function receber(remoto, ve) {
    if (!o.podeSincronizar()) return false;
    const local = paraLigacao(o.obterEstado());
    const mudouAqui = base !== null && JSON.stringify(local) !== base;
    const r = mudouAqui ? fundirEstados(JSON.parse(base), local, remoto) : remoto;
    base = JSON.stringify(remoto);
    versaoEstado = ve;
    o.aplicar(r, { fundido: mudouAqui });
    if (mudouAqui) mudou();
    return true;
  }

  /** O estado mudou neste aparelho: envia daqui a pouco. */
  function mudou() {
    if (!token) return;
    clearTimeout(temporizadorEnvio);
    temporizadorEnvio = setTimeout(enviar, ENVIO_MS);
  }

  async function enviar() {
    if (!token || base === null) return;
    if (aEnviar) { pendente = true; return; }
    if (!o.podeSincronizar()) { temporizadorEnvio = setTimeout(enviar, 1500); return; }
    const local = paraLigacao(o.obterEstado());
    const txt = JSON.stringify(local);
    if (txt === base) return;
    aEnviar = true;
    const t = token;
    try {
      const r = await fetch(url("/estado"), {
        method: "POST", credentials: o.credenciais, cache: "no-store",
        headers: cab({ "Content-Type": "application/json" }), body: JSON.stringify({ base: versaoEstado, estado: local }),
      });
      if (t !== token) return;
      if (r.status === 404) { terminada("A ligação ao outro aparelho terminou. Pode continuar aqui."); return; }
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        base = txt;
        versaoEstado = j.versao_estado;
      } else if (r.status === 409 && j?.estado) {
        // O outro aparelho escreveu entretanto: junta e volta a enviar.
        if (o.podeSincronizar()) {
          const junto = fundirEstados(JSON.parse(base), local, j.estado);
          base = JSON.stringify(j.estado);
          versaoEstado = j.versao_estado;
          o.aplicar(junto, { fundido: true });
        }
        pendente = true;
      } else if (r.status === 413) {
        o.avisar("A simulação ficou grande demais para passar ao outro aparelho (tire a planta de fundo). Continua guardada aqui.");
      } else pendente = true;
    } catch {
      pendente = true;
    } finally {
      aEnviar = false;
    }
    if (pendente && token) {
      pendente = false;
      clearTimeout(temporizadorEnvio);
      temporizadorEnvio = setTimeout(enviar, 1000);
    }
  }

  // ---------------------------------------------------------------- fotos
  async function acertarFotos(lista) {
    const srv = new Map(lista.map((f) => [f.chave, f]));
    let mudouAlgo = false;
    for (const [chave, f] of [...o.fotos]) {
      if (emCurso.has(chave) || porApagar.has(chave)) continue;
      const s = srv.get(chave);
      if (f.servidor && !s) {                // apagada no outro aparelho
        o.fotos.delete(chave);
        apagarFoto(o.idFotos(), chave);
        mudouAlgo = true;
      } else if (!f.servidor) subir(chave);  // tirada aqui e ainda não enviada
      else if (f.servidor !== s.id) descer(s);   // trocada no outro aparelho
    }
    for (const s of lista) if (!o.fotos.has(s.chave) && !emCurso.has(s.chave) && !porApagar.has(s.chave)) descer(s);
    for (const chave of porApagar) apagarNoServidor(chave);
    if (mudouAlgo) o.aoFotos();
  }

  async function subir(chave) {
    const f = o.fotos.get(chave);
    if (!token || !f?.blob || emCurso.has(chave)) return;
    emCurso.add(chave);
    const t = token;
    try {
      const r = await fetch(url("/fotos"), {
        method: "POST", credentials: o.credenciais,
        headers: cab({ "Content-Type": f.blob.type === "image/png" ? "image/png" : "image/jpeg", "X-Foto-Chave": chave }), body: f.blob,
      });
      if (t !== token) return;
      if (r.status === 404) { terminada("A ligação ao outro aparelho terminou. A foto ficou aqui."); return; }
      const j = await r.json().catch(() => null);
      if (r.ok && j?.id) {
        f.servidor = j.id;
        if (o.fotos.get(chave) === f) guardarFoto(o.idFotos(), chave, f);
      } else if (j?.erro && r.status !== 429) o.avisar(`A foto não passou para o outro aparelho: ${j.erro}`);
    } catch { /* sem rede: volta a tentar no próximo poll */ } finally {
      emCurso.delete(chave);
    }
    // Trocada enquanto subia: sobe a nova.
    const agora = o.fotos.get(chave);
    if (token && agora && agora !== f && !agora.servidor) subir(chave);
  }

  async function descer(s) {
    if (!token || emCurso.has(s.chave)) return;
    emCurso.add(s.chave);
    const t = token;
    try {
      const r = await fetch(url(`/fotos/${encodeURIComponent(s.id)}`), { credentials: o.credenciais, cache: "no-store", headers: cab() });
      if (t !== token || !r.ok) return;
      const blob = await r.blob();
      const red = await reduzirFoto(blob);   // só para a miniatura (data: URL); a foto fica a do servidor
      if (t !== token || porApagar.has(s.chave)) return;
      const f = { chave: s.chave, ...red, blob, servidor: s.id };
      o.fotos.set(s.chave, f);
      await guardarFoto(o.idFotos(), s.chave, f);
      o.aoFotos();
    } catch { /* tenta no próximo poll */ } finally {
      emCurso.delete(s.chave);
    }
  }

  async function apagarNoServidor(chave) {
    if (!token || emCurso.has(chave)) return;
    emCurso.add(chave);
    try {
      const r = await fetch(url("/fotos/apagar"), {
        method: "POST", credentials: o.credenciais, headers: cab({ "Content-Type": "application/json" }), body: JSON.stringify({ chave }),
      });
      if (r.ok || r.status === 404) porApagar.delete(chave);
    } catch { /* tenta no próximo poll */ } finally {
      emCurso.delete(chave);
    }
  }

  // ---------------------------------------------------------------- cartão do QR (passo 4, computador)
  const ecraLargo = () => typeof matchMedia !== "function" || matchMedia(ECRA_QR).matches;

  function desenharCartao() {
    const c = o.caixa;
    if (!c) return;
    const visivel = !c.dataset.fora && papel !== "telemovel" && ecraLargo();
    c.hidden = !visivel;
    if (!visivel) return;
    if (token && qrDe === token) return;
    c.replaceChildren();
    const t = document.createElement("h3");
    t.id = "ligacao-titulo";
    t.textContent = "Continue no telemóvel";
    c.append(t);
    if (!token) {
      const p = document.createElement("p");
      p.className = "ligacao-nota";
      p.textContent = semServidor ? "Sem ligação ao servidor: continue aqui." : "A preparar o código…";
      c.append(p);
      qrDe = null;
      return;
    }
    const endereco = `${location.origin}${location.pathname}#ligar=${token}`;
    const qr = document.createElement("div");
    qr.className = "ligacao-qr";
    try {
      qr.append(svgQR(endereco, { rotulo: "Código QR para abrir esta simulação no telemóvel" }));
    } catch {
      c.hidden = true;
      return;
    }
    const p = document.createElement("p");
    p.textContent = "Leia este código, vá a cada divisão, tire as fotos e responda ao que falta.";
    const n = document.createElement("p");
    n.className = "ligacao-nota";
    n.textContent = "O que mudar num aparelho aparece no outro. Válido 24 horas, sem conta.";
    c.append(qr, p, n);
    qrDe = token;
  }

  /** Passo 4 à vista (`sim`) ou não: no computador cria a ligação (uma vez) e mostra o QR. */
  function mostrarCartao(sim = true) {
    if (!o.caixa) return;
    if (!sim) { o.caixa.dataset.fora = "1"; o.caixa.hidden = true; return; }
    delete o.caixa.dataset.fora;
    if (semServidor && Date.now() - semServidor > 60_000) semServidor = 0;
    if (!token && ecraLargo() && papel !== "telemovel" && !semServidor) criar();
    desenharCartao();
  }

  function criar() {
    if (aCriar || token) return aCriar;
    aCriar = (async () => {
      const estado = paraLigacao(o.obterEstado());
      try {
        const r = await fetch(url(""), {
          method: "POST", credentials: o.credenciais, cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ estado }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !RE_TOKEN.test(j?.token ?? "")) throw new Error(String(r.status));
        base = JSON.stringify(estado);
        versaoEstado = j.versao_estado;
        versao = 0;   // o primeiro poll traz a lista das fotos
        comecar(j.token, "computador", j.expira);
        // As fotos já tiradas neste aparelho passam para o outro.
        for (const f of o.fotos.values()) f.servidor = null;
        for (const chave of o.fotos.keys()) subir(chave);
        mudou();      // o que mudou enquanto a ligação nascia
      } catch {
        semServidor = Date.now();
      } finally {
        aCriar = null;
        desenharCartao();
      }
    })();
    return aCriar;
  }

  // Ecrã redimensionado (janela estreita, tablet rodado): o cartão aparece ou esconde-se. (A lista fica guardada:
  // sem uma referência o navegador pode deitá-la fora com o ouvinte.)
  const consulta = typeof matchMedia === "function" ? matchMedia(ECRA_QR) : null;
  consulta?.addEventListener?.("change", () => { if (o.caixa && !o.caixa.dataset.fora) mostrarCartao(true); });

  return {
    get token() { return token; },
    get papel() { return papel; },
    mudou,
    mostrarCartao,
    /** Telemóvel: entra pelo QR. Devolve o estado da simulação (ou lança erro com `estado` 404 se terminou). */
    async entrar(t) {
      if (!RE_TOKEN.test(t)) throw Object.assign(new Error("token"), { estado: 404 });
      const anterior = token;
      token = t;
      let r;
      try {
        r = await fetch(url("/estado"), { credentials: o.credenciais, cache: "no-store", headers: cab() });
      } catch {
        token = anterior;
        throw Object.assign(new Error("rede"), { estado: 0 });
      }
      if (!r.ok) { token = anterior; throw Object.assign(new Error(String(r.status)), { estado: r.status }); }
      const j = await r.json();
      base = JSON.stringify(j.estado);
      versaoEstado = j.versao_estado;
      versao = 0;
      comecar(t, "telemovel", j.expira);
      return j.estado;
    },
    /**
     * Ao continuar a simulação guardada: retoma a ligação deste aparelho, se ainda for válida (o QR é o mesmo). O
     * primeiro poll espera por `antes` (as fotos do IndexedDB, que sabem se já estão no servidor).
     */
    retomar(antes = null) {
      const g = lerGuardada();
      if (!g) { gravar(); return false; }
      // Sem a versão comum: o primeiro poll traz o estado do servidor, que fica (o outro aparelho pode ter mudado).
      base = null;
      versao = versaoEstado = 0;
      token = g.token;
      papel = g.papel === "telemovel" ? "telemovel" : "computador";
      expira = g.expira ?? null;
      Promise.resolve(antes).catch(() => {}).finally(() => { if (token === g.token) agendarPoll(0); });
      return true;
    },
    fotoTirada(chave) { if (token) subir(chave); },
    fotoApagada(chave) { if (token) { porApagar.add(chave); apagarNoServidor(chave); } },
    /** "Começar de novo": termina a ligação no servidor (o outro aparelho fica só com a dele). */
    terminar() {
      const t = token ?? lerGuardada()?.token;
      parar();
      semServidor = 0;
      qrDe = null;
      if (t) {
        fetch(url("/terminar"), {
          method: "POST", credentials: o.credenciais, keepalive: true,
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Ligacao-Token": t }, body: "{}",
        }).catch(() => {});
      }
    },
    /** Pedido enviado (o painel já terminou a ligação). */
    encerrar() { parar(); qrDe = null; },
  };
}
