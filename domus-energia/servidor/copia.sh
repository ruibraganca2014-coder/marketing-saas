#!/usr/bin/env bash
# =============================================================================
# copia.sh — cópia de segurança do servidor Domus Energia, verificada.
#
# Guarda dados/, mosquitto/seguranca, .env e config-site num ficheiro
# /root/domus-copias/domus-copia-AAAAMMDD-HHMMSS.tar.gz, confirma que o ficheiro
# se lê e que a base de dados do painel lá dentro está inteira, e fica com as
# últimas 30. O resultado da última fica em /root/domus-copias/ultima.txt
# ("OK ..." ou "FALHOU ...").
#
# Corre todas as noites pelo domus-copia.timer (instalado pelo instalar.sh).
# À mão:  sudo bash copia.sh
#
# Não toca nas cópias feitas à mão (/root/domus-backup-*.tar.gz) nem em mais
# nada: só apaga cópias automáticas antigas, as "domus-copia-*" desta pasta.
# Repor uma cópia: ver README.md, "Cópias de segurança".
# =============================================================================
set -euo pipefail

SERV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="${DOMUS_COPIAS:-/root/domus-copias}"
MANTER="${DOMUS_COPIAS_MANTER:-30}"
ESTADO="$DESTINO/ultima.txt"
ESTADO_PAINEL="$SERV/dados/painel/copia.txt"   # a mesma linha, onde o painel a lê para avisar o CEO no Início
AGORA="$(date -u +%Y%m%d-%H%M%S)"
FICHEIRO="$DESTINO/domus-copia-$AGORA.tar.gz"
PARCIAL="$FICHEIRO.parcial"
TMP=""

limpar() { rm -f "$PARCIAL"; [[ -z "$TMP" ]] || rm -rf "$TMP"; }
para_o_painel() { { cp "$ESTADO" "$ESTADO_PAINEL" && chmod 644 "$ESTADO_PAINEL"; } 2>/dev/null || true; }
trap limpar EXIT

falhar() {
  printf 'FALHOU %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" > "$ESTADO" 2>/dev/null || true
  para_o_painel
  printf 'cópia de segurança FALHOU: %s\n' "$*" >&2
  exit 1
}

[[ "$MANTER" =~ ^[0-9]+$ && "$MANTER" -ge 1 ]] || MANTER=30
mkdir -p "$DESTINO" && chmod 700 "$DESTINO" || { printf 'cópia de segurança FALHOU: não foi possível criar %s\n' "$DESTINO" >&2; exit 1; }
cd "$SERV" || falhar "não existe $SERV"
[[ -d dados && -f .env ]] || falhar "não há dados/ nem .env em $SERV"

# 1. O ficheiro. O tar devolve 1 quando um ficheiro muda enquanto é lido (o painel está a trabalhar): não é erro.
partes=(dados .env)
for p in mosquitto/seguranca config-site; do [[ -e "$p" ]] && partes+=("$p"); done
rc=0
( umask 077; tar czf "$PARCIAL" "${partes[@]}" ) 2>/dev/null || rc=$?
(( rc <= 1 )) || falhar "o tar terminou com o código $rc"

# 2. Lê-se até ao fim e tem a base de dados do painel?
gzip -t "$PARCIAL" 2>/dev/null || falhar "o ficheiro ficou estragado (gzip)"
tar -tzf "$PARCIAL" > /dev/null 2>&1 || falhar "o ficheiro ficou estragado (tar)"
# (Sem "tar | grep -q": com pipefail, o grep sai ao primeiro acerto, o tar morre a meio e o teste falhava numa cópia boa.)
tar -tzf "$PARCIAL" dados/painel/painel.db > /dev/null 2>&1 || falhar "a base de dados do painel não está na cópia"

# 3. A base de dados que ficou na cópia está inteira? Abre-se uma cópia dela (nunca a verdadeira) com o node da imagem
#    do painel, sem rede, e pede-se a verificação do SQLite.
TMP="$(mktemp -d "$DESTINO/.verificar.XXXXXX")"
tar -xzf "$PARCIAL" -C "$TMP" --wildcards 'dados/painel/painel.db*' 2>/dev/null || falhar "não foi possível tirar a base de dados da cópia"
imagem="$(docker inspect -f '{{.Config.Image}}' "$(docker compose ps -q painel 2>/dev/null | head -n 1)" 2>/dev/null || true)"
[[ -n "$imagem" ]] || falhar "o painel não está a correr: não foi possível verificar a base de dados"
resultado="$(docker run --rm --network none --user 0 -v "$TMP/dados/painel:/v" --entrypoint node "$imagem" --no-warnings -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync("/v/painel.db");
  const r = db.prepare("PRAGMA integrity_check").all().map((x) => Object.values(x)[0]).join(";");
  const n = db.prepare("SELECT COUNT(*) AS n FROM orcamentos").get().n;
  console.log(r === "ok" ? "ok " + n : "erro " + r);
' 2>&1 | tail -n 1 || true)"
[[ "$resultado" == ok\ * ]] || falhar "a base de dados na cópia não passou a verificação (${resultado:-sem resposta})"

# 4. Fica guardada; saem as automáticas mais antigas.
chmod 600 "$PARCIAL"
mv "$PARCIAL" "$FICHEIRO"
ls -1t "$DESTINO"/domus-copia-*.tar.gz 2>/dev/null | tail -n "+$((MANTER + 1))" | while IFS= read -r velha; do rm -f -- "$velha"; done
quantas="$(ls -1 "$DESTINO"/domus-copia-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
tamanho="$(du -h "$FICHEIRO" | cut -f1)"
printf 'OK %s %s (%s; %s pedidos na base de dados; %s cópias guardadas)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FICHEIRO" "$tamanho" "${resultado#ok }" "$quantas" > "$ESTADO"
para_o_painel
printf 'cópia de segurança feita e verificada: %s (%s)\n' "$FICHEIRO" "$tamanho"
