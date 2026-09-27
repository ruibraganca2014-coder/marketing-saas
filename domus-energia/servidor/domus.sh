#!/usr/bin/env bash
# =============================================================================
# domus.sh — administração do servidor da Domus Energia (Mosquitto + ntfy)
#
# Corre no VPS, dentro da pasta servidor/ (com o docker compose já a correr).
# Contrato: ../docs/PROTOCOLO-MQTT.md (v1), ../docs/PROTOCOLO-MQTT-v2.md (v2)
#           e ../docs/PROTOCOLO-MQTT-v3.md (v3: §3 campos novos, §4 regras nos
#           aparelhos, §10 permissões); planos: ../docs/PROTOCOLO-PLANOS.md
#
#   ./domus.sh admin [palavra-passe]       (sem argumento: pede-a no terminal ou lê do stdin)
#   ./domus.sh motor [palavra-passe]
#   ./domus.sh pagamentos [palavra-passe]
#   ./domus.sh cliente <codigo> [palavra-passe]
#   ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" \
#              [--canais "1:interruptor:Teto:arranque=ultimo,2:interruptor:Termo:carga=perigosa"] \
#              [--divisao "Sala"] [--medidor [--geral]] [--bateria] [palavra-passe]
#   ./domus.sh remover-aparelho <cliente> <id>
#   ./domus.sh listar
#   ./domus.sh acl            (só regenera o ficheiro acl e recarrega o Mosquitto)
#   ./domus.sh plano <cliente> <base|conforto|premium> [--estado ativo|teste|em_atraso|suspenso|cancelado]
#   ./domus.sh sincronizar-planos   (temporizador de minuto a minuto: ACL dos suspensos)
#   ./domus.sh painel-mqtt [palavra-passe]   (utilizador MQTT "painel": só lê domus/#)
#   ./domus.sh processar-pedidos    (temporizador de 5 em 5 s: pedidos-admin escritos pelo painel)
#   ./domus.sh painel-utilizador <email> <ceo|tecnico|comercial> ["Nome"]
#   ./domus.sh config-site          (config-site/config.js com wss://DOMUS_HOST/mqtt)
#
# Estado (fonte de verdade, fora do git, em dados/):
#   dados/admin.senha               palavra-passe do admin (usada para publicar)
#   dados/.motor                    existe depois de o utilizador "motor" ser criado
#   dados/clientes/<codigo>.tsv     um aparelho por linha, separado por TAB:
#                                   id tipo medidor(0/1/2) bateria(0/1) canais nome divisao
#                                   (medidor 2 = medidor geral da casa, --geral)
#                                   canais = "n:funcao:nome:entrada:simular:arranque:carga:divisao,..."
#                                   (entrada/simular 0/1; linhas antigas "n:funcao:nome"
#                                   e sem a coluna divisao continuam a ser aceites)
#   dados/clientes/<codigo>.ntfy    segredo do tópico ntfy do cliente
#   dados/.pagamentos               existe depois de o utilizador "pagamentos" ser criado
#   dados/planos/<codigo>.json      subscrição do cliente (uma linha JSON; escrito
#                                   pelo serviço pagamentos ou por "./domus.sh plano")
#   dados/.painel                   existe depois de o utilizador "painel" ser criado
#   dados/painel/                   base de dados do painel da empresa (docs/PAINEL-EMPRESA.md)
#   dados/pedidos-admin/<id>.json   pedidos do painel (processar-pedidos); resultados em
#                                   <id>.resultado.json (modo 600) e pedidos feitos em feitos/
# O ficheiro mosquitto/seguranca/acl é SEMPRE gerado a partir destes ficheiros
# (clientes suspensos/cancelados: só leem domus/<c>/_plano).
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
PAGAMENTOS_MARCA="$DADOS_DIR/.pagamentos"
PAINEL_MARCA="$DADOS_DIR/.painel"
PEDIDOS_DIR="$DADOS_DIR/pedidos-admin"
FEITOS_DIR="$PEDIDOS_DIR/feitos"
PEDIDOS_PRIV="$DADOS_DIR/.pedidos-em-curso"    # só do domus.sh (root): nunca montada no painel
PEDIDO_MAX=16384                          # bytes de um pedido
PEDIDOS_POR_VEZ=50                        # pedidos tratados em cada execução
PEDIDO_U_EXPIRA_S=3600                    # painel-utilizador por aplicar: apagado ao fim de 1 h
UID_SERVICOS=1000                         # utilizador "node" dos contentores (motor, pagamentos, painel)
PLANOS_DIR="$DADOS_DIR/planos"
PLANOS="base conforto premium"
ESTADOS_PLANO="ativo teste em_atraso suspenso cancelado"
DIAS_AVISO=15                              # em_atraso: dias de aviso até suspender (PROTOCOLO-PLANOS §2)
RESERVADOS="admin motor pagamentos painel" # utilizadores internos: nunca códigos de cliente
# Códigos de cliente e ids de aparelho: subconjunto de [a-z0-9-]+ (protocolo),
# sem "-" no início/fim e no máximo 32 caracteres (o tópico ntfy
# "domus-<cliente>-<segredo>" tem de caber em 64 caracteres).
RE_ID='^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
FUNCOES="interruptor luz estore porta movimento bateria"
CONTROLAVEIS="interruptor luz estore"      # funções que o cliente pode comandar
DIVISAO_MAX=40                             # comprimento máximo de "divisao"
AUTO_OFF_S=14400                           # limite local das cargas perigosas (Shelly): 4 h
OBK_DOC="https://github.com/openshwprojects/OpenBK7231T_App/blob/main/docs/commands.md"
TAB=$'\t'
US=$'\x1f'                                # separador interno (aceita campos vazios)
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
  ./domus.sh admin [palavra-passe]
      Cria ou altera o utilizador administrador (admin). Na primeira vez também
      cria o utilizador "motor" com as palavras-passe do ficheiro .env.
      Sem palavra-passe na linha de comando (recomendado: não fica no histórico
      da shell), pede-a no terminal (duas vezes) ou lê a primeira linha do stdin:
        ./domus.sh admin
        printf '%s\n' "$SENHA" | ./domus.sh admin

  ./domus.sh motor [palavra-passe]
      Cria/atualiza o utilizador "motor" no Mosquitto e no ntfy. Sem
      palavra-passe usa MOTOR_MQTT_PASS e NTFY_MOTOR_PASS do ficheiro .env.

  ./domus.sh pagamentos [palavra-passe]
      Cria/atualiza o utilizador "pagamentos" (serviço de subscrições; só pode
      publicar domus/+/_plano). Sem palavra-passe usa PAGAMENTOS_MQTT_PASS do .env.
      O "./domus.sh admin" da primeira vez também o cria.

  ./domus.sh cliente <codigo> [palavra-passe]
      Cria o cliente (ou muda-lhe a palavra-passe). Sem palavra-passe, gera uma.
      O código é o login da app e do site: letras minúsculas, dígitos e "-".

  ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" [opções] [palavra-passe]
      Cria (ou substitui) um aparelho do cliente e mostra como o configurar.
      Opções:
        --canais "n:funcao[:nome][:opção]...,n:funcao..."
              Um canal por vírgula; dentro do canal, campos separados por ":".
              Funções: interruptor luz estore porta movimento bateria.
              O 1.º campo depois da função que não é uma opção é o nome
              (nomes sem ":" nem ","). Opções do canal:
                entrada            só "porta": porta de entrada (alarme com atraso)
                simular            só "interruptor"/"luz": entra na simulação
                                   de presença do modo férias
                arranque=desligado|ligado|ultimo
                                   estado depois de um corte de luz (só
                                   interruptor/luz/estore; por omissão
                                   "desligado"). "ultimo" só em interruptor/luz
                                   sem carga perigosa; estore só "desligado".
                carga=normal|perigosa
                                   perigosa = aquecedor, termoacumulador, bomba,
                                   motor (nunca "ultimo"; limite local de 4 h
                                   nos Shelly)
                divisao=Texto      divisão da casa deste canal (substitui --divisao)
              Exemplos:
                "1:interruptor:Teto:simular:arranque=ultimo:divisao=Sala"
                "1:porta:Porta entrada:entrada,2:bateria"
                "1:interruptor:Termo:carga=perigosa"
              Sem --canais: um canal "interruptor" n.º 1.
        --divisao "Sala"  divisão do aparelho (herdada por todos os canais)
        --medidor   o aparelho mede potência/tensão/corrente/energia
        --geral     (só com --medidor) medidor geral da casa: o consumo total
                    da casa passa a ser a soma dos medidores gerais (em vez de
                    todos os medidores, que contaria duas vezes os circuitos
                    que também têm medição própria)
        --bateria   aparelho a pilhas (dorme; liga-se só quando há eventos)
      O script imprime os comandos a colar no aparelho (OpenBeken: autoexec.bat
      com SetStartValue; Shelly: endereços RPC para o browser) para que o
      interruptor físico e o estado depois de um corte funcionem sem internet.

  ./domus.sh remover-aparelho <cliente> <id>
      Apaga o aparelho, o seu utilizador MQTT e as mensagens retidas dele.

  ./domus.sh listar
      Mostra os clientes e os aparelhos.

  ./domus.sh acl
      Regenera o ficheiro de permissões e recarrega o Mosquitto.

  ./domus.sh plano <cliente> <base|conforto|premium> [--estado ESTADO] [--gerido manual|stripe]
      Gestão manual da subscrição (sem Stripe): grava dados/planos/<cliente>.json
      com gerido "manual" e publica domus/<cliente>/_plano (retido).
      ESTADO: ativo (por omissão), teste, em_atraso (aviso de 15 dias),
      suspenso ou cancelado (modo básico: a app e o site só leem o _plano; os
      aparelhos e os interruptores continuam a funcionar).
      --gerido stripe devolve a gestão ao Stripe (só se o cliente já tiver uma
      subscrição no Stripe; o próximo evento do Stripe atualiza o estado).

  ./domus.sh sincronizar-planos
      Lê dados/planos/*.json e, se algum cliente passou a (ou deixou de estar)
      suspenso/cancelado, regenera a ACL e recarrega o Mosquitto. Corre a cada
      minuto num temporizador (systemd/domus-planos.timer ou cron).

  ./domus.sh painel-mqtt [palavra-passe]
      Cria/atualiza o utilizador MQTT "painel" (painel da empresa: só LÊ domus/#,
      para os alertas técnicos). Sem palavra-passe usa PAINEL_MQTT_PASS do .env.
      O "./domus.sh admin" da primeira vez também o cria.

  ./domus.sh processar-pedidos
      Executa os pedidos que o painel da empresa escreveu em dados/pedidos-admin/
      (tipos cliente, aparelho, remover-aparelho e plano), escreve o resultado em
      dados/pedidos-admin/<id>.resultado.json (modo 600, com a palavra-passe
      gerada) e move o pedido para dados/pedidos-admin/feitos/. Corre a cada 5 s
      num temporizador (systemd/domus-pedidos.timer). Os pedidos são validados à risca:
      qualquer coisa fora do formato é recusada sem ser executada.

  ./domus.sh painel-utilizador <email> <ceo|tecnico|comercial> ["Nome"]
      Cria (ou repõe) um utilizador do painel da empresa. Pede a palavra-passe
      (mín. 10 caracteres) no terminal, ou lê a primeira linha do stdin, e
      escreve um pedido que o serviço painel aplica em poucos segundos.

  ./domus.sh config-site
      Gera config-site/config.js a partir de ../web/config.js com o mqttUrl
      wss://DOMUS_HOST/mqtt (o Caddy serve-o no lugar do web/config.js). Corra
      de novo depois de mudar o DOMUS_HOST ou de atualizar o código. Não edite
      o web/config.js no servidor.
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
  # O serviço pagamentos (uid 1000) escreve em dados/planos e dados/pagamentos.
  # O painel (uid 1000) escreve em dados/painel e dados/pedidos-admin.
  local p
  for p in "$PLANOS_DIR" "$DADOS_DIR/pagamentos" "$DADOS_DIR/painel"; do
    mkdir -p "$p"
    if [[ "$(id -u)" == 0 ]]; then
      chown "$UID_SERVICOS:$UID_SERVICOS" "$p" 2>/dev/null || true
    elif [[ "$(stat -c %u "$p" 2>/dev/null)" != "$UID_SERVICOS" ]]; then
      echo "Aviso: corra 'sudo chown $UID_SERVICOS:$UID_SERVICOS $p' para os serviços (pagamentos/painel) poderem escrever." >&2
    fi
  done
  chmod 700 "$DADOS_DIR/painel" 2>/dev/null || true
  # Fila de pedidos do painel: root:1000 com modo 1770 (ver preparar_pedidos).
  mkdir -p "$PEDIDOS_DIR"
  if [[ "$(id -u)" == 0 ]]; then
    chown "0:$UID_SERVICOS" "$PEDIDOS_DIR" 2>/dev/null || true
    chmod 1770 "$PEDIDOS_DIR" 2>/dev/null || true
  else
    chmod 700 "$PEDIDOS_DIR" 2>/dev/null || true
  fi
  # O painel lê (só leitura) os .tsv dos clientes pelo grupo 1000; os .ntfy
  # (segredos dos tópicos) continuam só do dono.
  if [[ "$(id -u)" == 0 ]]; then
    chgrp "$UID_SERVICOS" "$CLIENTES_DIR" 2>/dev/null || true
    chmod 750 "$CLIENTES_DIR" 2>/dev/null || true
    local f
    for f in "$CLIENTES_DIR"/*.tsv; do
      if [[ -f "$f" && ! -L "$f" ]]; then permissoes_tsv "$f"; fi
    done
  fi
}

# .tsv do cliente: lido pelo painel (grupo 1000), escrito só pelo domus.sh.
permissoes_tsv() { # <ficheiro>
  chmod 640 "$1"
  if [[ "$(id -u)" == 0 ]]; then chgrp "$UID_SERVICOS" "$1" 2>/dev/null || true; fi
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

# Aparelhos do cliente, normalizados em 7 colunas (id tipo medidor bateria
# canais nome divisao; a divisao pode estar vazia). Aceita ainda linhas antigas
# da v1 (3 colunas: id tipo nome) e da v2 (6 colunas, sem divisao).
ler_aparelhos() { # <cliente>
  local a b c d e f g
  while IFS="$TAB" read -r a b c d e f g; do
    [[ -z "$a" ]] && continue
    if [[ -z "$d" && -z "$e" && -z "$f" ]]; then          # formato v1
      printf '%s\t%s\t0\t0\t1:interruptor:\t%s\t\n' "$a" "$b" "$c"
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$a" "$b" "$c" "$d" "$e" "$f" "$g"
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
  printf 'admin\nmotor\npagamentos\npainel\n'
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
guardar_aparelho() { # <cliente> <id> <tipo> <medidor> <bateria> <canais> <nome> <divisao>
  local f="$CLIENTES_DIR/$1.tsv" tmp linha nova achou=0
  nova="$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s' "$2" "$3" "$4" "$5" "$6" "$7" "$8")"
  tmp="$(mktemp "$CLIENTES_DIR/.tmp.XXXXXX")"
  while IFS= read -r linha; do
    if [[ "${linha%%"$TAB"*}" == "$2" ]]; then
      printf '%s\n' "$nova"; achou=1
    else
      printf '%s\n' "$linha"
    fi
  done < <(ler_aparelhos "$1") > "$tmp"
  (( achou )) || printf '%s\n' "$nova" >> "$tmp"
  permissoes_tsv "$tmp"; mv "$tmp" "$f"
}

apagar_aparelho_estado() { # <cliente> <id>
  local f="$CLIENTES_DIR/$1.tsv" tmp
  tmp="$(mktemp "$CLIENTES_DIR/.tmp.XXXXXX")"
  ler_aparelhos "$1" | awk -F '\t' -v id="$2" '$1 != id' > "$tmp"
  permissoes_tsv "$tmp"; mv "$tmp" "$f"
}

e_controlavel() { [[ " $CONTROLAVEIS " == *" $1 "* ]]; }

# Valida um texto de "divisao". <texto> <onde>
validar_divisao() {
  [[ -n "$1" ]] || erro "divisao vazia $2"
  (( ${#1} <= DIVISAO_MAX )) || erro "divisao demasiado longa $2 (máx. $DIVISAO_MAX caracteres): '$1'"
}

# Valida e normaliza a especificação de canais (contrato v3 §3).
# Entrada:  "n:funcao[:nome][:opção]...,..."   opções: entrada, simular,
#           arranque=desligado|ligado|ultimo, carga=normal|perigosa, divisao=Texto
# Saída:    "n:funcao:nome:entrada(0/1):simular(0/1):arranque:carga:divisao,..."
#           (arranque vazio nos canais não controláveis; carga/divisao vazias
#           = por omissão)
normalizar_canais() { # <espec>
  local espec="$1" item n funcao nome campo chave valor out="" vistos=" " i
  local ent sim arr carga div opcoes
  local -a itens campos
  [[ -n "${espec//[[:space:],]/}" ]] || erro "--canais está vazio"
  IFS=',' read -r -a itens <<< "$espec"
  for item in "${itens[@]}"; do
    item="$(limpar_texto "$item")"
    [[ -n "$item" ]] || continue
    [[ "$item" == *:* ]] || erro "canal inválido: '$item' (formato n:funcao[:nome][:opção]...)"
    IFS=':' read -r -a campos <<< "$item"
    n="$(limpar_texto "${campos[0]}")"
    funcao="$(limpar_texto "${campos[1]:-}")"
    if [[ ! "$n" =~ ^[1-9][0-9]?$ ]] || (( n > 64 )); then erro "número de canal inválido: '$n' (1 a 64)"; fi
    [[ " $FUNCOES " == *" $funcao "* ]] || erro "função inválida no canal $n: '$funcao' (use: $FUNCOES)"
    [[ "$vistos" != *" $n "* ]] || erro "o canal $n aparece repetido"
    vistos+="$n "
    nome=""; ent=0; sim=0; arr=""; carga=""; div=""; opcoes=" "
    for (( i = 2; i < ${#campos[@]}; i++ )); do
      campo="$(limpar_texto "${campos[i]}")"
      [[ -n "$campo" ]] || continue                       # "1:porta::entrada"
      if [[ "$campo" == entrada || "$campo" == simular || "$campo" =~ ^[a-z_]+= ]]; then
        chave="${campo%%=*}"
        [[ "$opcoes" != *" $chave "* ]] || erro "canal $n: a opção '$chave' aparece repetida"
        opcoes+="$chave "
        valor="$(limpar_texto "${campo#*=}")"
        case "$chave" in
          entrada)  ent=1 ;;
          simular)  sim=1 ;;
          arranque) arr="$valor"
                    [[ "$arr" == desligado || "$arr" == ligado || "$arr" == ultimo ]] \
                      || erro "canal $n: arranque inválido '$arr' (use desligado, ligado ou ultimo)" ;;
          carga)    carga="$valor"
                    [[ "$carga" == normal || "$carga" == perigosa ]] \
                      || erro "canal $n: carga inválida '$carga' (use normal ou perigosa)" ;;
          divisao)  div="$valor"; validar_divisao "$div" "no canal $n" ;;
          *)        erro "canal $n: opção desconhecida '$chave' (use: entrada, simular, arranque=, carga=, divisao=)" ;;
        esac
      elif [[ -z "$nome" ]]; then
        nome="$campo"
      else
        erro "canal $n: dois nomes ('$nome' e '$campo'). Opções válidas: entrada, simular, arranque=, carga=, divisao="
      fi
    done
    # Regras do contrato v3 §3
    if (( ent )) && [[ "$funcao" != porta ]]; then
      erro "canal $n: 'entrada' só é válido em canais 'porta' (este é '$funcao')"
    fi
    if (( sim )) && [[ "$funcao" != interruptor && "$funcao" != luz ]]; then
      erro "canal $n: 'simular' só é válido em canais 'interruptor' ou 'luz' (este é '$funcao')"
    fi
    if ! e_controlavel "$funcao"; then
      [[ -z "$arr" ]] || erro "canal $n: 'arranque' só se aplica a canais controláveis ($CONTROLAVEIS), não a '$funcao'"
      [[ -z "$carga" ]] || erro "canal $n: 'carga' só se aplica a canais controláveis ($CONTROLAVEIS), não a '$funcao'"
    else
      [[ -n "$arr" ]] || arr=desligado                    # por omissão (contrato v3 §3)
      if [[ "$arr" == ultimo && "$carga" == perigosa ]]; then
        erro "canal $n: 'arranque=ultimo' não é permitido com 'carga=perigosa' (depois de um corte de luz tem de ficar desligado)"
      fi
      if [[ "$arr" == ultimo && "$funcao" != interruptor && "$funcao" != luz ]]; then
        erro "canal $n: 'arranque=ultimo' só é permitido em 'interruptor' ou 'luz' (este é '$funcao')"
      fi
      if [[ "$funcao" == estore && "$arr" != desligado ]]; then
        erro "canal $n: um estore fica sempre parado depois de um corte de luz; use arranque=desligado (ou omita)"
      fi
      if [[ "$arr" == ligado && "$carga" == perigosa ]]; then
        aviso "canal $n: carga perigosa com arranque=ligado liga sozinha quando a luz volta; confirme que é isso que quer"
      fi
      [[ "$carga" == normal ]] && carga=""                # por omissão
    fi
    out+="${out:+,}$n:$funcao:$nome:$ent:$sim:$arr:$carga:$div"
  done
  [[ -n "$out" ]] || erro "--canais não tem nenhum canal"
  printf '%s' "$out"
}

# Itera os canais: escreve por linha, separados por US ($'\x1f', aceita campos
# vazios):  n funcao nome entrada simular arranque carga divisao
# Aceita também o formato antigo "n:funcao:nome" (arranque = desligado).
canais_linhas() { # <canais-normalizados>
  local item n f nome e s a c d
  local -a itens
  IFS=',' read -r -a itens <<< "$1"
  for item in "${itens[@]}"; do
    [[ -n "$item" ]] || continue
    IFS=':' read -r n f nome e s a c d <<< "$item"
    [[ "$e" == 1 ]] || e=0
    [[ "$s" == 1 ]] || s=0
    if e_controlavel "$f"; then [[ -n "$a" ]] || a=desligado; else a=""; fi
    printf '%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\n' "$n" "$f" "$nome" "$e" "$s" "$a" "$c" "$d"
  done
}

bool_json() { if [[ "$1" == 1 ]]; then printf 'true'; else printf 'false'; fi; }

# JSON da lista de aparelhos (conteúdo retido de domus/<cliente>/_aparelhos),
# formato v2 (secção 1) + campos por canal da v3 (secção 3). A divisão do
# aparelho (--divisao) é escrita em cada canal que não tenha a sua.
json_aparelhos() { # <cliente>
  local id tipo med bat canais nome adiv n funcao cnome ent sim arr carga cdiv primeiro=1 pc
  printf '['
  while IFS="$TAB" read -r id tipo med bat canais nome adiv; do
    (( primeiro )) || printf ','
    primeiro=0
    printf '{"id":%s,"nome":%s,"tipo":%s,"medidor":%s,"bateria":%s,' \
      "$(json_str "$id")" "$(json_str "$nome")" "$(json_str "$tipo")" \
      "$(bool_json "$(( med >= 1 ))")" "$(bool_json "$bat")"
    [[ "$med" == 2 ]] && printf '"geral":true,'
    printf '"canais":['
    pc=1
    while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
      (( pc )) || printf ','
      pc=0
      printf '{"n":%d,"funcao":%s' "$n" "$(json_str "$funcao")"
      [[ -n "$cnome" ]] && printf ',"nome":%s' "$(json_str "$cnome")"
      [[ "$ent" == 1 ]] && printf ',"entrada":true'
      [[ "$sim" == 1 ]] && printf ',"simular":true'
      [[ -n "$arr" ]] && printf ',"arranque":%s' "$(json_str "$arr")"
      [[ "$carga" == perigosa ]] && printf ',"carga":"perigosa"'
      [[ -n "$cdiv" ]] || cdiv="$adiv"
      [[ -n "$cdiv" ]] && printf ',"divisao":%s' "$(json_str "$cdiv")"
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

# -----------------------------------------------------------------------------
# Planos (docs/PROTOCOLO-PLANOS.md §2–§4): dados/planos/<c>.json
# -----------------------------------------------------------------------------
# O ficheiro é uma linha JSON "plana" (texto, null, true/false), escrita pelo
# serviço pagamentos (Node) ou por "./domus.sh plano". Lê-se aqui um campo de
# cada vez, sem precisar de ferramentas extra.
plano_fich() { printf '%s/%s.json' "$PLANOS_DIR" "$1"; }

# Valor de um campo de texto (vazio se for null ou não existir). <ficheiro> <campo>
plano_campo() {
  local txt re
  [[ -f "$1" ]] || return 0
  txt="$(< "$1")"
  re="\"$2\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]*)\""
  if [[ "$txt" =~ $re ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

plano_teste_usado() { # <ficheiro> — 0 se "teste_usado": true
  local txt re='"teste_usado"[[:space:]]*:[[:space:]]*true'
  [[ -f "$1" ]] || return 1
  txt="$(< "$1")"
  [[ "$txt" =~ $re ]]
}

# O cliente está em modo básico (suspenso ou cancelado)? Sem ficheiro = não
# (clientes antigos: conforto ativo, §2).
cliente_suspenso() { # <cliente>
  local e
  e="$(plano_campo "$(plano_fich "$1")" estado)"
  [[ "$e" == suspenso || "$e" == cancelado ]]
}

# Data ISO em UTC ("2026-10-01T10:00:00Z"). [deslocamento para o date -d]
agora_iso() {
  if [[ -n "${1:-}" ]]; then date -u -d "$1" +%Y-%m-%dT%H:%M:%SZ; else date -u +%Y-%m-%dT%H:%M:%SZ; fi
}

json_ou_null() { if [[ -n "$1" ]]; then json_str "$1"; else printf 'null'; fi; }

# Conteúdo exato de domus/<c>/_plano (§2), a partir do ficheiro.
json_plano() { # <cliente>
  local f campo primeiro=1
  f="$(plano_fich "$1")"
  printf '{'
  for campo in plano estado desde proximo_pagamento aviso_ate gerido; do
    (( primeiro )) || printf ','
    primeiro=0
    printf '"%s":%s' "$campo" "$(json_ou_null "$(plano_campo "$f" "$campo")")"
  done
  printf '}'
}

# Ficheiro ACL do Mosquitto, gerado a partir do estado. Escrito no stdout.
# Contrato: v1 "Permissões" + v2 secção 5 + v3 secção 10.
#
# Os comandos dos aparelhos são escritos POR APARELHO (domus/C/<id>/+/set,
# .../rpc, .../command, ...) e não com "+" no lugar do aparelho. Com
# "domus/C/+/+/set" o cliente conseguia escrever em tópicos dentro das áreas
# reservadas do motor, por exemplo domus/C/_automacoes/admin/set ou
# domus/C/_config/x/set. Assim só há dois tipos de escrita do cliente:
#   - comandos para os SEUS aparelhos (ids nunca começam por "_");
#   - a lista fechada de pedidos ao motor (_alarme/set, _config/set, ...).
# Os tópicos reservados (_aparelhos, _alarme, _config, _modo, _cenas, _saude,
# _energia, _presenca, _automacoes/registo, _automacoes/avisos,
# _automacoes/admin, ...) continuam só de leitura para o cliente.
# O _plano (PROTOCOLO-PLANOS §2) só é escrito pelo "pagamentos" (e admin/motor).
# Cliente suspenso/cancelado (dados/planos/<c>.json, §3): só lê domus/<c>/_plano;
# os utilizadores dos aparelhos dele não mudam (interruptores e estados continuam).
# Ver testes/acl.sh.
PEDIDOS_CLIENTE="_alarme/set _automacoes/set _fcm/registar _config/set _modo/set _cenas/set _cenas/executar _automacoes/executar _presenca/set"

gerar_acl() {
  local c id t
  local -a ids
  cat <<'EOF'
# GERADO AUTOMATICAMENTE pelo domus.sh — NÃO EDITAR À MÃO.
# Fonte: servidor/dados/clientes/*.tsv
# Contrato: docs/PROTOCOLO-MQTT.md (v1), PROTOCOLO-MQTT-v2.md (§5) e PROTOCOLO-MQTT-v3.md (§10)

# Administrador (script domus.sh): tudo em domus/
user admin
topic readwrite domus/#

# Motor de regras (serviço interno): tudo em domus/
user motor
topic readwrite domus/#

# Serviço de pagamentos (PROTOCOLO-PLANOS §4): só publica o _plano de cada cliente
user pagamentos
topic write domus/+/_plano

# Painel da empresa (docs/PAINEL-EMPRESA.md §2): só LÊ, para os alertas técnicos
user painel
topic read domus/#
EOF
  while IFS= read -r c; do
    mapfile -t ids < <(ler_aparelhos "$c" | cut -f1)
    if cliente_suspenso "$c"; then
      printf '\n# ===== Cliente %s (%s: modo básico, só lê o _plano) =====\n' "$c" "$(plano_campo "$(plano_fich "$c")" estado)"
      printf 'user %s\n' "$c"
      printf 'topic read domus/%s/_plano\n' "$c"
    else
      printf '\n# ===== Cliente %s =====\n' "$c"
      printf 'user %s\n' "$c"
      printf 'topic read domus/%s/#\n' "$c"
      printf '# pedidos ao motor (v2 §5, v3 §10)\n'
      for t in $PEDIDOS_CLIENTE; do
        printf 'topic write domus/%s/%s\n' "$c" "$t"
      done
      for id in "${ids[@]}"; do
        printf '# comandos para o aparelho %s\n' "$id"
        printf 'topic write domus/%s/%s/+/set\n' "$c" "$id"        # canais OpenBeken (<n>/set), led_dimmer/set
        printf 'topic write domus/%s/%s/rpc\n' "$c" "$id"          # Shelly RPC (luz, estore)
        printf 'topic write domus/%s/%s/command\n' "$c" "$id"      # Shelly status_update
        printf 'topic write domus/%s/%s/command/+\n' "$c" "$id"    # Shelly command/switch:<id>
      done
    fi
    for id in "${ids[@]}"; do
      printf '\n# Aparelho %s de %s\n' "$id" "$c"
      printf 'user %s-%s\n' "$c" "$id"
      printf 'topic readwrite domus/%s/%s/#\n' "$c" "$id"
    done
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

# Conteúdo do acl instalado (vazio se não existir).
ler_acl_instalada() {
  if [[ "$MODO" == docker ]]; then
    no_mosquitto sh -c 'cat "$1/acl" 2>/dev/null || true' sh "$MOSQ_DIR"
  else
    cat "$MOSQ_DIR/acl" 2>/dev/null || true
  fi
}

# Regenera o acl e recarrega o Mosquitto SÓ se mudou. Devolve 0 se mudou.
sincronizar_acl() {
  local novo atual
  novo="$(gerar_acl)"
  atual="$(ler_acl_instalada)"
  [[ "$novo" != "$atual" ]] || return 1
  aplicar_acl
  return 0
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
# Texto curto do estado de arranque. <arranque>
arranque_texto() {
  case "$1" in
    ligado) printf 'liga sozinho quando a luz volta' ;;
    ultimo) printf 'volta ao estado em que estava' ;;
    *)      printf 'fica desligado quando a luz volta' ;;
  esac
}

instrucoes_openbeken() { # <c> <id> <senha> <host> <medidor> <bateria> <canais>
  local c="$1" id="$2" senha="$3" host="$4" med="$5" bat="$6" canais="$7"
  local n funcao cnome ent sim arr carga cdiv rotulo sv tem_rele=0 tem_sensor=0 tem_perigosa=0
  cat <<EOF
--- 1. Ligação ao servidor --------------------------------------------------
No OpenBeken (http://<ip-do-aparelho>) abre  Config -> Configure MQTT  e preenche:

  Host ............ $host
  Port ............ 1883
  Client Topic .... domus/$c/$id
  Group Topic ..... (deixar vazio)
  User ............ $c-$id
  Password ........ $senha

Carrega em "Submit" e reinicia o aparelho. Deve aparecer
  domus/$c/$id/connected = online
(Alternativa na consola do Web App: MqttHost $host / MqttUser $c-$id /
 MqttPassword <palavra-passe>; o Client Topic e a porta preenchem-se no
 formulário acima.)

--- 2. Canais (Config -> Configure Module) ------------------------------------
EOF
  while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
    rotulo="${cnome:+ (\"$cnome\")}"
    case "$funcao" in
      interruptor) printf '  canal %s  %-12s relé; lê %s/get (1/0), recebe %s/set%s\n' "$n" "$funcao" "$n" "$n" "$rotulo"; tem_rele=1 ;;
      luz)         printf '  canal %s  %-12s relé/LED; brilho 0-100 em led_dimmer/get e led_dimmer/set%s\n' "$n" "$funcao" "$rotulo"; tem_rele=1 ;;
      estore)      printf '  canal %s  %-12s posição 0 (fechado) a 100 (aberto) em %s/get e %s/set%s\n' "$n" "$funcao" "$n" "$n" "$rotulo" ;;
      porta)       printf '  canal %s  %-12s sensor: %s/get = 1 aberta / 0 fechada%s%s\n' "$n" "$funcao" "$n" "$rotulo" "$( [[ "$ent" == 1 ]] && printf '  [porta de entrada]')"; tem_sensor=1 ;;
      movimento)   printf '  canal %s  %-12s sensor: %s/get = 1 movimento / 0 sem movimento%s\n' "$n" "$funcao" "$n" "$rotulo"; tem_sensor=1 ;;
      bateria)     printf '  canal %s  %-12s %s/get = percentagem 0-100\n' "$n" "$funcao" "$n" ;;
    esac
    [[ "$carga" == perigosa ]] && tem_perigosa=1
  done < <(canais_linhas "$canais")

  if (( tem_rele )); then
    cat <<'EOF'

--- 3. Botão físico -> relé, SEM internet -----------------------------------
Em Config -> Configure Module, para cada canal acima:
  - o pino do relé com o papel "Relay" (Rel)   e o número do canal;
  - o pino do botão com o papel "Button" (Btn) e o MESMO número do canal
    ("Button_n" se o botão funcionar ao contrário; "ToggleChannelOnToggle" para
    um interruptor de parede de 2 posições ligado a uma entrada).
Com o botão e o relé no mesmo canal, o OpenBeken liga/desliga o relé
localmente: não precisa de Wi-Fi, do servidor nem do MQTT. É assim que
funcionam sem internet o botão da frente do disjuntor Tongou TO-Q-SY1-JWT e as
teclas dos interruptores de parede. Teste: desligue o router e carregue no
botão — o relé tem de mudar.
Interruptores de parede com TuyaMCU (as teclas ligam ao microcontrolador e
não aos pinos): o próprio MCU trata das teclas, mas alguns ignoram-nas quando
não têm Wi-Fi/servidor; nesse caso é preciso o comando tuyaMcu_defWiFiState no
autoexec.bat (valor: verificar na documentação do OpenBeken).
EOF
  fi

  # Estado depois de um corte de luz (contrato v3 §4)
  if [[ "$canais" == *:interruptor:* || "$canais" == *:luz:* || "$canais" == *:estore:* ]]; then
    cat <<'EOF'

--- 4. Estado depois de um corte de luz: autoexec.bat -------------------------
Web App -> separador "LittleFS" -> ficheiro autoexec.bat (criar se não
existir), acrescentar estas linhas e "Save". Corre em cada arranque.
(SetStartValue <canal> <valor>: 0 = desligado, 1 = ligado, -1 = último estado)

EOF
    while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
      case "$arr" in ligado) sv=1 ;; ultimo) sv=-1 ;; *) sv=0 ;; esac
      if [[ "$funcao" == interruptor || "$funcao" == luz ]]; then
        printf '  SetStartValue %s %s\n' "$n" "$sv"
      fi
    done < <(canais_linhas "$canais")
    printf '\n'
    while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
      e_controlavel "$funcao" || continue
      if [[ "$funcao" == estore ]]; then
        printf '  canal %s: estore — não se usa SetStartValue; confirme que fica parado depois de um corte.\n' "$n"
      else
        printf '  canal %s%s: %s%s\n' "$n" "${cnome:+ ($cnome)}" "$(arranque_texto "$arr")" "$( [[ "$carga" == perigosa ]] && printf ' [carga perigosa]')"
      fi
    done < <(canais_linhas "$canais")
    cat <<EOF
Teste: ligue, corte a corrente no quadro 10 s, volte a ligar e confirme.
Depois de cada atualização (OTA) do firmware, repita o teste.
Comandos: $OBK_DOC
EOF
  fi
  if (( tem_perigosa )); then
    cat <<'EOF'

ATENÇÃO — carga perigosa: o OpenBeken não tem, nesta configuração, um limite
de tempo local. O limite de 4 h das automações é aplicado pelo motor (precisa
de internet). Mantenha arranque=desligado. Para um temporizador local, ver os
scripts do OpenBeken (verificar na documentação do OpenBeken).
EOF
  fi
  if [[ "$med" == 1 || "$med" == 2 ]]; then
    cat <<'EOF'

Medidor: configure o chip de medição (BL0937 / BL0942 / CSE7766) em
Configure Module e confirme que aparecem os tópicos power/get, voltage/get,
current/get e energycounter/get (energia em Wh).
EOF
  fi
  if [[ "$bat" == 1 ]]; then
    cat <<'EOF'

--- Sensor a pilhas Tuya (TuyaMCU de baixo consumo) ---------------------------
No autoexec.bat (Web App -> LittleFS), trocando <dpID_...> pelos do modelo:

  startDriver TuyaMCU
  startDriver tmSensor
EOF
    while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
      case "$funcao" in
        porta|movimento) printf '  linkTuyaMCUOutputToChannel <dpID_%s> bool %s\n' "$funcao" "$n" ;;
        bateria)         printf '  linkTuyaMCUOutputToChannel <dpID_bateria> val %s\n' "$n" ;;
      esac
    done < <(canais_linhas "$canais")
    cat <<EOF

Os dpIDs variam de modelo para modelo. Para os descobrir:
  1. na consola do Web App:  loglevel 4   (e no separador Logs escolha o
     nível "Debug" e o filtro TuyaMCU);
  2. acorde o sensor (botão de emparelhamento) e provoque eventos: abrir e
     fechar a porta / passar à frente do sensor;
  3. nos Logs aparecem as mensagens do TuyaMCU com "dpId" e o valor: o que
     muda com a porta/movimento é o do estado; o que tem 0-100 (ou
     baixo/médio/alto) é o da bateria. Com o sensor acordado,
     tuyaMcu_sendQueryState pede ao MCU todos os valores de uma vez.
Frequente: estado no dpID 1 e bateria no dpID 2 (percentagem) ou 3 (nível;
use "enum" em vez de "val" e a app mostrará 0/1/2).
Se o sensor não responder: tuyaMcu_setBaudRate 115200 (o normal é 9600) e,
em sensores com protocolo TuyaMCU v3, tuyaMcu_batteryPoweredMode —
verificar na documentação do OpenBeken: $OBK_DOC
Faça a configuração com o sensor acordado: ele adormece em poucos segundos.
EOF
  elif (( tem_sensor )); then
    printf '\nSensor com fios: pino do sensor com o papel "DigitalInput" (ou "DigitalInput_n") e o número do canal.\n'
  fi
  return 0
}

# URL de RPC do Shelly (Gen2/Gen3) para colar no browser da rede local.
url_rpc() { # <método> [parâmetros]
  printf '  http://<ip-do-aparelho>/rpc/%s%s\n' "$1" "${2:+?$2}"
}

instrucoes_shelly() { # <c> <id> <senha> <host> <medidor> <bateria> <canais>
  local c="$1" id="$2" senha="$3" host="$4" med="$5" bat="$6" canais="$7"
  local n funcao cnome ent sim arr carga cdiv comp k estado auto mqtt
  cat <<EOF
--- 1. Ligação ao servidor --------------------------------------------------
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

Em alternativa, num browser ligado ao Wi-Fi da casa, abra um endereço de
cada vez (troque <ip-do-aparelho> pelo IP do Shelly; o browser trata das
aspas):
EOF
  mqtt="$(printf '{"enable":true,"server":%s,"client_id":%s,"user":%s,"pass":%s,"topic_prefix":%s,"enable_control":true,"rpc_ntf":true,"status_ntf":true}' \
    "$(json_str "$host:1883")" "$(json_str "$c-$id")" "$(json_str "$c-$id")" "$(json_str "$senha")" "$(json_str "domus/$c/$id")")"
  url_rpc MQTT.SetConfig "config=$mqtt"
  url_rpc Shelly.Reboot
  if [[ ! "$senha" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    printf '  (A palavra-passe tem símbolos que podem estragar o endereço: prefira o formulário.)\n'
  fi

  printf '\n--- 2. Canais (canal n = componente n-1 do Shelly) ---------------------------\n'
  while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
    case "$funcao" in
      interruptor) comp="switch:$((n - 1))" ;;
      luz)         comp="light:$((n - 1))" ;;
      estore)      comp="cover:$((n - 1))  (modo \"Cover\" e calibrado)" ;;
      porta|movimento) comp="input:$((n - 1))  (entrada do tipo \"Switch\")" ;;
      bateria)     comp="(bateria: não definido para Shelly na v2)" ;;
    esac
    printf '  canal %s  %-12s %s%s\n' "$n" "$funcao" "$comp" "${cnome:+  (\"$cnome\")}"
  done < <(canais_linhas "$canais")

  if [[ "$canais" == *:interruptor:* || "$canais" == *:luz:* || "$canais" == *:estore:* ]]; then
    cat <<'EOF'

--- 3. Regras no próprio Shelly (funcionam SEM internet) ----------------------
Abra cada endereço no browser (rede local). Cada um responde com
{"restart_required":false} ou parecido; se pedir, reinicie no fim.
  initial_state: estado depois de um corte ("off" desligado, "on" ligado,
                 "restore_last" último estado)
  in_mode:       o interruptor de parede atua o relé localmente:
                 "follow" = interruptor de parede normal (basculante; o relé
                 segue a posição), "flip" = cada mudança troca o relé,
                 "momentary" = botão de pressão (campainha)
  auto_off:      desliga sozinho ao fim de auto_off_delay segundos (só nas
                 cargas perigosas: limite de segurança local de 4 h)

EOF
    while IFS="$US" read -r n funcao cnome ent sim arr carga cdiv; do
      k=$((n - 1))
      case "$arr" in ligado) estado=on ;; ultimo) estado=restore_last ;; *) estado=off ;; esac
      if [[ "$carga" == perigosa ]]; then auto="\"auto_off\":true,\"auto_off_delay\":$AUTO_OFF_S"
      else auto='"auto_off":false'; fi
      case "$funcao" in
        interruptor)
          printf '  # canal %s%s: %s%s\n' "$n" "${cnome:+ ($cnome)}" "$(arranque_texto "$arr")" \
            "$( [[ "$carga" == perigosa ]] && printf ', desliga sozinho ao fim de 4 h')"
          url_rpc Switch.SetConfig "id=$k&config={\"initial_state\":\"$estado\",\"in_mode\":\"follow\",$auto}" ;;
        luz)
          printf '  # canal %s%s: %s  (Light.SetConfig: verificar os campos na documentação da Shelly)\n' "$n" "${cnome:+ ($cnome)}" "$(arranque_texto "$arr")"
          url_rpc Light.SetConfig "id=$k&config={\"initial_state\":\"$estado\",$auto}" ;;
        estore)
          printf '  # canal %s%s: estore — na app Shelly confirme que depois de um corte fica parado\n' "$n" "${cnome:+ ($cnome)}"
          printf '  #   (Settings -> Power on default / estado inicial: "Stop"; verificar na documentação da Shelly)\n' ;;
      esac
    done < <(canais_linhas "$canais")
    cat <<'EOF'

Teste: desligue o router e use o interruptor de parede — o relé tem de mudar.
Corte a corrente 10 s e confirme o estado com que o aparelho arranca.
Documentação: https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch
              https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt
EOF
  fi
  if [[ "$med" == 1 || "$med" == 2 ]]; then
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
# Lê uma palavra-passe sem a pôr na linha de comando: no terminal pede-a duas
# vezes sem eco; sem terminal lê a primeira linha do stdin.
ler_senha() { # <descrição> — imprime a palavra-passe
  local p p2
  if [[ -t 0 ]]; then
    read -r -s -p "Palavra-passe $1: " p || true; printf '\n' >&2
    read -r -s -p "Repita a palavra-passe: " p2 || true; printf '\n' >&2
    [[ "$p" == "$p2" ]] || erro "as palavras-passe não coincidem"
  else
    IFS= read -r p || [[ -n "$p" ]] || erro "sem palavra-passe no stdin"
  fi
  printf '%s' "$p"
}

cmd_admin() {
  (( $# <= 1 )) || erro "uso: ./domus.sh admin [palavra-passe]  (sem argumento pede-a no terminal ou lê-a do stdin)"
  if (( $# == 0 )); then
    local senha
    senha="$(ler_senha "do administrador (admin)")"
    set -- "$senha"
  fi
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
  # ... e o do serviço de pagamentos (PROTOCOLO-PLANOS §4).
  if [[ ! -e "$PAGAMENTOS_MARCA" ]]; then
    if [[ -n "$(ler_env PAGAMENTOS_MQTT_PASS)" ]]; then
      info ""
      cmd_pagamentos
    else
      aviso "falta PAGAMENTOS_MQTT_PASS no .env; depois corra: ./domus.sh pagamentos"
    fi
  fi
  # ... e o do painel da empresa (só leitura, docs/PAINEL-EMPRESA.md §2).
  if [[ ! -e "$PAINEL_MARCA" ]]; then
    if [[ -n "$(ler_env PAINEL_MQTT_PASS)" ]]; then
      info ""
      cmd_painel_mqtt
    else
      aviso "falta PAINEL_MQTT_PASS no .env; depois corra: ./domus.sh painel-mqtt"
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
  # Só no fim: se o ntfy falhar, o "admin"/instalar.sh voltam a tentar.
  : > "$MOTOR_MARCA"
  info "Se o motor já estava a correr: docker compose restart motor"
}

cmd_pagamentos() {
  (( $# <= 1 )) || erro "uso: ./domus.sh pagamentos [palavra-passe]"
  local senha="${1:-}" env_senha
  env_senha="$(ler_env PAGAMENTOS_MQTT_PASS)"
  [[ -n "$senha" ]] || senha="$env_senha"
  [[ -n "$senha" ]] || erro "indique a palavra-passe ou defina PAGAMENTOS_MQTT_PASS no .env"
  validar_senha "$senha"
  verificar_mosquitto
  preparar_dados
  definir_senha_mqtt pagamentos "$senha"
  aplicar_acl
  : > "$PAGAMENTOS_MARCA"
  info "Utilizador 'pagamentos' criado/atualizado no Mosquitto (só publica domus/+/_plano)."
  if [[ -n "$env_senha" && "$senha" != "$env_senha" ]]; then
    aviso "a palavra-passe é diferente de PAGAMENTOS_MQTT_PASS no .env: atualize o .env e corra 'docker compose up -d pagamentos'"
  fi
  info "Se o serviço pagamentos já estava a correr: docker compose restart pagamentos"
}

cmd_cliente() {
  (( $# >= 1 && $# <= 2 )) || erro "uso: ./domus.sh cliente <codigo> [palavra-passe]"
  local c="$1" senha="${2:-}" gerada=0
  validar_id "$c" "código de cliente"
  [[ " $RESERVADOS " != *" $c "* ]] || erro "'$c' é reservado"
  preparar_dados
  if ! cliente_existe "$c" && utilizador_ocupado "$c"; then
    erro "já existe um utilizador MQTT chamado '$c' (um aparelho). Escolha outro código."
  fi
  if [[ -z "$senha" ]]; then senha="$(gerar_senha)"; gerada=1; fi
  validar_senha "$senha"
  senha_admin >/dev/null
  verificar_mosquitto

  local novo=0
  cliente_existe "$c" || { ( umask 077; : > "$CLIENTES_DIR/$c.tsv" ); permissoes_tsv "$CLIENTES_DIR/$c.tsv"; novo=1; }
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
  local canais="" med=0 bat=0 geral=0 divisao="" tem_divisao=0
  while (( $# )); do
    case "$1" in
      --canais)   (( $# >= 2 )) || erro "--canais precisa de um valor"; canais="$2"; shift 2 ;;
      --canais=*) canais="${1#--canais=}"; shift ;;
      --divisao)  (( $# >= 2 )) || erro "--divisao precisa de um valor"; divisao="$2"; tem_divisao=1; shift 2 ;;
      --divisao=*) divisao="${1#--divisao=}"; tem_divisao=1; shift ;;
      --medidor)  med=1; shift ;;
      --geral)    geral=1; shift ;;
      --bateria)  bat=1; shift ;;
      --*)        erro "opção desconhecida: $1" ;;
      *)          pos+=("$1"); shift ;;
    esac
  done
  (( ${#pos[@]} >= 4 && ${#pos[@]} <= 5 )) \
    || erro 'uso: ./domus.sh aparelho <cliente> <id> <openbeken|shelly> "<Nome>" [--canais "1:interruptor:Teto:arranque=ultimo"] [--divisao "Sala"] [--medidor [--geral]] [--bateria] [palavra-passe]  (ver ./domus.sh ajuda)'
  if (( geral )); then
    (( med )) || erro "--geral só pode ser usado com --medidor (é o medidor geral da casa)"
    (( bat )) && erro "--geral não pode ser usado com --bateria"
    med=2
  fi
  local c="${pos[0]}" id="${pos[1]}" tipo="${pos[2]}" nome="${pos[3]}" senha="${pos[4]:-}"
  validar_id "$c" "código de cliente"
  validar_id "$id" "id do aparelho"
  [[ "$tipo" == openbeken || "$tipo" == shelly ]] || erro "tipo inválido: '$tipo' (use openbeken ou shelly)"
  nome="$(limpar_texto "$nome")"
  [[ -n "$nome" ]] || erro "o nome do aparelho não pode estar vazio"
  if (( tem_divisao )); then
    divisao="$(limpar_texto "$divisao")"
    validar_divisao "$divisao" "em --divisao"
  fi
  if [[ -n "$canais" ]]; then
    canais="$(normalizar_canais "$canais")"
  else
    canais="$(normalizar_canais "1:interruptor")"
    (( bat )) && aviso "--bateria sem --canais: normalmente é --canais \"1:porta,2:bateria\" ou \"1:movimento,2:bateria\""
  fi
  if (( bat )) && [[ "$canais" != *:bateria:* ]]; then
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
  guardar_aparelho "$c" "$id" "$tipo" "$med" "$bat" "$canais" "$nome" "$divisao"
  aplicar_acl
  publicar_lista "$c"
  info "Aparelho '$id' guardado; lista domus/$c/_aparelhos atualizada."
  instrucoes_aparelho "$c" "$id" "$tipo" "$nome" "$senha" "$med" "$bat" "$canais"
}

cmd_remover_aparelho() {
  (( $# == 2 )) || erro "uso: ./domus.sh remover-aparelho <cliente> <id>"
  local c="$1" id="$2" linha canais sub n _resto k
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
  while IFS="$US" read -r n _resto; do
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
  local c id tipo med bat canais nome adiv n=0 extra cn cf cnome ent sim arr carga cdiv linha
  while IFS= read -r c; do
    n=$((n + 1))
    if [[ -f "$(plano_fich "$c")" ]]; then
      printf '%s   [plano: %s, %s, %s]\n' "$c" "$(plano_campo "$(plano_fich "$c")" plano)" \
        "$(plano_campo "$(plano_fich "$c")" estado)" "$(plano_campo "$(plano_fich "$c")" gerido)"
    else
      printf '%s\n' "$c"
    fi
    if [[ ! -s "$CLIENTES_DIR/$c.tsv" ]]; then
      printf '   (sem aparelhos)\n'
    fi
    while IFS="$TAB" read -r id tipo med bat canais nome adiv; do
      extra=""
      [[ "$med" == 1 ]] && extra+=" medidor"
      [[ "$med" == 2 ]] && extra+=" medidor geral"
      [[ "$bat" == 1 ]] && extra+=" bateria"
      [[ -n "$adiv" ]] && extra+=" divisão: $adiv"
      printf '   %-20s %-10s %-24s utilizador: %s-%s%s\n' "$id" "$tipo" "$nome" "$c" "$id" "${extra:+  [${extra# }]}"
      while IFS="$US" read -r cn cf cnome ent sim arr carga cdiv; do
        linha="$cn:$cf${cnome:+:$cnome}"
        [[ "$ent" == 1 ]] && linha+=":entrada"
        [[ "$sim" == 1 ]] && linha+=":simular"
        [[ -n "$arr" ]] && linha+=":arranque=$arr"
        [[ -n "$carga" ]] && linha+=":carga=$carga"
        [[ -n "$cdiv" ]] && linha+=":divisao=$cdiv"
        printf '      canal %s\n' "$linha"
      done < <(canais_linhas "$canais")
    done < <(ler_aparelhos "$c")
  done < <(listar_clientes)
  (( n )) || info "(ainda não há clientes)"
  [[ -s "$ADMIN_SENHA_FICH" ]] || info "Atenção: ainda não há administrador (./domus.sh admin <palavra-passe>)."
  [[ -e "$MOTOR_MARCA" ]] || info "Atenção: o utilizador 'motor' ainda não foi criado (./domus.sh motor)."
  [[ -e "$PAGAMENTOS_MARCA" ]] || info "Atenção: o utilizador 'pagamentos' ainda não foi criado (./domus.sh pagamentos)."
  [[ -e "$PAINEL_MARCA" ]] || info "Atenção: o utilizador 'painel' ainda não foi criado (./domus.sh painel-mqtt)."
  return 0
}

cmd_acl() {
  preparar_dados
  verificar_mosquitto
  aplicar_acl
  info "ACL regenerada e Mosquitto recarregado."
}

# Gestão manual da subscrição (PROTOCOLO-PLANOS §2, §4).
cmd_plano() {
  local -a pos=()
  local estado=ativo gerido=manual
  while (( $# )); do
    case "$1" in
      --estado)   (( $# >= 2 )) || erro "--estado precisa de um valor"; estado="$2"; shift 2 ;;
      --estado=*) estado="${1#--estado=}"; shift ;;
      --gerido)   (( $# >= 2 )) || erro "--gerido precisa de um valor"; gerido="$2"; shift 2 ;;
      --gerido=*) gerido="${1#--gerido=}"; shift ;;
      --*)        erro "opção desconhecida: $1" ;;
      *)          pos+=("$1"); shift ;;
    esac
  done
  (( ${#pos[@]} == 2 )) \
    || erro "uso: ./domus.sh plano <cliente> <base|conforto|premium> [--estado ativo|teste|em_atraso|suspenso|cancelado] [--gerido manual|stripe]"
  local c="${pos[0]}" plano="${pos[1]}"
  validar_id "$c" "código de cliente"
  [[ " $PLANOS " == *" $plano "* ]] || erro "plano inválido: '$plano' (use: $PLANOS)"
  [[ " $ESTADOS_PLANO " == *" $estado "* ]] || erro "estado inválido: '$estado' (use: $ESTADOS_PLANO)"
  [[ "$gerido" == manual || "$gerido" == stripe ]] || erro "--gerido inválido: '$gerido' (use manual ou stripe)"
  preparar_dados
  cliente_existe "$c" || erro "o cliente '$c' não existe. Crie-o com: ./domus.sh cliente $c"
  senha_admin >/dev/null
  verificar_mosquitto

  local f agora velho_plano velho_estado velho_desde velho_aviso scli ssub teste=false desde aviso="" proximo=""
  f="$(plano_fich "$c")"
  agora="$(agora_iso)"
  velho_plano="$(plano_campo "$f" plano)"
  velho_estado="$(plano_campo "$f" estado)"
  velho_desde="$(plano_campo "$f" desde)"
  velho_aviso="$(plano_campo "$f" aviso_ate)"
  scli="$(plano_campo "$f" stripe_cliente)"
  ssub="$(plano_campo "$f" stripe_subscricao)"
  [[ "$scli" =~ ^[A-Za-z0-9_]*$ ]] || scli=""
  [[ "$ssub" =~ ^[A-Za-z0-9_]*$ ]] || ssub=""
  plano_teste_usado "$f" && teste=true
  if [[ "$gerido" == stripe && -z "$ssub" ]]; then
    erro "o cliente '$c' não tem subscrição no Stripe: não pode ser gerido pelo Stripe (use --gerido manual)"
  fi
  [[ "$estado" == teste ]] && teste=true
  # desde: quando mudou o plano ou o estado (mantém-se se nada mudou)
  if [[ "$velho_plano" == "$plano" && "$velho_estado" == "$estado" && -n "$velho_desde" ]]; then
    desde="$velho_desde"
  else
    desde="$agora"
  fi
  case "$estado" in
    em_atraso)
      if [[ ( "$velho_estado" == em_atraso || "$velho_estado" == suspenso ) && -n "$velho_aviso" ]]; then
        aviso="$velho_aviso"
      else
        aviso="$(agora_iso "+$DIAS_AVISO days")"
      fi ;;
    suspenso) aviso="$velho_aviso" ;;
  esac
  [[ "$gerido" == stripe ]] && proximo="$(plano_campo "$f" proximo_pagamento)"
  [[ "$estado" == suspenso || "$estado" == cancelado ]] && proximo=""

  local json tmp
  json="$(printf '{"plano":%s,"estado":%s,"desde":%s,"proximo_pagamento":%s,"aviso_ate":%s,"gerido":%s,"stripe_cliente":%s,"stripe_subscricao":%s,"teste_usado":%s,"atualizado":%s}' \
    "$(json_str "$plano")" "$(json_str "$estado")" "$(json_str "$desde")" "$(json_ou_null "$proximo")" \
    "$(json_ou_null "$aviso")" "$(json_str "$gerido")" "$(json_ou_null "$scli")" "$(json_ou_null "$ssub")" \
    "$teste" "$(json_str "$agora")")"
  tmp="$(mktemp "$PLANOS_DIR/.tmp.XXXXXX")"
  printf '%s\n' "$json" > "$tmp"
  chmod 644 "$tmp"
  if [[ "$(id -u)" == 0 ]]; then chown 1000:1000 "$tmp" 2>/dev/null || true; fi
  mv "$tmp" "$f"

  publicar_retida "domus/$c/_plano" "$(json_plano "$c")"
  if sincronizar_acl; then info "Permissões do cliente '$c' atualizadas."; fi
  info "Plano de '$c': $plano, $estado (gerido: $gerido)${aviso:+, aviso até $aviso}."
  if cliente_suspenso "$c"; then
    info "Modo básico: a app e o site só mostram a subscrição; os interruptores e os aparelhos continuam a funcionar."
  fi
  if [[ -n "$ssub" && "$gerido" == manual ]]; then
    aviso "o cliente tem a subscrição $ssub no Stripe: a cobrança continua até a cancelar no painel do Stripe. Enquanto for 'manual', os eventos do Stripe não mudam o estado (./domus.sh plano $c $plano --gerido stripe devolve-lhe a gestão)."
  fi
}

cmd_sincronizar_planos() {
  (( $# == 0 )) || erro "uso: ./domus.sh sincronizar-planos"
  preparar_dados
  local f c e
  shopt -s nullglob
  for f in "$PLANOS_DIR"/*.json; do
    c="${f##*/}"; c="${c%.json}"
    e="$(plano_campo "$f" estado)"
    if [[ " $ESTADOS_PLANO " != *" $e "* ]]; then aviso "$f: estado inválido '$e' (ignorado)"; fi
    cliente_existe "$c" || aviso "$f: o cliente '$c' não existe (ignorado)"
  done
  shopt -u nullglob
  verificar_mosquitto
  if sincronizar_acl; then
    local suspensos=""
    while IFS= read -r c; do
      if cliente_suspenso "$c"; then suspensos+=" $c"; fi
    done < <(listar_clientes)
    info "ACL atualizada e Mosquitto recarregado. Em modo básico:${suspensos:- nenhum}"
  elif [[ -t 1 ]]; then
    info "Permissões já estão de acordo com os planos (nada a fazer)."
  fi
}

