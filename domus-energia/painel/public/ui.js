// Peças de interface do painel: criação de elementos (só textContent, nunca HTML com dados),
// formatação pt-PT, janelas (<dialog>), avisos e a palavra-passe mostrada uma vez.
import { campo, numero } from "./api.js";

/**
 * Cria um elemento. `attrs`: class, text, on<evento> (função), dataset (objeto), hidden/disabled/checked…
 * (booleanos), resto via setAttribute. Filhos: nós ou textos (viram nós de texto), null é ignorado.
 */
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (["hidden", "disabled", "checked", "required", "selected", "multiple", "open"].includes(k)) el[k] = !!v;
    else if (k === "value") el.value = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

// ---------- Nomes (pt-PT) ----------
export const PAPEIS = { ceo: "CEO", tecnico: "Técnico", comercial: "Comercial" };
export const PLANOS = { base: "Base", conforto: "Conforto", premium: "Premium" };
export const ESTADOS_CLIENTE = { ativo: "Ativo", teste: "Em teste", em_atraso: "Em atraso", suspenso: "Suspenso", cancelado: "Cancelado", sem_plano: "Sem plano", pendente: "A criar" };
export const ESTADOS_ORC = { novo: "Novo", contactado: "Contactado", visita_marcada: "Visita marcada", proposta_enviada: "Proposta enviada", aceite: "Aceite", perdido: "Perdido" };
/** Os estados e o dos pedidos anonimizados pelo RGPD (fora do quadro e da escolha do estado: só o filtro do CEO). */
export const NOMES_ESTADO_ORC = { ...ESTADOS_ORC, arquivado: "Arquivado (RGPD)" };
/** CRM (docs/CRM-TAREFAS.md): fases do negócio (= estado do pedido), origem do contacto, motivo de perda, registos. */
export const FASES_CRM = { novo: "Novo", contactado: "Contactado", visita: "Visita", proposta: "Proposta", aceite: "Aceite", perdido: "Perdido" };
export const ESTADO_DA_FASE = { novo: "novo", contactado: "contactado", visita: "visita_marcada", proposta: "proposta_enviada", aceite: "aceite", perdido: "perdido" };
export const ORIGENS_CONTACTO = { google: "Google", facebook: "Facebook", instagram: "Instagram", facebook_instagram: "Facebook / Instagram", recomendacao: "Recomendação de um amigo",
  eletricista_parceiro: "Eletricista parceiro", carrinha_rua: "Carrinha / passou na rua", direto: "Direto", outro: "Outro" };
export const ENTRADAS = { carregador: "Anúncio: carregador de carro", "quadro-antigo": "Anúncio: quadro elétrico" };
export const MOTIVOS_PERDA = { preco: "Preço", prazo: "Prazo", sem_resposta: "Sem resposta", outro: "Outro" };
export const TIPOS_REGISTO = { nota: "Nota", chamada: "Chamada", email: "Email", whatsapp: "WhatsApp", visita: "Visita" };
export const ESTADOS_TAREFA = { a_fazer: "A fazer", em_curso: "Em curso", feito: "Feito" };
export const ESTADOS_OBRA = { agendada: "Agendada", em_curso: "Em curso", concluida: "Concluída", cancelada: "Cancelada" };
export const KITS = { essencial: { nome: "Essencial", horas: 3 }, conforto: { nome: "Conforto", horas: 7 }, premium: { nome: "Segurança Premium", horas: 10 } };
export const GRAVIDADES = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
/** Gravidade normalizada (aceita também critico/aviso/info). */
export const gravidadeDe = (g) => ({ critico: "critica", "crítica": "critica", "crítico": "critica", aviso: "media", info: "baixa", "média": "media" })[String(g ?? "").toLowerCase()] ?? (GRAVIDADES[String(g ?? "").toLowerCase()] ? String(g).toLowerCase() : "baixa");

export const nomeDe = (mapa, v) => (v == null || v === "" ? "—" : mapa[v]?.nome ?? mapa[v] ?? String(v));

