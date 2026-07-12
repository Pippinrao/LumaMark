"""DPI-aware SendInput helpers with hard wall-clock timeout via caller."""
from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

user32 = ctypes.windll.user32

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000
VK_RETURN = 0x0D
VK_SHIFT = 0x10
VK_CONTROL = 0x11
VK_MENU = 0x12
VK_END = 0x23
VK_HOME = 0x24
VK_LEFT = 0x25
VK_UP = 0x26
VK_RIGHT = 0x27
VK_DOWN = 0x28
VK_S = 0x53
VK_C = 0x43
VK_A = 0x41
VK_OEM_2 = 0xBF


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", INPUT_UNION)]


EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def find_hwnd(title: str) -> int:
    found: list[int] = []

    def cb(hwnd, _lp):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                b = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, b, n + 1)
                if title.lower() in b.value.lower():
                    found.append(int(hwnd))
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found[0] if found else 0


def send_inputs(inputs: list[INPUT]) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    sent = user32.SendInput(len(inputs), ctypes.byref(arr), ctypes.sizeof(INPUT))
    if sent != len(inputs):
        raise RuntimeError(f"SendInput sent {sent}/{len(inputs)}")


def key_down(vk: int) -> INPUT:
    i = INPUT()
    i.type = INPUT_KEYBOARD
    i.union.ki = KEYBDINPUT(vk, 0, 0, 0, None)
    return i


def key_up(vk: int) -> INPUT:
    i = INPUT()
    i.type = INPUT_KEYBOARD
    i.union.ki = KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP, 0, None)
    return i


def tap(vk: int) -> None:
    send_inputs([key_down(vk), key_up(vk)])
    time.sleep(0.05)


def combo(*vks: int) -> None:
    downs = [key_down(vk) for vk in vks]
    ups = [key_up(vk) for vk in reversed(vks)]
    send_inputs(downs + ups)
    time.sleep(0.08)


def type_unicode(text: str) -> None:
    inputs: list[INPUT] = []
    for ch in text:
        down = INPUT()
        down.type = INPUT_KEYBOARD
        down.union.ki = KEYBDINPUT(0, ord(ch), KEYEVENTF_UNICODE, 0, None)
        up = INPUT()
        up.type = INPUT_KEYBOARD
        up.union.ki = KEYBDINPUT(0, ord(ch), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, None)
        inputs.extend([down, up])
    if inputs:
        send_inputs(inputs)
        time.sleep(0.05)


def click_abs(x: int, y: int) -> None:
    sw = user32.GetSystemMetrics(0)
    sh = user32.GetSystemMetrics(1)
    ax = int(x * 65535 / max(sw - 1, 1))
    ay = int(y * 65535 / max(sh - 1, 1))
    move = INPUT()
    move.type = INPUT_MOUSE
    move.union.mi = MOUSEINPUT(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0, None)
    down = INPUT()
    down.type = INPUT_MOUSE
    down.union.mi = MOUSEINPUT(0, 0, 0, MOUSEEVENTF_LEFTDOWN, 0, None)
    up = INPUT()
    up.type = INPUT_MOUSE
    up.union.mi = MOUSEINPUT(0, 0, 0, MOUSEEVENTF_LEFTUP, 0, None)
    send_inputs([move, down, up])
    time.sleep(0.08)


def focus(title: str) -> tuple[int, RECT]:
    hwnd = find_hwnd(title)
    if not hwnd:
        raise SystemExit(f"NO_WINDOW:{title}")
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.35)
    rect = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return hwnd, rect


def main() -> int:
    action = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else "break-test"
    hwnd, rect = focus(title)
    print(f"HWND={hwnd} RECT={rect.left},{rect.top},{rect.right},{rect.bottom}")

    if action == "ping":
        print("PING_OK")
        return 0

    if action == "click-center":
        cx = (rect.left + rect.right) // 2
        cy = (rect.top + rect.bottom) // 2 + 40
        click_abs(cx, cy)
        print(f"CLICKED {cx},{cy}")
        return 0

    if action == "click-xy":
        x, y = int(sys.argv[3]), int(sys.argv[4])
        click_abs(x, y)
        print(f"CLICKED {x},{y}")
        return 0

    if action == "return-new-para":
        # Click near LINE_A, go to end of first paragraph, Return, type marker
        cx = rect.left + int((rect.right - rect.left) * 0.45)
        cy = rect.top + int((rect.bottom - rect.top) * 0.28)
        click_abs(cx, cy)
        time.sleep(0.2)
        tap(VK_HOME)
        # move to end of LINE_A_MARKER line
        for _ in range(40):
            tap(VK_RIGHT)
        tap(VK_RETURN)
        type_unicode("RETURN_PARA_MARKER")
        combo(VK_CONTROL, VK_S)
        time.sleep(0.5)
        print("RETURN_PARA_DONE")
        return 0

    if action == "shift-return":
        cx = rect.left + int((rect.right - rect.left) * 0.45)
        cy = rect.top + int((rect.bottom - rect.top) * 0.28)
        click_abs(cx, cy)
        time.sleep(0.2)
        tap(VK_HOME)
        for _ in range(40):
            tap(VK_RIGHT)
        combo(VK_SHIFT, VK_RETURN)
        type_unicode("SHIFT_BR_MARKER")
        combo(VK_CONTROL, VK_S)
        time.sleep(0.5)
        print("SHIFT_RETURN_DONE")
        return 0

    if action == "source-toggle":
        combo(VK_CONTROL, VK_OEM_2)
        time.sleep(0.4)
        print("SOURCE_TOGGLED")
        return 0

    if action == "save":
        combo(VK_CONTROL, VK_S)
        time.sleep(0.4)
        print("SAVED")
        return 0

    if action == "copy-all":
        combo(VK_CONTROL, VK_A)
        time.sleep(0.1)
        combo(VK_CONTROL, VK_C)
        time.sleep(0.2)
        print("COPIED")
        return 0

    if action == "menu-edit":
        # Alt+E open Edit menu (Chinese UI may be 编辑)
        combo(VK_MENU, ord("E"))
        time.sleep(0.4)
        print("EDIT_MENU")
        return 0

    if action == "type":
        type_unicode(sys.argv[3])
        print("TYPED")
        return 0

    print(f"UNKNOWN {action}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
