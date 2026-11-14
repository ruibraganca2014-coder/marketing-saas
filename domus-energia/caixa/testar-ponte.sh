#!/usr/bin/env bash
# Testa caixa/ponte.conf com dois Mosquitto em Docker: "srv" faz de opancas.pt
# (com passwd e ACL como o domus.sh gera, e TLS na 8883 com um certificado de uma
# autoridade de teste) e "caixa" faz do Raspberry Pi (confia nessa autoridade).
# Uso: bash caixa/testar-ponte.sh   (precisa de Docker, openssl, Node e dos módulos do painel/; apaga tudo no fim)
set -euo pipefail
cd "$(dirname "$0")"
IMG=eclipse-mosquitto:2
NET=domus-ponte-teste
# Git Bash (Windows) troca /mosquitto/... por C:/Program Files/Git/mosquitto/...; os caminhos do contentor ficam como estão
export MSYS_NO_PATHCONV=1
novo_tmp() { TMP="$(mktemp -d)"; if command -v cygpath >/dev/null; then TMP="$(cygpath -m "$TMP")"; fi; }
novo_tmp
falhas=0

limpar() { docker rm -f ponte-srv ponte-caixa ponte-caixa-errada >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap limpar EXIT
limpar; novo_tmp
docker network create "$NET" >/dev/null

# --- servidor: utilizadores e ACL como no domus.sh, mais o utilizador da ponte
docker run --rm "$IMG" sh -c '
  for u in motor teste ponte-teste; do mosquitto_passwd -b /tmp/p "$u" segredo-$u 2>/dev/null || mosquitto_passwd -c -b /tmp/p "$u" segredo-$u; done
  cat /tmp/p' > "$TMP/passwd"
cat > "$TMP/acl" <<'EOF'
user motor
topic readwrite domus/#
user teste
topic read domus/teste/#
topic write domus/teste/_modo/set
topic write domus/teste/chayo/+/set
user ponte-teste
topic write domus/teste/_ponte
topic read domus/teste/_aparelhos
topic read domus/teste/_config
topic readwrite domus/teste/chayo/#
EOF
# TLS: autoridade de teste e certificado do servidor com o nome a que a caixa liga (ponte-srv)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/ca.key" -out "$TMP/ca.crt" -days 2 -subj "/CN=Domus CA de teste" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$TMP/srv.key" -out "$TMP/srv.csr" -subj "/CN=ponte-srv" 2>/dev/null
printf 'subjectAltName=DNS:ponte-srv\n' > "$TMP/san.ext"
openssl x509 -req -in "$TMP/srv.csr" -CA "$TMP/ca.crt" -CAkey "$TMP/ca.key" -CAcreateserial -out "$TMP/srv.crt" -days 2 -extfile "$TMP/san.ext" 2>/dev/null
# como o mosquitto.conf do servidor: 1883 para os aparelhos (e o motor deste teste), 8883 com TLS para as caixas
cat > "$TMP/srv.conf" <<'EOF'
listener 1883
listener 8883
certfile /mosquitto/config/srv.crt
keyfile /mosquitto/config/srv.key
tls_version tlsv1.2
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
EOF
docker create --name ponte-srv --network "$NET" "$IMG" sh -c \
  'chown mosquitto /mosquitto/config/srv.key && chmod 600 /mosquitto/config/srv.key && exec /docker-entrypoint.sh mosquitto -c /mosquitto/config/srv.conf' >/dev/null
for f in passwd acl srv.conf srv.crt srv.key; do docker cp "$TMP/$f" "ponte-srv:/mosquitto/config/$f" >/dev/null; done
docker start ponte-srv >/dev/null
sleep 1
# o que o motor e o domus.sh deixam retido antes de a caixa ligar: a lista e a config descem, o _caixa (login da app) não
srv_pub() { docker exec ponte-srv mosquitto_pub -u motor -P segredo-motor -r -t "$1" -m "$2"; }
srv_pub domus/teste/_aparelhos '[{"id":"chayo"}]'
srv_pub domus/teste/_config '{"personalizar":{}}'
srv_pub domus/teste/_caixa '{"endereco":"192.168.1.50"}'

# --- caixa: o ponte.conf verdadeiro, com os marcadores trocados; 1884 = WebSocket, como o add-on do Home Assistant
mkdir "$TMP/conf.d"
sed -e 's/CLIENTE/teste/g' -e 's/SERVIDOR/ponte-srv/' -e 's/SENHA_PONTE/segredo-ponte-teste/' ponte.conf > "$TMP/conf.d/ponte.conf"
printf 'listener 1883\nlistener 1884\nprotocol websockets\nallow_anonymous true\ninclude_dir /mosquitto/config/conf.d\n' > "$TMP/caixa.conf"
# <nome> <confia na CA de teste: 1/0> [mais opções do docker create]
criar_caixa() {
  local nome="$1" confia="$2"; shift 2
  docker create --name "$nome" --network "$NET" "$@" "$IMG" sh -c \
    'update-ca-certificates >/dev/null 2>&1; exec /docker-entrypoint.sh mosquitto -c /mosquitto/config/caixa.conf' >/dev/null
  docker cp "$TMP/caixa.conf" "$nome:/mosquitto/config/caixa.conf" >/dev/null
  docker cp "$TMP/conf.d" "$nome:/mosquitto/config/" >/dev/null
  if [ "$confia" = 1 ]; then docker cp "$TMP/ca.crt" "$nome:/usr/local/share/ca-certificates/domus-teste.crt" >/dev/null; fi
  docker start "$nome" >/dev/null
}

srv_sub() { docker exec ponte-srv mosquitto_sub -u motor -P segredo-motor -t "$1" -C "${2:-1}" -W "${3:-4}" 2>/dev/null || true; }

# Primeiro, uma caixa que NÃO confia na autoridade do servidor: com a verificação do certificado a funcionar, nunca liga.
criar_caixa ponte-caixa-errada 0
sleep 8
verifica_cedo="$(srv_sub domus/teste/_ponte 1 3)"
recusou="$(docker logs ponte-caixa-errada 2>&1 | grep -ci 'certificate verify failed' || true)"
docker rm -f ponte-caixa-errada >/dev/null

criar_caixa ponte-caixa 1 -p 127.0.0.1:18840:1884
sleep 3
caixa_sub() { docker exec ponte-caixa mosquitto_sub -t "$1" -C 1 -W 4 2>/dev/null || true; }
verifica() { if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas+1)); fi; }

