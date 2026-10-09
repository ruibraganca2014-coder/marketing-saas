# Ativação de aparelhos

Decisões do dono (2026-10-09). Objetivo: só a Domus põe aparelhos a funcionar no programa, e fica registado que chip está em que casa. É a camada de segurança que vive no servidor (ver `relatorio-seguranca-aparelhos.html`).

## Regras
1. **Quem cria aparelhos e lhes dá credenciais é só o painel** (CEO ou técnico da casa: `POST clientes/:c/aparelhos`, que pede ao `domus.sh` o utilizador MQTT). Nada disto muda. Um aparelho sem credenciais da Domus não entra no servidor.
2. **Cada aparelho tem um chip registado**: o endereço MAC que o aparelho mostra na sua página, e opcionalmente o número de série ou do selo. Regista-o o CEO, na ficha da casa ou ao pedir o aparelho.
3. **Os eletricistas também registam o chip**, na área deles, dentro de um trabalho que é deles e só nos aparelhos que a casa desse pedido já tem. O registo fica **à espera do CEO**.
4. **Eletricista de confiança** ("Ativa aparelhos sem aprovação", no painel → Eletricistas): o registo dele vale logo.
5. **O CEO é o superutilizador**: aprova, recusa, anula qualquer ativação (também as automáticas) e pode registar ou apagar o chip à mão.
6. **Verificação**: o aparelho anuncia o seu chip (`domus/<cliente>/<aparelho>/mac`, publicado pelo OpenBeken). Se não for o registado, há um **alerta crítico** ("chip diferente") e um email aos CEO, uma vez por chip registado. Pode ser um aparelho trocado sem registo, ou as credenciais de um aparelho postas noutro.
7. **Nunca se corta nada**: o alerta não desliga o aparelho nem o tira do programa. Quem decide é o CEO (registar o chip novo, ou remover o aparelho). O botão manual funciona sempre.

## O que o CEO vê
- **Início → Para tratar**: "N ativações de aparelhos por aprovar" e os alertas críticos.
- **Ativações** (`#/ativacoes`, só CEO): por aprovar (Aprovar / Recusar) e as últimas decididas (Anular nas aprovadas), com o eletricista, o pedido e o estado atual do chip.
- **Casas e planos → ficha da casa**: em cada aparelho, o estado do chip e "Registar chip".
- **Alertas**: "chip diferente" (crítico) e "chip por registar" (baixo, para aparelhos que já respondem e ainda não têm chip registado).
- **Eletricistas**: a caixa "Ativa aparelhos sem aprovação".

Estados do chip: `por_registar` · `por_ver` (registado, o aparelho ainda não o anunciou) · `confere` · `diferente`.

## O que o eletricista vê
Na ficha do trabalho, a secção "Aparelhos da casa" (só quando o pedido já tem a casa criada no programa e a casa tem aparelhos): a lista, o estado de cada chip, e um campo para escrever o código com "Registar chip". Um registo novo para o mesmo aparelho substitui o que ainda estava à espera.

## Dados (migração 41)
- `aparelhos_chip` (cliente, aparelho, mac, serie, registado, por, mac_visto, visto, avisado).
- `aparelhos_ativacoes` (id, cliente, aparelho, mac, serie, trabalho_id, eletricista_id, estado `pendente | aprovada | recusada | anulada`, criado, decidido, decidido_por, nota).
- `eletricistas.ativa_sem_aprovacao`.

## API
| Rota | Quem | O quê |
|---|---|---|
| `POST /painel/api/clientes/:c/aparelhos` | ceo, tecnico | aceita também `mac` e `serie` (ficam no painel; não vão no pedido ao `domus.sh`) |
| `POST /painel/api/clientes/:c/aparelhos/:a/chip` | ceo | `{mac, serie}`; `mac: null` apaga o registo |
| `GET /painel/api/clientes/:c` | todos menos comercial | cada aparelho traz `chip: {mac, serie, visto, estado…}` |
| `GET /painel/api/ativacoes` | ceo | `{pendentes, recentes}` |
| `POST /painel/api/ativacoes/:id` | ceo | `{acao: aprovar \| recusar \| anular, nota}` |
| `POST /painel/api/eletricistas/:id` | ceo | aceita `ativa_sem_aprovacao: true \| false` |
| `GET /api/eletricista/trabalhos/:id/aparelhos` | eletricista | os aparelhos da casa do pedido e os registos deste trabalho |
| `POST /api/eletricista/trabalhos/:id/chip` | eletricista | `{aparelho, mac, serie}` |

Código: `painel/src/alertas.js` (`normalizarMac`, tópico `mac`, alertas de chip), `painel/src/api.js` (`guardarChip`, `chipPublico`, `aparelhosCtx`, `h.ativacoes`), `painel/src/eletricistas.js` (`h.chipTrabalho`), `painel/public/ecras/ativacoes.js`, `web/eletricista.js` (`seccaoAparelhos`). Testes: `painel/test/ativacao-aparelhos.test.js`.

## Limites conhecidos
- O MAC é o que o aparelho diz ter. Quem tenha as credenciais de um aparelho e saiba o MAC registado consegue imitá-lo; a verificação apanha trocas e cópias descuidadas, não um atacante preparado.
- **Mudança de morada** não se deteta: o servidor não sabe de onde o aparelho se liga.
- O aparelho fala com o servidor sem cifra (porta 1883); a porta cifrada está por ligar.
- Os Shelly não anunciam o chip neste tópico: ficam em "registado, ainda não visto".
- No programa local, a casa `demo` dos aparelhos simulados anuncia chips fictícios (`02:D0:…`) para experimentar tudo isto.
