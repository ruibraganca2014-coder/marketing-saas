#!/usr/bin/env bash
# Testa a app Android a falar com a caixa de casa (CaixaLigacaoTest): arranca dois Mosquitto com WebSocket, um a fazer
# de caixa (127.0.0.1:18841, como a porta 1884 do add-on) e outro de servidor (127.0.0.1:18842), com a casa "joao"
# retida nos dois, e corre o teste. O teste pára e volta a arrancar o "servidor" (docker stop/start).
# Uso: bash caixa/testar-app-caixa.sh   (precisa de Docker e do Android Studio: JAVA_HOME e ANDROID_HOME)
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash não pode trocar os caminhos de dentro do contentor
cd "$(dirname "$0")/.."
IMG=eclipse-mosquitto:2
limpar() { docker rm -f domus-teste-caixa domus-teste-servidor >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
t="$(mktemp)"; printf 'listener 1883\nlistener 1884\nprotocol websockets\nallow_anonymous true\n' > "$t"
if command -v cygpath >/dev/null; then t="$(cygpath -m "$t")"; fi
LISTA='[{"id":"sala","nome":"Sala","tipo":"openbeken","canais":[{"n":1,"funcao":"interruptor","nome":"Teto"}]},{"id":"estore","nome":"Estore","tipo":"shelly","canais":[{"n":1,"funcao":"interruptor","nome":"Luz"}]}]'
for par in domus-teste-caixa:18841 domus-teste-servidor:18842; do
  nome="${par%%:*}"; porta="${par##*:}"
  docker create --name "$nome" -p "127.0.0.1:$porta:1884" "$IMG" mosquitto -c /mosquitto/config/c.conf >/dev/null
  docker cp "$t" "$nome:/mosquitto/config/c.conf" >/dev/null
  docker start "$nome" >/dev/null
done
rm -f "$t"
sleep 2
pub() { docker exec "$1" mosquitto_pub -r -t "$2" -m "$3"; }
for n in domus-teste-caixa domus-teste-servidor; do
  pub "$n" domus/joao/_aparelhos "$LISTA"
  pub "$n" domus/joao/sala/connected online
  pub "$n" domus/joao/sala/1/get 0
done
pub domus-teste-caixa domus/joao/_ponte 0     # o _ponte da própria caixa não deve contar
pub domus-teste-servidor domus/joao/estore/online true

export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}"
cd android
DOMUS_CAIXA_TESTE=1 ./gradlew testDebugUnitTest --tests '*CaixaLigacaoTest*' --rerun --console=plain -q
echo "Tudo certo."
