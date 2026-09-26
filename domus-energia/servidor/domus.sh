#!/usr/bin/env bash
# =============================================================================
# domus.sh — administração do servidor da Domus Energia (Mosquitto + ntfy)
#
# Corre no VPS, dentro da pasta servidor/ (com o docker compose já a correr).
# Contrato: ../docs/PROTOCOLO-MQTT.md (v1) e ../docs/PROTOCOLO-MQTT-v2.md (v2)
#
#   ./domus.sh admin <palavra-passe>
#   ./domus.sh motor [palavra-passe]
#   ./domus.sh cliente <codigo> [palavra-passe]
#   ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" \
#              [--canais "1:interruptor:Teto,2:interruptor:Candeeiro"] \
#              [--medidor] [--bateria] [palavra-passe]
#   ./domus.sh remover-aparelho <cliente> <id>
#   ./domus.sh listar
#   ./domus.sh acl            (só regenera o ficheiro acl e recarrega o Mosquitto)
#
# Estado (fonte de verdade, fora do git, em dados/):
#   dados/admin.senha               palavra-passe do admin (usada para publicar)
#   dados/.motor                    existe depois de o utilizador "motor" ser criado
#   dados/clientes/<codigo>.tsv     um aparelho por linha, separado por TAB:
#                                   id tipo medidor(0/1) bateria(0/1) canais nome
#                                   canais = "n:funcao:nome,n:funcao:nome"
#   dados/clientes/<codigo>.ntfy    segredo do tópico ntfy do cliente
# O ficheiro mosquitto/seguranca/acl é SEMPRE gerado a partir destes ficheiros.
#
# Modos de teste (desenvolvimento):
#   DOMUS_DRY_RUN=1          não corre nada no Docker: mostra o que faria e
#                            escreve o acl em DOMUS_MOSQ_DIR (dados/simulacao)
#   DOMUS_LOCAL=1            corre mosquitto_passwd/mosquitto_pub no próprio PC
#                            (o ntfy é ignorado)
#   DOMUS_MOSQ_DIR=<pasta>   onde ficam passwd e acl
#   DOMUS_PORTA=<porta>      porta MQTT (por omissão 1883)
#   DOMUS_RECARREGAR="cmd"   (DOMUS_LOCAL) comando para recarregar o Mosquitto
#   DOMUS_DADOS=<pasta>      pasta de estado (por omissão ./dados)
#   DOMUS_HOST=<host>        substitui o DOMUS_HOST do .env
#   DOMUS_ENV=<ficheiro>     ficheiro de configuração (por omissão ./.env)
# =============================================================================
# Os "sh -c '...'" abaixo expandem $1, $2... dentro do contentor, de propósito.
# shellcheck disable=SC2016
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

DADOS_DIR="${DOMUS_DADOS:-dados}"
CLIENTES_DIR="$DADOS_DIR/clientes"
ADMIN_SENHA_FICH="$DADOS_DIR/admin.senha"
MOTOR_MARCA="$DADOS_DIR/.motor"
# Códigos de cliente e ids de aparelho: subconjunto de [a-z0-9-]+ (protocolo),
# sem "-" no início/fim e no máximo 32 caracteres (o tópico ntfy
# "domus-<cliente>-<segredo>" tem de caber em 64 caracteres).
RE_ID='^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
FUNCOES="interruptor luz estore porta movimento bateria"
TAB=$'\t'
ENV_FICH="${DOMUS_ENV:-.env}"

MODO=docker
if [[ -n "${DOMUS_DRY_RUN:-}" ]]; then
  MODO=simulacao
  MOSQ_DIR="${DOMUS_MOSQ_DIR:-$DADOS_DIR/simulacao}"
elif [[ -n "${DOMUS_LOCAL:-}" ]]; then
  MODO=local
  MOSQ_DIR="${DOMUS_MOSQ_DIR:-$PWD/mosquitto/seguranca}"   # no próprio PC
else
  MOSQ_DIR="/mosquitto/config/seguranca"                   # dentro do contentor
fi
PORTA="${DOMUS_PORTA:-1883}"

