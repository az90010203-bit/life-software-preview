param([string]$ExtraAllowedHost = '')

$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPreviewPort = 4317
$taskHealthUrl = "http://127.0.0.1:$taskPreviewPort/__preview/health"

try {
    $taskExistingHealth = Invoke-RestMethod -Uri $taskHealthUrl -TimeoutSec 2
    if ($taskExistingHealth.app -eq 'life-platform-preview') {
        Write-Output "Preview already running: http://127.0.0.1:$taskPreviewPort/"
        return
    }
} catch { }

$taskListener = Get-NetTCPConnection -State Listen -LocalPort $taskPreviewPort -ErrorAction SilentlyContinue
if ($taskListener) { throw "Port $taskPreviewPort is occupied by another service." }

$taskViteEntry = Join-Path $taskProjectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $taskViteEntry)) {
    throw 'Dependencies are missing. Run npm ci in the project directory first.'
}
if ($ExtraAllowedHost -and $ExtraAllowedHost -notmatch '^[a-zA-Z0-9.-]+$') {
    throw 'ExtraAllowedHost must be one hostname without a scheme, path, or port.'
}

$taskOutputDirectory = Join-Path $taskProjectRoot 'output\preview'
New-Item -ItemType Directory -Path $taskOutputDirectory -Force | Out-Null
$taskNodePath = (Get-Command node -ErrorAction Stop).Source
$taskPreviousAllowedHost = $env:LIFE_PREVIEW_ALLOWED_HOST
try {
    $env:LIFE_PREVIEW_ALLOWED_HOST = $ExtraAllowedHost
    $taskPreviewProcess = Start-Process -FilePath $taskNodePath `
        -ArgumentList @("`"$taskViteEntry`"", '--host', '127.0.0.1', '--port', "$taskPreviewPort", '--strictPort') `
        -WorkingDirectory $taskProjectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskOutputDirectory 'server.log') `
        -RedirectStandardError (Join-Path $taskOutputDirectory 'server-error.log')
} finally {
    $env:LIFE_PREVIEW_ALLOWED_HOST = $taskPreviousAllowedHost
}
$taskPreviewProcess.Id | Set-Content -LiteralPath (Join-Path $taskOutputDirectory 'server.pid')

for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $taskHealth = Invoke-RestMethod -Uri $taskHealthUrl -TimeoutSec 2
        if ($taskHealth.app -eq 'life-platform-preview') {
            Write-Output "Preview ready: http://127.0.0.1:$taskPreviewPort/"
            return
        }
    } catch { }
    $taskPreviewProcess.Refresh()
    if ($taskPreviewProcess.HasExited) { break }
}
throw "Preview did not become ready. Inspect output/preview/server-error.log."
