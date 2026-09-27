import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juntarAmostra, estimarDiasBateria } from '../src/saude.js';
import { motorV3, ultimoJson } from './ajuda.js';

const P = 'domus/joao';
const H = 3_600_000;
const DIA = 24 * H;
const semBateria = ['quadro', 'sala-4g', 'estore-quarto', 'led-cozinha', 'led-quarto', 'termo', 'ac-sala'];

test('amostras de bateria: uma por 6 h, janela de 14 dias, pilhas novas recomeçam', () => {
  const a = [];
  juntarAmostra(a, 0, 90);
  juntarAmostra(a, 5 * H, 89);
  assert.equal(a.length, 1);
  juntarAmostra(a, 6 * H, 89);
  assert.equal(a.length, 2);
  for (let i = 2; i < 80; i++) juntarAmostra(a, i * 6 * H, 89);
  assert.ok(a.length <= 57);
  assert.ok(a.at(-1)[0] - a[0][0] <= 14 * DIA);
  juntarAmostra(a, 80 * 6 * H, 70);
  juntarAmostra(a, 81 * 6 * H, 100); // pilhas novas
  assert.deepEqual(a, [[81 * 6 * H, 100]]);
});

test('estimativa linear dos dias de bateria', () => {
  const a = [];
  for (let d = 0; d <= 14; d++) juntarAmostra(a, d * DIA, 100 - d); // 1 %/dia
  assert.equal(estimarDiasBateria(a, 86), 86);
  assert.equal(estimarDiasBateria(a.slice(0, 2), 99), null); // poucas amostras
  assert.equal(estimarDiasBateria([[0, 50], [H, 49], [2 * H, 48]], 48), null); // menos de 2 dias
  assert.equal(estimarDiasBateria([[0, 50], [DIA, 50], [3 * DIA, 50]], 50), null); // não desce
});

test('_saude: rssi/uptime OpenBeken e Shelly, bateria, ausências como null', () => {
  const m = motorV3({ agora: '2026-06-15T10:00:30Z' });
  m.msg(`${P}/sala-4g/connected`, 'online');
  m.msg(`${P}/sala-4g/rssi`, '-61');
  m.msg(`${P}/sala-4g/uptime`, '86400');
  m.msg(`${P}/estore-quarto/online`, 'true');
  m.msg(`${P}/estore-quarto/status/wifi`, { sta_ip: '10.0.0.5', status: 'got ip', ssid: 'casa', rssi: -70 });
  m.msg(`${P}/estore-quarto/status/sys`, { uptime: 1234, ram_free: 1000 });
  m.msg(`${P}/pir-corredor/2/get`, '84');
  m.msg(`${P}/quadro/connected`, 'offline');
  m.avancar(1000);
  const s = ultimoJson(m, `${P}/_saude`);
  assert.equal(m.ultimo(`${P}/_saude`).retain, true);
  assert.deepEqual(s['sala-4g'], {
    online: true, ultima_noticia: '2026-06-15T10:00:30.000Z', rssi: -61, uptime_s: 86400, reinicios_24h: 0, bateria: null, bateria_dias: null, offline_desde: null,
  });
  assert.equal(s['estore-quarto'].rssi, -70);
  assert.equal(s['estore-quarto'].uptime_s, 1234);
  assert.equal(s['pir-corredor'].bateria, 84);
  assert.equal(s['pir-corredor'].online, true);
  assert.deepEqual([s.quadro.online, s.quadro.offline_desde], [false, '2026-06-15T10:00:30.000Z']);
  assert.deepEqual([s['led-quarto'].online, s['led-quarto'].rssi, s['led-quarto'].uptime_s], [false, null, null]);
  // Só o rssi mudou: não republica já; republica no próximo múltiplo de 5 min.
  const n = m.publicados.filter((p) => p.topico === `${P}/_saude`).length;
  m.msg(`${P}/sala-4g/rssi`, '-62');
  m.avancar(1000);
  assert.equal(m.publicados.filter((p) => p.topico === `${P}/_saude`).length, n);
  m.em('2026-06-15T10:05:00Z');
  assert.equal(ultimoJson(m, `${P}/_saude`)['sala-4g'].rssi, -62);
});

