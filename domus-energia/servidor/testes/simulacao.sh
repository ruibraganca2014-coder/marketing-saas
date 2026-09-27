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
#   - a ACL gerada (pedidos da v3, nada de "+" no lugar do aparelho);
#   - planos (docs/PROTOCOLO-PLANOS.md): "pagamentos", "plano" (estados,
#     aviso de 15 dias, ficheiro e _plano publicado, erros) e
#     "sincronizar-planos" (ACL dos suspensos, só recarrega quando muda).
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

deve_passar "medidor geral da casa (--medidor --geral)" \
  aparelho joao contador openbeken "Contador geral" --medidor --geral contador-senha-1
saida_tem "medidor geral: instruções de medição" "power"
deve_passar "canal 64 (máximo)" aparelho joao muitos openbeken "Muitos" --canais "64:interruptor" muitos-senha-1

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
assert l["contador"]["medidor"] is True and l["contador"]["geral"] is True, l["contador"]
assert all("geral" not in a for i, a in l.items() if i != "contador"), "geral só no medidor geral"
assert l["termo"]["medidor"] is True
assert l["muitos"]["canais"][0]["n"] == 64
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
deve_falhar "canal 65 (máximo 64, como o motor e as apps)" "número de canal inválido: '65' (1 a 64)" "${A[@]}" --canais "65:interruptor"
deve_falhar "--geral sem --medidor"              "--geral só pode ser usado com --medidor"  "${A[@]}" --geral
deve_falhar "--geral com --bateria"              "--geral não pode ser usado com --bateria" "${A[@]}" --medidor --geral --bateria --canais "1:porta"
if grep -q '^x	' "$TMP/dados/clientes/joao.tsv"; then falha "um aparelho recusado ficou gravado"
else passa "nenhum aparelho recusado ficou gravado"; fi

echo "Palavra-passe do admin sem a pôr na linha de comando:"
if printf 'senha-stdin-123\n' | "$DOMUS" admin > "$TMP/saida" 2> "$TMP/erros" \
   && [[ "$(cat "$TMP/dados/admin.senha")" == senha-stdin-123 ]]; then passa "admin lê a palavra-passe do stdin"
else falha "admin pelo stdin: $(tail -2 "$TMP/erros")"; fi
if "$DOMUS" admin < /dev/null > "$TMP/saida" 2> "$TMP/erros"; then falha "admin sem palavra-passe foi aceite"
elif grep -qF "sem palavra-passe no stdin" "$TMP/erros"; then passa "admin sem palavra-passe (stdin vazio) recusado"
else falha "admin sem palavra-passe: $(tail -2 "$TMP/erros")"; fi
if printf 'curta\n' | "$DOMUS" admin > "$TMP/saida" 2> "$TMP/erros"; then falha "palavra-passe curta aceite"
elif grep -qF "pelo menos 8 caracteres" "$TMP/erros" && [[ "$(cat "$TMP/dados/admin.senha")" == senha-stdin-123 ]]; then passa "palavra-passe curta pelo stdin recusada (nada muda)"
else falha "palavra-passe curta: $(tail -2 "$TMP/erros")"; fi
deve_passar "admin com a palavra-passe no argumento continua a funcionar" admin admin-senha-1

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

echo "Planos e pagamentos:"
deve_passar "utilizador pagamentos" pagamentos pagamentos-senha-1
if grep -qxF pagamentos "$TMP/mosq/utilizadores.simulacao"; then passa "pagamentos: palavra-passe definida"; else falha "pagamentos sem palavra-passe"; fi
if grep -qxF 'user pagamentos' "$acl" && grep -A1 -xF 'user pagamentos' "$acl" | grep -qxF 'topic write domus/+/_plano'
then passa "acl: pagamentos escreve só domus/+/_plano"; else falha "acl do pagamentos"; fi
deve_falhar "código de cliente reservado 'pagamentos'" "'pagamentos' é reservado" cliente pagamentos senha-longa-1
deve_falhar "pagamentos: palavra-passe curta" "pelo menos 8 caracteres" pagamentos curta

PF="$TMP/dados/planos/joao.json"
json_plano_ok() { # <descrição> <python: asserções sobre d (ficheiro) e p (_plano publicado)>
  local publicado
  publicado="$(sed -n 's/^\[simulação\] publicar (retida) domus\/joao\/_plano //p' "$TMP/erros" | tail -1)"
  if python3 - "$PF" "$publicado" "$2" <<'PY'
import json, sys, re
d = json.load(open(sys.argv[1]))
p = json.loads(sys.argv[2])
iso = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")
assert list(p) == ["plano", "estado", "desde", "proximo_pagamento", "aviso_ate", "gerido"], p
assert {k: d[k] for k in p} == p, (d, p)
assert iso.fullmatch(d["desde"]) and iso.fullmatch(d["atualizado"]), d
assert open(sys.argv[1]).read().count("\n") == 1, "uma linha"
exec(sys.argv[3])
PY
  then passa "$1"; else falha "$1: $(cat "$PF") | $publicado"; fi
}
deve_passar "plano joao base (ativo por omissão)" plano joao base
json_plano_ok "ficheiro e _plano: base, ativo, manual" \
  'assert p["plano"]=="base" and p["estado"]=="ativo" and p["gerido"]=="manual" and p["aviso_ate"] is None and p["proximo_pagamento"] is None; assert d["stripe_cliente"] is None and d["teste_usado"] is False'
