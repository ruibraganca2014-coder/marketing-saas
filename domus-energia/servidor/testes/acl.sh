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
#   - o cliente escreve os pedidos da v3 (§10): _config/set, _modo/set,
#     _cenas/set, _cenas/executar, _automacoes/executar, _presenca/set;
#   - o cliente NÃO escreve nos tópicos reservados (_aparelhos, _alarme,
#     _config, _modo, _cenas, _saude, _energia, _presenca, _automacoes/registo,
#     _automacoes/avisos, _automacoes/admin, ...), nem em subtópicos deles que
#     pareçam comandos (_automacoes/admin/set, _eventos/rpc, ...), nem na
#     árvore de outro cliente;
#   - o aparelho fica limitado ao seu prefixo;
#   - motor e admin escrevem em tudo de domus/;
#   - remover-aparelho apaga o utilizador;
#   - planos (docs/PROTOCOLO-PLANOS.md): o utilizador "pagamentos" só escreve
#     domus/+/_plano (e não lê nada); clientes e aparelhos nunca escrevem
#     _plano; um cliente suspenso/cancelado (domus.sh plano ou ficheiro do
#     serviço pagamentos + sincronizar-planos) só lê o seu _plano e não comanda
#     nada, mas os aparelhos dele continuam a funcionar; ao reativar volta tudo.
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
       DOMUS_RECARREGAR="kill -HUP $PID; echo hup >> $TMP/recargas" DOMUS_HOST=teste.local DOMUS_ENV=/dev/null

d() { "$DOMUS" "$@" >> "$TMP/domus.log" 2>&1 || { echo "domus.sh $* falhou:"; tail -5 "$TMP/domus.log"; exit 2; }; }

P_ADMIN=admin-senha-1; P_MOTOR=motor-senha-1; P_JOAO=joao-senha-1; P_MARIA=maria-senha-1
P_SALA=sala-senha-1; P_LUZ=luz-senha-1; P_QUADRO=quadro-senha-1; P_PAG=pagamentos-senha-1
d admin "$P_ADMIN"
d motor "$P_MOTOR"
d pagamentos "$P_PAG"
d cliente joao "$P_JOAO"
d cliente maria "$P_MARIA"
d aparelho joao sala openbeken 'Sala "grande"' --canais "1:interruptor:Teto,2:interruptor,3:luz" --medidor "$P_SALA"
# Opções da v3 (§3): entrada, simular, arranque, carga, divisão (do canal e do aparelho)
d aparelho joao porta openbeken 'Porta' --bateria --divisao 'Hall "A"' \
  --canais '1:porta:Porta entrada:entrada,2:bateria,3:interruptor:Jardim:simular:arranque=ultimo:divisao=Jardim,4:interruptor:Termo:carga=perigosa' porta-senha-1
d aparelho joao luz shelly 'Luzes' --canais "1:interruptor,2:interruptor" "$P_LUZ"
d aparelho maria quadro shelly 'Quadro' --medidor "$P_QUADRO"

senha_de() {
  case "$1" in
    admin) echo "$P_ADMIN" ;; motor) echo "$P_MOTOR" ;; joao) echo "$P_JOAO" ;; maria) echo "$P_MARIA" ;; pagamentos) echo "$P_PAG" ;;
    joao-sala) echo "$P_SALA" ;; joao-porta) echo porta-senha-1 ;; joao-luz) echo "$P_LUZ" ;; maria-quadro) echo "$P_QUADRO" ;;
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
# Cliente joao — permitido (v3 secção 10)
for t in domus/joao/_config/set domus/joao/_modo/set domus/joao/_cenas/set domus/joao/_cenas/executar \
         domus/joao/_automacoes/executar domus/joao/_presenca/set domus/joao/porta/3/set; do
  publicar permitido joao "$t"
done
# Cliente joao — negado (v3 secção 10): tópicos reservados do motor, subtópicos
# deles com cara de comando, aparelhos que não existem e a árvore da maria.
for t in domus/joao/_config domus/joao/_modo domus/joao/_cenas domus/joao/_saude domus/joao/_energia \
         domus/joao/_presenca domus/joao/_automacoes/registo domus/joao/_automacoes/avisos \
         domus/joao/_automacoes/admin domus/joao/_automacoes/admin/set domus/joao/_automacoes/registo/set \
         domus/joao/_config/x/set domus/joao/_modo/set/x domus/joao/_cenas/executar/x \
         domus/joao/_saude/rpc domus/joao/_energia/command domus/joao/_eventos/command/switch:0 \
         domus/joao/_alarme/led_dimmer/set domus/joao/_eventos/rpc domus/joao/naoexiste/1/set \
         domus/joao/naoexiste/command/switch:0 \
         domus/maria/_config/set domus/maria/_modo/set domus/maria/_cenas/set domus/maria/_cenas/executar \
         domus/maria/_automacoes/executar domus/maria/_presenca/set domus/maria/_config domus/maria/_modo; do
  publicar negado joao "$t"
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
         domus/maria/quadro/online domus/joao domus/joao/_config/set domus/joao/_modo/set \
         domus/joao/_config domus/joao/_modo domus/joao/_saude domus/joao/_cenas/executar; do
  publicar negado joao-sala "$t"
