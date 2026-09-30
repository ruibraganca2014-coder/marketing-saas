// Página de pagamento SIMULADO (docs/PAGAMENTOS-PEDIDO.md): faz o papel do Stripe Checkout quando o servidor está
// em PAGAMENTOS_MODO=simulado. Mostra o valor e a descrição que o SERVIDOR calculou (nada vem do endereço além da
// referência) e envia o resultado escolhido para POST /api/conta/pagamentos/:ref/simular; volta ao simulador ou à
// conta pelo endereço que o servidor devolve (o mesmo caminho do regresso do Stripe). No modo stripe o servidor
// responde 404 e a página não deixa pagar.
import { pedirConta, ErroConta } from "./conta-comum.js";

const $ = (id) => document.getElementById(id);
const euro = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", useGrouping: "always" }).format(v);   // "1 120,00 €"
const ref = new URLSearchParams(location.search).get("ref") ?? "";
const RE_REF = /^pp_[A-Za-z0-9_-]{22}$/;
const botoes = ["pag-sucesso", "pag-falha", "pag-cancelar"].map($);

function mensagem(texto, tipo = "erro") {
  const m = $("pag-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}

/** Só caminhos do próprio site devolvidos pelo servidor ("simulador.html?…" ou "conta.html?…"). */
const destinoSeguro = (v) => (typeof v === "string" && /^(simulador|conta)\.html\?pagamento=pp_[A-Za-z0-9_-]{22}$/.test(v) ? v : "conta.html");

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
  if (p.modo !== "simulado") { mensagem("Este pagamento não é simulado."); return; }
  $("pag-valor").textContent = euro(p.valor);
  $("pag-descricao").textContent = p.descricao;
  $("pag-ref").textContent = `Referência: ${p.ref}${p.base != null ? ` · ${euro(p.base)} + IVA ${String(p.iva_pct).replace(".", ",")} % (${euro(p.iva)})` : ""}`;
  $("pag-dados").hidden = false;
  if (p.estado !== "pendente") {
    for (const b of botoes) b.disabled = true;
    mensagem(p.estado === "pago" ? "Este pagamento já está pago." : `Este pagamento já não está por pagar (${p.estado_texto.toLowerCase()}). Volte atrás e tente de novo.`, p.estado === "pago" ? "ok" : "erro");
    ligacoesVoltar(p);
    return;
  }
  $("pag-sucesso").focus();
}

/**
 * Já pago, cancelado, falhado ou expirado: "Voltar ao simulador" (avaria: volta ao passo Enviar, que confirma o estado)
 * e "Voltar à conta" (onde se veem os pedidos e os recibos).
 */
function ligacoesVoltar(p) {
  document.getElementById("pag-voltar")?.remove();
  const caixa = document.createElement("div");
  caixa.id = "pag-voltar";
  caixa.className = "form-botoes";
  const ligacao = (texto, href, sec) => {
    const a = document.createElement("a");
    a.className = sec ? "btn sec" : "btn";
    a.textContent = texto;
    a.href = href;
    return a;
  };
  const q = `?pagamento=${encodeURIComponent(p.ref)}`;
  if (p.fase === "relatorio") caixa.append(ligacao("Voltar ao simulador", `simulador.html${q}`, false), ligacao("Voltar à conta", "conta.html", true));
  else caixa.append(ligacao("Voltar à conta", `conta.html${q}`, false), ligacao("Voltar ao simulador", "simulador.html", true));
  $("pag-msg").after(caixa);
  caixa.firstChild.focus();
}

async function simular(resultado) {
  for (const b of botoes) b.disabled = true;
  mensagem("A processar…", "info");
  try {
    const r = await pedirConta(`pagamentos/${ref}/simular`, { corpo: { resultado } });
    location.assign(destinoSeguro(r.voltar));
  } catch (e) {
    for (const b of botoes) b.disabled = false;
    if (e instanceof ErroConta && e.estado === 409) { await carregar(); mensagem(e.message); return; }   // mudou noutro separador
    mensagem(e.message);
  }
}

$("pag-sucesso").addEventListener("click", () => simular("sucesso"));
$("pag-falha").addEventListener("click", () => simular("falha"));
$("pag-cancelar").addEventListener("click", () => simular("cancelar"));
$("ano").textContent = String(new Date().getFullYear());
carregar();
