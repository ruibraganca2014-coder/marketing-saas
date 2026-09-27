#!/usr/bin/env bash
# =============================================================================
# instalar.sh — instala (ou atualiza) o servidor Domus Energia num VPS com um
# só comando: Docker, código, .env com segredos gerados, firewall, utilizadores
# internos (admin, motor, pagamentos, painel), temporizadores systemd e os
# serviços (Mosquitto, Caddy, ntfy, motor, pagamentos, painel).
#
# Sistemas: Ubuntu 22.04/24.04 (ou mais recente) e Debian 12 (ou mais recente).
# Corre como root (ou com sudo). Pode ser corrido de novo: não apaga nada, não
# muda o .env existente e só cria o que falta.
#
#   curl -fsSL https://raw.githubusercontent.com/ruibraganca2014-coder/marketing-saas/claude/kind-babbage-gdmaij/domus-energia/servidor/instalar.sh \
#     | sudo bash -s -- --email ceo@exemplo.pt
#   sudo bash instalar.sh --email ceo@exemplo.pt       (a partir de um clone)
#   sudo bash instalar.sh --atualizar                  (atualizar mais tarde)
#   bash instalar.sh --simular --host 51-38-10-20.sslip.io  (ensaio: não muda nada)
# =============================================================================
set -euo pipefail

REPO_OMISSAO="https://github.com/ruibraganca2014-coder/marketing-saas.git"
BRANCH_OMISSAO="claude/kind-babbage-gdmaij"
DIR_OMISSAO="/opt/domus"
UID_SERVICOS=1000                 # utilizador "node" dos contentores (motor, pagamentos, painel)
SERVICOS="caddy mosquitto motor ntfy pagamentos painel"

REPO="$REPO_OMISSAO"
BRANCH="$BRANCH_OMISSAO"
BRANCH_DADO=0
DIR=""
CLONE_LOCAL=0                     # 1 = o script corre dentro de um clone do utilizador
HOST=""
EMAIL=""
SIMULAR=0
ATUALIZAR=0
SEM_PERGUNTAS=0
SERV=""                           # <repositório>/domus-energia/servidor
CEO_SENHA=""                      # palavra-passe gerada (mostrada uma única vez)
HTTPS_OK=0

# -----------------------------------------------------------------------------
# Mensagens
# -----------------------------------------------------------------------------
passo() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
aviso() { printf '    AVISO: %s\n' "$*" >&2; }
erro() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

ajuda() {
  cat <<EOF
Instala (ou atualiza) o servidor Domus Energia neste VPS.

Uso:
  curl -fsSL <raw>/domus-energia/servidor/instalar.sh | sudo bash -s -- [opções]
  sudo bash instalar.sh [opções]

Opções:
  --host NOME       DOMUS_HOST (ex.: 51-38-10-20.sslip.io ou mqtt.domusenergia.pt).
                    Sem esta opção usa o IP público: <ip-com-hífenes>.sslip.io.
                    Só é usado na 1.ª instalação (depois manda o .env).
  --email EMAIL     email do CEO do painel da empresa; a palavra-passe é gerada
                    e mostrada uma única vez no fim.
  --repo URL        repositório git (por omissão $REPO_OMISSAO)
  --branch NOME     branch (por omissão $BRANCH_OMISSAO)
  --dir PASTA       onde fica o código (por omissão $DIR_OMISSAO; a partir de
                    um clone, o próprio clone)
  --atualizar       só atualiza: git pull, pastas, utilizadores internos em
                    falta, serviços (docker compose up -d --build) e
                    temporizadores. Exige uma instalação feita.
  --simular         ensaio: mostra o que faria, sem instalar nem mudar nada
  -y, --sim         não faz perguntas (aceita o endereço proposto)
  -h, --help        esta ajuda

Pode ser corrido de novo sem perigo: o .env existente nunca é alterado, os
utilizadores internos só são criados se faltarem e o CEO só uma vez por email.
EOF
}

# -----------------------------------------------------------------------------
# Utilitários
# -----------------------------------------------------------------------------
# Corre um comando (ou, a simular, só o mostra).
correr() {
  if (( SIMULAR )); then printf '    [simular] %s\n' "$*"; else "$@"; fi
}

