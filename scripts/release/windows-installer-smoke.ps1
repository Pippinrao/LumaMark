param(
  [ValidateSet('Nsis', 'Msi')]
  [string]$InstallerKind = 'Nsis',

  [string]$InstallerPath = '',

  [string]$InstallDir = '',

  [switch]$PlanOnly,

  [int]$LaunchSeconds = 3,

  [switch]$KeepInstallOnFailure,

  # After install, run window chrome, argv/menu/table, and Win32 media caret checks.
  [switch]$RunInstalledAcceptance = $true
)

$ErrorActionPreference = 'Stop'

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.Path]::GetFullPath($Path)
}

function Test-PathUnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $normalizedPath = (Get-FullPath $Path).TrimEnd('\')
  $normalizedRoot = (Get-FullPath $Root).TrimEnd('\')
  $rootPrefix = "$normalizedRoot\"

  return $normalizedPath.Equals($normalizedRoot, $comparison) -or
    $normalizedPath.StartsWith($rootPrefix, $comparison)
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)

  return $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Join-CommandArguments {
  param([string[]]$Arguments)

  $escaped = foreach ($argument in $Arguments) {
    if ($argument -match '[\s"]') {
      '"' + ($argument -replace '"', '\"') + '"'
    } else {
      $argument
    }
  }

  return ($escaped -join ' ')
}

function Invoke-SmokeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$Description
  )

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList (Join-CommandArguments $Arguments) `
    -Wait `
    -PassThru `
    -WindowStyle Hidden

  if ($process.ExitCode -ne 0) {
    throw "$Description failed with exit code $($process.ExitCode)."
  }
}

function Assert-NoRunningLumaMarkProcesses {
  $running = @(Get-Process -Name lumamark -ErrorAction SilentlyContinue)
  if ($running.Count -eq 0) {
    return
  }

  $details = @(
    $running | ForEach-Object {
      $path = try { [string]$_.Path } catch { '<path unavailable>' }
      "PID=$($_.Id), Path=$path"
    }
  ) -join '; '
  throw "Refusing silent installer input because LumaMark is running: $details"
}

function Remove-SmokeRegistryEntries {
  param([Parameter(Mandatory = $true)][string]$InstallDir)

  $productKeyPath = 'HKCU:\Software\lumamark\LumaMark'
  if (Test-Path -LiteralPath $productKeyPath) {
    $productKey = Get-Item -LiteralPath $productKeyPath
    $defaultValue = [string]$productKey.GetValue('')
    $installDirValue = ''
    $properties = Get-ItemProperty -LiteralPath $productKeyPath

    if ($properties.PSObject.Properties.Name -contains 'InstallDir') {
      $installDirValue = [string]$properties.InstallDir
    }

    if ($defaultValue -eq $InstallDir -or $installDirValue -eq $InstallDir) {
      Remove-Item -LiteralPath $productKeyPath -Recurse -Force
    }
  }

  $manufacturerKeyPath = 'HKCU:\Software\lumamark'
  if (Test-Path -LiteralPath $manufacturerKeyPath) {
    $manufacturerKey = Get-Item -LiteralPath $manufacturerKeyPath
    $remainingChildren = Get-ChildItem -LiteralPath $manufacturerKeyPath
    $remainingValues = $manufacturerKey.GetValueNames()
    if ($remainingChildren.Count -eq 0 -and $remainingValues.Count -eq 0) {
      Remove-Item -LiteralPath $manufacturerKeyPath -Force
    }
  }
}

function Get-ExistingLumaMarkInstallDir {
  $candidates = @()
  $productKeyPath = 'HKCU:\Software\lumamark\LumaMark'
  $uninstallKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LumaMark'

  if (Test-Path -LiteralPath $productKeyPath) {
    $productKey = Get-Item -LiteralPath $productKeyPath
    $defaultValue = [string]$productKey.GetValue('')
    if ($defaultValue) {
      $candidates += $defaultValue
    }

    $properties = Get-ItemProperty -LiteralPath $productKeyPath
    if ($properties.PSObject.Properties.Name -contains 'InstallDir') {
      $candidates += [string]$properties.InstallDir
    }
  }

  if (Test-Path -LiteralPath $uninstallKeyPath) {
    $properties = Get-ItemProperty -LiteralPath $uninstallKeyPath
    if ($properties.PSObject.Properties.Name -contains 'InstallLocation') {
      $candidates += ([string]$properties.InstallLocation).Trim('"')
    }
    if ($properties.PSObject.Properties.Name -contains 'UninstallString') {
      $uninstallString = ([string]$properties.UninstallString).Trim('"')
      if ($uninstallString) {
        $candidates += Split-Path -Parent $uninstallString
      }
    }
  }

  foreach ($candidate in $candidates) {
    if ($candidate) {
      return (Get-FullPath $candidate)
    }
  }

  return ''
}

function Get-LumaMarkSharedRegistryState {
  $existingState = [System.Collections.Generic.List[string]]::new()
  $exclusiveKeys = @(
    'HKCU:\Software\lumamark\LumaMark',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LumaMark',
    'HKLM:\Software\lumamark\LumaMark'
  )

  foreach ($registryPath in $exclusiveKeys) {
    if (Test-Path -LiteralPath $registryPath) {
      [void]$existingState.Add($registryPath)
    }
  }

  $runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (Test-Path -LiteralPath $runKeyPath) {
    $runKey = Get-Item -LiteralPath $runKeyPath
    if ($runKey.GetValueNames() -contains 'LumaMark') {
      [void]$existingState.Add("$runKeyPath [LumaMark value]")
    }
  }

  $machineUninstallRoots = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($uninstallRoot in $machineUninstallRoots) {
    if (-not (Test-Path -LiteralPath $uninstallRoot)) {
      continue
    }

    foreach ($uninstallKey in Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction Stop) {
      $properties = Get-ItemProperty -LiteralPath $uninstallKey.PSPath
      if (
        $uninstallKey.PSChildName -eq 'LumaMark' -or
        [string]$properties.DisplayName -eq 'LumaMark'
      ) {
        [void]$existingState.Add("$uninstallRoot\$($uninstallKey.PSChildName)")
      }
    }
  }

  $machineInstallerProductsRoot = 'HKLM:\Software\Classes\Installer\Products'
  if (Test-Path -LiteralPath $machineInstallerProductsRoot) {
    foreach (
      $productKey in Get-ChildItem -LiteralPath $machineInstallerProductsRoot -ErrorAction Stop
    ) {
      $properties = Get-ItemProperty -LiteralPath $productKey.PSPath
      if ([string]$properties.ProductName -eq 'LumaMark') {
        [void]$existingState.Add("$machineInstallerProductsRoot\$($productKey.PSChildName)")
      }
    }
  }

  $installerUserDataRoot = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Installer\UserData'
  if (Test-Path -LiteralPath $installerUserDataRoot) {
    $installPropertyKeys = @(
      Get-ChildItem `
        -Path "$installerUserDataRoot\*\Products\*\InstallProperties" `
        -ErrorAction SilentlyContinue
    )
    foreach ($installPropertyKey in $installPropertyKeys) {
      $properties = Get-ItemProperty -LiteralPath $installPropertyKey.PSPath
      if ([string]$properties.DisplayName -eq 'LumaMark') {
        [void]$existingState.Add($installPropertyKey.Name)
      }
    }
  }

  return $existingState.ToArray()
}

function Get-MarkdownAssociationRegistryKeys {
  return @(
    [pscustomobject]@{
      PowerShellPath = 'HKCU:\Software\Classes\.md'
      NativePath = 'HKCU\Software\Classes\.md'
      Name = 'md'
    },
    [pscustomobject]@{
      PowerShellPath = 'HKCU:\Software\Classes\.markdown'
      NativePath = 'HKCU\Software\Classes\.markdown'
      Name = 'markdown'
    },
    [pscustomobject]@{
      PowerShellPath = 'HKCU:\Software\Classes\.mdown'
      NativePath = 'HKCU\Software\Classes\.mdown'
      Name = 'mdown'
    },
    [pscustomobject]@{
      PowerShellPath = 'HKCU:\Software\Classes\LumaMark.Markdown'
      NativePath = 'HKCU\Software\Classes\LumaMark.Markdown'
      Name = 'lumamark-markdown'
    }
  )
}

function New-MarkdownAssociationRegistrySnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotRoot,
    [Parameter(Mandatory = $true)][object[]]$RegistryKeys
  )

  New-Item -ItemType Directory -Path $SnapshotRoot -Force | Out-Null
  $snapshots = [System.Collections.Generic.List[object]]::new()

  foreach ($registryKey in $RegistryKeys) {
    $snapshotPath = Join-Path $SnapshotRoot "$($registryKey.Name).reg"
    $existed = Test-Path -LiteralPath $registryKey.PowerShellPath
    $originalHash = ''

    if ($existed) {
      & reg.exe export $registryKey.NativePath $snapshotPath /y | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "Registry snapshot export failed for $($registryKey.NativePath) with exit code $LASTEXITCODE."
      }
      $originalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $snapshotPath).Hash
    }

    [void]$snapshots.Add([pscustomobject]@{
      PowerShellPath = $registryKey.PowerShellPath
      NativePath = $registryKey.NativePath
      Name = $registryKey.Name
      SnapshotPath = $snapshotPath
      Existed = $existed
      OriginalHash = $originalHash
    })
  }

  return $snapshots.ToArray()
}

function Restore-MarkdownAssociationRegistrySnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotRoot,
    [Parameter(Mandatory = $true)][object[]]$Snapshots
  )

  $restoreErrors = [System.Collections.Generic.List[string]]::new()

  foreach ($snapshot in $Snapshots) {
    try {
      if (Test-Path -LiteralPath $snapshot.PowerShellPath) {
        Remove-Item -LiteralPath $snapshot.PowerShellPath -Recurse -Force
      }

      if ($snapshot.Existed) {
        & reg.exe import $snapshot.SnapshotPath | Out-Host
        if ($LASTEXITCODE -ne 0) {
          throw "reg import exited with code $LASTEXITCODE"
        }
      }
    } catch {
      [void]$restoreErrors.Add("$($snapshot.NativePath) restore: $($_.Exception.Message)")
    }
  }

  foreach ($snapshot in $Snapshots) {
    try {
      if (-not $snapshot.Existed) {
        if (Test-Path -LiteralPath $snapshot.PowerShellPath) {
          throw 'originally absent key still exists'
        }
        continue
      }

      if (-not (Test-Path -LiteralPath $snapshot.PowerShellPath)) {
        throw 'original key was not recreated'
      }

      $verificationPath = Join-Path $SnapshotRoot "$($snapshot.Name).restored.reg"
      & reg.exe export $snapshot.NativePath $verificationPath /y | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "verification export exited with code $LASTEXITCODE"
      }

      $restoredHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $verificationPath).Hash
      if ($restoredHash -ne $snapshot.OriginalHash) {
        throw "Registry restoration hash mismatch: $restoredHash != $($snapshot.OriginalHash)"
      }
    } catch {
      [void]$restoreErrors.Add("$($snapshot.NativePath) verification: $($_.Exception.Message)")
    }
  }

  if ($restoreErrors.Count -gt 0) {
    $errorDetails = $restoreErrors -join "`n- "
    throw "Registry restoration failed for one or more keys. Snapshot retained at $SnapshotRoot.`n- $errorDetails"
  }
}

