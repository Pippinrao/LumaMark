param(
  [ValidateSet('Nsis', 'Msi')]
  [string]$InstallerKind = 'Nsis',

  [string]$InstallerPath = '',

  [string]$InstallDir = '',

  [switch]$PlanOnly,

  [int]$LaunchSeconds = 3,

  [switch]$KeepInstallOnFailure,

  # Allow a side-by-side smoke install while another LumaMark is present.
  # Associations may be rewritten for the smoke install and restored on uninstall.
  [switch]$AllowExistingInstall,

  # After install, run argv/menu/table CDP against the installed executable.
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

function Stop-SmokeApp {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }

  $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
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

function Invoke-InstalledAcceptance {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ExecutablePath
  )

  $env:LUMAMARK_EXECUTABLE = $ExecutablePath
  try {
    $scripts = @(
      'scripts\release\verify-packaged-argv-open.mjs',
      'scripts\release\verify-packaged-menu-cold-start.mjs',
      'scripts\release\verify-packaged-table-caret.mjs',
      'scripts\release\verify-packaged-media-caret.mjs'
    )

    foreach ($relativeScript in $scripts) {
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
    Remove-Item Env:LUMAMARK_EXECUTABLE -ErrorAction SilentlyContinue
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
  executablePath = $executablePath
  uninstallPath = $uninstallPath
  installCommand = $installCommand
  installArguments = $installArguments
  uninstallCommand = $uninstallCommand
  uninstallArguments = $uninstallArguments
  launchSeconds = $LaunchSeconds
  allowExistingInstall = $AllowExistingInstall.IsPresent
  runInstalledAcceptance = $RunInstalledAcceptance.IsPresent
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

if (
  $existingInstallDir -and
  -not (Test-PathUnderRoot -Path $existingInstallDir -Root $smokeRoot) -and
  -not $AllowExistingInstall.IsPresent
) {
  throw "Existing LumaMark install detected at $existingInstallDir. Refusing to mutate a non-smoke installation. Re-run with -AllowExistingInstall for an isolated smoke dir (associations may be rewritten temporarily)."
}

if (Test-Path -LiteralPath $resolvedInstallDir) {
  Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedInstallDir -Force | Out-Null

$installed = $false
$launchedProcess = $null

try {
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
      -ExecutablePath $executablePath
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

  [ordered]@{
    installerKind = $InstallerKind
    installedExecutableLaunched = $true
    installedVersion = $installedVersion
    fileAssociation = $association
    installedAcceptance = $RunInstalledAcceptance.IsPresent
    launchSeconds = $LaunchSeconds
    uninstalled = $true
    installDir = $resolvedInstallDir
  } | ConvertTo-Json -Depth 5
} finally {
  Stop-SmokeApp -Process $launchedProcess

  if ($installed -and -not $KeepInstallOnFailure) {
    if (Test-Path -LiteralPath $uninstallPath) {
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
}