test('reinícios (descidas do uptime): reinicios_24h e aviso com mais de 5 em 24 h', () => {
  const m = motorV3({ agora: '2026-06-15T10:00:00Z' });
  let up = 1000;
  m.msg(`${P}/sala-4g/uptime`, String(up));
  for (let i = 0; i < 6; i++) {
    m.avancar(H);
    m.msg(`${P}/sala-4g/uptime`, '5'); // reiniciou
    m.msg(`${P}/sala-4g/uptime`, String((up += 10)));
  }
  m.avancar(60_000);
  const avisos = m.eventos().filter((e) => e.titulo === 'Reinícios frequentes');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].mensagem, /Interruptor sala reiniciou 6 vezes nas últimas 24 h/);
  assert.equal(ultimoJson(m, `${P}/_saude`)['sala-4g'].reinicios_24h, 6);
  m.avancar(H);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Reinícios frequentes').length, 1);
});

test('sinal fraco: rssi < -80 durante 1 h → aviso uma vez; recupera e pode voltar a avisar', () => {
  const m = motorV3({ agora: '2026-06-15T10:00:00Z' });
  m.msg(`${P}/led-quarto/rssi`, '-85');
  m.avancar(30 * 60_000);
  m.msg(`${P}/led-quarto/rssi`, '-82');
  m.avancar(29 * 60_000);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Sinal Wi-Fi fraco').length, 0);
  m.avancar(2 * 60_000);
  m.avancar(3 * H);
  const avisos = m.eventos().filter((e) => e.titulo === 'Sinal Wi-Fi fraco');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].mensagem, /LED quarto: sinal Wi-Fi fraco \(-82 dBm\) há mais de 1 h/);
  m.msg(`${P}/led-quarto/rssi`, '-60');
  m.msg(`${P}/led-quarto/rssi`, '-90');
  m.avancar(61 * 60_000);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Sinal Wi-Fi fraco').length, 2);
});

test('aparelho offline há mais de offline_min → aviso uma vez por ocorrência', () => {
  const m = motorV3({ agora: '2026-06-15T13:00:00Z' }); // 14:00 em Lisboa
  for (const id of semBateria) m.msg(`${P}/${id}/${id === 'estore-quarto' || id.startsWith('led-c') || id === 'termo' || id === 'ac-sala' ? 'online' : 'connected'}`, id === 'estore-quarto' || id.startsWith('led-c') || id === 'termo' || id === 'ac-sala' ? 'true' : 'online');
  m.limpar();
  m.msg(`${P}/led-quarto/connected`, 'offline');
  m.avancar(30 * 60_000);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Aparelho offline').length, 0);
  m.avancar(60_000);
  m.avancar(60 * 60_000);
  const avisos = m.eventos().filter((e) => e.titulo === 'Aparelho offline');
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].mensagem, 'LED quarto está offline desde 14:00.');
  m.msg(`${P}/led-quarto/connected`, 'online');
  m.msg(`${P}/led-quarto/connected`, 'offline');
  m.avancar(32 * 60_000);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Aparelho offline').length, 2);
});

