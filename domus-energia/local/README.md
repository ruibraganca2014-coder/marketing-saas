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