function Stop-SmokeApp {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }

  $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    if (-not $Process.WaitForExit(5000)) {
      throw "LumaMark PID $($Process.Id) did not exit after Stop-Process."
    }
  }
}

function Assert-MarkdownFileAssociation {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$ExpectedProgId
  )

  $normalizedExe = (Get-FullPath $ExecutablePath).ToLowerInvariant()
  $extensionKeys = @('.md', '.markdown', '.mdown')

  foreach ($extension in $extensionKeys) {
    $extKeyPath = "HKCU:\Software\Classes\$extension"
    if (-not (Test-Path -LiteralPath $extKeyPath)) {
      throw "Missing HKCU file association key for $extension after install."
    }

    $progId = [string](Get-Item -LiteralPath $extKeyPath).GetValue('')
    if ($progId -ne $ExpectedProgId) {
      throw "Extension $extension ProgId was '$progId', expected '$ExpectedProgId'."
    }
  }

  $commandKeyPath = "HKCU:\Software\Classes\$ExpectedProgId\shell\open\command"
  if (-not (Test-Path -LiteralPath $commandKeyPath)) {
    throw "Missing open command for ProgId $ExpectedProgId after install."
  }

  $openCommand = [string](Get-Item -LiteralPath $commandKeyPath).GetValue('')
  if ([string]::IsNullOrWhiteSpace($openCommand)) {
    throw "Open command for ProgId $ExpectedProgId is empty."
  }

  if ($openCommand.ToLowerInvariant() -notlike "*$normalizedExe*") {
    throw "Open command does not target installed exe.`nCommand: $openCommand`nExe: $ExecutablePath"
  }

  if ($openCommand -notmatch '%1') {
    throw "Open command does not pass the document path (%1): $openCommand"
  }

  return [ordered]@{
    progId = $ExpectedProgId
    openCommand = $openCommand
    extensions = $extensionKeys
  }
}

