#!/usr/bin/env bash
# Home Assistant de demonstração em Docker, ligado à casa "casa-t1" (a casa do dono) do lançador local.
# Precisa do lançador a correr (cd local && npm start) e do Docker.
#
#   bash caixa/demo-ha.sh          -> http://localhost:8123, painel "Casa Domus" (entra sozinho a partir deste PC)
#   bash caixa/demo-ha.sh parar    -> pára e apaga o contentor (os dados ficam no volume domus-ha-demo;
#                                     "docker volume rm domus-ha-demo" apaga tudo e a próxima vez começa do zero)
#
# Fala diretamente com o broker local, sem caixa nem ponte: serve para ver dashboards e controlo, não testa a ponte.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash não pode trocar os caminhos de dentro do contentor
cd "$(dirname "$0")"
NOME=domus-ha-demo
URL=http://127.0.0.1:8123
LOGIN=../local/dados/home-assistant-login.txt
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]??""))' "$1"; }

docker rm -f "$NOME" >/dev/null 2>&1 || true
if [ "${1:-}" = parar ]; then echo "Parado."; exit 0; fi

docker create --name "$NOME" -p 127.0.0.1:8123:8123 -v "$NOME:/config" -e TZ=Europe/Lisbon \
  ghcr.io/home-assistant/home-assistant:stable >/dev/null
docker cp demo-ha/configuration.yaml "$NOME:/config/configuration.yaml" >/dev/null
docker cp demo-ha/casa.yaml "$NOME:/config/casa.yaml" >/dev/null
docker start "$NOME" >/dev/null
echo "A arrancar o Home Assistant (a primeira vez demora 1 a 2 minutos)..."
for _ in $(seq 1 90); do curl -fs "$URL/manifest.json" >/dev/null 2>&1 && break; sleep 2; done
passos="$(curl -s "$URL/api/onboarding")"   # depois da primeira vez dá 404

# Primeira vez: cria o dono (palavra-passe nova, guardada em local/dados, que não vai para o git) e liga o MQTT
if echo "$passos" | grep -q '"step":"user","done":false'; then
  senha="$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')"
  CID="$URL/"
  codigo="$(curl -fs -X POST "$URL/api/onboarding/users" -H 'Content-Type: application/json' \
    -d "{\"client_id\":\"$CID\",\"name\":\"Domus\",\"username\":\"domus\",\"password\":\"$senha\",\"language\":\"pt\"}" | json auth_code)"
  printf 'Home Assistant de demonstração (http://localhost:8123)\nutilizador: domus\npalavra-passe: %s\n' "$senha" > "$LOGIN"
  token="$(curl -fs -X POST "$URL/auth/token" -d grant_type=authorization_code -d "code=$codigo" -d "client_id=$CID" | json access_token)"
  H="Authorization: Bearer $token"
  curl -fs -X POST "$URL/api/onboarding/core_config" -H "$H" >/dev/null
  curl -fs -X POST "$URL/api/onboarding/analytics" -H "$H" >/dev/null
  curl -fs -X POST "$URL/api/onboarding/integration" -H "$H" -H 'Content-Type: application/json' \
    -d "{\"client_id\":\"$CID\",\"redirect_uri\":\"$URL/?auth_callback=1\"}" >/dev/null
  # o broker do lançador (aedes) aceita qualquer login e só fala MQTT 3.1.1 (local/README.md)
  fluxo="$(curl -fs -X POST "$URL/api/config/config_entries/flow" -H "$H" -H 'Content-Type: application/json' -d '{"handler":"mqtt"}' | json flow_id)"
  resposta="$(curl -s -X POST "$URL/api/config/config_entries/flow/$fluxo" -H "$H" -H 'Content-Type: application/json' \
    -d '{"broker":"host.docker.internal","port":1883,"protocol":"3.1.1","username":"admin","password":"local","other_settings":{"set_client_cert":false,"set_ca_cert":"off"}}')"
  [ "$(echo "$resposta" | json type)" = create_entry ] || { echo "MQTT não ficou ligado: $resposta" >&2; exit 1; }
fi
echo "Pronto: http://localhost:8123/casa-domus/casa"
