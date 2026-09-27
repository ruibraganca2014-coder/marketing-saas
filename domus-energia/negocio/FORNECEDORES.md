# Fornecedores — Domus Energia

Registo de fornecedores e fabricantes analisados. Preços tal como vistos (sem IVA de importação nem portes, salvo indicação).

## 1. Shenzhen Zhouqiao Smart Technology Co., Ltd. (marca **BAB Smart**)
- **Onde:** Alibaba — https://zhouqiao.m.en.alibaba.com (loja com **6 anos** no Alibaba; o anúncio diz "10 anos de OEM").
- **Tipo:** fabricante / OEM (faz produtos com a marca do cliente). Diz ter mais de 10 patentes e mais de 10 pessoas em I&D, linha SMT, soldadura por onda e testes.
- **Ecossistema:** Tuya / Smart Life (Wi-Fi e Zigbee), Alexa e Google.
- **Certificados mostrados:** CE, FCC, RoHS (certificados de conformidade da **Anxin Testing**, Shenzhen). ⚠️ Pedir os relatórios de ensaio completos — ver "Perguntas a fazer".
- **Data da consulta:** 27/09/2026 (captura enviada pelo dono).

### Produtos e preços vistos
| Produto | Modelo | Preço (€) | Pedido mínimo | Interesse para a Domus |
|---|---|---|---|---|
| Termóstato de botão / tomada de fábrica | — | 21,31–24,87 | 2 peças | Médio (fase futura: termóstatos) |
| Termóstato programável semanal 240 V | — | 12,44–15,10 | 2 peças | Médio |
| Termóstato digital Tuya "moderno" | — | 12,44–15,10 | 2 peças | Médio |
| Termóstato "Smart Elec" | — | 10,66–13,00 (antes 13,32–16) | ? | Médio |
| Aquecedor / termóstato Zigbee (fil. piso) | — | 9,19–11,90 (antes 10,22–13) | ? | Baixo (Zigbee) |
| Válvula adaptadora RA M28/M30 × 1,5 mm (para radiador) | — | 0,18–1,78 | 200 peças | Baixo |
| Termóstato Wi-Fi Tuya ecrã tátil | HC-T010, HC-T020 | não mostrado | — | Médio |
| Termóstato Wi-Fi Tuya de botão rotativo | BAB-1439 (16 A, aquecimento elétrico) | não mostrado | — | Médio |
| Válvula termostática de radiador Zigbee | BAB-1413Pro, BAB-1413Pro-E | não mostrado | — | Baixo (Zigbee) |
| Gateway USB Tuya multimodo | BAB-M03 | não mostrado | — | Baixo (decidimos só Wi-Fi) |
| Módulo interruptor Wi-Fi 2 canais | — | não mostrado | — | **Alto** (luzes atrás do interruptor) |
| Módulo interruptor Zigbee 1 canal (2300 W) | — | não mostrado | — | Baixo |
| Módulo de estore Wi-Fi (Curtain Module) | — | não mostrado | — | **Alto** (estores) |
| Interruptor inteligente Wi-Fi (em linha) | — | não mostrado | — | Médio |
| Tomada inteligente Wi-Fi | — | não mostrado | — | **Alto** |
| Adaptador USB inteligente | — | não mostrado | — | Baixo |
| Sensor de porta/janela (2 modelos) | — | não mostrado | — | **Alto** (alarme; confirmar se é Wi-Fi) |
| Sensor de temperatura e humidade Zigbee | — | não mostrado | — | Baixo (Zigbee) |

**Não vende** (no que foi mostrado): disjuntores de calha DIN, sensores de movimento, interruptores de parede de vidro.

### Perguntas a fazer ao fornecedor (antes de encomendar)
1. **Chip Wi-Fi** de cada produto (BK7231N/T, ESP8266/ESP32, WBR3…). Só os BK7231 e ESP se podem reprogramar para o nosso sistema MQTT (OpenBeken).
2. Podem fornecer **sem firmware Tuya** ou com firmware nosso (OEM)? Ou com o **módulo em ficha** (mais fácil de reprogramar)?
3. **Declaração UE de Conformidade** e **relatórios de ensaio completos** (RED 2014/53/UE: EN 300 328, EN 301 489; segurança: EN 60669 / EN 60730 conforme o produto; RoHS). Um "certificado" de laboratório sozinho não chega.
4. Os sensores de porta são **Wi-Fi ou Zigbee**? Duração das pilhas? Tipo de pilha?
5. Preço por **10, 50 e 100** unidades; portes para Portugal; prazo de entrega; garantia e política de avarias (DOA).
6. Podem pôr a **marca Domus Energia** (OEM) e a partir de que quantidade?

### ⚠️ Ao comprar diretamente na China, a Domus Energia passa a ser o **importador** na UE
Isto traz obrigações legais (confirmar com o contabilista/advogado):
- Verificar a marcação CE e ter a **documentação técnica** e a declaração de conformidade disponíveis;
- Pôr no produto ou na embalagem o **nome e morada do importador** (Domus Energia);
- Registo como produtor de equipamentos elétricos (REEE) em Portugal e pagamento do ecovalor;
- IVA e direitos aduaneiros na importação.
Comprar a um distribuidor na UE evita a maior parte disto.

## 2. Changyou Technology (Zhejiang) Co., Ltd. (marca **Tongou**)
- **O que é:** o fabricante original do teu disjuntor **Chayo TO-Q-SY1-JWT** (a Chayo vende-o com outra marca). Identificado pelo manual de utilizador.
- **Contacto:** support@tongou.com · www.tongou.com · manuais e declaração UE em http://www.tongou.com/usermanuals
- **Declaração UE:** o fabricante declara conformidade com a Diretiva **2014/53/UE** (equipamentos de rádio).
- **Gama de disjuntores inteligentes (calha DIN, 1P+N, 90–240 V, 63 A máx.):**

| Modelo | Rede | Medição de energia | Proteções (sobrecorrente/tensão, temperatura) |
|---|---|---|---|
| TO-Q-SY1-WT | Wi-Fi | Não | Não |
| TO-Q-SY1-ZT | Zigbee | Não | Não |
| TO-Q-SY1-JWT (o teu) | Wi-Fi | **Sim** | Não |
| TO-Q-SY1-JZT | Zigbee | Sim | Não |
| TO-Q-SY2-JWT | Wi-Fi | Sim | **Sim** (corrente ajustável 1–63 A) |
| TO-Q-SY2-JZT | Zigbee | Sim | Sim |
| TO-Q-SY2-JLT-C / -E | 4G | Sim | Sim |

- **Nota:** para os clientes, o **TO-Q-SY2-JWT** é mais interessante que o SY1: tem proteção de sobrecorrente, subtensão/sobretensão e temperatura, com corrente ajustável. Ver se o OpenBeken o suporta antes de comprar.
- Também fabrica disjuntores diferenciais e magnetotérmicos (TORD4(B), TOMD6, TOMP65).

## 3. Temu (revenda)
- Disjuntor Chayo TO-Q-SY1-JWT 63 A com medição: **12,28 €** (captura do dono).
- Restantes preços: por preencher pelo dono (interruptores, sensores, estores, tomadas, luzes).
