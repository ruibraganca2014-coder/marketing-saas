// Modelos prontos de automações (docs/AUTOMACOES-v3.md §4, guia da Vesternet).
// Módulo puro: recebe os aparelhos do cliente (lerAparelhos) e devolve uma automação
// pré-preenchida, ou { falta } quando a casa não tem o aparelho necessário.
import { nomeCanal, MAX_ACOES } from "./estado.js";

const norm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Todos os canais das funções pedidas, com o aparelho.
function canais(aparelhos, funcoes, filtro = () => true) {
  const r = [];
  for (const a of aparelhos) for (const c of a.canais) {
    if (funcoes.includes(c.funcao) && filtro(a, c)) r.push({ a, c, aparelho: a.id, canal: c.n, nome: nomeCanal(aparelhos, a.id, c.n), divisao: c.divisao ?? a.divisao ?? null });
  }
  return r;
}
// Luzes "de iluminação": canais luz, ou interruptores de aparelhos sem medição (os com medição
// costumam ser disjuntores de circuitos — termoacumulador, quadro geral — e não luzes).
const luzes = (aparelhos) => canais(aparelhos, ["luz", "interruptor"], (a, c) => c.carga !== "perigosa" && (c.funcao === "luz" || !a.medidor));
// Escolhe o primeiro cujo nome/divisão combina com uma das palavras, senão o primeiro.
function preferir(lista, palavras, divisao) {
  if (divisao) { const d = lista.find((x) => x.divisao && norm(x.divisao) === norm(divisao)); if (d) return d; }
  for (const p of palavras) { const x = lista.find((y) => norm(`${y.nome} ${y.divisao ?? ""}`).includes(p)); if (x) return x; }
  return lista[0];
}
const alvo = (x) => ({ aparelho: x.aparelho, canal: x.canal });
const noite = (config) => (config?.local ? { sol: "noite" } : { entre: ["19:00", "07:00"] });

export const MODELOS = [
  { id: "movimento", titulo: "Luz com movimento", resumo: "Acende com movimento e apaga 10 min depois do último movimento." },
  { id: "chegada", titulo: "Chegada a casa", resumo: "Quando chega a primeira pessoa: modo Casa e luz da entrada à noite." },
  { id: "saida", titulo: "Saída de casa", resumo: "Quando sai a última pessoa: apaga as luzes e passa a modo Fora." },
  { id: "intrusao", titulo: "Alerta de entrada inesperada", resumo: "Porta aberta em modo Fora ou Noite: acende luzes e avisa." },
  { id: "ferias", titulo: "Ocupação simulada", resumo: "Luzes a acender e apagar quando está de férias." },
  { id: "consumo", titulo: "Aviso de consumo alto", resumo: "Avisa quando o consumo passa um limite durante 1 min." },
  { id: "bom-dia", titulo: "Bom dia", resumo: "Dias úteis às 07:30: sobe os estores e acende a luz aos poucos." },
  { id: "boa-noite", titulo: "Boa noite", resumo: "Num toque: apaga as luzes, fecha os estores e passa a modo Noite." },
];

/**
 * @returns {{automacao?: object, falta?: string, info?: string}}
 */
