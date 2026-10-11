// Confirmação em dois toques (decisão do dono, 2026-10-11), como o botaoConfirmar do painel: o primeiro toque troca o
// texto do botão pela pergunta ("Confirmar: …?"); o segundo faz a ação. Sem o segundo toque, o botão volta ao texto
// normal ao fim de 5 segundos. Usado na conta do cliente ("Aceito" do trabalho a mais) e na área do eletricista
// ("Obra concluída" e "Retirar" do trabalho a mais).

/**
 * Liga a confirmação a um botão que já existe. `pergunta` é o texto do segundo toque; `acao()` corre só depois dele.
 */
export function confirmarEmDoisToques(botao, pergunta, acao) {
  const texto = botao.textContent;
  let armado = false, tm;
  const desarmar = () => { clearTimeout(tm); armado = false; botao.classList.remove("armado"); botao.textContent = texto; };
  botao.addEventListener("click", () => {
    if (!armado) {
      armado = true;
      botao.classList.add("armado");
      botao.textContent = pergunta;
      tm = setTimeout(desarmar, 5000);
      return;
    }
    desarmar();
    acao();
  });
}
