// Conta de cliente (docs/CONTA-CLIENTE.md): chamadas a /api/conta/* e o bloco "Criar conta (só o email) / Código /
// Entrar com código / Entrar com palavra-passe", usado no passo "Enviar" do simulador e em conta.html. Fase 3 da
// auditoria: a conta cria-se só com o email e o código de 6 dígitos; a palavra-passe é opcional (define-se na conta).
// O painel serve as rotas; com DOMUS.apiBase (site no Vercel, painel noutro endereço) os pedidos levam
// o cookie da conta (credentials: "include"; o painel responde com CORS só para SITE_ORIGENS).
// Sem <form> (o bloco fica dentro do formulário do simulador): Enter num campo carrega no botão principal.

const cfg = window.DOMUS ?? {};
const base = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
/** Base das rotas do painel no browser: "<apiBase>/api" ou, sem apiBase, a do site (apiUrl, "/api"). */
export const urlPainelApi = base ? `${base}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "");
/** Cookies da conta: noutra origem têm de ir explicitamente. */
export const credenciais = base ? "include" : "same-origin";
/** Endereço de um caminho devolvido pelo painel ("/api/conta/pedidos/1/fotos/…"). */
export const urlDoPainel = (caminho) => (base && String(caminho).startsWith("/") ? `${base}${caminho}` : caminho);

export class ErroConta extends Error {
  constructor(estado, mensagem) {
    super(mensagem);
    this.estado = estado;
  }
}

/** GET (sem corpo) ou POST (corpo JSON; `bruto`: Blob tal e qual, com os cabeçalhos dados) a /api/conta/<caminho>. */
export async function pedirConta(caminho, { corpo, bruto, cabecalhos = {}, sinal } = {}) {
  const opcoes = { method: corpo !== undefined || bruto !== undefined ? "POST" : "GET", credentials: credenciais, headers: { Accept: "application/json", ...cabecalhos }, signal: sinal };
  if (bruto !== undefined) opcoes.body = bruto;
  else if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  let r;
  try {
    r = await fetch(`${urlPainelApi}/conta/${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ErroConta(0, "Sem ligação ao servidor. Verifique a internet e tente de novo.");
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw new ErroConta(r.status, typeof j?.erro === "string" ? j.erro : `Não foi possível (erro ${r.status}). Tente de novo.`);
  // A sessão abre ao entrar, confirmar o código ou repor a palavra-passe, e fecha ao sair (B10: marca para /eu).
  if (["entrar", "confirmar", "repor"].includes(caminho)) marcarSessao(true);
  else if (caminho === "sair") marcarSessao(false);
  return j;
}

/**
 * B10: o cookie da sessão é HttpOnly (não se vê daqui); para não pedir /api/conta/eu sem sessão (401 na consola em
 * todas as páginas) fica uma marca no localStorage, posta ao entrar/confirmar/repor e tirada ao sair ou com um 401.
 * Sem localStorage (modo privado, bloqueado) pede-se como antes.
 */
const MARCA_SESSAO = "domus_conta_sessao";
const armazem = (() => { try { return window.localStorage; } catch { return null; } })();
export function marcarSessao(tem) {
  try { if (tem) armazem?.setItem(MARCA_SESSAO, "1"); else armazem?.removeItem(MARCA_SESSAO); } catch { /* sem armazenamento */ }
}
const temMarcaSessao = () => { try { return !armazem || armazem.getItem(MARCA_SESSAO) === "1"; } catch { return true; } };

/** Conta da sessão ({conta, simulacao_atualizada, tem_casa}) ou null (sem sessão / sem ligação). */
export async function contaAtual() {
  if (!temMarcaSessao()) return null;
  try {
    const eu = await pedirConta("eu");
    marcarSessao(true);
    return eu;
  } catch (e) {
    if (e?.estado === 401) marcarSessao(false);
    return null;
  }
}

