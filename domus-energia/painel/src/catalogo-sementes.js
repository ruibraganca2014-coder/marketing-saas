// Sementes do catálogo (docs/SIMULADOR-ORCAMENTO.md §3). Preços de venda
// PROVISÓRIOS: o CEO confirma-os no painel. preco_compra null = desconhecido.
// Só são inseridas na primeira vez (migração 2); depois o catálogo é do CEO.

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
    fornecedor: 'Tongou/Changyou (Temu: Chayo)', preco_compra: 12.28, preco_venda_iva: 39.9, horas_instalacao: 0.5,
    especificacoes: { amperes_max: 63, medicao: true, protecoes: false, rede: 'wifi' } },
  { sku: 'TONGOU-SY2-JWT', nome: 'Disjuntor inteligente Wi-Fi com medição e proteções (1–63 A ajustável)', categoria: 'disjuntor',
    fornecedor: 'Tongou/Changyou', preco_compra: null, preco_venda_iva: 54.9, horas_instalacao: 0.5,
    especificacoes: { amperes_max: 63, amperes_ajustavel: [1, 63], medicao: true, protecoes: ['sobrecorrente', 'tensao', 'temperatura'], rede: 'wifi' } },
  { sku: 'BAB-MOD-2CH', nome: 'Módulo interruptor Wi-Fi 2 canais (atrás do interruptor)', categoria: 'interruptor',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 24.9, horas_instalacao: 0.5,
    especificacoes: { canais: 2, rede: 'wifi' } },
  { sku: 'BAB-CURTAIN', nome: 'Módulo de estore Wi-Fi', categoria: 'estore',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 29.9, horas_instalacao: 0.75,
    especificacoes: { rede: 'wifi' } },
  ...interruptores,
  { sku: 'SENS-PORTA-WIFI', nome: 'Sensor de porta/janela Wi-Fi', categoria: 'sensor',
    fornecedor: 'Zhouqiao (BAB Smart)', preco_compra: null, preco_venda_iva: 19.9, horas_instalacao: 0.25,
    especificacoes: { bateria: true, rede: 'wifi' } },
  { sku: 'SENS-PIR-WIFI', nome: 'Sensor de movimento Wi-Fi', categoria: 'sensor',
    fornecedor: '(a definir)', preco_compra: null, preco_venda_iva: 22.9, horas_instalacao: 0.25,
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
];