tem() { command -v "$1" >/dev/null 2>&1; }

segredo() { openssl rand -hex "$1"; }

# Palavra-passe legível (letras e dígitos), com <n> caracteres.
senha_legivel() {
  local s=""
  while (( ${#s} < $1 )); do s+="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9')"; done
  printf '%s' "${s:0:$1}"
}

# Pergunta no terminal (mesmo com "curl | bash"). <pergunta> <valor proposto>
perguntar() {
  local r=""
  if (( SEM_PERGUNTAS || SIMULAR )) || [[ ! -t 1 ]] || ! { : </dev/tty; } 2>/dev/null; then
    printf '%s' "$2"; return 0
  fi
  read -r -p "    $1 [$2]: " r </dev/tty || true
  printf '%s' "${r:-$2}"
}

# Lê uma variável do .env (sem o executar). <ficheiro> <nome>
ler_env() {
  [[ -f "$1" ]] || return 0
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1 | sed 's/[[:space:]]#.*$//; s/[[:space:]]*$//; s/^"\(.*\)"$/\1/'
}

compose() { docker compose "$@"; }

# git como root numa pasta de outro dono (clone do utilizador) sem o erro
# "dubious ownership"; os comandos que escrevem correm como o dono da pasta.
g() { git -c safe.directory='*' "$@"; }
g_dono() {
  local dono
  dono="$(stat -c %U "$DIR" 2>/dev/null || echo root)"
  if [[ "$dono" != root && "$dono" != UNKNOWN ]] && (( EUID == 0 )); then
    correr runuser -u "$dono" -- git "$@"
  else
    correr git "$@"
  fi
}

validar_email() {
  local re='^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$'
  [[ -z "$EMAIL" || "$EMAIL" =~ $re ]] || erro "email inválido: '$EMAIL'"
}

a_correr() { # imprime os serviços a correr, um por linha
  compose ps --status running --services 2>/dev/null | sort || true
}

# -----------------------------------------------------------------------------
# Passos
# -----------------------------------------------------------------------------
ler_opcoes() {
  while (( $# )); do
    case "$1" in
      --host|--email|--repo|--branch|--dir) (( $# >= 2 )) || erro "falta o valor de $1" ;;
    esac
    case "$1" in
      --host)      HOST="$2"; shift ;;
      --email)     EMAIL="$2"; shift ;;
      --repo)      REPO="$2"; shift ;;
      --branch)    BRANCH="$2"; BRANCH_DADO=1; shift ;;
      --dir)       DIR="$2"; shift ;;
      --atualizar) ATUALIZAR=1 ;;
      --simular|--dry-run) SIMULAR=1 ;;
      -y|--sim)    SEM_PERGUNTAS=1 ;;
      -h|--help)   ajuda; exit 0 ;;
      *) ajuda >&2; erro "opção desconhecida: $1" ;;
    esac
    shift
  done
  HOST="${HOST,,}"
  if [[ -n "$HOST" && ! "$HOST" =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]]; then erro "--host inválido: '$HOST'"; fi
  validar_email
  [[ -n "$REPO" && -n "$BRANCH" ]] || erro "--repo e --branch não podem ficar vazios"
  [[ "$BRANCH" != -* ]] || erro "--branch inválido: '$BRANCH'"
}

verificar_root() {
  (( EUID == 0 )) && return 0
  if (( SIMULAR )); then aviso "não é root (a simular, continua)"; return 0; fi
  erro "corra como root: sudo bash instalar.sh ...  (ou curl ... | sudo bash -s -- ...)"
}

verificar_so() {
  passo "Sistema operativo"
  local id="" ver=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
    # shellcheck disable=SC1091
    ver="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  fi
  local maior="${ver%%.*}"
  case "$id" in
    ubuntu) [[ "$maior" =~ ^[0-9]+$ ]] && (( maior >= 22 )) && { info "Ubuntu $ver"; [[ "$ver" == 22.04 || "$ver" == 24.04 ]] || aviso "versão não testada (testadas: 22.04 e 24.04)"; return 0; } ;;
    debian) [[ "$maior" =~ ^[0-9]+$ ]] && (( maior >= 12 )) && { info "Debian $ver"; [[ "$maior" == 12 ]] || aviso "versão não testada (testada: 12)"; return 0; } ;;
  esac
  if (( SIMULAR )); then aviso "sistema '${id:-desconhecido} $ver' não suportado (a simular, continua)"; return 0; fi
  erro "sistema '${id:-desconhecido} $ver' não suportado. Use Ubuntu 22.04/24.04 ou Debian 12."
}

