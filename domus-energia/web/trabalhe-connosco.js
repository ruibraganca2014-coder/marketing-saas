// Candidatura de eletricistas externos ("Trabalhe connosco"; docs/ELETRICISTAS.md): POST /api/eletricista/candidatura
// (JSON, com o documento do seguro em base64). O servidor volta a validar tudo: aqui só se evita o envio em vão.
// Os concelhos são os da tabela do simulador, só os da área servida (até `deslocacao_max_km` da base, pelo /api/catalogo;
// sem resposta, os valores por omissão: 100 km de Lisboa).
import { CONCELHOS } from "./simulador/concelhos.js";
import { chave, procurarConcelho, distanciaEstrada, configDeslocacao } from "./simulador/deslocacao.js";

const cfg = window.DOMUS ?? {};
const base = String(cfg.apiBase ?? "").trim().replace(/\/+$/, "");
const api = base ? `${base}/api` : String(cfg.apiUrl ?? "/api").replace(/\/+$/, "");
const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS = ["application/pdf", "image/jpeg", "image/png"];
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = document.getElementById("form-candidatura");
const msg = document.getElementById("cand-msg");
const fichas = document.getElementById("cand-fichas");
const procurar = document.getElementById("cand-procurar");
const conta = document.getElementById("cand-concelhos-conta");
const escolhidos = new Set();
let disponiveis = [];

function mensagem(texto, tipo = "erro") {
  msg.textContent = texto ?? "";
  msg.className = `msg ${tipo}`;
  msg.hidden = !texto;
}
function invalido(campo, texto) {
  mensagem(texto);
  campo.setAttribute("aria-invalid", "true");
  campo.focus();
  return false;
}

/** NIF português: 9 algarismos com o dígito de controlo certo (o servidor verifica outra vez). */
function nifValido(v) {
  if (!/^[1-9]\d{8}$/.test(v)) return false;
  const soma = [...v.slice(0, 8)].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const resto = 11 - (soma % 11);
  return (resto >= 10 ? 0 : resto) === Number(v[8]);
}

// ---------------------------------------------------------------- concelhos
function desenharConcelhos() {
  const k = chave(procurar.value);
  // Os escolhidos ficam sempre à vista, primeiro; depois os que batem com a procura.
  const visiveis = [...disponiveis.filter((nome) => escolhidos.has(nome)), ...disponiveis.filter((nome) => !escolhidos.has(nome) && (!k || chave(nome).includes(k)))];
  fichas.replaceChildren(...visiveis.map((nome) => {
    const l = document.createElement("label");
    l.className = "ficha";
    const i = document.createElement("input");
    i.type = "checkbox";
    i.name = "concelho";
    i.value = nome;
    i.checked = escolhidos.has(nome);
    i.addEventListener("change", () => {
      if (i.checked) escolhidos.add(nome); else escolhidos.delete(nome);
      contar();
    });
    const s = document.createElement("span");
    s.textContent = nome;
    l.append(i, s);
    return l;
  }));
  if (!visiveis.length) {
    const p = document.createElement("p");
    p.className = "ajuda";
    p.textContent = "Nenhum concelho com esse nome na área servida.";
    fichas.append(p);
  }
}
function contar() {
  const n = escolhidos.size;
  conta.textContent = n ? `${n} ${n === 1 ? "concelho escolhido" : "concelhos escolhidos"}. Só vê trabalhos destes concelhos.` : "Só vê trabalhos destes concelhos.";
}
async function carregarConcelhos() {
  let config = null;
  try {
    const r = await fetch(`${api}/catalogo`, { headers: { Accept: "application/json" } });
    if (r.ok) config = (await r.json())?.config ?? null;
  } catch { /* sem ligação: valores por omissão */ }
  const d = configDeslocacao(config);
  const origem = procurarConcelho(d.deslocacao_base);
  disponiveis = CONCELHOS.map(([nome, , ilha, lat, lon]) => ({ nome, ilha, lat, lon }))
    .filter((c) => { const km = origem ? distanciaEstrada(origem, c) : null; return km !== null && km <= d.deslocacao_max_km; })
    .map((c) => c.nome).sort((a, b) => a.localeCompare(b, "pt"));
  if (!disponiveis.length) disponiveis = CONCELHOS.map((c) => c[0]);
  desenharConcelhos();
}
procurar.addEventListener("input", desenharConcelhos);
procurar.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