test('corte de energia/internet: um aviso "Casa sem ligação", depois "sem internet de HH:MM a HH:MM" e gatilho energia_reposta', () => {
  const m = motorV3({ agora: '2026-06-15T13:00:00Z' });
  const lwt = (id, on) => {
    const shelly = ['estore-quarto', 'led-cozinha', 'termo', 'ac-sala'].includes(id);
    m.msg(`${P}/${id}/${shelly ? 'online' : 'connected'}`, shelly ? String(on) : on ? 'online' : 'offline');
  };
  for (const id of semBateria) lwt(id, true);
  m.msg(`${P}/_automacoes/set`, [{
    id: 'reposta', nome: 'Depois de um corte', quando: { tipo: 'sistema', evento: 'energia_reposta' },
    entao: [{ acao: 'desligar', aparelho: 'termo', canal: 1 }],
  }]);
  m.em('2026-06-15T13:02:00Z');
  m.limpar();
  for (const id of semBateria) lwt(id, false); // 14:02 em Lisboa
  m.em('2026-06-15T14:09:00Z');
  const casa = m.eventos().filter((e) => e.titulo === 'Casa sem ligação');
  assert.equal(casa.length, 1);
  assert.match(casa[0].mensagem, /desde 14:02 \(7 aparelhos offline\)/);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Aparelho offline').length, 0);
  m.em('2026-06-15T14:10:00Z'); // 15:10 em Lisboa
  m.limpar();
  for (const id of semBateria.slice(0, 3)) lwt(id, true);
  assert.equal(m.eventos().length, 0); // 3 de 7: ainda não
  m.avancar(30_000);
  lwt(semBateria[3], true); // 4 de 7 em menos de 2 min
  const [ev] = m.eventos().filter((e) => e.titulo === 'Ligação reposta');
  assert.equal(ev.mensagem, 'A casa esteve sem internet de 14:02 a 15:10. Os aparelhos voltaram a ligar-se.');
  assert.ok(m.comandos().includes(`${P}/termo/command/switch:0=off`));
  // Não repete com os restantes.
  for (const id of semBateria.slice(4)) lwt(id, true);
  assert.equal(m.eventos().filter((e) => e.titulo === 'Ligação reposta').length, 1);
});

test('gatilhos de sistema aparelho_offline / aparelho_online (com filtro de aparelho)', () => {
  const m = motorV3();
  m.msg(`${P}/_automacoes/set`, [
    { id: 'off', quando: { tipo: 'sistema', evento: 'aparelho_offline', aparelho: 'quadro' }, entao: [{ acao: 'notificar', mensagem: 'Quadro offline' }] },
    { id: 'on', quando: { tipo: 'sistema', evento: 'aparelho_online' }, entao: [{ acao: 'notificar', mensagem: 'Voltou' }] },
  ]);
  m.msg(`${P}/quadro/connected`, 'online');
  m.msg(`${P}/led-quarto/connected`, 'online');
  m.limpar();
  m.msg(`${P}/led-quarto/connected`, 'offline');
  assert.equal(m.eventos().length, 0);
  m.msg(`${P}/quadro/connected`, 'offline');
  assert.deepEqual(m.eventos().map((e) => e.mensagem), ['Quadro offline']);
  m.msg(`${P}/quadro/1/get`, '1'); // qualquer mensagem ao vivo = online
  assert.deepEqual(m.eventos().map((e) => e.mensagem), ['Quadro offline', 'Voltou']);
  // Valores retidos no arranque não disparam.
  m.limpar();
  m.retida(`${P}/led-quarto/connected`, 'online');
  assert.equal(m.eventos().length, 0);
});

test('pilhas a acabar: bateria_dias < 21 → aviso uma vez', () => {
  const m = motorV3({ agora: '2026-06-01T10:00:00Z' });
  let pct = 60;
  for (let i = 0; i < 20; i++) {
    m.msg(`${P}/porta-entrada/2/get`, String(pct));
    m.avancar(6 * H);
    pct -= 0.75; // 3 %/dia
  }
  const s = ultimoJson(m, `${P}/_saude`)['porta-entrada'];
  assert.ok(s.bateria_dias > 10 && s.bateria_dias < 21, `${s.bateria_dias}`);
  const avisos = m.eventos().filter((e) => e.titulo === 'Pilhas a acabar');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].mensagem, /Porta de entrada: as pilhas devem durar mais cerca de \d+ dias/);
});

