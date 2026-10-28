[CmdletBinding()]
param([string]$StateDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools\local-common.ps1')
$gesRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$gesState = Resolve-GesStateDirectory -Root $gesRoot -StateDirectory $StateDirectory
try { $gesManifest = Read-GesManifest -StateDirectory $gesState -Root $gesRoot; Show-GesStatus -Manifest $gesManifest -StateDirectory $gesState }
catch { Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
