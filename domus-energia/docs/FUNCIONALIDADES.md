# Funcionalidades da Domus Energia

Lista pedida pelo cliente (dono da empresa), comparada com o que o sistema já faz.
Legenda: ✅ feito/testado · 🔄 em construção (fase 2) · ➕ novo, a planear (fase 3)

## Recursos
| Recurso | Estado | Onde / como |
|---|---|---|
| Recebe a condição da casa inteligente | ✅ | Aparelhos publicam o estado por MQTT em tempo real (`domus/<cliente>/...`) |
| Gera o estado atual com base nas informações recebidas | 🔄 | App e site juntam tudo num modelo único (aparelhos → canais) e mostram o resumo |
| Respostas rápidas e precisas | ✅ | MQTT "push": sem esperar por atualizações periódicas; comandos confirmados pelo próprio aparelho |
| Monitorizar e controlar dispositivos | 🔄 | Interruptores 1–4 botões, luzes com brilho, estores, tomadas, disjuntores com medição |
| Facilita a automação residencial | 🔄 | Motor de automações: **Quando → Se → Então** (ver estrutura abaixo) |
| Informação em tempo real | ✅ | Potência, tensão, corrente, kWh; portas; movimento; bateria |
| Eficiência energética e segurança | 🔄 | Alerta de consumo alto, desligar por horário; modo alarme com notificações |
| Personalização | 🔄 | Automações do cliente + automações "bloqueadas" feitas pela empresa; nomes por canal |

## Benefícios
| Benefício | Estado | Como o sistema o entrega |
|---|---|---|
| Facilidade de gestão da casa | 🔄 | Uma app com separadores Casa / Automações / Histórico |
| Controlo remoto | ✅ | App Android + área de cliente web, de qualquer lugar |
| Poupança de energia e mais segurança | 🔄 | Medição por circuito, horários, alarme |
| Automatização de tarefas diárias | 🔄 | Horários (ex.: termoacumulador às 23h), sensores (luz do corredor) |
| Monitorização em tempo real | ✅ | Estado ao vivo + histórico de eventos |
| Adaptação personalizada | 🔄 | Automações e cenas por cliente |
| Respostas rápidas às condições da casa | 🔄 | O motor reage no servidor 24 h/dia, mesmo com a app fechada |
| Vida mais eficiente e confortável | 🔄 | Conjunto de tudo o acima |

## Relatório do estado da casa (Condição → Saída)
Pedido: "Insira o estado atual da casa → receba um relatório completo de todos os dispositivos."

| Ponto do relatório | Estado | Nota |
|---|---|---|
| Relatório completo de todos os aparelhos ligados | ➕ | **Novo ecrã "Relatório da casa"**: um resumo gerado a partir do estado ao vivo, por divisão: o que está ligado, aberto, offline, com bateria fraca, consumo agora e hoje. Botão "Partilhar/copiar". Também enviado por notificação de manhã (opcional). |
| Luzes ligadas/desligadas | 🔄 | Canais `interruptor` e `luz` |
| Temperatura do termóstato | ➕ | **Ainda não suportado.** Novo tipo de canal `termostato` (temperatura atual, temperatura definida, modo). Aparelhos Tuya Wi-Fi de termóstato ou Shelly H&T / Shelly BLU H&T |
| Câmaras de segurança ativadas/desativadas | ➕ | **Ainda não suportado.** Câmaras exigem vídeo (RTSP/ONVIF), não só MQTT. Proposta fase 3: mostrar estado (online, gravação ligada/desligada) e ligação para a app da câmara; vídeo ao vivo mais tarde (ex.: go2rtc no servidor) |
| Eletrodomésticos ligados, desligados ou **em espera** | ➕ | Com medição de potência: **em espera** = ligado mas abaixo de um limiar (ex.: < 5 W), configurável por aparelho. Novo estado no modelo |
| Visualização rápida do funcionamento da casa | 🔄 | Resumo no topo do separador Casa + fundo vivo do tema Terra |

## Estrutura das automações (referência: Vesternet)
A Vesternet descreve cada automação com três partes — **gatilho**, **condição**, **ação** — e começar pelo **planeamento** das tarefas repetitivas. O nosso protocolo v2 já segue esta estrutura:

| Vesternet | Domus Energia (`_automacoes`) | Exemplos |
|---|---|---|
| Gatilho | `quando` | sensor muda (porta, movimento), hora, consumo acima de X W |
| Condição | `se` | alarme ligado/desligado, entre horas |
| Ação | `entao` | ligar/desligar (com duração), estore, notificar |
| Planeamento | Ecrã de criação guiado | Modelos prontos: "Luz com movimento à noite", "Desligar tudo ao sair", "Aviso de consumo alto" |

Plano completo, a partir do artigo inteiro: **`docs/AUTOMACOES-v3.md`**. Resumo das melhorias (fase 3):
- Gatilho **presença** (telemóvel liga ao Wi-Fi de casa / sai de casa — geofence na app).
- Condição **estado de outro aparelho** (ex.: "só se a luz X estiver ligada").
- Ação **cena** (várias ações guardadas com um nome: "Cinema", "Sair de casa").
- **Testar agora** e **"última execução"** em cada automação.

Fonte: [Vesternet — How to Create Custom Smart Home Automations: A Step-by-Step Guide](https://www.vesternet.com/a/answers/5892181/How-to-make-a-smart-home-automation-system)

## Análise da comunidade (Reddit e fóruns)
Ver `docs/ANALISE-COMUNIDADE.md` (em preparação).
