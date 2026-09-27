# Simulador de orçamento — contrato (v1)

Decisões do dono:
- fica **nos dois sítios**: site público (novos clientes) e área de cliente ("Ampliar a instalação");
- planta **desenhada ou por cima de uma foto/PDF** da planta do cliente;
- o cliente indica **disjuntores e amperes**, **o que está em cada circuito**, **interruptores e sensores**, e o simulador também **conta automaticamente a partir da planta**;
- **catálogo mantido pelo CEO no painel**;
- o cliente vê uma **estimativa com intervalo** e a nota "valor final após visita técnica gratuita".

⚠️ As regras elétricas abaixo são **orientativas** (ajudam o cliente e a equipa); a solução final é sempre validada na visita por técnico habilitado.

## 1. Fluxo (site `simulador.html`, e área de cliente → "Ampliar a instalação")
1. **A casa** — tipo (moradia/apartamento/alojamento local/outro), n.º de divisões, localidade, **potência contratada** (3,45 / 4,6 / 5,75 / 6,9 / 10,35 / 13,8 / 17,25 / 20,7 kVA / "Não sei") e **ligação** (Monofásica / Trifásica / "Não sei"). Na área de cliente com código ("Ampliar a instalação") este passo é **saltado**: começa na planta, os dados da casa são opcionais (tipo por escolher) e o passo 5 mostra-os com "Editar" (volta ao passo 1).
2. **Planta** — desenhar ou carregar planta; colocar elementos (§2). Pode saltar este passo.
3. **Quadro elétrico** — circuitos (§4): amperes, tipo, o que liga cada um, quais quer inteligentes. Pré-preenchido pela planta quando possível.
4. **Divisões** — por divisão: interruptores (1–4 botões), estores, sensores de porta/janela e de movimento, luzes com brilho. Pré-preenchido pela planta.
5. **Resumo e preço** — tabela de artigos (§5), mão de obra, intervalo, plano mensal sugerido; avisos elétricos.
6. **Enviar** — nome + telefone/email → `POST /api/orcamento` com `simulacao` (§6). Na área de cliente, inclui `codigo_cliente`.
O progresso fica guardado no navegador (`localStorage`, com try/catch) para continuar mais tarde.
No passo 5, abaixo de 480 px, a tabela esconde a coluna do preço unitário (fica Qtd. e Total); o texto "Estimativa. O valor final é confirmado na visita técnica gratuita." aparece uma só vez (no cartão do total).

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
- **Contagem automática**: por divisão conta luzes, tomadas, interruptores, janelas com estore, portas de entrada (→ sensor sugerido, salvo se já houver um sensor de porta desenhado a ≤ 1,5 m), máquinas; sugere circuitos (§4) e artigos (§5). O cliente pode corrigir tudo à mão.
- **Portas e janelas na parede exterior**: uma porta, janela ou sensor de porta/janela com o centro fora de todas as divisões mas a **≤ 30 cm** de uma conta na divisão mais próxima (`divisao` = essa divisão). O painel usa a mesma regra quando o elemento não traz `divisao`.

### 2.1 Formato exato de `simulacao.planta` (partilhado pelo simulador e pelo visualizador do painel)
Coordenadas em **centímetros** a partir do canto superior esquerdo; ângulos em graus (0, 90, 180, 270).
```json
{"escala_cm": 50, "largura_cm": 2000, "altura_cm": 1500,
 "fundo": {"imagem": "data:image/jpeg;base64,...", "x_cm": 0, "y_cm": 0, "largura_cm": 2000, "opacidade": 0.5} | null,
 "divisoes": [{"id": "d1", "nome": "Sala", "x_cm": 0, "y_cm": 0, "largura_cm": 500, "altura_cm": 400}],
 "elementos": [{"id": "e1", "tipo": "luz", "x_cm": 250, "y_cm": 200, "rot": 0, "divisao": "d1", "props": {"brilho": true}}]}
```
- `tipo` ∈ porta, janela, quadro, tomada, luz, interruptor, maquina, sensor_porta, sensor_movimento (§2); `props` só com as propriedades da tabela de §2 (`entrada`, `estore`, `motorizado`, `dupla`, `brilho`, `botoes`, `modelo`, `potencia_w`).
- `divisao` = id da divisão onde o elemento está (calculado pelo centro; portas, janelas e sensores de porta/janela até 30 cm fora contam na divisão mais próxima; `null` se fora).
- Limites: ≤ 40 divisões, ≤ 400 elementos, `largura_cm`/`altura_cm` ≤ 10 000, imagem ≤ 700 KB.
- O desenho (cores, ícones) vive num módulo único **`web/simulador/planta-svg.js`** sem dependências (função `desenharPlanta(svg, planta, {soLeitura})`), que o painel **copia** para `painel/public/vendor/planta-svg.js` (o painel não carrega nada de fora).

