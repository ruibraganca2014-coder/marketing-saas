// As árvores de diagnóstico da app /diagnostico.html, por grupo (decisões do dono, 2026-10-24). Ronda 1: as avarias
// mais comuns de uma habitação (manual de instalações BT, caps. 10, 11, 16 e 20). As rondas seguintes acrescentam
// módulos arvores-*.js e entram aqui; cada árvore tem a sua `versao` (sobe quando muda) e cada diagnóstico guarda a
// versão com que foi feito. A app guarda estes ficheiros no telemóvel (diagnostico-sw.js): funcionam sem rede.
import { DIFERENCIAL, DISJUNTOR } from "./arvores-protecoes.js";
import { SEM_CORRENTE, SEM_ENERGIA, LUZES } from "./arvores-alimentacao.js";
import { CHOQUE, TERRA_ARVORE, ISOLAMENTO_ARVORE } from "./arvores-terra.js";
import { AQUECIMENTO, MOTOR } from "./arvores-aparelhos.js";

/** Versão do conjunto (sobe sempre que se acrescenta ou muda uma árvore). */
export const VERSAO_ARVORES = 1;
export const RONDA = 1;

export const ARVORES = [DIFERENCIAL, DISJUNTOR, SEM_CORRENTE, SEM_ENERGIA, LUZES, AQUECIMENTO, CHOQUE, TERRA_ARVORE, ISOLAMENTO_ARVORE, MOTOR];
export const GRUPOS = [...new Set(ARVORES.map((a) => a.grupo))];
export const arvorePorId = (id) => ARVORES.find((a) => a.id === id) ?? null;
