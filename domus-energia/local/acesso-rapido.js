// Acesso rápido (testes) — SÓ no lançador local. Este ficheiro não está em web/ nem em painel/public: é o
// local/iniciar.js que o serve (/acesso-rapido.js) e que o junta às páginas, por isso o site publicado nunca o tem.
// Entra sem palavra-passe com utilizadores e contas de teste (rotas em painel/src/acesso-rapido.js, que só existem
// com ACESSO_RAPIDO=1; docs/SEGURANCA.md "Acesso rápido").
//   - barra fixa em baixo, à esquerda, em todas as páginas: os botões todos e "Sair";
//   - no ecrã de entrada do painel: "Entrar como: CEO · Comercial · Técnico";
//   - no bloco da conta (conta.html e passo "Enviar" do simulador): "Cliente de teste 1 · Cliente de teste 2";
//   - no ecrã de entrada da área do eletricista (eletricista.html): "Eletricista de teste";
//   - no ecrã de entrada da Área de cliente (cliente.html): um botão por conta de cliente que existe na base local
//     (POST /api/conta/dev/contas dá só id, email, nome e se tem casa; POST /api/conta/dev/entrar {id} abre a sessão).
//   - por baixo de qualquer campo "Código de 6 algarismos" à vista (conta, relatório do simulador, área do eletricista):
//     o código que ficou no terminal, com "Preencher" — o lançador local não envia emails (decisão do dono, 2026-10-05;
//     POST /api/conta/dev/codigo).
(() => {
  "use strict";
  if (document.getElementById("acesso-rapido")) return;

  // Atalhos: uma linha por botão. Para juntar outro acrescenta-se aqui e em painel/src/acesso-rapido.js.
  const ATALHOS = [
    { grupo: "equipa", rotulo: "CEO", rota: "/painel/api/dev/entrar", corpo: { papel: "ceo" }, destino: "/painel/" },
    { grupo: "equipa", rotulo: "Comercial", rota: "/painel/api/dev/entrar", corpo: { papel: "comercial" }, destino: "/painel/" },
    { grupo: "equipa", rotulo: "Técnico", rota: "/painel/api/dev/entrar", corpo: { papel: "tecnico" }, destino: "/painel/" },
    { grupo: "cliente", rotulo: "Cliente de teste 1", rota: "/api/conta/dev/entrar", corpo: { n: 1 }, destino: "/conta.html" },
    { grupo: "cliente", rotulo: "Cliente de teste 2", rota: "/api/conta/dev/entrar", corpo: { n: 2 }, destino: "/conta.html" },
    { grupo: "eletricista", rotulo: "Eletricista de teste", rota: "/api/eletricista/dev/entrar", corpo: { n: 1 }, destino: "/eletricista.html" },
  ];
  const GRUPOS = { equipa: "Painel", cliente: "Conta de cliente", eletricista: "Eletricista" };
  const MARCA_CONTA = "domus_conta_sessao";   // web/conta-comum.js: "há sessão da conta" (o cookie é HttpOnly)
  const MARCA_ELETRICISTA = "domus_eletricista_sessao";   // web/eletricista.js: o mesmo, para a área do eletricista
  const ABERTA = "domus_acesso_rapido";       // a barra ficou aberta ("1") ou fechada

  const guardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  };

  async function enviar(rota, corpo) {
    const r = await fetch(rota, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corpo) });
    if (r.ok) return;
    let erro = null;
    try { erro = (await r.json())?.erro; } catch { /* sem corpo */ }
    throw new Error(typeof erro === "string" && erro ? erro : `Não foi possível (erro ${r.status}).`);
  }
  const ir = (destino) => { if (location.pathname === destino) location.reload(); else location.assign(destino); };
  // Página com o bloco da conta (conta.html, simulador): o bloco relê a sessão sem recarregar (web/conta-comum.js),
  // e o simulador fica no passo onde estava.
  const temBlocoConta = () => Boolean(document.querySelector(".conta-bloco"));
  const avisarBlocoConta = () => window.dispatchEvent(new Event("domus:conta-sessao"));

  const mensagens = new Set();
  const avisar = (t) => { for (const m of mensagens) { m.textContent = t ?? ""; m.hidden = !t; } };

  /** Entra com o atalho. `ficar` (conta de cliente numa página com o bloco da conta): fica na página em vez de ir ao destino. */
  async function entrar(atalho, ficar) {
    avisar(null);
    try {
      await enviar(atalho.rota, atalho.corpo);
      if (atalho.grupo === "cliente") guardar(MARCA_CONTA, "1");
      if (atalho.grupo === "eletricista") guardar(MARCA_ELETRICISTA, "1");
      if (ficar && temBlocoConta()) avisarBlocoConta(); else ir(atalho.destino);
    } catch (e) {
      avisar(e?.message || "Não foi possível entrar.");
    }
  }

  async function sair() {
    avisar(null);
    // As três sessões (painel, conta e eletricista); sem sessão o servidor responde na mesma.
    await Promise.allSettled([enviar("/painel/api/sair", {}), enviar("/api/conta/sair", {}), enviar("/api/eletricista/sair", {})]);
    guardar(MARCA_CONTA, null);
    guardar(MARCA_ELETRICISTA, null);
    if (temBlocoConta()) avisarBlocoConta(); else location.reload();
  }

  function botoes(grupo, ficar) {
    return ATALHOS.filter((a) => a.grupo === grupo).map((a) => {
      const b = el("button", "ar-botao", a.rotulo);
      b.type = "button";
      b.addEventListener("click", () => entrar(a, ficar));
      return b;
    });
  }
  function mensagem() {
    const m = el("p", "ar-msg");
    m.setAttribute("role", "alert");
    m.hidden = true;
    mensagens.add(m);
    return m;
  }

  // ---------------------------------------------------------------- estilo (as cores vêm do tema da página)
  const estilo = el("style");
  estilo.textContent = `
.ar { position: fixed; left: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); z-index: 45; display: grid; gap: 6px; justify-items: start; max-width: calc(100vw - 16px); font: 600 13px/1.3 system-ui, sans-serif; color: var(--texto, #283618); }
.ar-alternar { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 12px; border: 1px dashed var(--texto, #283618); border-radius: 999px; background: var(--superficie, #fffdf0); color: inherit; font: inherit; cursor: pointer; opacity: .9; }
.ar-caixa { display: grid; gap: 8px; width: min(300px, calc(100vw - 16px)); padding: 12px; border: 1px dashed var(--texto, #283618); border-radius: 14px; background: var(--superficie, #fffdf0); box-shadow: var(--sombra, 0 6px 18px rgba(0, 0, 0, .15)); }
.ar-caixa[hidden], .ar-msg[hidden] { display: none; }
.ar-nota, .ar-msg, .ar-grupo { margin: 0; }
.ar-nota { font-weight: 400; }
.ar-codigo { box-sizing: border-box; width: 100%; flex: 0 0 100%; grid-column: 1 / -1; margin: 8px 0 0; padding: 8px 12px; border: 2px dashed currentColor; border-radius: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ar-codigo strong { font-size: 1.25rem; letter-spacing: .12em; }
.ar-grupo { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ar-rotulo { flex: 0 0 100%; font-size: 12px; font-weight: 400; opacity: .8; }
.ar-botao { min-height: 32px; padding: 4px 12px; border: 1px solid var(--borda, #e6e0bf); border-radius: 999px; background: var(--fundo, #fefae0); color: inherit; font: inherit; cursor: pointer; }
.ar-botao:hover, .ar-alternar:hover { border-color: currentColor; opacity: 1; }
.ar-botao:focus-visible, .ar-alternar:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.ar-msg { color: #b3261e; }
.ar-faixa { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 14px 0 0; padding: 10px 12px; border: 1px dashed var(--texto, #283618); border-radius: 14px; font: 600 13px/1.3 system-ui, sans-serif; color: var(--texto, #283618); }
.ar-faixa .ar-rotulo { font-size: 13px; }
.ar-faixa .ar-msg { flex: 0 0 100%; }
/* Contas da base local (Área de cliente): a lista pode ser comprida — caixa que desliza, um botão por linha. */
.ar-lista { flex: 0 0 100%; display: grid; gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px; }
.ar-conta { border-radius: 12px; text-align: left; overflow-wrap: anywhere; }
.ar-conta small { display: block; font-weight: 400; opacity: .8; }
.ar-casa-teste { margin-left: 18px; font-weight: 400; min-height: 28px; }
/* Os avisos do painel (pedidos pendentes) também ficam em baixo, à esquerda: sobem para cima do botão. */
body.ar-presente .pedidos-pendentes { bottom: 48px; }
@media print { .ar, .ar-faixa { display: none !important; } }
`;
  document.head.append(estilo);

  // ---------------------------------------------------------------- barra fixa
  const barra = el("aside", "ar");
  barra.id = "acesso-rapido";
  barra.setAttribute("aria-label", "Acesso rápido (testes)");
  const caixa = el("div", "ar-caixa");
  caixa.id = "acesso-rapido-caixa";
  caixa.append(el("p", "ar-nota", "Só neste computador: entra sem palavra-passe, com utilizadores de teste."));
  for (const g of Object.keys(GRUPOS)) {
    const bs = botoes(g, g === "cliente" && /\/simulador\.html$/.test(location.pathname));
    if (!bs.length) continue;
    const linha = el("div", "ar-grupo");
    linha.append(el("span", "ar-rotulo", GRUPOS[g]), ...bs);
    caixa.append(linha);
  }
  const bSair = el("button", "ar-botao", "Sair");
  bSair.type = "button";
  bSair.id = "acesso-rapido-sair";
  bSair.addEventListener("click", sair);
  const fim = el("div", "ar-grupo");
  fim.append(bSair);
  caixa.append(fim, mensagem());
  const alternar = el("button", "ar-alternar", "Acesso rápido (testes)");
  alternar.type = "button";
  alternar.id = "acesso-rapido-alternar";
  alternar.setAttribute("aria-controls", caixa.id);
  const abrir = (aberta) => {
    caixa.hidden = !aberta;
    alternar.setAttribute("aria-expanded", String(aberta));
  };
  alternar.addEventListener("click", () => {
    const aberta = caixa.hidden;
    abrir(aberta);
    guardar(ABERTA, aberta ? "1" : "0");
  });
  barra.append(caixa, alternar);
  document.body.append(barra);
  document.body.classList.add("ar-presente");

  // Não tapar o que está preso ao ecrã: a barra sobe para cima do "Anterior / Seguinte" do simulador (e das abas da
  // área do eletricista) e, no painel largo, passa para a direita da navegação lateral.
  function posicionar() {
    const lado = document.getElementById("navegacao");
    barra.style.left = lado && getComputedStyle(lado).position === "sticky" ? `${Math.round(lado.getBoundingClientRect().right) + 8}px` : "";
    barra.style.bottom = "";
    const nav = document.getElementById("sim-navegacao") ?? document.getElementById("el-fundo");
    if (!nav || !nav.getClientRects().length) return;
    const n = nav.getBoundingClientRect(), r = barra.getBoundingClientRect();
    if (n.top < r.bottom && r.top < n.bottom && n.top - r.height - 8 >= 0) barra.style.bottom = `${Math.round(window.innerHeight - n.top) + 8}px`;
  }
  let marcado = false;
  const reposicionar = () => {
    if (marcado) return;
    marcado = true;
    requestAnimationFrame(() => { marcado = false; posicionar(); });
  };
  window.addEventListener("scroll", reposicionar, { passive: true });
  window.addEventListener("resize", reposicionar);
  if (typeof ResizeObserver === "function") new ResizeObserver(reposicionar).observe(document.body);
  alternar.addEventListener("click", posicionar);
  abrir(guardado(ABERTA) === "1");
  posicionar();

  // ---------------------------------------------------------------- faixas dentro das páginas
  function faixa(rotulo, grupo, ficar) {
    const f = el("div", "ar-faixa");
    f.append(el("span", "ar-rotulo", rotulo), ...botoes(grupo, ficar), mensagem());
    return f;
  }
  // Ecrã de entrada do painel (painel/public/index.html).
  document.querySelector("#vista-login .caixa-login")?.append(faixa("Entrar como (testes, só neste computador):", "equipa", false));
  // Bloco da conta: conta.html (#conta-bloco) e passo "Enviar" do simulador (#enviar-conta-bloco). Fica a seguir ao
  // bloco (que se redesenha sozinho).
  for (const id of ["conta-bloco", "enviar-conta-bloco"]) {
    document.getElementById(id)?.after(faixa("Entrar como (testes, só neste computador):", "cliente", true));
  }
  // Ecrã de entrada da área do eletricista (web/eletricista.html).
  document.getElementById("el-entrar-bloco")?.after(faixa("Entrar como (testes, só neste computador):", "eletricista", false));

  // Código no ecrã (decisão do dono, 2026-10-05): o lançador local não envia emails, e o aviso "enviámos um código"
  // deixava-o à espera. Com um campo de código à vista, a nota por baixo mostra o último código pedido e preenche-o.
  const CAMPOS_CODIGO = 'input[autocomplete="one-time-code"], #el-codigo';
  const aVista = (i) => i.getClientRects().length > 0;
  let aVerCodigo = false;
  async function verCodigo() {
    const campos = [...document.querySelectorAll(CAMPOS_CODIGO)].filter(aVista);
    for (const n of document.querySelectorAll(".ar-codigo")) if (!campos.includes(n.arCampo)) n.remove();
    if (!campos.length || aVerCodigo) return;
    aVerCodigo = true;
    let j = null;
    try {
      const r = await fetch("/api/conta/dev/codigo", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
      j = r.ok ? await r.json() : null;
    } catch { j = null; } finally { aVerCodigo = false; }
    if (!j) return;
    for (const campo of campos) {
      let nota = [...document.querySelectorAll(".ar-codigo")].find((n) => n.arCampo === campo);
      const chave = `${j.codigo ?? ""}|${j.para ?? ""}`;
      if (nota?.arChave === chave) continue;
      nota?.remove();
      nota = el("p", "ar-codigo");
      nota.arCampo = campo;
      nota.arChave = chave;
      nota.setAttribute("role", "status");
      if (j.codigo) {
        const b = el("button", "ar-botao", "Preencher");
        b.type = "button";
        b.addEventListener("click", () => { campo.value = j.codigo; campo.dispatchEvent(new Event("input", { bubbles: true })); campo.focus(); });
        nota.append(el("span", null, `Modo de teste: neste computador não é enviado email. Código para ${j.para}: `), el("strong", null, j.codigo), " ", b);
      } else nota.append(el("span", null, "Modo de teste: neste computador não é enviado email. Carregue em \"Reenviar o código\" e o código aparece aqui."));
      (campo.closest("label") ?? campo).after(nota);
    }
  }
  setInterval(verCodigo, 1500);

  // Ecrã de entrada da Área de cliente (web/cliente.html; decisão do dono, 2026-10-03): um botão por conta de cliente
  // que existe na base local, com o email (e o nome), para entrar na área de cliente dela sem palavra-passe.
  async function contasDaBase() {
    const r = await fetch("/api/conta/dev/contas", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(typeof j?.erro === "string" && j.erro ? j.erro : `Não foi possível (erro ${r.status}).`);
    return Array.isArray(j?.contas) ? j.contas : [];
  }
  async function entrarNaConta(c) {
    avisar(null);
    try {
      await enviar("/api/conta/dev/entrar", { id: c.id });
      guardar(MARCA_CONTA, "1");
      // O cliente.js entra sozinho ao recarregar: com a casa ligada, na casa; sem casa ligada, na pré-visualização (a
      // planta e o pedido da conta) — o que um cliente verdadeiro vê.
      location.reload();
    } catch (e) {
      avisar(e?.message || "Não foi possível entrar.");
    }
  }
  /**
   * "Casa de teste" de uma conta sem casa ligada (no lançador local o domus.sh não corre: os pedidos nunca chegam a ter
   * casa): abre a área de cliente com aparelhos pelo "código de cliente" — o broker local aceita qualquer código e
   * palavra-passe. Não abre a sessão da conta (com ela aberta, ao recarregar volta a pré-visualização).
   */
  function casaDeTeste(c) {
    avisar(null);
    const f = document.getElementById("form-login");
    f.elements.codigo.value = `conta-${c.id}`;
    f.elements.password.value = "teste-local";
    f.requestSubmit();
  }
  const loginCliente = document.getElementById("form-login-email")?.closest("#vista-login");
  if (loginCliente) {
    const f = el("div", "ar-faixa");
    const lista = el("div", "ar-lista");
    lista.setAttribute("role", "group");
    lista.setAttribute("aria-label", "Contas de cliente da base local");
    lista.tabIndex = 0;   // a caixa desliza com o teclado
    f.append(el("span", "ar-rotulo", "Entrar como (testes, só neste computador) — contas de cliente desta base:"), lista, mensagem());
    loginCliente.append(f);
    contasDaBase().then((contas) => {
      if (!contas.length) lista.append(el("span", "ar-nota", "Ainda sem contas de cliente nesta base: use \"Cliente de teste\" na barra em baixo ou crie uma em \"A minha conta\"."));
      for (const c of contas) {
        const b = el("button", "ar-botao ar-conta");
        b.type = "button";
        b.append(el("span", null, c.nome ? `${c.nome} · ${c.email}` : c.email), el("small", null, c.tem_casa ? "entra na casa desta conta" : "sem casa ligada: abre a pré-visualização"));
        b.addEventListener("click", () => entrarNaConta(c));
        lista.append(b);
        if (!c.tem_casa) {
          const t = el("button", "ar-botao ar-conta ar-casa-teste", "↳ casa de teste (com aparelhos)");
          t.type = "button";
          t.setAttribute("aria-label", `Casa de teste (com aparelhos) de ${c.email}`);
          t.addEventListener("click", () => casaDeTeste(c));
          lista.append(t);
        }
      }
    }).catch((e) => avisar(e?.message || "Não foi possível ler as contas."));
  }
})();