function Get-InstalledAcceptanceScripts {
  return @(
    'scripts\release\verify-installed-window-chrome.mjs',
    'scripts\release\verify-installed-second-instance-open.mjs',
    'scripts\release\verify-packaged-argv-open.mjs',
    'scripts\release\verify-packaged-menu-cold-start.mjs',
    'scripts\release\verify-packaged-table-caret.mjs',
    'scripts\release\verify-installed-media-caret-os.mjs',
    'scripts\release\verify-installed-reading-mode-os.mjs',
    'scripts\release\verify-installed-inline-code-caret-os.mjs'
  )
}

function Invoke-InstalledAcceptance {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$InstallerPath
  )

  $hadExecutableOverride = Test-Path Env:LUMAMARK_EXECUTABLE
  $previousExecutableOverride = $env:LUMAMARK_EXECUTABLE
  $hadInstallerOverride = Test-Path Env:LUMAMARK_ROUTING_ACCEPTANCE_NSIS
  $previousInstallerOverride = $env:LUMAMARK_ROUTING_ACCEPTANCE_NSIS
  $env:LUMAMARK_EXECUTABLE = $ExecutablePath
  $env:LUMAMARK_ROUTING_ACCEPTANCE_NSIS = $InstallerPath
  try {
    foreach ($relativeScript in @(Get-InstalledAcceptanceScripts)) {
      $scriptPath = Join-Path $RepoRoot $relativeScript
      if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Installed acceptance script missing: $scriptPath"
      }

      $process = Start-Process `
        -FilePath 'node' `
        -ArgumentList @($scriptPath) `
        -WorkingDirectory $RepoRoot `
        -Wait `
        -PassThru `
        -NoNewWindow

      if ($process.ExitCode -ne 0) {
        throw "Installed acceptance failed: $relativeScript (exit $($process.ExitCode))."
      }
    }
  } finally {
    if ($hadExecutableOverride) {
      $env:LUMAMARK_EXECUTABLE = $previousExecutableOverride
    } else {
      Remove-Item Env:LUMAMARK_EXECUTABLE -ErrorAction SilentlyContinue
    }
    if ($hadInstallerOverride) {
      $env:LUMAMARK_ROUTING_ACCEPTANCE_NSIS = $previousInstallerOverride
    } else {
      Remove-Item Env:LUMAMARK_ROUTING_ACCEPTANCE_NSIS -ErrorAction SilentlyContinue
    }
  }
}

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot '..\..')
$tauriConfigPath = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$appVersion = (Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json).version
$smokeRoot = Get-FullPath (Join-Path ([System.IO.Path]::GetTempPath()) 'lumamark-installer-smoke')
$resolvedInstallDir = if ($InstallDir) {
  Get-FullPath $InstallDir
} else {
  Get-FullPath (Join-Path $smokeRoot $InstallerKind.ToLowerInvariant())
}

