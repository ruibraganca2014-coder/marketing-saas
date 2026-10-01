// Fotos pelo telemóvel (QR; docs/SIMULADOR-ORCAMENTO.md §0 "Fotos pelo telemóvel (QR)" e §6.2). Num computador, os
// botões "Tirar foto" do simulador abrem esta janela: um QR que o telemóvel lê para abrir foto.html, tirar a foto e
// enviá-la ao painel (/api/fotos-remotas); o computador vai lá buscá-la (sondagem de 3 em 3 s, 15 s com a página em
// segundo plano, pára ao fim de 10 min sem nada) e guarda-a como se fosse local. "Ou escolher um ficheiro" faz o de
// sempre. Um token por simulação (24 h, reutilizado enquanto vale); vai só no fragmento do endereço (#t=…) e no
// cabeçalho X-Foto-Token — nunca em registos do servidor. Num telemóvel a janela não aparece: a câmara abre logo.

import { svgQR } from "./qr.js";

const SONDAGEM_MS = 3000;
const SONDAGEM_FUNDO_MS = 15_000;
const INATIVIDADE_MS = 10 * 60_000;

/** É um telemóvel (ou tablet) com câmara? Aí o botão abre a câmara diretamente, sem QR. */
export function ehTelemovel() {
  const uad = navigator.userAgentData;
  if (uad && typeof uad.mobile === "boolean") return uad.mobile;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  const toque = navigator.maxTouchPoints > 1 || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const estreito = Math.min(screen.width || 0, screen.height || 0) <= 900;
  const captura = "capture" in document.createElement("input");
  return toque && estreito && captura;
}

const tokens = new Map();   // sim → {token, expira, seq (última foto já recebida aqui)}

/**
 * Pede (ou reutiliza) o token da simulação `sim` e regista a chave `chave` com o rótulo `rotulo`.
 * Devolve {token, expira}. Lança Error com a mensagem para a pessoa.
 */
