// Parte I (estrutura do diapositivo 7 da parte 2 do módulo) e Parte II (plano de ação).
// Este bloco é inserido no plano.js pelo montar.py; usa as variáveis e ajudantes de lá.

const margemMedia = equipMedio * (1 - custoEquip) + (ticket - equipMedio) * (1 - pagaTecnicos);
const pontoEquilibrio = fixoTotal / margemMedia;
const mesEquilibrio = (meses.find(m => m.margem + m.subs - fixoTotal >= 0) || {}).mes;
const kitC = kits[1];
const custoC = {
  equip: kitC.equip * custoEquip,
  maoObra: (kitC.preco - kitC.equip) * pagaTecnicos,
  consumiveis: 15,
  indireto: fixoTotal / 4.5,
};
const custoCTotal = Object.values(custoC).reduce((a, b) => a + b, 0);

c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE I — PLANO DE NEGÓCIO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(p("Estrutura do diapositivo 7 do módulo (Plano de ação e plano de negócio): resumo, empresa, serviço, mercado, clientes, concorrência, marketing e vendas, plano operacional, recursos humanos, investimento, previsões financeiras, riscos e objetivos."));

// 1. Resumo
c.push(h1("1. Resumo do negócio"));
c.push(p("A Domus Energia é uma empresa de eletricidade e automação residencial na Grande Lisboa. Instala quadros elétricos inteligentes, interruptores, estores, sensores e alarme, e liga tudo a uma plataforma própria (app Android e área de cliente no site). O cliente paga a instalação uma vez e uma mensalidade pelo serviço."));
c.push(tabela(["Indicador", "Valor (ano 1)"], [
  ["Investimento inicial", eur(arranqueTotal)],
  ["Instalações previstas", String(ano.n)],
  ["Vendas de instalações", eur(ano.vendas)],
  ["Casas com mensalidade no mês 12", String(Math.round(meses[11].acumulados * subscreve))],
  ["Ponto de equilíbrio", `≈ ${Math.ceil(pontoEquilibrio)} instalações por mês (atingido no mês ${mesEquilibrio})`],
  ["Resultado do ano 1 (antes de impostos e salário do CEO)", eur(resultadoAno)],
], [6, 3], { alinharDireita: [1] }));

// 2. Empresa
c.push(h1("2. Descrição da empresa"));
c.push(p("Nome: Domus Energia. Atividade: instalações elétricas e automação residencial (CAE 43210, secundários 43290 e 62020). Sede e zona inicial: Grande Lisboa. Equipa: o CEO (em formação de eletricidade, futuro técnico responsável DGEG) e 4 colaboradores."));
c.push(h2("Da ideia ao negócio"));
c.push(tabela(["Fase", "O que significa", "Na Domus Energia"], [
  ["Ideia", "Ponto de partida: uma oportunidade que ainda precisa de ser estudada", "“Há casas que gastam demais e não têm segurança; com aparelhos Wi-Fi baratos e uma app própria posso resolver isso.”"],
  ["Projeto", "A ideia estruturada e planeada: mercado, clientes, concorrência, recursos, custos, investimento, riscos, objetivos", "Este documento; a plataforma (servidor, motor, app e site) já está construída e testada"],
  ["Negócio", "O projeto passa a atividade económica: empresa criada, clientes, receitas e resultados acompanhados", "Meses 1–3: criar a empresa, comprar stock, 3 instalações-piloto, primeiras mensalidades"],
], [1.3, 3.5, 4.2]));
c.push(h2("Sócios ou trabalhadores (decisão em aberto)"));
c.push(p("O diapositivo 21 pede que o plano esclareça quem investe, quem gere e como se dividem as responsabilidades. Ainda não está decidido; as duas hipóteses:"));
c.push(tabela(["Critério", "A — Só o CEO é dono (unipessoal Lda)", "B — Sócios, com o CEO maioritário (Lda)"], [
  ["Quem investe", `CEO: os ${eur(arranqueTotal)}`, "CEO ≥ 51 %; colegas entram com uma parte (ex.: 500–1 000 € cada)"],
  ["Quem gere", "CEO sozinho", "CEO como gerente; decisões grandes em assembleia de sócios"],
  ["Colaboradores", "Trabalhadores, pagos por obra no início", "Sócios-trabalhadores; recebem pela obra e parte dos lucros"],
  ["Vantagens", "Decisão rápida; simples de gerir", "Mais capital; equipa comprometida; risco partilhado"],
  ["Desvantagens", "Todo o risco e investimento no CEO", "Pacto social necessário; conflitos se as expectativas não estiverem escritas"],
], [1.8, 3.6, 3.6]));
c.push(nota("Recomendação: decidir antes de criar a empresa e, na hipótese B, escrever um acordo de sócios (quem investe quanto, quem faz o quê, como se saem da empresa)."));
c.push(h2("Quem vai usar este plano"));
c.push(tabela(["Quem", "Para quê"], [
  ["Empreendedor (CEO)", "Estruturar a ideia, avaliar a viabilidade e definir a estratégia"],
  ["Sócios (se houver)", "Alinhar expectativas: quem investe, quem gere, objetivos e responsabilidades"],
  ["Gestores / equipa", "Orientar decisões e acompanhar a evolução (revisão semanal)"],
  ["Bancos, IEFP e financiadores", "Perceber o investimento, como será usado e como será reembolsado"],
  ["Parceiros e fornecedores", "Apresentar a empresa a mediadoras imobiliárias, alojamentos locais, lares e distribuidores"],
], [3, 6]));

