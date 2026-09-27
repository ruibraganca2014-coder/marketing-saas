---
name: orcamento
description: Faz o orçamento de uma casa para a Domus Energia a partir das notas da visita (circuitos, divisões, o que o cliente quer). Usa quando o utilizador pedir um orçamento, proposta ou preço para um cliente, ou colar notas de uma visita.
---

# Orçamento Domus Energia

Produz um orçamento em Word (.docx) com o mesmo formato sempre, a partir das notas da visita.

## 1. Recolher o que falta (uma pergunta de cada vez)
Antes de calcular, confirma apenas o que não está nas notas:
1. Nome do cliente, localidade e tipo (moradia, apartamento/AL, acompanhamento de idoso).
2. Circuitos do quadro que devem ser inteligentes/medidos (n.º) e se o quadro tem espaço.
3. Interruptores de parede (quantos, quantos botões cada), estores, luzes com brilho.
4. Sensores: portas/janelas e movimento (só Wi-Fi — decisão da empresa).
5. Quer alarme a sério / funcionar sem internet? (→ Raspberry Pi, plano Segurança Premium)
6. Cargas perigosas (termoacumulador, aquecedores, bombas) — levam limite de tempo.

## 2. Escolher o kit e o plano (tabela de preços em `docs/MONETIZACAO.md`)
| Kit (s/ IVA) | Base | Inclui |
|---|---|---|
| Essencial | 390 € | quadro com 4 circuitos medidos + app |
| Conforto | 890 € | Essencial + 4 interruptores, 2 sensores, 1 estore |
| Segurança Premium | 1 490 € | Conforto + Raspberry Pi com UPS, sirene, 4 sensores extra |
- Acrescentar extras acima do kit a preço unitário: equipamento a preço de venda + mão de obra a **35 €/h s/ IVA** (confirma a tarifa com o utilizador se tiver mudado).
- Plano mensal recomendado: Base 4,99 € · Conforto 9,99 € · Segurança Premium 19,99 € (c/ IVA). Alarme → pelo menos Conforto.
- Só aparelhos certificados na UE (ex.: Shelly) para clientes. Nunca Temu reprogramado.
- IVA 23 % (confirmar taxa reduzida aplicável com o contabilista se a obra for em habitação e o utilizador o pedir).

## 3. Documento
Gera com `docx` (npm) — ver `negocio/plano.js` como modelo de estilos (tema Terra: títulos #606C38, subtítulos #BC6C25, tabelas com cabeçalho musgo). Secções:
1. Cabeçalho: Domus Energia, n.º de orçamento `ORC-AAAA-NNN`, data, validade 30 dias, dados do cliente.
2. O que vamos fazer (3–5 frases simples, sem jargão).
3. Tabela: item · quantidade · preço unitário · total (s/ IVA) → subtotal, IVA, **total c/ IVA**.
4. Plano mensal escolhido e o que inclui; 1.º mês grátis.
5. Prazo (horas de trabalho do kit + extras; dias) e condições: 50 % na adjudicação, 50 % no fim; garantia dos aparelhos do fabricante; interruptores físicos continuam sempre a funcionar.
6. Nota legal: instalação executada/assinada por técnico responsável habilitado (DGEG).
Guarda em `negocio/orcamentos/ORC-AAAA-NNN_<cliente>.docx` e mostra o total ao utilizador.
