[CmdletBinding()]
param([string]$StateDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools\local-common.ps1')
$gesRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$gesState = Resolve-GesStateDirectory -Root $gesRoot -StateDirectory $StateDirectory
$gesLock = $null
try {
    if (-not (Test-Path -LiteralPath (Join-Path $gesState 'processes.json') -PathType Leaf)) { Write-Output 'Kayitli GES servisi yok. Baska sureclere dokunulmadi.'; exit 0 }
    $gesLock = Enter-GesLifecycleLock -StateDirectory $gesState
    $gesManifest = Read-GesManifest -StateDirectory $gesState -Root $gesRoot
    $gesCount = Stop-GesOwnedServices -Services @($gesManifest.web, $gesManifest.api)
    $gesManifest.status = 'stopped'; $gesManifest.stoppedAtUtc = [DateTime]::UtcNow.ToString('o')
    Write-GesManifest -StateDirectory $gesState -Manifest $gesManifest
    Write-Output "GES durduruldu ($gesCount sahipligi dogrulanmis surec). Veritabani ve diger uygulamalar korunuyor."
} catch { Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
finally { if ($null -ne $gesLock) { $gesLock.Dispose() } }
