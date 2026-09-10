# Enumerates the top-level windows of one process as JSON.
#
# `Get-Process.MainWindowHandle` is not precise enough for the automation
# acceptance: tao publishes an internal "Tao Thread Event Target" window that
# counts as a main window, while the real renderer window stays hidden.
param([Parameter(Mandatory = $true)][int]$TargetProcessId)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LumaMarkWindowProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
}
"@

$windows = New-Object System.Collections.ArrayList
$callback = [LumaMarkWindowProbe+EnumWindowsProc] {
  param($hWnd, $lParam)

  $processId = 0
  [void][LumaMarkWindowProbe]::GetWindowThreadProcessId($hWnd, [ref]$processId)
  if ($processId -eq $TargetProcessId) {
    $title = New-Object System.Text.StringBuilder 512
    [void][LumaMarkWindowProbe]::GetWindowTextW($hWnd, $title, 512)
    $class = New-Object System.Text.StringBuilder 512
    [void][LumaMarkWindowProbe]::GetClassNameW($hWnd, $class, 512)
    $owner = [LumaMarkWindowProbe]::GetWindow($hWnd, 4)

    [void]$windows.Add([pscustomobject]@{
      handle = $hWnd.ToInt64()
      visible = [LumaMarkWindowProbe]::IsWindowVisible($hWnd)
      title = $title.ToString()
      className = $class.ToString()
      hasOwner = ($owner -ne [IntPtr]::Zero)
    })
  }

  return $true
}

[void][LumaMarkWindowProbe]::EnumWindows($callback, [IntPtr]::Zero)
ConvertTo-Json -InputObject @($windows) -Compress -Depth 4
