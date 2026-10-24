// As árvores de diagnóstico da app /diagnostico.html, por área (decisões do dono, 2026-10-24). Ronda 1: as avarias mais
// comuns de uma habitação (caps. 10, 11, 16 e 20). Ronda 2: o resto do manual de instalações BT (caps. 1 a 22). Cada
// árvore tem a sua `versao` (sobe quando muda) e cada diagnóstico guarda a versão com que foi feito. A app guarda estes
// ficheiros no telemóvel (diagnostico-sw.js, que tem de listar cada módulo novo): funcionam sem rede.
import { DIFERENCIAL, DISJUNTOR } from "./arvores-protecoes.js";
import { SEM_CORRENTE, SEM_ENERGIA, LUZES } from "./arvores-alimentacao.js";
import { CHOQUE, TERRA_ARVORE, ISOLAMENTO_ARVORE } from "./arvores-terra.js";
import { AQUECIMENTO, MOTOR } from "./arvores-aparelhos.js";
import { ARVORES_PROJETO } from "./arvores-projeto.js";
import { ARVORES_PROTECOES2 } from "./arvores-protecoes2.js";
import { ARVORES_LOCAIS } from "./arvores-locais.js";
import { ARVORES_EDIFICIOS } from "./arvores-edificios.js";
import { ARVORES_MANUTENCAO } from "./arvores-manutencao.js";
import { ARVORES_MOTORES } from "./arvores-motores.js";
import { ARVORES_SINALIZACAO } from "./arvores-sinalizacao.js";
import { ARVORES_ENERGIA } from "./arvores-energia.js";
import { ARVORES_DOMOTICA } from "./arvores-domotica.js";

/** Versão do conjunto (sobe sempre que se acrescenta ou muda uma árvore). */
export const VERSAO_ARVORES = 2;
export const RONDA = 2;

export const ARVORES = [
  DIFERENCIAL, DISJUNTOR, SEM_CORRENTE, SEM_ENERGIA, LUZES, AQUECIMENTO, CHOQUE, TERRA_ARVORE, ISOLAMENTO_ARVORE, MOTOR,
  ...ARVORES_PROJETO, ...ARVORES_PROTECOES2, ...ARVORES_LOCAIS, ...ARVORES_EDIFICIOS, ...ARVORES_MANUTENCAO,
  ...ARVORES_MOTORES, ...ARVORES_SINALIZACAO, ...ARVORES_ENERGIA, ...ARVORES_DOMOTICA,
];

/** As áreas, pela ordem em que aparecem na app (as avarias do dia a dia primeiro). */
export const GRUPOS = [
  "Proteções que disparam", "Falta de energia", "Aquecimento e aparelhos", "Terra e isolamento",
  "Projeto, circuitos e cabos", "Locais especiais e influências externas", "Edifícios coletivos e segurança",
  "Motores e automatismos", "Sinalização, telecomunicações e para-raios", "Renováveis, socorro e qualidade da energia",
  "Domótica e sistemas de segurança", "Verificação e manutenção",
];
export const arvorePorId = (id) => ARVORES.find((a) => a.id === id) ?? null;

/** Texto sem acentos e em minúsculas, para a procura ("Proteção" encontra "protecao"). */
export const normalizar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** As árvores que têm todas as palavras procuradas no título, no sintoma, na área ou nas palavras extra. */
export function procurar(texto, arvores = ARVORES) {
  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!termos.length) return arvores;
  return arvores.filter((a) => {
    const onde = normalizar(`${a.titulo} ${a.sintoma} ${a.grupo} ${a.palavras ?? ""}`);
    return termos.every((t) => onde.includes(t));
  });
}