// ---------------------------------------------------------------- documento do seguro
const campoSeguro = document.getElementById("cand-seguro");
const dicaSeguro = document.getElementById("cand-seguro-dica");
const DICA = dicaSeguro.textContent;
function problemaSeguro(f) {
  if (!f) return "Junte o documento do seguro de responsabilidade civil (PDF, JPG ou PNG).";
  if (!TIPOS.includes(f.type)) return "O documento do seguro tem de ser PDF, JPG ou PNG.";
  if (f.size > MAX_BYTES) return "O documento do seguro é demasiado grande (máx. 5 MB).";
  if (!f.size) return "O documento do seguro está vazio.";
  return null;
}
campoSeguro.addEventListener("change", () => {
  const f = campoSeguro.files[0];
  const p = f ? problemaSeguro(f) : null;
  dicaSeguro.textContent = p ?? (f ? `Ficheiro: ${f.name} (${(f.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB)` : DICA);
  campoSeguro.toggleAttribute("aria-invalid", Boolean(p));
});
/** O ficheiro em base64 (sem o prefixo "data:…;base64,"). */
function emBase64(f) {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => erro(new Error("Não foi possível ler o ficheiro."));
    r.readAsDataURL(f);
  });
}

// ---------------------------------------------------------------- enviar
form.addEventListener("input", (e) => { e.target.removeAttribute?.("aria-invalid"); mensagem(null); });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = form.elements;
  const botao = document.getElementById("cand-enviar");
  if (botao.disabled) return;
  mensagem(null);
  const nome = el.nome.value.trim();
  const telefone = el.telefone.value.trim();
  const email = el.email.value.trim();
  const nif = el.nif.value.replace(/[\s.]/g, "");
  const dgeg = el.dgeg.value.trim();
  if (nome.length < 3) return invalido(el.nome, "Escreva o seu nome.");
  if (telefone.replace(/\D/g, "").length < 9) return invalido(el.telefone, "Escreva o telemóvel (9 algarismos).");
  if (!RE_EMAIL.test(email)) return invalido(el.email, "O email não parece certo (ex.: nome@exemplo.pt).");
  if (!nifValido(nif)) return invalido(el.nif, "O NIF não parece certo (9 algarismos).");
  if (dgeg.length < 2) return invalido(el.dgeg, "Escreva o n.º de habilitação na DGEG.");
  if (!escolhidos.size) return invalido(procurar, "Escolha pelo menos um concelho onde trabalha.");
  const f = campoSeguro.files[0];
  const p = problemaSeguro(f);
  if (p) return invalido(campoSeguro, p);
  if (!el.consentimento.checked) return invalido(el.consentimento, "Para enviar a candidatura tem de aceitar a Política de Privacidade.");
  botao.disabled = true;
  botao.textContent = "A enviar…";
  try {
    const corpo = {
      nome, telefone, email, nif, dgeg, concelhos: [...escolhidos], notas: el.notas.value.trim(), consentimento: true,
      seguro: { tipo: f.type, dados: await emBase64(f) }, website: el.website.value,
    };
    if (el.experiencia.value) corpo.experiencia = el.experiencia.value;
    let r;
    try {
      r = await fetch(`${api}/eletricista/candidatura`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corpo) });
    } catch {
      throw new Error("Sem ligação ao servidor. Verifique a internet e tente de novo.");
    }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) throw new Error(typeof j?.erro === "string" ? j.erro : r.status === 413 ? "O documento do seguro é demasiado grande (máx. 5 MB)." : `Não foi possível enviar (erro ${r.status}). Tente de novo.`);
    form.hidden = true;
    const enviada = document.getElementById("cand-enviada");
    document.getElementById("cand-enviada-texto").textContent = `Obrigado, ${nome}. Respondemos por email em poucos dias úteis.`;
    enviada.hidden = false;
    enviada.focus();
    enviada.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } catch (erro) {
    mensagem(erro?.message || "Não foi possível enviar. Tente de novo.");
    botao.disabled = false;
    botao.textContent = "Enviar candidatura";
  }
});

// O módulo pode estar desligado no servidor (ELETRICISTAS; docs/ELETRICISTAS.md): aí a API responde 404 e fica só a
// linha "Candidaturas ainda não estão abertas.", sem formulário. Sem ligação mostra-se o formulário (o envio avisa).
(async () => {
  let estado = 0;
  let pct = null;
  try {
    const r = await fetch(`${api}/eletricista/candidatura`, { headers: { Accept: "application/json" } });
    estado = r.status;
    if (r.ok) pct = Number((await r.json())?.percentagem);
  } catch { estado = 0; }
  if (estado === 404) { document.getElementById("cand-fechada").hidden = false; return; }
  // A percentagem em vigor (configuração do painel); sem resposta fica a escrita na página (70).
  if (Number.isFinite(pct) && pct >= 0 && pct <= 100) for (const s of document.querySelectorAll("[data-pct]")) s.textContent = String(pct).replace(".", ",");
  document.getElementById("cand-aberta").hidden = false;
  carregarConcelhos();
})();
