// Aparelhos simulados (só para o lançador local): uma casa de teste com aparelhos a fingir, para experimentar a área de
// cliente (web/cliente.html) sem comprar nada. Fala o protocolo dos aparelhos OpenBeken (docs/PROTOCOLO-MQTT.md e -v2):
// publica a lista em `domus/<cliente>/_aparelhos` (retida), o estado de cada canal em `<aparelho>/<n>/get` e obedece a
// `<aparelho>/<n>/set`. Os medidores publicam potência, tensão, corrente e energia; a porta e o sensor de movimento
// mexem-se sozinhos de vez em quando.
//
//   node aparelhos-simulados.js [cliente]      (por omissão "demo"; entra-se em cliente.html com o código "demo")
//
// Precisa do lançador a correr (broker em mqtt://127.0.0.1:1883). Nunca é usado no servidor a sério.
import { createRequire } from 'node:module';

const mqtt = createRequire(new URL('../painel/', import.meta.url))('mqtt');
const CLIENTE = (process.argv[2] || 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'demo';
const BASE = `domus/${CLIENTE}`;

// A casa: o que um T2 com quadro inteligente costuma ter. `w` = potência do canal quando ligado (só para o medidor).
const APARELHOS = [
  { id: 'quadro', nome: 'Quadro geral', tipo: 'openbeken', medidor: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Geral', divisao: 'Quadro', arranque: 'ligado' }] },
  { id: 'sala-2g', nome: 'Interruptor sala', tipo: 'openbeken', canais: [
    { n: 1, funcao: 'interruptor', nome: 'Teto', divisao: 'Sala', simular: true, w: 24 },
    { n: 2, funcao: 'interruptor', nome: 'Candeeiro', divisao: 'Sala', simular: true, w: 9 }] },
  { id: 'led-cozinha', nome: 'LED cozinha', tipo: 'openbeken', canais: [{ n: 1, funcao: 'luz', nome: 'Bancada', divisao: 'Cozinha', w: 18 }] },
  { id: 'tomada-tv', nome: 'Tomada da televisão', tipo: 'openbeken', medidor: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Televisão', divisao: 'Sala', w: 95 }] },
  { id: 'termo', nome: 'Termoacumulador', tipo: 'openbeken', medidor: true, canais: [{ n: 1, funcao: 'interruptor', nome: 'Termoacumulador', divisao: 'Casa de banho', carga: 'perigosa', w: 2000 }] },
  { id: 'estore-quarto', nome: 'Estore quarto', tipo: 'openbeken', canais: [{ n: 1, funcao: 'estore', nome: 'Estore', divisao: 'Quarto' }] },
  { id: 'porta-entrada', nome: 'Porta de entrada', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'porta', nome: 'Porta de entrada', divisao: 'Entrada', entrada: true }, { n: 2, funcao: 'bateria' }] },
  { id: 'pir-corredor', nome: 'Movimento corredor', tipo: 'openbeken', bateria: true, canais: [{ n: 1, funcao: 'movimento', nome: 'Movimento', divisao: 'Corredor' }, { n: 2, funcao: 'bateria' }] },
];

// Estado de cada canal (aparelho/n → valor) e o brilho do LED.
const estado = new Map([
  ['quadro/1', 1], ['sala-2g/1', 1], ['sala-2g/2', 0], ['led-cozinha/1', 0], ['tomada-tv/1', 1], ['termo/1', 0],
  ['estore-quarto/1', 60], ['porta-entrada/1', 0], ['porta-entrada/2', 84], ['pir-corredor/1', 0], ['pir-corredor/2', 71],
]);
let brilho = 70;
const energiaWh = new Map(APARELHOS.filter((a) => a.medidor).map((a) => [a.id, a.id === 'quadro' ? 152_340 : 4_210]));

const c = mqtt.connect('mqtt://127.0.0.1:1883', { clientId: `simulado-${CLIENTE}-${process.pid}`, username: 'admin', password: 'local', reconnectPeriod: 3000 });
const pub = (topico, valor, retido = true) => c.publish(`${BASE}/${topico}`, String(valor), { retain: retido, qos: 0 });
const semW = ({ w: _w, ...canal }) => canal;

/** Potência de um aparelho com medidor: o quadro soma tudo o que está ligado (mais 60 W de base, frigorífico e router). */
function potencia(id) {
  const ligado = (a, canal) => (estado.get(`${a.id}/${canal.n}`) ? (canal.w ?? 0) * (canal.funcao === 'luz' ? brilho / 100 : 1) : 0);
  const de = (a) => a.canais.reduce((s, canal) => s + ligado(a, canal), 0);
  if (id !== 'quadro') return de(APARELHOS.find((a) => a.id === id));
  return estado.get('quadro/1') ? 60 + APARELHOS.filter((a) => a.id !== 'quadro').reduce((s, a) => s + de(a), 0) : 0;
}

function publicarMedidas() {
  for (const a of APARELHOS.filter((x) => x.medidor)) {
    const w = potencia(a.id) * (1 + (Math.random() - 0.5) * 0.04);
    const v = 230 + (Math.random() - 0.5) * 4;
    energiaWh.set(a.id, energiaWh.get(a.id) + (w * 5) / 3600);
    pub(`${a.id}/power/get`, w.toFixed(1));
    pub(`${a.id}/voltage/get`, v.toFixed(1));
    pub(`${a.id}/current/get`, (w / v).toFixed(2));
    pub(`${a.id}/energycounter/get`, energiaWh.get(a.id).toFixed(1));
  }
}

c.on('connect', () => {
  pub('_aparelhos', JSON.stringify(APARELHOS.map((a) => ({ ...a, canais: a.canais.map(semW) }))));
  for (const a of APARELHOS) {
    pub(`${a.id}/connected`, 'online');
    for (const canal of a.canais) pub(`${a.id}/${canal.n}/get`, estado.get(`${a.id}/${canal.n}`));
  }
  pub('led-cozinha/led_dimmer/get', brilho);
  publicarMedidas();
  c.subscribe([`${BASE}/+/+/set`, `${BASE}/+/led_dimmer/set`]);
  console.log(`[aparelhos simulados] casa "${CLIENTE}" com ${APARELHOS.length} aparelhos. Em http://localhost:8080/cliente.html entre com o código "${CLIENTE}" (qualquer palavra-passe).`);
});

c.on('message', (topico, corpo) => {
  const [, , id, n] = topico.split('/');
  const a = APARELHOS.find((x) => x.id === id);
  if (!a) return;
  const texto = corpo.toString().trim();
  if (n === 'led_dimmer') {
    const b = Number(texto);
    if (!Number.isFinite(b)) return;
    brilho = Math.max(0, Math.min(100, Math.round(b)));
    pub(`${id}/led_dimmer/get`, brilho);
    publicarMedidas();
    return;
  }
  const canal = a.canais.find((x) => String(x.n) === n);
  if (!canal || ['porta', 'movimento', 'bateria'].includes(canal.funcao)) return;   // os sensores não obedecem a ninguém
  const v = Number(texto);
  if (!Number.isFinite(v)) return;
  const novo = canal.funcao === 'estore' ? Math.max(0, Math.min(100, Math.round(v))) : (v ? 1 : 0);
  estado.set(`${id}/${n}`, novo);
  pub(`${id}/${n}/get`, novo);
  console.log(`[aparelhos simulados] ${a.nome}${canal.nome && canal.nome !== a.nome ? ` · ${canal.nome}` : ''}: ${canal.funcao === 'estore' ? `${novo} %` : novo ? 'ligado' : 'desligado'}`);
  publicarMedidas();
});

setInterval(publicarMedidas, 5000);
// A porta abre uns segundos de 2 em 2 minutos; o corredor deteta movimento de minuto a minuto.
const pulso = (chave, nome, cadaMs, duraMs) => setInterval(() => {
  estado.set(chave, 1); pub(`${chave}/get`, 1); console.log(`[aparelhos simulados] ${nome}`);
  setTimeout(() => { estado.set(chave, 0); pub(`${chave}/get`, 0); }, duraMs);
}, cadaMs);
pulso('porta-entrada/1', 'Porta de entrada: aberta', 120_000, 8000);
pulso('pir-corredor/1', 'Movimento no corredor', 60_000, 15_000);

c.on('error', (e) => console.error(`[aparelhos simulados] ${e.message} (o lançador local está a correr?)`));
const sair = () => { for (const a of APARELHOS) pub(`${a.id}/connected`, 'offline'); c.end(false, {}, () => process.exit(0)); };
process.on('SIGINT', sair);
process.on('SIGTERM', sair);
