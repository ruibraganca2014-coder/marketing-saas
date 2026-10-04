# Assistente (IA) dos pedidos

Decisões do dono de 2026-10-04. Primeira ronda: **resumir o pedido** e **sugerir o diagnóstico** de uma avaria. Segunda ronda (§8): **escrever ao cliente**, com o rascunho do email redigido pela IA. Código: `painel/src/assistente.js` (o que vai ao modelo, a chamada, a validação da resposta), as rotas `POST orcamentos/:id/ia/resumo|diagnostico` em `painel/src/api.js` (`pedirIa`), `painel/public/ecras/orcamentos.js` (`seccaoIa`); migração 37 (`orcamentos.ia`); testes `painel/test/assistente.test.js` e a matriz de `papeis.test.js`.

## 1. O que o dono decidiu
| Pergunta | Decisão |
|---|---|
| Que dados saem para o modelo | **Sem identificação.** Só o técnico: tipo de trabalho, concelho, casa, aparelhos, quadro, descrição da avaria, valores. Nome, email, telefone, morada e NIF nunca saem. As fotos não vão. |
| O que entra nesta ronda | Resumo + sugestão de diagnóstico (só a equipa lê). |
| Quando corre | Só ao carregar no botão. Nada corre sozinho. |
| Quem usa | CEO e comercial. Técnicos e eletricistas externos não veem botões nem resultados. |
| A sugestão preenche o diagnóstico do pedido? | Não. Fica numa caixa à parte, "Sugestão da IA — por confirmar no local". |

O cliente nunca vê nada disto: não vai para a conta, para o relatório nem para emails.

## 2. No painel
- **Ficha do pedido, no topo:** "Resumo do pedido (IA)" → botão **Resumir pedido** (depois **Atualizar resumo**). Mostra o resumo (3 a 5 frases), "O que o cliente quer", "Atenção" e "A perguntar ou confirmar".
- **Secção Diagnóstico** (pedidos de avaria ou com reparações): "Sugestão da IA — por confirmar no local" → botão **Sugerir diagnóstico** (depois **Pedir outra sugestão**). Mostra as causas prováveis por ordem (com a probabilidade, o porquê e como verificar), "A medir", "Material a levar", "Segurança" e a confiança. A lista de verificação e a conclusão por baixo continuam a ser preenchidas à mão.
- Cada resultado diz quando e por quem foi pedido. Fica guardado o **último** de cada botão; pedir outra vez substitui.
- Demora 10 a 60 segundos (o botão fica "A pensar…").
- No histórico do pedido fica "Resumo pedido ao assistente (IA)" / "Sugestão de diagnóstico pedida ao assistente (IA)", com o modelo, os tokens e o custo estimado.
- Sem a chave no servidor: o CEO lê "Assistente desligado…"; o comercial não vê a secção.
- Pedidos arquivados (RGPD): sem botões. Ao anonimizar um pedido, os resultados da IA são apagados com o resto.

## 3. O que vai ao modelo (`dadosParaIa`)
- Do pedido: o serviço, o **concelho** (só se for um dos 308 da lista: o da deslocação da simulação ou a localidade do pedido quando é exatamente um concelho; senão nada), a data de receção e a mensagem do cliente.
- Da simulação, só estes campos: `funil`, `servico`, `urgencia`, `visita`, `casa`, `quer`, `avaria`, `quadro`, `divisoes`, `inventario`, `trabalho`, `totais_acao`, `mao_obra`, `total`, `plano_sugerido`, `avisos`; o material com os nomes do catálogo; as melhorias (nome e preço); da deslocação o estado, o distrito e a distância. A **planta** (coordenadas e imagem de fundo) e as **fotos** não vão.
- A leitura automática da foto do quadro, o esquema do quadro, os ensaios medidos e o diagnóstico já registado, quando existem (sem quem os registou).
- Em qualquer nível saem sempre: `contacto`, `email`, `telefone`, `morada`, `nif`, `localidade`, `foto`, `fotos`, `fundo`, `imagem`, `por`. As notas internas do pedido não vão.
- Todos os textos passam por `semContactos`: emails → `[email]`, códigos postais → `[código postal]`, sequências de 9 ou mais algarismos (telefone, NIF, IBAN) → `[número]`. A resposta do modelo passa pelo mesmo filtro antes de ser guardada.
- **Limite conhecido:** um nome ou uma rua que o cliente escreva por extenso na mensagem ou na descrição da avaria ("sou o António, Rua X n.º 3") não é detetado e vai no texto. O modelo tem instruções para não o repetir. Só os campos próprios (nome, morada, contactos) são garantidamente retirados.
- Um pedido cujos dados passem de 300 000 caracteres não é enviado (`413`); nunca se corta.

