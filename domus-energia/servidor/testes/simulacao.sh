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
#     "sincronizar-planos" (ACL dos suspensos, só recarrega quando muda);
#   - painel da empresa (docs/PAINEL-EMPRESA.md §2): "painel-mqtt" (ACL só de
#     leitura), "processar-pedidos" com pedidos válidos (cliente, aparelho,
#     remover-aparelho, plano; resultados 600, feitos/) e maliciosos (injeção
#     de comandos, opções disfarçadas, symlinks, hard links, ficheiros
#     enormes, JSON adulterado, feitos/ trocado, execuções interrompidas) e
#     "painel-utilizador".
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

echo "Painel: utilizador MQTT 'painel' (só leitura):"
deve_passar "painel-mqtt" painel-mqtt painel-senha-1
if grep -qxF painel "$TMP/mosq/utilizadores.simulacao"; then passa "painel: palavra-passe definida"; else falha "painel sem palavra-passe"; fi
if grep -A1 -xF 'user painel' "$acl" | grep -qxF 'topic read domus/#' && [[ "$(grep -A3 -xF 'user painel' "$acl" | grep -c '^topic')" == 1 ]]
then passa "acl: painel só com 'topic read domus/#'"; else falha "acl do painel"; fi
deve_falhar "código de cliente reservado 'painel'" "'painel' é reservado" cliente painel senha-longa-1

echo "Painel: processar-pedidos (pedidos válidos):"
PED="$TMP/dados/pedidos-admin"
mkdir -p "$PED"
pedido() { # <id> <tipo> <dados sem chavetas> [por]
  printf '{"id":"%s","tipo":"%s","dados":{%s},"por":"%s","criado":"2026-09-27T10:00:00Z"}\n' "$1" "$2" "$3" "${4:-ceo@domus.pt}" > "$PED/$1.json"
}
# <descrição> <id> <python: asserções sobre r (resultado)>
resultado_ok() {
  if [[ -f "$PED/$2.resultado.json" && ! -L "$PED/$2.resultado.json" ]] && python3 - "$PED/$2.resultado.json" "$3" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
exec(sys.argv[2])
PY
  then passa "$1"; else falha "$1: $(cat "$PED/$2.resultado.json" 2>/dev/null || echo 'sem resultado')"; fi
}
limpar_resultados() { find "${PED:?}" -maxdepth 1 -name '*.resultado.json' -delete; }
AP='"cliente":"joao","id":"%s","tipo":"%s","nome":"%s","canais":"%s","divisao":"%s","medidor":%s,"geral":false,"bateria":false,"substituir":%s'
# shellcheck disable=SC2059
ap() { printf "$AP" "$@"; }
pedido p-20260927100000-000000a1 cliente '"codigo":"rita"' comercial@domus.pt
pedido p-20260927100001-000000a2 aparelho "$(ap cozinha shelly 'Luz da cozinha' '1:interruptor:Teto:arranque=ultimo' Cozinha true false)" tecnico@domus.pt
pedido p-20260927100002-000000a3 remover-aparelho '"cliente":"joao","id":"muitos"'
pedido p-20260927100003-000000a4 plano '"cliente":"maria","plano":"premium","estado":"teste"'
printf '%s\n' '{"id":"p-20260927100004-000000a5","tipo":"cliente","dados":{"codigo":"rita2"},"por":"x@y.pt","criado":"2026-09-27T10:00:00.123Z"}' > "$PED/p-20260927100004-000000a5.json"
deve_passar "processar-pedidos" processar-pedidos
saida_tem "regista cada pedido" "pedido p-20260927100000-000000a1 de comercial@domus.pt: ok"
resultado_ok "cliente: ok, palavra-passe gerada e cartão de login" p-20260927100000-000000a1 '
import re
assert r["ok"] is True and r["tipo"] == "cliente" and r["cliente"] == "rita", r
assert re.fullmatch(r"[A-Za-z0-9]{20}", r["password"]) and ("Palavra-passe .. " + r["password"]) in r["saida"], r'
if [[ -f "$TMP/dados/clientes/rita.tsv" ]]; then passa "cliente rita criado"; else falha "rita.tsv não existe"; fi
resultado_ok "aparelho: ok, palavra-passe e instruções" p-20260927100001-000000a2 '
assert r["ok"] and r["aparelho"] == "cozinha" and r["password"] in r["saida"] and "MQTT prefix" in r["saida"], r'
if "$DOMUS" json joao | python3 -c 'import json,sys; l={a["id"]:a for a in json.load(sys.stdin)}; assert l["cozinha"]["medidor"] is True and l["cozinha"]["canais"][0]=={"n":1,"funcao":"interruptor","nome":"Teto","arranque":"ultimo","divisao":"Cozinha"}, l["cozinha"]; assert "muitos" not in l'
then passa "aparelho cozinha criado com as opções; muitos removido"; else falha "json joao: $("$DOMUS" json joao)"; fi
resultado_ok "remover-aparelho: ok (sem palavra-passe)" p-20260927100002-000000a3 'assert r["ok"] and r["password"] is None, r'
resultado_ok "plano: ok" p-20260927100003-000000a4 'assert r["ok"] and r["password"] is None and "premium, teste" in r["saida"], r'
if grep -q '"plano":"premium","estado":"teste"' "$TMP/dados/planos/maria.json"; then passa "plano de maria gravado"; else falha "maria.json: $(cat "$TMP/dados/planos/maria.json")"; fi
resultado_ok "criado com milissegundos também é aceite" p-20260927100004-000000a5 'assert r["ok"] and r["cliente"] == "rita2", r'
modos="$(stat -c %a "$PED"/*.resultado.json | sort -u)"
if [[ "$modos" == 600 ]]; then passa "resultados com modo 600"; else falha "modos dos resultados: $modos"; fi
if [[ -f "$PED/feitos/p-20260927100000-000000a1.json" && -f "$PED/feitos/p-20260927100003-000000a4.json" && ! -e "$PED/p-20260927100000-000000a1.json" ]]
then passa "pedidos movidos para feitos/"; else falha "feitos/: $(ls -la "$PED" "$PED/feitos")"; fi
if [[ "$(id -u)" == 0 ]]; then
  if [[ "$(stat -c '%u:%g %a' "$PED")" == "0:1000 1770" && "$(stat -c '%u %a' "$PED/feitos")" == "0 700" && "$(stat -c %u "$PED/p-20260927100000-000000a1.resultado.json")" == 1000 ]]
  then passa "root: fila root:1000 1770, feitos/ do root, resultados do uid 1000"; else falha "donos: $(stat -c '%n %u:%g %a' "$PED" "$PED/feitos" "$PED"/*.resultado.json)"; fi
