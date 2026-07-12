import ctypes, time, sys
from ctypes import wintypes
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
user32=ctypes.windll.user32
class RECT(ctypes.Structure):
    _fields_=[("left",wintypes.LONG),("top",wintypes.LONG),("right",wintypes.LONG),("bottom",wintypes.LONG)]
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
if not hwnd: print("NO_WINDOW"); raise SystemExit(2)
r=RECT(); user32.GetWindowRect(hwnd,ctypes.byref(r))
# local coords inside window image from analysis
lx, ly = int(sys.argv[1]), int(sys.argv[2])
sx, sy = r.left+lx, r.top+ly
print(f"win={r.left},{r.top} click={sx},{sy} local={lx},{ly}")
user32.SetForegroundWindow(hwnd); time.sleep(0.25)
user32.SetCursorPos(sx,sy); time.sleep(0.05)
user32.mouse_event(2,0,0,0,0); time.sleep(0.03); user32.mouse_event(4,0,0,0,0)
time.sleep(0.35)
user32.keybd_event(0x11,0,0,0); user32.keybd_event(0x53,0,0,0); time.sleep(0.03)
user32.keybd_event(0x53,0,2,0); user32.keybd_event(0x11,0,2,0); time.sleep(0.7)
print("DONE")
