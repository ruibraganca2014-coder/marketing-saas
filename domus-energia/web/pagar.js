// Página de pagamento dos pedidos pela Airwallex (docs/PAGAMENTOS-PEDIDO.md; decisão do dono, 2026-11-08). O servidor
// já criou o PaymentIntent: daqui só se lê, para a conta da sessão, o que ele devolveu (valor, descrição, intent_id,
// client_secret, métodos, endereços de regresso) e se leva o cliente à página de pagamento da Airwallex com o SDK deles
// (static.airwallex.com — a única página do site que o carrega; o Caddy dá-lhe uma CSP própria). Nada vem do endereço
// além da referência. O regresso (pago ou desistiu) é à conta ou ao simulador, onde o servidor confirma o estado.
import { pedirConta, ErroConta } from "./conta-comum.js";

const SDK = "https://static.airwallex.com/components/sdk/v1/index.js";
const $ = (id) => document.getElementById(id);
const euro = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" }).format(v);   // "1 120,00 €"
const ref = new URLSearchParams(location.search).get("ref") ?? "";
const RE_REF = /^pp_[A-Za-z0-9_-]{22}$/;

function mensagem(texto, tipo = "erro") {
  const m = $("pag-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}

/** Só endereços https devolvidos pelo servidor para o próprio site (conta.html ou simulador.html desta referência). */
const regressoSeguro = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && /^\/(conta|simulador)\.html$/.test(u.pathname) && u.searchParams.get("pagamento") === ref ? u.href : null;
  } catch { return null; }
};

function carregarSdk() {
  if (window.AirwallexComponentsSDK) return Promise.resolve(window.AirwallexComponentsSDK);
  return new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => (window.AirwallexComponentsSDK ? ok(window.AirwallexComponentsSDK) : falha(new Error("sdk")));
    s.onerror = () => falha(new Error("sdk"));
    document.head.append(s);
  });
}

async function carregar() {
  if (!RE_REF.test(ref)) { $("pag-carregar").hidden = true; mensagem("Endereço de pagamento inválido."); return; }
  let r;
  try { r = await pedirConta(`pagamentos/${ref}`); } catch (e) {
    $("pag-carregar").hidden = true;
    mensagem(e instanceof ErroConta && e.estado === 401 ? "A sua sessão terminou. Entre na sua conta e tente de novo." : e.message);
    return;
  }
  const p = r.pagamento;
  $("pag-carregar").hidden = true;
  $("pag-valor").textContent = euro(p.valor);
  $("pag-descricao").textContent = p.descricao;
  $("pag-ref").textContent = `Referência: ${p.ref}${p.base != null ? ` · ${euro(p.base)} + IVA ${String(p.iva_pct).replace(".", ",")} % (${euro(p.iva)})` : ""}`;
  $("pag-desistir").href = p.fase === "avaria" || p.fase === "relatorio" ? "simulador.html" : "conta.html";
  $("pag-dados").hidden = false;
  if (p.estado !== "pendente") {
    mensagem(p.estado === "pago" ? "Este pagamento já está pago." : `Este pagamento já não está por pagar (${p.estado_texto.toLowerCase()}). Volte atrás e tente de novo.`, p.estado === "pago" ? "ok" : "erro");
    return;
  }
  const a = p.airwallex;
  const sucesso = a && regressoSeguro(a.sucesso);
  const cancelar = a && regressoSeguro(a.cancelar);
  if (!a || !sucesso || !cancelar) { mensagem("Este pagamento não se pode fazer aqui. Volte atrás e tente de novo."); return; }
  if (Array.isArray(p.metodos) && p.metodos.length) {
    $("pag-metodos").textContent = `Pode pagar com: ${p.metodos.join(" ou ")}.`;
    $("pag-metodos").hidden = false;
  }
  const ir = $("pag-ir");
  ir.disabled = false;
  ir.focus();
  ir.addEventListener("click", async () => {
    ir.disabled = true;
    mensagem("A abrir a página de pagamento…", "info");
    try {
      const sdk = await carregarSdk();
      const { payments } = await sdk.init({ env: a.ambiente, enabledElements: ["payments"] });
      payments.redirectToCheckout({
        env: a.ambiente, mode: "payment", currency: a.moeda, intent_id: a.intent_id, client_secret: a.client_secret,
        successUrl: sucesso, cancelUrl: cancelar, locale: "pt", country_code: "PT",
        // Até ao limite do cartão o servidor manda a lista (só cartão); acima, nenhuma: aparecem os métodos da conta (MB WAY).
        ...(Array.isArray(a.metodos) && a.metodos.length ? { methods: a.metodos } : {}),
      });
    } catch {
      ir.disabled = false;
      mensagem("Não foi possível abrir a página de pagamento. Verifique a ligação e tente de novo.");
    }
  });
}

$("ano").textContent = String(new Date().getFullYear());
carregar();
