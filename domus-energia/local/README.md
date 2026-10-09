# Correr no computador (sem Docker)

```bash
cd domus-energia/local
npm run instalar   # só da primeira vez
npm start
```

| Endereço | O que é |
|---|---|
| http://localhost:8080/ | site |
| http://localhost:8080/cliente.html | área de cliente (entra com qualquer código e palavra-passe) |
| http://localhost:8080/simulador.html | simulador |
| http://localhost:8080/painel/ | painel da empresa (o email e a palavra-passe do CEO estão em `dados/local.json`) |
| `mqtt://localhost:1883` e `ws://localhost:8080/mqtt` | broker MQTT |

O `iniciar.js` substitui o `servidor/docker-compose.yml`: arranca um broker MQTT em Node (aedes) em vez do Mosquitto, o painel, os pagamentos e o motor, e serve a pasta `web/` com o `config.js` a apontar para o MQTT local. Os ficheiros de produção não são alterados. Os dados ficam em `local/dados/`, que não vai para o git.

É só para desenvolver. Diferenças para o servidor:
- o broker aceita qualquer login e não tem ACL;
- não há ntfy, por isso as notificações do motor falham e só aparecem no registo;
- o `domus.sh` não corre, por isso os pedidos do painel (criar clientes e aparelhos) ficam pendentes;
- o Stripe fica desligado até pores as variáveis `STRIPE_*` no ambiente.

## Aparelhos simulados

Para experimentar a área de cliente sem aparelhos verdadeiros (decisão do dono, 2026-10-09): com o lançador a correr, noutro terminal `npm run aparelhos` (ou `node aparelhos-simulados.js <cliente>`). Cria a casa `demo` com 8 aparelhos a fingir (quadro com medição, interruptor de 2 botões, LED com brilho, tomada da televisão e termoacumulador com medição, estore, porta de entrada e sensor de movimento a pilhas), que obedecem aos comandos e publicam potência de 5 em 5 segundos; a porta e o movimento mexem-se sozinhos. Em `cliente.html` entra-se com o código `demo` e qualquer palavra-passe. Só existe aqui: fala com o broker local (`mqtt://127.0.0.1:1883`).

## Acesso rápido (testes)

Só aqui, as páginas têm em baixo, à esquerda, o botão **Acesso rápido (testes)**: abre uma caixa com "CEO · Comercial · Técnico" (painel), "Cliente de teste 1 · Cliente de teste 2" (conta de cliente) e "Sair". Entra-se sem palavra-passe, com utilizadores de teste criados na primeira vez (`ceo.teste@domus.localhost`, `comercial.teste@…`, `tecnico.teste@…`, `cliente1.teste@exemplo.pt`, `cliente2.teste@exemplo.pt`). Os mesmos botões aparecem no ecrã de entrada do painel e no bloco da conta (`conta.html` e passo "Enviar" do simulador). A entrada normal continua igual.

- **Área de cliente** (`cliente.html`): no ecrã de entrada aparece também um botão por **conta de cliente que existe nesta base** (o email e o nome; a lista desliza se for comprida). Com a casa ligada entra na casa dessa conta; sem casa ligada (o normal aqui, onde o `domus.sh` não corre) abre a sessão da conta e mostra a **pré-visualização** (a planta e o pedido, como um cliente verdadeiro vê); o botão pequeno por baixo, "↳ casa de teste (com aparelhos)", entra numa casa de teste (`conta-<id>`) sem abrir a sessão da conta. A lista vem de `POST /api/conta/dev/contas` (só id, email, nome e se tem casa) e a entrada de `POST /api/conta/dev/entrar {id}` — as duas só existem aqui, como as outras.
- `ACESSO_RAPIDO=0 npm start` desliga tudo (sem barra, as rotas dão 404).
- `ELETRICISTAS=0 npm start` desliga o módulo dos eletricistas externos, como no servidor a sério enquanto não for publicado (docs/ELETRICISTAS.md, "Interruptor"); por omissão o lançador local liga-o.
- Só funciona neste computador (`http://localhost:8080`, `*.localhost`, `127.0.0.1`). Não funciona pela rede: no endereço da rede local (porta 8090, telemóvel no mesmo Wi-Fi) as páginas não têm a barra e as rotas dão 404.
- No servidor a sério não existe: a barra é o `local/acesso-rapido.js` (que o `iniciar.js` junta às páginas; não está em `web/` nem em `painel/public/`) e o painel só liga as rotas com `ACESSO_RAPIDO=1` num ambiente local. Ver `docs/SEGURANCA.md`, "Acesso rápido".
