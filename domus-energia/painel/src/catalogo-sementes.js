// Sementes do catálogo (docs/SIMULADOR-ORCAMENTO.md §3). Preços de venda
// PROVISÓRIOS: o CEO confirma-os no painel. preco_compra null = desconhecido.
// SEMENTES_CATALOGO entra na primeira vez (migração 2); SEMENTES_QUADRO (fim do ficheiro) pela migração 3,
// só com os SKUs que ainda não existem (os de SKUS_MIGRACAO_6 também pela migração 6). Depois o catálogo é do CEO.

const interruptores = [1, 2, 3, 4].map((b, i) => ({
  sku: `INT-VIDRO-${b}`,
  nome: `Interruptor de parede tátil Wi-Fi ${b} ${b === 1 ? 'botão' : 'botões'}`,
  categoria: 'interruptor',
  fornecedor: '(Temu, a definir)',
  preco_compra: null,
  preco_venda_iva: [24.9, 27.9, 29.9, 32.9][i],
  horas_instalacao: 0.5,
  especificacoes: { botoes: b, rede: 'wifi' },
}));

export const SEMENTES_CATALOGO = [
  { sku: 'TONGOU-SY1-JWT', nome: 'Disjuntor inteligente Wi-Fi com medição (1P+N, até 63 A)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou (Temu: loja Chayo)', preco_compra: 11.04, preco_venda_iva: 39.9, horas_instalacao: 0.5,
    especificacoes: { amperes_max: 63, medicao: true, protecoes: false, rede: 'wifi' } },
  { sku: 'TONGOU-SY2-JWT', nome: 'Disjuntor inteligente Wi-Fi com medição e proteções (1–63 A ajustável)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou (Temu: loja Chayo)', preco_compra: 14.3, preco_venda_iva: 54.9, horas_instalacao: 0.5,
    especificacoes: { amperes_max: 63, amperes_ajustavel: [1, 63], medicao: true, protecoes: ['sobrecorrente', 'tensao', 'temperatura'], rede: 'wifi' } },
  { sku: 'BAB-MOD-2CH', nome: 'Módulo interruptor Wi-Fi 2 canais (atrás do interruptor)', categoria: 'interruptor',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 24.9, horas_instalacao: 0.5,
    especificacoes: { canais: 2, rede: 'wifi' } },
  { sku: 'BAB-CURTAIN', nome: 'Módulo de estore Wi-Fi', categoria: 'estore',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 29.9, horas_instalacao: 0.75,
    especificacoes: { rede: 'wifi' } },
  ...interruptores,
  { sku: 'SENS-PORTA-WIFI', nome: 'Sensor de porta/janela Wi-Fi', categoria: 'sensor',
    fornecedor: 'YFK (Temu), 1 un.', preco_compra: 6.7, preco_venda_iva: 19.9, horas_instalacao: 0.25,
    especificacoes: { bateria: true, rede: 'wifi' } },
  // YFK "Sensor de deteção de segurança" Wi-Fi: confirmar que é de movimento (PIR).
  { sku: 'SENS-PIR-WIFI', nome: 'Sensor de movimento Wi-Fi', categoria: 'sensor',
    fornecedor: 'YFK (Temu)', preco_compra: 6.82, preco_venda_iva: 22.9, horas_instalacao: 0.25,
    especificacoes: { bateria: true, rede: 'wifi' } },
  { sku: 'TOMADA-WIFI', nome: 'Tomada inteligente Wi-Fi com medição', categoria: 'tomada',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 19.9, horas_instalacao: 0.1,
    especificacoes: { medicao: true, rede: 'wifi' } },
  { sku: 'DIMMER-WIFI', nome: 'Regulador de luz Wi-Fi', categoria: 'luz',
    fornecedor: '(a definir)', preco_compra: null, preco_venda_iva: 29.9, horas_instalacao: 0.5,
    especificacoes: { rede: 'wifi' } },
  // Preço de compra 12,44–15,10 €: guarda-se o valor mais alto (margem conservadora).
  { sku: 'BAB-HC-T010', nome: 'Termóstato Wi-Fi ecrã tátil', categoria: 'termostato',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: 15.1, preco_venda_iva: 49.9, horas_instalacao: 1,
    especificacoes: { rede: 'wifi' } },
  { sku: 'RPI-CENTRAL', nome: 'Central local Raspberry Pi (UPS, sirene) — plano Premium', categoria: 'central',
    fornecedor: '(a definir)', preco_compra: null, preco_venda_iva: 149, horas_instalacao: 2,
    especificacoes: {} },
  { sku: 'QUADRO-AMPLIACAO', nome: 'Ampliação do quadro (calha DIN, módulos)', categoria: 'acessorio',
    fornecedor: 'armazenista', preco_compra: null, preco_venda_iva: 25, horas_instalacao: 1,
    especificacoes: {} },
  // Acrescentados com os preços da Temu (setembro 2026), no fim para manter os ids.
  { sku: 'SENS-AGUA-WIFI', nome: 'Sensor de fuga de água Wi-Fi', categoria: 'sensor',
    fornecedor: 'YFK (Temu)', preco_compra: 6.8, preco_venda_iva: 24.9, horas_instalacao: 0.25,
    especificacoes: { bateria: true, rede: 'wifi', deteta: 'agua' } },
  // Vendido em pack de 2 (16,04 €): preço de compra por unidade.
  { sku: 'SENS-TH-WIFI', nome: 'Sensor de temperatura e humidade Wi-Fi com ecrã', categoria: 'sensor',
    fornecedor: 'YFK (Temu), pack de 2', preco_compra: 8.02, preco_venda_iva: 22.9, horas_instalacao: 0.1,
    especificacoes: { bateria: true, rede: 'wifi', mede: ['temperatura', 'humidade'] } },
  // Inativos: Zigbee precisa de gateway (o dono escolheu só Wi-Fi) e as
  // fechaduras/válvulas funcionam pela app Tuya/Bluetooth, não pela nossa
  // plataforma MQTT. Ficam registados com o preço de compra para o CEO decidir.
  { sku: 'TONGOU-SY2-JZT', nome: 'Disjuntor inteligente Zigbee com medição e proteções (1–63 A)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou (Temu: loja Chayo)', preco_compra: 20.11, preco_venda_iva: 59.9, horas_instalacao: 0.5,
    especificacoes: { amperes_max: 63, amperes_ajustavel: [1, 63], medicao: true, protecoes: ['sobrecorrente', 'tensao', 'temperatura'], rede: 'zigbee' },
    ativo: false, visivel_cliente: false },
  { sku: 'TONGOU-HUB-ZB', nome: 'Gateway Zigbee 3.0 com cabo de rede', categoria: 'central',
    fornecedor: 'Tongou (Temu: loja Chayo)', preco_compra: 27.97, preco_venda_iva: 69.9, horas_instalacao: 0.5,
    especificacoes: { rede: 'zigbee' }, ativo: false, visivel_cliente: false },
  { sku: 'SENS-PORTA-ZB', nome: 'Sensor de porta/janela Zigbee', categoria: 'sensor',
    fornecedor: 'YFK (Temu)', preco_compra: 13.92, preco_venda_iva: 24.9, horas_instalacao: 0.25,
    especificacoes: { bateria: true, rede: 'zigbee' }, ativo: false, visivel_cliente: false },
  { sku: 'SENS-TH-SF', nome: 'Sensor de temperatura e humidade sem fios (protocolo a confirmar)', categoria: 'sensor',
    fornecedor: 'YFK (Temu)', preco_compra: 10.88, preco_venda_iva: 24.9, horas_instalacao: 0.1,
    especificacoes: { bateria: true }, ativo: false, visivel_cliente: false },
  { sku: 'VALVULA-RADIADOR', nome: 'Cabeça termostática inteligente para radiador', categoria: 'termostato',
    fornecedor: 'YFK (Temu)', preco_compra: 25.04, preco_venda_iva: 59.9, horas_instalacao: 0.5,
    especificacoes: { bateria: true }, ativo: false, visivel_cliente: false },
  { sku: 'FECHADURA-4EM1', nome: 'Fechadura inteligente de puxador (impressão digital, código, cartão, app)', categoria: 'outro',
    fornecedor: 'YFK (Temu)', preco_compra: 33.02, preco_venda_iva: 119, horas_instalacao: 1.5,
    especificacoes: { rede: 'bluetooth' }, ativo: false, visivel_cliente: false },
  { sku: 'FECHADURA-5EM1', nome: 'Fechadura inteligente de puxador 5 em 1 (impressão digital, chave, cartão, código, app)', categoria: 'outro',
    fornecedor: 'YFK (Temu)', preco_compra: 35.2, preco_venda_iva: 129, horas_instalacao: 1.5,
    especificacoes: { rede: 'bluetooth' }, ativo: false, visivel_cliente: false },
  { sku: 'FECHADURA-SEG', nome: 'Fechadura inteligente de segurança', categoria: 'outro',
    fornecedor: 'YFK (Temu)', preco_compra: 64.27, preco_venda_iva: 199, horas_instalacao: 2,
    especificacoes: {}, ativo: false, visivel_cliente: false },
];

