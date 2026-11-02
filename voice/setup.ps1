$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "Setting up local Whisper for NeuraOS..." -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python 3.10+ is required. Install Python and make sure 'python' works in PowerShell."
}

$venvPython = Join-Path (Get-Location) ".voice-venv\Scripts\python.exe"

# If the venv exists but pip is corrupted, rebuild only the Whisper venv.
$rebuild = $false
if (Test-Path $venvPython) {
    & $venvPython -c "import pip" 2>$null
    if ($LASTEXITCODE -ne 0) { $rebuild = $true }
}

if (-not (Test-Path $venvPython) -or $rebuild) {
    if (Test-Path ".voice-venv") {
        Write-Host "Existing Whisper environment is damaged. Recreating it..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force ".voice-venv"
    }
    python -m venv .voice-venv
}

$venvPython = Join-Path (Get-Location) ".voice-venv\Scripts\python.exe"
& $venvPython -m ensurepip --upgrade
if ($LASTEXITCODE -ne 0) { throw "Could not bootstrap pip in .voice-venv." }
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not install/upgrade pip in .voice-venv." }
& $venvPython -m pip install --upgrade --force-reinstall -r voice\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Could not install local Whisper dependencies." }

Write-Host ""
Write-Host "Local Whisper is ready." -ForegroundColor Green
Write-Host "Using faster-whisper + PyAV < 19 for compatibility." -ForegroundColor Green
Write-Host "The first transcription downloads/caches the selected Whisper model." -ForegroundColor Yellow
Write-Host "Default model: base.en"
Write-Host "You can set LOCAL_WHISPER_MODEL=tiny.en or small.en in .env if needed."
