[CmdletBinding()]
param([switch]$Dev)

$ErrorActionPreference = 'Stop'
$gesProjectRoot = $PSScriptRoot
$gesPreviousPath = $env:Path
try {
    $gesPy = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($gesPy) {
        $gesPythonJson = (& $gesPy.Source -3.12 -c 'import sys,json; print(json.dumps(sys.executable, ensure_ascii=True))' 2>$null | Select-Object -Last 1)
        if ($LASTEXITCODE -ne 0 -or -not $gesPythonJson) { throw 'Python 3.12 bulunamadi. Python 3.12 kurup yeniden deneyin.' }
        $gesPython = ConvertFrom-Json -InputObject $gesPythonJson
    } else {
        $gesPythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
        if (-not $gesPythonCommand) { throw 'Python 3.12 bulunamadi. Python kurulumunda PATH secenegini etkinlestirin.' }
        $gesPython = $gesPythonCommand.Source
        & $gesPython -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)'
        if ($LASTEXITCODE -ne 0) { throw 'Bu kurulum Python 3.12 gerektirir.' }
    }
    $gesNode = $null
    if ($env:GES_NODE_PATH -and (Test-Path -LiteralPath $env:GES_NODE_PATH -PathType Leaf)) { $gesNode = $env:GES_NODE_PATH }
    if (-not $gesNode) {
        $gesNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($gesNodeCommand) { $gesNode = $gesNodeCommand.Source }
    }
    if (-not $gesNode) {
        $gesBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $gesBundledNode) { $gesNode = $gesBundledNode }
    }
    if (-not $gesNode) { throw 'Node.js 22.12+ kurun. Gerekirse GES_NODE_PATH ile node.exe yolunu belirtin.' }
    & $gesNode -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a===22&&b>=12||a>22?0:1)'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.12+ gerekli.' }
    $env:Path = (Split-Path -Parent $gesNode) + [System.IO.Path]::PathSeparator + $gesPreviousPath
    $gesPnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    $gesNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $gesPnpm -and -not $gesNpm) {
        $gesBundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
        if (Test-Path -LiteralPath $gesBundledPnpm) { $gesPnpm = Get-Item -LiteralPath $gesBundledPnpm }
    }
    if (-not $gesPnpm -and -not $gesNpm) { throw 'Node.js ile npm veya pnpm kurulumu gerekli.' }

    $gesVenvPython = Join-Path $gesProjectRoot '.venv\Scripts\python.exe'
    $gesEnvironmentReady = $false
    if (Test-Path -LiteralPath $gesVenvPython) {
        try {
            & $gesVenvPython -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)' 2>$null
            $gesEnvironmentReady = $LASTEXITCODE -eq 0
        } catch { $gesEnvironmentReady = $false }
    }
    if (-not $gesEnvironmentReady) {
        Write-Output 'Python sanal ortami hazirlaniyor (.venv)...'
        # Existing packages survive; this also repairs a venv moved from another PC.
        & $gesPython -m venv (Join-Path $gesProjectRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python sanal ortami hazirlanamadi. Uygulama aciksa once durdur.bat calistirin.' }
    } else { Write-Output 'Mevcut Python sanal ortami kullaniliyor.' }
    $gesRequirements = if ($Dev) { 'requirements-dev.txt' } else { 'requirements.txt' }
    & $gesVenvPython -m pip install -r (Join-Path $gesProjectRoot $gesRequirements)
    if ($LASTEXITCODE -ne 0) { throw 'Python bagimliliklari kurulamadi.' }

    Push-Location -LiteralPath (Join-Path $gesProjectRoot 'web')
    try {
        if ($gesPnpm) {
            $gesPackageCommand = if ($gesPnpm.Source) { $gesPnpm.Source } else { $gesPnpm.FullName }
            & $gesPackageCommand install --frozen-lockfile
        } else {
            Write-Output 'npm kullaniliyor. Tam kilitli kurulum icin pnpm install --frozen-lockfile tercih edilebilir.'
            & $gesNpm.Source install
        }
        if ($LASTEXITCODE -ne 0) { throw 'Web bagimliliklari kurulamadi.' }
    } finally { Pop-Location }
    Write-Output 'Kurulum tamamlandi. baslat.bat ile calistirabilirsiniz.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    $env:Path = $gesPreviousPath
}
