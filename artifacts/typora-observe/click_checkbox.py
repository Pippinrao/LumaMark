"""Find unchecked task circle in Typora screenshot and click it."""
from __future__ import annotations

import ctypes
import math
import sys
import time
from collections import defaultdict
from ctypes import wintypes

from PIL import Image

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

user32 = ctypes.windll.user32

class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]

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


def find_hollow_circle(path: str) -> tuple[int, int] | None:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    hits: list[tuple[int, int]] = []
    for y in range(200, min(800, h), 2):
        for x in range(300, min(800, w), 2):
            r, g, b = img.getpixel((x, y))
            if not (150 <= r <= 210 and abs(r - g) < 15 and abs(g - b) < 15):
                continue
            dark = False
            for dx in range(25, 80):
                if x + dx >= w:
                    break
                rr, gg, bb = img.getpixel((x + dx, y))
                if (rr + gg + bb) / 3 < 90:
                    dark = True
                    break
            if not dark:
                continue
            ring = white = 0
            for a in range(0, 360, 15):
                rad = a * math.pi / 180
                px, py = int(x + 9 * math.cos(rad)), int(y + 9 * math.sin(rad))
                if 0 <= px < w and 0 <= py < h:
                    rr, gg, bb = img.getpixel((px, py))
                    if 140 <= rr <= 220 and abs(rr - gg) < 20:
                        ring += 1
                px, py = int(x + 2 * math.cos(rad)), int(y + 2 * math.sin(rad))
                if 0 <= px < w and 0 <= py < h:
                    rr, gg, bb = img.getpixel((px, py))
                    if rr > 230:
                        white += 1
            if ring >= 10 and white >= 8:
                hits.append((x, y))
    if not hits:
        return None
    clusters: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for x, y in hits:
        clusters[(x // 10, y // 10)].append((x, y))
    best = max(clusters.values(), key=len)
    xs = [p[0] for p in best]
    ys = [p[1] for p in best]
    return sum(xs) // len(xs), sum(ys) // len(ys)


def main() -> int:
    shot = sys.argv[1]
    pt = find_hollow_circle(shot)
    print(f"circle={pt}")
    if not pt:
        return 3
    hwnd = find_hwnd("gui-test")
    if not hwnd:
        print("NO_WINDOW")
        return 2
    rect = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    # PrintWindow bitmap coords == window rect coords when DPI-aware
    sx = rect.left + pt[0]
    sy = rect.top + pt[1]
    print(f"click={sx},{sy} win={rect.left},{rect.top}")
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.2)
    user32.SetCursorPos(sx, sy)
    time.sleep(0.05)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.03)
    user32.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.3)
    # Ctrl+S
    user32.keybd_event(0x11, 0, 0, 0)
    user32.keybd_event(0x53, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(0x53, 0, 2, 0)
    user32.keybd_event(0x11, 0, 2, 0)
    time.sleep(0.6)
    print("CLICKED_AND_SAVED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
