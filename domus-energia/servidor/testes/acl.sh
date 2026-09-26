#!/usr/bin/env bash
# =============================================================================
# testes/acl.sh — testa as permissões (ACL) num Mosquitto REAL, sem Docker.
#
# Precisa de: mosquitto, mosquitto_pub, mosquitto_sub, python3
#   (Debian/Ubuntu: sudo apt-get install -y mosquitto mosquitto-clients)
#
# Arranca um Mosquitto temporário numa porta alta, cria o estado com o próprio
# domus.sh (DOMUS_LOCAL=1: passwd e acl gerados de verdade) e verifica:
#   - anónimos e palavras-passe erradas são recusados;
#   - o cliente lê só a sua árvore e escreve só nos tópicos permitidos;
#   - o cliente NÃO escreve nos tópicos reservados (_aparelhos, _alarme, ...)
#     nem na árvore de outro cliente;
#   - o aparelho fica limitado ao seu prefixo;
#   - motor e admin escrevem em tudo de domus/;
#   - remover-aparelho apaga o utilizador.
#
# Uso: ./testes/acl.sh        (sai com 0 se tudo passar)
# =============================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DOMUS="$AQUI/../domus.sh"
MOSQUITTO="${MOSQUITTO:-$(command -v mosquitto || echo /usr/sbin/mosquitto)}"
for b in "$MOSQUITTO" mosquitto_pub mosquitto_sub python3; do
  command -v "$b" >/dev/null || { echo "Falta: $b" >&2; exit 2; }
done

TMP="$(mktemp -d)"
PORTA="${PORTA:-$(( 20000 + RANDOM % 20000 ))}"
PID=""; OBS_PID=""
limpar() {
  [[ -n "$OBS_PID" ]] && kill "$OBS_PID" 2>/dev/null
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$TMP"
}
trap limpar EXIT

# --- Mosquitto temporário (mesmas regras de segurança que mosquitto.conf) ----
( umask 077; : > "$TMP/passwd"; : > "$TMP/acl" )
cat > "$TMP/mosquitto.conf" <<EOF
per_listener_settings false
# corre com o utilizador atual (a pasta temporária é privada)
user $(id -un)
allow_anonymous false
password_file $TMP/passwd
acl_file $TMP/acl
persistence false
listener $PORTA 127.0.0.1
log_dest file $TMP/mosquitto.log
log_type all
EOF
"$MOSQUITTO" -c "$TMP/mosquitto.conf" &
PID=$!
sleep 0.5
kill -0 "$PID" 2>/dev/null || { echo "O Mosquitto não arrancou"; exit 2; }

export DOMUS_LOCAL=1 DOMUS_DADOS="$TMP/dados" DOMUS_MOSQ_DIR="$TMP" DOMUS_PORTA="$PORTA" \
       DOMUS_RECARREGAR="kill -HUP $PID" DOMUS_HOST=teste.local DOMUS_ENV=/dev/null

d() { "$DOMUS" "$@" >> "$TMP/domus.log" 2>&1 || { echo "domus.sh $* falhou:"; tail -5 "$TMP/domus.log"; exit 2; }; }

P_ADMIN=admin-senha-1; P_MOTOR=motor-senha-1; P_JOAO=joao-senha-1; P_MARIA=maria-senha-1
P_SALA=sala-senha-1; P_LUZ=luz-senha-1; P_QUADRO=quadro-senha-1
d admin "$P_ADMIN"
d motor "$P_MOTOR"
d cliente joao "$P_JOAO"
d cliente maria "$P_MARIA"
d aparelho joao sala openbeken 'Sala "grande"' --canais "1:interruptor:Teto,2:interruptor,3:luz" --medidor "$P_SALA"
d aparelho joao luz shelly 'Luzes' --canais "1:interruptor,2:interruptor" "$P_LUZ"
d aparelho maria quadro shelly 'Quadro' --medidor "$P_QUADRO"

senha_de() {
  case "$1" in
    admin) echo "$P_ADMIN" ;; motor) echo "$P_MOTOR" ;; joao) echo "$P_JOAO" ;; maria) echo "$P_MARIA" ;;
    joao-sala) echo "$P_SALA" ;; joao-luz) echo "$P_LUZ" ;; maria-quadro) echo "$P_QUADRO" ;;
  esac
}

OK=0; FALHAS=0
passa() { OK=$((OK + 1)); printf '  ok    %s\n' "$*"; }
falha() { FALHAS=$((FALHAS + 1)); printf '  FALHA %s\n' "$*"; }

# --- Ligação ----------------------------------------------------------------
echo "Ligação:"
if mosquitto_sub -h 127.0.0.1 -p "$PORTA" -t 'domus/#' -C 1 -W 2 >/dev/null 2>&1; then
  falha "anónimo conseguiu ligar-se"; else passa "anónimo recusado"; fi
if mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P errada123 -t 'domus/#' -C 1 -W 2 >/dev/null 2>&1; then
  falha "palavra-passe errada aceite"; else passa "palavra-passe errada recusada"; fi

# --- Escrita: um observador (motor) vê tudo o que chega ao broker -------------
mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u motor -P "$P_MOTOR" -i observador -t 'domus/#' -t '#' -v \
  > "$TMP/observado" 2>&1 &
OBS_PID=$!
sleep 0.7

declare -a CASOS=()   # "esperado|utilizador|tópico|token"
N=0
publicar() { # <permitido|negado> <utilizador> <tópico>
  N=$((N + 1))
  local tok="tok-$N-$RANDOM"
  mosquitto_pub -h 127.0.0.1 -p "$PORTA" -u "$2" -P "$(senha_de "$2")" -i "teste-$N" -q 1 -t "$3" -m "$tok" \
    >/dev/null 2>&1
  CASOS+=("$1|$2|$3|$tok")
}

# Cliente joao — permitido (v1 + v2 secção 5)
for t in domus/joao/sala/1/set domus/joao/sala/2/set domus/joao/sala/led_dimmer/set \
         domus/joao/luz/rpc domus/joao/luz/command domus/joao/luz/command/switch:0 \
         domus/joao/luz/command/switch:1 domus/joao/_alarme/set domus/joao/_automacoes/set \
         domus/joao/_fcm/registar; do
  publicar permitido joao "$t"
done
# Cliente joao — negado: reservados, estados dos aparelhos, outro cliente, fora de domus/
for t in domus/joao/_aparelhos domus/joao/_alarme domus/joao/_automacoes domus/joao/_historico \
         domus/joao/_eventos domus/joao/_ntfy domus/joao/_fcm domus/joao \
         domus/joao/sala domus/joao/sala/1/get domus/joao/sala/connected domus/joao/sala/power/get \
         domus/joao/sala/led_dimmer/get domus/joao/luz/online domus/joao/luz/status/switch:0 \
         domus/joao/sala/1/set/x domus/joao/luz/command/switch:0/x domus/joao/_alarme/set/x \
         domus/maria/quadro/1/set domus/maria/quadro/command/switch:0 domus/maria/quadro/rpc \
         domus/maria/_alarme/set domus/maria/_automacoes/set domus/maria/_fcm/registar \
         domus/maria/_aparelhos domus/outro/x/1/set outro/topico; do
  publicar negado joao "$t"
done
# Aparelho joao-sala — só o seu prefixo
for t in domus/joao/sala/connected domus/joao/sala/1/get domus/joao/sala/power/get \
         domus/joao/sala/energycounter/get; do
  publicar permitido joao-sala "$t"
done
for t in domus/joao/luz/1/get domus/joao/luz/command/switch:0 domus/joao/_aparelhos domus/joao/_alarme \
         domus/joao/_eventos domus/joao/_historico domus/joao/_alarme/set domus/joao/sala-2/1/get \
         domus/maria/quadro/online domus/joao; do
  publicar negado joao-sala "$t"
done
publicar permitido joao-luz domus/joao/luz/status/switch:1
publicar negado    joao-luz domus/joao/sala/1/set
publicar permitido maria-quadro domus/maria/quadro/status/switch:0
publicar negado    maria-quadro domus/joao/sala/1/set
# motor e admin: tudo em domus/
for t in domus/joao/_alarme domus/joao/_historico domus/joao/_eventos domus/joao/_automacoes \
         domus/maria/_alarme domus/joao/sala/1/set; do
  publicar permitido motor "$t"
done
for t in domus/joao/_aparelhos domus/maria/_ntfy domus/joao/luz/command; do
  publicar permitido admin "$t"
done
publicar negado motor fora/de/domus
publicar negado admin fora/de/domus

sleep 1.5
kill "$OBS_PID" 2>/dev/null; wait "$OBS_PID" 2>/dev/null; OBS_PID=""