# -----------------------------------------------------------------------------
# Painel da empresa (docs/PAINEL-EMPRESA.md §2)
# -----------------------------------------------------------------------------
cmd_painel_mqtt() {
  (( $# <= 1 )) || erro "uso: ./domus.sh painel-mqtt [palavra-passe]"
  local senha="${1:-}" env_senha
  env_senha="$(ler_env PAINEL_MQTT_PASS)"
  [[ -n "$senha" ]] || senha="$env_senha"
  [[ -n "$senha" ]] || erro "indique a palavra-passe ou defina PAINEL_MQTT_PASS no .env"
  validar_senha "$senha"
  verificar_mosquitto
  preparar_dados
  definir_senha_mqtt painel "$senha"
  aplicar_acl
  : > "$PAINEL_MARCA"
  info "Utilizador 'painel' criado/atualizado no Mosquitto (só lê domus/#)."
  if [[ -n "$env_senha" && "$senha" != "$env_senha" ]]; then
    aviso "a palavra-passe é diferente de PAINEL_MQTT_PASS no .env: atualize o .env e corra 'docker compose up -d painel'"
  fi
  info "Se o painel já estava a correr: docker compose restart painel"
}

# Ficheiro entregue ao painel: dono uid 1000 (quando o domus.sh corre como root).
dar_ao_painel() { if [[ "$(id -u)" == 0 ]]; then chown "$UID_SERVICOS:$UID_SERVICOS" "$1" 2>/dev/null || true; fi; }

# A fila dados/pedidos-admin/ é escrita pelo painel, um serviço exposto à
# internet: tudo o que lá está é tratado como hostil.
#  - Como root, a pasta é root:1000 com modo 1770 (sticky): o painel cria e
#    apaga os seus ficheiros, mas não mexe em feitos/ (do root, nunca vazia).
#  - Cada pedido é MOVIDO para dados/.pedidos-em-curso/ (só do root) antes de
#    ser lido: o painel já não o pode trocar por um symlink entre a verificação
#    e a leitura. Resultados são escritos lá e movidos (rename) para a fila.
#  - O conteúdo tem de ser exatamente o JSON que o painel escreve (chaves por
#    ordem, textos sem aspas nem "\", sem caracteres de controlo); os valores
#    passam como argumentos separados aos comandos (nunca por eval/sh -c).
preparar_pedidos() {
  preparar_dados
  [[ -d "$PEDIDOS_DIR" && ! -L "$PEDIDOS_DIR" ]] || erro "$PEDIDOS_DIR não é uma pasta"
  if [[ "$(id -u)" == 0 ]]; then
    if ! chown "0:$UID_SERVICOS" "$PEDIDOS_DIR" || ! chmod 1770 "$PEDIDOS_DIR"; then erro "não foi possível preparar $PEDIDOS_DIR"; fi
  fi
  if [[ -L "$PEDIDOS_PRIV" ]]; then erro "$PEDIDOS_PRIV é um symlink: recusado"; fi
  mkdir -p "$PEDIDOS_PRIV"
  chmod 700 "$PEDIDOS_PRIV"
  if [[ -L "$FEITOS_DIR" ]]; then erro "$FEITOS_DIR é um symlink: recusado (apague-o)"; fi
  if [[ ! -d "$FEITOS_DIR" ]]; then mkdir -m 700 "$FEITOS_DIR" || erro "não foi possível criar $FEITOS_DIR"; fi
  if [[ "$(id -u)" == 0 && "$(stat -c %u "$FEITOS_DIR")" != 0 ]]; then erro "$FEITOS_DIR não pertence ao root: recusado"; fi
  [[ -e "$FEITOS_DIR/.domus" ]] || printf 'Pedidos do painel já tratados por ./domus.sh processar-pedidos.\n' > "$FEITOS_DIR/.domus"
}

escrever_resultado() { # <id> <json>
  local tmp
  tmp="$(mktemp "$PEDIDOS_PRIV/.resultado.XXXXXX")"
  printf '%s\n' "$2" > "$tmp"
  chmod 600 "$tmp"
  dar_ao_painel "$tmp"
  mv -f -T -- "$tmp" "$PEDIDOS_DIR/$1.resultado.json" \
    || { rm -f -- "$tmp"; aviso "não foi possível escrever o resultado do pedido $1"; }
}

resultado_erro() { # <id> <tipo> <mensagem>
  printf '{"id":%s,"tipo":%s,"ok":false,"erro":%s,"concluido":%s}' \
    "$(json_str "$1")" "$(json_ou_null "$2")" "$(json_str "$3")" "$(json_str "$(agora_iso)")"
}

# Corre um comando do domus.sh num subshell (um "erro" sai só do subshell).
# Guarda R_OUT (stdout), R_ERR (stderr) e R_ST (código de saída).
correr_comando() { # <função> [argumentos...]
  local ferr
  ferr="$(mktemp "$PEDIDOS_PRIV/.erros.XXXXXX")"
  set +e
  R_OUT="$(set -e; "$@" 2> "$ferr")"
  R_ST=$?
  set -e
  R_ERR="$(cat "$ferr")"
  rm -f -- "$ferr"
}

# Mensagem de erro para o resultado: a última linha "ERRO: ..." do comando.
erro_do_comando() {
  local l msg=""
  while IFS= read -r l; do
    [[ "$l" == "ERRO: "* ]] && msg="${l#ERRO: }"
  done <<< "$R_ERR"
  printf '%s' "${msg:-o comando falhou (código $R_ST)}"
}

avisos_do_comando() {
  local l out=""
  while IFS= read -r l; do
    [[ "$l" == "AVISO: "* ]] && out+="${out:+$'\n'}${l#AVISO: }"
  done <<< "$R_ERR"
  printf '%s' "$out"
}

# Valida um pedido (uma linha) e executa-o. Deixa o JSON do resultado em
# R_JSON e uma descrição em R_RESUMO.
executar_pedido() { # <id> <linha>
  local LC_ALL=C
  local id="$1" linha="$2" re tipo dados por c="" a="" senha="" ok_extra=0
  local -a args=()
  R_JSON=""; R_RESUMO=""
  recusar() { R_JSON="$(resultado_erro "$id" "${tipo:-}" "$1")"; R_RESUMO="recusado: $1"; }
  if [[ -z "$linha" || "$linha" == *[[:cntrl:]]* ]]; then recusar "pedido inválido (vazio ou com caracteres de controlo)"; return 0; fi
  re='^\{"id":"([pu]-[0-9]{14}-[0-9a-f]{8})","tipo":"([a-z-]{1,24})","dados":\{(.*)\},"por":"([^"\\]{1,254})","criado":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z"\}$'
  if [[ ! "$linha" =~ $re ]]; then recusar "pedido inválido (formato)"; return 0; fi
  tipo="${BASH_REMATCH[2]}"; dados="${BASH_REMATCH[3]}"; por="${BASH_REMATCH[4]}"
  if [[ "${BASH_REMATCH[1]}" != "$id" ]]; then recusar "pedido inválido (o id não corresponde ao ficheiro)"; return 0; fi
  if [[ "$id" != p-* ]]; then recusar "pedido inválido (só o domus.sh escreve pedidos u-)"; return 0; fi
  R_RESUMO="de $por"
  case "$tipo" in
    cliente)
      re='^"codigo":"([a-z0-9-]{1,32})"$'
      [[ "$dados" =~ $re ]] || { recusar "dados inválidos para 'cliente'"; return 0; }
      c="${BASH_REMATCH[1]}"
      [[ "$c" =~ $RE_ID ]] || { recusar "código de cliente inválido: '$c'"; return 0; }
      if cliente_existe "$c"; then recusar "o cliente '$c' já existe (o painel não muda palavras-passe de clientes)"; return 0; fi
      senha="$(gerar_senha)"
      args=(cmd_cliente "$c" "$senha") ;;
    aparelho)
      re='^"cliente":"([a-z0-9-]{1,32})","id":"([a-z0-9-]{1,32})","tipo":"(openbeken|shelly)","nome":"([^"\\]{1,240})","canais":"([^"\\]{0,4000})","divisao":"([^"\\]{0,160})","medidor":(true|false),"geral":(true|false),"bateria":(true|false),"substituir":(true|false)$'
      [[ "$dados" =~ $re ]] || { recusar "dados inválidos para 'aparelho'"; return 0; }
      c="${BASH_REMATCH[1]}"; a="${BASH_REMATCH[2]}"
      local atipo="${BASH_REMATCH[3]}" nome="${BASH_REMATCH[4]}" canais="${BASH_REMATCH[5]}" divisao="${BASH_REMATCH[6]}"
      local medidor="${BASH_REMATCH[7]}" geral="${BASH_REMATCH[8]}" bateria="${BASH_REMATCH[9]}" substituir="${BASH_REMATCH[10]}"
      [[ "$c" =~ $RE_ID && "$a" =~ $RE_ID ]] || { recusar "código de cliente ou id de aparelho inválido"; return 0; }
      # Um valor começado por "-" seria lido como opção pelo cmd_aparelho.
      if [[ "$nome" == -* || "$canais" == -* || "$divisao" == -* ]]; then recusar "nome, canais ou divisão não podem começar por '-'"; return 0; fi
      cliente_existe "$c" || { recusar "o cliente '$c' não existe"; return 0; }
      if aparelho_existe "$c" "$a" && [[ "$substituir" != true ]]; then
        recusar "o cliente '$c' já tem o aparelho '$a' (peça com \"substituir\" para o reconfigurar)"; return 0
      fi
      senha="$(gerar_senha)"
      args=(cmd_aparelho "$c" "$a" "$atipo" "$nome")
      [[ -n "$canais" ]] && args+=(--canais "$canais")
      [[ -n "$divisao" ]] && args+=(--divisao "$divisao")
      [[ "$medidor" == true ]] && args+=(--medidor)
      [[ "$geral" == true ]] && args+=(--geral)
      [[ "$bateria" == true ]] && args+=(--bateria)
      args+=("$senha") ;;
    remover-aparelho)
      re='^"cliente":"([a-z0-9-]{1,32})","id":"([a-z0-9-]{1,32})"$'
      [[ "$dados" =~ $re ]] || { recusar "dados inválidos para 'remover-aparelho'"; return 0; }
      c="${BASH_REMATCH[1]}"; a="${BASH_REMATCH[2]}"
      [[ "$c" =~ $RE_ID && "$a" =~ $RE_ID ]] || { recusar "código de cliente ou id de aparelho inválido"; return 0; }
      args=(cmd_remover_aparelho "$c" "$a") ;;
    plano)
      re='^"cliente":"([a-z0-9-]{1,32})","plano":"(base|conforto|premium)","estado":"(ativo|teste|em_atraso|suspenso|cancelado)"$'
      [[ "$dados" =~ $re ]] || { recusar "dados inválidos para 'plano'"; return 0; }
      c="${BASH_REMATCH[1]}"; args=(cmd_plano "$c" "${BASH_REMATCH[2]}" --estado "${BASH_REMATCH[3]}")
      [[ "$c" =~ $RE_ID ]] || { recusar "código de cliente inválido: '$c'"; return 0; } ;;
    *)
      recusar "tipo de pedido desconhecido: '$tipo'"; return 0 ;;
  esac

  correr_comando "${args[@]}"
  if (( R_ST != 0 )); then
    recusar "$(erro_do_comando)"
    return 0
  fi
  [[ "$tipo" == cliente || "$tipo" == aparelho ]] && ok_extra=1
  R_JSON="$(printf '{"id":%s,"tipo":%s,"ok":true,"cliente":%s,"aparelho":%s,"password":%s,"saida":%s,"avisos":%s,"concluido":%s}' \
    "$(json_str "$id")" "$(json_str "$tipo")" "$(json_str "$c")" "$(json_ou_null "$a")" \
    "$( (( ok_extra )) && json_str "$senha" || printf 'null')" "$(json_str "${R_OUT:0:65536}")" \
    "$(json_ou_null "$(avisos_do_comando)")" "$(json_str "$(agora_iso)")")"
  R_RESUMO="de $por: ok"
}

