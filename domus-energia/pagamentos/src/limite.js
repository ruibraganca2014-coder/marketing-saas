// Limite de tentativas por chave (IP ou código de cliente), em janela deslizante.

export class LimiteTaxa {
  /**
   * @param {number} maximo tentativas permitidas na janela
   * @param {number} janelaMs duração da janela
   */
  constructor(maximo, janelaMs, relogio = () => Date.now()) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
    this.relogio = relogio;
    this.tentativas = new Map(); // chave -> [instantes]
  }

  #recentes(chave, agora) {
    const lista = (this.tentativas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    if (lista.length) this.tentativas.set(chave, lista);
    else this.tentativas.delete(chave);
    return lista;
  }

  /** Segundos até poder tentar de novo (0 = pode já). Não conta a tentativa. */
  espera(chave) {
    const agora = this.relogio();
    const lista = this.#recentes(chave, agora);
    if (lista.length < this.maximo) return 0;
    return Math.max(1, Math.ceil((lista[0] + this.janelaMs - agora) / 1000));
  }

  /** Conta uma tentativa. */
  registar(chave) {
    const agora = this.relogio();
    const lista = this.#recentes(chave, agora);
    lista.push(agora);
    this.tentativas.set(chave, lista);
    if (this.tentativas.size > 10_000) this.limpar();
  }

  /** Remove as chaves sem tentativas recentes (memória). */
  limpar() {
    const agora = this.relogio();
    for (const chave of [...this.tentativas.keys()]) this.#recentes(chave, agora);
  }
}