done
publicar permitido joao-luz domus/joao/luz/status/switch:1
publicar negado    joao-luz domus/joao/sala/1/set
publicar permitido maria-quadro domus/maria/quadro/status/switch:0
publicar negado    maria-quadro domus/joao/sala/1/set
# motor e admin: tudo em domus/
for t in domus/joao/_alarme domus/joao/_historico domus/joao/_eventos domus/joao/_automacoes \
         domus/maria/_alarme domus/joao/sala/1/set domus/joao/_config domus/joao/_modo domus/joao/_cenas \
         domus/joao/_saude domus/joao/_energia domus/joao/_presenca domus/joao/_automacoes/registo \
         domus/joao/_automacoes/avisos domus/maria/_saude; do
  publicar permitido motor "$t"
done
for t in domus/joao/_aparelhos domus/maria/_ntfy domus/joao/luz/command; do
  publicar permitido admin "$t"
done
publicar negado motor fora/de/domus
publicar negado admin fora/de/domus
# Planos: só o "pagamentos" (e admin/motor) escreve _plano; ele não escreve mais nada.
for t in domus/joao/_plano domus/maria/_plano; do
  publicar permitido pagamentos "$t"
done
for t in domus/joao/_alarme domus/joao/_aparelhos domus/joao/_plano/set domus/joao/sala/_plano \
         domus/joao/sala/1/set domus/joao/_modo/set domus/_plano domus/joao/x/_plano; do
  publicar negado pagamentos "$t"
done
publicar negado pagamentos fora/_plano
for t in domus/joao/_plano domus/joao/_plano/set domus/maria/_plano; do
  publicar negado joao "$t"
done
publicar negado joao-sala    domus/joao/_plano
publicar negado joao-porta   domus/joao/_plano
publicar negado maria-quadro domus/maria/_plano
publicar permitido admin domus/maria/_plano

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
saida="$(ler pagamentos 'domus/#')"
if [[ -z "$saida" ]]; then passa "pagamentos não lê nada"; else falha "pagamentos leu: $saida"; fi

# --- Conteúdo publicado pelo domus.sh ----------------------------------------------
echo "Conteúdo:"
lista="$(mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -t domus/joao/_aparelhos -C 1 -W 2 2>/dev/null)"
if python3 -c '
import json,sys
l=json.loads(sys.argv[1])
assert [a["id"] for a in l]==["sala","porta","luz"], l
s=l[0]
assert s["nome"]=="Sala \"grande\"" and s["tipo"]=="openbeken" and s["medidor"] is True and s["bateria"] is False
assert s["canais"]==[{"n":1,"funcao":"interruptor","nome":"Teto","arranque":"desligado"},
                     {"n":2,"funcao":"interruptor","arranque":"desligado"},
                     {"n":3,"funcao":"luz","arranque":"desligado"}], s
p=l[1]
assert p["bateria"] is True and "divisao" not in p, p
assert p["canais"]==[
  {"n":1,"funcao":"porta","nome":"Porta entrada","entrada":True,"divisao":"Hall \"A\""},
  {"n":2,"funcao":"bateria","divisao":"Hall \"A\""},
  {"n":3,"funcao":"interruptor","nome":"Jardim","simular":True,"arranque":"ultimo","divisao":"Jardim"},
  {"n":4,"funcao":"interruptor","nome":"Termo","arranque":"desligado","carga":"perigosa","divisao":"Hall \"A\""}], p
' "$lista"; then passa "_aparelhos em formato v3 (§3): $lista"; else falha "_aparelhos: $lista"; fi
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
if grep -q '^topic write domus/joao/luz/' "$TMP/acl"; then falha "acl ainda deixa joao comandar 'luz'"
else passa "acl já não deixa joao comandar 'luz'"; fi