// Quadro elétrico (docs/SIMULADOR-ORCAMENTO.md §3 e §4.1): proteções, extras e caixas de quadro.
// Entram pela migração 3 (INSERT OR IGNORE): uma base já existente recebe-os sem duplicar e sem mexer
// nos artigos que o CEO já editou. Preços aprovados pelo dono (setembro 2026; o AFDD ainda provisório) — o CEO
// muda-os no painel. `funcao` diz ao simulador e ao painel o que o artigo é (não é um disjuntor
// inteligente de circuito); `modulos` = largura na calha DIN (monofásico).
const PROVISORIO = 'preço provisório — confirmar';
const caixa = (m, filas, preco, horas) => ({
  sku: `CAIXA-QUADRO-${m}`, nome: `Caixa de quadro elétrico ${m} módulos (${filas} ${filas === 1 ? 'fila' : 'filas'}, com barramentos)`,
  categoria: 'acessorio', fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: preco, horas_instalacao: horas,
  especificacoes: { funcao: 'caixa_quadro', modulos_caixa: m, filas, nota: 'as horas incluem passar os circuitos para o quadro novo' },
});
/** SKUs de SEMENTES_QUADRO acrescentados depois da migração 3: entram nas bases já existentes pela migração 6. */
export const SKUS_MIGRACAO_6 = ['MCB-4P-C'];
export const SEMENTES_QUADRO = [
  { sku: 'IDR-2P-40A-30MA', nome: 'Interruptor diferencial 2P 40 A 30 mA tipo AC', categoria: 'disjuntor',
    fornecedor: 'armazenista (Hager/Legrand/Schneider)', preco_compra: null, preco_venda_iva: 49.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'diferencial', amperes: 40, sensibilidade_ma: 30, tipo: 'AC', modulos: 2 } },
  { sku: 'RCBO-WIFI-TOSMR1', nome: 'Diferencial Wi-Fi com religação automática (RCBO Tongou TOSMR1, 30 mA)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou (a confirmar)', preco_compra: null, preco_venda_iva: 119, horas_instalacao: 0.75,
    especificacoes: { funcao: 'diferencial', wifi: true, religacao: true, sensibilidade_ma: 30, amperes_max: 40, medicao: true, rede: 'wifi', modulos: 2 } },
  { sku: 'SPD-T2-1PN-40KA', nome: 'Descarregador de sobretensões tipo 2 (1P+N, 40 kA)', categoria: 'acessorio',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 89.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'descarregador', tipo: 'T2', imax_ka: 40, modulos: 2 } },
  { sku: 'RELE-TENSAO-WIFI', nome: 'Relé de proteção de sobretensão/subtensão Wi-Fi com religação (Tongou)', categoria: 'acessorio',
    fornecedor: 'Tongou/Changyou (a confirmar)', preco_compra: null, preco_venda_iva: 59.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'rele_tensao', religacao: true, amperes_max: 63, rede: 'wifi', modulos: 2 } },
  { sku: 'AFDD-1PN-16A', nome: 'Detetor de arco elétrico AFDD com disjuntor (1P+N, 16 A)', categoria: 'disjuntor',
    fornecedor: 'armazenista (Hager/Schneider)', preco_compra: null, preco_venda_iva: 339.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'afdd', amperes: 16, com_disjuntor: true, modulos: 2, nota: PROVISORIO } },
  { sku: 'MEDIDOR-DIN-WIFI', nome: 'Medidor de energia geral Wi-Fi (calha DIN, até 63 A)', categoria: 'acessorio',
    fornecedor: 'Tongou/Changyou (a confirmar)', preco_compra: null, preco_venda_iva: 49.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'medidor_geral', medicao: true, amperes_max: 63, rede: 'wifi', modulos: 2 } },
  { sku: 'GERAL-WIFI-2P-63A', nome: 'Disjuntor geral Wi-Fi com medição e corte remoto (2P, 63 A)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou (a confirmar)', preco_compra: null, preco_venda_iva: 69.9, horas_instalacao: 0.75,
    especificacoes: { funcao: 'geral_wifi', amperes_max: 63, medicao: true, rede: 'wifi', modulos: 2 } },
  { sku: 'MCB-1PN-C', nome: 'Disjuntor 1P+N curva C (6–40 A) — quadro novo', categoria: 'disjuntor',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 21.9, horas_instalacao: 0.25,
    especificacoes: { funcao: 'disjuntor_circuito', curva: 'C', amperes: [6, 10, 16, 20, 25, 32, 40], modulos: 1 } },
  // Migração 6 (bases já existentes): o disjuntor da máquina trifásica numa casa trifásica, com quadro novo.
  { sku: 'MCB-4P-C', nome: 'Disjuntor tetrapolar 4P curva C (10–40 A) — máquina trifásica, quadro novo', categoria: 'disjuntor',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 79.9, horas_instalacao: 0.25,
    especificacoes: { funcao: 'disjuntor_tetrapolar', curva: 'C', polos: 4, amperes: [10, 16, 20, 25, 32, 40], modulos: 4 } },
  { sku: 'GERAL-2P-63A', nome: 'Disjuntor geral 2P (40–63 A) — quadro novo', categoria: 'disjuntor',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 74.9, horas_instalacao: 0.5,
    especificacoes: { funcao: 'geral', amperes: [40, 50, 63], modulos: 2 } },
  caixa(12, 1, 44.9, 3),
  caixa(18, 1, 52.9, 3.5),
  caixa(24, 2, 64.9, 4),
  caixa(36, 3, 99.9, 5),
  caixa(48, 4, 139.9, 6),
];

