// Páginas legais (privacidade.html, termos.html, cookies.html): a identificação da empresa vem de config.js
// (window.DOMUS.empresa + email/telefone). Cada <span data-empresa="nome|nif|morada|ral|email|telefone"> recebe o
// valor; enquanto um valor for "[A PREENCHER]" fica assinalado (classe .por-preencher) e aparece o aviso no topo
// (#legal-aviso), para o dono ver o que falta antes de publicar. A data em #legal-data vem do data-atualizado da página.
const cfg = window.DOMUS ?? {};
const empresa = cfg.empresa ?? {};
const PLACEHOLDER = /\[A (PREENCHER|CONFIRMAR)\]/;
const valores = {
  nome: empresa.nome,
  nif: empresa.nif,
  morada: empresa.morada,
  ral: empresa.ral,
  email: cfg.email,
  telefone: cfg.telefoneVisivel,
};
let faltam = 0;
// Telefone de exemplo (351900000000, como o site.js `numeroReal`): esconde a linha em vez de mostrar um número falso.
if (/^\+?351?9?0{6,}$/.test(String(cfg.telefone ?? "").replace(/\D/g, "")) || /^9?0[0 ]+$/.test(String(cfg.telefoneVisivel ?? "").trim())) {
  for (const el of document.querySelectorAll('[data-empresa="telefone"]')) {
    const linha = el.closest("dd")?.previousElementSibling?.tagName === "DT" ? el.closest("dd") : null;
    if (linha) { linha.previousElementSibling.remove(); linha.remove(); } else el.remove();
  }
}
for (const el of document.querySelectorAll("[data-empresa]")) {
  const v = String(valores[el.dataset.empresa] ?? "[A PREENCHER]").trim() || "[A PREENCHER]";
  el.textContent = v;
  if (PLACEHOLDER.test(v)) { el.classList.add("por-preencher"); faltam++; }
  else if (el.dataset.empresa === "email") {
    const a = document.createElement("a");
    a.href = `mailto:${v}`;
    a.textContent = v;
    el.replaceChildren(a);
  }
}
// Marcas "[A CONFIRMAR]" escritas no texto (ex.: a localização de um subcontratante) também ficam assinaladas.
for (const el of document.querySelectorAll(".legal mark")) if (PLACEHOLDER.test(el.textContent)) faltam++;
// Tabelas em telemóvel (styles.css @media max-width 599px): cada célula leva o cabeçalho da sua coluna.
for (const t of document.querySelectorAll(".legal .tabela")) {
  const cab = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { td.dataset.r = cab[i] ?? ""; });
}
const aviso = document.getElementById("legal-aviso");
if (aviso) aviso.hidden = faltam === 0;
const data = document.getElementById("legal-data");
if (data?.dataset.atualizado) {
  const d = new Date(data.dataset.atualizado);
  if (!Number.isNaN(d.getTime())) data.textContent = d.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
}