// 3. Serviço
c.push(h1("3. Produto ou serviço"));
c.push(p("Vendemos um serviço completo: instalação elétrica e de automação, e depois uma mensalidade que inclui a app, o servidor, as notificações e o suporte."));
c.push(tabela(["Kit de instalação", "Inclui", "Preço (s/ IVA)", "Horas de trabalho"],
  kits.map(k => [k.nome, k.desc, eur(k.preco), `${k.horas} h`]), [2, 5, 1.6, 1.4], { alinharDireita: [2, 3] }));
c.push(espaco());
c.push(tabela(["Plano mensal", "Inclui", "Preço c/ IVA", "Preço s/ IVA"],
  planos.map(pl => [pl.nome, pl.inclui, eur(pl.com, 2), eur(pl.sem, 2)]), [2, 5, 1.5, 1.5], { alinharDireita: [2, 3] }));
c.push(nota("Se o cliente deixar de pagar: 15 dias de aviso e depois modo básico. Os interruptores físicos continuam sempre a funcionar; perde a app, as automações e o alarme."));
c.push(h2("O que nos diferencia"));
[
  "Plataforma própria (sem depender da cloud Tuya): servidor, motor de automações, app e site da empresa.",
  "Quem instala percebe de eletricidade: instalação elétrica e automação feitas pela mesma equipa.",
  "Funciona quando algo falha: interruptores físicos sempre ativos; no plano Premium um Raspberry Pi em casa mantém o alarme sem internet.",
  "Poupança visível: consumo por circuito, alertas, aparelhos em espera e relatório da casa.",
  "Sem fidelização longa: mensalidades baixas e cancelamento simples.",
].forEach(t => c.push(bullet(t)));

// 4. Mercado
c.push(h1("4. Análise de mercado"));
[
  "A fatura da eletricidade pesa no orçamento das famílias; saber quanto gasta cada circuito é o primeiro passo para poupar.",
  "Os aparelhos Wi-Fi ficaram baratos: uma casa inteligente básica já não custa milhares de euros.",
  "A segurança é uma preocupação e o alarme com mensalidade está generalizado — mas com contratos caros e longos.",
  "Envelhecimento da população: filhos que querem acompanhar os pais à distância.",
  "Alojamento local na Grande Lisboa: senhorios querem controlar consumos e a casa entre estadias.",
].forEach(t => c.push(bullet(t)));
c.push(p("Preços de referência encontrados: instalação de domótica a partir de ≈ 750 €, e uma smart home entre ≈ 500 € e 3 000 €; sistemas KNX a partir de ≈ 1 500 € (Zaask). Alarme com monitorização a partir de 37 €/mês com fidelização de 24 meses (Verisure/Securitas Direct). Os kits da Domus Energia (390–1 490 €) e as mensalidades (4,99–19,99 €) ficam abaixo destas referências."));