fi
limpar_resultados
deve_passar "processar-pedidos sem pedidos" processar-pedidos
if [[ ! -s "$TMP/saida" && ! -s "$TMP/erros" ]]; then passa "sem pedidos: não escreve nada"; else falha "sem pedidos: $(cat "$TMP/saida" "$TMP/erros")"; fi

echo "Painel: processar-pedidos (pedidos maliciosos ou estragados são recusados sem executar nada):"
: > "$TMP/mosq/utilizadores.simulacao"
# shellcheck disable=SC2016  # de propósito: texto que NÃO pode ser executado
pedido p-20260927110000-000000b1 aparelho "$(ap injecao shelly 'Sala $(touch '"$TMP"'/pwned) `touch '"$TMP"'/pwned2`; touch '"$TMP"'/pwned3 &' '' '' false false)"
pedido p-20260927110001-000000b2 aparelho "$(ap opcao shelly '--medidor' '' '' false false)"
pedido p-20260927110002-000000b3 aparelho "$(ap opcao2 shelly 'Ok' '--bateria' '' false false)"
pedido p-20260927110003-000000b4 aparelho "$(ap aspas shelly 'Com \"aspas\"' '' '' false false)"
pedido p-20260927110004-000000b5 cliente '"codigo":"joao"'
pedido p-20260927110005-000000b6 cliente '"codigo":"admin"'
pedido p-20260927110006-000000b7 cliente '"codigo":"nova","admin":true'
pedido p-20260927110007-000000b8 plano '"plano":"base","cliente":"joao","estado":"ativo"'
pedido p-20260927110008-000000b9 painel-utilizador '"email":"a@b.pt","papel":"ceo","nome":"","password":"x"'
pedido p-20260927110009-000000ba shell '"cmd":"reboot"'
pedido p-20260927110010-000000bb cliente '"codigo":"../../etc"'
printf '{"id":"p-20260927110011-000000bc","tipo":"cliente","dados":{"codigo":"tab\there"},"por":"x","criado":"2026-09-27T10:00:00Z"}\n' > "$PED/p-20260927110011-000000bc.json"
pedido p-20260927110012-000000bd cliente '"codigo":"outro"'
sed -i 's/"id":"p-20260927110012-000000bd"/"id":"p-20260927110012-000000ff"/' "$PED/p-20260927110012-000000bd.json"
printf '{"id":"p-20260927110013-000000be","tipo":"cliente","dados":{"codigo":"linha"},"por":"x",\n"criado":"2026-09-27T10:00:00Z"}\n' > "$PED/p-20260927110013-000000be.json"
pedido p-20260927110014-000000bf aparelho "$(ap semcliente shelly 'X' '' '' false false | sed 's/"cliente":"joao"/"cliente":"ninguem"/')"
pedido p-20260927110015-000000c0 aparelho "$(ap sala-4g shelly 'Substituir' '' '' false false)"
pedido p-20260927110016-000000c1 plano '"cliente":"joao","plano":"ouro","estado":"ativo"'
printf 'SEGREDO-DO-ROOT\n' > "$TMP/segredo"; chmod 600 "$TMP/segredo"
ln -s "$TMP/segredo" "$PED/p-20260927110017-000000c2.json"
{ printf '{"id":"p-20260927110018-000000c3","tipo":"cliente","dados":{"codigo":"grande"},"por":"'; head -c 20000 /dev/zero | tr '\0' a; printf '","criado":"2026-09-27T10:00:00Z"}\n'; } > "$PED/p-20260927110018-000000c3.json"
mkdir "$PED/p-20260927110019-000000c4.json"
pedido p-20260927110020-000000c5 cliente '"codigo":"duro"'
ln "$PED/p-20260927110020-000000c5.json" "$TMP/ligacao-dura"
pedido p-20260927110021-000000c6 cliente '"codigo":"alvo"'
printf 'NAO-MEXER\n' > "$TMP/alvo"
ln -s "$TMP/alvo" "$PED/p-20260927110021-000000c6.resultado.json"
printf 'lixo' > "$PED/x.json"; printf 'lixo' > "$PED/p-1.json"; printf 'lixo' > "$PED/P-20260927110022-000000c7.json"
d processar-pedidos || true
cp "$TMP/erros" "$TMP/erros-maliciosos"
for f in pwned pwned2 pwned3; do
  if [[ -e "$TMP/$f" ]]; then falha "injeção de comandos pelo nome do aparelho ($f)"; else passa "sem injeção de comandos ($f)"; fi