if (-not (Test-PathUnderRoot -Path $resolvedInstallDir -Root $smokeRoot)) {
  throw "InstallDir must stay under $smokeRoot. Received: $resolvedInstallDir"
}

$normalizedInstallDir = $resolvedInstallDir.TrimEnd('\')
$normalizedSmokeRoot = $smokeRoot.TrimEnd('\')
if ($normalizedInstallDir.Equals($normalizedSmokeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "InstallDir must be a strict child of $smokeRoot. Received: $resolvedInstallDir"
}

$defaultInstallerPath = if ($InstallerKind -eq 'Nsis') {
  Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\LumaMark_${appVersion}_x64-setup.exe"
} else {
  Join-Path $repoRoot "src-tauri\target\release\bundle\msi\LumaMark_${appVersion}_x64_en-US.msi"
}
$resolvedInstallerPath = if ($InstallerPath) {
  Get-FullPath $InstallerPath
} else {
  Get-FullPath $defaultInstallerPath
}

$requiresAdmin = $InstallerKind -eq 'Msi'
$executablePath = Join-Path $resolvedInstallDir 'lumamark.exe'
$existingInstallDir = Get-ExistingLumaMarkInstallDir
$associationRegistryKeys = @(Get-MarkdownAssociationRegistryKeys)
$existingAssociationState = @(
  $associationRegistryKeys |
    Where-Object { Test-Path -LiteralPath $_.PowerShellPath } |
    ForEach-Object { $_.PowerShellPath }
)
$blockingRegistryState = @(Get-LumaMarkSharedRegistryState)
$uninstallPath = if ($InstallerKind -eq 'Nsis') {
  Join-Path $resolvedInstallDir 'uninstall.exe'
} else {
  $resolvedInstallerPath
}

if ($InstallerKind -eq 'Nsis') {
  $installCommand = $resolvedInstallerPath
  $installArguments = @('/S', '/NS', "/D=$resolvedInstallDir")
  $uninstallCommand = $uninstallPath
  $uninstallArguments = @('/S')
} else {
  $installCommand = 'msiexec.exe'
  $installArguments = @(
    '/i',
    $resolvedInstallerPath,
    '/qn',
    '/norestart',
    "INSTALLDIR=$resolvedInstallDir"
  )
  $uninstallCommand = 'msiexec.exe'
  $uninstallArguments = @('/x', $resolvedInstallerPath, '/qn', '/norestart')
}

$plan = [ordered]@{
  installerKind = $InstallerKind
  willExecute = -not $PlanOnly.IsPresent
  requiresAdmin = $requiresAdmin
  repoRoot = $repoRoot
  installerPath = $resolvedInstallerPath
  installerExists = Test-Path -LiteralPath $resolvedInstallerPath
  installDir = $resolvedInstallDir
  existingInstallDir = $existingInstallDir
  blockingRegistryState = $blockingRegistryState
  existingAssociationState = $existingAssociationState
  executablePath = $executablePath
  uninstallPath = $uninstallPath
  installCommand = $installCommand
  installArguments = $installArguments
  uninstallCommand = $uninstallCommand
  uninstallArguments = $uninstallArguments
  launchSeconds = $LaunchSeconds
  runInstalledAcceptance = $RunInstalledAcceptance.IsPresent
  installedAcceptanceScripts = @(Get-InstalledAcceptanceScripts)
}

if ($PlanOnly) {
  $plan | ConvertTo-Json -Depth 4
  exit 0
}

if (-not (Test-Path -LiteralPath $resolvedInstallerPath)) {
  throw "Installer does not exist: $resolvedInstallerPath"
}

if ($requiresAdmin -and -not (Test-IsAdministrator)) {
  throw 'MSI smoke requires an elevated PowerShell session.'
}

if ($blockingRegistryState.Count -gt 0) {
  $stateDetails = $blockingRegistryState -join '; '
  throw "Shared LumaMark product registry state already exists: $stateDetails. Run installer acceptance in Windows Sandbox or a clean Windows user profile."
}

if (
  $existingInstallDir -and
  -not (Test-PathUnderRoot -Path $existingInstallDir -Root $smokeRoot)
) {
  throw "Existing LumaMark install detected at $existingInstallDir. Refusing to mutate shared product, uninstall, or file-association registry state. Run this acceptance in Windows Sandbox or a clean Windows user profile."
}

Assert-NoRunningLumaMarkProcesses
$associationSnapshotRoot = Get-FullPath (
  Join-Path `
    ([System.IO.Path]::GetTempPath()) `
    "lumamark-installer-registry-snapshot-$([guid]::NewGuid().ToString('N'))"
)
$associationRegistrySnapshot = @(
  New-MarkdownAssociationRegistrySnapshot `
    -SnapshotRoot $associationSnapshotRoot `
    -RegistryKeys $associationRegistryKeys
)
$associationRegistryRestored = $false
$installed = $false
$launchedProcess = $null
$result = $null

try {
  Assert-NoRunningLumaMarkProcesses
  if (Test-Path -LiteralPath $resolvedInstallDir) {
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolvedInstallDir -Force | Out-Null

  Assert-NoRunningLumaMarkProcesses
  Invoke-SmokeProcess `
    -FilePath $installCommand `
    -Arguments $installArguments `
    -Description "$InstallerKind install"
  $installed = $true

  if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "Installed executable not found: $executablePath"
  }

  $installedVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($executablePath).FileVersion
  $association = Assert-MarkdownFileAssociation `
    -ExecutablePath $executablePath `
    -ExpectedProgId 'LumaMark.Markdown'

  if ($RunInstalledAcceptance.IsPresent) {
    Invoke-InstalledAcceptance `
      -RepoRoot $repoRoot `
      -ExecutablePath $executablePath `
      -InstallerPath $resolvedInstallerPath
  }

  $launchedProcess = Start-Process `
    -FilePath $executablePath `
    -PassThru `
    -WindowStyle Hidden
  Start-Sleep -Seconds $LaunchSeconds
  $launchedProcess.Refresh()

  if ($launchedProcess.HasExited) {
    throw "Installed executable exited with code $($launchedProcess.ExitCode)."
  }

  Stop-SmokeApp -Process $launchedProcess
  $launchedProcess = $null

  Assert-NoRunningLumaMarkProcesses
  Invoke-SmokeProcess `
    -FilePath $uninstallCommand `
    -Arguments $uninstallArguments `
    -Description "$InstallerKind uninstall"
  $installed = $false

  if (Test-Path -LiteralPath $executablePath) {
    throw "Uninstall left executable behind: $executablePath"
  }

  if (Test-Path -LiteralPath $resolvedInstallDir) {
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
  }
  Remove-SmokeRegistryEntries -InstallDir $resolvedInstallDir

  $remainingBlockingRegistryState = @(Get-LumaMarkSharedRegistryState)
  if ($remainingBlockingRegistryState.Count -gt 0) {
    $remainingStateDetails = $remainingBlockingRegistryState -join '; '
    throw "Uninstall left blocking registry state behind: $remainingStateDetails"
  }

  $result = [ordered]@{
    installerKind = $InstallerKind
    installedExecutableLaunched = $true
    installedVersion = $installedVersion
    fileAssociation = $association
    installedAcceptance = $RunInstalledAcceptance.IsPresent
    launchSeconds = $LaunchSeconds
    uninstalled = $true
    installDir = $resolvedInstallDir
    registryAssociationsRestored = $false
  }
} finally {
  try {
    Stop-SmokeApp -Process $launchedProcess

    if ($installed -and -not $KeepInstallOnFailure) {
      if (Test-Path -LiteralPath $uninstallPath) {
        Assert-NoRunningLumaMarkProcesses
        Invoke-SmokeProcess `
          -FilePath $uninstallPath `
          -Arguments $uninstallArguments `
          -Description "$InstallerKind cleanup uninstall"
      }

      if (Test-Path -LiteralPath $resolvedInstallDir) {
        Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
      }
      Remove-SmokeRegistryEntries -InstallDir $resolvedInstallDir
    }
  } finally {
    Restore-MarkdownAssociationRegistrySnapshot `
      -SnapshotRoot $associationSnapshotRoot `
      -Snapshots $associationRegistrySnapshot
    $associationRegistryRestored = $true

    if (Test-Path -LiteralPath $associationSnapshotRoot) {
      Remove-Item -LiteralPath $associationSnapshotRoot -Recurse -Force
    }
  }
}

if ($null -ne $result) {
  $result.registryAssociationsRestored = $associationRegistryRestored
  $result | ConvertTo-Json -Depth 5
}
