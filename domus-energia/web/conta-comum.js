// Conta de cliente (docs/CONTA-CLIENTE.md): chamadas a /api/conta/* e o bloco "Criar conta / Entrar /
// Confirmar o email / Esqueci a palavra-passe", usado no passo "Enviar" do simulador e em conta.html.
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
  return j;
}

/** Conta da sessão ({conta, simulacao_atualizada, tem_casa}) ou null (sem sessão / sem ligação). */
export async function contaAtual() {
  try { return await pedirConta("eu"); } catch { return null; }
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
  f.setAttribute("role", "note");
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
  let modo = "criar";      // fora: criar | codigo | entrar | esqueci | repor
  let emailRepor = "";
  // Depois de "Criar conta" (sem sessão ainda): o email e a palavra-passe ficam só em memória até confirmar o código.
  let pendente = null;     // {email, password}
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
    if (modo === "criar") {
      const s1 = campo("Palavra-passe", "senha", { type: "password", maxlength: "200", autocomplete: "new-password" }, "Pelo menos 10 caracteres.");
      const s2 = campo("Confirmar a palavra-passe", "senha2", { type: "password", maxlength: "200", autocomplete: "new-password" });
      const criar = botao("Criar conta", "criar", () => ocupado(criar, async () => {
        const e = email.i.value.trim();
        if (!RE_EMAIL.test(e)) { invalido(email, "O email não parece certo (ex.: nome@exemplo.pt)."); return; }
        if (s1.i.value.length < 10) { invalido(s1, "A palavra-passe deve ter pelo menos 10 caracteres."); return; }
        if (s1.i.value !== s2.i.value) { invalido(s2, "As duas palavras-passe não são iguais."); return; }
        // A resposta é sempre a mesma (o servidor não diz se o email já tem conta); a sessão abre ao confirmar o código.
        const r = await pedirConta("criar", { corpo: { email: e, password: s1.i.value } });
        pendente = { email: e, password: s1.i.value };
        modo = "codigo";
        desenhar();
        mensagem(r?.mensagem ?? "Enviámos um código para o email.", "info");
        document.getElementById(id("codigo"))?.focus();
      }));
      comEnter([email, s1, s2], criar);
      caixa.append(el("p", { texto: texto.fora ?? "Crie uma conta para enviar o pedido e acompanhá-lo depois." }), msg,
        email.l, el("div", { classe: "duas" }, s1.l, s2.l),
        el("div", { classe: "form-botoes" }, criar, ligacao("Já tenho conta — entrar", "ir-entrar", () => { modo = "entrar"; mensagem(null); desenhar(); focar(); })));
    } else if (modo === "codigo" && pendente) {
      // Código depois de "Criar conta": confirma com o email e a palavra-passe e abre a sessão.
      const cod = campo("Código de 6 algarismos", "codigo", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*" });
      const sairDoCodigo = (m) => { emailRepor = pendente?.email ?? ""; pendente = null; modo = m; mensagem(null); desenhar(); focar(); };
      const confirmar = botao("Confirmar", "confirmar", () => ocupado(confirmar, async () => {
        const v = cod.i.value.replace(/\s/g, "");
        if (!/^\d{6}$/.test(v)) { invalido(cod, "O código tem 6 algarismos."); return; }
        const r = await pedirConta("confirmar", { corpo: { email: pendente.email, password: pendente.password, codigo: v } });
        pendente = null;
        modo = "entrar";
        eu = await contaAtual() ?? { conta: r.conta };
        mensagem(null);
        desenhar();
        aoMudar(eu);
      }));
      const reenviar = ligacao("Reenviar o código", "reenviar", () => ocupado(reenviar, async () => {
        await pedirConta("criar", { corpo: { email: pendente.email, password: pendente.password } });
        mensagem("Pedimos outro código. Veja também o correio não desejado (spam).", "info");
      }));
      comEnter([cod], confirmar);
      caixa.append(
        el("p", {}, "Enviámos um código para ", el("strong", { texto: pendente.email }), ". Escreva-o aqui para confirmar o email (vale 15 minutos)."),
        el("p", { classe: "ajuda", id: id("ja-tem-conta") },
          "Se este email já tem conta, não recebe código: recebe um aviso. Nesse caso, entre com a sua palavra-passe ou use \"Esqueci a palavra-passe\"."),
        msg, el("div", { classe: "duas" }, cod.l),
        el("div", { classe: "form-botoes" }, confirmar, reenviar,
          ligacao("Já tenho conta — entrar", "ir-entrar", () => sairDoCodigo("entrar")),
          ligacao("Esqueci a palavra-passe", "ir-esqueci", () => sairDoCodigo("esqueci"))));
    } else if (modo === "entrar") {
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
      caixa.append(el("p", { texto: "Entre na sua conta." }), msg, el("div", { classe: "duas" }, email.l, s.l),
        el("div", { classe: "form-botoes" }, entrar,
          ligacao("Esqueci a palavra-passe", "ir-esqueci", () => { emailRepor = email.i.value.trim(); modo = "esqueci"; mensagem(null); desenhar(); focar(); }),
          ligacao("Criar conta", "ir-criar", () => { modo = "criar"; mensagem(null); desenhar(); focar(); })));
    } else if (modo === "esqueci") {
      email.i.value = emailRepor;
      const enviar = botao("Enviar código", "enviar-codigo", () => ocupado(enviar, async () => {
        const e = email.i.value.trim();
        if (!RE_EMAIL.test(e)) { invalido(email, "O email não parece certo (ex.: nome@exemplo.pt)."); return; }
        const r = await pedirConta("esqueci", { corpo: { email: e } });
        emailRepor = e;
        modo = "repor";
        desenhar();
        mensagem(r?.mensagem ?? "Se houver uma conta com este email, enviámos um código.", "info");
        focar();
      }));
      comEnter([email], enviar);
      caixa.append(el("p", { texto: "Escreva o email da conta: enviamos um código para mudar a palavra-passe." }), msg, email.l,
        el("div", { classe: "form-botoes" }, enviar, ligacao("Voltar a entrar", "ir-entrar", () => { modo = "entrar"; mensagem(null); desenhar(); focar(); })));
    } else {
      const cod = campo("Código de 6 algarismos", "codigo", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7" });
      const s1 = campo("Palavra-passe nova", "senha", { type: "password", maxlength: "200", autocomplete: "new-password" }, "Pelo menos 10 caracteres.");
      const s2 = campo("Confirmar a palavra-passe", "senha2", { type: "password", maxlength: "200", autocomplete: "new-password" });
      const mudar = botao("Mudar a palavra-passe", "repor", () => ocupado(mudar, async () => {
        const v = cod.i.value.replace(/\s/g, "");
        if (!/^\d{6}$/.test(v)) { invalido(cod, "O código tem 6 algarismos."); return; }
        if (s1.i.value.length < 10) { invalido(s1, "A palavra-passe deve ter pelo menos 10 caracteres."); return; }
        if (s1.i.value !== s2.i.value) { invalido(s2, "As duas palavras-passe não são iguais."); return; }
        await pedirConta("repor", { corpo: { email: emailRepor, codigo: v, password: s1.i.value } });
        eu = await contaAtual();
        modo = "entrar";
        desenhar();
        mensagem("Palavra-passe mudada.", "ok");
        aoMudar(eu);
      }));
      comEnter([cod, s1, s2], mudar);
      caixa.append(el("p", {}, "Código enviado para ", el("strong", { texto: emailRepor }), "."), msg, cod.l, el("div", { classe: "duas" }, s1.l, s2.l),
        el("div", { classe: "form-botoes" }, mudar, ligacao("Pedir outro código", "ir-esqueci", () => { modo = "esqueci"; mensagem(null); desenhar(); focar(); })));
    }
  }

  async function sair() {
    try { await pedirConta("sair", { corpo: {} }); } catch { /* a sessão fica sem efeito no servidor na mesma ao expirar */ }
    eu = null;
    modo = "entrar";
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