// 5. Clientes
c.push(h1("5. Identificação de clientes"));
c.push(tabela(["Segmento", "Necessidade que resolvemos", "Kit e plano típicos"], [
  ["Famílias em moradias", "Segurança, conforto e poupança na fatura", "Conforto ou Segurança Premium + plano Conforto/Premium"],
  ["Apartamentos e alojamento local", "Controlo à distância, consumo por estadia, desligar tudo entre hóspedes", "Essencial ou Conforto + plano Base/Conforto"],
  ["Idosos e familiares", "Tranquilidade: aviso se não houver movimento de manhã ou se a porta abrir à noite", "Conforto + plano Conforto"],
], [2.2, 3.6, 3.2]));

// 6. Concorrência
c.push(h1("6. Análise da concorrência"));
c.push(tabela(["Concorrente", "O que oferece", "Pontos fortes", "Onde somos melhores"], [
  ["Empresas de alarme (Verisure / Securitas Direct)", "Alarme com central de monitorização", "Marca forte, resposta 24 h", "Mensalidade muito mais baixa, sem fidelização de 24 meses; também poupança e automação"],
  ["Integradores de domótica (KNX e similares)", "Automação completa por cabo", "Muito fiável, projetos grandes", "Preço de entrada muito menor; instalação sem obras em casas já construídas"],
  ["Eletricistas tradicionais e multisserviços", "Instalações elétricas, por vezes domótica", "Proximidade, preço da mão de obra", "Plataforma própria com app, alertas e mensalidade de suporte"],
  ["Faça você mesmo (apps Tuya / Smart Life, Shelly)", "Aparelhos baratos instalados pelo próprio", "Barato, imediato", "Instalação segura no quadro por quem é da área; tudo integrado numa só app; suporte"],
], [2.3, 2.2, 2, 2.5]));
c.push(p("Posicionamento: o meio-termo entre o \"faça você mesmo\" (barato mas arriscado no quadro elétrico) e o KNX ou a central de alarme (caros e com contratos longos)."));

// 7. Marketing
c.push(h1("7. Estratégia de marketing e vendas"));
c.push(tabela(["Área", "O que fazemos"], [
  ["Produto", "3 kits fixos e 3 planos simples; demonstração ao vivo com o quadro de bancada"],
  ["Preço", "Abaixo das centrais de alarme e do KNX; 1.º mês de mensalidade grátis; sem fidelização"],
  ["Distribuição", "Venda direta em visita; parcerias com mediadoras imobiliárias, gestores de AL e lares/cuidadores (comissão por cliente)"],
  ["Comunicação", "Google Business Profile, site com pedido de orçamento e WhatsApp, vídeos curtos de instalações, testemunhos das instalações-piloto, flyers nas zonas das obras"],
], [2, 7]));
c.push(h2("Do contacto ao cliente"));
["Contacto (site, WhatsApp, parceiro) → resposta em menos de 24 h.", "Visita gratuita com demonstração → orçamento em 48 h (skill de orçamento).", "Aceitação → marcação da obra e encomenda do material.", "Instalação e entrega → 1.º mês grátis.", "Acompanhamento aos 7 e 30 dias → pedido de recomendação."].forEach(t => c.push(num(t, "funil")));

// 8. Plano operacional
c.push(h1("8. Plano operacional"));
[
  "Horário: segunda a sexta 9:00–18:00; sábado de manhã para visitas; suporte por WhatsApp em dias úteis e alarmes 24 h pela plataforma.",
  "Fornecedores: aparelhos certificados na UE (ex.: Shelly) de 2 distribuidores diferentes, para não depender de um só; material elétrico no armazenista local.",
  "Oficina: garagem ou arrecadação do CEO para preparar e configurar os aparelhos antes das obras.",
  "Plataforma: servidor VPS (Mosquitto, motor, notificações), app Android e site — mantidos pelo técnico de sistemas.",
  "Qualidade: checklist de instalação, teste final com o cliente, documento de entrega (ver III.4 Sequência de uma instalação).",
].forEach(t => c.push(bullet(t)));

