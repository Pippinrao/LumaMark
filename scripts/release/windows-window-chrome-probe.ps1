[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$TargetProcessId,

  [Parameter(Mandatory = $true)]
  [ValidateSet('State', 'PlaceNormal', 'Click', 'DoubleClick', 'Drag')]
  [string]$Action,

  [int]$X = 0,
  [int]$Y = 0,
  [int]$EndX = 0,
  [int]$EndY = 0,
  [int]$Left = 0,
  [int]$Top = 0,
  [int]$Width = 0,
  [int]$Height = 0
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LumaMarkWindowChromeNative
{
    public const uint GA_ROOT = 2;
    public const uint MONITOR_DEFAULTTONEAREST = 2;
    public const int SW_RESTORE = 9;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_NOOWNERZORDER = 0x0200;
    public const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)]
        public MOUSEINPUT mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT point);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(
        uint flags,
        [MarshalAs(UnmanagedType.Bool)] bool inherit,
        uint desiredAccess);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SwitchDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern uint GetDoubleClickTime();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(
        uint inputCount,
        INPUT[] inputs,
        int inputSize);

    public static string ReadWindowText(IntPtr hWnd)
    {
        var text = new StringBuilder(512);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static void Click(IntPtr expectedWindow, int x, int y)
    {
        AssertInputTarget(expectedWindow, x, y);
        SendClick(x, y);
    }

    public static void DoubleClick(IntPtr expectedWindow, int x, int y)
    {
        AssertInputTarget(expectedWindow, x, y);
        SendClick(x, y);
        var interval = (int)Math.Max(65, Math.Min(120, GetDoubleClickTime() / 4));
        Thread.Sleep(interval);
        AssertInputTarget(expectedWindow, x, y);
        SendClick(x, y);
    }

    public static void Drag(
        IntPtr expectedWindow,
        int startX,
        int startY,
        int endX,
        int endY)
    {
        Move(startX, startY);
        Thread.Sleep(100);
        AssertInputTarget(expectedWindow, startX, startY);
        Button(MOUSEEVENTF_LEFTDOWN);
        try
        {
            Thread.Sleep(130);
            const int steps = 18;
            for (var step = 1; step <= steps; step += 1)
            {
                var ratio = (double)step / steps;
                Move(
                    (int)Math.Round(startX + ((endX - startX) * ratio)),
                    (int)Math.Round(startY + ((endY - startY) * ratio)));
                Thread.Sleep(28);
            }
            Thread.Sleep(90);
        }
        finally
        {
            Button(MOUSEEVENTF_LEFTUP);
        }
    }

    private static void Move(int x, int y)
    {
        SendMouse(CreateMoveInput(x, y));
    }

    private static void SendClick(int x, int y)
    {
        SendMouse(
            CreateMoveInput(x, y),
            CreateButtonInput(MOUSEEVENTF_LEFTDOWN),
            CreateButtonInput(MOUSEEVENTF_LEFTUP));
    }

    private static INPUT CreateMoveInput(int x, int y)
    {
        var virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
        var virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
        var virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        var virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (virtualWidth <= 1 || virtualHeight <= 1)
        {
            throw new InvalidOperationException("The virtual desktop has invalid dimensions.");
        }

        var absoluteX = (int)Math.Round(
            ((double)(x - virtualLeft) * 65535) / (virtualWidth - 1));
        var absoluteY = (int)Math.Round(
            ((double)(y - virtualTop) * 65535) / (virtualHeight - 1));
        return CreateMouseInput(
            absoluteX,
            absoluteY,
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);
    }

    private static void Button(uint flags)
    {
        SendMouse(CreateButtonInput(flags));
    }

    private static INPUT CreateButtonInput(uint flags)
    {
        return CreateMouseInput(0, 0, flags);
    }

    private static INPUT CreateMouseInput(int x, int y, uint flags)
    {
        return new INPUT
        {
            type = INPUT_MOUSE,
            data = new INPUTUNION
            {
                mouse = new MOUSEINPUT
                {
                    dx = x,
                    dy = y,
                    dwFlags = flags,
                    dwExtraInfo = UIntPtr.Zero,
                },
            },
        };
    }

    private static void SendMouse(params INPUT[] inputs)
    {
        var sent = SendInput(
            (uint)inputs.Length,
            inputs,
            Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "SendInput did not inject the complete mouse input sequence.");
        }
    }

    private static void AssertInputTarget(IntPtr expectedWindow, int x, int y)
    {
        var foregroundRoot = GetAncestor(GetForegroundWindow(), GA_ROOT);
        if (foregroundRoot != expectedWindow)
        {
            throw new InvalidOperationException(
                "The target window lost foreground ownership before SendInput.");
        }

        var point = new POINT { X = x, Y = y };
        var hitRoot = GetAncestor(WindowFromPoint(point), GA_ROOT);
        if (hitRoot != expectedWindow)
        {
            throw new InvalidOperationException(
                "WindowFromPoint changed before SendInput reached the target.");
        }
    }
}
'@