## 3. Catálogo (painel → "Catálogo", só CEO; público só leitura em `GET /api/catalogo`)
Campos: `sku`, `nome`, `categoria` (disjuntor, interruptor, sensor, estore, tomada, luz, termostato, central, acessorio, outro), `fornecedor`, `link` (ex.: página do Alibaba), `preco_compra`, `preco_venda_iva`, `horas_instalacao`, `especificacoes` (JSON: `amperes_max`, `amperes_ajustavel`, `medicao`, `protecoes`, `rede` wifi|zigbee|4g, `botoes`, `bateria`, …), `ativo`, `visivel_cliente`.
**O público nunca vê** `preco_compra`, `fornecedor` nem `link`.
Configuração: `tarifa_hora_iva` (35 €), `margem_intervalo_pct` (15 %), `deslocacao_iva` (0 €).

**Sementes iniciais** (preços de venda **provisórios** — o CEO confirma no painel; `preco_compra` vazio quando desconhecido):
| sku | nome | categoria | fornecedor | preço compra | venda c/ IVA | horas | especificações |
|---|---|---|---|---|---|---|---|
| TONGOU-SY1-JWT | Disjuntor inteligente Wi-Fi com medição (1P+N, até 63 A) | disjuntor | Tongou/Changyou (Temu: loja Chayo) | 11,04 | 39,90 | 0,5 | amperes_max 63, medicao sim, protecoes não, rede wifi |
| TONGOU-SY2-JWT | Disjuntor inteligente Wi-Fi com medição e proteções (1–63 A ajustável) | disjuntor | Tongou/Changyou (Temu: loja Chayo) | 14,30 | 54,90 | 0,5 | amperes_ajustavel 1–63, medicao, protecoes sobrecorrente/tensão/temperatura |
| BAB-MOD-2CH | Módulo interruptor Wi-Fi 2 canais (atrás do interruptor) | interruptor | Zhouqiao (BAB Smart) | — | 24,90 | 0,5 | canais 2, rede wifi |
| BAB-CURTAIN | Módulo de estore Wi-Fi | estore | Zhouqiao (BAB Smart) | — | 29,90 | 0,75 | rede wifi |
| INT-VIDRO-1 / -2 / -3 / -4 | Interruptor de parede tátil Wi-Fi 1/2/3/4 botões | interruptor | (Temu, a definir) | — | 24,90 / 27,90 / 29,90 / 32,90 | 0,5 | botoes 1–4 |
| SENS-PORTA-WIFI | Sensor de porta/janela Wi-Fi | sensor | YFK (Temu) | 6,70 | 19,90 | 0,25 | bateria |
| SENS-PIR-WIFI | Sensor de movimento Wi-Fi | sensor | YFK (Temu) | 6,82 | 22,90 | 0,25 | bateria |
| TOMADA-WIFI | Tomada inteligente Wi-Fi com medição | tomada | Zhouqiao (BAB Smart) | — | 19,90 | 0,1 | medicao |
| DIMMER-WIFI | Regulador de luz Wi-Fi | luz | (a definir) | — | 29,90 | 0,5 | — |
| BAB-HC-T010 | Termóstato Wi-Fi ecrã tátil | termostato | Zhouqiao (BAB Smart) | 12,44–15,10 | 49,90 | 1 | rede wifi |
| SENS-AGUA-WIFI | Sensor de fuga de água Wi-Fi | sensor | YFK (Temu) | 6,80 | 24,90 | 0,25 | bateria |
| SENS-TH-WIFI | Sensor de temperatura e humidade Wi-Fi com ecrã | sensor | YFK (Temu), pack de 2 | 8,02 | 22,90 | 0,1 | bateria |
| RPI-CENTRAL | Central local Raspberry Pi (UPS, sirene) — plano Premium | central | (a definir) | — | 149,00 | 2 | — |
| QUADRO-AMPLIACAO | Ampliação do quadro (calha DIN, módulos) | acessorio | armazenista | — | 25,00 | 1 | — |