done
resultado_ok "nome com \$(...), \`...\` e ; é só texto" p-20260927110000-000000b1 'assert r["ok"], r'
# shellcheck disable=SC2016  # de propósito: texto que NÃO pode ser executado
if grep -qF 'Sala $(touch' "$TMP/dados/clientes/joao.tsv"; then passa "o nome ficou gravado tal e qual"; else falha "nome não gravado"; fi
resultado_ok "nome começado por '-' recusado" p-20260927110001-000000b2 'assert not r["ok"] and "começar por" in r["erro"], r'
resultado_ok "canais começados por '-' recusados" p-20260927110002-000000b3 'assert not r["ok"] and "começar por" in r["erro"], r'
resultado_ok "aspas escapadas recusadas" p-20260927110003-000000b4 'assert not r["ok"] and "dados inválidos" in r["erro"], r'
resultado_ok "cliente que já existe: não muda a palavra-passe" p-20260927110004-000000b5 'assert not r["ok"] and "já existe" in r["erro"], r'
if grep -qxF joao "$TMP/mosq/utilizadores.simulacao"; then falha "a palavra-passe do joao foi mudada"; else passa "palavra-passe do joao intacta"; fi
resultado_ok "código reservado recusado pelo domus.sh" p-20260927110005-000000b6 'assert not r["ok"] and "reservado" in r["erro"], r'
resultado_ok "chave a mais recusada" p-20260927110006-000000b7 'assert not r["ok"] and "dados inválidos" in r["erro"], r'
resultado_ok "chaves fora de ordem recusadas" p-20260927110007-000000b8 'assert not r["ok"], r'
resultado_ok "painel-utilizador vindo do painel (p-) recusado" p-20260927110008-000000b9 'assert not r["ok"] and "desconhecido" in r["erro"], r'
resultado_ok "tipo desconhecido recusado" p-20260927110009-000000ba 'assert not r["ok"] and "desconhecido" in r["erro"], r'
resultado_ok "código com ../ recusado" p-20260927110010-000000bb 'assert not r["ok"], r'
resultado_ok "caracteres de controlo recusados" p-20260927110011-000000bc 'assert not r["ok"] and "controlo" in r["erro"], r'
resultado_ok "id diferente do nome do ficheiro recusado" p-20260927110012-000000bd 'assert not r["ok"] and "não corresponde" in r["erro"], r'
resultado_ok "JSON em várias linhas recusado" p-20260927110013-000000be 'assert not r["ok"], r'
resultado_ok "aparelho de cliente inexistente recusado" p-20260927110014-000000bf 'assert not r["ok"] and "não existe" in r["erro"], r'
resultado_ok "aparelho existente sem substituir recusado" p-20260927110015-000000c0 'assert not r["ok"] and "substituir" in r["erro"], r'
resultado_ok "plano desconhecido recusado" p-20260927110016-000000c1 'assert not r["ok"], r'
resultado_ok "symlink recusado" p-20260927110017-000000c2 'assert not r["ok"] and "ficheiro normal" in r["erro"] and "SEGREDO" not in json.dumps(r), r'
if [[ "$(cat "$TMP/segredo")" == SEGREDO-DO-ROOT && ! -e "$PED/feitos/p-20260927110017-000000c2.json" ]]; then passa "o alvo do symlink ficou intacto"; else falha "alvo do symlink"; fi
resultado_ok "ficheiro demasiado grande recusado" p-20260927110018-000000c3 'assert not r["ok"] and "grande" in r["erro"], r'
resultado_ok "pasta com nome de pedido recusada" p-20260927110019-000000c4 'assert not r["ok"], r'
resultado_ok "ligação dura (hard link) recusada" p-20260927110020-000000c5 'assert not r["ok"], r'
if [[ -f "$TMP/ligacao-dura" && ! -e "$TMP/dados/clientes/duro.tsv" ]]; then passa "hard link: nada executado"; else falha "hard link"; fi
resultado_ok "resultado pré-criado como symlink: substituído por um ficheiro" p-20260927110021-000000c6 'assert r["ok"] and r["cliente"] == "alvo", r'
if [[ "$(cat "$TMP/alvo")" == NAO-MEXER ]]; then passa "o alvo do symlink do resultado ficou intacto"; else falha "o resultado foi escrito através do symlink"; fi
if [[ -f "$PED/x.json" && -f "$PED/p-1.json" && -f "$PED/P-20260927110022-000000c7.json" ]]; then passa "ficheiros com outros nomes são ignorados"; else falha "ficheiros com outros nomes"; fi
criados=""
for c in nova outro linha grande; do
  if [[ -e "$TMP/dados/clientes/$c.tsv" ]]; then criados+=" $c"; fi
