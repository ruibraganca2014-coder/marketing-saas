#!/usr/bin/env bash
# =============================================================================
# testes/mqtt-tls.sh — testa o ./domus.sh mqtt-tls com Docker a sério: o serviço
# mosquitto tal como está no docker-compose.yml (só as portas mudam) e um Caddy
# com certificado interno para "teste.localhost". Verifica:
#   - se o Mosquitto não arranca com o TLS, volta atrás (sem tls.conf) e fica a correr;
#   - a primeira vez copia o certificado, ativa a 8883 e o TLS responde com ele;
#   - a segunda vez não muda nada nem reinicia o Mosquitto.
# Uso: bash testes/mqtt-tls.sh   (precisa de Docker e openssl; apaga tudo no fim)
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash não pode trocar os caminhos de dentro dos contentores
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; if command -v cygpath >/dev/null; then T="$(cygpath -m "$T")"; fi
OK=0; FALHAS=0
passa() { echo "  ok    $1"; OK=$((OK + 1)); }
falha() { echo "  FALHA $1"; FALHAS=$((FALHAS + 1)); }
export COMPOSE_PROJECT_NAME=domus-tls-teste   # o mesmo projeto para este teste e para o domus.sh
dc() { docker compose -f "$T/docker-compose.yml" --project-directory "$T" "$@"; }
limpar() { dc down -v >/dev/null 2>&1; rm -rf "$T"; }
trap limpar EXIT

# --- Uma cópia mínima da pasta servidor/ -------------------------------------
cp "$AQUI/domus.sh" "$T/"
mkdir -p "$T/mosquitto/conf.d" "$T/dados/mosquitto"
cp "$AQUI/mosquitto/mosquitto.conf" "$T/mosquitto/"
cp "$AQUI/mosquitto/conf.d/tls.conf.exemplo" "$T/mosquitto/conf.d/"
printf 'DOMUS_HOST=teste.localhost\n' > "$T/.env"
{
  echo "services:"
  sed -n '/^  mosquitto:$/,/^    logging: &registos$/p' "$AQUI/docker-compose.yml" | sed '$d' \
    | sed -e 's|"1883:1883"|"127.0.0.1:18883:1883"|' -e 's|"8883:8883"|"127.0.0.1:18884:8883"|'
  cat <<'EOF'
  caddy:
    image: caddy:2
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
volumes:
  caddy_data:
EOF
} > "$T/docker-compose.yml"
printf '{\n  local_certs\n  skip_install_trust\n}\nteste.localhost {\n  respond "ok"\n}\n' > "$T/Caddyfile"
cd "$T"

dc up -d mosquitto caddy >/dev/null 2>&1 || { echo "docker compose up falhou"; exit 2; }
for _ in $(seq 1 30); do
  dc exec -T caddy sh -c 'ls /data/caddy/certificates/*/teste.localhost/teste.localhost.crt' >/dev/null 2>&1 && break; sleep 1
done
iniciado() { docker inspect -f '{{.State.StartedAt}}' "$(dc ps -q mosquitto)"; }
# a correr e sem reiniciar em ciclo (entre dois reinícios o contentor também aparece "running")
a_correr() {
  local id e1 e2; id="$(dc ps -q mosquitto)"
  e1="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id" 2>/dev/null)"; sleep 5
  e2="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id" 2>/dev/null)"
  [[ "$e1" == running* && "$e1" == "$e2" ]]
}
tls_responde() { # o certificado que a 8883 apresenta tem o nome do servidor
  openssl s_client -connect 127.0.0.1:18884 -servername teste.localhost </dev/null 2>/dev/null \
    | openssl x509 -noout -ext subjectAltName 2>/dev/null | grep -q 'teste.localhost'
}

echo "mqtt-tls:"
# 1) O Mosquitto não aceita o TLS (aqui: uma versão de TLS que não existe) -> volta atrás e continua a correr.
cp mosquitto/conf.d/tls.conf.exemplo "$T/exemplo.bom"
sed -i 's/^tls_version .*/tls_version tlsv9/' mosquitto/conf.d/tls.conf.exemplo
saida="$(./domus.sh mqtt-tls 2>&1)"; r=$?
if (( r != 0 )) && [[ "$saida" == *"voltou ao de antes e está a correr"* ]]; then passa "TLS que não arranca: avisa e volta atrás"; else falha "TLS mau: r=$r $saida"; fi
if [[ ! -f mosquitto/conf.d/tls.conf ]] && a_correr; then passa "sem tls.conf e o Mosquitto a correr (a 1883 não caiu)"; else falha "depois de voltar atrás: $(ls mosquitto/conf.d) a correr=$(a_correr && echo sim || echo não)"; fi
cp "$T/exemplo.bom" mosquitto/conf.d/tls.conf.exemplo

# 2) A sério: copia o certificado do Caddy e ativa a 8883.
saida="$(./domus.sh mqtt-tls 2>&1)"; r=$?
if (( r == 0 )) && [[ "$saida" == *"TLS do MQTT ativo na porta 8883"* ]]; then passa "ativa o TLS"; else falha "ativar: r=$r $saida"; fi
if [[ -f mosquitto/conf.d/tls.conf && -f mosquitto/certs/fullchain.pem && -f mosquitto/certs/privkey.pem ]]; then passa "tls.conf e certificados no sítio"; else falha "ficheiros: $(ls -R mosquitto)"; fi
if a_correr && tls_responde; then passa "a 8883 responde com o certificado de teste.localhost"; else falha "a 8883 não responde com TLS"; fi

# 3) Outra vez: nada mudou, não reinicia.
antes="$(iniciado)"
saida="$(./domus.sh mqtt-tls 2>&1)"; r=$?
if (( r == 0 )) && [[ "$saida" == *"não mudou"* && "$(iniciado)" == "$antes" ]]; then passa "sem mudanças: não reinicia o Mosquitto"; else falha "segunda vez: r=$r $saida"; fi

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