// 9. Recursos humanos e os 4 recursos
c.push(h1("9. Recursos humanos e recursos da empresa"));
c.push(p("Uma empresa reúne e coordena recursos (Chiavenato e Drucker). As pessoas são o recurso central: são elas que usam e coordenam todos os outros."));
c.push(tabela(["Recurso", "O que é", "Na Domus Energia"], [
  ["Humanos", "Pessoas e as suas competências, conhecimentos e atitudes", "CEO e técnico responsável; 2 técnicos instaladores; 1 técnico de sistemas e suporte; 1 comercial part-time (funções em III.1)"],
  ["Materiais", "Instalações, equipamentos, ferramentas e materiais", "Oficina, carros, ferramentas e EPI, kit de demonstração, stock de aparelhos, cabos e consumíveis"],
  ["Financeiros", "Capital próprio, financiamentos e receitas", `${eur(arranqueTotal)} de capital próprio; receitas das instalações e das mensalidades; apoios IEFP/microcrédito se necessário`],
  ["Tecnológicos", "Conhecimento técnico, sistemas, software e automatização", "Plataforma própria (servidor MQTT, motor de automações, app Android, site), Stripe, skills de orçamento e instalação, agente de suporte"],
], [1.6, 3, 4.4]));

// 10. Investimento
c.push(h1("10. Investimento necessário"));
c.push(tabela(["Item", "Valor"], [...arranque.map(([a, v]) => [a, eur(v)]), total(["Total", eur(arranqueTotal)])], [7, 2], { alinharDireita: [1] }));

// 11. Custos e previsões
c.push(h1("11. Custos e previsões financeiras"));
c.push(h2("Custo e despesa"));
c.push(p("Custo é o valor dos recursos consumidos para fazer o trabalho; despesa é a saída de dinheiro quando se paga. Exemplo: as ferramentas (1 200 €) são uma despesa no mês 1, mas o custo é o seu desgaste ao longo de ≈ 3 anos (≈ 33 € por mês), mesmo sem saída de dinheiro."));
c.push(h2("Classificação dos custos da Domus Energia"));
c.push(tabela(["Critério", "Tipo", "Exemplos na empresa"], [
  ["Relação com a obra", "Diretos", "Aparelhos e material de cada obra, mão de obra dos técnicos na obra, consumíveis (terminais, fita, etiquetas)"],
  ["", "Indiretos", "Servidor, seguro, contabilista, telemóveis, marketing, desgaste das ferramentas"],
  ["Variação", "Fixos", `Servidor, seguro, contabilista, marketing base (≈ ${eur(fixoTotal)} por mês)`],
  ["", "Variáveis", "Aparelhos, material, pagamento dos técnicos por obra, combustível extra, comissões Stripe"],
  ["Momento", "Estimados", "Os valores deste plano e de cada orçamento"],
  ["", "Históricos", "Os custos reais de cada obra, registados e comparados na revisão semanal"],
], [2, 1.6, 5.4]));
c.push(h2(`Custo estimado de uma instalação (kit ${kitC.nome}, ${eur(kitC.preco)})`));
c.push(tabela(["Componente", "Tipo", "Valor"], [
  ["Aparelhos e material", "Direto · variável", eur(custoC.equip)],
  ["Mão de obra dos técnicos", "Direto · variável", eur(custoC.maoObra)],
  ["Consumíveis", "Direto · variável", eur(custoC.consumiveis)],
  ["Parte dos custos fixos (÷ 4,5 obras/mês)", "Indireto · fixo", eur(custoC.indireto)],
  total(["Custo total estimado", "", eur(custoCTotal)]),
  total(["Resultado da obra", "", eur(kitC.preco - custoCTotal)]),
], [5, 2.2, 1.8], { alinharDireita: [2] }));
c.push(h2("Ponto de equilíbrio"));
c.push(p(`Cada instalação deixa, em média, ${eur(margemMedia)} para a empresa (depois de pagar aparelhos e técnicos). Os custos fixos são ${eur(fixoTotal)} por mês. Logo, a empresa precisa de ${fixoTotal.toFixed(0)} ÷ ${margemMedia.toFixed(0)} ≈ ${pontoEquilibrio.toFixed(1)} → ${Math.ceil(pontoEquilibrio)} instalações por mês para não perder dinheiro. Com as mensalidades a crescer, este número desce ao longo do ano. Na previsão, o equilíbrio é atingido no mês ${mesEquilibrio}.`));
c.push(h2("Pressupostos"));
[
  `Mistura de vendas: 50 % Essencial, 35 % Conforto, 15 % Segurança Premium → valor médio por instalação ${eur(ticket)}.`,
  "Equipamento comprado a ≈ 72 % do preço de venda; mão de obra: 60 % para os técnicos, 40 % para a empresa.",
  `Instalações por mês: ${instalacoesMes.join(", ")} (total ${ano.n}).`,
  `70 % dos clientes subscrevem; mensalidade média ${eur(mensalidadeMedia, 2)} sem IVA.`,
  "O CEO não recebe salário fixo no ano 1; o resultado serve para o pagar a partir do mês 7 e reinvestir.",
].forEach(t => c.push(bullet(t)));
c.push(h2("Custos fixos mensais"));
c.push(tabela(["Custo", "Por mês"], [...Object.entries(fixosMes).map(([a, v]) => [a, eur(v)]), total(["Total", eur(fixoTotal)])], [7, 2], { alinharDireita: [1] }));
c.push(h2("Previsão mensal"));
c.push(tabela(["Mês", "Instalações", "Casas", "Vendas", "Margem obras", "Mensalidades", "Custos fixos", "Resultado"],
  [...meses.map(m => [m.mes, m.n, m.acumulados, eur(m.vendas), eur(m.margem), eur(m.subs), eur(fixoTotal), eur(m.margem + m.subs - fixoTotal)]),
   total(["Ano", ano.n, meses[11].acumulados, eur(ano.vendas), eur(ano.margem), eur(ano.subs), eur(fixoTotal * 12), eur(resultadoAno)])],
  [0.7, 1.1, 0.9, 1.3, 1.4, 1.4, 1.3, 1.3], { alinharDireita: [1, 2, 3, 4, 5, 6, 7] }));