# -----------------------------------------------------------------------------
# Utilitários
# -----------------------------------------------------------------------------
erro() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
aviso() { printf 'AVISO: %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }
simul() { printf '[simulação] %s\n' "$*" >&2; }

uso() {
  cat <<'EOF'
Uso:
  ./domus.sh admin <palavra-passe>
      Cria ou altera o utilizador administrador (admin). Na primeira vez também
      cria o utilizador "motor" com as palavras-passe do ficheiro .env.

  ./domus.sh motor [palavra-passe]
      Cria/atualiza o utilizador "motor" no Mosquitto e no ntfy. Sem
      palavra-passe usa MOTOR_MQTT_PASS e NTFY_MOTOR_PASS do ficheiro .env.

  ./domus.sh cliente <codigo> [palavra-passe]
      Cria o cliente (ou muda-lhe a palavra-passe). Sem palavra-passe, gera uma.
      O código é o login da app e do site: letras minúsculas, dígitos e "-".

  ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" [opções] [palavra-passe]
      Cria (ou substitui) um aparelho do cliente e mostra como o configurar.
      Opções:
        --canais "1:interruptor:Teto,2:interruptor:Candeeiro"
              canais n:funcao[:nome], separados por vírgulas. Funções:
              interruptor luz estore porta movimento bateria.
              Sem --canais: um canal "interruptor" n.º 1.
        --medidor   o aparelho mede potência/tensão/corrente/energia
        --bateria   aparelho a pilhas (dorme; liga-se só quando há eventos)

  ./domus.sh remover-aparelho <cliente> <id>
      Apaga o aparelho, o seu utilizador MQTT e as mensagens retidas dele.

  ./domus.sh listar
      Mostra os clientes e os aparelhos.

  ./domus.sh acl
      Regenera o ficheiro de permissões e recarrega o Mosquitto.
EOF
}

validar_id() { # <valor> <descrição>
  [[ "$1" =~ $RE_ID ]] || erro "$2 inválido: '$1' (1 a 32 letras minúsculas, dígitos e '-', sem '-' no início ou no fim)"
}

# Gera texto aleatório alfanumérico. <comprimento> [conjunto de caracteres]
gerar_aleatorio() {
  local n="$1" conj="${2:-A-Za-z0-9}" s=""
  while (( ${#s} < n )); do
    s+="$(head -c 256 /dev/urandom | LC_ALL=C tr -dc "$conj")"
  done
  printf '%s' "${s:0:n}"
}
gerar_senha() { gerar_aleatorio 20; }

validar_senha() {
  [[ -n "$1" ]] || erro "a palavra-passe não pode estar vazia"
  [[ "$1" != *[[:space:]]* ]] || erro "a palavra-passe não pode ter espaços"
  (( ${#1} >= 8 )) || erro "a palavra-passe deve ter pelo menos 8 caracteres"
}

# Converte texto numa string JSON (com aspas), escapando \ " e controlos.
json_str() {
  local s="$1" out="" c i code
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      '"')  out+='\"' ;;
      \\)  out+="\\\\" ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      *)
        printf -v code '%d' "'$c"
        if (( code >= 0 && code < 32 )); then
          printf -v c '\\u%04x' "$code"
        fi
        out+="$c"
        ;;
    esac
  done
  printf '"%s"' "$out"
}

# Lê uma variável do .env (sem executar o ficheiro). <nome>
ler_env() {
  local v=""
  if [[ -f "$ENV_FICH" ]]; then
    v="$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FICH" | tail -n 1)"
    v="${v%%[[:space:]]#*}"                 # comentário no fim da linha
    v="${v%"${v##*[![:space:]]}"}"          # espaços no fim
    if [[ "$v" == \"*\" || "$v" == \'*\' ]]; then v="${v:1:${#v}-2}"; fi
  fi
  printf '%s' "$v"
}

ler_host() {
  local h="${DOMUS_HOST:-}"
  [[ -n "$h" ]] || h="$(ler_env DOMUS_HOST)"
  printf '%s' "${h:-O-SEU-SERVIDOR}"
}

# Tira TABs e mudanças de linha (o estado é um ficheiro separado por TAB) e
# espaços nas pontas.
limpar_texto() {
  local t="$1"
  t="${t//$'\t'/ }"; t="${t//$'\n'/ }"; t="${t//$'\r'/ }"
  t="${t#"${t%%[![:space:]]*}"}"; t="${t%"${t##*[![:space:]]}"}"
  printf '%s' "$t"
}

# -----------------------------------------------------------------------------
# Estado (dados/)
# -----------------------------------------------------------------------------
preparar_dados() {
  mkdir -p "$CLIENTES_DIR"
  chmod 700 "$DADOS_DIR" 2>/dev/null || true
  # O motor corre no contentor como o utilizador "node" (uid 1000) e guarda o estado em dados/motor.
  mkdir -p "$DADOS_DIR/motor"
  if [[ "$(id -u)" == 0 ]]; then
    chown 1000:1000 "$DADOS_DIR/motor" 2>/dev/null || true
    if [[ -f "$DADOS_DIR/motor/firebase-service-account.json" ]]; then
      chown 1000:1000 "$DADOS_DIR/motor/firebase-service-account.json" 2>/dev/null || true
    fi
  elif [[ "$(stat -c %u "$DADOS_DIR/motor" 2>/dev/null)" != 1000 ]]; then
    echo "Aviso: corra 'sudo chown -R 1000:1000 $DADOS_DIR/motor' para o motor poder guardar o estado." >&2
  fi
}

cliente_existe() { [[ -f "$CLIENTES_DIR/$1.tsv" ]]; }

listar_clientes() { # imprime os códigos, um por linha, ordenados
  local f
  shopt -s nullglob
  for f in "$CLIENTES_DIR"/*.tsv; do
    f="${f##*/}"; printf '%s\n' "${f%.tsv}"
  done | LC_ALL=C sort
  shopt -u nullglob
}

# Nota: não usar "comando | grep -q" com pipefail — o grep sai cedo, o
# comando recebe SIGPIPE e o pipeline falha mesmo quando encontrou.
contem_linha() { # <texto> <linha>
  local l
  while IFS= read -r l; do [[ "$l" == "$2" ]] && return 0; done <<< "$1"
  return 1
}

# Aparelhos do cliente, normalizados em 6 colunas (aceita ainda linhas antigas
# da v1 com 3 colunas: id tipo nome).
ler_aparelhos() { # <cliente>
  local a b c d e f
  while IFS="$TAB" read -r a b c d e f; do
    [[ -z "$a" ]] && continue
    if [[ -z "$d" && -z "$e" && -z "$f" ]]; then          # formato v1
      printf '%s\t%s\t0\t0\t1:interruptor:\t%s\n' "$a" "$b" "$c"
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$a" "$b" "$c" "$d" "$e" "$f"
    fi
  done < "$CLIENTES_DIR/$1.tsv"
}

aparelho_existe() { # <cliente> <id>
  cliente_existe "$1" || return 1
  contem_linha "$(ler_aparelhos "$1" | cut -f1)" "$2"
}

linha_aparelho() { # <cliente> <id> — imprime a linha normalizada
  local l
  while IFS= read -r l; do
    [[ "${l%%"$TAB"*}" == "$2" ]] && { printf '%s\n' "$l"; return 0; }
  done < <(ler_aparelhos "$1")
  return 1
}

# Todos os utilizadores MQTT que existem segundo o estado.
todos_utilizadores() {
  local c id
  printf 'admin\nmotor\n'
  while IFS= read -r c; do
    printf '%s\n' "$c"
    while IFS= read -r id; do
      printf '%s-%s\n' "$c" "$id"
    done < <(ler_aparelhos "$c" | cut -f1)
  done < <(listar_clientes)
}

# Os nomes de utilizador de cliente ("joao-cozinha") e de aparelho
# ("joao" + "cozinha") podem coincidir. Aqui impede-se essa colisão.
utilizador_ocupado() { contem_linha "$(todos_utilizadores)" "$1"; }

# Grava/substitui a linha do aparelho (mantém a ordem; um novo vai para o fim).
guardar_aparelho() { # <cliente> <id> <tipo> <medidor> <bateria> <canais> <nome>
  local f="$CLIENTES_DIR/$1.tsv" tmp linha nova achou=0
  nova="$(printf '%s\t%s\t%s\t%s\t%s\t%s' "$2" "$3" "$4" "$5" "$6" "$7")"
  tmp="$(mktemp "$CLIENTES_DIR/.tmp.XXXXXX")"
  while IFS= read -r linha; do
    if [[ "${linha%%"$TAB"*}" == "$2" ]]; then
      printf '%s\n' "$nova"; achou=1
    else
      printf '%s\n' "$linha"
    fi
  done < <(ler_aparelhos "$1") > "$tmp"
  (( achou )) || printf '%s\n' "$nova" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$f"
}

apagar_aparelho_estado() { # <cliente> <id>
  local f="$CLIENTES_DIR/$1.tsv" tmp
  tmp="$(mktemp "$CLIENTES_DIR/.tmp.XXXXXX")"
  ler_aparelhos "$1" | awk -F '\t' -v id="$2" '$1 != id' > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$f"
}

# Valida e normaliza a especificação de canais. Escreve "n:funcao:nome,..."
# Ex.: "1:interruptor:Teto, 2:interruptor:Candeeiro"  ou  "1:porta,2:bateria"
normalizar_canais() { # <espec>
  local espec="$1" item n resto funcao nome out="" vistos=" "
  local -a itens
  [[ -n "${espec//[[:space:],]/}" ]] || erro "--canais está vazio"
  IFS=',' read -r -a itens <<< "$espec"
  for item in "${itens[@]}"; do
    item="$(limpar_texto "$item")"
    [[ -n "$item" ]] || continue
    [[ "$item" == *:* ]] || erro "canal inválido: '$item' (formato n:funcao[:nome])"
    n="$(limpar_texto "${item%%:*}")"
    resto="${item#*:}"
    if [[ "$resto" == *:* ]]; then
      funcao="$(limpar_texto "${resto%%:*}")"; nome="$(limpar_texto "${resto#*:}")"
    else
      funcao="$(limpar_texto "$resto")"; nome=""
    fi
    [[ "$n" =~ ^[1-9][0-9]?$ ]] || erro "número de canal inválido: '$n' (1 a 99)"
    [[ " $FUNCOES " == *" $funcao "* ]] || erro "função inválida no canal $n: '$funcao' (use: $FUNCOES)"
    [[ "$vistos" != *" $n "* ]] || erro "o canal $n aparece repetido"
    vistos+="$n "
    out+="${out:+,}$n:$funcao:$nome"
  done
  [[ -n "$out" ]] || erro "--canais não tem nenhum canal"
  printf '%s' "$out"
}

# Itera os canais: escreve "n<TAB>funcao<TAB>nome" por linha.
canais_linhas() { # <canais-normalizados>
  local item resto
  local -a itens
  IFS=',' read -r -a itens <<< "$1"
  for item in "${itens[@]}"; do
    [[ -n "$item" ]] || continue
    resto="${item#*:}"
    printf '%s\t%s\t%s\n' "${item%%:*}" "${resto%%:*}" "${resto#*:}"
  done
}

bool_json() { if [[ "$1" == 1 ]]; then printf 'true'; else printf 'false'; fi; }

# JSON da lista de aparelhos (conteúdo retido de domus/<cliente>/_aparelhos),
# formato v2 (secção 1).
json_aparelhos() { # <cliente>
  local id tipo med bat canais nome n funcao cnome primeiro=1 pc
  printf '['
  while IFS="$TAB" read -r id tipo med bat canais nome; do
    (( primeiro )) || printf ','
    primeiro=0
    printf '{"id":%s,"nome":%s,"tipo":%s,"medidor":%s,"bateria":%s,"canais":[' \
      "$(json_str "$id")" "$(json_str "$nome")" "$(json_str "$tipo")" \
      "$(bool_json "$med")" "$(bool_json "$bat")"
    pc=1
    while IFS="$TAB" read -r n funcao cnome; do
      (( pc )) || printf ','
      pc=0
      printf '{"n":%d,"funcao":%s' "$n" "$(json_str "$funcao")"
      [[ -n "$cnome" ]] && printf ',"nome":%s' "$(json_str "$cnome")"
      printf '}'
    done < <(canais_linhas "$canais")
    printf ']}'
  done < <(ler_aparelhos "$1")
  printf ']'
}

ntfy_segredo() { # <cliente> — cria o segredo se ainda não existir
  local f="$CLIENTES_DIR/$1.ntfy"
  if [[ ! -s "$f" ]]; then
    ( umask 077; gerar_aleatorio 20 'a-z0-9' > "$f" )
  fi
  cat "$f"
}

json_ntfy() { # <cliente>
  local host topico
  host="$(ler_host)"
  topico="domus-$1-$(ntfy_segredo "$1")"
  printf '{"url":%s,"servidor":%s,"topico":%s}' \
    "$(json_str "https://ntfy.$host/$topico")" "$(json_str "https://ntfy.$host")" "$(json_str "$topico")"
}

# Ficheiro ACL do Mosquitto, gerado a partir do estado. Escrito no stdout.
# Contrato: v1 "Permissões" + v2 secção 5.
#
# Nota sobre os padrões com "+": no Mosquitto "+" corresponde a exatamente UM
# nível. Os tópicos reservados do motor têm 3 níveis (domus/C/_alarme,
# _aparelhos, _automacoes, _historico, _eventos, _ntfy) e nenhum padrão de
# escrita do cliente tem 3 níveis, por isso o cliente nunca os consegue
# escrever. Os padrões com "+" deixam escrever coisas como
# domus/C/_eventos/rpc, que ninguém lê como comando (os ids de aparelho não
# podem começar por "_"). Ver testes/acl.sh.
gerar_acl() {
  local c id
  cat <<'EOF'
# GERADO AUTOMATICAMENTE pelo domus.sh — NÃO EDITAR À MÃO.
# Fonte: servidor/dados/clientes/*.tsv
# Contrato: docs/PROTOCOLO-MQTT.md (v1) e docs/PROTOCOLO-MQTT-v2.md (secção 5)

# Administrador (script domus.sh): tudo em domus/
user admin
topic readwrite domus/#

# Motor de regras (serviço interno): tudo em domus/
user motor
topic readwrite domus/#
EOF
  while IFS= read -r c; do
    printf '\n# ===== Cliente %s =====\n' "$c"
    printf 'user %s\n' "$c"
    printf 'topic read domus/%s/#\n' "$c"
    printf 'topic write domus/%s/+/+/set\n' "$c"          # canais OpenBeken (<n>/set)
    printf 'topic write domus/%s/+/led_dimmer/set\n' "$c"
    printf 'topic write domus/%s/+/rpc\n' "$c"            # Shelly RPC (luz, estore)
    printf 'topic write domus/%s/+/command\n' "$c"        # Shelly status_update
    printf 'topic write domus/%s/+/command/+\n' "$c"      # Shelly command/switch:<id>
    printf 'topic write domus/%s/_alarme/set\n' "$c"
    printf 'topic write domus/%s/_automacoes/set\n' "$c"
    printf 'topic write domus/%s/_fcm/registar\n' "$c"
    while IFS= read -r id; do
      printf '\n# Aparelho %s de %s\n' "$id" "$c"
      printf 'user %s-%s\n' "$c" "$id"
      printf 'topic readwrite domus/%s/%s/#\n' "$c" "$id"
    done < <(ler_aparelhos "$c" | cut -f1)
  done < <(listar_clientes)
}

# -----------------------------------------------------------------------------
# Mosquitto e ntfy (via docker compose, local ou simulação)
# -----------------------------------------------------------------------------
# Corre um comando no contentor do Mosquitto, como o utilizador "mosquitto"
# (dono de passwd e acl; o Mosquitto 2 avisa/recusa ficheiros de outro dono).
no_mosquitto() {
  if [[ "$MODO" == local ]]; then
    "$@"
  else
    docker compose exec -T -u mosquitto mosquitto "$@"
  fi
}

servico_a_correr() { # <serviço>
  contem_linha "$(docker compose ps --status running --services 2>/dev/null || true)" "$1"
}

verificar_mosquitto() {
  [[ "$MODO" == docker ]] || return 0
  command -v docker >/dev/null || erro "o Docker não está instalado"
  servico_a_correr mosquitto || erro "o Mosquitto não está a correr. Corre primeiro: docker compose up -d"
}

# A palavra-passe vai pelo stdin (não aparece na lista de processos do VPS).
definir_senha_mqtt() { # <utilizador> <palavra-passe>
  if [[ "$MODO" == simulacao ]]; then
    mkdir -p "$MOSQ_DIR"
    simul "mosquitto_passwd: definir palavra-passe de '$1'"
    printf '%s\n' "$1" >> "$MOSQ_DIR/utilizadores.simulacao"
    return 0
  fi
  printf '%s\n' "$2" | no_mosquitto sh -c \
    'umask 077; test -f "$1/passwd" || touch "$1/passwd"; read -r p; exec mosquitto_passwd -b "$1/passwd" "$2" "$p"' \
    sh "$MOSQ_DIR" "$1"
}

apagar_utilizador_mqtt() { # <utilizador>
  if [[ "$MODO" == simulacao ]]; then simul "mosquitto_passwd: apagar '$1'"; return 0; fi
  no_mosquitto mosquitto_passwd -D "$MOSQ_DIR/passwd" "$1" >/dev/null 2>&1 || true
}

recarregar_mosquitto() {
  case "$MODO" in
    simulacao) simul "docker compose kill -s HUP mosquitto"; return 0 ;;
    local)     if [[ -n "${DOMUS_RECARREGAR:-}" ]]; then eval "$DOMUS_RECARREGAR"; fi ;;
    docker)    docker compose kill -s HUP mosquitto >/dev/null ;;
  esac
  sleep 1   # dá tempo ao Mosquitto para reler passwd e acl
}

# Regenera o acl a partir do estado, instala-o e recarrega o Mosquitto.
aplicar_acl() {
  if [[ "$MODO" == simulacao ]]; then
    mkdir -p "$MOSQ_DIR"
    gerar_acl > "$MOSQ_DIR/acl"
    simul "acl escrito em $MOSQ_DIR/acl"
  else
    gerar_acl | no_mosquitto sh -c 'umask 077; cat > "$1/acl.novo" && mv "$1/acl.novo" "$1/acl"' sh "$MOSQ_DIR"
  fi
  recarregar_mosquitto
}

senha_admin() {
  [[ -s "$ADMIN_SENHA_FICH" ]] || erro "ainda não há administrador. Corre primeiro: ./domus.sh admin <palavra-passe>"
  cat "$ADMIN_SENHA_FICH"
}

# Publica RETIDA como admin. Mensagem vazia = apagar a retida.
# 1.ª linha do stdin = palavra-passe; o resto = mensagem.
publicar_retida() { # <tópico> <mensagem>
  local senha
  senha="$(senha_admin)"
  if [[ "$MODO" == simulacao ]]; then
    if [[ -n "$2" ]]; then simul "publicar (retida) $1 $2"; else simul "apagar retida $1"; fi
    return 0
  fi
  if [[ -n "$2" ]]; then
    printf '%s\n%s' "$senha" "$2" | no_mosquitto sh -c \
      'read -r p; exec mosquitto_pub -h localhost -p "$1" -i "$2" -u admin -P "$p" -q 1 -r -t "$3" -s' \
      sh "$PORTA" "domus-admin-$$" "$1"
  else
    printf '%s\n' "$senha" | no_mosquitto sh -c \
      'read -r p; exec mosquitto_pub -h localhost -p "$1" -i "$2" -u admin -P "$p" -q 1 -r -t "$3" -n' \
      sh "$PORTA" "domus-admin-$$" "$1"
  fi
}

publicar_lista() { publicar_retida "domus/$1/_aparelhos" "$(json_aparelhos "$1")"; }
publicar_ntfy() { publicar_retida "domus/$1/_ntfy" "$(json_ntfy "$1")"; }

# Utilizador "motor" do ntfy: pode publicar (só) nos tópicos domus-*.
configurar_ntfy_motor() { # <palavra-passe>
  case "$MODO" in
    simulacao) simul "ntfy: utilizador 'motor' (write-only em domus-*)"; return 0 ;;
    local)     info "(modo local: ntfy ignorado)"; return 0 ;;
  esac
  servico_a_correr ntfy || erro "o ntfy não está a correr. Corre primeiro: docker compose up -d"
  printf '%s\n' "$1" | docker compose exec -T ntfy sh -c \
    'read -r NTFY_PASSWORD; export NTFY_PASSWORD; ntfy user add --ignore-exists --role=user motor >/dev/null && ntfy user change-pass motor >/dev/null' \
    || erro "não foi possível criar o utilizador 'motor' no ntfy"
  docker compose exec -T ntfy ntfy access motor 'domus-*' write-only >/dev/null \
    || erro "não foi possível dar acesso ao utilizador 'motor' no ntfy"
}

# -----------------------------------------------------------------------------
# Instruções de configuração dos aparelhos
# -----------------------------------------------------------------------------
instrucoes_openbeken() { # <c> <id> <senha> <host> <medidor> <bateria> <canais>
  local c="$1" id="$2" senha="$3" host="$4" med="$5" bat="$6" canais="$7" n funcao cnome
  cat <<EOF
No OpenBeken (http://<ip-do-aparelho>) abre  Config -> Configure MQTT  e preenche:

  Host ............ $host
  Port ............ 1883
  Client Topic .... domus/$c/$id
  Group Topic ..... (deixar vazio)
  User ............ $c-$id
  Password ........ $senha

Carrega em "Submit" e reinicia o aparelho. Deve aparecer
  domus/$c/$id/connected = online

Canais (Config -> Configure Module: cada relé/entrada no canal indicado):
EOF
  while IFS="$TAB" read -r n funcao cnome; do
    case "$funcao" in
      interruptor) printf '  canal %s  %-12s relé; lê %s/get (1/0), recebe %s/set\n' "$n" "$funcao" "$n" "$n" ;;
      luz)         printf '  canal %s  %-12s relé/LED; brilho 0-100 em led_dimmer/get e led_dimmer/set\n' "$n" "$funcao" ;;
      estore)      printf '  canal %s  %-12s posição 0 (fechado) a 100 (aberto) em %s/get e %s/set\n' "$n" "$funcao" "$n" "$n" ;;
      porta)       printf '  canal %s  %-12s sensor: %s/get = 1 aberta / 0 fechada\n' "$n" "$funcao" "$n" ;;
      movimento)   printf '  canal %s  %-12s sensor: %s/get = 1 movimento / 0 sem movimento\n' "$n" "$funcao" "$n" ;;
      bateria)     printf '  canal %s  %-12s %s/get = percentagem 0-100\n' "$n" "$funcao" "$n" ;;
    esac
    [[ -n "$cnome" ]] && printf '             ("%s")\n' "$cnome"
  done < <(canais_linhas "$canais")
  if [[ "$med" == 1 ]]; then
    cat <<'EOF'

