# Creates a compressed pg_dump of the local database in ./backups (run via `npm run db:backup`).
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$container = docker compose ps -q postgres
if (-not $container) { throw 'The postgres container is not running. Start it with `npm run docker:up:dev`.' }

New-Item -ItemType Directory -Force backups | Out-Null
$name = "ugo-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"

# Written inside the container and copied out: PowerShell 5.1 pipes would corrupt the binary dump
docker exec $container sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc -f /tmp/$name"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp "${container}:/tmp/$name" "backups/$name"
docker exec $container rm "/tmp/$name"

Write-Host "Backup created: backups/$name"
