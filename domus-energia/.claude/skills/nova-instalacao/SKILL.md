---
name: nova-instalacao
description: Transforma um orçamento aceite da Domus Energia na preparação completa da obra - comandos domus.sh para criar o cliente e os aparelhos, configuração de cada aparelho, checklist da obra e documento de entrega ao cliente. Usa quando o utilizador disser que um orçamento foi aceite ou pedir para preparar uma instalação.
---

# Nova instalação

Entrada: o orçamento (`negocio/orcamentos/…docx` ou texto) e, se existir, a lista de divisões/circuitos da visita.

## 1. Confirmar (uma pergunta de cada vez, só o que falta)
- Código de cliente (`[a-z0-9-]+`, ex.: apelido-localidade) e se já existe.
- Para cada aparelho: id, tipo (`openbeken` | `shelly`), divisão, canais e funções.
- Quais portas são de **entrada** (atraso do alarme), que luzes entram na **simulação de férias**, que cargas são **perigosas**, e o estado depois de um corte de luz (por omissão `desligado`; `ultimo` só em luzes).

## 2. Gerar os comandos (sintaxe em `servidor/domus.sh --help` e `servidor/README.md`)
```bash
./domus.sh cliente <codigo>
./domus.sh aparelho <codigo> <id> <openbeken|shelly> "<Nome>" --divisao "<Divisão>" \
  --canais "1:interruptor:Teto:arranque=ultimo,2:interruptor:Candeeiro" [--medidor] [--bateria]
```
Regras: `entrada` só em `porta`; `simular` só em `interruptor`/`luz`; `carga=perigosa` nunca com `arranque=ultimo`; sensores a pilhas com `--bateria`. Testa primeiro com `DOMUS_DRY_RUN=1 ./domus.sh …` e corrige os erros antes de entregar.

## 3. Checklist da obra (Markdown ou .docx)
Material (com quantidades do orçamento) · ferramentas e EPI · sequência do plano de negócio §5: cortar energia e verificar ausência de tensão → instalar → religar e testar cada circuito e o estado após corte → Wi-Fi e sinal (ecrã Saúde) → configurar modos, cenas e automações com o cliente → app no telemóvel → entrega. Inclui as configurações impressas pelo `domus.sh` para cada aparelho.

## 4. Documento de entrega ao cliente (.docx, tema Terra)
Esquema das divisões e circuitos · lista de aparelhos · código de cliente (a palavra-passe entrega-se em mão, **nunca** no documento) · o que funciona sem internet e o que não · como usar modos, cenas e alarme · contactos de suporte · plano mensal e data de início (1.º mês grátis).

## 5. Depois da obra
Lembrete: chamada aos 7 dias e questionário de satisfação aos 30 dias (objetivo SMART ≥ 90 %).
