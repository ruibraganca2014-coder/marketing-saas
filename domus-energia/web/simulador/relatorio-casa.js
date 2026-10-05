// Relatório grátis da casa (passo Relatório de "Descrever a minha casa"; decisão do dono, 2026-10-05): o que se tira
// da planta e das respostas, sem preços — os números da casa, se a potência contratada chega, os circuitos que a casa
// pede (o critério C1–C5 de regras.js sugerirCircuitos) e os pontos a rever. Só lógica, sem DOM.

import {
  pontosDivisao, areaPoligono, caixasDe, maquinaDaPlanta, contarPlanta, sugerirCircuitos, codigoCircuito, seccaoCabo,
  circuitoProprio, nomeModelo, TIPOS_CIRCUITO, POTENCIAS_KVA,
} from "./regras.js";
import { opcoesCircuitos, zonaHumida, gruposDiferenciais, TAMANHOS_QUADRO, FRACAO_LIVRE } from "./quadro.js";
import { AMPERES_GERAL, AMPERES_DIFERENCIAL, MODULOS_ESQUEMA, MAX_LIVRES_ORDEM } from "./quadro-desenho.js";

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const kvaTxt = (k) => `${String(k).replace(".", ",")} kVA`;
const wTxt = (w) => `${String(Math.round(w)).replace(/\B(?=(\d{3})+$)/g, " ")} W`;

/**
 * @param planta  a planta do simulador ({divisoes, elementos})
 * @param casa    estado.casa (potencia_contratada_kva, fases…)
 * @param sugeridaKva  a potência sugerida do quadro (quadro.js resumoQuadro → potencia.kva; null = acima de 41,4 kVA)
 */