/**
 * Faixa "Modo de demonstração — pagamentos simulados" por baixo do topo (docs/PAGAMENTOS-PEDIDO.md): o servidor diz
 * `demonstracao: true` quando PAGAMENTOS_MODO=simulado (nenhum dinheiro real). Sem ela, a faixa sai.
 */
export function faixaDemonstracao(ligada) {
  const antes = document.getElementById("faixa-demonstracao");
  if (!ligada) { antes?.remove(); return; }
  if (antes) return;
  const f = document.createElement("div");
  f.id = "faixa-demonstracao";
  f.className = "faixa-demonstracao";
  f.setAttribute("role", "region");
  f.setAttribute("aria-label", "Aviso: modo de demonstração");
  f.textContent = "Modo de demonstração — pagamentos simulados: não é cobrado nada.";
  const topo = document.querySelector("header.topo");
  if (topo) topo.after(f); else document.body.prepend(f);
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const el = (tag, props = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "texto") e.textContent = v;
    else if (k === "classe") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false));
  return e;
};

/**
 * Bloco da conta dentro de `caixa`. `prefixo`: ids dos campos (ex.: "conta" → #conta-email).
 * `aoMudar(eu)`: chamado com {conta, …} ou null sempre que a sessão muda (entrou, confirmou, saiu).
 * `texto`: frases de introdução por estado ({fora, confirmar}).
 * Devolve {atualizar(), eu(), sair(), focar()}.
 */
