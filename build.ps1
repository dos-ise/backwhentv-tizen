$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force dist | Out-Null
docker build -t backwhentv-tizen .
$ErrorActionPreference = "Continue"
docker rm -f backwhentv-tizen-out *>$null
$ErrorActionPreference = "Stop"
docker create --name backwhentv-tizen-out backwhentv-tizen | Out-Null
docker cp backwhentv-tizen-out:/home/bwtv/BackWhenTV.wgt dist/BackWhenTV.wgt
docker rm backwhentv-tizen-out | Out-Null
Write-Host "Built dist/BackWhenTV.wgt"