async function pedirToken({ sim, chave, rotulo, urlApi, credenciais }) {
  const atual = tokens.get(sim);
  const valido = atual && atual.expira - Date.now() > 60_000 ? atual : null;
  const r = await fetch(`${urlApi}/fotos-remotas`, {
    method: "POST",
    credentials: credenciais,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(valido ? { "X-Foto-Token": valido.token } : {}) },
    body: JSON.stringify({ sim, chave, rotulo }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.erro || "Não foi possível preparar o código. Escolha um ficheiro ou tente de novo.");
  const t = j.token ? { token: j.token, expira: j.expira, seq: 0 } : { ...valido, expira: j.expira };
  tokens.set(sim, t);
  return t;
}

let janela = null;
let sessao = null;   // a sondagem em curso: {parar()}

function montar() {
  const d = document.createElement("dialog");
  d.className = "editor-dialogo foto-remota";
  d.id = "foto-remota-janela";
  d.setAttribute("aria-labelledby", "foto-remota-titulo");
  d.setAttribute("aria-describedby", "foto-remota-rotulo");
  d.innerHTML = `
    <div class="editor-dialogo-form">
      <h2 id="foto-remota-titulo">Tirar foto com o telemóvel</h2>
      <p class="foto-remota-rotulo" id="foto-remota-rotulo"></p>
      <div class="foto-remota-corpo">
        <div class="foto-remota-qr" id="foto-remota-qr" aria-busy="true"></div>
        <div class="foto-remota-texto">
          <p>Leia este código com a câmara do telemóvel para tirar a foto. Ela aparece aqui sozinha.</p>
          <p class="msg info" id="foto-remota-estado" role="status" aria-live="polite"></p>
        </div>
      </div>
      <div class="form-botoes">
        <button class="btn sec" type="button" id="foto-remota-ficheiro">Ou escolher um ficheiro</button>
        <button class="btn sec" type="button" id="foto-remota-fechar">Cancelar</button>
      </div>
    </div>`;
  d.addEventListener("close", () => {
    sessao?.parar();
    sessao = null;
    const volta = d.dataset.ficheiro ? null : janela.volta;
    janela.volta = null;
    if (volta && document.contains(volta)) volta.focus();
  });
  d.querySelector("#foto-remota-fechar").addEventListener("click", () => d.close());
  document.body.append(d);
  return d;
}

function estado(texto, tipo = "info") {
  const m = janela.querySelector("#foto-remota-estado");
  m.textContent = texto ?? "";
  m.className = `msg ${tipo}`;
  m.hidden = !texto;
}

/**
 * Abre a janela do QR para a foto `chave` (rótulo `rotulo`) da simulação `sim()` (função: cria o fotosId se preciso).
 * `aoFicheiro()`: a pessoa prefere escolher um ficheiro (a janela já fechou). `aoFoto(chave, blob)` por cada foto
 * recebida (a pedida fecha a janela; outras chaves da mesma simulação também chegam, se o telemóvel as enviou).
 */
export function abrirFotoRemota({ chave, rotulo, sim, urlApi, credenciais, aoFicheiro, aoFoto }) {
  janela ??= montar();
  const d = janela;
  sessao?.parar();
  janela.volta = document.activeElement;
  delete d.dataset.ficheiro;
  d.querySelector("#foto-remota-rotulo").textContent = rotulo;
  const qr = d.querySelector("#foto-remota-qr");
  qr.replaceChildren();
  qr.setAttribute("aria-busy", "true");
  estado("A preparar o código…");
  const bf = d.querySelector("#foto-remota-ficheiro");
  bf.onclick = () => { d.dataset.ficheiro = "1"; d.close(); aoFicheiro(); };
  d.showModal();
  bf.focus();

  let parado = false;
  let temporizador = null;
  let ultimaAtividade = Date.now();
  const parar = () => { parado = true; clearTimeout(temporizador); document.removeEventListener("visibilitychange", acordar); };
  sessao = { parar };
  const idSim = sim();
  let t = null;

  async function sondar() {
    if (parado) return;
    if (Date.now() - ultimaAtividade > INATIVIDADE_MS) {
      estado("O código deixou de ser verificado. Feche e carregue outra vez em «Tirar foto» para obter um código novo.", "erro");
      parar();
      return;
    }
    try {
      const r = await fetch(`${urlApi}/fotos-remotas?desde=${t.seq}`, { credentials: credenciais, headers: { Accept: "application/json", "X-Foto-Token": t.token } });
      if (r.status === 401) { estado("Este código já não é válido. Feche e carregue outra vez em «Tirar foto».", "erro"); tokens.delete(idSim); parar(); return; }
      const j = r.ok ? await r.json() : null;
      for (const c of j?.chaves ?? []) {
        if (!c.pronta || parado) continue;
        const f = await fetch(`${urlApi}/fotos-remotas/${encodeURIComponent(c.chave)}`, { credentials: credenciais, headers: { "X-Foto-Token": t.token } });
        if (!f.ok) continue;
        const blob = await f.blob();
        t.seq = Math.max(t.seq, c.seq);
        ultimaAtividade = Date.now();
        // O computador já a tem: os bytes saem do servidor (sem esperar).
        fetch(`${urlApi}/fotos-remotas/${encodeURIComponent(c.chave)}/apagar`, { method: "POST", credentials: credenciais, headers: { "Content-Type": "application/json", "X-Foto-Token": t.token }, body: "{}" }).catch(() => {});
        if (c.chave === chave) {
          estado("Foto recebida.", "ok");
          parar();
          sessao = null;
          setTimeout(() => { if (d.open && !sessao) d.close(); }, 700);
          aoFoto(c.chave, blob);
          return;
        }
        aoFoto(c.chave, blob);
        estado(`Foto recebida (${c.rotulo || c.chave}). Continua à espera da ${rotulo.toLowerCase()}.`);
      }
    } catch { /* sem rede: tenta outra vez */ }
    if (!parado) temporizador = setTimeout(sondar, document.visibilityState === "hidden" ? SONDAGEM_FUNDO_MS : SONDAGEM_MS);
  }
  function acordar() {
    if (parado || document.visibilityState !== "visible") return;
    clearTimeout(temporizador);
    temporizador = setTimeout(sondar, 200);
  }

  (async () => {
    try {
      t = await pedirToken({ sim: idSim, chave, rotulo, urlApi, credenciais });
    } catch (e) {
      if (!parado) { qr.removeAttribute("aria-busy"); estado(e.message, "erro"); }
      return;
    }
    if (parado) return;
    // Em localhost o telemóvel não chega ao computador: o lançador local põe em config.js o endereço na rede Wi-Fi.
    const origemQr = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && window.DOMUS?.fotosBase ? window.DOMUS.fotosBase : location.origin;
    const base = `${origemQr}${location.pathname.replace(/[^/]*$/, "")}`;
    const url = `${base}foto.html#t=${t.token}&k=${encodeURIComponent(chave)}`;
    try {
      qr.replaceChildren(svgQR(url, { rotulo: `Código QR para abrir ${rotulo} no telemóvel`, tamanho: 200 }));
    } catch {
      estado("Não foi possível gerar o código. Escolha um ficheiro.", "erro");
      qr.removeAttribute("aria-busy");
      return;
    }
    qr.removeAttribute("aria-busy");
    estado("À espera da foto do telemóvel…");
    document.addEventListener("visibilitychange", acordar);
    temporizador = setTimeout(sondar, SONDAGEM_MS);
  })();

  return { fechar: () => d.close() };
}