// ---------- Formatação ----------
const fmtEuro = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
// Até 2 casas: potências (10,35 kVA) e horas (39,25 h) não se arredondam; inteiros ficam sem casas.
const fmtNum = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
export const euros = (v) => { const n = numero(v); return n === null ? "—" : fmtEuro.format(n); };
export const num = (v) => { const n = numero(v); return n === null ? "—" : fmtNum.format(n); };

/** Data (e hora, se houver) a partir de ISO/"AAAA-MM-DD"; texto inválido fica como está. */
export function data(v, { hora = true } = {}) {
  if (!v) return "—";
  const s = String(v);
  const soDia = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = soDia ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const dia = d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (soDia || !hora) return dia;
  return `${dia} ${d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
}
export const diaSemana = (d) => d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
export const mes = (v) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return String(v ?? "—");
  const t = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** "AAAA-MM-DD" local. */
export const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Selo colorido (estado, plano, gravidade). */
export const selo = (texto, tipo = "") => h("span", { class: `selo-p ${tipo}`.trim(), text: texto });

/** Campo de formulário com etiqueta. */
export function campoForm(etiqueta, controlo, ajuda) {
  return h("label", { class: "campo" }, h("span", { text: etiqueta }), controlo, ajuda ? h("span", { class: "ajuda", text: ajuda }) : null);
}
export function escolha(nome, opcoes, atual, attrs = {}) {
  return h("select", { name: nome, ...attrs }, ...Object.entries(opcoes).map(([v, t]) =>
    h("option", { value: v, selected: v === atual }, typeof t === "object" ? t.nome : t)));
}

/** Pares título/valor (ficha). */
export function dados(pares) {
  return h("dl", { class: "dados" }, ...pares.filter(Boolean).map(([t, v]) =>
    h("div", {}, h("dt", { text: t }), h("dd", {}, v instanceof Node ? v : String(v ?? "—")))));
}

// ---------- Avisos ----------
let zonaAvisos;
/** Aviso curto no canto (role=status). tipo: ok | erro | info. */
export function avisar(texto, tipo = "ok") {
  zonaAvisos ??= document.getElementById("avisos");
  const a = h("div", { class: `msg ${tipo}`, text: texto });
  zonaAvisos.append(a);
  setTimeout(() => a.remove(), 6000);
}

/** Caixa de mensagem dentro de um formulário. */
export function mensagem(el, texto, tipo = "erro") {
  if (!texto) { el.hidden = true; el.textContent = ""; return; }
  el.className = `msg ${tipo}`;
  el.textContent = texto;
  el.hidden = false;
}

// ---------- Janelas ----------
/**
 * Abre uma janela modal (<dialog>): título + conteúdo. Devolve { dialogo, corpo, fechar }.
 * `aoFechar` corre quando fecha (Esc, botão, fechar()).
 */
export function janela(titulo, { aoFechar, larga = false, classe = "" } = {}) {
  const id = `j-${Math.random().toString(36).slice(2, 8)}`;
  const fecharBtn = h("button", { class: "botao-icone", type: "button", "aria-label": "Fechar" }, iconeFechar());
  const corpo = h("div", { class: "janela-corpo" });
  const d = h("dialog", { class: `janela ${larga ? "larga" : ""} ${classe}`.trim(), "aria-labelledby": id },
    h("div", { class: "janela-topo" }, h("h2", { id, text: titulo }), fecharBtn), corpo);
  const origem = document.activeElement;
  fecharBtn.addEventListener("click", () => d.close());
  d.addEventListener("close", () => {
    d.remove();
    aoFechar?.();
    if (origem?.isConnected) origem.focus();
  });
  // Clicar no fundo (fora da caixa) fecha.
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return { dialogo: d, corpo, fechar: () => d.open && d.close(), titulo: d.querySelector("h2") };
}

export function iconeFechar() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M6 6l12 12M18 6 6 18");
  s.append(p);
  return s;
}

/**
 * Caixa com uma palavra-passe mostrada UMA vez: copiar + "guarde agora". "Já guardei" apaga-a do ecrã.
 */
export function caixaPalavraPasse(senha, { utilizador, aoGuardar } = {}) {
  const valor = h("code", { class: "senha", text: senha });
  const estado = h("span", { class: "ajuda", role: "status" });
  const copiar = h("button", { class: "btn sec pequeno", type: "button", text: "Copiar" });
  copiar.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(senha); estado.textContent = "Copiada."; }
    catch {
      // Sem acesso à área de transferência: seleciona o texto para copiar à mão.
      const r = document.createRange(); r.selectNodeContents(valor);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      estado.textContent = "Selecionada: copie com Ctrl+C.";
    }
  });
  const guardei = h("button", { class: "btn pequeno", type: "button", text: "Já guardei" });
  const caixa = h("div", { class: "caixa-senha" },
    h("p", { class: "guarde" }, h("strong", { text: "Guarde agora." }), " Esta palavra-passe só aparece esta vez: não a voltamos a mostrar."),
    utilizador ? h("p", {}, "Utilizador: ", h("code", { text: utilizador })) : null,
    h("div", { class: "linha-senha" }, valor, copiar),
    estado, guardei);
  guardei.addEventListener("click", () => {
    valor.textContent = "••••••••";
    caixa.replaceChildren(h("p", { class: "ajuda", text: "Palavra-passe retirada do ecrã." }));
    aoGuardar?.();
  });
  return caixa;
}

/** Janela só com a palavra-passe (resultado de um pedido). */
export function mostrarPalavraPasse(titulo, senha, { utilizador, texto } = {}) {
  const j = janela(titulo, { classe: "janela-senha" });
  if (texto) j.corpo.append(h("p", { text: texto }));
  j.corpo.append(caixaPalavraPasse(senha, { utilizador, aoGuardar: () => setTimeout(j.fechar, 600) }));
  return j;
}

/** Botão de confirmação em dois passos (sem confirm() nativo). */
export function botaoConfirmar(texto, pergunta, acao, { classe = "btn sec pequeno", disabled = false } = {}) {
  const b = h("button", { class: classe, type: "button", text: texto, disabled });
  let armado = false, t;
  b.addEventListener("click", async () => {
    if (!armado) {
      armado = true; b.textContent = pergunta; b.classList.add("armado");
      t = setTimeout(() => { armado = false; b.textContent = texto; b.classList.remove("armado"); }, 5000);
      return;
    }
    clearTimeout(t); armado = false; b.classList.remove("armado"); b.textContent = texto;
    await acao(b);
  });
  return b;
}

/** Estado de carregamento / erro de um ecrã. */
export const carregando = (texto = "A carregar…") => h("p", { class: "vazio", role: "status", text: texto });
export function erroEcra(erro, tentar) {
  if (erro?.estado === 403) return semAcesso();
  return h("div", { class: "msg erro bloco", role: "alert" },
    h("p", { text: erro?.message ?? "Algo correu mal." }),
    tentar ? h("button", { class: "btn sec pequeno", type: "button", text: "Tentar de novo", onclick: tentar }) : null);
}
/** `papeis`: os papéis que veem o ecrã (ex.: ["ceo", "comercial"]), para dizer a quem se destina; sem eles (um 403 do servidor), texto geral. */
export function semAcesso(papeis = null) {
  const nomes = (papeis ?? []).map((p) => PAPEIS[p] ?? p);
  const quem = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
  return h("div", { class: "cartao sem-acesso", role: "alert" },
    h("h2", { text: "Sem acesso" }),
    h("p", { text: !nomes.length ? "Não tem acesso a esta área. Se precisar dela, peça acesso ao CEO."
      : papeis.length === 1 && papeis[0] === "ceo" ? "Esta área é só para o CEO. Se precisar dela, peça-lhe acesso."
      : `Esta área é só para: ${quem}. Se precisar dela, peça acesso ao CEO.` }),
    h("a", { class: "btn sec pequeno", href: "#/inicio", text: "Voltar ao início" }));
}

/** Valor de um campo com nomes alternativos, como texto. */
export const txt = (obj, ...nomes) => { const v = campo(obj, ...nomes); return v == null || v === "" ? "—" : String(v); };