c.push(nota(`No ano 1 as instalações pagam a empresa; as mensalidades são ainda pequenas (${eur(mrrFinal)} por mês no mês 12) mas repetem-se todos os meses. Objetivo do ano 2: 150 casas com mensalidade (≈ ${eur(150 * mensalidadeMedia)} por mês).`));

// 12. Riscos
c.push(h1("12. Riscos e medidas de prevenção"));
c.push(tabela(["Risco", "Medida preventiva", "Alternativa se acontecer"], [
  ["Falta de clientes", "Pilotos com testemunhos, parcerias com AL, mediadoras e lares", "Oferecer só o kit Essencial com desconto; serviços elétricos gerais"],
  ["Aumento dos custos (aparelhos, combustível)", "Orçamentos válidos 30 dias; obras agrupadas por zona", "Rever preços dos kits a cada trimestre"],
  ["Entrada de novos concorrentes", "Diferenciar pela plataforma própria, suporte e preço sem fidelização", "Focar em nichos (AL, idosos) e em parcerias"],
  ["Dependência de um único fornecedor", "2 distribuidores de aparelhos certificados; protocolo aberto (MQTT)", "Trocar de marca sem mudar a app"],
  ["Certificação DGEG ainda não obtida", "Só trabalhos sem assinatura até ao fim do curso", "Subcontratar um eletricista certificado"],
  ["Falha do servidor ou da internet do cliente", "Regras nos próprios aparelhos; backups diários", "Raspberry Pi em casa no plano Premium"],
  ["Clientes cancelam a mensalidade", "Valor visível: relatórios de poupança e alertas", "Plano Base barato; questionário para perceber porquê"],
], [2.4, 3.4, 3.2]));
c.push(h2("Apoios a considerar"));
c.push(p("Se o capital próprio não chegar: apoio à criação do próprio emprego do IEFP, microcrédito e avisos do Portugal 2030. Confirmar as condições atuais no IEFP e com o contabilista."));