Registados como **inativos** (fora do simulador, preço de compra guardado; ver negocio/FORNECEDORES.md §3): TONGOU-SY2-JZT, TONGOU-HUB-ZB, SENS-PORTA-ZB, SENS-TH-SF, VALVULA-RADIADOR, FECHADURA-4EM1, FECHADURA-5EM1, FECHADURA-SEG.

## 4. Quadro elétrico e regras orientativas
Cada circuito: `n`, `amperes` (6, 10, 16, 20, 25, 32, 40), `tipo` (iluminacao, tomadas, maquina, misto), `nome`, `divisoes`, `itens` (`luzes`, `tomadas`, `maquinas: [{modelo, potencia_w}]`), `inteligente` (bool), `medir` (bool).
Avisos (texto simples, sem bloquear):
- Potência das máquinas do circuito > 80 % de `amperes × 230 V` → "Este circuito pode não aguentar: X W para um disjuntor de Y A." (a placa e o carregador VE não entram nesta soma).
- Iluminação: sugerir 10 A; mais de 8 pontos de luz num circuito → aviso. Tomadas: sugerir 16 A; mais de 8 tomadas num circuito → aviso.
- **Circuito próprio pelo tipo de máquina** (seja qual for a potência): máquina de lavar roupa, máquina de secar, máquina da loiça, forno, placa, termoacumulador, ar condicionado, bomba de calor e carregador VE. Frigorífico e "outra máquina": circuito próprio só com ≥ 2 000 W. Uma destas máquinas num circuito partilhado com outras cargas → aviso "deve ter um circuito próprio".
- **Placa**: potência típica 7 200 W → sugerir **32 A** e **sem aviso de sobrecarga** (simultaneidade: a placa nunca tira a potência toda ao mesmo tempo). Continua a ser carga perigosa quando inteligente.
- **Carregador VE**: 7 400 W típicos, carrega a 32 A num disjuntor de **40 A** → sugerir 40 A, **sem aviso de sobrecarga** (o carregador limita a própria corrente); disjuntor escolhido < 40 A → aviso "precisa de um disjuntor de 40 A".
- Circuito marcado inteligente → sugerir **TONGOU-SY2-JWT** se amperes ≤ 63 (com proteções); **SY1** como opção mais barata; cargas de ≥ 2 000 W marcadas como **carga perigosa** (relevante para a instalação e as automações).
- **O disjuntor inteligente substitui o disjuntor normal do circuito** (decisão do dono): o **SY2** (com proteções) substitui o disjuntor de proteção do circuito → **0 módulos novos**; o **SY1** (sem proteções) nunca o substitui → o disjuntor existente fica e o SY1 ocupa **+2 módulos**. Circuitos só com "medir" levam o SY1.
- Mais de 12 módulos novos (= 2 × n.º de SY1) → acrescentar QUADRO-AMPLIACAO (1 por cada 12 módulos a mais).
- A conta dos 80 % é feita em watts inteiros (`round(0,8 × A × 230)`: 1104, 1840, 2944, 3680, 4600, 5888, 7360 W); exatamente 80 % não avisa. Potências inválidas, negativas ou não numéricas contam 0 (na planta: potência típica do modelo).
- Na sugestão a partir da planta, as máquinas sem circuito próprio (frigorífico, outra máquina < 2 000 W) juntam-se às tomadas sem passar 80 % de 16 A (2 944 W) por circuito; se passar, abre-se outro circuito de tomadas.
- Máquina > 7 400 W → casa monofásica ou "Não sei": "acima de 7,4 kW costuma ser preciso ligação trifásica, e os disjuntores inteligentes são monofásicos (1P+N)"; casa **trifásica**: "os disjuntores inteligentes são monofásicos (1P+N), por isso esta máquina trifásica fica na proteção trifásica que já tem, sem disjuntor inteligente" (e a sugestão da planta deixa esse circuito sem inteligente/medição).
- Circuito inteligente/medido com mais de 63 A → "os disjuntores inteligentes vão até 63 A".
- Soma das máquinas de todos os circuitos > potência contratada indicada no passo 1 (kVA × 1000 W) → aviso "podem passar a potência contratada de X kVA"; com "Não sei" usa 6 900 W e diz "(costuma ser 6,9 kVA)".
- Havendo pelo menos um circuito inteligente/medido → lembrete das proteções. Com SY2: "O disjuntor inteligente substitui o disjuntor do circuito; só o fazemos se o modelo tiver certificação europeia de proteção (EN 60898) — confirmamos na visita. A instalação tem de ter diferencial de 30 mA." Com SY1: o disjuntor do circuito fica (o SY1 não tem proteções) + diferencial de 30 mA. `avisosQuadro(circuitos, {disjuntor, fases, potencia_contratada_kva})`.
Todos os avisos terminam em "(orientativo — confirmamos na visita)" e nunca bloqueiam o envio.