Medidor: configure o chip de medição (BL0937 / BL0942 / CSE7766) em
Configure Module e confirme que aparecem os tópicos power/get, voltage/get,
current/get e energycounter/get (energia em Wh).
EOF
  fi
  if [[ "$bat" == 1 ]]; then
    cat <<'EOF'

Sensor a pilhas Tuya (TuyaMCU de baixo consumo). Em Config -> Startup command
(ou no ficheiro autoexec.bat) escreva, trocando os dpIDs pelos do seu modelo:

  startDriver TuyaMCU
  startDriver tmSensor
  linkTuyaMCUOutputToChannel <dpID_do_estado> bool 1
  linkTuyaMCUOutputToChannel <dpID_da_bateria> val 2

ATENÇÃO: os dpIDs variam de modelo para modelo. Para os descobrir, abra os
Logs do OpenBeken, provoque um evento (abrir a porta / passar à frente do
sensor) e veja os "dpId" recebidos do TuyaMCU. Exemplos frequentes: estado no
dpID 1, bateria no dpID 2 (percentagem) ou 3 (nível baixo/médio/alto — se o
modelo só tiver o nível, a app mostrará 0/1/2 em vez de percentagem).
Faça toda a configuração com o sensor acordado (carregue no botão de
emparelhamento), porque ele adormece passados poucos segundos.
EOF
  fi
}

