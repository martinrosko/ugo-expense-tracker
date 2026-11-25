# Restores a dump from ./backups into the local database, replacing its data.
# Usage: npm run db:restore [-- <file>] [-Force]   (defaults to the newest backup)
# -Prod restores into the production stack's app database and only touches its public schema,
# so a dump of the local database can be loaded without the local Keycloak tables.
param(
  [string]$File,
  [switch]$Force,
  [switch]$Prod
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not $File) {
  $latest = Get-ChildItem backups -Filter *.dump -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'No backups found in ./backups' }
  $File = $latest.FullName
}
if (-not (Test-Path $File)) { throw "File not found: $File" }

$compose = if ($Prod) { @('-f', 'docker-compose.prod.yml', '--env-file', '.env.prod') } else { @() }
$container = docker compose @compose ps -q postgres
if (-not $container) { throw 'The postgres container is not running. Start it with `npm run docker:up:dev` (or `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres`).' }

if (-not $Force) {
  $answer = Read-Host "Replace the current database contents with $File? (y/N)"
  if ($answer -notmatch '^[yY]') { Write-Host 'Cancelled.'; return }
}

$schema = if ($Prod) { '--schema=public' } else { '' }
docker cp $File "${container}:/tmp/restore.dump"
docker exec $container sh -c "pg_restore -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --clean --if-exists --no-owner $schema /tmp/restore.dump"
$code = $LASTEXITCODE
docker exec $container rm /tmp/restore.dump
# pg_restore exits non-zero on harmless warnings too, so only report it
if ($code -ne 0) { Write-Warning "pg_restore finished with exit code $code; check the output above." }
else { Write-Host 'Restore completed.' }
