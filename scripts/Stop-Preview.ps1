$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPidFile = Join-Path $taskProjectRoot 'output\preview\server.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) {
    Write-Output 'No tracked preview process.'
    return
}

$taskPreviewPid = [int](Get-Content -LiteralPath $taskPidFile -Raw)
$taskProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPreviewPid" -ErrorAction SilentlyContinue
if ($taskProcessInfo) {
    $taskExpectedEntry = Join-Path $taskProjectRoot 'node_modules\vite\bin\vite.js'
    if ($taskProcessInfo.Name -ne 'node.exe' -or -not $taskProcessInfo.CommandLine.Contains($taskExpectedEntry)) {
        throw 'The stored PID no longer belongs to this project preview; refusing to stop it.'
    }
    Stop-Process -Id $taskPreviewPid
}
Remove-Item -LiteralPath $taskPidFile
Write-Output 'Preview stopped.'