instrucoes_shelly() { # <c> <id> <senha> <host> <medidor> <bateria> <canais>
  local c="$1" id="$2" senha="$3" host="$4" med="$5" bat="$6" canais="$7" n funcao cnome comp
  cat <<EOF
Na app Shelly ou na página web do aparelho (http://<ip-do-aparelho>) abre
Settings -> MQTT  e preenche:

  Enable MQTT ........................ ligado
  Connection type / SSL .............. No TLS / No SSL
  MQTT server ........................ $host:1883
  Client ID .......................... $c-$id
  Username ........................... $c-$id
  Password ........................... $senha
  MQTT prefix ........................ domus/$c/$id
  Enable "MQTT Control" .............. ligado
  RPC status notifications over MQTT . ligado
  Generic status update over MQTT .... ligado

Guarda ("Save") e reinicia o aparelho. Deve aparecer
  domus/$c/$id/online = true

Canais (canal n = componente n-1 do Shelly):
EOF
  while IFS="$TAB" read -r n funcao cnome; do
    case "$funcao" in
      interruptor) comp="switch:$((n - 1))" ;;
      luz)         comp="light:$((n - 1))" ;;
      estore)      comp="cover:$((n - 1))  (modo \"Cover\" e calibrado)" ;;
      porta|movimento) comp="input:$((n - 1))  (entrada do tipo \"Switch\")" ;;
      bateria)     comp="(bateria: não definido para Shelly na v2)" ;;
    esac
    printf '  canal %s  %-12s %s\n' "$n" "$funcao" "$comp"
    [[ -n "$cnome" ]] && printf '             ("%s")\n' "$cnome"
  done < <(canais_linhas "$canais")
  if [[ "$med" == 1 ]]; then
    printf '\nMedidor: a potência/energia vem em status/switch:0 (apower, voltage, current, aenergy.total).\n'
  fi
  if [[ "$bat" == 1 ]]; then
    printf '\nAparelho a pilhas: confirme que o Shelly envia o estado por MQTT ao acordar.\n'
  fi
  return 0
}