export function criarBlocoConta(caixa, { prefixo = "conta", aoMudar = () => {}, texto = {} } = {}) {
  let eu = null;
  let modo = "criar";      // fora: criar | codigo | entrar (com código) | senha (com palavra-passe)
  let emailRepor = "";     // o email já escrito, para o campo seguinte
  // Depois de "Criar conta" ou "Enviar código" (sem sessão ainda): o email fica só em memória até confirmar o código.
  let pendente = null;     // {email, origem: "criar" | "codigo"}
  const id = (n) => `${prefixo}-${n}`;
  const msg = el("div", { classe: "msg", role: "status", id: id("msg"), hidden: true });

  function mensagem(t, tipo = "erro") {
    msg.textContent = t ?? "";
    msg.className = `msg ${tipo}`;
    msg.hidden = !t;
  }

  function campo(rotulo, nome, props = {}, ajuda = null) {
    const i = el("input", { id: id(nome), name: nome, ...props });
    return { l: el("label", {}, rotulo, ajuda ? el("small", { classe: "ajuda", texto: ajuda }) : null, i), i };
  }
  function botao(textoB, nome, acao, classe = "btn") {
    return el("button", { type: "button", classe, id: id(nome), texto: textoB, onclick: acao });
  }
  function ligacao(textoB, nome, acao) {
    return el("button", { type: "button", classe: "link-botao", id: id(nome), texto: textoB, onclick: acao });
  }
  /** Enter em qualquer campo = botão principal (não há <form>). */
  function comEnter(campos, principal) {
    for (const c of campos) c.i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); principal.click(); } });
  }
  async function ocupado(b, fn) {
    if (b.disabled) return;
    const antes = b.textContent;
    b.disabled = true;
    b.textContent = "Um momento…";
    try { await fn(); } catch (e) {
      mensagem(e?.message || "Não foi possível. Tente de novo.");
    } finally {
      b.disabled = false;
      b.textContent = antes;
    }
  }
  function invalido(c, t) {
    mensagem(t);
    c.i.setAttribute("aria-invalid", "true");
    c.i.setAttribute("aria-describedby", id("msg"));
    c.i.focus();
    return true;
  }

  function desenhar() {
    caixa.replaceChildren();
    caixa.classList.add("conta-bloco");
    if (eu && eu.conta.confirmado) {
      caixa.append(el("p", { classe: "conta-entrou", id: id("entrou") },
        "Entrou como ", el("strong", { texto: eu.conta.email }), " · ",
        ligacao("Sair", "sair", () => sair())));
      caixa.append(msg);
      return;
    }
    if (eu) {
      // Email por confirmar: código de 6 dígitos.
      const cod = campo("Código de 6 algarismos", "codigo", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*" });
      const confirmar = botao("Confirmar", "confirmar", () => ocupado(confirmar, async () => {
        const v = cod.i.value.replace(/\s/g, "");
        if (!/^\d{6}$/.test(v)) { invalido(cod, "O código tem 6 algarismos."); return; }
        const r = await pedirConta("confirmar", { corpo: { codigo: v } });
        eu = { ...eu, conta: r.conta };
        mensagem(null);
        desenhar();
        aoMudar(eu);
      }));
      const reenviar = ligacao("Reenviar o código", "reenviar", () => ocupado(reenviar, async () => {
        await pedirConta("reenviar", { corpo: {} });
        mensagem("Enviámos um código novo. Veja também o correio não desejado (spam).", "info");
      }));
      comEnter([cod], confirmar);
      caixa.append(
        el("p", { texto: texto.confirmar ?? "Enviámos um código para o seu email. Escreva-o aqui para confirmar o email (vale 15 minutos)." }),
        el("p", { classe: "conta-entrou" }, "Conta: ", el("strong", { texto: eu.conta.email }), " · ", ligacao("Sair", "sair", () => sair())),
        msg, el("div", { classe: "duas" }, cod.l), el("div", { classe: "form-botoes" }, confirmar, reenviar));
      return;
    }
    if (modo === "codigo" && !pendente) modo = "criar";
    const email = campo("Email", "email", { type: "email", maxlength: "254", autocomplete: "email", inputmode: "email" });
    const irPara = (m) => { emailRepor = email.i.value.trim() || emailRepor; modo = m; mensagem(null); desenhar(); focar(); };
    /** Pede o código para `e` ("criar" cria a conta se não existe; "codigo" só para contas que existem) e passa ao código. */
    const pedirCodigo = async (e, origem) => {
      const r = await pedirConta(origem, { corpo: { email: e } });
      pendente = { email: e, origem };
      modo = "codigo";
      desenhar();
      mensagem(r?.mensagem ?? "Enviámos um código para o email.", "info");
      document.getElementById(id("codigo"))?.focus();
    };
    if (modo === "criar") {
      if (emailRepor) email.i.value = emailRepor;
      const criar = botao("Criar conta", "criar", () => ocupado(criar, async () => {
        const e = email.i.value.trim();
        if (!RE_EMAIL.test(e)) { invalido(email, "O email não parece certo (ex.: nome@exemplo.pt)."); return; }
        // A resposta é sempre a mesma (o servidor não diz se o email já tem conta); a sessão abre ao confirmar o código.
        await pedirCodigo(e, "criar");
      }));
      comEnter([email], criar);
      // Consentimento (RGPD): a conta e o pedido são necessários ao contrato, por isso basta a frase com as ligações.
      const consentimento = el("p", { classe: "consentimento", id: id("consentimento") }, "Ao enviar, aceita os ",
        el("a", { href: "termos.html", target: "_blank", rel: "noopener", texto: "Termos" }), " e a ",
        el("a", { href: "privacidade.html", target: "_blank", rel: "noopener", texto: "Política de Privacidade" }), ".");
      caixa.append(el("p", { texto: texto.fora ?? "Crie uma conta para enviar o pedido e acompanhá-lo depois." }), msg,
        email.l, el("p", { classe: "ajuda", id: id("sem-senha"), texto: "Só o email: enviamos um código de 6 algarismos. Sem palavra-passe." }), consentimento,
        el("div", { classe: "form-botoes" }, criar, ligacao("Já tenho conta — entrar", "ir-entrar", () => irPara("entrar"))));
    } else if (modo === "codigo" && pendente) {
      // Código depois de "Criar conta" ou "Enviar código": confirma com o email e abre a sessão.
      const cod = campo("Código de 6 algarismos", "codigo", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*" });
      const confirmar = botao("Confirmar", "confirmar", () => ocupado(confirmar, async () => {
        const v = cod.i.value.replace(/\s/g, "");
        if (!/^\d{6}$/.test(v)) { invalido(cod, "O código tem 6 algarismos."); return; }
        const r = await pedirConta("confirmar", { corpo: { email: pendente.email, codigo: v } });
        pendente = null;
        modo = "entrar";
        eu = await contaAtual() ?? { conta: r.conta };
        mensagem(null);
        desenhar();
        aoMudar(eu);
      }));
      const reenviar = ligacao("Reenviar o código", "reenviar", () => ocupado(reenviar, async () => {
        await pedirConta(pendente.origem, { corpo: { email: pendente.email } });
        mensagem("Pedimos outro código. Veja também o correio não desejado (spam).", "info");
      }));
      comEnter([cod], confirmar);
      caixa.append(
        el("p", {}, "Enviámos um código para ", el("strong", { texto: pendente.email }), ". Escreva-o aqui (vale 15 minutos)."),
        msg, el("div", { classe: "duas" }, cod.l),
        el("div", { classe: "form-botoes" }, confirmar, reenviar,
          ligacao("Outro email", "ir-criar", () => { emailRepor = pendente?.email ?? ""; pendente = null; modo = "criar"; mensagem(null); desenhar(); focar(); })));
    } else if (modo === "entrar") {
      // Entrar com código: o email → código → sessão (também serve de "Esqueci-me da palavra-passe").
      if (emailRepor) email.i.value = emailRepor;
      const enviar = botao("Enviar código", "enviar-codigo", () => ocupado(enviar, async () => {
        const e = email.i.value.trim();
        if (!RE_EMAIL.test(e)) { invalido(email, "O email não parece certo (ex.: nome@exemplo.pt)."); return; }
        await pedirCodigo(e, "codigo");
      }));
      comEnter([email], enviar);
      caixa.append(el("p", { texto: "Entre com um código enviado para o seu email." }), msg, email.l,
        el("div", { classe: "form-botoes" }, enviar,
          ligacao("Entrar com palavra-passe", "ir-senha", () => irPara("senha")),
          ligacao("Criar conta", "ir-criar", () => irPara("criar"))));
    } else {
      // Entrar com palavra-passe (quem a definiu na conta).
      if (emailRepor) email.i.value = emailRepor;
      const s = campo("Palavra-passe", "senha", { type: "password", maxlength: "200", autocomplete: "current-password" });
      const entrar = botao("Entrar", "entrar", () => ocupado(entrar, async () => {
        const e = email.i.value.trim();
        if (!RE_EMAIL.test(e)) { invalido(email, "O email não parece certo (ex.: nome@exemplo.pt)."); return; }
        if (!s.i.value) { invalido(s, "Escreva a palavra-passe."); return; }
        const r = await pedirConta("entrar", { corpo: { email: e, password: s.i.value } });
        eu = await contaAtual() ?? { conta: r.conta };
        mensagem(null);
        desenhar();
        aoMudar(eu);
      }));
      comEnter([email, s], entrar);
      caixa.append(el("p", { texto: "Entre com a sua palavra-passe." }), msg, el("div", { classe: "duas" }, email.l, s.l),
        el("div", { classe: "form-botoes" }, entrar,
          ligacao("Entrar com código", "ir-entrar", () => irPara("entrar")),
          ligacao("Esqueci-me da palavra-passe", "ir-esqueci", () => { irPara("entrar"); mensagem("Entre com um código. Depois pode definir uma palavra-passe nova na sua conta.", "info"); })));
    }
  }

  async function sair() {
    try { await pedirConta("sair", { corpo: {} }); } catch { /* a sessão fica sem efeito no servidor na mesma ao expirar */ }
    eu = null;
    modo = "entrar";
    mensagem(null);
    desenhar();
    aoMudar(null);
  }

  function focar() { caixa.querySelector("input")?.focus(); }

  async function atualizar() {
    eu = await contaAtual();
    desenhar();
    aoMudar(eu);
    return eu;
  }

  desenhar();
  return { atualizar, eu: () => eu, sair, focar, mensagem };
}