export function aplicarModelo(id, { aparelhos = [], config = null } = {}) {
  const L = luzes(aparelhos);
  switch (id) {
    case "movimento": {
      const pir = canais(aparelhos, ["movimento"]);
      if (!pir.length) return { falta: "Este modelo precisa de um sensor de movimento e ainda não tem nenhum. Fale com a Domus Energia." };
      if (!L.length) return { falta: "Este modelo precisa de uma luz ou interruptor e ainda não tem nenhum." };
      const s = pir[0];
      const palavras = norm(s.a.nome).split(/[^a-z0-9]+/).filter((p) => p.length > 3 && p !== "movimento" && p !== "sensor");
      const l = preferir(L, palavras, s.divisao);
      return { automacao: {
        nome: `Luz com movimento — ${l.nome}`.slice(0, 60),
        descricao: `Acender ${l.nome} quando há movimento em ${s.a.nome} e apagar 10 min depois do último movimento, só à noite.`.slice(0, 200),
        categoria: "conveniencia", ativa: true,
        quando: { tipo: "sensor", aparelho: s.aparelho, canal: s.canal, valor: 1 },
        se: noite(config),
        entao: [{ acao: "ligar", ...alvo(l), durante_s: 600 }],
      } };
    }
    case "chegada": {
      const entao = [{ acao: "modo", modo: "casa" }];
      if (L.length) {
        const l = preferir(L, ["entrada", "hall", "corredor", "sala"]);
        entao.push({ acao: "se", condicao: noite(config), entao: [{ acao: "ligar", ...alvo(l), durante_s: 900 }] });
      }
      return { automacao: {
        nome: "Chegada a casa",
        descricao: "Quando chega a primeira pessoa, desarmar (modo Casa) e, se for de noite, acender a luz da entrada.",
        categoria: "conveniencia", ativa: true,
        quando: { tipo: "presenca", evento: "chega_primeiro" },
        entao,
      } };
    }
    case "saida": {
      const entao = L.slice(0, MAX_ACOES - 1).map((l) => ({ acao: "desligar", ...alvo(l) }));
      entao.push({ acao: "modo", modo: "fora", forcar: false });
      return { automacao: {
        nome: "Saída de casa",
        descricao: "Quando sai a última pessoa, apagar as luzes e armar o alarme (modo Fora).",
        categoria: "seguranca", ativa: true,
        quando: { tipo: "presenca", evento: "sai_ultimo" },
        entao,
      } };
    }
    case "intrusao": {
      const portas = canais(aparelhos, ["porta"]);
      if (!portas.length) return { falta: "Este modelo precisa de um sensor de porta ou janela e ainda não tem nenhum. Fale com a Domus Energia." };
      const p = portas.find((x) => x.c.entrada) ?? portas[0];
      const entao = L.slice(0, 3).map((l) => ({ acao: "ligar", ...alvo(l), durante_s: 600 }));
      entao.push({ acao: "notificar", mensagem: `${p.nome} abriu com a casa em modo Fora ou Noite.`.slice(0, 200) });
      return { automacao: {
        nome: "Alerta de entrada inesperada",
        descricao: `Se ${p.nome} abrir em modo Fora ou Noite, acender luzes e avisar no telemóvel (o alarme do modo continua a funcionar).`.slice(0, 200),
        categoria: "seguranca", ativa: true,
        quando: { tipo: "sensor", aparelho: p.aparelho, canal: p.canal, valor: 1 },
        se: { modo: ["fora", "noite"] },
        entao,
      } };
    }
    case "ferias": {
      const marcadas = canais(aparelhos, ["luz", "interruptor"], (a, c) => c.simular);
      const quais = marcadas.length
        ? `Luzes usadas na simulação: ${marcadas.map((x) => x.nome).join(", ")}.`
        : "Ainda não há luzes marcadas para a simulação — peça à Domus Energia para escolher quais.";
      return { info: `A ocupação simulada não precisa de automação: é o modo Férias. Escolha "Férias" no topo do separador Casa — o alarme fica armado e as luzes marcadas acendem e apagam ao acaso entre o pôr do sol (ou as 19:00) e as 23:30. ${quais}` };
    }
    case "consumo": {
      const med = aparelhos.filter((a) => a.medidor || a.v1);
      if (!med.length) return { falta: "Este modelo precisa de um aparelho com medição de consumo e ainda não tem nenhum." };
      const m = med.find((a) => /geral|quadro/.test(norm(a.nome))) ?? med[0];
      return { automacao: {
        nome: "Aviso de consumo alto",
        descricao: `Avisar quando ${m.nome} passa 3500 W durante 1 minuto, para evitar que o disjuntor dispare.`.slice(0, 200),
        categoria: "energia", ativa: true,
        quando: { tipo: "potencia", aparelho: m.id, acima_w: 3500, durante_s: 60, rearmar_w: 3200 },
        entao: [{ acao: "notificar", mensagem: "Consumo acima de 3500 W há 1 minuto. Desligue um aparelho para o disjuntor não disparar." }],
      } };
    }
    case "bom-dia": {
      const estores = canais(aparelhos, ["estore"]);
      const dimmers = canais(aparelhos, ["luz"], (a, c) => c.carga !== "perigosa");
      if (!estores.length && !dimmers.length) return { falta: "Este modelo precisa de estores ou de uma luz com brilho e ainda não tem nenhum." };
      const entao = [{ acao: "modo", modo: "casa" }];
      for (const e of estores.slice(0, 5)) entao.push({ acao: "estore", ...alvo(e), posicao: 100 });
      if (dimmers.length) {
        const l = preferir(dimmers, ["quarto"]);
        entao.push({ acao: "luz", ...alvo(l), brilho: 20 }, { acao: "esperar", s: 300 }, { acao: "luz", ...alvo(l), brilho: 70 });
      }
      return { automacao: {
        nome: "Bom dia",
        descricao: "Nos dias úteis às 07:30, desarmar o modo Noite, subir os estores e acender a luz do quarto aos poucos.",
        categoria: "rotina", ativa: true,
        quando: { tipo: "hora", hora: "07:30", dias: [1, 2, 3, 4, 5] },
        entao,
      } };
    }
    case "boa-noite": {
      const caminho = L.find((l) => /corredor|quarto/.test(norm(`${l.nome} ${l.divisao ?? ""}`)));
      const entao = L.filter((l) => l !== caminho).slice(0, 12).map((l) => ({ acao: "desligar", ...alvo(l) }));
      for (const e of canais(aparelhos, ["estore"]).slice(0, 4)) entao.push({ acao: "estore", ...alvo(e), posicao: 0 });
      if (caminho) entao.push({ acao: "ligar", ...alvo(caminho), durante_s: 180 });
      entao.push({ acao: "modo", modo: "noite", forcar: false });
      return { automacao: {
        nome: "Boa noite",
        descricao: "Ao deitar: apagar tudo menos o caminho para o quarto (3 min), fechar os estores e armar o perímetro (modo Noite).",
        categoria: "rotina", ativa: true,
        quando: { tipo: "manual" },
        entao,
      } };
    }
  }
  return { falta: "Modelo desconhecido." };
}
