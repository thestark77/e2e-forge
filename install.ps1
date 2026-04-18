# E2E Forge — Cross-platform installer (Windows PowerShell)
# Usage: irm <raw-url>/install.ps1 | iex
#    or: .\install.ps1

$ErrorActionPreference = "Stop"

$SkillName = "e2e-forge"
$SkillDir = Join-Path $env:USERPROFILE ".claude\skills\$SkillName"

Write-Host "=== E2E Forge Installer ===" -ForegroundColor Cyan
Write-Host ""

# 1. Ensure ~/.claude/skills/ exists
$SkillsDir = Join-Path $env:USERPROFILE ".claude\skills"
if (-not (Test-Path $SkillsDir)) {
    New-Item -ItemType Directory -Path $SkillsDir -Force | Out-Null
}

# 2. Check if already installed
if ((Test-Path $SkillDir) -and (Test-Path (Join-Path $SkillDir "SKILL.md"))) {
    Write-Host "[info] e2e-forge already installed at $SkillDir" -ForegroundColor Yellow
    Write-Host "[info] Updating to latest version..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $SkillDir
}

# 3. Copy from local directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillMdPath = Join-Path $ScriptDir "SKILL.md"

if (Test-Path $SkillMdPath) {
    Write-Host "[info] Installing from local directory: $ScriptDir" -ForegroundColor Green
    Copy-Item -Recurse -Path $ScriptDir -Destination $SkillDir
} else {
    Write-Host "[error] SKILL.md not found in $ScriptDir" -ForegroundColor Red
    Write-Host "[info]  Clone the repo first, then run install.ps1 from inside it." -ForegroundColor Yellow
    exit 1
}

# 4. Install script dependencies
Write-Host ""
Write-Host "[info] Installing script dependencies..." -ForegroundColor Green

$ScriptsDir = Join-Path $SkillDir "scripts"
Push-Location $ScriptsDir

try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install 2>$null
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install 2>$null
    } else {
        Write-Host "[warn] No package manager found. Install dependencies manually:" -ForegroundColor Yellow
        Write-Host "       cd $ScriptsDir && npm install" -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}

# 5. Check for tsx
$hasTsx = $false
try {
    tsx --version 2>$null | Out-Null
    $hasTsx = $true
} catch {}

if (-not $hasTsx) {
    Write-Host ""
    Write-Host "[warn] tsx not found globally. Scripts will use npx tsx (slower first run)." -ForegroundColor Yellow
    Write-Host "       For faster execution: npm install -g tsx" -ForegroundColor Yellow
}

# 6. Install TypeScript LSP plugin for Claude Code (project-level)
Write-Host ""
Write-Host "[info] Installing TypeScript LSP plugin for Claude Code..." -ForegroundColor Green

try {
    $claudePath = Get-Command claude -ErrorAction SilentlyContinue
    if ($claudePath) {
        claude plugin add typescript-lsp 2>$null
        Write-Host "[ok] TypeScript LSP plugin installed." -ForegroundColor Green
    } else {
        Write-Host "[warn] Claude Code CLI not found. Install the TypeScript LSP plugin manually:" -ForegroundColor Yellow
        Write-Host "       claude plugin add typescript-lsp" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[warn] Could not install TypeScript LSP plugin. Run manually: claude plugin add typescript-lsp" -ForegroundColor Yellow
}

# 7. Verify installation
Write-Host ""
$skillMdExists = Test-Path (Join-Path $SkillDir "SKILL.md")
$configExists = Test-Path (Join-Path $SkillDir "scripts\config.ts")

if ($skillMdExists -and $configExists) {
    Write-Host "[ok] e2e-forge installed successfully at: $SkillDir" -ForegroundColor Green
} else {
    Write-Host "[error] Installation verification failed." -ForegroundColor Red
    exit 1
}

# 7. Remind about env setup
Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Create a read-only Axiom API token:"
Write-Host "   - Go to app.axiom.co > Settings > API Tokens > New API Token"
Write-Host "   - Name: bemovil2-e2e-extraction-readonly"
Write-Host "   - Permissions: Query on datasets: http-logs, errors, bemovil2-providers, bemovil2-queries, bemovil2-bridge"
Write-Host ""
Write-Host "2. Add the token to your backend .env:"
Write-Host "   AXIOM_QUERY_TOKEN=xaat-your-token-here"
Write-Host ""
Write-Host "3. Install @axiomhq/js in your backend (if not already):"
Write-Host "   cd your-backend && pnpm add -D @axiomhq/js"
Write-Host ""
Write-Host "4. Use the skill in Claude Code:"
Write-Host "   /e2e-forge"
Write-Host ""
Write-Host "==========================" -ForegroundColor Cyan
