param(
    [switch]$NoBrowser,
    [switch]$NoBuild,
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Set-Location -LiteralPath $RepoRoot

$LogFile = Join-Path $RepoRoot "start-job.log"
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$AppUrl = "http://localhost:$Port"

function Write-LauncherLog {
    param([string]$Message, [string]$Color = "White")
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$timestamp] $Message"
    try {
        Add-Content -LiteralPath $LogFile -Value $logLine -Encoding utf8 -ErrorAction SilentlyContinue
    } catch {}
    Write-Host $Message -ForegroundColor $Color
}

function Show-LauncherError {
    param([string]$Message)
    Write-LauncherLog "BLAD: $Message" "Red"
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [System.Windows.Forms.MessageBox]::Show($Message, "Job Launcher", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } catch {}
}

Write-LauncherLog "=== Uruchamianie aplikacji Job (Port: $Port) ===" "Cyan"

# 1. Zamknij poprzedni proces na porcie (zwalnianie portu od poczatku)
Write-LauncherLog "Sprawdzanie i zwalnianie portu $Port..." "Cyan"

try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $procId = $conn.OwningProcess
            if ($procId -and $procId -ne 0 -and $procId -ne $PID) {
                Write-LauncherLog "Zamykanie poprzedniego procesu na porcie $Port (PID: $procId)..." "Yellow"
                taskkill.exe /F /T /PID $procId 2>$null | Out-Null
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch {}

# Fallback netstat na wypadek ograniczen Get-NetTCPConnection
try {
    $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
        $netstatPid = [int]$parts[-1]
        if ($netstatPid -and $netstatPid -ne 0 -and $netstatPid -ne $PID) {
            Write-LauncherLog "Zamykanie procesu z netstat na porcie $Port (PID: $netstatPid)..." "Yellow"
            taskkill.exe /F /T /PID $netstatPid 2>$null | Out-Null
            Stop-Process -Id $netstatPid -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}

# Poczekaj na pelne zwolnienie portu
$maxWait = 15
while ($maxWait -gt 0) {
    $stillBusy = $false
    try {
        $connCheck = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($connCheck) { $stillBusy = $true }
    } catch {}
    if (-not $stillBusy) { break }
    Start-Sleep -Milliseconds 200
    $maxWait--
}

# 2. Skompiluj i odswiez wersje aplikacji
if (-not $NoBuild) {
    Write-LauncherLog "Budowanie najnowszej wersji aplikacji (npm run build)..." "Cyan"
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npmCmd) {
        $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source
    }
    if (-not $npmCmd) {
        $npmCmd = "npm.cmd"
    }

    $buildOutput = & $npmCmd run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errDetails = ($buildOutput | Out-String).Trim()
        $errMsg = "Blad podczas budowania aplikacji Job (npm run build).`n`n$errDetails"
        Show-LauncherError $errMsg
        exit $LASTEXITCODE
    }
}

$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    $candidate = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $candidate) {
        $nodeExe = $candidate
    } else {
        $nodeExe = "node.exe"
    }
}

# 3. W tle poczekaj na gotowosc serwera i otworz odswiezona wersje w przegladarce
if (-not $NoBrowser) {
    Write-LauncherLog "Inicjalizacja otwierania przegladarki po uruchomieniu serwera..." "Cyan"
    $browserScript = @"
`$attempts = 0
while (`$attempts -lt 50) {
    Start-Sleep -Milliseconds 250
    try {
        `$resp = Invoke-RestMethod -Uri '$HealthUrl' -TimeoutSec 1 -ErrorAction SilentlyContinue
        if (`$resp -and `$resp.ok -eq `$true) {
            Start-Process '$AppUrl'
            break
        }
    } catch {}
    `$attempts++
}
"@
    $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
    if (-not $psExe) { $psExe = "powershell.exe" }
    Start-Process -FilePath $psExe -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-Command", $browserScript -WindowStyle Hidden
}

# 4. Uruchom odswiezony serwer Job od poczatku (proces glowny)
Write-LauncherLog "Uruchamianie serwera Job na porcie $Port ($AppUrl)..." "Green"
$env:PORT = "$Port"
& $nodeExe --enable-source-maps dist/server/index.js
