// Pequenas ilustrações em traço (SVG feito à mão, 56 × 56) para cada função de canal.
// Só desenho fixo: nenhum dado do aparelho ou do utilizador entra no SVG.
// O estado é aplicado com classes e variáveis CSS; as animações vivem em styles.css
// e só correm com a classe `ativo` (e nunca com prefers-reduced-motion).

const DESENHOS = {
  interruptor: `
    <circle class="brilho" cx="28" cy="23" r="17"/>
    <path class="vidro" d="M20.6 31.4c-3-2.5-4.9-6.1-4.7-10C16.2 14.7 21.5 9.7 28 9.6c6.6-.1 11.9 5 12.1 11.7.1 3.9-1.7 7.6-4.7 10.1-1.4 1.2-2.2 2.9-2.2 4.8v1.2H22.8v-1.3c0-1.8-.8-3.6-2.2-4.8z"/>
    <path class="filamento" d="M24.2 36.3v-8.6l1.9-3.1 1.9 3.1 2-3.1 1.8 3.1v8.6"/>
    <path class="casquilho" d="M22.6 40.6h10.9M23.4 44.1h9.3M25.6 47.6h4.9"/>`,
  luz: `
    <g class="raios">
      <path d="M28 36.5v8"/><path d="M20.4 34.6l-4.1 6.3"/><path d="M35.6 34.6l4.2 6.2"/>
      <path d="M15.2 29.4l-6.5 2.4"/><path d="M40.8 29.4l6.4 2.5"/>
    </g>
    <path class="fio" d="M28 3.5v9.2"/>
    <path class="abajur" d="M16.6 28.2c.2-7.9 5.1-15.3 11.4-15.4 6.4-.1 11.4 7.4 11.5 15.4z"/>
    <path class="lampada" d="M24.4 28.3c.1 2.3 1.6 3.9 3.6 3.9s3.5-1.6 3.6-3.9"/>`,
  estore: `
    <rect class="vidro" x="11" y="9" width="34" height="38" rx="2"/>
    <path class="cruz" d="M28 9.5v37M11.5 28h33"/>
    <svg x="11" y="9" width="34" height="38" viewBox="0 0 34 38" overflow="hidden">
      <g class="laminas">
        <rect class="laminas-fundo" x="0" y="0" width="34" height="38"/>
        <path d="M0 4.2h34M0 8.9h34M0 13.6h34M0 18.3h34M0 23h34M0 27.7h34M0 32.4h34M0 37.1h34"/>
      </g>
    </svg>
    <path class="caixilho" d="M9.2 7.4c12.6-.4 25-.3 37.5 0 .3 13.8.4 27.3.1 41.1-12.5.3-25 .3-37.6 0-.3-13.8-.3-27.4 0-41.1z"/>
    <path class="peitoril" d="M6.5 51.2c14.3-.5 28.6-.4 43 0"/>`,
  porta: `
    <rect class="vao" x="15.5" y="9.5" width="25" height="40"/>
    <g class="folha">
      <rect class="madeira" x="15.5" y="9.5" width="25" height="40" rx="1.2"/>
      <path class="almofadas" d="M19.6 14.2h16.8v11.4H19.6zM19.6 30h16.8v14.8H19.6z"/>
      <circle class="puxador" cx="36.4" cy="29" r="1.6"/>
    </g>
    <path class="aro" d="M13.4 50.2V7.6c9.8-.3 19.5-.3 29.2 0v42.6"/>
    <path class="chao" d="M7 50.4c14-.4 28-.4 42 .1"/>`,
  movimento: `
    <g class="ondas">
      <path d="M35.2 21.3c2.4 3.9 2.4 9.5 0 13.4"/>
      <path d="M39.6 17.2c4.3 6.3 4.3 15.3 0 21.6"/>
      <path d="M44.1 13.2c6.1 8.7 6.2 21 0 29.6"/>
    </g>
    <circle class="figura" cx="20.4" cy="11.6" r="3.8"/>
    <path class="figura" d="M20.3 17.6l-1.6 12.2 4.1 6.9-.2 10.2M18.7 29.8l-4.9 7.9-3.5 1.1M20.1 20.4l5.4 5.4 4.7-.8M20.1 20.4l-6.3 3.7-1.8 5"/>`,
  bateria: `
    <rect class="nivel" x="11.5" y="21.5" width="29" height="13" rx="2"/>
    <path class="corpo" d="M9.8 17.5c10.8-.3 21.6-.3 32.4 0 1.2 0 2.2 1 2.2 2.3.2 5.5.2 10.9 0 16.4 0 1.3-1 2.3-2.2 2.3-10.8.3-21.6.3-32.4 0-1.2 0-2.2-1-2.3-2.3-.2-5.5-.2-10.9 0-16.4 0-1.3 1-2.3 2.3-2.3z"/>
    <path class="polo" d="M47.8 24.3c.3 2.5.3 4.9 0 7.4"/>`,
  medidor: `
    <circle class="pulso" cx="28" cy="28" r="19"/>
    <path class="anel" d="M28 8.8c10.7 0 19.3 8.6 19.2 19.3-.1 10.6-8.7 19.1-19.3 19.1S8.7 38.6 8.8 27.9C8.9 17.3 17.4 8.8 28 8.8z"/>
    <path class="raio" d="M30.8 13.2L19.6 30h7.7l-2.6 12.8L36.6 25h-7.9z"/>`,
  alarme: `
    <circle class="halo" cx="28" cy="27" r="19"/>
    <path class="escudo" d="M28 6.6c5.4 3.4 10.6 4.9 16.4 5.2.4 13.6-3.7 26.5-16.4 33.6C15.4 38.3 11.2 25.4 11.6 11.8 17.4 11.5 22.6 10 28 6.6z"/>
    <path class="fechadura" d="M28 22.4a3.4 3.4 0 0 0-1.6 6.4l-.8 5.7h4.8l-.8-5.7a3.4 3.4 0 0 0-1.6-6.4z"/>`,
};