# --- Planos: suspensão e reativação (PROTOCOLO-PLANOS §3–§4) --------------------
echo "Planos:"
if grep -qxF 'user pagamentos' "$TMP/acl" && grep -qxF 'topic write domus/+/_plano' "$TMP/acl" \
   && [[ "$(grep -A2 -xF 'user pagamentos' "$TMP/acl" | grep -c '^topic')" == 1 ]]
then passa "acl: pagamentos só com 'topic write domus/+/_plano'"; else falha "acl do pagamentos"; fi

# Casos de escrita num bloco: observador (motor), publicações, e verificação.
observar() {
  CASOS=()
  mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u motor -P "$P_MOTOR" -i "observador-$RANDOM" -t 'domus/#' -v \
    > "$TMP/observado" 2>&1 &
  OBS_PID=$!
  sleep 0.7
}
verificar_escritas() {
  sleep 1.5
  kill "$OBS_PID" 2>/dev/null; wait "$OBS_PID" 2>/dev/null; OBS_PID=""
  local caso esperado utilizador topico tok chegou
  for caso in "${CASOS[@]}"; do
    IFS='|' read -r esperado utilizador topico tok <<< "$caso"
    if grep -qxF "$topico $tok" "$TMP/observado"; then chegou=permitido; else chegou=negado; fi
    if [[ "$chegou" == "$esperado" ]]; then passa "$1: $utilizador escreve $topico: $esperado"
    else falha "$1: $utilizador escreve $topico: esperado $esperado, foi $chegou"; fi
  done
}

# Uma ligação do joao aberta ANTES da suspensão (a app ficou aberta).
mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -i joao-app-aberta -t 'domus/joao/#' -v \
  > "$TMP/joao-aberto" 2>&1 &
ABERTO=$!
sleep 0.5
: > "$TMP/recargas"
d plano joao conforto --estado suspenso
if [[ -s "$TMP/recargas" ]]; then passa "plano suspenso: Mosquitto recarregado"; else falha "plano suspenso: sem recarga"; fi
if grep -qxF 'topic read domus/joao/_plano' "$TMP/acl" && ! grep -qxF 'topic read domus/joao/#' "$TMP/acl"
then passa "acl: joao suspenso só lê domus/joao/_plano"; else falha "acl do joao suspenso"; fi
if grep -qxF 'user joao-sala' "$TMP/acl" && grep -qxF 'topic readwrite domus/joao/sala/#' "$TMP/acl"
then passa "acl: aparelhos do joao mantêm-se"; else falha "acl: aparelhos do joao mudaram"; fi
plano="$(mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao -P "$P_JOAO" -t domus/joao/_plano -C 1 -W 2 2>/dev/null)"
if python3 -c '
import json,sys,re
d=json.loads(sys.argv[1])
assert list(d)==["plano","estado","desde","proximo_pagamento","aviso_ate","gerido"], d
assert d["plano"]=="conforto" and d["estado"]=="suspenso" and d["gerido"]=="manual" and d["proximo_pagamento"] is None, d
assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", d["desde"]), d
' "$plano"; then passa "joao suspenso lê o _plano: $plano"; else falha "_plano do joao suspenso: $plano"; fi
saida="$(ler joao 'domus/joao/#')"
if [[ "$saida" == *"domus/joao/_plano "* && "$saida" != *_aparelhos* && "$saida" != *sala/1/get* && "$saida" != *_ntfy* ]]
then passa "joao suspenso só recebe o _plano"; else falha "joao suspenso leu: $saida"; fi

observar
for t in domus/joao/sala/1/set domus/joao/sala/led_dimmer/set domus/joao/porta/3/set domus/joao/_alarme/set \
         domus/joao/_modo/set domus/joao/_automacoes/set domus/joao/_cenas/executar domus/joao/_config/set \
         domus/joao/_plano; do
  publicar negado joao "$t"
done
publicar permitido joao-sala  domus/joao/sala/1/get       # o aparelho continua a enviar o estado
publicar permitido joao-sala  domus/joao/sala/connected
publicar permitido joao-porta domus/joao/porta/1/get
publicar permitido motor      domus/joao/sala/1/set       # o motor/admin ainda comandam os aparelhos
publicar permitido maria      domus/maria/quadro/1/set    # os outros clientes não são afetados
verificar_escritas "suspenso"

# O aparelho continua a receber comandos (ex. do admin) e a ligar-se.
mosquitto_sub -h 127.0.0.1 -p "$PORTA" -u joao-sala -P "$P_SALA" -i joao-sala-teste -t 'domus/joao/sala/1/set' -C 1 -W 3 \
  > "$TMP/sala-recebeu" 2>/dev/null &
