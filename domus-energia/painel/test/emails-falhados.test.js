// Emails ao cliente que falharam de vez (3 tentativas; decisão do dono, 2026-10-11): ficam à vista do CEO no Início
// (contagem em resumo.tratar, lista em GET emails-falhados) até "Marcar como vistos"; só o CEO; saem com a conta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { painelComEquipa } from './ajuda.js';

let p;
before(async () => { p = await painelComEquipa(); });
after(async () => { await p.fechar(); });

const painel = (metodo, caminho, papel = 'ceo', corpo) => p.pedir(metodo, `/painel/api/${caminho}`, { cookie: p.cookies[papel], corpo });
const falha = (para, assunto, quando = '2026-10-11T10:00:00.000Z') => p.app.db.prepare('INSERT INTO emails_falhados (quando, para, assunto, erro, tentativas) VALUES (?, ?, ?, ?, 3)')
  .run(quando, para, assunto, 'tempo esgotado a ligar ao servidor SMTP');

test('lista e contagem só para o CEO; "Marcar como vistos" limpa o aviso e fica na auditoria', async () => {
  assert.equal((await painel('GET', 'resumo')).json.tratar.emails_falhados, 0);
  assert.deepEqual((await painel('GET', 'emails-falhados')).json.emails, []);
  falha('ana@exemplo.pt', 'Domus Energia: a sua proposta está pronta');
  falha('rui@exemplo.pt', 'Domus Energia: visita técnica marcada');
  assert.equal((await painel('GET', 'resumo')).json.tratar.emails_falhados, 2);
  const l = (await painel('GET', 'emails-falhados')).json.emails;
  assert.deepEqual(l.map((x) => x.para), ['rui@exemplo.pt', 'ana@exemplo.pt'], 'o mais recente primeiro');
  assert.deepEqual(Object.keys(l[0]).sort(), ['assunto', 'erro', 'id', 'para', 'quando', 'tentativas']);
  for (const papel of ['comercial', 'tecnico']) {
    assert.equal((await painel('GET', 'emails-falhados', papel)).estado, 403, papel);
    assert.equal((await painel('POST', 'emails-falhados/vistos', papel, {})).estado, 403, papel);
  }
  assert.equal((await painel('POST', 'emails-falhados/vistos', 'ceo', {})).estado, 200);
  assert.equal((await painel('GET', 'resumo')).json.tratar.emails_falhados, 0);
  assert.deepEqual((await painel('GET', 'emails-falhados')).json.emails, []);
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'emails_falhados_vistos'").get().n, 1);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM emails_falhados').get().n, 2, 'ficam guardados, só deixam de aparecer');
});

test('apagar a conta leva as falhas desse email', async () => {
  const a = await p.contaConfirmada('maria.falha@exemplo.pt');
  falha('Maria.Falha@exemplo.pt', 'Domus Energia: recebemos o seu pedido');
  falha('outra@exemplo.pt', 'Domus Energia: recebemos o seu pedido');
  const antes = p.app.db.prepare('SELECT COUNT(*) AS n FROM emails_falhados').get().n;
  const id = p.app.db.prepare('SELECT id FROM contas WHERE email = ?').get(a.email).id;
  const r = await painel('POST', `contas/${id}/apagar`, 'ceo', { email: a.email });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(p.app.db.prepare('SELECT COUNT(*) AS n FROM emails_falhados').get().n, antes - 1);
  assert.equal(p.app.db.prepare("SELECT COUNT(*) AS n FROM emails_falhados WHERE lower(para) = 'maria.falha@exemplo.pt'").get().n, 0);
});

test('cópia de segurança: sem ficheiro ou cópia boa recente não avisa; falhada ou com mais de 50 horas avisa o CEO', async () => {
  const f = join(dirname(p.config.db), 'copia.txt');
  const copia = async () => (await painel('GET', 'resumo')).json.tratar.copia;
  const ha = (h) => new Date(p.relogio.agora() - h * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.equal(await copia(), null, 'sem ficheiro');
  try {
    writeFileSync(f, `OK ${ha(5)} /root/domus-copias/domus-copia-x.tar.gz (44K; 3 pedidos na base de dados; 9 cópias guardadas)\n`);
    assert.equal(await copia(), null, 'boa e recente');
    writeFileSync(f, `OK ${ha(60)} /root/domus-copias/domus-copia-x.tar.gz (44K)\n`);
    assert.deepEqual(await copia(), { problema: 'antiga', quando: ha(60) });
    writeFileSync(f, `FALHOU ${ha(1)} a base de dados na cópia não passou a verificação (erro x)\n`);
    assert.deepEqual(await copia(), { problema: 'falhou', quando: ha(1), motivo: 'a base de dados na cópia não passou a verificação (erro x)' });
    writeFileSync(f, 'lixo\n');
    assert.equal(await copia(), null, 'linha que não se percebe');
  } finally { rmSync(f, { force: true }); }
});