instalar_pacotes() {
  passo "Pacotes (git, curl, openssl) e Docker"
  local falta=() p
  for p in git curl openssl flock; do tem "$p" || falta+=("$p"); done
  if (( ${#falta[@]} )); then
    info "a instalar: ${falta[*]}"
    correr env DEBIAN_FRONTEND=noninteractive apt-get update -q
    correr env DEBIAN_FRONTEND=noninteractive apt-get install -y -q ca-certificates curl git openssl util-linux
  else
    info "git, curl e openssl já instalados"
  fi
  if tem docker && docker compose version >/dev/null 2>&1; then
    info "Docker já instalado ($(docker compose version --short 2>/dev/null || echo compose))"
  else
    info "a instalar o Docker (script oficial get.docker.com)"
    if (( SIMULAR )); then
      correr sh -c "curl -fsSL https://get.docker.com | sh"
    else
      curl -fsSL https://get.docker.com | sh
    fi
  fi
  correr systemctl enable --now docker
}

# Pasta do código: --dir, o clone onde está este script, ou /opt/domus.
escolher_pasta() {
  local aqui="" topo=""
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$aqui/docker-compose.yml" ]] && tem git; then
      topo="$(g -C "$aqui" rev-parse --show-toplevel 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$DIR" && -n "$topo" ]]; then
    DIR="$topo"; CLONE_LOCAL=1
    # Num clone do utilizador fica o branch em que está (salvo --branch).
    if (( ! BRANCH_DADO )); then BRANCH="$(g -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$BRANCH")"; fi
  fi
  DIR="${DIR:-$DIR_OMISSAO}"
  SERV="$DIR/domus-energia/servidor"
}

