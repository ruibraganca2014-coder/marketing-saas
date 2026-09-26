import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.DOMUS;
const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const $ = (id) => document.getElementById(id);
let devices = [];
let pollTimer = null;

// ---------- Sessão ----------
supabase.auth.onAuthStateChange((_event, session) => mostrarVista(session));
mostrarVista((await supabase.auth.getSession()).data.session);

function mostrarVista(session) {
  const autenticado = !!session;
  $("vista-login").hidden = autenticado;
  $("vista-painel").hidden = !autenticado;
  $("sair").hidden = !autenticado;
  clearInterval(pollTimer);
  if (autenticado) {
    $("utilizador").textContent = session.user.email;
    carregar();
    pollTimer = setInterval(() => carregar(true), 10_000);
  }
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(e.target));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  $("login-erro").hidden = !error;
  if (error) $("login-erro").textContent = "Email ou palavra-passe errados.";
});

$("sair").addEventListener("click", () => supabase.auth.signOut());
$("atualizar").addEventListener("click", () => carregar());

// ---------- Aparelhos ----------
async function chamar(payload) {
  const { data, error } = await supabase.functions.invoke("tuya", { body: payload });
  if (error) {
    let mensagem = error.message;
    try { mensagem = (await error.context.json()).error ?? mensagem; } catch {}
    throw new Error(mensagem);
  }
  return data;
}

async function carregar(silencioso = false) {
  if (!silencioso) $("lista").innerHTML = "<p>A carregar…</p>";
  try {
    devices = (await chamar({ action: "list" })).devices.map(normalizar);
    mostrarErro(null);
    desenhar();
  } catch (e) {
    mostrarErro(e.message);
    if (!silencioso) $("lista").innerHTML = "";
  }
}

// Converte o "status" da Tuya num formato fácil de usar (escalas padrão).
function normalizar(d) {
  const status = Object.fromEntries((d.status ?? []).map((s) => [s.code, s.value]));
  const switchCode = Object.keys(status).sort().find((c) => c.startsWith("switch") && typeof status[c] === "boolean");
  return {
    ...d,
    status,
    switchCode,
    ligado: switchCode ? status[switchCode] : false,
    potencia: typeof status.cur_power === "number" ? status.cur_power / 10 : null,
    tensao: typeof status.cur_voltage === "number" ? status.cur_voltage / 10 : null,
    corrente: typeof status.cur_current === "number" ? status.cur_current / 1000 : null,
  };
}

function desenhar() {
  const lista = $("lista");
  lista.innerHTML = "";

  if (devices.length === 0) {
    lista.innerHTML = '<div class="cartao">Ainda não tem aparelhos associados. Contacte a Domus Energia.</div>';
  }

  for (const d of devices) {
    const detalhes = [
      d.online ? "Online" : "Offline",
      d.potencia != null && `${d.potencia.toFixed(1)} W`,
      d.tensao != null && `${d.tensao.toFixed(0)} V`,
      d.corrente != null && `${d.corrente.toFixed(2)} A`,
    ].filter(Boolean).join(" · ");

    const el = document.createElement("div");
    el.className = "cartao aparelho";
    el.innerHTML = `
      <span class="estado ${d.online ? "online" : ""}"></span>
      <div class="info"><b></b><small></small></div>
      ${d.switchCode ? `<label class="interruptor"><input type="checkbox"><span></span></label>` : ""}
    `;
    el.querySelector("b").textContent = d.name;
    el.querySelector("small").textContent = detalhes;

    const input = el.querySelector("input");
    if (input) {
      input.checked = d.ligado;
      input.disabled = !d.online;
      input.setAttribute("aria-label", `Ligar ou desligar ${d.name}`);
      input.addEventListener("change", () => alternar(d, input));
    }
    lista.appendChild(el);
  }

  const ligados = devices.filter((d) => d.ligado).length;
  const online = devices.filter((d) => d.online).length;
  const potencia = devices.reduce((soma, d) => soma + (d.potencia ?? 0), 0);
  $("total-potencia").textContent = `${potencia.toFixed(0)} W`;
  $("total-ligados").textContent = `${ligados} / ${devices.length}`;
  $("total-online").textContent = `${online} / ${devices.length}`;
}

async function alternar(d, input) {
  const novo = input.checked;
  input.disabled = true;
  try {
    await chamar({ action: "command", device_id: d.id, code: d.switchCode, value: novo });
    d.ligado = novo;
    mostrarErro(null);
  } catch (e) {
    input.checked = !novo;
    mostrarErro(e.message);
  } finally {
    input.disabled = !d.online;
  }
}

function mostrarErro(texto) {
  $("painel-erro").hidden = !texto;
  $("painel-erro").textContent = texto ?? "";
}