// 13. Objetivos
c.push(h1("13. Objetivos e resultados esperados"));
c.push(tabela(["Objetivo (ano 1)", "Meta"], [
  ["Número de clientes", `${ano.n} instalações; ${Math.round(meses[11].acumulados * subscreve)} casas com mensalidade no mês 12`],
  ["Volume de vendas", eur(ano.vendas) + " em instalações"],
  ["Prazo para o ponto de equilíbrio", `Mês ${mesEquilibrio}`],
  ["Número de colaboradores", "5 pessoas (CEO + 4); técnicos com contrato a partir do mês 10"],
  ["Satisfação dos clientes", "≥ 90 % no questionário de 30 dias"],
], [4, 5]));
c.push(p("Os objetivos estão escritos na forma SMART, com o exercício de objetivos vagos para SMART e a relação atividade → resultado, na Parte III (III.5 e III.6)."));

// 14. Decisão
c.push(h1("14. O plano como instrumento de decisão"));
c.push(p("O plano não elimina a incerteza, mas reduz as decisões tomadas só por intuição. Exemplo, no formato do diapositivo 26:"));
c.push(tabela(["Critério", "Plataforma só online (VPS)", "Online + Raspberry Pi em casa"], [
  ["Investimento inicial por casa", "Nenhum extra", "≈ 90–130 € (Pi, SSD, UPS)"],
  ["Custos fixos", "≈ 5 €/mês de servidor para todos", "Servidor + manutenção de cada Pi"],
  ["Funciona sem internet", "Só os interruptores físicos", "Alarme, sirene e automações continuam"],
  ["Rapidez", "Meio segundo ou mais", "Milissegundos"],
  ["Esforço de suporte", "Baixo", "Mais alto (um equipamento por casa)"],
  ["Decisão", "Planos Base e Conforto", "Só no plano Segurança Premium"],
], [2.4, 3.3, 3.3]));
c.push(quebra());

// PARTE II — Plano de ação
c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE II — PLANO DE AÇÃO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(h1("15. Plano de ação do arranque"));
c.push(p("O plano de ação transforma os objetivos em tarefas concretas. Cada ação responde a: O quê? Porquê? Quem? Quando? Como? Quanto? Como sabemos se resultou?"));
c.push(tabela(["O quê", "Porquê", "Quem", "Quando", "Como", "Quanto", "Como sabemos se resultou"], [
  ["Decidir sócios e criar a empresa", "Faturar legalmente", "CEO", "Mês 1", "Empresa na Hora", "360 €", "Certidão e NIF da empresa"],
  ["Seguro de RC e contabilista", "Proteger e cumprir", "CEO", "Mês 1", "3 propostas", "420 €/ano + 100 €/mês", "Apólice ativa antes da 1.ª obra"],
  ["Servidor no VPS e app compilada", "Plataforma pronta", "Téc. sistemas", "Mês 1–2", "Guias do projeto", "≈ 15 €/mês + 25 € Google Play", "App instalada num telemóvel real, testes a passar"],
  ["Kit de demonstração", "Vender ao vivo", "Técnicos", "Mês 1", "Quadro de bancada", "Parte do stock (≈ 300 €)", "Usado em 100 % das visitas"],
  ["Pagamentos Stripe", "Cobrar mensalidades", "Téc. sistemas", "Mês 2", "Stripe + página de planos", "1,5 % + 0,25 € por pagamento", "1.ª mensalidade cobrada automaticamente"],
  ["Lançamento (Google, site, flyers)", "Primeiros pedidos", "Comercial + CEO", "Mês 2", "Campanha local", "600 €", "≥ 10 pedidos de orçamento no mês 2"],
  ["3 instalações-piloto", "Provar e ter testemunhos", "Equipa", "Mês 2–3", "Amigos/família a 50 %", "Custo do material", "3 testemunhos com fotos; satisfação ≥ 90 %"],
  ["Contactar parceiros (AL, mediadoras, lares)", "Canal de vendas", "Comercial", "Semanal", "20 contactos/semana", "Tempo + comissão por cliente", "5 novos clientes por mês a partir do mês 4"],
], [1.7, 1.3, 1, 0.8, 1.3, 1.4, 1.9]));
c.push(quebra());
c.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [new TextRun({ text: "PARTE III — ORGANIZAÇÃO DO TRABALHO", bold: true, size: 36, color: "BC6C25" })] }));
c.push(p("Tópicos da parte 1 do módulo (Planeamento, organização e conceito de negócio), aplicados à empresa."));