verifica "caixa sem a autoridade do servidor não liga (certificado verificado)" "$verifica_cedo" ""
verifica "a caixa recusou o certificado" "$([ "$recusou" -gt 0 ] && echo sim || echo não)" sim
verifica "servidor sabe que a caixa está ligada por TLS (_ponte)" "$(srv_sub domus/teste/_ponte)" 1

# aparelho na caixa -> servidor
( sleep 1; docker exec ponte-caixa mosquitto_pub -t domus/teste/chayo/1/get -m 1 ) &
verifica "estado do aparelho chega ao servidor" "$(srv_sub domus/teste/chayo/1/get)" 1
wait

# app no servidor -> aparelho na caixa
( sleep 1; docker exec ponte-srv mosquitto_pub -u teste -P segredo-teste -t domus/teste/chayo/1/set -m 0 ) &
verifica "comando da app chega à caixa" "$(caixa_sub domus/teste/chayo/1/set)" 0
wait

# uma publicação = uma mensagem no servidor (sem eco da ponte)
( sleep 1; docker exec ponte-caixa mosquitto_pub -t domus/teste/chayo/2/get -m 1 ) &
n="$(srv_sub domus/teste/chayo/2/get 5 4 | wc -l | tr -d ' ')"
verifica "sem mensagens repetidas" "$n" 1
wait

# o que é da casa e não é de um aparelho (histórico, ntfy...) não desce para a caixa
( sleep 1; docker exec ponte-srv mosquitto_pub -u motor -P segredo-motor -t domus/teste/_historico -m '[]' ) &
verifica "o histórico não desce para a caixa" "$(caixa_sub domus/teste/_historico)" ""
wait

# a rede de casa NÃO pode mexer no alarme do servidor
( sleep 1; docker exec ponte-caixa mosquitto_pub -t domus/teste/_modo/set -m '{"modo":"casa"}' ) &
verifica "caixa não consegue mudar o modo no servidor" "$(srv_sub domus/teste/_modo/set)" ""
wait

# a app Android, sem internet, lê a casa na caixa: a lista e a config ficam retidas lá; o login da app não desce
verifica "a lista de aparelhos fica retida na caixa" "$(caixa_sub domus/teste/_aparelhos)" '[{"id":"chayo"}]'
verifica "a config fica retida na caixa" "$(caixa_sub domus/teste/_config)" '{"personalizar":{}}'
verifica "o login da app (_caixa) não desce para a caixa" "$(caixa_sub domus/teste/_caixa)" ""
# a app fala com a caixa por WebSocket (porta 1884 do add-on Mosquitto)
ws="$(node -e '
  const mqtt = require(process.argv[1]);
  const c = mqtt.connect("ws://127.0.0.1:18840/mqtt", { reconnectPeriod: 0, connectTimeout: 4000 });
  const fim = (t) => { console.log(t); c.end(true); process.exit(0); };
  c.on("connect", () => c.subscribe("domus/teste/_aparelhos"));
  c.on("message", (_t, m) => fim(String(m)));
  c.on("error", (e) => fim("erro " + e.message));
  setTimeout(() => fim("tempo"), 5000);' "$(cd ../painel/node_modules/mqtt && pwd -W 2>/dev/null || pwd)")"
verifica "a app lê a caixa por WebSocket" "$ws" '[{"id":"chayo"}]'

# casa fica sem internet -> o servidor dá pela falta em ~1,5 x keepalive e põe _ponte = 0
docker network disconnect "$NET" ponte-caixa
v=1
for _ in $(seq 1 25); do v="$(srv_sub domus/teste/_ponte)"; [ "$v" = 0 ] && break; sleep 2; done
verifica "servidor sabe que a casa ficou sem internet" "$v" 0
verifica "sem internet, a caixa ainda tem a lista" "$(caixa_sub domus/teste/_aparelhos)" '[{"id":"chayo"}]'
echo "info  _ponte na própria caixa sem internet: '$(caixa_sub domus/teste/_ponte)' (a app ligada à caixa ignora-o)"

[ "$falhas" -eq 0 ] && echo "Tudo certo." || { echo "$falhas falha(s)."; exit 1; }