tratar_pedido() { # <nome do ficheiro> [expirado]
  local nome="$1" id="${1%.json}" pf="$PEDIDOS_PRIV/$1" linha tam ligacoes
  mv -f -T -- "$PEDIDOS_DIR/$nome" "$pf" 2>/dev/null || return 0    # já lá não está
  if [[ "${2:-}" == expirado ]]; then
    rm -rf -- "$pf"
    escrever_resultado "$id" "$(resultado_erro "$id" painel-utilizador "o painel não aplicou o pedido em 1 hora (está a correr?); o pedido foi apagado")"
    aviso "pedido $id (painel-utilizador) não foi aplicado pelo painel em 1 hora: apagado"
    return 0
  fi
  tam="$(stat -c %s -- "$pf" 2>/dev/null || echo 0)"
  ligacoes="$(stat -c %h -- "$pf" 2>/dev/null || echo 0)"
  if [[ -L "$pf" || ! -f "$pf" ]] || (( ligacoes != 1 || tam > PEDIDO_MAX )); then
    rm -rf -- "$pf"
    escrever_resultado "$id" "$(resultado_erro "$id" "" "pedido inválido (não é um ficheiro normal ou é demasiado grande)")"
    aviso "pedido $id recusado: não é um ficheiro normal ou é demasiado grande"
    return 0
  fi
  linha="$(LC_ALL=C head -c "$PEDIDO_MAX" -- "$pf" 2>/dev/null)" || linha=""
  executar_pedido "$id" "$linha"
  escrever_resultado "$id" "$R_JSON"
  mv -f -T -- "$pf" "$FEITOS_DIR/$nome" || rm -f -- "$pf"
  if [[ "$R_RESUMO" == recusado:* ]]; then aviso "pedido $id $R_RESUMO"; else info "pedido $id $R_RESUMO"; fi
}

