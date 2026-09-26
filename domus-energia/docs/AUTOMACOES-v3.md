# Automações v3 — estrutura segundo o guia da Vesternet

Fonte: Vesternet, "Como criar automações domésticas inteligentes personalizadas: um guia passo a passo" (David Bell, 1 maio 2025) —
https://www.vesternet.com/pt-eu/blogs/casa-inteligente/como-criar-custom-smart-home-automations-por-passo-por-passo

A v2 (`PROTOCOLO-MQTT-v2.md` §3) já usa os três pilares **gatilho → condição → ação** (`quando → se → entao`). A v3 acrescenta o que o guia descreve e ainda nos falta, sem partir a v2 (tudo o que é válido na v2 continua válido).

## 1. Comparação com o guia

### Gatilhos (`quando`)
| Guia | v2 | v3 |
|---|---|---|
| Alteração de estado de aparelho (movimento, porta, interruptor) | ✅ `sensor` | + qualquer canal (ex.: interruptor ligado à mão) |
| Horários e programações recorrentes | ✅ `hora` + dias | — |
| Nascer / pôr do sol | ❌ | ➕ `sol`: `{"tipo":"sol","evento":"nascer"|"por","desvio_min":-30}` (calculado pela localização da casa) |
| Localização / geofencing (chegar, sair) | ❌ | ➕ `presenca`: `{"tipo":"presenca","evento":"chega_primeiro"|"sai_ultimo"}` — a app envia a localização/Wi-Fi de casa |
| Comandos de voz | ❌ | ➕ fase posterior (Google/Alexa); para já, através de cenas |
| Ativação manual (botão na app, comando) | ❌ | ➕ `manual`: botão "Executar" na app/site e botões físicos |
| Eventos do sistema (falha de energia, internet, reinício) | ❌ | ➕ `sistema`: `aparelho_offline`, `aparelho_online`, `energia_reposta` (todos os aparelhos voltaram após corte) |
| Estado que dura (ex.: "sem movimento há 10 min", "> 25 °C há 30 min") | ❌ | ➕ `durante_s` em qualquer gatilho de estado: `{"tipo":"sensor",...,"valor":0,"durante_s":600}` |

### Condições (`se`)
| Guia | v2 | v3 |
|---|---|---|
| Restrição de horário | ✅ `entre` | + `dias` e `sol` ("entre o pôr e o nascer do sol") |
| Estado de outros aparelhos | ❌ | ➕ `aparelhos: [{"aparelho","canal","valor"}]` |
| Modo da casa (Casa, Fora, Noite, Férias) | ❌ (só alarme on/off) | ➕ `modo: ["noite","fora"]` — ver §2 |
| Presença de pessoas | ❌ | ➕ `presenca: "alguem"|"ninguem"` |
| Fatores ambientais (temperatura, luz, humidade) | ❌ | ➕ `ambiente: {"aparelho","canal","acima"|"abaixo": n}` quando houver sensores de temperatura/luz |

### Ações (`entao`)
| Guia | v2 | v3 |
|---|---|---|
| Controlar aparelhos | ✅ ligar/desligar, estore | + `luz` com brilho, `alternar` |
| Executar cenas | ❌ | ➕ `{"acao":"cena","cena":"cinema"}` — ver §3 |
| Notificações | ✅ `notificar` | + prioridade e "silêncio noturno" |
| Atrasar operações (esperar) | ⚠️ só `durante_s` | ➕ `{"acao":"esperar","s":300}` entre ações |
| Ramificação condicional (SE… SENÃO…) | ❌ | ➕ `{"acao":"se","condicao":{...},"entao":[...],"senao":[...]}` (máx. 2 níveis) |
| Mudar modo da casa | ❌ | ➕ `{"acao":"modo","modo":"noite"}` |

## 2. Modos da casa
Substitui/estende o alarme: `domus/<c>/_modo` (retido) = `casa` | `fora` | `noite` | `ferias`.
- `fora` e `ferias` ativam o alarme automaticamente; `noite` pode ativar só portas/janelas (perímetro).
- **Férias**: simulação de presença — o motor liga/desliga luzes escolhidas em horários aleatórios à noite (exemplo "Ocupação simulada" do guia).
- Mudar de modo: app/site, cena, automação ou presença ("sai o último" → `fora`).

## 3. Cenas
`domus/<c>/_cenas` (retido): `[{"id":"cinema","nome":"Noite de cinema","acoes":[...]}]`, executadas por `domus/<c>/_cenas/executar` `{"id":"cinema"}`.
Cenas sugeridas (exemplos do guia): **Noite de cinema** (sala 20 %, apagar corredor e cozinha, baixar estores), **Bom dia** (subir estores e luz do quarto aos poucos, ligar máquina do café na tomada), **Boa noite** (apagar tudo menos o caminho para o quarto, modo noite), **Sair de casa** (apagar tudo, desligar termoacumulador, modo fora).

## 4. Assistente de criação (passos do guia na app/site)
1. **Objetivo** — escolher categoria: Conveniência · Poupança de energia · Segurança · Conforto · Rotina; escrever a frase-objetivo ("Acender a luz do corredor quando alguém passa, só à noite").
2. **Componentes** — escolher o aparelho que dispara, as condições e os aparelhos a controlar (a app só mostra os que servem).
3. **Básico** — gatilho + ação; botão **Testar agora**.
4. **Condições** — horário, sol, modo, presença, estado de aparelhos.
5. **Vários aparelhos** — sequência com esperas, cenas, SE/SENÃO.
Mais **modelos prontos** do guia: iluminação por movimento com desligar após 10 min sem movimento; chegada/saída; alerta de entrada inesperada (modo fora/noite → luzes + notificação + alarme); ocupação simulada nas férias; aviso de consumo alto; rotina bom dia; sequência boa noite.

## 5. Boas práticas do guia → regras do sistema
| Boa prática | Implementação |
|---|---|
| Começar simples | Assistente começa no básico; opções avançadas escondidas em "Mais" |
| Substituição manual | Carregar num interruptor físico ou na app **suspende** as automações desse canal durante 1 h (configurável) — a casa adapta-se à pessoa |
| Testar casos extremos (falha de energia, internet) | Estado dos relés após corte definido no firmware ("repor último estado"); gatilho `energia_reposta`; aviso "aparelho offline"; motor corre no servidor, e a fase seguinte prevê um modo local na casa |
| Documentar | Cada automação guarda `descricao` (frase-objetivo), autor (cliente/empresa) e data |
| Considerar todos os utilizadores | Várias contas por casa (fase posterior); interruptores físicos continuam sempre a funcionar |
| Rever regularmente | Ecrã mostra **última execução**, n.º de execuções na semana e automações que nunca dispararam |
| Fiabilidade antes da complexidade | Validação forte no motor; limite de 2 níveis de SE/SENÃO; máx. 20 ações |

## 6. Diagnóstico (secção "Solução de problemas" do guia)
Em cada automação, um **registo** das últimas 20 execuções com o motivo:
- "Não disparou: aparelho do gatilho offline desde 14:02"
- "Disparou mas não executou: condição 'modo = noite' falsa (modo atual: casa)"
- "Ação falhou: Interruptor sala não respondeu em 5 s"
- **Conflitos**: aviso quando duas automações mexem no mesmo canal em sentidos opostos no mesmo gatilho.
- **Zona de proteção (histerese)** nos limites: `acima_w`/`abaixo` com margem (ex.: liga a 3500 W, só rearma abaixo de 3200 W) para não disparar repetidamente perto do limite.