test('horas de silêncio: só alarmes notificam; o evento fica no histórico', () => {
  const m = motorV3({ agora: '2026-06-15T22:30:00Z', config: { silencio: ['23:00', '07:00'] } }); // 23:30 em Lisboa
  m.msg(`${P}/_automacoes/set`, [{ id: 'n', quando: { tipo: 'sensor', aparelho: 'pir-corredor', canal: 1, valor: 1 }, entao: [{ acao: 'notificar', mensagem: 'Movimento' }] }]);
  m.msg(`${P}/pir-corredor/2/get`, '10'); // bateria fraca (aviso)
  m.msg(`${P}/pir-corredor/1/get`, '1'); // notificar
  assert.equal(m.notificacoes.length, 0);
  const hist = ultimoJson(m, `${P}/_historico`).map((e) => e.titulo);
  assert.ok(hist.includes('Bateria fraca') && hist.includes('n'));
  m.msg(`${P}/_modo/set`, { modo: 'fora' });
  m.avancar(30_000);
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.deepEqual(m.notificacoes.map((n) => n.tipo), ['alarme']);
  // Fora do silêncio volta a notificar.
  m.em('2026-06-16T06:30:00Z'); // 07:30
  m.msg(`${P}/pir-corredor/1/get`, '0');
  m.msg(`${P}/pir-corredor/1/get`, '1');
  assert.ok(m.notificacoes.some((n) => n.tipo === 'automacao'));
});

test('relatório diário às relatorio_diario: texto pt-PT por notificação (fora do histórico), respeita o silêncio', () => {
  const m = motorV3({ agora: '2026-06-15T06:58:00Z', config: { relatorio_diario: '08:00', limiar_espera_w: 5 } });
  m.msg(`${P}/quadro/connected`, 'online');
  m.msg(`${P}/quadro/1/get`, '1');
  m.msg(`${P}/quadro/power/get`, '2'); // ligado mas a gastar < 5 W → em espera
  m.msg(`${P}/quadro/energycounter/get`, '1000');
  m.msg(`${P}/quadro/energycounter/get`, '2500');
  m.msg(`${P}/sala-4g/1/get`, '1');
  m.msg(`${P}/sala-4g/3/get`, '1');
  m.msg(`${P}/janela-wc/1/get`, '1');
  m.msg(`${P}/pir-corredor/2/get`, '12');
  m.msg(`${P}/led-quarto/connected`, 'offline');
  m.limpar();
  m.em('2026-06-15T07:00:00Z'); // 08:00 em Lisboa
  const [n] = m.notificacoes.filter((x) => x.titulo === 'Relatório da casa');
  assert.equal(n.tipo, 'aviso');
  assert.equal(n.prioridade, 'default');
  assert.equal(
    n.mensagem,
    [
      'Modo Casa, alarme desarmado.',
      'Ligados (2): Teto (Sala), Varanda (Exterior).',
      'Em espera (1): Geral.',
      'Abertas (1): Janela WC.',
      'Offline (1): LED quarto.',
      'Bateria fraca (1): Movimento corredor (12 %).',
      'Consumo: hoje 1,5 kWh, ontem 0,0 kWh.',
    ].join('\n'),
  );
  assert.equal(m.eventos().some((e) => e.titulo === 'Relatório da casa'), false);
  m.em('2026-06-15T07:30:00Z');
  assert.equal(m.notificacoes.filter((x) => x.titulo === 'Relatório da casa').length, 1);
  // Relatório dentro das horas de silêncio: não é enviado.
  m.msg(`${P}/_config/set`, { relatorio_diario: '23:30', silencio: ['23:00', '07:00'] });
  m.em('2026-06-15T22:30:00Z');
  assert.equal(m.notificacoes.filter((x) => x.titulo === 'Relatório da casa').length, 1);
});