## 5. Preço
- Linhas: artigo × quantidade × `preco_venda_iva`; mão de obra = Σ(`horas_instalacao` × qtd) × `tarifa_hora_iva` + `deslocacao_iva`.
- Intervalo: total × (1 − margem) … total × (1 + margem), arredondado a 5 €.
- Plano mensal sugerido: com sensores/alarme → Conforto; com central Raspberry Pi → Premium; senão Base (mostrar os 3, destacar o sugerido).
- Texto fixo: "Estimativa. O valor final é confirmado na visita técnica gratuita." Preços com IVA.

## 6. Envio — `POST /api/orcamento`
Campos atuais (`nome`, `telefone`, `email`, `localidade`, `servico`, `mensagem`, `website`) + `codigo_cliente?` + `simulacao` (≤ 1 MB):
```json
{"versao": 1, "casa": {"tipo": "moradia", "divisoes": 7, "localidade": "Oeiras", "potencia_contratada_kva": 6.9, "fases": "mono"},
 "planta": {"escala_cm": 50, "largura_cm": 2000, "altura_cm": 1500, "fundo": {"imagem": "data:image/jpeg;base64,...", "x_cm": 0, "y_cm": 0, "largura_cm": 2000, "opacidade": 0.5}, "divisoes": [...], "elementos": [...]},
 "quadro": {"circuitos": [...]}, "divisoes": [...],
 "itens": [{"sku": "TONGOU-SY2-JWT", "qtd": 4, "preco_iva": 54.9}], "mao_obra": {"horas": 7.5, "valor_iva": 262.5},
 "total": {"min": 690, "max": 930}, "plano_sugerido": "conforto", "avisos": ["..."]}
```
`casa`: tudo opcional (`null` = não indicado; na área de cliente o passo 1 é saltado): `tipo` ∈ moradia, apartamento, alojamento_local, outro; `divisoes` inteiro 1–100; `localidade` ≤ 80; `potencia_contratada_kva` ∈ 3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7 (`null` = "Não sei"); `fases` ∈ `"mono"`, `"tri"` (`null` = "Não sei"). O painel valida estes campos (`painel/src/validar.js`) e mostra-os no resumo.
Cada entrada de `divisoes` (nível de topo): `{"nome": "Sala", "interruptores": [2, 1], "estores": 1, "estores_sem_motor": 0, "sensores_porta": 1, "sensores_movimento": 1, "luzes_regulaveis": 2, "tomadas_inteligentes": 0}` — `interruptores` é a lista de botões de cada interruptor (1–4).

O painel mostra a simulação no pedido de orçamento: resumo (casa, potência contratada e ligação), tabela, avisos e a planta (visualizador só leitura), com "Converter em cliente e obra" a pré-preencher os aparelhos (`domus.sh aparelho …`) e o material da obra. Os nomes escritos pelo cliente (divisões, circuitos) chegam aos pedidos sem aspas, `\`, `<` nem `>`.
O catálogo público (`GET /api/catalogo`) tem `Cache-Control: public, max-age=60`.
