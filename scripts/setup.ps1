[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location $projectDirectory

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required. Install Docker Desktop, then run this script again.'
}

& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 is required. Update Docker Desktop, then run this script again.'
}

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    throw 'Created .env from .env.example. Set every CHANGE_ME value, then run this script again.'
}

if (Select-String -LiteralPath '.env' -Pattern '^[A-Z0-9_]+=CHANGE_ME' -Quiet) {
    throw 'Your .env still contains CHANGE_ME values. Replace them with strong secrets before deployment.'
}

& docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration validation failed.' }
& docker compose up --build --detach
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not start the application.' }
& docker compose exec backend npm run seed
if ($LASTEXITCODE -ne 0) { throw 'Database seed failed. Review docker compose logs backend.' }
& docker compose ps
Write-Host 'Deployment is running. Open the address configured by APP_ORIGIN after its reverse proxy is ready.'
