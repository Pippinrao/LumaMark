"""Timed Typora observation helper. Caller should wrap with timeout."""
from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

VK_CONTROL = 0x11
VK_S = 0x53
VK_OEM_2 = 0xBF  # /
VK_A = 0x41
VK_C = 0x43
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_WHEEL = 0x0800


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def find_typora_hwnd(title_substr: str) -> int:
    found: list[int] = []

    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if title_substr.lower() in buf.value.lower():
            found.append(int(hwnd))
        return True

    user32.EnumWindows(EnumWindowsProc(callback), 0)
    return found[0] if found else 0


def window_rect(hwnd: int) -> RECT:
    rect = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect


def focus(hwnd: int) -> None:
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.25)


def click(x: int, y: int) -> None:
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.04)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.02)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def key_combo(vk_mod: int, vk_key: int) -> None:
    user32.keybd_event(vk_mod, 0, 0, 0)
    user32.keybd_event(vk_key, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(vk_key, 0, 2, 0)
    user32.keybd_event(vk_mod, 0, 2, 0)


def wheel(delta: int = -480) -> None:
    user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "ping"
    hwnd = find_typora_hwnd("gui-test")
    if not hwnd:
        print("NO_WINDOW")
        return 2
    rect = window_rect(hwnd)
    print(f"HWND={hwnd} RECT={rect.left},{rect.top},{rect.right},{rect.bottom}")
    focus(hwnd)

    if action == "ping":
        print("PING_OK")
        return 0

    if action == "scroll":
        cx = (rect.left + rect.right) // 2 + 120
        cy = (rect.top + rect.bottom) // 2
        click(cx, cy)
        time.sleep(0.15)
        for _ in range(8):
            wheel(-240)
            time.sleep(0.06)
        print("SCROLL_OK")
        return 0

    if action == "source":
        cx = int(rect.left + (rect.right - rect.left) * 0.62)
        cy = int(rect.top + (rect.bottom - rect.top) * 0.4)
        click(cx, cy)
        time.sleep(0.15)
        key_combo(VK_CONTROL, VK_OEM_2)
        time.sleep(0.5)
        print("SOURCE_TOGGLE_SENT")
        return 0

    if action == "copyall":
        key_combo(VK_CONTROL, VK_A)
        time.sleep(0.1)
        key_combo(VK_CONTROL, VK_C)
        time.sleep(0.3)
        print("COPYALL_SENT")
        return 0

    if action == "save":
        key_combo(VK_CONTROL, VK_S)
        time.sleep(0.4)
        print("SAVE_SENT")
        return 0

    if action == "checkbox":
        x = int(rect.left + (rect.right - rect.left) * 0.42)
        y = int(rect.top + (rect.bottom - rect.top) * 0.42)
        for dy in (0, 18, 36, -18, 54, 72):
            for dx in (0, -12, 12, -24, -36):
                click(x + dx, y + dy)
                time.sleep(0.05)
        key_combo(VK_CONTROL, VK_S)
        time.sleep(0.5)
        print("CHECKBOX_CLICKS_SENT")
        return 0

    print(f"UNKNOWN_ACTION {action}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