done
if [[ -z "$criados" ]]; then passa "nenhum pedido recusado criou clientes"; else falha "pedidos recusados criaram:$criados"; fi
if grep -qF "AVISO: pedido p-20260927110001-000000b2 recusado:" "$TMP/erros-maliciosos"; then passa "recusas ficam no registo"; else falha "registo: $(head -3 "$TMP/erros-maliciosos")"; fi
limpar_resultados
find "${PED:?}" -maxdepth 1 \( -name x.json -o -name p-1.json -o -name 'P-2*.json' \) -delete

echo "Painel: processar-pedidos (casos limite da fila):"
# Execução interrompida: o pedido ficou na pasta privada → não é repetido.
mkdir -p "$TMP/dados/.pedidos-em-curso"
printf '%s\n' '{"id":"p-20260927120000-000000d1","tipo":"cliente","dados":{"codigo":"interrompido"},"por":"x","criado":"2026-09-27T10:00:00Z"}' > "$TMP/dados/.pedidos-em-curso/p-20260927120000-000000d1.json"
# painel-utilizador esquecido (> 1 h) é apagado; um recente fica para o painel.
printf '{"id":"u-20260927120001-000000d2","tipo":"painel-utilizador","dados":{"password":"segredo-antigo"}}\n' > "$PED/u-20260927120001-000000d2.json"
touch -d '2 hours ago' "$PED/u-20260927120001-000000d2.json"
printf '{"id":"u-20260927120002-000000d3"}\n' > "$PED/u-20260927120002-000000d3.json"
d processar-pedidos || true
resultado_ok "execução interrompida: não repetida, com erro" p-20260927120000-000000d1 'assert not r["ok"] and "interrompida" in r["erro"], r'
if [[ ! -e "$TMP/dados/clientes/interrompido.tsv" ]]; then passa "interrompido: não executado de novo"; else falha "interrompido executado"; fi
resultado_ok "painel-utilizador esquecido: apagado" u-20260927120001-000000d2 'assert not r["ok"] and "1 hora" in r["erro"], r'
if [[ ! -e "$PED/u-20260927120001-000000d2.json" ]] && ! grep -rqF segredo-antigo "$PED" "$TMP/dados/.pedidos-em-curso"; then passa "palavra-passe do pedido esquecido apagada"; else falha "pedido esquecido ainda existe"; fi
if [[ -f "$PED/u-20260927120002-000000d3.json" && ! -e "$PED/u-20260927120002-000000d3.resultado.json" ]]; then passa "painel-utilizador recente fica para o painel"; else falha "u- recente"; fi
limpar_resultados
find "${PED:?}" -maxdepth 1 -name 'u-*' -delete
# feitos/ trocado por um symlink: recusa tudo.
mv "$PED/feitos" "$TMP/feitos-velho"
ln -s "$TMP/fora" "$PED/feitos"
pedido p-20260927120003-000000d4 cliente '"codigo":"viasymlink"'
deve_falhar "feitos/ como symlink: recusado" "é um symlink" processar-pedidos
if [[ ! -e "$TMP/dados/clientes/viasymlink.tsv" && ! -e "$TMP/fora" ]]; then passa "feitos/ symlink: nada executado nem movido"; else falha "feitos/ symlink"; fi
unlink "$PED/feitos"; unlink "$PED/p-20260927120003-000000d4.json"; mv "$TMP/feitos-velho" "$PED/feitos"
deve_falhar "processar-pedidos com argumentos" "uso: ./domus.sh processar-pedidos" processar-pedidos x

