import ctypes, time, sys
from ctypes import wintypes
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: ctypes.windll.user32.SetProcessDPIAware()
user32=ctypes.windll.user32
class RECT(ctypes.Structure):
    _fields_=[("left",wintypes.LONG),("top",wintypes.LONG),("right",wintypes.LONG),("bottom",wintypes.LONG)]
class POINT(ctypes.Structure):
    _fields_=[("x",wintypes.LONG),("y",wintypes.LONG)]
EnumWindowsProc=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
def find(title):
    found=[]
    def cb(hwnd,lp):
        if user32.IsWindowVisible(hwnd):
            n=user32.GetWindowTextLengthW(hwnd)
            if n:
                b=ctypes.create_unicode_buffer(n+1); user32.GetWindowTextW(hwnd,b,n+1)
                if title.lower() in b.value.lower(): found.append(int(hwnd))
        return True
    user32.EnumWindows(EnumWindowsProc(cb),0)
    return found[0] if found else 0
hwnd=find("gui-test")
print("hwnd", hwnd)
r=RECT(); user32.GetWindowRect(hwnd,ctypes.byref(r))
# DWM extended frame
DWMWA_EXTENDED_FRAME_BOUNDS=9
ext=RECT()
ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(ext), ctypes.sizeof(ext))
print(f"GetWindowRect {r.left},{r.top},{r.right},{r.bottom}")
print(f"DWM frame     {ext.left},{ext.top},{ext.right},{ext.bottom}")
lx,ly=int(sys.argv[1]),int(sys.argv[2])
# Use DWM frame origin + local coords from PrintWindow (PrintWindow usually matches visible frame)
sx, sy = ext.left+lx, ext.top+ly
print(f"click {sx},{sy}")
user32.SetForegroundWindow(hwnd); time.sleep(0.3)
user32.SetCursorPos(sx,sy); time.sleep(0.05)
user32.mouse_event(2,0,0,0,0); time.sleep(0.04); user32.mouse_event(4,0,0,0,0)
time.sleep(0.4)
user32.keybd_event(0x11,0,0,0); user32.keybd_event(0x53,0,0,0); time.sleep(0.04)
user32.keybd_event(0x53,0,2,0); user32.keybd_event(0x11,0,2,0); time.sleep(0.8)
print("DONE")
