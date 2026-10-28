$ErrorActionPreference = 'Stop'

function Resolve-GesStateDirectory {
    param([string]$Root, [string]$StateDirectory)
    if ([string]::IsNullOrWhiteSpace($StateDirectory)) { $StateDirectory = Join-Path $Root '.local-run' }
    if (-not [System.IO.Path]::IsPathRooted($StateDirectory)) { $StateDirectory = Join-Path $Root $StateDirectory }
    return [System.IO.Path]::GetFullPath($StateDirectory)
}

function Enter-GesLifecycleLock {
    param([string]$StateDirectory)
    [System.IO.Directory]::CreateDirectory($StateDirectory) | Out-Null
    try { return [System.IO.File]::Open((Join-Path $StateDirectory 'lifecycle.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch { throw 'Baska bir baslatma/durdurma islemi devam ediyor. Biraz sonra yeniden deneyin.' }
}

function Read-GesManifest {
    param([string]$StateDirectory, [string]$Root)
    $gesManifestPath = Join-Path $StateDirectory 'processes.json'
    if (-not (Test-Path -LiteralPath $gesManifestPath -PathType Leaf)) { return $null }
    try { $gesManifest = Get-Content -LiteralPath $gesManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "Surec kaydi okunamadi: $gesManifestPath. Dosyayi incelemeden servisler baslatilmaz veya kapatilmaz." }
    if ($gesManifest.schema -ne 1 -or -not [string]::Equals([string]$gesManifest.root, $Root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Surec kaydi bu proje ile eslesmiyor: $gesManifestPath" }
    foreach ($gesRole in @('api', 'web')) {
        $gesService = $gesManifest.$gesRole
        if ($null -eq $gesService) { continue }
        if ($gesService.role -ne $gesRole -or [int]$gesService.port -lt 1024 -or [int]$gesService.port -gt 65535) { throw "Gecersiz servis kaydi: $gesManifestPath" }
        foreach ($gesRecord in @($gesService.launcher, $gesService.worker)) {
            if ($null -eq $gesRecord -or [string]::IsNullOrEmpty([string]$gesRecord.commandLine)) { continue }
            if (-not (Test-GesProcessRole -Record $gesRecord -Role $gesRole -Root $Root)) { throw "Surec komutu bu projeye ait degil; islem yapilmadi: $gesManifestPath" }
        }
    }
    return $gesManifest
}

function Test-GesProjectCommand {
    param([string]$CommandLine, [string]$Role, [string]$Root)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    if ($Role -eq 'api') {
        $gesRootPattern = [regex]::Escape($Root)
        return $CommandLine -match '(?i)(?:^|\s)-m\s+uvicorn\s+api:app(?:\s|$)' -and $CommandLine -match ('(?i)(?:^|\s)--app-dir\s+(?:"' + $gesRootPattern + '"|' + $gesRootPattern + ')(?=\s|$)')
    }
    if ($Role -eq 'web') {
        $gesCliPattern = [regex]::Escape((Join-Path $Root 'web\node_modules\vite\bin\vite.js'))
        return $CommandLine -match ('(?i)(?:^|[\s"])' + $gesCliPattern + '(?=[\s"]|$)')
    }
    return $false
}

function Test-GesProcessRole {
    param($Record, [string]$Role, [string]$Root)
    $gesExecutableName = [System.IO.Path]::GetFileName([string]$Record.executablePath)
    if ($Role -eq 'api' -and $gesExecutableName -notmatch '(?i)^python(?:\d+(?:\.\d+)*)?w?\.exe$') { return $false }
    if ($Role -eq 'web' -and $gesExecutableName -ne 'node.exe') { return $false }
    return Test-GesProjectCommand -CommandLine ([string]$Record.commandLine) -Role $Role -Root $Root
}

function Write-GesManifest {
    param([string]$StateDirectory, $Manifest)
    $gesManifestPath = Join-Path $StateDirectory 'processes.json'
    $gesTemporaryPath = Join-Path $StateDirectory 'processes.json.tmp'
    [System.IO.File]::WriteAllText($gesTemporaryPath, ($Manifest | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $gesTemporaryPath -Destination $gesManifestPath -Force
}

function Get-GesProcessSnapshot {
    param([int]$ProcessId)
    try {
        $gesProcess = Get-Process -Id $ProcessId -ErrorAction Stop
        $gesCim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        if ($null -eq $gesCim) { return $null }
        return [pscustomobject]@{ pid = $ProcessId; creationTicks = [string]$gesProcess.StartTime.ToUniversalTime().Ticks; startedAtUtc = $gesProcess.StartTime.ToUniversalTime().ToString('o'); executablePath = [string]$gesCim.ExecutablePath; commandLine = [string]$gesCim.CommandLine; parentPid = [int]$gesCim.ParentProcessId }
    } catch { return $null }
}

function Test-GesProcessIdentity {
    param($Record)
    if ($null -eq $Record -or -not $Record.pid -or [string]::IsNullOrEmpty([string]$Record.creationTicks) -or [string]::IsNullOrEmpty([string]$Record.commandLine)) { return $false }
    $gesCurrent = Get-GesProcessSnapshot -ProcessId ([int]$Record.pid)
    return $null -ne $gesCurrent -and [string]$gesCurrent.creationTicks -eq [string]$Record.creationTicks -and [string]::Equals([string]$gesCurrent.commandLine, [string]$Record.commandLine, [System.StringComparison]::Ordinal) -and [string]::Equals([string]$gesCurrent.executablePath, [string]$Record.executablePath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-GesListeningProcessIds {
    param([int]$Port)
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-GesPortAvailable {
    param([int]$Port)
    $gesListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try { $gesListener.Start(); return $true } catch { return $false } finally { $gesListener.Stop() }
}

function Test-GesUrl {
    param([string]$Url, [switch]$Api)
    try {
        $gesResponse = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($gesResponse.StatusCode -ne 200) { return $false }
        if ($Api) { return ($gesResponse.Content | ConvertFrom-Json).status -eq 'ok' }
        return $true
    } catch { return $false }
}

function Get-GesServiceRecords {
    param($Service)
    if ($null -eq $Service) { return @() }
    $gesRecords = @()
    if ($null -ne $Service.launcher) { $gesRecords += $Service.launcher }
    if ($null -ne $Service.worker) { $gesRecords += $Service.worker }
    return @($gesRecords | Group-Object pid | ForEach-Object { $_.Group[0] })
}

function Get-GesOwnedProcessTree {
    param([object[]]$SeedRecords)
    $gesOwned = @{}
    foreach ($gesSeed in @($SeedRecords)) { if (Test-GesProcessIdentity -Record $gesSeed) { $gesOwned[[int]$gesSeed.pid] = $gesSeed } }
    if ($gesOwned.Count -eq 0) { return @() }
    $gesAll = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $gesChanged = $true
    while ($gesChanged) {
        $gesChanged = $false
        foreach ($gesCandidate in $gesAll) {
            $gesCandidateId = [int]$gesCandidate.ProcessId; $gesParentId = [int]$gesCandidate.ParentProcessId
            if ($gesOwned.ContainsKey($gesCandidateId) -or -not $gesOwned.ContainsKey($gesParentId)) { continue }
            $gesSnapshot = Get-GesProcessSnapshot -ProcessId $gesCandidateId
            if ($null -ne $gesSnapshot -and [int]$gesSnapshot.parentPid -eq $gesParentId -and [long]$gesSnapshot.creationTicks -ge [long]$gesOwned[$gesParentId].creationTicks -and (Test-GesProcessIdentity -Record $gesOwned[$gesParentId])) { $gesOwned[$gesCandidateId] = $gesSnapshot; $gesChanged = $true }
        }
    }
    return @($gesOwned.Values)
}

function Test-GesServiceRunning {
    param($Service)
    if ($null -eq $Service -or -not (Test-GesProcessIdentity -Record $Service.worker)) { return $false }
    return @(Get-GesListeningProcessIds -Port ([int]$Service.port)) -contains [int]$Service.worker.pid
}

function Stop-GesOwnedServices {
    param([object[]]$Services)
    $gesSeeds = @()
    foreach ($gesService in @($Services)) { $gesSeeds += @(Get-GesServiceRecords -Service $gesService) }
    $gesTree = @(Get-GesOwnedProcessTree -SeedRecords $gesSeeds); $gesFailures = @()
    # Verify PID, creation time, executable and command again before each stop.
    foreach ($gesRecord in @($gesTree | Sort-Object { [long]$_.creationTicks } -Descending)) {
        if (-not (Test-GesProcessIdentity -Record $gesRecord)) { continue }
        try {
            Stop-Process -Id ([int]$gesRecord.pid) -Force -ErrorAction Stop
            try { Wait-Process -Id ([int]$gesRecord.pid) -Timeout 4 -ErrorAction Stop } catch { }
            if (Test-GesProcessIdentity -Record $gesRecord) { $gesFailures += [int]$gesRecord.pid }
        } catch { if (Test-GesProcessIdentity -Record $gesRecord) { $gesFailures += [int]$gesRecord.pid } }
    }
    if ($gesFailures.Count) { throw "Projeye ait su surecler durdurulamadi: $($gesFailures -join ', '). Kayit korundu; yeniden durdurmayi deneyin." }
    return $gesTree.Count
}

function Quote-GesArgument {
    param([string]$Value)
    if ($Value.Contains('"')) { throw 'Komut argumaninda desteklenmeyen tirnak karakteri var.' }
    return '"' + $Value + '"'
}

function Find-GesNode {
    if (-not [string]::IsNullOrWhiteSpace($env:GES_NODE_PATH)) {
        if (-not (Test-Path -LiteralPath $env:GES_NODE_PATH -PathType Leaf)) { throw 'GES_NODE_PATH gecerli bir node.exe dosyasini gostermiyor.' }
        return [System.IO.Path]::GetFullPath($env:GES_NODE_PATH)
    }
    $gesNodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $gesNodeCommand) { return $gesNodeCommand.Source }
    $gesBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $gesBundled -PathType Leaf) { return $gesBundled }
    throw 'Node.js bulunamadi. Node.js 22.12+ kurun veya GES_NODE_PATH degiskenini node.exe yoluna ayarlayin.'
}

function Start-GesService {
    param([string]$Role, [string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Root, [int]$Port, [string]$Url, [string]$StateDirectory)
    $gesStartedBefore = [DateTime]::UtcNow
    $gesOut = Join-Path $StateDirectory ($Role + '.stdout.log'); $gesErr = Join-Path $StateDirectory ($Role + '.stderr.log')
    $gesProcess = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $gesOut -RedirectStandardError $gesErr -PassThru -ErrorAction Stop
    $gesLauncher = Get-GesProcessSnapshot -ProcessId $gesProcess.Id
    if ($null -eq $gesLauncher) {
        # A virtualenv redirector can exit before its Python worker. This launch-
        # only seed cannot pass Test-GesProcessIdentity or authorize termination.
        $gesLauncher = [pscustomobject]@{ pid = $gesProcess.Id; creationTicks = [string]$gesStartedBefore.Ticks; startedAtUtc = $gesStartedBefore.ToString('o'); executablePath = $Executable; commandLine = ''; parentPid = 0 }
    }
    return [pscustomobject]@{ role = $Role; port = $Port; url = $Url; launcher = $gesLauncher; worker = $null; stdout = $gesOut; stderr = $gesErr; startedBeforeUtc = $gesStartedBefore.ToString('o') }
}

function Wait-GesServiceReady {
    param($Service, [string]$Root)
    $gesWatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($gesWatch.Elapsed.TotalSeconds -lt 35) {
        foreach ($gesOwnerId in @(Get-GesListeningProcessIds -Port ([int]$Service.port))) {
            $gesWorker = Get-GesProcessSnapshot -ProcessId ([int]$gesOwnerId)
            if ($null -eq $gesWorker -or [string]::IsNullOrEmpty($gesWorker.commandLine)) { continue }
            if (-not (Test-GesProcessRole -Record $gesWorker -Role $Service.role -Root $Root)) { continue }
            $gesMatches = $false
            if ([int]$gesWorker.pid -eq [int]$Service.launcher.pid) { $gesMatches = Test-GesProcessIdentity -Record $Service.launcher }
            else {
                $gesChain = $gesWorker
                for ($gesDepth = 0; $gesDepth -lt 12 -and $null -ne $gesChain; $gesDepth++) {
                    if ([int]$gesChain.parentPid -eq [int]$Service.launcher.pid) {
                        $gesMatches = [long]$gesChain.creationTicks -ge [long]$Service.launcher.creationTicks -and [DateTime]::Parse($gesChain.startedAtUtc).ToUniversalTime() -le [DateTime]::Parse($Service.startedBeforeUtc).ToUniversalTime().AddSeconds(40)
                        break
                    }
                    $gesChain = Get-GesProcessSnapshot -ProcessId ([int]$gesChain.parentPid)
                }
            }
            if (-not $gesMatches) { continue }
            $Service.worker = $gesWorker
            if (Test-GesUrl -Url $Service.url -Api:($Service.role -eq 'api')) { return }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "$($Service.role) hazir olmadi. Logu inceleyin: $($Service.stderr)"
}

function Show-GesStatus {
    param($Manifest, [string]$StateDirectory)
    if ($null -eq $Manifest) { Write-Output 'GES calismiyor (bu klasorde kayitli bir servis yok).'; return }
    $gesApiRunning = Test-GesServiceRunning -Service $Manifest.api; $gesWebRunning = Test-GesServiceRunning -Service $Manifest.web
    Write-Output ('Mod: ' + $Manifest.mode)
    Write-Output ('Veritabani: ' + $Manifest.databasePath)
    Write-Output ('API: ' + $(if ($gesApiRunning) { 'calisiyor' } else { 'kapali' }) + ' / ' + $Manifest.api.url)
    Write-Output ('Arayuz: ' + $(if ($gesWebRunning) { 'calisiyor' } else { 'kapali' }) + ' / ' + $Manifest.web.url)
    Write-Output ('Surec kaydi ve loglar: ' + $StateDirectory)
}
