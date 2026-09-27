#!/usr/bin/env bash
# =============================================================================
# testes/simulacao.sh — testa o domus.sh em modo simulação (DOMUS_DRY_RUN=1):
# não precisa de Docker nem de Mosquitto (só bash e python3).
#
# Verifica:
#   - as opções dos canais da v3 (§3): entrada, simular, arranque, carga,
#     divisao e --divisao; o JSON de _aparelhos que daí resulta;
#   - os comandos impressos para os aparelhos (§4): SetStartValue no
#     OpenBeken; Switch.SetConfig / MQTT.SetConfig no Shelly;
#   - que as combinações proibidas são recusadas (e não gravam nada);
#   - a ACL gerada (pedidos da v3, nada de "+" no lugar do aparelho).
#
# Uso: ./testes/simulacao.sh        (sai com 0 se tudo passar)
# =============================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DOMUS="$AQUI/../domus.sh"
command -v python3 >/dev/null || { echo "Falta: python3" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export DOMUS_DRY_RUN=1 DOMUS_DADOS="$TMP/dados" DOMUS_MOSQ_DIR="$TMP/mosq" \
       DOMUS_HOST=teste.local DOMUS_ENV=/dev/null

OK=0; FALHAS=0
passa() { OK=$((OK + 1)); printf '  ok    %s\n' "$*"; }
falha() { FALHAS=$((FALHAS + 1)); printf '  FALHA %s\n' "$*"; }

d() { "$DOMUS" "$@" > "$TMP/saida" 2> "$TMP/erros"; }

# <descrição> <comando...> — tem de correr bem
deve_passar() {
  local desc="$1"; shift
  if d "$@"; then passa "$desc"; else falha "$desc: $(tail -2 "$TMP/erros")"; fi
}
# <descrição> <texto-esperado-no-erro> <comando...> — tem de falhar com esse erro
deve_falhar() {
  local desc="$1" esperado="$2"; shift 2
  if d "$@"; then
    falha "$desc: foi aceite"
  elif grep -qF -- "$esperado" "$TMP/erros"; then
    passa "$desc"
  else
    falha "$desc: erro inesperado: $(tail -2 "$TMP/erros")"
  fi
}
# <descrição> <texto> — a última saída contém o texto
saida_tem() {
  if grep -qF -- "$2" "$TMP/saida"; then passa "$1"; else falha "$1: falta '$2'"; fi
}
saida_nao_tem() {
  if grep -qF -- "$2" "$TMP/saida"; then falha "$1: não devia ter '$2'"; else passa "$1"; fi
}

echo "Preparação:"
deve_passar "admin" admin admin-senha-1
deve_passar "cliente joao" cliente joao joao-senha-1

echo "Opções válidas:"
deve_passar "interruptor 4 teclas na Sala (simular, arranque=ultimo, carga=perigosa, divisão por canal)" \
  aparelho joao sala-4g openbeken "Interruptor sala" --divisao Sala \
  --canais "1:interruptor:Teto:simular:arranque=ultimo,2:interruptor:Candeeiro:arranque=ligado,3:interruptor:Varanda:divisao=Varanda,4:interruptor:Termo:carga=perigosa" \
  sala-senha-1
saida_tem "OpenBeken: SetStartValue 1 -1 (último)" "SetStartValue 1 -1"
saida_tem "OpenBeken: SetStartValue 2 1 (ligado)"  "SetStartValue 2 1"
saida_tem "OpenBeken: SetStartValue 3 0 (desligado por omissão)" "SetStartValue 3 0"
saida_tem "OpenBeken: SetStartValue 4 0 (carga perigosa)" "SetStartValue 4 0"
saida_tem "OpenBeken: botão -> relé local (Button/Relay no mesmo canal)" '"Button" (Btn) e o MESMO número do canal'
saida_tem "OpenBeken: aviso de carga perigosa" "carga perigosa: o OpenBeken"

deve_passar "sensor de porta de entrada a pilhas (entrada + bateria)" \
  aparelho joao porta-entrada openbeken "Porta de entrada" --bateria --divisao Hall \
  --canais "1:porta:Porta entrada:entrada,2:bateria" porta-senha-1
saida_tem "TuyaMCU: estado no canal 1" "linkTuyaMCUOutputToChannel <dpID_porta> bool 1"
saida_tem "TuyaMCU: bateria no canal 2" "linkTuyaMCUOutputToChannel <dpID_bateria> val 2"
saida_tem "TuyaMCU: como descobrir os dpIDs" "loglevel 4"
saida_nao_tem "sensor sem SetStartValue" "SetStartValue"

deve_passar "PIR a pilhas" \
  aparelho joao pir-corredor openbeken "Movimento corredor" --bateria --canais "1:movimento,2:bateria" pir-senha-1
saida_tem "TuyaMCU: movimento no canal 1" "linkTuyaMCUOutputToChannel <dpID_movimento> bool 1"

deve_passar "termoacumulador Shelly (carga perigosa)" \
  aparelho joao termo shelly "Termoacumulador" --medidor --divisao Cozinha \
  --canais "1:interruptor:Termo:carga=perigosa" termo-senha-1
saida_tem "Shelly: auto_off de 4 h e initial_state off" \
  'Switch.SetConfig?id=0&config={"initial_state":"off","in_mode":"follow","auto_off":true,"auto_off_delay":14400}'
saida_tem "Shelly: MQTT.SetConfig" \
  'MQTT.SetConfig?config={"enable":true,"server":"teste.local:1883","client_id":"joao-termo","user":"joao-termo","pass":"termo-senha-1","topic_prefix":"domus/joao/termo","enable_control":true,"rpc_ntf":true,"status_ntf":true}'
saida_tem "Shelly: reiniciar" "rpc/Shelly.Reboot"

deve_passar "luz do jardim com simulação de férias (Shelly, último estado)" \
  aparelho joao jardim shelly "Luz do jardim" --divisao Jardim \
  --canais "1:interruptor:Jardim:simular:arranque=ultimo" jardim-senha-1
saida_tem "Shelly: restore_last sem auto_off" \
  'Switch.SetConfig?id=0&config={"initial_state":"restore_last","in_mode":"follow","auto_off":false}'

deve_passar "--divisao= e nome com aspas" \
  aparelho joao estore shelly 'Estore "quarto"' --divisao='Quarto "grande"' --canais "1:estore" estore-senha-1
deve_passar "listar" listar
saida_tem "listar mostra as opções" "canal 1:interruptor:Teto:simular:arranque=ultimo"

echo "JSON de _aparelhos:"
if d json joao && python3 - "$TMP/saida" <<'EOF'
import json, sys
l = {a["id"]: a for a in json.load(open(sys.argv[1]))}
c = l["sala-4g"]["canais"]
assert c[0] == {"n":1,"funcao":"interruptor","nome":"Teto","simular":True,"arranque":"ultimo","divisao":"Sala"}, c[0]
assert c[1] == {"n":2,"funcao":"interruptor","nome":"Candeeiro","arranque":"ligado","divisao":"Sala"}, c[1]
assert c[2] == {"n":3,"funcao":"interruptor","nome":"Varanda","arranque":"desligado","divisao":"Varanda"}, c[2]
assert c[3] == {"n":4,"funcao":"interruptor","nome":"Termo","arranque":"desligado","carga":"perigosa","divisao":"Sala"}, c[3]
assert l["porta-entrada"]["canais"] == [
    {"n":1,"funcao":"porta","nome":"Porta entrada","entrada":True,"divisao":"Hall"},
    {"n":2,"funcao":"bateria","divisao":"Hall"}], l["porta-entrada"]
assert l["pir-corredor"]["canais"] == [{"n":1,"funcao":"movimento"},{"n":2,"funcao":"bateria"}]
assert l["termo"]["canais"] == [{"n":1,"funcao":"interruptor","nome":"Termo","arranque":"desligado","carga":"perigosa","divisao":"Cozinha"}]
assert l["jardim"]["canais"] == [{"n":1,"funcao":"interruptor","nome":"Jardim","simular":True,"arranque":"ultimo","divisao":"Jardim"}]
assert l["estore"]["nome"] == 'Estore "quarto"'
assert l["estore"]["canais"] == [{"n":1,"funcao":"estore","arranque":"desligado","divisao":'Quarto "grande"'}]
assert all("divisao" not in a for a in l.values()), "divisao só nos canais"
EOF
then passa "JSON com entrada/simular/arranque/carga/divisao (omissões respeitadas)"
else falha "JSON: $(cat "$TMP/saida")"; fi

echo "Compatibilidade com o estado antigo:"
printf 'velho\topenbeken\tVelho\n' >> "$TMP/dados/clientes/joao.tsv"
printf 'v2\tshelly\t1\t0\t1:interruptor:A,2:porta:\tV2\n' >> "$TMP/dados/clientes/joao.tsv"
if d json joao && python3 - "$TMP/saida" <<'EOF'
import json, sys
l = {a["id"]: a for a in json.load(open(sys.argv[1]))}
assert l["velho"]["canais"] == [{"n":1,"funcao":"interruptor","arranque":"desligado"}], l["velho"]
assert l["v2"]["canais"] == [{"n":1,"funcao":"interruptor","nome":"A","arranque":"desligado"},{"n":2,"funcao":"porta"}], l["v2"]
EOF
then passa "linhas v1 e v2 continuam a ler-se (arranque=desligado)"; else falha "compatibilidade: $(cat "$TMP/saida")"; fi

echo "Opções inválidas (têm de ser recusadas):"
A=(aparelho joao x openbeken "X")
deve_falhar "entrada num interruptor"            "'entrada' só é válido em canais 'porta'"  "${A[@]}" --canais "1:interruptor:Luz:entrada"
deve_falhar "simular numa porta"                 "'simular' só é válido"                    "${A[@]}" --canais "1:porta:simular"
deve_falhar "simular num estore"                 "'simular' só é válido"                    "${A[@]}" --canais "1:estore:simular"
deve_falhar "arranque com valor inválido"        "arranque inválido 'sempre'"               "${A[@]}" --canais "1:interruptor:arranque=sempre"
deve_falhar "arranque=ultimo com carga perigosa" "não é permitido com 'carga=perigosa'"     "${A[@]}" --canais "1:interruptor:Termo:carga=perigosa:arranque=ultimo"
deve_falhar "arranque=ultimo num estore"         "só é permitido em 'interruptor' ou 'luz'" "${A[@]}" --canais "1:estore:arranque=ultimo"
deve_falhar "arranque=ligado num estore"         "um estore fica sempre parado"             "${A[@]}" --canais "1:estore:arranque=ligado"
deve_falhar "arranque num sensor"                "'arranque' só se aplica a canais controláveis" "${A[@]}" --canais "1:movimento:arranque=desligado"
deve_falhar "carga num sensor"                   "'carga' só se aplica a canais controláveis"    "${A[@]}" --canais "1:porta:carga=perigosa"
deve_falhar "carga com valor inválido"           "carga inválida 'alta'"                    "${A[@]}" --canais "1:interruptor:carga=alta"
deve_falhar "opção desconhecida"                 "opção desconhecida 'cor'"                 "${A[@]}" --canais "1:luz:cor=azul"
deve_falhar "opção repetida"                     "a opção 'simular' aparece repetida"       "${A[@]}" --canais "1:luz:simular:simular"
deve_falhar "dois nomes no mesmo canal"          "dois nomes ('Teto' e 'Sala')"             "${A[@]}" --canais "1:interruptor:Teto:Sala"
deve_falhar "divisao vazia no canal"             "divisao vazia no canal 1"                 "${A[@]}" --canais "1:interruptor:divisao="
deve_falhar "--divisao vazia"                    "divisao vazia em --divisao"               "${A[@]}" --divisao "  " --canais "1:interruptor"
deve_falhar "--divisao sem valor"                "--divisao precisa de um valor"            "${A[@]}" --divisao
deve_falhar "divisao demasiado longa"            "divisao demasiado longa"                  "${A[@]}" --divisao "$(printf 'a%.0s' {1..41})"
deve_falhar "função inválida"                    "função inválida no canal 1: 'entrada'"   "${A[@]}" --canais "1:entrada"
deve_falhar "canal repetido"                     "o canal 1 aparece repetido"               "${A[@]}" --canais "1:porta,1:bateria"
if grep -q '^x	' "$TMP/dados/clientes/joao.tsv"; then falha "um aparelho recusado ficou gravado"
else passa "nenhum aparelho recusado ficou gravado"; fi

echo "ACL gerada:"
acl="$TMP/mosq/acl"
for linha in "topic write domus/joao/_config/set" "topic write domus/joao/_modo/set" \
             "topic write domus/joao/_cenas/set" "topic write domus/joao/_cenas/executar" \
             "topic write domus/joao/_automacoes/executar" "topic write domus/joao/_presenca/set" \
             "topic write domus/joao/sala-4g/+/set" "topic write domus/joao/termo/command/+"; do
  if grep -qxF "$linha" "$acl"; then passa "acl: $linha"; else falha "acl sem: $linha"; fi
done
if grep -qE '^topic (write|readwrite) domus/joao/\+' "$acl"; then falha "acl do cliente com '+' no lugar do aparelho"
else passa "acl sem '+' no lugar do aparelho"; fi

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
