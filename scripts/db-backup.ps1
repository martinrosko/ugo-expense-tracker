# Creates compressed pg_dump files in ./backups (run via `npm run db:backup`).
# -Prod dumps both databases (app and Keycloak) of the production stack instead of the local dev database.
param([switch]$Prod)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$compose = if ($Prod) { @('-f', 'docker-compose.prod.yml', '--env-file', '.env.prod') } else { @() }
$container = docker compose @compose ps -q postgres
if (-not $container) { throw 'The postgres container is not running. Start it with `npm run docker:up:dev` (or `npm run prod:up`).' }

New-Item -ItemType Directory -Force backups | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$targets = if ($Prod) { @(@{ Db = 'ugo'; Name = "prod-ugo-$stamp.dump" }, @{ Db = 'keycloak'; Name = "prod-keycloak-$stamp.dump" }) }
           else { @(@{ Db = '$POSTGRES_DB'; Name = "ugo-$stamp.dump" }) }

foreach ($t in $targets) {
  # Written inside the container and copied out: PowerShell 5.1 pipes would corrupt the binary dump
  docker exec $container sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"$($t.Db)`" -Fc -f /tmp/$($t.Name)"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed for $($t.Name)" }
  docker cp "${container}:/tmp/$($t.Name)" "backups/$($t.Name)"
  docker exec $container rm "/tmp/$($t.Name)"
  Write-Host "Backup created: backups/$($t.Name)"
}
