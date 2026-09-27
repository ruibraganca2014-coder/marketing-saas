# Simulador de orçamento — contrato (v1)

Decisões do dono:
- fica **nos dois sítios**: site público (novos clientes) e área de cliente ("Ampliar a instalação");
- planta **desenhada ou por cima de uma foto/PDF** da planta do cliente;
- o cliente indica **disjuntores e amperes**, **o que está em cada circuito**, **interruptores e sensores**, e o simulador também **conta automaticamente a partir da planta**;
- **catálogo mantido pelo CEO no painel**;
- o cliente vê uma **estimativa com intervalo** e a nota "valor final após visita técnica gratuita".

⚠️ As regras elétricas abaixo são **orientativas** (ajudam o cliente e a equipa); a solução final é sempre validada na visita por técnico habilitado.

## 1. Fluxo (site `simulador.html`, e área de cliente → "Ampliar a instalação")
1. **A casa** — tipo (moradia/apartamento/alojamento local/outro), n.º de divisões, localidade.
2. **Planta** — desenhar ou carregar planta; colocar elementos (§2). Pode saltar este passo.
3. **Quadro elétrico** — circuitos (§4): amperes, tipo, o que liga cada um, quais quer inteligentes. Pré-preenchido pela planta quando possível.
4. **Divisões** — por divisão: interruptores (1–4 botões), estores, sensores de porta/janela e de movimento, luzes com brilho. Pré-preenchido pela planta.
5. **Resumo e preço** — tabela de artigos (§5), mão de obra, intervalo, plano mensal sugerido; avisos elétricos.
6. **Enviar** — nome + telefone/email → `POST /api/orcamento` com `simulacao` (§6). Na área de cliente, inclui `codigo_cliente`.
O progresso fica guardado no navegador (`localStorage`, com try/catch) para continuar mais tarde.

## 2. Planta
- Editor em SVG, quadriculado de **50 cm**, zoom e deslocamento; funciona com toque (telemóvel) e rato.
- **Fundo opcional**: foto (JPG/PNG) ou PDF (1.ª página renderizada com pdf.js, carregado de cdn.jsdelivr.net) → reduzido a ≤ 1600 px, JPEG, ≤ 700 KB; opacidade e escala ajustáveis (calibração: o cliente marca uma parede e diz o comprimento em metros).
- **Divisões**: retângulos com nome (Sala, Cozinha, Quarto 1, WC, Corredor, Garagem, Exterior…), arrastar e redimensionar.
- **Elementos** (ícones Terra), com rotação quando faz sentido:
  | Elemento | `tipo` | Propriedades |
  |---|---|---|
  | Porta | `porta` | `entrada` (porta da rua) |
  | Janela | `janela` | `estore` (sim/não, motorizado) |
  | Quadro elétrico | `quadro` | — |
  | Tomada | `tomada` | `dupla` |
  | Ponto de luz | `luz` | `brilho` (regulável) |
  | Interruptor | `interruptor` | `botoes` 1–4 |
  | Máquina / eletrodoméstico | `maquina` | `modelo` ∈ termoacumulador, ar_condicionado, placa, forno, maquina_lavar, maquina_secar, maquina_loica, frigorifico, bomba_calor, carregador_ve, outro; `potencia_w` (valor típico pré-preenchido, editável) |
  | Sensor de porta/janela | `sensor_porta` | — |
  | Sensor de movimento | `sensor_movimento` | — |
- **Contagem automática**: por divisão conta luzes, tomadas, interruptores, janelas com estore, portas de entrada (→ sensor sugerido), máquinas; sugere circuitos (§4) e artigos (§5). O cliente pode corrigir tudo à mão.