deve_passar "plano joao conforto --estado teste" plano joao conforto --estado teste
json_plano_ok "teste marca teste_usado" 'assert p["estado"]=="teste" and d["teste_usado"] is True'
deve_passar "plano joao conforto --estado em_atraso" plano joao conforto --estado em_atraso
json_plano_ok "em_atraso: aviso_ate = agora + 15 dias" '
import datetime
a = datetime.datetime.strptime(p["aviso_ate"], "%Y-%m-%dT%H:%M:%SZ")
desde = datetime.datetime.strptime(p["desde"], "%Y-%m-%dT%H:%M:%SZ")
assert p["estado"]=="em_atraso" and (a - desde).days == 15, (a, desde)'
aviso1="$(sed -n 's/.*"aviso_ate":"\([^"]*\)".*/\1/p' "$PF")"
desde1="$(sed -n 's/.*"desde":"\([^"]*\)".*/\1/p' "$PF")"
sleep 1
deve_passar "em_atraso outra vez" plano joao conforto --estado em_atraso
if [[ "$(sed -n 's/.*"aviso_ate":"\([^"]*\)".*/\1/p' "$PF")" == "$aviso1" && "$(sed -n 's/.*"desde":"\([^"]*\)".*/\1/p' "$PF")" == "$desde1" ]]
then passa "em_atraso repetido mantém aviso_ate e desde"; else falha "em_atraso repetido: $(cat "$PF")"; fi
if grep -qxF 'topic read domus/joao/#' "$acl"; then passa "em_atraso ainda tem as permissões todas"; else falha "em_atraso sem permissões"; fi

deve_passar "plano joao conforto --estado suspenso" plano joao conforto --estado=suspenso
json_plano_ok "suspenso: sem próximo pagamento, guarda o fim do aviso" "assert p['estado']=='suspenso' and p['proximo_pagamento'] is None and p['aviso_ate']=='$aviso1'"
saida_tem "suspenso: explica o modo básico" "os interruptores e os aparelhos continuam a funcionar"
if grep -qF "docker compose kill -s HUP mosquitto" "$TMP/erros"; then passa "suspenso: recarrega o Mosquitto"; else falha "suspenso: não recarregou"; fi
if grep -qxF 'topic read domus/joao/_plano' "$acl" && ! grep -qxF 'topic read domus/joao/#' "$acl" \
   && ! grep -qE '^topic write domus/joao/' "$acl"
then passa "acl: joao suspenso só lê domus/joao/_plano"; else falha "acl do joao suspenso"; fi
if grep -qxF 'user joao-sala-4g' "$acl" && grep -qxF 'topic readwrite domus/joao/sala-4g/#' "$acl"
then passa "acl: aparelhos do cliente suspenso continuam"; else falha "acl: aparelhos do suspenso"; fi
deve_passar "sincronizar-planos sem alterações" sincronizar-planos
if [[ ! -s "$TMP/saida" ]] && ! grep -qF "HUP" "$TMP/erros"; then passa "sincronizar-planos sem alterações: não recarrega"
else falha "sincronizar-planos sem alterações: $(cat "$TMP/saida" "$TMP/erros")"; fi
deve_passar "aparelho novo com o cliente suspenso" aparelho joao extra shelly "Extra" extra-senha-1
if ! grep -qE '^topic write domus/joao/' "$acl" && grep -qxF 'user joao-extra' "$acl"
then passa "aparelho novo não devolve as permissões ao cliente suspenso"; else falha "aparelho novo e suspensão"; fi

deve_passar "plano joao premium --estado cancelado" plano joao premium --estado cancelado
json_plano_ok "cancelado" 'assert p["plano"]=="premium" and p["estado"]=="cancelado" and p["aviso_ate"] is None'
if grep -qxF 'topic read domus/joao/_plano' "$acl"; then passa "acl: cancelado = modo básico"; else falha "acl cancelado"; fi
deve_passar "plano joao premium (reativar)" plano joao premium
if grep -qxF 'topic read domus/joao/#' "$acl" && grep -qxF 'topic write domus/joao/_alarme/set' "$acl"
then passa "reativado: permissões completas"; else falha "reativado: acl"; fi
if grep -qE '^topic (write|readwrite) domus/joao/_plano' "$acl"; then falha "o cliente pode escrever _plano"
else passa "acl: o cliente nunca escreve _plano"; fi

echo "Planos vindos do serviço pagamentos (ficheiro):"
printf '%s\n' '{"plano":"base","estado":"suspenso","desde":"2026-10-01T10:00:00Z","proximo_pagamento":null,"aviso_ate":"2026-10-16T10:00:00Z","gerido":"stripe","stripe_cliente":"cus_ABC1","stripe_subscricao":"sub_XYZ9","teste_usado":true,"atualizado":"2026-10-16T10:00:00Z"}' > "$PF"
deve_passar "sincronizar-planos com joao suspenso pelo Stripe" sincronizar-planos
saida_tem "sincronizar-planos: indica quem ficou em modo básico" "Em modo básico: joao"
if grep -qxF 'topic read domus/joao/_plano' "$acl"; then passa "acl regenerada a partir do ficheiro"; else falha "acl não regenerada"; fi
deve_passar "plano joao base (manual, sobre um cliente do Stripe)" plano joao base
json_plano_ok "manual preserva o cliente e a subscrição do Stripe" \
  'assert p["gerido"]=="manual" and d["stripe_cliente"]=="cus_ABC1" and d["stripe_subscricao"]=="sub_XYZ9" and d["teste_usado"] is True'
if grep -qF "sub_XYZ9 no Stripe: a cobrança continua" "$TMP/erros"; then passa "avisa que a subscrição do Stripe continua"; else falha "sem aviso da subscrição Stripe"; fi
deve_passar "plano joao base --gerido stripe" plano joao base --gerido stripe
json_plano_ok "devolve a gestão ao Stripe" 'assert p["gerido"]=="stripe"'
printf '%s\n' '{"plano":"base","estado":"pausado","desde":"2026-10-01T10:00:00Z","gerido":"stripe"}' > "$TMP/dados/planos/maria.json"
deve_passar "sincronizar-planos com um ficheiro inválido e um cliente inexistente" sincronizar-planos
if grep -qF "estado inválido 'pausado'" "$TMP/erros" && grep -qF "o cliente 'maria' não existe" "$TMP/erros"
then passa "sincronizar-planos avisa (e ignora) ficheiros estranhos"; else falha "avisos: $(cat "$TMP/erros")"; fi
rm -f "$TMP/dados/planos/maria.json"
deve_passar "listar mostra o plano" listar
saida_tem "listar: plano do joao" "joao   [plano: base, ativo, stripe]"

echo "Planos: pedidos inválidos (recusados, nada muda):"
antes="$(cat "$PF")"
deve_falhar "plano desconhecido"            "plano inválido: 'ouro'"                  plano joao ouro
deve_falhar "estado desconhecido"           "estado inválido: 'pausado'"              plano joao base --estado pausado
deve_falhar "--gerido desconhecido"         "--gerido inválido: 'outro'"              plano joao base --gerido outro
deve_falhar "cliente inexistente"           "o cliente 'ninguem' não existe"          plano ninguem base
deve_falhar "código inválido"               "código de cliente inválido"              plano 'Joao!' base
deve_falhar "sem plano"                     "uso: ./domus.sh plano"                   plano joao
deve_falhar "opção desconhecida"            "opção desconhecida: --x"                 plano joao base --x
deve_falhar "--estado sem valor"            "--estado precisa de um valor"            plano joao base --estado
deve_passar "cliente maria (sem Stripe)" cliente maria maria-senha-1
deve_falhar "--gerido stripe sem subscrição" "não tem subscrição no Stripe"          plano maria base --gerido stripe
deve_falhar "sincronizar-planos com argumentos" "uso: ./domus.sh sincronizar-planos" sincronizar-planos x
if [[ "$(cat "$PF")" == "$antes" && ! -e "$TMP/dados/planos/maria.json" ]]; then passa "nenhum pedido recusado mudou os planos"
else falha "um pedido recusado mudou os planos"; fi

echo "admin (1.ª vez) cria também motor e pagamentos a partir do .env:"
printf 'MOTOR_MQTT_PASS=motor-senha-env\nPAGAMENTOS_MQTT_PASS=pag-senha-env # comentário\n' > "$TMP/env2"
if DOMUS_DADOS="$TMP/dados2" DOMUS_MOSQ_DIR="$TMP/mosq2" DOMUS_ENV="$TMP/env2" "$DOMUS" admin admin-senha-1 > "$TMP/saida" 2> "$TMP/erros" \
   && [[ -e "$TMP/dados2/.motor" && -e "$TMP/dados2/.pagamentos" ]] \
   && grep -qxF pagamentos "$TMP/mosq2/utilizadores.simulacao" && grep -qxF motor "$TMP/mosq2/utilizadores.simulacao"
then passa "admin criou os utilizadores motor e pagamentos"; else falha "admin sem pagamentos: $(cat "$TMP/saida" "$TMP/erros")"; fi
if DOMUS_DADOS="$TMP/dados3" DOMUS_MOSQ_DIR="$TMP/mosq3" "$DOMUS" admin admin-senha-1 > "$TMP/saida" 2> "$TMP/erros" \
   && grep -qF "falta PAGAMENTOS_MQTT_PASS no .env" "$TMP/erros" && [[ ! -e "$TMP/dados3/.pagamentos" ]]
then passa "sem PAGAMENTOS_MQTT_PASS: admin avisa e continua"; else falha "admin sem PAGAMENTOS_MQTT_PASS: $(cat "$TMP/erros")"; fi

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
