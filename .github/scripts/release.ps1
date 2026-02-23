# Script para automatizar o processo de release e tagging da Action (Versao Windows PowerShell)
# Uso: .\.github\scripts\release.ps1 -Version 1.1.7

param (
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Valida formato X.Y.Z
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "Erro: A versao deve estar no formato X.Y.Z (ex: 1.1.6)" -ForegroundColor Red
    exit 1
}

$Major = $Version.Split('.')[0]
$Minor = $Version.Split('.')[1]
$Patch = $Version.Split('.')[2]

$TagFull = "v$Major.$Minor.$Patch"
$TagMinor = "v$Major.$Minor"
$TagMajor = "v$Major"

Write-Host "Iniciando release da versao $Version..." -ForegroundColor Cyan
Write-Host "Tags a serem criadas/atualizadas:"
Write-Host "  - $TagFull (nova)"
Write-Host "  - $TagMinor (movida para apontar para este commit)"
Write-Host "  - $TagMajor (movida para apontar para este commit)"
Write-Host ""

$Confirm = Read-Host "Confirma? (y/N)"
if ($Confirm -notmatch '^[Yy]$') {
    Write-Host "Cancelado." -ForegroundColor Yellow
    exit 1
}

# Garante que estamos na main atualizada
git checkout main
git pull origin main

# Verifica se a tag ja existe
try {
    $ExistingTag = git rev-parse "$TagFull" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Erro: A tag $TagFull ja existe localmente." -ForegroundColor Red
        exit 1
    }
}
catch {
    # Se der erro, significa que a tag nao existe (o que eh bom)
    $null
}

Write-Host "Criando tag $TagFull..." -ForegroundColor Green
git tag "$TagFull"

# Atualiza (forca) as tags de major e minor
Write-Host "Atualizando tag $TagMinor..." -ForegroundColor Green
git tag -f "$TagMinor"

Write-Host "Atualizando tag $TagMajor..." -ForegroundColor Green
git tag -f "$TagMajor"

# Push
Write-Host "Enviando para o remote..." -ForegroundColor Cyan
git push origin "$TagFull"
git push origin "$TagMinor" --force
git push origin "$TagMajor" --force

Write-Host ""
Write-Host "Sucesso! Release $TagFull publicada." -ForegroundColor Green
Write-Host "Lembre-se de criar a Release no GitHub associada a tag $TagFull."
