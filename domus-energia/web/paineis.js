// Vistas da v3 que só desenham a partir do estado: saúde dos aparelhos (§5),
// relatório da casa (§9) e o formulário de definições (§1, `_config/set`).
import * as E from "./estado.js";
import { el, botao, input, campo, caixa, select } from "./editor.js";

const $ = (id) => document.getElementById(id);

// ---------- Saúde ----------
function barras(s) {
  const b = el("span", `barras sinal-${s?.nivel ?? "nenhum"}`);
  b.setAttribute("role", "img");
  b.setAttribute("aria-label", s ? `Sinal ${s.texto.toLowerCase()}` : "Sinal desconhecido");
  for (let i = 1; i <= 4; i++) b.append(el("span", `barra${s && i <= s.barras ? " on" : ""}`));
  return b;
}
function facto(dl, rotulo, valor, cls) {
  const d = el("div", `facto${cls ? ` ${cls}` : ""}`);
  d.append(el("dt", null, rotulo));
  const dd = el("dd");
  if (typeof valor === "string") dd.textContent = valor; else dd.append(...valor);
  d.append(dd);
  dl.append(d);
}

// Conselhos simples para quem não é técnico, pela ordem dos avisos de listaSaude.
function oQueFazer(x) {
  const r = [];
  const pilhas = (x.bateria != null && x.bateria < E.BATERIA_FRACA) || (x.bateriaDias != null && x.bateriaDias < E.BATERIA_DIAS_POUCOS);
  if (x.online === false) r.push("Confirme que o aparelho tem corrente (disjuntor ligado) e que o Wi-Fi de casa está a funcionar. Muitas vezes volta sozinho em poucos minutos.");
  if (x.atencao.some((t) => /^Sem notícias/.test(t))) r.push("Abra e feche a porta ou passe à frente do sensor para ele dar sinal. Se continuar sem notícias, as pilhas podem ter acabado.");
  if (pilhas) r.push("Troque as pilhas do sensor por pilhas novas do mesmo tipo (veja as que lá estão). O sensor continua a funcionar até lá, mas pode deixar de avisar.");
  if (x.sinal?.barras === 1) r.push("O aparelho está longe do router. Um repetidor de Wi-Fi perto dele costuma resolver.");
  if ((x.reinicios24h ?? 0) > 5) r.push("Reiniciar muitas vezes pode ser falha de Wi-Fi ou de corrente. Se continuar amanhã, fale connosco.");
  if (!r.length && x.atencao.length) r.push("Se o aviso continuar, fale connosco.");
  return r;
}
function linkAjuda(nome) {
  const w = window.DOMUS?.whatsapp;
  if (!w || !/^\d{6,15}$/.test(String(w))) return null;
  const a = el("a", "btn sec pequeno", "Pedir ajuda no WhatsApp");
  a.href = `https://wa.me/${w}?text=${encodeURIComponent(`Olá Domus Energia, preciso de ajuda com o aparelho "${nome}".`)}`;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

export function desenharSaude(lista, agora = Date.now()) {
  const raiz = $("lista-saude");
  raiz.replaceChildren();
  if (!lista.length) { raiz.append(el("p", "vazio", "Ainda não tem aparelhos associados.")); return; }
  const n = lista.filter((x) => x.atencao.length).length;
  const topo = el("p", `msg ${n ? "info" : "ok"} saude-resumo`, n ? `${n} ${n === 1 ? "aparelho precisa" : "aparelhos precisam"} de atenção.` : "Todos os aparelhos estão bem.");
  raiz.append(topo);
  for (const x of lista) {
    const c = el("article", `cartao saude${x.atencao.length ? " atencao" : ""}`);
    c.dataset.id = x.id;
    const t = el("div", "saude-topo");
    const ponto = el("span", `estado${x.aPilhas ? " dorme" : x.online ? " online" : ""}`);
    const info = el("div", "info");
    info.append(el("b", null, x.nome));
    if (x.divisao) info.append(el("small", null, x.divisao));
    t.append(ponto, info);
    c.append(t);
    if (x.atencao.length) {
      const ul = el("ul", "atencao-lista");
      for (const a of x.atencao) ul.append(el("li", null, a));
      c.append(ul);
      const dicas = oQueFazer(x);
      if (dicas.length) {
        const d = el("div", "o-que-fazer");
        d.append(el("b", null, "O que fazer"));
        for (const t of dicas) d.append(el("p", null, t));
        const ajuda = linkAjuda(x.nome);
        if (ajuda) d.append(ajuda);
        c.append(d);
      }
    }
    const dl = el("dl", "factos");
    const ligacao = x.aPilhas ? "A pilhas (dorme entre eventos)"
      : x.online === false ? (x.offlineDesde ? `Offline desde ${E.horaLisboa(x.offlineDesde)} (${E.tempoRelativo(x.offlineDesde, agora)})` : "Offline")
      : x.online ? "Online" : "Sem informação";
    facto(dl, "Ligação", ligacao, x.online === false ? "mau" : "");
    facto(dl, "Última notícia", x.ultimaNoticia ? `${E.tempoRelativo(x.ultimaNoticia, agora)} (${E.horaLisboa(x.ultimaNoticia)})` : "—");
    facto(dl, "Sinal Wi-Fi", x.sinal ? [barras(x.sinal), document.createTextNode(` ${x.sinal.texto} (${x.rssi} dBm)`)] : [barras(null), document.createTextNode(" —")], x.sinal?.barras === 1 ? "mau" : "");
    facto(dl, "Reinícios em 24 h", x.reinicios24h == null ? "—" : String(x.reinicios24h), (x.reinicios24h ?? 0) > 5 ? "mau" : "");
    if (x.aPilhas || x.bateria != null) {
      const txt = x.bateria == null ? "—" : `${x.bateria} %${x.bateriaDias != null ? ` · ≈ ${Math.round(x.bateriaDias)} dias` : ""}`;
      facto(dl, "Pilhas", txt, (x.bateria != null && x.bateria < E.BATERIA_FRACA) || (x.bateriaDias != null && x.bateriaDias < E.BATERIA_DIAS_POUCOS) ? "mau" : "");
    }
    c.append(dl);
    raiz.append(c);
  }
}

// ---------- Relatório ----------
export function desenharRelatorio(r) {
  const raiz = $("relatorio-conteudo");
  raiz.replaceChildren();
  const quando = new Date(r.geradoEm).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const geral = el("div", "cartao relatorio-geral");
  geral.append(el("small", "vazio", `Estado às ${quando}`));
  const dl = el("dl", "factos");
  facto(dl, "Modo", r.modo ? E.NOME_MODO[r.modo] : "—");
  facto(dl, "Alarme", E.textoAlarme(r.alarme), r.alarme?.estado === "disparado" || r.alarme?.estado === "entrada" ? "mau" : "");
  facto(dl, "Consumo agora", r.consumo.agoraW == null ? "—" : `${Math.round(r.consumo.agoraW)} W`);
  facto(dl, "Hoje", r.consumo.hojeKWh == null ? "—" : E.kwhTexto(r.consumo.hojeKWh));
  facto(dl, "Ontem", r.consumo.ontemKWh == null ? "—" : E.kwhTexto(r.consumo.ontemKWh));
  geral.append(dl);
  raiz.append(geral);
  if (!r.divisoes.length) raiz.append(el("p", "vazio", "Ainda sem estado dos aparelhos."));
  for (const d of r.divisoes) {
    const c = el("article", "cartao relatorio-divisao");
    c.dataset.divisao = d.nome;
    c.append(el("h3", null, d.nome));
    const l = el("dl", "factos");
    for (const x of d.linhas) facto(l, x.rotulo, x.itens.join(", "), ["offline", "bateria", "sinal", "aberto"].includes(x.chave) ? "mau" : x.chave === "espera" ? "espera" : "");
    c.append(l);
    raiz.append(c);
  }
  $("relatorio-texto").textContent = E.relatorioTexto(r);
}

export async function copiarRelatorio() {
  const texto = $("relatorio-texto").textContent;
  const msg = $("relatorio-msg");
  try {
    await navigator.clipboard.writeText(texto);
    $("relatorio-texto").hidden = true;
    msg.textContent = "Relatório copiado. Pode colá-lo numa mensagem.";
  } catch {
    const pre = $("relatorio-texto");
    pre.hidden = false;
    const r = document.createRange();
    r.selectNodeContents(pre);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    msg.textContent = "Texto selecionado — use Copiar do seu telemóvel ou Ctrl+C.";
  }
}

// ---------- Definições ----------
const TEMPO_MOTOR = 10_000;
export function criarDefinicoes({ publicar, ligado }) {
  let config = null;      // lerConfig(_config)
  let guardando = null;   // { timer }
  let sujo = false;
  let msgTimer = null;

  function estado(texto, tipo = "info") {
    clearTimeout(msgTimer);
    const m = $("config-estado");
    m.hidden = !texto;
    m.textContent = texto ?? "";
    m.className = `msg ${tipo}`;
    if (tipo === "ok") msgTimer = setTimeout(() => { m.hidden = true; }, 4000);
  }

  function receber(c) {
    config = c;
    if (guardando) {
      clearTimeout(guardando.timer);
      guardando = null;
      sujo = false;
      estado("Definições guardadas.", "ok");
    }
    if (!sujo) desenhar();
    else atualizarBotao();
  }
  function receberErro(ev) {
    if (!guardando) return false;
    clearTimeout(guardando.timer);
    guardando = null;
    estado(ev.mensagem || ev.titulo || "O servidor recusou as definições.", "erro");
    atualizarBotao();
    return true;
  }
  function limpar() {
    clearTimeout(guardando?.timer);
    clearTimeout(msgTimer);
    config = null; guardando = null; sujo = false;
    $("config-caixa")?.replaceChildren();
    if ($("config-estado")) $("config-estado").hidden = true;
  }
  function atualizarBotao() {
    const b = document.querySelector("#form-config button[type=submit]");
    if (b) { b.disabled = !!guardando || !config; b.textContent = guardando ? "A guardar…" : "Guardar definições"; }
  }

  function desenhar() {
    const caixaC = $("config-caixa");
    caixaC.replaceChildren();
    const c = config ?? E.CONFIG_OMISSAO;
    const form = el("form", "cartao form-config");
    form.id = "form-config";
    form.noValidate = true;
    if (!config) form.append(el("p", "msg info", "A obter as definições do servidor…"));

    const num = (nome, v, min, max, extra = {}) => input(nome, "number", v, { min: String(min), max: String(max), step: "1", inputmode: "numeric", ...extra });

    const fA = el("fieldset");
    fA.append(el("legend", null, "Alarme"));
    const dA = el("div", "duas");
    dA.append(
      campo("Tempo para sair depois de armar (s)", num("cfg-saida", c.atraso_saida_s, 0, 300)),
      campo("Tempo para desarmar ao entrar (s)", num("cfg-entrada", c.atraso_entrada_s, 0, 300)),
    );
    fA.append(dA, el("small", "ajuda", "A porta de entrada dá este tempo antes de o alarme disparar. De 0 a 300 segundos."));

    const fN = el("fieldset");
    fN.append(el("legend", null, "Notificações"));
    const sil = caixa("cfg-silencio", "Horas de silêncio (só os alarmes notificam)", !!c.silencio);
    const hs = el("div", "horario");
    hs.append(campo("Das", input("cfg-silencio-de", "time", c.silencio?.[0] ?? "23:00")), campo("Às", input("cfg-silencio-ate", "time", c.silencio?.[1] ?? "07:00")));
    const rel = caixa("cfg-relatorio", "Enviar o relatório da casa todos os dias", !!c.relatorio_diario);
    const hr = campo("Hora do relatório", input("cfg-relatorio-hora", "time", c.relatorio_diario ?? "08:00"));
    const ver = () => { hs.hidden = !sil.input.checked; hr.hidden = !rel.input.checked; };
    sil.input.addEventListener("change", ver);
    rel.input.addEventListener("change", ver);
    fN.append(sil.label, hs, rel.label, hr);

    const fP = el("fieldset");
    fP.append(el("legend", null, "Aparelhos e automações"));
    const dP = el("div", "duas");
    dP.append(
      campo("\"Em espera\" abaixo de (W)", num("cfg-limiar", c.limiar_espera_w, 0, 100)),
      campo("Avisar offline ao fim de (min)", num("cfg-offline", c.offline_min, 1, 1440)),
    );
    fP.append(dP, campo("Pausa das automações depois de mexer à mão (min)", num("cfg-pausa", c.pausa_manual_min, 0, 480), "0 = sem pausa. Máximo 480 min (8 h)."));

    const fL = el("fieldset");
    fL.append(el("legend", null, "Localização (nascer e pôr do sol)"));
    const cidade = select("cfg-cidade", [{ valor: "", texto: "Escolher uma cidade…" }, ...E.CIDADES.map((x) => ({ valor: x.nome, texto: x.nome }))], "");
    const lat = input("cfg-lat", "number", c.local?.lat ?? "", { min: "-90", max: "90", step: "any", inputmode: "decimal", placeholder: "38.72" });
    const lon = input("cfg-lon", "number", c.local?.lon ?? "", { min: "-180", max: "180", step: "any", inputmode: "decimal", placeholder: "-9.14" });
    cidade.addEventListener("change", () => {
      const x = E.CIDADES.find((k) => k.nome === cidade.value);
      if (x) { lat.value = String(x.lat); lon.value = String(x.lon); sujo = true; }
    });
    const dL = el("div", "duas");
    dL.append(campo("Latitude", lat), campo("Longitude", lon));
    fL.append(campo("Usar a localização desta cidade", cidade), dL, el("small", "ajuda", "Basta a cidade mais próxima: a hora do sol muda poucos minutos dentro da mesma região."));

    const erro = el("div", "msg erro");
    erro.id = "config-form-erro";
    erro.setAttribute("role", "alert");
    erro.hidden = true;
    const ok = el("button", "btn", "Guardar definições");
    ok.type = "submit";
    const b = el("div", "form-botoes");
    b.append(ok);
    form.append(fA, fN, fP, fL, erro, b);
    form.addEventListener("input", () => { sujo = true; });
    form.addEventListener("change", () => { sujo = true; });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (guardando || !config) return;
      const n = (nome) => { const v = String(form.elements[nome].value ?? "").trim(); return v === "" ? NaN : Number(v); };
      const pedida = {
        atraso_saida_s: n("cfg-saida"),
        atraso_entrada_s: n("cfg-entrada"),
        silencio: sil.input.checked ? [String(form.elements["cfg-silencio-de"].value).slice(0, 5), String(form.elements["cfg-silencio-ate"].value).slice(0, 5)] : null,
        limiar_espera_w: n("cfg-limiar"),
        offline_min: n("cfg-offline"),
        pausa_manual_min: n("cfg-pausa"),
        relatorio_diario: rel.input.checked ? String(form.elements["cfg-relatorio-hora"].value).slice(0, 5) : null,
      };
      const la = n("cfg-lat"), lo = n("cfg-lon");
      if (Number.isFinite(la) || Number.isFinite(lo)) pedida.local = { lat: la, lon: lo };
      const parcial = E.configParcial(config, pedida);
      const erros = E.validarConfig(parcial);
      erro.hidden = !erros.length;
      erro.replaceChildren(...erros.map((t) => el("div", null, t)));
      if (erros.length) return;
      if (!Object.keys(parcial).length) { estado("Sem alterações.", "ok"); sujo = false; return; }
      if (!ligado()) { estado("Sem ligação ao servidor. Tente de novo daqui a pouco.", "erro"); return; }
      guardando = { timer: setTimeout(() => { guardando = null; estado("O servidor não respondeu. As definições não foram guardadas; tente de novo.", "erro"); atualizarBotao(); }, TEMPO_MOTOR) };
      publicar("_config/set", parcial);
      estado("A guardar…", "info");
      atualizarBotao();
    });
    caixaC.append(form);
    ver();
    atualizarBotao();
  }

  return { receber, receberErro, limpar, desenhar, config: () => config };
}
