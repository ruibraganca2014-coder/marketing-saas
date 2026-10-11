# Traz as cópias de segurança automáticas do servidor para este computador (decisão do dono, 2026-10-11).
# As cópias da noite ficam no próprio servidor (/root/domus-copias): se o servidor se perder, perdem-se com ele.
# Este comando copia-as para uma pasta deste computador e confirma que a mais recente se consegue abrir.
#
#   powershell -ExecutionPolicy Bypass -File domus-energia\servidor\trazer-copias.ps1
#
# Só lê do servidor: não apaga nem altera nada lá. Cá, só acrescenta ficheiros; nunca apaga os que já tem.
# ATENÇÃO: cada cópia tem dados de clientes e as palavras-passe do servidor. A pasta de destino não deve estar numa
# pasta partilhada, nem dentro deste repositório, nem sincronizada com uma nuvem que não controle.
param(
  [string]$Destino = (Join-Path $HOME 'Documents\Domus-copias'),
  [string]$Servidor = 'root@193.160.119.38',
  [string]$Chave = (Join-Path $HOME '.ssh\domus_opancas_ed25519')
)
# (Sem 'Stop': no PowerShell 5.1 qualquer linha que o ssh, o scp ou o tar escrevam no canal de erros parava o script.)
$ErrorActionPreference = 'Continue'
# O tar do Windows (o do Git não percebe caminhos com "C:").
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tar)) { Write-Host "FALHOU: este Windows não tem o tar ($tar)"; exit 1 }

if (-not (Test-Path $Chave)) { Write-Host "FALHOU: não encontro a chave $Chave"; exit 1 }
New-Item -ItemType Directory -Force $Destino | Out-Null

Write-Host "A ver o que há no servidor..."
$noServidor = & ssh -o BatchMode=yes -o ConnectTimeout=20 -i $Chave $Servidor 'ls -1 /root/domus-copias/domus-copia-*.tar.gz 2>/dev/null; echo ---; cat /root/domus-copias/ultima.txt 2>/dev/null'
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: não consegui ligar ao servidor (VPN desligada? internet?)"; exit 1 }
$corte = [array]::IndexOf($noServidor, '---')
$ficheiros = @($noServidor | Select-Object -First ([Math]::Max($corte, 0)) | Where-Object { $_ -match '^/root/domus-copias/domus-copia-[0-9]{8}-[0-9]{6}\.tar\.gz$' })
$ultima = ($noServidor | Select-Object -Skip ($corte + 1) | Select-Object -First 1)
if (-not $ficheiros.Count) { Write-Host "FALHOU: o servidor não tem cópias automáticas em /root/domus-copias"; exit 1 }
Write-Host "Última cópia no servidor: $ultima"

$novas = 0
foreach ($f in $ficheiros) {
  $nome = Split-Path $f -Leaf
  $ca = Join-Path $Destino $nome
  if (Test-Path $ca) { continue }
  $parcial = "$ca.parcial"
  & scp -q -o BatchMode=yes -o ConnectTimeout=20 -i $Chave "${Servidor}:$f" $parcial
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $parcial)) {
    if (Test-Path $parcial) { Remove-Item $parcial -Confirm:$false }
    Write-Host "FALHOU: não consegui trazer $nome"; exit 1
  }
  # Só fica guardada se se conseguir abrir (uma cópia cortada a meio não serve para nada).
  & $tar -tzf $parcial | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-Item $parcial -Confirm:$false; Write-Host "FALHOU: a cópia $nome chegou estragada (tente de novo)"; exit 1 }
  Move-Item $parcial $ca
  $novas += 1
}

# A mais recente abre-se e tem lá dentro a base de dados do painel?
$recente = Get-ChildItem $Destino -Filter 'domus-copia-*.tar.gz' | Sort-Object Name | Select-Object -Last 1
$lista = & $tar -tzf $recente.FullName
if ($LASTEXITCODE -ne 0 -or -not ($lista -contains 'dados/painel/painel.db')) {
  Write-Host "FALHOU: a cópia $($recente.Name) não se consegue abrir ou não tem a base de dados"; exit 1
}
$total = (Get-ChildItem $Destino -Filter 'domus-copia-*.tar.gz').Count
Write-Host "OK: $novas cópias novas trazidas; $total guardadas em $Destino"
Write-Host "A mais recente: $($recente.Name) ($([Math]::Round($recente.Length / 1KB)) KB), verificada."
