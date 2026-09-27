// Registo dos eventos do Stripe já tratados (idempotência por id do evento).
// O Stripe pode reenviar o mesmo evento (repetições, falhas de rede): um id já
// visto é confirmado com 200 sem voltar a mexer em nada.

import { readFile } from 'node:fs/promises';
import { escreverAtomico } from './util.js';

const MAXIMO = 10_000;

export class EventosTratados {
  constructor(caminho) {
    this.caminho = caminho;
    this.ids = null; // Map id -> instante
  }

  async #carregar() {
    if (this.ids) return;
    this.ids = new Map();
    try {
      const l = JSON.parse(await readFile(this.caminho, 'utf8'));
      if (Array.isArray(l)) for (const [id, t] of l) if (typeof id === 'string') this.ids.set(id, t);
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`${this.caminho} ilegível: ${e.message}`);
    }
  }

  async tratado(id) {
    await this.#carregar();
    return this.ids.has(id);
  }

  async marcar(id) {
    await this.#carregar();
    this.ids.set(id, Math.floor(Date.now() / 1000));
    while (this.ids.size > MAXIMO) this.ids.delete(this.ids.keys().next().value);
    await escreverAtomico(this.caminho, JSON.stringify([...this.ids]), 0o600);
  }
}