// Ações por aparelho (lote 7, docs/SIMULADOR-ORCAMENTO.md §0 e §3; web/simulador/acoes.js): Reparar = diagnóstico por
// avaria (a peça confirma-se na visita); Substituir uma tomada/interruptor/ponto de luz por um normal; trocar a ligação
// de uma máquina (a máquina é do cliente). Entram pela migração 10 (INSERT OR IGNORE). A troca da máquina ainda com preço provisório — o CEO
// confirma no painel. `horas_troca` (coluna nova, migração 10): as horas ao substituir; sem ela, 50 % das de instalação.
export const SEMENTES_ACOES = [
  { sku: 'DIAG-AVARIA', nome: 'Diagnóstico de avaria (por aparelho; a peça confirma-se na visita)', categoria: 'outro',
    fornecedor: null, preco_compra: null, preco_venda_iva: 25, horas_instalacao: 0.5, horas_troca: 0.5,
    especificacoes: { funcao: 'diagnostico' } },
  { sku: 'APARELHO-NORMAL', nome: 'Tomada, interruptor ou ponto de luz normal (troca)', categoria: 'outro',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 9.9, horas_instalacao: 0.5, horas_troca: 0.25,
    especificacoes: { funcao: 'aparelho_normal' } },
  { sku: 'TROCA-MAQUINA', nome: 'Ligar uma máquina no lugar da antiga (troca; a máquina é do cliente)', categoria: 'outro',
    fornecedor: null, preco_compra: null, preco_venda_iva: 0, horas_instalacao: 1, horas_troca: 0.5,
    especificacoes: { funcao: 'troca_maquina', nota: PROVISORIO } },
];

