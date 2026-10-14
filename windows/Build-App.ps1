$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & npm.cmd run build:exe
    if ($LASTEXITCODE -ne 0) { throw 'Windows 앱 빌드에 실패했습니다.' }
} finally { Pop-Location }