### 2.1 Formato exato de `simulacao.planta` (partilhado pelo simulador e pelo visualizador do painel)
Coordenadas em **centímetros** a partir do canto superior esquerdo; ângulos em graus (0, 90, 180, 270).
```json
{"escala_cm": 50, "largura_cm": 2000, "altura_cm": 1500,
 "fundo": {"imagem": "data:image/jpeg;base64,...", "x_cm": 0, "y_cm": 0, "largura_cm": 2000, "opacidade": 0.5} | null,
 "divisoes": [{"id": "d1", "nome": "Sala", "x_cm": 0, "y_cm": 0, "largura_cm": 500, "altura_cm": 400}],
 "elementos": [{"id": "e1", "tipo": "luz", "x_cm": 250, "y_cm": 200, "rot": 0, "divisao": "d1", "props": {"brilho": true}}]}
```
- `tipo` ∈ porta, janela, quadro, tomada, luz, interruptor, maquina, sensor_porta, sensor_movimento (§2); `props` só com as propriedades da tabela de §2 (`entrada`, `estore`, `motorizado`, `dupla`, `brilho`, `botoes`, `modelo`, `potencia_w`).
- `divisao` = id da divisão onde o elemento está (calculado pelo centro; `null` se fora).
- Limites: ≤ 40 divisões, ≤ 400 elementos, `largura_cm`/`altura_cm` ≤ 10 000, imagem ≤ 700 KB.
- O desenho (cores, ícones) vive num módulo único **`web/simulador/planta-svg.js`** sem dependências (função `desenharPlanta(svg, planta, {soLeitura})`), que o painel **copia** para `painel/public/vendor/planta-svg.js` (o painel não carrega nada de fora).

## 3. Catálogo (painel → "Catálogo", só CEO; público só leitura em `GET /api/catalogo`)
Campos: `sku`, `nome`, `categoria` (disjuntor, interruptor, sensor, estore, tomada, luz, termostato, central, acessorio, outro), `fornecedor`, `link` (ex.: página do Alibaba), `preco_compra`, `preco_venda_iva`, `horas_instalacao`, `especificacoes` (JSON: `amperes_max`, `amperes_ajustavel`, `medicao`, `protecoes`, `rede` wifi|zigbee|4g, `botoes`, `bateria`, …), `ativo`, `visivel_cliente`.
**O público nunca vê** `preco_compra`, `fornecedor` nem `link`.
Configuração: `tarifa_hora_iva` (35 €), `margem_intervalo_pct` (15 %), `deslocacao_iva` (0 €).

**Sementes iniciais** (preços de venda **provisórios** — o CEO confirma no painel; `preco_compra` vazio quando desconhecido):
| sku | nome | categoria | fornecedor | preço compra | venda c/ IVA | horas | especificações |
|---|---|---|---|---|---|---|---|
| TONGOU-SY1-JWT | Disjuntor inteligente Wi-Fi com medição (1P+N, até 63 A) | disjuntor | Tongou/Changyou (Temu: Chayo) | 12,28 | 39,90 | 0,5 | amperes_max 63, medicao sim, protecoes não, rede wifi |
| TONGOU-SY2-JWT | Disjuntor inteligente Wi-Fi com medição e proteções (1–63 A ajustável) | disjuntor | Tongou/Changyou | — | 54,90 | 0,5 | amperes_ajustavel 1–63, medicao, protecoes sobrecorrente/tensão/temperatura |
| BAB-MOD-2CH | Módulo interruptor Wi-Fi 2 canais (atrás do interruptor) | interruptor | Zhouqiao (BAB Smart) | — | 24,90 | 0,5 | canais 2, rede wifi |
| BAB-CURTAIN | Módulo de estore Wi-Fi | estore | Zhouqiao (BAB Smart) | — | 29,90 | 0,75 | rede wifi |
| INT-VIDRO-1 / -2 / -3 / -4 | Interruptor de parede tátil Wi-Fi 1/2/3/4 botões | interruptor | (Temu, a definir) | — | 24,90 / 27,90 / 29,90 / 32,90 | 0,5 | botoes 1–4 |
| SENS-PORTA-WIFI | Sensor de porta/janela Wi-Fi | sensor | Zhouqiao (BAB Smart) | — | 19,90 | 0,25 | bateria |
| SENS-PIR-WIFI | Sensor de movimento Wi-Fi | sensor | (a definir) | — | 22,90 | 0,25 | bateria |
| TOMADA-WIFI | Tomada inteligente Wi-Fi com medição | tomada | Zhouqiao (BAB Smart) | — | 19,90 | 0,1 | medicao |
| DIMMER-WIFI | Regulador de luz Wi-Fi | luz | (a definir) | — | 29,90 | 0,5 | — |
| BAB-HC-T010 | Termóstato Wi-Fi ecrã tátil | termostato | Zhouqiao (BAB Smart) | 12,44–15,10 | 49,90 | 1 | rede wifi |
| RPI-CENTRAL | Central local Raspberry Pi (UPS, sirene) — plano Premium | central | (a definir) | — | 149,00 | 2 | — |
| QUADRO-AMPLIACAO | Ampliação do quadro (calha DIN, módulos) | acessorio | armazenista | — | 25,00 | 1 | — |