// Ronda regras (docs/SIMULADOR-ORCAMENTO.md §0 "Ronda regras"; decisões do dono de 2026-10-01). Entram pela migração 15
// (INSERT OR IGNORE; o CEO edita os preços no painel).
// - Pontos novos normais com preço fechado (material médio + mão de obra incluída): ponto de luz 45 €, tomada
//   40 €, tomada dupla 55 €, interruptor 35 €. Um ponto inteligente = o ponto + o aparelho Wi-Fi (INT-VIDRO-N, TOMADA-WIFI).
// - Tipos de comando do interruptor (web/simulador/regras.js COMANDOS): escada = o ponto + um comutador de escada por
//   interruptor (2 interruptores = 2 comutadores); inversor = o ponto + um inversor; botão de pressão = o ponto + um botão;
//   lustre = o ponto com 2 botões (sem artigo à parte). Horas de aparelhagem: 0,15 h por peça.
// - Campainha normal (máquina "campainha" na planta): a campainha com transformador + um botão de pressão.
// - Diferencial tipo A: o circuito do carregador VE usa-o sempre (RTIEBT 722.531.2.101: no mínimo tipo A).
// Ronda dinheiro (decisão 3 do dono, 2026-10-02): os pontos são artigos de PREÇO FECHADO (`especificacoes.preco_fechado`)
// — o cliente paga `preco_venda_iva` (o mesmo de sempre) e as `horas_instalacao` dizem quanta mão de obra vai lá dentro
// (horas × tarifa, para os 70 % do eletricista e os dias de obra); o material é o que sobra. Nas bases já existentes as
// horas e a marca entram pela migração 24 (HORAS_PONTOS).
export const HORAS_PONTOS = { 'PONTO-LUZ-NOVO': 0.75, 'TOMADA-NOVA': 0.6, 'TOMADA-DUPLA-NOVA': 0.75, 'TOMADA-TRIPLA-NOVA': 0.9, 'INTERRUPTOR-NOVO': 0.5 };
const ponto = (sku, nome, preco, funcao) => ({
  sku, nome, categoria: 'outro', fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: preco, horas_instalacao: HORAS_PONTOS[sku],
  especificacoes: { funcao, preco_fechado: true, nota: 'preço fechado por ponto: material e mão de obra incluídos' },
});
export const SEMENTES_PONTOS = [
  ponto('PONTO-LUZ-NOVO', 'Ponto de luz novo (tubo, cabo, caixas, ligação e mão de obra)', 45, 'ponto_luz'),
  ponto('TOMADA-NOVA', 'Tomada nova (tubo, cabo, caixa, tomada com terra e mão de obra)', 40, 'ponto_tomada'),
  ponto('TOMADA-DUPLA-NOVA', 'Tomada dupla nova (2 tomadas na mesma caixa; material e mão de obra)', 55, 'ponto_tomada_dupla'),
  ponto('INTERRUPTOR-NOVO', 'Interruptor novo (tubo, cabo, caixa, interruptor simples e mão de obra)', 35, 'ponto_interruptor'),
  { sku: 'COMUTADOR-ESCADA', nome: 'Comutador de escada (luz comandada de 2 sítios; um por interruptor)', categoria: 'outro',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 14, horas_instalacao: 0.15,
    especificacoes: { funcao: 'comutador_escada', nota: PROVISORIO } },
  { sku: 'INVERSOR', nome: 'Inversor de grupo (luz comandada de 3 ou mais sítios; um por sítio a mais)', categoria: 'outro',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 18, horas_instalacao: 0.15,
    especificacoes: { funcao: 'inversor', nota: PROVISORIO } },
  { sku: 'BOTAO-PRESSAO', nome: 'Botão de pressão (campainha, telerruptor)', categoria: 'outro',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 12, horas_instalacao: 0.15,
    especificacoes: { funcao: 'botao_pressao', nota: PROVISORIO } },
  { sku: 'CAMPAINHA', nome: 'Campainha com transformador (ligação e mão de obra; o botão à parte)', categoria: 'outro',
    fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: 39, horas_instalacao: 0.5,
    especificacoes: { funcao: 'campainha', nota: PROVISORIO } },
  { sku: 'IDR-2P-40A-30MA-A', nome: 'Interruptor diferencial 2P 40 A 30 mA tipo A (carregador VE)', categoria: 'disjuntor',
    fornecedor: 'armazenista (Hager/Legrand/Schneider)', preco_compra: null, preco_venda_iva: 45, horas_instalacao: 0.5,
    especificacoes: { funcao: 'diferencial', amperes: 40, sensibilidade_ma: 30, tipo: 'A', modulos: 2, nota: PROVISORIO } },
];
// Ronda sinalizar (decisão do dono, 2026-10-01): a tomada tripla (3 na mesma caixa; `props.caixas` = 3) — ponto novo com
// preço fechado, 65 €. Entra pela migração 20 (INSERT OR IGNORE; o CEO edita o preço no painel).
export const SEMENTES_PONTOS_20 = [
  ponto('TOMADA-TRIPLA-NOVA', 'Tomada tripla nova (3 tomadas na mesma caixa; material e mão de obra)', 65, 'ponto_tomada_tripla'),
];
// Ronda dinheiro (decisão 5 do dono, 2026-10-02): linha dedicada até 15 m, de preço fechado como os pontos. Entra sempre
// com um carregador VE novo (390 €: já com o disjuntor e o diferencial tipo A do circuito) e com qualquer outra máquina
// nova com circuito próprio (140 € ao juntá-la a uma casa que já existe; 70 € numa "Instalação nova"). Entram pela migração 24
// (INSERT OR IGNORE; o CEO edita no painel).
const linha = (sku, nome, preco, horas, funcao) => ({
  sku, nome, categoria: 'outro', fornecedor: 'armazenista (a definir)', preco_compra: null, preco_venda_iva: preco, horas_instalacao: horas,
  especificacoes: { funcao, preco_fechado: true, metros_max: 15, nota: 'preço fechado: material e mão de obra incluídos' },
});
export const SEMENTES_DINHEIRO = [
  linha('LINHA-DEDICADA-VE', 'Linha dedicada do carregador até 15 m (cabo, tubo, disjuntor, diferencial tipo A e mão de obra)', 390, 4, 'linha_dedicada_ve'),
  linha('LINHA-DEDICADA', 'Linha dedicada da máquina até 15 m (cabo, tubo e mão de obra)', 140, 1.5, 'linha_dedicada'),
  // Em "Instalação nova" (a obra já está aberta) a linha da máquina custa 70 €; a do carregador é a mesma (390 €).
  linha('LINHA-DEDICADA-NOVA', 'Linha dedicada da máquina em instalação nova, até 15 m (cabo, tubo e mão de obra)', 70, 0.75, 'linha_dedicada_nova'),
];