# Há alguma coisa para processar-pedidos? (pedidos na fila, ou de uma execução
# interrompida.) Só lê as pastas: não cria nem muda nada.
ha_pedidos() {
  compgen -G "$PEDIDOS_DIR/[pu]-*.json" >/dev/null || compgen -G "$PEDIDOS_PRIV/p-*.json" >/dev/null
}

cmd_processar_pedidos() {
  (( $# == 0 )) || erro "uso: ./domus.sh processar-pedidos"
  preparar_pedidos
  local f nome n=0 agora mt
  local -a nomes=()
  shopt -s nullglob
  # Pedidos de uma execução interrompida (ex.: o VPS reiniciou a meio): não se
  # repetem (podem ter sido feitos em parte); ficam com um resultado de erro.
  for f in "$PEDIDOS_PRIV"/p-*.json; do
    nome="${f##*/}"
    [[ "$nome" =~ ^p-[0-9]{14}-[0-9a-f]{8}\.json$ ]] || continue
    escrever_resultado "${nome%.json}" "$(resultado_erro "${nome%.json}" "" "a execução do pedido foi interrompida; confirme no servidor (./domus.sh listar) e repita se for preciso")"
    mv -f -T -- "$f" "$FEITOS_DIR/$nome" || rm -rf -- "$f"
    aviso "pedido ${nome%.json}: execução anterior interrompida (não repetido)"
  done
  for f in "$PEDIDOS_DIR"/[pu]-*.json; do
    nome="${f##*/}"
    [[ "$nome" =~ ^[pu]-[0-9]{14}-[0-9a-f]{8}\.json$ ]] && nomes+=("$nome")
  done
  shopt -u nullglob
  (( ${#nomes[@]} )) || return 0
  mapfile -t nomes < <(printf '%s\n' "${nomes[@]}" | LC_ALL=C sort)
  agora="$(date +%s)"
  for nome in "${nomes[@]}"; do
    (( n < PEDIDOS_POR_VEZ )) || break
    if [[ "$nome" == u-* ]]; then
      # painel-utilizador: é o painel que o aplica; só se apaga se ficou esquecido.
      mt="$(stat -c %Y -- "$PEDIDOS_DIR/$nome" 2>/dev/null)" || continue
      if (( agora - mt > PEDIDO_U_EXPIRA_S )); then tratar_pedido "$nome" expirado; n=$((n + 1)); fi
      continue
    fi
    tratar_pedido "$nome"
    n=$((n + 1))
  done
}

cmd_painel_utilizador() {
  (( $# >= 2 && $# <= 3 )) || erro 'uso: ./domus.sh painel-utilizador <email> <ceo|tecnico|comercial> ["Nome"]'
  local email="$1" papel="$2" nome senha id json tmp i res="" rf espera
  local re_email='^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$'
  local re_erro='"erro":"([^"\\]*)"'
  nome="$(limpar_texto "${3:-}")"
  if (( ${#email} > 254 )) || [[ ! "$email" =~ $re_email ]]; then erro "email inválido: '$email'"; fi
  [[ "$papel" == ceo || "$papel" == tecnico || "$papel" == comercial ]] || erro "papel inválido: '$papel' (use ceo, tecnico ou comercial)"
  (( ${#nome} <= 120 )) || erro "nome demasiado longo (máx. 120 caracteres)"
  [[ "$nome" != *[[:cntrl:]]* ]] || erro "o nome tem caracteres inválidos"
  senha="$(ler_senha "de $email no painel")"
  (( ${#senha} >= 10 )) || erro "a palavra-passe deve ter pelo menos 10 caracteres"
  (( ${#senha} <= 200 )) || erro "a palavra-passe é demasiado longa (máx. 200 caracteres)"
  [[ "$senha" != *[[:cntrl:]]* ]] || erro "a palavra-passe tem caracteres inválidos"
  preparar_pedidos
  id="u-$(date -u +%Y%m%d%H%M%S)-$(gerar_aleatorio 8 'a-f0-9')"
  json="$(printf '{"id":%s,"tipo":"painel-utilizador","dados":{"email":%s,"papel":%s,"nome":%s,"password":%s},"por":"domus.sh","criado":%s}' \
    "$(json_str "$id")" "$(json_str "$email")" "$(json_str "$papel")" "$(json_str "$nome")" "$(json_str "$senha")" "$(json_str "$(agora_iso)")")"
  tmp="$(mktemp "$PEDIDOS_PRIV/.u.XXXXXX")"
  printf '%s\n' "$json" > "$tmp"
  chmod 600 "$tmp"
  dar_ao_painel "$tmp"
  mv -f -T -- "$tmp" "$PEDIDOS_DIR/$id.json"
  info "Pedido $id escrito (o painel aplica-o em poucos segundos)."
  espera="${DOMUS_ESPERA_PAINEL:-20}"
  [[ "$espera" =~ ^[0-9]{1,3}$ ]] || espera=20
  for (( i = 0; i < espera * 2; i++ )); do
    if [[ -e "$PEDIDOS_DIR/$id.resultado.json" || -L "$PEDIDOS_DIR/$id.resultado.json" ]]; then
      rf="$PEDIDOS_PRIV/$id.resultado.json"
      mv -f -T -- "$PEDIDOS_DIR/$id.resultado.json" "$rf" 2>/dev/null || break
      if [[ -f "$rf" && ! -L "$rf" ]] && (( $(stat -c %s -- "$rf") <= PEDIDO_MAX )); then
        res="$(head -c "$PEDIDO_MAX" -- "$rf")"
      fi
      rm -rf -- "$rf"
      if [[ "$res" == *'"ok":true'* ]]; then
        info "Utilizador $email ($papel) criado/atualizado no painel. Pode entrar em https://$(ler_host)/painel/"
        return 0
      fi
      if [[ "$res" =~ $re_erro ]]; then erro "o painel recusou o pedido: ${BASH_REMATCH[1]}"; fi
      erro "o painel recusou o pedido"
    fi
    sleep 0.5
  done
  info "O painel ainda não respondeu (está a correr? docker compose ps painel)."
  info "O pedido fica à espera e é aplicado quando o painel arrancar (é apagado ao fim de 1 hora)."
}

# config.js do site com o mqttUrl deste servidor (wss://DOMUS_HOST/mqtt). O
# Caddy serve config-site/config.js no lugar do ../web/config.js, que fica
# intacto no git (editá-lo no VPS impede o "instalar.sh --atualizar" de
# atualizar o código). Corra de novo depois de mudar o DOMUS_HOST ou de
# atualizar o código.
cmd_config_site() {
  (( $# == 0 )) || erro "uso: ./domus.sh config-site"
  local host orig="../web/config.js" dir="config-site" dest tmp
  dest="$dir/config.js"
  host="$(ler_host)"
  [[ "$host" != O-SEU-SERVIDOR ]] || erro "falta DOMUS_HOST no .env"
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || erro "DOMUS_HOST inválido: '$host' (só letras, dígitos, '.' e '-')"
  [[ -f "$orig" ]] || erro "não encontrei $orig (a pasta servidor/ tem de ficar ao lado de web/)"
  grep -qF 'wss://SEU-SERVIDOR/mqtt' "$orig" \
    || aviso "$orig não tem 'wss://SEU-SERVIDOR/mqtt' (foi editado?): o mqttUrl fica como está"
  if [[ "$MODO" == simulacao ]]; then
    simul "$orig -> $dest (mqttUrl: wss://$host/mqtt)"
    return 0
  fi
  [[ ! -L "$dir" ]] || erro "$dir é um symlink: recusado"
  mkdir -p "$dir"
  chmod 755 "$dir"
  tmp="$(mktemp "$dir/.config.js.XXXXXX")"
  sed "s#wss://SEU-SERVIDOR/mqtt#wss://$host/mqtt#" "$orig" > "$tmp"
  chmod 644 "$tmp"                      # o Caddy (contentor) só lê
  mv -f -T -- "$tmp" "$dest"
  info "$PWD/$dest gerado (mqttUrl: wss://$host/mqtt)."
}

# Evita duas execuções em simultâneo. [segundos de espera; por omissão 15 s,
# porque o temporizador dos pedidos (a cada 5 s) segura o cadeado por instantes]
bloquear() {
  preparar_dados
  if command -v flock >/dev/null; then
    exec 9> "$DADOS_DIR/.lock"
    flock -w "${1:-15}" 9 || erro "outra execução do domus.sh está em curso"
  fi
}

main() {
  local cmd="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    admin)            bloquear; cmd_admin "$@" ;;
    motor)            bloquear; cmd_motor "$@" ;;
    pagamentos)       bloquear; cmd_pagamentos "$@" ;;
    plano)            bloquear; cmd_plano "$@" ;;
    sincronizar-planos) bloquear 50; cmd_sincronizar_planos "$@" ;;
    painel-mqtt)      bloquear; cmd_painel_mqtt "$@" ;;
    processar-pedidos)
      # A cada 5 s: sem pedidos sai logo, sem cadeado nem chmod/chown em dados/.
      if (( $# == 0 )) && ! ha_pedidos; then exit 0; fi
      bloquear 50; cmd_processar_pedidos "$@" ;;
    config-site)      cmd_config_site "$@" ;;
    painel-utilizador) cmd_painel_utilizador "$@" ;;
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
