// Relatório grátis da casa (passo Relatório de "Descrever a minha casa"; decisão do dono, 2026-10-05): o que se tira
// da planta e das respostas, sem preços — os números da casa, se a potência contratada chega, os circuitos que a casa
// pede (o critério C1–C5 de regras.js sugerirCircuitos) e os pontos a rever. Só lógica, sem DOM.

import {
  pontosDivisao, areaPoligono, caixasDe, maquinaDaPlanta, contarPlanta, sugerirCircuitos, codigoCircuito, seccaoCabo,
  circuitoProprio, nomeModelo, TIPOS_CIRCUITO, POTENCIAS_KVA,
} from "./regras.js";
import { opcoesCircuitos, zonaHumida, gruposDiferenciais, circuitoComAfdd, TAMANHOS_QUADRO, FRACAO_LIVRE } from "./quadro.js";
import { AMPERES_GERAL, AMPERES_DIFERENCIAL, MODULOS_ESQUEMA, MAX_LIVRES_ORDEM, CHAVES_PROTECOES_ESQUEMA, PROTECOES_ESQUEMA, CORES_CIRCUITO } from "./quadro-desenho.js";

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
  // Proteção completa (decisão do dono, 2026-10-05; quadro.js PACOTES.completo): AFDD nos circuitos dos quartos e da sala.
  const comAfdd = (c) => circuitoComAfdd(c, casa?.tipo);
  const circuitos = brutos.map((c) => ({
    codigo: codigoCircuito(c),
    // Nas máquinas o nome do circuito traz a divisão ("Forno, Cozinha"); aqui a divisão tem coluna própria.
    nome: c.tipo === "maquina" && c.itens?.maquinas?.length ? c.itens.maquinas.map((m) => nomeModelo(m.modelo)).join(", ") : c.nome || TIPOS_CIRCUITO[c.tipo] || "Circuito",
    divisoes: (c.divisoes ?? []).join(", "),
    disjuntor: `${c.amperes} A${comAfdd(c) ? " com AFDD" : ""}`,
    cabo: seccaoCabo(c.amperes) ? `${String(seccaoCabo(c.amperes)).replace(".", ",")} mm²` : "",
  }));

  // ---- 3b. O quadro que a casa pede, para desenhar (o modelo de quadro-desenho.js), com a proteção completa: o geral
  // Wi-Fi pela potência (a sugerida, senão a contratada), o descarregador, o relé de tensão e o medidor geral, um
  // diferencial de 30 mA por grupo (quadro.js gruposDiferenciais), um disjuntor por circuito logo a seguir ao seu
  // diferencial (com AFDD nos quartos e na sala) e os módulos livres até ao tamanho de quadro com 25 % de folga.
  let esquema = null;
  if (brutos.length) {
    const kva = typeof sugeridaKva === "number" ? Math.max(sugeridaKva, contratada) : contratada;
    const amperes = (kva * 1000) / (casa?.fases === "tri" ? 690 : 230);
    const acima = (l, a) => l.find((x) => x >= a) ?? l[l.length - 1];
    const geral = acima(AMPERES_GERAL, amperes);
    const grupos = gruposDiferenciais(brutos).filter((g) => g.circuitos.length);
    const protecoes = [...CHAVES_PROTECOES_ESQUEMA];
    const ordem = ["geral", ...protecoes];
    const disjuntores = [];
    // Etiqueta de cada disjuntor (só para o desenho): o código e o que serve, e a cor do tipo de circuito.
    const etiquetas = [];
    const curto = (t) => (t.length > 26 ? `${t.slice(0, 25).trimEnd()}…` : t);
    const etiquetaDe = (c) => {
      const cod = codigoCircuito(c);
      const ms = c.itens?.maquinas ?? [];
      const ds = c.divisoes ?? [];
      const nome = c.tipo === "maquina" && ms.length ? ms.map((m) => nomeModelo(m.modelo)).join(", ") : ds.length ? ds.join(", ") : (TIPOS_CIRCUITO[c.tipo] ?? "");
      return { texto: curto(`${cod ? `${cod} ` : ""}${nome}`.trim()), cor: c.tipo === "iluminacao" ? "luz" : c.tipo === "maquina" ? "maquina" : c.zona_humida ? "humida" : "tomadas" };
    };
    grupos.forEach((g, i) => {
      ordem.push(`diferencial:${i}`);
      for (const n of g.circuitos) {
        const c = brutos.find((x) => x.n === n);
        ordem.push(`disjuntor:${disjuntores.length}`);
        disjuntores.push({ amperes: c?.amperes ?? 16, ...(c && comAfdd(c) ? { afdd: true } : {}) });
        etiquetas.push(c ? etiquetaDe(c) : null);
      }
    });
    const nAfdd = disjuntores.filter((d) => d.afdd).length;
    const ocupados = MODULOS_ESQUEMA.geral + protecoes.reduce((s, p) => s + MODULOS_ESQUEMA[p], 0) + grupos.length * MODULOS_ESQUEMA.diferencial
      + nAfdd * MODULOS_ESQUEMA.afdd + (disjuntores.length - nAfdd) * MODULOS_ESQUEMA.disjuntor;
    const tamanho = TAMANHOS_QUADRO.find((t) => ocupados <= Math.floor(t * (1 - FRACAO_LIVRE))) ?? TAMANHOS_QUADRO[TAMANHOS_QUADRO.length - 1];
    const livres = Math.max(0, tamanho - ocupados);
    for (let i = 0; i < Math.min(livres, MAX_LIVRES_ORDEM); i++) ordem.push("livre");
    esquema = {
      disjuntor_geral: { amperes: geral, wifi: true },
      diferenciais: grupos.map(() => ({ sensibilidade_ma: 30, amperes: acima(AMPERES_DIFERENCIAL, geral) })),
      disjuntores, modulos_livres: livres, estado: null, fusiveis: null, sinais_aquecimento: null, notas: "", protecoes, ordem,
      tamanho, etiquetas, fila_por_diferencial: true,
      // O que é cada peça, em português simples, e as cores dos circuitos que este quadro tem.
      legenda: [
        ["Geral Wi-Fi", "Desliga a casa toda. Também se desliga e se vê o consumo pelo telemóvel."],
        ["Descarregador", "Protege os aparelhos dos picos de tensão, como os das trovoadas."],
        ["Relé de tensão", "Corta a casa se a tensão da rede sair do normal e volta a ligar quando normaliza."],
        ["Medidor", "Mostra na app quanto a casa está a gastar, hora a hora."],
        ["Diferencial de 30 mA", "Protege as pessoas de choques elétricos. Cada um guarda os disjuntores da sua fila."],
        ["Disjuntor", "Protege o cabo de um circuito. O número são os amperes; por baixo está o que ele serve."],
        ...(nAfdd ? [["AFDD", "Deteta faíscas em cabos e fichas estragados antes de haver incêndio. Vai nos quartos e na sala."]] : []),
      ],
      cores: Object.keys(CORES_CIRCUITO).filter((k) => etiquetas.some((e) => e?.cor === k)).map((k) => [k, CORES_CIRCUITO[k]]),
      resumo: `Quadro de ${tamanho} módulos, com proteção completa: disjuntor geral Wi-Fi de ${geral} A, descarregador de sobretensões, proteção de sobretensão e subtensão, medidor de energia, ${plural(grupos.length, "diferencial", "diferenciais")} de 30 mA, ${plural(disjuntores.length, "disjuntor", "disjuntores")}${nAfdd ? ` (${nAfdd} com AFDD)` : ""} e ${plural(livres, "módulo livre", "módulos livres")}.`,
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

/**
 * O que falta ao quadro existente (o esquema desenhado pelo eletricista: quadro-desenho.js) para chegar ao quadro ideal
 * da casa (analiseDaCasa → esquema). Decisão do dono (2026-10-05): o eletricista adapta o que lá está ao ideal.
 * Devolve {falta: string[], cabe: boolean|null, modulos: {precisos, livres}} — `cabe` null se não se sabe quantos
 * módulos livres o quadro tem. Sem quadro existente desenhado devolve null.
 */
export function diferencasQuadro(existente, ideal) {
  if (!existente || !ideal) return null;
  const falta = [];
  const contar = (l) => { const m = new Map(); for (const a of l) m.set(a, (m.get(a) ?? 0) + 1); return m; };
  if (existente.fusiveis === true) falta.push("Tem fusíveis: trocar por disjuntores.");
  const gE = existente.disjuntor_geral?.amperes ?? null, gI = ideal.disjuntor_geral?.amperes ?? null;
  if (gI && !existente.disjuntor_geral) falta.push(`Disjuntor geral de ${gI} A (não tem, ou não se vê).`);
  else if (gI && gE && gE < gI) falta.push(`Disjuntor geral: trocar o de ${gE} A por um de ${gI} A${ideal.disjuntor_geral.wifi ? " Wi-Fi" : ""}.`);
  else if (ideal.disjuntor_geral?.wifi && existente.disjuntor_geral && !existente.disjuntor_geral.wifi) falta.push("Disjuntor geral: trocar por um Wi-Fi.");
  const faltamProt = (ideal.protecoes ?? []).filter((p) => !(existente.protecoes ?? []).includes(p));
  for (const p of faltamProt) falta.push(`${PROTECOES_ESQUEMA[p].nome}.`);
  const d30 = (existente.diferenciais ?? []).filter((d) => d.sensibilidade_ma === 30).length;
  const dI = (ideal.diferenciais ?? []).length;
  const faltamDif = Math.max(0, dI - d30);
  if (faltamDif) falta.push(`${plural(faltamDif, "diferencial", "diferenciais")} de 30 mA (tem ${d30}, a casa pede ${dI}).`);
  const tem = contar((existente.disjuntores ?? []).map((d) => d.amperes).filter(Boolean));
  const quer = contar((ideal.disjuntores ?? []).map((d) => d.amperes));
  let faltamDisj = 0;
  const porAmperes = [];
  for (const [a, n] of [...quer].sort((x, y) => x[0] - y[0])) {
    const f = n - (tem.get(a) ?? 0);
    if (f > 0) { faltamDisj += f; porAmperes.push(`${f} de ${a} A`); }
  }
  if (faltamDisj) falta.push(`${plural(faltamDisj, "disjuntor", "disjuntores")}: ${porAmperes.join(", ")}.`);
  // AFDD: cada um que falta ocupa mais um módulo do que o disjuntor simples.
  const afddDe = (l) => (l.disjuntores ?? []).filter((d) => d.afdd === true).length;
  const faltamAfdd = Math.max(0, afddDe(ideal) - afddDe(existente));
  if (faltamAfdd) falta.push(`AFDD em ${plural(faltamAfdd, "circuito", "circuitos")} (quartos e sala): tem ${afddDe(existente)}, a casa pede ${afddDe(ideal)}.`);
  const precisos = faltamDif * 2 + faltamDisj + faltamAfdd + faltamProt.length * 2;
  const livres = Number.isInteger(existente.modulos_livres) ? existente.modulos_livres : null;
  const cabe = precisos === 0 ? true : livres === null ? null : livres >= precisos;
  if (precisos > 0) {
    falta.push(cabe === null ? `São precisos ${plural(precisos, "módulo", "módulos")}: confirmar os módulos livres do quadro.`
      : cabe ? `Cabe no quadro: são precisos ${plural(precisos, "módulo", "módulos")} e há ${livres} livres.`
        : `Não cabe: são precisos ${plural(precisos, "módulo", "módulos")} e só há ${livres} livres. Quadro novo de ${ideal.tamanho} módulos, ou um quadro ao lado.`);
  }
  return { falta, cabe, modulos: { precisos, livres } };
}