function Get-WindowProcessId {
  param([IntPtr]$Window)

  [uint32]$owner = 0
  [void][LumaMarkWindowChromeNative]::GetWindowThreadProcessId($Window, [ref]$owner)
  return [int]$owner
}

function Get-InputDesktopAvailable {
  $desktop = [LumaMarkWindowChromeNative]::OpenInputDesktop(
    0,
    $false,
    [LumaMarkWindowChromeNative]::DESKTOP_SWITCHDESKTOP
  )
  if ($desktop -eq [IntPtr]::Zero) {
    return $false
  }

  try {
    return [LumaMarkWindowChromeNative]::SwitchDesktop($desktop)
  }
  finally {
    [void][LumaMarkWindowChromeNative]::CloseDesktop($desktop)
  }
}

function Get-WindowSnapshot {
  param(
    [System.Diagnostics.Process]$Process,
    [IntPtr]$Window,
    [object]$HitX = $null,
    [object]$HitY = $null
  )

  $client = New-Object LumaMarkWindowChromeNative+RECT
  if (-not [LumaMarkWindowChromeNative]::GetClientRect($Window, [ref]$client)) {
    throw [ComponentModel.Win32Exception]::new(
      [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
      'GetClientRect failed.'
    )
  }

  $topLeft = New-Object LumaMarkWindowChromeNative+POINT
  $topLeft.X = $client.Left
  $topLeft.Y = $client.Top
  if (-not [LumaMarkWindowChromeNative]::ClientToScreen($Window, [ref]$topLeft)) {
    throw [ComponentModel.Win32Exception]::new(
      [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
      'ClientToScreen failed for the client top-left point.'
    )
  }

  $bottomRight = New-Object LumaMarkWindowChromeNative+POINT
  $bottomRight.X = $client.Right
  $bottomRight.Y = $client.Bottom
  if (-not [LumaMarkWindowChromeNative]::ClientToScreen($Window, [ref]$bottomRight)) {
    throw [ComponentModel.Win32Exception]::new(
      [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
      'ClientToScreen failed for the client bottom-right point.'
    )
  }

  $monitor = [LumaMarkWindowChromeNative]::MonitorFromWindow(
    $Window,
    [LumaMarkWindowChromeNative]::MONITOR_DEFAULTTONEAREST
  )
  $monitorInfo = New-Object LumaMarkWindowChromeNative+MONITORINFO
  $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
  if (-not [LumaMarkWindowChromeNative]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
    throw [ComponentModel.Win32Exception]::new(
      [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
      'GetMonitorInfo failed.'
    )
  }

  $foreground = [LumaMarkWindowChromeNative]::GetForegroundWindow()
  $foregroundRoot = if ($foreground -eq [IntPtr]::Zero) {
    [IntPtr]::Zero
  }
  else {
    [LumaMarkWindowChromeNative]::GetAncestor(
      $foreground,
      [LumaMarkWindowChromeNative]::GA_ROOT
    )
  }
  $foregroundProcessId = if ($foregroundRoot -eq [IntPtr]::Zero) {
    0
  }
  else {
    Get-WindowProcessId -Window $foregroundRoot
  }

  $hit = $null
  if ($null -ne $HitX -and $null -ne $HitY) {
    $hitXValue = [int]$HitX
    $hitYValue = [int]$HitY
    $point = New-Object LumaMarkWindowChromeNative+POINT
    $point.X = $hitXValue
    $point.Y = $hitYValue
    $hitWindow = [LumaMarkWindowChromeNative]::WindowFromPoint($point)
    $hitRoot = if ($hitWindow -eq [IntPtr]::Zero) {
      [IntPtr]::Zero
    }
    else {
      [LumaMarkWindowChromeNative]::GetAncestor(
        $hitWindow,
        [LumaMarkWindowChromeNative]::GA_ROOT
      )
    }
    $hit = [ordered]@{
      x = $hitXValue
      y = $hitYValue
      hwnd = [int64]$hitWindow
      rootHwnd = [int64]$hitRoot
      processId = if ($hitRoot -eq [IntPtr]::Zero) {
        0
      }
      else {
        Get-WindowProcessId -Window $hitRoot
      }
    }
  }

  return [ordered]@{
    targetPid = $Process.Id
    hwnd = [int64]$Window
    executablePath = $Process.Path
    visible = [LumaMarkWindowChromeNative]::IsWindowVisible($Window)
    zoomed = [LumaMarkWindowChromeNative]::IsZoomed($Window)
    dpi = [int][LumaMarkWindowChromeNative]::GetDpiForWindow($Window)
    inputDesktopAvailable = Get-InputDesktopAvailable
    clientRect = [ordered]@{
      left = $topLeft.X
      top = $topLeft.Y
      right = $bottomRight.X
      bottom = $bottomRight.Y
      width = $bottomRight.X - $topLeft.X
      height = $bottomRight.Y - $topLeft.Y
    }
    workArea = [ordered]@{
      left = $monitorInfo.rcWork.Left
      top = $monitorInfo.rcWork.Top
      right = $monitorInfo.rcWork.Right
      bottom = $monitorInfo.rcWork.Bottom
      width = $monitorInfo.rcWork.Right - $monitorInfo.rcWork.Left
      height = $monitorInfo.rcWork.Bottom - $monitorInfo.rcWork.Top
    }
    foreground = [ordered]@{
      hwnd = [int64]$foreground
      rootHwnd = [int64]$foregroundRoot
      processId = $foregroundProcessId
      title = if ($foregroundRoot -eq [IntPtr]::Zero) {
        ''
      }
      else {
        [LumaMarkWindowChromeNative]::ReadWindowText($foregroundRoot)
      }
    }
    hitTest = $hit
  }
}

function Assert-InteractiveSnapshot {
  param(
    [System.Collections.IDictionary]$Snapshot,
    [bool]$RequireHit
  )

  if (-not $Snapshot.inputDesktopAvailable) {
    throw 'The interactive input desktop is unavailable (the session may be locked or on a secure desktop).'
  }
  if ($Snapshot.foreground.rootHwnd -ne $Snapshot.hwnd -or
      $Snapshot.foreground.processId -ne $Snapshot.targetPid) {
    throw (
      'The exact LumaMark child window is not foreground. ' +
      "targetPid=$($Snapshot.targetPid), foregroundPid=$($Snapshot.foreground.processId), " +
      "foregroundTitle='$($Snapshot.foreground.title)'."
    )
  }
  if ($RequireHit -and
      ($null -eq $Snapshot.hitTest -or
       $Snapshot.hitTest.rootHwnd -ne $Snapshot.hwnd -or
       $Snapshot.hitTest.processId -ne $Snapshot.targetPid)) {
    throw (
      'WindowFromPoint did not resolve to the exact LumaMark child window. ' +
      "targetPid=$($Snapshot.targetPid), hitPid=$($Snapshot.hitTest.processId), " +
      "point=($($Snapshot.hitTest.x),$($Snapshot.hitTest.y))."
    )
  }
}

$previousDpiContext = [LumaMarkWindowChromeNative]::SetThreadDpiAwarenessContext(
  [IntPtr](-4)
)
if ($previousDpiContext -eq [IntPtr]::Zero) {
  throw [ComponentModel.Win32Exception]::new(
    [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
    'SetThreadDpiAwarenessContext failed.'
  )
}

try {
  $target = Get-Process -Id $TargetProcessId -ErrorAction Stop
  $target.Refresh()
  $window = $target.MainWindowHandle
  if ($window -eq [IntPtr]::Zero -or
      -not [LumaMarkWindowChromeNative]::IsWindow($window)) {
    throw "Process $TargetProcessId does not own a usable top-level window."
  }
  if ((Get-WindowProcessId -Window $window) -ne $TargetProcessId) {
    throw "The selected HWND is not owned by exact child PID $TargetProcessId."
  }

  switch ($Action) {
    'PlaceNormal' {
      if ($Width -le 0 -or $Height -le 0) {
        throw 'PlaceNormal requires positive Width and Height values.'
      }
      [void][LumaMarkWindowChromeNative]::ShowWindowAsync(
        $window,
        [LumaMarkWindowChromeNative]::SW_RESTORE
      )
      Start-Sleep -Milliseconds 200
      $placed = [LumaMarkWindowChromeNative]::SetWindowPos(
        $window,
        [IntPtr]::Zero,
        $Left,
        $Top,
        $Width,
        $Height,
        [LumaMarkWindowChromeNative]::SWP_NOZORDER -bor
          [LumaMarkWindowChromeNative]::SWP_NOOWNERZORDER -bor
          [LumaMarkWindowChromeNative]::SWP_SHOWWINDOW
      )
      if (-not $placed) {
        throw [ComponentModel.Win32Exception]::new(
          [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
          'SetWindowPos failed while establishing the normal placement.'
        )
      }
      Start-Sleep -Milliseconds 250
      [void][LumaMarkWindowChromeNative]::SetForegroundWindow($window)
      Start-Sleep -Milliseconds 300
      $snapshot = Get-WindowSnapshot -Process $target -Window $window
      Assert-InteractiveSnapshot -Snapshot $snapshot -RequireHit $false
    }
    'Click' {
      $snapshot = Get-WindowSnapshot -Process $target -Window $window -HitX $X -HitY $Y
      Assert-InteractiveSnapshot -Snapshot $snapshot -RequireHit $true
      [LumaMarkWindowChromeNative]::Click($window, $X, $Y)
      Start-Sleep -Milliseconds 300
      $snapshot = Get-WindowSnapshot -Process $target -Window $window
    }
    'DoubleClick' {
      $snapshot = Get-WindowSnapshot -Process $target -Window $window -HitX $X -HitY $Y
      Assert-InteractiveSnapshot -Snapshot $snapshot -RequireHit $true
      [LumaMarkWindowChromeNative]::DoubleClick($window, $X, $Y)
      Start-Sleep -Milliseconds 700
      $snapshot = Get-WindowSnapshot -Process $target -Window $window
    }
    'Drag' {
      $snapshot = Get-WindowSnapshot -Process $target -Window $window -HitX $X -HitY $Y
      Assert-InteractiveSnapshot -Snapshot $snapshot -RequireHit $true
      [LumaMarkWindowChromeNative]::Drag(
        $window,
        $X,
        $Y,
        $EndX,
        $EndY
      )
      Start-Sleep -Milliseconds 700
      $snapshot = Get-WindowSnapshot -Process $target -Window $window
    }
    default {
      $snapshot = Get-WindowSnapshot -Process $target -Window $window
    }
  }

  $snapshot['action'] = $Action
  $snapshot | ConvertTo-Json -Compress -Depth 7
}
finally {
  if ($previousDpiContext -ne [IntPtr]::Zero) {
    [void][LumaMarkWindowChromeNative]::SetThreadDpiAwarenessContext(
      $previousDpiContext
    )
  }
}
