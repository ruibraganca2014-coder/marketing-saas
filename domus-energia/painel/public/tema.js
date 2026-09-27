// Tema claro/escuro: segue o sistema, a não ser que a pessoa escolha outro neste navegador.
// Carregado no <head> (sem module) para não haver clarão com o tema errado.
(function () {
  var CHAVE = "domus.tema";
  var raiz = document.documentElement;
  function ler() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function aplicar(t) {
    if (t === "light" || t === "dark") raiz.setAttribute("data-theme", t);
    else raiz.removeAttribute("data-theme");
  }
  var escolha = ler();
  aplicar(escolha);

  var NOMES = { auto: "Tema automático", light: "Tema claro", dark: "Tema escuro" };
  document.addEventListener("DOMContentLoaded", function () {
    var botao = document.getElementById("tema");
    if (!botao) return;
    function mostrar() {
      var t = escolha || "auto";
      botao.dataset.tema = t;
      botao.setAttribute("aria-label", NOMES[t] + " (mudar)");
      botao.title = NOMES[t];
    }
    mostrar();
    botao.addEventListener("click", function () {
      var atual = escolha || "auto";
      var seguinte = atual === "auto" ? "light" : atual === "light" ? "dark" : "auto";
      try {
        if (seguinte === "auto") localStorage.removeItem(CHAVE);
        else localStorage.setItem(CHAVE, seguinte);
      } catch (e) {}
      escolha = seguinte === "auto" ? null : seguinte;
      aplicar(escolha);
      mostrar();
    });
  });
})();