## 4. A chamada
- `POST https://api.anthropic.com/v1/messages` com o `fetch` do Node (sem dependências, como a leitura da foto do quadro).
- Modelo **`claude-opus-5-5`** (US$ 4 / 1 M tokens de entrada, US$ 20 / 1 M de saída). Um pedido com simulação: perto de **US$ 0,05 a 0,12 por botão** (o custo de cada um fica no histórico e no registo: `docker compose logs painel | grep assistente`). Para gastar menos troca-se `MODELO_ASSISTENTE` e `PRECO_USD_MTOK` em `assistente.js` (ex.: `claude-sonnet-5-5`, US$ 2 / 10; `claude-haiku-4-5`, US$ 1 / 5, que não aceita `effort`).
- Resposta em JSON estruturado (`output_config.format`, JSON Schema), validada outra vez no painel (tipos, tamanhos, listas cortadas ao máximo). Esforço de raciocínio (`output_config.effort`): `medium` no resumo, `high` no diagnóstico.
- `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): se um classificador de segurança do modelo recusar o pedido, a API repete-o noutro modelo; guarda-se o modelo que respondeu. Se a API recusar este parâmetro (400), o painel repete sem ele e deixa de o mandar até reiniciar.
- Tempo máximo por tentativa `ASSISTENTE_TIMEOUT_MS` (120 s); **1 tentativa extra** em tempo esgotado, falha de rede, 408/429/5xx ou resposta inválida (não em 400/401/403 nem recusa).
- **Limite:** `LIMITE_IA_DIA` (50) pedidos em 24 h, todos os utilizadores juntos; acima disso `429`. As tentativas falhadas contam. O contador está em memória (recomeça ao reiniciar o painel).
- Erros para o ecrã: `503` sem chave; `429` no limite; `502` "O assistente não conseguiu responder (…)"; `409` pedido arquivado.

## 5. Guardado
`orcamentos.ia` (JSON, migração 37): `{resumo: {resumo, quer[], atencao[], perguntas[], data, por, modelo, custo_usd} | ausente, diagnostico: {causas[{causa, probabilidade, porque, verificar}], medicoes[], material[], seguranca[], confianca, nota, data, por, modelo, custo_usd} | ausente}`. A ficha completa (`GET orcamentos/:id`) leva `ia: {ligado, resumo, diagnostico}`. Pedir um resultado não muda `atualizado` do pedido.

## 6. Para ligar no servidor
1. Criar a chave em https://console.anthropic.com → API keys e pôr crédito na conta.
2. No `.env` do servidor: `ANTHROPIC_API_KEY=sk-ant-…` (a mesma chave liga também a leitura automática da foto do quadro, ≈ US$ 0,005 por foto). Opcional: `LIMITE_IA_DIA`.
3. `sudo docker compose up -d painel`.
4. A política de privacidade do site já tem a linha da Anthropic na tabela dos subcontratantes. **A confirmar pelo dono:** que os termos da conta Anthropic incluem o acordo de tratamento de dados e as cláusulas contratuais-tipo, como a linha diz.

## 7. Esquema do quadro a partir da foto
Pedido do dono (2026-10-04): no **Esquema do quadro** da ficha do pedido, com foto do quadro e a chave no servidor, o botão **"Preencher a partir da foto"** monta o rascunho do esquema pela leitura automática da foto (`leitura_quadro`, `painel/src/leitura-quadro.js`, Claude Haiku 4.5, ≈ US$ 0,005 por foto) — `quadro-desenho.js` `esquemaDaLeitura`: disjuntor geral (se visível), diferenciais e disjuntores repetidos pela quantidade de cada calibre, módulos livres estimados, estado, fusíveis, sinais de aquecimento e as notas.
- **Nada é guardado** até "Guardar esquema": o eletricista confere com a foto e corrige. Com um esquema já desenhado o botão chama-se "Substituir pelo que a IA lê na foto".
- A leitura **conta** os componentes de cada calibre; **não sabe a ordem na calha**: saem arrumados (geral, diferenciais, disjuntores, livres). Os disjuntores contados cujo calibre não se leu entram com "?".
- Se a foto ainda não tem leitura (chegou antes de haver chave) ou a leitura falhou, o botão pede-a na hora (`POST orcamentos/:id/ler-quadro`, espera pelo resultado; conta no `LIMITE_IA_DIA`). Leitura que não reconhece um quadro: mensagem e desenha-se à mão.
- Testes: `esquema-quadro.test.js` (`esquemaDaLeitura`), `fotos.test.js` (a rota) e a matriz de `papeis.test.js`.

## 8. Escrever ao cliente (ronda 2)
Decisões do dono de 2026-10-04: **o painel envia o email**; **a pessoa escreve a ideia e a IA redige**; tom **formal simples, sem "tu"** (o dos emails automáticos: "Olá," … "Domus Energia").

- **Ficha do pedido → "Escrever ao cliente"** (CEO e comercial; só com um email do cliente para onde enviar — o da conta, ou o do formulário nos pedidos sem conta — e fora dos arquivados; a ficha completa leva `mensagem_para`).
- **"O que quer dizer"** (até 1000 caracteres) + **Redigir com IA** → `POST orcamentos/:id/ia/resposta {instrucao}` → `{assunto, texto, modelo, custo_usd}`. Só com o assistente ligado. A ideia é a **única fonte de factos** (datas, preços, compromissos): o modelo tem ordem para não acrescentar nenhum, nem escrever o nome do cliente ou de quem assina. Ao modelo vão a ideia tal como foi escrita (não passa pelo filtro: pode levar o telefone da empresa ou um preço) e os dados técnicos do pedido de sempre (§3). **O rascunho não se guarda** no pedido: vai para o formulário.
- **Assunto** e **Mensagem** editáveis; também se pode escrever tudo à mão, sem IA. Um texto escrito à mão não é substituído pela IA sem ser apagado primeiro. O que está por enviar não se perde quando a ficha se redesenha (fica na página aberta; some ao recarregar).
- **Enviar email** → pede confirmação ("Enviar este email para …? Depois de enviado não se pode desfazer.") → `POST orcamentos/:id/mensagem {assunto ≤ 150, texto ≤ 5000}`: sai pelo remetente dos outros emails (`EMAIL_REMETENTE`), só texto. **A resposta do cliente chega à caixa de `EMAIL_RESPOSTAS`** (cabeçalho `Reply-To` de todos os emails do painel; sem ela, à do remetente), fora do painel.
- Fica na **ficha do cliente (CRM)** como contacto "email" (assunto + texto, quem e quando) e, por isso, um pedido "novo" passa a "contactado" e os lembretes de contacto contam daí. No histórico do pedido: "Email enviado ao cliente" (só o n.º de caracteres; o texto não vai para a auditoria nem para o registo do servidor) e "Rascunho de email pedido ao assistente (IA)" com o custo.
- Limites: 30 emails por hora por utilizador (`429`); o rascunho conta no `LIMITE_IA_DIA`. `409` sem email do cliente ou pedido arquivado; `502` se o servidor de email falhar (nada fica registado).
- Não usa a ligação "não quero receber": é uma mensagem de serviço sobre o pedido do cliente, escrita por uma pessoa.
- Testes: `assistente.test.js` ("escrever ao cliente") e a matriz de `papeis.test.js`.

## 9. Por fazer
- Ver as respostas do cliente dentro do painel (hoje chegam só à caixa de email).
- Experimentado com a API real em 2026-10-04 no servidor, com um pedido fictício: resumo em 12 s (≈ US$ 0,02) e diagnóstico em 28 s (≈ US$ 0,05); a API aceitou `fallbacks`. Falta ver o custo num pedido com simulação completa (casa inteira).
