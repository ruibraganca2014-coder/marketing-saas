# Avaliação de segurança (27/09/2026)

Revisão autorizada, feita localmente (Mosquitto 2.0.18 real, motor real, site com Playwright). Sem contacto com servidores externos.

## Verificado como seguro
- **Isolamento entre clientes (MQTT):** 131 testes de permissões passam. Um cliente só lê a sua casa; `#` só devolve a sua árvore; tópicos reservados (`_aparelhos`, `_alarme`, `_modo`, `_config`, `_cenas`, `_saude`, `_energia`, `_presenca`, `_historico`, `_eventos`, registo, avisos, admin) são só de leitura para clientes; cada aparelho só escreve no seu prefixo; remover um aparelho corta a sessão.
- **Automações/cenas não chegam a outra casa:** tópicos construídos a partir do próprio cliente e de ids `[a-z0-9-]`.
- **Motor:** rejeita `__proto__`/`constructor`, JSON aninhado 5000 níveis, textos de 5 MB, listas de 100 000 elementos; nunca cai com mensagens malformadas; limites de crescimento (presença 20, FCM 10, histórico 100, registo 20, automações 50, cenas 30).
- **Site:** sem XSS — dados dos clientes sempre com `textContent`.
- **Android:** ligação `wss` com TLS; só a atividade principal é exportada; sem segredos nos registos.
- **Dependências do motor:** `npm audit` 0 vulnerabilidades; contentor sem root.
- **domus.sh:** palavras-passe de 20 caracteres de `/dev/urandom`, passadas por stdin; ids e nomes validados; `dados/` com permissões 700/600.

## A corrigir
| Nível | Problema | Estado |
|---|---|---|
| Alto | Porta 1883 sem cifra na internet: credenciais e comandos dos aparelhos em claro | Risco aceite (OpenBeken/BK7231 sem TLS fiável); acrescentar porta TLS 8883 opcional para Shelly e documentar — em curso |
| Médio | Site sem proteção contra *clickjacking* nem CSP (pode ser posto numa moldura para enganar o cliente a desarmar o alarme) | Cabeçalhos no Caddy — em curso |
| Médio | Executar cenas sem limite → excesso de notificações e carga no motor partilhado | Limite como nas automações + limite de notificações por cliente — em curso |
| Médio | App Android guarda a palavra-passe sem cifra (SharedPreferences) | EncryptedSharedPreferences / Keystore — próxima ronda da app |
| Médio | Mosquitto sem `max_connections` | Em curso |
| Baixo | Cliente pode publicar comandos retidos na própria casa | Só afeta a própria casa; app e site nunca usam retain |
| Baixo | Palavra-passe do admin como argumento do `domus.sh` | Ler por prompt — em curso |
| Baixo | Notificações ntfy protegidas só pelo segredo do tópico (~103 bits) | Informativo |