## 4. Quadro elétrico e regras orientativas
Cada circuito: `n`, `amperes` (6, 10, 16, 20, 25, 32, 40), `tipo` (iluminacao, tomadas, maquina, misto), `nome`, `divisoes`, `itens` (`luzes`, `tomadas`, `maquinas: [{modelo, potencia_w}]`), `inteligente` (bool), `medir` (bool).
Avisos (texto simples, sem bloquear):
- Potência das máquinas do circuito > 80 % de `amperes × 230 V` → "Este circuito pode não aguentar: X W para um disjuntor de Y A."
- Iluminação: sugerir 10 A; mais de 8 pontos de luz num circuito → aviso. Tomadas: sugerir 16 A; mais de 8 tomadas num circuito → aviso. Máquinas de ≥ 2 000 W (termoacumulador, placa, forno, AC, carregador VE) → sugerir circuito próprio.
- Circuito marcado inteligente → sugerir **TONGOU-SY2-JWT** se amperes ≤ 63 (com proteções); **SY1** como opção mais barata; cargas de ≥ 2 000 W marcadas como **carga perigosa** (relevante para a instalação e as automações).
- Mais de 12 módulos novos → acrescentar QUADRO-AMPLIACAO.
Todos os avisos terminam em "(orientativo — confirmamos na visita)".

## 5. Preço
- Linhas: artigo × quantidade × `preco_venda_iva`; mão de obra = Σ(`horas_instalacao` × qtd) × `tarifa_hora_iva` + `deslocacao_iva`.
- Intervalo: total × (1 − margem) … total × (1 + margem), arredondado a 5 €.
- Plano mensal sugerido: com sensores/alarme → Conforto; com central Raspberry Pi → Premium; senão Base (mostrar os 3, destacar o sugerido).
- Texto fixo: "Estimativa. O valor final é confirmado na visita técnica gratuita." Preços com IVA.

## 6. Envio — `POST /api/orcamento`
Campos atuais (`nome`, `telefone`, `email`, `localidade`, `servico`, `mensagem`, `website`) + `codigo_cliente?` + `simulacao` (≤ 1 MB):
```json
{"versao": 1, "casa": {"tipo": "moradia", "divisoes": 7, "localidade": "Oeiras"},
 "planta": {"escala_cm": 50, "largura_cm": 2000, "altura_cm": 1500, "fundo": {"imagem": "data:image/jpeg;base64,...", "x_cm": 0, "y_cm": 0, "largura_cm": 2000, "opacidade": 0.5}, "divisoes": [...], "elementos": [...]},
 "quadro": {"circuitos": [...]}, "divisoes": [...],
 "itens": [{"sku": "TONGOU-SY2-JWT", "qtd": 4, "preco_iva": 54.9}], "mao_obra": {"horas": 7.5, "valor_iva": 262.5},
 "total": {"min": 690, "max": 930}, "plano_sugerido": "conforto", "avisos": ["..."]}
```
Cada entrada de `divisoes` (nível de topo): `{"nome": "Sala", "interruptores": [2, 1], "estores": 1, "estores_sem_motor": 0, "sensores_porta": 1, "sensores_movimento": 1, "luzes_regulaveis": 2, "tomadas_inteligentes": 0}` — `interruptores` é a lista de botões de cada interruptor (1–4).

O painel mostra a simulação no pedido de orçamento: resumo, tabela, avisos e a planta (visualizador só leitura), com "Converter em cliente e obra" a pré-preencher os aparelhos (`domus.sh aparelho …`) e o material da obra.