SUB=$!
sleep 0.5
mosquitto_pub -h 127.0.0.1 -p "$PORTA" -u admin -P "$P_ADMIN" -q 1 -t domus/joao/sala/1/set -m 1
wait "$SUB" 2>/dev/null
if [[ "$(cat "$TMP/sala-recebeu")" == 1 ]]; then passa "joao-sala (cliente suspenso) ainda recebe comandos"
else falha "joao-sala não recebeu o comando"; fi

# A ligação aberta antes da suspensão deixa de receber a árvore.
mosquitto_pub -h 127.0.0.1 -p "$PORTA" -u joao-sala -P "$P_SALA" -q 1 -t domus/joao/sala/1/get -m depois-da-suspensao
sleep 0.7
kill "$ABERTO" 2>/dev/null; wait "$ABERTO" 2>/dev/null
if grep -q 'depois-da-suspensao' "$TMP/joao-aberto"; then falha "a app já aberta continuou a receber estados"
else passa "a app já aberta deixou de receber estados (ACL verificada na entrega)"; fi

# Reativar (manual): volta tudo.
d plano joao conforto
if grep -qxF 'topic read domus/joao/#' "$TMP/acl" && grep -qxF 'topic write domus/joao/sala/+/set' "$TMP/acl"
then passa "reativado: acl do joao completa"; else falha "reativado: acl do joao"; fi
observar
publicar permitido joao domus/joao/sala/1/set
publicar permitido joao domus/joao/_alarme/set
publicar negado    joao domus/joao/_plano
verificar_escritas "reativado"

# sincronizar-planos: ficheiro escrito pelo serviço pagamentos (maria cancelada).
printf '%s\n' '{"plano":"base","estado":"cancelado","desde":"2026-10-01T10:00:00Z","proximo_pagamento":null,"aviso_ate":null,"gerido":"stripe","stripe_cliente":"cus_1","stripe_subscricao":"sub_1","teste_usado":true,"atualizado":"2026-10-01T10:00:00Z"}' \
  > "$TMP/dados/planos/maria.json"
: > "$TMP/recargas"
"$DOMUS" sincronizar-planos > "$TMP/sinc" 2>&1 || true
if grep -q 'ACL atualizada' "$TMP/sinc" && grep -q 'modo básico: maria' "$TMP/sinc" && [[ -s "$TMP/recargas" ]]
then passa "sincronizar-planos: maria cancelada → ACL regenerada e recarregada"; else falha "sincronizar-planos: $(cat "$TMP/sinc")"; fi
: > "$TMP/recargas"
"$DOMUS" sincronizar-planos > "$TMP/sinc" 2>&1 || true
if [[ ! -s "$TMP/recargas" && ! -s "$TMP/sinc" ]]; then passa "sincronizar-planos sem alterações: não recarrega nem escreve nada"
else falha "sincronizar-planos sem alterações: $(cat "$TMP/sinc") recargas=$(wc -l < "$TMP/recargas")"; fi
observar
publicar negado    maria        domus/maria/quadro/1/set
publicar negado    maria        domus/maria/_alarme/set
publicar permitido maria-quadro domus/maria/quadro/status/switch:0
verificar_escritas "cancelada"
saida="$(ler maria 'domus/maria/#')"
if [[ "$saida" != *domus/maria/quadro* && "$saida" != *_aparelhos* ]]; then passa "maria cancelada não lê a árvore"
else falha "maria cancelada leu: $saida"; fi
# Um "./domus.sh acl" (ou aparelho novo) mantém a suspensão.
d acl
if grep -qxF 'topic read domus/maria/_plano' "$TMP/acl" && ! grep -qxF 'topic read domus/maria/#' "$TMP/acl"
then passa "./domus.sh acl mantém a maria em modo básico"; else falha "./domus.sh acl perdeu a suspensão"; fi
if [[ "$(cut -d'"' -f4 <<< "$(grep -o '"stripe_cliente":"[^"]*"' "$TMP/dados/planos/maria.json")")" == cus_1 ]]
then passa "ficheiro do serviço pagamentos intacto"; else falha "maria.json alterado"; fi
# Reativada pelo serviço (ficheiro) → sincronizar devolve as permissões.
sed -i 's/"estado":"cancelado"/"estado":"ativo"/' "$TMP/dados/planos/maria.json"
"$DOMUS" sincronizar-planos > "$TMP/sinc" 2>&1 || true
if grep -q 'Em modo básico: nenhum' "$TMP/sinc" && grep -qxF 'topic read domus/maria/#' "$TMP/acl"
then passa "sincronizar-planos: maria reativada"; else falha "maria reativada: $(cat "$TMP/sinc")"; fi

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