export function criarIlustracao(funcao) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 56 56");
  svg.setAttribute("class", `ilus ilus-${funcao}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // Texto fixo deste ficheiro (sem dados externos).
  svg.innerHTML = DESENHOS[funcao] ?? DESENHOS.interruptor;
  return svg;
}

const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

// estado: { ativo?, brilho?, posicao?, aberto?, nivel?, potenciaW? }
export function atualizarIlustracao(svg, funcao, estado = {}) {
  const cl = svg.classList;
  switch (funcao) {
    case "interruptor":
      cl.toggle("ativo", !!estado.ativo);
      break;
    case "luz":
      cl.toggle("ativo", !!estado.ativo);
      svg.style.setProperty("--brilho", String(estado.ativo ? Math.max(0.15, pct(estado.brilho ?? 100) / 100) : 0));
      break;
    case "estore": {
      // 100 = aberto (lâminas enroladas para cima), 0 = fechado.
      const p = pct(estado.posicao ?? 0);
      svg.querySelector(".laminas").style.transform = `translateY(${(-(p / 100) * 38).toFixed(1)}px)`;
      cl.toggle("ativo", !!estado.aMexer);
      svg.dataset.posicao = String(p);
      break;
    }
    case "porta":
      cl.toggle("aberta", !!estado.aberto);
      cl.toggle("ativo", !!estado.aberto);
      break;
    case "movimento":
      cl.toggle("ativo", !!estado.ativo);
      cl.toggle("detetado", !!estado.movimento);
      break;
    case "bateria": {
      const p = pct(estado.nivel);
      svg.querySelector(".nivel").style.transform = `scaleX(${(p / 100).toFixed(2)})`;
      cl.toggle("fraca", estado.nivel != null && p < 15);
      cl.toggle("ativo", estado.nivel != null && p < 15);
      break;
    }
    case "medidor": {
      const w = Math.max(0, Number(estado.potenciaW) || 0);
      cl.toggle("ativo", w >= 1);
      // Mais consumo → pulso mais rápido (3,2 s em repouso, 0,6 s a 3500 W ou mais).
      const ritmo = 3.2 - Math.min(1, w / 3500) * 2.6;
      svg.style.setProperty("--ritmo", `${ritmo.toFixed(2)}s`);
      break;
    }
    case "alarme":
      cl.toggle("ativo", !!estado.ativo);
      break;
  }
}

// Ícones de traço 24 × 24 para os modos da casa e as cenas (texto fixo deste ficheiro).
const LUA = `<path d="M19.5 14.6A7.9 7.9 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>`;
const ICONES = {
  casa: `<path d="M3.8 11.2 12 4.4l8.2 6.8"/><path d="M6.2 9.6v10.2h11.6V9.6"/><path d="M10.2 19.8v-5h3.6v5"/>`,
  fora: `<path d="M13 4.2h6.2v15.6H13"/><path d="M3.8 12h10.4"/><path d="M10.4 8.2 14.2 12l-3.8 3.8"/>`,
  noite: LUA + `<path d="M17 4.2v2.6M15.7 5.5h2.6"/>`,
  ferias: `<rect x="4" y="8.2" width="16" height="11.4" rx="2.2"/><path d="M9 8.2V5.6c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2.6"/><path d="M8.2 8.4v11M15.8 8.4v11"/>`,
  filme: `<rect x="3.2" y="5.8" width="17.6" height="12.4" rx="2"/><path d="M7.4 5.8v12.4M16.6 5.8v12.4M3.2 10h4.2M3.2 14h4.2M16.6 10h4.2M16.6 14h4.2"/>`,
  sol: `<circle cx="12" cy="12" r="3.9"/><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4 7 7M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6"/>`,
  lua: LUA,
  porta: `<path d="M6.2 20.6V3.8h11.6v16.8"/><path d="M3.6 20.6h16.8"/><path d="M14.4 12.2h.1"/>`,
  energia: `<path d="M13.2 2.8 5.4 13.4h6l-1.2 7.8 8.4-10.8h-6.2z"/>`,
  luz: `<path d="M9.2 17.2h5.6M10.2 20.2h3.6"/><path d="M12 3.2a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.1v1.1h5.2v-1.1c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3.2z"/>`,
  estrela: `<path d="m12 3.4 2.6 5.3 5.8.9-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.9z"/>`,
};
export function criarIcone(nome) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icone-traco icone-${ICONES[nome] ? nome : "estrela"}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = ICONES[nome] ?? ICONES.estrela;
  return svg;
}