obter_codigo() {
  passo "Código ($REPO, branch $BRANCH) em $DIR"
  if [[ -d "$DIR/.git" ]]; then
    (( CLONE_LOCAL )) && info "a usar o clone onde está este script"
    if [[ -n "$(g -C "$DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
      aviso "há alterações locais em $DIR: o código não é atualizado (git stash e corra de novo)"
      return 0
    fi
    g_dono -C "$DIR" fetch --quiet origin "$BRANCH"
    if [[ "$(g -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" != "$BRANCH" ]]; then
      g_dono -C "$DIR" checkout --quiet "$BRANCH"
    fi
    g_dono -C "$DIR" merge --ff-only --quiet FETCH_HEAD
    info "código em $(g -C "$DIR" log -1 --format='%h de %cs' 2>/dev/null || echo '?')"
  elif [[ -e "$DIR" && -n "$(ls -A "$DIR" 2>/dev/null)" ]]; then
    erro "$DIR existe e não é um repositório git. Use --dir <outra pasta>."
  else
    (( ATUALIZAR )) && erro "não há instalação em $DIR (corra sem --atualizar)"
    correr git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
    info "código copiado para $DIR"
  fi
  if (( ! SIMULAR )); then
    [[ -f "$SERV/docker-compose.yml" && -f "$SERV/domus.sh" ]] || erro "não encontrei $SERV/docker-compose.yml (repositório ou branch errados?)"
  fi
}

detetar_ip() {
  local ip="" url
  for url in https://api.ipify.org https://ifconfig.me https://icanhazip.com; do
    ip="$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && { printf '%s' "$ip"; return 0; }
  done
  # Sem "hostname -I": na Oracle o IP da placa de rede é privado (NAT).
  return 1
}

escolher_host() {
  passo "Endereço do servidor (DOMUS_HOST)"
  local env_host
  env_host="$(ler_env "$SERV/.env" DOMUS_HOST)"
  if [[ -n "$env_host" ]]; then
    if [[ -n "$HOST" && "$HOST" != "$env_host" ]]; then
      aviso "o .env já tem DOMUS_HOST=$env_host e não é alterado (para mudar: edite $SERV/.env e corra de novo)"
    fi
    HOST="$env_host"
    info "$HOST (do .env)"
    return 0
  fi
  if [[ -z "$HOST" ]]; then
    local ip
    ip="$(detetar_ip || true)"
    if [[ -z "$ip" ]]; then
      (( SIMULAR )) || erro "não consegui descobrir o IP público. Use --host <nome>."
      ip="203.0.113.10"; aviso "IP público desconhecido (a simular: uso $ip)"
    fi
    HOST="$(perguntar "Endereço do servidor" "${ip//./-}.sslip.io")"
    HOST="${HOST,,}"
    [[ "$HOST" =~ ^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$ ]] || erro "endereço inválido: '$HOST'"
  fi
  info "$HOST"
  if [[ "$HOST" != *.sslip.io ]]; then
    info "domínio próprio: são precisos dois registos DNS do tipo A para o IP do VPS: $HOST e ntfy.$HOST"
  fi
}

criar_env() {
  passo "Configuração ($SERV/.env)"
  local env="$SERV/.env"
  if [[ -f "$env" ]]; then
    info "já existe: não é alterado"
    local k v
    for k in MOTOR_MQTT_PASS NTFY_MOTOR_PASS PAGAMENTOS_MQTT_PASS PAINEL_MQTT_PASS SESSAO_SEGREDO; do
      v="$(ler_env "$env" "$k")"
      if [[ -z "$v" || "$v" == troca-isto* ]]; then aviso "$k está vazio ou por preencher no .env"; fi
    done
    return 0
  fi
  local chaves="DOMUS_HOST MOTOR_MQTT_PASS NTFY_MOTOR_PASS PAGAMENTOS_MQTT_PASS PAINEL_MQTT_PASS SESSAO_SEGREDO"
  if (( SIMULAR )); then
    info "[simular] criar a partir de .env.example (modo 600) com: $chaves"
    info "[simular] palavras-passe: openssl rand -hex 16; SESSAO_SEGREDO: openssl rand -hex 32"
    return 0
  fi
  local tmp
  tmp="$(mktemp "$SERV/.env.XXXXXX")"
  chmod 600 "$tmp"
  awk -v host="$HOST" \
      -v motor="$(segredo 16)" -v ntfy="$(segredo 16)" -v pag="$(segredo 16)" \
      -v painel="$(segredo 16)" -v sessao="$(segredo 32)" '
    /^DOMUS_HOST=/           { print "DOMUS_HOST=" host; next }
    /^MOTOR_MQTT_PASS=/      { print "MOTOR_MQTT_PASS=" motor; next }
    /^NTFY_MOTOR_PASS=/      { print "NTFY_MOTOR_PASS=" ntfy; next }
    /^PAGAMENTOS_MQTT_PASS=/ { print "PAGAMENTOS_MQTT_PASS=" pag; next }
    /^PAINEL_MQTT_PASS=/     { print "PAINEL_MQTT_PASS=" painel; next }
    /^SESSAO_SEGREDO=/       { print "SESSAO_SEGREDO=" sessao; next }
    { print }
  ' "$SERV/.env.example" > "$tmp"
  local k
  for k in $chaves; do
    [[ -n "$(ler_env "$tmp" "$k")" ]] || { rm -f "$tmp"; erro "o .env.example não tem a linha $k="; }
  done
  mv -n "$tmp" "$env" || true
  [[ ! -e "$tmp" ]] || { rm -f "$tmp"; erro "$env apareceu entretanto: não foi alterado"; }
  info "criado com palavras-passe geradas (modo 600, só o root lê)"
}

# Pastas de dados com os donos certos ANTES do Docker (senão ficam do root).
preparar_pastas() {
  passo "Pastas de dados"
  local d="$SERV/dados" p
  correr mkdir -p "$d/mosquitto" "$d/ntfy" "$d/motor" "$d/planos" "$d/pagamentos" \
    "$d/painel" "$d/pedidos-admin" "$d/clientes" "$SERV/config-site"
  correr chmod 700 "$d"
  for p in motor planos pagamentos painel; do
    correr chown "$UID_SERVICOS:$UID_SERVICOS" "$d/$p"
  done
  correr chmod 700 "$d/painel"
  correr chown "0:$UID_SERVICOS" "$d/pedidos-admin" "$d/clientes"
  correr chmod 1770 "$d/pedidos-admin"
  correr chmod 750 "$d/clientes"
  info "motor, planos, pagamentos, painel: uid $UID_SERVICOS; pedidos-admin: root:$UID_SERVICOS 1770; clientes: root:$UID_SERVICOS 750"
}

# config.js do site com o endereço MQTT deste servidor (servido pelo Caddy no
# lugar do web/config.js, sem mexer no código do git).
gerar_config_site() {
  passo "config.js do site (wss://$HOST/mqtt)"
  local orig="$DIR/domus-energia/web/config.js" dest="$SERV/config-site/config.js"
  if (( SIMULAR )); then
    info "[simular] $orig -> $dest (SEU-SERVIDOR -> $HOST)"
    return 0
  fi
  mkdir -p "$SERV/config-site"
  sed "s#wss://SEU-SERVIDOR/mqtt#wss://$HOST/mqtt#" "$orig" > "$dest.novo"
  chmod 644 "$dest.novo"
  mv -f "$dest.novo" "$dest"
  info "$dest"
}

abrir_firewall() {
  passo "Firewall (portas 22, 80, 443, 443/udp e 1883)"
  if tem ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
    local r
    for r in 22/tcp 80/tcp 443/tcp 443/udp 1883/tcp; do correr ufw allow "$r"; done
    info "ufw: portas abertas"
  else
    info "ufw inativo ou ausente (nada a fazer)"
  fi
  # Imagens Ubuntu da Oracle Cloud: iptables com um REJECT no fim do INPUT.
  if tem iptables && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
    local pos regra proto porta
    for regra in tcp:80 tcp:443 udp:443 tcp:1883; do
      proto="${regra%%:*}"; porta="${regra##*:}"
      if iptables -C INPUT -p "$proto" -m state --state NEW --dport "$porta" -j ACCEPT 2>/dev/null; then continue; fi
      pos="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
      correr iptables -I INPUT "${pos:-1}" -p "$proto" -m state --state NEW --dport "$porta" -j ACCEPT
    done
    gravar_regras_v4
    info "iptables (imagem Oracle): portas abertas"
  fi
  info "Lembrete: abra as mesmas portas na firewall do fornecedor (Oracle: Security List; Hetzner: Firewalls)."
}

# Grava as regras em /etc/iptables/rules.v4 (antes do REJECT do INPUT), sem
# "netfilter-persistent save": isso gravaria também as regras do Docker, que
# ficariam duplicadas/obsoletas no arranque seguinte.
gravar_regras_v4() {
  local f=/etc/iptables/rules.v4 regra proto porta linha novas=""
  if [[ ! -f "$f" ]]; then
    aviso "sem $f: as regras abertas agora perdem-se ao reiniciar (ver README §2)"
    return 0
  fi
  for regra in tcp:80 tcp:443 udp:443 tcp:1883; do
    proto="${regra%%:*}"; porta="${regra##*:}"
    linha="-A INPUT -p $proto -m state --state NEW -m $proto --dport $porta -j ACCEPT"
    grep -qxF -- "$linha" "$f" || novas+="$linha"$'\n'
  done
  [[ -n "$novas" ]] || return 0
  grep -q '^-A INPUT .*-j REJECT' "$f" || { aviso "$f sem REJECT no INPUT: não alterado"; return 0; }
  if (( SIMULAR )); then info "[simular] acrescentar a $f, antes do REJECT: ${novas//$'\n'/; }"; return 0; fi
  cp -p "$f" "$f.domus-antes"
  NOVAS="$novas" awk '!feito && /^-A INPUT .*-j REJECT/ { printf "%s", ENVIRON["NOVAS"]; feito = 1 } { print }' "$f.domus-antes" > "$f"
  info "regras gravadas em $f (cópia anterior: $f.domus-antes)"
}

esperar_servicos() { # <segundos> <serviço>...
  local limite="$1" s falta t
  shift
  (( SIMULAR )) && return 0
  for (( t = 0; t < limite; t += 2 )); do
    falta=""
    for s in "$@"; do grep -qx "$s" <<< "$(a_correr)" || falta+=" $s"; done
    [[ -z "$falta" ]] && return 0
    sleep 2
  done
  aviso "ao fim de ${limite}s ainda não estão a correr:$falta (veja: cd $SERV && docker compose logs$falta)"
  return 1
}

# admin, motor, pagamentos e painel no Mosquitto/ntfy (só os que faltam).
criar_utilizadores() {
  passo "Utilizadores internos (admin, motor, pagamentos, painel)"
  correr docker compose up -d mosquitto ntfy
  esperar_servicos 90 mosquitto ntfy || erro "o Mosquitto ou o ntfy não arrancaram"
  (( SIMULAR )) || sleep 3   # o ntfy cria o auth.db no arranque
  if [[ ! -s "$SERV/dados/admin.senha" ]]; then
    if (( SIMULAR )); then
      info "[simular] printf '<senha gerada>\\n' | ./domus.sh admin   (cria também motor, pagamentos e painel)"
    else
      segredo 16 | ./domus.sh admin
    fi
  else
    info "admin já existe"
    [[ -e "$SERV/dados/.motor" ]] || correr ./domus.sh motor
    [[ -e "$SERV/dados/.pagamentos" ]] || correr ./domus.sh pagamentos
    [[ -e "$SERV/dados/.painel" ]] || correr ./domus.sh painel-mqtt
  fi
}

instalar_temporizadores() {
  passo "Temporizadores systemd (planos: 1 min; pedidos do painel: 5 s)"
  local f nome
  for f in "$SERV"/systemd/*.service "$SERV"/systemd/*.timer; do
    nome="${f##*/}"
    if (( SIMULAR )); then
      info "[simular] $nome -> /etc/systemd/system/$nome (pasta: $SERV)"
    else
      sed "s#/home/ubuntu/domus-energia/servidor#$SERV#g" "$f" > "/etc/systemd/system/$nome"
      chmod 644 "/etc/systemd/system/$nome"
    fi
  done
  correr systemctl daemon-reload
  correr systemctl enable --quiet domus-planos.timer domus-pedidos.timer
  correr systemctl restart domus-planos.timer domus-pedidos.timer
  if [[ -f /etc/cron.d/domus-planos ]]; then
    aviso "existe /etc/cron.d/domus-planos (alternativa em cron): apague-o para não correr duas vezes"
  fi
  info "ver: systemctl list-timers 'domus-*'"
}

arrancar() {
  passo "Serviços (docker compose up -d --build) — a 1.ª vez demora alguns minutos"
  correr docker compose pull --quiet --ignore-buildable || aviso "não foi possível atualizar as imagens (continua com as que há)"
  correr docker compose up -d --build --remove-orphans || erro "docker compose up falhou (ver as mensagens acima)"
  # shellcheck disable=SC2086
  esperar_servicos 180 $SERVICOS || true
  if (( ! SIMULAR )); then
    info "a pedir o certificado HTTPS (até 3 minutos)..."
    local t
    for (( t = 0; t < 180; t += 5 )); do
      if curl -fsS -o /dev/null --max-time 5 "https://$HOST/"; then HTTPS_OK=1; break; fi
      sleep 5
    done
    if (( HTTPS_OK )); then info "https://$HOST/ responde"; else
      aviso "https://$HOST/ ainda não responde: portas 80/443 abertas no fornecedor? DNS? (docker compose logs caddy)"
    fi
  fi
}

criar_ceo() {
  [[ -n "$EMAIL" ]] || return 0
  passo "CEO do painel ($EMAIL)"
  local marca="$SERV/dados/.painel-ceo" saida
  if [[ -f "$marca" ]] && grep -qxF "$EMAIL" "$marca"; then
    info "já foi criado por este instalador (para repor a palavra-passe: sudo ./domus.sh painel-utilizador $EMAIL ceo)"
    return 0
  fi
  if (( SIMULAR )); then
    info "[simular] printf '<senha gerada>\\n' | ./domus.sh painel-utilizador $EMAIL ceo CEO"
    return 0
  fi
  CEO_SENHA="$(senha_legivel 20)"
  if saida="$(printf '%s\n' "$CEO_SENHA" | DOMUS_ESPERA_PAINEL=90 ./domus.sh painel-utilizador "$EMAIL" ceo "CEO" 2>&1)"; then
    printf '%s\n' "$saida" | sed 's/^/    /'
    printf '%s\n' "$EMAIL" >> "$marca"
    chmod 600 "$marca"
    if [[ "$saida" != *"criado/atualizado"* ]]; then
      aviso "o painel ainda não confirmou: o pedido fica 1 h à espera; a palavra-passe abaixo vale quando for aplicado"
    fi
  else
    printf '%s\n' "$saida" | sed 's/^/    /' >&2
    CEO_SENHA=""
    aviso "não foi possível criar o CEO; depois corra: cd $SERV && sudo ./domus.sh painel-utilizador $EMAIL ceo"
  fi
}

resumo() {
  local linha="============================================================================="
  printf '\n%s\n Domus Energia instalada%s\n%s\n' "$linha" "$( (( SIMULAR )) && printf ' (SIMULAÇÃO: nada foi alterado)')" "$linha"
  cat <<EOF
 Site ................ https://$HOST/
 Área de cliente ..... https://$HOST/cliente.html
 Simulador ........... https://$HOST/simulador.html
 Painel da empresa ... https://$HOST/painel/
 Notificações (ntfy) . https://ntfy.$HOST/
 MQTT aparelhos ...... $HOST:1883   (app e site: wss://$HOST/mqtt)

 Configuração ........ $SERV/.env   (segredos; só o root lê)
 Senha do admin MQTT . $SERV/dados/admin.senha
EOF
  if [[ -n "$CEO_SENHA" ]]; then
    cat <<EOF

 CEO do painel ....... $EMAIL
 Palavra-passe ....... $CEO_SENHA
   ^ mostrada SÓ AGORA: guarde-a num gestor de palavras-passe.
EOF
  elif [[ -z "$EMAIL" && "$ATUALIZAR" == 0 ]]; then
    printf '\n CEO do painel: corra  cd %s && sudo ./domus.sh painel-utilizador <email> ceo\n' "$SERV"
  fi
  (( HTTPS_OK || SIMULAR )) || printf '\n ATENÇÃO: o HTTPS ainda não respondia (ver avisos acima).\n'
  cat <<EOF

 Próximos passos
  1. Firewall do fornecedor: abrir TCP 22, 80, 443, 1883 e UDP 443.
  2. Stripe (pagamentos): preencher STRIPE_* no .env (README §16.1) e
     cd $SERV && sudo docker compose up -d pagamentos
  3. Clientes e aparelhos: no painel, ou
     cd $SERV && sudo ./domus.sh cliente <codigo>
     sudo ./domus.sh aparelho <cliente> <id> openbeken "<Nome>" ...
  4. App Android: MQTT_HOST = $HOST (android/app/build.gradle.kts).
  5. Cópias de segurança de $SERV/dados, mosquitto/seguranca e .env (README §12).
 Atualizar mais tarde:  sudo bash $SERV/instalar.sh --atualizar
$linha
EOF
}

main() {
  exec </dev/null            # com "curl | bash" o stdin é o próprio script
  ler_opcoes "$@"
  (( SIMULAR )) && printf 'Modo simulação: nada é instalado nem alterado.\n'
  verificar_root
  if (( ATUALIZAR )); then
    escolher_pasta
    obter_codigo
    [[ -f "$SERV/.env" ]] || (( SIMULAR )) || erro "não há $SERV/.env: faça primeiro a instalação (sem --atualizar)"
    cd "$SERV" 2>/dev/null || (( SIMULAR )) || erro "não existe $SERV"
    HOST="$(ler_env "$SERV/.env" DOMUS_HOST)"; HOST="${HOST:-O-SEU-SERVIDOR}"
    preparar_pastas
    gerar_config_site
    criar_utilizadores
    arrancar
    instalar_temporizadores
    resumo
    return 0
  fi
  verificar_so
  instalar_pacotes
  escolher_pasta
  obter_codigo
  cd "$SERV" 2>/dev/null || (( SIMULAR )) || erro "não existe $SERV"
  escolher_host
  if [[ -z "$EMAIL" ]]; then EMAIL="$(perguntar "Email do CEO do painel (vazio = mais tarde)" "")"; validar_email; fi
  criar_env
  preparar_pastas
  gerar_config_site
  abrir_firewall
  criar_utilizadores
  arrancar
  instalar_temporizadores
  criar_ceo
  resumo
}

main "$@"
