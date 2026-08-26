[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location $projectDirectory

if (-not (Test-Path -LiteralPath '.env')) { throw 'Missing .env. Copy .env.example and configure it first.' }
if (Select-String -LiteralPath '.env' -Pattern '^[A-Z0-9_]+=CHANGE_ME' -Quiet) { throw 'Replace all CHANGE_ME values in .env before deploying.' }

& docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration validation failed.' }
& docker compose build --pull
if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
& docker compose up --detach --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'Container update failed.' }
& docker compose ps
Write-Host "Updated containers are running. Use 'docker compose logs --follow' if a service needs attention."
