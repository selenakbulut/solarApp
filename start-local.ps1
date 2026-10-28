[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$NoBrowser,
    [ValidateRange(1024, 65535)][int]$ApiPort = 8000,
    [ValidateRange(1024, 65535)][int]$WebPort = 5173,
    [string]$StateDirectory
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools\local-common.ps1')
$gesRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$gesState = Resolve-GesStateDirectory -Root $gesRoot -StateDirectory $StateDirectory
$gesLock = $null
$gesNewServices = @()
$gesPreviousDb = $env:SOLAR_DB_PATH
$gesPreviousApi = $env:SOLAR_API_BASE_URL
$gesManifest = $null

try {
    if ($ApiPort -eq $WebPort) { throw 'API ve arayuz portlari farkli olmali.' }
    $gesLock = Enter-GesLifecycleLock -StateDirectory $gesState
    $gesMode = if ($Preview) { 'preview' } else { 'normal' }
    if ($Preview) { $gesDb = Join-Path $gesRoot '.local-preview\solar.preview.db' }
    elseif (-not [string]::IsNullOrWhiteSpace($env:SOLAR_DB_PATH)) { $gesDb = $env:SOLAR_DB_PATH }
    else { $gesDb = Join-Path $gesRoot 'solar.db' }
    if (-not [System.IO.Path]::IsPathRooted($gesDb)) { $gesDb = Join-Path $gesRoot $gesDb }
    $gesDb = [System.IO.Path]::GetFullPath($gesDb)
    $gesManifest = Read-GesManifest -StateDirectory $gesState -Root $gesRoot
    if ($null -ne $gesManifest) {
        $gesLiveRecords = @()
        foreach ($gesService in @($gesManifest.api, $gesManifest.web)) { $gesLiveRecords += @(Get-GesServiceRecords -Service $gesService | Where-Object { Test-GesProcessIdentity -Record $_ }) }
        if ($gesLiveRecords.Count -gt 0) {
            $gesSameConfiguration = $gesManifest.mode -eq $gesMode -and [string]::Equals([string]$gesManifest.databasePath, $gesDb, [System.StringComparison]::OrdinalIgnoreCase) -and [int]$gesManifest.api.port -eq $ApiPort -and [int]$gesManifest.web.port -eq $WebPort
            if (-not $gesSameConfiguration) { throw 'Kayitli servisler farkli mod/veritabani/port ile calisiyor. Once durdur.bat ile durdurun, sonra istediginiz modda baslatin.' }
            if ((Test-GesServiceRunning -Service $gesManifest.api) -and (Test-GesServiceRunning -Service $gesManifest.web) -and (Test-GesUrl -Url $gesManifest.api.url -Api) -and (Test-GesUrl -Url $gesManifest.web.url)) {
                Show-GesStatus -Manifest $gesManifest -StateDirectory $gesState
                if (-not $NoBrowser) { try { Start-Process -FilePath $gesManifest.web.url -WindowStyle Hidden | Out-Null } catch { Write-Warning ('Tarayici acilamadi: ' + $gesManifest.web.url) } }
                exit 0
            }
            throw 'Kayitli servislerden biri eksik veya hazir degil. Once durdur.bat, sonra baslat.bat calistirin. Loglar surec klasorundedir.'
        }
    }
    foreach ($gesPort in @($ApiPort, $WebPort)) {
        if (-not (Test-GesPortAvailable -Port $gesPort)) { throw "$gesPort portu baska bir surec tarafindan kullaniliyor. Bu surec otomatik olarak devralinmaz veya kapatilmaz. Portu bosaltin ya da -ApiPort/-WebPort ile farkli port secin." }
    }
    $gesPython = Join-Path $gesRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $gesPython -PathType Leaf)) { throw 'Python ortami yok. Once kurulum.bat calistirin veya py -3.12 -m venv .venv ve pip install -r requirements.txt ile kurun.' }
    $gesCheck = & $gesPython -c 'import fastapi, uvicorn, pandas, openpyxl, requests, timezonefinder' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Python bagimliliklari yuklenemedi. kurulum.bat calistirin. Ayrinti: $($gesCheck -join ' ')" }
    $gesNode = Find-GesNode
    & $gesNode -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Node.js surumu eski. Node.js 22.12+ kurun.' }
    $gesWebRoot = Join-Path $gesRoot 'web'
    $gesVite = Join-Path $gesWebRoot 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $gesVite -PathType Leaf)) { throw 'Web bagimliliklari yok. Once kurulum.bat veya web klasorunde npm install calistirin.' }
    if ($Preview) {
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $gesDb)) | Out-Null
        if (-not (Test-Path -LiteralPath $gesDb -PathType Leaf)) {
            $gesSource = Join-Path $gesRoot 'solar.db'
            if (Test-Path -LiteralPath $gesSource -PathType Leaf) { Copy-Item -LiteralPath $gesSource -Destination $gesDb }
        }
    }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $gesDb) -PathType Container)) { throw 'Veritabani ust klasoru bulunamadi. SOLAR_DB_PATH ayarini kontrol edin.' }
    $env:SOLAR_DB_PATH = $gesDb
    $env:SOLAR_API_BASE_URL = "http://127.0.0.1:$ApiPort"
    $gesApiUrl = "http://127.0.0.1:$ApiPort/health"
    $gesWebUrl = "http://127.0.0.1:$WebPort/"
    $gesApi = Start-GesService -Role 'api' -Executable $gesPython -Arguments @('-m', 'uvicorn', 'api:app', '--app-dir', (Quote-GesArgument $gesRoot), '--host', '127.0.0.1', '--port', [string]$ApiPort) -WorkingDirectory $gesRoot -Root $gesRoot -Port $ApiPort -Url $gesApiUrl -StateDirectory $gesState
    $gesNewServices += $gesApi
    $gesManifest = [pscustomobject]@{ schema = 1; root = $gesRoot; mode = $gesMode; databasePath = $gesDb; status = 'starting'; startedAtUtc = [DateTime]::UtcNow.ToString('o'); stoppedAtUtc = $null; api = $gesApi; web = $null }
    Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest
    Wait-GesServiceReady -Service $gesApi -Root $gesRoot
    Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest
    $gesWeb = Start-GesService -Role 'web' -Executable $gesNode -Arguments @((Quote-GesArgument $gesVite), '--host', '127.0.0.1', '--port', [string]$WebPort, '--strictPort') -WorkingDirectory $gesWebRoot -Root $gesRoot -Port $WebPort -Url $gesWebUrl -StateDirectory $gesState
    $gesNewServices += $gesWeb
    $gesManifest.web = $gesWeb
    Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest
    Wait-GesServiceReady -Service $gesWeb -Root $gesRoot
    $gesManifest.status = 'running'
    Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest
    Show-GesStatus -Manifest $gesManifest -StateDirectory $gesState
    if (-not $NoBrowser) {
        try { Start-Process -FilePath $gesWebUrl -WindowStyle Hidden | Out-Null }
        catch { Write-Warning "Tarayici acilamadi. Su adresi acin: $gesWebUrl" }
    }
} catch {
    $gesFailure = $_.Exception.Message
    if ($gesNewServices.Count) {
        try { Stop-GesOwnedServices -Services $gesNewServices | Out-Null }
        catch { $gesFailure += " Geri alma uyarisi: $($_.Exception.Message)" }
        if ($null -ne $gesManifest) {
            $gesManifest.status = 'failed'; $gesManifest.stoppedAtUtc = [DateTime]::UtcNow.ToString('o')
            try { Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest } catch { }
        }
    }
    Write-Host ('HATA: ' + $gesFailure) -ForegroundColor Red
    exit 1
} finally {
    $env:SOLAR_DB_PATH = $gesPreviousDb
    $env:SOLAR_API_BASE_URL = $gesPreviousApi
    if ($null -ne $gesLock) { $gesLock.Dispose() }
}
