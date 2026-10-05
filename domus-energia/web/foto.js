// Tirar foto com o telemóvel (docs/SIMULADOR-ORCAMENTO.md §0 "Fotos pelo telemóvel (QR)" e §6.2): o QR do simulador
// (computador) abre esta página com o token e a chave da foto no fragmento (#t=…&k=…: nunca vão ao servidor no
// endereço). Mostra o que é a foto ("Foto do quadro elétrico"), abre a câmara, reduz a foto como o simulador
// (fotos.js reduzirFoto) e envia-a para POST /api/fotos-remotas/<chave> com o cabeçalho X-Foto-Token; o computador
// vai buscá-la sozinho. Depois oferece as outras fotos que o computador pediu.

import { reduzirFoto, ErroFoto } from "./simulador/fotos.js";
import { urlPainelApi, credenciais } from "./conta-comum.js";

const $ = (id) => document.getElementById(id);
$("ano").textContent = String(new Date().getFullYear());

const params = new URLSearchParams(location.hash.replace(/^#/, ""));
// Outro QR lido para esta mesma página (o token e a chave vêm no fragmento): recomeça com os novos.
window.addEventListener("hashchange", () => location.reload());
const token = params.get("t") ?? "";
let chave = params.get("k") ?? "";
let chaves = [];        // [{chave, rotulo, recebida, pronta}] do servidor
let preparada = null;   // {blob, miniatura} pronta a enviar

const cab = { Accept: "application/json", "X-Foto-Token": token };
const MSG_INVALIDO = "Esta ligação já não é válida. No computador, carregue outra vez em «Tirar foto» para obter um código novo.";

function msg(texto, tipo = "info") {
  const m = $("foto-msg");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}
const rotuloDe = (k) => chaves.find((c) => c.chave === k)?.rotulo || (k === "quadro" ? "Foto do quadro elétrico" : "Foto");

function mostrar(fase) {
  $("foto-tirar").hidden = fase !== "tirar";
  $("foto-rever").hidden = fase !== "rever";
  $("foto-camara").disabled = $("foto-galeria").disabled = fase === "fim";
}

/** Sem câmara nem foto: a página fica só com a mensagem. */
function terminar(texto) {
  $("foto-rotulo").textContent = "";   // o h1 já diz "Foto para o simulador"
  mostrar("fim");
  $("foto-seguintes-caixa").hidden = true;
  msg(texto, "erro");
}

function desenharSeguintes() {
  const outras = chaves.filter((c) => c.chave !== chave);
  $("foto-seguintes-caixa").hidden = !outras.length;
  const ul = $("foto-seguintes");
  ul.replaceChildren();
  for (const c of outras) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn sec pequeno${c.recebida ? " enviada" : ""}`;
    b.textContent = c.recebida ? `${c.rotulo || c.chave} — enviada (tirar outra)` : `${c.rotulo || c.chave}`;
    b.addEventListener("click", () => { chave = c.chave; preparar(); });
    li.append(b);
    ul.append(li);
  }
}

/** Prepara a página para a chave atual. */
function preparar() {
  const atual = chaves.find((c) => c.chave === chave);
  if (!atual) {
    const pendente = chaves.find((c) => !c.recebida) ?? chaves[0];
    if (!pendente) { terminar("O computador não está à espera de nenhuma foto. Volte ao computador e carregue em «Tirar foto»."); return; }
    chave = pendente.chave;
  }
  $("foto-rotulo").textContent = rotuloDe(chave);
  document.title = `${rotuloDe(chave)} | Domus Energia`;
  limparPrevia();
  mostrar("tirar");
  const c = chaves.find((x) => x.chave === chave);
  msg(c?.recebida ? "Esta foto já foi enviada. Pode tirar outra para a substituir." : null);
  desenharSeguintes();
  $("foto-camara-botao").focus();
}

function limparPrevia() {
  preparada = null;
  $("foto-previa").removeAttribute("src");
}

async function escolhida(f) {
  if (!f) return;
  msg("A preparar a foto…");
  try {
    const r = await reduzirFoto(f);
    preparada = r;
    // A CSP do site não deixa blob: nas imagens: a miniatura (data: URL) serve de pré-visualização.
    $("foto-previa").src = r.miniatura;
    mostrar("rever");
    msg(null);
    $("foto-enviar").focus();
  } catch (e) {
    msg(e instanceof ErroFoto ? e.message : "Não foi possível usar esta foto. Experimente outra.", "erro");
  } finally {
    $("foto-camara").value = "";
    $("foto-galeria").value = "";
  }
}

async function enviar() {
  if (!preparada) return;
  const b = $("foto-enviar");
  b.disabled = true;
  b.textContent = "A enviar…";
  msg("A enviar a foto…");
  try {
    const r = await fetch(`${urlPainelApi}/fotos-remotas/${encodeURIComponent(chave)}`, {
      method: "POST", credentials: credenciais,
      headers: { ...cab, "Content-Type": preparada.blob.type === "image/png" ? "image/png" : "image/jpeg" },
      body: preparada.blob,
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401) { terminar(MSG_INVALIDO); return; }
    if (!r.ok) { msg(j?.erro || "Não foi possível enviar a foto. Tente de novo.", "erro"); return; }
    if (Array.isArray(j?.chaves)) chaves = j.chaves;
    limparPrevia();
    mostrar("tirar");
    const porEnviar = chaves.filter((c) => !c.recebida);
    msg(`Foto enviada. Pode tirar outra ou voltar ao computador.${porEnviar.length ? ` Falta${porEnviar.length > 1 ? "m" : ""}: ${porEnviar.map((c) => c.rotulo || c.chave).join(", ")}.` : ""}`, "ok");
    desenharSeguintes();
    $("foto-camara-botao").focus();
  } catch {
    msg("Sem ligação. Verifique a rede e tente de novo.", "erro");
  } finally {
    b.disabled = false;
    b.textContent = "Enviar";
  }
}

$("foto-camara").addEventListener("change", (e) => escolhida(e.target.files?.[0]));
$("foto-galeria").addEventListener("change", (e) => escolhida(e.target.files?.[0]));
$("foto-enviar").addEventListener("click", enviar);
$("foto-outra").addEventListener("click", () => { limparPrevia(); mostrar("tirar"); msg(null); $("foto-camara-botao").focus(); });

(async () => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { terminar(MSG_INVALIDO); return; }
  try {
    const r = await fetch(`${urlPainelApi}/fotos-remotas`, { credentials: credenciais, headers: cab });
    if (r.status === 401) { terminar(MSG_INVALIDO); return; }
    const j = r.ok ? await r.json() : null;
    if (!j) { terminar("Não foi possível ligar ao servidor. Tente de novo."); return; }
    chaves = j.chaves ?? [];
    preparar();
  } catch {
    terminar("Sem ligação. Verifique a rede e volte a ler o código.");
  }
})();