export function analiseDaCasa(planta, casa, sugeridaKva) {
  const divisoes = planta?.divisoes ?? [];
  const elementos = planta?.elementos ?? [];
  const nomeDe = new Map(divisoes.map((d) => [d.id, d.nome || "Divisão"]));

  // ---- 1. Em números
  const area = divisoes.reduce((s, d) => s + areaPoligono(pontosDivisao(d)), 0) / 10_000;
  const deTipo = (t) => elementos.filter((e) => e.tipo === t);
  const tomadas = deTipo("tomada"), interruptores = deTipo("interruptor"), maquinas = deTipo("maquina");
  const inteligentes = [...tomadas, ...interruptores].filter((e) => e.props?.inteligente === true).length;
  const numeros = [
    ["Área", `${(Math.round(area * 10) / 10).toLocaleString("pt-PT")} m²`],
    ["Divisões", String(divisoes.length)],
    ["Interruptores", String(interruptores.length)],
    ["Tomadas", `${tomadas.length}${tomadas.length ? ` (${plural(tomadas.reduce((s, e) => s + caixasDe(e.props), 0), "ponto", "pontos")})` : ""}`],
    ["Máquinas e aparelhos", String(maquinas.length)],
    ["Já inteligentes", String(inteligentes)],
  ];

  // ---- 2. A potência chega?
  const contratada = POTENCIAS_KVA.includes(casa?.potencia_contratada_kva) ? casa.potencia_contratada_kva : 6.9;
  const grandes = maquinas.map((e) => maquinaDaPlanta(e.props)).filter(circuitoProprio);
  const somaGrandes = grandes.reduce((s, m) => s + m.potencia_w, 0);
  const estado = sugeridaKva === null ? "especial" : sugeridaKva === undefined ? "sem_dados" : contratada >= sugeridaKva ? "chega" : "curta";
  const potencia = {
    estado, contratada_kva: contratada, sugerida_kva: sugeridaKva ?? null,
    titulo: { chega: "A potência contratada chega", curta: "A potência contratada pode ser curta", especial: "Esta casa pede um contrato especial", sem_dados: "Potência contratada" }[estado],
    texto: [
      `Tem ${kvaTxt(contratada)} contratados${estado === "curta" ? `; para o que a casa tem sugerimos ${kvaTxt(sugeridaKva)}.` : estado === "chega" && sugeridaKva !== contratada ? `; o que a casa tem pede ${kvaTxt(sugeridaKva)}.` : "."}`,
      grandes.length ? `As ${plural(grandes.length, "máquina grande", "máquinas grandes")} (${grandes.map((m) => nomeModelo(m.modelo).toLowerCase()).join(", ")}) somam ${wTxt(somaGrandes)}${somaGrandes > contratada * 1000 ? `, mais do que os ${wTxt(contratada * 1000)} do contrato: com todas ligadas ao mesmo tempo, a luz vai abaixo.` : `; o contrato dá ${wTxt(contratada * 1000)}.`}` : null,
    ].filter(Boolean),
  };

  // ---- 3. Circuitos que a casa pede
  const brutos = sugerirCircuitos(contarPlanta({ divisoes, elementos }), opcoesCircuitos(casa));
  const circuitos = brutos.map((c) => ({
    codigo: codigoCircuito(c),
    // Nas máquinas o nome do circuito traz a divisão ("Forno, Cozinha"); aqui a divisão tem coluna própria.
    nome: c.tipo === "maquina" && c.itens?.maquinas?.length ? c.itens.maquinas.map((m) => nomeModelo(m.modelo)).join(", ") : c.nome || TIPOS_CIRCUITO[c.tipo] || "Circuito",
    divisoes: (c.divisoes ?? []).join(", "),
    disjuntor: `${c.amperes} A`,
    cabo: seccaoCabo(c.amperes) ? `${String(seccaoCabo(c.amperes)).replace(".", ",")} mm²` : "",
  }));

  // ---- 3b. O quadro que a casa pede, para desenhar (o modelo de quadro-desenho.js): o geral pela potência (a sugerida,
  // senão a contratada), um diferencial de 30 mA por grupo (quadro.js gruposDiferenciais), um disjuntor por circuito
  // logo a seguir ao seu diferencial e os módulos livres até ao tamanho de quadro com 25 % de folga.
  let esquema = null;
  if (brutos.length) {
    const kva = typeof sugeridaKva === "number" ? Math.max(sugeridaKva, contratada) : contratada;
    const amperes = (kva * 1000) / (casa?.fases === "tri" ? 690 : 230);
    const acima = (l, a) => l.find((x) => x >= a) ?? l[l.length - 1];
    const geral = acima(AMPERES_GERAL, amperes);
    const grupos = gruposDiferenciais(brutos).filter((g) => g.circuitos.length);
    const ordem = ["geral"];
    const disjuntores = [];
    grupos.forEach((g, i) => {
      ordem.push(`diferencial:${i}`);
      for (const n of g.circuitos) { ordem.push(`disjuntor:${disjuntores.length}`); disjuntores.push({ amperes: brutos.find((c) => c.n === n)?.amperes ?? 16 }); }
    });
    const ocupados = MODULOS_ESQUEMA.geral + grupos.length * MODULOS_ESQUEMA.diferencial + disjuntores.length * MODULOS_ESQUEMA.disjuntor;
    const tamanho = TAMANHOS_QUADRO.find((t) => ocupados <= Math.floor(t * (1 - FRACAO_LIVRE))) ?? TAMANHOS_QUADRO[TAMANHOS_QUADRO.length - 1];
    const livres = Math.max(0, tamanho - ocupados);
    for (let i = 0; i < Math.min(livres, MAX_LIVRES_ORDEM); i++) ordem.push("livre");
    esquema = {
      disjuntor_geral: { amperes: geral },
      diferenciais: grupos.map(() => ({ sensibilidade_ma: 30, amperes: acima(AMPERES_DIFERENCIAL, geral) })),
      disjuntores, modulos_livres: livres, estado: null, fusiveis: null, sinais_aquecimento: null, notas: "", ordem,
      tamanho,
      resumo: `Quadro de ${tamanho} módulos: disjuntor geral de ${geral} A, ${plural(grupos.length, "diferencial", "diferenciais")} de 30 mA, ${plural(disjuntores.length, "disjuntor", "disjuntores")} e ${plural(livres, "módulo livre", "módulos livres")}.`,
    };
  }

  // ---- 4. Pontos a rever (orientativos)
  const rever = [];
  for (const d of divisoes) {
    const aqui = elementos.filter((e) => e.divisao === d.id);
    const pontos = aqui.filter((e) => e.tipo === "tomada").reduce((s, e) => s + caixasDe(e.props), 0);
    const pequenas = aqui.filter((e) => e.tipo === "maquina").map((e) => maquinaDaPlanta(e.props)).filter((m) => !circuitoProprio(m)).length;
    const nome = nomeDe.get(d.id);
    if (pequenas > pontos) rever.push(`${nome}: ${plural(pequenas, "aparelho", "aparelhos")} para ${plural(pontos, "ponto de tomada", "pontos de tomada")}. Costuma acabar em extensões e fichas triplas.`);
    if (pontos > 0 && zonaHumida(nome)) rever.push(`${nome}: é zona húmida. As tomadas devem estar num circuito só para elas, com diferencial de 30 mA.`);
  }
  if (grandes.length) rever.push(`${grandes.map((m) => nomeModelo(m.modelo)).join(", ")}: ${grandes.length === 1 ? "deve ter um circuito só para ela" : "cada uma deve ter um circuito só para ela"} no quadro.`);
  if (estado === "curta") rever.push(`Potência contratada: ${kvaTxt(contratada)} para uma casa que pede ${kvaTxt(sugeridaKva)}.`);

  const semLuzes = !elementos.some((e) => e.tipo === "luz");
  return { numeros, potencia, circuitos, esquema, notaCircuitos: semLuzes ? "Falta a iluminação: os pontos de luz não se levantam nesta descrição, por isso os circuitos das luzes não aparecem aqui." : null, rever };
}
