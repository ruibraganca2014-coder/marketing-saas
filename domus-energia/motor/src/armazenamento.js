// Estado persistente do motor num ficheiro JSON.
// Gravações adiadas (várias alterações seguidas → uma escrita) e atómicas
// (escreve num ficheiro temporário e renomeia), para nunca ficar meio escrito.

import fs from 'node:fs';
import path from 'node:path';

export class FicheiroEstado {
  /**
   * @param {string} ficheiro
   * @param {{atrasoMs?: number, log?: {info: Function, erro: Function}}} [opcoes]
   */
  constructor(ficheiro, opcoes = {}) {
    this.ficheiro = ficheiro;
    this.atrasoMs = opcoes.atrasoMs ?? 1000;
    this.log = opcoes.log ?? console;
    /** @type {(() => any) | null} */
    this.obter = null;
    /** @type {NodeJS.Timeout | null} */
    this.temporizador = null;
    /** Última mensagem de erro de gravação (para não repetir no registo). */
    this.ultimoErro = null;
  }

  /**
   * Verifica se a pasta dos dados permite escrita. Devolve a mensagem de erro
   * (com a solução) ou null.
   */
  verificarEscrita() {
    const pasta = path.dirname(this.ficheiro);
    try {
      fs.mkdirSync(pasta, { recursive: true });
      fs.accessSync(pasta, fs.constants.W_OK);
      return null;
    } catch (e) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
      return `sem permissão de escrita em ${pasta} (${e.code ?? e.message}). No servidor: sudo chown -R ${uid}:${uid} servidor/dados/motor`;
    }
  }

  carregar() {
    let texto;
    try {
      texto = fs.readFileSync(this.ficheiro, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    try {
      return JSON.parse(texto);
    } catch (e) {
      // Ficheiro corrompido: guarda uma cópia e começa do zero.
      const copia = `${this.ficheiro}.corrompido-${Date.now()}`;
      try {
        fs.copyFileSync(this.ficheiro, copia);
      } catch {}
      this.log.erro(`[estado] ${this.ficheiro} inválido (${e.message}); cópia em ${copia}`);
      return null;
    }
  }

  /** @param {() => any} obter */
  pedirGravacao(obter, atrasoMs = this.atrasoMs) {
    this.obter = obter;
    if (this.temporizador) return;
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.gravarAgora();
    }, atrasoMs);
  }

  /** Grava já o que estiver pendente (usado ao terminar). */
  descarregar() {
    if (this.temporizador) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
    this.gravarAgora();
  }

  gravarAgora() {
    if (!this.obter) return;
    const obter = this.obter;
    this.obter = null;
    try {
      const dados = JSON.stringify(obter(), null, 1);
      fs.mkdirSync(path.dirname(this.ficheiro), { recursive: true });
      const tmp = `${this.ficheiro}.${process.pid}.tmp`;
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.writeFileSync(fd, dados);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.ficheiro);
      if (this.ultimoErro) this.log.info(`[estado] gravação de ${this.ficheiro} voltou a funcionar`);
      this.ultimoErro = null;
    } catch (e) {
      if (e.message !== this.ultimoErro) {
        this.log.erro(`[estado] erro ao gravar ${this.ficheiro}: ${e.message} — o motor continua, com o estado só em memória`);
        this.ultimoErro = e.message;
      }
      // Tenta de novo daqui a um minuto.
      if (!this.obter) this.pedirGravacao(obter, 60_000);
    }
  }
}

/** Armazenamento em memória (testes). Guarda uma cópia JSON a cada pedido. */
export class MemoriaEstado {
  constructor(inicial = null) {
    this.dados = inicial ? JSON.parse(JSON.stringify(inicial)) : null;
  }
  carregar() {
    return this.dados ? JSON.parse(JSON.stringify(this.dados)) : null;
  }
  pedirGravacao(obter) {
    this.dados = JSON.parse(JSON.stringify(obter()));
  }
}
