# Real installed-app acceptance WITHOUT remote-debugging or temp WebView2 profile.
# Launches the installed exe exactly as Explorer would, then drives Win32 mouse clicks
# + screenshot pixel checks (WebView2 content is opaque to classic UIA).

param(
  [string]$ExecutablePath = 'C:\Users\pippin\AppData\Local\LumaMark\lumamark.exe',
  [string]$ArtifactDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not (Test-Path -LiteralPath $ExecutablePath)) {
  throw "Installed executable not found: $ExecutablePath"
}

if (-not $ArtifactDir) {
  $ArtifactDir = Join-Path $env:TEMP ('lumamark-real-install-' + [guid]::NewGuid().ToString('N'))
}
New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeUi {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("Shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const int SW_RESTORE = 9;
  public const uint MONITOR_DEFAULTTONEAREST = 2;
}
"@

# PowerShell hosts are often DPI-unaware; without this, SetCursorPos misses the real window.
[void][NativeUi]::SetProcessDPIAware()

function Stop-LumaMark {
  Get-Process lumamark -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

function Get-WindowRectObj([IntPtr]$Hwnd) {
  $rect = New-Object NativeUi+RECT
  if (-not [NativeUi]::GetWindowRect($Hwnd, [ref]$rect)) {
    throw 'GetWindowRect failed.'
  }
  return $rect
}

function Save-WindowScreenshot([IntPtr]$Hwnd, [string]$Path) {
  $rect = Get-WindowRectObj $Hwnd
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  [void][NativeUi]::PrintWindow($Hwnd, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  return @{ Width = $width; Height = $height; Left = $rect.Left; Top = $rect.Top }
}

function Invoke-ScreenClick([int]$ScreenX, [int]$ScreenY) {
  [void][NativeUi]::SetCursorPos($ScreenX, $ScreenY)
  Start-Sleep -Milliseconds 80
  [NativeUi]::mouse_event([NativeUi]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [NativeUi]::mouse_event([NativeUi]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

function Get-RegionAverageLuminance([string]$ImagePath, [int]$Left, [int]$Top, [int]$Right, [int]$Bottom) {
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $sum = 0.0
    $n = 0
    for ($x = [Math]::Max(0, $Left); $x -lt [Math]::Min($img.Width, $Right); $x += 8) {
      for ($y = [Math]::Max(0, $Top); $y -lt [Math]::Min($img.Height, $Bottom); $y += 8) {
        $c = $img.GetPixel($x, $y)
        $sum += ($c.R * 0.3) + ($c.G * 0.59) + ($c.B * 0.11)
        $n++
      }
    }
    if ($n -eq 0) { return 0 }
    return [math]::Round($sum / $n, 1)
  }
  finally {
    $img.Dispose()
  }
}

function Test-ImageContainsDarkPopupNear([string]$ImagePath, [int]$NearX, [int]$NearY) {
  # Open Radix menus usually paint a surface card below the trigger.
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $x0 = [Math]::Max(0, $NearX - 40)
    $x1 = [Math]::Min($img.Width - 1, $NearX + 180)
    $y0 = [Math]::Max(0, $NearY + 8)
    $y1 = [Math]::Min($img.Height - 1, $NearY + 220)
    $borderish = 0
    for ($x = $x0; $x -le $x1; $x += 4) {
      for ($y = $y0; $y -le $y1; $y += 4) {
        $c = $img.GetPixel($x, $y)
        # Menu panel is usually slightly darker/lighter than pure white editor bg,
        # with borders; count non-near-white pixels in the popup band.
        if ($c.R -lt 245 -or $c.G -lt 245 -or $c.B -lt 245) {
          if ($c.R -gt 20 -or $c.G -gt 20 -or $c.B -gt 20) {
            $borderish++
          }
        }
      }
    }
    return $borderish -gt 80
  }
  finally {
    $img.Dispose()
  }
}

Stop-LumaMark

# Ensure this process does not inherit debug/temp profile overrides into the child.
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
Remove-Item Env:WEBVIEW2_BROWSER_ARGS_APPEND -ErrorAction SilentlyContinue

$probeDir = Join-Path $ArtifactDir 'files'
New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
$mdPath = Join-Path $probeDir 'real-install-probe.md'
@(
  '# Real Install Probe'
  ''
  '| ColA | ColB |'
  '| --- | --- |'
  '| alpha | beta |'
  '| gamma | delta |'
  ''
  'cursor-marker-line'
) | Set-Content -Path $mdPath -Encoding utf8

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $ExecutablePath
$startInfo.Arguments = "`"$mdPath`""
$startInfo.WorkingDirectory = (Split-Path -Parent $ExecutablePath)
$startInfo.UseShellExecute = $true
# Explicitly do not pass WEBVIEW2_* — UseShellExecute starts a clean user launch.
$proc = [System.Diagnostics.Process]::Start($startInfo)
if ($null -eq $proc) { throw 'Failed to start installed LumaMark.' }

for ($i = 0; $i -lt 60; $i++) {
  $proc.Refresh()
  if ($proc.HasExited) { throw "Installed app exited early with code $($proc.ExitCode)." }
  if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 500
}
if ($proc.MainWindowHandle -eq [IntPtr]::Zero) {
  throw 'Installed app did not create a main window.'
}

Start-Sleep -Seconds 4
$hwnd = $proc.MainWindowHandle
[void][NativeUi]::ShowWindow($hwnd, [NativeUi]::SW_RESTORE)
[void][NativeUi]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500

# Move window to a stable on-screen position so DPI/edge clipping doesn't hide chrome.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeMove {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
$rect0 = Get-WindowRectObj $hwnd
[void][NativeMove]::MoveWindow($hwnd, 120, 80, ($rect0.Right - $rect0.Left), ($rect0.Bottom - $rect0.Top), $true)
Start-Sleep -Milliseconds 400
[void][NativeUi]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 300

$shot1 = Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '01-after-launch.png')
$editorLum1 = Get-RegionAverageLuminance (Join-Path $ArtifactDir '01-after-launch.png') 350 180 1100 700

$result = [ordered]@{
  mode = 'real-installed-no-debug-port-no-temp-profile'
  executablePath = $ExecutablePath
  fileVersion = (Get-Item $ExecutablePath).VersionInfo.FileVersion
  launchedWith = $mdPath
  pid = $proc.Id
  window = $shot1
  editorLuminanceBefore = $editorLum1
  dpiAware = $true
  envCheck = [ordered]@{
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [bool]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    WEBVIEW2_USER_DATA_FOLDER = [bool]$env:WEBVIEW2_USER_DATA_FOLDER
  }
  steps = @()
  failures = @()
}

# File open evidence: titlebar/status in screenshot should not look like start-screen-only.
# Start screen has large empty center; opened doc has table/editor content (lower avg white? actually light theme editor is also white).
# Use status-bar text band + presence of non-white structure in mid-left sidebar + editor.
$sidebarStructure = Test-ImageContainsDarkPopupNear (Join-Path $ArtifactDir '01-after-launch.png') 80 180
if ($sidebarStructure) {
  $result.steps += 'launch-shows-sidebar-structure'
} else {
  $result.failures += 'After argv launch, sidebar/editor structure not visible in screenshot (file may not have opened).'
}

function Get-MenuCentersFromScreenshot([string]$ImagePath) {
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $inkXs = New-Object System.Collections.Generic.List[int]
    for ($y = 24; $y -le 36; $y++) {
      for ($x = 20; $x -lt [Math]::Min(700, $img.Width); $x++) {
        $c = $img.GetPixel($x, $y)
        $lum = ($c.R * 0.3) + ($c.G * 0.59) + ($c.B * 0.11)
        if ($lum -lt 130) { [void]$inkXs.Add($x) }
      }
    }
    $sorted = $inkXs | Sort-Object -Unique
    $centers = @()
    $start = $null
    $prev = $null
    foreach ($x in $sorted) {
      if ($null -eq $start) { $start = $x; $prev = $x; continue }
      if ($x - $prev -gt 10) {
        if (($prev - $start) -gt 8) { $centers += [int](($start + $prev) / 2) }
        $start = $x
      }
      $prev = $x
    }
    if ($null -ne $start -and ($prev - $start) -gt 8) {
      $centers += [int](($start + $prev) / 2)
    }
    return $centers
  }
  finally {
    $img.Dispose()
  }
}

function Get-PopupItemCenters([string]$ImagePath, [int]$NearX) {
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $rows = @()
    $x0 = [Math]::Max(0, $NearX - 40)
    $x1 = [Math]::Min($img.Width - 1, $NearX + 280)
    # Skip menubar ink (y<55); only score dropdown body.
    for ($y = 55; $y -lt [Math]::Min(240, $img.Height); $y++) {
      $inks = 0
      $xmin = 99999
      $xmax = 0
      for ($x = $x0; $x -le $x1; $x++) {
        $c = $img.GetPixel($x, $y)
        $lum = ($c.R * 0.3) + ($c.G * 0.59) + ($c.B * 0.11)
        if ($lum -lt 90) {
          $inks++
          if ($x -lt $xmin) { $xmin = $x }
          if ($x -gt $xmax) { $xmax = $x }
        }
      }
      if ($inks -gt 8) {
        $rows += [pscustomobject]@{ Y = $y; N = $inks; X = [int](($xmin + $xmax) / 2) }
      }
    }
    $items = @()
    $start = $null
    $prev = $null
    $xs = @()
    foreach ($row in $rows) {
      if ($null -eq $start) {
        $start = $row.Y
        $prev = $row.Y
        $xs = @($row.X)
        continue
      }
      if ($row.Y - $prev -gt 8) {
        $items += [pscustomobject]@{ Y = [int](($start + $prev) / 2); X = [int](($xs | Measure-Object -Average).Average) }
        $start = $row.Y
        $xs = @($row.X)
      } else {
        $xs += $row.X
      }
      $prev = $row.Y
    }
    if ($null -ne $start) {
      $items += [pscustomobject]@{ Y = [int](($start + $prev) / 2); X = [int](($xs | Measure-Object -Average).Average) }
    }
    return $items
  }
  finally {
    $img.Dispose()
  }
}

function Get-TableCellTarget([string]$ImagePath) {
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $borderYs = @()
    for ($y = 250; $y -lt [Math]::Min(700, $img.Height); $y++) {
      $gray = 0
      for ($x = 300; $x -lt 750; $x++) {
        $c = $img.GetPixel($x, $y)
        if ([Math]::Abs($c.R - $c.G) -lt 6 -and [Math]::Abs($c.G - $c.B) -lt 6 -and $c.R -gt 190 -and $c.R -lt 235) {
          $gray++
        }
      }
      if ($gray -gt 60) { $borderYs += $y }
    }
    # Cluster contiguous border scanlines into distinct table rules.
    $clusters = @()
    $start = $null
    $prev = $null
    foreach ($y in $borderYs) {
      if ($null -eq $start) { $start = $y; $prev = $y; continue }
      if ($y - $prev -gt 3) {
        $clusters += [int](($start + $prev) / 2)
        $start = $y
      }
      $prev = $y
    }
    if ($null -ne $start) { $clusters += [int](($start + $prev) / 2) }
    if ($clusters.Count -lt 2) { return $null }
    # First data row is between border[1] (below header) and border[2], or mid of first gap after header.
    if ($clusters.Count -ge 3) {
      $y = [int](($clusters[1] + $clusters[2]) / 2)
    } else {
      $y = [int](($clusters[0] + $clusters[1]) / 2)
    }
    return @{ X = 540; Y = $y }
  }
  finally {
    $img.Dispose()
  }
}

try {
  $rect = Get-WindowRectObj $hwnd
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top

  # Calibrate from the real screenshot ink clusters (zh menubar).
  # Expected order: 文件 编辑 段落 格式 视图 主题 语言 帮助
  $centers = @(Get-MenuCentersFromScreenshot (Join-Path $ArtifactDir '01-after-launch.png'))
  $result.menuCenters = $centers
  if ($centers.Count -lt 8) {
    throw "Failed to calibrate 8 menu centers from screenshot (got $($centers.Count)): $($centers -join ',')"
  }

  $menuY = [int]($rect.Top + 30)
  $menuMap = [ordered]@{
    file = $centers[0]
    edit = $centers[1]
    paragraph = $centers[2]
    format = $centers[3]
    view = $centers[4]
    theme = $centers[5]
    language = $centers[6]
    help = $centers[7]
  }

  function Click-Menu([string]$Name) {
    $x = [int]($rect.Left + $menuMap[$Name])
    Invoke-ScreenClick -ScreenX $x -ScreenY $menuY
    return @{ X = $x; Y = $menuY }
  }

  function Click-PopupItem([string]$ShotPath, [int]$NearX, [int]$Index) {
    $items = @(Get-PopupItemCenters -ImagePath $ShotPath -NearX $NearX)
    if ($items.Count -le $Index) {
      throw "Popup item index $Index not found in $ShotPath (found $($items.Count))."
    }
    $item = $items[$Index]
    $sx = [int]($rect.Left + $item.X)
    $sy = [int]($rect.Top + $item.Y)
    Invoke-ScreenClick -ScreenX $sx -ScreenY $sy
    return $item
  }

  # --- Theme menu ---
  $themeClick = Click-Menu 'theme'
  Start-Sleep -Milliseconds 700
  Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '02-theme-menu.png') | Out-Null
  $themePopup = Test-ImageContainsDarkPopupNear (Join-Path $ArtifactDir '02-theme-menu.png') ($themeClick.X - $rect.Left) ($themeClick.Y - $rect.Top)
  if ($themePopup) {
    $result.steps += 'theme-menu-opened'
  } else {
    $result.failures += 'Theme menu click produced no visible popup (possible drag-region / dead click).'
  }

  # Prefer keyboard selection inside open Radix menu (more reliable than synthetic item clicks in WebView2).
  [void][NativeUi]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 1000
  Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '03-after-dark.png') | Out-Null
  $lumAfterThemeTry = Get-RegionAverageLuminance (Join-Path $ArtifactDir '03-after-dark.png') 280 140 900 520
  $result.editorLuminanceAfterTheme = $lumAfterThemeTry
  if (($editorLum1 - $lumAfterThemeTry) -ge 40) {
    $result.steps += 'theme-darkened-editor'
  } else {
    # Fallback: click calibrated Dark item if keyboard did not apply.
    try {
      Click-Menu 'theme' | Out-Null
      Start-Sleep -Milliseconds 500
      Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '02b-theme-menu.png') | Out-Null
      $darkItem = Click-PopupItem (Join-Path $ArtifactDir '02b-theme-menu.png') $menuMap.theme 1
      $result.themeDarkClick = $darkItem
      Start-Sleep -Milliseconds 1000
      Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '03b-after-dark.png') | Out-Null
      $lumAfterThemeTry = Get-RegionAverageLuminance (Join-Path $ArtifactDir '03b-after-dark.png') 280 140 900 520
      $result.editorLuminanceAfterTheme = $lumAfterThemeTry
    } catch {
      $result.failures += $_.Exception.Message
    }
    if (($editorLum1 - $lumAfterThemeTry) -ge 40) {
      $result.steps += 'theme-darkened-editor'
      # remove prior failure if any added later — checked below
    } else {
      $result.failures += "Theme click did not darken editor (before=$editorLum1 after=$lumAfterThemeTry)."
    }
  }

  # --- Language: Chinese(0) English(1)
  $langClick = Click-Menu 'language'
  Start-Sleep -Milliseconds 700
  Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '04-language-menu.png') | Out-Null
  $langPopup = Test-ImageContainsDarkPopupNear (Join-Path $ArtifactDir '04-language-menu.png') ($langClick.X - $rect.Left) ($langClick.Y - $rect.Top)
  if ($langPopup) {
    $result.steps += 'language-menu-opened'
    [void][NativeUi]::SetForegroundWindow($hwnd)
    [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 900
    Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '05-after-language.png') | Out-Null
    $result.steps += 'language-english-clicked'
  } else {
    $result.failures += 'Language menu click produced no visible popup.'
  }

  # --- Help / About
  $helpClick = Click-Menu 'help'
  Start-Sleep -Milliseconds 700
  Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '06-help-menu.png') | Out-Null
  $helpPopup = Test-ImageContainsDarkPopupNear (Join-Path $ArtifactDir '06-help-menu.png') ($helpClick.X - $rect.Left) ($helpClick.Y - $rect.Top)
  if ($helpPopup) {
    $result.steps += 'help-menu-opened'
    [void][NativeUi]::SetForegroundWindow($hwnd)
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 1100
    Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '07-about.png') | Out-Null
    $aboutPopup = Test-ImageContainsDarkPopupNear (Join-Path $ArtifactDir '07-about.png') ([int]($w * 0.5)) ([int]($h * 0.4))
    $centerLum = Get-RegionAverageLuminance (Join-Path $ArtifactDir '07-about.png') ([int]($w * 0.35)) ([int]($h * 0.3)) ([int]($w * 0.65)) ([int]($h * 0.7))
    $refLum = if (($editorLum1 - $lumAfterThemeTry) -ge 40) { $lumAfterThemeTry } else { $editorLum1 }
    if ($aboutPopup -or ($centerLum -lt ($refLum - 15))) {
      $result.steps += 'about-dialog-visible'
    } else {
      $result.failures += 'Help/About click did not show a dialog overlay.'
    }
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 400
  } else {
    $result.failures += 'Help menu click produced no visible popup.'
  }

  # --- Table cell click + type (caret smoke) ---
  $cell = Get-TableCellTarget (Join-Path $ArtifactDir '01-after-launch.png')
  if ($null -eq $cell) {
    $result.failures += 'Could not locate table cell target from screenshot.'
  } else {
    $result.tableClick = $cell
    $cellX = [int]($rect.Left + $cell.X)
    $cellY = [int]($rect.Top + $cell.Y)
    Invoke-ScreenClick -ScreenX $cellX -ScreenY $cellY
    Start-Sleep -Milliseconds 250
    Invoke-ScreenClick -ScreenX $cellX -ScreenY $cellY
    Start-Sleep -Milliseconds 80
    Invoke-ScreenClick -ScreenX $cellX -ScreenY $cellY
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('Z')
    Start-Sleep -Milliseconds 500
    Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '08-after-table-type.png') | Out-Null
    $result.steps += 'table-cell-typed-z'
    [System.Windows.Forms.SendKeys]::SendWait('^s')
    Start-Sleep -Milliseconds 1500
    $saved = Get-Content -LiteralPath $mdPath -Raw -ErrorAction SilentlyContinue
    if ($saved -match 'Z') {
      $result.steps += 'table-edit-persisted-to-file'
    } else {
      $result.failures += 'Typed Z in table cell did not persist to markdown file after Ctrl+S (caret/edit path may be broken).'
      if ($null -ne $saved) {
        $result.savedFilePreview = $saved.Substring(0, [Math]::Min(240, $saved.Length))
      }
    }
  }

  # Best-effort restore user prefs on real profile: light theme + Chinese.
  try {
    Click-Menu 'theme' | Out-Null
    Start-Sleep -Milliseconds 500
    Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '09-restore-theme-menu.png') | Out-Null
    Click-PopupItem (Join-Path $ArtifactDir '09-restore-theme-menu.png') $menuMap.theme 0 | Out-Null
    Start-Sleep -Milliseconds 400
    Click-Menu 'language' | Out-Null
    Start-Sleep -Milliseconds 500
    Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir '10-restore-language-menu.png') | Out-Null
    Click-PopupItem (Join-Path $ArtifactDir '10-restore-language-menu.png') $menuMap.language 0 | Out-Null
    $result.steps += 'prefs-restored-light-zh'
  } catch {
    $result.failures += "Preference restore failed: $($_.Exception.Message)"
  }
}
catch {
  $result.failures += $_.Exception.Message
  try { Save-WindowScreenshot -Hwnd $hwnd -Path (Join-Path $ArtifactDir 'failure.png') | Out-Null } catch {}
}

$result.artifactDir = $ArtifactDir
$result | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $ArtifactDir 'result.json') -Encoding utf8
$result | ConvertTo-Json -Depth 8

Start-Sleep -Seconds 1
Stop-LumaMark

if ($result.failures.Count -gt 0) { exit 1 }
exit 0