echo "Painel: painel-utilizador (escreve o pedido para o painel aplicar):"
if printf 'senha-do-painel-1\n' | DOMUS_ESPERA_PAINEL=0 "$DOMUS" painel-utilizador ceo@domus.pt ceo "Dona da Empresa" > "$TMP/saida" 2> "$TMP/erros"; then
  f="$(find "$PED" -maxdepth 1 -name 'u-*.json' | head -1)"
  if [[ -n "$f" ]] && [[ "$(stat -c %a "$f")" == 600 ]] && python3 - "$f" <<'PY'
import json, sys, re, os
d = json.loads(open(sys.argv[1]).read())
assert list(d) == ["id", "tipo", "dados", "por", "criado"], d
assert d["id"] == os.path.basename(sys.argv[1])[:-5] and re.fullmatch(r"u-\d{14}-[0-9a-f]{8}", d["id"])
assert d["tipo"] == "painel-utilizador" and d["por"] == "domus.sh"
assert d["dados"] == {"email": "ceo@domus.pt", "papel": "ceo", "nome": "Dona da Empresa", "password": "senha-do-painel-1"}, d
PY
  then passa "pedido painel-utilizador (modo 600, JSON exato)"; else falha "pedido painel-utilizador: $(cat "$f" 2>/dev/null)"; fi
  saida_tem "avisa que o painel ainda não respondeu" "O painel ainda não respondeu"
else falha "painel-utilizador: $(cat "$TMP/erros")"; fi
find "${PED:?}" -maxdepth 1 -name 'u-*' -delete
if printf 'curta\n' | "$DOMUS" painel-utilizador a@b.pt ceo > "$TMP/saida" 2> "$TMP/erros"; then falha "palavra-passe curta aceite"
elif grep -qF "pelo menos 10 caracteres" "$TMP/erros" && [[ -z "$(find "$PED" -maxdepth 1 -name 'u-*')" ]]; then passa "painel-utilizador: palavra-passe curta recusada"; else falha "curta: $(cat "$TMP/erros")"; fi
deve_falhar "painel-utilizador: email inválido" "email inválido" painel-utilizador 'a@b' ceo
deve_falhar "painel-utilizador: papel inválido" "papel inválido" painel-utilizador a@b.pt admin
deve_falhar "painel-utilizador: sem papel" "uso: ./domus.sh painel-utilizador" painel-utilizador a@b.pt

echo
echo "Resultado: $OK ok, $FALHAS falhas"
(( FALHAS == 0 ))