echo "Escrita:"
for caso in "${CASOS[@]}"; do
  IFS='|' read -r esperado utilizador topico tok <<< "$caso"
  if grep -qxF "$topico $tok" "$TMP/observado"; then chegou=permitido; else chegou=negado; fi
  # "fora/de/domus": o observador só lê domus/#, confirma-se no registo do broker.
  if [[ "$topico" != domus/* ]]; then
    if grep -q "Denied PUBLISH from teste-.* '$topico'" "$TMP/mosquitto.log"; then chegou=negado; else chegou=permitido; fi
  fi
  if [[ "$chegou" == "$esperado" ]]; then passa "$utilizador escreve $topico: $esperado"
  else falha "$utilizador escreve $topico: esperado $esperado, foi $chegou"; fi
done

# --- Leitura ------------------------------------------------------------------
echo "Leitura:"
ler() { # <utilizador> <filtro> — mensagens retidas visíveis (2 s)
  mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u "$1" -P "$(senha_de "$1")" -t "$2" -v -W 2 2>/dev/null || true
}
# Mensagens retidas de teste, publicadas pelo admin
for t in domus/joao/sala/1/get domus/maria/quadro/online domus/joao/_alarme; do
  mosquitto_pub -h 127.0.0.1 -p "$PORTA" -u admin -P "$P_ADMIN" -r -q 1 -t "$t" -m retida
done
saida="$(ler joao 'domus/joao/#')"
if [[ "$saida" == *"domus/joao/_aparelhos "* && "$saida" == *"domus/joao/sala/1/get retida"* && "$saida" == *"domus/joao/_ntfy "* ]]
then passa "joao lê domus/joao/# (lista, estados, _ntfy)"; else falha "joao não lê a sua árvore: $saida"; fi
saida="$(ler joao 'domus/maria/#')"
if [[ -z "$saida" ]]; then passa "joao não lê domus/maria/#"; else falha "joao leu maria: $saida"; fi
saida="$(ler joao '#')"
if [[ "$saida" == *domus/joao/* && "$saida" != *domus/maria* ]]
then passa "joao subscreve '#' e só recebe o seu"; else falha "joao com '#': $saida"; fi
saida="$(ler joao-sala 'domus/joao/#')"
if [[ "$saida" == *"domus/joao/sala/1/get retida"* && "$saida" != *_aparelhos* && "$saida" != *_alarme* ]]
then passa "joao-sala só lê o seu prefixo"; else falha "joao-sala leu: $saida"; fi
saida="$(ler motor 'domus/#')"
if [[ "$saida" == *domus/maria/quadro/online* && "$saida" == *domus/joao/_alarme* ]]
then passa "motor lê tudo"; else falha "motor leu: $saida"; fi

# --- Conteúdo publicado pelo domus.sh ----------------------------------------------
echo "Conteúdo:"
lista="$(mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -t domus/joao/_aparelhos -C 1 -W 2 2>/dev/null)"
if python3 -c '
import json,sys
l=json.loads(sys.argv[1])
assert [a["id"] for a in l]==["sala","luz"], l
s=l[0]
assert s["nome"]=="Sala \"grande\"" and s["tipo"]=="openbeken" and s["medidor"] is True and s["bateria"] is False
assert s["canais"]==[{"n":1,"funcao":"interruptor","nome":"Teto"},{"n":2,"funcao":"interruptor"},{"n":3,"funcao":"luz"}], s
' "$lista"; then passa "_aparelhos em formato v2: $lista"; else falha "_aparelhos: $lista"; fi
ntfy="$(mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -t domus/joao/_ntfy -C 1 -W 2 2>/dev/null)"
if python3 -c '
import json,sys,re
d=json.loads(sys.argv[1])
assert re.fullmatch(r"https://ntfy\.teste\.local/domus-joao-[a-z0-9]{20}", d["url"]), d
' "$ntfy"; then passa "_ntfy: $ntfy"; else falha "_ntfy: $ntfy"; fi

# --- Remoção ----------------------------------------------------------------------
echo "Remoção:"
# Uma ligação já aberta do aparelho tem de ser cortada (o Mosquitto desliga
# os clientes cujo utilizador desaparece ao recarregar o passwd).
mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao-luz -P "$P_LUZ" -i joao-luz-aberto -t 'domus/joao/luz/#' \
  > /dev/null 2>&1 &
ABERTO=$!
sleep 0.5
d remover-aparelho joao luz
sleep 1
if kill -0 "$ABERTO" 2>/dev/null; then
  kill "$ABERTO" 2>/dev/null
  falha "a ligação aberta de joao-luz continuou ativa depois da remoção"
else
  passa "a ligação aberta de joao-luz foi cortada"
fi
if mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao-luz -P "$P_LUZ" -t 'domus/joao/luz/#' -C 1 -W 2 >/dev/null 2>&1; then
  falha "joao-luz ainda se liga depois de removido"; else passa "joao-luz já não se liga"; fi
lista="$(mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -t domus/joao/_aparelhos -C 1 -W 2 2>/dev/null)"
if [[ "$lista" != *'"id":"luz"'* && "$lista" == *'"id":"sala"'* ]]; then passa "lista sem 'luz'"; else falha "lista: $lista"; fi
if grep -q '^user joao-luz$' "$TMP/acl"; then falha "acl ainda tem joao-luz"; else passa "acl sem joao-luz"; fi

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
