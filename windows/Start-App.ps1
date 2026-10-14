$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
Push-Location $appRoot
try {
    $null = Get-Command node -ErrorAction Stop
    $null = Get-Command npm.cmd -ErrorAction Stop
    & node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 이상이 필요합니다."); process.exit(1); }'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 이상을 설치해 주세요.' }
    if (-not (Test-Path 'node_modules/electron')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '의존성을 설치하지 못했습니다.' }
    }
    & npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw '초기 설정에 실패했습니다.' }
    & npm.cmd run desktop
    if ($LASTEXITCODE -ne 0) { throw '앱을 시작하지 못했습니다.' }
} finally { Pop-Location }