instrucoes_aparelho() { # <c> <id> <tipo> <nome> <senha> <medidor> <bateria> <canais>
  local c="$1" id="$2" tipo="$3" nome="$4" senha="$5" host
  host="$(ler_host)"
  printf '\n=================================================================\n'
  printf ' Aparelho "%s"  (%s)  do cliente %s\n' "$nome" "$tipo" "$c"
  printf '=================================================================\n'
  if [[ "$tipo" == openbeken ]]; then
    instrucoes_openbeken "$c" "$id" "$senha" "$host" "$6" "$7" "$8"
  else
    instrucoes_shelly "$c" "$id" "$senha" "$host" "$6" "$7" "$8"
  fi
  printf '\nGuarde a palavra-passe: não volta a ser mostrada.\n'
  printf '(Correr de novo "./domus.sh aparelho %s %s ..." gera outra e substitui a configuração.)\n' "$c" "$id"
}

# -----------------------------------------------------------------------------
# Comandos
# -----------------------------------------------------------------------------
cmd_admin() {
  (( $# == 1 )) || erro "uso: ./domus.sh admin <palavra-passe>"
  validar_senha "$1"
  verificar_mosquitto
  preparar_dados
  definir_senha_mqtt admin "$1"
  ( umask 077; printf '%s\n' "$1" > "$ADMIN_SENHA_FICH" )
  aplicar_acl
  info "Administrador 'admin' criado/atualizado."
  info "A palavra-passe ficou guardada em $ADMIN_SENHA_FICH (só no servidor)."
  # Primeira vez: cria também o utilizador do motor com as senhas do .env.
  if [[ ! -e "$MOTOR_MARCA" ]]; then
    if [[ -n "$(ler_env MOTOR_MQTT_PASS)" ]]; then
      info ""
      cmd_motor
    else
      aviso "falta MOTOR_MQTT_PASS no .env; depois corra: ./domus.sh motor"
    fi
  fi
}

cmd_motor() {
  (( $# <= 1 )) || erro "uso: ./domus.sh motor [palavra-passe]"
  local senha="${1:-}" env_senha ntfy_senha
  env_senha="$(ler_env MOTOR_MQTT_PASS)"
  [[ -n "$senha" ]] || senha="$env_senha"
  [[ -n "$senha" ]] || erro "indique a palavra-passe ou defina MOTOR_MQTT_PASS no .env"
  validar_senha "$senha"
  verificar_mosquitto
  preparar_dados
  definir_senha_mqtt motor "$senha"
  aplicar_acl
  : > "$MOTOR_MARCA"
  info "Utilizador 'motor' criado/atualizado no Mosquitto."
  if [[ -n "$env_senha" && "$senha" != "$env_senha" ]]; then
    aviso "a palavra-passe é diferente de MOTOR_MQTT_PASS no .env: atualize o .env e corra 'docker compose up -d motor'"
  fi
  ntfy_senha="$(ler_env NTFY_MOTOR_PASS)"
  if [[ -n "$ntfy_senha" ]]; then
    validar_senha "$ntfy_senha"
    configurar_ntfy_motor "$ntfy_senha"
    info "Utilizador 'motor' criado/atualizado no ntfy (publica em domus-*)."
  else
    aviso "falta NTFY_MOTOR_PASS no .env: o motor não vai conseguir enviar notificações ntfy"
  fi
  info "Se o motor já estava a correr: docker compose restart motor"
}

cmd_cliente() {
  (( $# >= 1 && $# <= 2 )) || erro "uso: ./domus.sh cliente <codigo> [palavra-passe]"
  local c="$1" senha="${2:-}" gerada=0
  validar_id "$c" "código de cliente"
  [[ "$c" != admin && "$c" != motor ]] || erro "'$c' é reservado"
  preparar_dados
  if ! cliente_existe "$c" && utilizador_ocupado "$c"; then
    erro "já existe um utilizador MQTT chamado '$c' (um aparelho). Escolha outro código."
  fi
  if [[ -z "$senha" ]]; then senha="$(gerar_senha)"; gerada=1; fi
  validar_senha "$senha"
  senha_admin >/dev/null
  verificar_mosquitto

  local novo=0
  cliente_existe "$c" || { ( umask 077; : > "$CLIENTES_DIR/$c.tsv" ); novo=1; }
  definir_senha_mqtt "$c" "$senha"
  aplicar_acl
  (( novo )) && publicar_lista "$c"
  publicar_ntfy "$c"

  if (( novo )); then info "Cliente '$c' criado."; else info "Palavra-passe do cliente '$c' alterada."; fi
  cat <<EOF

  Login na app e no site
    Site ........... https://$(ler_host)/
    Servidor ....... wss://$(ler_host)/mqtt
    Utilizador ..... $c
    Palavra-passe .. $senha

  Notificações (app ntfy -> "+" -> "Use another server")
    Servidor ....... https://ntfy.$(ler_host)
    Tópico ......... domus-$c-$(ntfy_segredo "$c")
EOF
  (( gerada )) && info "  (palavra-passe gerada automaticamente — guarde-a)"
  return 0
}

cmd_aparelho() {
  local -a pos=()
  local canais="" med=0 bat=0
  while (( $# )); do
    case "$1" in
      --canais)   (( $# >= 2 )) || erro "--canais precisa de um valor"; canais="$2"; shift 2 ;;
      --canais=*) canais="${1#--canais=}"; shift ;;
      --medidor)  med=1; shift ;;
      --bateria)  bat=1; shift ;;
      --*)        erro "opção desconhecida: $1" ;;
      *)          pos+=("$1"); shift ;;
    esac
  done
  (( ${#pos[@]} >= 4 && ${#pos[@]} <= 5 )) \
    || erro 'uso: ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" [--canais "1:interruptor:Teto"] [--medidor] [--bateria] [palavra-passe]'
  local c="${pos[0]}" id="${pos[1]}" tipo="${pos[2]}" nome="${pos[3]}" senha="${pos[4]:-}"
  validar_id "$c" "código de cliente"
  validar_id "$id" "id do aparelho"
  [[ "$tipo" == openbeken || "$tipo" == shelly ]] || erro "tipo inválido: '$tipo' (use openbeken ou shelly)"
  nome="$(limpar_texto "$nome")"
  [[ -n "$nome" ]] || erro "o nome do aparelho não pode estar vazio"
  if [[ -n "$canais" ]]; then
    canais="$(normalizar_canais "$canais")"
  else
    canais="1:interruptor:"
    (( bat )) && aviso "--bateria sem --canais: normalmente é --canais \"1:porta,2:bateria\" ou \"1:movimento,2:bateria\""
  fi
  if (( bat )) && [[ ",$canais" != *:bateria:* ]]; then
    aviso "aparelho a pilhas sem canal 'bateria': a app não vai mostrar a carga"
  fi
  preparar_dados
  cliente_existe "$c" || erro "o cliente '$c' não existe. Crie-o com: ./domus.sh cliente $c"
  local utilizador="$c-$id"
  if ! aparelho_existe "$c" "$id" && utilizador_ocupado "$utilizador"; then
    erro "o utilizador MQTT '$utilizador' já existe (outro cliente ou aparelho). Escolha outro id."
  fi
  [[ -n "$senha" ]] || senha="$(gerar_senha)"
  validar_senha "$senha"
  senha_admin >/dev/null
  verificar_mosquitto

  definir_senha_mqtt "$utilizador" "$senha"
  guardar_aparelho "$c" "$id" "$tipo" "$med" "$bat" "$canais" "$nome"
  aplicar_acl
  publicar_lista "$c"
  info "Aparelho '$id' guardado; lista domus/$c/_aparelhos atualizada."
  instrucoes_aparelho "$c" "$id" "$tipo" "$nome" "$senha" "$med" "$bat" "$canais"
}

cmd_remover_aparelho() {
  (( $# == 2 )) || erro "uso: ./domus.sh remover-aparelho <cliente> <id>"
  local c="$1" id="$2" linha canais sub n _f _nome k
  validar_id "$c" "código de cliente"
  validar_id "$id" "id do aparelho"
  linha="$(linha_aparelho "$c" "$id" 2>/dev/null)" || erro "o cliente '$c' não tem o aparelho '$id'"
  canais="$(cut -f5 <<< "$linha")"
  senha_admin >/dev/null
  verificar_mosquitto

  apagar_utilizador_mqtt "$c-$id"
  apagar_aparelho_estado "$c" "$id"
  aplicar_acl
  publicar_lista "$c"
  # Limpa as mensagens retidas conhecidas do aparelho (v1 + v2).
  local -a subs=(connected online power/get voltage/get current/get energycounter/get led_dimmer/get)
  while IFS="$TAB" read -r n _f _nome; do
    k=$((n - 1))
    subs+=("$n/get" "status/switch:$k" "status/light:$k" "status/cover:$k" "status/input:$k")
  done < <(canais_linhas "$canais")
  for sub in "${subs[@]}"; do
    publicar_retida "domus/$c/$id/$sub" ""
  done
  info "Aparelho '$id' removido do cliente '$c'."
}

cmd_listar() {
  preparar_dados
  local c id tipo med bat canais nome n=0 extra
  while IFS= read -r c; do
    n=$((n + 1))
    printf '%s\n' "$c"
    if [[ ! -s "$CLIENTES_DIR/$c.tsv" ]]; then
      printf '   (sem aparelhos)\n'
    fi
    while IFS="$TAB" read -r id tipo med bat canais nome; do
      extra=""
      [[ "$med" == 1 ]] && extra+=" medidor"
      [[ "$bat" == 1 ]] && extra+=" bateria"
      printf '   %-20s %-10s %-24s utilizador: %s-%s%s\n' "$id" "$tipo" "$nome" "$c" "$id" "${extra:+  [${extra# }]}"
      printf '      canais: %s\n' "$canais"
    done < <(ler_aparelhos "$c")
  done < <(listar_clientes)
  (( n )) || info "(ainda não há clientes)"
  [[ -s "$ADMIN_SENHA_FICH" ]] || info "Atenção: ainda não há administrador (./domus.sh admin <palavra-passe>)."
  [[ -e "$MOTOR_MARCA" ]] || info "Atenção: o utilizador 'motor' ainda não foi criado (./domus.sh motor)."
  return 0
}

cmd_acl() {
  preparar_dados
  verificar_mosquitto
  aplicar_acl
  info "ACL regenerada e Mosquitto recarregado."
}

# Evita duas execuções em simultâneo.
bloquear() {
  preparar_dados
  if command -v flock >/dev/null; then
    exec 9> "$DADOS_DIR/.lock"
    flock -n 9 || erro "outra execução do domus.sh está em curso"
  fi
}

main() {
  local cmd="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    admin)            bloquear; cmd_admin "$@" ;;
    motor)            bloquear; cmd_motor "$@" ;;
    cliente)          bloquear; cmd_cliente "$@" ;;
    aparelho)         bloquear; cmd_aparelho "$@" ;;
    remover-aparelho) bloquear; cmd_remover_aparelho "$@" ;;
    listar)           cmd_listar "$@" ;;
    acl)              bloquear; cmd_acl "$@" ;;
    gerar-acl)        preparar_dados; gerar_acl ;;             # só mostra (diagnóstico)
    json)             if (( $# != 1 )) || ! cliente_existe "$1"; then erro "uso: ./domus.sh json <cliente>"; fi
                      json_aparelhos "$1"; echo ;;
    -h|--help|ajuda|"") uso ;;
    *) uso; erro "comando desconhecido: $cmd" ;;
  esac
}

main "$@"
